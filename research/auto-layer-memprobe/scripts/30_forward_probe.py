#!/usr/bin/env python3
"""30_forward_probe.py —— forward 阶段的峰值 ＋ 手段3（切片/分块）

为什么必须单独量 forward
------------------------
装载峰值（脚本 20）只是"权重在场"的代价；**forward 峰值 = 权重 ＋ 激活值 ＋ MPS 缓存**。
上一路（L2D-LAYER-GPU）实测过一组关键数字：
    `.to(mps,bf16)` 后 `torch.mps.current_allocated_memory() = 8.14 GB`
    跑完一次 forward 后 `torch.mps.driver_allocated_memory()` 峰值 **19.87 GB**
→ 差值 11.73 GB 全部来自激活值与 MPS 缓存分配器。**这才是"能不能压进 17 GB"的真正战场**。

本脚本要拆清楚三件事：
  ① forward 的**真实系统占用**是多少（外层 `/usr/bin/time -l` 的 peak memory footprint，
     在统一内存架构下 MPS 的显存就是物理内存，所以这个数才是权威的）；
  ② `current_allocated` 与 `driver_allocated` 差多少（→ 缓存池占了多大，能否靠 empty_cache 回收）；
  ③ **手段3**：上游/diffusers 现成的降峰值开关各能省多少：
     · `set_attention_slice(...)`  —— diffusers 的 attention slicing（把注意力分块算，降激活峰值）
     · `--latent`                 —— 分辨率本身（768² → 512²，激活值按面积缩）
     · `--tags`                   —— 一次前向的 tag 数（上游 body 组 13 / head 组 11）

🔴 纪律：**不自己发明分块算法**。只调用上游与 diffusers 已有的开关；没有的就如实写"上游没有"。

用法：
  PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python
  $PY scripts/30_forward_probe.py --dtype bf16 --latent 96 --tags 13
  $PY scripts/30_forward_probe.py --dtype bf16 --latent 96 --tags 13 --attn-slice auto
  $PY scripts/30_forward_probe.py --dtype bf16 --latent 64 --tags 13
"""
import argparse
import json
import os
import resource
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
AUTO_LAYER = os.environ.get("AUTO_LAYER_DIR",
                            os.path.join(os.path.dirname(ROOT), "auto-layer"))
VENDOR = os.path.join(AUTO_LAYER, "vendor", "see-through")
OUT = os.path.join(ROOT, "out")
os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, os.path.join(VENDOR, "common"))

W_UNET = "/Users/wujunjie/dsh-scratch/auto-layer/weights/layerdiff3d"


def rss_gb():
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 ** 3), 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dtype", default="bf16", choices=["fp32", "bf16", "fp16"])
    ap.add_argument("--latent", type=int, default=96, help="latent 边长：96→768px，64→512px，160→1280px")
    ap.add_argument("--tags", type=int, default=13, help="一次前向的 tag 数（上游 body 组 13 / head 组 11）")
    ap.add_argument("--iters", type=int, default=1)
    ap.add_argument("--attn-slice", default="off", help="diffusers attention slicing：off|auto|max|<int>")
    ap.add_argument("--w-unet", default=W_UNET)
    args = ap.parse_args()

    import torch
    from modules.layerdiffuse.layerdiff3d import UNetFrameConditionModel

    DT = {"fp32": None, "bf16": torch.bfloat16, "fp16": torch.float16}[args.dtype]
    rec = {"script": "30_forward_probe.py", "dtype": args.dtype, "latent": args.latent,
           "tags": args.tags, "iters": args.iters, "attn_slice": args.attn_slice,
           "torch": torch.__version__, "steps": {},
           "started": time.strftime("%Y-%m-%d %H:%M:%S")}

    def mps():
        return {"mps_allocated_gb": round(torch.mps.current_allocated_memory() / 1e9, 2),
                "mps_driver_gb": round(torch.mps.driver_allocated_memory() / 1e9, 2)}

    def stage(name, fn):
        t0 = time.time()
        try:
            r = fn()
            d = {"ok": True, "seconds": round(time.time() - t0, 2), "rss_gb": rss_gb(), **mps()}
            rec["steps"][name] = d
            print(f"  [OK  ] {name:30s} {d['seconds']:8.2f}s  RSS {d['rss_gb']:6.2f} GB  "
                  f"alloc {d['mps_allocated_gb']:6.2f} GB  driver {d['mps_driver_gb']:6.2f} GB", flush=True)
            return r
        except Exception as e:  # noqa: BLE001
            rec["steps"][name] = {"ok": False, "seconds": round(time.time() - t0, 2),
                                  "error": f"{type(e).__name__}: {str(e)[:600]}",
                                  "traceback": traceback.format_exc()[-2500:]}
            print(f"  [FAIL] {name:30s}\n         {type(e).__name__}: {str(e)[:400]}", flush=True)
            return None

    print(f"=== UNet forward 探针 | {args.dtype} | latent {args.latent} | tags {args.tags} "
          f"| attn_slice={args.attn_slice} ===", flush=True)
    print(f"  MPS 推荐预算 {round(torch.mps.recommended_max_memory()/1e9,2)} GB", flush=True)

    def _load():
        kw = {"subfolder": "unet"}
        if DT is not None:
            kw["torch_dtype"] = DT
        m = UNetFrameConditionModel.from_pretrained(args.w_unet, **kw)
        rec["params_m"] = round(sum(p.numel() for p in m.parameters()) / 1e6, 1)
        return m

    unet = stage("from_pretrained", _load)
    if unet is None:
        json.dump(rec, open(os.path.join(OUT, f"fwd_{args.dtype}_l{args.latent}_{args.attn_slice}.json"), "w"),
                  indent=2, ensure_ascii=False)
        return 3

    tgt = torch.bfloat16 if DT is None else DT
    if stage("to(mps)", lambda: (unet.to(dtype=tgt, device="mps"), unet.eval(), torch.mps.synchronize())) is None:
        return 4

    # ---- 手段3：attention slicing（只调 diffusers 现成开关，不自研）----
    if args.attn_slice != "off":
        def _slice():
            v = args.attn_slice
            arg = int(v) if v.isdigit() else v        # "auto" / "max" / 整数
            unet.set_attention_slice(arg)             # diffusers ModelMixin 的现成方法
            rec["attn_slice_applied"] = str(arg)
            return arg
        if stage(f"set_attention_slice({args.attn_slice})", _slice) is None:
            return 5

    L, NTAG = args.latent, args.tags

    def _fwd():
        g = torch.Generator(device="mps").manual_seed(0)
        sample = torch.randn(1, NTAG, 8, L, L, device="mps", dtype=tgt, generator=g)
        enc = torch.randn(NTAG, 77, 2048, device="mps", dtype=tgt, generator=g)
        added = {"text_embeds": torch.randn(NTAG, 1280, device="mps", dtype=tgt, generator=g),
                 "time_ids": torch.randn(NTAG, 6, device="mps", dtype=tgt, generator=g)}
        ts = []
        with torch.inference_mode():
            for _ in range(args.iters):
                t0 = time.time()
                out = unet(sample, torch.tensor(10.0, device="mps"), enc,
                           added_cond_kwargs=added, return_dict=False, group_index=0)[0]
                torch.mps.synchronize()
                ts.append(round(time.time() - t0, 3))
        rec["forward_seconds"] = ts
        rec["forward_shape"] = list(out.shape)
        return ts

    if stage("unet.forward", _fwd) is None:
        json.dump(rec, open(os.path.join(OUT, f"fwd_{args.dtype}_l{args.latent}_{args.attn_slice}.json"), "w"),
                  indent=2, ensure_ascii=False)
        return 6

    # ---- forward 后清 MPS 缓存，看缓存池能回收多少（→ 缓存不是"泄漏"，但确实占物理内存）----
    def _empty():
        torch.mps.empty_cache()
        torch.mps.synchronize()
        return True
    stage("mps.empty_cache()", _empty)

    rec["rss_peak_gb_inproc"] = rss_gb()
    rec["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
    p = os.path.join(OUT, f"fwd_{args.dtype}_l{args.latent}_{args.attn_slice}.json")
    json.dump(rec, open(p, "w"), indent=2, ensure_ascii=False)
    print(f"\n  进程内 RSS 峰值 {rec['rss_peak_gb_inproc']} GB | 台账 {p}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
