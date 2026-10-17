// probe/accept-driver.mjs — ACCEPT-1 的「多轮真实会话」驱动插件（测试基础设施，不是被测代码）
//
// 🔴 为什么需要它：安装版 headless 的 runner 是**一进程一 turn**
//   （`dsh-headless` 的 headless-runner：create agent → 一次 followup → io.exit），
//   而 CLI 只有 `[task...]`，没有 `--session-id` / `--stdin` 连续输入。
//   → 必须用 `--patch` 把 headless bundle 的 `headless-runner` 行 **disabled**，
//     再 insert 本 driver，在**一个进程内对同一个 agent 连发 N 次 followup**，
//     得到真正的「同一会话多 turn」。做法照抄 `plugins/socratic-engine/test/integration/multiturn-driver.mjs`
//     （已实测可用的先例），并按本流水线的观测需求扩展。
//
// 🔴 本文件**刻意不 import `@deepseek-ai/dsh-llm`**：
//   本文件位于插件目录之外，解析不到宿主核心包；即使能解析，
//   **在插件里再 import 一次宿主核心包 = 双实例 → Symbol 失配**（项目铁律）。
//   故按**结构性形状**手写 message（字段依据见下），并用普通字符串 id（`brandString` 就是 return id）。
//
// ── message 字段依据（逐字取证，与 multiturn-driver 同源）──────────────────────
// ① `user/message` 的 event.data **就是 message 本身**：dsh-session/lib/types/index.js:249
// ② message 必须：`id` 非空 string、`role === 'user'`、`source.kind` 非空 string、`content` 是数组
// ③ 宿主 createUserMessage 形状：dsh-llm/lib/index.js:48-53
// ④ `brandString` = `return id`（无校验）→ 普通字符串等价：dsh-llm-retry/lib/index.js:8-11
//
// ── 任务文本格式 ──────────────────────────────────────────────────────────────
//   `<轮数>|<第1轮话>|<第2轮话>|...`（`|` 分隔，第 1 段是轮数；1..4）
//
// ── 落盘 ──────────────────────────────────────────────────────────────────────
//   $ACCEPT_REPORT 指向的 JSON 文件；**每轮结束立刻重写一次**（逐条落盘，禁止攒批）。

import { createHash, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

export const name = 'socratic-accept-driver'

export const TASK_FORMAT = '<turns>|<prompt1>|<prompt2>|...'

/** 构造一条结构合法的 user message（见文件头 ①②③④）。 */
function userMessage(text) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze({ kind: 'user' }),
  })
}

/** 取一条 message 里的全部 text 块。 */
function textsOf(message) {
  const content = message?.content
  if (!Array.isArray(content)) return []
  const out = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') out.push(block.text)
  }
  return out
}

export function apply(ctx) {
  const exit = ctx.get('appExit')
  const log = (message) => process.stderr.write(`[accept-driver] ${message}\n`)
  const reportPath = process.env.ACCEPT_REPORT ?? ''

  const report = {
    driver: 'socratic-accept-driver',
    startedAt: new Date().toISOString(),
    sessionId: null,
    sessionIdsSeen: [],
    requestedTurns: 0,
    prompts: [],
    turnStarts: [],
    turnEnds: [],
    stepsPerTurn: {},
    injections: [],
    studentMessages: [],
    toolCalls: [],
    toolResults: [],
    outcome: 'pending',
    error: undefined,
  }

  function flush() {
    if (reportPath === '') return
    try {
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    } catch (error) {
      log(`报告落盘失败（不影响会话）：${error?.message ?? error}`)
    }
  }

  const run = async () => {
    await ctx.get('loader')?.await()
    const agents = ctx.get('agents')
    const defaultModel = ctx.get('agentDefaultModel')
    const sessions = ctx.get('sessions')
    if (agents === undefined || defaultModel === undefined || sessions === undefined) {
      throw new Error('accept-driver: agents / agentDefaultModel / sessions 不可用')
    }

    const rawTask = ctx.get('cmdlineArgs')?.get()?.join(' ') ?? ''
    const segments = rawTask.split('|')
    const requestedTurns = Number.parseInt(segments[0] ?? '', 10)
    const prompts = segments.slice(1).filter((s) => s.trim() !== '')
    if (!Number.isSafeInteger(requestedTurns) || requestedTurns < 1 || requestedTurns > 4) {
      throw new Error(`accept-driver: 第 1 段必须是 1..4 的轮数，得到 ${JSON.stringify(segments[0])}`)
    }
    if (prompts.length < requestedTurns) {
      throw new Error(`accept-driver: 要 ${requestedTurns} 轮但只给了 ${prompts.length} 段（格式 ${TASK_FORMAT}）`)
    }
    report.requestedTurns = requestedTurns
    report.prompts = prompts.slice(0, requestedTurns)

    const selection = defaultModel.currentSelection()
    const { agent } = await agents.create({
      sessionId: `session-${randomUUID()}`,
      meta: { cwd: process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
    })
    report.sessionId = agent.session.id
    report.sessionIdsSeen.push(agent.session.id)
    report.modelSelection = { provider: selection.provider, model: selection.model }
    log(`session=${agent.session.id} turns=${requestedTurns} cwd=${process.cwd()}`)
    flush()

    ctx.on('session/event', (session, event) => {
      if (session !== agent.session) return
      const turn = report.turnStarts.length > 0 ? report.turnStarts[report.turnStarts.length - 1] : null
      const data = event.data ?? {}
      if (event.type === 'turn/start') {
        report.turnStarts.push(data.turn)
      } else if (event.type === 'turn/end') {
        report.turnEnds.push({ turn: data.turn, reason: data.reason })
      } else if (event.type === 'step/start') {
        const key = String(data.turn ?? turn)
        report.stepsPerTurn[key] = (report.stepsPerTurn[key] ?? 0) + 1
      } else if (event.type === 'user/message') {
        const source = data.source ?? {}
        const texts = textsOf(data)
        if (source.kind === 'socratic-engine') {
          report.injections.push({
            turn,
            seq: event.seq,
            block: source.block ?? null,
            chars: texts.reduce((n, t) => n + t.length, 0),
            sha256: texts.map((t) => createHash('sha256').update(t).digest('hex')),
            head: texts.map((t) => t.slice(0, 80)).join(' / '),
          })
        } else if (source.kind === 'user') {
          report.studentMessages.push({ turn, seq: event.seq, text: texts.join(' ').slice(0, 200) })
        }
      } else if (event.type === 'tool/call') {
        report.toolCalls.push({ turn, seq: event.seq, callId: data.callId ?? null, name: data.name ?? null })
      } else if (event.type === 'tool/result') {
        const block = data.message?.content?.[0]
        report.toolResults.push({
          turn,
          seq: event.seq,
          callId: block?.toolCallId ?? data.message?.source?.callId ?? null,
          isError: block?.isError === true,
        })
      }
    })

    await agent.whenIdle()

    for (let index = 0; index < requestedTurns; index += 1) {
      const text = prompts[index]
      log(`turn ${index + 1}/${requestedTurns}: followup ${JSON.stringify(text.slice(0, 60))}`)
      agent.followup(userMessage(text))
      await agent.whenIdle()
      flush() // 🔴 每轮立刻落盘：会话中途崩了也能看到已经跑到哪
    }
    report.turnCount = report.turnStarts.length

    await sessions.flush(agent.session)
    report.outcome = 'completed'
    report.finishedAt = new Date().toISOString()
    flush()
    log(
      `SUMMARY ${JSON.stringify({
        turns: report.turnStarts.length,
        turnStarts: report.turnStarts,
        injections: report.injections.length,
        toolCalls: report.toolCalls.map((c) => c.name),
      })}`,
    )
    exit(0)
  }

  run().catch((error) => {
    report.outcome = 'error'
    report.error = error instanceof Error ? error.message : String(error)
    report.finishedAt = new Date().toISOString()
    flush()
    log(`FAILED: ${report.error}`)
    exit(1)
  })
}
