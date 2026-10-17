# live2d-host —— Live2D 立绘渲染宿主（项目自研源码层）

> 本文件是**本目录（`clients/live2d-host/`）的唯一入口文档**：命令怎么跑、能力发现怎么读、**换一个立绘/换一位老师要跟着改哪些文件**。
> 来源标注：`【源码】`＝从本目录源码逐行读出来的事实；`【实测】`＝本目录脚本跑出来的原始输出；`【推断】`＝我的判断。

> 🔴 **本批只收拢项目自研源码，第三方资产未随仓库分发：**
> - 官方 **Live2D Cubism Web Framework（R5）** 与 **Cubism Core（6.0.1）** 作为依赖存在（`src/framework-entry.js` 通过 `@framework/*` 别名 import、宿主/构建均指向 `vendor/`），**本仓库不含 `vendor/` 目录**——它们需按下方「官方出处」从 Live2D 官方 SDK 获取。
> - **样本模型**（原 `samples/Resources/` 下的 Haru／Hiyori／Mao… 官方 Web Samples、以及 `miku`／`miku_sample_t04`）**未随仓库分发**——它们需按下方「官方出处」从 Live2D 官方样本数据页获取。
> - 因此 `scripts/build.mjs`、`scripts/run-capability.mjs` 以及 `tools/*.cjs` 依赖 `vendor/`、`samples/`、`out/` 的部分**在没有上述资产时无法运行**；这类失败是**预期阻塞**，不是代码缺陷——详见 §〇之补。

## 〇 · 这是什么

一个**与页面零耦合**的 Live2D 渲染宿主（官方 Cubism Web Framework R5 ＋ 官方 Cubism Core 6.0.1）：

- `src/host.js` —— 渲染宿主（只吃传入的 `<canvas>`，不查 `document`）
- `src/capability.js` —— **能力发现**（纯 JSON 解析，Node 与浏览器都能跑，不依赖任何第三方模块）
- `src/text-rhythm-provider.js` —— 文字节奏嘴型（`speak` / `write` 两条通道）
- `src/idle-director.js` —— **通用待机/演出编排层**（呼吸 / 非机械眨眼 / 轻微重心·视线 / 嘴闸门；能力发现驱动、seed 可注入、不绑 Haru 参数名）【本轮新增】

### 官方出处（本仓库只列链接，不含任何第三方资产）

| 资产 | 官方出处 | 说明 |
|---|---|---|
| Cubism Web Framework（R5） | Live2D 官方 SDK 下载页 `https://www.live2d.com/download/sdk/` 的「Cubism SDK for Web」 | 框架源码（`@framework/*`），原置于 `vendor/CubismWebFramework/` |
| Cubism Core（6.0.1） | 同上 SDK 包内的 `Core/`（运行时 `live2dcubismcore.min.js`） | 专有运行时，原置于 `vendor/Core/`；`demo/demo.html` 通过 `<script src="./live2dcubismcore.min.js">` 加载 |
| 官方 Web Samples（Haru／Hiyori／Mao／Mark／Natori／Ren／Rice／Wanko 等） | Live2D 官方样本数据页 `https://www.live2d.com/download/sample-data/` | 原置于 `samples/Resources/` |
| 官方初音ミク（FREE／PRO 的 `runtime/`） | `https://cubism.live2d.com/sample-data/bin/miku/miku_ja.zip`（样本数据页列有「初音ミク」） | 原置于 `samples/Resources/miku`、`samples/Resources/miku_sample_t04`（本次试装**未进树**，见 README §九） |

> ⚠️ **缺失时的失败方式（预期阻塞，非代码缺陷）**：未放置 `vendor/CubismWebFramework` 时，`build.mjs` 将因找不到 `vendor/node_modules/.bin/esbuild`（见 〔A11〕）与框架目录而报错；未放置 `samples/Resources` 时，`run-capability.mjs` 会因 `samples/Resources` 目录缺失（见 〔A12〕）而无法列举样本。本目录其余纯自研文件（`src/capability.js`、`src/text-rhythm-provider.js`、`package.json` 等）不依赖第三方资产，可独立做语法/静态检查。

> 📌 **许可说明的边界**：本 README **只列出官方出处链接与「缺失时如何失败」**，并标出哪些官方页写有使用条件（见 §十二）；**不做任何许可判定、不替用户下结论**。任何授权/合规判断由用户自行研究决定（项目规则禁止代为研究法律问题）。

---

## 〇之补 · 通用待机/演出编排层（idle-director）先例归属与设计

> 本轮新增 `src/idle-director.js` + 单测 `tests/idle-director.test.mjs` + 取证探针 `tools/idle-evidence-probe.cjs`。
> 立项前已读 2–4 个同类实现（**先读 prior art，不从头推导**），以下逐条分清「借什么 / 不借什么 / 哪一步无先例」。

### 借什么（prior art 已验证的做法）

| 来源 | 借的机制 | 本地可 grep 复现 |
|---|---|---|
| 官方 Cubism Web Framework R5 | 呼吸/眨眼/视线**语义**：`CubismEyeBlinkUpdater` 仅在「主动作没更新」时才眨眼（`_motionUpdated` 门控）；`CubismBreath` 用正弦加性；`CubismLook` 用 drag→参数 | `vendor/CubismWebFramework/src/effect/cubism*.ts`、`src/motion/cubism*updater.ts` |
| airi / moeru-ai（`~/折腾AI/airi`） | ① 可注入种子的眨眼状态机（closing/opening + 随机间隔）；② 呼吸「余弦 inhale + 余弦 exhale + 末端 dwell」曲线（`sampleLive2DBreath`）；③ 视线 saccade 间隔概率表 + 朝目标 lerp（`eye-motions.ts` / `useLive2DIdleEyeFocus`）；④ 嘴型「说话接管 → 收尾 cross-fade handoff」（`motion-manager.ts` `useMotionUpdatePluginLipSync`） | `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts`、`stores/motion-control.ts`、`utils/eye-motions.ts`、`animation.ts` |

### 不借什么（显式排除）

- **不借 airi 对 pixi-live2d-display / Vue reactivity / `motionManager.state.currentGroup` 的强耦合**——本层**框架无关**，只认「一个能 get/set 参数的 model 句柄」+ capability 清单。
- **不借 `host.js` 旧的 Haru 默认参数名写死**（`ParamAngleX…ParamBreath` 那一段官方 Breath updater 配置）——那与「通用」目标冲突。改为：能力发现后按句柄绑定；绑定不到就**降级并写进 `director.degradation`（不静默）**。旧的官方 Breath/EyeBlink updater 在「导演启用后」已不下挂，避免两个写者抢同一参数名导致抽搐。
- **不借 airi 的 `Math.random()`**——本层所有随机性从 `seed` 派生（mulberry32），单测与取证脚本可复现。

### 哪一步无先例（本轮自研）

1. **单个「能力发现驱动 + 可注入 seed + 框架无关 + 降级明说 + write/speak 分工」的通用待机编排器**：airi 的同类逻辑散落在 pixi 插件链里、且写死 `Param*`；官方只有单点 effect（呼吸 XOR 眨眼 XOR 视线，按默认参数名）。
2. **write 通道 → 嘴闸门 + 动作压稳**：官方/airi 都没有「写字时把嘴锁死、把漂移压低」这一路（本仓 `text-rhythm-provider.js` 的 `WriteChannelProvider` 只管嘴恒 0，没管待机层的稳定性，故整合进本层）。
3. **呼吸只 additive 到 `bodyAngleX`、不抢官方 `ParamBreath` 名**：跨模型兼容决策（避免与任何模型自带 Breath 动作抢参数），非官方做法。

### 接入与降级（不静默）

- `host.load()` 默认构造 `new IdleDirector(host, capability, {…}, { seed })`；每帧在 `model.update()` 前调用 `director.apply()`，与官方 scheduler 同窗口。
- **能力发现后按可用参数/官方 updater 组合**：呼吸→`bodyAngleX`（additive）、视线→`eyeBallX/Y`+`bodyAngleX`（轻微）、眨眼→`eyeOpen`（绝对写、被 motion 门控）、嘴闸门→`lipSync` 参数（write 锁 0 + handoff）。
- **参数缺失明说降级**：如 `Groups.EyeBlink` 与命名风格回退都拿不到眨眼参数 → 记进 `director.degradation`（页面/探针可读到），跳过该分量，**不静默假装工作**。
- **write/speak 分工**：`host.setIdleMode('write')` → 嘴恒 0 + 呼吸/视线压稳；`'speak'` → 嘴交给 lipSync provider，待机照常。

### 验收（详见 §一之补·命令 ⑪/⑫）

- 静置 10s：bodyAngleX（呼吸+重心）有起伏且 range ∈ (0.05, 1.5)（生命感不过度漂移）；
- speak/write 分工：write 呼吸 range < speak，write 嘴恒 0；
- 嘴型闸门不退化：speak 且 provider 有输出时嘴随 provider 动（由 `text-rhythm-provider` 单测覆盖）。

---

## 一 · 命令速查（全部实测，逐条可复跑）

```bash
# 工作目录 = 仓库根（即本文件所在仓库的根目录）
HOST="clients/live2d-host"

# ① 能力发现表（只读 samples/Resources，只写自己的 evidence/）
#   ⚠️ 需先放置官方 Web Samples 到 $HOST/samples/Resources/（本仓库未分发）
node "$HOST/scripts/run-capability.mjs"
#   → evidence/capability_table.{md,json}
#   → 运行时段会打印 [warn]：哪些样本「表达式个数 = 0 → 相位→表情将不可用」

# ② 打包（samples/Resources → out/models；顺带 bundle + Core + shaders + demo）
#   ⚠️ 需先放置 vendor/CubismWebFramework 与 vendor/Core（本仓库未分发）
node "$HOST/scripts/build.mjs"

# ③ 起静态服务看画面
node "$HOST/scripts/serve.mjs" 4320     # → http://127.0.0.1:4320/

# ④ 渲染 + 嘴响应全矩阵（模型清单按 out/models/ 目录列举，不写死）
node "$HOST/tools/render-matrix.cjs"
#   → evidence/render_matrix.json ＋ evidence/matrix_<模型>_frame.png

# ⑤ 嘴参数隔离验证（冻结动画，只改参数；改回必须 0 像素差异）
node "$HOST/tools/mouth-iso.cjs" <模型名>
#   → evidence/mouthiso_<模型>.json 的 closedVsOpen.changedPixels（>0 = 真的驱动嘴）

# ⑥ 联系表（把全部首帧拼成一张，供人挑模型）
node "$HOST/tools/contact-sheet.cjs" --cell=320
#   → evidence/contact_sheet.png

# ⑦ 文字节奏数值取证
node "$HOST/scripts/run-rhythm.mjs" 1 60 0.25 60

# ⑧ 版本配对取证：本目录这套 Core 到底认不认这个 .moc3
node "$HOST/tools/moc-version-probe.cjs" [模型名 …]
#   → evidence/moc_version_probe.json ＋ stdout 表格
#   → 报 Core 的 csmGetVersion / csmGetLatestMocVersion，以及每个模型的 moc 版本与 hasMocConsistency

# ⑨ 🔴 「起 Idle 动作」回归探针（**改任何动作相关代码后必跑**）
node "$HOST/tools/idle-motion-probe.cjs" <模型名> [--frames=12] [--interval=700] [--json=…]
#   → 点「起 Idle 动作」前后各采样 N 帧画布，判「真的在动」（像素级）+ 四条报错通道全空
#   → 退出码：0=在动且零报错 / 1=冻住或有报错（回归失败）/ 2=装载失败判据不成立
#   ⚠️ 窗口必须长于该模型 Idle 的动作时长，否则测不到「播完→再起」这条路径

# ⑩ 崩溃根因取证三件（只在需要重查这条缺陷时跑）
node "$HOST/tools/idle-rootcause-evidence.cjs" <模型名> --ms=15000   # 时间轴：队列条目 / _motionData 是否被掏空
node "$HOST/tools/idle-failure-visibility.cjs" <模型名>              # 故障注入：起动作失败必须出声
node "$HOST/tools/idle-argorder-ablation.cjs" <模型名>               # 消融：在修后产物上重放旧写法，崩应复现

# ⑪ 🔴 待机编排层单测（零依赖，纯 Node，可复跑；先验验收）
node "$HOST/tests/idle-director.test.mjs"
#   → 10 项：seed 可复现 / 不绑 Haru 名 / 缺失降级 / 呼吸生命感 / 眨眼 / write·speak 分工 / 嘴闸门 / 压稳 / 视线

# ⑫ 🔴 真实 10 秒数值取证（验收证据生成器，★只在研究区跑，不进主仓）
#   依赖研究区 out/（官方 Core + 已 build bundle + 官方 Samples 模型）；产物落 /tmp，不进本仓。
#   先以研究区 framework 重打包主仓 src（见 §〇之补「不借什么」）：
RESEARCH="<研究区 live2d-host>"
OUT="$RESEARCH/out" node "$RESEARCH/scripts/build.mjs"   # 把主仓 src 打到研究区 out/live2d-host.bundle.mjs
OUT_DIR="$RESEARCH/out" IDLE_EVID="/tmp/idle-evidence" MODEL=Haru DUR=10000 SEED=42 \
  NODE_PATH="$(npm root -g)" node "$HOST/tools/idle-evidence-probe.cjs" --out=/tmp/idle-evidence
#   → /tmp/idle-evidence/：curve_<模型>_seed<seed>.csv（逐帧数值）+ summary_*.json（程序化判据）+ first/last/contact_sheet.png
#   判据：breathLife(speak 呼吸 range∈(0.05,1.5)) / stabilizeOk(write< speak) / writeMouthLocked(write 嘴恒0)
```

> 📌 **⑫ 不是主仓命令**：它需官方 Core 与官方 Samples 模型（研究区资产），主仓只含自研源码层。运行时把主仓 `src` 用研究区 `vendor/` 重新打包，再在 `OUT_DIR` 里跑；证据只写 `/tmp`。

🔴 **`tools/*.cjs` 必须在项目根执行**：playwright 装在项目根的 `node_modules`，Node 从脚本所在目录往上找。
🔴 **`serve.mjs` 起的是常驻进程**，收工时要关掉（它会吊住宿主）。

---

## 一之补 · 🔴 「起 Idle 动作」崩过一次：根因、修法、回归（2026-09-24，L2D-FIX-IDLE）

**病**：点「起 Idle 动作」→ 画面冻住，日志 `TypeError: Cannot read properties of null (reading 'duration')`。13 个模型全中；**其中 10 个不点按钮也会冻**（宿主自己会在动作播完时起下一个 Idle）。

**根因（一句话）**：宿主把自己**长期缓存**的动作对象交给了官方框架去"播完即删"。
`startMotionPriority()` 的官方签名是 `(motion, autoDelete, priority)`，宿主只传了两个参数 → `priority` 落进 `autoDelete` 槽（真值）→ 动作播完时框架 `entry.release()` → `ACubismMotion.delete()` → `CubismMotion.release()` → **`_motionData = null`**，缓存对象变空壳；下次再起它必崩。

**修法（三处，都在 `src/host.js`）**：
1. `startMotionPriority(motions[index], **false**, priority)` —— 对象生命周期归宿主，就明确告诉框架不许删；
2. 检查框架返回值（被拒绝时是 `-1`），不再无条件 `return true`；
3. 起 Idle 失败**必须出声**（`reportError()`：默认 `console.error`，也可由 `opts.onError` 接管；演示页接进页面日志）。
> **不是**吞错：没有加 `try/catch`、没有加 null 保护把崩溃换成静默不动——**让不该发生的释放不发生**，剩下的失败变成可见错误。

**回归判据**（改动作相关代码后照这个跑）：每个模型「点按钮后画布逐帧都在变（像素级）」＋「`pageerror`／`window.onerror`／`console.error`／日志 `[frame-error]` 四条通道全空」。13 个模型修前 13/13 崩、修后 13/13 通过；能力发现表逐字节不变；嘴部驱动 6 模型不变量全部成立。

**完整报告**（不在本仓库内，仅作出处引用）：`实现报告_L2D-FIX-IDLE_Idle崩溃_2026-09-24.md`（＋旁挂锚点表 `.anchors.md`）。

---

## 二 · 能力发现怎么读（三层回退 ＋ 相位表情）

`parseCapability(model3, { modelId, displayInfo })` 返回的关键字段：

| 字段 | 含义 |
|---|---|
| `lipSync.status` | `ok` / `ok-degraded` / `ok-unverified` / `fallback` / `unsupported-unverified` / `unsupported` |
| `lipSync.parameter` | **实际要写的嘴参数名**（上层必须读它，不许写死常量） |
| `lipSync.source` | `L1-模型自声明` / `L2-命名风格匹配` / `L2b-未验证` / `L3-不支持` |
| `expressions` / `expressionCount` | 表情数组（下标即面板 `PHASE_STATES` 用的下标） |
| **`parameters`** | 🔴 **逐参数直驱那条路的可写键清单**：`[{ id, name }]`（`name`＝cdi3 显示名，缺名回落成 id）；没有 cdi3 → `null`。**服务端引擎的表情通道读它**（`expressionCapabilityFor()` 先读 `parameters`、读不到才读 `parameterUniverse`）；旧的 `parameterUniverseCount` 只回**个数**、写不出任何一个值。嘴参数不在这里另做标记——`lipSync.parameters` 就是，引擎与面板在逐参数直驱时都会排除它们（一个参数两个写者＝叠加） |
| **`phaseExpression`** | 🔴 **「相位→表情」能不能用**——见下节 |
| `displayInfoParameterGroups` | cdi3 的参数语义分组（**第四层补充证据**，只有部分模型有） |

**嘴参数名不需要写死**：`Haru` / `Mao` / `Wanko` 三个样本的声明值分别是 `ParamMouthOpenY` / `ParamA` / `PARAM_MOUTH_OPEN_Y`，能力发现**全部判 `ok` 且取到各自声明的名字**。→ **换模型时嘴参数名不同不用改任何代码。**【实测】

🔴 **L2 回退是低置信**：`Mark` 命中 L2（`ParamMouthOpenY` 确实存在于它的参数全集里），但写值 0→1 **画面 0 像素变化**。→ **参数存在 ≠ 参数接在嘴的变形器上**；选模型必须跑一次「写值看画面」（命令 ⑤）。【实测】

---

## 三 · 🔴 「0 表情 = 相位→表情静默失效」这件事（本轮从静默改成有声）

### 3.1 事实（两个来源都要看）

**面板侧（不是我改的，只读引用）**：`code/clients/classroom-ui/lib/client.js`
- `PHASE_STATES` 的 6 个相位**按下标取表情**（`open:0 / probe:1 / answer:2 / check:3 / review:4 / close:5`）【源码】
- `applyPhase()` 里逐字有一句 `if (expressions.length === 0) return;` —— **静默什么都不做，不报错、不提示**【源码】

**宿主侧（本轮新增）**：`src/capability.js` 现在返回 `phaseExpression` 字段：

```js
phaseExpression: {
  available: false,            // 表情数 > 0
  expressionCount: 0,
  expressionNames: [],
  status: 'unavailable',       // 'ok' (≥6) | 'partial' (1–5) | 'unavailable' (0)
  detail: '表达式个数 = 0（相位→表情将不可用）：面板的 applyPhase 在 expressions.length === 0 时直接 return，' +
          '6 个相位（open/probe/answer/check/review/close）都不会换表情，且**不报错、不提示** —— 属静默失效。'
}
```

**运行时段也会出声**（不能只写在 JSON 里）：
- `scripts/run-capability.mjs` 末尾打印 `[warn] N 个样本的表达式个数 = 0 → **相位→表情将不可用（静默失效）**：…`；表情数不足 6 的另打印 `[note]`（取模回绕）
- `demo/demo.html` 装载时把 `相位到表情` 放进能力面板，并往日志写 `[warn]` / `[note]`

**判据（`evidence/capability_table.md` 有一整节 + 汇总表）**：

| `phaseExpression.status` | 含义 | 处置 |
|---|---|---|
| `ok`（≥6 个表情） | 6 个相位都能各取到一个表情 | 直接用 |
| `partial`（1–5 个） | 下标取模回绕 → 多个相位同一张脸 | 可用，但"每相位一表情"做不到 |
| **`unavailable`（0 个）** | 🔴 **相位→表情静默失效** | 见下方接线说明，或改用有表情的模型 |

### 3.2 🔴 面板接线说明（**给改 `classroom-ui` 那一路；本树没有改它，也不许改**）

> ⚠️ **行号不写在正文里**：本节引用的源码位置一律用锚点（`〔A01〕`…）指向
> **旁挂行锚表** `clients/live2d-host/README.anchors.md` —— 行号、以及「引的是哪个版本（sha256 前 16 位）」都记在那张表里。
> 🔴 **该文件（`classroom-ui/lib/client.js`）正在被另一路改皮肤**，行号会漂 → **改之前先按引用的代码原文重新定位**，别按行号硬改。
> 📌 **本节三处「改动点」在 2026-09-24 14:03 核实时已经落进代码**（`applyPhase` 已改成记一次去重标志、`readout()` 已带
> `phaseExpression`、状态行已有常显提示）—— 本节保留作为**判据与理由的说明**；若你是在"换模型"场景下读它，
> 看判据即可，不必再改一遍代码。核实依据 = 行锚表 `〔A01〕`／`〔A02〕`／`〔A04〕`。

**改动点 1 —— 让静默失效出声（必需，3 行内）**

定位（`applyPhase` 开头，见 `〔A01〕`）：

```js
applyPhase(state) {
  if (state.expressionIndex === null) return;
  const expressions = capability.expressions;
  if (expressions.length === 0) return;          // ← 🔴 就是这一句静默吞掉了
  const picked = expressions[state.expressionIndex % expressions.length];
  ...
```

改成（把"不做事"变成"报出来一次"）：

```js
applyPhase(state) {
  if (state.expressionIndex === null) return;
  const expressions = capability.expressions;
  if (expressions.length === 0) {
    // 不静默：相位→表情这条路在本模型上不可用，报出来（同一模型只报一次）
    if (expressionUnavailableReported !== true) {
      expressionUnavailableReported = true;
      reportPhaseExpressionUnavailable(capability);   // ← 见改动点 2 的显示方式
    }
    return;
  }
  ...
```

**改动点 2 —— 报到哪里（两种显示方式，二选一）**

**方式 A（最小）**：读宿主给的 `phaseExpression.detail`，直接贴进面板既有的状态行。
定位（状态行的表情读数拼接，见 `〔A05〕`）：

```js
+ " · 表情 " + (readout.expression === null ? "—" : readout.expression) + "/" + String(readout.expressions)
```

改为（**用 `S.note` 风格另起一行，不改既有读数格式**）：

```js
+ " · 表情 " + (readout.expression === null ? "—" : readout.expression) + "/" + String(readout.expressions)
+ (readout.expressions === 0 ? "（0 个 → 相位不改表情）" : "")
```

**方式 B（更响）**：在状态行下面加一条 note 行，把原因写全（照既有 `frameErrors` 那条的写法）：

```js
readout !== null && readout.expressions === 0
  ? React.createElement("div", { style: S.note },
      "相位→表情不可用：本模型表达式个数 = 0，applyPhase 不会换表情（原因与处置见 live2d-host/README.md §三）")
  : null,
```

**改动点 3（可选，但推荐）—— 让 `readout()` 多带一个判据**

定位（`readout()` 的返回对象里，见 `〔A04〕`）：

```js
expressions: capability.expressions.length,
```

旁边加一行（数据来自宿主能力发现，不是面板自己猜）：

```js
phaseExpression: capability.phaseExpression === undefined ? null : capability.phaseExpression,
```

> 📌 `capability` 就是宿主 `parseCapability()` 的返回值原样透传（面板已经这么用），所以 `phaseExpression` **不用改面板的解析逻辑就能拿到**。
> 🔴 **判据不要写成"表情数 = 0 就报错"以外的东西**：表情数 1–5 是"可用但回绕"（`partial`），**不要一起报成失效**。

---

## 四 · 🔴 换一个立绘 / 换一位老师，要跟着改哪些文件（**9 条**）

> **来源**：`研究_立绘素材来源与接入_2026-09-24.md` §3.2.2 的表（不在本仓库内，仅作出处引用）。
> 🔴 **那张表是从源码读出来的依赖，在此之前没有第二处维护点**——不写下来，换人时必漏。现在它是本 README 的一部分。
> 每条后面的 `依据` 是可核对的源码位置；`【推断】` 标出的是"没人写下来、靠核对"的条目。

假设场景：把"小鞠知花"换成另一个角色，**且立绘也跟着换**。

| # | 要改的文件 | 改什么 | 依据 |
|---|---|---|---|
| 1 | `code/classrooms/<教室>/characters/<新角色>.md` | **新建**人格文件（格式照 `characters/komari.md`）。`komari.md` 自己写着这是设计好的替换机制：*"提供**替换角色机制**（换掉本文件即可换老师，教学法不受影响）"* | `〔A10〕`【源码】 |
| 2 | `code/classrooms/<教室>/classroom.yaml` 的 `blocks[]` 里那条 `path: characters/komari.md` | 改成新人格文件路径 | `〔A07〕`【源码】 |
| 3 | `classroom.yaml` 的 `classroom.license` | 注释里写明它依据的是"`characters/<新角色>.md` 按项目契约（内容 CC BY-NC-SA）发布" | `〔A08〕`【源码】 |
| 4 | `code/classrooms/<教室>/runtime/progress.md` 的「当课老师」 | 改成新角色名（**面板读它显示**） | 面板 `tableValue(text, "当课老师")`【源码】 |
| 5 | `code/classrooms/<教室>/_anchor.md` 的「角色声音速查」段 | 换角色声音要点（它被当**常驻系统段**注入） | `〔A09〕`【源码】 |
| 6 | 立绘资源目录 | `<live2dRoot>/models/<新模型名>/`，且**目录名必须 = `<新模型名>.model3.json` 的文件名基名** | `〔A06〕`【源码】＋§五【实测】 |
| 7 | `globalThis.__DSH_CLASSROOM_UI_CONFIG__.model` | 改成新模型名（**面板走配置，不走 demo 的 MODELS 数组**） | `〔A06〕`【源码】＋ 面板 README §4.5.5 |
| 8 | 面板 `PHASE_STATES` 的 6 个 `expressionIndex` | **重标**（新模型的表情**个数与语义都变了**；`F01…` / `exp_01…` / `Angry,Sad,Smile…` 各不相同） | `〔A03〕`【源码】 |
| 9 | 绑定字段（"角色 ↔ 立绘"） | **目前不存在**——`cast.roles[]` 的 `CAST_ROLE_KEYS` 里**没有**"立绘/模型"这一项；要"一处改、处处对"就得新加一个落点 | §六【源码】 |

**三条容易被漏掉的**（单独点出来）：

- 🔴 **第 4、5 条是"从源码读出来的依赖"，不是有人写下来的清单**【推断】——换人时会不会漏，**只取决于有没有人照着这张表核**。
- 🔴 **第 8 条不是可选项**：换模型后**一定要重标**。判据用 §三 的 `phaseExpression`：`unavailable` 的模型**标了也没用**（改表情这条路根本不通），`partial` 的模型**标了也会回绕**。
- 🔴 **第 7 条与第 6 条是两件事**：模型放进 `models/` 是"资源到位"，`__DSH_CLASSROOM_UI_CONFIG__.model` 改名才是"面板用上它"。

---

## 五 · 立绘资源的两条命名硬约束（试装时踩过）

```js
// 面板 lib/client.js 逐字（定位见行锚表 〔A06〕）：
const modelDir = "models/" + modelName() + "/";
const modelFile = modelName() + ".model3.json";
```

→ ① 目录必须是 `<live2dRoot>/models/<模型名>/`；② 文件名必须是 `<模型名>.model3.json`；**两者基名必须完全一致**。

**试装实测（L2D-TRY，2026-09-24）**：用官方样本 `Hiyori` 造一个叫 `Teacher` 的试装件 ——
只做「目录改名 ＋ `Hiyori.model3.json` → `Teacher.model3.json`」，**没有改 json 内容**：

```
FileReferences.Moc = Hiyori.moc3
FileReferences.Textures = ["Hiyori.2048/texture_00.png", …]
```

`model3.json` 里的相对路径**全部是相对模型目录**的 → **改目录名不影响，不用改 json 内容**。【实测：被引用的 16 个文件逐个 `existsSync` 全为 true】

🔴 **缺任何一个被引用的文件 → 整块失败**（面板 `lib/client.js` 逐字注释：*"单个文件失败**整块失败**（立绘缺一块资源就画不出来，这里不能静默降级）"*）。这是**有意的**：不许"画一半"。

---

## 六 · 「角色 ↔ 立绘」绑定字段：现状与候选落点（**未定，须用户裁决**）

**现状**【源码】：**人格**与**立绘**是两个互不相干的操作，**没有任何一处写着"小鞠知花＝这张立绘"**。

| 东西 | 现在存在哪 | 换它要改什么 |
|---|---|---|
| **人格**（老师是谁） | `classrooms/<教室>/characters/komari.md`，由 `classroom.yaml` 的 `blocks[]` 注入 | 换文件内容 |
| **立绘**（长什么样） | 面板配置的 `live2dRoot` ＋ `model` | 改配置里 `model` 一个字段 |
| **两者的绑定** | 🔴 **不存在** | —— |

**三个候选落点**（`研究_立绘素材来源与接入.md` §3.2.1 列出，不在本仓库内，仅作出处引用；**本轮不替用户选**）：

| 落点 | 怎么加 | 代价 |
|---|---|---|
| ① `cast.roles[]` 加一个键（如 `portrait:`） | 改引擎的 `CAST_ROLE_KEYS` ＋ `normalizeCastRole()`（**自带白名单，多写一个键会报错**），再让面板读它 | 动**引擎** ＋ 动**面板** ＝ 两处；**能校验、写错就报错** |
| ② `classroom.yaml` 加顶层段（如 `portrait:`） | `parseManifest` **对顶层键没有白名单**（其余**静默忽略**）→ 引擎不报错也不消费 | 只动**面板** ＝ 一处；代价是引擎侧看不见这个字段 |
| ③ 不动 manifest，只用面板配置（现状） | 把 `model` 与人格名一起写进 `__DSH_CLASSROOM_UI_CONFIG__` | 零改动；代价是绑定只活在页面配置里，**换会话/换机器就丢** |

> 📌 **【推断】** 要"一处改、处处对"→ ② 改动面最小；要"引擎能校验、写错就报错"→ ① 最符合本项目"不许静默失效"的纪律。

---

## 七 · 未做到 / 已知边界

| # | 项 | 状态 |
|---|---|---|
| 1 | `motion3.json` 曲线解析 | **未做**（明确不做）→ 能力发现只给动作组名与数量，**给不出"这个动作长什么样"** |
| 2 | `Mark` 的 L2 回退为何不驱动嘴 | **只取到现象，未定位根因**（需读 moc3 内部结构） |
| 3 | 6 个相位"该用哪个表情"的语义标定 | **未做**——本目录只报**有几个表情**，不替用户标"哪个相位该是哪张脸"（换人清单第 8 条） |
| 4 | 静态立绘（PNG 差分）接入 | **不支持**——本宿主只吃 Live2D `.moc3` |
| 5 | 多模型同时渲染 / 性能 | **未测** |
| 6 | 无障碍（reduced-motion / 替代文本） | **未处理** |
| 7 | `miku_free` 与 `miku_sample_t04` 的资源**没进树**（只在 `/tmp`，见 §九.2） | **待用户定**：留 = 两个 `runtime/` 合计 **8.7MB** 进树（原包 43.7MB 的其余部分是编辑源，不需要）；不留 = 重启后试装件消失 |
| 8 | BanG Dream! 模型**没有做转换尝试** | **不做**（官方明文：`.moc`/`.mtn` 本身不可转换，见 §十.3） |
| 9 | `miku` 的「相位→表情」替代方案（改用参数级表情） | **未做**——只报「17 个脸部参数在」，不替用户设计 |

---

## 八 · 试装结果速查（L2D-TRY ＋ L2D-TRY-2）

### 8.1 L2D-TRY（2026-09-24，官方 Web Samples 那批）

| 模型 | 渲染 | 嘴响应(写0→1) | 表情数 | 相位→表情 | 能不能直接当占位 |
|---|---|---|---|---|---|
| Haru | ✅ | 163 px | 8 | `ok` | ✅ **能** |
| Hiyori | ✅ | 60 px | 0 | `unavailable` | ⚠️ 能用但**相位不改表情**（静默） |
| Mao | ✅ | 291 px | 8 | `ok` | ✅ **能** |
| Mark | ✅ | **0 px** | 0 | `unavailable` | ❌ **必须改代码**（嘴 ＋ 表情双失效） |
| Natori | ✅ | 64 px | 11 | `ok` | ✅ **能** |
| Ren | ✅ | 95 px | 5 | `partial` | ⚠️ 能用但**多相位同一张脸** |
| Rice | ✅ | **0 px** | 0 | `unavailable` | ❌ **必须改代码**（模型不支持嘴型） |
| Teacher（试装件） | ✅ | 88 px | 0 | `unavailable` | ⚠️ 能用但**相位不改表情**（静默） |
| Wanko | ✅ | 1153 px | 0 | `unavailable` | ⚠️ 能用但**相位不改表情**（静默）；是**狗**不是人 |

> 📌 **本表的嘴响应像素数是 L2D-TRY 那一轮的记录**。`render-matrix.cjs` **不冻结动画**（它只画两帧比差），所以数值**逐轮有浮动**：2026-09-24 L2D-TRY-2 复跑同一批得到 Haru 161／Hiyori 74／Natori 64／Ren 99／Teacher 64／Wanko 1177。→ **判定"嘴动不动"要看数量级（0 还是几十上百），不要拿个位数差当结论**；要严格可比的数字用 `mouth-iso.cjs`（冻结动画，写回必须 0 像素差）。

### 8.2 L2D-TRY-2 新增（官方初音ミク，2026-09-24，详见 §九）

| 模型 | 渲染 | 嘴响应(写0→1) | 表情数 | 相位→表情 | 能不能直接当占位 |
|---|---|---|---|---|---|
| miku（官方 FREE 版） | ✅ | 125 px（冻结隔离 120 px，写回差 0） | 0 | `unavailable` | ⚠️ 能用但**相位不改表情**（静默）；嘴参数 `PARAM_MOUTH_OPEN_Y`（L1 自声明） |
| miku_sample_t04（官方 PRO 版） | ✅ | 126 px（冻结隔离 117 px，写回差 0） | 0 | `unavailable` | ⚠️ 同上；嘴参数 `ParamMouthOpenY`（L1 自声明） |

> 🔴 **BanG Dream! 不在这张表里**：它是 Cubism 2.1 的 `.moc`/`.mtn`，**不是 `.moc3`**，本宿主吃不下 —— 见 §十。

### 8.3 分档（详见 §十一）

🟩 `Haru` / `Mao` / `Natori`（嘴＋表情两条都通）｜🟨 `Hiyori` / `Teacher` / `Wanko` / **`miku`** / **`miku_sample_t04`**（相位→表情静默失效）｜🟨 `Ren`（多相位同一张脸）｜🟥 `Mark` / `Rice`（必须改代码）｜🟥 **BanG Dream! 全部**（格式不对）

联系表 `evidence/contact_sheet.png`（**11 格**，`tools/contact-sheet.cjs --cell=320` 生成，没有手拼图）。完整对照表见
`实现报告_L2D-TRY_候选立绘试装_2026-09-24.md` 与
`实现报告_L2D-TRY2_官方Miku与格式兼容_2026-09-24.md`（两份报告均不在本仓库内，仅作出处引用）。

---

## 九 · 官方初音ミク 试装（L2D-TRY-2，2026-09-24）

### 9.1 它从哪来、是什么

| 项 | 事实 | 来源 |
|---|---|---|
| 下载入口 | `https://cubism.live2d.com/sample-data/bin/miku/miku_ja.zip` | 官方样本数据页 `https://www.live2d.com/download/sample-data/` 列有「初音ミク」 |【实测】 |
| 实测下载 | HTTP 200 ／ `application/zip` ／ **43,689,423 字节** ／ 文件头 `PK` | 【实测】 |
| 解包后 | `miku_free/`（编辑源 `miku_t01.cmo3`＋`miku_t01.can3`，运行时 `runtime/`）与 `miku_pro/`（编辑源 `miku_sample_t05.cmo3`＋`miku_sample_t02.can3`，运行时 `runtime/`） | 【实测】 |
| 我们装的是 | 两个 `runtime/`：`miku`（FREE，`miku.moc3`）与 `miku_sample_t04`（PRO，`miku_sample_t04.moc3`） | 【实测】 |
| 命名硬约束 | 上游自带名就满足：目录 `miku/` ↔ `miku.model3.json`、目录 `miku_sample_t04/` ↔ `miku_sample_t04.model3.json` —— **不需要改名、不需要改 json 内容** | 【实测】 |

### 9.2 🔴 它落在哪（**没进树**）

```
/tmp/l2d-try2/miku_ja.zip                     43,689,423 B（原包）
/tmp/l2d-try2/extract/miku_free/runtime/      ← samples/Resources/miku 指向这里
/tmp/l2d-try2/extract/miku_pro/runtime/       ← samples/Resources/miku_sample_t04 指向这里
```

`samples/Resources/{miku,miku_sample_t04}` 是**符号链接**，不是拷贝 —— 所以本树体积**没变**（`samples/` 仍 28M，与试装前一致）。【实测】
`build.mjs` 用 `cpSync(..., { recursive: true })`，**默认不 dereference** → `out/models/` 里也是符号链接，服务与截图脚本照常读得到。【实测】
🔴 **代价**：`/tmp` 被清（重启）后这两个链接失效，`build` 会报错。**要不要把模型正式收进树由用户定**（见 §七 第 7 条）。
📌 **体积实测**：两个 `runtime/` **合计只有 8.7MB**（`miku_free/runtime` 4.3M、`miku_pro/runtime` 4.4M；贴图各 4.0M、`.moc3` 204K／284K）。**原包 43.7MB 的绝大部分是编辑源**（`miku_t01.cmo3` 17,042,245 B ＋ `miku_sample_t05.cmo3` 18,155,959 B ＝ 35MB），而**编辑源我们不需要** → 进树代价其实很小。【实测】

### 9.3 六个问题的答案（全部实测）

| # | 问题 | 答案 | 数字 |
|---|---|---|---|
| 1 | 能不能渲染 | ✅ **能**，页面无任何 `pageerror` | `miku` 首帧非白像素 **148,067 / 518,400 = 28.56%**，量化色 **2,162** 种；`miku_sample_t04` = **26.28%** / 2,069 种 |
| 2 | 嘴参数 | ✅ **L1-模型自声明**（`Groups.LipSync`），status `ok` | `miku` = **`PARAM_MOUTH_OPEN_Y`**；`miku_sample_t04` = **`ParamMouthOpenY`**（同一模型两版名字不同 → 又一次证明**嘴参数名不许写死**）。冻结动画后写 0→1：**miku 变 120 像素**（bbox 17×12 @ y=113–124，均值差 49.32，最大差 140）；**pro 变 117 像素**；**写回 0 后与 closed 逐像素差 = 0**（可逆、无漂移） |
| 3 | 表情个数 | 🔴 **0 个**（两个版本都没有 `FileReferences.Expressions`，`cdi3.json` 里也没有 `Expressions` 段）→ 面板「相位→表情」判 `unavailable`（6 个相位全部静默失效） | 但**脸部参数在**：两版各 **17 个**脸部参数（眼 6：`*EYE_L/R_OPEN`、`*EYE_L/R_SMILE`、`*EYE_BALL_X/Y`；眉 8；口 2：`*MOUTH_OPEN_Y`、`*MOUTH_FORM`；颊 1：`*CHEEK`）＋头部朝向 3 个。→ **「AI 控表情」只剩"逐参数写值"这一条路**，面板现成的表情机制用不上 |
| 4 | 动作组 | **4 组 / 共 8 个动作**（无音频） | `miku`：`Tap`3 `Flick`3 `Flick3`1 `Idle`1；`miku_sample_t04`：`Idle`3 `Tap`2 `Flick`2 `FlickUp`1 |
| 5 | 版本配对 | ✅ **是 `.moc3`**，被本目录这套 Core **成功载入** | 文件头 `4d 4f 43 33`（`MOC3`）＋版本字节 **3**；Core 自报 `csmGetMocVersion` = **3 = `MocVersion_40`**（Cubism 4.0 代），与文件头一致；`hasMocConsistency` = **true**；本 Core `csmGetVersion()` = **100663297**（`0x06000001`）、`csmGetLatestMocVersion` = **6**（`MocVersion_53`）→ **3 ≤ 6，吃得下**；`Moc.fromArrayBuffer` 成功、**无报错**。**没有崩在 `csmGetMocVersion`** |
| 6 | 一句人话 | ⚠️ **能当占位，但"当老师"只有一半** | 渲染与嘴型都干净（嘴参数还是模型自声明的 L1），**但 0 个表情 = 面板 6 个相位不会换脸**；而"AI 自由控制表情"这条靠它**做不到**（只能逐参数写眉眼口颊）。→ **当"会说话的占位立绘"合适；当"有表情反应的老师"要先接线或换有表情的模型**（README §三 的接线说明） |

> 📌 **两版怎么选**【推断】：`miku`（FREE）参数少（30）但脸部参数齐、嘴参数名是大写；`miku_sample_t04`（PRO）参数多（59，含 9 个分组标题）且带 `Skinnning` 骨骼组。**从"当教室占位"看两版等价**（表情都是 0、嘴都能动）；PRO 的 59 个参数里有 32 个是头发/身体的旋转骨，对"表情"没帮助。

### 9.4 复现命令（照抄可跑）

```bash
HOST="clients/live2d-host"
# ⚠️ 下列命令依赖 vendor/ 与 samples/（本仓库未分发），缺失时属预期阻塞
node "$HOST/scripts/build.mjs"                       # 打包（含两个 miku 目录）
node "$HOST/scripts/run-capability.mjs"              # 能力发现（末行会 warn 0 表情）
node "$HOST/tools/moc-version-probe.cjs"             # 版本配对表
node "$HOST/tools/render-matrix.cjs"                 # 全矩阵（含 miku 两行）
node "$HOST/tools/mouth-iso.cjs" miku                # 嘴参数隔离
node "$HOST/scripts/crop-mouth-region.mjs" miku      # 裁嘴放大（目视）
node "$HOST/tools/contact-sheet.cjs" --cell=320      # 联系表
```

---

## 十 · BanG Dream! 的格式结论（L2D-TRY-2，2026-09-24）

### 10.1 结论（一句话）

🔴 **两个候选仓库里的 BanG Dream! 模型都是 Cubism 2.1 的 `.moc`（＋`.mtn`），不是 `.moc3`** → **我们的宿主（官方 Cubism R5 框架 ＋ Core 6.0.1）直接用不了**。

### 10.2 实测证据（目录页抽样 ＋ 直接下文件看头）

**仓库 A：`haneoka-gakuen/bangdream-live2d`（分支 `live2d`，路径 `live2d/chara`，`totalCount = 3640`）**

| 抽样方式 | 样本 | 结果 |
|---|---|---|
| 均匀抽样 18 个角色目录 | 000/001…010 系列 | **17 个含 1 个 `.moc`**、1 个（`000_general_rip`）只有 `texture_00.png`；扩展名总计 **`.moc`×17、`.mtn`×152、`.asset`×17、`.bundle`×17、`.json`×17、`.png`×24，`.moc3`×0** |
| 补抽最新（2024/2025）3 个 | `001_2024_furisode_rip`、`004_2025_furisode_rip`、`009_2025_furisode_rip` | 每个仍是 **1 个 `.moc` ＋ 大量 `.mtn`**（例：`kasumi_2024newyear.moc`） |
| 直接下一个模型看文件头 | `.../chara/001_casual_rip/kasumi.moc`（632,714 B） | 文件头 **`6d 6f 63` = `moc`**（**不是** `MOC3`）；同目录 `kasumi.physics.json` = `{"type":"Live2D Physics","physics_hair":[…]}` ← **Cubism 2.1 的物理 schema**（Cubism 3 是 `physics3.json`） |

**仓库 B：`Eikanya/Live2d-model`（路径 `BanG Dream!/`，下分 `startapp/live2d/chara` 与 `asneeded/live2d/chara`，各 36 个角色目录）**

| 抽样方式 | 样本 | 结果 |
|---|---|---|
| `startapp` 抽 8 角色 × 2 形态 = 16 个叶子目录 | 001/002/003/005/010/025/034/035 | 扩展名总计 **`.moc`×14、`.physics`（无扩展名）×13、`.1024`（贴图目录）×14、`.png`×2，`.moc3`×0**；缺的 2 个是只有 `motions`/`exppressions` 的目录 |
| `asneeded` 抽 3 个叶子目录 | `001_live_default`、`001_cafe`、`001_girlparty2019` | 每个都是 **1 个 `.moc` ＋ 1 个 `.physics`（无扩展名）＋ `.1024` 贴图目录** |

**两条共同的形态特征**（都指向 Cubism 2.1，不是 Cubism 3）：贴图是**目录**（`kasumi.1024/`，Cubism 3 是 `model.2048/texture_00.png`）；动作是 **`.mtn`**（Cubism 3 是 `.motion3.json`）；表情是 **`.exp.json`**（Cubism 3 是 `.exp3.json`）；物理是 **`.physics.json` / `.physics`**（Cubism 3 是 `.physics3.json`）；**没有 `.model3.json`**。【实测】

### 10.3 官方怎么说的（**只给链接与事实，不解读条款**）

| 官方页 | 该页写了什么（逐字） |
|---|---|
| [Cubism 2.1 のモデルやモーションファイルは新しいバージョンのCubism SDKで使えますか？（Live2D ヘルプ）](https://help.live2d.com/cubismsdk/migrate-from-cubism2-to-newer-cubismsdk/) | 「**Cubism 3 SDK以降のバージョンでは、Cubism 2.1の組み込み用データ形式である.mocや.mtnなどをそのままの状態で使うことはできません。**」（Cubism 3 SDK 及以后**不能原样使用** Cubism 2.1 的嵌入用数据格式 `.moc`／`.mtn`） |
| [Convert Data From Up to Cubism 2.1 to Cubism 3 or Later Format（Cubism Editor Manual）](https://docs.live2d.com/en/cubism-editor-manual/convert-data-cubism-2-to-3/) | 「…you will need Cubism 2.1 editing format files (.cmox, .canx). **Files in formats for embedded use (.moc, .mtn) cannot be converted.**」（要转换需要 Cubism 2.1 的**编辑格式**文件 `.cmox`／`.canx`；**嵌入用格式 `.moc`／`.mtn` 本身无法被转换**） |
| [File Types and Extensions（Cubism Editor Manual）](https://docs.live2d.com/en/cubism-editor-manual/file-type-and-extension/) | 「`.motion3.json`: **The [.mtn] in Cubism 2.1 has been changed to [.motion3.json]. (extension change)**」 |
| [Native Core API Reference（官方 PDF）](https://cubism.live2d.com/sdk-doc/reference/NativeCoreAPIReference_en_r12.pdf) | moc3 文件版本枚举：`… csmMocVersion_40 = 3 …`（即**文件头那个版本字节就是枚举值**，本目录 §九.3 第 5 问的对照依据） |

### 10.4 所以「要用它得先做什么」【推断，依据上面第 2 行】

- 🔴 **不是"换个运行层就行"**：官方明文 `.moc`/`.mtn` **本身不可转换** → 手上这些 rip 出来的运行时数据**没有可用的转换入口**。
- 要真用，路径只剩：① 找到对应的 **Cubism 2.1 编辑源**（`.cmox`/`.canx`）→ 用 Cubism Editor 转成 `.cmo3`/`.can3` → 再导出 `.moc3`；或 ② **另起一个能吃 Cubism 2.1 的运行层**（与我们现在这套官方 R5 框架 ＋ Core 6.0.1 是两套东西）。
- ⚠️ 上面两条都是**形态事实的推论，不含任何许可判断**；是否值得做、能不能做，**由用户定**。

### 10.5 复现命令

```bash
# 只读网页，不 clone（GitHub API 在本机被限流 403，改走 tree 页内嵌 JSON）
curl -sS -L 'https://github.com/haneoka-gakuen/bangdream-live2d/tree/live2d/live2d/chara/001_casual_rip' \
  | grep -o 'react-app.embeddedData'
# 或直接下一个模型看头（本次只下了 1 个）
curl -sS -L -o /tmp/kasumi.moc 'https://raw.githubusercontent.com/haneoka-gakuen/bangdream-live2d/live2d/live2d/chara/001_casual_rip/kasumi.moc'
xxd -l 8 /tmp/kasumi.moc      # → 6d6f 630b  = "moc"，不是 "MOC3"
```

> 📌 **本仓库里没有 BanG Dream! 的模型文件**（`samples/Resources/` 下无新增）—— 只做了只读核查，**没批量下载**。

---

## 十一 · 分档结论（给用户挑用）

| 档 | 模型 | 说明 |
|---|---|---|
| 🟩 **能直接当占位** | `Haru`（嘴 161px／8 表情／`ok`）、`Mao`（289px／8／`ok`）、`Natori`（64px／11／`ok`） | 嘴 ＋ 相位表情**两条都通** |
| 🟩 **能直接当占位（新）** | **`miku`（嘴 120px／0 表情）、`miku_sample_t04`（117px／0 表情）** | 渲染与嘴型干净、无报错；**但表情 0 → 相位不改表情**，见下行说明 |
| 🟨 能用但**相位→表情静默失效** | `Hiyori`、`Teacher`、`Wanko`、**`miku`**、**`miku_sample_t04`** | 静默失效的那一项 = **面板 6 个相位（open/probe/answer/check/review/close）都不会换表情，且不报错**（`applyPhase` 里 `if (expressions.length === 0) return;`）。`run-capability.mjs` 与 `demo.html` 已会出声 |
| 🟨 能用但**多相位同一张脸** | `Ren`（5 个表情 → 下标取模回绕） | 每相位一表情做不到 |
| 🟥 **用不了** | `Mark`（嘴 0px ＋ 表情 0）、`Rice`（模型不支持嘴） | 两条路都断，**必须改代码** |
| 🟥 **用不了（格式不对，新）** | **BanG Dream! 全部**（`haneoka-gakuen/bangdream-live2d` 与 `Eikanya/Live2d-model` 的 BanG Dream! 目录） | Cubism 2.1 `.moc`/`.mtn`，**不是 `.moc3`** → 我们这套框架 ＋ Core **吃不下**；官方明文该类格式**不可直接使用、且本身不可转换**（§十.3）。**为什么**：本宿主只吃 `.moc3`（§七 第 4 条） |

### 🔴 「有名有姓」里最干净的一条

**官方初音ミク = 目前"有名有姓"的立绘里最干净的一条。** 依据（三条都是可核的）：

1. **来源是官方下载页**：`https://www.live2d.com/download/sample-data/` 上列有「初音ミク」，包从官方域名 `cubism.live2d.com` 取（HTTP 200／43,689,423 B／PK）—— **不需要从游戏里 rip**；
2. **现成的 `.moc3`**：包里 `runtime/` 直接给 `.moc3`＋`.model3.json`＋`physics3.json`＋`cdi3.json`＋贴图＋8 个动作，**开箱即装**（§9.1），且**被本目录 Core 6.0.1 成功载入**（§9.3 第 5 问）；
3. **嘴型是模型自声明的 L1**（不是命名回退的猜测），写值看画面**真的动**且可逆（§9.3 第 2 问）。

> ⚠️ 与之相对：BanG Dream! 那条**连格式都不对**（§十），而其余官方样本是"无名氏"（Haru／Hiyori／Mao…）。

### 联系表

`evidence/contact_sheet.png` —— **11 格**（新增 `miku`／`miku_sample_t04` 两格），**用 `tools/contact-sheet.cjs --cell=320` 生成，没有手拼图**。每格右下角状态：`READY` / `NO FACE`（0 表情）/ `CODE FIX`。

---

## 十二 · 风险提示（至多三行，判定留用户）

1. 官方 Miku 包内 `ReadMe.txt` 指向两份文件：『無償提供マテリアルの使用許諾契約書』（`https://www.live2d.jp/terms/live2d-free-material-license-agreement/`）与『Live2D Cubism サンプルモデル利用条件』（ReadMe 里给的 Google Docs 链接）；官方样本数据页另指向『Live2D Cubism サンプルデータ利用条件』。
2. BanG Dream! 两个仓库的 README 各自写了「与 BanG Dream! Project／Bushiroad 无关联」「来自 Bestdori」——**原文措辞在此，含义不解读**。
3. 以上仅列**出处与"该页有没有写使用条件"**；**能不能用、怎么用，由用户自行研究决定**。

