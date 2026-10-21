#!/usr/bin/env python3
"""35_order_probe.py —— MOUTH-FIX-2 取证探针：绘制序表与补全判据的**可核依据**

本脚本**不改任何产出**，只从已有 SAM 掩码里把两件事量出来，供报告引用：

  ① **绘制序表的实测约束**（"谁画在谁上面"）
     SAM 给的是**可见像素**。对任意两个部件 A、B：
       · `A ∩ B > 0` 只说明"两者的可见区有交叠"，**方向仍需判**；
       · 但有一条**硬约束**：如果 A 的掩码里有**成规模的**像素落在 B 内部，
         且 A 不是一个"薄环/包边"形状，那么**A 只能画在 B 上面**
         （否则 B 会把这些像素盖掉，它们就不会出现在可见掩码里）。
     本探针把"被对方包住的像素数 / 自己的像素数"算出来（`contained_frac`），
     这就是**排序依据**，不是凭感觉。

  ② **绘制序表与实测约束的逐对一致性**
     对表里每一对 (低序部件, 高序部件)，检查是否存在"低序部件成规模地落在高序部件内部"
     ⇒ 这就是**表与实测矛盾**（脸盖在头发上就是这一类）。
     同时把**修前/修后两张表**都跑一遍，看各有多少条矛盾。

  ③ **前后发能不能拆开**：用"脸区域（含外扩）"当几何判据，
     把 SAM 的合并 `hair` 掩码切成"在脸区域内（= 前发/刘海）"与"在脸区域外（= 后发）"两块，
     报两块 px、bbox，以及**前发是否真的碰到五官**（嘴/鼻/眼）。

用法：
  PY="${AUTO_LAYER_PY:-${AUTO_LAYER_SCRATCH:-$HOME/dsh-scratch/auto-layer}/venv/bin/python}"
  $PY scripts/35_order_probe.py --samdir out/sam/sam_mps_ourasset --tag ourasset \
      --json out/probe/35_order_ourasset.json
"""
import argparse
import itertools
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

LABELS = ['hair', 'headwear', 'face', 'eyes', 'eyewear', 'ears', 'earwear', 'nose',
          'mouth', 'neck', 'neckwear', 'topwear', 'handwear', 'bottomwear', 'legwear',
          'footwear', 'tail', 'wings', 'objects']

# ── 修前的绘制序表（33_make_layers.py 原样，2026-09-24 MOUTH-FIX 版） ──────────────
ORDER_BEFORE = {
    'hair': 10, 'headwear': 130, 'face': 30, 'eyes': 60, 'eyewear': 70,
    'ears': 55, 'earwear': 56, 'nose': 45, 'mouth': 50, 'neck': 25,
    'neckwear': 26, 'topwear': 20, 'handwear': 65, 'bottomwear': 15,
    'legwear': 12, 'footwear': 11, 'tail': 8, 'wings': 9, 'objects': 140,
}
# ── 修后的绘制序表（MOUTH-FIX-2） ───────────────────────────────────────────────
# 依据见 35_order_probe 的一致性检查结果 + image2live2d `samples.py` 的规范层序
# （face_base 0/24 → eyebrow 40 → eye_white 50 → eye 52 → nose 55 → pupil 60 →
#   mouth 70 → hair_front 90；`samples.py` 是**back to front** 的 spec）。
ORDER_AFTER = {
    'tail': 4, 'hair_back': 6, 'hair': 6, 'wings': 8, 'legwear': 10,
    'footwear': 11, 'bottomwear': 13, 'topwear': 15, 'handwear': 17, 'neckwear': 18, 'neck': 20,
    'face': 24, 'ears': 28, 'earwear': 29,
    'nose': 55, 'eyes': 60, 'eyewear': 66, 'mouth': 70,
    'hair_front': 90, 'headwear': 92, 'objects': 94,
}


def load_masks(samdir):
    md = os.path.join(samdir, "masks")
    M = {}
    for f in sorted(os.listdir(md)):
        if not f.endswith(".png"):
            continue
        i = int(f.split("_")[0])
        a = np.array(Image.open(os.path.join(md, f)).convert("RGBA"))[..., 3] > 127
        if a.sum() > 0:
            M[LABELS[i]] = a
    return M


def bbox(a):
    ys, xs = np.nonzero(a)
    if len(ys) == 0:
        return None
    return [int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())]


def contained_frac(inner, outer):
    """inner 里有多少比例的像素落在 outer 内部（＝"被 outer 包住"的规模）。"""
    n = int(inner.sum())
    if n == 0:
        return 0.0, 0
    ov = int((inner & outer).sum())
    return round(ov / n, 4), ov


def face_region(face, grow=6):
    """脸区域的**实心化**版本：脸的可见掩码 → 形态学闭运算填掉五官留下的洞 → 外扩 grow px。

    为什么要实心化：脸的可见掩码在眼/嘴/鼻处有洞（那些像素被五官占了），
    不填洞的话"脸区域"是一张镂空的网，拿它当几何判据会把五官位置判成"脸区域外"。
    """
    import cv2
    m = (face.astype(np.uint8)) * 255
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k)
    if grow > 0:
        k2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1, 2 * grow + 1))
        m = cv2.dilate(m, k2)      # 输入是 uint8 ⇒ 输出也是 uint8，下面的 > 127 才对
    return m > 127


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samdir", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--json", default=None)
    ap.add_argument("--grow", type=int, default=6, help="脸区域外扩 px")
    args = ap.parse_args()

    M = load_masks(args.samdir)
    rec = {"script": "35_order_probe.py", "tag": args.tag,
           "samdir": os.path.abspath(args.samdir),
           "parts": {k: {"px": int(v.sum()), "bbox": bbox(v)} for k, v in M.items()}}

    # ── ① 逐对：被对方包住的规模 ─────────────────────────────────────────────
    pairs = {}
    for a, b in itertools.combinations(sorted(M), 2):
        fa, ova = contained_frac(M[a], M[b])
        fb, ovb = contained_frac(M[b], M[a])
        if ova or ovb:
            pairs[f"{a}|{b}"] = {"contained_frac_a_in_b": fa, "a_in_b_px": ova,
                                 "contained_frac_b_in_a": fb, "b_in_a_px": ovb,
                                 "overlap_px": int((M[a] & M[b]).sum())}
    rec["pair_containment"] = pairs

    # ── ② 两张表各自与实测约束的矛盾条数 ────────────────────────────────────
    def contradictions(table):
        bad = []
        # 只有规模成量级才算（>2% 且 >100 px），否则是边界毛刺
        def strong(frac, cnt):
            return frac >= 0.02 and cnt >= 100

        for key, p in pairs.items():
            a, b = key.split("|")
            if a not in table or b not in table:
                continue
            fa, ova = p["contained_frac_a_in_b"], p["a_in_b_px"]
            fb, ovb = p["contained_frac_b_in_a"], p["b_in_a_px"]
            # 落在"对方内部"规模成量级的一方 = 只能画在对方上面；若表里排在下面 ⇒ 矛盾
            if strong(fa, ova) and table[a] < table[b]:
                bad.append({"low": b, "high": a,
                            "why": f"{a} 有 {fa:.1%}（{ova} px）的像素落在 {b} 内部，"
                                   f"但表里 {a}({table[a]}) 却排在 {b}({table[b]}) 下面"})
            if strong(fb, ovb) and table[b] < table[a]:
                bad.append({"low": a, "high": b,
                            "why": f"{b} 有 {fb:.1%}（{ovb} px）的像素落在 {a} 内部，"
                                   f"但表里 {b}({table[b]}) 却排在 {a}({table[a]}) 下面"})
        return bad

    rec["contradictions_before"] = contradictions(ORDER_BEFORE)
    rec["contradictions_after"] = contradictions(ORDER_AFTER)

    # ── ③ 前后发拆分可行性 ────────────────────────────────────────────────────
    if "hair" in M and "face" in M:
        fr = face_region(M["face"], args.grow)
        front = M["hair"] & fr
        back = M["hair"] & (~fr)
        rec["hair_split"] = {
            "criterion": f"hair ∩ 脸区域(脸掩码闭运算 31px + 外扩 {args.grow}px)",
            "hair_px": int(M["hair"].sum()),
            "front_px": int(front.sum()), "front_bbox": bbox(front),
            "back_px": int(back.sum()), "back_bbox": bbox(back),
            "front_touches": {p: int((front & M[p]).sum())
                              for p in ("mouth", "nose", "eyes", "ears") if p in M},
        }
        rec["face_region_px"] = int(fr.sum())

    txt = json.dumps(rec, indent=2, ensure_ascii=False)
    if args.json:
        os.makedirs(os.path.dirname(args.json), exist_ok=True)
        open(args.json, "w").write(txt)

    print(f"=== 绘制序取证 | {args.tag} ===")
    print(f"  部件（px）：" + "  ".join(f"{k}={v['px']}" for k, v in rec["parts"].items()))
    print(f"  修前表的矛盾：{len(rec['contradictions_before'])} 条")
    for c in rec["contradictions_before"]:
        print(f"    🔴 {c['why']}")
    print(f"  修后表的矛盾：{len(rec['contradictions_after'])} 条")
    for c in rec["contradictions_after"]:
        print(f"    🔴 {c['why']}")
    if "hair_split" in rec:
        h = rec["hair_split"]
        print(f"  前后发拆分：hair {h['hair_px']} → 前发 {h['front_px']} {h['front_bbox']}"
              f" / 后发 {h['back_px']} {h['back_bbox']}")
        print(f"    前发碰到五官：{h['front_touches']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
