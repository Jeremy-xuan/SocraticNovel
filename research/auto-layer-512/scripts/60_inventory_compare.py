#!/usr/bin/env python3
"""60_inventory_compare.py —— 轻量路线 vs 重型 512² 的**机读对比台账**

它回答的是"值不值得用"里可以量化的一半：
  ① 两条路线各出了哪些部件（有没有嘴／眉／眼白／瞳孔）；
  ② 每个部件的 alpha 覆盖像素数（在原图坐标系里）；
  ③ **边缘过渡带宽**（像素）—— 这是"边缘糊不糊"的可比数字。

🔴 边缘指标怎么算（写清楚，免得被当成玄学）：
   对某层的 alpha 通道 a：
     · `b = (a > 127)`；`P` = b 的边界像素数（b 与其四邻不同的像素个数）≈ 周长；
     · `M` = 处于 `8 < a < 247` 的"过渡带"像素数；
     · **过渡带宽 = M / P**（单位：像素）。
   判读：**硬边 → 过渡带 ≈ 1–2 px；糊/锯齿 → 明显更宽**。
   这个量**与分辨率无关**（是"边缘有几像素宽"），所以两条路线可以直接比。
   另给 `soft_ratio = M / (#a>8)`：过渡像素占该层非透明像素的比例（越接近 0 越"刀切"）。

🔴 坐标系说明（必须写，否则数字会被误读）：
   · 轻量路线的层 = **原图分辨率**（928×1232）；
   · 重型 512² 的**所有**层（body 组与 head 组一样）= **512×512 的同一张画布**。
   → 所以"像素数"这一列两条路线**不可直接比**（重型要 ×2.41 才到原图尺度）；
     而 **"过渡带宽（px）"可以比**，因为它是"边缘有几像素宽"这个与分辨率无关的量。
   ⚠️ 踩过的误判：head 组**不是**"贴回原图比例"，它的输出同样在 512 画布坐标系里。

用法：
  PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python
  $PY scripts/60_inventory_compare.py \
      --heavy out/fullcall/full512_q30 --heavy-tag full512_q30 \
      --light  ../auto-layer/out/layers/light_mps/layers \
      --out out/inventory_compare.json
"""
import argparse
import json
import os
import os.path as osp

import numpy as np
from PIL import Image

INPUTS = {"src_img.png", "src_head.png"}
FACE_KEYS = ["mouth", "eyebrow", "eyewhite", "irides", "eyelash", "nose", "eyewear",
             "face", "ears", "headwear"]


def layer_stats(p):
    a = np.array(Image.open(p).convert("RGBA"))[..., 3]
    h, w = a.shape
    b = a > 127
    # 周长：b 与右/下邻不同的像素数 ×2（近似，够用且稳定）
    per = int((b[:, :-1] != b[:, 1:]).sum() + (b[:-1, :] != b[1:, :]).sum())
    m = int(((a > 8) & (a < 247)).sum())
    nz = int((a > 8).sum())
    return {"size": [w, h], "alpha_gt8_px": nz, "boundary_px": per,
            "transition_px": m,
            "edge_transition_width_px": round(m / per, 3) if per else None,
            "soft_ratio": round(m / nz, 4) if nz else None}


def scan(layerdir):
    out = {}
    for f in sorted(os.listdir(layerdir)):
        if not f.endswith(".png") or f in INPUTS:
            continue
        out[f[:-4]] = layer_stats(osp.join(layerdir, f))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--heavy", required=True)
    ap.add_argument("--heavy-tag", default="heavy")
    ap.add_argument("--light", required=True)
    ap.add_argument("--out", default="out/inventory_compare.json")
    args = ap.parse_args()

    heavy = scan(args.heavy)
    light = scan(args.light)

    def key(name):
        n = name.lower()
        for k in ["front hair", "back hair"]:
            if n == k:
                return "hair"
        return n

    hk = {key(k) for k in heavy}
    lk = {key(k) for k in light}

    res = {
        "heavy": {"tag": args.heavy_tag, "dir": osp.abspath(args.heavy),
                  "n_layers": len(heavy), "layers": heavy},
        "light": {"dir": osp.abspath(args.light), "n_layers": len(light), "layers": light},
        "only_heavy": sorted(hk - lk),
        "only_light": sorted(lk - hk),
        "both": sorted(hk & lk),
        "face_features_present": {k: (k in hk) for k in FACE_KEYS},
    }
    os.makedirs(osp.dirname(osp.abspath(args.out)), exist_ok=True)
    json.dump(res, open(args.out, "w"), indent=2, ensure_ascii=False)

    print(f"重型 {args.heavy_tag}: {len(heavy)} 层   轻量: {len(light)} 层")
    print(f"  只有重型有: {', '.join(res['only_heavy']) or '（无）'}")
    print(f"  只有轻量有: {', '.join(res['only_light']) or '（无）'}")
    print(f"  两边都有  : {', '.join(res['both'])}")
    print("\n  脸部件在重型里存不存在：" +
          "  ".join(f"{k}={'✅' if v else '❌'}" for k, v in res["face_features_present"].items()))
    print(f"\n{'部件':<16}{'重型 px':>10}{'重型边宽':>10}{'轻量 px':>10}{'轻量边宽':>10}")
    for k in sorted(set(list(heavy) + list(light))):
        h = heavy.get(k, {})
        l = light.get(k, {})
        print(f"{k:<16}{h.get('alpha_gt8_px', '-'):>10}{str(h.get('edge_transition_width_px', '-')):>10}"
              f"{l.get('alpha_gt8_px', '-'):>10}{str(l.get('edge_transition_width_px', '-')):>10}")
    print(f"\n台账 -> {osp.abspath(args.out)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
