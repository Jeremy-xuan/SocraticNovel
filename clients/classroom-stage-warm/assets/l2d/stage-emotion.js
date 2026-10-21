/*!
 * stage-emotion.js —— 表情驱动模块（契约 C2 / K0 / K1.3 / K1.4 / C5）
 *
 * 谁负责什么：
 *   · 舞台（S 车道）负责 K0 的挂载点 window.__SOCRATIC_STAGE__：React / store / app / model /
 *     setExpressionDriver。**本模块不造第二套挂载点**，只按契约读那个对象。
 *   · 本模块负责：情绪事件 → 引擎 → 每帧写模型参数；口型源 → 嘴部参数；
 *     待机层（呼吸/眨眼/视线微动，持续）与情绪自然回落；分层混合。
 *
 * 依赖（可缺）：
 *   · window.SoullinkEmotion —— vendor 在 assets/l2d/vendor/soullink/ 的
 *     @soullink-emotion/engine 浏览器构建（IIFE，只含纯 engine，不含 Planner/TTS/Embedding）。
 *     缺失时本模块**不注册驱动**，舞台退回静态待机（这是 EC 里的"关掉模块"路径）。
 *   · 同目录的 stage-emotion.profile.deepseek.json —— 由 SDK 的 profile-generator 扫描
 *     deepseek.model3.json / deepseek.cdi3.json 生成（20 条抽象参数映射到模型 26 个参数里的面部参数）。
 *
 * 三条纪律（都对应 EC）：
 *   1. 全部包在 IIFE 里；任何异常都 catch + console.warn，**绝不抛进舞台的 render**
 *      （舞台 render 抛错会被 SlotErrorBoundary 永久锁成崩溃占位）。
 *   2. 模型没就绪（model() 返回 null / 参数对象不全）时静默跳过，warn 最多一次，不每帧刷。
 *   3. 不用自己的 rAF/ticker 计时：驱动函数由舞台每帧调用；参数写入挂在
 *      internalModel 的 beforeModelUpdate 上（必须在 motion 写完之后写，否则会被
 *      idle/speak motion 的关键帧覆盖——实测：挂在 app.ticker 上时表情几乎看不出变化）。
 *
 * 用法（舞台侧，S 车道）：
 *   // 1) 加载静态脚本（ensureStageModule，复用 loadOneScript）：
 *   //    ROUTE + '/l2d/stage-emotion.js'
 *   // 2) 在动作/表情 effect 里每帧调用（active 为当前句子情绪，没有就传 null）：
 *   //    driver = window.__SOCRATIC_STAGE__.expressionDriver
 *   //    driver && driver.drive({ active: {label:'shy', intensity:0.6}, dt: 1/60 }, stage)
 *   // 3) 纸带逐字显现时报告字数（口型的唯一输入源，本阶段不接音频）：
 *   //    driver && driver.tapeTyped(n)
 *   // 4) 清理时（props.killed / 组件卸载）：
 *   //    driver && driver.dispose()
 */
;(function (root, factory) {
  'use strict'
  var api = factory()
  if (typeof module === 'object' && module && module.exports) module.exports = api
  if (root) {
    try { root.__SOCRATIC_EMOTION__ = api } catch (e) { /* 全局被锁死也不该阻断加载 */ }
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  'use strict'

  var VERSION = 1

  // ── 常量（每个都对应契约里的一条约束）────────────────────────────────────
  var QUEUE_MAX = 8            // K1.3 第 5 条 / EC：情绪事件队列上限，超了丢最旧的
  var DEFAULT_PROFILE_URL = 'stage-emotion.profile.deepseek.json' // 与本脚本同目录
  var MIN_APPLY_GAP = 0.12     // 秒：队列里两条事件之间至少隔这么久（避免同帧连跳）
  var EMOTION_HOLD = 0.90      // 秒：一条事件把 VAD 压在目标上的最短时长
  var VAD_DECAY = 0.018        // engine 的 VAD 回落到平静的一阶系数（时间常数 ≈ 55 s，C5）
  var LIP_ATTACK = 0.055       // 秒：纸带每显一个字，口型张开的上升时间常数
  var LIP_RELEASE = 0.085      // 秒：不再显字后的闭合时间常数（一句显示完嘴闭上）
  var MOUNT_POLL_MS = 200      // 等 K0 挂载点的轮询间隔
  var MOUNT_POLL_MAX = 150     // 最多等 30 秒（150 × 200ms）
  var WATCHDOG_MS = 1000       // 舞台销毁/重建的看门狗间隔

  /** 五个合法标签 → engine 的情绪名（engine 里"困惑"叫 confused）。 */
  var LABEL_TO_EMOTION = { calm: 'calm', happy: 'happy', shy: 'shy', puzzled: 'confused', excited: 'excited' }

  var warned = {}

  /** 同一类告警只喊一次：模型没就绪时不能每帧刷 console。 */
  function warnOnce (key, err) {
    if (warned[key]) return
    warned[key] = 1
    try { console.warn('[stage-emotion] ' + key + (err ? '：' + String((err && err.message) || err) : '')) } catch (e) {}
  }

  function clamp01 (v) {
    v = Number(v)
    if (!isFinite(v)) return 0
    return v < 0 ? 0 : (v > 1 ? 1 : v)
  }

  function nowSeconds () {
    try {
      if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now() / 1000
    } catch (e) {}
    return Date.now() / 1000
  }

  /**
   * 纸带口型源：**本阶段唯一的源**。它只吃"这一段又显出了几个字"，
   * 把节奏变成口型开合；接口与将来的音频源同形（update/level/form），
   * 换源时不动混合层。
   *
   * @param {{attack?: number, release?: number, perChar?: number, max?: number}} opts
   * @returns {{kind: string, type: function(number): void, update: function(number): void, level: function(): number, form: function(): number}}
   */
  function createTapeLipSource (opts) {
    opts = opts || {}
    var attack = opts.attack > 0 ? opts.attack : LIP_ATTACK
    var release = opts.release > 0 ? opts.release : LIP_RELEASE
    var perChar = opts.perChar > 0 ? opts.perChar : 0.55
    var max = opts.max > 0 ? opts.max : 0.85
    var target = 0
    var level = 0
    return {
      kind: 'tape',
      /** 这一段显出了 n 个字（标点也算——说话时嘴本来就会动一下）。 */
      type: function (n) {
        n = Number(n)
        if (!isFinite(n) || n <= 0) return
        target = Math.min(max, target + n * perChar)
      },
      update: function (dt) {
        dt = dt > 0 ? dt : 0
        // 上升快、回落慢：一个字的"张嘴"比"闭嘴"短，才像说话
        var k = target > level ? 1 - Math.exp(-dt / attack) : 1 - Math.exp(-dt / release)
        level += (target - level) * k
        // 没有新的字进来时，目标自己衰减回 0
        target *= Math.exp(-dt / 0.22)
        if (level < 0.001) level = 0
      },
      level: function () { return clamp01(level) },
      form: function () { return 0 } // 纸带源不提供嘴形变化；音频源将来可以给
    }
  }

  /**
   * 把若干层参数合成一份"要写进模型的值"。
   * 层规则（写死在这里，避免退化成一个大 if 链）：
   *   · 情绪/待机/反应层由 engine 自己在内部混合好，本模块把它们当**基础层**；
   *   · 说话层（口型）只在 ParamMouthOpenY 上**取较大者**——张嘴是叠加语义，不是覆盖；
   *   · 其余参数一律以基础层为准，未知参数不臆造。
   */
  function mixLayers (baseParams, speechLayer, profile) {
    var out = {}
    var ids = (profile && profile.neutralParams) ? Object.keys(profile.neutralParams) : Object.keys(baseParams || {})
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i]
      var v = baseParams && typeof baseParams[id] === 'number' && isFinite(baseParams[id]) ? baseParams[id] : null
      if (v !== null) out[id] = v
    }
    if (speechLayer && typeof speechLayer.mouthOpen === 'number') {
      var base = typeof out.ParamMouthOpenY === 'number' ? out.ParamMouthOpenY : 0
      out.ParamMouthOpenY = Math.max(base, clamp01(speechLayer.mouthOpen))
    }
    if (speechLayer && typeof speechLayer.mouthForm === 'number' && isFinite(speechLayer.mouthForm)) {
      var bf = typeof out.ParamMouthForm === 'number' ? out.ParamMouthForm : 0
      // 说话时的嘴形只做小幅调制，不盖掉表情本身的形状
      out.ParamMouthForm = Math.max(-1, Math.min(1, bf + speechLayer.mouthForm * 0.12))
    }
    return out
  }

  /**
   * 创建驱动实例。
   * @param {object} stage K0 的 window.__SOCRATIC_STAGE__
   * @param {{engine: object, profile: object, now?: function, warn?: function}} opts
   *        engine = window.SoullinkEmotion（缺失则返回 null：不注册、不崩）
   * @returns {object|null}
   */
  function createDriver (stage, opts) {
    opts = opts || {}
    var engine = opts.engine
    var profile = opts.profile
    if (!engine || typeof engine.SoullinkRuntime !== 'function' || !profile) return null

    var runtime
    try {
      runtime = new engine.SoullinkRuntime({ profile: profile })
      runtime.setVADDecayRate(VAD_DECAY) // C5：情绪自然回落，不是硬切
      runtime.setIdleEnabled(true)       // 待机层（呼吸/眨眼/视线微动）持续进行
      runtime.setLipSyncEnabled(false)   // 本阶段不接音频；口型由本模块的说话层负责
    } catch (e) {
      warnOnce('引擎初始化失败', e)
      return null
    }

    var disposed = false
    var queue = []            // [{label, intensity}] FIFO，最多 QUEUE_MAX 条
    var heldTarget = null     // 当前压在 VAD 上的目标（intensity 已折算）
    var holdUntil = 0
    var lastAppliedAt = -1
    var time = 0
    var pending = null        // 已经算好、等 beforeModelUpdate 落盘的参数
    var hookBound = null      // 绑定了 beforeModelUpdate 的那个 model
    var hookFn = null
    var lastModel = null
    var lipSource = null
    var lastDt = 0
    var currentActive = null   // 舞台这一阵子给的 active（同一条句子每帧都会给同一个值）

    function presetOf (label) {
      var emo = LABEL_TO_EMOTION[label] || (engine.emotionVADPresets && engine.emotionVADPresets[label] ? label : null)
      if (!emo) return null
      try { return engine.emotionVADPresets[emo] || null } catch (e) { return null }
    }

    function scaleVAD (v, k) {
      return { valence: v.valence * k, arousal: v.arousal * k, dominance: v.dominance * k }
    }

    /** 把一条情绪事件压进 engine（反应层）。 */
    function applyEmotion (label, intensity) {
      var preset = presetOf(label)
      if (!preset) return false
      var k = clamp01(intensity == null ? 1 : intensity)
      heldTarget = scaleVAD(preset, k)
      holdUntil = time + EMOTION_HOLD
      try {
        runtime.triggerIntent(
          { emotion: LABEL_TO_EMOTION[label] || label, intensity: k, contextTags: [], sourceMessage: label },
          time,
          { vadTarget: heldTarget }
        )
      } catch (e) {
        warnOnce('情绪事件应用失败', e)
        return false
      }
      return true
    }

    /** 当前模型（K0 的 model() 可能返回 null）。 */
    function resolveModel () {
      try {
        var m = stage && typeof stage.model === 'function' ? stage.model() : null
        return m && m.internalModel ? m : null
      } catch (e) { return null }
    }

    /**
     * 参数落盘：优先挂在 beforeModelUpdate（motion 之后），没有这个钩子就当前帧直写。
     * 返回 false 表示"这一帧没地方写"（模型未就绪），调用方静默跳过。
     */
    function writeParams (params) {
      if (!params) return false
      var model = resolveModel()
      if (!model) { warnOnce('模型未就绪，跳过参数写入'); return false }
      var core = model.internalModel.coreModel
      if (!core || typeof core.setParameterValueById !== 'function') { warnOnce('模型参数接口不可用，跳过参数写入'); return false }

      if (hookBound !== model) {
        unbindHook()
        hookBound = model
        try {
          if (typeof model.internalModel.on === 'function') {
            hookFn = function () { flushPendingTo(core) }
            model.internalModel.on('beforeModelUpdate', hookFn)
          }
        } catch (e) { hookFn = null }
      }
      if (hookFn) { pending = params; return true } // 等 motion 写完再落
      return flushPendingTo(core, params)
    }

    function flushPendingTo (core, direct) {
      var params = direct || pending
      if (!params) return false
      if (!direct) pending = null
      for (var id in params) {
        if (!Object.prototype.hasOwnProperty.call(params, id)) continue
        var v = params[id]
        if (typeof v !== 'number' || !isFinite(v)) continue
        try { core.setParameterValueById(id, v) } catch (e) { /* 单个参数不存在不该炸整帧 */ }
      }
      return true
    }

    function unbindHook () {
      if (hookBound && hookFn) {
        try { hookBound.internalModel.off('beforeModelUpdate', hookFn) } catch (e) {}
      }
      hookBound = null
      hookFn = null
      pending = null
    }

    /** 队列：超上限丢最旧的（EC）。 */
    function pushEmotion (label, intensity) {
      if (disposed) return false
      if (!LABEL_TO_EMOTION[label] && !presetOf(label)) return false
      queue.push({ label: label, intensity: clamp01(intensity == null ? 1 : intensity) })
      while (queue.length > QUEUE_MAX) queue.shift()
      return true
    }

    /**
     * 每帧驱动（K0 的固定签名）。
     * @param {{active: ({label: string, intensity: number}|null), dt: number}} frame
     * @param {object} ctx 即 stage 自身（本模块只用它取 model，不另引全局）
     */
    function drive (frame, ctx) {
      if (disposed) return
      try {
        frame = frame || {}
        var dt = Number(frame.dt)
        if (!isFinite(dt) || dt < 0) dt = 1 / 60
        if (dt > 0.25) dt = 0.25 // 掉帧/切后台回来时不要一步跳完，避免"跳脸"
        lastDt = dt
        time += dt

        // 舞台直接给 active（K1.4 的单条路径）。
        // 🔴 舞台**每帧**都会给同一个 active，不能每帧都当新事件入队 —— 否则队列被同一个
        //    事件灌满、每 120ms 重触发一次意图，表情永远停在起手式（实测：参数几乎不动）。
        var a = frame.active
        if (a && a.label) {
          var k = clamp01(a.intensity == null ? 1 : a.intensity)
          if (!currentActive || currentActive.label !== a.label || Math.abs(currentActive.intensity - k) > 0.001) {
            currentActive = { label: a.label, intensity: k }
            pushEmotion(a.label, k)
          } else {
            holdUntil = Math.max(holdUntil, time + EMOTION_HOLD) // 同一句还在说：续住，不重触发
          }
        } else {
          currentActive = null
        }

        // 反应层：队列里最旧的一条（同帧最多吃一条；两条之间留 MIN_APPLY_GAP）
        if (queue.length && (lastAppliedAt < 0 || time - lastAppliedAt >= MIN_APPLY_GAP)) {
          var ev = queue.shift()
          if (applyEmotion(ev.label, ev.intensity)) lastAppliedAt = time
        }

        // 说话层：口型源自己推进（换源只换这个对象）
        if (lipSource && typeof lipSource.update === 'function') {
          try { lipSource.update(dt) } catch (e) { warnOnce('口型源 update 抛错', e) }
        }

        // 待机层 + 情绪层 + 反应层由 engine 内部混合；这里只在 hold 窗口内把 VAD 压住
        if (heldTarget && time < holdUntil) {
          try { runtime.applyVADTarget(heldTarget, 1) } catch (e) {}
        }

        var snap = runtime.update(time, dt)
        var lip = null
        if (lipSource && typeof lipSource.level === 'function') {
          lip = {
            mouthOpen: clamp01(lipSource.level()),
            mouthForm: typeof lipSource.form === 'function' ? Number(lipSource.form()) || 0 : 0
          }
        }
        var params = mixLayers(snap && snap.live2dParams, lip, profile)
        writeParams(params)
      } catch (e) {
        warnOnce('drive 异常（已吞掉，不抛进 render）', e)
      }
    }

    function setLipSource (src) {
      if (src && typeof src.update === 'function' && typeof src.level === 'function') lipSource = src
      else lipSource = null
    }

    /** 纸带每显出 n 个字就报一次（默认源；换了别的源就没有这个快捷方式）。 */
    function tapeTyped (n) {
      if (lipSource && typeof lipSource.type === 'function') {
        try { lipSource.type(n) } catch (e) { warnOnce('口型源 type 抛错', e) }
      }
    }

    /** 关掉模块 = 不写参数、摘钩子；舞台随即回到自己的静态待机。 */
    function dispose () {
      if (disposed) return
      disposed = true
      queue.length = 0
      heldTarget = null
      pending = null
      unbindHook()
      lipSource = null
      try {
        if (stage && typeof stage.setExpressionDriver === 'function') stage.setExpressionDriver(null)
      } catch (e) {}
    }

    return {
      version: VERSION,
      drive: drive,
      pushEmotion: pushEmotion,
      setLipSource: setLipSource,
      tapeTyped: tapeTyped,
      dispose: dispose,
      // 只读诊断面（给单测与现场排查用；不是第二个挂载点，舞台/React/store 一律走 K0）
      _diag: function () {
        return {
          queue: queue.length,
          held: !!heldTarget,
          hooked: !!hookFn,
          modelReady: !!resolveModel(),
          lip: lipSource ? lipSource.kind || 'custom' : null,
          dt: lastDt
        }
      }
    }
  }

  /** 取脚本自身的 URL，用来在同目录取 profile（不依赖舞台的 ROUTE 常量）。 */
  function scriptBase () {
    try {
      if (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) return document.currentScript.src
      var scripts = document.getElementsByTagName('script')
      for (var i = scripts.length - 1; i >= 0; i--) {
        if (scripts[i].src && scripts[i].src.indexOf('stage-emotion.js') !== -1) return scripts[i].src
      }
    } catch (e) {}
    return ''
  }

  function loadProfile (url) {
    try {
      return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null })
    } catch (e) { return Promise.resolve(null) }
  }

  var mounted = null

  /**
   * 等 K0 挂载点出现 → 取 profile → 注册驱动 → 挂看门狗。
   * 任何一步失败都只是 warn，不抛。
   */
  function boot () {
    if (mounted) return mounted
    var tries = 0
    var timer = null
    var dog = null
    var driver = null
    var mountedStage = null

    function stopPolling () { if (timer) { try { clearInterval(timer) } catch (e) {} timer = null } }

    function attach (stage) {
      var engine = null
      try { engine = (typeof window !== 'undefined' ? window.SoullinkEmotion : null) || null } catch (e) {}
      if (!engine) {
        // EC：模块被关掉/加载失败 —— 不注册驱动，舞台保持静态待机，不白屏、不报未捕获异常
        warnOnce('未找到 window.SoullinkEmotion，表情模块不接管（舞台回落静态待机）')
        return
      }
      var base = scriptBase()
      var url = DEFAULT_PROFILE_URL
      try { url = base ? new URL(DEFAULT_PROFILE_URL, base).href : DEFAULT_PROFILE_URL } catch (e) {}
      loadProfile(url).then(function (profile) {
        if (!profile) { warnOnce('profile 读取失败，表情模块不接管', url); return }
        try { profile.modelPath = '' } catch (e) {}
        driver = createDriver(stage, { engine: engine, profile: profile })
        if (!driver) { warnOnce('驱动创建失败，表情模块不接管', url); return }
        driver.setLipSource(createTapeLipSource())
        try { stage.setExpressionDriver(driver) } catch (e) { warnOnce('setExpressionDriver 抛错', e); driver = null; return }
        mounted = driver
        mountedStage = stage
        // 看门狗：舞台销毁/重建（props.killed 依赖）时自己跟着走，不泄漏钩子
        dog = setInterval(function () {
          try {
            var cur = typeof window !== 'undefined' ? window.__SOCRATIC_STAGE__ : null
            if (!cur || cur !== mountedStage) {
              if (driver) driver.dispose()
              driver = null
              mounted = null
              try { clearInterval(dog) } catch (e) {}
              dog = null
            }
          } catch (e) { /* 看门狗自己不许抛 */ }
        }, WATCHDOG_MS)
      }).catch(function (e) { warnOnce('profile 装载异常', e) })
    }

    timer = setInterval(function () {
      tries++
      var stage = null
      try { stage = typeof window !== 'undefined' ? window.__SOCRATIC_STAGE__ : null } catch (e) {}
      if (stage && stage.version === VERSION) {
        stopPolling()
        attach(stage)
        return
      }
      if (tries >= MOUNT_POLL_MAX) {
        stopPolling()
        warnOnce('等不到 window.__SOCRATIC_STAGE__（K0 未实现或舞台未创建），表情模块不接管')
      }
    }, MOUNT_POLL_MS)
    if (typeof timer.unref === 'function') timer.unref()
    return null
  }

  // 脚本一被舞台 loadOneScript 插进来就自己去找挂载点（K0）；找不到只 warn，不抛。
  try {
    if (typeof window !== 'undefined') boot()
  } catch (e) { warnOnce('boot 异常（模块不接管）', e) }

  return {
    version: VERSION,
    queueMax: QUEUE_MAX,
    labels: Object.keys(LABEL_TO_EMOTION),
    createDriver: createDriver,
    createTapeLipSource: createTapeLipSource,
    mixLayers: mixLayers,
    boot: boot,
    mount: boot,
    /** 诊断/兜底入口：舞台侧正常不需要它。 */
    driver: function () { return mounted }
  }
})
