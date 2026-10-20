# 实现报告 · MERMAID-1 · 「Claude 那种 mermaid」到底是什么，我们能不能做出来

> 任务代号：**MERMAID-1** · 2026-09-24
> 工作目录：`/Users/wujunjie/Documents/ChatGPT/大学申请`
> 产出目录：`开源线/DSH定制/code/tools/mermaid-pretty/`
> 报告落盘：`开源线/DSH定制/实现报告_MERMAID1_Claude式图表_2026-09-24.md`（本文件）
>
> **没碰**：`code/clients/**`（只读）、`code/plugins/**`、`code/classrooms/**`、`code/skills/**`、
> `code/acceptance/**`、`code/tools/animation-*/**`、`code/tools/portrait2live/**`、
> `~/SocraticNovel-wt/`、`~/SocraticNovel-GitHub仓库/`、任何 profile。
> **没新增依赖**（mermaid 用仓库里已有的那份产物；Playwright 用项目根已有的 1.63）。
> **没 git commit / push**。**没做任何法律/许可研究**（只记了「该页有没有写使用条件」，见 §1.5）。

---

## §0 · 一句话结论（先看这个）

🔴 **用户看到的「Claude 那种精致、带动画、节点一个一个长出来的图」，绝大多数不是 mermaid。**

Anthropic 官方 Help Center 的原话是：**"Claude builds them using HTML—the same building blocks as web pages"**，
官方教程里「下载」下来的源码是 **`.svg` 或 `.html`**。
所以它「精致」是因为那是 Claude 现写的一个网页；它「会动」是因为那网页里的 CSS 动画想怎么写就怎么写；
它「一个一个长出来」是因为 **Claude 是一块一块把 HTML 吐出来、宿主增量贴到 DOM 上的**——
不是 mermaid 有某个动画开关。

**mermaid 在 Claude 体系里是另一条线**：artifact 类型 `application/vnd.ant.mermaid`，
渲染在侧栏 artifact 面板里，外观受 mermaid 自己限制（第三方综述原话：**"Limited aesthetic control"**）。
另有一个官方 connector（Mermaid Chart，2025-11 上架）能把 mermaid 渲染成"high-quality SVG"放进交互 UI——
**如果用户在 claude.ai 里看到 mermaid 被渲染得挺好看，那大概率是这个 connector，不是 mermaid 原生。**

**能不能做出来？能。** 两条路：
- **不换渲染器**（推荐）：mermaid 主题变量 + 主题 CSS 换外观，再叠一层「逐层长出」的动画。
  **零新依赖、零链路改动**，就是我们现在这条 `classroom_draw → 落盘 → 客户端 render` 的路。
  → PoC 已跑通，对比图与动图见 §3.4。
- **换成 Claude 那条路**：不走 mermaid，让模型直接产出 HTML/SVG。外观/动画上限高得多，
  但要换渲染管线、要沙箱、要重做 `classroom_draw` 的契约。→ 见候选 D（§2.4，本轮不做）。

---

## §1 · 目标钉死：Claude 那边到底是什么

### 1.1 检索式（7 组，全部实际跑过）

| # | 检索式 | 通道 | 拿到了什么 |
|---|---|---|---|
| 1 | `Claude mermaid diagram rendering animation nodes appear one by one` / `how to make mermaid look like Claude aesthetic theme` / `claude.ai mermaid render animation CSS implementation reverse engineering` / `mermaid.js animate nodes appearing sequentially CSS` | `web_search`（exa） | 找到 `neolivz/animated-mermaid-diagrams`、`WJH-makers/typora-theme-claude-like`、`veelenga/claude-mermaid` |
| 2 | `Anthropic Claude artifacts supported libraries mermaid diagram official documentation` / `"Claude" mermaid diagram render looks different style theme screenshot` | `advanced_search`（exa） | 找到 `anthropics/claude-code#81882`（"Mermaid is documented as a first-class Artifact feature"）、官方 connector 目录里的 Mermaid Chart |
| 3 | `claude.ai chat inline mermaid rendering diagram appears in conversation native` / `Anthropic release notes mermaid diagrams rendering chat feature` | `advanced_search`（exa） | 🔴 **找到关键官方来源**：`support.claude.com/…/custom-visuals-in-chat-and-cowork`、`claude.com/blog/claude-builds-visuals`、`aletheus.com` 六类可视化综述 |
| 4 | `"Imagine with Claude" Anthropic preview real time visuals build` | `advanced_search`（exa） | 🔴 找到 **Reid Barber 的逆向**（`private_streamable_*` 分块吐 HTML）、官方学生指南 |
| 5 | `claude artifacts system prompt mermaid diagram instructions "mermaid" text` | `advanced_search`（exa） | 找到泄漏系统提示全文（`application/vnd.ant.mermaid`）、`dejan.ai` 的 MIME 类型表 |
| 6 | `mermaid themeCSS animate nodes fade in edge draw` / `mermaid themeVariables beautiful theme` | `advanced_search`（exa） | 找到 `beautiful-mermaid`（Craft，11.1k star）、mermaid 官方 theming 文档 |
| 7 | **本地产物取证**：`grep` / `node` 扫 `vendor/mermaid-11.17.2/mermaid.min.js`（3 572 661 B）里的动画原语 | 本机 | 🔴 **硬证据**：mermaid 11.17.2 自带的动画只有「连线虚线流动」，见 §1.4 |

### 1.2 结论：那不是 mermaid（逐条给原文）

**① 官方博客**（`https://claude.com/blog/claude-builds-visuals`，2026-03-12，
标题 "Claude now creates interactive charts, diagrams and visualizations"）逐字：

> "Last fall, we previewed **Imagine with Claude**: a new way for Claude to **build visuals in real time**, without any code."
>
> "Claude can create custom charts, diagrams and other visualizations **in-line in its responses**—and then tweak and modify its creations as the conversation develops."
>
> "They appear **in-line, rather than in a side panel**, and they're temporary—they change or disappear as the conversation evolves."

🔴 **"build visuals in real time"** 就是用户说的「实时渲染」。

**② 官方 Help Center**（`https://support.claude.com/en/articles/13979539-custom-visuals-in-chat-and-cowork`，
2026-04-22）逐字：

> "Claude can generate custom diagrams, charts, and interactive visuals directly in your conversation…
> **rendered inline as part of the response**."
>
> "### How are custom visuals built?
> Custom visuals aren't photos or illustrations. **Claude builds them using HTML**—the same building blocks
> as web pages—so they're interactive and specific to your question rather than static images."
>
> "**Copy as image** — grab a static snapshot… **Download** — save the visual as an **.svg or .html** file."
>
> "Custom visuals are **ephemeral by default**… Think of them less like a finished file and more like a whiteboard sketch."

🔴 **"Claude builds them using HTML"** + **下载源码是 .svg/.html** → 这是 HTML，不是 mermaid。

**③ 官方教程**（`https://academy.claude.com/tutorials/imagine-with-claude-student-guide`）逐字：

> "**The visual streams in alongside the text** and the conversation keeps going."
>
> "Appears as part of Claude's answer — **in the flow of the conversation, not a side panel**.
> If you've used Artifacts, this is the lighter version."
>
> "**Diagrams, charts, tools — not image generation.**"
>
> "**Download — source code (.svg or .html).**"

**④ 官方用例页**（`https://academy.claude.com/use-cases/visualize-the-mechanism-behind-an-explanation-mid-chat`）逐字：

> "Rather than a full artifact, **the diagram streams in where the text would have been**, and the conversation keeps going."

🔴 **"streams in"** —— 这就是用户说的「一个一个节点逐渐长出来」。

**⑤ mermaid 在 Claude 体系里是另一条线**（泄漏系统提示，第三方收集，非 Anthropic 发布）：

`https://zerotwo.ai/prompts/system-prompts/anthropic/anthropic-claude-artifacts`
（# claude-artifacts_20240620，source 指向 `x.com/elder_plinius`）逐字：

> "Mermaid Diagrams: `application/vnd.ant.mermaid`
> - The user interface will render Mermaid diagrams placed within the artifact tags.
> - **Do not put Mermaid code in a code block when using artifacts.**"

`https://dejan.ai/blog/claude-system-internals/`（第三方逆向；作者自述
"reconstructed from Claude's own output and from a public collection of leaked prompts,
**not published by Anthropic**"）的 MIME 类型表：

| artifact 类型 | MIME |
|---|---|
| Code | `application/vnd.ant.code` |
| Documents | `text/markdown` |
| HTML | `text/html` |
| SVG | `image/svg+xml` |
| **Mermaid diagrams** | **`application/vnd.ant.mermaid`** |
| React components | `application/vnd.ant.react` |

🔴 **这份系统提示里关于 mermaid 只有三句话**：类型名、会在界面里渲染、别放代码块里。
**没有一句**讲主题、配色、动画、字号、圆角。
→ 「Claude 的 mermaid 长什么样、怎么动」**在官方材料里查不到**。

**⑥ 官方 connector 目录**（`https://claude.com/marketplace/connectors/mermaid-chart`）逐字：

> "Validates Mermaid syntax, renders diagrams as **high-quality SVG**, and displays them
> **instantly in an interactive UI where users can preview, zoom, and iterate in real time**."
> （工具名 `display_mermaid`；Made by Mermaid Chart Inc；**Added November 2025**）

→ 这是 Claude 生态里**唯一**一个「把 mermaid 渲染得挺好看」的官方入口。
**如果用户在 claude.ai 里看到 mermaid 被渲染成漂亮的图，最可能就是它。**

**⑦ 第三方综述（外观层）**（`https://aletheus.com/2026/05/21/claude-ai-native-visualization-types/`）
把 Claude chat 的原生可视化分成 6 类，其中 mermaid 那一条逐字：

> "**Mermaid** — Markdown-style diagram syntax. Fast and low-effort. **Limited aesthetic control.**
> Good for rough structure before committing to polished SVG."

同页把 `Interactive HTML` 描述成 "Renders inline with live interactivity — buttons, filters, toggles, **animations**"，
并在「可指定的样式控制」里列出 **"Animation — none, subtle, or expressive"**。

### 1.3 🔴 证据分栏（严格区分「外观」与「实现」）

| 结论 | 证据等级 | 出处 |
|---|---|---|
| Claude 在**对话里内联**画图（不是侧栏 artifact） | **官方文档**（一手） | Help Center 13979539；官方博客 claude-builds-visuals |
| 那些图**是 HTML/SVG**，不是 mermaid | **官方文档**（一手，逐字 "Claude builds them using HTML"） | Help Center 13979539 |
| 下载下来的源码是 **.svg / .html** | **官方教程**（一手） | academy.claude.com 学生指南 |
| 图是**流式**出现的（"streams in"） | **官方文字**（一手，但没有可看的动图） | 官方教程 + 用例页 |
| 「分块吐 HTML → 增量贴 DOM」这个机制 | **第三方逆向**（针对 `Imagine with Claude` 那个研究预览 app，非官方文档，**不等于** claude.ai 现在用的同一套） | reidbarber.com/blog/reverse-engineering-imagine-with-claude |
| Claude 的 mermaid artifact 类型名与「会在界面里渲染」 | **泄漏系统提示**（第三方收集，**非 Anthropic 发布**） | zerotwo.ai / dejan.ai |
| **Claude 的 mermaid 主题变量 / 配色 / 动画配置** | ❌ **无任何一手或二手材料** | 查不到 |
| 设计语言（暖米底、低饱和、发丝线、大圆角、无投影） | **外观证据**（我下载官方博客的 GIF/PNG 并逐帧看了，见 §1.4） | `out/evidence-claude-blog/` |
| 「节点一个一个长出来」的具体节奏/时长/缓动 | ❌ **无证据**，只能看到文字 "streams in" | — |

**→ 所以：PoC 里那套「Claude 风」色值是我按外观证据定的设计推断，
不是"Claude 就是这么实现的"。** 这句话在 `claude-mermaid-theme.mjs` 文件头也写了一遍。

### 1.4 外观证据：我实际下载并看了的东西

来源：官方博客 `claude.com/blog/claude-builds-visuals` 里的两张媒体资源（已落盘）：

| 文件 | 是什么 | 我看到的 |
|---|---|---|
| `out/evidence-claude-blog/claude-blog-inline-visual.gif` | 官方博客 GIF，11.71 s / 1920×1080 / 33.33 fps | 一段 claude.ai 录屏：问「Create an interactive version of the periodic table」→ 内联出现一张**交互式元素周期表**，鼠标点 Al → 下方详情卡就地换成 Ca |
| `out/evidence-claude-blog/claude-blog-recipe-card.png` | 官方博客 PNG，1920×1080 | 另一段录屏：问非乳制香草蛋糕食谱 → 内联出现一张**食谱卡**（图 + 份量加减 + 「Get cooking」黑色药丸按钮） |
| `out/evidence-claude-blog/frame-01..12.png` | 我从 GIF 按 1 fps 抽的 12 帧 | 同上，用来逐帧确认 |

🔴 **必须说清楚的两件事**：
1. 这两段录屏**都不是 mermaid**——一个是交互式元素周期表，一个是食谱卡。
   这本身就是「Claude 那些漂亮的图不是 mermaid」的直接视觉证据。
2. 这段 GIF 演的是**交互**（点击 → 详情更新），**不是**「节点逐个长出来」的建造过程。
   → 「逐层长出」我**只有官方文字证据**（"streams in"），**没有可看的动图**。

**从这两张图里读出来的设计语言**（外观证据，逐条）：

| # | 特征 | 观察 |
|---|---|---|
| 1 | 底色 | 卡片近象牙白（`#FAF9F5` 量级），应用画布更暖的米（`#F0EEE6` 量级） |
| 2 | 描边 | 发丝级、暖灰（`#E3DFD4` / `#D9D4C8` 量级），**没有投影** |
| 3 | 圆角 | 大圆角：卡片 12–16px，色块 6–8px，按钮全圆 |
| 4 | 配色 | 极低饱和粉彩分类色（元素周期表的分类色块几乎是"纸上的水彩"），强调色是暖赤陶 |
| 5 | 字体 | 正文衬线、UI 无衬线；**字重基本一致，不靠加粗做层级** |
| 6 | 图例 | 一排小色块 + 标签横向排列，不用边框框起来 |
| 7 | 间距 | 宽松；详情卡里「标签 / 值」两列对齐，值靠右 |
| 8 | 交互 | 点击 → 下方就地更新详情（不是弹窗） |

### 1.5 mermaid 自己有没有动画（对着我们那份产物查的）

在 `vendor/mermaid-11.17.2/mermaid.min.js` 里全文检索，**整个 11.17.2 只有这些动画原语**：

```css
@keyframes edge-animation-frame { from { stroke-dashoffset: 0; } }
@keyframes dash { to { stroke-dashoffset: 0; } }
.edge-animation-slow { stroke-dasharray: 9,5 !important; stroke-dashoffset: 900;
                       animation: dash 50s linear infinite; stroke-linecap: round; }
.edge-animation-fast { stroke-dasharray: 9,5 !important; stroke-dashoffset: 900;
                       animation: dash 20s linear infinite; stroke-linecap: round; }
```

（位置：`mermaid.min.js` 偏移 ≈ 561 474，`getStyles()` 的基础样式表里。）

判定逻辑也在同一份产物里：

```js
t.animate && (N = "edge-animation-fast"), t.animation && (N = "edge-animation-" + t.animation);
```

**结论**：mermaid 11.17.2 **自带的动画只有「连线上的虚线在流动」**
（`A e1@--> B` 配 `e1@{ animate: true }`）。
**没有**节点逐个出现、没有连线生长、没有淡入缩放。
→ **「一个节点一个节点长出来」一定是宿主加的东西。**

（注：`animate:!0` 那几个命中是 cytoscape 的布局选项，与渲染动画无关。）

### 1.6 同类先例（按项目规矩：先读现成实现）

| 项目 | 它怎么做 | 我们借什么 / 不借什么 |
|---|---|---|
| `lukilabs/beautiful-mermaid`（Craft，**11.1k star**，MIT） | **自己写了一个渲染器**：ELK.js 布局 + 自绘 SVG + 15 套主题 + `color-mix()` 双色派生（只给 `bg`/`fg` 就能推出全套）+ CSS 自定义属性做免重渲染换肤 | **借**：双色派生 + CSS 变量换肤的思路；**不借**：它**替换掉了 mermaid 渲染器**（要装新包），违背「不新增依赖」且要重做链路。留作候选 D 的参考 |
| `neolivz/animated-mermaid-diagrams`（MIT，star 极少） | 也是自绘渲染器（只依赖 `@dagrejs/dagre`）。**动画做法**：sequence「request arrows: solid line, **draws via stroke-dashoffset animation**」；flowchart「**Nodes fade/scale in layer by layer, then edges draw themselves to connect them**」；state「transitions draw one-by-one following **BFS** from initial state」 | 🔴 **借**：这**正是**「节点逐层出现 + 连线画出来」的做法，我的候选 B 就是这条（用几何分层替代 BFS 解析，跨图型通用）。**不借**：同样要换渲染器 |
| `veelenga/claude-mermaid` | Claude Code 的 MCP server，浏览器里 live reload 预览 | 只是预览工具，不解决外观 |
| `diegomarino/claude-toolshed` 的 mermaid 插件 | 底层就是 `beautiful-mermaid` | 佐证「想要好看就得换渲染器」是社区共识 |
| `WJH-makers/typora-theme-claude-like` | Typora 主题（暖米纸 + Mermaid-ready） | 说明「Claude-like 主题」已经是一个被复刻过的风格标签；**该页有没有写使用条件：README 未列条款** |

**判断**：社区里「让 mermaid 好看」有两条路——① 换渲染器（beautiful-mermaid 路线）；
② 换主题 + 加动画（我们的路线）。**我们只能走 ②**（不新增依赖），所以 PoC 就是 ②。

---

## §2 · 三个候选（交给用户挑）

### 候选 A · 只换主题（静态更好看，**没有动画**）

> **一句人话**：图还是"啪"一下整张出来，但配色、圆角、描边、字体全换成 Claude 那套观感。

- **样例**：`out/compare-A-flow.png`（流程图）· `out/compare-A-seq.png`（时序图）· `out/compare-A-state.png`（状态图）
  —— 每张都是**同一源码、左右并排**（左 mermaid 默认，右 Claude 风）。
- **代价**：≈ 0。就是一个配置对象（`claude-mermaid-theme.mjs` 里 `claudeMermaidConfig()`）。
  **渲染耗时不变**（实测 §3.5：160 节点默认 473.9 ms vs Claude 主题 488.6 ms，差 ≤ 3%，噪声量级）。
  零新依赖，零链路改动。
- **做到什么程度**：把「默认 mermaid 那身薰衣草紫 + 灰投影 + 直角框」换成「暖象牙纸 + 发丝线 + 大圆角 + 低饱和」。
  **做不到**：Claude 那种「一张图里三个联动面板 + 滑块」的层次——那已经不是 mermaid 的形态了。

### 候选 B · 主题 ＋ 渲染完成后「逐层长出」（推荐先上这个）

> **一句人话**：图仍然是瞬间算好的，但**先不出来**——按图的层级从上往下一层层淡入，
> 每层的连线跟着"画"出来。看起来就像有人在白板上依次写。

- **样例**：`out/anim-B-stagger.gif`（动图）· `out/compare-B-stagger.png`（终态）
- **做法**：mermaid 渲染完 → 量出每个元素的**实际位置**推层号（不解析源码，跨图型通用）
  → 节点按层 `opacity/translate/scale` 进场 → 连线用 `stroke-dashoffset` 从 L 画到 0。
- **代价**：一个 CSS 注入 + 一段 ~230 行 JS（`claude-mermaid-anim.mjs` 里 `animateStagger()`）。
  **零新依赖**。渲染耗时不变（动画是叠加的，不占渲染时间）。
  **动画时长**：实测 5 节点 1.44 s / 10 节点 2.22 s / 20 节点及以上**硬封顶 2.60 s**——见 §3.5。
- **⚠️ 已知限制**：动画时长跟**层数**走，链式长图（A→B→C→…）层数≈节点数。
  **必须两步一起做才封得住**：① 层合并成至多 26 步；② 总时长预算 2600 ms。
  （只做 ② 不做 ①：211 层压到下限 24 ms 仍要 5.96 s——我第一版实测到过。）

### 候选 C · 真的「边生成边长出来」（**流式**）

> **一句人话**：源码一行一行往里喂，图每加一行就重新画一次——**图还没写完就在长**。

- **样例**：`out/anim-C-stream.gif`（动图）· `out/compare-C-stream.png`（终态）
- **🔴 老实说清楚：这条在我们现在的链路里不可行（只做到"仿真"）**：
  - 我们的链路是 **工具调用 → 服务端落盘 → 客户端渲染**。`classroom_draw` 的 `source`
    **是一次调用整体给出的**（`block.argsRaw` 里是完整入参 JSON，服务端 schema 还校验了 ≤20000 字符）。
    **没有"逐字流"这回事。**
  - 所以 PoC 里的「增量」是**按行把完整源码一点点喂进去**（每行之间隔 120 ms），
    **每次都是真的 `mermaid.render()` 重渲染**——视觉上像"边长出来"，但**不是真的在流式接收**。
  - **真流式的唯一入口**是「工具入参流」：如果客户端能拿到**正在流式到达的 `argsRaw` 前缀**，
    把里面已经出现的 `source` 片段交给同一个函数，那就是真流式。见 §4.4。
- **代价**：
  - **渲染成本 × 行数**：实测 20 节点图 26 行 → 26 次重渲染，纯渲染 **1.10 s**（加 120 ms 间隔 = 4.22 s 墙钟）；
    160 节点 212 行 → 纯渲染 **56.3 s**（§3.5）。**随行数线性爆炸。**
  - **布局会跳**：每重渲染一次 dagre 重排一次，节点位置会移动。
    这是"边写边长"的固有观感（Claude 那边也一样），但**看起来比候选 B 抖**。
  - 需要处理"写到一半语法不完整"（PoC 里：抛错就保留上一张好图继续）。

### 候选 D · 换成 Claude 那条路（**本轮不做，只登记**）

> **一句人话**：不用 mermaid 了，让老师（模型）直接写 HTML/SVG，客户端把它渲染出来。

- **这才是「真正复刻 Claude」**：外观和动画的上限由模型和 CSS 决定，不受 mermaid 限制。
- **代价（大）**：① `classroom_draw` 的产物契约要从「mermaid 源码」改成「HTML/SVG」；
  ② 客户端要沙箱化渲染（`srcdoc` iframe 或 `innerHTML` + 净化），现在 `securityLevel:'strict'` 那层保护就没了；
  ③ 服务端 `mermaid.parse()` 那道「这张图能不能渲染」的前置校验要换掉；
  ④ 模型输出 token 会显著变多（Claude 那边一份可视化是整页 HTML）。
- **先例**：`beautiful-mermaid` 是"换渲染器"的轻量版；Reid Barber 逆向的 `Imagine with Claude`
  是"模型分块吐 HTML + morphdom 增量贴"的完整版（`private_streamable_*`）。
- **建议**：**先不做**。等候选 A/B 落地、用户看过效果再定。

---

## §3 · PoC

### 3.1 环境与版本锚定（本项目「成对锚定版本」规矩）

| 项 | 值 |
|---|---|
| mermaid | **11.17.2**，用仓库里已有的 `code/clients/classroom-ui/vendor/mermaid-11.17.2/mermaid.min.js` |
| 该文件 sha256 | `581ed7d74bd9048d0e3a91363927d72ef22942d7722546b27f7cc29e35390eb8`（3 572 661 B） |
| 与服务端一致性 | 与服务端 `socratic-engine/node_modules/mermaid/dist/mermaid.min.js` **逐字节相同**（见 `vendor/.../BUILD-INFO.txt`） |
| 浏览器 | Playwright 1.63（项目根 `node_modules/`，**已有，未新增**）的 Chromium |
| node | `/opt/homebrew/bin/node` v25.9.0 |
| ffmpeg | `/opt/homebrew/bin/ffmpeg`（只用于把 Playwright 录的 webm 转 GIF） |

🔴 **换 mermaid 版本＝重新验证，不得外推。** 本报告全部结论只对 11.17.2 成立。

### 3.2 主题配置（**整段可抄**）

文件：`code/tools/mermaid-pretty/claude-mermaid-theme.mjs`
用法：`mermaid.initialize(claudeMermaidConfig())`。

**做法**：`theme: 'base'` + 一整套 `themeVariables`（浅/深两套） + 一段 `themeCSS`。

**核心变量（浅色，节选）**：

```js
background: '#FAF9F5',   // 画布：暖象牙
mainBkg:    '#FFFFFF',   // 节点底
nodeBorder: '#D9D4C8',   // 节点描边：暖灰发丝
lineColor:  '#B9B4A9',   // 连线
textColor:  '#3D3D3A',   // 正文：暖黑，不发蓝
clusterBkg: '#F5F4EF',   // 子图底
radius:     8,           // 圆角
strokeWidth: 1,
useGradient: false,
dropShadow: 'none',      // 🔴 去掉默认投影
```

完整清单（含 sequence / state / class / er / pie / gantt 全套）在文件里；
**深色版 `CLAUDE_DARK` 也在同一文件**（对应 Claude 深色界面：近黑 `#262624` + 暖灰字，不发蓝）。

**🔴 三个实测坑（都踩到了，写下来）**：

1. **必须 `theme: 'base'`**。只有 base 主题会**完整**吃 `themeVariables`；
   用 `default`/`forest`/`neutral`/`dark` 时一部分变量会被该主题自己的 `getThemeVariables()` 覆盖掉。
   → **换主题必须同时把 `theme` 改成 `'base'`**，否则会出现"改了半天没生效"。
2. **`themeCSS` 里的 `&` 嵌套是对的，但注释会被 stylis 抹掉**。
   我一开始用「注释字符串是否存在」判断 themeCSS 有没有生效，**结论是错的**；
   真正的验证方式是**读计算样式**（`getComputedStyle(rect).rx === '8px'`）。
3. **`securityLevel: 'strict'` 下 `themeCSS` 照样生效**（本项目实测：
   `rectRx=8px`、`rectFilter=none`、`labelWeight=400`、`rectStroke=rgb(217,212,200)`）。
   → **不需要为了主题去放宽安全等级**，我们客户端现在用的 `strict` 保持不动。

### 3.3 动画方案（**整段可抄**）

文件：`code/tools/mermaid-pretty/claude-mermaid-anim.mjs`

#### `animateStagger(svg, opts)` —— 候选 B

**算法（不解析源码，从渲染结果量位置推层号）**：

1. 量整张 `<svg>` 的 viewBox 定主轴 —— flowchart 按长宽比判（高 ≥ 宽用 y，否则用 x）；
   其它图型（sequence / state / class / er / gantt…）一律 y。
2. 把单元按主轴坐标**装桶**（容差 18px），桶序号＝层号。
   **层合并**：层数超过 `maxSteps`（默认 26）时，相邻层并成一步。
3. 节点先 `opacity:0`，轮到自己那层再进场。
4. 连线：能算 `getTotalLength()` 且**本身不是虚线**的，用 `stroke-dasharray/offset` 从 `L → 0`
   过渡「画出来」；本身是虚线的（时序图回信、生命线）退回淡入，**不破坏虚线语义**。
5. `prefers-reduced-motion` 下整段关掉。

**🔴 两个必须知道的坑（都实测踩到）**：

**(a) 进场动画只许用独立变换属性 `translate` / `scale`，绝不能用 `transform`。**
mermaid 把节点位置写成 `<g class="node" transform="translate(x,y)">`，
而 **CSS 的 `transform` 属性会整体覆盖这个呈现属性** → 动画期间节点全部跳到画布原点，图散架。
（我第一次录的 GIF 就是这个 bug：节点文字浮在顶上、框不见了。）
`translate`/`scale` 是独立属性，按规范排在 `transform` **之后**复合，能叠在原有的 `translate(x,y)` 上。
实测修复后：动画期间每个节点的 `getBoundingClientRect()` 与终态**完全一致**（§3.5 附验证）。

**(b) 动画总时长必须真的封得住——只压步间隔不够，得先把层合并。**

链式流程图（`N0→N1→…→N159`）层数 ≈ 节点数（211 层）。固定 130 ms/层 = **27 秒**，用户早划走了。
我第一版只加了 `maxTotal` 预算（`layerDelay = min(130, max(24, budget / maxLayer))`），
结果 **80 节点 3.42 s、160 节点 5.96 s** —— 那个 `max(24, …)` 下限把预算捅穿了。

第二版改成**两步一起做**：

```
① 层合并：group = ceil(层数 / maxSteps)          // maxSteps 默认 26
           步号 = floor(层号 / group)
② 压步间隔：layerDelay = min(130, max(24, budget / (步数 - 1)))
           budget = maxTotal - edgeDelay - edgeDur - enterDur   // maxTotal 默认 2600
```

实测结果（§3.5）：20 节点及以上一律 **2600 ms**，160 节点（原始 211 层 → 24 步）也是 **2600 ms**。

**踩过的第三个坑**：`g.label` **不能**放进单元选择器。
mermaid 11 里节点内部和边标签内部都有 `g.label`，收进来会把单元数算成两倍
（实测：20 节点的图数出 44 个单元）。
另外时序图的消息线在 11.17.2 里是 `<line class="messageLine0">`，**不是 `<path>`**。

#### `streamRender(container, source, mermaidApi, opts)` —— 候选 C

按行切片，头部（图类型声明 + frontmatter）永远保留；某一片语法不完整（写到一半的边）
就保留上一张好图继续。返回 `{steps, ms, renders}`。
`opts.slice` 可换成自定义分片函数——**接真流式时就把它换成"返回当前 argsRaw 前缀"**（§4.4）。

### 3.4 对比图与动图

| 文件 | 看什么 |
|---|---|
| `out/compare-A-flow.png` | 同一流程图：左 mermaid 默认（薰衣草紫 + 灰投影 + 直角）vs 右 Claude 风（暖象牙 + 发丝线 + 圆角） |
| `out/compare-A-seq.png` | 同一时序图并排 |
| `out/compare-A-state.png` | 同一状态图并排 |
| `out/anim-B-stagger.gif` | 候选 B 动图：按层淡入 + 连线画出来 |
| `out/compare-B-stagger.png` | 候选 B 终态 |
| `out/anim-C-stream.gif` | 候选 C 动图：按源码一行行长出来（会看到布局跳动） |
| `out/compare-C-stream.png` | 候选 C 终态 |
| `out/evidence-claude-blog/*` | §1.4 的官方外观证据（GIF + PNG + 12 帧） |
| `out/perf.json` | §3.5 的原始性能数据 |

### 3.5 性能数字（headless Chromium 实测，`out/perf.json`）

测法：`record.cjs` 第 4 段。源＝链式 flowchart（`N0→N1→…`），分别测
① 默认主题 `mermaid.render()` ② Claude 主题 `mermaid.render()`
③ 候选 B 装饰后的动画总时长与播放墙钟 ④ 候选 C 纯渲染成本（interval=0）与 120 ms 间隔的墙钟。

| 节点 | 源码行 | 默认渲染 ms | Claude 主题 ms | SVG KB | 层→步 | 步延迟 ms | **B 动画 ms** | **C 重渲染次数** | **C 纯渲染 ms** | C 120ms 间隔墙钟 ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 6 | 20.7 | 19.7 | 17.5 | 5→5 | 130 | **1 440** | 6 | 95 | 815 |
| 10 | 12 | 34.1 | 34.5 | 25.8 | 11→11 | 130 | **2 220** | 12 | 284 | 1 724 |
| 20 | 26 | 67.6 | 65.5 | 44.4 | 25→25 | 70 | **2 600** | 26 | 1 101 | 4 221 |
| 40 | 52 | 120.0 | 127.3 | 79.5 | 51→26 | 67.2 | **2 600** | 52 | 3 621 | 9 861 |
| 80 | 106 | 244.0 | 246.5 | 152.2 | 105→21 | 84 | **2 600** | 106 | 13 220 | 25 940 |
| 160 | 212 | 473.9 | 488.6 | 296.7 | 211→24 | 73 | **2 600** | 212 | 56 302 | 81 742 |

（原始数据：`out/perf.json`）

> 表里「层→步」＝几何分层量出的原始层数 → 合并后的动画步数（见 §3.3 的 (b)）。
> 源是**链式**流程图（`N0→N1→…`），层数≈节点数，是**最坏情况**；
> 真实的课堂板书图（有分叉、有子图）层数远小于节点数，动画会比这短。

**读法（这几条是给决策用的）**：

1. **换主题不花渲染时间**：同一轮里默认 vs Claude 主题的 `render()` 耗时几乎相同
   （20.7 / 19.7 ms；473.9 / 488.6 ms；差 ≤ 3%）。
   → **候选 A 是纯赚，没有性能代价。**
   ⚠️ 跨轮次波动很大：同一配置 160 节点这一轮 474 ms、上一轮 673 ms（±30%，机器负载）。
   **要引用就引用量级，不要引用单次数字。**
2. **渲染耗时随节点数近似线性上升**：约 **3–4 ms/节点**
   （20 节点 68 ms → 160 节点 474 ms）。
   → **图越大越该用缓存**（客户端已有「源码 + 主题」缓存，见 §4.1）。
3. **候选 B 的总时长硬封顶成立**（`maxTotal: 2600 ms` + `maxSteps: 26`）：
   20 节点及以上一律 **2600 ms**（层被合并成 21–26 步）。
   🔴 **只加 `maxTotal` 不够**：只压步间隔时，211 层压到下限 24 ms 仍要 **5.96 s**（我第一版实测到过）。
   **必须同时做「层合并成至多 maxSteps 步」**，否则长图封不住。
4. **候选 C 的成本 ≈ 行数 × 单次渲染**：
   - 20 节点 / 26 行 → 26 次重渲染，**纯渲染 1.10 s**，加 120 ms 间隔 **4.22 s** 墙钟；
   - 160 节点 / 212 行 → 212 次重渲染，**纯渲染 56.3 s**，墙钟 **81.7 s**（完全不可用）。
   **而且每重渲染一次布局重排一次（会跳）。**
   → **候选 C 只适合小图（≤ 15 行）；大图必须退候选 B。**
5. **节点数上限（会不会崩/卡）**：本轮**没有测到崩点**。160 节点、SVG 297 KB、
   渲染 474 ms、动画 2.6 s，全程无报错、无卡死、无掉帧报警。
   ⚠️ **但没测到崩点 ≠ 不会崩**——我只测到 160，再往上没测（见 §5 未做到 #5）。

**候选 B 的位置稳定性（程序化验证，不是目视）**：
修复 `transform` 那个坑之后，在动画进行中的 5 个时间点（150/400/900/1500/2600 ms）
逐节点读 `getBoundingClientRect()`，与终态**逐个比对，坐标完全一致**；
同时 opacity 按层递进（t=150 ms：A=0.89、B=0.14、其余 0）。
→ 「节点原地淡入」这件事是**测出来的**，不是看出来的。

### 3.6 没做的 / 已知不足（PoC 层面）

- **候选 C 不是真流式**（我们的链路没有逐字流），只是按行仿真。§4.4 给了真流式的唯一入口。
- **动画只覆盖了 flowchart / sequence / state 三种**（演示页里那三种）。
  class / er / gantt / pie / journey 的选择器我写进去了但**没逐个目视验证**。
- **160 节点以上没测**。
- **没有做"主题切换时不重播动画"**——现在换深浅色会重新渲染并重播一次。
- **没有在真实教室会话里跑过**（本轮按纪律不许碰 `code/clients/**` 和 profile）→ 全部在独立 PoC 页里验证。

---

## §4 · 接线说明（**不许改别人的树，所以只写怎么改**）

🔴 以下全部是**读代码得出的行号**（`code/clients/classroom-ui/lib/client.js`，2 302 行，本轮只读未改）。

### 4.1 消息流里那张图（T3 的渲染路径）—— 改 4 处

| # | 位置 | 现状 | 怎么改 |
|---|---|---|---|
| 1 | `lib/client.js:130-131` `MERMAID_THEME_LIGHT/DARK` | `"neutral"` / `"dark"`（mermaid 内置主题名字符串） | 换成**主题配置对象**：把 `claude-mermaid-theme.mjs` 整份搬进来（或改成从工作区读），导出 `CLAUDE_LIGHT_CONFIG` / `CLAUDE_DARK_CONFIG`（`claudeMermaidConfig({dark})` 的返回值） |
| 2 | `lib/client.js:1519-1522` `mermaidThemeFor(themeName)` | `return themeName === "dark" ? MERMAID_THEME_DARK : MERMAID_THEME_LIGHT;` | 改成返回**配置对象**（返回值语义从"主题名"变成"initialize 的配置"）。**同时把函数名/注释改掉**，否则下一个人会以为它还是返回字符串 |
| 3 | `lib/client.js:1563-1585` `renderDiagram()` | `mermaid.initialize({startOnLoad:false, securityLevel:"strict", theme: mermaidThemeFor(themeName)})` | 改成 `mermaid.initialize({startOnLoad:false, securityLevel:"strict", ...mermaidThemeFor(themeName)})`。🔴 **`renderChain` 那套串行化必须保留**——`initialize` 是整页共享配置，这条理由不因换主题而消失 |
| 4 | `lib/client.js:1593-1604` `diagramFor()` | 缓存键 = `themeName + "\0" + source` | 🔴 **缓存键要带上"主题版本"**。键里现在只有 `light`/`dark`，改了主题配置后**旧缓存不会失效** → 用户会看到旧配色。做法：加一个 `const THEME_REV = "claude-v1";`，键改成 `THEME_REV + "\0" + themeName + "\0" + source`。**以后每次调主题都 +1** |

**再加一处（动画）**：

| # | 位置 | 怎么改 |
|---|---|---|
| 5 | `lib/client.js:2094-2180` `ClassroomDrawView` | 现在 `state.kind === "ok"` 时用 `dangerouslySetInnerHTML` 把 SVG 塞进 `S.drawCanvas` 那个 `div`（2144-2150 行）。**加一个 `ref` 指向它**，再写一个 `React.useEffect(() => { … }, [state.svg])`：`const svg = ref.current?.querySelector("svg"); if (svg) animateStagger(svg, { kind: parsed.kind });`（`parsed.kind` 已经解析好了，就是源码首行关键字）。🔴 **effect 依赖只能是 `state.svg`**——依赖 `themeName` 会多跑一次；`animateStagger` 自带 `prefers-reduced-motion` 关闭 |
| 6 | `lib/client.js` 顶部常量区 | 加一个开关（复用现有 `uiConfig()` 那套配置面，和 `live2dRoot` / `mermaidPath` 同一个手法）：`uiConfig().drawAnim` ∈ `"none" \| "stagger" \| "stream"`，默认 `"stagger"`。**这样不用改代码就能回退到候选 A** |

**为什么动画放在 `ClassroomDrawView` 而不是 `renderDiagram`**：
`renderDiagram` 返回的是 **SVG 字符串**（没有 DOM），而动画要操作**已经挂载的 DOM**
（`getBBox()` / `getTotalLength()` / `getComputedStyle()` 都要求元素在文档里）。
→ 动画必须发生在 `dangerouslySetInnerHTML` 之后。

### 4.2 教室面板要不要也用它

**要，但只改一处**：面板里如果也画 mermaid 图，走的是同一个 `diagramFor()` / `renderDiagram()`
→ **第 1–4 处改完，面板自动跟着换外观**（因为它共用同一个 `mermaid.initialize`）。
**动画则要单独接**：面板那侧如果没有对应的"图组件"，就在它插入 SVG 之后加同样的 `animateStagger` 调用；
如果面板里没有 mermaid 图（本轮没查），那就**什么都不用做**。

⚠️ 注意：`mermaid.initialize` 是**整页共享**的。消息流和面板同时画图时，
**必须继续走 `renderChain` 串行**（`lib/client.js:143` / `1553-1557` 的说明），
否则 A 的主题会被 B 顶掉，而且**会被缓存**（缓存键含主题，所以切回来会拿到错的那张）。

### 4.3 服务端 `classroom_draw` 要不要配合

**默认：不用配合。** 主题和动画都是**呈现层**的事，按我们「引擎×内容分离」的规矩，
不该进服务端的契约。

**只有两种情况下才需要动服务端**：

| 情况 | 要不要改 | 怎么改 |
|---|---|---|
| 想让某一条图**单独关掉动画**（比如一张必须静止的示意图） | 要 | `classroom_draw` 入参加一个**可选** `animate: boolean`（默认省略＝跟随客户端配置）。客户端在 `parseDrawArgs`（`lib/client.js:1428`）里读出来，传进 `animateStagger`。⚠️ 服务端 schema 是「已校验过 ≤20000 字符、首行关键字与 kind 对得上」那一套，加字段要同步改 schema 与它的测试 |
| 想让老师**指定主题** | **不要** | 主题跟着客户端深浅色走（现在就是这么设计的，`watchDarkTheme` 在 `2104` 行）。让模型指定颜色＝把呈现决策塞进内容，会让同一条图在不同学生那儿长得不一样 |

**服务端一行都不用改也能上候选 A/B。**

### 4.4 候选 C 的唯一真实流式入口

我们的链路是「工具调用 → 落盘 → 渲染」，`source` 一次性给全，**没有逐字流**。
真流式只有一条路：**工具入参流**。

- T3 报告 §1.1 已取证：客户端能从 `block.argsRaw` 拿到这次调用的**完整入参 JSON**，
  `source` 字段就是逐字的 mermaid 正文。
- 那么**在参数还在流式到达的过程中**，`argsRaw` 是**不断变长的**（工具调用块没结束时）。
  把当前 `argsRaw` 里**已经出现**的 `source` 片段取出来，交给
  `streamRender(container, prefix, mermaid, { slice: (lines) => lines.join("\n") })`
  —— 这就是真流式。
- ⚠️ **要写清楚的代价**：
  ① `argsRaw` 是 JSON，**中途是不合法的 JSON**（字符串没闭合），要做一个"尽量取出 `source` 已到达部分"的容错提取；
  ② 每来一段就要 `mermaid.render()` 一次，**渲染次数 = 到达次数**（可能几十次），
     按 §3.5 的成本，20 节点图每次 ~50 ms，**会明显拖慢**；
  ③ 布局每次重排都会跳；
  ④ 服务端已经在 `classroom_draw` 里做了 `mermaid.parse()` 前置校验，
     流式阶段**必然**会遇到"这张图现在还不合法"——必须像 PoC 那样"抛错就保留上一张好图"。
- **建议**：**先不做**。等候选 B 上线后看用户反馈；真要做，也要给 `argsRaw` 的到达频率加节流
  （比如最多 8 次/图）。

---

## §5 · 未做到 / 未取证（如实列）

| # | 没做到的事 | 为什么 |
|---|---|---|
| 1 | **没拿到 Claude 的 mermaid 主题/动画实现证据** | 官方材料里没有；第三方逆向针对的是 `Imagine with Claude` 那个 HTML 路线，与 mermaid 无关。→ PoC 的色值是**我的设计推断**，已在文件头与 §1.3 标注 |
| 2 | **没拿到「节点逐个长出来」的可看动图** | 官方博客那两段录屏演的是**交互**（点击 → 详情更新），不是建造过程。只有官方文字 "streams in"。→ 特征清单里这条只能标"文字证据" |
| 3 | **没有一手截图证明「Claude 的 mermaid artifact 长什么样」** | 需要登录 claude.ai。本轮无凭据，也没去找绕过方式 |
| 4 | **候选 C 不是真流式** | 我们的链路里 `source` 一次性给全（§4.4）。PoC 是按行仿真 |
| 5 | **160 节点以上没测**，所以**没有"节点数上限"这个数字** | 只测到 160（渲染 829 ms / SVG 297 KB / 动画 2.6 s，未崩）。再往上没跑 |
| 6 | **class / er / gantt / pie / journey 的动画没逐个目视验证** | 选择器写进去了，但演示页只放了 flow / seq / state 三种 |
| 7 | **没在真实教室会话里验证** | 按纪律不许碰 `code/clients/**`、`code/classrooms/**`、任何 profile。全部在独立 PoC 页里验证 |
| 8 | **没验证深色主题的实际观感** | `CLAUDE_DARK` 写好了但没出对比图（本轮只出了浅色的） |
| 9 | **`lukilabs/beautiful-mermaid` 的源码没读** | 只读了 README（它的做法从 README 已足够清楚：自绘渲染器 + ELK 布局 + 双色派生）。它要不要引新包＝候选 D 的决策，本轮不决策 |
| 10 | **没做法律/许可研究** | 项目纪律明令禁止。§1.6 表里只记了"该页有没有写使用条件" |

---

## §6 · 待确认清单（**转呈用户**）

| # | 问题 | 选项 | 我的倾向 |
|---|---|---|---|
| 1 | 🔴 **要哪个候选（或组合）？** | A（只换主题，静态）／B（主题＋逐层长出）／C（按源码边长，仅小图）／A+B 组合／A+B+C 按图大小自动选 | **A+B**：A 零代价必上；B 是"看起来像 Claude"的关键那一层，且已封顶不会演不完。C 只对小图有意义，且是仿真不是真流式，建议**先不做** |
| 2 | 要不要**顺便上深色版**（`CLAUDE_DARK`）？ | 要／不要 | 要。客户端已经有 `watchDarkTheme` 在切主题，两套色值都写好了，接上就行 |
| 3 | 动画开关放哪？ | 客户端 `uiConfig().drawAnim`（可回退）／服务端 `classroom_draw` 加 `animate` 入参 | **客户端配置**。服务端加字段要同步改 schema + 测试，而"要不要动画"是呈现决策 |
| 4 | 要不要**把 `beautiful-mermaid` 那条路（候选 D 的轻量版）纳入评估**？ | 纳入／不纳入 | 不纳入。它要新增依赖（违背本轮纪律），且要换掉 mermaid 渲染器——收益是"更好看"，成本是重做链路。**但它 11.1k star，值得你知道它存在** |
| 5 | 🔴 **"要不要真的复刻 Claude 那条 HTML 路线"**（候选 D） | 要（另开任务）／不要 | **先不要**。等 A+B 落地、你看过实际效果再定。它改的是产物契约，不是皮肤 |
| 6 | 动画的**节奏**要不要调？ | 层间 130 ms / 总长 2600 ms 封顶 / 至多 26 步（当前）／更快／更慢 | 当前值。实测小图 1.4–2.2 s、20 节点以上一律 2.6 s。**你如果觉得慢，最该调的是 `maxTotal`（建议 1800–2200 ms）**；觉得"层被并得太粗"就调大 `maxSteps` |
| 7 | 「节点数上限」这个数字要不要补测？ | 补测（跑到 400/800 节点找崩点）／不补 | 看你要不要给老师设一个"别画太大"的上限。**目前没有数字**，只有"160 节点没事" |

---

## §7 · 复现命令

```bash
cd /Users/wujunjie/Documents/ChatGPT/大学申请

# 跑完整 PoC（出对比图 + 动图 + perf.json）
/opt/homebrew/bin/node 开源线/DSH定制/code/tools/mermaid-pretty/record.cjs

# 手开演示页（demo.html 用 ES module，file:// 会被 CORS 挡，要起个本地服务）
python3 -m http.server 8899
# → http://127.0.0.1:8899/开源线/DSH定制/code/tools/mermaid-pretty/demo.html
```

**注意**：本机 Clash TUN 会接管出站 TCP，本轮**没有做任何"连不通"类测试**，
所有验证都是本地文件 + 本地 Chromium，不受影响。

---

## §8 · 本轮改了什么文件（sha256）

**只写了产出目录 + 本报告。**（sha256 取前 16 位）

| 文件 | 字节 | sha256(前16) |
|---|---:|---|
| `code/tools/mermaid-pretty/README.md` | 8 606 | `d20879aff83dc1c6` |
| `code/tools/mermaid-pretty/claude-mermaid-theme.mjs` | 9 029 | `d4aa3f7dc90e54df` |
| `code/tools/mermaid-pretty/claude-mermaid-anim.mjs` | 15 342 | `dafbb2a2bda49a56` |
| `code/tools/mermaid-pretty/demo.html` | 9 198 | `3daa63d0522dc679` |
| `code/tools/mermaid-pretty/record.cjs` | 10 447 | `5b7cbc3946b59123` |
| `code/tools/mermaid-pretty/out/compare-A-flow.png` | 89 267 | `cc10c22a6a672c7c` |
| `code/tools/mermaid-pretty/out/compare-A-seq.png` | 88 255 | `802560a78200482f` |
| `code/tools/mermaid-pretty/out/compare-A-state.png` | 86 450 | `e6b352fe8ea314ec` |
| `code/tools/mermaid-pretty/out/compare-B-stagger.png` | 96 919 | `c95a54f684317131` |
| `code/tools/mermaid-pretty/out/compare-C-stream.png` | 70 956 | `deaf4ccfdf28372b` |
| `code/tools/mermaid-pretty/out/anim-B-stagger.gif` | 1 175 220 | `690dc5e260e987e0` |
| `code/tools/mermaid-pretty/out/anim-C-stream.gif` | 1 583 532 | `e1d1469d318972d3` |
| `code/tools/mermaid-pretty/out/perf.json` | 3 014 | `8c1b4070f53be2dc` |
| `code/tools/mermaid-pretty/out/evidence-claude-blog/*` | GIF 4 104 414 ＋ PNG 803 920 ＋ 12 帧 | （官方博客下载件，见 §1.4） |

**没碰的树**（逐条核对过）：
`code/plugins/**`、`code/classrooms/**`、`code/skills/**`、`code/acceptance/**`、
`code/tools/animation-gate|animation-orch|anim-prep/**`、`code/tools/portrait2live/**`、
`~/SocraticNovel-wt/`、`~/SocraticNovel-GitHub仓库/`、任何 profile。
**无 git commit / push。无新增依赖。**

⚠️ **一处必须说清楚的观察**：`code/clients/**` 里有**别的**文件在最近两小时内被改过
（`classroom-ui/evidence/skin1/board/*.png`、`tools/iso-channel.cjs`、`evidence/t3_*.png` 等）——
那是**另一路在改皮肤**（任务书里已说明），**不是我**。我对这棵树**只读**：
只读了 `lib/client.js` 拿行号，没写过任何文件。
