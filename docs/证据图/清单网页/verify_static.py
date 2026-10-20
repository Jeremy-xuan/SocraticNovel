#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
功能总清单网页 · 程序化断言（静态）

独立路径：本脚本**不 import build.py**，自己从 md 重新数一遍，
再和已生成的 HTML 对比 —— 两条独立通道得出同一组数字才算过。

断言
  ① 项数：HTML 里的条目数 == md 功能表格的数据行数
  ② 状态：每个状态的计数 == md 里该状态的行数（并核对页面上展示的数字）
  ③ 无外链：HTML 里不出现任何外部 URL / CDN / <link> / src=
  ④ 字段完整：每条都渲染出编号、名称、说明、状态；分组数与 md 一致

用法
    python3 开源线/DSH定制/清单网页/verify_static.py
退出码 0 = 全过；1 = 有断言失败。
"""

import hashlib
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
MD_PATH = os.path.normpath(os.path.join(HERE, "..", "..", "SocraticNovel_功能总清单_2026-09-24.md"))
HTML_PATH = os.path.join(HERE, "功能总清单.html")

STATUS = {"✅": "done", "🟡": "half", "🔨": "doing", "⬜": "todo"}
ORDER = ["done", "half", "doing", "todo"]

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print("%s %s%s" % ("PASS" if ok else "FAIL", name, ("  —— " + detail) if detail else ""))
    return bool(ok)


# ---------------------------------------------------------------- md 独立解析
def md_rows(path):
    """从 md 重新数一遍：返回 [(行号, 编号, 状态key, 分组标题, 谁来做)]"""
    text = open(path, encoding="utf-8").read()
    lines = text.split("\n")
    out = []
    sec = None
    i = 0
    while i < len(lines):
        m = re.match(r"^##\s+(.*?)\s*$", lines[i])
        if m:
            sec = m.group(1)
        if lines[i].lstrip().startswith("|") and i + 1 < len(lines):
            nxt = lines[i + 1].strip()
            if re.match(r"^\|[\s:\-|]+\|$", nxt) and "-" in nxt:
                header = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if "功能" in header and "状态" in header and "#" in header:
                    st_i = header.index("状态")
                    no_i = header.index("#")
                    who_i = header.index("谁来做") if "谁来做" in header else None
                    j = i + 2
                    while j < len(lines) and lines[j].lstrip().startswith("|"):
                        cells = [c.strip() for c in lines[j].strip().strip("|").split("|")]
                        marker = next((c for c in cells[st_i] if c in STATUS), None)
                        who = ""
                        if who_i is not None:
                            w = re.sub(r"\*\*(.+?)\*\*", r"\1", cells[who_i])
                            who = "复用" if w.startswith("复用") else (
                                "自研" if w.startswith("自研") else "")
                        elif sec and "全部自研" in sec:
                            who = "自研"
                        out.append((j + 1, cells[no_i], STATUS[marker] if marker else "?", sec, who))
                        j += 1
                    i = j
                    continue
        i += 1
    return out


def main():
    if not os.path.isfile(HTML_PATH):
        print("✗ 产物不存在，先跑 build.py：%s" % HTML_PATH)
        return 1

    md_raw = open(MD_PATH, "rb").read()
    html = open(HTML_PATH, encoding="utf-8").read()
    rows = md_rows(MD_PATH)

    md_counts = {k: 0 for k in ORDER}
    for r in rows:
        md_counts[r[2]] += 1
    md_secs = []
    for r in rows:
        if r[3] not in md_secs:
            md_secs.append(r[3])
    md_who = {"复用": sum(1 for r in rows if r[4] == "复用"),
              "自研": sum(1 for r in rows if r[4] == "自研")}

    # ---------------------------------------------------------- ① 项数
    art = re.findall(r'<article class="sc" id="item-([^"]+)"', html)
    check("① 项数：HTML 条目数 == md 功能表格行数",
          len(art) == len(rows),
          "HTML %d 条 / md %d 行" % (len(art), len(rows)))

    md_nos = [r[1] for r in rows]
    check("① 项数：编号集合完全一致（顺序也一致）",
          art == md_nos,
          "" if art == md_nos else "差异：%s" % (set(art) ^ set(md_nos)))
    check("① 项数：编号无重复",
          len(set(art)) == len(art),
          "%d 个唯一编号 / %d 条" % (len(set(art)), len(art)))

    # ---------------------------------------------------------- ② 状态计数
    html_counts = {k: 0 for k in ORDER}
    for m in re.finditer(r'data-status="(done|half|doing|todo)"', html):
        html_counts[m.group(1)] += 1
    check("② 状态：各状态条目数 == md 各行状态计数",
          html_counts == md_counts,
          "HTML %s / md %s" % (html_counts, md_counts))

    tiles = re.findall(r'<div class="t-num">(\d+)<small>', html)
    check("② 状态：总览四个大数字 == md 计数",
          [int(x) for x in tiles] == [md_counts[k] for k in ORDER],
          "页面 %s / md %s" % (tiles, [md_counts[k] for k in ORDER]))

    pills = re.findall(r'data-f="(done|half|doing|todo)"[^>]*>[^<]*<span class="c">(\d+)</span>', html)
    check("② 状态：筛选药丸上的计数 == md 计数",
          {k: int(v) for k, v in pills} == md_counts,
          "页面 %s / md %s" % (dict(pills), md_counts))

    check("② 状态：总览大标题里的项数与「已经能跑」数 == md",
          ("%d 项功能，%d 项已经能跑" % (len(rows), md_counts["done"])) in html,
          "期望出现「%d 项功能，%d 项已经能跑」" % (len(rows), md_counts["done"]))

    # 分组计数
    sec_titles = re.findall(r'<h2 data-eyebrow="分组 [^"]*?(\d+) 项">', html)
    md_sec_counts = [sum(1 for r in rows if r[3] == t) for t in md_secs]
    check("② 状态：分组数与每组项数 == md",
          [int(x) for x in sec_titles] == md_sec_counts and len(sec_titles) == len(md_secs),
          "页面 %s / md %s" % (sec_titles, md_sec_counts))

    gbtns = re.findall(r'data-g="(g\d+)"[^>]*>[^<]*<span class="c">(\d+)</span>', html)
    check("② 状态：分组筛选药丸计数 == md 每组项数",
          [int(v) for _, v in gbtns] == md_sec_counts,
          "页面 %s / md %s" % ([v for _, v in gbtns], md_sec_counts))

    # 复用 / 自研
    who_meta = re.search(r"复用 <b>(\d+)</b> · 自研 <b>(\d+)</b>", html)
    check("② 状态：复用/自研计数 == md「谁来做」列",
          who_meta is not None and (int(who_meta.group(1)), int(who_meta.group(2)))
          == (md_who["复用"], md_who["自研"]),
          "页面 %s / md %s" % (who_meta.groups() if who_meta else None, md_who))

    # ---------------------------------------------------------- ③ 无外链
    bad = []
    for pat, label in [
        (r"https?://", "http(s):// 字面量"),
        (r"(?<![\w:])//[a-z0-9.-]+\.[a-z]{2,}", "协议相对 URL"),
        (r"<link\b", "<link> 标签"),
        (r"\bsrc\s*=", "src= 属性"),
        (r"@import\b", "@import"),
        (r"url\(\s*['\"]?(?:https?:)?//", "CSS 里的远程 url()"),
        (r"<iframe\b", "<iframe>"),
        (r"integrity\s*=", "SRI（通常伴随 CDN）"),
    ]:
        hits = re.findall(pat, html, re.I)
        if hits:
            bad.append("%s ×%d（例：%s）" % (label, len(hits), hits[0]))
    check("③ 无外链：页面里没有任何外部 URL / CDN 引用", not bad, "；".join(bad))

    check("③ 无外链：样式与脚本全部内联",
          html.count("<style>") == 1 and html.count("<script>") == 1
          and "<style src" not in html and "<script src" not in html,
          "<style> %d 个 / <script> %d 个" % (html.count("<style>"), html.count("<script>")))

    check("③ 无外链：字体只用本机字体名，没有远程字体文件",
          not re.search(r"@font-face", html, re.I) and "fonts.googleapis" not in html,
          "")

    # ---------------------------------------------------------- ④ 字段完整
    missing = []
    for m in re.finditer(r'<article class="sc" id="item-([^"]+)".*?</article>', html, re.S):
        blk = m.group(0)
        no = m.group(1)
        for need, label in [
            (r'<span class="sc-num">', "编号"),
            (r"<h4>", "名称"),
            (r'<p class="sc-desc">', "说明"),
            (r'class="chip chip-(done|half|doing|todo)"', "状态"),
        ]:
            if not re.search(need, blk):
                missing.append("%s 缺 %s" % (no, label))
    check("④ 字段：每条都有 编号 / 名称 / 说明 / 状态", not missing,
          "；".join(missing[:5]))

    check("④ 字段：分组区块数 == md 功能分组数",
          html.count('<section class="gsec"') == len(md_secs),
          "页面 %d / md %d" % (html.count('<section class="gsec"'), len(md_secs)))

    check("④ 字段：页面记录了数据源路径与指纹",
          ("开源线/SocraticNovel_功能总清单_2026-09-24.md" in html
           and hashlib.sha256(md_raw).hexdigest()[:12] in html),
          "指纹 %s" % hashlib.sha256(md_raw).hexdigest()[:12])

    check("④ 字段：页面显示了生成/数据源时间",
          bool(re.search(r"数据源最后修改", html)) and bool(re.search(r"本页构建时间", html)),
          "")

    check("④ 字段：一致性提示已渲染（自查表差异必须出现在页面上）",
          ("数据一致性" in html), "")

    # ---------------------------------------------------------- 设计语言
    check("设计语言：全部 font-weight 声明都是 400",
          not re.search(r"font-weight\s*:\s*(?!400\b)\d", open(
              os.path.join(HERE, "build.py"), encoding="utf-8").read().split('CSS = """')[1].split('"""')[0]),
          "CSS 里除了 400 没有别的字重")

    check("设计语言：CSS 里没有 box-shadow（发丝线承重、不用投影）",
          not re.search(r"box-shadow\s*:", open(
              os.path.join(HERE, "build.py"), encoding="utf-8").read().split('CSS = """')[1].split('"""')[0]),
          "")

    n_fail = sum(1 for _, ok, _ in results if not ok)
    print("\n—— 静态断言 %d 项：%d pass / %d fail ——" % (len(results), len(results) - n_fail, n_fail))
    return 1 if n_fail else 0


if __name__ == "__main__":
    sys.exit(main())
