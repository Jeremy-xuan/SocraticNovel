# 实现报告_ANIM-PREP-ENABLE_教室开备课_2026-09-24.md · 行锚表（机核）

> **为什么有这份文件**：本报告要引用**源码位置**（教室 YAML、纪律文件、引擎的 prep 实现）。
> 按本仓库规矩（ANCHOR-1），**正文只写锚点**（`〔A01〕`），行号与版本集中在本表，由机核工具逐行核对。
>
> **机核命令**（工作区根执行）：
> ```
> /opt/homebrew/bin/node 开源线/DSH定制/code/tools/anchors/check-anchors.mjs \
>   开源线/DSH定制/实现报告_ANIM-PREP-ENABLE_教室开备课_2026-09-24.md --list
> ```
> 退出码 0 ＝ 全部成立；非 0 ＝ 有 ERROR（悬空引用／孤儿锚点／版本漂移／行号漂移／片段不唯一／正文散写行号）。
>
> 🔴 **本表自己会漂**：它记的是"**取数那一刻**的哈希＋行号"。源文件一改，本表立刻过期——但机核会**当场报 ERROR**。
> **修法**：重新取行号，并把下面版本表的哈希改成现盘值。
>
> 🔴 **一个已知的漂移风险**：`V8`（`index.mjs`）**正被另一条工作线持续改动**（本批期间它在反复 `pnpm add` 本插件）。
> 若机核报 V8 版本不符，那是**如实反映**，不是工具故障——本批对该文件的引用是**只读核对**，没有改它一个字节。

---

## 版本表

| V | 文件 | sha256 前 16 位 |
|---|---|---|
| V1 | code/classrooms/cs-os/classroom.yaml | c30e2ab5a7bf1a7b |
| V2 | code/classrooms/cs-os/_anchor.md | bc4e89f3405a5e49 |
| V3 | code/classrooms/cs-os/system_core.md | 1eab54e0bb7ad486 |
| V4 | code/plugins/socratic-engine/lib/prep.mjs | 4e142ad8661dec08 |
| V5 | code/plugins/socratic-engine/lib/manifest.mjs | fce113df38f84eb5 |
| V6 | code/plugins/socratic-engine/lib/prepstore.mjs | 6b1fdb1b7e3f0370 |
| V7 | code/plugins/socratic-engine/lib/animtemplates.mjs | 9084af0e3dba9d2c |
| V8 | code/plugins/socratic-engine/index.mjs | e0b4ac6f270cba9a |

> 取数时刻：**2026-09-24 14:40（CST）**。
> V1–V3 是本批**改过**的三个文件（改动前哈希见报告 §6.1）；V4–V7 与上游 ANIM-PREP 报告记的值**逐字相同**（未被本批触碰）；
> V8 相对上游记的 `181a427de6614307` **已变**，变动来自另一条工作线。

---

## 锚点表

| 锚点 | 说明 | 版本 | 行 | 片段 |
|---|---|---|---|---|
| A01 | 教室顶层 `prep:` 段起始（备课清单，本批新增） | V1 | 96 | `prep:⏎  items:` |
| A02 | 教室 `animation.enabled`（`prep` 能被解析的前提） | V1 | 74 | `animation:⏎  enabled: true` |
| A03 | 第 1 讲条目 `ctx-switch`（timeline） | V1 | 99 | `    - id: ctx-switch` |
| A04 | 第 2 讲条目 `proc-lifecycle`（state_machine） | V1 | 119 | `    - id: proc-lifecycle` |
| A05 | 第 3 讲条目 `fifo-vs-sjf`（timeline） | V1 | 137 | `    - id: fifo-vs-sjf` |
| A06 | 第 3 讲条目 `avg-turnaround`（bar_compare，`required: false`） | V1 | 158 | `    - id: avg-turnaround` |
| A07 | 第 9 讲条目 `race-interleaving`（timeline） | V1 | 176 | `    - id: race-interleaving` |
| A08 | 纪律层新增的「渠道与优先级」那条（三条渠道 ＋ 四级） | V2 | 23 | `🔴 **渠道与优先级（三条渠道：白板图 / 模板 / 自己写；按这个顺序选，不要跳级）**：` |
| A09 | `system_core.md`「课中」的同一件事（压缩版，两处都写） | V3 | 67 | `渠道按「静止板书图 → ` |
| A10 | `lib/prep.mjs` 文件头：`prep:` 的声明格式即契约 | V4 | 18 | `//   prep:` |
| A11 | `prepCacheKey`：缓存键＝讲次＋教材哈希＋模板@版本＋规范化参数 | V4 | 81 | `export function prepCacheKey({ lesson, template, templateVersion, params, materialSha256 }) {` |
| A12 | `MAX_PREP_ATTEMPTS`：同键最多自动起 2 次（失败退路） | V4 | 47 | `export const MAX_PREP_ATTEMPTS = 2` |
| A13 | `lib/manifest.mjs`：声明了 `prep` 却没启用 `animation` → 报错（死配置） | V5 | 1199 | `声明了备课清单，但本教室没有启用教学动画` |
| A14 | `lib/prepstore.mjs` 的 `warmUpPrep`（本批跑的就是它） | V6 | 134 | `export async function warmUpPrep(env) {` |
| A15 | `prepPlan`：只读盘查缓存、不起任务 | V6 | 69 | `export async function prepPlan({ runtimeDir, baseDir, items, lesson }) {` |
| A16 | 分段标签 12 字符上限（真会话里拒绝过一次的那个判据） | V7 | 200 | `{ required: false, max: 12 }` |
| A17 | `index.mjs`：`prep-list` 注入的机器可读标记 | V8 | 684 | `form: 'prep-list', block:` |
| A18 | `index.mjs` 动画纪律第 2 条：优先级"取备好的 → 套模板 → 才自己写" | V8 | 494 | `2. **优先级：取备好的 → 套模板 → 才自己写。** 按这个顺序选工具，不要跳级：` |

---

> **行号散写**：本报告正文**没有散写行号**（唯一一处形如"（第 95 行）"的文字是**引擎自己输出的报错原文**，
> 它不以数字开头、机核也不判为散写）→ 故本表**不设「行号散写豁免」段**。
