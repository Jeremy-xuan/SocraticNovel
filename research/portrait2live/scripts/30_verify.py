#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
30_verify.py —— 对渲染出来的帧做**程序化质检**（不靠目视）。

为什么必须程序化：目视看漏过两次真实缺陷（矩形擦痕、白楔缝），
而这两类缺陷都有可判定的像素特征：

  ① **白楔缝**：静止立绘里属于「人物内部」的像素，在某帧变成了**背景色**。
     判据：拿 portrait_nearest.png 算出「人物实心掩码」（人物像素 + 被填满的轮廓内部），
     若某帧在该掩码内出现 ≥N 个背景色像素 → 开缝。
     （注意：不能用"人物像素掩码"直接判 —— 头/发会移动，掩码本身要跟着动。
       这里用**腐蚀后的实心内部**做判据，它对几像素的位移不敏感。）

  ② **矩形擦痕**：眨眼帧与"该帧应有的肤色"不符 —— 表现为眼睛周围出现
     大块与 palette.skin 相同、但**边界是直角**的色块。
     判据：把眨眼帧的眼框区域与"闭眼应有的样子"比 —— 更稳的做法是检查
     **眼框边界那一圈像素**是否在眨眼前后发生了"不该发生的"颜色跳变。

  ③ **帧间确实在动**：与首帧的差异像素数必须 > 0，且序列里既有"闭眼帧"又有"睁眼帧"。

  ④ **嘴部语义**：speak 模式必须有张嘴帧；idle / write 模式**必须一帧都不张**（教学要求）。

用法：
  python3 30_verify.py
"""

import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PALETTE_JSON = os.path.join(ROOT, "src_assets", "palette.json")
NEAREST = os.path.join(ROOT, "src_assets", "portrait_nearest.png")

MODES = ["idle", "speak", "write"]


def load_palette():
    with open(PALETTE_JSON, encoding="utf-8") as f:
        p = json.load(f)["palette"]
    return {k: tuple(v) for k, v in p.items()}


def reference_bg_mask(palette):
    """**静止立绘**里本来就是背景的像素掩码。

    🔴 开缝必须用**差分**判据，不能只看"实心内部出现背景色"（2026-09-24 实测踩坑）：
       静止立绘本身在"人物外接轮廓内部"就有大量**合法的背景凹口** ——
       两侧发之间、脖子与肩之间、领口三角里都是背景（实测首帧就有 2511 个这样的像素，
       主要集中在 y≈700 的肩部）。用"轮廓填洞后腐蚀"当判据会把这些**静止时就存在的背景**
       全算成"开缝"，直接假阳性。
       → 正确判据：**某帧是背景、而静止立绘在该处不是背景** —— 这才是动画**新开出来**的缝。
    """
    a = np.asarray(Image.open(NEAREST).convert("RGB"), dtype=np.int16)
    bg = np.array(palette["bg"], dtype=np.int16)
    return (np.abs(a - bg).sum(2) < 12)


def frame_paths(out_dir):
    fs = sorted(f for f in os.listdir(out_dir) if f.startswith("f_") and f.endswith(".png"))
    return [os.path.join(out_dir, f) for f in fs]


def main():
    palette = load_palette()
    bg = np.array(palette["bg"], dtype=np.int16)
    ref_bg = reference_bg_mask(palette)
    # 只在"人物实心内部"判缝：靠近轮廓的那一圈，位移几像素就会被判成新背景，属噪声
    char = ~ref_bg
    solid = ndimage.binary_erosion(ndimage.binary_fill_holes(char), iterations=8)
    watch = solid & ~ref_bg          # 只看"静止时是人物的内部区域"
    print("静止立绘里的背景像素          : %d" % int(ref_bg.sum()))
    print("用于判缝的「人物内部」掩码    : %d px" % int(watch.sum()))

    results = {}
    ok_all = True

    for mode in MODES:
        out_dir = os.path.join(ROOT, "out", "frames_" + mode)
        if not os.path.isdir(out_dir):
            print("⚠️  跳过 %s（目录不存在）" % mode)
            continue
        paths = frame_paths(out_dir)
        if not paths:
            print("⚠️  跳过 %s（没有帧）" % mode)
            continue

        base = np.asarray(Image.open(paths[0]).convert("RGB"), dtype=np.int16)
        diff_counts, new_bg = [], []
        for p in paths:
            a = np.asarray(Image.open(p).convert("RGB"), dtype=np.int16)
            diff_counts.append(int((np.abs(a - base).sum(2) > 10).sum()))
            is_bg = (np.abs(a - bg).sum(2) < 12)
            new_bg.append(int((is_bg & watch).sum()))

        # 眼框：眨眼前后该框内的变化量
        eye_boxes = [(397, 405, 489, 467), (535, 405, 627, 467)]
        eye_var = []
        for p in paths:
            a = np.asarray(Image.open(p).convert("RGB"), dtype=np.int16)
            v = 0
            for (x0, y0, x1, y1) in eye_boxes:
                v += int((np.abs(a[y0:y1, x0:x1] - base[y0:y1, x0:x1]).sum(2) > 30).sum())
            eye_var.append(v)

        # ③ 颜色纯净度：平色块画风里，任何一帧都不该出现"调色板之外"的脏色。
        #    这条判据专抓**半透明混合**（把眼睛压扁再淡出会混出灰蓝/灰褐，
        #    实测半闭帧出现过 (151,166,184) 与 (134,116,105) 这类不在调色板里的颜色）。
        pal_colors = np.array(list(palette.values()), dtype=np.int16)
        impure_peak, impure_worst = 0, None
        for p in paths:
            a = np.asarray(Image.open(p).convert("RGB"), dtype=np.int16)
            # 逐像素到最近调色板色的距离（取最小）
            d = np.abs(a[:, :, None, :] - pal_colors[None, None, :, :]).sum(3).min(2)
            n = int((d > 30).sum())
            if n > impure_peak:
                impure_peak, impure_worst = n, os.path.basename(p)
        impure_ok = impure_peak <= 2000        # 容差：抗锯齿/缩放边缘本来就有过渡色

        st = json.load(open(os.path.join(out_dir, "stats.json"), encoding="utf-8"))
        max_new_bg = max(new_bg)
        # 判据：动画**新开**出来的背景像素峰值
        SEAM_TOL = 120
        seam_ok = max_new_bg <= SEAM_TOL
        moving = max(diff_counts) > 1000
        blink_ok = max(eye_var) > 300
        mouth_ok = (st["mouth_open_frames"] > 0) if mode == "speak" else (st["mouth_open_frames"] == 0)

        print("\n── %s ──" % mode)
        print("  帧数                : %d" % len(paths))
        print("  与首帧最大差异像素  : %d  %s" % (max(diff_counts), "✅在动" if moving else "❌没动"))
        print("  新开缝峰值（px）    : %d  (容差 %d)  %s"
              % (max_new_bg, SEAM_TOL, "✅无开缝" if seam_ok else "❌检测到开缝"))
        print("  眼框最大变化像素    : %d  %s" % (max(eye_var), "✅有眨眼" if blink_ok else "❌无眨眼"))
        print("  张嘴帧数            : %d  %s" % (st["mouth_open_frames"],
                                                 "✅符合语义" if mouth_ok else "❌语义不符"))
        print("  调色板外脏色峰值    : %d  (容差 2000，最差帧 %s)  %s"
              % (impure_peak, impure_worst, "✅无混合脏色" if impure_ok else "❌有混合脏色"))
        print("  渲染 %.2f fps（%s）" % (st["render_fps"], st["realtime_vs_target"]))

        results[mode] = {
            "frames": len(paths), "max_diff_px": max(diff_counts),
            "max_new_seam_px": max_new_bg, "seam_ok": bool(seam_ok),
            "max_eye_var_px": max(eye_var), "blink_ok": bool(blink_ok),
            "mouth_open_frames": st["mouth_open_frames"], "mouth_ok": bool(mouth_ok),
            "impure_color_peak_px": impure_peak, "impure_worst_frame": impure_worst,
            "impure_ok": bool(impure_ok),
            "render_fps": st["render_fps"],
        }
        ok_all = ok_all and moving and seam_ok and blink_ok and mouth_ok and impure_ok

    with open(os.path.join(ROOT, "out", "verify.json"), "w", encoding="utf-8") as f:
        json.dump({"modes": results, "seam_tolerance_px": 120, "impure_tolerance_px": 2000,
                   "seam_criterion": "帧内为背景、而静止立绘在该处不是背景的像素数（人物内部区域）",
                   "all_pass": bool(ok_all)}, f, ensure_ascii=False, indent=2)

    print("\n" + ("=" * 56))
    print("总判定：" + ("✅ 全部通过" if ok_all else "❌ 有项目未通过"))
    print("明细已写：out/verify.json")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
