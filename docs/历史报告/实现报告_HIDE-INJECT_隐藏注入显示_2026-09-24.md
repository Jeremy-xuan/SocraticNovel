# 实现报告 · HIDE-INJECT（让引擎注入的上下文不显示在界面上）

> **任务**：查清"不改宿主能不能关掉引擎注入行的显示"；能则做到并真跑验证；不能则给最小 fork 方案。
> **用户原话**：*"注入上下文是否显示这个需要改, 不要显示。如果只是这一点事情的话, 适当 fork 修改代码也可以接受。"*
> **可改范围**：`code/clients/inject-hide/**`（新建）。
> **只读**：`code/plugins/**`、`code/classrooms/**`、`code/skills/**`、`code/tools/**`、`code/acceptance/**`、`code/clients/classroom-ui/**`、`code/clients/live2d-host/**`、`~/SocraticNovel-wt/`、`~/SocraticNovel-GitHub仓库/`、`/Applications/DSH Desktop.app`（🔴 全程**零写入**）、用户真实 web／desktop profile、`$DSH_HOME/settings.yaml`。
> **未做**：没有 `git commit`／`push`；没有新增任何依赖；没有研究法律/许可问题（按项目纪律只给三行风险提示）。
> **取数快照**：2026-09-24 16:0x–17:0x。正文引用位置一律写锚点 `〔Axx〕`，行号与版本在旁挂表 `实现报告_HIDE-INJECT_隐藏注入显示_2026-09-24.anchors.md`。

---

## 0. 结论摘要

| # | 事项 | 结论 |
|---|---|---|
| 1 | **①1 有没有配置项/开关** | ❌ **不存在**。Chat 客户端注册的持久设置命名空间只有 `ui-chat`，schema 只有 `transcriptView: normal\|compact` 〔A14〕〔A15〕；它控制的是"已结束回合的过程折叠"，**活回合里注入行照样可见**，且拿它当开关会连带改变整个转录的呈现形态。全树没有 hidden/silent/显示开关类字段。 |
| 2 | **①2 插件能不能注册渲染器把这类行吃掉** | ✅ **能**，**本轮就走的这条**。座目录里 `conversation.chat.node` 是 keyed 座、`context` 键已被 shipped 占据、`replaceRisk=shadows-shipped-ui` 〔A27〕〔A28〕；但**同键不同优先级合法**，官方错误提示逐字写 *"register at a different priority to shadow it (lowest renders)"* 〔A16〕〔A17〕 —— ⚠️ **注意方向**：座契约里"胜出"＝ **priority 数值最低**，不是"数值更高"，所以本插件用的是 `priority: -1`（shipped 未声明＝0）。胜出后**运行时能拿到 shipped 的组件本体**把别的来源原样转交 〔A25〕〔A26〕。**宿主零改动。** |
| 3 | **①3 能不能改 `source.kind`** | ❌ **不能这样**（若会让注入混进学生对话流，明确说不能）。投影判据逐字是 `source.kind !== "user"` → context 节点 〔A01〕，**任何非 `user` 的值都还是注入行**（只换标签 〔A04〕）；改成 `"user"` 会把它渲染成**学生自己的发言气泡**，并污染只认 `kind==='user'` 的宿主逻辑（提问时间 〔A35〕、输入队列 placement 〔A34〕）。 |
| 4 | **①4 别的官方通路** | 有一条"看着能"但**不可用**：replacement-surface 的 `user/message` 在 Chat 侧**不建节点**（＝不可见）〔A11〕——但 `surfaceOp` 由宿主 `agent-loop` 落盘时写死为 `"append"` 〔A32〕，插件拿不到这个参数 〔A30〕，且伪造成 replacement 违反会话格式的"被遮蔽节点完整覆盖"校验 〔A31〕。另：`uiConversation.events.register` **顶不掉** shipped 定义（同 kind 重复即抛 〔A36〕），而多注册一个只会**多出一个节点**〔A37〕。 |
| 5 | **② 要不要 fork** | ❌ **不需要**。①2 已在"不改宿主"前提下成立，落点在**渲染分支**这一正确层次（不是 CSS 遮掩），零 `/Applications` 写入、零签名风险。三种 fork 形态的代价对照见 §3。 |
| 6 | **③ 真跑验证** | ✅ 见 §4：真实会话（真实模型／真实工具／隔离 `DSH_HOME`／教室副本），A/B 两相在同一份会话上对照，三张截图 ＋ DOM 读数 ＋ 控制台零报错。 |
| 7 | **④ 影响面** | 见 §5。一句话：**只藏 `source.kind === "socratic-engine"`**；宿主自己的四种 kind 与别人家插件的注入**原样委派给宿主原本的渲染器**（连 props 都是同一个对象）；模型侧上下文机制**零改动**。 |

---

## 1. 基准声明（引用的到底是哪个版本）

| 角色 | 位置 | 说明 |
|---|---|---|
| 🔴 **运行时真源** | `/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/`（244 个包） | "这个扩展点到底在不在"一律以此为准 |
| **本报告引用的行号载体** | `tmp/dsh-installed/**`（工作区快照） | 本轮开跑前逐文件核过 sha256：`dsh-client-ui-chat` / `dsh-client-ui-slots` / `dsh-client-ui-renderer` / `dsh-cordis-client-runner` 四个关键包与安装版**逐字节相同**（`5ab74e54…` / `5433ef2c…` / `859d0a18…` / `e78c94d6…`） |

> **为什么行号挂在快照上**：锚点机核要能读到文件，而安装版在 `/Applications` 里（工作区外）。快照与安装版逐字节相同这一点已核过，所以行号是等价的；快照被刷新时锚点表会响亮报红，重取即可。

---

## 2. ① 逐条：不改宿主，能不能关掉？

### 2.1 ①1 配置项／开关 —— **没有**（不能）

**查法**：先查安装版客户端里一切与 `context`／`inject`／`ContextInjectionRow`／`contextInjection` 相关的分支与任何 config，再查全部设置 schema。

**结论与依据**：

1. **注入行的渲染链是硬编码的，没有条件分支**：`user/message` 的投影判据逐字是 `event.data.source.kind !== "user"` → `{ kind: "context", … }` 〔A01〕，落到 keyed 渲染器 `ContextMessageNodeView` 〔A02〕 → `ContextInjectionRow` 〔A03〕。**链上没有任何"要不要显示"的判据**。
2. **全树没有开关**：Chat 客户端注册的唯一持久设置命名空间是 `ui-chat` 〔A15〕，schema 只有 `transcriptView: "normal" | "compact"` 〔A14〕。全安装版 244 个包里搜 `injection` 只命中渲染文案与无关包（如技能目录的 `<skill_content>` 说明），**没有**布尔开关、没有 `hidden`/`silent` 字段。
3. **`transcriptView` 不是这个开关**（这一点要说清，否则很容易被当成"有配置项"）：
   - 它决定 `compactTranscript`，进而决定"已结束回合里的过程节点折不折进 `turn process`"；
   - `context` **不在** `TURN_PROCESS_INDEPENDENT_KINDS` 里 〔A09〕，所以回合**结束后**它会随折叠一起隐藏——但**活回合里照样显示**，而用户看到的正是活回合；
   - 把它切到 `normal` 会连带取消**整个转录**的过程折叠形态（＝为了关一个东西把别的东西一起改了）。→ **不能**。

### 2.2 ①2 插件注册渲染器／座 —— **能**（本轮采用）

**先查安装版内置座目录**（`dsh-cordis-client-runner/lib/client.js` 里那份机器可读的全部扩展点清单，61 条），逐字：

- `key: "conversation.chat.node"` 〔A27〕
- 同条 `keyDomain` 逐字把已占用的键列全了，含 `context`；`occupants` 逐字含 `client-ui-chat ContextMessageNodeView key 'context'` 〔A28〕
- 同条 `replaceRisk: "shadows-shipped-ui"`

> ⚠️ **一个方向性提醒（容易反着理解）**：任务书里说的"更高优先级的渲染器"，在座契约里的机制是 **priority 数值最低者渲染** 〔A16〕。所以"排到 shipped 前面"＝**用比 0 更小的数**（本插件用 `-1`），不是用更大的数。

**遮蔽为什么成立**（三条机制逐条）：

| 环节 | 依据 |
|---|---|
| 同键**不同优先级**合法 | `register` 只在"同键 **且同优先级**"时报错 〔A17〕，官方错误提示逐字 *"register at a different priority to shadow it (lowest renders)"* 〔A16〕；而 shipped 那条**根本没声明 priority**（＝0）〔A06〕 |
| 同格按优先级升序取最低者 | keyed 条目按 priority 升序排 〔A18〕；`entriesOfSlot` 每格取**第一个存活条目** 〔A20〕 |
| 派发确实走 `entriesOfSlot` | keyed 派发逐字 `entriesOfSlot(slotKey).find((e) => e.options.key === opts?.entryKey)` 〔A22〕；派发点逐字 `renderSlot("conversation.chat.node", routedOwner, { entryKey: routedNode.kind, … })` 〔A07〕 |
| **能拿到 shipped 组件本体**（于是能委派） | `SlotRegistry.entries(key)`（原始台账，含被遮蔽者）与 `entriesOfSlot(key)` 都是**公开方法** 〔A25〕〔A26〕——`slots` 服务自己只公开 `register`／`inject` 〔A29〕，所以要从 registry 这个只读检视面读；台账条目带 `component` 与 `options` 〔A19〕 |

**于是本插件的形态是"遮蔽 ＋ 委派"，不是"接管"**：

- 以 `priority: -1` 注册同键胜出；
- 命中白名单（默认只有 `socratic-engine`）→ 返回 `null`；
- 其余一切来源 → `React.createElement(该格中"除自己外优先级最低的存活条目".component, props)`，**props 原样转交**（本条目只声明 `locale`，不声明 `inject`／`store`／`children`，所以拿到的 props 与 shipped 那条**同一份**，`t` 座位按同命名空间装配 〔A24〕〔A12〕）。
- **"返回 `null`"为什么不留空行、不留占位**：座位外壳是 `div.flowItem`，而宿主自己的样式表里逐字有 `.EvIC1a_flowItem:empty{display:none}`，相邻间距规则也写成 `:not(.flowItem:empty)~:not(.flowItem:empty)` 〔A08〕——**空掉的 flowItem 既不占位也不产生间距**，这是宿主对"这一格没有内容"的既有语义，**不是我们补的补丁**。（这正是"不要用 CSS hack 掩盖"那条纪律的对立面：本方案一行样式都没加。）

**代价（座目录明确标了 `shadows-shipped-ui`，要说清）**：这一格从此由我们这条排在最前。为了不让"遮蔽"变成"接管"，本插件把委派对象**算出来**而不是写死：取该格中**除自己之外**优先级最低的存活条目——即"假如本插件不存在，`entriesOfSlot` 会选中的那一个"。宿主换实现、换优先级、或另一个插件也来遮蔽，本插件都跟着走。**若该格只剩自己**（宿主实现变了/没了），本插件**主动抛错退位**（座位错误边界会把它标成 abdicated 〔A21〕，派发随即回落到座位自带 fallback 〔A23〕）——**宁可响亮退位，也不静默把宿主自己的上下文行一并藏掉**。

> 关于 P3 记的"`conversation.chat.node` 与换 view 互斥"：**本方案不换 view**。只在一个键上做遮蔽，不动 `conversation.view`、不动 `main` 座。

### 2.3 ①3 把 `source.kind` 改成宿主当作"非注入"的值 —— 🔴 **不能这样**

- **判据是白名单式的"是不是 user"，不是"认不认识这个 kind"**：逐字 `event.data.source.kind !== "user"` → `{ kind: "context", … }` 〔A01〕。所以改任何非 `user` 的 kind，**行还在，只是标签变了**（`contextProvenance` 的默认分支 `label: kind` 〔A04〕）。
- **改成 `"user"` 会出事，这就是"不能这样"的理由**：该事件会走 `{ kind: "user" }` 分支，被 `UserMessageNodeView` 渲染成**学生自己的发言气泡**——教学编排（状态块／备课清单／动画通报）会**混进学生的对话流、被当成学生说的话**。而且宿主多处**只认 `source.kind === "user"`**：`lastPromptAt`（"用户最后一次提问时间"）会被这些注入顶掉 〔A35〕；输入队列 placement 会把它算成 `steering` 〔A34〕。→ **明确不能。**
- 顺带一条容易误判的：`source.kind === "plugin"` ＋ `plugin: "compact"` **只在 replacement surface 上**才被识别成压缩检查点 〔A10〕；我们的注入是 append surface，改过去**也还是一行注入**。
- 另：`contextForm` 只认 6 种结构化 form 〔A05〕，我们的 `form: 'classroom-block'` 不在内 → 走 opaque 呈现，但**仍可见**（这是上一路已取证的结论，本轮复核一致）。

### 2.4 ①4 别的官方通路 —— 只列真有依据的

| 通路 | 能不能 | 依据 |
|---|---|---|
| **(a) 把注入落成 replacement-surface 的 `user/message`** | **看着能，实际不可用** | Chat 侧 `systemMessageDefinition` 的 match 兜住一切 `surfaceOp !== "append"` 的事件，但它的 `buildViewNode` 只在 `start.event.type === "system/message"` 时才建节点 〔A11〕 → 一条 replacement 的 `user/message` **在 Chat 里不产生任何节点**（＝不可见）。**但**：`surfaceOp` 是宿主 `agent-loop` 落盘时写死的 `"append"` 〔A31〕，插件侧给不了这个参数（`session.append(type, data, opts)` 的 opts 由调用方决定 〔A30〕）；且 replacement 的语义是"遮蔽既有 surface 区间"，会话格式校验要求"被遮蔽节点完整覆盖"〔A30〕——伪造成 replacement 是**语义错误**，不是技巧。 |
| **(b) 再注册一个 conversation 定义顶掉 shipped** | **不能** | `uiConversation.events.register` 以 `definition.kind` 为键，**重复即抛** 〔A36〕 → 顶不掉 shipped 的 `input-message`；而 `dispatchInput` 会接受**每一个**匹配的定义 〔A37〕 → 多注册一个只会让同一事件**多出一个节点**（两个都渲染），shipped 那个**不会消失**。 |
| **(c) 宿主侧"隐藏注入"字段** | **不存在** | `createUserMessage` 的入参只有 `content`／`source`／`role` 〔A33〕；`source` 在客户端只被读 `form` 〔A05〕与 `kind` 〔A04〕，没有可见性字段。 |
| **(d) 关掉 `ui-chat.transcriptView`** | **不能**（方向反了） | 见 §2.1 第 3 条。 |
| **(e) 客户端插件在 `conversation.chat.node` 上遮蔽 ＋ 委派** | ✅ **能**（本轮采用） | 见 §2.2。 |

---

## 3. ② 为什么**不需要** fork（附三种形态对照，备查）

**结论：没有走 fork。** ①2 已经在"不改宿主"的前提下做到，且落点在**渲染分支**这一正确层次——不是 CSS 遮掩（没有 `display:none`、没有把行高设 0、没有留不可见元素）。用户授权的 fork 选项因此**没有被动用**。

> 🔴 **三行风险提示**（按项目纪律，不做法律/许可研究，也不给结论）：fork 形态会牵涉 ① 上游许可与再分发条款；② 本地构建产物的来源与标识；③ 跟随上游升级时的合并义务。这三件请自行研究。

若将来 ①2 失效（宿主把 `context` 那条的 priority 改到 ≤ -1、或把该键改成 chain 座／换键名），再考虑的三种形态：

| 形态 | 改动量 | 破签名 | 升级维护代价 | 对用户的安装影响 |
|---|---|---|---|---|
| **(a) vendor 宿主客户端包，在 profile 里覆盖** | 大：`dsh-client-ui-chat` 的整个 `lib/client.js`（8.4k 行产物）进我们的分发包 | 否 | **高**：宿主每次升级都要重新 vendor ＋ 重打补丁 | ⚠️ 它是**核心包**——按本项目已写死的铁律，核心包被装进 profile 会造成同包双实例（Symbol 失配、工具调用崩），**这条形态本身就是踩过的坑** |
| **(b) fork 上游公开仓库打补丁后本地构建** | 中：改 1 处渲染分支 ＋ 本地构建链 | 否 | **中高**：跟上游 rebase | 用户要换成自建客户端包，与官方升级脱钩 |
| **(c) 本轮采用的：客户端插件「遮蔽 ＋ 委派」** | **极小**：1 个浏览器半边（约 150 行含注释）＋ 1 个座注册 ＋ 1 个 bundle patch | 否 | **低**：宿主换实现/换优先级时由单测与运行时兜底告警；不跟 rebase | **零**：`dsh plugin add file:<路径>` 一条命令装上，`remove` 一条命令还原 |

## 4. 真跑验证（真实会话 · **同一份会话**的 A/B 两相 ＋ 一个对称重放相）

### 4.1 跑法与边界（先说清"证据是在什么条件下取的"）

| 项 | 做法 |
|---|---|
| `DSH_HOME` | `cp -Rc` 克隆到 `/tmp/dsh-home-hide`（真 `$DSH_HOME` **零写入**） |
| 克隆后必须修的一处 | `profiles/socratic-dev/node_modules/socratic-test` 原本是**相对**软链 `../../../../../../../SocraticNovel-wt/plugins/socratic-test` —— 在 `/tmp` 下会解析到 `/SocraticNovel-wt/…`（＝断链），改成绝对路径 |
| 克隆里那 131 处"断链" | **不是克隆造成的**：逐条核过，它们在**原始 `$DSH_HOME` 里同样是断的**（旧版 app 留下的 `node_modules` 残留）。不许把它们当成本轮引入的损坏 |
| 教室 | 引擎会写教室的 `runtime/`，故用 `/tmp/hide-classroom-copy` 副本；真教室 `runtime/progress.md` 哈希取数前后**一致**（`732069c44a623d9e`） |
| profile | 只动 `socratic-dev`，且**只动克隆里的那一份**；真 `web`／`desktop` profile 与 `$DSH_HOME/settings.yaml` 零接触 |
| `/Applications` | 近 2 小时**零文件写入**（`find -newermt` 空集） |
| 服务 | 独立端口 4398 ＋ `--patch` 覆盖层（只加配置、不改任何 profile 文件） |
| 装载同步 | `file:` 安装后逐文件核哈希：`lib/client.js` 工作区与 profile 两侧**同为 `0f558a128e47d248`**（AGENTS.md 记的"硬链接不抗替换式写入"那条坑，此处已显式复核） |

### 4.2 三相各做了什么（"看什么"写在第三列）

| 相 | 做了什么 | 看什么 |
|---|---|---|
| `with` | **新建**会话 → 真发一条消息（要求老师调一次 `classroom_status`）→ 等整轮跑完（判据＝`turn-tail` 节点出现 ＋ 至少 1 条工具调用行） | 引擎注入行在不在 |
| `without` | **卸掉插件**，重开**同一份会话**（不跑模型、不发消息） | 负对照：宿主本来会显示成什么样 |
| `with-replay` | **装回插件**，重开**同一份会话**（不跑模型） | 与 `without` **完全对称**的对照 |

> 为什么要第三个相：`with` 相是"发消息那一刻"的现场，`without` 是"重开"的现场，两者读取路径不完全同形。`with-replay` 与 `without` 用**同一条读取路径**打开**同一份会话**，唯一差别是装没装插件——于是"看得见/看不见"不可能归因给模型这次怎么答、也不可能归因给环境差异。

### 4.3 读数：两条**互相独立**的通道对上了

**通道 A —— 会话日志（磁盘真值）**：本轮会话 `session-b4172a49-7b65-4c8b-9a61-08d7c3ae9ed6`，按 `source.kind` 数 `user/message`：
`user 1 / agent-instructions 1 / plugin 1 / skill-catalog 1 /` **`socratic-engine 10`**。
那 10 条逐字是：`anchor.rules`、`anchor.lesson_ban`、`story.arc_gate`、`curriculum.map`、`story.node.01`、`state.progress`、`state.mistakes`、`state.review`、`prep-list:L1`、`animation-notice:L01-T00-20260924-160912` 〔A38〕〔A39〕〔A40〕。

**通道 B —— DOM 读数**（`[data-chat-flow-kind="context"]` 的槽位台账）：

| 读数 | `without`（没装） | `with-replay`（装了） |
|---|---|---|
| context 槽条数 | **13** | **13** |
| 非空（有文字）条数 | **13** | **3** |
| 可见（高度 > 0）条数 | 13 | 3 |
| 页面上出现 `socratic-engine` | **是** | **否** |
| 那 3 条非空的是谁 | `AGENTS.md` ／ `@deepseek-ai/dsh-system-prompt` ／ `skill-catalog` | **一模一样** |
| 消息列高 | **994 px** | **594 px** |
| 隐藏槽的布局残留（外边距合计） | 0 | **0** |
| `assistant-step` ／ `user` ／ 工具行 | 2 ／ 1 ／ 1 | 2 ／ 1 ／ 1 |
| 控制台报错（`pageerror` ＋ `console.error`） | **0** | **0** |

**`13 = 10 + 3` 精确对上**：宿主侧那 4 条非引擎注入里，`user` 那条渲染成**学生气泡**（不是 context 行），另 3 条（`agent-instructions` ／ `plugin` ／ `skill-catalog`）是 context 行 —— 与 DOM 的"3 条非空"**逐条同源**。

### 4.4 三问逐条

1. **界面上看不到注入行了吗** → **是**。10 条引擎注入在页面上**一个字符都不出现**（`socratic-engine` 全页零命中），而且对布局的贡献**精确为 0**：列高 994 → 594，恰好是减掉那 10 行自己的高度（10 × 40px ＝ 400px），**没有留下任何空白**。
2. **正常对话与工具调用照常显示吗** → **是**。学生气泡 1 条、助手正文 2 段、工具行 1 条（`Tool call classroom_status · {}`）、`Think` 两段、`System prompt` 一行全在；**宿主自己的 3 条上下文行原样保留** —— 这就是"委派"生效的直接证据，不是"把整类行都吃掉"。
3. **零报错吗** → **是**。两相 `pageerror` 与 `console.error` 合计 **0 条**。

### 4.5 截图（人看的那一份）

| 文件 | 看什么 |
|---|---|
| `code/clients/inject-hide/evidence/without-10-message-column.png` | **负对照**：同一屏里 3 条宿主注入行之下，**10 条「Context injection · socratic-engine」**〔A13〕把消息流撑开 |
| `code/clients/inject-hide/evidence/with-replay-10-message-column.png` | **装了插件**：那 3 条宿主注入行照旧，**那 10 条一条都没有**，`Think` ／ `Tool call` ／ 正文紧接其后，**中间没有空档** |
| `code/clients/inject-hide/evidence/with-00-full-window.png`、`without-00-full-window.png` | 整窗：左栏会话树、右栏、输入框都在（宿主 UI 未被波及） |
| `code/clients/inject-hide/evidence/{with,without,with-replay}-probe.json` | 上表的**原始读数**（含每条隐藏槽的 `height` ／ `marginTop` ／ `display` ／ `cssEmpty`） |

> 两张对照图是**同一份会话、同一视口 1900×1200 @2x、同一条读取路径**，差别只有"装没装插件"。

### 4.6 取证脚本自身的两个坑（记下来，免得下一路重踩）

1. **"工作区行之后第一个 treeitem"不一定是我的会话**：实测那个位置是应用自己的 `New Session` 空占位行 —— 第一遍就点进了空会话，读到的 DOM 全是 0（还差点被当成"插件把整类行都藏了"的证据）。改成**先按标记串找、找不到再退回"第一个非 `New Session` 行"**，并把选行方式写进证据 〔A63〕〔A64〕。
2. **读数要按"参不参与布局"判，不能按计算值判**：`display:none` 的元素 `getComputedStyle().marginTop` 照样返回 `16px` —— 若照抄计算值，就会把"已经退出布局"误读成"还残留 160px"。判据改成 `display !== "none"` 〔A62〕。

读数一律走 DOM 事实、不靠目视（`probeHide()` 〔A61〕）；`with` 相的提示词逐字在脚本里，逼出一次工具调用 〔A60〕。

---

## 5. 影响面（如实说清：这不是"我们的一条 CSS"）

1. **只藏引擎自己的**：白名单 `HIDDEN_KINDS` 默认只有 `"socratic-engine"` 〔A41〕〔A42〕。
2. **宿主自己的上下文注入一条不动**：`AGENTS.md`（`agent-instructions`）、技能目录（`skill-catalog`）、`plugin` 注入、跨会话召回（`session-reference`）**全部原样委派**给宿主原本那个渲染器——实测就是那 3 条非空行，装前装后**逐条一致** 〔A43〕〔A44〕。
3. **别人家插件的注入**：只要它的 `source.kind` 不是 `socratic-engine`，行为与"没装本插件"完全一致（委派 ＋ **同一个 props 对象**）。被改变的只有"这一格由谁排在最前"，而它被限定成一个**纯分类器** 〔A45〕。
4. **宿主自己的上下文机制（模型侧）零改动**：不碰会话日志、不碰 `user/message` 的 `source`、不碰 prompt 装配。引擎注入**照旧进模型上下文**，只是不进学生的眼睛。这正是没有走 ①3（改 `source.kind`）那条路的原因。
5. **不会静默扩大隐藏范围**：若该格里除本插件外没有别的渲染器，本插件**主动抛错退位**，派发回落到座位 fallback 〔A45〕。
6. **一处布局副作用与它的处理（这条必须写清）**：宿主自己那条 `.flowItem:empty{display:none}`（外加"空 flowItem 不参与相邻间距"的半条）**在本机判不出来** —— `renderSlot` 永远给条目套一个 `display: contents` 的槽位外壳，于是 flowItem 里总有一个子元素、`:empty` 永不成立。实测后果是"**行高 0，却各占一条 16px 外边距**"（10 条 ＝ 160px 空白；列高只从 994 降到 754）。所以本插件补了一条**只引宿主数据属性**（不引它那套带构建哈希的类名）的规则，把宿主本来就想说的那句话重说一遍 〔A52〕〔A53〕〔A54〕〔A56〕：**槽位外壳为空 ⇒ 这一行整条不参与布局**。补上之后残留**精确为 0**（列高 994 → 594）。
   - **为什么这不是"用 CSS 遮掩"**：那条规则不移除任何内容（外壳为空时本来就没有内容），它做的是**让空盒子退出布局**；而被禁的那类做法（把行高设成 0／加 `visibility:hidden`）恰恰相反 —— **留下**一个不可见元素。判据也只用宿主稳定的数据属性 `data-chat-flow-kind` 与 `data-slot`，不碰哈希类名 〔A54〕。这条规则的**幂等性**与"只引数据属性"两件事都有单测守着 〔A57〕〔A58〕〔A59〕。
7. **不新增依赖、不改宿主包、不破签名**：见 §3 对照表最后一行。
8. **本插件的装载形态**（三句话，供复核）：只注入 `slots` **一个**宿主服务 〔A47〕；以 `priority: -1` 注册同键、不声明 `inject`／`store`／`children`（于是拿到的 props 与 shipped 那条同一份）〔A46〕；装载走 `ctx.effect`，插件卸载即撤条目 〔A48〕。

---

## 6. 未做到 / 待确认

### 6.1 未做到（如实列）

1. **没有在真实 `web`／`desktop` profile 上跑过**。本轮只在**克隆**的 `socratic-dev` 上验证；要让用户真正用上，需要在真实 profile 里 `dsh plugin add`（副作用见 6.2 第 1 条）。
2. **没有覆盖"另一个插件也在 `context` 那一格遮蔽"的组合**。`shadowTarget` 的规则是"该格中**除自己外**优先级最低的存活条目"（＝假如本插件不存在时 `entriesOfSlot` 会选中的那一个），逻辑上成立，但**全机没有第二个这样的插件可供实测**。标【推断】。
3. **`session-reference`（跨会话召回）与 `skill-invocation` 没有端到端实测**：这两种 kind 只在特定动作下出现，本轮会话里没有产生。判据是同一份白名单（不在表里 → 委派），**单测已覆盖该分支** 〔A42〕，但端到端未出现。
   - 三条核心分支本身**都有单测**：引擎来源 → 渲染 `null`（不碰 `createElement`）〔A49〕；别的来源 → 委派给 shipped 且 **props 是同一个对象** 〔A50〕；该格只剩自己 → 抛错退位。加上"对安装版的漂移告警"那条 〔A51〕，共 **16/16 绿**。
4. **没有在深色主题下出图**：本轮只跑浅色（与 MERMAID-2 同视口）。本改动不涉及颜色，风险低，但**未实测**。
5. **没有做"用户真实 web profile"的安装**：按纪律不碰。

### 6.2 待确认清单（我已按默认继续，标出倾向，请主代理／用户拍板）

1. **真实 profile 的安装副作用**：`dsh plugin add` 会**重算 `dsh.profile.bundles`**，实测把没声明 `dsh.bundle` 的 `socratic-test` **移出了那份列表**。装到用户真实 profile 前要确认列表最终形态。（倾向：装完核一遍，必要时手工把该行加回。）
2. **范围要不要放宽到"所有上下文注入"**：用户原话是"注入上下文是否显示这个需要改, 不要显示"。本轮按任务代号「**引擎**注入的上下文」理解，只藏 `socratic-engine`。若用户要的是**连宿主自己的注入行一起不显示**，改动量＝把 `HIDDEN_KINDS` 填成宿主那四种 kind（**一行**）〔A41〕。（倾向：先按引擎收窄 —— 宿主自己的注入行目前只有 3 条，且含 `AGENTS.md` 这种"看得见有好处"的信息。）
3. **那 16px 残留的处理要不要保留**：我判定**保留**（理由是"不留不可见元素"）。若主代理认为"插件不该加任何 CSS"，删掉 `installEmptyRowCss()` 的调用即回到"160px 空白"的形态，其余行为不变 〔A55〕。
4. **是否要给用户做一次"真机效果确认"**：本轮全部在克隆环境出图；若用户想看真实 web profile 的效果，需要另一条线按 6.2 第 1 条执行。

---

## 7. 本轮产出（全部新建；sha256 前 16 位）

| 文件 | 动作 | sha256 前 16 位 |
|---|---|---|
| `code/clients/inject-hide/package.json` | 新增（`dsh.bundle.patch` ＋ `dsh.client.platform=web`） | `9b14b03c015ff4d2` |
| `code/clients/inject-hide/cordis.patch.yml` | 新增（挂成 profile 的一层） | `436920e3e5238467` |
| `code/clients/inject-hide/lib/index.js` | 新增（空的宿主半边） | `6b546a377a3d5b8f` |
| `code/clients/inject-hide/lib/client.js` | 新增（浏览器半边，本轮的**全部逻辑**） | `0f558a128e47d248` |
| `code/clients/inject-hide/README.md` | 新增 | `9a32eaffe01d6267` |
| `code/clients/inject-hide/test/hide.test.mjs` | 新增（node 侧单测，16/16 绿） | `b1a6070e027ae486` |
| `code/clients/inject-hide/tools/e2e-hide-shots.cjs` | 新增（端到端取证三相） | `7d79a3a7d21596bf` |
| `code/clients/inject-hide/tools/hide-patch.yml` | 新增（取证用 `--patch` 覆盖层） | `986a549bded5aa89` |
| `code/clients/inject-hide/evidence/*.png` | 新增（三相各 3 张截图） | —— |
| `code/clients/inject-hide/evidence/with-probe.json` | 新增（`with` 相原始读数） | `57d58ebe79ca0588` |
| `code/clients/inject-hide/evidence/without-probe.json` | 新增（负对照原始读数） | `c0dba0c5216a0380` |
| `code/clients/inject-hide/evidence/with-replay-probe.json` | 新增（对称重放相原始读数） | `09ca33191b869480` |
| `实现报告_HIDE-INJECT_隐藏注入显示_2026-09-24.md` ＋ `.anchors.md` | 新增（本报告 ＋ 旁挂锚点表） | —— |

**没动**：`code/plugins/**`、`code/classrooms/**`、`code/skills/**`、`code/tools/**`、`code/acceptance/**`、`code/clients/classroom-ui/**`、`code/clients/live2d-host/**`、`~/SocraticNovel-wt/`、`~/SocraticNovel-GitHub仓库/`、`/Applications/DSH Desktop.app`（近 3 小时零文件写入）、用户真实 `web`／`desktop`／`socratic-dev` profile、`$DSH_HOME/settings.yaml`。
**没做**：`git commit`／`push`、新增依赖、法律/许可研究、任何询问类工具调用。

> 取证用的隔离环境仍在 `/tmp/dsh-home-hide`（3.1G，克隆自真 `$DSH_HOME`）与 `/tmp/hide-classroom-copy`（教室副本），供复核；临时目录由系统清理。
