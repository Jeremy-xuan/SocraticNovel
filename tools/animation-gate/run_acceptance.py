#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""对 PoC 的 24 个样例跑闸门，产出"判定 vs 已知答案"的对照表。

用法：
    python3 run_acceptance.py [--round2] [--round1] [--out DIR]

输出：
    <out>/acceptance.json     每例的判定、命中类别、原始数字
    <out>/acceptance.md       人读对照表
    <out>/calib_lines.jsonl   全部"文字行"的填充率（阈值来源用）
    <out>/runs/<例>/          每例的闸门证据（contact_sheet.png / verdict.md / zoom/）
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import animation_gate as ag

# 外部 PoC 目录由 main() 从 --poc 或环境变量 SOCRATIC_ANIMATION_POC 解析；缺失时响亮退出。
ROOT: Path | None = None
NAMES = ["A_P1", "A_P2", "A_P3", "A_P4", "B_P1", "B_P2", "B_P3", "B_P4",
         "C_P1", "C_P2", "C_P3", "C_P4"]


def round2_paths(name: str) -> tuple[Path, Path]:
    return (ROOT / "media2/videos" / name / "480p15" / f"{name}.mp4",
            ROOT / "raw2" / f"{name}.py")


def round1_paths(name: str) -> tuple[Path, Path]:
    return ROOT / "media_final/mp4" / f"{name}.mp4", ROOT / "raw" / f"{name}.py"


def summarize(v: dict) -> dict:
    kinds = {}
    for f in v["findings"]:
        k = f["kind"]
        e = kinds.setdefault(k, {"block": 0, "warn": 0, "detail": []})
        e[f.get("severity", "warn")] += 1
        if len(e["detail"]) < 4:
            fr = f["frames"][0] if f.get("frames") else {"file": "-", "t": None}
            e["detail"].append({
                "severity": f.get("severity"),
                "count": f.get("count"),
                "t": fr["t"], "file": fr["file"],
                "x0": f.get("x0"), "x1": f.get("x1"), "y0": f.get("y0"), "y1": f.get("y1"),
                "sub": f.get("sub"), "hue_gap": f.get("hue_gap"),
                "a": f.get("a"), "b": f.get("b"),
                "victim": f.get("victim"), "fill": f.get("fill"),
                "expected": f.get("expected"), "measured_end": f.get("measured_end"),
                "fam_name": f.get("fam_name"),
            })
    return {"verdict": v["verdict"], "blocking": v["blocking_count"],
            "kinds": kinds, "n_findings": len(v["findings"])}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--poc", type=Path, default=None,
                    help="外部 PoC 目录（也可经环境变量 SOCRATIC_ANIMATION_POC 提供）")
    ap.add_argument("--out", type=Path, default=ag.HERE / "runs" / "acceptance")
    ap.add_argument("--only", default=None, help="只跑指定例，逗号分隔")
    a = ap.parse_args()
    poc = a.poc or os.environ.get("SOCRATIC_ANIMATION_POC")
    if not poc:
        print("错误：未指定外部 PoC 目录。请用 --poc <dir> 或环境变量 "
              "SOCRATIC_ANIMATION_POC 指向它。", file=sys.stderr)
        return 2
    global ROOT
    ROOT = Path(poc)
    if not ROOT.exists():
        print(f"错误：PoC 目录不存在：{ROOT}", file=sys.stderr)
        return 2
    a.out.mkdir(parents=True, exist_ok=True)
    calib = open(a.out / "calib_lines.jsonl", "w", encoding="utf-8")

    rows = []
    todo = []
    for rnd, getter in (("r2", round2_paths), ("r1", round1_paths)):
        for n in NAMES:
            if a.only and n not in a.only.split(","):
                continue
            todo.append((rnd, n, getter(n)))

    for rnd, name, (video, script) in todo:
        if not video.exists():
            print(f"[跳过] {rnd}/{name}：视频不存在 {video}", file=sys.stderr)
            continue
        outdir = a.out / "runs" / f"{rnd}_{name}"
        v = ag.gate_one(video, script if script.exists() else None, outdir, False, calib)
        for b in v["band_stats"]:
            calib.write(json.dumps({"sample": f"{rnd}_{name}", **b}, ensure_ascii=False) + "\n")
        sm = summarize(v)
        rows.append({"round": rnd, "name": name, **sm})
        print(f"[{rnd}] {name:5s} → {v['verdict']:5s} 阻断 {v['blocking_count']:2d}  "
              + " ".join(f"{k}:{d['block']}/{d['warn']}" for k, d in sorted(sm["kinds"].items())))
    calib.close()

    (a.out / "acceptance.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")

    L = ["# 闸门 × 24 例：判定汇总", "",
         "（`block` = 阻断级命中数，`warn` = 只送人工目视的命中数）", "",
         "| 轮 | 例 | 判定 | 阻断 | " + " | ".join(["D1 重叠", "D4 压住", "D2 消失", "D3 箭头"]) + " |",
         "|---|---|---|---|" + "---|" * 4]
    for r in rows:
        cells = []
        for k in ("D1", "D4", "D2", "D3"):
            d = r["kinds"].get(k)
            cells.append(f"{d['block']}/{d['warn']}" if d else "-")
        L.append(f"| {r['round']} | {r['name']} | {r['verdict']} | {r['blocking']} | "
                 + " | ".join(cells) + " |")
    (a.out / "acceptance.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"\n写出：{a.out}/acceptance.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
