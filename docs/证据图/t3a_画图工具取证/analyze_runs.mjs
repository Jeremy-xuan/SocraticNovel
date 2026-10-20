// analyze_runs.mjs — 从会话日志**重新计算**每次真实会话的可核事实（不依赖 tmp/t3a_ab.mjs 的即时统计）。
//
// 为什么单独一份：驱动脚本里的 assistant 文本抽取口径一开始取错了字段
// （宿主把消息放在 `event.data.message.content`，不是 `event.data.content`）→ 事后按**日志原文**
// 重算一遍，并把每次的判定理由逐条落盘（判据可复核，不靠"我记得当时是这样"）。
//
// 判据（先写死）：
//   · 基础设施失败：turn/end.reason.kind === 'error'（例：PI_AI_ERROR unexpected EOF）→ 该次不计入行为统计
//   · 调用率 = 该组有效次数里"至少调用过一次 classroom_draw"的次数 / 有效次数
//   · 入参合法率 = classroom_draw 的 tool/result 里 isError=false 的次数 / classroom_draw 调用次数
//   · ASCII 交差：最后一次 assistant 正文里出现制表符边框字符（─│┌┐└┘├┤┬┴┼）
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = '/Users/wujunjie/Documents/ChatGPT/大学申请'
const EVIDENCE = join(ROOT, '开源线/DSH定制/t3a_画图工具取证')
const runs = readFileSync(join(EVIDENCE, 'runs.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l))

const BOX = /[─│┌┐└┘├┤┬┴┼═║╔╗╚╝]/

function analyze(run) {
  if (!run.sessionFile) return { ...run, analysis: { error: '无会话日志' } }
  const raw = execFileSync('zstd', ['-dc', run.sessionFile], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8')
  const events = raw.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).map((l) => {
    try { return JSON.parse(l) } catch { return null }
  }).filter(Boolean)

  const steps = new Set()
  const calls = []
  const results = []
  /** callId → 工具名（tool/result 的 block 不带 name，只能靠 callId 回配，口径同 lib/postclass.mjs） */
  const nameByCallId = new Map()
  let lastAssistantText = ''
  let allAssistantText = ''
  let turnEnd = null
  for (const e of events) {
    if (e.type === 'turn/end') turnEnd = e.data?.reason ?? null
    if (e.type === 'assistant/message') {
      steps.add(e.data?.step)
      for (const b of e.data?.message?.content ?? []) {
        if (b?.type === 'text' && typeof b.text === 'string') {
          allAssistantText += b.text
          lastAssistantText = b.text
        }
      }
    }
    if (e.type === 'tool/call') {
      const callId = e.data?.callId ?? null
      if (callId !== null) nameByCallId.set(callId, e.data?.name ?? null)
      calls.push({ callId, name: e.data?.name ?? null, args: e.data?.arguments ?? null })
    }
    if (e.type === 'tool/result') {
      const block = e.data?.message?.content?.[0]
      const callId = block?.toolCallId ?? e.data?.message?.source?.callId ?? null
      results.push({
        callId,
        name: nameByCallId.get(callId) ?? null,
        isError: block?.isError === true,
        text: block?.text ?? '',
      })
    }
  }
  const drawResults = results.filter((r) => r.name === 'classroom_draw')
  return {
    group: run.group,
    run: run.run,
    sessionId: run.sessionId,
    steps: steps.size,
    turnEnd,
    infraError: turnEnd?.kind === 'error',
    toolCalls: calls.length,
    toolNames: calls.map((c) => c.name),
    drawCalls: calls.filter((c) => c.name === 'classroom_draw').length,
    drawArgs: calls.filter((c) => c.name === 'classroom_draw').map((c) => c.args),
    drawResults: drawResults.map((r) => ({ isError: r.isError, head: String(r.text).slice(0, 300) })),
    newDiagrams: run.newDiagrams,
    assistantChars: allAssistantText.length,
    lastAssistantChars: lastAssistantText.length,
    asciiSketchInText: BOX.test(allAssistantText),
    mentionsWhiteboard: /白板/.test(allAssistantText),
    lastAssistantHead: lastAssistantText.slice(0, 600),
    hasFinalAnswer: lastAssistantText.trim() !== '',
  }
}

const out = runs.map(analyze)
writeFileSync(join(EVIDENCE, 'runs_analysis.json'), JSON.stringify(out, null, 2))

for (const a of out) {
  console.log(
    `${a.group}#${a.run}: 步=${a.steps} 工具=${a.toolCalls} 画图调用=${a.drawCalls} 新图=${a.newDiagrams?.length ?? 0} ` +
      `终态=${a.infraError ? '🔴基础设施失败' : '正常'} 正文=${a.assistantChars}字 ASCII=${a.asciiSketchInText} 白板提及=${a.mentionsWhiteboard}`,
  )
  for (const d of a.drawResults ?? []) console.log(`    画图结果 isError=${d.isError}｜${String(d.head).replace(/\n/g, ' ').slice(0, 160)}`)
}

for (const group of ['A', 'B']) {
  const valid = out.filter((a) => a.group === group && !a.infraError)
  const drew = valid.filter((a) => a.drawCalls > 0).length
  const drawCalls = valid.reduce((n, a) => n + a.drawCalls, 0)
  const okCalls = valid.reduce((n, a) => n + (a.drawResults ?? []).filter((d) => !d.isError).length, 0)
  console.log(
    `\n[${group}] 有效 ${valid.length} 次（排除基础设施失败 ${out.filter((a) => a.group === group && a.infraError).length} 次）｜` +
      `调用率 ${drew}/${valid.length}｜画图调用 ${drawCalls} 次，入参合法 ${okCalls}/${drawCalls}｜落盘图 ${valid.reduce((n, a) => n + (a.newDiagrams?.length ?? 0), 0)} 张`,
  )
}
