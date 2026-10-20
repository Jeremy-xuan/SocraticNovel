#!/usr/bin/env python3
"""51_composite_compare.py —— 叠回去的 composite 与 SOURCE 并排（**同一张输入图**）

为什么要它：接触表里的缩略图看不出"边缘糊不糊"——糊/锯齿要在 **1:1 原尺寸**下看。
本脚本出三样：
  ① `side_by_side_<tag>.png`：SOURCE | COMPOSITE（全层叠回） | 差值放大 —— 1:1，横向拼接；
  ② `composite_<tag>.png`：只有叠回去的 composite（1:1）；
  ③ `edge_crop_<tag>.png`：把"层边缘最密的地方"裁一块放大（默认 4×），专看锯齿/毛边。

🔴 输入图必须是**同一张**：重型路线的输入 = 上游 `assets/test_image1.png`
   （512² 时先经 `center_square_pad_resize` 成 512×512，落盘为 `src_img.png`）。
   轻量路线的输入也是同一张（`auto-layer/out/sam/sam_mps_test1/input.png`）。

用法：
  $PY scripts/51_composite_compare.py --layerdir out/fullcall/full512_s1 --tag full512_s1
"""
import argparse
import json
import os
import os.path as osp

import numpy as np
from PIL import Image, ImageDraw, ImageFont

INPUTS = {"src_img.png", "src_head.png"}


def composite(files, layerdir, H, W):
    canvas = np.zeros((H, W, 4), dtype=np.float32)
    for f in files:
        lay = np.array(Image.open(osp.join(layerdir, f)).convert("RGBA")).astype(np.float32)
        a = lay[..., 3:4] / 255.0
        canvas[..., :3] = lay[..., :3] * a + canvas[..., :3] * (1 - a)
        canvas[..., 3:4] = a + canvas[..., 3:4] * (1 - a)
    return canvas[..., :3].clip(0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layerdir", required=True)
    ap.add_argument("--tag", default=None)
    ap.add_argument("--zoom", type=int, default=4)
    ap.add_argument("--crop", type=int, default=128, help="边缘裁块的边长（原图像素）")
    args = ap.parse_args()

    tag = args.tag or osp.basename(args.layerdir.rstrip("/"))
    files = sorted(f for f in os.listdir(args.layerdir)
                   if f.endswith(".png") and f not in INPUTS)
    src = np.array(Image.open(osp.join(args.layerdir, "src_img.png")).convert("RGB"))
    H, W = src.shape[:2]
    comp = composite(files, args.layerdir, H, W)
    diff = np.abs(src.astype(np.int16) - comp.astype(np.int16)).astype(np.uint8)

    outdir = osp.join(osp.dirname(osp.abspath(__file__)), "..", "out", "512_layers")
    os.makedirs(outdir, exist_ok=True)

    Image.fromarray(comp).save(osp.join(outdir, f"composite_{tag}.png"))

    # ① 1:1 并排
    gap = 12
    sheet = Image.new("RGB", (W * 3 + gap * 2, H + 26), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 15)
    except Exception:  # noqa: BLE001
        font = ImageFont.load_default()
    for k, (im, lab) in enumerate([(src, f"SOURCE (src_img.png {W}x{H})"),
                                   (comp, f"COMPOSITE ({len(files)} layers)"),
                                   (diff, "|SOURCE-COMPOSITE| x1")]):
        sheet.paste(Image.fromarray(im), (k * (W + gap), 26))
        dr.text((k * (W + gap) + 6, 6), lab, fill=(255, 255, 255), font=font)
    p1 = osp.join(outdir, f"side_by_side_{tag}.png")
    sheet.save(p1)

    # ② 边缘裁块放大：选"层边缘像素最密"的窗口（alpha 0<a<255 的像素最多处）
    edge = np.zeros((H, W), dtype=np.float32)
    for f in files:
        a = np.array(Image.open(osp.join(args.layerdir, f)).convert("RGBA"))[..., 3]
        edge += ((a > 0) & (a < 255)).astype(np.float32)
    k = args.crop
    # 用积分图快速找边缘最多的 k×k 窗口
    ii = np.zeros((H + 1, W + 1), dtype=np.float64)
    ii[1:, 1:] = np.cumsum(np.cumsum(edge, 0), 1)
    if H > k and W > k:
        s = (ii[k:, k:] - ii[:-k, k:] - ii[k:, :-k] + ii[:-k, :-k])
        y0, x0 = np.unravel_index(int(np.argmax(s)), s.shape)
    else:
        y0 = x0 = 0
        k = min(H, W)
    crop_src = src[y0:y0 + k, x0:x0 + k]
    crop_comp = comp[y0:y0 + k, x0:x0 + k]
    z = args.zoom
    big = Image.new("RGB", (k * z * 2 + gap, k * z + 26), (18, 18, 18))
    dr = ImageDraw.Draw(big)
    for kk, (im, lab) in enumerate([(crop_src, f"SOURCE 边缘最密窗口 ({x0},{y0}) x{z}"),
                                    (crop_comp, f"COMPOSITE 同窗口 x{z}")]):
        big.paste(Image.fromarray(im).resize((k * z, k * z), Image.NEAREST),
                  (kk * (k * z + gap), 26))
        dr.text((kk * (k * z + gap) + 6, 6), lab, fill=(255, 255, 255), font=font)
    p2 = osp.join(outdir, f"edge_crop_{tag}.png")
    big.save(p2)

    meta = {"tag": tag, "n_layers": len(files), "size": [W, H],
            "side_by_side": osp.abspath(p1), "edge_crop": osp.abspath(p2),
            "composite": osp.abspath(osp.join(outdir, f"composite_{tag}.png")),
            "edge_crop_window": [int(x0), int(y0), k], "zoom": z,
            "mean_abs_diff": round(float(np.abs(src.astype(np.int16) - comp.astype(np.int16)).mean()), 3)}
    json.dump(meta, open(osp.join(outdir, f"composite_{tag}.json"), "w"),
              indent=2, ensure_ascii=False)
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
