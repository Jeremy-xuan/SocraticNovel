// lib/state.mjs — 运行状态登记簿（N1.4 的「只读状态出口」）
//
// 🔴 N1.4 有两条要求，缺一条都算踩 A6「静默失败」红线：
//   ① 写日志 → lib/runlog.mjs（JSONL，跨重启可查）
//   ② **面板上有可见的错误状态** → 本模块。面板/引擎只读 `status()` 的返回，不写。
//
// 设计约束：
//   · `status()` 返回**冻结的深拷贝**：调用方改不动内部状态，也就不会出现「面板改了引擎状态」。
//   · 内存里只留最近 `maxRecent` 条，避免长会话把内存拖大；完整历史在 JSONL 里。
//   · `ok` 的判据只有一条：**最近一次跑完的运行没有失败**。
//   · `lastError` 一旦发生就**一直留着**（后来的成功不清空它）——面板要能回答「上次为什么红」，
//     而不是成功一次就把历史抹掉。红的当前/历史之分由 `ok` 和 `recent` 表达。

import { describeError } from './errors.mjs'

/** 一次运行在登记簿里的形状（只读对外）。 */
export const RUN_FIELDS = Object.freeze(['runId', 'task', 'sessionId', 'lesson', 'trigger', 'startedAt', 'endedAt', 'state', 'code', 'message'])

/**
 * 建一个运行状态登记簿。
 * @param {{now?: () => number, maxRecent?: number}} [options]
 */
export function createRunRegistry({ now = () => Date.now(), maxRecent = 20 } = {}) {
  /** @type {object | null} */
  let lastError = null
  /** @type {object | null} */
  let lastSuccess = null
  /** @type {object | null} */
  let lastSettled = null
  /** @type {object[]} */
  const recent = []
  /** @type {Map<string, object>} */
  const active = new Map()
  let seq = 0

  /** @param {object} entry */
  function push(entry) {
    recent.push(entry)
    while (recent.length > maxRecent) recent.shift()
  }

  return {
    /**
     * 登记一次运行的开始。
     * @param {{task: string, sessionId?: string|null, lesson?: number|null, trigger?: string|null}} info
     * @returns {{runId: string, task: string, sessionId: string|null, lesson: number|null, trigger: string|null, startedAt: number, done: (result: object) => void, failed: (error: unknown) => void}}
     */
    begin(info) {
      seq += 1
      const runId = `${info.task}-${now()}-${seq}`
      const row = {
        runId,
        task: info.task,
        sessionId: info.sessionId ?? null,
        lesson: info.lesson ?? null,
        trigger: info.trigger ?? null,
        startedAt: now(),
      }
      active.set(runId, row)
      let settled = false
      return {
        ...row,
        done(result) {
          if (settled) return
          settled = true
          active.delete(runId)
          const entry = { ...row, endedAt: now(), state: 'ok', ...(result?.bytes === undefined ? {} : { bytes: result.bytes }) }
          lastSuccess = entry
          lastSettled = entry
          push(entry)
        },
        failed(error) {
          if (settled) return
          settled = true
          active.delete(runId)
          const described = describeError(error)
          const entry = { ...row, endedAt: now(), state: 'failed', code: described.code, message: described.message }
          lastError = entry
          lastSettled = entry
          push(entry)
        },
      }
    },
    /**
     * 只读快照。
     * @returns {{ok: boolean, active: object[], lastError: object|null, lastSuccess: object|null, recent: object[]}}
     */
    status() {
      return deepFreeze({
        ok: lastSettled === null ? true : lastSettled.state === 'ok',
        active: [...active.values()].map((row) => ({ ...row })),
        lastError: lastError === null ? null : { ...lastError },
        lastSuccess: lastSuccess === null ? null : { ...lastSuccess },
        recent: recent.map((row) => ({ ...row })),
      })
    },
  }
}

/**
 * 深冻结（只处理本模块会产出的纯对象/数组/原始值）。
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}
