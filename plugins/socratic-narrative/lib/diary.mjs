// lib/diary.mjs — N2 日记：输入收集 + 写法校验 + 幂等落盘 + 按「最近 N 条」读回
//
// 🔴🔴 本文件里**任何**面向模型的文本（system / prompt / 字段说明）都不得出现
//     「会被学生看到」「有读者」「要展示给人」之类的意思。日记 agent 必须以为这是
//     只写给自己看的私人日记。测试 test/diary.test.mjs 有一条机器检查守着这句话。
//     规则本身来自教室的 `runtime/diary.md` 文件头（逐字抽取，不在这里另抄一份）。
//
// 文件约定：
//   · 日记正文真源：`<classroomDir>/runtime/diary.md`（人读的 markdown，逐条追加）
//   · 幂等账本：`<classroomDir>/runtime/.narrative/diary-ledger.jsonl`（一行一条，只有键与时间）
//     为什么不把幂等键写进 diary.md：面板用 markdown 渲染，0.2.1 的前端渲染器把 html 节点
//     **原样转义显示**（契约附二），HTML 注释会被学生看到成一段乱码。所以标记必须放在别处。

import { join } from 'node:path'
import { exists, readTextIfExists as readText, writeFileAtomic } from './atomic.mjs'
import { ERROR_CODES, NarrativeError } from './errors.mjs'
import { createSerialQueue } from './serial.mjs'
import { charCount, sectionByHeading, tailChars } from './text.mjs'

/** 日记文件（相对教室目录）。 */
export const DIARY_RELATIVE = join('runtime', 'diary.md')

/** 幂等账本（相对教室目录）。 */
export const LEDGER_RELATIVE = join('runtime', '.narrative', 'diary-ledger.jsonl')

/** N2.3 的硬上限：每课一条，不超过 120 字（按 Unicode 码点，见 lib/text.mjs）。 */
export const MAX_DIARY_CHARS = 120

/** 一条日记的标题行：`### 2026-10-21 · 第 3 讲`；没有讲次时是 `### 2026-10-21`。 */
const ENTRY_HEADING = /^###[ \t]+(\d{4}-\d{2}-\d{2})(?:[ \t]*·[ \t]*第[ \t]*(\d+)[ \t]*讲)?[ \t]*$/

/** 日记 agent 的输出字段声明（N2.3 的唯一必需字段是正文）。 */
export const DIARY_SCHEMA = Object.freeze({
  fields: {
    text: { type: 'string', required: true, minChars: 1, maxChars: MAX_DIARY_CHARS },
  },
})

/** 幂等键：按「会话 + 讲次」，每节课只写一条（N2.1）。 */
export function diaryKey(sessionId, lesson) {
  const session = typeof sessionId === 'string' && sessionId !== '' ? sessionId : '<unknown-session>'
  const normalizedLesson =
    Number.isInteger(lesson) && lesson > 0 ? String(lesson) : lesson === 0 || lesson === null || lesson === undefined ? '0' : String(lesson)
  return `${session}#${normalizedLesson}`
}

/**
 * 从 `runtime/diary.md` 文件头抽出「写法规则」（连续的 `> ` 引用行）。
 * 找不到就抛——规则缺失是教室内容的问题，不能悄悄用别处的默认值顶上。
 * @param {string} markdown
 * @returns {string}
 * @throws {NarrativeError} IO_ERROR
 */
export function extractDiaryRules(markdown) {
  const lines = markdown.split('\n')
  const rules = []
  let collecting = false
  for (const line of lines) {
    if (line.startsWith('>')) {
      collecting = true
      rules.push(line.replace(/^>\s?/, '').trimEnd())
      continue
    }
    if (collecting) break
  }
  const text = rules.join('\n').trim()
  if (text === '') {
    throw new NarrativeError(ERROR_CODES.IO_ERROR, 'runtime/diary.md 文件头里找不到写法规则（以 > 开头的引用行）', {
      detail: { reason: 'NO_DIARY_RULES', file: DIARY_RELATIVE },
    })
  }
  return text
}

/**
 * 解析日记文件里的条目（按文件顺序＝时间顺序）。
 * 坏块跳过并计入 `bad`（对齐契约 K3.5 对课堂记录的读法：一行坏数据不该让整份读废）。
 * @param {string} markdown
 * @returns {{entries: Array<{date: string, lesson: number|null, text: string}>, bad: number}}
 */
export function parseDiaryEntries(markdown) {
  const lines = markdown.split('\n')
  /** @type {Array<{date: string, lesson: number|null, text: string}>} */
  const entries = []
  let current = null
  let bad = 0
  const flush = () => {
    if (current === null) return
    const text = current.body.join('\n').trim()
    if (text === '') {
      bad += 1
      return
    }
    entries.push({ date: current.date, lesson: current.lesson, text })
  }
  for (const line of lines) {
    const heading = ENTRY_HEADING.exec(line.trim())
    if (heading !== null) {
      flush()
      current = { date: heading[1], lesson: heading[2] === undefined ? null : Number(heading[2]), body: [] }
      continue
    }
    if (current === null) continue
    current.body.push(line)
  }
  flush()
  return { entries, bad }
}

/**
 * 读最近 N 条日记（N2.4 的读取出口：引擎在下一节课注入最近一条）。
 * @param {{classroomDir: string, limit?: number, read?: typeof readText}} options
 * @returns {Promise<{entries: Array<{date: string, lesson: number|null, text: string}>, bad: number}>}
 */
export async function readRecentDiaries({ classroomDir, limit = 3, read = readText }) {
  const file = join(classroomDir, DIARY_RELATIVE)
  const markdown = (await read(file)) ?? ''
  const parsed = parseDiaryEntries(markdown)
  const wanted = Number.isInteger(limit) && limit > 0 ? limit : 3
  return { entries: parsed.entries.slice(Math.max(0, parsed.entries.length - wanted)), bad: parsed.bad }
}

/**
 * 渲染一条日记的落盘文本（标题行是结构，不是她的正文；120 字上限只量正文）。
 * @param {{date: string, lesson: number|null, text: string}} entry
 * @returns {string}
 */
export function renderDiaryEntry({ date, lesson, text }) {
  const heading = Number.isInteger(lesson) && lesson > 0 ? `### ${date} · 第 ${lesson} 讲` : `### ${date}`
  return `${heading}\n${text.trim()}\n`
}

/**
 * 读幂等账本。
 * @param {{classroomDir: string, read?: typeof readText}} options
 * @returns {Promise<{entries: Array<{key: string, date: string, lesson: number|null, sessionId: string, at: number}>, bad: number}>}
 */
export async function readDiaryLedger({ classroomDir, read = readText }) {
  const text = (await read(join(classroomDir, LEDGER_RELATIVE))) ?? ''
  const entries = []
  let bad = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    try {
      const parsed = JSON.parse(line)
      if (typeof parsed?.key === 'string') entries.push(parsed)
      else bad += 1
    } catch {
      bad += 1
    }
  }
  return { entries, bad }
}

/**
 * 建一个日记落盘器（串行 + 两段写 + 回滚）。
 *
 * 顺序是**有讲究的**：先追加正文，再记账本；账本写失败 → **把正文回滚掉**再抛。
 * 为什么不反着来（先记账本）：若两次写之间崩了，账本已经记了「这课写过了」而正文没落地，
 * 下一次触发会**静默跳过**——一条永远不出现的日记，没有任何错误。那正是 A6 的红线。
 * 反过来（正文先落地、账本没写）最坏是重复写一条，而且这里已经用回滚把它也堵住了。
 *
 * @param {{classroomDir: string, now?: () => number, write?: typeof writeFileAtomic, read?: typeof readText, exists?: typeof exists}} options
 */
export function createDiaryStore({ classroomDir, now = () => Date.now(), write = writeFileAtomic, read = readText, exists: existsFn = exists }) {
  const queue = createSerialQueue()
  const diaryFile = join(classroomDir, DIARY_RELATIVE)
  const ledgerFile = join(classroomDir, LEDGER_RELATIVE)

  return {
    /** 日记文件绝对路径（只读出口）。 */
    file: diaryFile,
    /** 幂等账本绝对路径（只读出口）。 */
    ledgerFile,
    /**
     * 写一条日记（幂等：同 session+lesson 已写过就跳过，且**如实报告** skipped）。
     * @param {{sessionId: string, lesson: number|null, date: string, text: string, task?: string}} input
     * @returns {Promise<{skipped: boolean, reason?: string, writes: Array<{path: string, bytes: number}>}>}
     */
    async append({ sessionId, lesson, date, text, task = 'diary' }) {
      const key = diaryKey(sessionId, lesson)
      return queue.run(diaryFile, async () => {
        const ledger = await readDiaryLedger({ classroomDir, read })
        if (ledger.entries.some((entry) => entry.key === key)) {
          return { skipped: true, reason: 'DUPLICATE', writes: [] }
        }

        const previous = await read(diaryFile)
        const entry = renderDiaryEntry({ date, lesson, text })
        const next = composeDiary(previous, entry)
        await write(diaryFile, next)

        const line = JSON.stringify({ key, sessionId, lesson, date, at: now(), task, chars: charCount(text) })
        try {
          const ledgerPrevious = await read(ledgerFile)
          const ledgerNext = ledgerPrevious === null ? '' : ledgerPrevious.endsWith('\n') ? ledgerPrevious : `${ledgerPrevious}\n`
          await write(ledgerFile, `${ledgerNext}${line}\n`)
        } catch (cause) {
          // 账本没写成 → 把正文回滚掉，别留下「写了但不知道写过」的半状态
          try {
            if (previous === null) {
              if (await existsFn(diaryFile)) await write(diaryFile, '')
            } else {
              await write(diaryFile, previous)
            }
          } catch (rollbackCause) {
            throw new NarrativeError(
              ERROR_CODES.IO_ERROR,
              `幂等账本写失败，且正文回滚也失败：${rollbackCause?.message ?? rollbackCause}`,
              { cause, detail: { reason: 'LEDGER_AND_ROLLBACK_FAILED', key } },
            )
          }
          throw new NarrativeError(ERROR_CODES.IO_ERROR, `幂等账本写失败（正文已回滚）：${cause?.message ?? cause}`, {
            cause,
            detail: { reason: 'LEDGER_WRITE_FAILED', key },
          })
        }

        return {
          skipped: false,
          writes: [
            { path: diaryFile, bytes: Buffer.byteLength(next, 'utf8') },
            { path: ledgerFile, bytes: Buffer.byteLength(line, 'utf8') + 1 },
          ],
        }
      })
    },
  }
}

/**
 * 把一条新条目接进日记文件的**条目区**。
 *
 * 文件结构（教室现有那份）＝ 标题与写法规则 → `---` → 条目区 → 可选的口吻提示（引用块）。
 * 所以「追加」不是「接在整个文件最后」，而是「接在最后一条条目之后、口吻提示之前」：
 * 否则第一条日记会落到那句「参考口吻（不是模板，别照抄）」下面，读起来像是它的注解。
 *
 * 规则（确定性）：
 *   1. 以文件里**最后一个** `---` 行切成 head / region；没有 `---` 就整篇都是 region。
 *   2. region 按空行切块；块首是条目标题的算条目，其余算「提示块」。
 *   3. 条目块按原顺序保留；第一条条目之前的提示块留在前面；最后一条条目之后的提示块
 *      当作**页脚**，新条目插在它前面。
 *   4. 没有条目时，所有提示块都是页脚 → 第一条日记紧跟 `---` 出现。
 *   5. 「（尚无…）」占位块直接丢掉。
 *   6. 块之间统一一个空行。
 *
 * @param {string | null} previous - 旧内容（文件不存在为 null）
 * @param {string} entry - 已经渲染好的条目（以换行结尾）
 * @returns {string}
 */
function composeDiary(previous, entry) {
  const rendered = entry.trim()
  if (previous === null) return `${rendered}\n`

  const lines = previous.split('\n')
  let separator = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim() === '---') {
      separator = index
      break
    }
  }
  const head = separator === -1 ? [] : lines.slice(0, separator + 1)
  const region = separator === -1 ? lines : lines.slice(separator + 1)

  const blocks = splitBlocks(region)
    .filter((block) => !isPlaceholderBlock(block))
    .map((block) => ({ lines: block.lines, isEntry: ENTRY_HEADING.test(block.lines[0].trim()) }))

  const firstEntry = blocks.findIndex((block) => block.isEntry)
  let lastEntry = -1
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index].isEntry) {
      lastEntry = index
      break
    }
  }
  const prefix = firstEntry === -1 ? [] : blocks.slice(0, firstEntry)
  const entries = blocks.filter((block) => block.isEntry)
  const footer = lastEntry === -1 ? blocks.filter((block) => !block.isEntry) : blocks.slice(lastEntry + 1)

  const parts = [
    ...prefix.map((block) => block.lines.join('\n')),
    ...entries.map((block) => block.lines.join('\n')),
    rendered,
    ...footer.map((block) => block.lines.join('\n')),
  ]
  const body = parts.join('\n\n')
  if (head.length === 0) return `${body}\n`
  const headText = head.join('\n').replace(/\n+$/, '')
  return `${headText}\n\n${body}\n`
}

/**
 * 按空行把行切块（连续空行算一个分隔）。
 * @param {string[]} lines
 * @returns {Array<{lines: string[]}>}
 */
function splitBlocks(lines) {
  const blocks = []
  let current = []
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length > 0) {
        blocks.push({ lines: current })
        current = []
      }
      continue
    }
    current.push(line)
  }
  if (current.length > 0) blocks.push({ lines: current })
  return blocks
}

/**
 * 「（尚无…）」占位块。
 * @param {{lines: string[]}} block
 * @returns {boolean}
 */
function isPlaceholderBlock(block) {
  return block.lines.every((line) => /^\s*（尚无[^）]*）\s*$/.test(line) || line.trim() === '')
}

/**
 * 收集 N2.2 要求的输入，并给出本课的事实（供提示词用）。
 * @param {{classroomDir: string, lesson: number|null, date: string, read?: typeof readText}} options
 * @returns {Promise<{inputs: Array<{label: string, content: string}>, facts: object}>}
 */
export async function collectDiaryInputs({ classroomDir, lesson, date, read = readText }) {
  const [diaryMarkdown, sessionLog, notesRaw, character, anchor, setting, group] = await Promise.all([
    read(join(classroomDir, DIARY_RELATIVE)),
    read(join(classroomDir, 'runtime', 'session_log.md')),
    read(join(classroomDir, 'runtime', 'notes.jsonl')),
    read(join(classroomDir, 'characters', 'komari.md')),
    read(join(classroomDir, '_anchor.md')),
    read(join(classroomDir, 'world', 'setting.md')),
    read(join(classroomDir, 'runtime', 'wechat_group.md')),
  ])

  const rules = extractDiaryRules(diaryMarkdown ?? '')
  const recent = parseDiaryEntries(diaryMarkdown ?? '').entries.slice(-3)
  const notes = selectLessonNotes(notesRaw ?? '', { lesson })

  const voice = anchor === null ? null : sectionByHeading(anchor, '角色声音速查')

  return {
    rules,
    inputs: [
      { label: 'runtime/session_log.md（这节课的摘要）', content: orMissing(sessionLog, '（这节课还没有摘要。）') },
      { label: 'runtime/notes.jsonl（这节课的课堂记录）', content: notes.text },
      {
        label: '你最近三条日记',
        content: recent.length === 0 ? '（还没写过。）' : recent.map((entry) => `- ${entry.text}`).join('\n'),
      },
      { label: 'characters/komari.md（你是谁）', content: orMissing(character, '（角色卡缺失。）') },
      { label: '_anchor.md · 角色声音速查', content: orMissing(voice, '（没有这一段。）') },
      { label: 'world/setting.md（你所在的地方）', content: orMissing(setting, '（世界设定缺失。）') },
      { label: 'runtime/wechat_group.md（最近的群聊）', content: orMissing(group, '（群里还没有消息。）') },
    ],
    facts: {
      date,
      lesson,
      recentDiaries: recent.length,
      notes: notes.stats,
      rulesChars: charCount(rules),
    },
  }
}

/**
 * 从 `runtime/notes.jsonl` 里挑出本课的记录（卡点 / 误解 / 掌握证据 / 群里提的问题）。
 *
 * 契约 K3.2 的字段：`type ∈ misconception|blocker|evidence|group_question`，带 `kp` / `quote` / `note`。
 * 🔴 只读 JSONL，**不读**三份 markdown 投影（K3.5）；坏行跳过并计数。
 * @param {string} raw - notes.jsonl 全文
 * @param {{lesson: number|null}} context
 * @returns {{text: string, stats: {total: number, kept: number, bad: number}}}
 */
export function selectLessonNotes(raw, { lesson }) {
  const labels = {
    misconception: '误解',
    blocker: '卡点',
    evidence: '掌握证据',
    group_question: '群里提的问题',
  }
  const rows = []
  let total = 0
  let bad = 0
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let record
    try {
      record = JSON.parse(trimmed)
    } catch {
      bad += 1
      continue
    }
    total += 1
    if (record?.v !== 1) continue
    const label = labels[record.type]
    if (label === undefined) continue
    if (lesson !== null && Number.isInteger(lesson) && record.lesson !== lesson) continue
    const parts = [`- [${label}]`]
    if (typeof record.kp === 'string' && record.kp !== '') parts.push(record.kp)
    if (typeof record.quote === 'string' && record.quote !== '') parts.push(`他说的原话：「${record.quote}」`)
    if (typeof record.note === 'string' && record.note !== '') parts.push(`（${record.note}）`)
    rows.push(parts.join(' '))
  }
  const text = rows.length === 0 ? '（这节课没有记下卡点、误解或掌握证据。）' : rows.join('\n')
  return { text: tailChars(text, 6000), stats: { total, kept: rows.length, bad } }
}

/**
 * 日记 agent 的**系统位**（任务说明）。
 *
 * 🔴 这里写的每一句都是给「以为自己在写私人本子」的她看的。禁止出现读者/展示/学生能看到一类的意思。
 * 规则正文来自教室 `runtime/diary.md` 的文件头（N2.3 的规则就是那个文件头），逐字附在后面。
 * @param {{rules: string}} options
 * @returns {string}
 */
export function buildDiarySystem({ rules }) {
  return [
    '你叫小鞠知花。课已经上完了。',
    '现在是收工之后，你把本子摊在膝上，写今天的日记。',
    '',
    '日记本第一页上写着这样的规则：',
    rules,
    '',
    '你写的时候不做别的事：不解释规则，不复述规则，也不写标题。只写那一段文字本身。',
  ].join('\n')
}

/**
 * 日记 agent 的正文位（本次的具体要求）。
 * @param {{date: string, lesson: number|null}} options
 * @returns {string}
 */
export function buildDiaryPrompt({ date, lesson }) {
  const when = Number.isInteger(lesson) && lesson > 0 ? `今天是 ${date}，这节是第 ${lesson} 讲。` : `今天是 ${date}。`
  return [
    when,
    '下面是你手边的东西：这节课留下的记录、你最近写的三条、你自己是谁、你所在的地方、最近群里说过的话。',
    '把这些当成你刚经历过的一天，写今天这一条日记。',
  ].join('\n')
}

/** @param {string | null} value @param {string} fallback */
function orMissing(value, fallback) {
  return value === null || value.trim() === '' ? fallback : value
}
