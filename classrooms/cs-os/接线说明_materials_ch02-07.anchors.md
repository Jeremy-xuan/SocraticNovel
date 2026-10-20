# 锚点表 · 接线说明_materials_ch02-07

> 旁挂文件（约定见 `code/tools/anchors/check-anchors.mjs` 文件头）：正文只写锚点 `〔Axx〕`，行号与 sha256 集中在这里。
> 机核：`node 开源线/DSH定制/code/tools/anchors/check-anchors.mjs 开源线/DSH定制/code/classrooms/cs-os/接线说明_materials_ch02-07.md --list`
> 路径基准：仓库根（`开源线/DSH定制/`）。
> 🔴 版本哈希的语义：**这一条锚点引用的是这个版本**。`classroom.yaml` 再被改动（无论谁改）→ 哈希对不上 → 机核响亮报错，而不是静默失准。
> 📌 **为什么本文件会有锚点表**：初版正文散写了 `classroom.yaml` 的行号（`391–399`／`384–390`／`35–37`），
> 那些行号在"合入用户新版内容"与"接线 ch08–14"两次改动后**已全部失效**——这正是锚点纪律要治的病。

## 版本表

| V | 文件 | sha256 前 16 位 |
|---|---|---|
| V1 | code/classrooms/cs-os/classroom.yaml | 7849899ca79b0bee |

## 锚点表

| 锚点 | 说明 | 版本 | 行 | 片段 |
|---|---|---|---|---|
| A01 | 教材块 `material.current.01` 的块头（本文件要"紧接在它之后"插入 ch02–ch07） | V1 | 540 | `- id: material.current.01` |
| A02 | `material.current.01` 上方那段注释里"文件不存在即抛错"的判据句（说明当时为什么只能声明 ch01） | V1 | 535 | `文件不存在即抛` |
| A03 | `lesson.of` 的静默失效教训（引擎不靠块 id 或 path 猜） | V1 | 36 | `不靠块 id 或 path 猜` |

## 行号散写豁免

| 文件 | 行 | 理由 |
|---|---|---|
| （无） | — | 正文经 `--scan` 实测散写行号 0 处，无需豁免 |
