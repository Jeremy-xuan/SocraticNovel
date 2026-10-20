# 取证报告 · S3：headless 多 turn 与「每回合注入一次」去重

> 取证日期：2026-09-23｜实现子代理 S3｜工作区根＝`/Users/wujunjie/Documents/ChatGPT/大学申请`
> 运行时真源：**安装版 dsh 0.1.5-rc.2**（`tmp/dsh-installed/`，244 包）
> 前向对照：上游 master 快照 `tmp/dsh-src-0923/`（commit `46a7f68b09`，2026-09-23 21:03）
> 纪律：每条结论给 **文件路径 ＋ 逐字代码片段 ＋ 解读**；取不到的写「未取证」＋已试检索词，不猜。

---

## 第一部分 · 取证①「headless 能不能跑多 turn」

### 结论（先给答案）

| 问题 | 结论 |
|---|---|
| 安装版 headless 单发模式能跑多 turn 吗？ | 🔴 **不能**。一次进程 = 一次 `agent.followup()` = 一个 turn，然后 `exit`。 |
| 有没有 `--session-id` / `--resume` / `--json` / stdin 连续输入？ | 🔴 **安装版全部没有**（master 快照有 `--session-id` 与 `--json`，见 §1.6）。 |
| 能拿到多 turn 吗？ | ✅ **能**，但不是靠 headless 自带参数——靠 **`--patch` 覆盖 headless bundle 的 runner 行 + 绝对路径 .mjs 插件**，在一个进程内对**同一个 agent** 连发 N 次 `followup`。已实证（§1.5）。 |
| 该用 `socratic-dev` 吗？ | ❌ **不用**。`socratic-dev` 是 **web 形态**（bundle 含 `@deepseek-ai/dsh-web-app`），见 §1.4，有与用户在用 web profile 混淆的风险 → 按 prompt 默认规则排除，只走 `socratic-headless`。 |

---

### 1.1 headless runner：一进程一 turn（逐字证据）

**文件**：`tmp/dsh-installed/dsh-headless/lib/index.js` 第 127–168 行

```js
async function run(ctx, task, io) {
	await ctx.get("loader")?.await();
	const agents = ctx.get("agents");
	const defaultModel = ctx.get("agentDefaultModel");
	const sessions = ctx.get("sessions");
	if (agents === void 0 || defaultModel === void 0 || sessions === void 0) return;
	const selection = defaultModel.currentSelection();
	const { agent } = await agents.create({
		sessionId: brandString(`session-${randomUUID()}`),
		meta: { cwd: process.cwd() },
		agentOptions: { provider: selection.provider, model: selection.model },
		setup: (agentCtx) => { installModelSelection(agentCtx, { current: selection, assembled: void 0 }); }
	});
	await agent.whenIdle();
	const firstSeq = agent.session.seq;
	const stopReasoning = streamReasoning(ctx, agent, io.stderr);
	try {
		agent.followup(createUserMessage({ content: [{ type: "text", text: task }], source: { kind: "user" } }));
		await agent.whenIdle();
	} finally { stopReasoning(); }
	await sessions.flush(agent.session);
	const outcome = summarize(agent.session, firstSeq);
	io.stdout.write(outcome.text + "\n");
	...
	io.exit(outcome.reason?.kind === "completed" ? 0 : 1);
}
```

**解读**：`agents.create({ sessionId: \`session-${randomUUID()}\` })` —— sessionId **由 runner 内部随机生成，外部无法指定**；`followup` 只调用**一次**；随后 `sessions.flush` + `io.exit(...)`。**一进程 = 一 session = 一 turn**。

---

### 1.2 安装版 CLI 面：只有 task 位置参数

**文件**：`tmp/dsh-installed/dsh-headless/lib/startup.js` 第 20–25 行

```js
function headlessCommand() {
	return new Command().name("dsh --profile headless").description("Answer one task, stream reasoning to stderr, print the final assistant message, and exit.").helpOption("-h, --help", "show this help").argument("[task...]", "the task text; multiple words are joined by spaces").addHelpText("after", `
Examples:
  dsh --profile headless "run the tests"     answer one task and exit
`);
}
```
第 34–38 行：
```js
	program.action(() => {
		const task = program.args.join(" ");
		if (task.trim() === "") program.error("error: a task is required, for example: dsh --profile headless \"run the tests\"");
		ctx.provide(HEADLESS_STARTUP_SERVICE, { task });
	});
```

**解读**：命令面只有 `[task...]` 与 `-h/--help`。**没有 `--json`、没有 `--session-id`、没有 `-` 读 stdin、没有 `--resume`**。`task.trim()===""` 即报错 → **空 stdin 直接 usage error，不存在「连续输入多轮」**。

**实跑核验**（零 LLM 花销，只打 help）：
```bash
export DSH_HOME="$HOME/Library/Application Support/dsh-desktop/harness"
export DSH_BIN="/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js"
/opt/homebrew/bin/node "$DSH_BIN" --profile socratic-headless --help
```
**实测输出**（逐字）：
```
Usage: dsh --profile headless [options] [task...]

Answer one task, stream reasoning to stderr, print the final assistant message,
and exit.

Arguments:
  task        the task text; multiple words are joined by spaces

Options:
  -h, --help  show this help
```
→ 安装版**确认**只有 `[task...]`。exit=0。

---

### 1.3 启动器参数面：`--resume` 只是「透传给 app」，而 headless app 不认它

**文件**：`tmp/dsh-installed/dsh/lib/bin.js` 第 8–17 行（模块文档）

```js
/**
 * Commander adapter for the `dsh` command line.
 *
 * The launcher parses only what it owns — which profile to boot, which extra
 * patch overlays to apply, and the config dumps — and hands **everything after
 * its own flags** to the booted tree verbatim, where injected app plugins parse
 * their own flag families and print their own `--help` (see
 * `@deepseek-ai/dsh-cmdline`). Launcher flags therefore come first: the first
 * token this parser does not recognize starts the inner arguments, so
 * `dsh --profile tui --resume abc` boots the tui profile with `--resume abc`,
 * and `dsh --profile web -h` prints the web app's help, not this one's.
 * ...
 */
```

**解读**：`--resume` **不是启动器的 flag**，是留给被启动的 app 自己解析的「inner argument」。启动器 parseDshArgs 只拥有 `--profile / --from-default-profile / --patch / --dump-config / --dump-default-config / web / plugin`。→ 在 headless profile 上加 `--resume` **只会落到那个无参的 commander program 上被拒**。

**旁证·谁真正解析 `--resume`**（检索词：`grep -rn "resume" --include="*.js" tmp/dsh-installed`，逐条回看匹配串）：
- `tmp/dsh-installed/dsh-agent-loop/lib/index.js:1500` —— **`resumeSessionId: z.string()`**，是 **agent-loop 的配置行字段**，不是 CLI flag。
- `dsh-webhook` / `dsh-schedule` / `dsh-api-session-controller` / `dsh-tool-jobs` —— 都是 `agent.followup` 或业务 action，与 CLI 无关。
- **全文没有任何一个 app 的 commander program 声明 `--resume` option**（`dsh-acp-app` 零 option，`dsh-web-app` 只有 `--host/--no-open/--port/--trusted-host`，`dsh-headless` 只有 task）。

---

### 1.4 `socratic-dev` 是什么形态 → **web 形态 → 排除**

**文件**：`$DSH_HOME/profiles/socratic-dev/package.json`（逐字）

```json
{
  "name": "dsh-profile-socratic-dev",
  "dependencies": { "socratic-test": "link:/Users/wujunjie/SocraticNovel-wt/plugins/socratic-test" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "socratic-test"], "patchReload": "live" } }
}
```

**解读**：bundle 第二位是 **`@deepseek-ai/dsh-web-app`** → `socratic-dev` 会**起 web 服务器**。它与用户正在使用的 `web` profile 共享同一套 web-app 代码路径与浏览器信任面，**有混淆风险**。
→ 按 S3 prompt 的默认规则：**不使用 `socratic-dev`**，只在 `socratic-headless` 上做。

> 注：dev 的 `cordis.patch.yml` 当前是空数组 `[]`（即 socratic-test 的 insert 还没写进去），本来也不具备 P1 接线能力。

---

### 1.5 ✅ 实证：多 turn 可以在「同一个进程、同一个 agent」上做到（零 LLM 花销的机制验证）

**机制**：安装版 `--patch` 可以（a）**disable 掉 headless bundle 的 runner 行**，（b）**insert 一个用绝对路径指定的 .mjs 插件**。

**逐字旁证**（`tmp/dsh-installed/cordis-plugin-loader/lib/index.js` 第 352–366 行）：
```js
	/** Import a plugin module from a specifier or `cordis:` builtin. */
	import(name, getOuterStack) {
		if (name.startsWith("cordis:")) return this.ctx.loader.builtins[name.slice(7)];
		return composeError(async (info) => {
			info.offset += 3;
			if (this.ctx.loader.internal) return await this.ctx.loader.internal.import(name, this.ctx.baseUrl, {});
			else if (name.startsWith(".")) return await import(__rewriteRelativeImportExtension(
				/* @vite-ignore */
				new URL(name, this.ctx.baseUrl).href
			));
			else {
				try {
					return await import(__rewriteRelativeImportExtension(/* @vite-ignore */ name));
```

**解读**：非 `cordis:`、非相对路径的 specifier 直接走 **`await import(name)`** → Node 的 ESM 解析器对**绝对路径**（如 `/tmp/probe-driver.mjs`）按 file URL 解析成功。**已单独实证**：`/opt/homebrew/bin/node` 下 `await import('/tmp/t_abs_probe.mjs')` 返回 OK（node v25.9.0；`import.meta.main` 亦为 `true`，说明本机 node 支持该特性——`dsh/lib/bin.js` 末尾就靠它）。

**实跑命令**（零 LLM：插件不创建 agent、只查服务后 `exit(0)`）：
```bash
export DSH_HOME="$HOME/Library/Application Support/dsh-desktop/harness"
export DSH_BIN="/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js"
/opt/homebrew/bin/node "$DSH_BIN" --profile socratic-headless --patch /tmp/probe-patch.yml "probe"
```
其中 `/tmp/probe-patch.yml`：
```yaml
- id: headless-runner
  disabled: true
- insert:
    - id: socratic-probe
      name: /tmp/probe-driver.mjs
```

**实测 stdout/stderr（逐字）**：
```
[probe] appExit=function cmdlineArgs=["probe"]
[probe] service agents = object
[probe] service agentDefaultModel = object
[probe] service sessions = object
[probe] service systemPrompt = object
[probe] service tools = object
[probe] service sessionProjections = object
[exit=0]
```

**解读**：三件事一次性证实——
1. `--patch` 的 **`disabled: true` 按行 id 生效**（`headless-runner` 被关，没有触发它的 `run()`，所以没创建 agent、没有 LLM 调用）；
2. **绝对路径 .mjs 能作为插件加载**（内部 plugin row 的 `name`）；
3. 自建 driver 能用 **`ctx.get('agents'|'agentDefaultModel'|'sessions'|'sessionProjections')`** 拿到 headless runner 用的同一批核心服务，并拿到 `ctx.get('appExit')` 作进程退出。**这正是多 turn driver 所需的全部前置条件。**

---

### 1.6 🔴 前向兼容风险：master 快照已经加了多 turn 所需的东西

**文件**：`tmp/dsh-src-0923/packages/bundle/headless/src/startup.ts` 第 20–25 行起（逐字）

```ts
/**
 * The one-shot app's command-line provider: it parses the task positional,
 * `--session-id`, `--json`, and `--help`, then publishes
 * {@link HEADLESS_STARTUP_SERVICE}.
 * @module @deepseek-ai/dsh-headless/startup
 */
...
export interface HeadlessStartupValues {
  /** The task text this invocation asked for; absent when the runner reads stdin. */
  task: string | undefined
  /** Exact Session identity to adopt; absent for a fresh random identity. */
  sessionId: string | undefined
  /** Whether stdout carries the machine-readable event stream instead of final text. */
  json: boolean
}
```

命令行声明（同文件，第 44–58 行逐字）：
```ts
    .option('--json', 'write newline-delimited run events to stdout instead of the final message')
    .option('--session-id <id>', 'adopt the persisted Session with this id; an unknown id is an error')
    .argument('[task...]', 'the task text; multiple words are joined by spaces, and `-` reads stdin')
    .addHelpText('after', `
Examples:
  dsh --profile headless "run the tests"          answer one task and exit
  echo "run the tests" | dsh --profile headless   read the task from stdin
  dsh --profile headless --json "run the tests"   emit machine-readable run events
  dsh --profile headless --session-id session-… "continue"   resume an existing Session
`)
```

**解读（前向兼容风险）**：master 上 headless **已经补齐**了 `--session-id`（续同一 session）、`--json`（NDJSON 事件流）、`-`（读 stdin）。→ 一旦宿主升级到含该提交的版本，**「同 session 多 turn」将出现一条更省事、无需 patch 的原生通道**：
```bash
dsh --profile headless --session-id <SID> "第 2 轮"     # 第 2 次调用续 same session
```
**但语义与 S3 driver 不同且必须写清**：那是**两次进程**、每次一个 turn，**跨进程 resume**（agent 重建、`turnBoundary` 投影从日志重放得 `lastTurn`）；而 S3 driver 是**一次进程内同一 agent 连发 N 次 followup**。两者对**去重键的要求都是同一套**（`sessionId + turn`），所以 **S3 的 dedup 设计对两条路都成立**；只是集成测试的**驱动方式**将来可以简化。

> ⚠️ **master 的 `--session-id` 明确是 adopt「已持久化」的 session（「an unknown id is an error」）**，不是"自动续上次"。所以它仍属"跨进程 resume"，不是"同进程多轮"。

---

### 1.7 事件流：「同一会话多 turn」vs「多个独立单 turn 会话」怎么区分（用于断言）

**落盘真源**：`$DSH_HOME/sessions/<encoded-cwd>/<sessionId>/session.v3.jsonl.zstd`（zstd 压缩的 JSONL，每行一个事件）。

**同一会话多 turn**：**同一个目录/同一个 `session.id` 下**，`turn/start` 事件**出现 N 次**，其 `data.turn` 依次为 1,2,…,N，且 `turn/end` 与之配对。
**多个独立单 turn 会话**：**不同目录（不同 session id）** 各有 1 个 `turn/start`。

**逐字证据 · turn 号如何分配**（`tmp/dsh-installed/dsh-agent-loop/lib/index.js` 第 919–930 行）：
```js
	async turn() {
		if (this.phase.kind !== "running") this.throwError(/* @__PURE__ */ new Error(`agent "${this.id}": turn without driver reservation`));
		const phase = this.phase;
		const { signal } = phase.abort;
		signal.throwIfAborted();
		const turn = phase.turn + 1;
		try {
			this.session.append("turn/start", { turn });
		} catch (error) { this.throwError(error); }
		phase.turn = turn;
```
**逐字证据 · 跨进程 resume 后 turn 号接着数（不从 1 重来）**（同文件第 765 行）：
```js
		const lastTurn = this.loopCtx.sessionProjections.stateOf(session, "turnBoundary")?.lastTurn ?? 0;
```
配合投影定义（同文件第 1300–1328 行）：
```js
const turnBoundaryProjectionDefinition = {
	key: "turnBoundary",
	stateVersion: 2,
	stateSchema: z$1.object({ openTurnStartSeq: ..., lastStepStartSeq: ..., lastStepBoundary: ..., lastTurn: z$1.number().int().nonnegative() }),
	init: () => ({ openTurnStartSeq: null, lastStepStartSeq: null, lastStepBoundary: null, lastTurn: 0 }),
	apply: (state, event) => {
		switch (event.type) {
			case "turn/start": return { ...state, openTurnStartSeq: event.seq, lastTurn: event.data.turn };
			case "turn/end": return { ...state, openTurnStartSeq: null };
```
**解读**：`lastTurn` 由**持久化投影**从事件日志重放得出 → **resume 后新 turn 号 = 历史最大 turn + 1**，全生命期唯一、单调，**不会在新进程里从 1 重来**。这是把 `turn` 用作去重键的**关键前提**（§2 详述）。

**已实测的既有 session 事件流形状**（S3 亲自解压复核，零 LLM）：
```bash
F="$DSH_HOME/sessions/--private-tmp-snx-probe-ws--/session-5a36f839-3f18-4656-98aa-a461ba42baff/session.v3.jsonl.zstd"
zstd -dc "$F" | python3 -c "..."   # 逐行 json.loads 后 Counter(type)
```
实测结果（**这是 P1 骨架上一轮真实单 turn 会话**）：
```
EVENT COUNTS: {'session': 1, 'permission/preset': 1, 'sandbox/mode': 1, 'approval/policy': 1,
 'agent/inbox/spliced': 2, 'turn/start': 1, 'step/start': 1, 'system/message': 1,
 'user/message': 6, 'request/header': 1, 'request/context': 1, 'session/title': 1,
 'session/title-llm-request': 1, 'assistant/message': 1, 'tool/call': 1,
 'step/end': 1, 'turn/end': 1}

user/message seq=8  source.kind=user               '请调用 classroom_status 工具，并原样报告它返回的内容。'
user/message seq=9  source.kind=agent-instructions '<system-reminder>\nThe following workspac'
user/message seq=10 source.kind=plugin             'Current runtime context. This snapshot s'
user/message seq=11 source.kind=socratic-engine    '<system-reminder>\n# 生成前自查清单（fixture 占位）\n'
user/message seq=12 source.kind=socratic-engine    '<system-reminder>\n当前状态：相位=boot，第 1 回合，教室'
user/message seq=13 source.kind=skill-catalog      '<system-reminder>\nA skill is a reusable '
```
**解读（计数口径就此定死）**：本会话 1 个 turn、1 个 step，`user/message` 共 **6** 条，按 `data.source.kind` 可**精确拆分到来源**：
- `user` 1 条（用户原话）
- `agent-instructions` 1 条（**宿主**注入 AGENTS.md —— 与「已实证事实 1」一致）
- `plugin` 1 条（宿主 runtime context）
- `socratic-engine` **2 条** ← 🔴 **P1 引擎自己注入的 2 块**（与「已实证事实 5」的 4→6 一致）
- `skill-catalog` 1 条（宿主技能目录）

→ **断言口径**：数 `type === 'user/message' && data.source.kind === 'socratic-engine'` 的事件条数。
② **每 turn 注入次数** = 该计数 ÷（该 session 内 `turn/start` 次数），应从「接线前的 2」变成「接线后的 1」。

**为什么必须数事件流而不是数 pre-step 调用**：`user/message` 的落盘**只在 step 的首次 attempt 发生**——
`tmp/dsh-installed/dsh-agent-loop/lib/index.js` 第 1015 / 1028–1029 行逐字：
```js
		let firstAttempt = true;
		while (true) {
			const { config, preparedCall } = await this.prepareRequest(turn, step, signal);
			...
			if (firstAttempt) for (const message of decision.messages) this.session.append("user/message", message, { surfaceOp: "append" });
			firstAttempt = false;
```
**解读**：🔴 **LLM 重试（`llm/retry`）不会重复落 `user/message`** → 事件流天然**不把重试算成二次注入**。这让"每 turn 注入次数"成为一个**对重试免疫**的干净指标。（同时说明：重试路径下 pre-step 只在**该 step 首次进入**时收到 decision 落盘，但**插件被调用的次数**仍可能多于落盘次数——见 §2.5。）

---

## 第二部分 · 取证②「turn 边界与去重键」

### 2.1 ✅ turn 标识可靠：`agent/pre-step` payload 直接带 `turn` 与 `step`

**文件**：`tmp/dsh-installed/dsh-agent-loop/lib/index.js` 第 894–901 行（逐字）

```js
		const decision = await this.dispatch.waterfall("agent/pre-step", {
			messages: claimed,
			...position,
			signal
		}, () => Promise.resolve({
			kind: "enter",
			messages: context === void 0 ? claimed : [...claimed, context]
		}));
```
其中 `position` 来自同文件第 937–940 行（逐字）：
```js
				const step = phase.step + 1;
				const decision = await this.preStep(target, {
					turn,
					step
				});
```
且 `dispatch.waterfall` 会给 payload **注入 `agent`**（`tmp/dsh-installed/dsh-agent/lib/index.js` 第 209–238 行逐字）：
```js
function agentEvents(ctx, agent, carrier = agentCarrier(agent)) {
	const fused = (payload) => ({ ...payload, agent });
	return {
		...
		waterfall(name, payload, ...rest) {
			const waterfall = ctx.waterfall;
			return waterfall(carrier, name, fused(payload), ...rest);
		}
```

**所以 `agent/pre-step` 的 payload 确定性地含**：`{ agent, messages, turn, step, signal }`。

**旁证 · 宿主自家插件就在用这些字段**（检索词：`grep -rn "agent/pre-step" --include="*.js" tmp/dsh-installed`，共 18 处命中，逐条回看解构签名）：
- `dsh-agent-instructions/lib/index.js:1270` → `async ({ agent, messages, step, signal }, next)`（🔴 **宿主注入 AGENTS.md 用的正是 `step === 1` 判定**，见 §2.3）
- `dsh-time-context/lib/index.js:215` → `async ({ agent, turn, step, signal }, next)`
- `dsh-tmux-context/lib/index.js:1510` → `async ({ agent, turn, step, signal }, next)`
- `dsh-hooks-codex/lib/index.js:211` → `async ({ agent, messages, turn, signal }, next)`
- `dsh-hooks-claude-code/lib/index.js:232` → `async ({ agent, messages, turn, signal }, next)`
- `dsh-plan-mode/lib/index.js:151` / `dsh-session-reference/lib/index.js:467` / `dsh-tool-skill/lib/index.js:168,203` / `dsh-compaction-basic/lib/index.js:798` / `dsh-repeat-tool-reminder/lib/index.js:1509` / `dsh-session-checkpoint-policy/lib/index.js:72` → 只用 `{ agent, signal }` 或 `{ agent, messages }`

→ **`turn` 与 `step` 是宿主官方 payload 字段，不是我们的推测。** 这是 S3 dedup 的**首选去重键**。

---

### 2.2 ✅ turn 边界事件齐全：`turn/start` / `turn/end` / `step/start` / `step/end`

**文件**：`tmp/dsh-installed/dsh-agent-loop/lib/index.js` 第 926 / 994–997 / 951–954 / 960–963 行（逐字拼合）

```js
			this.session.append("turn/start", { turn });
...
				this.session.append("turn/end", {
					turn,
					reason: turnEnds
				});
...
				this.session.append("step/start", {
					turn,
					step
				});
...
				this.session.append("step/end", {
					turn,
					step
				});
```

**turn 结束原因（中断/错误/阻塞都在 `turn/end.data.reason`）**——同文件第 941–949、976–1001 行：
```js
				if (decision.kind === "reject") { turnEnds = { kind: "blocked" }; return false; }
				if (turnEnds && decision.messages.length === 0) break;
				if (phase.step === 0 && decision.messages.length === 0) { turnEnds = { kind: "completed" }; return false; }
...
		} catch (error) {
			if (signal.aborted) { turnEnds = { kind: "aborted", reason: signal.reason }; throw error; }
			turnEnds = { kind: "error", error: ... };
```
**解读**：`reason.kind ∈ { completed, blocked, aborted, error, max-tokens }`（`max-tokens` 见第 958 行）。

**turn 结束时的「课后钩子」我方可挂**（同文件第 966–972 行逐字）：
```js
				if (turnEnds && this.inbox.nextStep.length === 0) {
					await this.dispatch.serial("agent/turn-stopping", {
						turn,
						signal
					});
					signal.throwIfAborted();
				}
```
**解读**：`agent/turn-stopping` 是**每个 turn 恰好触发一次**的 serial 事件（B2 课后自动更新可挂这里；S3 只用它来**清理去重状态**）。

---

### 2.3 🔴 现有骨架的 turn 首步判定依据（逐字引用）＋ 其缺陷

**文件**：`开源线/DSH定制/code/plugins/socratic-engine/index.mjs` 第 70–77 行（逐字）

```js
  // ---- 3) 每回合 chat 注入（turn 首步，实测③的模式） ----
  ctx.on('agent/pre-step', async (payload, next) => {
    const isFirstStepOfTurn = payload.step === 1 && payload.messages.length > 0
    if (!isFirstStepOfTurn) return next()

    phase.noteTurnStart()
    const due = planTurnInjections(manifest.blocks, phase, { classroom: manifest.classroom.id })
    if (due.length === 0) return next()
```

**解读（缺陷）**：判定式是 **`payload.step === 1 && payload.messages.length > 0`**——**完全没有用 `payload.turn`**。
- ✅ `payload.step === 1` 对「带工具的 turn 内 3 个 step」确实只放行 1 次（这是实测③已证明的部分）。
- 🔴 **`payload.messages.length > 0` 这个附加条件制造了漏注入**：`step===1` 但该次 **claim 到空批**时会**直接 return `next()`，不注入、也不推进 turn 计数**。什么时候 step===1 却空批？**上一 turn 刚被 `turnEnds` 判定结束、但有 `nextStep` 输入接续**时（第 973–975、1002–1006 行：`target = "next-step"` 且下一轮 `step` 从 `phase.step = 0` 重新从 1 数 → 此时 `claim("next-step", turn)` **不取 next-turn 队列**，可能是空批）。这就是**「同一 turn 内多次 step===1」**的真实来源。
- 🔴 **没有任何跨 turn 去重键**：`phase.noteTurnStart()` 只是**无条件自增计数器**。所以：
  - `step===1` 被触发两次（上一 bullet）→ **同一 turn 计数 +2、注入 ×2**（**双注入**）；
  - `step===1` 但 messages 为空 → **计数 +0、注入 ×0**（**漏注入**，且让 `frequency: n_turns` 的 `turnCount % n` 相位漂移）。

**对照 · 宿主自家在同一位置的写法**（`tmp/dsh-installed/dsh-agent-instructions/lib/index.js` 第 1270–1278 行逐字）：
```js
	ctx.on("agent/pre-step", async ({ agent, messages, step, signal }, next) => {
		const decision = await next();
		await waitForProjections(agent);
		const pending = agent.inbox.nextStep.filter(isWorkspaceContext);
		const desired = await compose(agent, signal, messages, pending);
		signal.throwIfAborted();
		if (decision.kind === "reject" || step === 1 && decision.messages.length === 0) {
			syncInbox(agent, messages, desired);
			return decision;
		}
```
**解读**：宿主用 **`step === 1 && decision.messages.length === 0`**（**下游 decision 的**、即"本 step 真没有内容"）来**抑制**注入，并在该分支里**同步 inbox 而不注入**。注意它用的是 `decision.messages`（`await next()` 之后的**最终装配结果**），而不是**入参 claim** 的 `messages`。这两者不同：入参 claim 可空，但下游（如 runtime context 投影）仍可能追加。→ **骨架用入参 `payload.messages` 判空，与宿主官方用法不一致，属误用。**

---

### 2.4 🔴 「中断后重试」路径：现有判定会不会双注入？

**A. LLM 层重试（`llm/retry`）——不重跑 pre-step，安全。**
`tmp/dsh-installed/dsh-agent-loop/lib/index.js` 第 1015–1017 行（逐字）：
```js
		let firstAttempt = true;
		while (true) {
			const { config, preparedCall } = await this.prepareRequest(turn, step, signal);
```
**解读**：`preStep` 在 `turn()` 里、**循环之外**（第 937 行，每个 step 只调一次）；`step()` 内的 `while(true)` 是 **LLM attempt 重试循环**，它**不会**再触发 `agent/pre-step`。→ **LLM 重试不产生第二次 pre-step，既不双注入也不漏注入。** ✅

**B. turn 被中断（abort）后用户重发——是新 turn，安全。**
中断 → `catch` 里 `turnEnds = { kind:"aborted" }` → `finally` 落 `turn/end` → `kick()` 置 idle。用户再发 → `send(..., wakeup)`（第 783–787 行）：
```js
	send(message, target, wakeup) {
		const wakingAfterAbort = wakeup && this.phase.kind !== "idle" && this.phase.abort.signal.aborted;
		const resolvedTarget = wakingAfterAbort ? "next-turn" : target;
```
**解读**：`aborted` 会被**改投 `next-turn`** → 起**新 turn**（turn 号 +1）→ 去重键 `(sessionId, turn)` 不同 → **正常注入 1 次**。✅

**C. 🔴 真正危险的是「同一 turn 内 step 号回绕」** —— 见 §2.3 的 `target="next-step"` 分支（第 973–975 行）：
```js
				if (turnEnds && this.inbox.nextStep.length === 0) break;
				target = "next-step";
```
配合第 1002–1006 行：
```js
		if (!this.inbox.hasPending) return false;
		phase.abort = new AbortController();
		phase.wakeRequested = false;
		phase.step = 0;
		return true;
```
**解读**：`phase.step = 0` 在**新 turn 开始时**重置（`kick`→`turn()` 入口 `setPhase({step:0})`，第 848 行）——**`step` 是 per-turn 计数器，同一 turn 内 step 单调递增**。所以**在正常 turn 内 `step===1` 理论只出现一次**；§2.3 所说的"step===1 空批"更准确的表述是：**`step===1` 的那一次 claim 可能为空**（`next-turn` 队列为空但 `next-step` 非空时 `target` 仍是 `next-turn`… 属于窄路径）。**无论该窄路径是否真被触发，结论不变**：**旧判定把「是否注入」与「claim 是否非空」耦合在一起，而这两件事在语义上无关** → 空批时漏注入、且计数不推进。**S3 的修复就是把它们解耦：只用 `(sessionId, turn)` 做幂等门，与 messages 是否为空无关。**

> 🔴 **诚实边界**：`target="next-step"` 那条路径**我没有构造出真实会话去复现**（需要中途 `agent.send(msg,"next-step",true)`，属宿主内部 API，未在本任务授权范围内起会话验证）。检索词已试：`grep -n "next-step" dsh-agent-loop/lib/index.js`、`grep -rn "inbox.nextStep" --include="*.js" tmp/dsh-installed`。**上段标「推断/待确认」。** 但**无论该路径成立与否，S3 的 dedup 都是对的**：`(sessionId, turn)` 幂等 ⇒ 任何重复的 `step===1` 都被吸收。

---

### 2.5 🔴 去重键的完整性缺口：`turn` 是「每 agent 每 session」的唯一键，需配 sessionId

`turn` 由 `phase.turn` 自增得出（§1.7），**`phase` 挂在 Agent 实例上**（`this.phase`），而 Agent 绑定一个 Session。→ `turn` **在单个 session 内唯一且单调**，但**跨 session 会撞号**（每个新 session 都从 turn=1 开始）。
**故 S3 的去重键 = `sessionId + turn`**，`sessionId` 取 `agent.session.id`。**已旁证该字段可读**：多种宿主代码用 `agent.session.id`（如 `dsh-headless/lib/index.js:135` 的 `brandString(\`session-${randomUUID()}\`)` 注入后由 session 持有；`dsh-agent-loop/lib/index.js:311` 的 `isOwned` 判定亦基于 session 归属）。

> 检索词已试：`grep -rn "session.id" --include="*.js" tmp/dsh-installed | head`；`grep -n "get id()" dsh-session/lib/index.js`。

**退化策略（拿不到 `turn` 或 `sessionId` 时）**：见 `lib/dedup.mjs` 顶部注释与 `test/dedup.test.mjs` 的退化用例。摘要：退化为**「按 session 顺序、只在 `step===1` 时推进的单调闸」**＋**不落 `turn` 只落「已放行次数」**——语义弱化为"每 step-1 至多一次"，**失去跨 turn 幂等保证**，须标风险。

---

## 第三部分 · S3 实测结果（多 turn 已跑通 ＋ 多 step 缺口）

### 3.1 多 turn 驱动：**已跑通**（同一进程、同一 agent、同一 session）

驱动方式见 §1.5；实测三条命令（**全部在 `socratic-headless` + `--patch` 临时生效，不写任何 profile 文件**）：

```bash
export DSH_HOME="$HOME/Library/Application Support/dsh-desktop/harness"
export DSH_BIN="/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js"
cd 开源线/DSH定制/code/plugins/socratic-engine

# ① 零 LLM 的机制验证（classroomDir 置空 → P1 空转，driver 仍跑 2 turn）
TURNS=2 SOCRATIC_CLASSROOM_DIR=/tmp/snx-empty-classroom \
  /opt/homebrew/bin/node test/integration/multiturn.mjs

# ② 真实 fixture、2 turn（会调用 LLM）
TURNS=2 /opt/homebrew/bin/node test/integration/multiturn.mjs

# ③ 走工具型 turn（每个 turn 出现 ≥2 个 step）——才能把去重门压到极限
TURNS=2 PROMPT_STYLE=tools /opt/homebrew/bin/node test/integration/multiturn.mjs
```

**实测输出（②的落盘真相，逐字）**：
```
[multiturn] SUMMARY {"turns":2,"turnStarts":[1,2],"injections":4,"perTurn":{"1":2,"2":2}}
[multiturn] 落盘真相：turn/start=[1,2]
[multiturn] 落盘真相：每 turn 的 step 数={"1":1,"2":1}
[multiturn] 落盘真相：socratic-engine 注入 4 条 →
  [{"turn":1,"block":"anchor","seq":10},{"turn":1,"block":"state-brief","seq":11},
   {"turn":2,"block":"anchor","seq":25},{"turn":2,"block":"state-brief","seq":26}]
✔ 落盘 turn 数 = 请求轮数 — got 2
✔ turn 号连续自 1 起（同一会话多 turn 的判据） — [1,2]
✔ 🔴 无 (turn, block) 重复注入（去重核心断言） — 每个 (turn, block) 恰好 1 条
✔ turn 1 注入块集合 = manifest 计划 — ["anchor","state-brief"]
✔ turn 2 注入块集合 = manifest 计划 — ["anchor","state-brief"]
✔ n_turns 块只在其倍数的 turn 出现 — 块 knowledge-anchor 均合规
✔ 相位门块在 boot 相位不注入 — []
共 12 项断言，通过 12，失败 0
```

**解读**：
- ✅ **多 turn 确实跑通了**：同一 session 内 `turn/start = [1,2]`，turn 号连续自 1 起。这是 S3 要的「真能跑多 turn」。
- ✅ `(turn, block)` **无重复**；且**每 turn 注入 2 条是正常的**——本 fixture 的 `classroom.yaml` 有 **2 个** `every: turn` 且无相位门拦截的块（`anchor`、`state-brief`）。🔴 **"每回合注入一次"指的是「每回合每块一次」，不是「每回合总共只有一条消息」**；把这个混起来会把正常行为误判成双注入。
- ✅ `n_turns: 3` 的 `knowledge-anchor` 在 turn 1/2 **均未**出现（它在 turn 3 才该出现）→ 频率语义正确。
- ✅ 相位门生效：`quiz-rules`（`phase.phases: [quiz]`）在 `boot` 相位**未注入**。

### 3.2 🔴 诚实缺口：本次运行**没有真正走到「一个 turn 多个 step」**

**证据（逐字）**：上面 ② 的落盘真相显示 `每 turn 的 step 数={"1":1,"2":1}` —— **每个 turn 只有 1 个 step**。
另核 S3 此前用「关掉 P1、2 轮纯对话」跑的那次，同样 `1 个 step/turn`。

**这意味着什么（不夸大）**：
- 「每 turn 注入一次」在**多 turn**意义上已被真实验证（turn 1 与 turn 2 各注入正确集合，无跨 turn 重复/遗漏）；
- 但**「一个 turn 内多个 step 只放行一次」这条路径，本次集成运行并未压到**——因为纯对话 prompt 不触发工具，turn 里只有 1 个 step，`agent/pre-step` 只被调 1 次，去重门与旧判定的差别**在这个场景下测不出来**。
- 该路径目前**只由纯逻辑单测覆盖**（`test/dedup.test.mjs` 用例 ① 构造了 step=1,2,3）；**集成层尚未覆盖**。
- 🔴 **已知事实 2（「带工具的 turn 内 3 步＝3 次 pre-step」）不因此被推翻**——它来自主代理此前的实测；S3 这次只是**没复现**该场景，故按纪律记为「本次未复现」，**不写成「该事实不成立」**。

**补救路径（已写进脚本，待有预算时执行）**：
`PROMPT_STYLE=tools` 会把每轮 prompt 换成「先用 bash 跑 `echo one`，再简短回答」，使 turn 内出现工具调用 → ≥2 个 step。
脚本在该模式下会**强制断言**「确实出现了多 step 的 turn」（`🔴 本运行真的产生了「一个 turn 多个 step」`），一旦没有多 step 就**判失败**——避免再把弱证据当强证据。
**S3 未执行该模式**（受任务书「最多跑 3 次短会话」的额度约束，已用完：1 次无引擎 2 轮 + 1 次有引擎 2 轮 + 2 次干跑/空教室）。**留给集成代理或主代理**。

---

## 第四部分 · 待确认清单

1. **`target="next-step"` 的空批路径是否真会把 `step===1` 触发两次** —— 未构造真实会话复现（需宿主内部 API `agent.send(msg,"next-step",true)`）。**推断/待确认**；不影响 S3 dedup 正确性（`(sessionId,turn)` 幂等吸收重复）。
2. **`dsh-agent-loop` 的 `config.agents[].resumeSessionId`** 是**配置行**能力（§1.3）：能否通过 `--patch` 给 headless profile 的 agent-loop 行塞一个 `resumeSessionId`，从而"零插件"获得跨进程续接？**未实测**（会消耗 LLM 花销，且 S3 已有可行 driver）。**待确认**，供主代理决定是否探索。
3. **master 的 `--session-id` 何时进安装版** —— 无公开 release 时间表。**待确认**；一旦进版，集成测试驱动可简化（§1.6）。
4. `session.v3.jsonl.zstd` 是当前格式；宿主升级若换 v4，集成脚本的**解压与事件定位逻辑需同步**（脚本已把格式探测写成分支+显式报错，见 `multiturn.mjs`）。

---

## 第五部分 · 前向兼容风险总表（对照 `tmp/dsh-src-0923/`）

| 我依赖的事实 | 安装版 0.1.5-rc.2 | master `46a7f68b09` | 风险 |
|---|---|---|---|
| `agent/pre-step` payload 含 `turn`/`step` | ✅（`dsh-agent-loop/lib/index.js:894,937`） | ✅ 同一实现 | 低 |
| `turn/start`·`turn/end`·`step/start`·`step/end` 事件 | ✅ | ✅ `json-stream.ts` 逐条 switch 这些类型，**公开投影契约** | 低（**已进公开 JSON 契约 = 更稳**） |
| `user/message` 仅在 firstAttempt 落盘 | ✅（`:1015,1028`） | ✅（执行点相同：`json-stream.ts` 注释「A retried attempt has no committed message」印证） | 低 |
| `turnBoundary` 投影 `lastTurn` 跨 resume 续号 | ✅（`:765,1300`） | ✅ | 低 |
| `agent/turn-stopping` 每 turn 一次 | ✅（`:967`） | ✅ | 低 |
| **headless 只有 `[task...]`** | ✅ | 🔴 **已加 `--json`/`--session-id`/`-`stdin** | 🔴 **中**：升级后集成测试驱动方式可简化；S3 driver 的 `--patch` 方式**仍可用但非唯一** |
| 绝对路径 .mjs 作插件 name | ✅（loader `:352-366`） | ✅ 同实现 | 低 |
| `--patch` 的 `disabled: true` 按 id 关行 | ✅（实测 §1.5） | ✅ | 低 |
