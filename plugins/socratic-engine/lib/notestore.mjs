// lib/notestore.mjs — 课堂记录（`classroom_note` 工具）的**确定性落盘层**
//
// 契约：`docs/计划与排产/契约_功能开发_2026-10-20.md` 的 **K3**（课堂记录）。
//   开发文档条目：§四 A（A1–A6）。本文件是 K3.1/K3.2/K3.3 的实现，
//   注入侧的声明在 `classrooms/cs-os/classroom.yaml`（K3.4），
//   什么时候该调工具写在 `classrooms/cs-os/{system_core.md,_anchor.md}`（A5）。
//
// ── 单一真源：`<教室>/runtime/notes.jsonl`（K3.1）────────────────────────────
//   三份 markdown 是**从 JSONL 机械重算出来的投影**，整文件重写：
//     · `runtime/mistake_log.md`          每条 misconception / blocker 一行（已解决的保留并标注）
//     · `runtime/review_queue.md`         到期点 = 记录时讲次 + 1/3/7（≤ 总讲数）
//     · `knowledge_points.md` 的状态位     `[ ]` / `[~]` / `[x]`（跳过讲次不动）
//   投影文件头一律写「本文件由 runtime/notes.jsonl 机械生成，请勿手改。」。
//   🔴 为什么不拿 markdown 当真源：要机械推导就必须解析 markdown 表格，那是不确定性的来源，
//      也无法保证幂等与并发安全（K3.1 的裁定理由，此处不复述细节）。
//
// ── 红线（开发文档 §四 A、仓库红线第 1 条）──────────────────────────────────
//   🔴 **不许把「老师讲过」推导成 `[x]`**：`[x]` 的唯一来源是 `type: evidence` 的记录，
//      而记录只在**有学生原话作证据**时由老师当场写下（工具要求 `quote` 非空）。
//      本模块没有任何"按讲解行为推断掌握"的路径，也没有任何 LLM 参与。
//   🔴 全部推导是**纯函数 + 可单测**：排序键、三档状态、已解决、到期点、跳过讲次，逐条有单测
//      （见 test/notestore.test.mjs；规则同时写在 README.md 的「课堂记录」段）。
//
// ── K3.2 记录字段（一行一条 JSON，UTF-8，`\n` 结尾）─────────────────────────
//   { v:1, id:"N-<yyyyMMddTHHmmss>-<三位序号>", ts:"<带时区的 ISO 8601>",
//     session, lesson, turn, type, kp, quote, note, origin:"teacher", resolved:false }
//   `resolved` **不由工具写入**（写回时忽略输入值），是投影时机械推导出来的。
//
// ── IO 口径（与 lib/postclass.mjs 一致，逐字沿用）────────────────────────────
//   原子写用宿主的 `@deepseek-ai/dsh-atomic-write`（`writeFileAtomic` + `withFileLock`），
//   权限 0600（教室 runtime/ 既有文件就是 `-rw-------`，实测见 postclass.mjs）。
//   动态 import：单测环境没有宿主也能加载本模块（测试注入 `io`）。
//
// ⚠️ 诚实边界（写进实现报告）：
//   · `progress.md` 本模块**只读不写**。K3.3.4 只说"维护已存在的机器可读行"，
//     而 `current_lesson` 的写回是**模型课后更新**的职责（AGENTS.md 的清单）——
//     课中工具若也写它，两边会抢同一个文件。本模块读 `current_lesson`（判定到期）
//     与可选的 `skipped_lessons:` 行（判定跳过讲次，J2 红线；J 尚未实现，缺该行＝无跳过）。
//   · `totalLessons` 取自 `knowledge_points.md` 里出现过的最大讲次号（确定性，不依赖 manifest）。

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from './atomic-write.mjs'
import { stripEmotionMarkers } from './emotionmark.mjs'

/** 真源文件名（相对教室 `runtime/`）。 */
export const NOTES_FILE = 'notes.jsonl'
/** 投影 1：错题本。 */
export const MISTAKE_LOG_FILE = 'mistake_log.md'
/** 投影 2：间隔复习队列。 */
export const REVIEW_QUEUE_FILE = 'review_queue.md'
/** 投影 3：知识点清单（只改状态位）。 */
export const KP_FILE = 'knowledge_points.md'
/** 到期推导要读的进度文件（只读）。 */
export const PROGRESS_FILE = 'progress.md'

/** 三份投影文件头必须逐字包含这一行（K3.1）。 */
export const GENERATED_LINE = '> 本文件由 runtime/notes.jsonl 机械生成，请勿手改。'

/** 记录类型（K3.2 的四类，顺序即报错文案里的呈现顺序）。 */
export const NOTE_TYPES = ['misconception', 'blocker', 'evidence', 'group_question']

/** 类型 → 人读标签（三份投影与工具返回值共用，避免两处各写一份）。 */
export const NOTE_TYPE_LABELS = {
  misconception: '误解',
  blocker: '卡点',
  evidence: '掌握证据',
  group_question: '群里提的问题',
}

/** 参与「三档状态 / 复习队列」推导的类型（`group_question` 不参与，K3.3）。 */
export const LEARNING_TYPES = ['misconception', 'blocker', 'evidence']

/** 复习间隔（相对记录时的讲次，K3.3-3）。 */
export const REVIEW_INTERVALS = [1, 3, 7]

/** 字段长度上限（只防病态输入，不改变语义）。 */
export const MAX_QUOTE_CHARS = 2000
export const MAX_NOTE_CHARS = 500

/** 教室 runtime 文件权限位（实测 `-rw-------`）。 */
export const DEFAULT_FILE_MODE = 0o600

/** 知识点编号形状：`KP-<讲>.<序>`。 */
export const KP_ID_RE = /^KP-(\d+)\.(\d+)$/

// ─────────────────────────────────────────────────────────────────────────────
// 文本清洗（落盘前按 K1 剥净情绪标记与 markdown）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 去掉 markdown 标记，只留可读文字。**纯函数**。
 *
 * 口径：只剥"格式"，不改字——去掉围栏/行内代码的反引号、标题井号、引用号、列表符号、
 * 链接与图片的目标、`*`/`**`/`~~` 强调符号。**不剥 `_`**：下划线在代码里是名字的一部分
 * （`fork_exec` 不能变成 `forkexec`），学生原话里出现下划线时宁可留着。
 *
 * @param {unknown} text
 * @returns {string}
 */
export function stripMarkdown(text) {
  let s = String(text ?? '')
  s = s.replace(/\r\n?/g, '\n')
  // 围栏：保留围栏内的文字，去掉围栏行本身（``` 与其语言标记）
  s = s.replace(/^[ \t]*```[^\n]*$/gm, '')
  s = s.replace(/`{1,2}([^`]*)`{1,2}/g, '$1')
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
  s = s.replace(/^[ \t]{0,3}>[ \t]?/gm, '')
  s = s.replace(/^[ \t]*[-*+][ \t]+/gm, '')
  s = s.replace(/^[ \t]*\d+[.)][ \t]+/gm, '')
  s = s.replace(/\*\*([\s\S]*?)\*\*/g, '$1')
  s = s.replace(/\*([^*\n]+)\*/g, '$1')
  s = s.replace(/~~([\s\S]*?)~~/g, '$1')
  // 落单的强调符号（如整串只有 `**`）：格式符号本身不构成原话，清掉
  s = s.replace(/\*+/g, '').replace(/~~/g, '')
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * 落盘前的完整清洗：**先按 K1 剥情绪标记，再去 markdown 格式**。**纯函数**。
 *
 * 为什么顺序固定：情绪标记是 `〔emo:label:intensity〕`（全角括号，且只有以 `emo:` 开头的括号对
 * 才是标记），不是 markdown；先剥它能避免它被 markdown 规则误伤成"半截"。两步都是幂等的
 * （对同一输入重复调用结果不变）。
 * 防御性：`classroom_note` 的原话可能来自历史会话或别的写入者（K1.2 末、K1.5）。
 *
 * @param {unknown} text
 * @returns {string}
 */
export function cleanRecordText(text) {
  return stripMarkdown(stripEmotionMarkers(String(text ?? '')))
}

// ─────────────────────────────────────────────────────────────────────────────
// JSONL 读写（纯函数部分）
// ─────────────────────────────────────────────────────────────────────────────

/** 两位补零。 */
function pad2(n) {
  return String(Math.abs(n)).padStart(2, '0')
}

/**
 * 带本地时区偏移的 ISO 8601（K3.2 要求 `ts` 带时区）。**纯函数**。
 * @param {number} ms - 毫秒时间戳
 * @returns {string} 形如 `2026-10-20T23:15:00-04:00`
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
 * id 里的时间戳（**本地时间**，与 `ts` 同口径）。**纯函数**。
 * @param {number} ms
 * @returns {string} 形如 `20261020T231500`
 */
export function idStamp(ms) {
  const d = new Date(ms)
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  )
}

/**
 * 生成记录 id：`N-<yyyyMMddTHHmmss>-<三位序号>`（K3.2）。**纯函数**。
 * @param {string} stamp - `idStamp()` 的产物
 * @param {number} seq - 1..999
 * @returns {string}
 */
export function noteIdOf(stamp, seq) {
  if (!Number.isInteger(seq) || seq < 1 || seq > 999) {
    throw new Error(`记录序号必须是 1..999 的整数（得到 ${JSON.stringify(seq)}）—— 同一秒内写入过多`)
  }
  return `N-${stamp}-${String(seq).padStart(3, '0')}`
}

/** 从 id 里取出 `<stamp>`（解析失败返回 null）。 */
export function stampOfId(id) {
  const m = /^N-(\d{8}T\d{6})-\d{3}$/.exec(String(id ?? ''))
  return m === null ? null : m[1]
}

/**
 * 同一秒内的下一个序号（= 该 stamp 下已有 id 的最大序号 + 1）。**纯函数**。
 * @param {{id:string}[]} records
 * @param {string} stamp
 * @returns {number}
 */
export function nextSeqFor(records, stamp) {
  let max = 0
  for (const record of records ?? []) {
    if (stampOfId(record?.id) !== stamp) continue
    const seq = Number.parseInt(String(record.id).slice(-3), 10)
    if (Number.isInteger(seq) && seq > max) max = seq
  }
  return max + 1
}

/**
 * 解析 `notes.jsonl` 全文。**纯函数**：坏行跳过并**如实报告**（不静默、不猜）。
 *
 * @param {string|null|undefined} content
 * @returns {{records: object[], bad: {line:number, reason:string}[]}}
 */
export function parseNotesJsonl(content) {
  const records = []
  const bad = []
  const lines = String(content ?? '').split('\n')
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (line === '') return
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch (cause) {
      bad.push({ line: i + 1, reason: `不是合法 JSON（${cause?.message ?? cause}）` })
      return
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      bad.push({ line: i + 1, reason: '不是 JSON 对象' })
      return
    }
    if (parsed.v !== 1) {
      bad.push({ line: i + 1, reason: `未知的记录版本 v=${JSON.stringify(parsed.v)}（本模块只认 v=1）` })
      return
    }
    records.push({
      v: 1,
      id: String(parsed.id ?? ''),
      ts: String(parsed.ts ?? ''),
      session: String(parsed.session ?? ''),
      lesson: Number.isInteger(parsed.lesson) ? parsed.lesson : 0,
      turn: Number.isInteger(parsed.turn) ? parsed.turn : 0,
      type: String(parsed.type ?? ''),
      kp: parsed.kp === null || parsed.kp === undefined ? null : String(parsed.kp),
      quote: String(parsed.quote ?? ''),
      note: String(parsed.note ?? ''),
      origin: String(parsed.origin ?? ''),
    })
  })
  return { records, bad }
}

/**
 * 排序：`(lesson, turn, id)` 字典序 —— K3.3 规定的"时间序"。**纯函数**。
 * `id` 自带 `<时间戳>-<序号>`，故同讲同回合内它等价于写盘次序。
 */
export function compareNotes(a, b) {
  if (a.lesson !== b.lesson) return a.lesson - b.lesson
  if (a.turn !== b.turn) return a.turn - b.turn
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0
}

/** 排序副本。 */
export function sortNotes(records) {
  return [...(records ?? [])].sort(compareNotes)
}

/**
 * 把一条记录序列化成一行 JSONL（字段顺序固定，`\n` 结尾）。**纯函数**。
 * `resolved` 不写（K3.2：仅投影用）。
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
  return `${JSON.stringify(ordered)}\n`
}

/**
 * 把一行追加进 JSONL 全文（保持原有行，不重排、不改写）。**纯函数**。
 * @param {string|null|undefined} content
 * @param {string} line - `renderNoteLine()` 的产物（含结尾换行）
 * @returns {string}
 */
export function appendNoteLine(content, line) {
  const base = String(content ?? '')
  if (base === '') return line
  return base.endsWith('\n') ? `${base}${line}` : `${base}\n${line}`
}

// ─────────────────────────────────────────────────────────────────────────────
// 知识点清单 / 进度文件的解析（纯函数）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 解析 `knowledge_points.md`：每条知识点一行，形如
 * `- [ ] **KP-1.1 进程是什么** —— 判据：…`。
 * **纯函数**。
 *
 * @param {string} text
 * @returns {{items: {kp:string, lesson:number, status:' '|'~'|'x', title:string, line:number}[],
 *            byId: Map<string, object>, totalLessons: number}}
 */
export function parseKnowledgePoints(text) {
  const items = []
  const byId = new Map()
  let totalLessons = 0
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const m = /^\s*[-*+]\s+\[([ ~x])\]\s*(.*)$/.exec(raw)
      if (m === null) return
      const rest = m[2]
      const idMatch = /\*\*(KP-\d+\.\d+)\b/.exec(rest)
      if (idMatch === null) return
      const kp = idMatch[1]
      const parts = KP_ID_RE.exec(kp)
      const lesson = parts === null ? 0 : Number.parseInt(parts[1], 10)
      const title = rest.replace(/^\*\*[^*]*\*\*\s*/, '').trim()
      const item = { kp, lesson, status: m[1], title, line: index }
      items.push(item)
      if (!byId.has(kp)) byId.set(kp, item)
      if (lesson > totalLessons) totalLessons = lesson
    })
  return { items, byId, totalLessons }
}

/**
 * 读 `progress.md` 的机器可读行。**纯函数**。
 *
 * 只读两行（都按「行首 `<key>: <值>`」解析，容忍行内 `#` 注释与列表前缀，与
 * lib/manifest.mjs 的 parseStateLine 同口径）：
 *   · `current_lesson: <int>`  —— 本轮要讲的讲次（引擎与面板都读这一行）
 *   · `skipped_lessons: 2,3`   —— 跳过的讲次（J2；J 未实现时该行不存在＝没有跳过）
 *
 * @param {string} text
 * @returns {{currentLesson: number|null, skippedLessons: Set<number>}}
 */
export function readProgressState(text) {
  let currentLesson = null
  let skippedLessons = new Set()
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*-\s+/, '').replace(/\s*#.*$/, '').trim()
    if (line === '') continue
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line)
    if (m === null) continue
    if (m[1] === 'current_lesson' && /^\d+$/.test(m[2].trim())) {
      currentLesson = Number.parseInt(m[2].trim(), 10)
    } else if (m[1] === 'skipped_lessons') {
      skippedLessons = new Set(
        m[2]
          .split(/[,，\s]+/)
          .map((token) => token.trim())
          .filter((token) => /^\d+$/.test(token))
          .map((token) => Number.parseInt(token, 10)),
      )
    }
  }
  return { currentLesson, skippedLessons }
}

// ─────────────────────────────────────────────────────────────────────────────
// 推导（K3.3，确定性、可单测）
// ─────────────────────────────────────────────────────────────────────────────

/** 记录是否属于"学习类"（参与状态位/复习推导）。 */
function isLearning(record) {
  return LEARNING_TYPES.includes(record?.type)
}

/**
 * 按 K3.3 机械推导三份投影需要的全部事实。**纯函数**。
 *
 * 规则（逐条与 K3.3 对齐，README 另有一份人读版）：
 *   ① `kpStates`：对每个 `kp`，取时间序（lesson,turn,id）最后一条学习类记录——
 *      `evidence` → `x`；`misconception`/`blocker` → `~`；没有记录 → 不在表里（**不动原文件**）。
 *      该 kp 所属讲次被跳过 → `skipped: true`，状态位不动，条目末尾加「（跳过）」。
 *      🔴 「老师讲过」不产生记录，故永远推导不出 `x`。
 *   ② `mistakes`：每条 misconception/blocker 一条；`resolved` = 同 kp 上存在**更晚**的 evidence。
 *   ③ `review`：每条 misconception/blocker 生成到期点 `lesson + {1,3,7}`（≤ totalLessons）；
 *      同一 kp 多条只按**最早一条**排期；`resolved` 后不再到期（后续到期点作废）；
 *      `lesson <= 0`（无讲次门）不生成到期点。
 *
 * @param {object[]} records - parseNotesJsonl 的 records（未排序也行）
 * @param {{currentLesson?: number|null, totalLessons?: number|null, skippedLessons?: Set<number>}} [ctx]
 * @returns {{sorted: object[],
 *            kpStates: Map<string, {kp:string, lesson:number, status:'x'|'~', lastType:string,
 *                                   record:object, skipped:boolean}>,
 *            mistakes: {record:object, resolved:boolean, resolvedBy:object|null}[],
 *            review: {kp:string, record:object, dueLessons:number[], duePoint:number|null,
 *                     resolved:boolean, skipped:boolean}[]}}
 */
export function deriveNotes(records, ctx = {}) {
  const currentLesson = Number.isInteger(ctx.currentLesson) ? ctx.currentLesson : null
  const totalLessons = Number.isInteger(ctx.totalLessons) && ctx.totalLessons > 0 ? ctx.totalLessons : null
  const skipped = ctx.skippedLessons instanceof Set ? ctx.skippedLessons : new Set()
  const sorted = sortNotes(records)

  // ① 三档状态：每个 kp 的最后一条学习类记录
  const kpStates = new Map()
  for (const record of sorted) {
    if (!isLearning(record) || !record.kp) continue
    const parts = KP_ID_RE.exec(record.kp)
    const lesson = parts === null ? 0 : Number.parseInt(parts[1], 10)
    kpStates.set(record.kp, {
      kp: record.kp,
      lesson,
      status: record.type === 'evidence' ? 'x' : '~',
      lastType: record.type,
      record,
      skipped: skipped.has(lesson),
    })
  }

  // ② 错题本：每条 misconception/blocker 是否被"更晚的 evidence"解决
  const evidenceByKp = new Map()
  for (const record of sorted) {
    if (record.type !== 'evidence' || !record.kp) continue
    evidenceByKp.set(record.kp, record) // sorted 是升序，最后写入的就是最晚的一条
  }
  const mistakes = sorted
    .filter((record) => record.type === 'misconception' || record.type === 'blocker')
    .map((record) => {
      const evidence = record.kp === null ? undefined : evidenceByKp.get(record.kp)
      const resolved = evidence !== undefined && compareNotes(evidence, record) > 0
      return { record, resolved, resolvedBy: resolved ? evidence : null }
    })

  // ③ 复习队列：同一 kp 只按最早一条排期
  const earliestByKp = new Map()
  for (const record of sorted) {
    if (record.type !== 'misconception' && record.type !== 'blocker') continue
    if (record.kp === null) continue
    if (!earliestByKp.has(record.kp)) earliestByKp.set(record.kp, record)
  }
  const resolvedOf = new Map(mistakes.map((m) => [m.record.id, m.resolved]))
  const review = []
  for (const [kp, record] of earliestByKp) {
    const parts = KP_ID_RE.exec(kp)
    const kpLesson = parts === null ? 0 : Number.parseInt(parts[1], 10)
    const dueLessons =
      record.lesson > 0
        ? REVIEW_INTERVALS.map((gap) => record.lesson + gap).filter(
            (due) => totalLessons === null || due <= totalLessons,
          )
        : []
    const resolved = resolvedOf.get(record.id) === true
    // 到期点取「**最近一个已经过去的**到期讲次」（不是最早那个）：投影上写的是
    // "这一条现在欠了几次复习"，写最早的那个会让人以为只欠一次。计划表 `dueLessons` 仍是全量。
    const passed = dueLessons.filter((due) => currentLesson !== null && currentLesson >= due)
    const duePoint = resolved || passed.length === 0 ? null : passed[passed.length - 1]
    review.push({ kp, record, dueLessons, duePoint, resolved, skipped: skipped.has(kpLesson) })
  }
  review.sort((a, b) => {
    const byRecord = compareNotes(a.record, b.record)
    return byRecord !== 0 ? byRecord : a.kp < b.kp ? -1 : a.kp > b.kp ? 1 : 0
  })

  return { sorted, kpStates, mistakes, review }
}

// ─────────────────────────────────────────────────────────────────────────────
// 投影渲染（三份 markdown，纯函数、整文件内容）
// ─────────────────────────────────────────────────────────────────────────────

/** 把单元格里的 `|` 与换行处理掉（markdown 表格安全）。 */
function cell(text, empty = '—') {
  const s = String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
  return s === '' ? empty : s
}

/** 讲次单元格：0 表示没有讲次门。 */
function lessonCell(lesson) {
  return Number.isInteger(lesson) && lesson > 0 ? `第 ${lesson} 讲` : '—'
}

/** 时间：`2026-10-20 23:15`（取 `ts` 的可读前缀，不改字）。 */
function timeCell(ts) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(ts ?? ''))
  return m === null ? cell(ts) : `${m[1]} ${m[2]}`
}

/**
 * 渲染错题本全文。**纯函数**（同输入必同输出，与磁盘状态无关）。
 * 段标题 `## 未解决` / `## 已解决` 被 `classroom.yaml` 的两块按 `section` 切片，
 * 改名必须同步改 manifest（引擎会报错并列出实际标题）。
 * @param {ReturnType<typeof deriveNotes>} derived
 * @returns {string}
 */
export function renderMistakeLog(derived) {
  const head = [
    `# 错题本（机械生成）`,
    '',
    GENERATED_LINE,
    '> 只列 `misconception`（误解）与 `blocker`（卡点）两类记录；「已解决」的判据是**同一知识点上有更晚的 `evidence` 记录**。',
    '> 已解决的记录**不删除**（真源是 `runtime/notes.jsonl`，本文件只是投影；人读的"不删旧记录"由真源保证）。',
    '',
  ]
  const rowOf = (item, extra = '') => {
    const r = item.record
    return (
      `| ${timeCell(r.ts)} | ${lessonCell(r.lesson)} | ${r.turn} | ${NOTE_TYPE_LABELS[r.type] ?? r.type} | ` +
      `${cell(r.kp)} | ${cell(r.quote)} | ${cell(r.note, '—')} |${extra === '' ? '' : ` ${extra} |`}`
    )
  }

  const open = derived.mistakes.filter((m) => !m.resolved)
  const closed = derived.mistakes.filter((m) => m.resolved)

  const lines = [...head, '## 未解决', '', '| 时间 | 讲次 | 回合 | 类型 | 知识点 | 学生原话 | 老师说明 |', '|---|---|---|---|---|---|---|']
  if (open.length === 0) lines.push('', '（暂无未解决的卡点或误解）')
  else for (const item of open) lines.push(rowOf(item))

  lines.push('', '## 已解决', '', '| 时间 | 讲次 | 回合 | 类型 | 知识点 | 学生原话 | 老师说明 | 解决于 |', '|---|---|---|---|---|---|---|---|')
  if (closed.length === 0) lines.push('', '（暂无已解决的记录）')
  else
    for (const item of closed) {
      const by = item.resolvedBy
      lines.push(rowOf(item, `已解决（${lessonCell(by.lesson)} · 第 ${by.turn} 回合）`))
    }
  return `${lines.join('\n').trimEnd()}\n`
}

/**
 * 渲染复习队列全文。**纯函数**。
 * 段标题 `## 到期待复习` / `## 全部复习计划` 被 manifest 切片（同上）。
 * @param {ReturnType<typeof deriveNotes>} derived
 * @param {{currentLesson?: number|null}} [ctx]
 * @returns {string}
 */
export function renderReviewQueue(derived, ctx = {}) {
  const currentLesson = Number.isInteger(ctx.currentLesson) ? ctx.currentLesson : null
  const head = [
    '# 间隔复习队列（机械生成）',
    '',
    GENERATED_LINE,
    '> 到期点 = 记录时的讲次 **+1 / +3 / +7**（只保留 ≤ 课程总讲数的；没有讲次的记录不排期）。',
    '> 同一知识点只按**最早一条**卡点/误解排期；条目「已解决」（同知识点上有更晚的 `evidence`）→ **后续到期点作废**。',
    `> 当前讲次：${currentLesson === null ? '（读不到 `runtime/progress.md` 的 `current_lesson`）' : `第 ${currentLesson} 讲`}；` +
      '「到期」＝ 当前讲次 ≥ 到期讲次且尚未解决。',
    '',
  ]
  const header = '| 知识点 | 首次记录 | 讲次 | 回合 | 到期讲次 | 状态 |'
  const rule = '|---|---|---|---|---|---|'
  const rowOf = (item) => {
    const r = item.record
    const status = item.resolved
      ? '已解决（后续到期点作废）'
      : item.duePoint !== null
        ? `**到期**（当前第 ${currentLesson} 讲 ≥ 第 ${item.duePoint} 讲）`
        : '未到期'
    const dues = item.dueLessons.length === 0 ? '—' : item.dueLessons.map((n) => `第 ${n} 讲`).join(' / ')
    return `| ${cell(item.kp)} | ${timeCell(r.ts)} | ${lessonCell(r.lesson)} | ${r.turn} | ${dues} | ${status} |`
  }

  const due = derived.review.filter((item) => item.duePoint !== null)
  const lines = [...head, '## 到期待复习', '', header, rule]
  if (due.length === 0) lines.push('', '（当前没有到期的复习项）')
  else for (const item of due) lines.push(rowOf(item))

  lines.push('', '## 全部复习计划', '', header, rule)
  if (derived.review.length === 0) lines.push('', '（还没有任何卡点或误解记录）')
  else for (const item of derived.review) lines.push(rowOf(item))
  return `${lines.join('\n').trimEnd()}\n`
}

/**
 * 把 `knowledge_points.md` 的状态位按推导结果重写。**纯函数**、**整文件重写**。
 *
 * 只动「有学习类记录」的 kp 所在行：把 `[ ]`/`[~]`/`[x]` 换成推导值；
 * 该 kp 所属讲次被跳过 → **状态位不动**，只在行尾加「（跳过）」（J2 红线）。
 * 没有记录的 kp **一个字都不动**（永远不写 `[x]`）。重复调用结果不变（幂等）。
 *
 * @param {string} text - knowledge_points.md 全文
 * @param {ReturnType<typeof deriveNotes>} derived
 * @returns {{text: string, changed: number}}
 */
export function applyKpProjection(text, derived) {
  let changed = 0
  const SKIP_TAG = /（跳过）\s*$/
  const out = String(text ?? '')
    .split('\n')
    .map((line) => {
      const m = /^(\s*[-*+]\s+)\[([ ~x])\](\s*.*)$/.exec(line)
      if (m === null) return line
      const idMatch = /\*\*(KP-\d+\.\d+)\b/.exec(m[3])
      if (idMatch === null) return line
      const state = derived.kpStates.get(idMatch[1])
      if (state === undefined) return line
      // 先把可能存在的旧标记去掉，保证幂等（重复推导不会叠加「（跳过）」）
      let rest = m[3].replace(SKIP_TAG, '').replace(/\s+$/, '')
      let status = m[2]
      if (state.skipped) {
        rest = `${rest}（跳过）`
      } else {
        status = state.status
      }
      const next = `${m[1]}[${status}]${rest}`
      if (next !== line) changed += 1
      return next
    })
    .join('\n')
  return { text: out, changed }
}

// ─────────────────────────────────────────────────────────────────────────────
// 入参校验（EC：kp 不存在 / quote 为空 → 明确报错，不静默落盘）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 校验一次 `classroom_note` 入参。**纯函数**：一次报全，错误文案写成模型下一轮能自己改的样子。
 *
 * @param {{type?:unknown, kp?:unknown, quote?:unknown, note?:unknown}} args
 * @param {{kps: Map<string, {kp:string}>|null}} env - `parseKnowledgePoints().byId`
 * @returns {{ok:boolean, problems:string[], value:{type:string, kp:string|null, quote:string, note:string}}}
 */
export function validateNoteArgs(args, env = {}) {
  const problems = []
  const type = typeof args?.type === 'string' ? args.type.trim() : ''
  if (type === '') {
    problems.push(`type 必填，且必须是下列之一：${NOTE_TYPES.join(' / ')}`)
  } else if (!NOTE_TYPES.includes(type)) {
    problems.push(`type=${JSON.stringify(type)} 不是支持的类型；可用：${NOTE_TYPES.join(' / ')}`)
  }

  const quote = cleanRecordText(args?.quote)
  if (quote === '') {
    problems.push(
      'quote 为空（或只有空白/markdown 标记）：quote 必须是**学生自己的原话**，逐字抄下来，' +
        '例如「fork 之后是不是从 main 开头重新跑？」。没有原话就没有证据，不能记。',
    )
  } else if (quote.length > MAX_QUOTE_CHARS) {
    problems.push(`quote 过长：${quote.length} 字符 > 上限 ${MAX_QUOTE_CHARS}（只抄关键的那一两句）`)
  }

  const note = cleanRecordText(args?.note)
  if (note.length > MAX_NOTE_CHARS) {
    problems.push(`note 过长：${note.length} 字符 > 上限 ${MAX_NOTE_CHARS}（一句话说明就够）`)
  }

  // kp：group_question 允许为空；其余必须真实存在（"kp 不存在 → 明确报错不落盘"）
  const rawKp = args?.kp
  let kp = null
  if (rawKp === undefined || rawKp === null || (typeof rawKp === 'string' && rawKp.trim() === '')) {
    if (type !== 'group_question' && type !== '') {
      problems.push(
        `kp 必填（type=${type}）：必须是 knowledge_points.md 里真实存在的知识点编号，形如 "KP-3.2"。` +
          '只有 group_question 可以不填。',
      )
    }
  } else if (typeof rawKp !== 'string') {
    problems.push(`kp 必须是字符串（知识点编号，形如 "KP-3.2"），得到 ${JSON.stringify(rawKp)}`)
  } else {
    kp = rawKp.trim()
    if (!KP_ID_RE.test(kp)) {
      problems.push(`kp=${JSON.stringify(kp)} 形状不对：必须是 "KP-<讲>.<序>"，如 "KP-3.2"`)
      kp = null
    } else if (env.kps instanceof Map && !env.kps.has(kp)) {
      const sample = [...env.kps.keys()].slice(0, 5).join(' / ')
      problems.push(
        `kp=${JSON.stringify(kp)} 在 knowledge_points.md 里不存在（本教室现有编号示例：${sample || '（文件里没有任何知识点行）'}）。` +
          '请先用文件工具读 knowledge_points.md 找到这一讲对应的编号，再调用。',
      )
      kp = null
    }
  }

  return { ok: problems.length === 0, problems, value: { type, kp, quote, note } }
}

/**
 * 同回合重复调用判据。**纯函数**。
 *
 * 🔴 不新造键：身份就是 `lib/postclass.mjs` 的 `turnMarker` 编码的同一对字段
 * （`session` + `turn`），再加**本条记录的内容指纹**（type/kp/cleaned quote）——
 * 同一个回合里把同一件事记两遍＝同一条记录，返回既有 id、不追加。
 * 同一回合记两条不同原话是合法的（学生说了两句不同的话）。
 *
 * @param {object[]} records
 * @param {{session:string, turn:number, type:string, kp:string|null, quote:string}} probe
 * @returns {object|null} 已存在的记录（视为重复），没有则 null
 */
export function findDuplicateNote(records, probe) {
  const want = `${probe.type}\u0000${probe.kp ?? ''}\u0000${probe.quote}`
  for (const record of records ?? []) {
    if (record.session !== probe.session || record.turn !== probe.turn) continue
    const have = `${record.type}\u0000${record.kp ?? ''}\u0000${record.quote}`
    if (have === want) return record
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// 落盘（IO 层）
// ─────────────────────────────────────────────────────────────────────────────

/** 原子写 IO（`lib/atomic-write.mjs`：与宿主 `@deepseek-ai/dsh-atomic-write` 同语义同签名）。 */
async function loadAtomicWrite() {
  return { writeFileAtomic, withFileLock }
}

/** 读文件，ENOENT → null（其余错误照样抛）。 */
async function readOrNull(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (cause) {
    if (cause?.code === 'ENOENT') return null
    throw cause
  }
}

/**
 * 课堂记录的落盘入口。
 *
 * @param {object} opts
 * @param {string} opts.classroomDir - 教室目录绝对路径（`knowledge_points.md` 在这里）
 * @param {string} opts.runtimeDir - 教室 `runtime/` 绝对路径（真源与两份投影在这里）
 * @param {() => number} [opts.now] - 取当前时间（默认 Date.now）
 * @param {{writeFileAtomic:Function, withFileLock:Function}} [opts.io] - 注入 IO（测试用）
 * @param {number} [opts.mode] - 权限位（默认 0600）
 * @param {(...args:any[])=>void} [opts.log]
 */
export function createNoteStore(opts = {}) {
  const { classroomDir, runtimeDir } = opts
  if (typeof classroomDir !== 'string' || classroomDir === '') {
    throw new Error('createNoteStore 需要 classroomDir（教室目录绝对路径）')
  }
  if (typeof runtimeDir !== 'string' || runtimeDir === '') {
    throw new Error('createNoteStore 需要 runtimeDir（教室 runtime/ 绝对路径）')
  }
  const now = opts.now ?? Date.now
  const mode = opts.mode ?? DEFAULT_FILE_MODE
  const log = opts.log ?? (() => {})
  let ioPromise = null
  const resolveIo = () => (ioPromise ??= opts.io ? Promise.resolve(opts.io) : loadAtomicWrite())

  const paths = {
    notes: join(runtimeDir, NOTES_FILE),
    mistakeLog: join(runtimeDir, MISTAKE_LOG_FILE),
    reviewQueue: join(runtimeDir, REVIEW_QUEUE_FILE),
    progress: join(runtimeDir, PROGRESS_FILE),
    kp: join(classroomDir, KP_FILE),
  }

  /** 读当前状态（真源 + 只读依赖），返回推导结果。 */
  async function load(io) {
    const [notesText, kpText, progressText] = await Promise.all([
      readOrNull(paths.notes),
      readOrNull(paths.kp),
      readOrNull(paths.progress),
    ])
    const parsedNotes = parseNotesJsonl(notesText)
    if (parsedNotes.bad.length > 0) {
      log(`notes.jsonl 有 ${parsedNotes.bad.length} 行坏行（已跳过）：${parsedNotes.bad.map((b) => `第 ${b.line} 行 ${b.reason}`).join('；')}`)
    }
    const kpParsed = parseKnowledgePoints(kpText ?? '')
    const progress = readProgressState(progressText ?? '')
    return { notesText, notes: parsedNotes.records, kpText: kpText ?? '', kpParsed, progress }
  }

  /**
   * 重算三份投影（整文件重写，原子写 + 文件锁）。**真源已在盘上**，失败只报不猜。
   * @returns {Promise<{mistakeLog:string, reviewQueue:string, knowledgePoints:string, derived:object}>}
   */
  async function projectAll(state) {
    const io = await resolveIo()
    const derived = deriveNotes(state.notes, {
      currentLesson: state.progress.currentLesson,
      totalLessons: state.kpParsed.totalLessons,
      skippedLessons: state.progress.skippedLessons,
    })
    const mistakeLog = renderMistakeLog(derived)
    const reviewQueue = renderReviewQueue(derived, { currentLesson: state.progress.currentLesson })
    const kpResult = applyKpProjection(state.kpText, derived)
    await io.withFileLock(paths.mistakeLog, () => io.writeFileAtomic(paths.mistakeLog, mistakeLog, { mode }))
    await io.withFileLock(paths.reviewQueue, () => io.writeFileAtomic(paths.reviewQueue, reviewQueue, { mode }))
    if (kpResult.text !== state.kpText) {
      await io.withFileLock(paths.kp, () => io.writeFileAtomic(paths.kp, kpResult.text, { mode }))
    }
    return { mistakeLog, reviewQueue, knowledgePoints: kpResult.text, derived, kpChanged: kpResult.changed }
  }

  /** 只重算投影（不改真源）——给"补投影 / 修好投影"的场景用。 */
  async function reproject() {
    const io = await resolveIo()
    const state = await load(io)
    const projected = await projectAll(state)
    return { ok: true, records: state.notes.length, kpChanged: projected.kpChanged }
  }

  /**
   * 追加一条记录（唯一写入入口）。
   *
   * @param {{type?:unknown, kp?:unknown, quote?:unknown, note?:unknown}} args - 模型给的入参
   * @param {{session:string, lesson:number|null, turn:number, origin?:string}} meta - 引擎补的字段
   * @returns {Promise<{ok:boolean, record:object, duplicate:boolean, kpChanged:number,
   *                    unresolved:number, due:number, files:string[]}>}
   * @throws 入参非法 / IO 失败（工具以此为报错依据，**不静默落盘**）
   */
  async function append(args, meta) {
    const io = await resolveIo()
    const state = await load(io)
    const check = validateNoteArgs(args, { kps: state.kpParsed.byId })
    if (!check.ok) {
      throw new Error(
        'classroom_note 拒绝这次调用，什么都没有落盘。\n- ' + check.problems.join('\n- '),
      )
    }
    const session = typeof meta?.session === 'string' && meta.session !== '' ? meta.session : 'unknown'
    const turn = Number.isInteger(meta?.turn) ? meta.turn : 0
    const lesson = Number.isInteger(meta?.lesson) && meta.lesson > 0 ? meta.lesson : 0
    const origin = meta?.origin === 'group_agent' ? 'group_agent' : 'teacher'
    const at = now()

    // 同回合重复调用 → 幂等（返回既有记录，不追加）
    const probe = { session, turn, type: check.value.type, kp: check.value.kp, quote: check.value.quote }
    const existing = findDuplicateNote(state.notes, probe)
    if (existing !== null) {
      const derived = deriveNotes(state.notes, {
        currentLesson: state.progress.currentLesson,
        totalLessons: state.kpParsed.totalLessons,
        skippedLessons: state.progress.skippedLessons,
      })
      return {
        ok: true,
        record: existing,
        duplicate: true,
        kpChanged: 0,
        unresolved: derived.mistakes.filter((m) => !m.resolved).length,
        due: derived.review.filter((item) => item.duePoint !== null).length,
        files: [],
      }
    }

    const stamp = idStamp(at)
    let record
    // 🔴 锁 + 锁内重读：两个并发的 classroom_note 不能互相覆盖（AC：并发写）
    await io.withFileLock(paths.notes, async () => {
      const currentText = await readOrNull(paths.notes)
      const current = parseNotesJsonl(currentText)
      const dup = findDuplicateNote(current.records, probe)
      if (dup !== null) {
        record = dup
        return
      }
      record = {
        v: 1,
        id: noteIdOf(stamp, nextSeqFor(current.records, stamp)),
        ts: isoWithOffset(at),
        session,
        lesson,
        turn,
        type: check.value.type,
        kp: check.value.kp,
        quote: check.value.quote,
        note: check.value.note,
        origin,
      }
      await io.writeFileAtomic(paths.notes, appendNoteLine(currentText, renderNoteLine(record)), { mode })
    })

    const after = await load(io)
    const projected = await projectAll(after)
    log(
      `课堂记录 ${record.id}：${record.type}${record.kp === null ? '' : ` ${record.kp}`}（第 ${record.lesson} 讲 · 第 ${record.turn} 回合）`,
    )
    return {
      ok: true,
      record,
      duplicate: false,
      kpChanged: projected.kpChanged,
      unresolved: projected.derived.mistakes.filter((m) => !m.resolved).length,
      due: projected.derived.review.filter((item) => item.duePoint !== null).length,
      files: [MISTAKE_LOG_FILE, REVIEW_QUEUE_FILE, KP_FILE],
    }
  }

  return { append, reproject, projectAll, load, paths }
}

/**
 * 便捷入口（index.mjs 用）：一次调用 = 校验 + 追加 + 重算投影。
 * @param {object} args - 工具入参
 * @param {object} meta - `{session, lesson, turn, origin}`
 * @param {object} options - createNoteStore 的选项
 */
export async function recordNote(args, meta, options) {
  return createNoteStore(options).append(args, meta)
}

/**
 * 教室目录是否可写（`runtime/` 必须存在且是目录）。**有 IO**，失败一律抛错。
 * @param {string} runtimeDir
 */
export async function assertRuntimeDir(runtimeDir) {
  let info
  try {
    info = await stat(runtimeDir)
  } catch (cause) {
    throw new Error(`教室 runtime/ 不可用：${runtimeDir}（${cause?.code ?? cause?.message ?? cause}）`)
  }
  if (!info.isDirectory()) throw new Error(`教室 runtime/ 不是目录：${runtimeDir}`)
  return true
}
