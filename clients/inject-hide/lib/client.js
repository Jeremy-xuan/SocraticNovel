/**
 * 隐藏引擎注入行（inject-hide）· 浏览器半边。
 *
 * 形态：DSH 客户端插件产物（`window.__ModuleLoader__.load({id, factory})`，id 必须等于包名）。
 * 本文件是**手写的产物**，不经过打包器——宿主加载的是「已构建产物」这一格式本身
 * （`dsh-client-modules` 的 node 半边读 `package.json` 的 `exports["./client"]` 指向的文件字节
 * 直接下发给浏览器，不做任何转译）。故这里用 `require("react")` + `React.createElement`，
 * 不写 JSX、不引 CSS 模块。
 *
 * ── 问题（上一路取证到代码级，本轮复核）────────────────────────────────────
 * 教学引擎的每条注入都作为 `user/message` ＋ `source.kind = 'socratic-engine'` 进会话；
 * 安装版 `dsh-client-ui-chat` 把**一切 `source.kind !== 'user'` 的 user/message** 投影成
 * `kind: 'context'` 的 Chat 节点，并用 `ContextMessageNodeView` → `ContextInjectionRow`
 * 渲染成默认折叠的「上下文注入 · socratic-engine」行 —— 于是老师的课堂编排（状态块、
 * 备课清单、动画通报）全都在学生的消息流里露出来。
 *
 * ── 做法：**遮蔽 ＋ 委派**，不是 CSS 遮掩，也不改宿主 ──────────────────────────
 * 座目录里 `conversation.chat.node` 是 **keyed** 座，`keyDomain` 固定，`context` 已被
 * `client-ui-chat ContextMessageNodeView` 占据，`replaceRisk = "shadows-shipped-ui"`。
 * `SlotCore.register` 的**同键同优先级才报错**，官方错误提示逐字写着
 * 「register at a different priority to shadow it (**lowest renders**)」，
 * 而 keyed 派发取的是 `entriesOfSlot(key)`（每格优先级最低的存活条目）。
 * 所以：**以 `priority: -1` 注册同键**＝在同格里排在 shipped 前面而胜出，**不需要卸载/改写宿主任何东西**。
 *
 * 胜出之后**不能自己重画那一行**（`ContextMessageNodeView` 与它的 6 种结构化 form
 * 都没有被 `client-ui-chat` 导出，重画＝抄一份随时会漂的宿主 UI）。故本插件**只判断要不要藏**：
 *   - 来源是引擎自己的注入 → 返回 `null`（座位外壳是 `div.flowItem`，shipped 样式里
 *     已有 `.flowItem:empty{display:none}`，且相邻间距规则带 `:not(.flowItem:empty)`，
 *     所以「返回 null」在官方 CSS 下就是**不留空行、不留占位**，不需要任何额外样式）；
 *   - 其它任何来源（宿主的 AGENTS.md 注入、技能目录、跨会话召回、别人家插件的注入）
 *     → **原样委派给 shipped 渲染器**，一个像素都不改。
 *
 * 🔴 **委派对象是"算出来的"而不是"写死的"**：取该格中**除本插件之外**优先级最低的**存活**条目
 * （＝假如本插件不存在时 `entriesOfSlot` 会选中的那一个）。这样宿主换实现、换优先级、
 * 或另一个插件也来遮蔽，本插件都跟着走。三条纪律：
 *   - **按组件身份排除自己**，不按优先级值——同格里可能有第三方条目也注册在 -1，它不是本插件，
 *     本该是可以委派的对象；
 *   - **跳过座位已判退位（abdicated）的条目**，忠实复现 `entriesOfSlot`（它跳退位条目再选胜者）。
 *     公开面上**没有退位状态探针**（`isLive` 只答"还在台账里"；`snapshot().occupants[].active`
 *     答的是"是不是胜者"，会把被遮蔽的活条目也算成 false），唯一的公开缝是 `onEntryError`
 *     这条通知，故本插件镜像一份台账（见 `apply`）；
 *   - 若该格里**只剩本插件自己**（宿主实现变了/没了），则**主动抛错**让本条目退位
 *     （座位的错误边界会把它标成 abdicated，派发随即回落到座位自带的 fallback）——
 *     **宁可响亮地退位，也不静默地把宿主自己的上下文行一并藏掉**。
 *
 * 数据通道：无。本插件不读文件、不发请求、不注册工具，只在渲染层做一次分类。
 */

window.__ModuleLoader__.load({
	id: "inject-hide",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");

		// ════════════════════════════════════════════════════════════════════
		// 1 · 常量（座契约与来源契约）
		// ════════════════════════════════════════════════════════════════════

		/** keyed 座：最终 Chat 节点渲染器，按 `ChatNodeKind` 派发。 */
		const SLOT = "conversation.chat.node";
		/** 该座里"注入行"那一格：一切 `source.kind !== 'user'` 的 user/message 都落进它。 */
		const CONTEXT_KEY = "context";
		/** 引擎注入在会话里的 `source.kind`（跨端契约字段，见引擎侧注入构造）。 */
		const ENGINE_SOURCE_KIND = "socratic-engine";
		/** 要藏起来的来源 kind 表。收窄在这里：只藏引擎自己注入的。 */
		const HIDDEN_KINDS = [ENGINE_SOURCE_KIND];
		/** 本插件在那一格里的优先级。shipped 注册时未声明优先级（＝0），故 -1 胜出。 */
		const SHADOW_PRIORITY = -1;
		/** shipped 渲染器注册时声明的 locale 命名空间；本条目声明同一个，`t` 座位才等价。 */
		const CHAT_LOCALE = "chat";

		/**
		 * 槽位外壳的选择器。宿主对**每一条**槽位条目都会套一个 `display: contents` 的外壳，
		 * 这里用宿主的数据属性定位，不用它那套带构建哈希的类名。
		 */
		const SLOT_OUTLET = `[data-slot="${SLOT}"]`;

		/**
		 * 宿主样式表里有一条 `.flowItem:empty{display:none}`（外加"空 flowItem 不参与相邻间距"
		 * 的那半条），本意就是"这一格没内容 ⇒ 整条不参与布局"。但它在本机**判不出来**：
		 * `renderSlot` 永远会给条目套一个 `display: contents` 的槽位外壳，于是 flowItem 里
		 * 总有一个子元素、`:empty` 永不成立 —— 结果是"行高 0、却仍占一条
		 * `margin-top: var(--dsh-chat-flow-gap)`"（实测每行 16px、十行共 160px 空白）。
		 *
		 * 下面这条规则把宿主**本来就想说**的那句话用稳定的数据属性重说一遍：
		 * **槽位外壳为空 ⇒ 这一行整条不参与布局**。它不移除任何内容（外壳为空时本来就没有内容），
		 * 只是让空盒子彻底退出布局 —— 不是"把行高设成 0 藏起来"那类遮掩。
		 */
		const EMPTY_ROW_CSS = `[data-chat-flow-kind]:has(> ${SLOT_OUTLET}:empty){display:none}`;
		/** `<style>` 标签的幂等标记（与宿主自己的 `data-plugin-css` 约定同形）。 */
		const STYLE_TAG_ID = "inject-hide/empty-row.css";

		// ════════════════════════════════════════════════════════════════════
		// 2 · 纯函数（node 侧测试直接驱动同一份代码）
		// ════════════════════════════════════════════════════════════════════

		/**
		 * 这条 Chat 节点的来源是不是"引擎注入"。
		 * @param source - 节点 data 上的 `source`（会话日志里的 durable 来源）。
		 * @returns 命中隐藏表时为 true。
		 */
		function shouldHideSource(source) {
			if (source === null || typeof source !== "object") return false;
			return HIDDEN_KINDS.includes(source.kind);
		}

		/**
		 * 假如本插件不存在，keyed 派发会选中哪一条。
		 *
		 * 逐字对应 `SlotCore.entriesOfSlot` 的两条规则：**跳过已退位（abdicated）的条目**，
		 * 在剩下的里**按优先级升序取第一个**（同优先级按登记序，JS `sort` 稳定）。
		 * @param entries - `slots.entries(SLOT)` 的原始台账（含被遮蔽与被退位的条目）。
		 * @param self - 本条目自己的组件函数：**按身份**排除自己（不是按 `priority` 值——
		 *   那会把同格里第三方同样注册在 -1 的条目一并误排除）。
		 * @param retired - 已知被座位判为退位的条目集合（`apply` 建立的台账）。
		 * @returns 该格的委派目标；除本插件外空无一物时返回 undefined。
		 */
		function shadowTarget(entries, self, retired) {
			let best;
			for (const entry of entries) {
				if (entry.options.key !== CONTEXT_KEY) continue;
				if (entry.component === self) continue;
				if (retired.has(entry)) continue;
				const priority = entry.options.priority ?? 0;
				// 比本插件优先级更低的条目**必然已退位**：本插件正被渲染 ⇒ 本插件就是本格的胜者
				// ⇒ 更低的条目若还活着，胜者就是它。这条推断补上了**本插件挂载前**就已退位的条目
				// （`onEntryError` 只收得到挂载之后的报告）。
				// 唯一窗口：更低的条目刚登记、座位还没重新投影的这一帧里本组件仍在渲染——此时
				// 跳过它是错的，但下一帧胜者就换成它，窗口自愈。
				if (priority < SHADOW_PRIORITY) continue;
				if (best === undefined || priority < (best.options.priority ?? 0)) best = entry;
			}
			return best;
		}

		// ════════════════════════════════════════════════════════════════════
		// 3 · 空行样式（补上宿主那条判不出来的 `:empty`）
		// ════════════════════════════════════════════════════════════════════

		/**
		 * 幂等插入空行样式。规则只引宿主的数据属性，故换皮肤/换构建都不用改。
		 * @param doc - 目标文档（默认当前文档；测试可传替身）。
		 * @returns 插入或复用的 `<style>` 元素。
		 */
		function installEmptyRowCss(doc = document) {
			const existing = doc.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`);
			if (existing !== null) return existing;
			const tag = doc.createElement("style");
			tag.dataset.plugin = "inject-hide";
			tag.dataset.pluginCss = STYLE_TAG_ID;
			tag.textContent = EMPTY_ROW_CSS;
			doc.head.appendChild(tag);
			return tag;
		}

		/**
		 * 空行样式标签的持有者计数：同一页面可能挂载多个实例，而 `installEmptyRowCss` 是按选择器
		 * 幂等的（大家共用同一个 `<style>`），故**最后一个**持有者释放时才摘除标签。
		 */
		let emptyRowCssHolders = 0;

		/**
		 * 取得空行样式并返回释放器 —— 配合 `ctx.effect` 用，插件卸载即摘除标签、不留残留。
		 * @param doc - 目标文档（默认当前文档；测试可传替身）。
		 * @returns 幂等的释放器。
		 */
		function acquireEmptyRowCss(doc = document) {
			const tag = installEmptyRowCss(doc);
			emptyRowCssHolders += 1;
			let released = false;
			return () => {
				if (released) return;
				released = true;
				emptyRowCssHolders -= 1;
				if (emptyRowCssHolders === 0) tag.remove();
			};
		}

		// ════════════════════════════════════════════════════════════════════
		// 4 · 渲染器
		// ════════════════════════════════════════════════════════════════════

		/**
		 * 造一个"该格子里排在最前的条目"渲染器。
		 *
		 * 它拿到的 props 与 shipped 条目拿到的**同一份**（同一座位、同一 owner props、同一
		 * standard kit；本条目不声明 `inject`／`store`／`children`，故不多也不少），
		 * 于是非引擎来源时把 props 原样转交即可，宿主渲染结果逐像素不变。
		 * @param ctx - 客户端根 Context（只用到 `ctx.slots.entries` 这个只读检视面）。
		 * @param retired - 已退位条目台账（`apply` 建立，见那里的说明）。
		 * @returns 座位调用的 React 组件（它的函数身份就是台账里"本插件自己"那一格）。
		 */
		function createView(ctx, retired) {
			const view = function InjectHideView(props) {
				const node = props === null || props === undefined ? undefined : props.node;
				const source = node === null || node === undefined ? undefined : node.data?.source;
				if (shouldHideSource(source)) return null;
				const target = shadowTarget(ctx.slots.entries(SLOT), view, retired);
				if (target === undefined) {
					throw new Error(
						`inject-hide: 座 '${SLOT}' 的 '${CONTEXT_KEY}' 格子里除本插件外没有别的渲染器 —— ` +
							`此时"委派"无处可去，继续渲染就等于把宿主自己的上下文行也一并藏掉，故本条目主动退位（座位 fallback 接管）`,
					);
				}
				return React.createElement(target.component, props);
			};
			return view;
		}

		// ════════════════════════════════════════════════════════════════════
		// 5 · 插件体
		// ════════════════════════════════════════════════════════════════════

		/** 需要的宿主服务：槽位注册表（`register` ＋ 只读检视面 `entries` ＋ 退位通知 `onEntryError`）。 */
		const inject = ["slots"];

		/**
		 * 挂载：补一条空行样式（随卸载摘除）、建退位台账、在 `context` 那一格以更低优先级
		 * 注册自己的渲染器。
		 * @param ctx - 客户端根 Context
		 */
		function apply(ctx) {
			// ① 空行样式：effect 的释放器负责摘掉 `<style>`，卸载不留残留。
			ctx.effect(() => acquireEmptyRowCss(), "inject-hide: 空行样式");

			// ② 退位台账：座位把"崩过并因此退出本格"的条目记在 `SlotCore` **私有的** WeakSet 里，
			//    公开面**没有状态探针**——`isLive` 只答"还在台账里"（退位条目仍在台账上），
			//    `snapshot().occupants[].active` 答的是"是不是胜者"（会把被遮蔽的活条目也算成
			//    false，拿它当退位判据会误杀）。唯一的公开缝是 `onEntryError` 这条**通知**
			//    （官方文档：the supervision seam for plugins mirroring contribution health），
			//    故本插件按官方说法镜像一份台账，供委派时跳过。
			const retired = new WeakSet();
			ctx.effect(
				() =>
					ctx.slots.onEntryError((key, entry, error, abdicated) => {
						if (key === SLOT && abdicated) retired.add(entry);
					}),
				"inject-hide: 退位台账",
			);

			// ③ 遮蔽注册：同一份 view 身份贯穿整个插件寿命（台账按身份排除自己）。
			const view = createView(ctx, retired);
			ctx.effect(
				() =>
					ctx.slots.inject(SLOT, () =>
						ctx.slots.register(
							{
								name: SLOT,
								key: CONTEXT_KEY,
								priority: SHADOW_PRIORITY,
								locale: CHAT_LOCALE,
							},
							view,
						),
					),
				"inject-hide: 隐藏引擎注入行",
			);
		}

		// ── 导出 ──
		exports.inject = inject;
		exports.apply = apply;
		// 纯函数与工厂一并导出，供 node 侧测试直接驱动同一份代码（见 test/hide.test.mjs）。
		exports.SLOT = SLOT;
		exports.CONTEXT_KEY = CONTEXT_KEY;
		exports.ENGINE_SOURCE_KIND = ENGINE_SOURCE_KIND;
		exports.HIDDEN_KINDS = HIDDEN_KINDS;
		exports.SHADOW_PRIORITY = SHADOW_PRIORITY;
		exports.CHAT_LOCALE = CHAT_LOCALE;
		exports.SLOT_OUTLET = SLOT_OUTLET;
		exports.EMPTY_ROW_CSS = EMPTY_ROW_CSS;
		exports.STYLE_TAG_ID = STYLE_TAG_ID;
		exports.shouldHideSource = shouldHideSource;
		exports.shadowTarget = shadowTarget;
		exports.installEmptyRowCss = installEmptyRowCss;
		exports.acquireEmptyRowCss = acquireEmptyRowCss;
		exports.createView = createView;

		return module.exports;
	},
});
