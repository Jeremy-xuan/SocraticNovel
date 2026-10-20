# 里程碑播报（周期制）

> 适用：`host.mjs` 的 `maybeMilestone(st)`。
> **本页的行号只出现在 §7.6 的机核锚点表里**；正文一律用锚点编号引用（形如 `〔A07〕`，区间写 `〔A04〕~〔A05〕`）。
> 为什么这样：早先正文散写行号，一次「在三个位置插了几行」的提交就让本页约 15 个行号同时失准
> （表是对的、正文没人核）。现在**表由 `node tools/check-anchors.mjs` 逐行核对**，表对了正文就对。
> 一句话语义：`narratorMilestoneMs` / `narratorMilestoneSteps` 是**周期**，不是「本回合只播一次」的阈值 ——
> 长回合里每满一个周期就再播一条，直到回合结束。
>
> **周期制有一个前提：回合真的会结束。** 漏收尾的会话会让周期永不停止 ——
> 现场、根因与两处修法见 §7（僵尸回合），**残余窗口也在那里如实写明**。

## 1. 配置

| 键 | 默认 | sanitize 范围 | 含义 |
| --- | --- | --- | --- |
| `narratorMilestoneMs` | 240000（〔A104〕） | 60000 ~ 1800000（〔A103〕） | 距上次里程碑满这么多毫秒 ⇒ 再播一条 |
| `narratorMilestoneSteps` | **50**（〔A102〕） | **3 ~ 200**（〔A101〕） | 距上次里程碑满这么多**步**（工具调用）⇒ 再播一条 |

两个键各自独立到点即可触发（或的关系）；没有「每回合最多 N 次」的上限。
`maybeMilestone` 体内两个键各自的**兜底字面量**（〔A10〕/〔A11〕）与出厂默认**同值**（既有约定；改一个必须改另一个）。

**两者都做进了插件设置面板**（`client.mjs` 的「进度播报」组；另有转义镜像 `client.js`，两份必须等价）：
「里程碑间隔」与**本轮新增的**「里程碑步数」——
控件行〔A107〕/〔A110〕，选项表〔A105〕/〔A108〕，兜底取值〔A106〕/〔A109〕。

- `narratorMilestoneSteps` 的**默认值 50** 与 **sanitize 上界 200** 是本轮改的（此前 10 / 50）；
  面板给的是 5 个**档位** `10 / 20 / 50（默认）/ 100 / 200`，它们**都落在** sanitize 的可用区间（3~200）**之内**
  —— 这**不是**「覆盖整个区间」：区间内的其它合法值（如 3、75）面板上没有对应档位，
  手改 JSON 写这些值照收（显示代价见下一条）。
- 代价如实写明：不在选项表里的合法值（例：手改 JSON 成 3 或 75）在面板上会**显示成兜底的 50**，
  直到用户在下拉里选一次才会被写回。这与既有的 `pickNarr` / `pickIdle` / `pickHum` / `pickNarrChars`
  是**同一取舍**（`Select` 只能显示选项表里的值），本轮不为它单独造机制。

## 2. 判定（per-session）

状态在 `st = stateFor(sid)` 上（状态工厂 `makeTurnState`，〔A01〕），用两个字段承载基准：

- `st.lastMilestoneAt`（〔A02〕）—— 上次里程碑（含**未被受理**的尝试）的时刻；
- `st.lastMilestoneStep`（〔A03〕）—— 上次里程碑时的 `stepCount`。

判定全在 `maybeMilestone`（函数头〔A06〕）体内：

```
overTime  = Date.now() - prevAt   >= narratorMilestoneMs        // ms 取值行〔A10〕
overSteps = st.stepCount - prevStep >= narratorMilestoneSteps   // steps 取值行〔A11〕
到点 ⇔ overTime || overSteps        // prevAt  缺省回落 st.turnStartAt；prevStep 缺省 0
```

到点即**同时**把两个基准推进到「此刻 / 当前步数」（〔A04〕~〔A05〕）⇒ 时间型与步数型共享同一个「上次里程碑」基准，
同一 tick 内再进来不会二次触发。

既有门（顺序与改动前一致）：`config.narratorOn !== true` / `st` 为空（这两道同在〔A111〕）/
`st.turnActive !== true`（〔A07〕）/ `st.blocking`（〔A08〕）/ `st.stepCount < 1`（〔A09〕）⇒ 直接返回。
多会话下 `st` 是 per-session 的，一个会话的里程碑不影响另一个。

## 3. 回合边界

| 时机 | 位置 | 基准 |
| --- | --- | --- |
| 新回合开始 | `resetTurn`（〔A12〕 / 写于〔A13〕） | `lastMilestoneAt = now`（= 回合起点）、`lastMilestoneStep = 0` |
| 回合正常收尾 | `handleTurnEnd`（〔A14〕 / 写于〔A15〕） | 两者清零 |
| 抹掉回合态（`multiSession` 回切、淘汰） | `clearTurnState`（〔A16〕 / 写于〔A17〕） | 两者清零 |
| 非正常收尾（blocked / error / aborted / interrupted / max-tokens） | `handleTurnEnd` 早退分支（词表〔A18〕 / 分支头〔A19〕 / 写于〔A20〕） | 不写 —— 与既有的 `milestoneSpoken` 同一处置；`turnActive = false` 已足以拦住，下个回合 `resetTurn` 会重设 |
| **子代理运行终结**（`subagent/end`，§7 新增） | `subagent/end` 处理器（〔A23〕 / 写于〔A24〕） | 不写 —— **照抄上面那条「不播报的收尾」**：只 `turnActive = false; turnEndedAt = now`（`now` 供 `NARR_ACTIVE_GRACE_MS`（〔A83〕）的 8s 活跃宽限窗用）。理由与「为什么不清也不会被读到」见 §7.3 |

⇒ 回合刚起不算「距上次已过」；新回合从自己的起点重新计时。

## 4. 交付确认（同 tick 被更高优先级吞掉的那次不永久丢失）

链路：

```
maybeMilestone → narrate()（〔A28〕）   入批前先过它自己的同意图 8s 预筛（〔A29〕~〔A30〕，命中则连批都不进）；
                                     通过则 narrPendingBatch.push（〔A31〕）+ queueMicrotask(flush)（〔A32〕）
               → flushNarrBatch()（〔A33〕） 按 sid 分组（〔A34〕），**只取最高优先级一条**（〔A35〕）
                                     BLOCK40 > FAIL30 > DONE/GOAL20 > SPECIAL15 > MILESTONE10 > START5
               → deliverNarration()（〔A36〕） 首个 await 之前的同步门（〔A37〕）+ 同意图 8s 合并占位登记（〔A38〕）
```

⇒ 同 tick 里该 sid 若还有更高优先级事件，这次里程碑**根本走不到** `deliverNarration`；
被同意图 8s 门挡掉时同理 —— **该门有两处**：`narrate()` 在**入批之前**的预筛（〔A29〕~〔A30〕），
与 `deliverNarration` 的占位门（〔A37〕~〔A38〕）；两处都让该槽不变，确认回调都会回滚。
这两种情况都会让「这条已经播过了」的账被记错。

观测点取 `st.lastSpokeByIntent.get('milestone')`（〔A39〕）：**非 force** 的 `narrate('milestone')` 全文件只有
`maybeMilestone`（〔A40〕）一处（`testNarrator`（〔A48〕）用 `force: true` 也能发 milestone，但 force 路径整段
跳过 `if (!force) { … }` 的门与占位登记（〔A37〕~〔A38〕）⇒ **不写**该槽），所以该槽只由里程碑的**正常交付**改写。
`narrate` 里 `narrPendingBatch.push`（〔A31〕）与 `queueMicrotask(flush)`（〔A32〕）都在 `return` 之前、
确认回调后入队（〔A41〕）⇒ 确认回调必然在 `flushNarrBatch`（〔A33〕）**之后**执行，届时同步门已判完。

- 槽变了 ⇒ 已受理，基准留在交付时刻；
- 槽没变 ⇒ **回滚**到本次尝试之前的基准（〔A43〕~〔A44〕）⇒ 下一次巡检（≤30 s）就重试，
  而不是等满一个周期，更不是永远不播；
- 回滚前先核对「基准还是本次推进的那个」（〔A42〕）：期间若回合已结束或已开新回合，就不回滚，
  否则「回合结束后基准清零」会出现例外。
- 三条回滚路径**各有守卫**（测试 §7b / §7d / §7e）：批次优先级吞掉、同 tick 回合边界、`narrate()` 的 8s 预筛。

残余窗口（已知、未修）：交付已过同步门、却在 LLM 返回后的重核（〔A45〕~〔A46〕的
`sameReplaced` / `familyReplaced` / `doneTookOver`）里被放弃时，基准已经留在交付时刻 ⇒ 这一周期不补播。
这三种放弃分别意味着「同意图已被更新的播报接管」或「回合已结束」，语义上本就不该补播。

## 5. 计数与相邻语义（本次未改）

- `recordProgress(sid, { milestoneBump: true })` 仍在**触发时**调用（不是受理时；**调用点**〔A113〕，
  真正累加的那一行是〔A50〕）⇒ `milestoneCount`
  是「**触发次数**」，**不是**「播出条数」。⚠️ 回滚会把 `narrate()` 的同意图 8s 合并窗变成 bump 放大器：
  步数型 steps=10、工具调用 **0.5 s/次跑 40 步**时，**bump 13 次而只播 2 条**（6.5×）；
  同节奏在「去掉回滚」的对照版上是 4 次/2 条；**1 s/次**的慢节奏两者都是 4/4。
  （数字由独立验证实测给出（被测版本 = rebase 前的 `a773dc3`，host.mjs blob `0f90856…`）；
  本次修复者用本仓库测试台 §7g 逐值复现：`13/2`、`4/2`、`4/4`，
  并打印 `at=[5000,13000]` / `[10000,20000,30000,40000]`。）
  最朴素的「触发→被吞→重试成功」是 +2 而播 1 条（改动前是 +1 播 0 条）。
  该字段**不参与任何判定、也不进 LLM prompt**（prompt 组装在 `narrateSummary`（〔A47〕），体内 0 处引用）；
  `client.js` / `client.mjs` / `panel.js` **零引用**（`git grep -c` 判两个字段均为 0 命中）。
  它的**落盘面不止一处**，写/读分别是：
  · 写（两条独立落盘路径，各自**整对象**写出）：`recordProgress`（〔A49〕）体内累加
    `memory.progress[sid].milestoneCount`（触发时 +1〔A50〕；分片初始化/纠偏〔A51〕），
    同一函数体内另写一份内存摘要 `narrGlobal.sessions[key].milestoneCount`（写入处〔A52〕）
    ⇒ 同函数末尾排两条落盘（〔A53〕）：
    `scheduleSaveMemory()`（〔A54〕）→ `saveMemoryNow`（〔A55〕）把 `memory` 整对象写进
    **`sakiko-memory.json`**（写入行〔A56〕；python 兜底〔A57〕）；
    `scheduleSaveNarrator()`（〔A60〕）→ `saveNarratorNow`（〔A61〕）写 **`narrator.json`**（写入行〔A62〕）；
    这份摘要是 `narrPersistSnapshot`（〔A58〕）原样带走的（带走行〔A59〕）—— 那个函数不是写入方，
    也不被 `recordProgress` 调用。
  · 读（两侧各有白名单）：`sakiko-memory.json` 经 `loadMemory`（〔A63〕，体内调用点〔A64〕）→
    `sanitizeProgressMap`（〔A67〕）→ `sanitizeProgressEntry`（〔A65〕）保留（保留行〔A66〕）；
    `narrator.json` 经 `loadNarrator`（〔A68〕，体内调用点〔A69〕）→
    `sanitizeNarratorSessions`（〔A70〕）保留（保留行〔A71〕）。唯一对外读取方是 `narratorStatus`（〔A72〕）。
  要让口径贴近「播出一条 +1」：把〔A113〕那行 `recordProgress(st.sid, { milestoneBump: true })`
  挪进确认回调的「已受理」分支即可（本次未改，改了要重跑红绿并重新验证）。
- `st.milestoneSpoken` 保留（`narratorStatus`（〔A72〕）的调试回显，回显行〔A73〕；`client.js` / `client.mjs` /
  `panel.js` **零引用**，不是「面板契约」—— 代码注释写的是「供 narratorStatus」，那个才准确），
  语义收窄为「本回合**触发**过里程碑（含**未被受理**的尝试）」—— 与 `lastMilestoneAt`（〔A02〕）**同款口径**，
  **不是**「播出过」：它在**触发点**置位（〔A05〕）；§4 的回滚路径（〔A42〕~〔A44〕）**只回退基准、不清它**；
  清零只发生在 `resetTurn`（〔A12〕/〔A112〕）/ `handleTurnEnd`（〔A14〕，清在〔A15〕）/ `clearTurnState`（〔A16〕，清在〔A17〕）。
  ⇒「`milestoneSpoken === true` 而本回合一条里程碑都没播出」是**可达状态**（触发后被同 tick 的更高优先级
  吞掉，或被 `narrate()` 的同意图 8s 预筛挡掉，见 §4），它本身**不再是闸门**。
  它**只活在内存、不落盘**：可读写它的**代码**位置恰好就是上面列的 6 个锚点
  —— 字段初值〔A74〕、抹态清零〔A17〕、回合复位清零〔A112〕、触发点置位〔A05〕、收尾清零〔A15〕、
  `narratorStatus` 回显〔A73〕；在 `narrPersistSnapshot`（〔A58〕）、`saveNarratorNow`（〔A61〕）、
  `scheduleSaveNarrator`（〔A60〕）、`saveMemoryNow`（〔A55〕）以及两侧 sanitize（〔A65〕/〔A67〕/〔A70〕）里
  **都不出现**，全文件所有 `writeTextSafe` 调用点也不含它 ⇒ `narrator.json` / `sakiko-memory.json` 里
  **都没有这个键**。（「恰好 6 个代码位置」由 `test/narr-milestone-config.test.mjs` §5 机核：把每行去掉行尾
  注释后统计 `milestoneSpoken` 的命中行号集合，必须与这 6 个锚点行号逐位相等。）
- 30 s 巡检 tick **本次改过**（搬进 `milestonePatrolTick`（〔A75〕）并加了一道活跃度过滤，见 §7.3）；
  `narrateSubagents` 过滤逻辑本身一字未改（〔A77〕）；`tool/call` 分支改为直接调用
  `maybeMilestone(st)`（〔A100〕；不再用「本回合一次性」标志预筛），时间型因此最迟 30 s 到点。
- 优先级系统、`pickNarrLine`、`narrateSummary` 的 prompt 均未改。

**边角行为变化（去掉 `tool/call` 预筛带来的，测试 §7f）**：静默长回合（回合已跑满一个周期、期间
**没有任何工具调用**）的**第一个**工具调用会让 `narrate('start')`(5) 与里程碑(10) 在**同一 tick** 入批，
`flushNarrBatch` 按 sid 只取最高优先级 ⇒ **里程碑赢、START 被吞**（`spoken=["milestone"]`）。
旧写法在这条路径上只播 START —— 旧预筛是那一行
`if (!st.milestoneSpoken && st.stepCount >= steps) maybeMilestone(st)`，
`st.stepCount >= steps` 在 `stepCount===1` 时不成立 ⇒ 那个 Milestone 压根不会入批。
⚠ **红绿对照的口径**：那一行已经在 `f3c4d30`（周期制）里删掉，基线 `3a33d08` 上**不存在**
（所以「未改动的 main 会播 START」这句现在不成立；想复现旧行为就把那一行加回 `tool/call` 分支）。
本分支这一侧的实测由 §7f 给出：它逐字执行生产里 `tool/call` 分支那一整段，`spoken=["milestone"]`。
用户仍能听到一条，且那种场景下 START（「开工了」）本就陈旧 —— 记为可接受的新行为，不是缺陷。

## 6. 怎么验

```powershell
node --test test/narr-milestone-periodic.test.mjs   # 周期制行为（§1~§7）+ §8 元自检
node --test test/narr-zombie-turn.test.mjs          # §7 的僵尸回合（本条修复）+ §9 元自检
node --test test/narr-milestone-config.test.mjs     # 本轮：配置面（默认/上界/面板两份等价）+ 本页锚点机核
node tools/check-anchors.mjs                        # 本页 §7.6 全表机核（末行「锚点共 N 条，坏 0 条」+ 退出码 0）
```

`test/narr-milestone-periodic.test.mjs` 把 `maybeMilestone` / `narrate` / `flushNarrBatch` / `deliverNarration` 的同步门
按函数名与行锚**原样切片**求值（沿用 `test/narrator-multisession.test.mjs` 的手法，不复制、不改写生产代码），
用受控时钟与步数驱动，断言落在「某个 sid 实际播了几条、在什么时刻播」这种可观测后果上；
§8 另做元自检：把「退回本回合一次性」「忽略间隔」「去掉回滚」三处变异注入内存切片，判据必须报红。

`test/narr-milestone-config.test.mjs`（本轮新增）钉**配置面**与**本页锚点**：真跑 `sanitizePatch` 判 3~200、
解析 `DEFAULT_CONFIG` 与 `maybeMilestone` 的兜底字面量判 50 且同值、把 `client.mjs` 与 `client.js`
去转义（`\uXXXX` + 引号风格 + 数字归一）后逐字比对三行控件代码、把 §1 的配置表与本页 §7.6 的表都机核；
§7 元自检把 11 处变异注入内存副本，判据必须报红（注不进去的记 `[SKIP]`、注入成功但判据没报红的记 `[FAIL]`）。
**未改动的 main 上它是 7 通过 / 8 失败 / 5 未注入(SKIP)**（本分支 20 通过 / 0 失败）—— 8 条失败全落在本轮改的
那几处（默认 10、上界 50、面板没有这一项、锚点里 9 条片段在 main 上不存在）；5 条 SKIP 是「本轮新增的
变异锚点在 main 上根本不存在」，两类都让退出码非 0。

`test/narr-zombie-turn.test.mjs` 用**同一套手法**钉住 §7：把 30 s 巡检的 `ctx.interval` **回调体 + 周期实参**
按行锚原样切出来（锚 = 「体内真的在跑里程碑判定」这个不变量，周期单独断言 = 30000）；
`subagent/end` 处理器与 `tool/call` 分支也整条原样切出来求值。
测试台**同时**准备两代候选访问器（`activeStates()` 与 `activeRecords()`），运行时只用生产里真正存在的那一代
—— 这是给「修法还没合进基线」的宿主留的兼容；本仓库基线上 `activeStates()` 已不存在，该分支永不生效。

**红绿口径（⚠ 已按实测改写）**：§7.3 的两处修法**已经合进基线**（`3a33d08`），
所以「未改动的 main」这一侧现在**不会**报红 —— 本页早先写的「未改动的 main 上 33 通过 / 14 失败」
是**修法合入基线之前**的口径（那串数字本身没错：本轮用「修复前宿主 + 当时那份 47 断言的测试文件」
复跑，得到的正是 **33 通过 / 14 失败**）。现在的红绿对照改成「**把两处修法回退掉**」：

- 回退 = 删掉〔A24〕的收尾两行、把〔A76〕的活跃度过滤改成 `if (false)`；
  `activeRecords` / `milestonePatrolTick` 的重构**不回退**。
- 回退形态 ⇒ **38 通过 / 14 失败 / 6 未注入(SKIP)**；带修法 ⇒ **58 通过 / 0 失败**。
- 那 14+6 条非绿**分三类，不能一概说成「行为红」**（本轮的元自检已经把后两类分开了：`[FAIL]` 与 `[SKIP]`）：
  · **13 条行为红** —— 僵尸照播 **17** 条而不是 15 条、`turnActive` 收不掉、被点名的会话收不掉、
    `(d4a)`/`(d4d)` 报红；
  · **1 条元自检红（`[FAIL]`）** —— 元自检 3：注入**成功**但被回退抵消（收尾两行已是 `void 0`，
    所以把取记录改成回落默认槽也不产生任何写入）；
  · **6 条元自检 SKIP** —— 元自检 1/2/4/5/6/7 的变异锚点在回退宿主里**已被删掉**，
    注入字符串找不到 ⇒ 日志明确标 `[SKIP] 变异注入失败…本守卫没有被真正验证`。
    它们**不是行为证据**，也不该被读成「判据不起作用」；两类都让退出码非 0（守卫不生效同样是缺陷）。

§9 另做元自检：把「去掉活跃度过滤」「去掉回合收尾」「收尾时回落默认槽」「收尾时顺手清 startSpoken」
「收尾波及**所有其它注册会话**」「收尾顺手收掉**默认槽**」（M-b1）「收尾收掉**非子代理注册会话**」（M-b2）
**七处**变异注入内存切片，判据必须报红。
（`(d4)` 的隔离性是复审后新增的守卫，**被害者按类覆盖三类**：另一个子代理会话 / 一个 `isSubagent:false`
的普通注册会话 / 默认槽的回合。回退形态下它只有 `(d4a)`/`(d4d)` 报红，`(d4b*)`/`(d4c)` 因为「压根没收尾」
而平凡通过。它覆盖的是「完全不收尾」与「收尾波及**某一类**会话」这两个方向；本轮之前只造了
「另一个子代理会话」这一类对照 —— 独立复审实测 M-b1/M-b2 两个变体当时能**全绿通过**，
所以默认槽与非子代理会话的对照是本轮补上的（元自检 6 / 7 分别钉这两类）。）

## 7. 僵尸回合：漏收尾的会话被按周期无限播报（本节 = 本次修复）

### 7.1 现象与现场证据

一个**早就结束**的子代理会话仍在被无限播报里程碑，间隔精确等于 `config.narratorMilestoneMs`。

现场（本机 `%USERPROFILE%\.dsh\sakiko\logs\timeline.jsonl` 与轮转档 `timeline.jsonl.1`；播报行形状 =
`ev:"push"` + `tags.narrate` / `tags.sid` / `tags.label`。**取证时刻 2026-09-20 14:58:41 本地**，下表数字全部
取自该次读盘；该 sid 当时仍在播，计数会随时间增长）：

| 事实 | 数值 | 备注 |
| --- | --- | --- |
| 目标 sid | `7f20277b-5d80-41b3-bcdc-fb21b7987d70` | label `你是游戏图形工…·7f20` |
| 该 sid 的播报种类 | `{"start":1,"milestone":344,"done":0}` | **一条 `done` 都没有** |
| milestone **条数**（`ev:"push"` 且 `tags.narrate:"milestone"`） | **344** | 分档：轮转档 `timeline.jsonl.1` **20** 条 + 主档 `timeline.jsonl` **324** 条。⚠ 同一句播报还会写一条 `ev:"synth_start"` 的**配对行**（`tags` 与 push 行相同）⇒ 若按「`tags` 命中」而不筛 `ev` 去数，会得到 **688 = 2 × 344**，那是把配对行当成了两次播报（早先版本那句「314/324 条」就是这么来的，已删） |
| 相邻间隔（343 个） | 正常间隔 min / 中位 / max = **82691 / 120015 / 159375 ms**；171 个 <120 s（最短 82691）、1 个是那一夜的大空档 | 见下面两条说明 |
| 首条 / 末条 | 2026-09-18 14:49:33 / 2026-09-20 14:58:37（本地） | 跨约 48 小时 |
| 唯一大空档 | 132214 s（9/18 21:34:08 → 9/20 10:17:42 本地） | **僵尸流跨过了它**：空档两侧紧邻两条 push 的 `push.id` 是 **1010 → 1012**（严格单调上行；`push.id` 是纯内存计数器 `nextId`，〔A94〕，进程重启会从头开始）⇒ 那一夜是**机器休眠**，不是重启。跳号（1007→1009、1010→1012）不矛盾：`nextId` 是**全部** push 行共用的计数器，中间被别的 push 用掉了 |
| 同期正常子代理对照 | `session-028338b7…` = `{"start":150,"milestone":43,"done":112}` | 三件齐全；同窗口 `done` 共 444 条、分属 97 个 sid |
| 现场配置（`~/.dsh/sakiko/config/sakiko.json`） | `narratorDone:true`、`narratorMilestoneMs:120000`、`narratorMilestoneSteps:50`、`narratorLLMSummary:true`、`multiSession:true` | 120000 是**用户配置值**，不是出厂默认（默认 240000，见 §1）。⚠ `narratorMilestoneSteps:50` 当时也是**用户手改的**值（那时出厂默认是 10）；本轮起 50 同时成了出厂默认（〔A102〕），但这个说法本来就没打算用它推论默认值 |
| 会话存储 header | `{"id":"7f20277b…","cwd":"G:\\QnMobile_Artist","parentSession":"1f34bad4…","origin":"subagent","delegationDepth":3}` | 确系子代理会话 |
| 会话存储事件 | 145 个 zstd 帧 / 255 条记录（逐帧解压 0 失败）：`turn/start` **2** 条、`turn/end` **1** 条 | 见下 |

> 上表数字取自**该次读盘**（取证时刻 2026-09-20 14:58:41 本地）；该 sid 当时仍在播，计数会随时间增长
> —— 本轮（2026-09-20 晚）重读同一对日志时主档已涨到 344 条 push 行（`.1` 档仍是 20 条），
> 「结构」不变（每句播报 = 1 条 push + 1 条 synth_start；`push.id` 全程严格单调），所以上表不改数、
> 只把口径写清楚。空档两侧的 `1010 → 1012` 是**本轮亲自重读日志复核过的**（见交付报告的原始输出）。

**为什么 <120 s 的间隔不是「步数型先到点」**：`narratorMilestoneSteps = 50`，而该会话
`tool/call` 总数 = turn 1 **22** 次 + turn 2 **16** 次 = 38 < 50 ⇒ 步数型**永远不会**到点。
真实成因是**交付延迟抖动**：`push` 行写在 `deliverNarration` 的 LLM 摘要（`narrateSummary`）与 TTS
之后（`deliverNarration` 先 `await narrateSummary`、再 `speakSynced` → `pushUtterances` → `tlLog push`），
所以记录到的时间 = **触发时刻 + 该次交付延迟**；触发间隔恒为 120 s，两条相邻记录的差 = 120 s + 两次延迟之差。
旁证：稍晚一次读盘（该 sid 已涨到 352 条）里 **350 条是 LLM 摘要**、只有 2 条回落 M1/M2 模板
（与 `narratorLLMSummary:true` 吻合）。

**`turn/end` 从未被处理：三条证据，第一条是日志正面引用**

1. **会话日志直接写明**（把 `session.v3.jsonl.zstd` 按 zstd 魔数切成 145 帧、逐帧解压，0 帧失败）：
   `seq=5 turn/start {turn:1}`、`seq=134 turn/end {turn:1, reason:{kind:"interrupted"}}`、
   `seq=137 turn/start {turn:2}` —— **turn 2 没有任何 `turn/end`**；日志最后一条是
   `seq=253 step/end {turn:2, step:11}`（最后一个 `llm/retry-started` 是 `seq=246 / turn2 step10`，
   在它之前 7 条）。⇒ 该回合从没收过收尾。
2. `maybeMilestone` 的第一道门就是 `st.turnActive !== true`（〔A07〕）—— 它每 120 s 都在播
   ⇒ 该会话的 `turnActive` **一直是 true**；而**加收尾两行之前** `turnActive = false` 的写入点只有三处
   （`handleTurnEnd` 的两条分支与 `clearTurnState`，即〔A21〕/〔A20〕/〔A22〕），都没跑过。
3. `done` 只在 `handleTurnEnd` 里发；本机 `narratorDone:true`、同窗口其它 sid 共 444 条 `done`
   ⇒ 这里的「0 条 `done`」**是**充分证据（只有原理上才不充分：若 `narratorDone` 为 false）。

> 更正记录：本页早先的版本写过「`turn/*` 事件根本不落盘」「那一夜 DSH 没在跑」——两条都是**错的**
> （前者是把多行 zstd 帧按整帧 `JSON.parse` 造成的解码遗漏，后者忽略了 `push.id` 的连续性），已按上面的
> 正面证据改写。留下这条记录是为了让后人知道这两个坑。

### 7.2 根因链

1. 回合态**只由 `session/event` 驱动**：`turn/start` → `resetTurn`、`turn/end` → `handleTurnEnd`。
2. `subagent/end` 是**另一条事件**：**加收尾两行之前**它的处理器只播一条 `special` 旁白
   （**一个字都没碰**那个子代理会话的回合态）⇒「子代理运行结束」与「该会话回合结束」在这套状态机里**没有接上**。
   （那两行就是本轮修法〔A24〕，现已进基线 `3a33d08`；处理器整体见〔A23〕。）
3. 30 s 巡检**在加活跃度过滤之前**用 `activeStates()` 拿到的是**纯回合态 `st`**（记录 `rec` 被丢掉），
   `maybeMilestone(st)` 因此拿不到 `rec.lastActiveAt`，无法判断「这个会话早就不输出了」。
   （现在的取数口是 `activeRecords()`：〔A87〕/〔A91〕。）
4. 代码里其实**已有**现成判据 `sessionCountsAsActive(rec, now)`（〔A92〕）：
   `turnActive === true && (now - rec.lastActiveAt) <= NARR_AUTO_IDLE_MS`（判据本体〔A93〕，
   `NARR_AUTO_IDLE_MS = 1800000`〔A81〕）——
   它已被 `sessionBlocksEviction` 与 `activeSessionCount` 使用，**唯独里程碑巡检没用它**。
5. **为什么现在才爆**：旧闸门 `st.milestoneSpoken` 是「本回合一次性」⇒ 僵尸回合最多多播 1 条就永久沉默，
   这个状态一直**已知但无害**；周期制代码所在的树（`f3c4d30`，2026-09-16 18:21；它把 `maybeMilestone` 从
「本回合一次性」改成周期制）把它变成「每满 ms 再播一条，直到回合结束」
（⚠ 归属口径：**改的是 `f3c4d30`** —— 只有它动了 `host.mjs`（+64 行）。其后的 `c87d8a8`（18:23）只改了
docs 与 test，**它树里的 `host.mjs` 与 `f3c4d30` 逐字相同**（两者 blob 都是 `0c1a8f5ba352…`，sha256 相等）；
更早的版本曾把周期制记在 `c87d8a8` 名下，与本页 §5 的「已经在 `f3c4d30`（周期制）里删掉」自相矛盾，已统一。）
   ⇒ **僵尸回合永不结束 ⇒ 无限播报**。344 条即由此而来。

### 7.3 两处修法

**改动 1（治根）：`subagent/end` 顺手收掉它那个会话的回合**（处理器〔A23〕，收尾两行本体〔A24〕）

- sid 来源 = `info.id`。**已核实它与注册表键同一空间**（`sessions` 的键只来自 `sidOf(session)` /
  `stateFor(sid)`，即 `session.id`）：
  · 上游：`dsh-subagent` 的 `observeRun` 发 `{ id: run.id }`、`createActivationObserver.settle` 发
    `{ id: childId }`；`dsh-subagent-in-process-driver` 里 `childId → ctx.agents.create({ sessionId: childId })`；
    `dsh-agent-loop` 把它交给 `ctx.sessions.prepare(sessionId)`，而 `dsh-session` 的 `SessionRegistry.prepare`
    写 `header = { id: sessionId, … }`，`Session.id` 的 getter 就返回 `header.id`。
  · 实测：该处理器**改动前**就已把 `info.id` 当 sid 用（`subagentEndPrefix(info.id)` → `labelForSid(id)`），
    而现场 211 条 `special` 播报里有 **148 条**的 `cn` 带 `〔<label>〕` 前缀 ——
    只有 `labelForSid(info.id)` 命中注册表才会出现该前缀 ⇒ 二者同空间（另有 63 条是 workflow/后台任务等无标签路径）。
- **不调用 `handleTurnEnd`**：它会 `narrate('done')`，与本处理器已有的 `special` 同 tick 同槽撞车
  （不同优先级只取最高 / 同优先级先入者胜）⇒ 会**改变现有可听行为**。
- 写法照**已有的「不播报的收尾」**（`handleTurnEnd` 的 `skipKinds` 分支：分支头〔A19〕、收尾行〔A20〕）：
  只 `turnActive = false; turnEndedAt = Date.now()`。
- **顺带不清** `lastMilestoneAt` / `lastMilestoneStep` / `milestoneSpoken` / `startSpoken` / `stepCount`
  —— 理由**不是**「没人读」（那是错的）：`turnActive === false` 时这些字段**照样有可达读者**：
  · `tool/call` 分支（分支头〔A97〕）读 `startSpoken`/`stepCount`，那两行**没有 turnActive 门**
    （先 `stepCount += 1`〔A98〕，再按 `!startSpoken`〔A99〕决定要不要 `narrate('start')`）；
  · `handleTurnEnd`（〔A14〕）读 `turnGoalDone`/`lastUserText`/`lastAssistantText`/`toolNames`/`blocking`（同样无门）；
  · `narrateSummary`（〔A47〕）经 `stateFor` 读 `lastUserText`/`lastAssistantText`/`toolNames`/`blocking` 组 prompt；
  · `narratorStatus`（〔A72〕）回显；`approval/decided`、`assistant/message` 读写 `blocking`。
  真正理由是**行为保全**：清了会改变这些掉队事件的可观测结果 ——
  清 `startSpoken` ⇒ 收尾之后一条**没有 `turn/start`** 的掉队 `tool/call` 会多播一条假「开工了」（START）；
  清 `lastUserText`/`lastAssistantText`/`toolNames`/`blocking` ⇒ 之后真到的 `turn/end` 拿到空快照、DONE 总结退化；
  清 `turnGoalDone` ⇒ A3（goal）降级成 done。
  不清 = 与改动前**逐字一致**（改动前这里什么都不做），也与 `skipKinds` 那条先例同一处置。
  **差分实测（测试 §(h)）**：不清 ⇒ 收尾后那条掉队 `tool/call` 只多一条 `special`；清 ⇒ 变成
  `['special','start']`（多一条假 START）。元自检 4 把「清」注入内存切片，§(h2) 报红（start 由 1 变成 2）。
- 现有那条 `special` 旁白的**可听行为逐字不变**：仍恰好一条（〔A27〕）、仍不传 `sid`（仍落默认槽）、
  仍带 `variant:'subagent'` 与 X5 的 `bubblePrefix`/`label`。旁白 opts 的**快照写在改状态之前**
  （〔A25〕先于〔A24〕），这是一个**等价变换**（不是「保证」）：把收尾提前到算快照之前，结果也一样 ——
  该 rec 若因此从「不活跃」变「刚收尾」，`activeSessionCount` 的 loop 里多一票，而它的 `includeSid`
  补记恰好少加一票（两条互为补集），总数不变；未注册 sid 则两支都不变。保持「先快照」只是让
  「旁白与回合态解耦」在代码里显式可见。
- **边界结论**：`subagent/end` 在 run **结算之后**发出 —— 已核的两个 in-process 发射点都在结算之后
  （one-shot 见 `observeRun` 的 `run.result.then`；常驻子代理见 `createActivationObserver.settle` 的 epoch 终结）
  ⇒ 这两个路径上**不存在「回合仍在合法推进中却被收掉」的正常路径**；
  ⚠ **限定**：**out-of-process provider（`subprocessRunHandle`）与第三方 provider 未逐一证实** ——
  它们只要让 `run.result` 早于子会话最后一个 turn 结算，本收尾就会提前发生。
  即便被提前收掉，该会话之后又起新回合时 `turn/start → resetTurn` 会把 `turnActive` 重新置真（自愈），
  代价是那一个回合的里程碑节奏被重置。
- `stopReason` 取值**一视同仁**。上游词表 = `dsh-subagent` 的 `SubagentStopReason`：
  **`completed` / `aborted` / `error` / `max-tokens` / `refusal`**（merge-extensible）；注意
  **`interrupted` 是 `turn/end` 的 `reason.kind`**，在 `epochStopReason` 里被映射成 `aborted`，
  不会作为 `stopReason` 出现（现场 turn 1 的 `turn/end` 正是 `kind:"interrupted"`）。
  全部代表该 run 已终结 ⇒ 只收回合态、不改上面的旁白分支
  （不按取值区别对待 —— 对 `error` 反而不收尾才会留下僵尸）。
- 取不到注册记录（该 sid 未注册 / `id` 非字符串 / `info` 为空）⇒ **静默跳过**（取记录那一行〔A26〕），
  不抛、不凭空建档，**也不回落默认槽**（回落会把别的会话/单槽模式的回合一起收掉 —— 测试 §(f5) 钉住，
  元自检 3 钉住它会报红）。

**改动 2（兜底）：30 s 巡检加一道「还在活跃吗」过滤**（巡检本体〔A75〕，过滤本体〔A76〕）

- `activeStates()` 改为 `activeRecords()`（〔A87〕）：返回 `{ st, rec }` 成对，记录不再被丢掉。
  它**全文件唯一调用方**就是 30 s 巡检，三条语义逐条保留：
  ① `multiSession === false`（〔A88〕）→ 只有默认槽一项；② `multiSession === true` → 遍历注册表（〔A89〕），
  默认槽**仅在 `turnActive === true` 时**并入（〔A90〕）；③ 默认槽**没有注册记录** ⇒ `rec` 为 `null`，
  调用方**不得**据此丢弃。（旧名 `activeStates` 只留在注释里，见〔A91〕。）
- 巡检本体从 `ctx.interval` 回调里抽成 `milestonePatrolTick()`（便于按函数名切片测试；
  30 s 周期未变，注册处〔A79〕），每个候选先判 `sessionCountsAsActive(candRec, now)`，不活跃就 `continue`（〔A76〕）；
  巡检里的里程碑调用是〔A78〕。
  `rec === null`（默认槽）**不过滤** —— 原样保留它现在的行为（代价见 §7.4 第 3 条）。
- **复用现成判据，未新造任何常量**（`NARR_AUTO_IDLE_MS` 仍是 1800000〔A81〕）。
- 巡检仍然是**只读**的：它不会替任何会话「收尾」（那会破坏静默但仍在跑的长回合，见〔A80〕的既有注释）。

### 7.4 残余（本次**没有**消除的窗口，如实列出）

1. **既没收到 `turn/end`、也没收到 `subagent/end` 的会话**（例如子代理运行被中断的其它路径），
   只剩 30 分钟活跃度兜底：会话真停之后，按 `narratorMilestoneMs` 周期**最多还会多播
   `floor(NARR_AUTO_IDLE_MS / narratorMilestoneMs)` 条**才闭嘴 ——
   现场配置（120000）⇒ `1800000/120000` = **15 条**（测试 §(a3) 用**字面量 15** 钉住，实测起止
   `+120000 … +1800000 ms`）；出厂默认（240000）⇒ **7 条**。
   把 `narratorMilestoneMs` 调小、或把 `NARR_AUTO_IDLE_MS` 调大，这个数字同步变大（两者相除）。
2. **非子代理会话**（用户自己的会话）若漏收 `turn/end`，同样只剩上面那条 30 分钟兜底 ——
   改动 1 只覆盖 `subagent/end` 这一条路径，不给普通会话加新的收尾判据。
3. **默认槽（无 sid / `multiSession:false`）：改动 2 对单会话模式提供 0 保护，原缺陷无界可达。**
   · 机制：`stateFor`（〔A84〕）里 `if (config.multiSession === false) return defaultSlot.state` 是**第一行**
     （该函数体的前两行同在〔A85〕；`stateFor` 的**最后一行**是 `return registerSession(key, null).state`〔A86〕），
     而 `activeRecords()` 同样第一行返回 `[{ st: defaultSlot.state, rec: null }]`（〔A88〕）
     ⇒ **单会话模式下每一个回合都落在默认槽**，候选集恒为那一项；默认槽没有 rec ⇒ 巡检对它**没有**任何
     活跃度门 ⇒ 一个永不收尾的回合会按 120 s 周期**线性无界**地播下去。
   · 实测量级（测试 §(g4)，20/60/200 分钟三个窗口）：**10 / 30 / 100 条**。
   · 多会话模式下同样存在，只是默认槽通常只承载「无归属事件」；本机配置 `multiSession:true`，
     所以这次现场不是这条路径。
   · **这是用户已知情并接受的残余**（2026-09-20 裁决原话：**「不覆盖，只写清楚」**），
     **不是遗漏**。要覆盖它必须改 `activeStates()/activeRecords()` 的那两条既有语义（默认槽并入规则、
     `rec===null` 不过滤），并同步改测试 §(g2)/(g3)/(g4) 与本页 —— 别以为忘了做。
4. **假阴性（新增判据的代价）**：一个**合法推进中**但 >30 分钟零 `session/event` 的回合会被巡检跳过
   （`rec.lastActiveAt` 只在事件到达时刷新〔A96〕）⇒ 这段时间不播里程碑；**下一个事件到达即自愈**
   （`touchSession`〔A95〕刷新 `lastActiveAt`）。正常回合不会 30 分钟无事件（`NARR_AUTO_IDLE_MS` 的取值依据〔A82〕）。
5. 巡检只在**下一次 tick**（≤30 s）才生效，不打断已经排进播放队列的那一条。

### 7.5 没验到的部分（不要当成已验证）

- **没有在真机上跑过修复后的插件**：`host.mjs` 的改动要重启 DSH 才生效（`docs/git-workflow.md` §11.3），
  本次按要求**没有重启 DSH、没有碰 3080/8100/9880**，所以「现场那个 sid 的播报真的停了」**没有观测到**——
  验到的是切片级行为（测试 + 元自检 + 五处变异）与现场取证。
  **本轮同样没有重启 DSH**：只把两份 `client.mjs`/`client.js` 加了一行设置项，面板要等下次插件重载才会出现该项
  ——「面板上真的看得见「里程碑步数」」这件事**只在源码层核对过，没有在浏览器里点过**。
- **没有观测到那个僵尸 sid 的 `subagent/end`**：现场 211 条 `special` 里没有一条带
  `你是游戏图形工…·7f20` 这个标签（`special` 行不传 sid，标签来自 `subagentEndPrefix(info.id)`
  算出的 `bubblePrefix`/`label`）⇒ 该 sid **很可能压根没收到过 `subagent/end`**，
  它是 §7.4 第 1 条那种「两条收尾路径都没走」的残余形态。
  ⇒ 对这个具体现场，**起作用的会是改动 2（兜底）而不是改动 1**；改动 1 修的是另一条同源路径
  （收到了 `subagent/end` 却仍留着 `turnActive` 的会话）。两条都保留。
- **`activeStates()` 的旧调用方**：全文件搜过只有 30 s 巡检一处，但这是**静态**结论，
  没有运行时插桩去证实「没有别的模块通过 RPC/动态调用拿到它」（它是闭包内局部函数，未导出）。
- **out-of-process / 第三方 provider 的 `subagent/end` 时机**：只核了 shipped 的两个 in-process 发射点，
  见 §7.3 的限定。
- **收尾的「隔离性」是切片级结论**：(d4) 证明的是一次 `subagent/end` 只改被点名那个 sid 的回合态，
  且**三类被害者**（另一个子代理会话 / 一个普通注册会话 / 默认槽的回合）都不受影响；
  真机上「多会话同时活跃、其中一个子代理结束时其它照常播」**没有观测过**。
- **`push.id` 只证明「同一个进程」**，不能反证「那 36.7 小时里插件没被热重载过」
  （热重载不会重置 `nextId`〔A94〕—— 它是模块级 `let`，而 ESM 模块按 URL 缓存、热重载复用同一模块实例，
  见 `docs/git-workflow.md` §11.3）。不过热重载会重建插件实例的内存态，与该 sid 在 9/20 继续被播报
  这一事实不符，故结论不受影响。

### 7.6 行锚（机核）

**本页所有 `host.mjs` / `client.mjs` / `client.js` 行号都只在这张表里**，正文一律用锚点编号引用
（`〔A07〕`；区间写 `〔A04〕~〔A05〕`）。表由 `tools/check-anchors.mjs` 逐行核对：

```
node tools/check-anchors.mjs
```

每条锚点的判据（任一不成立即 `BAD`）：① 文件存在；② 片段在该文件里**恰好命中一次**
（0 次 = 锚点失效，>1 次 = 锚点不唯一、定位不到行，都会报出来）；③ 命中处的行号 === 表里写的行号；
④ 正文里的每个 `〔Axx〕` 引用都能在表里找到（**悬空引用**算坏）；⑤ 表里每行都至少被正文引用一次
（**孤儿锚点**算坏，防止表反向漂移）；⑥ **表内 id 不得重复**（重复时 ④/⑤ 的 id 集合判据看不见多出来的那行）。
片段里的 `⏎` 表示换行（多行锚点这么写，免得只钉住半段）。表行按 `|` 切分后再 trim ⇒ 补对齐空格不算改动。
末行 `锚点共 N 条，坏 0 条` 时退出码 0。

**`client.js` 的三条锚点（A108~A110）**：文件列写成 `client.js#unescape`，片段按**解码后**文本写 ——
核对前先把该文件的 `\uXXXX` 解码。理由：`client.js` 是转义构建产物，纯粹的产物重生成（转义十六进制
大小写变化、引号风格变化）不该让这张表假红。`\uXXXX` 解码是 1:1 的（不产生换行），所以行号不受影响；
输出里的「该行原文」仍取自**原始文件**（转义形态）。

**插行之后怎么办**：跑一次上面那条命令，它会把每一处 `表写 X 行，实际在 Y 行` 直接列出来 ——
**行号只需改这一个地方**，正文不用动（正文里没有行号）。本页 §7.6 的表就是全部的锚点。

| 锚点 | 文件 | 行 | 该行含有的片段 |
| --- | --- | --- | --- |
| A01 · `makeTurnState` 定义（回合态工厂） | host.mjs | 2510 | `function makeTurnState(sid) {` |
| A02 · `st.lastMilestoneAt` 字段初值 | host.mjs | 2519 | `lastMilestoneAt: 0,` |
| A03 · `st.lastMilestoneStep` 字段初值 | host.mjs | 2520 | `lastMilestoneStep: 0,` |
| A04 · 到点后「先推进基准」那一段的头 | host.mjs | 3631 | `// 先推进基准（占位）` |
| A05 · 同上那一段的尾（`milestoneSpoken` 触发点置位） | host.mjs | 3634 | `st.milestoneSpoken = true` |
| A06 · `maybeMilestone` 函数头 | host.mjs | 3616 | `function maybeMilestone(st) {` |
| A07 · 门：本会话回合是否活跃 | host.mjs | 3619 | `if (st.turnActive !== true) return` |
| A08 · 门：阻塞中不报进度 | host.mjs | 3620 | `if (st.blocking) return` |
| A09 · 门：还没「有据开工」 | host.mjs | 3621 | `if (st.stepCount < 1) return` |
| A10 · 时间型周期的取值行（默认 240000） | host.mjs | 3622 | `const ms = typeof config.narratorMilestoneMs === 'number' ? config.narratorMilestoneMs : 240000` |
| A11 · 步数型周期的取值行（兜底 50，与出厂默认同值） | host.mjs | 3623 | `const steps = typeof config.narratorMilestoneSteps === 'number' ? config.narratorMilestoneSteps : 50` |
| A12 · `resetTurn` 函数头（回合复位） | host.mjs | 3192 | `function resetTurn(st) {` |
| A13 · `resetTurn` 写里程碑基准两行（回合起点 / 0） | host.mjs | 3198 | `st.lastMilestoneAt = now⏎      st.lastMilestoneStep = 0` |
| A14 · `handleTurnEnd` 函数头（回合收尾） | host.mjs | 3661 | `function handleTurnEnd(evData, st) {` |
| A15 · `handleTurnEnd` 正常路径清基准那一段 | host.mjs | 3683 | `st.milestoneSpoken = false⏎      st.lastMilestoneAt = 0⏎      st.lastMilestoneStep = 0⏎      st.startSpoken = false` |
| A16 · `clearTurnState` 函数头（抹掉回合态） | host.mjs | 2862 | `function clearTurnState(st) {` |
| A17 · `clearTurnState` 清基准那一段 | host.mjs | 2867 | `st.milestoneSpoken = false⏎      st.lastMilestoneAt = 0⏎      st.lastMilestoneStep = 0⏎      st.turnGoalDone = false` |
| A18 · 非正常收尾的 `skipKinds` 词表 | host.mjs | 3665 | `const skipKinds = ['blocked', 'error', 'aborted', 'interrupted', 'max-tokens']` |
| A19 · `skipKinds` 早退分支头（先例：不播报的收尾） | host.mjs | 3666 | `if (kind !== undefined && skipKinds.indexOf(kind) >= 0) {` |
| A20 · 先例里的收尾时刻写入 | host.mjs | 3668 | `st.turnEndedAt = Date.now()   // Fix R1：收尾时刻（auto 活跃宽限窗依据）` |
| A21 · `handleTurnEnd` 正常路径的收尾两行 | host.mjs | 3680 | `st.turnActive = false⏎      st.turnEndedAt = Date.now()   // Fix R1：先记收尾时刻` |
| A22 · `clearTurnState` 里的 `turnActive = false` | host.mjs | 2863 | `st.turnActive = false⏎      st.turnStartAt = 0` |
| A23 · `subagent/end` 处理器（改动 1 所在） | host.mjs | 5052 | `ctx.effect(() => ctx.on('subagent/end', (info) => {` |
| A24 · 改动 1 本体：收掉该会话的回合两行 | host.mjs | 5070 | `rec.state.turnActive = false⏎            rec.state.turnEndedAt = Date.now()` |
| A25 · `subagent/end` 的旁白 opts 快照（先于改状态） | host.mjs | 5060 | `const o = (info && info.stopReason) ? { variant: 'subagent' } : null` |
| A26 · `subagent/end` 取注册记录（取不到就跳过，不回落默认槽） | host.mjs | 5068 | `const rec = sessions.get(cid)` |
| A27 · 既有 `special` 旁白（行为不变、仍不传 sid） | host.mjs | 5075 | `if (o !== null) narrate('special', o)` |
| A28 · `narrate` 函数头 | host.mjs | 3443 | `function narrate(intent, opts) {` |
| A29 · `narrate` 入批**之前**的同意图 8s 预筛（第一处门） | host.mjs | 3449 | `if (o.force !== true) {` |
| A30 · 预筛挡回时的返回原因 | host.mjs | 3452 | `reason: 'merged-same-intent'` |
| A31 · 入批 | host.mjs | 3455 | `narrPendingBatch.push({ intent, opts: o, at: now })` |
| A32 · 排 flush 微任务 | host.mjs | 3459 | `queueMicrotask(flush)` |
| A33 · `flushNarrBatch` 函数头 | host.mjs | 3465 | `function flushNarrBatch() {` |
| A34 · 按 sid 分组 | host.mjs | 3474 | `const groups = new Map()⏎      for (let i = 0; i < batch.length; i++) {` |
| A35 · 组内取最高优先级（严格大于 ⇒ 先入者胜） | host.mjs | 3488 | `if ((NARR_PRIORITY[c.intent] || 0) > (NARR_PRIORITY[best.intent] || 0)) best = c` |
| A36 · `deliverNarration` 函数头 | host.mjs | 3517 | `async function deliverNarration(intent, opts) {` |
| A37 · 同步门 `if (!force)`（第二处门：占位登记在里面） | host.mjs | 3524 | `if (!force) {` |
| A38 · 同意图占位登记 | host.mjs | 3534 | `st.lastSpokeByIntent.set(intent, now)` |
| A39 · 交付确认的观测点（milestone 槽） | host.mjs | 3644 | `const beforeSameAt = st.lastSpokeByIntent.get('milestone')` |
| A40 · `maybeMilestone` 里那次 `narrate('milestone')`（全文件唯一的非 force milestone） | host.mjs | 3646 | `narrate('milestone', { sid: st.sid })` |
| A41 · 确认回调入队 | host.mjs | 3656 | `queueMicrotask(confirmDelivery)` |
| A42 · 确认回调里的基准核对（防回合边界期间写回旧基准） | host.mjs | 3650 | `if (st.lastMilestoneAt !== now || st.lastMilestoneStep !== attemptStep) return` |
| A43 · 回滚分支判定（槽没变 ⇒ 未被受理） | host.mjs | 3651 | `if (st.lastSpokeByIntent.get('milestone') === beforeSameAt) {` |
| A44 · 回滚写入 | host.mjs | 3652 | `st.lastMilestoneAt = prevAt` |
| A45 · LLM 返回后的重核块头（残余窗口所在） | host.mjs | 3566 | `if (llmAttempted && !force) {` |
| A46 · 重核判据之一 | host.mjs | 3567 | `const sameReplaced = st.lastSpokeByIntent.get(intent) !== mySameAt` |
| A47 · `narrateSummary` 函数头（prompt 组装） | host.mjs | 3297 | `async function narrateSummary(kind, opts) {` |
| A48 · `testNarrator` 处理器（force 路径） | host.mjs | 4725 | `ctx.effect(() => harnessLocal.handle('testNarrator', async (args) => {` |
| A49 · `recordProgress` 函数头 | host.mjs | 3067 | `function recordProgress(sid, patch) {` |
| A50 · `milestoneCount` 触发时 +1 | host.mjs | 3087 | `if (p.milestoneBump === true) e.milestoneCount += 1` |
| A51 · 分片初始化/纠偏 | host.mjs | 3072 | `if (!e || typeof e !== 'object') e = { milestoneCount: 0 }` |
| A52 · 同一函数体内另写一份 `narrator.json` 侧摘要 | host.mjs | 3096 | `narrGlobal.sessions[key] = {` |
| A53 · `recordProgress` 末尾排两条落盘 | host.mjs | 3121 | `scheduleSaveMemory()⏎      scheduleSaveNarrator()` |
| A54 · `scheduleSaveMemory` 函数头 | host.mjs | 736 | `function scheduleSaveMemory() {` |
| A55 · `saveMemoryNow` 函数头 | host.mjs | 740 | `async function saveMemoryNow() {` |
| A56 · `sakiko-memory.json` 的整对象写入 | host.mjs | 742 | `await writeTextSafe(MEMORY_PATH, JSON.stringify(memory, null, 2))` |
| A57 · python 兜底落盘（`tools/mem_save.py`） | host.mjs | 748 | `await runPython([MEM_SAVE_PY, lastHostPort, MEMORY_PATH], 'mem_save')` |
| A58 · `narrPersistSnapshot` 函数头 | host.mjs | 3130 | `function narrPersistSnapshot() {` |
| A59 · 摘要被 `narrPersistSnapshot` 原样带走的那一行 | host.mjs | 3137 | `sessions: narrGlobal.sessions || {},` |
| A60 · `scheduleSaveNarrator` 函数头 | host.mjs | 3169 | `function scheduleSaveNarrator() {` |
| A61 · `saveNarratorNow` 函数头 | host.mjs | 3162 | `async function saveNarratorNow() {` |
| A62 · `narrator.json` 的写入 | host.mjs | 3164 | `await writeTextSafe(NARRATOR_PATH, JSON.stringify(narrPersistSnapshot(), null, 2))` |
| A63 · `loadMemory` 函数头 | host.mjs | 717 | `async function loadMemory() {` |
| A64 · `loadMemory` 走 `sanitizeProgressMap` | host.mjs | 729 | `memory.progress = sanitizeProgressMap(memory.progress)` |
| A65 · `sanitizeProgressEntry` 函数头 | host.mjs | 3005 | `function sanitizeProgressEntry(v) {` |
| A66 · 分片白名单保留 `milestoneCount`（`sakiko-memory.json` 侧） | host.mjs | 3020 | `out.milestoneCount = (typeof v.milestoneCount === 'number' && isFinite(v.milestoneCount)) ? Math.max(0, Math.floor(v.milestoneCount)) : 0` |
| A67 · `sanitizeProgressMap` 函数头 | host.mjs | 3031 | `function sanitizeProgressMap(m) {` |
| A68 · `loadNarrator` 函数头 | host.mjs | 3140 | `async function loadNarrator() {` |
| A69 · `loadNarrator` 走 `sanitizeNarratorSessions` | host.mjs | 3157 | `narrGlobal.sessions = sanitizeNarratorSessions(parsed.sessions)` |
| A70 · `sanitizeNarratorSessions` 函数头 | host.mjs | 3041 | `function sanitizeNarratorSessions(m) {` |
| A71 · 分片摘要保留 `milestoneCount`（`narrator.json` 侧） | host.mjs | 3050 | `milestoneCount: (typeof v.milestoneCount === 'number' && isFinite(v.milestoneCount)) ? Math.max(0, Math.floor(v.milestoneCount)) : 0,` |
| A72 · `narratorStatus` 处理器（唯一对外读取方） | host.mjs | 4661 | `ctx.effect(() => harnessLocal.handle('narratorStatus', async () => {` |
| A73 · `milestoneSpoken` 的调试回显 | host.mjs | 4704 | `milestoneSpoken: st.milestoneSpoken,` |
| A74 · `milestoneSpoken` 字段初值（含语义注释） | host.mjs | 2518 | `milestoneSpoken: false,   // Task 10 起语义收窄` |
| A75 · `milestonePatrolTick` 巡检本体 | host.mjs | 5121 | `function milestonePatrolTick() {` |
| A76 · 改动 2 本体：活跃度过滤 | host.mjs | 5129 | `if (candRec !== null && !sessionCountsAsActive(candRec, now)) continue` |
| A77 · 既有 `narrateSubagents` 过滤（未改） | host.mjs | 5133 | `if (config.narrateSubagents === false && typeof st.sid === 'string' && st.sid.length > 0) {` |
| A78 · 巡检里的里程碑调用 | host.mjs | 5137 | `maybeMilestone(st)⏎        } catch (e) { /* ignore */ }` |
| A79 · 30 s tick 注册（周期未变） | host.mjs | 5142 | `ctx.effect(() => ctx.interval(() => { milestonePatrolTick() }, 30000))` |
| A80 · 巡检「只读」的既有注释（Fix R2） | host.mjs | 5114 | `// Fix R2（Important-新-1）：本 tick **只读**` |
| A81 · 现成判据常量 `NARR_AUTO_IDLE_MS` | host.mjs | 2457 | `const NARR_AUTO_IDLE_MS = 1800000` |
| A82 · `NARR_AUTO_IDLE_MS` 取 30 分钟的依据 | host.mjs | 2456 | `// 30 分钟：长工具调用期间 session/event 事件流不断，正常回合不会 30 分钟无事件。` |
| A83 · `NARR_ACTIVE_GRACE_MS`（刚收尾的 8s 宽限窗） | host.mjs | 2453 | `const NARR_ACTIVE_GRACE_MS = 8000` |
| A84 · `stateFor` 函数头（状态入口） | host.mjs | 2819 | `function stateFor(sid) {` |
| A85 · `stateFor` 第一行（单槽短路） | host.mjs | 2820 | `if (config.multiSession === false) return defaultSlot.state⏎      const key = (typeof sid === 'string' && sid.length > 0) ? sid : ''` |
| A86 · `stateFor` 兜底建档（注册表键的来源） | host.mjs | 2825 | `return registerSession(key, null).state` |
| A87 · `activeRecords` 函数头（改动 2 的取数口） | host.mjs | 2840 | `function activeRecords() {` |
| A88 · `activeRecords` 单槽分支 | host.mjs | 2841 | `return [{ st: defaultSlot.state, rec: null }]` |
| A89 · 注册表遍历（记录不再被丢） | host.mjs | 2843 | `for (const rec of sessions.values()) out.push({ st: rec.state, rec })` |
| A90 · 默认槽并入（`turnActive` 时） | host.mjs | 2848 | `if (defaultSlot.state.turnActive === true) out.push({ st: defaultSlot.state, rec: null })` |
| A91 · 「改动前这里叫 `activeStates()`」注释 | host.mjs | 2828 | `//   改动前这里叫 activeStates() 且只回传 st` |
| A92 · `sessionCountsAsActive` 函数头（复用的现成判据） | host.mjs | 2912 | `function sessionCountsAsActive(rec, now) {` |
| A93 · 现成判据本体 | host.mjs | 2914 | `if (st.turnActive === true && (now - rec.lastActiveAt) <= NARR_AUTO_IDLE_MS) return true` |
| A94 · `nextId` 纯内存计数器（`push.id` 的来源） | host.mjs | 285 | `let nextId = 1` |
| A95 · `touchSession` 函数头 | host.mjs | 2799 | `function touchSession(session) {` |
| A96 · `touchSession` 刷新 `lastActiveAt` | host.mjs | 2806 | `rec.lastActiveAt = Date.now()` |
| A97 · `tool/call` 分支头 | host.mjs | 4944 | `if (t === 'tool/call') {` |
| A98 · `tool/call` 里**无 turnActive 门**的步数自增 | host.mjs | 4946 | `st.stepCount += 1` |
| A99 · `tool/call` 里**无 turnActive 门**的 START 分支 | host.mjs | 4949 | `if (!st.startSpoken) {` |
| A100 · `tool/call` 里的里程碑即时判定 | host.mjs | 4956 | `maybeMilestone(st)⏎          return` |
| A101 · `sanitizePatch`：`narratorMilestoneSteps` 的 3~200 | host.mjs | 661 | `if (typeof p.narratorMilestoneSteps === 'number' && p.narratorMilestoneSteps >= 3 && p.narratorMilestoneSteps <= 200)` |
| A102 · `DEFAULT_CONFIG`：`narratorMilestoneSteps` 出厂默认 50 | host.mjs | 208 | `narratorMilestoneSteps: 50,` |
| A103 · `sanitizePatch`：`narratorMilestoneMs` 的 60000~1800000 | host.mjs | 660 | `if (typeof p.narratorMilestoneMs === 'number' && p.narratorMilestoneMs >= 60000 && p.narratorMilestoneMs <= 1800000)` |
| A104 · `DEFAULT_CONFIG`：`narratorMilestoneMs` 出厂默认 240000 | host.mjs | 207 | `narratorMilestoneMs: 240000,` |
| A105 · 面板：里程碑步数选项表（覆盖 sanitize 的 3~200） | client.mjs | 691 | `const stepOptions = [[10, '10 步'], [20, '20 步'], [50, '50 步（默认）'], [100, '100 步'], [200, '200 步']]` |
| A106 · 面板：里程碑步数选择行的兜底 | client.mjs | 692 | `const pickSteps = (v) => stepOptions.find((o) => o[0] === v) ? v : 50` |
| A107 · 面板：「里程碑步数」控件行 | client.mjs | 737 | `Row({ label: '里程碑步数', desc: '单回合内每满这么多步（工具调用）就再播一条；与「里程碑间隔」任一先到即触发', control: Select({ value: pickSteps(config.narratorMilestoneSteps), options: stepOptions, onChange: (v) => patchConfig({ narratorMilestoneSteps: Number(v) }) }) })` |
| A108 · 面板（转义版）：里程碑步数选项表 | client.js#unescape | 697 | `const stepOptions = [[10, "10 步"], [20, "20 步"], [50, "50 步（默认）"], [100, "100 步"], [200, "200 步"]]` |
| A109 · 面板（转义版）：里程碑步数选择行的兜底 | client.js#unescape | 698 | `const pickSteps = (v) => stepOptions.find((o) => o[0] === v) ? v : 50` |
| A110 · 面板（转义版）：「里程碑步数」控件行 | client.js#unescape | 738 | `Row({ label: "里程碑步数", desc: "单回合内每满这么多步（工具调用）就再播一条；与「里程碑间隔」任一先到即触发", control: Select({ value: pickSteps(config.narratorMilestoneSteps), options: stepOptions, onChange: (v) => patchConfig({ narratorMilestoneSteps: Number(v) }) }) })` |
| A111 · `maybeMilestone` 的前两道门（narratorOn / st 为空） | host.mjs | 3617 | `if (config.narratorOn !== true) return⏎      if (st === null || st === undefined) return` |
| A112 · `resetTurn` 里 `milestoneSpoken` 的复位 | host.mjs | 3196 | `st.milestoneSpoken = false⏎      // Task 10 周期制：里程碑基准 = 本回合起点` |
| A113 · `milestoneCount` 的触发时调用点（要挪口径就挪这一行） | host.mjs | 3636 | `recordProgress(st.sid, { milestoneBump: true })` |

（表尾注：本表由 `tools/check-anchors.mjs` 解析并逐行断言；它是**仓库自带**的工具，不是本机临时脚本。
上次交付报告里的原始输出即由它打印。`test/narr-milestone-config.test.mjs` §6 也把「坏 0 条」钉成断言，
所以本表失准会直接让测试报红，而不是只在下一次有人手动跑脚本时才发现。）
