#!/usr/bin/env node
// frequency-parity.mjs — 频率语义「两处实现一致性」机核（ACCEPT-5）
//
// 用法：
//   node acceptance/frequency-parity.mjs
//
// 退出码：0 = 一致；1 = 有分歧（**绝不静默**：任何一格对不上都算失败）。
//
// 🔴 为什么要有这份机核
//   "某回合该注入哪些块"这件事在本仓库有**两份独立实现**，这是设计如此（验收不许拿被测代码
//   的输出校验被测代码，见 lib/asserts.mjs 头注）：
//     · 生产侧：`plugins/socratic-engine/lib/injector.mjs` 的 `planTurnInjections`（被测对象）
//     · 验收侧：`acceptance/lib/asserts.mjs` 的 `predictTurnBlocks`（独立重推）
//   两份都在实现同一套频率语义（`once` / `turn` / `n_turns` / `phase` / `on_demand`，
//   外加 `frequency.anchor: lesson_start` 与讲次门、相位门）。**动一处就必须动另一处**，
//   否则验收会拿**旧语义**去推期望块清单 —— 那正是 ACCEPT-4 那条 A2 红的形态之一。
//   本脚本把"两处一致"变成一条**可重跑的命令**，而不是靠人记得。
//
// 🔴 覆盖范围（逐条说清，不含糊）
//   ✔ 覆盖：`once`（含 `anchor: lesson_start` 与缺省 `session_start`）、`turn`、`n_turns`、
//     `phase`（含与 `frequency.phase` 叠加的相位门）、`on_demand`、讲次门（`lesson` 字段）。
//   ✔ 覆盖：跨回合的记账（once 集合、每讲一次的那张表）在两条路径上**独立累积**后逐回合比对。
//   ✔ 覆盖：全部真实教室 manifest（`classrooms/*`）＋ 引擎自带 fixture 教室。
//   ✔ 覆盖：相位序列与讲次的组合网格（不是只跑一种序列）。
//   ✖ 不覆盖：两类**运行期动态块**（`prep-list:` / `animation-notice:`）——它们**不经过**
//     `planTurnInjections`（由引擎 index.mjs 在回合边界自产），因此不在本机核的比对面内。
//     它们的建模与判据在 `lib/asserts.mjs` 的「运行期动态块」一节与 A2 断言里。
//   ✖ 不覆盖：`on_demand` 的**工具触发路径**——引擎当前是 `inject = false // TODO: M3 工具接入`，
//     即"永不自动注入"；验收侧同样是 `inject = false`。两边现在**逐字一致**。
//     🔴 将来引擎把工具触发路径做出来时，本机核**会**发现两侧分歧（因为验收侧不模拟工具调用）
//     —— 那时要改的是验收侧，不是把这条判据关掉。
//
// 🔴 本脚本**只读**：不写任何文件、不跑会话、不花模型钱。

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadManifest } from '../plugins/socratic-engine/lib/manifest.mjs'
import { planTurnInjections } from '../plugins/socratic-engine/lib/injector.mjs'
import { predictTurnBlocks } from './lib/asserts.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CODE_DIR = resolve(HERE, '..')
const CLASSROOMS_DIR = join(CODE_DIR, 'classrooms')
const FIXTURES_DIR = join(CODE_DIR, 'plugins', 'socratic-engine', 'test', 'fixtures')

const failures = []
const ok = (text) => console.log(`  ✔ ${text}`)
const bad = (text) => {
  failures.push(text)
  console.log(`  ✖ ${text}`)
}

/** 收集要比对的教室目录：真实教室 + 引擎 fixture 教室（有 classroom.yaml 的才算）。 */
function collectClassroomDirs() {
  const dirs = []
  const push = (dir, label) => {
    if (existsSync(join(dir, 'classroom.yaml'))) dirs.push({ dir, label })
  }
  try {
    for (const name of readdirSync(CLASSROOMS_DIR, { withFileTypes: true })) {
      if (name.isDirectory()) push(join(CLASSROOMS_DIR, name.name), `真实教室 ${name.name}`)
    }
  } catch {
    /* 目录读不到 → 下面的断言会报"一个教室都没比到" */
  }
  try {
    for (const name of readdirSync(FIXTURES_DIR, { withFileTypes: true })) {
      if (name.isDirectory()) push(join(FIXTURES_DIR, name.name), `fixture ${name.name}`)
    }
  } catch {
    /* 同上 */
  }
  return dirs
}

/**
 * 在**同一条相位/讲次序列**上，把两份实现逐回合比一遍。
 * 🔴 两条路径各自维护自己的记账（`injectedOnce` / `injectedLesson`），互不共享 —— 否则
 *    "记账口径不一致"这类分歧会被共享状态掩盖掉。
 *
 * @returns {{mismatches:object[], turns:number}}
 */
function compareOnSequence(manifest, { phases, lesson }) {
  const engineOnce = new Set()
  const engineLessonBook = new Map()
  const acceptOnce = new Set()
  const acceptLessonBook = new Map()
  const mismatches = []
  for (let turn = 1; turn <= phases.length; turn += 1) {
    const phase = phases[turn - 1]
    const engine = planTurnInjections(
      manifest.blocks,
      { turnCount: turn, phase, injectedOnce: engineOnce, injectedLesson: engineLessonBook, currentLesson: lesson },
      {},
    ).map((b) => b.id)
    const accept = predictTurnBlocks(manifest, {
      phase,
      lesson,
      turn,
      injectedOnce: acceptOnce,
      lessonBook: acceptLessonBook,
    })
    const e = engine.slice().sort()
    const a = accept.slice().sort()
    if (JSON.stringify(e) !== JSON.stringify(a)) {
      mismatches.push({ turn, phase, engine: e, accept: a })
    }
  }
  return { mismatches, turns: phases.length }
}

/** 教室声明的相位 id 列表（引擎按 `manifest.phases` 的值域判；缺声明 → 用兜底值域）。 */
function phaseIdsOf(manifest) {
  const list = (manifest.phases ?? []).map((p) => (typeof p === 'string' ? p : p?.id)).filter((p) => typeof p === 'string')
  return list.length > 0 ? list : ['open', 'probe', 'close']
}

/** 教室声明的讲次（`classroom.lessons`）；缺声明 → 只试 1。 */
function lessonCandidates(manifest) {
  const max = Number.isInteger(manifest?.classroom?.lessons) ? manifest.classroom.lessons : 1
  return [...new Set([1, Math.min(2, max), max])].filter((n) => n >= 1)
}

console.log('══ 频率语义两处实现一致性机核（生产侧 planTurnInjections ↔ 验收侧 predictTurnBlocks）══')

const dirs = collectClassroomDirs()
if (dirs.length === 0) bad('一个教室都没比到（classrooms/ 与 test/fixtures/ 都读不到 classroom.yaml）')
else ok(`比对对象：${dirs.length} 个教室（真实 ${dirs.filter((d) => d.label.startsWith('真实')).length} 个、fixture ${dirs.filter((d) => d.label.startsWith('fixture')).length} 个）`)

let comparedCells = 0
let comparedSequences = 0
const perClassroom = []

for (const { dir, label } of dirs) {
  let manifest
  try {
    manifest = loadManifest(dir)
  } catch (error) {
    // fixture 教室里有**故意写坏**的（discovery-* 那几个是给发现链路用的，不是完整教室）
    // → 解析失败**不算失败**，但要**计数并说明**，不许静默跳过。
    perClassroom.push({ label, skipped: `manifest 解析失败（${error?.message?.split('\n')[0] ?? error}）` })
    continue
  }
  const phaseIds = phaseIdsOf(manifest)
  const lessons = lessonCandidates(manifest)
  const seqs = []
  // 序列 1：全程第一个相位（基线）
  seqs.push(Array.from({ length: 6 }, () => phaseIds[0]))
  // 序列 2：第 2 回合切到第二个相位（＝A2 实际用的形态）
  seqs.push(Array.from({ length: 6 }, (_, i) => (i + 1 <= 2 ? phaseIds[0] : phaseIds[1] ?? phaseIds[0])))
  // 序列 3：每回合都换相位（把所有相位门都走一遍）
  seqs.push(Array.from({ length: 6 }, (_, i) => phaseIds[i % phaseIds.length]))
  // 序列 4：回到第一个相位（考"变回去"这类边）
  seqs.push(Array.from({ length: 6 }, (_, i) => (i === 5 ? phaseIds[0] : phaseIds[1] ?? phaseIds[0])))

  let mismatches = []
  for (const phases of seqs) {
    for (const lesson of lessons) {
      const r = compareOnSequence(manifest, { phases, lesson })
      mismatches = mismatches.concat(r.mismatches.map((m) => ({ ...m, lesson, phases: phases.join(',') })))
      comparedCells += r.turns
      comparedSequences += 1
    }
  }
  perClassroom.push({
    label,
    dir,
    blocks: manifest.blocks.length,
    chatBlocks: manifest.blocks.filter((b) => b.position.target === 'chat').length,
    phases: phaseIds,
    lessonsTried: lessons,
    sequences: seqs.length * lessons.length,
    cells: seqs.length * lessons.length * 6,
    mismatches,
  })
  if (mismatches.length === 0) ok(`${label}：${seqs.length * lessons.length} 条序列 × 6 回合，逐格一致`)
  else bad(`${label}：${mismatches.length} 格不一致 → ${JSON.stringify(mismatches.slice(0, 3))}`)
}

console.log(
  `\n  合计：比到 ${perClassroom.filter((c) => !c.skipped).length} 个教室、${comparedSequences} 条序列、${comparedCells} 个「回合×序列」格子`,
)
const skipped = perClassroom.filter((c) => c.skipped)
if (skipped.length > 0) {
  console.log(`  跳过 ${skipped.length} 个（**解析失败，不是比对通过**）：`)
  for (const s of skipped) console.log(`    · ${s.label}：${s.skipped}`)
}

// ── 负向对照：证明这套比对**不是空壳**（喂一份被改坏的验收侧实现，必须报分歧）────
console.log('\n── 负向对照（证明比对不是空壳）──')
{
  const real = loadManifest(join(CLASSROOMS_DIR, 'cs-os'))
  // ① 把 `on_demand` 当成 `turn`（＝"第二处实现没跟着改"的形态）→ 必须出现分歧
  const mutated = {
    ...real,
    blocks: real.blocks.map((b) =>
      b.frequency?.every === 'on_demand' ? { ...b, frequency: { ...b.frequency, every: 'turn' } } : b,
    ),
  }
  const phases = ['open', 'open', 'probe', 'probe', 'probe', 'probe']
  const engineOnce = new Set()
  const engineBook = new Map()
  const acceptOnce = new Set()
  const acceptBook = new Map()
  let diverged = 0
  for (let turn = 1; turn <= phases.length; turn += 1) {
    const e = planTurnInjections(
      real.blocks,
      { turnCount: turn, phase: phases[turn - 1], injectedOnce: engineOnce, injectedLesson: engineBook, currentLesson: 1 },
      {},
    )
      .map((b) => b.id)
      .sort()
    const a = predictTurnBlocks(mutated, {
      phase: phases[turn - 1],
      lesson: 1,
      turn,
      injectedOnce: acceptOnce,
      lessonBook: acceptBook,
    }).sort()
    if (JSON.stringify(e) !== JSON.stringify(a)) diverged += 1
  }
  if (diverged > 0) ok(`负向对照：把验收侧的 on_demand 改成 turn → ${diverged}/6 格报分歧（比对不是空壳）`)
  else bad('负向对照失败：故意改坏验收侧实现，比对却一格都没报 → 这套比对是空壳')
}
{
  const real = loadManifest(join(CLASSROOMS_DIR, 'cs-os'))
  const r = compareOnSequence(real, { phases: ['open', 'open', 'probe', 'probe', 'probe', 'probe'], lesson: 1 })
  if (r.mismatches.length === 0) ok('正向对照：未改动 → 同一序列零分歧')
  else bad(`正向对照失败：未改动却报分歧 → ${JSON.stringify(r.mismatches.slice(0, 2))}`)
}

console.log(
  failures.length === 0
    ? '\n✅ 两处频率实现逐格一致（含负向对照证明比对有效）'
    : `\n🔴 有 ${failures.length} 项失败：\n${failures.map((f) => `  · ${f}`).join('\n')}`,
)
process.exitCode = failures.length === 0 ? 0 : 1
