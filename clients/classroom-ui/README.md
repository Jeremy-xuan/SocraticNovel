# classroom-ui · 教室面板（DSH 客户端插件）

> 产出：T1（面板骨架）＋ **T5（立绘挂载）** ＋ **T3（消息流里的板书图）** ＋ SKIN-1（皮肤：三个方向预览）· 2026-09-24
> **＋ SKIN-2（皮肤定稿：「書庫」＝ B 讲台骨架 ＋ C 書庫材质）· 2026-09-25**
> 形态：**客户端插件**（浏览器半边做界面）＋ **空宿主半边**（只为让 Loader 行可挂载）
> 一句话：在 DSH 右侧栏注册一个「教室」tab，把教室自己的文件（课程表 / 本轮要讲 / 当前环节 / 当课老师 / 进度）真读盘显示出来，
> **把 Live2D 立绘挂进同一块面板**（相位驱动状态、说话/写字两条嘴型通道），
> **并把老师调 `classroom_draw` 画的那张图直接画在消息流里**（§4.6）。
> 🔴 **面板长什么样以 §4.7 为准**：方向已定稿为唯一一个 `library`（書庫）——不再是"三个待挑的预览"。

## 1 · 目录

| 文件 | 作用 |
|---|---|
| `package.json` | `dsh.bundle.patch`（成为 profile 的一层）＋ `dsh.client`（浏览器 roster 声明）＋ `exports["./client"]`（浏览器半边产物路径） |
| `cordis.patch.yml` | 往 profile 树里插一行 loader 条目（`id/name = classroom-ui`） |
| `lib/index.js` | 宿主半边：挂**一个**只读 Remote 服务 `classroomNarrative`（「日记」tab 的数据口）。叙事包缺席时也要 provide —— 面板靠这个命名空间在不在判断「叙事包装没装」 |
| `lib/remote-service.mjs` | 本地「typert source-mode 远程服务」基类 ＋ `markRemote()`。**不 import `@deepseek-ai/dsh-typert-protocol`**（理由与逐字段契约见该文件头与 §5.1） |
| `lib/client.js` | 浏览器半边：**手写的产物文件**（`window.__ModuleLoader__.load({id, factory})` 格式）。① 注册 tab 类型 + 面板主体 + 标题；② 读盘与解析（§3–§4）；③ **立绘挂载**（§4.5 与文件里的 §6.5）；④ **板书图：`classroom_draw` 的工具视图**（§4.6 与文件里的 §6.7）；⑤ **皮肤**（§4.7：`SKIN_PRESETS` 一张参数表 ＋ 由它派生的样式；SKIN-2 起**只有一个方向 `library`**） |
| `test/panel.test.mjs` | node 侧测试：**驱动 `lib/client.js` 的真实代码**，喂**真实教室文件与真实 model3.json**，覆盖解析、分页读取、单文件失败、相位映射、model3 引用枚举、base64、私有 scheme 解析器、**板书图的入参解析/节点形状/主题映射**，以及 **§10 的视觉 DOM 断言**（用最小 React 替身把**真实组件**渲染成树，断言書庫的木框/纸面/书脊/索引/层级手段） |
| `vendor/mermaid-11.17.2/mermaid.min.js` | **本插件自带的 mermaid 浏览器产物**（单文件 IIFE 构建，3.57 MB）。版本、下载命令、与「服务端判据同一份」的哈希对照见同目录 `BUILD-INFO.txt` |
| `evidence/` | 验收截图（见 §6） |

> **本插件没有别的资源文件**（立绘资源在运行时从只读的 `live2d-host/out/` 读），`package.json` 的 `files` 已列出 `lib/`、`cordis.patch.yml`、`README.md` 与 **`vendor/`**。
> 🔴 **往包里加文件必须同步加进 `files`**（坑见 §5），否则 pnpm 装 `file:` 依赖时不会带上它——mermaid 产物漏了的话，图就永远画不出来。


## 2 · 挂载点（为什么是这三个 slot）

> 🔴 **外部源码说明（贯穿全文）**：下面引用的 `ui-sidebar-right`、`dsh-client-*`、`dsh-api-workspace-files`、`dsh-client-connection`、`packages/…`、`@deepseek-ai/dsh/…`、`contract/seed.ts`、`tmp/dsh-installed/…`、`bin.js` 等均为**安装版 / 上游 DSH 客户端包**，**外部源码未随仓库分发，无法做本仓版本锚定**。正文一律只保留「文件 + 符号名 + 逐字片段/语义」，不写行号；对照现盘请自行以安装版 `tmp/dsh-installed/…`（基准＝安装版 0.1.5-rc.2）为准。本仓库内实际存在的源码（教室契约、立绘渲染宿主、引擎工具结果模板）改用 〔Axx〕 锚点，行号集中在 `README.anchors.md`。

右侧栏**不是**一个 slot，而是「类型注册 + 主体注册 + 标题注册」三段：

| 段 | 机制 | 出处（基准＝安装版 0.1.5-rc.2） |
|---|---|---|
| ① 类型 | `ctx.sidebarRightTabs.register({ id, kind, priority, title, guide })` | `ui-sidebar-right/src/client/index.ts`（官方 guide 类型也走这条路，注释「Tab types register in two stages」） |
| ② 主体 | `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, Component)` | 座目录 `tmp/dsh-installed/dsh-cordis-client-runner/lib/client.js`：`kind=keyed / scope=session / replaceRisk="none" / declaredBy="an entry in 'rightbar.session'"`，占位者只有官方三个（TextPreview / FilesBody / GuideBody），**key 空间开放**；官方同款写法 `ui-sidebar-right/src/client/index.ts`（`key: GUIDE_ID`） |
| ③ 标题 | `ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: id }, Title)` | 座目录（同 key 派发，可选） |

- 🔴 **不用 `rightbar`**：那是 `single/root` 且已被官方右栏占据（`replaceRisk="shadows-shipped-ui"`）。
- `guide` 数组里那条**就是发现入口**：官方指南页把每个类型的 guide 条目渲染成一张卡片，点它即 `tab.actions.openTab(kind)`（`GuideBody.tsx` 的 `onPick`）。所以本插件不需要自己写卡片组件，声明一条 guide 条目即可被点到。
- 另有一条冷知识（`contract/seed.ts` 的 seed 配置）：右栏新面板的**默认 tab** 由「指南条目总数」决定——只有一条时直接用它，零条或多条时用指南页。故当前（`classroom` + `files` 两条）默认落在指南页。

## 3 · 数据通道（本任务的核心取证）

**结论：不需要服务端插件。** 客户端插件可以直接读工作区文件，走宿主已经提供的 `workspaceFiles` Remote。

| # | 通道 | 可行性 | 代价 | 判定 |
|---|---|---|---|---|
| A | **`ctx.remote.workspaceFiles.read(sessionId, path, range)`** | ✅ **本批采用** | 无（宿主自带；`dsh-web-app` 已装 `@deepseek-ai/dsh-api-workspace-files`，其 bundle patch 声明见 `clients/classroom-ui/cordis.patch.yml`） | 相对路径按**会话工作区根**解析，教室文件在工作区内 → 直接可读 |
| B | 服务端插件把数据推给客户端 | 可行（另有机制） | 要写宿主半边、要设计推送通道 | **不需要**：数据本来就在文件里，且 A 已够 |
| C | 会话投影（`useProjection`） | 存在（`standardProps` 里有） | 需要服务端注册投影 | 本项目未用；若将来要「引擎算好的相位」而非「文件里的相位」，再评估 |
| D | 组件 local state | — | — | **未采用**：数据源是磁盘文件，缓存在插件作用域的按 `sessionId` 的 store 里（`storeFor`），组件只订阅 |

源码依据（逐字）：

- `packages/api/workspace-files/src/index.ts`（`read` 的 doc，逐字）：
  > `@param path - absolute path or path relative to the workspace root; files outside it are allowed.`
- 分页语义 `packages/api/workspace-files/src/types.ts`（`WorkspaceFileRange` / `WorkspaceFileText`：1 基行号、`text` 不含末行终止符、`lines`、`eof`）；页大小默认 `maxLines: 5000`（同包 `src/index.ts`）→ 本插件**不传 limit**，用宿主默认，避免写死数字超过部署配置。
- 返回值形状 `packages/typert/protocol/src/types.ts`（逐字）：
  > `export type RemoteResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: RemoteFailure }`
- 注入语义（`inject` 的返回值怎么变成 props）`dsh-client-ui-renderer/lib/client.js` 的 `function runInject(entry, binding, actions)` ＋ `bindInjectSources`：`hooks` / `keyedHooks` 成员会被改写成 `useXxx` prop，其余键**原样进 props**；`actions` 作为第二个实参传入（`ui-slots/src/index.ts`，注释「strict session slots receive a definite framework-resolved `sessionId`」）。

### 3.1 客户端插件的装载机制（为什么产物是手写的）

1. 插件包必须**声明 `dsh.bundle.patch`** 才会成为 profile 的一层、才有 loader 行：
   `@deepseek-ai/dsh/lib/plugin-Ddi42qoW.js` 的 `const isBundle = exportsPatch(packageName, profileDir)`，非 bundle 的包只当普通依赖（并打一行 warning）。
2. 浏览器 roster 来自**宿主 Loader 的条目**：`dsh-client-modules/lib/index.js` 读每个条目的 `package.json`，要求 `dsh.client.platform === 'web'`，并从 `exports["./client"]` 取**产物文件路径**（同文件 `clientExportOf`；缺 `./client` 直接抛错），图的**行 id 就是包名**（同文件 `entry: graphRow(packageName, rev, source.meta)`）。
3. 产物格式不是 ESM，是**惰性 CJS 表**：`window.__ModuleLoader__.load({ id, factory: (require) => {...} })`（官方样例 `dsh-client-ui-jobs/lib/client.js`）。宿主**不做转译**，读字节直接下发；`require("react")` 命中平台种子模块。
   → 所以本插件的 `lib/client.js` 是**手写的产物**：不用 JSX、不用 CSS 模块（样式走内联 style 对象），从而**不需要打包器**。
4. 双半插件是官方常态：`dsh-client-ui-sidebar-right/package.json` 同时有 `main: lib/index.js`（宿主半边）与 `dsh.client` + `exports['./client']`（浏览器半边）。

## 4 · 数据契约

读四个文件，全部**真读盘**，单文件失败不拖垮整块：

| 文件（相对教室根） | 取什么 | 规则 |
|---|---|---|
| `classroom.yaml` | `classroom.id/title/subject/lessons`、`phases[]` | 只扫 `classroom:` 与 `phases:` 两个顶层块，遇 `blocks:` 停；行尾 ` #` 注释剥掉 |
| `runtime/progress.md` | `current_lesson:`、`current_phase:`（**机器可读行**）＋人读表格的 **`本轮要讲`／`已完成`／`上次上课日期`／`当课老师`／`课程进度`** | 机器行按行首锚定；表格按 `\| 标签 \| 值 \|` 取值 |
| `curriculum.md` | `## 第 N 讲 · 标题` ＋ 该讲块内 `- **核心疑问**：…` | 逐讲收集，共 14 条 |
| `characters/komari.md` | `名字`、`当课范围` | 表格取值；当课老师优先用 `progress.md` 的「当课老师」 |

> 🔴 **进度字段口径（事实契约，见 〔A01〕〔A02〕）**：`runtime/progress.md` 的人读表格只有两行与讲次相关——
> **`本轮要讲`**（＝本轮要讲的讲次，与机器可读行 `current_lesson` 同值）与 **`已完成`**（＝已上过的讲数）；
> **没有**「当前讲次」也没有「下次上课」两行（它们曾与本轮要讲说同一件事又可能对不上，契约已删，且文件里写明不许加回来）。
> 本插件据此解析（**字段名 → 取值键**）：
>
> | 位置 | 读的人读字段 | 取值键 |
> |---|---|---|
> | `parseProgress` | `tableValue(text, "本轮要讲")` | `humanLesson` |
> | `parseProgress` | `tableValue(text, "已完成")` | `doneCount` |
> | 快照 `data` | 透传 | 含 `humanLesson` ＋ `doneCount` |
> | 面板「当前」区 | 讲次值来自机器行 `current_lesson`（＋ `lessonTitle` 由讲次号在课程表里定位） | 一致性提示只在 `humanLesson` 不含 `current_lesson` 时出现 |
>
> 🔴 **口径不允许错误适配**：早期版本曾把人读行写成「当前讲次 第 0 讲（未开始）」、机器行 `current_lesson: 1`，
> 两者说同一件事又对不上（第 0 讲 与 第 1 讲 矛盾）——这是被验收抓到的真实缺陷，已修。
> 现契约：`progress.md` 写 `本轮要讲｜**第 1 讲 · 一个程序怎么跑起来**`、机器行 `current_lesson: 1`、人读 `已完成｜0 讲` →
> 面板显示「**第 1 讲 / 14 · 一个程序怎么跑起来**」，一致性提示**不出现**（两处同值）。

面板快照字段：

```js
{ classroomId, title, subject, lessonsTotal, phases[], currentLesson, currentPhase, phaseName,
  lessonTitle, lessonCore, teacher, teacherScope, progressText, humanLesson, doneCount, lastDate,
  lessons[{ n, title, core }] }
```

**缺失即缺失**：解析不到就返回 `null`，面板显示「未提供」并在页脚逐文件列出 `✓/✗ + 路径 + 错误`；**不填默认值**（本项目「不静默失效」纪律）。当前真实状态：`current_phase` 在 `progress.md` 里**还没有这一行**（引擎只在教师宣布过相位后才写）→ 面板显示「未提供（不猜）」，立绘停在默认待机。

## 4.5 · 立绘（Live2D）：资源通道与接线

> 产出：T5 · 2026-09-24。渲染宿主是 `clients/live2d-host/`（**只读复用**，本插件不改它一行）。

### 4.5.1 资源通道：二进制**能**拿到（源码级取证）

| 结论 | 源码依据（基准＝安装版 `tmp/dsh-installed/`，0.1.5-rc.2） |
|---|---|
| 客户端**能读二进制** | `dsh-api-workspace-files/lib/index.js` 的 `readBytes` 与 `readAll` 都**只读字节、不做文本解码、不做二进制拒绝**；返回 `{ absolutePath, version, bytes?, offset, data, eof }` |
| 但**线上是 base64 文本**，不是 `Uint8Array` | 同上逐字 `data: Buffer.from(data).toString("base64")`；远端 schema 也把它声明成字符串 —— `dsh-api-workspace-files/lib/typert.remote-client.js`（`readAll` / `readBytes` 结果）逐字 `'data': z.string().readonly()` |
| 客户端**必须自己解 base64** | 官方右栏文档预览就是这么做的，逐字 `dsh-client-ui-sidebar-documentpreview/lib/client.js`：`data: Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0))` |
| 官方就是**这样把工作区文件变成可加载 URL** 的 | 同文件逐字 `url = URL.createObjectURL(new Blob([data], { type: mediaType }))`（图片预览）；同法处理文本资源（`application/javascript` / `text/css`） |
| 客户端调用形状 | 官方绑定处逐字 `dsh-client-ui-sidebar-documentpreview/lib/client.js`：`ctx.remote.workspaceFiles.readAll(file.sessionId, file.path, signal)` |
| 整文件上限 | `dsh-api-workspace-files/lib/index.js` 逐字 `maxFileBytes: … .default(32 * 1024 * 1024)`（本批最大资源 3.1 MB） |
| **不需要服务端配合** | 以上全在客户端 Remote 面，宿主自带 |

> ⚠️ **与 master 的差别（前向对照，别照抄）**：`tmp/dsh-src-0923`（master）里 `readBytes` 返回**原生 `Uint8Array`**，走一条新的 multipart 附件通道（`packages/client/connection/src/client/rpc.ts` 的 `parseBinaryResponse`）。**安装版没有这条通道**（`dsh-client-connection/lib/client.js` 只做 `parseConnectionResponse(await response.json())`）。→ 本插件的解码路径按**安装版**写：**base64**。

### 4.5.2 把字节喂给渲染宿主：一个私有 scheme 的解析器

渲染宿主只认 URL，而它取资源的口只有两个（`clients/live2d-host/src/host.js`，只读复用、未改；见 〔A03〕〔A04〕〔A05〕〔A06〕）：

| 口 | 用在哪 | 出处 |
|---|---|---|
| `fetch(url)` | model3.json / moc3 / 动作 / 表情 / 物理 / 姿态 / **13 个着色器** | `clients/live2d-host/src/host.js`（`fetch` 取各类资源字节；着色器由 `vendor/CubismWebFramework/src/rendering/cubismshader_webgl.ts` 提供，**该框架源码未随仓库分发**，只在 `live2d-host/out/` 的打包产物里） |
| `new Image().src = url` | 贴图 | `clients/live2d-host/src/host.js` 的 `loadTexture`（见 〔A06〕） |

于是本插件：
1. 把资源读成 `Blob` → `URL.createObjectURL`；
2. 在**装载窗口内**装一个解析器，把 `dsh-classroom-asset://classroom/<虚拟路径>` 改写成 objectURL；
3. 只改写本插件自己的 scheme 前缀，**其余 URL 原样透传**；装载完（含着色器就绪）**立即还原** `fetch` 与 `Image`。

→ `model3Url = dsh-classroom-asset://classroom/models/Haru/Haru.model3.json`；宿主自己拼出的
`modelHomeDir + <资源名>`（见 〔A03〕）与 `shaderBaseUrl + <着色器名>` 都落回同一个 scheme，
**宿主与模型文件一行都不用改**。

**明确不采用**的另一条路（记录在案）：在宿主半边用 `ctx.connection.fetch.register({ path: '/api/…' })`
开一个真实 HTTP 资源端点（安装版 `dsh-client-connection/lib/index.js` 有该 API，且挂在 `/api`
前缀下、由同文件统一做 Host/Origin 与浏览器鉴权）。它能省掉全部改写，但会**新增一个按路径
服务工作区字节的 HTTP 面**；本批不做。

### 4.5.3 接线图（相位 / 通道 → 立绘，逐条）

| 来源 | 取值 | 立绘动作 | 落地位置 |
|---|---|---|---|
| `runtime/progress.md` 的 `current_phase:` | `open` | 表情下标 0；通道 `speak` | `PHASE_STATES.open` |
| 同上 | `probe` | 表情下标 1；通道 `speak` | `PHASE_STATES.probe` |
| 同上 | `answer` | 表情下标 2；通道 **`write`（嘴不动 = 立绘退让）** | `PHASE_STATES.answer` |
| 同上 | `check` | 表情下标 3；通道 **`write`** | `PHASE_STATES.check` |
| 同上 | `review` | 表情下标 4；通道 `speak` | `PHASE_STATES.review` |
| 同上 | `close` | 表情下标 5；通道 `speak` | `PHASE_STATES.close` |
| 同上 | **行不存在** | **不改表情，默认待机**；面板显示「环节 未提供」 | `phaseStateOf(null)` → `IDLE_STATE` |
| 同上 | 行存在但不在 `classroom.yaml` 的 `phases` 枚举里 | 不改表情，并写明原因 | `phaseStateOf(<未知 id>)` |
| 相位变化本身 | — | 额外做一次「场景重设」：`startRandomIdleMotion()` | `engine.applyPhase` |
| 通道 `speak` | 文字增量 | `TextRhythmProvider`（冲高＋衰减＋标点闭嘴）→ 嘴动 | `clients/live2d-host/src/text-rhythm-provider.js`（见 〔A07〕） |
| 通道 `write` | 文字增量 | `WriteChannelProvider`（`getParameter()` **恒 0**）→ 嘴不动 | 同文件（见 〔A08〕） |
| 贴图 / 模型 / 着色器 | — | 全部经 §4.5.2 的解析器落到 objectURL | `installAssetResolver` |

🔴 **表情只按「下标」取**：官方样本的表情名是 `F01…` / `exp_01…`，**语义要人工标定后才有意义**
（`研究_8` §P2 把「每模型一次人工标定」列为待办）。本轮给的是**确定的、可复现的**映射，
**不是「对的」映射**；改标定只改 `PHASE_STATES` 一张表。

🔴 **默认模型是官方样本 `Haru`（占位）**，**不是小鞠知花本人的模型**（还没有）。选它的理由：
`Groups.LipSync` 自声明 `ParamMouthOpenY`（命中 L1）、8 个表情、写嘴参数 0→1 画面差 160 像素
（`实现报告_L2D_M1_渲染宿主_2026-09-24.md` §3.4）。换模型：`{ model: 'Mao' }`。

### 4.5.4 调试开关（**默认关**）

相位/通道覆盖控件与实时读数**只在** `globalThis.__DSH_CLASSROOM_UI_CONFIG__.debug === true` 时渲染：

```js
globalThis.__DSH_CLASSROOM_UI_CONFIG__ = { debug: true }   // 开发 / 验收时注入
```

验收脚本用 `page.addInitScript` 在页面脚本之前注入（同页面、同 profile、同插件，只差这一个开关）。
控件内容：相位覆盖（`未提供` + 6 个相位）、通道覆盖（跟随相位／speak／write）、喂文字（单次／循环）、
清读数，以及一行等宽读数（通道 · 嘴参数 · 当前值 · 区间 [min,max] · provider 值 · 表情 · 帧数）。
**它不写任何文件。**

### 4.5.5 立绘相关配置一览

```js
globalThis.__DSH_CLASSROOM_UI_CONFIG__ = {
  root: 'classrooms/cs-os',                 // 教室根
  live2dRoot: 'clients/live2d-host/out',    // 立绘资源根（只读复用）
  model: 'Haru',                                                // 模型名（out/models/<名>/）
  mermaidPath: 'clients/classroom-ui/vendor/mermaid-11.17.2/mermaid.min.js', // 板书图产物
  drawAnim: 'stagger',                                          // 板书图动画档：'none' | 'stagger'（默认 'stagger'，见 §4.8）
  debug: false,                                                 // 调试控件开关（默认关）
}
```

## 4.6 · 板书图：老师画的那张图**画在消息流里**（T3）

**要解决的问题**：老师调 `classroom_draw` 画了一张图，之前消息流里只留一条工具调用记录——
**图本身看不见**。T3 把它变成一张真的图。

### 4.6.1 挂载点：官方 keyed 槽位 `tool.call.toolview`（**按 wire 工具名派发，key 域开放**）

安装版座目录（`dsh-cordis-client-runner/lib/client.js`）那一条逐字：

| 字段 | 值 |
|---|---|
| `key` | `tool.call.toolview` |
| `kind` / `scope` | `keyed` / `session` |
| `summary` | `Keyed atomic Tool call view, dispatched by the wire Tool name.` |
| `doc` | `…the key domain is open (any wire tool name, including a tool your own package registered), so there is no compile-time key set to pick from and a typo simply never renders.` <br> `A key the shipped composition already covers is replaced, not shared; an unclaimed key falls back to the generic tool row…` |
| `keyDomain` | `open: any string the owner dispatches (no compile-time key set), already taken: ask_user_question, bash, cordis_define, …`（**`classroom_draw` 不在里面**） |
| `ownerProps` | `callId` / `toolName` / **`block: ToolCallBlock`** / `cwd?` / `home?` / `openFile` / `loadImage` / `inspect?` |
| `declaredBy` | `an entry in 'conversation.chat.node' (client-ui-tool), so it exists while that entry is mounted` |
| `source` | `packages/client/ui-tool/src/client/contract/slots.ts`（逐字） |

🔴 **为什么不用另一条更显眼的路**：座目录里还有 `conversation.chat.node`（可注册 `key: 'tool-call'` 的渲染器），
但那条的 `replaceRisk` 是 `shadows-shipped-ui` —— **注册它就等于接管「所有工具调用」的显示**，
官方 `ToolCallTree`（含 `tool.call.images`、子调用树、`tool.call.toolview` 的派发）全被盖掉。
`tool.call.toolview` 则是**加法**：只认自己那一个键，其它工具名一个都不碰。
（取证结论见 `取证_P3_客户端槽位与派发语义_2026-09-24.md` §2.4。）

### 4.6.2 图从哪来：**源码在工具调用的入参里**，客户端自己渲染

`classroom_draw` 的入参（服务端 schema 校验过的）就有画图所需的全部内容：

| 字段 | 用途 |
|---|---|
| `source` | **完整 mermaid 源码**（无围栏、首行＝图类型关键字、≤20000 字符）→ **就是渲染输入** |
| `kind` | 图类型 id（12 值白名单）→ 显示用 |
| `title` / `caption` | 卡片标题与说明（可选） |

而工具**结果**只是一句人读中文摘要（逐字取自 〔A09〕，即 `plugins/socratic-engine/index.mjs` 的工具结果模板）：

> `板书图已落盘：diagrams/L01-T01-20260924-102042-flowchart.mmd（flowchart → flowchart-v2｜3 行 / 41 B）｜第 1 讲 · 第 1 回合 · …｜标题：烟测图`

—— **里面没有源码**。所以本插件**不从结果里找图**，而是从 `block.argsRaw`（＝`tool/call` 事件的
`arguments`，完整入参 JSON）里 `JSON.parse` 出 `source`。
→ **不需要服务端配合**：不要求它回传 SVG，也不要求它新增字段。

节点形状（官方投影，判定法逐字抄官方自己的 `toolRowModel`：`const done = "kind" in block`）：

- **运行中**：`{callId, name, argsRaw, turn, step, time, subCalls}`（没有 `kind`）；
- **已结束**：`{kind:'tool-result', seq, time, callId, call:{name,argsRaw}|null, callTime, content, isError, error?, subCalls}`。

### 4.6.3 mermaid 的**浏览器产物**从哪来（本任务的核心难点）

**结论：产物随本插件走（`vendor/mermaid-11.17.2/mermaid.min.js`），经宿主已有的 `workspaceFiles` Remote
读成字节 → `Blob` → objectURL → `<script src>` → `globalThis.mermaid`。** 与 §4.5.1 装载 Cubism Core 是同一条腿。

| 决策 | 选择 | 依据 / 理由 |
|---|---|---|
| 产物放哪 | **本包 `vendor/`**（3.57 MB，写进 `package.json` 的 `files`） | 自包含：换 profile、换机器、断网都能画；不把渲染成败押在 CDN 上 |
| 走哪个通道 | `ctx.remote.workspaceFiles.readAll` → base64 → `Uint8Array` → `Blob(text/javascript)` → objectURL | 与 §4.5.1 完全同一条腿（宿主自带，无需服务端开端点） |
| 用哪种构建 | **IIFE 单文件**（`dist/mermaid.min.js`），执行完挂 `globalThis.mermaid` | ESM 构建是多文件（入口 import 若干 `./chunks/…`），而浏览器半边只有「逐文件读字节」，没有相对路径 import 解析 → 要把 ESM 装起来得自己重写说明符，脆且不必要 |
| 版本 | **11.17.2**，sha256 `581ed7d7…390eb8` | 🔴 与**服务端**判「能不能渲染」用的 `mermaid.parse()` **是同一份字节**（本机实测哈希相同）→ 不存在「服务端判过、客户端画不出」的版本漂移。换版本＝重新验证 |
| 怎么渲染 | `mermaid.render(id, source, {theme})` → `svg` → `dangerouslySetInnerHTML` | 与官方对 Shiki/KaTeX 产物的处理同一口径；mermaid 默认 `securityLevel:'strict'`（产物过 DOMPurify） |
| 缓存 | 键＝「主题 ＋ 源码」，**整页级**；失败**不进缓存** | 同一张图重复出现不重复渲染；一次抖动不会把这张图永久钉在失败态 |
| 主题 | 观察 `body[data-ds-dark-theme]`（官方主题层的开关）→ `neutral` / `dark` | 白底黑字的图糊在深色界面上不能看 |

### 4.6.4 失败怎么降级（**绝不白屏**）

| 情形 | 显示 |
|---|---|
| 入参还没到（`argsRaw` 为空） | 卡片显示「运行中」＋ 等源码 |
| 入参不是合法 JSON / 没有 `source` | **降级态**：一句原因 ＋「下面是这次调用要画的 mermaid 源码」＋ 源码块 |
| 产物没拿到（读盘失败 / 脚本装载失败 / `globalThis.mermaid` 没挂上） | 同上，原因写「这张图在浏览器里没画出来（…）：<报错原文>」 |
| mermaid 渲染抛错（源码非法） | 同上，原因写 mermaid 的报错原文（含行号） |
| 正常 | `<svg>` 画出来；标题、图类型、行数、渲染耗时、`caption` 都在；源码与工具结果收在 `<details>` 里可查 |

**渲染输入永不截断**（`SOURCE_PREVIEW_LIMIT` 只管"要不要折叠显示"，不管渲染）——
截断后的图不是老师画的那张图。

## 4.7 · 皮肤（SKIN-2）：**已定稿一个方向**——「書庫」（B 讲台骨架 ＋ C 書庫材质）

> 产出：SKIN-1（三个方向预览）· 2026-09-24 → **SKIN-2（定稿）· 2026-09-25**。
> SKIN-1 自己写明"这一节是让用户挑方向的预览，不是已定稿"。**用户拍板：按 STAGE-3 的
> 「B 讲台骨架 ＋ C 書庫材质」重做面板** → 预览期结束，**没选中的两个方向按当时的约定删掉**
> （留着会让"面板长什么样"有两个答案）。`skin` 这个配置面**保留**（键名与语义不变），
> 只是现在只有一个合法取值。

### 4.7.1 唯一的皮肤参数表（`library`）

`lib/client.js` 里的 **`SKIN_PRESETS`** 就是全部皮肤参数：色阶 / 字阶 / 间距 / 圆角 / 发丝线 /
区块成形方式（`rule`｜`plate`｜`card`）/ **書庫纸面（深浅两套）** / 立绘舞台 / 板书图卡片。
渲染层只认这张表；**代码里没有散落的色值/字号/间距字面量**。

```js
globalThis.__DSH_CLASSROOM_UI_CONFIG__ = { skin: 'library' }   // 目前唯一合法取值
```

认不出的名字（含已删除的 `quiet` / `board` / `syllabus`）**一律退回 `library`**，不抛错、不白屏。

**这个方向长什么样（逐条对 STAGE-3）**：

| 项 | 形态 | 出处 |
|---|---|---|
| 面板底 | **木框 ＋ 奶白纸面**（`border-image` 木色渐变 6px ＋ `--cui-paper` 渐变 ＋ 内圈发丝） | C 的 `.v-c .frame` / `.v-c .paper` |
| 头部 | 教室名走**衬线**、元信息走等宽、下面一条金褐发丝线 | C 的纸面排版 |
| 讲台 | **一块常驻板面 ＋ 顶端金褐渐隐轨**（＝B 的"常驻黑板位"） | B 的 `.v-b .podium` / `.podium::before` |
| 课程表 | **一排窄书脊（14 根，定宽 14px，立在一条书架板上）＋ 一份章节索引** | C 的 `.v-c .spines` ＋ 索引化 |
| 当前讲 | 书脊描金 ＋ 索引行金褐下划线 ＋ 既读橙点 ＋ 字色上到第 1 档 | C 的 `.spines i.cur` / `.cur::after` |
| 错误/未通过那一条 | **暖橙告示**（纸面上的一层橙调 ＋ 一条既读橙竖线），不是宿主那层偏冷的灰底卡 | 同上（冷灰压在奶白纸上正是"管理后台卡片"的味道） |
| 层级手段 | **字号档 · 字距 · 字色阶梯 · 字面（sans/serif/mono）· 发丝线** —— **一处加粗都没有** | 项目硬规矩（2026-09-18） |

🔴 **木框为什么是 6px 而不是 STAGE-3 的 34px**：那是 1920×1080 整屏舞台的尺寸（占屏高 3.1%），
右栏只有 ~760px 宽，按同比例换算是 ~24px——在窄栏里不是"框"是"墙"。6px 是**同一个材质在窄容器里的
缩放**，不是换了一种材质。

### 4.7.1b 書庫纸面分深浅两套（`paper.light` / `paper.dark`）

判据只有一条：宿主切主题时给 `document.body` 打的 `data-ds-dark-theme`
（`themeMode()` → `isDarkTheme()`；与消息流里那张图**同一个判据、同一个观察器** `watchDarkTheme`）。

- 浅色纸面逐字取 STAGE-3 C 的 `#FBF7E4 → #F1EAD4`；深色另给一套暖深色（`#241d16 → #1b1510`）。
- 🔴 **深色下书脊要整族提亮一档**：第一版照抄浅色那三档，未上的书脊叠在深纸上**几乎看不见**
  （本机实测截图，见 §6.3）——那一排索引等于没了。测试里有"深色书脊亮度必须高于纸面"的断言守着。


### 4.7.2 借官方的 / 我们自己定的（逐条）

| 项 | 来源 | 依据 |
|---|---|---|
| 四级字色阶梯 | **[借官方]** `--dsw-alias-label-primary / -secondary / -tertiary / -caption` | 安装版 `dsh-client-ui-theme/lib/client.js` 逐字（深浅两套都单调递进，故四级都可读） |
| 字号阶梯 | **[借官方]** `--dsw-font-<档>-font-size / -line-height / -font-family` 分量 token | 同上，逐字（`--dsw-font-xxxs-11-font-size:11px` …）。**只取 400 那一档**，`-strong-` 是 500，不用 |
| 字面栈 | **[借官方]** `--dsw-font-family` / `--dsw-font-mono`（带 fallback） | 官方自己引用 `--dsw-font-mono` 时也带 fallback（`dsh-client-ui-tool/lib/client.js`） |
| 发丝线宽度 `0.5px` | **[借官方]** | 官方右栏 `border:.5px solid var(--dsw-alias-border-l4)`（`ui-sidebar-right/lib/client.js`） |
| 边界色 | **[借官方]** `--dsw-alias-border-l1 / l2 / l3` | 同上 |
| 交互填充 | **[借官方]** `--dsw-alias-interactive-bg-hover` | 🔴 **改前用的是 `--dsw-alias-fill-l2`，那个 token 在安装版里根本不存在** → 一直退回写死的浅色值，深色下几乎看不见。本轮换成真存在的那个 |
| `<style>` 注入方式 | **[借官方]** `document.querySelector("style[data-plugin-css=…]")` 去重 + `tag.dataset.plugin` | 官方逐字 `ui-sidebar-right/lib/client.js` |
| 圆角、间距、字距、行高、区块成形、舞台尺寸 | **[自己定]** | 官方没有 token 通路：它的圆角/间距/字距都散在各包 CSS Module 的字面量里（实测 radius 6/12/24/28/999、gap 3/14、padding 6/14/20、**零 letter-spacing**） |
| 立绘舞台底＝白 | **[自己定]**，理由见下 | 不是设计偏好，是渲染事实逼出来的 |
| **衬线字面 `SERIF`** | **[自己定]**（SKIN-2 新增） | 🔴 **宿主没有 serif token**：把 `dsh-client-ui-theme/lib/client.js` 里所有 `--dsw-font-*font-family` 列出来，只有 sans 与 mono 两族。而 STAGE-3 的 C 方向把衬线当作纸面材质的一部分（`archive/design-stage3/stage3.css` 的 `--font-serif`）→ 这里**逐字搬同一份字面栈**，不是新选字体。故本表里 sans/mono 一律引宿主 token，**serif 是明写的自定栈**，测试按这个口径守 |
| **書庫材质四色**（木框 / 金褐 / 纸面 / 既读橙） | **[自己定]**（SKIN-2 新增） | 逐条对 `archive/design-stage3/stage3.css`：`.v-c .frame` 的木色渐变、`--lib-gold #c9a86a`、`.v-c .paper` 的 `#FBF7E4/#F1EAD4`、`.spines i.cur::after` 的 `#e0603a`。它们走 `--cui-*` 变量写在面板根上（深浅两套），故换主题不用重建样式表 |

### 4.7.3 🔴 立绘舞台的底**必须是白的**（实测事实，不是选择）

Cubism 框架的裁剪遮罩那条路会在**共享的** WebGL 上下文上 `gl.clearColor(1, 1, 1, 1)` 且**不还原**
（`live2d-host/out/live2d-host.bundle.mjs` 三处逐字；Haru 有裁剪遮罩 → 触发）→ 渲染宿主每帧的
`gl.clear(COLOR_BUFFER_BIT)` 用的是**不透明白**。浏览器里实测：
`gl.getParameter(gl.COLOR_CLEAR_VALUE) === [1,1,1,1]`。

→ **画布的可绘区在深浅两种配色下都是白的，CSS 改不了**（那是帧缓冲里的像素）。
所以舞台底做成"白纸/白板"，让这块白成为设计的一部分（改前是白方块直接压在深色面板上）。
**真正的修法在 `clients/live2d-host/**`（不在本插件可改范围）。**

🔴 **SKIN-2 追加一条：立绘没就位时，这块舞台折成 0 高。**
未部署 Live2D 时那块方形舞台是一片**空白纸**——本机实测在右栏里占掉约 330px
（`shots/before/02-panel-crop.png`），真正的信息被挤到折叠线以下，而"未部署"这件事只需要一行字。
做法：`boardRaised = status.kind !== "failed"`，失败态换用 `portraitBoxCollapsed`（高 0）。
🔴 **画布元素仍留在文档里**（只是被折掉高度）：装载效果要拿到 `canvasRef.current` 才会跑，
把元素删掉就等于**永远发现不了未部署**。实测依据：渲染宿主只认 `canvas.width/height`（画布缓冲），
不看 CSS 盒（`live2d-host/src/host.js` 逐字只用 `this.canvas.width`）→ 折起来不影响装载。
🔴 **`loading` / `ready` 两态的尺寸与改前逐字相同**：本次没有稳定可用的 Live2D 资产来验"装载成功"
那条路（另一个工作线正在建 `out/`，跑我的验收期间它出现又消失），所以**那条路一个像素都不动**，
只改能在本机实测的失败态。

### 4.7.4 顺手修掉的一条**静默失效**：0 表情模型的「相位 → 表情」

**改前**：`applyPhase()` 里逐字一句 `if (expressions.length === 0) return;` —— 换到「表达式个数 = 0」的
立绘模型时，「相位 → 表情」**什么都不做、也不报任何提示**（9 个候选模型里 5 个是 0 表情）。

**改后**（接线说明见 `live2d-host/README.md` §三）：
1. 那句 `return` 前先记一次「报过了」（去重标志，不每帧刷）；
2. 讲台区**常显**一条提示（生产路径也看得见，不只是调试读数）：
   - `expressions === 0` → `data-classroom-ui-expression="unavailable"`「相位 → 表情不可用：本模型表达式个数 = 0，切环节不会换表情」；
   - `1 ≤ expressions < 6` → `data-classroom-ui-expression="partial"`「表情只有 N 个 → 多个环节会共用同一张脸（下标回绕，**可用**）」；
   - `≥ 6` → 不出现任何提示。
3. `readout()` 多带 `phaseExpression`（宿主能力发现的那条判据**原样透传**，不重新解析）与去重标志。

🔴 **判据没写歪**：**只有 0 个才算不可用**；1–5 个是 `partial`（可用但回绕），**不报失效**。
实测（真实模型，DOM 断言）：Haru（8 个）无提示 / Ren（5 个）报 `partial` / Hiyori（0 个）报 `unavailable`。

## 4.8 · Claude 风图表（MERMAID-2）：主题配置 ＋ 逐层长出

**要解决的问题**：MERMAID-1 把「克劳德那种图表观感」做成了可整段抄走的 PoC（主题配置 ＋ 逐层长出动画），
但**一行都没接进客户端** —— 消息流里那张图一直是 mermaid 默认的灰底直角块、整张图瞬间出现。

**做法（七处接线，全部在本文件 `lib/client.js`）**：

| # | 位置 | 改前 | 改后 |
|---|---|---|---|
| ① | 顶部主题常量 | `MERMAID_THEME_LIGHT = "neutral"` / `MERMAID_THEME_DARK = "dark"`（**名字符串**） | 两整份**主题配置对象** ＋ `CLAUDE_MERMAID_THEME_CSS` ＋ `DIAGRAM_THEME_REV` |
| ② | `mermaidThemeFor()` | 返回主题名 | **改名** `mermaidInitConfigFor()`，返回 `initialize` 配置对象 |
| ③ | `renderDiagram()` | `initialize({theme: <名字>})` | `initialize(Object.assign({}, mermaidInitConfigFor(t), {startOnLoad:false, securityLevel:"strict"}))`；**`renderChain` 串行化保留** |
| ④ | `diagramFor()` | 缓存键 `themeName + 源码` | 缓存键 **`DIAGRAM_THEME_REV`** `+ themeName + 源码` |
| ⑤ | `ClassroomDrawView` | 无 ref、无动画 | 那个 div 加 `ref`；`state.svg` 变化时在 effect 里调 `animateStagger()` |
| ⑥ | 动画开关 | 无 | `uiConfig().drawAnim ∈ none\|stagger\|stream`，**默认 `stagger`** |
| ⑦ | 教室面板 | —— | **面板里没有 mermaid 图 → 不需要接线**（外观那件事只对消息流里的图成立） |

**🔴 三件必须记住的事**：

1. **`theme` 必须是 `'base'`**，且**主题配置里不放 `securityLevel`**。PoC 那份配置带的是 `'loose'`；
   直接展开会把客户端的 DOMPurify 从 `strict` 放宽到 `loose`。实测 `themeCSS` 在 `strict` 下照样生效
   （`rectRx=8px` / `rectFilter=none` / `labelWeight=400`）→ **没有理由为了主题降安全等级**，
   `securityLevel` / `startOnLoad` 由调用点显式钉死（测试里有断言守着）。
2. **改了主题色值必须把 `DIAGRAM_THEME_REV` +1**。缓存键里光有 `light`/`dark` 不够 —— 主题名一个都没变时
   **旧缓存不会失效**，用户会继续看到旧配色，而且看起来像"改了代码没生效"。
3. **进场动画只许用独立变换属性 `translate` / `scale`，绝不能用 `transform`**。mermaid 把节点位置写在
   `<g transform="translate(x,y)">`，而 CSS `transform` **会整体覆盖**它 → 动画期间节点全部跳到画布原点、图散架。
   实测（`getBoundingClientRect()` 逐节点、动画期间 7 个时间点）：**最大偏差 1.74 px、0 个节点塌到原点**。

**动画开关（不用改代码就能回退）**：

```js
globalThis.__DSH_CLASSROOM_UI_CONFIG__ = { drawAnim: 'none' }   // 回退到候选 A：只换主题，不装动画
```

- `'stagger'`（默认）＝ 渲染完成后**逐层出现** ＋ 连线"画出来"（层间 130 ms，整段封顶 2600 ms，至多 26 步）。
- `'none'` ＝ 不装动画（皮肤照旧）。
- `'stream'`（候选 C：按源码边长）**本轮未接线** —— 我们的链路里源码是一次性给全的，没有逐字流。
  写它会**落到默认档并记一条诊断**（不静默装作做了）。

**验收怎么跑**（真实会话，两个 phase 只差 profile 里那份产物）：

```bash
M2_URL="http://127.0.0.1:4397/?token=<token>" \
  /opt/homebrew/bin/node clients/classroom-ui/tools/mermaid-wiring-shots.cjs --phase before
M2_URL="..." /opt/homebrew/bin/node .../tools/mermaid-wiring-shots.cjs --phase after
M2_URL="..." /opt/homebrew/bin/node .../tools/mermaid-wiring-followup.cjs gif    # 逐层长出的动图逐帧
M2_URL="..." /opt/homebrew/bin/node .../tools/mermaid-wiring-followup.cjs none   # 开关回退（带对照页）
```

证据在 `evidence/mermaid2/`，逐图"该看什么"见实现报告 `实现报告_MERMAID2_接进客户端_2026-09-24.md`。

## 5 · 装载与运行

### 5.1 🔴 本插件不 import 任何 `@deepseek-ai/*`（B2，2026-10-21）

`package.json` 的 `dependencies` 里只剩 `zod`。这不是风格偏好：0.2.1 删掉了「安装版回退目录」，
插件一旦 import 宿主包，包就必须写进 `dependencies`，于是 profile 的 `node_modules/@deepseek-ai/`
必然出现宿主副本 ⇒ 双实例 / Symbol 失配 ⇒ 验收流水线铁律③必红。

为此做了两件事：

| 改动 | 结果 | 证据 |
|---|---|---|
| **白板 Remote 服务整体下线**（`whiteboardStore` 的 save/load/index ＋ `lib/whiteboard.mjs` ＋ `lib/whiteboard-route.mjs`） | 面板不再需要 `dsh-typert-protocol` ＋ `dsh-atomic-write` 两份额外依赖 | 它**没有任何浏览器消费者**（板书历史改读 `<教室>/runtime/diagrams/index.md`，见 `lib/client.js` §6.9）；下线论证见 `docs/历史报告/实现报告_B2_去宿主包依赖_2026-10-21.md` §4 |
| **叙事服务的基类换成 `lib/remote-service.mjs`** | 仍然只用 `ctx.provide()` ＋ 原型上的 `remote-methods` 描述符 ＋ `typertRemote` 绑定 —— 全是宿主网关读的那三样 | 逐字段依据（`readBinding` 要求 `service === originalOf(receiver)`、`serviceKey` 相等、`namespace` 是字符串；`getTraceable()` 见 `Symbol.for('cordis.tracker')` 才包 proxy）抄在该文件头 |

验证边界（诚实写清）：`test/host-face.test.mjs` 钉住「绑定／描述符／manifest／不许 import」四件事；
`tools/probes/toolshape-live/` 在**真 profile** 里验证到「服务被 provide ＋ 绑定逐字段正确 ＋
host-face 清单注册进 `ctx.typert`（`classroomNarrative/status`、`/diaries` 都在）」。
**没验到的**：浏览器经网关 HTTP 派发那最后一跳（要真开 web UI 点开「日记」tab）——
改的只是基类，网关读的字段一个没少，但这一跳没有本次证据。

### 5.2 装载命令

```bash
DSH_BIN="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"

# 装进测试 profile（本地包用 file:，绝不用 link:）
"$DSH_BIN" plugin --profile socratic-dev add \
  "file:/abs/path/to/SocraticNovel/clients/classroom-ui"

# 起 web UI（会打印带 token 的地址）
# 🔴 必须用 /opt/homebrew/bin/node（PATH 里的 node 是 Electron 垫片）；
#    socratic-dev 的 patchReload=live 会挂 cordis-plugin-hmr，而 HMR 要 --expose-internals。
/opt/homebrew/bin/node --expose-internals "$DSH_BIN" --profile socratic-dev --no-open --port 4399
```

⚠️ 坑（都踩过）：

1. `package.json` 的 `files` **必须列上 `cordis.patch.yml`**：pnpm 装 `file:` 依赖时按 `files` 打包，漏了它 profile 里就没有补丁文件，启动直接报
   `failed to read overlay .../classroom-ui/cordis.patch.yml: ENOENT`。
   **同理 `vendor/` 也必须列在 `files` 里**，否则 mermaid 产物不会进 profile，图永远画不出来。
2. **改完代码要重装**（`remove` 再 `add`）：pnpm 对同版本 `file:` 依赖会说 `Already up to date` 而不刷新副本。装好后 profile 副本与工作区是**硬链接**（inode 相同）→ 一旦用 `edit`/`write` 改工作区文件就会打断硬链接，**必须显式重装或 `cp` 并逐文件核对哈希**（本次已核对，见实现报告 §4）。
3. 🔴 **`dsh web` 子命令不能带 `--profile`**（安装版 `bin.js` 明确拒绝父级选项，`web` 就是 `--profile web` 的别名）。要用别的 profile 就跑 **profile 模式**：`dsh --profile socratic-dev --no-open --port 4399`（socratic-dev 的 bundle 栈里本来就有 `dsh-web-app`，起来就是同一套 UI）。
4. 🔴 **`socratic-dev` 原本没装引擎**：面板（本插件）不需要引擎，但**要看到 `classroom_draw` 就得让引擎在这个 profile 里**。做法（**只加配置，不改 profile 文件**）：

   ```bash
   # ① 引擎装进测试 profile
   node "$DSH_BIN" plugin --profile socratic-dev add "file:<工作区>/plugins/socratic-engine"
   # ② 用 --patch 显式指定教室目录（见第 5 条：不指它引擎就一个工具都不注册）
   /opt/homebrew/bin/node --expose-internals "$DSH_BIN" --profile socratic-dev \
     --patch "<工作区>/_t3_socratic_dev_classroom_patch.yml" --no-open --port 4399
   ```
5. 🔴 **引擎的教室发现够不着本项目的教室**：发现规则是「显式指定 → `<工作区根>/classrooms/*/` → 工作区下**深度 ≤3** 的深扫」，而教室在
   `classrooms/cs-os`（相对工作区根**深度 5**）→ 三条路都够不着，引擎打印「0 候选…插件空转」并且**一个工具都不注册**
   （现象：模型根本不知道有 `classroom_draw`，你让它画它也不画）。用 `--patch` 显式给 `classroomDir` 即可。
6. 🔴 **跑会话要用教室副本，不要拿真教室当试验场**：引擎会在会话里写教室的 `runtime/`（`session_log.md` / `diagrams/` / `progress.md` …），
   那是真教室的**状态真源**。做法：`rsync -a classrooms/cs-os/ /tmp/<副本>/`，把 patch 里的 `classroomDir` 指到副本。
   ⚠️ 客户端面板读的仍是**真教室**（只读、不写）——副本放工作区外不影响面板，这个分工是刻意的。

测试（无需浏览器、无需模型）：

```bash
/opt/homebrew/bin/node clients/classroom-ui/test/panel.test.mjs
```

端到端取证（真实会话、真实模型、真实工具；需先起上面第 4 条的 server）：

```bash
T3_URL="http://127.0.0.1:4399/?token=<打印出来的 token>" \
  /opt/homebrew/bin/node _t3_message_stream_draw.cjs          # 项目根执行（playwright 装在项目根）
/opt/homebrew/bin/node _t3_vendor_mermaid_check.cjs            # 产物层单独验（不依赖宿主）
```

## 6 · 验收证据（怎么看图）

### T1（面板本体）

| 图 | 该看什么 |
|---|---|
| `evidence/01-guide-entries.png` | 右栏**指南页**上出现两张卡片：第一张就是**「教室」**（副标题「课程表 · 本轮要讲 · 当课老师 · 进度」），第二张是官方的 Workspace files → 证明**类型注册真的被宿主渲染出来了**、并且是用户点得到的入口 |
| `evidence/02-classroom-panel.png` | 整窗：右侧栏已打开，**当前 tab 就是「教室」**，面板内容在右栏里 |
| `evidence/03-classroom-panel-zoom.png` | 面板放大图：tab 芯片「**教室 · 第 1**」、教室名、`当前`（讲次＝第 1 讲 / 14、环节＝未提供、老师＝小鞠知花、进度＝0 / 14 讲）、**14 讲课程表**（第 01 讲带「当前」标记与核心疑问）、页脚**四条真读盘来源**全部 ✓ |

### T5（立绘挂载 · 2026-09-24）

| 图 / 数据 | 该看什么 |
|---|---|
| `evidence/t5_10-portrait-in-panel.png` | **立绘就在「教室」面板里**（面板顶部一整块，不是另一个 tab）：能看见一个人形（官方样本 Haru）。下方状态行写「环节 未提供 · 通道 speak · 默认待机」→ 证明**相位来源是 `progress.md` 的 `current_phase:`，而那行不存在时如实显示「未提供」而不是猜** |
| `evidence/t5_11-portrait-panel-zoom.png` | 面板放大：能同时看到「教室 · 第 1」标签、教室名、**「立绘 · Live2D」区**与角色本体 → 立绘与面板是**同一块**，不是两个 tab |
| `evidence/t5_20-phase-open.png` / `t5_21-phase-probe.png`（＋三倍放大 `crops/head-open.png` / `crops/head-probe.png`） | 调试控件把相位覆盖成 `open` / `probe` 后各取一帧。**该看**：`open` 的嘴是**闭着的微笑**、`probe` 的**嘴张开露出舌/口腔内部**，且 `probe` 的头部整体上移、脸略偏左。逐像素：**147019 像素不同（占画面 4.0%）**，差异集中在人物本身（x 774–1155）<br>🔴 **这两张图只能证明"画面不同"，不能证明差异是相位造成的**——立绘一直在跑 idle 动画（呼吸/眨眼/轻微晃动），截帧时刻不同也会产生差异。**相位→立绘的归因**只有"表情下标"这一层有源码依据（`PHASE_STATES`），画面层未做冻结隔离（见 §7 未取证） |
| `evidence/t5_30-channel-speak.png` / `t5_31-channel-write.png`（＋ `crops/head-speak.png` / `crops/head-write.png`） | 两条通道下各取一帧。**该看**：两张的嘴**都是张开的**（不是"speak 张嘴、write 闭嘴"——那是误读，见下），差异在嘴的开合幅度与头部姿态。逐像素：**103508 像素不同（占 2.8%）**<br>🔴 **同一句提醒**：这两张也**不能**单独证明差异来自通道 |
| `evidence/t5_evidence.json` | 上面四张图的程序化数值：每个状态的读数行、画布尺寸、以及**逐像素差异**（PNG 解码后按通道最大差 > 8 计），含 bbox 与逐行带分布 |
| `evidence/iso-channel.json` ＋ `iso-channel_v3-*.png` | 🔴 **「通道 → 画面」的冻结隔离测量（v3，唯一变量＝通道）**。方法：先冻结动画（渲染循环只 `draw()` 不 `step(dt)`），**全程不解冻**，再用官方 LipsSync 语义把 provider 输出写进模型（`addParameterValueById` → `model.update()` → `draw()`），取帧用 `canvas.toDataURL()`。**该看这几组数字**：<br>① 空白对照（同通道两次取帧）= **0 像素**；② 可逆性（write→speak 回到同值）= **0 像素**；③ **只改通道 speak(0.3442) vs write(0.0000) = 72 像素，bbox 16×6、落在嘴部（349,120）**；④ 正对照（只改嘴参数 0→1）= **161 像素，bbox 21×11、同样落在嘴部**<br>→ **结论：通道确实能改变画面，量级与"只改嘴参数"同阶且落在同一块区域**（72 像素小于 161 像素，因为 0.3442 只是中间开合度、正对照是满开 1.0） |
| `evidence/frame-stability.json` ＋ `stab_*.png` | **取帧层稳定性**（v3 的前提验证）：冻结后**连拍三张 sha256 完全相同**（`1c5f9c8d12649e72…`）、改回同一参数后也完全相同；运行态连拍两张则有 15090 像素差异 → 证明"冻结＋取帧"这一层是确定的，**上面那个 0 像素对照不是运气** |
| `evidence/iso-channel.json` 的 `history` 字段 | 🔴 **v1/v2 的失败过程（如实保留）**：v1 是**空对照**（speak 侧 provider 输出为 0，与 write 的恒 0 无从区分）；v2 空白对照**没过**（同值 0.344 却有 1 万像素差异、铺满全身）→ 病根是脚本顺序「解冻→喂字→冻结」，解冻期间 idle 动作推进了姿态。v3 才拿到可用数字。<br>→ **判据写死在脚本里**：speak 侧 provider ≈ 0 时 `verdict.comparisonValid=false`，脚本判无效 |

> 全部 T5 面板截图都在**真实 `socratic-dev` profile 起的 `dsh web`** 里拍（脚本 `_t5_classroom_l2d_shot.js`，项目根）；
> `iso-channel` / `frame-stability` 两组是**离线隔离测量**（`tools/iso-channel.cjs`、`tools/probe-frame-stability.cjs`，
> 起的是 `live2d-host/out/demo.html` 同一个渲染宿主 + Playwright），冻结时钟驱动，**与机器快慢无关**。
> 面板截图那一轮唯一注入项是 `page.addInitScript` 设的 `__DSH_CLASSROOM_UI_CONFIG__ = { debug: true }`（打开调试控件）；**同页面、同 profile、同插件**。

### 立绘这一节怎么用（操作步骤）

1. **在 `socratic-dev` profile 里起 `dsh web`**，打开一个会话 → 右栏出现「教室」tab（类型注册的入口也在指南页）。
2. 面板顶部就是**「立绘 · Live2D」区**，角色默认是官方样本 `Haru`；下面一行**状态行**写明当前
   「环节 / 通道 / 该相位要做什么」，再下面一行是**诊断读数**（嘴参数当前值与区间、provider 输出、
   表情下标、帧数、动作可用数、帧错误数）——**读数就是验收数据，不靠"看起来像"**。
3. **相位来源**＝教室自己的 `runtime/progress.md` 里的机器可读行 `current_phase: <id>`。
   那行不存在 → 面板显示「未提供」、立绘停默认待机（**不猜**）。合法 id 来自 `classroom.yaml` 的 `phases` 枚举。
4. **调试控件**（仅开发时出现，靠 `__DSH_CLASSROOM_UI_CONFIG__ = { debug: true }` 打开）：
   - 「相位覆盖」：把相位临时改成 `open/probe/answer/check/review/close` 看立绘反应；
   - 「通道覆盖」：`跟随相位` / `speak（说话）` / `write（写字）`；
   - 「喂文字」：**喂一段** / **循环喂** / **停** —— 模拟流式 `text-delta`，用来把"嘴在动"稳定地截进图里；
   - **清读数**：清掉嘴参数的 min/max 极值统计（换通道/换相位后重新看区间）。
5. **想复现隔离测量**：`/opt/homebrew/bin/node clients/classroom-ui/tools/iso-channel.cjs`
   （项目根执行，需 `playwright`；起的是 `live2d-host/out/demo.html`，**只读复用**，不改它一个字节）。

### T3（消息流里的板书图 · 2026-09-24）

| 图 / 数据 | 该看什么 |
|---|---|
| `evidence/t3_11-draw-in-message-stream.png`（＋整屏 `t3_10-message-stream-full.png`） | **这条消息里应当出现一张带方框与箭头的流程图，而不是一行工具名**：白底圆角框里是 `进程A` 方框 → 箭头 → `进程B` 方框；上方两行是标题「烟测图」与等宽元信息「`classroom_draw · 已完成 · flowchart · 3 行源码 · 渲染 28 ms`」 |
| `evidence/t3_20-other-tool-card.png` | **非画图类工具调用没被弄坏**：官方自己的那一行（终端图标 ＋「**Bash** · List cs-os classroom directory」）。判据是**它长得跟画图卡片完全不一样** → 本插件只接管了 `classroom_draw` 一个键 |
| `evidence/t3_30-render-fallback.png` | **渲染失败降级成「源码 ＋ 一句说明」，不白屏**：① mermaid 报错原文（`Parse error on line 3: … got '1'`）；② 灰字「下面是这次调用要画的 mermaid 源码（原样，未截断渲染输入）」；③ 灰底代码块里是那段非法源码逐字 |
| `evidence/t3_00-vendor-mermaid-renders.png` | **产物层单独验**（不依赖宿主）：vendored mermaid 在浏览器里真画出一张流程图 ＋ 一张时序图 |
| `evidence/t3_mermaid_api_bisect.json` | 🔴 **本轮最值钱的一条坑**：`mermaid.render(id, source, X)` 的第三个参数是**容器元素**不是选项对象 —— 同一页面/同一产物/同一段源码，`render(id, src)` 出 11 203 字符 SVG，带 `{theme:'neutral'}` 就抛 `Cannot read properties of undefined (reading 'createElementNS')` |
| `evidence/t3_message_stream_evidence.json` | 真实会话的 DOM 读数（三类卡片的 `shapeCount` / 文本节点 / 工具行文本 / **零控制台错误**） |
| `evidence/t3_regression.json` ＋ `t3_50/51-*.png` | 回归：教室面板（14 讲 / 第 1 讲 / 老师 / 进度 / 四条来源）＋ **立绘仍在跑**（读数 `帧 138 · 帧错误 0`） |

> T3 的三张主证据都在**真实 `socratic-dev` profile 起的 UI** 里拍（脚本项目根 `_t3_message_stream_draw.cjs`）：
> 新建会话 → 发一条真实消息 → 模型自己调 `classroom_draw`（一张合法 ＋ 一张故意非法）＋ `bash`。
> 唯一注入项＝打开调试控件的 config（回归那张）；**同页面、同 profile、同插件，没有覆盖任何被测样式**。
> 🔴 跑会话时引擎写的是**教室副本**（`/tmp/t3-classroom-copy`），真教室零写入；面板读的仍是真教室（只读）。

### 板书图这一节怎么用（操作步骤）

1. 按 §5 第 4–6 条把引擎装进测试 profile、把教室指向副本、起 UI。
2. 在会话里让老师画图（例如「请调用 classroom_draw 画一张 flowchart」）→ 消息流里**直接出现图**。
3. 想看**降级态**：让它画一张语法错的图（服务端会拒绝落盘并报错，客户端仍会把那段源码渲染尝试一遍，
   失败就降级成源码 ＋ mermaid 的报错原文）。
4. 想看**源码与工具结果**：卡片下方「▸ 看源码与工具结果」展开。

### SKIN-2（書庫面板 · 2026-09-25）

> **截图不入库**（`evidence/` 已被仓库根 `.gitignore` 忽略），本节给的是**怎么复现**与**该看什么**。
> 产出脚本与图都在仓库外的临时目录（`/tmp/panel-eval/`），**不属于产品源**。

**怎么复现**（隔离 profile，真读盘；`web` / 桌面 profile 零接触）：

```bash
# ① 把 DSH_HOME 克隆到 /tmp（clonefile，原目录零改动）——🔴 硬判：不是 /tmp 下的就拒绝跑
cp -Rc "$HOME/Library/Application Support/dsh-desktop/harness" /tmp/panel-eval/harness
# ② 在隔离 home 里建一个专用 profile（只装 dsh-base + dsh-web-app + classroom-ui）
#    本地包一律 file: 装；装完必须核 sha256（工作区 vs profile 副本必须一致）
node "$DSH_BIN" plugin --profile panel-eval add "file:<工作区>/clients/classroom-ui"
# ③ 起 UI（cwd ＝ 被测仓库根，这样会话工作区就是它）
/opt/homebrew/bin/node --expose-internals "$DSH_BIN" --profile panel-eval --no-open --port 4471
# ④ Playwright 打开它 → 开一个会话 → 右栏「教室」tab → 截图
```

**该看什么（前 / 后 同一脚本、同一视口 1680×1050、同一份真教室文件）**：

| 图 | 该看什么 |
|---|---|
| `panel-side-by-side.png` | 左＝改前（`quiet`），右＝改后（`library` 書庫）。**一眼要看出右边不再是"白底＋发丝线表格"**：木框承着奶白纸面、书名走衬线、分节线是金褐的 |
| `window-side-by-side.png` | 整窗。右栏与左侧消息流的关系没变（仍是右栏一个 tab，不是新开窗） |
| 两张图的**同一处对照** | 「课程表 · 14 讲」标签的位置（程序化量：左侧文字栏 x 20–140 逐行扫墨迹段）：改前在 **y=839**，改后在 **y=555** → **上移 284px**。原因就是改前那块**空白的立绘舞台**（约 330px）被折掉了——真正的信息因此回到首屏 |
| 改后 · 课程表 | **一排窄书脊**（14 根、定宽 14px、立在一条书架板上），当前那根**更高且描金边**；下面一份**章节索引**，当前那条带**既读橙点 ＋ 金褐下划线** |
| 改后 · 讲台 | 未部署时是**一行**紧凑说明（带金褐竖线）＋ 一行默认折起的「▸ 讲台诊断」；**不是**一整块灰板 |
| 改后 · 层级 | 全场**没有一处加粗**（程序化断言：面板内 `font-weight > 400` 的节点数 **0**）。层级来自字号档 / 字距 / 字色阶梯 / 字面（sans·serif·mono）/ 发丝线 |
| 深色对照 | 同面板在深色主题下：纸面换成**暖深色**、书脊整族提亮（第一版照抄浅色 → 索引在深纸上几乎看不见，是实测抓出来的） |

**程序化读数**（每张图旁边都有一份 `readout.json`）：`sections / items(14) / spines(14) / current(1) /
sources(6) / refresh / boldNodes(0)`，以及 `console.error` 与 `pageerror` 的**逐条原文**（契约是 0）。

🔴 **两个取景器前提**（不是产品缺陷，别误读）：
1. **无头 Chromium 默认没有 WebGL**（本机实测：裸启动 `getContext('webgl')` 返回 `null`；
   加 `--enable-unsafe-swiftshader` 才有 SwiftShader 的 WebGL 1.0）。没有 WebGL 时面板如实报
   「无法取得 WebGL 上下文」，照常工作。
2. 仓库里 `clients/live2d-host/out/` 由**另一个工作线**在建，跑本轮验收期间它**出现又消失**。
   所以"未部署"这一态用**插件已有的配置面** `live2dRoot` 指到一个不存在的路径来**确定性复现**
   （`PANEL_LIVE2D_ROOT=clients/live2d-host/out-not-deployed`）——不是给验收开旁路，是让前提可控。
   **装载成功那条路本轮没有验**（资产不稳定），也因此**一个像素都没动**（见 §4.7.3）。

## 7 · 已知边界

### 皮肤相关（SKIN-1 新增 · **SKIN-2 已定稿**）

- ✅ **方向已定稿为唯一一个 `library`（書庫）**：SKIN-1 的三个方向是"预览"，用户拍板后按当时的约定
  **删掉了没选中的两个**（`quiet` / `board` / `syllabus`）。`skin` 配置面保留，但只有一个合法取值。
  🔴 想回退到某个旧方向**不是改一个配置就行**——那三张参数表已经不在代码里了。
- **没做**：图标系统、动效/过渡、滚动条换肤、字号随宿主 `--dsh-content-font-size` 缩放
  （宿主自己写明「Font size: Only affects conversation content」→ 右栏本来就不跟着变）、
  多主题注册（`ctx.theme.register`）、品牌位（`sidebar.brand.mark`）。
- **诊断文案没有改，但默认收进了 `<details>`「讲台诊断」**（SKIN-2）：`模型 … · 资源 …`、
  `教室还没有 runtime/expression.md …`、`相位 → 表情不可用 …`、装载过程、调试控件这些**工程读数**
  **一条都没删**（点一下就在），只是不再默认占版面——**"像管理后台"的一大半是这一列小字撑起来的**。
  留在板面上的只有**产品文案**：环节/通道那行、本回合表情那行、以及立绘未就位那行。
  是否把这些也改写成教室口吻，仍留待用户裁决。
- **头部元信息去掉了教室根路径**：页脚「数据来源」已经把 `classroomRoot()/<文件>` 逐条列了四遍，
  头部再写一遍是重复；信息没丢。
- **`讲台` 这个小标题是改过的**：改前是「立绘 · Live2D」——一个实现技术的名字，正是面板里最重的
  "开发者工具味"。只换了这一处文案，数据与功能未动。

- 只读：面板不写任何教室文件（相位/进度的写入属引擎侧，不在本批）。
- 单教室：教室根默认 `classrooms/cs-os`，换教室靠 `globalThis.__DSH_CLASSROOM_UI_CONFIG__ = { root: '...' }`；**未做**多教室切换 UI。
- 无自动刷新：文件变化不会自动重读（要按「重新读盘」）。宿主有 `workspaceFiles.changes` 流，本批未接。
- 皮肤是**唯一一个已定稿的方向**（`SKIN_PRESETS.library`，见 §4.7）；渲染层只认那张参数表，代码里没有散落的色值/字号/间距字面量。
- **未用**官方 UI 基础包（`ui-primitives`）：全部原生元素 + 内联样式 + **一个** `<style data-plugin-css="classroom-ui/skin.css">`（照官方右栏同款做法，只为表达 `:hover` / `:focus-visible` / `summary::marker` 这三类内联样式表达不了的规则）。

### 板书图相关（T3 新增）

- **12 种图类型只实测了 2 种**（`flowchart` / `sequenceDiagram`）；其余类型**在客户端渲染路径上没逐个跑过**
  （服务端 T3a 已用真解析器验过"能解析"，但"能解析" ≠ "客户端这份产物画得出来"）。
- **深色模式没有截图取证**：代码路径在（观察 `body[data-ds-dark-theme]` → `initialize({theme})`），
  二分证据里 `dark` 主题实测画出 12 200 字符 SVG，但**没在深色界面里拍过图**。
- **卡片不显示讲次 / 回合号**：客户端拿不到结构化字段（服务端把它们写进了人读结果文本）；
  本插件**拒绝正则解析人读文案**。要显示得动服务端（见实现报告 §6.1 的接线说明）。
- **缓存不回收**：`diagramCache`（主题＋源码 → SVG 字符串）是整页级、只增不减，没有上限。
- **渲染输入永不截断**；`SOURCE_PREVIEW_LIMIT` 只管"要不要折叠显示"。
- **`render` 只吃两个参数**：图形主题**只能走 `initialize({ theme })`**（第三个参数是容器元素，见 §4.6 与
  `evidence/t3_mermaid_api_bisect.json`）。
- **`vendor/` 必须在 `package.json` 的 `files` 里**，否则产物不进 profile、图永远画不出来。

### 立绘相关（T5 新增）

- **模型是占位**：默认用官方样本 `Haru`，**不是小鞠知花本人的模型**（还没有）。
- **表情未标定**：相位 → 表情是**按下标**的确定性映射，语义未人工标定（见 §4.5.3）。
- **说话的文字来源目前只有调试控件**：真实会话的流式文本（槽位标准 props 里有 `useChat` / `useConversation`）**本批未接**。
- **资源按 session 缓存、不回收**：`assetCache` 只增不减（一个模型约 4–5 MB 的 objectURL）。面板反复开关不会重复读盘；这是**有意的取舍**（换成每次回收会反复重读 4 MB 并重复装载框架）。多教室/多模型时会累积。
- **装载窗口内会临时改写 `globalThis.fetch` 与 `globalThis.Image`**：只改写 `dsh-classroom-asset://classroom/` 前缀，其余透传，装载完（含着色器就绪）**立即还原**（`finally`）。这是为了把「工作区字节」喂给只认 URL 的只读渲染宿主；替代方案（宿主侧开 HTTP 资源端点）见 §4.5.2。
- **每个 canvas 一个 WebGL 上下文**：卸载时主动 `WEBGL_lose_context` 释放，避免反复开关 tab 撞浏览器的上下文上限。
- **帧率**：面板自己跑 `requestAnimationFrame`（`host.step`），面板不可见时浏览器会降频，属正常。
- 🔴 **相位 → 画面 这一层没有做冻结隔离测量**：`t5_20` / `t5_21` 只是"同一相位覆盖下不同时刻的两帧"，
  差异里混着 idle 动画。**已测得成立的是"通道 → 画面"**（见 §6 的 `iso-channel.json`）。
  相位那一层当前只有源码依据（`PHASE_STATES` 的 `expressionIndex` → `startExpression`），**画面级未取证**。
- 🔴 **`write` 通道 ≠ 嘴闭上**：官方 `CubismLipSyncUpdater.onLateUpdate` 走的是
  `addParameterValueById`（**叠加**到动作基值上），`write` 的 provider 恒输出 0 → **只是不驱动嘴**，
  嘴停在 idle 动作给的位置（实测该模型 idle 会把 `ParamMouthOpenY` 留在 1.000）。
  所以读数里 `write` 的 `区间 [1.000, 1.000]` 是对的，**不代表嘴闭着**。要"嘴闭上"得让 idle 动作本身不张嘴。
