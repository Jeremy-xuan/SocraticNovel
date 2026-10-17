#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""闸门自检：阳性对照（把已知缺陷人为造出来，看闸门认不认）。

真样本里能当阳性对照的只有三处（C_P1 的成片重叠、r1_A_P1 的标签重叠、
r1_C_P3 的副标题被压住）。另外两类在 24 个真样本里**没有真实阳性**：

  · 「元素整段消失」——上一轮报告说 C_P3 末帧少了一行，逐像素复核证明那一行在
    （见实现报告 §4），所以真样本里没有阳性；
  · 「箭头/连线缺失」——上一轮报告说 r1_B_P2 缺箭头，逐像素复核证明箭头在
    （见实现报告 §4），所以真样本里也没有阳性。

没有阳性就无法证明判据"能响"。这里用**人为突变**补上：把画面里那块墨迹抹掉，
再让闸门跑一遍。这是自检，不是验收样本。

用法：
    python3 selftest_positive_controls.py [--out DIR]

退出码 0 = 全部对照符合预期；1 = 有对照不符合预期。
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

import animation_gate as ag

# 外部 PoC 目录及其子目录由 main() 从 --poc 或环境变量 SOCRATIC_ANIMATION_POC 解析；
# 缺失时响亮退出，不猜测旧路径。
POC: Path | None = None
R2: Path | None = None
R1: Path | None = None
RAW2: Path | None = None
RAW1: Path | None = None


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)}\n{p.stderr[-1500:]}")


def blackout(video: Path, out: Path, boxes: list[tuple[int, int, int, int]]) -> None:
    """把画面里若干矩形区域涂黑（用于制造"整段消失"）。"""
    vf = ",".join(f"drawbox=x={x}:y={y}:w={w}:h={h}:color=black@1.0:t=fill"
                  for (x, y, w, h) in boxes)
    run(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-vf", vf,
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)])


def synth_clip(out: Path, with_arrow: bool) -> None:
    """合成一小段：黑底 + 一行白字（+ 可选的红箭头）。

    用来给 D3（箭头缺失）做阳性/阴性对照——真样本里没有缺箭头的例子。
    """
    tmp = out.parent / (out.stem + "_frames")
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    for i in range(20):
        im = Image.new("RGB", (854, 480), (0, 0, 0))
        d = ImageDraw.Draw(im)
        d.rectangle([300, 200, 380, 230], outline=(255, 255, 255), width=2)
        d.text((310, 210), "timer", fill=(255, 255, 255))
        if with_arrow:
            d.line([(390, 215), (560, 130)], fill=(252, 98, 85), width=5)
            d.polygon([(560, 130), (540, 140), (548, 118)], fill=(252, 98, 85))
        im.save(tmp / f"f_{i:03d}.png")
    run(["ffmpeg", "-v", "error", "-y", "-framerate", "15", "-i", str(tmp / "f_%03d.png"),
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)])


SCRIPT_WITH_ARROW = '''
from manim import *


class T(Scene):
    def construct(self):
        box = Rectangle(width=1.0, height=0.5, color=WHITE)
        arr = Arrow([-1, 0, 0], [2, 1, 0], buff=0.1, color=RED, stroke_width=5)
        self.play(Create(box), Create(arr))
        self.wait(1)
'''

SCRIPT_NO_CREATE = '''
from manim import *


class T(Scene):
    def construct(self):
        box = Rectangle(width=1.0, height=0.5, color=WHITE)
        arr = Arrow([-1, 0, 0], [2, 1, 0], buff=0.1, color=RED, stroke_width=5)
        self.play(Create(box))
        self.wait(1)
'''


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--poc", type=Path, default=None,
                    help="外部 PoC 目录（也可经环境变量 SOCRATIC_ANIMATION_POC 提供）")
    ap.add_argument("--out", type=Path, default=ag.HERE / "runs" / "selftest")
    a = ap.parse_args()
    poc = a.poc or os.environ.get("SOCRATIC_ANIMATION_POC")
    if not poc:
        print("错误：未指定外部 PoC 目录。请用 --poc <dir> 或环境变量 "
              "SOCRATIC_ANIMATION_POC 指向它。", file=sys.stderr)
        return 2
    global POC, R2, R1, RAW2, RAW1
    POC = Path(poc)
    if not POC.exists():
        print(f"错误：PoC 目录不存在：{POC}", file=sys.stderr)
        return 2
    R2 = POC / "media2/videos"
    R1 = POC / "media_final/mp4"
    RAW2 = POC / "raw2"
    RAW1 = POC / "raw"
    a.out.mkdir(parents=True, exist_ok=True)
    cases = []

    # ---- 对照 1：C_P3 两行「平均周转时间」整段抹掉 → D2 必须报"整段消失"
    src = R2 / "C_P3/480p15/C_P3.mp4"
    mut = a.out / "mut_C_P3_no_avg.mp4"
    blackout(src, mut, [(80, 220, 480, 32), (80, 366, 480, 32)])
    v = ag.gate_one(mut, RAW2 / "C_P3.py", a.out / "gate_C_P3_no_avg", False)
    cases.append(("D2 整段消失（人为抹掉两行）", "D2", "block", v))

    # ---- 对照 2：同一段视频不动 → D2 不应报"整段消失"
    v0 = ag.gate_one(src, RAW2 / "C_P3.py", a.out / "gate_C_P3_orig", False)
    cases.append(("D2 阴性对照（原片）", "D2", "none", v0))

    # ---- 对照 3：脚本里声明了箭头却不 play → D3 静态判据必须报
    sc = a.out / "script_arrow_never_played.py"
    sc.write_text(SCRIPT_NO_CREATE, encoding="utf-8")
    good = a.out / "synth_arrow.mp4"
    synth_clip(good, True)
    v = ag.gate_one(good, sc, a.out / "gate_arrow_unplayed", False)
    cases.append(("D3 声明了却没 play（静态）", "D3", "block", v))

    # ---- 对照 4：画面里没有箭头（但脚本说应该有）→ D3 画面判据必须报
    sc2 = a.out / "script_arrow.py"
    sc2.write_text(SCRIPT_WITH_ARROW, encoding="utf-8")
    noarrow = a.out / "synth_noarrow.mp4"
    synth_clip(noarrow, False)
    v = ag.gate_one(noarrow, sc2, a.out / "gate_arrow_missing", False)
    cases.append(("D3 画面里箭头没了（像素）", "D3", "block", v))

    # ---- 对照 5：画面里有箭头 → D3 不应误报
    v = ag.gate_one(good, sc2, a.out / "gate_arrow_ok", False)
    cases.append(("D3 阴性对照（箭头在）", "D3", "none", v))

    # ---- 对照 6/7：真样本里唯二的两处画面层缺陷，必须报
    v = ag.gate_one(R1 / "C_P3.mp4", RAW1 / "C_P3.py", a.out / "gate_r1C_P3", False)
    cases.append(("真实缺陷：r1_C_P3 副标题被压住", "D4", "block", v))
    v = ag.gate_one(R1 / "A_P1.mp4", RAW1 / "A_P1.py", a.out / "gate_r1A_P1", False)
    cases.append(("真实缺陷：r1_A_P1 两个标签重叠", "D4", "block", v))

    rows, ok = [], True
    for title, kind, want, v in cases:
        got = "none"
        for f in v["findings"]:
            if f["kind"] == kind and f.get("severity") == "block":
                got = "block"
                break
        hit = (got == want)
        ok = ok and hit
        rows.append({"case": title, "expect": want, "got": got, "pass": hit,
                     "verdict": v["verdict"], "blocking": v["blocking_count"]})
        print(f"[{'OK ' if hit else 'FAIL'}] {title:34s} 期望 {want:5s} 实得 {got:5s} "
              f"（闸门 {v['verdict']}）")

    (a.out / "selftest.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1),
                                         encoding="utf-8")
    print(f"\n自检结果：{'全部符合预期' if ok else '有对照不符合预期'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
