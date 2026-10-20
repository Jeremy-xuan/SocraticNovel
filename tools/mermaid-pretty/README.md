# mermaid-pretty · PoC

把 mermaid 图从「默认那副样子」变成「克劳德那种观感」的最小可搬实现。

**报告**：`../../../实现报告_MERMAID1_Claude式图表_2026-09-24.md`（结论、证据、接线说明都在那里）

---

## 1 · 这堆文件是什么

| 文件 | 作用 | 能不能直接搬进产品 |
|---|---|---|
| `claude-mermaid-theme.mjs` | 主题配置：`themeVariables` + `themeCSS`，导出 `claudeMermaidConfig()` | ✅ **整段抄走** |
| `claude-mermaid-anim.mjs` | 动画：`animateStagger()`（逐层长出）、`streamRender()`（按源码边长） | ✅ **整段抄走** |
| `demo.html` | 演示页：同一源码左右并排「默认 vs Claude 风」，可切候选 A/B/C | 参考用 |
| `record.cjs` | Playwright 驱动：出对比图、录 GIF、跑性能 | 工具脚本 |
| `out/` | 全部产物（对比图 / GIF / `perf.json`） | — |

**没有新增任何依赖。** mermaid 用的是仓库里已有的那份产物：

```
code/clients/classroom-ui/vendor/mermaid-11.17.2/mermaid.min.js
sha256 581ed7d74bd9048d0e3a91363927d72ef22942d7722546b27f7cc29e35390eb8
```

与服务端 `socratic-engine/node_modules/mermaid/dist/mermaid.min.js` **逐字节相同**（见该目录的 `BUILD-INFO.txt`）。
→ 演示页里画出来的图，和我们客户端消息流里画的是**同一份实现**。

⚠️ **版本只锚定 11.17.2**。换版本＝重新验证，不得外推（本项目「第三方依赖必须成对锚定版本」规矩）。

---

## 2 · 跑法

```bash
# 项目根
/opt/homebrew/bin/node 开源线/DSH定制/code/tools/mermaid-pretty/record.cjs
```

产出全部落在 `out/`。脚本用 Playwright 的 `page.route` 从磁盘喂静态文件，**不另起 http 服务**。

想手开演示页（`demo.html` 用 ES module，`file://` 下会被 CORS 挡）：

```bash
cd /Users/wujunjie/Documents/ChatGPT/大学申请
python3 -m http.server 8899
# 然后开 http://127.0.0.1:8899/开源线/DSH定制/code/tools/mermaid-pretty/demo.html
```

---

## 3 · 主题变量：逐个对着产物核过

不是照文档抄的。核法：在 `mermaid.min.js` 里定位基础主题类
（`class{...constructor(){this.background="#f4f4f4";this.primaryColor="#fff4dd";…}}`
与紧接的 `updateColors()`），逐条比对。

**确认存在的变量**（本主题用到的）：

```
darkMode background fontFamily fontSize
primaryColor primaryTextColor primaryBorderColor
secondaryColor tertiaryColor
mainBkg nodeBorder nodeTextColor
lineColor textColor titleColor edgeLabelBackground defaultLinkColor
clusterBkg clusterBorder
actorBkg actorBorder actorTextColor actorLineColor
signalColor signalTextColor
labelBoxBkgColor labelBoxBorderColor labelTextColor loopTextColor
noteBkgColor noteTextColor noteBorderColor
activationBkgColor activationBorderColor sequenceNumberColor
classText
stateBkg stateBorder labelBackgroundColor compositeBackground compositeBorder
transitionColor transitionLabelColor
attributeBackgroundColorOdd attributeBackgroundColorEven
pie1..pie8 pieTitleTextColor pieSectionTextColor pieLegendTextColor
pieStrokeColor pieOuterStrokeColor
sectionBkgColor altSectionBkgColor sectionBkgColor2
taskBkgColor taskTextColor taskTextOutsideColor taskTextLightColor taskBorderColor
activeTaskBkgColor activeTaskBorderColor doneTaskBkgColor doneTaskBorderColor
gridColor todayLineColor
errorBkgColor errorTextColor
radius strokeWidth useGradient dropShadow
```

**🔴 一个必须知道的坑**：`theme: 'base'` 是**唯一**会完整吃 `themeVariables` 的主题。
用 `default`/`forest`/`neutral`/`dark` 时，一部分变量会被该主题自己的 `getThemeVariables()`
覆盖掉。→ **换主题必须同时把 `theme` 改成 `'base'`**，否则会出现「改了半天没生效」。

**另外两个实测坑**：

1. **`themeCSS` 里的 `&` 嵌套是对的，但注释会被 stylis 抹掉。**
   我一开始用「注释字符串是否还在」判断 `themeCSS` 有没有生效，**结论是错的**。
   真正的验证方式是**读计算样式**：
   `getComputedStyle(svg.querySelector('g.node rect')).rx === '8px'`、
   `.filter === 'none'`、`stroke === 'rgb(217, 212, 200)'`。
2. **`securityLevel: 'strict'` 下 `themeCSS` 照样生效**（实测上面三个值都对）。
   → **不需要为了主题去放宽安全等级**，客户端现在用的 `strict` 保持不动。

---

## 4 · mermaid 自己到底有没有动画（对着产物查的）

在 `mermaid.min.js` 里全文检索，**整个 11.17.2 只有这些动画相关的东西**：

```css
@keyframes edge-animation-frame { from { stroke-dashoffset: 0; } }
@keyframes dash { to { stroke-dashoffset: 0; } }
.edge-animation-slow { stroke-dasharray: 9,5 !important; stroke-dashoffset: 900;
                       animation: dash 50s linear infinite; stroke-linecap: round; }
.edge-animation-fast { stroke-dasharray: 9,5 !important; stroke-dashoffset: 900;
                       animation: dash 20s linear infinite; stroke-linecap: round; }
```

来源：`getStyles()` 里基础样式表那一段（在 `mermaid.min.js` 偏移约 561 474 处）。

判定逻辑也在同一份产物里：

```js
t.animate && (N = "edge-animation-fast"), t.animation && (N = "edge-animation-" + t.animation)
```

**结论**：mermaid 11.17.2 **自带的动画只有「连线上的虚线在流动」**（`A e1@--> B` 配 `e1@{ animate: true }`）。
**没有**节点逐个出现、没有连线生长、没有淡入缩放。
→ 「一个节点一个节点长出来」**一定是宿主加的东西**，不是 mermaid 自带的。

---

## 5 · 动画算法（`claude-mermaid-anim.mjs`）

### 候选 B · `animateStagger(svg, opts)`

不解析源码，**直接从渲染结果量位置推层号**：

1. 量整张 `<svg>` 的 viewBox 定主轴 —— flowchart 按长宽比判（高≥宽用 y，否则用 x）；
   其它图型（sequence/state/class/er/gantt…）一律 y。
2. 把单元按主轴坐标装桶（容差 18px），桶序号＝层号。
3. 🔴 **层合并**：层数超过 `maxSteps`（默认 26）时，相邻层并成一步 —— 否则链式长图
   （`N0→N1→…→N159`，211 层）整段要 27 秒。
4. 🔴 **总时长封顶**：`maxTotal`（默认 2600 ms）预算内压步间隔。
   ⚠️ 只压步间隔不够（压到下限 24 ms 时 211 层仍要 5.96 s），**必须**配合第 3 步的层合并。
5. 节点先 `opacity:0`，轮到自己那步再进场。
6. 连线：能算 `getTotalLength()` 且**本身不是虚线**的，用 `stroke-dasharray/offset` 从
   `L → 0` 过渡「画出来」；本身是虚线的（时序图回信、生命线）退回淡入，**不破坏虚线语义**。
7. `prefers-reduced-motion` 下整段关掉。

为什么用几何分层而不是解析语法：对 7 种图型通用，不用为每种图写解析器，也不会因为
源码写法怪（子图、链式箭头、`-.->`、`==>`）而失效。同类做法见
`neolivz/animated-mermaid-diagrams`（state 图用 BFS 层序）——我们换成几何分层，省掉解析器。

**🔴 另一个坑：进场动画只许用独立变换属性 `translate` / `scale`，绝不能用 `transform`。**
mermaid 把节点位置写成 `<g class="node" transform="translate(x,y)">`，
而 **CSS 的 `transform` 属性会整体覆盖这个呈现属性** → 动画期间节点全部跳到画布原点，图散架
（我第一次录的 GIF 就是这个 bug：节点文字浮在顶上、框不见了）。
`translate`/`scale` 是独立属性，按规范排在 `transform` **之后**复合，能叠在原有的 `translate(x,y)` 上。
实测修复后，动画期间每个节点的 `getBoundingClientRect()` 与终态**完全一致**。

### 候选 C · `streamRender(container, source, mermaidApi, opts)`

把源码**按行**一片片喂给 `mermaid.render()`，每次都是真的重渲染。
头部（图类型声明 + frontmatter）永远保留；某一片语法不完整（写到一半的边）就保留上一张好图继续。

⚠️ **老实说清楚**：在我们现在的链路里，mermaid 源码是 `classroom_draw` **一次调用整体给出**的，
所以这里的「增量」是**按行把完整源码一点点喂进去**，模拟「模型正在写」的节奏。
**它不是真的在流式接收。** 真流式的唯一入口是「工具入参流」（见报告 §4.4）。

---

## 6 · 性能（实测，`out/perf.json`）

见报告 §3.5 的表格。测法：`record.cjs` 第 4 段，在 headless Chromium 里对
5/10/20/40/80/160 节点的 flowchart 分别测默认渲染、Claude 主题渲染、候选 B 全动画墙钟时间。
