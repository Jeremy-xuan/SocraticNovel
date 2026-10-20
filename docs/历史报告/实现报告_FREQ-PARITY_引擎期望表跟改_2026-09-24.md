# 实现报告 · FREQ-PARITY：把「两处必须同改」的第二处补上

> **日期**：2026-09-24 ｜ **工作目录**：`/Users/wujunjie/Documents/ChatGPT/大学申请`
> **上游**：`实现报告_EXPR5_表情收尾_2026-09-24.md` §⑤（引擎全量单测 426 ／ pass 425 ／ **fail 1**，红项＝`F3 cs-os：相位逐相位注入块集`）；
> 教室 `code/classrooms/cs-os/classroom.yaml` 自己的注释〔A18〕（"动这里的频率语义＝两处必须同改"）。
> **三件交付**：① 引擎侧期望表跟改到**现盘教室的新语义**（并且**改成从教室声明推导**，不再写死一份块集）；
> ② 加一条**「两处必须同改」守门**（F3b 签署表：教室改语义 → 响亮报"哪一处改了、另一处没动"）；
> ③ `runtime/expression.md` 的 `expression_note` 补一句"本文件记的是请求值"。
> **可动范围**：`code/plugins/socratic-engine/**`（4 个文件）＋ 隔离测试 profile `socratic-headless` 的装载副本 ＋ 本报告。
> 🔴 **没碰**：`code/classrooms/**`（只读；教室 `classroom.yaml` 哈希仍是 `a6638e34d441acba…`）、`code/clients/**`、`code/tools/**`（只读）、
> `code/acceptance/**`、`code/skills/**`、`~/SocraticNovel-wt/`、`~/SocraticNovel-GitHub仓库/`、桌面 App、`web`／`desktop` profile；
> **没有 git commit／push**；**没有新增依赖**；**没有装任何 `@deepseek-ai/*`**；没有调用任何询问类工具。
> **行号纪律**：正文只写锚点 `〔Axx〕`，行号与版本哈希在同目录旁挂的 `实现报告_FREQ-PARITY_引擎期望表跟改_2026-09-24.anchors.md`。
> **机核**：`node 开源线/DSH定制/code/tools/anchors/check-anchors.mjs 开源线/DSH定制/实现报告_FREQ-PARITY_引擎期望表跟改_2026-09-24.md --list`

---

## §0 一句话结论

| # | 要做的事 | 结果 | 关键证据 |
|---|---|---|---|
| ① | 引擎侧期望表跟改到新语义 | ✅ 改成**从教室声明推导**（六相位 × 两个状态逐相位比对），不再写死块集〔A02〕〔A06〕 | §1.4 的逐相位实测表 ＋ §4.2 的变异测试（把计划器的相位门改坏 → F3 立刻报红） |
| ② | 「两处必须同改」守门 | ✅ 新增 **F3b 签署表**〔A04〕：教室频率语义一变 → 报错指名"哪一处改了、另一处没动"〔A07〕〔A08〕 | §2.3 的报错原文（故意把 `anchor.check` 改回 `n_turns:5`） |
| ③ | `expression_note` 补一句说明 | ✅ 该行**始终出现**，末段固定是那句"本文件记录的是请求值（实际值由渲染侧夹取后生效）"〔A11〕〔A12〕 | §3.2 引擎写入路径的**原始输出** |
| — | 全量单测 | ✅ **429 ／ pass 429 ／ fail 0**（改前 426／425／1） | §4.1 |

**一句话**：红项的成因不是"引擎坏了"，而是**同一件事实的两个副本**（教室声明 vs 引擎侧写死的期望）没有一起改。
本轮把引擎侧那一处**改成推导**（教室再改频率，测试自动跟上），并**另加一份显式签署表**专门盯"教室有没有在没人知道的情况下改语义"——
下次再有人只改一处，报错会直接说清两处分别在哪、改成了什么，而不是留一条让人猜的红测试。

---

## §1 那条断言的期望表原来是怎么来的（先读源码，再改）

### 1.1 原状：**测试里写死了一份六相位块集**

红项在 `test/phase.test.mjs` 的 F3。改前它的做法是**在测试里手写一个 `expected` 对象**（六相位 → 块 id 数组），
再逐个相位跟注入计划器 `planTurnInjections` 的输出做 `deepEqual`：

```js
// 改前（本轮删掉的原文，逐字抄自冻结副本）
test('🔴 F3 cs-os：相位逐相位注入块集（钉住报告 §1 的对照表）', () => {
  const m = loadManifest(CS_OS)
  const expected = {
    open: ['anchor.rules', 'anchor.lesson_ban', 'story.arc_gate', 'curriculum.map', 'story.node.01', 'state.progress', 'state.mistakes', 'state.review'],
    probe: ['anchor.rules', 'anchor.lesson_ban', 'story.arc_gate', 'curriculum.map', 'material.current.01', 'state.progress'],
    answer: ['anchor.rules', 'anchor.lesson_ban', 'story.arc_gate', 'curriculum.map', 'state.progress'],
    check: ['anchor.rules', 'anchor.lesson_ban', 'story.arc_gate', 'curriculum.map', 'kp.current', 'material.current.01', 'state.progress', 'state.mistakes'],
    review: ['anchor.rules', 'anchor.lesson_ban', 'story.arc_gate', 'curriculum.map', 'state.progress'],
    close: ['anchor.rules', 'anchor.lesson_ban', 'story.arc_gate', 'curriculum.map', 'kp.current', 'state.progress'],
  }
  for (const [phase, want] of Object.entries(expected)) {
    assert.deepEqual(ids(planTurnInjections(m.blocks, freshState(phase, { currentLesson: 1 }))), want, phase)
  }
})
```

**它是哪来的**：这份表是**从教室当时（M3-STATE 那轮）的逐相位对照实测抄下来的**——同一份数值还写在
`实现报告_M3_state_2026-09-24.md` §2.2 的"逐相位对照"表里，那份表当时把 `anchor.check` 记作 `n_turns:5`（第 5 回合才在场），
所以冷启动的六个相位里它**一个都不出现**。

**改前的可核对版本**：这份文件在本轮开工前的副本仍在验收流水线的冻结目录里
（`code/acceptance/runs/2026-09-24_152939/frozen/plugins/socratic-engine/test/phase.test.mjs`），
sha256 前 16 位＝`c596e067b3f804eb`，且**全文 `anchor.check` 零命中**——即"期望表按旧语义写"这件事有物证，不靠回忆。

这条教训也已经写进测试文件的**文件头**（下次改这个文件的人先看到它）〔A01〕。

### 1.2 教室侧发生了什么（另一条线，本轮不重造）

教室 `anchor.check`（`_anchor.md` 的「教学检查」段）的频率从 `n_turns:5` 改成 **相位门**：
`frequency: { every: phase }` ＋ `phase: { except: [open] }`〔A17〕。教室自己在那一段注释里写明了这条纪律〔A18〕：

> `#   → **动这里的频率语义＝两处必须同改**，否则验收仍按旧语义推期望块清单。`

它指的"另一处"（验收侧那份独立实现）与本轮这条引擎侧期望表是同一类东西：**同一个事实的第二份副本**。

### 1.3 改成什么：期望值**从教室声明推导**

F3 现在不写块集，而是**现推**〔A02〕〔A06〕：

1. 推导器 `deriveBlocksFromDeclarations`〔A02〕读**教室声明**（`frequency.every`／`frequency.n`／`frequency.anchor`／`phase` 门／`lesson` 门／`position.target`），
   按"记账表全空"的口径算出该相位的块集；相位门〔A09〕与讲次门〔A10〕各有一份**独立实现**（不调引擎的注入计划器）；
2. 再跟引擎自己的计划器 `planTurnInjections` 的输出**逐相位 `deepEqual`**；
3. 未知频率模式 / 未知讲次门形状 → **抛错**，不许静默当作"不注入"。

跑两个状态 × 六个相位（`第 1 回合（冷启动）` 与 `第 5 回合`，后者让 `n_turns:5` 的那两块进场），
外加一条"六个相位不得推出同一个集合"（否则＝相位门恒开，是假门）。

### 1.4 改后的逐相位块集（实测打印，现盘教室 `a6638e34d441acba…`）

| 相位 | 块数 | 注入的块（按计划器顺序） |
|---|---|---|
| `open` | 8 | `anchor.rules`／`anchor.lesson_ban`／`story.arc_gate`／`curriculum.map`／`story.node.01`／`state.progress`／`state.mistakes`／`state.review` |
| `probe` | 7 | `anchor.rules`／`anchor.lesson_ban`／**`anchor.check`**／`story.arc_gate`／`curriculum.map`／`material.current.01`／`state.progress` |
| `answer` | 6 | `anchor.rules`／`anchor.lesson_ban`／**`anchor.check`**／`story.arc_gate`／`curriculum.map`／`state.progress` |
| `check` | 9 | `anchor.rules`／`anchor.lesson_ban`／**`anchor.check`**／`story.arc_gate`／`curriculum.map`／`kp.current`／`material.current.01`／`state.progress`／`state.mistakes` |
| `review` | 6 | `anchor.rules`／`anchor.lesson_ban`／**`anchor.check`**／`story.arc_gate`／`curriculum.map`／`state.progress` |
| `close` | 7 | `anchor.rules`／`anchor.lesson_ban`／**`anchor.check`**／`story.arc_gate`／`curriculum.map`／`kp.current`／`state.progress` |

→ **`open` 不放行、其余五个相位都放行**（`except: [open]` 的语义），块数与 ALIGN-EXEC3 报告 §2.2 的实测表**逐相位吻合**（8／7／6／9／6／7）。
判据没有被放宽：仍是**逐相位 deepEqual**（不是"只比总数"）。

---

## §2 硬编码 vs 推导：权衡与选择

### 2.1 为什么不是"纯推导就完事"

推导器与注入计划器**读的是同一份教室声明**。所以"纯推导"有一个**结构性盲区**：
**教室声明自己配错时（例如新教材块忘了挂讲次门），推导器会跟着一起错，两边一致地错 → 没人能发现。**

这不是假想。`实现报告_T6_教材接线_2026-09-24.md` 记着那一轮就是**靠 F3 当时写死的期望值**才拿到"13 条新教材块有没有正确挂上讲次门"的正面证据
（原话大意：若新块没挂讲次门，F3 在 `currentLesson=1` 下会多出 `.02`–`.14` 而失败）。

### 2.2 所以选的是「推导 ＋ 签署」两层，而不是二选一

| 层 | 是什么 | 管什么 | 教室改语义时会怎样 |
|---|---|---|---|
| **F3**（推导）〔A06〕 | 期望值**从教室声明现推**，再与计划器逐相位比对 | **计划器有没有照教室声明执行** | **自动跟上**（不再留分叉点） |
| **F3b**（签署表）〔A04〕 | 引擎侧手写一份"块 id → 规范化声明"的**签署记录** | **教室有没有在没人知道的情况下改语义** | **响亮报错**，指名两处 |

**代价（说清楚）**：F3b 是**声明层的第二副本**——教室改频率语义时它会红，需要人工逐条更新。
这正是要的效果（"两处必须同改"），而不是缺陷：**它把"静默分叉"换成了"一次显式确认"**。
反过来，如果只留 F3b、不留推导，就会退回到"写死一份块集"的老问题（教室里合法的改动会让一屋子测试红得莫名其妙）。

### 2.3 守门形态与**故意改一处**的报错原文

守门的规范化口径在 `canonicalDeclaration`〔A03〕（块 id → 一行声明文本，例如 `chat · phase(except=open)`），
签署表本体在 `SIGNED_FREQUENCY_GATES`〔A04〕，本轮跟改的那一行是〔A05〕。
F3b〔A07〕逐条比对"签署表 vs 现盘教室"，报错头一句就是"**不一致（＝两处不同步）**"〔A08〕。

**验收做法（真跑）**：把引擎树与教室**整棵镜像**到 `/tmp/fp/parity/`（不改工作区），
只在镜像里把教室 `anchor.check` **改回旧语义**（`frequency: { every: n_turns, n: 5 }`，删掉 `phase:` 门），
再跑同一份测试文件。报错原文（逐字）：

```
✖ failing tests:

test at test/phase.test.mjs:794:1
✖ 🔴 F3b cs-os：教室频率语义 vs 引擎侧签署表 —— 不一致就报「两处必须同改」 (10.489917ms)
  Error:
  🔴 教室的频率语义与引擎侧签署表**不一致（＝两处不同步）** —— 「动这里的频率语义＝两处必须同改」

  这两处分别是：
    ① 教室侧：code/classrooms/cs-os/classroom.yaml（现盘 sha256 a5aa0f29e1d8cd1d…）
    ② 引擎侧：本文件（test/phase.test.mjs）的 SIGNED_FREQUENCY_GATES 签署表

  改了 1 条（教室已经变了，签署表还是旧语义）：
    · anchor.check（classroom.yaml 第 334 行）
        签署表：chat · phase(except=open)
        现盘　：chat · n_turns(5)

  怎么修（二选一，都不许"把判据放宽"）：
    · 这是**有意**的改动 → 逐条更新上面那张签署表（每块一行），并检查引用同一份语义的别处：
      报告里的逐相位对照表、classroom.yaml 自己的注释、system_core.md 的相位段；然后重跑。
    · 这是**误改** → 还原教室 classroom.yaml。
  🔴 不许删掉或放宽这条判据来变绿 —— 那正是它要防的静默分叉（下一个人会看到一条没人能解释的红测试）。
```

同一镜像里，**F3 是绿的**（推导跟着教室走）——即：这一次**只有**这一条红（汇总：`tests 40 ／ pass 39 ／ fail 1`），且它自己说清了原因与两条修法。
这正是 EXPR5 那轮缺的东西：那次红的是 F3，报错只有"某相位的块集不对"，另一条线得做一组"冻结引擎 vs 现盘教室"的对照实验才定位到成因。

> 补一句"为什么 F3 这次不红"：F3 的期望是**推导**出来的，镜像里教室改了它也跟着改，所以它不会红——
> **"该红的那一条红、不该红的那些不红"**，是本轮与改前最实质的差别。

---

## §3 ③ `runtime/expression.md`：`expression_note` 补一句"记的是请求值"

### 3.1 加了什么（一句话）

`expression_note` 从"只在不可用时出现的一行原因"改成**始终出现**，且**末段固定**是那句：

> **本文件记录的是请求值（实际值由渲染侧夹取后生效）**

它由常量 `EXPRESSION_NOTE_REQUEST_VALUE`〔A11〕单点定义，写入路径在 `renderExpressionState`〔A12〕〔A13〕；
不可用时是"原因 ＋ 分隔符 ＋ 那句"，可用时就是那句本身。文件内的注释块也同步改成"**始终出现**"〔A14〕，
`lib/expressionstore.mjs` 的文件头口径同步补第 ⑤ 条〔A15〕，并新增一条单测钉住它〔A16〕。

🔴 **只加了这一句说明**：**没有**改任何别的字段、**没有**动夹取行为（夹取归渲染侧，不在这棵树里）、**没有**动 `expression_note` 以外的行。

### 3.2 验收：引擎自己的写入路径里，原始输出（逐字）

做法：用引擎自己的 `createExpressionStore` → `specify({expression:'F04'})` → `persist` 真写一份 `runtime/expression.md` 到 `/tmp`（**硬判据**：目标目录不在 `/tmp` 下就拒绝运行），再逐字打印。脚本开头打印了**实际加载的模块路径**与写入目录：

```
实际加载的模块： /private/tmp/fp/note/render-note.mjs
写入目录（隔离判据）： /tmp/fp/note/runtime
DSH_HOME（本脚本不使用它）： /Users/wujunjie/Library/Application Support/dsh-desktop/harness
specify 返回： {"persisted":true,"file":"/tmp/fp/note/runtime/expression.md"}
```

写出来的文件（节选机器可读行与注释里改过的那两句）：

```
expression_path: named-expression
current_expression: F04
expression_face: -
expression_motion: -
expression_origin: teacher
expression_emotion: -
expression_turn: 7
expression_capability: ok
expression_note: 本文件记录的是请求值（实际值由渲染侧夹取后生效）
```

```
   `expression_note`：**始终出现**，给人看的一行说明——前半段是能力发现不可用时的原因（可用时没有这段），末段**固定**是那句「本文件记录的是请求值（实际值由渲染侧夹取后生效）」
     🔴 那句不是废话：**引擎侧不夹取参数值**（权威值域只有渲染侧有）→ 本文件里的是**请求值**，
       最终生效值要问渲染侧（客户端有"夹取账"）。写进文件是为了让读文件的第三方不误判。
```

**一处副作用（如实报）**：客户端面板在"路径为 `-`（引擎判定不可用）"那一支里把 `expression_note` 当**不可用原因**显示，
于是那一支现在会显示"原因 ｜ 本文件记录的是请求值…"。客户端是**只读**的（本轮不碰），这条留进待确认清单 §6 Q2。

---

## §4 验收原始输出

### 4.1 全量单测（`code/plugins/socratic-engine`，逐文件真跑）

```
== test/animation.test.mjs      tests 24  pass 24  fail 0
== test/cast.test.mjs           tests 49  pass 49  fail 0
== test/declaration.test.mjs    tests 14  pass 14  fail 0
== test/dedup.test.mjs          tests 25  pass 25  fail 0
== test/diagram.test.mjs        tests 36  pass 36  fail 0
== test/discovery.test.mjs      tests 42  pass 42  fail 0
== test/expression.test.mjs     tests 62  pass 62  fail 0
== test/injector.test.mjs       tests 12  pass 12  fail 0
== test/lesson.test.mjs         tests 26  pass 26  fail 0
== test/manifest.test.mjs       tests 20  pass 20  fail 0
== test/phase.test.mjs          tests 40  pass 40  fail 0
== test/postclass.test.mjs      tests 36  pass 36  fail 0
== test/prep.test.mjs           tests 26  pass 26  fail 0
== test/section.test.mjs        tests 17  pass 17  fail 0
```

**合计 429 ／ pass 429 ／ fail 0**（改前：426 ／ 425 ／ **1**，见 `实现报告_EXPR5_表情收尾_2026-09-24.md` §5.1）。
新增 3 条测试＝F3b〔A07〕＋推导器自身的守门（见 §4.2 末尾）＋`expression_note` 那条〔A16〕。

> **快照口径（这棵树是共享的）**：上表是 **2026-09-24 17:29:51** 的一次真跑；
> 同一时刻 `index.mjs` 的 mtime 是 16:50（**另一条线在改，不是本轮**），本轮只改 §4.5 列的那 4 个文件。
> 这份数字是**那一刻**的快照，判"谁改了什么"一律用 sha256（不用 mtime）。

### 4.2 变异测试：证明 F3 的推导判据**有牙**（不是自我一致的空转）

把镜像树里 `lib/injector.mjs` 的相位门改成**恒开**（`phaseGate` 第一行直接 `return true`），其余不动：

```
✖ 🔴 F3 cs-os：相位逐相位注入块集（期望值**从教室声明推导**，不再写死一份块集） (9.6175ms)
ℹ tests 40   ℹ pass 35   ℹ fail 5
  AssertionError [ERR_ASSERTION]: 第 1 回合（冷启动） · open 相位：计划器算出的块集 ≠ 从教室声明推导的块集（要么计划器没照声明执行，要么教室声明改了而引擎侧没跟上）
```

→ 计划器一坏，F3 立刻报红（另有 4 条既有相位门单测同时红）。**推导 ≠ 把判据交给被测量的对象**。

**推导器自身的守门也有单测**：喂它一个它不认识的频率模式（`every: weird`）或形状不认识的讲次门 → **抛错**；
认识的语义不得误抛。这一条守的是**未来**：若有人给 schema 加了新模式而计划器没跟上，计划器会静默"永不注入"，
推导器必须当场喊出来（本项目最怕的就是这种静默形态）。

### 4.3 隔离硬判据（另一条线踩过的坑，本轮逐条挡住）

- 本环境 `process.env.DSH_HOME` **本来就指向真 harness**（脚本里实测打印：`/Users/wujunjie/Library/Application Support/dsh-desktop/harness`）
  → 本轮**所有**脚本都不用 `??` 兜底：写盘脚本**开头硬判**目标目录必须在 `/tmp` 下（不在就 `throw` 拒绝运行），
  装载脚本**开头硬判** profile 名/路径/包名（见 §4.4），并一律打印**实际加载的模块路径**与目标目录。
- 首跑实例（诚实记录）：渲染脚本第一次用 `mkdtempSync(os.tmpdir())`，硬判据当场拦下并报
  `🔴 拒绝运行：runtimeDir 不在 /tmp 下（得到 /var/folders/...）` —— 硬判据是**真的在拦**，不是摆设。

### 4.4 装载纪律（隔离测试 profile `socratic-headless`）

装载脚本开头四条硬判据全部通过（原始输出）：

```
== 隔离硬判据全部通过 ==
profile 名        : socratic-headless（不是 web/desktop）
profile realpath  : /Users/wujunjie/Library/Application Support/dsh-desktop/harness/profiles/socratic-headless
profile package   : dsh-profile-socratic-headless
工作区插件 realpath: /Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/plugins/socratic-engine
dsh CLI           : /Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js
pnpm              : .../harness/.desktop-bin/pnpm（10.34.5）
```

- 装载动作：`dsh plugin --profile socratic-headless remove socratic-engine` → `add file:<工作区插件目录>`；
- **`dsh.profile.bundles` 装前＝装后**（`@deepseek-ai/dsh-base`／`@deepseek-ai/dsh-headless`／`socratic-test`／`socratic-engine`）——
  本次**没有**把别的插件踢出列表（这条副作用是历史踩过的坑，故装前装后各核一遍）；
- **逐文件 sha256（只在 `package.json` 的 `files` 白名单内核）**：`SAME=23 DIFF=0 MISSING=0`；
  装前对照是 `SAME=17 DIFF=5 MISSING=1`（已装副本本来就落后于工作区，属别的路的改动，本轮一并补齐）；
- 已装副本里 `@deepseek-ai/*`：**0 个**；`test/`：**没有**（不在白名单，符合预期）；
- 装载后冒烟：`dsh --profile socratic-headless --dump-config` **退出码 0**，且组合出的树里
  `socratic-engine` 层在位（`# == socratic-engine, patched by .../socratic-headless/cordis.patch.yml`）。
  → 没有起真实会话（避免与别的路抢同一工作区的会话写句柄）。

### 4.5 本轮改动的 sha256（判改动一律用哈希，不用 mtime）

| 文件 | sha256 前 16 位 |
|---|---|
| `code/plugins/socratic-engine/test/phase.test.mjs` | `54eab58be93ba6cc` |
| `code/plugins/socratic-engine/lib/expression.mjs` | `2a20ded6bdf8dafc` |
| `code/plugins/socratic-engine/lib/expressionstore.mjs` | `b80cbd9c6dd9f03e` |
| `code/plugins/socratic-engine/test/expression.test.mjs` | `97ee000fdbe157f2` |
| `code/classrooms/cs-os/classroom.yaml`（**只读，未动**） | `a6638e34d441acba` |

---

## §5 未做到项与诚实边界

1. **没有跑真实会话**：③ 的验收走的是"引擎自身的渲染路径"（任务书允许的二选一），没有起 headless 会话——
   理由是避免与别的路抢同一工作区的会话写句柄（本项目踩过 `SessionAlreadyOwnedError`）。因此
   "**模型在真会话里也会看到这句 note**"这一层**没有实测**（它是同一份渲染函数的产物，但我没跑）。
2. **F3b 只覆盖"声明层"**：它比的是**教室声明的规范化文本**，不是"教室内容对不对"。教室把 `except: [open]` 改成 `phases: [check]`
   这类**有意**改动，签署表会红并要求人工确认——这是设计（不是缺陷），但**代价是每次有意的语义改动都要动一次引擎侧**。
3. **没有覆盖 `on_demand` 的"未来接入"**：`every: on_demand` 在引擎里仍是"永不注入"，本轮不动它（属另一条线的范围）。
4. **客户端面板的显示副作用未处理**（见 §3.2）：客户端只读，本轮不碰，列入待确认。
5. **F3 的推导器只覆盖"记账表全空"的两种状态**（第 1 回合 / 第 5 回合）。同会话内切相位、跨回合记账这类时序，
   仍由既有测试（F4、C 组）覆盖，没有并进 F3。

---

## §6 待确认清单

| # | 事项 | 选项 | 我的倾向 |
|---|---|---|---|
| Q1 | F3b 签署表要不要**也覆盖"新增块"**（现在新增块会红，要求把新块补进签署表） | (a) 保持现在这样（新增/改动/删除都红）；(b) 只对"改动/删除"红，新增块放行 | **(a)**：F1 已经钉住"47 块"这个快照，教室加讲本来就要动引擎侧测试；放行新增会让新块**永远不进签署表**，留下一个盲区 |
| Q2 | 客户端面板"不可用原因"那一支现在会显示"原因 ｜ 本文件记录的是请求值…" | (a) 就这样（信息更全）；(b) 让客户端只取分隔符前那段（要改只读的客户端） | **(a)**：本轮不动客户端；若嫌吵，下一轮在客户端侧按分隔符切一刀即可 |
| Q3 | 要不要把 F3b 这套"签署表"推广到**别的教室**（现在只签 `cs-os`） | (a) 只签 cs-os（现状）；(b) 每个教室一份签署表 | **(a)**：目前只有 cs-os 是真教室；等第二个教室落地再抽公共机制，别提前造机制 |
| Q4 | 报告 §1.4 那张逐相位表要不要**回填**进 `实现报告_ALIGN-EXEC3` / `实现报告_M3_state` 的对照表 | (a) 只在本文更正；(b) 回填旧报告 | **(b) 但要用户点头**：旧报告是别的路的产物，回填＝改别人的交付物，需先确认 |
