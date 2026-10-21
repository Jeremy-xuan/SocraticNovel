// 20-stage-pure.mjs —— 舞台「纯函数区」单测（K0 挂载点 / K1.3 防御性剥离 / K2.3 板书事件 / 口型源）
//
// 怎么跑（两种都行）：
//   cd clients/classroom-stage-warm && ./check.sh          # 第七组里会跑这个文件
//   node /tmp/_stage-pure.mjs                              # check.sh 抽出来的那份
//
// 为什么要"抽出来跑"：舞台的浏览器半边是一个 `__ModuleLoader__` 闭包，`module.exports`
// 不上 window，Node 里直接 import lib/client.js 会因为没有 `__ModuleLoader__` 而报错。
// check.sh 把 `[STAGE-PURE-BEGIN]…[STAGE-PURE-END]` 之间那段逐字抽到 /tmp 并补上 export，
// 于是同一份源码在这里被真测到（**不是**另写一份实现来测另一份实现）。
import {
  createStageBridge,
  stripEmotionMarkers,
  boardEventOf,
  latestBoardOf,
  createTextCadenceMouth,
  contentTextOf,
  normalizeMermaidSvg,
} from '/tmp/_stage-pure.mjs'

let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('✔ ' + name); return }
  fail += 1
  console.log('✖ ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra)))
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want })
}

// ══════════════════════════════════════════════════════════════════════════
// 一 · K0 挂载点：对象形状
// ══════════════════════════════════════════════════════════════════════════
function makeDeps(extra) {
  const st = { screen: 'live', app: null, model: null, mouth: { kind: 'fake' }, snap: { running: true } }
  return Object.assign({
    _state: st,
    React: { fake: true },
    subscribe: (fn) => { st.sub = fn; return () => { st.sub = null } },
    getSnapshot: () => st.snap,
    getScreen: () => st.screen,
    getApp: () => st.app,
    getModel: () => st.model,
    getMouthSource: () => st.mouth,
  }, extra || {})
}

{
  const deps = makeDeps()
  const b = createStageBridge(deps)
  ok('K0 · version 是数字 1', b.version === 1, b.version)
  ok('K0 · React 是传进来的那一份（不另引）', b.React === deps.React)
  ok('K0 · subscribe 返回 unsubscribe', typeof b.subscribe(() => {}) === 'function')
  ok('K0 · getSnapshot 透传', b.getSnapshot() === deps._state.snap)
  ok('K0 · screen() 报当前屏', b.screen() === 'live')
  ok('K0 · app 是活引用（Live2D 未就绪时为 null）', b.app === null)
  deps._state.app = { fake: 'pixi-app' }
  ok('K0 · app 随 deps 变化（getter 不是快照）', b.app === deps._state.app, b.app)
  ok('K0 · model() 是函数且可为 null', typeof b.model === 'function' && b.model() === null)
  ok('K0 · mouthSource() 交出舞台的口型源', b.mouthSource() === deps._state.mouth)
  ok('K0 · 形状齐全（字段清单逐条）',
    ['version', 'React', 'subscribe', 'getSnapshot', 'screen', 'app', 'model', 'setExpressionDriver', 'driver', 'dispose', 'mouthSource']
      .every((k) => k in b), Object.keys(b))
}

// ══════════════════════════════════════════════════════════════════════════
// 二 · K0 挂载点：setExpressionDriver 的语义
// ══════════════════════════════════════════════════════════════════════════
{
  const b = createStageBridge(makeDeps())
  ok('驱动 · 初始为 null', b.driver() === null)

  const d1 = { drive() {} }
  ok('驱动 · 注册后返回生效对象', b.setExpressionDriver(d1) === d1)
  ok('驱动 · driver() 取得到', b.driver() === d1)

  ok('驱动 · 传 null ＝ 交回静态待机', b.setExpressionDriver(null) === null && b.driver() === null)

  // 没有 drive() 的东西一律当 null（不许把半个对象塞进去，否则帧循环每帧抛错）
  ok('驱动 · 非对象当 null', b.setExpressionDriver(42) === null && b.driver() === null)
  ok('驱动 · 缺 drive() 当 null', b.setExpressionDriver({ dispose() {} }) === null && b.driver() === null)

  // 替换：旧驱动必须被 dispose 掉（否则它挂在 app.ticker 上的回调泄漏）
  let disposed = 0
  const a = { drive() {}, dispose() { disposed += 1 } }
  const c = { drive() {} }
  b.setExpressionDriver(a)
  b.setExpressionDriver(c)
  ok('驱动 · 换驱动时旧的被 dispose 一次', disposed === 1 && b.driver() === c, { disposed })
  b.setExpressionDriver(c)
  ok('驱动 · 同一个对象重复注册不 dispose 自己', disposed === 1, { disposed })

  // 🔴 重入：X 车道的驱动在自己的 dispose() 里会回调 stage.setExpressionDriver(null)。
  //    若实现是"先 dispose 再落值"，这次回调看到的 prev 还是旧驱动 → 再 dispose → 无限递归。
  {
    const b3 = createStageBridge(makeDeps())
    let disposes = 0
    const d = {
      drive() {},
      dispose() {
        disposes += 1
        if (disposes > 5) throw new Error('dispose 重入没收敛')
        b3.setExpressionDriver(null)      // 模拟 "在 dispose 里回调"
      },
    }
    b3.setExpressionDriver(d)
    b3.setExpressionDriver(null)
    ok('驱动 · dispose 里回调 setExpressionDriver(null) 不递归', disposes === 1 && b3.driver() === null, { disposes })
    ok('驱动 · 重入后没有残留驱动', b3.driver() === null)
  }

  // 变化回调（舞台靠它决定表情层归属：有驱动就不设静态表情）
  const seen = []
  const b2 = createStageBridge(makeDeps({ onDriverChange: (n) => seen.push(n ? 'on' : 'off') }))
  b2.setExpressionDriver({ drive() {} })
  b2.setExpressionDriver(null)
  eq('驱动 · onDriverChange 收到 on/off', seen, ['on', 'off'])
}

// ══════════════════════════════════════════════════════════════════════════
// 三 · K0 挂载点：dispose 顺序（契约 K0 纪律 4）
// ══════════════════════════════════════════════════════════════════════════
{
  const g = {}                       // 假 globalThis：不污染真全局
  const deps = makeDeps({ global: g })
  const b = createStageBridge(deps)
  const order = []
  g.__SOCRATIC_STAGE__ = b
  const drv = {
    drive() {},
    dispose() {
      // 关键判据：dispose 的**那一刻**，全局键还在（= 先 dispose，后摘全局）
      order.push('driver.dispose:' + (g.__SOCRATIC_STAGE__ === b ? 'global-still-there' : 'global-gone'))
    },
  }
  b.setExpressionDriver(drv)
  b.dispose()
  order.push('after-dispose:' + (g.__SOCRATIC_STAGE__ === undefined ? 'global-gone' : 'global-still-there'))
  eq('dispose · 顺序 = 先 driver.dispose() 再摘全局', order, [
    'driver.dispose:global-still-there',
    'after-dispose:global-gone',
  ])
  ok('dispose · 幂等（再调一次不炸）', (() => { try { b.dispose(); return true } catch { return false } })())

  // 驱动自己 dispose 抛错：不许把摘全局这一步拖住
  const g2 = {}
  const b2 = createStageBridge(makeDeps({ global: g2 }))
  g2.__SOCRATIC_STAGE__ = b2
  b2.setExpressionDriver({ drive() {}, dispose() { throw new Error('boom') } })
  b2.dispose()
  ok('dispose · 驱动 dispose 抛错不阻断销毁', g2.__SOCRATIC_STAGE__ === undefined)

  // 不是自己的键：不许删别人挂的
  const g3 = {}
  const b3 = createStageBridge(makeDeps({ global: g3 }))
  const someoneElse = { version: 99 }
  g3.__SOCRATIC_STAGE__ = someoneElse
  b3.dispose()
  ok('dispose · 不删除别人的同名全局', g3.__SOCRATIC_STAGE__ === someoneElse)
}

// ══════════════════════════════════════════════════════════════════════════
// 四 · K1.3 防御性剥离
// ══════════════════════════════════════════════════════════════════════════
{
  const r1 = stripEmotionMarkers('进程有三态。〔emo:shy:0.60〕', { final: true })
  ok('剥离 · 合法标记被剥掉', r1.text === '进程有三态。', r1.text)
  eq('剥离 · 合法标记发一条事件', r1.events, [{ label: 'shy', intensity: 0.6 }])

  const r2 = stripEmotionMarkers('甲〔emo:angry:0.50〕乙', { final: true })
  ok('剥离 · 非法标签也剥掉、不发事件', r2.text === '甲乙' && r2.events.length === 0, r2)

  const r3 = stripEmotionMarkers('甲〔emo:shy:0.6〕乙', { final: true })
  ok('剥离 · 缺两位小数也算非法（0.6 非法）', r3.text === '甲乙' && r3.events.length === 0, r3)

  const r4 = stripEmotionMarkers('甲〔emo:shy:1.60〕乙', { final: true })
  ok('剥离 · 强度越界也剥掉', r4.text === '甲乙' && r4.events.length === 0, r4)

  // 半截标记：流式中间态先不下传；flush 时原样交回（宁可显示半截，不吞正文）
  const r5 = stripEmotionMarkers('甲〔emo:sh', { final: false })
  ok('剥离 · 半截标记中间态不下传', r5.text === '甲' && r5.events.length === 0, r5)
  const r6 = stripEmotionMarkers('甲〔emo:sh', { final: true })
  ok('剥离 · flush 时半截原样交回', r6.text === '甲〔emo:sh', r6.text)

  // 一句一个：同一句里第二个剥掉但不发事件
  const r7 = stripEmotionMarkers('甲〔emo:shy:0.60〕〔emo:happy:0.90〕', { final: true })
  ok('剥离 · 一句多个只认第一个', r7.text === '甲' && r7.events.length === 1 && r7.events[0].label === 'shy', r7)
  const r8 = stripEmotionMarkers('甲〔emo:shy:0.60〕。乙〔emo:happy:0.90〕', { final: true })
  ok('剥离 · 换句后各认一个', r8.events.length === 2, r8.events)

  // 非 emo 的全角括号必须原样保留（防御性剥离不许顺手吃正文）
  const r9 = stripEmotionMarkers('我把〔阻塞队列〕画在板上。', { final: true })
  ok('剥离 · 非标记的〔〕原样保留', r9.text === '我把〔阻塞队列〕画在板上。', r9.text)
  const r10 = stripEmotionMarkers('看这个〔', { final: true })
  ok('剥离 · 孤立〔原样保留', r10.text === '看这个〔', r10.text)

  // 任意切分方式拼接 = 一次性喂入（K1.3 判据 5 的舞台侧近似：每帧重新剥整段）
  const full = '第一句。〔emo:calm:0.20〕第二句〔emo:puzzled:0.55〕。'
  const once = stripEmotionMarkers(full, { final: true }).text
  let acc = ''
  let same = true
  for (let i = 1; i <= full.length; i++) {
    const part = stripEmotionMarkers(full.slice(0, i), { final: i === full.length }).text
    if (i === full.length) same = same && part === once
    acc = part
  }
  ok('剥离 · 逐字推进与一次性结果一致', same && acc === once, { acc, once })
}

// ══════════════════════════════════════════════════════════════════════════
// 五 · K2.3 板书事件识别
// ══════════════════════════════════════════════════════════════════════════
{
  const node = (kind, name, extra) => ({ kind: 'x', data: { root: Object.assign({ kind, name }, extra || {}) } })

  eq('板书 · 非 tool-result 不算',
    boardEventOf(node('tool-call', 'classroom_draw', {})), null)
  eq('板书 · 别的工具不算',
    boardEventOf(node('tool-result', 'classroom_note', {})), null)
  eq('板书 · isError 不算',
    boardEventOf(node('tool-result', 'classroom_draw', { isError: true })), null)

  const withMeta = boardEventOf(node('tool-result', 'classroom_draw', {
    meta: { board: { id: 'L03-T05-20261020-231500-flowchart', lesson: 3, turn: 5, kind: 'flowchart' } },
    content: [{ type: 'text', text: '画好了' }],
  }))
  ok('板书 · 优先读 meta.board.id', withMeta && withMeta.from === 'meta', withMeta)
  eq('板书 · meta 的四个字段都取到', [withMeta.id, withMeta.lesson, withMeta.turn, withMeta.kind],
    ['L03-T05-20261020-231500-flowchart', 3, 5, 'flowchart'])

  const withText = boardEventOf(node('tool-result', 'classroom_draw', {
    content: [{ type: 'text', text: '已在白板上画出：三步的状态机。\n[board] id=L07-T02-20261021-010203-state lesson=7 turn=2 kind=stateDiagram-v2' }],
  }))
  ok('板书 · 退化到文本里的 [board] 行', withText && withText.from === 'text', withText)
  eq('板书 · 文本行的 id/lesson/turn/kind', [withText.id, withText.lesson, withText.turn, withText.kind],
    ['L07-T02-20261021-010203-state', 7, 2, 'stateDiagram-v2'])

  const none = boardEventOf(node('tool-result', 'classroom_draw', { content: [{ type: 'text', text: '画好了' }] }))
  ok('板书 · 两个来源都没有 → id 为 null（调用方不切屏）', none && none.id === null, none)

  ok('板书 · contentTextOf 处理字符串', contentTextOf('abc') === 'abc')
  eq('板书 · contentTextOf 拼接 parts', contentTextOf([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb')

  const msgs = [
    { role: 'teacher', text: 'x' },
    { role: 'board', board: { id: 'A' } },
    { role: 'you', text: 'y' },
    { role: 'board', board: { id: 'B' } },
  ]
  ok('板书 · latestBoardOf 取最后一张', latestBoardOf(msgs).id === 'B')
  ok('板书 · latestBoardOf 空列表为 null', latestBoardOf([]) === null)
}

// ══════════════════════════════════════════════════════════════════════════
// 六 · 口型源（纸带逐字显现的节奏）
// ══════════════════════════════════════════════════════════════════════════
{
  const m = createTextCadenceMouth({ charsPerSecond: 10, syllablesPerSecond: 5 })
  ok('口型 · 有具体实现（kind 可替换）', m.kind === 'text-cadence' && typeof m.note === 'string')
  eq('口型 · 空文本时嘴闭合', m.current().open, 0)

  m.feed('一二三四五六七八九十', false)
  m.advance(250)   // 10 字/秒 × 0.25s = 2.5 字
  const mid = m.current()
  ok('口型 · 有字要出时嘴在动', mid.speaking === true && mid.open > 0, mid)
  ok('口型 · 推进量按字数速率算', mid.revealed === 2, mid)

  // 时间推进到把字"显现"完 → 闭嘴
  for (let i = 0; i < 20; i++) m.advance(100)
  m.feed('一二三四五六七八九十', true)
  m.advance(16)
  const done = m.current()
  ok('口型 · 一句显示完嘴闭上', done.open === 0 && done.speaking === false, done)

  // 掉帧/切后台时单帧最多推进 250ms（不会一帧跳完整句）
  const m2 = createTextCadenceMouth({ charsPerSecond: 10 })
  m2.feed('字'.repeat(100), false)
  m2.advance(10000)
  ok('口型 · 单帧推进有上限（不跳帧）', m2.current().revealed <= 3, m2.current())

  // 换句：已显现进度不许倒退超过新文本长度
  const m3 = createTextCadenceMouth({ charsPerSecond: 10 })
  m3.feed('十个字十个字十个字', false)
  for (let i = 0; i < 40; i++) m3.advance(100)
  m3.feed('短', false)
  ok('口型 · 换句后进度不越界', m3.current().revealed <= 1, m3.current())

  m3.reset()
  ok('口型 · reset 归零', m3.current().open === 0 && m3.current().total === 0)
}

// ══════════════════════════════════════════════════════════════════════════
// 七 · mermaid svg 归一化（板书屏"铺满且不变形"的判据）
// ══════════════════════════════════════════════════════════════════════════
{
  const raw = '<svg id="m1" width="100%" xmlns="http://www.w3.org/2000/svg" class="flowchart" style="max-width: 343px;" viewBox="0 0 343 454" role="graphics-document"><g><rect width="10" height="10"/></g></svg>'
  const n = normalizeMermaidSvg(raw)
  ok('svg · 去掉内联 max-width', n.indexOf('max-width') === -1, n.slice(0, 120))
  ok('svg · 去掉 width/height 属性（尺寸交给画布 CSS）',
    !/<svg[^>]*\swidth=/i.test(n) && !/<svg[^>]*\sheight=/i.test(n), n.slice(0, 120))
  ok('svg · 补上 preserveAspectRatio=meet（不裁不变形）', /preserveAspectRatio="xMidYMid meet"/.test(n))
  ok('svg · viewBox 保留（相对布局的根）', /viewBox="0 0 343 454"/.test(n))
  ok('svg · 正文里的 width/height 不被误删（只动开标签）',
    n.indexOf('<rect width="10" height="10"/>') !== -1, n)
  ok('svg · 没有 <svg 的原样返回', normalizeMermaidSvg('not-a-svg') === 'not-a-svg')
  ok('svg · null/undefined 不炸', normalizeMermaidSvg(null) === '' && normalizeMermaidSvg(undefined) === '')
  // 已有的 preserveAspectRatio 要被换成 meet（不能留两个属性）
  const n2 = normalizeMermaidSvg('<svg preserveAspectRatio="none" viewBox="0 0 10 10"></svg>')
  ok('svg · 旧的 preserveAspectRatio 被替换且只剩一个',
    (n2.match(/preserveAspectRatio/g) || []).length === 1 && /meet/.test(n2), n2)
}

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
