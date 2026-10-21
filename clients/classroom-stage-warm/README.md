# classroom-stage-warm —— 教室舞台（DSH web 客户端插件 · v0.0.1）

> **一句话**：把 DSH 的会话界面整屏换成「教室舞台」——暖纸配色、老师立绘、纸带正文、自带输入条。
> 形态是 **整屏接管**，落点**不在任何插槽里**（自建容器挂 `document.body`），所以它崩了只影响它自己。

**包名** `classroom-stage-warm` ｜ **两个半边**：

| 半边 | 文件 | 跑在哪 | 负责 |
|---|---|---|---|
| 宿主 | `lib/index.js` | Node | 素材静态路由 `/stage-static/*`（loopback-only）＋ 设置持久化 |
| 浏览器 | `lib/client.js` | 浏览器 | 整屏舞台（手写 `__ModuleLoader__` bundle，无构建步骤） |

---

## 〇 · 先跑这一条：**唯一验收入口**

```bash
cd clients/classroom-stage-warm
./check.sh                 # 离线自检：29 项（不装 profile、不起服务、不联网）
PORT=4498 ./check.sh --live    # 再加真机冒烟 4 项（自克隆隔离 harness → 建 profile → 装插件 → 预检）
# 退出码 0 = 全绿
```

它检查的东西（**这就是本包的可机核验收标准**）：

| 组 | 查什么 |
|---|---|
| 1 | 两半语法（`lib/index.js` / `lib/client.js`） |
| 2 | 🔴 **CSS 模板串里不许有裸反引号**（踩过：模板串会提前结束、报错跑到文件末尾） |
| 3 | **九类造型节点真的产出**：`cardframe` / `line sans` / `cast-wrap` / `orn` / `opts` / `oc picked sent` / `oc cur` / `oc disabled` / `quiet` |
| 4 | 宿主 5 条路由 ＋ `listBoards` / `listAnimations` |
| 5 | 素材与 **schema**：舞台图 ／ 板书 `whiteboard.scene.v1` ／ 动画 `animation.scene.v1` ＋ 视频体积 |
| 6 | 逃生门两快捷键 ／ `SAFE_MODE` ／ **仅 loopback** ／ **整屏层级 1080** |
| 7 | 纯函数单测：**从真源码逐字抽出** `parseOptions` 再跑（9 例） |
| 7b | 纯函数区单测：抽 `[STAGE-PURE-BEGIN]…END` 那一段跑 63 例（K0 挂载点形状／`setExpressionDriver` 语义／`dispose` 顺序／K1.3 剥离／K2.3 板书事件／口型源／mermaid svg 归一化） |
| 7c | 宿主半边单测 51 例：读图路由**四条拒绝规则**（含符号链接）／索引按表头名解析（含新「会话」列）／情绪通道／教室标识 |
| 7d | 契约 K0 第 5 条：`ensureStageModule` 存在，且 `listLibs()` 的 phases 没被塞进新模块 |
| 8 | （`--live`）克隆隔离 harness → 建 profile → 装插件 → `--dump-config exit 0`，**跑完自清** |

真机浏览器段（铺满／六态／拉出／板书／动画那条线）另跑 `test/13`–`test/16`（每个都要先起服拿 token，见 §六）。

---

## 一 · 装法（**隔离 profile**，别碰在用的 web/桌面 profile）

```bash
# 1) 隔离一个 harness（只拷 profiles 层；不拷 sessions/storages）
ISO=/tmp/stage-home
rsync -a "$DSH_HOME/profiles" "$ISO/"
export DSH_HOME=$ISO

# 2) 从出厂 web 模板建 profile（★ 必须带 --from-default-profile，否则 bundles 里没有 dsh-web-app，起不了 UI）
# 🔴 这一条会**顺手把 web 应用起起来**（它按 profile 名推断要跑的应用）——
#    照抄时务必**后台跑 + 十几秒后杀掉**，否则你会得到一个占着端口的服务：
#      dsh --profile stage --from-default-profile web >/dev/null 2>&1 &
#      sleep 12; kill %1
#    （建 profile 只需要那十几秒；这一步只写 profiles/stage/，不启动任何常驻进程即可）
dsh --profile stage --from-default-profile web

# 3) 预检（组合 profile 但不启动应用）—— exit 0 才好往下走
dsh --profile stage --dump-config > /dev/null && echo OK

# 4) 装插件（本地包一律用 file:，**不要** link:）
dsh plugin --profile stage add file:"$PWD"

# 5) 🔴 每次 add/remove 之后都核一遍 bundles 名单（新 profile 必须是三件）
node -e "console.log(require(process.env.DSH_HOME+'/profiles/stage/package.json').dsh.profile.bundles)"
# → ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","classroom-stage-warm"]

# 6) 起（换端口，别撞上在跑的桌面实例）；token 在启动输出里，**每次重启都变**
dsh --profile stage --port 4400 --no-open
```

### 🔴 改完代码怎么让它生效

`file:` 装出来的 profile 副本**不保证**跟着工作区走（本地包经 pnpm 打包时会按 `package.json` 的
`files` 白名单裁剪，硬链接也不抗「替换式写入」）。**跑之前显式同步 + 哈希复核**：

```bash
PROF="$DSH_HOME/profiles/stage/node_modules/classroom-stage-warm"
cp lib/client.js lib/index.js "$PROF/lib/"
shasum -a 256 lib/client.js "$PROF/lib/client.js"   # 两边前 16 位必须一致
```

---

## 二 · 逃生门（整屏接管**必须**有，否则用户回不去）

| 操作 | 作用 |
|---|---|
| `Ctrl+Shift+M` | **就地关闭舞台**（顺带清掉 DSH 错误边界留下的崩溃占位） |
| `Ctrl+Shift+U` | 恢复舞台 |
| 地址栏 `?stage=off` / `?stage=on` | 同上（走 localStorage 记住） |

关闭出口挂**自建 DOM 上的键盘监听**，不在任何插槽里 —— 所以插槽级崩溃时它仍然可用。

---

## 三 · ★★ 四条铁律（都踩过，别改回去）

1. **层级要写在根节点上，且是 1080 不是 900。**
   - 挂载容器 `#stage-warm-root` 是个**普通 div**（`position:static`、在 body 流末、高度 0）。
     整屏那层的 `position:fixed; inset:0; z-index` **必须落在它内部的根 div 上**，
     否则子件的 `absolute` 会相对「初始包含块」落位 —— 看着位置对，其实是运气。
   - 取 900 会被**零层级的原生件**盖住：实测空会话状态下 `document.elementFromPoint()`
     在舞台输入框中心命中的是原生 hero 输入卡 `uV2eYG_hero` → **点不到我们自己的输入框**。
     1080 在所有应用内容之上、仍在 **DSH 浮层 1100 之下**（弹窗/菜单照常可用）。
   - ⚠️ 与同类整屏皮肤（如 Avalon 也取 900）**同开时后者会被盖住** → 同类皮肤**一次只开一个**。
2. **hooks 全部集中在上半段、排在任何 `return` 之前。** 禁 `useX ? useX() : y`
   —— 设置是异步到达的瞬时状态，条件 hook 会抛 React #310（`Rendered more hooks…`），
   而且报错**没有任何可读信息**、这棵 React 树直接废掉。
3. **只用 `React.createElement`。** 外壳播种的 `jsx` 只吃两个参数，**变长 children 被静默丢弃**。
4. **读会话走 `chat.order` + `chat.nodes.get(key)`**，`legacy.nodes` 只当兜底、去重键绝不退化成下标；
   工具调用在 DSH 里有**两个节点**（`assistant-step.data.blocks` 里一份 ＋ 独立 `tool-call`），**按 `callId` 去重**。
   另：`SessionListState` **没有** `current` 字段；`SessionSnapshot` **没有** `cwd`（`cwd` 只在列表行的 `SessionSummary` 上）。
5. 🔴 **功能开关不能走 URL query**（实战踩过）：宿主接管时会连 `?token=…` 带我们自己的参数一起抹掉，
   模块加载那一刻 `location.search` 已是空串 → 开关走 **hash**（`#stagegallery=1`）或 **localStorage**。
6. 🔴 **"DOM 对、样式对、就是看不见／点不到"要三层分别判**（本项目已三次同族）：
   ① **定位上下文**（谁给绝对定位兜底）② **z 层级**（有没有被同层或零层级原生件盖住）③ **几何**（有没有落到可视区外／被容器裁掉）。
   判据是**像素** ＋ **命中测试** ＋ **`getBoundingClientRect`**，不是目视。
7. 🔴 **立绘/背景这类"入画"效果的判据是渐变是否真的命中**（`getComputedStyle(el,'::after').backgroundImage`），
   不是"图换成了 `div` 就算做了"。

---

## 四 · 它现在能做什么（**2026-10-20 对齐代码现状**；旧版这张表已过期）

> 上一版这张表里"❌ 未做"的几项（拉出、白板屏、动画屏、Live2D、逃生门）**其实早就在代码里**，
> 是表格没跟上。2026-10-20 逐项核了代码并在真浏览器里复验，改成下面这张。
> 判据一律是机核读数（截图 / `getComputedStyle` / DOM 属性 / 逐帧读数），不是目视。

| 能力 | 状态 | 怎么验的（可复现） |
|---|---|---|
| 装上后宿主起得来 | ✅ | 隔离 profile `--dump-config` exit 0；真启动无 boot 失败 |
| 浏览器半边下发成功 | ✅ | `/stage-static/health` 的 `clientSeen=true` |
| 拿到会话数据 | ✅ | 传感器注册进 `conversation.input.right`（list / session / **无占位人**） |
| 整屏舞台渲染（背景／立绘／纸带／输入条） | ✅ | 截图；`#stage-warm-root` 单根、`z-index:1080` |
| 发送消息 | ✅ | 舞台输入条 → `inputActions.setDraft()` → 下一帧 `submit()` → 真进会话（`test/09`） |
| galgame 造型 DOM（六态／内框／花饰／入画渐变） | ✅ | `test/13` 真机：六态 6 张卡、`font-weight` 全 400、`pageerror` 0 |
| **面板从角色身后拉出**（170/390/220ms） | ✅ | `test/14` 逐帧：相位 `turn→pull→settle` 齐全；过冲**定帧实测** `translateX = −17.05px`（= 面板宽 840px 的 **2.03%**）；角色侧身位移 32px（对比件 −30px） |
| **白板＝舞台的一个「屏」**（整屏变纸） | ✅ | `test/15` 真机：`data-screen=board`、立绘 `opacity:0`、面板 840×609、场景 SVG 上屏 |
| **板书屏真渲染 mermaid**（不再是空框＋灰字） | ✅ | 真浏览器：vendored mermaid 11.17.2 经 `/stage-static/l2d/mermaid.min.js` 装载 → 4 节点 5 边流程图渲成 SVG，归一化后铺满 `.bp-canvas`（771×458，`preserveAspectRatio=meet`，不裁不变形）；截图见 `docs/证据图/舞台_Ws_板书屏_mermaid真渲染_2026-10-20.png` |
| **动画整屏放完自动回** | ✅ | `test/16` 真机：`data-anim=on`、`<video>` 全屏播放（5067ms，`readyState=4`）→ `ended` 后 `data-anim=off`、`.animscr` 移除 |
| Live2D 立绘 | ✅ | 真机：`window.PIXI` 6.5.2 + Cubism 2.1 装载，canvas 399×546，模型绘制成功（截图）。**headless Playwright 必须加 `--use-angle=swiftshader`，否则没有 WebGL**（见 §七之三） |
| Live2D 失败降级到静态 PNG | ✅ | 无 WebGL 环境实测：`data-l2d=off` + `teacher_gen.png` 上屏，`pageerror` 0 |
| 逃生门（Ctrl+Shift+M / Ctrl+Shift+U） | ✅ | 真浏览器键盘合成实测：关闭后 `data-killed=on`、`window.__SOCRATIC_STAGE__` 删除、横幅出现；恢复后挂载点回来、PIXI 应用重建。截图 `docs/证据图/舞台_S3_逃生门_{关闭,恢复}_2026-10-20.png` |
| **K0 全局挂载点** `window.__SOCRATIC_STAGE__` | ✅ | 真机读数：11 个键齐全（`version/React/subscribe/getSnapshot/screen/app/model/setExpressionDriver/driver/dispose/mouthSource`）、`getSnapshot()` 六个字段、`screen()='live'`、`app` 是活引用、`mouthSource().kind='text-cadence'` |
| **板书自动切屏**（`classroom_draw` 成功 → 2s 内切屏） | 🟡 | 判据与副作用单测覆盖（`test/20` 12 例：meta 优先／文本兜底／isError 不切／两者都没有不切）；**端到端未跑**——需要一个真实 LLM 回合真的调用 `classroom_draw`（见 §七之三） |
| **板书渲染失败兜底**（显示「这张图渲染失败」＋源码） | 🟡 | 代码路径 + 样式就位，未做端到端（同上：需要真实事件才能让 React 走进这个分支） |
| **情绪通道 + 表情驱动接线** | 🟡 | 路由与读法单测覆盖（`seq>after`／坏行跳过／文件不存在→空）；浏览器 250ms 轮询需 `running===true`，**端到端未跑**（引擎侧 `emotions.jsonl` 尚未有写入者） |
| 三态（直排／纸卡短答／纸卡给选项） | 🟡 | 纸卡与六态样式已就位；**由谁裁决三态**（相位 vs 长度）仍按顶层口径（交给 AI） |

### ★ 六态样张怎么看（真机验证造型用）

```
http://127.0.0.1:<port>/?token=<本次 token>#stagegallery=1
```
🔴 **开关必须走 hash（`#stagegallery=1`）或 localStorage（`stage-warm:gallery=1`），不能走 query** ——
宿主接管 URL 时会把 `?token=…` **连同我们自己的 query 一起抹掉**，模块加载那一刻 `location.search` 已经是空串（实测踩过，见下条铁律）。

---

## 五 · 素材

`assets/stage/` 5 张 PNG（教室广角／夜／老师／两位学生），来源是本项目**自产的生成素材**
（样稿目录 `code/mockups/stage-modern/assets/gen/`），不是任何原作解包物。

> 📌 参照物 Avalon 皮肤**不含任何图像／音频**（`.gitignore` 明写 `skin/assets/*`），
> 它的视觉要靠使用者从原著解包产物自行装配 —— 所以我们**借它的骨架与机制，不借它的皮**。
> 详见 `docs/历史报告/实测_Avalon皮肤装载链路_2026-09-30.md`。

---

## 五之三 · 2026-10-20 新增：K0 挂载点 / 板书闭环 / 情绪与口型（**读这一段就知道缝在哪**）

### 1. K0 · `window.__SOCRATIC_STAGE__`（给独立表情驱动模块用的唯一入口）

浏览器半边是闭包，`module.exports` 不上 window，所以表情驱动模块（另一个 .js）拿不到 React / store / PIXI。
舞台在根组件上开出这个全局对象，字段与纪律逐条照契约 K0：

| 字段 | 语义 |
|---|---|
| `version` | `1` |
| `React` | 宿主下发的那一份（**不另引**） |
| `subscribe(fn)` | 只读订阅，返回 unsubscribe；`store.set` 后调用 |
| `getSnapshot()` | `{ sessionId, running, title, messages, hasChatHook, phase }` —— **`phase` 恒 `null`**：相位在引擎侧，舞台看不到，这里如实留空、不编值 |
| `screen()` | `'live' \| 'board'`（驱动只读，不许自己切屏） |
| `app` | **活引用**（getter）：Live2D 未就绪时为 `null`，应用重建后自动是新实例 |
| `model()` | 当前 `PIXI.Live2D` 模型，可能 `null` |
| `setExpressionDriver(driver)` | 唯一写入口：`{ drive(state, ctx), dispose?() }` 或 `null`；换驱动会**先** dispose 旧的；非法对象按 `null` 处理（交还静态待机） |
| `driver()` | 只读：当前注册的驱动（舞台自己的帧循环用） |
| `mouthSource()` | **契约 K0 之外的加法**：当前口型源（见下 §3）。只增不改，不影响 X 车道按 K0 写的代码 |
| `dispose()` | 顺序写死：① `driver.dispose()` ② 清引用 ③ 摘全局键 |

- **挂载/销毁时机**：舞台根 mount 时建、`killed`（Ctrl+Shift+M）或卸载时 `delete`。
  「关掉再打开」实测：关 → 键消失、PIXI 应用销毁；开 → 键回来、应用重建（`canvas` 仍 1 个，不泄漏）。
- **帧循环归舞台**：驱动**不必**自己往 `app.ticker` 上挂东西 —— 舞台在 app 创建时挂一条 ticker，
  每帧调 `driver.drive({ active, dt }, bridge)`（`dt` 单位是**秒**）。app 销毁 ⇒ ticker 一起死。
  驱动若仍想自己挂 ticker，请在 `dispose()` 里摘干净：舞台保证在 app 销毁**之前**调它。
- `active` 由舞台从情绪通道算：拿到事件 → `{label, intensity}`；**4 秒**没有新事件 → `null`
  （`EMOTION_HOLD_MS`；这是引擎侧情绪引擎接进来之前的舞台侧兜底，不是最终形态）。
- **新模块的加载**：`ensureStageModule(file[, subdir])`（复用 `loadOneScript`，默认目录 `assets/l2d/`，
  失败不缓存、可重试）。**不要**把新模块塞进 `listLibs()` 的 phases —— 那段被 `if (!window.PIXI) throw`
  整段门控，Live2D 一挂会连累别的模块（`check.sh` 第 7d 组会挡）。

### 2. 板书闭环（契约 K2）

**宿主半边**（`lib/index.js`，全部 loopback-only、全部 try/catch 兜底）：

| 路由 | 返回 |
|---|---|
| `GET /stage-board/diagrams/<id>` | `text/plain` —— 那张图的 mermaid 源码 |
| `GET /stage-board/diagrams` | `{ items: [ { id, lesson, turn, kind, title, time, file, session } ] }`，时间倒序 |
| `GET /stage-board/emotions?after=<seq>` | `{ events, nextSeq }` —— 只回 `seq > after`；**文件不存在回 `{events:[],nextSeq:0}`，不 500** |
| `GET /stage-board/health` | 归因用：教室目录、解析来源、试过哪些候选、图/情绪条数 |

- **根目录**：`<工作区>/classrooms/<教室>/runtime/diagrams/`。教室目录按**有序候选**解析：
  ① `settings.workspaceRoot` ② 宿主 `workspaceRegistry` 登记的每个 path ③ `process.cwd()`；
  每条都要求磁盘上真有这个目录（`<候选>/classrooms/<教室>/` 或候选本身就是教室目录）。
  两个新设置项：`classroom`（默认 `cs-os`）、`workspaceRoot`（默认空＝自动）。
  **找不到就一路 404 并带上 `tried`**，不静默编一个路径。
- **拒绝规则**（`test/21` 逐条测）：id 必须 `^[A-Za-z0-9_-]+$`；`decodeURIComponent` 之后仍须匹配；
  `path.resolve` 后父目录必须**就是**根；`realpathSync` 后仍须在根内（防符号链接）。
  任一不满足 → **400**（不是 500）；缺文件 → 404；非 GET → 405。
  实测：`%2e%2e%2f..%2fetc%2fpasswd`、`..%2Fclassroom.yaml`、`a%2Fb`、`a.b` 全部 400。
- **`items` 的形状**：契约七字段（`id/lesson/turn/kind/title/time/file`）＋ 2026-10-20 引擎侧新增的
  **`session`**（索引表格末尾多了一列「会话」；老索引没有这列 → 空串，不把整条判坏）。
  解析**按表头名取列**，不按固定下标 —— 列序被打乱也认（`test/21` 有乱序表头用例）。

**浏览器半边**：

- 判据（契约 K2.3）：`kind==='tool-result' && name==='classroom_draw' && isError!==true`；
  id 先取 `meta.board.id`，否则从 `content` 文本里抓 `\n[board] id=… lesson=… turn=… kind=…`；
  两者都没有 → **不切屏**，只记一条 warn（`pushWarning`，会进 `/stage-static/health` 的 warnings）。
- 行为（K2.4）：命中 → 播拉出节拍切板书屏并渲染**这一张**；学生发下一句 → 反向节拍收起；
  已在板书屏又来一张 → **直接替换、不重播**；渲染失败 → 屏上「这张图渲染失败」＋源码；
  手动「板书」按钮保留（有图看最新那张，没图退回老的静态场景 L03）。
- **舞台关着时画了图 → 不自动打开**（只进历史）：`killed` 时那条 effect 直接 return；
  另外"挂载时已经存在的板书"不会被当成新事件（刷新页面先看 live 屏）。

### 3. mermaid 从哪来（**取舍写在这里**）

- **决定：复制进本包 `assets/l2d/mermaid.min.js`**（逐字节复制自 `clients/classroom-ui/vendor/mermaid-11.17.2/`，
  sha256 两处相同，`check.sh` 第五组会核）。
- 否决「跨插件引用」的理由：舞台不能依赖"另一个插件恰好装着"——面板没装、换版本、vendor 改名，
  板书屏立刻白屏，而且这种依赖不在 `package.json` 里、不可机核。仓库成本≈0（git 按 blob 去重，只存一份）。
- 否决「启动就装」的理由：3.5 MB，只有真画了图才需要 ⇒ **按需加载**（`ensureMermaid()` 只装一次）。
- 渲染配置：`securityLevel:'strict'`（源码来自模型，不许注入脚本/事件）、`theme:'base'` ＋ 暖纸主题变量。
- **插进画布前先归一化**（`normalizeMermaidSvg`，纯函数、有单测）：去掉 mermaid 内联的
  `style="max-width:<图宽>px"` 与 `width/height` 属性、补 `preserveAspectRatio="xMidYMid meet"`，
  尺寸交给 `.bp-canvas svg{width:100%;height:100%}`。
  **不这么做**的实测后果：840px 的画布只画出 343px 宽的图（内联 max-width 把它钉住了）。

### 4. 情绪通道与口型（C-s 的舞台侧，本阶段不接音频）

- **情绪**：`<教室>/runtime/emotions.jsonl`（K1.4）。舞台只在「页面在前台 **且** `running===true`」时
  每 **250ms** 拉一次 `GET /stage-board/emotions?after=<本地游标>`；用完 `nextSeq` 更新游标；
  失败只等下一拍（不重试、不排队、不堆积）。拿到事件 → `active` → 交给驱动。
- **口型源是抽象**（`createTextCadenceMouth()`）：三件套 `feed(text, done)` / `advance(dtMs)` / `current()`。
  本阶段实现的是「纸带逐字显现的节奏」：按 14 字/秒推进"已显现字数"，还有字要出就按 5.2 音节/秒摆开合，
  **一句显示完 `open` 归 0（闭嘴）**；单帧推进上限 250ms（切后台回来不会一帧跳完整句）。
  将来接音频：写一个 `createAudioMouth()` 实现同样三件套、换掉 `mouthRef.current` 即可，混合层不动。
- **动作层 vs 表情层**：动作仍是原来的（`running→thinking` / `teacher→speak` / `you→thinkend` / 否则 idle）；
  **表情层**：有驱动时舞台**完全不碰** `model.expression()`，没有驱动时用原来的静态待机表情。

### 5. 角色名/教室名从数据读（**不写死**）

舞台左上那个短册原来硬编码 `小 鞠 知 花 · 在场`（角色其实早换成「鲸」）。现在：
名字来自 manifest 的 `classroom.teacher.name`，宿主读的是
`classroom.yaml` 里 `layer: persona` 那块声明的**角色卡文件**，取其表格行 `| 名字 | … |`
（没有就退回该文件的 H1，去掉 `·` 之后的部分）；纸带署名取"短名"（`鲸（DeepSeek 娘）` → `鲸`）。
**全都读不到**时：短册只显示「在场」、署名显示「老师」——绝不回落到任何写死的人名。

## 五之二 · 新人走查记录（2026-09-30 实测，照本 README 从零走一遍）

| 步骤 | 结果 | 卡点 |
|---|---|---|
| `./check.sh`（离线） | ✅ 退出码 0，20 项全绿 | 无 |
| `PORT=4497 ./check.sh --live` | ✅ 退出码 0，24 项全绿（含真机 4 项） | 无（跑完自清隔离根、不留服务器） |
| §一 手工建隔离 profile | ✅ bundles 三件齐、插件装上、预检 exit 0 | 🔴 **`--from-default-profile` 会顺手把 web 应用起起来** → 必须 `&` + `sleep 12` + `kill %1`（已写进 §一） |

---

## 六 · 自检脚本（`test/`）

全部是 Playwright 脚本，**工作目录必须 = 项目根**（`playwright` 装在项目根的 node_modules）。

```bash
cd <项目根>
node <本包>/test/03-probe-boot-errors.cjs   "http://127.0.0.1:4400/?token=<本次 token>"  # boot 有没有失败
node <本包>/test/08-probe-hit-test.cjs      "…?token=…"                                  # 输入框点得到吗
node <本包>/test/09-flow-submit.cjs         "…?token=…" "测试消息"                        # 端到端送出一条
```

- `01` 截图 ＋ 收集三类报错 ｜ `02` 打印槽位清单与输入框 DOM ｜ `03` 完整 boot 报错原文
- `04` 绘制证据（几何 ＋ 图元 ＋ 像素采样） ｜ `05` CSS 规则是否命中 ｜ `06` outerHTML/属性
- `07` 逐层隐藏做遮挡归因 ｜ `08` `elementFromPoint` 命中测试 ｜ `09` 端到端提交

---

## 七之三 · 真机验收怎么跑（2026-10-20 的实测口径，含一个必踩的坑）

```bash
# 1) 隔离根（别碰在用的桌面 profile）
cp -cR "$HOME/Library/Application Support/dsh-desktop/harness/profiles" /tmp/siso/
export DSH_HOME=/tmp/siso

# 2) 起服：**cwd 决定教室目录的解析结果**（见 §五之三.2 的候选顺序）
cd <仓库根> && dsh --profile stageverify --port 4510 --no-open
#   → 输出里有 http://127.0.0.1:4510/?token=…（每次重启都变）

# 3) Playwright 脚本（工作目录无所谓，playwright 是全局装的）
NODE_PATH=/opt/homebrew/lib/node_modules node test/14-verify-pullout.cjs "http://127.0.0.1:4510/?token=$T#stagegallery=1"
```

🔴 **headless Playwright 默认没有 WebGL**：PIXI 6 创建渲染器会抛
`WebGL unsupported in this browser`，于是 Live2D 走降级（`data-l2d=off` + 静态 PNG）。
要在无头环境里看真模型，启动 Chromium 时加三个参数：

```js
chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader',
                         '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
```
加上之后实测：`webgl = "WebGL 2.0 (OpenGL ES 3.0 Chromium) | WebKit WebGL"`、canvas backing store 399×546、
模型真的画出来。**不加参数时看到的"空 canvas"不是舞台的 bug**（曾因此误判过一轮）。

## 七 · 出处

- 契约取证（座目录／标准 kit／快照结构／种子模块白名单）：见项目根的会话记录与
  `` 下 2026-09-30 的实测件
- 装载链路与三层保险：`docs/历史报告/实测_Avalon皮肤装载链路_2026-09-30.md`
- 样式令牌与逐条 CSS：`docs/架构/规格_舞台样式令牌_2026-09-30.md`
