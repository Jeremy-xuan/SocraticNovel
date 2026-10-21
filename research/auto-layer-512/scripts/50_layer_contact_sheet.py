#!/usr/bin/env python3
"""50_layer_contact_sheet.py —— 重型 512² 完整 call 出层的「层接触表」（含 alpha）

与轻量路线那张（`auto-layer/scripts/34_layer_contact_sheet.py`）的差别：
  ① 上游出层的文件名是**原始 tag**（`front hair.png` / `mouth.png` …），**不是** `{order}_{role}`；
  ② 目录里还混着两张**输入图**（`src_img.png` / `src_head.png`）——它们不是层，必须排除；
  ③ 本表**多给一列 alpha**：低分辨率最该怀疑的就是"边缘糊/锯齿"，而边缘质量首先体现在
     alpha 通道的形状上 → RGB 叠棋盘看颜色，alpha 灰度图看边缘。

产出：<out>/512_layers/contact_sheet.png

用法：
  PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python
  $PY scripts/50_layer_contact_sheet.py --layerdir out/fullcall/full512_s1
"""
import argparse
import json
import os
import os.path as osp

import numpy as np
from PIL import Image, ImageDraw, ImageFont

INPUTS = {"src_img.png", "src_head.png"}   # 🔴 输入图，不是层


def checker(h, w, size=16):
    y, x = np.indices((h, w))
    c = (((y // size) + (x // size)) % 2).astype(np.uint8)
    return np.where(c[..., None] == 0, 60, 90).astype(np.uint8).repeat(3, axis=2)


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
    ap.add_argument("--cols", type=int, default=6)
    ap.add_argument("--thumb", type=int, default=300)
    args = ap.parse_args()

    tag = args.tag or osp.basename(args.layerdir.rstrip("/"))
    files = sorted(f for f in os.listdir(args.layerdir)
                   if f.endswith(".png") and f not in INPUTS)
    src_p = osp.join(args.layerdir, "src_img.png")
    src = np.array(Image.open(src_p).convert("RGB")) if osp.exists(src_p) else None
    H = W = None
    for f in files:
        H, W = np.array(Image.open(osp.join(args.layerdir, f))).shape[:2]
        break
    if src is None:
        raise SystemExit("缺 src_img.png，无法定尺寸")

    comp = composite(files, args.layerdir, H, W)
    cov = {}
    for f in files:
        a = np.array(Image.open(osp.join(args.layerdir, f)).convert("RGBA"))[..., 3]
        cov[f] = round(float((a > 0).mean()) * 100, 2)

    scale = args.thumb / max(H, W)
    th, tw = int(H * scale), int(W * scale)
    cols = args.cols
    rows = int(np.ceil(len(files) / cols))
    # 顶部两行：SOURCE | COMPOSITE（并排）＋ 每层的 RGB/alpha 两列
    header_h = 22
    top_h = th + header_h
    cell_w, cell_h = tw, th + header_h
    sheet = Image.new("RGB", (max(cols, 4) * tw, top_h + rows * cell_h), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 15)
        font_s = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 12)
    except Exception:  # noqa: BLE001
        font = font_s = ImageFont.load_default()

    sheet.paste(Image.fromarray(src).resize((tw, th), Image.LANCZOS), (0, header_h))
    dr.text((6, 3), f"SOURCE ({W}x{H})", fill=(255, 255, 255), font=font)
    sheet.paste(Image.fromarray(comp).resize((tw, th), Image.LANCZOS), (tw, header_h))
    dr.text((tw + 6, 3), f"COMPOSITE 全层叠回 ({len(files)} 层)", fill=(255, 255, 255), font=font)

    for n, f in enumerate(files):
        r, c = divmod(n, cols)
        x, y = c * tw, top_h + r * cell_h
        lay = np.array(Image.open(osp.join(args.layerdir, f)).convert("RGBA"))
        a = lay[..., 3:4] / 255.0
        bg = checker(H, W)
        rgb = (lay[..., :3] * a + bg * (1 - a)).clip(0, 255).astype(np.uint8)
        # 左半 RGB（叠棋盘），右半 alpha 灰度 —— 同一格里左右对照看边缘
        cell = np.concatenate([rgb[:, : W // 2], np.repeat(lay[:, W // 2:, 3:4], 3, axis=2)], axis=1)
        sheet.paste(Image.fromarray(cell).resize((tw, th), Image.LANCZOS), (x, y + header_h))
        dr.text((x + 6, y + 4), f"{f[:-4]}  α {cov[f]:.1f}%", fill=(225, 225, 225), font=font_s)

    outdir = osp.join(osp.dirname(osp.abspath(__file__)), "..", "out", "512_layers")
    os.makedirs(outdir, exist_ok=True)
    out = osp.join(outdir, f"contact_sheet_{tag}.png")
    sheet.save(out)
    meta = {"tag": tag, "layerdir": osp.abspath(args.layerdir), "layers": files,
            "n_layers": len(files), "size": [W, H], "alpha_coverage_pct": cov,
            "sheet": osp.abspath(out), "sheet_size": list(sheet.size)}
    json.dump(meta, open(osp.join(outdir, f"contact_sheet_{tag}.json"), "w"),
              indent=2, ensure_ascii=False)
    print(f"contact_sheet -> {out}  ({sheet.size[0]}x{sheet.size[1]})  层数 {len(files)}")
    print("层：" + ", ".join(files))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
