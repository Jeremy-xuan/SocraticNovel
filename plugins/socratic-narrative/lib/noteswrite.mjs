// lib/noteswrite.mjs — 只**追加一行**课堂记录（K3.2 的 `group_question`），绝不重算投影
//
// 🔴 边界（开发文档 N3.5 + 我对「两个写入者」的决定）：
//   `runtime/notes.jsonl` 是教学记录的真源，**三份 markdown 投影（mistake_log / review_queue /
//   knowledge_points 的状态位）只有引擎（`classroom_note` / `notestore.mjs`）能重算**。
//   本包只做一件事：按 K3.2 的字段**追加一行 JSON**，`origin: "group_agent"`。
//   绝不读改写、绝不重画投影 —— 否则同一份投影会被两个写入者各算一次，谁后写谁覆盖。
//
// 🔴 为什么追加是安全的：一行 JSON 远小于 4KB，`O_APPEND` 下的单次写入是原子的（不会与引擎的
//   追加互相切开）。
//
// 口径对齐引擎的 `lib/notestore.mjs`（我逐条照它写，不是自己发明）：
//   · `ts` 带**本地时区偏移**（引擎写的是本地时间；同一份文件里两种口径会读得别扭）
//   · `id` = `N-<yyyyMMddTHHmmss>-<三位序号>`，同一秒内取已有最大序号 + 1
//   · `kp` 可以为 null；`turn` 无回合时写 0；`lesson` 无讲次时写 0
//   · `quote` 非空（清洗：剥 K1 情绪标记 + markdown）
//   · 不写 `resolved`（K3.2：仅投影用）

import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock } from './lock.mjs'
import { stripEmotionMarkers, stripMarkdown } from './text.mjs'

/** 真源文件名（相对教室 `runtime/`）。 */
export const NOTES_RELATIVE = join('runtime', 'notes.jsonl')

/** 记录类型里本包唯一会写的那一种。 */
export const GROUP_QUESTION = 'group_question'

/** 本包写记录时的 `origin`（K3.2 的两个取值之一）。 */
export const GROUP_ORIGIN = 'group_agent'

/** 清洗后的长度上限（只防病态输入）。 */
const MAX_QUOTE_CHARS = 2000
const MAX_NOTE_CHARS = 500

/** @param {number} n */
function pad2(n) {
  return String(Math.abs(n)).padStart(2, '0')
}

/**
 * 带本地时区偏移的 ISO 8601（与引擎同口径）。
 * @param {number} ms
 * @returns {string}
 */
export function isoWithOffset(ms) {
  const d = new Date(ms)
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` +
    `${sign}${pad2(Math.floor(Math.abs(offset) / 60))}:${pad2(Math.abs(offset) % 60)}`
  )
}

/**
 * id 里的时间戳（本地时间，与 `ts` 同口径）。
 * @param {number} ms
 * @returns {string}
 */
export function idStamp(ms) {
  const d = new Date(ms)
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  )
}

/**
 * 同一秒内的下一个序号 = 该 stamp 下已有 id 的最大序号 + 1。
 * @param {{id: string}[]} records
 * @param {string} stamp
 * @returns {number}
 */
export function nextSeqFor(records, stamp) {
  let max = 0
  for (const record of records ?? []) {
    const match = /^N-(\d{8}T\d{6})-(\d{3})$/.exec(String(record?.id ?? ''))
    if (match === null || match[1] !== stamp) continue
    const seq = Number.parseInt(match[2], 10)
    if (seq > max) max = seq
  }
  return max + 1
}

/**
 * 解析已有的 `notes.jsonl`（只取 id，用来算序号；坏行跳过）。
 * @param {string} text
 * @returns {{id: string}[]}
 */
export function existingIds(text) {
  const records = []
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    try {
      const parsed = JSON.parse(line)
      if (typeof parsed?.id === 'string') records.push({ id: parsed.id })
    } catch {
      // 坏行跳过：它不该阻止我写一条新记录
    }
  }
  return records
}

/**
 * 清洗要写进 `quote` / `note` 的文本（剥情绪标记与 markdown，压成一行）。
 * @param {unknown} text
 * @returns {string}
 */
export function cleanRecordText(text) {
  return stripMarkdown(stripEmotionMarkers(String(text ?? ''))).replace(/\s+/g, ' ').trim()
}

/**
 * 组装一条 `group_question` 记录（**纯函数**，不碰盘）。
 *
 * @param {object} input
 * @param {number} input.now - epoch ms
 * @param {string} input.session - 宿主 sessionId（拿不到时用引擎同款兜底 `unknown`）
 * @param {number} input.lesson
 * @param {number} input.turn
 * @param {string|null} input.kp - 已经在 `knowledge_points.md` 里核对过存在（否则调用方传 null）
 * @param {string} input.quote - 学生的原话
 * @param {string} [input.note]
 * @param {{id: string}[]} input.records - 已有记录（算序号）
 * @returns {object}
 * @throws {Error} quote 清洗后为空
 */
export function buildGroupQuestionRecord({ now, session, lesson, turn, kp, quote, note = '', records = [] }) {
  const cleaned = cleanRecordText(quote).slice(0, MAX_QUOTE_CHARS)
  if (cleaned === '') throw new Error('group_question 的 quote 清洗后为空 —— 不写空原话的记录（K3.2）')
  const stamp = idStamp(now)
  const seq = nextSeqFor(records, stamp)
  if (seq > 999) throw new Error(`同一秒内记录过多（序号 ${seq} > 999）`)
  return {
    v: 1,
    id: `N-${stamp}-${String(seq).padStart(3, '0')}`,
    ts: isoWithOffset(now),
    session: typeof session === 'string' && session !== '' ? session : 'unknown',
    lesson: Number.isInteger(lesson) ? lesson : 0,
    turn: Number.isInteger(turn) ? turn : 0,
    type: GROUP_QUESTION,
    kp: typeof kp === 'string' && kp !== '' ? kp : null,
    quote: cleaned,
    note: cleanRecordText(note).slice(0, MAX_NOTE_CHARS),
    origin: GROUP_ORIGIN,
  }
}

/**
 * 一条记录的落盘行（字段顺序与引擎 `renderNoteLine` 一致，**不写 `resolved`**）。
 * @param {object} record
 * @returns {string}
 */
export function renderNoteLine(record) {
  const ordered = {
    v: 1,
    id: record.id,
    ts: record.ts,
    session: record.session,
    lesson: record.lesson,
    turn: record.turn,
    type: record.type,
    kp: record.kp ?? null,
    quote: record.quote,
    note: record.note ?? '',
    origin: record.origin,
  }
  const line = `${JSON.stringify(ordered)}\n`
  const bytes = Buffer.byteLength(line, 'utf8')
  if (bytes >= 4096) throw new Error(`一条记录有 ${bytes} 字节，超过 O_APPEND 的原子写上限（4KB）`)
  return line
}

/**
 * 追加一条 `group_question` 记录。**只追加，不重算投影。**
 *
 * @param {object} options
 * @param {string} options.classroomDir
 * @param {number} options.now
 * @param {string} options.session
 * @param {number} options.lesson
 * @param {number} [options.turn]
 * @param {string|null} [options.kp]
 * @param {string} options.quote
 * @param {string} [options.note]
 * @returns {Promise<object>} 写进去的那条记录
 */
export async function appendGroupQuestion({ classroomDir, now, session, lesson, turn = 0, kp = null, quote, note = '' }) {
  const file = join(classroomDir, NOTES_RELATIVE)
  return withFileLock(`${file}.lock`, async () => {
    const previous = await readFile(file, 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') return ''
      throw error
    })
    const record = buildGroupQuestionRecord({ now, session, lesson, turn, kp, quote, note, records: existingIds(previous) })
    const line = renderNoteLine(record)
    await mkdir(dirname(file), { recursive: true })
    const handle = await open(file, 'a', 0o600)
    try {
      // 单行、一次 write：O_APPEND 原子追加；**不做整文件重写**（那会与引擎抢同一个文件）。
      // 上一份内容没有以换行结尾（手改过的文件）时先补一个换行，否则新记录会黏在上一行末尾。
      await handle.write(previous === '' || previous.endsWith('\n') ? line : `\n${line}`)
      await handle.sync()
    } finally {
      await handle.close()
    }
    return record
  })
}
