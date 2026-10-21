// index.mjs — socratic-test（探针版 v2，2026-09-23）
//
// 用途：实测清单 ①（AGENTS.md 双重注入，M1-A1）与 ③（pre-step turn/step 语义，L1-T2/T3）。
// 三件事：
// 1) 注册 system-prompt 段（标记 A：模型应能在指令里看到 [socratic-test] 行）；
// 2) ctx.on('agent/pre-step') 记录每步 payload（turn/step/消息数）——③ 的直接证据；
// 3) ctx.on('session/event') 落盘全部会话事件摘要——① 的直接证据
//    （agent-instructions 若注入 AGENTS.md，事件流里应出现带其 source kind 的 user 消息）。
//
// 日志：追加写 /tmp/socratic-probe.log（JSON Lines），不动宿主任何状态。
// 结构模板：dsh-memento v0.5.0。探针用完即被 P1 引擎替换。

import { appendFileSync } from 'node:fs'

const LOG = '/tmp/socratic-probe.log'

const log = (kind, data) => {
  try {
    appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), kind, ...data }) + '\n')
  } catch {
    /* 探针日志失败不影响宿主 */
  }
}

export const name = 'socratic-test'

export const inject = ['systemPrompt']

export function apply(ctx, /** @type {{enabled?: boolean}} */ config = {}) {
  if (config.enabled === false) return

  // 1) 系统提示标记段（标记 A）
  ctx.systemPrompt.section({
    name: 'socratic-test',
    order: 2000,
    text: '[socratic-test] 装载演练/探针段。标记A：本行在系统提示段内。',
  })

  // 2) pre-step 探针（③ turn/step 语义）
  ctx.on?.('agent/pre-step', (payload, next) => {
    log('pre-step', {
      turn: payload?.turn,
      step: payload?.step,
      messagesInStep: payload?.messages?.length,
      messageSources: payload?.messages?.map((m) => m?.source?.kind ?? m?.source ?? m?.kind).slice(0, 20),
    })
    return next?.()
  })

  // 3) 会话事件探针（① 注入证据；v3：关键类型全量转储）
  ctx.on?.('session/event', (session, event) => {
    const e = event?.type ?? event?.kind
    // 关键类型：整事件原样落盘（拿 source kind / 结构）
    if (typeof e === 'string' && /inbox|user\/message|system\/message|request\/(header|context)/.test(e)) {
      try {
        log('event-raw', { event: e, raw: JSON.stringify(event).slice(0, 2000) })
      } catch {
        /* ignore */
      }
      return
    }
    log('session-event', { event: e, sessionId: session?.id })
  })

  log('probe-loaded', { name: 'socratic-test v2 probe' })
}
