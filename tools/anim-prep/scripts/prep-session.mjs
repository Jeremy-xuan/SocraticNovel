// scripts/prep-session.mjs — 实验②：**课前预热 ＋ 课上取用（缓存命中）**的真实验证。
//
// 分两段（口径写死）：
//   第 1 段（**零 LLM 成本**，离线）：在教室副本里按 `prep:` 声明把这一讲的动画预热出来，
//        量"一节课预生成 N 段"的**真实秒数**与状态（ready / blocked / failed）。
//        这一段跑的就是引擎装载/回合开头会跑的那个函数（lib/prepstore.mjs 的 warmUpPrep）。
//   第 2 段（**真实会话**）：跑一次真实教学会话，看三件事——
//        ① 引擎有没有在回合开头把"本讲备好的动画清单"注入给老师；
//        ② 老师有没有**取用**（调 classroom_animate_template 传 prepId）而不是自己写脚本；
//        ③ 取用是否**命中缓存**（0 秒、盘上没有新增任务目录）。
//
// 🔴 不写真教室：教室是 rsync 到 /tmp 的副本；`prep:` 段与渠道纪律**只写在副本里**。
//
// 用法：/opt/homebrew/bin/node scripts/prep-session.mjs [--skip-session]
// 产物：evidence/prep-session.json ＋ tmp/prep-session/ 下的副本、会话日志、任务目录

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { warmUpPrep } from '../../../plugins/socratic-engine/lib/prepstore.mjs'
import { parseManifest } from '../../../plugins/socratic-engine/lib/manifest.mjs'
import { prepItemsForLesson } from '../../../plugins/socratic-engine/lib/prep.mjs'
import {
  EVIDENCE,
  MANIM_ENV,
  engineLogLines,
  makeClassroomCopy,
  repoRoot,
  runSession,
  toolCallArgs,
  writePatch,
} from './session.mjs'

const GATE = join(repoRoot, 'code', 'tools', 'animation-gate', 'animation_gate.py')
const SKIP_SESSION = process.argv.includes('--skip-session')
/**
 * `--reuse`：**不重建副本、不重新预热**，直接在同一份副本上再跑一次真实会话。
 * 用途＝验证"同一个动画只生成一次"的**跨会话**那一半：上一节课预热好的片子，
 * 这一节课（新会话、新进程）应该**命中缓存、盘上不新增任务目录**。
 * 只跑会话那一半，离线预热段的数字沿用上一次落盘的 evidence（不覆盖）。
 */
const REUSE = process.argv.includes('--reuse')
const WORK = join(tmpdir(), 'animprep-prep-session')

/**
 * 宿主原子写的替身（tmp + rename）。
 * 🔴 为什么离线段要注入它：生产里 `startAnimationTask` 走的是宿主包
 *    `@deepseek-ai/dsh-atomic-write`，而**脚本进程里解析不到那个包**（它只存在于 profile 里）。
 *    注入替身不是为了"绕过"，是为了让这段能在宿主之外**真的落盘**（同 test/animation.test.mjs 的口径）。
 */
const realIo = {
  async writeFileAtomic(file, content, opts = {}) {
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, content, { mode: opts.mode ?? 0o600 })
    const { renameSync } = await import('node:fs')
    renameSync(tmp, file)
  },
  async withFileLock(_file, fn) {
    return fn()
  },
}

/**
 * 备课声明（**只写进副本**）。参数就是第 3 讲那道题的真实数字：
 * 三个任务 0 时刻到达，A 需 100、B、C 各需 10（示例数据，按题设假设算出）。
 */
const PREP_YAML = `
prep:
  items:
    - id: fifo-vs-sjf
      lesson: 3
      template: timeline
      title: 长任务怎么堵住短任务？
      material: materials/ch03.md
      caption: 针对「FIFO 让长任务把后面全堵住」这一步
      params:
        note: 周转时间 = 完成时刻 − 到达时刻
        lanes:
          - label: 先到先服务（FIFO）：A → B → C
            segments:
              - { start: 0, end: 100, label: A, color: blue, endLabel: "100" }
              - { start: 100, end: 110, label: B, color: amber, endLabel: "110" }
              - { start: 110, end: 120, label: C, color: green, endLabel: "120" }
          - label: 最短作业优先（SJF）：B → C → A
            segments:
              - { start: 0, end: 10, label: B, color: amber, endLabel: "10" }
              - { start: 10, end: 20, label: C, color: green, endLabel: "20" }
              - { start: 20, end: 120, label: A, color: blue, endLabel: "120" }
    - id: avg-turnaround
      lesson: 3
      template: bar_compare
      title: 三种调度的平均周转时间
      material: materials/ch03.md
      required: false
      params:
        note: 同一批任务、同样的到达时刻，只换调度顺序
        highlight: SJF
        items:
          - { label: FIFO, value: 96.7 }
          - { label: SJF, value: 50.0 }
`

/**
 * 副本里补的**渠道纪律**（照 `_anchor.md` 既有写法，只规定渠道与顺序，不规定教学时机）。
 * 🔴 为什么必须有：ANIM-ORCH 已实证"引擎挂上工具 ≠ 老师会用"；而 `classroom_animate_template`
 *    与 `prepId` 是**本批新加的**，仓库教室内容里一个字都没提（`code/classrooms/**` 不在可改范围）。
 *    → 生产启用需要教室内容侧补这一段（见报告「未做到 / 待确认」）。
 */
const CHANNEL_NOTE = `
- **动画渠道（本批新增的优先级）**：要放动画时按这个顺序选——
  ① 这一步在**本讲预先备好的动画清单**里（回合开头的引擎块里有清单与 \`prepId\`）→
     调 \`classroom_animate_template\` 并传 \`prepId\`（课前已渲好，命中缓存 0 秒）；
  ② 不在清单里但形状是模板（timeline / state_machine / bar_compare）→
     调 \`classroom_animate_template\` 传 \`template\` + \`params\`；
  ③ 只有模板表达不了的过程动画，才用 \`classroom_animate\` 自己写脚本。
  **先把这一步讲给学生，再调工具。**
`

function terminalOf(animRoot) {
  if (!existsSync(animRoot)) return []
  const out = []
  for (const name of readdirSync(animRoot)) {
    const f = join(animRoot, name, 'status.json')
    if (!existsSync(f)) continue
    try {
      out.push({ taskId: name, ...JSON.parse(readFileSync(f, 'utf8')) })
    } catch {
      /* 半截文件 */
    }
  }
  return out
}

const TERMINAL = ['ready', 'blocked', 'failed']

async function waitAll(animRoot, count, timeoutMs = 120000) {
  const t0 = Date.now()
  for (;;) {
    // 🔴 只数**终态**。第一版数的是"有 status.json 就算一个"，而渲染器一开工就写
    //    `state: rendering` → 循环立刻返回，量到的是 0.3 秒而不是真实渲染时长（本批踩过一次）。
    const rows = terminalOf(animRoot).filter((r) => TERMINAL.includes(r.state))
    if (rows.length >= count) return { rows, waitedMs: Date.now() - t0 }
    if (Date.now() - t0 > timeoutMs) return { rows, waitedMs: Date.now() - t0, timeout: true }
    execFileSync('sleep', ['0.3'])
  }
}

// ── 第 1 段：离线预热（零 LLM）──────────────────────────────────────────────
const classroom = makeClassroomCopy(WORK, {
  'runtime/progress.md': readFileSync(join(repoRoot, 'code', 'classrooms', 'cs-os', 'runtime', 'progress.md'), 'utf8').replace(
    /^current_lesson: \d+$/m,
    'current_lesson: 3',
  ),
})
// 往副本的 classroom.yaml 追加 prep: 段（真教室一个字不改）
writeFileSync(
  join(classroom, 'classroom.yaml'),
  `${readFileSync(join(classroom, 'classroom.yaml'), 'utf8').replace(/\s+$/, '')}\n${PREP_YAML}`,
)
// 往副本的 _anchor.md 追加渠道纪律
writeFileSync(
  join(classroom, '_anchor.md'),
  `${readFileSync(join(classroom, '_anchor.md'), 'utf8').replace(/\s+$/, '')}\n${CHANNEL_NOTE}`,
)

const manifest = parseManifest(readFileSync(join(classroom, 'classroom.yaml'), 'utf8'), { baseDir: classroom })
const items = prepItemsForLesson(manifest, 3)
console.log(`[prep] 第 3 讲声明了 ${items.length} 段：${items.map((i) => i.id).join(', ')}`)

const runtimeDir = join(classroom, 'runtime')
const animRoot = join(runtimeDir, 'animations')
const warmT0 = Date.now()
const plan = await warmUpPrep({
  runtimeDir,
  baseDir: classroom,
  items,
  lesson: 3,
  turn: 0,
  python: join(MANIM_ENV, 'bin', 'python'),
  manim: join(MANIM_ENV, 'bin', 'manim'),
  quality: 'l',
  gate: GATE,
  gatePython: join(MANIM_ENV, 'bin', 'python'),
  io: realIo,
})
const warmMs = Date.now() - warmT0
console.log(`[prep] 预热已起 ${plan.started.length} 段（起任务耗时 ${warmMs} ms）：${plan.started.join(', ')}`)
const settled = await waitAll(animRoot, plan.started.length)
const perTask = settled.rows.map((r) => ({
  taskId: r.taskId,
  state: r.state,
  renderMs: r.renderMs ?? null,
  gateMs: r.gate?.gateMs ?? null,
  durationSec: r.durationSec ?? null,
  bytes: r.bytes ?? null,
  reason: r.reason ?? null,
  task: JSON.parse(readFileSync(join(animRoot, r.taskId, 'task.json'), 'utf8')),
}))
for (const t of perTask) {
  console.log(
    `[prep] ${t.taskId} ${t.state}｜渲染 ${t.renderMs ?? '?'} ms｜闸门 ${t.gateMs ?? '?'} ms｜` +
      `${t.durationSec ?? '?'} 秒 / ${t.bytes === null ? '?' : Math.round(t.bytes / 1024) + 'KB'}`,
  )
}

// ── 第 2 段：真实会话（老师取用）────────────────────────────────────────────
let session = null
let toolArgs = null
let newTaskDirs = []
if (!SKIP_SESSION) {
  const before = new Set(readdirSync(animRoot))
  const patchPath = writePatch(WORK, {
    classroom,
    animation: true,
    extraLines: [`      gate: ${GATE}`, `      gatePython: ${join(MANIM_ENV, 'bin', 'python')}`],
  })
  const task =
    '开始第 3 讲。学生问：「为什么 FIFO 会让一个很长的任务把后面短的任务全堵住？」' +
    '请按你的教学判断讲这一小段。'
  session = await runSession({ workDir: join(WORK, 'session-run'), patchPath, task, cwd: classroom })
  toolArgs = toolCallArgs(session.events ?? [], 'classroom_animate_template')
  newTaskDirs = readdirSync(animRoot).filter((n) => !before.has(n))
  console.log(
    `[prep] 会话 exit=${session.code} 墙钟=${(session.wallMs / 1000).toFixed(1)}s｜` +
      `工具调用=${(session.timeline?.toolNames ?? []).join(',')}｜新增任务目录=${newTaskDirs.length}`,
  )
  console.log(`[prep] 引擎日志：\n${engineLogLines(session.stderr).join('\n')}`)
}

mkdirSync(EVIDENCE, { recursive: true })
const out = {
  generatedAt: new Date().toISOString(),
  classroomCopy: classroom,
  prepItems: items.map((i) => ({ id: i.id, template: i.template, title: i.title, required: i.required })),
  warmup: {
    ms_to_spawn_all: warmMs,
    ms_to_all_terminal: settled.waitedMs,
    timeout: settled.timeout === true,
    perTask,
  },
  session: session === null
    ? null
    : {
        exit: session.code,
        wallMs: session.wallMs,
        logFile: session.logFile,
        toolNames: session.timeline?.toolNames ?? [],
        toolCalls: session.timeline?.toolCalls ?? [],
        injections: session.timeline?.injections ?? [],
        ms_to_first_assistant: session.timeline?.ms_to_first_assistant ?? null,
        templateArgs: toolArgs,
        newTaskDirs,
        engineLog: engineLogLines(session.stderr),
        stderrTail: session.stderr.slice(-1500),
      },
}
writeFileSync(join(EVIDENCE, 'prep-session.json'), JSON.stringify(out, null, 2))
console.log('[prep] 已落盘 evidence/prep-session.json')
