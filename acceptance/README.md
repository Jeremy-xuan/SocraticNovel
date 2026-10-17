# acceptance/ — 验收流水线

一条命令跑完「**冻结 → 装载 → 真实课堂 → 六条断言 → 归档**」，用**端到端真跑**来回答一个问题：

> 这套「教室包 + 教学引擎」交给一个真实的 AI 之后，**上课这件事真的按设计发生了吗？**

它不是单元测试的替代品，也不看代码写得漂不漂亮。它只认**落盘真相**：
宿主持久化下来的会话事件流、被写过的教室文件、被引擎打出来的日志。

---

## 1. 怎么跑

**从仓库任意位置调用都可以**（所有路径按仓库根解析，脚本内部没有任何绝对路径）。

```bash
# 完整跑：真的跑一次多轮会话（会花钱，约 2–3 轮）
./acceptance/run.sh

# 省钱路径：只验「冻结 + 装载 + 逐文件哈希复核 + 技能包自检 + 零接触写足迹守卫」
./acceptance/run.sh --skip-session

# 复用已有专用 profile（默认每次从 shipped 模板重建，保证干净起点）
./acceptance/run.sh --keep-profile

# 改轮数（1..4）
./acceptance/run.sh --turns 2
```

### 退出码

| 码 | 含义 |
|---|---|
| `0` | 六条断言全通过（完整跑）／完整性守卫全通过（`--skip-session`） |
| `1` | 有断言失败，或完整性守卫失败，或流程致命错误 |
| `2` | **环境不成立**：找不到 node／dsh CLI，或 `DSH_HOME` 没隔离 |

> 🔴 **`--skip-session` 拿到 `1` 未必是坏了** —— 最常见的两种"设计如此"的 `1`：
> ① **教室声明了 `animation:` 而渲染环境没配**（见下一节，**必须**配 `SOCRATIC_ANIMATION_ENV_DIR`／
> `SOCRATIC_ANIMATION_GATE`，否则 `--skip-session` 也会 exit 1）；
> ② **隔离的 `DSH_HOME` 里没装技能副本**（`skillInstalledCopyDiscoveryChain=skipped-not-installed`，
> 口径是"未安装＝没验，不是通过"）。
> 另外，若你设了 `ACCEPT_NEGATIVE_CONTROL` 却走 `--skip-session`，本次**一律判红**（见 §4）。

### 🔴 教学动画：教室声明了它，`--skip-session` 就**必须**配好渲染环境

现盘的 `classrooms/cs-os/classroom.yaml` **声明了**顶层 `animation: {enabled: true}`。
引擎的设计是「**教室声明了动画、但部署没配渲染环境 → 装载时报错**」（有意为之，不静默降级），
所以本流水线在阶段①就会**大声失败**并打印怎么配 —— **这条省钱路径也一样**：

```bash
# 🔴 不配这两个变量 → `--skip-session` 也会 exit 1（这是设计行为，不是 bug）
SOCRATIC_ANIMATION_ENV_DIR=<venv 的 bin/> \
SOCRATIC_ANIMATION_GATE=<animation_gate.py> \
  ./acceptance/run.sh --skip-session
```

`--skip-session` 不 boot 引擎，所以它**只验"渲染环境指得对不对"**（文件在不在、可不可执行），
**不验**"引擎真的认了它"（那要一条 `装载自检通过` 日志，只有完整跑才有）。
不想在这台机器上验动画，就用显式降级（会留痕，不是静默跳过）：

```bash
./acceptance/run.sh --skip-session --disable-classroom-animation \
  --animation-disable-reason "<为什么这台机器上关掉>"
```

### 🔴 跑之前必须知道的一件事：`DSH_HOME` 是**隔离**的

本流水线会建 profile、装插件、跑会话 —— 也就是会**写 `$DSH_HOME` 下的一堆东西**。
所以它**拒绝**在用户真实 harness 上跑：

- `ACCEPT_DSH_HOME_ROOT`（默认 `$TMPDIR/socratic-accept-dsh`）＝本次运行的隔离根；
- `DSH_HOME` 必须落在隔离根**之下**，否则 `run.sh` 直接 `exit 2`（并告诉你两种改法）；
- 它还会额外拒绝含 `Library/Application Support` 或 `dsh-desktop` 的路径。

```bash
# 正常用法：什么都不用设（自动用 $TMPDIR 下的隔离根）
./acceptance/run.sh --skip-session

# 想换隔离根：
ACCEPT_DSH_HOME_ROOT=/tmp/my-accept-root ./acceptance/run.sh --skip-session
```

> ⚠️ **为什么是"硬判"而不是"默认值兜底"**：本环境的 `DSH_HOME` 环境变量**本来**就指向真 harness，
> 写成 `DSH_HOME="${DSH_HOME:-隔离默认值}"` 是**无效**的 —— 它会安静地选中真 harness。
> 这条坑实测踩过（连跑 4 次都跑在真 harness 上，会话记录写进了真实 sessions 目录）。

### 想拿到一次"全绿"的 `--skip-session`？

现盘的教室声明了动画，所以要**同时**满足两件事：

1. **渲染环境指得着**（见上一节的两个环境变量；或显式降级）；
2. **隔离的 `DSH_HOME` 里装着技能副本** —— 技能包自检有一半是「宿主能不能发现这个技能」，
   它查的是**本次 `DSH_HOME` 下的** `skills/socratic-classroom`。隔离的家目录里当然没有它，
   于是那一项报 `⚠️ 未安装、该检查跳过`，而**这一项没验到就不算通过**（守卫判红，退出码 1）。
   把包放进**隔离的**那个家目录即可：

```bash
ISO="${ACCEPT_DSH_HOME_ROOT:-$TMPDIR/socratic-accept-dsh}/harness"
mkdir -p "$ISO/skills"
cp -R skills/socratic-classroom "$ISO/skills/"

SOCRATIC_ANIMATION_ENV_DIR=<venv 的 bin/> SOCRATIC_ANIMATION_GATE=<animation_gate.py> \
  ./acceptance/run.sh --skip-session     # → 退出码 0
```

（只往**隔离**目录里放，绝不碰用户的真实 `$DSH_HOME/skills`。）

---

## 2. 不花钱的机核（都可以直接跑，退出码 0 ＝ 一致）

| 命令 | 验什么 |
|---|---|
| `node acceptance/footprint-self-test.mjs` | 写足迹守卫自检：正常足迹判绿、**越界写入必须判红**、受保护 profile 的归因对不对、静态扫描抓不抓得到绕开 ledger 的写调用 |
| `node acceptance/whitelist-self-test.mjs` | 宿主告警白名单自检：白得有理、负向真的会红、每条规则都写明理由 |
| `node acceptance/frequency-parity.mjs` | 「某回合该注入哪些块」这件事**两份独立实现**（生产侧 `planTurnInjections` ↔ 验收侧 `predictTurnBlocks`）逐格比对 ＋ 负向对照 |
| `node acceptance/dynamic-blocks.test.mjs` | A2 推导模型里两类**运行期动态块**（`prep-list:` / `animation-notice:`）的折算与推导单测；另有**关系断言**（从教室 manifest 自身推导讲次上界与结构）＋ 8 条负向对照 |
| `node acceptance/a2-replay.mjs` | 拿**已有跑**的会话事件流离线复评 A2（不跑会话、不花钱）。⚠️ 需要 `runs/` 下至少有一次完整跑，否则如实报「无可复评对象」并退出 1 |

> 🔴 **为什么 `dynamic-blocks.test.mjs` 不写死"应该有哪些讲次、每讲几条"**：
> 写死常量有两个毛病 —— ① 教室改一次课程表测试就红，而**红的原因不是缺陷**，
> 于是下一个人顺手把常量改掉，这条断言慢慢退化成"记录现状"；
> ② 它**验不到结构**（`material` 指到不存在的文件、`lesson` 写成 99 都照样绿）。
> → 现在是**关系断言**：上界取教室自己声明的 `classroom.lessons`，会话讲次取"第一个有备课条目的讲"，
> "无备课条目的讲"取 1..讲数里的**空缺**，"条数超上界"发**声明条数 +1** 条；
> 结构判据另配 8 条**故意写坏**的副本证明它真的会红。

---

## 3. 它到底验什么

### 六条断言（完整跑才有）

| # | 断言 | 判定依据（都取**落盘真相**，不取插件自己的日志） |
|---|---|---|
| A1 | **材料按讲次给** —— 不提前剧透后面讲次的故事节点 | 本回合注入的 story 块 vs 教室 manifest 的讲次门 |
| A2 | **材料按环节给** —— 换环节后材料集合变化 | 期望块清单由本流水线**独立重推**（不调用被测的 `injector.mjs`），与真实注入逐回合比对 |
| A3 | **工具可用** —— 能查到教室状态与当前讲次／环节 | 会话事件流里的工具调用与返回 |
| A4 | **课后写入** —— 追加新内容，且**重复结束不重复追加** | 教室 `runtime/` 的实际变化 ＋ 幂等重放探针（对同一 turn 连发两次 turn-ending） |
| A5 | **不重复送** —— 同一回合内没把同一份材料送两遍 | 注入块的内容哈希 |
| A6 | **静默失败检查** —— 插件有没有把错误吞掉；宿主告警有没有**非白名单**新条目 | 日志桥收到的全部 cordis 消息 ＋ `lib/whitelist.mjs` 的归属判定 |

### 完整性守卫（失败同样让退出码非零）

1. **零接触**：本流水线自己的每一次写盘都在白名单内；命令里没有受保护 profile；受保护 profile 的变化**不在**我们的写足迹里 → 才判绿。
2. **被测模型不许读到验收脚手架**：把会话里所有工具调用参数拼起来找验收目录／脚本名，命中即判失败（否则模型可以照着断言调整行为）。
3. **冻结目录跑完后仍与清单一致**：证明被写的是工作副本，不是冻结的那一份。
4. **教学动画的装载期自检真的跑过**（教室声明了动画时）——"渲染环境真的被引擎认了"的唯一直接证据。
5. **技能包自检两份都跑**：源包判**内容**、已装副本判**发现链路**。

> 🔴 **第三态必须显式写出来**：`未安装＝没验，不是通过`；`教室没声明动画＝本项不适用，不是通过`。
> 报告里有固定的「哪些检查**不适用**」一节，守卫值里用 `not-applicable（…）` 表示 —— 它**既不假装通过，也不判失败**。

---

## 4. 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `ACCEPT_DSH_HOME_ROOT` | `$TMPDIR/socratic-accept-dsh` | **隔离根**：`DSH_HOME` 必须在它之下 |
| `DSH_HOME` | `$ACCEPT_DSH_HOME_ROOT/harness` | 本次运行的 DSH 家目录（必须隔离，否则拒绝运行） |
| `DSH_BIN` | 探测：PATH 上的 `dsh` → 已知安装位置 | dsh CLI 入口（`…/@deepseek-ai/dsh/lib/bin.js`） |
| `ACCEPT_NODE` | 探测：真实 node（绕开 DSH Desktop 的 Electron 壳） | 用哪个 node 跑 |
| `ACCEPT_PROFILE` | `socratic-accept` | 专用测试 profile 名（`web`／`desktop`／`desktop-safe-mode` 一律拒绝） |
| `SOCRATIC_ANIMATION_ENV_DIR` | 无 | 🔴 **教室声明了 `animation:` 时必填**（不填 → 连 `--skip-session` 也 exit 1）：渲染环境目录（含可执行 `python` 与 `manim`）；绝对路径或仓库相对路径 |
| `SOCRATIC_ANIMATION_GATE` | 无 | 🔴 同上，必填：动画闸门脚本（`.py`，可读即可） |
| `SOCRATIC_ANIMATION_PYTHON` / `SOCRATIC_ANIMATION_MANIM` | 无 | **另一套写法**（引擎自己读的那套）：直接给 python／manim 的**完整路径**，与上面二选一 |
| `ACCEPT4_NEGATIVE_CONTROL=outside-write` | 关 | **负向对照**：故意在允许写的位置之外写一个文件 → 本次守卫**本来就该判红**（两条路径都生效） |
| `ACCEPT_NEGATIVE_CONTROL=1` | 关 | **负向对照**：探针故意打一条不在白名单里的宿主告警 → A6.5 **本来就该判红**。⚠️ 它**靠会话里的探针执行**：配 `--skip-session` 时探针不会跑 → 本次**一律判红**（请求没被满足 ≠ 请求通过），结论里记 `negativeControlProbe` |
| `ACCEPT_SESSION_RETRIES` / `--session-retries` | 2 | 某轮以 error 结束时整场重跑的次数 |
| `ACCEPT_SESSION_TIMEOUT_MS` | 2400000 | 单次会话进程超时 |

---

## 5. 目录与纪律

```
acceptance/
├── run.sh                    # 唯一入口（隔离硬判 + 探测 node/dsh）
├── accept.mjs                # 主流程：阶段 0 预检 → 1 冻结 → 2 装载 → 3 会话 → 4 断言 → 5 结论
├── lib/
│   ├── util.mjs              # 环境解析、进程调用、文件树哈希、落盘（全部经 ledger）
│   ├── footprint.mjs         # 写足迹白名单 + 归因 + 静态扫描（零接触守卫的实现）
│   ├── freeze.mjs            # 冻结与清单复核
│   ├── profile.mjs           # 专用 profile 的创建／装载／逐文件哈希复核
│   ├── asserts.mjs           # 六条断言 + 期望块清单的**独立重推**
│   ├── sessionlog.mjs        # 会话事件流的定位与解析
│   ├── whitelist.mjs         # 宿主告警归属白名单
│   ├── skillcheck.mjs        # 技能包自检（源包／已装副本）
│   ├── animation.mjs         # 教学动画渲染环境的探测与配置（不硬编码路径）
│   └── degrade.mjs           # 显式降级的跨运行留痕
├── probe/                    # 在**会话子进程**里跑的探针
│   ├── accept-driver.mjs     # 多轮驱动（同一会话连发 N 次 followup）
│   ├── log-bridge.mjs        # 日志桥（cordis 默认不落任何地方）+ 调用形状对照
│   └── idempotency-replay.mjs# 幂等重放（对同一 turn 连发两次）
└── *.test.mjs / *-parity.mjs / *-self-test.mjs / a2-replay.mjs   # 见 §2
```

**纪律（违反即失败）**

- 只写 `acceptance/**`；**不改** `plugins/**`、`classrooms/**`、`skills/**`、`clients/**`。
- **绝不碰用户的真实 DSH profile**：`DSH_HOME` 必须隔离；`web`／桌面 profile 只在运行前后做只读哈希快照比对。
- 装完**逐文件核对哈希**，不一致就失败退出。
- 绝不把任何 `@deepseek-ai/*` 包装进 profile 或插件的 `node_modules`（会造成宿主包双实例、Symbol 失配 → 工具调用崩溃）。
- 所有写盘都经 `lib/footprint.mjs` 的 ledger 原语；绕开它会被静态扫描抓出来。

**每次运行都留下**（`runs/<时间戳>/`，不入库，见 `.gitignore`）：

```
00-preflight/   环境快照、写足迹白名单、profile 前后快照、阴性对照
01-freeze/      冻结清单（SHA256SUMS）＋当场复核 ＋ tested-fingerprint.json（被测对象指纹）
02-install/     profile 初始化与装载日志、逐文件哈希复核、deps.json（**派生**的运行时依赖）、技能包自检
03-session/     会话原始事件流、教室前后状态、污染守卫
04-asserts/     六条断言的结果与原始证据
05-conclusion/  结论、零接触写足迹复核、人读报告
```

**人读报告的首三行是"被测对象指纹"**（`acceptance/验收报告_最新.md`）：
**冻结的那一份**（本次实际跑的）与**现盘的那一份**（报告生成时复核的）两个 sha256 并排，
并明写"一致／已过期"。判断一份绿是否还对现盘成立，看那里，不要看时间戳。

---

## 6. 教学动画（`animation:` 段）

引擎的设计是「**教室声明了动画、但部署没配渲染环境 → 装载时报错**」（有意为之，不静默降级）。
**现盘的 `classrooms/cs-os/classroom.yaml` 声明了 `animation: {enabled: true}`**，所以本流水线的做法是：

1. **先问教室有没有声明**（`classroom.yaml` 的顶层 `animation:` 键）；
2. **没声明** → 引擎根本不走那条自检路径 → 本项**不适用**（显式写出来，不假装通过）；
3. **声明了** → 要求 `SOCRATIC_ANIMATION_ENV_DIR`（目录）或 `SOCRATIC_ANIMATION_PYTHON`／`MANIM`
   （完整路径）＋ `SOCRATIC_ANIMATION_GATE` 指过来；配不上就**大声失败**并打印"怎么配"。
   🔴 **`--skip-session` 也一样会因此 exit 1** —— 那是设计行为，不是 bug；
4. 唯一允许的降级是**人显式关掉**（会留痕，不是静默跳过）：

```bash
./acceptance/run.sh --disable-classroom-animation \
  --animation-disable-reason "<为什么这台机器上关掉>"
```

它只改**工作副本**教室的 `classroom.yaml`（`classrooms/**` 一个字都不动），并把
"删了哪几行、删前后 sha256、理由"落盘，另追加一行到跨运行的 `acceptance/降级留痕.md`。

> 🔴 **本流水线验的是"配置指对了"，不是"引擎认了"**：`装载自检通过` 那条日志只有引擎 boot
> 才会打，也就是**只有完整跑**才有。`--skip-session` 的绿不包含这一条（报告里写在「不适用」一节）。

---

## 7. 技能包自检（两份都跑）

- **源包**（`skills/socratic-classroom`）→ 判**内容**：①–④ 内容类必须全绿。
- **已装副本**（`$DSH_HOME/skills/socratic-classroom`）→ 判**发现链路**：宿主真的能发现这个技能吗？
  🔴 **没装就明确报「未安装、该检查跳过」**（`applicable=false`）——这不是"通过"，是"**没验**"，
  而且它会让守卫判红（本流水线不替用户把包装进扫描根）。

> ⚠️ **版本差异**：本仓库当前的 `skills/socratic-classroom/validate` 只有 ①–④ 四节（没有 ⑤ 发现链路）。
> 缺那一节时 `discoveryProblems` 恒为 0，报告的措辞仍写着"⑤ 发现链路问题 0 条（预期内…）"——
> 读的时候按"这一节在本仓库版本里不存在"理解即可。`lib/skillcheck.mjs` 对两版都兼容。

---

## 8. 与本流水线**原始工作树版**的差异

**只改了"怎么找到东西"，没有放宽任何判据。**

| 项 | 原始工作树版 | 本仓库版 |
|---|---|---|
| 路径基准 | 工作树里带前缀的 `code/` 目录 | **仓库根**（`acceptance/` 的上一层）：`plugins/`、`classrooms/`、`skills/` |
| 被测教室的动画声明 | 当作**前提**写死（"教室声明了动画"） | 按教室 manifest 的**实际内容**判；没声明＝本项**不适用** |
| 动画渲染环境路径 | 工作树相对路径写死在源码里 | **环境变量**给出（`SOCRATIC_ANIMATION_ENV_DIR`／`SOCRATIC_ANIMATION_GATE`） |
| `DSH_HOME` | 默认指向用户真实 harness（靠"零接触守卫"事后证明没碰） | **强制隔离 + 硬判**：不在隔离根之下就拒绝运行 |
| node／dsh CLI | 写死某台机器的路径 | **探测 + 环境变量覆盖**，探不到就大声失败 |
| 外部取证件引用 | 指向工作树里的文档路径 | 改为"**外部文档，未随本仓库分发**"＋文档名 |
| `runs/`、报告、降级留痕 | 随工作树一起留在原地 | **不进版本库**（`.gitignore`），每次跑自己重建 |

### 8.1 复审后补的几处（2026-09-25，都是**收紧**）

| 项 | 之前 | 现在 |
|---|---|---|
| **依赖证据** | `deps.json` 只钉一个写死的 `yaml` | 从**安装副本自己的 `package.json`** 派生全部 `dependencies`（现盘＝`jsdom`／`mermaid`／`yaml`）；每个记版本＋文件数＋**树摘要**；少一个就判红。另记未声明的顶层包数（pnpm 传递依赖） |
| **`--skip-session` + `ACCEPT_NEGATIVE_CONTROL`** | 该变量由**会话里的探针**消费 → 省钱路径下它被当空气，**静默给绿** | 请求了却没跑 → 显式判红（`guards.negativeControlProbe=false`）＋ 结论与报告写明"请求没被满足 ≠ 请求通过"；没请求则显式记"不适用" |
| **`--keep-profile`** | 直接复用，不查 profile 里那条 `file:` 依赖指向哪 | 复用前逐条查：指向**已删目录**或**别的 run 目录** → **拒绝复用**并给出两种改法（否则会"在测上一轮那份源码"） |
| **`dynamic-blocks.test.mjs`** | 写死"应该有哪些讲次、每讲几条"（`[1,2,3,9]`） | 改成**关系断言**（上界取教室声明的 `classroom.lessons`、会话讲次取"第一个有备课条目的讲"…）＋ 8 条负向对照 ＋ 1 条正向对照 |
| **报告首行** | 只有时间戳 | **被测对象指纹**：冻结的那一份 vs 现盘的那一份，两个 sha256 ＋ "一致／已过期" |
| **动画变量名** | 只认本流水线那套 | 同时认**引擎自己那套**（`SOCRATIC_ANIMATION_PYTHON`／`MANIM`），免得"按引擎文档配好了、流水线却说没配"的假红 |

---

## 9. 覆盖不了的空白（诚实清单）

- **六条断言只对"跑过的那一次会话"成立**。它证明的是"这一次按设计发生了"，
  不是"任何输入下都按设计发生"——后者要靠引擎自己的单元测试（`plugins/socratic-engine/test/`）。
- **零接触守卫证明的是"我们的写足迹干净"**，不是"用户 profile 没被动过"——
  别的进程（常驻桌面 App、别的会话）照样可能写它；对那类变化本守卫只报"不由我们造成"并附判据。
- **静态扫描是近似**：它保证"没有未登记的写调用**形状**"，不保证"运行期没有别的进程写盘"。
- **被测模型可能读到验收脚手架**这一点只能**事后**检查（扫工具调用参数），
  不是结构性阻断 —— 缓解手段是把教室工作副本放到系统临时目录，让相对路径够不到 `acceptance/`。
- **上游 LLM 中继偶发中断**（某轮以 error 结束）会被识别为环境故障并整场重跑；
  全部尝试都有轮级错误时，本流水线仍会继续，但结论**不可信**，需人工看原始日志。
- **"绿"只对报告首行那份指纹成立**：报告顶部钉住**冻结的那一份**与**现盘的那一份**两个 sha256，
  并逐次复核是否一致。源码改过之后，旧报告的结论**不再对现盘成立** —— 那时它自己会写"已过期"。
- **报告会过期，但不会自己更新**：它是"最近一次运行"的快照。要判断现盘，看首行的指纹一致性那一行。
- **`--skip-session` 的绿**只覆盖"冻结／装载／依赖／技能包自检／零接触写足迹守卫／动画**配置**"；
  六条断言、污染守卫、引擎的**动画装载自检**（那条 `装载自检通过` 日志）**本次都没有被验证**
  （报告里单列「哪些检查不适用」一节）。

---

## 10. 还没接线的地方（给后续实现者）

本流水线的判据是照**完整版引擎/教室**写的。现盘已经补齐了绝大部分（见下表的"已完成"栏），
**还差两件**：

| 状态 | 项 | 现在会怎样 |
|---|---|---|
| ✅ 已就位 | 教室 `classroom.yaml` 的 `prep:` 段（备课清单，6 条 / 5 个讲次） | `node acceptance/dynamic-blocks.test.mjs` → **exit 0**（含 8 条负向对照） |
| ✅ 已就位 | 引擎的运行期动态块 `prep-list:` / `animation-notice:` | 同上；A2 的推导模型已按结构建模 |
| ✅ 已就位 | 引擎的动画装载自检（`lib/animationstore.mjs` 的 `checkAnimationRuntime`）＋ `classrooms/cs-os` 声明 `animation: {enabled: true}` | 配好渲染环境后本流水线把配置写进 profile；**装载自检那一条只有完整跑才有证据** |
| ✅ 已就位 | 会话 patch 依赖的 `headless-runner` 条目 id（`@deepseek-ai/dsh-headless`） | `--dump-config` 里确实有 `- id: headless-runner` → patch 的 `disabled: true` 有落点 |
| 🔴 **还没做** | **一次完整跑（`./acceptance/run.sh`）** | 阶段③④⑤（真实会话／六条断言／污染守卫／装载自检）在本仓库**从未跑过** → 那些栏位目前一律是"不适用"，不是"通过" |
| 🔴 **还没做** | `skills/socratic-classroom/validate` 的第 ⑤ 节（发现链路） | 源包自检恒为 `green`（那一节不存在），报告的措辞仍写着"⑤ 发现链路问题 0 条（预期内…）"；`lib/skillcheck.mjs` 对两版都兼容 |

> 🔴 判据一条都没放宽：能报红的都在如实报红（例：教室声明了动画而渲染环境没配 → `--skip-session` 也 exit 1；
> 请求了负向对照却走省钱路径 → 判红）。剩下的空白是**被测对象/执行次数**还没到，不是检查被跳过。
> 完整跑会花钱（真实多轮会话），需要单独拍板。

---

## 附 · 本机（2026-09-30 实测）跑通 `--skip-session` 的完整命令

本机的 `dsh` 是 `/bin/sh` 包装脚本、`node` 是 Desktop 的 Electron 垫片，而本流水线用
**`node <DSH_BIN> …`** 调用它们 → **两个都必须覆盖**；另外教室声明了 `animation:` 段，
引擎装载时**要求**渲染环境（不静默降级），所以还要指 python/manim/闸门：

```bash
cd ~/SocraticNovel-GitHub仓库
APP='/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked'

env -u DSH_HOME \
  ACCEPT_NODE="$APP/node_modules/node/bin/node" \
  DSH_BIN="$APP/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  SOCRATIC_ANIMATION_ENV_DIR="$HOME/Documents/ChatGPT/大学申请/开源线/DSH定制/poc_动画可写性/env/bin" \
  SOCRATIC_ANIMATION_GATE=tools/animation-gate/animation_gate.py \
  ./acceptance/run.sh --skip-session
```

- `env -u DSH_HOME` 不能省：本流水线**只许写隔离目录**，`DSH_HOME` 必须落在它自建的隔离根之下，
  否则第一步就 `✖ 拒绝运行`（这是有意设的硬闸，实测有效）。
- 隔离 harness 是新建的，**默认没有 `skills/socratic-classroom`** → 阶段 02 的"已装副本自检"会判
  `usage-error` 并**大声失败**（不静默跳过）。先装再跑：
  `mkdir -p "${TMPDIR}socratic-accept-dsh/harness/skills" && cp -R skills/socratic-classroom "${TMPDIR}socratic-accept-dsh/harness/skills/"`
- **本机实测结果**：`runs/2026-09-30_231531` → `✔ --skip-session 完整性守卫：全通过；退出码 0`
  （冻结 130 文件不一致 0｜装载 24 文件哈希一致｜零接触 89 次写盘白名单外 0｜技能包源↔已装逐字节相同）。
- 🔴 **完整跑（含真实会话＋六条断言）在本仓库仍未执行过。**
