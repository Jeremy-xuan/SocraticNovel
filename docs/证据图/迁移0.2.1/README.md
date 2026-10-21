# 证据 · 迁移 DSH 0.2.1-rc.2（2026-10-20）

对应任务：`docs/计划与排产/开发文档_功能开发_2026-10-20.md` §三 B（B1–B4）。
本目录只放**可复核的原始输出**，结论写进 `docs/历史报告/实现报告_B_迁移0.2.1_2026-10-20.md`。

## 环境

| 项 | 值 |
|---|---|
| 宿主 | DeepSeek Harness **0.2.1-rc.2**（`/Applications/DeepSeek Harness.app`，bundle 内 harness 版本自报 0.2.1-rc.2） |
| CLI | `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh` → `dsh --version` = `0.2.1-rc.2` |
| 隔离 profile | `~/.dsh/profiles/classroom-dev`（由 `dsh --profile classroom-dev --from-default-profile web` 生成，**不碰 `desktop`**） |
| 装进去的插件 | `socratic-engine`、`classroom-stage-warm`、`classroom-ui`（`link:` 指向本仓库） |
| 浏览器 | Playwright（`NODE_PATH=/opt/homebrew/lib/node_modules`）+ 本机缓存的 chromium，headless |

## 文件

| 文件 | 是什么 | 怎么看 |
|---|---|---|
| `boot-隔离profile-0.2.1.log` | 隔离 profile 真启动的 stdout。**没有** `did not activate` / `failed to import` / `never started` | `grep -c "did not activate" boot-隔离profile-0.2.1.log` → 0 |
| `browser-probe-0.2.1.json` | 真浏览器 16 秒后的取样：`stageRoot`、`slotErrors`、`crashPlaceholders`、我们的插件相关 console 问题 | `jq '.dom, .ourConsoleIssues' browser-probe-0.2.1.json` |
| `browser-有舞台-0.2.1.png` | 真浏览器截图：整屏舞台、纸带、输入框都正常 | 直接看 |
| `panel-probe-0.2.1.json` | 真浏览器点开右栏「教室」tab 的取样：tab 注册、面板区块数、立绘状态与**失败原文** | `jq '.d' panel-probe-0.2.1.json` |
| `panel-教室tab-0.2.1.png` | 右栏面板展开的截图 | 直接看 |

## 这份证据证明了什么（不多说一个字）

- **三插件在 0.2.1-rc.2 上装载零错误**（服务端 0 条激活告警 + 浏览器 0 条插件相关报错 + 0 个崩溃占位）。
- **舞台在 0.2.1 上是活的**：`#stage-warm-root` 存在并渲染出整屏教室、纸带、输入框。
- 截图里**角色（Live2D）没有画出来**：canvas 的 backing store 停在 PIXI 默认的 `300x150`，而 CSS 盒子是 `399x546`。这是本次迁移**顺带发现的既有缺陷**，不是 0.2.1 引入的——已转给舞台车道去定性并修复，**不要**把这张截图当作「立绘正常」的证据。

## 这次取样顺带查明的第二件事（比截图本身更重要）

**「立绘装载失败」的第一因是 0.2.1 的 API 变更，不是资产缺失：**

```
立绘装载失败：remote.workspaceFiles.readAll is not a function
```

0.2.1 的 `workspaceFiles` Remote 只注册了 `read` / `readBytes` / `list` / `stat` / `changes`（读自宿主
`@deepseek-ai/dsh-api-workspace-files/lib/typert.host.js`），**没有 `readAll`**。面板 `lib/client.js:1704`
调的是 `readAll`，于是立刻进 failed，**还没走到读文件那一步**。资产缺失（`clients/live2d-host/out/` 不存在）
是第二因。两者都记在 `docs/历史报告/实现报告_B_迁移0.2.1_2026-10-20.md` 的「0.1.5 有 / 0.2.1 没有」表里。

## 关于 3 条 `warnings is not defined`（**已更正，原先判断错了**）

我一开始判它们「与本插件无关」（因为 `ourConsoleIssues` 为空——那条判据只筛插件名，筛不到没带插件名的栈）。
舞台车道后来查实：**至少有一条是我们的**，在 `clients/classroom-stage-warm/lib/client.js` 的 Live2D 降级路径里，
`warnings.push(...)` 用的那个 `warnings` 在该作用域**不存在** → catch 自己抛 `ReferenceError`
→ `setL2dFailed(true)` 永不执行 → 既没有模型、也不回落静态立绘，只留一个空 canvas，`data-l2d` 还停在 `"on"`。
已作为 `fix(stage):` 独立提交修掉（改模块级 `warnings` + `pushWarning()`）。

**教训**：「按插件名筛 console」不足以证明「不是我们的错」。这张证据表里的 `ourConsoleIssues: []` 请只当
「没有带插件名的报错」，不要当「没有任何我们的报错」。

## 🔴 用 headless Chromium 验 Live2D 必须加这三个参数

默认 headless Chromium **没有 WebGL**：PIXI 6 建 renderer 时抛
`WebGL unsupported in this browser, use "pixi.js-legacy" for fallback canvas2d support`，
canvas 就停在浏览器默认的 `300x150`，`getContext('webgl')` 拿不到上下文——**看起来像「模型没加载」，其实是没 GPU**。

```bash
chromium.launch({ args: [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
] })
```

加上之后：`webgl = "WebGL 2.0 (OpenGL ES 3.0 Chromium)"`，canvas backing store 变成 `399x546`（与 CSS 盒子一致），
模型真的画出来。**本目录里两张截图都是在没有这三个参数的情况下拍的**，所以它们只能证明「舞台 UI 与纸带正常」，
不能作为「立绘正常」的证据（这一点在下面已经写明）。
