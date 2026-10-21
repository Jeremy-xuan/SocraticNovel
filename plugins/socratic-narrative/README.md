# socratic-narrative · 叙事层（车道 N）

开发文档第 3 波的 N1 / N2 / N3 / N4 / N5：**独立上下文 agent 运行器**、**日记**、**群聊**、**定时主动消息**、**世界观提议**。

- **N1**：`lib/runner.mjs` —— 「读文件 → 调模型 → 结构化结果 → 写文件」，每次运行一个全新上下文，异步、不进学生会话列表、失败大声。
- **N2**：`lib/diary.mjs` —— 在 N1 之上：收集本节记录 + 她最近三条日记 + 角色卡 + 角色声音段 + 世界设定 + 最近群聊，写一条日记（≤120 字），按「会话 + 讲次」幂等。
- **N3**：`lib/groupservice.mjs` + `lib/group.mjs` + `lib/groupstore.mjs` —— 契约 K4 的群聊服务（`history` / `send` / `poll` / `markRead`），真源是 `runtime/wechat_group.jsonl`，`wechat_group.md` 是机械投影。
- **N4**：`lib/proactive.mjs` —— 每天 1–3 次主动消息（北京时间 8:00–23:00），当天的消息**预生成**进持久队列，发送前做确定性检查（有学生发言/上课/新消息就作废重生成），连续 2 条没人回就退避。
- **N5**：`lib/proposals.mjs` + `lib/review.mjs` + `lib/worldguard.mjs` —— 任何 agent 都能往 `world/proposals.md` 提一条；每节课结束后**跑日记的那一轮顺带审阅**，接受的写进 `characters/` 或 `world/` 并记 `world/changelog.md`；🔴 **代码级守卫**保证教学文件一个字都碰不到。

本包**零运行时依赖**：不 import 任何 `@deepseek-ai/*`（理由见下「宿主包纪律」）。装进 profile 后 `node_modules` 里除了它自己没有别的东西。

---

## 1 · 两种任务，同一个运行器

| | 谁触发 | 入口 | 阻塞吗 |
|---|---|---|---|
| 日记 | 引擎（收课相位 / 闲置兜底） | `narrative.runDiary(...)` | 不阻塞：立刻返回句柄，结果在 `done` |
| 其它后台任务（群聊、世界观审阅……） | 将来的调用方 | `narrative.runTask(...)` | 调用方决定（抛错，需自己接） |

---

## 2 · 模型通道（N1.2）

**不硬编码任何模型名与密钥。** 路由按下面的顺序解析，第一个命中的生效：

1. 调用参数 `model: { provider, model }`（引擎读 `classroom.yaml` 的 `narrative.models.<task>` 后传进来）
2. 插件配置 `config.models.<task>`
3. 插件配置 `config.provider` / `config.model`
4. **实例已配置的默认模型** —— `ctx.agentDefaultModel.currentSelection()`

四处都取不到 → 抛 `ROUTE_MISSING`，消息里直接写清楚该去哪配。**不猜、不回退到写死的模型。**

`classroom.yaml` 里想给日记单独指定模型时写成（引擎负责读出来，作为调用参数传进来）：

```yaml
narrative:
  models:
    diary: { provider: deepseek-official, model: deepseek-v4-flash }
```

拿到的只是路由名；凭据在实例自己的 provider 配置里，插件一个字节都碰不到。

---

## 3 · 服务签名

服务名 **`narrative`**（宿主侧 `ctx.get('narrative')`；若在插件里声明 `inject: ['narrative']` 则可直接 `ctx.narrative`）。

### `runDiary(request) → handle`（N2.1 的触发入口）

```js
const handle = narrative.runDiary({
  sessionId: '...',        // 必填。幂等键的一半
  classroomDir: '/abs/path/to/classrooms/cs-os',  // 必填
  lesson: 3,               // 讲次；无讲次门给 0 或 null（幂等键的另一半）
  trigger: 'close',        // 'close'（收课相位）| 'idle'（闲置兜底）| 其它字符串，只用于日志
  model: { provider, model },   // 可选，覆盖 §2 的第 2–4 档
  timeoutMs: 60000,        // 可选
  date: '2026-10-21',      // 可选，覆盖条目日期（默认取本地今天）
})
// → { accepted: boolean, runId: string|null, state: 'running'|'failed', reason?: string, done: Promise<Result> }
```

`done` 的两种结果：

```js
{ ok: true,  state: 'ok',      writes: [{path, bytes}, ...], value: { text } }
{ ok: true,  state: 'skipped', writes: [] }          // 这节课已经写过了（不是失败）
{ ok: false, state: 'failed',  error: { code, message, detail? } }
```

🔴 **`done` 永不 reject。** 引擎可以 `void narrative.runDiary(...)` 浮空调用（N1.3：不阻塞课堂回合）。失败不会消失——它一定同时出现在**运行日志**和 **`status()`** 里（N1.4）。

`accepted: false` 只发生在参数缺失（`NO_SESSION` / `NO_CLASSROOM`），此时 `done` 立刻给出 `{ok:false}`。

### 幂等语义（N2.1「每节课只写一条」）

- 键 = `sessionId + lesson`（`diaryKey()`，无讲次的课一律记作 `0`）。
- 键记在 `<classroomDir>/runtime/.narrative/diary-ledger.jsonl`，**一行一条 JSON**。
- 同一键第二次触发 → `state: 'skipped'`，不重复写、不算失败、`status().ok` 保持 `true`。
- **写序是「先正文、后账本」，账本失败就把正文回滚掉**。反着来（先账本）会在崩溃时留下「记过但没写」的键 → 下一次触发静默跳过 → 一条永远不出现的日记，没有任何错误。这条顺序是 A6「静默失败」红线的直接对策。

### `runTask(spec) → Promise<Result>`

N1 的通用形态，日记之外的任务用它。`spec` 见 `lib/runner.mjs` 的 `runTask` JSDoc；要点：

```js
await narrative.runTask({
  task: 'group',                 // 路由器认这个名字
  system: '……',                  // 任务说明（系统位）
  prompt: '……',                  // 本次要求（正文位）
  inputs: [{ label: 'runtime/x.md', path: 'runtime/x.md' }],   // 逐字读盘进提示词
  root: classroomDir,
  schema: { fields: { text: { type: 'string', required: true, maxChars: 200 } } },
  apply: async (value) => ({ writes: [{ path, bytes }] }),      // 写哪些文件、写什么
})
```

**这个函数抛错**（`NarrativeError`），不想处理就包一层 `runDiary` 那样的浮空包装。

### 读取出口（N2.4）

```js
await narrative.readRecentDiaries({ classroomDir, limit: 3 })
// → { entries: [{ date: '2026-10-21', lesson: 3, text: '……' }, ...], bad: 0 }
```

按文件顺序（＝时间顺序）返回**最近 N 条**。下一节课要注入最近一条，就是 `limit: 1` 取 `entries.at(-1)`。

### 只读状态出口（N1.4，面板用）

```js
narrative.status()
// → {
//   ok: boolean,                  // 最近一次跑完的运行有没有失败
//   active: [...],                // 正在跑的
//   lastError: { code, message, ... } | null,   // 最近一次失败（后来的成功不清空它）
//   lastSuccess: {...} | null,
//   recent: [...],                // 最近 20 条，含失败
// }
```

返回值是**冻结的深拷贝**，调用方改不动内部状态。

### 其它

```js
narrative.isLessonIdleClosed({ studentTurns, lastActivityAt, now })  // → { closed, reason }（N2.1 兜底判据，纯函数）
await narrative.whenIdle()                    // 等所有在跑的运行落定（测试/优雅退出）
narrative.runLogPath(classroomDir)            // 运行日志的绝对路径
```

---

## 4 · 落盘的文件

| 文件 | 谁写 | 说明 |
|---|---|---|
| `runtime/diary.md` | 日记 | 人读的日记本。新条目插在**条目区**（`---` 之后、口吻提示之前），文件头与口吻提示一个字不动 |
| `runtime/.narrative/diary-ledger.jsonl` | 日记 | 幂等键账本（只有键与时间，不含正文） |
| `runtime/.narrative/agent-runs.jsonl` | 运行器 | 运行日志：一行一次运行，成功/失败/跳过都记，跨重启可查（群聊、审阅也写这里） |
| `runtime/wechat_group.jsonl` | 群聊 | **群聊唯一真源**，append-only，字段严格照契约 K4.2 |
| `runtime/wechat_group.md` | 群聊 | 上面那份的**机械投影**（文件头写「机械生成，请勿手改」），只给人看 |
| `runtime/wechat_group.rules.md` | 人 | 群聊的写死规则（N3.6）；agent 的系统提示**逐字**取它的文件头 |
| `runtime/.narrative/group-state.json` | 群聊 | 未读游标、待回复批次、课堂状态镜像（不是消息） |
| `runtime/.narrative/proactive.json` | 定时 | 当天的主动消息队列（预生成的消息、发送时刻、作废记录、退避计数） |
| `runtime/notes.jsonl` | 群聊（只追加） | 群里提的知识题写一条 `group_question`；**投影由引擎重算，本包不碰**（见 §7.3） |
| `world/proposals.md` | 任何 agent（只追加） | 世界观提议；审阅结果**不写这里** |
| `world/changelog.md` | 审阅器（只追加） | 接受/拒绝都记一行，人一眼扫完 |

`runtime/.narrative/` 是隐藏子目录：不占教室内容的命名空间，也不与契约 K3 的 `runtime/notes.jsonl`（**教学记录**真源）混在一起——那是教学事实，这是运行过程。

**为什么幂等键不写在 `diary.md` 里**：面板用 markdown 渲染，0.2.1 的前端渲染器把 html 节点**原样转义显示**（契约附二），一条 `<!-- … -->` 会被学生读成一段乱码。

---

## 5 · 写作规则与那条不可越的线

N2.3 的规则**不在本包里另抄一份**：运行时从 `runtime/diary.md` 的**文件头**（连续的 `>` 引用行）逐字抽出来，作为日记 agent 的系统提示。文件头改了，提示词就跟着改；文件头里找不到规则 → 抛 `NO_DIARY_RULES`（不悄悄用默认值顶上）。

🔴 **硬约束**：给日记 agent 的提示词（系统位、正文位、字段说明）里，**一律不得出现**「会被学生看到」「有读者」之类的意思。它必须以为这是只写给自己看的本子——知道有读者的日记会变成表演。

实现与守卫：

- `buildDiarySystem()` / `buildDiaryPrompt()` / `describeSchema()` 是本包**唯一**面向日记模型的文本产地，集中在一个文件（`lib/diary.mjs`），没有第二处。
- `test/diary.test.mjs` 有一条**机器守卫**：这三段拼起来不许命中 `读者 / 观众 / 面板 / 展示给 / 给别人看 / 有人会看 / 会被看到 / 公开 / 学生 / 同学`。红了就是做错了，不是文案问题。
- 日记不传任何工具（`llm.stream` 不传 `tools`），所以也不存在「工具描述泄露」这条路。

> 已知边界（不是缺陷）：输入里会带教室自己的内容，`characters/komari.md` 有「结果意外有了读者」——那是她写网络小说的旧事，说的是小说有读者，不是日记有读者；`runtime/session_log.md` 的压缩规则里有「学生」。这些是**教室内容**（车道 E 的地盘），不是本包写的提示词。要不要再收一层由 E 决定。

---

## 6 · 失败怎么算「大声」（N1.4）

四类失败各有稳定 code（`lib/errors.mjs`），**全部**同时走两条出口：

| code | 什么时候 |
|---|---|
| `MODEL_ERROR` | 适配器报错 / `finish.kind` 是 `error`\|`aborted` / 输出被 `max-tokens` 截断 / 宿主没有 `ctx.llm` |
| `TIMEOUT` | 超过本次预算（自己计时 + abort，不依赖适配器肯不肯停） |
| `INVALID_OUTPUT` | 不是 JSON / 不是对象 / 缺必填 / 类型不对 / 超字数（**不截断、不补默认值**） |
| `ROUTE_MISSING` | §2 四处都取不到路由 |
| `IO_ERROR` | 读写教室文件失败、路径越界、`apply` 没返回 `writes`、账本写失败（含回滚失败） |

两条出口：① `runtime/.narrative/agent-runs.jsonl`（跨重启）；② `status().lastError`（面板直接读）。
**任何一处都不许出现「返回 null / 返回空文本 / 当作成功」这种处理**——那就是静默失败。


---

## 7 · N3 · 群聊（契约 K4）

### 7.1 为什么真源是 JSONL（N3.2 要我判断并写明）

`runtime/wechat_group.jsonl` 是唯一真源，`wechat_group.md` 是**机械投影**（每次追加后整份重画）。三条理由：

1. **未读要用 `seq`**：K4.2 写死「`seq` 是排序与未读的唯一依据」。markdown 里没有可靠序号，靠行序＝让未读依赖解析器稳定性。
2. **两个标签页同时发言不能丢消息**（K4.3 的 AC）：一行一条 JSON 的追加在 `O_APPEND` 下是单个写操作；markdown 必须整文件重写，「读—改—写」之间一定丢写。
3. **坏数据隔离**：一行坏 JSON 只丢那一行（坏行计数上报）；markdown 一处坏格式会让整份读废。

`ts` 一律写 **北京时间 `+08:00`**：群聊的一切时间语义（N4 的 8:00–23:00）都在北京时间，EC 明写「服务器时钟不可信」，所以不跟随进程本地时区。

### 7.2 服务签名（`classroomGroup`，typert Remote）

浏览器侧 `ctx.remote.classroomGroup.<method>(sessionId, ...)`，宿主侧 `ctx.get('classroomGroup')`。

| 方法 | 入参（wire） | 返回 |
|---|---|---|
| `history` | `limit`（默认 50，收敛到 1..200） | `{ messages, nextSeq, unread }` |
| `send` | `text`（1–2000 **码点**，空白串拒绝）、`clientId` | `{ ok: true, message, unread }` ／ `{ ok: false, error: { code, message } }` |
| `poll` | `afterSeq`、`waitMs`（0–25000，服务端收敛） | `{ messages, typing, nextSeq, unread, serverTime }` |
| `markRead` | `seq` | `{ unread }` |

- `error.code` ∈ `EMPTY`｜`TOO_LONG`｜`RATE_LIMITED`｜`AGENT_FAILED`｜`STORE_CORRUPT`。
- 🔴 **`AGENT_FAILED` 只用在「消息落盘了但排不进回复队列」**（可重试）。**回复生成失败不在 `send` 里**——它是异步的，失败会：① 重试一次；② 仍失败就发一条 `role:'system'` 的说明（K4.2 允许 system 作为「无法回复的说明」）；③ 写 `agent-runs.jsonl` 与 `narrative.status()`。
- `STORE_CORRUPT`：真源里有**无法解析的行**时 `send` 拒绝写入（否则 seq 的分配依据不完整，可能撞号）；`history` / `poll` 仍照读，坏行跳过。
- `typing` 为 true 当且仅当「她已被排入回复队列」（K4.4 的措辞）。课堂进行中会被推迟，但**排入状态不变**，所以那时仍是 true。
- 并发：追加+投影重写整体走跨进程锁（`lib/lock.mjs`，`wx` 建锁 + 陈旧锁回收），同进程再叠一层串行队列。**两个标签页同时发言一条不丢**（有单测：12 条并发，seq 连续）。

### 7.3 🔴 `runtime/notes.jsonl` 的两个写入者（边界）

K3.5 说日记/群聊**只读** `notes.jsonl`。群里提的知识题要落一条 `group_question`，于是这个文件会**有两个写入者**。本包的做法（也是唯一允许的做法）：

- **只追加一行 JSON**（`lib/noteswrite.mjs`，`O_APPEND` 单次写、单行 < 4KB 天然原子），`origin: "group_agent"`。
- 🔴 **绝不重算三份投影**（`mistake_log.md` / `review_queue.md` / `knowledge_points.md` 的状态位）。那三份只有引擎（`classroom_note`）能写——两个写入者各算一次，谁后写谁把对方的结果盖掉。
- 字段对齐引擎：`id` 是 `N-<yyyyMMddTHHmmss>-<三位序号>`（同一秒内取已有最大序号 +1），`ts` 带**本地时区偏移**（跟引擎同口径，一份文件里不混两种时间写法），`quote` 已剥 K1 情绪标记与 markdown，`resolved` **不写**。
- `kp` 只有在 `knowledge_points.md` 里真实存在时才写，否则写 `null`（不写假编号）。
- `session`：群聊没有宿主会话，写引擎同款兜底 `"unknown"`；引擎报过 `sessionId` 时写它。
- 已知边界：跨进程同一秒内的 `id` 序号可能撞（引擎也没在追加时持锁）。写进「已知边界」。

### 7.4 谁能开口（N3.3）

`characters/*.md` 的一级标题就是名字（`# 鲸（DeepSeek 娘）· 本教室版本` → `鲸（DeepSeek 娘）`，短名 `鲸` 也认）。一次性路人写成 `路人·<称呼>`。**不在这两类里的名字直接判 `INVALID_OUTPUT`**（不静默改名）；会反复出场的人要走 N5 的提议流程。当课角色卡从 `classroom.yaml` 的 `path: characters/*.md` 解析（不硬编码文件名——这一版教室换过人）。

### 7.5 节奏（N3.4）

- 学生发言 → 立刻落盘、立刻返回（`send` 不等模型）；同时记「回复批次」，`dueAt = now + 10..30s 随机`。
- 期间 `poll` 的 `typing` 为 true；学生再发一条 → **同一批次**重置 `dueAt`（按 `afterSeq` 归并，服务端去抖，不靠前端）。
- 到点由 `tick()` 跑一次模型；**课堂进行中就挂着**，收课后补回。
- 「课堂进行中」的判据（写死）：**相位不是 `close` 且最近一次回合活动在 30 分钟以内**。相位来源：① 引擎每回合调 `setClassroomActivity()`（推荐）；② 没有就退而读 `runtime/progress.md` 的 `current_phase:` 行 —— 那时拿不到回合活动时间，判据按「不在上课」处理。🔴 **引擎不接 ① 的话，「课堂进行中不回群」不生效**（见 §8）。
- 首次开场（N3.7）：真源为空 → 先发一条 `kind: "open"` 的消息（失败最多试 2 次，之后不再纠缠，错误留在日志与状态里）。

### 7.6 群里的写死规则（N3.6）

规则不在代码里：`runtime/wechat_group.rules.md` 的文件头（连续 `>` 行）**逐字**进系统提示，抽不到就抛 `NO_GROUP_RULES`。三条由**代码**兜住（`validateSpeech`，命中即 `INVALID_OUTPUT`）：

- 每条不超过 **2 行**；
- 不使用 **emoji**（按 Unicode `Extended_Pictographic` 判，不是人肉清单）；
- `speaker` 只能是已定义人物或 `路人·<称呼>`。

🔴 给群聊/日记/审阅 agent 的提示词里**一律不出现**「会被看到／有读者／面板/未读」——有单测把这几段拼起来做机器检查。

### 7.7 面板（车道 P）接线要点

- 版式用 `templates/wechat-chat.html`；数据只走 `ctx.remote.classroomGroup.*`，**不读** md/jsonl。
- 「对方正在输入」= `poll().typing`；未读数 = `poll()/history()` 的 `unread`，读完后 `markRead(maxSeq)`。
- 长轮询：`poll(afterSeq, 25000)`，服务端可以提前返回。


---

## 8 · N4 · 定时主动消息

一句话：**说什么由模型，什么时候发、该不该发由确定性代码。** 模块是 `lib/proactive.mjs`，由 `ClassroomGroupService.tick()` 每次调度时调用。

### 8.1 时间：只用北京时间（EC）

`lib/time.mjs` 把 epoch 毫秒**加 8 小时**再用 UTC 取值——不读进程时区、不读 ICU、不读系统钟（A 机出过「系统时钟快 8 小时」）。所有 `ts` 写 `+08:00`。窗口 08:00–**23:00 整不发**（左闭右开），每天 1–3 条。

### 8.2 预生成 + 持久队列

- 当天第一次 `tick`（在窗口内、且没过退避）时，**一次模型调用**生成当天的消息（`messages` 数组，条数=当天条数），时间用均匀随机抽在**剩余窗口**里（14:00 才开始就只抽 14:05 之后；剩不到 1 小时只排 1 条）。
- 队列落在 `runtime/.narrative/proactive.json`：`{date, plannedCount, generateAttempts, replacements, sentSinceLastStudent, lastStudentSeq, slots[], voided[], lastError}`。
- 生成后第一条至少等 5 分钟才发（不「刚生成就发」）。
- 页面没开照样发（服务端队列 + 定时器），学生下次打开看到未读。

### 8.3 到点前的确定性检查（N4.3）

只要**生成之后**发生过任一件事，这条就作废，用最新上下文重生成一条：

1. 新的群聊消息（**用 `seq` 判**，不用时间戳——`ts` 只到秒，会把同一秒生成的开场消息误判成新消息，实测踩过）；
2. 上课（引擎报的 `lastActivityAt` ≥ 生成时刻）；
3. 课堂进行中（同上判据）。

作废后若当天还有额度（≤3 条）、还在窗口内、补位次数没用完（≤2 次），就在 `now + 5..30 分钟` 重生成一条。

### 8.4 退避（N4.4，确定性代码）

`sentSinceLastStudent`：发一条主动消息 +1，看到学生的新发言（`seq` 变大）清零。**≥2 就停**（连「到点发」都不做，直接记 `voidReason: "backoff"`），直到学生再说话。

### 8.5 EC：队列损坏、跨天、重启

| 情况 | 行为 |
|---|---|
| 队列文件损坏（不是 JSON / 版本不对） | 丢队列、按今天重建（`actions` 里有 `queue-rebuilt`），**不崩溃** |
| 跨天 | 昨天的槽位（含没发出去的）整份丢弃，按今天重建（`new-day`） |
| 重启时恰好跨过发送时间 | 迟到 ≤ **10 分钟**照发（还是那个时刻）；超过 10 分钟**作废**并（有额度时）重生成一条排在 `now+5..30 分钟`。**不补发**——迟到半小时的「刚看到」读起来像程序在补作业 |
| 生成失败 | 当天最多试 3 次（`generateAttempts`），之后停手；错误留在 `lastError` 与日志里 |


---

## 9 · N5 · 世界观提议

### 9.1 两份文件都只追加（这是本模块最重要的判断）

| 文件 | 谁写 | 内容 |
|---|---|---|
| `world/proposals.md` | 任何 agent（群聊 / 日记 / 课堂老师） | 一条提议：内容、理由、触发它的对话片段 |
| `world/changelog.md` | 审阅器 | 一行一次决定：接受（改了什么）/ 拒绝（为什么）/ 被守卫挡下 |

**「待审」是推导出来的**：提议 id 没出现在 changelog 里 = 还没审。不往提议块里写状态位——那需要读—改—写，两个 agent 同时提、或审阅中途崩掉，就会把别人的块改坏；而推导是幂等的，崩了重跑也安全。

### 9.2 审阅的触发与顺序

- **触发**：`runDiary` 的那一轮跑完（写成功或跳过都算）**顺带**跑一次，不另起调度。没有积压就根本不开这一轮（不写状态、不写日志）。
- **顺序（EC）**：按提议 id 的时间顺序**逐条**处理，每条都**重新读一遍** `characters/` 与 `world/`——所以第 2 条看到的是第 1 条改完之后的世界（有单测断言第二条的输入里出现了第一条写下的文件）。
- **一条提议最多改一个文件**（模型要给 `path` + `content` 完整内容）。
- 失败**不吞**：日记仍然 `ok`，但结果里 `review.ok=false`，并且 `status()` 里留一条 `task: 'review'` 的失败；提议仍算待审，下一轮重试。

### 9.3 🔴 N5.3 的硬约束：代码级守卫（`lib/worldguard.mjs`）

写盘**前**判，命中就拒绝并记日志＋记一行 changelog（不留「静默没做」的状态）：

- **黑名单**（先判）：`materials/`、`runtime/`、`story/`、`tools/`、`curriculum.md`、`knowledge_points.md`、`system_core.md`、`_anchor.md`、`classroom.yaml`、`AGENTS.md`、`CLAUDE.md`。
  `_anchor.md` **整份拒绝**，不做「教学法部分」的段落级解析——按段拆一个混合文件比整份拒绝更容易出错。
- **白名单**（后判）：只允许 `characters/**.md` 与 `world/**.md`；其中 `world/proposals.md` / `world/changelog.md` 是代码维护的日志，模型不许重写。
- 另外：拒绝绝对路径与 `..` 越界；单文件 ≤ 60KB。

为什么不能只靠提示词：提示词是建议，模型可以不听；这是 N5.3 点名的**唯一硬约束**。

### 9.4 changelog 的格式（N5.4「一眼扫完」）

```markdown
| 时间 | 结果 | 改了什么 | 内容与理由 | 来自提议 |
|---|---|---|---|---|
| 2026-10-21 14:24 | 接受 | characters/an.md | 新增角色「岸」：夜班观测员。 | P-20261021T142411-01 |
| 2026-10-21 14:24 | 拒绝 | materials/ch01.md | materials/ 是教学文件（守卫挡下：FORBIDDEN_PATH） | P-20261021T142412-01 |
```

---

## 10 · 引擎接线（本轮不做，交给车道 J）

本包只提供 `narrative` 服务，**没有**改 `plugins/socratic-engine`。接线需要三处：

1. **装载**：引擎 `inject` 里加上 `narrative`（或在钩子里 `ctx.get('narrative')` 判空）。
   群聊服务由本包自己 provide 成 `classroomGroup`，引擎若要在回合里报课堂状态，`inject` 里再加 `classroomGroup`。
2. **收课触发**：在 `classroom_set_phase` 把相位切到 `close` 的那条路径上（`plugins/socratic-engine/lib/phasestore.mjs` 的写入点之后）调
   `narrative.runDiary({ sessionId, classroomDir, lesson: currentLesson, trigger: 'close' })`，**不要 await `done`**。
3. **闲置兜底**：在引擎现有的回合活动记账处（`agent/turn-stopping` 钩子，`lib/postclass.mjs:400` 附近）加一个扫描：
   `if (narrative.isLessonIdleClosed({ studentTurns, lastActivityAt, now }).closed) void narrative.runDiary({ ..., trigger: 'idle' })`。
4. **每回合报课堂状态（N3.4，🔴 不做这条「课堂进行中不回群」就不生效）**：
   在引擎已有的回合活动记账处（`lib/postclass.mjs` 的 `agent/turn-stopping`，与第 3 条同一处）调
   `ctx.classroomGroup.setClassroomActivity({ sessionId, classroomDir: current.dir, phase: current.phase, lastActivityAt: Date.now(), lesson })`。
   `phase` 取引擎内存态的相位（`lib/phasestore.mjs` 的 `get phase`），`lastActivityAt` 用这一回合开始的时间。
5. **群里提的知识题**：本包自己写 `runtime/notes.jsonl`（`group_question`），引擎只需照 K3.4 把它注入下一节课开头即可，**不要**在引擎侧再写一遍。
6. **世界观提议**（N5.1「课堂老师也可以提」）：引擎在教师觉得该加角色/改设定时调
   `ctx.narrative.appendProposal({ classroomDir, origin: '课堂老师', content, reason, quote })`。接线是车道 J 的事，本包只提供方法。
7. **下一节课注入**（N2.4）：`classroom.yaml` 里加一块 `state`/`diary` 注入，内容取
   `await narrative.readRecentDiaries({ classroomDir, limit: 1 })` 的最后一条。频率按 K3.4 的口径写（必须带 `phase:`）。

---

## 11 · 测试

```bash
cd plugins/socratic-narrative
node --test 'test/*.test.mjs'      # 模型全部是替身，不联网、不需要宿主
```

覆盖：

- **N1**：AC 四件事（成功 / 模型报错 / 超时 / 输出格式不合法）、失败分类、路径越界、全新上下文、输入逐字进提示词。
- **N2**：文件头规则抽取、120 字校验（码点计数）、幂等、账本回滚、条目插入位置、最近 N 条读取、课堂记录过滤（坏行跳过），以及 🔒 机器守卫。
- **N3**：北京时间换算、JSONL 真源（seq/id/ts/字段序、clientId 幂等、12 条并发不丢、坏行隔离、投影重画、state 损坏回默认）、群聊规则逐字抽取、发言三条写死规则（行数/emoji/speaker）、去抖合并、课堂进行中不回、收课后补回、首次开场、回复失败重试与 system 说明、`group_question` 落盘（含 kp 核对）、K4 四个方法的返回形状、作用域→教室目录解析。
- **N4**：窗口与抽时间、正常发送、到点前不动、作废重生成（学生发言/上课）、迟到宽限、退避与恢复、跨天、**实例重启后队列恢复**、**队列损坏重建**、生成失败上限、剩不足 1 小时只排 1 条、数组 schema 端到端。
- **N5**：守卫（教学文件/运行记录/越界/日志/非 md/超量）、提议与 changelog 的追加/解析/待审推导、审阅（接受写文件 / 拒绝 / 守卫挡下 / 顺序 / 不重复处理 / 非法决定 / 中文决定 / 模型失败留待下轮）、**日记那一轮顺带审阅**（含日记自己的提议与审阅失败不吞）。

---

## 12 · 已知边界

- **跨进程并发不保护**：同一进程内按文件串行（`lib/serial.mjs`）；两个 DSH 实例指向同一个教室目录时，`diary.md` 的读改写可能互相覆盖。需要的话得引入文件锁（`@deepseek-ai/dsh-atomic-write` 的 `withFileLock`），但那会踩「宿主包不进 profile」的铁律③，所以本轮不做。
- **没有定时器**：本包不起 cron、不扫会话。触发时机由引擎决定（§7）。
- **不写教学事实**：N1 是「把文件读给模型、把结果写进文件」，不做任何课堂总结/改写（项目红线）。
- **`runtime/session_log.md` 整份进提示词**：教室目前是 14 行量级，够用；若长到几十 KB，应由引擎按 K3 的压缩规则先压。
- **`notes.jsonl` 的跨进程 id 序号**：同一秒内、两个进程同时追加时，可能算出同一个序号（撞 id）。引擎追加时也不持锁。真要修得全仓统一一把锁，本轮不做。
- **群聊的「课堂进行中」判据需要引擎报活动时间**：只读 `progress.md` 能拿到相位，但拿不到「最近一次回合活动」。引擎不调 `setClassroomActivity()` 时，判据退化成「不在上课」——上课时她也可能回群（见 §10 第 4 条）。
- **`typing` 在课堂进行中仍是 true**（契约 K4.4 的措辞是「已被排入回复队列」）。要不要在面板上对「被推迟」另作显示，由车道 P 决定。
- **`AGENT_FAILED` 没有覆盖「模型回复失败」**：那件事发生在异步回复里，本包用「发一条 `role:'system'` 的说明 + 运行日志 + `status()`」三条出口让它可见（见 §7.2）。
- **世界观审阅可以整体重写 `characters/` 与 `world/` 下的文件**（两份日志除外）：这是 N5.2 给的范围。教学文件有代码级守卫，演化出来的世界长什么样由 user 在 `changelog.md` 里盯。
