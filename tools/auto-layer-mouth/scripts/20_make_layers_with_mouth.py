#!/usr/bin/env python3
"""20_make_layers_with_mouth.py —— 把「嘴」从同一条 SAM 19 类路线里拆出来（真跑）

任务代号 LAYER-MOUTH 步骤 ②，路线 A。

背景（步骤 ① 已定案，见 out/10_probe_mouth_location.json）：
  · SAM 的 19 类里**本来就有 `mouth`（索引 8）**，且两轮实测都命中；
  · 但 auto-layer 的 33_make_layers.py 用 `--min-px 200` 把 test_image1 的 19 px 嘴滤掉了
    → 出层清单里没有 mouth → 12 层里嘴落在 030_face 里（表现为"焊死"）。

本脚本**不改 auto-layer/**，只在自己的目录里重做同一件事，并把两个变量参数化：
  · `--min-px`：降到 16（默认 200 是丢掉嘴的直接原因）
  · `--hole-mode`：
      all   = 完全照 33_make_layers.py 的算法（补全区 = 其它部件并集 ∩ 本部件外接框）
      above = 修正判据（补全区只由**画在本部件之上**的部件构成）
    🔴 为什么要 `above`：`all` 的补全区把"画在**下面**的脸"误当成"盖住嘴的东西"，
       于是 LaMa 会把嘴外接框内的脸像素重画成嘴 → **小部件被膨胀**（嘴层变成一小块脸）。
       `above` 是通用算法（遮挡关系由绘制序决定），不是针对嘴的补丁。

🔴 绘制序（`--order-mode`）：
    upstream = 照抄 33_make_layers.py 的 DRAW_ORDER 表（hair=10 在**最底**）
    fixed    = 修正表（hair_front 在最上；脸 < 鼻 < 嘴 < 眼 < 眉），与 image2live2d 的
               hair_front=120 / face_base=30 / eye=50 一致
  只有 `above` 模式需要绘制序；`all` 模式与原版逐字等价。

用法：
  PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python
  $PY scripts/20_make_layers_with_mouth.py --samdir <auto-layer/out/sam/sam_mps_test1> \
      --tag mouth_all --min-px 16 --hole-mode all
  $PY scripts/20_make_layers_with_mouth.py --samdir ... --tag mouth_above --min-px 16 --hole-mode above
"""
import argparse
import json
import os
import resource
import shutil
import sys
import time
import traceback

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MOUTH_ROOT = os.path.dirname(HERE)
AUTO = os.path.join(os.path.dirname(MOUTH_ROOT), "auto-layer")          # 🔴 只读
OUT = os.path.join(MOUTH_ROOT, "out")
EVID = os.path.join(MOUTH_ROOT, "evidence")
VENDOR = os.path.join(AUTO, "vendor", "see-through")
sys.path.insert(0, os.path.join(VENDOR, "common"))
sys.path.insert(0, VENDOR)
sys.path.insert(0, os.path.join(VENDOR, "annotators"))

LABELS = ['hair', 'headwear', 'face', 'eyes', 'eyewear', 'ears', 'earwear', 'nose',
          'mouth', 'neck', 'neckwear', 'topwear', 'handwear', 'bottomwear', 'legwear',
          'footwear', 'tail', 'wings', 'objects']
CKPT = "/Users/wujunjie/dsh-scratch/auto-layer/weights/lama_anime_512.ckpt"

# 照抄 auto-layer/scripts/33_make_layers.py 的表（用于 --order-mode upstream）
UPSTREAM_ORDER = {
    'hair': 10, 'headwear': 130, 'face': 30, 'eyes': 60, 'eyewear': 70,
    'ears': 55, 'earwear': 56, 'nose': 45, 'mouth': 50, 'neck': 25,
    'neckwear': 26, 'topwear': 20, 'handwear': 65, 'bottomwear': 15,
    'legwear': 12, 'footwear': 11, 'tail': 8, 'wings': 9, 'objects': 140,
}
# 修正表：hair 在**最上**（刘海盖脸），脸部特征按 脸<鼻<嘴<眼<眉 排
FIXED_ORDER = {
    'tail': 8, 'wings': 9, 'hair_back': 10,
    'legwear': 12, 'footwear': 11, 'bottomwear': 15,
    'topwear': 20, 'neckwear': 26, 'neck': 25,
    'handwear': 65, 'earwear': 56, 'ears': 55,
    'face': 30, 'nose': 45, 'mouth': 50, 'eyes': 55, 'eyewear': 70,
    'headwear': 110, 'objects': 140,
    'hair': 120,                       # 🔴 刘海在最上（upstream 表把它放在最底，是它最大的问题）
}
BILATERAL = {"eyes", "ears", "handwear", "legwear"}


def rss_mb():
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024), 1)


def split_lr(alpha_bool, min_px=200):
    import cv2
    n, labels, stats, cents = cv2.connectedComponentsWithStats(
        (alpha_bool > 0).astype(np.uint8), connectivity=8)
    if n <= 1:
        return None
    idx = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= min_px]
    if len(idx) < 2:
        return None
    idx.sort(key=lambda i: -stats[i, cv2.CC_STAT_AREA])
    a, b = idx[0], idx[1]
    l, r = (a, b) if cents[a][0] <= cents[b][0] else (b, a)
    return (labels == l), (labels == r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default="mps", choices=["mps", "cpu"])
    ap.add_argument("--samdir", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--ckpt", default=CKPT)
    ap.add_argument("--pad", type=float, default=0.10)
    ap.add_argument("--min-px", type=int, default=16)
    ap.add_argument("--hole-mode", default="above", choices=["all", "above"])
    ap.add_argument("--order-mode", default="fixed", choices=["upstream", "fixed"])
    ap.add_argument("--no-lama", action="store_true", help="只出可见区（不补全），用于对照")
    args = ap.parse_args()

    order = UPSTREAM_ORDER if args.order_mode == "upstream" else FIXED_ORDER

    outdir = os.path.join(OUT, "layers", args.tag)
    ldir = os.path.join(outdir, "layers")
    if os.path.isdir(ldir):
        shutil.rmtree(ldir)
    os.makedirs(ldir, exist_ok=True)

    import torch

    rec = {"script": "20_make_layers_with_mouth.py", "tag": args.tag,
           "device": args.device, "samdir": os.path.abspath(args.samdir),
           "min_px": args.min_px, "hole_mode": args.hole_mode,
           "order_mode": args.order_mode, "no_lama": args.no_lama,
           "torch": torch.__version__, "started": time.strftime("%Y-%m-%d %H:%M:%S"),
           "per_part": {}}

    def stage(name, fn):
        t0 = time.time()
        try:
            r = fn()
            print(f"  [OK  ] {name:28s} {time.time()-t0:7.2f}s")
            return r
        except Exception as e:  # noqa: BLE001
            rec.setdefault("errors", {})[name] = {"error": f"{type(e).__name__}: {str(e)[:400]}",
                                                  "traceback": traceback.format_exc()[-1500:]}
            print(f"  [FAIL] {name:28s} {time.time()-t0:7.2f}s -> {type(e).__name__}: {str(e)[:200]}")
            return None

    img = np.array(Image.open(os.path.join(args.samdir, "input.png")).convert("RGB"))
    H, W = img.shape[:2]
    rec["image_shape"] = [H, W, 3]

    mdir = os.path.join(args.samdir, "masks")
    masks = {}
    for f in sorted(os.listdir(mdir)):
        if not f.endswith(".png"):
            continue
        i = int(f.split("_")[0])
        a = np.array(Image.open(os.path.join(mdir, f)).convert("RGBA"))[..., 3]
        masks[LABELS[i]] = a > 127

    parts = [p for p in LABELS if p in masks and int(masks[p].sum()) >= args.min_px]
    rec["parts"] = parts
    rec["parts_dropped_by_min_px"] = [p for p in LABELS
                                      if p in masks and 0 < int(masks[p].sum()) < args.min_px]
    print(f"=== {args.tag} | {args.samdir}")
    print(f"  参与分层 {len(parts)} 个：{parts}")
    print(f"  被 min_px={args.min_px} 丢掉：{rec['parts_dropped_by_min_px']}")

    units = []
    for p in parts:
        if p in BILATERAL:
            sp = split_lr(masks[p], args.min_px)
            if sp is None:
                units.append((p, masks[p], order.get(p, 99)))
            else:
                lm, rm = sp
                units.append((f"{p}_l", lm, order.get(p, 99)))
                units.append((f"{p}_r", rm, order.get(p, 99)))
        else:
            units.append((p, masks[p], order.get(p, 99)))
    rec["units"] = [u[0] for u in units]

    lama = None
    if not args.no_lama:
        def _load_lama():
            from lama_inpainter import LamaFourier
            import lama_inpainter as LI
            m = LamaFourier(build_discriminator=False, use_mpe=False, large_arch=True)
            sd = torch.load(args.ckpt, map_location="cpu", weights_only=False)
            m.generator.load_state_dict(sd["gen_state_dict"])
            m.eval().to(args.device)
            LI.model = m
            return m
        lama = stage("load_lama", _load_lama)
        if lama is None:
            return 4
    from lama_inpainter import apply_inpaint

    def occluders_of(name):
        """本部件的遮挡物集合。
        all   → 其它所有部件（= 33_make_layers.py 原样）
        above → 只取绘制序**严格大于**本部件序的部件（遮挡关系由绘制序决定）"""
        if args.hole_mode == "all":
            o = np.zeros((H, W), dtype=bool)
            for other, om, _ in units:
                if other != name:
                    o |= om
            return o
        my_order = dict((n, od) for n, _, od in units)[name]
        o = np.zeros((H, W), dtype=bool)
        for other, om, od in units:
            if other != name and od > my_order:
                o |= om
        return o

    total_t0 = time.time()
    for name, m, od in units:
        def _one(name=name, m=m, od=od):
            others = occluders_of(name)
            ys, xs = np.nonzero(m)
            y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
            py = int((y1 - y0) * args.pad); px = int((x1 - x0) * args.pad)
            box = np.zeros((H, W), dtype=bool)
            box[max(0, y0 - py):min(H, y1 + py + 1), max(0, x0 - px):min(W, x1 + px + 1)] = True
            hole = others & box & (~m)
            alpha = ((m | hole).astype(np.uint8)) * 255
            if hole.sum() < 16 or args.no_lama:
                out = img
                dt = 0.0
            else:
                t0 = time.time()
                out = apply_inpaint(img, (hole.astype(np.uint8) * 255),
                                    device=args.device, precision=torch.float32)
                if args.device == "mps":
                    torch.mps.synchronize()
                dt = time.time() - t0
            Image.fromarray(np.dstack([out, alpha])).save(os.path.join(ldir, f"{od:03d}_{name}.png"))
            return dt, int(hole.sum()), int(alpha.sum() // 255)

        r = stage(f"layer:{name}", _one)
        if r is None:
            rec["per_part"][name] = {"ok": False}
            continue
        dt, hole_px, alpha_px = r
        rec["per_part"][name] = {"ok": True, "inpaint_s": round(dt, 2), "hole_px": hole_px,
                                 "visible_px": int(m.sum()), "alpha_px": alpha_px,
                                 "inflation": round(alpha_px / max(1, int(m.sum())), 3),
                                 "order": od}

    rec["total_inpaint_s"] = round(time.time() - total_t0, 2)
    rec["rss_peak_mb"] = rss_mb()
    if args.device == "mps":
        rec["mps_current_allocated_mb"] = round(torch.mps.current_allocated_memory() / 1e6, 1)
    rec["layer_files"] = len([f for f in os.listdir(ldir) if f.endswith(".png")])
    rec["verdict"] = "跑通"
    rec["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
    os.makedirs(outdir, exist_ok=True)
    json.dump(rec, open(os.path.join(outdir, "result.json"), "w"), indent=2, ensure_ascii=False)

    # 接触表：逐件展示（棋盘底看 alpha）
    tiles = []
    for f in sorted(os.listdir(ldir)):
        if not f.endswith(".png"):
            continue
        a = np.array(Image.open(os.path.join(ldir, f)).convert("RGBA"))
        h, w = a.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w]
        checker = np.where(((yy // 12 + xx // 12) % 2)[..., None] == 0,
                           np.array([210, 210, 210], np.uint8), np.array([160, 160, 160], np.uint8))
        al = (a[..., 3:4].astype(np.float32) / 255.0)
        comp = (a[..., :3] * al + checker * (1 - al)).astype(np.uint8)
        # 标注（画左上角色块，避免依赖字体）
        comp[0:18, 0:18] = [255, 0, 255] if "mouth" in f else ([0, 200, 255] if "nose" in f else [0, 0, 0])
        tiles.append((f, comp))
    if tiles:
        cols = 4
        rows = (len(tiles) + cols - 1) // cols
        th = max(t[1].shape[0] for t in tiles)
        tw = max(t[1].shape[1] for t in tiles)
        gap = 6
        sheet = np.full((rows * (th + gap) + gap, cols * (tw + gap) + gap, 3), 40, np.uint8)
        for i, (n, t) in enumerate(tiles):
            r, c = divmod(i, cols)
            y = gap + r * (th + gap); x = gap + c * (tw + gap)
            sheet[y:y + t.shape[0], x:x + t.shape[1]] = t
        Image.fromarray(sheet).save(os.path.join(EVID, f"20_contact_{args.tag}.png"))
        rec["contact_sheet"] = f"evidence/20_contact_{args.tag}.png"

    json.dump(rec, open(os.path.join(outdir, "result.json"), "w"), indent=2, ensure_ascii=False)
    print(f"\n结论：{rec['verdict']} | 出层 {rec['layer_files']} 个 | 补全总耗时 {rec['total_inpaint_s']}s "
          f"| RSS 峰值 {rec['rss_peak_mb']} MB")
    for n, v in rec["per_part"].items():
        if v.get("ok"):
            print(f"    {n:12s} 可见 {v['visible_px']:7d} → alpha {v['alpha_px']:7d} px "
                  f"(膨胀 ×{v['inflation']}, hole {v['hole_px']})")
    print(f"产出：{ldir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
