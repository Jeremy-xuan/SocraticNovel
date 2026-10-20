# A5 · DSH 侧「标签通道」可行性（源码级）

> **基准**：安装版 `@deepseek-ai/*` 包，路径 `/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/`
> **版本**：`0.1.5-rc.2`（脚本直读 `dsh/package.json` 的 `version` 字段）
> **取证时间**：2026-09-24
> **纪律**：安装版**不发布 `.d.ts`**（多数包 `lib/` 下只有 `.js`），因此本文件的依据是**未压缩、保留 JSDoc 的产物 JS**（字符串字面量与注释可逐字引用）。凡属我的推断一律标「概括」。

---

## 1. 任务书的假设：**「在服务端把标签剥离并转成结构化事件／业务节点」**

### 1.1 结论：假设**方向对，但实现路径要改**

**先说结论**：
> **DSH 里不存在任何「内联文本标签 → 结构化事件」的现成机制**（我做了检索，见 §1.2）。
> 但 DSH 提供了**两条比「剥离标签」更干净的原生通道**：
> **(A) 工具调用**（结构化参数，天然分离）—— 推荐主路径；
> **(B) `system-prompt/assemble` waterfall**（动态注入"这个模型能做什么"）—— 解决能力发现层。

### 1.2 「DSH 没有内联标签解析机制」的检索记录

| 检索 | 范围 | 结果 |
|---|---|---|
| 文件名含 `citation`/`marker`/`token`/`parse`/`annotat` | `@deepseek-ai/` 244 个包的目录名 | **0 命中**（无此类包） |
| 内容含 `special token` / `specialToken` | `@deepseek-ai/*/lib/*.js` | **0 命中** |

> **概括**：airi 的 `<|ACT ...|>` 机制**在 DSH 里没有对应物**。DSH 的 assistant 输出被表达为**结构化 chunk 流**（`text-delta` / `reasoning-delta` / `tool-call-delta`），**不是一段需要被正则扫描的文本**。

### 1.3 DSH 的 assistant 流是结构化的（逐字证据）

**文件**：`dsh-llm/lib/types/assistant-stream.js:40–70`（逐字节选）

```js
        switch (chunk.type) {
            case 'text-delta':
            case 'reasoning-delta': {
                safeIndex(chunk.index, chunk.type);
                if (typeof chunk.text !== 'string')
                    throw new TypeError(`${chunk.type} text must be a string`);
                const type = chunk.type === 'text-delta' ? 'text-chunks' : 'reasoning-chunks';
```

```js
            case 'tool-call-delta': {
                safeIndex(chunk.index, chunk.type);
                if (typeof chunk.id !== 'string')
                    throw new TypeError('tool-call-delta id must be a string');
                if (Object.hasOwn(chunk, 'name') && typeof chunk.name !== 'string') {
                    throw new TypeError('tool-call-delta name must be a string');
                }
                if (typeof chunk.argumentsDelta !== 'string') {
                    throw new TypeError('tool-call-delta argumentsDelta must be a string');
                }
```

> **概括（关键）**：DSH 的流里**本来就有 `tool-call-delta` 这一路**，它带 `id` / `name` / `argumentsDelta`。
> **也就是说：「让模型输出结构化意图」这件事，DSH 的原生做法是工具调用，不是文本标签。**
> → **我们不需要"从文本里剥标签"，我们需要"让模型调工具"。** 这是**更简单也更可靠**的方案（无正则、无转义、无语法漂移）。

---

## 2. 通道 A（推荐）：工具调用承载驱动指令

### 2.1 工具定义 API（逐字）

**文件**：`dsh-tools/lib/index.js:837–877`（逐字节选）

```js
function defineTool(options) {
	const userExecute = options.execute;
	const userFinalizeContent = options.finalizeContent;
	const userRender = options.output.render;
	const userPresentationMeta = options.output.presentationMeta;
	const userPresentCall = options.presentCall;
	const userPresentResult = options.presentResult;
	const userIsConcurrencySafe = options.isConcurrencySafe;
```

```js
	const tool = {
		name: options.name,
		description: options.description,
		parameters,
		output: {
			schema: outputSchema,
			render(args, value) {
				return userRender(args, value);
			},
			...userPresentationMeta !== void 0 ? { presentationMeta(args, value) {
				return userPresentationMeta(args, value);
			} } : {}
		},
```

> **概括**：`defineTool` 接受 `name` / `description` / `parameters`（JSON Schema）/ `output.schema` / `output.render`。
> **`parameters` 就是「模型的输出契约」** —— 我们可以声明
> `{ emotion: enum([...]), intensity: number[0,1], motion?: string }`，
> **由宿主在调用前做 schema 校验**（`validateJsonSchemaValue(parameters, args, "")`，第 848 行逐字；`const tool = {` 在第 849 行）。
> 🔴 **这比 airi 的手写 JSON.parse + 手工校验强得多**：类型错误在**调用入口就被拦**，不会静默失效。

### 2.2 客户端消费：`conversation.chat.node`

**依据来自本项目已完成的取证件** `开源线/DSH定制/取证_P3_客户端槽位与派发语义_2026-09-24.md`（**不在本报告重复取证，直接引用其结论**）：

| 项 | P3 结论 | P3 行号 |
|---|---|---|
| 座存在 | `conversation.chat.node` ✅ 存在，**声明在 `conversation.view` 下** | `:437` |
| 注册方式 | `ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name, key, priority }, Component))` | `:597–606` |
| kind 是否可自定义 | 🔴 **`registerOptions` 只有 `key` 一项**（逐字 `:2338-2343`）→ **第三方不能注册全新 kind**，只能复用已有 key | `:589` |
| 最合适的已有 key | **`tool-call`**（`occupants` 逐字 `:2389`：`"client-ui-tool ToolCallTree key 'tool-call'"`） | `:584` |
| 风险 | `replaceRisk` 逐字 `:2392`：**`"shadows-shipped-ui"`**（会盖掉官方 ToolCallTree） | `:584` |
| 消息区 raw HTML | 🔴 **raw HTML 被按纯文本处理**；只有 Shiki/KaTeX 这类"库产出、无用户输入"的 HTML 走 `innerHTML` | `:575` |

> **🔴 综合结论（这就是任务书问的「标签通道怎么落地」的答案）**：
> **服务端不需要"剥离文本标签"**，因为：
> 1. **驱动指令走工具调用**（结构化参数，宿主校验，`tool-call-delta` 原生流）；
> 2. **客户端用 `conversation.chat.node` 的 `tool-call` key 注册自有 renderer**，把这个工具调用渲染成**立绘联动/白板/场景**，而不是默认的 ToolCallTree。
> 3. **正文里不会出现任何标签** —— 因为根本没有标签。**「消息区禁 raw HTML」这条约束自动满足。**
>
> **代价（必须承认）**：`replaceRisk = "shadows-shipped-ui"` —— 一旦我们注册了 `tool-call` key，**官方 ToolCallTree 就被盖掉了**，我们要承担该 kind 的全部呈现。**这是本方案最大的架构成本**（见设计 §6 反证）。

### 2.3 我们的假设中「转成业务节点」这半句**成立**

任务书原假设：「在服务端把标签剥离并转成结构化事件/业务节点，客户端只收结构化数据」。
- **「转成结构化事件」→ 成立**，但机制是**工具调用**而非标签剥离（§2.1）。
- **「客户端只收结构化数据」→ 成立**，DSH 的 session 流本来就是结构化的（§1.3）。
- **「服务端剥离标签」→ 这一步在 DSH 里应当取消**（因为不引入标签）。
  🔴 **若坚持引入文本标签**（例如为了让模型在正文中间插一个动作），则**只能靠我们自己写一个文本扫描器**——**而 DSH 没有给出这个钩子**（§1.2 零命中），且**消息区禁 raw HTML**（P3 `:575`），所以扫出来的标签**必须由我们在客户端渲染层自己消化**。→ **成本高于工具调用，收益不明**。

---

## 3. 通道 B（能力发现层的注入点）：`system-prompt/assemble`

### 3.1 它是 waterfall（中间件），可改写 prompt

**文件**：`dsh-system-prompt/lib/index.js:351`（逐字）

```js
		const transformed = await this.ctx.waterfall(scopeTarget(this, scope), "system-prompt/assemble", assembly, context, () => Promise.resolve(assembly));
```

**真实使用范例**：`dsh-session-reference/lib/index.js:456–466`（逐字）

```js
			ctx.on("system-prompt/assemble", async (_assembly, context, next) => {
				const assembly = await next();
				if (context.agent !== void 0) {
					const { provider, model } = assembly.variables;
					this.assembledRoutes.set(context.agent, {
						provider,
						model
					});
				}
				return assembly;
			}, { prepend: true });
```

**另一个范例（改写 `variables`）**：`dsh-agent/lib/index.js:134–146`（逐字）

```js
	const disposeAssembly = agentCtx.on("system-prompt/assemble", async (_assembly, _context, next) => {
		const selected = selection.current;
		const assembled = await next();
		selection.assembled = selected;
		if (selected === void 0) return assembled;
		return {
			...assembled,
			variables: {
				...assembled.variables,
				provider: selected.provider,
				model: selected.model
			}
		};
	});
```

> **🔴 这就是我们要的注入点**：
> 插件可以 `ctx.on('system-prompt/assemble', async (_a, _ctx, next) => { const a = await next(); /* 往 a 里塞"当前模型可用的动作/表情清单" */ return a; })`。
> **`{ prepend: true }` 控制顺序**（`dsh-session-reference` 用了它）。
> → **能力发现层落地方式**：把从 `model3.json` 解析出的清单，在**每次 prompt 组装时**注入。
> **这正好对应 Open-LLM-VTuber 的 `[<insert_emomap_keys>]` 替换**（`A4` §1 步骤②）——**先例 + DSH 原生钩子都在**。

### 3.2 另一个可用钩子：`agent/pre-step`（可改 messages）

**文件**：`dsh-session-reference/lib/index.js:467–476`（逐字）

```js
			ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
				const decision = await next();
				if (decision.kind === "reject") return decision;
				return {
					...decision,
					messages: await this.prepareDirectMessages(agent, decision.messages, signal)
				};
			}, { prepend: true });
```

> **概括**：`agent/pre-step` 可以**改写进入模型的消息数组**。→ 若我们需要"在消息里插入一条系统提示说'你现在可以调用 pose 工具'"，这里也能做。
> **但我们优先用 §3.1**（改 prompt 比改 messages 更贴合语义）。

### 3.3 已登记的 agent 事件名（供扩展时参考）

从 `dsh-agent/lib/index.js` 的字面量中提取到的事件名（脚本 `grep -o` 输出，**已去重**）：

```
agent/created      agent/disposed     agent/inbox/spliced
agent/pre-step     agent/request      system-prompt/assemble
step/start         turn/start         turn/end
```

> **概括**：`turn/start` / `turn/end` / `step/start` 都是**可观测的事件**。→ **这与我们已有的相位机（`open/probe/answer/check/review/close`）可以对齐**（设计 §5）。

---

## 4. 教学状态 → 立绘：我们已有什么（本项目既有事实，非本次取证）

| 已有机制 | 出处 |
|---|---|
| 相位机 `open/probe/answer/check/review/close` | 项目既有（`AGENTS.md` 与 DSH 定制线记录） |
| `current_lesson` 讲次门 | 项目既有（刚实现） |
| **相位切换由教师模型调用工具自己宣布**（已拍板） | 项目既有决策 |

> **🔴 设计含义（零 LLM 成本）**：
> 「相位切换由模型调工具宣布」这件事**本身就是一条结构化信号** —— 它走的就是 §2.1 的**同一条工具调用通道**。
> → **立绘驱动可以搭在这个工具上，不需要额外的 LLM 调用，也不需要解析文本。**
> → 具体：教师宣布相位时，**同一个工具调用**（或紧邻的一次调用）携带 `emotion`/`pose`，服务端把两者一起广播给客户端。

---

## 5. 本节「源码核实 vs 二手」标注

| 结论 | 状态 |
|---|---|
| DSH 无内联标签解析机制 | ✅ **一手**（两类检索零命中） |
| assistant 流是结构化 chunk（含 `tool-call-delta`） | ✅ **一手**（`assistant-stream.js` 逐字） |
| `defineTool` 的 `parameters` 做 schema 校验 | ✅ **一手**（`dsh-tools/lib/index.js` 逐字） |
| `system-prompt/assemble` 是 waterfall 且可注入 | ✅ **一手**（`dsh-system-prompt` + 两个真实 listener 逐字） |
| `agent/pre-step` 可改写 messages | ✅ **一手**（`dsh-session-reference` 逐字） |
| agent 事件名清单 | ✅ **一手**（`grep -o` 字面量输出） |
| `conversation.chat.node` 可注册 `tool-call` key | ⚠️ **二手引用本项目 P3 取证件**（P3 是一手，本报告未重复取证） |
| `registerOptions` 只有 `key` | ⚠️ **二手引用 P3**（P3 `:589`） |
| 消息区 raw HTML 被按纯文本处理 | ⚠️ **二手引用 P3**（P3 `:575`） |
