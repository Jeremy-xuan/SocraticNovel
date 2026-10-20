#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extract_cells.py — 从 atlas 型 PNG 里按「alpha 投影分段」自动切出单格，再逐格用 measure_png 量。

分段规则：把 alpha>0 掩膜沿某轴投影，投影 >0 的连续区间视为一条带；
滤掉长度 <2 的碎片（1px 抗锯齿噪声）。不做任何人工指定 —— 段落数即实测结构。

输出：cells.json（每格的四项读数 + 网格几何）
用法：python3 extract_cells.py
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from measure_png import measure  # noqa: E402

REAL = os.path.expanduser("~/Desktop/moye/hfa_png/out/data00000/")
TARGETS = [
    "mu_text1_select_zc",
    "mu_text1_selecting_zc",
    "mu_text1_b_select_zc",
    "mu_text1_b_selecting_zc",
    "mu_text0",
    "back_win",
    "archive_window_waku",
    "menu_window",
    "modepanel_window",
    "archive_txtsentaku",
]


def segments(proj):
    on = proj > 0
    out = []
    s = None
    for i, v in enumerate(on):
        if v and s is None:
            s = i
        elif not v and s is not None:
            if i - s >= 2:
                out.append((s, i))
            s = None
    if s is not None and len(on) - s >= 2:
        out.append((s, len(on)))
    return out


def analyze(name):
    p = os.path.join(REAL, name + ".cbg.png")
    arr = np.asarray(Image.open(p).convert("RGBA"))
    vis = arr[..., 3] > 0
    ys = segments(vis.sum(axis=1))
    xs = segments(vis.sum(axis=0))
    rec = {
        "file": name + ".cbg.png",
        "canvas": [int(arr.shape[1]), int(arr.shape[0])],
        "whole": measure(p),
        "y_bands": ys,
        "x_bands": xs,
        "y_band_height": [b - a for a, b in ys],
        "x_band_width": [b - a for a, b in xs],
        "cells": [],
    }
    for r, (y0, y1) in enumerate(ys):
        for c, (x0, x1) in enumerate(xs):
            sub = arr[y0:y1, x0:x1]
            m = measure(sub)
            m["cell_rc"] = [r, c]
            m["cell_box_xyxy"] = [int(x0), int(y0), int(x1), int(y1)]
            rec["cells"].append(m)
    return rec


if __name__ == "__main__":
    out = {}
    for n in TARGETS:
        out[n] = analyze(n)
        r = out[n]
        print(f"{n:26s} canvas={r['canvas']} ybands={len(r['y_bands'])} xbands={len(r['x_bands'])} "
              f"cell={r['x_band_width'][0] if r['x_band_width'] else '-'}x{r['y_band_height'][0] if r['y_band_height'] else '-'}")
        for m in r["cells"]:
            def f(x):
                return "empty" if x is None else (f"{x:.5f}" if isinstance(x, float) else str(x))
            print(f"    [{m['cell_rc'][0]},{m['cell_rc'][1]}] {m['W']}x{m['H']} "
                  f"a>0={m['alpha_ratio_gt0']:.4f} outl={f(m['outline_ratio_visible'])} "
                  f"strk={f(m['stroke_ratio_visible'])} hue={m.get('hue_circ_median_deg')} "
                  f"sat={m.get('sat_median')} val={m.get('val_median')} rgb={m.get('rgb_mean_visible')}")
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "cells.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("\nwrote cells.json")
