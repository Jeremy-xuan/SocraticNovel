#!/usr/bin/env python3
"""70_collect_i2l_excerpts.py —— 把 image2live2d 里与「嘴」有关的原文摘录落成**稳定证据件**

为什么需要这一步：
  i2l 源码在 `/tmp/p2l2/src/image2live2d-main/`（P2L-2 的产物）—— **`/tmp` 会被清**，
  锚点表不能指向它（上一路 L2D-LAYER-GPU 的锚点表就是这么处理的）。
  但"i2l 本来就有 mouth 角色 / mouth_cavity / ParamMouthOpenY"这个结论**必须可核**，
  所以这里把**逐字原文**抄进本任务自己的 `evidence/` 目录，并记下源文件的 sha256 与行号。
  → 报告正文用锚点指向**这份摘录件**（它在本任务产出目录里，稳定），摘录件再给出原始出处。

用法：
  PY=/Library/Frameworks/Python.framework/Versions/3.13/bin/python3
  $PY scripts/70_collect_i2l_excerpts.py
"""
import hashlib
import json
import os
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
MOUTH_ROOT = HERE.parent
EVID = MOUTH_ROOT / "evidence"
OUT = MOUTH_ROOT / "out"
I2L = Path("/tmp/p2l2/src/image2live2d-main/src/image2live2d")

# (源文件相对 i2l 根, 锚点名, 说明, 起始行, 行数)
WANTED = [
    ("irr/schema.py", "E01", "SemanticRole 枚举里**本来就有** mouth / mouth_cavity / eyebrow_l/r / eye_white_l/r / pupil_l/r / blush / nose", 41, 22),
    ("irr/params.py", "E02", "标准参数表里的 ParamMouthForm / ParamMouthOpenY（含范围与默认值）", 34, 5),
    ("core/qa/capability.py", "E03", "能力发现判据：mouth_open 需要 ParamMouthOpenY **且** 有 mouth_cavity 角色", 108, 10),
    ("core/qa/capability.py", "E04", "没有腔体时的诚实告警文案（\"talk only parts the lip line\"）", 135, 3),
    ("core/synth/mouth.py", "E05", "为什么必须合成腔体：拆出来的嘴层只是唇线，后面没有东西", 1, 20),
    ("core/synth/mouth.py", "E06", "腔体尺寸取自嘴层的**宽度**（不是高度）＋ 三种色调", 36, 18),
    ("core/synth/mouth.py", "E07", "\"已经是张开的嘴\"的判据（同时要够高**且**有暗腔）", 78, 8),
    ("core/synth/mouth.py", "E08", "synthesize_mouth_cavity 主体：没有 mouth 层就返回 None", 206, 20),
    ("core/rig/author.py", "E09", "_mouth_open：嘴唇在 1 档张开、合成腔体在 0 档被压扁成零", 771, 22),
    ("core/rig/author.py", "E10", "参数接线处：ParamMouthOpenY / ParamMouthForm 挂到 mouth 与 cavity 上", 290, 5),
    ("backends/live2d/mapping.py", "E11", "Live2D 侧的标准参数映射表（Mouth Form / Mouth Open 归到 Mouth 组）", 25, 6),
    ("backends/live2d/mapping.py", "E12", "口型同步用的就是 ParamMouthOpenY（LIP_SYNC_PARAMS）", 48, 3),
    ("core/motion/drive.py", "E13", "talk 动作：驱动 ParamMouthOpenY（没有这个参数时该动作被抑制）", 193, 6),
    ("core/qa/harness.py", "E14", "嘴区合理性包络（宽度/深度/偏移的上下限，取自 8 个真实角色实测）", 196, 20),
    ("core/qa/harness.py", "E15", "T9 backlog 原文：SAM-mouth-from-source 这条正是本任务在做的事", 204, 8),
    ("core/landmark/extract.py", "E16", "嘴部关键点（中心/左右嘴角/上下沿）从 mouth 层的轮廓算出来", 271, 9),
    ("pipeline.py", "E17", "管线里自动调用 synthesize_mouth_cavity（\"a mouth with no interior cannot open\"）", 137, 8),
]


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    rec = {"script": "70_collect_i2l_excerpts.py", "i2l_root": str(I2L),
           "collected": time.strftime("%Y-%m-%d %H:%M:%S"), "files": {}, "excerpts": []}
    if not I2L.is_dir():
        print(f"[FAIL] 找不到 i2l 源码：{I2L}", flush=True)
        return 2

    lines_out = []
    lines_out.append("# 先例摘录 · image2live2d 的「嘴」支持（逐字原文，带 sha256）\n")
    lines_out.append("> 本件是 `实现报告_LAYER-MOUTH_嘴与关键部件_2026-09-24.md` 的**稳定证据件**。")
    lines_out.append("> 源树在 `/tmp/p2l2/src/image2live2d-main/`（P2L-2 的产物，本任务**只读未改**）—— `/tmp` 会被清，")
    lines_out.append("> 所以把逐字原文抄到这里，锚点指向本件。每段都给出源文件路径、sha256 前 16 位、行号。\n")
    lines_out.append(f"> 采集时间：{rec['collected']}｜采集脚本：`code/tools/auto-layer-mouth/scripts/70_collect_i2l_excerpts.py`\n")
    lines_out.append("## 版本表（源文件）\n")
    lines_out.append("| V | 文件（相对 i2l 根） | sha256 前 16 位 |")
    lines_out.append("|---|---|---|")

    vmap = {}
    for i, (rel, aid, desc, start, n) in enumerate(WANTED, start=1):
        p = I2L / rel
        if not p.is_file():
            print(f"[跳过] 缺文件 {p}")
            continue
        if rel not in vmap:
            vmap[rel] = f"V{len(vmap)+1}"
            rec["files"][rel] = {"sha16": sha256(p)[:16], "bytes": p.stat().st_size}
            lines_out.append(f"| {vmap[rel]} | {rel} | {sha256(p)[:16]} |")
    lines_out.append("")
    lines_out.append("## 摘录表\n")
    lines_out.append("| 锚点 | 说明 | 版本 | 行 | 片段 |")
    lines_out.append("|---|---|---|---|---|")

    for rel, aid, desc, start, n in WANTED:
        p = I2L / rel
        if not p.is_file():
            continue
        all_lines = p.read_text(encoding="utf-8", errors="replace").split("\n")
        seg = all_lines[start - 1:start - 1 + n]
        # 片段列：取第一行非空、去掉反引号与竖线（锚点表格式约束）
        frag = ""
        for s in seg:
            s2 = s.strip()
            if s2 and "|" not in s2 and "`" not in s2:
                frag = s2[:110]
                break
        rec["excerpts"].append({"anchor": aid, "file": rel, "version": vmap.get(rel),
                                "start_line": start, "n_lines": n, "desc": desc, "fragment": frag})
        lines_out.append(f"| {aid} | {desc} | {vmap.get(rel,'?')} | {start} | `{frag}` |")
        lines_out.append("")
        lines_out.append(f"### 〔{aid}〕 {rel}:{start}-{start+n-1}　{VFMT.get(rel,'')}".rstrip())
        lines_out.append("")
        lines_out.append(f"```python")
        for k, s in enumerate(seg, start=start):
            lines_out.append(f"{k:5d}| {s}")
        lines_out.append("```")
        lines_out.append("")

    EVID.mkdir(parents=True, exist_ok=True)
    p = EVID / "prior_art_i2l_mouth_excerpts.md"
    p.write_text("\n".join(lines_out), encoding="utf-8")
    rec["evidence_file"] = str(p.relative_to(MOUTH_ROOT))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "70_i2l_excerpts.json").write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"摘录 {len(rec['excerpts'])} 段 → {p}")
    for e in rec["excerpts"]:
        print(f"  {e['anchor']:4s} {e['file']:34s}:{e['start_line']:5d}  {e['desc'][:52]}")
    return 0


VFMT = {"irr/schema.py": "SemanticRole / 角色枚举", "irr/params.py": "标准参数表",
        "core/qa/capability.py": "能力发现", "core/synth/mouth.py": "嘴腔合成",
        "core/rig/author.py": "参数授权", "backends/live2d/mapping.py": "Live2D 参数映射",
        "core/motion/drive.py": "驱动动作", "core/qa/harness.py": "QA 包络",
        "core/landmark/extract.py": "关键点", "pipeline.py": "管线"}

if __name__ == "__main__":
    raise SystemExit(main())
