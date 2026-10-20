#!/usr/bin/env python3
"""06_sdpa_one.py —— 「一次一个形状」的 SDPA 探针（**每个形状必须独立进程**）。

为什么必须独立进程（05 的实测教训）：
  05 在同一个进程里连测 9 档，**第一档失败之后，后面每一档都失败**，报的是
  `MPS backend out of memory (... other allocations: 39.41 GiB, max allowed: 27.20 GiB)`。
  → 也就是说：`Invalid buffer size` 一旦发生，MPS allocator 会留下一大堆无法归还的
  "other allocations"，**这个进程后面测什么都不作数**（`empty_cache()` 也救不回来）。
  → 所以每个数据点都必须起一个干净的进程。

输出（stdout，单行 JSON）：形状 / 成功与否 / 逐字报错 / 该次调用前后 MPS 内存。

用法：
  PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python
  $PY scripts/06_sdpa_one.py --B 1 --H 8 --L 17409 --D 64
"""
import argparse
import json

import torch
import torch.nn.functional as F


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--B", type=int, required=True)
    ap.add_argument("--H", type=int, required=True)
    ap.add_argument("--L", type=int, required=True)
    ap.add_argument("--D", type=int, default=64)
    ap.add_argument("--dtype", default="bf16", choices=["bf16", "fp32"])
    ap.add_argument("--pad", type=int, default=0,
                    help="把 L 补到该长度（模拟 MPS 内部可能的 padding），仅用于记录")
    args = ap.parse_args()

    dt = {"bf16": torch.bfloat16, "fp32": torch.float32}[args.dtype]
    esz = torch.tensor([], dtype=dt).element_size()

    rec = {"B": args.B, "H": args.H, "L": args.L, "D": args.D, "dtype": args.dtype,
           "q_numel": args.B * args.H * args.L * args.D,
           "attn_matrix_numel": args.B * args.H * args.L * args.L,
           "attn_matrix_bytes": args.B * args.H * args.L * args.L * esz,
           "recommended_max_memory_gb": round(torch.mps.recommended_max_memory() / 1e9, 2)}

    try:
        q = torch.randn(args.B, args.H, args.L, args.D, device="mps", dtype=dt)
        k = torch.randn(args.B, args.H, args.L, args.D, device="mps", dtype=dt)
        v = torch.randn(args.B, args.H, args.L, args.D, device="mps", dtype=dt)
        rec["alloc_before_sdpa_gb"] = round(torch.mps.current_allocated_memory() / 1e9, 2)
        out = F.scaled_dot_product_attention(q, k, v, dropout_p=0.0, is_causal=False)
        torch.mps.synchronize()
        rec["ok"] = True
        rec["alloc_after_sdpa_gb"] = round(torch.mps.current_allocated_memory() / 1e9, 2)
        rec["driver_after_sdpa_gb"] = round(torch.mps.driver_allocated_memory() / 1e9, 2)
    except Exception as e:  # noqa: BLE001
        rec["ok"] = False
        rec["error"] = f"{type(e).__name__}: {str(e)[:300]}"
        rec["driver_after_fail_gb"] = round(torch.mps.driver_allocated_memory() / 1e9, 2)

    print("RESULT " + json.dumps(rec, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
