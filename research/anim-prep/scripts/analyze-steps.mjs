// scripts/analyze-steps.mjs — 把 A/B/A′ 三组的**模型生成段**再拆一层。
//
// 为什么要拆：`ab-template.mjs` 量的 `ms_model` 是「turn/start → 目标工具调用」，
// 它**包含**读教材、组织讲解、画板书图等与"走哪条路"无关的动作。要回答
// "模板化到底省的是哪一段"，得看**产生那次工具调用的那个 step 里，模型生成了多久**：
//   生成时长 = 该 step 的第一次模型产出（tool/call 或 assistant/message）− step/start
// 这一段的差别才是"写 130 行 Python" vs "写 10 行 JSON"。
//
// 用法：/opt/homebrew/bin/node scripts/analyze-steps.mjs
// 产物：evidence/step-breakdown.json

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EVIDENCE, readEvents, timelineOf } from './session.mjs'

const GROUPS = [
  { mode: 'scratch', file: 'ab-template-scratch.json', target: 'write', label: 'A（从零写脚本，未给数字）' },
  { mode: 'scratch2', file: 'ab-template-scratch2.json', target: 'write', label: 'A′（从零写脚本，给了数字）' },
  { mode: 'template', file: 'ab-template-template.json', target: 'classroom_animate_template', label: 'B（填模板参数）' },
]

const out = { generatedAt: new Date().toISOString(), groups: [] }

for (const g of GROUPS) {
  let data
  try {
    data = JSON.parse(readFileSync(join(EVIDENCE, g.file), 'utf8'))
  } catch {
    console.log(`[steps] 跳过 ${g.file}（还没有）`)
    continue
  }
  const rows = []
  for (const r of data.runs) {
    if (r.logFile === undefined || r.logFile === null) continue
    const events = readEvents(r.logFile)
    const tl = timelineOf(events)
    // 每个 step 的起点
    const stepStarts = events.filter((e) => e.type === 'step/start').map((e) => e.time)
    const stepIndexOf = (t) => {
      let idx = -1
      for (let i = 0; i < stepStarts.length; i += 1) if (stepStarts[i] <= t) idx = i
      return idx
    }
    // 目标调用所在 step 的"模型生成时长"
    const call = events.find((e) => e.type === 'tool/call' && (e.data?.name ?? e.data?.toolName) === g.target)
    let genMs = null
    let stepIndex = null
    if (call !== undefined) {
      stepIndex = stepIndexOf(call.time)
      if (stepIndex >= 0) {
        // 该 step 内的第一次模型产出
        const firstOut = events.find(
          (e) =>
            (e.type === 'tool/call' || e.type === 'assistant/message') && e.time >= stepStarts[stepIndex] && e.time <= call.time,
        )
        genMs = firstOut === undefined ? null : firstOut.time - stepStarts[stepIndex]
      }
    }
    // 逐 step 明细（工具名 + 该 step 的模型生成时长 + 模型输出字符数）——
    // 这是"省的是哪一段"的直接证据：见报告 §1.4 的发现（省的是**设计那一段**，不是打字那一段）。
    const stepsDetail = stepStarts.map((s, i) => {
      const end = i + 1 < stepStarts.length ? stepStarts[i + 1] : null
      const inside = events.filter(
        (e) =>
          e.time >= s &&
          (end === null || e.time < end) &&
          ['tool/call', 'assistant/message'].includes(e.type),
      )
      const first = inside[0]
      return {
        step: i + 1,
        startMs: s - (tl.t_turn_start ?? s),
        genMs: first === undefined ? null : first.time - s,
        tools: inside.filter((e) => e.type === 'tool/call').map((e) => e.data?.name ?? e.data?.toolName),
        msgChars: inside
          .filter((e) => e.type === 'assistant/message')
          .reduce((acc, e) => acc + JSON.stringify(e.data ?? {}).length, 0),
      }
    })
    rows.push({
      run: r.run,
      mode: r.mode,
      ms_model: r.ms_model,
      ms_end_to_end: r.ms_end_to_end,
      targetStepIndex: stepIndex,
      targetStepGenMs: genMs,
      targetArgChars: r.targetCallArgChars,
      steps: tl.steps,
      stepsDetail,
      totalStepGenMs: (() => {
        // 全部 step 的生成合计（口径同上），用来看"整轮里模型生成占多少"
        let sum = 0
        for (let i = 0; i < stepStarts.length; i += 1) {
          const end = i + 1 < stepStarts.length ? stepStarts[i + 1] : null
          const first = events.find(
            (e) =>
              (e.type === 'tool/call' || e.type === 'assistant/message') &&
              e.time >= stepStarts[i] &&
              (end === null || e.time < end),
          )
          if (first !== undefined) sum += first.time - stepStarts[i]
        }
        return sum
      })(),
      ready: r.ready,
      scriptChars: r.mode.startsWith('scratch')
        ? (() => {
            try {
              return readFileSync(join(r.classroom, '..', 'scene.py'), 'utf8').length
            } catch {
              return null
            }
          })()
        : null,
    })
  }
  out.groups.push({ ...g, rows })
  for (const r of rows) {
    console.log(
      `[steps] ${g.mode} run${r.run} 模型段=${(r.ms_model / 1000).toFixed(1)}s ` +
        `目标step生成=${r.targetStepGenMs === null ? 'n/a' : (r.targetStepGenMs / 1000).toFixed(1) + 's'} ` +
        `全轮生成合计=${(r.totalStepGenMs / 1000).toFixed(1)}s 入参=${r.targetArgChars ?? 'n/a'}字符 ` +
        `脚本=${r.scriptChars ?? 'n/a'}字符`,
    )
  }
}

mkdirSync(EVIDENCE, { recursive: true })
writeFileSync(join(EVIDENCE, 'step-breakdown.json'), JSON.stringify(out, null, 2))
console.log('[steps] 已落盘 evidence/step-breakdown.json')
