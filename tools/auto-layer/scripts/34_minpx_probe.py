#!/usr/bin/env python3
"""34_minpx_probe.py —— 出层阈值 `--min-px` 的实测：降阈值会放进什么？

任务代号 MOUTH-FIX 步骤 ①-1 的证据脚本。回答两个问题，都用**实测数字**：

  ① 每个部件在 SAM 掩码里被切成几个连通域、各多大？——决定"能不能用一刀切阈值"。
  ② 若把阈值从 200 降到 X，**新进来的是真部件还是碎块**？——决定"降阈值会不会带来新噪声"。

判据（不是拍脑袋）：
  · 「真部件」= 该部件的主连通域本身（面积最大者）**或其近邻**；
  · 「碎块」= 远离主连通域的小连通域（沿用 image2live2d `core/decompose/denoise.py` 的
    相对判据：以主连通域外接框的跨度 span 为单位，距离 > FAR_FRAC 个 span 的算散落）。
    🔴 本脚本只做**测量**，不改任何掩码。

用法：
  PY="${AUTO_LAYER_PY:-${AUTO_LAYER_SCRATCH:-$HOME/dsh-scratch/auto-layer}/venv/bin/python}"
  $PY scripts/34_minpx_probe.py --samdir out/sam/sam_mps_ourasset --out out/probe/minpx_ourasset.json
"""
import argparse
import json
import os

import cv2
import numpy as np
from PIL import Image

LABELS = ['hair', 'headwear', 'face', 'eyes', 'eyewear', 'ears', 'earwear', 'nose',
          'mouth', 'neck', 'neckwear', 'topwear', 'handwear', 'bottomwear', 'legwear',
          'footwear', 'tail', 'wings', 'objects']
# 照 image2live2d core/decompose/denoise.py 的相对判据
FAR_FRAC = 1.0
CORE_FRAC = 0.25
# 探测的阈值阶梯（覆盖 200 与各种降法）
LADDER = [200, 128, 64, 32, 24, 16, 8]


def components(mask_bool):
    n, labels, stats, cents = cv2.connectedComponentsWithStats(
        mask_bool.astype(np.uint8), connectivity=8)
    comps = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        comps.append({"area": int(area), "bbox": [int(x), int(y), int(x + w - 1), int(y + h - 1)],
                      "centroid": [round(float(cents[i][0]), 1), round(float(cents[i][1]), 1)]})
    comps.sort(key=lambda c: -c["area"])
    return comps


def classify(comps):
    """按 denoise.py 的相对判据把每个连通域标成 content / scatter。"""
    if not comps:
        return []
    biggest = comps[0]["area"]
    core = [c for c in comps if c["area"] >= CORE_FRAC * biggest]
    hx0 = min(c["bbox"][0] for c in core); hy0 = min(c["bbox"][1] for c in core)
    hx1 = max(c["bbox"][2] for c in core); hy1 = max(c["bbox"][3] for c in core)
    span = max(hx1 - hx0, hy1 - hy0, 1)
    out = []
    for c in comps:
        if c in core:
            out.append({**c, "kind": "content", "dist_spans": 0.0})
            continue
        x0, y0, x1, y1 = c["bbox"]
        dx = max(hx0 - x1, 0, x0 - hx1)
        dy = max(hy0 - y1, 0, y0 - hy1)
        dist = (dx * dx + dy * dy) ** 0.5
        kind = "content" if (c["area"] >= 0.02 * biggest and dist <= FAR_FRAC * span) else "scatter"
        out.append({**c, "kind": kind, "dist_spans": round(dist / span, 2)})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samdir", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    mdir = os.path.join(args.samdir, "masks")
    rec = {"script": "34_minpx_probe.py", "samdir": os.path.abspath(args.samdir),
           "ladder": LADDER, "far_frac": FAR_FRAC, "core_frac": CORE_FRAC, "parts": {}}

    for f in sorted(os.listdir(mdir)):
        if not f.endswith(".png"):
            continue
        label = LABELS[int(f.split("_")[0])]
        a = np.array(Image.open(os.path.join(mdir, f)).convert("RGBA"))[..., 3]
        m = a > 127
        if not m.any():
            rec["parts"][label] = {"total_px": 0, "n_comp": 0, "comps": []}
            continue
        comps = classify(components(m))
        rec["parts"][label] = {
            "total_px": int(m.sum()),
            "n_comp": len(comps),
            "comps": comps[:12],
            "admit_by_threshold": {
                str(t): {
                    "n_comp": sum(1 for c in comps if c["area"] >= t),
                    "px": sum(c["area"] for c in comps if c["area"] >= t),
                    "new_vs_200": [{"area": c["area"], "kind": c["kind"],
                                    "dist_spans": c["dist_spans"], "bbox": c["bbox"]}
                                   for c in comps if t <= c["area"] < 200],
                } for t in LADDER
            },
        }

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as fh:
        json.dump(rec, fh, indent=2, ensure_ascii=False)

    print(f"=== min-px 阈值实测 | {args.samdir} ===")
    for label, d in rec["parts"].items():
        if d["total_px"] == 0:
            continue
        print(f"\n{label:10s} 总 {d['total_px']:7d} px  {d['n_comp']} 个连通域")
        for c in d["comps"][:6]:
            print(f"    {c['area']:7d} px  {c['kind']:8s} dist={c['dist_spans']:6.2f} span  bbox={c['bbox']}")
        for t in LADDER:
            ad = d["admit_by_threshold"][str(t)]
            news = ad["new_vs_200"]
            tag = "" if not news else "  新增: " + ", ".join(
                f"{n['area']}px/{n['kind']}/d={n['dist_spans']}" for n in news[:6])
            print(f"    阈值 {t:4d} → {ad['n_comp']:2d} 块 / {ad['px']:7d} px{tag}")
    print(f"\n产出：{args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
