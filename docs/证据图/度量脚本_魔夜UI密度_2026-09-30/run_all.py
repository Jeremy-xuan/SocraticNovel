#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
run_all.py — 一条命令复跑全部度量（真实 PNG → atlas 单格 → 暖纸渲染 → 主色表 → 差距表）。

前置：
  1) 暖纸渲染 PNG 已生成（Node + playwright）：
       NODE_PATH="/Users/wujunjie/Documents/ChatGPT/大学申请/node_modules" node render_warm.js
  2) PIL / numpy / scipy 可用。

本脚本只调用同目录下的各度量脚本，不自己发明新判据：
  extract_cells.py  → cells.json
  （内联）10 张真实目标图的整图读数 → real.json
  palette.py        → palette.json
  compare.py        → compare_rows.json + strips.json
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from measure_png import measure, opaque_bbox  # noqa: E402

REAL = os.path.expanduser("~/Desktop/moye/hfa_png/out/data00000/")
TARGETS = ["mu_text1_select_zc", "mu_text1_selecting_zc", "mu_text1_b_select_zc",
           "mu_text1_b_selecting_zc", "back_win", "archive_window_waku", "menu_window",
           "modepanel_window", "archive_txtsentaku", "mu_text0"]


def py(script):
    r = subprocess.run([sys.executable, os.path.join(HERE, script)], capture_output=True, text=True)
    print(f"--- {script} (exit {r.returncode}) ---")
    print(r.stdout[-4000:])
    if r.returncode:
        print(r.stderr[-2000:], file=sys.stderr)
    return r.returncode


def main():
    res = {}
    for n in TARGETS:
        p = os.path.join(REAL, n + ".cbg.png")
        r = measure(p)
        r["name"] = n
        r["opaque_bbox_xyxy"] = opaque_bbox(p)
        res[n] = r
    with open(os.path.join(HERE, "real.json"), "w") as f:
        json.dump(res, f, ensure_ascii=False, indent=2)
    print(f"--- real.json ({len(res)} 张) ---")
    py("extract_cells.py")
    py("palette.py")
    py("compare.py")
    print("全部完成")


if __name__ == "__main__":
    main()
