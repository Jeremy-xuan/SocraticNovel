#!/usr/bin/env python3
"""10_probe_mouth_location.py —— 定案「嘴在哪一层」（只读 auto-layer/ 的产出，不改它）

任务代号 LAYER-MOUTH 步骤 ①。

三个问题，全部用程序化判据回答，不靠目视猜：
  Q1. SAM 19 类语义标签表逐字是什么？有没有 mouth / lip 类？（从上游源码读，不抄二手）
  Q2. 12 层的 alpha 加起来，分母（原立绘的不透明区）有没有没被覆盖的像素？
  Q3. 嘴部区域的像素落在哪一层？

用法：
  PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python
  $PY scripts/10_probe_mouth_location.py
"""
import json
import os
import sys
import time
from collections import Counter

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MOUTH_ROOT = os.path.dirname(HERE)
AUTO = os.path.join(os.path.dirname(MOUTH_ROOT), "auto-layer")   # 🔴 只读
OUT = os.path.join(MOUTH_ROOT, "out")
EVID = os.path.join(MOUTH_ROOT, "evidence")
sys.path.insert(0, os.path.join(AUTO, "vendor", "see-through", "common"))

os.makedirs(OUT, exist_ok=True)
os.makedirs(EVID, exist_ok=True)


def sha16(p):
    import hashlib
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()[:16]


def label_table():
    """逐字读上游源码里的 19 类表——不凭记忆写。"""
    from live2d.scrap_model import VALID_BODY_PARTS_V2, VALID_BODY_PARTS_V1, VALID_BODY_PARTS_V3
    src = os.path.join(AUTO, "vendor", "see-through", "common", "live2d", "scrap_model.py")
    return {
        "source_file": src,
        "source_sha16": sha16(src),
        "V2_len": len(VALID_BODY_PARTS_V2),
        "V2": list(VALID_BODY_PARTS_V2),
        "V2_indexed": {i: n for i, n in enumerate(VALID_BODY_PARTS_V2)},
        "V1": list(VALID_BODY_PARTS_V1),
        "V3": list(VALID_BODY_PARTS_V3),
        "has_mouth_in_V2": "mouth" in VALID_BODY_PARTS_V2,
        "mouth_index_in_V2": VALID_BODY_PARTS_V2.index("mouth") if "mouth" in VALID_BODY_PARTS_V2 else None,
        "lip_like_tokens_V2": [n for n in VALID_BODY_PARTS_V2
                               if any(t in n.lower() for t in ("mouth", "lip"))],
    }


def load_sam_masks(samdir, labels):
    """读 SAM 逐类掩码 PNG（auto-layer 已落盘），返回 {label: bool[H,W]} + 逐类统计。"""
    mdir = os.path.join(samdir, "masks")
    masks, stats = {}, {}
    for f in sorted(os.listdir(mdir)):
        if not f.endswith(".png"):
            continue
        i = int(f.split("_")[0])
        a = np.array(Image.open(os.path.join(mdir, f)).convert("RGBA"))[..., 3] > 127
        name = labels[i]
        masks[name] = a
        ys, xs = np.nonzero(a)
        stats[name] = {
            "class_index": i,
            "pixels": int(a.sum()),
            "bbox_y0y1x0x1": [int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())] if a.sum() else None,
            "centroid_yx": [round(float(ys.mean()), 1), round(float(xs.mean()), 1)] if a.sum() else None,
        }
    return masks, stats


def load_layers(ldir):
    """读 12 层 RGBA；返回 [(文件名, 绘制序, alpha_bool, rgb)]，按绘制序排序。"""
    out = []
    for f in sorted(os.listdir(ldir)):
        if not f.endswith(".png"):
            continue
        a = np.array(Image.open(os.path.join(ldir, f)).convert("RGBA"))
        order = int(f.split("_")[0])
        out.append((f, order, a[..., 3] > 127, a[..., :3]))
    out.sort(key=lambda t: (t[1], t[0]))
    return out


def foreground_by_floodfill(rgb, thresh=245):
    """把「接近白」且与边框连通的区域判为背景，其余为前景。
    用途：给「原立绘的不透明区」一个不依赖 SAM 的独立估计（第二种分母）。"""
    import cv2
    h, w = rgb.shape[:2]
    near_white = (rgb.min(axis=2) >= thresh).astype(np.uint8)
    # 从四边连通的近白像素开始，标成背景
    ff = near_white.copy()
    mask = np.zeros((h + 2, w + 2), np.uint8)
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        if ff[seed[1], seed[0]] == 1:
            cv2.floodFill(ff, mask, seed, 2)
    bg = ff == 2
    return ~bg


def upscale(img, k):
    im = Image.fromarray(img)
    return im.resize((im.width * k, im.height * k), Image.NEAREST)


def main():
    rec = {"script": "10_probe_mouth_location.py", "started": time.strftime("%Y-%m-%d %H:%M:%S")}

    # ---------- Q1：19 类标签表 ----------
    lt = label_table()
    rec["Q1_label_table"] = lt
    print("=== Q1 · SAM 19 类标签表（逐字，来源 %s @ %s）===" % (os.path.basename(lt["source_file"]), lt["source_sha16"]))
    for i, n in lt["V2_indexed"].items():
        mark = "   <<< 嘴" if n == "mouth" else ""
        print(f"  {i:2d}  {n}{mark}")
    print(f"  → V2 共 {lt['V2_len']} 类；含 mouth = {lt['has_mouth_in_V2']}（索引 {lt['mouth_index_in_V2']}）")

    labels = lt["V2"]

    for tag in ("sam_mps_test1", "sam_mps_ourasset"):
        samdir = os.path.join(AUTO, "out", "sam", tag)
        if not os.path.isdir(samdir):
            continue
        res = json.load(open(os.path.join(samdir, "result.json")))
        print(f"\n=== Q1b · 实测命中：{tag}（{res['srcp']}）===")
        masks, stats = load_sam_masks(samdir, labels)
        rec.setdefault("Q1b_hits", {})[tag] = {
            "srcp": res["srcp"], "shape": res["image_shape"],
            "per_class_pixels_full": {k: v["pixels"] for k, v in stats.items()},
            "per_class_stats": stats,
        }
        for name, st in sorted(stats.items(), key=lambda kv: kv[1]["class_index"]):
            if st["pixels"]:
                print(f"  {st['class_index']:2d} {name:12s} {st['pixels']:7d} px  bbox={st['bbox_y0y1x0x1']}")
        mp = stats.get("mouth", {}).get("pixels", 0)
        print(f"  → mouth 类实测像素 = {mp}")

    # ---------- Q2 / Q3：只在 light_mps 上做 ----------
    lroot = os.path.join(AUTO, "out", "layers", "light_mps")
    ldir = os.path.join(lroot, "layers")
    lres = json.load(open(os.path.join(lroot, "result.json")))
    samdir = lres["samdir"]
    tag = os.path.basename(samdir)
    srcp = os.path.join(samdir, "input.png")
    rgb = np.array(Image.open(srcp).convert("RGB"))
    H, W = rgb.shape[:2]
    masks, stats = load_sam_masks(samdir, labels)
    layers = load_layers(ldir)

    rec["Q2_inputs"] = {
        "layer_dir": ldir, "layer_result_json": os.path.join(lroot, "result.json"),
        "samdir": samdir, "srcp": srcp, "shape": [H, W, 3],
        "n_layer_files": len(layers),
        "layer_files": [f for f, _, _, _ in layers],
        "make_layers_min_px_default": 200,
        "make_layers_min_px_used": lres.get("pad") and 200,
        "sam_masks_used_by_33": lres["parts"],
    }
    print(f"\n=== Q2 · alpha 加总 / 分母覆盖（{tag}，12 层）===")
    print(f"  33_make_layers.py 实际出层的 SAM 类：{lres['parts']}")
    print(f"  → mouth 在出层清单里吗：{'mouth' in lres['parts']}")

    union_alpha = np.zeros((H, W), dtype=bool)
    per_layer = []
    for f, order, ab, _ in layers:
        union_alpha |= ab
        per_layer.append({"file": f, "order": order, "alpha_px": int(ab.sum())})
    rec["Q2_layers"] = per_layer

    fg = foreground_by_floodfill(rgb)
    sam_union = np.zeros((H, W), dtype=bool)
    for m in masks.values():
        sam_union |= m

    denominators = {
        "整张画布（RGB 无 alpha ⇒ 全画布都算不透明）": np.ones((H, W), dtype=bool),
        "白底泛洪估计的前景（不依赖 SAM）": fg,
        "SAM 19 类并集（SAM 认为的角色区）": sam_union,
    }
    cov = {}
    for dname, dm in denominators.items():
        d = int(dm.sum())
        covered = int((dm & union_alpha).sum())
        uncov = dm & ~union_alpha
        cov[dname] = {
            "denominator_px": d,
            "covered_px": covered,
            "uncovered_px": d - covered,
            "uncovered_ratio": round((d - covered) / d, 6) if d else None,
        }
        print(f"  分母「{dname}」: {d} px → 被 12 层覆盖 {covered} px，"
              f"未覆盖 {d - covered} px（{(d - covered) / d * 100:.2f}%）")
    rec["Q2_coverage"] = cov

    # 未覆盖像素落在哪（按行分带，看是不是整块背景）
    unc = denominators["白底泛洪估计的前景（不依赖 SAM）"] & ~union_alpha
    if unc.sum():
        import cv2
        n, lab, st, cen = cv2.connectedComponentsWithStats(unc.astype(np.uint8), connectivity=8)
        blobs = sorted([{"area": int(st[i, cv2.CC_STAT_AREA]),
                         "bbox_yx": [int(st[i, cv2.CC_STAT_TOP]), int(st[i, cv2.CC_STAT_LEFT]),
                                     int(st[i, cv2.CC_STAT_HEIGHT]), int(st[i, cv2.CC_STAT_WIDTH])]}
                        for i in range(1, n)], key=lambda b: -b["area"])[:12]
        rec["Q2_uncovered_blobs_top12"] = blobs
        print(f"  前景里未覆盖像素 {int(unc.sum())} px，最大 12 个连通块：")
        for b in blobs[:6]:
            print(f"    area={b['area']:6d}  bbox(y,h,x,w)={b['bbox_yx']}")

    # ---------- Q3：嘴部像素归属 ----------
    print(f"\n=== Q3 · 嘴部像素落在哪一层（按绘制序取最上面的覆盖层）===")
    mouth = masks.get("mouth", np.zeros((H, W), dtype=bool))
    mouth_px = int(mouth.sum())
    rec["Q3_mouth_px"] = mouth_px

    owner = np.full((H, W), -1, dtype=np.int16)
    for idx, (f, order, ab, _) in enumerate(layers):
        owner[ab] = idx  # 后画的覆盖前面的 → 最终 owner = 最上面一层

    q3 = {"mouth_px": mouth_px}
    if mouth_px:
        owners = owner[mouth]
        cnt = Counter(int(o) for o in owners)
        detail = []
        for oi, c in cnt.most_common():
            detail.append({
                "layer": layers[oi][0] if oi >= 0 else "（无层覆盖）",
                "px": int(c),
            })
        q3["ownership"] = detail
        q3["mouth_bbox_y0y1x0x1"] = stats["mouth"]["bbox_y0y1x0x1"]
        q3["mouth_centroid_yx"] = stats["mouth"]["centroid_yx"]
        print(f"  mouth 共 {mouth_px} px，bbox={q3['mouth_bbox_y0y1x0x1']}，质心={q3['mouth_centroid_yx']}")
        for d in detail:
            print(f"    → {d['layer']:26s} {d['px']:6d} px")
        # 同法看 face 层：嘴是否被 face 层 alpha 收进去
        face_ab = dict((f, ab) for f, _, ab, _ in layers).get("030_face.png")
        if face_ab is not None:
            q3["mouth_inside_030_face_alpha"] = int((mouth & face_ab).sum())
            print(f"  嘴部像素同时落在 030_face.png 的 alpha 内：{q3['mouth_inside_030_face_alpha']} / {mouth_px}")
    rec["Q3_mouth_ownership"] = q3

    # 顺带把其它"人脸上该有但没有独立层"的部位也查一遍
    extra = {}
    for name in ("nose", "eyewear", "headwear", "earwear", "neckwear"):
        m = masks.get(name)
        if m is None:
            continue
        p = int(m.sum())
        o = Counter(int(owner[m]) for _ in [0]) if False else (Counter(int(x) for x in owner[m]) if p else Counter())
        extra[name] = {"pixels": p,
                       "owned_by": [{"layer": layers[i][0] if i >= 0 else "（无层覆盖）", "px": int(c)}
                                    for i, c in o.most_common()]}
    rec["Q3_other_parts"] = extra
    for k, v in extra.items():
        print(f"  {k:10s} {v['pixels']:7d} px  → {v['owned_by']}")

    # ---------- 证据图 ----------
    # ① 脸部放大（原图）＋ ② 嘴掩码轮廓叠加 ＋ ③ 030_face 层同区放大
    fys, fxs = np.nonzero(masks["face"])
    fy0, fy1, fx0, fx1 = fys.min(), fys.max(), fxs.min(), fxs.max()
    pad = 30
    y0, y1 = max(0, fy0 - pad), min(H, fy1 + pad)
    x0, x1 = max(0, fx0 - pad), min(W, fx1 + pad)
    crop_rgb = rgb[y0:y1, x0:x1].copy()
    ov = crop_rgb.copy()
    mm = mouth[y0:y1, x0:x1]
    ov[mm] = [255, 0, 255]
    face_ab = dict((f, ab) for f, _, ab, _ in layers).get("030_face.png")
    face_crop = None
    if face_ab is not None:
        fa = face_ab[y0:y1, x0:x1]
        face_crop = np.where(fa[..., None], rgb[y0:y1, x0:x1], np.array([30, 30, 30], np.uint8))

    tiles = [("SOURCE 脸部", crop_rgb), ("mouth 掩码(品红)", ov)]
    if face_crop is not None:
        tiles.append(("030_face.png 的 alpha", face_crop.astype(np.uint8)))
    gap = 8
    ch, cw = crop_rgb.shape[:2]
    K = 3
    sheet = np.full((ch, cw * len(tiles) + gap * (len(tiles) - 1), 3), 255, np.uint8)
    for i, (_, t) in enumerate(tiles):
        sheet[:, i * (cw + gap):i * (cw + gap) + cw] = t
    upscale(sheet, K).save(os.path.join(EVID, "01_face_mouth_ownership_x%d.png" % K))
    upscale(ov, 6).save(os.path.join(EVID, "01_mouth_mask_overlay_x6.png"))
    rec["evidence"] = ["evidence/01_face_mouth_ownership_x3.png", "evidence/01_mouth_mask_overlay_x6.png"]
    rec["face_crop_bbox_y0y1x0x1"] = [int(y0), int(y1), int(x0), int(x1)]

    # 只有 19 px 时的可疑性检查：嘴掩码的形状/颜色 vs 脸平均色
    if mouth_px:
        mcol = rgb[mouth].mean(axis=0)
        fcol = rgb[masks["face"]].mean(axis=0)
        rec["Q3_color_check"] = {"mouth_mean_rgb": [round(float(v), 1) for v in mcol],
                                 "face_mean_rgb": [round(float(v), 1) for v in fcol],
                                 "delta": [round(float(a - b), 1) for a, b in zip(mcol, fcol)]}
        print(f"  颜色核对：嘴区均值 {rec['Q3_color_check']['mouth_mean_rgb']} vs 脸均值 {rec['Q3_color_check']['face_mean_rgb']}"
              f"（Δ={rec['Q3_color_check']['delta']}）")

    rec["verdict_note"] = "见报告 §一；判据 = Q1 标签表 + Q2 alpha 加总 + Q3 像素归属"
    rec["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
    p = os.path.join(OUT, "10_probe_mouth_location.json")
    json.dump(rec, open(p, "w"), indent=2, ensure_ascii=False)
    print(f"\n落盘：{p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
