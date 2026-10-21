// lib/time.mjs — 北京时间（UTC+8）的显式换算（N4 的 EC：服务器时钟不可信）
//
// 🔴 为什么不用 `new Date().getHours()` / `toLocaleString('zh-CN')`：
//   · `getHours()` 取的是**进程本地时区**；A 机出过「系统时钟快 8 小时」的事故
//     （开发文档 §五 N4 的 EC、服务器日志 8.63 节），本地时区与本地钟都不可信。
//   · `toLocaleString` 依赖 ICU 数据与系统时区库，换一台机器可能给出不同结果。
//
// 所以本模块**只做一件事**：epoch 毫秒 → 加 8 小时后用 UTC 取值。北京没有夏令时，
// UTC+8 是常量偏移，换算完全确定，不读进程时区、不读 ICU、不读系统钟（调用方给 epoch）。
//
// 群聊的 `ts` 一律写 `+08:00`（K4.2 要求带时区；群聊的一切时间语义都在北京时间）。

/** 北京时间相对 UTC 的固定偏移（毫秒）。 */
export const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** 一天 / 一小时的毫秒数（多处要用，别各写一份）。 */
export const DAY_MS = 24 * 60 * 60 * 1000
export const HOUR_MS = 60 * 60 * 1000
export const MINUTE_MS = 60 * 1000

/**
 * 把 epoch 毫秒换成「北京时间的那几个数」。
 * @param {number} ms
 * @returns {{year: number, month: number, day: number, hour: number, minute: number, second: number, weekday: number}}
 */
export function beijingParts(ms) {
  const date = new Date(ms + BEIJING_OFFSET_MS)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    weekday: date.getUTCDay(),
  }
}

/** 两位补零。 @param {number} n */
function pad2(n) {
  return String(n).padStart(2, '0')
}

/**
 * 北京日期键 `YYYY-MM-DD`（跨天判定、按天分桶都用它）。**纯函数**。
 * @param {number} ms
 * @returns {string}
 */
export function beijingDayKey(ms) {
  const p = beijingParts(ms)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

/**
 * 北京时间戳 `YYYYMMDDTHHmmss`（id 里的时间部分，与 `beijingIso` 同口径）。
 * @param {number} ms
 * @returns {string}
 */
export function beijingStamp(ms) {
  const p = beijingParts(ms)
  return `${p.year}${pad2(p.month)}${pad2(p.day)}T${pad2(p.hour)}${pad2(p.minute)}${pad2(p.second)}`
}

/**
 * 带 `+08:00` 的 ISO 8601。**纯函数**。
 * @param {number} ms
 * @returns {string} 形如 `2026-10-21T09:12:00+08:00`
 */
export function beijingIso(ms) {
  const p = beijingParts(ms)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}+08:00`
}

/**
 * 人读的短时间 `MM-DD HH:mm`（投影 md / changelog 用）。
 * @param {number} ms
 * @returns {string}
 */
export function beijingShort(ms) {
  const p = beijingParts(ms)
  return `${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`
}

/**
 * 人读的日期时间 `YYYY-MM-DD HH:mm`（proposals / changelog 的时间列）。
 * @param {number} ms
 * @returns {string}
 */
export function beijingDateTime(ms) {
  const p = beijingParts(ms)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`
}

/**
 * 某个北京日期当天 00:00 的 epoch 毫秒。**纯函数**。
 * @param {number} ms - 该天里的任意时刻
 * @returns {number}
 */
export function beijingDayStartMs(ms) {
  const p = beijingParts(ms)
  const midnightUtc = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0)
  return midnightUtc - BEIJING_OFFSET_MS
}

/**
 * 北京日期键 + `HH:mm` → epoch 毫秒。**纯函数**（不做本地时区换算）。
 * @param {string} dayKey - `YYYY-MM-DD`
 * @param {string} hhmm - `HH:mm`
 * @returns {number}
 */
export function beijingMsAt(dayKey, hhmm) {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey)
  const time = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (day === null) throw new Error(`日期必须是 YYYY-MM-DD（得到 ${JSON.stringify(dayKey)}）`)
  if (time === null) throw new Error(`时间必须是 HH:mm（得到 ${JSON.stringify(hhmm)}）`)
  const utc = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(time[1]), Number(time[2]), 0)
  return utc - BEIJING_OFFSET_MS
}

/**
 * 北京日期键里的小时（0–23），用来看「现在是否在发送窗口内」。
 * @param {number} ms
 * @returns {number}
 */
export function beijingHour(ms) {
  return beijingParts(ms).hour
}
