#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ANIM-GATE · 教学动画质量闸门

一条命令：
    python3 animation_gate.py <video.mp4> [--script <scene.py>] [--out <dir>]

它做两件事（缺一不可）：
  ① 程序化排版断言 —— 从抽帧里算数字，四类画面层缺陷（文字重叠 / 文字整段消失 /
     箭头连线缺失 / 元素被压住）；
  ② 人看的那一半 —— 输出一张 contact sheet（全部抽帧拼一张图，可疑帧画红框）
     与每处问题的 3× 放大图，外加 verdict.md 里"待你目视确认"的清单。

退出码：0 = 机器层无阻断；1 = 有阻断级问题（不能播）；2 = 输入/工具错误。

判据、阈值来源与已知失效面见同目录 criteria.md（报告里也有同一份）。
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import re
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = Path(__file__).resolve().parent
PALETTE_RAW = json.loads((HERE / "manim_palette.json").read_text(encoding="utf-8"))

# ---------------------------------------------------------------- 阈值（来源见 criteria.md）
SAMPLE_FPS = 2.5          # 抽帧频率：11s 的视频 → 约 28 帧
BG_TAU = 48               # 墨迹判定：与背景色的 L∞ 距离 > 48
GLYPH_MAX_SIDE = 48       # 字形连通域：bbox 长边上限（px）
GLYPH_MIN_AREA = 6
GLYPH_MIN_FILL = 0.06     # 字形连通域：面积/bbox面积 下限
GLYPH_MAX_FILL = 0.80     # 字形连通域：面积/bbox面积 上限（实心小方块不是字）
STRUCT_MIN_SIDE = 50      # 线状结构：bbox 长边下限
STRUCT_MAX_THICK = 16     # 线状结构：bbox 短边上限
BAND_MIN_INK = 4          # 一行"有内容"：该行字形像素 ≥ 4
BAND_MIN_PIX = 20         # 行带总量下限
COLOR_MIN_PX = 25         # 某个色相族在某行带内至少这么多像素才算"一个文字对象"
COLOR_FRAC_MIN = 0.30     # 一行里饱和像素占比低于此值 → 按灰阶行处理
ACHROM_SAT_MAX = 0.10     # "真灰阶"的平均饱和度上限（高于此值不算"颜色不同"）
SAT_TAU = 0.15            # 饱和度低于此值 → 归"灰阶"族
VAL_FLOOR = 0.45          # 明度低于此值的灰阶像素 = 抗锯齿暗边，直接丢弃
N_HUE = 12                # 色相族个数（每 30°）
HUE_DIFF = 45.0           # 两簇色相差 ≥ 此值才算"两个不同色的对象"
BIMODAL_MIN_SEP = 25      # 双峰两簇的 x 质心至少相距这么多 px（排除单字内的色噪）
STRIP_MIN_W = 60          # "文字条"连通域宽度下限（文字与框线/下划线粘连时用）
STRIP_MAX_H = 40          # "文字条"连通域高度上限
STRIP_MAX_FILL = 0.60     # "文字条"填充率上限（实心色块不算）
LINE_MAX_THICK = 8        # 每列墨迹纵向跨度中位数 ≤ 此值 → 线状结构（箭头/连线/横线）
OVERLAP_X = 0.30          # D1/D4：两行 x 支撑相交 / 较短者
OVERLAP_Y = 0.25          # D1/D4：两行 y 区间相交 / 较矮者
PAIR_MIN_AREA = 40        # 参与判定的连通域自身面积下限
HUE_MATCH_TOL = 40        # D2：脚本色相与画面实测色相的匹配容差（h264 会漂 25° 上下）
OCCLUDE_FRAC = 0.10       # 一方落在相交区内的墨迹占比 < 此值 → 判 D4（被压住）
OCCLUDE_PEER = 0.20       # 另一方落在相交区内的墨迹占比 ≥ 此值才成立
BIMODAL_MIN_AREA = 60     # "同域双峰"只对够大的连通域判（小连通域统计不稳）
BIMODAL_MIN_MASS = 0.30   # 两个峰中较弱者 ±15° 覆盖的像素占比下限
LINE_MIN_PX = 80          # 一行文字至少这么多像素（低于此值多半是箭头/碎屑）
LINE_MIN_H = 8            # 一行文字的最小高度
LINE_MIN_W = 24           # 一行文字的最小宽度
LINE_MIN_FILL = 0.05      # 一行文字的最小填充率（低于此值多半是框线碎屑不是字）
LINE_MAX_H = 90           # 一行文字的最大高度（框线+里面的字可能粘成一条）
TEXT_CV_MIN = 0.35        # "像文字"：每列墨迹数的变异系数下限（横线/色块 ≈ 0）
X_SPLIT_PX = 30           # 同一族同一批行里，x 方向空隙超过此值就切成两行
SOLID_MIN_W = 24          # 实心块（进度条/色块）：bbox 宽下限
SOLID_MIN_H = 12          # 实心块：bbox 高下限
SOLID_MIN_FILL = 0.50     # 实心块：面积/bbox 面积
DENSITY_OVERLAP = 0.42    # D1b：行带填充率上限（同色重叠用）
DENSITY_MIN_W = 60        # D1b：只对够宽的行带用密度判据
GAP_MIN_PX = 4            # D4：算作"被打断"的列空洞下限
GAP_FOREIGN_PX = 6        # D4：空洞列区间内至少要有的外来墨迹
OCCLUDE_MIN_W = 30        # D4：被判"被压住"的对象支撑宽度下限
LINE_MERGE_PX = 10        # D2：同色相邻行带间距 ≤ 此值则并成一块（多行 Text）
PERSIST_FRAMES = 2        # 持久性：同一处命中出现在 ≥ 2 个抽样帧才算"持久"


# ================================================================= 基础工具
def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(cmd: list[str]) -> str:
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"命令失败（exit {p.returncode}）：{' '.join(cmd)}\n{p.stderr[-2000:]}")
    return p.stdout


def ffprobe_meta(video: Path) -> dict:
    out = run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate:format=duration",
        "-of", "json", str(video),
    ])
    j = json.loads(out)
    st = j["streams"][0]
    num, den = st["r_frame_rate"].split("/")
    return {
        "width": int(st["width"]),
        "height": int(st["height"]),
        "fps": float(num) / float(den),
        "duration": float(j["format"]["duration"]),
    }


# ================================================================= 抽帧（幂等）
def extract_frames(video: Path, outdir: Path) -> tuple[list[dict], dict]:
    meta = ffprobe_meta(video)
    outdir.mkdir(parents=True, exist_ok=True)
    manifest = outdir / "frames.json"
    key = hashlib.sha256(
        f"{video.resolve()}|{sha256_file(video)}|{SAMPLE_FPS}".encode()
    ).hexdigest()[:16]

    if manifest.exists():
        old = json.loads(manifest.read_text(encoding="utf-8"))
        if old.get("key") == key and all((outdir / f["file"]).exists() for f in old["frames"]):
            return old["frames"], meta

    for p in outdir.glob("f_*.png"):
        p.unlink()
    run(["ffmpeg", "-v", "error", "-y", "-i", str(video),
         "-vf", f"fps={SAMPLE_FPS}", "-pix_fmt", "rgb24", str(outdir / "f_%04d.png")])

    frames = []
    for i, p in enumerate(sorted(outdir.glob("f_*.png"))):
        frames.append({"file": p.name, "t": round(i / SAMPLE_FPS, 3), "kind": "periodic"})

    # 末帧单独补一张（动画已停的静止帧，判"整段消失/持久重叠"最可靠）
    end_png = outdir / "f_end.png"
    t_end = max(0.0, meta["duration"] - 0.08)
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t_end:.3f}", "-i", str(video),
         "-frames:v", "1", "-pix_fmt", "rgb24", str(end_png)])
    frames.append({"file": end_png.name, "t": round(t_end, 3), "kind": "end"})

    manifest.write_text(json.dumps({"key": key, "frames": frames}, ensure_ascii=False, indent=1),
                        encoding="utf-8")
    return frames, meta


# ================================================================= 色相族
# 12 个色相族 + 灰阶。分界相对纯色相平移 15°，让"红"落在 [345,15)，
# 避免 Manim 的 RED（h≈4.7°）被 0/360 的环绕切成两个族。
FAM_NAMES = ["红", "橙", "橙黄", "黄绿", "绿", "青绿",
             "青", "蓝", "蓝紫", "紫", "品红", "玫红", "灰阶"]
HUE_SHIFT = 15.0
FAM_ACHROM = 12


def rgb_to_fam(rgb: np.ndarray) -> int:
    """RGB（任意形状 (...,3)，0–255）→ 色相族编号。饱和度低者归灰阶。"""
    a = np.asarray(rgb, dtype=np.float64)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1)
    mn = a.min(-1)
    v = mx / 255.0
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-9), 0.0)
    # 色相
    d = np.maximum(mx - mn, 1e-9)
    h = np.zeros_like(mx)
    m = (mx == r)
    h[m] = (60 * ((g - b) / d) % 360)[m]
    m = (mx == g) & (mx != r)
    h[m] = (60 * ((b - r) / d) + 120)[m]
    m = (mx == b) & (mx != r) & (mx != g)
    h[m] = (60 * ((r - g) / d) + 240)[m]
    fam = np.clip(((h + HUE_SHIFT) % 360 // (360.0 / N_HUE)).astype(np.int16), 0, N_HUE - 1)
    fam = np.where(sat < SAT_TAU, FAM_ACHROM, fam)
    fam = np.where((fam == FAM_ACHROM) & (v < VAL_FLOOR), -1, fam)   # 丢弃暗边
    return fam


def palette_fam(rgb: list) -> int:
    return int(rgb_to_fam(np.array(rgb, dtype=np.float64)))


def palette_hue(rgb: list) -> float:
    a = np.array(rgb, dtype=np.float64)
    mx, mn = a.max(), a.min()
    if mx == mn:
        return -1.0
    d = mx - mn
    r, g, b = a
    if mx == r:
        h = 60 * (((g - b) / d) % 6)
    elif mx == g:
        h = 60 * ((b - r) / d + 2)
    else:
        h = 60 * ((r - g) / d + 4)
    return float(h % 360)


def fam_hue(fam: int) -> float:
    """色相族的中心角（度）。"""
    if fam == FAM_ACHROM:
        return -1.0
    return (fam * (360.0 / N_HUE) + (360.0 / N_HUE) / 2 - HUE_SHIFT) % 360


def fam_name(i: int) -> str:
    return FAM_NAMES[i]


# ================================================================= 单帧解析
def background_color(arr: np.ndarray) -> np.ndarray:
    q = (arr // 16).astype(np.int32)
    key = q[..., 0] * 4096 + q[..., 1] * 64 + q[..., 2]
    vals, counts = np.unique(key, return_counts=True)
    k = vals[int(counts.argmax())]
    sel = key == k
    return arr[sel].mean(0)


def hue_map_of(arr: np.ndarray, ink: np.ndarray) -> np.ndarray:
    """逐像素真实色相（度）。饱和度不足或非墨迹处为 NaN。"""
    a = arr.astype(np.float64)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1)
    mn = a.min(-1)
    d = np.maximum(mx - mn, 1e-9)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-9), 0.0)
    h = np.zeros_like(mx)
    m = (mx == r)
    h[m] = (60 * ((g - b) / d) % 360)[m]
    m = (mx == g) & (mx != r)
    h[m] = (60 * ((b - r) / d) + 120)[m]
    m = (mx == b) & (mx != r) & (mx != g)
    h[m] = (60 * ((r - g) / d) + 240)[m]
    return np.where(ink & (sat >= SAT_TAU), h % 360, np.nan)


def circ_mean(h: np.ndarray) -> float:
    v = h[~np.isnan(h)]
    if v.size == 0:
        return -1.0
    a = np.deg2rad(v)
    return float(math.degrees(math.atan2(np.sin(a).mean(), np.cos(a).mean())) % 360)


def hue_gap_deg(a: float, b: float) -> float:
    if a < 0 or b < 0:
        return 0.0
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def majority_family(fam: np.ndarray, win: int = 5, need: int = 8) -> np.ndarray:
    """把"某个像素自己是什么色"改成"它周围多数是什么色"。

    抗锯齿会把一个字的边缘像素染成灰或另一种色相，逐像素判色会让同一个字被拆成
    两个"对象"，D1/D4 会因此变成一片误报。这里做邻域多数投票消掉它：只有邻域内
    至少 need 个像素同族，该像素才归属这一族，否则丢弃（-1）。
    """
    votes = np.stack([(fam == k).astype(np.float32) for k in range(N_HUE + 1)], -1)
    for i in range(N_HUE + 1):
        votes[..., i] = ndimage.uniform_filter(votes[..., i], size=win,
                                               mode="constant") * (win * win)
    best = votes.argmax(-1)
    top = votes.max(-1)
    out = np.where(top >= need, best, -1).astype(np.int16)
    out[~np.isin(fam, np.arange(N_HUE + 1))] = -1
    return out


def component_stats(arr: np.ndarray, lab: np.ndarray, glyph_id: np.ndarray,
                    n: int, fam_raw: np.ndarray) -> list[dict]:
    """每个"字形连通域"的颜色统计。这是判 D1/D4 的原子单位。

    用连通域而不是"色相分桶"来定对象身份：同一个字的所有笔画必在同一连通域里，
    不会因为色相在分桶边界上抖动而被拆成两个"对象"（那是上一版的误报主因）。
    """
    out = []
    for i in range(1, n + 1):
        if not glyph_id[i]:
            continue
        ys, xs = np.where(lab == i)
        _ = fam_raw
        if len(ys) == 0:
            continue
        px = arr[ys, xs].astype(np.float64)
        mx, mn = px.max(1), px.min(1)
        sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-9), 0.0)
        v = mx / 255.0
        col = sat >= SAT_TAU
        if col.sum() >= 3:
            r, g, b = px[col, 0], px[col, 1], px[col, 2]
            d = np.max(px[col], axis=1) - np.min(px[col], axis=1)
            h = np.zeros(len(r))
            m = (r >= g) & (r >= b)
            h[m] = (60 * ((g - b) / np.maximum(d, 1e-9)) % 360)[m]
            m = (g > r) & (g >= b)
            h[m] = (60 * ((b - r) / np.maximum(d, 1e-9)) + 120)[m]
            m = (b > r) & (b > g)
            h[m] = (60 * ((r - g) / np.maximum(d, 1e-9)) + 240)[m]
            h = h % 360
            ang = np.deg2rad(h)
            hue = math.degrees(math.atan2(np.sin(ang).mean(), np.cos(ang).mean())) % 360
            achrom = False
            bins = ((h // 10) % 36).astype(int)
            cnt = np.bincount(bins, minlength=36).astype(float)
            xs_col = xs[col].astype(float)
            xsum = np.bincount(bins, weights=xs_col, minlength=36).astype(float)
            hist = cnt / max(1.0, cnt.sum())
        else:
            hue, achrom, hist, xsum, cnt = -1.0, True, None, None, None
        bw = int(xs.max()) - int(xs.min()) + 1
        bh = int(ys.max()) - int(ys.min()) + 1
        out.append({"id": i, "y0": int(ys.min()), "y1": int(ys.max()) + 1,
                    "x0": int(xs.min()), "x1": int(xs.max()) + 1,
                    "area": int(len(ys)), "area_bbox": int(bw * bh),
                    "hue": round(float(hue), 1),
                    "achrom": bool(achrom),
                    "sat": round(float(sat.mean()), 3), "val": round(float(v.mean()), 3),
                    "hist": None if hist is None else [round(float(x), 4) for x in hist],
                    "xsum": None if hist is None else [round(float(x), 1) for x in xsum],
                    "xcnt": None if hist is None else [int(x) for x in cnt]})
    return out


def hue_gap(a: dict, b: dict) -> float:
    if a["achrom"] and b["achrom"]:
        return 0.0
    if a["achrom"] or b["achrom"]:
        return 180.0
    d = abs(a["hue"] - b["hue"]) % 360.0
    return min(d, 360.0 - d)


def split_rows(mask: np.ndarray, min_px: int, min_gap: int,
               row_min: int = 5) -> list[tuple[int, int]]:
    """把某一色相族的像素按行投影切成若干"文字行"。

    row_min 不能太小：框线的竖边每行只贡献 2–3 px，阈值取 2 会把整条竖边
    和它穿过的文字连成一整块（高度超限被丢掉，文字就漏了）。
    """
    rows = mask.sum(1) >= row_min
    out, y, h = [], 0, mask.shape[0]
    while y < h:
        if rows[y]:
            y0 = y
            gap = 0
            y1 = y
            while y < h and gap < min_gap:
                if rows[y]:
                    y1 = y
                    gap = 0
                else:
                    gap += 1
                y += 1
            y1 += 1
            if mask[y0:y1].sum() >= min_px and (y1 - y0) >= LINE_MIN_H:
                out.append((y0, y1))
        else:
            y += 1
    return out


def x_runs(cols: np.ndarray, merge: int = 2) -> list[tuple[int, int]]:
    runs, st = [], int(cols[0])
    for i in range(1, len(cols)):
        if cols[i] - cols[i - 1] > merge:
            runs.append((st, int(cols[i - 1])))
            st = int(cols[i])
    runs.append((st, int(cols[-1])))
    return runs


def analyze_frame(arr: np.ndarray) -> dict:
    h, w, _ = arr.shape
    bg = background_color(arr)
    ink = np.abs(arr - bg[None, None, :]).max(2) > BG_TAU
    if ink.sum() == 0:
        return {"bg": [round(float(v), 1) for v in bg], "shape": [w, h], "ink_px": 0,
                "lines": [], "structure_px": {}, "solid_px": {}, "nonglyph_px": {},
                "fam": np.full((h, w), -1, np.int16),
                "solid": np.zeros((h, w), bool), "solid_fam": np.full((h, w), -1, np.int16),
                "lab": np.zeros((h, w), np.int32), "glyph_id": np.zeros(1, bool),
                "comps": []}

    fam_raw = rgb_to_fam(arr)
    fam_raw[~ink] = -1
    fam = majority_family(fam_raw)

    lab, n = ndimage.label(ink, structure=np.ones((3, 3), bool))
    areas = np.bincount(lab.ravel(), minlength=n + 1)
    boxes = ndimage.find_objects(lab)
    glyph_id = np.zeros(n + 1, bool)
    struct_id = np.zeros(n + 1, bool)
    solid_id = np.zeros(n + 1, bool)
    for i in range(1, n + 1):
        sl = boxes[i - 1]
        if sl is None:
            continue
        bh = sl[0].stop - sl[0].start
        bw = sl[1].stop - sl[1].start
        a = areas[i]
        fill = a / float(bh * bw)
        if bh <= GLYPH_MAX_SIDE and bw <= GLYPH_MAX_SIDE and a >= GLYPH_MIN_AREA \
                and GLYPH_MIN_FILL <= fill <= GLYPH_MAX_FILL:
            glyph_id[i] = True                       # 单字
        elif bw >= SOLID_MIN_W and bh >= SOLID_MIN_H and fill >= SOLID_MIN_FILL:
            solid_id[i] = True                       # 实心块（进度条/色块）
        elif max(bh, bw) >= STRIP_MIN_W:
            # 大组件只可能是三种：文字条（文字与框线/下划线粘在一起）、
            # 线状结构（箭头/连线/长横线）、以及"框线+里面的字"这种混合体。
            # 用每列墨迹纵向跨度中位数分开：线状结构只有笔画那么厚。
            ys2, xs2 = np.where(lab == i)
            med = float(np.median([np.ptp(ys2[xs2 == c]) + 1 for c in np.unique(xs2)]))
            if med <= LINE_MAX_THICK:
                struct_id[i] = True
            elif bw >= STRIP_MIN_W and bh <= STRIP_MAX_H and a >= LINE_MIN_PX \
                    and GLYPH_MIN_FILL <= fill <= STRIP_MAX_FILL:
                glyph_id[i] = True                   # 文字条
            # 其余（框线+字）留作"未分类"，仍计入文字墨迹
    glyph = glyph_id[lab]
    struct = struct_id[lab]
    solid = solid_id[lab]
    # 文字对象 = 除"线状结构（箭头/连线）"和"实心块（进度条/色块）"以外的所有墨迹。
    # 不能只用"字形连通域"：文字一旦与框线/下划线粘成一个大连通域，整块都会消失
    # （实测 r1_A_P1 的「已完成/接着跑」就因此漏掉）。
    fam = np.where(~(struct | solid), fam, -1)
    hue_map = hue_map_of(arr, ink)
    mx_a = arr.astype(np.float64).max(-1)
    mn_a = arr.astype(np.float64).min(-1)
    sat_map = np.where(mx_a > 0, (mx_a - mn_a) / np.maximum(mx_a, 1e-9), 0.0)
    comps = component_stats(arr, lab, glyph_id, n, fam_raw)

    # ---- 每个色相族各自切"文字行"（不跨族合并行带 → 相邻两行不会互相误判）
    lines = []
    for f in np.unique(fam[fam >= 0]):
        m = fam == f
        for (y0, y1) in split_rows(m, LINE_MIN_PX, 3):
            if (y1 - y0) > LINE_MAX_H:
                continue
            sub = m[y0:y1]
            cols = np.where(sub.any(0))[0]
            if len(cols) == 0:
                continue
            for (rx0, rx1) in x_runs(cols, X_SPLIT_PX):
                lw, lh = rx1 - rx0 + 1, y1 - y0
                if lw < LINE_MIN_W:
                    continue
                part = sub[:, rx0:rx1 + 1]
                px = int(part.sum())
                fill = px / float(lw * lh)
                if px < LINE_MIN_PX or fill < LINE_MIN_FILL:
                    continue

                # 只有"饱和像素占多数"的行才算彩色文字行；否则是灰字上沾了几个
                # 彩色像素（例如白字压在彩色条边上），色相中心会变成噪声。
                hm = hue_map[y0:y1][:, rx0:rx1 + 1][part]
                n_sat = int((~np.isnan(hm)).sum())
                hc = (circ_mean(hm) if n_sat >= COLOR_FRAC_MIN * px else -1.0)
                sat_line = float(sat_map[y0:y1][:, rx0:rx1 + 1][part].mean())
                lcols = np.where(part.any(0))[0]
                ccount = part.sum(0)[lcols].astype(float)
                cv = float(ccount.std() / max(1e-9, ccount.mean()))
                lines.append({"fam": int(f), "name": fam_name(int(f)),
                              "hue": round(hc, 1), "achrom": hc < 0,
                              "y0": int(y0), "y1": int(y1),
                              "x0": int(rx0), "x1": int(rx1),
                              "w": lw, "h": lh, "px": px, "cv": round(cv, 3),
                              "sat": round(sat_line, 3),
                              "runs": x_runs(lcols), "fill": round(fill, 4)})

    nonglyph_px = {}
    for f in np.unique(fam_raw[ink & ~glyph]):
        if f >= 0:
            nonglyph_px[fam_name(int(f))] = int((fam_raw[ink & ~glyph] == f).sum())

    structure_px, solid_px = {}, {}
    for f in np.unique(fam_raw[struct]):
        if f >= 0:
            structure_px[fam_name(int(f))] = int((fam_raw[struct] == f).sum())
    for f in np.unique(fam_raw[solid]):
        if f >= 0:
            solid_px[fam_name(int(f))] = int((fam_raw[solid] == f).sum())

    return {"bg": [round(float(v), 1) for v in bg], "shape": [w, h],
            "ink_px": int(ink.sum()), "lines": lines,
            "structure_px": structure_px, "solid_px": solid_px,
            "nonglyph_px": nonglyph_px,
            "fam": fam, "solid": solid & (fam_raw >= 0), "solid_fam": fam_raw,
            "lab": lab, "glyph_id": glyph_id, "comps": comps,
            "hue_map": hue_map}


# ================================================================= 判据 D1 / D4（连通域级）
def _inter(a0, a1, b0, b1) -> int:
    return max(0, min(a1, b1) - max(a0, b0))


def bimodal_components(comps: list[dict]) -> list[dict]:
    """同一个连通域里出现两个色相峰 → 两个字的笔画已经粘在一起。

    这是 D1 的第二种形态：两个文字对象压得太狠，笔画连成一个连通域，
    "两行相交"判据看不到，只能从这一域内部的色相双峰看出来。

    两簇还必须沿 x 分开（质心相距 ≥ BIMODAL_MIN_SEP），否则就只是同一个字
    内部的压缩色噪（实测：单字内的假双峰 gap ≤ 50°、质心相距 < 25px）。
    """
    hits = []
    for c in comps:
        hist = c.get("hist")
        if hist is None or c["area"] < BIMODAL_MIN_AREA:
            continue
        h = np.array(hist)
        xsum = np.array(c["xsum"])
        xcnt = np.array(c["xcnt"], float)
        peaks = []
        for k in range(36):
            if h[k] >= 0.08 and h[k] >= h[(k - 1) % 36] and h[k] >= h[(k + 1) % 36]:
                peaks.append((k * 10, h[k]))
        if len(peaks) < 2:
            continue
        best = None
        for i in range(len(peaks)):
            for j in range(i + 1, len(peaks)):
                d = abs(peaks[i][0] - peaks[j][0]) % 360
                d = min(d, 360 - d)
                if d < HUE_DIFF:
                    continue
                stats = []
                for p_ang in (peaks[i][0], peaks[j][0]):
                    idx = [x % 36 for x in range(int((p_ang - 15) % 360) // 10,
                                                 int((p_ang + 15) % 360) // 10 + 1)]
                    m = float(h[idx].sum())
                    n = float(xcnt[idx].sum())
                    xm = float(xsum[idx].sum()) / n if n > 0 else -1.0
                    stats.append((m, xm))
                if min(stats[0][0], stats[1][0]) < BIMODAL_MIN_MASS:
                    continue
                sep = abs(stats[0][1] - stats[1][1])
                if stats[0][1] < 0 or stats[1][1] < 0 or sep < BIMODAL_MIN_SEP:
                    continue
                if best is None or min(stats[0][0], stats[1][0]) > best[0]:
                    best = (min(stats[0][0], stats[1][0]), d, peaks[i][0], peaks[j][0],
                            round(sep, 1))
        if best is None:
            continue
        hits.append({"kind": "D1", "sub": "同域双峰",
                     "a": f"hue{best[2]}", "b": f"hue{best[3]}",
                     "a_px": c["area"], "b_px": c["area"],
                     "a_w": c["x1"] - c["x0"], "b_w": c["x1"] - c["x0"],
                     "a_h": c["y1"] - c["y0"], "b_h": c["y1"] - c["y0"],
                     "hue_gap": round(best[1], 1), "inter_px": c["area"],
                     "a_in": 0, "b_in": 0, "a_frac_in": 0.0, "b_frac_in": 0.0,
                     "victim": "",
                     "sep_px": best[4], "x_ratio": 0.0, "y_ratio": 0.0,
                     "a_hue": float(best[2]), "b_hue": float(best[3]),
                     "x0": c["x0"], "x1": c["x1"], "y0": c["y0"], "y1": c["y1"]})
    return hits


def line_hue_gap(a: dict, b: dict) -> float:
    """两行的"颜色差"。

    一方被判为灰阶时不能无条件当成"颜色完全不同"：同一个文字对象里，笔画细的字
    （比如浅绿标签里的 "B → C → A"）饱和度会掉到阈值以下，于是同一句话被拆成
    "彩色行 + 灰阶行"两行，gap 恒等于 180° → 误报。所以灰阶那一侧必须**真的灰**
    （平均饱和度 ≤ ACHROM_SAT_MAX）才算颜色不同。
    """
    if a["achrom"] and b["achrom"]:
        return 0.0
    if a["achrom"] or b["achrom"]:
        grey = a if a["achrom"] else b
        if grey["sat"] > ACHROM_SAT_MAX:
            return 0.0
        return 180.0
    return hue_gap_deg(a["hue"], b["hue"])


def detect_line_pairs(lines: list[dict], fam: np.ndarray) -> list[dict]:
    """D1（并置相压）/ D4（一个盖住另一个）——按"文字行"判。

    行 = 同一色相族在 y 上连续的一段文字。两行只有同时满足
      · 色相中心相差 ≥ HUE_DIFF（挡掉"同一对象跨分桶边界"的假阳性），
      · x 支撑相交 ≥ OVERLAP_X 且 y 区间相交 ≥ OVERLAP_Y，
    才算压在一起。再用"被压方在相交区的墨迹密度是否塌陷"区分 D1 与 D4。
    """
    hits = []
    for i in range(len(lines)):
        for j in range(i + 1, len(lines)):
            a, b = lines[i], lines[j]
            if a["fam"] == b["fam"]:
                continue
            if a["cv"] < TEXT_CV_MIN or b["cv"] < TEXT_CV_MIN:
                continue          # 横线/色块不是文字，不参与"文字相压"判定
            gap = line_hue_gap(a, b)
            if gap < HUE_DIFF:
                continue
            xo = _inter(a["x0"], a["x1"], b["x0"], b["x1"])
            yo = _inter(a["y0"], a["y1"], b["y0"], b["y1"])
            if xo <= 0 or yo <= 0:
                continue
            xr = xo / float(min(a["w"], b["w"]))
            yr = yo / float(min(a["h"], b["h"]))
            if xr < OVERLAP_X or yr < OVERLAP_Y:
                continue
            ix0, ix1 = max(a["x0"], b["x0"]), min(a["x1"], b["x1"])
            iy0, iy1 = max(a["y0"], b["y0"]), min(a["y1"], b["y1"])
            sub = fam[iy0:iy1, ix0:ix1]
            ia = int(sub.size)
            a_in = int((sub == a["fam"]).sum())
            b_in = int((sub == b["fam"]).sum())
            if a_in == 0 or b_in == 0:
                continue      # 只是 bbox 相交、相交区里没有双方的墨迹 → 不是画面相压
            a_frac = a_in / float(a["px"])
            b_frac = b_in / float(b["px"])
            victim = ""
            if a_frac < OCCLUDE_FRAC and b_frac >= OCCLUDE_PEER:
                victim = a["name"]
            elif b_frac < OCCLUDE_FRAC and a_frac >= OCCLUDE_PEER:
                victim = b["name"]
            hits.append({
                "kind": "D4" if victim else "D1", "sub": "行对",
                "a": a["name"], "b": b["name"],
                "a_hue": a["hue"], "b_hue": b["hue"],
                "a_px": a["px"], "b_px": b["px"],
                "a_w": a["w"], "b_w": b["w"], "a_h": a["h"], "b_h": b["h"],
                "hue_gap": round(gap, 1), "x_ratio": round(xr, 3), "y_ratio": round(yr, 3),
                "inter_px": ia, "a_in": a_in, "b_in": b_in,
                "a_frac_in": round(a_frac, 3), "b_frac_in": round(b_frac, 3),
                "victim": victim, "sep_px": 0,
                "x0": ix0, "x1": ix1, "y0": iy0, "y1": iy1,
            })
    return hits


def hit_key(h: dict) -> str:
    if h["kind"] == "D1b":
        return f"D1b|{h['a']}|{h['y0'] // 12}"
    if h["kind"] in ("D1", "D4"):
        return f"{h['kind']}|{h['y0'] // 16}|{h['x0'] // 32}"
    return json.dumps(h, sort_keys=True)


# ================================================================= 脚本静态分析
TEXT_CALLS = {"Text", "MarkupText", "MathTex", "Tex", "Paragraph"}
LINE_CALLS = {"Arrow", "Line", "DoubleArrow", "CurvedArrow", "DashedLine", "Vector", "Arc"}
REMOVE_CALLS = {"FadeOut", "Remove", "Uncreate", "FadeOutAndShift", "FadeOutToShiftPoint"}
# Transform 会改掉对象的颜色/内容，静态判不出它最后是什么颜色 → 该对象不计入预期
RETINT_CALLS = {"Transform", "ReplacementTransform", "TransformFromCopy"}
ADD_CALLS = {"FadeIn", "Create", "Write", "AddTextLetterByLetter", "GrowArrow",
             "GrowFromCenter", "DrawBorderThenFill", "FadeInFrom", "FadeInFromPoint",
             "SpinInFromNothing", "ShowCreation", "Add", "add"}


def _call_name(node) -> str | None:
    if isinstance(node, ast.Call):
        f = node.func
        if isinstance(f, ast.Name):
            return f.id
        if isinstance(f, ast.Attribute):
            return f.attr
    return None


def _outer_call_name(node) -> str | None:
    """链式写法也要认：`Text(...).move_to(...)` 的最外层名字是 move_to，
    真正要认的是被调用的构造器名字，所以先剥到最内层再取名。"""
    b = _base_call(node)
    return _call_name(b) if b is not None else None


def _base_call(node):
    """剥掉链式方法调用，拿到最内层的构造函数。

    `Text("x").move_to(...).set_color(...)` 这种写法里，赋值右侧是
    move_to 调用；要一直往里剥到 `Text(...)` 才认得出这是文字对象。
    """
    cur = node
    while isinstance(cur, ast.Call) and isinstance(cur.func, ast.Attribute):
        cur = cur.func.value
    return cur if isinstance(cur, ast.Call) else None


def _kwarg(call: ast.Call, name: str):
    for kw in call.keywords:
        if kw.arg == name:
            return kw.value
    return None


def _const_str(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _color_fam(node) -> int | None:
    """把 color= 实参解析成"色相族"编号（与画面侧同一套换算）。"""
    if node is None:
        return None
    key = None
    if isinstance(node, ast.Name):
        key = node.id
    elif isinstance(node, ast.Constant) and isinstance(node.value, str):
        key = node.value.upper()
    if not key:
        return None
    if key in PALETTE_RAW:
        return palette_fam(PALETTE_RAW[key])
    if re.fullmatch(r"#[0-9A-F]{6}", key):
        rgb = [int(key[1:3], 16), int(key[3:5], 16), int(key[5:7], 16)]
        return palette_fam(rgb)
    return None


class ScriptFacts(ast.NodeVisitor):
    """从 manim 脚本里抽出"应该出现在画面上"的对象。

    只做静态可判的部分；凡是解析不到的一律记进 unverified，不猜。
    """

    def __init__(self, src: str, path: Path):
        self.path = path
        self.tree = ast.parse(src)
        self.helpers: dict[str, dict] = {}       # 返回 Text 的本地辅助函数
        self.texts: dict[str, dict] = {}         # 名字 → {text, color_rgb, font_size}
        self.groups: dict[str, list[str]] = {}   # VGroup 名 → 成员名
        self.lines: dict[str, dict] = {}         # 名字 → {call, color_rgb}
        self.removed: set[str] = set()
        self.added: set[str] = set()
        self.retinted: set[str] = set()
        self.unverified: list[str] = []
        self._scan()

    # ---------- 第一遍：辅助函数
    def _scan_helpers(self):
        for node in ast.walk(self.tree):
            if isinstance(node, ast.FunctionDef):
                for sub in ast.walk(node):
                    cname = _call_name(sub)
                    if cname in TEXT_CALLS:
                        params = [a.arg for a in node.args.args]
                        self.helpers[node.name] = {"params": params}
                        break

    # ---------- 收集赋值
    def _expand_names(self, node) -> list[str]:
        out = []
        for sub in ast.walk(node):
            if isinstance(sub, ast.Name):
                out.append(sub.id)
            elif isinstance(sub, ast.Call):
                cn = _call_name(sub)
                if cn in ("VGroup", "Group"):
                    for a in sub.args:
                        out.extend(self._expand_names(a))
        return out

    def _collect_call_obj(self, call: ast.Call, target: str | None):
        call = _base_call(call) or call
        cname = _call_name(call)
        if cname is None:
            return
        if cname in TEXT_CALLS or cname in self.helpers:
            info = {"call": cname, "text": None, "color_fam": None, "font_size": None}
            if cname in TEXT_CALLS:
                if call.args:
                    info["text"] = _const_str(call.args[0])
                fs = _kwarg(call, "font_size")
                if isinstance(fs, ast.Constant):
                    info["font_size"] = fs.value
                info["color_fam"] = _color_fam(_kwarg(call, "color"))
                if _kwarg(call, "color") is None:
                    info["color_fam"] = palette_fam(PALETTE_RAW["WHITE"])
            else:
                hp = self.helpers[cname]["params"]
                if call.args:
                    info["text"] = _const_str(call.args[0])
                # 位置实参 → 形参名
                bound = {}
                for i, a in enumerate(call.args):
                    if i < len(hp):
                        bound[hp[i]] = a
                for kw in call.keywords:
                    bound[kw.arg] = kw.value
                info["color_fam"] = _color_fam(bound.get("color"))
                if bound.get("color") is None:
                    info["color_fam"] = palette_fam(PALETTE_RAW["WHITE"])
                fs = bound.get("size") or bound.get("font_size")
                if isinstance(fs, ast.Constant):
                    info["font_size"] = fs.value
            if target:
                self.texts[target] = info
            return
        if cname in LINE_CALLS:
            if target:
                self.lines[target] = {"call": cname,
                                      "color_fam": _color_fam(_kwarg(call, "color"))}

    def _scan(self):
        self._scan_helpers()
        # 名字 → VGroup 成员
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Assign) and len(node.targets) == 1 \
                    and isinstance(node.targets[0], ast.Name):
                tgt = node.targets[0].id
                v = node.value
                if isinstance(v, ast.Call) and _outer_call_name(v) in ("VGroup", "Group"):
                    v = _base_call(v)
                    members = []
                    for i, a in enumerate(v.args):
                        cn = _outer_call_name(a)
                        if cn in TEXT_CALLS or cn in self.helpers:
                            key = f"{tgt}#{i}"
                            self._collect_call_obj(a, key)
                            members.append(key)
                        else:
                            members.extend(self._expand_names(a))
                    self.groups[tgt] = members
                else:
                    self._collect_call_obj(v, tgt) if isinstance(v, ast.Call) else None

        # 移除 / 加入
        for node in ast.walk(self.tree):
            cname = _call_name(node)
            if cname is None:
                continue
            names = []
            for a in node.args:
                names.extend(self._expand_names(a))
            _ = _outer_call_name(node)
            if cname in REMOVE_CALLS:
                for nm in names:
                    self.removed.add(nm)
                    self.removed.update(self.groups.get(nm, []))
            if cname in ADD_CALLS:
                for nm in names:
                    self.added.add(nm)
                    self.added.update(self.groups.get(nm, []))
            if cname in RETINT_CALLS and node.args:
                # 第一个实参是被改写的那一个：它的颜色到末帧是什么，静态算不出来
                for nm in self._expand_names(node.args[0]):
                    self.retinted.add(nm)

    # ---------- 结论
    def expected_texts(self) -> tuple[list[dict], list[str]]:
        """返回脚本侧"末帧应当还在"的文字对象：[(色相中心 or None(灰阶), 个数)]。"""
        exp: dict[tuple, int] = {}
        unverified = list(self.unverified)
        for name, info in self.texts.items():
            if name not in self.added:
                continue
            if name in self.removed:
                continue
            if name in self.retinted:
                unverified.append(f"{name}：被 Transform 改写，末帧颜色静态判不出 → 不计入预期")
                continue
            fam = info["color_fam"]
            if fam is None:
                unverified.append(f"{name}：color 无法静态解析（表达式/变量）")
                continue
            key = ("achrom",) if fam == FAM_ACHROM else ("hue", round(fam_hue(fam), 1))
            exp[key] = exp.get(key, 0) + 1
        return [{"kind": k[0], "hue": (None if k[0] == "achrom" else k[1]), "need": v}
                for k, v in sorted(exp.items(), key=lambda t: str(t[0]))], unverified

    def unplayed_lines(self) -> list[str]:
        """声明了 Arrow/Line 却从未被任何 play/add 使用的对象名。

        判法：该名字在整份脚本里只出现在它自己那次赋值上。凡是还被别处引用过
        （VGroup、.animate、Transform、helper 函数……）都不算"没画出来"——
        静态分析认不全的用法一律按"用过"处理，宁漏不误报。
        """
        used: dict[str, int] = {}
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Name):
                used[node.id] = used.get(node.id, 0) + 1
        return [n for n in self.lines if used.get(n, 0) <= 1]

    def expected_lines(self) -> tuple[dict, list[str]]:
        exp: dict[tuple, int] = {}
        unverified = []
        for name, info in self.lines.items():
            if name not in self.added:
                continue
            if name in self.removed:
                continue
            fam = info["color_fam"]
            if fam is None:
                unverified.append(f"{name}：箭头 color 无法静态解析")
                continue
            exp[fam] = exp.get(fam, 0) + 1
        return exp, unverified


# ================================================================= 主流程
def gate_one(video: Path, script: Path | None, outdir: Path, verbose: bool,
             calibrate=None) -> dict:
    outdir.mkdir(parents=True, exist_ok=True)
    frames, meta = extract_frames(video, outdir / "frames")

    per_frame = []
    all_hits: dict[str, dict] = {}
    band_stats = []
    for f in frames:
        p = outdir / "frames" / f["file"]
        arr = np.asarray(Image.open(p).convert("RGB")).astype(np.int16)
        fa = analyze_frame(arr)
        rec = {"file": f["file"], "t": f["t"], "kind": f["kind"],
               "lines": fa["lines"], "nonglyph_px": fa["nonglyph_px"],
               "ink_px": fa["ink_px"]}
        per_frame.append(rec)
        for l in fa["lines"]:
            band_stats.append({"file": f["file"], "t": f["t"], "fam": l["name"],
                               "y0": l["y0"], "y1": l["y1"], "x0": l["x0"], "x1": l["x1"],
                               "w": l["w"], "h": l["h"], "px": l["px"], "fill": l["fill"]})
        if calibrate is not None:
            for i in range(len(fa["lines"])):
                for j in range(i + 1, len(fa["lines"])):
                    a, b = fa["lines"][i], fa["lines"][j]
                    if a["fam"] == b["fam"]:
                        continue
                    xo = _inter(a["x0"], a["x1"], b["x0"], b["x1"])
                    yo = _inter(a["y0"], a["y1"], b["y0"], b["y1"])
                    calibrate.write(json.dumps({
                        "file": f["file"], "t": f["t"], "a": a["name"], "b": b["name"],
                        "x_ratio": round(xo / min(a["w"], b["w"]), 3),
                        "y_ratio": round(yo / min(a["h"], b["h"]), 3),
                        "a_px": a["px"], "b_px": b["px"], "a_w": a["w"], "b_w": b["w"],
                        "y0": a["y0"], "x0": a["x0"]}, ensure_ascii=False) + "\n")
        hits = (detect_line_pairs(fa["lines"], fa["fam"])
                + bimodal_components(fa["comps"]))
        seen_keys = set()
        for h in hits:
            k = hit_key(h)
            e = all_hits.setdefault(k, {**h, "frames": [], "count": 0})
            if k in seen_keys:            # 同一帧内同类只记一次
                continue
            seen_keys.add(k)
            e["frames"].append({"file": f["file"], "t": f["t"]})
            e["count"] += 1

    findings = []
    for k, e in all_hits.items():
        e["persistent"] = e["count"] >= PERSIST_FRAMES
        e["severity"] = "block" if e["persistent"] else "warn"
        findings.append(e)
    findings.sort(key=lambda x: (x["kind"], -x["count"]))

    # ---- D3 箭头/连线
    d3 = {"kind": "D3", "checked": [], "unverified": []}
    script_facts = None
    if script is not None and script.exists():
        try:
            script_facts = ScriptFacts(script.read_text(encoding="utf-8"), script)
        except SyntaxError as ex:
            d3["unverified"].append(f"脚本解析失败：{ex}")
    if script_facts is not None:
        for nm in script_facts.unplayed_lines():
            d3.setdefault("hits", []).append(
                {"kind": "D3", "fam": -1, "fam_name": "-", "expected": 1, "structure_px": 0,
                 "severity": "block", "persistent": True, "frames": [], "count": 0,
                 "x0": 0, "x1": 0, "y0": 0, "y1": 0,
                 "note": f"脚本里创建了 {nm}（Arrow/Line）却从未 play/add → 必然没出现在画面上"})
        exp_lines, unv = script_facts.expected_lines()
        d3["unverified"] += unv
        seen_struct: dict[int, int] = {}
        for rec in per_frame:
            for nm, cnt in rec["nonglyph_px"].items():
                idx = FAM_NAMES.index(nm)
                seen_struct[idx] = max(seen_struct.get(idx, 0), cnt)
        for fam, need in exp_lines.items():
            got = seen_struct.get(fam, 0)
            d3["checked"].append({"fam": fam, "fam_name": fam_name(fam),
                                  "expected": need, "structure_px_max_over_frames": got})
            if got < 150:
                d3.setdefault("hits", []).append(
                    {"kind": "D3", "fam": fam, "fam_name": fam_name(fam),
                     "expected": need, "structure_px": got, "severity": "block",
                     "persistent": True, "frames": [], "count": 0,
                     "x0": 0, "x1": 0, "y0": 0, "y1": 0,
                     "note": "脚本里声明并 play 了该色系的箭头/连线，但全片抽样帧里该色系的"
                             "非字形墨迹 ≈ 0（连框线都没有）→ 该箭头确实没画出来"})

    # ---- D2 脚本预期 vs 末帧实测（按颜色数文字块）
    d2 = {"kind": "D2", "checked": [], "unverified": [], "hits": []}
    if script_facts is not None:
        exp_texts, unv = script_facts.expected_texts()
        d2["unverified"] += unv
        end_rec = next(r for r in reversed(per_frame) if r["kind"] == "end")
        # 末帧：同色行带按纵向间距合并成"文字块"
        # 末帧：把每一条文字行**就近归属**到脚本声明的色系，再按 y 合并成"文字块"。
        # 不先按色相聚块再取平均色相：那样同一帧里两种不同的绿/黄会被并成一块，
        # 平均色相落到两者之间，两边都算错（实测：60° 记成 3 块、90° 记成 0 块）。
        measured_spans = {i: [] for i in range(len(exp_texts))}
        for l in end_rec["lines"]:
            if l["w"] < LINE_MIN_W or l["px"] < LINE_MIN_PX:
                continue
            if l["achrom"]:
                for i, g in enumerate(exp_texts):
                    if g["kind"] == "achrom":
                        measured_spans[i].append([l["y0"], l["y1"]])
                        break
                continue
            best_i, best_d = None, None
            for i, g in enumerate(exp_texts):
                if g["kind"] != "hue":
                    continue
                d = hue_gap_deg(l["hue"], g["hue"])
                if best_d is None or d < best_d:
                    best_i, best_d = i, d
            if best_i is not None and best_d <= HUE_MATCH_TOL:
                measured_spans[best_i].append([l["y0"], l["y1"]])
        measured_by_group = {}
        for i, spans in measured_spans.items():
            if not spans:
                measured_by_group[i] = 0
                continue
            spans.sort()
            merged = [spans[0][:]]
            for sp in spans[1:]:
                if sp[0] - merged[-1][1] <= LINE_MERGE_PX:
                    merged[-1][1] = max(merged[-1][1], sp[1])
                else:
                    merged.append(sp[:])
            measured_by_group[i] = len(merged)

        # 全片出现过的色相（用于区分"真缺失"与"色相对不上"）
        ever = []
        for rec in per_frame:
            for l in rec["lines"]:
                ever.append(("achrom", None) if l["achrom"] else ("hue", l["hue"]))

        def seen_ever(kind, hue):
            for k, h in ever:
                if kind == "achrom":
                    if k == "achrom":
                        return True
                elif k == "hue" and hue_gap_deg(h, hue) <= HUE_MATCH_TOL:
                    return True
            return False

        for gi, grp in enumerate(exp_texts):
            need, kind, hue = grp["need"], grp["kind"], grp["hue"]
            got = measured_by_group[gi]
            present_ever = seen_ever(kind, hue)
            label = "灰阶" if kind == "achrom" else f"色相≈{hue:.0f}°"
            d2["checked"].append({"fam_name": label, "expected": need, "measured_end": got,
                                  "color_seen_in_video": present_ever})
            if got < need:
                d2["hits"].append({
                    "kind": "D2", "fam": -1, "fam_name": label,
                    "expected": need, "measured_end": got,
                    "color_seen_in_video": present_ever,
                    "severity": ("block" if (got == 0 and present_ever) else "warn"),
                    "persistent": True,
                    "frames": [{"file": end_rec["file"], "t": end_rec["t"]}],
                    "count": 1, "x0": 0, "x1": 0, "y0": 0, "y1": 0,
                    "note": ("末帧该色系的文字块整段消失（脚本声明 " + str(need) +
                             " 块，末帧 0 块）" if got == 0 and present_ever else
                             ("末帧块数少于脚本声明但未归零 → 可能被图形盖住/多行合并，"
                              "交人工目视" if present_ever else
                              "该色系在全片任何抽样帧都没出现 → 多半是色相/编码对不上，"
                              "标为待人工确认，不计阻断"))})

    all_findings = findings + d2["hits"] + d3.get("hits", [])
    blocking = [f for f in all_findings if f.get("severity") == "block"]

    verdict = {
        "tool": "animation-gate",
        "video": str(video),
        "video_sha256": sha256_file(video),
        "script": str(script) if script else None,
        "meta": meta,
        "thresholds": {
            "SAMPLE_FPS": SAMPLE_FPS, "BG_TAU": BG_TAU, "HUE_DIFF": HUE_DIFF,
            "OVERLAP_X": OVERLAP_X, "OVERLAP_Y": OVERLAP_Y,
            "OCCLUDE_FRAC": OCCLUDE_FRAC, "OCCLUDE_PEER": OCCLUDE_PEER,
            "DENSITY_OVERLAP": DENSITY_OVERLAP, "GAP_MIN_PX": GAP_MIN_PX,
            "GAP_FOREIGN_PX": GAP_FOREIGN_PX, "PERSIST_FRAMES": PERSIST_FRAMES,
        },
        "frames": [{"file": r["file"], "t": r["t"], "kind": r["kind"]} for r in per_frame],
        "findings": all_findings,
        "d2": d2, "d3": d3,
        "band_stats": band_stats,
        "blocking_count": len(blocking),
        "verdict": "BLOCK" if blocking else "PASS",
        "human_review_required": True,
    }

    write_evidence(outdir, verdict, per_frame, meta)
    return verdict


def write_evidence(outdir: Path, verdict: dict, per_frame: list[dict], meta: dict) -> None:
    fr_dir = outdir / "frames"
    # ---- contact sheet
    flagged = set()
    for f in verdict["findings"]:
        for fr in f.get("frames", []):
            flagged.add(fr["file"])
    files = [r["file"] for r in per_frame]
    tw, th = 320, 180
    cols = 6
    rows = math.ceil(len(files) / cols)
    sheet = Image.new("RGB", (tw * cols, th * rows), (16, 16, 16))
    dr = ImageDraw.Draw(sheet)
    for i, fn in enumerate(files):
        im = Image.open(fr_dir / fn).convert("RGB").resize((tw - 4, th - 18))
        x, y = (i % cols) * tw, (i // cols) * th
        sheet.paste(im, (x + 2, y + 16))
        t = next(r["t"] for r in per_frame if r["file"] == fn)
        dr.text((x + 4, y + 3), f"{fn}  t={t:.2f}s", fill=(200, 200, 200))
        if fn in flagged:
            dr.rectangle([x, y, x + tw - 1, y + th - 1], outline=(255, 40, 40), width=3)
    sheet.save(outdir / "contact_sheet.png")

    # ---- 问题放大图
    zoom_dir = outdir / "zoom"
    if zoom_dir.exists():
        shutil.rmtree(zoom_dir)
    zoom_dir.mkdir(parents=True, exist_ok=True)
    for i, f in enumerate(verdict["findings"]):
        if not f.get("frames"):
            continue
        fn = f["frames"][0]["file"]
        arr = Image.open(fr_dir / fn).convert("RGB")
        x0, x1 = int(f.get("x0", 0)), int(f.get("x1", arr.width))
        y0, y1 = int(f.get("y0", 0)), int(f.get("y1", arr.height))
        if x1 - x0 < 12 or y1 - y0 < 8:
            x0, y0, x1, y1 = 0, 0, arr.width, arr.height   # D2/D3 没有 bbox → 整帧
        m = 10
        box = (max(0, x0 - m), max(0, y0 - m),
               min(arr.width, x1 + m), min(arr.height, y1 + m))
        if box[2] - box[0] < 8 or box[3] - box[1] < 8:
            continue
        crop = arr.crop(box)
        k = max(1, min(6, int(900 / max(1, crop.width))))
        crop = crop.resize((crop.width * k, crop.height * k), Image.NEAREST)
        crop.save(zoom_dir / f"{i:02d}_{f['kind']}_{fn.replace('.png','')}.png")

    (outdir / "verdict.json").write_text(
        json.dumps(verdict, ensure_ascii=False, indent=1), encoding="utf-8")
    (outdir / "verdict.md").write_text(render_md(verdict), encoding="utf-8")


def render_md(v: dict) -> str:
    L = []
    L.append(f"# 闸门判定 · {Path(v['video']).name}")
    L.append("")
    L.append(f"- 视频 sha256：`{v['video_sha256'][:16]}…`")
    L.append(f"- 脚本：`{v['script'] or '（未提供 → D2/D3 无法核对）'}`")
    L.append(f"- 规格：{v['meta']['width']}×{v['meta']['height']} @ {v['meta']['fps']:.2f}fps，"
             f"{v['meta']['duration']:.2f}s；抽帧 {len(v['frames'])} 张（{SAMPLE_FPS}fps + 末帧）")
    L.append(f"- **机器判定：{v['verdict']}**（阻断级 {v['blocking_count']} 处）")
    L.append("")
    L.append("> 机器判定 ≠ 最终放行。请先看 `contact_sheet.png`（红框＝有命中的帧），"
             "再看本文件末尾的「待你目视确认」。")
    L.append("")
    if not v["findings"]:
        L.append("## 命中：无")
    else:
        L.append("## 命中")
        L.append("")
        L.append("| # | 判据 | 严重度 | 帧数 | 位置(帧) | 原始数字 |")
        L.append("|---|---|---|---|---|---|")
        for i, f in enumerate(v["findings"]):
            fr = f["frames"][0] if f.get("frames") else {"file": "-", "t": float("nan")}
            if f["kind"] in ("D1", "D4"):
                num = (f"{f.get('sub','行对')}；色相差 {f['hue_gap']}°（阈值 {HUE_DIFF}）；"
                       f"「{f['a']}」{f['a_px']}px ×「{f['b']}」{f['b_px']}px；"
                       f"x 相交 {f['x_ratio']}（阈值 {OVERLAP_X}）／y 相交 {f['y_ratio']}"
                       f"（阈值 {OVERLAP_Y}）；落在相交区的墨迹占比 "
                       f"{f['a_frac_in']} / {f['b_frac_in']}"
                       f"（D4 阈值 {OCCLUDE_FRAC}）；交点 x{f['x0']}–{f['x1']} "
                       f"y{f['y0']}–{f['y1']}")
            elif f["kind"] == "D1b":
                num = (f"文字行「{f['a']}」填充率 {f['fill']}（阈值 {DENSITY_OVERLAP}）；"
                       f"{f['a_px']}px / {f['a_w']}×{f['a_h']}")
            elif f["kind"] == "D4-old":
                num = ""
            elif f["kind"] == "D2":
                num = (f"色系「{f['fam_name']}」：脚本预期 {f['expected']} 块 / "
                       f"末帧实测 {f['measured_end']} 块")
            elif f["kind"] == "D3":
                num = (f"色系「{f['fam_name']}」：脚本预期 {f['expected']} 条 / "
                       f"全片线状结构像素 {f['structure_px']}（阈值 200）")
            else:
                num = ""
            L.append(f"| {i} | {f['kind']} | {f.get('severity')} | {f.get('count', 1)} | "
                     f"{fr['file']} @ {fr['t']}s | {num} |")
    L.append("")
    L.append("## 判据核对（脚本侧 vs 画面侧）")
    L.append("")
    if v["d2"]["checked"]:
        L.append("**D2 文字块数**")
        L.append("")
        L.append("| 色系 | 脚本预期 | 末帧实测 | 该色系全片出现过 |")
        L.append("|---|---|---|---|")
        for c in v["d2"]["checked"]:
            L.append(f"| {c['fam_name']} | {c['expected']} | {c['measured_end']} | "
                     f"{'是' if c['color_seen_in_video'] else '否'} |")
        L.append("")
    if v["d3"]["checked"]:
        L.append("**D3 箭头/连线**")
        L.append("")
        L.append("| 色系 | 脚本预期 | 全片线状结构像素 |")
        L.append("|---|---|---|")
        for c in v["d3"]["checked"]:
            L.append(f"| {c['fam_name']} | {c['expected']} | "
                     f"{c['structure_px_max_over_frames']} |")
        L.append("")
    if v["d2"]["unverified"] or v["d3"]["unverified"]:
        L.append("**静态解析不到的（未核对，不猜）**")
        L.append("")
        for u in v["d2"]["unverified"] + v["d3"]["unverified"]:
            L.append(f"- {u}")
        L.append("")
    L.append("## 待你目视确认（人看的那一半）")
    L.append("")
    L.append("1. 打开 `contact_sheet.png`：红框帧＝机器有命中的帧，逐张扫一遍。")
    L.append("2. 打开 `zoom/` 里对应的放大图，确认是真缺陷还是机器误报。")
    L.append("3. 语义层（概念标签用错、术语与教材不一致、数值算错）**闸门不看**，"
             "必须由人对着教材读一遍。")
    L.append("")
    return "\n".join(L)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="ANIM-GATE 教学动画质量闸门")
    ap.add_argument("video", type=Path)
    ap.add_argument("--script", type=Path, default=None)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--calibrate", type=Path, default=None,
                    help="把每一对文字行的相交比值写成 jsonl，用于确定阈值来源")
    a = ap.parse_args(argv)
    if not a.video.exists():
        print(f"[错误] 找不到视频：{a.video}", file=sys.stderr)
        return 2
    if a.script is not None and not a.script.exists():
        print(f"[错误] 找不到脚本：{a.script}", file=sys.stderr)
        return 2
    out = a.out or (HERE / "runs" / a.video.stem)
    try:
        cal = open(a.calibrate, "a", encoding="utf-8") if a.calibrate else None
        v = gate_one(a.video, a.script, out, not a.quiet, cal)
        if cal:
            cal.close()
    except Exception as ex:  # 工具级错误
        print(f"[错误] 闸门执行失败：{ex}", file=sys.stderr)
        return 2
    if not a.quiet:
        print(f"[闸门] {a.video.name} → {v['verdict']}（阻断 {v['blocking_count']}）")
        for f in v["findings"]:
            print(f"   - {f['kind']} {f.get('severity')} ×{f.get('count',1)} {f.get('note','')}")
        print(f"   证据目录：{out}")
    return 1 if v["blocking_count"] else 0


if __name__ == "__main__":
    sys.exit(main())
