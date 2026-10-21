# tools/probes/ —— 宿主探针

> 用来**问宿主问题**的小插件：某条注入到底走了哪条通道、turn／step 的真实语义、某个座位的槽位在不在。
> 它们不是产品的一部分，也不该装着上课；只在需要复现一份宿主行为的取证时临时装进隔离 profile。

| 目录 | 回答什么问题 | 产出落在哪 |
|---|---|---|
| `socratic-test/` | ① `AGENTS.md` 是不是被双重注入（`agent-instructions` 通道）？② `agent/pre-step` 的 turn／step 语义；③ 会话事件流的来源分类 | `docs/历史报告/实测报告_双重注入与回合语义_2026-09-23.md`、`docs/历史报告/取证_S3_headless多turn与注入去重_2026-09-23.md` |
| `toolshape-live/` | **插件本地 `defineTool` 的产物宿主真的认吗**：在真 profile 里走宿主自己的执行管线（`ctx.tools.execute()`）真调一次工具 —— 成功＋`output.render` 被调用＋非法参数被拦；顺带验面板的 `classroomNarrative` 服务绑定与 typert 清单注册 | `/tmp/socratic-toolshape-live.log`（JSON Lines）；结论进 `docs/历史报告/实现报告_B2_去宿主包依赖_2026-10-21.md` §1、§4 |
| `toolshape-drift/` | **不装插件**的离线比对：拿一份真的 `@deepseek-ai/dsh-tools` 与本仓库的 `lib/toolshape.mjs` 同时编译同一批工具声明，逐字段/逐文案比 | 终端输出（非零退出＝漂移）；用法见 `check.mjs` 文件头 |

**用法**：把目录挂进一个**隔离 profile**（不要用真 web／desktop profile），日志追加到 `/tmp/socratic-probe.log`（JSON Lines），不动宿主状态。
探针本身不注册任何产品工具，卸载即无痕。
