#!/usr/bin/env python3
"""30_split_face_features.py —— 从 SAM 的 `eyes` 掩码里再拆出 眼白/虹膜/瞳孔/睫毛，并找眉毛

任务代号 LAYER-MOUTH 步骤 ②，路线 B（**零新权重、零新依赖**：只用 SAM 已出的掩码 ＋ 颜色/几何）。

诚实边界（写在前面，别当结论用）：
  · SAM 的 19 类里**没有** `eyebrow` / `eye_white` / `pupil` / `iris`（逐字见 scrap_model.py 的
    VALID_BODY_PARTS_V2）。所以这些**不是"分割出来的"，是"从 `eyes` 掩码内部按颜色/几何再切出来的"**。
  · `eyes` 掩码内部再切 → 切出来的东西**不会超过 SAM 给的眼睛范围**；SAM 没框住的部分切不出来。
  · 眉毛是**启发式搜索**（脸框内、眼上方、比脸暗、不是头发）→ 结果标 `heuristic=true`，
    必须目视复核。它的替代方案见报告（V3 23 类表里有 `eyebrow`，但没有公开 checkpoint）。

用法：
  PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python
  $PY scripts/30_split_face_features.py --samdir <auto-layer/out/sam/sam_mps_ourasset> --tag ourasset
"""
import argparse
import json
import os
import sys
import time

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MOUTH_ROOT = os.path.dirname(HERE)
AUTO = os.path.join(os.path.dirname(MOUTH_ROOT), "auto-layer")      # 🔴 只读
OUT = os.path.join(MOUTH_ROOT, "out")
EVID = os.path.join(MOUTH_ROOT, "evidence")

LABELS = ['hair', 'headwear', 'face', 'eyes', 'eyewear', 'ears', 'earwear', 'nose',
          'mouth', 'neck', 'neckwear', 'topwear', 'handwear', 'bottomwear', 'legwear',
          'footwear', 'tail', 'wings', 'objects']


def load_masks(samdir):
    mdir = os.path.join(samdir, "masks")
    m = {}
    for f in sorted(os.listdir(mdir)):
        if f.endswith(".png"):
            i = int(f.split("_")[0])
            a = np.array(Image.open(os.path.join(mdir, f)).convert("RGBA"))[..., 3]
            m[LABELS[i]] = a > 127
    return m


def split_lr(mask, min_px=20):
    import cv2
    n, lab, st, cen = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    idx = [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= min_px]
    if len(idx) < 2:
        return None
    idx.sort(key=lambda i: -st[i, cv2.CC_STAT_AREA])
    a, b = idx[0], idx[1]
    l, r = (a, b) if cen[a][0] <= cen[b][0] else (b, a)
    return (lab == l), (lab == r)


def kmeans_rgb(px, k=3, seed=0):
    """在掩码内部像素上做 k-means（只用 sklearn，已装），按亮度排序返回。"""
    from sklearn.cluster import KMeans
    km = KMeans(n_clusters=k, n_init=10, random_state=seed).fit(px.astype(np.float32))
    cents = km.cluster_centers_
    order = np.argsort(cents.mean(axis=1))          # 暗 → 亮
    return km.labels_, cents[order], order


def find_eyebrows(rgb, face, eyes, hair, mouth):
    """启发式找眉毛：脸框内、眼睛上方的一条带里，比脸暗、且不属于头发/眼睛/嘴的横向细长连通域。

    🔴 这是启发式，不是分割模型输出。返回掩码 + 每个候选的统计，供目视复核。
    """
    import cv2
    H, W = rgb.shape[:2]
    ys, xs = np.nonzero(face)
    if len(ys) == 0:
        return np.zeros((H, W), bool), []
    fy0, fy1, fx0, fx1 = ys.min(), ys.max(), xs.min(), xs.max()
    ey, ex = np.nonzero(eyes)
    if len(ey) == 0:
        return np.zeros((H, W), bool), []
    ey_top = ey.min()
    fh = fy1 - fy0
    # 眉带：眼睛上缘之上、脸高的 0~28% 之间（经验带，写进 JSON 供复核）
    band_y0 = max(fy0, ey_top - int(0.28 * fh))
    band_y1 = max(fy0 + 1, ey_top - 2)
    if band_y1 <= band_y0:
        return np.zeros((H, W), bool), []
    band = np.zeros((H, W), bool)
    band[band_y0:band_y1, fx0:fx1 + 1] = True

    face_px = rgb[face]
    med = np.median(face_px, axis=0)
    lum = rgb.astype(np.float32).mean(axis=2)
    face_lum_med = float(np.median(lum[face]))
    cand = band & (lum < face_lum_med - 25) & (~hair) & (~eyes) & (~mouth)
    n, lab, st, cen = cv2.connectedComponentsWithStats(cand.astype(np.uint8), connectivity=8)
    out = np.zeros((H, W), bool)
    info = []
    for i in range(1, n):
        x, y, w, h, area = (st[i, cv2.CC_STAT_LEFT], st[i, cv2.CC_STAT_TOP],
                            st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT], st[i, cv2.CC_STAT_AREA])
        ar = w / max(1, h)
        if area < 20 or ar < 1.8:          # 眉毛是横向细长条
            continue
        out |= (lab == i)
        info.append({"area": int(area), "bbox_xywh": [int(x), int(y), int(w), int(h)],
                     "aspect": round(float(ar), 2),
                     "mean_rgb": [round(float(v), 1) for v in rgb[lab == i].mean(axis=0)]})
    info.sort(key=lambda d: -d["area"])
    info = info[:4]
    return out, {"band_rows": [int(band_y0), int(band_y1)],
                 "face_lum_median": round(face_lum_med, 1),
                 "lum_cut": round(face_lum_med - 25, 1),
                 "face_median_rgb": [round(float(v), 1) for v in med],
                 "candidates": info}


def comp(mask, rgb, bg=(200, 200, 200)):
    H, W = mask.shape
    yy, xx = np.mgrid[0:H, 0:W]
    checker = np.where(((yy // 10 + xx // 10) % 2)[..., None] == 0,
                       np.array([210, 210, 210], np.uint8), np.array([165, 165, 165], np.uint8))
    a = mask[..., None].astype(np.float32)
    return (rgb * a + checker * (1 - a)).astype(np.uint8)


def up(img, k):
    im = Image.fromarray(img)
    return np.array(im.resize((im.width * k, im.height * k), Image.NEAREST))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samdir", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--k", type=int, default=3)
    args = ap.parse_args()

    rgb = np.array(Image.open(os.path.join(args.samdir, "input.png")).convert("RGB"))
    H, W = rgb.shape[:2]
    masks = load_masks(args.samdir)
    rec = {"script": "30_split_face_features.py", "tag": args.tag,
           "samdir": os.path.abspath(args.samdir), "k": args.k,
           "started": time.strftime("%Y-%m-%d %H:%M:%S"),
           "note": "eyes 内部再切 + 眉毛启发式；不是语义分割模型的输出"}

    eyes = masks["eyes"]
    sp = split_lr(eyes, min_px=20)
    rec["eyes_split_ok"] = sp is not None
    pairs = [("l", sp[0]), ("r", sp[1])] if sp else [("all", eyes)]
    parts = {}
    for side, em in pairs:
        px = rgb[em]
        labels, cents, order = kmeans_rgb(px, k=args.k)
        rec.setdefault("eyes_kmeans", {})[side] = {
            "pixels": int(em.sum()),
            "centers_dark_to_bright": [[round(float(v), 1) for v in c] for c in cents],
        }
        # 按亮度命名：最暗=睫毛/描边，最亮=眼白，中间=虹膜（+瞳孔在其内部最暗处）
        rank = {int(order[i]): i for i in range(len(order))}      # 原始簇 id → 0(暗)/1/2(亮)
        lbl_img = np.full((H, W), -1, dtype=np.int8)
        lbl_img[em] = np.array([rank[int(v)] for v in labels], dtype=np.int8)
        eyelash = lbl_img == 0
        iris = lbl_img == 1
        eye_white = lbl_img == 2
        # 瞳孔：虹膜内最暗的 30%，取最靠近虹膜质心的那一块
        pupil = np.zeros((H, W), bool)
        if iris.sum() > 20:
            import cv2
            iy, ix = np.nonzero(iris)
            ilum = rgb[iris].astype(np.float32).mean(axis=1)
            thr = np.quantile(ilum, 0.30)
            dark = np.zeros((H, W), bool)
            dark[iy[ilum <= thr], ix[ilum <= thr]] = True
            n, lab, st, cen = cv2.connectedComponentsWithStats(dark.astype(np.uint8), connectivity=8)
            if n > 1:
                cy, cx = iy.mean(), ix.mean()
                best = min(range(1, n), key=lambda i: (cen[i][0] - cx) ** 2 + (cen[i][1] - cy) ** 2)
                pupil = lab == best
        parts[f"eye_white_{side}"] = eye_white
        parts[f"iris_{side}"] = iris
        parts[f"pupil_{side}"] = pupil
        parts[f"eyelash_{side}"] = eyelash
        rec["eyes_kmeans"][side]["pixels_per_role"] = {
            "eyelash(darkest)": int(eyelash.sum()), "iris(mid)": int(iris.sum()),
            "eye_white(brightest)": int(eye_white.sum()), "pupil(inside iris)": int(pupil.sum())}

    brow, brow_info = find_eyebrows(rgb, masks["face"], eyes, masks.get("hair", np.zeros((H, W), bool)),
                                    masks.get("mouth", np.zeros((H, W), bool)))
    rec["eyebrow_heuristic"] = brow_info
    rec["eyebrow_pixels"] = int(brow.sum())
    if brow.sum():
        parts["eyebrow_heuristic"] = brow

    # 落盘逐件 RGBA
    odir = os.path.join(OUT, "face_features", args.tag)
    os.makedirs(odir, exist_ok=True)
    for k, m in parts.items():
        a = np.zeros((H, W, 4), np.uint8)
        a[..., :3] = rgb
        a[..., 3] = np.where(m, 255, 0).astype(np.uint8)
        Image.fromarray(a).save(os.path.join(odir, f"{k}.png"))
    rec["files"] = sorted(parts.keys())

    # 接触表：脸部裁剪 + 各件放大
    ys, xs = np.nonzero(masks["face"])
    pad = 20
    y0, y1 = max(0, ys.min() - pad), min(H, ys.max() + pad)
    x0, x1 = max(0, xs.min() - pad), min(W, xs.max() + pad)
    tiles = [("SOURCE", rgb[y0:y1, x0:x1])]
    for k in ("eye_white_l", "eye_white_r", "iris_l", "iris_r", "pupil_l", "pupil_r",
              "eyelash_l", "eyelash_r"):
        if k in parts:
            tiles.append((k, comp(parts[k][y0:y1, x0:x1], rgb[y0:y1, x0:x1])))
    if "eyebrow_heuristic" in parts:
        tiles.append(("eyebrow(heur)", comp(parts["eyebrow_heuristic"][y0:y1, x0:x1], rgb[y0:y1, x0:x1])))
    if "mouth" in masks:
        tiles.append(("mouth(SAM)", comp(masks["mouth"][y0:y1, x0:x1], rgb[y0:y1, x0:x1])))

    cols = 4
    rows = (len(tiles) + cols - 1) // cols
    th = max(t[1].shape[0] for t in tiles); tw = max(t[1].shape[1] for t in tiles)
    K = 2
    gap = 6
    sheet = np.full((rows * (th + gap) + gap, cols * (tw + gap) + gap, 3), 40, np.uint8)
    for i, (n, t) in enumerate(tiles):
        r, c = divmod(i, cols)
        sheet[gap + r * (th + gap):gap + r * (th + gap) + t.shape[0],
              gap + c * (tw + gap):gap + c * (tw + gap) + t.shape[1]] = t
    p = os.path.join(EVID, f"30_face_features_{args.tag}_x{K}.png")
    Image.fromarray(up(sheet, K)).save(p)
    rec["contact_sheet"] = os.path.relpath(p, MOUTH_ROOT)
    rec["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
    json.dump(rec, open(os.path.join(OUT, f"30_face_features_{args.tag}.json"), "w"),
              indent=2, ensure_ascii=False)

    print(f"=== {args.tag} | eyes 拆左右: {rec['eyes_split_ok']}")
    for side in rec.get("eyes_kmeans", {}):
        d = rec["eyes_kmeans"][side]
        print(f"  eyes_{side}: {d['pixels']} px  簇心(暗→亮)={d['centers_dark_to_bright']}")
        print(f"    {d['pixels_per_role']}")
    print(f"  眉毛（启发式）: {rec['eyebrow_pixels']} px  band={brow_info.get('band_rows')} "
          f"cut={brow_info.get('lum_cut')} 候选={len(brow_info.get('candidates', []))}")
    print(f"  接触表：{rec['contact_sheet']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
