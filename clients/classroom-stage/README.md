# classroom-stage · 课堂舞台（DSH 客户端插件）

> 产出：galgame 风格的「课堂舞台」——借 **STAGE-3 的 B 讲台骨架 ＋ C 書庫材质**，挂在 DSH 的
> **`conversation.view`** 座上，读教室自己的文件显示真实课程数据，并**把对话正文按实测令牌渲染出来**。
> 形态：**客户端插件**（浏览器半边做界面）＋ **空宿主半边**（只为让 Loader 行可挂载）。
> 2026-09-28。

## 1 · 它是什么 / 不是什么

**是**：
- 通过官方支持的 slot（`conversation.view`）建一个可切换打开的「课堂舞台」；
- 默认**不替换/不破坏**官方 composer、工具调用、附件、权限（只新增一个视图条目，id 域开放，不接管任何官方键）；
- 采用 Stage3 的 **B 讲台骨架 ＋ C 書庫材质**，默认素材全自包含 SVG/CSS；
- 读真实 `classrooms/cs-os` 的教室名、讲次、老师、课程表；
- **渲染对话正文**：从会话流里取「台词」（老师的话 ＋ 学生的话），按从真实游玩截图量出来的
  令牌排在一列无框无底的正文带上（左右边界 17.2%/80.2%、字号 47px、行距 1.74、
  旧行 `#cccccc` / 当前行 `#ffffff`、青色梯形推进指示器、上下发丝花饰）；
- 提供 `captureFrame(sessionId)` 截图入口（返回真实 DOM 节点 ＋ 一份可断言的帧描述）；
- live2d 资产未部署时**显式状态**（不挂真 Cubism、不白屏、不冒充）；
- 所有用户可见控制（刷新 / 书脊选讲）都有真实 handler。

**不是**：
- 不挂真实 Live2D（依赖未分发的 `live2d-host/out`）；
- 不引 mermaid（板书图本轮不做，那由 classroom-ui 负责）；
- 不加载任何第三方游戏/角色素材；
- **不画姓名条**（真实界面里根本没有姓名牌——见 §5）；
- 不修改 classroom-ui / live2d-host / plugins / classrooms / skills。

## 2 · 挂载点：`conversation.view`（**为什么从右侧栏换过来**）

```js
ctx.slots.inject('conversation.view', () => ctx.slots.register(
  { name: 'conversation.view', id: 'classroom-stage', order: 100, label: '课堂舞台' },
  Component,
))
```

| 事实 | 依据 |
|---|---|
| 🔴 **右侧栏拿不到对话流** | `sidebar.right.pane.tab` 那一层只有会话列表与状态，没有当前会话的消息读口 |
| `conversation.view` 比 root 座多 **8 个会话专属接口** | `sessionId` / `useChat` / `useConversation` / `useInput` / `useProjection` / `useTrajectory` / `inputActions` / `useSession` |
| 该座 `replaceRisk: "none"`、`kind: list`、`scope: session` | 官方座目录逐字 *"Registered Conversation target Views, rendered one at a time."* |
| **`id` 必填** | 官方 `viewTabs()` 对 `undefined` 直接 `continue` |
| **`label` 会被读** | `resolveSlotLabel(entry.options.label) ?? entry.options.id` → 中文名写 `label` |
| 切到舞台时官方消息区不渲染，**切回去精确恢复** | *rendered one at a time* 是官方设计（官方自己就有 `chat` 与 `trajectory` 两个占位者），不是我们硬塞 |

**右侧栏仍归 classroom-ui**，本包不再注册 `sidebar.right.pane.tab` / `.title`，也不再用 `sidebarRightTabs`。

**数据通道两条**：
1. 教室文件：`ctx.remote.workspaceFiles.read(sessionId, path, {offset})`（相对路径按会话工作区根解析，不需要服务端插件）；
2. 对话流：`conversation.view` 的 standardProps 里的 `useChat` 选择器 hook（`s.order` 节点键序列 ＋ `s.nodes` 按键取节点的 store）。

## 3 · 对话正文怎么渲染（本包的核心）

### 3.1 令牌**逐条来自真实截图**，不是设计偏好

出处：`开源线/DSH定制/实现报告_STAGE3_按真实参考重做_2026-09-24.md` **§2.1**
（依据图 U1 ＝ 官方商店 1920×1080 截图，另有 U3 交叉验证）。

| 项 | 值 |
|---|---|
| 文字列左边界 | **17.2%** 屏宽 |
| 文字列右边界 | **80.2%**（右边距 19.8%） |
| 文本带纵向锚点 | **顶对齐 14.9%**（不是贴底） |
| 正文字号 | **47px**（真实 44px 字面 ＋ 描边；画布基准 **1920×1080**） |
| 行距 | **1.74**（≈82px） |
| 段间距 | **≈两倍行距**（中间空一行） |
| 描边 | 白字 ＋ 深色描边 2px，用 **8 向 `text-shadow` 环** |
| 旧行 / 当前行 | 🔴 **字号完全相同**；旧行 `#cccccc`、当前行 `#ffffff` |
| 推进指示器 | 青色梯形 **33×30px**，**跟在末行末尾**（不是固定角落） |
| 发丝花饰 | 屏幕**上下各一条**居中曲线，近白、1px 线、46% 宽（SVG） |
| 正文字族 | **无衬线（黑体）＋重描边**（不是衬线） |
| 对话框 / 卡片 / 压暗层 | 🔴 **一律没有**——文字直接压在画面上 |
| 姓名条 | 🔴 真实界面里**不存在** → 默认不画 |

**改这些数之前必须先有新的真实素材。** 本包不"顺手调得更好看"。

### 3.2 哪些内容算「台词」

白名单三个 kind（用白名单不用黑名单：上游加新 kind 时默认是"不显示"，不会突然把系统提示甩到舞台上）：

| kind | 取哪段 | 说明 |
|---|---|---|
| `assistant-step` | `data.blocks[]` 里 `kind === "text"` 的块 | `reasoning` / `tool-call` 不是台词 |
| `user` / `steering` | `data.content[]` 里 `type === "text"` 的块 | 学生自己说的 |

其余（`context` / `command` / `system-prompt` / `developer-message` / `tool-call` / `turn-tail` /
`turn-process` / `turn-trigger`）**不进舞台**——它们是上下文注入与协议材料。
`visibility === "hidden"` 的节点一律跳过。

> 两套块形状（`kind` 与 `type`）是上游两套消息模型（assistant lifecycle 与 input message）的
> **真实差别**，不是笔误。

### 3.3 版面与缩放

- **固定 1920×1080 画布 ＋ JS 整体 scale**（letterbox，与 `prototypes/stage3/stage3.js` 同一做法）。
- 🔴 **画布内的纵向尺寸一律 px**：用 `vh`/`%` 在「容器高度 auto」处会**静默失效**
  （症状是"看起来只是有点小"，不是报错）——这是 STAGE-3 踩过的坑。
  画布内的横向百分比是安全的，因为画布自己有确定尺寸。
- **正文超长**时用 `justifyContent: 'flex-end'` ＋ `overflow: hidden` ＋ `maxHeight`：
  被裁掉的是**顶部的旧文**，最新一行永远看得见——纯布局决定，没有任何"估算折行数"的启发式。
- 版面分区：顶部书脊条（左）＋ 课堂名（右）／中部正文带／右侧讲台立绘位／底部元信息条／上下发丝花饰。

## 4 · 借什么 / 不借什么

**借**：
- classroom-ui 的「手写惰性 CJS 产物」形态 ＋ 空宿主半边 ＋ `dsh.bundle.patch` ＋ `dsh.client` 声明；
- 安装版官方座目录的 `conversation.view` 逐字契约（`kind`/`scope`/`registerOptions`/`replaceRisk`/官方示例）；
- Stage3 的 B 讲台骨架 ＋ C 書庫材质色板与全部对话令牌；
- `moeru-ai/airi` 的 `Stage.vue` 做法：每个渲染后端统一暴露 `captureFrame`（我们只做 React 这一端）。

**不借**：
- classroom-ui 的 Live2D 渲染宿主（依赖未分发 out）→ 只显式报未部署；
- classroom-ui 的 mermaid 板书图（3.57MB vendor ＋ DOMPurify）→ 本轮不做；
- airi 的 Vue/Pinia/Router 技术栈与其 TTS/语音链路；
- 任何第三方游戏/角色素材。

## 5 · 诚实边界（**必须读**）

- 🔴 **没有跑过真实会话。** 本包只有「代码 ＋ node 侧测试」。真实隔离会话的验收（切进切出、
  输入框仍可聚焦、官方弹层不被盖、撤场零残留、console/pageError 为 0）**由主代理另跑**，
  本包**不声称已验收**。
- 🔴 **立绘资产未分发**（`live2d-host` 的 `vendor/`／`samples/` 不在仓）→ 立绘位保持
  「未部署」显式状态，只显示自包含占位剪影。
- 🔴 **多角色同台未实现**（教室目前只有 1 张角色卡）→ 姓名条**只留接口**（`nameTagPlan()`），
  在场者名单恒为空。真实界面本来也没有姓名牌，所以默认不画不算缺失。
- **「旧行 / 当前行」按段落粒度落地**（每段 ＝ 一条消息里的一段文字）：只有最后一段是白字。
  真实截图量的是"行"，我们的消息比一行长得多，这是**映射方式的推断**，待真实会话确认。
- **`sessionReadAccess` 从 `"unsupported"` 改成 `"supported"`**：换到 `conversation.view` 之后
  宿主确实向该座提供 `useChat`（实测条目收到 19 个 props）。**"读得到"是实测事实；
  "渲染出来好不好看"本轮没有真实会话验收。**
- **`pointerEvents` 在本包根节点显式写 `auto`**：`conversation.view` 是**我们自己的会话内容区**
  （官方视图此时不渲染），不是盖在别的东西上的浮层，所以这里要的就是接管。
  C-1 那条「不写就等于接管整个 app」的教训针对的是 `shell.overlay`，与本座不是一回事。
- **装载配置的推断**：`package.json` 的 `dsh.client.inject` 按任务要求收窄为
  `["@deepseek-ai/dsh-client-ui-conversation"]`（保证声明该座的包先加载）。
  该字段是**模块加载次序**声明，不是能力门；`ctx.remote` 由本包自己的 cordis
  `exports.inject`（`["slots", "remote", "remote.workspaceFiles"]`）保证。**未实机验证收窄后
  `ctx.remote` 仍可用。**

## 6 · 目录

| 文件 | 作用 |
|---|---|
| `package.json` | `dsh.bundle.patch`（成为 profile 的一层）＋ `dsh.client`（浏览器 roster 声明）＋ `exports["./client"]` |
| `cordis.patch.yml` | 往 profile 树里插一行 loader 条目（`id/name = classroom-stage`） |
| `lib/index.js` | 宿主半边：**空**。存在的唯一理由是 Loader 行要有一个可 import 的宿主模块 |
| `lib/client.js` | 浏览器半边：**手写的产物文件**（`window.__ModuleLoader__.load({id, factory})` 格式）。① 注册 `conversation.view` 条目；② 读盘与解析；③ 会话流 → 台词 → 正文带；④ 舞台版面（固定画布 ＋ JS scale）；⑤ 立绘未部署显式状态；⑥ `captureFrame` 截图入口；⑦ 真实控制 handler |
| `test/stage.test.mjs` | node 侧主测试：**驱动 `lib/client.js` 的真实代码**，喂真实教室文件与伪造会话流，覆盖挂载点、解析、读盘、**对话令牌数值**、渲染树、未部署状态、截图入口、出口契约 |
| `test/wiring.test.mjs` | 接线/渲染冒烟：注册形状 ＋ 真实 store 渲染不抛错 ＋ 控制都有 handler ＋ console 0 |

## 7 · 跑测试

```bash
node clients/classroom-stage/test/stage.test.mjs
node clients/classroom-stage/test/wiring.test.mjs
```

测试不依赖浏览器，驱动与浏览器里同一份 `lib/client.js`：伪造 `window.__ModuleLoader__` 收下产物，
给 factory 一个最小 `require`（只认 `"react"`），喂真实 `classrooms/cs-os` 文件。

## 8 · 基准版本（🔴 结论只对这个版本成立）

**`dsh 0.1.7-rc.2`**（`dsh-client-ui-layout` sha256 前 16 位 `0aa7c7437cc30a09`）。

- `conversation.view` 的 19 个 props、`label` 被读、`rendered one at a time`、切回精确恢复——
  这些都是**该版本的实测/静态取证**结论。
- 条目外面那层 `display: contents` 的 wrapper 是**宿主实现细节，官方座目录没有承诺**，
  改版即失效。
- 升级 DSH 之后，本包的所有宿主相关结论**必须重新验证**。

## 9 · 装载与验收（隔离 DSH_HOME）

按项目纪律，真机验收前必须在 **/tmp 隔离的 web profile** 里装一份再跑（硬判 `DSH_HOME` 指向隔离目录，
拒绝 `??` 兜底），装前装后核 `dsh.profile.bundles` 与包哈希。证据放 /tmp，不进仓。

## 10 · 待确认清单（本轮按默认规则推进，未找用户拍板）

| # | 问题 | 本轮采用的默认 | 影响面 |
|---|---|---|---|
| 1 | **「旧行 / 当前行」的粒度**：真实截图量的是"行"，我们的一条消息比一行长得多 | 按**段落**落地（每段 ＝ 一条消息里的一段文字，换行即分段），只有最后一段是白字 | 观感；真实会话一看便知 |
| 2 | **正文超长时怎么处理**：真实界面一屏只有几行，我们的消息长得多 | 用 flex-end ＋ `maxHeight` **从顶部裁掉旧文**，保住最新一行；顶部加渐隐 | 观感；不做滚动条是刻意的 |
| 3 | **`dsh.client.inject` 收窄后 `ctx.remote` 是否仍可用** | 按任务要求收窄为 `["@deepseek-ai/dsh-client-ui-conversation"]`（该字段是模块加载次序，不是能力门；`ctx.remote` 由本包 cordis `exports.inject` 保证） | 装载；**未实机验证** |
| 4 | **画布被缩到多小才算能读**：舞台占的是会话内容区（通常 800–1100px 宽），1920 画布会缩到 ~0.45 倍 | 沿用「1920×1080 固定画布 ＋ `min(w/1920, h/1080)` 整体 scale」的 letterbox 做法 | 观感；若太小，备选是改用「画布宽度 ＝ 容器宽度、纵向仍按 px 比例」 |
| 5 | **选择肢（六条固定项）本轮未做** | 只记录事实（`inputActions` 有 `setDraft`/`insertText`，可直接把文本塞进输入框），**不实现 UI**：六条选项的逐字文案要从 STAGE-3 §5.2 取，本轮未取，编一份等于造内容 | 功能缺口，需下一轮 |
| 6 | **正文带的字色不走宿主主题 token** | 画布自带奶白纸面，主题 alias 在深色主题下是近白字（白字压白纸看不见）→ 字色跟材质走 | 与宿主主题的一致性；若将来舞台改成深底，要跟着改 |

