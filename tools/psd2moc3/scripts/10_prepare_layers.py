#!/usr/bin/env python3
"""10_prepare_layers.py —— 把 P2L-1 的分层结果改写成 image2live2d 要求的 `{order}_{role}.png`

为什么需要这一步（不是"顺手整理"，是硬要求）：
  image2live2d 的 `core/decompose/sources.py:parse_layer_name()` 逐字要求文件名形如
  `{order}_{role}`（`head.isdigit()` 必须为真，否则直接 `raise ValueError`），
  且 `role` 必须**精确等于** `irr/schema.py:SemanticRole` 里的某个枚举值
  （`sources.py:80` 逐字 `role = SemanticRole(role_str)`，否则 `raise ValueError`）。

  P2L-1 产出的文件名是 `torso.png` / `eye_l.png` 这类**没有 order 前缀**的形式，
  语义上能对上，但**格式上过不了这一关**。所以本脚本只做"改名 + 排序号"，
  **不改任何像素**（改完立刻逐文件 sha256 复核，证明像素没动）。

输入：`../portrait2live/out/layers/*.png`（P2L-1 的分层结果，只读复用）
输出：`out/layers_i2l/{order}_{role}.png` ＋ `out/layers_i2l/_rename_map.json`
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOL = HERE.parent  # tools/psd2moc3

# 🔴 本仓库里 P2L-1 与 P2L-2 是 tools/ 下的同级目录：
#    tools/portrait2live/out/layers  ← P2L-1 的分层结果（需先跑 portrait2live）
#    tools/psd2moc3/out/layers_i2l   ← 本脚本输出
SRC = TOOL.parent / "portrait2live" / "out" / "layers"
DST = TOOL / "out" / "layers_i2l"

# P2L-1 层名 → (draw_order, image2live2d SemanticRole)
#   role 取值全部逐字取自 irr/schema.py:SemanticRole 枚举
#   draw_order 是"从后往前"的 z 序（数字小=先画=更靠后）
LAYER_MAP: dict[str, tuple[int, str]] = {
    "hair_back": (10, "hair_back"),    # 后发：最底
    "torso":     (20, "torso"),        # 躯干/肩：兜底层
    "face":      (30, "face_base"),    # 脸（含耳部皮肤）
    "mouth":     (40, "mouth"),        # 嘴
    "eye_l":     (50, "eye_l"),        # 左眼（含虹膜，P2L-1 未单独切瞳孔层）
    "eye_r":     (60, "eye_r"),        # 右眼
    "side_l":    (70, "hair_side"),    # 左侧发
    "side_r":    (80, "hair_side"),    # 右侧发 —— 🔴 见下方 note
    "bangs":     (120, "hair_front"),  # 刘海：最顶
}

# 🔴 side_r 的坑：SemanticRole 里 hair_side **没有左右之分**（枚举只有 hair_side），
#    所以两张侧发只能同 role。image2live2d 的 from_layer_dir 用 `id=png.stem` 做层 id，
#    文件名不同 → id 不同，不会互相覆盖。但**两条层会拿到同一套 hair_side 规则**，
#    物理/摆动会一起走 —— 这是本路线的一个已知粗糙点，写进报告。


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()


def main() -> int:
    if not SRC.is_dir():
        print(f"[FAIL] 找不到 P2L-1 分层目录：{SRC}", file=sys.stderr)
        return 2

    if DST.exists():
        shutil.rmtree(DST)
    DST.mkdir(parents=True)

    rows = []
    src_files = sorted(SRC.glob("*.png"))
    if not src_files:
        print(f"[FAIL] {SRC} 下没有 png", file=sys.stderr)
        return 2

    for p in src_files:
        if p.name.startswith("_"):
            # `_gen_closed_eye.png` / `_gen_closed_mouth.png` 是 P2L-1 为位图路线生成的差分图，
            # 不是"角色部件"，image2live2d 有自己合成闭眼/口腔内部的实现（core/synth/），
            # 所以这里**不搬**它们（搬了反而会被当成 unknown role 直接报错）。
            continue
        stem = p.stem
        if stem not in LAYER_MAP:
            print(f"[FAIL] {p.name} 不在 LAYER_MAP 里 —— 需要人工指定 role", file=sys.stderr)
            return 2
        order, role = LAYER_MAP[stem]
        dst = DST / f"{order:02d}_{role}.png"
        shutil.copy2(p, dst)
        s_src, s_dst = sha256(p), sha256(dst)
        ok = s_src == s_dst
        rows.append({"src": p.name, "dst": dst.name, "role": role, "order": order,
                     "sha256_src": s_src, "sha256_dst": s_dst, "pixel_identical": ok})
        print(f"[{'ok ' if ok else 'FAIL'}] {p.name:16s} -> {dst.name:20s} role={role:12s} "
              f"sha256={s_src[:16]}…")

    if not all(r["pixel_identical"] for r in rows):
        print("[FAIL] 有文件 sha256 不一致（拷贝过程动了内容）", file=sys.stderr)
        return 1

    # 尺寸自检：image2live2d 的 from_layer_dir 用"各层最大宽高"当画布，
    # 所以**每层必须同尺寸**，否则画布会被撑错。
    from PIL import Image
    sizes = {}
    for r in rows:
        with Image.open(DST / r["dst"]) as im:
            sizes[r["dst"]] = im.size
    uniq = set(sizes.values())
    if len(uniq) != 1:
        print(f"[FAIL] 图层尺寸不一致：{sizes}", file=sys.stderr)
        return 1

    map_path = DST / "_rename_map.json"
    map_path.write_text(json.dumps(
        {
            "source_dir": str(SRC),
            "canvas": list(uniq)[0],
            "note": "只改文件名（order_role），像素逐文件 sha256 复核未动；"
                    "role 取值逐字来自 image2live2d irr/schema.py:SemanticRole",
            "layers": rows,
        }, ensure_ascii=False, indent=2))

    print(f"\n[ok] {len(rows)} 层 → {DST}")
    print(f"[ok] 画布 {list(uniq)[0]}；改名映射 {map_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
