/**
 * 教室面板（classroom-ui）· 浏览器半边。
 *
 * 形态：DSH 客户端插件产物（`window.__ModuleLoader__.load({id, factory})`，id 必须等于包名）。
 * 本文件是**手写的产物**，不经过打包器——因为宿主加载的是「已构建产物」这一格式本身
 * （`dsh-client-modules` 的 node 半边读 `package.json` 的 `exports["./client"]` 指向的文件字节
 * 直接下发给浏览器，不做任何转译）。故这里用 `require("react")` + `React.createElement`，
 * 不写 JSX、不引 CSS 模块（样式走内联 style 对象）。
 *
 * 挂载点（两段式，与官方 `ui-sidebar-terminal` / `ui-sidebar-documentpreview` 同一路径）：
 *   ① `ctx.sidebarRightTabs.register({id, kind, title, guide})` —— 注册 tab **类型**；
 *   ② `ctx.slots.register({name:'sidebar.right.pane.tab', key: id})` —— 注册该类型的**面板主体**；
 *   ③ `ctx.slots.register({name:'sidebar.right.pane.tab.title', key: id})` —— 注册 tab 标题。
 * 右侧面板入口是 `sidebar.right.pane.tab`（keyed / session / replaceRisk=none），不是 `rightbar`。
 *
 * 数据通道：宿主已提供的 `workspaceFiles` Remote（`ctx.remote.workspaceFiles.read`），
 * 直接读教室自己的文件（classroom.yaml / runtime/progress.md / curriculum.md / characters/komari.md）。
 * 不需要服务端插件配合，也没有任何假数据——见 README.md §数据通道。
 */

window.__ModuleLoader__.load({
	id: "classroom-ui",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");

		// ════════════════════════════════════════════════════════════════════
		// 1 · 常量
		// ════════════════════════════════════════════════════════════════════

		/** tab 类型 id。必须等于包名：面板主体按 `id` 派发，也是 boot 图里的行 id。 */
		const TYPE_ID = "classroom-ui";
		/** tab 类型 kind。派发的是 `id`，kind 只用于类型自身的识别与地址方案。 */
		const TYPE_KIND = "classroom";
		/** tab 标题（无实时标题时的回退文案）。 */
		const PANEL_TITLE = "教室";

		/**
		 * 教室包在工作区里的相对路径（默认 cs-os）。
		 * 相对路径按**会话工作区根**解析（`workspaceFiles` 的语义），故工作区换位置也不受影响。
		 * 换教室时不必改代码：`globalThis.__DSH_CLASSROOM_UI_CONFIG__ = { root: '...' }`
		 * （与官方 `ui-sidebar-documentpreview` 读 `__DSH_DOCUMENT_PREVIEW_CONFIG__` 同一手法）。
		 */
		const DEFAULT_CLASSROOM_ROOT = "开源线/DSH定制/code/classrooms/cs-os";

		/** 面板要读的四个文件，键名即解析函数的入参名。 */
		const FILE = {
			manifest: "classroom.yaml",
			progress: "runtime/progress.md",
			curriculum: "curriculum.md",
			teacher: "characters/komari.md",
		};



		// ════════════════════════════════════════════════════════════════════
		// 2 · 路径
		// ════════════════════════════════════════════════════════════════════

		/** 教室根目录（去掉尾斜杠）。 */
		function classroomRoot() {
			const config = globalThis.__DSH_CLASSROOM_UI_CONFIG__;
			const configured = config !== undefined && config !== null && typeof config.root === "string" ? config.root : DEFAULT_CLASSROOM_ROOT;
			return configured.endsWith("/") ? configured.slice(0, -1) : configured;
		}

		/** @param name - FILE 的键 @returns 该文件相对工作区根的路径 */
		function classroomPath(name) {
			return classroomRoot() + "/" + FILE[name];
		}

		// ════════════════════════════════════════════════════════════════════
		// 3 · 解析（纯函数：只吃文本，不碰 IO，可被 node 侧测试直接驱动）
		//
		// 口径：只读教室文件自己声明的字段，读不到就**返回 null 并让面板显示缺失**，
		//       绝不填默认值（"不静默失效"——静默的默认值会把文件格式漂移藏起来）。
		// ════════════════════════════════════════════════════════════════════

		/** 去掉 YAML 行尾注释（只在 ` #` 之前截断，避免误伤值里的 `#`）。 */
		function stripComment(line) {
			const match = line.match(/^(.*?)(\s+#.*)?$/);
			return match === null ? line : match[1];
		}

		/**
		 * 读 classroom.yaml 的四个展示字段 ＋ phases 枚举。
		 * 只扫 `classroom:` 与 `phases:` 两个顶层块，到 `blocks:` 为止。
		 * @param text - classroom.yaml 全文
		 * @returns {id, title, subject, lessons, phases} —— 缺项为 null
		 */
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

		/**
		 * 取 markdown 表格里某一行的值（`| 标签 | 值 |`）。
		 * @param text - 文件全文
		 * @param label - 第一列标签（逐字匹配）
		 * @returns 第二列的值，未命中为 null
		 */
		function tableValue(text, label) {
			const pattern = new RegExp("^\\|\\s*" + label + "\\s*\\|\\s*([^|]*?)\\s*\\|\\s*$", "m");
			const match = text.match(pattern);
			return match === null ? null : match[1];
		}

		/**
		 * 读 runtime/progress.md。
		 * `current_lesson:` 是引擎认的**机器可读行**（语义＝本轮要讲的讲次）；
		 * `current_phase:` 是相位状态行（可能尚未出现——引擎只在教师宣布过相位后才写）。
		 * 两个都按行首锚定读，读不到就如实报 null。
		 * @param text - progress.md 全文
		 * @returns {currentLesson, currentPhase, teacher, progressText, humanLesson, lastDate, nextLesson}
		 */
		function parseProgress(text) {
			const lessonLine = text.match(/^current_lesson:\s*(\d+)\s*$/m);
			const phaseLine = text.match(/^current_phase:\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/m);
			return {
				currentLesson: lessonLine === null ? null : Number.parseInt(lessonLine[1], 10),
				currentPhase: phaseLine === null ? null : phaseLine[1],
				teacher: tableValue(text, "当课老师"),
				progressText: tableValue(text, "课程进度"),
				humanLesson: tableValue(text, "当前讲次"),
				lastDate: tableValue(text, "上次上课日期"),
				nextLesson: tableValue(text, "下次上课"),
			};
		}

		/**
		 * 读 curriculum.md 的 14 讲课程表。
		 * 认 `## 第 N 讲 · 标题` 形式的二级标题，并在该讲块内取 `- **核心疑问**：…`。
		 * @param text - curriculum.md 全文
		 * @returns [{n, title, core}]，按文件顺序
		 */
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
				if (core !== null) current.core = core[1].replace(/^\*+/, "").replace(/\*+$/, "").trim();
			}
			return lessons;
		}

		/**
		 * 读 characters/komari.md 的身份字段。
		 * @param text - 角色文件全文
		 * @returns {name, scope}
		 */
		function parseTeacher(text) {
			return { name: tableValue(text, "名字"), scope: tableValue(text, "当课范围") };
		}

		// ════════════════════════════════════════════════════════════════════
		// 4 · 读取（走宿主的 workspaceFiles Remote，不碰文件系统）
		// ════════════════════════════════════════════════════════════════════

		/** 把未知异常收成一行文案。 */
		function messageOf(error) {
			if (error instanceof Error) return error.message;
			return String(error);
		}

		/**
		 * 逐页读完一个文本文件。
		 * `read` 是分页接口（宿主默认 5000 行/页）；不传 limit 就走宿主自己的页大小，
		 * 免得写死的数字超过部署配置被拒。
		 * 终止条件取自宿主自己的契约：`eof` 为真即到末行。零行却没到末行＝宿主违约
		 * （分页无法推进），此时报错而不是空转或静默截断。
		 * @param remote - 客户端 Remote 面（`ctx.remote`）
		 * @param sessionId - 会话 id（决定工作区根）
		 * @param path - 工作区相对路径
		 * @param signal - 取消信号
		 * @returns 文件全文
		 */
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

		/**
		 * 读齐四个文件并组装面板快照数据。
		 * 单个文件失败**不拖垮整块**：失败进 `sources`，对应字段为 null，面板逐项标出来源状态。
		 * @param ctx - 客户端根 Context（用其 `remote`）
		 * @param sessionId - 会话 id
		 * @param signal - 取消信号
		 * @returns {data, sources}
		 */
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
					lastDate: progress === null ? null : progress.lastDate,
					nextLesson: progress === null ? null : progress.nextLesson,
					lessons: lessons,
				},
				sources: sources,
			};
		}

		// ════════════════════════════════════════════════════════════════════
		// 5 · 会话级共享 store
		//
		// 数据不进组件 local state：按 sessionId 缓存在**插件作用域**里，
		// 面板关掉再开、切 tab 再切回来都不重读；只有「刷新」按钮或首次挂载才真读盘。
		// （宿主的 slot 注册选项里另有 `store` 座位，用于把 store 交给框架按会话生命周期管理；
		//   本插件不需要框架托管其生命周期，故用插件自己的表，见 README §数据通道 ④。）
		// ════════════════════════════════════════════════════════════════════

		/** sessionId → { snapshot, listeners, loading } */
		const stores = new Map();

		/** 空快照（status=idle 时面板会触发首次读取）。 */
		function idleSnapshot() {
			return { status: "idle", error: null, data: null, sources: [] };
		}

		/**
		 * 取（或建）一个会话的 store。同一会话下主体与标题拿到的是**同一个实例**。
		 * @param ctx - 客户端根 Context
		 * @param sessionId - 会话 id
		 * @returns {subscribe, getSnapshot, refresh}
		 */
		function storeFor(ctx, sessionId) {
			let entry = stores.get(sessionId);
			if (entry === undefined) {
				entry = { snapshot: idleSnapshot(), listeners: new Set(), loading: null };
				stores.set(sessionId, entry);
			}
			const emit = () => {
				for (const listener of Array.from(entry.listeners)) listener();
			};
			const publish = (snapshot) => {
				entry.snapshot = snapshot;
				emit();
			};
			const refresh = () => {
				if (entry.loading !== null) return entry.loading;
				const previous = entry.snapshot;
				publish({ status: "loading", error: null, data: previous.data, sources: previous.sources });
				entry.loading = loadClassroom(ctx, sessionId, new AbortController().signal).then(
					(result) => {
						entry.loading = null;
						publish({ status: "ready", error: null, data: result.data, sources: result.sources });
					},
					(error) => {
						entry.loading = null;
						publish({ status: "failed", error: messageOf(error), data: previous.data, sources: previous.sources });
					},
				);
				return entry.loading;
			};
			return {
				subscribe: (listener) => {
					entry.listeners.add(listener);
					return () => { entry.listeners.delete(listener); };
				},
				getSnapshot: () => entry.snapshot,
				refresh: refresh,
			};
		}

		// ════════════════════════════════════════════════════════════════════
		// 6 · 样式（内联；只用主题变量，取不到就退回中性色）
		// ════════════════════════════════════════════════════════════════════

		const INK = "var(--dsw-alias-label-primary, #1f1f1f)";
		const INK_2 = "var(--dsw-alias-label-secondary, #5c5c5c)";
		const INK_3 = "var(--dsw-alias-label-caption, #8a8a8a)";
		const LINE = "var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08))";
		const FILL = "var(--dsw-alias-fill-l2, rgba(0, 0, 0, 0.045))";
		const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

		const S = {
			body: { display: "flex", flexDirection: "column", gap: "14px", padding: "12px 14px 18px", color: INK, fontSize: "12px", lineHeight: "1.55" },
			headTitle: { fontSize: "13px", fontWeight: 400 },
			headMeta: { color: INK_3, fontFamily: MONO, fontSize: "11px" },
			section: { display: "flex", flexDirection: "column", gap: "6px" },
			sectionLabel: { color: INK_3, fontSize: "11px", letterSpacing: "0.04em" },
			row: { display: "flex", gap: "8px", alignItems: "baseline" },
			rowLabel: { color: INK_3, flex: "0 0 44px" },
			rowValue: { color: INK, flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere" },
			mono: { fontFamily: MONO },
			list: { display: "flex", flexDirection: "column", borderTop: "1px solid " + LINE },
			item: { display: "flex", gap: "8px", alignItems: "baseline", padding: "5px 0", borderBottom: "1px solid " + LINE },
			itemCurrent: { background: FILL },
			itemNumber: { color: INK_3, flex: "0 0 20px", fontFamily: MONO, fontSize: "11px" },
			itemTitle: { flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere" },
			itemTitleCurrent: { color: INK },
			itemTitleRest: { color: INK_2 },
			core: { color: INK_3, padding: "0 0 6px 28px" },
			badge: { color: INK_3, fontSize: "11px", border: "1px solid " + LINE, borderRadius: "999px", padding: "0 6px", flex: "0 0 auto" },
			note: { color: INK_3, fontSize: "11px" },
			error: { color: INK, background: FILL, borderRadius: "8px", padding: "8px 10px", overflowWrap: "anywhere" },
			footer: { display: "flex", flexDirection: "column", gap: "4px", borderTop: "1px solid " + LINE, paddingTop: "10px" },
			source: { display: "flex", gap: "6px", color: INK_3, fontSize: "11px" },
			sourcePath: { fontFamily: MONO, minWidth: 0, overflowWrap: "anywhere" },
			button: { alignSelf: "flex-start", marginTop: "8px", background: "transparent", border: "1px solid " + LINE, borderRadius: "999px", color: INK_2, cursor: "pointer", fontSize: "11px", padding: "3px 12px" },
		};

		// ════════════════════════════════════════════════════════════════════
		// 7 · 组件
		// ════════════════════════════════════════════════════════════════════

		/** 一行「标签｜值」。值为 null 时显示「未提供」，不编造。 */
		function Field(props) {
			const shown = props.value === null || props.value === undefined || props.value === "" ? "未提供" : props.value;
			const style = props.mono === true ? Object.assign({}, S.rowValue, S.mono) : S.rowValue;
			const dim = props.value === null || props.value === undefined || props.value === "" ? Object.assign({}, style, { color: INK_3 }) : style;
			return React.createElement("div", { style: S.row },
				React.createElement("span", { style: S.rowLabel }, props.label),
				React.createElement("span", { style: dim }, shown),
			);
		}

		/**
		 * 面板主体：教室信息 ＋ 当前状态 ＋ 14 讲课程表 ＋ 数据来源。
		 * props 由框架给出：`sessionId`（会话）、`useTabInfo`（tab 信息钩子）、
		 * `classroom`（本插件在 inject 里返回的 store 面）。
		 */
		function ClassroomBody(props) {
			const store = props.classroom;
			if (store === undefined) {
				return React.createElement("div", { style: S.body },
					React.createElement("div", { style: S.error }, "classroom-ui：store 未注入（inject 未生效）"));
			}
			const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
			React.useEffect(() => {
				if (snapshot.status === "idle") store.refresh();
			}, [snapshot.status, store]);

			const data = snapshot.data;
			const children = [];

			// —— 头部：教室名 ＋ 元信息
			children.push(React.createElement("div", { style: S.section, key: "head" },
				React.createElement("div", { style: S.headTitle }, data !== null && data.title !== null ? data.title : PANEL_TITLE),
				React.createElement("div", { style: S.headMeta },
					[data === null ? null : data.subject,
						data === null || data.lessonsTotal === null ? null : String(data.lessonsTotal) + " 讲",
						data === null || data.classroomId === null ? null : data.classroomId,
						classroomRoot()].filter((part) => part !== null).join(" · ")),
			));

			if (snapshot.status === "loading" && data === null) {
				children.push(React.createElement("div", { style: S.note, key: "loading" }, "读取教室文件…"));
			}
			if (snapshot.status === "failed") {
				children.push(React.createElement("div", { style: S.error, key: "failed" }, "读取失败：" + String(snapshot.error)));
			}

			// —— 当前：讲次 / 环节 / 老师 / 进度
			if (data !== null) {
				const total = data.lessonsTotal === null ? "?" : String(data.lessonsTotal);
				const lessonText = data.currentLesson === null
					? null
					: "第 " + String(data.currentLesson) + " 讲 / " + total + (data.lessonTitle === null ? "" : " · " + data.lessonTitle);
				const phaseText = data.currentPhase === null
					? null
					: data.currentPhase + (data.phaseName === null ? "" : "（" + data.phaseName + "）");
				children.push(React.createElement("div", { style: S.section, key: "current" },
					React.createElement("div", { style: S.sectionLabel }, "当前"),
					React.createElement(Field, { label: "讲次", value: lessonText, mono: true }),
					React.createElement(Field, { label: "环节", value: phaseText }),
					React.createElement(Field, { label: "老师", value: data.teacher }),
					React.createElement(Field, { label: "进度", value: data.progressText }),
					React.createElement(Field, { label: "下次", value: data.nextLesson }),
					React.createElement(Field, { label: "上次", value: data.lastDate }),
					data.currentPhase === null
						? React.createElement("div", { style: S.note }, "progress.md 里还没有 `current_phase:` 行 → 环节按「未提供」显示（不猜）。")
						: null,
					data.humanLesson !== null && data.currentLesson !== null && !data.humanLesson.includes(String(data.currentLesson))
						? React.createElement("div", { style: S.note }, "提示：progress.md 人读表格写的是「" + data.humanLesson + "」，机器可读行是 current_lesson: " + String(data.currentLesson) + "，两处口径不一致。")
						: null,
				));
			}

			// —— 课程表
			if (data !== null && data.lessons.length > 0) {
				const rows = data.lessons.map((lesson) => {
					const isCurrent = lesson.n === data.currentLesson;
					const cells = [
						React.createElement("span", { style: S.itemNumber, key: "n" }, lesson.n < 10 ? "0" + String(lesson.n) : String(lesson.n)),
						React.createElement("span", { style: isCurrent ? Object.assign({}, S.itemTitle, S.itemTitleCurrent) : Object.assign({}, S.itemTitle, S.itemTitleRest), key: "t" }, lesson.title),
					];
					if (isCurrent) cells.push(React.createElement("span", { style: S.badge, key: "b" }, "当前"));
					const nodes = [React.createElement("div", { style: isCurrent ? Object.assign({}, S.item, S.itemCurrent) : S.item, key: "row" }, cells)];
					if (isCurrent && lesson.core !== null) {
						nodes.push(React.createElement("div", { style: S.core, key: "core" }, "核心疑问：" + lesson.core));
					}
					return nodes;
				});
				children.push(React.createElement("div", { style: S.section, key: "curriculum" },
					React.createElement("div", { style: S.sectionLabel }, "课程表 · " + String(data.lessons.length) + " 讲"),
					React.createElement("div", { style: S.list }, rows),
				));
			} else if (data !== null && snapshot.status === "ready") {
				children.push(React.createElement("div", { style: S.note, key: "curriculum-empty" }, "课程表未解析到讲次（curriculum.md 的 `## 第 N 讲 · 标题` 标题格式没匹配上）。"));
			}

			// —— 数据来源（逐文件真伪，不掩饰）
			if (snapshot.sources.length > 0) {
				children.push(React.createElement("div", { style: S.footer, key: "sources" },
					React.createElement("div", { style: S.sectionLabel }, "数据来源（真读盘）"),
					snapshot.sources.map((source) => React.createElement("div", { style: S.source, key: source.name },
						React.createElement("span", null, source.ok ? "✓" : "✗"),
						React.createElement("span", { style: S.sourcePath }, source.path),
						React.createElement("span", null, source.ok ? "" : "（" + String(source.error) + "）"),
					)),
					React.createElement("button", {
						type: "button",
						style: S.button,
						onClick: () => { store.refresh(); },
					}, snapshot.status === "loading" ? "读取中…" : "重新读盘"),
				));
			}

			return React.createElement("div", { style: S.body, "data-classroom-ui": "body" }, children);
		}

		/** tab 标题：教室 ＋ 当前讲次（数据没到位时只显示「教室」）。 */
		function ClassroomTitle(props) {
			const store = props.classroom;
			if (store === undefined) return PANEL_TITLE;
			const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
			const data = snapshot.data;
			if (data === null || data.currentLesson === null) return PANEL_TITLE;
			return PANEL_TITLE + " · 第 " + String(data.currentLesson) + " 讲";
		}

		// ════════════════════════════════════════════════════════════════════
		// 8 · 插件体
		// ════════════════════════════════════════════════════════════════════

		/** 需要的宿主服务：槽位注册表、右侧栏 tab 类型注册表、客户端 Remote。 */
		const inject = ["slots", "sidebarRightTabs", "remote", "remote.workspaceFiles"];

		/**
		 * 挂载教室面板。
		 * @param ctx - 客户端根 Context
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.sidebarRightTabs.register({
				id: TYPE_ID,
				kind: TYPE_KIND,
				priority: "extension",
				title: () => PANEL_TITLE,
				guide: [{
					id: "classroom",
					order: 10,
					title: () => PANEL_TITLE,
					description: () => "课程表 · 当前讲次 · 当课老师 · 进度",
				}],
			}), "classroom-ui: tab 类型");

			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: TYPE_ID,
				inject: (sessionId) => ({ classroom: storeFor(ctx, sessionId) }),
			}, ClassroomBody)), "classroom-ui: 面板主体");

			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
				name: "sidebar.right.pane.tab.title",
				key: TYPE_ID,
				inject: (sessionId) => ({ classroom: storeFor(ctx, sessionId) }),
			}, ClassroomTitle)), "classroom-ui: tab 标题");
		}

		// ── 导出 ──
		exports.inject = inject;
		exports.apply = apply;
		// 纯函数与读取器一并导出，供 node 侧测试直接驱动同一份代码（见 test/panel.test.mjs）。
		exports.TYPE_ID = TYPE_ID;
		exports.TYPE_KIND = TYPE_KIND;
		exports.classroomRoot = classroomRoot;
		exports.classroomPath = classroomPath;
		exports.parseManifest = parseManifest;
		exports.parseProgress = parseProgress;
		exports.parseCurriculum = parseCurriculum;
		exports.parseTeacher = parseTeacher;
		exports.readText = readText;
		exports.loadClassroom = loadClassroom;
		exports.storeFor = storeFor;

		return module.exports;
	},
});
