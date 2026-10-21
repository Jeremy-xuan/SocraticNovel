# 对齐证据（PROMPT-ALIGN-1）

> 本目录是《对齐_新提示词与实现_2026-09-24.md》的证据。**全部命令都只读**：真仓库未 commit／未 push，`code/**` 未改一个字节。
> 取数窗口：**2026-09-24 14:54 – 15:01**（另有 14:22 的一次早期快照，差异见正文 §1.2）。

## 文件清单

| 文件 | 是什么 | 复现命令（工作区根或标明的目录执行） |
|---|---|---|
| `快照_取数时间.txt` | 取数时刻与两个仓库位置 | `date` |
| `快照_哈希_镜像与引擎.txt` | 镜像／技能包副本／引擎关键文件的 sha256 前 16 位 | `sha256sum <file> \| cut -c1-16` |
| `归属判定_01_git与mtime.txt` | HEAD 与提交元数据、`git status --porcelain`、`git diff --stat`、工作树 mtime | `git log` / `git show --stat` / `git status` / `git diff --stat` / `stat -f` |
| `归属判定_02_镜像对比.txt` | **逐文件字节比对**：镜像 vs `e961ef1`；以及"工作树 / HEAD / 镜像"三方哈希 | `git show e961ef1:<path> > tmp; cmp -s tmp <镜像>` |
| `归属判定_03_工作树归属.txt` | 用**冻结快照反查**证明工作树里那三个文件是我们写的 | 取工作树 sha256 → 在 `code/**` 全部同名文件里反查完全相同的副本 |
| `镜像增量_相对HEAD.txt` | 现盘镜像相对 HEAD 的逐文件 diff（`+` 行＝我们的增量） | `git show e961ef1:<path> > tmp; diff -u tmp <镜像>` |
| `引擎对HEAD内容的加载实测.txt` | 拿 HEAD 版 `progress.md` 跑 `loadManifest`＋`readRuntimeLesson` → **抛 `ManifestError`** | `/opt/homebrew/bin/node -e "…"`（见文件内命令） |
| `预热缓存键_当前值.txt` | 4 份教材 sha256 ＋ 5 条备课声明的**现算**缓存键 ＋ 历史键 | `import('./lib/prepstore.mjs').cacheKeyForItem` |
| `格式禁令扫描.txt` | `<sub>`／"你可以怎么回答"／括号旁白式写法／客户端是否渲染注入块 | `grep -rn …`（见文件内命令） |
| `HEAD原文/` | **`git archive e961ef1` 的冻结副本**（本报告 V1–V11 锚点的落点）。🔴 **2026-10-20 整顿已移出仓库**（旧代码副本不再入库）；`e961ef1` 与 `e961ef1^` 都在本仓库历史里，按右列命令可逐字节重建 | `git archive e961ef1 \| tar -x -C HEAD原文` |
| `前一版_e961ef1_prev/` | **`git archive e961ef1^` 的冻结副本**（旧口径原文，V12–V15）。🔴 **同上，已移出仓库** | `git archive e961ef1^ \| tar -x -C 前一版_e961ef1_prev` |
| `repo工作树旧版备份/` | ⚠️ **不是本报告建的**：14:56 由**另一条并发线**写入——它把真仓库工作树里那三个"我们的旧版"文件（`AGENTS.md`／`system_core.md`／`runtime/progress.md`）先备份到这里。三个备份的 sha256 与工作树**逐字相同**（`4029fd12…`／`5ca3e1dd…`／`4ad94cb6…`），说明那条线也判出了同一件事（见正文 §1.2 与 §6.3 U3）。**本报告不删它**（它是有用的证据）。 | `sha256sum` 对照 |

## 两个必须记住的局限

1. **镜像是活的**：本目录里的镜像侧哈希与行号是**某一刻**的快照。另一条线在 14:51–14:52（以及其后）仍在改
   `code/classrooms/cs-os/**` 与技能包副本 → 旁挂锚点表的 V16–V20 一改就红，**那是如实反映**。
2. **没有跑真实会话、没有重跑渲染计时**：所以"25–41 秒 vs 60–74 秒哪个准"本报告不裁决；
   "口径变了以后模型行为如何"列入必须重跑的验证（正文 §5 V5）。
