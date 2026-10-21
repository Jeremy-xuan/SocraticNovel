// test/injector.test.mjs — 注入计划器单测（纯函数，零 LLM 成本）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadManifest } from '../lib/manifest.mjs'
import { isBlockDue, planTurnInjections, renderText, wrapText } from '../lib/injector.mjs'
import { createPhaseStore } from '../lib/phasestore.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(here, 'fixtures', 'minimal-classroom')
const blocks = loadManifest(FIXTURE).blocks

const freshState = (turn = 1, phase = 'boot') => ({
  turnCount: turn,
  phase,
  injectedOnce: new Set(),
})

test('system 块不进 chat 注入计划', () => {
  const due = planTurnInjections(blocks, freshState())
  assert.ok(!due.some((d) => d.id === 'narrative-core'))
})

test('every: turn 的块每回合都注入（anchor + state-brief）', () => {
  const due = planTurnInjections(blocks, freshState(1))
  assert.ok(due.some((d) => d.id === 'anchor'))
  assert.ok(due.some((d) => d.id === 'state-brief'))
})

test('n_turns:3 只在第 3 的倍数回合注入', () => {
  assert.ok(!planTurnInjections(blocks, freshState(1)).some((d) => d.id === 'knowledge-anchor'))
  assert.ok(!planTurnInjections(blocks, freshState(2)).some((d) => d.id === 'knowledge-anchor'))
  assert.ok(planTurnInjections(blocks, freshState(3)).some((d) => d.id === 'knowledge-anchor'))
  assert.ok(planTurnInjections(blocks, freshState(6)).some((d) => d.id === 'knowledge-anchor'))
})

test('phase 门：boot 相位不注入 quiz-rules，quiz 相位注入', () => {
  assert.ok(!planTurnInjections(blocks, freshState(1, 'boot')).some((d) => d.id === 'quiz-rules'))
  assert.ok(planTurnInjections(blocks, freshState(1, 'quiz')).some((d) => d.id === 'quiz-rules'))
})

test('every: once 注入一次后不再注入（injectedOnce 记忆）', () => {
  const once = [{ id: 'o', layer: 'persona', text: 'x', position: { target: 'chat', depth: 0 }, frequency: { every: 'once' }, wrap: { style: 'none' } }]
  const state = freshState(1)
  assert.equal(planTurnInjections(once, state).length, 1)
  assert.equal(planTurnInjections(once, state).length, 0)
  assert.ok(state.injectedOnce.has('o'))
})

test('on_demand 不进自动计划', () => {
  const od = [{ id: 'd', layer: 'context', text: 'x', position: { target: 'chat', depth: 0 }, frequency: { every: 'on_demand' }, wrap: { style: 'none' } }]
  assert.equal(planTurnInjections(od, freshState(1)).length, 0)
})

test('render 变量替换 + 未命中变量保留并记录', () => {
  const r = renderText('相位={{phase}} 未知={{nope}}', { phase: 'quiz' })
  assert.equal(r.text, '相位=quiz 未知={{nope}}')
  assert.deepEqual(r.missing, ['nope'])
})

test('state-brief 的 {{var}} 被真实渲染（render.enabled）', () => {
  const due = planTurnInjections(blocks, freshState(4, 'lecture'), { classroom: 'probe-cs-os' })
  const brief = due.find((d) => d.id === 'state-brief')
  assert.match(brief.text, /相位=lecture/)
  assert.match(brief.text, /第 4 回合/)
  assert.match(brief.text, /教室=probe-cs-os/)
  assert.ok(!brief.text.includes('{{'))
})

test('wrap system-reminder 生效；none 不包装', () => {
  assert.match(wrapText('hi', { style: 'system-reminder' }), /^<system-reminder>\nhi\n<\/system-reminder>$/)
  assert.equal(wrapText('hi', { style: 'none' }), 'hi')
})

// 🔴 断言口径（2026-09-24 起）：**测"锚点原文被注入了没有"，不测教学法内容**。
//    夹具文案只作占位（教学口径已由用户 `e961ef1` 反转，旧铁律不得再出现在任何夹具里），
//    故判据取"注入文本与 `_anchor.md` 盘上原文逐字一致"——文案怎么改都不用动这条断言。
test('注入文本被包进 system-reminder（端到端形态）', () => {
  const due = planTurnInjections(blocks, freshState(1))
  const anchor = due.find((d) => d.id === 'anchor')
  assert.match(anchor.text, /^<system-reminder>/)
  assert.match(anchor.text, /<\/system-reminder>$/)
})

test('纪律块注入的是 _anchor.md 的原文（不加工、不裁剪）', () => {
  const source = readFileSync(join(FIXTURE, '_anchor.md'), 'utf8').trim()
  const due = planTurnInjections(blocks, freshState(1))
  const anchor = due.find((d) => d.id === 'anchor')
  assert.ok(
    anchor.text.includes(source),
    `注入文本应逐字包含 _anchor.md 全文（${source.length} 字符）\n实际注入：${anchor.text}`,
  )
  // 夹具里那句"关键句"必须真的在——防止夹具被改成空壳后断言仍然变绿。
  assert.match(anchor.text, /教学取向由教室内容决定/)
})

// ---- phasestore ----

test('phasestore：回合自计数、相位校验、快照', () => {
  const p = createPhaseStore()
  assert.equal(p.turnCount, 0)
  p.noteTurnStart()
  p.noteTurnStart()
  assert.equal(p.turnCount, 2)
  p.setPhase('quiz')
  assert.equal(p.phase, 'quiz')
  assert.throws(() => p.setPhase('bogus'), /未知相位/)
  assert.deepEqual(p.snapshot(), { phase: 'quiz', turnCount: 2, onceDone: [] })
})

// ══════════════════════════════════════════════════════════════════════════════
// N 接线（2026-10-21）：`isBlockDue` —— 动态块"先取内容、再规划注入"用的只读判定
// 🔴 它与 `planTurnInjections` 必须是**同一套门**：这里逐格比一次，防两边漂移。
// ══════════════════════════════════════════════════════════════════════════════

const mkBlock = (over = {}) => ({
  id: 'b',
  text: 't',
  position: { target: 'chat', depth: 0 },
  frequency: { every: 'turn' },
  phase: null,
  lesson: null,
  wrap: { style: 'system-reminder', role: 'user', tag: 'system-reminder' },
  render: { enabled: false, vars: {} },
  ...over,
})

const gateState = (over = {}) => ({
  turnCount: 1,
  phase: 'boot',
  injectedOnce: new Set(),
  injectedLesson: new Map(),
  currentLesson: null,
  ...over,
})

test('isBlockDue ↔ planTurnInjections：同一套门逐格一致（含相位门、n_turns、once 记账）', () => {
  const cases = [
    { block: mkBlock(), state: gateState() },
    { block: mkBlock({ frequency: { every: 'n_turns', n: 3 } }), state: gateState({ turnCount: 6 }) },
    { block: mkBlock({ frequency: { every: 'n_turns', n: 3 } }), state: gateState({ turnCount: 4 }) },
    { block: mkBlock({ frequency: { every: 'phase' }, phase: { phases: ['quiz'] } }), state: gateState({ phase: 'quiz' }) },
    { block: mkBlock({ frequency: { every: 'phase' }, phase: { phases: ['quiz'] } }), state: gateState({ phase: 'boot' }) },
    { block: mkBlock({ frequency: { every: 'phase' } }), state: gateState({ phase: 'boot' }) },
    { block: mkBlock({ frequency: { every: 'on_demand' } }), state: gateState() },
    { block: mkBlock({ position: { target: 'system', order: 1 } }), state: gateState() },
    { block: mkBlock({ lesson: { current: true, of: 3 } }), state: gateState({ currentLesson: 3 }) },
    { block: mkBlock({ lesson: { current: true, of: 3 } }), state: gateState({ currentLesson: 2 }) },
    { block: mkBlock({ frequency: { every: 'once' } }), state: gateState({ injectedOnce: new Set(['b']) }) },
    { block: mkBlock({ frequency: { every: 'once', anchor: 'lesson_start' } }), state: gateState({ currentLesson: 3 }) },
    { block: mkBlock({ frequency: { every: 'once', anchor: 'lesson_start' } }), state: gateState({ currentLesson: 3, injectedLesson: new Map([['b', 3]]) }) },
    { block: mkBlock({ frequency: { every: 'once', anchor: 'lesson_start' } }), state: gateState({ currentLesson: 3, injectedLesson: new Map([['b', 2]]) }) },
  ]
  for (const { block, state } of cases) {
    const planned = planTurnInjections([block], { ...state, injectedOnce: new Set(state.injectedOnce), injectedLesson: new Map(state.injectedLesson) })
    const due = isBlockDue(block, state)
    assert.equal(due, planned.some((d) => d.id === block.id), JSON.stringify({ block, state }))
  }
})

test('isBlockDue 是只读的：不改 injectedOnce / injectedLesson（记账只归 planTurnInjections）', () => {
  const injectedOnce = new Set()
  const injectedLesson = new Map()
  const state = gateState({ injectedOnce, injectedLesson, currentLesson: 3 })
  assert.equal(isBlockDue(mkBlock({ frequency: { every: 'once' } }), state), true)
  assert.equal(isBlockDue(mkBlock({ frequency: { every: 'once', anchor: 'lesson_start' } }), state), true)
  assert.equal(injectedOnce.size, 0, '判一遍不等于注入过（否则动态块取完内容就把额度吃掉了）')
  assert.equal(injectedLesson.size, 0)

  // 对照：真的规划之后才记账
  planTurnInjections([mkBlock({ frequency: { every: 'once' } })], state)
  assert.equal(injectedOnce.size, 1)
  assert.equal(isBlockDue(mkBlock({ frequency: { every: 'once' } }), state), false)
})

test('isBlockDue：缺讲次值时与计划器**同样**抛错（两份判据不许一边静默）', () => {
  assert.throws(
    () => isBlockDue(mkBlock({ lesson: { current: true, of: 3 } }), gateState({ currentLesson: null })),
    /state\.currentLesson 不是整数/,
  )
  assert.throws(
    () => isBlockDue(mkBlock({ frequency: { every: 'once', anchor: 'lesson_start' } }), gateState({ currentLesson: null })),
    /没有讲次值它就无法判定/,
  )
})

test('isBlockDue：记账表缺席（纯函数独立调用）→ 按空表判真，不就地建表', () => {
  const state = { turnCount: 1, phase: 'boot', currentLesson: 3 }
  const block = mkBlock({ frequency: { every: 'once', anchor: 'lesson_start' } })
  assert.equal(isBlockDue(block, state), true)
  assert.equal(state.injectedLesson, undefined, '不许在只读判定里给调用方塞一张表')
})
