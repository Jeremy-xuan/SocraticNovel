// scripts/ab-template.mjs — 实验①：**模板化到底省多少**（A＝从零写脚本 vs B＝填参数）。
//
// 为什么这么设计（口径写死，防事后凑）：
//   · 同一个教学场景（cs-os 第 3 讲「FIFO 为什么把短任务堵住」）、同一个模型、同一个教室副本；
//   · **唯一变量**＝老师走哪条路：
//       A：自己把这一段的 ManimCE 脚本逐行写出来（＝现状 classroom_animate 那条路）
//       B：调 classroom_animate_template，只填模板 id ＋ params（＝模板那条路）
//   · 量两个数：
//       ① **模型段**（学生/老师真正要等的那一段）＝ turn/start → 目标工具调用落盘；
//       ② **端到端到"可播"** ＝ 模型段 ＋ 渲染 ＋ 闸门（A 的片子现场渲；B 的片子由引擎在后台渲）。
//   · 成功率也量：A＝脚本文件落盘且能渲出 mp4 且过闸门；B＝引擎起的任务到 ready。
//
// 🔴 不写真教室：教室是 `rsync -a` 到 /tmp 的副本；所有产物都在副本的 runtime/ 下。
//
// 用法：/opt/homebrew/bin/node scripts/ab-template.mjs scratch|template [次数]
// 产物：evidence/ab-template-<mode>.json ＋ tmp/ab-<mode>/ 下的会话日志与产物

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  CLASSROOM_SRC,
  EVIDENCE,
  MANIM_ENV,
  engineLogLines,
  findMp4,
  makeClassroomCopy,
  repoRoot,
  runSession,
  toolCallArgs,
  writePatch,
} from './session.mjs'

const MODE = (process.argv[2] ?? 'scratch').toLowerCase()
const RUNS = Number.parseInt(process.argv[3] ?? '2', 10)
if (!['scratch', 'template', 'scratch2'].includes(MODE)) {
  throw new Error('用法：ab-template.mjs scratch|scratch2|template [次数]')
}

const GATE = join(repoRoot, 'code', 'tools', 'animation-gate', 'animation_gate.py')

/** 同一个教学场景（第 3 讲：FIFO 为什么把长任务堵住后面的短任务）。 */
const SCENARIO = '开始第 3 讲。学生问：「为什么 FIFO 会让一个很长的任务把后面短的任务全堵住？」'

/**
 * 🔴 三组的**唯一变量**是"老师走哪条路"，但第一版有个方法论缺陷，这里补一组修掉：
 *    · `scratch`（A 组，＝现状）：prompt 里**没有给具体数字**，模型自己设计例子；
 *    · `template`（B 组）：prompt 里**给了具体数字**（模板参数必须写出来），模型只需填参；
 *    · `scratch2`（A′ 组，**本批新增的公平对照**）：与 B 组**逐字相同的条件信息**，
 *      但要求"自己逐行写脚本"。
 *    → **A vs B 的差里混着"少想了一点"**；**A′ vs B 才是纯的"写代码 vs 填参数"**。
 *      两组都要报（本批的诚实口径：不许只报对自己有利的那组）。
 */
const DATA_CLAUSE =
  '题目条件：三个任务都在 0 时刻到达，A 需 100 个时间单位，B、C 各需 10 个；' +
  '画「先到先服务 A→B→C」与「最短作业优先 B→C→A」两条时间轴对比。'

const PROMPTS = {
  scratch:
    `${SCENARIO}请按你的教学判断讲这一小段，并且**把这一段要放的动画脚本写成一个完整的 ManimCE 0.21.0 Python 文件**` +
    `保存到 {OUT}（用 write 工具一次写完，文件里必须有一个 Scene 子类，中文用 font="PingFang SC"，` +
    `本机没装 LaTeX 所以不要用 Tex/MathTex，脚本不超过 200 行）。写完再用一句话回复学生。`,
  scratch2:
    `${SCENARIO}请按你的教学判断讲这一小段。${DATA_CLAUSE}` +
    `**把这一段要放的动画脚本写成一个完整的 ManimCE 0.21.0 Python 文件**保存到 {OUT}` +
    `（用 write 工具一次写完，文件里必须有一个 Scene 子类，中文用 font="PingFang SC"，` +
    `本机没装 LaTeX 所以不要用 Tex/MathTex，脚本不超过 200 行）。写完再用一句话回复学生。`,
  template:
    `${SCENARIO}这一段要用教学动画讲，**请你调用 classroom_animate_template 工具**（不要自己写 Manim 代码）：` +
    `从模板里挑一个最合适的（timeline / state_machine / bar_compare），填好 params 与 title。` +
    `${DATA_CLAUSE}调完工具再用一句话回复学生。`,
}

const OUT_ROOT = join(tmpdir(), `animprep-ab-${MODE}`)

/** 等引擎起的渲染器写出终态（B 组用；最多等 60 s）。 */
function waitForTerminal(animRoot, timeoutMs = 60000) {
  const t0 = Date.now()
  for (;;) {
    if (existsSync(animRoot)) {
      for (const name of readdirSync(animRoot)) {
        const statusFile = join(animRoot, name, 'status.json')
        if (!existsSync(statusFile)) continue
        try {
          const s = JSON.parse(readFileSync(statusFile, 'utf8'))
          if (['ready', 'blocked', 'failed'].includes(s.state)) return { taskId: name, status: s, waitedMs: Date.now() - t0 }
        } catch {
          /* 半截文件，继续等 */
        }
      }
    }
    if (Date.now() - t0 > timeoutMs) return null
    execFileSync('sleep', ['0.3'])
  }
}

async function runOnce(i) {
  const work = join(OUT_ROOT, `run${i + 1}`)
  const classroom = makeClassroomCopy(work)
  const out = join(work, 'scene.py')
  const patchPath = writePatch(work, {
    classroom,
    animation: true,
    extraLines: [
      `      gate: ${GATE}`,
      `      gatePython: ${join(MANIM_ENV, 'bin', 'python')}`,
    ],
  })
  const task = PROMPTS[MODE].replace('{OUT}', out)
  const session = await runSession({ workDir: work, patchPath, task, cwd: classroom })

  const animRoot = join(classroom, 'runtime', 'animations')
  // 🔴 判据按**前缀**判，不写死 `MODE === 'scratch'`：加 A′ 组时漏改这一行，
  //    结果 A′ 两轮全被记成 ms_model=n/a（模型明明调了 write，是判据没跟上）。
  //    教训：分支条件写死单个取值，会在加组时**静默失效**（不报错，只是数全空）。
  const targetTool = MODE.startsWith('scratch') ? 'write' : 'classroom_animate_template'
  const call = session.timeline?.toolCalls.find((c) => c.name === targetTool) ?? null
  const args = toolCallArgs(session.events ?? [], targetTool)

  // 成功判定
  let artifact = null
  let renderMs = null
  let gate = null
  let ready = null
  if (MODE === 'scratch') {
    const exists = existsSync(out)
    const hasScene = exists && /^class\s+\w+\s*\(\s*Scene\s*\)/m.test(readFileSync(out, 'utf8'))
    let mp4 = null
    if (hasScene) {
      const mediaDir = join(work, 'media')
      const t0 = Date.now()
      try {
        execFileSync(
          join(MANIM_ENV, 'bin', 'manim'),
          ['-ql', '--disable_caching', '--media_dir', mediaDir, '-o', 'a.mp4', out, sceneClassOf(readFileSync(out, 'utf8'))],
          { stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 },
        )
      } catch {
        /* 渲染失败如实记 */
      }
      renderMs = Date.now() - t0
      mp4 = findMp4(mediaDir)
      if (mp4 !== null) gate = runGate(mp4, out, join(work, 'gate'))
    }
    ready = hasScene && mp4 !== null && gate !== null && gate.state === 'PASS'
    artifact = mp4
  } else {
    const settled = waitForTerminal(animRoot)
    ready = settled !== null && settled.status.state === 'ready'
    artifact = settled === null ? null : join(animRoot, settled.taskId, settled.status.mp4 ?? `${settled.taskId}.mp4`)
    renderMs = settled?.status?.renderMs ?? null
    gate = settled?.status?.gate ?? null
  }

  const row = {
    run: i + 1,
    mode: MODE,
    exit: session.code,
    wallMs: session.wallMs,
    // ① 模型段：turn/start → 目标工具调用
    ms_model: call === null ? null : call.atMs,
    // ② 端到端到"可播"
    ms_end_to_end: call === null ? null : (call.atMs ?? 0) + (renderMs ?? 0) + (gate?.gateMs ?? 0),
    targetTool,
    targetCallArgChars: call?.argChars ?? null,
    targetArgsPreview: args === null ? null : JSON.stringify(args).slice(0, 400),
    toolNames: session.timeline?.toolNames ?? null,
    steps: session.timeline?.steps ?? null,
    ms_to_first_assistant: session.timeline?.ms_to_first_assistant ?? null,
    ready,
    renderMs,
    gateState: gate === null || gate === undefined ? null : (gate.state ?? gate.verdict ?? null),
    artifact,
    classroom,
    logFile: session.logFile,
    engineLog: engineLogLines(session.stderr).slice(-25),
    stderrTail: session.stderr.slice(-1200),
  }
  writeFileSync(join(work, 'row.json'), JSON.stringify(row, null, 2))
  console.log(
    `[ab-${MODE}] run${i + 1} exit=${session.code} 模型段=${row.ms_model === null ? 'n/a' : (row.ms_model / 1000).toFixed(1) + 's'} ` +
      `端到端=${row.ms_end_to_end === null ? 'n/a' : (row.ms_end_to_end / 1000).toFixed(1) + 's'} ` +
      `入参=${row.targetCallArgChars ?? 'n/a'} 字符 ready=${ready} 闸门=${row.gateState}`,
  )
  return row
}

function sceneClassOf(script) {
  const names = [...script.matchAll(/^class\s+([A-Za-z_]\w*)\s*\(\s*([A-Za-z_][\w.]*)\s*\)/gm)]
    .filter((m) => /Scene/.test(m[2]))
    .map((m) => m[1])
  return names.length === 0 ? null : names[names.length - 1]
}

/** 跑质量闸门（只读调用；闸门本身是另一条工作线的产物）。 */
function runGate(mp4, script, outDir) {
  const t0 = Date.now()
  let stdout = ''
  try {
    stdout = execFileSync(join(MANIM_ENV, 'bin', 'python'), [GATE, mp4, '--script', script, '--out', outDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300000,
    }).toString()
  } catch (cause) {
    stdout = String(cause?.stdout ?? cause?.message ?? cause)
  }
  const gateMs = Date.now() - t0
  const state = stdout.includes('→ PASS') ? 'PASS' : stdout.includes('→ BLOCK') ? 'BLOCK' : 'UNKNOWN'
  return { state, gateMs, tail: stdout.trim().split('\n').slice(-4).join('\n') }
}

const rows = []
for (let i = 0; i < RUNS; i += 1) {
  try {
    rows.push(await runOnce(i))
  } catch (error) {
    rows.push({ run: i + 1, mode: MODE, error: String(error?.message ?? error) })
    console.log(`[ab-${MODE}] run${i + 1} 失败：${error?.message ?? error}`)
  }
}
mkdirSync(EVIDENCE, { recursive: true })
const outFile = join(EVIDENCE, `ab-template-${MODE}.json`)
writeFileSync(
  outFile,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      mode: MODE,
      scenario: SCENARIO,
      prompt: PROMPTS[MODE],
      classroomSrc: CLASSROOM_SRC,
      runs: rows,
    },
    null,
    2,
  ),
)
console.log(`[ab-${MODE}] 已落盘 ${outFile}`)
