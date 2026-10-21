/**
 * 课堂舞台（classroom-stage）· 浏览器半边。
 *
 * 形态：DSH 客户端插件产物（`window.__ModuleLoader__.load({id, factory})`，id 必须等于包名）。
 * 本文件是**手写的产物**，不经过打包器——与 classroom-ui 同一做法：宿主加载的是
 * 「已构建产物」这一格式本身（dsh-client-modules 读 `package.json` 的 `exports["./client"]`
 * 指向的文件字节直接下发给浏览器，不做任何转译）。故这里用 `require("react")` +
 * `React.createElement`，不写 JSX、不引 CSS 模块（样式走内联 style 对象）。
 *
 * 挂载点：`conversation.view`（`kind: list` / `scope: session` / `replaceRisk: none`，
 * 官方契约逐字 *"Registered Conversation target Views, rendered one at a time."*）。
 *
 *   🔴 为什么从右侧栏换到这里：**右侧栏拿不到对话流**。`sidebar.right.pane.tab` 那一层
 *   只有会话列表与状态，没有当前会话的消息读口；而 `conversation.view` 比 root 座多出
 *   8 个会话专属接口（`sessionId` / `useChat` / `useConversation` / `useInput` /
 *   `useProjection` / `useTrajectory` / `inputActions` / `useSession`）。舞台要显示对话正文，
 *   就必须占这一格。右侧栏仍归 classroom-ui，两处不重复。
 *   「切过去官方消息区不渲染」不是缺陷：官方视图是 *rendered one at a time*，
 *   上课模式本来就是把消息区换成舞台，想聊天切回官方 chat 视图即可。
 *
 * 数据通道（两条，都是宿主现成的）：
 *   ① 教室文件：`ctx.remote.workspaceFiles.read(sessionId, path, {offset})` —— 直接读教室自己的
 *      文件（classroom.yaml / runtime/progress.md / curriculum.md / characters/komari.md）。
 *   ② 对话流：`conversation.view` 的 standardProps 里的 `useChat` 选择器 hook
 *      （`s.order` 是节点键序列，`s.nodes` 是按键取节点的 store）。
 *
 * 视觉：借 STAGE-3 的「B 讲台骨架 ＋ C 書庫材质」——木框承着奶白纸面，讲台常驻在纸面上方，
 *   课程表是一排书脊加一份章节索引（色值逐条对齐 prototypes/stage3/stage3.css 的 C 方向与
 *   classroom-ui 的 SKIN_PRESETS.library）。默认素材全自包含 SVG/CSS，零第三方图片。
 *   对话正文按**从真实游玩截图量出来的令牌**渲染（见 §2 的 TEXT_BAND），
 *   沿用「1920×1080 固定画布 ＋ JS 整体 scale」——画布内的纵向尺寸一律 px。
 *
 * 边界（必须诚实）：
 *   - live2d-host/out 未分发 → 立绘位**显式报「立绘未部署」**，不挂真实 Cubism、不白屏、不冒充。
 *   - 多角色同台未实现（本教室只有 1 张角色卡）→ 姓名条**只留接口**（真实界面本来也没有姓名牌）。
 *   - 本轮只做「代码 ＋ node 侧测试」；真实隔离会话的验收由主代理另跑，本文件不声称已验收。
 */

window.__ModuleLoader__.load({
	id: "classroom-stage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");

		// ════════════════════════════════════════════════════════════════════
		// 1 · 常量
		// ════════════════════════════════════════════════════════════════════

		/** 舞台条目 id。必须等于包名：boot 图与 slot 条目都按它派发。 */
		const TYPE_ID = "classroom-stage";
		/**
		 * 视图切换器上显示的名字。官方 `viewTabs()` 逐字读 `resolveSlotLabel(entry.options.label)`，
		 * 拿不到才退回 `id` → 中文名写这里就直接出现在切换器上。
		 */
		const PANEL_LABEL = "课堂舞台";
		/** 挂载点：会话级的视图座（只有它拿得到对话流）。 */
		const VIEW_SLOT = "conversation.view";
		/** 条目在切换器里的次序。官方 chat 视图是 0，我们排在它之后。 */
		const VIEW_ORDER = 100;

		/**
		 * 教室包在工作区里的相对路径（默认 cs-os），与 classroom-ui 同一手法：
		 * 相对路径按**会话工作区根**解析（`workspaceFiles` 的语义）。
		 * 换教室不必改代码：`globalThis.__DSH_CLASSROOM_STAGE_CONFIG__ = { root: '...' }`
		 * （只读全局配置，缺省用默认）。
		 */
		const DEFAULT_CLASSROOM_ROOT = "classrooms/cs-os";

		/** 面板要读的五个文件，键名即解析函数的入参名。 */
		const FILE = {
			manifest: "classroom.yaml",
			progress: "runtime/progress.md",
			curriculum: "curriculum.md",
			teacher: "characters/komari.md",
			/** 表情状态文件（本轮是否写了表情）。缺文件＝正常态，如实报 absent。 */
			expression: "runtime/expression.md",
		};

		/**
		 * 自包含占位立绘的底：必须是白的，且不能走主题 token——
		 * 与 classroom-ui 同一判据（Cubism 的 clearColor 不还原会让画布像素是白的）。
		 * 这里只是占位框，不挂 WebGL，故底用纸面同色即可。
		 */
		const PORTRAIT_PLACEHOLDER_BG = "#f3ead4";

		/**
		 * 固定画布：STAGE-3 的全部令牌都是在 1920×1080 的真实截图上量的，
		 * 所以舞台内部一律按这块画布排版，再由 JS 算一个整体 scale 适配宿主给的格子。
		 * 画布有确定的高度 → 里面的 `%` 能解析出确定值（见 §6 的说明）。
		 */
		const CANVAS = { width: 1920, height: 1080 };

		// ════════════════════════════════════════════════════════════════════
		// 2 · 配置与路径
		// ════════════════════════════════════════════════════════════════════

		function uiConfig() {
			const globalRef = typeof globalThis !== "undefined" ? globalThis : null;
			const cfg = globalRef !== null && globalRef.__DSH_CLASSROOM_STAGE_CONFIG__ !== undefined
				? globalRef.__DSH_CLASSROOM_STAGE_CONFIG__
				: null;
			return cfg === null || typeof cfg !== "object" ? {} : cfg;
		}

		function classroomRoot() {
			const configured = uiConfig().root;
			return typeof configured === "string" && configured.length > 0 ? configured : DEFAULT_CLASSROOM_ROOT;
		}

		function classroomPath(name) {
			return classroomRoot() + "/" + FILE[name];
		}

		// ════════════════════════════════════════════════════════════════════
		// 3 · 解析（与 classroom-ui 同一契约：按行取值、读不到即 null、不编默认值）
		// ════════════════════════════════════════════════════════════════════

		/** 去掉 yaml 行尾 `#` 注释（注释前至少一个空格，避免误删 URL 里的 #）。 */
		function stripComment(line) {
			const at = line.indexOf("#");
			if (at <= 0) return line;
			// 仅在 `#` 前是空白时才当注释（粗略但够用：classroom.yaml 注释都缩进且前面有空格）
			return /^\s|^\s*$/.test(line.slice(0, at)) ? line.slice(0, at) : line;
		}

		function parseManifest(text) {
			const result = { id: null, title: null, subject: null, lessons: null, phases: [] };
			let section = null;
			for (const raw of text.split("\n")) {
				const line = stripComment(raw);
				if (/^\s*$/.test(line)) continue;
				if (/^\S/.test(line)) {
					const top = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*$/);
					if (top !== null) section = top[1];
					else if (/^\S/.test(line) && !/^[A-Za-z_][A-Za-z0-9_]*:/.test(line)) section = null;
					if (section === "blocks") break;
					continue;
				}
				if (section === "classroom") {
					const entry = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
					if (entry === null) continue;
					const key = entry[1];
					const value = entry[2];
					if (value.length === 0) continue;
					if (key === "lessons") result.lessons = Number.parseInt(value, 10);
					else if (key === "id" || key === "title" || key === "subject") result[key] = value;
					continue;
				}
				if (section === "phases") {
					const phase = line.match(/^\s*-\s*\{\s*id:\s*([^,}]+?)\s*,\s*name:\s*([^}]+?)\s*\}\s*$/);
					if (phase !== null) result.phases.push({ id: phase[1], name: phase[2] });
				}
			}
			return result;
		}

		function tableValue(text, label) {
			const pattern = new RegExp("^\\|\\s*" + label + "\\s*\\|\\s*([^|]*?)\\s*\\|\\s*$", "m");
			const match = text.match(pattern);
			return match === null ? null : match[1];
		}

		function parseProgress(text) {
			const lessonLine = text.match(/^current_lesson:\s*(\d+)\s*$/m);
			const phaseLine = text.match(/^current_phase:\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/m);
			return {
				currentLesson: lessonLine === null ? null : Number.parseInt(lessonLine[1], 10),
				currentPhase: phaseLine === null ? null : phaseLine[1],
				teacher: tableValue(text, "当课老师"),
				progressText: tableValue(text, "课程进度"),
				humanLesson: tableValue(text, "本轮要讲"),
				doneCount: tableValue(text, "已完成"),
				lastDate: tableValue(text, "上次上课日期"),
			};
		}

		function parseCurriculum(text) {
			const lessons = [];
			let current = null;
			for (const raw of text.split("\n")) {
				const heading = raw.match(/^##\s*第\s*(\d+)\s*讲\s*[·・]\s*(.+?)\s*$/);
				if (heading !== null) {
					current = { n: Number.parseInt(heading[1], 10), title: heading[2], core: null };
					lessons.push(current);
					continue;
				}
				if (current === null || current.core !== null) continue;
				const core = raw.match(/^-\s*\*\*核心疑问\*\*[：:]\s*(.*)$/);
				if (core !== null) current.core = core[1].replace(/^\*+/, "").replace(/\*+$/, "").replace(/^\*+/, "").replace(/\*+$/, "").trim();
			}
			return lessons;
		}

		function parseTeacher(text) {
			return { name: tableValue(text, "名字"), scope: tableValue(text, "当课范围") };
		}

		// ════════════════════════════════════════════════════════════════════
		// 4 · 读盘（与 classroom-ui 同一分页通道；单文件失败不拖垮整块）
		// ════════════════════════════════════════════════════════════════════

		async function readText(remote, sessionId, path, signal) {
			const pages = [];
			let offset = 1;
			for (;;) {
				const result = await remote.workspaceFiles.read(sessionId, path, { offset }, signal);
				if (!result.ok) throw new Error(result.error.message);
				if (result.value.lines === 0) {
					if (result.value.eof) break;
					throw new Error("分页无进展：第 " + String(offset) + " 行起返回 0 行却未到末行（" + path + "）");
				}
				pages.push(result.value.text);
				if (result.value.eof) break;
				offset += result.value.lines;
			}
			return pages.join("\n");
		}

		/** 取真实 classroom 数据；单文件失败进 sources，对应字段 null，不静默。 */
		async function loadClassroom(ctx, sessionId, signal) {
			const names = Object.keys(FILE);
			const reads = await Promise.all(names.map(async (name) => {
				const path = classroomPath(name);
				try {
					return { name: name, path: path, ok: true, text: await readText(ctx.remote, sessionId, path, signal), error: null };
				} catch (error) {
					return { name: name, path: path, ok: false, text: null, error: messageOf(error) };
				}
			}));
			const byName = {};
			for (const read of reads) byName[read.name] = read;
			const sources = reads.map((read) => ({ name: read.name, path: read.path, ok: read.ok, error: read.error }));

			const manifest = byName.manifest.ok ? parseManifest(byName.manifest.text) : null;
			const progress = byName.progress.ok ? parseProgress(byName.progress.text) : null;
			const lessons = byName.curriculum.ok ? parseCurriculum(byName.curriculum.text) : [];
			const teacher = byName.teacher.ok ? parseTeacher(byName.teacher.text) : null;
			/** 表情文件不存在＝正常态；用 expressionPlan 产物如实标 absent。 */
			const expression = expressionPlan(byName.expression.ok ? byName.expression.text : null);

			const phases = manifest === null ? [] : manifest.phases;
			const currentPhase = progress === null ? null : progress.currentPhase;
			const phaseHit = phases.find((phase) => phase.id === currentPhase);
			const currentLesson = progress === null ? null : progress.currentLesson;
			const lessonHit = currentLesson === null ? undefined : lessons.find((lesson) => lesson.n === currentLesson);

			return {
				data: {
					classroomId: manifest === null ? null : manifest.id,
					title: manifest === null ? null : manifest.title,
					subject: manifest === null ? null : manifest.subject,
					lessonsTotal: manifest === null ? null : manifest.lessons,
					phases: phases,
					currentLesson: currentLesson,
					currentPhase: currentPhase,
					phaseName: phaseHit === undefined ? null : phaseHit.name,
					lessonTitle: lessonHit === undefined ? null : lessonHit.title,
					lessonCore: lessonHit === undefined ? null : lessonHit.core,
					teacher: progress !== null && progress.teacher !== null && progress.teacher !== "—" ? progress.teacher : (teacher === null ? null : teacher.name),
					teacherScope: teacher === null ? null : teacher.scope,
					progressText: progress === null ? null : progress.progressText,
					humanLesson: progress === null ? null : progress.humanLesson,
					doneCount: progress === null ? null : progress.doneCount,
					lastDate: progress === null ? null : progress.lastDate,
					lessons: lessons,
					expression: expression,
					/**
					 * 对话流读口的状态。
					 * 旧版挂在右侧栏时这里是 `"unsupported"`——那一层确实没有当前会话的消息读口。
					 * 现在挂到 `conversation.view`，宿主向该座提供 `useChat` / `useConversation`
					 * （实测该条目收到 19 个 props），所以是 `"supported"`。
					 * ⚠️ 「读得到」是宿主实测事实；「渲染出来好不好看」本轮没有真实会话验收。
					 */
					sessionReadAccess: "supported",
				},
				sources: sources,
			};
		}

		/** 表情状态文件解析（walking skeleton 只取存在与否与 source，不做参数驱动）。 */
		function expressionPlan(text) {
			if (text === null) return { source: "absent", parsed: null, reason: "runtime/expression.md 尚未被引擎写过（本轮还没宣布表情）→ 立绘沿用默认待机。" };
			return { source: "present", parsed: null, reason: "runtime/expression.md 已存在（本轮已写表情）。" };
		}

		function messageOf(error) {
			if (error === null || error === undefined) return "未知错误";
			if (typeof error === "string") return error;
			if (typeof error.message === "string") return error.message;
			try { return String(error); } catch { return "未知错误"; }
		}

		// ════════════════════════════════════════════════════════════════════
		// 5 · 会话流 → 对话正文（只有 conversation.view 这个座拿得到）
		// ════════════════════════════════════════════════════════════════════

		/**
		 * 只把这些 chat node 当「台词」显示：
		 *   - `assistant-step`：老师说的话（`data.blocks[]` 里**只有 `kind === "text"` 的块是台词**，
		 *     `reasoning` / `tool-call` 不是）；
		 *   - `user` / `steering`：学生自己说的（`data.content[]`）。
		 *
		 * 其余 kind（`context` / `command` / `system-prompt` / `developer-message` / `tool-call` /
		 * `turn-tail` / `turn-process` / `turn-trigger`）**一律不进舞台**——它们是上下文注入与
		 * 协议材料，不是「谁在说话」。
		 * 🔴 用**白名单**而不是黑名单：上游将来加新 kind 时默认是「不显示」，
		 *   不会突然把系统提示甩到舞台上。
		 */
		const SPEECH_KINDS = ["assistant-step", "user", "steering"];

		/** 没有会话流时的空快照：hook 缺失（例如 node 侧测试）也不崩，只是没有台词。 */
		const EMPTY_STREAM = { order: [], nodes: null, running: false };

		/**
		 * hook 缺失时的直通选择器。它不是真 hook，但**调用位置固定**（见 StageBody），
		 * 所以不违反 hook 规则；作用是让「宿主没给这个座接口」退化成「没有台词」，
		 * 而不是抛错白屏。
		 */
		function passthroughHook(selector) {
			return typeof selector === "function" ? selector(EMPTY_STREAM) : EMPTY_STREAM;
		}

		/** 取 hook：给了就用，没给就用直通版。 */
		function hookOr(provided) {
			return typeof provided === "function" ? provided : passthroughHook;
		}

		/** 按键取节点（`s.nodes` 是宿主 chat store 的节点表，`get(key)` 是它的公开读法）。 */
		function nodeAt(store, key) {
			if (store === null || store === undefined || typeof store.get !== "function") return undefined;
			return store.get(key);
		}

		/**
		 * 从一条 chat node 里取出台词文本；不是台词的节点返回 null。
		 * 🔴 两种块形状都要认：assistant 的块用 `kind` 字段、user 的块用 `type` 字段——
		 *   这是上游两套消息模型（assistant lifecycle 与 input message）的真实差别，不是笔误。
		 */
		function speechTextOf(node) {
			if (node === null || typeof node !== "object") return null;
			if (node.visibility === "hidden") return null;
			const data = node.data;
			if (data === null || typeof data !== "object") return null;
			if (Array.isArray(data.blocks)) {
				const parts = [];
				for (const block of data.blocks) {
					if (block !== null && typeof block === "object" && block.kind === "text" && typeof block.text === "string") parts.push(block.text);
				}
				const joined = parts.join("");
				return joined === "" ? null : joined;
			}
			if (Array.isArray(data.content)) {
				const parts = [];
				for (const block of data.content) {
					if (block !== null && typeof block === "object" && block.type === "text" && typeof block.text === "string") parts.push(block.text);
				}
				const joined = parts.join("");
				return joined === "" ? null : joined;
			}
			if (typeof data.text === "string" && data.text !== "") return data.text;
			return null;
		}

		/**
		 * 段落切分。舞台是按「段」排版的（段间空一行），所以换行即分段；
		 * 不按句号拆——真实界面里一行是什么就是什么，拆句等于替作者改写。
		 */
		function splitParagraphs(text) {
			return String(text).split(/\n+/).map((line) => line.trim()).filter((line) => line !== "");
		}

		/** 把会话流拉成台词序列：`{source, text}`，`source` 是 `"teacher"` 或 `"user"`。 */
		function speechLines(order, store) {
			const lines = [];
			if (!Array.isArray(order)) return lines;
			for (const key of order) {
				const node = nodeAt(store, key);
				if (node === null || node === undefined) continue;
				if (typeof node.kind !== "string" || SPEECH_KINDS.indexOf(node.kind) < 0) continue;
				const text = speechTextOf(node);
				if (text === null) continue;
				const source = node.kind === "assistant-step" ? "teacher" : "user";
				for (const paragraph of splitParagraphs(text)) lines.push({ source: source, text: paragraph });
			}
			return lines;
		}

		/**
		 * 台词 → 正文带的条目。
		 * 🔴 **只有最后一段是「当前行」**，其余全是「旧行」——两者**字号完全相同**，
		 *   只差字色（#ffffff / #cccccc）。这是从真实截图量出来的最独特的一条。
		 */
		function bandItems(lines) {
			const items = [];
			for (let index = 0; index < lines.length; index += 1) {
				const current = index === lines.length - 1;
				items.push({
					source: lines[index].source,
					text: lines[index].text,
					current: current,
					color: current ? TEXT_BAND.colorCurrent : TEXT_BAND.colorOld,
				});
			}
			return items;
		}

		/**
		 * 姓名条计划。
		 * 🔴 **真实界面里不存在姓名牌**（STAGE-3 §2.1：四张真实对话画面「没有任何姓名牌、
		 *   姓名条、名字气泡」，姓名排在正文里用「」包台词）→ 默认不画。
		 * 多角色同台（R15）才启用「短册」形态（奶白纸面 ＋ 淡黄发丝边 ＋ 极小圆角），
		 * 而本教室目前只有 1 张角色卡 → **本轮只留接口，不实现渲染**。
		 */
		function nameTagPlan(present) {
			const list = Array.isArray(present) ? present : [];
			if (list.length < 2) {
				return {
					draw: false,
					reason: "在场角色不足两人（本教室只有 1 张角色卡）→ 按真实界面不画姓名条",
					slots: [],
				};
			}
			return {
				draw: true,
				reason: "多角色同台 → 该启用「短册」形态，但本轮未实现渲染",
				slots: list,
			};
		}

		// ════════════════════════════════════════════════════════════════════
		// 6 · 会话级共享 store（与 classroom-ui 同一手法：按 sessionId 缓存）
		// ════════════════════════════════════════════════════════════════════

		const stores = new Map();

		function idleSnapshot() {
			return { status: "idle", error: null, data: null, sources: [] };
		}

		function storeFor(ctx, sessionId) {
			let entry = stores.get(sessionId);
			if (entry === undefined) {
				entry = { snapshot: idleSnapshot(), listeners: new Set(), loading: null };
				stores.set(sessionId, entry);
			}
			const emit = () => { for (const listener of Array.from(entry.listeners)) listener(); };
			const publish = (snapshot) => { entry.snapshot = snapshot; emit(); };
			const refresh = () => {
				if (entry.loading !== null) return entry.loading;
				const previous = entry.snapshot;
				publish({ status: "loading", error: null, data: previous.data, sources: previous.sources });
				entry.loading = loadClassroom(ctx, sessionId, new AbortController().signal).then(
					(result) => { entry.loading = null; publish({ status: "ready", error: null, data: result.data, sources: result.sources }); },
					(error) => { entry.loading = null; publish({ status: "failed", error: messageOf(error), data: previous.data, sources: previous.sources }); },
				);
				return entry.loading;
			};
			return {
				subscribe: (listener) => { entry.listeners.add(listener); return () => { entry.listeners.delete(listener); }; },
				getSnapshot: () => entry.snapshot,
				refresh: refresh,
			};
		}

		// ════════════════════════════════════════════════════════════════════
		// 7 · 视觉令牌（借 STAGE-3 的 B 讲台骨架 ＋ C 書庫材质）
		//
		// 🔴 对话正文那一组（TEXT_BAND）**逐条来自真实游玩截图**，出处是
		//   `实现报告_STAGE3_按真实参考重做_2026-09-24.md` §2.1（依据图 U1 = 官方商店
		//   1920×1080 截图，另有 U3 交叉验证）。它们**不是偏好、不是推断**——
		//   本文件不解释这些数、也不"顺手改得更好看"；要改必须先有新的真实素材。
		//
		// 🔴 层级只靠 字号 · 字距 · 字色阶梯 · 字面（sans/serif/mono），不许靠加粗。
		//   与项目硬规矩（2026-09-18 立）一致，故这里没有 fontWeight。
		// ════════════════════════════════════════════════════════════════════

		/**
		 * 对话正文字形令牌。**没有框、没有底、没有投影**——真实界面的文字直接压在画面上
		 * （实测文字带内外行亮度 76.0 vs 78.2 / 71.7，差异在噪声级）。
		 */
		const TEXT_BAND = {
			/** 文字列左边界 331/1920。 */
			leftPct: 17.2,
			/** 文字列右边界 1539/1920（剔除推进指示器后）⇒ 右边距 = 100 − 80.2 = 19.8%。 */
			rightPct: 80.2,
			/** 文本带纵向锚点：**顶对齐** 14.9%（三条独立真实帧一致：14.4%–15.3%）。不是贴底。 */
			topPct: 14.9,
			/** 正文字面高（含描边）：真实 44px 字面 ＋ 描边；CJK 字面≈0.92em ⇒ 字号 47px。 */
			fontSizePx: 47,
			/** 行距：相邻行顶差实测 81px（U3 交叉验证 165→246→327）⇒ 82/47 ≈ 1.74。 */
			lineHeight: 1.74,
			/** 描边：白字 ＋ 深色描边 ≈2–3px，用 8 向 text-shadow 环实现（见 BODY_TEXT_SHADOW）。 */
			strokePx: 2,
			/**
			 * 旧行 / 当前行：🔴 **字号完全相同**，只差亮度——真实字心平均亮度 177.4 / 221.2，
			 * 比值 0.80。**这是真实界面最独特的一条**，不能顺手做成"当前行更大"。
			 */
			colorOld: "#cccccc",
			colorCurrent: "#ffffff",
			/** 推进指示器：青色梯形 33×30px，**跟在末行末尾**（不是固定角落）。 */
			advanceWidthPx: 33,
			advanceHeightPx: 30,
			/** 发丝花饰：屏幕上下各一条居中藤蔓曲线，近白、1px 线、46% 宽。 */
			flourishPct: 46,
			flourishStrokePx: 1,
		};

		/**
		 * 画布内的版面锚点（px，画布空间）。
		 * 🔴 纵向尺寸一律 px：这块画布虽然有确定高度，但把 `vh` 之类的视口单位带进来，
		 *   会在「容器高度 auto」处静默失效（症状是「看起来只是有点小」，不是报错）——
		 *   这是 STAGE-3 踩过的坑。
		 */
		const LAYOUT = {
			/** 顶部书脊条（14 讲）与课堂名同处一行。 */
			spineBarTopPx: 30,
			spineHeightPx: 120,
			spineWidthPx: 30,
			spineGapPx: 6,
			/** 上下两条发丝花饰的位置。 */
			flourishTopPx: 6,
			flourishBottomPx: 52,
			flourishHeightPx: 16,
			/**
			 * 正文带的最大高度：下面要留给元信息条与花饰。
			 * 超出时不滚动、不从底部裁——由 SpeechBand 的 flex-end 布局**从顶部裁掉旧文**，
			 * 保证最新一行永远看得见（不需要任何"估算折行数"的启发式）。
			 */
			bandMaxHeightPx: 700,
			/** 立绘列（右侧 19.8% 的留白正好当讲台位）。 */
			portraitTopPx: 176,
			portraitHeightPx: 520,
			portraitColumnPx: 340,
			/** 底部元信息条。 */
			metaBottomPx: 76,
		};

		/**
		 * 画布空间字阶（px）。
		 * 🔴 与画布**外**的宿主侧栏不是一套：侧栏按 1:1 像素显示，用 typeRole 的 11–16px 阶梯；
		 * 画布会被整体缩小（典型 0.4–0.5 倍），所以画布里的元信息必须按画布尺度给字号，
		 * 否则缩完只剩 5–6px，读不出来。正文 47px 是实测令牌（TEXT_BAND），不在本表。
		 */
		const CANVAS_TYPE = { title: 34, meta: 24, label: 20, caption: 18 };

		/**
		 * 8 向 text-shadow 环（描边）。比 `-webkit-text-stroke` 更能保住字面宽度，
		 * 也不需要 `paint-order`。半径取令牌的 strokePx = 2px，斜向 1.5px。
		 */
		const BODY_TEXT_SHADOW = [
			"2px 0 0 rgba(0,0,0,.82)", "-2px 0 0 rgba(0,0,0,.82)",
			"0 2px 0 rgba(0,0,0,.82)", "0 -2px 0 rgba(0,0,0,.82)",
			"1.5px 1.5px 0 rgba(0,0,0,.82)", "-1.5px 1.5px 0 rgba(0,0,0,.82)",
			"1.5px -1.5px 0 rgba(0,0,0,.82)", "-1.5px -1.5px 0 rgba(0,0,0,.82)",
		].join(", ");

		const SANS = 'var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif)';
		const MONO = "var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";
		const SERIF = '"Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", Georgia, serif';
		/** 正文字族：真实界面是**无衬线（黑体）＋重描边**（U1 放大 4× 目视：笔画等宽、无三角收笔），不是衬线。 */
		const BODY_FONT = SANS;

		/** 書庫纸面/木框/金褐色调（对 prototypes/stage3/stage3.css C 方向与 classroom-ui library 参数）。 */
		const PAPER_LIGHT = "linear-gradient(180deg, #FBF7E4, #F1EAD4)";
		const PAPER_INNER = "#F2E9A8";
		const WOOD = "linear-gradient(180deg, #7a4f28, #4a2c17 42%, #3a2210)";
		const GOLD = "#c9a86a";
		const GOLD_RULE = "rgba(154, 120, 60, 0.55)";
		const READ_ORANGE = "#e0603a";
		const SPINE_TODO = "linear-gradient(180deg, #6b4423, #3a2210)";
		const SPINE_DONE = "linear-gradient(180deg, #8a6236, #4a2c17)";

		/**
		 * 字色四级阶梯。
		 * 🔴 **不走宿主主题 alias**：画布自带奶白纸面（PAPER_LIGHT / 書庫底），而主题 alias 在深色
		 * 主题下是近白字——白字压白纸会看不见。舞台是一整套自带材质的皮肤，字色必须跟着材质走。
		 */
		function ink(level) {
			const map = {
				1: "#2a2318",
				2: "#4a4136",
				3: "#6b6052",
				4: "#8c8175",
			};
			return map[level] || map[2];
		}

		/** 从「0 讲」这类人读值里取数；取不到就是 0（不猜）。 */
		function parseCount(value) {
			if (value === null || value === undefined) return 0;
			return Number.parseInt(String(value).replace(/[^\d]/g, ""), 10) || 0;
		}

		/** px 值统一出口：给了数就用画布空间的 px，没给就退回宿主侧栏用的字阶。 */
		function px(value, fallback) {
			return value === undefined || value === null ? fallback : value + "px";
		}

		/**
		 * 百分比统一出口（保留一位小数）。
		 * 不这么写的话 `100 − 80.2` 会吐出 `19.799999999999997%`——CSS 能认，
		 * 但写进 data 属性就成了一串噪声，断言也没法逐字对。
		 */
		function pct(value) {
			return String(Math.round(value * 10) / 10) + "%";
		}

		function typeRole(step, family, tracking, leading) {
			const steps = {
				"xxxs-11": ["11px", "14px"],
				"xxs-12": ["12px", "18px"],
				"xs-13": ["13px", "20px"],
				"s-14": ["14px", "22px"],
				"base-16": ["16px", "24px"],
			};
			const pair = steps[step] || steps["xxs-12"];
			return {
				fontSize: pair[0],
				lineHeight: leading === undefined ? pair[1] : leading,
				fontFamily: family === "mono" ? MONO : family === "serif" ? SERIF : SANS,
				letterSpacing: tracking,
			};
		}

		// ════════════════════════════════════════════════════════════════════
		// 8 · 自包含 SVG 占位（场景/立绘剪影/发丝花饰，data:URI，零网络请求）
		// ════════════════════════════════════════════════════════════════════

		function dataURI(svg) {
			return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
		}

		/** 书库背景占位：木纹框 + 纸面（纯 SVG，自包含）。 */
		function libraryBackdropSVG() {
			return dataURI(
				'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="900" viewBox="0 0 640 900">' +
				'<rect width="640" height="900" fill="#3a2210"/>' +
				'<rect x="14" y="14" width="612" height="872" rx="6" fill="url(#w)"/>' +
				'<defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1">' +
				'<stop offset="0" stop-color="#7a4f28"/><stop offset="0.42" stop-color="#4a2c17"/><stop offset="1" stop-color="#3a2210"/>' +
				'</linearGradient>' +
				'<linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBF7E4"/><stop offset="1" stop-color="#F1EAD4"/></linearGradient></defs>' +
				'<rect x="40" y="40" width="560" height="820" rx="4" fill="url(#p)" stroke="#F2E9A8" stroke-width="1"/>' +
				'<rect x="40" y="40" width="560" height="820" rx="4" fill="none" stroke="' + GOLD + '" stroke-opacity="0.35" stroke-width="1"/>' +
				'</svg>',
			);
		}

		/** 立绘剪影占位（300×1080 窄长比例，与真立绘同形；画布里不写文字）。 */
		function portraitSilhouetteSVG(hue) {
			return dataURI(
				'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="1080" viewBox="0 0 300 1080">' +
				'<rect width="300" height="1080" fill="' + PORTRAIT_PLACEHOLDER_BG + '"/>' +
				'<ellipse cx="150" cy="250" rx="78" ry="92" fill="hsl(' + hue + ',30%,62%)"/>' +
				'<path d="M40 1080 C40 760 90 560 150 540 C210 560 260 760 260 1080 Z" fill="hsl(' + hue + ',28%,55%)"/>' +
				'</svg>',
			);
		}

		/**
		 * 发丝花饰：一条居中的藤蔓／羽状曲线（近白、1px 线）。
		 * 真实截图里屏幕**上下各一条**（U1/U2/U3/U6 四处都有），所以画两条同样的。
		 * 宽度取令牌的 46% 屏宽 = 883/1920。
		 */
		function flourishSVG() {
			const width = Math.round(CANVAS.width * TEXT_BAND.flourishPct / 100);
			const mid = width / 2;
			const inkLine = "#f4f8fa";
			return dataURI(
				'<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + LAYOUT.flourishHeightPx + '" viewBox="0 0 ' + width + ' ' + LAYOUT.flourishHeightPx + '">' +
				'<g fill="none" stroke="' + inkLine + '" stroke-opacity="0.78" stroke-width="' + TEXT_BAND.flourishStrokePx + '" stroke-linecap="round">' +
				'<path d="M0 8 C 150 8, 300 1.5, ' + mid + ' 7.6"/>' +
				'<path d="M' + width + ' 8 C ' + (width - 150) + ' 8, ' + (width - 300) + ' 1.5, ' + mid + ' 7.6"/>' +
				'<path d="M' + (mid - 26) + ' 5.2 C ' + (mid - 9) + ' 3.4, ' + (mid + 9) + ' 3.4, ' + (mid + 26) + ' 5.2"/>' +
				'<ellipse cx="' + mid + '" cy="7.6" rx="4.5" ry="3.2" fill="' + inkLine + '" fill-opacity="0.55" stroke="none"/>' +
				'</g></svg>',
			);
		}

		/**
		 * 画布底：書庫木框 ＋ 奶白纸面。
		 * 缓存一份——它是每次渲染都会用到的背景，字符串拼接不该每帧重跑。
		 * 真实界面里文字**直接压在画面**上（无框无底），这里的"画面"就是这张書庫底。
		 */
		let backdropCache = null;
		function stageBackdrop() {
			if (backdropCache === null) backdropCache = libraryBackdropSVG();
			return backdropCache;
		}

		// ════════════════════════════════════════════════════════════════════
		// 9 · 组件
		// ════════════════════════════════════════════════════════════════════

		/**
		 * 一行「标签｜值」。值为 null 时显示「未提供」，不编造。
		 * `fontPx` 可给画布空间的字号；不给就用宿主侧栏那一套（12px 值 / 11px 标签）。
		 */
		function Field(props) {
			const fontPx = props.fontPx;
			const shown = props.value === null || props.value === undefined || props.value === "" ? "未提供" : props.value;
			const style = Object.assign({ display: "flex", gap: "10px", alignItems: "baseline" }, typeRole("xxs-12", "sans", "0.01em"));
			const labelStyle = Object.assign({}, typeRole("xxxs-11", "sans", "0.14em"), {
				fontSize: px(fontPx === undefined ? undefined : Math.max(12, fontPx - 4), "11px"),
				color: ink(3), flex: "0 0 auto",
			});
			const valueStyle = Object.assign({}, typeRole("xxs-12", "sans", "0.01em"), {
				fontSize: px(fontPx, "12px"),
				color: props.value === null || props.value === "" ? ink(4) : ink(1), overflowWrap: "anywhere",
			});
			return React.createElement("div", { style: style, "data-cs-field": props.label },
				React.createElement("span", { style: labelStyle }, props.label),
				React.createElement("span", { style: valueStyle }, shown),
			);
		}

		/**
		 * 书脊课程表（一排书脊＝每讲一格，点击选中＝真实 handler）。
		 * `metrics` 可给画布空间的尺寸；**缺省值就是原来宿主侧栏那一套**（34×150、间隙 4）——
		 * 因为画布会被整体缩小，书脊在画布里必须换一套尺寸，否则 14 根书脊会把整个顶栏占满。
		 * `currentLesson` 上的橙红圆点是「既读点」（真实界面：部分书脊上有一枚橙红色圆形标记）。
		 */
		function CurriculumSpines(props) {
			const lessons = props.lessons || [];
			const metrics = props.metrics || {};
			const width = metrics.width === undefined ? 34 : metrics.width;
			const height = metrics.height === undefined ? 150 : metrics.height;
			const gap = metrics.gap === undefined ? 4 : metrics.gap;
			const doneN = parseCount(props.doneCount);
			const spines = lessons.map((lesson) => {
				const done = lesson.n <= doneN;
				const selected = props.selectedLesson === lesson.n;
				const current = props.currentLesson === lesson.n;
				const spineStyle = {
					flex: "0 0 auto",
					width: width + "px",
					height: height + "px",
					borderRadius: "2px 2px 0 0",
					background: done ? SPINE_DONE : SPINE_TODO,
					border: selected ? "1.5px solid " + READ_ORANGE : "0.5px solid " + GOLD_RULE,
					cursor: "pointer",
					position: "relative",
					display: "flex",
					alignItems: "flex-end",
					justifyContent: "center",
					paddingBottom: "8px",
					boxSizing: "border-box",
					// 🔴 指针策略逐元素显式声明，不依赖继承（C-1）：书脊是控件 → auto
					pointerEvents: "auto",
				};
				const numStyle = Object.assign({}, typeRole("xxxs-11", "serif", "0.04em"), {
					fontSize: px(metrics.fontPx, "11px"),
					color: "#f3ead4", writingMode: "vertical-rl", textOrientation: "upright",
				});
				const dot = current
					? React.createElement("span", {
						key: "read-dot",
						"data-cs-read-dot": lesson.n,
						"aria-hidden": "true",
						style: {
							position: "absolute", top: "8px", left: "50%",
							width: "12px", height: "12px", marginLeft: "-6px",
							borderRadius: "50%", background: READ_ORANGE,
						},
					})
					: null;
				return React.createElement("button", {
					type: "button",
					key: "spine-" + lesson.n,
					className: "cs-act",
					"data-cs-spine": lesson.n,
					"aria-pressed": selected ? "true" : "false",
					style: spineStyle,
					onClick: () => props.onSelect(lesson.n),
					title: "第 " + lesson.n + " 讲 · " + lesson.title,
				}, dot, React.createElement("span", { key: "num", style: numStyle }, String(lesson.n).padStart(2, "0")));
			});
			const wrapStyle = { display: "flex", gap: gap + "px", alignItems: "flex-end", overflowX: "auto", paddingBottom: "4px" };
			return React.createElement("div", { style: wrapStyle, "data-cs-spines": "true" }, spines);
		}

		/** 立绘位：**显式报「立绘未部署」**（live2d-host/out 未分发），不挂真 Cubism、不白屏、不冒充。 */
		function PortraitStage(props) {
			const children = [];
			const labelStyle = Object.assign({}, typeRole("xxxs-11", "sans", "0.16em"), {
				fontSize: px(props.labelPx, "11px"), color: ink(3), marginBottom: "6px",
			});
			children.push(React.createElement("div", { style: labelStyle, key: "label" }, "讲台 · 立绘"));
			// 占位剪影（自包含 SVG）。🔴 指针策略显式声明，不依赖继承（C-1）：立绘不是控件 → none
			const imgStyle = {
				height: (props.heightPx === undefined ? 420 : props.heightPx) + "px",
				width: "auto", borderRadius: "2px", display: "block", opacity: "0.9", margin: "0 auto",
				pointerEvents: "none",
			};
			children.push(React.createElement("img", {
				key: "silhouette",
				alt: "老师立绘占位",
				src: portraitSilhouetteSVG(18),
				style: imgStyle,
				"data-cs-portrait": "placeholder",
			}));
			// 明确未部署状态（不挂真 Cubism、不白屏、不冒充）
			const noteStyle = Object.assign({}, typeRole("xxxs-11", "sans", "0.02em"), {
				fontSize: px(props.fontPx, "11px"), lineHeight: "1.55",
				color: ink(2), marginTop: "10px", padding: "8px 10px", borderRadius: "3px",
				background: "rgba(224, 96, 58, 0.08)", border: "0.5px solid rgba(224, 96, 58, 0.35)", overflowWrap: "anywhere",
			});
			children.push(React.createElement("div", {
				key: "status",
				"data-cs-portrait-status": "undeployed",
				style: noteStyle,
			}, "立绘未部署：live2d-host/out（Cubism 样本与构建产物）本仓库未分发。这里只显示占位剪影，不挂真实模型、不冒充已部署。"));
			return React.createElement("div", { style: { display: "flex", flexDirection: "column" }, "data-cs-portrait-stage": "true" }, children);
		}

		/**
		 * 推进指示器：青色梯形 33×30px，**跟在末行文字末尾**。
		 * 它是个 inline 元素而不是定位在角落的方块——真实截图里它就是跟着末行走的。
		 * 闪烁关键帧由 ensureAdvanceKeyframes() 注入（宿主不转译我们的文件，没有 CSS 文件可用）。
		 */
		function AdvanceIndicator() {
			return React.createElement("span", {
				"data-cs-adv": "true",
				"aria-hidden": "true",
				style: {
					display: "inline-block",
					width: TEXT_BAND.advanceWidthPx + "px",
					height: TEXT_BAND.advanceHeightPx + "px",
					marginLeft: "10px",
					verticalAlign: "-2px",
					background: "linear-gradient(90deg,#ffffff 0%,#7fe8ff 45%,#2ea8d8 100%)",
					clipPath: "polygon(0 18%,100% 0,100% 100%,0 82%)",
					animation: "cs-advance 1.4s ease-in-out infinite",
					// 🔴 指针策略显式声明，不依赖继承（C-1）：指示器不是控件 → none
					pointerEvents: "none",
				},
			});
		}

		/** 发丝花饰：屏幕上下各一条（同一条曲线），近白、1px 线、46% 宽。纯装饰，不接指针。 */
		function Flourish(props) {
			const widthPct = TEXT_BAND.flourishPct;
			const style = {
				position: "absolute",
				left: pct((100 - widthPct) / 2),
				width: widthPct + "%",
				height: LAYOUT.flourishHeightPx + "px",
				opacity: "0.78",
				pointerEvents: "none",
			};
			if (props.edge === "top") style.top = LAYOUT.flourishTopPx + "px";
			else style.bottom = LAYOUT.flourishBottomPx + "px";
			return React.createElement("img", {
				alt: "",
				"aria-hidden": "true",
				"data-cs-flourish": props.edge,
				src: flourishSVG(),
				style: style,
			});
		}

		/**
		 * 对话正文带。**没有框、没有底、没有投影**——真实界面的文字直接压在画面上。
		 *
		 * 纵向：锚点**顶对齐** 14.9%，向下生长（不是贴底）。
		 * 内容超长时用 `justifyContent:'flex-end'` ＋ `overflow:'hidden'` ＋ `maxHeight`：
		 * 容器被高度封顶后，flex-end 会把**超出的部分推到上边**并被裁掉 →
		 * 「旧的被裁、最新一行永远看得见」。这样不需要任何"估算折行数"的启发式，
		 * 纯粹由布局决定。顶部再压一道渐隐，免得看起来像被切了一半。
		 */
		function SpeechBand(props) {
			const box = {
				position: "absolute",
				left: pct(TEXT_BAND.leftPct),
				right: pct(100 - TEXT_BAND.rightPct),
				top: TEXT_BAND.topPct + "%",
				maxHeight: LAYOUT.bandMaxHeightPx + "px",
				display: "flex",
				flexDirection: "column",
				justifyContent: "flex-end",
				overflow: "hidden",
				fontFamily: BODY_FONT,
				fontSize: TEXT_BAND.fontSizePx + "px",
				lineHeight: String(TEXT_BAND.lineHeight),
				letterSpacing: "0.01em",
				textShadow: BODY_TEXT_SHADOW,
				// 顶部渐隐：被裁掉的旧文淡出，而不是被硬切
				maskImage: "linear-gradient(180deg, transparent 0px, #000 " + TEXT_BAND.fontSizePx + "px)",
				WebkitMaskImage: "linear-gradient(180deg, transparent 0px, #000 " + TEXT_BAND.fontSizePx + "px)",
				// 🔴 指针策略显式声明，不依赖继承（C-1）：正文带不是控件 → none
				pointerEvents: "none",
			};
			if (props.items.length === 0) {
				const noteStyle = Object.assign({}, box, {
					fontSize: CANVAS_TYPE.meta + "px",
					lineHeight: "1.6",
					letterSpacing: "0.02em",
					textShadow: "none",
					color: ink(3),
					maxHeight: "none",
					maskImage: "none",
					WebkitMaskImage: "none",
				});
				return React.createElement("div", {
					"data-cs-speech": "empty",
					"data-cs-stream": props.stream,
					style: noteStyle,
				}, props.emptyNote);
			}
			const children = props.items.map((item, index) => {
				const lineStyle = {
					// 段间距 ≈ 两倍行距（中间空一行）：除首段外，每段上方让出一行
					marginTop: index === 0 ? "0px" : TEXT_BAND.fontSizePx + "px",
					color: item.color,
					// 🔴 旧行与当前行**字号完全相同**，只差字色
					fontSize: TEXT_BAND.fontSizePx + "px",
				};
				return React.createElement("div", {
					key: "line-" + index,
					"data-cs-line": item.current ? "current" : "old",
					"data-cs-line-source": item.source,
					style: lineStyle,
				}, item.text, item.current ? React.createElement(AdvanceIndicator, { key: "adv" }) : null);
			});
			return React.createElement("div", {
				"data-cs-speech": "lines",
				"data-cs-stream": props.stream,
				"data-cs-line-count": String(props.items.length),
				style: box,
			}, children);
		}

		/** 没有 store 时的空快照。必须是**稳定引用**，否则 useSyncExternalStore 会无限重渲染。 */
		const NO_STORE_SNAPSHOT = { status: "idle", error: null, data: null, sources: [] };

		/** 没有 store 时的空订阅。 */
		function noopSubscribe() { return () => {}; }

		/**
		 * 舞台主体：固定 1920×1080 画布 ＋ JS 整体 scale。
		 * 画布内部一律画布空间 px，容器尺寸只影响一个缩放系数。
		 */
		function StageBody(props) {
			const store = props.classroom;
			const [selectedLesson, setSelectedLesson] = React.useState(null);
			const [scale, setScale] = React.useState(1);
			const hostRef = React.useRef(null);

			const subscribe = store === null ? noopSubscribe : store.subscribe;
			const getSnapshot = store === null ? (() => NO_STORE_SNAPSHOT) : store.getSnapshot;
			const snapshot = React.useSyncExternalStore(subscribe, getSnapshot);
			React.useEffect(() => { if (store !== null && snapshot.status === "idle") store.refresh(); }, [snapshot.status, store]);

			// 🔴 三个会话 hook **无条件调用**（宿主没给就退化成直通版）：
			//   否则 hook 的调用顺序会随宿主能力变化，直接违反 hook 规则。
			const useChat = hookOr(props.useChat);
			const useSession = hookOr(props.useSession);
			const order = useChat((state) => state.order);
			const nodeStore = useChat((state) => state.nodes);
			const running = useSession((state) => state.running);

			const items = bandItems(speechLines(order, nodeStore));
			const stream = typeof props.useChat !== "function" ? "unavailable" : (items.length === 0 ? "empty" : "live");
			const data = snapshot.data;
			const S = styles();

			// 画布整体缩放（letterbox）：容器尺寸千变万化，画布内部尺寸一个不动。
			React.useEffect(() => {
				const host = hostRef.current;
				if (host === null || host === undefined || typeof ResizeObserver === "undefined") return undefined;
				const measure = () => {
					const rect = host.getBoundingClientRect();
					if (rect.width <= 0 || rect.height <= 0) return;
					setScale(Math.min(rect.width / CANVAS.width, rect.height / CANVAS.height));
				};
				measure();
				const observer = new ResizeObserver(measure);
				observer.observe(host);
				return () => { observer.disconnect(); };
			}, []);

			// 截图入口的登记：每次渲染刷新一份「真实 DOM 节点 ＋ 帧描述」，
			// 供验收脚本调 captureFrame(sessionId) 取用（见 §10）。
			React.useEffect(() => {
				const sessionId = props.sessionId;
				if (typeof sessionId !== "string" || sessionId === "") return undefined;
				frameRegistry.set(sessionId, {
					element: hostRef.current,
					scale: scale,
					lines: items,
					classroom: data === null ? null : {
						title: data.title,
						lesson: data.currentLesson,
						lessonTitle: data.lessonTitle,
						phase: data.currentPhase,
						phaseName: data.phaseName,
						teacher: data.teacher,
					},
				});
				return () => { frameRegistry.delete(sessionId); };
			});

			const statusText = snapshot.status === "loading" ? "读盘中…"
				: snapshot.status === "failed" ? ("读盘失败：" + (snapshot.error || "未知"))
					: snapshot.status === "ready" ? (running === true ? "已读取教室文件 · 引擎正在说话" : "已读取教室文件")
						: "待读取";

			const canvasChildren = [];
			canvasChildren.push(React.createElement(Flourish, { key: "flourish-top", edge: "top" }));

			// 顶部：左边 14 根书脊（当前讲一枚橙红既读点），右边课堂名
			canvasChildren.push(React.createElement("div", { key: "top", style: S.topBar, "data-cs-top": "true" },
				React.createElement(CurriculumSpines, {
					key: "spines",
					lessons: data === null ? [] : data.lessons,
					doneCount: data === null ? null : data.doneCount,
					currentLesson: data === null ? null : data.currentLesson,
					selectedLesson: selectedLesson,
					onSelect: (n) => setSelectedLesson(n === selectedLesson ? null : n),
					metrics: {
						width: LAYOUT.spineWidthPx,
						height: LAYOUT.spineHeightPx,
						gap: LAYOUT.spineGapPx,
						fontPx: CANVAS_TYPE.caption,
					},
				}),
				React.createElement("div", { key: "titles", style: S.topTitles },
					React.createElement("div", { style: S.title, "data-cs-title": data !== null && data.title !== null ? data.title : "" },
						data === null || data.title === null ? "课堂舞台" : data.title),
					React.createElement("div", { style: S.subtitle, "data-cs-subject": data !== null && data.subject !== null ? data.subject : "" },
						data === null || data.subject === null ? "读取中…" : (data.subject + " · 共 " + (data.lessonsTotal === null ? "?" : data.lessonsTotal) + " 讲")),
				),
			));

			// 中部主区：对话正文（本次新做的核心）
			canvasChildren.push(React.createElement(SpeechBand, {
				key: "band",
				items: items,
				stream: stream,
				emptyNote: stream === "unavailable"
					? "宿主未向本视图提供对话流读口（useChat 缺失）→ 舞台只显示教室文件里的课程信息，不冒充台词。"
					: "本会话还没有台词（引擎还没开口）。",
			}));

			// 右侧：讲台／立绘位（正好落在正文带右边距 19.8% 的留白里）
			canvasChildren.push(React.createElement("div", { key: "podium", style: S.podium, "data-cs-podium": "true" },
				React.createElement(PortraitStage, {
					key: "portrait",
					heightPx: LAYOUT.portraitHeightPx,
					fontPx: CANVAS_TYPE.caption,
					labelPx: CANVAS_TYPE.label,
				}),
				React.createElement(SelectedLessonDetail, {
					key: "selected",
					lesson: data === null || selectedLesson === null ? null : data.lessons.find((lesson) => lesson.n === selectedLesson),
					fontPx: CANVAS_TYPE.caption,
				}),
			));

			// 底部：元信息（老师／讲次／进度／相位）＋ 读盘状态 ＋ 控制
			canvasChildren.push(React.createElement("div", { key: "meta", style: S.meta, "data-cs-meta": "true" },
				React.createElement("div", { key: "fields", style: S.fields },
					React.createElement(Field, { label: "当课老师", value: data === null ? null : data.teacher, fontPx: CANVAS_TYPE.caption }),
					React.createElement(Field, { label: "本轮要讲", value: data === null ? null : data.humanLesson, fontPx: CANVAS_TYPE.caption }),
					React.createElement(Field, { label: "课程进度", value: data === null ? null : data.progressText, fontPx: CANVAS_TYPE.caption }),
					React.createElement(Field, {
						label: "当前相位",
						value: data === null ? null : (data.phaseName === null ? data.currentPhase : data.phaseName),
						fontPx: CANVAS_TYPE.caption,
					}),
					React.createElement(Field, { label: "上次上课", value: data === null ? null : data.lastDate, fontPx: CANVAS_TYPE.caption }),
				),
				React.createElement("div", { key: "controls", style: S.controls },
					React.createElement("div", { key: "state", style: S.state, "data-cs-status": snapshot.status }, statusText),
					// 🔴 「回到对话」是**必需品，不是便利品**：视图选择按会话持久化（实测），
					//   刷新页面会回到舞台、学生不会被自动送回对话 → 舞台必须自带一个显式出口，
					//   不能只指望官方切换器里那个 tab。宿主没给 `openView` 时按钮不出（不画死按钮）。
					typeof props.openView === "function" ? React.createElement("button", {
						type: "button",
						className: "cs-act",
						key: "back-to-chat",
						"data-cs-back-to-chat": "true",
						style: S.button,
						onClick: () => { props.openView("chat"); },
					}, "回到对话") : null,
					React.createElement("button", {
						type: "button",
						className: "cs-act",
						key: "refresh",
						"data-cs-refresh": "true",
						style: S.button,
						disabled: snapshot.status === "loading",
						onClick: () => { if (store !== null) store.refresh(); },
					}, snapshot.status === "loading" ? "读盘中…" : "重新读盘"),
					React.createElement("div", {
						key: "sources",
						style: S.sources,
						"data-cs-sources": snapshot.sources.map((source) => source.name + ":" + (source.ok ? "ok" : "fail")).join(" "),
					}, "数据来源：" + (snapshot.sources.length === 0 ? "—" : snapshot.sources.map((source) => source.name + (source.ok ? "" : "(失败)")).join(" · "))),
				),
			));
			canvasChildren.push(React.createElement(Flourish, { key: "flourish-bottom", edge: "bottom" }));

			return React.createElement("div", {
				ref: hostRef,
				style: S.host,
				"data-classroom-stage": "true",
				"data-cs-view": VIEW_SLOT,
				"data-cs-stream": stream,
				"data-cs-band-left": pct(TEXT_BAND.leftPct),
				"data-cs-band-right": pct(100 - TEXT_BAND.rightPct),
			},
				React.createElement("div", {
					style: Object.assign({}, S.canvas, { transform: "translate(-50%, -50%) scale(" + scale + ")" }),
					"data-cs-canvas": CANVAS.width + "x" + CANVAS.height,
					"data-cs-scale": String(scale),
				}, canvasChildren),
			);
		}

		/** 选中讲次的详情（真实联动书脊选择）。没选中时不占地方，只留一行提示。 */
		function SelectedLessonDetail(props) {
			const fontPx = props.fontPx;
			if (props.lesson === null || props.lesson === undefined) {
				return React.createElement("div", {
					style: Object.assign({}, typeRole("xxxs-11", "sans", "0.02em"), {
						fontSize: px(fontPx, "11px"), color: ink(4), marginTop: "12px",
					}),
					"data-cs-selected-detail": "none",
				}, "点上方书脊可查看某一讲的核心疑问。");
			}
			return React.createElement("div", {
				key: "detail",
				"data-cs-selected-detail": props.lesson.n,
				style: {
					marginTop: "12px", padding: "10px", borderRadius: "3px",
					background: "rgba(255,255,255,0.42)", border: "0.5px solid " + GOLD_RULE,
				},
			},
				React.createElement("div", {
					style: Object.assign({}, typeRole("xs-13", "serif", "0.03em"), {
						fontSize: px(fontPx === undefined ? undefined : fontPx + 4, "13px"), color: ink(1),
					}),
				}, "第 " + props.lesson.n + " 讲 · " + props.lesson.title),
				React.createElement("div", {
					style: Object.assign({}, typeRole("xxs-12", "sans", "0.02em", "1.6"), {
						fontSize: px(fontPx, "12px"), color: ink(2), marginTop: "6px",
					}),
				}, props.lesson.core === null ? "（核心疑问未解析）" : props.lesson.core),
			);
		}

		// ── 样式表（只引上面定义的令牌，不散落字面色值）──
		function styles() {
			return {
				/**
				 * 宿主给的格子。`conversation.view` 的条目是 `.viewArea`（flex column，flex:1，
				 * min-height:0）的子节点，条目外面还有一层 `display:contents` 的 wrapper
				 * （C-4）——所以这里同时写 `flex:1 1 0` 与 `height:100%`，两种父容器都吃得下。
				 * `pointerEvents` 显式写 `auto`：这是**我们自己的会话内容区**（官方视图此时
				 * 不渲染，rendered one at a time），不是盖在别的东西上的浮层，所以不该穿透；
				 * 但要显式声明，不依赖继承（C-1 的教训是「不写就等于接管」，这里我们要的就是接管）。
				 */
				host: {
					position: "relative", flex: "1 1 0", minHeight: "0", width: "100%", height: "100%",
					overflow: "hidden", display: "block", pointerEvents: "auto",
					background: "#2a1a0d", fontFamily: SANS, color: ink(1),
				},
				/** 固定 1920×1080 画布。transform 由 StageBody 按容器尺寸算出来（letterbox）。 */
				canvas: {
					position: "absolute", left: "50%", top: "50%",
					width: CANVAS.width + "px", height: CANVAS.height + "px",
					transformOrigin: "center center",
					background: "url(" + stageBackdrop() + ") center center / cover no-repeat",
					overflow: "hidden",
				},
				/** 顶部一行：左书脊、右课堂名。 */
				topBar: {
					position: "absolute", left: "3%", right: "3%", top: LAYOUT.spineBarTopPx + "px",
					display: "flex", alignItems: "flex-end", gap: "24px",
				},
				topTitles: { flex: "1 1 auto", textAlign: "right", paddingBottom: "6px" },
				title: Object.assign({}, typeRole("s-14", "serif", "0.05em"), {
					fontSize: CANVAS_TYPE.title + "px", color: ink(1),
				}),
				subtitle: Object.assign({}, typeRole("xxxs-11", "mono", "0.04em"), {
					fontSize: CANVAS_TYPE.caption + "px", color: ink(3), marginTop: "4px",
				}),
				/** 右侧立绘列：正好落在正文带右边距（19.8%）的留白里。 */
				podium: {
					position: "absolute", right: "1.2%", top: LAYOUT.portraitTopPx + "px",
					width: LAYOUT.portraitColumnPx + "px", display: "flex", flexDirection: "column",
				},
				/** 底部元信息条。比正文带更宽——它是"场记板"，不是正文。 */
				meta: {
					position: "absolute", left: "6%", right: "6%", bottom: LAYOUT.metaBottomPx + "px",
					display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "24px",
					borderTop: "0.5px solid " + GOLD_RULE, paddingTop: "12px",
				},
				fields: { display: "flex", flexWrap: "wrap", gap: "8px 26px", flex: "1 1 auto" },
				controls: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px", flex: "0 0 auto" },
				state: Object.assign({}, typeRole("xxxs-11", "sans", "0.02em"), {
					fontSize: CANVAS_TYPE.caption + "px", color: ink(3),
				}),
				button: Object.assign({}, typeRole("xxxs-11", "sans", "0.08em"), {
					fontSize: CANVAS_TYPE.caption + "px",
					color: ink(1), background: "rgba(255,255,255,0.42)", border: "0.5px solid " + GOLD_RULE,
					borderRadius: "999px", padding: "8px 22px", cursor: "pointer",
					// 🔴 指针策略显式声明，不依赖继承（C-1）：按钮是控件 → auto
					pointerEvents: "auto",
				}),
				sources: Object.assign({}, typeRole("xxxs-11", "mono", "0.02em"), {
					fontSize: CANVAS_TYPE.caption + "px", color: ink(4),
				}),
			};
		}

		// ════════════════════════════════════════════════════════════════════
		// 10 · 截图入口（captureFrame）
		//
		// 验收要证据。宿主不转译我们的文件，也没有 html2canvas 这类依赖可用，
		// 所以这里**不假装能出 PNG**：给的是「真实 DOM 节点 ＋ 一份可断言的帧描述」，
		// 外部工具（Playwright 等）拿节点去截图，断言则直接读帧描述。
		// 形状抄 moeru-ai/airi 的 Stage.vue —— 每个渲染后端统一暴露 canvasElement / captureFrame。
		// ════════════════════════════════════════════════════════════════════

		/** sessionId → { element, scale, lines, classroom }。由 StageBody 每次渲染刷新。 */
		const frameRegistry = new Map();

		/** 把当前帧写成一份可断言的描述（不含任何编出来的数据：字色/边界全取自令牌）。 */
		function describeFrame(entry) {
			return {
				canvas: { width: CANVAS.width, height: CANVAS.height },
				scale: entry.scale,
				band: {
					leftPct: TEXT_BAND.leftPct,
					rightPct: TEXT_BAND.rightPct,
					topPct: TEXT_BAND.topPct,
					fontSizePx: TEXT_BAND.fontSizePx,
					lineHeight: TEXT_BAND.lineHeight,
				},
				lines: entry.lines.map((line) => ({
					source: line.source, text: line.text, current: line.current, color: line.color,
				})),
				classroom: entry.classroom,
				portrait: "undeployed",
				speakers: [],
				nameTag: nameTagPlan([]),
			};
		}

		/**
		 * 取当前会话的舞台帧。
		 * @returns `{ok:true, element, frame}`；舞台没挂载时 `{ok:false, error}`——**不返回空图冒充**。
		 */
		function captureFrame(sessionId) {
			const entry = frameRegistry.get(sessionId);
			if (entry === undefined) {
				return { ok: false, error: "本会话的课堂舞台未挂载：先切到「课堂舞台」视图，画面才存在。" };
			}
			return { ok: true, element: entry.element, frame: describeFrame(entry) };
		}

		/**
		 * 推进指示器的闪烁关键帧。
		 * 宿主不转译我们的文件，所以没有 CSS 文件可用；这里按官方插件同一做法注入一枚极小的
		 * `<style>`（带 data 标记去重，不会重复注入）。
		 */
		const STYLE_TAG = "classroom-stage/advance.css";

		function ensureAdvanceKeyframes() {
			if (typeof document === "undefined" || document === null) return;
			if (document.querySelector('style[data-plugin-css="' + STYLE_TAG + '"]') !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "classroom-stage";
			tag.dataset.pluginCss = STYLE_TAG;
			tag.textContent = "@keyframes cs-advance{0%,100%{opacity:.95}50%{opacity:.45}}";
			document.head.appendChild(tag);
		}

		// ════════════════════════════════════════════════════════════════════
		// 11 · 挂载
		// ════════════════════════════════════════════════════════════════════

		/** 只注入真正用到的服务：`slots`（注册视图条目）＋ `remote`（读教室文件）。 */
		const inject = ["slots", "remote", "remote.workspaceFiles"];

		function apply(ctx) {
			ensureAdvanceKeyframes();

			// 给验收脚本一个外部可调用的句柄（React 里没有 Vue 的 defineExpose，
			// 而这个插件本来就不属于任何框架，所以挂一个带命名空间的全局对象）。
			ctx.effect(() => {
				const globalRef = typeof globalThis !== "undefined" ? globalThis : null;
				const api = {
					captureFrame: captureFrame,
					frameRegistry: frameRegistry,
					tokens: { TEXT_BAND: TEXT_BAND, LAYOUT: LAYOUT, CANVAS: CANVAS, CANVAS_TYPE: CANVAS_TYPE },
				};
				if (globalRef !== null) globalRef.__DSH_CLASSROOM_STAGE__ = api;
				return () => {
					if (globalRef !== null && globalRef.__DSH_CLASSROOM_STAGE__ === api) delete globalRef.__DSH_CLASSROOM_STAGE__;
				};
			}, "classroom-stage: 截图入口");

			// 视图条目。`id` 必填（官方 viewTabs 对 undefined 直接跳过），`label` 会被读成切换器上的名字。
			// 教室 store 在这里按 `sessionId`（本座的 standardProps 之一）取，不去依赖未文档化的
			// registerOption：官方座目录给 `conversation.view` 列的 registerOptions 只有 id/order/label。
			ctx.effect(() => ctx.slots.inject(VIEW_SLOT, () => ctx.slots.register({
				name: VIEW_SLOT,
				id: TYPE_ID,
				order: VIEW_ORDER,
				label: PANEL_LABEL,
			}, (props) => React.createElement(StageBody, Object.assign({}, props, {
				classroom: typeof props.sessionId === "string" && props.sessionId !== "" ? storeFor(ctx, props.sessionId) : null,
			})))), "classroom-stage: conversation.view 条目");
		}

		// ── 导出（供 node 侧测试直接驱动同一份代码，与 classroom-ui 同一手法）──
		exports.inject = inject;
		exports.apply = apply;
		exports.TYPE_ID = TYPE_ID;
		exports.PANEL_LABEL = PANEL_LABEL;
		exports.VIEW_SLOT = VIEW_SLOT;
		exports.VIEW_ORDER = VIEW_ORDER;
		exports.CANVAS = CANVAS;
		exports.TEXT_BAND = TEXT_BAND;
		exports.LAYOUT = LAYOUT;
		exports.CANVAS_TYPE = CANVAS_TYPE;
		exports.BODY_TEXT_SHADOW = BODY_TEXT_SHADOW;
		exports.SPEECH_KINDS = SPEECH_KINDS;
		exports.classroomRoot = classroomRoot;
		exports.classroomPath = classroomPath;
		exports.parseManifest = parseManifest;
		exports.parseProgress = parseProgress;
		exports.parseCurriculum = parseCurriculum;
		exports.parseTeacher = parseTeacher;
		exports.expressionPlan = expressionPlan;
		exports.readText = readText;
		exports.loadClassroom = loadClassroom;
		exports.speechTextOf = speechTextOf;
		exports.splitParagraphs = splitParagraphs;
		exports.speechLines = speechLines;
		exports.bandItems = bandItems;
		exports.nameTagPlan = nameTagPlan;
		exports.storeFor = storeFor;
		exports.captureFrame = captureFrame;
		exports.describeFrame = describeFrame;
		exports.STAGE_TOKENS = {
			PAPER_LIGHT, PAPER_INNER, WOOD, GOLD, GOLD_RULE, READ_ORANGE, SPINE_TODO, SPINE_DONE,
			SANS, MONO, SERIF, BODY_FONT, BODY_TEXT_SHADOW,
		};

		return module.exports;
	},
});
