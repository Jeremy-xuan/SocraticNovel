# 对账表 · cs-os 教室 manifest（classroom.yaml）

> **产出方**：SocraticNovel × DSH 定制线 · 数据子代理 **S4**（数据/格式工作，非插件代码）
> **日期**：2026-09-23
> **产出文件**：
> ① `开源线/DSH定制/code/classrooms/cs-os/classroom.yaml`（新增，21,560 字节）
> ② 本对账表（新增）
> **未改动**：`code/plugins/` 下任何文件（只读）；cs-os 教室任何既有 `.md`（只读，含 `_anchor.md`）
> **格式权威**：`开源线/DSH定制/教室manifest格式_草案_v0.md`（69,106 字节，未通读——先 grep 章节、再局部精读 §2 schema／§2.1–2.6 块字段／§3 示例／§4 逐文件映射／§8 待拍板）
> **校验权威（以它为准）**：`code/plugins/socratic-engine/lib/manifest.mjs`（5,984 字节，只读）

---

## 一、逐文件对账表（33 行，按 `find . -type f | sort` 顺序）

**列义**：
- **字节数** = 实测 `wc -c`（与校验器读入字数逐一核对一致）
- **target / frequency / position** = manifest 里的实际值；`—` = 该文件不在 manifest 中声明为注入块
- **纪律层** = 是否归属「② 纪律层」（贴本轮对话、每轮在場）

| # | 文件路径 | 字节数 | 块名 | target | frequency | position | 纪律层 | 备注 |
|---|---|---|---|---|---|---|---|---|
| 1 | `AGENTS.md` | 7866 | **（不声明）** | — | — | — | — | 🔴 宿主 `agent-instructions` 包已按 `user/message` 注入（L1 §1.5，`index.ts:338-339`）→ 再声明＝双重注入（已有实测报告）。**本文件头注释已写明此口径** |
| 2 | `CLAUDE.md` | 419 | **（不声明）** | — | — | — | — | 别名文件：全文仅一句「完整指令在 AGENTS.md」。宿主候选清单含它（`DEFAULT_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.md','CLAUDE.md']`）→ 交宿主处理，manifest 不重复注入（结论见 §三·B8） |
| 3 | `_anchor.md` | 3405 | `anchor.rules` | chat | `turn` | `depth: 0` | ✅ **是** | 文件自述「每轮上课前读一次，不要只在启动时读一次」＝引擎化后即 `every: turn`。🔴 草案要把它**三拆**（rules / lesson_ban / voice），但校验器是**整文件粒度** → 本 schema 下不可表达（见 §六·P1） |
| 4 | `characters/komari.md` | 6662 | `persona.komari` | system | `once` | `order: 10200` | — | 当课老师人格本体（全 14 讲唯一）。草案要 `after: deployment:persona-prefix`（宿主常量 order=0）→ 校验器无 `after`，改裸 `order`（B6） |
| 5 | `curriculum.md` | 10727 | `curriculum.map` | chat | `phase` | `depth: 4` | — | 🔴 **B3 混合频率**：取「每讲开场注入一次」＝`phase.phases:[open]`。理由与代价见 §三·B3 |
| 6 | `knowledge_points.md` | 8995 | `kp.current` | chat | `phase` | `depth: 2` | — | 既是判据源也是**写回目标**；只在判档（check）与更新（close）相位有意义。开场注入会让模型提前对着清单念 |
| 7 | `materials/ch01.md` | 7975 | `material.current.01` | chat | `phase` | `depth: 2` | — | 教师侧追问脚本（文件头明文「不是给学生念的课文」）→ 只在 `probe`/`check`。🔴 草案通配规则覆盖 ch02–ch14，但**磁盘上不存在**（见 §六·P5） |
| 8 | `runtime/diary.md` | 463 | `state.diary` | chat | `on_demand` | `depth: 0` | — | 每课一条、≤120 字 → 收尾时**写**，不必每轮读。保留草案的 `phase: [close]` 作为「将来若有按需路径时的相位许可」 |
| 9 | `runtime/learner_profile.md` | 1050 | `state.learner` | chat | `n_turns(5)` | `depth: 0` | — | 草案 §4.5 冲突 2 的处置：观察累积型文件，每轮注入浪费 → 与 `_anchor.md` 的「第 5/10/15… 轮」自检同频 |
| 10 | `runtime/mistake_log.md` | 387 | `state.mistakes` | chat | `phase` | `depth: 0` | — | 两处用：open（复习直接问靶子）＋ check（对答案需靶子）。草案 §3 里 `{{last_blocker}}` 的来源 |
| 11 | `runtime/progress.md` | 653 | `state.progress` | chat | `turn` | `depth: 0` | — | 每轮课前必读（AGENTS.md 第一步 2）；它是**相位判定输入**（决定讲次） |
| 12 | `runtime/review_queue.md` | 658 | `state.review` | chat | `phase` | `depth: 0` | — | 文件头「课前必查：今天日期 ≥ 任意一行下次复习日期」→ `open` 相位（决定今天是否进 review 相位） |
| 13 | `runtime/session_archive.md` | 112 | `state.archive` | chat | `on_demand` | `depth: 0` | — | 查更早历史时才读 |
| 14 | `runtime/session_log.md` | 509 | `state.session_log` | chat | `on_demand` | `depth: 0` | — | 回顾历史时才读；引擎不主动注入，position 仅声明「若要注入则贴尾」 |
| 15 | `runtime/wechat_group.md` | 703 | `state.wechat` | chat | `on_demand` | `depth: 0` | — | 生成群聊消息时才需要（「群聊不承载知识点」）|
| 16 | `story/ch01.md` | 8022 | `story.node.01` | chat | `phase` | `depth: 2` | — | 节点说明（**不得当正文念**）→ 只在 `open` 用（开场场景方向 200–500 字）|
| 17 | `story/ch02.md` | 2008 | `story.node.02` | chat | `phase` | `depth: 2` | — | 同上 |
| 18 | `story/ch03.md` | 2050 | `story.node.03` | chat | `phase` | `depth: 2` | — | 同上 |
| 19 | `story/ch04.md` | 1919 | `story.node.04` | chat | `phase` | `depth: 2` | — | 同上 |
| 20 | `story/ch05.md` | 2039 | `story.node.05` | chat | `phase` | `depth: 2` | — | 同上 |
| 21 | `story/ch06.md` | 2110 | `story.node.06` | chat | `phase` | `depth: 2` | — | 同上 |
| 22 | `story/ch07.md` | 1887 | `story.node.07` | chat | `phase` | `depth: 2` | — | 同上 |
| 23 | `story/ch08.md` | 2064 | `story.node.08` | chat | `phase` | `depth: 2` | — | 同上 |
| 24 | `story/ch09.md` | 2414 | `story.node.09` | chat | `phase` | `depth: 2` | — | 同上（第 9 讲是人物弧 Ⅱ→Ⅲ 的转折点）|
| 25 | `story/ch10.md` | 2007 | `story.node.10` | chat | `phase` | `depth: 2` | — | 同上 |
| 26 | `story/ch11.md` | 1979 | `story.node.11` | chat | `phase` | `depth: 2` | — | 同上 |
| 27 | `story/ch12.md` | 2169 | `story.node.12` | chat | `phase` | `depth: 2` | — | 同上 |
| 28 | `story/ch13.md` | 1995 | `story.node.13` | chat | `phase` | `depth: 2` | — | 同上 |
| 29 | `story/ch14.md` | 3488 | `story.node.14` | chat | `phase` | `depth: 2` | — | 同上（人物弧 Ⅲ 收束；正文 `materials/ch14.md` 待写）|
| 30 | `story/overview.md` | 3504 | `story.arc_gate` | chat | `once` | `depth: 0` | — | 🔴 它不是背景资料，是「**不许提前完成**」的约束（第 5 讲前不许她流畅讲完整段）。草案给 `session`，校验器无此值 → 取 `once`（见 §三·B9）|
| 31 | `system_core.md` | 7596 | `teach.system_core` | system | `once` | `order: 10300` | — | 教学法唯一真源（「怎么教」），必须常驻系统段 |
| 32 | `world/metaphor.md` | 9640 | `world.metaphor` | system | `once` | `order: 10500` | — | 隐喻系统。**文件自带红线**：「隐喻只用于建立直觉，正式术语与机制一律以 `materials/ch{NN}.md` 与 OSTEP 原文为准」——草案建议在纪律块复述一行，**本次未复述**（见 §六·P4）|
| 33 | `world/setting.md` | 4067 | `world.setting` | system | `once` | `order: 10400` | — | 场景基线（编辑部 v2）|

**行数核对**：上表 `#1`–`#33` ＝ **33 行**，与 `find . -type f | wc -l` ＝ **33** 一致。

---

## 二、自洽计数（🔴 与上表实际行数逐项核对）

### 2.1 按「是否声明为注入块」

| 类别 | 数量 | 行号 | 核对 |
|---|---|---|---|
| 声明为块 | **31** | #3–#33（共 31 行） | 31 = 33 − 2 ✅ |
| 未声明（宿主注入） | **2** | #1 `AGENTS.md`、#2 `CLAUDE.md` | 2 ✅ |
| **合计** | **33** | | ✅ |

### 2.2 按 target（31 个块）

| target | 数量 | 块 |
|---|---|---|
| `system` | **4** | persona.komari、teach.system_core、world.setting、world.metaphor |
| `chat` | **27** | 其余全部 |
| **合计** | **31** | ✅ |

### 2.3 按 frequency（31 个块）

| frequency | 数量 | 块 |
|---|---|---|
| `once` | **5** | 4 个 system 块 ＋ `story.arc_gate` |
| `turn` | **2** | `anchor.rules`、`state.progress` |
| `n_turns(5)` | **1** | `state.learner` |
| `phase` | **19** | `curriculum.map`、`kp.current`、`story.node.01–14`(14)、`material.current.01`、`state.mistakes`、`state.review` ＝ 1+1+14+1+1+1 |
| `on_demand` | **4** | `state.session_log`、`state.archive`、`state.diary`、`state.wechat` |
| **合计** | **31** | 5+2+1+19+4 = **31** ✅ |

> **一句话版**：33 个文件 ＝ **31 个声明块**（5 个 once ＋ 2 个 turn ＋ 1 个 n_turns ＋ 19 个 phase ＋ 4 个 on_demand）＋ **2 个不声明**（`AGENTS.md`／`CLAUDE.md`，由宿主注入）。

### 2.4 按 layer（31 个块）

| layer | 数量 | 说明 |
|---|---|---|
| `persona` | **1** | `persona.komari` |
| `discipline` | **1** | `anchor.rules` |
| `context` | **21** | 4 system 块中的 3 个 ＋ 18 个 chat 情境块 |
| `state` | **8** | 全部 `runtime/` |
| `anchor` | **0** | ⚠️ 校验器值域含 `anchor`，但本 manifest 未使用（草案 §4.1 原拟给「每 5 轮自检」，因整文件粒度不可拆，已并入 `anchor.rules`） |
| **合计** | **31** | ✅ |

### 2.5 按相位门（31 个块）

| 相位门 | 数量 |
|---|---|
| （无相位门） | **11** |
| `open` | **16** |
| `check+close` | **1** |
| `probe+check` | **1** |
| `open+check` | **1** |
| `close` | **1** |
| **合计** | **31** ✅ |

### 2.6 字节数自洽

> 🔴 **算法与口径（本项一度算错，在此写清以免再错）**：
> 数字基准是**「33 个既有文件（不含本次新增的 `classroom.yaml`）」**。
> 因为 `classroom.yaml` 本身就是教室包里的第 34 个文件，若直接 `find . -type f | wc -c`，
> 会把 manifest 自身算进去，得到 133,102（＝111,542 ＋ 21,560）——**那是错的算法**。
> 正确命令：`find . -type f ! -name classroom.yaml -exec wc -c {} + | tail -1`。

| 项 | 值 |
|---|---|
| **33 个既有文件合计字节** | **111,542** |
| 2 个未声明文件字节合计 | **8,285**（`AGENTS.md` 7,866 ＋ `CLAUDE.md` 419） |
| 31 个声明块对应的文件字节合计 | **103,257** |
| 核对 | 103,257 ＋ 8,285 ＝ **111,542** ✅ |
| 独立复核（逐块累加） | 校验器「逐块清单」末列 31 个数字累加 ＝ 103,257，与上式一致 ✅ |

---

## 三、B 组口径落地说明（B1–B7 ＋ 附加的 AGENTS.md／CLAUDE.md 条）

| 项 | 口径（用户已拍板） | **实际怎么落的** | 落点 |
|---|---|---|---|
| **B1** | manifest 形态＝**单文件 `classroom.yaml`** | ✅ 落了单文件。**未用**每文件 frontmatter——理由：单文件是唯一真源，四卡式跨 33 文件的 frontmatter 会让"某文件没写元数据"变成静默缺口 | `code/classrooms/cs-os/classroom.yaml`（新建，唯一新增数据文件）|
| **B2** | `render.missing` 默认行为＝**保留原样＋记 missing**（不是 error） | ✅ 与引擎现状一致：`lib/injector.mjs::renderText` 已是「缺变量保留原样并记 missing」（原文：`missing.push(key); return \`{{${key}}}\``）。**但本 manifest 所有块写 `render: {enabled: false}`**——因为① cs-os 的 33 个文件里 **`{{var}}` 占位符实测 0 处**（`grep -rn '{{' .` 无命中），② 校验器 `normalizeBlock` **不解析 `render.vars`**（只取 `render.enabled`），写了也不生效 | yaml 里 31 个块的 `render` 字段；证据见 §五（grep 留痕）|
| **B3** | 混合频率（`curriculum.md` 既"按需"又"每讲必读"）→ 给明确标法并说明理由 | ✅ 标法：**`frequency: {every: phase}` ＋ `phase: {phases: [open]}`** ＝「每讲开场注入一次」。**理由三条**：① `frequency` 是单值字段，「ondemand ＋ 条件强制」这种复合规则在本 schema 下**不可表达**；② 两半之中必须取「每讲必读」那一半——因为引擎骨架的 `on_demand` 是**永不注入**（`injector.mjs`：`inject = false // TODO：M3 工具接入`），标 on_demand 会让 139 行的课程表在课上根本不出现；③ 不能退成每轮——草案 §4.5 冲突 5 明说 `n_turns: n=1` 是「浪费」的退路，10727 字节每轮注入不可接受。**标「推断/待确认」**（草案倾向「保留混合」，本条是它在校验器值域内的最近表达） | `curriculum.map` 块 |
| **B4** | `layer` 字段**保留**（引擎暂不消费） | ✅ 31 个块全部写了 `layer`，且取校验器 `LAYERS = ['persona','discipline','context','state','anchor']` 之内的值。🔴 **注意**：草案 §2.6／§4 写的层名（`resident`／`startup`／`①常驻`／`①′启动`）**不在校验器值域内**，硬写会抛 `layer 必须是 …`。映射：草案「① 常驻」→ `persona`（仅人格本体）／其余非纪律非状态块 → `context`（含草案的「①′ 启动层」system_core 与 world/*） | 全部 31 块 |
| **B5** | `wrap.header` 是否默认输出 → 按草案倾向定，标「推断/待确认」 | ✅ **不输出**。草案 §2.5 倾向原文：「header 会消耗 token，且模型可能把来源标注当内容读 → **建议只在 debug 模式输出**」→ 照它落，**且本 manifest 根本不写 `header` 字段**（校验器 `normalizeBlock` 只取 `wrap.style` 与 `wrap.tag`，`header`/`role` 均不透传；`role` 被引擎硬编码为 `'user'`）。**标「推断/待确认」** | 27 个 chat 块只写 `wrap: {style: system-reminder}` |
| **B6** | 位置用 `after` 锚点 vs 裸 `order` → 按草案倾向定，并在对账表写明用了哪种 | ✅ **本次用的是裸 `order`**（4 个 system 块：10200／10300／10400／10500）。**这不是选项 B，是被迫的**：草案 §2.1 明确「**优先用 `after`**」，但 `lib/manifest.mjs` 实现在 `target=system` 分支里**只接受 `order`**，且第 96 行**显式把 `depth` 判错**；`after`／`section_name` 两个字段**在校验器里完全不存在**（无读取、无校验、无透传）→ 写了会被静默忽略（`normalizeBlock` 只挑已知键重建对象，未知键不进返回值）。🔴 **副作用**：草案 §2.1 想用 `after` 规避的「写死数字把教室包钉在宿主版本上」这一风险**本次无法规避**；且校验器对 order 的**唯一约束是 `Number.isFinite`**（不查重复、不查区间），所以撞号风险没有任何工具护栏 | 4 个 system 块（见 §六·P8）|
| **B7** | `advance_on` **只作提示文本**，不做可执行条件 | ✅ **本 manifest 完全不写 `advance_on`**。依据：① 校验器 `normalizeBlock` 的 `phase` 分支只取 `phases` 与 `except`，`advance_on` 不透传 → 写了等于没写；② 口径要求「不要写成会被引擎执行的条件表达式」——不写是满足该条的最强形式。相位推进条件（如「学生说出了核心结论」）目前只存在于 `system_core.md`／`_anchor.md` 的**自然语言纪律**里，未进入 manifest | 无（0 处）|
| **附·AGENTS.md** | manifest 不声明（宿主每回合自注入，声明会双重注入） | ✅ **未声明为块**；并在 `classroom.yaml` 文件头注释里写明了这一点（三行，含证据来源） | yaml 头注释＋ §六·P2 |
| **附·CLAUDE.md** | 给结论并说明依据（读它内容判断） | ✅ **结论：同样不声明为块。** 依据：读全文（419 B，9 行）后确认它**不是内容文件，是别名指针**——正文只有一句「本教室的完整指令在 AGENTS.md —— 请先完整读它」，外加对 AGENTS.md 内容的复述目录。而宿主注入候选清单**同时含这两个文件名**（L1 §1.5：`DEFAULT_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.md', 'CLAUDE.md']`）→ ① 若宿主两个都注入，声明它＝第三重；② 即使宿主只注入 AGENTS.md，这份 419 B 也没有任何 manifest 能表达的新内容。**另**：本次实测已确证宿主**确实会**把 CLAUDE.md 当指令文件注入（本会话的 system-reminder 里同时出现了 AGENTS.md 与 CLAUDE.md 两段「Additional instructions from」）→ 该事实**回答了草案 §8 的 A2 待确认**（见 §六·A2） | yaml 头注释＋ §六·A2 |

---

## 四、纪律层字节数实测

| 项 | 值 |
|---|---|
| 文件 | `_anchor.md` |
| **实测字节数** | **3,405 字节** |
| 草案/架构规定的 ② 纪律层体量上限 | **≤1KB**（草案 §4.1 引《角色扮演架构》§3 表：「② 纪律层｜位置：历史之后（贴本轮对话，≈Depth 0）｜频率：每轮｜**体量 ≤1KB**」） |
| **是否 ≤1KB** | ❌ **超出 3.33 倍**（3,405 ÷ 1,024 ≈ 3.33） |
| 处置 | 🔴 **只报告，未改文件**（纪律：不得修改 cs-os 任何既有 `.md`；该三拆是待拍板项 C1／C2） |
| 附：草案给出的解法 | 把「角色声音速查」段拆出、提为 ① 常驻层（草案 §4.1 估算该段约 0.4KB）→ 拆后 ② 回到 ≈1KB 内。**本 schema 做不到**（整文件粒度，见 §六·P1） |

> **补充实测**：`_anchor.md` 的三个 `##` 段（教学取向／本课不许违反项／角色声音速查）＋结尾的「教学检查」段，频率各不相同，但**在校验器下只能整文件出一个块**（`anchor.rules`，`every: turn`）。这是本次 manifest 化**暴露出的最实质的一处架构冲突**。

---

## 五、校验器输出（完整贴）

**复现命令**（不改校验器；临时脚本在项目 `tmp/` 下，不属插件目录）：

```bash
cd /Users/wujunjie/Documents/ChatGPT/大学申请
/opt/homebrew/bin/node tmp/s4_validate.mjs
```

**脚本做的事**：`readFileSync` 读 `classroom.yaml` → `await import(.../lib/manifest.mjs)` →
`parseManifest(text, { baseDir: <教室目录> })` → 打印规范化结果、逐块清单、
自洽核对（manifest 声明的 path 集合 vs 磁盘 `.md` 集合）。**未修改校验器任何一行。**

```text
== s4_validate ==
node        : v25.9.0
yaml (plugin dep) version: 2.9.1
validator   : /Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/plugins/socratic-engine/lib/manifest.mjs
MANIFEST_FILENAME / FORMAT / LAYERS / TARGETS / FREQ / WRAP
   {"MANIFEST_FILENAME":"classroom.yaml","MANIFEST_FORMAT":"socratic-classroom/0","LAYERS":["persona","discipline","context","state","anchor"],"POSITION_TARGETS":["system","chat"],"FREQUENCY_MODES":["once","turn","n_turns","phase","on_demand"],"WRAP_STYLES":["none","system-reminder"]}
manifest    : /Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/classrooms/cs-os/classroom.yaml

读取 21560 字节

✅ parseManifest 通过（无异常）

format      : socratic-classroom/0
classroom   : {"id":"cs-os","title":"计算机系教室 · 操作系统","subject":"操作系统","lessons":14,"classroom_version":"0.1.0","license":"CC-BY-NC-SA-4.0"}
blocks 总数 : 31
按 target   : {"system":4,"chat":27}
按 frequency: {"once":5,"turn":2,"phase":19,"n_turns":1,"on_demand":4}
按 layer    : {"persona":1,"context":21,"discipline":1,"state":8}
按相位门    : {"(无相位门)":11,"open":16,"check+close":1,"probe+check":1,"open+check":1,"close":1}

── 逐块清单（33 行 = 每个 cs-os 文件一行）──────────────
#	block.id	source	layer	target	pos	freq	phase	bytes
1	persona.komari	characters/komari.md	persona	system	order=10200	once	-	6662
2	teach.system_core	system_core.md	context	system	order=10300	once	-	7596
3	world.setting	world/setting.md	context	system	order=10400	once	-	4067
4	world.metaphor	world/metaphor.md	context	system	order=10500	once	-	9640
5	anchor.rules	_anchor.md	discipline	chat	depth=0	turn	-	3405
6	story.arc_gate	story/overview.md	context	chat	depth=0	once	-	3504
7	curriculum.map	curriculum.md	context	chat	depth=4	phase	open	10727
8	kp.current	knowledge_points.md	context	chat	depth=2	phase	check+close	8995
9	story.node.01	story/ch01.md	context	chat	depth=2	phase	open	8022
10	story.node.02	story/ch02.md	context	chat	depth=2	phase	open	2008
11	story.node.03	story/ch03.md	context	chat	depth=2	phase	open	2050
12	story.node.04	story/ch04.md	context	chat	depth=2	phase	open	1919
13	story.node.05	story/ch05.md	context	chat	depth=2	phase	open	2039
14	story.node.06	story/ch06.md	context	chat	depth=2	phase	open	2110
15	story.node.07	story/ch07.md	context	chat	depth=2	phase	open	1887
16	story.node.08	story/ch08.md	context	chat	depth=2	phase	open	2064
17	story.node.09	story/ch09.md	context	chat	depth=2	phase	open	2414
18	story.node.10	story/ch10.md	context	chat	depth=2	phase	open	2007
19	story.node.11	story/ch11.md	context	chat	depth=2	phase	open	1979
20	story.node.12	story/ch12.md	context	chat	depth=2	phase	open	2169
21	story.node.13	story/ch13.md	context	chat	depth=2	phase	open	1995
22	story.node.14	story/ch14.md	context	chat	depth=2	phase	open	3488
23	material.current.01	materials/ch01.md	context	chat	depth=2	phase	probe+check	7975
24	state.progress	runtime/progress.md	state	chat	depth=0	turn	-	653
25	state.learner	runtime/learner_profile.md	state	chat	depth=0	n_turns(5)	-	1050
26	state.mistakes	runtime/mistake_log.md	state	chat	depth=0	phase	open+check	387
27	state.review	runtime/review_queue.md	state	chat	depth=0	phase	open	658
28	state.session_log	runtime/session_log.md	state	chat	depth=0	on_demand	-	509
29	state.archive	runtime/session_archive.md	state	chat	depth=0	on_demand	-	112
30	state.diary	runtime/diary.md	state	chat	depth=0	on_demand	close	463
31	state.wechat	runtime/wechat_group.md	state	chat	depth=0	on_demand	-	703

── 自洽核对 ──
磁盘 .md 文件数        : 33
manifest 声明的 path 数: 31
未声明为块的（应为 2） : 2 ["AGENTS.md","CLAUDE.md"]
声明了但磁盘没有的     : 0 []
校验器返回块数         : 31

自洽判定：磁盘 33 文件 − 2（AGENTS.md/CLAUDE.md 由宿主注入） = 31，实际块 31 → ✅ 一致
[exit 0]
```

**结论：✅ 一次通过（exit 0），无 YAML 语法错误、无必填缺失、无值域越界、无 path 读失败。**
（脚本头部那行 `yaml (plugin dep) version: 2.9.1` 是插件自身依赖 `yaml` 的版本留痕，
`lib/manifest.mjs` 用它做 `parse`。）

### 5.1 顺带取证（本次实测得到的两个事实，供 P1 使用）

| 事实 | 证据 |
|---|---|
| cs-os 全部 33 个文件里 **`{{var}}` 占位符 0 处** | `grep -rn '{{' .` → 无输出，exit 1 |
| cs-os 全部 33 个文件里 `{NN}` 字面占位（如 `materials/ch{NN}.md`）**存在于 7 个文件**：`world/metaphor.md`、`_anchor.md`、`system_core.md`、`curriculum.md`、`knowledge_points.md`、`AGENTS.md`、`story/overview.md` | `grep -rl 'ch{NN}' .`。⚠️ 这意味着**引擎若真按 `path` 注入这 7 个文件，`{NN}` 会原样进 prompt**（不是「第 1 讲」，而是字面 `ch{NN}`）；本 manifest 的 `render.enabled: false` 不解决它——因为 `{{var}}` 语法与 `{NN}` 语法**不通**（见 §六·P6）|

---

## 六、待确认清单

> **口径**：以下每条都**已按默认处理并落盘**，不影响 `classroom.yaml` 通过校验。按「会不会让教室跑不起来」排序。标「未取证」者是我查不到的，不是我猜的。

### P0 · 会让课程在引擎下空转（建议 P1 侧先对齐再做实测）

| # | 问题 | 证据 | 我的倾向 |
|---|---|---|---|
| **P0-1** | 🔴 **相位 id 两套不一致**：本 manifest 用草案的 `open/probe/answer/check/review/close`，而引擎骨架 `lib/phasestore.mjs` 的枚举是 `['boot','lecture','quiz','answer','review','wrapup']`，默认相位 `'boot'` | `phasestore.mjs`：`export const PHASES = ['boot','lecture','quiz','answer','review','wrapup']`；`index.mjs`：`createPhaseStore(config.defaultPhase ?? 'boot')` | **P1 侧把 PHASES 改成草案 6 相位**（草案 §2.0 已声明「相位是教学内容的一部分，写进数据侧才符合引擎×内容分离」）。**在改之前，本 manifest 的 19 个 phase 块（含全部 14 个 story 块）一个都不会注入**，`open`／`probe`／`check`／`close` 全不匹配。这是**当前唯一「装上也上不了课」的阻塞项** |
| **P0-2** | **`once` 语义在引擎里是「进程生命周期内一次」**，不是草案说的「每讲读一次」：`injector.mjs` 用 `state.injectedOnce` 这个**永不重置**的 Set | `injector.mjs`：`if (every === 'once') { inject = !state.injectedOnce.has(block.id) }`；`if (every === 'once') state.injectedOnce.add(block.id)` | 草案 §2.2 想要 `anchor: lesson_start` 这一档。**影响本 manifest 的 5 个 once 块中的 `story.arc_gate`**（它每会话一次即可，影响小）；4 个 system 块不受影响（它们走 `systemPrompt.section` 注册路径，不经 injector）。**倾向**：`story.arc_gate` 保持 `once`，P1 侧若加 `lesson_start` 再改 |

### P1 · 格式表达力缺口（草案写了、校验器不支持 → 本次未写入 yaml）

| # | 草案字段／机制 | 校验器实际 | 影响 | 我的倾向 |
|---|---|---|---|---|
| **P1-1** | 🔴 **段级切片**：草案 §4.1 把 `_anchor.md` **三拆**（`anchor.rules` 每轮／`anchor.lesson_ban` 每轮＋每讲变／`anchor.voice` once 提到常驻层） | `normalizeBlock` 的 `path` 走 `readFileSync(resolve(baseDir, raw.path))` **整文件全文**，无 `#section`／行范围语法 | 本 manifest 只能出 **1 个 `anchor.rules`** → ① 纪律层实测 3,405 B（超 ≤1KB 纪律 3.33 倍）；② 「角色声音速查」无法提到系统段 once，跟着每轮注入 | 格式侧加 `path#<heading>` 或 `lines: [a,b]`；或**改真实文件**（草案 C2，需用户拍板，本次禁止改 `.md`） |
| **P1-2** | 🔴 **`{NN}` 章节通配**：草案 §4.3 用**一条**规则覆盖 `story/ch{NN}.md`（14 文件）与 `materials/ch{NN}.md` | `path` 必须是**存在的字面量**文件；无 `{NN}` 展开 | 本次**展开为 14 条 `story.node.01–14`**（可接受，但加讲＝改 yaml） | 引擎加 `path_template` ＋ 由 `lesson_no` 解析；v0 保持展开（数据明确、校验器零改动）|
| **P1-3** | `source: null` 的**纯模板块**（草案 §3 `state.turn_context`） | 校验器允许 `text`（与 `path` 二选一）→ **技术上可表达** | cs-os 无此需求（`{{}}` 零命中），故本 manifest **未用** | 保持现状；等有真实需求再用 |

### P2 · 字段级缺口（逐条：草案有／校验器无）

| # | 草案字段 | 校验器 | 处置 |
|---|---|---|---|
| **P2-1** | `position.after`（相对锚点，**草案明确「优先用」**） | **不存在**（system 分支只读 `order`） | 本次用裸 `order`（B6）；见 §三·B6 的副作用说明 |
| **P2-2** | `position.section_name` | **不存在**（引擎自己拼 `socratic-engine:${block.id}`） | 未写。引擎已自带命名空间前缀，**不会撞宿主段名**，这点比草案担心的更好 |
| **P2-3** | `frequency.every: session` | **值域无**（`once/turn/n_turns/phase/on_demand`） | `story.arc_gate` 取 `once`（B9 变体，见 §三·B6 表末） |
| **P2-4** | `frequency.anchor: lesson_start` | **不存在** | 未写（与 P0-2 同源） |
| **P2-5** | `frequency.phase: [...]`（every=phase 时的相位表） | **不存在**（相位门走独立的 `phase.phases`） | 简化：`every: phase` ＋ `phase: {phases: [...]}`。**语义等价**，但草案的「一处声明」变成「两处」，**有分叉风险**（改一处忘另一处） |
| **P2-6** | `render.vars`（变量定义） | **不解析**（只取 `render.enabled`） | 未写；全部块 `render.enabled: false`（`{{}}` 零命中，无需渲染） |
| **P2-7** | `render.missing` / `render.default` | **不解析** | 未写（B2 口径由 injector 的现状行为兑现） |
| **P2-8** | `wrap.header` | **不解析**（只取 `style`／`tag`） | 未写（B5，照草案「只在 debug 输出」倾向） |
| **P2-9** | `wrap.role` | **不解析**，引擎**硬编码 `'user'`** | 未写（与草案「v0 只允许 user」一致） |
| **P2-10** | `phase.advance_on` | **不解析** | 未写（B7） |
| **P2-11** | `source` / `name` / `purpose` / `notes` / `tags` / `depends_on` / `source_sha256` | **全部不解析**（`normalizeBlock` 只返回 `{id,layer,text,position,frequency,phase,wrap,render,source}`，`source` 由 `raw.path` 反填） | 全部未写。🔴 **代价**：草案 §2.6 说的「人读用途」——`name`（`领域 :: 主题` 命名法）、`purpose`、`depends_on`（注入顺序关系）**在这次 manifest 里完全没有落点**，可追溯性靠我写在 yaml 里的注释补足 |
| **P2-12** | `layer` 值域：草案写 `resident\|startup\|discipline\|context\|state\|anchor` | 校验器 `LAYERS = ['persona','discipline','context','state','anchor']`（**`resident`/`startup` 不在，多了 `persona`**） | 已按校验器值域映射（B4）。见 §三·B4 |

### P3 · 需用户拍板（非 P1 实现问题）

| # | 问题 | 选项 | 我的倾向 |
|---|---|---|---|
| **P3-1** | `_anchor.md` 超 ≤1KB 纪律 3.33 倍（实测 3,405 B） | (a) 改真实文件、把「角色声音速查」段移出（草案 C2）｜(b) 格式加段切片（P1-1）｜(c) 接受超限 | **(a) 或 (b)**，本次只报告不改（纪律禁止改既有 `.md`） |
| **P3-2** | `world/metaphor.md` 的红线（「隐喻只用于建立直觉，术语与机制以教材/OSTEP 为准」）**是否要在纪律块复述一行**？ | (a) 复述（草案 §4.2 建议）｜(b) 不复述（避免跨块内容重复） | **(b) 本次未复述**：该红线已在 `world/metaphor.md` 自身（system 段 once，全程在场），且 `_anchor.md` 的「本课不许违反项」已有「本讲核心事实必须以 `materials/ch{NN}.md` 与 OSTEP 原文为准」——**已覆盖同一约束**，复述＝第三份同义内容 |
| **P3-3** | `materials/ch02–ch14` 尚未写（磁盘仅 `ch01.md`） | 到齐后按 `material.current.01` 同款追加 13 块 | 保持「只声明已存在的文件」；**校验器对缺失 path 是硬抛错**（`读 … 失败`），不能提前声明 |
| **P3-4** | `runtime/` 8 文件的**写回侧**（课后更新目标）在 manifest 中**无字段可表达** | (a) 保持只表达「读/注入」侧，写回由 P1 的课后更新路径硬编码｜(b) 格式加 `writable: true` 之类标记 | **(a)**：草案也没有对应字段，硬造一个字段会违反「不写校验器不支持的字段」的本次纪律 |

### A 类 · 顺带回答草案 §8 的既有待确认（本次实测取证）

| 草案编号 | 本次是否取证 | 结论 |
|---|---|---|
| **A1**（AGENTS.md 是否双重注入？） | ✅ 已被既有实测确认（`实测报告_双重注入与回合语义_2026-09-23.md`），本次在文件头照此口径落 | **manifest 不声明 AGENTS.md**。草案 §8 A1 的「最大影响面」项 → 已闭合 |
| **A2**（宿主是否 AGENTS.md ＋ CLAUDE.md 都注入？） | ✅ **本次实测确证：都注入。** 本会话的 system-reminder 段落里**同时**出现 `Additional instructions from: …cs-os/AGENTS.md` 与 `Additional instructions from: …cs-os/CLAUDE.md` 两段 | **两者都不在 manifest 声明**（口径见 §三·附）|
| **A3**（`pre-step` 的 `turn` 是「即将开启」还是「刚结束」？） | ❌ 未取证 | 引擎 `phasestore.mjs` 已按「自维护计数器、不用宿主 turn 号」规避 → 与本 manifest 无关 |
| **A4**（depth 注入与宿主插件抢位置？） | ❌ 未取证 | 属 P1 实现；本 manifest 只声明 depth 语义（草案口径） |
| **C4**（cs-os 实测 33 而非 32 文件） | ✅ 本次复核：`find . -type f \| wc -l` ＝ **33** | 与草案 §4.6 一致，确认草案的更正成立 |

---

## 七、S4 自报边界

| 项 | 内容 |
|---|---|
| **新增文件** | ① `code/classrooms/cs-os/classroom.yaml`（21,560 B）② 本对账表 ③ `tmp/s4_validate.mjs`（临时校验脚本，可删） |
| **修改的既有文件** | **0 个**。`code/plugins/` 下任何文件未改（只读 `lib/manifest.mjs`／`lib/injector.mjs`／`lib/phasestore.mjs`／`index.mjs`／fixture）；cs-os 任何 `.md` 未改（含 3,405 B 的 `_anchor.md`） |
| **未做** | 未写任何插件代码；未 git commit／push；未碰 `~/SocraticNovel-wt`／`~/SocraticNovel-GitHub仓库`／DSH app 与 profile |
| **读入方式** | 草案 69,106 B **未通读**：先 grep 章节标题（830 行全文的 `^#{1,4}`），再局部读 §2 全节（112–351）、§3–§4.6（352–581）、§8–§9（751–830）。cs-os 文件按 `wc -c` 排布，>6KB 者（`curriculum.md`／`knowledge_points.md`／`system_core.md`／`metaphor.md`／`ch01.md`／`AGENTS.md`）只读头部与 `##` 结构；`runtime/` 8 文件全部为 ≤1KB 状态文件，已全文读 |
| **未取证项** | 草案 §8 的 A3／A4（已标注） |
