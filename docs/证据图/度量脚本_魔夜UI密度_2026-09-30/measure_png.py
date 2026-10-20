#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
measure_png.py — 「装饰密度与语汇」度量内核（真实魔夜 UI / 暖纸样稿 共用同一套算法）

算法定义（全部可复算，无估计）：

1) 非透明像素占整图比例  alpha_ratio_gt0
   定义：count(alpha > 0) / (W*H)
   同时给出 alpha_ge128_ratio = count(alpha >= 128) / (W*H)   —— 「实心」像素占比

2) 边缘/描边像素占比  两条独立定义，都给：
   a) outline_ratio_visible = 外圈像素 / 非透明像素
      外圈 = 非透明掩膜经 3x3 十字结构元腐蚀一次后的差集（alpha>0 掩膜减去腐蚀结果）
      —— 量的是「形状外轮廓」在可见像素中的占比
      outline_ratio_full = 同一量除以 W*H（对整图的占比）
   b) stroke_ratio_visible = 高梯度像素 / 非透明像素
      在非透明区域内部：亮度 L = 0.299R+0.587G+0.114B，先做 sigma=1.0 高斯平滑，
      再算 Sobel 梯度幅值 g。scipy.ndimage.sobel 的增益已用线性斜坡标定为 8.0
      （每像素斜率 s → 响应 8s，实测 s=0.5 → 4.0），故归一化 G = g / (8*255)，
      G 即「相邻像素亮度差 / 255」。
      高梯度判据：G > 0.08（≈ 相邻像素亮度差 > 20.4/255）
      参考点：255 幅度、sigma=1 的理想阶跃边，峰值 G = 653.73/（8*255）= 0.320
      —— 量的是「内部描线/高光/花饰纹理」的密度

3) 主色相中位数（HSV）
   仅统计「有色像素」：S >= 0.15 且 V >= 0.10 且 alpha > 0（近中性色/近黑色不计色相）
   色相取圆周中位数（circular median，最小化圆周距离和），单位度，0..360
   同时给出：sat_median、val_median、hue_bin_top3（36 个 10° 分桶，按有色像素占比排序）
   以及 hue_arc：有色像素中落在「中位数 ±30°」弧内的占比（色相集中度）

依赖：PIL, numpy, scipy
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HUE_S_MIN = 0.15
HUE_V_MIN = 0.10
GRAD_THRESH = 0.08
GRAD_SIGMA = 1.0


CIRC_BUDGET = 4000  # 圆周中位数的候选点预算：候选集与统计集各取 <=4000 个确定性样本


def circular_median_deg(h_deg):
    """
    圆周中位数：在 [0,360) 上取使 sum_j min(|d|, 360-|d|) 最小的点。
    为控制内存，像素先按「确定性等步长」（linspace 索引，步长 = N/4000）抽样到 <=4000 个点，
    再在候选点上取圆周中位数；4000 点下候选矩阵 4000x4000 float64 = 128MB。抽样可复算。
    """
    h = np.asarray(h_deg, dtype=np.float64) % 360.0
    if h.size == 0:
        return float("nan")
    if h.size > CIRC_BUDGET:
        h = h[np.linspace(0, h.size - 1, CIRC_BUDGET).astype(np.int64)]
    a = np.sort(h)
    d = np.abs(a[:, None] - a[None, :])
    d = np.minimum(d, 360.0 - d)
    s = d.sum(axis=1)
    return float(a[int(np.argmin(s))])


def measure(path_or_array, alpha=None):
    if isinstance(path_or_array, str):
        im = Image.open(path_or_array)
        src_mode = im.mode
        im = im.convert("RGBA")
        arr = np.asarray(im).astype(np.uint8)
        meta = {"file": path_or_array, "src_mode": src_mode, "size": [im.size[0], im.size[1]]}
    else:
        arr = np.asarray(path_or_array).astype(np.uint8)
        meta = {"size": [arr.shape[1], arr.shape[0]]}

    H, W = arr.shape[:2]
    total = H * W
    a = arr[..., 3].astype(np.int16)
    vis = a > 0
    solid = a >= 128
    vis_n = int(vis.sum())
    solid_n = int(solid.sum())

    out = dict(meta)
    out["W"] = W
    out["H"] = H
    out["pixels_total"] = total
    out["pixels_visible_gt0"] = vis_n
    out["alpha_ratio_gt0"] = round(vis_n / total, 6)
    out["pixels_solid_ge128"] = solid_n
    out["alpha_ge128_ratio"] = round(solid_n / total, 6)
    out["alpha_max"] = int(a.max())
    out["alpha_p95_of_visible"] = int(np.percentile(a[vis], 95)) if vis_n else None

    # ---- 2a 外轮廓 ----
    st = ndimage.generate_binary_structure(2, 1)  # 十字
    # 先把「非透明」当成形状本身（含半透明羽化），腐蚀一次
    eroded = ndimage.binary_erosion(vis, structure=st, border_value=0)
    outline = vis & (~eroded)
    on = int(outline.sum())
    out["outline_pixels"] = on
    out["outline_ratio_visible"] = round(on / vis_n, 6) if vis_n else None
    out["outline_ratio_full"] = round(on / total, 6)

    # ---- 2b 内部描线（梯度）----
    rgb = arr[..., :3].astype(np.float32)
    L = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    Ls = ndimage.gaussian_filter(L, GRAD_SIGMA)
    gx = ndimage.sobel(Ls, axis=1, mode="nearest")
    gy = ndimage.sobel(Ls, axis=0, mode="nearest")
    g = np.hypot(gx, gy) / (8.0 * 255.0)   # 增益 8.0 见模块内标定说明
    hi = (g > GRAD_THRESH) & vis
    # 排除外轮廓那一圈，只算「内部」描线，避免与 2a 重复计数
    inner = vis & eroded
    hi_in = hi & inner
    hn = int(hi_in.sum())
    in_n = int(inner.sum())
    out["stroke_pixels_inner"] = hn
    out["stroke_ratio_visible"] = round(hn / vis_n, 6) if vis_n else None
    out["stroke_ratio_inner"] = round(hn / in_n, 6) if in_n else None
    out["stroke_ratio_cellarea"] = round(hn / total, 6)   # 分母=整幅/整格像素，两侧同口径可比
    hi003 = (g > 0.03) & inner
    out["stroke_ratio_cellarea_t003"] = round(int(hi003.sum()) / total, 6)
    gv = g[vis]
    if gv.size:
        for q, key in [(50, "grad_p50"), (90, "grad_p90"), (99, "grad_p99")]:
            out[key] = round(float(np.percentile(gv, q)), 5)
        out["grad_max"] = round(float(gv.max()), 5)

    # ---- 3 色相 ----
    if vis_n:
        r = rgb[..., 0][vis] / 255.0
        gg = rgb[..., 1][vis] / 255.0
        b = rgb[..., 2][vis] / 255.0
        mx = np.maximum(np.maximum(r, gg), b)
        mn = np.minimum(np.minimum(r, gg), b)
        sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
        val = mx
        out["sat_median"] = round(float(np.median(sat)), 4)
        out["val_median"] = round(float(np.median(val)), 4)
        out["rgb_mean_visible"] = [int(round(float(x))) for x in (rgb[..., 0][vis].mean(),
                                                                  rgb[..., 1][vis].mean(),
                                                                  rgb[..., 2][vis].mean())]

        col = (sat >= HUE_S_MIN) & (val >= HUE_V_MIN)
        col_n = int(col.sum())
        out["hue_eligible_pixels"] = col_n
        out["hue_eligible_ratio"] = round(col_n / vis_n, 6)
        if col_n:
            rr, g2, bb = r[col], gg[col], b[col]
            mx2 = np.maximum(np.maximum(rr, g2), bb)
            mn2 = np.minimum(np.minimum(rr, g2), bb)
            dlt = np.maximum(mx2 - mn2, 1e-9)
            h = np.zeros_like(rr)
            m = (mx2 == rr)
            h[m] = ((g2[m] - bb[m]) / dlt[m]) % 6
            m = (mx2 == g2) & (mx2 != rr)
            h[m] = ((bb[m] - rr[m]) / dlt[m]) + 2
            m = (mx2 == bb) & (mx2 != rr) & (mx2 != g2)
            h[m] = ((rr[m] - g2[m]) / dlt[m]) + 4
            h = (h * 60.0) % 360.0
            out["hue_circ_median_deg"] = round(circular_median_deg(h), 2)
            hb = np.histogram(h, bins=36, range=(0, 360))[0]
            order = np.argsort(hb)[::-1][:3]
            out["hue_bin_top3"] = [
                {"bin_deg": f"{int(i)*10}-{int(i)*10+10}", "center": int(i) * 10 + 5,
                 "share": round(float(hb[i]) / col_n, 4)}
                for i in order if hb[i] > 0
            ]
            cm = out["hue_circ_median_deg"]
            d = np.abs(h - cm)
            d = np.minimum(d, 360.0 - d)
            out["hue_arc_30_share"] = round(float((d <= 30).sum()) / col_n, 4)
        else:
            out["hue_circ_median_deg"] = None
    else:
        out["sat_median"] = None
        out["hue_circ_median_deg"] = None
    return out


def opaque_bbox(path):
    im = Image.open(path).convert("RGBA")
    arr = np.asarray(im)
    vis = arr[..., 3] > 0
    if not vis.any():
        return None
    ys, xs = np.where(vis)
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    res = []
    for p in args:
        try:
            r = measure(p)
        except Exception as e:  # noqa: BLE001
            r = {"file": p, "error": f"{type(e).__name__}: {e}"}
        res.append(r)
    print(json.dumps(res if len(res) > 1 else res[0], ensure_ascii=False, indent=2))
