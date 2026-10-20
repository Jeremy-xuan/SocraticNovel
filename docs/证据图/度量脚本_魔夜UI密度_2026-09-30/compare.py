#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compare.py — 把「真实魔夜」与「暖纸样稿」的实测读数并排成差距表。

原则：本脚本**只做算术与并排**，不引入任何新判据、不做审美评述。
所有输入都来自同目录下由 measure_png / extract_cells / measure_warm 落下的 JSON。

额外量两条"无文字干扰"的条带（真实 back_win 无文字，暖纸版的空纸区无文字），
用于把「文字带来的梯度」与「装饰带来的梯度」分开：
  - 暖纸：avalon-warm ?screen=2 的 .band 右上空纸区（无文字）
  - 暖纸：avalon-warm ?screen=2 的 .band 顶部 7px（唯一的装饰条：1px 金线 + 中央菱形）
"""
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RENDER = os.path.join(HERE, "render")
sys.path.insert(0, HERE)
from measure_png import measure  # noqa: E402


def strip(png, box, key, out):
    im = Image.open(os.path.join(RENDER, png))
    x0, y0, x1, y1 = box
    x0 = max(0, x0); y0 = max(0, y0); x1 = min(im.width, x1); y1 = min(im.height, y1)
    if x1 - x0 < 2 or y1 - y0 < 2:
        out[key] = {"error": "degenerate", "box": box}
        return
    p = os.path.join(HERE, f"strip_{key}.png")
    im.crop((x0, y0, x1, y1)).convert("RGBA").save(p)
    r = measure(p)
    r["box_xyxy"] = [x0, y0, x1, y1]
    r["source"] = png
    out[key] = r


def main():
    real = json.load(open(os.path.join(HERE, "real.json")))
    cells = json.load(open(os.path.join(HERE, "cells.json")))
    warm = json.load(open(os.path.join(HERE, "warm.json")))

    strips = {}
    # 暖纸：avalon-warm ?screen=2 的 .band = x0..1920, y560..1080
    strip("warm_avalon_s2.png", (1400, 640, 1900, 1075), "warm_s2_band_right_blank", strips)
    strip("warm_avalon_s2.png", (0, 558, 1920, 566), "warm_s2_band_top7px", strips)
    strip("warm_avalon_s2.png", (0, 640, 1400, 1075), "warm_s2_band_text_area", strips)
    # 暖纸：reading-v2 ao 的 .dock 左内边距区（x370..410 是 48px padding）
    strip("warm_reading_v2_ao.png", (372, 310, 416, 950), "warm_v2ao_dock_left_pad", strips)
    strip("warm_reading_v2_ao.png", (1500, 310, 1546, 950), "warm_v2ao_dock_right_pad", strips)
    # 真实：mu_text0 的"无文字"状态行的中段（避开左右端 96px）
    strip(os.path.expanduser("~/Desktop/moye/hfa_png/out/data00000/mu_text0.cbg.png"),
          (8 + 100, 8, 8 + 420, 72), "real_mu_text0_row0_mid", strips)

    with open(os.path.join(HERE, "strips.json"), "w") as f:
        json.dump(strips, f, ensure_ascii=False, indent=2)

    print("== 无文字条带（把'文字梯度'与'装饰梯度'分开）==")
    for k, v in strips.items():
        if "error" in v:
            print(f"  {k}: {v['error']}"); continue
        print(f"  {k:28s} {v['W']}x{v['H']} box={v['box_xyxy']} "
              f"grad_p50={v['grad_p50']} p99={v['grad_p99']} max={v['grad_max']} "
              f"stroke/全条={v['stroke_ratio_cellarea']:.5f} (t.03={v['stroke_ratio_cellarea_t003']:.5f}) "
              f"hue={v.get('hue_circ_median_deg')} sat={v.get('sat_median')} val={v.get('val_median')}")

    # ── 并排表数据 ──
    def g(d, k, nd=5):
        v = d.get(k)
        return "-" if v is None else (round(v, nd) if isinstance(v, float) else v)

    rows = []
    def add(group, item, side, d):
        rows.append({
            "group": group, "item": item, "side": side,
            "size": f"{d['W']}x{d['H']}" if "W" in d else "-",
            "alpha_gt0": g(d, "alpha_ratio_gt0"),
            "outline_vis": g(d, "outline_ratio_visible"),
            "stroke_cell": g(d, "stroke_ratio_cellarea"),
            "stroke_cell_t03": g(d, "stroke_ratio_cellarea_t003"),
            "grad_p99": g(d, "grad_p99"),
            "grad_max": g(d, "grad_max"),
            "hue": g(d, "hue_circ_median_deg", 2),
            "sat": g(d, "sat_median", 4),
            "val": g(d, "val_median", 4),
        })

    # 真实：单格（517x64）
    for fam, idx in [("mu_text0", [0, 1, 2, 3])]:
        for i in idx:
            add("真实·选项行（单格 517x64）", f"{fam} 第{i+1}行", "real", cells[fam]["cells"][i])
    for fam in ["mu_text1_select_zc", "mu_text1_selecting_zc", "mu_text1_b_select_zc",
                "mu_text1_b_selecting_zc"]:
        add("真实·选项行（单格 517x64）", f"{fam} 首格", "real", cells[fam]["cells"][0])

    # 真实：整张 atlas / 文字窗
    for n, label in [("mu_text1_select_zc", "整张 atlas 同 mu_text1_selecting_zc"),
                     ("mu_text1_b_select_zc", "整张 atlas"), ("mu_text1_b_selecting_zc", "整张 atlas")]:
        add("真实·整图（原任务口径）", f"{n}（整图）", "real", real[n])
    for n in ["back_win", "archive_window_waku", "menu_window", "modepanel_window",
              "archive_txtsentaku", "mu_text0"]:
        add("真实·文字窗与面板（整图）", f"{n}（整图）", "real", real[n])
    for n in ["back_win", "archive_txtsentaku", "mu_text0", "archive_window_waku",
              "menu_window", "modepanel_window"]:
        for c in cells[n]["cells"]:
            if "W" in c:
                add("真实·文字窗与面板（单格）", f"{n} 第{c['cell_rc'][0]+1}格 {c['W']}x{c['H']}", "real", c)

    # 暖纸
    for k in ["avalon_s2_band", "avalon_s2_bandcore", "avalon_s2_topbar", "avalon_s1_titem_on",
              "avalon_s1_frame", "avalon_s3_panel", "reading_v2ao_opt", "reading_v2ao_dock",
              "reading_v2ao_sect", "reading_v2n_dock", "reading_v2n_composer"]:
        d = warm["crops"].get(k)
        if d and "W" in d:
            add("暖纸·构件裁件", f"{k}（{d['selector']}）", "warm", d)
    for k, d in warm["screens"].items():
        if "W" in d:
            add("暖纸·整屏", k, "warm", d)
    for k, d in strips.items():
        if "W" in d:
            add("暖纸·无文字条带", k, "warm", d)

    with open(os.path.join(HERE, "compare_rows.json"), "w") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    print(f"\nwrote compare_rows.json（{len(rows)} 行）")


if __name__ == "__main__":
    main()
