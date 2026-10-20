# 实现报告 · L2D-FIX-IDLE —— 修「起 Idle 动作就冻住」

> 任务代号 **L2D-FIX-IDLE**；工作目录 `开源线/DSH定制/`；改动面**只有** `code/clients/live2d-host/**` 这一棵树。
> 报告口径：正文引用源码位置一律写锚点 `〔Axx〕`，行号在旁挂文件 `实现报告_L2D-FIX-IDLE_Idle崩溃_2026-09-24.anchors.md`。
> 机核命令（工作区根）：
> ```
> /opt/homebrew/bin/node 开源线/DSH定制/code/tools/anchors/check-anchors.mjs \
>   开源线/DSH定制/实现报告_L2D-FIX-IDLE_Idle崩溃_2026-09-24.md --list
> ```

---

## 〇 · 一句话结论

**缺陷复现成立（13/13 模型）、根因钉死、修在宿主层、修后 13/13 全部通过。**

- **根因一句话**：宿主把自己**长期缓存**的动作对象（`load()` 时一次性装载、之后反复复用）交给了官方框架去"播完即删"——`startMotionPriority()` 官方签名是 `(motion, autoDelete, priority)`〔A15〕，而宿主只传了两个参数，于是 `priority` 落进了 `autoDelete` 槽（真值）。动作一播完，框架就把宿主的缓存对象**掏空**（`_motionData = null`〔A19〕），下次再起它必崩。
- **不是** `isFinished()` 语义错、**不是** motion 队列空、**也不是** `motions[index]` 为 `null`——是**对象还在、里面被掏空了**。详见 §二。
- **比转述更严重一点**：这条不只挡「点按钮」。**不点按钮也会崩**——13 个模型里有 **10 个在点按钮之前就已经冻住**（宿主自己会在动作播完时起下一个 Idle，那条路同样踩雷）。详见 §1.4。
- **修后**：13/13 模型点按钮后画布**逐帧都在变**、零 `pageerror`／零 `window.onerror`／零 `[frame-error]`；能力发现表**逐字节不变**；嘴部驱动 6 模型全部通过。

---

## 一 · 我自己复现（不采信转述）

### 1.1 复现通道

| 环节 | 用的东西 |
|---|---|
| 被测页面 | 宿主自己的演示页 `demo/demo.html`（`?nomodel=1` 起，装载由脚本显式点，判据才可归因） |
| 判据工具 | **本轮新建** `tools/idle-motion-probe.cjs`（§六）——点按钮前后各采样 N 帧画布 |
| 时间轴取证 | **本轮新建** `tools/idle-rootcause-evidence.cjs`——按时间轴轮询宿主内部状态 |
| 消融验证 | **本轮新建** `tools/idle-argorder-ablation.cjs`——在修后产物上重放旧写法（§2.4） |
| 失败可见性 | **本轮新建** `tools/idle-failure-visibility.cjs`——故障注入，验"失败必须出声"（§3.4） |
| 浏览器 | playwright + swiftshader（与既有 `tools/*.cjs` 同一套启动参数） |
| 节点 | `/opt/homebrew/bin/node` |

### 1.2 逐字报错（页面日志原样，未改写）

```
[frame-error] Cannot read properties of null (reading 'duration')
[frame-stack] TypeError: Cannot read properties of null (reading 'duration') <-     at _CubismMotion.doUpdateParameters (…/live2d-host.bundle.mjs:〈偏移略〉) <-     at _CubismMotion.updateParameters (…/live2d-host.bundle.mjs:〈偏移略〉) <-     at CubismMotionManager.doUpdateMotion (…/live2d-host.bundle.mjs:〈偏移略〉) <-     at CubismMotionManager.updateMotion (…/live2d-host.bundle.mjs:〈偏移略〉)
```

> 上面两行**逐字照抄**，只把栈里的**打包产物偏移**（形如 `:7446:37`）换成了 `〈偏移略〉`：那是 esbuild 产物内的字节偏移，**每次重建都变**，不是稳定的源码位置；引用源码位置一律走锚点。函数名与调用链一字未改。
> 抛错的**源码位置**是 `CubismMotion.doUpdateParameters()` 里读 `this._motionData.duration` 那一行〔A20〕。
- 页面把这条异常**只记一次**（`window.__l2dErrLogged` 去重）——所以「日志里 2 条」不代表「只错了一次」：它是**每帧都在抛**，只是不再重复打印。这一点是我在 §1.3 用画布哈希才看出来的。

### 1.3 「冻住」的判据（**不是看一眼截图**）

判据＝**相邻两帧画布像素完全相同**（像素级比较，`changedPixels === 0`）；辅助输出 sha256（编码器无关性由像素比较兜底）。

**修前 · 点「起 Idle 动作」之后的 12 帧**：

| 模型 | 不同哈希数 | 相邻帧完全相同的对数 | 逐帧变化量（changedPixels） |
|---|---|---|---|
| `Haru` | **1 / 12** | **11** | `0,0,0,0,0,0,0,0,0,0,0` |
| `DS_p2l2` | **1 / 12** | **11** | `0,0,0,0,0,0,0,0,0,0,0` |
| `Natori` | 8 / 12 | 4 | `30193,35307,22252,17366,32431,25655,12233,0,0,0,0` |
| `Wanko` | 9 / 12 | 3 | `24980,19550,32151,18713,32040,19779,33393,3291,0,0,0,0` |

→ `Haru`／`DS_p2l2` 是**点完就冻**；`Natori`／`Wanko` 是**窗口后段才冻**（它们的 Idle 更长）。
**这正是「只截图看一眼」会误判的地方**：同一模型在不同时间点看，一个像"在动"、一个像"冻住"。判据必须是逐帧序列。

### 1.4 全量复现：**13 个模型全崩**，且**多数不需要点按钮**

修前对宿主里全部 13 个模型跑同一探针（每模型 `--frames=12 --interval=700`，即点按钮前后各 7.7s 窗口）：

| 模型 | 点按钮**前**（不同哈希 / 相同对数） | 点按钮**后** moved | 点按钮后 报错 | Idle 缓存对象 `_motionData` |
|---|---|---|---|---|
| `Haru` | 12/12 · 0 | **0** | 2 | **null** |
| `Hiyori` | **2/12 · 10** | **0** | 2 | **null** |
| `Mao` | **6/12 · 6** | **0** | 2 | **null** |
| `Mark` | **10/12 · 2** | **0** | 2 | **null** |
| `Natori` | 12/12 · 0 | 175437 | 2 | **null** |
| `Ren` | **5/12 · 7** | **0** | 2 | **null** |
| `Rice` | **5/12 · 7** | **0** | 2 | **null** |
| `Teacher` | **9/12 · 3** | **0** | 2 | **null** |
| `Wanko` | 12/12 · 0 | 183897 | 2 | **null** |
| `miku` | **5/12 · 7** | **0** | 2 | **null** |
| `miku_sample_t04` | **5/12 · 7** | **0** | 2 | **null** |
| `DS_p2l2` | **7/12 · 5** | **0** | 2 | **null** |
| `p2l2char` | **7/12 · 5** | **0** | 2 | **null** |

🔴 **10/13 在「点按钮之前」就已经冻住了**（加粗那几行的"相同对数"远大于 0）——因为宿主自己在 `update()` 里就会在动作播完时起下一个 Idle（`startRandomIdleMotion()`〔A10〕），**那条路也踩同一个雷**。上一路报的「装载后呼吸/眨眼正常、只有起动作才崩」，**在一个 Idle 时长之内成立，之后就不成立**（`Hiyori` 的 Idle 里有 1.6s／1.9s 的短动作，所以它几乎立刻就冻）。
→ 结论修正：**这条挡的不是「起动作」这一个按钮，而是「所有会动」的功能本身**（与上一路的严重度判断一致，只是触发条件更宽）。

---

## 二 · 根因

### 2.1 因果链（每一步都指到源码）

1. **宿主 `load()` 时一次性装载全部动作并长期缓存**在 `this.motionGroups[].motions` 里〔A09〕——这是宿主的既定设计（起动作时不重新 parse）。
2. **下发时参数少传一个**：官方签名 `startMotionPriority(motion, autoDelete, priority)`〔A15〕，且它把 `autoDelete` 原样透传给 `super.startMotion()`〔A16〕。修前宿主写的是 `startMotionPriority(g.motions[index], priority)` —— 于是
   - `autoDelete = priority`（`1` 或 `2`，**真值**）；
   - `priority = undefined`（顺带把优先级仲裁也废了：`_currentPriority` 变成 `undefined`）。
3. **动作播完** → `CubismMotionQueueManager.doUpdateMotion()` 把该条目 `release()` 并摘除〔A17〕。
4. `CubismMotionQueueEntry.release()` 逐字是 `if (this._autoDelete && this._motion) { ACubismMotion.delete(this._motion); }`〔A18〕——`autoDelete` 为真 → 调 `CubismMotion.release()` → **`this._motionData = null`**〔A19〕。
   → **宿主自己数组里那个对象，从此是个空壳**（对象引用还在，内容没了）。
5. 下一帧 `update()` 里 `isFinished()` 为真〔A21〕（队列里没有还在播的动作）→ 起 Idle → 拿到的是**同一个空壳**。
6. `updateMotion()` → `doUpdateParameters()` 第一行读 `this._motionData.duration`〔A20〕→ **抛 TypeError**；因为队列条目永远播不完，异常**每帧都抛**，`draw()` 再也执行不到 → **画面冻住**。

### 2.2 观测证据：修前时间轴（`DS_p2l2`，节选）

```
    4658ms  queue=1 [#1 autoDelete=1 finished=false start=0.03 dataNull=false]  cachedDataNull={-}     entrySeq=1  frameErr=false
    5162ms  queue=1 [#1 autoDelete=1 finished=false start=0.03 dataNull=false]  cachedDataNull={-}     entrySeq=1  frameErr=false
    5685ms  queue=1 [#2 autoDelete=1 finished=false start=6.07 dataNull=true]   cachedDataNull={Idle}  entrySeq=2  frameErr=true
    …
   14683ms  queue=1 [#2 autoDelete=1 finished=false start=6.07 dataNull=true]   cachedDataNull={Idle}  entrySeq=2  frameErr=true
```

读法（三个字段一起看）：
- `autoDelete=1` —— **确认参数落错槽**（宿主本意是 priority=1）；
- `#1 → #2` —— 动作播完、条目被换掉（`entrySeq` 从 1 变 2），**而且之后 10 秒再没变过**（崩了，永远起不来）；`entrySeq`／`#n` 是取证脚本给**队列条目对象**发的稳定编号〔A29〕（`CubismMotionQueueEntry` 的 handle 就是对象自身，不能序列化，所以用 WeakMap 编号）；
- `dataNull: false → true` —— **同一时刻**缓存对象被掏空，**这就是"为什么会读到 null"的直接答案**。
- `Haru` 时间轴同构（`#1` 在 4509ms 还是 `dataNull=false`，5098ms 变成 `#2 … dataNull=true`）。

### 2.3 逐个排除另外三种可能（都不成立）

| 候选解释 | 结论 | 依据 |
|---|---|---|
| `isFinished()` 语义被用错 | **不成立** | `isFinished()` 的定义就是"队列里所有条目都播完了"〔A21〕；队列空时返回真，是**正常**状态。用它当"该起待机了"的条件本身没问题。 |
| motion 队列空 → `updateMotion()` 读到 null | **不成立** | `doUpdateMotion()` 只是遍历 `_motions`〔A30〕：空队列循环 0 次、返回 `false`，**不读任何属性**。真正读 `_motionData.duration` 的是"条目里有动作、但动作是空壳"这条分支。 |
| `g.motions[index]` 是 `null`（上一路报告里的推断） | **不成立** | 宿主数组里的引用一直在（我们自己的 `motionGroups` 持有它），`loadMotion()` 也返回了非 null 对象（否则装载阶段就抛了）。**是对象内部被掏空，不是引用为 null。** |

> 关于上一路报告的定位，我按事实分开说：**方向是对的**（就在 `update()` 那一段 `isFinished() → startRandomIdleMotion()` 调用上），**机制描述不准**（它写的是"一旦 motion 对象为 null，下一帧 updateMotion() 就抛"）。真实机制见 §2.1 第 2–4 步——**多传一个 `autoDelete` 才是那一环**。这不是措辞问题：按"对象为 null"去修，会修成加 `if (!m) return`（＝把崩溃换成静默不动），而真正的病根一个字都不会被碰到。

### 2.4 消融验证：在**修后**产物上重放旧写法，崩溃原样复现

修前那次 sweep 跑的是**开工时现盘的 `out/`**，而 `scripts/build.mjs` 会先 `rmSync(out)` 再重建——那份旧 bundle 已被覆盖、**哈希没留痕**（这是我的留痕缺口，如实记在 §七）。
为了把这个对照做成**可复现**的，本轮加了 `tools/idle-argorder-ablation.cjs`：**不改源码**，只在页面里把 `host.startMotion` 换回旧的两参数写法〔A32〕，然后对比。

| 模型 | 消融用的动作（自动挑最短的非 Idle 动作） | 修后写法：播完后 `_motionData` | 旧写法：播完后 `_motionData` | 再用空壳起一次 |
|---|---|---|---|---|
| `DS_p2l2` | `Blink#0`（1.2s） | `null` 否 → **对象完好** | `null` 是 → **被掏空** | **抛出逐字相同的 TypeError** |
| `Haru` | `TapBody#3`（4.03s） | 完好 | 被掏空 | 同上 |
| `p2l2char` | `Surprise#0`（0.4s） | 完好 | 被掏空 | 同上 |

→ 「参数顺序就是根因」不再依赖一份已经消失的旧产物：**同一份现盘 bundle，只改调用写法，崩与不崩互换**。

### 2.5 顺带查清的第二件事：动作文件里的 `Loop` 标志**根本没被应用**（与本缺陷无关，但要说清）

- `CubismMotion.parse()` 只把 JSON 的 `Loop` 写进 `this._motionData.loop`〔A22〕，**从不写 `this._isLoop`**；`_isLoop` 只在构造函数里被置为 `false`〔A23〕。
- 于是 13 个样本的 Idle 动作（`Meta.Loop` 全是 `true`）在运行时 `_isLoop` 都是 `false`。观测值（同一时刻同一对象）：`motionDataLoop=true` 而 `isLoop=false`。
- 框架 CHANGELOG 记了这条行为变更（`_isLoop` 挪到 `ACubismMotion`、新增 setter、并修了 looping motion 的播完判定）〔A25〕，`setLoop()` 也确实存在〔A24〕——**要循环，得应用自己调**。
- **这条不是本次崩溃的原因**（动作播完→再起一个，在框架语义下是正常的待机策略），**本轮不动它**（理由见 §3.5）。

---

## 三 · 修法（为什么是根因修）

### 3.1 改了三处（全部在宿主树内）

| # | 位置 | 改动 |
|---|---|---|
| ① | `src/host.js` `startMotion()`〔A01〕 | 按官方签名补齐 `autoDelete=false`〔A02〕：**对象生命周期归宿主，就明确告诉框架"不许删"** |
| ② | `src/host.js` `startMotion()` 返回值〔A03〕 | 检查框架返回值：`handle !== InvalidMotionQueueEntryHandleValue`（官方约定被拒绝时返回 -1）；该常量从 `framework-entry.js` 新出口引入〔A04〕〔A11〕 |
| ③ | `src/host.js` `update()`〔A05〕＋新增 `reportError()`〔A07〕〔A08〕 | 起 Idle **失败必须出声**：失败状态"从无到有"时报一次（不重不漏：置位处见〔A06〕，恢复后自动复位；不刷屏、恢复后再失败会再报）；默认打 `console.error`，也可由 `opts.onError` 接管；演示页把它接进页面日志〔A13〕，「起 Idle 动作」按钮也检查返回值〔A14〕 |

### 3.2 为什么这是根因修，不是吞错

- **吞错的形状**会是：`try { mm.updateMotion(...) } catch {}`、或 `if (!motion || !motion._motionData) return;`、或"起失败就跳过这一帧"。这三种**画面照样冻住，只是没人知道**——正是本项目最恨的静默。
- **本修法做的是相反的事**：
  1. **让不该发生的释放不发生**——所有权错配（宿主长期持有 vs 框架播完即删）被消除，`_motionData` 不再被掏空；
  2. **把仍然可能发生的失败变成可见错误**——起动作失败（无 Idle 组／被框架拒绝）走 `reportError()`，默认落 `console.error`，演示页落页面日志。
- **代价：零。** `autoDelete=false` 不增加内存占用——这些对象**本来就被宿主长期持有**〔A09〕；也不改变"播完 → 条目摘除 → 起下一个"的时序（§4.4 有观测）。

### 3.3 为什么**没有**走另外两条路

| 没走的路 | 为什么 |
|---|---|
| 加 null 保护（`_motionData == null` 就 return） | 把崩溃换成**静默不动**；且下次换个模型/换个组还会踩。**这是把症状盖住。** |
| 每次起动作都重新 `loadMotion()` 一份 | 等于拆掉宿主"一次装载、长期缓存"的架构去绕过生命周期问题；也把 priority 传参错误留着不修。 |
| 在教室/面板侧打补丁绕开 | 缺陷在宿主内部；绕过去等于把同一颗雷留在所有调用方脚下。 |

### 3.4 失败可见性：故障注入验证（`tools/idle-failure-visibility.cjs`）

**正常路径证明不了"失败会出声"**，所以注入一个必然失败的条件：把 `window.__host.idleGroup` 置空〔A31〕（等价于"这个模型没有可用的 Idle 动作"），再看两个入口：

| 入口 | 结果 |
|---|---|
| 渲染循环里的自动待机 | 页面日志出现 `[host-error] 起 Idle 动作失败：idleGroup=null count=0` |
| 演示页「起 Idle 动作」按钮 | 页面日志出现 `[host-error] 起 Idle 动作失败：该模型没有可用的 Idle 动作` |
| 是否打断渲染 | `pageerror=0`、`window.onerror=0`（出声但**不抛**） |
| 顺带旁证 | `stopAllMotions()` 之后缓存动作仍**不是空壳**（`_motionData` 完好）——`autoDelete=false` 的又一实证 |

`Haru`／`DS_p2l2` 两模型均 **exit=0**。

### 3.5 明确**不改**的两件事（附理由）

1. **不调 `setLoop()`**（§2.5）：那是**行为变更**（让 Idle 无缝循环），不属于本缺陷；且现行为（播完→起下一个）在框架语义下成立、修后已实测能连续起 5 次（§4.4）。要不要改成真循环，列入待确认（§八）。
2. **不动演示页渲染循环的 rAF 叠加问题**（多次装载会叠加多条 rAF 链、同帧多次 `step()`）：这是演示页自身的缺陷，与本次崩溃无关，改动它会扩大改动面。列入待确认（§八）。

---

## 四 · 全量回归

### 4.1 判据（合取，缺一不可）

1. 点「起 Idle 动作」后画布**逐帧都在变**（像素级 `changedPixels > 0`）；
2. **四条报错通道全空**：`pageerror` ＋ `window.onerror`/`unhandledrejection` ＋ `console.error` ＋ 页面日志里的 `[frame-error]`；
3. 探针退出码 0。

> ⚠️ 为什么必须四条：上一路的脚本只收 `pageerror`，而这个演示页把帧内异常**自己 catch 进页面日志**了——**"脚本报 0 错"不等于"没有错"**。本轮把三条外部通道＋日志通道一起收〔A27〕，并做成合取判据〔A28〕。

### 4.2 逐模型前后对照（13/13）

判据列＝"点按钮后 12 帧里不同哈希数 / 相邻帧完全相同的对数"；报错列＝四条通道合计条数。

| 模型 | 修前 · 点按钮后 | 修前 报错 | 修前 Idle 缓存 | 修后 · 点按钮后 | 修后 报错 | 修后 Idle 缓存 | 退出码 |
|---|---|---|---|---|---|---|---|
| `Haru` | **1/12 · 11** | 2 | **空壳** | 12/12 · 0 | 0 | 完好 | 1 → **0** |
| `Hiyori` | **1/12 · 11** | 2 | **空壳** | 12/12 · 0 | 0 | 完好 | 1 → **0** |
| `Mao` | **1/12 · 11** | 2 | **空壳** | 12/12 · 0 | 0 | 完好 | 1 → **0** |
| `Mark` | **1/12 · 11** | 2 | **空壳** | 12/12 · 0 | 0 | 完好 | 1 → **0** |
| `Natori` | 8/12 · 4 | 2 | **空壳** | 12/12 · 0 | 0 | 完好 | 1 → **0** |
| `Ren` | **1/12 · 11** | 2 | **空壳** | 12/12 · 0 | 0 | 完好 | 1 → **0** |
| `Rice` | **1/12 · 11** | 2 | **空壳** | 12/12 · 0 | 0 | 完好 | 1 → **0** |
| `Teacher` | **1/12 · 11** | 2 | **空壳** | 12/12 · 0 | 0 | 完好 | 1 → **0** |
| `Wanko` | 9/12 · 3 | 2 | **空壳** | 12/12 · 0 | 0 | 完好 | 1 → **0** |
| `miku` | **1/12 · 11** | 2 | **空壳** | 12/12 · 0 | 0 | 完好 | 1 → **0** |
| `miku_sample_t04` | **1/12 · 11** | 2 | **空壳** | 12/12 · 0 | 0 | 完好 | 1 → **0** |
| `DS_p2l2` | **1/12 · 11** | 2 | **空壳** | 12/12 · 0 | 0 | 完好 | 1 → **0** |
| `p2l2char` | **1/12 · 11** | 2 | **空壳** | 12/12 · 0 | 0 | 完好 | 1 → **0** |

**13/13 全部：修前 exit=1（崩）→ 修后 exit=0（在动、零报错）。**

修后「点按钮前」窗口同样 12/12 全变（说明待机本身也健康，不只是"点完能动"）。

### 4.3 修后逐帧变化量（抽样，`DS_p2l2`）

点按钮**后** 12 帧：不同哈希 **12/12**、相邻帧完全相同 **0** 对、变化像素合计 **754034**。

```
#0→#1  changedPixels=77068  ratio=0.15033  maxAbsDiff=232
#1→#2  changedPixels=74751  ratio=0.14581  maxAbsDiff=219
#2→#3  changedPixels=80671  ratio=0.15736  maxAbsDiff=226
#3→#4  changedPixels=67591  ratio=0.13184  maxAbsDiff=218
#4→#5  changedPixels=70623  ratio=0.13776  maxAbsDiff=222
#5→#6  changedPixels=34873  ratio=0.06802  maxAbsDiff=215
#6→#7  changedPixels=62876  ratio=0.12265  maxAbsDiff=209
#7→#8  changedPixels=72789  ratio=0.14198  maxAbsDiff=217
#8→#9  changedPixels=76190  ratio=0.14862  maxAbsDiff=223
#9→#10 changedPixels=71044  ratio=0.13858  maxAbsDiff=222
#10→#11 changedPixels=65558  ratio=0.12788  maxAbsDiff=217
```

点按钮**前**同样 12/12、0 对相同（合计 799408）——待机本身也健康，不只是"点完能动"。
（其余 12 个模型的逐帧表见证据 `evidence/idle-fix/after/<模型>.json` 的 `afterClick.deltas`。）

### 4.4 修后时间轴：**动作能播完、能换下一个**（`DS_p2l2`，26 秒窗口）

```
      18ms  queue=1 [#1 autoDelete=false … start=0.03 dataNull=false]  cachedDataNull={-}  entrySeq=1  frameErr=false
    5693ms  queue=1 [#2 autoDelete=false … start=6.07 dataNull=false]  cachedDataNull={-}  entrySeq=2  frameErr=false
    …      #3 … #4 …
   23667ms  queue=1 [#5 autoDelete=false … start=24.2 dataNull=false]  cachedDataNull={-}  entrySeq=5  frameErr=false
canvas distinct hashes over window = 46/46
动作被起过 5 次（队列条目编号最大值；>1 = 播完之后换过下一个）
pageErrors=0 windowErrors=0 logFrameErr=0
```

- `autoDelete=false` —— 修复生效的直接读数；
- `#1 → #2 → #3 → #4 → #5`，间隔≈6.0s＝`ds.idle` 的动作时长 —— **播完 → 换下一个**，连续 5 次；
- `cachedDataNull={-}` —— 缓存对象全程完好；
- **画布 46/46 帧各不相同** —— 26 秒里没有一帧是静止的。
- `Haru` 同构（26s 窗口内多次换动作、零报错）。

### 4.5 交叉检查（两条独立路径）

| 检查 | 结果 |
|---|---|
| 两次独立全量 sweep（中间只多了一处**源码注释**改动；esbuild 不把注释带进产物，`out/live2d-host.bundle.mjs` **两次哈希相同**） | 两次都 13/13 exit=0，逐模型读数一致 |
| 消融脚本（在修后产物上重放旧写法） | 3 个模型全部复现崩溃（§2.4） |
| 故障注入（起动作必然失败） | 两个入口都出声、不抛（§3.4） |

---

## 五 · 能力发现 / 嘴部驱动回归（顺带核一遍没被弄坏）

### 5.1 能力发现（`scripts/run-capability.mjs`，纯 JSON 解析）

**修前 / 修后的 `evidence/capability_table.json` sha256 完全相同**（`9391ef559958b209…`），13 个样本的动作组／表情／嘴参数命中级别／相位→表情状态逐字节一致。
（`framework-entry.js` 只新增了一个出口〔A11〕，没有动任何既有导出；这条哈希等价是它的运行时段证据。）

### 5.2 嘴部驱动（`tools/mouth-iso.cjs`，「写值看画面」）

方法照旧：**先冻结动画**（只 `draw` 不 `update`），再只改 LipSync 参数截两张图，差异只可能来自嘴参数；并验"改回去必须完全一致"。

| 模型 | 修前 changedPixels | 修后 changedPixels | 修后 bbox（在嘴部区域） | 改回后 changedPixels |
|---|---|---|---|---|
| `DS_p2l2` | 204 | **203** | 18×15 @ (345,183) | **0** |
| `Haru` | 162 | **161** | 21×11 @ (347,120) | **0** |
| `p2l2char` | 273 | **270** | 26×27 @ (335,376) | **0** |
| `miku` | 120 | **126** | 17×12 @ (374,112) | **0** |
| `miku_sample_t04` | 117 | **126** | 17×13 @ (356,110) | **0** |
| `Teacher` | 89 | 24（**见下**） | 6×5 @ (359,158) | **0** |

🔴 **诚实标注两件事**：
1. **绝对数不可跨轮直接比较**：这个脚本是"冻结那一刻的姿态"决定的，而冻结时刻取决于装载/等待时序；修前 Idle 会崩（姿态停在崩溃帧），修后 Idle 一直换动作（姿态各不相同）。
2. **`Teacher` 修后只有 24 像素**，比修前的 89 小。**推断（不是确证）**：那一轮冻结到的姿态上，嘴部被遮挡/侧转，可见嘴区变小（bbox 从 12×9 缩到 6×5，位置几乎没变）。**旁证**：同一模型连续跑三次，changedPixels 分别是 **24 / 87 / 21**——同一份代码、同一份产物，读数就随冻结姿态在 21–87 之间跳，**说明这个量本身不是稳定指标**。
3. **稳定成立的不变量**（三个都成立）：① 差异 **> 0**；② 差异 bbox **落在嘴部**；③ 改回闭合后 **0 像素差**（可逆、无累积漂移）。
→ 结论：**嘴部驱动没被弄坏**。若要把它做成"数值型回归断言"，需要先把冻结时机固定住（例如冻结前先 `stopAllMotions()`）——列入待确认（§八）。

---

## 六 · 新探针（把「起动作」变成可自动验证）

### 6.1 用法

```
# 工作区根执行
/opt/homebrew/bin/node 开源线/DSH定制/code/clients/live2d-host/tools/idle-motion-probe.cjs [模型名] [选项]

选项
  --frames=N     点按钮前后各采样 N 帧（默认 12）
  --interval=MS  帧间隔（默认 700）
  --json=PATH    结果 JSON 落盘
  --host=DIR     宿主目录（默认脚本上一级）
  --button=CSS   改点哪个按钮（默认 #motion「起 Idle 动作」）
  --quiet        不打印逐帧表
```

### 6.2 退出码契约〔A26〕

| 码 | 含义 |
|---|---|
| **0** | 起动作后画面在动，且**四条报错通道全空** |
| **1** | 画面冻住 **或** 有报错（＝崩溃复现／回归失败） |
| **2** | 装载或环境失败（拿不到基线，判据不成立） |

判据是**合取**：`movedAfterClick && errorCount === 0`〔A28〕；报错通道之一见〔A27〕。

### 6.3 它自己的验收

| 验收 | 结果 |
|---|---|
| **能抓到缺陷**（修前） | 13/13 模型 **exit=1**，全部命中 `Cannot read properties of null (reading 'duration')` |
| **能放行修复**（修后） | 13/13 模型 **exit=0** |
| **能区分"冻住"与"在动"** | 修前 `identicalPairs=11`（12 帧里 11 对完全相同）／修后 `identicalPairs=0` |
| **不依赖 `window.__host`** | 主判据（画布哈希＋像素比较＋四条报错通道）全部来自页面外部；`__host` 只用于**附加**输出内部状态（队列长度、`_motionData` 是否空壳），缺失时自动降级为 `null`。这个钩子是演示页里一行纯赋值〔A12〕，不改变页面任何行为——人点按钮的路径与脚本路径**完全同一条** |
| **零新增依赖** | 只用 node 内置（`http`/`fs`/`crypto`/`zlib`）＋项目根**已有**的 playwright |
| 配套脚本 | `tools/idle-rootcause-evidence.cjs`（时间轴）、`tools/idle-failure-visibility.cjs`（失败可见性）、`tools/idle-argorder-ablation.cjs`（消融） |

### 6.4 局限（写清楚，免得被当成万能）

- 采样窗口必须**长于该模型 Idle 的动作时长**，否则测不到"播完→再起"这条路径（默认 12×700ms≈7.7s，覆盖官方样本里 5–6s 的短 Idle；`Haru` 有 10s 的 Idle，靠随机取到短的那条才在窗口内暴露——**这不是确定性覆盖**）；
- 只判"在动/冻住"，**不判动作对不对**（动作语义、表情、口型仍要人看）；
- 依赖 playwright＋swiftshader，单模型一次约 20–25 秒。

---

## 七 · 未做到 / 边界（如实列）

1. **修前那份 `out/` bundle 的哈希没有留痕**。开工时 `out/live2d-host.bundle.mjs` 是 562357 字节（上一路 14:03 构建），我在重建前没有先记哈希；`scripts/build.mjs` 会 `rmSync(out)` 重建，旧产物已不可复原。**可对得上的是源码侧**：修前 `src/host.js` = `081d39edce8f6264…`（上一路 P2L2 报告留痕），修后 = `af98c9d3fb845fb0…`。**补救**：§2.4 的消融验证让因果链在**现盘产物**上可复现，不再依赖那份旧产物。
2. **没取到官方 sample 源码**（`CubismWebSamples` 的 `lappmodel.ts`）。尝试直连 GitHub raw／jsDelivr 均被网络层拒绝（本机 Clash TUN 会把外部域名解析到非公网地址），工作区内也没有该文件。→ 所以本报告**没有**任何"官方 sample 是怎么写的"的断言；所有框架侧结论都只依据**vendored 框架源码**与它自带的 CHANGELOG（都带锚点）。
3. **没有跑教室/面板侧**（`code/clients/classroom-ui/**` 是另一路正在改的树，本轮只读不碰）；所以"教室侧立绘能不能跟着动"本轮**没有**端到端证据，只有宿主层证据。
4. **没有做性能对比**（`autoDelete=false` 不改变内存持有关系，见 §3.2，但未实测内存/帧率）。
5. **没有 git 操作**（未 commit／未 push），符合任务边界。
6. **我在本树 `README.md` 里补了工具与缺陷记录（§一之补）**，但**该 README 的旁挂锚点表 `README.anchors.md` 目前是红的**——红的 17 条**全部**指向**我这棵树以外**的文件，且那两处**正在被别的路改**：
   - `code/clients/classroom-ui/lib/client.js`：表里记 `3ee2e80beda97ecf`，现盘 `27c99052c5dc971b`（行号也从 1535／1322／1606／2414 漂到 1894／1477／2065／2877）；
   - `code/classrooms/cs-os/classroom.yaml`：表里记 `b8b765ea73bc0a12`，现盘 `c30e2ab5a7bf1a7b`。
   这两棵树**按任务纪律我一个字都没碰**（README 自身的新增文字不引入任何行号，也不改这两个文件）。**我没有删锚点、没有放宽判据去凑绿**——按规矩如实报告。
   🔴 **本轮交付的报告本身机核为 0 ERROR**（32 锚点 / 13 版本 / 32 处引用），命令与退出码见 §附录 A 与旁挂锚点表。

---

## 八 · 待确认清单（需要拍板的，我不擅自决定）

| # | 事项 | 选项 | 我的倾向 |
|---|---|---|---|
| 1 | Idle 动作要不要**真循环**（调 `setLoop()`，见 §2.5） | A 保持现状（播完→起下一个，与框架 isFinished 语义一致）／B 按动作文件的 `Meta.Loop` 调 `setLoop()` | **A 保持现状**：行为变更应单独立项，且现状已实测连续可起 |
| 2 | 演示页**渲染循环 rAF 叠加**（多次装载后同帧多次 `step()`） | A 本轮不动（已记）／B 立刻修（`stopLoop` 或存 rAF id） | 修（但与本次崩溃无关，建议单独一条） |
| 3 | 教室/面板侧要不要接 `opts.onError` | A 接（把宿主错误显示在面板上）／B 只靠 console | 接——本项目口径是"不许静默" |
| 4 | `loadMotion()` 返回 `null`（动作文件解析失败）时的报错可读性 | A 现状（会在 `setEffectIds` 处抛一句难懂的 TypeError）／B 在装载阶段给明确报错 | B，但**不属于本缺陷**，单独立项 |
| 5 | 新探针要不要接进验收流水线（`code/acceptance/**` 不在我树内，本轮未碰） | A 接入（每次改宿主自动跑 13 模型）／B 手动跑 | A，但需另一条线配合 |
| 6 | `mouth-iso` 要不要改成"先 `stopAllMotions()` 再冻结"以获得稳定数值 | A 改（数值可作断言）／B 维持现状（只判不变量） | A |

---

## 附录 A · 锚点表

**旁挂文件**：`实现报告_L2D-FIX-IDLE_Idle崩溃_2026-09-24.anchors.md`（版本表／锚点表／行号散写豁免三张表）。
正文**不散写任何源码行号**；机核命令见本报告抬头。

## 附录 B · 改动与产物哈希（现盘）

| 类别 | 路径 | sha256 前 16 位 |
|---|---|---|
| 改（修后） | `code/clients/live2d-host/src/host.js` | `af98c9d3fb845fb0` |
| 改（修后） | `code/clients/live2d-host/src/framework-entry.js` | `9c6bc6c521e55f80` |
| 改（修后） | `code/clients/live2d-host/demo/demo.html` | `5499baf616efbb18` |
| 产物（重建） | `code/clients/live2d-host/out/live2d-host.bundle.mjs` | `3fe2922d4d04e244` |
| 产物（重建） | `code/clients/live2d-host/out/demo.html` | `5499baf616efbb18`（与源同哈希） |
| 新增 | `code/clients/live2d-host/tools/idle-motion-probe.cjs` | `f3f902b98ed1de49` |
| 新增 | `code/clients/live2d-host/tools/idle-rootcause-evidence.cjs` | `c2f527507887a3f4` |
| 新增 | `code/clients/live2d-host/tools/idle-failure-visibility.cjs` | `dd6ccc7d445ce735` |
| 新增 | `code/clients/live2d-host/tools/idle-argorder-ablation.cjs` | `3f5f7933c08adf91` |
| 修前（留痕自上一路） | `src/host.js` | `081d39edce8f6264` |

## 附录 C · 证据文件

| 目录 | 内容 |
|---|---|
| `code/clients/live2d-host/evidence/idle-fix/before/` | 修前 13 模型的探针 JSON＋日志；`rc-<模型>.{json,log}` 时间轴 |
| `code/clients/live2d-host/evidence/idle-fix/after/` | 修后 13 模型探针 JSON＋日志；时间轴；消融；故障注入；能力发现 stdout |
| `code/clients/live2d-host/evidence/idle-fix/baseline/` | 修前的能力发现表与 6 份 mouth-iso 基线（供逐项对比） |
