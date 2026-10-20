# 接线说明 · `materials/ch02.md`–`ch07.md` 接入 `classroom.yaml`

> **本文件只写接线片段，不直接改 `classroom.yaml`**（按派发纪律：另一路同时在写第 8–14 讲，改同一文件会互相覆盖；由统一的一路最后接进去）。
> **产出方**：第 2–7 讲教材正文写作路。**落盘日期**：2026-09-24。

---

## 一、现状

`classroom.yaml` 的 C · 情境层目前**只有一条**教材块：

- `material.current.01`（`classroom.yaml` 第 **391–399** 行），`path: materials/ch01.md`，`lesson: { current: true, of: 1 }`，相位门 `[probe, check]`。

其上方第 **384–390** 行的注释说明了原因：**校验器对 `path` 用 `readFileSync`，文件不存在即抛错**，所以当时只能声明磁盘上真实存在的 `ch01.md`。

🔴 **该注释里的"ch02–ch14 磁盘上不存在"现在已经过期**：本路已落盘 `materials/ch02.md` … `materials/ch07.md`（6 个文件，见第四节实测字节）。**接线的同时请一并更新第 384–390 行的注释**（它现在会误导后来人）。第 8–14 讲由另一路负责，不在此文件承诺。

---

## 二、插到哪里

**位置**：紧接在 `material.current.01` 块之后（即第 **400** 行那个空行处），**在第 401 行 `# D · 状态层` 的分隔注释之前**。

即：

```
    lesson: { current: true, of: 1 }
    wrap: { style: system-reminder }
    render: { enabled: false }
                                        ← 在这里插入下面 6 条
  # ══════════════════════════════════════════════════════════════════════════
  # D · 状态层（runtime/ 8 文件）……
```

**顺序**：`.02` → `.07` 按讲次升序排列，与 `story.node.NN` 的排法一致。

---

## 三、可直接粘贴的片段

> 照 `material.current.01` 的写法逐字对齐：**块结构完全相同，只有 `id` / `path` / `of` 三个值随讲次变化**。
> 🔴 `lesson.of` 必须**显式写成本块所属的讲次**（引擎不靠块 id 或 path 猜；`of` 写错＝静默失效，见 `classroom.yaml` 第 35–37 行的既有教训）。
> 🔴 `phase.phases` 保持 `[probe, check]` 不变——本批 6 份正文与 ch01 形态一致，都是**教师侧的知识地图**，开场注入会诱导模型提前把追问序列倒出来。

```yaml
  # materials/ch02.md · 进程的 API 与生命周期（KP-2.1～2.4）
  - id: material.current.02
    path: materials/ch02.md
    layer: context
    position: { target: chat, depth: 2 }
    frequency: { every: phase }
    phase: { phases: [probe, check] }
    lesson: { current: true, of: 2 }
    wrap: { style: system-reminder }
    render: { enabled: false }

  # materials/ch03.md · 调度：谁来决定下一个跑谁（KP-3.1～3.5）
  - id: material.current.03
    path: materials/ch03.md
    layer: context
    position: { target: chat, depth: 2 }
    frequency: { every: phase }
    phase: { phases: [probe, check] }
    lesson: { current: true, of: 3 }
    wrap: { style: system-reminder }
    render: { enabled: false }

  # materials/ch04.md · 更公平的调度与多核（KP-4.1～4.4）
  - id: material.current.04
    path: materials/ch04.md
    layer: context
    position: { target: chat, depth: 2 }
    frequency: { every: phase }
    phase: { phases: [probe, check] }
    lesson: { current: true, of: 4 }
    wrap: { style: system-reminder }
    render: { enabled: false }

  # materials/ch05.md · 内存：每个程序都有自己的世界（KP-5.1～5.4）
  - id: material.current.05
    path: materials/ch05.md
    layer: context
    position: { target: chat, depth: 2 }
    frequency: { every: phase }
    phase: { phases: [probe, check] }
    lesson: { current: true, of: 5 }
    wrap: { style: system-reminder }
    render: { enabled: false }

  # materials/ch06.md · 地址翻译：硬件怎么帮我们作弊（KP-6.1～6.4）
  - id: material.current.06
    path: materials/ch06.md
    layer: context
    position: { target: chat, depth: 2 }
    frequency: { every: phase }
    phase: { phases: [probe, check] }
    lesson: { current: true, of: 6 }
    wrap: { style: system-reminder }
    render: { enabled: false }

  # materials/ch07.md · 分页与 TLB（KP-7.1～7.4）
  - id: material.current.07
    path: materials/ch07.md
    layer: context
    position: { target: chat, depth: 2 }
    frequency: { every: phase }
    phase: { phases: [probe, check] }
    lesson: { current: true, of: 7 }
    wrap: { style: system-reminder }
    render: { enabled: false }
```

---

## 四、接线后应核对的项

| 检查项 | 期望 |
|---|---|
| `materials/ch02.md` … `ch07.md` 存在且非空 | ✅ 已落盘，字节见下表 |
| 每个 `path` 指向真实文件 | 校验器用 `readFileSync`，缺失即抛错——6 个文件都已存在 |
| `lesson.of` 与 `path` 的讲次一致 | `.02`→`of: 2` … `.07`→`of: 7`，逐条核对 |
| `id` 唯一、不重名 | `material.current.02` … `.07` 与既有 `.01` 不冲突 |
| 与 `story.node.NN` 的相位分工不重叠 | `story.node.*` 走 `[open]`，`material.current.*` 走 `[probe, check]`，互不覆盖 |
| YAML 缩进 | 6 条均为 `  - id:`（2 空格 + `- `），字段 4 空格，与 `.01` 完全对齐 |

**实测字节（`wc -c`，2026-09-24）**：

| 文件 | 字节 | 与 `ch01.md`（7975B）之比 |
|---|---|---|
| `materials/ch01.md`（基准） | 7975 | 1.00 |
| `materials/ch02.md` | 8181 | 1.03 |
| `materials/ch03.md` | 10053 | 1.26 |
| `materials/ch04.md` | 9690 | 1.21 |
| `materials/ch05.md` | 9168 | 1.15 |
| `materials/ch06.md` | 10539 | 1.32 |
| `materials/ch07.md` | 11311 | 1.42 |

多出来的部分是**每讲末尾的「本讲知识点覆盖对照表」**（本批正文的强制交付项，`ch01.md` 没有这一节）。除该表外，各讲的小节结构与 `ch01.md` 一一对应。

---

## 五、本路**没有**做、也不该由本路做的事

- ❌ **没有改 `classroom.yaml`**（按派发纪律，避免与第 8–14 讲那一路互相覆盖）。
- ❌ 没有改 `knowledge_points.md` / `curriculum.md` / `story/**` / `AGENTS.md` / `system_core.md` / `_anchor.md`。
- ❌ 没有 commit / push。
- ⚠️ **第 384–390 行注释已过期**，需接线那一路顺手更新（见第一节）。这一项**不由本路代改**，特此标出，避免两边都以为对方会做。
