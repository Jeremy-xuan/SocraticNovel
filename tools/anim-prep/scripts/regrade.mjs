// scripts/regrade.mjs — **重新判定已有实验的产物**（零 LLM 成本）。
//
// 为什么要有它：`ab-template.mjs` 第一版把 manim 的产物路径猜错了（按 `-o a.mp4` 猜成
// `videos/a/480p15/a.mp4`，实际是 `videos/<脚本名>/480p15/`），于是"渲出来了却判成没渲出来"。
// 重跑会话要再花模型钱，而**模型段的时间早就量好了、与产物路径无关**——
// 所以只重新渲染 + 过闸门 + 重判 ready，不动任何模型调用。
//
// 用法：/opt/homebrew/bin/node scripts/regrade.mjs scratch
// 产物：覆盖 evidence/ab-template-scratch.json 里的 ready/renderMs/gateState/artifact，并留一列 regradedAt

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EVIDENCE, MANIM_ENV, findMp4, readEvents, repoRoot, timelineOf, toolCallArgs } from './session.mjs'

const MODE = process.argv[2] ?? 'scratch'
const GATE = join(repoRoot, 'code', 'tools', 'animation-gate', 'animation_gate.py')
const file = join(EVIDENCE, `ab-template-${MODE}.json`)
const data = JSON.parse(readFileSync(file, 'utf8'))
const TARGET = String(MODE).startsWith('scratch') ? 'write' : 'classroom_animate_template'

function sceneClassOf(script) {
  const names = [...script.matchAll(/^class\s+([A-Za-z_]\w*)\s*\(\s*([A-Za-z_][\w.]*)\s*\)/gm)]
    .filter((m) => /Scene/.test(m[2]))
    .map((m) => m[1])
  return names.length === 0 ? null : names[names.length - 1]
}

for (const row of data.runs) {
  // 🔴 顺手**从会话日志重算 ms_model**（零模型成本）：判据写错导致某一组数全空时，
  //    没必要重跑会话——原始事件流还在盘上，重算即可。
  if (row.logFile) {
    try {
      const tl = timelineOf(readEvents(row.logFile))
      const call = tl.toolCalls.find((c) => c.name === TARGET)
      row.ms_model = call === undefined ? null : call.atMs
      row.targetCallArgChars = call?.argChars ?? null
      const args = toolCallArgs(readEvents(row.logFile), TARGET)
      row.targetArgsPreview = args === null ? null : JSON.stringify(args).slice(0, 400)
      row.recomputedFromLog = new Date().toISOString()
    } catch (cause) {
      row.recomputeError = String(cause?.message ?? cause)
    }
  }
  if (!String(row.mode).startsWith('scratch') || row.classroom === undefined) {
    // B 组（模板）：把"引擎那条任务从起来到就绪"的**总耗时**补上。
    // 🔴 口径：`status.finishedAt − task.createdAt`（含渲染 ＋ 闸门 ＋ 进程启动），
    //    不是 `status.renderMs`——后者只有 manim 那一段。第一版把闸门时间当成 `gate.gateMs`
    //    取（status.json 里根本没有这个字段）→ 端到端少算了十几秒（本批踩过一次）。
    if (row.classroom !== undefined) {
      const animRoot = join(row.classroom, 'runtime', 'animations')
      if (existsSync(animRoot)) {
        for (const name of readdirSync(animRoot)) {
          const taskFile = join(animRoot, name, 'task.json')
          const statusFile = join(animRoot, name, 'status.json')
          if (!existsSync(taskFile) || !existsSync(statusFile)) continue
          const task = JSON.parse(readFileSync(taskFile, 'utf8'))
          const status = JSON.parse(readFileSync(statusFile, 'utf8'))
          if (status.state !== 'ready' && status.state !== 'blocked') continue
          row.taskId = name
          row.taskElapsedMs = status.finishedAt - task.createdAt
          row.renderMs = status.renderMs
          row.gateState = status.gate?.verdict ?? null
          row.gateRan = status.gate?.ran ?? false
          row.artifact = join(animRoot, name, status.mp4 ?? `${name}.mp4`)
          row.ready = status.state === 'ready' && status.gate?.verdict === 'PASS'
          row.ms_end_to_end = row.ms_model === null ? null : row.ms_model + row.taskElapsedMs
          console.log(
            `[regrade] ${row.mode} run${row.run} 模型段=${(row.ms_model / 1000).toFixed(1)}s ` +
              `任务总耗时=${(row.taskElapsedMs / 1000).toFixed(1)}s（渲染 ${status.renderMs} ms）` +
              `闸门=${row.gateState} 端到端=${(row.ms_end_to_end / 1000).toFixed(1)}s ready=${row.ready}`,
          )
        }
      }
    }
    continue
  }
  const work = join(row.classroom, '..')
  const out = join(work, 'scene.py')
  if (!existsSync(out)) {
    row.regraded = '脚本不存在'
    continue
  }
  const mediaDir = join(work, 'media2')
  const t0 = Date.now()
  let renderError = null
  try {
    execFileSync(
      join(MANIM_ENV, 'bin', 'manim'),
      ['-ql', '--disable_caching', '--media_dir', mediaDir, '-o', 'a.mp4', out, sceneClassOf(readFileSync(out, 'utf8'))],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 },
    )
  } catch (cause) {
    renderError = String(cause?.stderr ?? cause?.message ?? cause).slice(-800)
  }
  const renderMs = Date.now() - t0
  const mp4 = findMp4(mediaDir)
  let gate = null
  if (mp4 !== null) {
    const gt0 = Date.now()
    let stdout = ''
    try {
      stdout = execFileSync(join(MANIM_ENV, 'bin', 'python'), [GATE, mp4, '--script', out, '--out', join(work, 'gate2')], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 300000,
      }).toString()
    } catch (cause) {
      stdout = String(cause?.stdout ?? cause?.message ?? cause)
    }
    gate = {
      state: stdout.includes('→ PASS') ? 'PASS' : stdout.includes('→ BLOCK') ? 'BLOCK' : 'UNKNOWN',
      gateMs: Date.now() - gt0,
      tail: stdout.trim().split('\n').slice(-5).join('\n'),
    }
  }
  row.regradedAt = new Date().toISOString()
  row.renderMs = renderMs
  row.renderError = renderError
  row.artifact = mp4
  row.gateState = gate === null ? null : gate.state
  row.gateTail = gate === null ? null : gate.tail
  row.gateMs = gate === null ? null : gate.gateMs
  row.ready = mp4 !== null && gate !== null && gate.state === 'PASS'
  row.ms_end_to_end = row.ms_model === null ? null : row.ms_model + renderMs + (gate?.gateMs ?? 0)
  console.log(
    `[regrade] run${row.run} 模型段=${row.ms_model === null ? 'n/a' : (row.ms_model / 1000).toFixed(1) + 's'} ` +
      `渲染=${(renderMs / 1000).toFixed(1)}s 闸门=${gate === null ? 'n/a' : (gate.gateMs / 1000).toFixed(1) + 's ' + gate.state} ` +
      `ready=${row.ready}`,
  )
  if (renderError !== null) console.log(renderError)
}
mkdirSync(EVIDENCE, { recursive: true })
writeFileSync(file, JSON.stringify(data, null, 2))
console.log(`[regrade] 已更新 ${file}`)
