#!/usr/bin/env python3
"""52_zoom_face.py —— 把脸部件放大 12× 单独看（嘴/眉/眼白/瞳孔/睫毛有没有被切出来）

为什么需要它：低分辨率最该被怀疑的就是**五官这种小部件**——
  · 512² 下整张脸可能只占 ~80 px 宽，嘴可能只有几个像素；
  · 层边缘糊/锯齿在这个尺度上才看得出来。
所以本脚本**不是**看整图，而是：
  ① 用 face/eyewhite/irides/eyebrow/mouth 的 alpha 并集自动框出脸窗；
  ② 把该窗口按 `--zoom`（默认 12）放大，逐部件并排；
  ③ 同时给 SOURCE 与 COMPOSITE 的同窗口做对照。

🔴 每格左上角写**该部件在这个窗口里的 alpha 像素数** —— 数量级本身就是结论
   （个位数像素的"嘴"在 `.moc3` 里没有任何意义）。

用法：
  $PY scripts/52_zoom_face.py --layerdir out/fullcall/full512_q30 --tag full512_q30
"""
import argparse
import json
import os
import os.path as osp

import numpy as np
from PIL import Image, ImageDraw, ImageFont

INPUTS = {"src_img.png", "src_head.png"}
FACE_PARTS = ["face.png", "eyewhite.png", "irides.png", "eyebrow.png", "mouth.png",
              "eyelash.png", "nose.png", "eyewear.png", "ears.png", "headwear.png"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layerdir", required=True)
    ap.add_argument("--tag", default=None)
    ap.add_argument("--zoom", type=int, default=12)
    ap.add_argument("--pad", type=int, default=10, help="脸窗外扩像素")
    args = ap.parse_args()

    tag = args.tag or osp.basename(args.layerdir.rstrip("/"))
    src = np.array(Image.open(osp.join(args.layerdir, "src_img.png")).convert("RGB"))
    H, W = src.shape[:2]

    files = sorted(f for f in os.listdir(args.layerdir)
                   if f.endswith(".png") and f not in INPUTS)
    present_face = [f for f in FACE_PARTS if f in files]

    # ① 脸窗：face/eyewhite/irides/eyebrow/mouth 的 alpha 并集
    union = np.zeros((H, W), dtype=bool)
    for f in ["face.png", "eyewhite.png", "irides.png", "eyebrow.png", "mouth.png", "eyelash.png"]:
        p = osp.join(args.layerdir, f)
        if osp.exists(p):
            union |= (np.array(Image.open(p).convert("RGBA"))[..., 3] > 8)
    if union.any():
        ys, xs = np.where(union)
        y0, y1 = max(ys.min() - args.pad, 0), min(ys.max() + args.pad + 1, H)
        x0, x1 = max(xs.min() - args.pad, 0), min(xs.max() + args.pad + 1, W)
    else:
        y0, x0, y1, x1 = 0, 0, H, W
    # 取正方形窗口（放大后不变形）
    cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
    half = max(y1 - y0, x1 - x0) // 2 + 1
    y0, y1 = max(cy - half, 0), min(cy + half, H)
    x0, x1 = max(cx - half, 0), min(cx + half, W)
    k = min(y1 - y0, x1 - x0)
    y1, x1 = y0 + k, x0 + k

    # ② composite（全层叠回）
    canvas = np.zeros((H, W, 4), dtype=np.float32)
    for f in files:
        lay = np.array(Image.open(osp.join(args.layerdir, f)).convert("RGBA")).astype(np.float32)
        a = lay[..., 3:4] / 255.0
        canvas[..., :3] = lay[..., :3] * a + canvas[..., :3] * (1 - a)
        canvas[..., 3:4] = a + canvas[..., 3:4] * (1 - a)
    comp = canvas[..., :3].clip(0, 255).astype(np.uint8)

    cells = [("SOURCE", src[y0:y1, x0:x1], None), ("COMPOSITE", comp[y0:y1, x0:x1], None)]
    counts = {}
    for f in present_face:
        lay = np.array(Image.open(osp.join(args.layerdir, f)).convert("RGBA"))
        cnt = int((lay[..., 3] > 8).sum())
        counts[f] = cnt
        cells.append((f[:-4], lay[y0:y1, x0:x1, :3], cnt))

    z = args.zoom
    cols = 4
    rows = int(np.ceil(len(cells) / cols))
    cw = k * z
    sheet = Image.new("RGB", (cols * cw, rows * (cw + 24)), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 15)
    except Exception:  # noqa: BLE001
        font = ImageFont.load_default()

    for n, (lab, im, cnt) in enumerate(cells):
        r, c = divmod(n, cols)
        x, y = c * cw, r * (cw + 24)
        sheet.paste(Image.fromarray(im).resize((cw, cw), Image.NEAREST), (x, y + 24))
        txt = lab if cnt is None else f"{lab}   α>8 像素 = {cnt}"
        dr.text((x + 6, y + 4), txt, fill=(255, 255, 255), font=font)

    outdir = osp.join(osp.dirname(osp.abspath(__file__)), "..", "out", "512_layers")
    os.makedirs(outdir, exist_ok=True)
    out = osp.join(outdir, f"face_zoom{args.zoom}x_{tag}.png")
    sheet.save(out)
    meta = {"tag": tag, "face_window": [int(x0), int(y0), int(k)], "zoom": z,
            "alpha_gt8_pixels": counts, "sheet": osp.abspath(out),
            "sheet_size": list(sheet.size),
            "note": "α>8 像素数按整张 512×512 画布统计（不是只算脸窗内）"}
    json.dump(meta, open(osp.join(outdir, f"face_zoom{args.zoom}x_{tag}.json"), "w"),
              indent=2, ensure_ascii=False)
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
