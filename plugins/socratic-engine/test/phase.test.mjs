// test/phase.test.mjs — M3-STATE 单测：① 相位推进（教师工具的核心逻辑）② 每讲一次
//                     （`frequency.anchor: lesson_start`）③ `of` 上界校验
//
// 任务书对应：A（相位推进＝加教师工具，模型自己宣布）／B（每讲一次）／C1（curriculum.map
// 改 anchor）／C2（`of` 上界校验，M2 待确认 C12）。
//
// 🔴 本特性的教训（项目已被"静默不生效"坑过两次）：
//   · 未知相位 → **抛错并列出合法 id**（不回落默认值）；
//   · `anchor: lesson_start` 缺讲次值 → **抛错**（否则换讲后不注入＝静默失效）；
//   · `anchor` 写错值 / 与别的 `every` 连用 → **抛错**（不静默忽略）；
//   · `of: 99` 而教室只有 14 讲 → **抛错**（否则该块永不注入且不报错）。
//
// 运行：/opt/homebrew/bin/node test/phase.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseManifest,
  loadManifest,
  ManifestError,
  readRuntimePhase,
  renderRuntimePhase,
  lessonsDeclaredBy,
  lessonGateUpperBound,
  assertLessonGateWithinBounds,
  phaseDomainOf,
  PHASE_STATE_KEY,
  FREQUENCY_ANCHORS,
} from '../lib/manifest.mjs'
import { createPhaseStore } from '../lib/phasestore.mjs'
import { planTurnInjections } from '../lib/injector.mjs'

const here = dirname(fileURLToPath(import.meta.url))
// 真教室路径：test/ → socratic-engine/ → plugins/ → code/classrooms/cs-os
const CS_OS = join(here, '..', '..', '..', 'classrooms', 'cs-os')

// ── 脚手架 ───────────────────────────────────────────────────────────────────

const dirs = []
async function makeClassroom({ yaml, progress }) {
  const dir = await mkdtemp(join(tmpdir(), 'socratic-phase-'))
  dirs.push(dir)
  await writeFile(join(dir, 'classroom.yaml'), yaml, 'utf8')
  if (progress !== null) {
    await mkdir(join(dir, 'runtime'), { recursive: true })
    await writeFile(join(dir, 'runtime', 'progress.md'), progress ?? '', 'utf8')
  }
  return dir
}
test.after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

const PROGRESS = `# 学习进度

current_lesson: 1

| 项 | 值 |
|---|---|
| 当前讲次 | 第 1 讲 |
`

/** 一份带相位枚举 ＋ 三个相位门块 ＋ 一个 store 的 manifest。 */
const PHASE_YAML = `
format: socratic-classroom/0
classroom: { id: t, lessons: 3 }
runtime_store:
  dir: runtime/
  progress: runtime/progress.md
  lesson_key: current_lesson
phases:
  - { id: open,   name: 开场 }
  - { id: probe,  name: 追问 }
  - { id: check,  name: 对答案 }
  - { id: close,  name: 收尾 }
blocks:
  - id: always
    text: 每回合都在
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
    wrap: { style: none }
  - id: only-open
    text: 只在开场
    position: { target: chat, depth: 0 }
    frequency: { every: phase }
    phase: { phases: [open] }
    wrap: { style: none }
  - id: only-probe
    text: 只在追问
    position: { target: chat, depth: 0 }
    frequency: { every: phase }
    phase: { phases: [probe] }
    wrap: { style: none }
  - id: not-close
    text: 除收尾外
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
    phase: { except: [close] }
    wrap: { style: none }
`

const ids = (due) => due.map((d) => d.id)
const freshState = (phase, extra = {}) => ({
  phase,
  turnCount: 1,
  injectedOnce: new Set(),
  injectedLesson: new Map(),
  ...extra,
})

// ══════════════════════════════════════════════════════════════════════════════
// A · 相位推进（值域校验 ＋ 门控跟着变）
// ══════════════════════════════════════════════════════════════════════════════

test('A1 相位值域来自教室声明；默认相位＝第一个', () => {
  const m = parseManifest(PHASE_YAML)
  assert.deepEqual(phaseDomainOf(m), ['open', 'probe', 'check', 'close'])
  const store = createPhaseStore({ domain: phaseDomainOf(m), initialPhase: 'open' })
  assert.equal(store.phase, 'open')
  assert.deepEqual(store.domain, ['open', 'probe', 'check', 'close'])
})

test('A2 setPhase 合法 → 生效并返回新相位', () => {
  const store = createPhaseStore({ domain: ['open', 'probe'], initialPhase: 'open' })
  assert.equal(store.setPhase('probe'), 'probe')
  assert.equal(store.phase, 'probe')
})

test('🔴 A3 setPhase 未知相位 → 抛错并列出合法 id（不静默、不回落默认值）', () => {
  const store = createPhaseStore({ domain: ['open', 'probe', 'check'], initialPhase: 'open' })
  assert.throws(
    () => store.setPhase('answer'),
    (error) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /未知相位/)
      assert.match(error.message, /"answer"/) // 报出原文
      assert.match(error.message, /open\/probe\/check/) // 列出合法 id
      return true
    },
  )
  assert.equal(store.phase, 'open', '抛错后相位不得被改动')
})

test('A4 setPhase 大小写/空白不宽容（写错就是错，不 trim、不降级）', () => {
  const store = createPhaseStore({ domain: ['open', 'probe'], initialPhase: 'open' })
  assert.throws(() => store.setPhase(' Probe'), /未知相位/)
  assert.throws(() => store.setPhase(''), /未知相位/)
  assert.throws(() => store.setPhase(undefined), /未知相位/)
})

test('A5 domain getter 返回副本（外部改不动内部值域）', () => {
  const store = createPhaseStore({ domain: ['open', 'probe'], initialPhase: 'open' })
  store.domain.push('hacked')
  assert.deepEqual(store.domain, ['open', 'probe'])
  assert.throws(() => store.setPhase('hacked'), /未知相位/)
})

test('A6 回合自计数：noteTurnStart 累加', () => {
  const store = createPhaseStore({ domain: ['open'], initialPhase: 'open' })
  assert.equal(store.turnCount, 0)
  store.noteTurnStart()
  store.noteTurnStart()
  assert.equal(store.turnCount, 2)
})

test('🔴 A7 相位门控：不同相位注入不同块集（门真的按相位裁决）', () => {
  const m = parseManifest(PHASE_YAML)
  const open = ids(planTurnInjections(m.blocks, freshState('open')))
  const probe = ids(planTurnInjections(m.blocks, freshState('probe')))
  const check = ids(planTurnInjections(m.blocks, freshState('check')))
  const close = ids(planTurnInjections(m.blocks, freshState('close')))

  assert.deepEqual(open, ['always', 'only-open', 'not-close'])
  assert.deepEqual(probe, ['always', 'only-probe', 'not-close'])
  assert.deepEqual(check, ['always', 'not-close'])
  assert.deepEqual(close, ['always']) // only-open/only-probe 不在；not-close 被 except 排除
})

test('🔴 A8 相位切换后「下一回合」按新相位重新裁决（同一 state 连续两次 plan）', () => {
  const m = parseManifest(PHASE_YAML)
  const state = freshState('open')
  const before = ids(planTurnInjections(m.blocks, state))
  assert.ok(before.includes('only-open'))
  assert.ok(!before.includes('only-probe'))

  // 教师宣布换相位（＝ classroom_set_phase 做的事）
  state.phase = 'probe'
  state.turnCount = 2
  const after = ids(planTurnInjections(m.blocks, state))
  assert.ok(!after.includes('only-open'), '换到 probe 后开场块必须退出')
  assert.ok(after.includes('only-probe'), '换到 probe 后追问块必须进来')
})

test('A9 相位门与 frequency.phase 叠加：phase 门存在时必须通过', () => {
  const yaml = `
format: socratic-classroom/0
classroom: { id: t }
phases: [{ id: open }, { id: close }]
blocks:
  - id: both
    text: x
    position: { target: chat, depth: 0 }
    frequency: { every: phase }
    phase: { phases: [open] }
`
  const m = parseManifest(yaml)
  assert.deepEqual(ids(planTurnInjections(m.blocks, freshState('open'))), ['both'])
  assert.deepEqual(ids(planTurnInjections(m.blocks, freshState('close'))), [])
})

// ══════════════════════════════════════════════════════════════════════════════
// B · 相位状态的落盘镜像（runtime_store 的 current_phase 行）
// ══════════════════════════════════════════════════════════════════════════════

test('B1 无 runtime_store 声明 → readRuntimePhase 返回 null（不报错）', () => {
  const m = parseManifest(`
format: socratic-classroom/0
classroom: { id: t }
blocks: [{ id: a, text: x, position: { target: chat, depth: 0 }, frequency: { every: turn } }]
`)
  assert.deepEqual(readRuntimePhase(m, { baseDir: '/tmp' }), { phase: null, file: null })
})

test('B2 有 runtime_store 但文件里没有该行 → phase=null（＝用默认相位）', async () => {
  const m = parseManifest(PHASE_YAML)
  const dir = await makeClassroom({ yaml: PHASE_YAML, progress: PROGRESS })
  const got = readRuntimePhase(m, { baseDir: dir })
  assert.equal(got.phase, null)
  assert.equal(got.file, join(dir, 'runtime', 'progress.md'))
})

test('B3 有该行 → 读回相位 id（容错缩进/行内注释/列表前缀）', async () => {
  const m = parseManifest(PHASE_YAML)
  for (const line of [
    'current_phase: probe',
    '  current_phase:   probe  ',
    '- current_phase: probe',
    'current_phase: probe   # 教师宣布的相位',
  ]) {
    const dir = await makeClassroom({ yaml: PHASE_YAML, progress: `${PROGRESS}\n${line}\n` })
    assert.equal(readRuntimePhase(m, { baseDir: dir }).phase, 'probe', line)
  }
})

test('B4 progress 文件不存在 → 抛错（带路径，不静默当"没有该行"）', async () => {
  const m = parseManifest(PHASE_YAML)
  const dir = await makeClassroom({ yaml: PHASE_YAML, progress: null })
  assert.throws(() => readRuntimePhase(m, { baseDir: dir }), /读 runtime_store 的 progress 文件失败/)
})

test('B5 renderRuntimePhase：没有该行 → 插在第一处机器可读行之后', () => {
  const out = renderRuntimePhase(PROGRESS, 'probe')
  const lines = out.split('\n')
  assert.equal(lines[2], 'current_lesson: 1')
  assert.equal(lines[3], `${PHASE_STATE_KEY}: probe`, '紧跟 current_lesson 行插入')
  assert.ok(out.includes('| 当前讲次 | 第 1 讲 |'), '给人看的表格不得被改动')
})

test('B6 renderRuntimePhase：已有该行 → 原地替换，其余行逐字不变', () => {
  const withLine = `${PROGRESS}\ncurrent_phase: open\n`
  const out = renderRuntimePhase(withLine, 'close')
  assert.equal(out.split('\n').filter((l) => l.startsWith(PHASE_STATE_KEY)).length, 1)
  assert.equal(out.match(/current_phase: close/)[0], 'current_phase: close')
  assert.ok(out.includes('current_lesson: 1'))
  // 幂等：再写一次同样的值，内容不变
  assert.equal(renderRuntimePhase(out, 'close'), out)
})

test('🔴 B7 renderRuntimePhase：非法相位 id → 抛错（不许把垃圾写进教室文件）', () => {
  assert.throws(() => renderRuntimePhase(PROGRESS, 'pro be'), /相位 id 非法/)
  assert.throws(() => renderRuntimePhase(PROGRESS, ''), /相位 id 非法/)
  assert.throws(() => renderRuntimePhase(PROGRESS, undefined), /相位 id 非法/)
})

test('B8 写-读往返：render 后 readRuntimePhase 读回同一个值', async () => {
  const m = parseManifest(PHASE_YAML)
  const dir = await makeClassroom({ yaml: PHASE_YAML, progress: PROGRESS })
  const file = join(dir, 'runtime', 'progress.md')
  await writeFile(file, renderRuntimePhase(await readFile(file, 'utf8'), 'check'), 'utf8')
  assert.equal(readRuntimePhase(m, { baseDir: dir }).phase, 'check')
})

// ══════════════════════════════════════════════════════════════════════════════
// C · 每讲一次（frequency.anchor: lesson_start）
// ══════════════════════════════════════════════════════════════════════════════

const lessonYaml = (freq) => `
format: socratic-classroom/0
classroom: { id: t }
phases: [{ id: open }]
blocks:
  - id: map
    text: 课程表
    position: { target: chat, depth: 0 }
    frequency: ${freq}
    wrap: { style: none }
`

test('C1 解析：anchor 值域＝' + FREQUENCY_ANCHORS.join('/'), () => {
  const m = parseManifest(lessonYaml('{ every: once, anchor: lesson_start }'))
  assert.equal(m.blocks[0].frequency.anchor, 'lesson_start')
  const m2 = parseManifest(lessonYaml('{ every: once, anchor: session_start }'))
  assert.equal(m2.blocks[0].frequency.anchor, 'session_start')
  assert.equal(parseManifest(lessonYaml('{ every: once }')).blocks[0].frequency.anchor, undefined)
})

test('🔴 C2 未知 anchor 取值 → 抛错并报出原文（不静默忽略）', () => {
  assert.throws(
    () => parseManifest(lessonYaml('{ every: once, anchor: lesson_end }')),
    (error) => {
      assert.ok(error instanceof ManifestError)
      assert.match(error.message, /anchor 必须是 lesson_start\/session_start/)
      assert.match(error.message, /"lesson_end"/)
      return true
    },
  )
})

test('🔴 C3 anchor 与别的 every 连用 → 抛错', () => {
  for (const freq of ['{ every: turn, anchor: lesson_start }', '{ every: phase, anchor: lesson_start }', '{ every: n_turns, n: 2, anchor: lesson_start }']) {
    assert.throws(() => parseManifest(lessonYaml(freq)), /anchor 只与 every: once 连用/, freq)
  }
})

test('C4 每讲一次：同一讲内多回合只注入一次', () => {
  const m = parseManifest(lessonYaml('{ every: once, anchor: lesson_start }'))
  const state = { phase: 'open', turnCount: 1, currentLesson: 1, injectedOnce: new Set(), injectedLesson: new Map() }
  assert.deepEqual(ids(planTurnInjections(m.blocks, state)), ['map'])
  state.turnCount = 2
  assert.deepEqual(ids(planTurnInjections(m.blocks, state)), [])
  state.turnCount = 3
  assert.deepEqual(ids(planTurnInjections(m.blocks, state)), [])
  assert.deepEqual([...state.injectedLesson.entries()], [['map', 1]])
})

test('🔴 C5 换到下一讲 → 重新注入一次', () => {
  const m = parseManifest(lessonYaml('{ every: once, anchor: lesson_start }'))
  const state = { phase: 'open', turnCount: 1, currentLesson: 1, injectedOnce: new Set(), injectedLesson: new Map() }
  assert.equal(planTurnInjections(m.blocks, state).length, 1)
  state.turnCount = 2
  assert.equal(planTurnInjections(m.blocks, state).length, 0)
  state.currentLesson = 2
  state.turnCount = 3
  assert.equal(planTurnInjections(m.blocks, state).length, 1, '换讲后必须重新注入（否则＝静默失效）')
  state.turnCount = 4
  assert.equal(planTurnInjections(m.blocks, state).length, 0)
})

test('🔴 C6 改回上一讲 → 再次注入（明确行为：判"讲次是否变化"，不判"注入过没有"）', () => {
  const m = parseManifest(lessonYaml('{ every: once, anchor: lesson_start }'))
  const state = { phase: 'open', turnCount: 1, currentLesson: 1, injectedOnce: new Set(), injectedLesson: new Map() }
  assert.equal(planTurnInjections(m.blocks, state).length, 1) // 第 1 讲
  state.currentLesson = 2
  state.turnCount = 2
  assert.equal(planTurnInjections(m.blocks, state).length, 1) // 第 2 讲
  state.currentLesson = 1
  state.turnCount = 3
  assert.equal(planTurnInjections(m.blocks, state).length, 1, '改回第 1 讲＝又一次讲次变化 → 重新注入')
  assert.deepEqual([...state.injectedLesson.entries()], [['map', 1]])
})

test('🔴 C7 lesson_start 缺讲次值 → 抛错（不静默不注入）', () => {
  const m = parseManifest(lessonYaml('{ every: once, anchor: lesson_start }'))
  for (const currentLesson of [undefined, null, '1', 1.5]) {
    assert.throws(
      () => planTurnInjections(m.blocks, { phase: 'open', turnCount: 1, currentLesson, injectedOnce: new Set(), injectedLesson: new Map() }),
      /anchor: lesson_start/,
      String(currentLesson),
    )
  }
})

test('🔴 C8 不命中不记账：相位门挡下时不吃掉本讲的额度', () => {
  const yaml = `
format: socratic-classroom/0
classroom: { id: t }
phases: [{ id: open }, { id: close }]
blocks:
  - id: map
    text: 课程表
    position: { target: chat, depth: 0 }
    frequency: { every: once, anchor: lesson_start }
    phase: { phases: [open] }
`
  const m = parseManifest(yaml)
  const state = { phase: 'close', turnCount: 1, currentLesson: 1, injectedOnce: new Set(), injectedLesson: new Map() }
  assert.deepEqual(ids(planTurnInjections(m.blocks, state)), [], '相位门挡下 → 本回合不注入')
  assert.equal(state.injectedLesson.size, 0, '不得记账')
  state.phase = 'open'
  state.turnCount = 2
  assert.deepEqual(ids(planTurnInjections(m.blocks, state)), ['map'], '相位回来后仍应注入（额度没被吃掉）')
})

test('C9 兼容：不写 anchor 的 once 行为不变（换讲也不重注）', () => {
  const m = parseManifest(lessonYaml('{ every: once }'))
  const state = { phase: 'open', turnCount: 1, currentLesson: 1, injectedOnce: new Set(), injectedLesson: new Map() }
  assert.equal(planTurnInjections(m.blocks, state).length, 1)
  state.currentLesson = 2
  state.turnCount = 2
  assert.equal(planTurnInjections(m.blocks, state).length, 0, 'session 级 once：换讲不重注')
  assert.deepEqual([...state.injectedOnce], ['map'])
  assert.equal(state.injectedLesson.size, 0)
})

test('C10 anchor: session_start 与不写 anchor 等价', () => {
  const m = parseManifest(lessonYaml('{ every: once, anchor: session_start }'))
  const state = { phase: 'open', turnCount: 1, currentLesson: 1, injectedOnce: new Set(), injectedLesson: new Map() }
  assert.equal(planTurnInjections(m.blocks, state).length, 1)
  state.currentLesson = 2
  assert.equal(planTurnInjections(m.blocks, state).length, 0)
  assert.equal(state.injectedLesson.size, 0)
})

// ══════════════════════════════════════════════════════════════════════════════
// D · `of` 上界校验（M2 待确认 C12）
// ══════════════════════════════════════════════════════════════════════════════

const boundedYaml = (gate, lessons = 3) => `
format: socratic-classroom/0
classroom: { id: t, lessons: ${lessons} }
runtime_store:
  dir: runtime/
  progress: runtime/progress.md
  lesson_key: current_lesson
phases: [{ id: open }]
blocks:
  - id: b
    text: x
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
    lesson: ${gate}
`

test('🔴 D1 of 超上界 → 抛错并报出原文（否则该块永不注入且不报错）', () => {
  assert.throws(
    () => parseManifest(boundedYaml('{ current: true, of: 99 }', 14)),
    (error) => {
      assert.ok(error instanceof ManifestError)
      assert.match(error.message, /引用了第 99 讲/)
      assert.match(error.message, /只有 14/)
      assert.match(error.message, /"of":99/)
      return true
    },
  )
})

test('🔴 D2 list / range 超上界 → 抛错（三种形态都校验）', () => {
  assert.throws(() => parseManifest(boundedYaml('{ list: [1, 99] }', 14)), /引用了第 99 讲/)
  assert.throws(() => parseManifest(boundedYaml('{ range: [1, 99] }', 14)), /引用了第 99 讲/)
})

test('D3 界内 → 通过；恰好等于上界 → 通过', () => {
  assert.doesNotThrow(() => parseManifest(boundedYaml('{ current: true, of: 14 }', 14)))
  assert.doesNotThrow(() => parseManifest(boundedYaml('{ list: [1, 14] }', 14)))
  assert.doesNotThrow(() => parseManifest(boundedYaml('{ range: [1, 14] }', 14)))
})

test('D4 教室没有 lessons 声明 → 不做上界校验（无可靠上界就不猜）', () => {
  const noLessons = `
format: socratic-classroom/0
classroom: { id: t }
runtime_store: { dir: runtime/, progress: runtime/progress.md }
phases: [{ id: open }]
blocks:
  - id: b
    text: x
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
    lesson: { current: true, of: 99 }
`
  assert.doesNotThrow(() => parseManifest(noLessons))
})

test('🔴 D5 classroom.lessons 自身非法 → 抛错', () => {
  for (const value of [0, -1, 1.5, '14']) {
    assert.throws(() => parseManifest(boundedYaml('{ current: true, of: 1 }', JSON.stringify(value))), /classroom\.lessons 必须是 >=1 的整数/, String(value))
  }
})

test('D6 纯函数：lessonsDeclaredBy / lessonGateUpperBound / assertLessonGateWithinBounds', () => {
  assert.equal(lessonsDeclaredBy({ id: 't' }), null)
  assert.equal(lessonsDeclaredBy({ id: 't', lessons: 14 }), 14)
  assert.throws(() => lessonsDeclaredBy({ lessons: 0 }), /classroom\.lessons 必须是 >=1 的整数/)

  assert.equal(lessonGateUpperBound(null), 0)
  assert.equal(lessonGateUpperBound({ current: true }), 0)
  assert.equal(lessonGateUpperBound({ current: true, of: 3 }), 3)
  assert.equal(lessonGateUpperBound({ list: [1, 7, 2] }), 7)
  assert.equal(lessonGateUpperBound({ range: [2, 9] }), 9)

  assert.doesNotThrow(() => assertLessonGateWithinBounds({ current: true, of: 14 }, 14, 'w'))
  assert.doesNotThrow(() => assertLessonGateWithinBounds({ current: true, of: 99 }, null, 'w'), 'null 上界＝跳过')
  assert.throws(() => assertLessonGateWithinBounds({ current: true, of: 15 }, 14, 'w'), /引用了第 15 讲/)
})

// ══════════════════════════════════════════════════════════════════════════════
// E · advance_on 已裁定不做 → 写了必须报错
// ══════════════════════════════════════════════════════════════════════════════

test('🔴 E1 phase.advance_on → 抛错（相位推进已改由教师工具宣布，写了会静默不生效）', () => {
  const yaml = `
format: socratic-classroom/0
classroom: { id: t }
phases: [{ id: open }, { id: close }]
blocks:
  - id: b
    text: x
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
    phase: { phases: [open], advance_on: student_says_done }
`
  assert.throws(
    () => parseManifest(yaml),
    (error) => {
      assert.ok(error instanceof ManifestError)
      assert.match(error.message, /advance_on 已不再支持/)
      assert.match(error.message, /classroom_set_phase/)
      return true
    },
  )
})

// ══════════════════════════════════════════════════════════════════════════════
// F · 真实教室 cs-os 回归（钉住本报告 §2／§3 的数字）
// ══════════════════════════════════════════════════════════════════════════════

test('F1 cs-os：47 块 / 6 相位 / lessons=14', () => {
  const m = loadManifest(CS_OS)
  // 34→47 是因为教材 1–14 讲全部落盘后 classroom.yaml 新增 13 条 material.current.*；
  // 本条是快照钉，不是不变量。
  assert.equal(m.blocks.length, 47)
  // 🔴 结构性断言（长期正确的那条）：教材块数 === 教室声明的讲数。
  //   讲数按本文件既有读法取 lessonsDeclaredBy(m.classroom)，不新造机制 → 以后加讲不再假红。
  assert.equal(
    m.blocks.filter((b) => b.id.startsWith('material.current.')).length,
    lessonsDeclaredBy(m.classroom),
    '教材块数必须等于教室声明的讲数',
  )
  assert.deepEqual(phaseDomainOf(m), ['open', 'probe', 'answer', 'check', 'review', 'close'])
  assert.equal(lessonsDeclaredBy(m.classroom), 14)
})

test('🔴 F2 cs-os：curriculum.map 已改成「每讲一次」（once + anchor: lesson_start，无相位门/无讲次门）', () => {
  const m = loadManifest(CS_OS)
  const block = m.blocks.find((b) => b.id === 'curriculum.map')
  assert.ok(block, 'curriculum.map 必须存在')
  assert.equal(block.frequency.every, 'once')
  assert.equal(block.frequency.anchor, 'lesson_start')
  assert.equal(block.phase, null, '已去掉无意义的相位门（见报告 §1）')
  assert.equal(block.lesson, null, '已去掉无意义的讲次门（M2 待确认 C5）')
})

test('🔴 F3 cs-os：相位逐相位注入块集（钉住报告 §1 的对照表）', () => {
  const m = loadManifest(CS_OS)
  const expected = {
    open: ['anchor.rules', 'anchor.lesson_ban', 'story.arc_gate', 'curriculum.map', 'story.node.01', 'state.progress', 'state.mistakes', 'state.review'],
    probe: ['anchor.rules', 'anchor.lesson_ban', 'story.arc_gate', 'curriculum.map', 'material.current.01', 'state.progress'],
    answer: ['anchor.rules', 'anchor.lesson_ban', 'story.arc_gate', 'curriculum.map', 'state.progress'],
    check: ['anchor.rules', 'anchor.lesson_ban', 'story.arc_gate', 'curriculum.map', 'kp.current', 'material.current.01', 'state.progress', 'state.mistakes'],
    review: ['anchor.rules', 'anchor.lesson_ban', 'story.arc_gate', 'curriculum.map', 'state.progress'],
    close: ['anchor.rules', 'anchor.lesson_ban', 'story.arc_gate', 'curriculum.map', 'kp.current', 'state.progress'],
  }
  for (const [phase, want] of Object.entries(expected)) {
    assert.deepEqual(ids(planTurnInjections(m.blocks, freshState(phase, { currentLesson: 1 }))), want, phase)
  }
})

test('🔴 F4 cs-os：curriculum.map 每讲一次（同讲不重注、换讲重注）', () => {
  const m = loadManifest(CS_OS)
  const state = freshState('open', { currentLesson: 1 })
  const has = () => ids(planTurnInjections(m.blocks, state)).includes('curriculum.map')
  assert.equal(has(), true)
  state.turnCount = 2
  assert.equal(has(), false)
  state.currentLesson = 2
  state.turnCount = 3
  assert.equal(has(), true)
})
