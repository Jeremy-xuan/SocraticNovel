/**
 * classroom-stage 的接线 + 渲染冒烟测试（node 侧，不需浏览器）。
 *
 * 目的：验证「通过官方支持的 slot 建一个能打开的视图」与「控制台零错」——
 *   ① apply(ctx) 确实向官方 `conversation.view` 座注册一个条目（id/order/label 正确），
 *      且**不再**往右侧栏那两处注册（右侧栏归 classroom-ui）；
 *   ② 把真实教室数据喂进真实 store，真实渲染条目组件，**不抛错**；
 *   ③ 加载与渲染全程 **console.error / console.warn 计数为 0**（代码级 console-0 等价判据）；
 *   ④ 可见控制（刷新按钮、书脊选讲）都带真实 onClick handler（不空按钮）。
 *
 * 做法：伪造 window.__ModuleLoader__ 收产物、伪造最小 React（手写 createElement 会真正递归执行
 *   函数组件，于是 Field/PortraitStage/CurriculumSpines/SelectedLessonDetail/SpeechBand 都被真实跑一遍），
 *   喂真实 classrooms/cs-os 读盘结果。
 *
 * 跑法：node clients/classroom-stage/test/wiring.test.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(HERE, "..", "..", "..");
const CLASSROOM = "classrooms/cs-os";

// ── 0 · console 探针（代码级 console-0 判据） ────────────────────────────────
let errorCount = 0;
let warnCount = 0;
const realErr = console.error.bind(console);
const realWarn = console.warn.bind(console);
console.error = (...a) => { errorCount++; realErr("[console.error 被触发]", ...a); };
console.warn = (...a) => { warnCount++; realWarn("[console.warn 被触发]", ...a); };

// ── 1 · 最小 React（手写 createElement 会真正递归执行函数组件） ──────────────
function createElement(type, props, ...children) {
	const kids = children.length === 1 ? children[0] : children;
	if (typeof type === "function") {
		const result = type(Object.assign({}, props, { children: kids }));
		return result;
	}
	return { type, props: props || {}, children: kids };
}
const React = {
	createElement,
	useState: (init) => [typeof init === "function" ? init() : init, () => {}],
	useEffect: () => {},
	useRef: () => ({ current: null }),
	useSyncExternalStore: (_sub, getSnapshot) => getSnapshot(),
};

// ── 2 · 以浏览器方式装载产物 ────────────────────────────────────────────────
let registration;
globalThis.window = { __ModuleLoader__: { load: (value) => { registration = value; } } };
const src = readFileSync(join(HERE, "..", "lib", "client.js"), "utf8");
new Function(src)();
const stage = registration.factory((spec) => {
	if (spec === "react") return React;
	throw new Error("未预期的 require(" + spec + ")");
});

// ── 3 · 伪造 ctx（含真实教室文件的 remote），跑 apply(ctx)，捕获注册 ───────────
const read = (rel) => readFileSync(join(WORKSPACE, CLASSROOM, rel), "utf8");
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
			if (text === undefined) return { ok: false, error: { message: "ENOENT " + path } };
			const offset = opts && opts.offset ? opts.offset : 1;
			if (offset > 1) return { ok: true, value: { lines: 0, text: "", eof: true } };
			return { ok: true, value: { lines: text.split("\n").length, text, eof: true } };
		},
	},
};

const registrations = [];
const injectedSlots = [];
let sidebarTouched = 0;
const ctx = {
	effect: (fn) => { fn(); }, // 模拟宿主在激活时立即执行 effect
	remote: fakeRemote,
	sidebarRightTabs: { register: () => { sidebarTouched++; } },
	slots: {
		inject: (name, factory) => { injectedSlots.push(name); return factory(); },
		register: (def, component) => { registrations.push({ def, component }); return () => {}; },
	},
};

stage.apply(ctx);

assert.deepEqual(injectedSlots, ["conversation.view"], "只往 conversation.view 注入");
assert.equal(sidebarTouched, 0, "不再注册右侧栏 tab 类型");
assert.equal(registrations.length, 1, "注册了 1 个视图条目");
const entry = registrations[0];
assert.equal(entry.def.name, "conversation.view", "注册名正确");
assert.equal(entry.def.id, "classroom-stage", "条目 id 正确（id 必填）");
assert.equal(entry.def.order, 100, "order 正确");
assert.equal(entry.def.label, "课堂舞台", "label 是切换器上显示的中文名");

// ── 4 · 真实读盘 → 真实 store → 真实渲染（不抛错） ───────────────────────────
const SESSION = "session-wiring";
const store = stage.storeFor(ctx, SESSION);
await store.refresh();
const snapshot = store.getSnapshot();
assert.equal(snapshot.status, "ready", "真实 store 读盘完成");

let tree;
assert.doesNotThrow(() => {
	tree = entry.component({
		sessionId: SESSION,
		useChat: (selector) => selector({ order: [], nodes: null, running: false }),
		useSession: (selector) => selector({ running: false }),
	});
}, "条目组件用真实教室数据渲染不抛错");

// 渲染产物应当是一个节点树，且携带真实教室标题
function walk(node, visit) {
	if (node === null || typeof node !== "object") return;
	visit(node);
	const kids = node.children !== undefined ? node.children : (node.props && node.props.children);
	if (Array.isArray(kids)) for (const kid of kids) walk(kid, visit);
	else if (kids !== null && typeof kids === "object") walk(kids, visit);
}
function findAttr(node, attr, out = []) {
	walk(node, (item) => { if (item.props && item.props[attr] !== undefined) out.push(item.props[attr]); });
	return out;
}
const titles = findAttr(tree, "data-cs-title");
assert.ok(titles.includes("计算机系教室 · 操作系统"), "渲染树含真实教室标题（data-cs-title）");
const subjects = findAttr(tree, "data-cs-subject");
assert.ok(subjects.some((s) => s.includes("操作系统")), "渲染树含真实学科");
assert.deepEqual(findAttr(tree, "data-cs-view"), ["conversation.view"], "根节点标出挂载点");

// 顶部书脊条：真实 14 讲
assert.equal(findAttr(tree, "data-cs-spine").length, 14, "渲染出 14 个书脊（真实课程表数）");
assert.deepEqual(findAttr(tree, "data-cs-read-dot"), [1], "当前讲有一枚橙红既读点");

// 会话流为空时：正文带是显式空态（不静默空白、不冒充台词）
const band = findAttr(tree, "data-cs-speech");
assert.deepEqual(band, ["empty"], "没有台词时正文带标 empty");
const streamNodes = [];
walk(tree, (item) => { if (item.props && item.props["data-cs-speech"] !== undefined) streamNodes.push(item); });
assert.equal(streamNodes[0].props["data-cs-stream"], "empty", "读口在但没台词 → empty");

// ── 5 · 可见控制都有真实 handler（不空按钮） ────────────────────────────────
const buttons = [];
walk(tree, (item) => { if (item.type === "button") buttons.push(item); });
assert.ok(buttons.length >= 15, "面板里存在可见按钮（14 书脊 ＋ 刷新）");
assert.equal(buttons.filter((b) => typeof b.props.onClick === "function").length, buttons.length, "所有按钮都带真实 onClick handler（不空按钮）");

// 立绘未部署状态必须在渲染树里（不冒充）
assert.deepEqual(findAttr(tree, "data-cs-portrait-status"), ["undeployed"], "立绘未部署状态显式出现在渲染树（不冒充已部署）");

// ── 6 · console 0（代码级等价判据） ──────────────────────────────────────────
assert.equal(errorCount, 0, "加载 + 渲染全程 console.error 计数为 0");
assert.equal(warnCount, 0, "加载 + 渲染全程 console.warn 计数为 0");

console.error = realErr;
console.warn = realWarn;
console.log("[classroom-stage] 接线/渲染冒烟全绿：conversation.view 注册正确 · 真实数据渲染不抛错 · 控制都有 handler · console 0");
