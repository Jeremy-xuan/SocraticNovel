// ============================================================
// SAKIKO（丰川祥子）for DSH — Client half (v3)
// 功能：深蓝全局主题；丰川祥子 Live2D 常驻右侧栏（details 列）；
//   设置页；侧边栏打开按钮；配置与状态轮询。
// 说明：本文件内容即动态 Cordis 插件的 client 函数体（return {...}）。
// ============================================================
// 静态版 client（由 tools/build_static.mjs 生成，勿手改）
import React from 'react'

export const inject = ['timer', 'slots']
export function apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const layout = ctx.get('layout')    // ---------------- 静态版桥接（host → fetch；styles → DOM） ----------------
    const hostLocal = {
      call: async (m, args) => {
        const res = await fetch('/sakiko/rpc?m=' + encodeURIComponent(m) + '&args=' + encodeURIComponent(JSON.stringify(args || {})), { cache: 'no-store' })
        return await res.json()
      },
    }
    function domCss(css) {
      const st = document.createElement('style')
      st.textContent = css
      document.head.appendChild(st)
      return () => { try { st.remove() } catch (e) { /* ignore */ } }
    }


    // ---------------- 样式 ----------------
    const removeCss = domCss(
      ".amad-col{display:flex;flex-direction:column;height:100%;min-height:440px;background:var(--dsw-alias-bg-base,transparent);border-left:1px solid var(--dsw-alias-border-l1,transparent);}" +
      ".amad-header{display:flex;align-items:center;gap:6px;padding:8px 10px;user-select:none;background:linear-gradient(90deg,rgba(19,32,63,.55),rgba(20,33,60,.22));border-bottom:1px solid rgba(255,255,255,.1);flex:none;}" +
      ".amad-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none;}" +
      ".amad-title{font-weight:700;letter-spacing:2px;color:var(--dsw-alias-label-primary,#eef2fb);font-size:13px;}" +
      ".amad-sub{font-size:10px;color:var(--dsw-alias-label-secondary,#a8b6d8);margin-right:auto;}" +
      ".amad-btn{border:0;background:rgba(255,255,255,.08);color:inherit;width:24px;height:24px;border-radius:6px;font-size:12px;cursor:pointer;line-height:1;padding:0;flex:none;}" +
      ".amad-btn:hover{background:rgba(255,255,255,.18);}" +
      ".amad-frame{flex:1;min-height:300px;width:100%;border:0;display:block;background:transparent;}" +
      ".amad-footer{padding:4px 10px;font-size:10px;color:var(--dsw-alias-label-secondary,#7688ad);border-top:1px solid rgba(255,255,255,.08);flex:none;}" +
      ".amad-settings-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 4px;border-bottom:1px solid rgba(128,128,128,.18);}" +
      ".amad-settings-label{font-weight:600;}" +
      ".amad-settings-desc{font-size:12px;color:#a8b6d8;margin-top:2px;}" +
      ".amad-settings select{border:1px solid rgba(128,128,128,.4);border-radius:6px;padding:4px 8px;background:transparent;color:inherit;}" +
      ".amad-settings-btn{border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;border-radius:6px;padding:5px 12px;cursor:pointer;margin-right:8px;}" +
      ".amad-settings-btn:hover{background:rgba(128,128,128,.15);}" +
      ".amad-sb-btn{border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px;padding:6px 10px;border-radius:6px;display:flex;align-items:center;gap:6px;}" +
      ".amad-sb-btn:hover{background:rgba(128,128,128,.15);}" +
      ".amad-warn{margin-top:14px;font-size:12px;color:#e0a06a;}" +
      // ---------------- 浮窗壳（FloatShell）样式（Ruling P5：无外框 chrome，仅手机本体；P5 补充：壳透明化；
      // P6 补丁 2：36px 圆角 + 深蓝深端色 #0c1428 填充四角弧口 + 环绕双影，消除四角白斑） ----------------
      ".amad-float-shell{pointer-events:auto;position:fixed;display:block;border:0;border-radius:36px;background:#0c1428;box-shadow:0 8px 28px rgba(0,0,0,.5),0 0 40px rgba(0,0,0,.38);overflow:hidden;user-select:none;}" +
      ".amad-float-body{position:absolute;inset:0;display:block;}" +
      // 2026-09-15「浮窗四角白边」修复（黑底矩阵实测，逐条排除后唯一有效机制）：
      //   Chrome 给子框架文档画布填**不透明白**（html/body 的 background:transparent 只作用于元素，
      //   不作用于画布 —— 实测清空面板内容后整块 iframe 呈纯白 255,255,255），且
      //   **composited iframe 会逃逸祖先的 overflow:hidden + border-radius 圆角裁切**。
      //   因此下列手段全部无效（黑底实测，圆角外白像素 12400~28651 一个都没消掉）：
      //   壳的圆角边框 / 同色 border / 同色画布 / clip-path(壳·body·root) / contain:paint /
      //   transform / filter / isolation / iframe 自身 border-radius。
      //   唯一有效：给 **iframe 自身**加圆角遮罩 —— mask 由合成器作用在 iframe 自己的层上，
      //   圆角半径 36px 与 #phone 的 36px、外壳的 36px 同 rect 同心，故白边被彻底裁掉且轮廓完全对齐。
      //   写法要点（两种踩过的坑）：data URI 里的 SVG 是独立 XML 文档，**属性值必须加引号**；
      //   且必须带 `;utf8` 参数并让 CSS 侧用双引号包裹（SVG 属性用单引号）——
      //   整串百分号编码那种写法实测会让 mask 图像加载失败，导致 iframe 被整个遮没。
      ".amad-float-frame{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:transparent;pointer-events:auto;" +
        "-webkit-mask-image:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><rect width='100%' height='100%' rx='36' ry='36' fill='%23fff'/></svg>\");" +
        "-webkit-mask-size:100% 100%;-webkit-mask-repeat:no-repeat;" +
        "mask-image:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><rect width='100%' height='100%' rx='36' ry='36' fill='%23fff'/></svg>\");" +
        "mask-size:100% 100%;mask-repeat:no-repeat;}" +
      ".amad-float-strip{position:absolute;top:0;left:0;right:0;height:10px;cursor:move;touch-action:none;z-index:6;pointer-events:auto;}" +
      ".amad-float-strip:hover{background:rgba(255,255,255,.08);}" +
      ".amad-float-chrome{position:absolute;top:16px;left:10px;display:flex;gap:6px;z-index:7;opacity:0;transition:opacity .15s;pointer-events:none;}" +
      ".amad-float-shell:hover .amad-float-chrome{opacity:1;pointer-events:auto;}" +
      ".amad-float-btn{width:20px;height:20px;border-radius:50%;border:1px solid rgba(238,242,251,.28);background:rgba(10,16,32,.6);color:#eef2fb;font-size:12px;line-height:1;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);}" +
      ".amad-float-btn:hover{background:rgba(143,179,255,.35);color:#fff;}" +
      "@media (hover: hover){.amad-float-shell:hover .amad-float-chrome{opacity:1;pointer-events:auto;}.amad-float-shell:hover .amad-float-grip{opacity:1;pointer-events:auto;}}@media (hover: none){.amad-float-chrome{opacity:.55;pointer-events:auto;}.amad-float-grip{opacity:.5;pointer-events:auto;}}" +
      ".amad-float-grip{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;touch-action:none;z-index:6;opacity:0;transition:opacity .15s;pointer-events:none;background:linear-gradient(135deg,rgba(255,255,255,0) 55%,rgba(255,255,255,.6) 55%);border-bottom-right-radius:8px;}" +
      ".amad-float-grip:hover{opacity:1;background:linear-gradient(135deg,rgba(255,255,255,0) 45%,rgba(255,255,255,.9) 45%);}" +
      ".amad-float-dot{pointer-events:auto;position:fixed;right:24px;bottom:24px;width:48px;height:48px;border-radius:50%;border:1px solid rgba(143,179,255,.55);background:linear-gradient(160deg,rgba(30,46,92,.95),rgba(15,24,48,.98));color:#8fb3ff;font-size:18px;font-weight:700;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.45);user-select:none;}" +
      ".amad-float-dot:hover{background:linear-gradient(160deg,rgba(45,66,122,.95),rgba(22,36,70,.98));color:#eef2fb;}"
    )
    ctx.effect(() => removeCss)

    // ---------------- SAKIKO 全局主题（强制深蓝：light/dark 均取暗色） ----------------
    const theme = ctx.get('theme')
    const SAKIKO_TOKENS = {
      '--dsw-alias-bg-base': { light: '#0a1020', dark: '#0a1020' },
      '--dsw-alias-bg-layer-1': { light: '#0f1830', dark: '#0f1830' },
      '--dsw-alias-bg-layer-2': { light: '#141f3a', dark: '#141f3a' },
      '--dsw-alias-bg-overlay': { light: '#1a2747', dark: '#1a2747' },
      '--dsw-alias-border-l1': { light: '#26365c', dark: '#26365c' },
      '--dsw-alias-border-l2': { light: '#3a4f7f', dark: '#3a4f7f' },
      '--dsw-alias-brand-primary': { light: '#8fb3ff', dark: '#8fb3ff' },
      '--dsw-alias-label-primary': { light: '#eef2fb', dark: '#eef2fb' },
      '--dsw-alias-label-secondary': { light: '#a8b6d8', dark: '#a8b6d8' },
      '--dsw-alias-state-error-primary': { light: '#ff7b6b', dark: '#ff7b6b' },
      '--dsw-alias-state-success-primary': { light: '#7fd47f', dark: '#7fd47f' },
      '--dsw-alias-state-warn-primary': { light: '#e0a06a', dark: '#e0a06a' },
      '--dsw-specific-sidebar-fill': { light: '#080d1a', dark: '#080d1a' },
    }
    let themeLayer = null
    function applyTheme(on) {
      if (theme === undefined) return
      if (on && themeLayer === null) {
        try {
          themeLayer = theme.overrideTokens('sakiko-theme', SAKIKO_TOKENS)
        } catch (e) {
          console.error('[sakiko] 主题覆盖失败', e)
          themeLayer = null
        }
      } else if (!on && themeLayer !== null) {
        try { themeLayer() } catch (e) { /* ignore */ }
        themeLayer = null
      }
    }

    // ---------------- 微 store ----------------
    function createStore(initial) {
      let value = initial
      const subs = []
      return {
        get: () => value,
        set: (next) => {
          if (next === value) return
          value = next
          for (let i = 0; i < subs.length; i++) subs[i]()
        },
        subscribe: (fn) => {
          subs.push(fn)
          return () => {
            const i = subs.indexOf(fn)
            if (i >= 0) subs.splice(i, 1)
          }
        },
      }
    }

    function useStore(store) {
      const [v, setV] = React.useState(store.get())
      React.useEffect(() => store.subscribe(() => setV(store.get())), [])
      return v
    }

    const configStore = createStore(null)
    const statusStore = createStore({ tts: '', queue: 0, cache: 0, error: '', callPending: false, pendingClose: null })

    function encURI(s) {
      const bytes = new TextEncoder().encode(String(s))
      let out = ''
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i]
        const c = String.fromCharCode(b)
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-' || c === '_' || c === '.' || c === '~') out += c
        else out += '%' + (b < 16 ? '0' : '') + b.toString(16).toUpperCase()
      }
      return out
    }

    let lastConfigJson = ''
    let lastStatusJson = ''
    let lastCallPending = false
    let lastPendingClose = null

    async function refreshStatus() {
      try {
        const res = await hostLocal.call('getStatus', {})
        if (res && typeof res === 'object') {
          const cfg = res.config || null
          let cfgJson = ''
          try { cfgJson = cfg ? JSON.stringify(cfg) : '' } catch (e) { cfgJson = '' }
          if (cfgJson !== lastConfigJson) {
            lastConfigJson = cfgJson
            configStore.set(cfg)
            applyTheme(cfg ? cfg.themeOn !== false : true)
            layoutModeSync(cfg)
          }
          const st = { tts: res.tts || '', queue: res.queue || 0, cache: res.cache || 0, error: '', callPending: res.callPending === true, pendingClose: typeof res.pendingClose === 'number' ? res.pendingClose : null }
          const stJson = JSON.stringify(st)
          if (stJson !== lastStatusJson) {
            lastStatusJson = stJson
            statusStore.set(st)
          }
          // 来电 → 浮窗模式展开浮窗；legacy 自动展开右侧栏
          if (res.callPending === true && !lastCallPending) {
            lastCallPending = true
            if (isFloatOn()) {
              if (floatStore.get().collapsed) expandFloatShell()
            } else {
              openDetailsSafe()
            }
          }
          if (res.callPending !== true) lastCallPending = false
          // 面板请求关闭 SAKIKO 系统 → 浮窗模式收起为圆标 / legacy 收起右侧栏并确认
          if (typeof res.pendingClose === 'number' && res.pendingClose !== lastPendingClose) {
            lastPendingClose = res.pendingClose
            if (isFloatOn()) {
              if (!floatStore.get().collapsed) collapseFloatShell()
            } else {
              try { if (layout) layout.closeDetails() } catch (e) { /* ignore */ }
            }
            hostLocal.call('ackClose', {}).catch(() => {})
          }
          if (typeof res.pendingClose !== 'number') lastPendingClose = null
        }
      } catch (e) {
        const st = { tts: '', queue: 0, cache: 0, error: String(e && e.message ? e.message : e) }
        const stJson = JSON.stringify(st)
        if (stJson !== lastStatusJson) {
          lastStatusJson = stJson
          statusStore.set(st)
        }
      }
    }

    async function patchConfig(patch) {
      try {
        const next = await hostLocal.call('setConfig', patch)
        if (next && typeof next === 'object') {
          configStore.set(next)
          layoutModeSync(next)
        }
        return next
      } catch (e) {
        console.error('[sakiko] setConfig failed', e)
        return null
      }
    }

    // P8：hexDarken —— 按倍率压暗 6 位 hex（机身色单色 → 浮窗壳四角深色），非法输入回退原深端 #0c1428
    function hexDarken(hex, f) {
      if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return '#0c1428'
      const r = Math.round(parseInt(hex.slice(1, 3), 16) * f)
      const g = Math.round(parseInt(hex.slice(3, 5), 16) * f)
      const b = Math.round(parseInt(hex.slice(5, 7), 16) * f)
      return '#' + [r, g, b].map((v) => ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2)).join('')
    }

    async function rpcSay(text) {
      try { return await hostLocal.call('say', { text }) } catch (e) { return { ok: false } }
    }
    async function rpcRepeat() {
      try { return await hostLocal.call('repeat', {}) } catch (e) { return { ok: false } }
    }
    async function rpcClear() {
      try { return await hostLocal.call('clear', {}) } catch (e) { return { ok: false } }
    }

    async function rpcTestChat() {
      try { return await hostLocal.call('testChat', {}) } catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) } }
    }

    async function rpcReport(msg) {
      try { await hostLocal.call('clientReport', { msg: String(msg).slice(0, 250) }) } catch (e) { /* ignore */ }
    }

    function openDetailsSafe() {
      if (layout === undefined) return
      if (isFloatOn()) return // 浮窗模式：不打开右侧详情列
      try { layout.openDetails() } catch (e) { /* ignore */ }
    }

    // 布局模式切换（floatPanel 变化时跟随）：浮窗模式收拢右侧列，legacy 模式自动展开
    let lastLayoutMode = null
    function layoutModeSync(cfg) {
      if (!cfg) return
      const floatMode = cfg.floatPanel !== false
      if (floatMode === lastLayoutMode) return
      lastLayoutMode = floatMode
      if (floatMode) {
        try { if (layout) layout.closeDetails() } catch (e) { /* ignore */ }
      } else {
        openDetailsSafe()
      }
    }


    rpcReport('client apply start')

    // iframe 引用与初始 src（模块级单例）
    let iframeEl = null
    let panelSrc = '/sakiko/panel.html'
    let panelSrcSet = false
    let lastSentCfg = ''

    function notifyOpen() {
      if (!iframeEl || !iframeEl.contentWindow) return
      try { iframeEl.contentWindow.postMessage({ type: 'sakiko/open' }, '*') } catch (e) { /* iframe 未就绪 */ }
    }

    function iframeSrc(config) {
      let q = ''
      try { q = encURI(JSON.stringify(config || {})) } catch (e) { q = '' }
      return '/sakiko/panel.html' + (q ? '?cfg=' + q : '')
    }

    // ---------------- 轮询根组件（始终渲染 null） ----------------
    function RootPoller() {
      React.useEffect(() => {
        refreshStatus().then(() => rpcReport('rpc getStatus ok'))
        const dispose = ctx.interval(refreshStatus, 2000)
        return dispose
      }, [])
      return null
    }

    // ---------------- 浮窗壳（FloatShell）几何 / localStorage 记忆 ----------------
    const FLOAT_KEY = 'sakiko.float.v2'
    // 插件改名（amadeus→sakiko）前的老键：读一次迁移到新键，面板位置/大小不丢
    const FLOAT_KEY_LEGACY = 'amadeus.float.v2'
    const FLOAT_DEF_W = 320
    const FLOAT_DEF_H = 640
    const FLOAT_MIN_W = 320
    const FLOAT_MIN_H = 480
    const FLOAT_GAP = 24

    function floatViewport() {
      return { vw: window.innerWidth || 0, vh: window.innerHeight || 0 }
    }

    function clampFloatRect(rect) {
      const { vw, vh } = floatViewport()
      const minW = Math.min(FLOAT_MIN_W, vw)
      const minH = Math.min(FLOAT_MIN_H, vh)
      const w = Math.round(Math.min(Math.max(rect.w, minW), vw))
      const h = Math.round(Math.min(Math.max(rect.h, minH), vh))
      const x = Math.round(Math.min(Math.max(rect.x, 0), Math.max(0, vw - w)))
      const y = Math.round(Math.min(Math.max(rect.y, 0), Math.max(0, vh - h)))
      return { x: x, y: y, w: w, h: h }
    }

    function defaultFloatState() {
      const { vw, vh } = floatViewport()
      const w = Math.min(FLOAT_DEF_W, vw)
      const h = Math.min(FLOAT_DEF_H, vh)
      const r = clampFloatRect({ x: vw - w - FLOAT_GAP, y: vh - h - FLOAT_GAP, w: w, h: h })
      return { x: r.x, y: r.y, w: r.w, h: r.h, collapsed: false }
    }

    function loadFloatState() {
      let raw = null
      try {
        raw = JSON.parse(localStorage.getItem(FLOAT_KEY) || 'null')
        // 新键没有就回落到改名前的旧键（迁移；随后 saveFloatState 会写进新键）
        if (!raw) raw = JSON.parse(localStorage.getItem(FLOAT_KEY_LEGACY) || 'null')
      } catch (e) {
        raw = null
      }
      const fallback = defaultFloatState()
      let state = fallback
      if (raw && typeof raw === 'object') {
        const num = (v) => typeof v === 'number' && Number.isFinite(v)
        if (num(raw.x) && num(raw.y) && num(raw.w) && num(raw.h) && raw.w >= FLOAT_MIN_W && raw.h >= FLOAT_MIN_H) {
          const r = clampFloatRect({ x: raw.x, y: raw.y, w: raw.w, h: raw.h })
          state = { x: r.x, y: r.y, w: r.w, h: r.h, collapsed: raw.collapsed === true }
        }
      }
      // P6 收尾（§5i）：v1 旧键 amadeus.float（400×700 + 旧视口坐标）一律忽略——按全新默认
      // 320×640 + 右下 24 锚定当前视口处理；顺带删除旧键并立即落 v2，此后拖动/缩放记忆在 v2。
      // 注：v2 键已随插件改名由 amadeus.float.v2 → sakiko.float.v2（上方已做一次性迁移）。
      try {
        localStorage.removeItem('amadeus.float')
      } catch (e) { /* 忽略 */ }
      saveFloatState(state)
      return state
    }

    function saveFloatState(state) {
      try {
        localStorage.setItem(FLOAT_KEY, JSON.stringify({ x: state.x, y: state.y, w: state.w, h: state.h, collapsed: state.collapsed === true }))
      } catch (e) {
        /* localStorage 不可用时静默 */
      }
    }

    const floatStore = createStore(loadFloatState())

    function setFloatState(patch) {
      const cur = floatStore.get()
      const merged = Object.assign({}, cur, patch)
      const r = clampFloatRect(merged)
      const next = { x: r.x, y: r.y, w: r.w, h: r.h, collapsed: merged.collapsed === true }
      floatStore.set(next)
      return next
    }

    function isFloatOn() {
      const cfg = configStore.get()
      return !cfg || cfg.floatPanel !== false
    }

    function expandFloatShell() {
      const s = setFloatState({ collapsed: false })
      saveFloatState(s)
    }

    function collapseFloatShell() {
      const s = setFloatState({ collapsed: true })
      saveFloatState(s)
    }


    // ---------------- 面板 iframe 单一组件（浮窗 / 右侧栏共用；同一时刻仅一处装载） ----------------
    function SakikoFrame(props) {
      const config = useStore(configStore)
      const own = React.useRef(null)
      if (config && !panelSrcSet) {
        panelSrcSet = true
        panelSrc = iframeSrc(config)
      }
      // config 变化 → postMessage sakiko/config（既有通道）
      React.useEffect(() => {
        if (!config) return
        let s = ''
        try { s = JSON.stringify(config) } catch (e) { return }
        if (s === lastSentCfg) return
        lastSentCfg = s
        if (iframeEl && iframeEl.contentWindow) {
          try { iframeEl.contentWindow.postMessage({ type: 'sakiko/config', value: config }, '*') } catch (e) { /* iframe 未就绪 */ }
        }
      }, [config])
      const onLoad = () => {
        // 挂载 / 重载后推送一次当前 config，避免 src cfg 过期
        const cfg = configStore.get()
        if (!cfg || !own.current || !own.current.contentWindow) return
        let s = ''
        try { s = JSON.stringify(cfg) } catch (e) { return }
        lastSentCfg = s
        try { own.current.contentWindow.postMessage({ type: 'sakiko/config', value: cfg }, '*') } catch (e) { /* iframe 未就绪 */ }
      }
      // Important-1：config 未到且 src 未 latch 前不渲染 iframe，避免默认 src 整帧重载造成 Live2D 双初始化/欢迎语双播
      if (!config && !panelSrcSet) return null
      return React.createElement('iframe', {
        className: props.cls || 'amad-frame',
        src: panelSrc,
        title: 'Sakiko Live2D',
        allow: 'microphone; camera; autoplay',
        onLoad: onLoad,
        ref: (el) => {
          if (el) {
            own.current = el
            iframeEl = el
          } else {
            if (iframeEl === own.current) iframeEl = null
            own.current = null
          }
        },
      })
    }

    // ---------------- 右侧栏 SAKIKO 列（floatPanel=false 的 legacy 布局；float 模式下不渲染 iframe） ----------------
    function SakikoColumn() {
      const config = useStore(configStore)
      const status = useStore(statusStore)

      React.useEffect(() => {
        rpcReport('column mounted')
        return () => rpcReport('column unmounted')
      }, [])

      if (!config || config.floatPanel !== false) return null

      return React.createElement('div', { className: 'amad-col' },
        React.createElement(SakikoFrame, null),
        React.createElement('div', { className: 'amad-footer' },
          React.createElement('span', null, status.error ? '⚠ host 不可达' : ('● ' + (status.tts || '…') + ' · 队列 ' + status.queue + (status.callPending ? ' · 📞 来电中' : ''))),
        ),
      )
    }

    // ---------------- 浮窗壳（floatPanel!==false 的浮窗布局，挂载于 shell.overlay） ----------------
    const FLOAT_Z = 2147483000

    function FloatShell() {
      const f = useStore(floatStore)
      const config = useStore(configStore)
      const dragRef = React.useRef(null)
      const [interacting, setInteracting] = React.useState(null)

      React.useEffect(() => {
        if (!interacting) return
        const base = dragRef.current
        if (!base) return
        const onMove = (ev) => {
          const dx = ev.clientX - base.sx
          const dy = ev.clientY - base.sy
          if (base.kind === 'move') {
            setFloatState({ x: base.x + dx, y: base.y + dy })
          } else {
            const vw = window.innerWidth || 0
            const vh = window.innerHeight || 0
            const minW = Math.min(FLOAT_MIN_W, vw)
            const minH = Math.min(FLOAT_MIN_H, vh)
            // 右/下边界跟随手柄：允许的最小 x/y 保证 min 尺寸可容纳
            const x0 = Math.min(base.x, Math.max(0, vw - minW))
            const y0 = Math.min(base.y, Math.max(0, vh - minH))
            const w = Math.round(Math.min(Math.max(base.w + dx, minW), Math.max(minW, vw - x0)))
            const h = Math.round(Math.min(Math.max(base.h + dy, minH), Math.max(minH, vh - y0)))
            setFloatState({ x: x0, y: y0, w: w, h: h })
          }
        }
        const onUp = () => {
          setInteracting(null)
          dragRef.current = null
          saveFloatState(floatStore.get())
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
        return () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
        }
      }, [interacting])

      const startDrag = (kind, ev) => {
        if (ev.button !== 0 && ev.pointerType === 'mouse') return
        const s = floatStore.get()
        dragRef.current = { kind: kind, sx: ev.clientX, sy: ev.clientY, x: s.x, y: s.y, w: s.w, h: s.h }
        setInteracting(kind)
        try { ev.currentTarget.setPointerCapture(ev.pointerId) } catch (e) { /* ignore */ }
        ev.preventDefault()
      }

      const onHide = () => {
        const s = setFloatState({ collapsed: true })
        saveFloatState(s)
      }
      const onExpand = () => {
        const s = setFloatState({ collapsed: false })
        saveFloatState(s)
        notifyOpen()
      }
      const onReset = () => {
        // ⤢：还原默认窗口大小与位置（Ruling P2 默认 400×700 / 右下角 24）
        const d = defaultFloatState()
        const s = setFloatState({ x: d.x, y: d.y, w: d.w, h: d.h, collapsed: false })
        saveFloatState(s)
      }

      // P8：浮窗壳四角深色随 config.colorBezel 单色派生（hexDarken 深端）；未定义回退 CSS #0c1428
      //
      // 2026-09-15「浮窗四角白边」修复（黑底矩阵实测，逐条排除后唯一有效机制）：
      //   Chrome 给子框架文档画布填**不透明白**（html/body 的 background:transparent 只作用于元素、
      //   不作用于画布 —— 实测清空面板内容后整块 iframe 呈纯白 255,255,255），且
      //   **composited iframe 会逃逸祖先的 overflow:hidden + border-radius 圆角裁切**。
      //   所以下面这些手段全都无效（黑底实测，圆角外白像素 12400~28651，一个都没消掉）：
      //   壳的圆角边框 / 同色 border / 同色画布 / clip-path（壳·body·root）/ contain:paint /
      //   transform / filter / isolation / iframe 自身 border-radius。
      //   唯一有效的是给 **iframe 自身**加圆角遮罩（见上面 .amad-float-frame 的 mask-image）：
      //   mask 由合成器作用在 iframe 自己的层上，圆角 36px 与 #phone、外壳的 36px 同 rect 同心，
      //   白边被彻底裁掉、轮廓完全对齐。
      //   ⚠ 本文件（client.mjs）是源码，client.js 是构建产物，**两者必须一致**：曾因为只改了产物、
      //   源码里还留着「同色 border + box-sizing」的旧 hack，险些在下次同步时把已修好的白边带回来。
      const shellCornerFill = hexDarken((config && config.colorBezel) || '#223058', 0.41)
      const shellStyle = {
        left: f.x + 'px',
        top: f.y + 'px',
        width: f.w + 'px',
        height: f.h + 'px',
        zIndex: FLOAT_Z,
        display: f.collapsed ? 'none' : 'block',
        background: shellCornerFill,
      }

      return React.createElement('div', { className: 'amad-float-root' },
        React.createElement('div', { className: 'amad-float-shell', style: shellStyle },
          React.createElement('div', { className: 'amad-float-strip', onPointerDown: (ev) => startDrag('move', ev) }),
          React.createElement('div', { className: 'amad-float-body' },
            React.createElement(SakikoFrame, { cls: 'amad-float-frame' }),
          ),
          React.createElement('div', { className: 'amad-float-chrome' },
            React.createElement('button', {
              className: 'amad-float-btn',
              title: '收起 SAKIKO',
              'aria-label': '收起 SAKIKO',
              onPointerDown: (ev) => ev.stopPropagation(),
              onClick: onHide,
            }, '—'),
            React.createElement('button', {
              className: 'amad-float-btn',
              title: '还原默认大小与位置',
              'aria-label': '还原默认大小与位置',
              onPointerDown: (ev) => ev.stopPropagation(),
              onClick: onReset,
            }, '⤢'),
          ),
          React.createElement('div', { className: 'amad-float-grip', onPointerDown: (ev) => startDrag('resize', ev) }),
        ),
        f.collapsed
          ? React.createElement('button', {
              className: 'amad-float-dot',
              title: '展开 SAKIKO',
              'aria-label': '展开 SAKIKO',
              onClick: onExpand,
            }, 'S')
          : null,
      )
    }

    // shell.overlay 常驻宿主：轮询始终运行；float 模式渲染浮窗壳
    function FloatHost() {
      const config = useStore(configStore)
      const floatOn = !config || config.floatPanel !== false
      return React.createElement('div', { className: 'amad-float-host', style: { pointerEvents: 'none' } },
        React.createElement(RootPoller),
        floatOn ? React.createElement(FloatShell) : null,
      )
    }


    // ---------------- 设置页 ----------------
    const VOICES = [
      ['ja-JP-NanamiNeural', 'Nanami（女声，默认）'],
      ['ja-JP-KeitaNeural', 'Keita（男声）'],
      ['ja-JP-AoiNeural', 'Aoi（女声）'],
      ['ja-JP-MayuNeural', 'Mayu（女声）'],
      ['ja-JP-ShioriNeural', 'Shiori（女声）'],
      ['ja-JP-NaokiNeural', 'Naoki（男声）'],
      ['ja-JP-DaichiNeural', 'Daichi（男声）'],
    ]
    const RATES = ['-20%', '-10%', '+0%', '+10%', '+20%']
    const PITCHES = ['-20Hz', '-10Hz', '+0Hz', '+10Hz', '+20Hz']

    function Row(props) {
      return React.createElement('div', { className: 'amad-settings-row' },
        React.createElement('div', null,
          React.createElement('div', { className: 'amad-settings-label' }, props.label),
          props.desc ? React.createElement('div', { className: 'amad-settings-desc' }, props.desc) : null,
        ),
        props.control,
      )
    }

    function Check(props) {
      return React.createElement('input', {
        type: 'checkbox',
        checked: !!props.checked,
        onChange: (e) => props.onChange(!!e.target.checked),
      })
    }

    function Select(props) {
      const options = props.options.map((o) => React.createElement('option', { key: o[0], value: o[0] }, o[1]))
      return React.createElement('select', {
        value: props.value,
        onChange: (e) => props.onChange(e.target.value),
      }, options)
    }

    function TextInput(props) {
      return React.createElement('input', {
        type: props.type || 'text',
        value: props.value || '',
        placeholder: props.placeholder || '',
        onChange: (e) => props.onChange(e.target.value),
        style: { flex: 1, minWidth: 0, border: '1px solid rgba(128,128,128,.4)', borderRadius: '6px', padding: '4px 8px', background: 'transparent', color: 'inherit' },
      })
    }

    // P7：外观与布局——颜色取色器（<input type=color> + 只读 hex 回显）
    function ColorControl(props) {
      return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        React.createElement('input', {
          type: 'color',
          value: props.value || '#000000',
          onChange: (e) => props.onChange(e.target.value),
          style: { width: '28px', height: '28px', border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' },
        }),
        React.createElement('span', { style: { fontSize: '11px', fontFamily: 'monospace', color: 'inherit', opacity: 0.75, minWidth: '52px' } }, String(props.value || '').toUpperCase()),
      )
    }

    function SakikoSettings() {
      const config = useStore(configStore)
      const status = useStore(statusStore)
      if (!config) {
        return React.createElement('div', null,
          React.createElement('div', { className: 'amad-settings-row' }, React.createElement('span', null, status.error ? '⚠ 无法连接 SAKIKO Host：' + status.error : '正在连接 SAKIKO Host…')),
        )
      }
      const group = (title) => React.createElement('div', { style: { marginTop: '18px', marginBottom: '4px', fontSize: '12px', fontWeight: 700, letterSpacing: '1px', color: '#c9a86a', textTransform: 'uppercase' } }, title)
      const idleOptions = [[300000, '5 分钟'], [600000, '10 分钟'], [1200000, '20 分钟（默认）'], [1800000, '30 分钟'], [3600000, '60 分钟']]
      const pickIdle = (v) => idleOptions.find((o) => o[0] === v) ? v : 1200000
      const humOptions = [[300000, '5 分钟'], [600000, '10 分钟'], [1200000, '20 分钟（默认）'], [1800000, '30 分钟'], [3600000, '60 分钟']]
      const pickHum = (v) => humOptions.find((o) => o[0] === v) ? v : 1200000
      const narratorOptions = [[120000, '2 分钟'], [240000, '4 分钟（默认）'], [360000, '6 分钟'], [600000, '10 分钟']]
      const pickNarr = (v) => narratorOptions.find((o) => o[0] === v) ? v : 240000
      // 里程碑「步数型」周期（与 narratorOptions 同款：Select + 兜底 pickSteps；非法/未知值一律显示 50）。
      // 5 个档位都落在 sanitize 可用区间（host.mjs 里 narratorMilestoneSteps 的 3~200；默认 50）之内；区间内其它合法值无档位、显示为兜底的 50。
      const stepOptions = [[10, '10 步'], [20, '20 步'], [50, '50 步（默认）'], [100, '100 步'], [200, '200 步']]
      const pickSteps = (v) => stepOptions.find((o) => o[0] === v) ? v : 50
      // 播报总结的助手文本预算（可见字符）：0 = 不注入「アシスタントの最後の応答」整行；
      // 与 narratorOptions 同款（Select + 兜底 pickNarrChars，非法/未知值一律显示 400，不会写坏其它设置项）
      const narrCharsOptions = [[0, '不注入（关闭）'], [200, '200 字'], [400, '400 字（默认）'], [600, '600 字'], [800, '800 字'], [1200, '1200 字'], [2000, '2000 字']]
      const pickNarrChars = (v) => narrCharsOptions.find((o) => o[0] === v) ? v : 400
      return React.createElement('div', null,
        group('基本开关'),
        Row({ label: '语音朗读', desc: '助手回复自动由 SAKIKO 朗读', control: Check({ checked: config.voiceOn !== false, onChange: (v) => patchConfig({ voiceOn: v }) }) }),
        Row({ label: 'AI 聊天', desc: '右栏底部与 SAKIKO 直接对话（日语音频 + 中文文字，带长期记忆）', control: Check({ checked: config.chatOn !== false, onChange: (v) => patchConfig({ chatOn: v }) }) }),
        Row({ label: '空闲闲聊', desc: '长时间不互动时，她主动找话题开口说话', control: Check({ checked: config.idleChatOn !== false, onChange: (v) => patchConfig({ idleChatOn: v }) }) }),
        Row({ label: '祥子人格注入', desc: '让 Agent 以祥子口吻回答，作用于所有会话', control: Check({ checked: config.personaOn === true, onChange: (v) => patchConfig({ personaOn: v }) }) }),
        Row({ label: 'SAKIKO 全局主题', desc: '整套 GUI 强制深蓝 SAKIKO 配色（插件停止后自动还原）', control: Check({ checked: config.themeOn !== false, onChange: (v) => patchConfig({ themeOn: v }) }) }),

        group('AI 聊天（独立 API，留空则用 DSH 默认模型）'),
        Row({ label: 'API 地址', desc: 'OpenAI 兼容格式', control: TextInput({ value: config.chatBaseUrl, placeholder: 'https://api.deepseek.com/v1', onChange: (v) => patchConfig({ chatBaseUrl: v }) }) }),
        Row({ label: '模型名', control: TextInput({ value: config.chatModel, placeholder: 'deepseek-chat', onChange: (v) => patchConfig({ chatModel: v }) }) }),
        Row({ label: 'API Key', desc: '留空 = 使用 DSH 默认模型通道', control: TextInput({ type: 'password', value: config.chatApiKey, placeholder: 'sk-…', onChange: (v) => patchConfig({ chatApiKey: v }) }) }),

        group('语音合成'),
        Row({ label: 'TTS 通道', desc: '为保证声线统一，默认不自动切换音色', control: Select({ value: config.provider, options: [['edge', 'Edge TTS（默认，稳定）'], ['voicevox', '本地 VOICEVOX'], ['quest', 'VOICEVOX 公共 API'], ['aqua', '本地 Aqua-TTS / GPT-SoVITS'], ['openai', 'OpenAI 兼容 TTS'], ['auto', '自动（Aqua→VOICEVOX，仅在显式开启时切公共）']], onChange: (v) => patchConfig({ provider: v }) }) }),
        Row({ label: '音色', control: Select({ value: config.voiceName, options: VOICES, onChange: (v) => patchConfig({ voiceName: v }) }) }),
        Row({ label: '合成档位（aqua）', desc: '本地祥子音色的采样步数：极速更快，精细更稳（当前音色: ' + (config.aquaVoice || 'sakiko') + '）', control: Select({ value: config.aquaPreset || 'balanced', options: [['fast', '极速（6步）'], ['balanced', '标准（10步）'], ['quality', '精细（16步）']], onChange: (v) => patchConfig({ aquaPreset: v }) }) }),
        Row({ label: '语速', control: Select({ value: config.rate, options: RATES.map((r) => [r, r]), onChange: (v) => patchConfig({ rate: v }) }) }),
        Row({ label: '音调', control: Select({ value: config.pitch, options: PITCHES.map((p) => [p, p]), onChange: (v) => patchConfig({ pitch: v }) }) }),
        Row({ label: '情绪强度', desc: '放大/减弱情绪 prosody（0.5~2.0，默认 1.0）', control: Select({ value: String(config.emotionIntensity || 1.0), options: [['0.5', '0.5（克制）'], ['0.75', '0.75'], ['1', '1.0（默认）'], ['1.2', '1.2（稍夸张）'], ['1.5', '1.5（夸张）'], ['2', '2.0（极夸张）']], onChange: (v) => patchConfig({ emotionIntensity: Number(v) }) }) }),
        Row({ label: '保持声线稳定', desc: '开启后 TTS 失败也不切到其它音色（推荐）', control: Check({ checked: config.voiceStability !== false, onChange: (v) => patchConfig({ voiceStability: v }) }) }),
        Row({ label: '失败切公共 API', desc: '仅当“保持声线稳定”关闭时生效', control: Check({ checked: config.fallbackToQuest === true, onChange: (v) => patchConfig({ fallbackToQuest: v }) }) }),

        group('语音输入'),
        Row({ label: '识别方式', control: Select({ value: config.sttProvider || 'auto', options: [['auto', '自动（优先浏览器识别）'], ['browser', '仅浏览器识别'], ['api', '后端 Whisper API']], onChange: (v) => patchConfig({ sttProvider: v }) }) }),
        Row({ label: 'STT API 地址', desc: '留空使用 AI API 地址', control: TextInput({ value: config.sttApiUrl, placeholder: 'https://api.openai.com/v1', onChange: (v) => patchConfig({ sttApiUrl: v }) }) }),
        Row({ label: 'STT API Key', desc: '留空使用 AI API Key', control: TextInput({ type: 'password', value: config.sttApiKey, placeholder: 'sk-…', onChange: (v) => patchConfig({ sttApiKey: v }) }) }),
        Row({ label: 'STT 模型', control: TextInput({ value: config.sttModel || 'whisper-1', placeholder: 'whisper-1', onChange: (v) => patchConfig({ sttModel: v }) }) }),

        group('主动互动节奏'),
        Row({ label: '空闲多久开口', control: Select({ value: pickIdle(config.idleChatMs), options: idleOptions, onChange: (v) => patchConfig({ idleChatMs: Number(v) }) }) }),
        Row({ label: '随机哼歌', desc: '她心情好时会随机哼一段小曲（彩蛋）', control: Check({ checked: config.humOn !== false, onChange: (v) => patchConfig({ humOn: v }) }) }),
        Row({ label: '哼歌间隔', control: Select({ value: pickHum(config.humIntervalMs), options: humOptions, onChange: (v) => patchConfig({ humIntervalMs: Number(v) }) }) }),

        group('进度播报'),
        Row({ label: '进度播报', desc: '祥子播报任务进展：开工、完成、里程碑与阻塞', control: Check({ checked: config.narratorOn !== false, onChange: (v) => patchConfig({ narratorOn: v }) }) }),
        Row({ label: 'LLM 回合总结', desc: '每回合完成时由 LLM 总结做了什么+下一步（失败自动退回模板句）', control: Check({ checked: config.narratorLLMSummary !== false, onChange: (v) => patchConfig({ narratorLLMSummary: v }) }) }),
        Row({ label: '每回合完成播报', desc: '关闭后只保留里程碑与阻塞等关键节点', control: Check({ checked: config.narratorDone !== false, onChange: (v) => patchConfig({ narratorDone: v }) }) }),
        Row({ label: '播报子代理会话', desc: '子代理/后台会话的开工与完成也会播报；关闭后不再播报（子代理完成提示仍会保留）', control: Check({ checked: config.narrateSubagents !== false, onChange: (v) => patchConfig({ narrateSubagents: v }) }) }),
        Row({ label: '里程碑间隔', desc: '单回合跑满该时长即播报一次进展', control: Select({ value: pickNarr(config.narratorMilestoneMs), options: narratorOptions, onChange: (v) => patchConfig({ narratorMilestoneMs: Number(v) }) }) }),
        Row({ label: '里程碑步数', desc: '单回合内每满这么多步（工具调用）就再播一条；与「里程碑间隔」任一先到即触发', control: Select({ value: pickSteps(config.narratorMilestoneSteps), options: stepOptions, onChange: (v) => patchConfig({ narratorMilestoneSteps: Number(v) }) }) }),
        Row({ label: '助手文本预算', desc: '总结时喂给 LLM 的「本轮助手回复」字符上限；超出时保留首尾各一段（中间省略）；0 = 不注入该行', control: Select({ value: pickNarrChars(config.narratorAssistantChars), options: narrCharsOptions, onChange: (v) => patchConfig({ narratorAssistantChars: Number(v) }) }) }),

        group('外观与布局'),
        Row({ label: '主题预设', control: Select({ value: config.themePreset || 'sakiko-blue', options: [['sakiko-blue', '深蓝月白金（默认）'], ['midnight-gold', '暮蓝鎏金'], ['sakura-pink', '樱粉月白'], ['mono', '月灰单色']], onChange: (v) => patchConfig({ themePreset: v }) }) }),
        Row({ label: '主底渐变1', control: ColorControl({ value: config.colorBg1, onChange: (v) => patchConfig({ colorBg1: v }) }) }),
        Row({ label: '主底渐变2', control: ColorControl({ value: config.colorBg2, onChange: (v) => patchConfig({ colorBg2: v }) }) }),
        Row({ label: '机身/外框', control: ColorControl({ value: config.colorBezel, onChange: (v) => patchConfig({ colorBezel: v }) }) }),
        Row({ label: '标题文字', control: ColorControl({ value: config.colorTitle, onChange: (v) => patchConfig({ colorTitle: v }) }) }),
        Row({ label: '我方气泡', control: ColorControl({ value: config.colorBubbleMe, onChange: (v) => patchConfig({ colorBubbleMe: v }) }) }),
        Row({ label: '祥子气泡', control: ColorControl({ value: config.colorBubbleHer, onChange: (v) => patchConfig({ colorBubbleHer: v }) }) }),
        Row({ label: '气泡文字', control: ColorControl({ value: config.colorBubbleText, onChange: (v) => patchConfig({ colorBubbleText: v }) }) }),
        Row({ label: '按钮强调', control: ColorControl({ value: config.colorBtn, onChange: (v) => patchConfig({ colorBtn: v }) }) }),
        Row({ label: '高亮文字', control: ColorControl({ value: config.colorHi, onChange: (v) => patchConfig({ colorHi: v }) }) }),
        Row({ label: '状态点', control: ColorControl({ value: config.colorDot, onChange: (v) => patchConfig({ colorDot: v }) }) }),
        Row({ label: '聊天背景图', desc: '留空 = 默认背景；仅支持 http(s)://', control: TextInput({ value: config.chatBgUrl || '', placeholder: 'https://…', onChange: (v) => patchConfig({ chatBgUrl: v.trim() }) }) }),
        Row({ label: '界面布局', desc: '切换为右侧栏时浮窗消失属预期', control: Select({ value: String(config.floatPanel !== false), options: [['true', '浮窗'], ['false', '右侧栏']], onChange: (v) => patchConfig({ floatPanel: v === 'true' }) }) }),
        React.createElement('div', { style: { fontSize: '12px', color: '#a8b6d8', padding: '8px 4px 0' } }, '设置即时生效，可边调边看右下角浮窗。'),
        React.createElement('div', { style: { marginTop: '6px' } },
          React.createElement('button', { className: 'amad-settings-btn', onClick: () => patchConfig({ themePreset: 'sakiko-blue', colorBg1: '#101a33', colorBg2: '#0b1224', colorTitle: '#eef2fb', colorBubbleMe: '#3b6fd4', colorBubbleHer: '#eef2fb', colorBubbleText: '#ffffff', colorBtn: '#c9a86a', colorHi: '#8fb3ff', colorDot: '#a8b6d8', chatBgUrl: '' }) }, '重置为默认外观'),
        ),

        React.createElement('div', { style: { marginTop: '16px' } },
          React.createElement('button', { className: 'amad-settings-btn', onClick: () => rpcSay('申し遅れました 私 豊川祥子と申します') }, '💬 测试语音'),
          React.createElement('button', { className: 'amad-settings-btn', onClick: async () => { const r = await rpcTestChat(); window.alert(r && r.ok ? 'AI API OK: ' + r.content : 'AI API Error: ' + (r && r.error ? r.error : 'unknown')) } }, '🔌 测试 AI API'),
          React.createElement('button', { className: 'amad-settings-btn', onClick: rpcRepeat }, '↺ 重播上一条'),
          React.createElement('button', { className: 'amad-settings-btn', onClick: rpcClear }, '🧹 清空队列'),
          React.createElement('button', { className: 'amad-settings-btn', onClick: () => { notifyOpen(); if (layout) layout.openDetails() } }, '👁 打开右侧栏'),
          React.createElement('button', { className: 'amad-settings-btn', onClick: () => { if (layout) layout.closeDetails() } }, '🚫 关闭右侧栏'),
        ),
        React.createElement('div', { className: 'amad-settings-row', style: { marginTop: '10px' } },
          React.createElement('span', { style: { fontSize: '12px', color: '#a8b6d8' } },
            status.error ? '⚠ host 不可达'
              : ('● ' + (status.tts || '…') + ' · 队列 ' + status.queue + (status.callPending ? ' · 📞 来电中' : '')),
          ),
        ),
        React.createElement('div', { className: 'amad-warn' }, '注意：右侧栏为 SAKIKO（丰川祥子）专用，原「工具详情」面板在插件运行期间被替代，停止插件后恢复。角色版权归 Bushiroad/BanG Dream! 项目；Live2D 模型为粉丝制作，仅供个人学习，禁止商用。'),
      )
    }

    // ---------------- 侧边栏常驻入口（floatPanel=false 的 legacy 布局） ----------------
    function SidebarToggle(props) {
      const config = useStore(configStore)
      const wide = !!(props && props.wide)
      if (!config || config.floatPanel !== false) return null // 浮窗模式隐藏侧边按钮
      return React.createElement('button', {
        className: 'amad-sb-btn',
        title: '打开 SAKIKO 右侧栏',
        onClick: () => { notifyOpen(); if (layout) layout.openDetails() },
      }, wide ? 'SAKIKO' : 'S')
    }

    // ---------------- 槽位注册 ----------------
    slots.inject('details', () => slots.register(
      { name: 'details', priority: -1 },
      () => React.createElement(SakikoColumn),
    ))

    slots.inject('sidebar.footer.action', () => slots.register(
      { name: 'sidebar.footer.action', id: 'sakiko', order: 50, label: 'SAKIKO' },
      (props) => React.createElement(SidebarToggle, props),
    ))

    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'sakiko', order: 60, label: 'SAKIKO' },
      () => React.createElement(FloatHost),
    ))

    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'sakiko', order: 90, label: 'SAKIKO' },
      () => React.createElement('div', null,
        React.createElement('h2', null, 'SAKIKO'),
        React.createElement(SakikoSettings),
      ),
    ))

    // 默认开启全局主题 + 打开右侧栏（多重保障：立即 + 延迟重试 + 连接重置后重试）
    applyTheme(true)
    openDetailsSafe()
    rpcReport('openDetails called (immediate)')
    ctx.timeout(() => {
      openDetailsSafe()
      rpcReport('openDetails retry (2s)')
    }, 2000)
    ctx.on('connection/reset', () => {
      rpcReport('connection/reset -> openDetails')
      openDetailsSafe()
    })
}