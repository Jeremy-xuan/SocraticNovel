// lib/group.mjs — N3 群聊 agent：输入收集、提示词、输出校验（**不落盘、不调度**）
//
// 分工：本文件只产「一段放在群里的文字」；落盘与节奏在 `lib/groupservice.mjs`，
// 存储真源在 `lib/groupstore.mjs`，N4 的定时也在自己的文件里。
//
// 🔴 N6.1「单一人格源」：群聊的输入里必须有**当课角色卡**与 `_anchor.md` 的「角色声音速查」段，
//    与日记走**同一个解析函数**（`classroom.mjs` 的 `resolveCharacter` / `sectionByHeading`）。
//    缺了这两样，群聊只能靠 `world/setting.md` 猜她是谁、怎么说话 —— 三个 agent 的声音会分叉。
//
// 🔴 硬规则来自教室：`runtime/wechat_group.rules.md` 文件头（连续的 `>` 行），**逐字进提示词**，
//    不在本包里另抄一份。那几条是 N3.6 写死的：她在群里比当面话多但仍短、每条不超过 2 行、
//    不使用 emoji、群聊不承载知识点、只有 characters/ 里的人物或一次性路人（`路人·`）能开口。
//    规则文件里抽不到规则 → 抛 `NO_GROUP_RULES`（不拿默认规则顶上）。
//
// 🔴 不给群聊 agent 任何「有读者」的暗示（仓库红线）：提示词里不出现「面板/展示/未读/会被看到」。
//    她是在跟一个具体的人说话，不是在对观众表演。

import { join } from 'node:path'
import { readTextIfExists as readText } from './atomic.mjs'
import { ERROR_CODES, NarrativeError } from './errors.mjs'
import { listCharacterNames, resolveCharacter } from './classroom.mjs'
import { charCount, extractQuotedRules, sectionByHeading, tailChars } from './text.mjs'

/** 写死规则的来源文件（相对教室目录）。 */
export const GROUP_RULES_RELATIVE = join('runtime', 'wechat_group.rules.md')

/** 一次回复的字符上限（规则说「短」；这里只防病态长文，不是写作目标）。 */
export const MAX_REPLY_CHARS = 300

/** 每条消息最多几行（N3.6 写死：每条不超过 2 行）。 */
export const MAX_LINES = 2

/** 一次性路人的名字前缀（K4.2：`speaker` 要么是已定义人物，要么以它开头）。 */
export const PASSERBY_PREFIX = '路人·'

/** 群聊回复的字段声明（单条消息 + 三个可选信号）。 */
export const GROUP_REPLY_SCHEMA = Object.freeze({
  fields: {
    speaker: { type: 'string', maxChars: 24 },
    text: { type: 'string', required: true, minChars: 1, maxChars: MAX_REPLY_CHARS },
    knowledge_question: { type: 'boolean' },
    kp: { type: 'string', maxChars: 16 },
    question: { type: 'string', maxChars: 200 },
    proposal_content: { type: 'string', maxChars: 200 },
    proposal_reason: { type: 'string', maxChars: 200 },
  },
})

/**
 * 定时主动消息的字段声明：一次生成 `count` 条（N4.2「一次性生成当天的消息」）。
 * @param {number} count
 * @returns {{fields: Record<string, object>}}
 */
export function batchSchema(count) {
  return {
    fields: {
      messages: { type: 'array', itemType: 'string', required: true, minItems: count, maxItems: count, itemMaxChars: MAX_REPLY_CHARS },
    },
  }
}

/**
 * 取群聊规则（文件头引用行）。抽不到就抛——规则缺失是教室内容的问题，不能悄悄用默认值。
 * @param {string} classroomDir
 * @returns {Promise<string>}
 * @throws {NarrativeError} IO_ERROR / NO_GROUP_RULES
 */
export async function readGroupRules(classroomDir) {
  const markdown = (await readText(join(classroomDir, GROUP_RULES_RELATIVE))) ?? ''
  const rules = extractQuotedRules(markdown)
  if (rules === '') {
    throw new NarrativeError(ERROR_CODES.IO_ERROR, `${GROUP_RULES_RELATIVE} 文件头里找不到群聊规则（以 > 开头的引用行）`, {
      detail: { reason: 'NO_GROUP_RULES', file: GROUP_RULES_RELATIVE },
    })
  }
  return rules
}

/**
 * 收集群聊 agent 这一次要看的输入。
 *
 * @param {object} options
 * @param {string} options.classroomDir
 * @param {object[]} options.messages - 全部群聊消息（`groupstore.readAll().messages`）
 * @param {number} [options.historyLimit] - 带进提示词的消息条数（默认 30）
 * @param {number|null} [options.lesson]
 * @returns {Promise<{rules: string, character: object, inputs: Array<{label: string, content: string}>, facts: object}>}
 */
export async function collectGroupInputs({ classroomDir, messages = [], historyLimit = 30, lesson = null }) {
  const rules = await readGroupRules(classroomDir)
  // 与日记同一个解析（N6.1）：当课角色卡 + `_anchor.md` 的「角色声音速查」段
  const character = await resolveCharacter(classroomDir)
  const [setting, anchor, sessionLog, notes, meta] = await Promise.all([
    readText(join(classroomDir, 'world', 'setting.md')),
    readText(join(classroomDir, '_anchor.md')),
    readText(join(classroomDir, 'runtime', 'session_log.md')),
    readText(join(classroomDir, 'runtime', 'notes.jsonl')),
    listCharacterNames(classroomDir),
  ])
  const voice = anchor === null ? null : sectionByHeading(anchor, '角色声音速查')

  const transcript = renderTranscript(messages.slice(Math.max(0, messages.length - historyLimit)))

  return {
    rules,
    character,
    facts: { lesson, history: Math.min(messages.length, historyLimit), names: meta.names, character: character.relative, characterName: character.name },
    inputs: [
      { label: `${character.relative}（你是谁）`, content: character.content },
      { label: '_anchor.md · 角色声音速查', content: orMissing(voice, '（没有这一段。）') },
      { label: 'world/setting.md（你所在的地方）', content: setting === null || setting.trim() === '' ? '（世界设定缺失。）' : setting },
      { label: '最近群聊（从旧到新）', content: transcript },
      {
        label: 'runtime/session_log.md（最近的课堂摘要）',
        content: sessionLog === null || sessionLog.trim() === '' ? '（还没有课堂摘要。）' : tailChars(sessionLog, 2000),
      },
      { label: 'runtime/notes.jsonl（最近的课堂记录）', content: renderRecentNotes(notes ?? '', 8) },
    ],
  }
}

/**
 * 把消息列表渲染成「谁在什么时候说了什么」，给提示词看。
 * @param {object[]} messages
 * @returns {string}
 */
export function renderTranscript(messages) {
  if (messages.length === 0) return '（群里还没有人说话。）'
  return messages.map((message) => `${message.speaker}：${message.text}`).join('\n')
}

/**
 * 取 `notes.jsonl` 最近 N 条，压成几行（只读 JSONL，不读投影；K3.5）。
 * @param {string} raw
 * @param {number} limit
 * @returns {string}
 */
export function renderRecentNotes(raw, limit = 8) {
  const labels = { misconception: '误解', blocker: '卡点', evidence: '掌握证据', group_question: '群里提的问题' }
  const rows = []
  for (const line of String(raw ?? '').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const record = JSON.parse(trimmed)
      if (record?.v !== 1) continue
      const label = labels[record.type]
      if (label === undefined) continue
      const parts = [`- [${label}]`]
      if (typeof record.kp === 'string' && record.kp !== '') parts.push(record.kp)
      if (typeof record.quote === 'string' && record.quote !== '') parts.push(`他说的：「${record.quote}」`)
      if (typeof record.note === 'string' && record.note !== '') parts.push(`（${record.note}）`)
      rows.push(parts.join(' '))
    } catch {
      // 坏行跳过（K3.5 的读法），不影响其余记录
    }
  }
  if (rows.length === 0) return '（还没有课堂记录。）'
  return rows.slice(Math.max(0, rows.length - limit)).join('\n')
}

/**
 * 群聊回复的**系统位**：规则正文逐字来自教室文件。
 * @param {{rules: string, characterName: string, allowedNames: string[]}} options
 * @returns {string}
 */
export function buildReplySystem({ rules, characterName, allowedNames }) {
  return [
    `你是${characterName}。现在是课后，你在群里用手机打字。`,
    '',
    '群聊的规则（写死的，必须遵守）：',
    rules,
    '',
    `群里能开口的人：${allowedNames.join('、')}。要写一次性出现的人（值班的、路过的），名字写成 \`${PASSERBY_PREFIX}<怎么称呼>\`，例如 \`${PASSERBY_PREFIX}值班员\`。不要写不在这个范围里的名字。`,
    '',
    '你现在做的只有一件事：接着群里的话，回一条消息。不要解释规则，不要复述规则，不要写标题。',
  ].join('\n')
}

/**
 * 群聊回复的正文位。
 * @param {{batch: object[], lesson: number|null}} options
 * @returns {string}
 */
export function buildReplyPrompt({ batch, lesson }) {
  const lines = []
  if (Number.isInteger(lesson) && lesson > 0) lines.push(`这阵子在讲第 ${lesson} 讲。`)
  const texts = batch.filter((message) => message.role === 'student').map((message) => `「${message.text}」`)
  if (texts.length === 0) lines.push('群里最新的话不是他说的，接着话头回一条。')
  else if (texts.length === 1) lines.push(`他刚说：${texts[0]}`)
  else lines.push(`他一连说了 ${texts.length} 句：${texts.join('、')}。把这些当成一次说完的，只回一条。`)
  lines.push('')
  lines.push('如果他说的是要我讲题、要知识点，就在群里简短应一句、约到课上讲（群里不承载知识点），并把 `knowledge_question` 设成 true。')
  lines.push('如果你觉得这个世界该多一个人、或多一件东西，可以顺手写 `proposal_content` 与 `proposal_reason`；没想法就别写这两个字段。')
  return lines.join('\n')
}

/**
 * 主动说话的提示词（N3.7 的开场与 N4 的定时消息共用）。
 * @param {{kind: 'open'|'nudge', count: number, lesson: number|null, times?: string[]}} options
 * @returns {{system: string, prompt: string}}
 */
export function buildNudgePrompt({ kind, count, lesson, times = [] }) {
  const prompt = []
  if (kind === 'open') {
    prompt.push('这是这个群的第一条消息。你刚把群建起来，说一句话开个头。')
  } else {
    prompt.push(`今天你想在群里说 ${count} 次话。`)
    if (times.length > 0) prompt.push(`时间是：${times.join('、')}。`)
    prompt.push(`每条就当那个时刻到了，你自己想起来说一句；按顺序给出 ${count} 条。`)
  }
  if (Number.isInteger(lesson) && lesson > 0) prompt.push(`这阵子在讲第 ${lesson} 讲，但你不用讲题。`)
  prompt.push('不要问问题等人答，也不要提知识点。说你此刻注意到的、或者想让他知道的小事。')
  return prompt.join('\n')
}

/**
 * 主动说话的完整系统位（规则正文逐字来自教室文件）。
 * @param {{rules: string, characterName: string, allowedNames: string[]}} options
 * @returns {string}
 */
export function buildNudgeSystem({ rules, characterName, allowedNames }) {
  return [
    `你是${characterName}。现在是课后，你在群里用手机打字。`,
    '',
    '群聊的规则（写死的，必须遵守）：',
    rules,
    '',
    `群里能开口的人：${allowedNames.join('、')}。一次性出现的人写成 \`${PASSERBY_PREFIX}<怎么称呼>\`。`,
  ].join('\n')
}

/**
 * 校验并归一一条群聊发言（N3.3 / N3.6 的**确定性**守卫）。
 *
 * 拒绝的三种情况（都抛 `INVALID_OUTPUT`，不静默改写）：
 *   ① 出现 emoji（按 Unicode 的 `Extended_Pictographic` 判，不是人肉列表）
 *   ② 超过 2 行
 *   ③ speaker 既不是已定义人物，也不是 `路人·<称呼>`
 *
 * @param {{speaker?: string, text: string}} speech
 * @param {{names: string[], defaultSpeaker: string}} context
 * @returns {{speaker: string, text: string}}
 * @throws {NarrativeError} INVALID_OUTPUT
 */
export function validateSpeech(speech, { names, defaultSpeaker }) {
  const text = String(speech?.text ?? '').trim()
  if (text === '') {
    throw new NarrativeError(ERROR_CODES.INVALID_OUTPUT, '群聊发言是空的', { detail: { reason: 'EMPTY_SPEECH' } })
  }
  const lines = text.split('\n').map((line) => line.trimEnd())
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length > MAX_LINES) {
    throw new NarrativeError(ERROR_CODES.INVALID_OUTPUT, `群聊发言有 ${lines.length} 行，规则是每条不超过 ${MAX_LINES} 行`, {
      detail: { reason: 'TOO_MANY_LINES', lines: lines.length },
    })
  }
  if (/[\p{Extended_Pictographic}]/u.test(text)) {
    throw new NarrativeError(ERROR_CODES.INVALID_OUTPUT, '群聊发言里出现了 emoji（规则是群里不使用 emoji）', {
      detail: { reason: 'EMOJI' },
    })
  }
  const rawSpeaker = typeof speech.speaker === 'string' && speech.speaker.trim() !== '' ? speech.speaker.trim() : defaultSpeaker
  if (!names.includes(rawSpeaker) && !isPasserby(rawSpeaker)) {
    throw new NarrativeError(ERROR_CODES.INVALID_OUTPUT, `群聊发言人 ${JSON.stringify(rawSpeaker)} 既不是 characters/ 里的人物，也不是 ${PASSERBY_PREFIX}<称呼>`, {
      detail: { reason: 'UNKNOWN_SPEAKER', speaker: rawSpeaker, allowed: names },
    })
  }
  return { speaker: rawSpeaker, text }
}

/**
 * 是不是一次性路人名（`路人·` + 1–12 个字）。
 * @param {string} speaker
 * @returns {boolean}
 */
export function isPasserby(speaker) {
  if (!speaker.startsWith(PASSERBY_PREFIX)) return false
  const rest = speaker.slice(PASSERBY_PREFIX.length).trim()
  return rest !== '' && charCount(rest) <= 12
}

/** @param {string | null} value @param {string} fallback */
export function orMissing(value, fallback) {
  return value === null || value.trim() === '' ? fallback : value
}
