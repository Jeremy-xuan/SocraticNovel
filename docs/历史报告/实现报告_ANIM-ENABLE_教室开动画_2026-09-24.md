# 实现报告 · ANIM-ENABLE —— 给教室开动画，并补上「动画渠道纪律」

> 任务代号：**ANIM-ENABLE**（教室内容侧的小修）
> 日期：**2026-09-24**（CST）｜工作区：`/Users/wujunjie/Documents/ChatGPT/大学申请`
> 上一路：`实现报告_ANIM-ORCH_动画异步编排_2026-09-24.md`（引擎侧已做完，**但默认不启用**）
> 可改范围（本报告只动了这些）：`code/classrooms/cs-os/**`、`code/skills/socratic-classroom/**`、
> `code/tools/animation-orch/verify/anim-enable-session.mjs`（本轮新增的验收脚本）＋本报告
> 🔴 未碰：`code/plugins/**`（只读）、`code/clients/**`、`code/acceptance/**`、`~/SocraticNovel-wt/`、
> `~/SocraticNovel-GitHub仓库/`、任何 profile。**没有 git commit / push；没有新增任何依赖。**

---

## 0. 一句话结论（先给）

> **1. 教室侧两处都补上了，工具这次真的被用起来了。**
> ① `classroom.yaml` 加 `animation: {enabled: true}`（引擎能解析，`animation.enabled === true` 实测为真）；
> ② `_anchor.md`「本课不许违反项」加一条**动画渠道纪律**（措辞逐字取自上一路实测有效的 `CLASSROOM_NOTE`）。
>
> **2. 两个点位各跑一次真实会话，模型共调用 `classroom_animate` 4 次**（每个点位 2 次）——
> 上一路 B 组（只有工具、没有纪律）是 **0 次**。**这就是本轮要的证据。**
> 而且模型自己按纪律做了渠道区分：**静态因果图走 `classroom_draw`，时间轴走 `classroom_animate`**
> （`fifo` 点位 T2 的 `classroom_draw` caption 原文写着"它不随时间变化，所以走白板；RR 的时间轴另走动画"）。
>
> **3. 跨回合就绪通报也跑通了**：`fifo` 点位第 2 回合开头收到 `form=animation-notice` 注入，
> 模型**照通报把动画放了出来**（讲解里出现"这是我刚才那条 FIFO 的时间轴，现在跑起来了"）。
>
> **4. 一条必须说清的部署前置**：教室声明了 `animation:` 之后，**部署侧必须给渲染器路径**
> （profile 的 `socratic-engine` config.animation 或环境变量），否则**引擎装载时就报错**（设计如此，不留到课堂）。
> 本报告 §6.1 把它列成待办。
>
> **5. 两项与内容侧无关的观察，如实记下**：两次 `interrupt` 点位的动画都被**质量闸门判 `blocked`**（不许播），
> 模型照纪律**没放**、改用白板讲完；`fifo` 点位两段都是 `ready` 并**真的放了**。
>
> **6.（下半场追加）技能包侧两个真缺陷也修了**（§8）：
> ① 自检第 ⑤ 项"**装对了却报红**"——改成**按路径形状判定**，四组验收里"装对"那一例已变绿；
> ② 技能包**不再依赖 `node_modules`**（自带单文件 `lib/mini-yaml.js`）——
>    干净临时目录（`rsync --exclude node_modules`）跑自检**退出码 0**，不再报"残包"。

---

## 1. ① 给教室开动画：`classroom.yaml` 加了什么

### 1.1 加之前先读了引擎的解析器（不猜形态）

`code/plugins/socratic-engine/lib/manifest.mjs:155-184` 逐字规定：

| 规则 | 出处 | 后果 |
|---|---|---|
| 段**缺席** → manifest 里**根本不挂** `animation` 键 | `manifest.mjs:1186-1193` | 老教室行为逐字不变 |
| 段在场 → 必须是**映射**，否则报错（报错文案里直接给了正确写法） | `normalizeAnimation` 第 171-176 行 | 写错会**报错**，不静默 |
| 只认一个子键 `enabled`（`ANIMATION_KEYS = ['enabled']`），**多写键报错** | 第 162／177 行 | → 只写最小集 |
| `enabled` 必须是布尔；`enabled !== false` 即视为开 | 第 178-183 行 | `enabled: true` 与省略 `enabled` 等价 |
| 渲染器路径（python/manim/quality/gate…）**不在教室里写** | 第 160-161 行注释 | 那是**部署事实**，由 profile config 给 |

### 1.2 实际写入（**逐字**）

位置：`classroom.yaml` 顶层，紧跟 `runtime_store:` 段之后、`phases:` 之前（第 61-75 行）。
缩进：顶层键顶格、子键两格 —— 与文件里 `runtime_store:` 完全同形。

```yaml
animation:
  enabled: true
```

连同它的注释（原文）：

```yaml
# ── 教学动画开关（ANIM-ENABLE，2026-09-24；消费方 = lib/manifest.mjs 的 normalizeAnimation）──
# 🔴 语义（写死，逐字见 lib/manifest.mjs:155-184）：**教室声明"我这一课要不要放教学动画"**，
#    引擎只实现机制。段**缺席** → manifest 里根本不挂 animation 键 → 引擎不注册
#    `classroom_animate` / `classroom_animation_status`、不注入动画纪律段、不产生就绪通报
#    → 老教室行为逐字不变。段在场且 enabled 不为 false → 工具与纪律段都挂上。
# 🔴 这里**只写最小集**（引擎只认 `enabled` 一个子键，写别的键会报错，见 ANIMATION_KEYS）：
#    渲染器路径（python / manim / quality / gate / gatePython）**不写在这里**——那是**部署事实**，
#    不是课程内容；由 profile 的 `socratic-engine` config.animation（或环境变量）提供。
#    → 本教室声明了 animation 而部署没配渲染环境时，**装载时就报错**（不留到课堂上才炸）。
# 🔴 为什么必须有一条配套的渠道纪律：ANIM-ORCH 实测——只挂工具、内容侧不提动画时，
#    模型两个点位上一次都没调 `classroom_animate`（全走 `classroom_draw`）。
#    渠道纪律写在 `_anchor.md`「本课不许违反项」（每轮贴尾注入）。
animation:
  enabled: true
```

### 1.3 其余必填子键：**没有**，只有 `enabled`

- 引擎**不要求**任何其它子键（`ANIMATION_KEYS` 只有一个成员）。
- **渲染器路径走 profile config**（`config.animation.python / manim / quality / gate / gatePython`），
  见 `index.mjs:269-293` 与上一路报告 §3.2。→ **本教室一个路径都没写**，这是刻意的：
  教室内容是跨机器分发的，路径是本机事实。

---

## 2. ② 动画渠道纪律：补在哪、原文、为什么

### 2.1 放在哪一段：`_anchor.md`「**本课不许违反项（每讲更新）**」

`_anchor.md` 是**分段**的（四个二级标题，逐字）：
「教学取向」／「**本课不许违反项（每讲更新）**」／「角色声音速查（生成任何台词前看一眼）」／「教学检查（需要校准时使用）」。

**选「本课不许违反项」的三条理由（对着文件自身与引擎行为说）**：

1. **它是"渠道硬纪律"那一类，不是教学取向**。既有白板渠道纪律就在这一段里
   （`_anchor.md:21`），而且是**同一种东西**——"某类内容只能走某个渠道"。
   放进「教学取向」＝把渠道规则混进"怎么教"的原则里，会稀释那一段。
2. **注入频率最匹配**：这一段是 `frequency: {every: turn}`（每轮贴尾、`chat/depth 0`），
   与白板那条同频。渠道纪律必须**每轮在场**（上一路的实证：只在启动时可见是不够的）。
3. **「角色声音速查」在系统段**（`anchor.voice`，`order 10250`、`once`）——它管的是"她的声音"，
   而渠道分工是**教学内容约束**，不是人格；「教学检查」是自检清单，也不合适。

### 2.2 补进去的原文（**逐字照用 `CLASSROOM_NOTE`**）

取自 `code/tools/animation-orch/verify/ab-session.mjs:83-90` 的 `CLASSROOM_NOTE`
（上一路实测"补了之后工具才被用起来"的那一版）。**逐字核对脚本已跑，4 行全部逐字命中**（见 §4.5）。

`_anchor.md` 第 22-27 行（原文）：

```markdown
- 🔴 **动画渠道（与白板并列，不互相替代）**：白板是**当场画的板书**（静态内容）；动画是**讲过程**。具体措辞：
  - 讲到**随时间变化**的机制（进程被打断又恢复、任务按不同顺序在时间轴上流动、同一段时间轴上读出两个数）时，
    **用 `classroom_animate` 起一段教学动画**，不要用一张静止的图代替：
    **先把这一步讲给学生，再调它**；它立刻返回、渲染在后台跑，好了引擎会在后面的回合开头告诉你，那时再放出来。
    （白板图仍走 `classroom_draw`；两者是不同渠道，不互相替代。）
  - 什么时候用动画仍由你现场判断——**本条只管渠道**。
```

> 🔴 **唯一新增的是第一行引导句与最后一行"只管渠道"**：
> · 引导句的作用是**把分工写在同一处**（白板＝当场画的板书／动画＝讲过程）——见 §2.3 的理由；
> · 末行的措辞与同段白板那条的结尾**逐字同形**（"什么时候需要白板仍由你现场判断——本条只管渠道"），
>   作用是**不冻结教学行为**。
> · 中间 4 行（讲什么用动画／先讲后调／两者不互相替代）**一字未改**。

### 2.3 与既有 5 处"白板一律画"纪律的分工怎么说的

仓库教室里共有 **5 处**提到 `classroom_draw`（实测 grep）：`_anchor.md:21`、`_anchor.md:33`、
`system_core.md:36`、`system_core.md:67`、`system_core.md:152`。**本轮一处都没删、没改语义**，
只在其中两处（`_anchor.md:22`、`system_core.md:67`）**紧跟着白板那条后面加了一句动画渠道**。

分工的措辞（两个渠道**各有用途**，不是谁取代谁）：

| 渠道 | 管什么 | 出处（原文关键词） |
|---|---|---|
| `classroom_draw` | **当场画的板书**（静态内容：流程图／状态机／对比表） | `_anchor.md:22`「白板是**当场画的板书**（静态内容）」 |
| `classroom_animate` | **讲过程**（随时间变化的机制） | `_anchor.md:22`「动画是**讲过程**」；`_anchor.md:23` 三个判据例子 |

而且这句话在**三处**出现（不是只有一处）：
- `_anchor.md:22`「与白板并列，**不互相替代**」；
- `_anchor.md:26`「（白板图仍走 `classroom_draw`；**两者是不同渠道，不互相替代**。）」——这是 `CLASSROOM_NOTE` 原文；
- `system_core.md:67`「它是与白板并列的另一条渠道，**两者不互相替代**」。

**为什么这样写就不会"二选一"**：动画那条给的是**正向判据**（"讲到随时间变化的机制时"），
白板那条给的是**负向禁令**（"不许用叙述代替画"）——两者**不落在同一个条件上**，
所以模型不会把它读成"有了动画就不用画白板"。**实测证据**：`fifo` 点位 T2 里模型
**同一步先画白板、再起动画**（`classroom_draw` @150.7s → `classroom_animate` @150.7s），
并在 caption 里自己写明"它不随时间变化，所以走白板；RR 的时间轴另走动画"。

### 2.4 `system_core.md` 也补了一句（口径与白板那条当时一致）

白板那条当时是**两处都写**（`_anchor.md` 每轮贴尾 ＋ `system_core.md` 的「课中」），
本轮照同一口径，在 `system_core.md:67`（「课中」那条的句内）加一句：

```markdown
**讲到随时间变化的机制用 `classroom_animate` 起一段动画**，不要用静止的图代替——它是与白板并列的另一条渠道，两者不互相替代；先讲再调、它立刻返回，什么时候用仍由你现场判断（见 `_anchor.md`「本课不许违反项」）。
```

- **性质**：这是**系统段**（`teach.system_core`，`order 10300`，`once`）→ 一节课只在启动时注册一次，
  是**补充**，不是主力（主力是每轮贴尾的 `_anchor.md`）。
- **为什么还是加**：① 与白板那条对称（模型在"课中"这一节里看到白板渠道的规则，就该同时看到动画渠道的）；
  ② 一句话、不展开，符合「保持简短」；③ 细节仍指向 `_anchor.md`，不造第二份真源。
- ⚠️ **未单独做 A/B 验证这一句的增量作用**（本轮两个点位都是"两处都补"）→ 标【推断／待确认】，见 §7。

---

## 3. ③ 同步技能包副本

```console
$ sh code/skills/socratic-classroom/sync-classroom.sh
已同步：…/code/classrooms/cs-os -> …/code/skills/socratic-classroom/classroom
$ diff -rq code/classrooms/cs-os code/skills/socratic-classroom/classroom
$ echo $?
0
```

**零差异**（`diff -rq` 无输出、退出码 0），且两边同名文件 sha256 逐字相同（§4.6）。

---

## 4. ④ 验收（真跑，原始输出与退出码）

### 4.1 教室自检：内容四项 `[①]–[④]` 全绿；第 ⑤ 项按设计红

```console
$ /opt/homebrew/bin/node code/skills/socratic-classroom/validate code/classrooms/cs-os
socratic-classroom 自检
================================================================
教室目录：…/code/classrooms/cs-os
教室标识：cs-os · 计算机系教室 · 操作系统
声明讲数：14 讲

[①] 必需文件
  ✓ 17 个必需文件齐全，角色 1 份，story/ 与 materials/ 目录存在

[②] classroom.yaml 声明的材料
  ✓ 48 条声明路径全部存在于磁盘

[③] 讲次序号与讲数
  ✓ 声明 14 讲 ＝ story/ 实际 14 个节点；29 个讲次门全部落在 1–14 内

[④] 教材正文（materials/ch{NN}.md）
  ✓ 第 1–14 讲正文齐全（14 份）

[⑤] 发现链路（本技能包在不在扫描根下）
  …（四类扫描根逐个判：✗ 均不在）
  ✗ 本包**不在任何扫描根的直接子目录下** → 宿主扫不到它：候选 0 条、告警 0 条（双重静默）
  ✓ frontmatter name 合法：socratic-classroom（第 2 行）
  ✓ frontmatter description 非空：228 字符（第 3 行）

结论：发现 1 个问题（退出码 1）
exit=1
```

- ✅ **`[①]`–`[④]` 全绿**（含新声明后的「48 条声明路径全部存在」）。
- ⚠️ **`[⑤]` 红是工作区原地跑的既有状态**（技能包不在 `.dsh/skills` 等扫描根下）——
  **本轮没有为它动任何用户环境**（没往 `$DSH_HOME/skills`、`~/.agents/skills` 或 `.dsh/skills` 拷任何东西）。
  与上一路同口径。

### 4.2 引擎能解析新声明（`animation.enabled === true`）

```console
$ /opt/homebrew/bin/node -e "import('./plugins/socratic-engine/lib/manifest.mjs').then(...)"
format = socratic-classroom/0
classroom.id = cs-os | lessons = 14
animation = {"enabled":true}
animation.enabled === true ? true
blocks = 47 | phases = 6
top-level keys = format, classroom, phases, blocks, runtime_store, animation
```

- `classroom.yaml` **仍能被解析**（无异常、无报错）。
- `animation.enabled === true` **实测为真**。
- 块数仍是 **47**、相位仍是 **6** → **加这一段没有动任何既有块**。
- 顶层键多出的那一个正是 `animation`（与 `manifest.mjs:1193` 的"段在场才挂键"一致）。

### 4.3 全量单测：**346 全绿**（基线 321 未被破坏；另有别线新增 25）

```console
$ cd code/plugins/socratic-engine && for f in test/*.test.mjs; do echo "== $f"; /opt/homebrew/bin/node "$f" 2>&1 | grep -E "tests [0-9]+|pass [0-9]+|fail [0-9]+" | tail -3; done
== test/animation.test.mjs     ℹ tests 24  ℹ pass 24  ℹ fail 0
== test/cast.test.mjs          ℹ tests 49  ℹ pass 49  ℹ fail 0
== test/dedup.test.mjs         ℹ tests 25  ℹ pass 25  ℹ fail 0
== test/diagram.test.mjs       ℹ tests 36  ℹ pass 36  ℹ fail 0
== test/discovery.test.mjs     ℹ tests 42  ℹ pass 42  ℹ fail 0
== test/injector.test.mjs      ℹ tests 11  ℹ pass 11  ℹ fail 0
== test/lesson.test.mjs        ℹ tests 26  ℹ pass 26  ℹ fail 0
== test/manifest.test.mjs      ℹ tests 17  ℹ pass 17  ℹ fail 0
== test/phase.test.mjs         ℹ tests 38  ℹ pass 38  ℹ fail 0
== test/postclass.test.mjs     ℹ tests 36  ℹ pass 36  ℹ fail 0
== test/prep.test.mjs          ℹ tests 25  ℹ pass 25  ℹ fail 0   ← 本会话期间由**别的工作线**新增
== test/section.test.mjs       ℹ tests 17  ℹ pass 17  ℹ fail 0
```

合计 **24+49+25+36+42+11+26+17+38+36+25+17 = 346**，`fail 0` 全绿，退出码 0。

🔴 **一条必须说清的数字变化**：任务书给的基线是 **321**，我第一次跑（约 13:20）也是 **321**（11 个文件）。
**本会话进行中** `test/prep.test.mjs` 出现（**mtime 13:36:14**，配套 `lib/prep.mjs` 13:29:32／
`lib/prepstore.mjs` 13:35:42）→ 第二次数成了 **346**。
**这是别的工作线在动 `plugins/**`**（本轮对 `plugins/**` **只读**，一个字节没写）；
321 ＋ 25（prep）＝ 346，**对得上**，不是我改了测试。

### 4.3b 教室自检在技能包里的那一份

```console
$ /opt/homebrew/bin/node code/skills/socratic-classroom/validate      # 不给参数 → 检查包自带的 classroom/
[①]–[④] 全绿（同 §4.1）
[⑤] ✗ 本包不在任何扫描根的直接子目录下 → 退出码 1
```

⚠️ 这一条**是对的**：`code/skills/socratic-classroom` 确实**不在**任何扫描根下（包还没装）。
**装好的那一份**（`<工作区>/.dsh/skills/socratic-classroom/`）**现在是全绿**——见 §8.1。


### 4.4 🔴 关键证据：**模型这次真的调了动画工具**（两次真实会话）

**跑法**：教室**副本**（`rsync -a` 到 `/tmp`，**绝不写真教室**——它的 `runtime/` 是状态真源）；
`--profile socratic-headless`；两点位各一次、每次 2 轮、轮间 20 s。
脚本：`code/tools/animation-orch/verify/anim-enable-session.mjs`（本轮新增，见 §5 说明为什么不能直接用 `ab-session.mjs b`）。

| 点位 | 退出码 | 墙钟 | 副本声明 `animation` | 副本纪律含 `classroom_animate` | 模型调 `classroom_animate` | 引擎通报 |
|---|---|---|---|---|---|---|
| `interrupt`（时序类） | 0 | 222.2 s | true | true | **2 次**（T1 一次、T2 一次） | 0 条（见下） |
| `fifo`（排序／对比类） | 0 | 157.1 s | true | true | **2 次**（T1 一次、T2 一次） | **1 条（`ready`）** |

**原始记录（`interrupt` 点位，会话日志逐事件）**：

```
===== TURN 1 @0.1s =====
  [12.7s] CALL read ×3（_anchor.md / materials/ch01.md / knowledge_points.md）
  [12.8s] CALL classroom_status   → 教室 cs-os｜相位 open｜第 1 回合｜本轮要讲第 1 讲｜候选 1 个（来源 explicit）
  [68.6s] CALL classroom_draw     （flowchart：定时器中断的流程）
  [75.3s] CALL classroom_animate  （title：定时器到点，程序被停下又被接着跑）
  [75.4s] CALL classroom_set_phase {"phase":"probe"}
  --- turn/end @80.1s
===== TURN 2 @100.1s =====
  [142.0s] CALL classroom_animation_status
  [189.6s] CALL classroom_draw
  [189.7s] CALL classroom_animate  （title：CPU 只有一套寄存器：先存 A，再装 B）
  --- turn/end @193.5s
```

`classroom_animate` 的**工具返回原文**（证明"非阻塞"）：

```
动画任务 L01-T01-20260924-132407｜queued｜已排队：渲染器已启动，还没开始出帧｜第 1 讲 · 第 1 回合 · 2026-09-24 13:24
脚本 animations/L01-T01-20260924-132407/scene.py（61 行 / 2302 B，类 InterruptTimeline）｜产物 animations/L01-T01-20240924-132407/L01-T01-20260924-132407.mp4
👉 现在继续讲；渲染在后台跑，好了引擎会在后面的回合开头告诉你。
```

**时间戳证"不阻塞"**：`[75.3s] CALL classroom_animate` → `[75.4s]` 就已返回（≈0.1 s），
**同一回合它接着讲到 80.1 s**（回合结束比调用晚 4.8 s）。

**模型对学生的原话（`interrupt` T1，调用动画之前先说这一步——纪律第 1 条"先讲后调"成立）**：

> "打断它的，是硬件定时器。……CPU 收到中断，先把当前程序暂停，切到内核态，跳到内核事先登记好的中断处理程序。所以不是程序喊停——是硬件把它按住的。"

**调用之后它继续讲**（`interrupt` T1 step 4 原文）：

> "她把白板笔的笔帽按回去，退到桌边，没有催。动画还在后台渲着——那条时间轴等它好了再放。眼下她只是站着，等你想那个'凭什么'。"

#### `fifo` 点位：**渠道分工被模型自己说出来了**（这是纪律写对了的最强证据）

```
===== TURN 1 @0.0s =====
  [74.5s] CALL classroom_draw      （flowchart：队列按到达顺序排）
  [76.5s] CALL classroom_animate   （title：FIFO 为什么让长任务把短任务堵在后面（时间轴））
  --- turn/end @79.7s
===== TURN 2 @99.7s =====
  [150.7s] CALL classroom_set_phase {"phase":"probe"}
  [150.7s] CALL classroom_draw
  [150.7s] CALL classroom_animate
  --- turn/end @154.4s
```

`fifo` T2 那次 `classroom_draw` 的 **caption 原文**：

> "静态因果图：响应时间与周转时间为什么会互相打架。**它不随时间变化，所以走白板；RR 的时间轴另走动画。**留给学生的问题是：时间片拉长到与任务等长时，这张图里哪一条路径会消失。"

→ **同一步里两个渠道都用**，并明说"哪个内容走哪个渠道"。这正是 §2.3 想要的效果（不是二选一）。

#### `fifo` 点位的**跨回合就绪通报**（`ready`）——模型照通报放了动画

引擎在第 2 回合开头注入（会话日志 `seq=71`，`form=animation-notice`）：

```
你上一轮起的教学动画有结果了：L01-T01-20260924-132838（第 1 讲 · 第 1 回合）**ready** —— 已就绪：可以播了
｜标题：FIFO 为什么让长任务把短任务堵在后面（时间轴）
｜片子：L01-T01-20260924-132838.mp4（10.5 秒 / 180 KB）
→ 现在就在讲解里把它放出来：讲到那一步时直接播这段动画，并告诉学生它讲的是哪一步。（客户端会从 animations/… 读片）
```

`source`（机器可读字段）：
`{kind:'socratic-engine', form:'animation-notice', taskId:'L01-T01-20260924-132838', state:'ready', lesson:1, turn:1, durationSec:10.466341, …}`

**模型随后真的放了它**（`fifo` T2 step 1 原文）：

> "嗯。……先看屏幕上这段。"她把笔记本转过来一点，"**这是我刚才那条 FIFO 的时间轴，现在跑起来了**——A 从 0 一直占满到 100，B 和 C 被顶在 100 之后才开始。'堵住'就长这样。"
> 她**等片子走完**，才接着往下说。

#### `interrupt` 点位为什么没有通报（**如实写**）

两段动画的 `status.json` 都是 `blocked`，且**完成时刻都晚于回合边界**：

| 任务 | `startedAt`→`finishedAt` | 相对会话 | 状态 |
|---|---|---|---|
| `L01-T01-20260924-132407` | 747498 → 779317（**+31.8 s**） | 起于 75.3 s，完成于 **111.3 s** | `blocked`（闸门 BLOCK：D2、D3） |
| `L01-T02-20260924-132601` | 561751 → 585032（**+23.3 s**） | 起于 189.7 s，完成于 **213.0 s** | `blocked`（闸门 BLOCK：D1·行对、D4·行对、D2） |

- 第 2 回合 **100.1 s** 就开始了 → 那时第 1 段还在 `rendering`（终态未到）→ **通报按设计不产生**（`notices: 0` 正确，不是 bug）。
- 模型**自己发现了**：`[142.0s] CALL classroom_animation_status` 返回原文：
  `教学动画共 1 段｜在跑 0｜可播 0｜不许播/失败 1｜未通报 1` ＋ `**blocked** —— 不许播：闸门判 BLOCK：1 处阻断级画面缺陷（D2、D3；…）`
- **它照纪律第 4 条没放**（"没成就换路，不许吊着学生"）：同一回合改用 `classroom_draw` 继续讲。

> 🔴 **这一条也回答了"上一路 §4.3 路 B（老师主动查）是不是还需要"**：需要，而且**本轮又用上了**。

### 4.5 逐字核对：补的纪律与 `CLASSROOM_NOTE` 完全一致

```console
$ node -e "从 ab-session.mjs 抽 CLASSROOM_NOTE → 逐行在 _anchor.md 里查"
--- CLASSROOM_NOTE 逐字 ---
""
"- 讲到**随时间变化**的机制（进程被打断又恢复、任务按不同顺序在时间轴上流动、同一段时间轴上读出两个数）时，"
"  **用 `classroom_animate` 起一段教学动画**，不要用一张静止的图代替："
"  **先把这一步讲给学生，再调它**；它立刻返回、渲染在后台跑，好了引擎会在后面的回合开头告诉你，那时再放出来。"
"  （白板图仍走 `classroom_draw`；两者是不同渠道，不互相替代。）"
""
--- 逐行核对是否出现在 _anchor.md ---
✓（4 行全部 ✓）
全部逐字命中: true
```

### 4.6 sha256：改前／改后（教室源 ＋ 技能包副本）

| 文件 | 改前 sha256 | 改后 sha256 |
|---|---|---|
| `classrooms/cs-os/classroom.yaml` | `50aab0e3ca3d2cd14eb03bed2ccc512efa0996002a6330d8259dcc45ae635212` | `b8b765ea73bc0a12cdb9a26ce3f99c731bb542a8f77fde718ef83d9ad9654c99` |
| `classrooms/cs-os/_anchor.md` | `badbe1171791e537255ec9e744846bb2b9912d8b9eb2e72f2c540293275d1ef2` | `66d2dc11fa83a4e377484b1a159338984481d9d99848f2128aa06f7ae4268c9b` |
| `classrooms/cs-os/system_core.md` | `1c6c1505d6b24454093b129da0acad6d149fe3c72fbe433d1835376a5155ea91` | `7abc2f46423d585e6c54fd33c4924a7267e16f653e2330128b94ab7e1c53965f` |
| `skills/socratic-classroom/classroom/classroom.yaml` | `50aab0e3…（同源）` | `b8b765ea73bc0a12cdb9a26ce3f99c731bb542a8f77fde718ef83d9ad9654c99` |
| `skills/socratic-classroom/classroom/_anchor.md` | `badbe117…（同源）` | `66d2dc11fa83a4e377484b1a159338984481d9d99848f2128aa06f7ae4268c9b` |
| `skills/socratic-classroom/classroom/system_core.md` | `1c6c1505…（同源）` | `7abc2f46423d585e6c54fd33c4924a7267e16f653e2330128b94ab7e1c53965f` |

→ 源与副本**三对逐字同哈希**；`diff -rq code/classrooms/cs-os code/skills/socratic-classroom/classroom` 退出码 **0**。

### 4.7 改动面核对（用验收流水线的冻结快照做对照，不是自述）

对照基线：`code/acceptance/runs/2026-09-24_111518/frozen/`（快照时刻 **11:15:22**；本会话起点约 **13:1x**）。

| 目录 | `diff -rq` 结果 | 判定 |
|---|---|---|
| `classrooms/` | 8 处差异：`AGENTS.md`、`CLAUDE.md`、`_anchor.md`、`classroom.yaml`、`materials/ch03.md`、`runtime/session_log.md`、`system_core.md` ＋ 新增 `runtime/diagrams/` | 其中 **`_anchor.md` 与 `system_core.md` 的差异逐行看＝本轮那一处**；`classroom.yaml` 的差异**两段**＝本轮 `animation:` 段 ＋ **FIX-8 线**改的一处注释（早于本会话）；`AGENTS.md`／`CLAUDE.md`／`materials/ch03.md`／`runtime/*` 是**别的工作线**改的（本轮一个字未碰） |
| `plugins/` | 差异全部来自**上一路 ANIM-ORCH** 与别的线（`animation*.mjs`／`animtemplates.mjs`／`prep*.mjs`／`cast.test.mjs`／`tmp/draw2|draw3|fix8|t8a`…） | **本轮对 `plugins/**` 零写入**（只读跑测试） |
| `clients/`、`acceptance/`、`tools/` | 冻结快照里不含这三者 → 无法做同口径对照 | 可复核的间接证据：本轮所有写盘都落在 §0 列的四条路径上 |

⚠️ **老实说**：`clients/**` 与 `acceptance/**` 的"没碰"这一条**只有自述**（没有冻结快照可对照），
与上一路 §4.6 的处境相同。

---

## 5. 本轮新增的一个验收脚本，以及**为什么不能直接用 `ab-session.mjs b`**

`code/tools/animation-orch/verify/anim-enable-session.mjs`（**新增**）。

**原因（这不是偏好，是踩到的硬冲突）**：`ab-session.mjs` 的 `b/c` 组会**自己往教室副本追加**
```js
writeFileSync(manifestPath, `${text.replace(/\s+$/, '')}\n\nanimation:\n  enabled: true\n`)
```
而 ANIM-ENABLE 之后**仓库教室自己就带这个声明了** → 追加一次 ＝ YAML **顶层键重复**。
实测 `parseDocument` 对重复顶层键是**硬错误**（不是警告）：

```console
errors: [ 'Map keys must be unique at line 5, column 1:\n\n\nanimation:\n^\n' ]
```

→ 会话会在装载期直接起不来。所以本轮另写一个**不加任何声明**的脚本：
它只把仓库教室**原样 `rsync` 到 `/tmp`**，其余（渲染器路径、闸门、多轮 driver、20 s 轮间）与 `ab-session.mjs` 同口径。
**没有改动 `ab-session.mjs`**（它属于上一路，且它的 b/c 组语义仍然正确——只是对本轮这个教室不再适用）。

---

## 6. 未做到 / 未取证 / 待确认

### 6.1 🔴 待办（部署侧，**不改就不算真启用**）

| # | 事项 | 现状 | 后果 |
|---|---|---|---|
| 1 | **profile 的 `socratic-engine` config 里配 `animation.python` / `animation.manim`（可选 `quality` / `gate` / `gatePython`）** | **未配**（本轮的会话是**临时 patch 注入**的路径） | 教室声明了 `animation:` 而部署没配 → **引擎装载时报错**（`index.mjs:283-296` 的 `checkAnimationRuntime`）。⚠️ **任何用 `code/classrooms/cs-os` 跑真实会话/验收的路径，都会先撞到这条** |
| 2 | `gate` / `gatePython` 要不要默认配上 | 未配（现状＝不过闸门） | 不配 → 片子**不过质量闸门直接 `ready`**。本轮实测：配上闸门后两段 `interrupt` 动画被判 `blocked`——**闸门确实在拦东西**（但闸门是另一条工作线的产物，其判据未复核） |
| 3 | 真教室 `runtime/` 的 `animations/` 目录 | 尚未产生（本轮只写 `/tmp` 副本） | 无影响：引擎按需创建 |

### 6.2 未取证

| # | 事项 | 为什么 |
|---|---|---|
| 1 | `system_core.md` 那一句的**增量作用** | 两个点位都是"两处都补"，没做"只补 `_anchor.md`"的对照 → 它的必要性是**推断**（照白板那条的对称性），不是实测 |
| 2 | **n 很小** | 每点位只跑 1 次会话（共 2 次、4 次调用）。上一路已实测"会话间方差极大"，**本轮不足以给出"纪律有效"的统计结论**；只能说"在这 2 次里工具被用起来了" |
| 3 | 客户端播放那半 | `code/clients/**` 本轮未碰（也不在可改范围）→ "学生真的看到画面"仍只到"引擎把 mp4 放好 ＋ 通报送达老师" |
| 4 | 闸门 BLOCK 的判据是否合理 | 闸门属另一条工作线；本轮只按命令行契约调用，`D2/D3/D1·行对/D4·行对` 的阈值来源**没有复核** |
| 5 | 高画质（`-qh`）下的表现 | 本轮全用 `quality: l` |

### 6.3 待确认清单（**需要用户或维护方拍板**；本轮按默认继续、未阻塞）

| # | 问题 | 选项 | 我的倾向 |
|---|---|---|---|
| 1 | 上面 §6.1-1 的渲染器路径要不要现在写进 `socratic-headless`（或目标 profile）的 config | ①写（`poc_动画可写性/env/bin/{python,manim}`）②不写 | **倾向写**——不写则教室声明了也装载失败；但**写 profile 不在本轮授权内**，需要主代理/用户决定 |
| 2 | 动画渠道纪律里的**第一行引导句**（"白板是当场画的板书／动画是讲过程"）与**末行"本条只管渠道"**要不要保留 | ①保留（现状）②删掉只留 `CLASSROOM_NOTE` 原文 | **倾向保留**——分工必须写在同一处，否则模型会二选一；`CLASSROOM_NOTE` 的 4 行核心**一字未动**。若维护方要求"严格逐字"，删掉这两行即可（§2.2 已标明哪两行是本轮新增） |
| 3 | `system_core.md` 那一句要不要留 | ①留（现状）②删 | **倾向留**（与白板那条对称）；若嫌重复可删，不影响 `_anchor.md` 的每轮注入 |
| 4 | `_anchor.md` 这一段的**体量**是否还符合"保持简短" | — | 现状：文件 34 行 → **40 行**；新增 6 行（含引导句与末行）。纪律层每轮注入，**这是它的成本**；若嫌重，可只保留 4 行 `CLASSROOM_NOTE` 原文（省 2 行） |
| 5 | `anim-enable-session.mjs` 要不要保留 | ①保留（现状，作为本轮的复现入口）②删 | **倾向保留**——`ab-session.mjs b` 对已带声明的教室会崩（§5），下一个会话需要一个可跑的入口 |

---

## 7. 产出清单

```
开源线/DSH定制/
├── 实现报告_ANIM-ENABLE_教室开动画_2026-09-24.md      ← 本报告
└── code/
    ├── classrooms/cs-os/classroom.yaml                ← 改：+ 顶层 animation 段（enabled: true）
    ├── classrooms/cs-os/_anchor.md                    ← 改：+「本课不许违反项」动画渠道纪律
    ├── classrooms/cs-os/system_core.md                ← 改：「课中」那一条句内 + 一句动画渠道
    ├── skills/socratic-classroom/
    │   ├── classroom/**                               ← 由 sync-classroom.sh 同步（与源零差异）
    │   ├── validate                                   ← 改：⑤ 改按路径形状判；改用自带解析器
    │   ├── lib/mini-yaml.js                           ← 新增：自带的单文件 YAML 解析器（零依赖）
    │   ├── README.md                                  ← 改：「依赖来源」节改为"零依赖，不需要 node_modules"
    │   └── package.json                               ← 改：description 说明零依赖
    │   └── node_modules/                              ← **删除**（自包含）
    └── tools/animation-orch/
        ├── verify/anim-enable-session.mjs             ← 新增：本轮的真实会话验收脚本
        └── evidence/anim-enable-interrupt.json        ← 新增：interrupt 点位原始记录
            evidence/anim-enable-fifo.json             ← 新增：fifo 点位原始记录
```

**引擎侧零改动**：`code/plugins/**` 本轮只读（§4.7 用冻结快照核对）。

---

## 8. 追加两件（技能包侧的真缺陷，2026-09-24 下半场）

> 来源：主代理把技能包装到 `<工作区>/.dsh/skills/socratic-classroom/` 之后实测发现的两个真缺陷。
> **两件都已修好并各自贴了验收原始输出。** 本节独立成节，不改上面 §1–§7 的任何结论。

### 8.1 缺陷①：自检第 ⑤ 项"装对了却报红"——**已修**

#### 复现（修之前，逐字）

```console
$ # 工作区无 .git；把包正确装到 <工作区>/.dsh/skills/socratic-classroom
$ cd /tmp/anim-enable-skillws/.dsh/skills/socratic-classroom && node ./validate
[⑤] 发现链路（本技能包在不在扫描根下）
  本包位置：/private/tmp/anim-enable-skillws/.dsh/skills/socratic-classroom
  项目根（只认 .git）：/private/tmp/anim-enable-skillws/.dsh/skills
    ⚠️ 向上没找到 .git → 项目根**回落成了本包的父目录**
    ✗ 不在  项目级 · .dsh/skills  →  …/.dsh/skills/.dsh/skills（该根当前不存在）   ← 废话
  ✗ 本包**不在任何扫描根的直接子目录下** → 宿主扫不到它
    请把本包放到：…/.dsh/skills/.dsh/skills/socratic-classroom                     ← 废话
结论：发现 1 个问题（退出码 1）
```

**而事实相反**：该工作区的技能列表里**已经出现了 `socratic-classroom`**（宿主确实发现了它）。

#### 根因（一句话）

判定链条是 `本包父目录 === <项目根>/.dsh/skills`，而"项目根"是**推断**出来的：
从本包父目录向上找 `.git`，**工作区没有 `.git`** → 回落成**本包父目录自己**（＝`.dsh/skills`）
→ 候选路径变成 `.dsh/skills/.dsh/skills` → **必然不匹配**。**靠推断值当判据，就会系统性假红。**

#### 修法（按主代理给的方向）

**改成按"路径形状"判定，不靠推断项目根**（`validate` ⑤ 段）。判"在扫描根下"当且仅当满足任一：

| # | 条件 | 说明 |
|---|---|---|
| ① | 本包父目录 ＝ 某个**已知**扫描根 | 两条项目级（`--project-root` 显式时）＋ 两条用户级（`$DSH_HOME/skills`、`~/.agents/skills`） |
| ② | 本包路径里出现 `.dsh/skills/<包名>` | **不需要知道项目根在哪**——形状本身就是宿主要的那个条件 |
| ③ | 本包路径里出现 `.agents/skills/<包名>` | 同上 |

配套三处小修（都是这次实测暴露出来的）：
1. **项目根回落时不再列"项目级"两条候选**（它们的值＝`<扫描根>/skills`，是废话），改印一行说明 +
   提示加 `--project-root`；**判定不受影响**。
2. 🔴 **四条扫描根的后缀不是同一个**：项目级是 `<项目根>/.dsh/skills` 与 `<项目根>/.agents/skills`，
   用户级才是 `$DSH_HOME/skills` 与 `~/.agents/skills`。
   修之前四条一律写成 `<base>/skills` → `--project-root` 那一组会打印 `<项目根>/skills` 这种
   **不存在的路径**（显示错、判定对；但显示错会让人照它去建目录）。已改成 `suffix` 逐条给。
3. "建议路径"的基准在回落场景改用**回落值的上一级**，并**明说这是猜的**（要准就加 `--project-root`）。
   —— 这一条只影响**建议**文案，不影响判定。

#### 验收（**四组 ＋ 两组额外**，全部是修后的原始输出）

| # | 场景 | 期望 | 实际 | 退出码 |
|---|---|---|---|---|
| 1 | **装对**：`<工作区>/.dsh/skills/socratic-classroom`（工作区**无** `.git`） | **绿** | `✓ 在扫描根下：路径形状：…/.dsh/skills/<包名>` ＋ ①–④ 全绿 | **0** ✅ |
| 2 | **故意放错**：`/tmp/anim-enable-wrongroot/socratic-classroom` | 红 | `✗ 本包不在任何扫描根的直接子目录下` ＋ 三条可复制建议 | 1 ✅ |
| 3 | **`name` 非法**：改成 `Socratic_Classroom` | 红 | `✗ frontmatter name 非法` ＋ 明说"宿主报 invalid skill name 并静默跳过" | 1 ✅ |
| 4 | **`--project-root` 校准**：装对 ＋ `--project-root /tmp/anim-enable-skillws` | 绿 | `✓ 在  项目级 · .dsh/skills  [project-dsh rank=100]  →  /tmp/anim-enable-skillws/.dsh/skills` | **0** ✅ |
| 5 | 额外：**用户级 `$DSH_HOME/skills`**（`DSH_HOME=/tmp/anim-enable-fakedsh`） | 绿 | `✓ 在扫描根下：用户级 · $DSH_HOME/skills[user-dsh rank=400]` | **0** ✅ |
| 6 | 额外：**没装**（`code/skills/socratic-classroom` 原地） | 红（**应当**红） | `✗ 不在任何扫描根的直接子目录下` | 1 ✅ |

🔴 **"装对却报红"这一例已消掉**——而且是在**两处**同时消掉的：
① 临时工作区（场景 1，上面第 1 行）；
② **主代理实际装的那个位置** `<工作区>/.dsh/skills/socratic-classroom/`（§8.1b）。

#### 8.1b 我把工作区里那一份也刷新了（**如实说明**）

主代理装在 `<工作区>/.dsh/skills/socratic-classroom/` 的那一份**仍是修之前的旧代码**，
所以它**当时还在报红**。我做了：

```console
$ rsync -a --delete 开源线/DSH定制/code/skills/socratic-classroom/ .dsh/skills/socratic-classroom/
$ diff -rq 开源线/DSH定制/code/skills/socratic-classroom .dsh/skills/socratic-classroom
（零差异，exit=0）
$ cd .dsh/skills/socratic-classroom && node ./validate
[①]–[④] 全绿
[⑤]  ✓ 在扫描根下：路径形状：…/.dsh/skills/<包名>
结论：全部通过（退出码 0）
```

⚠️ **如实说两点**：① 这**动了工作区里的一份副本**（不在任务书点名的两个目录里）——
理由是"装对却报红"那一例的**事实现场就在那里**，不刷新就无法证明修好了；
② `--delete` 顺带删掉了那份副本里的 `node_modules/yaml`（正是 §8.2 要去掉的东西）。
**真源仍是 `开源线/DSH定制/code/skills/socratic-classroom/`**；安装点是它的镜像。

### 8.2 缺陷②：技能包必须"自包含"——**已修（改成零依赖）**

#### 复现（修之前）

```console
$ rsync -a --exclude node_modules <包>/ <临时目录>/socratic-classroom/
$ cd <临时目录>/socratic-classroom && node ./validate
错误：找不到 YAML 解析器（require('yaml') 失败）：Cannot find module 'yaml'
查找位置：<包>/node_modules/yaml
本技能包应自带该依赖（见 README.md「依赖来源」）。缺了它就无法检查 classroom.yaml，故直接失败，不跳过检查。
>>> exit=2          ← "残包"：SKILL.md 合法 → 宿主照样发现它、模型能加载，却跑不了自检
```

#### 两种修法的取舍，以及**我选哪种、为什么**

| 方案 | 优点 | 缺点 | 判定 |
|---|---|---|---|
| **A. 包里带上必需依赖（`node_modules/yaml`）并在 README 写明** | 解析器与宿主引擎同一实现，语义天然一致 | 🔴 **要靠"复制的人不忽略 node_modules"**——而忽略它恰恰是最常见的做法（`rsync --exclude`、`.gitignore`、打包工具默认行为）。**这个坑已经被踩到一次了，靠约定防不住第二次**；且包体积翻倍、还带一份第三方 LICENSE 需要维护 | ❌ 不选 |
| **B. 自带单文件解析器（`lib/mini-yaml.js`），**彻底不依赖 `node_modules`** | 🔴 **分发时不可能坏**（没有可以漏掉的东西）；包更小；依赖面归零 | 需要自己维护解析器，且**必须证明它不会"静默少报"** | ✅ **选这个** |

**选 B 的理由一句话**：A 的失败模式是**静默的**（装上了、能加载、自检崩），
而技能加载失败本来就全是 `logger.warn` 后跳过、**模型侧拿不到任何诊断**——
把"能不能自检"押在"复制的人记得带上 `node_modules`"上，等于把最不该静默的那一环交给约定。
B 把这个失败模式**从根上删掉**。

#### `lib/mini-yaml.js` 的划界（**写进文件头，遇到不支持的就报错**）

- **支持**：块映射、块序列、序列里的映射、flow 映射 `{}`、flow 序列 `[]`、单/双引号标量、
  块标量 `|` / `>`（含 `-` `+` chomping）、注释、空行、`true/false/null/~`、整数、浮点、CRLF、BOM。
- **不支持（遇到就报错，绝不静默给错值）**：锚点 `&`／别名 `*`、标签 `!!`、多文档 `---`、
  复杂键 `? `、制表符缩进。
- 🔴 **对齐了本包真正在意的那条语义：重复键报错**（`Map keys must be unique`）——
  引擎侧走 `yaml` 的 `parseDocument`，重复顶层键是**硬错误**（实测）。
  自检若把它当正常值读，就会给出"全绿"而引擎装载却炸。
- 🔴 **另一条对齐**：**裸冒号标量报错**（宿主 `yaml` 报
  `Nested mappings are not allowed in compact mappings`）。实测 `d: 文本: 还有冒号`
  → 宿主 `yaml` **报错**；本解析器**同样报错**（要写这种值就加引号）。
  这正是"不静默少报"的具体样子。

#### 与宿主 `yaml` 包的**逐字节对照**（不是我自述"够用"）

```console
$ # 本仓库全部 5 份 classroom.yaml：cs-os ＋ 4 份引擎测试 fixture
✓ classrooms/cs-os/classroom.yaml                                    与 yaml 逐字节同构
✓ plugins/socratic-engine/test/fixtures/minimal-classroom/classroom.yaml   与 yaml 逐字节同构
✓ plugins/socratic-engine/test/fixtures/cast-classroom/classroom.yaml      与 yaml 逐字节同构
✓ plugins/socratic-engine/test/fixtures/cast-teacher-only/classroom.yaml   与 yaml 逐字节同构
✓ plugins/socratic-engine/test/fixtures/section-anchor/classroom.yaml      与 yaml 逐字节同构
（判据：JSON.stringify(宿主 yaml 结果) === JSON.stringify(mini 结果)）
```

边界与报错行为对照（13 组）：

| 输入 | 宿主 `yaml` | `mini-yaml` | 一致？ |
|---|---|---|---|
| 重复顶层键 / 重复嵌套键 / 序列项重复键 | ERR `Map keys must be unique` | ERR（带行号与首次出现行） | ✅ |
| 多文档 `---` | ERR | ERR | ✅ |
| 制表符缩进 | ERR `Tabs are not allowed as indentation` | ERR | ✅ |
| 裸冒号 `d: 文本: 还有冒号` | ERR `Nested mappings…` | ERR | ✅ |
| 引号里的冒号 `d: "文本: 还有冒号"` | OK | OK | ✅ |
| `u: http://a/b`（冒号后非空白） | OK | OK | ✅ |
| 引号里带 `#` / 内联注释 / CRLF / 空文件 / 只有注释 | OK | OK | ✅ |
| 锚点 `a: &x 1` | OK（宿主支持） | **ERR（明确不支持）** | ⚠️ **有意不一致**（报错，不静默） |
| 标签 `a: !!str 1` | OK | **ERR（明确不支持）** | ⚠️ 同上 |

> ⚠️ 最后两行是**有意的**：`mini-yaml` 不假装支持锚点/标签，**遇到就报错**。
> 若将来真在 `classroom.yaml` 里用了它们，自检会**明说"不支持"**而不是给错值——
> 这是刻意的取舍，已写进文件头。

#### 验收（**干净临时目录、不带 `node_modules`**）

```console
$ rsync -a --exclude node_modules <包>/ /tmp/anim-enable-clean/.dsh/skills/socratic-classroom/
$ ls -a /tmp/anim-enable-clean/.dsh/skills/socratic-classroom/
.  ..  README.md  SKILL.md  classroom  lib  package.json  sync-classroom.sh  validate
$ test -e .../node_modules && echo 有 || echo 无
无
$ cd /tmp/anim-enable-clean/.dsh/skills/socratic-classroom && node ./validate
[①]–[④] 全绿
[⑤]  ✓ 在扫描根下：路径形状：…/.dsh/skills/<包名>
结论：全部通过（退出码 0）
>>> exit=0
```

🔴 **不许报"残包"** —— 已达成：**退出码 0**，报的是**真问题**（`在不在扫描根下`），
**不是**"缺依赖而崩"。而且**包里现在没有 `node_modules` 可漏**
（`rsync --exclude node_modules` 与 `cp -a` 两种复制方式结果一样）。

### 8.3 追加部分的 sha256（改后）

| 文件 | sha256 |
|---|---|
| `skills/socratic-classroom/validate` | `a7d423258a1b444d7daf200f6a612584aaa882dc1df85f14b23c3027ff8327c9` |
| `skills/socratic-classroom/lib/mini-yaml.js` | `66295c268a7c42cf8586a5e603a1f5b42ab2f92a57f4e15fdb62e02847ec5441` |
| `skills/socratic-classroom/README.md` | `b52a09c3f7b6c51ae4304c13efcc87644339071029f2951c4764e863273d1e5f` |
| `skills/socratic-classroom/package.json` | `09971822ff50c85b3cf79f3d2c81dcba1d31f85c7fa7b7a289e1798972ca70de` |
| `skills/socratic-classroom/SKILL.md` | `b547f8bfedc68970cdc123d0820b755aabbdb148e12fc2f35ea7cff1b3f54c6e`（**未改**） |
| `skills/socratic-classroom/sync-classroom.sh` | `58e7f7726011c0984c3d896c1009c1685e91ff7422b11b54281054c0f8adecff`（**未改**） |

`classroom/**` 未受影响：`diff -rq code/classrooms/cs-os code/skills/socratic-classroom/classroom` 退出码 **0**（§3 同口径）。

### 8.4 追加部分的待确认

| # | 问题 | 选项 | 我的倾向 |
|---|---|---|---|
| 1 | `lib/mini-yaml.js` 要不要**再加一层"可选回退到 `yaml` 包"**（包里有 `node_modules/yaml` 就用它） | ①加（双路）②不加（现状，纯自带） | **倾向不加**：双路＝两条语义、两种失败模式，而本包要的只是"读一份清单"。**单一实现 + 逐字节对照**更好查；而且回退路径会让"装的时候带没带 node_modules"重新变成变量 |
| 2 | 要不要**把这套自检也接进验收流水线**（`code/acceptance/**` 不归我改） | ①接 ②不接 | 倾向接，但**不在本轮授权内**——留给主代理决定 |
| 3 | 我**刷新了 `<工作区>/.dsh/skills/socratic-classroom/`**（§8.1b） | ①保留刷新 ②回退成旧版 | **倾向保留**——不刷新则"装对却报红"这一例在事实现场仍然存在；若希望安装点保持旧版，回退命令：`rsync -a --delete code/skills/socratic-classroom/ .dsh/skills/socratic-classroom/`（再手动放回 `node_modules/yaml`） |
| 4 | **仓里还有几处"旧口径"的文字没跟着改**（不在我可改范围内，**未动**） | ①另行更新 ②不动 | **倾向另行更新**（下一路小修即可）。清单：`开源线/DSH定制/分发证据/README.md`、`分发证据/取证_机制与落点_2026-09-24.md`、`分发证据/验证_技能包安装/**`（那是一份**旧的安装副本**，含 `node_modules/yaml` 与旧 `validate`）、`取证_I2_集成实测_2026-09-24.md`、`实现报告_FIX5_层数口径统一_2026-09-24.md` —— 它们都还写着"依赖 `node_modules/yaml`" |
| 5 | `plugins/socratic-engine/接线说明_S2.md` 里也提到 `node_modules/yaml` | ①确认是否指引擎自己的依赖 ②需更新 | **推断是引擎自己的依赖**（引擎确实声明 `yaml`），与技能包无关 → **倾向不动**；标注【推断／待确认】 |

