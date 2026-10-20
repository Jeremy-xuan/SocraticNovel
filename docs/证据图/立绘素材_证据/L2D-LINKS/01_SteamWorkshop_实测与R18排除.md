# 证据 01 · Steam Workshop（Live2DViewerEX, appid 616720）实测与 R18 排除

> 任务代号 **L2D-LINKS**。本轮所有数字均为 **2026-09-24 当天实测**（curl 直取 HTML，未登录状态）。
> 🔴 本件只记录「链接／计数／标签」这类事实，**不解读条款、不判断合法性**。

---

## 1. 基础入口（全部实测 HTTP 200，未登录可开）

| 用途 | URL | 实测 |
|---|---|---|
| 应用页 | https://steamcommunity.com/app/616720/ | 200，`<title>` = `Steam Community :: Live2DViewerEX` |
| Workshop 主页 | https://steamcommunity.com/app/616720/workshop/ | 200，`<title>` = `The Steam Workshop for Live2DViewerEX` |
| 全部 Live2D 条目（按订阅数排序） | https://steamcommunity.com/workshop/browse/?appid=616720&browsesort=totaluniquesubscribers&requiredtags%5B0%5D=Live2D&section=readytouseitems | 200，页面逐字 `6,412 entries matching filters` |
| 同上 + **排除 R-18** | 同上 URL 末尾追加 `&excludedtags%5B0%5D=R-18` | 200，页面逐字 `6,016 entries matching filters` |

→ 差值 **396** 条 = 带 R-18 标签的 Live2D 条目数（列表页计数口径）。

---

## 2. 🔴 R18 排除：开关在哪、参数叫什么（**这就是用户要的"过滤开关"**）

### 2.1 浏览页 UI 上的位置

Workshop 浏览页的**筛选面板**里有一个下拉框，**名字就叫 `Rating`**（HTML 原文：`<div class="cSl7Vd6a-Es- rUAq16oV7IQ-"><div class="_5CceBD1-9Kg-">Rating</div>…role="combobox"`）。

该下拉框的可选值（取自页面内嵌的机器可读筛选 schema，逐字）：

| 显示名 | 内部 id |
|---|---|
| `G` | 186141 |
| `PG-12` | 186142 |
| `R-15` | 186143 |
| `R-18` | 186144 |

同一 schema 里 `Type` 分类含 `Live2D`（id 123872）／`Spine`／`Video`／`Web`／`360 Image`／`360 Video`／`Mobile Video`。

已应用的筛选会在页面上显示成 chip；选中 R-18 时 chip 文案逐字为 `Rating: R-18`（**含**入筛选时 chip 图标是加号，**排除**筛选时 chip 图标是减号——两者文案相同，靠图标与计数区分）。

### 2.2 URL 参数（可直接拼进链接，实测有效）

```
&excludedtags%5B0%5D=R-18     ← 排除 R-18（解码后：&excludedtags[0]=R-18）
&requiredtags%5B0%5D=R-18     ← 只要 R-18
&requiredtags%5B0%5D=Live2D   ← 只要 Live2D 类型
```

🔴 **参数取的是「标签名」，不是数字 id**（实测）：

| 参数 | 结果 |
|---|---|
| `requiredtags[0]=R-18`（名字） | 生效 |
| `requiredtags[0]=186144`（id） | **返回 0 条** → 数字 id 写法无效 |
| `excludedtags[0]=R-18` | 生效（计数下降） |
| `excludedtags[0]=186144` | **不生效**（计数不变） |

### 2.3 条目页自己也会标 Rating（逐条核验的依据）

单个 item 页底部有标签行，HTML 逐字形如：

```html
<span class="workshopTagsTitle">Type:&nbsp;</span><a …>Live2D</a>
<span class="workshopTagsTitle">Rating:&nbsp;</span><a …>G</a>
```

→ 所以**每一个条目都能在它自己的页面上读到 `Rating:` 值**，本轮就是靠这一行逐条核对非 R18 的。

---

## 3. 检索 URL 实测（把关键词拼进 workshop 搜索）

| 目标 | URL | 实测计数 |
|---|---|---|
| 搜 `bang dream`（全部类型） | https://steamcommunity.com/workshop/browse/?appid=616720&searchtext=bang+dream&browsesort=textsearch&section=readytouseitems | 200，`425 entries` |
| 搜 `bang dream` **排除 R-18** | …&excludedtags%5B0%5D=R-18 | 200，`417 entries` |
| 搜 `bang dream` + 只要 Live2D + 排除 R-18 | …&requiredtags%5B0%5D=Live2D&excludedtags%5B0%5D=R-18 | 200，`396 entries` |
| 搜 `miku`（全部类型） | https://steamcommunity.com/workshop/browse/?appid=616720&searchtext=miku&browsesort=textsearch&section=readytouseitems | 200，`66 entries` |
| 搜 `miku` **排除 R-18** | …&excludedtags%5B0%5D=R-18 | 200，`57 entries` |
| 搜 `miku` + 只要 Live2D + 排除 R-18 | …&requiredtags%5B0%5D=Live2D&excludedtags%5B0%5D=R-18 | 200，`23 entries` |
| 搜 `初音ミク` + Live2D + 排除 R-18 | …searchtext=%E5%88%9D%E9%9F%B3%E3%83%9F%E3%82%AF… | 200，`2,017 entries`（该关键词命中面很宽，含大量非模型条目） |

页面会逐字回显 `Results for: "bang dream"` / `Results for: "miku"`，可作为"关键词真的生效"的凭据。

---

## 4. 逐条实测过的**非 R18** 条目（标题＋链接＋条目页自己的 Rating 标签）

> 🔴 **已按用户要求排除 R18**：下面每一条都是**打开 item 页读过它自己的 `Rating:` 标签**的，全部为 `G`、`Type: Live2D`。
> 带 R-18 标签的条目**一律未列入本表**（本轮也未描述其内容）。

### 4.1 BanG Dream!（10 条，全部实测 `Rating: G` / `Type: Live2D` / HTTP 200）

| # | 标题（item 页逐字） | 链接 |
|---|---|---|
| 1 | 【Bang Dream!】千早愛音 春季休閒裝 | https://steamcommunity.com/sharedfiles/filedetails/?id=3425915311 |
| 2 | [BangDream!]凑友希那-月明かりの下で | https://steamcommunity.com/sharedfiles/filedetails/?id=3572003509 |
| 3 | [BangDream]高松灯 | https://steamcommunity.com/sharedfiles/filedetails/?id=3427130395 |
| 4 | 【Bang Dream!】要 楽奈 夏季學生裝 | https://steamcommunity.com/sharedfiles/filedetails/?id=3428591142 |
| 5 | 【Bang Dream】素世 雨はずっと | https://steamcommunity.com/sharedfiles/filedetails/?id=3169255582 |
| 6 | [Bang Dream]白金 燐子(戦場に詠う花嫁) | https://steamcommunity.com/sharedfiles/filedetails/?id=2180750362 |
| 7 | [Bang Dream]倉田 ましろ(ドキドキのお嬢様学校) | https://steamcommunity.com/sharedfiles/filedetails/?id=2025271218 |
| 8 | [Bang Dream]湊 友希那(無敵の歌) | https://steamcommunity.com/sharedfiles/filedetails/?id=2181223688 |
| 9 | Bang Dream 丸山彩 | https://steamcommunity.com/sharedfiles/filedetails/?id=2100939633 |
| 10 | [BangDream!]市谷有咲-蒸汽缭绕的旅途 | https://steamcommunity.com/sharedfiles/filedetails/?id=3525469689 |

### 4.2 初音ミク / Miku（实测通过的部分）

| # | 标题（item 页逐字） | Rating | 链接 |
|---|---|---|---|
| 1 | 初音ミク Miku | G | https://steamcommunity.com/sharedfiles/filedetails/?id=1258760465 |
| 2 | Live2d Hatsune Miku【语音】 | G | https://steamcommunity.com/sharedfiles/filedetails/?id=1677631122 |
| 3 | 感谢祭MIKU LIVE2D临摹 | G | https://steamcommunity.com/sharedfiles/filedetails/?id=965831591 |
| 4 | 景品小公仔式MIKU beta | G | https://steamcommunity.com/sharedfiles/filedetails/?id=1682431324 |
| 5 | Hatsune Miku (初音ミク) | G | https://steamcommunity.com/sharedfiles/filedetails/?id=2173046636 |
| 6 | snow miku | G | https://steamcommunity.com/sharedfiles/filedetails/?id=2357217097 |

### 4.3 ⚠️ 未实测成功的条目（如实记）

连续抓取 item 页会被 Steam 限流：**HTTP 429**（响应体仍是页面壳，但 `workshopItemTitle` 字段不存在 → 解析为 null）。已重试（每次间隔 12–20 秒、每条约 3 次）仍失败。

未拿到 Rating 标签、因而**未列入上表**的条目 id（标题取自列表页，仅作线索）：

| 列表页标题 | id | 状态 |
|---|---|---|
| 39！十周年版本MIKU live2d | 1324069496 | 429，未实测 |
| Mamama式MIKU live2d化 | 1372256842 | 429，未实测 |
| Miku Project DIVA-F2 | 1139342724 | 429，未实测 |
| miku | 3782749953 | 429，未实测 |
| 世界计划（pjsk）25miku | 3434419168 | 未打开 |
| miku_night | 2818470877 | 未打开 |
| 21miku_night | 2890013549 | 未打开 |
| 【Bang Dream】 千早愛音 お花見の記念に！ | 3188154806 | 未打开 |

> 结论口径：**"未实测" ≠ "有 R18"**，只是本轮没读到它自己的 Rating 标签。上表 4.1／4.2 的 16 条是**读过标签**的。

---

## 5. 该 Workshop 页面「有没有写使用条件」

- Workshop **列表页**：**没写**（页面内无模型使用条件内容；页脚只有平台级的 `Steam Subscriber Agreement`／`Legal` 这类 Steam 自己的链接）。
- 各 **item 页**：**没写**（item 页只有标题、预览图、标签、订阅按钮、评论；没有模型作者自己的使用条件段落）。
- 本轮**未逐条看** item 页的说明区正文（`说明` 段落是否含作者自述条件，本轮未逐条核）→ 记为「没看」。

---

## 6. 一手证据文件（本轮抓取的 HTML 留在 /tmp，未随件提交）

- `/tmp/sw_app.html`（workshop 主页）
- `/tmp/sw_browse.html`（Live2D 全量 6,412）
- `/tmp/sw_bd.html`（bang dream 检索 425）
- `/tmp/sw_bd_ex.html`（bang dream 排除 R-18 → 417）
- `/tmp/sw_bd_l2d.html`（bang dream + Live2D + 排除 R-18 → 396）
- `/tmp/sw_miku.html`（miku 66）／`/tmp/sw_miku_ex.html`（57）／`/tmp/sw_miku_l2d.html`（23）
- 解析脚本 `/tmp/parse_sw.py`、`/tmp/itemcheck.py`、`/tmp/itemcheck2.py`
