# 接线说明 · `materials/ch08–ch14`

> **本文件只给接线片段，不改 `classroom.yaml`。** 有另一路在写 `materials/ch02–ch07`，两边都会往同一个 `groups` 列表里追加块；**直接改同一个文件会互相覆盖**，所以统一由最后一路接进去。
> **落盘时间**：2026-09-24
> **本次新增的磁盘文件**：`materials/ch08.md` … `materials/ch14.md`（7 个，均已存在）

---

## 一、为什么现在可以接

`classroom.yaml` 里对 `material.current.01` 的注释写明了当时只能声明 ch01 的原因：

> 🔴 草案的通配规则 `materials/ch{NN}.md` 覆盖 ch02–ch14，但 **ch02–ch14 磁盘上不存在**
> （唯一 materials 文件是 ch01.md；story/ch14.md 头部亦自注"正文：materials/ch14.md（待写）"）
> → 校验器对 path 用 readFileSync，缺失即抛错。故**只能声明已存在的 ch01**。
> 待 ch02–ch14 落盘后按同一模板追加 story.node.{NN} 同款块。

ch08–ch14 现已全部落盘（`wc -c` 实测：ch08＝12249B、ch09＝11535B、ch10＝12275B、
ch11＝14371B、ch12＝15481B、ch13＝14177B、ch14＝16450B）。**ch08–ch14 这一段可以从现在起接线。**

⚠️ ch02–ch07 是否已落盘，以另一路的产出为准——**接线时先 `ls materials/` 复核**，只追加磁盘上确实存在的讲次。

---

## 二、可直接粘进 `classroom.yaml` 的片段

**位置**：紧跟在现有的 `material.current.01` 块之后（即 `groups` 列表里，`D · 状态层` 注释块之前）。

**写法**：完全照 `material.current.01` 那一条——`layer: context`、`position: { target: chat, depth: 2 }`、
`frequency: { every: phase }`、`phase: { phases: [probe, check] }`、`wrap: { style: system-reminder }`、
`render: { enabled: false }`。**逐讲改成字面量块**（引擎目前不支持 `path` 的 `{NN}` 通配展开），
只把 `id`、`path`、`lesson.of` 三处按讲次替换。

```yaml
  # ── materials/ch08–ch14（2026-09-24 落盘）· 同 material.current.01 模板 ──
  # 频率与相位沿用 ch01 的依据（草案 §4.1／§4.3）：教材正文是**教师侧的知识地图**
  #   → 只在 probe（追问）与 check（对答案）相位注入；open 相位注入它会诱导模型
  #     提前把追问序列倒出来。

  - id: material.current.08
    path: materials/ch08.md
    layer: context
    position: { target: chat, depth: 2 }
    frequency: { every: phase }
    phase: { phases: [probe, check] }
    lesson: { current: true, of: 8 }
    wrap: { style: system-reminder }
    render: { enabled: false }

  - id: material.current.09
    path: materials/ch09.md
    layer: context
    position: { target: chat, depth: 2 }
    frequency: { every: phase }
    phase: { phases: [probe, check] }
    lesson: { current: true, of: 9 }
    wrap: { style: system-reminder }
    render: { enabled: false }

  - id: material.current.10
    path: materials/ch10.md
    layer: context
    position: { target: chat, depth: 2 }
    frequency: { every: phase }
    phase: { phases: [probe, check] }
    lesson: { current: true, of: 10 }
    wrap: { style: system-reminder }
    render: { enabled: false }

  - id: material.current.11
    path: materials/ch11.md
    layer: context
    position: { target: chat, depth: 2 }
    frequency: { every: phase }
    phase: { phases: [probe, check] }
    lesson: { current: true, of: 11 }
    wrap: { style: system-reminder }
    render: { enabled: false }

  - id: material.current.12
    path: materials/ch12.md
    layer: context
    position: { target: chat, depth: 2 }
    frequency: { every: phase }
    phase: { phases: [probe, check] }
    lesson: { current: true, of: 12 }
    wrap: { style: system-reminder }
    render: { enabled: false }

  - id: material.current.13
    path: materials/ch13.md
    layer: context
    position: { target: chat, depth: 2 }
    frequency: { every: phase }
    phase: { phases: [probe, check] }
    lesson: { current: true, of: 13 }
    wrap: { style: system-reminder }
    render: { enabled: false }

  - id: material.current.14
    path: materials/ch14.md
    layer: context
    position: { target: chat, depth: 2 }
    frequency: { every: phase }
    phase: { phases: [probe, check] }
    lesson: { current: true, of: 14 }
    wrap: { style: system-reminder }
    render: { enabled: false }
```

---

## 三、接线时要一起改的两处

### 1. `material.current.01` 上方那段注释已经过期

该注释的结论句是"**故只能声明已存在的 ch01**"。ch08–ch14 落盘后这句话不再成立。

**建议改法（接线那一路执行）**：把结论句改为（下面的文字可直接替换原段落的后半）：

```yaml
  #  🔴 ch08–ch14 已于 2026-09-24 落盘 → 已按同一模板追加 material.current.08–14。
  #     ch02–ch07 的状态以磁盘实际存在为准（接线前先 ls materials/ 复核）。
  #     引擎仍不支持 path 的 {NN} 通配展开 → 每一讲仍需逐条字面量声明。
```

**不要**顺手删掉整段注释——它记录了"为什么是 probe/check 相位"这条判据，仍是对后续讲次有效的依据。

### 2. 讲次数与 `lesson.of` 的一致性

`story.node.08`–`story.node.14` 已经在 `classroom.yaml` 里逐条声明（`lesson: { current: true, of: 8 }` … `of: 14`）。
本次追加的 `material.current.08`–`material.current.14` **`of` 值与之一一对应**，不存在新的讲次映射。

---

## 四、接线后的自查清单（建议按序执行）

1. `ls materials/` —— 确认要声明的每个 `path` 都真实存在（校验器对 `path` 用 `readFileSync`，缺失即抛错）。
2. 粘完之后**不要**只跑一次成功就结束——按 AGENTS.md 的既有做法，**从 classroom 目录启动一次**，确认引擎能装载、不报错。
3. 逐条核对 `id` 与 `path` 编号一致（`material.current.08` ↔ `materials/ch08.md`），这是最容易复制粘贴出错的地方。
4. 确认没有出现**重复的 `id`**（若另一路也追加了 ch08–ch14 的块，会撞 id——先 `grep -n "material.current" classroom.yaml` 看一遍）。

---

## 五、待确认清单（本文件作者标出，供接线者／用户裁决）

| # | 事项 | 说明与倾向 |
|---|---|---|
| 1 | **`phase: [probe, check]` 是否适用于全部 7 讲** | **倾向：沿用**。7 讲正文与 ch01 形态相同（都是"教学地图＋核心事实锚＋类比边界"），没有理由换相位。但 ch12／ch14 有"收束／复盘"性质，若教学上希望它们也在 `close` 相位被注入，需要单独改这两条。**本文件按"全部沿用"写，此项请接线者确认。** |
| 2 | **`frequency: { every: phase }` 是否过频** | **倾向：沿用**。它与 `material.current.01` 保持一致；`phase` 门限已经把它限制在 probe/check 两个相位内。若实测发现重复注入浪费上下文，可改为更低频——但这属于调优，不是接线必须解决的问题。 |
| 3 | **`render: { enabled: false }` 是否正确** | **倾向：沿用**。这三份教材正文是**教师侧材料**（文件头都写明"是教师侧的知识地图与备选问题，不是逐项执行的脚本"），不应渲染给学生看。 |
| 4 | **是否要为 ch08–ch14 各写一条 `material.current.{NN}` 的注释** | 已按 ch01 的做法，在片段顶部写了一条**共用注释**（而不是每条重复一遍），原因是 7 条判据完全相同、逐条重复会让 `classroom.yaml` 显著变长。若项目偏好"每条都带注释"，可按需拆分。 |
| 5 | **ch02–ch07 的接线归属** | 本文件只处理 ch08–ch14。ch02–ch07 由另一路产出，**其接线片段应在那一份说明文件里**，最后由统一接线的那一路合并。若合并时发现两份说明对同一位置给了不同写法，以 `material.current.01` 模板为准。 |

---

## 六、本文件没有做的事情（边界声明）

- **没有改 `classroom.yaml`**（按任务纪律：另一路也在写同一个文件，改动会互相覆盖）。
- **没有改** `knowledge_points.md`、`curriculum.md`、`story/**`、`AGENTS.md`、`system_core.md`。
- **没有碰** `plugins/**`、任何 profile 目录、`~/SocraticNovel-wt/`、`~/SocraticNovel-GitHub仓库/`。
- **没有** git commit／push，**没有**新增依赖。
