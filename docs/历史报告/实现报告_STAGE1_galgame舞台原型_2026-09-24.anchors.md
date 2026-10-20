# 锚点表 · 实现报告_STAGE1_galgame舞台原型_2026-09-24.md

> 本文件是旁挂锚点表（ANCHOR-1 约定）：**正文只写 `〔Rxx〕`，行号与片段集中在这里**。
> 机核：`node 开源线/DSH定制/code/tools/anchors/check-anchors.mjs <文档> --root <仓库根>`
> 路径口径：**相对仓库根**（`大学申请/`）。
>
> 📌 本报告引用的源码事实与取证件 `code/prototypes/stage/取证_STAGE1_DSH会话区能变成什么样_2026-09-24.md`
> **同源**（同一份安装版座目录）；取证件另有自己的一份旁挂锚点表（`A01`–`A20`）。

## 版本表

| V | 文件 | sha256 前 16 位 |
|---|---|---|
| V1 | tmp/dsh-installed/dsh-cordis-client-runner/lib/client.js | e78c94d66a75d694 |
| V2 | tmp/dsh-installed/dsh-client-ui-conversation/lib/client.js | c4f30b2fe2917822 |

## 锚点表

| 锚点 | 说明 | 版本 | 行 | 片段 |
|---|---|---|---|---|
| R01 | `conversation.view` 座条目首行（会话级 list、`replaceRisk:"none"`） | V1 | 3319 | `key: "conversation.view",` |
| R02 | 会话内容区只渲染当前选中的那个 view | V2 | 15131 | `children: active !== void 0 && renderSlot("conversation.view", {` |
| R03 | 会话头在 tab 多于 1 个时渲染 tablist（安装版已有 chat/trajectory 两个） | V2 | 15092 | `tabs.length > 1 && (0, react_jsx_runtime.jsx)("div", {` |
| R04 | `conversation.composer` 座条目首行（chain/session、`replaceRisk:"none"`） | V1 | 2436 | `key: "conversation.composer",` |
| R05 | `shell.overlay` 座条目首行（list/root、安装版空位、`replaceRisk:"none"`） | V1 | 3948 | `key: "shell.overlay",` |
| R06 | `conversation.chat.node` 座条目首行（keyed/session、`shadows-shipped-ui`） | V1 | 2333 | `key: "conversation.chat.node",` |
| R07 | 消息节点 kind 已占用清单起点（含 `assistant-step` 与 `user`） | V1 | 2369 | `already taken: assistant-step` |
| R08 | `sidebar.panellist` 座条目首行（list/root、安装版空位、`replaceRisk:"none"`） | V1 | 4116 | `key: "sidebar.panellist",` |
| R09 | 「浮层本身是 click-through」逐字 | V1 | 3952 | `The layer itself is click-through` |
| R10 | `sidebar.right.pane.tab` 座条目首行（P3 已定案的右栏入口） | V1 | 4161 | `key: "sidebar.right.pane.tab",` |

## 行号散写豁免

| 文件 | 行 | 理由 |
|---|---|---|
| — | — | 本件无豁免项 |
