# socratic-engine（P1 教学引擎 · 骨架 v0.0.1）

SocraticNovel 的**宿主侧教学引擎**：读教室包 manifest，按 `position`+`frequency` **确定性注入**教室内容（不依赖模型自觉读文件），并承载教学相位与教学工具。

> 架构依据：`docs/历史报告/形态裁定_初筛_2026-09-23.md`（引擎×内容分离）｜`教室manifest格式_草案_v0.md`（数据侧格式）｜`插件维护难度审计_2026-09-23.md`（包粒度与依赖面）
> 实测证据：`实测报告_双重注入与回合语义_2026-09-23.md`｜`实测报告_P1骨架与装载坑_2026-09-23.md`

## 已实现（集成实测通过）

| 能力 | 机制 |
|---|---|
| manifest 加载与校验 | `lib/manifest.mjs`（M1 v0 schema 子集；14 项错误路径） |
| 系统段注册（`target: system` 块） | `ctx.systemPrompt.section()`，一次性 |
| **每回合注入**（`target: chat` 块） | `agent/pre-step` 的**每 turn 首步**注入，`source.kind='socratic-engine'`，`<system-reminder>` 包装 |
| 注入频率 | `once` / `turn` / `n_turns` / `phase`（门）/ `on_demand`（占位） |
| 状态层模板渲染 | `render.enabled` + `{{phase}}`/`{{turn}}`/`{{classroom}}` |
| 相位与回合自计数 | `lib/phasestore.mjs`（**不依赖宿主 turn 号算术**） |
| 教学工具 | `classroom_status`（相位/回合查询）／`classroom_set_phase`／**`classroom_enter_lesson`（跳讲，J）**／`classroom_draw`／`classroom_animate*`／**`classroom_note`（课堂记录，A / K3）**（`classroom_express` 已废弃删除） |

## 课堂记录（A · 契约 K3）

课上老师说了一句「这是误解 / 这是卡点 / 他刚展示了理解」，就调一次 `classroom_note`；
引擎**只做确定性落盘**，不做总结、不调 LLM（红线：不许用 LLM 生成式改写教学事实）。

### 单一真源与三份投影（K3.1）

- 真源：`<教室>/runtime/notes.jsonl`（append-only，一行一条 JSON）。
- 三份 markdown 是**从 JSONL 机械重算出来的投影**，**整文件重写**，文件头逐字带
  `> 本文件由 runtime/notes.jsonl 机械生成，请勿手改。`：
  `runtime/mistake_log.md`、`runtime/review_queue.md`、`knowledge_points.md` 的状态位。
- 为什么不拿 markdown 当真源：机械推导要解析 markdown 表格，那是"不确定性"的来源，
  也无法保证幂等与并发安全（K3.1 的裁定理由）。

### 记录字段与 id（K3.2）

`v` / `id`（`N-<yyyyMMddTHHmmss>-<三位序号>`，同秒内靠序号区分）/ `ts`（带时区 ISO 8601）/
`session` / `lesson`（无讲次门写 `0`）/ `turn` / `type`（`misconception`｜`blocker`｜
`evidence`｜`group_question`）/ `kp`（`KP-<讲>.<序>`，`group_question` 可为 null）/
`quote`（学生原话，非空）/ `note` / `origin`。
`resolved` **不由工具写入**（写回时忽略输入值），只在投影推导里出现。

### 推导规则（K3.3，逐条对应 `test/notestore.test.mjs` 的一条单测）

排序键：**`(lesson, turn, id)` 字典序**＝时间序（`compareNotes`）。

1. **`knowledge_points.md` 的状态位**：对每个 `kp`，取时间序**最后一条**学习类记录
   （`misconception` / `blocker` / `evidence`）——是 `evidence` → `[x]`；是 `misconception` /
   `blocker` → `[~]`；**没有记录 → 该行一个字都不改**（不写 `[x]`）。
   - 🔴 红线：**「老师讲过」不产生记录**，所以永远不会因"讲过了"推断出 `[x]`。
   - 该 `kp` 所属讲次在 `progress.md` 里是**跳过**（`skipped_lessons:` 行）→ 状态位**不动**，
     只在行尾加「（跳过）」（J2 红线）。
2. **`mistake_log.md`**：每条 `misconception|blocker` 一行；`resolved` ＝ 同 `kp` 上存在
   **更晚**的 `evidence` 记录（"更早的 evidence"不解决后来的卡点）。已解决的记录**保留**，
   只标注「已解决（第 N 讲 · 第 T 回合）」。
3. **`review_queue.md`**：对每条 `misconception|blocker`，到期点 = 记录时讲次 **+1 / +3 / +7**
   （只保留 ≤ 课程总讲数的；`lesson=0` 的记录不排期）。条目在「当前讲次 ≥ 到期讲次」且
   `resolved === false` 时为**到期**；`resolved === true` → 后续到期点作废（计划仍列出）。
   同一 `kp` 多条记录**只保留最早一条**的到期点（避免堆积）。投影上显示的到期点是
   **最近一个已经过去的**到期讲次（"现在欠了哪一次"），不是最早那一格。
4. **`progress.md`**：本模块**只读不写**。读两行：`current_lesson: <int>`（判定到期）与
   可选的 `skipped_lessons: 2,3`（判定跳过讲次；该行缺失＝没有跳过）。
   写回 `progress.md` 是**模型课后更新**（`current_lesson`）与**课上跳讲工具**
   （`classroom_enter_lesson`，见下节）的职责——课中记录工具不碰它，否则会有两个写者。
   `totalLessons` 取自 `knowledge_points.md` 里出现过的最大讲次号（不依赖 manifest）。

### 幂等与并发（AC）

- **幂等**：同一回合（`session` + `turn`）里 `type` + `kp` + 清洗后 `quote` 三样都相同 →
  视为同一条记录，返回既有 `id`、不重复追加。身份用的就是 `lib/postclass.mjs` 的
  `turnMarker` 编码的同一对字段（`session` + `turn`），**不新造键**。
  同一回合记两条**不同原话**是合法的（学生说了两句不同的话）。
- **并发**：写 `notes.jsonl` 走 `withFileLock` + `writeFileAtomic`（宿主
  `@deepseek-ai/dsh-atomic-write`，权限 `0600`，与 `lib/postclass.mjs` 同一套）；
  锁内**重读再判重**，所以两个并发的调用不会互相覆盖。投影在真源落盘之后重算，
  重算失败会抛错说明"记录已落盘、投影未更新"（投影随时可从真源重算：`reproject()`）。

### 落盘前清洗

`quote` / `note` 先按 **K1** 剥情绪标记（`〔emo:label:intensity〕`），再去 markdown 格式
（`cleanRecordText`）。两步都幂等；下划线**不剥**（`fork_exec` 不能被改坏）。

### 注入（K3.4）

`classrooms/cs-os/classroom.yaml` 有两块把「未解决的卡点」与「到期复习项」在**下节课开头**
（`phase: { phases: [open] }`）注入：`state.mistakes.due`（`section: 未解决`）、
`state.review.due`（`section: 到期待复习`）——用 `section:` 只切那一段，不重复注入整份文件。
**必须带 `phase:`**——裸 `every: phase` 的门恒真（`if (!phase) return true`），是假门。
去重走现有的 `(sessionId, turn)` 幂等门，不新造去重表。

**同一份文件的相位分工**（避免一回合注入两遍）：`open` 只看**切片**（未解决 / 到期），
`check` 看**整份**错题本（对答案的靶子），`review` 看**整份**复习计划。为此把既有的
`state.mistakes` 从 `[open, check]` 收窄成 `[check]`、`state.review` 从 `[open]` 改成 `[review]`
——这是**有意**的语义调整，`test/phase.test.mjs` 的签署表（`SIGNED_FREQUENCY_GATES`）已同步更新。

## 任意讲次进入（J · 契约 K3.3 的 `skipped_lessons`）

学生说「从第 5 讲开始」时，老师调 **`classroom_enter_lesson(lesson: 5)`**。引擎做三件事，
全部确定性（🔴 不调 LLM、不做生成式改写）：

| 落点 | 做什么 |
|---|---|
| `runtime/progress.md` | 一次原子写改三处：机器行 `current_lesson: N`、**人读行** `\| 本轮要讲 \|`（与机器行同值）、机器行 `skipped_lessons: 1,2,3,4`；文件里还有 `\| 跳过的讲次 \|` 人读行时一并同步（没这行就不造） |
| 工具结果 | 一段**机械摘录**的前情提要 ＋ 第 N 讲的前置知识点，直接交到老师手里 |
| 内存态 | `currentLesson = N`——**只在写盘成功之后**赋值 |

### 为什么是新工具，而不是扩 `classroom_set_phase`

1. **写的是另一组键**：`set_phase` 的契约是「只写 `current_phase` 一行、不动别的」
   （契约 K3.3.4）；跳讲要写 `current_lesson` ＋ `skipped_lessons` ＋ 人读表格。
   合体会把两条互不相干的写路径绑死，任一侧改判据都会牵动另一侧。
2. **返回值形态不同**：跳讲要一次交出几 KB 机械摘录，`set_phase` 只回一句短状态。
3. **触发词不同**（「从第 N 讲开始」 vs 「进入追问环节」）：本项目实证条件措辞会让模型犹豫、
   工具就够不着（见 `实现报告_T3a` §4），两条触发各写死在各自的工具描述里更可靠。

### 注入集合规则（J3 / 验收 A1）

`story.node.NN` 本来就挂在 `lesson: {current: true, of: N}` 上，跳讲只改 `current_lesson`
→ **注入哪些故事节点完全由这条门决定**：跳到第 N 讲之后只有 `story.node.N` 放行
（`test/lessonjump.test.mjs` 把 1–14 全扫一遍断言）。前情提要自己也守同一条线：

- `story/ch{01..N-1}.md` 只取「**本讲位置**」（ch01 是「这一讲在故事里的作用」）**那一段正文**；
  「场景节点」「机会节点」「暗线种子」「留给后面的事」一律不取——那些段里写着**后面几讲**的
  回收点（如 ch02 的「ch14 回收」），取它们就等于提前剧透。
- `story/overview.md` 只取两块：「人物弧」表里**讲次区间含 N** 的那一行的**前三格**
  （段 / 讲次 / 状态）；第四格「标志」写的是"第 9 讲她主动讲起…"这类**后面几讲的里程碑**，
  丢掉。「每讲核心疑问」只取 `< N` 的行。
- `knowledge_points.md` 取第 `1..N-1` 讲的知识点，**分两档**（`PREREQ_FULL_WINDOW = 2`，
  2026-10-21 拍板）：**近两讲（N-2、N-1）给条目原文**（含判据）；**更早的只列标题**
  `· KP-x.y 标题`，一行一条、不带判据正文。理由：跳到第 14 讲时全量原文的这块约 7.6 KB，
  会挤掉别的注入块，而「学生真正需要的前置」几乎都在近两讲；判据他自己去读
  `knowledge_points.md` 那一节即可。分档后同一块约 3.3 KB（< 一半）。
  改窗口只改这一个常量；第 N 讲自己的知识点**不进**「前置知识点」段（它由 `curriculum` 与本讲清单给）。
- 没摘到的文件／段**如实列进** recap 末尾的「没摘到的部分」，不假装完整。

### 失败与红线

- **先写盘、后改内存**：写盘失败返回 `persisted:false` ＋ 原因（与 `persistPhase` 同形），
  同时把 `lesson` **原样退回旧值**——调用方无论怎么接线都不会出现「内存说第 5 讲、盘上第 1 讲」。
- **跳过 ≠ 掌握**（J2）：跳过的讲次只写进 `skipped_lessons`；`knowledge_points.md` 的状态位
  由 `lib/notestore.mjs` 推导，属于被跳过讲次的 `kp` **状态位不动、只加「（跳过）」**，
  永远不因「跳过了／讲过了」出 `[x]`。
- **参数越界即拒**：`0`（＝还没开始）／超出 `classroom.lessons`／非整数都在**写盘之前**报错，
  报错信息带合法区间；跳回已经上过的讲次、跳讲后又要求从头开始都合法
  （后者会把 `skipped_lessons` 整行删掉，回到「缺失＝无跳过」）。

### 三条**有意不做**的事（2026-10-21 主代理拍板，改之前先看这里的理由）

1. **不跟改 `progress.md` 的「待办」段**。那是学习计划／教学内容（"学生要学什么"），
   跳讲只改"讲到哪儿"，不该顺带替老师重写计划。真相在机器行 ＋ 两行人读行（面板读的也是它们）。
2. **不重算投影**（跳讲后不调 `reproject()`）。`knowledge_points.md` 的状态位是 `classroom_note`
   驱动的**投影**，"单一写入者"比"「（跳过）」标记立刻出现"更重要——跳讲多写一次就成了第二个写者，
   与 A 车道「手写投影会和重算打架」的教训同源。标记会在下一次 `classroom_note` 落盘时自然出现。
3. **不放宽 `story.arc_gate` 的门**（它写死 `lesson: {list: [1]}`）。那道门的设计就是"只在第 1 讲
   开场放一次弧线总览"；跳讲后由 recap 的「人物弧前三格」补上她此刻的约束，够用。放宽门＝每讲重放总览。

## 安装（🔴 两个坑，务必照做）

```bash
export DSH_HOME=~/Library/Application\ Support/dsh-desktop/harness
DSH_BIN="/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js"
node "$DSH_BIN" plugin --profile <profile> add "file:$HOME/SocraticNovel-wt/plugins/socratic-engine"
```

1. 🔴 **不要**把 `@deepseek-ai/dsh-tools`／`dsh-llm` 等宿主核心包装进 profile 或插件本地 node_modules——会造成**模块实例分裂**（Symbol 失配），工具调用崩在 `Cannot read properties of undefined (reading 'prepare')`。宿主自带解析。
2. 用 **`file:`** 装（`link:` 会让插件从自己路径解析、找不到宿主核心包）。开发循环：`file:` 装一次，之后改完 `cp -R index.mjs lib <profile>/node_modules/socratic-engine/`。

## 配置（profile 的 `cordis.patch.yml`）

```yaml
- id: socratic-engine
  name: socratic-engine
  config:
    classroomDir: /abs/path/to/classroom   # 必填；缺省时插件空转（skill 模式兜底）
    defaultPhase: boot                      # 可选
    enabled: true                           # 可选
    classroomDeclaration: /abs/path/to/classroom-declaration.json   # 可选：核"引擎写盘 == 面板读盘"
    animation: { python: /abs/python3, manim: /abs/manim }          # 教室声明了 animation: 时必填
```

🔴 **预设表情层已废弃（2026-10-20）**：`config.expression.capabilityFile` / `config.expression.model`
不再被读取，`classroom_express` 工具已删除，`lib/expression*.mjs` 与 `lib/expression-table.json`
已移除，引擎也不再写 `runtime/expression.md`。表情改由舞台按**语气标记**（契约 K1）实时驱动，
见下方「情绪标记」段。`classroomDeclaration` 只保留**目录一致性**那一半（立绘模型名仍从声明读，
渲染侧以它为准）。

## 板书事件（W-e · 契约 K2）

`classroom_draw` 成功时，返回值里多三样东西（K2.1）：

| 字段 | 值 |
|---|---|
| `diagramId` | `.mmd` 文件名去扩展名，如 `L03-T05-20261020-231500-flowchart` |
| `boardRoute` | 恒 `"/stage-board/diagrams/" + diagramId`（舞台宿主半边按它读图） |
| `board` | `{ id, lesson, turn, kind }`；`lesson` 缺失写 `0` |

还有两处出口：

- **`output.render` 的文本末尾单独一行**（兜底路径，也是给模型看的）：
  `[board] id=<diagramId> lesson=<N> turn=<T> kind=<kind>`。
- **`output.presentationMeta` 返回 `{ board: { id, lesson, turn, kind } }`**——这是结构化数据进
  会话事件的**唯一**出口（0.2.1 的事实：`content` 是 `render` 的产物，结构化 `value` 不进事件）。
  舞台**优先读 `meta.board`**，拿不到才去正文抓 `[board]` 那行。

### 索引的「会话」列（判断"本节课的板书"）

`runtime/diagrams/index.md` 原来只有「日期/讲次/回合/图类型/标题/说明/源文件」七列，**没有会话**。
本批**在末尾加了一列 `会话`**（写宿主 session id；取不到写 `—`）。

**理由**：回合号是**会话内**自增的（新会话从 1 重来），所以同一讲跨两次会话时，
只靠「讲次 + 回合」**分不清**哪些图属于"本节课"——`L01-T03` 会在两次会话里各出现一次。
加一列 session 之后，"本节课的板书"＝**该 session 的行**，判据确定、不靠猜。
为什么放在**末尾**：按位置取前 7 格的老读法不受影响（表格列数变了，但前七列顺序没动）。

> ⚠️ 跨车道影响：面板（P 车道）读这张表来列板书历史。**新列在末尾**，按表头名解析不受影响；
> 按固定列数解析会多一格。这一条写在实现报告里请主代理转达。

## 情绪标记（C-e · 契约 K1）

老师在句末写 `〔emo:<label>:<强度两位小数>〕`（`label` ∈ `calm`/`happy`/`shy`/`puzzled`/`excited`），
引擎在 `llm/stream` waterfall 里**逐 chunk 剥掉**，并把剥出的事件追加写
`<教室>/runtime/emotions.jsonl`（供舞台的表情驱动模块轮询）。

- **为什么只能在流里剥**（K1.0 的取证，不重复调研）：0.2.1 的原生对话框把 HTML 注释原样转义显示，
  `〔…〕` 也可见；没有"助手文本持久化前 transform"的钩子。能改助手输出的位置只有 `llm/stream`。
  → 标记**只在流里存在**，落盘与显示的全是剥净文本。
- **纯函数层**（`lib/emotionmark.mjs`）：`parseEmotionBody`（语法）与 `createEmotionStreamParser`
  （K1.3 流式解析）。判据写死并按单测逐条覆盖：跨 chunk 拼接不吐半截、flush 时残留原样交回、
  非法标记整段剥掉且不发事件、一句只取第一个、**任意切分方式输出逐字节一致**（测试里对每段样本
  穷举 1/2/3 段切法）。
  🔴 **"什么才算标记"的判据是：以 `emo:` 开头的括号对**（合法的剥掉并发事件；非法整段剥掉不发事件）。
  其它成对的 `〔…〕`（如 `〔em〕`／`〔不是标记〕`／`〔EMO:…〕`）**原样保留**——那不是标记，是正文。
- 🔴 **两份实现必须同判据**：舞台侧还有一份浏览器实现
  `clients/classroom-stage-warm/assets/l2d/stage-emotion-parse.js`（防御性剥离）。引擎不许复制它的实现
  各改各的；`test/emotion-parity.test.mjs` 用同一批语料 + 全部切点断言两边 `text`/`events` 逐字节相同
  （舞台文件不在本分支时**响亮跳过**并说明"本条闸门未验"，可用环境变量
  `SOCRATIC_STAGE_EMOTION_PARSER=<绝对路径>` 指过去跑）。
- **接线层**（`lib/emotionchannel.mjs`）：`registerEmotionChannel(ctx)` 注册 `llm/stream` 监听器。
  🔴 监听器**同步**返回 async iterable（`llm.stream()` 直接把它交给 `for await`）；
  改的只有两处：`text-delta.text` 与 **`block-end` 里文本块的 `block.text`**，其余 chunk
  **原样透传（同一引用）**；任何异常 → 退化为透传并记日志。
  🔴 为什么 `block-end` 也必须剥（**契约 K1.2 的必要补充**，本机实测发现）：宿主 `dsh-llm` 的
  `BlockAssembler` 在 `block-end` 处用 `partial.block = chunk.block` **覆盖**它按 delta 累出来的文本
  （`dsh-llm/lib/index.js:992`），而适配器给的 `block.text` 是**未剥原文**。只剥 delta 的后果是实打实的：
  `emotions.jsonl` 拿到了事件，而 headless 打印的正文里标记还在、落盘的 `assistant/message` 也带标记。
  补上这一处之后实测：正文干净、事件照常落盘（见实现报告的「K1 chunk 形状实测」节）。
  会话标题等旁路调用带 `options.purpose`，**不播情绪**（只剥文本）。
- **chunk 形状实测**（0.2.1-rc.2，隔离 profile 里挂 observer 打出来的，不是猜）：
  `{ type: 'text-delta', index: 0, text: '…' }`；`options` 键含 `sessionId`/`signal`/`model`…
- **通道**（K1.4）：`{ v, seq, ts, session, turn, label, intensity }`，append-only，`withFileLock`
  串行化，权限 0600；`seq` 进程内计数器 + 启动时从末行续号；超过 **64 KB** 折叠成
  `{"v":1,"collapsed":true,"upTo":N}` + 最近 8 行（保持"读末尾即可"）。
- **落盘前再剥一次**（K1.2 末、K1.5）：`session_log.md`（`lib/postclass.mjs`）与
  `classroom_note`（`lib/notestore.mjs` 的 `cleanRecordText`）都会调同一个剥离函数（幂等、防御性）。

## 教学动画与备课（ANIM-ORCH / ANIM-PREP / ALIGN-EXEC）

- 顶层 `animation:` 段（`enabled` 等）控制动画通道：段**缺席** → 引擎不注册动画工具；启用后
  注册 `classroom_animate`（自己写 Manim 脚本）与 `classroom_animate_template`（用预置模板，命中
  课前预热缓存基本不用等）。模板与预热逻辑见 `lib/animtemplates.mjs`／`lib/prepstore.mjs`。
- 顶层 `prep:` 段声明"每一讲课前预先渲染好的动画清单"（`items: []`，一条＝一段要预渲的动画）。
  引擎在回合开头按讲次注入 `prep-list:L<讲次>` 块、并按终态通报 `animation-notice:<任务号>`。
  🔴 死配置守卫：声明了 `prep:` 却没启用 `animation:` → **报错**（不许静默）。
- 动画纪律（见 `index.mjs` 注释）：① 老师**先讲**这一步、再调动画工具；② 引擎侧**不向模型报秒数**
  （同一件事不能两个数——缓存命中与否用定性说法，与 `prep:` 文案一致）。

## 开发

测试零 LLM 成本（纯 node --test，直接吃 `lib/*.mjs` 与 `test/fixtures/`）：

```bash
npm ci                              # 按 package-lock.json 精确装回依赖（node_modules 已被 .gitignore 忽略，不入库）
npm test                            # = node --test test/*.test.mjs，跑全部单测
node --test test/manifest.test.mjs test/injector.test.mjs   # 只跑某个文件
```

> 仓库根 `.gitignore` 已忽略 `node_modules/`；干净 checkout 必须 `npm ci` 后再 `npm test`。

## TODO（骨架未做，避免未验证代码）

- `agent/turn-stopping` 课后自动更新教室 `runtime/`（B2）——需先接 `ctx.sessionProjections`（核心机制，待一次集成实测）
- `on_demand` 块的工具触发路径：对答案逐字回查、知识点读取、画图（M3）
- `render.missing` 语义（M1-B2 待用户拍板：error 还是 default）
- 教室目录自动发现（现由 config 显式指定）
- 跨 turn 注入去重（headless 单 turn 测不到；多 turn 集成测试时关）
