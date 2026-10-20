#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
palette.py — 两侧的「主色表」：把可见像素按颜色聚类，取出现频率最高的前 N 色，给出 RGB + HSV。

用途：真实 PNG 的「主色相」会受到饱和度过低的像素干扰（本脚本模块用 S>=0.15 的门限算色相），
      故这里额外给出**不经门限的**最高频色，用于核对"底色到底是什么颜色、它的色相是多少"。

输出：palette.json
"""
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

REAL = os.path.expanduser("~/Desktop/moye/hfa_png/out/data00000/")
REAL_TARGETS = ["mu_text0", "mu_text1_select_zc", "mu_text1_selecting_zc", "mu_text1_b_select_zc",
                "mu_text1_b_selecting_zc", "back_win", "archive_window_waku", "menu_window",
                "modepanel_window", "archive_txtsentaku", "sel_win", "dialog_win", "nz13LU",
                "kusa1", "archive_line", "mu_bar"]
WARM_TARGETS = ["warm_avalon_s2.png", "warm_reading_v2_ao.png"]
CROPS = ["crop_avalon_s2_band.png", "crop_reading_v2ao_opt.png", "crop_reading_v2ao_dock.png"]


def rgb2hsv(r, g, b):
    mx, mn = max(r, g, b) / 255.0, min(r, g, b) / 255.0
    d = mx - mn
    s = 0.0 if mx == 0 else d / mx
    if d == 0:
        h = 0.0
    elif mx == r / 255.0:
        h = (60 * (((g - b) / 255.0) / d)) % 360
    elif mx == g / 255.0:
        h = 60 * (((b - r) / 255.0) / d) + 120
    else:
        h = 60 * (((r - g) / 255.0) / d) + 240
    return round(h, 1), round(s, 4), round(mx, 4)


def top_colors(path, k=6, min_alpha=1):
    arr = np.asarray(Image.open(path).convert("RGBA"))
    vis = arr[..., 3] >= min_alpha
    px = arr[vis][:, :3].astype(np.uint16)
    if px.size == 0:
        return None
    key = (px[:, 0].astype(np.uint32) << 16) | (px[:, 1].astype(np.uint32) << 8) | px[:, 2]
    uniq, cnt = np.unique(key, return_counts=True)
    order = np.argsort(cnt)[::-1][:k]
    tot = key.size
    out = []
    for i in order:
        v = int(uniq[i])
        r, g, b = (v >> 16) & 255, (v >> 8) & 255, v & 255
        h, s, val = rgb2hsv(r, g, b)
        out.append({"hex": "#%02X%02X%02X" % (r, g, b), "rgb": [r, g, b],
                    "share": round(int(cnt[i]) / tot, 4), "H": h, "S": s, "V": val})
    return {"visible_px": int(tot), "top": out}


if __name__ == "__main__":
    res = {"real": {}, "warm": {}}
    for n in REAL_TARGETS:
        p = os.path.join(REAL, n + ".cbg.png")
        if os.path.exists(p):
            res["real"][n] = top_colors(p)
    for n in WARM_TARGETS + CROPS:
        p = os.path.join(HERE, n)
        if os.path.exists(p):
            res["warm"][n] = top_colors(p)
    with open(os.path.join(HERE, "palette.json"), "w") as f:
        json.dump(res, f, ensure_ascii=False, indent=2)
    for side in ("real", "warm"):
        print("=====", side)
        for k, v in res[side].items():
            if not v:
                continue
            print(f"  {k:26s} " + "  ".join(
                f"{c['hex']}({c['share']*100:.1f}%,H{c['H']},S{c['S']},V{c['V']})" for c in v["top"][:4]))
    print("\nwrote palette.json")
