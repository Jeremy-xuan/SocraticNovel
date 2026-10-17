# classroom-ui/README.md · 行号旁挂锚点表

> 本表配合 `clients/classroom-ui/README.md` 使用：正文只写锚点 `〔Axx〕`，行号集中在本表。
> 每条锚点记「引的是哪个版本」（sha256 前 16 位）——源码一改，机核 `tools/anchors/check-anchors.mjs` 当场报 ERROR。
>
> 🔴 **外部分发守则**：下面只锚定**本仓库内实际存在**的源码（教室契约、立绘渲染宿主、引擎工具结果模板）。
> 安装版 / 上游 DSH 客户端包（`ui-sidebar-right`、`dsh-client-*`、`dsh-api-workspace-files`、`dsh-client-connection`、`packages/…`、`@deepseek-ai/dsh/…`、`contract/seed.ts`、`tmp/dsh-installed/…`、`bin.js`）**不在本仓库内分发**，
> 故 README 正文里那些引用**不造锚点**，只保留「文件 + 符号名 + 逐字片段/语义」并明确标注
> 「外部源码未随仓库分发，无法做本仓版本锚定」。需对照现盘安装版时，以 `tmp/dsh-installed/…`（基准＝安装版 0.1.5-rc.2）为基准另行核对。

## 版本表

| V | 文件 | sha256 前 16 位 |
|---|---|---|
| V1 | classrooms/cs-os/AGENTS.md | a18b1f744481419b |
| V2 | clients/live2d-host/src/host.js | a1fadb9154d58bc5 |
| V3 | clients/live2d-host/src/text-rhythm-provider.js | 16b80aa5ac423d2f |
| V4 | plugins/socratic-engine/index.mjs | bb4c4634ec14620d |

## 锚点表

| 锚点 | 说明 | 版本 | 行 | 片段 |
|---|---|---|---|---|
| A01 | 进度契约：机器可读行 `current_lesson`（本轮要讲讲次） | V1 | 62 | `机器可读行**（文件顶部）` |
| A02 | 进度契约：表格无「下次上课」行，本轮要讲语义唯一 | V1 | 66 | `不要把它加回来**：` |
| A03 | 立绘宿主：`modelHomeDir` 由 model3Url 推出 | V2 | 256 | `    this.modelHomeDir = model3Url.replace(/[^/]*$/, '');` |
| A04 | 立绘宿主：fetch model3Url 取字节 | V2 | 257 | `    const settingBuf = await (await fetch(model3Url)).arrayBuffer();` |
| A05 | 立绘宿主：fetch 取动作文件 | V2 | 427 | `        const resp = await fetch(url);` |
| A06 | 立绘宿主：`loadTexture` 用 `new Image()` 取贴图 | V2 | 77 | `    const img = new Image();` |
| A07 | 说话通道：`TextRhythmProvider`（IParameterProvider） | V3 | 111 | `export class TextRhythmProvider extends IParameterProvider {` |
| A08 | 写字通道：`WriteChannelProvider`（IParameterProvider，恒 0） | V3 | 271 | `export class WriteChannelProvider extends IParameterProvider {` |
| A09 | 引擎 `classroom_draw` 工具结果模板（逐字引用源） | V4 | 1016 | `板书图已落盘：${value.file}（${value.kind} → ${value.diagramType}｜${value.lines} 行 / ${value.bytes} B）｜` |

## 行号散写豁免

（无：正文不得散写行号；外部源码引用一律不写行号，只保留文件/符号名 + 逐字片段。）
