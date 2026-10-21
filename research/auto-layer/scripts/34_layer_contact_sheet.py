#!/usr/bin/env python3
"""34_layer_contact_sheet.py —— 把 {order}_{role}.png 层做成接触表（目视用）

产出：<layerdir>/../contact_sheet.png
  上排：原图 | 全部层叠起来（按 order）
  网格：每一层单独画在棋盘底上（看 alpha 形状对不对、有没有破洞）

用法： $PY scripts/34_layer_contact_sheet.py --layerdir out/layers/light_mps/layers \
        --src out/sam/sam_mps_test1/input.png
"""
import argparse
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def checker(h, w, size=16):
    """棋盘底 —— 用来看 alpha 透明区，比纯黑底清楚"""
    y, x = np.indices((h, w))
    c = (((y // size) + (x // size)) % 2).astype(np.uint8)
    return np.where(c[..., None] == 0, 60, 90).astype(np.uint8).repeat(3, axis=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layerdir", required=True)
    ap.add_argument("--src", required=True)
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--thumb", type=int, default=320)
    args = ap.parse_args()

    files = sorted(f for f in os.listdir(args.layerdir) if f.endswith(".png"))
    src = np.array(Image.open(args.src).convert("RGB"))
    H, W = src.shape[:2]
    scale = args.thumb / max(H, W)
    th, tw = int(H * scale), int(W * scale)

    # 按 order 合成（后画的盖前面）
    canvas = np.zeros((H, W, 4), dtype=np.float32)
    for f in files:
        lay = np.array(Image.open(os.path.join(args.layerdir, f)).convert("RGBA")).astype(np.float32)
        a = (lay[..., 3:4] / 255.0)
        canvas[..., :3] = lay[..., :3] * a + canvas[..., :3] * (1 - a)
        canvas[..., 3:4] = a + canvas[..., 3:4] * (1 - a)
    comp = canvas[..., :3].clip(0, 255).astype(np.uint8)

    cols = args.cols
    rows = int(np.ceil(len(files) / cols))
    top = th
    sheet = Image.new("RGB", (max(cols, 2) * tw, top + 20 + rows * (th + 26)), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 15)
    except Exception:  # noqa: BLE001
        font = ImageFont.load_default()

    for k, (im, lab) in enumerate([(src, "SOURCE"), (comp, "COMPOSITE (all layers)")]):
        sheet.paste(Image.fromarray(im).resize((tw, th), Image.LANCZOS), (k * tw, 20))
        dr.text((k * tw + 6, 3), lab, fill=(255, 255, 255), font=font)

    for n, f in enumerate(files):
        r, c = divmod(n, cols)
        x, y = c * tw, top + 20 + r * (th + 26)
        lay = np.array(Image.open(os.path.join(args.layerdir, f)).convert("RGBA"))
        a = (lay[..., 3:4] / 255.0)
        bg = checker(H, W)
        rgb = (lay[..., :3] * a + bg * (1 - a)).clip(0, 255).astype(np.uint8)
        sheet.paste(Image.fromarray(rgb).resize((tw, th), Image.LANCZOS), (x, y + 22))
        cov = float((lay[..., 3] > 0).mean()) * 100
        dr.text((x + 6, y + 3), f"{f}  alpha {cov:.1f}%", fill=(225, 225, 225), font=font)

    out = os.path.join(os.path.dirname(args.layerdir.rstrip("/")), "contact_sheet.png")
    sheet.save(out)
    print(f"contact_sheet -> {out}  ({sheet.size[0]}x{sheet.size[1]})  层数 {len(files)}")


if __name__ == "__main__":
    main()
