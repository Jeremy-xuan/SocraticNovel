# 教室包注入元数据格式（manifest）· 草案 v0

> **状态**：设计草案，**非定案**。每节的选择都附「理由 + 可推翻点」，末尾有「待确认清单」。
> **服务对象**：`形态裁定_初筛_2026-09-23.md` 的 **A1–A5 注入需求**（该件 §1 已把注入类全部裁定为「插件」），本文件只定义**数据侧格式**，不定义引擎实现。
> **依据文件**（本稿所有酒馆字段与机制引文均出自这三份，不外扩）：
> 1. `开源线/DSH定制/形态裁定_初筛_2026-09-23.md`（架构与组件裁定）
> 2. `开源线/SocraticNovel_角色扮演架构_2026-09-22.md`（五层架构 = 格式的第一需求）
> 3. `开源线/SocraticNovel_酒馆研究_2026-09-22.md`（酒馆注入字段原文，逐条标出处）
> 4. `开源线/SocraticNovel_角色写法参考_2026-09-22.md`（命名法与条目化写法）
> 5. 真实样本 `tmp/SocraticNovel-wt/classrooms/cs-os/`（32 文件，逐一映射见 §4）
>
> **标记法**：【原文】= 有出处（附文件名与节号）｜【推断】= 我的判断｜【待确认】= 需用户或后续实测裁定。

---

## 目录

- §0 本格式要解决的三件事（问题定义）
- §1 第一设计项：manifest 放哪、叫什么
- §2 第二设计项：逐板块元数据 schema（YAML）
- §3 完整示例：cs-os 教室包 manifest
- §4 第三设计项：逐板块映射（33 文件）
- §5 第四设计项：降级兼容（skill 模式与插件模式同源）
- §6 第五设计项：与酒馆 v2 的取舍
- §7 第六设计项：版本与扩展
- §8 待确认清单
- §9 自报计时与产出物

---

## §0 本格式要解决的三件事（问题定义）

先把"格式要为谁服务"钉死。注入引擎（`形态裁定` A1–A5）需要回答三个问题，格式必须让这三个答案**写在数据里**，而不是写在引擎代码里：

| # | 引擎要回答的问题 | 格式里的字段 | 依据 |
|---|---|---|---|
| Q1 | **这块内容放哪儿？** | `position.target` + `position.depth` / `position.order` | 五层架构 ①②③④⑤ 的"位置"列 |
| Q2 | **多久出现一次？** | `frequency` + `phase` | 五层架构的"频率"列；酒馆 Author's Note 的 Insertion Frequency |
| Q3 | **出现时是什么形态？** | `render` + `wrap` | 五层架构 ④"模板化，每次加载时渲染"；宿主无 developer role 的硬约束 |

**再加一条不属于引擎、但格式必须承载的**：

| Q4 | **skill 模式（无插件）怎么用同一份数据？** | `source` + 全部字段都是"可降级"的 | §5 |

### 0.1 三条贯穿全稿的设计原则

**原则 1：元数据是"声明"，不是"指令"。**
manifest 只声明"这块内容**应该**在哪、多久一次"；**谁执行**由模式决定 —— 插件模式由引擎执行，skill 模式由模型自律执行。同一份声明两种执行者，这是 §5 同源方案的地基。

**原则 2：不引入引擎没有的能力。**
【原文·L1 §1.2】宿主 `SECTION_ORDERS` 是编译期常量（`-1000` HARNESS_IDENTITY … `10200` DEPLOYMENT_PERSONA_SUFFIX），但 `section()` 只校验 `Number.isFinite`（L455）→ **任意有限数字 order 可注册**。
【原文·L1 §3.3】role 只能取 `user` / `system`，**developer 在 `serialize.ts:90` 被明拒** → 宿主自己的注入也走 user + `<system-reminder>`。
→ 所以格式里**不出现** `role: assistant`、`role: developer`，也不出现酒馆的 `probability` 之类 DSH 侧无对应原语的字段。

**原则 3：字段宁可少、语义必须唯一。**
每个字段只有一个解释、一个执行动作。凡是我在设计时产生"这字段到底指什么"的犹豫，都写进 §8 待确认清单，**不靠引擎侧默契补全**。

---

## §1 第一设计项：manifest 放哪、叫什么

### 1.1 三个候选

| 候选 | 形态 | 贡献者体验 | 引擎解析成本 |
|---|---|---|---|
| **A** | 教室包根目录**单文件** `classroom.yaml`（或 `manifest.yaml`） | 改元数据要跳到另一个文件；但**一眼看全 32 块的注入策略** | **一次读取**，schema 校验一次，无解析歧义 |
| **B** | 每个 md 文件**头部 YAML frontmatter** | 改某块时元数据就在手边，**符合贡献者直觉** | 需扫描全目录、逐文件切 frontmatter；**正文会被 frontmatter 污染**（正文含 `---` 分隔线时解析歧义） |
| **C** | 单文件为主 + 允许文件级 frontmatter **覆盖** | 两套都要维护 | 两套解析路径 + 优先级规则 |

### 1.2 选择：**A（单文件 `classroom.yaml`，教室包根目录）**

**理由（按权重排序）：**

1. **引擎的确定性来自"一次读全、一次校验"。** 注入引擎要在**每回合**决定"这轮该注入哪几块"（A2/A4）。若元数据散在 32 个文件头，引擎每轮要么重复扫目录（成本），要么缓存文件树（缓存失效逻辑=新的 bug 面）。单文件 = 一次 `read` + 一次 parse，**注入决策变成纯内存计算**。
2. **跨块关系只能写在单文件里。** 本次映射暴露了至少三处**块间关系**，frontmatter 无处安放：
   - `story/overview.md` 的弧线纪律**约束** `story/ch{NN}.md`（"第 5 讲之前不许她流畅地讲完整段"）；
   - `_anchor.md` 的角色声音速查段**与** `characters/komari.md` 是同一份信息的粗细两档（见 §4 的 `anchor.voice` 拆分）；
   - `runtime/review_queue.md` 决定**当轮是否触发复习相位**，即它是 `phase` 的**输入**。
   单文件可以写 `depends_on` / `gates`；frontmatter 做不到（除非再造一套跨文件引用语法，那就是 C 了）。
3. **贡献者体验的真实痛点不在"跳到另一个文件"，而在"不知道有哪些块"。** 32 块的注入策略如果散落各处，贡献者**无法自查**"我加的这章会不会每轮都注入"。单文件把这件事变成一次 `cat`。

**可推翻点（我认为最可能被推翻的地方）：**
- 如果将来教室包**膨胀到几百块**（多学科大包），单文件会变得难读 → 届时改 C（单文件 + frontmatter 覆盖），**但 v0 不做**（原则 3：不为假想需求预留）。
- 如果贡献者实测反馈"改一个文件要开两个编辑器很烦"，**A → B 的迁移成本很低**（manifest 的字段就是 frontmatter 的字段，机械搬运），所以现在选 A 不构成锁定。

### 1.3 文件名与位置

```
classrooms/cs-os/
├── classroom.yaml        # 🔴 manifest（本格式定义的文件）
├── AGENTS.md             # skill 模式入口 —— 🔴 由 classroom.yaml 生成，见 §5
├── CLAUDE.md             # 别名，不改
├── _anchor.md
├── system_core.md
├── curriculum.md
├── knowledge_points.md
├── characters/
├── world/
├── story/
├── materials/
└── runtime/
```

**命名选择：`classroom.yaml`**，理由：与 `AGENTS.md` 平级、语义自明（"这个教室的清单"）、不占用 `manifest.yaml` 这个在构建工具里已被泛用的名字。

**可推翻点**：若宿主侧将来有 `*.yaml` 的自动加载约定（待确认），名字需让位；这是纯字符串改动。

**放根目录而非 `.classroom/` 子目录**，理由：教室包是**要被人 fork 和阅读的**（`形态裁定` D1 判定的"可分享、可混搭"），根目录可见性 > 目录整洁。

---

## §2 第二设计项：逐板块元数据 schema

### 2.0 顶层结构

```yaml
# ── 顶层 ──────────────────────────────────────────────
format: socratic-classroom/0        # 本格式的标识与主版本，引擎据此选解析器
classroom:
  id: cs-os                         # 教室包标识（= 目录名，唯一）
  title: 计算机系教室 · 操作系统
  subject: 操作系统
  lessons: 14                       # 讲数（供 {{lesson_no}} 校验与进度条）
  author: <贡献者>
  license: CC-BY-NC-SA-4.0
  classroom_version: 0.1.0          # 内容版本（≠ format 版本）

runtime_store:                      # 模板变量与相位状态的来源（见 §2.5）
  dir: runtime/
  progress: runtime/progress.md

phases:                             # 教学相位机（形态裁定 B1）的枚举，顺序即推进顺序
  - { id: open,   name: 开场 }
  - { id: probe,  name: 追问 }
  - { id: answer, name: 学生作答 }
  - { id: check,  name: 对答案 }
  - { id: review, name: 复习 }
  - { id: close,  name: 收尾 }

blocks:                             # 🔴 本格式的主体：一个板块 = 一条注入单元
  - id: <唯一 id>
    # …（其余 block 字段同构，完整实例见 §3）
```

**关于 `phases` 放在 manifest 里（而不是插件配置里）**：相位是**教学内容的一部分**（"讲新课/提问/作答/对答案/收尾"对应苏格拉底课的具体环节），不同教室的相位可能不同（比如实验课有"动手"相位）。写进数据侧才符合"引擎×内容分离"。

**可推翻点**：若引擎把相位机做成固定枚举，`phases` 退化为**校验清单**（引擎报错"未定义的 phase id"），格式不变。所以这条不构成锁定。

---

### 2.1 `position` —— 放在哪

```yaml
position:
  target: system | chat          # 🔴 二选一，决定注入通道
  order: <int>                   # target=system 时使用
  depth: <int>                   # target=chat 时使用，0 = 贴最新消息之后
  after: <anchor>                # target=system 时的相对锚点（可选，替代裸 order）
  section_name: '<领域> :: <主题>'   # target=system 时注册的段名（含冒号/:: 必须整体加引号）
```

**`target` 的两个取值对应 DSH 的两条真实通道**（不是设计发明的）：

| target | 对应机制 | 证据 |
|---|---|---|
| `system` | `systemPrompt.section(name, order, text)` 注册 system 段 | 【原文·L1 §1.1/§1.2】`section()` 在 L454，只校验 `Number.isFinite`（L455） |
| `chat` | `agent/pre-step` waterfall 里 `decision.messages.toSpliced(idx, 0, m)` | 【原文·L1 §2.7】"DSH 已经具备实现 (role, depth, 频率) 三重语义所需的全部原语" |

**`depth: 0` 的含义与酒馆一致，但机制不同，必须写清：**
- 【原文·酒馆研究 §1b】"a Depth of 0 will be sent after the last chat message"；【原文·酒馆研究 §2.0】源码级更正：`post_history` 在实现里 **0 命中**，它**就是 `injection_depth` 的一个取值**，`injection_depth = 0` 插在最新消息之前、`messages.reverse()` 后落在 prompt 最末尾。
- 【推断】我们抄的是**语义**（"贴尾 = 影响力最强"），不是实现（我们没有 `populationInjectionPrompts`）。
- 🔴 **`depth` 只对 `target: chat` 有效。** system 段的位置由 `order` 决定，写 `depth` 是错误 —— 引擎应报错而非忽略（原则 3）。

**`after` 锚点 vs 裸 `order`：**
- 裸 `order` 直接对应宿主常量（`-1000` HARNESS_IDENTITY … `10200` DEPLOYMENT_PERSONA_SUFFIX，见 §0 原则 2 的引用）。
- 但**写死数字会把教室包钉在某个宿主版本上**（宿主插入新段就可能撞号）。
- → 所以 v0 **同时支持**：`order` 用于明确要挤进某处的场景，`after: <section_name>` 用于"跟在某人后面"的相对语义。**优先用 `after`**。
- 【待确认】`after` 的解析需要引擎能读到当前已注册的段名清单；若宿主不暴露该清单，`after` 需退化为引擎内置的锚点白名单。见 §8。

**`section_name` 用「领域 :: 主题」命名法**：
- 【原文·角色写法参考 §4.1 C2】条目命名法 `领域 :: 主题 (版本, 标签)`，"**直接可用的命名法**"（该表第 463 行原文："世界书命名 | `领域 :: 主题 (版本, 标签)` | 🔴 **直接可用的命名法**"）。
- 【原文·角色写法参考 §2.5】语料里 `::` 层级分隔符 25 条，来自 `男性至高的媚男世界` 这张卡的 25 条主流写法（`大领域 :: 具体主题 (v1.0, …)`）。
- 我们直用：`教学法 :: 苏格拉底铁律`、`纪律 :: 本轮不许违反项`。
- **好处**：注入日志里一眼看出**这块从哪个文件、以什么身份进来的**（可追溯），且与教材条目命名同构（§4 的 `materials/` 也用同一命名法）。

**可推翻点**：`section_name` 若与宿主已有段名撞名会**抛错**（【原文·L1 §1.1】"name 唯一（重复注册抛错，L454-463）"）→ 引擎必须做**命名空间前缀**（如统一加 `classroom:`）。这是引擎实现细节，但格式侧建议**在 §2.1 就约定前缀由引擎加**，避免贡献者写错。

---

### 2.2 `frequency` —— 多久一次

```yaml
frequency:
  every: once | turn | n_turns | phase | session | on_demand
  n: <int>                      # every=n_turns 时必填
  phase: [<phase_id>, ...]      # every=phase 时必填（等价于 §2.3 的 gate）
  anchor: lesson_start | session_start   # every=once 时的重新注入时机
```

**`every` 取值表：**

| 值 | 语义 | 直接对应 | 用到它的板块（见 §4） |
|---|---|---|---|
| `once` | 引擎注入一次（每课/每会话起点重新注入一次） | 【原文·酒馆研究 §1e】Permanent Tokens"always be sent … with every generation request"的**反向**（我们只要一次）；character card 的 `first_mes`"only sent once at the start of the chat" | `characters/komari.md`、`system_core.md`、`world/*` |
| `turn` | **每回合**注入（每步重新注入，不是"留一份在历史里"） | 【原文·酒馆研究 §1f】"Frequency 1 = … inserted with every user input prompt" | `_anchor.md` 的 `anchor.rules` |
| `n_turns` | 每 N 回合注入一次 | 【原文·酒馆研究 §1f】"Frequency 4 = … inserted into every 4th user input prompt" | 知识锚（`_anchor.md` 的 `anchor.check`，n=5） |
| `phase` | 仅在指定教学相位内注入 | 【推断】酒馆**没有**这个概念（它没有教学相位机）；这是我们的自研项（`形态裁定` B1） | `materials/ch{NN}.md`、`story/ch{NN}.md` |
| `session` | 每个会话注入一次（跨会话不重复） | 【推断】对应"跨多日课程的进度摘要"场景 | `story/overview.md` |
| `on_demand` | 引擎**不主动注入**；由模型用文件工具按需读取 | 【原文·角色写法参考 §4.3 R4】"显式加载时序"= 必须自研项；【原文·角色扮演架构 §3.0】"用文件工具读文件"是我们在 DSH 里唯一的 depth 0 手段 | `runtime/session_log.md`、`runtime/diary.md`、`world/` 细节 |

**🔴 一条必须写进格式文档的语义澄清（否则引擎与贡献者一定会分歧）：**

> `frequency` 描述的是**引擎主动注入的动作频率**，不是"模型看到它的频率"。
>
> 对 `target: system` 的块：它在**每次请求构建时**都进 prompt（因为 system 段是求值的，不是累积的），但 `frequency: once` 表示"**内容只在会话起点读一次盘**"（之后用缓存值）。
> 对 `target: chat` 的块：`frequency` 直接等于**实际 splice 次数**。
>
> 这条区分来自【原文·L1 §2.6】："固定 depth 注入的消息，如果落在被压缩范围内，会被 compaction 的 `replace` 从 surface 派生中删掉" → **`target: chat` 的块必须每轮重新注入，不能"写一次留在历史里"**。所以 `frequency: once` **不能**用在 `target: chat` 上 —— 引擎应校验并报错。

**`anchor` 字段的作用**：`once` 的"一次"以什么为界。`lesson_start` = 每讲重读一次（教学法不必每讲重读，但教材每讲要换）；`session_start` = 整个教室包生命周期一次。

**可推翻点**：`every: n_turns` 的 `n` 是否应该支持**递增**（第 5/10/15 轮 → 间隔越来越大）？v0 不支持（原则 3），但 `_anchor.md` 原文写的是"第 5、10、15… 轮"，等距即可覆盖。

---

### 2.3 `phase` —— 教学相位门

```yaml
phase:
  phases: [<phase_id>, ...]     # 空数组 = 不限相位
  except: [<phase_id>, ...]     # 排除法（与 phases 二选一）
  advance_on: <condition_id>    # 可选：该块被消费后，相位推进到哪
```

**为什么要有相位门**：这是**五层架构里 ③ 情境层的核心机制**。【原文·角色扮演架构 §3 表】③ 情境层"位置：中部（按注入位置分级）｜频率：按需"；【原文·形态裁定 A5】"教材片段/故事节点 → 相位机（B1）驱动 + pre-step 注入"。

**具体用处（cs-os 真实场景）**：
- `materials/ch{NN}.md` 是**教师侧追问脚本**（文件头原文："本文件是教师侧的追问脚本，不是给学生念的课文"）→ 它**只在 `probe`（追问）与 `check`（对答案）相位有意义**。开场相位注入它 = 诱导模型提前把追问序列倒出来。
- `story/ch{NN}.md` 的**开场场景方向**段只在 `open` 相位有用。
- `knowledge_points.md` 的当讲条目在 `check` 相位（判 `[x]`）与 `close` 相位（更新）有用。

**`advance_on` 说明**：相位推进的判定条件（"学生说出了核心结论"等）。【推断】这属于**教学内容**（不同课的推进信号不同），所以放数据侧。
**可推翻点**：若实测发现相位推进判定必须靠模型判断（无法规则化），`advance_on` 退化为**给模型的提示文本**而非可执行条件。格式不变（值从 id 变字符串），但引擎语义要改 → 标【待确认】。

---

### 2.4 `render` —— 要不要模板化

```yaml
render:
  enabled: true|false           # false = 原文照注（默认 false）
  vars:                         # 变量定义：名字 → 来源
    student:      { from: runtime_store, path: learner_profile.name }
    lesson_no:    { from: runtime_store, path: progress.current_lesson }
    last_blocker: { from: runtime_store, path: mistake_log.last }
    today:        { from: engine,        value: date }
  missing: error | default | skip_block | literal
  default: "<未设置>"            # missing=default 时的值
```

**依据**：【原文·酒馆研究 §1g】酒馆宏是 *"dynamic placeholders that get replaced with actual values when text is processed"*；【原文·角色扮演架构 §3.2】"我们的教室也应该定义**每次加载时渲染的字段**（学生名／课次／日期／上次卡点），而不是把状态写死在静态文件里。**状态写死 = 每次都要人改文件 = 一定会漂移**"。

**🔴 `missing` 字段是必须的，且默认值建议 `error`**：
- 依据是一条**酒馆的坑**：【原文·酒馆研究 §1c】Context Template 的 WARNING —— *"If any of the above parameters are missing from the story string template, they will not be sent in the prompt at all."*
- 【推断】这条对我们的意义：**模板变量缺失时静默消失**，是"注入失败但无人知道"的最坏形态 —— 教学场景下等于纪律/知识点无声丢失。
- → v0 默认 `missing: error`（引擎报错并指出变量名），**宁可炸也不要静默**。
- **可推翻点**：`error` 会让教室包在 runtime 文件还没建立时（新教室第一次启动，`runtime/progress.md` 是空的）直接炸。→ 折中：引擎对 `runtime_store` 的**首次缺失**用 `default`，对**已有 store 但路径不存在**用 `error`。这条折中需要实测确认，列 §8。

**`vars` 的来源分三类**（覆盖 cs-os 全部实际需求）：
| 来源 | 含义 | cs-os 实例 |
|---|---|---|
| `runtime_store` | 从 `runtime/` 里的文件按路径取值 | `progress.current_lesson` → `{{lesson_no}}` |
| `engine` | 引擎自带的值（日期、轮次、相位） | `date`、`turn_no`、`phase` |
| `literal` | 常量 | 教室名 |

**可推翻点**：是否需要支持**表达式**（如 `{{lesson_no}} + 1`）？v0 不要（原则 3）。若将来需要"下次课是第几讲"，让 `runtime_store` 提供现成字段。

---

### 2.5 `wrap` —— 怎么包

```yaml
wrap:
  style: none | system-reminder | custom
  tag: "<system-reminder>"      # style=custom 时使用
  role: user                    # 🔴 v0 只允许 user
  header: "<可选的一行来源说明>"
```

**🔴 这是格式里唯一被宿主硬约束的字段，必须写死：**

- 【原文·L1 §3.3】"想要 SillyTavern 那种 'system 角色 + depth 注入'，在 DSH 里**只能映射成 user 角色的 `<system-reminder>` 包装**。而宿主自己就是这么做的 —— skill catalog 用 `<system-reminder>` 包裹（`tool-skill/src/index.ts:259,264`）"
- 【原文·L1 §3.3】真 developer role 需 fork `packages/llm/llm-deepseek/src/serialize.ts:90`（`形态裁定` F1 已裁定"先不用"）
- → 所以 `role` 字段**只有 `user` 一个合法值**。写 `system` 意味着"走 `position.target: system`"，不该出现在 `wrap` 里。

**`wrap` 只对 `target: chat` 有效**：`target: system` 的块由宿主拼进 system prompt，不需要也不应该自带包装。
→ 引擎校验：`position.target == system` 时出现 `wrap` = 报错。

**`style: none` 的用途**：`target: chat` 但内容本身就是给用户看的一段（如注入的开场白草稿）——【待确认】v0 是否真需要这个场景。若无实例，v0 可只保留 `system-reminder`。

**`header` 的用途**：在包装里加一行 `<!-- classroom:cs-os/_anchor.md -->` 之类的来源标注，让**注入在会话日志里可追溯**（调试必需）。
**可推翻点**：header 会消耗 token，且模型可能把来源标注当内容读 → 建议只在 debug 模式输出。列 §8。

---

### 2.6 其余字段

```yaml
    id: anchor.rules                 # 🔴 唯一 id，全局不可重复（引擎报错）
    name: "纪律 :: 教学铁律"          # 人类可读名，用「领域 :: 主题」命名法
    source: _anchor.md               # 教室包内相对路径（相对 classroom.yaml 所在目录）
    source_sha256: "<hex>"           # 可选：内容哈希，用于"内容变了但元数据没变"的检测
    layer: discipline                # 五层归属：resident|startup|discipline|context|state|anchor
    purpose: "<一句话：这块为什么存在>"  # 贡献者填；引擎不用，人用
    depends_on: [<block_id>, ...]    # 可选：块间关系（§1.2 理由 2）
    tags: [<string>, ...]            # 可选：分组/检索
    notes: "<备注>"
```

**`layer` 字段的作用**：**它是给人看的，不是给引擎看的。**
- 【推断】五层架构（①②③④⑤）是**设计语言**，`position`/`frequency` 是**执行语义**。两者不同构（例如 `runtime/learner_profile.md` 在五层里属"①常驻层"，但它的 `frequency` 是 `n_turns` 而非 `once` —— 见 §4 的说明）。
- 保留 `layer` 让**架构文档与 manifest 可对账**（人读时不用心算 `position` 推出的层），但引擎**不读它**。
- **可推翻点**：若对账需求不成立，删掉 `layer` 更干净（原则 3）。我倾向保留，因为五层架构是**已定的设计语言**，manifest 若不体现它，两份文档会漂移。

**`depends_on` 的语义边界（必须写清，否则是 bug 源）**：仅表示"**注入顺序上应在其后**"，**不表示条件依赖**。条件依赖由 `phase` 表达。
**可推翻点**：若实测发现"依赖未满足时该块应被跳过"，则 `depends_on` 需要升级为真正的门控 —— v0 不做。

---

## §3 完整示例：cs-os 教室包 manifest（节选，可直接照抄）

> **说明**：这是 §2 schema 的**落地实例**，内容全部来自 `tmp/SocraticNovel-wt/classrooms/cs-os/` 的**真实文件**（§4 有逐文件映射）。这里只列 6 条 block 覆盖五种 `frequency` 形态；完整 32 块见 §4 表。

```yaml
format: socratic-classroom/0

classroom:
  id: cs-os
  title: 计算机系教室 · 操作系统
  subject: 操作系统
  lessons: 14
  author: <贡献者>
  license: CC-BY-NC-SA-4.0
  classroom_version: 0.1.0

runtime_store:
  dir: runtime/
  progress: runtime/progress.md

phases:
  - { id: open,   name: 开场 }
  - { id: probe,  name: 追问 }
  - { id: answer, name: 学生作答 }
  - { id: check,  name: 对答案 }
  - { id: review, name: 复习 }
  - { id: close,  name: 收尾 }

blocks:

  # ── ① 常驻层：人格本体（系统段，每讲读一次） ──────────────
  - id: persona.komari
    name: "人格 :: 小鞠知花（当课老师）"
    source: characters/komari.md
    layer: resident
    purpose: 决定"谁在教"——性格、语言习惯、她的世界。教学法不在此文件。
    position:
      target: system
      after: deployment:persona-prefix      # 相对锚点，避免写死 order
      section_name: "classroom:cs-os :: persona"
    frequency:
      every: once
      anchor: lesson_start
    render: { enabled: false }
    depends_on: [anchor.voice]

  # ── ② 纪律层：每回合贴尾（本格式最重要的用法） ────────────
  - id: anchor.rules
    name: "纪律 :: 教学铁律（五条）"
    source: _anchor.md
    layer: discipline
    purpose: 最硬的五条纪律贴在本轮对话之后——"位置本身就是一种权重"。
    position:
      target: chat
      depth: 0
    frequency:
      every: turn
    wrap:
      style: system-reminder
      role: user
    render: { enabled: false }
    notes: >
      _anchor.md 原文自述"每轮上课前读一次，不要只在启动时读一次"——
      引擎化之后这句话变成 frequency.every=turn，不再依赖模型自觉。

  # ── ②+④ 混合：状态层模板化（每回合求值，值来自 runtime/） ──
  - id: state.turn_context
    name: "状态 :: 本轮课堂上下文"
    source: null                     # 🔴 不读文件：纯模板，值全部来自 runtime_store
    layer: state
    purpose: 学生名/课次/上次卡点——写死在文件里就一定会漂移。
    position:
      target: chat
      depth: 0
    frequency:
      every: turn
    wrap: { style: system-reminder, role: user }
    render:
      enabled: true
      vars:
        student:      { from: runtime_store, path: learner_profile.name }
        lesson_no:    { from: runtime_store, path: progress.current_lesson }
        last_blocker: { from: runtime_store, path: mistake_log.last }
      missing: error

  # ── ⑤ 锚定层：每 N 轮（n=5，来自 _anchor.md 原文"第 5、10、15… 轮"） ──
  - id: anchor.check
    name: "锚定 :: 每 5 轮自检"
    source: _anchor.md
    layer: anchor
    purpose: 角色锚 + 知识锚，按每 N 轮注入，控制注意力成本。
    position: { target: chat, depth: 0 }
    frequency: { every: n_turns, n: 5 }
    wrap: { style: system-reminder, role: user }
    render: { enabled: false }

  # ── ③ 情境层：按相位注入（教材正文只在追问/对答案相位有意义） ──
  - id: material.current
    name: "教材 :: 当讲正文（问答版）"
    source: materials/ch{NN}.md          # {NN} = 由 lesson_no 补零两位
    layer: context
    purpose: 教师侧追问脚本——不是给学生念的课文。开场注入会诱导提前倒出追问序列。
    position: { target: chat, depth: 2 }
    frequency: { every: phase, phase: [probe, check] }
    phase:
      phases: [probe, check]
    wrap: { style: system-reminder, role: user }
    render:
      enabled: true
      vars:
        lesson_no: { from: runtime_store, path: progress.current_lesson }
      missing: error

  # ── ③ 情境层：按需（模型自己用文件工具读） ────────────────
  - id: state.session_log
    name: "状态 :: 课堂摘要"
    source: runtime/session_log.md
    layer: state
    purpose: 回顾历史时才需要；引擎不主动注入，避免每轮背 10 条摘要。
    position: { target: chat, depth: 0 }   # 声明"若要注入则贴尾"
    frequency: { every: on_demand }        # 🔴 引擎不注入，仅声明位置供 skill 模式使用
    render: { enabled: false }
```

### 3.1 从这份示例能看出的三件事

1. **`frequency: once` 与 `target: system` 天然配对，`every: turn/n_turns/phase` 与 `target: chat` 天然配对** —— 这不是巧合：system 段是**求值**的（放一次就一直在），chat 注入是**累积**的（要重复才在）。格式不强制这条配对（引擎校验即可），但 §4 的映射会自然呈现它。
2. **`source: null` 是合法的**（`state.turn_context` 是纯模板块）→ 引擎不能假设"块 = 文件"。
3. **`_anchor.md` 被拆成两条 block**（`anchor.rules` 每轮 + `anchor.check` 每5轮）——**同一文件可以出多条 block**，这是格式必须允许的（见 §4 对 `_anchor.md` 的三拆）。

---

## §4 第三设计项：逐板块映射（cs-os 全部 33 文件）

### 4.0 记法说明（表头缩写，对应 §2 字段）

| 表头缩写 | 完整字段 | 取值 |
|---|---|---|
| `T` | `position.target` | `s` = system（系统段）｜`c` = chat（贴对话）｜`—` = 不注入 |
| `pos` | `position.order` / `position.depth` / `after` | `s/after:<anchor>`、`c/d<N>` |
| `freq` | `frequency.every` | `once(lesson_start)`、`turn`、`n5`（每5轮）、`phase{...}`、`session`、`ondemand` |
| `ph` | `phase.phases` | 相位门（`open/probe/answer/check/review/close`） |
| `rd` | `render.enabled` | `—` = 不渲染｜`T` = 模板化 |
| `wr` | `wrap.style` | `sr` = `<system-reminder>`｜`—` = 无 |
| `ly` | `layer` | 五层归属（人读用，引擎不读） |

> **`_anchor.md` 一行拆成三条 block**，因为它的三段内容**频率与体量完全不同**（详见 §4.1 说明），所以表里出现三行 `_anchor.md`。同理 `runtime/` 与 `story/` 的条目也按内容拆分。

### 4.1 核心 6 文件（逐块，不合并）

| 文件 | 块 id / name | ly | T | pos | freq | ph | rd | wr | 依据 |
|---|---|---|---|---|---|---|---|---|---|
| `AGENTS.md` | `meta.entry`（不注入） | — | — | — | — | — | — | — | 🔴 它是 **skill 模式的渲染产物**，不是注入源（见 §5）。【原文·L1 §1.5】AGENTS.md 以 `user/message` 形式由宿主注入、时机在 `agent/pre-step` 的 claimed batch 之后（`index.ts:338-339`）→ **插件模式下由宿主处理，manifest 不该再注一遍**，否则重复。 |
| `CLAUDE.md` | `meta.alias`（不注入） | — | — | — | — | — | — | — | 别名文件（内容仅 7 行，指向 AGENTS.md）。【原文·L1 §1.5】`DEFAULT_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.md', 'CLAUDE.md']` → 两个都会被宿主扫到。**待确认**：宿主是否两个都注入（若都注，CLAUDE.md 是纯浪费）。 |
| `_anchor.md` | ① `anchor.rules`「纪律 :: 教学铁律（五条）」 | ② 纪律 | c | d0 | **turn** | * | — | sr | 【原文·文件头】"本文件的作用：把最硬的纪律放到**贴近本轮对话**的位置。**每轮上课前读一次**"。【原文·角色扮演架构 §3 表】② 纪律层"位置：历史之后（贴本轮对话，≈Depth 0）｜频率：每轮｜体量 ≤1KB"。 |
| `_anchor.md` | ② `anchor.lesson_ban`「纪律 :: 本课不许违反项」 | ② 纪律 | c | d0 | **turn** | * | T | sr | 【原文·文件】该段自带"（每讲更新）"→ 它是**每讲变化**的，必须每轮注入才跟得上换讲；模板化字段 `{{lesson_no}}`。 |
| `_anchor.md` | ③ `anchor.voice`「人格 :: 角色声音速查」 | **① 常驻** | **s** | s/after:persona | **once** | — | — | — | 🔴 **这是本表最重要的一处"不照抄"**。该段是**角色声音速查**（小鞠知花"两套嘴"），内容**整门课不变**，却因为被写在 `_anchor.md` 里而**每轮注入**——违反 ② 纪律层 ≤1KB 的体量纪律（该段约 0.4KB，占 ② 的一半）。→ 拆出来归 ① 常驻层，**每讲读一次**。**理由**：【原文·_anchor.md 自述】"写得全的规则在 system_core.md 那一层"——即该文件的设计意图本就是"只要最硬的、最短的"。**可推翻点**：若实测发现声音特征在长对话里会漂移（模型忘掉"她打字比说话流畅"），则该块应回到 `n_turns` 而非 `once`。 |
| `system_core.md` | `teach.system_core`「教学法 :: 苏格拉底核心」 | ①′ 启动 | s | s/after:persona | **once(lesson_start)** | — | — | — | 【原文·角色扮演架构 §3.0.1 表】`system_core.md`（教学法）｜启动（系统段）｜一次。文件 196 行 ≈ 最大单文件，但**是教学法唯一真源**（"怎么教"），必须常驻。 |
| `curriculum.md` | `curriculum.map`「课程表 :: 14 讲结构」 | ③ 情境 | c | d4 | **ondemand** + 每讲一次 | * | T | sr | 【原文·AGENTS.md 加载策略】"③ 情境层 … 用到时读｜按需"。**但**第 1 讲启动与每讲切换时必须读一次（`{{lesson_no}}` 决定挂哪讲的 OSTEP 链接）→ 引擎在**相位 `open` 且讲次变化时**强制注入一次，其余按需。**待确认**：是否允许"每讲一次"这种混合频率（见 §8）。 |
| `knowledge_points.md` | `kp.current`「知识 :: 当讲知识点清单」 | ③ 情境 | c | d2 | **phase{check,close}** | check, close | T | sr | 【原文·文件头】"用法：课后由 AI 更新状态。三档 `[ ]`/`[~]`/`[x]`"→ 它**既是判据源也是写回目标**，只在**对答案**（判档）与**收尾**（更新）相位有意义。开场注入 = 模型会提前对着清单念。 |

### 4.2 `characters/` 与 `world/`（按目录规则）

| 文件 | 块 id | ly | T | pos | freq | ph | rd | wr | 依据 |
|---|---|---|---|---|---|---|---|---|---|
| `characters/komari.md` | `persona.komari` | ① 常驻 | s | s/after:persona | **once(lesson_start)** | — | — | — | 【原文·AGENTS.md 五层表】"① 常驻层｜`characters/komari.md`（当课老师的人格核心）＋`runtime/learner_profile.md`｜最前（系统段）｜每轮"。⚠️ **表里写"每轮"但实为系统段**——见 §4.5 的冲突说明。 |
| `characters/*.md`（非当课老师） | `persona.<name>` | ① 常驻 | s | s/after:persona | **ondemand** | — | — | — | 【原文·AGENTS.md 第三步】"非当课老师的人格文件——生成群聊消息时**优先只读 `_anchor.md` 的角色声音速查段**；只有需要更完整的性格描写时才读 `characters/*.md`"。→ 这正是 §4.1 把 `anchor.voice` 提到 ① 常驻层的**另一条理由**：它承担了"多老师轮值时的轻量人格"。 |
| `world/setting.md` | `world.setting`「世界 :: 编辑部场景基线」 | ①′ 启动 | s | s/after:persona | **once(lesson_start)** | — | — | — | 【原文·AGENTS.md 第二步 6】"读 `world/setting.md` ＋ `world/metaphor.md`——场景与隐喻系统"。 |
| `world/metaphor.md` | `world.metaphor`「隐喻 :: 编辑部↔操作系统」 | ①′ 启动 | s | s/after:persona | **once(lesson_start)** | — | — | — | 同上。**注意**：该文件含**红线**（"隐喻只用于建立直觉。正式术语与机制一律以 `materials/ch{NN}.md` 与 OSTEP 原文为准"）→ 该红线**同时**属于纪律层，建议**在 `anchor.rules` 里复述一行**（复述而非引用，避免跨块依赖）。 |
| `story/overview.md` | `story.arc_gate`「故事 :: 人物弧与暗线门控」 | ③ 情境 | c | d0 | **session** | * | — | sr | 🔴 **该文件不是背景资料，是"不许提前完成"的约束**（原文："这条弧**不能提前完成**。第 5 讲之前不许她'流畅地讲完整段'"）。【原文·AGENTS.md 第二步 9 注】"🔴 **第 1 讲之前先读一次 `story/overview.md`**…不读就会把弧线提前用完"。→ **每会话注入一次**，位置贴尾（它是约束，不是背景）。 |

### 4.3 `story/` 与 `materials/`（按章节模式，一条规则覆盖）

| 模式 | 块 id | ly | T | pos | freq | ph | rd | wr | 依据 |
|---|---|---|---|---|---|---|---|---|---|
| `story/ch01.md … ch14.md` | `story.node`（`source: story/ch{NN}.md`） | ③ 情境 | c | d2 | **phase{open}** | open | T | sr | 【原文·story/ch01.md 头】"本文件是**节点说明**，不是可直接输出的叙述。**不得把节点描述直接当正文念出来**"→ 它只在**开场**相位用（开场场景方向 200–500 字）。**14 章共用一条规则**，`{NN}` 由 `{{lesson_no}}` 补零两位。 |
| `materials/ch01.md … ch14.md` | `material.current`（`source: materials/ch{NN}.md`） | ③ 情境 | c | d2 | **phase{probe,check}** | probe, check | T | sr | 【原文·materials/ch01.md 头】"本文件是**教师侧的追问脚本**，不是给学生念的课文"→ 只在**追问/对答案**相位有意义（见 §3 示例注释）。**14 章共用一条规则**。 |

> **一条规则覆盖 ≠ 一条 block**。引擎按 `{NN}` 展开为 14 条实例（或运行时按 `lesson_no` 解析路径）。格式侧只要求**声明一次**——这是"故事线与教材按章节模式"的落地方式。

### 4.4 `runtime/`（8 文件，逐块——它们频率各不相同，不能合并）

| 文件 | 块 id | ly | T | pos | freq | ph | rd | wr | 依据 |
|---|---|---|---|---|---|---|---|---|---|
| `runtime/progress.md` | `state.progress` | ④ 状态 | c | d0 | **turn** | * | T | sr | 【原文·AGENTS.md 第一步 2】"读 `runtime/progress.md`——上到哪了、这节课是第几讲"（每轮课前）。它是**相位判定的输入**（决定 `lesson_no`）→ 必须每轮。 |
| `runtime/learner_profile.md` | `state.learner` | ④ 状态 | c | d0 | **n5** | * | T | sr | 【原文·AGENTS.md 五层表】把它列在 ① 常驻层（"每轮"）。⚠️ **冲突**：它是**观察更新**的（文件头："每次课后由 AI 依据课堂表现更新"），每轮注入 32 行表格纯属浪费 → 改为 **n5**（与 `anchor.check` 同频，恰好一起进）。**可推翻点**：若实测发现"零问卷原则"要求模型每轮都记得学习者已知事实（会写代码、母语中文），则应回 `turn`。 |
| `runtime/session_log.md` | `state.session_log` | ④ 状态 | c | d0 | **ondemand** | * | — | sr | 【原文·AGENTS.md 第三步】"延迟加载（用到时才读）：`runtime/session_log.md`——回顾历史时"。 |
| `runtime/session_archive.md` | `state.archive` | ④ 状态 | c | d0 | **ondemand** | * | — | sr | 【原文·AGENTS.md 第三步】"`runtime/session_archive.md`——查更早的历史时"。 |
| `runtime/mistake_log.md` | `state.mistakes` | ④ 状态 | c | d0 | **phase{open,check}** | open, check | T | sr | 两处用：【原文·review_queue.md 复习方式】"不重讲，直接问：'上次那条，你还能推一遍吗？'"（open 相位）；【原文·AGENTS.md 第一步 3 + 复习系统】对答案相位需靶子。**它是 `{{last_blocker}}` 的来源**。 |
| `runtime/review_queue.md` | `state.review` | ④ 状态 | c | d0 | **phase{open}** | open | T | sr | 【原文·文件头】"**课前必查**：今天日期是否 ≥ 任意一行的'下次复习日期'。是 → 本节课开头先做复习"→ **open 相位**注入（决定今天是否进 `review` 相位）。 |
| `runtime/diary.md` | `state.diary` | ④ 状态 | c | d0 | **ondemand** | close | — | sr | 【原文·AGENTS.md 第三步】"`runtime/diary.md`——写日记时"；【原文·文件头】"每课一条，不超过 120 字"→ 收尾时写，不必每轮读。 |
| `runtime/wechat_group.md` | `state.wechat` | ④ 状态 | c | d0 | **ondemand** | * | — | sr | 【原文·AGENTS.md 第三步（隐含）+ 文件头】"群聊不承载知识点。它是关系与状态的载体"→ 只在生成群聊消息时需要。 |

### 4.5 映射过程中暴露的 5 处冲突（本表的真正价值）

> 这 5 处不是我的设计选择，是**现有教室包与五层架构之间的真实不一致**——manifest 化把它们逼了出来。逐条给出处置与可推翻点。

**冲突 1 · `_anchor.md` 三段频率不同，却共用一个文件与"每轮读一次"的指令。**
- 事实：`anchor.rules`（每轮、不变）+ `anchor.lesson_ban`（每轮、每讲变）+ `anchor.voice`（整课不变）。
- 处置：**拆成三条 block**（§4.1），`anchor.voice` 提到 ① 常驻层。
- 理由：② 纪律层的体量纪律是 **≤1KB**（【原文·角色扮演架构 §3 表】），而 `_anchor.md` 全文含三段约 1.4KB → **已经超标**。拆出 voice 段后 ② 回到 ≈1KB 内。
- **可推翻点**：若实测发现"声音特征会漂移"，把 `anchor.voice` 改回 `n_turns`（而不是回 `turn`）——它不需要每轮。

**冲突 2 · `AGENTS.md` 五层表把 `runtime/learner_profile.md` 放在 ① 常驻层并标"每轮"。**
- 事实：它是**观察累积**型文件（每次课后更新），内容会增长。
- 处置：**改为 `n5`**（§4.4）。
- **可推翻点**：见 §4.4 该行。

**冲突 3 · 五层表把 `system_core.md`+`world/*` 标为"①′ 启动层｜每课一次"，但位置写"系统段"。**
- 事实：**系统段在每次请求构建时都会进 prompt**，"每课一次"只可能指**读盘一次**。
- 处置：§2.2 的语义澄清（`frequency` = 引擎动作频率，不是模型看到频率）+ 引入 `anchor: lesson_start`。
- **可推翻点**：若引擎把 system 段做成"每课重新注册"（销毁旧段、注册新段），则语义要重写。这依赖引擎实现（§8 待确认）。

**冲突 4 · `AGENTS.md` 自身既是"入口"又可能被插件重复注入。**
- 事实：【原文·L1 §1.5】宿主已经会把 `AGENTS.md` 以 user message 注入（`agent-instructions` 包）。
- 处置：manifest **不声明** `AGENTS.md` 为 block（`meta.entry` 标"不注入"）。**否则同一份内容进两次**。
- **可推翻点**：🔴 **这是本稿最需要实测的一条**。若插件模式下 `AGENTS.md` 的内容与 manifest 生成的注入**内容重复但表述不同**，会造成"两套规则"。§5 的同源方案正是为此设计。

**冲突 5 · `curriculum.md` 既"按需"又"每讲必读"。**
- 事实：讲次切换时必须读（决定 OSTEP 链接与"我懂了"瞬间），课中不需要。
- 处置：`freq: ondemand` + 一条**相位门例外**（`open` 且 `lesson_no` 变化时强制注入一次）。
- **可推翻点**：这引入了一种**混合频率**（ondemand + 条件强制），是格式里唯一一处"复合规则"。若引擎认为复杂度不值，可退化为 `n_turns: n=1`（即每轮，浪费但简单）。**我倾向保留混合**，因为 `curriculum.md` 是 139 行的大文件，每轮注入代价明确。

### 4.6 覆盖率自查

> 🔴 **先更正一处输入错误**：任务书写"cs-os 现有 32 个文件"，**实测为 33 个**（`find . -type f | wc -l` = 33）。差 1 的原因是 `CLAUDE.md` 未被计入。本表按**实测 33**核对。

| 目录 | 实测文件数 | 覆盖 | 对应表 |
|---|---|---|---|
| 根（`AGENTS.md`／`CLAUDE.md`／`_anchor.md`／`system_core.md`／`curriculum.md`／`knowledge_points.md`） | 6 | ✅ 6 | §4.1 |
| `characters/` | 1 | ✅ 1（+ 通配规则覆盖未来多老师） | §4.2 |
| `world/` | 2 | ✅ 2 | §4.2 |
| `story/` | 15（`overview.md` + `ch01–ch14.md`） | ✅ 15 | §4.2（overview）+ §4.3（14 章一条通配规则） |
| `materials/` | 1 | ✅ 1（+ 通配规则覆盖 ch02–ch14） | §4.3 |
| `runtime/` | 8 | ✅ 8 | §4.4 |
| **合计** | **33** | **✅ 33** | |

**核对方式**：上表每格数字与 `find <dir> -maxdepth 1 -type f | wc -l` 一致；§4.1–§4.4 表中出现的文件路径**全部来自磁盘列举**，无虚构文件。

**两条通配规则**（避免为 28 个章节文件写 28 行）：
1. `story/ch{NN}.md`（14 文件）→ 一条 `story.node` 规则；
2. `materials/ch{NN}.md`（实存 1，预期 14）→ 一条 `material.current` 规则。

> ⚠️ **`materials/` 目前只有 `ch01.md`，ch02–ch14 尚未写**（`story/ch14.md` 头部亦自注"正文：`materials/ch14.md`（待写）"）。→ 引擎**必须容忍源文件缺失**：`source` 指向不存在的文件时，行为应是"跳过该块并告警"，**不是报错中断上课**。这条应写进引擎契约（本格式侧体现为 `source` 允许指向未来文件）。【待确认】见 §8。

---

## §5 第四设计项：降级兼容（skill 模式与插件模式同源）

### 5.0 问题的真实形状

【原文·形态裁定 D3】"skill 版教室（MVP 的 M3）**保留 skill 形态**——轻用户零门槛（不装插件也能用，靠模型自律）；插件版=深度用户（确定性注入）。**双形态本来就是定案**。"

所以这不是"兼容旧版"，而是**两种都要长期存在**。危险在于：如果 skill 模式的加载指令与插件模式的注入规则**各写一份**，那么：

- 改一处忘另一处 → 两个模式的教室行为分叉（用户看到的"同一个教室"行为不同）；
- 两处描述同一件事却措辞不同 → **同一个块在两种模式下被理解成不同频率**（比缺失更糟，因为无法察觉）。

### 5.1 方案：**`classroom.yaml` 是唯一真源；`AGENTS.md` 是它的 skill 模式渲染视图**

```
                    classroom.yaml
                  （唯一真源：语义）
                          │
        ┌─────────────────┴─────────────────┐
        │                                   │
   插件模式（引擎读）                skill 模式（AGENTS.md 读）
   ─ 确定性执行 position/frequency    ─ 模型按 AGENTS.md 的"加载表"自律执行
   ─ 由引擎解析，不需要人读            ─ 由 render 工具生成，不由人手写
```

**规则（v0 定死三条）：**

1. **`AGENTS.md` 的「加载策略」表是生成物。** 内容 = 由 `classroom.yaml` 的 `blocks` 投影而来，投影规则见 §5.2。文件头带 `<!-- generated from classroom.yaml · do not edit this table by hand -->`。
2. **`classroom.yaml` 里不写任何"执行方式"的说明。** 它只写语义（在哪、多久、什么形态）。"引擎怎么做"归引擎文档，"模型怎么做"归 `AGENTS.md` 的生成模板。
3. **两份视图的差异只允许出现在"执行手段"一列，语义列必须逐字一致。**

### 5.2 投影规则（`classroom.yaml` → `AGENTS.md` 加载表）

| `classroom.yaml` 字段 | 插件模式（引擎） | skill 模式（AGENTS.md 生成文本） |
|---|---|---|
| `target: system` | `systemPrompt.section(name, order, text)` | "本文件是系统指令的一部分，启动时读一次" |
| `target: chat` + `depth: 0` + `frequency: turn` | 每步 `toSpliced` 贴尾注入，`<system-reminder>` 包装 | 🔴 **"每轮上课前读一次该文件（不可跳过）"** + 一条**降级条款**（见 §5.3） |
| `target: chat` + `frequency: n_turns, n: 5` | 引擎计数器，每 5 步注入 | "每 5 轮复述一次"（`_anchor.md` 原文即此措辞） |
| `frequency: phase` + `phase.phases` | 引擎按相位机判定后注入 | "**只在 <相位名> 时读**"（写成条件句） |
| `frequency: on_demand` | 引擎不注入 | "用到时才读"（= 现有 AGENTS.md 第三步的措辞） |
| `frequency: once(lesson_start)` | 讲次变化时重读一次 | "每讲首次读一次" |
| `render.vars` | 引擎替换 `{{...}}` | "按 `runtime/*.md` 的当前值手工替换 `{{...}}`" |
| `wrap.style: system-reminder` | 引擎加 `<system-reminder>` | **无法实现** → 见 §5.3 降级条款 |
| `source` | 引擎读该路径 | 模型用文件工具读该路径 |

### 5.3 🔴 skill 模式的两处真实降级（必须写进生成物，不能假装等价）

**降级 1 · `wrap` 无法实现。**
- 插件模式能把内容包成 `<system-reminder>` 并**贴在本轮对话之后**；skill 模式**做不到**——模型读文件的结果落在**读取那一刻**的位置，无法控制"贴尾"。
- 【原文·角色扮演架构 §3.1】给出两个候选（**该件明确标"都可测，未定案"**）：
  - **(a) 每轮自我锚定**：在当轮回复的 thinking 区用极短形式重述 3–5 条最硬纪律 —— "那段文字天然落在**历史之后**。成本 ≈ 0。"
  - **(b) 固定深度回读**：课前读一次 ≤1KB 的 `_anchor.md`；"文件读取结果同样落在历史之后（粗粒度版）"。
- → **生成物里写 (b) 为默认，写 (a) 为加强**（两者不冲突，可同时要求）。措辞直接沿用 §3.1，不另造。
- **可推翻点**：哪一条更有效，是 `M4` 要测的东西（该件 §6 第 5 条："跑一节课，**对比'有锚定／无锚定'的纪律遵守率**（可测，不凭感觉）"）。**本格式不预设结论，只预留位置**。

**降级 2 · `frequency` 的"每回合"在 skill 模式是"每回合被要求"。**
- 插件模式的 `every: turn` 是**保证**；skill 模式的对应物是**要求**。
- → 生成物必须在表头显式标注这个区别，**不能写成"每轮注入"**（会误导贡献者以为有保证）。
- 建议措辞：**"每轮**应由模型**读取（无插件时靠遵守）"**。

### 5.4 为什么不选另外两条路

| 候选 | 为什么不要 |
|---|---|
| **两套文件各写一份**（`AGENTS.md` 手写 + `classroom.yaml` 手写） | 直接违反 §5.0 的两个危险；且违反项目级纪律"一条内容只能有一个维护点"。 |
| **skill 模式也走一个"轻引擎"**（插件做不到时的 stub） | 【原文·形态裁定 D3】skill 形态存在的理由是"轻用户零门槛（不装插件也能用）"→ 加依赖就消灭了它存在的理由。 |

### 5.5 落地形态：生成物 + 标记区（不需要新工具链）

**v0 不引入构建脚本**（原则 3），而用**标记区**让 `AGENTS.md` 与 `classroom.yaml` 可机械对账：

```markdown
<!-- BEGIN GENERATED: injection-table (source: classroom.yaml) -->
| 层 | 文件 | 位置 | 频率 | 体量上限 |
|---|---|---|---|---|
| ① 常驻层 | characters/komari.md … | 系统段（最前） | 每讲一次 | ≤2KB |
…
<!-- END GENERATED: injection-table -->
```

- **标记区内的表**由 `classroom.yaml` 的 blocks 投影（人工按 §5.2 规则填，或用 30 行脚本生成）；
- **标记区外**是 skill 模式特有的说明（启动顺序、课后更新清单、降级条款）——这些**不属于注入语义**，manifest 不该承载。
- **对账动作**：任何一方改动后，逐行核对标记区内的表与 `blocks` 是否一致。**待确认**：是否需要一个小 lint 脚本自动对账（见 §8）。

> 🔴 **现有 cs-os 的 `AGENTS.md` 已经天然符合这个形状**：它的「加载策略：按『位置 + 频率』的五层」表（文件第 8–20 行）**就是** §5.2 的投影结果。→ 本格式不是要推翻它，而是**给它一个机器可读的真源**，并把表中"每轮"这类措辞按 §5.3 降级 2 修正。

---

## §6 第五设计项：与酒馆 v2 的取舍

> **口径**：本节所有酒馆字段与机制**均出自** `SocraticNovel_酒馆研究_2026-09-22.md`（节号已标）与 `SocraticNovel_角色写法参考_2026-09-22.md`（节号已标）。**不外扩、不凭印象补字段。**

### 6.1 ✅ 抄它的字段思想（抄"思想"，不是抄"字段名"）

| # | 抄什么 | 出处 | 落到本格式的哪个字段 |
|---|---|---|---|
| 1 | **版本标识 + 内容嵌套隔离**：V2 把字段嵌进 `data`，理由原文 *"to prevent V1-only editors from successfully loading a V2 card, but silently destroying its V2-only fields"* | 酒馆研究 §3a | `format: socratic-classroom/0` + `classroom:` / `blocks:` 两级嵌套。**同样目的**：老引擎读不懂 v1 的教室包时，应**拒绝加载**而不是**静默丢字段**。 |
| 2 | **`creator_notes`：永不进 prompt、但对人高可见**（原文 MUST NOT 进 prompt，SHOULD 对用户高可见度） | 酒馆研究 §3a | `purpose`（"这块为什么存在"）+ `notes` 字段 —— 引擎**不读**，贡献者与用户**必读**。 |
| 3 | **`extensions` 未知键必须保留**（原文 MUST 默认 `{}`，MUST NOT 销毁未知键值对，建议命名空间） | 酒馆研究 §3a | §7 的 `x_` 扩展位规则（引擎忽略但**不得报错、不得丢弃**）。 |
| 4 | **条目化的"位置 + 顺序"双字段**：`position`（`before_char`/`after_char`）+ `insertion_order`（"Entries with larger order numbers will be inserted closer to the end of the context as they will have more impact on the output"） | 酒馆研究 §2 | `position.target` + `position.order` / `position.after`。**"顺序=影响力"这个思想直接抄**（§2.1 的 `after` 锚点就是它的相对版）。 |
| 5 | **"深度 = 固定位置、不被长对话稀释"**（Character's Note 原文："always stays at a static depth in the chat history, **regardless of its progression**"） | 酒馆研究 §1b | `position.depth` + §2.2 的**语义澄清**（必须每轮重新注入，因为 compaction 会抹）。 |
| 6 | **频率控制注意力成本**（"Frequency 1 = … every user input prompt. Frequency 4 = … every 4th"） | 酒馆研究 §1f | `frequency.every` 的 `turn` / `n_turns`。 |
| 7 | **宏 = 每次构建时重新求值**（*"dynamic placeholders that get replaced with actual values when text is processed"*） | 酒馆研究 §1g | `render.enabled` + `render.vars`。**关键**：酒馆宏**每次重新求值**，我们照抄这个"每次加载时渲染"的语义（角色扮演架构 §3.2 已据此定案）。 |
| 8 | **`constant: true`（常驻、无需触发词）** | 酒馆研究 §2；角色写法参考 §2.5（语料 52% 条目是 constant） | 我们的 `frequency: once` + `target: system`。**思想**：常驻内容就该常驻，不要靠触发词。 |
| 9 | **条目命名法 `领域 :: 主题 (版本, 标签)`** | 角色写法参考 §4.1 C2 及该表第 463 行 | `position.section_name` 与 `name` 字段。 |
| 10 | **`{{original}}` 式"覆写时嵌入默认值"** | 酒馆研究 §3a | 【推断】**思想**值得留位：教室包覆盖引擎默认注入时，能引用"默认值"（见 §7 扩展位）。**v0 不实现**。 |

### 6.2 ❌ 明确不要的（**引用五层架构 §4 的不做清单**）

【原文·角色扮演架构 §4「明确**不做**的（因 1M 上下文而失效，照搬是浪费）」】——**该表整体适用，本格式逐条对应到"所以 manifest 里没有哪个字段"**：

| 酒馆机制（该表原条目） | 该表给出的理由（原文摘） | → 本格式**没有**的字段 |
|---|---|---|
| **关键词触发式世界书注入**（含递归／预算／Min Activations／组互斥） | "整套机制的前提是'上下文放不下全部资料'；1M 下教材全文可常驻" | ❌ 无 `keys` / `secondary_keys` / `selective` / `constant`（关键词义）/ `scan_depth` / `token_budget` / `min_activations` / `recursion` / `inclusion_group` / `group_weight` |
| **摘要压缩对话历史** | "触发点是'消息被挤出 prompt'；1M 下很少发生。**只保留'跨多日课程的进度摘要'**" | ❌ 无摘要字段；但**保留** `runtime/session_log.md` + `session_archive.md` 作为"跨多日进度摘要"（§4.4） |
| **向量检索（RAG）** | "教材已在上下文内；且检索**不可预测**（原文：*'it's impossible to predict exactly what entries will be inserted'*）——**教学以知识正确性为底线，不能接受不可预测注入**" | ❌ 无 `vectorized` / 相似度阈值字段。**这条是本格式"确定性"承诺的直接来源** |
| **多模型族 Instruct 模板体系** | "我们模型栈固定" | ❌ 无模型族包装字段（`wrap` 只有一个 `<system-reminder>` 形态） |
| **概率触发／随机事件** | "游戏化机制，教学不需要随机注入" | ❌ 无 `probability` / `trigger%` / `sticky` / `cooldown` / `delay` |

**另有两条来自《角色写法参考》§4.2 的排除**（该表原文）：
- **N7**：酒馆的注入调度参数（`position`/`insertion_order`/`priority`/`probability`/`recursive_scanning`/`token_budget`/`match_whole_words`）——"【原文-代码】蒸馏器自己就全丢弃（grep=0）；markdown 无对应机制"。
  → ⚠️ **但本格式与 N7 不冲突**，因为 N7 的语境是"**markdown 教室**没有对应机制"；**插件模式下 DSH 有 `agent/pre-step` 原语**（L1 §2.7）。→ **N7 的结论在插件模式成立后需要更新**：`position`/`insertion_order` 类字段**现在有落点了**。这是本格式相对既有文档的**一处口径推进**，已列 §8 待确认。
- **N8**：关键词触发作为主要加载手段（"52% 条目是 constant、33% 的卡零关键词 → 生态本身就不靠触发词"）。
  → **完全同意**：本格式**没有任何关键词字段**，加载全由 `frequency` + `phase` 决定。

### 6.3 🛠 我们自研、酒馆没有的（对应角色扮演架构 §5 的 C1–C5）

| 我们的字段 | 酒馆为什么没有 | 对应 §5 条目 |
|---|---|---|
| `phase`（教学相位门） | 酒馆**没有教学进度概念** | 【原文·§5 C3】"没有进度/课程状态概念（状态散在变量宏、chat metadata、手动注记里）" |
| `render.vars` 的 `runtime_store` 来源 | 酒馆的宏变量是**会话内**的（`{{setvar}}`/`{{getvar}}`），跨课持久状态没有 | 【原文·§5 C3】"**状态笔记本文件**（当前课次／掌握矩阵／待复习），由工具读写，取代宏变量" |
| `source` + 逐字读取（不做生成式注入） | 【原文·§5 C2】WI *"does not guarantee its appearance in the generated output messages"* | 【原文·§5 C2】"**事实层绝不依赖生成式注入**：知识点原文经文件工具**逐字读取**、答案可回查" |
| 知识锚（`anchor.check`） | 【原文·§5 C5】"官方对漂移无专章对策（本次检索未找到）" | 【原文·§5 C5】"**知识锚**：核心事实常驻 ＋ 每轮末尾短校验" |

> **一句话总结**（沿用 §5 的原文口径）：**搬走它的"分层 + 深度 + 频率 + 模板化"，丢掉它的"检索 + 压缩 + 随机"，自己做它没做的"自动加载 + 事实回查 + 答案评估"。**（角色扮演架构 §5 末句原文）

---

## §7 第六设计项：版本与扩展

### 7.1 三个版本号，各管各的

| 字段 | 位置 | 语义 | 何时变 |
|---|---|---|---|
| `format: socratic-classroom/0` | 顶层 | **格式版本**（= 引擎解析器的契约） | 字段增删改语义时。`0` = 草案期，**允许破坏性变更**；进 `1` 前需冻结 |
| `classroom.classroom_version` | 顶层 | **教室内容版本**（贡献者改内容时递增） | 改教材/人格/故事时 |
| `source_sha256` | 每条 block | **源文件内容哈希** | 文件内容变即变 |

**为什么要分开**：`format` 变了 → **所有**教室包都要改（引擎升级）；`classroom_version` 变了 → 只影响这一个教室。混用一个号会导致"改一句台词就把全库标成不兼容"。

**`source_sha256` 的作用（可选字段）**：检测"文件被改了但 manifest 没更新"——具体是**体量纪律**（如 `_anchor.md` 必须 ≤1KB，【原文·角色扮演架构 §3 表】）可以在**加载时校验**而不是靠人记得。**可推翻点**：哈希会让每次改内容都要重算 manifest（贡献者体验差）→ 建议**由生成/校验脚本填**，不由人手填。

### 7.2 `x_` 扩展位（v0 预留，引擎必须忽略）

**规则（抄酒馆 v2 的 `extensions` 语义）**：【原文·酒馆研究 §3a】`extensions` "MUST 默认 `{}`，**MUST NOT 销毁未知键值对**，建议命名空间如 `"agnai/voice"`"。
→ 本格式对应规则：**任何以 `x_` 开头的键，引擎必须原样保留、不得报错、不得用于注入决策**（除非引擎明确实现了该扩展）。

**v0 预留的四类扩展位**（都是 `形态裁定` 里已列出、但**当前不该实现**的）：

```yaml
# ── 扩展位 1：UI 资产引用（形态裁定 C1–C4，客户端插件） ──
x_assets:
  whiteboard:  { type: canvas, entry: assets/board.html }     # C3 白板
  live2d:      { model: assets/komari.model3.json }           # C2 Live2D
  mermaid:     { enabled: true }                              # C1 mermaid 渲染
  panels:      [{ slot: sidebar, entry: assets/status.html }]  # C4 状态侧栏

# ── 扩展位 2：多老师轮值（cs-os 现在单老师，但 AGENTS.md 已为多老师留了规则） ──
x_rotation:
  mode: per_lesson | per_block | manual
  schedule: { 1: komari, 9: komari }        # 讲次 → 老师

# ── 扩展位 3：非文本材料引用（教材/图表/音频） ──
x_materials:
  figures: [{ lesson: 6, src: assets/fig-6-1.svg, alt: "抽屉的空位放不下整份稿子" }]
  audio:   []

# ── 扩展位 4：题组/评估（现在没有，但教学必然要） ──
x_assessment:
  mode: socratic | quiz | mixed
  quiz_bank: assessments/quiz.yaml
```

**为什么现在不实现**：
- 扩展位 1 依赖 `形态裁定` **C 组（UI 类）** 的 L4 裁定落点 —— ✅ **L4 已核**（`ui-slots`／`conversation.chat.node` 可承载 mermaid／Live2D／白板；见 `侦察_L4_客户端UI.md`），扩展位可在 P2/P3 落地时再定形；
- 扩展位 2 在 cs-os **没有实例**（唯一当课老师 `komari.md` 覆盖全 14 讲）→ 无实例不设计（原则 3）；
- 扩展位 3 与 `materials/` 的章节模式重叠，等 `materials/ch02–ch14` 写完再看真实形态；
- 扩展位 4 是**新功能**，不是格式问题。

**唯一现在就要做的**：**在格式文档里写死"引擎必须忽略未知 `x_` 键"**。这样将来加扩展**不需要动 format 版本号**（= 不逼所有教室包升级）。

### 7.3 从 v0 到 v1 的收敛路径（建议，非承诺）

| 步骤 | 动作 | 前置 |
|---|---|---|
| 1 | 用 cs-os 跑通插件模式（§4 的 33 块映射全部可注入） | 注入引擎可用 |
| 2 | 用 cs-os 跑通 skill 模式（`AGENTS.md` 的标记区与 manifest 对账一致） | §5 生成物落地 |
| 3 | 跑 `M4` 对比实验（有锚定/无锚定纪律遵守率）→ 定 §5.3 降级 1 该用 (a) 还是 (b) | 步骤 1–2 |
| 4 | 按实测删字段（**v0 → v1 的主要动作是删，不是加**） | 步骤 3 |
| 5 | 冻 `format: socratic-classroom/1` | 步骤 4 |

> **为什么第 4 步是"删"**：v0 里至少有三处我明知可能是过度设计（`position.after` 锚点解析、`render.missing` 的四档、`curriculum.md` 的混合频率）。**格式的价值在于字段少而语义确定**，所以收敛动作应该是删到不能再删，而不是继续加。

---

## §8 待确认清单

> **口径**：以下每条都**不影响本草案成立**（已按默认处理并落盘），但需要用户或后续实测裁定。按"影响面"排序。

### A 类 · 影响引擎实现，必须实测（阻塞项）

| # | 待确认 | 我的默认处理 | 影响面 |
|---|---|---|---|
| **A1** | 🔴 **插件模式下 `AGENTS.md` 是否被宿主注入一次、manifest 又注入一次 → 内容重复？** 【原文·L1 §1.5】宿主确实会把 `AGENTS.md` 当 user message 注入（`agent-instructions` 包，`index.ts:315-341`）。 | 本稿已按"**manifest 不声明 `AGENTS.md` 为 block**"处理（§4.1 `meta.entry`）。 | **最大**。若重复，会出现"两套规则"，直接违反 §5.0 的初衷。**必须实测**：插件模式下数一数 `AGENTS.md` 的内容进 prompt 几次。 |
| **A2** | 宿主是否**两个都注入**（`AGENTS.md` + `CLAUDE.md`）？【原文·L1 §1.5】`DEFAULT_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.md', 'CLAUDE.md']`。 | 本稿把 `CLAUDE.md` 标为"不注入"（§4.1）。 | 若两个都注入，cs-os 每轮白白多背一份 7 行文件；且两份都进 = 更严重的重复。 |
| **A3** | 【原文·L1 §3.2 已标 T2】`agent/pre-step` payload 里的 `turn` 是"**即将开启的 turn 号**，不是刚结束的"——**需实测确认**。 | `frequency: n_turns` 的计数器语义按"引擎自己维护计数器"处理（不依赖 `turn`）。 | 中。影响 `anchor.check`（每 5 轮）的相位对齐。 |
| **A4** | 【原文·L1 §3.2】固定 depth 注入需**锚定真实 surface 位置**（`session.surface.nodes.length`），否则与 `agent-instructions`／`runtime-context` **抢位置**。 | 格式侧只声明 `depth: 0` 的**语义**，不规定实现。 | 中。若抢位置，纪律层可能被挤到错误的深度。 |

### B 类 · 格式设计选择，需用户拍板（可随时推翻）

| # | 待确认 | 我的默认处理 | 可推翻方向 |
|---|---|---|---|
| **B1** | **单文件 vs frontmatter**（§1.2 选了单文件 A） | 单文件 `classroom.yaml` | 若教室包膨胀到几百块 → 改 C（单文件 + frontmatter 覆盖） |
| **B2** | `render.missing` 的默认值（§2.4 选 `error`） | `error`（宁可炸不静默） | 若新教室首次启动因 runtime 为空而炸 → 改"首次缺失用 default、已有 store 用 error" |
| **B3** | `curriculum.md` 的**混合频率**（ondemand + 相位门强制一次，§4.5 冲突 5） | 保留混合 | 若引擎认为复杂度不值 → 退化为每轮注入（浪费但简单） |
| **B4** | `layer` 字段是否保留（§2.6，引擎不读、只给人对账） | 保留（五层是已定设计语言，manifest 不体现会漂移） | 删掉更干净 |
| **B5** | `wrap.header`（来源标注，便于调试）是否默认输出 | 建议只在 debug 模式输出 | 若调试需求强 → 默认输出（代价是 token 与"模型把标注当内容读"） |
| **B6** | `position.after`（相对锚点）vs 裸 `order` 谁优先 | 优先 `after` | 若宿主不暴露已注册段名清单 → `after` 退化为引擎内置白名单 |
| **B7** | `advance_on`（相位推进条件）是**可执行条件**还是**给模型的提示文本** | 未定（§2.3 已标） | 若无法规则化 → 退化为提示文本（字段类型变，语义变） |

### C 类 · 与既有文档的口径推进（需回填）

| # | 待确认 | 说明 |
|---|---|---|
| **C1** | 🔴 **《角色写法参考》§4.2 的 N7 条需要更新**。该条原文："酒馆的注入调度参数（`position`/`insertion_order`/`priority`/`probability`/…）【原文-代码】蒸馏器自己就全丢弃（grep=0）；**markdown 无对应机制**"。 | 该结论的语境是"**markdown 教室**没有对应机制"。**插件模式下 DSH 有 `agent/pre-step` 原语**（L1 §2.7："DSH 已经具备实现 (role, depth, 频率) 三重语义所需的全部原语"）→ **`position`/`insertion_order` 类字段现在有落点了**。本格式据此设计了 §2.1/§2.2。**建议回填一句到该文件的 N7 条**（本稿不擅自改既有文件）。 |
| **C2** | `_anchor.md` 的三拆（§4.1）是否同步改**真实文件** | 本稿只给 manifest 侧拆分方案。**是否把 `anchor.voice` 段真的搬出 `_anchor.md`** 是另一个决定（会动到现有教室包与 `AGENTS.md`）。**待用户拍板**。 |
| **C3** | §5.5 的**对账 lint 脚本**是否需要 | v0 用标记区 + 人工对账。若实测出现漂移，再写脚本（约 30 行）。 |
| **C4** | 🔴 **任务书输入更正**：cs-os 实测 **33 文件**（非 32，差 `CLAUDE.md`） | 已在本稿 §4.6 更正。若其他文档引用了"32"这个数字，需同步。 |

---

## §9 自报计时与产出物

| 项 | 值 |
|---|---|
| 产出文件 | `开源线/DSH定制/教室manifest格式_草案_v0.md`（本文件） |
| 写盘方式 | 骨架 → 逐节 `bash heredoc >>` 追加（§0/§1 → §2 → §3 → §4 → §4.6 修正 → §5 → §6 → §7 → §8/§9），**每节写完立即落盘，无攒批** |
| 读取的输入 | `形态裁定_初筛_2026-09-23.md`（全文 81 行）｜`SocraticNovel_角色扮演架构_2026-09-22.md`（全文 184 行）｜`SocraticNovel_酒馆研究_2026-09-22.md`（grep 定位后精读 §1–§3 约 135 行）｜`SocraticNovel_角色写法参考_2026-09-22.md`（grep 定位后精读 §2.5／§4 约 80 行）｜`侦察_L1_拼装权.md`（grep 定位后精读 §1.1–§1.5／§2.7／§3 约 90 行）｜cs-os 教室 **33 文件**（每个看开头 ≤30 行，未通读） |
| 未读的部分 | 酒馆研究 §4–§8（长期记忆/防漂移/三栏/对照表/待确认/来源）；角色写法参考 §1／§3／§5–§8；L2／L3／L4 侦察件（未在任务范围内） |
| 自报耗时 | **约 22 分钟**（含读取输入约 12 分钟、撰写与逐节落盘约 10 分钟） |
| 明确未做的事 | ① 未编造任何酒馆字段（每条引文标了节号）；② 未编造 cs-os 文件（§4.6 已用 `find` 实测核对）；③ 未修改任何既有文件（§8 C1/C2 的口径推进只提建议，等用户拍板）；④ 未调用任何询问类工具 |

---

**（草案 v0 结束）**
