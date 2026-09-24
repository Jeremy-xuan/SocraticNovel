// test/injector.test.mjs — 注入计划器单测（纯函数，零 LLM 成本）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadManifest } from '../lib/manifest.mjs'
import { planTurnInjections, renderText, wrapText } from '../lib/injector.mjs'
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

test('注入文本被包进 system-reminder（端到端形态）', () => {
  const due = planTurnInjections(blocks, freshState(1))
  const anchor = due.find((d) => d.id === 'anchor')
  assert.match(anchor.text, /^<system-reminder>/)
  assert.match(anchor.text, /最后一英里/)
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
