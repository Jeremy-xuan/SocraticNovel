#!/usr/bin/env python3
"""34_layer_regression.py —— MOUTH-FIX-2 逐部件回归：改前 / 改后**逐像素**对照

任务要求（防"修好嘴、坏了别的"）出一张对照表，每一行必须给**像素级**数字，不许只说"看起来对"。

本脚本对两套层集（`--old` / `--new`）算四组量：

  ① **逐层**：px（alpha>127 的像素数）、hole_px（补全区）、order（绘制序）、bbox
  ② **COMPOSITE 叠回去 vs SOURCE**（像素级）：
     · `gap_px`      —— 源图前景里**没有任何一层覆盖**的像素数（＝"叠回去缺了一块"）
     · `gap_max_comp`—— 其中最大的连通块（px）与它的 bbox（把"缺块"与"边缘毛刺"分开）
     · `rgb_mismatch_px` —— 叠回去的 RGB 与源图**在覆盖到的像素上**的差异 > 8 的像素数
       （用来抓"层的纹理不是源图那一块"这类错位，比如上一轮 `hair` 被 LaMA 重画成脸）
  ③ **嘴区归属**（"嘴区那一格的像素归谁"）：按绘制序取**最上面的覆盖层**，
     逐格报"嘴的可见像素落在哪一层、各多少 px"
  ④ **假部件检查**：报出**小于 `--fake-px`（默认 30 px）**的层 —— 上一轮降全局阈值
     造出过一个 11 px 的假左耳，这类东西必须能被一眼看见

用法：
  PY="${AUTO_LAYER_PY:-${AUTO_LAYER_SCRATCH:-$HOME/dsh-scratch/auto-layer}/venv/bin/python}"
  $PY scripts/34_layer_regression.py --old out/layers/legacy_ourasset/layers \
      --new out/layers/fix2_ourasset/layers \
      --samdir out/sam/sam_mps_ourasset \
      --json out/probe/34_regression_ourasset.json
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# 判定"源图前景"的背景差阈值（源图是 RGB，没有 alpha ⇒ 只能按"与角落背景色差多少"估）
BG_DIFF_THRESHOLD = 12
# 判定"叠回去的 RGB 与源图不一致"的每通道差阈值
RGB_MISMATCH_THRESHOLD = 8
# 小于这个 px 的层 = **可疑的假部件**（上一轮的假左耳是 11 px）
FAKE_PART_PX = 30


def load_layers(d):
    out = {}
    for f in sorted(os.listdir(d)):
        if not f.endswith(".png"):
            continue
        name = f.split("_", 1)[1].rsplit(".", 1)[0]
        order = int(f.split("_", 1)[0])
        im = np.array(Image.open(os.path.join(d, f)).convert("RGBA"))
        out[name] = {"file": f, "order": order, "rgba": im, "alpha": im[..., 3] > 127}
    return out


def bbox(mask):
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        return None
    return [int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())]


def composite(layers):
    """按绘制序自底向上叠：返回 (rgb, covered)。"""
    if not layers:
        return None, None
    items = sorted(layers.values(), key=lambda L: L["order"])
    h, w = items[0]["rgba"].shape[:2]
    rgb = np.zeros((h, w, 3), np.uint8)
    cov = np.zeros((h, w), bool)
    for L in items:
        a = L["alpha"]
        rgb[a] = L["rgba"][..., :3][a]
        cov |= a
    return rgb, cov


def source_foreground(src_path):
    src = np.array(Image.open(src_path).convert("RGB"))
    bg = np.concatenate([src[0, 0], src[0, -1], src[-1, 0], src[-1, -1]]).reshape(4, 3)
    bg = np.median(bg, axis=0).astype(int)
    diff = np.abs(src.astype(int) - bg).max(2)
    return src, diff > BG_DIFF_THRESHOLD


def biggest_components(mask, top=4):
    import cv2
    n, lab, st, ce = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    comps = sorted([(int(st[i, cv2.CC_STAT_AREA]),
                     [int(st[i, 1]), int(st[i, 1] + st[i, 3] - 1),
                      int(st[i, 0]), int(st[i, 0] + st[i, 2] - 1)]) for i in range(1, n)],
                   reverse=True)
    return comps[:top]


def analyse(tag, ldir, samdir):
    layers = load_layers(ldir)
    rec = {"tag": tag, "layerdir": os.path.abspath(ldir), "layers": {}}
    for name, L in layers.items():
        rec["layers"][name] = {"file": L["file"], "order": L["order"],
                               "px": int(L["alpha"].sum()), "bbox": bbox(L["alpha"])}

    # ② COMPOSITE vs SOURCE
    src, fg = source_foreground(os.path.join(samdir, "input.png"))
    comp, cov = composite(layers)
    if comp is not None:
        gap = fg & (~cov)
        mismatch = cov & fg & (np.abs(comp.astype(int) - src.astype(int)).max(2) > RGB_MISMATCH_THRESHOLD)
        rec["composite"] = {
            "layer_count": len(layers),
            "canvas": [int(src.shape[0]), int(src.shape[1])],
            "composite_alpha_px": int(cov.sum()),
            "source_fg_px": int(fg.sum()),
            "gap_px": int(gap.sum()),
            "gap_top_components": biggest_components(gap),
            "rgb_mismatch_px": int(mismatch.sum()),
            "rgb_mismatch_top_components": biggest_components(mismatch),
        }

    # ③ 嘴区归属：按绘制序取最上面的覆盖层
    if "mouth" in layers:
        mm = layers["mouth"]["alpha"]
        owners = {}
        for name, L in layers.items():
            owners[name] = int((mm & L["alpha"]).sum())
        # 逐像素：找覆盖每个嘴像素的最高序层
        order_sorted = sorted(layers.values(), key=lambda L: -L["order"])
        top_owner = {}
        remaining = mm.copy()
        for L in order_sorted:
            hit = remaining & L["alpha"]
            if hit.any():
                top_owner[L["file"]] = int(hit.sum())
                remaining &= ~hit
        rec["mouth_ownership"] = {"mouth_px": int(mm.sum()),
                                  "top_owner_by_draw_order": top_owner,
                                  "coverage_by_layer": owners}

    # ④ 假部件
    rec["tiny_layers"] = {n: v["px"] for n, v in rec["layers"].items() if v["px"] < FAKE_PART_PX}
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--old", required=True, help="改前的层目录")
    ap.add_argument("--new", required=True, help="改后的层目录")
    ap.add_argument("--samdir", required=True)
    ap.add_argument("--old-result", default=None, help="改前的 result.json（取 hole_px）")
    ap.add_argument("--new-result", default=None, help="改后的 result.json（取 hole_px）")
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    old = analyse("old", args.old, args.samdir)
    new = analyse("new", args.new, args.samdir)
    holes = {}
    for key, p in (("old", args.old_result), ("new", args.new_result)):
        if p and os.path.exists(p):
            r = json.load(open(p))
            holes[key] = {k: v.get("hole_px") for k, v in r.get("per_part", {}).items()}

    rec = {"script": "34_layer_regression.py", "samdir": os.path.abspath(args.samdir),
           "old": old, "new": new, "holes": holes,
           "thresholds": {"bg_diff": BG_DIFF_THRESHOLD,
                          "rgb_mismatch": RGB_MISMATCH_THRESHOLD,
                          "fake_part_px": FAKE_PART_PX}}
    if args.json:
        os.makedirs(os.path.dirname(args.json), exist_ok=True)
        json.dump(rec, open(args.json, "w"), indent=2, ensure_ascii=False)

    def row(n):
        o = old["layers"].get(n, {})
        w = new["layers"].get(n, {})
        oh = (holes.get("old") or {}).get(n, "-")
        wh = (holes.get("new") or {}).get(n, "-")
        print(f"  {n:12s} | {str(o.get('order','-')):>4s}→{str(w.get('order','-')):<4s} "
              f"| {str(o.get('px','-')):>7s}→{str(w.get('px','-')):<7s} "
              f"| {str(oh):>7s}→{str(wh):<7s} "
              f"| {str(o.get('bbox','-')):>26s} → {str(w.get('bbox','-')):<26s}")

    print(f"=== 逐部件回归 | old={args.old} | new={args.new} ===")
    print("  部件         | 序 改前→改后 | px 改前→改后      | hole 改前→改后    | bbox 改前 → 改后")
    for n in sorted(set(old["layers"]) | set(new["layers"])):
        row(n)
    for key in ("old", "new"):
        c = rec[key]["composite"]
        print(f"  COMPOSITE[{key}] 层数={c['layer_count']} 覆盖={c['composite_alpha_px']} px  "
              f"源前景={c['source_fg_px']} px  缺口={c['gap_px']} px "
              f"（最大块 {c['gap_top_components'][0] if c['gap_top_components'] else None}）  "
              f"RGB 不一致={c['rgb_mismatch_px']} px")
    for key in ("old", "new"):
        mo = rec[key].get("mouth_ownership")
        if mo:
            print(f"  嘴区归属[{key}] 嘴 {mo['mouth_px']} px → 最上面覆盖层逐层：{mo['top_owner_by_draw_order']}")
    for key in ("old", "new"):
        print(f"  可疑小层[{key}]（<{FAKE_PART_PX} px）：{rec[key]['tiny_layers'] or '无'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
