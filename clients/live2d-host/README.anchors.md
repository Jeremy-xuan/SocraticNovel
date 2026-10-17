# live2d-host/README.md · 行锚表（机核）

> **为什么有这份文件**：README 正文原先散写源码行号（`lib/client.js:1282` 等 9 处）。
> 源码一被改动，这些行号就悄悄失准 —— 本仓库已真实发生多次。
> 现在**行号只出现在本表**，正文一律用锚点 `〔A01〕` 形式引用；本表由机核工具逐行核对。
>
> **机核工具（随仓库分发，可直接执行）**：本表由机核工具 `tools/anchors/check-anchors.mjs` 逐行核对。
> 在**仓库根**跑下面这条命令即可复跑本表（路径按仓库根解析，与本表所在目录无关）：
> ```
> node tools/anchors/check-anchors.mjs clients/live2d-host/README.md --list
> ```
> 退出码 0 ＝ 全部成立；非 0 ＝ 有 ERROR（悬空引用／孤儿锚点／id 重复／版本对不上／行号漂移／正文散写行号）。
> `--list` 会把每条锚点的**判定结果、解析到的文件、实际行号与命中行原文**逐条打出来。
> 工具自测：`node tools/anchors/selftest.mjs`（在临时目录里造最小仓库、逐类注入错误，全过退出码 0）。

> 📌 **边界说明**：本批只收拢 `clients/live2d-host/` 下的项目自研源码与探针；`vendor/` 第三方框架与 `samples/` 样本模型**未随仓库分发**（缺它们只影响 `npm run build` / `npm run capability`，不影响本表机核）。本文件（行锚表）记录的是取数时刻的哈希与行号，作为核对依据。
>
> 🔴 **本表自己会漂**：它记的是"**取数那一刻**的哈希＋行号"。源文件一改，本表立刻过期 ——
> 但机核会**当场报 ERROR**（不会像散写行号那样悄悄失准）。**修法**：重新取行号，并把下面版本表的哈希改成现盘值。

---

## 版本表

| V | 文件 | sha256 前 16 位 |
|---|---|---|
| V1 | clients/classroom-ui/lib/client.js | 34e807af2acf6056 |
| V2 | classrooms/cs-os/classroom.yaml | e973eb626560474f |
| V3 | classrooms/cs-os/characters/komari.md | a726ab8108d00997 |
| V4 | clients/live2d-host/scripts/build.mjs | b17c9e8ef382fbd7 |
| V5 | clients/live2d-host/scripts/run-capability.mjs | 9ec4d6ffa832f743 |

> 路径一律**相对仓库根**（`tools/anchors/check-anchors.mjs` 默认仓库根＝工具自身往上两级，即仓库根）。
> 取数时刻：**2026-09-25 19:26**（`client.js` 当时 3902 行）。
> ⚠️ `client.js` 在本仓库**仍被其他工作线改动**：本表记的是上述取数时刻的现盘值，
> 源文件一改 **V1 这几条就会变红**——这是**如实反映**，不是工具故障。修法见下方最后一段。

---

## 锚点表

| 锚点 | 说明 | 版本 | 行 | 片段 |
|---|---|---|---|---|
| A01 | `applyPhase()` 开头（§3.2 改动点 1 的定位点） | V1 | 2379 | `applyPhase(state) {⏎					if (state.expressionIndex === null) return;` |
| A02 | 原「静默 `return`」处；现已改成记一次去重标志 | V1 | 2388 | `phaseExpressionReported = true;` |
| A03 | 面板 6 个相位按下标取表情的枚举（§四 第 8 条依据） | V1 | 1857 | `const PHASE_STATES = {⏎			open: { expressionIndex: 0` |
| A04 | `readout()` 返回对象里的表情读数（§3.2 改动点 3 的定位点） | V1 | 2567 | `expressions: capability.expressions.length,` |
| A05 | 状态行的表情读数拼接（§3.2 改动点 2 · 方式 A 的定位点） | V1 | 3538 | `+ " · 表情 " + (readout.expression === null ? "—" : readout.expression) + "/" + String(readout.expressions)` |
| A06 | 面板命名硬约束：`models/<名>/` 与 `<名>.model3.json`（§五） | V1 | 1896 | `const modelDir = "models/" + modelName() + "/";⏎				const modelFile = modelName() + ".model3.json";` |
| A07 | 教室 `blocks[]` 里人格文件的注入项（§四 第 2 条依据） | V2 | 235 | `path: characters/komari.md` |
| A08 | 教室 `classroom.license` 及其依据注释（§四 第 3 条依据） | V2 | 50 | `license: CC-BY-NC-SA-4.0` |
| A09 | `_anchor.md`「角色声音速查」段的注入项（§四 第 5 条依据） | V2 | 327 | `section: 角色声音速查（生成任何台词前看一眼）` |
| A10 | `komari.md` 自述的「替换角色机制」（§四 第 1 条依据） | V3 | 4 | `并提供**替换角色机制**（换掉本文件即可换老师` |
| A11 | `build.mjs` 里 esbuild 的路径常量（§一 缺失时的失败方式） | V4 | 21 | `const ESBUILD = join(ROOT, 'vendor', 'node_modules', '.bin', 'esbuild');` |
| A12 | `run-capability.mjs` 里样本目录的路径常量（§一 缺失时的失败方式） | V5 | 21 | `const RES = join(ROOT, 'samples', 'Resources');` |

> **`lib/client.js:71` 这一条已改锚到 A06**。说明（**只陈述我核实过的**）：
> ① 在**现盘**（V1，3902 行）里，第 71 行是 `PORTRAIT_PAPER` 那段注释里的一行
>   （「画布的可绘区在深浅两种配色下都是白的」），**不是**面板 `model` 配置；`PORTRAIT_PAPER` 常量本身定义在第 76 行；
> ② 面板读 `model` 的地方是 `modelName()`（V1 第 1492 行）；
> ③ **我没能核实**在 README 写作时的那个版本（`f0a6356a…`，2144 行）里第 71 行到底是什么 ——
>   该版本已不在盘上，无法回溯。所以这里**不断言"原文引错"**，只说明"按现盘证据，锚应落在 A06"。
> 【推断／待确认】若原意是引 `__DSH_CLASSROOM_UI_CONFIG__` 的声明处，请指认具体是哪一处，我改锚。

> **A11／A12 是本次新增**：README §一 原先在正文里散写 `scripts/build.mjs:21` 与
> `scripts/run-capability.mjs:21`（机核报 `scattered-line-number`）。已把正文那两处改成
> 〔A11〕〔A12〕，并把这两个文件登记为 V4／V5 —— **不是豁免，是纳入机核**：源码一改就会报红。

---

## 修法（机核报红时）

1. 跑 `node tools/anchors/check-anchors.mjs clients/live2d-host/README.md --list`，看红在哪几条。
2. 重取行号：`python3 tools/anchors/fix_anchors.py clients/live2d-host/README.anchors.md --dry`
   —— 它只改**版本表哈希**与**锚点表行号**两个数字列，不动说明列、不动锚点 id、不删任何锚点。
   确认无误后去掉 `--dry` 写回。
3. 若报的是 `snippet-not-unique`（片段 0 次或 >1 次），**必须人工处理**：说明那段代码已不在原位，
   要重新选一条能唯一定位的片段（`--set A05=<新片段>`），**不许删锚点、不许放宽判据**。
