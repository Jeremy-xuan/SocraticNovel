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
 * 数据通道：宿主已提供的 `workspaceFiles` Remote
 *   - 文本：`ctx.remote.workspaceFiles.read(sessionId, path, {offset})` —— 直接读教室自己的文件
 *     （classroom.yaml / runtime/progress.md / curriculum.md / characters/komari.md）；
 *   - 二进制：`ctx.remote.workspaceFiles.readAll(sessionId, path)` —— 宿主以 **base64** 回字节，
 *     本插件解成 `Uint8Array` → `Blob` → objectURL，喂给只读复用的 Live2D 渲染宿主（见 §6.5）。
 * 不需要服务端插件配合，也没有任何假数据——见 README.md §数据通道。
 *
 * ③ 板书图（§10，T3）：老师调 `classroom_draw` 画的那张图，**在消息流里画出来**。
 *    挂载点＝官方 keyed 槽位 `tool.call.toolview`（**按 wire 工具名派发，key 域开放**），
 *    只注册 `key: "classroom_draw"` 这一个键 → 别的工具调用**一个都不碰**（照旧走官方工具树）。
 *    mermaid 源码直接来自**工具调用的入参**（`block.argsRaw` 里的 `source`），不依赖服务端回传；
 *    mermaid 的浏览器产物走**本插件自带的 vendored 单文件 IIFE 构建**（见 §10.1）。
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
		 * 立绘那一段的小标题。
		 * 🔴 改前是「立绘 · Live2D」——**那是一个实现技术的名字**，正是面板里最重的一处
		 *    "开发者工具味"。这里只换**这一处文案**（不改数据、不改功能）：教室语境里
		 *    这一块就是"老师站在讲台前"，故称「讲台」。
		 */
		const PORTRAIT_LABEL = "讲台";

		/**
		 * 面板的木框宽度（C 書庫的"满屏木框"搬进右栏）。
		 *
		 * 🔴 为什么不是 STAGE-3 的 34px：那是 **1920×1080 整屏舞台**的尺寸（占屏高 3.1%）。
		 *    右栏只有 ~760px 宽，按同一比例换算会得到 ~24px 的框——在窄栏里不是"框"是"墙"，
		 *    而且会吃掉正文列的横向空间。这里取 **6px**：在 760px 栏宽下仍能一眼认出是木框
		 *    （两侧共 12px ≈ 栏宽的 1.6%），又不与正文争地。这是**同一个材质在窄容器里的缩放**，
		 *    不是换了一种材质。
		 */
		const PANEL_FRAME = "6px";

		/** 立绘画布边长（渲染宿主按 `canvas.width/height` 取缓冲尺寸，见 §6.5）。 */
		const PORTRAIT_CANVAS_SIZE = 640;
		/** 立绘舞台的长宽比＝画布长宽比（`object-fit:contain` 下舞台与画布同形，人物才不被裁）。 */
		const PORTRAIT_ASPECT = "1 / 1";

		/**
		 * 立绘舞台的底：**必须是白的，且不能走主题 token**。
		 *
		 * 🔴 为什么（实测，不是猜）：Cubism 框架的裁剪遮罩（clipping mask）那条路会在**共享的**
		 *    WebGL 上下文上 `gl.clearColor(1, 1, 1, 1)` 并且**不还原**
		 *    （`live2d-host/out/live2d-host.bundle.mjs` 里三处逐字；Haru 有裁剪遮罩 → 触发），
		 *    于是渲染宿主每帧的 `gl.clear(COLOR_BUFFER_BIT)` 用的是**不透明白**。
		 *    浏览器里实测：`gl.getParameter(gl.COLOR_CLEAR_VALUE) === [1,1,1,1]`。
		 *    → 画布的可绘区**在深浅两种配色下都是白的**，CSS 改不了（那是帧缓冲里的像素）。
		 *    所以三个方向都把舞台底做成"白纸/白板"，让这块白成为设计的一部分
		 *    （改前是白方块直接压在深色面板上，很刺眼）。
		 *    真正的修法在渲染宿主那一侧（`clients/live2d-host/**`，不在本插件可改范围）。
		 */
		const PORTRAIT_PAPER = "#ffffff";

		/**
		 * 教室包在工作区里的相对路径（默认 cs-os）。
		 * 相对路径按**会话工作区根**解析（`workspaceFiles` 的语义），故工作区换位置也不受影响。
		 * 换教室时不必改代码：`globalThis.__DSH_CLASSROOM_UI_CONFIG__ = { root: '...' }`
		 * （与官方 `ui-sidebar-documentpreview` 读 `__DSH_DOCUMENT_PREVIEW_CONFIG__` 同一手法）。
		 */
		const DEFAULT_CLASSROOM_ROOT = "classrooms/cs-os";

		/** 面板要读的五个文件，键名即解析函数的入参名。 */
		const FILE = {
			manifest: "classroom.yaml",
			progress: "runtime/progress.md",
			curriculum: "curriculum.md",
			teacher: "characters/komari.md",
			/**
			 * 🔴 引擎（`classroom_express`）写的**本回合表情**状态文件（EXPR-1 §5.2 的客户端契约）。
			 * 它是**运行期**文件：教室第一次真跑之前**不存在**（读不到 ≠ 出错，见 `parseExpression`）。
			 * 面板读它只为了**应用**到立绘上；写者是引擎，客户端**只读不写**。
			 */
			expression: "runtime/expression.md",
		};

		/**
		 * 立绘资源根（**工作区相对路径**）。
		 * 指向 `live2d-host` 的构建产物目录 —— 那是**只读复用**：本插件不复制、不改写它，
		 * 只在运行时按相对路径把里面的文件读出来（见 §9）。
		 */
		const DEFAULT_LIVE2D_ROOT = "clients/live2d-host/out";

		/**
		 * 立绘模型的**兜底名字**（声明与注入都读不到时才用它）。
		 *
		 * 🔴 2026-10-20（D4）：改前是官方样本 `Haru` —— 而本仓库里**一张 Haru 都没有**
		 *    （`live2d-host/out` 不随仓库分发），舞台上真正在用的模型是
		 *    `clients/classroom-stage-warm/assets/models/deepseek/`。声明写 Haru、
		 *    舞台放 deepseek ＝ 两侧不一致（`checkDeployment` 会为此出声）。
		 *    现在代码默认、部署声明、舞台资产三处**都是 deepseek**，不再有第二个名字。
		 */
		const DEFAULT_MODEL = "deepseek";

		/**
		 * 立绘的**第二来源根**（工作区相对路径）：舞台包自己的资产目录。
		 *
		 * 🔴 D3「舞台没装时退回显示静态立绘图」的落地依据：`clients/classroom-stage-warm/assets/`
		 *    下同时有 `models/deepseek/`（模型）与 `l2d/live2dcubismcore.min.js`（Core），
		 *    而 `live2d-host/out` 一个文件都没有 —— 也就是说，本机唯一**真实存在**的立绘资产在这里。
		 *    仍然只读：本插件按工作区相对路径读字节，不复制、不改写它（与 mermaid vendor 同一手法）。
		 */
		const DEFAULT_PORTRAIT_ASSETS = "clients/classroom-stage-warm/assets";

		/**
		 * 立绘的**静态图**（Live2D 不可用时顶上去的那张）。
		 * 取舞台的教师立绘（`assets/stage/teacher_gen.png`）——「老师站在讲台前」这件事不变，
		 * 只是从"会呼吸的立绘"降级为"一张画"。读不到就**不显示**（由 §7 的失败态那一行说明）。
		 */
		const DEFAULT_STATIC_PORTRAIT = "clients/classroom-stage-warm/assets/stage/teacher_gen.png";

		/**
		 * 舞台宿主半边的静态路由前缀（与 `clients/classroom-stage-warm/lib/index.js` 的
		 * `ROUTE_BASE` **逐字一致**；那边改了这里必须同改）。
		 *
		 * 🔴 D3：「模型和库复用舞台已有的 `/stage-static` 路由（舞台装了就用舞台的）」。
		 *    这条路由是 **loopback-only 的同源 HTTP 路径**，浏览器直接 `fetch` 即可，
		 *    **不需要任何 token**（舞台自己的浏览器半边就是这么取的，见它的 `fetchJson(ROUTE + ...)`）。
		 *    面板只在**确实是浏览器且同源是 http(s)** 时才走这条路（见 `stageRouteAvailable`）。
		 */
		const STAGE_ROUTE = "/stage-static";

		/**
		 * 舞台那个「整屏接管」容器的 id（`clients/classroom-stage-warm/lib/client.js` 的 `ROOT_ID`）。
		 *
		 * 🔴 D2「舞台打开时暂停」的**唯一可用判据**：舞台是自建容器挂 `document.body`（不经过插槽），
		 *    关闭态（Ctrl+Shift+M）时它仍然在，只是内部换成一条「舞台已关闭」横幅
		 *    （`data-killed="on"`）。所以判据＝**容器里有一层真舞台、且不是关闭态**。
		 *    这里只读 DOM，不改、不碰舞台的任何状态。
		 */
		const STAGE_OVERLAY_ID = "stage-warm-root";
		/** 真舞台那一层的类名（关闭态那层带 `data-killed="on"`）。 */
		const STAGE_OVERLAY_CLASS = "stage-warm-root";

		/**
		 * D1：面板立绘的渲染帧率（**约 15fps**）。
		 *
		 * 🔴 为什么是"节流 tick"而不是"删掉 rAF"：`tick` 里除了 `host.step(dt)` 还有嘴型读数，
		 *    而 `dt` 是**真实流逝时间**（`(timestamp - last) / 1000`）——按 15fps 走，
		 *    Cubism 的呼吸/眨眼/物理仍然按真实时间推进，只是**每秒只画 15 张**。
		 *    删 rAF 就什么都不会动了。
		 */
		const PORTRAIT_FPS = 15;
		/** 两帧之间的最小间隔（ms）。 */
		const PORTRAIT_FRAME_MS = 1000 / PORTRAIT_FPS;

		/**
		 * D1：面板立绘**只播待机动作**（不做实时驱动）。
		 *
		 * 用户已定的设计（开发文档 §四 D）：「面板里的立绘不做实时驱动，循环播放待机动作，
		 * 在效果和资源之间折中」。落地点有两处：
		 *   · 相位切换**不再换表情**（`applyPhase` 只把待机动作起起来）；
		 *   · 引擎写的 `runtime/expression.md` **不上脸**（解析与计划照旧保留，只是不应用）。
		 * 实时驱动力度全在舞台（S 车道）。改回实时驱动＝把这两个常量/分支拿掉，
		 * 解析与读数代码一行都没删（`readout().expressionApplied` 仍会如实说"没应用"）。
		 */
		const PORTRAIT_IDLE_ONLY = true;

		/**
		 * 板书历史（W-p）的索引文件（**教室目录相对**）。
		 * 写法与引擎的 `lib/diagram.mjs` 逐字对齐：`runtime/diagrams/index.md`（一行一张图）。
		 */
		const DIAGRAMS_INDEX = "runtime/diagrams/index.md";
		/** `.mmd` 源文件所在子目录（教室目录相对）。 */
		const DIAGRAMS_SUBDIR = "runtime/diagrams";

		/**
		 * 🔴 EXPR-5：**部署声明**在工作区里的相对路径——本插件自己包里的那份文件。
		 *
		 * 它同时声明两件事，**面板与教学引擎都读它**（引擎按绝对路径读同一份，见
		 * `plugins/socratic-engine/lib/declaration.mjs`）：
		 *   · `classroomRoot` —— 教室包在工作区里的相对路径（面板读它；引擎拿它核对"我写盘的目录"）；
		 *   · `portraitModel` —— 立绘模型名（**改模型名只改这一处**，两侧同时生效）。
		 * 🔴 为什么面板读得到：客户端读工作区文件走现成通道 `ctx.remote.workspaceFiles.read(sessionId, path)`
		 *    （path 为**工作区相对**路径），与本插件已有的 `DEFAULT_CLASSROOM_ROOT` / `DEFAULT_LIVE2D_ROOT`
		 *    / `DEFAULT_MERMAID_PATH` 三个常量同一手法。
		 */
		const DEFAULT_DECLARATION_PATH = "clients/classroom-ui/classroom.config.json";

		/**
		 * 私有资源 scheme：渲染宿主只会「按 URL 取资源」（`fetch` 与 `new Image().src`），
		 * 本插件用一个私有 scheme 把那些 URL 接到工作区文件上（见 §9.3）。
		 * 形如 `dsh-classroom-asset://classroom/models/Haru/Haru.moc3`。
		 */
		const ASSET_SCHEME = "dsh-classroom-asset://classroom/";

		/** 官方框架取着色器的目录（`opts.shaderBaseUrl`，会与下面的文件名做字符串拼接）。 */
		const SHADER_DIR = "shaders/WebGL/";

		/**
		 * 画图工具（T3a）在客户端这一侧认的 **wire 工具名**。
		 * 这个字符串就是 `tool.call.toolview` 槽位的派发键（官方契约逐字：
		 * "dispatched by the wire Tool name"，见 §10.1），所以**必须与服务端
		 * `defineTool({name})` 的写法逐字一致**，否则本插件注册的视图永远不会被派发。
		 */
		const DRAW_TOOL_NAME = "classroom_draw";

		/**
		 * vendored 的 mermaid 浏览器产物（**单文件 IIFE 构建**）在工作区里的相对路径。
		 * 与教室根同一处配置：`globalThis.__DSH_CLASSROOM_UI_CONFIG__.mermaidPath`。
		 * 版本与来源见 `vendor/mermaid-11.17.2/BUILD-INFO.txt`。
		 */
		const DEFAULT_MERMAID_PATH = "clients/classroom-ui/vendor/mermaid-11.17.2/mermaid.min.js";

		// ── mermaid 主题配置（MERMAID-2 接入）─────────────────────────────────
		// 来源：`research/mermaid-pretty/claude-mermaid-theme.mjs`
		// （MERMAID-1 PoC 产物，**整段抄进来**，不改一个色值；理由：客户端产物是手写的
		//  惰性 CJS 表，没有打包器，跑时再去工作区读一份 .mjs 会多一条 IO 与一条失败路径，
		//  而主题是**纯数据**，随包走最稳。换色值＝改这里，并同时 +1 `DIAGRAM_THEME_REV`）。
		//
		// ⚠️ 事实边界（不许含糊）：色值/圆角/字号是**按 Claude 界面观感定的设计推断**，
		//    证据是 Anthropic 官方博客截图（暖米底 ＋ 极低饱和色块 ＋ 发丝描边 ＋ 大圆角 ＋ 无投影，
		//    见 `research/mermaid-pretty/out/evidence-claude-blog/`）。**没有任何一手证据表明
		//    Anthropic 的 mermaid 渲染器用了这组色值**——公开资料里找不到 Claude 的 mermaid
		//    主题配置。变量名则逐个对着本仓库那份 mermaid 11.17.2 产物核过。
		// 🔴 只对 mermaid 11.17.2 验证过。换版本＝重新验证，不得外推。

		/** 暖色浅色系（默认）：暖象牙画布 ＋ 白节点 ＋ 发丝描边 ＋ 8px 圆角 ＋ 无投影。 */
		const CLAUDE_MERMAID_LIGHT = {
			darkMode: false,
			background: "#FAF9F5",
			fontFamily:
				'"Styrene B", "Styrene A", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
			fontSize: "15px",
			primaryColor: "#FFFFFF",
			primaryTextColor: "#3D3D3A",
			primaryBorderColor: "#D9D4C8",
			mainBkg: "#FFFFFF",
			nodeBorder: "#D9D4C8",
			nodeTextColor: "#3D3D3A",
			secondaryColor: "#F5F4EF",
			tertiaryColor: "#F0EEE6",
			lineColor: "#B9B4A9",
			textColor: "#3D3D3A",
			titleColor: "#3D3D3A",
			edgeLabelBackground: "#FAF9F5",
			defaultLinkColor: "#B9B4A9",
			clusterBkg: "#F5F4EF",
			clusterBorder: "#E3DFD4",
			actorBkg: "#FFFFFF",
			actorBorder: "#D9D4C8",
			actorTextColor: "#3D3D3A",
			actorLineColor: "#D9D4C8",
			signalColor: "#3D3D3A",
			signalTextColor: "#3D3D3A",
			labelBoxBkgColor: "#F5F4EF",
			labelBoxBorderColor: "#D9D4C8",
			labelTextColor: "#3D3D3A",
			loopTextColor: "#6B6862",
			noteBkgColor: "#F7F1E4",
			noteTextColor: "#3D3D3A",
			noteBorderColor: "#E4D9BF",
			activationBkgColor: "#EFE9DC",
			activationBorderColor: "#D9D4C8",
			sequenceNumberColor: "#FFFFFF",
			classText: "#3D3D3A",
			stateBkg: "#FFFFFF",
			stateBorder: "#D9D4C8",
			/**
			 * 🔴 **状态图的「状态名」文字色**（EXPR-3 那一轮补的）。
			 *    mermaid 11.17.2 里这一项的取值逐字是
			 *    `stateLabelColor = this.stateLabelColor || this.stateBkg || th`
			 *    （`vendor/mermaid-11.17.2/mermaid.min.js` 可 grep 复现）——
			 *    也就是**不给它，它就拿 `stateBkg` 当文字色**；而 `stateBkg` 是白盒
			 *    → **白字压白盒**：状态框里一个字都看不见（转移标签正常，所以只看缩略图极易漏掉）。
			 *    实测证据：`getComputedStyle(<foreignObject> p).color === "rgb(255, 255, 255)"`，
			 *    而 `rect.fill === "rgb(255, 255, 255)"`（见 `evidence/expr3/anim/`）。
			 */
			stateLabelColor: "#3D3D3A",
			labelBackgroundColor: "#FAF9F5",
			compositeBackground: "#F5F4EF",
			compositeBorder: "#E3DFD4",
			transitionColor: "#B9B4A9",
			transitionLabelColor: "#6B6862",
			attributeBackgroundColorOdd: "#FFFFFF",
			attributeBackgroundColorEven: "#F5F4EF",
			pie1: "#D97757",
			pie2: "#C7B9A1",
			pie3: "#8FA08C",
			pie4: "#B6A8C9",
			pie5: "#D9C27A",
			pie6: "#9BB0C4",
			pie7: "#C99A9A",
			pie8: "#A9B6A0",
			pieTitleTextColor: "#3D3D3A",
			pieSectionTextColor: "#3D3D3A",
			pieLegendTextColor: "#6B6862",
			pieStrokeColor: "#FAF9F5",
			pieOuterStrokeColor: "#E3DFD4",
			sectionBkgColor: "#F5F4EF",
			altSectionBkgColor: "#FFFFFF",
			sectionBkgColor2: "#F0EEE6",
			taskBkgColor: "#E3DFD4",
			taskTextColor: "#3D3D3A",
			taskTextOutsideColor: "#6B6862",
			taskTextLightColor: "#3D3D3A",
			taskBorderColor: "#D9D4C8",
			activeTaskBkgColor: "#D97757",
			activeTaskBorderColor: "#C96447",
			doneTaskBkgColor: "#EDEAE3",
			doneTaskBorderColor: "#D9D4C8",
			gridColor: "#E9E6DE",
			todayLineColor: "#D97757",
			errorBkgColor: "#F7F1E4",
			errorTextColor: "#3D3D3A",
			radius: 8,
			strokeWidth: 1,
			useGradient: false,
			dropShadow: "none",
		};

		/** 暖色深色系（对应 Claude 深色界面：近黑 ＋ 暖灰字，不发蓝）。 */
		const CLAUDE_MERMAID_DARK = Object.assign({}, CLAUDE_MERMAID_LIGHT, {
			darkMode: true,
			background: "#262624",
			primaryColor: "#30302E",
			primaryTextColor: "#F0EEE6",
			primaryBorderColor: "#45443F",
			mainBkg: "#30302E",
			nodeBorder: "#45443F",
			nodeTextColor: "#F0EEE6",
			secondaryColor: "#333330",
			tertiaryColor: "#3A3A36",
			lineColor: "#6E6C66",
			textColor: "#F0EEE6",
			titleColor: "#F0EEE6",
			edgeLabelBackground: "#262624",
			defaultLinkColor: "#6E6C66",
			clusterBkg: "#2E2E2B",
			clusterBorder: "#45443F",
			actorBkg: "#30302E",
			actorBorder: "#45443F",
			actorTextColor: "#F0EEE6",
			actorLineColor: "#45443F",
			signalColor: "#F0EEE6",
			signalTextColor: "#F0EEE6",
			labelBoxBkgColor: "#333330",
			labelBoxBorderColor: "#45443F",
			labelTextColor: "#F0EEE6",
			loopTextColor: "#B8B4AB",
			noteBkgColor: "#3A3630",
			noteTextColor: "#F0EEE6",
			noteBorderColor: "#4E4839",
			activationBkgColor: "#3A3A36",
			activationBorderColor: "#45443F",
			classText: "#F0EEE6",
			stateBkg: "#30302E",
			stateBorder: "#45443F",
			/** 状态名文字色：深色下不给它就会拿 `stateBkg`（#30302E）当字色 → 同样看不见，见浅色那一段的说明。 */
			stateLabelColor: "#F0EEE6",
			labelBackgroundColor: "#262624",
			compositeBackground: "#2E2E2B",
			compositeBorder: "#45443F",
			transitionColor: "#6E6C66",
			transitionLabelColor: "#B8B4AB",
			attributeBackgroundColorOdd: "#30302E",
			attributeBackgroundColorEven: "#333330",
			pieStrokeColor: "#262624",
			pieOuterStrokeColor: "#45443F",
			sectionBkgColor: "#333330",
			altSectionBkgColor: "#262624",
			sectionBkgColor2: "#3A3A36",
			taskBkgColor: "#45443F",
			taskTextColor: "#F0EEE6",
			taskTextOutsideColor: "#B8B4AB",
			taskTextLightColor: "#F0EEE6",
			taskBorderColor: "#45443F",
			doneTaskBkgColor: "#3A3A36",
			doneTaskBorderColor: "#45443F",
			gridColor: "#3A3A36",
			errorBkgColor: "#3A3630",
			errorTextColor: "#F0EEE6",
		});

		/**
		 * 主题 CSS —— 整段进 mermaid 的 `themeCSS`。只做**默认主题做不到的静态修饰**；
		 * 动画不在这里（动画是逐元素的行为，见 §6.7 的 `animateStagger`）。
		 * ⚠️ 这里写的注释会被 stylis 抹掉，**不要用"注释在不在"判断它有没有生效**——
		 *    要看计算样式（`getComputedStyle(rect).rx === "8px"`）。
		 */
		const CLAUDE_MERMAID_THEME_CSS = `
  /* 画布：去掉默认投影，统一字重 */
  & .node rect, & .node circle, & .node ellipse, & .node polygon, & .node path {
    stroke-width: 1px;
    filter: none;
    rx: 8px;
    ry: 8px;
  }
  & .label, & .nodeLabel, & .edgeLabel, & text {
    font-weight: 400;
    letter-spacing: 0.005em;
  }

  /* 节点内边距：默认偏挤，撑开一点（mermaid 的 label-container 是 rect） */
  & .node .label-container { padding: 2px; }

  /* 连线：发丝、圆头、低对比 */
  & .edgePaths path, & .flowchart-link, & .messageLine0, & .messageLine1, & .transition {
    stroke-width: 1.1px;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  & marker path, & .arrowheadPath { fill: #B9B4A9; stroke: none; }

  /* 边标签：给一点底色留白，别压在线上 */
  & .edgeLabel rect, & .edgeLabel foreignObject > div {
    background: #FAF9F5;
    border-radius: 5px;
  }
  & .edgeLabel foreignObject > div {
    padding: 1px 6px !important;
    color: #6B6862 !important;
    font-size: 13px;
  }

  /* 子图标题：小、灰、不抢戏 */
  & .cluster-label .nodeLabel, & .cluster text {
    fill: #8A8781;
    font-size: 13px;
    letter-spacing: 0.02em;
  }
  & .cluster rect { rx: 10px; ry: 10px; stroke-dasharray: none; }

  /* 时序图：生命线细虚线，参与者盒子大圆角 */
  & .actor-line { stroke-width: 1px; stroke-dasharray: 3 4; }
  & rect.actor { rx: 8px; ry: 8px; }
  & .note { rx: 8px; ry: 8px; }
  & .loopLine { stroke-dasharray: 3 4; }

  /* 状态图：圆角 + 起止点的软边 */
  & .stateGroup rect, & .stateGroup .state-title { rx: 8px; }
  & .statediagram-cluster rect { rx: 10px; ry: 10px; }

  /* 类图 / ER：表头浅底，行分隔发丝 */
  & .classGroup rect { rx: 8px; ry: 8px; }
  & .classGroup .divider { stroke: #EDEAE3; }
  & .er.entityBox { rx: 8px; ry: 8px; }
  & .er.attributeBoxOdd, & .er.attributeBoxEven { stroke: #EDEAE3; }

  /* 去掉 mermaid 默认给节点加的投影类 */
  & .drop-shadow, & .node .drop-shadow { filter: none; }
`;

		/**
		 * 🔴 **缓存键里的主题版本号**：改了上面任何一个色值/主题 CSS，都要把它 **+1**。
		 * 否则 `diagramCache` 里按「主题名 ＋ 源码」缓存的旧图不会失效 → 用户改完主题仍看到旧配色。
		 * （v1 ＝ 首次接入 Claude 风主题：MERMAID-2。）
		 */
		/**
		 * 主题数据的**修订号**：`diagramFor` 的缓存键里必须带上它。
		 * 🔴 **改了任何主题色值/变量就要 +1**（EXR-3 补 `stateLabelColor` 时从 claude-v1 → claude-v2）：
		 *    不然浏览器里那份旧缓存会继续用旧主题画图，"改了代码没生效"的假象就是这么来的。
		 */
		const DIAGRAM_THEME_REV = "claude-v2";

		/**
		 * 板书图动画的默认档（`uiConfig().drawAnim` 没写或写了不认识的值时用它）。
		 * `"stagger"` ＝ 候选 B（逐层长出）；写 `"none"` 即可**不改代码回退到候选 A**（只换主题）。
		 * 详见 `drawAnimMode()`。
		 */
		const DRAW_ANIM_DEFAULT = "stagger";

		/** 判定"深色模式"的属性名。官方主题层就是靠它切换整套 CSS 变量（见 §10.4）。 */
		const DARK_ATTRIBUTE = "data-ds-dark-theme";

		/** mermaid 产物与渲染结果的整页级状态（与 session 无关：产物是同一份，图按源码缓存）。 */
		/** 已装载的 mermaid API；`null` ＝ 还没装（或上次装失败，可重试）。 */
		let mermaidReady = null;
		/** 渲染 id 的自增序号（mermaid 要求每次 render 一个唯一 id）。 */
		let diagramRenderSeq = 0;
		/** 缓存键（主题 ＋ 源码）→ Promise<{svg, ms}>。 */
		const diagramCache = new Map();
		/** 「设主题 → 渲染」这一对的串行链（见 `renderDiagram` 的说明：`initialize` 是整页共享配置）。 */
		let renderChain = Promise.resolve();

		/**
		 * 诊断钩子（**默认关**）：`globalThis.__DSH_CLASSROOM_UI_CONFIG__.diag = true` 时，
		 * 把渲染成败与运行时环境记进 `globalThis.__DSH_CLASSROOM_UI_DIAG__`。
		 * 存在的理由：渲染失败发生在浏览器里，服务端日志看不到；没有这个口子就只能靠猜。
		 */
		function recordDiag(entry) {
			if (uiConfig().diag !== true) return;
			const bag = globalThis.__DSH_CLASSROOM_UI_DIAG__ === undefined ? [] : globalThis.__DSH_CLASSROOM_UI_DIAG__;
			bag.push(entry);
			globalThis.__DSH_CLASSROOM_UI_DIAG__ = bag;
		}

		/**
		 * 记一次渲染失败：报错原文 ＋ 完整栈 ＋ 当时的运行时环境（用于定位"为什么画不出来"）。
		 *
		 * 🔴 **诊断路径本身绝不许抛**：它是在"已经出错"的分支里跑的，自己再抛就会**把真正的报错盖掉**。
		 *    所以这里一律用 `typeof x === "undefined"` 做守卫（不是直接 `x.foo`）——
		 *    非浏览器环境（node 侧测试驱动同一份代码）里 `document` 根本不存在。
		 */
		function recordRenderFailure(error, source) {
			const hasDocument = typeof document !== "undefined" && document !== null;
			recordDiag({
				at: "renderDiagram",
				message: messageOf(error),
				stack: error instanceof Error && typeof error.stack === "string" ? error.stack.slice(0, 1500) : null,
				sourceHead: source.slice(0, 120),
				env: {
					document: typeof document,
					createElementNS: hasDocument ? typeof document.createElementNS : null,
					window: typeof globalThis.window,
					mermaid: typeof globalThis.mermaid,
					version: typeof globalThis.mermaid === "undefined" ? null : String(globalThis.mermaid.mermaidAPI.getConfig().version),
				},
				realm: hasDocument ? {
					docUrl: String(document.URL),
					baseUri: String(document.baseURI),
					docBodyPresent: document.body !== null,
					docHeadPresent: document.head !== null,
					docDefaultViewPresent: document.defaultView !== null,
					headChildCount: document.head === null ? null : document.head.childElementCount,
					bodyChildCount: document.body === null ? null : document.body.childElementCount,
				} : null,
			});
		}

		/**
		 * 官方框架按 `shaderBaseUrl + <文件名>` 逐个 `fetch` 这 13 个着色器。
		 * 文件名逐字抄自本地 vendored 源码（可 grep 复现）：
		 * `clients/live2d-host/vendor/CubismWebFramework/src/rendering/cubismshader_webgl.ts:22-39`。
		 */
		const SHADER_FILES = [
			"vertshadersrc.vert",
			"vertshadersrcmasked.vert",
			"vertshadersrcsetupmask.vert",
			"fragshadersrcsetupmask.frag",
			"fragshadersrcpremultipliedalpha.frag",
			"fragshadersrcmaskpremultipliedalpha.frag",
			"fragshadersrcmaskinvertedpremultipliedalpha.frag",
			"vertshadersrccopy.vert",
			"fragshadersrccopy.frag",
			"fragshadersrccolorblend.frag",
			"fragshadersrcalphablend.frag",
			"vertshadersrcblend.vert",
			"fragshadersrcpremultipliedalphablend.frag",
		];

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

		/**
		 * 板书图索引的工作区相对路径（`<教室>/runtime/diagrams/index.md`）。
		 * 与 `classroomPath` 同一手法，只是这个文件**不在 `FILE` 表里**：
		 * `FILE` 是"面板进门就要读的五个文件"，而索引是**板书 tab 打开时才读**的（见 `loadDiagramHistory`）。
		 * 🔴 不并进 `FILE` 的理由：并进去＝每次 `loadClassroom` 都多一次读盘 + 多一行「数据来源」，
		 *    而那张表是"教室的状态文件"清单，板书图是**产物**（引擎侧的 `diagramstore.mjs` 头注释同一口径）。
		 * @returns 工作区相对路径
		 */
		function diagramsIndexPath() {
			return classroomRoot() + "/" + DIAGRAMS_INDEX;
		}

		/**
		 * 一张 `.mmd` 的工作区相对路径。
		 * @param file - 索引表里「源文件」那一列的取值（`L03-T05-….mmd`，可能带反引号）
		 * @returns 工作区相对路径；`file` 不合法时 null（**词法拒绝，不猜**）
		 */
		function diagramPath(file) {
			const name = String(file === null || file === undefined ? "" : file).replace(/`/g, "").trim();
			// 只认"本目录里的一个文件名"：索引是引擎写的，但**读到的东西不等于可信**
			// （它哪天被手改、或被写进 `../` 就该当场拒绝，而不是拿它去拼路径）。
			if (name === "" || name.includes("/") || name.includes("\\") || name.includes("..")) return null;
			return classroomRoot() + "/" + DIAGRAMS_SUBDIR + "/" + name;
		}

		/** @returns 立绘静态图的工作区相对路径（`__DSH_CLASSROOM_UI_CONFIG__.staticPortrait` 可覆盖）。 */
		function staticPortraitPath() {
			const configured = uiConfig().staticPortrait;
			return typeof configured === "string" && configured.length > 0 ? configured : DEFAULT_STATIC_PORTRAIT;
		}

		/** @returns 立绘第二资产根（工作区相对，去尾斜杠；`__DSH_CLASSROOM_UI_CONFIG__.portraitAssets` 可覆盖）。 */
		function portraitAssetsRoot() {
			const configured = uiConfig().portraitAssets;
			const declared = declarationSync();
			const fallback = declared !== null && declared.ok === true && typeof declared.portraitAssets === "string"
				? declared.portraitAssets
				: DEFAULT_PORTRAIT_ASSETS;
			const value = typeof configured === "string" && configured.length > 0 ? configured : fallback;
			return value.endsWith("/") ? value.slice(0, -1) : value;
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
		 *
		 * 🔴 人读表格的字段名以 `runtime/progress.md` 为准，与 `classrooms/cs-os/AGENTS.md:63-66`
		 *    的事实契约逐字对齐：人读行是 **`本轮要讲`**（＝本轮要讲的讲次，与 current_lesson 机器行同值）
		 *    与 **`已完成`**（＝已上过的讲数），**没有**「当前讲次」也没有「下次上课」两行
		 *    （它们曾与本轮要讲说同一件事又可能对不上，契约已删）。
		 *    本函数只读现存字段；读不到的字段一律 null，面板显示「未提供」，不填默认值。
		 * @param text - progress.md 全文
		 * @returns {currentLesson, currentPhase, teacher, progressText, humanLesson, doneCount, lastDate}
		 */
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
		// 3.5 · 表情状态文件（`runtime/expression.md`）——引擎 → 客户端的**唯一契约**
		//
		// 契约出处：`实现报告_EXPR1_表情自主控制_2026-09-24.md` §5.2（引擎侧写者：
		// `socratic-engine/lib/expressionstore.mjs`）。文件是**顶部机器可读行 ＋ 人读表格**，
		// 客户端**按行取值、不解析中文**（与 `runtime/progress.md` 同一手法）。
		//
		// 🔴 `expression_path` 是**客户端唯一该分支的字段**：
		//    `named-expression` | `face-parameters` | `motion` | `-`（`-` ＝ 三条手段都不可用）。
		//    三条**并列**，不是主/备关系；引擎已按优先级选好一条，并把结果写进对应的那一行。
		// ════════════════════════════════════════════════════════════════════

		/** 机器可读行的取值：空串与 `-` 一律当「没有」（`-` 就是引擎的占位符）。 */
		function expressionLine(text, key) {
			const matched = text.match(new RegExp("^" + key + ":\\s*(.*?)\\s*$", "m"));
			if (matched === null) return null;
			const value = matched[1];
			return value === "" || value === "-" ? null : value;
		}

		/**
		 * 解析 `expression_face` 行（`参数id=值,参数id=值`，按 id 排序）。
		 * 口径**照抄引擎自己的 `parseFaceParams`**（`socratic-engine/lib/expression.mjs`）：
		 * 认不出的片段跳过、数值必须是有限数——但**跳过了哪些要如实报出来**（不静默少写）。
		 * @param value - 该行原文（可为 null）
		 * @returns {{face: Record<string, number>, malformed: string[]}}
		 */
		function parseExpressionFace(value) {
			const face = {};
			const malformed = [];
			if (typeof value !== "string" || value === "") return { face: face, malformed: malformed };
			for (const part of value.split(",")) {
				const at = part.indexOf("=");
				if (at <= 0) { malformed.push(part.trim()); continue; }
				const id = part.slice(0, at).trim();
				const num = Number(part.slice(at + 1));
				if (id === "" || !Number.isFinite(num)) { malformed.push(part.trim()); continue; }
				face[id] = num;
			}
			return { face: face, malformed: malformed };
		}

		/**
		 * 解析 `runtime/expression.md` 的机器可读行。
		 * **读不到就如实给 null**，不填默认值（与 `parseProgress` 同一纪律）。
		 *
		 * 🔴 `hasPathLine` 与 `path` 是**两件事**，不能混：
		 *    · `hasPathLine === false` → 文件里**没有** `expression_path` 这一行（旧格式）；
		 *    · `hasPathLine === true` 且 `path === null` → 那一行写了 `-`，即引擎**明确判定三条手段都不可用**。
		 *    前者要"按优先级推断并标注推断"，后者**不许推断**（引擎已经给了结论）。
		 * @param text - 文件全文
		 * @returns {object} 每个键读不到即 null；`face` 为 `Record<string, number>`
		 */
		function parseExpression(text) {
			const faceLine = expressionLine(text, "expression_face");
			const parsedFace = parseExpressionFace(faceLine);
			return {
				hasPathLine: /^expression_path:\s*(.*?)\s*$/m.test(text),
				path: expressionLine(text, "expression_path"),
				expression: expressionLine(text, "current_expression"),
				face: parsedFace.face,
				faceMalformed: parsedFace.malformed,
				motion: expressionLine(text, "expression_motion"),
				origin: expressionLine(text, "expression_origin"),
				emotion: expressionLine(text, "expression_emotion"),
				turn: expressionLine(text, "expression_turn"),
				capability: expressionLine(text, "expression_capability"),
				note: expressionLine(text, "expression_note"),
			};
		}

		/** 三条手段在面板上的中文名（`expression_path` 的取值 → 人话）。 */
		const EXPRESSION_PATH_LABEL = {
			"named-expression": "命名表情",
			"face-parameters": "逐参数",
			motion: "动作组",
		};

		/** 三条手段的优先级——与引擎侧 `EXPRESSION_PATH_TIEBREAK` 逐字一致。 */
		const EXPRESSION_PATH_ORDER = ["named-expression", "face-parameters", "motion"];

		/** 声明读取失败时的统一形状（`portraitAssets` 也一并给，免得调用方多一种 undefined）。 */
		function declarationFailure(reason) {
			return { ok: false, reason: reason, classroomRoot: null, portraitModel: null, portraitAssets: null };
		}

		/**
		 * 解析**部署声明**（EXPR-5；纯函数，测试直接喂字符串）。
		 *
		 * 与 `parseProgress` 同一纪律：**读不到就 ok:false ＋ 原因**，绝不填默认值——
		 * 静默的默认值会让"声明写坏了"表现成"一切正常"，而这正是本轮要消灭的失效模式。
		 * @param text - `classroom.config.json` 全文
		 * @returns {{ok:boolean, reason:string|null, classroomRoot:string|null, portraitModel:string|null,
		 *            portraitAssets:string|null}}
		 */
		function parseDeclaration(text) {
			const fail = declarationFailure;
			let raw;
			try {
				raw = JSON.parse(text);
			} catch (error) {
				return fail("不是合法 JSON（" + messageOf(error) + "）");
			}
			if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return fail("顶层必须是对象");
			if (typeof raw.classroomRoot !== "string" || raw.classroomRoot.trim() === "") {
				return fail("缺 `classroomRoot`（字符串：教室包在工作区里的相对路径）");
			}
			if (raw.classroomRoot.startsWith("/")) {
				// 面板只能读**工作区相对**路径（`workspaceFiles` 的语义）→ 声明里写绝对路径在面板这一侧必然读不到。
				return fail("`classroomRoot` 必须是工作区相对路径（得到绝对路径 " + JSON.stringify(raw.classroomRoot) + "）");
			}
			if (typeof raw.portraitModel !== "string" || raw.portraitModel.trim() === "") {
				return fail("缺 `portraitModel`（字符串：立绘模型名，如 deepseek）");
			}
			/**
			 * 🔴 `portraitAssets`（D3 新增，**可选**）：立绘资产的第二来源根。
			 *    · 不给 → 用代码默认（`DEFAULT_PORTRAIT_ASSETS`，即舞台包的 assets/）；
			 *    · 给了但不是字符串／是绝对路径 → **整份声明判失败**（与 classroomRoot 同一条纪律：
			 *      写错了必须当场响，不许悄悄退回默认值——那正是"改了配置没生效"的来源）。
			 */
			let portraitAssets = null;
			if (raw.portraitAssets !== undefined && raw.portraitAssets !== null) {
				if (typeof raw.portraitAssets !== "string" || raw.portraitAssets.trim() === "") {
					return fail("`portraitAssets` 必须是字符串（立绘资产的第二来源根，工作区相对路径）");
				}
				if (raw.portraitAssets.startsWith("/")) {
					return fail("`portraitAssets` 必须是工作区相对路径（得到绝对路径 " + JSON.stringify(raw.portraitAssets) + "）");
				}
				portraitAssets = normalizeRelativePath(raw.portraitAssets);
			}
			return {
				ok: true,
				reason: null,
				classroomRoot: normalizeRelativePath(raw.classroomRoot),
				portraitModel: raw.portraitModel.trim(),
				portraitAssets: portraitAssets,
			};
		}

		/** 工作区相对路径的词法归一：去首尾空白、去 `./` 前缀、去尾斜杠（**只做词法，不解析软链**）。 */
		function normalizeRelativePath(value) {
			let out = String(value).trim().replace(/^\.\//, "");
			while (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
			return out;
		}

		/**
		 * 🔴 EXPR-5 的**部署一致性自检**（纯函数：两个"有效值"＋一份声明 → 结论）。
		 *
		 * 为什么要有它：面板读 `classroomRoot()`、引擎写自己的 `classroomDir`，
		 * **两边指不同目录时没有任何一处会出声**（引擎照写、面板照读不到）→ 表现成
		 * "引擎写了但面板看不到"。本函数把这件事变成一个**可被机器检查**的判据。
		 *
		 * 判据（三种，各自说清后果）：
		 *   · `ok`        —— 面板的有效教室目录 ＝ 声明里的；有效模型 ＝ 声明里的；
		 *   · `mismatch`  —— 至少一项不一致（页面注入／--patch 把某一侧改走了）→ **出声**；
		 *   · `unreadable`—— 声明读不到或写坏了 → 一致性**没核成**，也出声（"没核成"不等于"没问题"）。
		 * @param declaration - `parseDeclaration` 的结果（或 null＝还没读到）
		 * @param root - 面板的有效教室根（`classroomRoot()`）
		 * @param model - 面板的有效模型名（`modelName()`）
		 * @param declarationPath - 声明文件的工作区相对路径（用于把话说全）
		 * @returns {{status, rootOk, modelOk, declaredRoot, declaredModel, effectiveRoot, effectiveModel, path, lines}}
		 */
		function checkDeployment(declaration, root, model, declarationPath) {
			const effectiveRoot = normalizeRelativePath(root);
			const effectiveModel = typeof model === "string" ? model : "";
			if (declaration === null || declaration === undefined || declaration.ok !== true) {
				const reason = declaration === null || declaration === undefined ? "还没读到声明文件" : declaration.reason;
				return {
					status: "unreadable",
					rootOk: null, modelOk: null,
					declaredRoot: null, declaredModel: null,
					effectiveRoot: effectiveRoot, effectiveModel: effectiveModel,
					path: declarationPath,
					lines: [
						"部署一致性**没核成**：" + declarationPath + " 读不到或不可用（" + reason + "）",
						"→ 「面板读的目录」与「引擎写的目录」是不是同一个，这次没有机核。修法：确认该文件存在且含 classroomRoot 与 portraitModel。",
					],
				};
			}
			const rootOk = declaration.classroomRoot === effectiveRoot;
			const modelOk = declaration.portraitModel === effectiveModel;
			const lines = [];
			if (!rootOk) {
				lines.push(
					"🔴 教室目录两侧不一致：面板读 " + effectiveRoot + "，部署声明里是 " + declaration.classroomRoot +
						" → 引擎若按声明/自己的配置写，就会出现「引擎写了但面板看不到」（不报错）。",
				);
				lines.push(
					"→ 修法（改一处）：① 把 " + declarationPath + " 的 classroomRoot 改成面板这个目录；" +
						"② 或去掉页面注入的 `__DSH_CLASSROOM_UI_CONFIG__.root`（不设＝用声明）。" +
						"引擎那一侧装载时也会报同一条（见它的 `部署声明不一致` 日志）。",
				);
			}
			if (!modelOk) {
				lines.push(
					"🔴 立绘模型两侧不一致：面板装载 " + effectiveModel + "，部署声明里是 " + declaration.portraitModel +
						" → 引擎按声明去能力发现产物里挑清单，**引擎报的表情/参数与脸上的模型不是同一张**（不报错，会静默错位）。",
				);
				lines.push("→ 修法：把页面注入的 `__DSH_CLASSROOM_UI_CONFIG__.model` 去掉（不设＝用声明），或把声明的 portraitModel 改成这个模型。");
			}
			return {
				status: rootOk && modelOk ? "ok" : "mismatch",
				rootOk: rootOk, modelOk: modelOk,
				declaredRoot: declaration.classroomRoot, declaredModel: declaration.portraitModel,
				effectiveRoot: effectiveRoot, effectiveModel: effectiveModel,
				path: declarationPath,
				lines: lines,
			};
		}

		/** 部署声明的读取状态：`null`＝还没读；否则 `{path, declaration}`（**已落定**，供同步取值）。 */
		let declarationResolved = null;
		/** 读取中的 Promise（幂等：同一页面只读一次）。 */
		let declarationRead = null;

		/**
		 * @returns 部署声明在工作区里的相对路径（去尾斜杠）。
		 * 与 `root` / `model` / `live2dRoot` / `mermaidPath` 同一处配置面：
		 * `globalThis.__DSH_CLASSROOM_UI_CONFIG__.declarationPath` 可覆盖。
		 * 什么时候要覆盖：**换部署**（另一份声明）与**取证**（要在一个页面里同时摆出"一致"与"不一致"两种情形）。
		 */
		function declarationPath() {
			const configured = uiConfig().declarationPath;
			const value = typeof configured === "string" && configured.length > 0 ? configured : DEFAULT_DECLARATION_PATH;
			return value.endsWith("/") ? value.slice(0, -1) : value;
		}

		/**
		 * 读一次部署声明并缓存（**幂等**）。
		 * 读失败也缓存结论（`ok:false` ＋ 原因），**不抛**——声明读不到不该让面板挂掉，
		 * 但它必须**出声**（由 `checkDeployment` 的 `unreadable` 分支负责）。
		 * @param remote - 客户端 Remote 面
		 * @param sessionId - 会话 id
		 * @returns {Promise<object>} `{path, declaration}`；`declaration` 为 `parseDeclaration` 的结果
		 */
		function ensureDeclaration(remote, sessionId) {
			if (declarationRead !== null) return declarationRead;
			const path = declarationPath();
			declarationRead = (async () => {
				let settled;
				try {
					const text = await readText(remote, sessionId, path, undefined);
					settled = { path: path, declaration: parseDeclaration(text) };
				} catch (error) {
					settled = {
						path: path,
						declaration: declarationFailure("读不到文件（" + messageOf(error) + "）"),
					};
				}
				declarationResolved = settled;
				return settled;
			})();
			return declarationRead;
		}

		/** 已落定的声明（同步取，供 `modelName()` 用；没落定就是 null）。 */
		function declarationSync() {
			return declarationResolved === null ? null : declarationResolved.declaration;
		}


		/**
		 * 把状态文件正文变成**一条可执行的路**（纯函数，供面板与测试共用）。
		 *
		 * 三种来源分得很清，**不许混**：
		 *   · `absent`  —— 教室还没有这个文件（引擎没写过）→ 面板**沿用旧的相位映射**并如实标注；
		 *   · `engine`  —— 文件在，走它说的那条路（`path` 有值）或**明说不可用**（`path` 为 null）；
		 *   · 认不出的取值 —— `path` 为 null ＋ `reason` 说明，**不猜**（猜错了会写坏画面）。
		 *
		 * @param text - `runtime/expression.md` 全文；文件不存在传 null/空串
		 * @returns {{source, path, value, inferred, unavailable, reason, parsed}}
		 */
		function expressionPlan(text) {
			if (typeof text !== "string" || text.trim() === "") {
				return {
					source: "absent", path: null, value: null, inferred: false, unavailable: false,
					reason: "教室还没有 runtime/expression.md（引擎本轮没写表情）→ 沿用旧的相位映射",
					parsed: null,
				};
			}
			const parsed = parseExpression(text);
			const available = {
				"named-expression": parsed.expression,
				"face-parameters": Object.keys(parsed.face).length > 0 ? parsed.face : null,
				motion: parsed.motion,
			};
			const unavailable = parsed.capability === "unavailable" || parsed.origin === "unavailable";
			const base = { source: "engine", inferred: false, unavailable: unavailable, parsed: parsed };

			if (parsed.path !== null && !EXPRESSION_PATH_ORDER.includes(parsed.path)) {
				return Object.assign(base, {
					path: null, value: null,
					reason: "expression_path 取值认不出：" + parsed.path + " → 不动立绘（不猜）",
				});
			}
			let path = parsed.path;
			let inferred = false;
			if (path === null && parsed.hasPathLine === false) {
				// 🔴 文件里**没有** `expression_path` 这一行（旧格式）→ 按引擎自己的优先级从字段推断，
				//    并在面板上**如实标注「推断」**——推断出来的路与引擎声明的路不是一回事。
				path = EXPRESSION_PATH_ORDER.find((name) => available[name] !== null && available[name] !== undefined) ?? null;
				inferred = true;
			}
			if (path === null) {
				return Object.assign(base, {
					path: null, value: null, inferred: inferred,
					reason: parsed.note === null
						? "三条手段都没有可用的取值（引擎没给命名表情、也没给参数/动作）→ 这个模型无法表达情绪"
						: "引擎说不可用：" + parsed.note,
				});
			}
			const value = available[path];
			if (value === null || value === undefined) {
				return Object.assign(base, {
					path: null, value: null, inferred: inferred,
					reason: "引擎声明走 " + path + "，但对应的那一行是空的 → 不动立绘（不猜）",
				});
			}
			return Object.assign(base, {
				path: path, value: value, inferred: inferred,
				reason: inferred ? "文件里没有 expression_path 行 → 按优先级推断为 " + path : null,
			});
		}

		/**
		 * 面板「表情」那一行与测试共用的**稳定键**：只有这些字段真的变了才重新应用。
		 * 少了它，250 ms 一次的轮询会把动作/idle 每帧重起一次（画面抖坏）。
		 * @param plan - `expressionPlan()` 的产物
		 * @returns 字符串；无路可走时也带 `reason`，好让「从有到无」也触发一次收尾
		 */
		function expressionKey(plan) {
			if (plan.path === null) return plan.source + "|none|" + String(plan.reason);
			return plan.source + "|" + plan.path + "|" + (plan.path === "face-parameters" ? JSON.stringify(plan.value) : String(plan.value));
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
				if (!result.ok) {
					// 🔴 把宿主的 error.code 带出来：下游要判「文件不存在」（正常态）还是「读坏了」（故障），
					//    靠**结构化字段**判，不靠对文案做正则（文案会随版本变，code 不会）。
					const failure = new Error(result.error.message);
					if (result.error.code !== undefined && result.error.code !== null) failure.code = String(result.error.code);
					throw failure;
				}
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
		 * 读齐五个文件并组装面板快照数据。
		 * 单个文件失败**不拖垮整块**：失败进 `sources`，对应字段为 null，面板逐项标出来源状态。
		 * @param ctx - 客户端根 Context（用其 `remote`）
		 * @param sessionId - 会话 id
		 * @param signal - 取消信号
		 * @returns {data, sources}
		 */
		async function loadClassroom(ctx, sessionId, signal) {
			// 🔴 EXPR-5：**先读部署声明**，再做一次"两侧同一目录 / 同一模型"的机核。
			//    放在最前面是有意的：它是"面板读的目录 == 引擎写的目录"这条硬约束的**唯一机核点**，
			//    必须在任何"读教室文件"的动作之前把结论拿到（否则读不到文件时说不清是配置错还是没写）。
			const declarationRead = await ensureDeclaration(ctx.remote, sessionId);
			const deployment = checkDeployment(declarationRead.declaration, classroomRoot(), modelName(), declarationRead.path);
			// 🔴 「不静默」的第二条出口：面板会显示，控制台也要留一条（取证脚本与排障都读它）。
			if (deployment.status !== "ok") {
				try {
					console.error("[classroom-ui] 部署一致性自检未通过（" + deployment.status + "）：\n" + deployment.lines.join("\n"));
				} catch {
					/* 控制台不可用不致命 */
				}
			}
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
			// 声明也进"数据来源（真读盘）"那一栏：它和五个教室文件一样是**真读盘**来的事实。
			sources.push({
				name: "deployment",
				path: declarationRead.path,
				ok: declarationRead.declaration.ok === true,
				error: declarationRead.declaration.ok === true ? null : declarationRead.declaration.reason,
			});

			const manifest = byName.manifest.ok ? parseManifest(byName.manifest.text) : null;
			const progress = byName.progress.ok ? parseProgress(byName.progress.text) : null;
			const lessons = byName.curriculum.ok ? parseCurriculum(byName.curriculum.text) : [];
			const teacher = byName.teacher.ok ? parseTeacher(byName.teacher.text) : null;
			/**
			 * 🔴 表情状态文件（EXPR-3）。**文件不存在是正常态**（教室第一次真跑之前没有它），
			 * 所以这里给的是 `expressionPlan()` 的产物而不是裸字段：
			 * `source: 'absent'` ＝ 还没有这个文件 → 面板沿用旧的相位映射并如实标注。
			 */
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
					/** 🔴 EXPR-5：部署一致性自检的结论（`ok` / `mismatch` / `unreadable`，含逐条修法）。 */
					deployment: deployment,
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
		// 6 · 皮肤（SKIN）—— 唯一的皮肤参数表 ＋ 由它派生的样式
		//
		// 🔴 **改皮肤只改 `SKIN_PRESETS` 这一张表**：渲染代码里不再出现任何颜色／字号／
		//    间距／圆角的字面量（只留 0/1 这类结构性数字与 flex 基准值）。
		//
		// 设计口径（项目硬规矩，2026-09-18 立）：
		//   层级只能靠 **字号 · 字距 · 字色阶梯 · 字面（sans/mono）**——**不许靠加粗**。
		//   故本表里没有 fontWeight，渲染代码里也不写 fontWeight（除宿主继承来的 400）。
		//
		// 参数来源逐条标：
		//   [借官方] 宿主 alias / 组件 token。基准＝安装版 `dsh-client-ui-theme/lib/client.js`
		//            （色板与字号分量 token 都在这里定义）；取不到时退回与官方同一套字面栈。
		//   [自己定] 官方没有这一项——官方的圆角／间距／字距都散落在各包 CSS Module 的字面量里
		//            （`dsh-client-ui-sidebar-right/lib/client.js:37,188,608` 实测：radius 6/12/24/28/999、
		//             gap 3/14、padding 6/14/20，零 letter-spacing），没有 token 通路。
		// ════════════════════════════════════════════════════════════════════

		/**
		 * 字面栈。[借官方] 与官方 `--dsw-font-family` / `--ds-font-family-code` 同一套
		 * （官方自己引用 `--dsw-font-mono` 时也带 fallback，见 `dsh-client-ui-tool/lib/client.js`）。
		 */
		const SANS = "var(--dsw-font-family, -apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", \"Helvetica Neue\", Helvetica, Arial, sans-serif)";
		const MONO = "var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";
		/**
		 * 第三套字面：**衬线**（[自己定]，宿主没有这一项）。
		 *
		 * 🔴 为什么可以自己定：`dsh-client-ui-theme` 里 **没有 serif token**（实测把该包所有
		 *    `--dsw-font-*font-family` 列出来，只有 sans 与 mono 两族）。而 STAGE-3 的 C 方向
		 *    （書庫）把**衬线**当作纸面材质的一部分（`archive/design-stage3/stage3.css` 的
		 *    `--font-serif:"Songti SC","Source Han Serif SC","Noto Serif CJK SC",Georgia,serif`），
		 *    这里是**同一份字面栈**逐字搬过来，不是新选的字体。
		 *    → 故本表里 sans/mono 一律引宿主 token，serif 是明写的自定栈（测试按这个口径守）。
		 */
		const SERIF = "\"Songti SC\", \"Source Han Serif SC\", \"Noto Serif CJK SC\", Georgia, serif";

		/**
		 * 官方字号阶梯 [借官方]：安装版 `dsh-client-ui-theme/lib/client.js` 里每个档位都有
		 * `--dsw-font-<档>-font-size` / `-line-height` / `-font-family` 三个**分量 token**
		 * （逐字：`--dsw-font-xxxs-11-font-size:11px`、`--dsw-font-xxs-12-line-height:18px` …）。
		 * 🔴 **只取 400 字重那一档**（不带 `-strong-` 后缀）——`-strong-` 档是 **500**，
		 *    本项目不许用加粗（含"半粗"）表达层级。
		 */
		const TYPE_STEPS = {
			"xxxs-11": ["11px", "14px"],
			"xxs-12": ["12px", "18px"],
			"xs-13": ["13px", "20px"],
			"s-14": ["14px", "22px"],
			"base-16": ["16px", "24px"],
		};

		/**
		 * 一个**排版角色** = 官方字号档 ＋ 字面 ＋ 字距（＋ 需要时覆写行高）。
		 * @param step - TYPE_STEPS 的键（[借官方] 尺寸与行高都从该档的分量 token 取）
		 * @param family - `"sans"` | `"mono"` | `"serif"`（前两族 [借官方] 引宿主 token；
		 *                 `serif` [自己定]——宿主没有 serif token，见 `SERIF` 的说明）
		 * @param tracking - 字距（[自己定]：官方 CSS 零 letter-spacing，这是我们加的层级手段）
		 * @param leading - 行高覆写（[自己定]：官方行高按**单行标签**设计，中文段落偏挤）
		 */
		function typeRole(step, family, tracking, leading) {
			const pair = TYPE_STEPS[step];
			return {
				fontSize: "var(--dsw-font-" + step + "-font-size, " + pair[0] + ")",
				lineHeight: leading === undefined ? "var(--dsw-font-" + step + "-line-height, " + pair[1] + ")" : leading,
				fontFamily: family === "mono" ? MONO : family === "serif" ? SERIF : SANS,
				letterSpacing: tracking,
			};
		}

		/**
		 * 皮肤参数表（**同一份代码，只差这张表**）。
		 *
		 * 🔴 **2026-09-25 收窄为唯一一个方向 `library`（書庫）**。改前的 `quiet` / `board` /
		 *    `syllabus` 三个方向是「让用户挑方向的预览」（README §4.7 自己写明"不是定稿"）；
		 *    用户拍板按 **STAGE-3 的「B 讲台骨架 ＋ C 書庫材质」** 重做面板 → 预览期结束，
		 *    未选中的两个方向**按当时的约定删掉**（留着会让"面板长什么样"有两个答案）。
		 *    `skin` 这个配置面保留（键名与语义不变），只是现在只有一个合法取值。
		 *
		 * 键的含义（渲染代码只认这些键）：
		 *   ink[1..4]   四级字色阶梯（1 最重 → 4 最轻）
		 *   fill.hover  交互态填充；fill.plate 区块/衬板底色；fill.code 代码底色；fill.canvas 图形画布底
		 *   line.hair   分节发丝线；line.box 盒/卡边界发丝线（都是 0.5px——[借官方] 官方右栏用 `.5px`）
		 *   line.gold   書庫的金褐发丝线（[自己定]：宿主没有这个色，走 `--cui-gold-rule`）
		 *   line.shelf  书脊底下那条"书架板"（同上）
		 *   radius      圆角阶梯；space 间距阶梯；type 排版角色
		 *   section     区块成形方式：`rule`（只用一条发丝线分节）｜`plate`（一块板面）｜`card`（一张卡片）
		 *   paper       書庫纸面（`light` / `dark` 两套，由 `data-ds-dark-theme` 选；见 §6.1）
		 *   portrait    立绘舞台（宽度上限／长宽比／底／边／圆角／内边距）
		 *   draw        板书图卡片（底／边／圆角／内边距）
		 */
		const SKIN_PRESETS = {
			library: {
				id: "library",
				name: "書庫",
				oneLiner: "B 讲台骨架 ＋ C 書庫材质：木框承着奶白纸面，讲台常驻在纸面上方，课程表是一排书脊加一份章节索引。",
				ink: {
					1: "var(--dsw-alias-label-primary, #1f1f1f)",
					2: "var(--dsw-alias-label-secondary, #5c5c5c)",
					3: "var(--dsw-alias-label-tertiary, #8a8a8a)",
					4: "var(--dsw-alias-label-caption, #adb2b8)",
				},
				fill: {
					hover: "var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06))",
					plate: "var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06))",
					code: "var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06))",
					canvas: "#ffffff",
				},
				line: {
					hair: "0.5px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04))",
					box: "0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.10))",
					gold: "0.5px solid var(--cui-gold-rule)",
					shelf: "1px solid var(--cui-gold-rule)",
				},
				radius: { card: "2px", block: "3px", inner: "2px", pill: "999px" },
				space: { xxs: "2px", xs: "4px", sm: "6px", md: "8px", lg: "12px", xl: "16px", xxl: "20px", xxxl: "26px" },
				type: {
					// 字面（sans/serif/mono）是层级手段之一：書庫的纸面上，**书名与章题走衬线**，
					// 标签走无衬线，数字与路径走等宽。三级字面 + 四级字色 + 三档字号 = 层级全在这里。
					title: typeRole("s-14", "serif", "0.05em"),
					head: typeRole("xs-13", "serif", "0.03em"),
					body: typeRole("xxs-12", "sans", "0.01em"),
					label: typeRole("xxxs-11", "sans", "0.18em"),
					meta: typeRole("xxxs-11", "mono", "0.04em"),
					prose: typeRole("xxs-12", "sans", "0.02em", "1.6"),
					code: typeRole("xxxs-11", "mono", "0", "1.6"),
				},
				section: "rule",
				/**
				 * 書庫纸面。取色逐条对 `archive/design-stage3/stage3.css` 的 C 方向：
				 *   · 纸面 `linear-gradient(180deg,#FBF7E4,#F1EAD4)`（同 `.v-c .paper`）
				 *   · 内发丝 `#F2E9A8`（同 `box-shadow:inset 0 0 0 1px #F2E9A8`）
				 *   · 木框 `linear-gradient(180deg,#7a4f28,#4a2c17 42%,#3a2210)`（同 `.v-c .frame`）
				 *   · 金褐 `#c9a86a`、既读橙 `#e0603a`（同 `--lib-gold` / `.spines i.cur::after`）
				 * 🔴 深色主题下**不能照抄奶白**（那会在深色右栏里炸出一块白）→ 另给一套深色纸，
				 *    木框/金褐/橙三色两套共用（它们本来就是深色系的）。
				 */
				paper: {
					light: {
						surface: "linear-gradient(180deg, #FBF7E4, #F1EAD4)",
						inner: "#F2E9A8",
						wood: "linear-gradient(180deg, #7a4f28, #4a2c17 42%, #3a2210)",
						gold: "#c9a86a",
						goldRule: "rgba(154, 120, 60, 0.55)",
						read: "#e0603a",
						boardFill: "rgba(154, 120, 60, 0.07)",
						alertFill: "rgba(224, 96, 58, 0.07)",
						spine: "linear-gradient(180deg, #8a6236, #4a2c17)",
						spineDone: "linear-gradient(180deg, #b08a52, #6b4423)",
						spineTodo: "linear-gradient(180deg, #6b4423, #3a2210)",
					},
					dark: {
						surface: "linear-gradient(180deg, #241d16, #1b1510)",
						inner: "rgba(201, 168, 106, 0.30)",
						wood: "linear-gradient(180deg, #5c3a1e, #33200f 42%, #241608)",
						gold: "#c9a86a",
						goldRule: "rgba(201, 168, 106, 0.32)",
						read: "#e0603a",
						boardFill: "rgba(201, 168, 106, 0.08)",
						alertFill: "rgba(224, 96, 58, 0.12)",
						/**
						 * 🔴 深色下书脊要**比纸面亮**，不能照抄浅色那三档。
						 *    实测（`shots/extra/dark-panel.png` 第一版）：照抄浅色的 `#4a2c17→#241608`
						 *    叠在 `#241d16` 的深纸上，**未上的书脊几乎看不见**——那一排索引等于没了。
						 *    这里整族提亮一档（未上那根再叠 0.62 透明度后仍明显亮于纸面）。
						 */
						spine: "linear-gradient(180deg, #7a4f28, #4a2c17)",
						spineDone: "linear-gradient(180deg, #b08a52, #6b4423)",
						spineTodo: "linear-gradient(180deg, #8a6236, #4a2c17)",
					},
				},
				portrait: { maxWidth: "100%", maxHeight: "340px", background: PORTRAIT_PAPER, border: "none", radius: "2px", pad: "0", floor: false },
				draw: { background: "transparent", border: "none", radius: "6px", pad: "0" },
			},
		};

		/**
		 * 默认方向（＝唯一方向）。用户拍板后方向已定稿，这里不再是"预览的默认值"。
		 * 认不出的 `skin` 值仍然退回它（不抛错、不白屏）。
		 */
		const DEFAULT_SKIN = "library";

		/** @returns 当前皮肤 id（`globalThis.__DSH_CLASSROOM_UI_CONFIG__.skin`，认不出就用默认） */
		function skinId() {
			const configured = uiConfig().skin;
			return typeof configured === "string" && Object.prototype.hasOwnProperty.call(SKIN_PRESETS, configured) ? configured : DEFAULT_SKIN;
		}

		/**
		 * 当前主题档（書庫纸面用哪一套）。
		 *
		 * 判据**只有一条**：宿主切主题时给 `document.body` 打的 `data-ds-dark-theme` 属性
		 * （`DARK_ATTRIBUTE`）——与消息流里那张图用的是同一个判据、同一个观察器（`watchDarkTheme`）。
		 * 没有 `document`（node 侧测试替身）时返回 `"light"`，不抛错。
		 * @returns `"light"` | `"dark"`
		 */
		function themeMode() {
			return isDarkTheme() ? "dark" : "light";
		}

		/**
		 * 皮肤里**只有 CSS 能表达**的那几条（`:hover` / `:focus-visible` / `summary::marker`）。
		 * 内联 style 表达不了伪类，故照官方自己的做法注入一个 `<style>`：
		 * 官方逐字（安装版 `dsh-client-ui-sidebar-right/lib/client.js:39-46`）——
		 * `document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]")` 去重后
		 * 建 `tag`、`tag.dataset.plugin = <包名>`、`tag.textContent = css`、`document.head.appendChild(tag)`。
		 * 🔴 规则里**只引 `--cui-*` 变量**（由当前方向的参数表写到面板/板书图的根元素上），
		 *    所以换方向不用改这段 CSS，也不会与宿主的选择器打架（全部带本插件自己的属性前缀）。
		 */
		const SKIN_CSS_TAG = "classroom-ui/skin.css";
		const SKIN_CSS = [
			"[data-classroom-ui] .cui-act:hover, [data-classroom-ui-draw] .cui-act:hover { background: var(--cui-hover-fill); }",
			"[data-classroom-ui] .cui-act:focus-visible, [data-classroom-ui-draw] .cui-act:focus-visible { outline: 1.5px solid var(--cui-ring); outline-offset: 2px; }",
			"[data-classroom-ui] .cui-index-row:hover { color: var(--cui-ink-1); }",
			"summary.cui-sum::marker { color: var(--cui-ink-4); }",
			"summary.cui-sum:hover { color: var(--cui-ink-2); }",
		].join("\n");

		/** 注入皮肤里那几条伪类规则（幂等：同 id 的 `<style>` 已存在就不重复插）。 */
		function installSkinCss() {
			if (typeof document === "undefined") return;
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(SKIN_CSS_TAG) + "]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "classroom-ui";
			tag.dataset.pluginCss = SKIN_CSS_TAG;
			tag.textContent = SKIN_CSS;
			document.head.appendChild(tag);
		}

		/**
		 * 把一张方向表**展开成样式表**。所有取值都从 `skin` 里取，这里不写任何字面色值/字号。
		 * @param skin - `SKIN_PRESETS` 的某一项
		 * @returns 样式对象 ＋ `ink` / `vars` / `varsFor(mode)` / `sectionFor(framed)`
		 */
		function buildStyles(skin) {
			const ink = skin.ink;
			const fill = skin.fill;
			const line = skin.line;
			const radius = skin.radius;
			const space = skin.space;
			const t = skin.type;
			const paper = skin.paper;

			/**
			 * 書庫材质的 CSS 变量。**分深浅两套**：`paper.light` / `paper.dark`。
			 * 为什么走变量而不是把纸面写进每个样式对象：同一批样式对象要能在**两套主题**下复用
			 * （换主题只换根元素上这十来个变量，不用重建样式表、也不用重挂组件）。
			 * @param mode - `"light"` | `"dark"`（认不出的一律当浅色，不抛错）
			 */
			function paperVars(mode) {
				const p = mode === "dark" ? paper.dark : paper.light;
				return {
					"--cui-paper": p.surface,
					"--cui-paper-inner": p.inner,
					"--cui-wood": p.wood,
					"--cui-gold": p.gold,
					"--cui-gold-rule": p.goldRule,
					"--cui-read": p.read,
					"--cui-board-fill": p.boardFill,
					"--cui-alert-fill": p.alertFill,
					"--cui-spine": p.spine,
					"--cui-spine-done": p.spineDone,
					"--cui-spine-current": p.spineDone,
					"--cui-spine-todo": p.spineTodo,
				};
			}

			const styles = {
				ink: ink,
				// 皮肤里那几条只有 CSS 能表达的规则要用到的变量（写在面板/板书图的根元素上）
				vars: {
					"--cui-hover-fill": fill.hover,
					"--cui-ring": ink[3],
					"--cui-ink-1": ink[1],
					"--cui-ink-2": ink[2],
					"--cui-ink-4": ink[4],
				},
				varsFor: paperVars,
				/**
				 * 面板根：**C 書庫的木框 ＋ 纸面**（`archive/design-stage3/stage3.css` 的 `.v-c .frame`
				 * ＋ `.v-c .paper` 搬进右栏）。
				 *   · 木框＝`border` 透明 ＋ `border-image` 木色渐变（与 STAGE-3 同一手法：
				 *     `border-image:linear-gradient(...) 1`，1px 切片被拉伸铺满整条边框）；
				 *   · 纸面＝`--cui-paper` 渐变；`backgroundClip:"padding-box"` 让纸**只画在框内**，
				 *     不会从边框底下漏出来；
				 *   · 内发丝＝`--cui-paper-inner`（STAGE-3 的 `inset 0 0 0 1px #F2E9A8`）。
				 * 🔴 `boxSizing:"border-box"` 是必须的：面板是 `width:100%`，默认 content-box 会让
				 *    「100% ＋ 左右边框」横向溢出（窄屏溢出的经典成因）。
				 */
				root: {
					boxSizing: "border-box",
					display: "flex",
					flexDirection: "column",
					gap: space.xxl,
					padding: space.xl + " " + space.xl + " " + space.xxxl,
					color: ink[1],
					border: PANEL_FRAME + " solid transparent",
					borderImageSource: "var(--cui-wood)",
					borderImageSlice: 1,
					background: "var(--cui-paper)",
					backgroundClip: "padding-box",
					boxShadow: "inset 0 0 0 1px var(--cui-paper-inner)",
					...t.body,
				},
				// 兼容别名：`body` 与 `root` 同一份（老代码/老测试按 `S.body` 取面板根样式）
				headTitle: Object.assign({ color: ink[1] }, t.title),
				headMeta: Object.assign({ color: ink[4], overflowWrap: "anywhere" }, t.meta),
				/** 头部下面那条金褐发丝线（書庫的"书名页"分节）。 */
				headRule: { borderTop: line.gold, marginTop: space.sm },
				section: { display: "flex", flexDirection: "column", gap: space.sm },
				// 三种区块成形方式（见 SKIN_PRESETS 的 `section` 说明）
				sectionRule: { borderTop: line.gold, paddingTop: space.xl },
				sectionPlate: { background: fill.plate, border: line.box, borderRadius: radius.block, padding: space.lg },
				sectionCard: { border: line.box, borderRadius: radius.card, padding: space.lg },
				sectionLabel: Object.assign({ color: ink[3] }, t.label),
				mono: { fontFamily: MONO },

				// ── 当前：讲次／老师／进度 ────────────────────────────────────────────
				//    「当前」这块是面板的**正文列**（B 骨架把正文列收窄、信息靠字号与字面分级）。
				//    `flex` ＋ `gap`：讲次号与讲题之间留一个明确的空档（改前是一格普通空格，
				//    「14 一个程序怎么跑起来」挤在一起读不出分界）。
				lessonLine: Object.assign({ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: space.md, color: ink[1], overflowWrap: "anywhere" }, t.title),
				lessonNo: Object.assign({ color: ink[3] }, t.meta),
				fieldRow: { display: "flex", gap: space.md, alignItems: "baseline", padding: space.xs + " 0", borderBottom: line.hair },
				fieldLabel: Object.assign({ color: ink[4], flex: "0 0 42px" }, t.label),
				fieldValue: Object.assign({ color: ink[2], flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere" }, t.body),
				fieldValueStrong: { color: ink[1] },

				// ── 课程表 · 书脊索引（C 書庫的 `.v-c .spines` ＋ 章节索引）────────────
				spineStrip: { display: "flex", alignItems: "flex-end", gap: "4px", height: "30px", borderBottom: line.shelf },
				/**
				 * 一根**窄书脊**：定宽 14px（不是 `flex:1`）。
				 *
				 * 🔴 为什么定宽：`flex:1` 在 ~700px 的右栏里会把每根撑到 ~48px 宽 × 26px 高——
				 *    那个长宽比目视就是**柱状图**，不是书脊（本机实测：截图
				 *    `shots/after/03-panel-zoom-2x.png` 的第一版）。改成 14px 定宽后
				 *    14 根总宽 ≈ 248px，**一列窄书脊立在一整条书架板上**，左侧对齐
				 *    （书架上的书本来就是靠左立的）。
				 */
				spine: { flex: "0 0 auto", width: "14px", display: "block", borderRadius: "2px 2px 0 0", background: "var(--cui-spine)", boxShadow: "inset -1px 0 0 rgba(0, 0, 0, 0.35)" },
				spineDone: { height: "80%", background: "var(--cui-spine-done)" },
				spineCurrent: { height: "100%", background: "var(--cui-spine-current)", boxShadow: "inset -1px 0 0 rgba(0, 0, 0, 0.35), 0 0 0 1px var(--cui-gold)" },
				spineTodo: { height: "46%", background: "var(--cui-spine-todo)", opacity: 0.62 },
				index: { display: "flex", flexDirection: "column", marginTop: space.md },
				indexRow: { display: "flex", alignItems: "baseline", gap: space.md, padding: space.sm + " 0 " + space.sm + " " + space.md, borderBottom: line.hair, position: "relative" },
				indexRowCurrent: { borderBottom: line.gold },
				/** 当前讲的那枚既读橙标（STAGE-3 `.v-c .spines i.cur::after` 的那颗圆点）。 */
				indexMark: { position: "absolute", left: 0, top: "50%", width: "3px", height: "3px", marginTop: "-1.5px", borderRadius: "999px", background: "var(--cui-read)" },
				indexNo: Object.assign({ color: ink[4], flex: "0 0 26px" }, t.meta),
				indexTitle: Object.assign({ flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere" }, t.head),
				indexTitleCurrent: { color: ink[1] },
				indexTitleRest: { color: ink[2] },
				indexCore: Object.assign({ color: ink[4], padding: "0 0 " + space.sm + " " + space.xxxl }, t.prose),

				// ── 讲台（B 骨架的「常驻黑板位」）─────────────────────────────────────
				//    板面底走 `--cui-board-fill`（纸面上的一层暖色，**不是**宿主那层偏冷的交互填充：
				//    冷灰压在奶白纸上像一块贴上去的管理后台卡片——本机截图实测过）。
				board: { position: "relative", display: "flex", flexDirection: "column", gap: space.sm, border: line.gold, borderRadius: radius.block, padding: space.lg, background: "var(--cui-board-fill)" },
				/** 板面顶端那条金褐渐隐轨（STAGE-3 `.v-b .podium::before` 的同一手法）。 */
				boardRail: { position: "absolute", left: 0, right: 0, top: 0, height: "2px", background: "linear-gradient(90deg, transparent, var(--cui-gold), transparent)" },
				/** 立绘未就位时的那一条紧凑说明（**显式但不抢主视觉**：占一行，不是一整块板）。 */
				boardNotice: Object.assign({ display: "flex", gap: space.sm, alignItems: "baseline", color: ink[3], borderLeft: "2px solid var(--cui-gold)", padding: space.xxs + " 0 " + space.xxs + " " + space.md, overflowWrap: "anywhere" }, t.meta),
				/** 讲台诊断：默认折起的那一块（summary 走标签字，展开后是一列小字）。 */
				boardSummary: Object.assign({ color: ink[4], cursor: "pointer" }, t.label),
				boardDiag: { display: "flex", flexDirection: "column", gap: space.xs, paddingTop: space.sm },

				// ── 资源状态（真读盘）────────────────────────────────────────────────
				source: Object.assign({ display: "flex", gap: space.sm, color: ink[4] }, t.meta),
				sourcePath: { fontFamily: MONO, minWidth: 0, overflowWrap: "anywhere" },
				button: Object.assign({ alignSelf: "flex-start", marginTop: space.md, background: "transparent", border: line.gold, borderRadius: radius.pill, color: ink[2], cursor: "pointer", padding: space.xs + " " + space.lg }, t.label),

				// ── 通用（错误/提示）─────────────────────────────────────────────────
				note: Object.assign({ color: ink[4] }, t.prose),
				// 错误/未通过那一条：**暖色告示**（纸面上的一层橙调 ＋ 一条既读橙竖线），
				// 不是宿主那层偏冷的灰底卡——冷灰压在奶白纸上正是"管理后台卡片"的味道。
				error: Object.assign({ color: ink[1], background: "var(--cui-alert-fill)", borderLeft: "2px solid var(--cui-read)", borderRadius: radius.block, padding: space.md + " " + space.lg, overflowWrap: "anywhere" }, t.prose),

				// ── 立绘（§6.5 / §7 PortraitStage）：舞台尺寸与衬板也归皮肤表管 ──
				//    `boxSizing:border-box` 是必须的：舞台是 `width:100%` ＋ 可能有内边距/边界，
				//    默认的 content-box 会让「100% ＋ padding ＋ border」横向撑出容器（窄屏溢出的经典成因）。
				portraitBox: {
					boxSizing: "border-box",
					alignSelf: "center",
					width: "100%",
					maxWidth: skin.portrait.maxWidth,
					aspectRatio: PORTRAIT_ASPECT,
					maxHeight: skin.portrait.maxHeight,
					background: skin.portrait.background,
					border: skin.portrait.border,
					borderBottom: skin.portrait.floor === true ? line.hair : undefined,
					borderRadius: skin.portrait.radius,
					padding: skin.portrait.pad,
					overflow: "hidden",
				},
				/**
				 * 立绘**未就位**时的舞台尺寸：折成 0 高。
				 *
				 * 🔴 为什么要折：未部署 Live2D 时那块方形舞台是一片**空白纸**，实测在右栏里占掉
				 *    约 330px（截图 `shots/before/02-panel-crop.png`）——真正的信息被挤到折叠线以下，
				 *    而"未部署"这件事只需要一行字。折成 0 高后，画布**仍在文档里**
				 *    （React 照常挂载 → 装载效果照常跑 → 失败照常被看见），只是不再占地。
				 *    实测依据：渲染宿主只认 `canvas.width/height`（画布缓冲），不看 CSS 盒
				 *    （`live2d-host/src/host.js` 逐字只用 `this.canvas.width`）→ 折起来不影响装载。
				 */
				portraitBoxCollapsed: { boxSizing: "border-box", width: "100%", height: 0, overflow: "hidden" },
				// 🔴 渲染宿主只认 `canvas.width/height`（画布缓冲），不看 CSS 盒
				//    （`live2d-host/src/host.js:220,440` 逐字只用 `this.canvas.width`）→
				//    这里只改**呈现尺寸**：`object-fit:contain` 把 640×640 的画布缩进舞台，不裁不拉伸。
				canvas: { display: "block", width: "100%", height: "100%", objectFit: "contain" },
				/**
				 * 🔴 D3 的静态立绘图：**同一块舞台框里的一张画**（`object-fit:contain`，不裁不拉伸）。
				 * 它与画布叠在同一个框里——Live2D 起来时这张图根本不渲染（`showStatic` 为假）。
				 */
				staticPortrait: { display: "block", width: "100%", height: "100%", objectFit: "contain" },
				chipRow: { display: "flex", flexWrap: "wrap", gap: space.xs, marginBottom: space.xs },
				chip: Object.assign({ background: "transparent", border: line.hair, borderRadius: radius.pill, color: ink[2], cursor: "pointer", padding: space.xxs + " " + space.md }, t.meta),
				chipActive: { background: fill.plate, color: ink[1] },
				debugBox: { display: "flex", flexDirection: "column", gap: space.xs, border: line.box, borderRadius: radius.block, padding: space.md + " " + space.lg },
				readout: Object.assign({ color: ink[2], overflowWrap: "anywhere" }, t.meta),
				// ── 板书图（§6.7 / ClassroomDrawView）：消息流里那张图与它的降级态 ──
				drawCard: { display: "flex", flexDirection: "column", gap: space.sm, maxWidth: "min(100%, 748px)", background: skin.draw.background, border: skin.draw.border, borderRadius: skin.draw.radius, padding: skin.draw.pad },
				drawTitle: Object.assign({ color: ink[1] }, t.head),
				drawMeta: Object.assign({ color: ink[4], overflowWrap: "anywhere" }, t.meta),
				// 🔴 `inline-block` 而不是 `block`：mermaid 产出的 `<svg>` 带 `width="100%"` ＋ 一个按
				//    图形内容算出来的 `max-width`（小图只有一两百 px）。若外层是块级元素，白底框会被拉到
				//    整列宽、图缩在左上角（实测：748 px 的列里一张 119 px 的图）。`inline-block` 让框
				//    **贴着图**，图多大框多大；大图仍由 `maxWidth:100%` 兜住不溢出。
				//    （卡片是 flex 列、默认 `align-items:stretch`，所以还要 `alignSelf:flex-start`，
				//      否则 inline-block 作为 flex item 会被横向拉满，等于白改。）
				drawCanvas: { alignSelf: "flex-start", display: "inline-block", maxWidth: "100%", border: line.box, borderRadius: radius.inner, background: fill.canvas, padding: space.lg, overflowX: "auto", lineHeight: 0 },
				drawCaption: Object.assign({ color: ink[2] }, t.prose),
				drawFallback: { display: "flex", flexDirection: "column", gap: space.sm, border: line.box, borderRadius: radius.inner, padding: space.md + " " + space.lg },
				drawFallbackWhy: Object.assign({ color: ink[1], overflowWrap: "anywhere" }, t.prose),
				drawSource: Object.assign({ color: ink[2], background: fill.code, borderRadius: radius.inner, margin: 0, padding: space.md + " " + space.lg, overflowX: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }, t.code),
				drawDetails: Object.assign({ color: ink[4] }, t.label),
				drawSummary: Object.assign({ color: ink[4], cursor: "pointer" }, t.label),

				// ── 面板内 tab 栏（W-p：「教室」／「板书」）────────────────────────────
				//    层级只用**字色 ＋ 金褐下划线**表达（项目硬规矩：不许用加粗做层级）。
				//    tab 栏本身走一条宿主发丝线收口，与「书名页」的分节线同一材质。
				tabBar: { display: "flex", alignItems: "baseline", gap: space.xl, borderBottom: line.hair },
				tab: Object.assign({
					appearance: "none",
					background: "transparent",
					border: 0,
					borderBottom: "2px solid transparent",
					padding: space.xs + " 0 " + space.sm,
					margin: 0,
					cursor: "pointer",
					color: ink[4],
				}, t.label),
				tabActive: { color: ink[1], borderBottom: "2px solid var(--cui-gold)" },

				// ── 板书历史（W-p）：只读列表 ＋ 点开后的那一块 ────────────────────────
				//    列表是**一行一条**（标题占满、元信息靠右），当前讲那一行底下走金褐发丝线。
				//    🔴 行是 button 元素：浏览器默认的边框/底色/字体必须显式清掉，否则会跳出一套
				//       "系统按钮"的样子（与本面板的纸面材质完全不是一回事）。
				boardList: { display: "flex", flexDirection: "column" },
				boardRow: Object.assign({
					appearance: "none",
					display: "flex",
					flexWrap: "wrap",
					alignItems: "baseline",
					justifyContent: "space-between",
					gap: space.md,
					width: "100%",
					textAlign: "left",
					background: "transparent",
					border: 0,
					borderBottom: line.hair,
					padding: space.sm + " 0 " + space.sm + " " + space.md,
					cursor: "pointer",
					color: ink[2],
				}, t.body),
				boardRowCurrent: { borderBottom: line.gold },
				boardRowTitle: Object.assign({ flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere", color: ink[2] }, t.head),
				boardRowMeta: Object.assign({ flex: "0 0 auto", color: ink[4] }, t.meta),
				/** 点开后的那一块：像一张"翻开的书页"（内页边界 ＋ 画布底），与消息流里那张图同一材质。 */
				boardViewer: { display: "flex", flexDirection: "column", gap: space.sm, border: line.box, borderRadius: radius.block, padding: space.lg, background: fill.plate },

				// ── 「日记」tab（P2 / N2.5）────────────────────────────────────────────
				//    一条日记＝「日期 · 第 N 讲」（等宽＋标签字）＋正文（散文体）。
				//    左侧一条金褐发丝当书签边，与「数据来源」的既读橙竖线同一语汇（不新增色）。
				diaryList: { display: "flex", flexDirection: "column" },
				diaryItem: { display: "flex", flexDirection: "column", gap: space.xs, padding: space.md + " 0 " + space.md + " " + space.md, borderBottom: line.hair, borderLeft: "2px solid var(--cui-gold-rule)" },
				diaryHead: Object.assign({ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: space.md, color: ink[3] }, t.meta),
				diaryDate: { fontFamily: MONO, color: ink[3] },
				diaryLesson: { color: ink[4] },
				diaryText: Object.assign({ color: ink[2], whiteSpace: "pre-wrap", overflowWrap: "anywhere" }, t.prose),

			};
			/** `body` 是 `root` 的别名（两处都指面板根；保留旧键名以免渲染代码与测试两处各改各的）。 */
			styles.body = styles.root;
			/**
			 * 区块样式：按当前方向的 `section` 成形方式取。
			 * @param framed - 是否不是本面板的第一个区块（`rule` 方式下只有非首块才画分节线）
			 */
			styles.sectionFor = (framed) => {
				if (skin.section === "plate") return Object.assign({}, styles.section, styles.sectionPlate);
				if (skin.section === "card") return Object.assign({}, styles.section, styles.sectionCard);
				return framed === true ? Object.assign({}, styles.section, styles.sectionRule) : styles.section;
			};
			return styles;
		}

		/** 样式缓存（按皮肤 id 记忆：同一方向下每次渲染拿到的是同一批对象）。 */
		let stylesCache = null;

		/** @returns 当前方向的样式表（组件里 `const S = styles();` 后用 `S.xxx`）。 */
		function styles() {
			const id = skinId();
			if (stylesCache === null || stylesCache.id !== id) stylesCache = { id: id, value: buildStyles(SKIN_PRESETS[id]) };
			return stylesCache.value;
		}


		// ════════════════════════════════════════════════════════════════════
		// 6.5 · 立绘（Live2D）：资源通道 + 相位接线
		//
		// 渲染宿主 `live2d-host/out/live2d-host.bundle.mjs` 是**只读复用**的独立模块
		// （它的构建与验证见 `实现报告_L2D_M1_渲染宿主_2026-09-24.md`）。它只认 URL：
		//   `fetch(model3Url)` / `fetch(modelHomeDir + <资源名>)` / `new Image().src = <贴图 URL>`
		// 而本插件手上只有「工作区文件」。中间这层就是本节的全部内容：
		//   ① 读盘：文本走 `workspaceFiles.read`（分页）；二进制走 `workspaceFiles.readAll`
		//      （宿主把字节以 **base64** 发过来 —— 官方右栏的文档预览就是这么解的，见 README §资源通道）；
		//   ② 落成 `Blob` → `URL.createObjectURL`，得到**浏览器真正能加载的 URL**；
		//   ③ 一个私有 scheme 的解析器，把宿主发出的 URL 映射到上面的 objectURL。
		//      解析器只在**装载窗口内**安装（覆盖 `fetch` 与 `Image` 两个取资源的口），装载完立即还原。
		// ════════════════════════════════════════════════════════════════════

		/** 面板配置：与教室根同一处（`globalThis.__DSH_CLASSROOM_UI_CONFIG__`）。 */
		function uiConfig() {
			const config = globalThis.__DSH_CLASSROOM_UI_CONFIG__;
			return config !== null && config !== undefined && typeof config === "object" ? config : {};
		}

		/** @returns 立绘资源根（工作区相对路径，去尾斜杠） */
		function live2dRoot() {
			const configured = uiConfig().live2dRoot;
			const value = typeof configured === "string" && configured.length > 0 ? configured : DEFAULT_LIVE2D_ROOT;
			return value.endsWith("/") ? value.slice(0, -1) : value;
		}

		/**
		 * @returns 模型名（`out/models/<名>/<名>.model3.json`）
		 *
		 * 🔴 EXPR-5：**优先级是"页面注入 > 部署声明 > 代码默认"**，理由逐条：
		 *   · 页面注入（`__DSH_CLASSROOM_UI_CONFIG__.model`）保持最高：它是**显式的、单页的**覆盖，
		 *     取证脚本与 `test/panel.test.mjs` 都用它切模型（`modelName()` 要立刻返回注入值）；
		 *   · 其次读**部署声明**（`portraitModel`）——这一档才是"生产里改模型名只改一处"：
		 *     引擎也读同一份声明（`plugins/socratic-engine/lib/declaration.mjs`），
		 *     于是"引擎挑清单用的模型"与"脸上装载的模型"**不可能各改各的**；
		 *   · 最后才是代码里的 `DEFAULT_MODEL`（声明读不到时的兜底）。
		 * 注入值若与声明不一致，面板会**出声**（见 `checkDeployment` 的 `modelOk`）——
		 * 那种错位是静默的（引擎报的表情与脸上的模型不是同一张），不许不响。
		 */
		function modelName() {
			const configured = uiConfig().model;
			if (typeof configured === "string" && configured.length > 0) return configured;
			const declared = declarationSync();
			if (declared !== null && declared.ok === true && typeof declared.portraitModel === "string") return declared.portraitModel;
			return DEFAULT_MODEL;
		}

		/** @returns vendored mermaid 产物的工作区相对路径（换版本只改配置，不改代码） */
		function mermaidPath() {
			const configured = uiConfig().mermaidPath;
			return typeof configured === "string" && configured.length > 0 ? configured : DEFAULT_MERMAID_PATH;
		}

		/**
		 * 调试开关：**默认关**。只有显式写 `globalThis.__DSH_CLASSROOM_UI_CONFIG__.debug = true`
		 * 时才渲染调试控件（相位/通道切换 + 喂文字）。验收脚本用 `page.addInitScript` 注入它，
		 * 生产路径不受影响 —— 见 README §调试开关。
		 */
		function debugEnabled() {
			return uiConfig().debug === true;
		}

		/** 扩展名 → MIME（贴图必须是 `image/png` 才能被 `Image` 解出来）。 */
		const MIME_BY_EXT = {
			png: "image/png",
			json: "application/json",
			moc3: "application/octet-stream",
			js: "text/javascript",
			mjs: "text/javascript",
			vert: "text/plain",
			frag: "text/plain",
		};

		/** @returns 按扩展名猜的 MIME；未知一律 octet-stream */
		function mimeOf(path) {
			const name = path.slice(path.lastIndexOf("/") + 1);
			const dot = name.lastIndexOf(".");
			const ext = dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
			return MIME_BY_EXT[ext] === undefined ? "application/octet-stream" : MIME_BY_EXT[ext];
		}

		/**
		 * base64 → 字节。
		 * 官方右栏文档预览解同一件事用的是同一个写法（逐字）：
		 * `dsh-client-ui-sidebar-documentpreview/lib/client.js:1157`
		 *   `data: Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0))`
		 * @param text - base64 字符串
		 * @returns {Uint8Array}
		 */
		function base64ToBytes(text) {
			const binary = atob(text);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
			return bytes;
		}

		/**
		 * 把宿主「读字节」Remote 的返回值解成 `Uint8Array`（**形状不对就响，不猜**）。
		 *
		 * 🔴 这是 0.2.1 迁移踩到的一处**真断裂**（两次实测，不是推的）：
		 *    · 0.1.5 的客户端调的是 `workspaceFiles.readAll(...)`，返回值里字节是 **base64 文本**
		 *      （`data: Buffer.from(data).toString("base64")`，见 README §4.5.1 的取证）；
		 *    · **0.2.1 里根本没有 `readAll` 这个方法**（`workspaceFiles` 只注册
		 *      `read` / `readBytes` / `list` / `stat` / `changes`），调用它当场
		 *      `TypeError: remote.workspaceFiles.readAll is not a function` → 面板直接进 failed 态，
		 *      连"读文件"那一步都没走到。这就是「立绘装载失败」的**第一因**（不是缺资产）。
		 *    · 改调 `readBytes` 之后**还有第二个坑**（2026-10-20 在真浏览器里抓到）：
		 *      `WorkspaceFileBytes` 的 `bytes` 字段装的是**字节数（number）**，真正的负载在 `data` 里。
		 *      只按 `bytes` 取 → 读出来是个数字 → 整条立绘链在这里断掉。
		 *      **所以两个字段都要看，谁装着字节就用谁**（不是"哪个名字更像"）。
		 * 支持的负载形状（都是真实可能出现的）：
		 *   ① `Uint8Array`（二进制通道直接给字节）；
		 *   ② `ArrayBuffer` / 任意 `ArrayBufferView`（Buffer 也是这一族）；
		 *   ③ 数字数组（JSON 传输退化的形状）；
		 *   ④ base64 字符串（0.1.5 的形状；同一个面板要能跑在两代宿主上）。
		 * 两个字段都不是这四种之一 → **抛**，并在文案里把 `bytes` / `data` 各自的类型列出来。
		 * @param value - `readBytes` 的 `value`
		 * @param path - 出错文案里点名用
		 * @returns {Uint8Array}
		 */
		function bytesOfWorkspaceFile(value, path) {
			const kindOf = (candidate) => {
				if (candidate === null) return "null";
				if (candidate === undefined) return "undefined";
				if (Array.isArray(candidate)) return "array";
				if (typeof ArrayBuffer !== "undefined" && candidate instanceof ArrayBuffer) return "arraybuffer";
				if (ArrayBuffer.isView(candidate)) return "view";
				return typeof candidate;
			};
			const asBytes = (candidate) => {
				if (candidate === null || candidate === undefined) return null;
				if (candidate instanceof Uint8Array) return candidate;
				if (typeof ArrayBuffer !== "undefined" && candidate instanceof ArrayBuffer) return new Uint8Array(candidate);
				if (ArrayBuffer.isView(candidate)) return new Uint8Array(candidate.buffer, candidate.byteOffset, candidate.byteLength);
				if (Array.isArray(candidate)) return Uint8Array.from(candidate);
				if (typeof candidate === "object" && Array.isArray(candidate.data)) return Uint8Array.from(candidate.data);
				if (typeof candidate === "string") return base64ToBytes(candidate);
				return null;
			};
			if (value === null || value === undefined) throw new Error("读字节的返回形状认不出（value 为空）：" + path);
			// 🔴 `bytes` 与 `data` 都试：0.2.1 里 `bytes` 是**字节数**，负载在 `data` 上。
			for (const candidate of [value.bytes, value.data]) {
				const bytes = asBytes(candidate);
				if (bytes !== null) return bytes;
			}
			throw new Error("读字节的返回形状认不出（bytes=" + kindOf(value.bytes) + "，data=" + kindOf(value.data) + "）：" + path);
		}

		/**
		 * 读一个文件的原生字节（**不经文本解码、不做二进制拒绝**）。
		 * `readBytes` 是宿主的「整流读字节」Remote，上限 `maxFileBytes`（安装版默认 32 MiB）；
		 * 本批最大的资源是 3.1 MB 的贴图，够用。
		 *
		 * 🔴 **立绘资源一律走这条路，不走分页 `read`** —— 这是一个实测踩到的坑：
		 *    `read` 是**按行**读的，它返回的 `text` **不含末行终止符**
		 *    （`dsh-api-workspace-files/lib/types/types.ts:41-62` 的 `WorkspaceFileText.text` 契约），
		 *    分页拼接时用 `"\n"` 接回去 → **文件末尾那个换行会被丢掉**。
		 *    对散文无所谓；但官方框架把多份着色器源码**直接字符串拼接**成一份 GLSL
		 *    （`vendor/CubismWebFramework/src/rendering/cubismshader_webgl.ts:1639-1664`），
		 *    少一个换行就让下一段的 `#version`／`#define` 落到同一行 → 编译报
		 *    `ERROR: 0:354: '#' : unexpected token after conditional expression`。
		 *    → **凡是要「逐字节忠实」的资源，必须走字节通道。**
		 * @returns {Uint8Array}
		 */
		async function readBinary(remote, sessionId, path, signal) {
			const result = await remote.workspaceFiles.readBytes(sessionId, path, signal);
			if (!result.ok) throw new Error(result.error.message);
			return bytesOfWorkspaceFile(result.value, path);
		}

		/**
		 * 字节 → 文本（UTF-8）。**只在确实要当文本用时调用**（model3.json / cdi3.json）；
		 * 贴图、moc3、着色器源码都保持字节。
		 * @returns {string}
		 */
		function decodeText(bytes) {
			return new TextDecoder("utf-8").decode(bytes);
		}

		/**
		 * 列出 model3.json 引用的全部文件（相对模型目录），并标出哪些是二进制。
		 * 覆盖官方 setting 会去取的每一处：Moc / Textures / Physics / Pose / UserData /
		 * DisplayInfo / Expressions[].File / Motions[组][].File。
		 * @param model3 - 已解析的 model3.json
		 * @returns [{rel, binary}]
		 */
		function modelReferences(model3) {
			const fr = model3 !== null && typeof model3 === "object" && model3.FileReferences !== undefined ? model3.FileReferences : {};
			const refs = [];
			const push = (rel, binary) => {
				if (typeof rel === "string" && rel.length > 0) refs.push({ rel: rel, binary: binary });
			};
			push(fr.Moc, true);
			for (const texture of fr.Textures === undefined ? [] : fr.Textures) push(texture, true);
			push(fr.Physics, false);
			push(fr.Pose, false);
			push(fr.UserData, false);
			push(fr.DisplayInfo, false);
			for (const expression of fr.Expressions === undefined ? [] : fr.Expressions) push(expression.File, false);
			const motions = fr.Motions === undefined ? {} : fr.Motions;
			for (const group of Object.keys(motions)) {
				for (const motion of motions[group] === undefined ? [] : motions[group]) push(motion.File, false);
			}
			return refs;
		}

		/**
		 * 把一批工作区文件读成「虚拟 scheme 下的 objectURL」。
		 * 单个文件失败**整块失败**（立绘缺一块资源就画不出来，这里不能静默降级）。
		 * @param entries - [{name（虚拟路径）, path（工作区相对路径）, bytes（已读到的字节，可省）}]
		 * @returns Map<虚拟路径, objectURL>
		 */
		async function materializeAssets(remote, sessionId, entries, signal) {
			const byName = new Map();
			for (const entry of entries) if (!byName.has(entry.name)) byName.set(entry.name, entry);
			const urls = new Map();
			await Promise.all(Array.from(byName.values()).map(async (entry) => {
				const bytes = entry.bytes === undefined ? await readBinary(remote, sessionId, entry.path, signal) : entry.bytes;
				urls.set(entry.name, URL.createObjectURL(new Blob([bytes], { type: mimeOf(entry.path) })));
			}));
			return urls;
		}

		/**
		 * 安装「私有 scheme → objectURL」的解析器。
		 *
		 * 为什么必须拦这两处：渲染宿主（只读复用）取资源的全部出口就这两个 ——
		 * `fetch(url)`（model3.json / moc3 / 动作 / 表情 / 物理 / 姿态 / 13 个着色器）
		 * 与 `new Image().src = url`（贴图，见 `live2d-host/src/host.js:70-98` 的 `loadTexture`）。
		 * 只改写本插件自己的 scheme 前缀；任何别的 URL 原样透传，不碰宿主其它行为。
		 * @param urls - Map<虚拟路径, objectURL>
		 * @returns 还原函数（务必在 finally 里调用）
		 */
		function installAssetResolver(urls) {
			const nativeFetch = globalThis.fetch;
			const NativeImage = globalThis.Image;
			const resolve = (value) => {
				const url = typeof value === "string" ? value : value instanceof URL ? value.href : null;
				if (url === null || url.slice(0, ASSET_SCHEME.length) !== ASSET_SCHEME) return null;
				return urls.has(url.slice(ASSET_SCHEME.length)) ? urls.get(url.slice(ASSET_SCHEME.length)) : null;
			};
			globalThis.fetch = function classroomAssetFetch(input, init) {
				const url = typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input !== null && typeof input === "object" && typeof input.url === "string" ? input.url : null;
				const mapped = url === null ? null : resolve(url);
				return nativeFetch.call(this, mapped === null ? input : mapped, init);
			};
			class ClassroomAssetImage extends NativeImage {
				set src(value) {
					const mapped = resolve(value);
					super.src = mapped === null ? value : mapped;
				}
				get src() {
					return super.src;
				}
			}
			globalThis.Image = ClassroomAssetImage;
			return () => {
				globalThis.fetch = nativeFetch;
				globalThis.Image = NativeImage;
			};
		}

		/** Core 脚本与框架 bundle 是**整页一次性**资源（与 session 无关），只装一次。 */
		let coreReady = null;
		let frameworkModule = null;

		/**
		 * 立绘资源**实际用到的来源**（D3：三个来源按序解析，用哪个**如实记账**）。
		 * 面板的「讲台诊断」会把这张表显示出来——"到底从哪儿读的"不许靠猜。
		 */
		const portraitSources = { stage: false, core: null, model: null, shaders: null, framework: null, staticImage: null };

		/** 舞台路由是否可用（一次性探测 + 缓存；`false` ＝ 舞台没装，走工作区那条腿）。 */
		let stageRouteProbe = null;

		/**
		 * 舞台的 `/stage-static` 路由在不在（D3 的**第一个**来源）。
		 *
		 * 判据＝`GET /stage-static/manifest.json` 回 200 且 `routeBase` 就是这条前缀
		 * （形状取自舞台宿主半边的 `registerRoute('manifest', …)`，逐字核对过）。
		 * 🔴 只在**真浏览器 ＋ 同源 http(s)** 里探：
		 *    · node 侧测试没有 `document`/`location` → 直接判"没有舞台"（测试因此走工作区那条腿）；
		 *    · `file://` 打开时同源是 `file:`，`/stage-static/...` 没有意义 → 也判没有。
		 * @returns {Promise<boolean>}
		 */
		function stageRouteAvailable() {
			if (stageRouteProbe !== null) return stageRouteProbe;
			stageRouteProbe = (async () => {
				const location = globalThis.location;
				const pageLike = typeof document !== "undefined" && document !== null
					&& typeof globalThis.fetch === "function"
					&& location !== undefined && location !== null
					&& /^https?:$/.test(String(location.protocol));
				if (!pageLike) return false;
				try {
					const response = await globalThis.fetch(STAGE_ROUTE + "/manifest.json", { cache: "no-store" });
					if (!response.ok) return false;
					const body = await response.json();
					const ok = body !== null && typeof body === "object" && String(body.routeBase === undefined ? STAGE_ROUTE : body.routeBase) === STAGE_ROUTE;
					portraitSources.stage = ok;
					return ok;
				} catch (error) {
					// 舞台没装时这条路由就是 404/网络错——**不是异常态**，记一条诊断即可，面板不报错。
					recordDiag({ at: "stageRoute", ok: false, message: messageOf(error) });
					return false;
				}
			})();
			return stageRouteProbe;
		}

		/** 去重（保序）：来源链里两个根可能是同一个目录（部署把 assets 指到 out 时）。 */
		function dedupePaths(list) {
			const seen = new Set();
			const out = [];
			for (const value of list) {
				if (!seen.has(value)) { seen.add(value); out.push(value); }
			}
			return out;
		}

		/** 模型/贴图/表情/动作这些**模型目录内**的资源，按 D3 的顺序算出候选工作区路径。 */
		function assetCandidates(rel) {
			return dedupePaths([live2dRoot() + "/" + rel, portraitAssetsRoot() + "/" + rel]);
		}

		/**
		 * Core 脚本的候选工作区路径。
		 * 两个来源的**目录布局不同**（历史原因，两边都不能改）：
		 *   · `live2d-host/out/live2dcubismcore.min.js`（渲染宿主构建产物的根）；
		 *   · `classroom-stage-warm/assets/l2d/live2dcubismcore.min.js`（舞台自己的 l2d 目录）。
		 */
		function coreCandidates() {
			return dedupePaths([
				live2dRoot() + "/live2dcubismcore.min.js",
				portraitAssetsRoot() + "/l2d/live2dcubismcore.min.js",
			]);
		}

		/** 渲染宿主 bundle 只有**一个**来源（它是 `live2d-host` 自己的构建产物，舞台不提供）。 */
		function frameworkCandidates() {
			return [live2dRoot() + "/live2d-host.bundle.mjs"];
		}

		/** 着色器只有 `live2d-host/out` 里有（舞台用 PIXI 那套，不带这 13 个 GLSL）。 */
		function shaderCandidates(rel) {
			return [live2dRoot() + "/" + SHADER_DIR + rel];
		}

		/**
		 * 按候选表依次试读，**第一个成功的就用**；全失败时把**试过哪些 ＋ 各自的原因**一并交回。
		 * 🔴 不静默降级：返回的是"用了哪一条"，调用方负责把它记进 `portraitSources` 并显示。
		 * @returns {{ok:boolean, bytes:Uint8Array|null, path:string|null, failures:string[]}}
		 */
		async function readFirstAvailable(remote, sessionId, candidates, signal) {
			const failures = [];
			for (const path of candidates) {
				try {
					return { ok: true, bytes: await readBinary(remote, sessionId, path, signal), path: path, failures: failures };
				} catch (error) {
					failures.push(path + "（" + messageOf(error) + "）");
				}
			}
			return { ok: false, bytes: null, path: null, failures: failures };
		}

		/**
		 * 插一个 `<script src>` 并等它执行完。
		 * @param url - 脚本 URL（objectURL 或舞台路由）
		 * @param label - 失败时点名用（「Cubism Core」/「mermaid」…）
		 */
		function appendScript(url, label) {
			return new Promise((resolve, reject) => {
				const script = document.createElement("script");
				script.src = url;
				script.addEventListener("load", () => { resolve(); }, { once: true });
				script.addEventListener("error", () => { reject(new Error(label + "脚本装载失败：" + url)); }, { once: true });
				document.head.appendChild(script);
			});
		}

		/**
		 * 舞台那四个运行库**各自装好了的标志**（判定用全局，不靠"插过没有"）。
		 *
		 * 🔴 为什么按全局判而不是按 `<script>` 元素判：元素在**飞行中**（已插入、还没执行）时
		 *    "找到元素"不等于"库可用"。而全局只会在脚本**执行完**之后出现——用它当标志，
		 *    "已经在页上"与"已经可用"是同一件事（EC 要的正是这个语义）。
		 */
		const STAGE_LIB_GLOBALS = {
			"pixi.min.js": () => globalThis.PIXI !== undefined && globalThis.PIXI !== null,
			"live2d.min.js": () => globalThis.Live2D !== undefined && globalThis.Live2D !== null,
			"live2dcubismcore.min.js": () => globalThis.Live2DCubismCore !== undefined && globalThis.Live2DCubismCore !== null,
			"index.min.js": () => globalThis.PIXI !== undefined && globalThis.PIXI !== null
				&& globalThis.PIXI.live2d !== undefined && globalThis.PIXI.live2d !== null,
		};

		/** 页面上是否已经有指向这个 URL 的 `<script>`（清单外的文件用它去重）。 */
		function hasScript(url) {
			try {
				const absolute = new URL(url, document.baseURI).href;
				for (const el of document.querySelectorAll("script")) {
					if (el.src === absolute || el.getAttribute("src") === url) return true;
				}
			} catch (error) {
				recordDiag({ at: "hasScript", message: messageOf(error) });
			}
			return false;
		}

		/**
		 * 装一个脚本，**已经可用就跳过**（这是 EC「不能重复执行也不能冲突」的落地）。
		 * @param url - 脚本 URL
		 * @param label - 失败文案里点名用
		 * @param fileName - 清单里的文件名（有标志全局的按全局判，没有的按 `src` 去重）
		 * @returns {Promise<"preexisting"|"loaded">}
		 */
		async function loadScriptOnce(url, label, fileName) {
			const probe = fileName === undefined ? undefined : STAGE_LIB_GLOBALS[fileName];
			if (probe !== undefined) {
				if (probe()) return "preexisting";
			} else if (hasScript(url)) {
				return "preexisting";
			}
			await appendScript(url, label);
			return "loaded";
		}

		/**
		 * 装载官方 Cubism Core（经典脚本，执行后提供 `Live2DCubismCore` 全局）。
		 * 与 `live2d-host/demo/demo.html:11` 的 `<script src>` 是同一件事，只是脚本源换成了 objectURL。
		 *
		 * 🔴 **EC（D3/D4）· 谁负责谁**：
		 *   · 舞台（S 车道）在 `ensureL2dLibs()` 里按清单 `<script src="/stage-static/l2d/live2dcubismcore.min.js">`
		 *     装同一份文件；
		 *   · 本面板**先看全局在不在**：`Live2DCubismCore` 是**整页唯一**的 Cubism 运行时
		 *     （重复执行＝在同一个全局名下重建一遍 csm 运行时，两个应用共享谁的内存说不清）。
		 *     已在 → **直接跳过**（`portraitSources.core === "preexisting"`），一个字节都不重读。
		 *   · 两边指向的是**同一个文件**（`classroom-stage-warm/assets/l2d/live2dcubismcore.min.js`），
		 *     所以"谁先装"都不产生版本差；面板不依赖舞台的 PIXI/display 两个库，舞台也不依赖面板的渲染宿主。
		 */
		async function loadCore(remote, sessionId, signal) {
			if (coreReady !== null) return coreReady;
			coreReady = (async () => {
				if (globalThis.Live2DCubismCore !== undefined && globalThis.Live2DCubismCore !== null) {
					portraitSources.core = "preexisting";
					return;
				}
				if (await stageRouteAvailable()) {
					// ① 舞台装了：直接取它已经注册好的那份（同源 HTTP，不需要 token——舞台自己也这么取）。
					const url = STAGE_ROUTE + "/l2d/live2dcubismcore.min.js";
					await appendScript(url, "Cubism Core 装载失败（舞台路由 " + STAGE_ROUTE + "）");
					portraitSources.core = url;
				} else {
					// ② 舞台没装：按 D3 的来源链从工作区字节通道读。
					const read = await readFirstAvailable(remote, sessionId, coreCandidates(), signal);
					if (!read.ok) {
						// 🔴 文案里必须点名是哪个文件——「立绘装载失败」那条一行说明靠它定位（测试也认它）。
						throw new Error("读不到 Cubism Core 脚本（live2dcubismcore.min.js），试过 " + String(read.failures.length) + " 处：" + read.failures.join("；"));
					}
					const url = URL.createObjectURL(new Blob([read.bytes], { type: "text/javascript" }));
					await appendScript(url, "Cubism Core 装载失败（" + read.path + "）");
					portraitSources.core = read.path;
				}
				if (globalThis.Live2DCubismCore === undefined) throw new Error("Core 脚本执行完却没有 Live2DCubismCore 全局");
			})();
			coreReady = coreReady.catch((error) => {
				coreReady = null;
				throw error;
			});
			return coreReady;
		}

		/**
		 * 装载渲染宿主的 ESM bundle（动态 `import(objectURL)`）。
		 * 插件 bundle 本身是**经典脚本**（宿主按 `<script src>` 装载，见
		 * `dsh-client-modules/lib/client.js:146-158`），所以这里用动态 import 是合法的。
		 *
		 * 🔴 D3 的**边界**（如实说）：舞台的 `/stage-static` **不提供**这个 bundle
		 *    （舞台用 PIXI ＋ pixi-live2d-display，本插件的 `live2d-host` 是另一套自研渲染器）。
		 *    所以它只有 `clients/live2d-host/out/` 一个来源；那个目录没构建过 → 立绘不可用 →
		 *    面板退回**静态立绘图**（§7 的失败态 ＋ `staticPortrait`）。这正是本仓库当前的事实。
		 * @returns bundle 的命名导出（`Live2DHost` / `parseCapability` / 两个 provider …）
		 */
		async function loadFramework(remote, sessionId, signal) {
			if (frameworkModule !== null) return frameworkModule;
			const read = await readFirstAvailable(remote, sessionId, frameworkCandidates(), signal);
			if (!read.ok) {
				throw new Error("读不到渲染宿主 bundle（live2d-host.bundle.mjs）：" + read.failures.join("；")
					+ " → 该文件是 clients/live2d-host 的构建产物（node scripts/build.mjs，需先装 vendor/），本插件不改它");
			}
			const url = URL.createObjectURL(new Blob([read.bytes], { type: "text/javascript" }));
			frameworkModule = await import(url);
			portraitSources.framework = read.path;
			return frameworkModule;
		}

		/**
		 * 相位 → 立绘状态（`研究_8_Live2D驱动与集成_2026-09-24.md` §5.1 的映射表落地版）。
		 *
		 * 🔴 表情只按**下标**取：官方样本的表情名是 `F01…` / `exp_01…`，**语义要人工标定后才有意义**
		 *    （研究_8 §P2 把「每模型一次人工标定」列为待办）。本轮**不做标定**，所以下面这张表
		 *    给的是「确定的、可复现的」映射，**不是「对的」映射**；改标定只需要改这张表。
		 * 🔴 `answer` 相位走 `write` 通道＝**嘴不动**：研究_8 §5.1 的教学要求是「学生作答时立绘退让」，
		 *    而本轮渲染宿主只有「表情 / 动作 / 嘴参数」三个可控面，嘴不动是其中唯一能表达"退让"的。
		 */
		const PHASE_STATES = {
			open: { expressionIndex: 0, channel: "speak", note: "开场：默认呼吸 + 眨眼" },
			probe: { expressionIndex: 1, channel: "speak", note: "追问：表情下标 1（未标定）" },
			answer: { expressionIndex: 2, channel: "write", note: "学生作答：退让——嘴不动（通道 write）" },
			check: { expressionIndex: 3, channel: "write", note: "对答案：通道切 write（写字时嘴不动）" },
			review: { expressionIndex: 4, channel: "speak", note: "复习：表情下标 4（未标定）" },
			close: { expressionIndex: 5, channel: "speak", note: "收尾：放松（表情下标 5，未标定）" },
		};

		/** 相位未提供（或不在枚举里）时的默认状态：待机，不改表情。 */
		const IDLE_STATE = { expressionIndex: null, channel: "speak", note: "默认待机（呼吸 + 眨眼，不改表情）" };

		/**
		 * @param phase - `runtime/progress.md` 的 `current_phase:` 取值；未提供传 null
		 * @returns {phase, provided, expressionIndex, channel, note}
		 */
		function phaseStateOf(phase) {
			if (phase === null || phase === undefined || phase === "") {
				return { phase: null, provided: false, expressionIndex: IDLE_STATE.expressionIndex, channel: IDLE_STATE.channel, note: IDLE_STATE.note };
			}
			const known = Object.prototype.hasOwnProperty.call(PHASE_STATES, phase) ? PHASE_STATES[phase] : null;
			if (known === null) {
				return { phase: phase, provided: true, expressionIndex: null, channel: "speak", note: "相位 id 不在 classroom.yaml 的枚举里 → 不改表情" };
			}
			return { phase: phase, provided: true, expressionIndex: known.expressionIndex, channel: known.channel, note: known.note };
		}

		/** 立绘资源按 session 缓存：**不重复读盘、不重复建 objectURL**（见 README §已知边界）。 */
		const assetCache = new Map();

		/**
		 * 读齐一张模型需要的全部资源（模型目录 + 13 个着色器 + model3.json 自身）。
		 * @returns Map<虚拟路径, objectURL>
		 */
		/**
		 * 读齐一张模型需要的全部资源（模型目录 ＋ 13 个着色器 ＋ model3.json 自身）。
		 *
		 * 🔴 D3 的来源分派（**每个文件各自解析，用到的来源如实记进 `portraitSources`**）：
		 *   · 舞台装了（`stage === true`）：模型目录内的文件走 `/stage-static/models/<模型>/…`
		 *     ——这条路是舞台宿主半边已经注册好的静态根，布局与工作区那份**逐字相同**
		 *     （`models/<名>/<名>.model3.json`），所以 URL 就是 `STAGE_ROUTE + "/" + 虚拟名`；
		 *   · 舞台没装：按 `assetCandidates` 的顺序从工作区字节通道读（out → 舞台包 assets）；
		 *   · **着色器永远只有 `live2d-host/out/shaders/WebGL/` 一份**（舞台那套不带 GLSL），
		 *     所以它总是走字节通道 + 私有 scheme。
		 * @returns Map<虚拟路径, 浏览器可加载的 URL（objectURL 或舞台路由）>
		 */
		function assetsFor(remote, sessionId, signal, stage) {
			const key = sessionId + "|" + live2dRoot() + "|" + portraitAssetsRoot() + "|" + modelName() + "|" + (stage === true ? "stage" : "workspace");
			if (assetCache.has(key)) return assetCache.get(key);
			const pending = (async () => {
				const modelDir = "models/" + modelName() + "/";
				const modelFile = modelName() + ".model3.json";
				let model3;
				let model3Bytes = null;
				let model3Source;
				if (stage === true) {
					const response = await globalThis.fetch(STAGE_ROUTE + "/" + modelDir + modelFile, { cache: "no-store" });
					if (!response.ok) {
						throw new Error("从舞台路由读不到 " + modelDir + modelFile + "（HTTP " + String(response.status) + "）");
					}
					model3Bytes = new Uint8Array(await response.arrayBuffer());
					model3Source = STAGE_ROUTE + "/" + modelDir + modelFile;
				} else {
					const read = await readFirstAvailable(remote, sessionId, assetCandidates(modelDir + modelFile), signal);
					if (!read.ok) throw new Error("读不到 " + modelDir + modelFile + "：" + read.failures.join("；"));
					model3Bytes = read.bytes;
					model3Source = read.path;
				}
				try {
					model3 = JSON.parse(decodeText(model3Bytes));
				} catch (error) {
					throw new Error("model3.json 不是合法 JSON：" + messageOf(error));
				}
				portraitSources.model = model3Source;
				const urls = new Map();
				const names = [modelDir + modelFile];
				for (const ref of modelReferences(model3)) names.push(modelDir + ref.rel);
				if (stage === true) {
					// 舞台路由：直接把 URL 交出去（不建 objectURL，不重复读一遍字节）。
					for (const name of names) urls.set(name, STAGE_ROUTE + "/" + name);
				} else {
					const entries = [];
					for (const name of names) entries.push({ name: name, path: null });
					// 逐文件找候选根：第一个能读到的就用（`materializeAssets` 只负责建 objectURL）。
					// 🔴 `path` 必须留在入口上：`materializeAssets` 用 `mimeOf(entry.path)` 定 Blob 的
					//    MIME（贴图必须是 `image/png` 才能被 `Image` 解出来），给 null 会当场抛。
					await Promise.all(entries.map(async (entry) => {
						const read = await readFirstAvailable(remote, sessionId, assetCandidates(entry.name), signal);
						if (!read.ok) throw new Error("读不到 " + entry.name + "：" + read.failures.join("；"));
						entry.bytes = read.bytes;
						entry.path = read.path;
					}));
					for (const [name, url] of await materializeAssets(remote, sessionId, entries, signal)) urls.set(name, url);
				}
				// 着色器：只有 out 一份，走字节通道（逐字节忠实，理由见 `readBinary` 的注释）。
				const shaderEntries = SHADER_FILES.map((file) => ({ name: SHADER_DIR + file, path: shaderCandidates(file)[0] }));
				for (const [name, url] of await materializeAssets(remote, sessionId, shaderEntries, signal)) urls.set(name, url);
				portraitSources.shaders = live2dRoot() + "/" + SHADER_DIR;
				return { urls: urls, model3: model3, modelDir: modelDir, modelFile: modelFile };
			})();
			assetCache.set(key, pending);
			pending.catch(() => { assetCache.delete(key); });
			return pending;
		}

		// ════════════════════════════════════════════════════════════════════
		// 6.55 · 把引擎给的表情指令**真的写到脸上**（EXPR-3）
		//
		// 引擎（`classroom_express`）已经能把「老师这一回合的表情」写成三条**并列**的手段，
		// 客户端这一半的活是：**照它说的那条路，把结果落到立绘上**，且不许静默。
		//
		// 🔴 三条纪律的落点（逐字照 `研究_同类DSH立绘插件_2026-09-24.md` §七 R3）：
		//   ① **先探测再调用**：命名表情走 `host.startExpression(name)`——**未命中返回 false**。
		//      返回 false **不重试**，并在面板上说清「该名字未注册」（见 `applyExpression`）。
		//   ② **参数直驱前先把本表用到的参数全部清零**：否则会叠加——嘴型上踩过
		//      `addParameterValueById` 是累加的坑。清零范围＝**本表出现过的全部参数名**
		//      （不是"当前这一条的几个"），落点在 `createFaceDriver().write()` 的第一步。
		//   ③ **每帧平滑过渡**：触发帧只记目标，之后每帧 `cur += (target - cur) * k`，
		//      **不在触发帧硬切**（落点同上，第二步）。
		//
		// 🆕 两条本轮新踩出来的坑（来自另一路的报告）：
		//   · 🔴 **逐参数那一路必须写在 `onLateUpdate` 那一段**：宿主 `update(dt)` 的顺序是
		//     `model.loadParameters()` → motion → `model.saveParameters()` → `onLateUpdate()`
		//     → `model.update()`。应用层若在别的时机写参数，**下一帧 `loadParameters()` 会把写入冲掉**
		//     （画面上永远看不到，且不报任何错）。落地方式＝挂一个 updater 进
		//     `CubismUpdateScheduler`（官方 `CubismLipSyncUpdater` 就是这么插进去的），
		//     执行序取 **650**（官方枚举 `CubismUpdateOrder_Physics = 600` 与 `_LipSync = 700` 之间）。
		//   · 🔴 **客户端也要过滤 LipSync 参数**：引擎侧兜底已经排除嘴参数，但**老师显式指定时引擎不排除**
		//     → 这一层必须自己兜住：嘴型通道与表情通道**不许抢同一个参数**；被跳过的 id 如实报出来。
		// ════════════════════════════════════════════════════════════════════

		/** 逐参数驱动的每帧插值系数（`cur += (target - cur) * k`）：0.25 ≈ 每帧走掉 1/4 的差距。 */
		const FACE_LERP_K = 0.25;

		/** 驱动在 scheduler 里的执行序（官方枚举里 Physics=600、LipSync=700 之间）。 */
		const FACE_UPDATER_ORDER = 650;

		/** 收敛判据：所有参数的 |target - cur| 都小于它就算到位。 */
		const FACE_CONVERGED = 1e-3;

		/**
		 * 回合内重读 `runtime/expression.md` 的间隔（ms）。
		 * 表情是老师在**回合中间**用工具决定的，而 store 的刷新节奏是"回合边界"——不轮询就会慢一个回合。
		 * 400 ms 是"够快"与"别把盘读爆"之间的取中（读的是几百字节的小文件）。
		 */
		const EXPRESSION_POLL_MS = 400;

		/**
		 * 模型里「参数 id → 下标」的全表。
		 *
		 * 🔴 为什么要自己建表：官方 `getParameterIndex(handle)` 要的是 `CubismId` **对象**，
		 *    而引擎给的是**字符串**——把字符串直接塞进去会返回 -1（于是静默写不进去、画面不动）。
		 *    取句柄的正路是 `model.getParameterId(i).getString()`（`CubismModel` 的公开方法，
		 *    见 `vendor/CubismWebFramework/src/model/cubismmodel.ts` 与 `id/cubismid.ts`）；
		 *    **不用**去碰 `CubismFramework.getIdManager()`——渲染宿主的 bundle 没有导出它。
		 * @param model - CubismModel
		 * @returns Map<参数 id, 下标>
		 */
		function parameterIndexMap(model) {
			const map = new Map();
			const count = model.getParameterCount();
			for (let i = 0; i < count; i++) {
				const id = model.getParameterId(i);
				if (id === null || id === undefined || typeof id.getString !== "function") continue;
				map.set(id.getString(), i);
			}
			return map;
		}

		/**
		 * 参数 id 的「同一形状」归一（去分隔符 ＋ 大写）。
		 *
		 * 🔴 **只用于报错提示，绝不用它去写值**：官方 Miku 的参数是全大写蛇形（`PARAM_EYE_L_OPEN`），
		 *    Haru 是驼峰（`ParamEyeLOpen`），两边形状不同。引擎那一侧已经把「参数 id 与正则」
		 *    做同一形状变换再匹配（另一路刚修的一个静默 bug）；**客户端这一层不做任何变换**——
		 *    写值只认**模型自己的 id 原样匹配**，匹配不上就**明说不可用**。
		 *    这里归一化只为把话说清："你要的 `PARAM_EYE_L_OPEN`，模型里叫 `ParamEyeLOpen`"。
		 * @param id - 参数 id
		 * @returns 归一后的形状串
		 */
		function parameterShape(id) {
			return String(id).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
		}

		/**
		 * 逐参数直驱（路 B）的驱动器。
		 *
		 * 状态全在 JS 侧（`writes`），每帧写进模型的是**绝对值**（`setParameterValueByIndex`），
		 * 所以不会像 `addParameterValueById` 那样叠加。
		 *
		 * 生命周期：`setTargets(表)` → 每帧 `write()`（由 scheduler 在 late-update 段调用）
		 * → `setTargets(null)` 时目标全归 0，**插值淡出后自动停手**，把参数交还给动作/呼吸。
		 *
		 * @param host - 渲染宿主（`Live2DHost`）
		 * @param options - `{lipSyncIds}`：归嘴型通道所有的参数 id（**本驱动不许写**）
		 * @returns {setTargets, write, readout, updater}
		 */
		function createFaceDriver(host, options) {
			const opts = options === null || options === undefined ? {} : options;
			const declared = opts.lipSyncIds === null || opts.lipSyncIds === undefined ? [] : opts.lipSyncIds;
			const lipSyncIds = new Set(declared.filter((id) => typeof id === "string" && id !== ""));
			let indexMap = null;
			/** id → {target, cur}：**本表出现过的全部参数**（清零范围＝它的键集） */
			const writes = new Map();
			/** 如实记账（面板要显示，不静默）：被跳过的嘴参数 / 模型里没有的参数 */
			const skippedLipSync = new Set();
			const unknownIds = new Set();
			/**
			 * 🔴 如实记账（EXPR-5）：**这一次请求里被夹取的参数**（老师要的值超出该参数在模型里的值域）。
			 * 形状 `Map<id, {requested, applied, min, max}>`。
			 *
			 * 🔴 与隔壁两个 `Set`（`skippedLipSync` / `unknownIds`）**刻意不同**：那两个是**累计**的，
			 *    本表**每次换表清空**。理由：本表显示在"这一轮应用了哪个表情"那一行上，
			 *    累计显示会出现"当前是 `ParamEyeLOpen=1.3`，面板却说『夹取 3 → 2』"这种**面板与事实不符**的话
			 *    （本任务实测踩到过）。夹取是**这一次请求**的事实，故按次记账。
			 */
			const clamped = new Map();
			/** 值域拿不拿得到：`null`＝还没写过；`"ok"`／`"unavailable"`（宿主没暴露 API 时不许静默）。 */
			let clampRange = null;
			/** 模型里没有的那个 id，**按形状**能在模型里找到谁（只用来把话说清，不用它写值） */
			const shapeHints = new Map();
			let lastFace = null;
			let active = false;
			let frames = 0;

			const model = () => host.userModel.getModel();
			const indexOf = (id) => {
				if (indexMap === null) indexMap = parameterIndexMap(model());
				const index = indexMap.get(id);
				return index === undefined ? -1 : index;
			};
			const allTargetsZero = () => {
				for (const state of writes.values()) if (state.target !== 0) return false;
				return true;
			};

			/**
			 * 把一个请求值夹进**该参数在模型里的真实值域**（EXPR-5）。
			 *
			 * 🔴 为什么必须显式夹一次（实测，不是猜）：
			 *    · 框架的 `CubismModel.setParameterValueByIndex()` **自己就会夹**
			 *      （`cubismmodel.ts`：非 repeat 参数走 `getParameterClampValue` → `CubismMath.clamp(value, min, max)`），
			 *      但它**一声不响**——面板读数、状态文件、日志都不体现"你要 3、实际是 2"；
			 *    · 于是"面板说已应用 ParamEyeLOpen=3"与"模型里是 2"可以同时为真，**没有任何一处说得出差别**。
			 *    本函数把这一步搬到明处：夹取用的是**模型自己的 min/max**
			 *    （`getParameterMinimumValue/MaximumValue`，Cubism Core 的
			 *      `csmGetParameterMinimumValues/MaximumValues` 经框架透出），
			 *    夹了什么逐条记进 `clamped`，由面板显示。
			 * 🔴 值域**只能**这样拿：`cdi3.json` 里没有 min/max，渲染侧的能力发现产物里也没有，
			 *    只有**运行时的模型**有。故"按 0–1 归一化"这类**推断**范围一律不用——
			 *    实测（`tmp_expr5/all-ranges.json`，13 个模型 754 个参数）Haru 的 `ParamAngleX`
			 *    值域是 ±30、`ParamEyeLOpen` 是 0…2、`ParamArmLB` 是 −1…5；
			 *    按 0–1 夹会把**合法值**改坏，比不夹更糟。
			 * @param index - 参数在模型里的下标
			 * @param value - 老师要的值
			 * @returns {{applied:number, min:number, max:number, changed:boolean}}
			 */
			function clampToModel(index, value) {
				const target = model();
				if (typeof target.getParameterMinimumValue !== "function" || typeof target.getParameterMaximumValue !== "function") {
					// 🔴 渲染宿主没暴露参数值域（框架 API 缺失）→ **夹不了**。这不许静默：
					//    记一次 `clampRange = "unavailable"`，由面板把"这次没有夹"说出来。
					clampRange = "unavailable";
					return { applied: value, min: null, max: null, changed: false };
				}
				const min = target.getParameterMinimumValue(index);
				const max = target.getParameterMaximumValue(index);
				if (!Number.isFinite(min) || !Number.isFinite(max)) {
					clampRange = "unavailable";
					return { applied: value, min: min, max: max, changed: false };
				}
				clampRange = "ok";
				const applied = value < min ? min : value > max ? max : value;
				return { applied: applied, min: min, max: max, changed: applied !== value };
			}

			/**
			 * 一帧的写入——**只能在 `onLateUpdate` 那一段被调用**（否则下一帧 `loadParameters()` 冲掉）。
			 * 两步，顺序不能换：
			 *   ① **先把本表出现过的全部参数清零**（纪律 ②：清零范围＝全集，不是当前这一条的几个）；
			 *   ② 再把每个参数朝它的目标插值一步（纪律 ③：不在触发帧硬切）。
			 * 两步在同一帧内完成，所以**渲染看到的永远是插值结果**，中间那个 0 不会上屏。
			 */
			function write() {
				if (!active) return;
				const target = model();
				for (const id of writes.keys()) {
					const index = indexOf(id);
					if (index >= 0) target.setParameterValueByIndex(index, 0);
				}
				let worst = 0;
				for (const [id, state] of writes) {
					state.cur += (state.target - state.cur) * FACE_LERP_K;
					const index = indexOf(id);
					if (index >= 0) target.setParameterValueByIndex(index, state.cur);
					const gap = Math.abs(state.target - state.cur);
					if (gap > worst) worst = gap;
				}
				frames += 1;
				// 目标全是 0（＝「这一轮没有表情了」的收尾）且已收敛 → 停手，把参数交还给动作/呼吸
				if (worst < FACE_CONVERGED && allTargetsZero()) {
					writes.clear();
					active = false;
				}
			}

			/**
			 * 换一张表（触发帧只记目标——纪律 ③）。
			 * @param face - `Record<参数 id, 目标值>`；`null` ＝收尾（全部淡出到 0 后停手）
			 */
			function setTargets(face) {
				lastFace = face === null || face === undefined ? null : Object.assign({}, face);
				// 🔴 EXPR-5：夹取记账**按次**（每次换表清空）——见 `clamped` 的说明。
				clamped.clear();
				const next = new Map();
				if (lastFace !== null) {
					for (const [id, value] of Object.entries(lastFace)) {
						if (lipSyncIds.has(id)) { skippedLipSync.add(id); continue; }
						const index = indexOf(id);
						if (index < 0) {
							// 🔴 模型里没有这个 id → **不写、如实报**（这是本项目最恨的失效模式：静默什么都不做）。
							//    顺手按"同一形状"找一下模型里有没有等价的参数，好把话说清。
							unknownIds.add(id);
							if (indexMap !== null && !shapeHints.has(id)) {
								const shape = parameterShape(id);
								for (const candidate of indexMap.keys()) {
									if (candidate !== id && parameterShape(candidate) === shape) { shapeHints.set(id, candidate); break; }
								}
							}
							continue;
						}
						// 🔴 EXPR-5：**先按模型自己的值域夹一次**，再交给驱动器（夹了什么进 `clamped`，面板会显示）。
						const bounded = clampToModel(index, value);
						if (bounded.changed) {
							clamped.set(id, { requested: value, applied: bounded.applied, min: bounded.min, max: bounded.max });
						}
						next.set(id, bounded.applied);
					}
				}
				// 纪律 ②：清零范围＝**本表出现过的全部参数**。不在新表里的，目标值归 0
				// （逐帧插值到 0，不是硬切）；它保证上一次那张表留下的值不会残留在脸上。
				for (const id of writes.keys()) if (!next.has(id)) next.set(id, 0);
				if (next.size === 0) { writes.clear(); active = false; return; }
				for (const [id, value] of next) {
					const state = writes.get(id);
					if (state === undefined) {
						// 新参数：**从 0 起步**（先清零再写），于是新表情是"淡入"而不是"跳上去"
						writes.set(id, { target: value, cur: 0 });
					} else {
						state.target = value;
					}
				}
				active = true;
			}

			/** 驱动器读数（面板与验收都读它，不靠猜）。 */
			function readout() {
				const values = {};
				for (const [id, state] of writes) values[id] = { target: state.target, cur: state.cur };
				return {
					active: active,
					written: writes.size,
					frames: frames,
					face: lastFace,
					values: values,
					lipSyncIds: Array.from(lipSyncIds),
					skippedLipSync: Array.from(skippedLipSync),
					unknownIds: Array.from(unknownIds),
					/**
					 * 🔴 EXPR-5：**这一次请求里**被夹取的参数。每条 `{id, requested, applied, min, max}`。
					 * `values[id].target` 里放的是**夹取后**的值，所以读数与模型里的一致；
					 * 这里额外留下"老师原本要多少"，好让面板把话说全（不静默改值）。
					 */
					clamped: Array.from(clamped.entries()).map(([id, entry]) => Object.assign({ id: id }, entry)),
					/** `"ok"`＝值域读到了；`"unavailable"`＝宿主没暴露 → **这次没有夹**（面板会说）。 */
					clampRange: clampRange,
					/** `{要的 id: 模型里同形状的那个 id}` —— 只用于把话说清，见 `parameterShape` */
					shapeHints: Array.from(shapeHints.entries()).map(([id, modelId]) => ({ id: id, modelId: modelId })),
				};
			}

			/**
			 * scheduler 里那个 updater。
			 * 官方 `CubismUpdateScheduler.addUpdatableList()` 只用到这四个成员
			 * （`getExecutionOrder` / `onLateUpdate` / `addChangeListener` / `removeChangeListener`，
			 * 见 `vendor/CubismWebFramework/src/motion/cubismupdatescheduler.ts`），
			 * 所以这里给一个**够用的普通对象**，不去 import 框架类（bundle 也没导出 scheduler）。
			 */
			function updater() {
				return {
					getExecutionOrder: () => FACE_UPDATER_ORDER,
					onLateUpdate: () => { write(); },
					addChangeListener: () => {},
					removeChangeListener: () => {},
				};
			}

			return { setTargets: setTargets, write: write, readout: readout, updater: updater, indexOf: indexOf };
		}

		/**
		 * 舞台那套运行时的就绪检测 ＋ 装载（D3 的**第一来源**）。
		 *
		 * 面板**不引入任何新依赖**：用的就是舞台已经装进页面的四个库
		 * （`pixi.min.js` / `live2d.min.js` / `live2dcubismcore.min.js` / `index.min.js`，
		 * 清单来自舞台的 `/stage-static/manifest.json` 的 `l2d` 字段，与舞台自己那份**同一份清单**）。
		 *
		 * 🔴 三条纪律（逐条都有理由）：
		 *   ① **同一份文件不重复执行**：`loadScriptOnce` 先按 `src` 找页面上已有的 `<script>`
		 *      ——舞台插过的那四个就在页面上了，找不到才插。于是 `Live2DCubismCore` 与 `PIXI`
		 *      这两个**整页唯一**的全局**不会被执行两遍**（EC：两边对 Core 的加载不能重复也不能冲突）。
		 *   ② **顺序照清单分两段**：先 `pixi`，再其余三个（`index.min.js` 在加载期就要用 `PIXI`，
		 *      同段并行会在 pixi 之前跑 —— 舞台的注释里已记过这个坑）。
		 *   ③ **没有舞台就如实说没有**：`manifest.json` 404/网络错 → `ok:false` ＋ 原因，
		 *      由调用方走 D3 的退路（静态立绘图），不重试、不猜。
		 * @returns {Promise<{ok:boolean, PIXI:object|null, reason:string|null, manifest:object|null}>}
		 */
		let stageRuntimeProbe = null;
		function stageRuntime() {
			if (stageRuntimeProbe !== null) return stageRuntimeProbe;
			stageRuntimeProbe = (async () => {
				if (!(await stageRouteAvailable())) {
					return { ok: false, PIXI: null, reason: "舞台没装（" + STAGE_ROUTE + "/manifest.json 不可达）", manifest: null };
				}
				let manifest;
				try {
					const response = await globalThis.fetch(STAGE_ROUTE + "/manifest.json", { cache: "no-store" });
					if (!response.ok) throw new Error("HTTP " + String(response.status));
					manifest = await response.json();
				} catch (error) {
					return { ok: false, PIXI: null, reason: "读不到舞台清单：" + messageOf(error), manifest: null };
				}
				const phases = Array.isArray(manifest.l2d) ? manifest.l2d : [];
				if (phases.length === 0) return { ok: false, PIXI: null, reason: "舞台清单里没有 l2d 库（manifest.l2d 为空）", manifest: manifest };
				try {
					for (const phase of phases) {
						await Promise.all(phase.map((file) => loadScriptOnce(STAGE_ROUTE + "/l2d/" + file, "舞台运行时库", file)));
					}
				} catch (error) {
					return { ok: false, PIXI: null, reason: messageOf(error), manifest: manifest };
				}
				const PIXI = globalThis.PIXI;
				const hasModel = PIXI !== undefined && PIXI !== null
					&& PIXI.live2d !== undefined && PIXI.live2d !== null
					&& PIXI.live2d.Live2DModel !== undefined && PIXI.live2d.Live2DModel !== null;
				if (!hasModel) {
					return { ok: false, PIXI: null, reason: "舞台的 l2d 库装完了却没有 PIXI.live2d.Live2DModel 全局", manifest: manifest };
				}
				if (globalThis.Live2DCubismCore === undefined || globalThis.Live2DCubismCore === null) {
					return { ok: false, PIXI: null, reason: "舞台的 l2d 库装完了却没有 Live2DCubismCore 全局", manifest: manifest };
				}
				portraitSources.stage = true;
				// 这条腿的 Core 只有**一个**来源：舞台那条路由（舞台自己先装过的话，这里就是"已存在，跳过"）。
				portraitSources.core = STAGE_ROUTE + "/l2d/live2dcubismcore.min.js";
				return { ok: true, PIXI: PIXI, reason: null, manifest: manifest };
			})();
			return stageRuntimeProbe;
		}

		/**
		 * 装载一张立绘并起渲染循环（**入口**）。
		 *
		 * D3 的两条腿，顺序就是契约的顺序：
		 *   ① 舞台装了 → 用**舞台那套**（PIXI 6 ＋ pixi-live2d-display，模型走 `/stage-static/models/…`）；
		 *   ② 舞台没装 → 走本插件自带的 `live2d-host` 渲染宿主（`clients/live2d-host/out`，
		 *      那是**另一条工作线**的构建产物；本机没构建过 → 抛 → 面板进失败态并**显示静态立绘图**）。
		 * 两条腿返回**同一套句柄 API**，`PortraitStage` 不需要知道这次走的是哪条。
		 * @param options - {remote, sessionId, canvas, signal}
		 * @returns 引擎句柄：{host, capability, applyPhase, applyExpression, setChannel, startFeed, stopFeed, readout, setPaused, dispose}
		 */
		async function mountPortrait(options) {
			const stage = await stageRuntime();
			if (stage.ok) return mountPixiPortrait(options, stage);
			portraitSources.stage = false;
			try {
				return await mountCustomPortrait(options);
			} catch (error) {
				/**
				 * 🔴 把**「能力缺席」**与**「装载故障」**分开（两件事，语义不同）：
				 *   · 自带这条腿的**入口**＝渲染宿主 bundle（`live2d-host.bundle.mjs`）。它读不到
				 *     ⇒ 这台 profile 上**根本没有可用的 Live2D 源**（舞台没装 ＋ 自带宿主未构建）
				 *     ⇒ 这是**预期的能力缺席**，面板显示静态图 ＋ 一条中性说明，**不叫"装载失败"**；
				 *   · 入口读得到、后面某一步坏了（Core 读不到/执行失败、模型 JSON 坏、着色器编译超时…）
				 *     ⇒ 那是**故障**，原始报错一路抛出去，面板照旧显示「立绘装载失败：…」。
				 * 判据是"重新读一次入口"（只在失败路径多读一次，正常路径零成本），
				 * 不是拿报错文案做字符串匹配。
				 */
				const entry = await readFirstAvailable(options.remote, options.sessionId, frameworkCandidates(), options.signal);
				if (entry.ok) throw error;
				const absent = new Error("本 profile 没有可用的 Live2D 源（舞台没装，且自带渲染宿主 " + live2dRoot() + " 未构建）");
				absent.code = "portrait/no-source";
				absent.causes = [messageOf(error)];
				throw absent;
			}
		}

		/**
		 * 用**舞台那套**画立绘（PIXI ＋ pixi-live2d-display，模型与库都走 `/stage-static`）。
		 *
		 * 🔴 D1「只播待机动作」的落地：起来就 `Idle` 那一组，**不接**相位映射、**不接**引擎表情。
		 *    呼吸与眨眼是框架内部的参数更新（与动作无关），所以即使 `Idle` 动作只播一轮，
		 *    画面仍然是"在呼吸、在眨眼"的。
		 * 🔴 D1「约 15fps」的落地：`app.ticker.maxFPS = PORTRAIT_FPS` ＋ 模型手动更新
		 *    （`autoUpdate:false`，在同一个 ticker 回调里 `model.update(dt)`）——
		 *    渲染与模型推进**同频**，不是"渲染 15fps、模型还在 60fps 空转"。
		 * 🔴 D2「暂停」的落地：`app.ticker.stop()`（GPU 与 CPU 都停），恢复 `start()`。
		 * @returns 与 `mountCustomPortrait` **同形**的句柄
		 */
		async function mountPixiPortrait(options, stage) {
			const canvas = options.canvas;
			const PIXI = stage.PIXI;
			const width = canvas.width === 0 ? PORTRAIT_CANVAS_SIZE : canvas.width;
			const height = canvas.height === 0 ? PORTRAIT_CANVAS_SIZE : canvas.height;
			const app = new PIXI.Application({
				view: canvas,
				width: width,
				height: height,
				backgroundAlpha: 0,
				antialias: true,
				autoDensity: true,
				resolution: typeof globalThis.devicePixelRatio === "number" && globalThis.devicePixelRatio > 0 ? globalThis.devicePixelRatio : 1,
				// 🔴 用自己的 ticker（PIXI 默认就是 false）：15fps 只节流面板这一个应用，
			//    不碰页面共享 ticker（舞台那一份不受影响）。
				sharedTicker: false,
			});
			try { app.renderer.resize(width, height); } catch (error) { recordDiag({ at: "mountPixiPortrait", resize: messageOf(error) }); }

			const modelUrl = STAGE_ROUTE + "/models/" + modelName() + "/" + modelName() + ".model3.json";
			let model = null;
			try {
				model = await PIXI.live2d.Live2DModel.from(modelUrl, { autoInteract: false, autoUpdate: false });
			} catch (error) {
				try { app.destroy(false); } catch (ignored) { /* 销毁失败不掩盖真正的错 */ }
				throw new Error("从舞台路由装载模型失败（" + modelUrl + "）：" + messageOf(error));
			}
			portraitSources.model = modelUrl;

			// 缩放与落位：照舞台那份已经跑通的算法（`model.width/height` 在 pixi-live2d-display 里
			// **已经是缩放后**的显示尺寸，只能算一次 scale，不能拿它再乘一次）。
			const rawW = model.width || 300;
			const rawH = model.height || 400;
			const scale = Math.min(app.screen.width / rawW, app.screen.height / rawH) * 0.95;
			model.scale.set(scale);
			const drawW = model.width || rawW * scale;
			const drawH = model.height || rawH * scale;
			model.x = Math.max(0, (app.screen.width - drawW) / 2);
			model.y = Math.max(0, app.screen.height - drawH);
			app.stage.addChild(model);

			// 待机动作：模型自己的 model3.json **没有**声明 Idle 运动组（实测：Groups 里只有
			// EyeBlink 与 LipSync），所以这里把 idle 组名交给运动管理器（给上它，动作播完
			// 管理器就会自己再接一段 —— 库内 `shouldRequestIdleMotion()` → `startRandomMotion(groups.idle)`）。
			const motionManager = model.internalModel.motionManager;
			try { motionManager.groups.idle = "Idle"; } catch (error) { recordDiag({ at: "mountPixiPortrait", idleGroup: messageOf(error) }); }
			try { model.motion("Idle", 0); } catch (error) { recordDiag({ at: "mountPixiPortrait", idleMotion: messageOf(error) }); }

			let frames = 0;
			let paused = false;
			let lastFrameError = null;
			let frameErrors = 0;
			const ticker = app.ticker;
			ticker.maxFPS = PORTRAIT_FPS;
			const onTick = () => {
				try {
					model.update(ticker.deltaMS / 1000);
				} catch (error) {
					frameErrors += 1;
					lastFrameError = messageOf(error);
				}
				frames += 1;
			};
			ticker.add(onTick);
			ticker.start();

			const settings = model.internalModel === null || model.internalModel === undefined ? null : model.internalModel.settings;
			const expressions = settings === null || settings.expressions === null || settings.expressions === undefined ? [] : settings.expressions;
			const capability = {
				expressions: Array.isArray(expressions) ? expressions : [],
				lipSync: null,
				phaseExpression: null,
			};
			/**
			 * 待机模式下「表情」这一路的**如实回答**：面板不做实时驱动，所以任何引擎指令
			 * **都没有被应用**——`status` 写 `idle-only`，`note` 把原因说清（不静默、不假装成功）。
			 */
			const idleOnly = () => ({
				path: null, value: null, ok: false, status: "idle-only",
				note: "面板立绘走待机模式（D1：只播待机动作，不做实时驱动）→ 引擎给的表情指令这里**没有应用**；实时驱动在舞台",
				origin: null, emotion: null, turn: null, inferred: false,
				skippedLipSync: [], unknownIds: [], clamped: [], clampRange: null,
			});

			const disposed = { value: false };
			return {
				host: null,
				capability: capability,
				assets: { model3: null, modelDir: "models/" + modelName() + "/", modelFile: modelName() + ".model3.json" },
				/** 待机模式：相位只用来「把待机动作起起来」，不映射表情（D1）。 */
				applyPhase(state) {
					if (disposed.value) return;
					if (state !== null && state !== undefined && state.expressionIndex !== null) return;
					try { model.motion("Idle", 0); } catch (error) { recordDiag({ at: "applyPhase", idle: messageOf(error) }); }
				},
				applyExpression(plan) {
					return plan === null || plan === undefined ? null : idleOnly();
				},
				setChannel() { /* 待机模式没有嘴型通道（不喂文字 → 不动嘴） */ },
				startFeed() { /* 同上：面板不做实时驱动 */ },
				stopFeed() {},
				resetStats() {},
				readout() {
					let motionsAlive = 0;
					try {
						for (const list of Object.values(motionManager.motionGroups)) {
							for (const motion of list) if (motion !== null && motion !== undefined) motionsAlive += 1;
						}
					} catch (error) { recordDiag({ at: "readout", motions: messageOf(error) }); }
					return {
						channel: "idle",
						parameter: null,
						lipSyncSource: null,
						value: null,
						min: null,
						max: null,
						provider: 0,
						frames: frames,
						expression: null,
						expressions: capability.expressions.length,
						expressionApplied: idleOnly(),
						faceDriver: null,
						phaseExpression: null,
						phaseExpressionReported: false,
						feeding: false,
						frameErrors: frameErrors,
						lastFrameError: lastFrameError,
						motionsAlive: motionsAlive,
						motionsDropped: 0,
						/** 🔴 D1/D2：面板立绘这一档的**实际渲染档位**（验收读它，不靠猜）。 */
						mode: "pixi-idle",
						fps: PORTRAIT_FPS,
						paused: paused,
						tickerStarted: ticker.started === true,
					};
				},
				/** D2：暂停/恢复渲染（GPU 与 CPU 一起停；恢复时不清画面状态）。 */
				setPaused(next) {
					const want = next === true;
					if (paused === want) return;
					paused = want;
					try {
						if (want) ticker.stop();
						else ticker.start();
					} catch (error) { recordDiag({ at: "setPaused", message: messageOf(error) }); }
				},
				dispose() {
					if (disposed.value) return;
					disposed.value = true;
					try { ticker.remove(onTick); } catch (error) { recordDiag({ at: "dispose", ticker: messageOf(error) }); }
					try { ticker.stop(); } catch (error) { recordDiag({ at: "dispose", stop: messageOf(error) }); }
					try { if (model !== null) model.destroy(); } catch (error) { recordDiag({ at: "dispose", model: messageOf(error) }); }
					try { app.destroy(false); } catch (error) { recordDiag({ at: "dispose", app: messageOf(error) }); }
				},
			};
		}

		/**
		 * 装载一张立绘并起渲染循环（**本插件自带的 `live2d-host` 那条腿**）。
		 * @param options - {remote, sessionId, canvas, signal}
		 * @returns 引擎句柄：{host, capability, applyPhase, applyExpression, setChannel, startFeed, stopFeed, readout, setPaused, dispose}
		 */
		async function mountCustomPortrait(options) {
			const remote = options.remote;
			const sessionId = options.sessionId;
			const signal = options.signal;
			// 走到这里就意味着 `stageRuntime()` 已经判过"没有舞台"——本条腿一律按工作区字节通道取资源。
			const stage = false;
			await loadCore(remote, sessionId, signal);
			const framework = await loadFramework(remote, sessionId, signal);
			const assets = await assetsFor(remote, sessionId, signal, stage);

			// ── cdi3（DisplayInfo）：能力发现的「参数全集」来源；缺了也照常走三级回退，只标注原因 ──
			const displayName = assets.model3.FileReferences === undefined ? undefined : assets.model3.FileReferences.DisplayInfo;
			let displayInfo = null;
			let displayInfoMissingReason = "model3.json 未声明 FileReferences.DisplayInfo";
			if (typeof displayName === "string" && displayName.length > 0) {
				// cdi3 是**文本 JSON**：舞台装了走舞台路由，否则按来源链读（与模型同一条路子）。
				const rel = assets.modelDir + displayName;
				const bytes = stage === true
					? new Uint8Array(await (async () => {
						const response = await globalThis.fetch(STAGE_ROUTE + "/" + rel, { cache: "no-store" });
						if (!response.ok) throw new Error("HTTP " + String(response.status));
						return response.arrayBuffer();
					})())
					: await (async () => {
						const read = await readFirstAvailable(remote, sessionId, assetCandidates(rel), signal);
						if (!read.ok) throw new Error(read.failures.join("；"));
						return read.bytes;
					})();
				try {
					displayInfo = JSON.parse(decodeText(bytes));
					displayInfoMissingReason = null;
				} catch (error) {
					displayInfoMissingReason = "cdi3.json 不是合法 JSON：" + messageOf(error);
				}
			}
			const capability = framework.parseCapability(assets.model3, {
				modelId: modelName(),
				displayInfo: displayInfo,
				displayInfoMissingReason: displayInfoMissingReason,
			});

			const host = new framework.Live2DHost(options.canvas, { shaderBaseUrl: ASSET_SCHEME + SHADER_DIR });
			const restore = installAssetResolver(assets.urls);
			try {
				host.initGL();
				await host.load(ASSET_SCHEME + assets.modelDir + assets.modelFile);
				// 着色器是异步编译的（`cubismshader_webgl.ts:1092-1104` 的 generateShaders → registerShader）；
				// 在它完成前 drawModel 只打一行 warning 且**不画任何东西**，所以必须等。
				// 给 30 s：软件渲染（SwiftShader）下编译比真机慢得多。
				if (!(await host.waitForShaders(30000))) throw new Error("着色器 30 秒内未就绪（此时 drawModel 会静默不画）");
			} finally {
				restore();
			}

			// ── 两条通道：两个 provider 都由 live2d-host 提供，这里只做切换，不重写 ──
			const speakProvider = new framework.TextRhythmProvider();
			const writeProvider = new framework.WriteChannelProvider();
			let channel = "speak";
			host.setLipSyncProvider(speakProvider);

			const mouthParameter = capability.lipSync === undefined ? null : capability.lipSync.parameter;
			/**
			 * 归**嘴型通道**所有的参数 id：逐参数直驱时**一个都不许写**（两个写者会互相打架）。
			 * 取 `parameters`（官方解析器给的就是数组），拿不到再退回单数 `parameter`。
			 */
			const lipSyncIds = capability.lipSync === undefined
				? []
				: (Array.isArray(capability.lipSync.parameters) && capability.lipSync.parameters.length > 0
					? capability.lipSync.parameters
					: (capability.lipSync.parameter === null || capability.lipSync.parameter === undefined ? [] : [capability.lipSync.parameter]));
			/** 🔴 逐参数直驱的驱动器（路 B）；挂进 scheduler 的 late-update 段，见 §6.55 的两条坑。 */
			const faceDriver = createFaceDriver(host, { lipSyncIds: lipSyncIds });
			host.userModel.getUpdateScheduler().addUpdatableList(faceDriver.updater());
			/** 最近一次「应用表情」的结果（结构化；面板与验收都读它，**不靠猜**）。 */
			let expressionApplied = null;
			let expression = null;
			let frames = 0;
			let mouthValue = null;
			let mouthMin = null;
			let mouthMax = null;
			/** 逐帧错误计数与最近一次错误文案（**不静默**：面板读数里直接显示） */
			let frameErrors = 0;
			let lastFrameError = null;
			/** 被摘掉的「已释放动作」数量（见下面 recoverFrame 的说明） */
			let motionsDropped = 0;
			/**
			 * 「相位 → 表情」在本模型上不可用这件事**只报一次**（去重标志，避免每帧刷）。
			 * 见 `applyPhase` 里那段说明与 `live2d-host/README.md` §三。
			 */
			let phaseExpressionReported = false;

			let feedTimer = null;
			let raf = null;
			let lastTimestamp = 0;
			/** D2：当前是否暂停渲染（暂停时**不排 rAF**，帧计数不再增长）。 */
			let paused = false;
			/** D1：被 15fps 节流跳过的 rAF 次数（读数里显示，证明"节流真的在节流"）。 */
			let skipped = 0;

			const activeProvider = () => (channel === "write" ? writeProvider : speakProvider);

			/**
			 * 逐帧错误的**有界恢复**（不是重试、不是吞掉）。
			 *
			 * 🔴 背景（只读复用侧的一个既有缺陷，`live2d-host` 与官方框架，**本批不许改它**）：
			 *   `vendor/CubismWebFramework/src/motion/cubismmotion.ts:785` 逐字
			 *   `this._isLoop = false; // trueから false へデフォルトを変更`
			 *   —— 框架**无视** motion3.json 里的 `Meta.Loop: true`，所有动作都只播一遍；
			 *   播完 `cubismmotionqueuemanager.ts:274-277` 调 `motionQueueEntry.release()`
			 *   → `cubismmotionqueueentry.ts:38-42` 的 `ACubismMotion.delete(this._motion)`
			 *   → `cubismmotion.ts:801-804` 的 `release()` 把 `_motionData` 置 null。
			 *   而渲染宿主把动作对象**缓存在 `host.motionGroups` 里复用**
			 *   （`live2d-host/src/host.js:352-372` 的装载 + `:398-402` 的 `startRandomIdleMotion`），
			 *   于是**同一个对象被播完一次后再起一次**，就在
			 *   `cubismmotion.ts:437` 的 `this._motionData.duration` 上抛
			 *   `TypeError: Cannot read properties of null (reading 'duration')`。
			 *   ⚠️ 这条**不是本插件引入的**：`live2d-host/out/demo.html` 用官方 HTTP 静态服务
			 *   跑同一张模型会**一字不差地抛出同一个错误**（本批已复现，见报告 §已知缺陷）。
			 *
			 * 这里只做两件**最小**的事，且都记账：
			 *   ① 清空动作队列（否则坏对象卡在队列里，`step()` 每帧都抛 → 画面冻住）；
			 *   ② 把已释放（`_motionData` 为空）的动作从宿主缓存里摘掉，
			 *      免得 `startRandomIdleMotion()` 再次抽到它。
			 *   → 结果：立绘保持呼吸/眨眼/嘴型（它们各自是独立 updater），动作层降级，
			 *     面板读数里能看到 `帧错误 n` 与 `动作可用 n/m`，**不静默**。
			 */
			function recoverFrame() {
				try {
					host.userModel.getMotionManager().stopAllMotions();
				} catch (error) {
					// 清队列本身失败：仍然继续摘动作，并如实记账
					lastFrameError = messageOf(error);
				}
				for (const group of host.motionGroups) {
					const alive = group.motions.filter((motion) => motion !== null && motion !== undefined && motion._motionData !== null && motion._motionData !== undefined);
					motionsDropped += group.motions.length - alive.length;
					group.motions = alive;
					group.count = alive.length;
				}
			}

			/**
			 * 渲染循环（D1/D2）。
			 *
			 * D1 · **约 15fps**：rAF 照旧每帧回调（**不是删掉 rAF**），但只有距上一张画超过
			 *   `PORTRAIT_FRAME_MS` 才真的 `host.step(dt)`。`dt` 取**真实流逝时间**，
			 *   所以呼吸/眨眼/物理仍然按真实时间推进，只是每秒画 15 张。
			 * D2 · **暂停**：`paused` 为真时**不再排下一帧**（`raf = null`），CPU 与 GPU 都停；
			 *   `setPaused(false)` 重新排起来，并把 `lastTimestamp` 归零，避免恢复瞬间拿到一个巨大的 dt。
			 */
			const tick = (timestamp) => {
				if (paused) {
					raf = null;
					return;
				}
				raf = requestAnimationFrame(tick);
				if (lastTimestamp !== 0 && timestamp - lastTimestamp < PORTRAIT_FRAME_MS) {
					skipped += 1;
					return;
				}
				const dt = lastTimestamp === 0 ? 1 / PORTRAIT_FPS : Math.min((timestamp - lastTimestamp) / 1000, 0.1);
				lastTimestamp = timestamp;
				try {
					host.step(dt);
				} catch (error) {
					frameErrors += 1;
					lastFrameError = messageOf(error);
					recoverFrame();
				}
				frames += 1;
				if (mouthParameter !== null) {
					const value = host.readParameter(mouthParameter);
					if (value !== null) {
						mouthValue = value;
						mouthMin = mouthMin === null ? value : Math.min(mouthMin, value);
						mouthMax = mouthMax === null ? value : Math.max(mouthMax, value);
					}
				}
			};
			raf = requestAnimationFrame(tick);

			const stopFeed = () => {
				if (feedTimer !== null) {
					clearInterval(feedTimer);
					feedTimer = null;
				}
			};

			return {
				host: host,
				capability: capability,
				assets: assets,

				/** 按相位状态换表情 + 场景重设（讲次/相位变化＝一次重设，见研究_8 §5.2）。 */
				applyPhase(state) {
					if (state.expressionIndex === null) return;
					const expressions = capability.expressions;
					if (expressions.length === 0) {
						// 🔴 **改前**这里是光秃秃的一句 `return;`：换到「表达式个数 = 0」的立绘模型时，
						//    「相位 → 表情」**什么都不做、也不报任何提示**（静默失效；9 个候选模型里 5 个是 0 表情）。
						//    **改后**：只把"报过没有"这件事记一次（去重，不每帧刷），
						//    面板据宿主给的 `capability.phaseExpression` 在讲台区渲染一条**常显提示**（见 §6.5）。
						// 🔴 判据别写歪：**只有 0 个才算不可用**；1–5 个是「可用但下标回绕」（partial），不报失效。
						phaseExpressionReported = true;
						return;
					}
					const picked = expressions[state.expressionIndex % expressions.length];
					if (host.startExpression(picked.name)) {
						expression = picked.name;
						host.startRandomIdleMotion();
					}
				},

				/**
				 * 🔴 把引擎给的表情指令**真的写到脸上**（EXPR-3 的主体）。
				 *
				 * 三条并列的手段各自怎么落地：
				 *   · `named-expression` → `host.startExpression(名字)`（**先探测**：未命中返回 false）；
				 *   · `face-parameters`  → 逐参数直驱（驱动器在 `onLateUpdate` 里每帧写）；
				 *   · `motion`           → `host.startMotion(组名, 0, 1)`（**取下标 0**，确定性、可复现）；
				 *   · `path` 为 null     → **什么都不做，但必须说清**（`note` 里给出原因，面板常显）。
				 *
				 * 每次调用都会把**上一条路的残留收掉**：不是本路的驱动一律 `setTargets(null)`
				 * （目标归 0 → 插值淡出 → 停手），否则上一张脸会一直挂在脸上。
				 *
				 * @param plan - `expressionPlan()` 的产物；传 null ＝只做收尾
				 * @returns 结构化结果（`{path, value, ok, status, note, ...}`）
				 */
				applyExpression(plan) {
					const result = {
						path: null, value: null, ok: false, status: "none", note: null,
						origin: null, emotion: null, turn: null, inferred: false,
						skippedLipSync: [], unknownIds: [], clamped: [], clampRange: null,
					};
					if (plan === null || plan === undefined) {
						faceDriver.setTargets(null);
						expression = null;
						expressionApplied = result;
						return result;
					}
					const parsed = plan.parsed === null || plan.parsed === undefined ? null : plan.parsed;
					result.origin = parsed === null ? null : parsed.origin;
					result.emotion = parsed === null ? null : parsed.emotion;
					result.turn = parsed === null ? null : parsed.turn;
					result.inferred = plan.inferred === true;
					result.path = plan.path;

					if (plan.path === null) {
						// 三种手段都没有 → **明说不可用**（任务书：不许静默、不许什么都不做就完事）
						result.status = "unavailable";
						result.note = plan.reason;
						faceDriver.setTargets(null);
						expression = null;
						expressionApplied = result;
						return result;
					}

					if (plan.path === "named-expression") {
						// 纪律 ①：**先探测再调用**。宿主把探测内建在 `startExpression` 里（未命中返回 false），
						// 所以这里不需要再去翻 internalModel。
						if (host.startExpression(plan.value)) {
							result.ok = true;
							result.status = "named-expression";
							result.value = plan.value;
							expression = plan.value;
						} else {
							// 🔴 返回 false **不重试**，并在面板上说清是哪个名字没注册
							result.status = "named-missing";
							result.value = plan.value;
							result.note = "模型 " + modelName() + " 没有注册名为 " + plan.value + " 的表情"
								+ "（startExpression 返回 false）→ 不重试，画面不动";
							expression = null;
						}
						faceDriver.setTargets(null);
					} else if (plan.path === "face-parameters") {
						faceDriver.setTargets(plan.value);
						const stats = faceDriver.readout();
						result.status = "face-parameters";
						result.value = plan.value;
						result.ok = stats.written > 0;
						result.skippedLipSync = stats.skippedLipSync;
						result.unknownIds = stats.unknownIds;
						result.clamped = stats.clamped;
						result.clampRange = stats.clampRange;
						expression = null;
						const notes = [];
						if (stats.clampRange === "unavailable") {
							notes.push("本渲染宿主没有暴露参数值域（框架的 getParameterMinimumValue / getParameterMaximumValue 缺失）→ 这次**没有夹取**，越界值原样交给模型");
						}
						if (stats.clamped.length > 0) {
							// 🔴 EXPR-5：**夹取不许静默**。老师要的值超出该参数在模型里的真实值域 →
							//    按边界夹取（框架本来也会夹，但一声不响），这里把"要多少 → 实际多少 → 值域"逐条说出来。
							notes.push("夹取到模型值域：" + stats.clamped
								.map((entry) => entry.id + " " + String(entry.requested) + " → " + String(entry.applied)
									+ "（本模型值域 " + String(entry.min) + "…" + String(entry.max) + "）")
								.join("、"));
						}
						if (stats.skippedLipSync.length > 0) {
							notes.push("跳过了嘴型通道的参数 " + stats.skippedLipSync.join("、") + "（嘴型与表情不许抢同一个参数）");
						}
						if (stats.unknownIds.length > 0) {
							// 🔴 参数名可能是驼峰（Haru）也可能是全大写蛇形（官方 Miku）——**客户端不做形状变换**，
							//    只把"模型里同形状的是谁"作为提示说出来（见 `parameterShape`）。
							const hints = stats.shapeHints.map((hint) => hint.id + "（模型里叫 " + hint.modelId + "，只是命名形状不同）");
							const plain = stats.unknownIds.filter((id) => !stats.shapeHints.some((hint) => hint.id === id));
							notes.push("模型 " + modelName() + " 里没有这些参数：" + plain.concat(hints).join("、") + "（不写）");
						}
						if (!result.ok) notes.push("一个参数都没写进去 → 画面不动（这条路这次等于没生效）");
						result.note = notes.length === 0 ? null : notes.join("；");
					} else if (plan.path === "motion") {
						// 动作组：**取下标 0**（组内第几个由引擎指定不了，取 0 才是确定性的）
						if (host.startMotion(plan.value, 0, 1)) {
							result.ok = true;
							result.status = "motion";
							result.value = plan.value;
							expression = null;
						} else {
							result.status = "motion-missing";
							result.value = plan.value;
							result.note = "模型 " + modelName() + " 没有动作组 " + plan.value
								+ "（或该组没有第 0 个动作）→ 不重试，画面不动";
							expression = null;
						}
						faceDriver.setTargets(null);
					}

					expressionApplied = result;
					return result;
				},

				/** 切嘴型通道（`speak` = 文字节奏；`write` = 恒 0，嘴不动）。 */
				setChannel(next) {
					channel = next;
					host.setLipSyncProvider(activeProvider());
				},

				/**
				 * 喂一段文字：逐字推进（模拟流式 `text-delta`），间隔 60 ms。
				 * `loop` 为真时循环喂，直到 `stopFeed()` —— 用于把「嘴在动」稳定地截进图里。
				 */
				startFeed(text, loop) {
					stopFeed();
					if (typeof text !== "string" || text.length === 0) return;
					const chunks = Array.from(text);
					let index = 0;
					const push = () => {
						activeProvider().pushText(chunks[index]);
						index += 1;
						if (index >= chunks.length) {
							if (loop !== true) {
								stopFeed();
								return;
							}
							index = 0;
						}
					};
					push();
					feedTimer = setInterval(push, 60);
				},

				stopFeed: stopFeed,

				/** 清掉嘴参数的极值统计（换通道/换相位后重新看）。 */
				resetStats() {
					mouthMin = null;
					mouthMax = null;
				},

				/** 诊断读数（面板每 250 ms 取一次）。 */
				readout() {
					let motionsAlive = 0;
					for (const group of host.motionGroups) motionsAlive += group.motions.length;
					return {
						channel: channel,
						parameter: mouthParameter,
						lipSyncSource: capability.lipSync === undefined ? null : capability.lipSync.source,
						value: mouthValue,
						min: mouthMin,
						max: mouthMax,
						provider: activeProvider().getParameter(),
						frames: frames,
						expression: expression,
						expressions: capability.expressions.length,
						/** 🔴 EXPR-3：最近一次「应用表情」的结构化结果（面板与验收读它，不靠猜）。 */
						expressionApplied: expressionApplied,
						/** 🔴 EXPR-3：逐参数驱动器的实时状态（写了几个参数、跳过了哪些嘴参数）。 */
						faceDriver: faceDriver.readout(),
						// 🔴 宿主能力发现里那条判据（**原样透传，不重新解析、不自己猜**）：
						//    `{ available, expressionCount, expressionNames, status: 'ok'|'partial'|'unavailable', detail }`
						//    （出处 `live2d-host/src/capability.js`，说明见 live2d-host/README.md §三）。
						phaseExpression: capability.phaseExpression === undefined ? null : capability.phaseExpression,
						/** 「相位→表情不可用」这件事本模型是否已经报过（去重标志）。 */
						phaseExpressionReported: phaseExpressionReported,
						feeding: feedTimer !== null,
						frameErrors: frameErrors,
						lastFrameError: lastFrameError,
						motionsAlive: motionsAlive,
						motionsDropped: motionsDropped,
						/** 🔴 D1/D2：本条腿的实际渲染档位（与 PIXI 那条腿**同一个键**，验收读它不靠猜）。 */
						mode: "live2d-host-idle",
						fps: PORTRAIT_FPS,
						paused: paused,
						skipped: skipped,
						idleOnly: PORTRAIT_IDLE_ONLY,
					};
				},

				/**
				 * D2：暂停/恢复渲染。
				 * 暂停＝**取消已排的那一帧**并且不再排（`raf = null`）；恢复＝重新排一帧并把时间基准归零
				 * （不归零会在恢复的那一帧拿到一个从暂停前算起的巨大 dt，`host.step` 一步跳过去 → 画面跳一下）。
				 */
				setPaused(next) {
					const want = next === true;
					if (paused === want) return;
					paused = want;
					if (want) {
						if (raf !== null) cancelAnimationFrame(raf);
						raf = null;
						return;
					}
					lastTimestamp = 0;
					if (raf === null) raf = requestAnimationFrame(tick);
				},

				dispose() {
					stopFeed();
					if (raf !== null) cancelAnimationFrame(raf);
					raf = null;
					const gl = host.gl;
					if (gl !== null && gl !== undefined && typeof gl.getExtension === "function") {
						const lose = gl.getExtension("WEBGL_lose_context");
						if (lose !== null && lose !== undefined) lose.loseContext();
					}
				},
			};
		}

		// ════════════════════════════════════════════════════════════════════
		// 6.7 · 板书图（T3）：把 `classroom_draw` 画的那张图**画在消息流里**
		//
		// 这一节只做三件事，每一件都独立可测：
		//   ① `parseDrawArgs` —— 纯函数：从工具调用的入参里取出**完整 mermaid 源码**；
		//   ② `loadMermaid` / `renderDiagram` —— 装载产物并真渲染（唯一有 IO 的部分）；
		//   ③ `ClassroomDrawView` —— 挂到官方 keyed 槽位 `tool.call.toolview` 的组件。
		//
		// 🔴 为什么源码从**入参**拿，而不是从工具结果拿：
		//    `classroom_draw` 的 `render()` 返回的是一句**人读中文摘要**（逐字取自
		//    `plugins/socratic-engine/index.mjs:479-489`）：
		//      「板书图已落盘：diagrams/L01-T01-….mmd（flowchart → flowchart-v2｜3 行 / 41 B）｜…」
		//    —— 里面**没有** mermaid 源码。而 `tool/call` 事件的 `arguments` 是**完整入参 JSON**，
		//    `source` 字段就是逐字的 mermaid 正文（服务端 schema 已校验过 ≤20000 字符、无围栏、
		//    首行关键字与 kind 对得上、且已过 mermaid.parse）。
		//    → 客户端**不需要服务端任何配合**就能拿到渲染所需的全部字节。
		// ════════════════════════════════════════════════════════════════════

		/** 源码在图上/卡片里的显示上限（只是**显示**上限，渲染用全文；不截断渲染输入）。 */
		const SOURCE_PREVIEW_LIMIT = 4000;

		/**
		 * 从 `classroom_draw` 的入参 JSON 里取出画图所需字段。
		 *
		 * 容错口径（**不抛错、不编造**）：入参不是合法 JSON／字段类型不对 → 返回 `ok:false`
		 * 并带一句人读原因，由组件降级显示（而不是白屏，也不是假装画出来了）。
		 * `source` 为空同样算失败——**一张没有源码的图不该被"画"成空白**。
		 * @param argsRaw - 工具调用的原始入参字符串（`block.argsRaw`）
		 * @returns {ok, reason, kind, source, title, caption}
		 */
		function parseDrawArgs(argsRaw) {
			if (typeof argsRaw !== "string" || argsRaw.trim() === "") {
				return { ok: false, reason: "这次调用没有可读的入参（argsRaw 为空）", kind: null, source: null, title: null, caption: null };
			}
			let parsed;
			try {
				parsed = JSON.parse(argsRaw);
			} catch (error) {
				return { ok: false, reason: "入参不是合法 JSON：" + messageOf(error), kind: null, source: null, title: null, caption: null };
			}
			if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
				return { ok: false, reason: "入参 JSON 不是对象", kind: null, source: null, title: null, caption: null };
			}
			const source = typeof parsed.source === "string" ? parsed.source : "";
			if (source.trim() === "") {
				return { ok: false, reason: "入参里没有 `source`（或为空）：没有源码就画不出图", kind: null, source: null, title: null, caption: null };
			}
			return {
				ok: true,
				reason: null,
				kind: typeof parsed.kind === "string" ? parsed.kind : null,
				source: source,
				title: typeof parsed.title === "string" ? parsed.title : null,
				caption: typeof parsed.caption === "string" ? parsed.caption : null,
			};
		}

		/**
		 * 取 vendored mermaid 产物的工作区相对路径（去掉可能的尾斜杠）。
		 * 复用 `uiConfig()`，与 `live2dRoot()` 同一套配置面。
		 * @returns 工作区相对路径
		 */
		function mermaidBundlePath() {
			const value = mermaidPath();
			return value.endsWith("/") ? value.slice(0, -1) : value;
		}

		/**
		 * 装载 mermaid（**只装一次**，整页共享）。
		 *
		 * 通道（与 §6.5 装载 Cubism Core 同一条腿，见 README §资源通道）：
		 *   `workspaceFiles.readAll` 读字节 → `Uint8Array` → `Blob`（`text/javascript`）→
		 *   `URL.createObjectURL` → `<script src=objectURL>` → 执行完挂 `globalThis.mermaid`。
		 * 🔴 用 **IIFE 单文件**构建而不是 ESM 多文件构建：ESM 构建的入口用相对路径 import
		 *    若干 `./chunks/…`，而浏览器半边取资源只有 `readAll`（逐文件读字节），
		 *    没有"相对路径自动解析"这回事。理由与版本锚定见 `vendor/mermaid-11.17.2/BUILD-INFO.txt`。
		 * 🔴 产物**不从 CDN 取**：本插件跑在宿主页面里，取外网资源会把渲染成败押在网络上，
		 *    也让"画不出来"多一个不可复现的原因。产物随包走，工作区里就有。
		 * @param remote - 客户端 Remote 面（`ctx.remote`）
		 * @param sessionId - 会话 id（决定工作区根）
		 * @param signal - 取消信号
		 * @returns 装载好的 mermaid API（`globalThis.mermaid`）
		 */
		async function loadMermaid(remote, sessionId, signal) {
			if (mermaidReady !== null) return mermaidReady;
			mermaidReady = (async () => {
				const path = mermaidBundlePath();
				const bytes = await readBinary(remote, sessionId, path, signal);
				const url = URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
				try {
					await new Promise((resolve, reject) => {
						const script = document.createElement("script");
						script.src = url;
						script.addEventListener("load", () => { resolve(); }, { once: true });
						script.addEventListener("error", () => { reject(new Error("mermaid 产物脚本装载失败（<script src> 报 error）：" + path)); }, { once: true });
						document.head.appendChild(script);
					});
				} finally {
					URL.revokeObjectURL(url);
				}
				if (globalThis.mermaid === undefined || globalThis.mermaid === null) {
					throw new Error("mermaid 产物执行完却没有挂上 globalThis.mermaid（产物文件可能不是 IIFE 构建）：" + path);
				}
				// `startOnLoad:false` —— 不扫全页找 `.mermaid` 元素（那是给静态页用的）；
				// `securityLevel:'strict'` —— 与官方默认一致（渲染产物过 DOMPurify）。
				globalThis.mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
				return globalThis.mermaid;
			})();
			// 失败不缓存：下一次挂载还能重试（否则一次网络/读盘抖动会把整页永久钉在失败态）
			mermaidReady = mermaidReady.catch((error) => {
				mermaidReady = null;
				throw error;
			});
			return mermaidReady;
		}

		/** @returns 当前是否深色模式（官方主题层用 `body[data-ds-dark-theme]` 切整套变量）。 */
		function isDarkTheme() {
			return typeof document !== "undefined" && document.body !== null && document.body.hasAttribute(DARK_ATTRIBUTE);
		}

		/**
		 * 舞台是否正**铺满整屏**（D2 的第三个开关：舞台打开时面板暂停渲染）。
		 *
		 * 判据（只读 DOM，不改舞台任何状态）：舞台那个自建容器在，里面有一层真舞台，
		 * 且**不是关闭态**（关闭态那层带 `data-killed="on"`，此时舞台只是一条横幅，立绘不该因为
		 * 它而停）。舞台没装 / 已被 Ctrl+Shift+M 关掉 → `false`。
		 * @returns {boolean}
		 */
		function stageOverlayOpen() {
			if (typeof document === "undefined" || document === null) return false;
			const holder = document.getElementById === undefined ? null : document.getElementById(STAGE_OVERLAY_ID);
			if (holder === null || holder === undefined) return false;
			const live = holder.querySelector === undefined ? null : holder.querySelector("." + STAGE_OVERLAY_CLASS);
			if (live === null || live === undefined) return false;
			return live.getAttribute("data-killed") !== "on";
		}

		/**
		 * 主题名 → **交给 `mermaid.initialize()` 的配置对象**（**不是**主题名字符串）。
		 *
		 * 🔴 **返回值语义在 MERMAID-2 变了**：以前返回 `"neutral"` / `"dark"` 这种 mermaid 内置
		 *    主题名，现在返回一整份 `{theme:'base', themeVariables, themeCSS, flowchart…}`。
		 *    所以函数名从 `mermaidThemeFor` 改成 `mermaidInitConfigFor`——否则下一个人会以为它
		 *    还返回字符串，去写 `theme: mermaidInitConfigFor(x)`，图会直接画不出来。
		 *
		 * 🔴 这里**故意不放 `securityLevel`**：MERMAID-1 PoC 已实测 `themeCSS` 在
		 *    `securityLevel:'strict'` 下照样生效（`rectRx=8px` / `rectFilter=none` /
		 *    `labelWeight=400`），所以**没有理由**为了主题把客户端的 DOMPurify 关掉。
		 *    （PoC 那份 `claudeMermaidConfig()` 里写的是 `'loose'`，那是 PoC 页自己的环境；
		 *     接进客户端时**不跟**，`securityLevel` / `startOnLoad` 由调用点显式钉死。）
		 *
		 * 每次调用返回**新对象**（含新的 `themeVariables`）：`initialize` 内部会对配置做加工，
		 * 共享同一个对象有被写脏的风险；这份配置每张图只构造一次，成本可忽略。
		 * @param themeName - `'light'` / `'dark'`（其它值一律当浅色，不抛错）
		 * @returns mermaid `initialize` 配置
		 */
		function mermaidInitConfigFor(themeName) {
			const dark = themeName === "dark";
			return {
				// 🔴 必须 base：只有 base 主题会**完整**吃 themeVariables；用 default/forest/neutral/dark
				//    时一部分变量会被该主题自己的 getThemeVariables() 覆盖掉（PoC 实测坑 #1）。
				theme: "base",
				themeVariables: Object.assign({}, dark ? CLAUDE_MERMAID_DARK : CLAUDE_MERMAID_LIGHT),
				themeCSS: CLAUDE_MERMAID_THEME_CSS,
				flowchart: { curve: "basis", padding: 14, nodeSpacing: 44, rankSpacing: 52, useMaxWidth: true, htmlLabels: true },
				sequence: { actorMargin: 56, boxMargin: 12, messageMargin: 38, mirrorActors: false, useMaxWidth: true },
				state: { useMaxWidth: true },
				class: { useMaxWidth: true },
				er: { useMaxWidth: true },
				gantt: { useMaxWidth: true },
				pie: { useMaxWidth: true },
			};
		}

		/**
		 * 订阅"深色模式是否变化"。
		 * 官方靠 body 属性切主题（`DARK_ATTRIBUTE`），所以观察 `document.body` 的属性即可；
		 * 返回取消订阅函数。没有 `MutationObserver`（老环境/测试替身）时退化成"不订阅"。
		 * @param onChange - 变化时回调
		 * @returns 取消订阅函数
		 */
		function watchDarkTheme(onChange) {
			if (typeof MutationObserver !== "function" || typeof document === "undefined" || document.body === null) {
				return () => {};
			}
			const observer = new MutationObserver(() => { onChange(); });
			observer.observe(document.body, { attributes: true, attributeFilter: [DARK_ATTRIBUTE] });
			return () => { observer.disconnect(); };
		}

		/**
		 * 真渲染一张图。
		 *
		 * 🔴 **`mermaid.render` 的第三个参数是「容器元素」，不是「选项对象」**（本批实测踩到，
		 * 定位过程见报告 §2.4）：写 `render(id, source, { theme: 'neutral' })` 时，mermaid 会把那个
		 * 普通对象当成 DOM 容器 → `d3.select(<普通对象>).append('div')` →
		 * `TypeError: Cannot read properties of undefined (reading 'createElementNS')`
		 * （栈：`appendDivSvgG` → `Object.render`）。**图形主题只能走 `initialize(...)`**——
		 * MERMAID-2 起这里喂的是一整份主题配置（`mermaidInitConfigFor`），不再是主题名字符串。
		 * 证据：同一页面里 `render(id, src)` = 画出 11111 字符 SVG；`render(id, src, {theme})` = 抛上面那个错。
		 *
		 * `initialize` 是幂等的配置覆盖，每次渲染前按当前主题重设一次即可（代价可忽略）。
		 * 返回 `{svg, bindFunctions}`；**非法源码会抛**（实测抛 `Parse error on line …`）→ 由调用方降级。
		 *
		 * 🔴 **`initialize` 与 `render` 必须成对串行**：`mermaid.initialize` 改的是**整页共享的一份配置**，
		 *    而它**不在** mermaid 自己的渲染队列里（`render` 内部才走 `executeQueue`）。同一轮里两张图
		 *    并发渲染时，A 的 `initialize(light)` 可能被 B 的 `initialize(dark)` 顶掉，于是 A 用错主题渲染，
		 *    而且**会被缓存**（缓存键是「主题＋源码」）→ 切回浅色还会拿到那张深色的图。
		 *    所以这里用一个 Promise 链把「设主题 → 渲染」这一对串起来（`renderChain`）。
		 * @param mermaid - `globalThis.mermaid`
		 * @param source - 完整 mermaid 源码
		 * @param themeName - `'light'` / `'dark'`
		 * @returns {svg, ms}
		 */
		function renderDiagram(mermaid, source, themeName) {
			const run = async () => {
				const started = Date.now();
				const id = "classroom-ui-diagram-" + String(diagramRenderSeq++);
				try {
					// 🔴 主题配置**整份展开**进来（MERMAID-2），但 `startOnLoad` / `securityLevel`
					//    在展开**之后**写死 —— 顺序不能反：主题配置里没有这两项，可万一以后有人
					//    往主题配置里加了 `securityLevel`，这里的顺序能保证客户端的等级不被主题顶掉。
					mermaid.initialize(Object.assign(
						{},
						mermaidInitConfigFor(themeName),
						{ startOnLoad: false, securityLevel: "strict" },
					));
					const result = await mermaid.render(id, source);
					recordDiag({ at: "renderDiagram", ok: true, ms: Date.now() - started, svgChars: result.svg.length });
					return { svg: result.svg, ms: Date.now() - started };
				} catch (error) {
					recordRenderFailure(error, source);
					throw error;
				}
			};
			const next = renderChain.then(run, run);
			// 链本身永不 reject（否则一次失败会把后面所有渲染一起带崩）；失败只由 `next` 的调用方看到。
			renderChain = next.then(() => {}, () => {});
			return next;
		}

		/**
		 * 带缓存的渲染。缓存键＝「**主题版本号** ＋ 主题名 ＋ 源码」：同一张图在消息流里出现两次
		 * （比如重放/换主题再切回来）不重复渲染；**失败结果不进缓存**（下次挂载重试，不把一次抖动
		 * 钉成永久失败）。
		 *
		 * 🔴 **为什么键里必须有 `DIAGRAM_THEME_REV`**（MERMAID-2 加）：光有 `light`/`dark` 是不够的
		 *    —— 改了主题色值之后，主题名一个都没变，**旧缓存不会失效**，用户会继续看到旧配色，
		 *    而且看起来像"改了代码没生效"。所以每次调主题都要把 `DIAGRAM_THEME_REV` +1。
		 * @param options - {remote, sessionId, source, themeName, signal}
		 * @returns {svg, ms}
		 */
		function diagramFor(options) {
			const key = DIAGRAM_THEME_REV + "\u0000" + options.themeName + "\u0000" + options.source;
			const cached = diagramCache.get(key);
			if (cached !== undefined) return cached;
			const pending = (async () => {
				const mermaid = await loadMermaid(options.remote, options.sessionId, options.signal);
				return renderDiagram(mermaid, options.source, options.themeName);
			})();
			diagramCache.set(key, pending);
			pending.catch(() => { diagramCache.delete(key); });
			return pending;
		}

		// ── 6.8 · 板书图动画：渲染完成后「逐层长出」（MERMAID-2 接入，候选 B）──────────
		// 来源：`research/mermaid-pretty/claude-mermaid-anim.mjs` 的 `animateStagger`
		// （MERMAID-1 PoC 产物，**整段抄进来**；候选 C 的 `streamRender` **不抄** —— 本轮不做 C）。
		//
		// 🔴 **为什么动画必须发生在挂载之后、而不能放进 `renderDiagram`**：
		//    `renderDiagram` 返回的是 **SVG 字符串**（没有 DOM），而这里要用的 `getBBox()` /
		//    `getTotalLength()` / `getComputedStyle()` 都**要求元素已经在文档里**。
		//    → 动画只能由组件在 `dangerouslySetInnerHTML` 之后调（见 `ClassroomDrawView` 的 effect）。

		const SVG_NS = "http://www.w3.org/2000/svg";

		/**
		 * 会被「当作一个整体」逐层出现的元素。
		 * 🔴 **不要放 `g.label`**：mermaid 11 里节点内部和边标签内部都有 `g.label`，
		 *    收进来会把单元数算成两倍（PoC 实测：20 节点的图数出 44 个单元）。
		 */
		const ANIM_UNIT_SELECTORS = [
			"g.node",
			"g.cluster",
			"g.statediagram-cluster",
			"g.classGroup",
			"g.er.entityBox",
			"g.actor",
			"rect.actor",
			"text.actor",
			"g.note",
			"rect.note",
			"text.noteText",
			"g.task",
			"g.section",
			"g.stateGroup",
			"g.mindmap-node",
			"g.pieCircle",
			"g.commit",
		];

		/**
		 * 会被「画出来」的连线。
		 * 🔴 时序图的消息线在 11.17.2 里是 `<line class="messageLine0">`，**不是 `<path>`**。
		 * 🔴 生命线 `line.actor-line` 不在此列：它纵贯整张图，按 y 分层会算错，
		 *    让它保持常显（结构线，不动反而干净）。
		 */
		const ANIM_EDGE_SELECTORS = [
			"path.flowchart-link",
			"path.transition",
			"path.relation",
			"line.messageLine0",
			"line.messageLine1",
			"path.messageLine0",
			"path.messageLine1",
			"path.er.relationshipLine",
			"path.section-edge",
			".edgePaths path",
			"path.edge-thickness-normal",
			"path.edge-thickness-thick",
			"path.edge-thickness-invisible",
		];

		/** 边上的文字标签（跟着它那条线一起出现，不单独抢镜）。 */
		const ANIM_EDGE_LABEL_SELECTORS = ["g.edgeLabel", "g.edgeLabels > g", "text.edgeLabel", "text.messageText"];

		/** 按选择器列表收集元素，并去掉「已被更外层单元收走」的后代（不重复收）。 */
		function animQuery(root, selectors) {
			const out = [];
			const seen = new Set();
			for (const selector of selectors) {
				for (const el of root.querySelectorAll(selector)) {
					if (seen.has(el)) continue;
					if (out.some((parent) => parent.contains(el))) continue;
					seen.add(el);
					out.push(el);
				}
			}
			return out;
		}

		/** 元素在 SVG 用户坐标系里的中心点（`getBBox` 是元素自身坐标系，要过 CTM 映射）。 */
		function animCenterOf(el) {
			try {
				const box = el.getBBox();
				if (box.width === 0 && box.height === 0) return null;
				const svg = el.ownerSVGElement;
				const ctm = el.getCTM();
				if (!svg || !ctm) return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
				const point = svg.createSVGPoint();
				point.x = box.x + box.width / 2;
				point.y = box.y + box.height / 2;
				const mapped = point.matrixTransform(ctm);
				return { x: mapped.x, y: mapped.y };
			} catch {
				return null;
			}
		}

		/** 整张图的主轴：flowchart 按长宽比判方向，其它图一律纵向（自上而下读）。 */
		function animPickAxis(svg, kind) {
			if (!/^(flowchart|graph)/i.test(kind || "")) return "y";
			const box = svg.viewBox && svg.viewBox.baseVal;
			const width = (box && box.width) || svg.clientWidth || 1;
			const height = (box && box.height) || svg.clientHeight || 1;
			return height >= width ? "y" : "x";
		}

		/** 按主轴位置把元素装桶分层（容差 18px）。桶序号就是层号。 */
		function animLayerize(els, axis) {
			const items = [];
			for (const el of els) {
				const center = animCenterOf(el);
				if (center === null) continue;
				items.push({ el: el, pos: axis === "x" ? center.x : center.y });
			}
			items.sort((a, b) => a.pos - b.pos);
			let layer = -1;
			let last = -Infinity;
			for (const item of items) {
				if (item.pos - last > 18) {
					layer += 1;
					last = item.pos;
				}
				item.layer = layer;
			}
			return items;
		}

		/**
		 * 候选 B：渲染完成后**逐层出现** ＋ 连线画出来。
		 *
		 * 算法（不解析源码，从渲染结果量位置推层号）：量整张 svg 的 viewBox 定主轴 → 单元按主轴
		 * 坐标装桶（容差 18px），桶序号＝层号 → 层数超过 `maxSteps` 时相邻层并成一步 → 节点先
		 * `opacity:0`、轮到自己那层再进场；连线用 `stroke-dasharray/offset` 从 L→0「画出来」
		 * （本身是虚线的退回淡入，不破坏虚线语义）。
		 *
		 * 🔴 **坑 1（必读）：进场动画只许用独立变换属性 `translate` / `scale`，绝不能用 `transform`。**
		 *    mermaid 把节点位置写成 `<g class="node" transform="translate(x,y)">`，而 **CSS 的
		 *    `transform` 属性会整体覆盖这个呈现属性** → 动画期间节点全部跳到画布原点、图散架
		 *    （PoC 第一版录的 GIF 就是这个 bug）。`translate`/`scale` 是**独立属性**，按规范排在
		 *    `transform` 之后复合，能叠在原有的 `translate(x,y)` 上，位置不丢。
		 *    实测（PoC）：动画期间每个节点的 `getBoundingClientRect()` 与终态**完全一致**。
		 *
		 * 🔴 **坑 2：总时长必须真的封得住——只压步间隔不够，得先把层合并。**
		 *    链式流程图（N0→N1→…→N159）层数≈节点数（211 层），固定 130ms/层 = 27 秒；
		 *    只加 `maxTotal` 预算、靠 `max(24, budget/层数)` 压间隔也不行 —— 那个 24ms 下限会把预算
		 *    捅穿（PoC 实测 160 节点仍要 5.96 s）。所以**两步一起做**：① 层合并成至多 `maxSteps` 步；
		 *    ② 再把步间隔压进 `maxTotal` 预算。这样 20 节点及以上一律落在 2600 ms 附近。
		 *
		 * @param svg - `mermaid.render` 出来的 `<svg>`（**必须在文档里**）
		 * @param opts - {kind, maxTotal, maxSteps}
		 * @returns {{total, layerDelay, units, edges, rawLayers, layers, play, finish, cancel}}
		 */
		function animateStagger(svg, opts) {
			const options = opts === undefined || opts === null ? {} : opts;
			const kind = typeof options.kind === "string" ? options.kind : "";
			const layerDelayIn = typeof options.layerDelay === "number" ? options.layerDelay : 130;
			const enterDur = typeof options.enterDur === "number" ? options.enterDur : 460;
			const edgeDur = typeof options.edgeDur === "number" ? options.edgeDur : 340;
			const edgeDelay = typeof options.edgeDelay === "number" ? options.edgeDelay : 120;
			const edgeDraw = options.edgeDraw !== false;
			const maxTotal = typeof options.maxTotal === "number" ? options.maxTotal : 2600;
			const maxSteps = Math.max(2, typeof options.maxSteps === "number" ? options.maxSteps : 26);

			const axis = animPickAxis(svg, kind);
			const units = animQuery(svg, ANIM_UNIT_SELECTORS);
			const edges = animQuery(svg, ANIM_EDGE_SELECTORS);
			const edgeLabels = animQuery(svg, ANIM_EDGE_LABEL_SELECTORS);

			const unitLayers = animLayerize(units, axis);
			const edgeLayers = animLayerize(edges, axis);
			const rawMaxLayer = Math.max(0, ...unitLayers.map((u) => u.layer), ...edgeLayers.map((e) => e.layer));

			// ① 层合并（长图里相邻几层并成一步）——见坑 2
			const layerCount = rawMaxLayer + 1;
			const group = Math.max(1, Math.ceil(layerCount / maxSteps));
			for (const list of [unitLayers, edgeLayers]) {
				for (const item of list) item.layer = Math.floor(item.layer / group);
			}
			const maxLayer = Math.max(0, ...unitLayers.map((u) => u.layer), ...edgeLayers.map((e) => e.layer));
			const stepCount = maxLayer + 1;

			// ② 把步间隔压进预算
			const budget = Math.max(600, maxTotal - edgeDelay - edgeDur - enterDur);
			const layerDelay = Math.min(layerDelayIn, Math.max(24, budget / Math.max(1, stepCount - 1)));

			const style = document.createElementNS(SVG_NS, "style");
			style.textContent = [
				".cui-draw-hidden { opacity: 0; }",
				// 🔴 坑 1：进场只许用独立变换属性 translate / scale（不能用 transform，见上）
				".cui-draw-enter { transform-box: fill-box; transform-origin: center; animation: cui-draw-enter " + String(enterDur) + "ms cubic-bezier(.22,.9,.24,1) both; }",
				"@keyframes cui-draw-enter { from { opacity: 0; translate: 0 5px; scale: .985; } to { opacity: 1; translate: 0 0; scale: 1; } }",
				// 用户在系统里要求"少动"→ 整段关掉（动画是装饰，不是信息）
				"@media (prefers-reduced-motion: reduce) { .cui-draw-enter { animation: none; opacity: 1; } .cui-draw-draw { transition: none !important; stroke-dashoffset: 0 !important; } }",
			].join("\n");
			svg.appendChild(style);

			// ── 节点：先藏起来，等轮到它那层再进场 ──
			for (const item of unitLayers) {
				item.el.classList.add("cui-draw-hidden");
			}

			// ── 连线：能「画出」的用 dashoffset；本身是虚线（如时序图回信）的退回淡入 ──
			const draws = [];
			for (const item of edgeLayers) {
				item.el.classList.add("cui-draw-hidden");
				if (!edgeDraw) continue;
				let length = 0;
				try {
					length = item.el.getTotalLength();
				} catch {
					length = 0;
				}
				if (!length || length < 4) continue;
				const computed = getComputedStyle(item.el);
				if (computed.strokeDasharray && computed.strokeDasharray !== "none") continue;
				item.el.style.strokeDasharray = String(length);
				item.el.style.strokeDashoffset = String(length);
				item.el.style.transition = "stroke-dashoffset " + String(edgeDur) + "ms cubic-bezier(.3,.7,.3,1)";
				draws.push({ el: item.el, delay: item.layer * layerDelay + edgeDelay });
			}

			const edgeLabelLayers = animLayerize(edgeLabels, axis);
			for (const item of edgeLabelLayers) {
				item.layer = Math.floor(item.layer / group);
				item.el.classList.add("cui-draw-hidden");
			}

			const total = maxLayer * layerDelay + edgeDelay + edgeDur + enterDur;
			const all = [...units, ...edges, ...edgeLabels];
			let timers = [];
			let frame = null;

			/** 取消定时器并**把所有元素还原成终态**（动画中断也不许留一半藏着的元素）。 */
			function finish() {
				for (const timer of timers) clearTimeout(timer);
				timers = [];
				if (frame !== null) cancelAnimationFrame(frame);
				frame = null;
				for (const el of all) {
					el.classList.remove("cui-draw-hidden");
					if (el.style && el.style.strokeDashoffset) el.style.strokeDashoffset = "0";
				}
			}

			/** 起跑。用 rAF 保证初始样式已经过一次 layout，transition 才会真的跑。 */
			function play() {
				return new Promise((resolve) => {
					frame = requestAnimationFrame(() => {
						for (const item of unitLayers) {
							timers.push(setTimeout(() => {
								item.el.classList.remove("cui-draw-hidden");
								item.el.classList.add("cui-draw-enter");
							}, item.layer * layerDelay));
						}
						for (const item of edgeLayers) {
							timers.push(setTimeout(() => item.el.classList.remove("cui-draw-hidden"), item.layer * layerDelay + edgeDelay));
						}
						for (const item of draws) {
							// +20ms：让「先出现」和「开始画」错开一帧，否则短边看起来是"闪"出来的
							timers.push(setTimeout(() => { item.el.style.strokeDashoffset = "0"; }, item.delay + 20));
						}
						for (const item of edgeLabelLayers) {
							timers.push(setTimeout(() => item.el.classList.remove("cui-draw-hidden"), item.layer * layerDelay + edgeDelay + edgeDur * 0.5));
						}
						timers.push(setTimeout(resolve, total));
					});
				});
			}

			return { total: total, layerDelay: layerDelay, units: units.length, edges: edges.length, rawLayers: layerCount, layers: stepCount, play: play, finish: finish, cancel: finish };
		}

		/**
		 * 动画开关（**客户端配置面**，与 `live2dRoot` / `mermaidPath` 同一手法）。
		 * `uiConfig().drawAnim` ∈ `"none"`（候选 A：只换主题，不装动画）｜`"stagger"`（候选 B：逐层长出）。
		 *
		 * 🔴 `"stream"`（候选 C：按源码边长）**本轮未接线** —— 我们的链路里 mermaid 源码是
		 *    `classroom_draw` 一次调用整体给出的，没有逐字流，而且 PoC 实测 160 节点要 81 秒。
		 *    所以 `"stream"` 与任何不认识的值一律落到默认档，并**记一条诊断**（不静默）——
		 *    「配了却没生效」是最难查的一类问题，必须留下痕迹。
		 * @returns `"none"` | `"stagger"`
		 */
		function drawAnimMode() {
			const configured = uiConfig().drawAnim;
			if (configured === "none" || configured === "stagger") return configured;
			if (configured !== undefined && configured !== null && configured !== "") {
				recordDiag({ at: "drawAnim", configured: String(configured), used: DRAW_ANIM_DEFAULT, note: configured === "stream" ? "候选 C（stream）本轮未接线" : "不认识的值" });
			}
			return DRAW_ANIM_DEFAULT;
		}

		/**
		 * 「这张图该不该重播进场动画」的**内容键**（EXPR-3 小修 ① 的判据）。
		 *
		 * 🔴 为什么不能拿 `state.svg` 当判据：切深浅色会**换掉整份 svg 字符串**（配色变量写进了 SVG），
		 *    于是"svg 变了就重播"会在用户切主题时**把整张图又长一遍**，观感像 bug。
		 *    内容键只由**图本身**决定（会话 ＋ 图类型 ＋ 源码），**不含任何主题信息**：
		 *      · 切主题 → 键不变 → 不重播；
		 *      · 换一条新图源／新会话 → 键变了 → 照常重播。
		 * @param sessionId - 会话 id
		 * @param kind - mermaid 图类型（`parsed.kind`）
		 * @param source - mermaid 源码
		 * @returns 字符串键
		 */
		function drawAnimKey(sessionId, kind, source) {
			return String(sessionId) + "\u0000" + String(kind) + "\u0000" + String(source);
		}

		// ════════════════════════════════════════════════════════════════════
		// 6.9 · 板书历史（W-p）：右栏「板书」tab 的**只读**数据层
		//
		// 真源＝`<教室>/runtime/diagrams/index.md`（**引擎在写**，见 `plugins/socratic-engine/lib/
		// diagramstore.mjs` 与 `diagram.mjs` 的 `renderIndexHeader/renderIndexRow`）。
		// 🔴 明确**不**用 `whiteboardStore`：那个服务端服务**没有任何写入者**（本仓库里 `whiteboard`
		//    在 lib/client.js 里 0 处命中），拿它当数据源只会得到一张永远空着的表。
		// 🔴 索引只给"有哪些图"；**图的内容**在对应的 `.mmd` 文件里，点开才读（省 IO，也符合
		//    "点开后渲染"这条验收）。
		// ════════════════════════════════════════════════════════════════════

		/**
		 * 把 markdown 表格的一行切成单元格（**认 `\|` 转义**）。
		 * 🔴 为什么不能 `line.split("|")`：引擎写标题/说明时会把 `|` 转义成 `\|`
		 *    （`diagram.mjs` 的 `cell()` 逐字 `text.replace(/\|/g, '\\|')`），
		 *    按裸 `|` 切会把一个标题切成两格、后面每一列都错位一格（静默错位，最难查）。
		 * @param line - 一行 markdown 表格（首尾都是 `|`）
		 * @returns 单元格文本数组（已 trim，首尾那两个空段去掉）
		 */
		function splitTableRow(line) {
			const cells = [];
			let current = "";
			for (let index = 0; index < line.length; index += 1) {
				const ch = line[index];
				if (ch === "\\" && line[index + 1] === "|") { current += "|"; index += 1; continue; }
				if (ch === "|") { cells.push(current); current = ""; continue; }
				current += ch;
			}
			cells.push(current);
			// 首尾各有一个空段（行首 `|` 之前、行尾 `|` 之后）
			return cells.slice(1, cells.length - 1).map((cell) => cell.trim());
		}

		/**
		 * 解析 `runtime/diagrams/index.md`（**纯函数**：只吃文本，测试直接喂字符串）。
		 *
		 * 🔴 **按表头名取列，不按固定列数/固定下标**（2026-10-20 的变更逼出来的硬要求）：
		 *    引擎给索引**加过一列**（末尾「会话」），表头从 7 列变 8 列。按列数/下标写死的解析器
		 *    会在那一刻**把每一行都判成"列数对不上"然后整张表变空** —— 而且不报错。
		 *    所以：先用「含『源文件』那一行」认出表头、建成 `列名 → 下标` 的表，数据行按名字取。
		 *    以后再加列，这里一行都不用改。
		 *
		 * 已知的列（**只有「源文件」是必需的**，其余缺了降级而不是报错）：
		 *   `日期 | 讲次 | 回合 | 图类型 | 标题 | 说明 | 源文件 | 会话`
		 *   · `会话` 是后加的，老索引里没有 → `session: null`（**不等于"不属于本会话"**，见 `BoardHistory` 的标注规则）；
		 *   · `讲次` 可能是 `—`（引擎在"没有讲次门"时写它）→ `lesson: null`，**不填 0**。
		 *
		 * 输出**按时间倒序**（日期 `yyyy-MM-dd HH:mm` 可字典序比较，直接比字符串）；
		 * 时间相同再按回合倒序；还相同则"后追加的在前"（索引 append-only，越靠后越新）。
		 * @param text - 索引全文（读不到传 null/空串）
		 * @returns {{items: Array<object>, skipped: number, columns: string[], legacy: boolean}}
		 *          `legacy: true` ＝ 没认出表头，按**老版 7 列的位置**解析（降级路径，照样能用）。
		 */
		function parseDiagramIndex(text) {
			const items = [];
			let skipped = 0;
			const empty = { items: items, skipped: skipped, columns: [], legacy: false };
			if (typeof text !== "string" || text.trim() === "") return empty;

			/** 老版 7 列的位置（只有在**认不出表头**时才用；认得出就一律按名字取）。 */
			const LEGACY_COLUMNS = ["日期", "讲次", "回合", "图类型", "标题", "说明", "源文件"];
			let header = null;
			let legacy = false;

			const numberOrNull = (value, pattern) => (pattern.test(String(value).trim()) ? Number.parseInt(String(value).trim(), 10) : null);

			for (const rawLine of text.split("\n")) {
				const raw = rawLine.trim();
				if (!raw.startsWith("|") || !raw.endsWith("|")) continue;
				const cells = splitTableRow(raw);
				if (cells.length === 0) continue;
				// 分隔行：每一格都只是破折号（含对齐用的 `:--`）
				if (cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, "")))) continue;

				if (header === null && !legacy) {
					// 认表头：**含「源文件」那一行**。认不出就等到第一行数据时退回老版位置映射。
					if (cells.includes("源文件")) {
						header = new Map(cells.map((name, index) => [name, index]));
						continue;
					}
					if (cells.includes("日期")) continue;   // 表头缺「源文件」——不是本文件的表，继续找
					legacy = true;                          // 没表头：按老版 7 列位置解析（降级）
				}

				const columns = header === null ? LEGACY_COLUMNS : Array.from(header.keys());
				if (cells.length !== columns.length) { skipped += 1; continue; }
				const cellOf = (name) => {
					if (header === null) {
						const index = LEGACY_COLUMNS.indexOf(name);
						return index < 0 ? "" : cells[index];
					}
					const index = header.get(name);
					return index === undefined ? "" : cells[index];
				};

				const file = cellOf("源文件").replace(/`/g, "").trim();
				if (file === "") { skipped += 1; continue; }
				const lessonHit = cellOf("讲次").match(/(\d+)/);
				items.push({
					time: cellOf("日期"),
					lesson: lessonHit === null ? null : Number.parseInt(lessonHit[1], 10),
					turn: numberOrNull(cellOf("回合"), /^\d+$/),
					kind: cellOf("图类型"),
					title: cellOf("标题"),
					caption: cellOf("说明"),
					file: file,
					/** 🔴 后加的列：**没有这一列/留空 → null**（老记录）。不许当成"不属于本会话"。 */
					session: cellOf("会话") === "" ? null : cellOf("会话"),
					line: items.length + skipped + 1,
				});
			}

			items.sort((left, right) => {
				if (left.time !== right.time) return left.time < right.time ? 1 : -1;
				const lt = left.turn === null ? -1 : left.turn;
				const rt = right.turn === null ? -1 : right.turn;
				if (lt !== rt) return rt - lt;
				return right.line - left.line;
			});
			return {
				items: items,
				skipped: skipped,
				columns: header === null ? (legacy ? LEGACY_COLUMNS.slice() : []) : Array.from(header.keys()),
				legacy: legacy,
			};
		}

		/**
		 * 读索引并解析（**每次调用都真读盘** —— 页面刷新后仍能从磁盘重建，不依赖任何内存状态）。
		 * 索引不存在是**正常态**（这节课还没画过图）→ `items: []`、`error: null`。
		 * @returns {{items: Array<object>, skipped: number, path: string, error: string|null, exists: boolean}}
		 */
		async function loadDiagramHistory(remote, sessionId, signal) {
			const path = diagramsIndexPath();
			let text;
			try {
				text = await readText(remote, sessionId, path, signal);
			} catch (error) {
				// 文件不存在 = 还没画过图（**不是故障**）；其它错（权限/编码…）如实回给界面。
				// 判据：**先看结构化 error.code**（`workspace-file/not-found`），没有再退到文案
				// （老宿主/别的实现可能只给一句话）。没有这个区分，第一次开面板就会把"还没画过图"
				// 说成"读盘失败"——那是最容易被误当成事故的一类假告警。
				const message = messageOf(error);
				const byCode = error !== null && typeof error === "object" && typeof error.code === "string"
					? /not-found/i.test(error.code) : false;
				const missing = byCode || /not-found|not found|ENOENT|不存在/i.test(message);
				return { items: [], skipped: 0, path: path, error: missing ? null : message, exists: false };
			}
			const parsed = parseDiagramIndex(text);
			return { items: parsed.items, skipped: parsed.skipped, path: path, error: null, exists: true };
		}

		/**
		 * 读一张 `.mmd` 的**全文**（点开时才调用）。
		 * 路径由 `diagramPath(file)` 算，那里已做过词法拒绝（不许带 `/`、`..`）。
		 * @returns {{ok: boolean, source: string|null, error: string|null}}
		 */
		async function readDiagramSource(remote, sessionId, file, signal) {
			const path = diagramPath(file);
			if (path === null) return { ok: false, source: null, error: "索引里的源文件名不合法（只允许本目录里的文件名）：" + String(file) };
			try {
				return { ok: true, source: await readText(remote, sessionId, path, signal), error: null };
			} catch (error) {
				return { ok: false, source: null, error: messageOf(error) };
			}
		}

		// ════════════════════════════════════════════════════════════════════
		// 7 · 组件
		// ════════════════════════════════════════════════════════════════════

		/** 一行「标签｜值」。值为 null 时显示「未提供」，不编造。 */
		/**
		 * 一行「标签 ／ 取值」。
		 *
		 * 层级全靠 **标签（11px ＋ 0.18em 字距 ＋ 最浅一档字色）对 取值（正文档 ＋ 更重字色）**
		 * ——**没有一处加粗**（项目硬规矩：层级只能用字号·字距·字色阶梯·字面）。
		 * @param props.label - 标签（左侧固定宽）
		 * @param props.value - 取值（null/空 → 「未提供」并降到最浅一档，**不填默认值**）
		 * @param props.mono - 取值是否走等宽体（纯数字/路径用）
		 * @param props.hook - 写到 DOM 上的 `data-cui-field` 值（验收断言用；不给就不写）
		 */
		function Field(props) {
			const S = styles();
			const empty = props.value === null || props.value === undefined || props.value === "";
			const shown = empty ? "未提供" : props.value;
			const base = props.mono === true ? Object.assign({}, S.fieldValue, S.mono) : S.fieldValue;
			const style = empty ? Object.assign({}, base, { color: S.ink[4] }) : base;
			const attrs = { style: S.fieldRow };
			if (props.hook !== undefined) attrs["data-cui-field"] = props.hook;
			return React.createElement("div", attrs,
				React.createElement("span", { style: S.fieldLabel }, props.label),
				React.createElement("span", { style: style }, shown),
			);
		}

		/** 立绘舞台要的面（含 ctx 与 sessionId）；按 session 缓存，保证 props 身份稳定（不重复装载）。 */
		const portraitFaces = new Map();

		/**
		 * @param ctx - 客户端根 Context
		 * @param sessionId - 会话 id
		 * @returns {ctx, sessionId} —— 同一 session 永远拿到同一个对象
		 */
		function portraitFaceFor(ctx, sessionId) {
			let face = portraitFaces.get(sessionId);
			if (face === undefined) {
				face = { ctx: ctx, sessionId: sessionId };
				portraitFaces.set(sessionId, face);
			}
			return face;
		}

		/** 调试用的默认文字（自带标点，好让「标点强制闭嘴」也看得见）。 */
		const DEBUG_FEED_TEXT = "同学们先看这一段：进程被换出去以后，它的现场保存在哪里？想清楚再答。";

		/**
		 * 立绘舞台 ＋（仅在 `debug` 打开时出现的）相位/通道切换控件。
		 *
		 * 相位来源＝`props.phase`（即 `runtime/progress.md` 的 `current_phase:`；未提供为 null）。
		 * 调试控件只做两件事：把相位**临时覆盖**成某个值、把通道**临时覆盖**成 speak/write，
		 * 好把「相位 → 立绘状态」与「说话 ↔ 写字」两条接线演示出来；它不写任何文件。
		 */
		function PortraitStage(props) {
			const S = styles();
			const portrait = props.portrait;
			const debug = debugEnabled();
			const sessionKey = portrait === undefined ? null : portrait.sessionId;
			const portraitRef = React.useRef(portrait);
			portraitRef.current = portrait;

			const [debugPhase, setDebugPhase] = React.useState(null);
			const [debugChannel, setDebugChannel] = React.useState(null);
			const [status, setStatus] = React.useState({ kind: "idle", message: null });
			const [readout, setReadout] = React.useState(null);
			const [engineVersion, setEngineVersion] = React.useState(0);
			const [feedLoop, setFeedLoop] = React.useState(false);
			/** 🔴 D3 的退路：Live2D 用不了时顶上来的静态立绘图（`{kind:'ok'|'absent', url, message}`）。 */
			const [staticPortrait, setStaticPortrait] = React.useState({ kind: "idle", url: null, message: null });
			/**
			 * 🔴 本回合的表情：`runtime/expression.md` 的**正文**（null ＝ 文件还没被引擎写过）。
			 * 为什么面板要自己轮询这个文件、而不等 store 刷新：表情是老师在**回合中间**用工具决定的，
			 * 而 store 的刷新节奏是"回合边界／手动刷新"——等它就会**慢一个回合**
			 * （见 `实现报告_EXPR1_表情自主控制_2026-09-24.md` §6 步骤 4）。
			 */
			const [expressionText, setExpressionText] = React.useState(null);
			const canvasRef = React.useRef(null);
			const engineRef = React.useRef(null);

			const phase = debugPhase === null ? props.phase : debugPhase;
			const state = phaseStateOf(phase);
			const channel = debugChannel === null ? state.channel : debugChannel;
			const plan = expressionPlan(expressionText);
			const planKey = expressionKey(plan);

			// 装载 / 卸载：一个 canvas 一个渲染宿主；卸载时停循环并主动丢 WebGL 上下文。
			React.useEffect(() => {
				const canvas = canvasRef.current;
				const face = portraitRef.current;
				if (canvas === null || face === undefined || sessionKey === null) return undefined;
				const controller = new AbortController();
				let disposed = false;
				let engine = null;
				setStatus({ kind: "loading", message: null });
				// 🔴 EXPR-5：**先读部署声明，再装载模型**。理由：`modelName()` 的第二优先级就是声明里的
				//    `portraitModel`，而装载只在第一次取资源时解析模型名（缓存键含模型名）。
				//    不先读就会先用默认模型加载一遍、再换一次（画面闪一下，且"改一处模型名两侧生效"
				//    这条验收会看到两次装载）。读失败也照常往下走（`ensureDeclaration` 不抛，面板不阻塞）。
				ensureDeclaration(face.ctx.remote, face.sessionId)
					.then(() => mountPortrait({ remote: face.ctx.remote, sessionId: face.sessionId, canvas: canvas, signal: controller.signal }))
					.then((mounted) => {
						if (disposed) {
							mounted.dispose();
							return;
						}
						engine = mounted;
						engineRef.current = mounted;
						/**
						 * 🔴 只在 `debug` 打开时把引擎句柄挂到 canvas 上。
						 * 用途：**画面层取证**——取帧要在"冻结时间"下做（立绘有 idle 动画，
						 * 不冻结时两张图的差异无法归因给表情），而冻结只能从外面驱动宿主
						 * （`tools/expression-frozen-shots.cjs` 就是这么做的）。产品路径不读它。
						 */
						if (debug) canvas.__classroomUiEngine = mounted;
						setStatus({ kind: "ready", message: null });
						setEngineVersion((value) => value + 1);
					})
					.catch((error) => {
						if (disposed) return;
						/**
						 * 🔴 两种终态，别混（见 `mountPortrait` 里那段判据）：
						 *   · `absent` —— 本 profile **没有可用的 Live2D 源**（能力缺席，不是故障）；
						 *   · `failed` —— 有源但装载过程中坏了（这才是故障，照旧报「立绘装载失败：…」）。
						 */
						if (error !== null && typeof error === "object" && error.code === "portrait/no-source") {
							setStatus({
								kind: "absent",
								message: messageOf(error),
								cause: Array.isArray(error.causes) && error.causes.length > 0 ? error.causes[0] : null,
							});
							return;
						}
						setStatus({ kind: "failed", message: messageOf(error) });
					});
				return () => {
					disposed = true;
					controller.abort();
					if (canvas !== null && canvas.__classroomUiEngine !== undefined) delete canvas.__classroomUiEngine;
					engineRef.current = null;
					if (engine !== null) engine.dispose();
				};
			}, [sessionKey]);

			// 回合内重读 `runtime/expression.md`：**只有真的变了才重设**（否则每 400 ms 重起一次会把 idle 抖坏）。
			React.useEffect(() => {
				const face = portraitRef.current;
				if (face === undefined || sessionKey === null) return undefined;
				let live = true;
				const poll = () => {
					readText(face.ctx.remote, face.sessionId, classroomPath("expression"), undefined).then(
						(text) => { if (live) setExpressionText(text); },
						// 文件不存在是**正常态**（引擎本轮没写表情）→ 如实记 null，不报错
						() => { if (live) setExpressionText(null); },
					);
				};
				poll();
				const timer = setInterval(poll, EXPRESSION_POLL_MS);
				return () => { live = false; clearInterval(timer); };
			}, [sessionKey]);

			// 相位 → 表情（＋场景重设）；换相位后把极值统计清零，好让下一段读数只反映新相位。
			// 🔴 EXPR-3：引擎给了 `expression_path` 时，**表情由引擎定**（旧映射退位）；
			//    没有文件时才沿用旧的相位映射（明说"沿用旧的相位映射"）。
			// 🔴 D1：面板**只播待机动作** → 相位一律不换表情（`expressionIndex` 传 null）。
			React.useEffect(() => {
				const engine = engineRef.current;
				if (engine === null) return;
				if (PORTRAIT_IDLE_ONLY || plan.source === "engine") engine.applyPhase(Object.assign({}, state, { expressionIndex: null }));
				else engine.applyPhase(state);
				engine.resetStats();
			}, [engineVersion, phase, state.expressionIndex, plan.source]);

			// 表情：按**稳定键**应用（只有路/取值/回合真的变了才重设，见 `expressionKey`）。
			// 🔴 D1：面板不做实时驱动 → 引擎的表情指令**不应用**（传 null ＝ 收尾，把脸交还给待机）；
			//    `readout().expressionApplied` 会如实说"这一档没有应用"（不静默、不假装成功）。
			React.useEffect(() => {
				const engine = engineRef.current;
				if (engine === null) return;
				engine.applyExpression(PORTRAIT_IDLE_ONLY ? null : (plan.source === "engine" ? plan : null));
				engine.resetStats();
			}, [engineVersion, planKey]);

			// 通道 → 嘴型 provider（speak = 文字节奏；write = 恒 0）
			React.useEffect(() => {
				const engine = engineRef.current;
				if (engine === null) return;
				engine.setChannel(channel);
				engine.resetStats();
			}, [engineVersion, channel]);

			// 读数：每 250 ms 取一次（渲染循环自己在 rAF 里累计，不受这个轮询影响）
			React.useEffect(() => {
				if (status.kind !== "ready") return undefined;
				const timer = setInterval(() => {
					const engine = engineRef.current;
					if (engine !== null) setReadout(engine.readout());
				}, 250);
				return () => { clearInterval(timer); };
			}, [status.kind]);

			/**
			 * 🔴 D2 · **不可见就暂停渲染**（三个开关，任一命中即停）：
			 *   ① `document.visibilitychange` —— 页面切到后台/最小化；
			 *   ② `IntersectionObserver` —— 这块板面滚出视口、或被祖先折起（tab 被折叠时也算）；
			 *   ③ 舞台铺满整屏（`stageOverlayOpen()`）—— 那时看的是舞台，面板这张立绘没人看。
			 * 解绑方式照 `dispose()`：三个监听各自在自己的 cleanup 里摘掉，不留尾巴。
			 * 🔴 不猜环境：没有 `document` / `IntersectionObserver`（node 侧、老环境）时**不暂停**
			 *    （"观测不到"不等于"不可见"——宁可不省这一份电，也不要让立绘在能被看见时不动）。
			 */
			React.useEffect(() => {
				if (status.kind !== "ready") return undefined;
				const engine = () => engineRef.current;
				let hidden = typeof document !== "undefined" && document !== null && document.visibilityState === "hidden";
				let intersecting = true;
				const apply = () => {
					const current = engine();
					if (current === null || typeof current.setPaused !== "function") return;
					current.setPaused(hidden || !intersecting || stageOverlayOpen());
				};
				const onVisibility = () => {
					hidden = document.visibilityState === "hidden";
					apply();
				};
				if (typeof document !== "undefined" && document !== null && typeof document.addEventListener === "function") {
					document.addEventListener("visibilitychange", onVisibility);
				}
				let observer = null;
				if (typeof IntersectionObserver === "function") {
					const target = canvasRef.current;
					if (target !== null && target !== undefined) {
						observer = new IntersectionObserver((entries) => {
							for (const entry of entries) intersecting = entry.isIntersecting === true;
							apply();
						});
						observer.observe(target);
					}
				}
				// 舞台是随时可开可关的（Ctrl+Shift+M / Ctrl+Shift+U / 地址栏开关），只有轮询能跟上；
				// 1 s 一次、只读一个布尔，代价可以忽略（且只在立绘就绪后才跑）。
				const timer = setInterval(apply, 1000);
				apply();
				return () => {
					if (typeof document !== "undefined" && document !== null && typeof document.removeEventListener === "function") {
						document.removeEventListener("visibilitychange", onVisibility);
					}
					if (observer !== null) observer.disconnect();
					clearInterval(timer);
				};
			}, [status.kind, sessionKey]);

			/**
			 * 🔴 D3 · **Live2D 用不了就显示静态立绘图**（不留白）。
			 *
			 * 只在 `status.kind === "failed"` 时去取（Live2D 正常时不额外读一张图、也不叠一张图上去）。
			 * 来源＝舞台包的教师立绘（工作区字节通道，`readBytes` → `Blob` → objectURL）；
			 * 读不到就**保持现状**（`staticPortrait.kind === "absent"`）——不新增第二种报错，
			 * 由既有的「立绘装载失败：…」那一行说明原因（那段文案与判据有测试守着，本批不动）。
			 */
			React.useEffect(() => {
				const face = portraitRef.current;
				if ((status.kind !== "failed" && status.kind !== "absent") || face === undefined || sessionKey === null) return undefined;
				let live = true;
				let url = null;
				const controller = new AbortController();
				readBinary(face.ctx.remote, face.sessionId, staticPortraitPath(), controller.signal)
					.then((bytes) => {
						url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(staticPortraitPath()) }));
						portraitSources.staticImage = staticPortraitPath();
						if (live) setStaticPortrait({ kind: "ok", url: url, message: null });
						// 组件已卸载/换了会话：这张 objectURL 没人用了，当场释放（否则一直占着内存）
						else URL.revokeObjectURL(url);
					})
					.catch((error) => {
						if (live) setStaticPortrait({ kind: "absent", url: null, message: messageOf(error) });
					});
				return () => {
					live = false;
					controller.abort();
					if (url !== null) URL.revokeObjectURL(url);
				};
			}, [status.kind, sessionKey]);

			// 卸载时停掉喂文字
			React.useEffect(() => () => {
				const engine = engineRef.current;
				if (engine !== null) engine.stopFeed();
			}, []);

			const engine = () => engineRef.current;

			const children = [];

			// ── 讲台 ＝ B 骨架的「常驻黑板位」───────────────────────────────────────
			//   形态取自 STAGE-3 的 `.v-b .podium`：**一块常驻板面** ＋ 顶端一条金褐渐隐轨。
			//   板上的内容是分层的：**产品文案**留在板面上（环节/通道、本回合表情、未就位说明），
			//   **工程读数**（模型与资源路径、表情那条路的说明、装载过程、调试控件）收进
			//   `<details>「讲台诊断」`——信息一条不少（点一下就在），但默认不占主视觉。
			const board = [];
			board.push(React.createElement("div", { style: S.boardRail, key: "rail" }));
			board.push(React.createElement("div", { style: S.sectionLabel, key: "label" }, PORTRAIT_LABEL));

			// 画布**永远挂载**（`status` 只有 `failed` 时才把它折成 0 高）：
			//   · 装载效果要拿到 `canvasRef.current` 才会跑，折掉元素等于**永远发现不了未部署**；
			//   · 只折 CSS 高、不动元素，故未部署时"失败"照常被看见，只是不再占掉 ~330px 空白纸。
			//   🔴 `loading`/`ready` 两态的尺寸**与改前逐字相同**——本次没有 Live2D 资产可供验证
			//      "装载成功"这条路，所以那条路一个像素都不动（只改我能在本机实测的失败态）。
			/**
			 * 🔴 三种**终态**（D3 ＋ "能力缺席 vs 故障"的区分）：
			 *   · `ready`/`loading`/`idle` —— 画布占位（原样）；
			 *   · `absent` —— **本 profile 没有可用的 Live2D 源**（能力缺席，不是故障）→ 静态立绘图 ＋ 中性说明；
			 *   · `failed` —— **有源但装载坏了**（故障）→ 「立绘装载失败：…」照旧 ＋ 折成 0 高。
			 * 画布在三种状态下**都留在文档里**（装载效果要拿到它，失败才报得出来）。
			 */
			const boardRaised = status.kind !== "failed" && status.kind !== "absent";
			const showStatic = (status.kind === "absent" || status.kind === "failed")
				&& staticPortrait.kind === "ok" && staticPortrait.url !== null;
			const boardState = boardRaised ? "raised" : (showStatic ? "static" : "collapsed");
			board.push(React.createElement("div", {
				style: boardRaised || showStatic ? S.portraitBox : S.portraitBoxCollapsed,
				key: "box",
				"data-cui-board": boardState,
			},
				React.createElement("canvas", {
					ref: canvasRef,
					width: PORTRAIT_CANVAS_SIZE,
					height: PORTRAIT_CANVAS_SIZE,
					style: S.canvas,
					"data-classroom-ui-portrait": "canvas",
				}),
				showStatic
					? React.createElement("img", {
						key: "static",
						src: staticPortrait.url,
						style: S.staticPortrait,
						alt: "",
						"data-cui-static-portrait": "1",
					})
					: null,
			));

			// —— 状态行：相位来源与通道（**常显**：这是产品文案，不是调试信息）
			const phaseText = state.provided
				? "环节 " + state.phase + (props.phaseName === null || props.phaseName === undefined ? "" : "（" + props.phaseName + "）")
				: "环节 未提供";
			board.push(React.createElement("div", { style: S.note, key: "state" },
				phaseText + " · 通道 " + channel + " · " + state.note));
			if (!state.provided) {
				board.push(React.createElement("div", { style: S.note, key: "state-why" },
					"progress.md 里还没有 `current_phase:` 行 → 立绘停在默认待机（不猜）。"));
			}

			// —— 🔴 EXPR-3：本回合的表情（引擎定 → 落到立绘上）——**常显，且失败路径不静默**
			//    这里显示的是**应用结果**（`applyExpression` 的返回值），不是文件里写了什么；
			//    两者不一致时（例如引擎给了名字但模型没注册），必须看得出来。
			const applied = readout === null || readout.expressionApplied === undefined ? null : readout.expressionApplied;
			/** 显示哪条路／什么取值：**以应用结果为准**（还没应用时退回文件里那条计划）。 */
			const shownPath = applied !== null && applied.path !== null ? applied.path : plan.path;
			const shownFace = applied !== null && applied.value !== null && applied.path === "face-parameters"
				? applied.value
				: (plan.path === "face-parameters" ? plan.value : null);
			const shownValue = shownPath === null ? "—"
				: shownPath === "face-parameters"
					? (Object.entries(shownFace).map(([id, value]) => id + "=" + String(value)).join(", ") || "—")
					: String(applied !== null && applied.value !== null ? applied.value : plan.value);
			const pathLabel = EXPRESSION_PATH_LABEL[shownPath] === undefined ? String(shownPath) : EXPRESSION_PATH_LABEL[shownPath];
			const originLabel = plan.parsed === null ? null
				: (plan.parsed.origin === "teacher" ? "老师指定"
					: plan.parsed.origin === "fallback" ? "引擎兜底（推测）"
						: plan.parsed.origin === "unavailable" ? "不可用" : plan.parsed.origin);
			const appliedStatus = plan.source === "absent" ? "absent" : (applied === null ? "pending" : applied.status);
			board.push(React.createElement("div", {
				style: S.note,
				key: "expression-apply",
				"data-classroom-ui-expression-apply": appliedStatus,
			}, "表情 · "
				+ (shownPath === null ? "未提供" : pathLabel + "：" + shownValue)
				+ (originLabel === null ? "" : " · " + originLabel)
				// 🔴 `expression_turn` 是**宿主回合号**（不是引擎自己的计数器，也不是客户端数出来的回合数）
				//    ——见主代理 2026-09-24 的口径；这里只**原样显示**，不拿它跟自己数的回合比。
				+ (plan.parsed === null || plan.parsed.turn === null ? "" : " · 宿主回合 " + plan.parsed.turn)
				+ (applied !== null && applied.ok ? " · 已应用" : "")));

			// —— 🔴 立绘未就位：**显式**（一行，带原始报错）但**不抢主视觉**（不是一整块灰板）
			//    这里只出现**故障**（有源但坏了）。「能力缺席」不走这一行（见下面那条中性说明）——
			//    "这台机器上没有 Live2D 源"是**预期的**，把它说成"装载失败"会让每次开面板都像出了事故。
			if (status.kind === "failed") {
				board.push(React.createElement("div", {
					style: S.boardNotice,
					key: "failed",
					"data-cui-live2d-failure": "1",
					"data-classroom-ui-live2d": "failed",
				}, "立绘装载失败：" + String(status.message)));
			}
			// —— 能力缺席（不是故障）：一行**中性**说明 ＋ 静态图顶上（D3 的退路）
			if (status.kind === "absent") {
				board.push(React.createElement("div", {
					style: S.boardNotice,
					key: "absent",
					"data-classroom-ui-live2d": "absent",
					"data-cui-live2d-absent": "1",
				}, "立绘：静态图（本 profile 没有可用的 Live2D 源：舞台没装，自带渲染宿主未构建）"
					+ (status.cause === null || status.cause === undefined ? "" : "｜原始原因：" + String(status.cause))));
			}

			// —— 讲台诊断：工程读数（**默认折起**；一条信息都没删，只是不再默认占版面）
			const diag = [];
			diag.push(React.createElement("div", { style: S.note, key: "model" },
				"模型 " + modelName() + "（官方样本**占位**，不是小鞠知花本人的模型；换模型见 README）· 资源 " + live2dRoot()));
			/**
			 * 🔴 D1/D2 的**如实读数**：走的是哪条腿（舞台那套 PIXI / 自带渲染宿主）、跑在几 fps、
			 *    现在有没有被暂停。验收读这一个 DOM 属性就够，不用去猜配置有没有生效。
			 */
			const portraitMode = status.kind === "absent" ? "static-fallback"
				: status.kind === "failed" ? "failed"
					: (readout === null || readout.mode === undefined ? "pending" : readout.mode);
			const portraitPaused = readout !== null && readout.paused === true;
			const sourceLine = portraitSources.stage
				? "舞台那套（PIXI ＋ pixi-live2d-display，模型与库走 " + STAGE_ROUTE + "）"
				: "自带渲染宿主（live2d-host，工作区字节通道）";
			diag.push(React.createElement("div", {
				style: S.note,
				key: "mode",
				"data-cui-portrait-mode": portraitMode === null ? "pending" : String(portraitMode),
				"data-cui-portrait-paused": portraitPaused ? "true" : "false",
			}, "渲染 " + sourceLine
				+ " · 待机模式（只播待机动作，约 " + String(PORTRAIT_FPS) + " fps）"
				+ (portraitPaused ? " · **已暂停**（不可见或舞台开着）" : "")
				+ (PORTRAIT_IDLE_ONLY ? " · 不做实时驱动（表情/嘴型由舞台负责）" : "")));
			if (showStatic) {
				diag.push(React.createElement("div", {
					style: S.note,
					key: "static",
					"data-cui-static-portrait-note": "1",
				}, "Live2D 这一档不可用 → 按 D3 退回**静态立绘图**（" + staticPortraitPath() + "）"));
			}
			if (plan.source === "absent") {
				diag.push(React.createElement("div", {
					style: S.note,
					key: "expression-absent",
					"data-classroom-ui-expression-note": "absent",
				}, plan.reason));
			} else if (applied !== null && applied.note !== null) {
				diag.push(React.createElement("div", {
					style: S.note,
					key: "expression-note",
					"data-classroom-ui-expression-note": applied.status,
				}, "表情这条路的说明：" + applied.note));
			}
			if (plan.inferred) {
				diag.push(React.createElement("div", {
					style: S.note,
					key: "expression-inferred",
					"data-classroom-ui-expression-note": "inferred",
				}, "（文件里没有 expression_path 行 → 按引擎自己的优先级推断出上面这条路；推断不等于引擎声明的路）"));
			}
			// —— 🔴 相位 → 表情这条路在本模型上通不通（**不静默**）
			//    判据取自宿主能力发现的 `phaseExpression.status`（原样透传，不自己猜）：
			//      `unavailable`（表达式个数 = 0）→ 换环节**不会**换表情，必须报出来；
			//      `partial`（1–5 个）→ **可用但下标回绕**（多个环节共用一张脸），不是失效，另说一句。
			// 🔴 D1：面板只播待机动作时，"相位 → 表情"这条路**本来就不走**，那两条提示不该出现
			//    （否则用户会以为"表情坏了"，其实是待机模式下不接线）。
			if (!PORTRAIT_IDLE_ONLY && readout !== null && readout.expressions === 0) {
				diag.push(React.createElement("div", {
					style: S.note,
					key: "expression-unavailable",
					"data-classroom-ui-expression": "unavailable",
				}, "相位 → 表情不可用：本模型表达式个数 = 0，切环节不会换表情（判据与处置见 live2d-host/README.md §三）。"));
			} else if (!PORTRAIT_IDLE_ONLY && readout !== null && readout.expressions > 0 && readout.expressions < 6) {
				diag.push(React.createElement("div", {
					style: S.note,
					key: "expression-partial",
					"data-classroom-ui-expression": "partial",
				}, "表情只有 " + String(readout.expressions) + " 个 → 多个环节会共用同一张脸（下标回绕，可用）。"));
			}
			if (status.kind === "loading") {
				diag.push(React.createElement("div", { style: S.note, key: "loading" }, "装载立绘（读盘 → 建 blob → 装载 Core/框架/模型）…"));
			}

			// —— 调试控件：**只在 debug 打开时出现**
			if (debug) {
				const phaseIds = [null].concat(Object.keys(PHASE_STATES));
				const chip = (key, label, active, onClick) => React.createElement("button", {
					type: "button",
					key: key,
					className: "cui-act",
					"data-classroom-ui-debug": key,
					"data-active": active ? "true" : "false",
					style: active ? Object.assign({}, S.chip, S.chipActive) : S.chip,
					onClick: onClick,
				}, label);

				diag.push(React.createElement("div", { style: S.debugBox, key: "debug" },
					React.createElement("div", { style: S.sectionLabel }, "调试用（仅开发时出现）· 相位覆盖"),
					React.createElement("div", { style: S.chipRow },
						phaseIds.map((id) => chip("phase:" + String(id), id === null ? "未提供" : id, debugPhase === id, () => { setDebugPhase(id); })),
					),
					React.createElement("div", { style: S.sectionLabel }, "调试用 · 通道覆盖"),
					React.createElement("div", { style: S.chipRow },
						chip("channel:auto", "跟随相位", debugChannel === null, () => { setDebugChannel(null); }),
						chip("channel:speak", "speak（说话）", debugChannel === "speak", () => { setDebugChannel("speak"); }),
						chip("channel:write", "write（写字）", debugChannel === "write", () => { setDebugChannel("write"); }),
					),
					React.createElement("div", { style: S.sectionLabel }, "调试用 · 喂文字（模拟流式 text-delta）"),
					React.createElement("div", { style: S.chipRow },
						React.createElement("button", {
							type: "button",
							className: "cui-act",
							"data-classroom-ui-debug": "feed-once",
							style: S.chip,
							disabled: status.kind !== "ready",
							onClick: () => { const e = engine(); if (e !== null) e.startFeed(DEBUG_FEED_TEXT, false); },
						}, "喂一段"),
						React.createElement("button", {
							type: "button",
							className: "cui-act",
							"data-classroom-ui-debug": "feed-loop",
							"data-active": feedLoop ? "true" : "false",
							style: feedLoop ? Object.assign({}, S.chip, S.chipActive) : S.chip,
							disabled: status.kind !== "ready",
							onClick: () => {
								const next = !feedLoop;
								setFeedLoop(next);
								const e = engine();
								if (e !== null) { if (next) e.startFeed(DEBUG_FEED_TEXT, true); else e.stopFeed(); }
							},
						}, feedLoop ? "停" : "循环喂"),
						React.createElement("button", {
							type: "button",
							className: "cui-act",
							"data-classroom-ui-debug": "stats-reset",
							style: S.chip,
							disabled: status.kind !== "ready",
							onClick: () => { const e = engine(); if (e !== null) e.resetStats(); },
						}, "清读数"),
					),
					readout === null
						? React.createElement("div", { style: S.note }, "（读数等装载完成）")
						: React.createElement("div", { style: S.readout, "data-classroom-ui-readout": "1" },
							"通道 " + readout.channel
							+ " · 嘴参数 " + (readout.parameter === null ? "—（该模型不支持嘴型）" : readout.parameter)
							+ " · 当前 " + (readout.value === null ? "—" : readout.value.toFixed(3))
							+ " · 区间 [" + (readout.min === null ? "—" : readout.min.toFixed(3)) + ", " + (readout.max === null ? "—" : readout.max.toFixed(3)) + "]"
							+ " · provider " + readout.provider.toFixed(3)
							+ " · 表情 " + (readout.expression === null ? "—" : readout.expression) + "/" + String(readout.expressions)
							+ (readout.expressions === 0 ? "（0 个 → 相位不改表情）" : "")
							+ (readout.expressions > 0 && readout.expressions < 6 ? "（不足 6 → 下标回绕）" : "")
							+ " · 帧 " + String(readout.frames)
							+ " · 动作可用 " + String(readout.motionsAlive) + "（已摘 " + String(readout.motionsDropped) + "）"
							+ " · 帧错误 " + String(readout.frameErrors)
							+ (readout.feeding ? " · 正在喂文字" : "")),
					React.createElement("div", { style: S.note }, "命中级别：" + String(readout === null ? "—" : readout.lipSyncSource)),
					readout !== null && readout.frameErrors > 0
						? React.createElement("div", { style: S.note }, "帧错误（只读复用侧既有缺陷，见 README §已知边界）：" + String(readout.lastFrameError))
						: null,
				));
			}

			if (diag.length > 0) {
				board.push(React.createElement("details", {
					key: "diag",
					"data-cui-diag": "1",
				},
					React.createElement("summary", { className: "cui-sum", style: S.boardSummary }, "讲台诊断"),
					React.createElement("div", { style: S.boardDiag }, diag),
				));
			}

			children.push(React.createElement("div", {
				style: S.board,
				key: "board",
				"data-cui-board-plate": "1",
			}, board));

			return React.createElement("div", {
				style: S.sectionFor(true),
				"data-classroom-ui-portrait-stage": "1",
				"data-classroom-ui-section": "1",
				// 🔴 立绘这一档现在处于什么状态（验收读这一个属性：pixi-idle / live2d-host-idle /
				//    static-fallback / failed / pending）——不用去猜配置到底有没有生效。
				"data-cui-portrait-mode": String(portraitMode),
			}, children);
		}

		/**
		 * 面板主体：教室信息 ＋ 当前状态 ＋ 14 讲课程表 ＋ 数据来源。
		 * props 由框架给出：`sessionId`（会话）、`useTabInfo`（tab 信息钩子）、
		 * `classroom`（本插件在 inject 里返回的 store 面）。
		 */
		function ClassroomBody(props) {
			const S = styles();
			const store = props.classroom;
			if (store === undefined) {
				return React.createElement("div", Object.assign({ style: S.body, "data-classroom-ui": "body" }),
					React.createElement("div", { style: S.error }, "classroom-ui：store 未注入（inject 未生效）"));
			}
			const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
			React.useEffect(() => {
				if (snapshot.status === "idle") store.refresh();
			}, [snapshot.status, store]);

			// 書庫纸面分深浅两套：跟宿主切主题的那个 body 属性（与消息流里的图同一个判据）。
			const [theme, setTheme] = React.useState(themeMode);
			React.useEffect(() => watchDarkTheme(() => { setTheme(themeMode()); }), []);

			/**
			 * 🔴 W-p：面板**内部**的 tab 分流（方案甲：面板内 tab 栏，**不新增侧栏 tab 类型**）。
			 * 两个页面：
			 *   · `classroom` —— 原来那条长栏（书名页 ＋ 讲台 ＋ 当前 ＋ 课程表 ＋ 数据来源），**一个区块都没动**；
			 *   · `board`     —— 「板书」**只读历史**（`BoardHistory`）。
			 * 为什么不新增侧栏 tab 类型：侧栏 tab 类型的注册是**三段式**（类型／主体／标题），
			 * 多一个类型就多三段注册与一套地址方案，而这两页共享同一个会话上下文与同一次读盘；
			 * 用户要的是"面板里多一页"，不是"右栏多一个 tab"。
			 * 🔴 切到「板书」时 `PortraitStage` **卸载** → 立绘的 rAF/渲染随之停掉（D2 的
			 *    「tab 没打开就暂停」在这一层是天然的，不需要额外开关）。
			 */
			const [tab, setTab] = React.useState("classroom");

			const data = snapshot.data;
			const children = [];
			/** 已经排过几个区块——`rule` 成形方式下只有非首块才画分节线。 */
			let sectionCount = 0;
			/**
			 * 推一个**区块**（受皮肤 `section` 成形方式管辖：发丝线分节／板面／卡片）。
			 * @param key - React key
			 * @param node - 区块内容（数组则各自要有 key）
			 */
			const pushSection = (key, node) => {
				const framed = sectionCount > 0;
				sectionCount += 1;
				children.push(React.createElement("div", {
					style: S.sectionFor(framed),
					key: key,
					"data-classroom-ui-section": "1",
				}, node));
			};

			// —— 头部：书名页（教室名 ＋ 元信息 ＋ 一条金褐发丝线）
			// 🔴 元信息里**去掉了教室根路径**：页脚「数据来源」已经把 `classroomRoot()/<文件>`
			//    逐条列了四遍（`loadClassroom` 的 `source.path` 逐字），头部再写一遍纯属重复，
			//    而且那一行长路径正是"开发者工具味"最重的一处。信息没丢，只是不再重复。
			pushSection("head", [
				React.createElement("div", { style: S.headTitle, key: "title" }, data !== null && data.title !== null ? data.title : PANEL_TITLE),
				React.createElement("div", { style: S.headMeta, key: "meta" },
					[data === null ? null : data.subject,
						data === null || data.lessonsTotal === null ? null : String(data.lessonsTotal) + " 讲",
						data === null || data.classroomId === null ? null : data.classroomId].filter((part) => part !== null).join(" · ")),
				React.createElement("div", { style: S.headRule, key: "rule" }),
			]);

			if (snapshot.status === "loading" && data === null) {
				children.push(React.createElement("div", { style: S.note, key: "loading" }, "读取教室文件…"));
			}
			if (snapshot.status === "failed") {
				children.push(React.createElement("div", { style: S.error, key: "failed" }, "读取失败：" + String(snapshot.error)));
			}

			// —— 🔴 EXPR-5：部署一致性自检（只在**没通过**时出现；通过了不占地方）
			//    为什么放在这么靠前：这一条是"引擎写了但面板看不到"的唯一防线，
			//    它的结论必须在用户看到"没有表情"之前先出现（否则会被误读成"引擎没写"）。
			if (data !== null && data.deployment !== undefined && data.deployment.status !== "ok") {
				children.push(React.createElement("div", {
					style: S.error,
					key: "deployment",
					"data-classroom-ui-deploy-check": data.deployment.status,
				}, [
					React.createElement("div", { key: "head" }, "部署一致性自检未通过（" + data.deployment.status + "）"),
					...data.deployment.lines.map((line, index) => React.createElement("div", { key: "l" + String(index) }, line)),
				]));
			}

			// —— 讲台（B 骨架的「常驻黑板位」）：面板里的一整块区域（不另开 tab），放在信息区上方。
			//    PortraitStage 自己就是一个区块（它内部用 `S.sectionFor(true)`），故这里只记数。
			sectionCount += 1;
			children.push(React.createElement(PortraitStage, {
				key: "portrait",
				portrait: props.portrait,
				phase: data === null ? null : data.currentPhase,
				phaseName: data === null ? null : data.phaseName,
			}));

			// —— 当前：讲次（正文列的主标题）／环节／老师／进度／上次
			if (data !== null) {
				const total = data.lessonsTotal === null ? "?" : String(data.lessonsTotal);
				const pad2 = (n) => (n < 10 ? "0" + String(n) : String(n));
				const phaseText = data.currentPhase === null
					? null
					: data.currentPhase + (data.phaseName === null ? "" : "（" + data.phaseName + "）");
				// 🔴 讲次是这一屏的**主标题**：讲次号走等宽体（纯数字），标题走衬线（書庫的章题字面）。
				//    改前它是 `讲次 | 第 1 讲 / 14 · 一个程序怎么跑起来` 的一行普通字段——
				//    与"老师""进度"同权，等于**当前讲到哪一讲并不显眼**。
				const lessonNo = data.currentLesson === null
					? null
					: "第 " + pad2(data.currentLesson) + " 讲 / " + total;
				pushSection("current", [
					React.createElement("div", { style: S.sectionLabel, key: "label" }, "当前"),
					React.createElement("div", { style: S.lessonLine, key: "lesson", "data-cui-lesson": "1" }, [
						React.createElement("span", { style: S.lessonNo, key: "no" }, lessonNo === null ? "未提供" : lessonNo),
						React.createElement("span", { key: "t" }, data.lessonTitle === null ? "" : data.lessonTitle),
					]),
					React.createElement(Field, { key: "phase", label: "环节", value: phaseText, hook: "phase" }),
					React.createElement(Field, { key: "teacher", label: "老师", value: data.teacher, hook: "teacher" }),
					React.createElement(Field, { key: "progress", label: "进度", value: data.progressText, hook: "progress" }),
					React.createElement(Field, { key: "last", label: "上次", value: data.lastDate, hook: "last" }),
					data.currentPhase === null
						? React.createElement("div", { style: S.note, key: "why" }, "progress.md 里还没有 `current_phase:` 行 → 环节按「未提供」显示（不猜）。")
						: null,
					data.humanLesson !== null && data.currentLesson !== null && !data.humanLesson.includes(String(data.currentLesson))
						? React.createElement("div", { style: S.note, key: "mismatch" }, "提示：progress.md 人读表格的「本轮要讲」写的是「" + data.humanLesson + "」，机器可读行是 current_lesson: " + String(data.currentLesson) + "，两处口径不一致（按 AGENTS.md:63-66 契约，两者必须同值）。")
						: null,
				]);
			}

			// —— 课程表：**书脊索引**（C 書庫的 `.v-c .spines` ＋ 章节索引）
			//    改前是一张"发丝线表格 ＋ 当前行灰底 ＋ 「当前」药丸"——那正是"管理后台卡片"的味道。
			//    现在：一排窄书脊给**全局位置**（14 讲一眼看完、当前那根描金），下面一份章节索引给**内容**。
			if (data !== null && data.lessons.length > 0) {
				const doneCount = data.doneCount === null ? 0 : (Number.parseInt(String(data.doneCount), 10) || 0);
				const stateOf = (n) => (n === data.currentLesson ? "cur" : (n <= doneCount ? "done" : "todo"));
				const spineStyle = (state) => state === "cur"
					? Object.assign({}, S.spine, S.spineCurrent)
					: state === "done" ? Object.assign({}, S.spine, S.spineDone) : Object.assign({}, S.spine, S.spineTodo);
				const spines = data.lessons.map((lesson) => {
					const state = stateOf(lesson.n);
					return React.createElement("i", {
						key: "s" + String(lesson.n),
						style: spineStyle(state),
						"data-cui-spine": String(lesson.n),
						"data-cui-spine-state": state,
					});
				});
				const rows = data.lessons.map((lesson) => {
					const state = stateOf(lesson.n);
					const isCurrent = state === "cur";
					const nodes = [React.createElement("div", {
						key: "row",
						className: "cui-index-row",
						style: isCurrent ? Object.assign({}, S.indexRow, S.indexRowCurrent) : S.indexRow,
						"data-cui-item": String(lesson.n),
						"data-cui-current": isCurrent ? "true" : "false",
					}, [
						isCurrent ? React.createElement("span", { style: S.indexMark, key: "mark" }) : null,
						React.createElement("span", { style: S.indexNo, key: "n" }, lesson.n < 10 ? "0" + String(lesson.n) : String(lesson.n)),
						React.createElement("span", {
							key: "t",
							style: isCurrent ? Object.assign({}, S.indexTitle, S.indexTitleCurrent) : Object.assign({}, S.indexTitle, S.indexTitleRest),
						}, lesson.title),
					])];
					if (isCurrent && lesson.core !== null) {
						nodes.push(React.createElement("div", { style: S.indexCore, key: "core", "data-cui-core": String(lesson.n) }, "核心疑问：" + lesson.core));
					}
					return nodes;
				});
				pushSection("curriculum", [
					React.createElement("div", { style: S.sectionLabel, key: "label" }, "课程表 · " + String(data.lessons.length) + " 讲"),
					React.createElement("div", { style: S.spineStrip, key: "spines", "data-cui-spines": String(spines.length) }, spines),
					React.createElement("div", { style: S.index, key: "index" }, rows),
				]);
			} else if (data !== null && snapshot.status === "ready") {
				children.push(React.createElement("div", { style: S.note, key: "curriculum-empty" }, "课程表未解析到讲次（curriculum.md 的 `## 第 N 讲 · 标题` 标题格式没匹配上）。"));
			}

			// —— 数据来源（逐文件真伪，不掩饰）＋ 重新读盘
			if (snapshot.sources.length > 0) {
				pushSection("sources", [
					React.createElement("div", { style: S.sectionLabel, key: "label" }, "数据来源（真读盘）"),
					...snapshot.sources.map((source) => React.createElement("div", {
						style: S.source,
						key: source.name,
						"data-cui-source": source.name,
						"data-cui-source-ok": source.ok ? "true" : "false",
					},
						React.createElement("span", { key: "mark" }, source.ok ? "✓" : "✗"),
						React.createElement("span", { style: S.sourcePath, key: "path" }, source.path),
						React.createElement("span", { key: "err" }, source.ok ? "" : "（" + String(source.error) + "）"),
					)),
					React.createElement("button", {
						type: "button",
						className: "cui-act",
						key: "refresh",
						"data-cui-refresh": "1",
						style: S.button,
						onClick: () => { store.refresh(); },
					}, snapshot.status === "loading" ? "读取中…" : "重新读盘"),
				]);
			}

			// ── tab 栏（面板内部）：教室 ／ 板书 ／ 日记 ──────────────────────────────
			//    只换"看哪一页"，不动任何数据、不新增侧栏 tab 类型（见上面 `tab` 的说明）。
			//    2026-10-21（P2）：新增「日记」（N2.5）——只读、只走 `remote.classroomNarrative`。
			//    这一页的数据在**挂载时**才读，切走就停（与「板书」同一取舍：省一次读盘）。
			const tabs = [["classroom", "教室"], ["board", "板书"], ["diary", "日记"]];
			const tabBar = React.createElement("div", { style: S.tabBar, key: "tabs", "data-cui-tabs": "1" },
				tabs.map((entry) => React.createElement("button", {
					type: "button",
					key: entry[0],
					className: "cui-act",
					style: tab === entry[0] ? Object.assign({}, S.tab, S.tabActive) : S.tab,
					"data-cui-tab": entry[0],
					"data-active": tab === entry[0] ? "true" : "false",
					onClick: () => { setTab(entry[0]); },
				}, entry[1])));
			/** 三页共用同一份 `ctx.remote` 与 sessionId（都从 `portrait` 面取，与板书那条一致）。 */
			const remote = props.portrait === undefined || props.portrait === null ? undefined : props.portrait.ctx.remote;
			const sessionId = props.portrait === undefined || props.portrait === null ? null : props.portrait.sessionId;
			const boardNode = React.createElement(BoardHistory, {
				key: "board",
				remote: remote,
				sessionId: sessionId,
				currentLesson: data === null ? null : data.currentLesson,
			});
			const diaryNode = React.createElement(DiaryView, { key: "diary", remote: remote, sessionId: sessionId });
			// 课堂那一页保持**原样**（所有区块一个不少）；其它三页只放各自那一块。
			const pages = { classroom: children, board: [boardNode], diary: [diaryNode] };
			const shown = Object.prototype.hasOwnProperty.call(pages, tab) ? pages[tab] : children;

			return React.createElement("div", {
				style: Object.assign({}, S.root, S.vars, S.varsFor(theme)),
				"data-classroom-ui": "body",
				"data-classroom-ui-skin": skinId(),
				"data-cui-frame": "library",
				"data-cui-theme": theme,
				"data-cui-tab": tab,
			}, [tabBar].concat(shown));
		}

		/** tab 标题：教室 ＋ 本轮要讲（数据没到位时只显示「教室」）。 */
		function ClassroomTitle(props) {
			const store = props.classroom;
			if (store === undefined) return PANEL_TITLE;
			const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
			const data = snapshot.data;
			if (data === null || data.currentLesson === null) return PANEL_TITLE;
			return PANEL_TITLE + " · 第 " + String(data.currentLesson) + " 讲";
		}

		// ── 6.9 的视图：右栏「板书」tab（**只读**历史）────────────────────────────
		//
		// 这一块只做三件事（每一件都独立可验）：
		//   ① 读 `runtime/diagrams/index.md` → 按时间倒序列出（标题 ＋ 讲次 ＋ 回合）；
		//   ② 点开某一行 → 读对应 `.mmd` 全文 → 用现成的 `diagramFor`（vendored mermaid）渲染；
		//   ③ 渲染失败 → **显示源码与原因**，绝不白屏。
		// 🔴 没有任何编辑入口：没有输入框、没有删除、没有"重画"。学生不能在白板上写字（用户已定）。
		// 🔴 列表**每次都真读盘**（挂载时 + 「重新读盘」按钮），所以刷新页面能重建，不依赖内存状态。
		function BoardHistory(props) {
			const S = styles();
			const remote = props.remote;
			const sessionId = props.sessionId;
			const currentLesson = props.currentLesson === undefined ? null : props.currentLesson;
			const [history, setHistory] = React.useState({
				kind: "loading", items: [], skipped: 0, error: null, path: diagramsIndexPath(), exists: false,
			});
			const [reloadSeq, setReloadSeq] = React.useState(0);
			const [selected, setSelected] = React.useState(null);
			const [source, setSource] = React.useState({ kind: "idle", text: null, error: null });
			const [render, setRender] = React.useState({ kind: "idle", svg: null, ms: null, message: null });
			const [themeName, setThemeName] = React.useState(() => (isDarkTheme() ? "dark" : "light"));

			// 深浅色跟着宿主走（与消息流里那张图同一个判据）
			React.useEffect(() => watchDarkTheme(() => { setThemeName(isDarkTheme() ? "dark" : "light"); }), []);

			// ① 列表：挂载 ＋ 每次「重新读盘」都真读
			React.useEffect(() => {
				if (remote === undefined || remote === null || typeof remote.workspaceFiles === "undefined") {
					setHistory({ kind: "failed", items: [], skipped: 0, error: "remote 未注入（inject 未生效）", path: diagramsIndexPath(), exists: false });
					return undefined;
				}
				let live = true;
				setHistory((previous) => Object.assign({}, previous, { kind: "loading" }));
				loadDiagramHistory(remote, sessionId, undefined).then(
					(result) => {
						if (live) setHistory(Object.assign({ kind: "ready" }, result));
					},
					(error) => {
						if (live) setHistory({ kind: "failed", items: [], skipped: 0, error: messageOf(error), path: diagramsIndexPath(), exists: false });
					},
				);
				return () => { live = false; };
			}, [sessionId, reloadSeq]);

			// ② 点开：读 `.mmd` 全文，再交给 `diagramFor`（缓存键＝主题版本＋主题＋源码）
			const selectedFile = selected === null ? null : selected.file;
			React.useEffect(() => {
				if (selectedFile === null) {
					setSource({ kind: "idle", text: null, error: null });
					setRender({ kind: "idle", svg: null, ms: null, message: null });
					return undefined;
				}
				let live = true;
				setSource({ kind: "loading", text: null, error: null });
				setRender({ kind: "idle", svg: null, ms: null, message: null });
				readDiagramSource(remote, sessionId, selectedFile, undefined).then(
					(result) => {
						if (!live) return;
						if (!result.ok) {
							setSource({ kind: "failed", text: null, error: result.error });
							return;
						}
						setSource({ kind: "ok", text: result.source, error: null });
						diagramFor({ remote: remote, sessionId: sessionId, source: result.source, themeName: themeName, signal: undefined }).then(
							(rendered) => { if (live) setRender({ kind: "ok", svg: rendered.svg, ms: rendered.ms, message: null }); },
							(error) => { if (live) setRender({ kind: "failed", svg: null, ms: null, message: messageOf(error) }); },
						);
					},
					(error) => { if (live) setSource({ kind: "failed", text: null, error: messageOf(error) }); },
				);
				return () => { live = false; };
			}, [selectedFile, themeName, sessionId]);

			/** 本会话画了几张（「会话」列存在且与面板 sessionId 一致才计数；否则为 0，不猜）。 */
			const sameSessionCount = history.items.filter((item) => item.session !== null && item.session === sessionId).length;
			const children = [];
			children.push(React.createElement("div", { style: S.sectionLabel, key: "label" }, "板书 · 只读历史"));
			children.push(React.createElement("div", { style: S.note, key: "src" },
				"真数据源：" + history.path + "（引擎写的索引；图的内容在对应的 .mmd 里，点开才读）"));
			children.push(React.createElement("div", { style: S.note, key: "count" },
				history.kind === "ready"
					? "共 " + String(history.items.length) + " 张（时间倒序）"
						+ (sameSessionCount > 0 ? "，其中本会话 " + String(sameSessionCount) + " 张" : "")
						+ (history.skipped > 0 ? "；另有 " + String(history.skipped) + " 行列数对不上，已跳过" : "")
						+ (history.legacy === true ? "；老版索引（没有表头）→ 按 7 列位置解析" : "")
					: (history.kind === "loading" ? "读取索引…" : "索引没读成")));

			if (history.error !== null) {
				children.push(React.createElement("div", { style: S.error, key: "err", "data-cui-board-error": "1" },
					"读 " + history.path + " 失败：" + String(history.error)));
			}

			if (history.kind === "ready" && history.items.length === 0) {
				children.push(React.createElement("div", { style: S.note, key: "empty", "data-cui-board-empty": "1" },
					history.exists
						? "索引在，但还没有一行数据（这节课还没画过板书）。"
						: "还没有 runtime/diagrams/index.md（这节课还没画过板书；老师第一次画图后引擎会建它）。"));
			}

			if (history.items.length > 0) {
				const rows = history.items.map((item) => {
					const isCurrent = currentLesson !== null && item.lesson === currentLesson;
					/**
					 * 「本会话」的标注（索引的「会话」列，后来才加的）：
					 *   · `current` —— 会话号与面板的 sessionId 一致；
					 *   · `other`   —— 是同一台工作区里别的会话画的；
					 *   · `unknown` —— 老索引没有这一列/留空（**不等于「不属于本会话」**）。
					 * 🔴 只**标注**、不过滤：过滤会把「引擎写的会话号与面板 sessionId 不是同一个」的图
					 *    整批藏起来，而这种不一致在客户端没有第二条判据。宁可多显示一行，不可静默丢。
					 */
					const sessionMark = item.session === null ? 'unknown'
						: (sessionId !== null && sessionId !== undefined && item.session === sessionId ? 'current' : 'other');
					const meta = [
						item.lesson === null ? "讲次未定" : "第 " + String(item.lesson) + " 讲",
						item.turn === null ? "回合未知" : "第 " + String(item.turn) + " 回合",
						item.kind === "" ? null : item.kind,
					].filter((part) => part !== null).join(" · ");
					return React.createElement("button", {
						type: "button",
						key: item.file,
						className: "cui-act",
						style: isCurrent ? Object.assign({}, S.boardRow, S.boardRowCurrent) : S.boardRow,
						"data-cui-board-item": item.file,
						"data-cui-board-current": isCurrent ? "true" : "false",
						"data-cui-board-session": sessionMark,
						"data-active": selectedFile === item.file ? "true" : "false",
						onClick: () => { setSelected(item); },
					}, [
						React.createElement("span", { style: S.boardRowTitle, key: "t" }, item.title === "" ? "（未给标题）" : item.title),
						React.createElement("span", { style: S.boardRowMeta, key: "m" }, meta),
					]);
				});
				children.push(React.createElement("div", { style: S.boardList, key: "list", "data-cui-board-list": String(history.items.length) }, rows));
			}

			// ③ 点开后那一块：图 ＋（折起的）源码
			if (selected !== null) {
				const viewer = [];
				viewer.push(React.createElement("div", { style: S.sectionLabel, key: "label" },
					selected.title === "" ? selected.file : selected.title));
				viewer.push(React.createElement("div", { style: S.drawMeta, key: "meta" },
					[
						selected.time,
						selected.lesson === null ? "讲次未定" : "第 " + String(selected.lesson) + " 讲",
						selected.turn === null ? "回合未知" : "第 " + String(selected.turn) + " 回合",
						selected.kind,
						selected.file,
					].filter((part) => part !== null && part !== "").join(" · ")
					+ (render.kind === "ok" ? " · 渲染 " + String(render.ms) + " ms" : "")));
				if (selected.caption !== null && selected.caption !== "" && selected.caption !== "—") {
					viewer.push(React.createElement("div", { style: S.drawCaption, key: "caption" }, selected.caption));
				}
				if (render.kind === "ok" && render.svg !== null) {
					viewer.push(React.createElement("div", {
						key: "svg",
						style: S.drawCanvas,
						"data-cui-board": "svg",
						dangerouslySetInnerHTML: { __html: render.svg },
					}));
				} else if (render.kind === "failed" || source.kind === "failed") {
					const why = source.kind === "failed"
						? "读不到这张图的源码：" + String(source.error)
						: "这张图在浏览器里没画出来（mermaid 渲染报错）：" + String(render.message);
					// 🔴 渲染失败不许白屏：原因 ＋ **完整源码**一起摆出来（学生照着也能画，老师一眼看出没画成）
					viewer.push(React.createElement("div", { style: S.drawFallback, key: "fallback", "data-cui-board": "failed" }, [
						React.createElement("div", { style: S.drawFallbackWhy, key: "why" }, why),
						React.createElement("pre", { style: S.drawSource, key: "src", "data-cui-board-source": "1" },
							source.text === null ? "（这次调用没有可读的源码）" : source.text),
					]));
				} else {
					viewer.push(React.createElement("div", { style: S.note, key: "loading", "data-cui-board": "loading" },
						"正在读源码并装载 mermaid…"));
				}
				// 源码永远可查（默认折起，不占版面）
				if (source.kind === "ok" && source.text !== null) {
					viewer.push(React.createElement("details", { style: S.drawDetails, key: "details" }, [
						React.createElement("summary", { style: S.drawSummary, className: "cui-sum", key: "sum" }, "看源码"),
						React.createElement("pre", { style: S.drawSource, key: "src", "data-cui-board-source": "1" }, source.text),
					]));
				}
				viewer.push(React.createElement("button", {
					type: "button",
					className: "cui-act",
					key: "close",
					style: S.button,
					"data-cui-board-close": "1",
					onClick: () => { setSelected(null); },
				}, "收起这张图"));
				children.push(React.createElement("div", {
					style: S.boardViewer,
					key: "viewer",
					"data-cui-board-viewer": selected.file,
				}, viewer));
			}

			children.push(React.createElement("button", {
				type: "button",
				className: "cui-act",
				key: "refresh",
				style: S.button,
				"data-cui-board-refresh": "1",
				onClick: () => { setReloadSeq((value) => value + 1); },
			}, history.kind === "loading" ? "读取中…" : "重新读盘"));

			return React.createElement("div", {
				style: S.sectionFor(false),
				"data-classroom-ui-section": "1",
				"data-classroom-ui-board": "1",
			}, children);
		}

		// ════════════════════════════════════════════════════════════════════
		// 6.10 · 「日记」tab（N2.5）—— 只走 `ctx.remote.classroomNarrative`
		//
		// 数据来源（宿主半边 `lib/narrative-host.mjs` 转出来的两个只读方法）：
		//   · `status()`  —— 最近一次跑完的运行有没有失败；顶部一行只在 `lastError` 非空时出现，
		//                    写清 `code + message`。这是 N1.4「错误必须在面板可见」的消费方。
		//   · `diaries()` —— `[{ date, lesson, text }]`，服务给的是时间顺序，这一页倒序展示。
		//
		// 🔴 不读 `runtime/.narrative/` 里的账本与运行日志：那是运行过程，不是展示内容
		//    （NE 报告 §7.4）。历史跨重启要读也只能走叙事服务自己的出口。
		// 🔴 叙事包没装时：两个方法回 `{ ok:false, reason:'narrative-absent' }`，
		//    这一页显示**一句中性说明**（不是报错、不白屏）——「能力缺席」与「读失败」是两件事。
		// ════════════════════════════════════════════════════════════════════

		/** 日记一次取多少条（够翻看，又不至于把右栏撑成长卷）。 */
		const DIARY_LIMIT = 20;

		// ── 6.10.0 客户端 Remote 的**两层**返回：外层是"调用通没通"，内层是"服务说行不行" ──
		//
		// 🔴 这一层是实测出来的（不是猜）：`dsh-api-gateway` 的 client 面把宿主方法的返回值
		//    **包进 `value`**：`ctx.remote.<ns>.<method>(...)` → `{ ok:true, value:<宿主返回值> }`
		//    ／ `{ ok:false, error:{ code, message } }`（`gateway-client.js` 的 `invoke`：
		//    `return { ok: true, value: ... }`）。而本插件宿主的两个方法**自己也**回
		//    `{ ok:false, reason }`（叙事包缺席 / 找不到教室 / 读失败）——
		//    两层 `ok` 各管一件事，混为一谈就会把"网关不通"说成"叙事包没装"。
		//    现有 `readText`（§2 的 workspaceFiles 通道）用的是同一个外层形状，这里保持一致。
		/**
		 * 拆外层：`{ ok:true, value }` ／ `{ ok:false, error }` → 统一的 `{ ok, value | error }`。
		 * **永不抛**（形状不对也归一成 `REMOTE_FAILED`）。
		 * @param result - remote 调用的原始返回
		 * @returns {{ok: true, value: unknown} | {ok: false, error: {code: string, message: string}}}
		 */
		function unwrapRemoteResult(result) {
			if (result === null || result === undefined || typeof result !== "object") {
				return { ok: false, error: { code: "REMOTE_FAILED", message: "Remote 返回了空结果" } };
			}
			if (result.ok === false) {
				const error = result.error !== null && typeof result.error === "object" ? result.error : {};
				return {
					ok: false,
					error: {
						code: typeof error.code === "string" && error.code.length > 0 ? error.code : "REMOTE_FAILED",
						message: typeof error.message === "string" && error.message.length > 0 ? error.message : "Remote 调用失败",
					},
				};
			}
			return { ok: true, value: result.value };
		}

		// ── 6.10.1 🔴 客户端 Remote 的挂载（契约 K4.1 没写的一步，实测补上）──
		//
		// `ctx.remote.<ns>` 的命名空间**不是**按宿主侧 `ctx.typert` 自动长出来的：
		//   浏览器侧的 `ctx.remote` 由 `dsh-api-remotes` 的那份**静态装配表**逐个
		//   `ctx.remote.$mount(contribution)` 挂出来（`dsh-api-remotes/lib/types/client/index.js`
		//   只 import 了官方包各自的 `remote` 产物）。第三方包里没有 client 面的
		//   `typert.remote-client` 产物，于是 `ctx.remote.classroomGroup` 在浏览器里**根本不存在**
		//   （活体实测：面板两页都落到"没有服务"的中性说明，宿主日志一句错都没有）。
		// 修法只有一条：由**消费方**用公开的 `ctx.remote.$mount(contribution)` 自己挂一份清单。
		//   本插件就是这两个命名空间唯一的消费方，所以清单写在这里；挂载失败只记一条警告，
		//   面板照旧显示"能力缺席"（不白屏、不把槽位崩成占位）。
		// 🔴 清单里的 codec 是**手写的 strict codec**（`{mode:'strict', typeSymbol, create()}`）：
		//   客户端产物不经打包器、`require` 只认 `react`，所以拿不到 zod；而 `$mount` 的校验只要求
		//   `mode === 'strict'` ＋ `create` 是函数（`gateway-client.js` 的 `requireStrictCodec`）。
		//   真正的编解码在宿主侧（它有完整清单），这里只负责"形状对得上"。

		/**
		 * 插件激活时记下的客户端根 Context。
		 * 🔴 为什么要它：`remote.<ns>` 是 cordis 的**服务键**（`remoteServiceKey` → `remote.<namespace>`），
		 *    读 `ctx.remote.classroomNarrative` 要求本插件在 `inject` 里声明过它；
		 *    可这两个命名空间**是本插件自己在 apply 里挂的**——声明进 `inject` 就成了死锁
		 *    （服务没挂 → 插件不激活 → 服务永远挂不上）。实测报错逐字：
		 *    `cannot get property "remote.classroomNarrative" without inject`。
		 *    `ctx.get(name)` 是"读服务但不要求 inject"的那条路（cordis 的服务存储直读），
		 *    所以这里留一份 ctx，用 `ctx.get` 取命名空间；取不到就是"没挂上"。
		 */
		let clientContext = null;

		/** 手写 strict codec（客户端只过 `$mount` 的结构校验，不做真编解码）。 */
		function passThroughCodec(typeSymbol, jsonSchema) {
			return {
				mode: "strict",
				typeSymbol: typeSymbol,
				jsonSchema: jsonSchema === undefined ? {} : jsonSchema,
				create: () => ({ parse: (value) => value }),
			};
		}

		/** `workspaceFileScope` lookup 那一条（与宿主 `typert.host.js` 的 wire 逐字一致）。 */
		function scopeParameter() {
			return {
				name: "scope",
				wire: "workspaceFileScopeId",
				source: "lookup",
				lookup: "workspaceFileScope",
				codec: passThroughCodec("@deepseek-ai/dsh-session/types#SessionId", { type: "string" }),
			};
		}

		/** 一条 JSON 参数（可选的那些显式 `acceptsUndefined`，与宿主清单一致）。 */
		function jsonParameter(name, optional) {
			return {
				name: name,
				wire: name,
				source: "json",
				...(optional === true ? { acceptsUndefined: true } : {}),
				codec: passThroughCodec("json", {}),
			};
		}

		/**
		 * 叙事只读命名空间的客户端清单：`classroomNarrative`（status / diaries）。
		 * @returns {{package: string, descriptors: Array<object>}}
		 */
		function narrativeRemoteContribution() {
			const resultCodec = () => passThroughCodec("unknown", {});
			const endpoint = (namespace, method, parameters) => ({
				id: "classroom-ui#" + namespace + "/" + method,
				service: namespace,
				namespace: namespace,
				method: method,
				invocation: { kind: "direct" },
				parameters: parameters,
				result: resultCodec(),
			});
			return {
				// 一份贡献里可以带多个命名空间（`mountContribution` 按 namespace 分组装）。
				package: "classroom-ui",
				descriptors: [
					endpoint("classroomNarrative", "status", [scopeParameter()]),
					endpoint("classroomNarrative", "diaries", [scopeParameter(), jsonParameter("limit", true)]),
				],
			};
		}

		/**
		 * 取一个 Remote 命名空间服务。
		 * 顺序：① `ctx.get('remote.<name>')`（免 inject，浏览器里的正路）；
		 *       ② 传入的 `remote` 对象上的同名属性（node 侧测试直接喂假 remote 时走这条）。
		 * **永不抛**：两条都不通就是 `null`（＝能力缺席，不是故障）。
		 * @param remote - `ctx.remote`（可能为 undefined）
		 * @param name - 命名空间名，如 `classroomNarrative`
		 * @returns {object|null}
		 */
		function remoteNamespaceOf(remote, name) {
			if (clientContext !== null && clientContext !== undefined) {
				try {
					const service = clientContext.get("remote." + name);
					if (service !== null && service !== undefined) return service;
				} catch {
					// ctx.get 在极端情况下（上下文已销毁）会抛 —— 当作"没挂上"，继续走第二条。
				}
			}
			try {
				const service = remote === null || remote === undefined ? undefined : remote[name];
				return service === null || service === undefined ? null : service;
			} catch {
				// 读 `remote.<ns>` 在没 inject 时会抛（cordis 的 accessor 会拦）——同样当缺席。
				return null;
			}
		}

		/**
		 * 把一个"异步挂载"接成 `ctx.effect` 的同步形状：effect 立刻返回一个卸载器，
		 * 挂载完成（或失败）后再补上真正的 dispose。
		 * @param ctx - 客户端根 Context
		 * @returns {() => void} 卸载器（幂等）
		 */
		function mountNarrativeRemotesEffect(ctx) {
			let dispose = null;
			let dead = false;
			const remote = ctx === null || ctx === undefined ? undefined : ctx.remote;
			const mount = remote === null || remote === undefined ? undefined : remote.$mount;
			if (typeof mount !== "function") {
				// 宿主版本没有 `$mount`（或 remote 没注入）：两页会落到"缺席"说明，这是对的形状。
				return () => {};
			}
			Promise.resolve(mount.call(remote, narrativeRemoteContribution())).then(
				(fn) => { if (dead) { if (typeof fn === "function") fn(); return; } dispose = fn; },
				(error) => {
					// 最可能的两种：命名空间已被别处挂过（未来的叙事包自带 client 面）、清单形状被新版拒收。
					// 两种都不该让面板崩，只留一条可查的警告。
					if (typeof console !== "undefined" && console !== null && typeof console.warn === "function") {
						console.warn("[classroom-ui] 叙事/群聊 Remote 挂载失败：", messageOf(error));
					}
				},
			);
			return () => {
				dead = true;
				if (dispose !== null && typeof dispose === "function") {
					dispose();
					dispose = null;
				}
			};
		}

		/**
		 * 一条日记的排序键（缺字段也给确定值，**不猜**）。
		 * @param entry - `{ date, lesson, text }`
		 * @returns {{date: string, lesson: number}}
		 */
		function diarySortKey(entry) {
			const date = entry !== null && entry !== undefined && typeof entry.date === "string" ? entry.date : "";
			const raw = entry === null || entry === undefined ? null : entry.lesson;
			const lesson = typeof raw === "number" && Number.isFinite(raw) ? raw : -1;
			return { date: date, lesson: lesson };
		}

		/**
		 * 日记按**时间倒序**（近的在上）。
		 * 服务返回的是文件顺序（＝时间顺序），这里复制后倒排——不改服务手里那一份。
		 * 同一天多条（补写/复写）时按讲次倒序；日期缺失的排在最后（不给它们编一个日期）。
		 * @param entries - 服务返回的 `entries`
		 * @returns {Array<object>}
		 */
		function sortDiariesDesc(entries) {
			const list = Array.isArray(entries) ? entries.slice() : [];
			list.sort((left, right) => {
				const a = diarySortKey(left);
				const b = diarySortKey(right);
				if (a.date !== b.date) return a.date < b.date ? 1 : -1;
				return b.lesson - a.lesson;
			});
			return list;
		}

		/**
		 * 把叙事服务的失败形状翻成**人话**（reason 是稳定的，message 是给人看的）。
		 * @param result - `{ ok:false, reason, message? }`
		 * @returns {string}
		 */
		function describeNarrativeFailure(result) {
			const reason = result !== null && result !== undefined && typeof result.reason === "string" ? result.reason : "unknown";
			const message = result !== null && result !== undefined && typeof result.message === "string" ? result.message : "";
			const head = {
				"narrative-absent": "叙事服务未部署",
				"no-classroom": "找不到教室目录",
				"read-failed": "读日记失败",
				"status-failed": "读叙事状态失败",
			}[reason];
			return (head === undefined ? "叙事服务回了失败（" + reason + "）" : head) + (message === "" ? "" : "：" + message);
		}

		/**
		 * 读「日记」页的全部数据：`status` ＋ `diaries`。
		 * **永不抛**——四种终态各有明确出口：`absent` / `ready` / `failed` / `empty`（empty 由 ready＋空表推出）。
		 * @param remote - `ctx.remote`
		 * @param sessionId - 会话 id（网关据此解析 `workspaceFileScope`）
		 * @param limit - 条数
		 * @returns {Promise<{kind: string, entries: Array<object>, bad: number, lastError: object|null, message: string|null}>}
		 */
		async function loadDiaryPage(remote, sessionId, limit) {
			const service = remoteNamespaceOf(remote, "classroomNarrative");
			if (service === null || typeof service.status !== "function") {
				return { kind: "absent", entries: [], bad: 0, lastError: null, message: null };
			}
			/** 常见终态构造器（四处一样，写一次）。 */
			const absent = () => ({ kind: "absent", entries: [], bad: 0, lastError: null, message: null });
			const failed = (message) => ({ kind: "failed", entries: [], bad: 0, lastError: null, message: message });
			try {
				// ① 状态：外层 `{ok,value}` → 内层 `{ok,status}` / `{ok:false,reason}`
				const statusOuter = unwrapRemoteResult(typeof service.status === "function" ? await service.status(sessionId) : null);
				if (!statusOuter.ok) return failed(describeRemoteFailure(statusOuter.error));
				const status = statusOuter.value;
				if (status !== null && status !== undefined && status.ok === false && status.reason === "narrative-absent") return absent();
				if (status === null || status === undefined || status.ok !== true) return failed(describeNarrativeFailure(status));

				// ② 条目：同样两层
				const listedOuter = unwrapRemoteResult(await service.diaries(sessionId, limit));
				if (!listedOuter.ok) return failed(describeRemoteFailure(listedOuter.error));
				const listed = listedOuter.value;
				if (listed !== null && listed !== undefined && listed.ok === false && listed.reason === "narrative-absent") return absent();
				if (listed === null || listed === undefined || listed.ok !== true) return failed(describeNarrativeFailure(listed));

				const inner = status.status;
				const lastError = inner !== null && inner !== undefined && inner.lastError !== null && inner.lastError !== undefined
					? inner.lastError
					: null;
				return {
					kind: "ready",
					entries: sortDiariesDesc(listed.entries),
					bad: typeof listed.bad === "number" ? listed.bad : 0,
					lastError: lastError,
					message: null,
				};
			} catch (error) {
				return failed(messageOf(error));
			}
		}

		/**
		 * 外层失败（网关/传输）→ 人话。`code` 原样保留（它比文案稳定）。
		 * @param error - `{ code, message }`
		 * @returns {string}
		 */
		function describeRemoteFailure(error) {
			const code = error !== null && error !== undefined && typeof error.code === "string" ? error.code : "REMOTE_FAILED";
			const message = error !== null && error !== undefined && typeof error.message === "string" ? error.message : "";
			return message === "" ? code : code + " — " + message;
		}

		/**
		 * 一行 `lastError` 的文字：`code — message`（两个都可能缺，缺哪个就少哪个，不编）。
		 * @param error - `{ code, message }`
		 * @returns {string}
		 */
		function describeLastError(error) {
			if (error === null || error === undefined) return "";
			const code = typeof error.code === "string" ? error.code : "";
			const message = typeof error.message === "string" ? error.message : "";
			if (code === "" && message === "") return "（叙事服务没给出原因）";
			if (code === "") return message;
			return message === "" ? code : code + " — " + message;
		}

		/**
		 * 「日记」tab：按时间倒序的条目列 ＋ 顶部错误状态。
		 * @param props - `{ remote, sessionId }`
		 */
		function DiaryView(props) {
			const S = styles();
			const remote = props.remote;
			const sessionId = props.sessionId;
			const [page, setPage] = React.useState({ kind: "loading", entries: [], bad: 0, lastError: null, message: null });
			const [reloadSeq, setReloadSeq] = React.useState(0);

			React.useEffect(() => {
				let live = true;
				setPage((previous) => Object.assign({}, previous, { kind: "loading" }));
				loadDiaryPage(remote, sessionId, DIARY_LIMIT).then(
					(result) => { if (live) setPage(result); },
					(error) => { if (live) setPage({ kind: "failed", entries: [], bad: 0, lastError: null, message: messageOf(error) }); },
				);
				return () => { live = false; };
			}, [sessionId, reloadSeq]);

			const children = [];
			children.push(React.createElement("div", { style: S.sectionLabel, key: "label" }, "日记 · 时间倒序"));

			if (page.kind === "absent") {
				// 中性说明：没装叙事包不是故障，是"这个教室还没有这个能力"。
				children.push(React.createElement("div", {
					style: S.note,
					key: "absent",
					"data-cui-diary-absent": "1",
				}, "这个工作区没有叙事服务（没装叙事包），所以还没有日记。装上之后，每上完一节课它会自己写一条。"));
			}

			if (page.kind === "failed") {
				children.push(React.createElement("div", {
					style: S.error,
					key: "failed",
					"data-cui-diary-error": "1",
				}, "读日记失败：" + String(page.message)));
			}

			// 🔴 顶部错误状态：**只在有错时出现**（N1.4 的消费方）。
			//    「后来成功了」不清空 lastError（服务端的语义就是"最近一次失败"，见 README §3）。
			if (page.lastError !== null) {
				children.push(React.createElement("div", {
					style: S.error,
					key: "last-error",
					"data-cui-diary-status-error": "1",
				}, "上次写日记失败：" + describeLastError(page.lastError)));
			}

			if (page.kind === "ready" && page.entries.length === 0) {
				children.push(React.createElement("div", {
					style: S.note,
					key: "empty",
					"data-cui-diary-empty": "1",
				}, "还没有日记。上完一节课（收课）后，这里会出现那节课的一条。"));
			}

			if (page.entries.length > 0) {
				const rows = page.entries.map((entry, index) => {
					const key = diarySortKey(entry);
					const lesson = key.lesson < 0 ? "讲次未定" : "第 " + String(key.lesson) + " 讲";
					const text = entry !== null && entry !== undefined && typeof entry.text === "string" ? entry.text : "";
					return React.createElement("div", {
						style: S.diaryItem,
						key: "d" + String(index) + "-" + key.date,
						"data-cui-diary-item": key.date === "" ? "" : key.date,
						"data-cui-diary-lesson": key.lesson < 0 ? "" : String(key.lesson),
					}, [
						React.createElement("div", { style: S.diaryHead, key: "head" }, [
							React.createElement("span", { style: S.diaryDate, key: "date" }, key.date === "" ? "日期未记" : key.date),
							React.createElement("span", { style: S.diaryLesson, key: "lesson" }, lesson),
						]),
						React.createElement("div", { style: S.diaryText, key: "text" }, text),
					]);
				});
				children.push(React.createElement("div", {
					style: S.diaryList,
					key: "list",
					"data-cui-diary-list": String(page.entries.length),
				}, rows));
			}

			if (page.bad > 0) {
				children.push(React.createElement("div", { style: S.note, key: "bad", "data-cui-diary-bad": String(page.bad) },
					"另有 " + String(page.bad) + " 条日记格式不完整，已跳过（叙事服务报的计数，不是猜的）。"));
			}

			children.push(React.createElement("button", {
				type: "button",
				className: "cui-act",
				key: "refresh",
				style: S.button,
				"data-cui-diary-refresh": "1",
				onClick: () => { setReloadSeq((value) => value + 1); },
			}, page.kind === "loading" ? "读取中…" : "重新读盘"));

			return React.createElement("div", {
				style: S.sectionFor(false),
				"data-classroom-ui-section": "1",
				"data-classroom-ui-diary": "1",
			}, children);
		}

		// ── 6.7 的视图：`classroom_draw` 那一条工具调用 ──────────────────────────

		/**
		 * 从 `block` 里取"这次调用画的是什么"。
		 * 官方契约（`ToolCallOwnerProps.block: ToolCallBlock`，逐字见安装版座目录
		 * `dsh-cordis-client-runner/lib/client.js:4497` 那一条的 `ownerProps`）：
		 *   - 运行中：`{callId, name, argsRaw, turn, step, time, subCalls}`（**没有** `kind` 字段）；
		 *   - 已结束：`{kind:'tool-result', seq, time, callId, call:{name,argsRaw}|null, callTime,
		 *              content, isError, error?, subCalls}`。
		 * 判定法逐字抄官方自己的写法（`dsh-client-ui-tool/lib/client.js:951-960` 的 `toolRowModel`）：
		 * `const done = "kind" in block`。
		 * @param block - 工具调用节点
		 * @returns {done, callId, name, argsRaw, isError, content}
		 */
		function drawBlockModel(block) {
			const done = block !== null && block !== undefined && "kind" in block;
			const argsRaw = done
				? (block.call === null || block.call === undefined ? null : block.call.argsRaw)
				: (block === null || block === undefined ? null : block.argsRaw);
			return {
				done: done,
				callId: block === null || block === undefined ? null : block.callId,
				name: done
					? (block.call === null || block.call === undefined ? null : block.call.name)
					: (block === null || block === undefined ? null : block.name),
				argsRaw: typeof argsRaw === "string" ? argsRaw : "",
				isError: done && block.isError === true,
				content: done ? block.content : null,
			};
		}

		/** 工具结果的纯文本（官方 `resultText` 的简化：只取 text 块，不猜别的类型）。 */
		function toolResultText(content) {
			if (!Array.isArray(content)) return null;
			const parts = [];
			for (const entry of content) {
				if (entry !== null && typeof entry === "object" && entry.type === "text" && typeof entry.text === "string") parts.push(entry.text);
			}
			return parts.length === 0 ? null : parts.join("\n");
		}

		/**
		 * 降级态：**源码 ＋ 一句说明**。
		 * 🔴 这是本组件的兜底，绝不允许"白屏"：只要拿不到图，就把**源码原样摆出来**——
		 *    学生至少能照着源码把图画出来，老师也能一眼看出"客户端没画成"。
		 * @param props - {source, reason, extra}
		 */
		function DrawSourceFallback(props) {
			const S = styles();
			const children = [];
			if (props.reason !== null && props.reason !== undefined) {
				children.push(React.createElement("div", { style: S.drawFallbackWhy, key: "why" }, props.reason));
			}
			children.push(React.createElement("div", { style: S.drawMeta, key: "label" }, "下面是这次调用要画的 mermaid 源码（原样，未截断渲染输入）"));
			const source = props.source === null || props.source === undefined ? "（这次调用没有可读的源码）" : props.source;
			children.push(React.createElement("pre", { style: S.drawSource, key: "src", "data-classroom-ui-draw-source": "1" }, source));
			if (props.extra !== null && props.extra !== undefined) {
				children.push(React.createElement("div", { style: S.drawMeta, key: "extra" }, props.extra));
			}
			return React.createElement("div", { style: S.drawFallback, "data-classroom-ui-draw": "fallback" }, children);
		}

		/**
		 * 消息流里那张图。
		 *
		 * 三种终态，每一种都有明确出口（**没有一种会白屏**）：
		 *   ① `ok`      → `<svg>` 画出来（`dangerouslySetInnerHTML`；内容来自 mermaid 自己的渲染
		 *                  产物，且 `securityLevel:'strict'` 下过 DOMPurify，与官方对 Shiki/KaTeX
		 *                  产物的处理同一口径）；
		 *   ② `failed`  → 降级成「源码 ＋ 为什么没画成」；
		 *   ③ 源码本身不合法（服务端已挡过，客户端仍可能遇到历史会话/手工构造）→ 同 ②。
		 * 另：`argsRaw` 为空（工具调用刚开始、参数还没到）→ 显示"参数接收中"，不算失败。
		 */
		function ClassroomDrawView(props) {
			const S = styles();
			const block = props.block;
			const model = drawBlockModel(block);
			const parsed = parseDrawArgs(model.argsRaw);

			const [themeName, setThemeName] = React.useState(() => (isDarkTheme() ? "dark" : "light"));
			const [state, setState] = React.useState({ kind: "idle", svg: null, ms: null, message: null });
			/** 图挂在哪：动画必须在**挂载之后**跑（`getBBox`/`getTotalLength` 要求元素在文档里）。 */
			const canvasRef = React.useRef(null);

			// 主题变化（官方切 body 属性）→ 重渲染换配色
			React.useEffect(() => watchDarkTheme(() => { setThemeName(isDarkTheme() ? "dark" : "light"); }), []);

			const source = parsed.ok ? parsed.source : null;
			React.useEffect(() => {
				if (source === null) return undefined;
				let live = true;
				setState({ kind: "loading", svg: null, ms: null, message: null });
				diagramFor({
					remote: props.remote,
					sessionId: props.sessionId,
					source: source,
					themeName: themeName,
					signal: undefined,
				}).then(
					(result) => { if (live) setState({ kind: "ok", svg: result.svg, ms: result.ms, message: null }); },
					(error) => { if (live) setState({ kind: "failed", svg: null, ms: null, message: messageOf(error) }); },
				);
				return () => { live = false; };
			}, [source, themeName, props.sessionId]);

			// ── 逐层长出（候选 B）：**挂载之后**才动 DOM ────────────────────────────
			// 🔴 依赖**只能是 `state.svg`**：
			//    · 依赖 `themeName` 会让换主题时多跑一次（换主题已经通过 `state.svg` 变化触发了）；
			//    · 依赖 `parsed.kind` 会在每次渲染都跑一遍（`parseDrawArgs` 每次返回新对象）。
			// 🔴 为什么放在这里而不是 `renderDiagram`：见 §6.8 的说明（那边只有字符串，没有 DOM）。
			// 清理时 `finish()` 把元素**还原成终态**（组件卸载/换图都不许留一半藏着的元素）。
			//
			// 🔴 **只在"图的内容真的变了"时重播**（EXPR-3 小修 ①）：
			//    切深浅色会**换掉整份 `state.svg` 字符串**（配色变量写进了 SVG），于是这个 effect
			//    会重跑一遍 → 用户切主题时**整张图又长一遍**，观感像 bug。
			//    判据用**内容键**（图的源码 ＋ 类型）而不是 svg 字符串：
			//      · 主题切换 → 内容键不变 → **不重播**（只换色）；
			//      · 换一条新图源 → 内容键变了 → **照常重播**。
			const animKeyRef = React.useRef(null);
			const animKey = drawAnimKey(props.sessionId, parsed.kind, source);
			React.useEffect(() => {
				const host = canvasRef.current;
				if (host === null) return undefined;
				const svg = host.querySelector("svg");
				if (svg === null) return undefined;
				if (animKeyRef.current === animKey) {
					// 🔴 图的内容没变（例如**只换了深浅色**：配色变了、svg 字符串变了，但内容键没变）
					//    → **不重播**。这里留一条诊断，好让"确实跑了、且确实跳过了"可被取证
					//    （否则"什么都没发生"与"整条链路没接上"看起来一样）。
					recordDiag({ at: "drawAnim", mode: "skipped", reason: "content-unchanged", replayKey: animKey.length });
					return undefined;
				}
				animKeyRef.current = animKey;
				if (drawAnimMode() === "none") return undefined;
				const animation = animateStagger(svg, { kind: parsed.kind === null ? "" : parsed.kind });
				recordDiag({ at: "drawAnim", mode: "stagger", total: animation.total, units: animation.units, edges: animation.edges, rawLayers: animation.rawLayers, layers: animation.layers, replayKey: animKey.length });
				animation.play();
				return () => { animation.finish(); };
			}, [state.svg]);

			// ── 状态行（工具名 ＋ 状态 ＋ 关键入参摘要）：**常显**，与官方工具行的信息量对齐 ──
			const statusText = model.done ? (model.isError ? "工具报错" : "已完成") : "运行中";
			const metaParts = [DRAW_TOOL_NAME, statusText];
			if (parsed.kind !== null) metaParts.push(parsed.kind);
			if (source !== null) metaParts.push(String(source.split("\n").length) + " 行源码");
			if (state.kind === "ok") metaParts.push("渲染 " + String(state.ms) + " ms");

			const children = [];

			// 标题：工具给的一行标题优先，没有就用图类型
			const heading = parsed.title !== null && parsed.title !== "" ? parsed.title : (parsed.kind === null ? "板书图" : "板书图 · " + parsed.kind);
			children.push(React.createElement("div", { style: S.drawTitle, key: "title" }, heading));
			children.push(React.createElement("div", { style: S.drawMeta, key: "meta" }, metaParts.join(" · ")));

			if (!parsed.ok) {
				// 入参都读不出来（空/非 JSON/没有 source）→ 直接降级，并把原因写清楚
				children.push(React.createElement(DrawSourceFallback, { key: "fallback", source: null, reason: parsed.reason, extra: null }));
				return React.createElement("div", { style: Object.assign({}, S.drawCard, S.vars), "data-classroom-ui-draw": "invalid" }, children);
			}

			if (state.kind === "ok" && state.svg !== null) {
				children.push(React.createElement("div", {
					key: "svg",
					ref: canvasRef,
					style: S.drawCanvas,
					"data-classroom-ui-draw": "svg",
					dangerouslySetInnerHTML: { __html: state.svg },
				}));
			} else if (state.kind === "failed") {
				children.push(React.createElement(DrawSourceFallback, {
					key: "fallback",
					source: source,
					reason: "这张图在浏览器里没画出来（mermaid 渲染报错）：" + String(state.message),
					extra: null,
				}));
			} else {
				children.push(React.createElement("div", { style: S.drawFallback, key: "loading", "data-classroom-ui-draw": "loading" },
					React.createElement("div", { style: S.drawFallbackWhy }, "正在装载 mermaid 并画图…"),
					React.createElement("pre", { style: S.drawSource, "data-classroom-ui-draw-source": "1" }, source),
				));
			}

			if (parsed.caption !== null && parsed.caption !== "") {
				children.push(React.createElement("div", { style: S.drawCaption, key: "caption" }, parsed.caption));
			}

			// 源码与工具结果收进 `<details>`：默认不占版面，但**永远可查**（不是藏起来）
			const details = [];
			details.push(React.createElement("summary", { style: S.drawSummary, className: "cui-sum", key: "sum" }, "看源码与工具结果"));
			details.push(React.createElement("pre", { style: S.drawSource, key: "src", "data-classroom-ui-draw-source": "1" }, source));
			const resultText = toolResultText(model.content);
			if (resultText !== null) {
				details.push(React.createElement("div", { style: S.drawMeta, key: "res" }, "工具结果：" + resultText));
			}
			children.push(React.createElement("details", { style: S.drawDetails, key: "details" }, details));

			return React.createElement("div", {
				style: Object.assign({}, S.drawCard, S.vars),
				"data-classroom-ui-draw": "card",
				// 这一档实际生效的动画模式（验收脚本读它，不靠猜配置有没有被读到）
				"data-classroom-ui-draw-anim": drawAnimMode(),
			}, children);
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
			// 皮肤里那几条只有 CSS 能表达的规则（`:hover` / `:focus-visible` / `summary::marker`）。
			// 幂等；规则只引 `--cui-*` 变量，故换方向不用重插。
			installSkinCss();
			clientContext = ctx;

			// ── 叙事/群聊两个 Remote 命名空间：**由本插件自己挂**（见 §6.10.1 的说明）──
			// 客户端 `ctx.remote` 的命名空间来自静态装配表，第三方包没有 client 面的 remote 产物，
			// 所以不挂这两个命名空间，面板就只能显示"没有服务"。挂载是异步的，effect 同步返回卸载器。
			ctx.effect(() => mountNarrativeRemotesEffect(ctx), "classroom-ui: 叙事 Remote（日记 / 群聊）");

			ctx.effect(() => ctx.sidebarRightTabs.register({
				id: TYPE_ID,
				kind: TYPE_KIND,
				priority: "extension",
				title: () => PANEL_TITLE,
				guide: [{
					// 🔴 2026-10-19：0.1.5 的指南条目读的是 `entry.kind`（`GuideBody.js` 里
					//   `openTab(entry.kind)` 与 `data-sidebar-right-guide-entry={entry.kind}` 都取这个字段）。
					//   原来这里只写了 `id`，于是 kind 为 undefined → openTab(undefined) → **面板永远打不开**，
					//   而注册本身不报错、日志里也看不出来。`id` 保留是为了兼容按 id 读的版本。
					id: "classroom",
					kind: TYPE_KIND,
					order: 10,
					title: () => PANEL_TITLE,
					description: () => "课程表 · 本轮要讲 · 当课老师 · 进度",
				}],
			}), "classroom-ui: tab 类型");

			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: TYPE_ID,
				inject: (sessionId) => ({ classroom: storeFor(ctx, sessionId), portrait: portraitFaceFor(ctx, sessionId) }),
			}, ClassroomBody)), "classroom-ui: 面板主体");

			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
				name: "sidebar.right.pane.tab.title",
				key: TYPE_ID,
				inject: (sessionId) => ({ classroom: storeFor(ctx, sessionId) }),
			}, ClassroomTitle)), "classroom-ui: tab 标题");

			// ── 板书图：`classroom_draw` 那一条工具调用在消息流里画成图 ──────────────
			// 槽位契约（安装版座目录 `dsh-cordis-client-runner/lib/client.js:4497` 那一条，逐字）：
			//   key: "tool.call.toolview" · kind: "keyed" · scope: "session"
			//   summary: "Keyed atomic Tool call view, dispatched by the wire Tool name."
			//   keyDomain: "open: any string the owner dispatches (no compile-time key set)" —— **开放键域**
			//   replaceRisk: "shadows-shipped-ui"
			// 🔴 这一条是**加法不是接管**：官方 `occupants` 里没有 `classroom_draw`，注册它＝给自家工具
			//    新增一种行内视图；**其它任何工具名都不受影响**，一个都没被替换（见报告 §回归）。
			//    组件拿到的是 owner props（callId / toolName / block / cwd / openFile / inspect…）
			//    ＋ 标准 kit（含 `sessionId`）＋ 本插件 inject 进去的 `remote`（owner props 优先级最高，
			//    故 `remote` 不会被同名键覆盖；本插件也不注册任何与标准 kit 同名的键）。
			ctx.effect(() => ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
				name: "tool.call.toolview",
				key: DRAW_TOOL_NAME,
				inject: () => ({ remote: ctx.remote }),
			}, ClassroomDrawView)), "classroom-ui: 板书图（classroom_draw 工具视图）");
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
		// ── 立绘（§6.5）：纯函数一并导出，供 node 侧测试直接驱动同一份代码 ──
		exports.uiConfig = uiConfig;
		exports.live2dRoot = live2dRoot;
		exports.modelName = modelName;
		exports.debugEnabled = debugEnabled;
		exports.mimeOf = mimeOf;
		exports.base64ToBytes = base64ToBytes;
		exports.decodeText = decodeText;
		exports.readBinary = readBinary;
		exports.bytesOfWorkspaceFile = bytesOfWorkspaceFile;
		// ── D1–D4（面板待机立绘）：帧率/暂停/来源链，纯函数与常量一并导出供 node 侧测试直接驱动 ──
		exports.PORTRAIT_FPS = PORTRAIT_FPS;
		exports.PORTRAIT_FRAME_MS = PORTRAIT_FRAME_MS;
		exports.PORTRAIT_IDLE_ONLY = PORTRAIT_IDLE_ONLY;
		exports.PORTRAIT_CANVAS_SIZE = PORTRAIT_CANVAS_SIZE;
		exports.STAGE_ROUTE = STAGE_ROUTE;
		exports.STAGE_OVERLAY_ID = STAGE_OVERLAY_ID;
		exports.DEFAULT_PORTRAIT_ASSETS = DEFAULT_PORTRAIT_ASSETS;
		exports.DEFAULT_STATIC_PORTRAIT = DEFAULT_STATIC_PORTRAIT;
		exports.DEFAULT_MODEL = DEFAULT_MODEL;
		exports.portraitAssetsRoot = portraitAssetsRoot;
		exports.staticPortraitPath = staticPortraitPath;
		exports.coreCandidates = coreCandidates;
		exports.frameworkCandidates = frameworkCandidates;
		exports.shaderCandidates = shaderCandidates;
		exports.assetCandidates = assetCandidates;
		exports.diagramsIndexPath = diagramsIndexPath;
		exports.diagramPath = diagramPath;
		exports.stageOverlayOpen = stageOverlayOpen;
		exports.loadScriptOnce = loadScriptOnce;
		exports.stageRuntime = stageRuntime;
		/** **仅供 node 侧测试**：清掉"舞台路由/运行时只探一次"的缓存，好在一个进程里摆多种环境。 */
		exports.resetStageProbe = () => {
			stageRouteProbe = null;
			stageRuntimeProbe = null;
			coreReady = null;
			frameworkModule = null;
		};
		/** **仅供 node 侧测试**：立绘资源来源账本（面板诊断显示的就是它）。 */
		exports.portraitSourcesSnapshot = () => Object.assign({}, portraitSources);
		exports.modelReferences = modelReferences;
		exports.phaseStateOf = phaseStateOf;
		exports.PHASE_STATES = PHASE_STATES;
		// ── 表情（EXPR-3）：状态文件的解析/计划 ＋ 逐参数驱动器，一并导出供 node 侧测试直接驱动 ──
		exports.parseExpression = parseExpression;
		exports.parseExpressionFace = parseExpressionFace;
		exports.expressionLine = expressionLine;
		exports.expressionPlan = expressionPlan;
		exports.expressionKey = expressionKey;
		exports.EXPRESSION_PATH_ORDER = EXPRESSION_PATH_ORDER;
		exports.EXPRESSION_PATH_LABEL = EXPRESSION_PATH_LABEL;
		exports.EXPRESSION_POLL_MS = EXPRESSION_POLL_MS;
		exports.createFaceDriver = createFaceDriver;
		exports.parameterIndexMap = parameterIndexMap;
		// ── 部署声明与一致性自检（EXPR-5）：纯函数一并导出，供 node 侧测试直接驱动同一份代码 ──
		exports.DEFAULT_DECLARATION_PATH = DEFAULT_DECLARATION_PATH;
		exports.declarationPath = declarationPath;
		exports.ensureDeclaration = ensureDeclaration;
		/** **仅供 node 侧测试**：清掉"本页面只读一次"的缓存，好在一个进程里摆出多种声明形态。 */
		exports.resetDeclarationCache = () => {
			declarationRead = null;
			declarationResolved = null;
		};
		exports.parseDeclaration = parseDeclaration;
		exports.normalizeRelativePath = normalizeRelativePath;
		exports.checkDeployment = checkDeployment;
		exports.FACE_LERP_K = FACE_LERP_K;
		exports.FACE_UPDATER_ORDER = FACE_UPDATER_ORDER;
		exports.SHADER_FILES = SHADER_FILES;
		exports.ASSET_SCHEME = ASSET_SCHEME;
		exports.SHADER_DIR = SHADER_DIR;
		exports.DEBUG_FEED_TEXT = DEBUG_FEED_TEXT;
		exports.installAssetResolver = installAssetResolver;
		exports.materializeAssets = materializeAssets;
		// ── 板书图（§6.7）：纯函数与装载器一并导出，供 node 侧测试直接驱动同一份代码 ──
		exports.DRAW_TOOL_NAME = DRAW_TOOL_NAME;
		exports.DEFAULT_MERMAID_PATH = DEFAULT_MERMAID_PATH;
		exports.mermaidPath = mermaidPath;
		exports.mermaidBundlePath = mermaidBundlePath;
		exports.parseDrawArgs = parseDrawArgs;
		exports.drawBlockModel = drawBlockModel;
		exports.toolResultText = toolResultText;
		exports.mermaidInitConfigFor = mermaidInitConfigFor;
		exports.CLAUDE_MERMAID_LIGHT = CLAUDE_MERMAID_LIGHT;
		exports.CLAUDE_MERMAID_DARK = CLAUDE_MERMAID_DARK;
		exports.CLAUDE_MERMAID_THEME_CSS = CLAUDE_MERMAID_THEME_CSS;
		exports.DIAGRAM_THEME_REV = DIAGRAM_THEME_REV;
		exports.DRAW_ANIM_DEFAULT = DRAW_ANIM_DEFAULT;
		exports.drawAnimMode = drawAnimMode;
		exports.drawAnimKey = drawAnimKey;
		exports.parameterShape = parameterShape;
		exports.animateStagger = animateStagger;
		exports.isDarkTheme = isDarkTheme;
		exports.loadMermaid = loadMermaid;
		exports.renderDiagram = renderDiagram;
		exports.diagramFor = diagramFor;
		exports.recordDiag = recordDiag;
		exports.recordRenderFailure = recordRenderFailure;
		// ── 板书历史（W-p §6.9）：纯解析器与读盘器一并导出，供 node 侧测试直接驱动同一份代码 ──
		exports.DIAGRAMS_INDEX = DIAGRAMS_INDEX;
		exports.DIAGRAMS_SUBDIR = DIAGRAMS_SUBDIR;
		exports.splitTableRow = splitTableRow;
		exports.parseDiagramIndex = parseDiagramIndex;
		exports.loadDiagramHistory = loadDiagramHistory;
		exports.readDiagramSource = readDiagramSource;
		// ── 皮肤（§6）：参数表与解析器一并导出，供 node 侧测试直接驱动同一份代码 ──
		exports.SKIN_PRESETS = SKIN_PRESETS;
		exports.DEFAULT_SKIN = DEFAULT_SKIN;
		exports.skinId = skinId;
		exports.styles = styles;
		exports.buildStyles = buildStyles;
		exports.typeRole = typeRole;
		exports.TYPE_STEPS = TYPE_STEPS;
		exports.SANS = SANS;
		exports.MONO = MONO;
		/** 第三套字面（[自己定]，宿主无 serif token）：面板的书名/章题用它，见 `SERIF` 说明。 */
		exports.SERIF = SERIF;
		exports.PANEL_FRAME = PANEL_FRAME;
		/** 当前主题档（`"light"` / `"dark"`）：書庫纸面按它取哪一套。 */
		exports.themeMode = themeMode;
		exports.SKIN_CSS = SKIN_CSS;
		exports.installSkinCss = installSkinCss;
		// ── 面板主体（供 node 侧测试把**真实组件**渲染成一棵可断言的树）──
		exports.ClassroomBody = ClassroomBody;
		exports.BoardHistory = BoardHistory;
		exports.ClassroomTitle = ClassroomTitle;
		exports.Field = Field;
		exports.PortraitStage = PortraitStage;
		// ── 「日记」（N2.5）：纯函数与读盘器一并导出，
		//    供 node 侧测试直接驱动同一份代码（排序、失败归一都不在组件里另写一遍）──
		exports.narrativeRemoteContribution = narrativeRemoteContribution;
		exports.mountNarrativeRemotesEffect = mountNarrativeRemotesEffect;
		exports.unwrapRemoteResult = unwrapRemoteResult;
		exports.remoteNamespaceOf = remoteNamespaceOf;
		exports.describeRemoteFailure = describeRemoteFailure;
		exports.passThroughCodec = passThroughCodec;
		exports.DiaryView = DiaryView;
		exports.sortDiariesDesc = sortDiariesDesc;
		exports.diarySortKey = diarySortKey;
		exports.loadDiaryPage = loadDiaryPage;
		exports.describeNarrativeFailure = describeNarrativeFailure;
		exports.describeLastError = describeLastError;
		exports.DIARY_LIMIT = DIARY_LIMIT;

		return module.exports;
	},
});
