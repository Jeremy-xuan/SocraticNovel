#!/usr/bin/env python3
"""50_wire_to_i2l.py —— 接线：本轮「轻量路线」出的层 → image2live2d → 真 `.moc3`

只做**接线**，不改任何别人的树：
  · 读本目录 `out/layers/<tag>/layers/*.png`（33_make_layers.py 的产出）
  · 按 image2live2d 的命名契约改名（`{order}_{role}`，role 必须精确等于 `SemanticRole` 枚举值）
  · 调 image2live2d（**只读** `/tmp/p2l2/src/image2live2d-main`，那是 P2L-2 的产物）出 `.moc3`

🔴 契约（读 i2l 源码得来，不是猜的）：
  `core/decompose/sources.py:parse_layer_name()` 逐字要求 `{order}_{role}`，`head.isdigit()` 为假即
  `raise ValueError`；`from_layer_dir()` 逐字 `role = SemanticRole(role_str)`，role 必须精确等于枚举值。
  枚举值见 `irr/schema.py:SemanticRole`（33 个）。

🔴 本轮的**结构性缺口**（诚实记录，不掩盖）：
  SAM 的 19 类里「眼睛 / 耳朵 / 手 / 腿」各是**一块合并掩码**，而 i2l 要 `_l` / `_r` 分开。
  本脚本用**连通域 + 质心左右**做拆分（i2l 上游 `--tblr_split` 走的是深度，本轮没跑到那一步）。
  另：SAM 的 19 类里**没有** eyebrow / blush / eye_white / pupil → 这几个角色本轮填不上。

用法：
  $PY scripts/50_wire_to_i2l.py --layerdir out/layers/light_mps/layers --name saml2dchar
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
I2L_SRC = Path("/tmp/p2l2/src/image2live2d-main/src")

# 本轮部件 → i2l SemanticRole + 绘制顺序
#   33_make_layers.py 已经把双侧部件（eyes/ears/handwear/legwear）**在补全前**拆成 _l/_r，
#   也把 SAM 合并的 `hair` 拆成了 `hair_back` / `hair_front`（MOUTH-FIX-2），
#   所以这里是一张**平坦的直映表**（不再做连通域拆分）。
#
# 🔴 `mouth` / `nose` 是 MOUTH-FIX 补上的两行（上一版这张表里没有它们 →
#    即便 33 出了嘴层，这里也会走 else 分支**静默跳过**）。
#    角色名必须**逐字等于** i2l `irr/schema.py:SemanticRole` 的枚举值：`nose` / `mouth`
#    （枚举里本来就有，见 code/tools/auto-layer-mouth/evidence/prior_art_i2l_mouth_excerpts.md 〔E01〕）。
#    绘制序号取 i2l **自己**的规范层序（`samples.py` 的 spec，逐字注释 "back to front"：
#    hair_back 0 → leg 5/6 → arm 8/9 → torso 12 → clothing 13 → hair_side 20 → face_base 24
#    → eyebrow 40/41 → eye_white 50/51 → eye 52/53 → nose 55 → pupil 60/61 → mouth 70
#    → hair_front 90），不自己发明数字。
#
# 🔴 MOUTH-FIX-2 新增两行：`hair_back`(6) 与 `hair_front`(90)。
#    上一版把 SAM 合并的 `hair` 整块接到 `hair_front`(120) ⇒ **整块头发画在最上层、盖住整张脸**
#    ⇒ 真渲染器里驱动 ParamMouthOpenY 是 **0 px**（画面完全不动）。
#    现在按 i2l 自己的两个角色分开接：后发 6（最底）、前发 90（脸上面、仍在最上）。
SINGLE = {
    "hair":        ("hair_front",  90),   # 兜底：未拆的合并掩码仍按前发接（会盖脸，见 33 的警告）
    "hair_front":  ("hair_front",  90),
    "hair_back":   ("hair_back",    6),
    "face":        ("face_base",   24),
    "neck":        ("neck",        20),
    "topwear":     ("torso",       16),
    "bottomwear":  ("clothing",    14),
    "nose":        ("nose",        55),
    "mouth":       ("mouth",       70),
    "eyes_l":      ("eye_l",       52),
    "eyes_r":      ("eye_r",       52),
    "ears_l":      ("ear_l",       28),
    "ears_r":      ("ear_r",       28),
    "handwear_l":  ("arm_l",        8),
    "handwear_r":  ("arm_r",        8),
    "legwear_l":   ("leg_l",        5),
    "legwear_r":   ("leg_r",        6),
}
# 兜底：万一拿到的是**未拆**的合并掩码，退回连通域拆分
BILATERAL = {
    "eyes":     ("eye_l", "eye_r", 52),
    "ears":     ("ear_l", "ear_r", 28),
    "handwear": ("arm_l", "arm_r", 8),
    "legwear":  ("leg_l", "leg_r", 5),
}


def sha256(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def split_lr(alpha, min_px=200):
    """把一块二值掩码按连通域拆成左右两半。
    取面积最大的两个连通域，按质心 x 定左右。返回 (left_mask, right_mask) 或 None。"""
    import cv2
    n, labels, stats, cents = cv2.connectedComponentsWithStats(
        (alpha > 127).astype(np.uint8), connectivity=8)
    if n <= 1:
        return None
    idx = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= min_px]
    if len(idx) < 2:
        return None
    idx.sort(key=lambda i: -stats[i, cv2.CC_STAT_AREA])
    a, b = idx[0], idx[1]
    # 按质心 x 分左右（图像坐标：x 小＝画面左）
    if cents[a][0] <= cents[b][0]:
        l, r = a, b
    else:
        l, r = b, a
    return (labels == l), (labels == r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layerdir", required=True)
    ap.add_argument("--outdir", default=None,
                    help="改名层的输出根目录；默认 out/layers_i2l/<name>"
                         "（🔴 必须按 name 分目录：这个目录是**每个模型独有**的，"
                         "共用一个目录会让后跑的模型把先跑的改名层冲掉——实测踩过）")
    ap.add_argument("--name", default="saml2dchar")
    ap.add_argument("--i2l", default=str(I2L_SRC))
    args = ap.parse_args()

    i2l = Path(args.i2l)
    if not i2l.is_dir():
        print(f"[FAIL] 找不到 image2live2d 源码：{i2l}", file=sys.stderr)
        return 2

    src = Path(args.layerdir)
    files = sorted(f for f in os.listdir(src) if f.endswith(".png"))
    if not files:
        print(f"[FAIL] {src} 里没有 png", file=sys.stderr)
        return 2

    out = Path(args.outdir) if args.outdir else ROOT / "out" / "layers_i2l" / args.name
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    print(f"[1/4] 读本轮层：{src}（{len(files)} 个）")
    written = []
    skipped = []
    for f in files:
        part = f.split("_", 1)[1].rsplit(".", 1)[0]
        im = Image.open(src / f).convert("RGBA")
        arr = np.array(im)
        if part in SINGLE:
            role, order = SINGLE[part]
            dst = out / f"{order:03d}_{role}.png"
            im.save(dst)
            written.append((dst.name, f, "直映"))
        elif part in BILATERAL:
            lrole, rrole, order = BILATERAL[part]
            sp = split_lr(arr[..., 3])
            if sp is None:
                print(f"      [跳过] {part}：连通域不足两个，无法左右拆")
                skipped.append({"file": f, "why": "连通域不足两个，无法左右拆"})
                continue
            for mask, role in ((sp[0], lrole), (sp[1], rrole)):
                a2 = np.zeros_like(arr)
                a2[..., :3] = arr[..., :3]
                a2[..., 3] = np.where(mask, arr[..., 3], 0).astype(np.uint8)
                dst = out / f"{order:03d}_{role}.png"
                Image.fromarray(a2).save(dst)
                written.append((dst.name, f, "LR 拆分"))
        else:
            print(f"      [跳过] {part}：本轮没有对应的 i2l 角色映射")
            skipped.append({"file": f, "why": "没有对应的 i2l 角色映射"})

    print(f"      写出 {len(written)} 个层文件：")
    for n, s, how in written:
        print(f"        {n:24s} <- {s:20s} [{how}]")

    print(f"\n[2/4] 载入 image2live2d（只读 {i2l}）")
    sys.path.insert(0, str(i2l))
    from image2live2d.backends.live2d import Live2DEmitter
    from image2live2d.backends.live2d.moc3_emit import native_moc_writer
    from image2live2d.core import decompose
    from image2live2d.core.qa.capability import rig_capabilities
    from image2live2d.pipeline import rig_from_stack

    stack = decompose.from_layer_dir(str(out))
    print(f"      画布 {stack.canvas_width}x{stack.canvas_height}，{len(stack.layers)} 层")
    for l in stack.layers:
        print(f"        id={l.id:20s} role={l.semantic_role.value:12s} order={l.draw_order}")

    print("\n[3/4] rig 管线（mesh → rig → physics → motion）")
    rig = rig_from_stack(stack, name=args.name, source=str(out))
    print(f"      parts={len(rig.parts)} textures={len(rig.textures)} "
          f"parameters={len(rig.parameters)} physics={len(rig.physics)} "
          f"animations={len(rig.animations)}")

    # 🔴 能力表要**落盘**：闸门（60_mouth_gate.py）要能拿到"i2l 认为能不能开口"这个结论，
    #    用来和"真渲染器里画面有没有动"对照 —— 这两者不一致正是本轮要抓的静默失准。
    caps = rig_capabilities(rig).to_dict()
    print(f"      mouth_open={caps['capabilities'].get('mouth_open')} "
          f"mouth_form={caps['capabilities'].get('mouth_form')} "
          f"talk={'shipped' if 'talk' in caps['clips']['shipped'] else 'suppressed'}")

    print("\n[4/4] 导出（注入 native_moc_writer → 真写 .moc3）")
    dest = ROOT / "out" / "i2l" / args.name
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    bundle = Live2DEmitter(asset_root=out, moc_writer=native_moc_writer).build(rig, dest)
    moc = Path(str(bundle.moc3_path)) if getattr(bundle, "moc3_path", None) else None
    if moc is None:
        cands = list(dest.glob("*.moc3"))
        moc = cands[0] if cands else None
    rec = {"name": args.name, "layerdir": str(src), "renamed_dir": str(out),
           "n_layers_in": len(files), "n_layers_out": len(written),
           "layers": [{"file": n, "from": s, "how": h} for n, s, h in written],
           "skipped": skipped,
           "capabilities": caps,
           "mouth_layer": next(({"file": n, "from": s} for n, s, _ in written
                                if n.endswith("_mouth.png")), None),
           "moc_written": bool(getattr(bundle, "moc_written", False)),
           "moc3": None, "moc3_bytes": None, "moc3_head_hex": None}
    if moc and moc.exists():
        head = moc.read_bytes()[:8]
        rec["moc3"] = str(moc)
        rec["moc3_bytes"] = moc.stat().st_size
        rec["moc3_head_hex"] = head.hex().upper()
    (ROOT / "out" / "i2l").mkdir(parents=True, exist_ok=True)
    json.dump(rec, open(ROOT / "out" / "i2l" / f"{args.name}_wire.json", "w"),
              indent=2, ensure_ascii=False)

    if rec["moc3"]:
        print(f"\n✅ .moc3 = {rec['moc3']}  {rec['moc3_bytes']} B  头部 {rec['moc3_head_hex']}")
    else:
        print(f"\n❌ 没写出 .moc3（moc_written={rec['moc_written']}）")
    return 0 if rec["moc3"] else 5


if __name__ == "__main__":
    sys.exit(main())
