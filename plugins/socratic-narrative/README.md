# socratic-narrative · 叙事层地基（车道 N）

开发文档第 3 波的 N1 / N2：**独立上下文 agent 运行器** 与 **日记**。

- **N1**：`lib/runner.mjs` —— 「读文件 → 调模型 → 结构化结果 → 写文件」，每次运行一个全新上下文，异步、不进学生会话列表、失败大声。
- **N2**：`lib/diary.mjs` —— 在 N1 之上：收集本节记录 + 她最近三条日记 + 角色卡 + 角色声音段 + 世界设定 + 最近群聊，写一条日记（≤120 字），按「会话 + 讲次」幂等。

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
| `runtime/.narrative/agent-runs.jsonl` | 运行器 | 运行日志：一行一次运行，成功/失败/跳过都记，跨重启可查 |

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

## 7 · 引擎接线（本轮不做，交给车道 J）

本包只提供 `narrative` 服务，**没有**改 `plugins/socratic-engine`。接线需要三处：

1. **装载**：引擎 `inject` 里加上 `narrative`（或在钩子里 `ctx.get('narrative')` 判空）。
2. **收课触发**：在 `classroom_set_phase` 把相位切到 `close` 的那条路径上（`plugins/socratic-engine/lib/phasestore.mjs` 的写入点之后）调
   `narrative.runDiary({ sessionId, classroomDir, lesson: currentLesson, trigger: 'close' })`，**不要 await `done`**。
3. **闲置兜底**：在引擎现有的回合活动记账处（`agent/turn-stopping` 钩子，`lib/postclass.mjs:400` 附近）加一个扫描：
   `if (narrative.isLessonIdleClosed({ studentTurns, lastActivityAt, now }).closed) void narrative.runDiary({ ..., trigger: 'idle' })`。
4. **下一节课注入**（N2.4）：`classroom.yaml` 里加一块 `state`/`diary` 注入，内容取
   `await narrative.readRecentDiaries({ classroomDir, limit: 1 })` 的最后一条。频率按 K3.4 的口径写（必须带 `phase:`）。

---

## 8 · 测试

```bash
cd plugins/socratic-narrative
node --test 'test/*.test.mjs'      # 55 项，模型全部是替身，不联网、不需要宿主
```

覆盖 N1 的 AC 四件事（成功 / 模型报错 / 超时 / 输出格式不合法）＋ 失败分类、路径越界、全新上下文、输入逐字进提示词；N2 的文件头规则抽取、120 字校验（含码点计数）、幂等、账本回滚、条目插入位置、最近 N 条读取、课堂记录过滤（坏行跳过）；以及那条 🔒 机器守卫。

---

## 9 · 已知边界

- **跨进程并发不保护**：同一进程内按文件串行（`lib/serial.mjs`）；两个 DSH 实例指向同一个教室目录时，`diary.md` 的读改写可能互相覆盖。需要的话得引入文件锁（`@deepseek-ai/dsh-atomic-write` 的 `withFileLock`），但那会踩「宿主包不进 profile」的铁律③，所以本轮不做。
- **没有定时器**：本包不起 cron、不扫会话。触发时机由引擎决定（§7）。
- **不写教学事实**：N1 是「把文件读给模型、把结果写进文件」，不做任何课堂总结/改写（项目红线）。
- **`runtime/session_log.md` 整份进提示词**：教室目前是 14 行量级，够用；若长到几十 KB，应由引擎按 K3 的压缩规则先压。
