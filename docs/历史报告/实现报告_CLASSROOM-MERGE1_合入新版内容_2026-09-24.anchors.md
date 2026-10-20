# 锚点表 · 实现报告_CLASSROOM-MERGE1_合入新版内容_2026-09-24

> 旁挂文件（约定见 `code/tools/anchors/check-anchors.mjs` 文件头）：正文只写锚点〔Axx〕，行号与 sha256 集中在这里。
> 机核：`node 开源线/DSH定制/code/tools/anchors/check-anchors.mjs 开源线/DSH定制/实现报告_CLASSROOM-MERGE1_合入新版内容_2026-09-24.md --list`
> 路径基准：本文件所在目录（`开源线/DSH定制/`）。
> 版本哈希的语义：**这一条锚点引用的是这个版本**。教室内容再被改动（无论谁改）→ 哈希对不上 → 机核响亮报错，而不是静默失准。

## 版本表

| V | 文件 | sha256 前 16 位 |
|---|---|---|
| V1 | code/classrooms/cs-os/classroom.yaml | 65132c949012ecab |
| V2 | code/classrooms/cs-os/_anchor.md | 486df518fb08b3f8 |
| V3 | code/classrooms/cs-os/system_core.md | f818e8375fe4b557 |
| V4 | code/classrooms/cs-os/AGENTS.md | 7952e1b45858b4e0 |
| V5 | code/classrooms/cs-os/runtime/progress.md | 732069c44a623d9e |
| V6 | code/classrooms/cs-os/materials/ch01.md | 813b45ce55014a6b |
| V7 | code/classrooms/cs-os/story/ch01.md | 4f95668e136440ef |

## 锚点表

| 锚点 | 说明 | 版本 | 行 | 片段 |
|---|---|---|---|---|
| A01 | 我们的加法：教室声明要放教学动画（引擎只在段在场时注册动画工具与纪律段） | V1 | 74 | `animation:⏎  enabled: true` |
| A02 | 我们的加法：备课清单 `prep:` 段（5 条，课前零模型调用渲好） | V1 | 96 | `prep:` |
| A03 | 我们自己的注释：ctx-switch 的教材出处（他们重写 ch01 后小节改名，已同步改成新名） | V1 | 91 | `· ctx-switch       ← materials/ch01.md §2「切换时为什么要保存状态」` |
| A04 | 我们的加法（渠道纪律之一）：白板内容只能画出来，不许叙述代替 | V2 | 28 | `白板内容只能画出来，不许叙述代替` |
| A05 | 我们的加法（渠道纪律之二）：动画是与白板并列的另一条渠道 ＋ 四级优先级 | V2 | 29 | `动画渠道（与白板并列，不互相替代）` |
| A06 | 我们的加法：教学相位节（system_core 侧，含六相位表与宣布时机） | V3 | 76 | `## 教学相位（🔴 你负责推进` |
| A07 | 冲突点 C2：课中那条正文定义（我们的版本＝"角色动作、对白"，白板另走画图工具） | V3 | 69 | `角色动作、对白构成面向学生的正文` |
| A08 | 冲突点 C1：system_core 仍写"五个文件"，而 AGENTS.md 清单已是四个 | V3 | 72 | `「课后更新」列出的**五个文件、固定顺序**写` |
| A09 | 我们的加法：六层加载声明（原为五层，我们重编号） | V4 | 8 | `## 🔴 加载策略：按「位置 + 频率」的六层` |
| A10 | 冲突点 C1 的另一半：`session_log.md` 被移出"模型要写的文件清单" | V4 | 77 | `不在这份清单里——它由引擎自动维护` |
| A11 | 我们的加法：`current_lesson` 机器可读行（引擎按行读它裁决讲次门） | V5 | 3 | `current_lesson: 1` |
| A12 | 他们新版：`materials/ch01.md` 整篇重写后的标题（体例与 ch02–14 不同，见冲突点 C4） | V6 | 1 | `# 第 1 讲教学内容 · 一个程序怎么跑起来` |
| A13 | 他们新版：`story/ch01.md` 改成"故事方向"体（体例与 ch02–14 不同，见冲突点 C3） | V7 | 1 | `# 第 1 讲故事方向 · 第一次共事` |

## 行号散写豁免

| 文件 | 行 | 理由 |
|---|---|---|
| （无） | — | 本报告正文经 `--scan` 实测散写行号 0 处，无需豁免 |
