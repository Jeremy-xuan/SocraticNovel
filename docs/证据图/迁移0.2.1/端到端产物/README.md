# 端到端实跑记录 · 引擎链路（2026-10-21 01:30）

> 目的：在**不花真模型钱**的前提下，把「学生说话 → 老师调工具 → 落盘」这条链路真跑一遍，
> 验证本轮合并后的引擎侧（A / W-e / C-e）是真的通了，而不是单测绿。
> 手法：本机 `Anthropic Messages` mock（`/tmp/lane-e-mock/server.mjs`，`MODE=draw`）+ 隔离 profile
> `classroom-dev`，工作区＝本仓库（所以教室就是 `classrooms/cs-os`）。

## 一 · 两次真回合实际写出来的东西

| 文件 | 事实 |
|---|---|
| `runtime/diagrams/L01-T01-20261021-013024-flowchart.mmd` | 第一次 `classroom_draw` 落的图（64 B，flowchart） |
| `runtime/diagrams/L01-T02-20261021-013130-flowchart.mmd` | 第二次 |
| `runtime/diagrams/index.md` | 多两行，且末列「会话」有值 |
| `runtime/emotions.jsonl` | 两条 `{label:"calm", intensity:0.5}` —— **K1 标记被剥掉、只留事件** |
| `runtime/session_log.md` | 两条回合记录，带 `<!-- socratic-engine:session=… turn=… -->` 标记、讲次、工具成败 |

原始副本在本目录（教室本身已还原干净，**不把实跑数据当内容提交**）。关键两点：

1. **`session_log.md` 真的写出来了。** 这一条在迁移前是**静默失效**的——`postclass.mjs` 动态 import
   `@deepseek-ai/dsh-atomic-write`，0.2.1 解析不到就只记日志、不抛错，于是课上一句话都没落下。
   本轮把该依赖坐实之后第一次看到它真的在写。
2. **`emotions.jsonl` 只有事件、没有标记原文。** 说明 `llm/stream` 里那层剥离真的生效了
   （模型输出里带了 `〔emo:calm:0.50〕`，落盘的 `session_log` 与原生文本里都没有它）。

## 二 · 舞台那一半：**没有接上**（这是本轮最该记的一条）

同一次真回合里，用 Playwright 观察舞台：

| 观察 | 结果 |
|---|---|
| `GET /stage-board/diagrams` | **✅** 返回 `{items:[{id,lesson,turn,kind,title,time,file,session}]}`，`root` 指向正确的教室目录 |
| `GET /stage-board/diagrams/<id>` | **✅** 返回 mermaid 源码原文 |
| `GET /stage-board/emotions?after=0` | **✅** 返回那条 `calm 0.5` 事件 |
| `data-screen` | ❌ 全程 `live`（28 秒内每 2 秒采样一次，一次都没切到 `board`） |
| 手动点「板书」按钮 | ⚠️ 切到了 `board`，但显示的是**预制静态场景「进程状态迁移」**（`boards: ["L03"]` 那张），**不是刚画的那张** |

### 诊断（可直接照此修）

舞台自己的快照里，消息节点的 `kind` 只有三种：`you` / `tool` / `teacher`，而且 `tool` 节点**不带 `name`**：

```js
window.__SOCRATIC_STAGE__.getSnapshot().messages
// → [ {kind:'you'}, {kind:'tool'}, {kind:'teacher'} ]
```

而契约 K2.3 的判据是宿主 Chat 节点的形状：

```js
node.kind === 'tool-result' && node.name === 'classroom_draw' && node.isError !== true
```

⇒ **这条判据永远不会在舞台自己的快照上命中**。舞台必须去读**宿主的 chat 节点**
（`useChat` 的 `snapshot.nodes`，形状见 `docs/计划与排产/契约_功能开发_2026-10-20.md` 附二），
而不是读它自己变换后的 `messages`。手动按钮那条路也要跟着改成「有当前图就渲染当前图，没有才回落到预制场景」。

## 三 · 这条记录证明了什么、没证明什么

**证明了**：引擎侧 A（课堂记录 / `session_log`）、W-e（`classroom_draw` 落盘 + 图 id + 索引会话列）、
C-e（K1 剥离 + 情绪通道）三条**端到端真的通**；宿主侧三条读图/读情绪路由也真的通。

**没证明**：舞台上「老师画完自动切屏并显示这一张」这一步——它卡在浏览器半边的判据取错了数据源，
与引擎、与路由都无关。
