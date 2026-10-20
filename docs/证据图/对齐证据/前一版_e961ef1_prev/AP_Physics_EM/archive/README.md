# archive/ — 归档文件记录

> 此目录存放已退役但有参考价值的文件。不参与教学运行，不在启动时加载。

| 文件 | 原始位置 | 归档原因 | 归档日期 |
|------|---------|---------|---------|
| `system.md` | `teacher/config/system.md` | Phase 1 context 瘦身时拆分为 `system_core.md`（~19KB，始终加载）+ `system_reference.md`（~6.5KB，按需加载）。原文件 ~40KB，保留备查。 | 2026-03-24 |
| `knowledge_points.md` | `teacher/config/knowledge_points.md` | Phase 2A 启动优化时按章拆分为 `knowledge_points/` 目录（overview + ch21-ch25）。每课只加载当章 KP，节省 ~11KB。原文件保留备查。 | 2026-03-24 |
| `幽鬼vs系统_文笔对比分析.md` | `teacher/reference/` | 两系统文笔对比分析。作为设计阶段参考，教学和维护均不需要常驻。 | 2026-03-24 |
| `p1.md` | `参考资料/` | 设计阶段参考资料。 | 2026-03-24 |
| `p2.md` | `参考资料/` | 设计阶段参考资料。 | 2026-03-24 |

---

*之前已 trash 的旧文件（不在此目录）：*
- `teacher/story_new.md` — story.md 拆分序章时的中间产物（2026-03-24 清理）
- `teacher/story_progression.md` — 旧版未拆分故事进度文件（2026-03-24 清理）
