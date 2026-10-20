# DSH 客户端 UI 可定制性侦察

> 范围：只读副本 `/Users/wujunjie/Documents/ChatGPT/大学申请/tmp/dsh-src`（父代理说明与 2026-09-22 master / v0.1.7-alpha.2 完全一致，无 `.git`；本次未运行 git）。源码结论尽量定位到相对路径与行号；工期是结构推断，不是实际实施数据。

## 0. 摘要与总体判断

**结论：客户端 UI 高度插件化，主要界面位置有 typed slots，消息 renderer 和主题/品牌也提供扩展面；但不是任意 React 插件自动进入 UI，扩展要遵守 slot 声明、profile 收录与 bundle 规则。** Mermaid、Live2D、Excalidraw 均未找到现成实现；分别可落到共享 Markdown renderer、聊天 keyed node 或 rightbar/main plugin。课程状态若需跨会话恢复，要加入 Conversation event/projection，而不是只放组件 local state。建议优先新建自有客户端插件并利用 `main` / `rightbar` / `conversation.chat.node` slots，避免大面积改写 40 余个既有 `ui-*` 包。

## 1. 消息渲染管线

待核验。

## 2. Slot 插槽系统

待核验。

## 3. SocraticNovel 需求逐项可行性

待核验。

## 4. 客户端插件打包、HMR 与开发工作流

待核验。

## 5. Web / Desktop 分发

待核验。

## 6. 主题、品牌与中文排版

待核验。

## 待确认清单

- 待核验后填写。

## 自报耗时

开始时间：2026-09-22；结束时填写实际 elapsed。

## 1. 消息渲染管线

### Markdown 与富媒体

- 消息 Assistant 文本由 `ui-chat/src/client/chat/AssistantMarkdown.tsx:3,74-85` 调用 `ui-primitives` 的 `MarkdownText` 渲染；Assistant blocks 目前按 `text`、`reasoning`、`image`、`tool-call` 分支，未知 block 走 JSON 展示（同文件 `:74-135`）。消息块不是将任意 HTML 字符串直接塞进 DOM 的通用渲染器。
- `ui-primitives/src/markdown/MarkdownText.tsx:2-11,17-24,29-57,149-172` 使用本仓自有 mdast pipeline（`mdast-util-from-markdown` + GFM；streaming 增量 parser；结束后 parse GFM + math），不是 `react-markdown` / `marked`。文档注释明确 raw HTML、危险协议禁用；TeX 经 KaTeX。解析器位置：`ui-primitives/src/markdown/parse.ts:11-43`。
- 支持 GFM 段落/标题/引用/列表/表格/删除线/链接/图片/脚注等；渲染映射见 `ui-primitives/src/markdown/render.tsx:269-367`。代码围栏由 `CodeBlock` 渲染并用 Shiki 高亮（`render.tsx:371-407`、`CodeBlock.tsx:72-184`、`highlight.ts:8-16`）；数学 `$...$` / `$$...$$` 和 settled `math` fence 经 KaTeX（`render.tsx:329-337,381-388`；`MarkdownText.tsx:170-172`）。图片支持绝对 HTTP(S) 及由 owner 显式解析的本地路径（`render.tsx:612-618`、`AssistantMarkdown.tsx:19-23,57-59`）。
- 未找到聊天 Markdown 中 Mermaid、通用 HTML 执行、图表/plot 渲染器：对 `packages/client` 源码检索词 `mermaid|chart|plot|MarkdownText|katex|mathjax|highlight|shiki`；命中 KaTeX/Shiki，无 Mermaid/chart/plot 集成。Raw HTML 在 Markdown 中按文字处理，见 `render.tsx:329-331`。交付物 HTML 是独立的 deliverables/document-preview 面，不等于聊天内渲染（`ui-deliverables` 与 `ui-sidebar-documentpreview/src/client/html/HtmlBody.tsx:1,68,101`）。

### 自定义扩展点

- 增加 Markdown 原生语法块：修改 `ui-primitives/src/markdown/parse.ts` 的 grammar 与 `render.tsx` 的 mdast node mapping；若需要外部库，在 `ui-primitives/package.json` 声明依赖并落实安全、streaming 与尺寸/错误处理。它是共享 primitive，可能影响所有用 `MarkdownText` 的客户端面。
- 增加有业务状态的聊天节点（例如可持久化白板引用/角色卡状态）：应在 `ui-conversation` 的 Conversation event/node definition 层投影为业务 Node，再由 `ui-chat` 的 `conversation.chat.node` keyed slot 注册 renderer；不要只在 Markdown DOM 层硬解析日志。跨插件 UI 内容通过 slot 传递，符合 `packages/client/AGENTS.md` 的 Conversation Node 与 layering 规则。
- 单纯 Live2D / 白板显示不要求修改消息协议：用聊天节点 renderer 或 `ui-sidebar-right` 面板挂载纯 props React component；若在消息正文中识别 fence，应给 renderer 明确 node 类型，而非 raw HTML。

## 2. Slot 插槽系统

`ui-slots/src/index.ts:25-29` 提供可通过 TypeScript declaration merging 扩充的 `SlotMap` / `SlotFactoryMap`；slot contract 描述位置的基数（single/list/keyed/chain）与作用域（root/session-maybe/session，`:100-105`）。宿主只渲染预置 `root`（`ui-renderer/src/client/app.tsx:1-3,21`）；根 frame `ui-layout/src/client/index.ts:161-172` 声明 sidebar/main/rightbar/shell.overlay/shell.leading 五个子位。注册前必须由父 entry 的 `children` 声明该子位，`SlotCore.register` 运行时拒绝未声明位置（`ui-slots/src/index.ts:1203-1207`）。

主要位置（按 `ui-layout/src/client/index.ts:46-105` 与 `ui-conversation/src/client/contract/slots.ts:128-223`）：
- 全局三栏：`sidebar`（整个左栏、单例且由 SidebarRoot 占位，替换它会换掉整个导航）、`main`（keyed 中央工作区）、`rightbar`（右侧栏）、`shell.overlay`（全窗口浮层，可列表追加）、`shell.leading`（折叠侧栏时窗口左上角控件）。向侧栏加按钮/页面应注册 `ui-sidebar` 声明的内部座位，而非替换 sidebar。
- 对话区：`main.conversation`、`conversation.header`、header leading/session actions/utilities/corner、hero workspace/brand/agentPreset；`conversation.input.dock/overlay/left/right/activity/attachments/plan/permission/model` 与 composer dock 等。输入面上方、工具列左右、悬浮层、页眉、主区都有具体挂点。
- 聊天消息：`conversation.chat.node` 是按 `ChatNodeKind` keyed 的业务节点 renderer；`conversation.message.images` 是图片组 gallery 单位替换位；另有命令视图、turnTail、assistant-actions list（`ui-chat/src/client/contract/slots.ts:234-271`）。

注册模式：组件包在 `apply` 中 `ctx.slots.inject(slotName, () => ctx.slots.register(...))`，将组件注册到父节点声明的子位；`register` 返回 disposer。UI Slot 体系要求 `children` 同时作为声明和授权，扩展包不得直接替代其他插件已声明的子位。`ui-chat/src/client/chat/register-node-renderers.ts:25-75` 展示 keyed 注册样例（assistant-step、user、tool 等）；`ui-conversation/src/client/skeleton/TodoPanel.tsx:103-118` 也展示 list slot 注册。

扩展策略：微信聊天式教室完整替换主区时可新增 keyed `main` panel（需提供完整体验）；轻量教室/课程信息可放 `conversation.session.header.utilities` 或独立 `rightbar`；角色状态可用聊天 node keyed renderer / turnTail，也可右栏展示。若要加自有全屏浮层，用 `shell.overlay` list，不覆盖全局 root。

## 3. SocraticNovel 需求逐项可行性

全仓客户端检索 `excalidraw|whiteboard|mermaid|pixi-live2d-display|Live2D` 未找到命中；依赖清单检索同词未找到依赖。iframe/canvas 先例存在：HTML document preview 用隔离 iframe（`ui-sidebar-documentpreview/src/client/html/HtmlBody.tsx:1,34-68,90-101`），PDF.js 逐页 canvas（`.../pdf/pdf.tsx:145-176`），浏览器侧栏也有 iframe navigator。因此嵌入类技术并非新模式，但聊天节点并无相应现成组件。

1. **Mermaid 聊天渲染**：仓库 Markdown 已经是自有 mdast parser/renderer，现无 Mermaid。中等改动：在 `ui-primitives` parser 增加识别约定（如 `mermaid` fenced code），renderer 将该 fence 分发到独立 React component；引入 `mermaid` 依赖，注意 lazy load、流式未闭合 fence、错误可见性、SVG/XSS、主题适配。估量：1 个包、1 依赖，约 2-4 工程日（含测试/安全与视觉打磨）；若只支持聊天、不要求其它 Markdown 使用，则可在 `ui-chat` AssistantMarkdown 做 fence 专用层，但会分叉公共 Markdown 规则。
2. **Live2D 角色立绘**：最小消息流挂点是在 `ui-chat` 注册 `conversation.chat.node` 新 keyed kind/component（需要从 Conversation node definitions 提供一个模型可识别的业务 kind，若仅按 assistant 内容触发则需约定 fence/node mapping）；更自然的常驻立绘是独立 `ui-sidebar-right` tab，已有 tab registry/render 先例（`ui-sidebar-right/src/client/index.ts:163-191`）。新增 `pixi.js` 与合适的 pixi-live2d-display 实现依赖（当前全仓无命中），在纯 props renderer 内持有 canvas/pixi 生命周期；不要在 Markdown raw HTML 注入。估量：右栏静态/少量动作约 2-4 日；消息联动（解析情绪/姿态、资源映射、切换/销毁、动画性能与无障碍）约 1-2 周。模型文件分发体积、Cubism SDK/模型授权需单独确认。
3. **白板 / Excalidraw**：仓库无 excalidraw/whiteboard 先例，但已有隔离 HTML iframe、PDF canvas；最直接方案为新建 `ui-whiteboard` 插件，嵌入 Excalidraw React 组件到独立 main view/rightbar tab，而不是 iframe（避免跨 frame 协作复杂）；依赖 `@excalidraw/excalidraw`，需经 workspace/build许可核验。仅本地临时白板估量 3-5 日；若需与对话绑定、持久化、恢复/导出/附件引用与多白板管理约 1-2 周，需定义业务 Node/event 或资源协议。结论为可行但 repo 无集成先例。

“微信聊天式教室面板 / 角色卡 / 课程状态”：UI frame 可通过 keyed `main` panel 做完整教室，或右栏 tab + `conversation.chat.node` / header utilities 做伴随视图。纯展示中等规模约 3-7 日；如课程进度要跨会话持久化，不能只放 UI store，需设计 session event、projection 和恢复语义。

量级为工程估计，受 fork 对上游持续合并要求影响；要大改布局和白板/Live2D，建议单独 feature plugins 组合，保持上游 UI 包差异小。

## 4. 客户端插件打包、HMR 与开发工作流

- 各包 `tsdown.config.ts` 使用 `packages/client/tsdown.client.ts` preset（例 `ui-chat/tsdown.config.ts:1-3`），输出 `lib/client.js` 及可选 chunks；浏览器插件 bundle 向 `window.__ModuleLoader__` 注册闭包 factory，依赖通过 module table 解析。CSS Modules 编译为 hashed class 并注入 plugin-owned style，dispose 时移除（`tsdown.client.ts:1-10,36-55`）。
- `packages/client/hmr/src/client/index.ts:18-46` 用 EventSource 监听 `/plugins/events`，将 graph/rebuilt frames 交给模块 entry controller。HMR README `:12,28-36,62-74` 表明依赖插件级联重载、React 组件本地 state 丢失、失败不回滚旧 bundle；这是插件替换式 HMR，不是 React Fast Refresh。
- 开发循环：仓库根 `pnpm run dev:web`，先 build，后并行跑 Client `tsc -b --watch`、tsdown watcher、`apps/web` Vite build watcher，最后启动 `dsh web`（`scripts/dev-web.ts:1-20,22-30`）。支持 `--poll`；已有服务器时可 `pnpm run dev:web --skip-build --no-serve` 只开 watchers（`:22-30,178-209`）。源码编辑后 Host 监测 `lib/client.js` revision 并推 HMR；端到端用例 `apps/web/tests/hmr-live.e2e.ts:87-145`。
- 新包按 `packages/client/AGENTS.md` checklist 接入：创建包与 client entry、tsdown 配置，并更新 `tsconfig.client.json`、`packages/bundle/web-app/cordis.patch.yml`、web-app package dependencies；非 baseline 动态 import 须声明 external/dependency policy。

## 5. Web / Desktop 分发

- `apps/web` 是 Vite 构建器和静态 `dist/` 产物，**不是独立 GUI app**。`apps/web/package.json:2-3,24-29` 说明由 CLI `dsh web` 提供；`apps/web/vite.config.ts:11-13,32-39` 裸 Vite serve 会 fail，因为缺 Host 注入的 `window.__DSH_BOOT__` / ModuleLoader。`apps/web/src/main.ts:16-36` 仅启动 `AppWebEntry`，Host/Desktop 负责 boot injections 与 bundle transport。
- 不用 dsh-desktop 的最短自建发行方式：保留/定制 Web profile、`apps/web/dist`，为 profile 注册自有 UI plugins，再运行 `dsh web`；如目标是纯静态站点，还需另做 Host/API、boot injection、认证和流式 transport carrier，单发 dist 不够。
- Desktop 壳通过 `apps/desktop/src/main.ts:551-565` 从 `@deepseek-ai/dsh-web-frontend/dist` 提供静态页面并转发 Host/API 请求。`web-document.ts:10,31-35` 注入 boot-ready gate，`preload-app.ts:28,48-51` 提供 `dshDesktopBoot.ready/failed`；`apps/web/src/main.ts:20-36` 消费 Host 返回的 injections/streamBaseUrl 后启动 web shell。即复用同一 Web 页面与客户端插件，不独立实现 UI。

## 6. 主题、品牌与中文排版

- `ui-theme` 提供可注册主题与 alias-token 覆写。`ThemeDefinition` 在 `ui-theme/src/client/index.ts:48-76`；`register`/disposer 在 `:269-291`；`overrideTokens` 按 light/dark 覆盖 alias token，后层获胜（`:293-317,344-353`）。README `ui-theme/README.md:12,34-40,50-60,103-104` 说明第三方主题可用，但不校验 token 覆盖完整度，应双主题模式测试。
- `ui-theme/src/styles/design-platform.css:166-214` 定义 palette 与 semantic `--dsw-alias-*`，dark 覆写在 `:85`。建议优先通过 token 换肤，扩充新 token 时同步 consumer。
- 品牌有独立 plugin/slots：`ui-brand-official/src/client/index.ts:16-22` 注册 wordmark/logo；`Brand.tsx:9-18` 用 primitives。`sidebar.brand.mark/name` 可换侧栏品牌；`conversation.hero.brand.mark` 单独存在，官方品牌插件刻意不占用（`index.ts:10-13`）。换品牌素材约半日至 2 日；广泛 token 换肤约 2-5 日，含暗色与状态色验收。
- `ui-theme/src/styles/base.css:1-10` 默认系统字体含 PingFang SC、Hiragino Sans GB、Microsoft YaHei 等 CJK fallbacks；README `:56` 有 Montserrat brand fonts。`packages/client/web/README.md:30-32` 说明中西文自动间距依赖浏览器 text-autospace 支持。
- UI 全面换布局涉及多包，量级高；建议新增/替换自有插件优先，保留上游 feature 包和 slots，减少长期 fork diff。

## 待确认清单

1. **Live2D 授权和发行**：pixi-live2d-display 分支、Cubism runtime、模型授权、资源体积待选库后核对；当前源码无先例。
2. **白板持久化**：只临时展示/导出，还是会话恢复且可编辑？后者需定义 session event/resource。
3. **自建发行目标**：CLI Host + profile 可用 `dsh web`；纯静态部署需另做 API/Host/boot/auth carrier。
4. **教室布局**：暂建议完整教室 `main` keyed panel、伴随状态 rightbar；最终取决于视觉与导航要求。

## 自报耗时

开始时间：2026-09-22；当前完成；主动核查与撰写约 24 分钟（不含首次权限阻断）。
