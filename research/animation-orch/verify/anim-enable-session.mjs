// anim-enable-session.mjs — ANIM-ENABLE 的验收：**仓库教室自己**（不是 /tmp 里的补丁副本）
// 现在会不会让老师真的调 `classroom_animate`。
//
// 与 ab-session.mjs 的关系（为什么另开一个而不是加个 mode）：
//   ab-session.mjs 的 b/c 组会**自己往教室副本的 classroom.yaml 追加** `animation:\n  enabled: true`。
//   而 ANIM-ENABLE 之后**仓库教室自己就带这个声明了** → 再追加一次 = YAML 顶层键重复
//   （实测 `parseDocument` 报 `Map keys must be unique`）→ 会话起不来。
//   → 本脚本**不加任何声明**，只把仓库教室原样 rsync 到 /tmp 再跑，
//     这样"教室自带的声明 + 教室自带的纪律"就是唯一变量，正是本轮要验的东西。
//
// 🔴 绝不写真教室：真教室的 `runtime/` 是状态真源 → 只跑 /tmp 副本。
//
// 用法（在 code/tools/animation-orch/ 下）：
//   DSH_HOME="$HOME/Library/Application Support/dsh-desktop/harness" \
//   DSH_BIN="/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js" \
//   /opt/homebrew/bin/node verify/anim-enable-session.mjs [fifo|interrupt] [轮间毫秒]
// 产物：evidence/anim-enable-<point>.json（原始事实）＋ 会话 jsonl 路径

import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const toolRoot = resolve(here, '..')
const repoRoot = resolve(toolRoot, '../../..') // 开源线/DSH定制
const CLASSROOM_SRC = join(repoRoot, 'code', 'classrooms', 'cs-os')
const DRIVER = join(here, 'session-driver.mjs')
const MANIM_ENV = join(repoRoot, 'poc_动画可写性', 'env')
const GATE = join(repoRoot, 'code', 'tools', 'animation-gate', 'animation_gate.py')
const EVIDENCE = join(toolRoot, 'evidence')

const DSH_HOME = process.env.DSH_HOME
const DSH_BIN = process.env.DSH_BIN
if (!DSH_HOME || !DSH_BIN) throw new Error('需要 DSH_HOME 与 DSH_BIN')

const POINT = (process.argv[2] ?? 'interrupt').toLowerCase()
const GAP_MS = Number.parseInt(process.argv[3] ?? '20000', 10)

// 教学话术（与 ANIM-ORCH 的 ab-session 逐字相同，便于与那一轮对照）
const QUESTIONS = {
  fifo: [
    '开始第 3 讲。学生问：「为什么 FIFO 会让一个很长的任务把后面短的任务全堵住？」请按你的教学判断讲这一小段。',
    '继续讲：那换成时间片轮转会怎么样？',
  ],
  interrupt: [
    '开始第 1 讲。学生问：「一个程序正在跑，它怎么就突然停下来了？谁让它停的？」请按你的教学判断讲这一小段。',
    '继续讲：那它下次是怎么接着跑下去的？',
  ],
}
if (QUESTIONS[POINT] === undefined) throw new Error(`点位只能是 ${Object.keys(QUESTIONS).join(' / ')}`)
const PROMPTS = QUESTIONS[POINT]

// 教室副本（原样 rsync，一个字不改）
const WORK = join(tmpdir(), `anim-enable-${POINT}`)
rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })
const classroom = join(WORK, 'classroom')
execFileSync('rsync', ['-a', `${CLASSROOM_SRC}/`, `${classroom}/`])

// 副本里的声明与纪律（落进证据，便于事后核对"跑的到底是哪一版"）
const copyYaml = readFileSync(join(classroom, 'classroom.yaml'), 'utf8')
const copyAnchor = readFileSync(join(classroom, '_anchor.md'), 'utf8')
const yamlHasAnim = /^animation:\n {2}enabled: true$/m.test(copyYaml)
const anchorHasAnim = copyAnchor.includes('classroom_animate')

// patch：教室指到副本；渲染器路径按部署事实给；关掉一进程一回合的 headless runner，改挂多轮 driver。
const patchPath = join(WORK, 'patch.yml')
const patchLines = [
  `# anim-enable-session（${POINT}）专用 patch：教室指到 /tmp 副本；给渲染器路径；挂多轮 driver。`,
  '- id: socratic-engine',
  '  config:',
  `    classroomDir: ${classroom}`,
  '    animation:',
  `      python: ${join(MANIM_ENV, 'bin', 'python')}`,
  `      manim: ${join(MANIM_ENV, 'bin', 'manim')}`,
  '      quality: l',
  `      gate: ${GATE}`,
  `      gatePython: ${join(MANIM_ENV, 'bin', 'python')}`,
  '- id: headless-runner',
  '  disabled: true',
  '- insert:',
  '    - id: socratic-anim-enable-driver',
  `      name: ${DRIVER}`,
  '',
]
writeFileSync(patchPath, patchLines.join('\n'))

function listSessionLogs() {
  const out = new Set()
  const root = join(DSH_HOME, 'sessions')
  for (const b of readdirSync(root, { withFileTypes: true })) {
    if (!b.isDirectory()) continue
    const bp = join(root, b.name)
    let dirs = []
    try {
      dirs = readdirSync(bp, { withFileTypes: true }).filter((e) => e.isDirectory())
    } catch {
      continue
    }
    for (const d of dirs) {
      const full = join(bp, d.name)
      let files = []
      try {
        files = readdirSync(full)
      } catch {
        continue
      }
      for (const f of files) if (/^session\..*\.jsonl\.zstd$/.test(f)) out.add(join(full, f))
    }
  }
  return out
}

const task = `${PROMPTS.length}|${PROMPTS.join('|')}`
const before = listSessionLogs()
const reportPath = join(WORK, 'driver-report.json')
const t0 = Date.now()
const child = spawn(process.execPath, [DSH_BIN, '--profile', 'socratic-headless', '--patch', patchPath, task], {
  cwd: classroom,
  env: { ...process.env, SOCRATIC_MULTITURN_REPORT: reportPath, SOCRATIC_TURN_GAP_MS: String(GAP_MS) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let stdout = ''
let stderr = ''
child.stdout.on('data', (c) => (stdout += c.toString()))
child.stderr.on('data', (c) => (stderr += c.toString()))
const code = await new Promise((r) => child.on('close', r))
const wallMs = Date.now() - t0

let logFile = null
let newest = -1
for (const f of listSessionLogs()) {
  if (before.has(f)) continue
  const m = statSync(f).mtimeMs
  if (m > newest) {
    newest = m
    logFile = f
  }
}

let driverReport = null
try {
  driverReport = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch {
  /* driver 可能没写（例如引擎装载就报错）——照样落盘，不掩盖 */
}

const out = {
  point: POINT,
  generatedAt: new Date().toISOString(),
  exit: code,
  wallMs,
  classroomSrc: CLASSROOM_SRC,
  classroom,
  patchPath,
  logFile,
  classroomDeclaredAnimation: yamlHasAnim,
  anchorMentionsAnimate: anchorHasAnim,
  turnGapMs: GAP_MS,
  prompts: PROMPTS,
  driverReport,
  stdoutTail: stdout.slice(-4000),
  stderrTail: stderr.slice(-4000),
}
mkdirSync(EVIDENCE, { recursive: true })
writeFileSync(join(EVIDENCE, `anim-enable-${POINT}.json`), JSON.stringify(out, null, 2))
console.log(`[anim-enable/${POINT}] exit=${code} wall=${(wallMs / 1000).toFixed(1)}s log=${logFile}`)
console.log(`[anim-enable/${POINT}] 副本声明 animation=${yamlHasAnim} 副本纪律提到 classroom_animate=${anchorHasAnim}`)
console.log(`[anim-enable/${POINT}] driver: turns=${driverReport?.turnStarts?.length ?? 'n/a'} injections=${driverReport?.injectionUserMessages?.length ?? 'n/a'}`)
console.log(stderr.slice(-1500))
