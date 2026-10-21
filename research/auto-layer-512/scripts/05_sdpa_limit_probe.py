#!/usr/bin/env python3
"""05_sdpa_limit_probe.py —— 判定性探针：MPS 上 `F.scaled_dot_product_attention` 的
「Invalid buffer size」上限**随什么缩放**，以及 512² 的 marigold 到底有没有余量。

为什么需要这个探针（本任务的唯一问题就是它）：
  上一路（LAYER-MEMPROBE）768² 的完整 call 死在 marigold：
      RuntimeError: Invalid buffer size: 15.82 GiB
  崩点是 diffusers `attention_processor.py` 里的 `F.scaled_dot_product_attention`。
  于是「512² 能不能过」= 「这个 buffer 尺寸随什么缩放、上限是多少」这一个算术问题。
  合成张量把这个问题从"跑一次 46 s 才知道"降到"几秒钟量出上限"。

做法：**倍增搜索**（先 256 起步、每次翻倍直到失败，再在 [最后成功, 首个失败] 内二分）
      —— 绝不用"先试一个很大的上界"，避免在真机上瞬时申请几十 GB。
      测出 max_ok_L 后，把 B·H·L²·2 等候选量打出来，看哪一个在所有 B 下是常数。

🔴 本脚本不 import 上游、不改上游；纯 torch。
用法：
  PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python
  $PY scripts/05_sdpa_limit_probe.py --out out/sdpa_limit.json
"""
import argparse
import json
import os.path as osp
import time

import torch
import torch.nn.functional as F

L_START = 256


def try_sdpa(B, H, L, D, dtype):
    """跑一次 SDPA；返回 (ok, error_str)。失败后必须清缓存，否则污染下一次。"""
    try:
        q = torch.randn(B, H, L, D, device="mps", dtype=dtype)
        k = torch.randn(B, H, L, D, device="mps", dtype=dtype)
        v = torch.randn(B, H, L, D, device="mps", dtype=dtype)
        out = F.scaled_dot_product_attention(q, k, v, dropout_p=0.0, is_causal=False)
        torch.mps.synchronize()
        del q, k, v, out
        torch.mps.empty_cache()
        return True, ""
    except Exception as e:  # noqa: BLE001
        err = f"{type(e).__name__}: {str(e)[:200]}"
        torch.mps.empty_cache()
        return False, err


def max_ok_L(B, H, D, dtype, label=""):
    """倍增 + 二分找最大可过的 L。"""
    ok, err = try_sdpa(B, H, L_START, D, dtype)
    if not ok:
        return {"label": label, "B": B, "H": H, "D": D, "dtype": str(dtype),
                "max_ok_L": None, "first_bad_L": L_START, "first_bad_err": err,
                "note": "连 L=256 都失败"}
    lo, hi = L_START, None
    while True:
        cand = lo * 2
        ok, err = try_sdpa(B, H, cand, D, dtype)
        if not ok:
            hi = cand
            first_err = err
            break
        lo = cand
        if cand > 1 << 20:
            return {"label": label, "B": B, "H": H, "D": D, "dtype": str(dtype),
                    "max_ok_L": lo, "note": "倍增到 2^20 仍成功，未找到上限"}
    while hi - lo > 1:
        mid = (lo + hi) // 2
        ok, _ = try_sdpa(B, H, mid, D, dtype)
        if ok:
            lo = mid
        else:
            hi = mid
    esz = torch.tensor([], dtype=dtype).element_size()
    return {"label": label, "B": B, "H": H, "D": D, "dtype": str(dtype),
            "max_ok_L": lo, "first_bad_L": hi, "first_bad_err": first_err,
            "bytes_per_elem": esz,
            "B_H_L2_bytes_at_max": B * H * lo * lo * esz,
            "B_H_L2_bytes_at_first_bad": B * H * hi * hi * esz,
            "B_L2_bytes_at_max": B * lo * lo * esz,
            "B_H_L_D_bytes_at_max": B * H * lo * D * esz}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out/sdpa_limit.json")
    args = ap.parse_args()

    out = {"device": "mps", "torch": torch.__version__,
           "recommended_max_memory_gb": round(torch.mps.recommended_max_memory() / 1e9, 2),
           "started": time.strftime("%Y-%m-%d %H:%M:%S"), "probes": []}

    print(f"MPS 推荐预算 {out['recommended_max_memory_gb']} GB  torch {torch.__version__}", flush=True)

    # ① 只改 B：看 max_ok_L 是否 ∝ 1/sqrt(B)（⇒ buffer ∝ B·L²）还是 ∝ 1/B（⇒ ∝ B·L）
    for B in (1, 2, 4, 8, 13, 20):
        r = max_ok_L(B, 8, 64, torch.bfloat16, label=f"B{B}_H8_D64")
        out["probes"].append(r)
        g = lambda k: (r.get(k) or 0) / 2 ** 30
        print(f"  B={B:2d} H=8 D=64  max_ok_L={r['max_ok_L']}  "
              f"B·H·L²·2={g('B_H_L2_bytes_at_max'):7.2f} GiB  "
              f"B·L²·2={g('B_L2_bytes_at_max'):7.2f} GiB  "
              f"B·H·L·D·2={g('B_H_L_D_bytes_at_max'):6.2f} GiB", flush=True)

    # ② 只改 H（batch=1）：区分 H·L² 与 L²
    for H in (1, 4, 8):
        r = max_ok_L(1, H, 64, torch.bfloat16, label=f"B1_H{H}_D64")
        out["probes"].append(r)
        print(f"  B=1 H={H} D=64    max_ok_L={r['max_ok_L']}  "
              f"H·L²·2={(r.get('B_H_L2_bytes_at_max') or 0) / 2 ** 30:7.2f} GiB  "
              f"L²·2={(r.get('B_L2_bytes_at_max') or 0) / 2 ** 30:7.2f} GiB", flush=True)

    json.dump(out, open(args.out, "w"), indent=2, ensure_ascii=False)
    print(f"\n台账 -> {osp.abspath(args.out)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
