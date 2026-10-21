// lib/proactive.mjs — N4 定时主动发消息：当天的持久队列 + 确定性检查 + 退避
//
// 全部是**确定性代码**，模型只负责「说什么」（一次生成当天的几条），不负责「什么时候发」「该不该发」。
//
// 时间口径：一律北京时间（UTC+8，`lib/time.mjs` 显式换算）。EC 明写「服务器时钟不可信」，
//   所以这里不读进程时区、不读系统钟——调用方把 epoch 传进来（真实运行是 `Date.now()`，
//   单测是假时钟）。
//
// 三条硬规则（N4）：
//   · 每天 1–3 次，落在 08:00–23:00（左闭右开：23:00 整不发）
//   · 当天第一次触发时**一次性生成**当天的消息与时间，进持久队列（`runtime/.narrative/proactive.json`）
//   · 到点发送前做确定性检查：从生成那一刻到现在，只要发生过「学生发言 / 上课 / 任何新群聊消息」，
//     这条就作废，用最新上下文重新生成一条
//   · 退避：自学生最后一次发言起，连续 2 条主动消息没人回 → 停，直到学生再说话
//
// EC 的三条对策（写在这里，便于核对）：
//   ① 时区：`beijingDayKey` / `beijingMsAt`，从不使用本地时间 API
//   ② **重启时恰好跨过发送时间**：迟到 ≤ 10 分钟照发（还是那个时刻）；超过 10 分钟**作废**，
//      若当天还有额度与窗口，重新生成一条排在 `now + 5..30 分钟`。**不补发**——一条迟到半小时的
//      「刚看到」会读起来像程序在补作业，而不是她想起你。
//   ③ 队列文件损坏：解析失败 → 丢队列、按今天重建（**不崩溃**），并把损坏事实记进日志与 `status()`

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './atomic.mjs'
import { createSerialQueue } from './serial.mjs'
import { withFileLock } from './lock.mjs'
import { MINUTE_MS, beijingDayKey, beijingIso, beijingMsAt, beijingParts } from './time.mjs'

/** 持久队列（相对教室目录）。 */
export const PROACTIVE_RELATIVE = join('runtime', '.narrative', 'proactive.json')

/** 发送窗口：08:00–23:00（北京时间，左闭右开）。 */
export const WINDOW_START_HOUR = 8
export const WINDOW_END_HOUR = 23

/** 每天主动消息条数范围（N4.1：1–3 次）。 */
export const MIN_PER_DAY = 1
export const MAX_PER_DAY = 3

/** 迟到宽限：超过它就不发（见文件头 EC ②）。 */
export const LATE_GRACE_MS = 10 * MINUTE_MS

/** 退避阈值（N4.4：连续 2 条没人回就停）。 */
export const BACKOFF_AFTER = 2

/** 作废后最多补生成几条（防止「生成→作废→生成」转圈）。 */
export const MAX_REPLACEMENTS = 2

/** 当天生成失败的重试上限（失败要大声，但不能无限重试）。 */
export const MAX_GENERATE_ATTEMPTS = 3

/** 生成后第一条至少要等这么久（避免「刚生成就发」）。 */
export const LEAD_MS = 5 * MINUTE_MS

/** 补位时「现在 + 5..30 分钟」的区间。 */
export const REPLACEMENT_MIN_DELAY_MS = 5 * MINUTE_MS
export const REPLACEMENT_MAX_DELAY_MS = 30 * MINUTE_MS

/**
 * 现在是否在发送窗口内（北京时间）。
 * @param {number} ms
 * @returns {boolean}
 */
export function inWindow(ms) {
  const hour = beijingParts(ms).hour
  return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR
}

/**
 * 抽 `count` 个时刻（默认在 08:00–23:00 均匀分布，升序）。
 *
 * `fromMs` 是「今天还剩下多长的窗口」：当天第一次触发不是 8:00 而是 14:00 时，
 * 8:00–14:00 已经过去了，抽到那里的槽位只会立刻因「迟到」作废 —— 所以从 `fromMs` 起抽。
 *
 * @param {string} dayKey
 * @param {number} count
 * @param {() => number} rng
 * @param {{fromMs?: number}} [options]
 * @returns {{atMs: number, at: string}[]}
 */
export function planTimes(dayKey, count, rng, { fromMs } = {}) {
  const windowStartMs = beijingMsAt(dayKey, `${String(WINDOW_START_HOUR).padStart(2, '0')}:00`)
  const windowEndMs = beijingMsAt(dayKey, `${String(WINDOW_END_HOUR).padStart(2, '0')}:00`)
  const startMs = Math.max(windowStartMs, Number.isFinite(fromMs) ? fromMs : windowStartMs)
  const spanMs = windowEndMs - startMs
  if (spanMs <= 0) return []
  const picks = []
  for (let index = 0; index < count; index += 1) {
    picks.push(startMs + Math.floor(rng() * spanMs))
  }
  picks.sort((left, right) => left - right)
  return picks.map((atMs) => {
    const p = beijingParts(atMs)
    return { atMs, at: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` }
  })
}

/**
 * 当天还能排几条：按剩余窗口长度收敛（不足 1 小时的窗口只排 1 条）。
 * @param {number} nowMs
 * @param {string} dayKey
 * @returns {number}
 */
export function remainingSlots(nowMs, dayKey) {
  const windowEndMs = beijingMsAt(dayKey, `${String(WINDOW_END_HOUR).padStart(2, '0')}:00`)
  const leftMs = windowEndMs - Math.max(nowMs, beijingMsAt(dayKey, `${String(WINDOW_START_HOUR).padStart(2, '0')}:00`))
  if (leftMs <= 0) return 0
  return Math.max(1, Math.min(MAX_PER_DAY, Math.floor(leftMs / (60 * MINUTE_MS))))
}

/**
 * 空队列（某一天还没生成过）。
 * @param {string} dayKey
 * @returns {object}
 */
export function emptyQueue(dayKey) {
  return {
    v: 1,
    date: dayKey,
    generatedAt: null,
    plannedCount: 0,
    generateAttempts: 0,
    replacements: 0,
    sentSinceLastStudent: 0,
    lastStudentSeq: 0,
    slots: [],
    voided: [],
    lastError: null,
  }
}

/**
 * 解析队列文件内容；坏掉就返回 null（调用方按「今天重建」处理，不崩溃）。
 * @param {string} text
 * @returns {object|null}
 */
export function parseQueue(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text ?? ''))
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  if (parsed.v !== 1) return null
  if (typeof parsed.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) return null
  const slots = Array.isArray(parsed.slots) ? parsed.slots.filter(isSlot) : []
  return {
    v: 1,
    date: parsed.date,
    generatedAt: Number.isInteger(parsed.generatedAt) ? parsed.generatedAt : null,
    plannedCount: Number.isInteger(parsed.plannedCount) ? parsed.plannedCount : slots.length,
    generateAttempts: Number.isInteger(parsed.generateAttempts) ? parsed.generateAttempts : 0,
    replacements: Number.isInteger(parsed.replacements) ? parsed.replacements : 0,
    sentSinceLastStudent: Number.isInteger(parsed.sentSinceLastStudent) ? parsed.sentSinceLastStudent : 0,
    lastStudentSeq: Number.isInteger(parsed.lastStudentSeq) ? parsed.lastStudentSeq : 0,
    slots,
    voided: Array.isArray(parsed.voided) ? parsed.voided : [],
    lastError: parsed.lastError ?? null,
  }
}

/**
 * 一个槽位的最小形状检查（坏的丢掉，别让它把整份队列读废）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSlot(value) {
  if (value === null || typeof value !== 'object') return false
  if (!Number.isInteger(value.atMs) || typeof value.at !== 'string') return false
  if (typeof value.text !== 'string' || value.text === '') return false
  if (typeof value.speaker !== 'string' || value.speaker === '') return false
  if (value.state !== 'pending' && value.state !== 'sent' && value.state !== 'voided') return false
  if (value.context === null || typeof value.context !== 'object') return false
  if (!Number.isInteger(value.context.maxSeq) || !Number.isInteger(value.context.generatedAt)) return false
  return true
}

/**
 * 建一个「当天主动消息」的调度器。
 *
 * @param {object} options
 * @param {string} options.classroomDir
 * @param {() => number} options.now
 * @param {() => number} options.rng
 * @param {(input: {count: number, times: string[], lesson: number|null}) => Promise<Array<{speaker: string, text: string}>>} options.generate
 * @param {() => Promise<object[]>} options.readMessages - 读全部群聊消息（判退避与作废）
 * @param {() => Promise<{inProgress: boolean, lastActivityAt: number|null}>} options.classroomState
 * @param {(level: string, ...args: any[]) => void} [options.log]
 * @param {typeof writeFileAtomic} [options.write]
 */
export function createProactiveScheduler({ classroomDir, now, rng, generate, readMessages, classroomState, log = () => {}, write = writeFileAtomic }) {
  const file = join(classroomDir, PROACTIVE_RELATIVE)
  const queue = createSerialQueue()

  /** @returns {Promise<{queue: object, corrupt: boolean}>} */
  async function load() {
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return { queue: emptyQueue(beijingDayKey(now())), corrupt: false }
      throw error
    }
    const parsed = parseQueue(text)
    if (parsed === null) {
      log('error', `[narrative] 主动消息队列文件损坏，按今天重建：${file}`)
      return { queue: emptyQueue(beijingDayKey(now())), corrupt: true }
    }
    return { queue: parsed, corrupt: false }
  }

  /** @param {object} state */
  async function save(state) {
    await writeFileAtomic(file, `${JSON.stringify(state)}\n`)
  }

  /**
   * 生成当天的槽位（一次模型调用生成 `count` 条）。
   * @param {object} state
   * @param {number} nowMs
   * @param {{count?: number, atMs?: number}} [override] - 补位时指定「现在之后的一个时刻」
   */
  async function generateDay(state, nowMs, override = {}) {
    const count =
      override.count ?? Math.min(remainingSlots(nowMs, state.date), MIN_PER_DAY + Math.floor(rng() * (MAX_PER_DAY - MIN_PER_DAY + 1)))
    const times =
      override.atMs === undefined
        ? planTimes(state.date, Math.max(1, count), rng, { fromMs: nowMs + LEAD_MS })
        : [{ atMs: override.atMs, at: formatHhmm(override.atMs) }]
    state.generateAttempts += 1
    try {
      const speeches = await generate({ count: times.length, times: times.map((slot) => slot.at), lesson: null })
      if (speeches.length !== times.length) {
        throw new Error(`要 ${times.length} 条，模型给了 ${speeches.length} 条`)
      }
      const messages = await readMessages()
      const maxSeq = messages.reduce((max, message) => (message.seq > max ? message.seq : max), 0)
      for (const [index, slot] of times.entries()) {
        state.slots.push({
          atMs: slot.atMs,
          at: slot.at,
          speaker: speeches[index].speaker,
          text: speeches[index].text,
          state: 'pending',
          context: { maxSeq, generatedAt: nowMs },
        })
      }
      state.generatedAt = nowMs
      state.plannedCount += times.length
      state.lastError = null
      return { ok: true, count: times.length }
    } catch (error) {
      state.lastError = { at: nowMs, message: String(error?.message ?? error), code: error?.code ?? null }
      log('error', `[narrative] 主动消息生成失败：${state.lastError.message}`)
      return { ok: false, error }
    }
  }

  /**
   * 走一次调度（幂等：随时可重复调用）。定时器与单测都只调它。
   * @param {number} nowMs
   * @returns {Promise<{actions: string[], queue: object}>}
   */
  async function tick(nowMs) {
    return queue.run(file, async () =>
      withFileLock(`${file}.lock`, async () => {
        const loaded = await load()
        let state = loaded.queue
        const today = beijingDayKey(nowMs)
        const actions = []
        if (loaded.corrupt) actions.push('queue-rebuilt')
        if (state.date !== today) {
          // 跨天：昨天的槽位（含没发出去的）一律丢弃，按今天重建
          state = emptyQueue(today)
          actions.push('new-day')
        }

        // 退避复位：学生说过话就把「连续没回」清零（确定性，由消息序列推出）
        const messages = await readMessages()
        const studentMaxSeq = messages.reduce((max, message) => (message.role === 'student' && message.seq > max ? message.seq : max), 0)
        if (studentMaxSeq > state.lastStudentSeq) {
          state.lastStudentSeq = studentMaxSeq
          state.sentSinceLastStudent = 0
        }

        const backoff = state.sentSinceLastStudent >= BACKOFF_AFTER
        if (backoff) actions.push('backoff')

        // 当天还没生成 → 生成（窗口内、没退避、失败次数没用完）
        if (state.generatedAt === null) {
          if (backoff) {
            await save(state)
            return { actions, queue: state, sentNow: [] }
          }
          if (!inWindow(nowMs)) {
            actions.push('outside-window')
            await save(state)
            return { actions, queue: state, sentNow: [] }
          }
          if (state.generateAttempts >= MAX_GENERATE_ATTEMPTS) {
            actions.push('generate-exhausted')
            await save(state)
            return { actions, queue: state, sentNow: [] }
          }
          const generated = await generateDay(state, nowMs)
          actions.push(generated.ok ? 'generated' : 'generate-failed')
          await save(state)
          return { actions, queue: state, sentNow: [] }
        }

        // 发到期的槽位
        const classroom = await classroomState()
        const sentNow = []
        for (const slot of state.slots) {
          if (slot.state !== 'pending' || slot.atMs > nowMs) continue
          if (state.sentSinceLastStudent >= BACKOFF_AFTER) {
            voidSlot(state, slot, 'backoff', nowMs)
            actions.push('void-backoff')
            continue
          }
          if (classroom.inProgress) {
            voidSlot(state, slot, 'class', nowMs)
            actions.push('void-class')
            continue
          }
          if (contextChanged(slot, messages, classroom)) {
            voidSlot(state, slot, 'context', nowMs)
            actions.push('void-context')
            continue
          }
          if (nowMs - slot.atMs > LATE_GRACE_MS) {
            voidSlot(state, slot, 'late', nowMs)
            actions.push('void-late')
            continue
          }
          slot.state = 'sent'
          slot.sentAt = nowMs
          state.sentSinceLastStudent += 1
          sentNow.push(slot)
          actions.push('sent')
        }

        // 作废后的补位：当天还有额度、还在窗口内、补位次数没用完
        const voidedCount = state.slots.filter((slot) => slot.state === 'voided').length
        if (voidedCount > state.replacements && state.replacements < MAX_REPLACEMENTS && !backoff && inWindow(nowMs) && state.plannedCount < MAX_PER_DAY) {
          const atMs = nowMs + REPLACEMENT_MIN_DELAY_MS + Math.floor(rng() * (REPLACEMENT_MAX_DELAY_MS - REPLACEMENT_MIN_DELAY_MS))
          if (atMs < beijingMsAt(state.date, `${String(WINDOW_END_HOUR).padStart(2, '0')}:00`)) {
            state.replacements += 1
            const generated = await generateDay(state, nowMs, { count: 1, atMs })
            actions.push(generated.ok ? 'regenerated' : 'regenerate-failed')
          }
        }

        await save(state)
        return { actions, queue: state, sentNow }
      }),
    )
  }

  /**
   * 槽位作废（留痕，便于事后回答「为什么今天只有一条」）。
   * @param {object} state
   * @param {object} slot
   * @param {string} reason
   * @param {number} nowMs
   */
  function voidSlot(state, slot, reason, nowMs) {
    slot.state = 'voided'
    slot.voidedAt = nowMs
    slot.voidReason = reason
    state.voided.push({ at: slot.at, atMs: slot.atMs, reason, voidedAt: beijingIso(nowMs) })
  }

  return {
    file,
    tick,
    load,
    /** 只读快照（面板/测试看「今天还有几条、为什么没发」）。 */
    async status() {
      const loaded = await load()
      return {
        date: loaded.queue.date,
        corrupt: loaded.corrupt,
        pending: loaded.queue.slots.filter((slot) => slot.state === 'pending').map((slot) => ({ at: slot.at, text: slot.text })),
        sent: loaded.queue.slots.filter((slot) => slot.state === 'sent').map((slot) => ({ at: slot.at, text: slot.text, sentAt: slot.sentAt })),
        voided: loaded.queue.voided,
        sentSinceLastStudent: loaded.queue.sentSinceLastStudent,
        backoff: loaded.queue.sentSinceLastStudent >= BACKOFF_AFTER,
        lastError: loaded.queue.lastError,
      }
    },
  }
}

/**
 * 「从生成到现在发生过什么」的确定性判定（N4.3）。
 * @param {object} slot
 * @param {object[]} messages
 * @param {{inProgress: boolean, lastActivityAt: number|null}} classroom
 * @returns {boolean}
 */
export function contextChanged(slot, messages, classroom) {
  // 「新的群聊消息」用 seq 判，**不用时间戳**：seq 是服务端分配的单调整数（K4.2），
  // 而 `ts` 只精确到秒 —— 用 `ts >= generatedAt` 会把「同一秒内生成的那条开场消息」
  // 误判成「生成之后的新消息」，每次都在到点时自己把自己作废（实测踩过）。
  if (messages.some((message) => message.seq > slot.context.maxSeq)) return true
  // 「上课」：引擎报的最近回合活动晚于生成时刻
  if (classroom.lastActivityAt !== null && Number.isFinite(classroom.lastActivityAt) && classroom.lastActivityAt >= slot.context.generatedAt) return true
  return false
}

/** @param {number} ms */
function formatHhmm(ms) {
  const p = beijingParts(ms)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}
