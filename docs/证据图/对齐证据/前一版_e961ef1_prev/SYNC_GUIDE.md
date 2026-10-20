# SocraticNovel 跨项目同步指南

> **用途**：当 AI 在任一项目中修改了教学方法论相关内容后，依照本文档快速同步到其他项目。
> **维护者**：任何修改方法论内容的 AI 都应在完成后参照本指南。

---

## 1. 三个项目的关系

```
┌──────────────────────────────────────────────────────────┐
│  Layer 1: FRAMEWORK（方法论源头）                         │
│  SocraticNovel-GitHub仓库/                               │
│  • 苏格拉底教学法方法论.md  ← 25篇论文提炼的核心方法       │
│  • META_PROMPT.md           ← 系统生成框架                │
│  • ARCHITECTURE.md          ← 系统设计蓝图                │
│  • NARRATIVE_DESIGN.md      ← 叙事沉浸框架                │
│  • AI_GUIDE.md              ← AI 执行指南                 │
│  ★ 这是方法论的唯一权威来源 (Source of Truth)              │
└────────────────────┬─────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
┌──────────────────────┐  ┌────────────────────────────────┐
│  Layer 2: APP（桌面） │  │  Layer 3: INSTANCE（实例）      │
│  socratic-novel-     │  │  SocraticNovel-GitHub仓库/     │
│  软件开发/           │  │  AP_Physics_EM/                │
│  • 生产桌面应用       │  │  • AP物理学学习系统             │
│  • 多workspace支持    │  │  • 第一个部署实例               │
│  • 工具集成 (10个)    │  │  • GitHub原生使用               │
└──────────────────────┘  └────────────────────────────────┘
```

**同步方向**：Project 1 → Project 2 & 3（单向为主）。实例中的改进如果具有通用性，反向合并到 Project 1。

---

## 2. 核心共享内容：三铁律

所有项目必须保持一致的核心规则：

| 铁律 | 含义 | 检验方法 |
|------|------|---------|
| **只问不说** | 每回复中提问数 ≥ 陈述数 | AI 不得主动解释概念 |
| **眼睛看学生** | 问题从学生最后一句话生长 | 盲测：不看上文能问出来吗？ |
| **答案是学生的** | 学生必须自己说出术语和结论 | AI 不得代替命名/给最终答案 |

**在各项目中的位置**：

| 项目 | 文件路径 |
|------|---------|
| Framework | `苏格拉底教学法方法论.md`（约第 409-428 行） |
| Desktop App | `workspaces/ap-physics-em/teacher/config/system_core.md`（约第 35-41 行） |
| AP Physics | `AP_Physics_EM/teacher/config/system_core.md`（约第 21-27 行） |

---

## 3. 文件同步映射表

### 方法论变更（最高优先级）

当 **`苏格拉底教学法方法论.md`** 发生变更（三铁律、P0-P5 教学阶段、S1-S5 支架梯度）：

```
必须同步：
├─ Desktop App:
│  ├─ workspaces/ap-physics-em/teacher/config/system_core.md
│  ├─ workspaces/ap-physics-em/teacher/config/system_prep.md  (如 P0 阶段变更)
│  └─ workspaces/ap-physics-em/teacher/config/system_post.md  (如 S1-S5 变更)
│
├─ AP Physics:
│  ├─ AP_Physics_EM/teacher/config/system_core.md
│  └─ AP_Physics_EM/archive/system.md  (追加版本记录)
│
└─ 验证：三个项目的铁律措辞完全一致
```

### Meta Prompt 变更

当 **`META_PROMPT.md`** 发生变更（文件结构定义、生成阶段）：

```
必须同步：
├─ Desktop App:
│  ├─ public/protocols/animatutor/meta_prompt_v2.3.md
│  └─ src-tauri/src/ai/meta_prompt.md  (如果存在)
│
└─ 注意：AP Physics 是已实例化的系统，不受 Meta Prompt 变更影响
         （除非要重新生成系统）
```

### 叙事框架变更

当 **`NARRATIVE_DESIGN.md`** 发生变更（沉浸规则、角色深度）：

```
必须同步：
├─ Desktop App:
│  └─ workspaces/ap-physics-em/teacher/config/system_narrative.md
│
├─ AP Physics:
│  ├─ AP_Physics_EM/teacher/story.md
│  ├─ AP_Physics_EM/teacher/prologue.md
│  └─ AP_Physics_EM/teacher/characters/*.md
│
└─ 评估：叙事变更是否影响已有角色的行为一致性
```

### 系统架构变更

当 **`ARCHITECTURE.md`** 发生变更（文件路径、目录结构）：

```
必须检查：
├─ Desktop App:
│  ├─ src/hooks/useAiAgent.ts  (readFile 路径)
│  ├─ src-tauri/src/commands/fs_commands.rs  (workspace 路径)
│  └─ src-tauri/src/ai/runtime.rs  (文件读取逻辑)
│
├─ AP Physics:
│  └─ 目录结构是否仍匹配预期路径
│
└─ 注意：架构变更可能导致 App 运行时文件找不到！
```

---

## 4. 完整同步矩阵

| Framework 文件 | 影响级别 | Desktop App 需更新 | AP Physics 需更新 |
|---------------|---------|-------------------|------------------|
| 苏格拉底教学法方法论.md | 🔴 关键 | system_core.md, system_prep.md, system_post.md | system_core.md, archive/system.md |
| META_PROMPT.md | 🟡 重要 | meta_prompt_v2.3.md | （仅新实例） |
| NARRATIVE_DESIGN.md | 🟡 重要 | system_narrative.md | story.md, prologue.md, characters/*.md |
| ARCHITECTURE.md | 🟠 中等 | useAiAgent.ts, runtime.rs, workspace 路径 | 目录结构 |
| AI_GUIDE.md | 🟠 中等 | system_core.md（规则段落） | system_core.md（规则段落） |
| SOCRATIC_DESIGN.md | 🔵 参考 | （无直接影响） | （无直接影响） |

---

## 5. 各项目独有内容（不需同步）

### Desktop App 独有
- `src/` — React 前端代码
- `src-tauri/` — Rust 后端代码
- `src/i18n/` — 多语言翻译
- `.github/workflows/` — CI/CD
- 10 个 AI 工具定义（think, render_canvas 等）
- KaTeX 渲染指令

### AP Physics 独有
- `teacher/characters/` — Ritsu, Rin, Saku 角色实现
- `teacher/story_progression/` — 8+ 物理章节映射
- `materials/textbook/` — AP Physics C PDF 教材
- `materials/练习册/` — 物理练习题
- 物理学科特定示例

### Framework 独有
- `参考资料/` — 研究论文
- `plan.md` — 框架开发计划
- 英文版文档（*_EN.md）

---

## 6. AI 操作检查清单

当你在任一项目中修改了教学方法论相关内容，请按以下步骤操作：

### Step 1: 确认变更范围
```
□ 变更涉及三铁律？          → 同步到全部 3 个项目
□ 变更涉及教学阶段 P0-P5？   → 同步到全部 3 个项目
□ 变更涉及支架梯度 S1-S5？   → 同步到全部 3 个项目
□ 变更涉及 Meta Prompt？     → 同步到 Desktop App
□ 变更涉及叙事框架？         → 同步到 Desktop App + AP Physics
□ 变更涉及文件路径/结构？     → 检查 Desktop App 运行时路径
□ 变更是学科特定内容？        → 不需要同步
```

### Step 2: 执行同步
```
1. 找到目标项目中的对应文件（参照第 3 节映射表）
2. 对比差异，确保核心措辞一致
3. 适配项目特定的格式（Desktop App 的 system_core.md 有 LaTeX 指令等额外内容）
4. 保持版本一致性（如有版本号）
```

### Step 3: 验证
```
□ 三铁律在三个项目中措辞完全一致
□ 教学阶段定义一致
□ 文件路径引用正确
□ Desktop App: cargo check 通过
□ Desktop App: tsc --noEmit 通过
```

---

## 7. 项目路径速查

| 项目 | 本地路径 | GitHub |
|------|---------|--------|
| Framework | `/Users/wujunjie/SocraticNovel-GitHub仓库/` | github.com/Jeremy-xuan/SocraticNovel |
| Desktop App | `/Users/wujunjie/socratic-novel-软件开发/` | github.com/Jeremy-xuan/SocraticNovel-software |
| AP Physics | `/Users/wujunjie/SocraticNovel-GitHub仓库/AP_Physics_EM/` | （同 Framework 仓库子目录） |

---

## 8. 常见同步场景示例

### 场景 A：修改了三铁律的自检机制

1. 在 Framework 的 `苏格拉底教学法方法论.md` 中修改自检清单
2. 同步到 Desktop App:
   - 打开 `workspaces/ap-physics-em/teacher/config/system_core.md`
   - 找到「自检」相关段落，更新为新版本
3. 同步到 AP Physics:
   - 打开 `AP_Physics_EM/teacher/config/system_core.md`
   - 找到对应段落，更新
4. 在 `AP_Physics_EM/archive/system.md` 追加变更记录

### 场景 B：新增了一个教学阶段

1. 在 Framework 的 `苏格拉底教学法方法论.md` 中新增阶段定义
2. 评估是否需要修改 ARCHITECTURE.md（如果新阶段影响系统结构）
3. Desktop App:
   - 更新 system_core.md
   - 如果需要新的 system prompt 文件，创建 system_xxx.md
   - 更新 `src-tauri/src/ai/runtime.rs` 中的阶段枚举（如有必要）
4. AP Physics: 更新 system_core.md

### 场景 C：重新设计了 Meta Prompt 模板

1. 在 Framework 中更新 `META_PROMPT.md`
2. Desktop App:
   - 更新 `public/protocols/animatutor/meta_prompt_v2.3.md`
   - 升级版本号为 v2.4（或相应版本）
3. AP Physics: 不受影响（已实例化系统）
4. 未来新建 workspace 将使用新模板
