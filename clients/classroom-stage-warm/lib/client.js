/**
 * classroom-stage-warm —— SocraticNovel「教室舞台」· **浏览器半边**
 * ==========================================================================
 * 手工编写的 `__ModuleLoader__` bundle（无构建步骤、无 npm 依赖）。
 * 只 `require` 外壳播种的种子模块（白名单 9 项，冻结）：
 *   `react` / `react/jsx-runtime` / `react-dom` / `react-dom/client` /
 *   `@deepseek-ai/cordis` / `dsh-client-store` / `dsh-client-ui-slots` /
 *   `dsh-client-ui-primitives` / `dsh-client-ui-dockkit`
 * 本包只用其中三个（react / react/jsx-runtime / react-dom/client）。
 *
 * ── 形态（已定稿）──────────────────────────────────────────────────────
 * **整屏接管**，落点 = **自建容器挂到 `document.body`**，与 DSH 插槽系统解耦：
 *   · ❌ 不注册进 `root`（**single 槽**：第二个注册者会**顶掉整个 AppFrame**）
 *   · ❌ 不注册进 `shell.overlay`（该座一次 render 抛错会被 `SlotErrorBoundary`
 *        **永久**变成崩溃占位 —— 逃生门和被救的对象一起死）
 *   · ❌ 不注册进 `conversation.view`（**一次只渲染一个**，注册 ≠ 上屏，需要用户切过去）
 *   · ✅ 只在 `conversation.input.right`（**list / session 作用域 / 无占位人**）里放一个
 *        **渲染 null 的传感器**，它把会话数据写进共享 store；舞台根（挂在 body 上）订阅 store。
 *
 * ── 层级 ──────────────────────────────────────────────────────────────
 * 舞台根 `z-index:1080`（**在所有应用内容之上、DSH 浮层 1100 之下**）；根节点 `pointer-events:none`，
 * 交互元素各自显式 `auto`。`position:fixed; inset:0`（**不能用 100%**：宿主那层是可程序化滚动的）。
 * 🔴 **该层级必须写在根节点那个 div 上**（实测踩过）：挂载容器 `#stage-warm-root` 是个普通 div
 *    （`position:static`、在 body 流末、高度 0），若把类只给它的子节点，整屏那层就没有定位上下文，
 *    子件的 `absolute` 会相对**初始包含块**落位 —— 看着"位置对"，实际是运气。
 * 🔴 **为什么不是 900**（实测踩过两次）：整屏层要盖住的是**整块应用内容**，而应用里有大量
 *    命中测试在零层级上的原生件（如空会话的 hero 输入卡 `uV2eYG_hero`）——取 900 时
 *    `document.elementFromPoint()` 在舞台输入框中心**命中的是原生件**，点不到我们的输入框。
 *    Avalon 取 900 是它自己的选择，我们**跟着取 900 会被它和原生件一起盖住**。
 *    取 **1080**：在所有应用内容之上，仍在 DSH 浮层 1100 之下（弹窗/菜单/菜单之外的东西仍然可用）。
 *
 * ── 逃生门（关闭出口不在任何插槽里）─────────────────────────────────────
 * `Ctrl+Shift+M` 就地关闭 ／ `Ctrl+Shift+U` 恢复 ／ 地址栏 `?stage=on|off`。
 * 关闭时连 DSH 错误边界留下的崩溃占位一起清掉。
 *
 * ── ★★ 四条铁律（都是别人踩过的坑，别改坏）────────────────────────────
 * ① **hooks 全部集中在上半段、排在任何 `return` 之前**；禁 `useX ? useX() : y`
 *    —— 设置是异步到达的瞬时状态，条件 hook 会抛 React #310（Rendered more hooks…）。
 * ② **只用 `React.createElement`，不用 `jsxRuntime.jsx` 传 children**
 *    —— 外壳播种的 `jsx` 只吃两个参数，**变长 children 被静默丢弃**（不报错、元素照建、就是没内容）。
 * ③ **服务一律用 `ctx.get(name)`，不读 `ctx.<service>` 属性**
 *    —— 未声明 inject 时属性读取会抛（`cannot get property … without inject`）。
 * ④ **读会话必须走 `chat.order` + `chat.nodes.get(key)`**；`legacy.nodes` 只当兜底，
 *    且**去重键绝不能退化成数组下标**（否则同一节点画两遍）。工具调用在 DSH 里**有两个节点**
 *    （`assistant-step.data.blocks` 里一份 ＋ 独立 `tool-call` 节点），要按 `callId` 去重。
 *
 * 出处：契约取证见 `` 下 2026-09-30 的实测与规格件。
 * ==========================================================================
 */

window.__ModuleLoader__.load({
  id: 'classroom-stage-warm',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const ReactDOMClient = require('react-dom/client')

    const H = React.createElement
    const BUILD_ID = 'stage-warm-v0.1.0'
    const ROUTE = '/stage-static'
    /** 板书闭环与情绪通道的宿主路由前缀（契约 K2.2、K1.4）。 */
    const BOARD_ROUTE = '/stage-board'
    /** 情绪通道轮询间隔（契约 K1.4：250ms，不做长轮询）。 */
    const EMOTION_POLL_MS = 250
    /** 一条情绪事件的有效期：超过它就回落到"平静"（情绪引擎接进来之前的舞台侧兜底）。 */
    const EMOTION_HOLD_MS = 4000
    const KILL_KEY = 'stage-warm:kill'
    const ROOT_ID = 'stage-warm-root'

    /**
     * 降级/异常记录（模块级，**不是** apply() 里的局部变量）。
     *
     * 🔴 2026-10-20 修：原来只有 `apply()` 里有一个 `const warnings = []`，而
     * `StageRoot` 的 Live2D effect 的 catch 里也写了 `warnings.push(...)` ——
     * 那个作用域里 `warnings` **根本不存在**，于是 catch 自身抛
     * `ReferenceError: warnings is not defined`，**把降级路径整个吃掉**：
     * `setL2dFailed(true)` 永远不执行 → 立绘不出现也不回落静态图，页面上只留下一个
     * 320×150 的空 canvas。真机实测（隔离 profile + Playwright）就是这个症状。
     * 教训：**catch 里只许调用一定存在的函数**。
     */
    const warnings = []

    function pushWarning(msg) {
      try {
        const s = String(msg).slice(0, 400)
        warnings.push(s)
        if (warnings.length > 40) warnings.shift()
        // 留一条能看见的痕迹：真机归因时比"什么都没有"强得多
        try { console.info('[stage-warm] ' + s) } catch { /* ignore */ }
      } catch { /* ignore */ }
    }

    // ======================================================================
    // §1 CSS —— 暖纸令牌（取自样稿 avalon-warm.html；固定画布的 px 换成视口相对量）
    // ======================================================================
    const CSS = `
.stage-warm-root{position:fixed;inset:0;z-index:1080;pointer-events:none;overflow:hidden;
  --paper:#F3E9DA;--paper2:#EADCC8;--paper3:#DFCEB4;
  --ink:#2A211A;--ink2:#6B5B4A;--ink3:#9C8B77;--ink4:#B9A992;
  --accent:#B84A1C;--accent2:#D9772C;--gilt:#C2861F;--vermilion:#E0921C;
  --night:#141A20;--night2:#1E262E;
  --hair:rgba(42,33,26,.14);--hair2:rgba(42,33,26,.07);
  --hair-w:rgba(243,233,218,.16);--hair-w2:rgba(243,233,218,.08);
  --sans:-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  --serif:"Songti SC","Source Han Serif SC","Noto Serif CJK SC",Georgia,serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-family:var(--sans);-webkit-font-smoothing:antialiased;color:var(--paper)}
.stage-warm-root *{box-sizing:border-box;font-weight:400}
.stage-warm-root .grain::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:99;
  background:repeating-linear-gradient(45deg,rgba(255,255,255,.012) 0 2px,transparent 2px 5px)}
.stage-warm-root .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
.stage-warm-root .bgfallback{position:absolute;inset:0;z-index:0;background:#161B22}
.stage-warm-root .veil{position:absolute;inset:0;z-index:1;
  background:linear-gradient(to bottom,rgba(8,10,14,.40) 0%,rgba(8,10,14,.10) 42%,rgba(8,10,14,0) 100%)}
.stage-warm-root .corner{position:absolute;width:8.8vh;height:8.8vh;pointer-events:none;opacity:.88;z-index:6;
  filter:drop-shadow(0 1px 3px rgba(20,16,12,.52))}
.stage-warm-root .corner svg{width:100%;height:100%;display:block;overflow:visible}
.stage-warm-root .corner path,.stage-warm-root .corner circle{fill:none;stroke:var(--gilt);
  stroke-linecap:round;stroke-linejoin:round}
.stage-warm-root .corner path:nth-child(1){stroke-width:2.2}
.stage-warm-root .corner path:nth-child(2){stroke-width:1.2;opacity:.65}
.stage-warm-root .corner path:nth-child(n+3){stroke-width:1.65}
.stage-warm-root .corner.tl{left:2.2vh;top:2.2vh}
.stage-warm-root .corner.br{right:2.2vh;bottom:2.2vh;transform:scale(-1,-1)}
.stage-warm-root .topbar{position:absolute;left:0;right:0;top:0;height:9.6vh;z-index:7;
  display:flex;align-items:center;justify-content:space-between;padding:0 4.2vh;
  opacity:0;transition:opacity 240ms ease}
.stage-warm-root[data-chrome="on"] .topbar{opacity:1}
.stage-warm-root .tb-lft{display:flex;align-items:baseline;gap:2.4vh;min-width:0}
.stage-warm-root .cn{font-size:1.8vh;letter-spacing:.14em;color:#F3E9DA;text-shadow:0 1px 12px rgba(0,0,0,.6);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw}
.stage-warm-root .no{font-family:var(--mono);font-size:1.24vh;letter-spacing:.10em;color:rgba(243,233,218,.55);flex:none}
.stage-warm-root .tools{display:flex;gap:.9vh;pointer-events:auto}
.stage-warm-root .tool{border:1px solid var(--hair-w);background:rgba(243,233,218,.08);backdrop-filter:blur(10px);
  color:#F3E9DA;border-radius:999px;padding:.9vh 2.1vh;font-size:1.5vh;letter-spacing:.04em;cursor:pointer;
  transition:background 160ms,border-color 160ms}
.stage-warm-root .tool:hover{background:rgba(243,233,218,.18);border-color:rgba(243,233,218,.42)}
.stage-warm-root .cast{position:absolute;right:6.8vh;bottom:44vh;height:54vh;z-index:3;pointer-events:none;
  /* 🔴 2026-10-19 改（立绘换成半身像后）：原来是 bottom:34vh / height:74vh —— 那是给「全身立绘」的，
     全身图被纸带盖掉腿正好；换成半身（膝上）后同样的数会把躯干压到纸带下面，只剩一个头。
     半身像要**贴纸带上沿**：纸带 48vh，所以 bottom 取 47vh（略嵌 1vh 免得悬空），高度取 52vh。 */
  filter:drop-shadow(0 -6px 34px rgba(0,0,0,.42))}
.stage-warm-root .cast-strip{position:absolute;right:4.2vh;top:9.6vh;z-index:7;display:flex;flex-direction:column;
  gap:.8vh;align-items:flex-end;opacity:0;transition:opacity 240ms ease}
.stage-warm-root[data-chrome="on"] .cast-strip{opacity:1}
.stage-warm-root .cast-chip{font-family:var(--mono);font-size:1.15vh;letter-spacing:.16em;color:rgba(243,233,218,.55);
  border:1px solid var(--hair-w);border-radius:999px;padding:.5vh 1.3vh;background:rgba(20,26,32,.42)}
.stage-warm-root .cast-chip.on{color:#F3E9DA;border-color:rgba(185,139,58,.6)}
.stage-warm-root .band{position:absolute;left:0;right:0;bottom:0;height:48vh;z-index:5;background:var(--paper);color:var(--ink)}
.stage-warm-root .band-top{position:absolute;left:0;right:0;top:0;height:1px;background:var(--gilt);opacity:.55}
.stage-warm-root .band-top::after{content:'';position:absolute;left:50%;top:-4px;width:8px;height:8px;margin-left:-4px;
  background:var(--paper);border:1px solid var(--gilt);transform:rotate(45deg)}
.stage-warm-root .band-core{position:absolute;left:0;right:0;top:1px;bottom:11vh;padding:4.2vh 8.8vh 0;
  overflow-y:auto;scrollbar-width:thin;
  /* 默认过渡：任何相位切换（含收起）都别硬跳；拉出段在下面被覆写成 .39s */
  transition:opacity .22s,transform .22s,filter .22s;
  display:flex;flex-direction:column;justify-content:flex-start}
/* 🔴 2026-10-19：原来用 justify-content:flex-end 实现内容贴底，但 flex-end ＋ overflow:auto
   有个经典问题：内容一旦超出容器，上半部分会被裁掉且滚不到（实测老师一段 376 字的话，
   正文区只剩最后几行，上面整段看不见）。
   改成 flex-start ＋ 第一个子元素 margin-top:auto —— 内容少时照样贴底，内容多时能正常滚到顶部。
   （注：CSS 模板串里不许出现裸反引号，注释里也不要写，会把模板串提前结束。） */
.stage-warm-root .band-core > .line:first-child,
.stage-warm-root .band-core > .empty:first-child{margin-top:auto}
.stage-warm-root .band-core .line{flex:none}
.stage-warm-root .band-core::-webkit-scrollbar{width:6px}
.stage-warm-root .band-core::-webkit-scrollbar-thumb{background:var(--ink4);border-radius:3px}
.stage-warm-root .who{display:flex;align-items:center;gap:1.1vh;margin-bottom:1.8vh}
.stage-warm-root .who .bar{width:2.2vh;height:1px;background:var(--accent);flex:none}
.stage-warm-root .who .nm{font-size:1.4vh;letter-spacing:.24em;color:var(--accent);font-family:var(--mono)}
.stage-warm-root .line{margin:0;font-family:var(--serif);color:var(--ink);font-size:3.24vh;line-height:1.70;
  letter-spacing:.005em;text-wrap:pretty;max-width:66vw;white-space:pre-wrap}
.stage-warm-root .line + .line{margin-top:1.85vh}
.stage-warm-root .line.narr{color:var(--ink2);font-size:2.78vh}
.stage-warm-root .line.past{color:var(--ink3)}
.stage-warm-root .line.cur{color:var(--ink)}          /* 当前老师句：正常墨色（与 past 的浅色拉开） */
/* 旧句与当前句之间一条发丝线（真品阅读态的做法：当前句独占下方一块） */
.stage-warm-root .line + .line.past{margin-top:1.2vh}
.stage-warm-root .line.past + .line:not(.past){margin-top:2.4vh;padding-top:2.2vh;position:relative}
.stage-warm-root .line.past + .line:not(.past)::before{content:'';position:absolute;left:0;right:0;top:0;
  height:1px;background:var(--hair)}
.stage-warm-root .line.you{color:var(--accent)}
.stage-warm-root .adv{display:inline-block;width:2.2vh;height:2px;background:var(--accent);margin-left:1.5vh;
  vertical-align:.75vh;animation:stage-grow 1.5s ease-in-out infinite}
@keyframes stage-grow{0%,100%{width:1.3vh;opacity:.7}50%{width:2.8vh;opacity:1}}
.stage-warm-root .empty{font-family:var(--serif);font-size:2.6vh;color:var(--ink3)}
.stage-warm-root .tline{margin:1.6vh 0 0;font-family:var(--mono);font-size:1.15vh;letter-spacing:.08em;color:var(--ink4)}
.stage-warm-root .composer{position:absolute;left:8.8vh;right:8.8vh;bottom:2.9vh;display:flex;align-items:flex-end;
  gap:1.7vh;border-top:1px solid var(--hair);padding-top:1.7vh;pointer-events:auto}
.stage-warm-root .composer textarea{flex:1;min-width:0;background:transparent;border:0;outline:none;resize:none;
  font-family:var(--sans);font-size:1.85vh;line-height:1.5;color:var(--ink);max-height:11vh;overflow-y:auto;
  height:3.2vh}
.stage-warm-root .composer textarea::placeholder{color:var(--ink3)}
.stage-warm-root .composer .hint{font-family:var(--mono);font-size:1.1vh;letter-spacing:.10em;color:var(--ink3);
  flex:none;padding-bottom:.6vh}
.stage-warm-root .composer .send{border:0;background:var(--ink);color:var(--paper);border-radius:999px;
  padding:1.1vh 2.6vh;font-size:1.5vh;letter-spacing:.06em;cursor:pointer;flex:none;transition:background 160ms}
.stage-warm-root .composer .send:hover{background:#000}
.stage-warm-root .composer .send[disabled]{background:var(--ink4);cursor:default}
.stage-warm-root .banner{position:fixed;right:2.4vh;bottom:2.4vh;z-index:1200;pointer-events:auto;
  display:flex;align-items:center;gap:1.4vh;padding:1.3vh 1.9vh;border-radius:999px;
  background:rgba(20,26,32,.94);border:1px solid rgba(185,139,58,.5);color:#F3E9DA;
  font-family:var(--mono);font-size:1.2vh;letter-spacing:.08em;box-shadow:0 8px 30px rgba(0,0,0,.4)}
.stage-warm-root .banner button{border:1px solid var(--hair-w);background:transparent;color:#F3E9DA;
  border-radius:999px;padding:.7vh 1.6vh;font-size:1.2vh;cursor:pointer}
.stage-warm-root .banner button:hover{background:rgba(243,233,218,.16)}

/* ★ 来源：avalon-warm.html 的 2026-09-30 追加块，已机核通过（12-verify-mockup-s5.cjs） */
/* ══════════════════════════════════════════════════════════════════════
   ★ 2026-09-30 追加：按「真·魔夜 UI」补的造型（对比件见 对比_真魔夜UI_vs_暖纸舞台）
   ①②③ 三条为已定案实现：白板屏内嵌 ／ 面板从角色身后拉出 ／ 选项卡片六态
   🔴 只做"造型"这一半：色系仍是暖纸，不搬青绿发光与深色斜纹
   ※ 移植换算：纵向尺寸与字号 → vh；横向尺寸优先 vh；1px 边线/发丝线/圆角半径保持 px
   ══════════════════════════════════════════════════════════════════════ */

/* ⓪ · 叶形分隔带：正文与选项之间，一叶居中 + 双侧波浪蔓延 + 极细渐变发丝线 */
.stage-warm-root .leaf-sep{display:flex;align-items:center;justify-content:center;gap:1.0vh;margin:0.8vh 0 0.5vh;color:var(--accent);opacity:.82}
.stage-warm-root .leaf-sep .sep-line{flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(184,74,28,.30),transparent)}
.stage-warm-root .leaf-band{width:12vh;height:1.95vh;flex:none;overflow:visible}
.stage-warm-root .leaf-band path{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.4}
.stage-warm-root .leaf-band .leaf-mid{stroke-width:1;opacity:.6}

/* ① · 分节抬头：对称波浪括号 + 菱形（真品的 ~选项 I~ 语汇，换暖棕） */
.stage-warm-root .orn{display:flex;align-items:center;justify-content:center;gap:0.95vh;margin-bottom:0.8vh}
.stage-warm-root .orn svg{width:4.25vh;height:2.04vh;flex:none;overflow:visible}
.stage-warm-root .orn-wave{width:10.5vh;height:3.2vh;flex:none;overflow:visible;color:var(--gilt)}
.stage-warm-root .orn-wave path{fill:none;stroke:currentColor;stroke-width:1.9;
  stroke-linecap:round;stroke-linejoin:round}
.stage-warm-root .orn svg path,.stage-warm-root .orn svg circle{fill:none;stroke:rgba(194,134,31,.95);stroke-width:1.6}
.stage-warm-root .orn .tx{font-family:var(--serif);font-size:2.13vh;letter-spacing:.30em;color:var(--ink2)}
.stage-warm-root .orn .dm{width:0.65vh;height:0.65vh;background:var(--gilt);transform:rotate(45deg);flex:none;opacity:.9}

/* ② · 选项卡片：两端括号花饰 + 圆角描边 + 渐变面 + 波纹 + 六态
      状态机：未选 / hover / 当前(键盘焦点) / 已选 / 已选·本次发送 / 禁用 */
.stage-warm-root .opts{display:flex;flex-direction:column;gap:0.45vh;margin-top:0.1vh;
  padding:0 3.9vh}
.stage-warm-root .oc{position:relative;display:flex;align-items:center;gap:1.5vh;height:4.45vh;padding:0 1.85vh;
  /* 🔴 2026-10-19：舞台根是 pointer-events:none，交互元素必须各自显式打开 ——
     这一条漏了，导致选项卡片**渲染出来但点不动**（实测点击后 .oc.picked.sent 计数恒为 0）。 */
  pointer-events:auto;
  border:2px solid var(--hair-w);border-radius:10px;cursor:pointer;
  background:
    linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,0) 46%,rgba(0,0,0,.10)),
    repeating-linear-gradient(172deg,rgba(255,255,255,.022) 0 1px,transparent 1px 0.65vh),
    #4A3C31;
  box-shadow:inset 0 0 0 1px rgba(243,233,218,.05),0 0 0 rgba(185,139,58,0);
  transition:background 180ms,border-color 180ms,box-shadow 220ms,transform 180ms}
/* 两端卷草端饰：真品语汇是「竖双柱 ＋ 三卷须 ＋ 中横羽」，用 SVG 画（伪元素的 border 拼不出曲线）
   默认态设为透明（消除六行连排齿链感，仅保留活跃态 cur/hover/picked 作为织边羽翼） */
.stage-warm-root .oe{position:absolute;top:50%;width:2.65vh;height:4.1vh;margin-top:-2.05vh;
  color:rgba(194,134,31,.92);opacity:0;pointer-events:none;transition:opacity 180ms,color 180ms}
.stage-warm-root .oe.l{left:-2.95vh}
.stage-warm-root .oe.r{right:-2.95vh;transform:scaleX(-1)}
.stage-warm-root .oe svg{display:block;width:100%;height:100%;overflow:visible}
.stage-warm-root .oe path{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round}
.stage-warm-root .oe path:nth-child(1){stroke-width:1.8}
.stage-warm-root .oe path:nth-child(2){stroke-width:1.1;opacity:.55}
.stage-warm-root .oe path:nth-child(n+3){stroke-width:1.4}
.stage-warm-root .oc .no{font-family:var(--mono);font-size:1.2vh;letter-spacing:.06em;color:rgba(224,146,28,1);
  flex:none;width:2.04vh}
.stage-warm-root .oc .tx{flex:1;font-family:var(--serif);font-size:1.94vh;letter-spacing:.03em;
  color:rgba(248,240,229,.92);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stage-warm-root .oc .go{font-family:var(--mono);font-size:1.02vh;letter-spacing:.12em;color:rgba(243,233,218,.52);
  flex:none;opacity:0;transition:opacity 180ms}

/* hover：抬起来一点点（真品 selecting 态就是"更亮 + 更浮"） */
.stage-warm-root .oc:hover{border-color:rgba(217,119,44,.75);transform:translateX(3px);
  background:
    linear-gradient(180deg,rgba(255,255,255,.085),rgba(255,255,255,0) 46%,rgba(0,0,0,.08)),
    repeating-linear-gradient(172deg,rgba(255,255,255,.032) 0 1px,transparent 1px 0.65vh),
    #56453A}
.stage-warm-root .oc:hover .tx{color:#FFF8EE}
.stage-warm-root .oc:hover .go{opacity:1}
.stage-warm-root .oc:hover .oe{opacity:.92}

/* 当前（键盘焦点）：菱形指示 + 赭色边（**主信号是指示器，不是色差** —— 沿用审核件的裁定） */
.stage-warm-root .oc.cur{border-color:rgba(224,146,28,.95);
  box-shadow:inset 0 0 0 1px rgba(224,146,28,.30),0 0 1.4vh rgba(224,146,28,.22)}
.stage-warm-root .oc.cur .tx{color:#FFF8EE}
.stage-warm-root .oc.cur .no::after{content:'';display:inline-block;width:0.46vh;height:0.46vh;margin-left:0.55vh;
  background:var(--vermilion);transform:rotate(45deg);vertical-align:0.2vh}
.stage-warm-root .oc.cur .oe{opacity:1;color:var(--vermilion)}

/* 已选：换材质（暖纸墨字），与"未选=夜色玻璃"拉开 —— 这是六态里的主差分 */
.stage-warm-root .oc{box-shadow:inset 0 0 0 1px rgba(243,233,218,.06)}
/* 已选：整行**反相**（深底浅字）——真品 selected 就是整格高亮，靠明暗反转拉开层次 */
.stage-warm-root .oc.picked{background:#3A2E25;border-color:rgba(224,146,28,.9);
  box-shadow:inset 0 0 0 1px rgba(224,146,28,.25),0 0 1.2vh rgba(224,146,28,.18)}
.stage-warm-root .oc.picked .no{color:rgba(224,146,28,.95)}
.stage-warm-root .oc.picked .tx{color:#FFF7EC}
.stage-warm-root .oc.picked .oe{opacity:.9;color:rgba(224,146,28,.95)}
/* 已选·本次发送：纸色更实 + 左端一枚赭色短横（真品 selected 那枚"更亮的收口"） */
.stage-warm-root .oc.picked.sent{background:linear-gradient(180deg,#C2521F,#B84A1C);border-color:#E0921C;
  box-shadow:0 0 0 2px rgba(224,146,28,.28),0 0 1.6vh rgba(224,146,28,.22)}
.stage-warm-root .oc.picked.sent .tx{color:#FFF7EC;letter-spacing:.05em}
.stage-warm-root .oc.disabled{opacity:.60;cursor:default;transform:none}
.stage-warm-root .oc.disabled:hover{transform:none;border-color:var(--hair-w)}

/* ③ · 纸卡短答 / 给选项：内外双线框（真品 archive_window_waku 的内凹边做法） */
.stage-warm-root .cardframe{position:relative;border:1px solid var(--hair);background:var(--paper);
  padding:2.95vh 4.8vh 2.4vh}
.stage-warm-root .cardframe::before{content:'';position:absolute;left:0.93vh;top:0.93vh;right:0.93vh;bottom:0.93vh;
  border:1px solid var(--hair);box-shadow:0 0 0 3px rgba(243,233,218,.6);pointer-events:none}
.stage-warm-root .cardframe::after{content:'';position:absolute;left:0;right:0;top:0;height:2px;
  background:var(--gilt);opacity:.85}

/* ④ · 正文行：正文用无衬线（真品正文就是硬边黑体感），选项/抬头仍走衬线 */
.stage-warm-root .band-core .line.sans{font-family:var(--sans);font-size:2.78vh;line-height:1.56;letter-spacing:.012em;
  text-shadow:0 1px 0 rgba(243,233,218,.85), 0 0 1px rgba(42,33,26,.30)}
.stage-warm-root .band-core .line.sans.narr{font-size:2.7vh;color:var(--ink2);
  text-shadow:0 1px 0 rgba(243,233,218,.75)}

/* ⑤ · 立绘入画：自下而上压暗，让立绘"落进"画面而不是贴上去 */
.stage-warm-root .cast-wrap{position:absolute;right:12.05vh;bottom:44vh;z-index:3;pointer-events:none}
/* Live2D 画布：与静态立绘同落点。canvas 的尺寸由 PIXI 按 CSS 盒子接管，这里给定宽高即可。 */
.stage-warm-root .cast-l2d{display:block;width:38vh;height:52vh;pointer-events:none}
.stage-warm-root .cast-wrap .cast{position:static;right:auto;bottom:auto;display:block}
.stage-warm-root .cast-wrap::after{content:'';position:absolute;left:-3.7vh;right:-3.7vh;bottom:0;height:34%;
  background:linear-gradient(to top,rgba(10,12,16,.66),rgba(10,12,16,.22) 46%,rgba(10,12,16,0));
  pointer-events:none}

/* ⑧ · 板书屏（已定案「白板＝舞台的一个屏」）：整屏变纸、藏立绘、正文让位
       依据真品：板书时不与正文抢画面（Avalon 模式是"逐屏"，不是"常驻栏"） */
.stage-warm-root[data-screen="board"] .veil{opacity:0;transition:opacity .3s}
.stage-warm-root[data-screen="board"] .cast-wrap{opacity:0;transition:opacity .25s}
.stage-warm-root[data-screen="board"] .band{height:30vh;transition:height .35s cubic-bezier(.22,.61,.36,1)}
.stage-warm-root[data-screen="board"] .band-core{bottom:11vh;opacity:.55}
.stage-warm-root[data-screen="board"] .boardpanel{width:80vh;height:58vh;left:50%;top:11vh;
  margin-left:-40vh;box-shadow:0 1.6vh 4vh rgba(10,12,16,.5)}
.stage-warm-root .boardpanel .bp-rev{font-family:var(--mono);font-size:1.05vh;letter-spacing:.14em;
  color:var(--ink3);margin-left:auto}
.stage-warm-root .boardpanel .bp-canvas{position:absolute;left:1.6vh;right:1.6vh;top:7.4vh;bottom:1.6vh;
  border:1px solid var(--hair);overflow:hidden}
/* mermaid 产出的 svg 带**内联** style="max-width:<图宽>px" 与 width/height 属性，
   直接塞进画布会按固有宽度把图钉死（实测：804px 的画布只画出 343px 宽）。
   做法不是用 !important 硬压 CSS，而是**插进去之前先把 svg 的尺寸归一化**
   （normalizeMermaidSvg：去掉内联 max-width 与宽高属性、显式 preserveAspectRatio=meet），
   尺寸完全交给下面这条规则 —— 这样"图铺满板且不变形"是可单测的行为，不靠层叠优先级博弈。
   （注：CSS 模板串里不许出现反引号，注释也一样 —— check.sh 第二组就查这个。） */
.stage-warm-root .boardpanel .bp-canvas svg{display:block;width:100%;height:100%}
.stage-warm-root .boardpanel .bp-note{margin-top:1.4vh;font-family:var(--mono);font-size:1.2vh;
  color:var(--ink3);letter-spacing:.06em}
.stage-warm-root .boardpanel .bp-body{position:absolute;left:0;right:0;top:5.4vh;bottom:0;padding:0}
/* mermaid 渲染失败时的兜底：一句人话 ＋ 图的源码（不白屏，契约 K2.4） */
.stage-warm-root .boardpanel .bp-fail{position:absolute;left:1.6vh;right:1.6vh;top:7.4vh;bottom:1.6vh;overflow:auto}
.stage-warm-root .boardpanel .bp-fail .why{font-family:var(--sans);font-size:1.95vh;color:var(--accent);margin-bottom:1.2vh}
.stage-warm-root .boardpanel .bp-fail pre{font-family:var(--mono);font-size:1.2vh;line-height:1.55;color:var(--ink2);
  white-space:pre-wrap;background:var(--paper2);border:1px solid var(--hair);padding:1.2vh;margin:0}

/* ⑨ · 动画屏（已定案：整屏放完自动回）
       铺满视口、盖住舞台其余部分；as-frame 是暖纸上的"放映框"（与纸卡同一套语汇） */
.stage-warm-root .animscr{position:absolute;inset:0;z-index:60;background:var(--night);
  display:flex;flex-direction:column;pointer-events:auto;animation:stage-anim-in .28s cubic-bezier(.22,.61,.36,1) both}
@keyframes stage-anim-in{from{opacity:0;transform:scale(1.015)}to{opacity:1;transform:none}}
.stage-warm-root .animscr .as-top{height:6.4vh;flex:none;display:flex;align-items:center;gap:1.2vh;
  padding:0 4.2vh;border-bottom:1px solid var(--hair-w)}
.stage-warm-root .animscr .as-top .dm{width:0.65vh;height:0.65vh;background:var(--gilt);transform:rotate(45deg);flex:none}
.stage-warm-root .animscr .as-top .as-tx{font-family:var(--mono);font-size:1.25vh;letter-spacing:.20em;color:rgba(243,233,218,.9)}
.stage-warm-root .animscr .as-top .as-esc{margin-left:auto;font-family:var(--mono);font-size:1.1vh;letter-spacing:.12em;color:rgba(243,233,218,.45)}
.stage-warm-root .animscr .as-frame{flex:1;min-height:0;margin:4.2vh;border:1px solid rgba(194,134,31,.55);
  background:#0B0E12;display:flex;align-items:center;justify-content:center;overflow:hidden}
.stage-warm-root .animscr .as-frame video{max-width:100%;max-height:100%;display:block}
.stage-warm-root .animscr .as-fallback{flex:1;display:flex;align-items:center;justify-content:center;
  font-family:var(--mono);font-size:1.5vh;color:rgba(243,233,218,.6)}

/* ⑦ · 面板「从角色身后拉出」（已定案：170/390/220ms ＋ 560→−24→0 ＋ 2.4° 倾斜）
       依据 pull-out.html 逐字：① 预备角色侧身（面板还没出现）② 拉出面板块 ③ 收尾回正
       🔴 面板 z 序**低于角色**（5 < 8），所以看起来是"角色把它拉出来" */
.stage-warm-root .boardpanel{position:absolute;left:5vh;top:9vh;width:62vh;height:52vh;z-index:5;
  background:var(--paper);border:1px solid var(--hair);border-left:2px solid var(--gilt);
  box-shadow:0 1.2vh 3.2vh rgba(10,12,16,.42);
  transform-origin:right center;transform:translateX(56vh) rotate(-2.4deg) scale(.94);opacity:0;
  pointer-events:auto;overflow:hidden}
.stage-warm-root .boardpanel .bp-top{height:5.2vh;display:flex;align-items:center;gap:1.2vh;
  padding:0 2.2vh;border-bottom:1px solid var(--hair)}
.stage-warm-root .boardpanel .bp-top .dm{width:0.65vh;height:0.65vh;background:var(--gilt);
  transform:rotate(45deg);flex:none}
.stage-warm-root .boardpanel .bp-top .bp-tx{font-family:var(--mono);font-size:1.2vh;
  letter-spacing:.22em;color:var(--accent)}
.stage-warm-root .boardpanel .bp-body{padding:2.6vh 3.2vh;font-family:var(--sans);
  font-size:2.05vh;line-height:1.72;color:var(--ink)}
.stage-warm-root .boardpanel .bp-body .k{color:var(--accent);font-family:var(--mono);
  font-size:1.75vh;letter-spacing:.06em}
/* 三段：先侧身（面板不动）→ 拉出（过冲）→ 回正 */
/* 三段时长逐字对对比件：--T1 170ms（角色侧身）／--T2 390ms（拉出）／--T3 220ms（收尾落定） */
.stage-warm-root .cast-wrap{transition:transform .17s cubic-bezier(.22,.61,.36,1),
  filter .17s cubic-bezier(.22,.61,.36,1)}
/* 角色侧身：对比件是 rotate(-1.6deg) translateX(-30px) scaleX(.965) scaleY(.995)；
   −30px 在 1080 高的画布上 = 2.78vh → 取 −3vh（视口单位，换分辨率不漂），缩放两轴分开写 */
.stage-warm-root[data-board="turn"] .cast-wrap{transform:rotate(-1.6deg) translateX(-3vh) scale(.965,.995)}
/* 收起＝反向节拍：面板沿原路滑出（对比件 closeBoard 用 --T2 390ms），随后整块离场 */
.stage-warm-root[data-board="turn"] .boardpanel{transition:transform .39s cubic-bezier(.16,1,.3,1),opacity .22s ease}
.stage-warm-root[data-board="pull"] .cast-wrap{transform:rotate(-1.2deg) translateX(-1.5vh) scale(.985)}
.stage-warm-root[data-board="settle"] .cast-wrap{transform:none}
.stage-warm-root[data-board="turn"] .boardpanel,
.stage-warm-root[data-board="pull"] .boardpanel,
.stage-warm-root[data-board="settle"] .boardpanel{opacity:1}
.stage-warm-root[data-board="turn"] .boardpanel{transform:translateX(56vh) rotate(-2.4deg) scale(.94)}
.stage-warm-root[data-board="pull"] .boardpanel{
  /* ← 过冲。**单位是「面板自身宽度的百分比」，不是 px 也不是 vh**：
     对比件（pull-out.html）过冲值是 −24px，而它的面板宽 1180px → 24/1180 = 2.03%（规格 §5.3 自己就换算过这一步）。
     取 % 的理由：① 百分比在 translateX 里按**元素自身宽**解析，换分辨率/换屏（板书屏把面板从 62vh 放大到 80vh）都不漂；
     ② 与对比件的定义同源（它本来就是「板宽的百分之几」）；③ 原来写的 −2.2vh ≈ 3.5% 板宽，比对比件冲过头 ~1.7 倍。 */
  transform:translateX(-2.03%) rotate(.5deg) scale(1.012);
  transition:transform .39s cubic-bezier(.16,1,.3,1),opacity .39s cubic-bezier(.16,1,.3,1)}
.stage-warm-root[data-board="settle"] .boardpanel{
  transform:translateX(0) rotate(0) scale(1);
  transition:transform .22s cubic-bezier(.22,1.12,.36,1),opacity .22s ease}
/* 拉出期间正文让位（真品：dock 变暗缩小） */
.stage-warm-root[data-board="pull"] .band-core{opacity:.42;transform:scale(.975);filter:blur(1.2px);
  transition:opacity .39s,transform .39s,filter .39s}
.stage-warm-root[data-board="settle"] .band-core{opacity:1;transform:none;filter:none;
  transition:opacity .22s,transform .22s,filter .22s}

/* ⑥ · 底部控件收拢：次要控件只在悬停时浮出（阅读态零 chrome 的延续） */
.stage-warm-root .quiet{opacity:0;transition:opacity 200ms;pointer-events:none}
.stage-warm-root .topbar:hover .quiet,.stage-warm-root .toolwrap:hover .quiet{opacity:1;pointer-events:auto}
`

    // ======================================================================
    // §2 共享 store —— 传感器写、舞台根读
    // ======================================================================
    const live = {
      sessionId: null,
      running: false,
      title: '',
      messages: [],
      hasChatHook: false,
    }
    // 发送面：**不进 store**（避免把宿主对象长期持有），由传感器在每次渲染时刷新
    const sendBox = { inputActions: null, sessionId: null }

    const store = {
      snapshot: Object.assign({}, live),
      listeners: new Set(),
      set(patch) {
        Object.assign(live, patch)
        this.snapshot = Object.assign({}, live)
        for (const fn of Array.from(this.listeners)) {
          try { fn() } catch { /* 单个订阅者坏掉不影响别人 */ }
        }
      },
      subscribe(fn) {
        this.listeners.add(fn)
        return () => { this.listeners.delete(fn) }
      },
      get() { return this.snapshot },
    }

    function useLive() {
      const [, force] = React.useState(0)
      React.useEffect(() => store.subscribe(() => force((n) => n + 1)), [])
      return store.get()
    }

    // ======================================================================
    // §3 会话数据解析
    // ======================================================================
    /**
     * 从一段老师正文里抽「选项」。**不是猜**：只认**明确的编号清单**这一种形状 ——
     *   `1. xxx` / `1、xxx` / `1) xxx` / `（1）xxx`（行首，1..6，逐条加号）
     * 抽到 ≥2 条才算选项；少于 2 条一律当作普通正文（避免把普通的"1."当成选项）。
     * 📌 为什么走这条：教室与引擎**目前都没有**选项字段（实测 grep 零命中），
     *    与其编一个字段，不如显式认一个形状 —— 形状不对就优雅退化，不产生幻觉选项。
     */
    function parseOptions(text) {
      try {
        const lines = String(text || '').split('\n')
        const hits = []
        // 🔴 两条分支各自带捕获组：只给"括号"那条加组会让 `1.` 这条匹配成功却拿不到编号
        //    （实测踩过：编号变 undefined → 连续性检查全废 → 选项一条都抽不出来）
        const re = /^\s*(?:[（(]?([1-6])[)）]|([1-6])[.、])\s*(.+?)\s*$/
        for (const l of lines) {
          const m = re.exec(l)
          if (m) {
            const idx = Number(m[1] != null ? m[1] : m[2])
            const body = String((m[3] != null ? m[3] : m[2]) || '').replace(/[*_`]/g, '').trim()
            if (idx === hits.length + 1 && body) hits.push(body)
          } else if (hits.length && !l.trim()) {
            /* 空行不打断 */
          } else if (hits.length) {
            break   // 清单结束
          }
        }
        return hits.length >= 2 ? hits.slice(0, 6) : []
      } catch { return [] }
    }

    /**
     * 把正文**末尾连续**的编号清单行裁掉。
     *
     * 为什么只裁末尾：舞台会把可解析的编号清单渲染成选项卡片，正文里那份就是重复显示
     * （实测同一个 1./2./3. 既在正文又在卡片里）。但正文**中间**的编号（教学步骤"第一步…
     * 第二步…"）是内容，不能动 —— 所以只从末尾往上连续匹配，遇到第一行不是编号就停。
     *
     * @param {string} text - 老师这一句的正文
     * @returns {string} 去掉末尾编号清单后的正文（全被裁则返回空串，由调用方决定怎么显示）
     */
    /**
     * 去掉正文里的 markdown 标记。
     *
     * 为什么需要：老师（LLM）输出常带 `**粗体**`、`*斜体*`、行首 `#` 之类，而纸带是按**纯文本**
     * 渲染的 —— 实测真机上出现 `**"……？"**` 这种星号裸露。本项目的排版纪律是「字重全部 400、
     * 靠字号字距层级，不靠加粗」，所以正确做法是**把标记去掉**，不是渲染成粗体。
     *
     * @param {string} text
     * @returns {string}
     */
    function stripMarkdown(text) {
      return String(text || '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')   // **粗体**
        .replace(/__([^_]+)__/g, '$1')          // __粗体__
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')  // *斜体*
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')     // 行首 # 标题
        .replace(/`([^`]+)`/g, '$1')            // 行内代码的反引号
    }

    function stripTrailingOptionList(text) {
      const src = String(text || '')
      if (!src) return src
      const lines = src.split('\n')
      const isOptionLine = (l) => /^\s*(?:\d{1,2}[.、)）]|[①②③④⑤⑥⑦⑧⑨])\s*\S/.test(l)
      let cut = lines.length
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i]
        if (l.trim() === '') { cut = i; continue }      // 允许清单与正文之间空行
        if (isOptionLine(l)) { cut = i; continue }
        break
      }
      if (cut >= lines.length) return src                 // 末尾不是清单，原样返回
      return lines.slice(0, cut).join('\n').trim()
    }

    /** 逐字依据：AssistantBlock = text | reasoning | image | tool-call | other */
    function classifyBlocks(blocks) {
      const texts = []
      const reasoning = []
      const tools = []
      const arr = Array.isArray(blocks) ? blocks : []
      for (const b of arr) {
        if (!b) continue
        if (typeof b === 'string') { texts.push(b); continue }
        const k = b.kind || b.type
        if (k === 'text' && typeof b.text === 'string') { texts.push(b.text); continue }
        if (k === 'reasoning' && typeof b.text === 'string') { reasoning.push(b.text); continue }
        if (k === 'tool-call') {
          const nm = b.name || 'tool'
          const cid = b.callId != null ? String(b.callId) : ''
          let dup = false
          for (const t of tools) {
            if (cid && t.cid === cid) { dup = true; break }
            if (!cid && t.name === nm) { dup = true; break }
          }
          if (!dup) tools.push({ name: nm, cid: cid, args: String(b.argsRaw || b.arguments || '').slice(0, 400) })
          continue
        }
        if (k === 'image') continue
        if (typeof b.text === 'string' && b.text) texts.push(b.text)
      }
      return { text: texts.join('\n').trim(), reasoning: reasoning.join('\n').trim(), tools }
    }

    /**
     * 读一条消息节点的文本。`user` 家族的载荷是 `content`（可能是 parts 数组）。
     */
    function readUserText(node) {
      try {
        const c = (node.data && (node.data.content || node.data.text)) || node.content
        if (typeof c === 'string') return c.trim()
        if (Array.isArray(c)) {
          const out = []
          for (const p of c) {
            if (typeof p === 'string') { out.push(p); continue }
            if (p && p.kind === 'text' && typeof p.text === 'string') { out.push(p.text); continue }
            if (p && p.type === 'text' && typeof p.text === 'string') { out.push(p.text); continue }
          }
          return out.join('\n').trim()
        }
      } catch { /* ignore */ }
      return ''
    }

    /** 认不出的 kind 一律跳过（绝不抛）。 */
    function readMessages(chat) {
      const out = []
      try {
        if (!chat || !chat.nodes || typeof chat.nodes.get !== 'function') return out
        const order = Array.isArray(chat.order) ? chat.order : []
        const seenToolCall = new Set()

        for (const key of order) {
          let node = null
          try { node = chat.nodes.get(key) } catch { node = null }
          if (!node) continue
          const kind = node.kind || node.type || ''
          const data = node.data || {}

          if (kind === 'assistant-step') {
            const c = classifyBlocks(data.blocks)
            // 步内工具去重（独立 tool-call 节点还会再报一次）
            for (const t of c.tools) if (t.cid) seenToolCall.add(t.cid)
            out.push({
              id: String(node.id || key || out.length),
              role: 'teacher',
              text: c.text,
              reasoning: c.reasoning,
              tools: c.tools,
              running: data.status === 'running',
            })
            continue
          }
          if (kind === 'user') {
            const text = readUserText(node)
            if (text) out.push({ id: String(node.id || key || out.length), role: 'you', text: text, reasoning: '', tools: [] })
            continue
          }
          if (kind === 'tool-call') {
            const root = data.root || {}
            const cid = String(root.callId || '')
            // 🔴 W2（2026-10-21）：板书信号的**真实入口**就在这一支 —— 0.2.1 把工具结果
            //    折进 `tool-call` 节点的 `data.root`（root.kind 才是 'tool-result'），
            //    外层根本没有独立的 tool-result 节点。所以先在这里判一次。
            //    顺序也很重要：**先推 board 条目，再做 callId 去重** —— 否则这个 call
            //    已经由 assistant-step 里画过时（seenToolCall 命中），切屏信号会被一起吞掉。
            const ev = boardEventOf(node)
            if (ev && ev.id) {
              out.push({
                id: String(node.id || key || ('board' + out.length)),
                role: 'board',
                text: '',
                reasoning: '',
                tools: [],
                board: ev,
              })
            } else if (ev && !ev.id) {
              // 两个来源都没给出 id：不切屏，只留一条 warn（契约 K2.3 第 3 条）
              pushWarning('classroom_draw 结果里没有 board id（meta.board.id 与 [board] 行都缺），不切屏')
            }
            if (cid && seenToolCall.has(cid)) continue      // 已在 assistant-step 里画过
            out.push({
              id: String(node.id || key || out.length),
              role: 'tool',
              text: String(root.name || root.kind || 'tool'),
              reasoning: '',
              tools: [{ name: String(root.name || 'tool'), cid: cid }],
            })
            continue
          }
          // 独立 `tool-result` 节点这一形状在 0.2.1 的 Chat 快照里不出现（见 boardEventOf 的注释），
          // 但契约 K2.3 写的就是这个形状 —— 留着，将来宿主改了形状也照样接得上。
          if (kind === 'tool-result') {
            const ev = boardEventOf(node)
            if (ev && ev.id) {
              out.push({
                id: String(node.id || key || ('board' + out.length)),
                role: 'board',
                text: '',
                reasoning: '',
                tools: [],
                board: ev,
              })
            } else if (ev && !ev.id) {
              // 两个来源都没给出 id：不切屏，只留一条 warn（契约 K2.3 第 3 条）
              pushWarning('classroom_draw 结果里没有 board id（meta.board.id 与 [board] 行都缺），不切屏')
            }
            continue
          }
          // 其余 kind（system-prompt / compaction / turn-error / steering / context …）本轮不画
        }

        // 流式中的那一段：挂在 legacy.partial 上，不在 nodes 里
        const partial = chat.legacy && chat.legacy.partial
        if (partial && Array.isArray(partial.blocks)) {
          const c = classifyBlocks(partial.blocks)
          if (c.text) {
            // 🔴 2026-10-19：同一段话曾整段渲染两遍（实测纸带里出现完全重复的两份）。
            //    成因是「节点已落盘」与「legacy.partial 流式段」同时被读到。
            //    判据用文本包含（任一方向），命中则不推第二次；真新内容照常推。
            let lastTeacher = null
            for (let k = out.length - 1; k >= 0; k--) {
              if (out[k].role === 'teacher') { lastTeacher = out[k]; break }
            }
            const dup = lastTeacher && (
              lastTeacher.text === c.text ||
              c.text.startsWith(lastTeacher.text) ||
              lastTeacher.text.startsWith(c.text)
            )
            if (!dup) {
              out.push({ id: 'partial', role: 'teacher', text: c.text, reasoning: c.reasoning, tools: [], running: true })
            }
          }
        }
        return out
      } catch {
        return out
      }
    }

    /** 标题：先问会话行，再退回工作区名 —— `SessionListState` 里**没有** `current` 字段。 */
    function titleOf(list, sessionId) {
      try {
        if (list && list.byId && sessionId && list.byId[sessionId]) {
          const row = list.byId[sessionId]
          return String(row.displayTitle || row.title || '')
        }
      } catch { /* ignore */ }
      return ''
    }

    // ======================================================================
    // §3.5 板书场景渲染（wire 格式 `whiteboard.scene.v1` → SVG 字符串）
    //   元素类型只有 5 种：text / rect / line / arrow / mermaid（见 classroom-ui/lib/whiteboard.mjs）
    //   🔴 这里**按 wire 格式自己渲染**，不 import 那个包 —— 宿主半边保持零依赖。
    //      少一个模块解析点，就少一条"profile 起不来"的可能。
    // ======================================================================
    /**
     * 纸带的 K1 防御性剥离。
     * 优先用 X 车道的 `window.__SOCRATIC_EMOTION_PARSE__`（K1.3 的同一台流式状态机，
     * 已穷举切分验证过）；模块没装/没加载完时退回舞台自带的 `stripEmotionMarkers`。
     * `final=false`（这条消息还在流式）时**不 flush**：半截标记先藏着，别让 `〔emo:sh` 闪一下。
     */
    function stripForTape(text, isFinal) {
      try {
        const p = window.__SOCRATIC_EMOTION_PARSE__
        if (p && typeof p.createEmotionStreamParser === 'function') {
          const parser = p.createEmotionStreamParser()
          const pushed = parser.push(String(text == null ? '' : text))
          if (!isFinal) return pushed.text
          const flushed = parser.flush()
          return pushed.text + flushed.text
        }
      } catch (e) { /* 落到自带实现 */ }
      return stripEmotionMarkers(text, { final: isFinal }).text
    }

    /**
     * 角色显示名的「短名」：`鲸（DeepSeek 娘）` → `鲸`。
     * 名字本身来自教室数据（见 manifest 的 classroom.teacher.name），这里只做排版取舍：
     * 纸带上的署名格只有 2.2vh 宽，放不下全名。取不到名字时用「老师」——
     * **不许**回落到任何写死的具体人名。
     */
    function teacherNameShort(name) {
      const n = String(name || '').trim()
      if (!n) return '老师'
      const cut = n.split(/[（(]/)[0].trim()
      return cut || n
    }

    function escSvg(v) {
      return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    }

    function renderSceneSvgString(scene) {
      try {
        const cv = scene.canvas || {}
        const W = Number(cv.width) || 1600
        const Hh = Number(cv.height) || 1000
        const bg = escSvg(cv.background || '#F3E9DA')
        const parts = []
        for (const el of (scene.elements || [])) {
          if (!el || !el.type) continue
          const t = el.type
          if (t === 'text') {
            const size = Number(el.fontSize) || 16
            const y = (Number(el.y) || 0) + size
            parts.push('<text x="' + (Number(el.x) || 0) + '" y="' + y + '" font-size="' + size +
              '" fill="' + escSvg(el.color || '#2A211A') + '">' + escSvg(el.text) + '</text>')
          } else if (t === 'rect') {
            parts.push('<rect x="' + (Number(el.x) || 0) + '" y="' + (Number(el.y) || 0) +
              '" width="' + (Number(el.w) || 0) + '" height="' + (Number(el.h) || 0) +
              '" rx="' + (Number(el.rx) || 0) + '" fill="' + escSvg(el.fill || 'none') +
              '" stroke="' + escSvg(el.stroke || '#B84A1C') + '" stroke-width="' + (Number(el.strokeWidth) || 2) + '"/>')
          } else if (t === 'line') {
            parts.push('<line x1="' + (Number(el.x1) || 0) + '" y1="' + (Number(el.y1) || 0) +
              '" x2="' + (Number(el.x2) || 0) + '" y2="' + (Number(el.y2) || 0) +
              '" stroke="' + escSvg(el.stroke || '#6B5B4A') + '" stroke-width="' + (Number(el.strokeWidth) || 2) + '"/>')
          } else if (t === 'arrow') {
            const c = escSvg(el.stroke || '#B84A1C')
            parts.push('<line x1="' + (Number(el.x1) || 0) + '" y1="' + (Number(el.y1) || 0) +
              '" x2="' + (Number(el.x2) || 0) + '" y2="' + (Number(el.y2) || 0) +
              '" stroke="' + c + '" stroke-width="' + (Number(el.strokeWidth) || 2) +
              '" marker-end="url(#stage-warm-arrow)"/>')
          } else if (t === 'mermaid') {
            parts.push('<rect x="' + (Number(el.x) || 0) + '" y="' + (Number(el.y) || 0) +
              '" width="' + (Number(el.w) || 0) + '" height="' + (Number(el.h) || 0) + '" rx="8" fill="#FBF3E6" stroke="#C2861F"/>' +
              '<text x="' + ((Number(el.x) || 0) + 14) + '" y="' + ((Number(el.y) || 0) + 30) +
              '" font-size="22" fill="#8A6A4A">mermaid（真渲染见 S7）</text>')
          }
        }
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + Hh + '" ' +
          'preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;background:' + bg + '">' +
          '<defs><marker id="stage-warm-arrow" viewBox="0 0 10 10" refX="8" refY="5" ' +
          'markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
          '<path d="M0,0 L10,5 L0,10 z" fill="#B84A1C"/></marker></defs>' +
          parts.join('') + '</svg>'
      } catch (err) {
        return '<div class="bp-note">场景渲染失败：' + escSvg(String((err && err.message) || err)) + '</div>'
      }
    }

    // ======================================================================
    // §3.6 纯函数区（K0 挂载点 / K1.3 防御性剥离 / K2.3 板书事件 / 口型源）
    //
    // 🔴 [STAGE-PURE-BEGIN] … [STAGE-PURE-END] 之间**只许放纯函数**：
    //    · 只依赖入参和 globalThis，**不引用本闭包里的任何变量**（store / live / ROUTE …）
    //    · 不碰 React / DOM / PIXI
    //    check.sh §7 把这一段逐字抽到 /tmp 变成 ESM 模块跑单测（test/20-stage-pure.mjs）。
    //    违反这条约束会立刻在单测里炸出来（ReferenceError），这正是要的：纯函数区不许长毛。
    // ======================================================================
  // ── [STAGE-PURE-BEGIN] ────────────────────────────────────────────────

  /**
   * K0 · 舞台的全局挂载点工厂。
   *
   * 为什么要有它：舞台的浏览器半边是一个闭包（`__ModuleLoader__.load({factory})`），
   * `module.exports` 与 `__test` 都**不上 window** —— 独立的「表情驱动模块」
   * （另一个 .js 文件，走 ensureStageModule 加载）拿不到 React / store / PIXI。
   * 所以在这里开一个稳定、只读、有明确销毁顺序的全局对象。
   *
   * 纪律（契约 K0 逐条）：
   *   · `subscribe/getSnapshot` 是**只读订阅**：驱动模块不改舞台 store
   *   · `screen()` 让驱动知道现在是 live 还是 board（它不许自己切屏）
   *   · `app` 是**活引用**（getter）：Live2D 未就绪／应用重建后自动反映最新值
   *   · `setExpressionDriver(driver)` 是唯一写入口；`null` ＝ 交还静态待机
   *   · `dispose()` 的顺序写死：**先** driver.dispose() → **再**摘全局
   *
   * @param {{global?:object, React:object, subscribe:Function, getSnapshot:Function,
   *          getScreen:Function, getApp:Function, getModel:Function, getMouthSource:Function}} deps
   */
  function createStageBridge(deps) {
    const d = deps || {}
    const g = d.global || globalThis
    const box = { driver: null }
    const api = {
      version: 1,
      React: d.React || null,
      /** 只读订阅：每次 store.set 后调用 fn()；返回 unsubscribe。 */
      subscribe: function (fn) { return d.subscribe(fn) },
      /** 只读快照：{ sessionId, running, title, messages, hasChatHook, phase } */
      getSnapshot: function () { return d.getSnapshot() },
      /** 舞台已解析出的屏幕状态：'live' | 'board'（驱动只读，不许切屏） */
      screen: function () { return d.getScreen() },
      /** 当前的口型源（可替换：将来接音频只换这个源，不动混合层） */
      mouthSource: function () { return d.getMouthSource() },
      /** 舞台当前注册的表情驱动（供舞台自己的帧循环取用；也便于单测断言） */
      driver: function () { return box.driver },
      /**
       * 注册表情驱动。`driver = { drive(state, ctx), dispose?() }` 或 `null`。
       * 传 null／不合法对象 ＝ 交回舞台的静态待机（现有动作层照常跑）。
       * 换驱动时**先把旧的 dispose 掉**（否则旧驱动挂在 app.ticker 上的回调会泄漏）。
       * @returns {object|null} 实际生效的驱动
       */
      setExpressionDriver: function (driver) {
        const prev = box.driver
        const next = (driver && typeof driver.drive === 'function') ? driver : null
        // 🔴 先落值再 dispose：驱动的 dispose() 里**会**回调 `setExpressionDriver(null)`
        //    （X 车道的模块就是这么写的）。若先 dispose 后落值，这次回调看到的 prev 还是旧驱动
        //    → 再 dispose 一次；没有幂等保护的驱动就会无限递归。先落值就没有这个环。
        box.driver = next
        if (prev && prev !== next && typeof prev.dispose === 'function') {
          try { prev.dispose() } catch (e) { /* 旧驱动清理失败不该拦住新驱动 */ }
        }
        if (typeof d.onDriverChange === 'function') {
          try { d.onDriverChange(next) } catch (e) { /* 舞台自己的回落逻辑失败不该拦住注册 */ }
        }
        return next
      },
      /**
       * 销毁：① 先 driver.dispose() ② 再清空引用 ③ 最后摘掉全局键。
       * 顺序反了会出现"驱动还在跑、舞台已经不在了"（它下一帧就去碰 null 的 app）。
       */
      dispose: function () {
        const drv = box.driver
        box.driver = null
        if (drv && typeof drv.dispose === 'function') {
          try { drv.dispose() } catch (e) { /* ignore */ }
        }
        if (g.__SOCRATIC_STAGE__ === api) {
          try { delete g.__SOCRATIC_STAGE__ } catch (e) { g.__SOCRATIC_STAGE__ = undefined }
        }
      },
    }
    // `app` 必须是活引用：Live2D 应用可能晚于挂载点创建，也可能被销毁重建
    Object.defineProperty(api, 'app', {
      enumerable: true,
      get: function () { return d.getApp() },
    })
    api.model = function () { return d.getModel() }
    return api
  }

  // ── K1.3 · 防御性剥离 ──────────────────────────────────────────────────
  // 正常路径下 `llm/stream` 已经剥净（契约 K1.2），这里只兜底：
  // 引擎没装／版本不匹配时，纸带不能把 `〔emo:shy:0.60〕` 原样显示出来。
  const EMO_LABELS = ['calm', 'happy', 'shy', 'puzzled', 'excited']
  const EMO_RE = /^〔emo:([a-z]+):(\d\.\d{2})〕$/
  /** 标记的开头 5 个字符（`〔` ＋ `emo:`）——先认这个前缀，再谈"整个标记剥掉"。 */
  const EMO_HEAD = '〔emo:'
  const SENTENCE_END = '。？！」…\n'

  /**
   * 剥掉情绪标记。**纯函数**（K1.3 的 push 语义，不是流式对象）。
   *
   * 规则逐条照 K1.3：
   *   1. 看到 `〔` 但还没有 `〕` → 这一段先不下传（`final=false` 时）；`final=true` 原样交回（宁可显示半截，不吞正文）
   *   2. 非法标签 / 强度越界 / 缺两位小数 → 整个标记剥掉，不发事件，不报错
   *   3. 一句（到 。？！… 或换行为止）多个标记 → 只认第一个，其余剥掉
   *
   * @param {string} text
   * @param {{final?:boolean}} [opts]
   * @returns {{text:string, events:Array<{label:string,intensity:number}>}}
   */
  function stripEmotionMarkers(text, opts) {
    const src = String(text == null ? '' : text)
    const isFinal = !!(opts && opts.final)
    const events = []
    let out = ''
    let i = 0
    let seenInSentence = false
    while (i < src.length) {
      const ch = src.charAt(i)
      if (ch === '〔') {
        // 🔴 只把 `〔emo:` 当标记开头。别的全角方括号（老师可能真用〔〕强调）原样保留 ——
        //    「防御性剥离」不该顺手吃掉正文；引擎侧的 K1.3 解析器负责"整个标记剥掉"那一半。
        if (src.substr(i, 5) !== EMO_HEAD) {
          const rest = src.slice(i)
          if (!isFinal && rest.length < EMO_HEAD.length && EMO_HEAD.indexOf(rest) === 0) break
          out += ch
          i += 1
          continue
        }
        const close = src.indexOf('〕', i + 1)
        if (close === -1) {
          if (isFinal) out += src.slice(i)   // 规则 1：flush 时仍不完整 → 原样交回
          break
        }
        const marker = src.slice(i, close + 1)
        const m = EMO_RE.exec(marker)
        if (m) {
          const label = m[1]
          const intensity = Number(m[2])
          const legal = EMO_LABELS.indexOf(label) !== -1 && intensity >= 0 && intensity <= 1
          if (legal && !seenInSentence) {
            events.push({ label: label, intensity: intensity })
            seenInSentence = true
          }
        }
        i = close + 1                        // 规则 2/3：合法与非法标记都从正文里剥掉
        continue
      }
      out += ch
      if (SENTENCE_END.indexOf(ch) !== -1) seenInSentence = false
      i += 1
    }
    return { text: out, events: events }
  }

  // ── K2.3 · 板书事件识别 ────────────────────────────────────────────────

  /** 把 Chat 节点的 `content`（数组 or 字符串）拼成纯文本。 */
  function contentTextOf(content) {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    const out = []
    for (const part of content) {
      if (typeof part === 'string') { out.push(part); continue }
      if (part && typeof part.text === 'string') out.push(part.text)
    }
    return out.join('\n')
  }

  /**
   * 一个 Chat 节点是不是「刚画完一张板书」的成功结果（契约 K2.3 的唯一判据）：
   *   `kind === 'tool-result' && name === 'classroom_draw' && isError !== true`
   * 命中后 id 的取法：① `meta.board.id` ② 文本里的 `[board] id=… lesson=… turn=… kind=…`
   * 都没有 → `{ id: null }`（调用方不切屏，只记一条 warn）。
   *
   * 🔴 2026-10-21（W2 真机定性，改的是取值路径不是判据）：0.2.1 的 Chat 快照里**不存在**
   *    独立的 `tool-result` 节点。工具结果被折进 **`tool-call` 节点**的 `data.root`，
   *    那个 root 才是 `{ kind:'tool-result', name, content, isError, meta, time, … }`
   *    （`dsh-client-ui-chat` 的 `rootResult()` 造的就是它，`buildViewNode` 再把它
   *    包成 `{ root }` 挂在 `tool-call` 节点上）。所以「是不是板书结果」认的是**结果对象**，
   *    不是外层节点的 kind —— 外层叫 `tool-call` 也照样命中（下面先找 `data.root` 就是为了这个）。
   *    真机实测：`getSnapshot().messages` 里只有 you / tool / teacher，正因为原来这条
   *    只认外层 `kind === 'tool-result'`，永远进不来。
   *
   * `time` = 事件时间（epoch ms），给「刷新的老图不自动弹」用（见 `shouldAutoOpenBoard`）。
   *
   * @returns {null | {id:string|null, lesson:number|null, turn:number|null, kind:string, time:number|null, from:'meta'|'text'|'none'}}
   */
  function boardEventOf(node) {
    if (!node || typeof node !== 'object') return null
    const root = (node.data && node.data.root) ? node.data.root : ((node.data && node.data.kind) ? node.data : node)
    const kind = root.kind || root.type || ''
    if (kind !== 'tool-result') return null
    if (String(root.name || '') !== 'classroom_draw') return null
    if (root.isError === true) return null
    const time = Number(root.time)
    const at = Number.isFinite(time) ? time : null
    const meta = root.meta
    const board = meta && meta.board
    if (board && typeof board.id === 'string' && board.id) {
      return {
        id: board.id,
        lesson: Number.isFinite(Number(board.lesson)) ? Number(board.lesson) : null,
        turn: Number.isFinite(Number(board.turn)) ? Number(board.turn) : null,
        kind: String(board.kind || ''),
        time: at,
        from: 'meta',
      }
    }
    const m = /\n\[board\] id=(\S+) lesson=(\d+) turn=(\d+) kind=(\S+)/.exec('\n' + contentTextOf(root.content))
    if (m) {
      return { id: m[1], lesson: Number(m[2]), turn: Number(m[3]), kind: m[4], time: at, from: 'text' }
    }
    return { id: null, lesson: null, turn: null, kind: '', time: at, from: 'none' }
  }

  /**
   * 「这张板书要不要自动切屏」——契约 K2.4 的**唯一**判定，纯函数。
   *
   * 三条都要成立：① 有 id；② 不是上一张已经处理过的（`seenId`）；
   * ③ 事件时间**不早于**挂载时刻（`mountedAt`）。
   *
   * 为什么要 ③：Chat 快照是**异步**到达的，刷新页面时历史里的板书会"晚一步出现"。
   * 只靠"首帧记下当前 id"挡不住它（首帧往往一条消息都还没有），结果就是**每次刷新都弹板书屏**。
   * 时间未知（老事件没带 `time`）时按**新事件**处理：宁可多弹一次，也不静默吞掉课上画的图。
   */
  function shouldAutoOpenBoard(mountedAt, seenId, board) {
    if (!board || !board.id) return false
    const id = String(board.id)
    if (id === seenId) return false
    const t = board.time
    // 只认真正的数字：`Number(null)===0`，用 Number() 转会把"没时间"当成 1970 年
    if (typeof t === 'number' && Number.isFinite(t)
      && typeof mountedAt === 'number' && Number.isFinite(mountedAt) && t < mountedAt) return false
    return true
  }

  /** 消息列表里最后一张有 id 的板书（没有就 null）。 */
  function latestBoardOf(messages) {
    const arr = Array.isArray(messages) ? messages : []
    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i] && arr[i].board
      if (b && b.id) return b
    }
    return null
  }

  // ── W-s · mermaid 产出的 svg 归一化 ─────────────────────────────────────
  /**
   * 把 mermaid 渲染出来的 svg 归一化成"装进画布"的形态。**纯函数**。
   *
   * 为什么需要：mermaid 的产物是
   *   `<svg id=… width="100%" style="max-width: 343px;" viewBox="0 0 343 454">`
   * 内联 max-width 会被层叠规则拿去跟 CSS 打架（不用 !important 就压不住），
   * 而 width/height 属性又会跟画布的 100% 冲突。与其在 CSS 里博弈，不如在**插入前**
   * 把这三样去掉、补上 preserveAspectRatio=meet —— 剩下的由画布的 width/height:100% 决定，
   * 图按比例居中，既不裁也不变形。
   *
   * @param {string} svg
   * @returns {string}
   */
  function normalizeMermaidSvg(svg) {
    let out = String(svg == null ? '' : svg)
    if (out.indexOf('<svg') === -1) return out
    // 只动开标签那一截（正文里可能有同样形状的字符串）
    const end = out.indexOf('>')
    if (end === -1) return out
    let head = out.slice(0, end + 1)
    const rest = out.slice(end + 1)
    head = head.replace(/\sstyle="[^"]*max-width[^"]*"/i, '')
    head = head.replace(/\swidth="[^"]*"/i, '')
    head = head.replace(/\sheight="[^"]*"/i, '')
    head = head.replace(/\spreserveAspectRatio="[^"]*"/i, '')
    head = head.replace(/<svg/i, '<svg preserveAspectRatio="xMidYMid meet"')
    return head + rest
  }

  // ── C · 口型源（本阶段没有音频：用「纸带逐字显现」的节奏）─────────────────
  /**
   * 口型源接口（可替换的三件套）：
   *   `feed(text, done)`  喂当前这句 + 是否已说完
   *   `advance(dtMs)`     推进时钟（舞台是唯一时钟持有者，别让驱动自己计时）
   *   `current()`         → `{ open: 0..1, speaking, revealed, total, kind }`
   * 将来接音频：换一个 `createAudioMouth()` 实现同样三件套即可，混合层不动。
   *
   * 「逐字显现」的节奏模型：按 `charsPerSecond` 推进"已显现字数"，还有字要出就按
   * `syllablesPerSecond` 摆开合；一句显示完（且已 done）→ `open` 归 0，嘴闭上。
   */
  function createTextCadenceMouth(opts) {
    const o = opts || {}
    const cps = Number.isFinite(o.charsPerSecond) && o.charsPerSecond > 0 ? o.charsPerSecond : 14
    const syll = Number.isFinite(o.syllablesPerSecond) && o.syllablesPerSecond > 0 ? o.syllablesPerSecond : 5.2
    const st = { text: '', done: false, revealed: 0, clock: 0, open: 0, speaking: false }
    return {
      kind: 'text-cadence',
      note: '本阶段无音频：口型由纸带逐字显现的节奏驱动，一句显示完即闭嘴',
      feed: function (text, done) {
        const t = String(text == null ? '' : text)
        if (t !== st.text) {
          st.revealed = Math.min(st.revealed, t.length)
          st.text = t
        }
        st.done = !!done
      },
      advance: function (dtMs) {
        const dt = Math.max(0, Math.min(Number(dtMs) || 0, 250))
        st.clock += dt
        if (st.text) st.revealed = Math.min(st.text.length, st.revealed + (cps / 1000) * dt)
        const pending = st.text.length - st.revealed
        if (!st.text || pending <= 0.5) {
          st.speaking = false
          st.open = 0
        } else {
          st.speaking = true
          const phase = (st.clock / 1000) * syll * Math.PI * 2
          st.open = 0.16 + 0.84 * Math.abs(Math.sin(phase))
        }
        return st.open
      },
      current: function () {
        return {
          kind: 'text-cadence',
          open: st.open,
          speaking: st.speaking,
          revealed: Math.floor(st.revealed),
          total: st.text.length,
        }
      },
      reset: function () {
        st.text = ''
        st.done = false
        st.revealed = 0
        st.clock = 0
        st.open = 0
        st.speaking = false
      },
    }
  }

  // ── [STAGE-PURE-END] ──────────────────────────────────────────────────

    // ======================================================================
    // §4 设置、素材与宿主报到
    // ======================================================================
    const DEFAULTS = { enabled: true, character: 'teacher', showSprite: true, showBand: true }

    function reportToHost(extra) {
      try {
        fetch(ROUTE + '/health', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.assign({ build: BUILD_ID, href: String(location.href).slice(0, 200) }, extra || {})),
        }).catch(() => {})
      } catch { /* ignore */ }
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Live2D 运行时加载（PIXI / Cubism Core / pixi-live2d-display）
    //
    //  做法照 `lrplrplrp/dsh-live2d`（MIT）的 20-libs.js：
    //   · 动态插 <script>，**必须显式 async=false** —— 默认 async 时谁先下完谁先执行，
    //     index.min.js 体积小会抢在 pixi 之前执行，而它在加载期就要用 PIXI → 报错。
    //   · 分两阶段：pixi 单独跑完，再并行其余三个。
    //   · 用 data 属性标记自己的 script，避免与别人插入的同名脚本混淆。
    // ══════════════════════════════════════════════════════════════════════
    let l2dLibsPromise = null
    let l2dLibsReady = false
    const L2D_MARK = 'data-stage-l2d-lib'

    function loadOneScript(url) {
      return new Promise(function (resolve, reject) {
        const existing = document.querySelector('script[' + L2D_MARK + '][src="' + url + '"]')
        if (existing) {
          if (existing.readyState === 'loaded' || existing.readyState === 'complete') { resolve(); return }
          existing.addEventListener('load', function () { resolve() }, { once: true })
          existing.addEventListener('error', function () { reject(new Error('load fail ' + url)) }, { once: true })
          return
        }
        const el = document.createElement('script')
        el.setAttribute(L2D_MARK, '')
        el.src = url
        el.async = false
        el.onload = function () { resolve() }
        el.onerror = function () { reject(new Error('load fail ' + url)) }
        document.head.appendChild(el)
      })
    }

    /**
     * 按阶段加载 Live2D 运行时。
     * @param {string[][]} phases - manifest 给的 lib 分组（第一组必须只有 pixi）
     * @returns {Promise<boolean>} 是否全部就绪
     */
    function ensureL2dLibs(phases) {
      if (l2dLibsReady) return Promise.resolve(true)
      if (l2dLibsPromise) return l2dLibsPromise
      l2dLibsPromise = (async function () {
        for (const phase of phases) {
          // 同一阶段内并行下载、按插入顺序执行
          await Promise.all(phase.map(function (f) { return loadOneScript(ROUTE + '/l2d/' + f) }))
        }
        if (!window.PIXI) throw new Error('PIXI 未就绪')
        l2dLibsReady = true
        return true
      })().catch(function (err) {
        l2dLibsPromise = null
        throw err
      })
      return l2dLibsPromise
    }

    /**
     * K0 · 第 5 条：**新增静态 JS 的独立加载通道**。
     *
     * 为什么不复用 `ensureL2dLibs(phases)`：`listLibs()` 的 phases 会被
     * `if (!window.PIXI) throw` 连带门控（第一组必须只有 pixi），而表情驱动模块 /
     * mermaid 与 Live2D 彼此独立 —— 塞进 phases 会让"Live2D 挂了"连累"板书渲染"。
     *
     * @param {string} file - 文件名（如 `mermaid.min.js`、`emotion-driver.js`）
     * @param {string} [subdir] - `assets/` 下的子目录，默认 `l2d`（X 车道的表情驱动模块放这里）
     * @returns {Promise<boolean>} 脚本执行完成即 resolve；失败可重试（不缓存失败）
     */
    const stageModulePromises = Object.create(null)
    function ensureStageModule(file, subdir) {
      const url = ROUTE + '/' + (subdir || 'l2d') + '/' + String(file)
      if (stageModulePromises[url]) return stageModulePromises[url]
      const p = loadOneScript(url).then(function () { return true }).catch(function (err) {
        delete stageModulePromises[url]     // 失败不缓存：网络抖一下还能重试
        throw err
      })
      stageModulePromises[url] = p
      return p
    }

    // ══════════════════════════════════════════════════════════════════════
    //  表情驱动模块（X 车道的产物，放在 assets/l2d/）
    //
    //  文件与职责（都不属于本车道，S 这边只负责**按序加载**并给它 K0 挂载点）：
    //   · vendor/soullink/soullink-engine.iife.min.js  → window.SoullinkEmotion（纯 engine）
    //   · stage-emotion-parse.js                       → window.__SOCRATIC_EMOTION_PARSE__（K1.3）
    //   · stage-emotion.js                             → window.__SOCRATIC_EMOTION__
    //       **它自己**轮询 K0 挂载点并调用 setExpressionDriver（S 不替它注册），
    //       找不到只 warn、不抛；Soullink engine 缺失时不接管（舞台回落静态待机，EC 要求）。
    //
    //  🔴 与 Live2D 库**分开加载**：任何一步失败都只 pushWarning，绝不连累立绘。
    //  🔴 不走 listLibs() 的 phases（契约 K0 第 5 条，check.sh 7d 会挡）。
    // ══════════════════════════════════════════════════════════════════════
    let emotionModulesPromise = null
    function ensureEmotionModules() {
      if (emotionModulesPromise) return emotionModulesPromise
      emotionModulesPromise = (async function () {
        const files = [
          'vendor/soullink/soullink-engine.iife.min.js',
          'stage-emotion-parse.js',
          'stage-emotion.js',
        ]
        for (const f of files) {
          try {
            await ensureStageModule(f, 'l2d')
          } catch (err) {
            pushWarning('表情驱动模块加载失败（' + f + '）：' + String((err && err.message) || err))
          }
        }
        return true
      })().catch(function (err) {
        emotionModulesPromise = null           // 允许重试
        pushWarning('表情驱动模块加载异常：' + String((err && err.message) || err))
        return false
      })
      return emotionModulesPromise
    }

    // ══════════════════════════════════════════════════════════════════════
    //  mermaid（板书屏真渲染）
    //
    //  来源：`clients/classroom-ui/vendor/mermaid-11.17.2/mermaid.min.js` 的**逐字节副本**，
    //  落在本包 `assets/l2d/mermaid.min.js`（见该目录 README 与 BUILD-INFO.txt）。
    //  为什么复制而不是跨插件引用：舞台不能依赖"另一个插件恰好装着"——classroom-ui 没装
    //  或换了目录，板书屏立刻白屏；而 git 对相同内容按 blob 去重，仓库里其实只有一份。
    //  为什么按需加载（不是启动就装）：3.5 MB，只有真画了图才需要。
    // ══════════════════════════════════════════════════════════════════════
    let mermaidReady = null
    const MERMAID_FILE = 'mermaid.min.js'

    function ensureMermaid() {
      if (mermaidReady) return mermaidReady
      const p = ensureStageModule(MERMAID_FILE).then(function () {
        const m = window.mermaid
        if (!m || typeof m.render !== 'function') throw new Error('mermaid 未就绪')
        try {
          m.initialize({
            startOnLoad: false,
            securityLevel: 'strict',   // 源码来自模型：不许它注入脚本/事件
            theme: 'base',
            fontFamily: '"Songti SC","Source Han Serif SC","Noto Serif CJK SC",Georgia,serif',
            themeVariables: {
              // 暖纸配色（与舞台令牌同源，见 §1）
              background: '#FBF3E6',
              primaryColor: '#F3E9DA',
              primaryTextColor: '#2A211A',
              primaryBorderColor: '#B84A1C',
              lineColor: '#6B5B4A',
              secondaryColor: '#EADCC8',
              tertiaryColor: '#FBF3E6',
            },
          })
        } catch (e) { /* initialize 失败也让 render 试一次（不同小版本的配置键会变） */ }
        return m
      }).catch(function (err) {
        mermaidReady = null
        throw err
      })
      mermaidReady = p
      return p
    }

    let diagramSeq = 0

    /**
     * 把一张图的 mermaid 源码渲染成 SVG 字符串。**任何失败都返回 ok:false**（板书屏据此
     * 显示「这张图渲染失败」＋源码，不白屏 —— 契约 K2.4）。
     */
    function renderMermaidSvg(source, id) {
      diagramSeq += 1
      const renderId = 'stage-bp-' + diagramSeq
      return ensureMermaid().then(function (m) {
        return m.render(renderId, String(source || ''))
      }).then(function (out) {
        const svg = out && typeof out === 'object' ? out.svg : out
        if (typeof svg !== 'string' || svg.indexOf('<svg') === -1) throw new Error('mermaid 没有返回 svg')
        return { ok: true, svg: normalizeMermaidSvg(svg), id: id }
      }).catch(function (err) {
        return { ok: false, id: id, error: String((err && err.message) || err) }
      })
    }

    /** 取一张板书的源码（宿主路由 `/stage-board/diagrams/<id>`，text/plain）。 */
    function fetchDiagramSource(id) {
      const url = BOARD_ROUTE + '/diagrams/' + encodeURIComponent(String(id))
      return fetch(url, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.text()
      })
    }

    function fetchJson(url) {
      try {
        return fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      } catch {
        return Promise.resolve(null)
      }
    }

    // ======================================================================
    // §5 逃生门（关闭出口挂在自建 DOM 上 ⇒ 插槽崩溃时仍然可用）
    // ======================================================================
    let killed = false
    try { killed = String(localStorage.getItem(KILL_KEY) || '') === '1' } catch { /* ignore */ }
    try {
      const p = new URLSearchParams(location.search).get('stage')
      if (p === 'off') { killed = true; try { localStorage.setItem(KILL_KEY, '1') } catch { /* ignore */ } }
      if (p === 'on') { killed = false; try { localStorage.removeItem(KILL_KEY) } catch { /* ignore */ } }
    } catch { /* ignore */ }

    function purgeSlotErrors() {
      try {
        for (const el of document.querySelectorAll('[data-slot-error]')) {
          try { el.remove() } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }

    function setKilled(v) {
      killed = !!v
      try { if (killed) localStorage.setItem(KILL_KEY, '1'); else localStorage.removeItem(KILL_KEY) } catch { /* ignore */ }
      try { render() } catch { /* ignore */ }
      reportToHost({ stage: killed ? 'killed' : 'restored' })
    }

    function installEscapeHatch() {
      const onKey = (e) => {
        try {
          if (!e.ctrlKey || !e.shiftKey) return
          const k = String(e.key || '').toLowerCase()
          if (k === 'm') { e.preventDefault(); purgeSlotErrors(); setKilled(true) }
          if (k === 'u') { e.preventDefault(); setKilled(false) }
        } catch { /* ignore */ }
      }
      try { window.addEventListener('keydown', onKey, true) } catch { /* ignore */ }
    }

    // ======================================================================
    // §6 传感器：注册进 conversation.input.right，渲染 null
    // ======================================================================
    /** 座名候选（按优先级）：第一个必须在**没被声明**时安全跳过。 */
    const SENSOR_SLOTS = ['conversation.input.right', 'conversation.input.left', 'conversation.view']

    function SessionSensor(props) {
      // 🔴 无条件调用（禁 `useX ? useX() : y`）—— 少算一个 hook = React #310
      const noSub = function () { return undefined }
      const useChat = props.useChat
      const useSession = props.useSession
      const useSessions = props.useSessions
      const sessionId = props.sessionId
      const inputActions = props.inputActions

      const chat = (useChat || noSub)(function (s) { return s })
      const session = (useSession || noSub)(function (s) { return s })
      const list = (useSessions || noSub)(function (s) { return s })

      const messages = React.useMemo(function () { return readMessages(chat) }, [chat])
      const title = React.useMemo(function () { return titleOf(list, sessionId) }, [list, sessionId])
      const running = !!(session && (session.running || session.streaming))

      React.useEffect(function () {
        if (inputActions) sendBox.inputActions = inputActions
        if (sessionId) sendBox.sessionId = sessionId
        store.set({
          sessionId: sessionId || null,
          running: running,
          title: title,
          messages: messages,
          hasChatHook: !!useChat,
        })
      }, [messages, title, running, sessionId, inputActions, useChat])

      return null
    }

    // ======================================================================
    // §7 舞台根
    // ======================================================================
  // ── 花饰构件（2026-10-17 增补：补「图形装饰 0 族」这个缺口）
  // 形状＝阿基米德螺旋密采样后转贝塞尔（见 ornaments/build-constants.mjs，可重生成）；
  // 颜色一律走 currentColor，由 CSS 决定；线宽在 CSS 里给。
  const END_TOP = 'M25,9 C24.7,9 23.4,8.7 23,9 C22.6,9.3 22.8,10.2 22.5,10.7 C22.3,11.2 22,11.7 21.6,12 C21.2,12.4 20.8,12.8 20.3,13 C19.9,13.3 19.4,13.4 18.9,13.5 C18.4,13.6 17.9,13.6 17.4,13.6 C16.9,13.5 16.5,13.3 16.1,13.1 C15.7,12.9 15.3,12.7 15,12.3 C14.7,12 14.4,11.7 14.2,11.3 C14,10.9 13.9,10.5 13.9,10.1 C13.8,9.8 13.8,9.4 13.9,9 C14,8.6 14.1,8.3 14.3,8 C14.4,7.7 14.7,7.4 14.9,7.2 C15.1,7 15.4,6.8 15.7,6.7 C16,6.5 16.3,6.5 16.6,6.5 C16.9,6.4 17.1,6.5 17.4,6.5 C17.7,6.6 17.9,6.7 18.1,6.9 C18.3,7 18.5,7.2 18.6,7.3 C18.7,7.5 18.8,7.7 18.9,7.9 C18.9,8.1 19,8.3 18.9,8.5 C18.9,8.7 18.9,8.9 18.8,9 C18.8,9.1 18.7,9.3 18.5,9.4 C18.4,9.5 18.3,9.6 18.2,9.6'
  const END_BOT = 'M25,41 C24.7,41 23.4,41.3 23,41 C22.6,40.7 22.8,39.8 22.5,39.3 C22.3,38.8 22,38.3 21.6,38 C21.2,37.6 20.8,37.2 20.3,37 C19.9,36.7 19.4,36.6 18.9,36.5 C18.4,36.4 17.9,36.4 17.4,36.4 C16.9,36.5 16.5,36.7 16.1,36.9 C15.7,37.1 15.3,37.3 15,37.7 C14.7,38 14.4,38.3 14.2,38.7 C14,39.1 13.9,39.5 13.9,39.9 C13.8,40.2 13.8,40.6 13.9,41 C14,41.4 14.1,41.7 14.3,42 C14.4,42.3 14.7,42.6 14.9,42.8 C15.1,43 15.4,43.2 15.7,43.3 C16,43.5 16.3,43.5 16.6,43.5 C16.9,43.6 17.1,43.5 17.4,43.5 C17.7,43.4 17.9,43.3 18.1,43.1 C18.3,43 18.5,42.8 18.6,42.7 C18.7,42.5 18.8,42.3 18.9,42.1 C18.9,41.9 19,41.7 18.9,41.5 C18.9,41.3 18.9,41.1 18.8,41 C18.8,40.9 18.7,40.7 18.5,40.6 C18.4,40.5 18.3,40.4 18.2,40.4'
  const END_MID = 'M25,25 C24.7,25 23.5,24.6 23,25 C22.5,25.4 22.6,26.9 22.2,27.6 C21.8,28.4 21.3,29.2 20.6,29.8 C20,30.4 19.3,30.9 18.5,31.2 C17.8,31.5 17,31.7 16.2,31.8 C15.4,31.8 14.6,31.7 13.9,31.5 C13.1,31.3 12.5,31 11.9,30.5 C11.3,30.1 10.8,29.6 10.4,29 C10,28.5 9.8,27.8 9.6,27.2 C9.5,26.6 9.4,25.9 9.5,25.3 C9.6,24.7 9.8,24.1 10,23.6 C10.3,23.1 10.6,22.6 11,22.3 C11.4,21.9 11.9,21.6 12.4,21.4 C12.8,21.2 13.3,21.1 13.8,21.1 C14.2,21.1 14.7,21.2 15.1,21.3 C15.5,21.5 15.9,21.7 16.2,21.9 C16.5,22.2 16.7,22.5 16.9,22.8 C17.1,23.1 17.2,23.5 17.2,23.8 C17.3,24.1 17.2,24.4 17.2,24.7 C17.1,25 17,25.3 16.8,25.5 C16.7,25.7 16.5,25.8 16.3,25.9 C16.1,26.1 15.9,26.1 15.7,26.1 C15.5,26.1 15.2,26.1 15.1,26'
  const CORNER_H = 'M12,12 C12.2,12 12.7,11.6 13,12 C13.3,12.4 13.3,13.5 13.6,14.1 C13.9,14.8 14.4,15.4 14.8,15.9 C15.3,16.4 15.9,16.8 16.5,17.2 C17,17.5 17.7,17.7 18.3,17.8 C18.9,17.9 19.6,17.9 20.2,17.8 C20.8,17.7 21.4,17.5 21.9,17.3 C22.4,17 22.9,16.6 23.3,16.3 C23.7,15.9 24,15.4 24.2,14.9 C24.5,14.5 24.6,13.9 24.7,13.5 C24.7,13 24.7,12.5 24.6,12 C24.5,11.5 24.4,11.1 24.1,10.7 C23.9,10.3 23.6,10 23.3,9.7 C23,9.5 22.7,9.2 22.3,9.1 C22,8.9 21.6,8.9 21.2,8.8 C20.9,8.8 20.5,8.9 20.2,9 C19.9,9 19.6,9.2 19.3,9.4 C19.1,9.5 18.9,9.8 18.7,10 C18.6,10.2 18.5,10.5 18.4,10.7 C18.4,10.9 18.3,11.2 18.4,11.4 C18.4,11.6 18.5,11.8 18.5,12 C18.6,12.2 18.8,12.3 18.9,12.4 C19,12.5 19.2,12.6 19.3,12.6'
  const CORNER_V = 'M12,12 C12,12.2 11.6,12.7 12,13 C12.4,13.3 13.5,13.3 14.1,13.6 C14.8,13.9 15.4,14.4 15.9,14.8 C16.4,15.3 16.8,15.9 17.2,16.5 C17.5,17 17.7,17.7 17.8,18.3 C17.9,18.9 17.9,19.6 17.8,20.2 C17.7,20.8 17.5,21.4 17.3,21.9 C17,22.4 16.6,22.9 16.3,23.3 C15.9,23.7 15.4,24 14.9,24.2 C14.5,24.5 13.9,24.6 13.5,24.7 C13,24.7 12.5,24.7 12,24.6 C11.5,24.5 11.1,24.4 10.7,24.1 C10.3,23.9 10,23.6 9.7,23.3 C9.5,23 9.2,22.7 9.1,22.3 C8.9,22 8.9,21.6 8.8,21.2 C8.8,20.9 8.9,20.5 9,20.2 C9,19.9 9.2,19.6 9.4,19.3 C9.5,19.1 9.8,18.9 10,18.7 C10.2,18.6 10.5,18.5 10.7,18.4 C10.9,18.4 11.2,18.3 11.4,18.4 C11.6,18.4 11.8,18.5 12,18.5 C12.2,18.6 12.3,18.8 12.4,18.9 C12.5,19 12.6,19.2 12.6,19.3'
  const WAVE_TOP = 'M4,8 C4.8,8.1 7.1,8.4 8.7,8.6 C10.2,8.9 11.8,9.1 13.3,9.2 C14.9,9.4 16.4,9.5 18,9.5 C19.6,9.5 21.1,9.4 22.7,9.3 C24.2,9.1 25.8,8.9 27.3,8.6 C28.9,8.3 30.4,7.9 32,7.6 C33.6,7.3 35.1,6.9 36.7,6.6 C38.2,6.3 39.8,6 41.3,5.9 C42.9,5.7 44.4,5.7 46,5.8 C47.6,5.9 49.1,6.1 50.7,6.4 C52.2,6.7 53.8,7.2 55.3,7.6 C56.9,8.1 58.4,8.7 60,9.1 C61.6,9.6 63.1,10.1 64.7,10.4 C66.2,10.7 67.8,11 69.3,11 C70.9,11.1 72.4,11 74,10.8 C75.6,10.5 77.1,10.1 78.7,9.6 C80.2,9.1 81.8,8.4 83.3,7.8 C84.9,7.1 87.2,6.2 88,5.9'
  const WAVE_BOT = 'M4,18 C4.8,18.1 7.1,18.4 8.7,18.6 C10.2,18.9 11.8,19.1 13.3,19.2 C14.9,19.4 16.4,19.5 18,19.5 C19.6,19.5 21.1,19.4 22.7,19.3 C24.2,19.1 25.8,18.9 27.3,18.6 C28.9,18.3 30.4,17.9 32,17.6 C33.6,17.3 35.1,16.9 36.7,16.6 C38.2,16.3 39.8,16 41.3,15.9 C42.9,15.7 44.4,15.7 46,15.8 C47.6,15.9 49.1,16.1 50.7,16.4 C52.2,16.7 53.8,17.2 55.3,17.6 C56.9,18.1 58.4,18.7 60,19.1 C61.6,19.6 63.1,20.1 64.7,20.4 C66.2,20.7 67.8,21 69.3,21 C70.9,21.1 72.4,21 74,20.8 C75.6,20.5 77.1,20.1 78.7,19.6 C80.2,19.1 81.8,18.4 83.3,17.8 C84.9,17.1 87.2,16.2 88,15.9'
  const WAVE_TAIL = 'M90,13 C90.2,13 90.8,13.2 91,13 C91.2,12.8 91.2,12 91.4,11.5 C91.6,11 91.9,10.6 92.2,10.2 C92.5,9.9 92.9,9.6 93.3,9.3 C93.7,9.1 94.1,8.9 94.6,8.7 C95,8.6 95.4,8.6 95.9,8.6 C96.3,8.6 96.7,8.6 97.1,8.8 C97.5,8.9 97.9,9.1 98.2,9.3 C98.5,9.5 98.8,9.8 99,10.1 C99.3,10.4 99.4,10.7 99.6,11 C99.7,11.3 99.8,11.7 99.8,12 C99.8,12.4 99.8,12.7 99.8,13 C99.7,13.3 99.6,13.6 99.4,13.9 C99.3,14.1 99.1,14.3 98.9,14.5 C98.7,14.7 98.5,14.9 98.2,15 C98,15.1 97.7,15.2 97.5,15.2 C97.3,15.2 97,15.2 96.8,15.2 C96.6,15.2 96.4,15.1 96.2,15 C96,14.9 95.9,14.8 95.7,14.7 C95.6,14.5 95.5,14.4 95.4,14.2 C95.4,14.1 95.3,13.9 95.3,13.8 C95.3,13.6 95.3,13.5 95.3,13.3 C95.4,13.2 95.5,13.1 95.5,13'
  const LEAF_BAND_L = 'M68,13 C67.4,13 65.7,13 64.6,13 C63.5,13.1 62.3,13.1 61.2,13.2 C60.1,13.2 58.9,13.3 57.8,13.3 C56.7,13.4 55.5,13.4 54.4,13.5 C53.3,13.5 52.1,13.6 51,13.6 C49.9,13.6 48.7,13.6 47.6,13.6 C46.5,13.6 45.3,13.6 44.2,13.6 C43.1,13.5 41.9,13.4 40.8,13.4 C39.7,13.3 38.5,13.2 37.4,13 C36.3,12.9 35.1,12.8 34,12.6 C32.9,12.5 31.7,12.3 30.6,12.2 C29.5,12.1 28.3,11.9 27.2,11.8 C26.1,11.7 24.9,11.6 23.8,11.5 C22.7,11.4 21.5,11.3 20.4,11.3 C19.3,11.3 18.1,11.3 17,11.4 C15.9,11.5 14.7,11.6 13.6,11.7 C12.5,11.8 11.3,12 10.2,12.2 C9.1,12.4 7.9,12.6 6.8,12.9 C5.7,13.1 4.5,13.4 3.4,13.6 C2.3,13.9 0.6,14.3 0,14.4'
  const LEAF_BAND_R = 'M92,13 C92.6,13 94.3,13 95.4,13 C96.5,13.1 97.7,13.1 98.8,13.2 C99.9,13.2 101.1,13.3 102.2,13.3 C103.3,13.4 104.5,13.4 105.6,13.5 C106.7,13.5 107.9,13.6 109,13.6 C110.1,13.6 111.3,13.6 112.4,13.6 C113.5,13.6 114.7,13.6 115.8,13.6 C116.9,13.5 118.1,13.4 119.2,13.4 C120.3,13.3 121.5,13.2 122.6,13 C123.7,12.9 124.9,12.8 126,12.6 C127.1,12.5 128.3,12.3 129.4,12.2 C130.5,12.1 131.7,11.9 132.8,11.8 C133.9,11.7 135.1,11.6 136.2,11.5 C137.3,11.4 138.5,11.3 139.6,11.3 C140.7,11.3 141.9,11.3 143,11.4 C144.1,11.5 145.3,11.6 146.4,11.7 C147.5,11.8 148.7,12 149.8,12.2 C150.9,12.4 152.1,12.6 153.2,12.9 C154.3,13.1 155.5,13.4 156.6,13.6 C157.7,13.9 159.4,14.3 160,14.4'

  // 端饰：竖双柱 ＋ 三卷须 ＋ 中横羽（左右镜像用 scaleX(-1)）
  const ORN_END = (tag) => H('svg', { key: tag, viewBox: '0 0 32 50', className: 'orn-end' },
    H('path', { d: 'M25.6 2 L25.6 48' }),
    H('path', { d: 'M30 5 L30 45' }),
    H('path', { d: END_TOP }),
    H('path', { d: END_BOT }),
    H('path', { d: END_MID }),
    H('path', { d: 'M25 25 L17 25' }))

  // 抬头括号：双平行波浪 ＋ 远端收卷
  const ORN_WAVE = (mirror) => H('svg', {
    key: mirror ? 'wv-r' : 'wv-l', viewBox: '0 0 58 26', className: 'orn-wave',
    style: mirror ? { transform: 'scaleX(-1)' } : undefined,
  },
    H('path', { d: WAVE_TOP }),
    H('path', { d: WAVE_BOT }),
    H('path', { d: WAVE_TAIL }))

  // 当前项指示：一枚尖叶
  const LEAF_SVG = H('svg', { key: 'leaf', viewBox: '0 0 14 26', className: 'leaf' },
    H('path', { d: 'M7 2 C11 8 11 18 7 24 C3 18 3 8 7 2 Z' }))

  // 叶形分隔带：正文与选项间的装饰带（柳叶 ＋ 中脉 ＋ 双侧波浪蔓延 ＋ 渐变发丝线）
  const ORN_LEAF_BAND = () => H('div', { key: 'sep-leaf', className: 'leaf-sep' },
    H('div', { className: 'sep-line' }),
    H('svg', { viewBox: '0 0 160 26', className: 'leaf-band' },
      H('path', { d: LEAF_BAND_L }),
      H('path', { d: LEAF_BAND_R }),
      H('path', { d: 'M80 3 C88 9 88 17 80 23 C72 17 72 9 80 3 Z' }),
      H('path', { d: 'M80 3 L80 23', className: 'leaf-mid' })),
    H('div', { className: 'sep-line' }))

  // 四角卷草：外臂 2px ／ 内臂 1.1px ／ 角内双卷须 1.5px（顺序被 CSS 的 nth-child 依赖，别改序）
  const CORNER_SVG = H('svg', { viewBox: '0 0 40 40', className: 'corner-svg' },
    H('path', { d: 'M1 36 L1 8 Q1 1 8 1 L36 1' }),
    H('path', { d: 'M6 34 L6 9 Q6 6 9 6 L34 6' }),
    H('path', { d: CORNER_H }),
    H('path', { d: CORNER_V }))

    function StageRoot(props) {
      // ==== 上半段：全部 hook，任何 return 之前 ====
      const data = useLive()
      const [draft, setDraft] = React.useState('')
      const [hint, setHint] = React.useState('')
      // 板书面板相位：'' → turn → pull → settle（三段节拍见 CSS ⑦）
      const [board, setBoard] = React.useState('')
      // 板书屏：false | true（= 舞台的一个「屏」，整屏变纸 —— 已定案）
      const [boardScreen, setBoardScreen] = React.useState(false)
      // 板书场景（whiteboard.scene.v1）：null=还没取 | {ok:false}=没有可用板书 | {ok:true,scene}
      const [scene, setScene] = React.useState(null)
      const [anim, setAnim] = React.useState(null)
      // 真实选项：cursor = 键盘当前项；picked = 已点过的那一条（下一轮老师说话时自动清空）
      const [cursor, setCursor] = React.useState(0)
      const [picked, setPicked] = React.useState(-1)
      // Live2D：libReady=库加载完 | l2dFailed=放弃（回落静态图）| l2dPhase=当前映射到的动作名
      const [libReady, setLibReady] = React.useState(false)
      const [l2dFailed, setL2dFailed] = React.useState(false)
      const [l2dReady, setL2dReady] = React.useState(false)
      const l2dCanvasRef = React.useRef(null)
      const l2dAppRef = React.useRef(null)
      const l2dModelRef = React.useRef(null)
      const coreRef = React.useRef(null)
      const rootRef = React.useRef(null)   // 读当前有几个 .oc（键盘导航用）
      const taRef = React.useRef(null)
      const settings = props.settings || DEFAULTS
      const enabled = settings.enabled !== false

      // ── 板书图（K2.4）：自动切屏时渲染的是**这一张**，不是 L03 静态场景 ──────────
      // null=没在显示图 | {loading,id} | {ok:true,id,svg} | {ok:false,id,error,source}
      const [diagram, setDiagram] = React.useState(null)
      // K0 挂载点 / 口型源 / 屏幕状态 的活引用（effect 里读，不进依赖）
      const bridgeRef = React.useRef(null)
      const mouthRef = React.useRef(null)
      const screenRef = React.useRef('live')
      // 情绪通道：seq 游标 / 当前生效情绪（含过期时间）
      const emoSeqRef = React.useRef(0)
      const emoRef = React.useRef(null)
      /** 上一帧"纸带已显现字数"（口型源的增量就靠它算）。 */
      const tapeShownRef = React.useRef(0)
      // 表情驱动是否已接管表情层（null ⇒ 回落到原来的静态待机表情）
      const [driverOn, setDriverOn] = React.useState(false)
      // 拉出/收起的定时器（卸载时清掉，避免 setState after unmount）
      const beatTimersRef = React.useRef([])

      if (!mouthRef.current) mouthRef.current = createTextCadenceMouth()
      screenRef.current = boardScreen ? 'board' : 'live'

      /** 清掉三段节拍的定时器（重复开合时也先清，避免旧拍子插进来）。 */
      const clearBeats = function () {
        const list = beatTimersRef.current
        beatTimersRef.current = []
        for (const t of list) { try { clearTimeout(t) } catch { /* ignore */ } }
      }

      // ── K0 · 全局挂载点（契约 §K0）──────────────────────────────────────────
      // 🔴 这个 effect 必须写在 Live2D 那个 **之前**：React 按声明顺序执行 cleanup，
      //    而销毁顺序被契约写死了 —— ① driver.dispose()（清它挂在 app.ticker 上的东西）
      //    ② 摘 window.__SOCRATIC_STAGE__ ③ Live2D effect 的 cleanup 才 destroy PIXI 应用。
      //    顺序反了，驱动会有一帧去碰已经 destroy 的 app。
      React.useEffect(function () {
        if (!enabled) return undefined
        // 关闭态（Ctrl+Shift+M）：舞台不在，挂载点也不该在 —— 否则驱动会对着空舞台跑
        if (killed) return undefined
        if (bridgeRef.current) return undefined
        let bridge = null
        try {
          bridge = createStageBridge({
            React: React,
            subscribe: function (fn) { return store.subscribe(fn) },
            getSnapshot: function () {
              return {
                sessionId: live.sessionId,
                running: live.running,
                title: live.title,
                messages: live.messages,
                hasChatHook: live.hasChatHook,
                // 相位在引擎侧，舞台如实留 null（**不编一个值**骗驱动）
                phase: null,
              }
            },
            getScreen: function () { return screenRef.current },
            getApp: function () { return l2dAppRef.current },
            getModel: function () { return l2dModelRef.current },
            getMouthSource: function () { return mouthRef.current },
            // 驱动注册/注销 → 舞台重算表情层归属（有驱动＝表情归驱动，没驱动＝静态待机）
            onDriverChange: function (next) { try { setDriverOn(!!next) } catch (e) { /* ignore */ } },
          })
          window.__SOCRATIC_STAGE__ = bridge
          bridgeRef.current = bridge
        } catch (err) {
          pushWarning('K0 挂载点建立失败（表情驱动将不可用）：' + String((err && err.message) || err))
        }
        return function () {
          const b = bridgeRef.current
          bridgeRef.current = null
          if (b && typeof b.dispose === 'function') {
            try { b.dispose() } catch (err) { /* 销毁路径不许抛 */ }
          } else {
            try { delete window.__SOCRATIC_STAGE__ } catch { window.__SOCRATIC_STAGE__ = undefined }
          }
        }
      }, [enabled, killed])

      // ── 帧循环：口型源推进 ＋ 把当前情绪交给表情驱动 ───────────────────────
      // 挂在**舞台自己的 PIXI app.ticker** 上 ⇒ app 销毁时 ticker 一起死（10-19 那个
      // 「关掉再打开」的坑就是这么修的）；app 重建时这里会重新挂一份。
      const stageFrame = React.useCallback(function (dtMs) {
        const bridge = bridgeRef.current
        const drv = bridge && typeof bridge.driver === 'function' ? bridge.driver() : null
        const mouth = mouthRef.current
        if (mouth) {
          try {
            const msgs = live.messages || []
            let lastTeacher = null
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i] && msgs[i].role === 'teacher') { lastTeacher = msgs[i]; break }
            }
            const text = lastTeacher ? stripForTape(lastTeacher.text, !lastTeacher.running) : ''
            mouth.feed(text, !live.running)
            mouth.advance(dtMs)
            // 口型的**唯一输入源**是"纸带逐字显现的节奏"：把这一帧新增的显现字数报给驱动
            // （驱动的口型源接口是 tapeTyped(n)；驱动自己也可能换源，所以只调存在的那个）。
            const shown = mouth.current().revealed
            const delta = shown - tapeShownRef.current
            if (delta > 0) {
              tapeShownRef.current = shown
              if (drv && typeof drv.tapeTyped === 'function') {
                try { drv.tapeTyped(delta) } catch (e) { /* 口型出错不该影响画面 */ }
              }
            } else if (delta < 0) {
              tapeShownRef.current = shown    // 换句时 revealed 可能回退，别留负增量
            }
          } catch (err) { /* 口型算错不该影响画面 */ }
        }
        if (!drv) return
        // 情绪自然回落：超过 HOLD 没有新事件就交 null（C5 的"回到平静"在引擎接进来之前的兜底）
        const cur = emoRef.current
        const active = (cur && (Date.now() - cur.at) < EMOTION_HOLD_MS)
          ? { label: cur.label, intensity: cur.intensity }
          : null
        try { drv.drive({ active: active, dt: (Number(dtMs) || 0) / 1000 }, bridge) } catch (err) {
          pushWarning('表情驱动 drive() 抛错（已隔离，舞台照常）：' + String((err && err.message) || err))
        }
      }, [])

      // ── 情绪通道（契约 K1.4）─────────────────────────────────────────────
      // 只在「舞台可见（页面在前台、舞台没关）且 running === true」时每 250ms 轮一次。
      // 不做长轮询：实现简单、失败可见。
      React.useEffect(function () {
        if (!enabled || killed) return undefined
        if (!data.running) return undefined
        let stopped = false
        let inFlight = false
        const poll = function () {
          if (stopped || inFlight) return
          if (typeof document !== 'undefined' && document.hidden) return   // 页面在后台：不轮
          inFlight = true
          const url = BOARD_ROUTE + '/emotions?after=' + encodeURIComponent(String(emoSeqRef.current || 0))
          fetch(url, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null })
            .then(function (j) {
              if (stopped || !j || !Array.isArray(j.events)) return
              for (const ev of j.events) {
                const label = String(ev && ev.label || '')
                const intensity = Number(ev && ev.intensity)
                if (EMO_LABELS.indexOf(label) === -1) continue
                if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) continue
                emoRef.current = { label: label, intensity: intensity, at: Date.now() }
                // 驱动（X 车道）自己有一台情绪引擎与队列（上限 8、丢最旧）：
                // 有 pushEmotion 就交给它，舞台这份 active 只在没有驱动时才有意义。
                const br = bridgeRef.current
                const d = br && typeof br.driver === 'function' ? br.driver() : null
                if (d && typeof d.pushEmotion === 'function') {
                  try { d.pushEmotion(label, intensity) } catch (e) { pushWarning('pushEmotion 抛错（已隔离）') }
                }
              }
              if (Number.isFinite(Number(j.nextSeq))) emoSeqRef.current = Number(j.nextSeq)
            })
            .catch(function () { /* 轮询失败就等下一拍：不重试、不排队 */ })
            .then(function () { inFlight = false })
        }
        const timer = setInterval(poll, EMOTION_POLL_MS)
        poll()
        return function () { stopped = true; try { clearInterval(timer) } catch { /* ignore */ } }
      }, [enabled, killed, data.running])

      // ── Live2D：库就绪 → 建 PIXI 应用 → 载模型 ─────────────────────────────
      // 🔴 规矩：这个 effect 必须在所有 return 之前（hooks 顺序铁律），且**失败要能降级**：
      //   任何一步出错都 setL2dFailed(true)，渲染时回落静态 <img>，绝不因为 Live2D 挂了而没有立绘。
      React.useEffect(function () {
        if (!enabled) return
        // 🔴 2026-10-19：这两个字段在 **state.props** 里（组件的 React props），
        //    不在 `data`（那是消息流 store，只有 messages/sessionId 之类）。
        //    写错源不会报错，只会一直静默降级成静态图 —— 实测卡在这里一轮。
        const phases = (props && props.l2d) || []
        const models = (props && props.models) || []
        // manifest 还没回来时不能下失败的结论（否则首次渲染就永久降级成静态图，实测卡了一轮）
        if (!phases.length || !models.length) return
        const canvas = l2dCanvasRef.current
        if (!canvas) return
        let disposed = false

        ensureL2dLibs(phases)
          .then(function () {
            // 表情驱动模块（X 车道）：与立绘库并行/顺次都行，失败只记警告
            try { ensureEmotionModules() } catch (e) { /* ensureEmotionModules 内部已兜住 */ }
            if (disposed || !l2dCanvasRef.current) return
            // 🔴 必须显式给 width/height：PIXI 默认画布是 **300×150**，而 CSS 把它拉伸到
            //    38vh×52vh（实测 399×546）—— 结果内部只渲 300×150，画面糊成一片。
            //    这里的尺寸取 CSS 盒子的实际像素（拿不到就按视口推算）。
            const hostW = l2dCanvasRef.current.clientWidth || Math.round(window.innerHeight * 0.38)
            const hostH = l2dCanvasRef.current.clientHeight || Math.round(window.innerHeight * 0.52)
            const app = new window.PIXI.Application({
              view: l2dCanvasRef.current,
              width: hostW,
              height: hostH,
              backgroundAlpha: 0,
              antialias: true,
              autoDensity: true,
              resolution: window.devicePixelRatio || 1,
            })
            // 构造参数里的 width/height 实测不生效（canvas 内部仍是 300×150），
            // 必须再显式 resize 一次渲染器。
            try { app.renderer.resize(hostW, hostH) } catch (e) { /* 旧版没有 resize 就跳过 */ }
            l2dAppRef.current = app
            // 帧循环挂到 app.ticker 上：**app 销毁 ⇒ ticker 一起死**（不泄漏，10-19 那个坑的口径）。
            // PIXI v6 的 ticker 回调参数是"帧增量"（1 = 60fps），这里换算成毫秒。
            try {
              app.ticker.add(function (delta) { stageFrame((Number(delta) || 1) * (1000 / 60)) })
            } catch (e) { pushWarning('帧循环挂载失败（表情/口型不会动）：' + String((e && e.message) || e)) }
            setLibReady(true)
            const entry = models[0]
            return window.PIXI.live2d.Live2DModel.from(ROUTE + '/models/' + entry.model3, { autoInteract: false })
              .then(function (model) {
                if (disposed) { try { model.destroy() } catch (e) {} return }
                // 模型原始画布按 2048 设计；这里按舞台高度缩放到合适大小
                const box = l2dCanvasRef.current.getBoundingClientRect()
                // 🔴 缩放基准：原来按 1600 算，实测模型只出来一小只（这个模型的原始画布约
                //    300×400，不是 1600）。改成按画布盒子高度、以模型自身高度为基数算。
                // 🔴 缩放基准要按**模型自身显示尺寸**（scale=1 时的 model.width/height）算。
                //    用 internalModel.originalHeight 实测拿不到（undefined → 退回 400 是错的，
                //    这个模型的原始画布远大于 400），结果模型被放大到画布之外、看起来"立绘消失"。
                // 兜底用这个模型的实际画布尺寸（300×400，来自它的 model_list 配置）。
                // 不能用 `|| 1`：刚创建时 model.width 可能是 0，除以它会得到天文数字的缩放，
                // 模型被放大到画布之外 —— 临床表现是"立绘消失"，而不是报错。
                // 🔴 缩放与落位：**不要用 anchor** —— Live2DModel 是 PIXI 的 Container 子类，
                //    Container 没有 anchor（那是 Sprite 的属性）。之前写了 model.anchor.set(0.5,1)
                //    并据此定位，结果是模型原点落在画布右下角之外，肉眼看到的就是"立绘不见了"
                //    （canvas 里透出背景，也不报错）。
                //    正确做法：按缩放后的实际尺寸算左上角坐标。
                const mw = model.width || 300
                const mh = model.height || 400
                const scale = Math.min(app.screen.width / mw, app.screen.height / mh) * 0.95
                model.scale.set(scale)
                // 🔴 model.width/height 在 pixi-live2d-display 里**已经是缩放后**的显示尺寸
                //    （实测：原始 1280×1280、scale 0.296 时 model.width = 379）。这里再乘一次 scale
                //    会把 379 算成 112，于是 x 取 (399-112)/2 = 143，模型右边界冲到画布外 → 看不见。
                const drawW = model.width || mw * scale
                const drawH = model.height || mh * scale
                model.x = Math.max(0, (app.screen.width - drawW) / 2)
                model.y = Math.max(0, app.screen.height - drawH)

                app.stage.addChild(model)
                l2dModelRef.current = model
                setL2dReady(true)
              })
          })
          .catch(function (err) {
            if (disposed) return
            // 🔴 catch 里只调用一定存在的函数（见模块级 pushWarning 的注释）
            pushWarning('Live2D 不可用，回落静态立绘：' + String((err && err.message) || err))
            setL2dFailed(true)
            try { if (l2dAppRef.current) l2dAppRef.current.destroy(false) } catch (e) {}
            l2dAppRef.current = null
          })

        return function () {
          disposed = true
          try { if (l2dAppRef.current) l2dAppRef.current.destroy(false) } catch (e) {}
          l2dAppRef.current = null
          l2dModelRef.current = null
        }
        // 🔴 props.killed 必须进依赖：关掉舞台（Ctrl+Shift+M）时组件返回 null、canvas 被销毁，
        //    再打开（Ctrl+Shift+U）时 React 重建出一个**新的** canvas —— 依赖没变 effect 就不会重跑，
        //    新 canvas 上没有 PIXI 应用，立绘消失。实测踩过。
        // 🔴 2026-10-20 修（原 bug）：这里原来还有整个 `data` 快照 —— 流式期间 store.set 每来
        //    一块文本就换一次快照，于是 PIXI 应用**每帧被销毁重建**（表情驱动/口型会跟着抖，
        //    还会反复重下模型）。本 effect 只用到 props 上的四个字段，删掉 data 即可。
      }, [enabled, props.l2d, props.models, props.killed, stageFrame])

      // ── Live2D：状态 → 动作 ────────────────────────────────────────────────
      // 模型只有两组动作：`Idle`（1 段）与 `Anima`（0=speak / 1=thinkend / 2=thinking）。
      // 这里按**能观测到的课堂状态**驱动（不假装知道相位——相位在引擎侧，客户端只有消息流）：
      //   · 正在生成         → thinking
      //   · 老师刚说完一段    → speak（播一轮）
      //   · 学生刚说完        → thinkend（老师在消化）
      //   · 其它             → idle
      // 🔴 2026-10-20：这一条 effect 原来把**动作层与表情层写在同一串 if 里**，且依赖整个
      //    `data.messages`（流式期间每来一块文本都重跑 → 每块都 `model.motion()` 重新起播，
      //    表情也被反复打断）。现在：
      //      · 依赖收窄成「最后一个开口的角色 + 是否在生成 + 表情层归谁」；
      //      · **动作层保留原逻辑**（running→thinking / teacher→speak / you→thinkend / 否则 idle）；
      //      · **表情层交给独立的驱动模块**（K0 的 setExpressionDriver）；没有驱动时才用静态待机表情。
      const lastSpokenRole = (function () {
        const msgs = data.messages || []
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]
          if (m && (m.role === 'teacher' || m.role === 'you')) return m.role
        }
        return ''
      })()
      React.useEffect(function () {
        const model = l2dModelRef.current
        if (!model || !l2dReady) return
        const play = function (group, index) {
          try { model.motion(group, index) } catch (e) { /* 动作缺失不该影响画面 */ }
        }
        // 表情：模型自带 5 个（happy / happy2 / puzzled / relax / unhappy）。
        // 有驱动接管时**只管动作、不碰表情**（驱动每帧在写参数，这里再设会打架）。
        const expr = function (name) {
          if (driverOn) return
          try { model.expression(name) } catch (e) { /* 没有该表情就跳过 */ }
        }
        if (data.running) { play('Anima', 2); expr('relax'); return }                     // thinking
        if (lastSpokenRole === 'teacher') { play('Anima', 0); expr('happy'); return }     // speak
        if (lastSpokenRole === 'you') { play('Anima', 1); expr('puzzled'); return }       // thinkend
        play('Idle', 0)
      }, [l2dReady, data.running, lastSpokenRole, driverOn])

      // 阅读态＝正文流自己滚（Avalon 做法）：新消息到达时贴底
      React.useEffect(function () {
        const el = coreRef.current
        if (!el) return
        try { el.scrollTop = el.scrollHeight } catch { /* ignore */ }
      }, [data.messages])

      // 自增长 textarea
      React.useEffect(function () {
        const el = taRef.current
        if (!el) return
        try { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 96) + 'px' } catch { /* ignore */ }
      }, [draft])

      const openAnim = function (id) {
        setAnim({ loading: true })
        const load = function (theId) {
          fetch(ROUTE + '/anim/' + encodeURIComponent(theId) + '/scene.json', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null })
            .then(function (j) {
              if (j && j.video) {
                setAnim({ ok: true, scene: j, id: theId, src: ROUTE + '/anim/' + encodeURIComponent(theId) + '/' + j.video })
              } else {
                setAnim({ ok: false, error: 'no-scene', id: theId })
              }
            })
            .catch(function () { setAnim({ ok: false, error: 'fetch-failed', id: theId }) })
        }
        if (id) return load(id)
        fetch(ROUTE + '/manifest.json', { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null })
          .then(function (m) {
            const list = (m && m.animations) || []
            if (!list.length) { setAnim({ ok: false, error: 'none' }); return }
            load(list[0].id)
          })
          .catch(function () { setAnim({ ok: false, error: 'fetch-failed' }) })
      }
      const closeAnim = function () { setAnim(null) }

      // ── 板书的「三段节拍」（已定案 170 / 390 / 220ms，切换点 170 / 560）──────
      // 🔴 串行口径：170 后开始拉出，390 跑完才切 settle（560 = 170+390），
      //    所以 `pull` 的 390ms 曲线是**完整**跑完的（此前的乐观值 170/560 会让它只跑 30%）。
      const pullOut = function () {
        setBoardScreen(true)
        if (board) return          // 已经停在板上（settle 之后）→ 不重播拉出（契约 K2.4：直接替换）
        clearBeats()
        setBoard('turn')
        beatTimersRef.current.push(setTimeout(function () { setBoard('pull') }, 170))
        beatTimersRef.current.push(setTimeout(function () { setBoard('settle') }, 560))
      }

      // 收起＝反向节拍：面板沿原路滑出（390ms），随后整块离场（对比件 closeBoard 420ms）
      const closeBoard = function () {
        clearBeats()
        setBoard('turn')
        beatTimersRef.current.push(setTimeout(function () {
          setBoard('')
          setBoardScreen(false)
          setDiagram(null)
        }, 420))
      }

      /**
       * 开一张**真的板书图**（K2.4）：切到板书屏 → 播拉出节拍 → 取这一张的 mermaid 源码
       * → 真渲染。渲染失败显示「这张图渲染失败」＋源码，不白屏。
       * 已在板书屏时只替换内容（pullOut 内部会跳过重播）。
       */
      const openDiagram = function (req) {
        const id = req && req.id ? String(req.id) : ''
        if (!id) return
        pullOut()
        setScene(null)
        setDiagram({ loading: true, id: id })
        fetchDiagramSource(id)
          .then(function (src) {
            return renderMermaidSvg(src, id).then(function (r) { return { r: r, src: src } })
          })
          .then(function (out) {
            const r = out.r
            setDiagram(function (cur) {
              // 只认最后一次请求：老师连画两张时，先发的旧请求不许覆盖新图
              if (!cur || cur.id !== id) return cur
              if (r.ok) return { ok: true, id: id, svg: r.svg }
              return { ok: false, id: id, error: r.error, source: out.src }
            })
          })
          .catch(function (err) {
            setDiagram(function (cur) {
              if (!cur || cur.id !== id) return cur
              return { ok: false, id: id, error: String((err && err.message) || err), source: '' }
            })
          })
      }

      // 开板书（静态场景版，保留手动按钮的老路径）：缺件就降级成占位
      const openBoard = function (lesson) {
        setDiagram(null)
        pullOut()
        setScene(null)
        const id = lesson || 'L03'
        fetch(ROUTE + '/board/' + encodeURIComponent(id) + '.scene.json', { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null })
          .then(function (j) {
            if (j && j.version === 'whiteboard.scene.v1' && Array.isArray(j.elements)) {
              setScene({ ok: true, scene: j })
            } else {
              setScene({ ok: false, boards: (j && j.boards) || [], error: (j && j.error) || 'no-response' })
            }
          })
          .catch(function () { setScene({ ok: false, boards: [], error: 'fetch-failed' }) })
      }

      // ── K2.4 自动切屏：老师刚画完一张 → 播拉出节拍、渲染这一张 ──────────────
      const boardReq = latestBoardOf(data.messages)
      const boardReqId = boardReq && boardReq.id ? String(boardReq.id) : ''
      // 挂载时已经存在的板书**不**自动弹（刷新页面后先看 live 屏）：判据是**事件时间**
      // 早于挂载时刻（见 shouldAutoOpenBoard）。不用"首帧记下当前 id"那种做法 ——
      // Chat 快照异步到达，首帧往往一条消息都没有，那样每次刷新都会弹一次板书屏。
      const mountedAtRef = React.useRef(Date.now())
      const seenBoardIdRef = React.useRef('')
      React.useEffect(function () {
        if (!boardReqId) return
        if (!shouldAutoOpenBoard(mountedAtRef.current, seenBoardIdRef.current, boardReq)) return
        seenBoardIdRef.current = boardReqId
        // 🔴 舞台关着的时候画了图：**不自动打开舞台**，只进历史（P 车道列它）
        if (!enabled || killed) return
        openDiagram(boardReq)
      }, [boardReqId, enabled, killed])

      // 回合变化时清掉选项选中态（键用「用户消息条数」—— 流式正文不能当 effect 键，每来一个字都会变）
      const userCount = (data.messages || []).filter(function (m) { return m.role === 'you' }).length
      const prevUserCountRef = React.useRef(userCount)
      React.useEffect(function () {
        setCursor(0); setPicked(-1)
        const prev = prevUserCountRef.current
        prevUserCountRef.current = userCount
        // 🔴 契约 K2.4：学生发下一句话 → 板书收起（反向节拍）。用 ref 读当前屏幕状态，
        //    免得把 boardScreen 塞进依赖（那样每次开合都会重跑这个 effect）。
        if (userCount > prev && screenRef.current === 'board') closeBoard()
      }, [userCount])

      // 卸载时清掉没跑完的节拍定时器（关舞台/热重载时别留下 setState 残骸）
      React.useEffect(function () {
        return function () { clearBeats() }
      }, [])

      // ↑↓ 选（只在真的有选项时接管按键）
      React.useEffect(function () {
        const onKey = function (e) {
          const box = rootRef.current
          const n = box ? box.querySelectorAll('.oc').length : 0
          if (!n) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(function (c) { return Math.min(c + 1, n - 1) }) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(function (c) { return Math.max(c - 1, 0) }) }
        }
        try { window.addEventListener('keydown', onKey, true) } catch { /* ignore */ }
        return function () { try { window.removeEventListener('keydown', onKey, true) } catch { /* ignore */ } }
      }, [])

      React.useEffect(function () {
        if (!anim) return
        const onKey = function (e) { if (e && e.key === 'Escape') { e.preventDefault(); setAnim(null) } }
        try { window.addEventListener('keydown', onKey, true) } catch { /* ignore */ }
        return function () { try { window.removeEventListener('keydown', onKey, true) } catch { /* ignore */ } }
      }, [anim])

      // ==== 守卫：所有 hook 之后 ====
      if (!enabled) return null
      if (killed) {
        // 🔴 关闭态**仍然要有那个根类**：.stage-warm-root 是唯一定位上下文（fixed;inset:0;z-index）
        return H('div', {
          className: 'stage-warm-root grain',
          'data-killed': 'on',
          'data-chrome': 'off',
        },
          H('div', { className: 'banner' },
            H('span', null, '教室舞台已关闭 · Ctrl+Shift+U 恢复'),
            H('button', { onClick: function () { setKilled(false) } }, '恢复舞台')))
      }

      const msgs = data.messages || []
      let lastTeacherIdx = -1
      for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].role === 'teacher') { lastTeacherIdx = i; break } }

      // 发送：走 DSH 的 inputActions（等价于"用户按下发送"，会过斜杠裁决/队列策略）
      const submit = function () {
        const text = String(draft || '').trim()
        if (!text) return
        const ia = sendBox.inputActions
        if (!ia || typeof ia.setDraft !== 'function' || typeof ia.submit !== 'function') {
          setHint('发送通道未就绪')
          return
        }
        try {
          ia.setDraft(text)
          setDraft('')
          setHint('已送出')
          // 🔴 setDraft 写的是编辑器模型，submit 读的也是模型 —— 但同步可见性未验证，隔一帧最稳
          requestAnimationFrame(function () {
            try { ia.submit() } catch { setHint('发送失败') }
          })
        } catch { setHint('发送失败') }
      }

      const assets = props.assets || {}
      const bgUrl = assets['classroom_wide.png'] || assets['classroom_night.png'] || ''
      const castUrl = assets['teacher_gen.png'] || ''

      const children = []
      children.push(bgUrl
        ? H('img', { key: 'bg', className: 'bg', src: bgUrl, alt: '' })
        : H('div', { key: 'bg', className: 'bgfallback' }))
      children.push(H('div', { key: 'veil', className: 'veil' }))
      children.push(H('div', { key: 'c1', className: 'corner tl' }, CORNER_SVG))
      children.push(H('div', { key: 'c2', className: 'corner br' }, CORNER_SVG))
      // 🔴 2026-10-20：这里原来**写死**了 `小 鞠 知 花 · 在场`（角色早就换成「鲸」了）。
      //    名字的唯一来源是教室数据：宿主 manifest 的 `classroom.teacher.name`
      //    （= classroom.yaml 里 `layer: persona` 那个角色卡文件的「名字」行）。
      //    读不到就只显示「在场」——**绝不写死任何名字**。
      const classroomInfo = props.classroom || {}
      const teacherName = String((classroomInfo.teacher && classroomInfo.teacher.name) || '')
      children.push(H('div', { key: 'strip', className: 'cast-strip' },
        H('span', { className: 'cast-chip on' }, teacherName ? (teacherName + ' · 在场') : '在场')))
      children.push(H('div', { key: 'top', className: 'topbar' },
        H('div', { className: 'tb-lft' },
          H('span', { className: 'cn' }, data.title || classroomInfo.title || '教室'),
          H('span', { className: 'no' }, data.running ? '老师正在讲' : '待你开口')),
        H('div', { className: 'tools' },
          H('button', { className: 'tool', onClick: function () { props.onChrome && props.onChrome('off') } }, '读'),
          H('button', { className: 'tool', onClick: function () {
            // 手动按钮保留（契约 K2.4）。收起走反向节拍；打开时**优先看最新那张真板书图**，
            // 没有图（这一节还没画过）才退回老的静态场景 L03。
            if (boardScreen) { closeBoard(); return }
            if (boardReq) { openDiagram(boardReq); return }
            openBoard('L03')
          } }, boardScreen ? '收起板书' : '板书'),
          H('button', { className: 'tool', onClick: function () { openAnim('asset-iomodel') } }, '动画'),
          H('button', { className: 'tool', onClick: function () { setKilled(true) } }, '关闭舞台'))))
      // 板书面板：**先入 DOM ⇒ z 序低于角色**（这就是"从角色身后拉出"的机制）
      if (board) {
        // 标题/状态行：真板书图优先（图上显示的是**这一张**，不是 L03 静态场景）
        const bpTitle = diagram
          ? ('板 书 · ' + String(diagram.id || ''))
          : '板 书 · ' + (scene && scene.ok ? String(scene.scene.label || scene.scene.lesson || '') : '白板')
        const bpRev = diagram
          ? (diagram.loading ? '读取中…' : (diagram.ok ? 'mermaid' : '渲染失败'))
          : (scene && scene.ok ? ('rev ' + String(scene.scene.rev || 0)) : (scene ? '无可用板书' : '读取中…'))
        let bpBody = null
        if (diagram) {
          if (diagram.loading) {
            bpBody = H('div', { className: 'bp-fallback' }, H('div', { className: 'bp-note' }, '正在取这张图…'))
          } else if (diagram.ok) {
            bpBody = H('div', { className: 'bp-canvas', dangerouslySetInnerHTML: { __html: diagram.svg } })
          } else {
            // 🔴 契约 K2.4：渲染失败不许白屏 —— 一句人话 ＋ 图的源码
            bpBody = H('div', { className: 'bp-fail' },
              H('div', { className: 'why' }, '这张图渲染失败'),
              H('div', { className: 'bp-note' }, String(diagram.error || '')),
              diagram.source ? H('pre', null, String(diagram.source)) : null)
          }
        } else if (scene && scene.ok) {
          bpBody = H('div', { className: 'bp-canvas', dangerouslySetInnerHTML: { __html: renderSceneSvgString(scene.scene) } })
        } else {
          bpBody = H('div', { className: 'bp-fallback' },
            H('div', null, H('span', { className: 'k' }, '就绪'), ' → ', H('span', { className: 'k' }, '运行')),
            H('div', null, H('span', { className: 'k' }, '运行'), ' → 阻塞（等 I/O）'),
            H('div', null, H('span', { className: 'k' }, '阻塞'), ' → 就绪（I/O 完成）'),
            H('div', null, H('span', { className: 'k' }, '运行'), ' → 终止（exit）'),
            H('div', { className: 'bp-note' },
              scene ? ('板书缺件：' + String(scene.error || '') + '（可用：' + String((scene.boards || []).join('、') || '无') + '）') : ''))
        }
        children.push(H('div', { key: 'board', className: 'boardpanel' },
          H('div', { className: 'bp-top' },
            H('span', { className: 'dm' }),
            H('span', { className: 'bp-tx' }, bpTitle),
            H('span', { className: 'bp-rev' }, bpRev)),
          H('div', { className: 'bp-body' }, bpBody)))
      }

      if (settings.showSprite !== false) {
        // 立绘入画：外层 .cast-wrap 自带"自下而上压暗"（见 CSS ⑤）
        // 🔴 2026-10-19：优先 Live2D（canvas），任何一步失败或未就绪都回落静态 <img>。
        //   canvas 一直挂在 DOM 里（卸载会丢 WebGL 上下文），只用 CSS 控制显隐。
        const useL2d = !l2dFailed
        children.push(H('div', { key: 'cast', className: 'cast-wrap', 'data-l2d': useL2d ? 'on' : 'off' },
          useL2d
            ? H('canvas', { key: 'l2d', ref: l2dCanvasRef, className: 'cast-l2d' })
            : null,
          (l2dFailed && castUrl)
            ? H('img', { key: 'img', className: 'cast', src: castUrl, alt: '' })
            : null))
      }

      // ══════════════════════════════════════════════════════════════════
      // 正文区：纸卡内框（.cardframe）＋ 正文行（.line.sans）
      // ★ 2026-09-30：按「真·魔夜 UI」补的造型 —— 正文改无衬线、包进内外双线框
      // ══════════════════════════════════════════════════════════════════
      // 真实选项：从**最后一条老师正文**里抽编号清单（抽不到就不显示，绝不编）
      // 🔴 2026-10-19：提前算 —— 因为正文渲染要用它判断"末尾那份清单要不要裁掉"（否则与卡片重复）。
      const realOptions = (function () {
        if (props.gallery) return []
        if (lastTeacherIdx < 0) return []
        const t = String((msgs[lastTeacherIdx] && msgs[lastTeacherIdx].text) || '')
        return parseOptions(t)
      })()

      const lines = []
      if (msgs.length === 0) {
        lines.push(H('div', { key: 'empty', className: 'empty' },
          data.hasChatHook ? '（这段会话还没有内容）' : '（舞台没拿到会话数据 —— 传感器可能没挂上）'))
      }
      // 🔴 顺序说明：`.band-core` 是 `flex-direction:column; justify-content:flex-end`（贴底），
      //    DOM 顺序＝视觉上从上到下，所以**当前句放最后**（紧贴输入框上方），旧句自然滚在上面 ——
      //    这正是真品阅读态的做法（已读的往上滚，当前句独占底部）。
      // 🔴 2026-10-19：工具行降噪。实测一个回合里引擎会连调十几个工具，原实现把每一条
      //   都画成「⚙ tool-result」，纸带被十几行噪音占满（真机上量到 16 条）。
      //   改为：**只显示最后一条工具行，且仅当本回合还有正在跑的步骤**（＝"老师正在忙"这一个信号），
      //   其余一律不画。工具细节在 DSH 自己的 Trajectory 里能看，纸带只负责对话。
      const anyRunning = msgs.some(function (x) { return x.running })
      msgs.forEach(function (m, i) {
        // 板书信号条目（classroom_draw 的结果）只用于切屏，**不进纸带**：纸带只画对话
        if (m.role === 'board') return
        if (m.role === 'tool') {
          if (!anyRunning || i !== msgs.length - 1) return
          lines.push(H('div', { key: 't' + i, className: 'tline' }, '⚙ ' + m.text))
          return
        }
        const isCurrent = (i === lastTeacherIdx)
        // 当前老师句带 `cur`（机核判据用；视觉上也就是"最下面那一句"）
        const cls = 'line sans' + (m.role === 'you' ? ' you' : (isCurrent ? ' cur' : ' past'))
        // 🔴 2026-10-19：选项被渲染成卡片后，正文末尾那份编号清单就是**重复**（实测同一个 1./2./3.
        //    既出现在正文里又出现在卡片里）。这里把**末尾连续**的编号行裁掉 —— 只裁末尾，
        //    正文中间的教学步骤（"第一步…第二步…"）不动。
        let bodyText = m.text
        if (isCurrent && realOptions.length > 0) {
          bodyText = stripTrailingOptionList(bodyText)
        }
        // 🔴 契约 K1.4 的防御性剥离：正常路径下引擎已在 `llm/stream` 剥净，
        //    这里兜的是"引擎没装/版本不匹配"——纸带绝不能把 〔emo:…〕 显示出来。
        //    `final` 只在"这条消息已经说完"时为真：流式中间态遇到半截标记先不下传。
        bodyText = stripForTape(bodyText, !m.running)
        bodyText = stripMarkdown(bodyText)
        lines.push(H('p', { key: 'm' + i, className: cls },
          (m.role === 'you' ? '你：' : '') + bodyText,
          isCurrent ? H('i', { className: 'adv' }) : null))
      })

      // ── 选项区（六态）─────────────────────────────────────────────────
      // 引擎的选项来源还没接 → 用 ?stagegallery=1 开一张"六态样张"：
      //   ① 让造型在真机上看得见（否则 CSS 只是躺在文件里）
      //   ② 类名即契约，下一轮接引擎照此产出
      let optsNode = null

      // 真实选项 → 与样张**同一套类名**（.orn / .opts / .oc），但状态由真实交互驱动：
      //   cur = 键盘当前项 ｜ picked = 已点过的 ｜ picked sent = 已点且已送出
      const pickOption = function (i, text) {
        setPicked(i)
        const ia = sendBox.inputActions
        if (!ia || typeof ia.setDraft !== 'function' || typeof ia.submit !== 'function') { setHint('发送通道未就绪'); return }
        try {
          ia.setDraft(String(text))
          setHint('已选 ' + String(i + 1))
          requestAnimationFrame(function () { try { ia.submit() } catch { setHint('发送失败') } })
        } catch { setHint('发送失败') }
      }

      if (!props.gallery && realOptions.length >= 2) {
        optsNode = [
          ORN_LEAF_BAND(),
          H('div', { key: 'orn', className: 'orn' },
            ORN_WAVE(true),
            H('span', { className: 'tx' }, '选 项'),
            ORN_WAVE(false)),
          H('div', { key: 'opts', className: 'opts' }, realOptions.map(function (tx, i) {
            const cls = 'oc' + (picked === i ? ' picked' + (hint.indexOf('已选') === 0 ? ' sent' : '') : (picked < 0 && i === cursor ? ' cur' : ''))
            return H('div', {
              key: 'roc' + i, className: cls,
              onClick: function () { pickOption(i, tx) },
            },
              H('span', { className: 'oe l' }, ORN_END('oel' + i)),
              H('span', { className: 'no' }, String(i + 1).padStart(2, '0')),
              H('span', { className: 'tx' }, tx),
              H('span', { className: 'go' }, picked === i ? '已选' : '↑↓ 选 · Enter 定'),
              H('span', { className: 'oe r' }, ORN_END('oer' + i)))
          })),
        ]
      }

      if (props.gallery) {
        const DEMO = [
          { n: '01', tx: '先把 PCB 拆给我看。', cls: 'oc picked sent', go: '已送出' },
          { n: '02', tx: '进程和线程，到底差在哪？', cls: 'oc cur', go: '当前' },
          { n: '03', tx: '画一张状态迁移图。', cls: 'oc', go: '↑↓ 选 · Enter 定' },
          { n: '04', tx: '举一个我身边能看见的例子。', cls: 'oc', go: '↑↓ 选 · Enter 定' },
          { n: '05', tx: '我自己写一段 fork 试试。', cls: 'oc picked', go: '已选' },
          { n: '06', tx: '先停一下，我把上一讲再看一遍。', cls: 'oc disabled', go: '已用过' },
        ]
        optsNode = [
          ORN_LEAF_BAND(),
          H('div', { key: 'orn', className: 'orn' },
            ORN_WAVE(true),
            H('span', { className: 'tx' }, '选 项'),
            ORN_WAVE(false)),
          H('div', { key: 'opts', className: 'opts' }, DEMO.map(function (o, i) {
            return H('div', { key: 'oc' + i, className: o.cls },
              H('span', { className: 'oe l' }, ORN_END('gol' + i)),
              H('span', { className: 'no' }, o.n),
              H('span', { className: 'tx' }, o.tx),
              H('span', { className: 'go' }, o.go),
              H('span', { className: 'oe r' }, ORN_END('gor' + i)))
          })),
        ]
      }

      if (anim) {
        children.push(H('div', {
          key: 'anim', className: 'animscr', onClick: function () { closeAnim() },
        },
          H('div', { className: 'as-top' },
            H('span', { className: 'dm' }),
            H('span', { className: 'as-tx' },
              anim.loading
                ? '动画 · 准备中…'
                : (anim.ok ? ('动画 · ' + String((anim.scene && anim.scene.label) || anim.id)) : '动画 · 不可用')),
            H('span', { className: 'as-esc' }, '点画面 / Esc 收')),
          anim.ok
            ? H('div', { className: 'as-frame' },
                H('video', {
                  className: 'as-video',
                  src: anim.src,
                  poster: anim.poster || undefined,
                  autoPlay: true,
                  playsInline: true,
                  preload: 'auto',
                  onEnded: function () { closeAnim() },
                  onError: function () { setAnim({ ok: false, error: 'video-error', id: anim.id }) },
                }))
            : H('div', { className: 'as-fallback' },
                anim.loading ? '正在取动画…' : ('动画不可用：' + String(anim.error || '')))))
      }

      children.push(H('div', { key: 'band', className: 'band' },
        H('div', { className: 'band-top' }),
        H('div', { className: 'band-core', ref: coreRef },
          H('div', { key: 'frame', className: 'cardframe' },
            H('div', { className: 'who' },
              H('span', { className: 'bar' }),
              // 角色名：与 characters/ 里的当课老师一致（换角色改这一处）
              H('span', { className: 'nm' }, teacherNameShort(teacherName))),
            lines,
            optsNode)),
        H('div', { className: 'composer' },
          H('textarea', {
            ref: taRef,
            rows: 1,
            value: draft,
            placeholder: '回一句，或者说「听不懂」',
            onChange: function (e) { setDraft(e.target.value); setHint('') },
            onKeyDown: function (e) {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
            },
          }),
          H('span', { className: 'hint' }, hint || (data.running ? '老师正在讲…' : 'Enter 送出 · Shift+Enter 换行')),
          H('button', { className: 'send', disabled: !String(draft).trim(), onClick: submit }, '送出'))))

      return H('div', {
        className: 'stage-warm-root grain',
        'data-chrome': props.chrome || 'off',
        'data-running': data.running ? 'on' : 'off',
        'data-gallery': props.gallery ? '1' : '0',
        'data-board': board || 'off',
        ref: rootRef,
        'data-screen': boardScreen ? 'board' : 'live',
        'data-anim': anim ? 'on' : 'off',
        // 自证：把"模块加载那一刻看到 query"记在 DOM 上，便于真机归因
        'data-boot-query': BOOT.rawSearch,
        'data-boot-hash': BOOT.rawHash,
      }, children)
    }

    // ======================================================================
    // §8 挂载／卸载
    // ======================================================================
    // 🔴 必须在**模块加载时**读：宿主会在接管 URL 时抹掉 query（token 也会被摘掉），
    //    进 apply()/render() 时 location.search 已经空了 —— 实测踩过。
    // 🔴 实测：宿主接管 URL 时会把 `?token=…` **连同我们自己的 query 一起抹掉**
    //    （模块加载那一刻 location.search 已经是空串）→ 所以开关**不能放 query**。
    //    改用两条都能在"模块加载那一刻"读到的通道：
    //      ① **hash**（`#stagegallery=1`）—— 服务端不参与解析，实测能活到模块加载
    //      ② **localStorage**（`stage-warm:gallery` = '1'）—— 刷新也在
    const BOOT = (function () {
      try {
        const h = new URLSearchParams(String(location.hash || '').replace(/^#/, ''))
        let ls = null
        try { ls = localStorage.getItem('stage-warm:gallery') } catch (_e) { ls = null }
        return {
          rawHash: String(location.hash || '').slice(0, 120),
          rawSearch: String(location.search || '').slice(0, 120),
          gallery: h.get('stagegallery') === '1' || ls === '1',
        }
      } catch (_e) {
        return { rawHash: '', rawSearch: '', gallery: false }
      }
    })()
    const GALLERY = BOOT.gallery

    const state = {
      root: null,
      props: {
        settings: Object.assign({}, DEFAULTS),
        assets: {},
        chrome: 'off',
        onChrome: null,
        // ?stagegallery=1 → 渲染"选项六态样张"（造型可见性验证 + 接引擎前的类名契约）
        gallery: GALLERY,
      },
    }

    function ensureCss() {
      try {
        if (document.getElementById('stage-warm-css')) return
        const el = document.createElement('style')
        el.id = 'stage-warm-css'
        el.setAttribute('data-stage-warm', BUILD_ID)
        el.appendChild(document.createTextNode(CSS))
        document.head.appendChild(el)
      } catch { /* 样式挂不上也不致命（只是难看） */ }
    }

    function render() {
      try {
        if (!state.root) return
        state.root.render(H(StageRoot, Object.assign({ killed: killed }, state.props)))
      } catch (err) {
        reportToHost({ stage: 'render-throw', error: String((err && err.stack) || err).slice(0, 800) })
      }
    }

    function mountRoot() {
      try {
        // 幂等：先清理上一份（连同 DSH 错误边界留下的残骸）
        try {
          for (const el of document.querySelectorAll('[id="' + ROOT_ID + '"]')) {
            try { el.remove() } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
        const el = document.createElement('div')
        el.id = ROOT_ID
        el.setAttribute('data-stage-warm', BUILD_ID)
        document.body.appendChild(el)
        state.root = ReactDOMClient.createRoot(el)
        render()
        reportToHost({ stage: 'mount', rootCount: document.querySelectorAll('[id="' + ROOT_ID + '"]').length })
      } catch (err) {
        reportToHost({ stage: 'mount-throw', error: String((err && err.stack) || err).slice(0, 800) })
      }
    }

    // ======================================================================
    // §9 apply
    // ======================================================================
    const inject = ['slots']

    function pickSensorSlot(ctx) {
      for (const name of SENSOR_SLOTS) {
        try {
          const spec = ctx.slots && typeof ctx.slots.spec === 'function' ? ctx.slots.spec(name) : null
          if (spec) return name
        } catch { /* 查不到就试下一个 */ }
      }
      return SENSOR_SLOTS[0]
    }

    function registerSensor(ctx, slotName, warnings) {
      try {
        ctx.slots.inject(slotName, function () {
          try {
            return ctx.slots.register(
              { name: slotName, id: 'stage-warm-sensor', order: 900 },
              SessionSensor)
          } catch (err) {
            warnings.push('传感器注册失败：' + String((err && err.message) || err))
            return function () {}
          }
        })
        return true
      } catch (err) {
        warnings.push('传感器注入失败：' + String((err && err.message) || err))
        return false
      }
    }

    function apply(ctx) {
      // 🔴 不要在这里再声明一次 `warnings`：StageRoot 的降级路径也用同一份（模块级）
      try { installEscapeHatch() } catch (err) { warnings.push('逃生门安装失败：' + String(err)) }

      // ---- 1. 传感器（session 作用域，渲染 null） ----------------------
      const slotName = pickSensorSlot(ctx)
      const ok = registerSensor(ctx, slotName, warnings)
      reportToHost({ stage: 'sensor', slot: slotName, ok: ok, warnings: warnings.slice() })

      // ---- 2. 舞台根（自建容器挂 body） --------------------------------
      try { ensureCss() } catch (err) { warnings.push('样式注入失败：' + String(err)) }
      mountRoot()

      // ---- 3. 素材 + 设置 ---------------------------------------------
      Promise.all([fetchJson(ROUTE + '/manifest.json')]).then(function (res) {
        const j = res[0]
        if (j) {
          if (j.settings) state.props.settings = Object.assign({}, DEFAULTS, j.settings)
          const map = {}
          // 带 `?v=<rev>` 做缓存破坏：素材被替换（mtime 变）后 URL 跟着变，浏览器才会重新拉。
          for (const a of (j.assets || [])) map[a.name] = ROUTE + '/assets/' + a.name + (a.rev ? ('?v=' + a.rev) : '')
          state.props.assets = map
          // 🔴 2026-10-19：Live2D 需要的两项也在同一份 manifest 里 —— 漏读就会一直走静态图
          //    （而且它是**静默降级**：没有报错，只是 canvas 不出现）。
          state.props.models = j.models || []
          state.props.l2d = j.l2d || []
          // 教室标识（教室名/老师显示名）：一律来自宿主读到的教室数据，前端不写死
          state.props.classroom = j.classroom || null
        }
        render()
      }).catch(function (err) { warnings.push('清单加载失败：' + String(err)) })

      // ---- 4. 鼠标到顶部才浮出 chrome（阅读态零 chrome） ---------------
      state.props.onChrome = function (v) { state.props.chrome = v; render() }
      try {
        document.addEventListener('mousemove', function (e) {
          try {
            const v = (e && typeof e.clientY === 'number' && e.clientY <= 96) ? 'on' : 'off'
            if (state.props.chrome !== v) { state.props.chrome = v; render() }
          } catch { /* ignore */ }
        }, { passive: true })
      } catch { /* ignore */ }

      setTimeout(function () { reportToHost({ stage: 'ready', warnings: warnings }) }, 1500)
    }

    module.exports = {
      name: 'classroom-stage-warm',
      inject: inject,
      apply: apply,
      // 供离线自检用（不参与运行时）
      __test: {
        readMessages: readMessages,
        // K0 / K1.3 / K2.3 / 口型源（纯函数区的入口，test/20 用它们跑单测）
        createStageBridge: createStageBridge,
        stripEmotionMarkers: stripEmotionMarkers,
        boardEventOf: boardEventOf,
        latestBoardOf: latestBoardOf,
        shouldAutoOpenBoard: shouldAutoOpenBoard,
        createTextCadenceMouth: createTextCadenceMouth,
        normalizeMermaidSvg: normalizeMermaidSvg,
        contentTextOf: contentTextOf,
        teacherNameShort: teacherNameShort,
        classifyBlocks: classifyBlocks,
        readUserText: readUserText,
        titleOf: titleOf,
        CSS: CSS,
        live: live,
        store: store,
        sendBox: sendBox,
        StageRoot: StageRoot,
        SessionSensor: SessionSensor,
      },
    }
    return module.exports
  },
})
