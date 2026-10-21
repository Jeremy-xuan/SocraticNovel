# AGENTS.md — SocraticNovel（仓库入口）

> **本文件是仓库级入口。** 具体某个教室的指令在**那个教室目录里的 `AGENTS.md`**（越靠下的越具体）。
> 🔴 **状态只看 [`STATUS.md`](./STATUS.md)**：哪些能用、到哪一级、差什么，都在那一张表里。其他文档里的状态一律是历史快照。

---

## 这个仓库是什么

**SocraticNovel** —— 把教材变成"属于你的课"的开源系统。仓库里同时有**两代形态**，它们是同一条路的两步，不是两个项目：

| 形态 | 是什么 | 入口 | 现状 |
|---|---|---|---|
| **v1 · 内容框架** | 一个文件夹的 markdown：角色／教学法／教材／课程表／故事线／状态笔记本。交给支持文件读写的 AI，AI 扮演老师上课 | [`META_PROMPT.md`](./META_PROMPT.md)（v2.3 生成器）、[`AP_Physics_EM/`](./AP_Physics_EM/)（参考教室）、[`classrooms/cs-os/`](./classrooms/cs-os/)（操作系统 14 讲） | 内容完整；**当前主线不在这里** |
| **v2 · 教室运行时** | 把 v1 的内容装进 DSH：教学引擎（相位/注入/工具/课后更新）、整屏舞台、右栏面板、Live2D 立绘、技能分发 | [`plugins/socratic-engine/`](./plugins/socratic-engine/)、[`clients/`](./clients/)、[`skills/socratic-classroom/`](./skills/socratic-classroom/) | 开发中；**看 `STATUS.md` 的等级** |

> v1 的教室内容（`classrooms/cs-os`）就是 v2 引擎要加载的那份数据——**内容与运行时是分开的**（引擎×内容分离）。

## 想上课 / 测试？

🔴 **把工作目录切到具体教室目录再启动**：

```
cd classrooms/cs-os
# 然后在这个目录里启动你的 AI CLI，说"开始吧"
```

`classrooms/cs-os/AGENTS.md` 是那个教室的完整入口（**六层加载**：常驻／启动／**纪律层**／情境／状态／锚定）。**不要在仓库根目录直接开课**——那样只会读到本文件。

想跑一遍机器能验的东西：

```bash
node check.mjs      # 全仓库 L1 机核（技能自检、镜像一致、各客户端测试、引擎单测）
```

## 目录约定（按生命周期分，不按新旧分）

| 路径 | 生命周期 | 是什么 |
|---|---|---|
| `plugins/` | **product** | 教学引擎（相位推进、材料注入、`classroom_*` 工具、课后更新） |
| `clients/` | **product** | 客户端插件：整屏舞台 `classroom-stage-warm`、右栏面板 `classroom-ui`、立绘宿主 `live2d-host`、注入隐藏 `inject-hide` |
| `classrooms/<教室名>/` | **product（数据）** | 教室内容（入口＝该目录的 `AGENTS.md`）；`_anchor.md` 是纪律层 |
| `skills/socratic-classroom/` | **product（分发）** | 技能包；`classroom/` 是 `classrooms/cs-os` 的**生成镜像**，改真源后跑 `sync-classroom.sh` |
| `acceptance/` | **product（验收）** | 端到端验收流水线（L3，会花钱） |
| `tools/` | **support** | 被产品直接调用的工具：`animation-gate`（动画质量闸门）、`anchors`（文档行锚机核）、`deploy`（部署脚本）、`probes/`（宿主探针） |
| `research/` | **research** | 一次性实验的源码与证据（自动分层、立绘转模型、mermaid 美化、动画编排……）。**不是产品，不要在这里改功能**；结论在 `docs/历史报告/` |
| `archive/` | **archived** | 被取代的实现，只留结论与截图；**不要照着做** |
| `docs/` | **docs** | `架构/`（骨架与契约）、`历史报告/`（按日期，只读）、`证据图/`（截图与原始输出）、`计划与排产/`（**全是历史快照**） |
| `AP_Physics_EM/` | **legacy** | v1 的参考教室（物理），保留作对照 |

**三条硬规矩：**

1. **新的一次性研究 → `research/<主题>/`**，结论写进 `docs/历史报告/`；不要混进 `tools/` 或 `clients/`。
2. **被取代的实现 → `archive/`**，并在 `archive/README.md` 补一行（被谁取代、留了什么）。
3. **状态只在 `STATUS.md` 改**；历史报告、计划、盘点不再维护状态。

## 红线（改这个仓库时别踩）

1. **叙事不得污染教学正确性**：正式术语与机制以教材为准；类比有误导风险时说清它在哪里不成立，不为满足形式而每次考学生一次。
2. **教材只链不搬**：不把教材正文复制进仓库；`materials/` 放自写的学科内容底稿（模型、因果链、例子与边界），不放回合脚本。
3. **人格与教学法分离**：换角色文件不该影响教学法（`system_core.md` / `_anchor.md`）。
4. **加载顺序按"位置 + 频率"**，不按时间——最该遵守的纪律要落在**贴近对话**的位置。
5. **不自动 commit / 不自动 push**；第三方源码与模型资产不入库（按各目录 README 的官方出处获取）。
