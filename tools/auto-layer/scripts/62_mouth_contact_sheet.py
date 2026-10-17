#!/usr/bin/env python3
"""62_mouth_contact_sheet.py —— 闸门接触表：真渲染器里的「闭 / 开」对照（含 12× 放大）

任务代号 MOUTH-FIX 步骤 ②。**只用真渲染宿主的截图**（`out/host/evidence/mouthiso_*.png`），
不用 image2live2d 的近似软件光栅。

每行一个模型，四格：
  ① 整帧（闭档，缩略）  ② 嘴区 12×（闭档）  ③ 嘴区 12×（开档）  ④ 嘴区 12×（差异热图）
嘴区取哪：优先用探针给的 `closedVsOpen.bbox`（真有像素差时它才是准的）；
像素差为 0 的模型没有 bbox → **借用同几何的消融模型 bbox**（只差 hair 层的 alpha，
头部位姿与画布相同），并在 JSON 里逐行记明"bbox 来自谁"。

用法：
  PY="${AUTO_LAYER_PY:-${AUTO_LAYER_SCRATCH:-$HOME/dsh-scratch/auto-layer}/venv/bin/python}"
  $PY scripts/62_mouth_contact_sheet.py
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STAGE_EVID = os.path.join(ROOT, "out", "probe", "mouthiso_evidence")
EVID = os.path.join(ROOT, "evidence")

# (显示名, 探针名, bbox 来源模型)
#   🔴 MOUTH-FIX-2 起以 `fix2_*` 为主角（管线**原样**、不消融）；
#      `mouthfix_*` 是修前的历史对照（第三道闸未修，0 px），保留下来当"改前"那一行。
# 🔴 标签一律用 **ASCII**：PIL 的 `load_default()` 只有点阵 ASCII 字形，
#    画中文会变成一片方块（实测踩过：第一版标签全是 □）。中文说明放在报告与 JSON 索引里。
CASES = [
    ("1  FIXED  ourasset  (pipeline as-is, hair split)", "fix2_ourasset", None),
    ("2  CONTROL ourasset (same layers, mouth removed)", "fix2_nomouth_ourasset", "fix2_ourasset"),
    ("3  FIXED  test1     (pipeline as-is)", "fix2_test1", "fix2_ourasset"),
    ("4  CONTROL test1    (same layers, mouth removed)", "fix2_nomouth_test1", "fix2_test1"),
    ("5  BEFORE ourasset  (gate#3 unfixed: 0 px)", "mouthfix_ourasset", "fix2_ourasset"),
    ("6  BEFORE test1     (gate#3 unfixed: 0 px)", "mouthfix_test1", "fix2_test1"),
    ("7  BEFORE-ABL ourasset (hair inpaint off: 359 px)", "ablate_hairhole_ourasset", None),
    ("8  BEFORE-ABL test1    (hair inpaint off: 13 px)", "ablate_hairhole_test1", None),
]

ZOOM = 12
WIN_SIDE = 64       # 嘴区窗口边长（像素）→ 12× 后 768 px，各行同尺寸可比


def load(model):
    d = os.path.join(STAGE_EVID, model)
    p = os.path.join(d, f"mouthiso_{model}.json")
    if not os.path.exists(p):
        return None
    j = json.load(open(p))
    # 🔴 探针 JSON 里记的是**暂存区**的绝对路径，而暂存区每次运行都重建 →
    #    按 basename 从落盘副本旁边取（60_mouth_gate.py 已把三张 PNG 一起拷过来）。
    for k in ("closed", "open", "closedAgain"):
        local = os.path.join(d, os.path.basename(j["files"][k]))
        if not os.path.exists(local):
            return None
        j[k] = np.array(Image.open(local).convert("RGB"))
    return j


def mouth_box(j, fallback):
    """嘴区取一个**固定边长**的窗口（居中在 bbox 上）→ 各行格子一样大，肉眼可比。"""
    bb = j["closedVsOpen"]["bbox"]
    src = "own closedVsOpen.bbox"
    if bb is None and fallback is not None:
        fb = load(fallback)
        bb = fb["closedVsOpen"]["bbox"] if fb else None
        src = f"bbox borrowed from {fallback} (this model has 0 px diff -> no bbox)"
    if bb is None:
        h, w = j["closed"].shape[:2]
        cx, cy = w / 2, h / 2
        src = "fallback: canvas centre (no bbox available)"
    else:
        cx, cy = (bb["minX"] + bb["maxX"]) / 2, (bb["minY"] + bb["maxY"]) / 2
    h, w = j["closed"].shape[:2]
    half = WIN_SIDE / 2
    x0 = min(max(int(cx - half), 0), max(w - WIN_SIDE, 0))
    y0 = min(max(int(cy - half), 0), max(h - WIN_SIDE, 0))
    return (x0, y0, x0 + WIN_SIDE, y0 + WIN_SIDE), src, bb


def zoom(img, box, marker=None):
    c = Image.fromarray(img).crop(box).resize((WIN_SIDE * ZOOM, WIN_SIDE * ZOOM), Image.NEAREST)
    if marker:
        d = ImageDraw.Draw(c)
        x0 = (marker["minX"] - box[0]) * ZOOM
        y0 = (marker["minY"] - box[1]) * ZOOM
        d.rectangle([x0, y0, x0 + marker["w"] * ZOOM - 1, y0 + marker["h"] * ZOOM - 1],
                    outline=(0, 90, 255), width=2)
    return c


def heat(closed, open_, box):
    a = Image.fromarray(closed).crop(box)
    b = Image.fromarray(open_).crop(box)
    A, B = np.array(a).astype(int), np.array(b).astype(int)
    d = np.abs(A - B).max(axis=2)
    out = np.zeros((*d.shape, 3), dtype=np.uint8)
    out[..., 0] = np.clip(d * 4, 0, 255)                 # 差异 → 红
    out[..., 1] = np.array(a).mean(axis=2).astype(np.uint8) // 3
    out[..., 2] = np.array(a).mean(axis=2).astype(np.uint8) // 3
    return Image.fromarray(out).resize((d.shape[1] * ZOOM, d.shape[0] * ZOOM), Image.NEAREST), int((d > 8).sum())


def main():
    os.makedirs(EVID, exist_ok=True)
    try:
        from PIL import ImageFont
        font = ImageFont.load_default(size=17)
    except Exception:                                     # noqa: BLE001
        font = None
    rows, index = [], []
    for label, model, fb in CASES:
        j = load(model)
        if j is None:
            print(f"[跳过] {model}：没有探针输出")
            continue
        box, bbox_src, bb = mouth_box(j, fb)
        h, w = j["closed"].shape[:2]
        thumb = Image.fromarray(j["closed"]).resize((160, int(160 * h / w)), Image.LANCZOS)
        zc = zoom(j["closed"], box, bb)
        zo = zoom(j["open"], box, bb)
        zh, diff_in_box = heat(j["closed"], j["open"], box)
        cell_h = max(zc.height, thumb.height)
        row = Image.new("RGB", (thumb.width + 3 * zc.width + 30, cell_h + 26), (255, 255, 255))
        row.paste(thumb, (0, 22))
        for i, z in enumerate((zc, zo, zh)):
            row.paste(z, (thumb.width + 10 + i * (zc.width + 10), 22))
        d = ImageDraw.Draw(row)
        d.text((4, 4), f"{label}   render 0->1 diff = {j['closedVsOpen']['changedPixels']} px"
                       f"   mouth box {box} ({bbox_src})", fill=(0, 0, 0), font=font)
        d.text((4, 22 + cell_h - 14), "full frame (closed)", fill=(0, 0, 0), font=font)
        d.text((thumb.width + 10, 22 + cell_h - 14), f"mouth CLOSED x{ZOOM}", fill=(0, 0, 0), font=font)
        d.text((thumb.width + 20 + zc.width, 22 + cell_h - 14), f"mouth OPEN x{ZOOM}", fill=(0, 0, 0), font=font)
        d.text((thumb.width + 30 + 2 * zc.width, 22 + cell_h - 14), "diff heat map", fill=(0, 0, 0), font=font)
        rows.append(row)
        index.append({"label": label, "model": model, "changed_px": j["closedVsOpen"]["changedPixels"],
                      "reversible_px": j["closedVsClosedAgain"]["changedPixels"],
                      "box": box, "box_source": bbox_src,
                      "diff_px_in_box": diff_in_box,
                      "bbox": j["closedVsOpen"]["bbox"]})
        print(f"{model:26s} 0→1 像素差 {j['closedVsOpen']['changedPixels']:5d} px  盒 {box}  {bbox_src}")

    W = max(r.width for r in rows)
    sheet = Image.new("RGB", (W, sum(r.height + 8 for r in rows) + 40), (255, 255, 255))
    y = 34
    ImageDraw.Draw(sheet).text((4, 6), "MOUTH gate contact sheet - real render host (official Cubism framework + Core + WebGL) - mouth x12 - blue box = pixel-diff bbox",
                               fill=(0, 0, 0), font=font)
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height + 8
    out = os.path.join(EVID, "70_contact_mouth_gate_x12.png")
    sheet.save(out)
    json.dump(index, open(os.path.join(ROOT, "out", "probe", "70_contact_mouth_gate.json"), "w"),
              indent=2, ensure_ascii=False)
    print(f"\n产出：{out}  （{sheet.width}x{sheet.height}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
