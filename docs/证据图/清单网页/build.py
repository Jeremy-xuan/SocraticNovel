#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建「功能总清单」网页（单文件、自包含、无外链）。

单一数据源
    开源线/SocraticNovel_功能总清单_2026-09-24.md
产物
    开源线/DSH定制/清单网页/功能总清单.html

用法
    python3 开源线/DSH定制/清单网页/build.py            构建（写盘）
    python3 开源线/DSH定制/清单网页/build.py --check    只解析并打印统计，不写盘

幂等
    脚本不读当前时钟：页面上的时间戳一律取自数据源 mtime，指纹取自数据源 SHA-256。
    因此「同样的 md → 同样的字节」，跑两次产物完全一致。

纪律
    md 是唯一数据源，本脚本不另建任何第二份清单（无 JSON 中间层、无硬编码条目）。
    解析不了的行一律报错并指出行号，绝不静默丢弃。
"""

import argparse
import hashlib
import html
import os
import re
import sys
from datetime import datetime

# ----------------------------------------------------------------------------
# 路径
# ----------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
MD_PATH = os.path.normpath(os.path.join(HERE, "..", "..", "SocraticNovel_功能总清单_2026-09-24.md"))
OUT_PATH = os.path.join(HERE, "功能总清单.html")
MD_REL = "开源线/SocraticNovel_功能总清单_2026-09-24.md"
BUILD_CMD = "python3 开源线/DSH定制/清单网页/build.py"

# ----------------------------------------------------------------------------
# 状态口径（md 文件头声明的四个）
# ----------------------------------------------------------------------------
STATUS = {
    "✅": {"key": "done", "label": "已经能跑", "glyph": "v", "cls": "done"},
    "🟡": {"key": "half", "label": "做了一半", "glyph": "~", "cls": "half"},
    "🔨": {"key": "doing", "label": "正在做", "glyph": "!", "cls": "doing"},
    "⬜": {"key": "todo", "label": "还没开始", "glyph": "·", "cls": "todo"},
}
STATUS_ORDER = ["done", "half", "doing", "todo"]
STATUS_BY_KEY = {v["key"]: v for v in STATUS.values()}

# 行内 emoji → 等宽徽标（沿用 报告构建/ 的做法：emoji 会破坏单面近黑的排版）
INLINE_EMOJI = {
    "🔴": '<span class="mk mk-h">!</span>',
    "⚠️": '<span class="mk mk-w">~</span>',
    "⚠": '<span class="mk mk-w">~</span>',
    "📌": '<span class="mk mk-x">◆</span>',
    "⭐": '<span class="mk mk-x">★</span>',
    "❓": '<span class="mk mk-o">?</span>',
    "❌": '<span class="mk mk-x">×</span>',
    "⛔": '<span class="mk mk-h">×</span>',
    "💡": '<span class="mk mk-x">◆</span>',
    "🆕": '<span class="mk mk-o">+</span>',
}
# 出现在正文里也应转徽标的状态标记
INLINE_EMOJI.update({k: '<span class="mk mk-%s">%s</span>' % (v["cls"], v["glyph"])
                     for k, v in STATUS.items()})

# 只圈真正的 emoji 区段：箭头（→ U+2192）、破折号等普通排版符号不在内，
# 否则「知识点 → 场景隐喻」这类正常正文会被误报。
EMOJI_RE = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F\u20E3]")


class ParseError(Exception):
    """带行号的解析错误 —— 不静默、不跳过。"""

    def __init__(self, line_no, msg):
        self.line_no = line_no
        self.msg = msg
        super().__init__("第 %d 行：%s" % (line_no, msg))


# ----------------------------------------------------------------------------
# 解析工具
# ----------------------------------------------------------------------------
SEP_RE = re.compile(r"^\|[\s:\-|]+\|$")


def is_separator(line):
    s = line.strip()
    return bool(SEP_RE.match(s)) and "-" in s


def split_row(line):
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [c.strip() for c in s.split("|")]


def strip_md(text):
    """去掉行内 markdown 记号，用于分类/比较（不用于渲染）。"""
    t = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    t = re.sub(r"`([^`]+)`", r"\1", t)
    t = t.replace("\\|", "|")
    return t.strip()


def render_inline(text, line_no, warnings):
    """行内 markdown → HTML。先转义，再上记号，最后把 emoji 换成等宽徽标。"""
    out = html.escape(text, quote=False)
    out = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    for k, v in INLINE_EMOJI.items():
        out = out.replace(html.escape(k, quote=False), v)
    # 剩下没被映射的 emoji：报出来（不静默），但照常渲染，不阻断构建
    left = sorted(set(EMOJI_RE.findall(out)))
    for ch in left:
        warnings.append("第 %d 行：正文里有未映射的符号 %r，已按原样输出（"
                        "可在 build.py 的 INLINE_EMOJI 里加一条映射）" % (line_no, ch))
    return out


# ----------------------------------------------------------------------------
# 解析 md
# ----------------------------------------------------------------------------
def parse_md(text):
    lines = text.split("\n")
    warnings = []
    sections = []          # [{title, line_no, items:[...], cols:[...], note}]
    selfcheck = None       # §九 自查表
    other_tables = []      # 非功能表（记录备查）

    i = 0
    cur = None
    n = len(lines)
    while i < n:
        line = lines[i]

        m = re.match(r"^##\s+(.*?)\s*$", line)
        if m:
            cur = {"title": m.group(1), "line_no": i + 1, "items": [],
                   "cols": [], "who_col": False, "note": ""}
            sections.append(cur)
            i += 1
            continue

        if line.lstrip().startswith("|") and i + 1 < n and is_separator(lines[i + 1]):
            header = split_row(line)
            header_line = i + 1
            j = i + 2
            rows = []
            while j < n and lines[j].lstrip().startswith("|"):
                rows.append((j + 1, lines[j]))
                j += 1
            got = _classify_table(header, header_line, rows, cur, sections, other_tables)
            if got is not None:
                selfcheck = got
            i = j
            continue

        i += 1

    if not sections:
        raise ParseError(1, "整个文件里没找到任何 ## 分组标题")

    # 只保留真的装了功能条目的分组（§九 自查表、§十 纯文字等没有表格行的章节不进网页）
    sections = [s for s in sections if s["items"]]
    if not sections:
        raise ParseError(1, "没有解析到任何功能条目（表格行）")

    if selfcheck is not None:
        selfcheck["who_claim"] = _parse_who_claim(text)

    return sections, selfcheck, warnings, other_tables


def _classify_table(header, header_line, rows, cur, sections, other_tables):
    """返回自查表 dict（仅 §九 那种表），其余返回 None。"""
    is_func = ("功能" in header and "状态" in header
               and ("#" in header or "编号" in header))
    is_selfcheck = ("项数" in header and "状态" in header and "功能" not in header)

    if is_selfcheck:
        return _parse_selfcheck(header, header_line, rows)

    if not is_func:
        other_tables.append({"header": header, "line": header_line,
                             "rows": len(rows)})
        return None

    if cur is None:
        raise ParseError(header_line, "功能表格出现在任何 ## 分组标题之前")

    def col(*names):
        for k, h in enumerate(header):
            if h in names:
                return k
        return None

    num_i = col("#", "编号")
    name_i = col("功能", "名称")
    desc_i = col("一句话", "说明")
    st_i = col("状态")
    who_i = col("谁来做")
    ev_i = None
    for k, h in enumerate(header):
        if k in (num_i, name_i, desc_i, st_i, who_i):
            continue
        if "证据" in h or "备注" in h:
            ev_i = k

    missing = [nm for nm, idx in (("#", num_i), ("功能", name_i),
                                 ("一句话", desc_i), ("状态", st_i)) if idx is None]
    if missing:
        raise ParseError(header_line,
                         "功能表格缺少必需列 %s；实际表头 %s" % ("、".join(missing), header))

    if cur["items"]:
        # 同一分组下第二张功能表：合并（表头必须一致，否则报错）
        if cur["cols"] and cur["cols"] != header:
            raise ParseError(header_line, "同一分组下的两张功能表表头不一致：%s vs %s"
                             % (cur["cols"], header))
    cur["cols"] = header
    cur["who_col"] = who_i is not None
    cur["evidence_col"] = ev_i is not None

    seen = {it["no"] for s in sections for it in s["items"]}
    for ln, raw in rows:
        cells = split_row(raw)
        if len(cells) != len(header):
            raise ParseError(ln, "列数不符：表头 %d 列，本行 %d 列 → %s"
                             % (len(header), len(cells), raw.strip()))
        no = cells[num_i]
        name = cells[name_i]
        desc = cells[desc_i]
        if not no or not name or not desc:
            raise ParseError(ln, "「#」「功能」「一句话」三列都不许为空 → %s" % raw.strip())
        if no in seen:
            raise ParseError(ln, "编号 %s 重复出现" % no)
        seen.add(no)

        st_raw = cells[st_i]
        marker, note = _split_status(st_raw, ln)

        who_raw = cells[who_i] if who_i is not None else ""
        who, who_detail, who_inferred = _classify_who(who_raw, cur["title"], ln)

        cur["items"].append({
            "no": no,
            "name": name,
            "desc": desc,
            "who_raw": who_raw,
            "who": who,
            "who_detail": who_detail,
            "who_inferred": who_inferred,
            "status": marker,
            "note": note,
            "evidence": cells[ev_i] if ev_i is not None else "",
            "line": ln,
            "section": cur["title"],
            "section_line": cur["line_no"],
        })


def _split_status(raw, ln):
    marker = None
    for ch in raw:
        if ch in STATUS:
            marker = ch
            break
    if marker is None:
        raise ParseError(ln, "状态列找不到状态标记（只认 %s）→ %r"
                         % ("／".join(STATUS.keys()), raw))
    idx = raw.index(marker)
    prefix = raw[:idx].strip()
    if prefix:
        raise ParseError(ln, "状态标记前面还有内容 %r，无法判定 → %r" % (prefix, raw))
    return marker, raw[idx + len(marker):].strip()


def _classify_who(raw, section_title, ln):
    """返回 (who, detail, inferred)。源文件无「谁来做」列时，按节标题的
    「全部自研」声明推断并显式标记 inferred=True。"""
    w = strip_md(raw)
    if not w:
        if "全部自研" in section_title:
            return "自研", "本节表格未列「谁来做」；节标题声明「全部自研，别人没有」", True
        return None, "源文件本节表格未列「谁来做」", True
    m = re.match(r"^(复用|自研)\s*(.*)$", w)
    if not m:
        raise ParseError(ln, "「谁来做」列认不出「复用／自研」→ %r" % w)
    detail = m.group(2).strip()
    detail = detail.strip("（）()").strip()
    return m.group(1), detail, False


def _parse_selfcheck(header, header_line, rows):
    """§九 自查表：| 状态 | 项数 | 是哪些 |"""
    def col(*names):
        for k, h in enumerate(header):
            if h in names:
                return k
        return None

    st_i = col("状态")
    n_i = col("项数")
    list_i = col("是哪些")
    if st_i is None or n_i is None:
        raise ParseError(header_line, "自查表缺少「状态」或「项数」列：%s" % header)

    out = {"line": header_line, "rows": {}, "total": None, "total_raw": None}
    for ln, raw in rows:
        cells = split_row(raw)
        if len(cells) != len(header):
            raise ParseError(ln, "列数不符：表头 %d 列，本行 %d 列 → %s"
                             % (len(header), len(cells), raw.strip()))
        label = strip_md(cells[st_i])
        n_raw = strip_md(cells[n_i])
        digits = re.sub(r"[^\d]", "", n_raw)
        list_text = strip_md(cells[list_i]) if list_i is not None else ""
        # 「是哪些」列只在**开头**是一串编号时才当名单核对；
        # 一旦读到散文（如「11–13 以外的其余项（含 …）」）就停，避免把散文里的数字当编号。
        ids, rest = [], []
        for t in re.split(r"[、，,;；\s]+", list_text):
            if not t:
                continue
            if not rest and re.fullmatch(r"\d+[a-z]?", t):
                ids.append(t)
            else:
                rest.append(t)

        if "合计" in label or "功能" in label:
            out["total"] = int(digits) if digits else None
            out["total_raw"] = n_raw
            continue

        marker = None
        for ch in label:
            if ch in STATUS:
                marker = ch
                break
        if marker is None:
            raise ParseError(ln, "自查表状态列找不到状态标记 → %r" % label)
        key = STATUS[marker]["key"]
        out["rows"][key] = {
            "raw": n_raw,
            "claimed": int(digits) if digits else None,
            "approx": "＋" in n_raw or "+" in n_raw,
            "ids": ids,
            "ids_trailing": "".join(rest),
            "list_text": list_text,
            "line": ln,
        }
    return out


def _parse_who_claim(text):
    """§九 正文那句「复用 12 项（20、27…），自研 51 项」——顺带核一下。
    措辞对不上就返回 None（不阻断构建）。"""
    m = re.search(r"复用\s*\*{0,2}\s*(\d+)\s*项\*{0,2}\s*[（(]([^）)]*)[）)]", text)
    m2 = re.search(r"自研\s*\*{0,2}\s*(\d+)\s*项", text)
    if not m or not m2:
        return None
    ids = [t for t in re.split(r"[、，,;；\s]+", m.group(2).strip())
           if re.fullmatch(r"\d+[a-z]?", t)]
    return {"reuse_claimed": int(m.group(1)), "reuse_ids": ids,
            "self_claimed": int(m2.group(1)), "line": text[:m.start()].count("\n") + 1}


# ----------------------------------------------------------------------------
# 渲染
# ----------------------------------------------------------------------------
CSS = """
:root{
  --canvas:#0a0a0a; --canvas-soft:#1a1c20; --canvas-card:#191919; --canvas-mid:#363a3f;
  --hairline:#212327; --hairline-lit:rgba(255,255,255,.14);
  --ink:#ffffff; --body:#dadbdf; --mute:#7d8187;
  --sunset:#ff7a17; --sunset-soft:#ffc285; --dusk:#7c3aed; --twilight:#c4b5fd; --breeze:#a0c3ec;
  --r-sm:8px; --r-pill:9999px;
  --s-xxs:2px; --s-xs:4px; --s-sm:8px; --s-md:12px; --s-lg:16px; --s-xl:24px;
  --s-2xl:32px; --s-3xl:48px; --s-4xl:64px;
  --sans:Inter,"Universal Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",
         "PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  --mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,Monaco,"SF Mono","Roboto Mono",monospace;
  --t:.18s ease; --navh:60px;
  --pad:clamp(16px,4vw,24px);
}
*{box-sizing:border-box;}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;}
body{margin:0;background:var(--canvas);color:var(--body);overflow-wrap:break-word;
  font-family:var(--sans);font-size:16px;font-weight:400;line-height:24px;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}
a{color:var(--ink);text-decoration:none;transition:color var(--t),border-color var(--t);}
a:hover{color:var(--breeze);}
::selection{background:rgba(255,122,23,.28);}
/* 全部字重 400：层级只靠字号/字距/字色/字面 */
strong{font-weight:400;color:var(--ink);}
em{font-style:normal;color:var(--mute);}
h1,h2,h3,h4{font-weight:400;color:var(--ink);}
code,.mono{font-family:var(--mono);font-size:.86em;letter-spacing:.4px;}
code{background:var(--canvas-soft);border:1px solid var(--hairline);
  padding:1px 6px;border-radius:var(--r-sm);color:var(--ink);}

/* 等宽徽标（取代 emoji） */
.mk{display:inline-flex;align-items:center;justify-content:center;
  min-width:16px;height:16px;padding:0 4px;border-radius:var(--r-pill);
  font-family:var(--mono);font-size:10px;line-height:1;letter-spacing:0;
  border:1px solid var(--canvas-mid);color:var(--mute);
  vertical-align:1px;margin:0 3px;flex:0 0 auto;}
.mk-h{color:var(--sunset);border-color:rgba(255,122,23,.5);background:rgba(255,122,23,.10);}
.mk-w{color:var(--sunset-soft);border-color:rgba(255,194,133,.35);background:rgba(255,194,133,.08);}
.mk-o{color:var(--breeze);border-color:rgba(160,195,236,.35);background:rgba(160,195,236,.08);}
.mk-x{color:var(--mute);border-color:var(--hairline);}
.mk-done{color:var(--breeze);border-color:rgba(160,195,236,.4);background:rgba(160,195,236,.08);}
.mk-half{color:var(--sunset-soft);border-color:rgba(255,194,133,.4);background:rgba(255,194,133,.08);}
.mk-doing{color:var(--sunset);border-color:rgba(255,122,23,.45);background:rgba(255,122,23,.09);}
.mk-todo{color:var(--mute);border-color:var(--canvas-mid);background:rgba(255,255,255,.02);}

/* 导航 */
.nav{position:sticky;top:0;z-index:60;background:rgba(10,10,10,.86);
  backdrop-filter:saturate(160%) blur(18px);-webkit-backdrop-filter:saturate(160%) blur(18px);
  border-bottom:1px solid var(--hairline);}
.nav-inner{max-width:1240px;margin:0 auto;padding:0 var(--pad);height:var(--navh);
  display:flex;align-items:center;gap:var(--s-lg);}
.brand{font-family:var(--mono);font-size:12px;letter-spacing:1.4px;text-transform:uppercase;
  color:var(--ink);white-space:nowrap;flex:0 0 auto;}
.brand span{color:var(--mute);}
.nav-links{display:flex;gap:var(--s-xxs);overflow-x:auto;scrollbar-width:none;
  min-width:0;flex:1 1 auto;padding:4px 0;}
.nav-links::-webkit-scrollbar{display:none;}
.nav-links a{display:inline-flex;align-items:baseline;gap:6px;font-size:13px;line-height:18px;
  color:var(--mute);white-space:nowrap;padding:5px 12px;border-radius:var(--r-pill);
  border:1px solid transparent;}
.nav-links a i{font-family:var(--mono);font-size:10px;font-style:normal;letter-spacing:.6px;opacity:.7;}
.nav-links a:hover,.nav-links a:focus-visible{color:var(--ink);border-color:var(--hairline-lit);outline:none;}
.nav-stamp{flex:0 0 auto;font-family:var(--mono);font-size:10px;letter-spacing:1.1px;
  text-transform:uppercase;color:var(--mute);white-space:nowrap;}
.nav-stamp b{color:var(--body);font-weight:400;}

/* 版心 */
.wrap{max-width:1240px;margin:0 auto;padding:0 var(--pad) 96px;}
.hero{padding:var(--s-3xl) 0 var(--s-2xl);border-bottom:1px solid var(--hairline);}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:1.4px;text-transform:uppercase;
  color:var(--mute);margin:0 0 var(--s-xl);}
.eyebrow b{color:var(--sunset);font-weight:400;}
h1{font-size:clamp(38px,7vw,64px);line-height:1.04;letter-spacing:-2.2px;
  margin:0 0 var(--s-xl);max-width:20ch;}
.lead{font-size:17px;line-height:27px;color:var(--body);max-width:74ch;margin:0 0 var(--s-md);}
.lead .k{font-family:var(--mono);font-size:11px;letter-spacing:1.2px;text-transform:uppercase;
  color:var(--sunset);margin-right:8px;}
.meta-row{display:flex;flex-wrap:wrap;gap:var(--s-sm) var(--s-xl);margin-top:var(--s-xl);
  font-family:var(--mono);font-size:11px;letter-spacing:1.1px;text-transform:uppercase;
  color:var(--mute);border-top:1px solid var(--hairline);padding-top:var(--s-lg);}
.meta-row b{color:var(--ink);font-weight:400;letter-spacing:.6px;text-transform:none;}

/* 总览 */
.dash{margin:var(--s-3xl) 0 var(--s-2xl);}
.dash-h{margin-bottom:var(--s-xl);}
.dash-h .k{font-family:var(--mono);font-size:11px;letter-spacing:1.4px;
  text-transform:uppercase;color:var(--mute);margin:0 0 var(--s-sm);}
.dash-h h2{margin:0;font-size:clamp(24px,3.4vw,32px);line-height:1.18;letter-spacing:-.6px;}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--s-md);}
.tile{min-width:0;background:var(--canvas-card);border:1px solid var(--hairline);
  border-radius:var(--r-sm);padding:var(--s-xl);display:flex;flex-direction:column;
  gap:var(--s-md);min-height:158px;}
.tile .t-lab{font-family:var(--mono);font-size:11px;letter-spacing:1.2px;
  text-transform:uppercase;color:var(--mute);display:flex;align-items:center;gap:7px;}
.tile .t-num{font-family:var(--mono);font-size:40px;line-height:44px;color:var(--ink);
  letter-spacing:-1px;display:flex;align-items:baseline;gap:8px;}
.tile .t-num small{font-size:13px;letter-spacing:.6px;color:var(--mute);}
.tile .t-note{font-size:13px;line-height:20px;color:var(--mute);margin:auto 0 0;}
.tile-done .t-lab{color:var(--breeze);} .tile-done .t-num{color:var(--breeze);}
.tile-half .t-lab{color:var(--sunset-soft);} .tile-half .t-num{color:var(--sunset-soft);}
.tile-doing .t-lab{color:var(--sunset);} .tile-doing .t-num{color:var(--sunset);}
.tile-todo .t-lab{color:var(--mute);}

.stackbar{display:flex;gap:2px;height:10px;margin:var(--s-xl) 0 0;}
.stackbar i{display:block;height:10px;border-radius:2px;min-width:3px;}
.s-done{background:rgba(160,195,236,.80);}
.s-half{background:rgba(255,194,133,.72);}
.s-doing{background:rgba(255,122,23,.78);}
.s-todo{background:rgba(255,255,255,.13);}
.bar-legend{display:flex;flex-wrap:wrap;gap:var(--s-xs) var(--s-lg);margin-top:var(--s-md);
  font-family:var(--mono);font-size:11px;letter-spacing:1px;color:var(--mute);}
.bar-legend span{display:inline-flex;align-items:center;gap:7px;}
.bar-legend i{width:10px;height:10px;border-radius:2px;display:block;}
.dash-note{font-size:12px;line-height:20px;color:var(--mute);margin:var(--s-lg) 0 0;max-width:96ch;}

/* 一致性提示 */
.notice{margin:0 0 var(--s-2xl);border:1px solid rgba(255,122,23,.35);background:rgba(255,122,23,.06);
  border-radius:var(--r-sm);padding:var(--s-lg) var(--s-xl);}
.notice .n-h{font-family:var(--mono);font-size:11px;letter-spacing:1.2px;text-transform:uppercase;
  color:var(--sunset);margin:0 0 var(--s-sm);}
.notice p{font-size:13px;line-height:21px;color:var(--body);margin:0 0 var(--s-sm);max-width:96ch;}
.notice ul{margin:0;padding-left:18px;}
.notice li{font-size:13px;line-height:21px;color:var(--body);margin:3px 0;}
.notice .mono{color:var(--ink);}

/* 工具条 */
.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s-sm) var(--s-md);
  padding:var(--s-md) 0 var(--s-lg);border-bottom:1px solid var(--hairline);margin-bottom:var(--s-2xl);}
.toolbar .grp{display:flex;align-items:center;gap:var(--s-xs);flex-wrap:wrap;min-width:0;}
.toolbar .grp > span{font-family:var(--mono);font-size:10px;letter-spacing:1.2px;
  text-transform:uppercase;color:var(--mute);margin-right:var(--s-xs);}
.btn{appearance:none;background:transparent;color:var(--mute);cursor:pointer;
  font-family:var(--sans);font-size:13px;line-height:18px;font-weight:400;
  padding:5px 13px;border-radius:var(--r-pill);border:1px solid var(--hairline);
  transition:color var(--t),border-color var(--t),background-color var(--t);}
.btn:hover{color:var(--ink);border-color:var(--hairline-lit);}
.btn:focus-visible{outline:none;color:var(--ink);border-color:var(--hairline-lit);}
.btn.on{color:var(--ink);border-color:var(--hairline-lit);background:var(--canvas-soft);}
.btn .c{font-family:var(--mono);font-size:10px;color:var(--mute);margin-left:5px;}
.btn.on .c{color:var(--sunset);}
.btn[data-f="done"].on{border-color:rgba(160,195,236,.45);}
.btn[data-f="half"].on{border-color:rgba(255,194,133,.45);}
.btn[data-f="doing"].on{border-color:rgba(255,122,23,.5);}
input[type=search]{appearance:none;-webkit-appearance:none;font-family:var(--sans);
  font-size:13px;line-height:18px;font-weight:400;color:var(--ink);
  background:var(--canvas-soft);border:1px solid var(--hairline);border-radius:var(--r-pill);
  padding:6px 14px;min-width:180px;flex:1 1 180px;max-width:280px;}
input[type=search]::placeholder{color:var(--mute);}
input[type=search]:focus{outline:none;border-color:var(--hairline-lit);}
.count{margin-left:auto;font-family:var(--mono);font-size:11px;letter-spacing:1px;
  text-transform:uppercase;color:var(--mute);white-space:nowrap;}
.count b{color:var(--ink);font-weight:400;}

/* 分组 */
.gsec{margin:0 0 var(--s-4xl);scroll-margin-top:calc(var(--navh) + 24px);}
.gsec[hidden]{display:none;}
.gsec > h2{font-size:clamp(22px,3vw,28px);line-height:1.2;letter-spacing:-.4px;
  margin:0 0 var(--s-md);padding-top:var(--s-xl);border-top:1px solid var(--hairline);}
.gsec > h2::before{content:attr(data-eyebrow);display:block;font-family:var(--mono);
  font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--sunset);
  margin-bottom:var(--s-md);}
.gsec .g-note{font-size:12px;line-height:19px;color:var(--mute);margin:0 0 var(--s-lg);max-width:96ch;}
.gsec .g-note .mono{color:var(--body);}

/* 条目卡片 */
.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s-lg);}
.sc{min-width:0;background:var(--canvas-card);border:1px solid var(--hairline);
  border-radius:var(--r-sm);padding:var(--s-xl);display:flex;flex-direction:column;
  gap:var(--s-md);scroll-margin-top:calc(var(--navh) + 24px);}
.sc[hidden]{display:none;}
.sc-h{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--s-xs) var(--s-md);min-width:0;}
.sc-num{font-family:var(--mono);font-size:11px;letter-spacing:1.2px;color:var(--mute);flex:0 0 auto;}
.sc-h h4{margin:0;font-size:19px;line-height:26px;letter-spacing:-.2px;min-width:0;flex:1 1 auto;}
.sc-chips{display:flex;flex-wrap:wrap;gap:6px;flex:0 0 auto;margin-left:auto;}
.sc-desc{margin:0;font-size:14px;line-height:22px;color:var(--body);}
.sc-note{margin:auto 0 0;border-top:1px solid var(--hairline);padding-top:var(--s-md);
  font-size:12.5px;line-height:20px;color:var(--mute);}
.sc-note .k{font-family:var(--mono);font-size:10px;letter-spacing:1.2px;text-transform:uppercase;
  color:var(--canvas-mid);display:block;margin-bottom:5px;}
.sc-note strong{color:var(--body);}
.sc-note code{font-size:.9em;}

/* 徽标 */
.chip{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;max-width:100%;
  font-family:var(--mono);font-size:11px;letter-spacing:.6px;padding:3px 10px;
  border-radius:var(--r-pill);border:1px solid var(--canvas-mid);color:var(--mute);}
.chip-done{color:var(--breeze);border-color:rgba(160,195,236,.42);background:rgba(160,195,236,.08);}
.chip-half{color:var(--sunset-soft);border-color:rgba(255,194,133,.4);background:rgba(255,194,133,.08);}
.chip-doing{color:var(--sunset);border-color:rgba(255,122,23,.45);background:rgba(255,122,23,.09);}
.chip-todo{color:var(--mute);border-color:var(--hairline);background:rgba(255,255,255,.02);}
.chip-who{color:var(--body);border-color:var(--hairline);}
.chip-who.reuse{color:var(--twilight);border-color:rgba(196,181,253,.32);background:rgba(196,181,253,.07);}
.chip sup{font-family:var(--mono);font-size:9px;color:var(--mute);letter-spacing:0;}

.empty{border:1px solid var(--hairline);border-radius:var(--r-sm);padding:var(--s-3xl) var(--s-xl);
  text-align:center;color:var(--mute);font-size:14px;}
.empty[hidden]{display:none;}

/* 页脚 */
.foot{border-top:1px solid var(--hairline);padding:var(--s-3xl) var(--pad);}
.foot-inner{max-width:1240px;margin:0 auto;color:var(--mute);font-size:13px;line-height:22px;}
.foot-inner .f-h{font-family:var(--mono);font-size:11px;letter-spacing:1.4px;
  text-transform:uppercase;color:var(--ink);margin:0 0 var(--s-md);}
.foot-inner p{margin:0 0 var(--s-sm);max-width:100ch;}
.foot-inner .mono{color:var(--body);}

/* 窄屏 */
@media (max-width:1000px){
  .tiles{grid-template-columns:repeat(2,1fr);}
  .cards{grid-template-columns:1fr;}
}
@media (max-width:640px){
  h1{letter-spacing:-1.4px;}
  .tiles{grid-template-columns:1fr;}
  .tile{min-height:0;padding:var(--s-lg);}
  .nav-links{display:none;}
  .count{margin-left:0;}
  input[type=search]{max-width:none;}
  .toolbar{gap:var(--s-sm);}
  .sc{padding:var(--s-lg);}
  .lead{font-size:16px;line-height:25px;}
}
"""

JS = """
(function(){
  var cards = Array.prototype.slice.call(document.querySelectorAll('.sc'));
  var secs  = Array.prototype.slice.call(document.querySelectorAll('.gsec'));
  var btns  = Array.prototype.slice.call(document.querySelectorAll('.btn[data-f]'));
  var gbtns = Array.prototype.slice.call(document.querySelectorAll('.btn[data-g]'));
  var q     = document.getElementById('q');
  var out   = document.getElementById('count');
  var none  = document.getElementById('empty');
  var total = cards.length;
  var st = {f:'all', g:'all', q:''};

  function norm(s){ return (s||'').toLowerCase().replace(/\\s+/g,''); }

  function apply(){
    var shown = 0;
    for (var i=0;i<cards.length;i++){
      var c = cards[i];
      var ok = (st.f==='all' || c.getAttribute('data-status')===st.f)
            && (st.g==='all' || c.getAttribute('data-group')===st.g)
            && (st.q==='' || c.getAttribute('data-search').indexOf(st.q)>=0);
      c.hidden = !ok;
      if (ok) shown++;
    }
    for (var j=0;j<secs.length;j++){
      var s = secs[j];
      var vis = s.querySelector('.sc:not([hidden])');
      var gok = (st.g==='all' || s.getAttribute('data-group')===st.g);
      s.hidden = !(gok && vis);
    }
    out.innerHTML = '显示 <b>' + shown + '</b> / ' + total + ' 项';
    none.hidden = shown !== 0;
  }

  function pick(list, attr, val, btn){
    for (var i=0;i<list.length;i++){
      var on = list[i]===btn;
      list[i].classList.toggle('on', on);
      list[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (attr==='f') st.f = val; else st.g = val;
    apply();
  }

  btns.forEach(function(b){
    b.addEventListener('click', function(){ pick(btns,'f',b.getAttribute('data-f'),b); });
  });
  gbtns.forEach(function(b){
    b.addEventListener('click', function(){ pick(gbtns,'g',b.getAttribute('data-g'),b); });
  });
  if (q) q.addEventListener('input', function(){ st.q = norm(q.value); apply(); });

  // 键盘：在搜索框里按 Esc 清空
  if (q) q.addEventListener('keydown', function(e){
    if (e.key==='Escape'){ q.value=''; st.q=''; apply(); }
  });

  apply();
})();
"""


def fmt_mtime(ts):
    dt = datetime.fromtimestamp(ts)
    off = dt.astimezone().strftime("%z")
    return dt.strftime("%Y-%m-%d %H:%M") + (" " + off if off else "")


def esc(t):
    return html.escape(t, quote=True)


def build_html(sections, selfcheck, md_bytes, warnings):
    items = [it for s in sections for it in s["items"]]
    total = len(items)
    counts = {k: 0 for k in STATUS_ORDER}
    for it in items:
        counts[STATUS[it["status"]]["key"]] += 1
    who_counts = {"复用": 0, "自研": 0}
    for it in items:
        if it["who"]:
            who_counts[it["who"]] += 1

    mt = os.path.getmtime(MD_PATH)
    stamp = fmt_mtime(mt)
    digest = hashlib.sha256(md_bytes).hexdigest()

    P = []
    A = P.append

    A('<!DOCTYPE html>')
    A('<html lang="zh-CN">')
    A('<head>')
    A('<meta charset="utf-8">')
    A('<meta name="viewport" content="width=device-width,initial-scale=1">')
    A('<title>SocraticNovel · 功能总清单</title>')
    A('<meta name="generator" content="%s">' % esc(BUILD_CMD))
    A('<meta name="source" content="%s">' % esc(MD_REL))
    A('<meta name="source-sha256" content="%s">' % digest)
    A('<meta name="source-mtime" content="%s">' % esc(stamp))
    A('<style>%s</style>' % CSS)
    A('</head>')
    A('<body>')

    # ---- 导航 ----
    A('<div class="nav"><div class="nav-inner">')
    A('<div class="brand">SocraticNovel <span>/ 功能总清单</span></div>')
    A('<nav class="nav-links" aria-label="分组跳转">')
    A('<a href="#overview">总览</a>')
    for k, s in enumerate(sections):
        A('<a href="#g%d"><i>%s</i>%s</a>' % (k, esc(_group_no(s["title"])), esc(_short_title(s["title"]))))
    A('</nav>')
    A('<div class="nav-stamp">数据源 <b>%s</b></div>' % esc(stamp.split(" ")[0]))
    A('</div></div>')

    A('<div class="wrap">')

    # ---- 封面 ----
    A('<header class="hero">')
    A('<p class="eyebrow">开源线 <b>·</b> SocraticNovel <b>·</b> 由 md 生成</p>')
    A('<h1>功能总清单</h1>')
    A('<p class="lead"><span class="k">这一页是什么</span>'
      '把《完全体能力清单 v2》重排成的 <strong>%d 项功能总表</strong>'
      '（%d 项已经能跑 / %d 项做了一半 / %d 项正在做 / %d 项还没开始）。'
      '本页不是手写的 HTML —— 它由 <code>%s</code> 生成，那份 md 是唯一数据源，'
      '这里没有第二份清单。</p>'
      % (total, counts["done"], counts["half"], counts["doing"], counts["todo"], esc(MD_REL)))
    A('<p class="lead"><span class="k">怎么更新</span>'
      '改 md 表格里的任意单元格（通常是「状态」列）→ 跑 <code>%s</code> → 刷新本页。'
      '不需要动 HTML，也不需要在两个地方各改一遍。</p>' % esc(BUILD_CMD))
    A('<div class="meta-row">')
    A('<span>数据源最后修改 <b>%s</b></span>' % esc(stamp))
    A('<span>数据源 SHA-256 <b>%s</b></span>' % digest[:12])
    A('<span>项数 <b>%d</b></span>' % total)
    A('<span>复用 <b>%d</b> · 自研 <b>%d</b></span>' % (who_counts["复用"], who_counts["自研"]))
    A('</div>')
    A('</header>')

    # ---- 总览 ----
    A('<section class="dash" id="overview">')
    A('<div class="dash-h"><p class="k">完成度总览</p><h2>%d 项功能，%d 项已经能跑（%.0f%%）</h2></div>'
      % (total, counts["done"], 100.0 * counts["done"] / total if total else 0))
    A('<div class="tiles">')
    for key in STATUS_ORDER:
        meta = STATUS_BY_KEY[key]
        n = counts[key]
        share = (100.0 * n / total) if total else 0
        note = {
            "done": "源文件状态列写「已经能跑」",
            "half": "骨架在、机制没做完",
            "doing": "本季在推进",
            "todo": "还没排上",
        }[key]
        A('<div class="tile tile-%s">' % meta["cls"])
        A('<div class="t-lab"><span class="mk mk-%s">%s</span>%s</div>'
          % (meta["cls"], meta["glyph"], esc(meta["label"])))
        A('<div class="t-num">%d<small>项 · %d%%</small></div>' % (n, round(share)))
        A('<div class="t-note">%s</div>' % esc(note))
        A('</div>')
    A('</div>')
    A('<div class="stackbar" role="img" aria-label="%s">' % esc(_aria(counts, total)))
    for key in STATUS_ORDER:
        if counts[key] > 0:
            A('<i class="s-%s" style="flex:%d 1 0"></i>' % (STATUS_BY_KEY[key]["cls"], counts[key]))
    A('</div>')
    A('<div class="bar-legend">')
    for key in STATUS_ORDER:
        meta = STATUS_BY_KEY[key]
        A('<span><i class="s-%s"></i>%s %d</span>' % (meta["cls"], esc(meta["label"]), counts[key]))
    A('</div>')
    A('<p class="dash-note">进度条按四个状态的项数占比堆叠（等宽刻度），'
      '刻意<strong>不给状态加权</strong>——「做了一半」值多少分是判断题，不是本页能替你定的；'
      '所以这里只报事实：每档各有几项。等宽字体显示数字，与正文形成双字面反差。</p>')
    A('</section>')

    # ---- 一致性提示 ----
    A(_consistency_notice(sections, selfcheck, items, counts))

    # ---- 工具条 ----
    A('<div class="toolbar">')
    A('<div class="grp"><span>状态</span>')
    A('<button class="btn on" type="button" data-f="all" aria-pressed="true">全部<span class="c">%d</span></button>' % total)
    for key in STATUS_ORDER:
        meta = STATUS_BY_KEY[key]
        A('<button class="btn" type="button" data-f="%s" aria-pressed="false">%s<span class="c">%d</span></button>'
          % (meta["cls"], esc(meta["label"]), counts[key]))
    A('</div>')
    A('<div class="grp"><span>分组</span>')
    A('<button class="btn on" type="button" data-g="all" aria-pressed="true">全部</button>')
    for k, s in enumerate(sections):
        A('<button class="btn" type="button" data-g="g%d" aria-pressed="false">%s<span class="c">%d</span></button>'
          % (k, esc(_short_title(s["title"])), len(s["items"])))
    A('</div>')
    A('<input type="search" id="q" placeholder="搜编号 / 名称 / 说明 / 状态备注" aria-label="搜索">')
    A('<div class="count" id="count">显示 <b>%d</b> / %d 项</div>' % (total, total))
    A('</div>')

    # ---- 条目 ----
    A('<main>')
    for k, s in enumerate(sections):
        note = ""
        if not s["who_col"]:
            note = ('<p class="g-note">源文件本节表格<strong>没有「谁来做」列</strong>；'
                    '节标题声明「全部自研，别人没有」→ 本页按 <span class="mono">自研</span> 计'
                    '（推断，卡片上标 <span class="mono">†</span>）。</p>')
        A('<section class="gsec" id="g%d" data-group="g%d">' % (k, k))
        A('<h2 data-eyebrow="分组 %s · %d 项">%s</h2>' % (esc(_group_no(s["title"])), len(s["items"]), esc(s["title"])))
        A(note)
        A('<div class="cards">')
        for it in s["items"]:
            A(_card_html(it, k, warnings))
        A('</div>')
        A('</section>')
    A('</main>')
    A('<div class="empty" id="empty" hidden>没有匹配的条目 —— 换个筛选或清空搜索框。</div>')
    A('</div>')  # /wrap

    # ---- 页脚 ----
    A('<footer class="foot"><div class="foot-inner">')
    A('<p class="f-h">这一页是怎么来的</p>')
    A('<p>数据源：<span class="mono">%s</span>（SHA-256 <span class="mono">%s</span>）</p>'
      % (esc(MD_REL), digest))
    A('<p>构建命令：<span class="mono">%s</span>　·　'
      '本页构建时间 <span class="mono">%s</span></p>' % (esc(BUILD_CMD), esc(stamp)))
    A('<p>本页构建时间<strong>刻意不取当前时钟</strong>，而是取数据源 mtime —— '
      '这样同一份 md 重复构建的产物字节完全一致（幂等），'
      '而「这页有多新」由上面的「数据源最后修改」如实回答。</p>')
    A('<p>页面为单文件自包含：无 CDN、无外链、无网络请求，双击即可打开。'
      '筛选与搜索是页面内联的纯 JS，不依赖任何库。</p>')
    A('</div></footer>')

    A('<script>%s</script>' % JS)
    A('</body>')
    A('</html>')
    return "\n".join(P) + "\n"


def _group_no(title):
    m = re.match(r"^([〇零一二三四五六七八九十百]+)、", title)
    return m.group(1) if m else "?"


def _short_title(title):
    m = re.match(r"^[〇零一二三四五六七八九十百]+、\s*(.*)$", title)
    t = m.group(1) if m else title
    t = re.split(r"[（(]", t)[0].strip()
    return t


def _aria(counts, total):
    parts = ["%s %d 项" % (STATUS_BY_KEY[k]["label"], counts[k]) for k in STATUS_ORDER]
    return "共 %d 项：%s" % (total, "，".join(parts))


def _card_html(it, gi, warnings):
    meta = STATUS[it["status"]]
    key = meta["key"]
    search = " ".join([it["no"], strip_md(it["name"]), strip_md(it["desc"]),
                       strip_md(it["note"]), strip_md(it["evidence"]),
                       meta["label"], it["who"] or "", strip_md(it["section"])])
    search = re.sub(r"\s+", "", search).lower()

    out = []
    out.append('<article class="sc" id="item-%s" data-status="%s" data-group="g%d" data-search="%s">'
               % (esc(it["no"]), key, gi, esc(search)))
    out.append('<div class="sc-h">')
    out.append('<span class="sc-num">%s</span>' % esc(it["no"]))
    out.append('<h4>%s</h4>' % render_inline(it["name"], it["line"], warnings))
    out.append('<span class="sc-chips">')
    out.append('<span class="chip chip-%s" title="%s"><span class="mk mk-%s">%s</span>%s</span>'
               % (meta["cls"], esc(meta["label"]), meta["cls"], meta["glyph"], esc(meta["label"])))
    if it["who"]:
        cls = "chip-who reuse" if it["who"] == "复用" else "chip-who"
        detail = (' title="%s"' % esc(it["who_detail"])) if it["who_detail"] else ""
        dagger = '<sup>†</sup>' if it["who_inferred"] else ''
        label = it["who"] + ("（%s）" % it["who_detail"] if it["who_detail"] and not it["who_inferred"] else "")
        out.append('<span class="chip %s"%s>%s%s</span>' % (cls, detail, esc(label), dagger))
    else:
        out.append('<span class="chip chip-who" title="%s">未标注</span>' % esc(it["who_detail"]))
    out.append('</span></div>')
    out.append('<p class="sc-desc">%s</p>' % render_inline(it["desc"], it["line"], warnings))
    if it["note"] or it["evidence"]:
        out.append('<div class="sc-note"><span class="k">状态备注</span>')
        if it["note"]:
            out.append(render_inline(it["note"], it["line"], warnings))
        if it["evidence"]:
            out.append('<div class="ev">%s</div>' % render_inline(it["evidence"], it["line"], warnings))
        out.append('</div>')
    out.append('</article>')
    return "".join(out)


def _consistency_notice(sections, selfcheck, items, counts):
    """源文件 §九「数一数」自查表 vs 实际行 —— 不一致就摆到页面上，不悄悄吞掉。"""
    if not selfcheck:
        return ('<div class="notice"><p class="n-h">数据一致性</p>'
                '<p>源文件里没有找到「状态 / 项数 / 是哪些」自查表，本页数字全部由功能表格行现场统计。</p></div>')

    rows = selfcheck["rows"]
    diffs = []
    for key in STATUS_ORDER:
        claimed = rows.get(key, {}).get("claimed")
        if claimed is None:
            continue
        if claimed != counts[key]:
            raw = rows[key]["raw"]
            diffs.append("「%s」自查表写 <span class=\"mono\">%s</span>，实际行数 <span class=\"mono\">%d</span>"
                         % (STATUS_BY_KEY[key]["label"], esc(raw), counts[key]))

    # 成员名单核对（只对「是哪些」列**开头**就是一串编号的那几档）
    id_diffs = []
    for key in STATUS_ORDER:
        info = rows.get(key)
        if not info or not info["ids"]:
            continue
        claimed_ids = set(info["ids"])
        actual_ids = {it["no"] for it in items if STATUS[it["status"]]["key"] == key}
        only_claim = sorted(claimed_ids - actual_ids, key=_no_key)
        only_actual = sorted(actual_ids - claimed_ids, key=_no_key)
        if only_claim or only_actual:
            bits = []
            if only_actual:
                bits.append("实际是「%s」但自查表没列：<span class=\"mono\">%s</span>"
                            % (STATUS_BY_KEY[key]["label"], "、".join(only_actual)))
            if only_claim:
                bits.append("自查表列了但实际不是：<span class=\"mono\">%s</span>" % "、".join(only_claim))
            id_diffs.append("；".join(bits))

    # 复用 / 自研
    who_counts = {"复用": 0, "自研": 0}
    for it in items:
        if it["who"]:
            who_counts[it["who"]] += 1
    wc = selfcheck.get("who_claim")
    if wc:
        actual_reuse = {it["no"] for it in items if it["who"] == "复用"}
        claimed_reuse = set(wc["reuse_ids"])
        if wc["reuse_claimed"] != who_counts["复用"] or claimed_reuse != actual_reuse:
            bits = []
            if wc["reuse_claimed"] != who_counts["复用"]:
                bits.append("自查表正文写「复用 <span class=\"mono\">%d</span> 项」，"
                            "按「谁来做」列实际是 <span class=\"mono\">%d</span> 项"
                            % (wc["reuse_claimed"], who_counts["复用"]))
            miss = sorted(actual_reuse - claimed_reuse, key=_no_key)
            extra = sorted(claimed_reuse - actual_reuse, key=_no_key)
            if miss:
                bits.append("这些条目「谁来做」列写的是复用、但正文的复用名单里没有："
                            "<span class=\"mono\">%s</span>" % "、".join(miss))
            if extra:
                bits.append("正文复用名单里列了、但「谁来做」列不是复用："
                            "<span class=\"mono\">%s</span>" % "、".join(extra))
            if wc["self_claimed"] != who_counts["自研"]:
                bits.append("正文写「自研 <span class=\"mono\">%d</span> 项」，实际 <span class=\"mono\">%d</span> 项"
                            % (wc["self_claimed"], who_counts["自研"]))
            id_diffs.append("；".join(bits))

    if not diffs and not id_diffs:
        return ('<div class="notice" style="border-color:var(--hairline);background:transparent">'
                '<p class="n-h" style="color:var(--breeze)">数据一致性</p>'
                '<p>源文件 §九「数一数」自查表与本页统计<strong>完全一致</strong>：%d 项、%s。</p></div>'
                % (len(items), "，".join("%s %d" % (STATUS_BY_KEY[k]["label"], counts[k]) for k in STATUS_ORDER)))

    out = ['<div class="notice">']
    out.append('<p class="n-h">数据一致性 · 源文件自查表与表格行不一致</p>')
    out.append('<p>源文件末尾的「九、数一数」是一张<strong>手写自查表</strong>'
               '（含它正文那句「复用 N 项／自研 N 项」），'
               '本页的每一项数字都是从功能表格的行现场数出来的。两者对不上，'
               '说明自查表没跟上表格的改动 —— <strong>本页以表格行为准</strong>，'
               '并把差异原样列在下面，供你去改 md 的自查表。</p>')
    out.append('<ul>')
    for d in diffs:
        out.append('<li>%s</li>' % d)
    for d in id_diffs:
        out.append('<li>%s</li>' % d)
    if selfcheck.get("total") is not None and selfcheck["total"] != len(items):
        out.append('<li>合计：自查表写 <span class="mono">%s</span>，实际 <span class="mono">%d</span> 项</li>'
                   % (esc(selfcheck["total_raw"]), len(items)))
    out.append('</ul>')
    out.append('<p style="margin-top:12px;color:var(--mute)">本页不改 md 的「状态」语义，'
               '只如实报告差异。</p>')
    out.append('</div>')
    return "".join(out)


def _no_key(no):
    m = re.match(r"^(\d+)([a-z]?)$", no)
    return (int(m.group(1)), m.group(2)) if m else (10 ** 6, no)


# ----------------------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="由功能总清单 md 生成单文件网页")
    ap.add_argument("--check", action="store_true", help="只解析并打印统计，不写盘")
    args = ap.parse_args()

    if not os.path.isfile(MD_PATH):
        print("✗ 找不到数据源：%s" % MD_PATH, file=sys.stderr)
        return 2

    with open(MD_PATH, "rb") as f:
        raw = f.read()
    text = raw.decode("utf-8")

    try:
        sections, selfcheck, warnings, other_tables = parse_md(text)
    except ParseError as e:
        print("✗ 解析失败：%s" % e, file=sys.stderr)
        return 1

    items = [it for s in sections for it in s["items"]]
    counts = {k: 0 for k in STATUS_ORDER}
    for it in items:
        counts[STATUS[it["status"]]["key"]] += 1

    print("数据源：%s" % MD_REL)
    print("SHA-256：%s" % hashlib.sha256(raw).hexdigest())
    print("分组 %d 个 · 功能 %d 项" % (len(sections), len(items)))
    for s in sections:
        c = {k: 0 for k in STATUS_ORDER}
        for it in s["items"]:
            c[STATUS[it["status"]]["key"]] += 1
        print("  %-4s %-34s %2d 项  ✅%d 🟡%d 🔨%d ⬜%d"
              % (_group_no(s["title"]), _short_title(s["title"]), len(s["items"]),
                 c["done"], c["half"], c["doing"], c["todo"]))
    print("合计：✅%d 🟡%d 🔨%d ⬜%d" % (counts["done"], counts["half"], counts["doing"], counts["todo"]))
    if selfcheck:
        claimed = {k: (selfcheck["rows"].get(k, {}) or {}).get("claimed") for k in STATUS_ORDER}
        print("源文件 §九 自查表声称：✅%s 🟡%s 🔨%s ⬜%s（合计 %s）"
              % (claimed["done"], claimed["half"], claimed["doing"], claimed["todo"],
                 selfcheck.get("total")))
        bad = [k for k in STATUS_ORDER if claimed[k] is not None and claimed[k] != counts[k]]
        if bad:
            print("⚠ 自查表与表格行不一致（本页以表格行为准）：")
            for k in bad:
                print("    %s：自查表 %s vs 实际 %d"
                      % (STATUS_BY_KEY[k]["label"], selfcheck["rows"][k]["raw"], counts[k]))
        else:
            print("✓ 自查表与表格行一致")
    who = {"复用": 0, "自研": 0}
    for it in items:
        if it["who"]:
            who[it["who"]] += 1
    wc = (selfcheck or {}).get("who_claim")
    print("复用/自研（按「谁来做」列）：复用 %d · 自研 %d" % (who["复用"], who["自研"]))
    if wc:
        if wc["reuse_claimed"] != who["复用"] or wc["self_claimed"] != who["自研"]:
            print("⚠ 源文件正文写「复用 %d 项 / 自研 %d 项」，与实际（%d / %d）不一致"
                  % (wc["reuse_claimed"], wc["self_claimed"], who["复用"], who["自研"]))
        miss = sorted({it["no"] for it in items if it["who"] == "复用"} - set(wc["reuse_ids"]), key=_no_key)
        if miss:
            print("    正文复用名单漏了：%s" % "、".join(miss))

    if other_tables:
        print("跳过的非功能表 %d 张（不含「功能」列，不作为条目来源）：" % len(other_tables))
        for t in other_tables:
            print("    第 %d 行：%s（%d 行数据）" % (t["line"], " | ".join(t["header"]), t["rows"]))

    if warnings:
        print("⚠ %d 条提示：" % len(warnings))
        for w in warnings:
            print("    " + w)

    if args.check:
        print("（--check：未写盘）")
        return 0

    out = build_html(sections, selfcheck, raw, warnings)
    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(out)
    print("✓ 已写出 %s（%d 字节）" % (os.path.relpath(OUT_PATH, os.path.dirname(os.path.dirname(os.path.dirname(HERE)))), len(out.encode("utf-8"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
