#!/usr/bin/env python3
"""30_crop_zoom.py —— 把宿主的截图裁出「眼」「嘴」两个区域并放大，做逐像素目视证据

为什么需要：`mouth-iso` 报的 changedPixels 只有 200–300 像素（0.05%），
在 720×720 的整图上**肉眼看不见**。所以要按差异 bbox 裁出来放大，才谈得上"看画面"。
本脚本不生成新事实，只把已有证据裁开放大 —— 数据源一律是 `mouth-iso` 的 JSON。
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
TOOL = HERE.parent
OUT = TOOL / "out" / "zoom"
PAD = 26          # 差异 bbox 外扩，保证"嘴/眼周围"也看得见
SCALE = 6         # 最近邻放大倍数（不引入插值假色）

# 🔴 宿主 clients/live2d-host 及其 evidence/ 目录**不在本仓库内**分发；
#    mouth-iso 的 JSON/PNG 证据需由使用者自备（放进 out/evidence/ 或设 MOUTH_ISO_EVID）。


def main(models: list[str]) -> int:
    # 🔴 EVID（mouth-iso 的 JSON 与 PNG 证据）来自外部宿主 clients/live2d-host/evidence/，
    #    该宿主**不在本仓库内**分发。请把它（或等价证据目录）放到本工具的 out/evidence/ 下，
    #    或设置环境变量 MOUTH_ISO_EVID 指向它；缺失即**响亮失败**退出。
    evid_dir = os.environ.get("MOUTH_ISO_EVID")
    EVID_local = Path(evid_dir) if evid_dir else (TOOL / "out" / "evidence")
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for m in models:
        jp = EVID_local / f"mouthiso_{m}.json"
        if not jp.is_file():
            print(f"[FAIL] 找不到宿主证据文件：{jp}\n"
                  f"       把 clients/live2d-host/evidence/ 下对应模型文件放到此处，"
                  f"或设置 MOUTH_ISO_EVID 指向它。", file=sys.stderr)
            return 2
        j = json.loads(jp.read_text())
        bbox = j["closedVsOpen"]["bbox"]
        if not bbox:
            print(f"[skip] {m}: closedVsOpen.bbox 为空（参数没驱动到任何像素）")
            continue
        box = (max(0, bbox["minX"] - PAD), max(0, bbox["minY"] - PAD),
               bbox["maxX"] + PAD, bbox["maxY"] + PAD)
        ims = {}
        for tag in ("closed", "open"):
            p = EVID_local / f"mouthiso_{m}_{tag}.png"
            if not p.is_file():
                print(f"[FAIL] 缺 {p}", file=sys.stderr)
                return 2
            ims[tag] = Image.open(p).convert("RGB").crop(box)
        w, h = ims["closed"].size
        sheet = Image.new("RGB", (w * 2 * SCALE, h * SCALE + 26), (255, 255, 255))
        for i, tag in enumerate(("closed", "open")):
            sheet.paste(ims[tag].resize((w * SCALE, h * SCALE), Image.NEAREST), (i * w * SCALE, 26))
        out = OUT / f"zoom_{m}_mouth.png"
        sheet.save(out)
        # 顺便把差异像素的原始 bbox 也画出来（放大图上叠一个细框，标出改动区）
        rows.append({"model": m, "bbox": bbox, "changedPixels": j["closedVsOpen"]["changedPixels"],
                     "changedRatio": j["closedVsOpen"]["changedRatio"],
                     "closedVsClosedAgain": j["closedVsClosedAgain"]["changedPixels"],
                     "sheet": str(out), "cropBox": list(box), "scale": SCALE})
        print(f"[ok] {m}: bbox={bbox} changed={j['closedVsOpen']['changedPixels']}px "
              f"→ {out.name}（左=闭合 右=张开，{SCALE}x 最近邻）")

    (OUT / "_zoom_index.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    args = sys.argv[1:] or ["p2l2char", "DS_p2l2"]
    raise SystemExit(main(args))
