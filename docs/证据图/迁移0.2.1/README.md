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

## 这份证据证明了什么（不多说一个字）

- **三插件在 0.2.1-rc.2 上装载零错误**（服务端 0 条激活告警 + 浏览器 0 条插件相关报错 + 0 个崩溃占位）。
- **舞台在 0.2.1 上是活的**：`#stage-warm-root` 存在并渲染出整屏教室、纸带、输入框。
- 截图里**角色（Live2D）没有画出来**：canvas 的 backing store 停在 PIXI 默认的 `300x150`，而 CSS 盒子是 `399x546`。这是本次迁移**顺带发现的既有缺陷**，不是 0.2.1 引入的——已转给舞台车道去定性并修复，**不要**把这张截图当作「立绘正常」的证据。

## 已知无关噪声

浏览器里另有 3 条 `ReferenceError: warnings is not defined` 的 pageerror，**不来自本仓库的任何插件**（`ourConsoleIssues` 为空）。来源是 `web` 模板里的其它包，不在本次范围内。
