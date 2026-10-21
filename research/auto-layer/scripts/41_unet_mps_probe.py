#!/usr/bin/env python3
"""41_unet_mps_probe.py —— 隔离实验：**只把 SDXL UNet 放上 MPS** 跑一次前向

为什么要做这个隔离实验（而不是直接跑整条 `inference_psd.py`）：
  整条管线实测**峰值 23 GB**（`top` 实测），在 24 GB 机器上把 swap 打满
  （`vm.swapusage` 实测 used 34.5/35.8 GB），进程进 `STAT=U`（不可中断等待）——
  `sample` 抓栈显示它**确实在 GPU 上算**（`at::MPS_gelu` → MPSGraph → Metal command buffer
  → `_dispatch_semaphore_wait_slow`），**不是崩溃、也不是死锁，是被换页拖到走不动**。
  → 所以"能不能跑"这个问题被"内存放不下"污染了。**隔离出 UNet 单跑**才能给出干净答案。

本脚本回答三件事：
  ① 8.14 GB 的 UNet 单独能不能搬到 MPS（bf16）；
  ② 搬上去之后，**一次前向**能不能算完、要多久；
  ③ 峰值占用多少（RSS + MPS allocated）。

用法：
  $PY scripts/41_unet_mps_probe.py --device mps --latent 96   # 96 => 768x768 图
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
VENDOR = os.path.join(ROOT, "vendor", "see-through")
sys.path.insert(0, os.path.join(VENDOR, "common"))
OUT = os.path.join(ROOT, "out", "probe")
os.makedirs(OUT, exist_ok=True)


def rss_gb():
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 ** 3), 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default="mps", choices=["mps", "cpu", "cuda"])
    ap.add_argument("--latent", type=int, default=96, help="latent 边长；96 -> 768px 图")
    ap.add_argument("--w-unet", default=os.path.join(os.environ.get("AUTO_LAYER_SCRATCH", os.path.join(os.path.expanduser("~"), "dsh-scratch", "auto-layer")), "weights", "layerdiff3d"))
    ap.add_argument("--dtype", default="bfloat16", choices=["bfloat16", "float16", "float32"])
    ap.add_argument("--iters", type=int, default=1)
    args = ap.parse_args()

    import torch

    DT = {"bfloat16": torch.bfloat16, "float16": torch.float16, "float32": torch.float32}[args.dtype]
    rec = {"script": "41_unet_mps_probe.py", "device": args.device, "latent": args.latent,
           "dtype": args.dtype, "iters": args.iters, "torch": torch.__version__,
           "steps": {}, "started": time.strftime("%Y-%m-%d %H:%M:%S")}

    def stage(name, fn):
        t0 = time.time()
        try:
            r = fn()
            dt = round(time.time() - t0, 2)
            rec["steps"][name] = {"ok": True, "seconds": dt, "rss_gb": rss_gb()}
            print(f"  [OK  ] {name:30s} {dt:8.2f}s  RSS {rss_gb():.2f} GB")
            return r
        except Exception as e:  # noqa: BLE001
            dt = round(time.time() - t0, 2)
            rec["steps"][name] = {"ok": False, "seconds": dt, "rss_gb": rss_gb(),
                                  "error": f"{type(e).__name__}: {str(e)[:600]}",
                                  "traceback": traceback.format_exc()[-2500:]}
            print(f"  [FAIL] {name:30s} {dt:8.2f}s\n         {type(e).__name__}: {str(e)[:400]}")
            return None

    print(f"=== SDXL UNet 隔离探针 | {args.device} | {args.dtype} | latent {args.latent} ===")
    if args.device == "mps":
        rec["mps_recommended_max_gb"] = round(torch.mps.recommended_max_memory() / 1e9, 2)
        print(f"  MPS 预算 {rec['mps_recommended_max_gb']} GB")

    from modules.layerdiffuse.layerdiff3d import UNetFrameConditionModel

    def _load():
        m = UNetFrameConditionModel.from_pretrained(args.w_unet, subfolder="unet")
        n = sum(p.numel() for p in m.parameters()) / 1e6
        rec["params_m"] = round(n, 1)
        rec["steps"].setdefault("meta", {})["params_m"] = round(n, 1)
        print(f"  参数 {n:.1f} M（fp32 载入完成，RSS {rss_gb():.2f} GB）")
        return m

    unet = stage("from_pretrained(fp32)", _load)
    if unet is None:
        json.dump(rec, open(os.path.join(OUT, f"unet_probe_{args.device}.json"), "w"),
                  indent=2, ensure_ascii=False)
        return 3

    def _to():
        unet.to(dtype=DT, device=args.device)
        unet.eval()
        if args.device == "mps":
            torch.mps.synchronize()
            rec["mps_allocated_gb"] = round(torch.mps.current_allocated_memory() / 1e9, 2)
            print(f"  搬到 {args.device} 后 MPS allocated {rec['mps_allocated_gb']} GB，RSS {rss_gb():.2f} GB")
        return True

    if stage(f"to({args.device},{args.dtype})", _to) is None:
        json.dump(rec, open(os.path.join(OUT, f"unet_probe_{args.device}.json"), "w"),
                  indent=2, ensure_ascii=False)
        return 4

    L = args.latent
    # 该 UNet 的输入约定（读源码 + config 逐条推出，不是猜的）：
    #  · 它按 **tag 组**工作：`cache_tag_embeds()` 里 body 组 13 个 tag、head 组 11 个 tag
    #    （`config.group_embedding_num = [13, 11]`），`group_index` 选组。
    #  · 13 个 tag 走**帧维**：前向体 `batch_size, num_frames = sample.shape[:2]` 后
    #    `sample.reshape(batch_size*num_frames, *sample.shape[2:])`
    #    → sample = (B, 帧数=tag数, 8, H, W)；`CrossFrameAttn*` 就是跨 tag 注意。
    #  · `GroupEmbedding.forward` 对 2 维输入做 `x + params`（params 形状 (13,1280)）
    #    → text_embeds 必须是 (13, 1280)；time_ids (13, 6)；
    #    `time_embeds.reshape((text_embeds.shape[0], -1))` = (13, 1536)，与 2816=1280+1536 吻合。
    NTAG = 13
    def _fwd():
        g = torch.Generator(device=args.device if args.device != "cpu" else "cpu").manual_seed(0)
        sample = torch.randn(1, NTAG, 8, L, L, device=args.device, dtype=DT, generator=g)
        enc = torch.randn(NTAG, 77, 2048, device=args.device, dtype=DT, generator=g)
        added = {"text_embeds": torch.randn(NTAG, 1280, device=args.device, dtype=DT, generator=g),
                 "time_ids": torch.randn(NTAG, 6, device=args.device, dtype=DT, generator=g)}
        ts = []
        with torch.inference_mode():
            for _ in range(args.iters):
                t0 = time.time()
                out = unet(sample, torch.tensor(10.0, device=args.device), enc,
                           added_cond_kwargs=added, return_dict=False, group_index=0)[0]
                if args.device == "mps":
                    torch.mps.synchronize()
                ts.append(round(time.time() - t0, 3))
        rec["forward_seconds"] = ts
        rec["forward_shape"] = list(out.shape)
        rec["mps_peak_gb"] = round(torch.mps.driver_allocated_memory() / 1e9, 2) if args.device == "mps" else None
        return ts

    ts = stage("unet.forward", _fwd)
    rec["verdict"] = ("SDXL UNet 在 %s 上跑通，单次前向 %.2fs" % (args.device, ts[0])) if ts else "UNet 前向失败"
    rec["rss_peak_gb"] = rss_gb()
    rec["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
    p = os.path.join(OUT, f"unet_probe_{args.device}.json")
    json.dump(rec, open(p, "w"), indent=2, ensure_ascii=False)
    print(f"\n结论：{rec['verdict']}\n  RSS 峰值 {rec['rss_peak_gb']} GB | 台账 {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
