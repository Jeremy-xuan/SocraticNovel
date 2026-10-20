# 实现报告 · M2-SCHEMA（manifest schema v0.2）

> **任务**：给教室 manifest 补两个已拍板的表达力缺口，并让真实教室 cs-os 用上它们。
> **靶子**：`施工状态与遗留问题_2026-09-23夜.md` §3 的 **P0-4**（块级讲次门）与 **P1-1**（段级切片）。
> **代码目录（本次唯一可写处）**：`开源线/DSH定制/code/`。
> **日期**：2026-09-24 ｜ **状态**：两个特性均已实现并落成到 cs-os；全量单测 **164/164 全绿**。
> **未做的事（按任务书铁律）**：未碰 `~/SocraticNovel-wt/`、`~/SocraticNovel-GitHub仓库/`、任何 DSH profile；
> 未新增第三方依赖（仍只有 `yaml`）；未把任何 `@deepseek-ai/*` 装进 `node_modules`；未 git commit／push；未调用任何询问类工具。

---

## §0 一句话结论

| 特性 | 实现状态 | 关键实测 |
|---|---|---|
| **A · 块级讲次门**（P0-4） | ✅ 完成（引擎 ＋ cs-os 落成 ＋ 26 项单测） | cs-os 第 1 回合 chat 注入 **20 块/56,205 B → 8 块/26,918 B**（−60% 块数／−52% 字节），**14 讲剧情只剩第 1 讲** |
| **B · 段级切片**（P1-1） | ✅ 完成（引擎 ＋ cs-os 四拆 ＋ 17 项单测） | `_anchor.md` 3405 B 整份每回合 → 切四段，**纪律层（chat 侧两段）2,119 B／每段均 ≤1,100 B** |

🔴 **一处必须上报的设计修正（已留痕）**：任务书给的 `lesson: { current: true }` **按字面实现不能生效**
（对每个 `story.node.NN` 都成立 → 14 块全注入，P0-4 症状原样复发）。
已按任务书自己给的例子（`story.node.03` ← 第 3 讲）把「本块所属讲次」显式化为 **`of: N`**。
详见 §3.1 —— 这是本次最需要主代理复核的一处。

---

## §1 逐条改动清单

### 1.1 `lib/manifest.mjs`（解析＋校验＋切片，改动最集中）

| # | 位置 | 改动 | 为什么 |
|---|---|---|---|
| 1 | 文件头注释 | 新增「M2-SCHEMA v0.2 新增」两段，写死 `current_lesson` 语义（＝**本轮要讲的讲次**）与 `of` 语义 | 语义歧义是本次两个 bug 的共同土壤；写进代码文件头，改代码的人先看到 |
| 2 | import | `node:path` 增加 `isAbsolute` | 支持 `runtime_store.progress` 写绝对路径 |
| 3 | 新增常量 | `DEFAULT_LESSON_KEY = 'current_lesson'`（导出） | 键名缺省值单点定义，报错信息与实现共用 |
| 4 | 新增 `assertLessonNo(v, where)` | 私有；校验 `>=1` 整数 | 讲次 `0`／小数／字符串一律报错（第 0 讲＝未开始，不是合法讲次） |
| 5 | 新增 `normalizeLessonGate(raw, at, id)` | 导出；解析 `{current,of}`／`{list}`／`{range}`，**恰好一个键**，未知键报错 | 解析期即拒非法形态；报错带 `blocks[i](id)` |
| 6 | 新增 `lessonGateAllows(gate, lessonNo)` | 导出；纯判定 | 与解析解耦，便于纯函数单测 |
| 7 | 新增 `usesLessonGate(manifest)` / `lessonGatedBlocks(manifest)` | 导出 | 「是否要求 runtime_store」的判据；**没用到讲次门的教室完全不受影响** |
| 8 | 新增 `validateRuntimeStore(manifest)` | 导出；**只校验声明不读盘** | 见 §3.2：把「声明校验」与「读值」拆开，`parseManifest` 才能不依赖 baseDir |
| 9 | 新增 `resolveRuntimeLessonSource(manifest, {baseDir})` | 导出；解析 progress 绝对路径 ＋ 键名 | 相对路径按教室包根解析，绝对路径原样 |
| 10 | 新增 `readRuntimeLesson(manifest, {baseDir})` | 导出；**读值** | 引擎装载时＋每回合调用；找不到行／非整数／`<1`／文件不存在 → 全报错并带路径与键名 |
| 11 | 新增 `parseLessonLine(text, key)` | 私有 | 行解析容错：前后空白、行内 `# 注释`、YAML 列表前缀 `- `；**值非空但非整数时返回原串**（交给上层报错，不当"没找到"） |
| 12 | 新增 `sliceSection(text, section, {file})` | 导出；段级切片 | 取标题正文到**下一个同级或更高级标题**为止；标题不存在→报错并**列出该文件全部实际标题**；重名→报错；空段→报错；`##` 前缀容错 |
| 13 | `normalizeBlock` 内容段 | `path` ＋ `section` → 切片；`text` ＋ `section` → 报错；`path`＋`text` 同写 → 报错 | 切片只对文件有意义；顺带堵住一个静默歧义（原先 `text` 静默胜出） |
| 14 | `normalizeBlock` 新增 `lesson` | `raw.lesson` 存在才解析，否则 `null` | **兼容性关键**：无门＝照旧注入 |
| 15 | `normalizeBlock` 返回值 | 增加 `lesson` 字段 | 传给 injector |
| 16 | `parseManifest` 返回 | 返回值增加 `runtime_store`（原样透传） | 引擎与 `readRuntimeLesson` 需要 |
| 17 | `parseManifest` 校验段 | 若 `usesLessonGate` → `validateRuntimeStore` | 用了讲次门却没声明 → **解析期就炸**（不静默） |

### 1.2 `lib/injector.mjs`（注入裁决）

| # | 位置 | 改动 | 为什么 |
|---|---|---|---|
| 1 | import | 引入 `lessonGateAllows` | — |
| 2 | 文件头注释 | 记 M2-SCHEMA v0.2 新增讲次门 | — |
| 3 | `planTurnInjections` 形参 JSDoc | `state` 增加 `currentLesson?:number` | 值由引擎从 runtime_store 读出后传入 |
| 4 | `planTurnInjections` 循环体**开头** | 讲次门判定：`state.currentLesson` 非整数 → **抛错**；不匹配 → `continue` | 🔴 不匹配不得静默；判定放在频率裁决**之前**，保证「不命中」不污染 `injectedOnce` |

> 为什么把门放在频率裁决之前：`frequency: once` 的块若先过频率再被讲次门拦下，
> `injectedOnce` 会**已经记上**（旧代码在 `due.push` 后无条件 `add`）→ 该块本轮没注入却永久失活。
> 放前面则「不命中＝根本没轮到它」，语义干净。已有单测钉住这条（`讲次门不命中 = 不注入，且不污染 injectedOnce`）。

### 1.3 `index.mjs`（宿主面接线）

| # | 位置 | 改动 | 为什么 |
|---|---|---|---|
| 1 | import | 增加 `readRuntimeLesson`、`usesLessonGate` | — |
| 2 | `apply` 内新增 `let currentLesson = null` | 讲次状态（模块级闭包） | 装载时读一次，每回合重读 |
| 3 | `loadInto(dir)` | 装载后若 `usesLessonGate` → `readRuntimeLesson(...)`；日志带上「本轮要讲的讲次」 | **早失败**：教室一装载就暴露 progress 缺失/非法 |
| 4 | `agent/pre-step` 钩子 | 每回合重读 `readRuntimeLesson`，把 `currentLesson` 并入 state 传给 `planTurnInjections`；失败先 `log` 再 `throw` | 课后更新改了 `current_lesson` 立刻跟上；报错不静默但也不"无声打断" |
| 5 | `classroom_status` 工具 | output schema 增加 `lesson: {type:'integer', required:true}`；render 文案带上讲次；未启用讲次门的教室回 `0` | 让模型/人能问出"本轮要讲第几讲"；`0` 表示"无讲次概念"，与 required integer 对齐 |

> **state 传法**：`{ ...phase, currentLesson }` —— `phase` 是 getter 对象，展开后 `turnCount`/`phase`/`injectedOnce`
> 均正确取值（已实测：`Object.keys` 含 `injectedOnce`，且 `instanceof Set` 成立）。未改 `lib/phasestore.mjs`（无需改动）。

### 1.4 `test/lesson.test.mjs`（新增，26 项）

覆盖任务书要求的四情形 ＋ `of` 语义专项 ＋ 兼容性：
① 命中（`current+of` 相等 → 注入）；② 不命中（`of:3` 在第 1/2/4 讲不注入）；
③ 缺声明报错（无 `runtime_store`／progress 无该行／文件不存在）；④ 值非法报错（中文数字、`0`、负数、`list` 空数组/非整数、`range` 形态/起>止/非整数、三键同写、`of` 非法、`of` 与 list/range 混用、未知键）；
⑤ `of` 语义专项（**14 块互不串台**：第 N 讲只放行 `of:N` 那一个）；⑥ 引擎侧缺值抛错；⑦ 行解析容错 6 例；⑧ 自定义 `lesson_key`；⑨ 兼容性（既有 fixture `lesson:null`、无 `runtime_store` 不报错、注入清单逐字不变）。

### 1.5 `test/section.test.mjs`（新增，17 项）

① 正常切片；② **三级标题不断段**；③ `##` 前缀/前后空白容错；④ 最后一段到文件末；⑤ 精确匹配（前缀写法必须报错）；
⑥ 标题不存在 → 报错并列出全部实际标题（含层级前缀）；⑦ 无标题文件；⑧ 重名标题；⑨ 空段；⑩ 空 `section`；
⑪ `#` 一级标题也能切；⑫ manifest 集成：`_anchor.md` 切四块、互不重叠、合计小于全文、都不带文件头说明段；
⑬ 无 `section` 的块仍整文件读入（兼容对照）；⑭ `section` 只对 `path` 有效；⑮ `section` 非字符串报错；⑯ `path`+`text` 同写报错；⑰ 既有 fixture 解析结果不变。

### 1.6 新增 fixture

| 路径 | 用途 |
|---|---|
| `test/fixtures/section-anchor/_anchor.md` | 段切片专用（含三级标题、文件头说明段、四段）——**为测试另写，不是 cs-os 真实文件** |
| `test/fixtures/section-anchor/classroom.yaml` | 五块：四块各切一段（含 `##` 前缀写法与不带前缀写法各一）＋一块无 `section` 作对照 |

### 1.7 教室侧 `code/classrooms/cs-os/`

| 文件 | 改动 |
|---|---|
| `classroom.yaml` | ① 文件头口径③改写（切片/讲次门已支持，`{NN}` 仍未支持）；② 声明 `runtime_store.lesson_key: current_lesson` 并写明语义；③ 相位枚举注释更新（P0-1 已修，注明相位推进未实现）；④ **`anchor.rules` 一块 → 四块**（`anchor.rules`／`anchor.lesson_ban`／`anchor.voice`／`anchor.check`，各带 `section`）；⑤ `story.arc_gate` 加 `lesson: { list: [1] }`；⑥ `curriculum.map` 加 `lesson: { current: true }`（无 `of`）；⑦ `story.node.01–14` 各加 `lesson: { current: true, of: NN }`；⑧ `material.current.01` 加 `lesson: { current: true, of: 1 }`。块数 31 → 34 |
| `runtime/progress.md` | 顶部加机器可读行 **`current_lesson: 1`** ＋ HTML 注释说明语义与"课后更新改成下一讲"；原有中文表格**一字未动** |
| `AGENTS.md` | ① 五层表 ② 纪律层行补注三段各自加载方式；② 课后更新第 1 条补「同时改 `current_lesson`」并写明忘改的后果 |

**未加讲次门的块（逐个判断，不是一刀切）**：`persona.komari`／`teach.system_core`／`world.setting`／`world.metaphor`（系统段常驻）、`anchor.rules`／`anchor.lesson_ban`／`anchor.voice`／`anchor.check`（纪律层跨讲常驻）、`kp.current`（相位门 `check,close`，讲次由相位承载）、`state.*`（状态层）。

---

## §2 before／after 实测数字

**口径**（与主代理 I2 基线同条件）：教室 `cs-os`、**相位＝默认值**（`open`）、**第 1 回合**、`current_lesson: 1`。
**跑法**：`tmp/m2_measure.mjs`（离线逐块清单，仿 `tmp/i1_phase_check.mjs`；**未改** `test/integration/multiturn.mjs`）。

### 2.1 ① `target: chat` 的每回合注入量

| | before | after | 变化 |
|---|---|---|---|
| 注入块数 | **20** | **8** | −12 块（−60%） |
| 注入文本字节 | **56,205 B**（54.9 KB） | **26,918 B**（26.3 KB） | **−29,287 B（−52.1%）** |
| 涉及源文件数 | 20 | **7** | −13 |
| 源文件字节合计 | 55,485 B | 26,628 B | −28,857 B |
| 第 2 回合 | 19 块 / 52,665 B | **7 块 / 23,378 B** | −12 块 |

### 2.2 ② 加上 system 段的开场总量

| | before | after | 变化 |
|---|---|---|---|
| `target: system` 段 | 4 块 / **27,965 B** | 5 块 / **28,489 B** | +1 块 / +524 B（`anchor.voice` 提为常驻） |
| **开场总注入** | **84,170 B（82.2 KB）** | **55,407 B（54.1 KB）** | **−28,763 B（−34.2%）** |

> system 段 +524 B 是**有意的**：草案 §4.5 冲突 1 要求把「角色声音速查」从纪律层提到常驻层
> （它整门课不变，却因写在 `_anchor.md` 里而每轮注入）。它换来的是 chat 侧每回合少 1,286 B。

### 2.3 ③ 每块落在哪个通道（after，第 1 回合）

| 块 id | 字节 | 通道 | depth | 源文件 | 讲次门 |
|---|---|---|---|---|---|
| `anchor.rules` | 1,056 | chat | 0 | `_anchor.md`（教学取向段） | — |
| `anchor.lesson_ban` | 1,137 | chat | 0 | `_anchor.md`（本课不许违反项段） | — |
| `story.arc_gate` | 3,540 | chat | 0 | `story/overview.md` | `list:[1]` |
| `curriculum.map` | 10,763 | chat | 4 | `curriculum.md` | `current:true` |
| `story.node.01` | 8,058 | chat | 2 | `story/ch01.md` | `current:true, of:1` |
| `state.progress` | 1,247 | chat | 0 | `runtime/progress.md` | — |
| `state.mistakes` | 423 | chat | 0 | `runtime/mistake_log.md` | — |
| `state.review` | 694 | chat | 0 | `runtime/review_queue.md` | — |
| `persona.komari` | 6,662 | **system** | order 10200 | `characters/komari.md` | — |
| `anchor.voice` | 524 | **system** | order 10250 | `_anchor.md`（角色声音速查段） | — |
| `teach.system_core` | 7,596 | **system** | order 10300 | `system_core.md` | — |
| `world.setting` | 4,067 | **system** | order 10400 | `world/setting.md` | — |
| `world.metaphor` | 9,640 | **system** | order 10500 | `world/metaphor.md` | — |

**被讲次门挡下的 13 块**（before 有、after 无）：`story.node.02`–`story.node.14`（合计 28,739 B）。
**这是 P0-4 的「剧透」与「体量」两条后果的直接消除**：第 1 讲不再看到 ch02–ch14 的剧情。

### 2.4 换讲验证（证明门真的跟着 `current_lesson` 走）

把 `progress.md` 的 `current_lesson` 改成 `2`，同一相位下第 1 回合：

| 讲次 | 注入块 | `story.arc_gate` | `story.node.01` | `story.node.02` |
|---|---|---|---|---|
| 1 | 8 块 / 26,918 B | ✅ 在 | ✅ 在 | ❌ 不在 |
| **2** | **7 块 / 17,364 B** | ❌ 不在（`list:[1]` 正确退出） | ❌ 不在 | ✅ **在** |

---

## §3 两处必须上报的实现判断（留痕，可推翻）

### 3.1 🔴 `{current: true}` 按字面实现**不生效** —— 已引入 `of`

**问题**：任务书的门形态是 `lesson: { current: true }`，语义「只在**本轮要讲的讲次**注入」。
但若 `current:true` 只判「存在 `current_lesson`」，则它对**每一个** `story.node.NN` 都成立
→ **14 块全部注入**，P0-4 的症状（剧透＋54 KB）原样复发。**我第一版就是这么实现的，实测立刻暴露**：

```
第一版实测（current:true 无 of）：第 1 回合仍注入 21 块 / 55,515 B，story.node.02–14 全在
```

**为什么必须显式**：`{current:true}` 只说了「当前讲次在讲」，**没说这块属于哪一讲**。
「属于哪一讲」的信息在任务书里只出现在块 id 里（`story.node.03`）—— 靠 id 或 path 反推
（正则抠 `.03`）是**隐式耦合**：id 改名、块 id 不含数字（`curriculum.map`）、`{NN}` 通配展开后
都会静默失效 —— 而 P0-4／P1-1 两条的共同教训恰恰就是「不匹配会静默不生效」。

**落成的语义（四形态，`of` 是唯一新增键）**：

```yaml
lesson: { current: true, of: 3 }   # 只在「本轮要讲的讲次 == 本块所属讲次 3」时注入 ← cs-os 用它
lesson: { current: true }          # 只要有讲次在讲就注入（跨讲常驻块，如 curriculum.map）
lesson: { list: [1, 2] }           # 指定讲次（story.arc_gate 用它）
lesson: { range: [1, 3] }          # 闭区间
```

`of` 的校验：必须是 `>=1` 整数；**只与 `current` 连用**（与 `list`/`range` 混用报错）；未知键报错。

**与任务书原文的差异**：任务书示例写的是 `lesson: { current: true }`（无 `of`）。
我保留了这个形态（语义＝"只要有讲次在讲"，cs-os 的 `curriculum.map` 用它），
**新增** `of` 作为"本块所属讲次"的显式位。→ **请主代理确认**：是否接受 `of`，
或改用别的表达（如 `{current: {of: 3}}`／块级 `lesson_no: 3`）。

### 3.2 `parseManifest` 只校验 `runtime_store` **声明**，不读盘

任务书说「块用了 `lesson` 门、但 `runtime_store`／`lesson_key` 没声明 → **报错**」，
这我放在 `parseManifest`（解析期）。但「**文件里找不到该行、或值不是整数 → 报错**」我**没有**放解析期，
而是放在 `readRuntimeLesson`（引擎装载时＋每回合调用）。

**理由**：`parseManifest` 是**不依赖磁盘 runtime 状态的纯函数**（既有 17 项单测全部不带 `baseDir`）。
若在解析期读 `progress.md`，则：① 纯函数被污染（无 `baseDir` 就炸，我第一版就这么写，被自己的测试打红）；
② 读到的值**装载后即过期**（课后更新改了讲次，解析期的校验结果就是错的）。
→ 拆成 `validateRuntimeStore`（声明，解析期）＋ `readRuntimeLesson`（读值，运行时）。
**用户可见效果不变**：两种失败都报错、都不静默；只是**报错时机**从"解析"挪到"装载/回合开始"。

### 3.3 `curriculum.map` 的 `{current: true}` 无 `of`

它**不隶属于某一讲**（14 讲共用同一张课程表），带 `of` 会让它只在某一讲注入 → 故不带。
⚠️ **由此暴露一个缺口**：相位恒为 `open` 时 `frequency.every=phase` **每回合都成立**，
所以它实际是**每回合**注入 10,763 B，不是设计意图的"每讲一次"。
真正的每讲一次需要 `frequency.anchor: lesson_start`（草案 §2.2，引擎未实现）→ 列入待确认。

---

## §4 段级切片：各段字节数

`_anchor.md` 全文 **3,405 B**。

| 块 id | section（原文标题） | 字节 | 通道 | 频率 |
|---|---|---|---|---|
| `anchor.rules` | 教学取向 | **1,019** | chat / depth 0 | `turn` |
| `anchor.lesson_ban` | 本课不许违反项（每讲更新） | **1,100** | chat / depth 0 | `turn` |
| `anchor.voice` | 角色声音速查（生成任何台词前看一眼） | **524** | **system**（order 10250） | `once` |
| `anchor.check` | 教学检查（需要校准时使用） | **260** | chat / depth 0 | `n_turns, n: 5` |
| — | （文件头说明段，无人切） | 502（含标题行/空行） | — | — |
| | **四段合计** | **2,903** | | |

> 数字来源：`tmp/m2_measure.mjs` 的「_anchor.md 切片结果」段（`sliceSection` 实测，非估算）。
> 注入文本比源文件段落略大（如 `anchor.rules` 段 1,019 B → 注入 1,056 B），差值是 `wrap` 的
> `<system-reminder>` 包装与首尾换行（+37 B）。

**纪律层是否回到 ≈1KB 内**：
- **每段（源文件段落字节）**：`anchor.rules` 1,019 B、`anchor.lesson_ban` 1,100 B、`anchor.voice` 524 B、`anchor.check` 260 B
  → **三段在 1KB 内，`anchor.lesson_ban` 1,100 B 略超 10%**（内容侧原文长度所致，未改原文一字）。
- **每段（实际注入文本，含 `wrap`）**：1,056 / 1,137 / 524 / 260 B。
- **chat 侧合计（每回合实际注入）**：`anchor.rules` + `anchor.lesson_ban` = **2,119 B（源文件段落）／2,193 B（注入文本）**
  → 对比 before 每回合 3,405 B（注入 3,441 B），**降 1,286 B（−37.8%）**；且 `anchor.voice` 已移出 chat 通道。
- ⚠️ **「≤1KB」的判定口径需要主代理定**：若指「单块 ≤1KB」→ 只有 `lesson_ban` 略超（可再切或删字）；
  若指「纪律层合计 ≤1KB」→ 现状 2,119 B 仍超（但 **2,119 < 3,405**，方向正确且每段可独立调整频率）。
  本轮**未改 `_anchor.md` 原文一字**（任务书要求「文件本身不拆」，切片的意义正在于此）。

---

## §5 全量单测结果

自检命令（任务书原样）：

```bash
cd 开源线/DSH定制/code/plugins/socratic-engine
for f in test/*.test.mjs; do /opt/homebrew/bin/node "$f" 2>&1 | grep -E "^(ℹ (tests|pass|fail))" ; done
```

| 测试文件 | tests | pass | fail | 说明 |
|---|---|---|---|---|
| `test/dedup.test.mjs` | 25 | 25 | 0 | 基线 25，未改 |
| `test/discovery.test.mjs` | 42 | 42 | 0 | 基线 31；**并行子代理正在改此模块**（见 §5.2），本轮内由 31→42 且全绿 |
| `test/injector.test.mjs` | 11 | 11 | 0 | 基线 11，未改 |
| `test/lesson.test.mjs` | **26** | **26** | 0 | 🆕 本任务新增 |
| `test/manifest.test.mjs` | 17 | 17 | 0 | 基线 17，未改 |
| `test/postclass.test.mjs` | 26 | 26 | 0 | 基线 26，未改 |
| `test/section.test.mjs` | **17** | **17** | 0 | 🆕 本任务新增 |
| **合计** | **164** | **164** | **0** | **≥110 ＋ 新增 43，全绿** |

### 5.1 既有断言是否被改：**没有改任何既有断言**

`manifest.test.mjs`（17）、`injector.test.mjs`（11）、`postclass.test.mjs`（26）、`dedup.test.mjs`（25）**一字未改**，全绿。
`discovery.test.mjs` 我**没有改**（它的 31→42 是并行子代理自己补的测试，见 §5.2）。

**判定过程（任务书要求写明）**：改动过程中我确实遇到过既有测试变红，逐条判定如下——

| 现象 | 判定 | 处置 |
|---|---|---|
| `discovery.test.mjs` 19 项红（`/private/var` vs `/var` 路径不等） | **既不是"断言在测旧行为"也不是"实现真错了"**，而是**并行子代理正在改 `lib/discovery.mjs`**（realpath 规范化）而测试还没跟上 | 不动它，改为报告（见 §5.2）；稍后该子代理自己补齐，现 42/42 绿 |
| 我第一版 `parseManifest` 要求 `baseDir` 才能解析含讲次门的 manifest → 我自己的 4 项新测试红 | **实现真错了**：把"声明校验"与"读值"混在一起，污染了纯函数 | 重构为 `validateRuntimeStore` ＋ `readRuntimeLesson`（见 §3.2），未改任何断言 |

### 5.2 ⚠️ 并行写入冲突（需主代理知悉）

本次会话期间**另一个子代理正在同一目录改 `lib/discovery.mjs`**（修 realpath 规范化，`FIX-1` 系列）：

- 我开工时的基线快照（09:29 前）：`discovery.test.mjs` **31/31 全绿**。
- 09:30:04 `lib/discovery.mjs` 被改（mtime 实测），`test/discovery.test.mjs` **19 项红**（临时目录 `/var` vs `/private/var`）。
- 我收工时：`discovery.test.mjs` 已扩到 **42 项且全绿**（该子代理已补上测试）。
- **我全程未改 `lib/discovery.mjs` 与 `test/discovery.test.mjs`**，两者与我这次的两个特性无交集。
- 另：`classrooms/cs-os/classroom.yaml` 的字节数变化（21,560 → 27,082 B）大于我逐条 edit 的估算增量；
  我不能排除期间有其它进程写过该文件。**我的 8 处编辑逐条在盘上复核通过**（§1.7 全部可见、34 块解析成功、164 项单测绿）。
  → 建议主代理回同步前**用本报告 §6 的哈希与块清单对一次账**。

### 5.3 🔴 profile 副本与集成测试的时序风险（重要）

`~/Library/Application Support/dsh-desktop/harness/profiles/socratic-headless/node_modules/socratic-engine/lib/manifest.mjs`
的 mtime 是 **09:34:06**，而我修改 `lib/manifest.mjs` 的时间是 **09:29–09:33**。

- **我没有执行任何写入 profile 的命令**（本次全部写操作都在 `开源线/DSH定制/code/` 下，见 §1）。
  该写入来自并行的集成测试子代理（它把插件同步/装进 `socratic-headless`）。
- ⚠️ **风险**：那一轮集成测试跑的可能是**我改到一半的 `manifest.mjs`**（讲次门解析已就位，
  而 cs-os 的 yaml 讲次门还没加全）→ 其注入块数会与本次报告的 after 数字对不上。
- → **若集成结论与本报告 §2 冲突，以本报告的离线实测为准**；建议让集成测试在我完工后重跑。
- ✅ `web` profile 全程零接触（其中根本没有 `socratic-engine`；今日唯一改动是应用自身写的 `desktop-storage.json`）。

---

## §6 文件哈希（便于主代理回同步）

### 6.1 教室侧

| 文件 | before | after |
|---|---|---|
| `code/classrooms/cs-os/classroom.yaml` | `3161021f48ecf300e95e19f470ff19c1f5240d7ad12a4746525ef92818c2ad80`（21,560 B） | `d81298ecfb9ee6fbcbd700e6043ec981eab3b36a2fb3371b3f04f9ed2a95fbe1`（27,082 B） |
| `code/classrooms/cs-os/runtime/progress.md` | `64929d69663f65cf47e2b867c12b1abb3c7001dcd23f1477a4a44683abc781f4`（653 B） | `4ad94cb6a8c664d5bc45ef32091f522aee4548772dd0810c568aefbc99adef36`（1,211 B） |
| `code/classrooms/cs-os/AGENTS.md` | （开工时未取；mtime 2026-09-23 20:12:56 / 7,866 B） | `71b2e5578bc580590b43fcc488a2913c05eaa1756064379b68d802df82cb284e`（8,784 B） |

### 6.2 代码侧（after）

```
8091b20571f9725a48a1577b413ae92b45545192e1ce4b6ca8fa8abb5b172295  lib/manifest.mjs
e957eb67649723249f9bd0d337c4d3d1c7ef6bb7c3a65a1f7b09830ade8da8b3  lib/injector.mjs
ed589510c68678ab159890875c4324e2a5afe3edb64038505f1270b0f8c8c1c7  index.mjs
4b668e37e992405ad9da45911e95bef8615ba6406dacde45bfd1b074ed034d04  test/lesson.test.mjs
d76a1d216d39b1bc9518a5bfe25131b353d34854b948261909b7cc6e01721c49  test/section.test.mjs
4ca63d5918a917037c341f58a4521e068d13872e614326f894901c2782102450  tmp/m2_measure.mjs
```

**未改动**：`lib/phasestore.mjs`、`lib/dedup.mjs`、`lib/discovery.mjs`、`lib/postclass.mjs`、
`test/manifest.test.mjs`、`test/injector.test.mjs`、`test/postclass.test.mjs`、`test/dedup.test.mjs`、
`test/discovery.test.mjs`、`test/integration/*`、`package.json`、`cordis.patch.yml`、`node_modules/`（仍只有 `yaml` ＋ `@standard-schema`）。

---

## §7 复现命令

```bash
cd /Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/plugins/socratic-engine

# 全量单测
for f in test/*.test.mjs; do printf "%-28s " "$f"; /opt/homebrew/bin/node "$f" 2>&1 | grep -E "^ℹ (tests|pass|fail)" | tr '\n' ' '; echo; done

# before/after 实测（逐块清单，含换讲验证与段字节数）
/opt/homebrew/bin/node tmp/m2_measure.mjs
```

---

## §8 待确认清单

> 按项目规矩：子代理不调用询问类工具，遇到需拍板的歧义按设计执行并标「推断／待确认」，逐条列此。
> **主代理合并时须逐条转呈用户；未确认前不得把我这里的推断当定论写进决策文件。**

| # | 问题 | 我的处置（推断） | 备选 | 影响面 |
|---|---|---|---|---|
| **C1** | 🔴 **`lesson.of` 是否接受？** 任务书给的是 `{current: true}`，但它按字面不能区分 14 讲（§3.1 有实测）。我新增了 `of: N` | 已实现 `of`（`{current:true, of:3}`）；cs-os 的 14 个 `story.node.NN` 与 `material.current.01` 都用它；无 `of` 的 `{current:true}` 保留为"只要有讲次在讲"（`curriculum.map` 用） | ① 改用 `{current: {of: 3}}`；② 块级独立字段 `lesson_no: 3`；③ 靠 id 正则反推（**不推荐**：隐式耦合，静默失效） | 格式权威文档（草案 §2.5 需回填）、所有教室的 yaml |
| **C2** | 🔴 **「纪律层 ≤1KB」的判定口径**：单块 ≤1KB 还是合计 ≤1KB？现状：单块 `anchor.lesson_ban` 1,137 B（超 8%）；chat 侧合计 2,119 B（超 111%，但比 before 3,405 B 降 37.8%） | 未改 `_anchor.md` 原文一字，只做切片（任务书要求「文件本身不拆」）；把三个数字都摆出来（§4） | ① 接受现状（每段可独立调频率已是最大收益）；② 再切 `lesson_ban`（它内含 6 条，可按条切）；③ 精简原文 | 纪律层体量纪律（R14）、`_anchor.md` 内容 |
| **C3** | **相位永不推进**（I2 已查出：`setPhase` 全库零调用、`advance_on` 未实现 → 相位恒为默认值 `open`） | **未改**（主代理明令"先别改"）。已在 `classroom.yaml` 相位段注释里标明这是已知待办 | 需用户拍板"谁来决定相位推进"（模型判断／规则／工具） | 所有 `frequency: phase` 的块（本教室 19 个）；`curriculum.map` 因此每回合注入而非每讲一次（§3.3） |
| **C4** | **`frequency.anchor: lesson_start` 未实现** → 「每讲一次」无法表达 | 未实现；`curriculum.map` 用 `{current:true}`（无 of）＋相位门近似，但实际是每回合注入 10,763 B | ① 实现 `anchor: lesson_start`；② 给 `frequency` 加 `once_per_lesson`；③ 暂不处理（10,763 B 可接受？） | `curriculum.md`（10,763 B／回合）、`story.arc_gate`、`state.learner` |
| **C5** | **`curriculum.map` 是否该带讲次门**：任务书未明确点名它，我按"块 id 语义＝本讲位置"加了 `{current:true}`（无 of，等价于不加讲次门的效果） | 加了（无实际过滤效果，只是声明意图） | ① 去掉（它现在等于没加）；② 等 C4 解决后改为 `lesson_start` | 无关紧要，但留着会误导后来者 |
| **C6** | **`anchor.voice` 的 `frequency: once` 在系统段＝"会话生命周期注册一次"**，不是草案的"每讲重读一次盘"（`frequency.anchor` 未实现） | 按草案 §4.1 落成 `target: system` ＋ `once`；注册后常驻 system prompt，效果上覆盖"生成任何台词前看一眼" | 若实测发现长对话里声音特征漂移 → 改为 `n_turns`（草案 §4.5 冲突 1 的可推翻点已预留） | 角色声音一致性；草案 §2.2 语义 |
| **C7** | **`kp.current` 是否也该带讲次门** | **没加**：它挂相位门 `check,close`，讲次由相位承载；且它是写回目标（课后更新写 `[x]`），按讲门控可能妨碍跨讲复习 | 若发现"对答案时把别讲知识点也判了" → 再加 | 知识点判定准确性 |
| **C8** | **`state.progress`（含 `current_lesson` 行本身）每回合注入 1,247 B**（before 689 B，+558 B 是我加的注释块） | 保留了说明注释（含语义与"课后更新改成下一讲"），因为它同时是**给人看的说明** | ① 把注释挪到文件末尾；② 精简注释 | 每回合 +558 B；但换来"语义不再有歧义" |
| **C9** | **并行写入风险**：`lib/discovery.mjs` 与 `classrooms/cs-os/classroom.yaml` 在本次会话期间有第三方写入迹象（§5.2） | 已逐条复核我的 8 处编辑在盘上完好；提供哈希与块清单供对账 | 主代理回同步前用 §6 哈希对一次账 | 回同步正确性 |
| **C9b** | 🔴 **`socratic-headless` profile 里的 `socratic-engine` 副本在我改动期间被同步过**：该 profile 的 `node_modules/socratic-engine/lib/manifest.mjs` mtime = **09:34:06**，而我改 `manifest.mjs` 的时间是 09:29–09:33 | 我**没有**执行任何写入 profile 的命令；该写入来自并行的集成测试子代理（它把插件装/同步进 `socratic-headless`） | ⚠️ **后果**：那一轮集成测试跑的可能是**我改到一半的 `manifest.mjs`**（讲次门已解析、cs-os 的 yaml 讲次门尚未加全）。**I2/集成结论若与本次报告冲突，以报告 §2 的离线实测为准**；建议主代理让集成测试在我完工后重跑一轮。`web` profile 全程零接触（无 `socratic-engine`） | 集成测试结论的有效性 |
| **C10** | **`test/integration/multiturn.mjs` 的 `expectedPerTurn` 硬编码 `phase:'boot'`**，对 cs-os 会假失败（I2 已报） | **未改**（主代理说另一路在修）；我的实测走离线逐块清单 | 待那一路修完 | 集成测试可用性 |
| **C11** | **`story.arc_gate` 的 `lesson: {list:[1]}` 是我按 AGENTS.md「第 1 讲之前先读一次」逐字落的** | 落了 `list:[1]`（只第 1 讲注入） | 若认为弧线约束应全程在场 → 改回无讲次门 | 人物弧提前用完的风险（AGENTS.md 明写"不读就会把弧线提前用完"） |
| **C12** | **`of` 的上界是否该校验**（如 `of: 99` 而教室只有 14 讲） | **没校验**（引擎不知道 `classroom.lessons` 与块的关系；跨字段校验超出本任务范围） | 可用 `classroom.lessons` 做上界校验并报错 | 手滑写错讲次时会静默永不注入 —— 属"不匹配静默"同类风险，建议后续补 |

---

## §9 自报计时

| 阶段 | 用时（约） |
|---|---|
| 读任务书与权威文档（施工状态 §3、草案 §2.0/2.1/2.2/2.5/4.1、对账表） | 15 min |
| 读代码现状（manifest/injector/index/phasestore ＋ 5 份既有测试 ＋ cs-os 四文件） | 20 min |
| 特性 A 引擎实现（manifest ＋ injector ＋ index） | 40 min |
| 特性 A 单测（26 项）＋ 修 `of` 表达力缺口 | 55 min |
| 特性 B 引擎实现（sliceSection） | 20 min |
| 特性 B 单测（17 项）＋ fixture | 25 min |
| cs-os 落成（yaml 四拆 ＋ 16 处讲次门 ＋ progress ＋ AGENTS） | 30 min |
| before/after 实测 ＋ 换讲验证 | 25 min |
| 本报告 | 35 min |
| **合计** | **约 4 小时 25 分** |
