#!/usr/bin/env python3
"""32_run_lama_mps.py —— 在 Apple GPU(MPS) 上跑「动漫专用 LaMa 修补」

为什么测这条路（这是本次最有价值的替代方案）：
  See-through 主管线用 **10.16 GB 的 LayerDiff 3D(SDXL)** 生成透明层，
  但它自己仓库里另有一条**轻量修补**路线：`annotators/lama_inpainter`
  —— 动漫微调的 LaMa，权重 `dreMaz/AnimeMangaInpainting/lama_large_512px.ckpt` **仅 204.5 MB**
  （`infer_lama.py` 就是用它造训练数据的）。

三条对 MPS 友好的事实（都已实测）：
  ① `apply_inpaint(img, mask, device='cuda')` 的 device **本来就是参数**（不是写死的），
     且代码里有 `if device in {'cuda'}` 的 autocast 分支与 `else` 分支 → 非 CUDA 路径现成；
  ② LaMa 用 FFC（傅里叶卷积）→ 需要 `torch.fft`；**MPS 上 fft2/rfft2/irfft2/complex64 实测全通过**；
  ③ 权重 204.5 MB vs 10.16 GB —— 差 **50 倍**。

本脚本做两件事（都留证据）：
  A. **能力自检**：把某个部件擦掉再让 LaMa 重建，看画面是否合理（证明 MPS 上真能跑、不是空转）。
  B. **真实用途**：把「脸」被头发遮住的部分补出来（这正是 Live2D 分层需要的"补全被遮挡区"）。

用法：
  $PY scripts/32_run_lama_mps.py --device mps --samdir out/sam/sam_mps_test1
"""
import argparse
import json
import os
import resource
import sys
import time
import traceback

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VENDOR = os.path.join(ROOT, "vendor", "see-through")
sys.path.insert(0, os.path.join(VENDOR, "common"))
sys.path.insert(0, VENDOR)                      # `annotators` 包在仓库根
sys.path.insert(0, os.path.join(VENDOR, "annotators"))   # `lama_inpainter` 是它下面的子包

LABELS = ['hair', 'headwear', 'face', 'eyes', 'eyewear', 'ears', 'earwear', 'nose',
          'mouth', 'neck', 'neckwear', 'topwear', 'handwear', 'bottomwear', 'legwear',
          'footwear', 'tail', 'wings', 'objects']
CKPT = os.path.join(os.environ.get("AUTO_LAYER_SCRATCH", os.path.join(os.path.expanduser("~"), "dsh-scratch", "auto-layer")), "weights", "lama_anime_512.ckpt")


def rss_mb():
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024), 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default="mps", choices=["mps", "cpu", "cuda"])
    ap.add_argument("--samdir", required=True, help="30_run_sam_mps.py 的产出目录")
    ap.add_argument("--outdir", default=os.path.join(ROOT, "out", "lama"))
    ap.add_argument("--tag", default=None)
    ap.add_argument("--ckpt", default=CKPT)
    ap.add_argument("--inpaint-size", type=int, default=1024)
    ap.add_argument("--target", default="face", help="要做补全的目标部件")
    ap.add_argument("--occluder", default="hair", help="遮住它的部件")
    args = ap.parse_args()

    tag = args.tag or f"lama_{args.device}"
    outdir = os.path.join(args.outdir, tag)
    os.makedirs(outdir, exist_ok=True)

    import torch
    import cv2

    rec = {"script": "32_run_lama_mps.py", "device_requested": args.device,
           "samdir": os.path.abspath(args.samdir), "ckpt": args.ckpt,
           "torch": torch.__version__, "started": time.strftime("%Y-%m-%d %H:%M:%S"),
           "steps": {}}

    def stage(name, fn):
        t0 = time.time()
        try:
            r = fn()
            rec["steps"][name] = {"ok": True, "seconds": round(time.time() - t0, 2)}
            print(f"  [OK  ] {name:26s} {time.time()-t0:7.2f}s")
            return r
        except Exception as e:  # noqa: BLE001
            rec["steps"][name] = {"ok": False, "seconds": round(time.time() - t0, 2),
                                  "error": f"{type(e).__name__}: {str(e)[:600]}",
                                  "traceback": traceback.format_exc()[-2500:]}
            print(f"  [FAIL] {name:26s} {time.time()-t0:7.2f}s\n         {type(e).__name__}: {str(e)[:300]}")
            return None

    print(f"=== 设备 {args.device} | LaMa 修补 | samdir={args.samdir} ===")

    # 载入原图与掩码
    def _load():
        img = np.array(Image.open(os.path.join(args.samdir, "input.png")).convert("RGB"))
        mdir = os.path.join(args.samdir, "masks")
        masks = {}
        for f in sorted(os.listdir(mdir)):
            if not f.endswith(".png"):
                continue
            i = int(f.split("_")[0])
            a = np.array(Image.open(os.path.join(mdir, f)).convert("RGBA"))[..., 3]
            masks[LABELS[i]] = a > 127
        return img, masks

    loaded = stage("load_image_and_masks", _load)
    if loaded is None:
        return 3
    img, masks = loaded
    rec["image_shape"] = list(img.shape)
    rec["available_parts"] = sorted(masks.keys())
    print(f"  图 {img.shape} | 可用部件 {sorted(masks.keys())}")

    # 载入 LaMa（本地权重，绕开 torch.hub 的联网下载）
    def _load_lama():
        from lama_inpainter import LamaFourier
        import lama_inpainter as LI
        m = LamaFourier(build_discriminator=False, use_mpe=False, large_arch=True)
        sd = torch.load(args.ckpt, map_location="cpu", weights_only=False)
        m.generator.load_state_dict(sd["gen_state_dict"])
        m.eval().to(args.device)
        LI.model = m              # 填进模块级全局，apply_inpaint 直接复用
        # LamaFourier 是普通类（不是 nn.Module），参数在 .generator 上
        n = sum(p.numel() for p in m.generator.parameters()) / 1e6
        print(f"  LaMa 参数 {n:.1f} M，落在 {next(m.generator.parameters()).device}")
        rec["lama_params_m"] = round(n, 1)
        return m

    lama = stage("load_lama", _load_lama)
    if lama is None:
        rec["verdict"] = "LaMa 加载失败"
        json.dump(rec, open(os.path.join(outdir, "result.json"), "w"), indent=2, ensure_ascii=False)
        return 4

    from lama_inpainter import apply_inpaint

    def _run_one(name, hole_mask, keep_img):
        t0 = time.time()
        out = apply_inpaint(keep_img, (hole_mask.astype(np.uint8) * 255),
                            device=args.device, precision=torch.float32)
        if args.device == "mps":
            torch.mps.synchronize()
        dt = time.time() - t0
        rec["steps"].setdefault("inpaint_runs", {})[name] = round(dt, 2)
        print(f"  [OK  ] inpaint:{name:20s} {dt:7.2f}s")
        return out

    # ---- A. 能力自检：擦掉目标部件再重建 ----
    def _selfcheck():
        if args.target not in masks:
            raise KeyError(f"该图没有部件 {args.target}")
        hole = masks[args.target]
        rec["selfcheck_hole_px"] = int(hole.sum())
        out = _run_one(f"erase_{args.target}", hole, img)
        Image.fromarray(out).save(os.path.join(outdir, f"selfcheck_{args.target}_inpainted.png"))
        # 三联图：原图 | 挖洞 | 修补
        holed = img.copy(); holed[hole] = 255
        trip = np.concatenate([img, holed, out], axis=1)
        Image.fromarray(trip).save(os.path.join(outdir, f"selfcheck_{args.target}_triple.png"))
        # 数值判据：修补区应与原图**不同**（真的重画了），但也不是全白/全黑
        diff = np.abs(out.astype(int) - img.astype(int)).mean()
        rec["selfcheck_mean_abs_diff"] = round(float(diff), 3)
        rec["selfcheck_out_std"] = round(float(out.std()), 3)
        return out

    a = stage("selfcheck_erase_rebuild", _selfcheck)

    # ---- B. 真实用途：补出被遮挡的部件 ----
    def _occluded():
        if args.target not in masks or args.occluder not in masks:
            raise KeyError(f"缺部件 {args.target} 或 {args.occluder}")
        tgt, occ = masks[args.target], masks[args.occluder]
        # 目标部件的 bbox 外扩 20%，只在这个范围内填被遮挡处
        ys, xs = np.nonzero(tgt)
        y0, y1 = ys.min(), ys.max(); x0, x1 = xs.min(), xs.max()
        py = int((y1 - y0) * 0.2); px = int((x1 - x0) * 0.2)
        box = np.zeros_like(tgt)
        box[max(0, y0 - py):min(tgt.shape[0], y1 + py),
            max(0, x0 - px):min(tgt.shape[1], x1 + px)] = True
        hole = occ & box
        rec["occluded_hole_px"] = int(hole.sum())
        if hole.sum() == 0:
            raise ValueError("遮挡区为空（该部件没被遮挡）")
        out = _run_one(f"recover_{args.target}", hole, img)
        # 图层 = 目标可见区 ∪ 补出来的遮挡区，alpha = 二者并集
        alpha = (tgt | hole).astype(np.uint8) * 255
        rgba = np.dstack([out, alpha])
        Image.fromarray(rgba).save(os.path.join(outdir, f"layer_{args.target}_completed.png"))
        # 三联：原图 | 待填区（高亮）| 修补后 —— 三块都必须是 3 通道
        holed = img.copy()
        holed[hole] = 255
        trip = np.concatenate([img, holed, out], axis=1)
        Image.fromarray(trip).save(os.path.join(outdir, f"recover_{args.target}_triple.png"))
        return out

    b = stage("recover_occluded_part", _occluded)

    rec["verdict"] = "跑通" if (a is not None or b is not None) else "两步都失败"
    rec["rss_peak_mb"] = rss_mb()
    if args.device == "mps":
        rec["mps_current_allocated_mb"] = round(torch.mps.current_allocated_memory() / 1e6, 1)
        rec["mps_driver_allocated_mb"] = round(torch.mps.driver_allocated_memory() / 1e6, 1)
    rec["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
    json.dump(rec, open(os.path.join(outdir, "result.json"), "w"), indent=2, ensure_ascii=False)
    print(f"\n结论：{rec['verdict']} | RSS 峰值 {rec['rss_peak_mb']} MB | 产出 {outdir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
