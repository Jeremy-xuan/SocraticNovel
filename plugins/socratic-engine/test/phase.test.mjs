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
// 🔴 FREQ-PARITY（2026-09-24）补一条同族教训 —— **"两处必须同改"要有人管**：
//   教室 `classroom.yaml` 改了一个块的**频率语义**（`anchor.check`：`n_turns:5` → 相位门
//   `every: phase` ＋ `except: [open]`），而引擎侧 F3 的期望块集还是旧语义 → 测试变红，
//   但红的信息只有"某相位的块集不对"，**没人知道红的是哪两处**（另一条线做了一组对照实验才定位）。
//   处置：F3 的期望值改成**从教室声明推导**（教室改语义 → 这里自动跟上），并新增 **F3b 签署表**
//   ——教室语义一变就响亮报错，说清"哪一处改了、另一处没动"。两份判据的分工写在 F3 的注释里。
//
// 运行：/opt/homebrew/bin/node test/phase.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
// 真教室路径：test/ → socratic-engine/ → plugins/ → classrooms/cs-os
const CS_OS = join(here, '..', '..', '..', 'classrooms', 'cs-os')
/** 教室的 yaml 本体（F3b 要读它取行号与 sha256，用来把"两处"指到具体位置）。 */
const CLASSROOM_YAML = join(CS_OS, 'classroom.yaml')

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

test('F1 cs-os：49 块 / 6 相位 / lessons=14', () => {
  const m = loadManifest(CS_OS)
  // 34→47 是因为教材 1–14 讲全部落盘后 classroom.yaml 新增 13 条 material.current.*；
  // 47→49 是 A（课堂记录 K3.4）新增的两条「下一节课开头」块：state.mistakes.due / state.review.due。
  // 本条是快照钉，不是不变量。
  assert.equal(m.blocks.length, 49)
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

// ── F3／F3b 用的两件东西（都在本文件里，**独立于**引擎的注入计划器）─────────────
//
// 🔴 为什么 F3 的期望值**不再写死一份块集**（FREQ-PARITY，2026-09-24）：
//    写死的块集＝教室真值的第二副本。教室一改频率语义（那一次是 `anchor.check` 从
//    `n_turns:5` 改成相位门 `every: phase` ＋ `except: [open]`），这里就变红，而红的信息
//    只说"某相位的块集不对"——**没人知道红的是哪两处**（另一条线为此做了一组"冻结引擎 vs
//    现盘教室"的对照实验才定位到成因）。现在期望值**从教室声明推导**：教室再改频率，这里
//    自动跟上，不再留分叉点。
//
// 🔴 但"推导"**不能**发现"教室声明自己写错了"——推导器与计划器读的是同一份声明，会一起错。
//    所以另加一份**签署表**（`SIGNED_FREQUENCY_GATES`，见 F3b）：教室语义一变就响亮报错，
//    指名道姓说清"哪一处改了、另一处没动"。
//    分工：**推导管"计划器有没有照教室声明执行"，签署表管"教室有没有在没人知道的情况下改语义"。**

/** 相位门（独立实现；语义与 `lib/injector.mjs` 的 `phaseGate` 逐条一致）。 */
function declaredPhaseAllows(gate, current) {
  if (!gate) return true
  if (Array.isArray(gate.except) && gate.except.includes(current)) return false
  if (Array.isArray(gate.phases) && !gate.phases.includes(current)) return false
  return true
}

/** 讲次门（独立实现；形状不认识就抛错，**不静默**当作"不放行"）。 */
function declaredLessonAllows(gate, lesson) {
  if (gate === null || gate === undefined) return true
  if (gate.current === true) return gate.of === undefined || gate.of === lesson
  if (Array.isArray(gate.list)) return gate.list.includes(lesson)
  if (Array.isArray(gate.range)) return lesson >= gate.range[0] && lesson <= gate.range[1]
  throw new Error(`讲次门形状不认识：${JSON.stringify(gate)} → 本推导器不猜（两处必须同改）`)
}

/**
 * 从**教室声明**推导"记账表全空"时某相位的注入块集（独立实现，不调注入计划器）。
 * @param {object} manifest — `loadManifest` 的结果
 * @param {string} phase — 当前相位
 * @param {{turnCount?:number, currentLesson?:number}} at — 回合号／讲次；记账表按**全空**算
 *   （两种 `anchor` 的 `once` 都还没记过账 → 本回合在场）
 */
function deriveBlocksFromDeclarations(manifest, phase, at = {}) {
  const turnCount = at.turnCount ?? 1
  const currentLesson = at.currentLesson ?? 1
  const due = []
  for (const block of manifest.blocks) {
    if (block.position.target !== 'chat') continue
    if (!declaredLessonAllows(block.lesson, currentLesson)) continue
    const every = block.frequency?.every
    const gateOk = declaredPhaseAllows(block.phase, phase)
    let byFrequency
    switch (every) {
      case 'once':
      case 'turn':
        byFrequency = true
        break
      case 'n_turns':
        byFrequency = turnCount % block.frequency.n === 0
        break
      case 'phase':
        byFrequency = gateOk
        break
      case 'on_demand':
        byFrequency = false
        break
      default:
        throw new Error(
          `块 ${block.id} 的频率模式 ${JSON.stringify(every)} 本推导器不认识 —— ` +
            '教室加了新语义而引擎侧（推导器＋签署表）没跟上＝两处必须同改；不许静默当作"不注入"',
        )
    }
    if (!byFrequency) continue
    if (!gateOk) continue // 与计划器一致：相位门可叠加在任意频率上
    due.push(block.id)
  }
  return due
}

/** 一个块"与注入有关"的声明，规范化成一行（签署表与报错信息共用这一处口径）。 */
function canonicalDeclaration(block) {
  const gateText = () => {
    if (!block.phase) return null
    const bits = []
    if (Array.isArray(block.phase.phases)) bits.push(`phases=${block.phase.phases.join(',')}`)
    if (Array.isArray(block.phase.except)) bits.push(`except=${block.phase.except.join(',')}`)
    return bits.length > 0 ? bits.join(';') : '无门（恒开）'
  }
  const parts = [block.position.target]
  const freq = block.frequency ?? {}
  if (freq.every === 'phase') {
    parts.push(`phase(${gateText() ?? '无门（恒开）'})`)
  } else {
    let head = String(freq.every)
    if (freq.every === 'n_turns') head += `(${freq.n})`
    else if (freq.every === 'once' && freq.anchor) head += `(${freq.anchor})`
    parts.push(head)
    if (gateText()) parts.push(`phase(${gateText()})`)
  }
  if (block.lesson) {
    const gate = block.lesson
    if (gate.current === true) parts.push(`lesson(current${gate.of === undefined ? '' : `,of=${gate.of}`})`)
    else if (Array.isArray(gate.list)) parts.push(`lesson(list=${gate.list.join(',')})`)
    else if (Array.isArray(gate.range)) parts.push(`lesson(range=${gate.range.join('-')})`)
    else parts.push(`lesson(${JSON.stringify(gate)})`)
  }
  return parts.join(' · ')
}

/**
 * 🔴 **引擎侧对 cs-os 频率语义的签署表**（块 id → 上面那个规范化声明）。
 *
 * 这是"动这里的频率语义＝两处必须同改"里的**引擎侧那一处**（教室 `classroom.yaml` 自己的注释
 * 就写着这句话）。它是**声明层的第二副本**，代价说清楚：教室改语义时它会红。
 * 为什么仍然要它（而不是全交给 F3 的推导）：
 *   F3 的期望是**从同一份教室声明推出来的**——教室声明自己配错（例如新教材块忘了挂讲次门）时
 *   推导器会**跟着一起错**，这类问题就没人能发现了；T6 接线那轮正是靠 F3 当时写死的期望值才
 *   抓到"13 条新教材块有没有挂上讲次门"（见该报告的自检节）。所以两份都要：
 *   **推导管"计划器有没有照声明执行"，这份表管"教室有没有在没人知道的情况下改语义"。**
 * 纪律：红了先判断是不是**有意**的；有意的就**逐条更新这里**（并检查引用同一份语义的别处：
 *   报告里的逐相位对照表、`classroom.yaml` 自己的注释、`system_core.md`），误改就还原教室。
 *   🔴 **不许把这条判据删掉或放宽来"变绿"**——那正是本表要防的静默分叉。
 */
const SIGNED_FREQUENCY_GATES = {
  // 🔴 2026-10-19：教室的当课角色从 komari 换成 deepseek（换角色＝换 characters/ 里的文件），
  //    persona 块的 id 随之改名。**这是有意的语义变更**，按本表纪律逐条更新这里。
  //    频率语义本身没变（仍是 system · once）。
  'persona.deepseek': 'system · once',
  'teach.system_core': 'system · once',
  'world.setting': 'system · once',
  'world.metaphor': 'system · once',
  'anchor.rules': 'chat · turn',
  'anchor.lesson_ban': 'chat · turn',
  'anchor.voice': 'system · once',
  'anchor.check': 'chat · phase(except=open)',
  'story.arc_gate': 'chat · once · lesson(list=1)',
  'curriculum.map': 'chat · once(lesson_start)',
  'kp.current': 'chat · phase(phases=check,close)',
  'story.node.01': 'chat · phase(phases=open) · lesson(current,of=1)',
  'story.node.02': 'chat · phase(phases=open) · lesson(current,of=2)',
  'story.node.03': 'chat · phase(phases=open) · lesson(current,of=3)',
  'story.node.04': 'chat · phase(phases=open) · lesson(current,of=4)',
  'story.node.05': 'chat · phase(phases=open) · lesson(current,of=5)',
  'story.node.06': 'chat · phase(phases=open) · lesson(current,of=6)',
  'story.node.07': 'chat · phase(phases=open) · lesson(current,of=7)',
  'story.node.08': 'chat · phase(phases=open) · lesson(current,of=8)',
  'story.node.09': 'chat · phase(phases=open) · lesson(current,of=9)',
  'story.node.10': 'chat · phase(phases=open) · lesson(current,of=10)',
  'story.node.11': 'chat · phase(phases=open) · lesson(current,of=11)',
  'story.node.12': 'chat · phase(phases=open) · lesson(current,of=12)',
  'story.node.13': 'chat · phase(phases=open) · lesson(current,of=13)',
  'story.node.14': 'chat · phase(phases=open) · lesson(current,of=14)',
  'material.current.01': 'chat · phase(phases=probe,check) · lesson(current,of=1)',
  'material.current.02': 'chat · phase(phases=probe,check) · lesson(current,of=2)',
  'material.current.03': 'chat · phase(phases=probe,check) · lesson(current,of=3)',
  'material.current.04': 'chat · phase(phases=probe,check) · lesson(current,of=4)',
  'material.current.05': 'chat · phase(phases=probe,check) · lesson(current,of=5)',
  'material.current.06': 'chat · phase(phases=probe,check) · lesson(current,of=6)',
  'material.current.07': 'chat · phase(phases=probe,check) · lesson(current,of=7)',
  'material.current.08': 'chat · phase(phases=probe,check) · lesson(current,of=8)',
  'material.current.09': 'chat · phase(phases=probe,check) · lesson(current,of=9)',
  'material.current.10': 'chat · phase(phases=probe,check) · lesson(current,of=10)',
  'material.current.11': 'chat · phase(phases=probe,check) · lesson(current,of=11)',
  'material.current.12': 'chat · phase(phases=probe,check) · lesson(current,of=12)',
  'material.current.13': 'chat · phase(phases=probe,check) · lesson(current,of=13)',
  'material.current.14': 'chat · phase(phases=probe,check) · lesson(current,of=14)',
  'state.progress': 'chat · turn',
  'state.learner': 'chat · n_turns(5)',
  // 🔴 2026-10-20（A · 课堂记录 K3.4）**有意收窄**这两块的相位门，避免与下面两块重复注入：
  //    open 相位只看「未解决 / 到期」两个切片，整份文件改在 check / review 相位给。
  'state.mistakes': 'chat · phase(phases=check)',
  'state.review': 'chat · phase(phases=review)',
  // 🔴 2026-10-20（A · 课堂记录 K3.4）：新增两块——「下一节课开头」注入「未解决的卡点」
  //    （`runtime/mistake_log.md` 的 `## 未解决` 段）与「到期复习项」（`runtime/review_queue.md`
  //    的 `## 到期待复习` 段）。**有意变更**，逐条登记。
  //    语义：`every: turn` 管"每回合重新裁决"，`phase: { phases: [open] }` 管"只在开场相位出现"
  //    ——契约 K3.4 点名**必须带 `phase:`**（裸 `every: phase` 的 phaseGate 恒真，是假门）。
  //    去重靠现有的 (sessionId, turn) 幂等门，没有新造去重表。
  'state.mistakes.due': 'chat · turn · phase(phases=open)',
  'state.review.due': 'chat · turn · phase(phases=open)',
  'state.session_log': 'chat · on_demand',
  'state.archive': 'chat · on_demand',
  'state.diary': 'chat · on_demand · phase(phases=close)',
  'state.wechat': 'chat · on_demand',
}

/** 教室 yaml 里某个块 id 的行号（只用于报错信息里指路；找不到 → null）。 */
function yamlLineOfBlock(yamlText, id) {
  const at = yamlText.split('\n').findIndex((line) => line.trim() === `- id: ${id}`)
  return at === -1 ? null : at + 1
}

test('🔴 F3 cs-os：相位逐相位注入块集（期望值**从教室声明推导**，不再写死一份块集）', () => {
  const m = loadManifest(CS_OS)
  const domain = phaseDomainOf(m)
  assert.deepEqual(domain, ['open', 'probe', 'answer', 'check', 'review', 'close'])
  // 两个状态各跑一遍六相位：① 冷启动（第 1 回合／第 1 讲）；② 第 5 回合（`n_turns:5` 的那几块进场）。
  const ats = [
    { label: '第 1 回合（冷启动）', turnCount: 1, currentLesson: 1 },
    { label: '第 5 回合', turnCount: 5, currentLesson: 1 },
  ]
  for (const at of ats) {
    for (const phase of domain) {
      const want = deriveBlocksFromDeclarations(m, phase, at)
      const got = ids(
        planTurnInjections(m.blocks, freshState(phase, { turnCount: at.turnCount, currentLesson: at.currentLesson })),
      )
      assert.deepEqual(
        got,
        want,
        `${at.label} · ${phase} 相位：计划器算出的块集 ≠ 从教室声明推导的块集` +
          '（要么计划器没照声明执行，要么教室声明改了而引擎侧没跟上）',
      )
    }
  }
  // 门真的在动：六个相位不得推出同一个集合（否则＝相位门恒开，是假门）
  const perPhase = domain.map((phase) => deriveBlocksFromDeclarations(m, phase, ats[0]).join(','))
  assert.ok(new Set(perPhase).size > 1, '六个相位的块集完全相同 → 相位门恒开（假门），必须查')
  // 🔴 本轮（FREQ-PARITY）跟改的那条语义——`anchor.check` 走相位门、六个相位里除 `open` 外都放行
  //    ——**不在这里另写一遍**（写第二遍＝第二个分叉点）：它的唯一手写维护点是下面 F3b 签署表里
  //    那一行 `'anchor.check': 'chat · phase(except=open)'`，那行一变就响亮报错；逐相位的期望值
  //    则由本条的推导自动跟上。`open` 不放行 / 其余五个放行这条事实，由"推导 vs 计划器"逐相位
  //    比对（含 open 相位）来保证。
})

test('🔴 F3 推导器自身：遇到它不认识的语义 → 抛错（不许静默当作"不注入"）', () => {
  // 这一条守的是**未来**：若有人给 schema 加了新频率模式而计划器/推导器没跟上，
  // 计划器会静默"永不注入"（本项目最怕的形态）→ 推导器必须当场喊出来。
  const fake = (block) => ({ blocks: [{ position: { target: 'chat' }, phase: null, lesson: null, ...block }] })
  assert.throws(
    () => deriveBlocksFromDeclarations(fake({ id: 'x', frequency: { every: 'weird' } }), 'open', {}),
    /频率模式 "weird" 本推导器不认识/,
  )
  assert.throws(
    () => deriveBlocksFromDeclarations(fake({ id: 'y', frequency: { every: 'turn' }, lesson: { weird: true } }), 'open', {}),
    /讲次门形状不认识/,
  )
  // 反向对照：认识的语义不得误抛
  assert.deepEqual(
    deriveBlocksFromDeclarations(fake({ id: 'z', frequency: { every: 'turn' } }), 'open', {}),
    ['z'],
  )
})

test('🔴 F3b cs-os：教室频率语义 vs 引擎侧签署表 —— 不一致就报「两处必须同改」', () => {
  const m = loadManifest(CS_OS)
  const yamlText = readFileSync(CLASSROOM_YAML, 'utf8')
  const sha = createHash('sha256').update(yamlText, 'utf8').digest('hex')
  const now = new Map(m.blocks.map((block) => [block.id, canonicalDeclaration(block)]))
  const changed = []
  const removed = []
  const added = []
  for (const [id, signed] of Object.entries(SIGNED_FREQUENCY_GATES)) {
    if (!now.has(id)) removed.push({ id, signed })
    else if (now.get(id) !== signed) changed.push({ id, signed, now: now.get(id) })
  }
  for (const [id, value] of now) {
    if (!Object.prototype.hasOwnProperty.call(SIGNED_FREQUENCY_GATES, id)) added.push({ id, now: value })
  }
  if (changed.length === 0 && removed.length === 0 && added.length === 0) return

  const where = (id) => {
    const line = yamlLineOfBlock(yamlText, id)
    return line === null ? '' : `（classroom.yaml 第 ${line} 行）`
  }
  const out = [
    '',
    '🔴 教室的频率语义与引擎侧签署表**不一致（＝两处不同步）** —— 「动这里的频率语义＝两处必须同改」',
    '',
    '这两处分别是：',
    `  ① 教室侧：classrooms/cs-os/classroom.yaml（现盘 sha256 ${sha.slice(0, 16)}…）`,
    '  ② 引擎侧：本文件（test/phase.test.mjs）的 SIGNED_FREQUENCY_GATES 签署表',
    '',
  ]
  if (changed.length > 0) {
    out.push(`改了 ${changed.length} 条（教室已经变了，签署表还是旧语义）：`)
    for (const c of changed) {
      out.push(`  · ${c.id}${where(c.id)}`)
      out.push(`      签署表：${c.signed}`)
      out.push(`      现盘　：${c.now}`)
    }
    out.push('')
  }
  if (removed.length > 0) {
    out.push(`删了 ${removed.length} 条（签署表里有、教室里已经找不到）：`)
    for (const r of removed) out.push(`  · ${r.id}　签署表：${r.signed}`)
    out.push('')
  }
  if (added.length > 0) {
    out.push(`新增 ${added.length} 条（教室里新出现的块，签署表里没有）：`)
    for (const a of added) out.push(`  · ${a.id}${where(a.id)}　现盘：${a.now}`)
    out.push('')
  }
  out.push(
    '怎么修（二选一，都不许"把判据放宽"）：',
    '  · 这是**有意**的改动 → 逐条更新上面那张签署表（每块一行），并检查引用同一份语义的别处：',
    '    报告里的逐相位对照表、classroom.yaml 自己的注释、system_core.md 的相位段；然后重跑。',
    '  · 这是**误改** → 还原教室 classroom.yaml。',
    '🔴 不许删掉或放宽这条判据来变绿 —— 那正是它要防的静默分叉（下一个人会看到一条没人能解释的红测试）。',
  )
  throw new Error(out.join('\n'))
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
