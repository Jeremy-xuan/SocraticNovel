#!/usr/bin/env python3
"""fix_anchors.py —— 把一份旁挂锚点表的「版本表哈希 + 锚点表行号」按现盘重算。

只改**两个数字列**（版本表的 sha256 前 16 位、锚点表的行号），
以及 `--set` 显式给定的片段替换；**不动**说明列、不动锚点 id、不删任何锚点。

为什么要它：源码一被改，锚点表的行号与版本哈希就漂了，而机核
（`check-anchors.mjs`）会把这些漂移全部报成 ERROR、退出码 1。
手工改 50 多条必然出错，所以重算过程本身也要可复现。

用法（**从仓库根执行**：版本表里的路径是相对仓库根的）：
  python3 tools/anchors/fix_anchors.py <锚点表.anchors.md> [--set A50=<新片段>] [--dry]

片段里的 `⏎` 表示换行（与 `check-anchors.mjs` 同一口径）；多行锚点也能重算。
"""
import argparse
import hashlib
import os
import re
import sys


def sha16(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:16]


def find_line(text, snippet):
    """片段在文件里出现的行号（1-based）。片段必须唯一，否则返回 None。"""
    if text.count(snippet) != 1:
        return None
    return text[:text.index(snippet)].count("\n") + 1


def unescape(snippet):
    """表里的 `⏎` 表示换行（与 check-anchors.mjs 的读法一致，两侧必须同口径）。"""
    return snippet.replace("⏎", "\n")


def escape(snippet):
    """写回表里时必须把换行还原成 `⏎`，否则一行会断成多行、把表格撕开。"""
    return snippet.replace("\n", "⏎")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sidecar")
    ap.add_argument("--root", default=".")
    ap.add_argument("--set", action="append", default=[], help="锚点id=新片段（可多次）")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    sets = {}
    for s in args.set:
        k, v = s.split("=", 1)
        sets[k.strip()] = v

    p = args.sidecar
    lines = open(p).read().split("\n")

    # ── 找版本表与锚点表的区间 ─────────────────────────────────────────────
    def section(head):
        try:
            i = next(i for i, l in enumerate(lines) if l.strip() == head)
        except StopIteration:
            raise SystemExit(f"[FAIL] 找不到小节 {head}")
        j = i + 1
        while j < len(lines) and not lines[j].startswith("## "):
            j += 1
        return i, j

    vi, vj = section("## 版本表")
    ai, aj = section("## 锚点表")

    # ── 版本表：file -> 现盘哈希 ───────────────────────────────────────────
    vfile = {}          # V 号 -> 文件路径
    changed_v = 0
    for k in range(vi, vj):
        m = re.match(r"^\|\s*(V\d+)\s*\|\s*(\S+)\s*\|\s*([0-9a-f]{16})\s*\|", lines[k])
        if not m:
            continue
        vid, f, old = m.group(1), m.group(2), m.group(3)
        vfile[vid] = f
        absp = os.path.join(args.root, f)
        if not os.path.exists(absp):
            print(f"  [跳过] {vid} 文件不存在：{f}")
            continue
        new = sha16(absp)
        if new != old:
            lines[k] = lines[k].replace(old, new)
            changed_v += 1
            print(f"  {vid} {f}: {old} -> {new}")

    # ── 锚点表：行号 + 可选片段替换 ────────────────────────────────────────
    changed_a = 0
    for k in range(ai, aj):
        m = re.match(r"^\|\s*(A\d+)\s*\|(.*)\|\s*(V\d+)\s*\|\s*(\d+)\s*\|\s*`(.*)`\s*\|\s*$", lines[k])
        if not m:
            continue
        aid, desc, vid, oldline, snippet = m.groups()
        snippet = unescape(sets[aid] if aid in sets else snippet)
        f = vfile.get(vid)
        if f is None:
            print(f"  [跳过] {aid} 版本 {vid} 不在版本表里")
            continue
        absp = os.path.join(args.root, f)
        if not os.path.exists(absp):
            print(f"  [跳过] {aid} 文件不存在：{f}")
            continue
        text = open(absp).read()
        ln = find_line(text, snippet)
        if ln is None:
            print(f"  🔴 [片段不唯一/不存在] {aid}：在 {f} 里命中 {text.count(snippet)} 次 —— 必须人工处理")
            continue
        newrow = f"| {aid} |{desc}| {vid} | {ln} | `{escape(snippet)}` |"
        if newrow != lines[k]:
            lines[k] = newrow
            changed_a += 1
            print(f"  {aid} {f}: 行 {oldline} -> {ln}")

    print(f"\n版本表改动 {changed_v} 条，锚点表改动 {changed_a} 条")
    if args.dry:
        print("（--dry：不写盘）")
        return 0
    open(p, "w").write("\n".join(lines))
    print(f"已写回 {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
