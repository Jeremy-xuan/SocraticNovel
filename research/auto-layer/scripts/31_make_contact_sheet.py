#!/usr/bin/env python3
"""31_make_contact_sheet.py —— 把 SAM 的 19 类掩码做成可目视的接触表

为什么自己画而不复用上游 `utils.visualize.visualize_segs_with_labels`：
该函数在本机返回的数组元素数是期望的 4 倍（`Image.fromarray` 报
`cannot reshape array of size 18292736 into shape (1232,928,4)`），
属上游可视化函数的形状约定问题，与 MPS 无关；本脚本只做展示，不改上游。

产出（每个 run 目录下）：
  contact_sheet.png   原图 | 彩色叠加 | 逐类掩码网格（能一眼看出分层对不对）
  overlay.png         原图 + 半透明彩色语义叠加
用法： $PY scripts/31_make_contact_sheet.py --rundir out/sam/sam_mps_test1
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "vendor", "see-through", "common"))

LABELS = ['hair', 'headwear', 'face', 'eyes', 'eyewear', 'ears', 'earwear', 'nose',
          'mouth', 'neck', 'neckwear', 'topwear', 'handwear', 'bottomwear', 'legwear',
          'footwear', 'tail', 'wings', 'objects']

# 高对比调色板（19 类）
PALETTE = np.array([
    (230, 60, 60), (60, 200, 120), (250, 200, 60), (70, 130, 240), (200, 80, 220),
    (240, 140, 40), (40, 210, 210), (160, 110, 70), (250, 100, 170), (120, 200, 70),
    (150, 150, 250), (250, 250, 90), (90, 90, 90), (200, 160, 250), (60, 160, 90),
    (250, 120, 120), (100, 200, 250), (220, 220, 220), (170, 90, 40),
], dtype=np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rundir", required=True)
    ap.add_argument("--alpha", type=float, default=0.55)
    args = ap.parse_args()

    d = args.rundir
    res = json.load(open(os.path.join(d, "result.json")))
    img = np.array(Image.open(os.path.join(d, "input.png")).convert("RGB"))
    H, W = img.shape[:2]

    # 从导出的掩码 PNG 重建 (19,H,W) 布尔张量
    mdir = os.path.join(d, "masks")
    masks = np.zeros((19, H, W), dtype=bool)
    present = []
    for f in sorted(os.listdir(mdir)):
        if not f.endswith(".png"):
            continue
        idx = int(f.split("_")[0])
        a = np.array(Image.open(os.path.join(mdir, f)).convert("RGBA"))[..., 3]
        masks[idx] = a > 127
        present.append(idx)

    # ---- 彩色叠加 ----
    ov = img.astype(np.float32).copy()
    for i in present:
        c = PALETTE[i].astype(np.float32)
        m = masks[i]
        ov[m] = ov[m] * (1 - args.alpha) + c * args.alpha
    ov = ov.clip(0, 255).astype(np.uint8)
    Image.fromarray(ov).save(os.path.join(d, "overlay.png"))

    # ---- 接触表：上排 原图 + 叠加；下面逐类网格 ----
    cols = 5
    rows_grid = int(np.ceil(len(present) / cols))
    thumb = 300
    scale = thumb / max(H, W)
    th, tw = int(H * scale), int(W * scale)

    top_h = th
    grid_h = rows_grid * (th + 26)
    sheet = Image.new("RGB", (cols * tw, top_h + grid_h + 40), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 16)
    except Exception:  # noqa: BLE001
        font = ImageFont.load_default()

    # 上排两格：原图 / 叠加
    for k, (im, lab) in enumerate([(img, "INPUT"), (ov, "SEMANTIC OVERLAY (19-class)")]):
        t = Image.fromarray(im).resize((tw, th), Image.LANCZOS)
        sheet.paste(t, (k * tw, 20))
        dr.text((k * tw + 6, 4), lab, fill=(255, 255, 255), font=font)

    # 网格
    for n, i in enumerate(present):
        r, c = divmod(n, cols)
        y = top_h + 20 + r * (th + 26)
        x = c * tw
        m = masks[i]
        iso = np.zeros((H, W, 3), dtype=np.uint8)
        iso[..., :] = 24
        iso[m] = PALETTE[i]
        t = Image.fromarray(iso).resize((tw, th), Image.NEAREST)
        sheet.paste(t, (x, y + 22))
        px = int(m.sum())
        dr.text((x + 6, y + 2), f"{i:02d} {LABELS[i]}  {px}px", fill=(230, 230, 230), font=font)

    p = os.path.join(d, "contact_sheet.png")
    sheet.save(p)
    print(f"contact_sheet -> {p}  ({sheet.size[0]}x{sheet.size[1]})")
    print(f"overlay       -> {os.path.join(d, 'overlay.png')}")
    print(f"类别 {len(present)}/19 命中：{[LABELS[i] for i in present]}")
    # 覆盖率（用于判断"是不是只分出一小块"）
    cover = float(masks.any(axis=0).sum()) / (H * W)
    print(f"语义像素覆盖率 {cover*100:.1f}%（{int(masks.any(axis=0).sum())}/{H*W}）")


if __name__ == "__main__":
    main()
