// lib/sessionlog.mjs — 按 sessionId 精确定位本次运行的落盘会话日志，并解析事件流
//
// 🔴 为什么不能用"最新的 session 目录"：同一个 $DSH_HOME 上可能有**并行的其他会话**
//   在写盘（本机同时跑着 web/桌面会话与多个子代理）。"最新"未必是我们的。
//   可靠做法：驱动脚本在**进程内**报告它创建的 sessionId → 扫每个 session 日志首行
//   header 的 `id` 字段比对（header 形状：{"type":"session","version":3,"id":"session-...",...}）。
//
// 解压用 zstd CLI（PATH 上的 `zstd`；预检会查它在不在）。

import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 列目录下的子目录名（读不到就返回空，不抛）。 */
function readdirDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}

/** 在 session 目录里找日志文件。 */
function findLogFile(dir) {
  try {
    for (const name of readdirSync(dir)) {
      if (/^session\..*\.jsonl\.zstd$/.test(name)) return join(dir, name)
      if (/^session\.jsonl\.zstd$/.test(name)) return join(dir, name)
    }
  } catch {
    return null
  }
  return null
}

/** 解压一个 session 日志为文本（失败抛错，不静默）。 */
export function decompress(file) {
  try {
    return execFileSync('zstd', ['-dc', file], { maxBuffer: 1024 * 1024 * 1024 }).toString('utf8')
  } catch (error) {
    throw new Error(`zstd 解压失败：${file} — ${error.message}`)
  }
}

/** 读 session 日志首行的 `id`。 */
export function readSessionHeaderId(file) {
  try {
    for (const line of decompress(file).split('\n', 60)) {
      const trimmed = line.trim()
      if (trimmed === '' || !trimmed.startsWith('{')) continue
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed?.type === 'session' && typeof parsed.id === 'string') return parsed.id
      } catch {
        continue
      }
    }
  } catch {
    return null
  }
  return null
}

/**
 * 按 sessionId 精确定位会话目录。
 * @param {string} sessionsRoot - $DSH_HOME/sessions
 * @param {string} sessionId - 驱动脚本报告的 sessionId
 * @returns {{dir:string, file:string, sessionDirName:string, headerId:string, mtimeMs:number, matchedBy:'sessionId'}|null}
 */
export function findBySessionId(sessionsRoot, sessionId) {
  for (const bucket of readdirDirs(sessionsRoot)) {
    for (const sessionDir of readdirDirs(join(sessionsRoot, bucket))) {
      const dir = join(sessionsRoot, bucket, sessionDir)
      const file = findLogFile(dir)
      if (file === null) continue
      const headerId = readSessionHeaderId(file)
      if (headerId === sessionId) {
        return {
          dir,
          file,
          sessionDirName: sessionDir,
          headerId,
          mtimeMs: statSync(file).mtimeMs,
          matchedBy: 'sessionId',
        }
      }
    }
  }
  return null
}

/**
 * 列出所有 session 日志（诊断用：按 sessionId 找不到时，把候选摆出来给人看）。
 * @returns {{dir:string, file:string, headerId:string|null, mtimeMs:number}[]}
 */
export function listAllSessions(sessionsRoot) {
  const out = []
  for (const bucket of readdirDirs(sessionsRoot)) {
    for (const sessionDir of readdirDirs(join(sessionsRoot, bucket))) {
      const dir = join(sessionsRoot, bucket, sessionDir)
      const file = findLogFile(dir)
      if (file === null) continue
      out.push({ dir, file, headerId: readSessionHeaderId(file), mtimeMs: statSync(file).mtimeMs })
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return out
}

/** 解析事件流（只收 type 为字符串的行）。 */
export function parseEvents(text) {
  const events = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || !trimmed.startsWith('{')) continue
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (parsed !== null && typeof parsed === 'object' && typeof parsed.type === 'string') events.push(parsed)
  }
  return events
}

/** 取一条 message 里全部 text 块（含 tool-result 块里嵌套的 text）。 */
function textsOf(message) {
  const out = []
  const visit = (blocks, depth) => {
    if (!Array.isArray(blocks) || depth > 3) return
    for (const block of blocks) {
      if (block?.type === 'text' && typeof block.text === 'string') out.push(block.text)
      // 🔴 tool/result 的 message.content[0] 是 { type:'tool-result', content:[{type:'text',...}] }，
      //    文本在**下一层**（实测会话事件流：data.message.content[0].content[0].text）
      else if (Array.isArray(block?.content)) visit(block.content, depth + 1)
    }
  }
  visit(message?.content, 0)
  return out
}

/**
 * 把事件流整理成断言需要的结构化事实。
 * 🔴 计数口径（与 S3 集成测试一致）：数**落盘会话事件流**里
 *   `type==='user/message' && data.source.kind==='socratic-engine'` 的事件，
 *   再按所属 turn 分组（turn 号取该事件之前最近的 `turn/start` 的 data.turn）。
 *   这是宿主持久化后的真相，不是插件自己的日志。
 *
 * @returns {{turns:number[], injections:object[], stepsPerTurn:Record<string,number>,
 *            toolCalls:object[], toolResults:object[], studentMessages:object[],
 *            assistantTexts:object[], errors:object[]}}
 */
export function analyze(events) {
  const turns = []
  const injections = []
  const stepsPerTurn = new Map()
  const toolCalls = []
  const toolResults = []
  const studentMessages = []
  const assistantTexts = []
  const errors = []
  let currentTurn = null

  for (const event of events) {
    const type = event.type
    const data = event.data ?? {}
    if (type === 'turn/start') {
      currentTurn = data.turn ?? null
      turns.push(currentTurn)
      continue
    }
    if (type === 'step/start') {
      const turn = data.turn ?? currentTurn
      stepsPerTurn.set(turn, (stepsPerTurn.get(turn) ?? 0) + 1)
      continue
    }
    if (type === 'user/message') {
      const source = data.source ?? {}
      const texts = textsOf(data)
      if (source.kind === 'socratic-engine') {
        injections.push({
          turn: currentTurn,
          block: source.block ?? '<no-block>',
          seq: event.seq,
          chars: texts.reduce((n, t) => n + t.length, 0),
          texts,
        })
      } else if (source.kind === 'user') {
        studentMessages.push({ turn: currentTurn, seq: event.seq, texts })
      }
      continue
    }
    if (type === 'tool/call') {
      toolCalls.push({
        turn: currentTurn,
        seq: event.seq,
        callId: data.callId ?? null,
        name: data.name ?? '(未命名)',
        args: data.arguments ?? data.args ?? null,
      })
      continue
    }
    if (type === 'tool/result') {
      const block = data.message?.content?.[0]
      toolResults.push({
        turn: currentTurn,
        seq: event.seq,
        callId: block?.toolCallId ?? data.message?.source?.callId ?? null,
        isError: block?.isError === true,
        text: textsOf(data.message).join('\n'),
      })
      continue
    }
    if (type === 'assistant/message') {
      assistantTexts.push({ turn: currentTurn, seq: event.seq, texts: textsOf(data) })
      continue
    }
    if (type === 'error' || type === 'session/error') {
      errors.push({ turn: currentTurn, seq: event.seq, raw: JSON.stringify(data).slice(0, 2000) })
    }
  }

  return {
    turns,
    injections,
    stepsPerTurn: Object.fromEntries(stepsPerTurn),
    toolCalls,
    toolResults,
    studentMessages,
    assistantTexts,
    errors,
  }
}

/** 把某回合的注入清单压成"块 id → 字符数"的清单（给人看的"材料清单"）。 */
export function injectionListOf(analysis, turn) {
  return analysis.injections
    .filter((row) => row.turn === turn)
    .map((row) => ({ block: row.block, chars: row.chars }))
}

/** 把 tool/call 与它的 tool/result 配对。 */
export function pairToolCalls(analysis) {
  const byId = new Map()
  for (const call of analysis.toolCalls) {
    if (call.callId === null) continue
    byId.set(call.callId, { ...call, result: null })
  }
  for (const result of analysis.toolResults) {
    const entry = result.callId === null ? undefined : byId.get(result.callId)
    if (entry !== undefined) entry.result = result
  }
  return [...byId.values()]
}
