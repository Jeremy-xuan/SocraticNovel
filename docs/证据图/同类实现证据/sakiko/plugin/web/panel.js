/* ============================================================
 * SAKIKO iframe panel — 豊川祥子（白祥・CRYCHIC 期）iPhone 直板（v10 重构版）
 *
 * 主要改进：
 *  - Live2D 常驻动画循环：呼吸/眨眼/眼球/头部/身体平滑自然动作
 *  - 口型严格从音频播放开始，词级时间戳 + 音频能量双驱动
 *  - 语音输入：SpeechRecognition 优先，MediaRecorder + /sakiko/stt 兜底
 *  - TTS 音频响应头直接携带词时间戳，不再重复合成取词
 *  - 模型摆位修正：anchor 居中 + 可配置 layout，避免错位
 * ============================================================ */
(function () {
  'use strict'

  var $ = function (id) { return document.getElementById(id) }
  var screenEl = $('screen')
  var phoneEl = $('phone') // Task5-R1: 浮层门控的 state-* class 挂在机身 #phone 上
  var canvas = $('sakiko-canvas')
  var imgEl = $('sakiko-img')
  var placeholderEl = $('sakiko-placeholder')
  var boot = $('boot')
  var bootL1 = $('boot-line1')
  var bootL2 = $('boot-line2')
  var bootL3 = $('boot-line3')
  var unlockEl = $('unlock')
  var unlockBtn = $('unlock-btn')
  var statusChip = $('status-chip')
  var errline = $('errline')
  var chatRow = $('chat-row')
  var chatInput = $('chat-input')
  var chatSend = $('chat-send')
  var chatMic = $('chat-mic')
  var chatLang = $('chat-lang')
  var historyEl = $('history')
  var callOverlay = $('call-overlay')
  var callAccept = $('call-accept')
  var callDeny = $('call-deny')
  // Task5: #call-portrait / kurisu 立绘已弃用（来电改模型直出），不再持有该元素引用
  var ringAudio = $('ring-audio')
  var screenClock = $('screen-clock')
  var calibBtn = $('calib-btn')

  function report(msg) {
    try {
      fetch('/sakiko/report?msg=' + encodeURIComponent(String(msg).slice(0, 380)), { cache: 'no-store' }).catch(function () { /* ignore */ })
    } catch (e) { /* ignore */ }
  }
  function showErr(text) {
    if (!errline) return
    errline.textContent = text
    errline.classList.remove('hidden')
  }
  report('panel v10 loaded')

  window.addEventListener('error', function (ev) {
    var f = (ev.filename || '').split('/').pop()
    report('window error: ' + (ev.message || '?') + ' @' + f + ':' + (ev.lineno || 0))
  })
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason
    report('unhandled rejection: ' + (r && r.message ? r.message : String(r)))
  })

  // ---------------- 配置 ----------------
  var cfg = {
    voiceOn: true,
    personaOn: false,
    themeOn: true,
    chatOn: true,
    callOn: true,
    voiceName: 'ja-JP-NanamiNeural',
    rate: '+0%',
    pitch: '+0Hz',
    provider: 'edge',
    fallbackToQuest: false,
    voiceStability: true,
    sttProvider: 'auto',
    sttApiUrl: '',
    sttApiKey: '',
    sttModel: 'whisper-1'
  }
  try {
    var qs = new URLSearchParams(window.location.search)
    var raw = qs.get('cfg')
    if (raw) cfg = Object.assign(cfg, JSON.parse(raw))
  } catch (e) { /* keep defaults */ }

  window.addEventListener('message', function (ev) {
    var d = ev && ev.data
    if (!d || typeof d !== 'object') return
    if (d.type === 'sakiko/config' && d.value && typeof d.value === 'object') {
      cfg = Object.assign(cfg, d.value)
      applyChatVisibility()
      if (themeSig(cfg) !== lastThemeSig) applyTheme()
    }
    if (d.type === 'sakiko/say' && typeof d.text === 'string') {
      enqueue(d.text, true, 'neutral')
    }
    if (d.type === 'sakiko/open') {
      replayBootOnOpen()
    }
  })

  function applyChatVisibility() {
    if (!chatRow) return
    if (cfg.chatOn === false) chatRow.classList.add('hidden')
    else chatRow.classList.remove('hidden')
  }
  applyChatVisibility()

  // P6：浮窗模式识别——cfg.floatPanel !== false（默认浮窗）→ body.float-fill：机身铺满 iframe、零留白；
  // 否则（legacy 右列）移除。初始查询 cfg、postMessage sakiko/config、poll data.config 三处合并后统一调用。
  function applyFloatFill() {
    if (cfg.floatPanel === false) document.body.classList.remove('float-fill')
    else document.body.classList.add('float-fill')
  }
  applyFloatFill()

  // ============================================================
  // Task3/P8：主题引擎（CSS 变量化 + 3 套预设 + 10 项自定义（含 colorBezel 机身外框）+ 聊天背景图）
  // ------------------------------------------------------------
  // THEME_PRESETS = 预设全量变量集（含渐变次停/发送钮面/氛围光/机身外框等实色派生）；
  // 每个预设给定 10 个「主题主键」，派生 alpha 由 applyTheme 依生效主键原地计算，
  // 从而保留权威表的 alpha/双停结构，且用户覆盖主键后派生色随之联动。
  //   - 10 用户键覆盖对应主键（colorBg1/2/Title/BubbleMe/BubbleHer/BubbleText/Btn/Hi/Dot/Bezel）
  //   - 派生实色（-bubble-me-2 / -btn-send* / -bg-glow / 机身 bezel*）默认取预设字面量；
  //     colorBezel 自定义时由单色用乘子派生机身 4 停/侧键/描边（校准见 P8 报告）
  var THEME_PRESETS = {
    'sakiko-blue': {   // 默认 = 现状 深蓝×月白×金（逐值迁移）
      base: { bg1: '#101a33', bg2: '#0b1224', title: '#eef2fb', bubbleMe: '#3b6fd4', bubbleHer: '#eef2fb', bubbleText: '#ffffff', btn: '#c9a86a', hi: '#8fb3ff', dot: '#a8b6d8' },
      bubbleMe2: '#1e3f8f',
      bgGlow: '#1d2f57',
      send1: '#d9bd7f', send2: '#b9965a', sendH1: '#e6cc92', sendH2: '#c9a86a',
      bezel: '#223058',
      bezelStops: ['#223058', '#131d38', '#0c1428', '#060b18'],
      bezelKey: ['#2c4070', '#16223f'],
      bezelBorder: 'rgba(143,179,255,0.5)'
    },
    'midnight-gold': { // 暮蓝鎏金：深墨蓝底 + 鎏金标题/强调 + 暖白文字；机身为深暖金褐
      base: { bg1: '#0e1224', bg2: '#080b16', title: '#f4e8cc', bubbleMe: '#c9a159', bubbleHer: '#f4e8cc', bubbleText: '#fffdf6', btn: '#d4b25e', hi: '#e7c96e', dot: '#b7a88b' },
      bubbleMe2: '#8a6a2e',
      bgGlow: '#3a2e1c',
      send1: '#ecd28e', send2: '#c2a052', sendH1: '#f6e2a4', sendH2: '#d4b25e',
      bezel: '#2b2118',
      bezelStops: ['#2b2118', '#1d160f', '#140f0a', '#0a0705'],
      bezelKey: ['#3a2d1a', '#241a10'],
      bezelBorder: 'rgba(231,201,110,0.45)'
    },
    'sakura-pink': {   // 樱粉月白：樱粉底 + 月白气泡 + 淡金高亮；机身为深樱紫
      base: { bg1: '#372633', bg2: '#241a24', title: '#ffe9f2', bubbleMe: '#d98aa8', bubbleHer: '#ffe9f2', bubbleText: '#ffffff', btn: '#e6cfa0', hi: '#f0b6cf', dot: '#d8a8bd' },
      bubbleMe2: '#b05e82',
      bgGlow: '#6a4b5e',
      send1: '#f0ddb4', send2: '#cfae7c', sendH1: '#f8ebc9', sendH2: '#e6cfa0',
      bezel: '#3a2030',
      bezelStops: ['#3a2030', '#2a1624', '#1d0f19', '#10080e'],
      bezelKey: ['#4c2b3d', '#321c2a'],
      bezelBorder: 'rgba(240,182,207,0.45)'
    },
    'mono': {          // 月灰单色：低饱和灰阶；机身为月灰
      base: { bg1: '#1b2025', bg2: '#12161a', title: '#e6e8ea', bubbleMe: '#6b7076', bubbleHer: '#e6e8ea', bubbleText: '#ffffff', btn: '#b8bcc0', hi: '#aeb4bb', dot: '#9aa0a6' },
      bubbleMe2: '#494e54',
      bgGlow: '#2e343a',
      send1: '#d2d5d8', send2: '#9aa0a6', sendH1: '#e3e5e7', sendH2: '#b8bcc0',
      bezel: '#262b34',
      bezelStops: ['#262b34', '#1a1e26', '#13161c', '#0a0c10'],
      bezelKey: ['#343a46', '#20242c'],
      bezelBorder: 'rgba(174,180,187,0.45)'
    }
  }
  // 语义键 → 主 CSS 变量 与 用户 cfg 键
  var THEME_COLOR_KEYS = [
    { cfg: 'colorBg1',   preset: 'bg1',       css: '--p-bg1' },
    { cfg: 'colorBg2',   preset: 'bg2',       css: '--p-bg2' },
    { cfg: 'colorTitle', preset: 'title',     css: '--p-title' },
    { cfg: 'colorBubbleMe',   preset: 'bubbleMe',   css: '--p-bubble-me' },
    { cfg: 'colorBubbleHer',  preset: 'bubbleHer',  css: '--p-bubble-her' },
    { cfg: 'colorBubbleText', preset: 'bubbleText', css: '--p-bubble-text' },
    { cfg: 'colorBtn',    preset: 'btn',       css: '--p-btn' },
    { cfg: 'colorHi',     preset: 'hi',        css: '--p-hi' },
    { cfg: 'colorDot',    preset: 'dot',       css: '--p-dot' },
    { cfg: 'colorTitle',  preset: 'title',     css: '--p-text' } // 通用主文字 = colorTitle
  ]
  var rootEl = document.documentElement
  // Color cfg key → preset 语义键名（colorTitle 两行同为 title；colorBezel 为第 10 键）
  var CFG_TO_PRESET = {}
  for (var _ci = 0; _ci < THEME_COLOR_KEYS.length; _ci++) CFG_TO_PRESET[THEME_COLOR_KEYS[_ci].cfg] = THEME_COLOR_KEYS[_ci].preset
  CFG_TO_PRESET['colorBezel'] = 'bezel'

  function validHex(v) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
  }
  // 「用户脏键」判据：cfg 中该色键 ≠ 默认预设 sakiko-blue 的同位值（大小写不敏感）。
  // 注意：不能用「当前预设 base」比较——否则切到非默认预设后 9 键全被判脏；只能以 sakiko 默认值为基准。
  // 防御（runtime）：cfg[key] 非合法 #RRGGBB（含 undefined/null/空串，如 host 白名单未重启前 colorBezel 缺失）
  // → 一律视为「非脏」，走预设原值，绝不对非法值做派生（杜绝黑色/NaN 预览）。
  // 边界（报告注明）：用户把某色改成恰好等于 sakiko 默认值 → 判为非脏，在非默认预设下不覆盖（保持预设值）。
  function isDirty(cfgKey) {
    var v = cfg[cfgKey]
    if (!validHex(v)) return false
    var preset = CFG_TO_PRESET[cfgKey]
    var def = preset === 'bezel' ? THEME_PRESETS['sakiko-blue'].bezel : THEME_PRESETS['sakiko-blue'].base[preset]
    return String(v).toLowerCase() !== String(def).toLowerCase()
  }
  function hexRgb(hex) {
    if (!validHex(hex)) return null
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16)
    }
  }
  function rgbaHex(hex, a) {
    var c = hexRgb(hex)
    if (!c) return 'transparent'
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')'
  }
  // P8：单色 colorBezel 派生机身 4 停渐变 / 侧键 / 描边（乘子校准见报告）
  function darkenHex(hex, f) {
    var c = hexRgb(hex); if (!c) return '#000000'
    var r = Math.max(0, Math.min(255, Math.round(c.r * f)))
    var g = Math.max(0, Math.min(255, Math.round(c.g * f)))
    var b = Math.max(0, Math.min(255, Math.round(c.b * f)))
    return '#' + ('0' + r.toString(16)).slice(-2) + ('0' + g.toString(16)).slice(-2) + ('0' + b.toString(16)).slice(-2)
  }
  function lightenHex(hex, t) {
    var c = hexRgb(hex); if (!c) return '#ffffff'
    var r = Math.max(0, Math.min(255, Math.round(c.r + (255 - c.r) * t)))
    var g = Math.max(0, Math.min(255, Math.round(c.g + (255 - c.g) * t)))
    var b = Math.max(0, Math.min(255, Math.round(c.b + (255 - c.b) * t)))
    return '#' + ('0' + r.toString(16)).slice(-2) + ('0' + g.toString(16)).slice(-2) + ('0' + b.toString(16)).slice(-2)
  }
  // 防御：派生入口一律以「合法 hex」为前置——非法(含 undefined/null/空串/非 #RRGGBB)回退默认机身色 #223058，
  // 杜绝把非法值传入 hexRgb/derive（避免黑色/NaN 输出）。仅 panel.js 侧；host 白名单未重启也能安全回退预设。
  function safeBezel(hex) { return validHex(hex) ? hex : '#223058' }
  function deriveBezelStops(hex) {
    hex = safeBezel(hex)
    return [hex, darkenHex(hex, 0.6), darkenHex(hex, 0.41), darkenHex(hex, 0.23)]
  }
  function deriveBezelKeys(hex) {
    hex = safeBezel(hex)
    return [lightenHex(hex, 0.14), darkenHex(hex, 0.55)]
  }
  function deriveBezelBorder(hex) {
    hex = safeBezel(hex)
    var c = hexRgb(lightenHex(hex, 0.55))
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.5)'
  }

  // 主题相关配置签名：host poll 仅在实际变化时重跑 applyTheme（fix M2 幂等浪费）。
  // panel 内不再有本地预览（设置已搬入 DSH 设置区），故无需 pendingCfg/filterPending。
  function themeSig(c) {
    return [c.themePreset, c.colorBg1, c.colorBg2, c.colorTitle, c.colorBubbleMe, c.colorBubbleHer,
      c.colorBubbleText, c.colorBtn, c.colorHi, c.colorDot, c.colorBezel, c.chatBgUrl, c.floatPanel].join('~')
  }
  var lastThemeSig = ''

  // 计算生效主键：预设 base + 9 用户键 + colorBezel（「用户脏键」覆盖；非脏键一律取预设 base）。
  // —— 修复 C1：此前用 validHex 恒非空覆盖，而 getStatus/poll 恒供 9 个合法 hex（DEFAULT_CONFIG）→
  //    切到非默认预设后主键被写回 sakiko 默认、几乎不变；改判据后才真正随预设切换。
  function effectiveBase() {
    var name = cfg.themePreset
    var preset = THEME_PRESETS[name] || THEME_PRESETS['sakiko-blue']
    var base = {}
    var p = preset.base
    base.bg1 = p.bg1; base.bg2 = p.bg2; base.title = p.title
    base.bubbleMe = p.bubbleMe; base.bubbleHer = p.bubbleHer; base.bubbleText = p.bubbleText
    base.btn = p.btn; base.hi = p.hi; base.dot = p.dot
    base.bezel = preset.bezel
    for (var i = 0; i < THEME_COLOR_KEYS.length; i++) {
      var k = THEME_COLOR_KEYS[i]
      if (isDirty(k.cfg) && validHex(cfg[k.cfg])) base[k.preset] = cfg[k.cfg]
    }
    if (isDirty('colorBezel') && validHex(cfg.colorBezel)) base.bezel = cfg.colorBezel
    return { preset: preset, base: base }
  }

  // 写 CSS 变量 + data-theme；聊天背景与浮窗布局一并应用
  function applyTheme() {
    var eff = effectiveBase()
    var b = eff.base
    var pr = eff.preset
    if (!rootEl) return
    var set = function (name, val) { rootEl.style.setProperty(name, val === undefined ? '' : val) }

    // 主键
    set('--p-bg1', b.bg1); set('--p-bg2', b.bg2)
    set('--p-title', b.title); set('--p-text', b.title)
    set('--p-bubble-me', b.bubbleMe); set('--p-bubble-her', b.bubbleHer)
    set('--p-bubble-text', b.bubbleText); set('--p-btn', b.btn)
    set('--p-hi', b.hi); set('--p-dot', b.dot)
    // 派生实色（预设字面量；用户覆盖主键时此三组不自动推导，见报告联动策略）
    set('--p-bubble-me-2', pr.bubbleMe2)
    set('--p-bg-glow', pr.bgGlow)
    set('--p-btn-send1', pr.send1); set('--p-btn-send2', pr.send2)
    set('--p-btn-send-h1', pr.sendH1); set('--p-btn-send-h2', pr.sendH2)
    // 派生 alpha（依生效主键原地计算，保留权威表 alpha 结构）
    set('--p-bg1-soft', rgbaHex(b.bg1, 0.12)); set('--p-bg1-glass', rgbaHex(b.bg1, 0.5))
    set('--p-bg1-cam', rgbaHex(b.bg1, 0.9)); set('--p-bg2-glass', rgbaHex(b.bg2, 0.94))
    set('--p-bg2-0', rgbaHex(b.bg2, 0))
    set('--p-keypad-bg1', rgbaHex(b.bg1, 0.96)); set('--p-keypad-bg2', rgbaHex(b.bg2, 0.99))
    set('--p-bubble-me-border', rgbaHex(b.hi, 0.35))
    set('--p-bubble-her-glass', rgbaHex(b.bubbleHer, 0.09))
    set('--p-bubble-her-border', rgbaHex(b.bubbleHer, 0.25))
    set('--p-glass-border', rgbaHex(b.title, 0.18))
    set('--p-glint-05', rgbaHex(b.title, 0.05)); set('--p-glint-06', rgbaHex(b.title, 0.06))
    set('--p-glint-07', rgbaHex(b.title, 0.07)); set('--p-glint-10', rgbaHex(b.title, 0.1))
    set('--p-glint-12', rgbaHex(b.title, 0.12)); set('--p-glint-14', rgbaHex(b.title, 0.14))
    set('--p-glint-16', rgbaHex(b.title, 0.16)); set('--p-glint-20', rgbaHex(b.title, 0.2))
    set('--p-glint-30', rgbaHex(b.title, 0.3)); set('--p-glint-80', rgbaHex(b.title, 0.8))
    set('--p-hi-10', rgbaHex(b.hi, 0.1)); set('--p-hi-12', rgbaHex(b.hi, 0.12))
    set('--p-hi-20', rgbaHex(b.hi, 0.2)); set('--p-hi-28', rgbaHex(b.hi, 0.28))
    set('--p-hi-32', rgbaHex(b.hi, 0.32)); set('--p-hi-50', rgbaHex(b.hi, 0.5))
    set('--p-hi-55', rgbaHex(b.hi, 0.55))
    set('--p-call-bg', rgbaHex(b.hi, 0.08)); set('--p-call-border', rgbaHex(b.hi, 0.45))
    set('--p-btn-06', rgbaHex(b.btn, 0.06)); set('--p-btn-25', rgbaHex(b.btn, 0.25))
    set('--p-btn-28', rgbaHex(b.btn, 0.28)); set('--p-btn-45', rgbaHex(b.btn, 0.45))
    set('--p-btn-55', rgbaHex(b.btn, 0.55)); set('--p-btn-75', rgbaHex(b.btn, 0.75))
    set('--p-dot-55', rgbaHex(b.dot, 0.55)); set('--p-dot-60', rgbaHex(b.dot, 0.6))
    set('--p-dot-72', rgbaHex(b.dot, 0.72))

    // 机身/外框（P8 colorBezel）：自定义时由单色派生 4 停渐变/侧键/描边；否则用预设原值组（默认零回归）
    // 守卫：bezelDirty 须同时满足「脏」且「生效 base 为合法 hex」（host 白名单未重启时 cfg.colorBezel 可能为 undefined/null）。
    var bezelDirty = isDirty('colorBezel') && validHex(b.bezel)
    var bzStops = bezelDirty ? deriveBezelStops(b.bezel) : pr.bezelStops
    var bzKeys = bezelDirty ? deriveBezelKeys(b.bezel) : pr.bezelKey
    var bzBorder = bezelDirty ? deriveBezelBorder(b.bezel) : pr.bezelBorder
    set('--p-bezel1', bzStops[0]); set('--p-bezel2', bzStops[1]); set('--p-bezel3', bzStops[2]); set('--p-bezel4', bzStops[3])
    set('--p-bezel-key1', bzKeys[0]); set('--p-bezel-key2', bzKeys[1])
    set('--p-bezel-border', bzBorder)

    // data-theme 为预设语义选择器（panel.css 提供 :root[data-theme=…] 静态基色兜底），
    // 变量实值由上方 setProperty 覆盖行优先应用（JS 为权威）。
    rootEl.setAttribute('data-theme', cfg.themePreset && THEME_PRESETS[cfg.themePreset] ? cfg.themePreset : 'sakiko-blue')
    applyChatBg()
    applyFloatFill()
    lastThemeSig = themeSig(cfg) // 供 poll 判断是否需重跑
  }

  // 聊天背景图：chatBgUrl 非空 → #history 铺背景 + 半透明遮罩保文字可读；空 → 复原
  var lastBgUrl = null
  function applyChatBg() {
    if (!historyEl) return
    var url = String(cfg.chatBgUrl || '').trim()
    if (url === lastBgUrl) return // 记忆：poll 高频调用下避免重复写 DOM
    lastBgUrl = url
    if (url && /^https?:\/\//.test(url) && url.indexOf('"') === -1 && url.indexOf("'") === -1) {
      historyEl.classList.add('has-bg')
      // 半透明深色遮罩叠于图上，保证气泡/文字可读性（中性深遮罩，各主题通用）
      historyEl.style.backgroundImage = 'linear-gradient(180deg, rgba(7,13,26,0.5) 0%, rgba(7,13,26,0.8) 100%), url("' + url + '")'
    } else {
      historyEl.classList.remove('has-bg')
      historyEl.style.backgroundImage = ''
    }
  }

  // 面板内设置页已迁至 DSH 设置区（P7）：移除 #settings 覆盖层及全部设置 JS（颜色行/发送/防抖/pending）。
  applyTheme() // T3 主题引擎启动即应用一次

  // ---------------- 屏幕时钟 ----------------
  function tickClock() {
    var d = new Date()
    var hh = ('0' + d.getHours()).slice(-2)
    var mm = ('0' + d.getMinutes()).slice(-2)
    screenClock.textContent = hh + ':' + mm
  }
  tickClock()
  window.setInterval(tickClock, 15000)

  // ---------------- 开机动画（Task5 去帧化：静态字标 + 打字行） ----------------
  // boot 打字行 → SAKIKO 系统文案（机械词，正式版按 Task 0 表微调）
  var bootLines = [
    'SAKIKO SYSTEM',
    'memory database ... connect OK',
    '豊川祥子 - ready.'
  ]
  // 不再逐帧切换 logo1..logo39.png（旧素材已删除）；#boot-logo-img 的呈现交给
  // HTML/CSS 任务，JS 不再读写它。.boot 浮层的显示/隐藏时序保持不变。
  var bootAnimDone = false
  var modelReady = false

  function resetBootAnim() {
    bootAnimDone = false
    boot.classList.remove('off')
  }

  function typeBootLines() {
    var li = 0
    var ci = 0
    var targets = [bootL1, bootL2, bootL3]
    for (var b = 0; b < targets.length; b++) targets[b].textContent = ''
    function step() {
      if (li >= bootLines.length) {
        bootAnimDone = true
        hideBootWhenReady()
        return
      }
      ci++
      targets[li].textContent = bootLines[li].slice(0, ci)
      if (ci >= bootLines[li].length) {
        li++
        ci = 0
        window.setTimeout(step, 280)
      } else {
        window.setTimeout(step, 22)
      }
    }
    step()
  }

  function startBootAnimation() {
    resetBootAnim()
    // Task5-R1: 开机浮层期间门控 #keypad（可见性由 panel.css state-boot 规则处理）
    phoneEl.classList.add('state-boot')
    // Task9a: 浮层门控下若输入框仍聚焦会盲打 → 主动失焦
    var ae = document.activeElement
    if (ae && ae.blur) ae.blur()
    typeBootLines()
  }

  // 每次从 Sakiko 按钮重新打开右侧栏时，重播开机动画（如果当前不在开机画面）
  function replayBootOnOpen() {
    if (!boot) return
    if (!boot.classList.contains('off')) return
    startBootAnimation()
  }

  function hideBootWhenReady() {
    // 无 39 帧动画后：打字行播完(bootAnimDone)且头像就绪(modelReady)才进入主界面
    if (!modelReady || !bootAnimDone) {
      window.setTimeout(hideBootWhenReady, 200)
      return
    }
    boot.classList.add('off')
    // Task5-R1: 开机完成（浮层隐藏）→ 解除 #keypad 门控，成对移除 state-boot
    phoneEl.classList.remove('state-boot')
  }

  startBootAnimation()

  // ---------------- 语音队列 ----------------
  // Task5：内联回退与 window.SakikoEmotion 同步为 Sakiko expression 名（model.json expressions.name）
  var EXPR = (window.SakikoEmotion && window.SakikoEmotion.EXPR) || { happy: 'smile03', excited: 'smile05', elated: 'smile06', question: 'thinking01', sad: 'sad01', angry: 'angry01', furious: 'angry07', soft: 'smile01', blush: 'shame01', annoyed: 'sigh01', thinking: 'thinking02', surprised: 'surprised01', disappointed: 'sad02', eyes_closed: 'idle01', indifferent: 'serious01', side: 'kime01', winking: 'smile04', neutral: 'default' }
  var EXPR_TO_EMO = (window.SakikoEmotion && window.SakikoEmotion.EXPR_TO_EMO) || { smile03: 'happy', smile05: 'excited', smile06: 'elated', sad01: 'sad', angry01: 'angry', angry07: 'furious', thinking01: 'question', smile01: 'soft', shame01: 'blush', sigh01: 'annoyed', thinking02: 'thinking', surprised01: 'surprised', sad02: 'disappointed', idle01: 'eyes_closed', serious01: 'indifferent', kime01: 'side', smile04: 'winking', default: 'neutral', '': 'neutral' }
  var queue = []
  var playing = false
  var lastQueued = ''
  var audioEl = null
  var actx = null
  var analyser = null
  var graphFailed = false
  var unlocked = false
  var prefetchCache = {}
  var inflightAudio = {}

  // 改名（amadeus→sakiko）后回落到旧键，避免已启用语音的用户重新看到解锁浮层
  try { unlocked = (window.localStorage.getItem('sakiko.unlocked') || window.localStorage.getItem('amadeus.unlocked')) === '1' } catch (e) { unlocked = false }

  function enqueue(text, force, emotion, expr, cn, id, bubble, url) {
    var t = String(text || '').replace(/\s+/g, ' ').trim()
    var hasUrl = typeof url === 'string' && url.length > 0
    // hum 等直连音频条目（text 为空但带 url）同样入主队列；纯空文本才丢弃
    if (t.length === 0 && !hasUrl) return
    if (!force && cfg.voiceOn !== true) return
    if (t.length > 0 && t === lastQueued) return
    if (t.length > 0) lastQueued = t
    var emo = EXPR[emotion] !== undefined ? emotion : 'neutral'
    if (queue.length > 30) queue.shift()
    var qi = { text: t, cn: cn || '', emotion: emo, expr: expr || EXPR[emo] || '' }
    // 直连音频（hum）：pump 跳过 TTS 合成，直接播放该 URL（words 空 → 口型静默）
    if (hasUrl) qi.url = url
    // 时间线：透传 host 队列 id（若有），播报 play/end 上报才能与 host push 事件对齐
    if (typeof id === 'number') qi.id = id
    // 气泡元数据（任务播报 announce/idle、来电接听 call、哼唱 hum）随条目入队：取到条目时不再直接
    // 插气泡，改由 pump 在该句真正开始播放（play() resolve 回调内）或终局失败兜底时插入
    if (bubble) qi.bubble = bubble
    queue.push(qi)
    prefetchNext()
    pump()
  }

  // 渲染该条目的历史气泡（一次性）：成功出声时在 play() resolve 回调内调用；
  // 主音频终局失败（拉取失败 / autoplay 拦截后无声 / 播放错误…）在各失败出口补调用，
  // 保证文字不丢。bubbleDone 标记防解锁重试/兜底与成功回调重复插入。
  function renderItemBubble(item) {
    if (!item || item.bubbleDone || !item.bubble) return
    item.bubbleDone = true
    var bEmo = item.emotion || item.bubble.emotion || 'neutral'
    if (item.bubble.call) {
      addHistory({ role: 'assistant', cn: item.bubble.cn, jp: item.bubble.jp, emotion: bEmo, call: true })
    } else {
      addHistory({ role: 'assistant', cn: item.bubble.cn, jp: item.bubble.jp, emotion: bEmo, announce: item.bubble.announce === true, idle: item.bubble.idle === true, t: Date.now() })
    }
    // 时间线：气泡已插入 DOM（与 tl:play 同回调、播放开始瞬间），id 与 host push 对齐
    if (typeof item.id === 'number') report('tl:bubble:' + item.id)
  }

  function ensureAudioEl() {
    if (audioEl) return
    audioEl = document.createElement('audio')
    audioEl.preload = 'auto'
  }

  function attachAnalyser() {
    if (!audioEl || analyser !== null || graphFailed) return
    try {
      var AC = window.AudioContext || window.webkitAudioContext
      actx = new AC()
      var src = actx.createMediaElementSource(audioEl)
      analyser = actx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.55
      src.connect(analyser)
      analyser.connect(actx.destination)
      if (actx.state === 'suspended') { try { actx.resume() } catch (e) { /* ignore */ } }
    } catch (e) {
      graphFailed = true
      analyser = null
    }
  }

  function ttsUrl(text, emotion) {
    return '/sakiko/tts?text=' + encodeURIComponent(text) +
      '&voice=' + encodeURIComponent(cfg.voiceName || 'ja-JP-NanamiNeural') +
      '&rate=' + encodeURIComponent(cfg.rate || '+0%') +
      '&pitch=' + encodeURIComponent(cfg.pitch || '+0Hz') +
      '&emotion=' + encodeURIComponent(emotion || 'neutral')
  }

  // ---------------- 词级口型（响应头） ----------------
  function base64UrlDecode(s) {
    if (!s) return ''
    var b64 = String(s).replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4) b64 += '='
    try {
      return decodeURIComponent(Array.prototype.map.call(atob(b64), function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      }).join(''))
    } catch (e) {
      try { return atob(b64) } catch (e2) { return '' }
    }
  }

  function cachePrefetch(url, obj) {
    var keys = Object.keys(prefetchCache)
    if (keys.length > 8) {
      var old = prefetchCache[keys[0]]
      try { URL.revokeObjectURL(old.url) } catch (e) { /* ignore */ }
      delete prefetchCache[keys[0]]
    }
    prefetchCache[url] = obj
  }

  function fetchAudioWithWords(text, emotion) {
    var url = ttsUrl(text, emotion)
    if (prefetchCache[url]) return Promise.resolve(prefetchCache[url])
    if (inflightAudio[url]) return inflightAudio[url]
    inflightAudio[url] = fetch(url, { cache: 'no-store' }).then(function (resp) {
      if (!resp.ok) throw new Error('tts http ' + resp.status)
      var words = []
      var h = resp.headers.get('X-Sakiko-Words')
      if (h) {
        try {
          var decoded = base64UrlDecode(h)
          var parsed = JSON.parse(decoded)
          if (Array.isArray(parsed)) words = parsed
        } catch (e) { /* ignore */ }
      }
      return resp.blob().then(function (blob) {
        var obj = { url: URL.createObjectURL(blob), words: words }
        cachePrefetch(url, obj)
        return obj
      })
    }).then(function (obj) {
      delete inflightAudio[url]
      return obj
    }, function (err) {
      delete inflightAudio[url]
      throw err
    })
    return inflightAudio[url]
  }

  function prefetchNext() {
    prefetchAhead(6)
  }

  function prefetchAhead(count) {
    var n = Math.min(count || 3, queue.length)
    for (var i = 0; i < n; i++) {
      var item = queue[i]
      if (!item) continue
      // hum 等直连音频条目无 TTS 合成，跳过预取（避免对空文本发起 /sakiko/tts）
      if (item.url) continue
      var url = ttsUrl(item.text, item.emotion)
      if (prefetchCache[url] || inflightAudio[url]) continue
      fetchAudioWithWords(item.text, item.emotion).catch(function () { /* ignore */ })
    }
  }

  function playAudioUrl(url, onStart) {
    return new Promise(function (resolve, reject) {
      ensureAudioEl()
      attachAnalyser()
      var el = audioEl
      el.src = url
      var done = false
      el.onended = function () { if (done) return; done = true; resolve() }
      el.onerror = function () {
        if (done) return
        done = true
        var err = el.error
        reject(new Error(err && err.message ? err.message : 'audio error'))
      }
      var p
      try { p = el.play() } catch (e) { p = Promise.reject(e) }
      if (p && p.then) {
        p.then(function () {
          if (onStart) { try { onStart() } catch (e) { /* ignore */ } }
          if (actx && actx.state === 'suspended') { try { actx.resume() } catch (e) { /* ignore */ } }
          hideUnlock()
          markUnlocked()
        }).catch(function (err) {
          if (done) return
          report('audio blocked: ' + (err && err.message ? err.message : err))
          showUnlock()
          reject(err)
        })
      }
    })
  }

  function speakBrowser(text) {
    return new Promise(function (resolve, reject) {
      if (!window.speechSynthesis) { reject(new Error('no speechSynthesis')); return }
      var u = new SpeechSynthesisUtterance(text)
      u.lang = 'ja-JP'
      u.rate = 1.02
      var voices = window.speechSynthesis.getVoices()
      for (var i = 0; i < voices.length; i++) {
        if (voices[i].lang && voices[i].lang.toLowerCase().indexOf('ja') === 0) {
          u.voice = voices[i]
          break
        }
      }
      u.onstart = function () { startSpeaking({ text: text, emotion: 'neutral', expr: '' }, []) }
      u.onend = function () { stopSpeaking(); resolve() }
      u.onerror = function (ev) { stopSpeaking(); reject(new Error('speechSynthesis: ' + (ev && ev.error ? ev.error : 'error'))) }
      window.speechSynthesis.speak(u)
    })
  }

  async function pump() {
    if (playing || queue.length === 0) return
    playing = true
    var item = queue.shift()
    try {
      // hum 等直连音频：跳过 TTS 合成，直接以 item.url 播放（words 空 → 口型静默，不加新状态机）
      var obj = item.url ? { url: item.url, words: [] } : await fetchAudioWithWords(item.text, item.emotion)
      await playAudioUrl(obj.url, function () {
        startSpeaking(item, obj.words)
        // 气泡渲染时机 = 该句真正开始出声（audioEl.play() promise resolve 回调内）：
        // 插完 DOM 立即上报 tl:bubble，与紧随的 tl:play 同回调对齐（连发时逐句 气泡+声音 同步）
        renderItemBubble(item)
        // 时间线：audioEl.play() promise resolve（真正出声）后才上报，id 与 host push 对齐
        if (typeof item.id === 'number') report('tl:play:' + item.id)
      })
      // 时间线：onended 触发（playAudioUrl resolve）后上报结束
      if (typeof item.id === 'number') report('tl:end:' + item.id)
      stopSpeaking()
    } catch (e1) {
      var msg = e1 && e1.message ? e1.message : String(e1)
      // 主音频管线已终局失败（拉取失败 / autoplay 拦截 / 播放错误…）：立即补气泡，文字不丢。
      // 条目已出队，解锁重试只会作用于仍在队列中的条目——若该条目之后真正出声，
      // 则经成功回调插气泡（此处先到则标记防重，成功回调不再重复插）。
      renderItemBubble(item)
      if (cfg.voiceStability === false) {
        try {
          await speakBrowser(item.text)
        } catch (e2) {
          var msg2 = e2 && e2.message ? e2.message : String(e2)
          report('speak fail: ' + msg2)
          updateChip('⚠ ' + msg2.slice(0, 30), true)
        }
      } else {
        report('tts failed (stable): ' + msg)
        updateChip('⚠ TTS 失败（保持声线稳定，未切换）', true)
      }
    }
    stopSpeaking()
    playing = false
    prefetchNext()
    pump()
  }

  // ---------------- 解锁 ----------------
  // Task5-R1: 解锁浮层显示/隐藏时成对门控 #keypad
  function showUnlock() {
    unlockEl.classList.remove('hidden')
    phoneEl.classList.add('state-unlock')
    // Task9a: 浮层门控下若输入框仍聚焦会盲打 → 主动失焦
    var ae = document.activeElement
    if (ae && ae.blur) ae.blur()
  }
  function hideUnlock() { unlockEl.classList.add('hidden'); phoneEl.classList.remove('state-unlock') }
  function markUnlocked() {
    unlocked = true
    try { window.localStorage.setItem('sakiko.unlocked', '1') } catch (e) { /* ignore */ }
  }

  // Task7 解锁问候台词（docs/sakiko-quotes.md A6-1，A6 主推，标注【原创·依考据风格】可直用）：
  // 语音解锁后第一句日文朗读——时段中性、不点名、语气明亮（うれしいですわ）。
  // 原 kurisu「ふふっ、呼んだ？」为 Kurisu 素材台词，已随素材下线，不沿用。
  var UNLOCK_GREETING_JA = '呼んでくださったのですね。うれしいですわ'
  var unlockGreeted = false
  function unlockAction() {
    // 点击本身就是新用户手势：无论此前是否解锁都先隐藏浮层并重试播放
    hideUnlock()
    var firstUnlock = !unlocked
    if (firstUnlock) markUnlocked()
    lastInteractionAt = Date.now()
    ensureAudioEl()
    attachAnalyser()
    if (actx && actx.state === 'suspended') { try { actx.resume() } catch (e) { /* ignore */ } }
    if (!unlockGreeted) {
      unlockGreeted = true
      if (UNLOCK_GREETING_JA) enqueue(UNLOCK_GREETING_JA, true, 'happy')
    } else {
      // 已解锁但自动播放被拦（unlocked=true 也会弹浮层）：点击恢复播放入队语音
      pump()
    }
  }
  unlockBtn.addEventListener('click', unlockAction)
  screenEl.addEventListener('click', unlockAction)
  screenEl.addEventListener('touchend', unlockAction)
  if (!unlocked) showUnlock()

  // ---------------- 来电 ----------------
  var ringing = false
  var currentCallItem = null

  function startCall(item) {
    currentCallItem = item
    lastInteractionAt = Date.now()
    callOverlay.classList.remove('hidden')
    // Task5-R1: 来电浮层显示期间门控 #keypad
    phoneEl.classList.add('state-call')
    // Task9a: 浮层门控下若输入框仍聚焦会盲打 → 主动失焦
    var ae = document.activeElement
    if (ae && ae.blur) ae.blur()
    ringing = true
    // Task5 来电改模型直出：不再按情绪切换 kurisu 立绘 src（#call-portrait / kurisu/*.png
    // 旧素材已下线）。来电时保持 canvas 模型可见、overlay 半透明显示模型——
    // 半透明等视觉由 HTML/CSS 任务负责，JS 只保证不切图、不隐藏 #sakiko-canvas。
    try {
      var p = ringAudio.play()
      if (p && p.catch) p.catch(function () { report('ring blocked') })
    } catch (e) { report('ring play failed') }
    try {
      if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400])
    } catch (e) { /* ignore */ }
  }

  function stopCall() {
    ringing = false
    callOverlay.classList.add('hidden')
    // Task5-R1: 来电结束 → 解除 #keypad 门控，成对移除 state-call
    phoneEl.classList.remove('state-call')
    try { ringAudio.pause(); ringAudio.currentTime = 0 } catch (e) { /* ignore */ }
    try { if (navigator.vibrate) navigator.vibrate(0) } catch (e) { /* ignore */ }
  }

  function ackCallRemote() {
    fetch('/sakiko/action?cmd=ackcall', { cache: 'no-store' }).catch(function () { /* ignore */ })
  }

  callAccept.addEventListener('click', function () {
    var item = currentCallItem
    stopCall()
    ackCallRemote()
    if (item) {
      // 来电接听气泡同样迁移到播放开始瞬间：气泡元数据随条目入队，
      // 由 pump 在该句真正开始播放（成功回调）或终局失败兜底时插入（仅一次）
      enqueue(item.text, true, item.emotion || 'neutral', item.expr || '', item.cn || '', item.id,
        (item.cn || item.text) ? { cn: item.cn || '', jp: item.text, call: true } : null)
    }
  })
  callDeny.addEventListener('click', function () {
    stopCall()
    ackCallRemote()
  })

  // ---------------- Live2D ----------------
  var app = null
  var model = null
  var modelFormat = null
  var manifestScale = 1
  var modelLayout = { scale: 1, x: 0, y: 0, yRatio: 0.62 }
  var manifestLayoutBase = { scale: 1, x: 0, y: 0, yRatio: 0.62 }
  var calibMode = false
  var calibDrag = null
  var calibBaseLayout = null
  var speaking = false
  var mouthWords = null
  var lastMouthValue = 0
  var lastEmotionEyeOpen = [1, 1]
  var energySmooth = 0
  var gesture = { kind: '', arms: [], shoulders: [], body: [], head: [] }
  var gestureEmotion = 'neutral'
  var natural = {
    head: [0, 0, 0],
    headTarget: [0, 0, 0],
    headAt: 0,
    eyes: [0, 0],
    eyesTarget: [0, 0],
    eyesAt: 0,
    eyeLids: [1, 1],
    eyeLidsTarget: [1, 1],
    blinkAt: 0,
    blinkState: 'Open'
  }
  // 行为状态（参考 ai-live2d-go 的 AvatarState：平静→无聊→说话→余韵）
  var lastInteractionAt = Date.now()
  // 情绪表情平滑过渡（参考 ai-live2d-go 的 setEmotionParams 过渡）
  var faceBlend = { target: null, from: null, k: 0.6, start: 0, ms: 260 }
  var lastFaceConfig = {
    cheek: 0, eyeSmile: 0, mouthForm: 0, browL: 0, browR: 0,
    pupilX: 0, pupilY: 0, pupilSize: 1, eyeLOpen: 1, eyeROpen: 1
  }
  var lastFaceK = 0.6
  // 说话动作 shuffle 池（参考 ai-live2d-go 的 SPEAKING_GROUPS_POOL，避免同一手势连续出现）
  var speakPatternIdx = -1
  var speakPatternAt = 0
  var SPEAK_PATTERNS = [
    { name: 'wave', speed: 1.0, headX: 1.6, headZ: 0.9, bodyX: 2.4, bodyY: 1.3, arm: 1.6, headY: 0.18 },
    { name: 'sway', speed: 0.8, headX: 0.9, headZ: 1.2, bodyX: 3.2, bodyY: 1.1, arm: 1.0, headY: 0.14 },
    { name: 'bob',  speed: 1.1, headX: 0.7, headZ: 0.5, bodyX: 1.6, bodyY: 2.4, arm: 1.2, headY: 0.3 },
    { name: 'lean', speed: 0.9, headX: 1.1, headZ: 1.8, bodyX: 2.0, bodyY: 0.8, arm: 0.8, headY: 0.1 },
    { name: 'calm', speed: 0.7, headX: 0.5, headZ: 0.4, bodyX: 1.2, bodyY: 0.7, arm: 0.5, headY: 0.08 }
  ]

  var LIBS = {
    pixi: '/sakiko/web/vendor/pixi.min.js',
    pixiV6: '/sakiko/web/vendor/pixi-v6.min.js',
    l2d21: '/sakiko/web/vendor/live2d21.min.js',
    pldC2: '/sakiko/web/vendor/pld-cubism2.min.js',
    core: '/sakiko/web/vendor/live2dcubismcore.min.js',
    pldC4: '/sakiko/web/vendor/pld-cubism4.min.js'
  }
  var LIBS_FALLBACK = {
    pixi: 'https://cdn.jsdelivr.net/npm/pixi.js@7.4.2/dist/pixi.min.js',
    l2d21: 'https://raw.githubusercontent.com/dylanNew/live2d/master/webgl/Live2D/lib/live2d.min.js',
    pldC2: 'https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism2.min.js',
    core: 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
    pldC4: 'https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js'
  }
  var scriptPromises = {}

  function loadScript(src) {
    if (scriptPromises[src]) return scriptPromises[src]
    scriptPromises[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script')
      s.src = src
      s.async = true
      s.onload = function () { resolve() }
      s.onerror = function () { reject(new Error('script load failed: ' + src)) }
      document.head.appendChild(s)
    })
    return scriptPromises[src]
  }

  function loadScriptChain(key) {
    return loadScript(LIBS[key]).catch(function (e1) {
      report('lib local fail ' + key + ': ' + (e1 && e1.message ? e1.message : e1))
      return loadScript(LIBS_FALLBACK[key]).then(function () { report('lib cdn ok ' + key) })
    }).then(function () { report('lib ok ' + key) })
  }

  function live2dReady() {
    var P = window.PIXI
    return !!(P && P.live2d && P.live2d.Live2DModel)
  }

  function initPixi() {
    if (app) return
    app = new window.PIXI.Application({
      view: canvas,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1
    })
    try {
      if (window.PIXI && window.PIXI.settings && window.PIXI.SCALE_MODES) {
        window.PIXI.settings.SCALE_MODE = window.PIXI.SCALE_MODES.LINEAR
      }
    } catch (e) { /* ignore */ }
    var resize = function () {
      var w = screenEl.clientWidth
      var h = screenEl.clientHeight
      if (w > 0 && h > 0) app.renderer.resize(w, h)
      placeModel()
    }
    if (window.ResizeObserver) {
      try {
        var ro = new ResizeObserver(resize)
        ro.observe(screenEl)
      } catch (e) { window.addEventListener('resize', resize) }
    } else {
      window.addEventListener('resize', resize)
    }
    resize()
  }

  function placeModel() {
    if (!model) return
    try {
      var w = screenEl.clientWidth || 320
      var h = screenEl.clientHeight || 480
      if (model.anchor && model.anchor.set) model.anchor.set(0.5, 0.5)
      model.scale.set(1)
      model.x = 0
      model.y = 0
      var mw = 0
      var mh = 0
      try {
        var b = model.getBounds()
        if (b && b.width > 0 && b.height > 0) {
          mw = b.width
          mh = b.height
        }
      } catch (e) { /* ignore */ }
      if (!(mw > 50 && mw < 5000)) mw = Number(model.width) || Number(model.internalModel && model.internalModel.width) || 600
      if (!(mh > 50 && mh < 5000)) mh = Number(model.height) || Number(model.internalModel && model.internalModel.height) || 900
      var fit = Math.min((w * 0.92) / mw, (h * 0.96) / mh)
      var s = Math.max(0.05, Math.min(4, fit * (manifestScale || 1) * (modelLayout.scale || 1)))
      model.scale.set(s)
      model.x = w / 2 + (modelLayout.x || 0)
      model.y = h * (typeof modelLayout.yRatio === 'number' ? modelLayout.yRatio : 0.62) + (modelLayout.y || 0)
    } catch (e) { /* ignore */ }
  }

  function loadSavedLayout() {
    try {
      // 改名（amadeus→sakiko）后回落到旧键，避免已标定好的模型位置/缩放丢失
      var raw = window.localStorage.getItem('sakiko.l2d.layout') || window.localStorage.getItem('amadeus.l2d.layout')
      if (!raw) return
      var saved = JSON.parse(raw)
      if (saved && typeof saved === 'object') {
        modelLayout = Object.assign({}, modelLayout, saved)
      }
    } catch (e) { /* ignore */ }
  }

  function saveCalibLayout() {
    try {
      window.localStorage.setItem('sakiko.l2d.layout', JSON.stringify(modelLayout))
    } catch (e) { /* ignore */ }
  }

  function setCalibUI(on) {
    calibMode = on
    if (calibBtn) calibBtn.classList.toggle('active', on)
    updateChip(on ? '⚙ 拖动调整，滚轮缩放，双击复位' : (cfg.provider || 'edge') + (model ? ' · l2d' : ''), false)
  }

  function toggleCalibMode() {
    if (!model) return
    if (!calibMode) {
      calibBaseLayout = Object.assign({}, modelLayout)
      setCalibUI(true)
    } else {
      saveCalibLayout()
      setCalibUI(false)
      report('calib saved: ' + JSON.stringify(modelLayout))
    }
  }

  if (calibBtn) {
    calibBtn.addEventListener('click', function (ev) {
      ev.stopPropagation()
      toggleCalibMode()
    })
  }

  function paramName(id) {
    if (modelFormat !== 'cubism2') return id
    var map = {
      ParamAngleX: 'PARAM_ANGLE_X',
      ParamAngleY: 'PARAM_ANGLE_Y',
      ParamAngleZ: 'PARAM_ANGLE_Z',
      ParamBodyAngleX: 'PARAM_BODY_ANGLE_X',
      ParamBodyAngleY: 'PARAM_BODY_ANGLE_Y',
      ParamBodyAngleZ: 'PARAM_BODY_ANGLE_Z',
      ParamEyeBallX: 'PARAM_EYE_BALL_X',
      ParamEyeBallY: 'PARAM_EYE_BALL_Y',
      ParamEyeLOpen: 'PARAM_EYE_L_OPEN',
      ParamEyeROpen: 'PARAM_EYE_R_OPEN',
      ParamBreath: 'PARAM_BREATH',
      ParamMouthOpenY: 'PARAM_MOUTH_OPEN_Y',
      ParamMouthForm: 'PARAM_MOUTH_FORM',
      ParamMouthScaleX: 'PARAM_MOUTH_SCALE_X',
      ParamMouthScaleY: 'PARAM_MOUTH_SCALE_Y',
      ParamHairFront: 'PARAM_HAIR_FRONT',
      ParamHairSide: 'PARAM_HAIR_SIDE',
      ParamHairBack: 'PARAM_HAIR_BACK',
      ParamBrowLY: 'PARAM_BROW_L_Y',
      ParamBrowRY: 'PARAM_BROW_R_Y',
      ParamBrowLAngle: 'PARAM_BROW_L_ANGLE',
      ParamBrowRAngle: 'PARAM_BROW_R_ANGLE',
      ParamBrowLForm: 'PARAM_BROW_L_FORM',
      ParamBrowRForm: 'PARAM_BROW_R_FORM',
      ParamBrowLX: 'PARAM_BROW_L_X',
      ParamBrowRX: 'PARAM_BROW_R_X',
      ParamEyeLSmile: 'PARAM_EYE_L_SMILE',
      ParamEyeRSmile: 'PARAM_EYE_R_SMILE',
      ParamEyeSmile: 'PARAM_EYE_SMILE',
      ParamCheek: 'PARAM_CHEEK',
      ParamPupilX: 'PARAM_PUPIL_X',
      ParamPupilY: 'PARAM_PUPIL_Y',
      ParamPupilSize: 'PARAM_PUPIL_SIZE',
      ParamEyeScale: 'PARAM_EYE_SCALE',
      ParamTear: 'PARAM_TEAR'
    }
    return map[id] || id
  }

  function setParamValue(id, v) {
    try {
      var core = model && model.internalModel && model.internalModel.coreModel
      if (!core) return
      var realId = paramName(id)
      if (typeof core.setParameterValueById === 'function') core.setParameterValueById(realId, v, 1)
      else if (typeof core.setParamFloat === 'function') core.setParamFloat(realId, v)
    } catch (e) { /* ignore */ }
  }

  // Cubism2 模型没有统一的 ParamEyeSmile/ParamBrowAngle，需要拆到左右眼/左右眉。
  function setFaceParam(id, v) {
    if (modelFormat === 'cubism2') {
      if (id === 'ParamEyeSmile') {
        setParamValue('ParamEyeLSmile', v)
        setParamValue('ParamEyeRSmile', v)
        return
      }
      if (id === 'ParamBrowLY') {
        setParamValue('ParamBrowLY', v)
        setParamValue('ParamBrowLAngle', v * 0.4)
        setParamValue('ParamBrowLForm', v * 0.4)
        return
      }
      if (id === 'ParamBrowRY') {
        setParamValue('ParamBrowRY', v)
        setParamValue('ParamBrowRAngle', v * 0.4)
        setParamValue('ParamBrowRForm', v * 0.4)
        return
      }
    }
    setParamValue(id, v)
  }

  // 眨眼与表情眼开度分开结算：表情负责基准眼开度，眨眼在其上相乘，
  // 这样兴奋/惊讶时眼开度再大也不会把眨眼盖掉。
  function applyEyeLids() {
    if (!model) return
    var l = Math.max(0, Math.min(1, (typeof lastEmotionEyeOpen[0] === 'number' ? lastEmotionEyeOpen[0] : 1) * natural.eyeLids[0]))
    var r = Math.max(0, Math.min(1, (typeof lastEmotionEyeOpen[1] === 'number' ? lastEmotionEyeOpen[1] : 1) * natural.eyeLids[1]))
    setParamValue('ParamEyeLOpen', l)
    setParamValue('ParamEyeROpen', r)
  }

  function setMouth(v) {
    if (!model || !mouthParam) return
    try {
      var core = model.internalModel && model.internalModel.coreModel
      if (!core) return
      // 只驱动嘴张开（PARAM_MOUTH_OPEN_Y），不再顺便拉大嘴角/嘴宽——
      // “嘴的幅度大”和“笑的幅度大”解耦，微笑/嘴角由情绪表情单独控制。
      var target = Math.max(0, Math.min(1, v * 2.2))
      lastMouthValue += (target - lastMouthValue) * 0.85
      if (Math.abs(lastMouthValue - target) < 0.004) lastMouthValue = target
      if (mouthParam.kind === 'c2') {
        if (core.setParamFloat) core.setParamFloat(mouthParam.name, lastMouthValue)
      } else if (mouthParam.id && core.setParameterValueById) {
        core.setParameterValueById(mouthParam.id, lastMouthValue, 1)
      } else if (mouthParam.id && core.setParamFloat) {
        core.setParamFloat(mouthParam.id, lastMouthValue)
      }
    } catch (e) { /* ignore */ }
  }

  var mouthParam = null
  var breathParam = null
  var eyeParam = null

  function bindMouth() {
    mouthParam = null
    breathParam = null
    eyeParam = null
    try {
      var core = model.internalModel && model.internalModel.coreModel
      if (!core) return
      if (typeof core.setParamFloat === 'function') {
        mouthParam = { kind: 'c2', name: 'PARAM_MOUTH_OPEN_Y' }
        breathParam = { kind: 'c2', name: 'PARAM_BREATH' }
        eyeParam = { kind: 'c2', left: 'PARAM_EYE_L_OPEN', right: 'PARAM_EYE_R_OPEN' }
        return
      }
      var mid = 'ParamMouthOpenY'
      var bid = 'ParamBreath'
      var eL = 'ParamEyeLOpen'
      var eR = 'ParamEyeROpen'
      var ids = core.getParameterIds ? core.getParameterIds() : []
      for (var i = 0; i < ids.length; i++) {
        if (/MouthOpen/i.test(ids[i])) mid = ids[i]
        if (/Breath/i.test(ids[i])) bid = ids[i]
        if (/EyeLOpen/i.test(ids[i])) eL = ids[i]
        if (/EyeROpen/i.test(ids[i])) eR = ids[i]
      }
      mouthParam = { kind: 'c4', id: mid }
      breathParam = { kind: 'c4', id: bid }
      eyeParam = { kind: 'c4', left: eL, right: eR }
    } catch (e) { /* ignore */ }
  }

  function mkC4Setter(id) {
    return function (v) { setParamValue(id, v) }
  }
  function mkC2Setter(name) {
    return function (v) {
      try {
        var core = model && model.internalModel && model.internalModel.coreModel
        if (core && core.setParamFloat) core.setParamFloat(name, v)
      } catch (e) { /* ignore */ }
    }
  }

  function bindGestures() {
    gesture = { kind: '', arms: [], shoulders: [], body: [], head: [] }
    try {
      var core = model.internalModel && model.internalModel.coreModel
      if (!core) return
      if (typeof core.setParamFloat === 'function') {
        gesture.kind = 'c2'
        gesture.arms.push(mkC2Setter('PARAM_ARM_L'))
        gesture.arms.push(mkC2Setter('PARAM_ARM_R'))
        gesture.shoulders.push(mkC2Setter('PARAM_SHOULDER_L'))
        gesture.shoulders.push(mkC2Setter('PARAM_SHOULDER_R'))
        gesture.body.push(mkC2Setter('PARAM_BODY_ANGLE_X'))
        gesture.body.push(mkC2Setter('PARAM_BODY_ANGLE_Y'))
        gesture.head.push(mkC2Setter('PARAM_ANGLE_X'))
        gesture.head.push(mkC2Setter('PARAM_ANGLE_Z'))
      } else {
        gesture.kind = 'c4'
        var seen = {}
        function addC4(list, id) {
          if (!id || seen[id]) return
          seen[id] = 1
          list.push(mkC4Setter(id))
        }
        var knownArms = ['ParamArmL01', 'ParamArmL02', 'ParamArmL03', 'ParamArmR01', 'ParamArmR02', 'ParamArmR03', 'Param4', 'Param6', 'Param7']
        var knownShoulders = ['ParamShoulderL', 'ParamShoulderR']
        var knownBody = ['ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ']
        var knownHead = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ']
        for (var a = 0; a < knownArms.length; a++) addC4(gesture.arms, knownArms[a])
        for (var b = 0; b < knownShoulders.length; b++) addC4(gesture.shoulders, knownShoulders[b])
        for (var c = 0; c < knownBody.length; c++) addC4(gesture.body, knownBody[c])
        for (var d = 0; d < knownHead.length; d++) addC4(gesture.head, knownHead[d])
        var ids = core.getParameterIds ? core.getParameterIds() : []
        for (var j = 0; j < ids.length; j++) {
          var id = ids[j]
          if (/ShoulderL/i.test(id)) addC4(gesture.shoulders, id)
          else if (/ShoulderR/i.test(id)) addC4(gesture.shoulders, id)
          else if (/ArmL/i.test(id)) addC4(gesture.arms, id)
          else if (/ArmR/i.test(id)) addC4(gesture.arms, id)
          else if (/^Param4$|^Param6$|^Param7$/.test(id)) addC4(gesture.arms, id)
          else if (/BodyAngleX/i.test(id)) addC4(gesture.body, id)
          else if (/BodyAngleY/i.test(id)) addC4(gesture.body, id)
          else if (/AngleX/i.test(id) && !/Body/i.test(id)) addC4(gesture.head, id)
          else if (/AngleZ/i.test(id) && !/Body/i.test(id)) addC4(gesture.head, id)
        }
      }
    } catch (e) {
      gesture = { kind: '', arms: [], shoulders: [], body: [], head: [] }
    }
  }

  function setExpression(name) {
    if (!model || !name) return
    var exprId = EXPR[name] || name
    var emotionName = EXPR_TO_EMO[name] || name
    // Task5：经 vendor/pld-cubism2.min.js 验证，Cubism2 运行时支持 model.expression(name)
    // （ExpressionManager.definitions 按 name 解析）。Sakiko model.json 注册 29 个 expressions
    // （angry01/02/07、cry01-04、default、idle01、kime01、odoodo01、sad01/02、serious01/02、
    //  shame01/02、sigh01/02、smile01-06、surprised01/02、thinking01/02）→ C2 也走表达式 API。
    // 仅当目标 expression 名确实已注册时才走 API，否则落到下方参数直驱兜底（C2_FACE 已按
    // Sakiko exp.json 的真实参数 id 修正，避免 model.expression() 空转导致表情不生效）。
    var canExpr = false
    try {
      var mm = model.internalModel && model.internalModel.motionManager
      var exps = mm && (mm.expressions || (mm.expressionManager && mm.expressionManager.definitions))
      if (exps && exprId) {
        if (Array.isArray(exps)) {
          for (var ei = 0; ei < exps.length; ei++) {
            var ed = exps[ei]
            if (ed && (ed.name === exprId || ed.id === exprId || ed === exprId)) { canExpr = true; break }
          }
        } else if (Object.prototype.hasOwnProperty.call(exps, exprId)) {
          canExpr = true
        }
      }
    } catch (e) { /* ignore */ }
    if (canExpr) {
      try { model.expression(exprId); return } catch (e) { /* ignore */ }
    }
    try {
      var core = model.internalModel && model.internalModel.coreModel
      if (!core) return
      var c4 = typeof core.setParameterValueById === 'function'
      var set = c4 ? function (id, v) { try { core.setParameterValueById(id, v, 1) } catch (e2) { /* ignore */ } } : function (id, v) { try { core.setParamFloat(id, v) } catch (e2) { /* ignore */ } }
      var isC2 = modelFormat === 'cubism2' || !c4
      var emoMap = (window.SakikoEmotion && (isC2 ? window.SakikoEmotion.C2_FACE : window.SakikoEmotion.FACE)) || {}
      // 兜底直驱前先清空本表情表会用到的所有参数（避免上一表情残留），再写入目标值。
      var keys = {}
      var rk
      for (rk in emoMap) {
        var row = emoMap[rk]
        if (row) for (var pk in row) if (Object.prototype.hasOwnProperty.call(row, pk)) keys[pk] = 1
      }
      if (isC2) {
        // C2 骨架上始终参与口型/眨眼/头部的基础参数
        keys.PARAM_MOUTH_OPEN_Y = 1
        keys.PARAM_EYE_L_OPEN = 1
        keys.PARAM_EYE_R_OPEN = 1
        keys.PARAM_ANGLE_X = 1
        keys.PARAM_ANGLE_Z = 1
      }
      for (var zk in keys) set(zk, 0)
      var target = emoMap[emotionName] || {}
      for (var k in target) {
        if (Object.prototype.hasOwnProperty.call(target, k)) set(k, target[k])
      }
    } catch (e) { /* ignore */ }
  }

  function getAudioEnergy() {
    if (!analyser) return 0
    try {
      var data = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteFrequencyData(data)
      var sum = 0
      for (var i = 0; i < data.length; i++) sum += data[i]
      var raw = sum / data.length / 255
      energySmooth += (raw - energySmooth) * 0.45
      return Math.max(0, Math.min(1, energySmooth * 1.8))
    } catch (e) { return 0 }
  }

  function computeMouth(now, energy) {
    if (mouthWords && mouthWords.length > 0 && audioEl && !audioEl.paused) {
      var t = audioEl.currentTime * 1000
      var wordAmp = 0
      for (var j = 0; j < mouthWords.length; j++) {
        var w = mouthWords[j]
        var on = typeof w.o === 'number' ? w.o : 0
        var dur = typeof w.d === 'number' && w.d > 40 ? w.d : 60
        if (t >= on && t <= on + dur) {
          var p = (t - on) / dur
          var env = p < 0.18 ? p / 0.18 : 1 - Math.pow((p - 0.18) / 0.82, 1.6)
          if (env > wordAmp) wordAmp = env
        }
      }
      return Math.min(1, Math.max(energy, wordAmp * 1.5))
    }
    if (analyser) return Math.min(1, energy * 1.6)
    return 0.6 + 0.4 * Math.abs(Math.sin(now / 70))
  }

  function updateNatural(now) {
    if (now > natural.headAt) {
      natural.headAt = now + 1100 + Math.random() * 2600
      natural.headTarget = [
        (Math.random() - 0.5) * 40,
        (Math.random() - 0.5) * 30,
        (Math.random() - 0.5) * 30
      ]
    }
    for (var i = 0; i < 3; i++) natural.head[i] += (natural.headTarget[i] - natural.head[i]) * 0.09
    if (now > natural.eyesAt) {
      natural.eyesAt = now + 700 + Math.random() * 1900
      natural.eyesTarget = [
        (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.7
      ]
    }
    for (var j = 0; j < 2; j++) natural.eyes[j] += (natural.eyesTarget[j] - natural.eyes[j]) * 0.11
    // 眨眼四段式：闭合中 → 完全闭合保持 → 睁开中 → 睁眼等待。
    // 必须真正闭住几十毫秒，才能被清楚看到。
    if (natural.blinkState === 'Open') {
      if (now > natural.blinkAt) {
        natural.blinkAt = now + 80 + Math.random() * 70
        natural.eyeLidsTarget = [0, 0]
        natural.blinkState = 'Closing'
      }
    } else if (natural.blinkState === 'Closing') {
      if (now > natural.blinkAt) {
        natural.blinkAt = now + 70 + Math.random() * 60
        natural.eyeLidsTarget = [0, 0]
        natural.blinkState = 'Closed'
      }
    } else if (natural.blinkState === 'Closed') {
      if (now > natural.blinkAt) {
        natural.blinkAt = now + 90 + Math.random() * 80
        natural.eyeLidsTarget = [1, 1]
        natural.blinkState = 'Opening'
      }
    } else if (natural.blinkState === 'Opening') {
      if (now > natural.blinkAt) {
        // 偶尔连续眨两下，更像真人
        if (Math.random() < 0.12) {
          natural.blinkAt = now + 180 + Math.random() * 160
          natural.eyeLidsTarget = [1, 1]
          natural.blinkState = 'WaitDouble'
        } else {
          natural.blinkAt = now + 4200 + Math.random() * 4800
          natural.eyeLidsTarget = [1, 1]
          natural.blinkState = 'Open'
        }
      }
    } else if (natural.blinkState === 'WaitDouble') {
      if (now > natural.blinkAt) {
        natural.blinkAt = now + 80 + Math.random() * 70
        natural.eyeLidsTarget = [0, 0]
        natural.blinkState = 'Closing'
      }
    }
    natural.eyeLids[0] += (natural.eyeLidsTarget[0] - natural.eyeLids[0]) * 0.45
    natural.eyeLids[1] += (natural.eyeLidsTarget[1] - natural.eyeLids[1]) * 0.45
  }

  function applyNaturalParams() {
    if (!model) return
    setParamValue('ParamAngleX', natural.head[0])
    setParamValue('ParamAngleY', natural.head[1])
    setParamValue('ParamAngleZ', natural.head[2])
    setParamValue('ParamBodyAngleX', natural.head[0] * 0.35)
    setParamValue('ParamBodyAngleY', natural.head[1] * 0.35)
    setParamValue('ParamBodyAngleZ', natural.head[2] * 0.35)
    setParamValue('ParamEyeBallX', natural.eyes[0])
    setParamValue('ParamEyeBallY', natural.eyes[1])
    if (breathParam) {
      try {
        var core2 = model.internalModel && model.internalModel.coreModel
        if (core2) {
          var breath = 0.5 + 0.5 * Math.sin(Date.now() / 2800)
          if (breathParam.kind === 'c2') core2.setParamFloat(breathParam.name, breath)
          else if (breathParam.id && core2.setParameterValueById) core2.setParameterValueById(breathParam.id, breath, 1)
        }
      } catch (e) { /* ignore */ }
    }
    // 头发/眉毛微动，让待机不僵硬
    var t = Date.now() / 1000
    var hairFront = Math.sin(t * 0.8) * 0.05 + natural.head[0] * 0.01
    var hairSide = Math.sin(t * 0.7 + 1.1) * 0.06 + natural.head[2] * 0.01
    var hairBack = Math.sin(t * 0.6 + 2.2) * 0.04
    setParamValue('ParamHairFront', hairFront)
    setParamValue('ParamHairSide', hairSide)
    setParamValue('ParamHairBack', hairBack)
    setParamValue('ParamBrowLY', natural.head[1] * 0.01 + Math.sin(t * 0.5) * 0.02)
    setParamValue('ParamBrowRY', natural.head[1] * 0.01 + Math.sin(t * 0.5 + 0.5) * 0.02)
  }

  function currentSpeakPattern(now) {
    if (now > speakPatternAt || speakPatternIdx < 0) {
      speakPatternAt = now + 1300 + Math.random() * 1600
      var idx = Math.floor(Math.random() * SPEAK_PATTERNS.length)
      if (idx === speakPatternIdx) idx = (idx + 1) % SPEAK_PATTERNS.length
      speakPatternIdx = idx
    }
    return SPEAK_PATTERNS[speakPatternIdx]
  }

  function applyGestures(energy, now) {
    if (gesture.arms.length === 0 && gesture.shoulders.length === 0 && gesture.body.length === 0 && gesture.head.length === 0) return
    var t = now / 1000
    var emo = gestureEmotion || 'neutral'
    var g = (window.SakikoEmotion && window.SakikoEmotion.GESTURE && window.SakikoEmotion.GESTURE[emo]) || { amp: 1, speed: 1 }
    var pat = currentSpeakPattern(now)
    var amp = g.amp
    var speed = g.speed * pat.speed
    var e = Math.max(0.2, Math.min(1.5, energy || 0.6))
    // 不同说话动作模式：wave / sway / bob / lean / calm，定期 shuffle，避免机械重复
    var headX = (natural.head[0] * 0.1 + Math.sin(t * 2.0 * speed) * pat.headX) * (1 + e) * amp
    var headY = natural.head[1] * pat.headY * (1 + e) * amp
    var headZ = (natural.head[2] * 0.1 + Math.sin(t * 1.5 * speed + 0.9) * pat.headZ) * (1 + e) * amp
    // 身体动作加大：身体比头更明显地摇摆/起伏，说话时整个人是“活”的
    var bodyX = headX * 0.5 + Math.sin(t * 1.7 * speed) * (pat.bodyX + 2.8 * e) * amp
    var bodyY = headY * 0.5 + Math.sin(t * 1.3 * speed + 0.6) * (pat.bodyY + 1.6 * e) * amp
    var bodyZ = headZ * 0.45 + Math.sin(t * 1.1 * speed + 1.2) * (1.0 + 1.2 * e) * amp
    var hairFront = Math.sin(t * 1.8 * speed) * (0.16 + 0.3 * e) * amp
    var hairSide = Math.sin(t * 1.5 * speed + 0.8) * (0.2 + 0.36 * e) * amp
    var hairBack = Math.sin(t * 1.2 * speed + 1.6) * (0.12 + 0.24 * e) * amp
    setParamValue('ParamHairFront', hairFront)
    setParamValue('ParamHairSide', hairSide)
    setParamValue('ParamHairBack', hairBack)
    setParamValue('ParamBrowLY', Math.sin(t * 1.1 * speed) * 0.14 * amp)
    setParamValue('ParamBrowRY', Math.sin(t * 1.1 * speed + 0.4) * 0.14 * amp)
    for (var i = 0; i < gesture.arms.length; i++) gesture.arms[i](0.35 + pat.arm * amp * e * (0.5 + 0.5 * Math.sin(t * 2.1 * speed + i * 0.9)))
    for (var s = 0; s < gesture.shoulders.length; s++) gesture.shoulders[s](0.15 + 0.9 * amp * e * Math.sin(t * 1.6 * speed + s * 1.7))
    for (var j = 0; j < gesture.body.length; j++) gesture.body[j](j === 0 ? bodyX : (j === 1 ? bodyY : bodyZ))
    for (var k = 0; k < gesture.head.length; k++) gesture.head[k](k === 0 ? headX : (k === 1 ? headZ : headX * 0.4))
  }

  // Task5: 每帧平滑脸参数层（writeFaceConfig 写盘）。与 emotion.js 同源调教：
  //  - Sakiko C2 表情主路径 = 运行时 model.expression(name)（smile03/sad01/...，见 setExpression）；
  //  - 本表保留为无 expression 时的兜底/过渡层，情绪键与 EXPR 一致，18 情绪全覆盖，
  //    数值与 C2_FACE 同族（白祥系微笑/害羞幅度略高，愤怒更收敛、保持优雅）。
  var EMOTION_FACE = {
    happy:        { cheek: 0.4, eyeSmile: 0.85, mouthForm: 0.35, browL: 0.05, browR: 0.05, pupilSize: 1.05 },
    excited:      { cheek: 0.5, eyeSmile: 0.95, mouthForm: 0.5, browL: 0.1, browR: 0.1, eyeLOpen: 0.95, eyeROpen: 0.95, pupilSize: 1.1 },
    elated:       { cheek: 0.6, eyeSmile: 1.0, mouthForm: 0.65, browL: 0.15, browR: 0.15, eyeLOpen: 1, eyeROpen: 1, pupilSize: 1.15 },
    sad:          { cheek: 0.12, eyeSmile: -0.3, mouthForm: -0.3, browL: 0.25, browR: 0.25, pupilY: 0.2, tear: 0.25, pupilSize: 0.9 },
    angry:        { cheek: 0.15, eyeSmile: -0.45, mouthForm: 0.3, browL: -0.3, browR: -0.3, eyeLOpen: 0.85, eyeROpen: 0.85, pupilSize: 0.95 },
    furious:      { cheek: 0.2, eyeSmile: -0.6, mouthForm: 0.45, browL: -0.45, browR: -0.45, eyeLOpen: 0.8, eyeROpen: 0.8, pupilSize: 0.9 },
    question:     { cheek: 0.05, eyeSmile: 0.1, mouthForm: 0.1, browL: 0.25, browR: 0.25, pupilX: 0.15, pupilY: -0.1, pupilSize: 1.0 },
    soft:         { cheek: 0.3, eyeSmile: 0.5, mouthForm: -0.1, browL: 0.08, browR: 0.08, pupilSize: 1.0 },
    blush:        { cheek: 1.0, eyeSmile: 0.6, mouthForm: -0.1, browL: 0.18, browR: 0.18, pupilY: 0.18, pupilSize: 1.05 },
    annoyed:      { cheek: 0.1, eyeSmile: -0.35, mouthForm: 0.15, browL: -0.25, browR: -0.25, pupilSize: 0.95 },
    thinking:     { cheek: 0.05, eyeSmile: 0.1, mouthForm: -0.2, browL: 0.3, browR: 0.3, pupilX: -0.2, pupilY: -0.25, pupilSize: 0.9 },
    surprised:    { cheek: 0.1, eyeSmile: 0.1, mouthForm: 0.2, browL: -0.35, browR: -0.35, eyeLOpen: 1, eyeROpen: 1, pupilX: 0, pupilY: 0, pupilSize: 1.25 },
    disappointed: { cheek: 0.05, eyeSmile: -0.3, mouthForm: -0.35, browL: 0.2, browR: 0.2, pupilY: 0.2, pupilSize: 0.9 },
    eyes_closed:  { eyeSmile: 0.2, mouthForm: -0.1, eyeLOpen: 0, eyeROpen: 0, pupilSize: 1.0 },
    indifferent:  { cheek: 0, eyeSmile: -0.1, mouthForm: -0.2, browL: 0.05, browR: 0.05, pupilSize: 0.95 },
    side:         { cheek: 0.05, eyeSmile: 0.1, mouthForm: -0.1, browL: 0.2, browR: 0.2, pupilX: 0.35, pupilY: -0.1, pupilSize: 1.0 },
    winking:      { cheek: 0.4, eyeSmile: 0.7, mouthForm: 0.25, browL: 0.1, browR: 0.1, eyeLOpen: 1, eyeROpen: 0, pupilSize: 1.05 },
    neutral:      { cheek: 0, eyeSmile: 0, mouthForm: 0, browL: 0, browR: 0, pupilX: 0, pupilY: 0, pupilSize: 1 }
  }

  function writeFaceConfig(cfg, k) {
    setFaceParam('ParamCheek', (cfg.cheek || 0) * k)
    setFaceParam('ParamEyeSmile', (cfg.eyeSmile || 0) * k)
    // 嘴角/微笑始终跟随情绪，不因说话而消失，也不受嘴张开幅度影响
    setParamValue('ParamMouthForm', (cfg.mouthForm || 0) * k)
    setFaceParam('ParamBrowLY', (cfg.browL || 0) * k)
    setFaceParam('ParamBrowRY', (cfg.browR || 0) * k)
    setParamValue('ParamEyeBallX', (cfg.pupilX || 0) * k * 0.5)
    setParamValue('ParamEyeBallY', (cfg.pupilY || 0) * k * 0.5)
    setParamValue('ParamPupilX', (cfg.pupilX || 0) * k)
    setParamValue('ParamPupilY', (cfg.pupilY || 0) * k)
    setParamValue('ParamPupilSize', (cfg.pupilSize || 1) * (0.8 + 0.4 * k))
    setParamValue('ParamEyeScale', (cfg.pupilSize || 1) * (0.8 + 0.4 * k))
    setParamValue('ParamTear', (cfg.tear || 0) * k)
    // 表情只声明基准眼开度，实际开合由 applyEyeLids 结合眨眼计算
    lastEmotionEyeOpen = [
      (typeof cfg.eyeLOpen === 'number') ? cfg.eyeLOpen : 1,
      (typeof cfg.eyeROpen === 'number') ? cfg.eyeROpen : 1
    ]
  }

  // 情绪触发：记录目标，由 updateEmotionFace 每帧平滑过渡（参考 ai-live2d-go setEmotionParams）
  function applyEmotionFace(emo, intensity) {
    var e = EMOTION_FACE[emo] || EMOTION_FACE.neutral
    var k = Math.max(0.2, Math.min(1.5, intensity || 0.6))
    faceBlend.from = lastFaceConfig
    faceBlend.target = e
    faceBlend.k = k
    faceBlend.start = Date.now()
    faceBlend.ms = 260
  }

  function faceDefault(kk) {
    // eyeLOpen/eyeROpen/pupilSize 缺省值是 1（睁眼/正常瞳孔），其它表情参数缺省是 0。
    if (kk === 'eyeLOpen' || kk === 'eyeROpen' || kk === 'pupilSize') return 1
    return 0
  }
  function faceVal(o, kk) {
    if (o && typeof o[kk] === 'number') return o[kk]
    return faceDefault(kk)
  }

  function updateEmotionFace(now) {
    var b = faceBlend
    var cfg = lastFaceConfig
    var k = lastFaceK
    if (b.target) {
      var t = Math.min(1, (now - b.start) / Math.max(1, b.ms))
      var eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      cfg = {}
      var keys = {}
      for (var key in b.from) keys[key] = 1
      for (var key2 in b.target) keys[key2] = 1
      for (var kk in keys) cfg[kk] = faceVal(b.from, kk) * (1 - eased) + faceVal(b.target, kk) * eased
      k = lastFaceK + (b.k - lastFaceK) * eased
      lastFaceConfig = cfg
      lastFaceK = k
      if (t >= 1) { b.target = null; b.from = null }
    }
    writeFaceConfig(cfg, k)
  }

  function applyIdleGestures(now) {
    var t = now / 1000
    var bored = (now - lastInteractionAt) > 60000
    var slow = bored ? 0.55 : 1
    // 无聊时：动作变慢变小，并周期性“叹气”（头/肩/身体一起沉一下再回来）
    var sigh = bored ? Math.pow(Math.max(0, Math.sin(now / 4300)), 8) : 0
    var idleHeadX = natural.head[0] * 0.05 + Math.sin(t * 0.9 * slow) * 0.4 * slow - sigh * 0.7
    var idleHeadZ = natural.head[2] * 0.05 + Math.sin(t * 0.7 * slow + 1.2) * 0.32 * slow + sigh * 0.35
    var idleHeadY = natural.head[1] * 0.05 + Math.sin(t * 0.5 * slow + 0.6) * 0.22 * slow - sigh * 0.5
    var idleBodyX = Math.sin(t * 0.8 * slow) * 1.0 * slow
    var idleBodyY = Math.sin(t * 0.55 * slow + 1.1) * 0.5 * slow - sigh * 1.4
    var idleArm = 0.18 + 0.3 * Math.sin(t * 0.6 * slow) - sigh * 0.3
    for (var i = 0; i < gesture.head.length; i++) gesture.head[i](i === 0 ? idleHeadX : (i === 1 ? idleHeadZ : idleHeadY))
    for (var j = 0; j < gesture.body.length; j++) gesture.body[j](j === 0 ? idleBodyX : (j === 1 ? idleBodyY : idleBodyX * 0.4))
    for (var a = 0; a < gesture.arms.length; a++) gesture.arms[a](Math.max(0.05, idleArm + 0.12 * Math.sin(t * 0.9 * slow + a * 1.3)))
    for (var s = 0; s < gesture.shoulders.length; s++) gesture.shoulders[s](0.12 + 0.22 * Math.sin(t * 0.7 * slow + s * 1.7) + sigh * 0.5)
    setParamValue('ParamHairFront', Math.sin(t * 0.8 * slow) * 0.4)
    setParamValue('ParamHairSide', Math.sin(t * 0.7 * slow + 1.1) * 0.55)
    setParamValue('ParamHairBack', Math.sin(t * 0.6 * slow + 2.2) * 0.32)
  }

  function resetGestures() {
    for (var i = 0; i < gesture.arms.length; i++) gesture.arms[i](0)
    for (var s = 0; s < gesture.shoulders.length; s++) gesture.shoulders[s](0)
    for (var j = 0; j < gesture.body.length; j++) gesture.body[j](0)
    for (var k = 0; k < gesture.head.length; k++) gesture.head[k](0)
  }

  function startSpeaking(item, words) {
    gestureEmotion = item.emotion || EXPR_TO_EMO[item.expr] || 'neutral'
    setExpression(gestureEmotion)
    applyEmotionFace(gestureEmotion, 1)
    mouthWords = words || []
    speaking = true
    lastMouthValue = 0
    lastInteractionAt = Date.now()
    speakPatternIdx = -1
    speakPatternAt = 0
  }

  function stopSpeaking() {
    speaking = false
    mouthWords = null
    resetGestures()
    setExpression('neutral')
    applyEmotionFace('neutral', 0)
    window.setTimeout(function () {
      if (!speaking) setMouth(0)
    }, 120)
  }

  var animRunning = false
  function startAnimationLoop() {
    if (animRunning) return
    animRunning = true
    var loop = function () {
      var now = Date.now()
      if (model) {
        updateNatural(now)
        applyNaturalParams()
        if (speaking) {
          var energy = getAudioEnergy()
          setMouth(computeMouth(now, energy))
          updateEmotionFace(now)
          applyEyeLids()
          applyGestures(Math.max(0.2, energy * 1.4), now)
        } else {
          setMouth(0)
          updateEmotionFace(now)
          applyEyeLids()
          applyIdleGestures(now)
        }
      }
      window.requestAnimationFrame(loop)
    }
    window.requestAnimationFrame(loop)
  }

  // Task7 考据台词填充完成（docs/sakiko-quotes.md A7 节，均为白祥语域）：
  //  - head（点头/轻拍头＝被摸头）→ A7-1 害羞推辞（原文直用）＋ A7-4 惊讶害羞（原创）；
  //  - body（摸/拍身体＝被突然触碰）→ A7-2/A7-3 短促惊讶轻呼（节选，作低频短反应）。
  // A7 全为摸头/点头语义、无专门"摸身体"台词 → 两池按上述语义就近分配（差异见 7b 报告）。
  // 触碰反应现在也出气泡（修复「只出声无文字」）：cn 逐字取自考据表 A7 已批中文
  // （docs/sakiko-quotes.md L112–L115），playTap 以 bubble 元数据随条目入队，
  // 由 pump 在该句播放瞬间经 renderItemBubble 插入气泡（沿用 T2 既有语义）。
  // 空池保护逻辑保留：若未来候选被抽空，playTap 空池时仍只做动作/表情、不播报台词。
  var TAP_LINES = {
    head: [
      { jp: 'お… おかまいなく', cn: '别… 别在意', emotion: 'blush' }, // A7-1 摸头·害羞（原文直用 MyGO#3 00:05:06）
      { jp: 'まあ… 急にどうしましたの？ 照れますわ', cn: '哎呀…突然怎么啦？我都要害羞了', emotion: 'blush' } // A7-4 摸头·害羞（原创·依考据风格）
    ],
    body: [
      { jp: 'あら', cn: '呀', emotion: 'surprised' }, // A7-2 点头·惊讶（节选 MyGO#3 00:04:43）
      { jp: 'まあ', cn: '哎呀', emotion: 'surprised' } // A7-3 摸头·惊讶（节选 MyGO#3 00:04:55）
    ]
  }

  function playTap(area) {
    if (!model) return
    lastInteractionAt = Date.now()
    var prevEmotion = gestureEmotion || 'neutral'
    var pool = TAP_LINES[area] || []
    var pick = null
    if (pool.length > 0) pick = pool[Math.floor(Math.random() * pool.length)]
    if (area === 'head') {
      // Task5: 原 flick_head motion 在 Sakiko model.json 不存在 → 映射为 nod01（已确认存在）
      var headEmo = (pick && pick.emotion) || 'question'
      setExpression(headEmo)
      applyEmotionFace(headEmo, 0.8)
      try { model.motion('nod01') } catch (e) { /* ignore */ }
      for (var i = 0; i < gesture.head.length; i++) gesture.head[i](i === 0 ? -0.25 : (i === 1 ? 0.1 : -0.1))
      window.setTimeout(function () { for (var j = 0; j < gesture.head.length; j++) gesture.head[j](0) }, 500)
    } else {
      // Task5: 原 tap_body motion 在 Sakiko model.json 不存在 → 映射为 kime01（已确认存在）
      var bodyEmo = (pick && pick.emotion) || 'happy'
      setExpression(bodyEmo)
      applyEmotionFace(bodyEmo, 0.8)
      try { model.motion('kime01') } catch (e) { /* ignore */ }
      for (var k = 0; k < gesture.arms.length; k++) gesture.arms[k](0.6 + 0.2 * Math.sin(k))
      window.setTimeout(function () { for (var m = 0; m < gesture.arms.length; m++) gesture.arms[m](0) }, 600)
    }
    setParamValue('Param9', 0.55)
    window.setTimeout(function () {
      setExpression(prevEmotion)
      applyEmotionFace(prevEmotion, 0.5)
    }, 900)
    // 触碰反应补气泡（T2 后气泡改到播放瞬间插入）：传 bubble 元数据 → pump 在该句
    // 真正出声时经 renderItemBubble 插入历史气泡。不带 announce/idle 语义（不写 host memory、
    // 不参与播报节流/时间线 push——触碰是本地互动）。
    if (pick && pick.jp) enqueue(pick.jp, true, pick.emotion || 'happy', '', pick.cn || '', undefined, { cn: pick.cn || pick.jp })
  }

  function handleCanvasTap(ev) {
    if (!model) return
    if (calibMode) {
      handleCalibPointer(ev)
      return
    }
    if (ev.type !== 'pointerdown' && ev.type !== 'touchstart') return
    try {
      var rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      var y = ((ev.clientY || ev.touches && ev.touches[0] && ev.touches[0].clientY) - rect.top) / rect.height
      var x = ((ev.clientX || ev.touches && ev.touches[0] && ev.touches[0].clientX) - rect.left) / rect.width
      var area = y < 0.35 ? 'head' : 'body'
      playTap(area)
      report('tap l2d: ' + area + ' x=' + x.toFixed(2) + ' y=' + y.toFixed(2))
    } catch (e) { /* ignore */ }
  }

  function handleCalibPointer(ev) {
    if (!model || !canvas) return
    try {
      var type = ev.type
      if (type === 'pointerdown' || type === 'touchstart') {
        calibDrag = {
          id: ev.pointerId !== undefined ? ev.pointerId : null,
          startX: ev.clientX || (ev.touches && ev.touches[0] && ev.touches[0].clientX),
          startY: ev.clientY || (ev.touches && ev.touches[0] && ev.touches[0].clientY),
          origX: modelLayout.x || 0,
          origY: modelLayout.y || 0
        }
        if (ev.preventDefault) ev.preventDefault()
        if (canvas.setPointerCapture && ev.pointerId !== undefined) {
          try { canvas.setPointerCapture(ev.pointerId) } catch (e) { /* ignore */ }
        }
      } else if ((type === 'pointermove' || type === 'touchmove') && calibDrag) {
        var cx = ev.clientX || (ev.touches && ev.touches[0] && ev.touches[0].clientX)
        var cy = ev.clientY || (ev.touches && ev.touches[0] && ev.touches[0].clientY)
        modelLayout.x = calibDrag.origX + (cx - calibDrag.startX)
        modelLayout.y = calibDrag.origY + (cy - calibDrag.startY)
        placeModel()
      } else if (type === 'pointerup' || type === 'touchend' || type === 'pointercancel') {
        calibDrag = null
      }
    } catch (e) { /* ignore */ }
  }

  function handleCalibWheel(ev) {
    if (!calibMode || !model) return
    try {
      var delta = ev.deltaY > 0 ? 0.95 : 1.05
      modelLayout.scale = Math.max(0.2, Math.min(3, (modelLayout.scale || 1) * delta))
      placeModel()
      if (ev.preventDefault) ev.preventDefault()
    } catch (e) { /* ignore */ }
  }

  function handleCalibDblClick(ev) {
    if (!calibMode || !model) return
    modelLayout = Object.assign({}, manifestLayoutBase)
    placeModel()
    if (ev.preventDefault) ev.preventDefault()
  }

  async function tryLoadModel(entry) {
    var format = entry.format || 'cubism2'
    if (format === 'cubism4') {
      await loadScriptChain('pixi')
      await loadScriptChain('core')
      await loadScriptChain('pldC4')
    } else {
      await loadScriptChain('pixi')
      await loadScriptChain('l2d21')
      await loadScriptChain('pldC2')
    }
    var P = window.PIXI
    if (!live2dReady()) throw new Error('live2d runtime unavailable (PIXI=' + !!P + ' v=' + (P && P.VERSION ? P.VERSION : '?') + ')')
    initPixi()
    report('pixi app ok, loading ' + entry.url)
    var m = await P.live2d.Live2DModel.from(entry.url, { autoInteract: true })
    try { m.anchor.set(0.5, 0.5) } catch (e) { /* ignore */ }
    app.stage.addChild(m)
    // 不能直接 m.eyeBlink = false：pld 内部每帧仍会调用 internalModel.eyeBlink.update，
    // 那样要么报错打断 update，要么内部眨眼把我们手动设的眼睛开度覆盖掉。
    // 正确做法是找到 internalModel.eyeBlink，把它调成“永不触发”，让它既不眨眼也不写参数。
    try {
      var im = m.internalModel || m
      if (im && im.eyeBlink) {
        if (typeof im.eyeBlink.setBlinkingInterval === 'function') im.eyeBlink.setBlinkingInterval(1e9)
        if ('blinkInterval' in im.eyeBlink) im.eyeBlink.blinkInterval = 1e9
        if ('nextBlinkTimeLeft' in im.eyeBlink) im.eyeBlink.nextBlinkTimeLeft = 1e9
        if ('eyeState' in im.eyeBlink) im.eyeBlink.eyeState = 0
      }
    } catch (e) { /* ignore */ }
    model = m
    modelFormat = format
    manifestScale = typeof entry.scale === 'number' ? entry.scale : 1
    manifestLayoutBase = Object.assign({ scale: 1, x: 0, y: 0, yRatio: 0.62 }, entry.layout || {})
    modelLayout = Object.assign({}, manifestLayoutBase)
    loadSavedLayout()
    if (calibBtn) calibBtn.hidden = false
    bindMouth()
    bindGestures()
    placeModel()
    window.setTimeout(placeModel, 50)
    window.setTimeout(placeModel, 300)
    startAnimationLoop()
    modelReady = true
    hideBootWhenReady()
    report('model ok ' + entry.url)
    return true
  }

  function showPlaceholder() {
    canvas.style.display = 'none'
    placeholderEl.hidden = false
    modelReady = true
    hideBootWhenReady()
  }

  async function initAvatar() {
    var manifest = { models: [], image: '', placeholder: true }
    try {
      var resp = await fetch('/sakiko/manifest', { cache: 'no-store' })
      if (resp.ok) manifest = await resp.json()
      else report('manifest http ' + resp.status)
    } catch (e) {
      report('manifest fetch failed: ' + (e && e.message ? e.message : e))
      updateChip('⚠ manifest fetch failed', true)
    }
    var models = Array.isArray(manifest.models) ? manifest.models : []
    report('manifest ok models=' + models.length)
    for (var i = 0; i < models.length; i++) {
      var entry = models[i]
      if (!entry || !entry.url) continue
      try {
        var ok = await tryLoadModel(entry)
        if (ok) {
          updateChip('● l2d ok', false)
          return
        }
      } catch (e) {
        var em = String(e && e.message ? e.message : e)
        console.warn('[sakiko] model load failed:', entry.url, em)
        report('model fail: ' + em)
        updateChip('⚠ model: ' + em.slice(0, 24), true)
        showErr('Live2D 加载失败：' + em)
      }
    }
    if (manifest.image) {
      imgEl.onload = function () {
        imgEl.hidden = false
        canvas.style.display = 'none'
        modelReady = true
        hideBootWhenReady()
      }
      imgEl.onerror = function () { showPlaceholder() }
      imgEl.src = manifest.image
      updateChip('● image', false)
      return
    }
    showPlaceholder()
    updateChip('● placeholder', false)
    report('placeholder shown')
  }

  // ---------------- 聊天历史 ----------------
  function fmtTime(t) {
    var d = new Date(t)
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2)
  }

  function makeAvatar() {
    // Task5: 聊天头像不再引用已删除的 img/boot/logo39.png → 改为首字母 S 占位。
    // 样式由 CSS 任务负责（.msg-avatar 文本头像）；JS 只保证元素类名与文本正确。
    var av = document.createElement('span')
    av.className = 'msg-avatar'
    av.textContent = 'S'
    av.setAttribute('aria-label', 'Sakiko')
    return av
  }
  function makeBubble() {
    var b = document.createElement('div')
    b.className = 'bubble'
    return b
  }
  function addTimeTo(bubble, t) {
    var s = document.createElement('span')
    s.className = 'time'
    s.textContent = fmtTime(t || Date.now())
    bubble.appendChild(s)
  }
  function makeSakikoMsg() {
    var wrap = document.createElement('div')
    wrap.className = 'msg sakiko'
    wrap.appendChild(makeAvatar())
    var b = makeBubble()
    wrap.appendChild(b)
    return { wrap: wrap, bubble: b }
  }
  function makeUserMsg() {
    var wrap = document.createElement('div')
    wrap.className = 'msg user'
    var b = makeBubble()
    wrap.appendChild(b)
    return { wrap: wrap, bubble: b }
  }

  function addHistory(entry) {
    if (!historyEl) return
    var empty = historyEl.querySelector('.msg-empty')
    if (empty) empty.remove()
    if (entry.call) {
      var callEl = document.createElement('div')
      callEl.className = 'msg call'
      callEl.textContent = '📞 ' + (entry.cn || entry.jp || '来电')
      var ct = document.createElement('span')
      ct.className = 'time'
      ct.textContent = fmtTime(entry.t || Date.now())
      callEl.appendChild(ct)
      attachReplay(callEl, entry.jp || entry.cn, entry.emotion)
      historyEl.appendChild(callEl)
      historyEl.scrollTop = historyEl.scrollHeight
      return
    }
    if (entry.role === 'user') {
      var u = makeUserMsg()
      u.bubble.textContent = entry.content
      addTimeTo(u.bubble, entry.t)
      historyEl.appendChild(u.wrap)
    } else {
      var a = makeSakikoMsg()
      a.bubble.textContent = entry.cn || entry.jp || ''
      addTimeTo(a.bubble, entry.t)
      attachReplay(a.bubble, entry.jp || entry.cn, entry.emotion)
      historyEl.appendChild(a.wrap)
    }
    historyEl.scrollTop = historyEl.scrollHeight
  }

  // ============================================================
  // Task4：聊天气泡重播按钮（祥子话语可点击重播）
  // ------------------------------------------------------------
  // 重播文本来源（按实际数据结构取；统一判据 = (jp || cn)，日文优先，纯中文同样可合成）：
  //   - 播报 announce / 空闲 idle / 来电 call 气泡：jp(=u.text，日文) 与 cn(=u.cn，中文副标题)；
  //     renderItemBubble 透传 jp+cn 给 addHistory。
  //   - 聊天回复 chat 气泡：sendChat 流式读取 finalSt.jp（日文）/ finalSt.cn（中文），与主链 jp=finalSt.jp||cn 一致。
  //   - 历史记忆装载（/sakiko/memory → addHistory）：assistant 条目自带 jp/cn/emotion。
  //   - 纯中文条目（kind:'cn' 的 pushCn / revealHistory 打字机）：只有 cn，仍启用重播（controller 实测
  //     /sakiko/tts 对中文返回 200+audio，中文合成可用，不再按「日文声线不可靠」灰显）。
  // 判定：气泡携带非空 (jp || cn) → 启用重播；两者皆空才灰显禁用。详见 task-4-report.md「Fix Round 1」。
  var replayAudioEl = null
  var replayBusy = false

  function ensureReplayAudioEl() {
    if (replayAudioEl) return replayAudioEl
    replayAudioEl = document.createElement('audio')
    replayAudioEl.preload = 'auto'
    return replayAudioEl
  }

  // 给气泡容器（.bubble / .msg.call）右下角附小喇叭重播按钮。
  // text = (jp || cn)：日文优先；非空 → data-replay 供委托点击读取（合成原文+原情绪）；两者皆空才灰显禁用。
  function attachReplay(bubble, text, emotion) {
    if (!bubble) return
    var t = String(text || '').trim()
    var btn = document.createElement('button')
    btn.className = 'bubble-replay'
    btn.type = 'button'
    btn.setAttribute('aria-label', '重播祥子的这句话')
    btn.textContent = '🔊'
    if (t.length > 0) {
      btn.dataset.replay = t
      btn.dataset.emotion = emotion || 'neutral'
    } else {
      btn.disabled = true
      btn.classList.add('disabled')
      btn.setAttribute('aria-disabled', 'true')
    }
    bubble.appendChild(btn)
  }

  // 短暂轻提示（chip 风）：独立于被 150ms 轮询覆盖的状态 chip，2s 自隐（重播中/失败反馈）
  function flashTip(text, off) {
    try {
      var el = document.createElement('div')
      el.className = 'flash-tip' + (off ? ' off' : '')
      el.textContent = text
      document.body.appendChild(el)
      window.setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el) }, 2000)
    } catch (e) { /* ignore */ }
  }

  function replayFail(msg) {
    report('replay fail: ' + msg)
    flashTip('⚠ ' + String(msg).slice(0, 26), true)
  }

  // 独立音源重播：复用 fetchAudioWithWords 的合成/缓存通道，但用独立 <audio> 播放。
  // 不投主播放队列、不触发 narrator/口型、不写 tl: 上报、不打断正在播放的播报（双音源并行）。
  function replaySpoken(text, emotion) {
    var t = String(text || '').trim()
    if (t.length === 0) return
    if (replayBusy) { flashTip('⚠ 正在重播，请稍候', true); return }
    replayBusy = true
    flashTip('♪ 重播中…', false)
    fetchAudioWithWords(t, emotion || 'neutral').then(function (obj) {
      var el = ensureReplayAudioEl()
      el.onended = function () { replayBusy = false; flashTip('♪ 重播结束', false) }
      el.onerror = function () { replayBusy = false; replayFail('播放失败') }
      el.src = obj.url
      var p = el.play()
      if (p && p.then) p.catch(function (e) {
        replayBusy = false
        replayFail('播放被拦截：' + (e && e.message ? e.message : e))
      })
    }).catch(function (e) {
      replayBusy = false
      replayFail('合成失败（网络或 TTS 服务）：' + (e && e.message ? e.message : e))
    })
  }

  // 委托点击：history 内任意 .bubble-replay（含后续动态插入的气泡），避免逐气泡绑定监听
  if (historyEl) {
    historyEl.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('.bubble-replay') : null
      if (!btn || btn.disabled) return
      var t = (btn.getAttribute('data-replay') || '').trim()
      if (!t) return
      if (ev.stopPropagation) ev.stopPropagation()
      replaySpoken(t, btn.getAttribute('data-emotion') || 'neutral')
    })
  }

  function loadMemory() {
    fetch('/sakiko/memory', { cache: 'no-store' }).then(function (resp) {
      if (!resp.ok) throw new Error('memory ' + resp.status)
      return resp.json()
    }).then(function (data) {
      var history = Array.isArray(data.history) ? data.history : []
      if (history.length === 0) {
        var empty = document.createElement('div')
        empty.className = 'msg-empty'
        empty.textContent = '—— 还没有聊天记录，和她说句话吧 ——'
        historyEl.appendChild(empty)
        return
      }
      for (var i = 0; i < history.length; i++) addHistory(history[i])
      report('memory loaded ' + history.length)
    }).catch(function (e) {
      report('memory load failed: ' + (e && e.message ? e.message : e))
    })
  }

  // ---------------- AI 聊天 ----------------
  var chatBusy = false
  var typeTimer = null

  function setChatBusy(on) {
    chatBusy = on
    if (chatSend) chatSend.style.opacity = on ? '0.4' : '1'
    if (on) updateChip('● thinking…', false)
  }

  function revealHistory(text, id) {
    var s = String(text || '')
    if (s.length === 0) return
    if (!historyEl) return
    var m = makeSakikoMsg()
    var body = document.createElement('span')
    m.bubble.appendChild(body)
    addTimeTo(m.bubble, Date.now())
    // Task4：纯中文条目（仅有 cn）→ 以中文重播（controller 实测 /sakiko/tts 对中文返回 200+audio）
    attachReplay(m.bubble, s, null)
    var empty = historyEl.querySelector('.msg-empty')
    if (empty) empty.remove()
    historyEl.appendChild(m.wrap)
    historyEl.scrollTop = historyEl.scrollHeight
    // 时间线：气泡已插入 DOM（cn 逐字浮现前），id 与 host push 对齐
    if (typeof id === 'number') report('tl:bubble:' + id)
    var i = 0
    if (typeTimer !== null) { window.clearInterval(typeTimer); typeTimer = null }
    typeTimer = window.setInterval(function () {
      i += 2
      if (i >= s.length) {
        body.textContent = s
        if (typeTimer !== null) { window.clearInterval(typeTimer); typeTimer = null }
        return
      }
      body.textContent = s.slice(0, i)
      historyEl.scrollTop = historyEl.scrollHeight
    }, 24)
  }

  async function sendChat() {
    var text = chatInput ? chatInput.value.trim() : ''
    if (text.length === 0 || chatBusy) return
    if (cfg.chatOn === false) { updateChip('⚠ chat off', true); return }
    lastInteractionAt = Date.now()
    setChatBusy(true)
    chatInput.value = ''
    addHistory({ role: 'user', content: text })
    try {
      var resp = await fetch('/sakiko/chat?text=' + encodeURIComponent(text.slice(0, 400)), { cache: 'no-store' })
      var data = await resp.json().catch(function () { return null })
      if (!resp.ok || !(data && data.chatId)) {
        var em = data && data.error ? data.error : ('http ' + resp.status)
        report('chat fail: ' + em)
        updateChip('⚠ ' + em.slice(0, 24), true)
        if (historyEl) {
          var err = makeSakikoMsg()
          err.bubble.textContent = '⚠ ' + em
          err.bubble.style.color = '#ffb4ab'
          err.bubble.style.border = '1px solid rgba(255,111,97,0.5)'
          addTimeTo(err.bubble, Date.now())
          historyEl.appendChild(err.wrap)
          historyEl.scrollTop = historyEl.scrollHeight
        }
        setChatBusy(false)
        return
      }
      var m2 = makeSakikoMsg()
      var body = document.createElement('span')
      m2.bubble.appendChild(body)
      addTimeTo(m2.bubble, Date.now())
      historyEl.appendChild(m2.wrap)
      var lastShown = ''
      var finalSt = await new Promise(function (resolve) {
        var timer = window.setInterval(function () {
          fetch('/sakiko/chatstream?chatId=' + data.chatId, { cache: 'no-store' })
            .then(function (r2) { return r2.json() })
            .then(function (st) {
              if (!st) return
              if (st.status === 'done') {
                body.textContent = st.cn || st.jp || ''
                window.clearInterval(timer)
                resolve(st)
                return
              }
              if (st.status === 'error') {
                body.textContent = '⚠ ' + String(st.error || 'error').slice(0, 60)
                window.clearInterval(timer)
                resolve(null)
                return
              }
              if (st.status === 'missing') {
                window.clearInterval(timer)
                resolve(null)
                return
              }
              var partial = ''
              var cnM = (st.raw || '').match(/CN[:：]\s*([\s\S]*)/)
              var jpM = (st.raw || '').match(/JP[:：]\s*([\s\S]*)/)
              if (cnM && cnM[1].trim().length > 0) partial = cnM[1].trim()
              else if (jpM && jpM[1].trim().length > 0) partial = jpM[1].trim()
              else partial = (st.raw || '').replace(/【[^】]*】/g, '').trim()
              if (partial.length > 0 && partial !== lastShown) {
                lastShown = partial
                body.textContent = partial + '▌'
                historyEl.scrollTop = historyEl.scrollHeight
              }
            })
            .catch(function () { /* ignore single failure */ })
        }, 140)
      })
      if (finalSt) {
        if (finalSt.streamed !== true) {
          var cn = finalSt.cn || finalSt.jp || ''
          var jp = finalSt.jp || cn
          var emotion = finalSt.emotion || 'neutral'
          var jpSentences = jp.split(/(?<=[。！？!?…\n])/).map(function (s) { return s.trim() }).filter(function (s) { return s.length > 0 })
          if (jpSentences.length === 0) jpSentences = [jp]
          for (var si = 0; si < jpSentences.length; si++) {
            enqueue(jpSentences[si], true, emotion, EXPR[emotion] || '', si === jpSentences.length - 1 ? cn : '')
          }
        }
        // Task4：聊天回复气泡可重播——(jp||cn)+原情绪，与 sendChat 主链 jp=finalSt.jp||cn 一致
        attachReplay(m2.bubble, (finalSt && (finalSt.jp || finalSt.cn)) || '', (finalSt && finalSt.emotion) || 'neutral')
        updateChip('● ' + (cfg.provider || 'edge'), false)
      }
      historyEl.scrollTop = historyEl.scrollHeight
    } catch (e) {
      report('chat error: ' + (e && e.message ? e.message : e))
      updateChip('⚠ chat error', true)
    } finally {
      setChatBusy(false)
    }
  }

  if (chatSend) chatSend.addEventListener('click', sendChat)
  if (chatInput) {
    chatInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); sendChat() }
    })
  }

  // ---------------- 语音输入 ----------------
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition
  var rec = null
  var recLangs = ['zh-CN', 'ja-JP', 'zh-TW']
  var recLangIdx = 0
  var mediaRecorder = null
  var mediaChunks = []
  var mediaStream = null
  var recording = false
  var recStopTimer = null
  var micFallbackUsed = false

  function applyRecLang() {
    if (chatLang) chatLang.textContent = recLangs[recLangIdx].split('-')[0]
  }
  applyRecLang()

  if (chatLang) {
    chatLang.addEventListener('click', function () {
      recLangIdx = (recLangIdx + 1) % recLangs.length
      applyRecLang()
      if (rec) rec.lang = recLangs[recLangIdx]
    })
  }

  function setMicUI(on) {
    if (!chatMic) return
    chatMic.classList.toggle('rec', on)
    updateChip(on ? '🎤 聆听中…' : (cfg.provider || 'edge'), false)
  }

  function stopMediaRecorder() {
    if (recStopTimer !== null) { window.clearTimeout(recStopTimer); recStopTimer = null }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop() } catch (e) { /* ignore */ }
    } else {
      if (mediaStream) mediaStream.getTracks().forEach(function (t) { t.stop() })
      mediaStream = null
    }
    recording = false
    setMicUI(false)
  }

  function sendStt(blob) {
    var lang = recLangs[recLangIdx]
    fetch('/sakiko/stt?lang=' + encodeURIComponent(lang), {
      method: 'POST',
      body: blob,
      headers: { 'Content-Type': blob.type || 'audio/webm' }
    }).then(function (r) { return r.json() }).then(function (d) {
      if (d && d.ok && d.text) {
        if (chatInput) chatInput.value = d.text.trim()
        sendChat()
      } else {
        var em = d && d.error ? d.error : 'STT failed'
        report('stt: ' + em)
        updateChip('⚠ STT: ' + em.slice(0, 24), true)
      }
    }).catch(function (e) {
      report('stt fetch fail: ' + (e && e.message ? e.message : e))
      updateChip('⚠ STT 请求失败', true)
    })
  }

  function startMediaRec() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      updateChip('⚠ 浏览器不支持录音', true)
      return
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      mediaStream = stream
      mediaChunks = []
      mediaRecorder = new MediaRecorder(stream)
      mediaRecorder.ondataavailable = function (ev) {
        if (ev.data && ev.data.size > 0) mediaChunks.push(ev.data)
      }
      mediaRecorder.onstop = function () {
        var blob = new Blob(mediaChunks, { type: mediaRecorder.mimeType || 'audio/webm' })
        if (mediaStream) mediaStream.getTracks().forEach(function (t) { t.stop() })
        mediaStream = null
        if (blob.size > 100) sendStt(blob)
        else updateChip('⚠ 录音太短', true)
      }
      mediaRecorder.onerror = function (ev) {
        report('mediaRecorder error: ' + (ev && ev.error ? ev.error : '?'))
        stopMediaRecorder()
      }
      mediaRecorder.start()
      recording = true
      setMicUI(true)
      recStopTimer = window.setTimeout(function () {
        if (recording) stopMediaRecorder()
      }, 8000)
    }).catch(function (err) {
      report('mic denied: ' + (err && err.message ? err.message : err))
      updateChip('⚠ 麦克风不可用', true)
    })
  }

  function startSpeechRec() {
    if (!SR) { startMediaRec(); return }
    if (rec && rec.listening) {
      try { rec.stop() } catch (e) { /* ignore */ }
      return
    }
    rec = new SR()
    rec.lang = recLangs[recLangIdx]
    rec.continuous = false
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.onstart = function () { setMicUI(true) }
    rec.onresult = function (ev) {
      var text = ''
      for (var i = 0; i < ev.results.length; i++) {
        if (ev.results[i][0] && ev.results[i][0].transcript) text += ev.results[i][0].transcript
      }
      if (text && chatInput) {
        chatInput.value = text.trim()
        sendChat()
      }
    }
    rec.onerror = function (ev) {
      report('mic error: ' + (ev && ev.error ? ev.error : '?'))
      var errName = ev && ev.error ? ev.error : ''
      if (cfg.sttProvider === 'auto' && !micFallbackUsed && errName !== 'not-allowed' && errName !== 'service-not-allowed') {
        micFallbackUsed = true
        setMicUI(false)
        updateChip('● 浏览器识别不可用，尝试后端 STT…', false)
        startMediaRec()
        return
      }
      if (errName === 'not-allowed' || errName === 'service-not-allowed') {
        updateChip('⚠ 麦克风被拒绝', true)
      } else if (errName === 'language-not-supported') {
        updateChip('⚠ 浏览器不支持该识别语言', true)
      } else if (errName === 'network') {
        updateChip('⚠ 语音识别网络错误', true)
      } else {
        updateChip('⚠ mic: ' + errName, true)
      }
      setMicUI(false)
    }
    rec.onend = function () { setMicUI(false) }
    try { rec.start() } catch (e) {
      report('mic start failed: ' + (e && e.message ? e.message : e))
      updateChip('⚠ mic start failed', true)
    }
  }

  function toggleMic() {
    if (recording) { stopMediaRecorder(); return }
    micFallbackUsed = false
    var mode = cfg.sttProvider || 'auto'
    if (mode === 'api' || (mode === 'auto' && !SR)) {
      startMediaRec()
    } else {
      startSpeechRec()
    }
  }
  if (chatMic) chatMic.addEventListener('click', toggleMic)

  // ---------------- 关闭 Sakiko 系统 ----------------
  var closeBtn = $('close-btn')
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      report('close requested')
      updateChip('● closing…', false)
      fetch('/sakiko/action?cmd=close', { cache: 'no-store' }).catch(function () { /* ignore */ })
    })
  }

  // ---------------- 状态与轮询 ----------------
  function updateChip(text, off) {
    statusChip.textContent = text
    if (off) statusChip.classList.add('off')
    else statusChip.classList.remove('off')
  }

  var cursor = -1
  var pollFailures = 0
  var pollReported = false

  function pollTick() {
    fetch('/sakiko/poll?after=' + cursor, { cache: 'no-store' }).then(function (resp) {
      if (!resp.ok) throw new Error('poll ' + resp.status)
      return resp.json()
    }).then(function (data) {
      pollFailures = 0
      if (data && data.config) {
        cfg = Object.assign(cfg, data.config)
        applyChatVisibility()
        if (themeSig(cfg) !== lastThemeSig) applyTheme()
      }
      if (data && typeof data.cursor === 'number') {
        var items = data.utterances || []
        for (var i = 0; i < items.length; i++) {
          var u = items[i]
          if (typeof u.id === 'number' && u.id > cursor) cursor = u.id
          if (u.kind === 'call') {
            handleCallItem(u)
          } else if (u.kind === 'hum') {
            // 随机哼唱彩蛋：直连音频入主串行队列（text 空、force true、气泡 cn='♪ ♪ ♪'、url 直连），
            // 由 pump 在播放瞬间插入气泡并播放，不叠播、不走 TTS 合成。
            enqueue('', true, u.emotion || 'happy', u.expr || '', '', u.id, { cn: u.cn || '♪ ♪ ♪', jp: '', hum: true }, u.url || '')
          } else if (u.kind === 'cn') {
            revealHistory(u.cn || '', u.id)
          } else {
            // 任务播报 / 空闲闲聊（announce/idle）：不再取到即插气泡——气泡元数据随条目
            // 入队（enqueue 末参 bubble），由 pump 在该句真正开始播放（或终局失败兜底）时插入
            var bubbleMeta = (u.announce === true || u.idle === true)
              ? { cn: u.cn || u.text, jp: u.text || '', announce: u.announce === true, idle: u.idle === true }
              : null
            enqueue(u.text, u.force === true, u.emotion || 'neutral', u.expr || '', u.cn || '', u.id, bubbleMeta)
          }
        }
        if (items.length === 0 && data.cursor > cursor) cursor = data.cursor
      }
      if (pollFailures === 0 && cursor === -1 && !pollReported) {
        pollReported = true
        report('poll ok tts=' + (data.tts || '?'))
      }
      updateChip('● ' + (data.tts || 'edge') + (model ? ' · l2d' : ''), false)
    }).catch(function () {
      pollFailures++
      if (pollFailures >= 3) updateChip('● offline', true)
    })
  }

  function handleCallItem(item) {
    startCall(item)
    report('incoming call: ' + (item.text || '').slice(0, 30))
  }

  window.setInterval(pollTick, 150)
  pollTick()
  if (canvas) {
    canvas.addEventListener('pointerdown', handleCanvasTap)
    canvas.addEventListener('pointermove', handleCanvasTap)
    canvas.addEventListener('pointerup', handleCanvasTap)
    canvas.addEventListener('pointercancel', handleCanvasTap)
    canvas.addEventListener('touchstart', function (ev) { handleCanvasTap(ev) }, { passive: true })
    canvas.addEventListener('touchmove', function (ev) { handleCanvasTap(ev) }, { passive: true })
    canvas.addEventListener('touchend', function (ev) { handleCanvasTap(ev) }, { passive: true })
    canvas.addEventListener('wheel', handleCalibWheel, { passive: false })
    canvas.addEventListener('dblclick', handleCalibDblClick)
  }
  initAvatar()
  loadMemory()
})()
