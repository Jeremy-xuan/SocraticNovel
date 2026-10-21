# archive/ —— 已废弃实现（只作历史参考，不要照着做）

这里的每一份都**已经被新实现取代**。保留它们只是为了回答「当初为什么这么做」「踩过什么坑」，
**不是可用的代码**。要写新东西请回到 `clients/`、`plugins/`、`tools/` 下的主线实现。

| 目录 | 曾经是什么 | 被谁取代 | 保留了什么 |
|---|---|---|---|
| `poc-动画可写性/` | 验证"现场生成教学动画"可不可行（386 MB → 564 KB） | `tools/animation-gate` ＋ `research/anim-prep`（课前预渲染＋课上取缓存） | 2 张关键帧、1 段 720p 样片、manim API 摘要 |
| `poc-白板可写性/` | 验证 `classroom_draw` 能不能真把板书"写"出来 | `plugins/socratic-engine` 的正式实现 ＋ 教室「白板渠道」纪律 | `verdicts.json`（判据原文）＋ 2 张对照截图 |
| `prototypes-stage-v1v2/` | 第一/二版 galgame 舞台（静态布局实验，没接引擎） | `clients/classroom-stage-warm` | 各版一张截图（用来知道当时为什么推翻） |
| `demo-旧样稿/` | 早期给外部看效果的样稿页（含课堂实录视频） | `mockups/stage-modern/`（9 份定稿样稿） | 一张样稿截图 |
| `classroom-stage-v0/` | **第一版课堂舞台**：挂在 `conversation.view` 座里的视图，读教室文件并渲染对话正文（2026-09-28 那版） | `clients/classroom-stage-warm`（改成整屏接管，不再占插槽） | **全部源码**（132 KB）。它的测试停在旧角色名「小鞠知花」，现已红；留作对照，**不要再跑它的测试** |
| `design-stage3/` | **舞台三方向静态设计原型**（A 夜读／B 讲台／C 書庫，各 4 屏）；C 方向后来定稿并写进 `classroom-ui`／`classroom-stage-warm` | 同上 | **源码 ＋ 12 屏截图**（7.6 MB）。这是纯静态设计稿、无运行产物，保留源码才能复现那 12 屏（唯一例外） |

合计约 12 MB（原始约 544 MB）。

维护规则：进这里的每一次迁移都必须在上面这张表里留一行；只保留 `README.md`（结论）与关键截图，
**源码与运行产物删除**（体积大且已无用）。
