#!/usr/bin/env python3
"""10_unet_load_dtype.py —— 手段1 的核心实验：**载入 dtype 是不是峰值来源**

要回答的问题
------------
上一路（L2D-LAYER-GPU）实测：SDXL UNet `from_pretrained`（不传 dtype）用 **15.10 s** 载入，
再 `.to(mps, bfloat16)` 用 10.38 s，最后 MPS allocated 8.14 GB。
但**没测"载入那一刻的 CPU 峰值"**，而 `from_pretrained` 不传 `torch_dtype` 时，
diffusers 的 `ModelMixin` **默认把权重变成 float32**。

本脚本要量清楚：
  ① 磁盘上的 safetensors 到底是几字节/参数（→ 决定 fp32 载入会不会翻倍）；
  ② `from_pretrained()` 不传 dtype 时，CPU 峰值是多少（**这是"fp32 载入"的代价**）；
  ③ 传 `torch_dtype=torch.bfloat16` / `float16` 时，CPU 峰值是多少（**这是"全程 fp16/bf16"的代价**）；
  ④ 三者搬到 MPS 后的 `driver_allocated_memory` 各是多少。

🔴 为什么这个实验是"压内存"的第一刀
------------------------------------
上游 `utils/inference_utils.py` 的装载路径逐字是：
    unet = UNetFrameConditionModel.from_pretrained(pretrained, subfolder='unet')   # ← 不传 dtype
    ...
    layerdiff_pipeline.unet.to(dtype=torch.bfloat16, device=DEVICE)                # ← 事后再转
`module.to(dtype=...)` 在 PyTorch 里是**非原地**的：先建新张量、再替换参数。
→ 转换的那一瞬间，**fp32 与 bf16 两份权重同时在场**。
   unet 4071.3 M 参数：fp32 = 16.28 GB，bf16 = 8.14 GB → **转换瞬间 ≥ 16.28 GB 只是这一份模型**。
若改为**载入即 bf16**，则永远只有 8.14 GB 一份 —— 这正是"能不能压进 17 GB"的关键一刀。

用法（🔴 每个模式必须**单独一个进程**跑，否则峰值互相污染）：
  PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python
  $PY scripts/10_unet_load_dtype.py --mode fp32
  $PY scripts/10_unet_load_dtype.py --mode bf16
  $PY scripts/10_unet_load_dtype.py --mode fp16
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
# 上游源码副本在**只读**的兄弟目录 auto-layer/ 下，本目录不复制、不修改
AUTO_LAYER = os.environ.get("AUTO_LAYER_DIR",
                            os.path.join(os.path.dirname(ROOT), "auto-layer"))
VENDOR = os.path.join(AUTO_LAYER, "vendor", "see-through")
OUT = os.path.join(ROOT, "out")
os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, os.path.join(VENDOR, "common"))


def rss_gb():
    """进程自记 RSS 峰值（ru_maxrss 字节）。⚠️ 这是**进程视角**，不含被压缩页的系统记账，
    只作内部交叉参考；权威数字由外层 `/usr/bin/time -l` 的 peak memory footprint 给。"""
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 ** 3), 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", required=True, choices=["fp32", "bf16", "fp16"],
                    help="fp32 = 复现上游（不传 dtype）；bf16/fp16 = 载入即半精度")
    ap.add_argument("--w-unet", default="/Users/wujunjie/dsh-scratch/auto-layer/weights/layerdiff3d")
    ap.add_argument("--no-mps", action="store_true", help="只测 CPU 载入，不搬 MPS")
    args = ap.parse_args()

    import torch
    from modules.layerdiffuse.layerdiff3d import UNetFrameConditionModel

    rec = {
        "script": "10_unet_load_dtype.py", "mode": args.mode, "torch": torch.__version__,
        "started": time.strftime("%Y-%m-%d %H:%M:%S"), "steps": {},
    }

    # ① 先看磁盘上的 safetensors 是几字节/参数（决定"默认 fp32 载入"会不会翻倍）
    sf = os.path.join(args.w_unet, "unet", "diffusion_pytorch_model.safetensors")
    rec["safetensors_bytes"] = os.path.getsize(sf) if os.path.exists(sf) else None

    def stage(name, fn):
        t0 = time.time()
        try:
            r = fn()
            dt = round(time.time() - t0, 2)
            rec["steps"][name] = {"ok": True, "seconds": dt, "rss_gb": rss_gb()}
            if torch.backends.mps.is_available():
                rec["steps"][name]["mps_driver_gb"] = round(torch.mps.driver_allocated_memory() / 1e9, 2)
                rec["steps"][name]["mps_allocated_gb"] = round(torch.mps.current_allocated_memory() / 1e9, 2)
            print(f"  [OK  ] {name:26s} {dt:7.2f}s  RSS {rss_gb():6.2f} GB", flush=True)
            return r
        except Exception as e:  # noqa: BLE001
            rec["steps"][name] = {"ok": False, "seconds": round(time.time() - t0, 2),
                                  "error": f"{type(e).__name__}: {str(e)[:500]}",
                                  "traceback": traceback.format_exc()[-2000:]}
            print(f"  [FAIL] {name:26s}\n         {type(e).__name__}: {str(e)[:400]}", flush=True)
            return None

    print(f"=== UNet 载入 dtype 实验 | mode={args.mode} ===", flush=True)

    DT = {"fp32": None, "bf16": torch.bfloat16, "fp16": torch.float16}[args.mode]

    def _load():
        kw = {"subfolder": "unet"}
        if DT is not None:
            kw["torch_dtype"] = DT          # 🔴 关键：载入即目标 dtype，跳过 fp32 中间态
        m = UNetFrameConditionModel.from_pretrained(args.w_unet, **kw)
        n = sum(p.numel() for p in m.parameters()) / 1e6
        rec["params_m"] = round(n, 1)
        # 逐参数 dtype 统计（证明"载入即 bf16"真的生效，而不是只在参数名上）
        dts = {}
        for p in m.parameters():
            k = str(p.dtype)
            dts[k] = dts.get(k, 0) + p.numel()
        rec["param_dtype_hist"] = {k: round(v / 1e6, 1) for k, v in dts.items()}
        print(f"  参数 {n:.1f} M | dtype 直方图(M 参数) {rec['param_dtype_hist']} | RSS {rss_gb():.2f} GB", flush=True)
        return m

    unet = stage("from_pretrained", _load)
    if unet is None:
        json.dump(rec, open(os.path.join(OUT, f"unet_load_{args.mode}.json"), "w"),
                  indent=2, ensure_ascii=False)
        return 3

    if not args.no_mps and torch.backends.mps.is_available():
        tgt = torch.bfloat16 if DT is None else DT
        stage("to(mps,bf16/fp16)", lambda: (unet.to(dtype=tgt, device="mps"), unet.eval(),
                                            torch.mps.synchronize()))

    rec["rss_peak_gb_inproc"] = rss_gb()
    rec["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
    p = os.path.join(OUT, f"unet_load_{args.mode}.json")
    json.dump(rec, open(p, "w"), indent=2, ensure_ascii=False)
    print(f"\n  进程内 RSS 峰值 {rec['rss_peak_gb_inproc']} GB | 台账 {p}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
