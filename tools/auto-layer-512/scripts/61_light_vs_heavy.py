#!/usr/bin/env python3
"""61_light_vs_heavy.py —— 轻量路线 vs 重型 512² 的**目视正面对照**（同一张输入图）

产出两张图：
  ① `light_vs_heavy_full_<tag>.png`：SOURCE | 轻量 composite | 重型 composite（并排）
  ② `light_vs_heavy_face_<tag>.png`：**脸窗放大 `--zoom` 倍**的同一组三格
     —— 这是"512² 的层到底能不能用"最该看的一张：分辨率损失全在五官上。

🔴 坐标系必须写清楚（否则会被误读）：
  · 轻量路线的层 = **原图分辨率**（本图 928×1232）；
  · 重型 512² 的**所有**层（body 组与 head 组**一样**）= **512×512 的同一张画布**，
    整幅 1232 px 的立绘被 `center_square_pad_resize` 缩进 512。
  → 所以并排图里的"重型"是**按原图尺寸显示的**：即 **2.41× 上采样后的样子**
    （**这正是产品里会发生的事** —— 低分辨率层要被放大到立绘尺寸用），不是造假。
  ⚠️ 一个曾经踩过的误判：head 组**不是**"贴回原图比例"——它的输出同样落在 512 画布坐标系里
    （只是 head 组是在 512² 画布上渲染**裁剪后的头部**，等效过采样约 5×，再降采样进 512 画布）。

用法：
  PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python
  $PY scripts/61_light_vs_heavy.py --heavy out/fullcall/full512_q30 --heavy-tag full512_q30 \
      --light ../auto-layer/out/layers/light_mps/layers --src ../auto-layer/out/sam/sam_mps_test1/input.png
"""
import argparse
import json
import os
import os.path as osp

import numpy as np
from PIL import Image, ImageDraw, ImageFont

INPUTS = {"src_img.png", "src_head.png"}


def composite_dir(layerdir, W, H):
    canvas = np.zeros((H, W, 4), dtype=np.float32)
    files = sorted(f for f in os.listdir(layerdir) if f.endswith(".png") and f not in INPUTS)
    for f in files:
        lay = np.array(Image.open(osp.join(layerdir, f)).convert("RGBA"))
        if lay.shape[0] != H or lay.shape[1] != W:
            lay = np.array(Image.fromarray(lay).resize((W, H), Image.LANCZOS))
        lay = lay.astype(np.float32)
        a = lay[..., 3:4] / 255.0
        canvas[..., :3] = lay[..., :3] * a + canvas[..., :3] * (1 - a)
        canvas[..., 3:4] = a + canvas[..., 3:4] * (1 - a)
    return canvas[..., :3].clip(0, 255).astype(np.uint8), files


def face_window(lightdir, W, H, pad=24):
    """用轻量路线的 face + eyes 掩码定脸窗（它在原图坐标系里，最可靠）"""
    u = np.zeros((H, W), dtype=bool)
    for f in ("030_face.png", "060_eyes_l.png", "060_eyes_r.png", "055_ears.png"):
        p = osp.join(lightdir, f)
        if osp.exists(p):
            a = np.array(Image.open(p).convert("RGBA"))[..., 3]
            u |= (a > 8)
    if not u.any():
        return 0, 0, min(H, W)
    ys, xs = np.where(u)
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, H)
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, W)
    cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
    half = max(y1 - y0, x1 - x0) // 2 + 1
    y0, y1 = max(cy - half, 0), min(cy + half, H)
    x0, x1 = max(cx - half, 0), min(cx + half, W)
    k = min(y1 - y0, x1 - x0)
    return x0, y0, k


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--heavy", required=True)
    ap.add_argument("--heavy-tag", default="heavy")
    ap.add_argument("--light", required=True)
    ap.add_argument("--src", required=True)
    ap.add_argument("--zoom", type=int, default=4)
    ap.add_argument("--outdir", default="out/512_layers")
    args = ap.parse_args()

    src = np.array(Image.open(args.src).convert("RGB"))
    H, W = src.shape[:2]
    light, lfiles = composite_dir(args.light, W, H)
    heavy, hfiles = composite_dir(args.heavy, W, H)

    os.makedirs(args.outdir, exist_ok=True)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 16)
    except Exception:  # noqa: BLE001
        font = ImageFont.load_default()

    # ① 全图并排
    gap = 12
    sheet = Image.new("RGB", (W * 3 + gap * 2, H + 28), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    for k, (im, lab) in enumerate([(src, f"SOURCE ({W}x{H})"),
                                   (light, f"轻量 SAM+LaMa composite ({len(lfiles)} 层, 原图分辨率)"),
                                   (heavy, f"重型 512² composite ({len(hfiles)} 层, 512→{W} 上采样)")]):
        sheet.paste(Image.fromarray(im), (k * (W + gap), 28))
        dr.text((k * (W + gap) + 6, 6), lab, fill=(255, 255, 255), font=font)
    p1 = osp.join(args.outdir, f"light_vs_heavy_full_{args.heavy_tag}.png")
    sheet.save(p1)

    # ② 脸窗放大
    x0, y0, k = face_window(args.light, W, H)
    z = args.zoom
    big = Image.new("RGB", (k * z * 3 + gap * 2, k * z + 28), (18, 18, 18))
    dr = ImageDraw.Draw(big)
    for j, (im, lab) in enumerate([(src, f"SOURCE 脸窗 ({x0},{y0},{k}) x{z}"),
                                   (light, f"轻量 x{z}"),
                                   (heavy, f"重型 512² x{z}")]):
        crop = im[y0:y0 + k, x0:x0 + k]
        big.paste(Image.fromarray(crop).resize((k * z, k * z), Image.NEAREST),
                  (j * (k * z + gap), 28))
        dr.text((j * (k * z + gap) + 6, 6), lab, fill=(255, 255, 255), font=font)
    p2 = osp.join(args.outdir, f"light_vs_heavy_face_{args.heavy_tag}.png")
    big.save(p2)

    meta = {"heavy_tag": args.heavy_tag,
            "light_layers": lfiles, "heavy_layers": hfiles,
            "light_n": len(lfiles), "heavy_n": len(hfiles),
            "face_window": [int(x0), int(y0), int(k)], "zoom": z,
            "full_sheet": osp.abspath(p1), "face_sheet": osp.abspath(p2),
            "note": "重型的 body 层是 512×512，本图按原图尺寸 2.41× 上采样后并排（产品里的真实情形）"}
    json.dump(meta, open(osp.join(args.outdir, f"light_vs_heavy_{args.heavy_tag}.json"), "w"),
              indent=2, ensure_ascii=False)
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
