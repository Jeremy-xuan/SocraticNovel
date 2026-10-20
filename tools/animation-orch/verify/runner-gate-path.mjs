// runner-gate-path.mjs — 用**真的渲染器**（lib/animation-runner.py）端到端跑通三种结局。
//
// 为什么必须有这一件：编排设计里"失败怎么办"占一整节，而"失败"必须**真发生过**才算数。
// 三条路径各用一段**真实存在**的脚本：
//   ① ready   —— PoC 里被评为「能用」的脚本（B_P3）
//   ② failed  —— 会真的崩在 LaTeX 上的脚本（`NumberLine(include_numbers=True)`，
//                PoC 对照轮实测踩过、逐字报错 FileNotFoundError: 'latex'）
//   ③ blocked —— PoC 里被评为「不能用」的脚本（raw2/C_P1，画面成片文字重叠）→ 过质量闸门
//
// 🔴 闸门（code/tools/animation-gate/）是**另一条工作线**的产物：本脚本只按命令行契约调用它，
//    它不可用时**如实记录"闸门没能跑起来"**，不假装通过、也不改它的代码。
//
// 用法：/opt/homebrew/bin/node verify/runner-gate-path.mjs
// 产物：evidence/runner-paths.json（逐条 status.json 原文）

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renameSync } from 'node:fs'

import { startAnimationTask, readTask } from '../../../plugins/socratic-engine/lib/animationstore.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const toolRoot = resolve(here, '..')
const repoRoot = resolve(toolRoot, '../../..')
const POC = join(repoRoot, 'poc_动画可写性')
const ENV = join(POC, 'env')
const GATE = join(repoRoot, 'code', 'tools', 'animation-gate', 'animation_gate.py')
const EVIDENCE = join(toolRoot, 'evidence')

/** 真 fs 的原子写（等价于宿主 dsh-atomic-write 的语义：临时文件 + rename）。 */
const io = {
  async writeFileAtomic(file, content, opts = {}) {
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, content, { mode: opts.mode ?? 0o600 })
    renameSync(tmp, file)
  },
  async withFileLock(_f, fn) {
    return fn()
  },
}

const WORK = join(tmpdir(), 'animorch-runner-paths')
rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })

/** 会崩在 LaTeX 上的脚本（PoC 对照轮真实踩过的那一行）——预检就该在起渲染前拒掉它。 */
const LATEX_SCRIPT = [
  'from manim import *',
  '',
  'class LatexTrap(Scene):',
  '    def construct(self):',
  '        nl = NumberLine(x_range=[0, 120, 20], length=10, include_numbers=True)',
  '        self.play(Create(nl))',
  '        self.wait(1)',
].join('\n')

/** 预检过得去、但**真渲染会失败**的脚本（运行期 NameError，manim 会带栈退出）。 */
const RUNTIME_ERROR_SCRIPT = [
  'from manim import *',
  '',
  'class Boom(Scene):',
  '    def construct(self):',
  '        t = Text("这一行没问题", font="PingFang SC")',
  '        self.play(Write(t))',
  '        self.play(Write(this_name_does_not_exist))',
].join('\n')

const CASES = [
  {
    key: 'ready',
    title: 'FIFO 让长任务堵住短任务（PoC 判定「能用」的脚本）',
    scriptFile: join(POC, 'raw', 'B_P3.py'),
    gate: false,
  },
  {
    key: 'precheck-refused',
    title: '用了 LaTeX 的脚本 —— 应在**起渲染之前**被结构性预检拒掉',
    script: LATEX_SCRIPT,
    gate: false,
  },
  {
    key: 'failed',
    title: '运行期报错的脚本 —— 渲染真的失败，状态必须是 failed 并带原因',
    script: RUNTIME_ERROR_SCRIPT,
    gate: false,
  },
  {
    key: 'blocked',
    title: 'PoC 判定「不能用」的脚本（画面成片文字重叠）→ 过质量闸门',
    scriptFile: join(POC, 'raw2', 'C_P1.py'),
    gate: true,
  },
]

const results = []
for (const c of CASES) {
  const script = c.script ?? readFileSync(c.scriptFile, 'utf8')
  const runtimeDir = join(WORK, c.key, 'runtime')
  mkdirSync(runtimeDir, { recursive: true })
  let started
  try {
    started = await startAnimationTask(
      { script, title: c.title },
      {
        runtimeDir,
        lesson: 3,
        turn: 2,
        python: join(ENV, 'bin', 'python'),
        manim: join(ENV, 'bin', 'manim'),
        quality: 'l',
        gate: c.gate && existsSync(GATE) ? GATE : null,
        // 闸门要 numpy/PIL/scipy：用 PoC 那个 venv 的 python（已装，且**不新增依赖**）
        gatePython: join(ENV, 'bin', 'python'),
        io,
        // 这一件**故意用同步对照模式**：本脚本要的是"跑到底看结局"，不是编排效果
        blocking: true,
        blockingTimeoutMs: 300000,
      },
    )
  } catch (error) {
    results.push({ key: c.key, error: String(error?.message ?? error) })
    console.log(`[runner] ${c.key} 起任务就失败：${error?.message ?? error}`)
    continue
  }
  const rec = await readTask(started.dir)
  const row = {
    key: c.key,
    title: c.title,
    source: c.scriptFile ?? '(内联脚本)',
    gateConfigured: c.gate && existsSync(GATE),
    taskId: started.taskId,
    dir: started.dir,
    state: rec?.status?.state ?? null,
    status: rec?.status ?? null,
  }
  results.push(row)
  console.log(
    `[runner] ${c.key}: state=${row.state}｜renderMs=${rec?.status?.renderMs ?? 'n/a'}｜` +
      `durationSec=${rec?.status?.durationSec ?? 'n/a'}｜gate=${rec?.status?.gate?.verdict ?? (rec?.status?.gateRan === false ? '未跑' : 'n/a')}` +
      (rec?.status?.reason ? `｜reason=${rec.status.reason}` : ''),
  )
}

mkdirSync(EVIDENCE, { recursive: true })
writeFileSync(join(EVIDENCE, 'runner-paths.json'), JSON.stringify({ generatedAt: new Date().toISOString(), work: WORK, results }, null, 2))
console.log(`[runner] 落盘 ${join(EVIDENCE, 'runner-paths.json')}`)
void execFileSync
