# 锚点表 · 接线说明_materials_ch08-14

> 旁挂文件（约定见 `tools/anchors/check-anchors.mjs` 文件头）：正文只写锚点 `〔Axx〕`，行号与 sha256 集中在这里。
> 机核：`node tools/anchors/check-anchors.mjs classrooms/cs-os/接线说明_materials_ch08-14.md --list`
> 路径基准：仓库根（``）。
> 🔴 版本哈希的语义：**这一条锚点引用的是这个版本**。`classroom.yaml` 再被改动（无论谁改）→ 哈希对不上 → 机核响亮报错，而不是静默失准。
> 📌 **为什么本文件会有锚点表**：初版正文散写了 `classroom.yaml` 的行号，那些行号在"合入用户新版内容"与"接线 ch08–14"两次改动后**已全部失效**。

## 版本表

| V | 文件 | sha256 前 16 位 |
|---|---|---|
| V1 | classrooms/cs-os/classroom.yaml | 7849899ca79b0bee |

## 锚点表

| 锚点 | 说明 | 版本 | 行 | 片段 |
|---|---|---|---|---|
| A01 | `material.current.01` 上方那段注释里"原注释曾写……该结论已过期"的改法（本文件第一节引的就是它） | V1 | 529 | `本段原注释曾写` |
| A02 | 教材块 `material.current.01` 的块头（本文件要"紧跟在它之后"插入 ch08–ch14） | V1 | 540 | `- id: material.current.01` |

## 行号散写豁免

| 文件 | 行 | 理由 |
|---|---|---|
| （无） | — | 正文经 `--scan` 实测散写行号 0 处，无需豁免 |
