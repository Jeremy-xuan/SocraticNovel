#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
measure_warm.py — 用与 measure_png.py 完全相同的算法，量暖纸样稿的渲染 PNG。

为什么不能直接照抄"非透明像素占比"：
  我们的样稿是**不透明整屏渲染**（HTML 无 alpha 通道），所以 alpha>0 的比例恒为 1.0000，
  这一项**不可比**——报告里如实标"不适用（不透明渲染）"，不拿它凑数。
可比的项是：高梯度描边占比（同一 GRAD_THRESH=0.08 与 0.03 两档）、梯度分位、
主色相圆周中位数、饱和度/明度中位数。

构件级裁件取自整屏 PNG + warm_rects.json 里的 getBoundingClientRect（脚本侧不做元素截图，
避免 height:0 的装饰线直接失败）。
"""
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from measure_png import measure  # noqa: E402

WARM = os.path.join(HERE, "warm_rects.json")
RENDER = os.path.join(HERE, "render")   # render_warm.js 的输出目录（默认 /tmp/mahoyo-metrics，复跑时用 OUT= 指到这里）

# (屏标识, 整屏 PNG, 构件选择器, 输出键)
CROPS = [
    ("s2", "warm_avalon_s2.png", ".band", "avalon_s2_band"),
    ("s2", "warm_avalon_s2.png", ".band-core", "avalon_s2_bandcore"),
    ("s2", "warm_avalon_s2.png", ".topbar", "avalon_s2_topbar"),
    ("s1", "warm_avalon_s1.png", ".titem.on", "avalon_s1_titem_on"),
    ("s1", "warm_avalon_s1.png", ".frame", "avalon_s1_frame"),
    ("s3", "warm_avalon_s3.png", ".panel", "avalon_s3_panel"),
    ("v2ao", "warm_reading_v2_ao.png", ".opt", "reading_v2ao_opt"),
    ("v2ao", "warm_reading_v2_ao.png", ".dock", "reading_v2ao_dock"),
    ("v2ao", "warm_reading_v2_ao.png", ".sect", "reading_v2ao_sect"),
    ("v2n", "warm_reading_v2_default.png", ".dock", "reading_v2n_dock"),
    ("v2n", "warm_reading_v2_default.png", ".composer", "reading_v2n_composer"),
]


def main():
    rects = json.load(open(WARM))
    out = {"screens": {}, "crops": {}}

    for scr, png in [("s1", "warm_avalon_s1.png"), ("s2", "warm_avalon_s2.png"),
                     ("s3", "warm_avalon_s3.png"),
                     ("v2n", "warm_reading_v2_default.png"),
                     ("v2ao", "warm_reading_v2_ao.png"),
                     ("s4", "warm_avalon_s4.png")]:
        p = os.path.join(RENDER, png)
        if not os.path.exists(p):
            out["screens"][png] = {"error": "missing"}
            continue
        r = measure(p)
        im = Image.open(p)
        r["mode"] = im.mode
        r["alpha_note"] = "不透明整屏渲染：alpha 恒为 255 → alpha_ratio 恒 1.0，与真实 PNG 不可比"
        out["screens"][png] = r

    for tag, png, sel, key in CROPS:
        d = rects.get(tag, {}).get(sel)
        p = os.path.join(RENDER, png)
        if not d or not os.path.exists(p):
            out["crops"][key] = {"error": "no rect or png", "rect": d}
            continue
        im = Image.open(p)
        x0 = max(0, d["x"]); y0 = max(0, d["y"])
        x1 = min(im.width, d["x"] + d["w"]); y1 = min(im.height, d["y"] + d["h"])
        if x1 - x0 < 2 or y1 - y0 < 2:
            out["crops"][key] = {"error": "degenerate rect", "rect": d}
            continue
        crop = im.crop((x0, y0, x1, y1)).convert("RGBA")
        cp = os.path.join(HERE, f"crop_{key}.png")
        crop.save(cp)
        r = measure(os.path.join(HERE, f"crop_{key}.png"))
        r["source_screen"] = png
        r["selector"] = sel
        r["rect"] = d
        r["note"] = "不透明裁件：alpha 恒 255"
        out["crops"][key] = r

    with open(os.path.join(HERE, "warm.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print("== 整屏 ==")
    for k, v in out["screens"].items():
        if "error" in v:
            print(f"  {k}: {v['error']}"); continue
        print(f"  {k:32s} {v['W']}x{v['H']} mode={v['mode']} "
              f"stroke/全幅={v['stroke_ratio_cellarea']:.5f} (t.03={v['stroke_ratio_cellarea_t003']:.5f}) "
              f"grad p99={v['grad_p99']} max={v['grad_max']} "
              f"hue={v.get('hue_circ_median_deg')} sat={v.get('sat_median')} val={v.get('val_median')}")
    print("== 构件裁件 ==")
    for k, v in out["crops"].items():
        if "error" in v:
            print(f"  {k}: {v['error']} rect={v.get('rect')}"); continue
        print(f"  {k:24s} {v['W']}x{v['H']} stroke/全裁件={v['stroke_ratio_cellarea']:.5f} "
              f"(t.03={v['stroke_ratio_cellarea_t003']:.5f}) grad p90={v['grad_p90']} p99={v['grad_p99']} max={v['grad_max']} "
              f"hue={v.get('hue_circ_median_deg')} sat={v.get('sat_median')} val={v.get('val_median')}")
    print("\nwrote warm.json")


if __name__ == "__main__":
    main()
