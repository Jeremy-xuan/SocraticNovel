#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
20_animate.py —— 把「分层立绘」驱动成**会动**的序列（本 PoC 的核心）。

驱动量（全部**程序化**，不需要任何模型权重）：
  · 呼吸 breathing —— 正弦；躯干轻微上下位移 + 纵向伸缩
  · 眨眼 blink     —— 事件驱动（随机间隔 2.4–5.2 s，一次约 0.14 s）
  · 口型 mouth     —— 说话时按文字节奏开合；**写字时恒为闭**（＝"写字时嘴不动"）
  · 摆动 sway      —— 侧发/刘海/后发做**延迟跟随**（相位滞后 + 幅度分层衰减）

三个模式（对应教室面板的相位语义）：
  idle   待机：呼吸 + 眨眼（嘴闭）
  speak  说话：呼吸 + 眨眼 + 口型开合（相位 speak）
  write  写字：呼吸 + 眨眼 + **嘴不动** + 头部微微下倾（相位 write / answer）

🔴 两条合成纪律（都是实测踩坑后定下的，别改回去）

  ① **头部件必须刚性同动**。
     脸 / 眼 / 嘴 / 侧发 / 刘海 / 后发 全部用**同一个** head_dy 平移，只有"摆动"允许
     叠加很小的相对位移（≤3 px）。原因：这些图层是**同一块头发**被切成前后两片
     （侧发在脸前、后发在脸后）。一旦让它们各自大位移，前后片就会错开，
     露出底色形成**白色楔形缝**（实测：侧发 amp=7 px 时，眼高那一行出现整条白缝）。
     → 摆动的幅度必须**远小于**图层重叠量。本脚本把摆动幅度压到 2.2–3.0 px。

  ② **眨眼用"脸层自己的皮肤色"擦，不用固定肤色矩形**。
     固定肤色（palette.skin）去擦眼睛，会在**描边/睫毛**那一圈留下矩形色块残影
     （实测：眼框边界处出现直角浅色块）。改用 face 图层在该处的像素值来擦 →
     擦完与周围皮肤**天然同色**，只留下被压扁的眼层与一条眼睑线。
     🔴 前提：眼框必须**紧**（只包眼球），否则会把脸外的头发也擦成皮肤。
        眼框由 10_segment_layers.py 用"眼球像素有界膨胀 + 上沿钉在虹膜上缘"生成。

🔴 本脚本**新画了两张小图**（原立绘里没有，已在 manifest/报告标注）：
   · `_gen_closed_eye.png`   闭眼眼睑线
   · `_gen_closed_mouth.png` 闭嘴线
   其余全部来自 10_segment_layers.py 的自动分层。

用法：
  python3 20_animate.py --mode idle  --frames 90 --fps 30
  python3 20_animate.py --mode speak --frames 90 --fps 30
  python3 20_animate.py --mode write --frames 90 --fps 30
"""

import argparse
import json
import math
import os
import random
import time

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LAYER_DIR = os.path.join(ROOT, "out", "layers")
PALETTE_JSON = os.path.join(ROOT, "src_assets", "palette.json")

# 合成顺序（与 10_segment_layers.py 一致；清单里的顺序就是绘制顺序）
LAYER_ORDER = ["torso", "hair_back", "face", "eye_l", "eye_r", "mouth",
               "side_l", "side_r", "bangs"]

# ── 摆动参数：(横向幅度px, 相位滞后度, 纵向幅度px) ──
#    🔴 幅度必须远小于图层重叠量，否则会开白缝（见文件头纪律①）。
SWAY = {
    "side_l":    (3.0, 26.0, 2.0),
    "side_r":    (3.0, 26.0, 2.0),
    "bangs":     (2.2, 14.0, 1.5),
    "hair_back": (3.0, 34.0, 2.0),
}

BREATH_SCALE_Y = 0.010          # 躯干纵向伸缩 ±1.0%
BREATH_SHIFT_Y = 2.4            # 躯干位移 ±2.4 px
HEAD_SHIFT_Y = 1.9              # 头部相对躯干的**反向**位移（呼吸时头略滞后）
HEAD_SWAY_X = 1.4               # 头部横向微摆 ±1.4 px（比旋转稳，且不会开出透明边）
WRITE_HEAD_DY = 3.0             # 写字模式：头部整体下倾的像素量


def fill_holes(im):
    """把图层内部的**透明洞**填上（用最近的不透明像素色）。

    🔴 为什么必须填（2026-09-24 实测，本轮最大的一个坑）：
       10_segment_layers.py 产出的图层是**互补**的 —— 每个像素只属于一层。
       于是上层图层在自己**不拥有**的像素处是 alpha=0 的**洞**：
         · face 层在嘴的位置有 868 px 的洞（那些像素归 mouth 层）；
         · bangs 层在额头处有 12616 px 的洞（那些像素归 face 层）；
         · face 层在眼睛处也有洞（归 eye_* 层）。
       PIL 的 `alpha_composite` 遇到 alpha=0 **不会填色**，洞的位置直接**透出画布底色**
       → 画面上"背景色从人物内部冒出来"（实测最差帧 3315 px，连嘴、衣领、头发上都有）。
       → 正解：合成前把每层的洞按**最近的不透明像素色**填满。
         这不改变最终画面：真属于别的层的像素随后会被那一层**按序覆盖**，覆盖值相同。

    实现：一次 `distance_transform_edt(return_indices=True)` 取最近不透明像素的下标 ——
    线性时间，比"迭代膨胀"快得多（后者在 1024² 上要跑几十轮，实测超时）。
    """
    arr = np.asarray(im).copy()
    opaque = arr[..., 3] > 0
    if opaque.all():
        return im
    # 以"透明"为前景算距离变换，拿到每个透明像素最近的不透明像素坐标
    _, (iy, ix) = ndimage.distance_transform_edt(~opaque, return_indices=True)
    arr[..., :3] = arr[..., :3][iy, ix]
    arr[..., 3] = 255
    return Image.fromarray(arr, "RGBA")


def load_layers():
    """读入全部图层，算出外接框，并**填掉层内的透明洞**（见 fill_holes 的说明）。

    🔴 外接框必须在**填洞之前**算：填洞会把 alpha 全置 255，
       之后 `getbbox()` 会返回整张画布 → 每帧都按 1024×1024 合成，
       实测渲染速度从 87 fps 掉到 8.5 fps（慢 10 倍）。
    """
    layers = {}
    for name in LAYER_ORDER:
        p = os.path.join(LAYER_DIR, name + ".png")
        if not os.path.isfile(p):
            raise SystemExit("❌ 缺少图层：" + p + "\n   请先跑 scripts/10_segment_layers.py")
        raw = Image.open(p).convert("RGBA")
        bbox = raw.getbbox()                       # ← 用原始 alpha 算框
        im = fill_holes(raw)
        layers[name] = {"bbox": bbox, "crop": im.crop(bbox)}
    return layers


def make_generated_parts(palette):
    """生成两张原立绘里没有的小图：闭眼眼睑线、闭嘴线。**明确标注为"新画的"**。"""
    line = tuple(palette["line"])
    SS = 4

    # 闭眼眼睑线：一条**浅弧**（向下弯的细线），不是粗黑杠。
    w, h = 104 * SS, 26 * SS
    eye = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(eye)
    # 弧的开口朝下 → 看起来像"眼皮合上"的眼缝
    d.arc([7 * SS, -22 * SS, (104 - 7) * SS, 20 * SS], start=22, end=158,
          fill=line, width=int(2.6 * SS))
    closed_eye = eye.resize((104, 26), Image.LANCZOS)

    # 闭嘴线：一条细横线（比原来的短棒更收敛）
    w2, h2 = 52 * SS, 20 * SS
    mo = Image.new("RGBA", (w2, h2), (0, 0, 0, 0))
    d2 = ImageDraw.Draw(mo)
    d2.line([(11 * SS, 11 * SS), ((52 - 11) * SS, 11 * SS)], fill=line, width=int(2.4 * SS))
    closed_mouth = mo.resize((52, 20), Image.LANCZOS)
    return closed_eye, closed_mouth
    return closed_eye, closed_mouth


def blink_schedule(n_frames, fps, seed=7):
    """每帧的「闭眼程度」0..1（1 = 完全闭）。

    🔴 三条实测约束（2026-09-24 踩坑后写死）：
      ① **不能用三角波再采样**：三角波只在**一个点**取到峰值，采样必然错过。
         实测 0.14 s（≈4.2 帧）时采样峰值只有 0.70；改成 0.18 s 再用三点平滑反而更差（0.63）
         —— 画面上表现为"闭不严"（半闭的灰眼，不是闭眼）。
      ② 正解：**对每帧直接算一个平滑的凸包**（raised-cosine 的幂），而不是"造波形再采样"：
             blink(τ) = (0.5 + 0.5·cos(π·τ))^p ，τ = (帧时刻 − 眨眼中心)/半宽
         峰值处 τ=0 → blink=1，天然取到；且 blink=1 只在 τ=0 一个点，
         靠幂 p 控制"贴顶的宽窄"（p 小 → 顶更宽、闭得更实）。
      ③ 本函数末尾**自带断言**：采样峰值必须 ≥0.90，否则直接报错 ——
         不允许静默产出一个"闭不严"的眨眼。
    """
    rng = random.Random(seed)
    half = 0.11                                   # 半宽（秒）→ 全宽 0.22 s ≈ 6.6 帧 @30fps
    power = 0.55                                  # 幂：越小顶越宽（闭得越实）
    centers = []
    t = rng.uniform(1.0, 2.2)
    while t < n_frames / fps:
        centers.append(t)
        t = t + 2 * half + rng.uniform(2.4, 5.2)

    out = []
    for i in range(n_frames):
        ft = i / fps
        v = 0.0
        for c in centers:
            tau = (ft - c) / half
            if -1.0 <= tau <= 1.0:
                v = max(v, (0.5 + 0.5 * math.cos(math.pi * tau)) ** power)
        out.append(v)

    peak = max(out) if out else 0.0
    if peak < 0.90:
        raise SystemExit(
            "❌ 眨眼曲线采样峰值只有 %.3f（要求 ≥0.90）—— 一次眨眼跨的帧数不够，"
            "画面上会表现为「闭不严」。请把 half 调大或把 fps 调小。" % peak)
    return out


def mouth_schedule(n_frames, fps, mode, seed=11):
    """每帧的「张嘴程度」0..1。

    · idle / write → 恒 0（**写字时嘴不动**，教室面板的教学要求）
    · speak        → 按文字节奏开合：音节约 4.5–7 Hz，段间夹短停顿（标点处闭嘴）
    """
    if mode != "speak":
        return [0.0] * n_frames
    rng = random.Random(seed)
    out = [0.0] * n_frames
    i = 0
    while i < n_frames:
        seg = rng.uniform(0.7, 1.6)
        f0, f1 = rng.uniform(4.5, 7.0), rng.uniform(3.0, 5.5)
        ph = rng.uniform(0, 6.28)
        for k in range(int(seg * fps)):
            if i >= n_frames:
                break
            tt = k / fps
            v = 0.62 * math.sin(2 * math.pi * f0 * tt + ph) + 0.38 * math.sin(2 * math.pi * f1 * tt)
            out[i] = max(0.0, min(1.0, 0.5 + 0.5 * v))
            i += 1
        for _ in range(int(rng.uniform(0.08, 0.30) * fps)):
            if i >= n_frames:
                break
            out[i] = 0.0
            i += 1
    return out


class Renderer:
    """按帧合成。所有图层只读入一次；每帧从同一批图层重新合成（不累积、不漂移）。"""

    def __init__(self, layers, gen, palette, mode):
        self.L = layers
        self.gen = gen
        self.bg = tuple(palette["bg"]) + (255,)
        self.skin = tuple(palette["skin"]) + (255,)
        self.mode = mode
        # 预计算：face 层的"无眼"版本（把眼框内涂成该处脸层自己的颜色，做不到就留透明）
        self.face_noeyes = self._face_without_eyes()

    def _face_without_eyes(self):
        """把 face 图层在「眼框」内的像素改成**该处脸层自己的颜色**。

        眼框紧贴眼球，框内绝大多数是皮肤；少数被侧发覆盖的像素不是皮肤，此时用
        邻域皮肤色填充（而不是固定肤色，也不是留透明）——两种做法都会留痕。
        """
        face = self.L["face"]["crop"].copy()
        fb = self.L["face"]["bbox"]
        arr = np.asarray(face).copy()
        skin_rgb = np.array([self.skin[:3]], dtype=np.uint8)
        for name in ("eye_l", "eye_r"):
            bx0, by0, bx1, by1 = self.L[name]["bbox"]
            # 转到 face 层的局部坐标
            x0, y0 = max(0, bx0 - fb[0]), max(0, by0 - fb[1])
            x1, y1 = min(arr.shape[1], bx1 - fb[0]), min(arr.shape[0], by1 - fb[1])
            if x1 <= x0 or y1 <= y0:
                continue
            sub = arr[y0:y1, x0:x1]
            a = sub[..., 3]
            # 该处原本是皮肤的像素 → 保留原色；非皮肤（被头发压住）→ 用皮肤色
            is_skin = (np.abs(sub[..., :3].astype(np.int16)
                              - skin_rgb.astype(np.int16)).sum(2) < 60) & (a > 0)
            sub[~is_skin] = np.concatenate([skin_rgb[0], np.array([255], dtype=np.uint8)])
            arr[y0:y1, x0:x1] = sub
        return Image.fromarray(arr, "RGBA")

    def frame(self, phase_t, blink, mouth):
        W = H = 1024
        canvas = Image.new("RGBA", (W, H), self.bg)
        L = self.L

        breath = math.sin(2 * math.pi * phase_t)
        # 头部整体位移（刚性：所有头部件共用）
        head_dx = HEAD_SWAY_X * math.sin(2 * math.pi * phase_t * 0.5)
        head_dy = -HEAD_SHIFT_Y * breath + (WRITE_HEAD_DY if self.mode == "write" else 0.0)
        torso_dy = BREATH_SHIFT_Y * breath

        # ── 1 躯干（呼吸：纵向伸缩 + 位移）──
        Lc = L["torso"]
        tw, th = Lc["crop"].size
        sy = 1.0 + BREATH_SCALE_Y * breath
        scaled = Lc["crop"].resize((tw, max(1, int(round(th * sy)))), Image.BICUBIC)
        canvas.alpha_composite(scaled, (Lc["bbox"][0], int(round(Lc["bbox"][1] + torso_dy))))

        # ── 2 后发（跟头走 + 轻微摆动）──
        self._paste_sway(canvas, "hair_back", phase_t, head_dx, head_dy)

        # ── 3 脸（跟头走）──
        fb = L["face"]["bbox"]
        canvas.alpha_composite(L["face"]["crop"],
                               (int(round(fb[0] + head_dx)), int(round(fb[1] + head_dy))))

        # ── 4 眼睛（眨眼）──
        for name in ("eye_l", "eye_r"):
            self._paste_eye(canvas, name, blink, head_dx, head_dy)

        # ── 5 嘴（口型）──
        self._paste_mouth(canvas, mouth, head_dx, head_dy)

        # ── 6 侧发 / 刘海（跟头走 + 轻微摆动）──
        for name in ("side_l", "side_r", "bangs"):
            self._paste_sway(canvas, name, phase_t, head_dx, head_dy)

        return canvas.convert("RGB")

    def _paste_sway(self, canvas, name, phase_t, head_dx, head_dy):
        amp, lag_deg, amp_y = SWAY[name]
        p = math.sin(2 * math.pi * phase_t - math.radians(lag_deg))
        py = math.sin(2 * math.pi * phase_t - math.radians(lag_deg * 1.3))
        b = self.L[name]["bbox"]
        canvas.alpha_composite(self.L[name]["crop"],
                               (int(round(b[0] + head_dx + amp * p)),
                                int(round(b[1] + head_dy + amp_y * py))))

    def _paste_eye(self, canvas, name, blink, head_dx, head_dy):
        """眨眼 = **眼皮从上往下"擦"过眼睛**（lid wipe），不是把眼睛压扁、也不是交叉淡入。

        🔴 为什么不用"压扁 + 交叉淡入"（2026-09-24 实测数据）：
           把睁眼层压扁再淡出，中间态是**半透明的虹膜压在皮肤上** → 颜色变浑。
           实测半闭帧的左眼框里出现 632 px 的 `(151,166,184)` 灰蓝与 318 px 的
           `(134,116,105)` 灰褐 —— 都不在任何调色板里，是混合出来的脏色。
           全闭帧反而是干净的（671 px 皮肤 + 眼睑弧），所以问题只出在**过渡态**。
        → 正解：眼皮就是**皮肤**。让 face 层的皮肤色**从眼睛上沿往下推进**，
          推进到哪，眼睛就被盖到哪。这样任何中间态都是"皮肤 + 眼睛"两个纯色相接，
          不会产生第三种颜色。眼睑弧随闭眼度淡入，给出"眼缝"的读感。
        """
        b = self.L[name]["bbox"]
        x0 = int(round(b[0] + head_dx))
        y0 = int(round(b[1] + head_dy))
        ew, eh = b[2] - b[0], b[3] - b[1]
        x1, y1 = x0 + ew, y0 + eh

        if blink <= 0.02:
            canvas.alpha_composite(self.L[name]["crop"], (x0, y0))
            return

        # ① 眼睛原样贴上（随后被眼皮覆盖）
        canvas.alpha_composite(self.L[name]["crop"], (x0, y0))

        # ② 眼皮：face 层在该处的皮肤，从上沿往下推进
        fbx, fby = self.L["face"]["bbox"][0], self.L["face"]["bbox"][1]
        lid_h = max(1, int(round(eh * min(1.0, blink))))
        sx0, sy0 = x0 - fbx, y0 - fby
        lid = self.face_noeyes.crop((sx0, sy0, sx0 + ew, sy0 + lid_h))
        canvas.alpha_composite(lid, (x0, y0))

        # ③ 眼睑弧：闭眼度到一定程度后淡入，落在眼皮下沿
        if blink > 0.30:
            g = self.gen["closed_eye"]
            gw, gh = g.size
            a = np.asarray(g).copy()
            sc = (blink - 0.30) / 0.70
            a[..., 3] = (a[..., 3].astype(np.int32) * int(round(255 * sc)) // 255).astype(np.uint8)
            ly = y0 + lid_h - gh / 2
            canvas.alpha_composite(Image.fromarray(a, "RGBA"),
                                   (int(round(x0 + ew / 2 - gw / 2)), int(round(ly))))

    def _paste_mouth(self, canvas, mouth, head_dx, head_dy):
        """闭嘴线与张嘴层**交叉淡入淡出**（mouth=0 → 全闭；mouth=1 → 全开）。"""
        b = self.L["mouth"]["bbox"]
        cx = b[0] + (b[2] - b[0]) / 2 + head_dx
        cy = b[1] + (b[3] - b[1]) / 2 + head_dy
        mw, mh = b[2] - b[0], b[3] - b[1]

        def faded(im, alpha_scale, box=None):
            a = np.asarray(im if box is None else im.crop(box)).copy()
            a[..., 3] = (a[..., 3].astype(np.int32) * int(round(255 * alpha_scale)) // 255).astype(np.uint8)
            return Image.fromarray(a, "RGBA")

        # 张嘴层（按 mouth 淡入 + 纵向略放大）
        if mouth > 0.02:
            keep = 0.45 + 0.55 * mouth
            h = max(2, int(round(mh * keep)))
            sq = self.L["mouth"]["crop"].resize((mw, h), Image.BICUBIC)
            canvas.alpha_composite(faded(sq, min(1.0, mouth * 1.35)),
                                   (int(round(cx - mw / 2)), int(round(cy - h / 2))))

        # 闭嘴线（按 1-mouth 淡出）
        g = self.gen["closed_mouth"]
        gw, gh = g.size
        canvas.alpha_composite(faded(g, max(0.0, 1.0 - mouth * 1.35)),
                               (int(round(cx - gw / 2)), int(round(cy - gh / 2))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["idle", "speak", "write"], default="idle")
    ap.add_argument("--frames", type=int, default=90)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--out", default=None)
    ap.add_argument("--period", type=float, default=3.4, help="呼吸/摆动一个周期的秒数")
    args = ap.parse_args()

    out_dir = args.out or os.path.join(ROOT, "out", "frames_" + args.mode)
    os.makedirs(out_dir, exist_ok=True)

    with open(PALETTE_JSON, encoding="utf-8") as f:
        palette = json.load(f)["palette"]

    t0 = time.time()
    layers = load_layers()
    t_load = time.time() - t0

    ce, cm = make_generated_parts(palette)
    ce.save(os.path.join(LAYER_DIR, "_gen_closed_eye.png"))
    cm.save(os.path.join(LAYER_DIR, "_gen_closed_mouth.png"))
    gen = {"closed_eye": ce, "closed_mouth": cm}

    blinks = blink_schedule(args.frames, args.fps)
    mouths = mouth_schedule(args.frames, args.fps, args.mode)

    r = Renderer(layers, gen, palette, args.mode)

    t_render0 = time.time()
    for i in range(args.frames):
        phase_t = (i / args.fps) / args.period
        r.frame(phase_t, blinks[i], mouths[i]).save(os.path.join(out_dir, "f_%04d.png" % i))
    t_render = time.time() - t_render0

    render_fps = args.frames / t_render if t_render > 0 else float("inf")
    stats = {
        "mode": args.mode,
        "frames": args.frames,
        "fps_target": args.fps,
        "resolution": [1024, 1024],
        "period_sec": args.period,
        "load_seconds": round(t_load, 3),
        "render_seconds": round(t_render, 3),
        "per_frame_ms": round(1000.0 * t_render / args.frames, 2),
        "render_fps": round(render_fps, 2),
        "realtime_vs_target": ("快于目标帧率（可实时）" if render_fps >= args.fps
                               else "慢于目标帧率（不可实时）"),
        "blink_frames": int(sum(1 for b in blinks if b > 0.02)),
        "mouth_open_frames": int(sum(1 for m in mouths if m > 0.10)),
        "sway_params": SWAY,
        "out_dir": os.path.relpath(out_dir, ROOT),
    }
    with open(os.path.join(out_dir, "stats.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)

    print("模式        :", args.mode)
    print("帧数 / 帧率 :", args.frames, "帧 @", args.fps, "fps")
    print("分辨率      : 1024 × 1024")
    print("读图层耗时  : %.3f s" % t_load)
    print("渲染耗时    : %.3f s（%.2f ms/帧 → %.2f fps）" % (t_render, stats["per_frame_ms"], render_fps))
    print("实时性      :", stats["realtime_vs_target"])
    print("眨眼帧数    :", stats["blink_frames"], " 张嘴帧数:", stats["mouth_open_frames"])
    print("输出        :", out_dir)


if __name__ == "__main__":
    main()
