# 实现报告 · ANIM-PREP-ENABLE —— 让"备课"和"模板工具"在真教室里真的被用起来

> 任务代号：**ANIM-PREP-ENABLE**（把 ANIM-PREP 的引擎能力接到**真教室内容**上：① `prep:` 声明 ② 渠道纪律）
> 日期：**2026-09-24**（CST）｜工作区：`/Users/wujunjie/Documents/ChatGPT/大学申请`
> 上游：`开源线/DSH定制/实现报告_ANIM-PREP_备课与模板化_2026-09-24.md`（引擎侧已实现模板工具／课前预热／缓存／失败退）
> 上游自报的缺口（本批要补的两处）：**真教室没有 `prep:` 声明，也没有提模板工具的渠道纪律 → 生产里这些工具一次都不会被用**
> 改动范围：**只写 `code/classrooms/cs-os/**`（3 个文件）＋ `code/skills/socratic-classroom/classroom/**`（同源同步副本）＋本报告**
> 🔴 未碰：`code/plugins/**`（只读）、`code/clients/**`、`code/tools/**`（只读）、`code/acceptance/**`、`~/SocraticNovel-wt/`、`~/SocraticNovel-GitHub仓库/`、`/Applications/DSH Desktop.app`、任何 profile。

---

## 0. 一句话结论（先给）

> **1. 两处都补上了，而且是"真教材图元"不是占位。**
> 教室顶层新增 `prep:` 段〔A01〕，**5 条**，覆盖**已有的全部 3 个模板**（`timeline`／`state_machine`／`bar_compare`）、**4 个讲次**（第 1／2／3／9 讲）；
> 每条的 `material` 都指向**真实教材文件**（缓存键的来源），每条都能在教材里找到出处。
> 渠道纪律写进 `_anchor.md`「本课不许违反项」〔A08〕＋ `system_core.md`〔A09〕（照既有"两处都写"的口径），
> 把**三条渠道与四级优先级**写死，且与引擎注入的动画纪律段**逐条对齐**（§3.3）。
>
> **2. 预热实测：5 段全部 ready、闸门全 PASS、起任务 23 ms、模型调用 0。**
> 逐段渲染 1.48–1.92 s（`-ql`）；4 讲依次预热，全部终态共等 **28.2 s**；产物落在副本的 `runtime/animations/<taskId>/`。
> 目视核对 5 帧：时间轴／状态机推移／条形对比**画面与教材数字逐条对得上**（§2.3）。
>
> **3. 🔴 真会话跑了 4 次：2 次走了模板工具，且都先用 `prepId` 命中课前预热（引擎逐字回"✅ 命中课前预热缓存（0 秒）"）。**
> · **C／D 两次**（点位落在"随时间变化的机制"上）→ 老师调了 `classroom_animate_template`，**入参就是 `{"prepId":"…"}`**，**0 秒命中、盘上不新增任务目录**；
>   D 那一次还在 prepId 之后**自己用 `template` + `params` 起了第二段**（走的是渠道③）。
> · **A／B 两次**（点位是概念性追问）→ 老师**只用了 `classroom_draw`**，一次动画工具都没调。
>   🔴 **这不是"纪律没生效"**：按纪律自己的第 ① 级，那两个点位要的是**静止结构图**，`classroom_draw` **就是正确渠道**（§4.4 有逐次分析）。
> · 所以"老师真会用模板工具"这个问题的答案是：**会——当这一步要讲的是"怎么一步步走"时**；而要讲"结构长什么样"时它仍走白板图，这与纪律写的一致。
>
> **4. 全量单测 383 / 383 全绿**（基线 380；另 3 个是另一条工作线新增的）。
> 首轮跑出 1 个红（`test/expression.test.mjs`）——**那是另一路正在改的文件**，**重跑即全绿**，归属判断见 §4.3。
>
> **5. 纪律里必须点出工具名**（判断与理由见 §5）：本项目已有实证"引擎挂上工具 ≠ 老师会用"，而纪律层是模型每轮都会重读的位置。

---

## 1. ① 在教室加 `prep:` 声明（真实教材场景）

### 1.1 逐条清单

写进 `code/classrooms/cs-os/classroom.yaml` 顶层（`animation:` 之后、`phases:` 之前）〔A01〕；
**形状严格照引擎的实现**（`lib/prep.mjs` 的文件头注释就是契约〔A10〕：`id` / `lesson` / `template` / `title` / `material` 必填，
`caption` / `required` 可选，多写一个键即报错）。

| # | `id` | 讲次 | 模板 | 标题（人话） | `material`（真实教材路径） | caption | required |
|---|---|---|---|---|---|---|---|
| 1 | `ctx-switch` 〔A03〕 | 1 | `timeline` | 两个进程轮流用 CPU（上下文切换） | `materials/ch01.md` | 针对「切走时为什么要保存执行位置与寄存器」这一步 | true |
| 2 | `proc-lifecycle` 〔A04〕 | 2 | `state_machine` | 子进程退出之后为什么还留着（僵尸 → 回收） | `materials/ch02.md` | 针对「僵尸进程不是 bug，是父进程还没来取件」这一步 | true |
| 3 | `fifo-vs-sjf` 〔A05〕 | 3 | `timeline` | 长任务怎么把后面的短任务全堵住 | `materials/ch03.md` | 同一批任务、同一套数字，只换调度顺序（示例数据，按题设假设算出） | true |
| 4 | `avg-turnaround` 〔A06〕 | 3 | `bar_compare` | 平均周转时间与平均响应时间：FIFO vs SJF | `materials/ch03.md` | 针对「同样的任务、同样的总工作量，只换了顺序」这一步 | **false** |
| 5 | `race-interleaving` 〔A07〕 | 9 | `timeline` | 两个线程交错执行，加两次只加了一次 | `materials/ch09.md` | 针对「counter++ 不是原子的」这一步 | true |

### 1.2 每条的教材出处（为什么它不是占位）

| 条目 | 教材原句（逐字） |
|---|---|
| `ctx-switch` | `materials/ch01.md`「片段一 · 切换后怎样接着跑」：*"切走时保存执行位置与寄存器等状态，切回来时恢复；这就是上下文切换的核心。"* 以及该讲示意写法 *"A 执行 → 存 A 的状态 → 恢复 B 的状态 → B 执行"* |
| `proc-lifecycle` | `materials/ch02.md`「片段三 · `wait` 与退出状态」：*"子进程已经结束、父进程还没取走状态时，内核仍要保留一小份记录——这个状态下的进程叫僵尸进程（zombie）……父进程取走后，记录才被释放。"* |
| `fifo-vs-sjf` | `materials/ch03.md`「值得学生推导的关键关口」第 1 段：三个任务 0 时刻到达、A 需 100、B/C 各需 10；FIFO 完成时刻 100/110/120（平均 **110**），B→C→A 是 10/20/120（平均 **50**） |
| `avg-turnaround` | 同一段给出的另一组数：平均响应时间 FIFO **(0+100+110)/3 = 70**、B→C→A **(0+10+20)/3 = 10**。→ 四根条＝两个指标 × 两种顺序，全部是教材里算过的数 |
| `race-interleaving` | `materials/ch09.md`：*"可以让学生自己在白板上把这两条时间线画出来：线程 A 读到 0 → 线程 B 也读到 0 → A 写 1 → B 写 1。加了两次数，结果只加了一次。"* |

🔴 **两处如实说明**：
1. `proc-lifecycle` 的三个状态名里，**「僵尸」「已回收」是教材逐字**；「运行」是那一节上下文里子进程在退出前的状态，
   **教材没有把它写成一张三态图**——这一条是**把教材叙述画成推移**，不是教材原文就有的图。【推断】
2. `avg-turnaround` 做成**四根条（两个指标同一张图）**是我的选择；教材明确写过"这组数**看不出**两个指标的冲突（冲突要等引入轮转）"，
   所以图的 note 就写了这一句〔A06〕——**图不替教材下结论**。

### 1.3 🔴 引擎校验：通过（原始输出）

`prep.items` 经引擎 `parseManifest` 校验／规范化之后的形态（`material` 存在性在装载期就已校验）：

```
== 现盘（code/classrooms/cs-os）==
blocks 块数        = 47
manifest 顶层键    = format,classroom,phases,blocks,runtime_store,animation,prep
animation.enabled  = true
prep 段            = 5 条

· ctx-switch         lesson=1 template=timeline@v1 scene=TimelineScene required=true
  title    = 两个进程轮流用 CPU（上下文切换）
  material = materials/ch01.md（存在＝装载期已校验）
· proc-lifecycle     lesson=2 template=state_machine@v1 scene=StateMachineScene required=true
  material = materials/ch02.md
· fifo-vs-sjf        lesson=3 template=timeline@v1 scene=TimelineScene required=true
  material = materials/ch03.md
· avg-turnaround     lesson=3 template=bar_compare@v1 scene=BarCompareScene required=false
  material = materials/ch03.md
· race-interleaving  lesson=9 template=timeline@v1 scene=TimelineScene required=true
  material = materials/ch09.md
```

（参数也已规范化：例如 `avg-turnaround` 的 `params` 被补成
`{"items":[{"label":"周转 FIFO","value":110,"color":"blue"},…],"vmax":110,"unit":"时间单位","note":"…","highlight":"周转 SJF"}`
——**颜色是引擎按规范名补的，`vmax` 是派生字段**，说明它走的是与课堂上同一个校验器。）

### 1.4 🔴 "通过校验"不是空话：故意改坏四处，引擎四处都报错

| 改坏什么 | 引擎的回答（原文摘） |
|---|---|
| `material` 指向不存在的文件 | *"prep.items.2…material 指向的文件不存在：…/materials/ch99.md。它不存在 ⇒ 缓存键永远算不出来 ⇒ 每次上课都会重渲一遍（这种失败不会报错，只会在账上多花钱）。"* |
| 参数里写了不存在的颜色 `pink` | *"prep.items.2…的模板参数不合法（与课堂上调 classroom_animate_template 同一套判据）：- params(timeline).lanes[0].segments[2].color 不是可用的颜色名（得到 "pink"；可用：blue / amber / green / red / purple / grey / orange / …）"* |
| 删掉 `animation:` 段 | *"prep（第 95 行）声明了备课清单，但本教室没有启用教学动画（顶层缺 animation: {enabled: true}）——这份清单永远不会被用到，预热也起不来。"* |
| `prep` 里多写一个键 `lessonz` | *"prep.items.2… 无法识别的键 "lessonz"（可用：id / lesson / template / title / params / material / caption / required）"* |

→ 四条都是**引擎实现里已有的判据**（`normalizePrep` 与 `lib/manifest.mjs` 的交叉校验〔A13〕），
本批**没有改引擎**，只是让教室内容真的去走它。

---

## 2. ① 预热实测（真的渲了一遍）

### 2.1 口径

· 教室 = `code/classrooms/cs-os` 的 `rsync -a` **副本**（`/tmp`；**绝不写真教室**，产物落副本的 `runtime/` 下）；
· 跑的就是引擎"装载后 / 回合开头讲次变了"会跑的那个函数 `warmUpPrep`〔A14〕（先 `prepPlan` 查缓存〔A15〕，没命中才起任务）；
· **模型调用 = 0**：脚本由模板从声明里的参数拼出来，预热这一路**不经过任何 LLM**。

### 2.2 结果（原始输出）

| 段 | 讲次 | 模板 | 起任务 | 渲染 | 闸门 | 产物（副本内相对路径） |
|---|---|---|---|---|---|---|
| `ctx-switch` | 1 | timeline | `L01-T00-…-142028` | **1565 ms** | **PASS**（阻断 0） | `runtime/animations/L01-T00-20260924-142028/L01-T00-20260924-142028.mp4`（144 KB） |
| `proc-lifecycle` | 2 | state_machine | `L02-T00-…-142035` | **1616 ms** | **PASS**（阻断 0） | `runtime/animations/L02-T00-20260924-142035/L02-T00-20260924-142035.mp4`（205 KB） |
| `fifo-vs-sjf` | 3 | timeline | `L03-T00-…-142042` | **1920 ms** | **PASS**（阻断 0） | `runtime/animations/L03-T00-20260924-142042/L03-T00-20260924-142042.mp4`（134 KB） |
| `avg-turnaround` | 3 | bar_compare | `L03-T00-…-142042-2` | **1685 ms** | **PASS**（阻断 0） | `runtime/animations/L03-T00-20260924-142042-2/L03-T00-20260924-142042-2.mp4`（88 KB） |
| `race-interleaving` | 9 | timeline | `L09-T00-…-142049` | **1482 ms** | **PASS**（阻断 0） | `runtime/animations/L09-T00-20260924-142049/L09-T00-20260924-142049.mp4`（129 KB） |

```
── 第 1 讲：1 段 ──  ctx-switch: material sha256=0e11d29d1f049b9a… cacheKey=3a346724f766e92c…
  起任务耗时 4 ms｜已起 1 段
── 第 2 讲：1 段 ──  proc-lifecycle: material sha256=2c775eadd4dec832… cacheKey=4588270b6c939d27…
  起任务耗时 6 ms｜已起 1 段
── 第 3 讲：2 段 ──  fifo-vs-sjf: material sha256=8a823c3aec6af74f… cacheKey=0b4acb3cf9c2d646…
                    avg-turnaround: material sha256=8a823c3aec6af74f… cacheKey=d6b55c779a20d4cd…
  起任务耗时 5 ms｜已起 2 段（并发闸 2，两条一起跑）
── 第 9 讲：1 段 ──  race-interleaving: material sha256=60da9ccb3626043d… cacheKey=04740ec6fd789bd3…
  起任务耗时 8 ms｜已起 1 段

== 合计 ==
预热段数 5（覆盖 4 讲）｜起任务总耗时 23 ms｜全部终态共等 28234 ms
终态：ready 5｜blocked 0｜failed 0
模型调用 = 0（本脚本不 import 任何 LLM 客户端；脚本由模板从参数拼出）
```

**"多久全 ready"（逐讲，含渲染 ＋ 质量闸门）**：

| 讲次 | 起的段数 | 起任务耗时 | **全部终态** |
|---|---|---|---|
| 第 1 讲 | 1 | 4 ms | **6.75 s** |
| 第 2 讲 | 1 | 6 ms | **6.76 s** |
| 第 3 讲 | 2（并发闸 2，一起跑） | 5 ms | **7.67 s** |
| 第 9 讲 | 1 | 8 ms | **7.06 s** |
| 合计 | 5 | **23 ms** | **28.2 s**（4 讲依次跑的总和） |

🔴 **两点如实说明**：
1. **`fifo-vs-sjf` 与 `avg-turnaround` 的教材哈希相同**（同一份 `materials/ch03.md`），但 **缓存键不同**——因为键里还有模板与参数
   （键＝讲次＋教材内容哈希＋模板id@版本＋规范化参数，见 `prepCacheKey`〔A11〕）。这正是设计要的。
2. 本批**只做了 `-ql` 画质**（与 ANIM-PREP 同口径）；高画质下的预热成本**仍未测**（沿用上游的未取证项）。

### 2.3 目视核对（5 帧，逐条对教材）

| 帧 | 画面 | 核对结论 |
|---|---|---|
| `ctx-switch` | 两条泳道：进程 A 的块在 `[0,2]` 与 `[4,6]`、进程 B 在 `[2,4]` 与 `[6,8]`；轴刻度 0/4/8；note 写"切走时保存执行位置与寄存器，切回来时恢复" | ✅ 与 ch01 的"轮流用核心 + 切换时保存/恢复"一致；两行块**首尾相接无空隙**，正是"时间共享"的样子 |
| `proc-lifecycle` | 三节点环形：运行 →（exit 退出）→ 僵尸 →（父进程 wait）→ 已回收；底部字幕"第 3 步：已回收" | ✅ 与 ch02「僵尸 → 父进程取走 → 记录被释放」一致；推移字幕说明它真的在走 |
| `fifo-vs-sjf` | 上行 FIFO：A(0–100) 后接 B、C 两个窄块，末端标 100；下行 SJF：B、C 在前、A 从 20 到 120；轴刻度 0/60/120 | ✅ 与 ch03 的 100/110/120 与 10/20/120 逐条对得上；**"长块把两个窄块挤到最右"就是这一讲要学生看见的东西** |
| `avg-turnaround` | 四根横条：周转 FIFO 110（蓝）、周转 SJF 50（**高亮琥珀**）、响应 FIFO 70（绿）、响应 SJF 10（紫）；note 写"这组数看不出两个指标的冲突（冲突要等引入轮转）" | ✅ 四个数都是教材算出来的；高亮落在 `highlight: 周转 SJF` 上；note 防止图越权下结论 |
| `race-interleaving` | 线程 A：读 0 `[0,1]`、写 1 `[2,3]`；线程 B：读 0 `[1,2]`、写 1 `[3,4]` | ✅ 与 ch09 的"读—读—写—写"交错逐字一致；**两个"写 1"就是"两次加一落成同一个 1"** |

（5 帧均由 `ffmpeg` 取各 mp4 的末帧后目视；`animation-gate` 对 5 段都判 PASS、阻断数 0。）

---

## 3. ② 渠道纪律（本批的关键）

### 3.1 写在哪

| 位置 | 为什么是这里 |
|---|---|
| `_anchor.md`「本课不许违反项（每讲更新）」〔A08〕 | 该段是**每轮贴尾注入**的纪律层（`classroom.yaml` 的 `anchor.lesson_ban` 块），也是 `AGENTS.md` 强制"每轮课前必读"的那一份 → 与既有"白板一律 `classroom_draw`"并列 |
| `system_core.md`「课中」那一条〔A09〕 | 照既有"两处都写"的口径（白板纪律本来就是两处都有）；`system_core.md` 是启动层、讲教学法的地方 |

### 3.2 纪律原文（逐字）

`_anchor.md`（在既有"白板只能画出来"那条**之后**、与"动画"那条**同段并列**）：

```
- 🔴 **动画渠道（与白板并列，不互相替代）**：白板是**当场画的板书**（静态内容）；动画是**讲过程**。讲到**随时间变化**的机制
  （进程被打断又恢复、任务按不同顺序在时间轴上流动、同一段时间轴上读出两个数）时用动画，不要用一张静止的图代替。
  🔴 **渠道与优先级（三条渠道：白板图 / 模板 / 自己写；按这个顺序选，不要跳级）**：
  ① 能画成一张**静止板书图** → `classroom_draw`（**秒级**）；
  ② 这一段在**本讲预先备好的动画清单**里（回合开头的引擎块给了 `prepId`）→ 调 `classroom_animate_template` 传 `prepId`
     （课前已渲好，命中缓存 **0 秒**）；
  ③ 不在清单里、但形状是模板（时间轴/甘特、状态机推移、条形对比）→ 调 `classroom_animate_template` 传 `template` + `params`
     （**10–20 秒**；对照：自己写脚本 **25–41 秒**）；
  ④ 只有模板表达不了的过程动画 → `classroom_animate` 自己写脚本（**25–41 秒**，最慢的一条；**能预知就写进备课清单**，让引擎课前渲好）。
  （②③ 用在"要讲它**怎么一步步走**"时；只讲结构本身仍走 ①。**先把这一步讲给学生，再调工具**；它立刻返回、渲染在后台跑，
  好了引擎会在后面的回合开头告诉你，那时再放出来。）
  什么时候用哪条仍由你现场判断——**本条只管渠道与优先级**。
```

`system_core.md`（同一件事的压缩版，一句话给完四级）：

```
**讲到随时间变化的机制要起一段动画**，不要用静止的图代替——它是与白板并列的另一条渠道；
**渠道按「静止板书图 → `classroom_draw`／本讲备课清单里有 → `classroom_animate_template` 传 `prepId`／
形状是模板 → 传 `template`+`params`／模板表达不了 → `classroom_animate` 自己写」的顺序选，不要跳级**；
先讲再调、工具立刻返回，什么时候用哪条仍由你现场判断（细则见 `_anchor.md`「本课不许违反项」）。
```

### 3.3 与引擎注入的动画纪律段是否一致（逐条对齐）

引擎在教室声明 `animation` 时会注入一段动画纪律（`index.mjs` 的 `socratic-engine:animation.discipline`），其中：

| 引擎那段 | 本批纪律 | 一致？ |
|---|---|---|
| 第 2 条 *"优先级：取备好的 → 套模板 → 才自己写…不要跳级"*〔A18〕 | ② → ③ → ④ | ✅ 逐级一致（顺序、名称、"不要跳级"都在） |
| 第 6 条 *"静态的图不要用动画。流程图/状态机/对比表这类不随时间变化的，直接用 `classroom_draw`"* | ① 静止板书图 → `classroom_draw` | ✅ 一致；本批把它的位置**提到最前**（它是三条渠道里最便宜的一条） |
| 第 1 条"先讲后画"、第 3 条"起了就继续讲"、第 4 条"好了再放" | 纪律末句"先把这一步讲给学生，再调工具…好了引擎会在后面的回合开头告诉你" | ✅ 保留，未改口径 |
| 引擎没写、本批补的一句 | *"②③ 用在'要讲它怎么一步步走'时；只讲结构本身仍走 ①"* | 🆕 **本批新增的和解句**：引擎第 6 条说"状态机 → 直接用 `classroom_draw`"，而本批的 `proc-lifecycle` 正是一个 `state_machine` 条目——这句把边界划清：**讲结构走白板，讲推移走模板** |

### 3.4 与既有 5 处白板纪律、动画纪律不冲突

`_anchor.md`「本课不许违反项」现在**同一段里并列三条**，措辞上可一眼分辨：
① 白板内容**只能画出来**（`classroom_draw`）〔既有〕；
② **动画渠道与优先级**（本批）〔A08〕；
③ 叙事不得编造课堂历史（既有）。
本批**没有删改**任何既有条目，只把原"动画渠道"那一条**替换成含四级优先级的版本**（原版本只说"用 `classroom_animate` 起一段动画"，
而那条路是**最慢的**——这正是上游报告说"生产里模板工具一次都不会被用"的根因之一）。

### 3.5 与 ANIM-PREP 实验版纪律的差异

上游把一份 `CHANNEL_NOTE` **只追加在 `/tmp` 副本**里（真教室一个字没改）。本批是它的**生产版**：
· 保留原三级顺序；· **新增第 ① 级**（静止图 → `classroom_draw`），与引擎第 6 条对齐；
· 新增"只讲结构仍走 ①"的和解句；· 措辞改成"先给数字、再给禁令"（本项目实证：给数字比给形容词有用）。

---

## 4. ③ 验收（四项原始结果）

### 4.1 教室自检：**[①]–[④] 全绿**，第 ⑤ 项红（设计如此）

```
$ /opt/homebrew/bin/node code/skills/socratic-classroom/validate code/classrooms/cs-os
socratic-classroom 自检
教室目录：…/code/classrooms/cs-os ｜ 教室标识：cs-os · 计算机系教室 · 操作系统 ｜ 声明讲数：14 讲

[①] 必需文件          ✓ 17 个必需文件齐全，角色 1 份，story/ 与 materials/ 目录存在
[②] classroom.yaml 声明的材料   ✓ 48 条声明路径全部存在于磁盘
[③] 讲次序号与讲数    ✓ 声明 14 讲 ＝ story/ 实际 14 个节点；29 个讲次门全部落在 1–14 内
[④] 教材正文          ✓ 第 1–14 讲正文齐全（14 份）
[⑤] 发现链路（本技能包在不在扫描根下）
  ✗ 不在 用户级 · $DSH_HOME/skills ｜ ✗ 不在 用户级 · ~/.agents/skills
  ✗ 本包**不在任何扫描根的直接子目录下** → 宿主扫不到它：候选 0 条、告警 0 条（双重静默）
  ✓ frontmatter name 合法：socratic-classroom｜✓ frontmatter description 非空：228 字符

结论：发现 1 个问题（退出码 1）  ← 只有 ⑤ 这一条
```

🔴 **按口径报**：第 ⑤ 项**在工作区原地跑本来就会红**（技能包要装到扫描根下才绿，那是用户环境的事）→
**本批没有为让它变绿动过任何用户环境**。①②③④ 全绿，且 ② 的"48 条声明路径"里**已包含本批新增的 5 条 `material`**。

### 4.2 引擎能解析：新声明真被解析，且块数／注入块数没有意外变化

```
== 基准（acceptance 冻结快照 2026-09-24_140045，改动前）==
blocks 块数 = 47 ｜ manifest 顶层键 = format,classroom,phases,blocks,runtime_store,animation
prep 段     = （缺席 → manifest 不挂 prep 键）

== 现盘 ==
blocks 块数 = 47 ｜ manifest 顶层键 = …,animation,prep
animation.enabled = true ｜ prep 段 = 5 条

== 注入块数对照（planTurnInjections，同一状态）==
phase=open   lesson= 1  before=8  after=8  SAME
phase=probe  lesson= 1  before=6  after=6  SAME
phase=check  lesson= 1  before=8  after=8  SAME
phase=open   lesson= 3  before=7  after=7  SAME
phase=close  lesson= 9  before=5  after=5  SAME
phase=probe  lesson=14  before=5  after=5  SAME
注入块数：全部一致（无意外变化）
prep 段是否进注入块：没有（prep 不是注入块，它由引擎在回合开头单独生成 prep-list）
```

→ **`prep` 只是 manifest 上多一个键**：`blocks` 仍 47，6 个点位的注入块数逐一致。
（`prep` 能被解析的前提是教室的 `animation: {enabled: true}` 在场〔A02〕——缺它引擎会报"死配置"，见 §1.4 第三行。）
`prep-list` 那条注入是引擎**在回合开头单独生成**的（`source.form = 'prep-list'`〔A17〕），不走 blocks 通道——
§4.4 的 4 次真会话里它**每次都出现了**。

### 4.3 全量单测：**383 / 383 全绿**（基线 380）

```
$ cd code/plugins/socratic-engine && for f in test/*.test.mjs; do … done
animation 24｜cast 49｜dedup 25｜diagram 36｜discovery 42｜expression 36｜injector 11｜lesson 26
manifest 17｜phase 38｜postclass 36｜prep 26｜section 17
合计：tests 383 ｜ pass 383 ｜ fail 0        （13 个测试文件，退出码 0）
```

🔴 **关于"红项归属"（如实记两次跑）**：
· **首轮**跑出 `test/expression.test.mjs` **36 tests / 35 pass / 1 fail**。该文件与 `lib/expression*.mjs`、`index.mjs` 属于**另一条工作线**
  （本轮期间它在反复 `pnpm add` 本插件到 `socratic-headless`，进程表可见）；
· **单独重跑该文件 → 36/36 全绿**，**整套重跑 → 383/383 全绿**。→ 判为**那一轮正落在对方写入中间态**，**不是我的改动引起**。
· 基线 **380**：现盘 383 ＝ 380 ＋ 对方新增 3；**`test/prep.test.mjs` 的 26 个用例全绿**，说明本批没有破坏上游的 prep 机制。
· 🔴 本批**没有改 `code/plugins/**` 任何一个字节**（§6.2 有哈希对照）。

### 4.4 🔴 真会话验证：老师真用了模板工具吗（4 次，2 个点位 ×2）

**跑法**：教室 = `rsync -a` 副本；**隔离 `DSH_HOME`**＝`cp -Rc` 克隆到 `/tmp/dsh-home-animprep`（避免与已在跑的实例抢会话写句柄）；
patch 把 `classroomDir` 指到副本；渲染器路径来自 `poc_动画可写性/env`。

| 次 | 讲次 | 点位（学生问什么） | 墙钟 | 老师调的工具（按序） | 用了模板工具？ | 命中课前预热？ |
|---|---|---|---|---|---|---|
| **A** | 1 | "CPU 只有一个，两个程序同时跑，它怎么做到谁都不被打断？" | 53.5 s | read×7 → `classroom_status` → **`classroom_draw`** → `classroom_set_phase` | ❌ 没调 | — |
| **B** | 3 | "你说该先跑短的——那我事先知道哪份任务长吗？" | 42.3 s | read×4 → `classroom_status` → **`classroom_draw`** → `classroom_set_phase` | ❌ 没调 | — |
| **C** | 3 | "能不能把这两种排法摆在同一根时间轴上让我看看？顺便平均周转时间差多少也给我看一下。" | 48.3 s | read×4 → `bash` → `classroom_status` → `classroom_set_phase` → `classroom_draw` → **`classroom_animate_template` ×2** | ✅ **2 次** | ✅ **2/2 命中（0 秒）** |
| **D** | 1 | "进程 A 被切走、B 跑一段、再切回来——这段时间轴上到底是怎么排的？我想看着它排出来。" | 43.0 s | read×6 → `classroom_set_phase` → `classroom_draw` → **`classroom_animate_template` ×3** → `classroom_draw` | ✅ **3 次** | ✅ **1/1 命中（0 秒）**，另 2 次走模板 |

**引擎逐字回话（`prepId` 命中）**：

```
会话 C：classroom_animate_template {"prepId":"fifo-vs-sjf"}
  → ✅ 命中课前预热缓存（0 秒）：L03-T00-20260924-142750｜已就绪：可以播了
     产物 animations/L03-T00-20260924-142750/L03-T00-20260924-142750.mp4｜备课清单 fifo-vs-sjf
会话 C：classroom_animate_template {"prepId":"avg-turnaround"}
  → ✅ 命中课前预热缓存（0 秒）：L03-T00-20260924-142750-2｜产物 animations/…-2.mp4｜备课清单 avg-turnaround
会话 D：classroom_animate_template {"prepId":"ctx-switch"}
  → ✅ 命中课前预热缓存（0 秒）：L01-T00-20260924-142838｜产物 animations/L01-T00-20260924-142838.mp4｜备课清单 ctx-switch
```

· **入参 24 / 27 / 23 字符**（就是 `{"prepId":"…"}`）；**盘上没有新增任务目录**（两讲的预热任务在装载时就起了，见下），
  即"同一个动画只生成一次"在盘上成立。

**调用 → 返回的墙钟（取自会话事件流，不是我自述）**：

| 会话 | 入参 | 调用时刻 | 返回时刻 | **老师实际等待** |
|---|---|---|---|---|
| C | `{"prepId":"fifo-vs-sjf"}` | 42 784 ms | 42 792 ms | **8 ms** |
| C | `{"prepId":"avg-turnaround"}` | 42 793 ms | 42 798 ms | **5 ms** |
| D | `{"prepId":"ctx-switch"}` | 21 482 ms | 21 487 ms | **5 ms** |
| D | `template`+`params`（**被参数校验拒绝**） | 26 426 ms | 26 431 ms | **5 ms**（拒绝也是立刻回，不留半个任务） |
| D | `params`（接受，`queued`） | 31 518 ms | 31 526 ms | **8 ms**（渲染在后台跑，老师继续讲） |

→ **取用一段课前备好的动画，老师实际等待 5–8 毫秒**（渲染早在装载时就跑完了）。这就是"备课"换成的那 25–41 秒。
· 会话 C 的 3 个新目录里，两个是**引擎装载时的预热产物**（`origin=prep`、`T00`），一个是 `index.md`；
  **老师那两次调用没有产生任何新目录** → 0 秒命中。
· 会话 D 的 2 个新目录：`L01-T00-…-142838`（`origin=prep`，预热）＋ `L01-T01-…-142910`（**`origin=template`**，
  即老师自己那次 `template`+`params` 现场套模板起的任务）。

**D 那次"模板路"还留了一个真实的拒绝样本**（值得单独记）：

```
classroom_animate_template {"template":"timeline","title":"A 被切走、B 跑一段、A 再切回来：CPU 时间轴上谁在占","params":{…}}
  → Error: 拒绝这次调用，什么都没有落盘、也没有起渲染。
     - params(timeline).lanes[0].segments[1].label 过长：14 > 12 字符（图上放不下，请缩短）
     - params(timeline).lanes[0].segments[3].label 过长：14 > 12 字符（图上放不下，请缩短）
     （模板清单与参数形状：…）
```
→ 老师把 `内核：保存 A / 恢复 B` 缩成 `内核：保存A恢复B` 后**一次就过**（脚本 63 行 / 3290 B，queued）。
**这正好证明"课前写声明"与"课上现生成"共用同一套判据**（同一个 `MAX_LABEL_CHARS`／分段标签 12 字符上限〔A16〕）。

**引擎注入（每次都出现，`source.form='prep-list'`）**：

```
本讲（第 3 讲）预先备好的教学动画：
· `fifo-vs-sjf` —— 长任务怎么把后面的短任务全堵住（模板 timeline，正在预热）
· `avg-turnaround` —— 平均周转时间与平均响应时间：FIFO vs SJF（模板 bar_compare，正在预热）
→ 讲到清单里某一段对应的那一步时，**不要自己写 Manim 脚本**：调 `classroom_animate_template` 并传它的 `prepId`。
  课前已经渲好了，命中缓存是 0 秒；标记"别等它"的那几段改用 `classroom_draw` 画板书图。
→ 清单里没有、但形状是某个模板的步骤，用 `classroom_animate_template` 传 `template` + `params`。
```

🔴 **一个必须说清的时间关系**：4 次会话的注入都发生在回合开头（相对 `turn/start` 118–190 ms），
那一刻**引擎的装载期预热还在跑**，所以清单里写的是"**正在预热**"而**不是"已就绪"**；
老师是在 21–43 秒之后才去取的，那时已经 ready → 才拿到"命中缓存（0 秒）"。
**"清单写着正在预热，老师仍然照取"**——这一条比"清单写已就绪"更能说明纪律生效。

**A／B 为什么没用模板工具（我查了什么）**：
1. **纪律在不在模型眼前？** 在——两次会话的**第一个 `read` 就是 `_anchor.md`**（A 在 4531 ms、B 在 8727 ms），
   引擎的动画纪律段也在系统提示里（教室声明了 `animation`）；
2. **清单有没有送到？** 送到了——两次都有 `prep-list` 注入（A 是第 9 条注入、B 是第 8 条）；
3. **模型看没看到工具？** 工具已注册（C／D 两次同一个 profile 下都能调）；
4. **它选了什么？** 两次都选了 `classroom_draw` 画**流程图**：
   A 画的是"一颗核心 → 音乐播放器／浏览器 → 两边怎样都有机会继续"，
   B 画的是"调度器手里有的（到达时刻、已用时间…）vs 它拿不到的（还要跑多久）"。
   → **两张图都是"结构/对照"，不是"随时间变化的过程"** → 按纪律第 ① 级，`classroom_draw` **就是正确渠道**。
5. 结论：**这两个点位没覆盖到"需要动画"的那一刻**，不是纪律失效。C／D 把点位换到"时间轴上怎么排"之后，
   老师**立刻**改走模板工具，且**优先用 `prepId`**。

---

## 5. ④ 纪律里要不要显式点出工具名（判断）

**结论：要点出，而且要点出到"参数级"（`prepId` 这个名字必须出现）。**

| 依据 | 说明 |
|---|---|
| 本项目已有实证 | ANIM-ORCH 那次：引擎把 `classroom_animate` 挂上了，**内容侧一个字没提**，结果两个点位上一次都没调（全走 `classroom_draw`）。→ **"工具在工具表里"不等于"老师会想到它"** |
| 纪律层是模型每轮都会重读的位置 | `_anchor.md`「本课不许违反项」每轮贴尾注入；工具描述在工具表里，离"这一课现在该怎么做"很远 |
| 不点出工具名的**代价不对称** | 点出＝多约 40 个字符；不点出＝**备课清单白做**（预热花了渲染时间却没人取）＋ 每次都走最慢的渠道（自己写脚本 25–41 秒 vs 0 秒） |
| 只点工具名还不够，**必须点 `prepId`** | 只说"有模板工具"，模型可能每次都走 `template`+`params`（10–20 秒）而**永远不去取课前备好的那一段**——那就把本批最大的收益（0 秒）丢了。实测 C／D 两次都是先 `prepId`，说明"点出 `prepId` 并说明它 0 秒"是有效的 |
| ⚠️ **仍未证伪的那一半** | "**不点出工具名时模型会不会自己用**"——本批**没有做对照臂**，所以"不点出就一定不会用"**仍是推断**（来自 ANIM-ORCH 的 B 组证据），不是本批实测。**本批能说的是：点出之后，在需要动画的点位上 2/2 用了，且 3/3 次取用都走 `prepId`。** |

🔴 **边界（不冻结教学行为）**：纪律里写的是**渠道与优先级**，不是"什么时候必须用动画"；
最后一句逐字保留了"什么时候用哪条仍由你现场判断"——A／B 两次走 `classroom_draw` 就是这条边界的实例。

---

## 6. 改动清单与哈希（判改动一律用 sha256）

### 6.1 本批改动的文件（只有 3 个内容文件 ＋ 1 个同步副本 ＋ 本报告）

| 文件 | 前 sha256（16） | 后 sha256（16） | 改了什么 |
|---|---|---|---|
| `code/classrooms/cs-os/classroom.yaml` | `b8b765ea73bc0a12` | **`c30e2ab5a7bf1a7b`** | 顶层新增 `prep:` 段（5 条，＋ 一段依据注释） |
| `code/classrooms/cs-os/_anchor.md` | `66d2dc11fa83a4e3` | **`bc4e89f3405a5e49`** | 「本课不许违反项」里的动画渠道条 → 三条渠道＋四级优先级 |
| `code/classrooms/cs-os/system_core.md` | `7abc2f46423d585e` | **`1eab54e0bb7ad486`** | 「课中」那条补同一件事的压缩版（两处都写） |
| `code/skills/socratic-classroom/classroom/**` | — | 与源逐文件同哈希 | `sh sync-classroom.sh` 同步；`diff -rq` **零差异** |

🔴 **"只改了这三个"的独立证据**（不是自述）：与 acceptance 冻结快照（本批开工前的 `classrooms` 副本）整树对照，
**只有这三个文件 differ**：

```
$ diff -rq code/acceptance/runs/2026-09-24_140045/frozen/classrooms/cs-os code/classrooms/cs-os
Files …/frozen/classrooms/cs-os/_anchor.md and code/classrooms/cs-os/_anchor.md differ
Files …/frozen/classrooms/cs-os/classroom.yaml and code/classrooms/cs-os/classroom.yaml differ
Files …/frozen/classrooms/cs-os/system_core.md and code/classrooms/cs-os/system_core.md differ
```

技能包副本逐文件哈希（与源一致）：

```
c30e2ab5a7bf1a7b…  code/skills/socratic-classroom/classroom/classroom.yaml
bc4e89f3405a5e49…  code/skills/socratic-classroom/classroom/_anchor.md
1eab54e0bb7ad486…  code/skills/socratic-classroom/classroom/system_core.md
$ diff -rq code/classrooms/cs-os code/skills/socratic-classroom/classroom   → 退出码 0（零差异）
```

### 6.2 本批引用的引擎文件（**只读，一个字节都没改**）

| 文件 | 现盘 sha256（16） | 与上游 ANIM-PREP 报告记的值 |
|---|---|---|
| `lib/prep.mjs`〔A10〕〔A11〕〔A12〕 | `4e142ad8661dec08` | **一致**（未变） |
| `lib/manifest.mjs`〔A13〕 | `fce113df38f84eb5` | **一致**（未变） |
| `lib/prepstore.mjs`〔A14〕〔A15〕 | `6b1fdb1b7e3f0370` | **一致**（未变） |
| `lib/animtemplates.mjs`〔A16〕 | `9084af0e3dba9d2c` | **一致**（未变） |
| `index.mjs`〔A17〕〔A18〕 | `e0b4ac6f270cba9a` | ⚠️ **已变**（上游记 `181a427de6614307`）——**另一条工作线在改**，与本批无关；本批对它的引用只做只读核对 |

### 6.3 禁区核查

| 目录 | 本批有没有写 | 证据 |
|---|---|---|
| `code/plugins/**` | **没有** | §6.2 逐文件哈希：prep/manifest/prepstore/animtemplates **与上游记的值逐字相同**；`index.mjs` 的变动来自另一路（本批全程只 `read`/`grep`） |
| `code/clients/**`、`code/tools/**`、`code/acceptance/**` | **没有** | 本批所有写操作落在 `code/classrooms/cs-os/**`（3 个文件）、`code/skills/socratic-classroom/classroom/**`（同步副本）、本报告与旁挂锚点表；另有 `/tmp` 下的实验脚本与副本 |
| `~/SocraticNovel-wt/`、`~/SocraticNovel-GitHub仓库/`、`/Applications/DSH Desktop.app` | **没有** | 从未发出写操作（只读：克隆 `DSH_HOME` 时它被拷进 `/tmp` 副本；`socratic-test` 是 profile 里原有的 `link:` 依赖，本批只在**副本**里把断掉的相对软链改成绝对软链） |
| 任何 profile | **只动了 `/tmp` 的克隆** | 真 `$DSH_HOME` 未写；隔离克隆 `/tmp/dsh-home-animprep` 里把引擎按工作区版本 `rsync` 进去并**逐文件 sha256 复核（22/22 SAME）** |

---

## 7. 未做到 / 未取证 / 待确认

### 7.1 未做到

| # | 事项 | 说明 |
|---|---|---|
| 1 | **真教室的 `runtime/animations/` 里没有预热产物** | 本批的预热跑在 `/tmp` 副本上（避免把 mp4 二进制带进教室包与技能包）。**生产里不需要预置**：引擎在装载后与"讲次变了"的回合边界**会自动预热**（§4.4 的 4 次会话里都真的起了）。 |
| 2 | **没有做"不点出工具名"的对照臂** | 所以 §5 里那条判断仍是**推断**（依据 ANIM-ORCH 的 B 组证据），不是本批实测。 |
| 3 | **`state_machine` 模板只在第 2 讲的清单里备好了，没有在真会话里被取用** | 4 次会话的动画点都落在 `timeline` / `bar_compare` 上（那两讲/那两步本来就是时间轴题）。→ "模型会不会填对 `state_machine` 参数"仍只有**单测 ＋ 本批的渲染＋目视**证据。 |
| 4 | **没有改客户端的播片那半** | 播放仍在 `code/clients/**`（本轮不许碰）。`prep-list` 的机器可读字段（`source.form='prep-list'`、`lesson`）与 ANIM-ORCH 的 `animation-notice` 契约一致。 |

### 7.2 未取证

| # | 事项 | 为什么 |
|---|---|---|
| 1 | **`give-up` / `blocked` 的课上行为** | 本批 5 段全部 ready、闸门全 PASS，**没能在真实会话里让老师遇到一次**（沿用上游的同一缺口）。 |
| 2 | **预热与老师现场任务的并发冲突** | 本批预热最多 2 段、十几秒就完了，**没撞上并发闸**。 |
| 3 | **高画质（`-qh`）预热成本** | 全部 `-ql`。 |
| 4 | **模型段的精确构成** | 与上游同：会话日志没有流式分片事件，分不出"想"与"打字"。 |
| 5 | **4 次会话的样本量** | 每点位 n=1。C／D 的结论是"这两次用了模板工具"，**不是"纪律使模板工具使用率变成 X%"**。 |

### 7.3 待确认（需要用户／教室内容维护方拍板）

| # | 问题 | 选项 | 我的倾向 |
|---|---|---|---|
| 1 | **`state_machine` 条目要不要留** | ① 留（现状：讲"僵尸→回收"的**推移**）② 删掉，只保留两条 timeline ＋ 一条 bar | **倾向留**：模板自己的定位就是"要看见它这一步走到哪了"，且 §3.3 的和解句已把"讲结构走白板、讲推移走模板"写清 |
| 2 | **`avg-turnaround` 用 4 根条还是 2 根条** | ① 4 根（现状：两个指标同一图）② 只留"周转 FIFO 110 / SJF 50"两根 | **倾向 4 根**：响应时间那两个数也是教材算过的，且 note 已写明"这组数看不出冲突"；但**若要更聚焦，砍成 2 根也成立** |
| 3 | **一讲备几条合适** | ① 现状（第 1／2／9 讲各 1 条，第 3 讲 2 条）② 每讲都备 2–3 条 | **倾向现状**：预热要花渲染时间，备了不用就是白花；先按"这一讲真会出现几步"来加 |
| 4 | **缓存键要不要含讲次** | ① 含（现状，沿用上游）② 不含 | **倾向含**（沿用上游理由）：教材按讲分文件，含讲次不产生额外成本 |
| 5 | **`_anchor.md` 这一条体量** | 现状 ＋775 B（4570 → 5345 B）；它是**每轮贴尾注入**的 | **倾向可接受**，但**若后续还要往纪律层加东西，应先做一次压缩**——纪律层"保持简短"是它自己的规矩 |
| 6 | **要不要把"第 3 讲清单里两段是同一份教材"改成跨讲共享** | ① 现状（键含讲次 → 各渲一次）② 去掉讲次 | **倾向现状**（同 4） |

---

## 8. 复现命令与模型调用台账

### 8.1 复现（脚本在 `/tmp/animprep-enable/`，属一次性实验件，不进仓库）

```bash
# ① 引擎校验（含反证四例）
/opt/homebrew/bin/node /tmp/animprep-enable/validate-prep.mjs
/opt/homebrew/bin/node /tmp/animprep-enable/validate-negative.mjs
# ② 预热（5 段真渲染；零模型调用）
/opt/homebrew/bin/node /tmp/animprep-enable/warmup.mjs
# ③ 教室自检 ＋ 同步副本零差异
/opt/homebrew/bin/node code/skills/socratic-classroom/validate code/classrooms/cs-os
sh code/skills/socratic-classroom/sync-classroom.sh && diff -rq code/classrooms/cs-os code/skills/socratic-classroom/classroom
# ④ 全量单测
cd code/plugins/socratic-engine && for f in test/*.test.mjs; do echo "== $f"; /opt/homebrew/bin/node "$f" 2>&1 | grep -E "tests [0-9]+|pass [0-9]+|fail [0-9]+" | tail -3; done
# ⑤ 真会话（隔离 DSH_HOME；教室副本）
cp -Rc "$HOME/Library/Application Support/dsh-desktop/harness" /tmp/dsh-home-animprep
rsync -a --delete --exclude node_modules code/plugins/socratic-engine/ /tmp/dsh-home-animprep/profiles/socratic-headless/node_modules/socratic-engine/
/opt/homebrew/bin/node /tmp/animprep-enable/session-prep.mjs     # A / B
/opt/homebrew/bin/node /tmp/animprep-enable/session-prep2.mjs    # C / D
```

🔴 **隔离克隆的一个坑（写下来防重犯）**：profile 里 `socratic-test` 是**相对软链**，`cp -Rc` 到 `/tmp` 后相对路径
少了几层 → 启动直接 `failed to prepare profile bundle socratic-test`（会话 0.1 秒退出、exit=1）。
→ 修法：在**副本里**把该软链改成绝对路径（真 `$DSH_HOME` 不动）。

### 8.2 🔴 真实模型调用台账（**本批共 4 次**）

| # | 用途 | 结果 |
|---|---|---|
| 1 | 会话 A（第 1 讲，"两个程序同时跑"） | exit 0，53.5 s，只调 `classroom_draw` |
| 2 | 会话 B（第 3 讲，"事先知道哪份长吗"） | exit 0，42.3 s，只调 `classroom_draw` |
| 3 | 会话 C（第 3 讲，点名要看时间轴） | exit 0，48.3 s，**2 次 `prepId` 全部命中** |
| 4 | 会话 D（第 1 讲，点名要看时间轴） | exit 0，43.0 s，**1 次 `prepId` 命中 ＋ 1 次模板路成功（另 1 次被参数校验拒绝后自修）** |

另：**两次失败的会话尝试**（隔离克隆的软链坑，0.1 秒 exit=1）**没有调用任何模型**，不计入。
本批**预热零模型调用**；**没有新增任何依赖**；**没有 git commit / push**。
