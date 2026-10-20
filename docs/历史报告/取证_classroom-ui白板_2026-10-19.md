# 取证 · classroom-ui 客户端插件与白板装载验证（stage 实例）

- **取证时间**：2026-10-19 07:10 ~ 07:25 UTC（北京时间 15:10 ~ 15:25）
- **被测实例**：Linux 服务器 `dsh-class-server`（stage 实例，`dsh-web@stage.service`，监听 `127.0.0.1:3086`）
- **DSH 版本**：`0.1.5-rc.1`
- **取证工具**：Playwright (Chromium Headless, 1600x1000) 本机自动化脚本 ＋ SSH 隧道（`3086:127.0.0.1:3086`）＋ `journalctl` 只读查证
- **取证脚本与原始数据**：`/tmp/verify_cui.cjs`、`/tmp/cui-facts.json`

---

## 一、一句话结论

🔴 **不能用（完全未加载）**。

虽然服务端 `dsh-web@stage.service` 状态为 `active` 且无报错退出，但此前为了绕过 `service "whiteboardStore" has been registered` 启动报错而将 `classroom-ui/cordis.patch.yml` 改为空数组 `[]`，导致 Cordis Loader 未注册 `classroom-ui` 条目；上游 `@deepseek-ai/dsh-client-modules` 在扫描激活条目时完全跳过了该包，**浏览器收到的客户端插件联合请求中根本没有 `classroom-ui/client.js`**。
在客户端界面中：右侧栏**没有「教室」tab**、没有「教室」指南卡片（`data-sidebar-right-guide-entry="classroom"` 计数为 0）、DOM 中 `[data-classroom-ui]` 节点数为 0，白板存储与教室面板功能均未生效。

---

## 二、逐项证据

### 1. 面板是否出现

- **右侧栏（sidebar right）Tab 清单**：
  - 只有官方默认的 `Files`（工作区文件树）tab 与 `Start`（新建/指南）tab。
  - **不存在**「教室」tab，也不存在任何 `data-tab-id="classroom"` 的元素。
- **指南页（Guide Entry）卡片**：
  - 点击右侧栏 `+`（New tab）后展示的指南页中，**仅有 1 张引导卡片**：
    `data-sidebar-right-guide-entry="files"`（"Workspace files - Browse files in this session's workspace"）。
  - `data-sidebar-right-guide-entry="classroom"` 计数为 **0**。
- **DOM 挂载检测**：
  - `document.querySelectorAll('[data-classroom-ui]').length` = **0**
  - `document.querySelectorAll('[data-classroom-ui-skin]').length` = **0**
  - `document.querySelectorAll('[data-classroom-ui-portrait-stage]').length` = **0**
  - `document.querySelectorAll('[data-classroom-ui-draw]').length` = **0**

### 2. 页面 Body 文本片段

对全页面及会话上下文进行关键词精确匹配扫描：
- `whiteboard` / `Whiteboard`：**0 处命中**（白板功能与文本完全不存在）。
- `板书`：**0 处命中**。
- `讲次` / `相位` / `进度`：**0 处命中**。
- `小鞠知花`：**0 处命中**（面板未渲染人物信息）。
- `教室`：命中 2 处，均为 DSH 工作区与预设的固有名称：
  - 工作区名称：`教室舞台测试区`
  - 智能体预设：`计算机系教室 · 操作系统`
- `cs-os` / `curriculum`：命中的是左侧聊天流中模型历史对话的上下文记录（例如 `Read classrooms/cs-os/classroom.yaml`、`Read classrooms/cs-os/curriculum.md`），而非右栏面板组件渲染。

### 3. Console Error 与 Page Error 原文

- **白板报错检测**：
  - `whiteboardStore` 相关错误：**0 条**（因为客户端代码根本没被下发给浏览器执行，故浏览器控制台没有白板报错）。
- **会话内观察到的错误（与 classroom-ui 无关，为已知班级插件在缺失数据时的警告）**：
  ```text
  [BROWSER CONSOLE ERROR] TypeError: Cannot read properties of undefined (reading 'session-1c58dea9-641d-4897-a316-6fe46ce6edf1')
      at http://127.0.0.1:3086/plugins/??@deepseek-ai/dsh-api-gateway/client.js,...,@deepseek-ai/dsh-experimental-client-ui-agent-team/client.js...
      at TeamAction ...
  [BROWSER CONSOLE ERROR] slot entry crashed in 'conversation.session.header.actions': TypeError: Cannot read properties of undefined (reading 'session-1c58dea9-641d-4897-a316-6fe46ce6edf1')
  ```

### 4. 服务端日志片段与未装载根因分析

#### (1) 当前日志（修改 `cordis.patch.yml: []` 后）
启动平稳，无报错，Token 正常派发：
```text
Oct 19 07:14:05 frp-vps-13065-mtr8kimi-pcozqp node[3529016]: (node:3529016) ExperimentalWarning: SQLite is an experimental feature and might change at any time
Oct 19 07:14:08 frp-vps-13065-mtr8kimi-pcozqp node[3529016]: dsh web: http://127.0.0.1:3086/?token=uj_p9HIta9FQh85yCalkOxDpVNxTOUk0MyStDS-9AZU
Oct 19 07:14:30 frp-vps-13065-mtr8kimi-pcozqp node[3529016]: dsh-memento: 宿主未收录 memory/* 会话事件...
```

#### (2) 历史报错日志（此前 `cordis.patch.yml` 包含 insert 时的真因）
在 2026-10-19 06:46:38 重启时，服务端因重复注册直接崩溃退出：
```text
Oct 19 06:46:38 frp-vps-13065-mtr8kimi-pcozqp node[3493350]: Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): failed to apply loader entry classroom-ui (classroom-ui): service "whiteboardStore" has been registered at <Include>
Oct 19 06:46:38 frp-vps-13065-mtr8kimi-pcozqp node[3493350]: Error: service "whiteboardStore" has been registered at <Include>
Oct 19 06:46:38 frp-vps-13065-mtr8kimi-pcozqp node[3493350]:     at Proxy.provide (file:///opt/dsh-releases/0.1.5-rc.1/node_modules/@deepseek-ai/cordis/lib/index.js:800:25)
Oct 19 06:46:38 frp-vps-13065-mtr8kimi-pcozqp node[3493350]:     at Fiber.<anonymous> (file:///srv/dsh-users/stage/home/profiles/web/node_modules/classroom-ui/lib/index.js:22:24)
Oct 19 06:46:38 frp-vps-13065-mtr8kimi-pcozqp node[3493350]:     at new apply (file:///srv/dsh-users/stage/home/profiles/web/node_modules/classroom-ui/lib/index.js:22:7)
Oct 19 06:46:38 frp-vps-13065-mtr8kimi-pcozqp node[3493350]:     at file:///srv/dsh-users/stage/home/profiles/web/#classroom-ui
Oct 19 06:46:38 frp-vps-13065-mtr8kimi-pcozqp node[3493350]:     at file:///srv/dsh-users/stage/home/profiles/web/#include
```

#### (3) 核心根因：为什么改 `[]` 导致客户端不加载？
1. **客户端分发机制**：`@deepseek-ai/dsh-client-modules/lib/index.js:640-690` 中明确声明，浏览器端插件清单是遍历 Cordis Loader 的活跃条目（`locatePkgJson(loaderName)`），检查包的 `dsh.client` 与 `exports["./client"]` 来拼装 `/plugins/??...` URL 的。
2. **浏览器实际收到的插件请求 URL**（实测捕获）：
   ```text
   http://127.0.0.1:3086/plugins/??@deepseek-ai/dsh-api-gateway/client.js,@deepseek-ai/dsh-client-ui-open-in-app/client.js,@deepseek-ai/dsh-api-workspace-files/client.js,@deepseek-ai/dsh-client-hmr/client.js,@deepseek-ai/dsh-cordis-client-runner/client.js,@deepseek-ai/dsh-client-ui-theme/client.js,@deepseek-ai/dsh-client-locale/client.js,@deepseek-ai/dsh-client-ui-layout/client.js,@deepseek-ai/dsh-client-ui-renderer/client.js,@deepseek-ai/dsh-client-ui-session/client.js,@deepseek-ai/dsh-client-resources/client.js,@deepseek-ai/dsh-client-ui-sidebar/client.js,@deepseek-ai/dsh-client-ui-sidebar-right/client.js,@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client.js,@deepseek-ai/dsh-client-ui-sidebar-files/client.js,@deepseek-ai/dsh-client-ui-settings/client.js,@deepseek-ai/dsh-client-ui-settings-general/client.js,@deepseek-ai/dsh-client-ui-settings-models/client.js,@deepseek-ai/dsh-client-ui-settings-plugin-inventory/client.js,@deepseek-ai/dsh-client-ui-conversation/client.js,@deepseek-ai/dsh-client-ui-approval/client.js,@deepseek-ai/dsh-client-ui-chat/client.js,@deepseek-ai/dsh-client-ui-brand-official/client.js,@deepseek-ai/dsh-client-ui-attachment/client.js,@deepseek-ai/dsh-client-ui-tool/client.js,@deepseek-ai/dsh-client-ui-cordis/client.js,@deepseek-ai/dsh-client-ui-workflow-run/client.js,@deepseek-ai/dsh-client-ui-workspace/client.js,@deepseek-ai/dsh-client-ui-input-trigger/client.js,@deepseek-ai/dsh-client-ui-commands/client.js,@deepseek-ai/dsh-client-ui-skill/client.js,@deepseek-ai/dsh-client-ui-subagent/client.js,@deepseek-ai/dsh-client-ui-reference/client.js,@deepseek-ai/dsh-client-ui-jobs/client.js,@deepseek-ai/dsh-client-ui-goal/client.js,@deepseek-ai/dsh-client-ui-message-feedback/client.js,@deepseek-ai/dsh-client-ui-model-selection/client.js,@deepseek-ai/dsh-client-ui-permission-presets/client.js,@deepseek-ai/dsh-client-ui-agent-preset/client.js,@deepseek-ai/dsh-client-ui-settings-plugins/client.js,@deepseek-ai/dsh-client-ui-plan/client.js,@deepseek-ai/dsh-client-ui-user-questions/client.js,@deepseek-ai/dsh-client-ui-trajectory/client.js,@hytime/dsh-thinking-effort/client.js,@linxin666/dsh-client-ui-skill-explorer/client.js,dsh-archived-conversation/client.js,dsh-instance-restart/client.js,dsh-memory-import/client.js,@deepseek-ai/dsh-experimental-client-ui-agent-team/client.js,dsh-mermaid-renderer/client.js,dsh-class-providers/client.js,classroom-stage-warm/client.js,dsh-class-welcome/client.js,@deepseek-ai/dsh-session-log-export/client.js,dsh-free-search/client.js,dsh-memento/client.js,@deepseek-ai/dsh-client-file-upload/client.js,@deepseek-ai/dsh-client-ui-deliverables/client.js,@deepseek-ai/dsh-api-remotes/client.js,dshmarket/client.js,@deepseek-ai/dsh-typert-registry/client.js,@deepseek-ai/dsh-api-session-controller/client.js&rev=48f0ad99489c
   ```
   **核对结论**：该 URL 共请求了 63 个客户端包，其中包括 `classroom-stage-warm/client.js` 等，但**完全没有 `classroom-ui/client.js`**。
3. 把 `cordis.patch.yml` 改成 `[]` 确实消除了启动冲突，但代价是**连带抹除了 Loader 行**，使得 DSH 宿主完全不知道要把 `classroom-ui` 的前端产物下发给浏览器。

---

## 三、取证截图清单

以下截图均已保存在本地 `/tmp/` 目录：

| 文件路径 | 说明 |
|---|---|
| `/tmp/cui-01-initial.png` | 页面初始加载状态（全屏 `classroom-stage-warm` 舞台覆盖整屏） |
| `/tmp/cui-02-after-stage-close.png` | 按 `Control+Shift+M` 关掉舞台后，露出 DSH 原生主界面与提示弹窗 |
| `/tmp/cui-03-after-modal-dismiss.png` | 关闭弹窗后的 DSH 原生界面（左侧工作区与会话列表清晰可见） |
| `/tmp/cui-04-session-view.png` | 点击进入「操作系统第一讲」真实会话后的界面 |
| `/tmp/cui-05-classroom-panel.png` | 展开右侧栏并点击「新建 Tab」后的视图：**仅有 Workspace files，无教室面板** |
| `/tmp/cui-06-final.png` | 最终完整视口状态 |

---

## 四、待确认清单

1. **`service "whiteboardStore" has been registered` 的根本修复方案**：
   - 现象：`cordis.patch.yml` 中若有 `- insert: [ { id: classroom-ui, name: classroom-ui } ]`，会导致 `apply(ctx)` 试图提供两次 `whiteboardStore` 服务。
   - 待确认：建议在 `classroom-ui/lib/index.js` 的 `apply(ctx)` 中添加服务已存在检查或幂等判断：
     ```javascript
     export function apply(ctx) {
       if (!ctx.whiteboardStore) {
         ctx.effect(() => ctx.provide('whiteboardStore', new WhiteboardStore(ctx)), 'classroom-ui: whiteboardStore')
       }
     }
     ```
     并在其 `cordis.patch.yml` 中恢复对自己的 loader 注册，使 `dsh-client-modules` 能正确扫到前端 bundle。
2. **`classroom-ui` 是否应区分「仅纯前端」与「含宿主白板 Remote」**：
   - 原版 `classroom-ui`（在 09-24 的 T1/T5 时期）宿主半边 `lib/index.js` 是**完全为空**的（只为了满足 loader import），当时面板读盘全部走宿主自带的 `ctx.remote.workspaceFiles.read`，根本无需提供任何后端 service。
   - 后来在引入白板时，`lib/index.js` 新增了 `ctx.provide('whiteboardStore', ...)`，才触发了与 Cordis 内部 service 的命名/加载冲突。
   - 待确认：如果当前只需验证右栏面板，是否可以把 `lib/index.js` 恢复为空或做好防御性注册后再重新装入。
