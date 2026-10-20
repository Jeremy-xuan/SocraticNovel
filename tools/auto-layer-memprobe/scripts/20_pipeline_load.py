#!/usr/bin/env python3
"""20_pipeline_load.py —— 基线 ＋ 手段1 ＋ 手段2：**只做装载，不跑 forward**

为什么要单独量"装载"
--------------------
任务①要的是「**权重常驻峰值**」，不是"跑一张图"的峰值。装载与 forward 是两个可分的量：
  · 装载峰值 = 各组件从磁盘进内存、再上 MPS 的过程中，**同时在场**的权重总量；
  · forward 峰值 = 装载峰值 ＋ 激活值 ＋ MPS 缓存。
把装载单独量出来，才能判断"23 GB 里有多少是权重本身、多少是转换过程中的双份"。

上游的两条装载路径（逐字读自 `common/utils/inference_utils.py`）
---------------------------------------------------------------
  apply_layerdiff：  unet = UNetFrameConditionModel.from_pretrained(pretrained, subfolder='unet')   ← 不传 dtype
                     layerdiff_pipeline = KDiffusionStableDiffusionXLPipeline.from_pretrained(...)
                     layerdiff_pipeline.vae / trans_vae / unet / text_encoder / text_encoder_2
                                       .to(dtype=torch.bfloat16, device=DEVICE)                      ← 事后再转
  apply_marigold：   unet = UNetFrameConditionModel.from_pretrained(pretrained, subfolder='unet')   ← 同上
                     marigold_pipeline = MarigoldDepthPipeline.from_pretrained(pretrained, unet=unet)
                     marigold_pipeline.to(device=DEVICE, dtype=torch.bfloat16)                     ← 事后再转

两条路径都用了**模块级 global 单例**（`layerdiff_pipeline` / `marigold_pipeline`），
所以上游跑完一轮，**两份 pipeline 都还挂在进程里**。

本脚本的四种 stage（每种**单独一个进程**跑，避免峰值互相污染）
--------------------------------------------------------------
  layerdiff   只装载 LayerDiff 管线（unet ＋ vae ＋ trans_vae ＋ text_encoder ＋ text_encoder_2）
  marigold    只装载 Marigold 管线（unet ＋ vae ＋ text_encoder）
  concurrent  两条都载、都留着  ← 复现上游 global 单例的实际行为
  serial      载 layerdiff → **del ＋ gc ＋ torch.mps.empty_cache()** → 载 marigold
              ← 这是「手段2：逐组件装载＋及时释放」的实测

`--dtype bf16` 走「载入即半精度」（`torch_dtype=torch.bfloat16`），
`--dtype fp32` 复现上游（不传 dtype，diffusers 默认 upcast 成 float32）。

用法：
  PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python
  $PY scripts/20_pipeline_load.py --stage layerdiff --dtype fp32
  $PY scripts/20_pipeline_load.py --stage serial    --dtype bf16
"""
import argparse
import gc
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

W_LAYERDIFF = "/Users/wujunjie/dsh-scratch/auto-layer/weights/layerdiff3d"
W_MARIGOLD = "/Users/wujunjie/dsh-scratch/auto-layer/weights/marigold"


def rss_gb():
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 ** 3), 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", required=True,
                    choices=["layerdiff", "marigold", "concurrent", "serial"])
    ap.add_argument("--dtype", default="bf16", choices=["fp32", "bf16"])
    ap.add_argument("--device", default="mps", choices=["mps", "cpu"])
    args = ap.parse_args()

    import torch
    from modules.layerdiffuse.layerdiff3d import UNetFrameConditionModel
    from modules.layerdiffuse.diffusers_kdiffusion_sdxl import KDiffusionStableDiffusionXLPipeline
    from modules.layerdiffuse.vae import TransparentVAE
    from modules.marigold import MarigoldDepthPipeline

    DT = {"fp32": None, "bf16": torch.bfloat16}[args.dtype]
    rec = {"script": "20_pipeline_load.py", "stage": args.stage, "dtype": args.dtype,
           "device": args.device, "torch": torch.__version__,
           "started": time.strftime("%Y-%m-%d %H:%M:%S"), "steps": {}}

    def probe():
        d = {}
        if torch.backends.mps.is_available() and args.device == "mps":
            d["mps_allocated_gb"] = round(torch.mps.current_allocated_memory() / 1e9, 2)
            d["mps_driver_gb"] = round(torch.mps.driver_allocated_memory() / 1e9, 2)
        d["rss_gb"] = rss_gb()
        return d

    def stage(name, fn):
        t0 = time.time()
        try:
            r = fn()
            rec["steps"][name] = {"ok": True, "seconds": round(time.time() - t0, 2), **probe()}
            print(f"  [OK  ] {name:34s} {rec['steps'][name]['seconds']:7.2f}s  "
                  f"RSS {rec['steps'][name]['rss_gb']:6.2f} GB  "
                  f"MPS {rec['steps'][name].get('mps_allocated_gb','-')} GB  "
                  f"driver {rec['steps'][name].get('mps_driver_gb','-')} GB", flush=True)
            return r
        except Exception as e:  # noqa: BLE001
            rec["steps"][name] = {"ok": False, "seconds": round(time.time() - t0, 2),
                                  "error": f"{type(e).__name__}: {str(e)[:500]}",
                                  "traceback": traceback.format_exc()[-2500:]}
            print(f"  [FAIL] {name:34s}\n         {type(e).__name__}: {str(e)[:400]}", flush=True)
            return None

    def build_layerdiff():
        """逐字复刻 inference_utils.apply_layerdiff 的装载段（唯一差别是 dtype 可控）"""
        kw = {"subfolder": "trans_vae"}
        trans_vae = TransparentVAE.from_pretrained(W_LAYERDIFF, **kw)
        ukw = {"subfolder": "unet"}
        if DT is not None:
            ukw["torch_dtype"] = DT
        unet = UNetFrameConditionModel.from_pretrained(W_LAYERDIFF, **ukw)
        pkw = {"trans_vae": trans_vae, "unet": unet, "scheduler": None}
        if DT is not None:
            pkw["torch_dtype"] = DT
        pipe = KDiffusionStableDiffusionXLPipeline.from_pretrained(W_LAYERDIFF, **pkw)
        tgt = torch.bfloat16 if DT is None else DT
        pipe.vae.to(dtype=tgt, device=args.device)
        pipe.trans_vae.to(dtype=tgt, device=args.device)
        pipe.unet.to(dtype=tgt, device=args.device)
        pipe.text_encoder.to(dtype=tgt, device=args.device)
        pipe.text_encoder_2.to(dtype=tgt, device=args.device)
        if args.device == "mps":
            torch.mps.synchronize()
        return pipe

    def build_marigold():
        ukw = {"subfolder": "unet"}
        if DT is not None:
            ukw["torch_dtype"] = DT
        unet = UNetFrameConditionModel.from_pretrained(W_MARIGOLD, **ukw)
        pkw = {"unet": unet}
        if DT is not None:
            pkw["torch_dtype"] = DT
        pipe = MarigoldDepthPipeline.from_pretrained(W_MARIGOLD, **pkw)
        tgt = torch.bfloat16 if DT is None else DT
        pipe.to(device=args.device, dtype=tgt)
        if args.device == "mps":
            torch.mps.synchronize()
        return pipe

    def release(obj, name):
        """及时释放：del ＋ gc ＋ 清 MPS 缓存。三步缺一不可 ——
        `del` 只减引用计数；`gc.collect()` 回收循环引用；`torch.mps.empty_cache()`
        才把 MPS 的**缓存分配器**持有的显存还给驱动（否则 driver_allocated 不会回落）。"""
        if obj is not None:
            del obj
        gc.collect()
        if args.device == "mps":
            torch.mps.empty_cache()
            torch.mps.synchronize()
        print(f"  [REL ] 已释放 {name} -> RSS {rss_gb():.2f} GB  "
              f"MPS allocated {round(torch.mps.current_allocated_memory()/1e9,2)} GB  "
              f"driver {round(torch.mps.driver_allocated_memory()/1e9,2)} GB", flush=True)

    print(f"=== 管线装载 | stage={args.stage} | dtype={args.dtype} | device={args.device} ===", flush=True)
    if args.device == "mps":
        print(f"  MPS 推荐预算 {round(torch.mps.recommended_max_memory()/1e9,2)} GB", flush=True)

    if args.stage == "layerdiff":
        stage("build_layerdiff", build_layerdiff)
    elif args.stage == "marigold":
        stage("build_marigold", build_marigold)
    elif args.stage == "concurrent":
        ld = stage("build_layerdiff", build_layerdiff)
        mg = stage("build_marigold(同在)", build_marigold)
        rec["both_alive"] = {"layerdiff": ld is not None, "marigold": mg is not None}
    else:  # serial
        ld = stage("build_layerdiff", build_layerdiff)
        if ld is not None:
            # 🔴 释放必须**先断开外层引用**再 gc/empty_cache。
            #    若写成 `release(ld, ...)` 由被调函数 `del obj`，删的只是它自己的局部名，
            #    外层 `ld` 仍持有引用 → 实测 current_allocated_memory 纹丝不动。
            del ld
            stage("release_layerdiff", lambda: release(None, "layerdiff"))
        stage("build_marigold(释放后)", build_marigold)

    rec["rss_peak_gb_inproc"] = rss_gb()
    rec["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
    p = os.path.join(OUT, f"pipeline_load_{args.stage}_{args.dtype}.json")
    json.dump(rec, open(p, "w"), indent=2, ensure_ascii=False)
    print(f"\n  进程内 RSS 峰值 {rec['rss_peak_gb_inproc']} GB | 台账 {p}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
