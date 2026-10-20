// ab-session.mjs — ANIM-ORCH 的真实会话对照：**同一句话、同一教室、同一模型，只差"编排"**。
//
// 两组（唯一变量）：
//   A 组（编排前）：教室**不声明** animation → 引擎不注册 classroom_animate、不注入动画纪律。
//                  老师只能按自己的习惯来（实测：它会先读教材、先画板书图，**把话留到最后**）。
//   B 组（编排后）：同一份教室**加一行** `animation: {enabled: true}` → 引擎挂上工具与纪律
//                  （"先讲后画"＋"起了就继续讲"＋"好了再放"）。
//
// 量什么：**学生从发出问题到第一次看到可读文字，等了多久**（= 学生空窗）。
//   这是用户原话里的痛点（"要不就要让用户坐着干等动画"）唯一可量的形式。
//
// 两轮：第 1 轮＝真实教学提问（老师可能起动画）；第 2 轮＝"继续讲"，用来观察
//   **跨回合就绪通报**（引擎在 turn 2 开头注入"你上一轮的动画已就绪"）。
//
// 用法：
//   DSH_HOME=... DSH_BIN=... /opt/homebrew/bin/node verify/ab-session.mjs a
//   DSH_HOME=... DSH_BIN=... /opt/homebrew/bin/node verify/ab-session.mjs b
// 产物：evidence/ab-<mode>.json（原始事实）＋ 每次会话的 session 日志路径

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const toolRoot = resolve(here, '..')
const repoRoot = resolve(toolRoot, '../../..') // 开源线/DSH定制
const CLASSROOM_SRC = join(repoRoot, 'code', 'classrooms', 'cs-os')
// 本轮自己的驱动（轮间可设间隔）；共享件 multiturn-driver.mjs 零间隔、且被别的测试断言依赖，不动它
const DRIVER = join(here, 'session-driver.mjs')
const MANIM_ENV = join(repoRoot, 'poc_动画可写性', 'env')
const EVIDENCE = join(toolRoot, 'evidence')

const DSH_HOME = process.env.DSH_HOME
const DSH_BIN = process.env.DSH_BIN
const MODE = (process.argv[2] ?? 'a').toLowerCase()
const GATE = process.env.ANIM_GATE ?? null

if (!DSH_HOME || !DSH_BIN) throw new Error('需要 DSH_HOME 与 DSH_BIN')
if (MODE !== 'a' && MODE !== 'b') throw new Error('用法：ab-session.mjs a|b')

/**
 * 教学话术（**A/B 逐字相同**，唯一变量是编排）。两套点位：
 *   fifo      —— 排序/对比类：**不随时间变化**，按理该用板书图（第一轮实测模型正是这么选的）
 *   interrupt —— 时序事件类：一个正在跑的进程被时钟打断，**只有动画讲得清**（这是本轮的主场景）
 */
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
const QUESTION = (process.env.AB_QUESTION ?? 'fifo').toLowerCase()
if (QUESTIONS[QUESTION] === undefined) throw new Error(`AB_QUESTION 只能是 ${Object.keys(QUESTIONS).join(' / ')}`)
const PROMPTS = QUESTIONS[QUESTION]

const GAP_MS = Number.parseInt(process.env.AB_TURN_GAP_MS ?? '0', 10)
const SPOKEN_FIRST = process.env.AB_SPOKEN_FIRST === undefined ? null : process.env.AB_SPOKEN_FIRST === '1'
const BLOCKING = process.env.AB_BLOCKING === '1'
const VARIANT_BASE = process.env.AB_CLASSROOM_NOTE === '1' ? `${QUESTION}-note` : QUESTION
const VARIANT = `${VARIANT_BASE}${GAP_MS > 0 ? `-gap${GAP_MS / 1000}s` : ''}${SPOKEN_FIRST === null ? '' : SPOKEN_FIRST ? '-spoken1' : '-spoken0'}${BLOCKING ? '-blocking' : ''}`
const WORK = join(tmpdir(), `animorch-ab-${MODE}-${VARIANT}`)
rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })
const classroom = join(WORK, 'classroom')
execFileSync('rsync', ['-a', `${CLASSROOM_SRC}/`, `${classroom}/`])

/**
 * C/D 组（AB_CLASSROOM_NOTE=1）：**在教室副本里**补一条动画渠道纪律。
 *
 * 🔴 为什么必须有这一件（第一轮实测查出的真原因）：仓库里的教室内容有**5 处**硬纪律
 *    规定"白板内容一律用 classroom_draw 画"，而**一处都没提动画** → 模型两次（fifo / interrupt）
 *    都走板书图，`classroom_animate` 一次都没被调用。
 *    引擎挂上工具 ≠ 老师会用；**"什么时候该用动画"是课程内容的事**，而 `code/classrooms/**`
 *    不在本轮可改范围内 → 只在**副本**里补，仓库教室一个字不动。
 *    写法照抄既有渠道纪律的形态（只规定渠道与顺序，不规定教学时机）。
 */
const CLASSROOM_NOTE = [
  '',
  '- 讲到**随时间变化**的机制（进程被打断又恢复、任务按不同顺序在时间轴上流动、同一段时间轴上读出两个数）时，',
  '  **用 `classroom_animate` 起一段教学动画**，不要用一张静止的图代替：',
  '  **先把这一步讲给学生，再调它**；它立刻返回、渲染在后台跑，好了引擎会在后面的回合开头告诉你，那时再放出来。',
  '  （白板图仍走 `classroom_draw`；两者是不同渠道，不互相替代。）',
  '',
].join('\n')

if (process.env.AB_CLASSROOM_NOTE === '1') {
  const anchorPath = join(classroom, '_anchor.md')
  writeFileSync(anchorPath, `${readFileSync(anchorPath, 'utf8').replace(/\s+$/, '')}\n${CLASSROOM_NOTE}`)
}

// B 组唯一变量：教室多一行 animation 声明
if (MODE === 'b') {
  const manifestPath = join(classroom, 'classroom.yaml')
  const text = readFileSync(manifestPath, 'utf8')
  writeFileSync(manifestPath, `${text.replace(/\s+$/, '')}\n\nanimation:\n  enabled: true\n`)
}

const patchPath = join(WORK, 'patch.yml')
const patchLines = [
  `# ab-session（${MODE} 组）专用 patch：教室指到副本；关掉一进程一回合的 headless runner，改挂多轮 driver。`,
  '- id: socratic-engine',
  '  config:',
  `    classroomDir: ${classroom}`,
]
if (MODE === 'b') {
  patchLines.push(
    '    animation:',
    `      python: ${join(MANIM_ENV, 'bin', 'python')}`,
    `      manim: ${join(MANIM_ENV, 'bin', 'manim')}`,
    '      quality: l',
  )
  if (GATE) patchLines.push(`      gate: ${GATE}`, `      gatePython: ${join(MANIM_ENV, 'bin', 'python')}`)
  if (SPOKEN_FIRST !== null) patchLines.push(`      spokenFirst: ${SPOKEN_FIRST}`)
  if (BLOCKING) patchLines.push('      blocking: true')
}
patchLines.push(
  '- id: headless-runner',
  '  disabled: true',
  '- insert:',
  '    - id: socratic-anim-ab-driver',
  `      name: ${DRIVER}`,
  '',
)
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
  /* driver 可能没写（例如引擎装载就报错）——下面照样落盘，不掩盖 */
}

const out = {
  mode: MODE,
  generatedAt: new Date().toISOString(),
  exit: code,
  wallMs,
  classroom,
  patchPath,
  logFile,
  driverReport,
  prompts: PROMPTS,
  stdoutTail: stdout.slice(-3000),
  stderrTail: stderr.slice(-3000),
}
mkdirSync(EVIDENCE, { recursive: true })
out.question = QUESTION
out.classroomNote = process.env.AB_CLASSROOM_NOTE === '1'
out.turnGapMs = GAP_MS
out.spokenFirst = SPOKEN_FIRST
out.blocking = BLOCKING
writeFileSync(join(EVIDENCE, `ab-${MODE}-${VARIANT}.json`), JSON.stringify(out, null, 2))
console.log(`[ab-${MODE}/${VARIANT}] exit=${code} wall=${(wallMs / 1000).toFixed(1)}s log=${logFile}`)
console.log(`[ab-${MODE}/${VARIANT}] driver: turns=${driverReport?.turnStarts?.length ?? 'n/a'} injections=${driverReport?.injectionUserMessages?.length ?? 'n/a'}`)
console.log(stderr.slice(-1200))
