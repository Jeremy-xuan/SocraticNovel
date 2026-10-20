#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
功能总清单网页 · 解析器健壮性断言

任务要求：「解析不了的行要报错并指出行号，不许静默丢掉」。
本脚本直接喂给 build.py 的 parse_md() 一批**故意做坏**的 md 片段，
逐条验证它真的报错、且报出的行号正确。

用法
    python3 开源线/DSH定制/清单网页/verify_parser.py
退出码 0 = 全过。
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True   # 不留下 __pycache__

import build  # noqa: E402

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print("%s %s%s" % ("PASS" if ok else "FAIL", name, ("  —— " + detail) if detail else ""))
    return bool(ok)


GOOD = """# 标题

## 一、分组甲

| # | 功能 | 一句话 | 谁来做 | 状态 |
|---|---|---|---|---|
| 1 | 甲功能 | 这是**加粗**与`代码`混排的一句 | 自研 | ✅ 已跑 |
| 2 | 乙功能 | 复用项 | **复用**（某开源项目） | 🔨 在做 |
"""


def expect_error(md, line_no, needle, name):
    try:
        build.parse_md(md)
    except build.ParseError as e:
        ok = (e.line_no == line_no) and (needle in e.msg)
        check(name, ok, "报错行 %d，内容：%s" % (e.line_no, e.msg))
        return
    check(name, False, "居然没报错 —— 这就是静默丢弃")


def main():
    # 1) 正常表能过，且字段解析正确
    secs, sc, warn, other = build.parse_md(GOOD)
    check("正常表：解析出 1 个分组 2 条",
          len(secs) == 1 and len(secs[0]["items"]) == 2,
          "%d 组 / %d 条" % (len(secs), len(secs[0]["items"])))
    it = secs[0]["items"][0]
    check("正常表：状态标记与备注被拆开",
          it["status"] == "✅" and it["note"] == "已跑",
          "status=%r note=%r" % (it["status"], it["note"]))
    it2 = secs[0]["items"][1]
    check("正常表：「谁来做」被归到 复用 并保留括注",
          it2["who"] == "复用" and "某开源项目" in it2["who_detail"],
          "%s / %s" % (it2["who"], it2["who_detail"]))
    # 解析阶段原样保留行内记号，渲染阶段才转 HTML（两段分开，才不会把记号吃掉）
    check("正常表：解析阶段原样保留 **加粗** 与 `反引号`",
          it["desc"] == "这是**加粗**与`代码`混排的一句", it["desc"])
    warns = []
    rendered = build.render_inline(it["desc"], it["line"], warns)
    check("正常表：渲染阶段 **加粗** → <strong>、`反引号` → <code>",
          "<strong>加粗</strong>" in rendered and "<code>代码</code>" in rendered
          and "**" not in rendered and "`" not in rendered,
          rendered)

    # 2) 列数不符 → 必须报错并给出正确行号（第 7 行）
    expect_error(GOOD.replace("| 2 | 乙功能 | 复用项 | **复用**（某开源项目） | 🔨 在做 |",
                              "| 2 | 乙功能 | 复用项 | **复用** | 🔨 在做 | 多出来一列 |"),
                 8, "列数不符", "坏行：列数不符 → 报错并指出行号 8")

    # 3) 状态列没有标记 → 必须报错（第 6 行）
    expect_error(GOOD.replace("| ✅ 已跑 |", "| 在做 |"),
                 7, "找不到状态标记", "坏行：状态列无标记 → 报错并指出行号 7")

    # 4) 状态标记前面还有字 → 必须报错（第 6 行）
    expect_error(GOOD.replace("| ✅ 已跑 |", "| 差不多 ✅ 已跑 |"),
                 7, "状态标记前面还有内容", "坏行：标记前有字 → 报错并指出行号 7")

    # 5) 编号重复 → 必须报错
    expect_error(GOOD.replace("| 2 | 乙功能", "| 1 | 乙功能"),
                 8, "重复出现", "坏行：编号重复 → 报错并指出行号 8")

    # 6) 「谁来做」认不出 → 必须报错
    expect_error(GOOD.replace("| 自研 | ✅", "| 买现成的 | ✅"),
                 7, "认不出", "坏行：谁来做认不出 → 报错并指出行号 7")

    # 7) 关键列缺失 → 必须报错（表头行号 5）
    expect_error(GOOD.replace("| # | 功能 | 一句话 | 谁来做 | 状态 |",
                              "| # | 功能 | 谁来做 | 状态 |")
                 .replace("| 1 | 甲功能 | 这是**加粗**与`代码`混排的一句 | 自研 | ✅ 已跑 |",
                          "| 1 | 甲功能 | 自研 | ✅ 已跑 |")
                 .replace("| 2 | 乙功能 | 复用项 | **复用**（某开源项目） | 🔨 在做 |",
                          "| 2 | 乙功能 | **复用**（某开源项目） | 🔨 在做 |")
                 .replace("|---|---|---|---|---|", "|---|---|---|---|"),
                 5, "缺少必需列", "坏行：缺「一句话」列 → 报错并指出表头行号 5")

    # 8) 完全没有 ## 分组标题 → 报错
    expect_error("| # | 功能 | 一句话 | 谁来做 | 状态 |\n|---|---|---|---|---|\n"
                 "| 1 | 甲 | 乙 | 自研 | ✅ |\n",
                 1, "分组标题", "坏行：无 ## 分组 → 报错")

    # 9) 空文件 / 无表格 → 报错
    expect_error("# 只有标题\n\n没有任何表格\n", 1, "没找到任何 ## 分组标题",
                 "坏行：没有表格 → 报错")

    # 10) 未映射 emoji：只警告、不阻断，且给出行号（在渲染阶段报）
    warns3 = []
    out3 = build.render_inline("已经能跑 🎉", 7, warns3)
    check("未映射 emoji：只警告不阻断，且带行号",
          len(warns3) == 1 and "第 7 行" in warns3[0] and "🎉" in out3,
          warns3[0] if warns3 else "没有警告")
    warns4 = []
    out4 = build.render_inline("知识点 → 场景隐喻（箭头不该被当 emoji）", 3, warns4)
    check("普通排版符号（→）不被误报为 emoji", warns4 == [], str(warns4))

    # 11) 非功能表（如 §九 自查表）不被当条目，且能被识别
    selfcheck_md = """# t

## 一、组

| # | 功能 | 一句话 | 谁来做 | 状态 |
|---|---|---|---|---|
| 1 | 甲 | 乙 | 自研 | ✅ |

## 九、数一数

| 状态 | 项数 | 是哪些 |
|---|---|---|
| ✅ 已经能跑 | **1** | 1 |
| ⬜ 还没开始 | **2** | 11–13 以外的其余项（含 19–23、27） |
| **合计功能** | **3** | |
"""
    secs3, sc3, _, _ = build.parse_md(selfcheck_md)
    check("非功能表：只有 1 个功能分组、1 条",
          len(secs3) == 1 and len(secs3[0]["items"]) == 1,
          "%d 组" % len(secs3))
    check("非功能表：§九 被识别为自查表（不是条目）",
          sc3 is not None and sc3["rows"]["done"]["claimed"] == 1 and sc3["total"] == 3,
          str(sc3 and {k: v["claimed"] for k, v in sc3["rows"].items()}))
    check("非功能表：散文「是哪些」不会被当成编号名单",
          sc3["rows"]["todo"]["ids"] == [],
          str(sc3["rows"]["todo"]["ids"]))

    # 12) 预留的「第 6 列：证据/备注」通道真的通 —— 以后往 md 加一列就能显示，
    #     不需要改 build.py，也不需要另建 JSON 清单
    ev_md = """# t

## 一、组

| # | 功能 | 一句话 | 谁来做 | 状态 | 证据/备注 |
|---|---|---|---|---|---|
| 1 | 甲 | 乙 | 自研 | ✅ 已跑 | 见 开源线/某报告.md §3 |
"""
    secs4, _, _, _ = build.parse_md(ev_md)
    check("第 6 列「证据/备注」：加一列就被解析出来",
          len(secs4) == 1 and secs4[0]["items"][0]["evidence"] == "见 开源线/某报告.md §3",
          repr(secs4[0]["items"][0]["evidence"]) if secs4 else "解析失败")
    warns5 = []
    h4 = build.build_html(secs4, None, b"x", warns5)
    check("第 6 列「证据/备注」：会渲染进卡片",
          "见 开源线/某报告.md §3" in h4, "")

    n_fail = sum(1 for _, ok in results if not ok)
    print("\n—— 解析器断言 %d 项：%d pass / %d fail ——"
          % (len(results), len(results) - n_fail, n_fail))
    return 1 if n_fail else 0


if __name__ == "__main__":
    sys.exit(main())
