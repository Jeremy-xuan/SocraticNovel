#!/usr/bin/env python3
"""60_zoom_mouth_evidence.py —— 把嘴部放大成目视证据（闭/开对照 ＋ 嘴层本身）

任务代号 LAYER-MOUTH 步骤 ②/③ 的目视证据件。

输入：50_wire_mouth_to_i2l.py 渲出的 `evidence/50_<tag>_<variant>_mouth_{closed,open}.png`
输出：`evidence/60_zoom_<tag>_<variant>_mouth_x<k>.png`
      —— 左＝ParamMouthOpenY=0，右＝1；放大 k 倍，最近邻，不插值（要看清单个像素）

用法：
  PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python
  $PY scripts/60_zoom_mouth_evidence.py --tag ourasset --variant with_mouth --k 10
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MOUTH_ROOT = os.path.dirname(HERE)
EVID = os.path.join(MOUTH_ROOT, "evidence")
OUT = os.path.join(MOUTH_ROOT, "out")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    ap.add_argument("--variant", default="with_mouth")
    ap.add_argument("--k", type=int, default=10)
    ap.add_argument("--pad", type=int, default=18)
    args = ap.parse_args()

    rec = {"script": "60_zoom_mouth_evidence.py", "tag": args.tag, "variant": args.variant}
    a = Image.open(os.path.join(EVID, f"50_{args.tag}_{args.variant}_mouth_closed.png")).convert("RGBA")
    b = Image.open(os.path.join(EVID, f"50_{args.tag}_{args.variant}_mouth_open.png")).convert("RGBA")
    A = np.array(a).astype(int); B = np.array(b).astype(int)
    diff = (np.abs(A - B).max(axis=2) > 8)
    if diff.sum() == 0:
        rec["verdict"] = "两档渲染完全一致（嘴没动）"
        rec["changed_pixels"] = 0
    else:
        ys, xs = np.nonzero(diff)
        x0, x1 = max(0, xs.min() - args.pad), min(a.width, xs.max() + args.pad)
        y0, y1 = max(0, ys.min() - args.pad), min(a.height, ys.max() + args.pad)
        rec["changed_pixels"] = int(diff.sum())
        rec["changed_bbox_xyxy"] = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
        rec["zoom_box_xyxy"] = [int(x0), int(y0), int(x1), int(y1)]
        k = args.k
        ca = a.crop((x0, y0, x1, y1)).resize(((x1 - x0) * k, (y1 - y0) * k), Image.NEAREST)
        cb = b.crop((x0, y0, x1, y1)).resize(((x1 - x0) * k, (y1 - y0) * k), Image.NEAREST)
        gap = 16
        sheet = Image.new("RGB", (ca.width * 2 + gap, ca.height), (30, 30, 30))
        sheet.paste(ca.convert("RGB"), (0, 0))
        sheet.paste(cb.convert("RGB"), (ca.width + gap, 0))
        p = os.path.join(EVID, f"60_zoom_{args.tag}_{args.variant}_mouth_x{k}.png")
        sheet.save(p)
        rec["zoom_file"] = os.path.relpath(p, MOUTH_ROOT)
        rec["left"] = "ParamMouthOpenY = 0"
        rec["right"] = "ParamMouthOpenY = 1"

    os.makedirs(OUT, exist_ok=True)
    json.dump(rec, open(os.path.join(OUT, f"60_zoom_{args.tag}_{args.variant}.json"), "w"),
              indent=2, ensure_ascii=False)
    print(json.dumps(rec, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
