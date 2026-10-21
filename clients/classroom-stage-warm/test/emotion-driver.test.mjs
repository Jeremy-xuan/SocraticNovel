// emotion-driver.test.mjs —— 表情驱动模块（C2 / K0 / C5）的单测
//
// 这里不用真引擎、不用真舞台：用两个替身把「契约边界」测死。
//   · engine 替身：记录被调了什么（VAD 目标 / 情绪 / 衰减系数），并按 profile 输出参数；
//   · stage 替身：实现 K0 里本模块真正用到的那几个方法（model() / setExpressionDriver()），
//     外加一个假的 internalModel（on/off + coreModel.setParameterValueById）。
// 真引擎 + 真模型的活体验证在 docs/历史报告/实现报告_X_表情驱动_2026-10-20.md 里。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = new URL('.', import.meta.url)
await import('../assets/l2d/stage-emotion.js')
const api = globalThis.__SOCRATIC_EMOTION__
const SOURCE = readFileSync(fileURLToPath(new URL('../assets/l2d/stage-emotion.js', HERE)), 'utf8')
const PROFILE = JSON.parse(readFileSync(fileURLToPath(new URL('../assets/l2d/stage-emotion.profile.deepseek.json', HERE)), 'utf8'))

// ── 替身 ────────────────────────────────────────────────────────────────
function makeEngine () {
  const calls = { triggerIntent: [], vadTarget: [], decay: null, idle: null, lipSync: null }
  class SoullinkRuntime {
    constructor (opts) { this.profile = opts.profile; this.params = {} }
    setVADDecayRate (r) { calls.decay = r }
    setIdleEnabled (v) { calls.idle = v }
    setLipSyncEnabled (v) { calls.lipSync = v }
    triggerIntent (intent, time) { calls.triggerIntent.push({ intent, time }); this.params.ParamBrowLY = 0.4 }
    applyVADTarget (v) { calls.vadTarget.push(v) }
    update () { return { live2dParams: Object.assign({}, this.params) } }
  }
  return {
    SoullinkRuntime,
    emotionVADPresets: {
      calm: { valence: 0.25, arousal: -0.45, dominance: 0.2 },
      happy: { valence: 0.75, arousal: 0.45, dominance: 0.35 },
      shy: { valence: 0.35, arousal: 0.6, dominance: -0.45 },
      confused: { valence: -0.1, arousal: 0.35, dominance: -0.3 },
      excited: { valence: 0.85, arousal: 0.85, dominance: 0.45 }
    },
    calls
  }
}

function makeStage (opts) {
  opts = opts || {}
  const written = []
  const listeners = new Map()
  const stage = {
    version: 1,
    drivers: [],
    setExpressionDriver (d) { stage.drivers.push(d) },
    model () { return opts.noModel ? null : model }
  }
  const model = {
    internalModel: {
      on (ev, fn) { listeners.set(ev, fn) },
      off (ev, fn) { if (listeners.get(ev) === fn) listeners.delete(ev) },
      coreModel: {
        setParameterValueById (id, v) { written.push([id, v]) }
      }
    }
  }
  return {
    stage,
    written,
    listeners,
    /** 模拟 PIXI 的每帧顺序：motion 先写，再触发 beforeModelUpdate。 */
    frame () { const fn = listeners.get('beforeModelUpdate'); if (fn) fn() }
  }
}

const frame = (active, dt) => ({ active: active || null, dt: dt == null ? 1 / 60 : dt })

// ── 用例 ────────────────────────────────────────────────────────────────
test('EC：引擎缺失（模块被关掉）→ 不创建驱动、不抛', () => {
  const h = makeStage()
  assert.equal(api.createDriver(h.stage, { engine: null, profile: PROFILE }), null)
  assert.equal(api.createDriver(h.stage, { engine: { SoullinkRuntime: null }, profile: PROFILE }), null)
  assert.equal(h.stage.drivers.length, 0, '引擎缺失时不该注册驱动')
})

test('EC：profile 缺失 → 同样不创建驱动', () => {
  const h = makeStage()
  assert.equal(api.createDriver(h.stage, { engine: makeEngine(), profile: null }), null)
})

test('待机层始终开着，音频口型关掉，衰减系数用 C5 的一阶常数', () => {
  const eng = makeEngine()
  const h = makeStage()
  api.createDriver(h.stage, { engine: eng, profile: PROFILE })
  assert.equal(eng.calls.idle, true, '待机层必须开')
  assert.equal(eng.calls.lipSync, false, '本阶段不接音频')
  assert.equal(eng.calls.decay, 0.018, '情绪回落的衰减系数')
})

test('参数在 beforeModelUpdate 里落盘（motion 之后写，才不会被关键帧覆盖）', () => {
  const eng = makeEngine()
  const h = makeStage()
  const d = api.createDriver(h.stage, { engine: eng, profile: PROFILE })
  d.drive(frame({ label: 'happy', intensity: 1 }), h.stage)
  assert.equal(h.written.length, 0, 'hook 模式下 drive() 自己不该直写')
  h.frame()
  const ids = h.written.map((x) => x[0])
  assert.ok(ids.includes('ParamBrowLY'), '逐帧把引擎产出的参数写进模型')
  // 只写引擎真的产出的参数：不臆造引擎没给的键（否则会把别人的层归零）
  const allowed = new Set(Object.keys(PROFILE.neutralParams))
  for (const id of ids) assert.ok(allowed.has(id), '写入了 profile 之外的参数：' + id)
})

test('EC：模型未就绪 → 静默跳过，只 warn 一次，不抛', () => {
  const eng = makeEngine()
  const h = makeStage({ noModel: true })
  const d = api.createDriver(h.stage, { engine: eng, profile: PROFILE })
  const orig = console.warn
  const warns = []
  console.warn = (m) => warns.push(String(m))
  try {
    for (let i = 0; i < 60; i++) d.drive(frame({ label: 'shy', intensity: 0.6 }), h.stage)
  } finally { console.warn = orig }
  assert.equal(h.written.length, 0)
  assert.equal(warns.length, 1, '同一类告警只能喊一次：' + JSON.stringify(warns))
  assert.match(warns[0], /模型未就绪/)
})

test('EC：队列上限 8 条，超出丢最旧的', () => {
  const eng = makeEngine()
  const h = makeStage()
  const d = api.createDriver(h.stage, { engine: eng, profile: PROFILE })
  const labels = ['calm', 'happy', 'shy', 'puzzled', 'excited']
  for (let i = 0; i < 20; i++) d.pushEmotion(labels[i % labels.length], 0.5)
  assert.equal(d._diag().queue, 8)
  // 被保留下来的应该是最新 8 条：第一次出队的是第 13 条
  d.drive(frame(), h.stage)
  assert.equal(eng.calls.triggerIntent.length, 1)
  // 20 条依次是 calm/happy/shy/puzzled/excited…；保留最新 8 条 = 第 13..20 条，
  // 第 13 条的下标是 12 → 12 % 5 = 2 → 'shy'（困惑在内存里映射成 confused，这里还没轮到）
  assert.equal(eng.calls.triggerIntent[0].intent.emotion, 'shy')
})

test('五个标签全部映射到引擎情绪名（困惑 = confused）', () => {
  const eng = makeEngine()
  const h = makeStage()
  const d = api.createDriver(h.stage, { engine: eng, profile: PROFILE })
  d.pushEmotion('puzzled', 0.8)
  d.drive(frame(), h.stage)
  assert.equal(eng.calls.triggerIntent[0].intent.emotion, 'confused')
  const seen = []
  for (const label of ['calm', 'happy', 'shy', 'excited']) {
    const d2 = api.createDriver(h.stage, { engine: makeEngine(), profile: PROFILE })
    const eng2 = d2._diag
    void eng2
    d2.pushEmotion(label, 1)
    d2.drive(frame(), h.stage)
    seen.push(label)
  }
  assert.deepEqual(seen, ['calm', 'happy', 'shy', 'excited'])
})

test('反应层：每条事件之间留最小间隔，不会同帧连跳', () => {
  const eng = makeEngine()
  const h = makeStage()
  const d = api.createDriver(h.stage, { engine: eng, profile: PROFILE })
  d.pushEmotion('happy', 1)
  d.pushEmotion('shy', 1)
  d.drive(frame(null, 1 / 60), h.stage)
  assert.equal(eng.calls.triggerIntent.length, 1)
  d.drive(frame(null, 1 / 60), h.stage) // 间隔不足，仍只 1 条
  assert.equal(eng.calls.triggerIntent.length, 1)
  d.drive(frame(null, 0.2), h.stage)    // 过了 MIN_APPLY_GAP
  assert.equal(eng.calls.triggerIntent.length, 2)
})

test('intensity 折算进 VAD 目标（0.5 → 轴值减半）', () => {
  const eng = makeEngine()
  const h = makeStage()
  const d = api.createDriver(h.stage, { engine: eng, profile: PROFILE })
  d.drive(frame({ label: 'happy', intensity: 0.5 }, 1 / 60), h.stage)
  const v = eng.calls.triggerIntent[0].intent
  assert.equal(v.intensity, 0.5)
  const target = eng.calls.vadTarget[0]
  assert.equal(Math.round(target.valence * 100) / 100, 0.38) // 0.75 × 0.5
})

test('hold 窗口内持续压住 VAD，窗口外不再压（自然回落）', () => {
  const eng = makeEngine()
  const h = makeStage()
  const d = api.createDriver(h.stage, { engine: eng, profile: PROFILE })
  d.drive(frame({ label: 'happy', intensity: 1 }, 1 / 60), h.stage)
  const afterFirst = eng.calls.vadTarget.length
  d.drive(frame(null, 0.2), h.stage)
  assert.ok(eng.calls.vadTarget.length > afterFirst, 'hold 窗口内每帧都压')
  const mid = eng.calls.vadTarget.length
  // dt 被夹在 0.25（切后台回来不跳脸），所以要分几步才走完 EMOTION_HOLD=0.9s
  for (let i = 0; i < 6; i++) d.drive(frame(null, 0.25), h.stage)
  const afterHold = eng.calls.vadTarget.length
  assert.ok(afterHold >= mid, 'hold 窗口内每步都压')
  for (let i = 0; i < 3; i++) d.drive(frame(null, 0.25), h.stage)
  assert.equal(eng.calls.vadTarget.length, afterHold, 'hold 结束后不再压，交给 engine 衰减')
})

test('说话层：纸带显出字 → 张嘴；停止后回落闭合（一句显示完嘴闭上）', () => {
  const eng = makeEngine()
  const h = makeStage()
  const d = api.createDriver(h.stage, { engine: eng, profile: PROFILE })
  d.setLipSource(api.createTapeLipSource())
  d.tapeTyped(3)
  d.drive(frame(null, 0.05), h.stage)
  h.frame()
  const open = () => h.written.filter((x) => x[0] === 'ParamMouthOpenY').map((x) => x[1]).pop() || 0
  const peak = open()
  assert.ok(peak > 0.05, '显字后嘴要张开，实际 ' + peak)
  for (let i = 0; i < 120; i++) { d.drive(frame(null, 0.05), h.stage); h.frame() }
  const rest = open()
  assert.ok(rest < peak / 3, '停止显字后嘴要闭回去：peak=' + peak + ' rest=' + rest)
})

test('说话层与表情混合：张嘴取较大者，不覆盖表情的嘴形', () => {
  const base = { ParamMouthOpenY: 0.2, ParamMouthForm: 0.5 }
  const mixed = api.mixLayers(base, { mouthOpen: 0.7, mouthForm: 1 }, PROFILE)
  assert.equal(mixed.ParamMouthOpenY, 0.7)
  assert.ok(mixed.ParamMouthForm > 0.5 && mixed.ParamMouthForm <= 1)
  const mixed2 = api.mixLayers(base, { mouthOpen: 0.1, mouthForm: 0 }, PROFILE)
  assert.equal(mixed2.ParamMouthOpenY, 0.2, '口型小的时候不该把表情的嘴压小')
})

test('drive 内部异常被吞掉：不抛给舞台 render', () => {
  const eng = makeEngine()
  const h = makeStage()
  const d = api.createDriver(h.stage, { engine: eng, profile: PROFILE })
  eng.SoullinkRuntime.prototype.update = () => { throw new Error('engine boom') }
  const orig = console.warn
  console.warn = () => {}
  try {
    assert.doesNotThrow(() => { d.drive(frame({ label: 'happy', intensity: 1 }), h.stage); h.frame() })
  } finally { console.warn = orig }
})

test('dispose：摘掉钩子、清队列、通知舞台交还表情层、之后不再写参数', () => {
  const eng = makeEngine()
  const h = makeStage()
  const d = api.createDriver(h.stage, { engine: eng, profile: PROFILE })
  d.pushEmotion('happy', 1)
  d.drive(frame(), h.stage)
  assert.equal(h.listeners.size, 1)
  assert.equal(d._diag().queue, 0)
  d.dispose()
  assert.equal(h.listeners.size, 0, 'beforeModelUpdate 钩子必须摘掉')
  assert.equal(h.stage.drivers.pop(), null, 'dispose 要把 setExpressionDriver(null) 交回去')
  const before = h.written.length
  d.drive(frame({ label: 'shy', intensity: 1 }), h.stage)
  h.frame()
  assert.equal(h.written.length, before, 'dispose 后不再写参数')
})

test('活动事件与队列并存：active 优先入队，队列不会无限增长（连发保护）', () => {
  const eng = makeEngine()
  const h = makeStage()
  const d = api.createDriver(h.stage, { engine: eng, profile: PROFILE })
  for (let i = 0; i < 50; i++) d.drive(frame({ label: 'happy', intensity: 0.4 }), h.stage)
  assert.ok(d._diag().queue <= 8, 'queue=' + d._diag().queue)
})

test('模块是 IIFE 且自带诊断全局：没有 import / 不碰 store', () => {
  assert.equal(/^\s*import\s/m.test(SOURCE), false)
  assert.equal(/^\s*export\s/m.test(SOURCE), false)
  assert.ok(api && typeof api.createDriver === 'function')
  assert.ok(SOURCE.includes('window.__SOCRATIC_STAGE__'), '必须按 K0 读挂载点')
  assert.equal(/__SOCRATIC_STAGE__\s*=/.test(SOURCE), false, '不许自己写挂载点（那是 S 车道的）')
})
