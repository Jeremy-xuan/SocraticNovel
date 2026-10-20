// gen_and_render.mjs — 模板层自检：把 3 个模板用**真实教材场景**的参数各生成一份脚本，
// 逐个跑真 manim，量渲染墙钟，并把生成的脚本原文留档。
//
// 为什么先做这一步（不做就别谈"模板能省时间"）：模板这条路的风险**不在参数校验**，
// 而在"引擎拼出来的脚本到底能不能渲出学生看得懂的画面"。所以先证明能渲，
// 再谈省了多少秒（省时对照见 measure/ab-template.mjs）。
//
// 用法：/opt/homebrew/bin/node scripts/gen_and_render.mjs
// 产物：tmp/scenes/*.py（生成的脚本原文）、tmp/render/*.mp4、evidence/template_render.json

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkTemplateArgs } from '../../../plugins/socratic-engine/lib/animtemplates.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const toolRoot = resolve(here, '..')
const repoRoot = resolve(toolRoot, '../../..')
const MANIM = join(repoRoot, 'poc_动画可写性', 'env', 'bin', 'manim')
const TMP = join(toolRoot, 'tmp')

/**
 * 真实教学场景（取自 cs-os 教材第 3 讲"调度"）：
 * 三个任务 0 时刻同时到达，A 需 100 个单位、B、C 各需 10 个单位。
 * 🔴 数值是按题设假设算出的**示例数据**，不是教材统计数据（与 PoC 的 B_P3.py 同一口径）。
 */
const CASES = [
  {
    name: 'timeline_fifo_vs_sjf',
    template: 'timeline',
    title: '长任务怎么堵住短任务？',
    params: {
      note: '周转时间 = 完成时刻 − 到达时刻',
      lanes: [
        {
          label: '先到先服务（FIFO）：A → B → C',
          segments: [
            { start: 0, end: 100, label: 'A', color: 'blue', endLabel: '100' },
            { start: 100, end: 110, label: 'B', color: 'amber', endLabel: '110' },
            { start: 110, end: 120, label: 'C', color: 'green', endLabel: '120' },
          ],
        },
        {
          label: '最短作业优先（SJF）：B → C → A',
          segments: [
            { start: 0, end: 10, label: 'B', color: 'amber', endLabel: '10' },
            { start: 10, end: 20, label: 'C', color: 'green', endLabel: '20' },
            { start: 20, end: 120, label: 'A', color: 'blue', endLabel: '120' },
          ],
        },
      ],
    },
  },
  {
    name: 'state_machine_process',
    template: 'state_machine',
    title: '一个进程的一生：三态怎么走',
    params: {
      note: '同一时刻只能有一个进程在运行态',
      states: [
        { id: 'ready', label: '就绪' },
        { id: 'running', label: '运行' },
        { id: 'blocked', label: '阻塞' },
      ],
      transitions: [
        { from: 'ready', to: 'running', label: '被调度' },
        { from: 'running', to: 'ready', label: '时间片到' },
        { from: 'running', to: 'blocked', label: '等 I/O' },
        { from: 'blocked', to: 'ready', label: 'I/O 完成' },
      ],
      walk: ['ready', 'running', 'blocked', 'ready'],
    },
  },
  {
    name: 'bar_compare_avg_turnaround',
    template: 'bar_compare',
    title: '三种调度的平均周转时间',
    params: {
      note: '同一批任务、同样的到达时刻，只换调度顺序',
      unit: '时间单位',
      items: [
        { label: 'FIFO', value: 96.7 },
        { label: 'SJF', value: 50.0 },
        { label: '时间片轮转', value: 110.0 },
      ],
      highlight: 'SJF',
    },
  },
]

const rows = []
rmSync(join(TMP, 'scenes'), { recursive: true, force: true })
rmSync(join(TMP, 'render'), { recursive: true, force: true })
mkdirSync(join(TMP, 'scenes'), { recursive: true })
mkdirSync(join(TMP, 'render'), { recursive: true })

for (const c of CASES) {
  const check = checkTemplateArgs({ template: c.template, params: c.params, title: c.title })
  if (!check.ok) {
    rows.push({ case: c.name, ok: false, problems: check.problems })
    console.log(`[gen] ${c.name} 🔴 参数校验不过：\n- ${check.problems.join('\n- ')}`)
    continue
  }
  const scriptPath = join(TMP, 'scenes', `${c.name}.py`)
  writeFileSync(scriptPath, check.script)
  const mediaDir = join(TMP, 'render', c.name)
  const t0 = Date.now()
  let ok = true
  let stderr = ''
  try {
    execFileSync(
      MANIM,
      ['-ql', '--disable_caching', '--media_dir', mediaDir, '-o', `${c.name}.mp4`, scriptPath, check.sceneClass],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 },
    )
  } catch (cause) {
    ok = false
    stderr = String(cause?.stderr ?? cause?.message ?? cause).slice(-2500)
  }
  const renderMs = Date.now() - t0
  const mp4 = join(mediaDir, 'videos', c.name, '480p15', `${c.name}.mp4`)
  let bytes = null
  try {
    bytes = statSync(mp4).size
  } catch {
    bytes = null
  }
  rows.push({
    case: c.name,
    template: c.template,
    templateVersion: check.templateVersion,
    ok: ok && bytes !== null,
    renderMs,
    bytes,
    scriptLines: check.lines,
    scriptBytes: check.bytes,
    scriptPath,
    mp4: bytes === null ? null : mp4,
    stderrTail: stderr,
  })
  console.log(
    `[gen] ${c.name} ${ok && bytes !== null ? '✅' : '🔴'} render=${(renderMs / 1000).toFixed(2)}s ` +
      `脚本 ${check.lines} 行/${check.bytes}B 产物 ${bytes === null ? '无' : Math.round(bytes / 1024) + 'KB'}`,
  )
  if (stderr !== '') console.log(stderr)
}

const out = {
  generatedAt: new Date().toISOString(),
  manim: MANIM,
  note: '数值为按题设假设算出的示例数据，不是教材统计数据',
  cases: rows,
}
writeFileSync(join(toolRoot, 'evidence', 'template_render.json'), JSON.stringify(out, null, 2))
console.log(`[gen] 已落盘 evidence/template_render.json`)
// 顺便把第一份脚本的头 12 行打出来，便于人工确认形状
try {
  console.log(readFileSync(join(TMP, 'scenes', `${CASES[0].name}.py`), 'utf8').split('\n').slice(0, 14).join('\n'))
} catch {
  /* 没有就没有 */
}
