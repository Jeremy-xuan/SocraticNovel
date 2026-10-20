# AGENTS.md — 计算机系教室 · 操作系统（cs-os）

> **本文件是教室入口。** DSH 会自动加载 `AGENTS.md`：从项目根（`.git` 所在目录）沿目录链加载到当前工作目录，**越靠下越具体**。
> → **把本教室目录作为工作目录打开，本文件就是系统指令。** 不需要写插件、不需要改 agent loop。

---

## 🔴 加载策略：按「位置 + 频率」的五层（不是按时间的三级）

> **为什么改成这样**：长上下文研究显示**早置的系统提示会被长对话稀释**；酒馆的实现里"贴尾部"与"固定深度注入"**本来就是同一个机制**（`depth 0` = 最后一条消息，源码注释 `script.js:8921`）。
> → 所以**最该被遵守的纪律不能只堆在最前面**。本教室按下面的位置与频率加载。

| 层 | 文件 | 位置（在最终上下文里） | 频率 | 体量上限 |
|---|---|---|---|---|
| **① 常驻层** | `characters/komari.md`（当课老师的**人格核心**）＋ `runtime/learner_profile.md` | **最前**（系统段） | 每轮 | ≤2KB |
| **①′ 启动层** | `system_core.md`（**教学法**）＋ `world/metaphor.md`（**隐喻系统**）＋ `world/setting.md`（场景） | 系统段（启动时读一次） | **每课一次** | — |
| **② 纪律层** | 🔴 **`_anchor.md`** | 🔴 **每轮上课前读一次 = 落在历史之后** | **每轮** | ≤1KB |
| **③ 情境层** | `curriculum.md`（课程表）／`knowledge_points.md`（当讲知识点）／`story/ch{NN}.md`（当讲故事节点）／`materials/ch{NN}.md`（教材正文） | 中部，**用到时读** | 按需 | 按需 |
| **④ 状态层** | `runtime/progress.md`（课次/排班）／`runtime/mistake_log.md`／`runtime/review_queue.md` | 课前读，课后写 | 每课 | — |
| **⑤ 锚定层** | `_anchor.md` 的「本课不许违反项」段 ＋ **知识锚**（当讲核心事实校验） | 固定深度（同 ②，一次读入） | **每 N 轮复述一次** | ≤0.5KB |

⚠️ **可靠性说明**：② 与 ⑤ 靠**系统指令约束模型去执行**（我们不改宿主，拼装权不在我们手上）。**这是可测的**——跑一节课对比"有锚定／无锚定"的纪律遵守率。

---

## 启动顺序（强制）

### 第一步 · 每轮课前（不可跳过）
1. 🔴 **读 `_anchor.md`** —— 拿到本课的教学铁律与"不许违反项"。**这一步不能省**：它的作用是让纪律落在**贴近本轮对话**的位置。
2. 读 `runtime/progress.md` —— 上到哪了、这节课是第几讲。
3. 读 `runtime/review_queue.md` —— 今天有没有到期的复习项。
4. 读当课老师的人格文件（`characters/komari.md`）。

### 第二步 · 本课首次（一节课只需一次）
5. 读 `system_core.md` —— **教学法**（苏格拉底铁律、五级梯度、流程、复习与做题规则、防漂移）。
6. 读 `world/setting.md` ＋ `world/metaphor.md` —— 场景与**隐喻系统**（这一讲的概念怎么在编辑部里"被看见"）。
7. 读 `curriculum.md` —— 本讲在整门课里的位置、对应的 OSTEP 章节链接。
8. 读 `knowledge_points.md` 的**当讲条目** —— 这一讲要覆盖的知识点清单（`[ ]` = 未掌握）。
9. 读 `story/ch{NN}.md` —— 本讲的故事节点（必然／机会／犯错节点）。
   - 🔴 **第 1 讲之前先读一次 `story/overview.md`**（人物弧三段 + 暗线种子总表）。**它规定了她"什么时候可以流畅、什么时候不能"**——不读就会把弧线提前用完。
10. 读 `materials/ch{NN}.md` —— **本讲的教材正文**（自写的问答版；OSTEP 原文**只链不搬**）。

### 第三步 · 延迟加载（用到时才读）
- `runtime/session_log.md` —— 回顾历史时
- `runtime/session_archive.md` —— 查更早的历史时
- `runtime/mistake_log.md` —— 查错题时
- `runtime/diary.md` —— 写日记时
- **非当课老师的人格文件** —— 生成群聊消息时**优先只读 `_anchor.md` 的角色声音速查段**；只有需要更完整的性格描写时才读 `characters/*.md`
- `world/` —— 需要环境描写或设定细节时

---

## 课后更新（学习者说"今天到这"时执行）

**必须更新的文件**（一个都不能漏，顺序固定）：
1. `runtime/progress.md` —— 课次 +1、下次谁教、本讲状态
2. `runtime/session_log.md` —— 本课摘要（含压缩规则，见文件头部）
3. `knowledge_points.md` —— 本讲条目的 `[ ]` → `[x]`／`[~]`（部分掌握）
4. `runtime/review_queue.md` —— 写入本次要复习的知识点与日期
5. `runtime/mistake_log.md` —— 本课错题（若有）

### 课后更新容错
若更新中断：下次启动时**对比 `progress.md` 最后一条记录与 `session_log.md` 最后一条**——不一致就说明上次没写完，**先补全再上课**。

---

## 教材路径规则（🔴 与 AP 物理教室不同，务必注意）

- **OSTEP 原文：只链不搬。** 官网明文 *"INSTRUCTORS: please just link to them directly (instead of making a copy locally)"*。
  → 课程表里挂**官方章节链接**，学习者在线读；**本教室 `materials/` 里放的是我们自己写的问答版正文**，不是原文副本。
- **`materials/ch{NN}.md`**：本讲正文，**自写**。结构 = 「本讲要回答的核心疑问 → 一层层追问 → 结论由学生说出」。
- 若某讲需要 OSTEP 原文的图表：**链接 + 用自己的话重述**，不复制原文段落。
- **不做 OCR**：若需引用别的教材 PDF，先看有无文本层；无文本层的**不 OCR**，改为按需引用页码。

---

## 目录结构

```
cs-os/
├── AGENTS.md                  # 本文件（入口 · 五层加载声明）
├── _anchor.md                 # 🔴 纪律层：教学铁律 + 本课不许违反项 + 角色声音速查
├── system_core.md             # 教学法（苏格拉底铁律/五级梯度/流程/复习/做题/防漂移）· 学科已适配 CS
├── curriculum.md              # 课程表（14 讲，含 OSTEP 章节链接）
├── knowledge_points.md        # 知识点清单（58 条，按讲分组，带掌握状态与判据）
├── characters/                # 人格（当课老师）
│   └── komari.md              # 小鞠知花（本教室唯一当课老师，全 14 讲）
├── world/
│   ├── setting.md             # 世界观与场景（编辑部 v2，2026-09-22 重置）
│   └── metaphor.md            # 🔴 隐喻系统（编辑部 ↔ 操作系统，含"类比在哪不成立"）
├── story/                     # 故事节点（按讲拆分）
│   ├── overview.md            # 故事总览：人物弧三段 + 暗线种子总表 + 每讲核心疑问
│   └── ch01.md … ch14.md      # 各讲必然／机会／犯错节点
├── materials/                 # 教材正文（自写问答版，按讲拆分）
│   └── ch01.md …
└── runtime/                   # 运行时状态（每课更新）
    ├── progress.md            # 课次 + 排班
    ├── learner_profile.md     # 学习者档案（零问卷，靠观察）
    ├── session_log.md         # 课堂摘要（含压缩规则）
    ├── session_archive.md     # 历史归档
    ├── review_queue.md        # 间隔复习队列
    ├── mistake_log.md         # 错题本（含"错在哪一步"）
    ├── diary.md               # 她的日记
    └── wechat_group.md        # 群聊记录（配合 templates/wechat-chat.html）
```

---
