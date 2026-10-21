/**
 * classroom-stage 的 node 侧测试：**驱动浏览器半边的真实代码**，不吃任何替身数据。
 *
 * 做法：把 `lib/client.js` 当成浏览器产物那样装一遍——伪造 `window.__ModuleLoader__`
 * 收下 `{id, factory}`，再给 factory 一个最小 `require`（只认 "react"），
 * 于是拿到与浏览器里**同一份** exports，用真实的教室文件喂它。
 *
 * 覆盖（五类）：
 *   A · 产物格式与出口契约：id＝包名、apply 是函数、inject 数组、导出齐全；
 *   B · 挂载点：注册的是 `conversation.view`（id/order/label 齐全），
 *       且**不再**注册右侧栏那两处、也不碰 `sidebarRightTabs`；
 *   C · 真实数据：喂真实 classrooms/cs-os 文件，断言解析出真实教室名/讲次/老师/课程表、
 *       单文件失败不静默、立绘未部署状态在出口；
 *   D · 对话渲染：用伪造的 chat 节点走真实抽取与渲染，断言**实测令牌数值**
 *       （左右边界 17.2%/80.2%、字号 47、行距 1.74、旧行 #cccccc / 当前行 #ffffff）；
 *   E · 截图入口：没有挂载时 captureFrame 明确报未挂载，不返回空图冒充。
 *
 * 跑法：node clients/classroom-stage/test/stage.test.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(HERE, "..", "..", "..");
const CLASSROOM = "classrooms/cs-os";
/** 读真实教室文件（断言里的每个期望值都来自这些真文件，不是手写的替身）。 */
const read = (rel) => readFileSync(join(WORKSPACE, CLASSROOM, rel), "utf8");

// ── 0 · console 探针：加载与渲染全程不许有 console.error / console.warn ─────────
let errorCount = 0;
let warnCount = 0;
const realErr = console.error.bind(console);
const realWarn = console.warn.bind(console);
console.error = (...args) => { errorCount += 1; realErr("[console.error 被触发]", ...args); };
console.warn = (...args) => { warnCount += 1; realWarn("[console.warn 被触发]", ...args); };

// ── 1 · 最小 React：手写 createElement 会真正递归执行函数组件 ─────────────────
function createElement(type, props, ...children) {
	const kids = children.length === 1 ? children[0] : children;
	if (typeof type === "function") return type(Object.assign({}, props, { children: kids }));
	return { type, props: props || {}, children: kids };
}
const React = {
	createElement,
	useState: (init) => [typeof init === "function" ? init() : init, () => {}],
	useEffect: () => {},
	useRef: () => ({ current: null }),
	useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
};

// ── 2 · 以浏览器的方式装载产物 ────────────────────────────────────────────────
let registration;
globalThis.window = {
	__ModuleLoader__: {
		load: (value) => { registration = value; },
	},
};

const BUNDLE = join(HERE, "..", "lib", "client.js");
const source = readFileSync(BUNDLE, "utf8");
// 产物是经典脚本（非 ESM），用 Function 求值等价于浏览器 <script> 执行。
// eslint-disable-next-line no-new-func
new Function(source)();

assert.equal(registration.id, "classroom-stage", "产物 id 必须等于包名（boot 图行 id）");
const stage = registration.factory((specifier) => {
	if (specifier === "react") return React;
	throw new Error(`未预期的 require("${specifier}")`);
});

// ── A · 出口契约 ──────────────────────────────────────────────────────────────
assert.ok(typeof stage.apply === "function", "exports.apply 必须是函数");
assert.ok(Array.isArray(stage.inject), "exports.inject 必须是数组");
assert.equal(stage.TYPE_ID, "classroom-stage", "条目 id ＝ 包名");
assert.equal(stage.PANEL_LABEL, "课堂舞台", "视图切换器上的中文名写进 label");
assert.equal(stage.VIEW_SLOT, "conversation.view", "挂载点是会话级视图座");
assert.deepEqual(stage.inject, ["slots", "remote", "remote.workspaceFiles"], "只注入真正用到的服务（不再需要 sidebarRightTabs）");
for (const name of [
	"apply", "classroomRoot", "classroomPath", "parseManifest", "parseProgress", "parseCurriculum",
	"parseTeacher", "expressionPlan", "readText", "loadClassroom", "speechTextOf", "splitParagraphs",
	"speechLines", "bandItems", "nameTagPlan", "storeFor", "captureFrame", "describeFrame", "STAGE_TOKENS",
]) {
	assert.ok(stage[name] !== undefined, `exports.${name} 必须存在`);
}

// ── B · 挂载点：conversation.view（且不再碰右侧栏） ───────────────────────────
// 伪造 remote：文件表就是真实的 classrooms/cs-os（expression 故意缺，用来验"单文件失败不静默"）
const classroomFiles = {
	[stage.classroomPath("manifest")]: read("classroom.yaml"),
	[stage.classroomPath("progress")]: read("runtime/progress.md"),
	[stage.classroomPath("curriculum")]: read("curriculum.md"),
	[stage.classroomPath("teacher")]: read("characters/komari.md"),
};
const fakeRemote = {
	workspaceFiles: {
		async read(_sessionId, path, opts) {
			const text = classroomFiles[path];
			if (text === undefined) return { ok: false, error: { message: "ENOENT: " + path } };
			const offset = opts && opts.offset ? opts.offset : 1;
			if (offset > 1) return { ok: true, value: { lines: 0, text: "", eof: true } };
			return { ok: true, value: { lines: text.split("\n").length, text, eof: true } };
		},
	},
};

const registrations = [];
const injectedSlots = [];
let sidebarRightTabsTouched = 0;
const fakeCtx = {
	effect: (fn) => { fn(); },
	remote: fakeRemote,
	sidebarRightTabs: { register: () => { sidebarRightTabsTouched += 1; } },
	slots: {
		inject: (name, factory) => { injectedSlots.push(name); return factory(); },
		register: (def, component) => { registrations.push({ def, component }); return () => {}; },
	},
};
assert.doesNotThrow(() => stage.apply(fakeCtx), "apply(ctx) 不抛错");

assert.deepEqual(injectedSlots, ["conversation.view"], "只往 conversation.view 注入");
assert.equal(registrations.length, 1, "只注册 1 个条目");
const viewDef = registrations[0].def;
assert.equal(viewDef.name, "conversation.view", "注册名是 conversation.view");
assert.equal(viewDef.id, "classroom-stage", "id 必填且 ＝ 包名（官方 viewTabs 对 undefined 直接跳过）");
assert.equal(viewDef.order, 100, "order 与官方示例一致（chat 是 0，我们排在它之后）");
assert.equal(viewDef.label, "课堂舞台", "label 会被 resolveSlotLabel 读成切换器上的名字");
assert.ok(typeof registrations[0].component === "function", "条目组件是函数组件");

assert.equal(sidebarRightTabsTouched, 0, "🔴 不再注册右侧栏 tab 类型（右侧栏归 classroom-ui）");
assert.equal(injectedSlots.includes("sidebar.right.pane.tab"), false, "🔴 不再注册 sidebar.right.pane.tab");
assert.equal(injectedSlots.includes("sidebar.right.pane.tab.title"), false, "🔴 不再注册 sidebar.right.pane.tab.title");

// ── 2 · 解析：喂真实文件 ────────────────────────────────────────────────────
const manifest = stage.parseManifest(read("classroom.yaml"));
assert.equal(manifest.id, "cs-os");
assert.equal(manifest.title, "计算机系教室 · 操作系统");
assert.equal(manifest.subject, "操作系统");
assert.equal(manifest.lessons, 14);
assert.deepEqual(manifest.phases.map((phase) => phase.id), ["open", "probe", "answer", "check", "review", "close"]);
assert.deepEqual(manifest.phases.map((phase) => phase.name), ["开场", "追问", "学生作答", "对答案", "复习", "收尾"]);

const progress = stage.parseProgress(read("runtime/progress.md"));
assert.equal(progress.currentLesson, 1, "current_lesson 机器可读行");
assert.equal(progress.currentPhase, null, "progress.md 当前无 current_phase 行（骨架：未进入相位）");
assert.equal(progress.teacher, "小鞠知花");
assert.equal(progress.progressText, "0 / 14 讲");
assert.equal(progress.humanLesson, "**第 1 讲 · 一个程序怎么跑起来**", "人读表格的「本轮要讲」（与 current_lesson 同值）");
assert.equal(progress.doneCount, "0 讲");
assert.equal(progress.lastDate, "—");

const teacher = stage.parseTeacher(read("characters/komari.md"));
assert.equal(teacher.name, "小鞠知花");
assert.equal(teacher.scope, "全 14 讲（**本教室唯一的当课老师**）");

const lessons = stage.parseCurriculum(read("curriculum.md"));
assert.equal(lessons.length, 14, "课程表解析出 14 讲");
assert.equal(lessons[0].n, 1);
assert.equal(lessons[0].title, "一个程序怎么跑起来");
assert.ok(lessons[0].core !== null && lessons[0].core.includes("两个程序都有执行机会"), "第 1 讲核心疑问被解析（去掉 * 斜体标记）");
assert.equal(lessons[2].title, "调度：谁来决定下一个跑谁", "第 3 讲标题解析正确");

// 表情文件计划：缺文件 → absent（不静默）
const absent = stage.expressionPlan(null);
assert.equal(absent.source, "absent", "缺 expression.md → 标 absent（不静默、不冒充）");
const present = stage.expressionPlan("# 本轮写了表情\n");
assert.equal(present.source, "present", "有 expression.md → 标 present");

// ── 3 · loadClassroom：用伪造 remote 走真实读盘通道 ──────────────────────────
const loadResult = await stage.loadClassroom(fakeCtx, "session-test-1", undefined);
const d = loadResult.data;
assert.equal(d.classroomId, "cs-os", "loadClassroom → 真实教室 id");
assert.equal(d.title, "计算机系教室 · 操作系统", "loadClassroom → 真实教室名");
assert.equal(d.subject, "操作系统");
assert.equal(d.lessonsTotal, 14);
assert.equal(d.currentLesson, 1);
assert.equal(d.teacher, "小鞠知花", "loadClassroom → 真实老师");
assert.equal(d.humanLesson, "**第 1 讲 · 一个程序怎么跑起来**", "loadClassroom → 真实本轮要讲");
assert.equal(d.doneCount, "0 讲");
assert.equal(d.phaseName, null, "相位未宣布 → phaseName null（不猜）");

// 对话流读口：换到 conversation.view 之后是 supported（旧版在右侧栏时是 unsupported）
assert.equal(d.sessionReadAccess, "supported", "挂到 conversation.view 后宿主提供 useChat → 标 supported");

// 立绘未部署状态在出口数据里（live2d-host/out 未分发）
assert.equal(d.expression.source, "absent", "立绘/表情未部署 → expression.source=absent（不冒充已部署）");

// sources：四份成功读盘 + expression 失败，逐条标结果，不静默
const byName = {};
for (const s of loadResult.sources) byName[s.name] = s;
assert.equal(byName.manifest.ok, true, "manifest 真读盘 ok");
assert.equal(byName.progress.ok, true, "progress 真读盘 ok");
assert.equal(byName.curriculum.ok, true, "curriculum 真读盘 ok");
assert.equal(byName.teacher.ok, true, "teacher 真读盘 ok");
assert.equal(byName.expression.ok, false, "expression 缺失 → ok=false（单文件失败不拖垮整块，如实记账）");

assert.equal(d.lessons.length, 14, "loadClassroom → 出口含 14 讲课程表");

// ── 4 · 设计令牌：逐条对齐真实截图量出来的值 ─────────────────────────────────
const T = stage.TEXT_BAND;
assert.equal(T.leftPct, 17.2, "文字列左边界 331/1920");
assert.equal(T.rightPct, 80.2, "文字列右边界 1539/1920");
assert.equal(Math.round((100 - T.rightPct) * 10) / 10, 19.8, "右边距 19.8%");
assert.equal(T.topPct, 14.9, "文本带纵向锚点：顶对齐 14.9%（不是贴底）");
assert.equal(T.fontSizePx, 47, "正文字号 47px（真实 44px 字面 ＋ 描边）");
assert.equal(T.lineHeight, 1.74, "行距 1.74（≈82px）");
assert.equal(T.colorOld, "#cccccc", "旧行 #cccccc");
assert.equal(T.colorCurrent, "#ffffff", "当前行 #ffffff");
assert.equal(T.advanceWidthPx, 33, "推进指示器 33px 宽");
assert.equal(T.advanceHeightPx, 30, "推进指示器 30px 高");
assert.equal(T.flourishPct, 46, "发丝花饰 46% 宽");
assert.equal(stage.BODY_TEXT_SHADOW.split("rgba(0,0,0,.82)").length - 1, 8, "描边是 8 向 text-shadow 环");
assert.deepEqual(stage.CANVAS, { width: 1920, height: 1080 }, "固定画布 1920×1080");
assert.equal(stage.CANVAS_TYPE.body, undefined, "画布字阶里不放正文（正文 47px 是实测令牌，只在 TEXT_BAND）");

// ── 5 · 会话流 → 台词（真实抽取逻辑，喂伪造的 chat 节点） ─────────────────────
const nodesByKey = {
	"k1": {
		kind: "assistant-step",
		visibility: "visible",
		data: { blocks: [{ kind: "reasoning", text: "（这段是思考，不是台词）" }, { kind: "text", text: "先看一个最简单的问题。" }] },
	},
	"k2": { kind: "user", visibility: "visible", data: { content: [{ type: "text", text: "好。" }] } },
	"k3": { kind: "tool-call", visibility: "visible", data: { blocks: [{ kind: "text", text: "工具调用的参数不该当台词" }] } },
	"k4": { kind: "context", visibility: "visible", data: { content: [{ type: "text", text: "系统注入的上下文" }] } },
	"k5": { kind: "assistant-step", visibility: "hidden", data: { blocks: [{ kind: "text", text: "隐藏节点" }] } },
	"k6": { kind: "assistant-step", visibility: "visible", data: { blocks: [{ kind: "reasoning", text: "只有思考，没有正文" }] } },
	"k7": { kind: "assistant-step", visibility: "visible", data: { blocks: [{ kind: "text", text: "那它什么时候被换出去？\n换出去以后又回到哪里？" }] } },
};
const nodeStore = { get: (key) => nodesByKey[key] };
const order = ["k1", "k2", "k3", "k4", "k5", "k6", "k7"];

assert.equal(stage.speechTextOf(nodesByKey.k1), "先看一个最简单的问题。", "assistant-step 只取 kind===\"text\" 的块");
assert.equal(stage.speechTextOf(nodesByKey.k2), "好。", "user 的块用 type 字段（另一套形状）");
assert.equal(stage.speechTextOf(nodesByKey.k6), null, "只有 reasoning 的步骤不产生台词");
assert.equal(stage.speechTextOf(nodesByKey.k5), null, "visibility=hidden 的节点不算台词");
assert.deepEqual(stage.SPEECH_KINDS, ["assistant-step", "user", "steering"], "白名单：工具调用/上下文注入不进舞台");

const speech = stage.speechLines(order, nodeStore);
assert.deepEqual(speech.map((line) => line.source), ["teacher", "user", "teacher", "teacher"], "老师与学生分别归类；工具/上下文/隐藏节点全部被排除");
assert.deepEqual(speech.map((line) => line.text), [
	"先看一个最简单的问题。", "好。", "那它什么时候被换出去？", "换出去以后又回到哪里？",
], "换行即分段（不按句号拆）");

const items = stage.bandItems(speech);
assert.equal(items.length, 4);
assert.deepEqual(items.map((item) => item.current), [false, false, false, true], "只有最后一段是当前行");
assert.deepEqual(items.map((item) => item.color), ["#cccccc", "#cccccc", "#cccccc", "#ffffff"], "旧行 #cccccc / 当前行 #ffffff");
assert.equal(stage.bandItems([]).length, 0, "没有台词时是空数组（不编默认行）");

// 姓名条：真实界面没有姓名牌 → 单人时默认不画（只留接口）
const soloTag = stage.nameTagPlan([{ id: "komari", role: "teacher" }]);
assert.equal(soloTag.draw, false, "只有 1 张角色卡 → 不画姓名条");
assert.ok(soloTag.reason.includes("不画姓名条"), "不画时要给出理由（不是静默省略）");

// ── 6 · 真实渲染：真实 store（真读盘）＋ 伪造会话流 → 条目组件 ────────────────
// 🔴 条目组件自己按 `sessionId` 取 store（那是官方座的 standardProps），所以这里
//    **不塞替身 store**：直接驱动真实 storeFor → 真读盘 → 真渲染。
const RENDER_SESSION = "session-render";
const classroomStore = stage.storeFor(fakeCtx, RENDER_SESSION);
await classroomStore.refresh();
assert.equal(classroomStore.getSnapshot().status, "ready", "真实 store 读盘完成（ready）");
assert.equal(classroomStore.getSnapshot().data.title, "计算机系教室 · 操作系统", "store 里是真实教室名");

const chatSnapshot = { order, nodes: nodeStore, running: false };
const sessionSnapshot = { running: true };

let tree;
assert.doesNotThrow(() => {
	tree = registrations[0].component({
		sessionId: RENDER_SESSION,
		useChat: (selector) => selector(chatSnapshot),
		useSession: (selector) => selector(sessionSnapshot),
	});
}, "条目组件用真实教室数据 ＋ 伪造会话流渲染不抛错");

function walk(node, visit) {
	if (node === null || typeof node !== "object") return;
	visit(node);
	const kids = node.children !== undefined ? node.children : (node.props && node.props.children);
	if (Array.isArray(kids)) for (const kid of kids) walk(kid, visit);
	else if (kids !== null && typeof kids === "object") walk(kids, visit);
}
function collect(root, predicate) {
	const hits = [];
	walk(root, (node) => { if (predicate(node)) hits.push(node); });
	return hits;
}
const attrs = (name) => collect(tree, (node) => node.props && node.props[name] !== undefined).map((node) => node.props[name]);

// 根节点：挂载点与令牌边界都写在可断言的地方
assert.deepEqual(attrs("data-cs-view"), ["conversation.view"], "根节点标出挂载点");
assert.deepEqual(attrs("data-cs-band-left"), ["17.2%"], "根节点暴露正文带左边界");
assert.deepEqual(attrs("data-cs-band-right"), ["19.8%"], "根节点暴露正文带右边距（100 − 80.2）");
assert.deepEqual(attrs("data-cs-stream"), ["live", "live"], "会话流状态：live（一条在根上，一条在正文带上）");
assert.deepEqual(attrs("data-cs-canvas"), ["1920x1080"], "固定画布尺寸");

// 正文带：字号/行距/描边逐条对齐令牌
const band = collect(tree, (node) => node.props && node.props["data-cs-speech"] === "lines")[0];
assert.ok(band !== undefined, "渲染出正文带");
assert.equal(band.props["data-cs-line-count"], "4", "正文带标出行数");
assert.equal(band.props.style.fontSize, "47px", "正文字号走令牌 47px");
assert.equal(band.props.style.lineHeight, "1.74", "行距走令牌 1.74");
assert.equal(band.props.style.left, "17.2%", "左边界 17.2%");
assert.equal(band.props.style.right, "19.8%", "右边距 19.8%");
assert.equal(band.props.style.top, "14.9%", "顶对齐 14.9%");
assert.equal(band.props.style.textShadow, stage.BODY_TEXT_SHADOW, "描边走 8 向 text-shadow 环");
assert.equal(band.props.style.justifyContent, "flex-end", "超长时从顶部裁旧文（保住最新一行）");

// 逐行：旧行/当前行的**字号完全相同**，只差字色
const lineNodes = collect(tree, (node) => node.props && node.props["data-cs-line"] !== undefined);
assert.equal(lineNodes.length, 4, "渲染出 4 行台词");
assert.deepEqual(lineNodes.map((node) => node.props["data-cs-line"]), ["old", "old", "old", "current"]);
assert.deepEqual(lineNodes.map((node) => node.props.style.color), ["#cccccc", "#cccccc", "#cccccc", "#ffffff"]);
assert.deepEqual(new Set(lineNodes.map((node) => node.props.style.fontSize)), new Set(["47px"]), "🔴 旧行与当前行字号完全相同");

// 推进指示器：33×30 青色梯形，只在当前行末尾
const adv = collect(tree, (node) => node.props && node.props["data-cs-adv"] === "true");
assert.equal(adv.length, 1, "只有当前行末尾一枚推进指示器");
assert.equal(adv[0].props.style.width, "33px");
assert.equal(adv[0].props.style.height, "30px");
assert.ok(String(adv[0].props.style.clipPath).startsWith("polygon("), "梯形用 clip-path 画");
assert.ok(String(adv[0].props.style.background).includes("#7fe8ff"), "青色梯形");

// 发丝花饰：上下各一条
const flourishes = collect(tree, (node) => node.props && node.props["data-cs-flourish"] !== undefined);
assert.deepEqual(flourishes.map((node) => node.props["data-cs-flourish"]), ["top", "bottom"], "上下各一条花饰");
assert.equal(flourishes[0].props.style.width, "46%", "花饰 46% 宽");

// 书脊课程表：真实 14 讲，当前讲一枚橙红既读点，点击＝真实 handler
const spines = collect(tree, (node) => node.props && node.props["data-cs-spine"] !== undefined);
assert.equal(spines.length, 14, "渲染出 14 个书脊（真实课程表数）");
assert.equal(spines.filter((node) => typeof node.props.onClick === "function").length, 14, "每个书脊都有真实 onClick");
const readDots = collect(tree, (node) => node.props && node.props["data-cs-read-dot"] !== undefined);
assert.deepEqual(readDots.map((node) => node.props["data-cs-read-dot"]), [1], "当前讲（第 1 讲）有一枚既读点");

// 元信息与读盘状态（真实教室数据）
const titles = attrs("data-cs-title");
assert.ok(titles.includes("计算机系教室 · 操作系统"), "渲染树含真实教室标题");
assert.ok(attrs("data-cs-subject").some((value) => value.includes("操作系统")), "渲染树含真实学科");
const fields = collect(tree, (node) => node.props && node.props["data-cs-field"] !== undefined);
const fieldLabels = fields.map((node) => node.props["data-cs-field"]);
for (const label of ["当课老师", "本轮要讲", "课程进度", "当前相位", "上次上课"]) {
	assert.ok(fieldLabels.includes(label), `元信息含「${label}」`);
}
const statusNodes = collect(tree, (node) => node.props && node.props["data-cs-status"] !== undefined);
assert.equal(statusNodes[0].props["data-cs-status"], "ready", "读盘状态如实标 ready");
assert.ok(JSON.stringify(statusNodes[0].children).includes("引擎正在说话"), "会话在跑时状态行如实说（useSession.running）");

// 立绘未部署：显式状态，不冒充
const portraitStatus = attrs("data-cs-portrait-status");
assert.deepEqual(portraitStatus, ["undeployed"], "立绘未部署状态显式出现在渲染树（不冒充已部署）");

// 所有按钮都有真实 handler（不空按钮）
const buttons = collect(tree, (node) => node.type === "button");
assert.ok(buttons.length >= 15, "面板里存在可见按钮（14 书脊 ＋ 刷新）");
assert.equal(buttons.filter((node) => typeof node.props.onClick === "function").length, buttons.length, "所有按钮都带真实 onClick");

// 🔴 指针策略逐元素显式声明（C-1）：控件 auto、装饰 none，不依赖继承
const root = collect(tree, (node) => node.props && node.props["data-classroom-stage"] !== undefined)[0];
assert.equal(root.props.style.pointerEvents, "auto", "根节点显式声明指针策略（我们拥有这块会话内容区）");
for (const node of buttons) assert.equal(node.props.style.pointerEvents, "auto", "每个控件各自显式 auto");
for (const node of [...flourishes, ...adv, ...collect(tree, (node) => node.props && node.props["data-cs-portrait"] !== undefined), band]) {
	assert.equal(node.props.style.pointerEvents, "none", "装饰性元素各自显式 none");
}

// ── 7 · 会话流缺失时：显式降级，不白屏、不冒充 ────────────────────────────────
let degraded;
assert.doesNotThrow(() => {
	degraded = registrations[0].component({ sessionId: "session-degraded" });
}, "宿主没给 useChat/useSession 时渲染不抛错");
const degradedStream = collect(degraded, (node) => node.props && node.props["data-cs-speech"] !== undefined)[0];
assert.equal(degradedStream.props["data-cs-stream"], "unavailable", "读口缺失时显式标 unavailable");
assert.equal(degradedStream.props["data-cs-speech"], "empty", "读口缺失时正文带是显式空态");
assert.ok(JSON.stringify(degradedStream.children).includes("不冒充台词"), "空态写清原因，不静默空白");

// ── 8 · 截图入口：没挂载就明确报未挂载，不返回空图 ───────────────────────────
const frameMiss = stage.captureFrame("session-never-mounted");
assert.equal(frameMiss.ok, false, "未挂载的会话取帧必须失败");
assert.ok(typeof frameMiss.error === "string" && frameMiss.error.length > 0, "失败要给出可读原因");

const described = stage.describeFrame({ scale: 0.5, lines: items, classroom: { title: d.title, lesson: d.currentLesson } });
assert.deepEqual(described.canvas, { width: 1920, height: 1080 }, "帧描述带画布尺寸");
assert.equal(described.scale, 0.5);
assert.equal(described.band.leftPct, 17.2);
assert.equal(described.band.rightPct, 80.2);
assert.equal(described.band.fontSizePx, 47);
assert.equal(described.lines[3].color, "#ffffff", "帧描述里当前行是白字");
assert.equal(described.portrait, "undeployed", "帧描述里立绘如实标未部署");
assert.deepEqual(described.speakers, [], "在场者名单本轮为空（只有 1 张角色卡）");

// ── 9 · 令牌导出可用（与 classroom-ui 同一手法，供后续样式调试） ───────────────
assert.ok(stage.STAGE_TOKENS && stage.STAGE_TOKENS.PAPER_LIGHT.includes("FBF7E4"), "C 書庫纸面色调导出可用");
assert.equal(stage.STAGE_TOKENS.BODY_FONT, stage.STAGE_TOKENS.SANS, "正文字族是无衬线（真实界面是黑体＋重描边，不是衬线）");

// ── 10 · console 0（代码级等价判据） ─────────────────────────────────────────
assert.equal(errorCount, 0, "加载 + 渲染全程 console.error 计数为 0");
assert.equal(warnCount, 0, "加载 + 渲染全程 console.warn 计数为 0");
console.error = realErr;
console.warn = realWarn;

console.log("[classroom-stage] 测试全绿：挂载点 conversation.view · 真实教室数据 · 对话令牌（17.2/80.2/47/1.74/#cccccc→#ffffff）· 未部署显式状态 · 出口契约 全部通过");
