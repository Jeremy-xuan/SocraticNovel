# 旁挂锚点表 · 实现报告_HIDE-INJECT_隐藏注入显示_2026-09-24.md

> 本文件是 `实现报告_HIDE-INJECT_隐藏注入显示_2026-09-24.md` 的**行号真源**：正文只写锚点 `〔Axx〕`，
> 行号与片段集中在这里。每条锚点记**它引的是哪个版本**（sha256 前 16 位）——源码一改就**响亮报错**，
> 而不是静默失准。
> 🔴 **版本哈希是整文件粒度**：V1–V11 是**只读引用**（宿主安装版快照 ＋ 引擎，别的线一改就会整片报红），
> 那时**重取行号**，不要删锚点凑绿；V12 起是本轮新建的产物。
> 快照与安装版逐字节相同这一点已在报告 §1 核过（四个关键包 sha256 全部一致）。
> 机核：`node 开源线/DSH定制/code/tools/anchors/check-anchors.mjs 实现报告_HIDE-INJECT_隐藏注入显示_2026-09-24.md --list`

## 版本表

| V | 文件 | sha256 前 16 位 |
|---|---|---|
| V1 | tmp/dsh-installed/dsh-client-ui-chat/lib/client.js | 5ab74e5405799576 |
| V2 | tmp/dsh-installed/dsh-client-ui-chat/lib/index.js | dd6b1d214c530abc |
| V3 | tmp/dsh-installed/dsh-client-ui-slots/lib/index.js | 5433ef2cb74699a5 |
| V4 | tmp/dsh-installed/dsh-client-ui-renderer/lib/client.js | 859d0a187e436d68 |
| V5 | tmp/dsh-installed/dsh-cordis-client-runner/lib/client.js | e78c94d66a75d694 |
| V6 | tmp/dsh-installed/dsh-session/lib/index.js | 05e94f57d96e7979 |
| V7 | tmp/dsh-installed/dsh-agent-loop/lib/index.js | 257eb83c00a05ee0 |
| V8 | tmp/dsh-installed/dsh-llm/lib/index.js | f54d86572d4c0e8d |
| V9 | tmp/dsh-installed/dsh-api-session-controller/lib/index.js | 2c0fa776bc3ad457 |
| V10 | tmp/dsh-installed/dsh-client-ui-conversation/lib/client.js | c4f30b2fe2917822 |
| V11 | 开源线/DSH定制/code/plugins/socratic-engine/index.mjs | bb4c4634ec14620d |
| V12 | 开源线/DSH定制/code/clients/inject-hide/lib/client.js | 0f558a128e47d248 |
| V13 | 开源线/DSH定制/code/clients/inject-hide/test/hide.test.mjs | b1a6070e027ae486 |
| V14 | 开源线/DSH定制/code/clients/inject-hide/tools/e2e-hide-shots.cjs | 7d79a3a7d21596bf |

## 锚点表

| 锚点 | 说明 | 版本 | 行 | 片段 |
|---|---|---|---|---|
| A01 | 宿主 UI：`source.kind !== "user"` 一律投影成 context 节点 | V1 | 6065 | `if (event.data.source.kind !== "user") return {` |
| A02 | 宿主 UI：`context` 键的 keyed 渲染器本体 | V1 | 1368 | `const ContextMessageNodeView = (0, react.memo)(function ContextMessageNodeView({ node, t }) {` |
| A03 | 宿主 UI：注入行组件（默认折叠，标题走 locale） | V1 | 850 | `function ContextInjectionRow({ content, source, provenance, form, t }) {` |
| A04 | 宿主 UI：未知 kind 的注入来源 → role inject ＋ label=kind | V1 | 4210 | `function contextProvenance(source) {` |
| A05 | 宿主 UI：结构化呈现只认这 6 种 form（我们的不在内） | V1 | 4187 | `const KNOWN_FORMS = [` |
| A06 | 宿主 UI：`context` 键的注册处（**未声明 priority** ＝ 0） | V1 | 3709 | `key: "context",` |
| A07 | 宿主 UI：座位派发点（按 `routedNode.kind` 派发） | V1 | 1616 | `children: renderSlot("conversation.chat.node", routedOwner, {` |
| A08 | 宿主样式：空 flowItem 既不占位也不产生间距 | V1 | 1511 | `.EvIC1a_flowItem:empty{display:none}` |
| A09 | 宿主 UI：不折进 turn process 的 kind 清单（context **不在**内） | V1 | 1418 | `const TURN_PROCESS_INDEPENDENT_KINDS = new Set([` |
| A10 | 宿主 UI：append surface 判定（压缩检查点只认 replacement） | V1 | 5704 | `function isAppendSurfaceEvent(event) {` |
| A11 | 宿主 UI：一切 `surfaceOp !== "append"` 都被它 match，但只在 system/message 时建节点 | V1 | 6127 | `function systemMessageDefinition(inspect) {` |
| A12 | 宿主 UI：Chat 的 locale 命名空间（本插件条目声明同一个） | V1 | 2624 | `const NS = "chat";` |
| A13 | 宿主 UI：注入行的英文标题文案（A/B 对照截图里的行标题来源） | V1 | 2766 | `"message.contextInjection": "Context injection",` |
| A14 | 宿主设置：Chat 命名空间下**唯一**的持久设置字段 | V2 | 13 | `const ChatSettingsSchema = z.object({ [TRANSCRIPT_VIEW_FIELD]: z.union([...TRANSCRIPT_VIEW_MODES]).default(DEFAULT_TRANSCRIPT_VIEW_MODE) });` |
| A15 | 宿主设置：命名空间 `ui-chat` | V2 | 5 | `const CHAT_SETTINGS_NAMESPACE = "ui-chat";` |
| A16 | 座契约：同键换优先级即可遮蔽，**最低者渲染** | V3 | 77 | `register at a different priority to shadow it (lowest renders)` |
| A17 | 座契约：只有**同键同优先级**才报错 | V3 | 86 | `const occupant = rec.entries.find((e) => e.options.key === options.key` |
| A18 | 座契约：条目按 priority 升序排 | V3 | 130 | `next.sort(spec.kind === "list" ? (a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0)` |
| A19 | 座契约：台账条目带 `component` 与 `options`（委派面就在这） | V3 | 113 | `const entry = {` |
| A20 | 座契约：`entriesOfSlot` 每格取第一个存活条目 | V3 | 187 | `entriesOfSlot(key) {` |
| A21 | 座契约：条目崩溃 → abdicate（退出该格，注册本身仍在台账） | V3 | 340 | `reportEntryError(key, entry, error, info) {` |
| A22 | 渲染器：keyed 派发确实走 `entriesOfSlot` | V4 | 827 | `const entry = host.entriesOfSlot(slotKey).find((e) => e.options.key === opts?.entryKey);` |
| A23 | 渲染器：该格无存活条目时的兜底（deadCell／座位 fallback） | V4 | 820 | `const deadCell = () =>` |
| A24 | 渲染器：`t` 座位按条目自己声明的 locale 装配 | V4 | 605 | `kit["t"] = localeSeat(face, entry.locale);` |
| A25 | 渲染器：`SlotRegistry.entries` 公开（原始台账，含被遮蔽者） | V4 | 1188 | `entries(key) {` |
| A26 | 渲染器：`SlotRegistry.entriesOfSlot` 公开（每格胜者） | V4 | 1200 | `entriesOfSlot(key) {` |
| A27 | 座目录：`conversation.chat.node` 那一条 | V5 | 2333 | `key: "conversation.chat.node",` |
| A28 | 座目录：同条 occupants 逐字含 shipped 的 `context` 渲染器 | V5 | 2376 | `client-ui-chat ContextMessageNodeView key 'context'` |
| A29 | 座目录：`slots` 服务公开面只有 `register`（`entries` 在 SlotRegistry 上） | V5 | 1342 | `declare readonly register: SlotCore['register']` |
| A30 | 会话：`append` 的 surfaceOp 由调用方决定（插件拿不到"不显示"） | V6 | 1170 | `append(type, data, ...opts) {` |
| A31 | 会话：replacement 的格式校验要求"被遮蔽节点完整覆盖" | V6 | 1162 | `shadowed-node coverage` |
| A32 | 宿主：注入消息由 agent-loop 以 `surfaceOp: "append"` 落盘 | V7 | 1028 | `this.session.append("user/message", message, { surfaceOp: "append" });` |
| A33 | 宿主：`createUserMessage` 的入参里没有可见性字段 | V8 | 48 | `function createUserMessage(input) {` |
| A34 | 宿主：输入队列 placement（user→steering，其余→context） | V9 | 1208 | `placement: message.source.kind === "user" ? "steering" : "context",` |
| A35 | 宿主：`lastPromptAt` 只认 `source.kind === "user"`（伪装成 user 会污染它） | V9 | 1797 | `event.type === "user/message" && event.data.source.kind === "user" ? event.time : state.lastPromptAt;` |
| A36 | 宿主：会话定义注册表**同 kind 重复即抛**（顶不掉 shipped） | V10 | 2241 | `uiConversation.events.register(${JSON.stringify(definition.kind)})` |
| A37 | 宿主：派发会接受**每一个**匹配的定义（多注册＝多一个节点） | V10 | 1788 | `for (const definition of this.eventDefinitions.entries()) {` |
| A38 | 引擎：状态块的注入来源契约（`classroom-block`） | V11 | 727 | `source: { kind: 'socratic-engine', form: 'classroom-block', block: d.id },` |
| A39 | 引擎：备课清单的注入来源契约（`prep-list`） | V11 | 717 | `source: { kind: 'socratic-engine', form: 'prep-list'` |
| A40 | 引擎：注入经 `createUserMessage` 汇入本轮 decision | V11 | 724 | `const injected = due.map((d) =>` |
| A41 | 本插件：要藏的来源 kind 白名单（默认只有引擎） | V12 | 62 | `const HIDDEN_KINDS = [ENGINE_SOURCE_KIND];` |
| A42 | 本插件：判据（白名单，不是"非 user 就藏"） | V12 | 98 | `function shouldHideSource(source) {` |
| A43 | 本插件：委派对象是**算出来的**（该格除自己外优先级最低者） | V12 | 111 | `function shadowTarget(entries) {` |
| A44 | 本插件：渲染器工厂（三条分支：藏／委派／退位） | V12 | 155 | `function createView(ctx) {` |
| A45 | 本插件：无委派对象时主动抛错退位 | V12 | 162 | `throw new Error(` |
| A46 | 本插件：以 `priority: -1` 注册同键 | V12 | 191 | `priority: SHADOW_PRIORITY,` |
| A47 | 本插件：只注入 `slots` 一个宿主服务 | V12 | 176 | `const inject = ["slots"];` |
| A48 | 本插件：装载走 `ctx.effect`（插件卸载即撤条目） | V12 | 184 | `ctx.effect(` |
| A49 | 单测：引擎来源 → 渲染 null，不碰 createElement | V13 | 147 | `test('引擎来源 → 渲染 null（不产生任何 DOM）'` |
| A50 | 单测：别的来源 → 委派且 props 是同一个对象 | V13 | 154 | `test('别的来源 → 原样委派给 shipped，props 是同一个对象'` |
| A51 | 单测：对安装版的漂移告警（shipped 仍未声明 priority） | V13 | 254 | `test('安装版 shipped 的 context 条目仍未声明 priority（本插件遮蔽成立的前提）'` |

| A52 | 本插件：补上宿主那条判不出来的空行规则（只用数据属性） | V12 | 85 | `const EMPTY_ROW_CSS = ` |
| A53 | 本插件：空行样式的幂等插入 | V12 | 131 | `function installEmptyRowCss(doc = document) {` |
| A54 | 本插件：槽位外壳选择器（数据属性，不是哈希类名） | V12 | 72 | `const SLOT_OUTLET = ` |
| A55 | 本插件：apply 里补样式的那一行（要退回"160px 空白"形态就删它） | V12 | 183 | `installEmptyRowCss();` |
| A56 | 本插件：`<style>` 标签的幂等标记 | V12 | 87 | `const STYLE_TAG_ID = ` |
| A57 | 单测：空行规则只引数据属性、不引哈希类名 | V13 | 235 | `test('空行样式只引宿主的数据属性，不引带构建哈希的类名'` |
| A58 | 单测：空行样式幂等（插两次只留一个 style） | V13 | 242 | `test('空行样式幂等：插两次只留一个 <style>'` |
| A59 | 单测：最小 document 替身（驱动真实 installEmptyRowCss） | V13 | 217 | `function fakeDocument() {` |
| A60 | 取证脚本：逼出一次工具调用的提示词 | V14 | 42 | `const PROMPT = [` |
| A61 | 取证脚本：DOM 读数函数（注入行台账 ＋ 别的行计数） | V14 | 51 | `function probeHide() {` |
| A62 | 取证脚本：残留按 display 判，不按计算值判 | V14 | 88 | `hiddenContextMarginTotal:` |
| A63 | 取证脚本：按标记串认领会话行（不按"工作区行之后第一个"） | V14 | 121 | `const SESSION_MARK = ` |
| A64 | 取证脚本：选行 ＋ 等消息流挂上来 | V14 | 133 | `async function openSession(page) {` |

## 行号散写豁免
| 文件 | 行 | 理由 |
|---|---|---|
