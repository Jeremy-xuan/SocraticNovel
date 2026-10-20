// session-driver.mjs — ANIM-ORCH 验证用驱动：在一个进程内对同一 agent 连发 N 轮，**轮间可设间隔**。
//
// 为什么不复用 test/integration/multiturn-driver.mjs（那个是 S3 的共享测试件）：
//   它两轮之间**零间隔**（`agent.followup` 之后立刻 `whenIdle`）。而本轮要验证的正是
//   **"渲染在回合之间跑完 → 引擎在下一回合开头把就绪通报推给老师"**这条路径：
//   零间隔时渲染+闸门（实测 6.6 s）赶不上回合边界，通报自然推不出去（实测踩到过）。
//   真实课堂里学生读完一段话再问下一句，间隔是秒级的 —— 所以要能设间隔，才能测到那条路。
//   🔴 不动共享件：它被 multiturn.mjs 断言依赖，改它等于改别人的验收。
//
// 与共享件同口径的两条（照抄其取证结论，不重复推导）：
//   · message 按**结构性形状**手写，**不 import `@deepseek-ai/dsh-llm`**
//     （插件目录解析不到宿主包；能解析也绝不能再 import 一次宿主核心包 → Symbol 失配）。
//   · 用 `--patch` 把 headless bundle 的 `headless-runner` 行 disabled，再 insert 本驱动。
//
// 用法（由 verify/ab-session.mjs 拼 patch 拉起）：
//   task = `<轮数>|<第1轮话>|<第2轮话>|...`
//   环境变量 SOCRATIC_TURN_GAP_MS 控制轮间间隔（默认 0）

import { randomUUID } from 'node:crypto'

export const name = 'socratic-anim-session-driver'

export const TASK_FORMAT = '<turns>|<prompt1>|<prompt2>|...'

function userMessage(text) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze({ kind: 'user' }),
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function apply(ctx) {
  const exit = ctx.get('appExit')
  const log = (message) => process.stderr.write(`[anim-driver] ${message}\n`)
  const gapMs = Number.parseInt(process.env.SOCRATIC_TURN_GAP_MS ?? '0', 10)

  const report = {
    turns: 0,
    prompts: [],
    sessionId: null,
    turnStarts: [],
    turnEnds: [],
    /** 引擎注入的每一条 user/message（含 form 与 block），用来证明"通报真的推过来了" */
    injections: [],
    turnGapMs: gapMs,
    outcome: 'pending',
    error: undefined,
  }

  const run = async () => {
    await ctx.get('loader')?.await()
    const agents = ctx.get('agents')
    const defaultModel = ctx.get('agentDefaultModel')
    const sessions = ctx.get('sessions')
    if (agents === undefined || defaultModel === undefined || sessions === undefined) {
      throw new Error('session-driver: agents / agentDefaultModel / sessions unavailable')
    }

    const rawTask = ctx.get('cmdlineArgs')?.get()?.join(' ') ?? ''
    const segments = rawTask.split('|')
    const requestedTurns = Number.parseInt(segments[0] ?? '', 10)
    const prompts = segments.slice(1).filter((s) => s.trim() !== '')
    if (!Number.isSafeInteger(requestedTurns) || requestedTurns < 1 || requestedTurns > 6) {
      throw new Error(`session-driver: 轮数须为 1..6，得到 ${JSON.stringify(segments[0])}`)
    }
    if (prompts.length < requestedTurns) {
      throw new Error(`session-driver: 要 ${requestedTurns} 轮但只给了 ${prompts.length} 句（格式 ${TASK_FORMAT}）`)
    }

    const selection = defaultModel.currentSelection()
    const { agent } = await agents.create({
      sessionId: `session-${randomUUID()}`,
      meta: { cwd: process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
    })
    report.sessionId = agent.session.id
    log(`session=${agent.session.id} turns=${requestedTurns} gapMs=${gapMs}`)

    ctx.on('session/event', (session, event) => {
      if (session !== agent.session) return
      if (event.type === 'turn/start') report.turnStarts.push(event.data.turn)
      else if (event.type === 'turn/end') report.turnEnds.push({ turn: event.data.turn, reason: event.data.reason })
      else if (event.type === 'user/message') {
        const source = event.data?.source ?? {}
        if (source.kind !== 'socratic-engine') return
        report.injections.push({
          turn: report.turnStarts.length > 0 ? report.turnStarts[report.turnStarts.length - 1] : null,
          seq: event.seq,
          form: source.form ?? null,
          block: source.block ?? null,
          time: event.time,
        })
      }
    })

    await agent.whenIdle()
    for (let index = 0; index < requestedTurns; index += 1) {
      if (index > 0 && gapMs > 0) {
        log(`轮间等待 ${gapMs} ms（模拟学生读完上一段再开口）`)
        await sleep(gapMs)
      }
      const text = prompts[index]
      report.prompts.push(text)
      log(`turn ${index + 1}/${requestedTurns}: ${JSON.stringify(text.slice(0, 40))}`)
      agent.followup(userMessage(text))
      await agent.whenIdle()
    }
    report.turns = report.turnStarts.length
    await sessions.flush(agent.session)
    report.outcome = 'completed'

    const summaryPath = process.env.SOCRATIC_MULTITURN_REPORT
    if (summaryPath !== undefined && summaryPath !== '') {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(summaryPath, JSON.stringify(report, null, 2))
    }
    log(`SUMMARY ${JSON.stringify({ turns: report.turnStarts.length, injections: report.injections.length, notices: report.injections.filter((i) => i.form === 'animation-notice').length })}`)
    exit(0)
  }

  run().catch((error) => {
    report.outcome = 'error'
    report.error = error instanceof Error ? error.message : String(error)
    log(`FAILED: ${report.error}`)
    exit(1)
  })
}
