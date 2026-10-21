#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
00_gen_source_portrait.py —— 生成 PoC 的输入素材：一张**静态立绘（单张位图）**。

🔴 素材来源声明（必读）
  这张立绘是**本脚本用代码画出来的**，不是下载的、不是 AI 生成的、不是任何现成作品的截图。
  画它的目的：① 手上没有「合法可用 + 分层已知」的动漫立绘；
  ② 用代码画 → 每个区域的调色板颜色**唯一**，后面的自动分层脚本才有一个可核对的答案。
  → 它**不代表产品要用的美术风格**，只代表"一张静态位图"这个输入形态。

🔴 为什么要出两张、以及它们的**唯一真源**关系（2026-09-24 实测踩坑后定下）
  超采样画布（4x）→ 用**同一次采样**降采样出两张：
    · `portrait_flat.png`    = LANCZOS 降采样 → 抗锯齿的成品立绘（给人看、给渲染用）
    · `portrait_nearest.png` = NEAREST 降采样 → 调色板颜色纯净（给分层脚本做精确分类）
  🔴 关键：这两张**在边界像素上必然不同**（LANCZOS 会插值出过渡色，NEAREST 直接取样）。
     所以「分层脚本用 nearest 分类、却拿 flat 的颜色做无损校验」是**错的方法**——
     实测会让 13144 个边界像素"看起来没被覆盖"，其实是两张图不一致造成的假失败。
  → 定下的规矩：**校验必须用同一张图**。分层脚本因此用 `portrait_nearest.png` 同时做
     分类**和**取色，无损校验也在它上面做（见 `10_segment_layers.py` §⑩）。
     `portrait_flat.png` 只作成品/渲染用途，不参与校验。

输出：
  src_assets/portrait_flat.png       成品立绘（抗锯齿）
  src_assets/portrait_nearest.png    分类/校验真源（调色板纯净）
  src_assets/palette.json            调色板 + 各区逻辑坐标

坐标系：所有坐标写在 1024×1024 的逻辑画布上，绘制时统一乘 SS(=4)。
"""

import json
import os
from PIL import Image, ImageDraw

# ───────────────────────── 画布与路径 ─────────────────────────

CANVAS = 1024
SS = 4                      # 超采样倍数：4x 画 → 降采样 → 抗锯齿
W = CANVAS * SS

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "src_assets")

# ───────────────────────── 调色板 ─────────────────────────
# 🔴 每个"将来要单独动"的区域给一个**唯一**颜色 —— 这是自动分层能成立的前提。
PALETTE = {
    "bg":        (232, 232, 235),   # 平背景（灰）
    "hair":      (46, 52, 72),      # 头发（深蓝黑）
    "hair_hi":   (66, 74, 98),      # 头发高光（比 hair 略亮；不许接近肤色，否则会被读成额头）
    "skin":      (246, 217, 196),   # 皮肤
    "skin_sh":   (228, 190, 168),   # 皮肤暗部
    "line":      (58, 47, 43),      # 描边（眼/眉/嘴/领口共用 → 分层时要靠几何关系拆开）
    "sclera":    (255, 255, 255),   # 眼白
    "iris":      (86, 132, 176),    # 虹膜
    "iris_dk":   (44, 78, 116),     # 瞳孔
    "mouth_in":  (176, 92, 92),     # 口腔（唯一色，用来定位嘴）
    "shirt":     (207, 224, 239),   # 上衣
    "shirt_sh":  (180, 202, 222),   # 上衣暗部
    "collar":    (245, 248, 252),   # 衣领
}

# ───────────────────────── 逻辑坐标（1024 画布） ─────────────────────────
# 正面、对称、胸像构图。
CX = 512

HEAD = (CX, 430, 176, 196)          # 头：椭圆 (cx, cy, rx, ry)
NECK = (478, 600, 546, 700)         # 脖子：矩形 (x0, y0, x1, y1)
TORSO = [(336, 726), (688, 726), (760, 1024), (264, 1024)]   # 上衣：多边形
COLLAR_L = [(478, 688), (512, 762), (466, 744)]              # 左领
COLLAR_R = [(546, 688), (512, 762), (558, 744)]              # 右领

HAIR_BACK = (CX, 424, 224, 248)     # 后发（头后一大团）
SIDE_LOCK_L = (372, 546, 78, 142)   # 左侧发
SIDE_LOCK_R = (652, 546, 78, 142)   # 右侧发
BANGS = [                           # 刘海：带波浪下缘
    (312, 302), (712, 302), (712, 396),
    (668, 362), (626, 400), (582, 358),
    (540, 402), (498, 358), (452, 400),
    (408, 360), (366, 398), (312, 396),
]
BANGS_HI = [(408, 312), (616, 312), (604, 342), (420, 342)]  # 刘海高光（贴着刘海上缘的一条窄带）

EYE_L = (438, 436, 43, 29)          # 左眼：椭圆 (cx, cy, rx, ry)
EYE_R = (586, 436, 43, 29)
BROW_L = (392, 356, 482, 340)       # 左眉：从 (x0,y0) 到 (x1,y1) 的弧
BROW_R = (542, 340, 632, 356)
NOSE = (520, 508)                   # 鼻子：一个小点
MOUTH = (CX, 552, 21, 13)           # 嘴：椭圆 (cx, cy, rx, ry)


def S(*vals):
    """逻辑坐标 → 超采样坐标（整数）。"""
    return tuple(int(round(v * SS)) for v in vals)


def box_of(cx, cy, rx, ry):
    """椭圆 → 外接矩形（超采样坐标）。"""
    return [int(round((cx - rx) * SS)), int(round((cy - ry) * SS)),
            int(round((cx + rx) * SS)), int(round((cy + ry) * SS))]


def draw_brow(d, x0, y0, x1, y1, color, width):
    """用二次贝塞尔近似一条眉：控制点抬高，形成弧线。"""
    mx = (x0 + x1) / 2.0
    my = min(y0, y1) - abs(x1 - x0) * 0.22
    pts = []
    for i in range(25):
        t = i / 24.0
        x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * mx + t ** 2 * x1
        y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * my + t ** 2 * y1
        pts.append((int(round(x * SS)), int(round(y * SS))))
    d.line(pts, fill=color, width=int(round(width * SS)), joint="curve")


def draw_eye(d, cx, cy, rx, ry, look_x=0.0, look_y=0.0):
    """画一只眼：眼白 → 描边 → 虹膜 → 瞳孔 → 高光。look_* 为瞳孔偏移比例。"""
    d.ellipse(box_of(cx, cy, rx, ry), fill=PALETTE["sclera"])
    d.ellipse(box_of(cx, cy, rx, ry), outline=PALETTE["line"], width=int(round(3.4 * SS)))
    # 虹膜（上半部略被上眼睑压住，动漫眼常见）
    irx, iry = rx * 0.56, ry * 0.98
    ix = cx + rx * look_x * 0.5
    iy = cy + ry * look_y * 0.4
    d.ellipse(box_of(ix, iy, irx, iry), fill=PALETTE["iris"])
    d.ellipse(box_of(ix, iy, irx * 0.52, iry * 0.62), fill=PALETTE["iris_dk"])
    # 高光
    d.ellipse(box_of(ix - irx * 0.40, iy - iry * 0.44, irx * 0.24, iry * 0.24), fill=PALETTE["sclera"])
    # 上眼睑线加粗（动漫感 + 给"闭眼"一个可参照的边界）
    d.arc(box_of(cx, cy, rx, ry), start=182, end=358, fill=PALETTE["line"], width=int(round(6.0 * SS)))


def render_flat():
    """把整张立绘画出来（一次画完，图层顺序＝美术顺序）。"""
    img = Image.new("RGB", (W, W), PALETTE["bg"])
    d = ImageDraw.Draw(img)

    # ── 1 后发（在头后面）──
    d.ellipse(box_of(*HAIR_BACK), fill=PALETTE["hair"])

    # ── 2 上衣 + 脖子（躯干层）──
    d.polygon([S(x, y) for x, y in TORSO], fill=PALETTE["shirt"])
    d.polygon([S(336, 726), S(688, 726), S(700, 800), S(324, 800)], fill=PALETTE["shirt_sh"])
    d.rectangle(S(*NECK), fill=PALETTE["skin"])
    d.rectangle(S(NECK[0], NECK[1], NECK[2], NECK[1] + 34), fill=PALETTE["skin_sh"])
    # 领口
    d.polygon([S(x, y) for x, y in COLLAR_L], fill=PALETTE["collar"])
    d.polygon([S(x, y) for x, y in COLLAR_R], fill=PALETTE["collar"])
    d.line([S(478, 688), S(512, 762), S(546, 688)], fill=PALETTE["line"], width=int(round(2.6 * SS)))

    # ── 3 头（脸）──
    d.ellipse(box_of(*HEAD), fill=PALETTE["skin"])
    # 下巴阴影
    d.ellipse(box_of(CX, 588, 92, 40), fill=PALETTE["skin_sh"])

    # ── 4 五官（画在脸上）──
    draw_brow(d, *BROW_L, PALETTE["line"], 7.0)
    draw_brow(d, *BROW_R, PALETTE["line"], 7.0)
    draw_eye(d, *EYE_L)
    draw_eye(d, *EYE_R)
    d.ellipse(box_of(NOSE[0], NOSE[1], 7, 5), fill=PALETTE["skin_sh"])
    d.ellipse(box_of(*MOUTH), fill=PALETTE["mouth_in"], outline=PALETTE["line"],
              width=int(round(2.6 * SS)))

    # ── 5 侧发（压住脸的边缘 → 给"头发摆动"留出可动区域）──
    d.ellipse(box_of(*SIDE_LOCK_L), fill=PALETTE["hair"])
    d.ellipse(box_of(*SIDE_LOCK_R), fill=PALETTE["hair"])

    # ── 6 刘海（压住额头，但不盖眼睛）──
    d.polygon([S(x, y) for x, y in BANGS], fill=PALETTE["hair"])
    d.polygon([S(x, y) for x, y in BANGS_HI], fill=PALETTE["hair_hi"])

    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    hi = render_flat()

    flat = hi.resize((CANVAS, CANVAS), Image.LANCZOS)     # 成品（抗锯齿）
    nearest = hi.resize((CANVAS, CANVAS), Image.NEAREST)  # 分类/校验真源（纯净）

    p_flat = os.path.join(OUT_DIR, "portrait_flat.png")
    p_near = os.path.join(OUT_DIR, "portrait_nearest.png")
    p_pal = os.path.join(OUT_DIR, "palette.json")

    flat.save(p_flat)
    nearest.save(p_near)
    with open(p_pal, "w", encoding="utf-8") as f:
        json.dump({
            "note": "本立绘由 00_gen_source_portrait.py 用代码绘制（非下载、非 AI 生成）",
            "canvas": CANVAS,
            "supersample": SS,
            "palette": {k: list(v) for k, v in PALETTE.items()},
            "regions": {
                "head": HEAD, "neck": NECK, "torso": TORSO,
                "eye_l": EYE_L, "eye_r": EYE_R, "mouth": MOUTH,
                "hair_back": HAIR_BACK, "side_l": SIDE_LOCK_L, "side_r": SIDE_LOCK_R,
            },
        }, f, ensure_ascii=False, indent=2)

    print("画布        :", CANVAS, "×", CANVAS, "(超采样", SS, "x)")
    print("成品立绘    :", p_flat, "（LANCZOS，抗锯齿）")
    print("分类/校验源 :", p_near, "（NEAREST，调色板纯净）")
    print("调色板      :", p_pal, "→", len(PALETTE), "色")


if __name__ == "__main__":
    main()
