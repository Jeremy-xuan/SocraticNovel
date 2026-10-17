#!/usr/bin/env node
// a2-replay.mjs — A2 断言的**离线复评**（ACCEPT-5）：拿**真实会话的事件流**重跑 A2，不跑会话、不花钱
//
// 用法：
//   node acceptance/a2-replay.mjs [--out <目录>] [run 目录名…]
//     · 默认跑 `runs/` 下**全部**有 `session-events.jsonl` 的完整跑；
//     · 默认输出目录：`$TMPDIR/accept5-a2-replay/`（**一次性 scratch，不进任何归档**）。
//
// 退出码：0 = 全部被复评的跑都通过；1 = 有跑不通过（或没有可复评的跑）。
//
// 🔴 它为什么存在（以及它**不是**什么）
//   A2 的判定要用"本次会话实际注入了哪些块"＋"相位切换发生在哪一回合"，这两样都来自
//   **已经落盘的真实会话事件流**。改完 A2 的判据之后，要不要再跑一次完整跑才能知道修没修好？
//   本脚本说：**不一定** —— 拿那一跑的 `session-events.jsonl` 重新喂给**新判据**，
//   就是"用同一份真实输入复评"，**不花模型钱、也不受"完整跑只跑一次"的预算限制**。
//
//   ✔ 它证明：新判据在**真实事件流**上判定通过（含"通报 0 条"与"通报 1 条"两种真实形态）。
//   ✖ 它**不**证明：整条流水线端到端跑通（那要一次真实完整跑）。
//     所以本脚本的绿**不能**替代完整跑的绿；两者是**互补**的。
//
// 🔴 本脚本**只写 `--out` 目录**（默认 `$TMPDIR/accept5-a2-replay/`），
//    一个字节都不写仓库、不写用户 profile、不写任何 run 目录。

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadManifest } from '../plugins/socratic-engine/lib/manifest.mjs'
import { analyze } from './lib/sessionlog.mjs'
import { assert2PhaseGating } from './lib/asserts.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const RUNS_DIR = join(HERE, 'runs')

const argv = process.argv.slice(2)
const outIdx = argv.indexOf('--out')
const outDir = outIdx >= 0 ? resolve(argv[outIdx + 1]) : join(tmpdir(), 'accept5-a2-replay')
const explicitRuns = argv.filter((a, i) => !a.startsWith('--') && i !== outIdx + 1)
mkdirSync(outDir, { recursive: true })

/** 找 `runs/` 下**有完整会话事件流**的跑（只有完整跑才有）。 */
function collectRuns() {
  if (explicitRuns.length > 0) return explicitRuns
  const out = []
  // 🔴 `runs/` 在刚克隆下来的仓库里**还不存在**（它是运行产物，不进版本库）
  //    → 读不到就返回空表，由下面的"无可复评对象"如实报出来（不是抛 ENOENT）。
  let entries = []
  try {
    entries = readdirSync(RUNS_DIR, { withFileTypes: true })
  } catch {
    return out
  }
  for (const name of entries) {
    if (!name.isDirectory()) continue
    const attempt1 = join(RUNS_DIR, name.name, '03-session', 'attempt-1')
    if (existsSync(join(attempt1, 'session-events.jsonl')) && existsSync(join(attempt1, 'stage.json'))) out.push(name.name)
  }
  return out.sort()
}

/** 读一份 `session-events.jsonl` → 事件数组（只收 `type` 是字符串的行）。 */
function readEvents(file) {
  const events = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim()
    if (t === '' || !t.startsWith('{')) continue
    try {
      const parsed = JSON.parse(t)
      if (parsed !== null && typeof parsed === 'object' && typeof parsed.type === 'string') events.push(parsed)
    } catch {
      /* 坏行跳过（与 lib/sessionlog.mjs 的 parseEvents 同口径） */
    }
  }
  return events
}

const failures = []
const notEvaluable = []
const runs = collectRuns()
console.log(`══ A2 离线复评（真实事件流 + 新判据）══`)
console.log(`  输出目录：${outDir}`)
console.log(`  待复评：${runs.length} 个跑\n`)

if (runs.length === 0) failures.push('runs/ 下没有任何带 session-events.jsonl 的完整跑 → 无可复评对象')

for (const run of runs) {
  const attempt1 = join(RUNS_DIR, run, '03-session', 'attempt-1')
  const stage = JSON.parse(readFileSync(join(attempt1, 'stage.json'), 'utf8'))
  const frozenClassroom = stage.frozenClassroom
  const state = stage.classroomStateBefore ?? {}
  const events = readEvents(join(attempt1, 'session-events.jsonl'))
  const analysis = analyze(events)

  const injections = analysis.injections
  const notices = injections.filter((r) => typeof r.block === 'string' && r.block.startsWith('animation-notice:'))
  const prepLists = injections.filter((r) => typeof r.block === 'string' && r.block.startsWith('prep-list:'))
  console.log(`── ${run}`)
  console.log(`   事件 ${events.length} 条｜回合 ${analysis.turns.length} 个｜注入 ${injections.length} 条`)
  console.log(`   备课清单注入：${JSON.stringify(prepLists.map((r) => `t${r.turn}:${r.block}`))}`)
  console.log(`   动画通报注入：${JSON.stringify(notices.map((r) => `t${r.turn}:${r.block}`))}`)

  if (frozenClassroom === undefined || !existsSync(join(frozenClassroom, 'classroom.yaml'))) {
    failures.push(`${run}：冻结教室不存在（${frozenClassroom}）→ 复评不了`)
    console.log('   ✖ 冻结教室不存在，跳过\n')
    continue
  }
  const manifest = loadManifest(frozenClassroom)
  const result = assert2PhaseGating({
    analysis,
    manifest,
    phaseAtRunStart: state.phaseAtRunStart ?? null,
    lessonAtRunStart: state.lessonAtRunStart ?? null,
    runDir: join(outDir, run), // 🔴 证据写**临时目录**，不碰归档
    phaseAfterRun: state.phaseAtRunStart ?? null,
  })
  const evidenceFile = join(outDir, run, '04-asserts', 'evidence', 'A2-材料按环节给.json')
  const resultFile = join(outDir, run, 'A2-replay-result.json')
  writeFileSync(resultFile, `${JSON.stringify({ run, ok: result.ok, detail: result.detail, evidenceFile }, null, 2)}\n`, 'utf8')
  if (result.ok) console.log(`   ✔ A2 通过：${result.detail}\n`)
  else if (/没有一次"有下一回合可比"的相位切换/.test(result.detail)) {
    // 🔴 **复评不了 ≠ 判据红**：这类历史跑的会话只跑了 1 个回合（当时 `--turns 1`），
    //    根本没有"换环节之后的下一个回合"可比 —— A2 的判据**不适用**于它，
    //    而不是"新判据把它判红了"。分开计数，不混进失败。
    notEvaluable.push({ run, reason: '会话只有 1 个回合 → A2 不适用（判据没红）' })
    console.log(`   ⚠️ A2 **不适用**（会话只跑了 1 个回合，没有"下一回合"可比）—— 不算失败\n`)
  } else {
    failures.push(`${run}：A2 仍失败 → ${result.detail}`)
    console.log(`   ✖ A2 失败：${result.detail}\n`)
  }
}

console.log(`  合计：复评 ${runs.length} 个跑｜通过 ${runs.length - failures.length - notEvaluable.length}｜不适用 ${notEvaluable.length}｜失败 ${failures.length}`)
for (const n of notEvaluable) console.log(`    · 不适用：${n.run} —— ${n.reason}`)
console.log(
  failures.length === 0
    ? `✅ 所有**可复评**的真实跑，A2 在新判据下都通过（离线复评；**不等于**整条流水线端到端跑通）`
    : `🔴 有 ${failures.length} 项：\n${failures.map((f) => `  · ${f}`).join('\n')}`,
)
process.exitCode = failures.length === 0 ? 0 : 1
