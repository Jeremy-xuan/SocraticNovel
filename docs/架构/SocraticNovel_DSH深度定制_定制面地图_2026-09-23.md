# SocraticNovel · DSH 深度定制 · 定制面地图（2026-09-23 立）

> **本件状态**：✅ **已收口（2026-09-23）**——五路侦察（L1–L5）＋M1 manifest 草案全部回填，形态裁决已出（**用户拍板：插件组**），P1 骨架已端到端跑通。本件是**总览层**，细节以各侦察件／审计件为准。
> **侦察布局**：4 路子代理并行，读码基准 = **最新 worktree** `~/折腾AI/dsh-src-wt`（2026-09-22 master，v0.1.7-alpha.2）：
> L1 拼装权（sensenova/deepseek-v4.1-flash）｜L2 loop与维护成本（work-buddy）｜L3 工具与记忆（sense-nova-day）｜L4 客户端UI（dididi/gpt-6-luna）。
> 侦察输出落 `开源线/DSH定制/侦察_L*.md`；本件是**汇总层**，细节以侦察件为准。

## §0 已定事实（主代理亲自核过）

| # | 事实 | 出处 |
|---|---|---|
| 1 | **形态：插件组**（🔴 用户 2026-09-23 拍板：*"我说了以后做插件组"*）。**演变留痕**：当日早些时候用户原话是"直接 fork 自己的版本算了……是不是 fork 维护起来反而更简单呢？"（**该初步判断已被上述拍板取代**）；五路侦察的 git 与扩展点证据全部指向插件组 | 用户 2026-09-23 原话＋拍板 |
| 2 | **源码全公开、MIT**：monorepo `deepseek-ai/deepseek-harness`（233,790★，TypeScript，活跃维护）；桌面壳 `dataelement/dsh-desktop`（8,531★，MIT） | `gh api` 实测 |
| 3 | 🔴 **上游速度极快**：本地克隆 master 停在 2026-09-04，`master..origin/master = 19514` 个提交（18 天）；最新 origin/master = 2026-09-22（v0.1.7-alpha.2，PR #4978） | git 实测 2026-09-23 |
| 4 | 本地已有完整克隆 `~/折腾AI/dsh-src`（3.6G，有少量本地未提交改动）+ 新建 worktree `~/折腾AI/dsh-src-wt`（最新，136M） | 主代理实测 |
| 5 | 架构 = Cordis 插件体系，"Everything is a Plugin"；核心层（agent/agent-loop/system-prompt/tools/session）与客户端层（约 40 个 ui-* 包）都是独立包 | 上层设计已核 + worktree `ls packages/core` |
| 6 | 官方插件生态已起步：dataelement 自家发过插件（`dsh-ming-life`、`dsh-site-selection`），另有插件市场 `awesome-dsh-workbench` | `gh api` 实测 |
| 7 | 🔴 **双 worktree 制度（用户 2026-09-23 指令）**：① DSH 源码线在 `~/折腾AI/dsh-src-wt`（最新 09-22 master，读码基准）；② **改 SocraticNovel 仓库一律在新 worktree `~/SocraticNovel-wt`（分支 `dsh-deep-custom`，基线 e4972cf）**——主工作树 `~/SocraticNovel-GitHub仓库` 里压着 **22 个未提交的实验性提示词改动**（教室文件＋AGENTS/META_PROMPT 等），**很可能要回滚**，不得在其上叠加定制线改动 | 用户原话 + `git status` 实测 |

## §1 需求 → 层映射（本地图的骨架）

| 层 | 要什么 | 对应已有研究 | 侦察件 |
|---|---|---|---|
| **L1 拼装权** | system prompt 分段控制；**depth 注入**；**历史之后指令**（每轮贴尾纪律清单）；注入频率；compaction 边界 | R1 酒馆研究（`populationInjectionPrompts` 源码级已核）＋R2 长上下文＋R14＋五层架构（`角色扮演架构` §3.0：**宿主不给拼装权是 skill 形态的根本瓶颈**） | 侦察_L1_拼装权.md |
| **L2 loop 与状态机** | AgentPhase 教学相位（讲新课/提问/作答/对答案/收尾）每轮注入；课后自动更新 `runtime/`；与上游同步的成本 | 抢救五结论（AgentPhase 状态机）；M4 验收 | 侦察_L2_loop与维护成本.md |
| **L3 教学工具与记忆** | 对答案（知识点逐字回查）；课程状态笔记本读写；render_canvas/SVG；现有记忆系统覆盖度 | C1–C5 自研清单；R13（教学骨架必自研） | 侦察_L3_工具与记忆.md |
| **L4 客户端 UI** | mermaid 渲染；Live2D 驱动；白板；微信聊天式教室面板（R11 模板可复用）；角色卡/课程状态展示 | 完全体能力清单 G 域（mermaid 90k★／excalidraw 133k★ 先例） | 侦察_L4_客户端UI.md |
| **L5 形态与分发** | fork 基线选哪版（rc 还是 alpha）；自建发行版路径（web/desktop）；与"web 形态给路人"的分工 | 上层设计 E 组（受众收缩警告）；H 域 | 随 L2/L4 附带 |

## §2 核心裁决问题（地图要回答的，不是流水账）

1. **"贴尾部注入"能不能做成宿主确定性机制**（L1）——这是 fork 相对 skill 的第一杀手锏；若答案是否定的，fork 的价值主张要重估。
2. **教学状态机插在哪**（L2）——loop 源码级改动 vs 事件/插件钩子。
3. **fork 维护成本的真实数字**（L2）——上游 18 天 1.95 万提交的重度 fork，跟不跟上游？跟的成本多大？**"fork 比插件组更简单"这个用户判断，要用 git 数据裁决，不许附和也不许轻否。**
4. **UI 大改的每件东西挂哪**（L4）——mermaid/Live2D/白板/教室面板逐件给落点。
5. **现有记忆/工具够多少**（L3）——别重造已有的轮子（完全体清单 §0 的教训）。

## §3 结论区（✅ 已全部回填）

- **L1 结论（✅ 已回填，主代理已抽查三条硬结论）**：
  1. **拼装权三场景（固定 depth／每轮贴尾／每 N 轮）全部原生插件可得，零 fork**——落点 `agent/pre-step`（waterfall，可 `toSpliced` 改写进入本步的消息数组；`agent.inbox.prepend/replace/remove` 跨 step 保持，`agent-instructions` 的 `syncInbox` 是现成范式）。
  2. **system prompt 是 scoped 注册表**（`system-prompt/src/index.ts`）：`sectionByName` → `sectionDefinitions`（25 档 order，-1000→10200）→ `assemble` waterfall；`section()` 只校验 order 有限（L455/490 主代理已核）→ **第三方插件可注册任意段落**。
  3. **AGENTS.md 与 skill 不进 system prompt**——都以 user 消息经 `agent/pre-step` 注入（agent-instructions 按 batch 位置 splice；tool-skill 贴尾 append）——**宿主自己的注入习惯正好就是我们要的形态**。
  4. 🔴 **两个限制**：① 无任意 role 注入（developer role 被拒，实质只有 user——酒馆式注入要包装成 user+`<system-reminder>`，宿主自己也这么干；真 developer role 才需要 fork）；② `llm/stream` 层请求已 deep-freeze（"listeners read it, never rewrite it"）→ **注入只能在 pre-step/surface 层**。
  5. **compaction 风险**：固定 depth 注入超出 retain 预算（默认 retainRatio 0.16）会被抹掉 → **必须每轮重注 + 自做去重**（框架不提供）。
  细节：`开源线/DSH定制/侦察_L1_拼装权.md`（534 行，含 §4bis 复核与 8 条待确认）。
- **L2 结论（✅ 已回填，主代理已抽查四条硬结论）**：
  1. **教学状态机零改 loop**：官方扩展点（`runtime-types.ts:305` 注释块）——`agent/pre-step`（注入相位纪律）／`agent/turn-stopping`（课后收尾、可 await、可 steer 额外 step）／`agent/request`（换模型）；**3 个成品先例**可抄（model-selection.ts:110、time-context、agent-instructions）。官方 cookbook 自述 "No row modifies the loop"，八项教学需求**七项有官方行**。
  2. 🔴 **fork 跟不动上游（git 数据裁决）**：194–250 提交/天、1.6 天/tag、**远端只有 master 无稳定分支**；一周漂移 agent-loop +600/-400（核心文件仅 647 行）；全仓 30 天 +161 万/-24 万行。**"整棵 fork 维护更简单"不成立**——fork 一个月就是换血级合并地狱。
  3. **中间形态**：patch 不能改包 name（`vendor/include/src/index.ts:57`），但 profile 的 `node_modules/@deepseek-ai/*` 全是 symlink → "只 fork 单包+symlink 替换"可行（未实测）。
  4. 附带：master 已删 settings.yaml（改 Cordis profile + cordis.patch.yml）；本地 70 个未提交改动是旧基线上的重复 WIP（上游已改名同功能文件），**不能当 fork 基线**。
  细节：`开源线/DSH定制/侦察_L2_loop与维护成本.md`（749 行）；git 数据：`git数据_主代理实测.md`。
- **L5 结论（✅ 已回填，主代理已抽查三条新发现）**：
  1. **extension-cookbook 对照表 27 行逐行走完**：初筛 A/B/C/D 组件**全部有对应行**——按官方 "No row modifies the loop"，**fork 红线实际为空**。
  2. 🔴 **装载机制（无人区已查清）**：三层 Plugin/Bundle/Profile；叠加序 = bundles→profile 的 cordis.patch.yml→home patch→overlay；**装 6 包的可操作路径**＝每包做 bundle，`dsh plugin --profile web add ./pkg`（主代理已核 args.ts:186，＝向 profile 目录的 pnpm 转发）；dev 期 `--patch overlay` 零发布挂源码；装完 `dsh --dump-config` 校验插件树（已核 apps/cli/src/dump-config.ts）。红线：patch 不能换内置 loop 包 name/id；桌面壳独占 desktop profile（web profile 绕开）。
  3. **E2 发行定案**：`apps/web` 纯 Vite＋`dsh web` 即可脱离桌面壳 → **自建发行 = web profile ＋ 自有 bundle，无需 fork desktop**。
  4. **60 包长尾普查**：现成可复用 ≈30（preset/context/hooks/skill/subagent/workflow/storage/workspace 等"我们想自建的几乎都有"）；无关 ≈15；待确认 3 均属装载机制（已清）。
  5. **机制侧新发现**：`ctx.sessionProjections`＝相位状态的官方持久化/回放/崩溃恢复机制（主代理已核：**在核心** `agent-loop/src/agent.ts`，experimental/agent-team 是用法示例）→ **B1 相位状态直接用它，不手写 runtime 解析**；双半插件 `extensions/cordis-client-runner`（host 半接 conversation.chat.node＋browser 半页面纯 JS）＝C 类 UI 的官方落地形态；`preset`（agent-preset-registry）＝"教室=一个 agent preset"现成声明机制。
  细节：`侦察_L5_机制全普查.md`（330 行，含 7 条待确认）。
- **L3 结论（✅ 已回填——三派接力完成；主代理抽查＋代写收口）**：
  1. **工具注册面开放**：工具按能力分散在各 `tool-*` 包（非 core 静态总表），`defineTool({description})` 各自定义、core 把 schema 投影进 system prompt；第三方可注册（agent-team 先例）。**工具全量以官方 `docs/tool-catalog.md` 为准**（Q2 清单有遗漏，已补注）。
  2. **记忆裁定（🔴 2026-09-23 终局对照后修正为双层）**：monorepo 无 memory/memento 机制；现成可复用 `storage-domain`。**裁定：教室 `runtime/` 文件＝真源**（可见/可编辑/可分享，服务 F3"它记得你"与"文件式记忆"定案）**＋P1 同步索引到 storage-domain 作运行时恢复层**——不让宿主存储变唯一真源。🔴 宿主里跑着的 **dsh-memento 是独立分发的 profile 插件**（主代理实测 `profiles/web/node_modules/dsh-memento` v0.5.0；monorepo 与桌面 bundle 均无它）＝**外部插件走 profile 装载的活实证**，P1 同复杂度先例。
  3. **skill＋插件双模式共存是宿主原生机制**（skill registry／filesystem／tool-skill 三件套独立）→ 同一教室包：装引擎走确定性注入，没装靠 skill 模型自律——**降级路径＝MVP 本身**。
  4. **图类工具零现成**（无 mermaid/SVG 教学图生成）；"工具描述动词优先"是写法层经验、非框架机制。
  细节：`侦察_L3_工具与记忆.md`（Q1–Q5＋收尾补注＋3 条待确认）。
- **L4 结论（✅ 已回填——"报失败但文件完整"，111 行全六章填实＋源码行号；主代理已通读验货）**：
  1. **客户端高度插件化，UI 三件全部客户端插件可得，零 fork**：① Mermaid——现无集成，但 Markdown 是自有 mdast parser/renderer（非 react-markdown），在 `ui-primitives` parser+renderer 加 `mermaid` fence 识别（1 包 1 依赖，约 2–4 工程日）；② Live2D——常驻立绘走 `ui-sidebar-right` tab registry 先例（2–4 日），消息联动 1–2 周（Cubism 授权待核）；③ 白板——新建 `ui-whiteboard` 插件嵌 Excalidraw 组件（仓库已有隔离 iframe 与 PDF canvas 先例，本地版 3–5 日，持久化版 1–2 周）。
  2. **教室面板**：keyed `main` panel（完整教室）或 rightbar tab＋`conversation.chat.node`（伴随视图），纯展示 3–7 日；**跨会话课程状态不能只放 UI state，要走 Conversation event/projection**。
  3. **Slot 体系**：`SlotMap` TypeScript declaration merging 可扩充；根五子位（sidebar/main/rightbar/shell.overlay/shell.leading）＋对话区细挂点（header utilities／input dock／chat node keyed by ChatNodeKind）；扩展包须走 `children` 声明授权，不能抢别人的位。
  4. **发行**：`apps/web` **不是独立 GUI**（裸 Vite 会 fail，需 Host 注入）；desktop 壳也只是 serve 同一 web 前端。**自建发行最短路径 = CLI `dsh web` ＋ 自有 profile ＋ 自有插件包**，不做独立壳。
  5. **主题/品牌**：`ThemeDefinition` 可注册＋token 覆写（后层获胜）；品牌有现成 slots（`sidebar.brand.mark`）；CJK 字体 fallback 已含 PingFang。
  细节：`侦察_L4_客户端UI.md`（111 行，含 HMR/dev 工作流与 4 条待确认）。
- **形态裁决（✅ 2026-09-23 用户拍板：插件组）**：**不做整棵 fork**——功能全覆盖（cookbook 27 行逐行有对应行）；fork 跟不动（250 提交/天、仅 master 无稳定分支、agent-loop 周 +600/-400 而核心仅 647 行）；残留 fork 候选 3 个全有绕路（developer role 不需要／mermaid fence 改走工具生成节点路径／Live2D 走 rightbar）。**包粒度收敛＝4 代码包＋1 数据格式**（P1 服务端教学引擎／P2 消息流渲染／P3 面板／classroom.yaml＋教室包），依赖断点 8 个，实测多为冷面（pre-step 签名 18 天零变化、storage 19 提交、ChatNodeKind 零变；唯一要绕开的热区＝ui-conversation 内部 236 与 cordis-client-runner 245）。**P1 骨架已端到端跑通**（见 `实测报告_P1骨架与装载坑_2026-09-23.md`）。
- **下一步行动清单（✅ ①②③⑤⑥ 已完成，④ 待做）**：① ✅ **AGENTS.md 双重注入实测**（实证成立：宿主每回合注入，source kind `agent-instructions` → P1 不重复注入）；② ✅ `dsh --dump-config` 实跑＋最小插件装载演练（并踩出两个装载坑）；③ ✅ pre-step turn/step 语义实证（**按 step 触发**→ 每回合注入走 turn 首步）；④ ⏭ mermaid 节点路径 PoC（工具生成节点→P2 渲染，零 fork 路线）；⑤ ❌ **Live2D 专题研究已按指令整份删除，重做中（`研究_8`）**；⑥ ✅ 桌面壳更新开关核查（`研究_6`：pin 不住→改纪律）。**另：P1 教学引擎骨架已端到端跑通**（`实测报告_P1骨架与装载坑_2026-09-23.md`）。

## §4 待确认清单（✅ 已汇总）

**全部待用户拍板项已集中到 `待拍板清单_2026-09-23.md`**（架构 A2–A4／manifest B1–B7／仓库动作 C1–C5）。**A1（形态）已于 2026-09-23 拍板：做插件组。**
各侦察件的原始待确认项（L1 的 T1–T8、L3 的 3 条、L4 的 4 条、L5 的 7 条）里，**影响设计的部分已由后续实测关闭**（T2/T3 回合语义、M1-A1 双重注入、工具注册开放、桌面更新、Live2D 授权），**纯运行时细节**（如 inbox API 长期稳定性、`retainTokens` 默认值）留待施工中实证，不阻塞任何设计。
