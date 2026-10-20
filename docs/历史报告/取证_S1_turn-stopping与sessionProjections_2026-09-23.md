# 取证 S1：turn 结束类 hook 与 sessionProjections（课后自动更新 runtime/ 的前置取证）

> 取证者：子代理 S1（P1 教学引擎 · 课后更新能力）
> 时间：2026-09-23
> 运行时真源：`tmp/dsh-installed/`（安装版 dsh 0.1.5-rc.2）
> 前向兼容对照：`tmp/dsh-src-0923/`（master commit 46a7f68b09）
> 纪律：每条给 **文件路径 ＋ 逐字代码片段 ＋ 解读**；取不到写「未取证」并列出已试检索式。**不猜。**

---

## (a) turn 结束类 hook：`agent/turn-stopping`

### 结论：**存在**，且是唯一的「turn 自然停止边界」awaited hook。

#### a-1 触发点（运行时真源）

文件：`tmp/dsh-installed/dsh-agent-loop/lib/index.js`（第 947–975 行附近，`AgentLoop.turn()`）

```js
				signal.throwIfAborted();
				if (turnEnds && this.inbox.nextStep.length === 0) {
					await this.dispatch.serial("agent/turn-stopping", {
						turn,
						signal
					});
					signal.throwIfAborted();
				}
				if (turnEnds && this.inbox.nextStep.length === 0) break;
				target = "next-step";
```

**解读**：
- 触发时机＝**本 turn 已经决定停止、且 inbox 无待续步**时（即 `step/end` 之后、`turn/end` 之前）。**不是**每个 step，而是每个 turn 一次。
- 派发方式＝`dispatch.serial`（**串行 await**，监听器按注册顺序依次被 await）。因此**回调里可以 await 异步 IO**（写文件没问题）。
- 它处于 `try` 块内、`turn/end` 之前；`turn/end` 在 `finally` 里追加（同一函数后段）：

```js
		} finally {
			try {
				this.session.append("turn/end", {
					turn,
					reason: turnEnds
				});
			} catch (error) {
				this.throwError(error);
			}
		}
```
  → 所以 **turn-stopping 里本 turn 的 `user/message`、`assistant/message`、`tool/result` 已经全部 append 进 session log**（它们在 `step()` 里 append，早于 `turn-stopping`）。这是「课后更新」能拿到本回合事实的前提。
- ⚠️ 同一段还有 `signal.throwIfAborted()` 紧跟其后 → **监听器被 abort 会打断 turn**。因此实现里不得抛出、不得长阻塞。

#### a-2 回调签名（payload 形状）

文件：`tmp/dsh-installed/dsh-tool-cordis/lib/index.js` 第 5072–5074 行（宿主自带的 cordis 工具面**签名表**，逐字）：

```js
		name: "agent/turn-stopping",
		...
		signature: "'agent/turn-stopping'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; signal: AbortSignal }): Promise<void> | void",
```

**解读**：payload 只有三个字段 —— `agent`、`turn`（本回合序号）、`signal`。**没有** `messages`、没有 `step`、没有工具结果。
- `agent` 字段是 `agentEvents()` 融合进去的（见 a-4），监听器可直接用 `payload.agent`。
- 返回值：`void | Promise<void>`（**通知型，不是 waterfall**，无 `next`，不能改决策）。

#### a-3 真实监听器写法（宿主内既有消费者，逐字）

文件：`tmp/dsh-installed/dsh-hooks-codex/lib/index.js` 第 272 行：

```js
	ctx.on("agent/turn-stopping", async ({ agent, turn, signal }) => {
```

文件：`tmp/dsh-installed/dsh-hooks-claude-code/lib/index.js` 第 292 行：

```js
	ctx.on("agent/turn-stopping", async ({ agent, turn, signal }) => {
```

**解读**：`ctx.on('agent/turn-stopping', async (payload) => {...})` 就是规范写法，**没有 `next` 参数**（区别于 `agent/pre-step` 的 waterfall）。与骨架里 `agent/pre-step` 的 `async (payload, next) => {}` 形状不同，集成时不要照抄 pre-step 的签名。

#### a-4 payload 里的 `agent` 从哪来（scope carrier 融合）

文件：`tmp/dsh-installed/dsh-agent/lib/index.js` 第 209–234 行：

```js
function agentEvents(ctx, agent, carrier = agentCarrier(agent)) {
	const fused = (payload) => ({
		...payload,
		agent
	});
	return {
		emit(name, payload) {
			const args = [
				carrier,
				name,
				fused(payload)
			];
			...
		},
		async serial(name, payload) {
			const serial = ctx.serial;
			return await serial(carrier, name, fused(payload));
		},
		waterfall(name, payload, ...rest) {
			const waterfall = ctx.waterfall;
			return waterfall(carrier, name, fused(payload), ...rest);
		}
	};
}
```

文件：`tmp/dsh-installed/dsh-agent-loop/lib/index.js` 第 760 行：

```js
		this.dispatch = agentEvents(loopCtx, this);
```

**解读**：loop driver 用 `agentEvents(loopCtx, this)` 建融合派发器，`serial()` 会把 `agent` 塞进 payload。所以 turn-stopping 的 `{turn, signal}` 到监听器手上变成 `{turn, signal, agent}`。

#### a-5 是否有 `turn-stopped` / `turn-end` / session 级事件？

**检索式**（已试）：`grep -rln "turn-stopping" tmp/dsh-installed/`；`grep -rn "turn-stopped\|turn-end" tmp/dsh-installed/`。
**未取证**：在 `tmp/dsh-installed/` 中**未发现** `agent/turn-stopped`、`agent/turn-end` 这两个事件名。存在的对应物是 **持久 session 事件** `turn/end`（`this.session.append("turn/end", {turn, reason})`），它不是 `ctx.on` 的 hook 名，而是 session log 事件；监听需走 `ctx.on('session/event', (session, event) => ...)`。

**权威枚举**：`tmp/dsh-installed/dsh-scope/lib/invariant.js` 第 8–36 行的 `scopedSubjectResolvers` 是**宿主自带的、生成的** agent-scoped 事件全集（逐字，节选）：

```js
const scopedSubjectResolvers = Object.freeze({
	"agent/assistant-stream": (args) => args[0]["agent"],
	"agent/created": (args) => args[0]["agent"],
	"agent/disposed": (args) => args[0]["agent"],
	"agent/error": (args) => args[0]["agent"],
	"agent/inbox/claimed": (args) => args[0]["agent"],
	"agent/inbox/discarded": (args) => args[0]["agent"],
	"agent/inbox/inserted": (args) => args[0]["agent"],
	"agent/pre-step": (args) => args[0]["agent"],
	"agent/request": (args) => args[0]["agent"],
	"agent/request-error": (args) => args[0]["agent"],
	"agent/session-start": (args) => args[0]["agent"],
	"agent/status": (args) => args[0]["agent"],
	"agent/turn-stopping": (args) => args[0]["agent"],
	"approval/request": (args) => args[0]["agent"],
	"goal/changed": (args) => args[0]["agent"],
	"session/created": null,
	"session/disposed": null,
	"session/event": null,
	"session/flush": null,
	"subagent/end": null,
	"subagent/start": null,
	"system-prompt/assemble": (args) => args[1]["scope"],
	"tools/execute": (args) => args[0]["agent"],
	"tools/post-execute": (args) => args[0]["agent"],
	"tools/pre-execute": (args) => args[0]["agent"],
	"tools/ptc-dispatch-log": (args) => args[0]["agent"],
	"tools/result": (args) => args[0]["agent"],
	"user-questions/request": (args) => args[0]["agent"]
});
```

**解读**：agent 域里与「回合结束」相关的**只有 `agent/turn-stopping` 一个**。session 域另有 `session/event`（每提交一个持久事件触发一次，`(session, event)`）与 `session/flush`。`session/event` 是**另一条可选路径**（能在 `turn/end` 事件本身被追加时收到通知），但它对每个事件都触发、且需要自己判 `event.type === 'turn/end'`；本实现选 `turn-stopping`，因为它语义明确、awaitable、且早于 `turn/end`（早写不会漏本 turn 内容）。

#### a-6 设计权威（master 快照内的设计笔记，中文原件）

文件：`tmp/dsh-src-0923/.agents/notes/implemented/feature/2026-06-30-interception-extension-points.zh.md`

> **`agent/turn-stopping`** 是自然停止边界上的一次 awaited 通知。需要再执行一步的监听器调用 `agent.steer()`，传入来源显式的 steering（中途引导）内容供模型使用；循环随后重新读取 outbox，继续执行或关闭轮次。

文件：`tmp/dsh-src-0923/.agents/notes/implemented/architecture/2026-06-30-event-domain-semantics.zh.md`

> **`agent/*`——运行时实时表面。** 始终携带活的 `Agent`。拦截 waterfall（`agent/pre-step`、`agent/request`、`agent/request-error`）负责变换、拒绝或恢复；awaited `agent/turn-stopping` 观察停止边界；……轮次和步骤边界不在此处——它们是从 `session/event` 读取的持久 Session event

**解读（重要边界）**：官方明确「**turn/step 边界不是 agent 事件，而是持久 session event**」。→ 想拿 `turn/end`、`step/end` 这类边界事实，正确来源是 `session.log`/`session.snapshotEvents()`，**不是** agent hook。这直接决定了 (b) 的读法。

#### a-7 turn 内异常/中断时的行为

文件：`tmp/dsh-src-0923/.agents/notes/implemented/architecture/2026-07-16-explicit-turn-cancellation.zh.md`

> AgentLoop 为每个待启动轮次私有地持有一个 `TurnCancellation`。它在通知 `agent/status = running` 前安装该持有者，使其中唯一的 `AbortController` 持续覆盖 inbox 领取、`agent/pre-step`、提示词组装、每个步骤、模型与工具执行以及 `agent/turn-stopping`；随后在发布 `turn/end` 前立即清除所安装的那个持有者。

**解读**：`signal` 覆盖到 turn-stopping 为止。中断的 turn 也会走 turn-stopping 吗？看代码：`turn-stopping` 在 `while(true)` 内的正常路径上派发；`catch (error)` 分支**直接跳到 `finally`**（不派发 turn-stopping）。→ **被 abort/报错的 turn 不会触发 turn-stopping**。所以「幂等 + 半截行防护」不能只靠「turn-stopping 只来一次」这个假设，仍须写前读＋去重键（见实现）。

---

## (b) `ctx.sessionProjections` 的确切形状

### 结论：**它不是消息列表的读口**。它是「按键注册的纯 fold 状态单元注册表」，读出来的是**你自己定义的 key 的状态**，不是消息。

文件：`tmp/dsh-installed/dsh-session-projection/lib/index.js` 第 20–48 行（模块头注释，逐字）：

```js
/**
* Service Definition and drive registry for the session-projection capability seam: the merge-extensible state and client-view type
* tables, the `ProjectionDefinition` state-driven computation unit contract,
* and the `ctx.sessionProjections` registry that DRIVES every registered unit
* forward eagerly over committed session events. Domain host plugins
* contribute pure folds and optional client views; the framework owns the
* subscription, the per-session watermark cache, and change notification;
* carriers consume the snapshot read face and the change feed. Neither side
* knows the other
...
* Whole-value event rule (load-bearing): a state-carrying log event MUST
* carry the complete post-change state, never a bare delta — it keeps every
* unit's transition trivially cheap and every served value self-describing.
```

读 API（同文件，第 105–140 行，逐字）：

```js
	/**
	* Read one unit's current host state after materializing every registered
	* unit at the Session cursor. Unrelated wire views are not produced.
	* The returned value is live; callers must not mutate it.
	* @param session - the session whose state is read.
	* @param key - the registered unit key.
	* @returns current state, or `undefined` when the key is not registered.
	*/
	stateOf(session, key) {
		const registration = this.registrations.get(key);
		if (registration === void 0) return void 0;
		this.materializeCells(session);
		return this.cellFor(registration, session).state;
	}
```

**解读**：
- `ctx.sessionProjections.stateOf(session, key)` → **同步**读取（无 `await`）。
- `stateOf(session, <未注册的 key>)` → 返回 `undefined`（**不抛**，可安全探测）。
- 要拿到**消息**，`sessionProjections` 帮不上忙——除非自己注册一个 key 并用 `apply(state, event)` 自己 fold 消息。**本实现不走这条路**（引入自注册的持久状态＝超出「只追加 runtime/ 文件」的范围，且另一个代理在做相位持久化）。
- 既有消费者范例（逐字）：`tmp/dsh-installed/dsh-terminal-bash/lib/index.js` 第 869 行 `const currentMode = state.sessionProjections.stateOf(session, "sandboxMode") ?? null ?? ...`；`dsh-llm-retry/lib/index.js` 第 162 行 `ctx.sessionProjections.stateOf(agent.session, "llmRetry")[...]`。
- 注册是 effect（随调用方 fiber 卸载而消失）：
```js
	register(definition) {
		...
		const dispose = this.ctx.effect(function* () { ... }.bind(this), "sessionProjections.register()");
		return () => void dispose();
	}
```

### b-2 真正能读「本回合全部消息」的接口：`Session` 对象

`agent.session` 是 Session 实例。可用读口（文件：`tmp/dsh-installed/dsh-session/lib/index.js`）：

**① `deriveMessages()`** —— 第 1255–1286 行（逐字节选）：

```js
	* CACHED: each surface node is projected exactly once, when first seen — a
	* call costs O(new nodes), and a surface rewrite (a `replace`;
	* {@link SessionSurface.replaceGeneration}) rebuilds. The returned array is
	* a fresh snapshot per call (later appends never grow an array a caller
	* already holds); the `Message` objects in it are SHARED and **deep-frozen**.
	* Their content reuses the already frozen durable event data, so the cache
	* needs no second deep clone and consumers still cannot mutate the log.
	* @returns a fresh array of the shared, frozen derived history.
	*/
	deriveMessages() {
		const surface = this.surface;
		const nodes = surface.nodes;
		const generation = surface.replaceGeneration;
		if (generation !== this.derivedGeneration) {
			this.derived = [];
			this.derivedNodes = 0;
			this.derivedGeneration = generation;
		}
		for (const seq of nodes.slice(this.derivedNodes)) {
			const msg = this.deriveEventMessage(this.log[seq]);
			if (msg) this.derived.push(msg);
		}
		this.derivedNodes = nodes.length;
		return [...this.derived];
	}
```

- **同步**、返回**新数组**、元素是**深冻结**的 Message。
- ⚠️ **但它是「模型可见表面」**，不含 `turn` 字段 → **无法据此判定「哪条属于本回合」**。且它刻意 shadow 被替换的区间（注释明说它不是 human transcript 的正确来源）。

**② `snapshotEvents(fromSeq, toSeqExclusive)`** —— 第 1098–1113 行（逐字）：

```js
	/**
	* Materialize an immutable snapshot of a half-open event sequence range.
	* A full current snapshot is reused until the next append; every previously
	* returned snapshot remains stable after later appends.
	* @param fromSeq - non-negative inclusive sequence number; defaults to the log start.
	* @param toSeqExclusive - non-negative exclusive sequence number; defaults to the current end.
	* @returns a frozen array of the selected deeply frozen events.
	*/
	snapshotEvents(fromSeq = SessionLogOffset(0), toSeqExclusive = this.seq) {
		if (fromSeq === 0 && toSeqExclusive === this.log.length) {
			this.eventsSnapshot ??= Object.freeze([...this.log]);
			return this.eventsSnapshot;
		}
		return Object.freeze(this.log.slice(fromSeq, toSeqExclusive));
	}
```

**③ `ownEvents()`**（第 1114–1120 行）：`return this.snapshotEvents(this.inheritedEventCount)` —— 只取本会话自有事件（排除 fork 继承前缀）。
**④ `eventAt(seq)`**（第 1095 行）：`return this.log[seq]`。
**⑤ `get seq()`**（第 1124 行）：`return SessionLogOffset(this.log.length)` —— 下一个事件的序号。

**🔴 关键结论**：**「本回合全部消息」= 从 `snapshotEvents()` 里按 `event.data.turn === 本turn` 过滤**。这是唯一能可靠切出「本回合」的路径，因为 turn 号只存在于持久事件里（见 a-6 官方说明）。

事件类型与字段形状（文件：`tmp/dsh-installed/dsh-session/lib/types/surface.js`，第 12–18 行逐字）：

```js
/** Runtime counterpart of the message-producing event union. */
const SURFACE_EVENT_TYPES = new Set([
    'system/message',
    'user/message',
    'assistant/message',
    'tool/result',
]);
```

事件封装形状（同文件第 78–113 行 `deriveEventMessage`，逐字）：

```js
export function deriveEventMessage(event) {
    switch (event.type) {
        case 'user/message': {
            return event.data;
        }
        case 'system/message':
        case 'assistant/message': {
            if (event.data.message.content.length === 0)
                return null;
            return event.data.message;
        }
        case 'tool/result': {
            return event.data.message;
        }
        default:
            return null;
    }
}
```

**解读**：
- `user/message` 的 `event.data` **本身就是 Message**（含 `role`/`content`/`source`）。
- `assistant/message` / `system/message` 是 `event.data.message`。
- `tool/result` 是 `event.data.message`（工具结果被投影成一条 message）。
- 这四个类型之外的事件（`turn/start`、`step/start`、`step/end`、`turn/end`、`request/header`…）投影为 `null`，但**仍带 turn 号**（见 agent-loop 的 `this.session.append("turn/start", {turn})`、`append("step/start", {turn, step})`）。

**工具调用名与结果的取法**：`turn-stopping` payload **不给工具结果**。两条路：
1. `ctx.on('tools/result', ...)` —— agent-scoped，同步通知型（`tmp/dsh-installed/dsh-scope/lib/invariant.js` 第 33 行有该事件名）；这是**观察工具结果的官方口**（设计笔记：「`tools/result` 是在所有变换、无损 JSON 实体化和外层错误边界之后的同步且故障受控的通知。它接收相同的冻结执行身份和权威结果的不可变快照」）。
2. 从 `snapshotEvents()` 里取 `event.type === 'tool/result'` 且 `event.data.turn === 本turn` 的事件，读 `event.data.message`。

**本实现取路 2**（理由：单点、无额外订阅生命周期、与 turn 号过滤天然一致；且路 1 需要在插件级维护跨 turn 缓冲）。

**快照/冻结语义**：`snapshotEvents` 返回 `Object.freeze` 的数组、元素深冻结；`deriveMessages` 返回新数组但 Message 共享且深冻结。→ **实现里不得原地修改**，一律只读复制。

---

## (c) 写文件的可用手段

### c-1 宿主提供原子写包 `@deepseek-ai/dsh-atomic-write`（**已确认存在**）

文件：`tmp/dsh-installed/dsh-atomic-write/package.json`（逐字）：

```json
{
  "name": "@deepseek-ai/dsh-atomic-write",
  "description": "Zero-dependency atomic file replacement: exclusive-create random-suffix temp + rename carrying the caller-stated permissions (writeFileAtomic)",
  "version": "0.1.5-rc.2",
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" }, ... }
}
```

API（文件：`tmp/dsh-installed/dsh-atomic-write/lib/index.js`，第 8–18 行模块头 + 第 60–78 行实现，逐字）：

```js
/**
* Zero-dependency atomic file replacement and writer coordination.
* `writeFileAtomic` writes a random-suffix sibling with exclusive create and
* the caller's permission bits, then renames it over the target, so readers
* observe either the old or the new complete content and a replaced file ends
* up with exactly the stated mode. `withFileLock` serializes cross-process
* writers of one file through a `wx`-created `<file>.lock` sibling, so a
* read-modify-write cycle can never resurrect a state another writer just
* replaced; readers stay lock-free because the rename commit is atomic.
* @module @deepseek-ai/dsh-atomic-write
*/
```

```js
async function writeFileAtomic(filename, content, options) {
	await mkdir(dirname(filename), {
		recursive: true,
		...options.dirMode === void 0 ? {} : { mode: options.dirMode }
	});
	const temp = `${filename}.${randomBytes(6).toString("hex")}.tmp`;
	try {
		await writeFile(temp, content, {
			mode: options.mode,
			flag: "wx"
		});
		await renameAtomicTemp(temp, filename);
	} catch (error) {
		await rm(temp, { force: true });
		throw error;
	}
}
```

**解读（对本任务的决定性）**：
- `writeFileAtomic(filename, content, options)` 需要 `options.mode`（权限位，如 `0o600`）；会**自动 mkdir -p 父目录**；写随机后缀临时文件（`wx` 独占创建）再 rename 覆盖 → **读者要么看到旧全文、要么看到新全文，永不看到半截**。**这正是「不许产生半截行」的官方手段。**
- 另有 `withFileLock`（`wx` 创建的 `<file>.lock` 兄弟文件）用于**跨进程**串行化读-改-写循环。**本实现用不用它？** → **用**（见实现说明）：同一教室 runtime 可能被宿主进程与其它工具同时写；`withFileLock` 是官方为「read-modify-write 不得复活旧状态」提供的锁。

### c-2 插件能否直接用 `node:fs/promises`？

**能，无沙箱限制。** 证据（同文件第 1–4 行，逐字）：

```js
import { randomBytes } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
```

`@deepseek-ai/dsh-atomic-write` 自身就是 `node:fs/promises` 的普通使用者，且它是宿主自带包、在插件进程内加载。→ **插件是普通 Cordis 插件，运行在宿主 Node 进程，`node:fs/promises` 可用**。

**但注意**：宿主有 `dsh-bash-sandbox` / `dsh-fs` 之类的**工具级**沙箱（作用于 LLM 调用的 bash/文件工具），**不是**插件进程的 V8 级限制。检索式：`ls tmp/dsh-installed/ | grep -i sandbox`（有 `dsh-bash-sandbox`、`dsh-terminal-bash`）。→ **插件的文件写入不受该沙箱约束**；约束来自插件自身代码（以及 macOS 权限位）。

**本实现的取舍**：**只用 `node:fs/promises`（读）＋ `@deepseek-ai/dsh-atomic-write`（写）**，不自己造临时文件+rename（避免重造官方轮子，符合「不用局部补丁代替通用算法」）。

⚠️ **风险登记**：`@deepseek-ai/dsh-atomic-write` 是**宿主核心包**。按项目铁律（实测报告：插件不得把宿主核心包装进 profile），**实现里不得把它写进插件 `package.json` 的 dependencies**，只能靠宿主解析（与 `@deepseek-ai/dsh-tools`、`dsh-llm` 同一待遇）。→ 因此**代码里用动态 `import('@deepseek-ai/dsh-atomic-write')` 并带降级**：解析失败时退回 `node:fs/promises` 的「写临时文件 + rename」自实现（**同一算法，不是另一种语义**），并把降级事实写日志。此决定已列入「待确认清单」。

### c-3 宿主是否暴露 FS 工具给插件用？

**未取证**（对「插件直接调用 FS 工具」这一形态）。已试检索式：`ls tmp/dsh-installed/ | grep -i "fs\|file"`、`grep -rn "ctx.fs\b" tmp/dsh-installed/`。
**解读**：宿主有 `dsh-api-workspace-files`、`dsh-client-file-upload` 等**面向客户端/工作区**的文件服务，但它们是**给 UI/API 用的**，不是「插件写任意路径文件」的官方口。→ 本实现**不依赖**它，直接走 c-1/c-2。

---

## (b-3) 真实会话日志的事件逐字形状（**实测取证，非推断**）

真源：`$DSH_HOME/sessions/--Users-wujunjie-Documents-ChatGPT-~5927~5B66~7533~8BF7--/031aa275-3a01-4284-b3a8-870d684268b0/session.jsonl.zstd`
（`$DSH_HOME="$HOME/Library/Application Support/dsh-desktop/harness"`；用 `/opt/homebrew/bin/zstd -dc` 解压后逐行 JSON）

事件类型计数（该会话）：

```
{"session":1,"subagent/descriptor":1,"session/end-seed":1,"sandbox/mode":1,"approval/policy":1,
 "permission/preset":1,"subagent/model-selection-policy":1,"agent/inbox/spliced":10,
 "turn/start":1,"step/start":57,"user/message":8,"session/title":1,"request/header":1,
 "request/context":1,"assistant/chunk":904,"text-chunks":191,"tool-call-chunks":119,
 "assistant/message":57,"tool/call":73,"tool/result":73,"step/end":57,"turn/end":1}
```

逐字样本（各截首 600 字符）：

```
{"type":"turn/start","seq":7,"time":1789806154632,"data":{"turn":1}}

{"type":"turn/end","seq":4480,"time":1789807143466,"data":{"turn":1,"reason":{"kind":"completed"}}}

{"type":"tool/call","seq":41,"time":1789806162328,"data":{"turn":1,"step":1,"callId":"toolu_01WL6ae08U3GXz1g3avf83qc","name":"bash","arguments":"{\"command\":\"pwd; ls -d /Users/wujunjie/oss/hunt/F-rootcause-sf 2>/dev/null && echo \\\"EXISTS\\\" || echo \\\"MISSING\\\"\",\"description\":\"Check working directory existence\"}"}}

{"type":"tool/result","seq":42,"time":1789806162340,"data":{"turn":1,"step":1,"message":{"source":{"kind":"tool","callId":"toolu_01WL6ae08U3GXz1g3avf83qc"},"content":[{"type":"tool-result","toolCallId":"toolu_01WL6ae08U3GXz1g3avf83qc","content":[{"type":"text","text":"/Users/wujunjie/Documents/ChatGPT/大学申请\nMISSING\n"}],"isError":false}],"role":"user","id":"37cbb97f-c2ab-4a31-82ad-f322d40f3c0f"}},"sourceEventSeqs":[41],"surfaceOp":"append"}

{"type":"user/message","seq":10,"time":1789806154748,"data":{"content":[{"type":"text","text":"你是「**根因定位与修复草案**」子代理。…"}], …}}

{"type":"assistant/message","seq":40,"time":1789806162328,"data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"I'll start by setting up the workspace and confirming the working directory."},{"type":"tool-call","id":"toolu_01WL6ae08U3GXz1g3avf83qc","name":"bash","arguments":"{…}"},{"type":"tool-call","id":"toolu_01ZSHBLWB6ICbmI5rNr3gLO5","name":"bash","arguments":"…"}], …}}}
```

**解读（实现直接依赖的 6 条形状事实）**：
1. **每个持久事件都带 `seq`（从 0 起）与 `time`（epoch ms）**，`data` 里带 `turn`（`turn/start`、`turn/end`、`tool/call`、`tool/result`、`assistant/message` 都有；`user/message` 样本未显示 turn —— **⚠️ 见下**）。
2. `tool/call` 带 **`name`** 与 `callId` → **工具调用名的来源**。
3. `tool/result` 不带 name，只带 `callId` → 需用 `callId` 与 `tool/call` 关联才能给结果配上名字。
4. `tool/result` 的 `message.content[0]` 是 `{type:'tool-result', toolCallId, content:[{type:'text',text}], isError}` → **结果摘要的取法：`content[0].content` 里的 text 块拼接**。
5. `assistant/message` 的 `message.content` 是 `[{type:'text'|'tool-call', …}]` 混合数组。
6. **`turn/end` 的 `reason.kind`** 可取 `"completed"` 等（该样本）→ 可用于判断本 turn 是否正常结束。

**⚠️ `user/message` 是否带 `turn`：本样本的 `data` 被截断在 600 字符处，未看到 `turn` 字段。**
→ **不作推断**。实现采取**稳健判法**：**不依赖 `user/message` 的 turn 字段**，而是**用事件 `seq` 落在 `turn/start(seq_a)` 与 `turn/end(seq_b)` 之间**来界定「本回合的事件区间」。这同时覆盖了「有的消息事件带 turn、有的不带」两种情况，且与官方说明「turn 边界是持久 session event」（见 a-6）一致。

### b-3b `user/message` **不带 `turn` 字段**（实测，决定性）

对 20 个真实会话的 `user/message` 事件做统计（脚本：`zstd -dc <session.jsonl.zstd> | node -e '…'`，只打印 `source.kind`）：

```
  19 agent-instructions/instructions
  18 user/-
  18 skill-catalog/catalog
  18 plugin/snapshot
   7 plugin/notice
   2 agent-message/relay
   1 coordinator/relay
```

逐字样本（一条真实的人类输入，`seq=10`）：

```
seq=10 time=1789803528769 blocks=text,text src={"kind":"user"}
```

**解读（实现直接依赖）**：
1. **人类（学生）输入 = `user/message` 且 `source.kind === 'user'`** —— 干净的白名单判据（不是黑名单猜测）。
2. 注入类消息的 `source.kind` 实测有：`agent-instructions`（AGENTS.md，与骨架「已实证事实 1」一致）、`skill-catalog`、`plugin`、`agent-message`、`coordinator`。**本插件自己的注入 `kind = 'socratic-engine'`** 也会落在这里 → 用白名单天然把它排除。
3. **所有 `user/message` 的 `data` 都没有 `turn` 键**（20 个会话统计里 `hasTurnKey` 恒为 false）→ **确认必须用「事件 seq 落在 turn/start 与 turn/end 之间」来界定本回合**（见 b-3 解读第 6 条）。

### b-4 运行时真源身份校验（**已完成**）

```
SAME  dsh-agent-loop/lib/index.js
SAME  dsh-session/lib/index.js
SAME  dsh-atomic-write/lib/index.js
SAME  dsh-agent/lib/index.js
```
（对 `tmp/dsh-installed/<p>` 与 `/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/<p>` 做 `shasum -a256` 比对，四个关键文件**逐字节相同**；`dsh/package.json` 版本 `0.1.5-rc.2`。）
**解读**：`tmp/dsh-installed/` 可作为运行时真源使用，取证件中的行号与片段对**实际运行的宿主**成立。

### b-5 一处「真源之外」的观察（登记，不影响本实现）

真实会话日志里出现了 **`agent/inbox/spliced`** 事件（10 次），而 `tmp/dsh-installed/dsh-scope/lib/invariant.js` 的 agent 事件生成表里**没有**这个名字。
检索式：`grep -rn "inbox/spliced" /Applications/DSH\ Desktop.app/.../dsh-agent-loop/lib/index.js` → 命中第 34、206 行（`this.session.append("agent/inbox/spliced", splice)`）。
**解读**：它是 agent-loop 自己 append 的**持久 session 事件**（不是 scoped dispatch 的 hook），因此不在 `scopedSubjectResolvers` 表里属正常。**与本实现无关**，登记以备后查。

---

## (d) 前向兼容风险（master `tmp/dsh-src-0923/`，commit 46a7f68b09）

| 项 | 安装版 0.1.5-rc.2 | master 快照 | 风险 |
|---|---|---|---|
| `agent/turn-stopping` 派发 | `dsh-agent-loop/lib/index.js:967` `await this.dispatch.serial("agent/turn-stopping", { turn, signal })` | `packages/core/agent-loop/src/agent.ts:342` `await this.dispatch.serial('agent/turn-stopping', { turn, signal })` | **无**（逐字同形） |
| `agent/turn-stopping` payload | `{ agent, turn, signal }` | 同（设计笔记原文一致） | **无** |
| 事件名集合 | `dsh-scope/lib/invariant.js` 生成表 | master 有 `packages/session/session-projection`、`packages/util/atomic-write` | **无** |
| `deriveMessages()` | 存在于 `dsh-session/lib/index.js` | master 测试里大量使用 `session.deriveMessages()`（如 `packages/session/session-format-v3-to-v4/tests/attribution.spec.ts:38`） | **无**（API 名未变） |
| `snapshotEvents()` / `ownEvents()` / `seq` | 存在于 `dsh-session/lib/index.js` | 未逐一比对 | **低**（属稳定读面） |
| `@deepseek-ai/dsh-atomic-write` | `writeFileAtomic(filename, content, options)` | `packages/util/atomic-write` 存在 | **低**（未比对签名） |

**master 新出现的、与「回合/会话摘要」相关的包（值得关注，非本版依赖）**：
`tmp/dsh-src-0923/packages/session/` 下有 **`session-turn-outline`**、`session-stats`、`session-title`、`session-projection-cache`。
**检索式**：`ls tmp/dsh-src-0923/packages/session/`。
**解读**：master 已把「逐回合提纲/统计」做成了独立包 → 说明「课后摘要」在宿主侧是**已被承认的一等需求**；本插件自建 `session_log.md` 追加不与其冲突（教室 runtime/ 是**教室自有格式**，不是宿主内部格式）。⚠️ 但**若未来升级到 master**，应优先评估能否复用 `session-turn-outline` 而不是继续自维护。已列入「待确认清单」。

**前向兼容结论**：本实现依赖的 4 个面（`agent/turn-stopping`、`agent.session.snapshotEvents`、`session.seq`、`writeFileAtomic`）在 master 上**均未见改名/改签名**。风险等级：**低**。唯一需警惕的是 `session-turn-outline` 出现后，宿主可能在未来版本把「回合边界」的读法收进 projection（届时 `snapshotEvents` 过滤仍是可用但非最优路径）。

---

## 待确认清单（S1）

1. **`@deepseek-ai/dsh-atomic-write` 的引入方式**
   - 问题：它是宿主核心包。按铁律不得进插件 `package.json`；那用**动态 import + 自实现同算法降级**，还是**直接静态 import**（赌宿主总能解析）？
   - 选项：A 动态 import + 降级（倾向）；B 静态 import。
   - 倾向：**A**。理由：降级路径是**同一算法**（wx 独占创建 + rename），不是「另一种语义的补丁」；且能避免在非 dsh 环境（单测）直接崩。
2. **写权限位 `mode`**：`writeFileAtomic` 必须给 `mode`。真实教室文件当前是 `0600`（`-rw-------`）。→ 倾向**沿用 `0o600`**。**待确认**：是否该用 `0o644`（教室文件可能要分享/被别的工具读）？
3. **是否需要 LLM 生成式摘要**：本版**不做**（项目红线：不许生成式改写教学事实）。若需要「讲次摘要」，须另行拍板（且必须由 LLM 之外的确定性规则产出，或明确标注为生成物）。
4. **其余 7 个 runtime 文件的接口**：本版只实现 `session_log.md`。其余（`progress.md` / `mistake_log.md` / `review_queue.md` / `diary.md` / `learner_profile.md` / `wechat_group.md` / `session_archive.md`）留 `updaters` 注册表接口，**不实现**。
5. **压缩规则**（`session_log.md` 头部写明「超过 10 条时把最早 5 条压入 `session_archive.md`」）：本版**不实现**压缩（属生成式改写风险区）。→ 待确认。
6. **多教室/多会话并发**：`sessionId` 是否足以做去重键前缀？（`agent.session.id` 可用，见实现）→ 倾向 `sessionId + turn`。
7. **前向兼容**：是否在升级到 master 时改用 `session-turn-outline`？→ 待拍板。

---
