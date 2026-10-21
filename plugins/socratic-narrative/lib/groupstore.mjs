// lib/groupstore.mjs — 群聊存储：真源 `runtime/wechat_group.jsonl`，`wechat_group.md` 是机械投影
//
// 契约：K4.2（字段）、K4.3（读法/并发）、开发文档 N3.2（单一真源）。
//
// 🔴 为什么真源是 JSONL 而不是 markdown（N3.2 要我判断并写明理由）：
//   · 未读要用 `seq` 单调递增来算（K4.2 写死「seq 是排序与未读的唯一依据」）；markdown 里没有
//     可靠的序号，靠解析行序 = 让「未读」依赖解析器的稳定性。
//   · 两个标签页同时发言不能丢消息（K4.3 的 AC）：一行一条 JSON 的追加在 `O_APPEND` 下是单个
//     写操作，不会把别人的行冲掉；整文件重写（markdown 必须如此）一定会在「读—改—写」之间丢写。
//   · 坏数据隔离：一行坏 JSON 只丢那一行（坏行计数上报），markdown 一处坏格式会让整份读废。
//
// 时间口径：`ts` 一律 `+08:00`（北京时间）。EC 明写「服务器时钟不可信」，群聊的一切时间语义
// （N4 的 8:00–23:00）都在北京时间，所以记录也按同一口径写，不跟随进程本地时区。
//
// 并发：追加 + 投影重写整体走 `lib/lock.mjs` 的跨进程锁；同一进程内再加一条串行队列
// （`lib/serial.mjs`），保证同进程的两个标签页请求不会互相等锁超时。

import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { exists, writeFileAtomic } from './atomic.mjs'
import { withFileLock } from './lock.mjs'
import { createSerialQueue } from './serial.mjs'
import { beijingIso, beijingShort, beijingStamp, DAY_MS } from './time.mjs'

/** 真源（相对教室目录）。 */
export const GROUP_RELATIVE = join('runtime', 'wechat_group.jsonl')
/** 人读投影（相对教室目录）。 */
export const GROUP_PROJECTION_RELATIVE = join('runtime', 'wechat_group.md')
/** 群聊的运行状态（未读游标、待回复的批次、课堂状态镜像）——不是消息。 */
export const GROUP_STATE_RELATIVE = join('runtime', '.narrative', 'group-state.json')

/** K4.2 的三种 role。 */
export const ROLES = Object.freeze(['student', 'character', 'system'])
/** K4.2 的三种 kind（`typing` 不落盘，见 K4.3）。 */
export const KINDS = Object.freeze(['message', 'open'])

/** 学生发言的显示名（K4.2 的示例就是 `你`）。 */
export const STUDENT_SPEAKER = '你'

/** 一条消息的字段顺序（与 K4.2 的示例一致，投影与测试都按这个顺序看）。 */
const FIELD_ORDER = ['v', 'seq', 'id', 'ts', 'role', 'speaker', 'text', 'clientId', 'kind']

/**
 * 建一个群聊存储。
 *
 * @param {object} options
 * @param {string} options.classroomDir
 * @param {() => number} [options.now]
 * @param {typeof withFileLock} [options.lock] - 测试可注入（例如"锁永远拿不到"）
 */
export function createGroupStore({ classroomDir, now = () => Date.now(), lock = withFileLock }) {
  const file = join(classroomDir, GROUP_RELATIVE)
  const projectionFile = join(classroomDir, GROUP_PROJECTION_RELATIVE)
  const stateFile = join(classroomDir, GROUP_STATE_RELATIVE)
  const queue = createSerialQueue()

  /**
   * 全部消息（坏行跳过并计数）。
   * @returns {Promise<{messages: object[], bad: number, maxSeq: number}>}
   */
  async function readAll() {
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return { messages: [], bad: 0, maxSeq: 0 }
      throw error
    }
    return parseMessages(text)
  }

  /**
   * 追加一条消息（分配 seq、写盘、重画投影）。**clientId 幂等**：同一 clientId 只落一条。
   *
   * @param {{role: string, speaker: string, text: string, clientId?: string|null, kind?: string}} input
   * @returns {Promise<{message: object, duplicated: boolean, messages: number}>}
   */
  async function append(input) {
    return queue.run(file, () =>
      lock(`${file}.lock`, async () => {
        const current = await readAll()
        const clientId = input.clientId ?? null
        if (clientId !== null) {
          const existing = current.messages.find((message) => message.clientId === clientId)
          if (existing !== undefined) return { message: existing, duplicated: true, messages: current.messages.length }
        }
        const seq = current.maxSeq + 1
        const at = now()
        const message = {
          v: 1,
          seq,
          id: `G-${beijingStamp(at)}-${String(seq).padStart(3, '0')}`,
          ts: beijingIso(at),
          role: input.role,
          speaker: input.speaker,
          text: input.text,
          clientId,
          kind: input.kind ?? 'message',
        }
        validateMessageShape(message)
        await mkdir(dirname(file), { recursive: true })
        const handle = await open(file, 'a', 0o600)
        try {
          // 单行、一次 write：O_APPEND 下一行小于 PIPE_BUF 的写入不会被别的写者切开
          await handle.write(`${renderMessageLine(message)}\n`)
          await handle.sync()
        } finally {
          await handle.close()
        }
        const messages = [...current.messages, message]
        await writeProjection(messages)
        return { message, duplicated: false, messages: messages.length }
      }),
    )
  }

  /**
   * 重画 `wechat_group.md`（机械投影，内容没变就不写盘，避免无意义的 mtime 抖动）。
   * @param {object[]} messages
   */
  async function writeProjection(messages) {
    const next = renderProjection(messages)
    const previous = await readFile(projectionFile, 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') return null
      throw error
    })
    if (previous === next) return
    await writeFileAtomic(projectionFile, next)
  }

  /**
   * 群聊运行状态（未读游标 / 待回复批次 / 课堂镜像）。文件不存在或**内容坏掉**都回默认值，
   * 并把损坏情况报给调用方（`state().corrupt === true`），**不抛**——坏状态不该让群聊打不开。
   * @returns {Promise<object>}
   */
  async function readState() {
    const fallback = { v: 1, readSeq: 0, pending: null, lastReplyError: null, classroom: null, openAttempts: 0, updatedAt: null }
    let text
    try {
      text = await readFile(stateFile, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return { ...fallback, corrupt: false }
      throw error
    }
    try {
      const parsed = JSON.parse(text)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...fallback, corrupt: true }
      return {
        v: 1,
        readSeq: Number.isInteger(parsed.readSeq) && parsed.readSeq > 0 ? parsed.readSeq : 0,
        pending: normalizePending(parsed.pending),
        lastReplyError: parsed.lastReplyError ?? null,
        classroom: parsed.classroom ?? null,
        openAttempts: Number.isInteger(parsed.openAttempts) ? parsed.openAttempts : 0,
        updatedAt: parsed.updatedAt ?? null,
        corrupt: false,
      }
    } catch {
      return { ...fallback, corrupt: true }
    }
  }

  /**
   * 原子保存群聊状态（在业务锁内调用，调用方负责串行）。
   * @param {object} patch - 只覆盖给定的键
   * @returns {Promise<object>} 保存后的状态
   */
  async function saveState(patch) {
    return queue.run(`${file}#state`, () =>
      lock(`${stateFile}.lock`, async () => {
        const current = await readState()
        const next = {
          v: 1,
          readSeq: Number.isInteger(patch?.readSeq) ? patch.readSeq : current.readSeq,
          pending: patch?.pending === undefined ? current.pending : normalizePending(patch.pending),
          lastReplyError: patch?.lastReplyError === undefined ? current.lastReplyError : patch.lastReplyError,
          classroom: patch?.classroom === undefined ? current.classroom : patch.classroom,
          openAttempts: Number.isInteger(patch?.openAttempts) ? patch.openAttempts : current.openAttempts,
          updatedAt: now(),
        }
        await mkdir(dirname(stateFile), { recursive: true })
        await writeFileAtomic(stateFile, `${JSON.stringify(next, null, 0)}\n`)
        return { ...next, corrupt: false }
      }),
    )
  }

  /** @returns {Promise<boolean>} 真源是否还没写过任何消息（N3.7 的首次启动判据）。 */
  async function isFirstLaunch() {
    return (await readAll()).messages.length === 0
  }

  return {
    file,
    projectionFile,
    stateFile,
    readAll,
    append,
    readState,
    saveState,
    isFirstLaunch,
    /** 投影文件的绝对路径（测试与自检用）。 */
    async hasProjection() {
      return exists(projectionFile)
    },
    async removeAll() {
      await rm(file, { force: true })
      await rm(projectionFile, { force: true })
      await rm(stateFile, { force: true })
    },
  }
}

/**
 * 解析 JSONL 全文。
 * @param {string} text
 * @returns {{messages: object[], bad: number, maxSeq: number}}
 */
export function parseMessages(text) {
  const messages = []
  let bad = 0
  let maxSeq = 0
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      bad += 1
      continue
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.v !== 1) {
      bad += 1
      continue
    }
    if (!Number.isInteger(parsed.seq) || parsed.seq < 1 || typeof parsed.text !== 'string' || !ROLES.includes(parsed.role)) {
      bad += 1
      continue
    }
    const message = {
      v: 1,
      seq: parsed.seq,
      id: String(parsed.id ?? ''),
      ts: String(parsed.ts ?? ''),
      role: parsed.role,
      speaker: String(parsed.speaker ?? ''),
      text: parsed.text,
      clientId: parsed.clientId === null || parsed.clientId === undefined ? null : String(parsed.clientId),
      kind: KINDS.includes(parsed.kind) ? parsed.kind : 'message',
    }
    messages.push(message)
    if (message.seq > maxSeq) maxSeq = message.seq
  }
  messages.sort((a, b) => a.seq - b.seq)
  return { messages, bad, maxSeq }
}

/**
 * 一条消息序列化成一行（字段顺序固定，**多余字段不写**）。
 * @param {object} message
 * @returns {string}
 */
export function renderMessageLine(message) {
  const ordered = {}
  for (const field of FIELD_ORDER) ordered[field] = message[field] === undefined ? null : message[field]
  return JSON.stringify(ordered)
}

/**
 * 把消息写成可读的 markdown 投影。
 *
 * 投影是**全量重画**（每次追加后重写整份）：它只是给人看的副本，没有增量状态可丢。
 * @param {object[]} messages
 * @returns {string}
 */
export function renderProjection(messages) {
  const lines = [
    '> 本文件由 `runtime/wechat_group.jsonl` 机械生成，请勿手改。真源是那份 JSONL；这里只是给人看的副本。',
    '',
    '# 群聊记录',
    '',
  ]
  if (messages.length === 0) {
    lines.push('（群里还没有消息。首次启动时由群聊 agent 发一条开场消息。）')
    lines.push('')
    return lines.join('\n')
  }
  for (const message of messages) {
    const at = message.ts === '' ? '' : beijingShort(Date.parse(message.ts))
    const who = message.speaker === '' ? message.role : message.speaker
    const body = message.text.split('\n').map((line, index) => (index === 0 ? line : `  ${line}`)).join('\n')
    lines.push(`- \`${at}\` **${who}**：${body}`)
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * 形状校验（写入前）。字段缺失/类型不对在**写盘前**就抛，别把坏数据交给读者。
 * @param {object} message
 */
export function validateMessageShape(message) {
  const problems = []
  if (message.v !== 1) problems.push('v 必须是 1')
  if (!Number.isInteger(message.seq) || message.seq < 1) problems.push('seq 必须是正整数')
  if (typeof message.id !== 'string' || !/^G-\d{8}T\d{6}-\d{3}$/.test(message.id)) problems.push('id 形状必须是 G-<yyyymmddTHHmmss>-<三位序号>')
  if (typeof message.ts !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(message.ts)) problems.push('ts 必须是 +08:00 的 ISO 8601')
  if (!ROLES.includes(message.role)) problems.push(`role 必须是 ${ROLES.join('/')}`)
  if (typeof message.speaker !== 'string' || message.speaker.trim() === '') problems.push('speaker 不能为空')
  if (typeof message.text !== 'string' || message.text.trim() === '') problems.push('text 不能为空')
  if (!KINDS.includes(message.kind)) problems.push(`kind 必须是 ${KINDS.join('/')}`)
  if (message.clientId !== null && typeof message.clientId !== 'string') problems.push('clientId 只能是字符串或 null')
  if (problems.length > 0) throw new Error(`群聊消息形状不合法：${problems.join('；')}`)
}

/**
 * 待回复批次的形状归一（坏形状当作「没有待回复」，不猜）。
 * @param {unknown} value
 * @returns {null | {sinceSeq: number, studentSeqs: number[], dueAt: number, attempts: number, createdAt: number}}
 */
function normalizePending(value) {
  if (value === null || typeof value !== 'object') return null
  if (!Number.isInteger(value.dueAt) || !Number.isInteger(value.sinceSeq)) return null
  return {
    sinceSeq: value.sinceSeq,
    studentSeqs: Array.isArray(value.studentSeqs) ? value.studentSeqs.filter((n) => Number.isInteger(n)) : [],
    dueAt: value.dueAt,
    attempts: Number.isInteger(value.attempts) ? value.attempts : 0,
    createdAt: Number.isInteger(value.createdAt) ? value.createdAt : value.dueAt,
  }
}

/** 一天的毫秒数（导出给测试算「跨天」用，避免测试自己写 86400000）。 */
export { DAY_MS }
