#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
row_structure.py — 选项行（517x64）的结构解析：花饰位置、中段可拉伸区、跨家族差异。

方法：
A) 逐列剖面 col_val / col_sat / col_alpha：对单格按列求均值，用「列与全局中位列」的
   RGB 欧氏距离 dev(x) 定位「与中段不同」的列段 → 即花饰/端饰所在列区间。
   判据：dev(x) > 3 * median(dev) 记为显著列；取显著列的连续区段。
B) 中段可拉伸性：找最长连续列区间，使该区间内每列的均值 RGB 与该区间中位 RGB 的
   最大欧氏距离 <= 8/255 → 即「横向 9-slice 可拉伸的中央区」。
C) 跨家族 alpha 差异：逐像素比较 mu_text0 的 4 行与 mu_text1/2/3 的首格。

输出：row_structure.json
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

REAL = os.path.expanduser("~/Desktop/moye/hfa_png/out/data00000/")


def load(n):
    return np.asarray(Image.open(os.path.join(REAL, n + ".cbg.png")).convert("RGBA"))


def cell(name, r=0, c=0):
    """按实测网格取格：y 带 pitch 72 / 高 64，x 带 pitch 528 / 宽 517，起点 (8,8)。"""
    a = load(name)
    y0 = 8 + 72 * r
    x0 = 8 + 528 * c
    return a[y0:y0 + 64, x0:x0 + 517]


def dev_profile(g):
    """列剖面偏差：每列中位 RGB 与全图中位 RGB 的欧氏距离（0..441）"""
    rgb = g[..., :3].astype(np.float32)
    colmed = np.median(rgb, axis=0)            # 64x3 -> 按列取中位 = (W,3)
    gmed = np.median(colmed, axis=0)
    dev = np.sqrt(((colmed - gmed) ** 2).sum(axis=1))
    return dev, colmed


def runs(mask):
    out, s = [], None
    for i, v in enumerate(mask):
        if v and s is None:
            s = i
        elif not v and s is not None:
            out.append([int(s), int(i)])
            s = None
    if s is not None:
        out.append([int(s), int(len(mask))])
    return out


def stretch_mid(colmed, tol=8.0):
    """最长连续区间：每列与区间中位色的最大欧氏距离 <= tol"""
    W = colmed.shape[0]
    best = [0, 0]
    for i in range(W):
        j = i
        while j < W:
            seg = colmed[i:j + 1]
            m = np.median(colmed[i:j + 1], axis=0)
            if np.sqrt(((seg - m) ** 2).sum(axis=1)).max() <= tol:
                j += 1
            else:
                break
        if j - i > best[1] - best[0]:
            best = [i, j]
    return best


if __name__ == "__main__":
    out = {}
    families = ["mu_text0", "mu_text1_select_zc", "mu_text2_select_zc", "mu_text3_select_zc"]
    for fam in families:
        rows = 4 if fam == "mu_text0" else 14
        rec = {"rows_analyzed": rows, "per_row": []}
        for r in range(rows):
            g = cell(fam, r, 0)
            vis = g[..., 3] > 0
            if vis.sum() == 0:
                rec["per_row"].append({"row": r, "empty": True})
                continue
            dev, colmed = dev_profile(g)
            thr = 3.0 * float(np.median(dev))
            sig = runs(dev > thr)
            mid = stretch_mid(colmed)
            rec["per_row"].append({
                "row": r,
                "dev_median": round(float(np.median(dev)), 2),
                "dev_threshold": round(thr, 2),
                "dev_sig_runs": [x for x in sig if x[1] - x[0] >= 2],
                "stretch_mid_cols": mid,
                "stretch_mid_frac_of_width": round((mid[1] - mid[0]) / g.shape[1], 4),
                "col_val_median_first8": [round(float(v), 3) for v in
                                          np.median(g[vis][:8], axis=0)[:1]] if vis.sum() else None,
            })
        out[fam] = rec

    # 跨家族 alpha 差异（首格两两）
    base = cell("mu_text0", 0, 0)
    for fam in families:
        g = cell(fam, 0, 0)
        d = np.abs(base[..., 3].astype(int) - g[..., 3].astype(int))
        out.setdefault("alpha_diff_vs_mu_text0_row0", {})[fam] = {
            "diff_pixels": int((d != 0).sum()),
            "diff_pixels_total": int(d.size),
            "diff_frac": round(float((d != 0).mean()), 5),
            "max_abs_delta": int(d.max()),
            "mean_alpha": round(float(g[..., 3].mean()), 3),
        }
    out["alpha_diff_vs_mu_text0_row0"]["mu_text0"] = {
        "diff_pixels": 0, "diff_pixels_total": int(base[..., 3].size), "diff_frac": 0.0,
        "max_abs_delta": 0, "mean_alpha": round(float(base[..., 3].mean()), 3)}

    # 非空格计数（每个 mu_text1 家族）
    for fam in ["mu_text1_select_zc", "mu_text1_selecting_zc", "mu_text1_b_select_zc",
                "mu_text1_b_selecting_zc"]:
        a = load(fam)
        nz = 0
        tot = 0
        for r in range(14):
            for c in range(2):
                tot += 1
                if (a[8 + 72 * r:8 + 72 * r + 64, 8 + 528 * c:8 + 528 * c + 517, 3] > 0).sum() > 0:
                    nz += 1
        out.setdefault("nonempty_cells", {})[fam] = {"nonempty": nz, "slots": tot}

    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "row_structure.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    for fam in families:
        pl = out[fam]["per_row"]
        print(f"--- {fam} ({len(pl)} rows) ---")
        for p in pl:
            if p.get("empty"):
                print(f"  row{p['row']:2d} EMPTY")
            else:
                print(f"  row{p['row']:2d} dev_med={p['dev_median']:7.2f} thr={p['dev_threshold']:7.2f} "
                      f"sig_runs={p['dev_sig_runs']} mid={p['stretch_mid_cols']} "
                      f"mid_frac={p['stretch_mid_frac_of_width']}")
    print("--- alpha diff vs mu_text0 row0 ---")
    for k, v in out["alpha_diff_vs_mu_text0_row0"].items():
        print(f"  {k:26s} diff_frac={v['diff_frac']} maxΔ={v['max_abs_delta']} mean_alpha={v['mean_alpha']}")
    print("--- nonempty cells ---")
    for k, v in out["nonempty_cells"].items():
        print(f"  {k:26s} {v['nonempty']}/{v['slots']}")
    print("\nwrote row_structure.json")
