// test/integration/multiturn-driver.mjs — 多 turn 驱动插件（S3 集成测试用，**不计入生产代码**）
//
// 🔴 目的：让 `socratic-headless` profile 在**一个进程内**对**同一个 agent** 连发 N 次
//    `agent.followup(...)`，从而产生 ≥2 个 turn，用于验证「每 turn 注入恰好一次」。
//
// 🔴 为什么需要这个 driver：安装版 headless 的 runner 是**一进程一 turn**——
//    tmp/dsh-installed/dsh-headless/lib/index.js:127-168
//      `agents.create({ sessionId: \`session-${randomUUID()}\` ... })` → 一次 `followup` → `io.exit(...)`
//    且安装版 CLI 只有 `[task...]`，**没有** `--session-id` / `--json` / stdin 连续输入：
//      tmp/dsh-installed/dsh-headless/lib/startup.js:20-25, 34-38
//    → 必须用 `--patch` 把 headless bundle 的 `headless-runner` 行 **disabled**，再 insert 本 driver。
//
// 🔴 消息构造**刻意不 import `@deepseek-ai/dsh-llm`**：
//    本文件位于插件目录（被测插件的 test/integration/ 下），该目录解析不到宿主的
//    `@deepseek-ai/*`（实测：createRequire 报 MODULE_NOT_FOUND）。
//    即使能解析，**在插件目录里再 import 一次宿主核心包 = 双实例 → Symbol 失配**（项目铁律）。
//    故按**结构性形状**手写 message，字段由宿主自身的校验器逐条取证（见下）。
//
// ── message 字段依据（逐字取证）──────────────────────────────────────────────
// ① `user/message` 的 event.data **就是 message 本身**（不是 { message } 包一层）：
//      tmp/dsh-installed/dsh-session/lib/types/index.js:249
//        `const message = type === 'user/message' ? record : record?.['message'];`
// ② message 必须：`id` 非空 string、`role === 'user'`、`source.kind` 非空 string、`content` 是数组：
//      tmp/dsh-installed/dsh-session/lib/types/index.js:250-268
//      （`MESSAGE_ROLE_BY_TYPE` 在第 236 行：`'user/message': 'user'`）
// ③ 宿主 `createUserMessage` 实际产出的形状（用于对齐语义，不是照抄实现）：
//      tmp/dsh-installed/dsh-llm/lib/index.js:48-53 → createMessage({...input, role:'user'})
//      tmp/dsh-installed/dsh-llm/lib/index.js:42-46 → { ...input, id: brandString(randomUUID()) } 且 deepFreeze
// ④ `brandString` 就是 `return id`（无校验），故用普通字符串 id 完全等价：
//      tmp/dsh-installed/dsh-llm-retry/lib/index.js:8-11

import { randomUUID } from 'node:crypto'

export const name = 'socratic-multiturn-driver'

/** driver 从任务文本读取的格式：`<轮数>|<第1轮话>|<第2轮话>|...`（`|` 分隔，第 1 段是轮数）。 */
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

/** 工作目录（driver 自落盘用；从 cwd 起找，找不到就用 cwd）。 */
export function apply(ctx) {
  const exit = ctx.get('appExit')
  const log = (message) => process.stderr.write(`[multiturn] ${message}\n`)

  /** 把 driver 自己写的日志落到 stderr + 一份磁盘文件，供集成脚本与人工复核。 */
  const report = {
    turns: 0,
    prompts: [],
    sessionIdsSeen: [],
    turnStarts: [],
    turnEnds: [],
    injectionUserMessages: [],
    perTurnInjectionCounts: {},
    outcome: 'pending',
    error: undefined,
  }

  const run = async () => {
    await ctx.get('loader')?.await()
    const agents = ctx.get('agents')
    const defaultModel = ctx.get('agentDefaultModel')
    const sessions = ctx.get('sessions')
    if (agents === undefined || defaultModel === undefined || sessions === undefined) {
      throw new Error('multiturn driver: agents / agentDefaultModel / sessions unavailable')
    }

    const rawTask = ctx.get('cmdlineArgs')?.get()?.join(' ') ?? ''
    const segments = rawTask.split('|')
    const requestedTurns = Number.parseInt(segments[0] ?? '', 10)
    const prompts = segments.slice(1).filter((s) => s.trim() !== '')
    if (!Number.isSafeInteger(requestedTurns) || requestedTurns < 1 || requestedTurns > 4) {
      throw new Error(`multiturn driver: expected 1..4 turns as the first '|'-separated segment, got ${JSON.stringify(segments[0])}`)
    }
    if (prompts.length < requestedTurns) {
      throw new Error(`multiturn driver: ${requestedTurns} turns requested but only ${prompts.length} prompts given (format ${TASK_FORMAT})`)
    }

    const selection = defaultModel.currentSelection()
    const { agent } = await agents.create({
      sessionId: `session-${randomUUID()}`,
      meta: { cwd: process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
    })
    report.sessionIdsSeen.push(agent.session.id)
    log(`session=${agent.session.id} turns=${requestedTurns}`)

    // 观测事件流：turn/start、turn/end，以及「本插件注入的 user/message」。
    // 计数口径（取证报告 §1.7）：type==='user/message' && data.source.kind==='socratic-engine'。
    ctx.on('session/event', (session, event) => {
      if (session !== agent.session) return
      if (event.type === 'turn/start') report.turnStarts.push(event.data.turn)
      else if (event.type === 'turn/end') report.turnEnds.push({ turn: event.data.turn, reason: event.data.reason })
      else if (event.type === 'user/message') {
        const source = event.data?.source ?? {}
        if (source.kind !== 'socratic-engine') return
        const turn = report.turnStarts.length > 0 ? report.turnStarts[report.turnStarts.length - 1] : null
        report.injectionUserMessages.push({ turn, seq: event.seq, block: source.block ?? null })
        const key = String(turn)
        report.perTurnInjectionCounts[key] = (report.perTurnInjectionCounts[key] ?? 0) + 1
      }
    })

    await agent.whenIdle()

    for (let index = 0; index < requestedTurns; index += 1) {
      const text = prompts[index]
      report.prompts.push(text)
      log(`turn ${index + 1}/${requestedTurns}: followup ${JSON.stringify(text.slice(0, 40))}`)
      agent.followup(userMessage(text))
      await agent.whenIdle()
    }
    report.turns = report.turnStarts.length

    await sessions.flush(agent.session)
    report.outcome = 'completed'

    const summaryPath = process.env.SOCRATIC_MULTITURN_REPORT
    if (summaryPath !== undefined && summaryPath !== '') {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(summaryPath, JSON.stringify({ ...report, sessionId: agent.session.id }, null, 2))
      log(`report written: ${summaryPath}`)
    }
    log(`SUMMARY ${JSON.stringify({
      turns: report.turnStarts.length,
      turnStarts: report.turnStarts,
      injections: report.injectionUserMessages.length,
      perTurn: report.perTurnInjectionCounts,
    })}`)
    exit(0)
  }

  run().catch((error) => {
    report.outcome = 'error'
    report.error = error instanceof Error ? `${error.message}` : String(error)
    log(`FAILED: ${report.error}`)
    const summaryPath = process.env.SOCRATIC_MULTITURN_REPORT
    if (summaryPath !== undefined && summaryPath !== '') {
      try {
        // 同步写：此处已在 async 上下文外，用 require 风格同步 import 保持简洁。
        // eslint 不是本仓库约束；node:fs 同步 API 在此可接受。
        // eslint-disable-next-line ts/no-require-imports
      } catch { /* 报告落盘失败不掩盖真实错误 */ }
    }
    exit(1)
  })
}
