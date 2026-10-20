# SocraticNovel · MVP 设计（2026-09-19）

> **触发**：用户 2026-09-19 —— *"没关系你不用担心时间的问题，MVP 一周能够搞得定吗？skill 系统估计可能一天就够了感觉，重点是基于 ds harness 深度适配的一堆插件"*
> **结论先行**：**一周可以搞定——但前提是「不碰 agent loop」。** 详见 §1。
> 标记法：【实测】本机现场查到 ｜【推断】我的推理。本机路径 = `/Applications/DSH Desktop.app/Contents/Resources/app/`。

---

## §0 先回答"一周能不能搞定"：**分组件看，能，但有一块必须绕开**

| 组件 | 一周内能否 | 依据 |
|---|---|---|
| **skill 系统** | ✅ **一天够了——你判断对了** | skill 形态 = markdown + manifest；且【实测】DSH 有 `dsh-client-ui-skill`（**skill 原生支持**） |
| **UI 插件（往插槽塞界面）** | ✅ **门槛低** | 【实测】`dsh-client-ui-brand-official` = **1 个 peer / 0 个 deps**（官方最小插件示例，就是"往 sidebar 插槽塞东西"）；`dsh-client-ui-slots` 是"纯核心（pure core）" |
| **系统指令（教学法）** | ✅ 中低 | 【实测】`dsh-agent-instructions` |
| **工具（render_canvas 等）** | ⚠️ 中 | 【实测】`dsh-agent-tool-presentation` + `dsh-tools` |
| 🔴 **改 agent loop**（课后自动更新、分阶段流程） | ❌ **一周内风险很高** | 【实测】`dsh-agent-loop` 有 **11 个 peer 依赖**（cordis / dsh-agent / dsh-llm / dsh-session / dsh-session-persistence / dsh-session-projection / dsh-scope / dsh-system-prompt / dsh-tools / dsh-settings / dsh-invariants）；是 **event-sourced 架构**（有 inbox projection、durable splice、SessionLogOffset 等概念）；且**本机 npm 包里 0 个 `.d.ts`**（类型没打包） |
| **教材导入** | ⚠️ 中 | 复用 `markitdown` / `MinerU`，但要集成 |
| **web 版** | ❌ 一周内不现实 | 除非只做"演示版" |

---

## §1 🔴 关键结论：**MVP 不需要改 agent loop**

**"课后自动更新状态"能不能不改 loop 就做到？——能。**

| 做法 | 可靠性 | 成本 |
|---|---|---|
| **教学法指令里要求**：课程结束时调用写文件工具（DSH 已有 bash / write 工具）更新状态文件 | ⚠️ 中（靠 prompt 约束，模型可能忘） | **低** |
| 配套保障：① 指令里明确列"课后必须更新哪几个文件" ② 下次开场**检查文件是否存在** ③ 一个 `validate` 命令 | ✅ 能把可靠性补上 | 低 |
| **改 agent loop 做成确定性流程**（事件驱动、课后自动触发） | ✅ 高 | 🔴 **高**（11 个 peer 依赖 + event-sourced 架构） |

→ 🔴 **所以顺序是**：
> **MVP（prompt + 现有文件工具）→ 可靠化（改 agent loop）→ web 版**
> **改 agent loop 是"让它更可靠"的第二步，不是 MVP 的前提。**

**这直接决定了"一周能不能搞定"：绕开 agent loop，能；不绕开，不能。**

---

## §2 MVP 的定义

🔴 **MVP 不是"最小可用的产品"，是"最小可传播的东西"**——因为 30 天的目标是 ★ 和用户，不是功能完整。

**一句话**：
> **在 DSH 里，把一门课的教材交给它，它能按你能懂的方式上完第一节课，并且课后真的记住了你卡在哪。**

**闭环**：
```
教材进去 → 按你的水平讲第一节课 → 课后留下你的卡点 → 第二节课开场引用它
```

**这个闭环完全对应 PR/FAQ 发布稿里的每一句话**（发布稿描述什么，MVP 就得能交付什么）：

| 发布稿里的话 | MVP 必须能做的 |
|---|---|
| "你把那门课的教材交给它" | **教材导入**（复用现成开源工具） |
| "按你能懂的方式重新讲一遍" | **苏格拉底引擎 + 场景机制**（AnimaTutor 骨架移植） |
| "它记得你上周卡在哪" | **最小状态文件**（`06/07` 精简版，靠指令更新） |
| "完全免费、开源" | 开源 |
| "留在你自己电脑上" | 本地存储 |

---

## §3 MVP 组件清单

> 🔴 **2026-09-19 修正**：原 D1 写"移植 AnimaTutor 骨架"——**优先级错了，已改**。理由见 §3.0。

### §3.0 🔴 修正：MVP **不需要**移植 AnimaTutor 骨架

**因为 SocraticNovel 已经有一个能跑的完整教室了。** 【实测】`AP_Physics_EM/` 现状：

| 文件 | 规模 | 里面有什么 |
|---|---|---|
| `copilot-instructions.md` | 113 行 | 🔴 **已经是"三级加载"机制**：① 启动必读 5 个文件 ② 课前按需加载 6 项 ③ 延迟加载 12 项；**且已解决"课后更新容错"**（会话中断后按 `progress.md` 最后一条记录恢复） |
| `teacher/config/system_core.md` | 368 行 | 教学法 + 叙事规则 + 角色声音 + 流程（**单体式**） |
| `teacher/config/system_reference.md` | 145 行 | 情绪工具箱、教学法示范（校准用） |
| `teacher/config/curriculum.md` | 102 行 | 课程结构 |
| `teacher/story_progression/` | **32 章** + appendix + exam_epilogue + unit_tests | 🔴 **"必然/机会/犯错节点"**（= 我们讨论的 A3/A6 机制） |
| `teacher/characters/` | 3 个（rin / ritsu / saku） | 🔴 **`rin.md` 内含"隐喻空间规范"**（= A2 隐喻映射，已经有了） |
| `teacher/runtime/` | **9 个文件** | progress / session_log / mistake_log / review_queue / diary / wechat_group / wechat_unread / session_archive / temp_math |
| `MAINTAINER.md` | 384 行 | 维护手册 |

🔴 **而且它已经有"轮值"机制**：当课老师"由 `progress.md` 排班决定"（= 我们讨论的 D7 教法分工）。

**所以 MVP 的正确 D1 是**：
> **把 `AP_Physics_EM` 这个现成教室适配到 DSH 并跑通一节课**（入口从 `copilot-instructions.md` 改成 DSH 认的 `CLAUDE.md` / agent instructions），**不是**移植 AnimaTutor。

**那 AnimaTutor 什么时候移植？——第二步（要做社区 / 新教室时）。**
因为 AnimaTutor 的价值不是"让系统能跑"，而是：

| AnimaTutor 有、SocraticNovel 没有的 | 用途 |
|---|---|
| **`03_学科场景机制.md`：六要素 × 五学科的隐喻规范** | **可复制性**——SocraticNovel 只有 `rin.md` 里的一套（AP 物理），AnimaTutor 把它变成了"模板" |
| **理论文档**：连接理由 / Multi-Prompt Design / Pair Prompt / 非线性情感里程碑 | **社区与宣传**——"为什么这样设计"的说明书 |
| **Pair Prompt（镜像叙事对）** | 独有的叙事创新 |
| **非线性情感里程碑的定位** | 对**碎片模式**有用（D4 的入场简报） |

→ 🔴 **一句话：SocraticNovel 有"一个教室"，AnimaTutor 有"造教室的规范"。MVP 要教室，第二步才要规范。**

### 要做（一周内）
| # | 组件 | 内容 | 依据/复用 |
|---|---|---|---|
| 1 | 🔴 **把 AP_Physics_EM 适配到 DSH** | 入口改 `CLAUDE.md` / agent instructions；三级加载机制保留 | **现成教室**，不重做 |
| 2 | **教材导入** | PDF / EPUB → markdown | 复用 `markitdown`（186,050★ MIT）/ `MinerU`（80,366★）/ `docling`（67,477★ MIT） |
| 3 | **skill 包** | 把上面两件打成 skill（**1 天**） | `dsh-client-ui-skill` 原生支持 |
| 4 | **一个 UI 插件**（可选但建议） | 往插槽塞一个"教室面板" | `dsh-client-ui-slots`（1 peer / 0 deps 的官方示例可抄） |
| 5 | **`validate` 命令** | 校验教室文件齐不齐 | 复用 D1-③（**本来就要做**，且它同时是"质量保证"的实现） |
| 6 | 🔴 **录屏** | **一段 30 秒真实课堂**（录 AP 物理，因为那是真的） | 从闭环里录出来，**零额外成本** |

### 不做（推到后面）
❌ Live2D ｜❌ 多模态（除 SVG）｜❌ 账号系统 ｜❌ 论坛 ｜❌ 桌面版 ｜❌ 教室市场 ｜❌ 社区功能 ｜❌ **改 agent loop** ｜❌ **移植 AnimaTutor**（第二步）

---

## §4 一周排期（假设无时间压力）

| 天 | 做什么 | 产出 |
|---|---|---|
| **D1** | 🔴 **把 `AP_Physics_EM` 适配到 DSH**（入口改 `CLAUDE.md` / agent instructions） | 现成教室能在 DSH 里加载 |
| **D2** | 教材导入（选一个开源工具集成） | 能导入 PDF |
| **D3** | 打成 skill 包 + `validate` | **skill 版可用** |
| **D4** | 真上一节课，调 prompt（**这是最不确定的一天**） | 闭环跑通 |
| **D5** | UI 插件（教室面板） | 界面可见 |
| **D6** | **录屏 + 截图 + README 改造**（英文上首屏、0 图→有图） | **可传播素材** |
| **D7** | 开源发布 + 借生态（提进 curated list） | 发布 |

⚠️ **最不确定的是 D4**——prompt 调试可能吃掉两天。**建议留缓冲**。

---

## §5 DSH 平台事实（【实测】本机核查）

### 5.1 架构 = 插件体系
- `dsh-desktop` v0.9.1（MIT，作者 DataElement，**239 个依赖**）
- 核心是 **Cordis 插件框架**：`@deepseek-ai/cordis` ＋ `cordis-plugin-loader` / `hmr` / `include` / `group` / `timer`
- **服务端每层都是独立包**：`dsh-agent-loop`（agent 循环）／`dsh-agent-instructions`（指令）／`dsh-agent-tool-presentation`（工具呈现）／`dsh-bash-local`／`dsh-bash-sandbox`／`dsh-code-runtime`／`dsh-attachment`／`dsh-authorization`
- **客户端 UI 也是一堆独立包**：`dsh-client-ui-chat` / `conversation` / `sidebar` / `layout` / `theme` / `tool` / **`slots`** / `primitives` / `renderer` / `deliverables` / **`skill`** / `subagent` / `plan` / `goal`
- **插件管理已存在**：`dsh-client-ui-settings-plugins` ＋ `dsh-client-ui-settings-plugin-inventory`
- **API 层已存在**：`dsh-api-gateway` / `dsh-api-session-controller` / `dsh-api-workspace-controller`
- **HMR 已存在**：`cordis-plugin-hmr` / `dsh-client-hmr`

### 5.2 🔴 官方 harness 源码是公开的（解决了"文档不在 npm 包里"的问题）
- 【实测】`deepseek-ai/deepseek-harness` —— **232,063★**，官方描述逐字：**"DeepSeek Harness: Everything is a Plugin."**
- ⚠️ 本机 npm 包里 **README 不在**（只有 `README.i18n.yaml`，记录的是 git blob hash，指向源码仓库的 `packages/core/agent-loop/README.md`），**且 0 个 `.d.ts`**（虽然 package.json 声明了 `types` 路径）
- ✅ **但本机 `lib/index.js` 有完整 JSDoc 注释**（含 `@module` 标注）→ **可以读代码，不用盲写**
- → 🔴 **结论：做插件前先去读公开源码仓库的文档，不要对着 npm 包盲写。**

### 5.3 🔴 修正我上一条判断：DSH 插件**不是小众路线**，它接入一个 23 万★ 的生态
| 仓库 | ★ | 是什么 |
|---|---|---|
| `deepseek-ai/deepseek-harness` | **232,063★** | 官方 harness 本体 |
| `nexu-io/open-design` | **97,410★** | **"Best DeepSeek Harness Design Plugin"** → **一个 DSH 插件能到 9.7 万★** |
| `anywhere-labs/dsh-desktop` | **28,246★** | "为 DSH 插件生态打造的现代化桌面端…**万物皆「插件」，桌面本身也是「插件」**" |
| `dataelement/dsh-desktop` | **8,217★** | 本机装的那个 |

→ 🔴 **我上一条说"DSH 插件对不装 DSH 的人没用、受众会收缩"——这条判断要修正**：**DSH 生态本身有 23 万★ 级别的体量，接进去就是借流量。**
⚠️ **但注意**：`open-design` 是**通用工具**（设计），受众天然大；我们是"AI 家教"，**能不能吃到生态流量，取决于我们的插件在生态里是否被需要**。→ **它是分发渠道，不是自动流量**（和"提进 curated list"是同一类杠杆）。

---

## §6 风险

| # | 风险 | 应对 |
|---|---|---|
| 1 | 🔴 **版本还在 rc**：`dsh-desktop 0.9.1` / `@deepseek-ai/dsh 0.1.5-rc.2` | **MVP 尽量不碰 agent loop**（§1），把强耦合面压到最小 |
| 2 | **D4 调 prompt 可能超期** | 留一天缓冲；或者把"第一节课"的范围缩到一节 |
| 3 | **DSH 生态流量不是自动的** | 别把 ★ 目标全押在插件上；**web/录屏/README 那条线才是路人的入口** |
| 4 | **"一周"是理想值** | 你说不用管时间——**但 D4 的不确定性是真实的**，建议按"5 天做完 + 2 天缓冲"排 |

---

## §7 待确认 → ✅ 已确认（用户 2026-09-22）

1. 🔴 **MVP 的定义：接受**——即 **"在 DSH 里能上一节课 + 课后真的留下卡点 + 可录屏"**，且**明确不碰 agent loop**。
2. 🔴 **起点改了（本文件此后按此执行）**：**MVP 的第一节课用「计算机系教室」跑通** —— 不是本文 §3.0／§4 写的"先把 `AP_Physics_EM` 适配到 DSH"。
   → **本文 §3.0 的 D1 修正（"现成教室 vs 移植骨架"）仍然成立**，但**对象从 AP 物理换成计算机系**：计算机系教室**不存在**，要按 `META_PROMPT.md` 生成器 ＋ `AnimaTutor/03_学科场景机制.md` 六要素模板产出 → **M1 的性质从"适配"变成"造教室"**，教材导入（§3 组件 2）**前置**为第一步。
   → **连锁影响与压风险办法见 `SocraticNovel_待办总表.md` §0**；本文 §2 表格里那句"苏格拉底引擎 + 场景机制（**AnimaTutor 骨架移植**）"与 §3.0 冲突，**以 §3.0 为准**（待回改）。

---
