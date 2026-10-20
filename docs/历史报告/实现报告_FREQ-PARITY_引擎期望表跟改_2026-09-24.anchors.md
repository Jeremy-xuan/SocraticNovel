# 旁挂锚点表 · 实现报告_FREQ-PARITY_引擎期望表跟改_2026-09-24.md

> 本文件是 `实现报告_FREQ-PARITY_引擎期望表跟改_2026-09-24.md` 的**行号真源**：正文只写锚点 `〔Axx〕`，
> 行号与片段集中在这里。每条锚点记**它引的是哪个版本**（sha256 前 16 位）——源码一改就**响亮报错**，
> 而不是静默失准。
> 🔴 **版本哈希是整文件粒度**：`test/phase.test.mjs`／`lib/expression.mjs`／`lib/expressionstore.mjs`／
> `test/expression.test.mjs` 都是本轮的改动件（哈希＝本轮交付的版本）；`classroom.yaml` 属**另一条线**（本轮只读），
> 它一变本表对应锚点会报红 —— 那时**重取行号**，不要删锚点凑绿。
> 机核：`node 开源线/DSH定制/code/tools/anchors/check-anchors.mjs 开源线/DSH定制/实现报告_FREQ-PARITY_引擎期望表跟改_2026-09-24.md --list`

## 版本表

| V | 文件 | sha256 前 16 位 |
|---|---|---|
| V1 | code/plugins/socratic-engine/test/phase.test.mjs | 54eab58be93ba6cc |
| V2 | code/plugins/socratic-engine/lib/expression.mjs | 2a20ded6bdf8dafc |
| V3 | code/plugins/socratic-engine/lib/expressionstore.mjs | b80cbd9c6dd9f03e |
| V4 | code/plugins/socratic-engine/test/expression.test.mjs | 97ee000fdbe157f2 |
| V5 | code/classrooms/cs-os/classroom.yaml | a6638e34d441acba |

## 锚点表

| 锚点 | 说明 | 版本 | 行 | 片段 |
|---|---|---|---|---|
| A01 | 文件头写下的 FREQ-PARITY 教训（"两处必须同改"要有人管） | V1 | 13 | `🔴 FREQ-PARITY（2026-09-24）补一条同族教训` |
| A02 | F3 的推导器：从教室声明推块集（独立实现） | V1 | 605 | `function deriveBlocksFromDeclarations(manifest, phase, at = {}) {` |
| A03 | 声明的规范化口径（签署表与报错信息共用） | V1 | 643 | `function canonicalDeclaration(block) {` |
| A04 | 引擎侧频率语义签署表本体 | V1 | 686 | `const SIGNED_FREQUENCY_GATES = {` |
| A05 | 本轮跟改的那一行：anchor.check 的签署值 | V1 | 694 | `'anchor.check': 'chat · phase(except=open)',` |
| A06 | F3：期望值从教室声明推导（不再写死块集） | V1 | 742 | `相位逐相位注入块集（期望值**从教室声明推导**` |
| A07 | F3b：教室语义 vs 签署表（两处不同步就报错） | V1 | 794 | `test('🔴 F3b cs-os：教室频率语义 vs 引擎侧签署表` |
| A08 | F3b 报错的第一句（"两处不同步"） | V1 | 817 | `🔴 教室的频率语义与引擎侧签署表**不一致（＝两处不同步）**` |
| A09 | 相位门（推导器侧的独立实现） | V1 | 582 | `function declaredPhaseAllows(gate, current) {` |
| A10 | 讲次门（推导器侧的独立实现；形状不认识就抛错） | V1 | 590 | `function declaredLessonAllows(gate, lesson) {` |
| A11 | expression_note 那句说明的单点定义 | V2 | 94 | `export const EXPRESSION_NOTE_REQUEST_VALUE = '本文件记录的是请求值（实际值由渲染侧夹取后生效）'` |
| A12 | 写入路径：原因与那句说明拼接后 push（始终出现） | V2 | 767 | `: ${reason === null ? EXPRESSION_NOTE_REQUEST_VALUE :` |
| A13 | 写入路径旁的注释（为什么这一行始终出现） | V2 | 764 | `// 🔴 FREQ-PARITY（2026-09-24）：这一行**始终**出现，且始终带那句` |
| A14 | 状态文件注释块里对该键的说明（改成"始终出现"） | V2 | 789 | `：**始终出现**，给人看的一行说明——` |
| A15 | 表达式状态仓文件头的第 ⑤ 条口径 | V3 | 29 | `「本文件记录的是请求值（实际值由渲染侧夹取后生效）」——引擎侧**不夹取**` |
| A16 | 单测：note 始终写明"记的是请求值" | V4 | 450 | `test('🔴 状态文件：expression_note **始终**写明「本文件记录的是请求值」` |
| A17 | 教室 anchor.check 的声明块（相位门 ＋ except open） | V5 | 334 | `  - id: anchor.check⏎    path: _anchor.md⏎    section: 教学检查（需要校准时使用）⏎    layer: anchor⏎    position: { target: chat, depth: 0 }⏎    frequency: { every: phase }⏎    phase: { except: [open] }` |
| A18 | 教室自己写的那句"两处必须同改" | V5 | 294 | `→ **动这里的频率语义＝两处必须同改**，否则验收仍按旧语义推期望块清单。` |

## 行号散写豁免

本轮**无豁免项**：正文没有散写行号（机核 `--list` 里 `散写行号 0 处`）。
