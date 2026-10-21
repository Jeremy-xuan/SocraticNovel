// lib/lessonjump.mjs — J · 任意讲次进入（学生要求「从第 N 讲开始」）
//
// 任务书：docs/计划与排产/开发文档_功能开发_2026-10-20.md §五 J（J1/J2/J3 与 EC）
// 契约：docs/计划与排产/契约_功能开发_2026-10-20.md K3.3（跳过讲次的**取值来源**）
//
// ── 这个模块做三件事，全部是确定性的（🔴 不调 LLM、不做生成式改写）────────────
// ① 把「跳到第 N 讲」写回 `progress.md`（当前讲次 ＋ 人读「本轮要讲」行 ＋ 机器行
//    `skipped_lessons: …`）。**这是 J2 的落点**：被跳过的讲次只记「跳过」，绝不记「掌握」。
//    🔴 `skipped_lessons` 这个键名是契约写死的（K3.3 的 2026-10-20 追认）——
//      `lib/notestore.mjs:readProgressState` 读的就是它，另起一套标记＝两处读法打架。
// ② 从**教室自己的文件**里机械取文，拼出「前情提要 ＋ 第 N 讲的前置知识点」：
//    · `story/overview.md`   → 本讲所属人物弧（段名/讲次/状态三格）
//    · `story/ch{01..N-1}.md` → 每讲「本讲位置」（ch01 是「这一讲在故事里的作用」）
//    · `knowledge_points.md`  → 第 1..N-1 讲的知识点原文（学生缺的就是这些）
//    🔴 只取 `< N` 的内容：第 N 讲之后的故事节点一个字都不进这块（J3／验收 A1 的语义）。
// ③ 落盘顺序：**先写盘成功，再让调用方改内存**。写盘失败返回 `persisted:false` ＋ 原因，
//    并把 `lesson` 原样退回「没跳成」的那个值（与 `persistPhase` 的契约同形）。
//
// ── 为什么是独立模块而不是塞进 index.mjs ──────────────────────────────────────
// 抽出纯函数后，`test/lessonjump.test.mjs` 能直接拿**真教室文件**做断言（注入集合／越界／
// 跳过集合），不需要起宿主、不需要模型。index.mjs 只留工具注册与内存态接线。

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from './atomic-write.mjs'
import { lessonsDeclaredBy, readRuntimeLesson, resolveProgressFile } from './manifest.mjs'
import { readProgressState } from './notestore.mjs'

/** 跳过讲次的机器可读键名（契约 K3.3 写死；`notestore.readProgressState` 同读这一行）。 */
export const SKIPPED_KEY = 'skipped_lessons'
/** 人读表格里「本轮要讲」那一行的行首标签（`classrooms/cs-os/AGENTS.md` 的事实契约）。 */
export const LESSON_ROW_LABEL = '本轮要讲'
/** 人读表格里「跳过的讲次」那一行：文件里有就跟着改，没有就不凭空造一行。 */
export const SKIPPED_ROW_LABEL = '跳过的讲次'
/** 每个讲次文件里的「连续性要点」标题（ch01 与 ch02–14 用了两个不同的名字）。 */
export const CONTINUITY_SECTIONS = ['本讲位置', '这一讲在故事里的作用']
/**
 * 前置知识点的**近窗**：只给最近这几讲（N-2、N-1）的条目原文，更早的只列标题。
 * 🔴 为什么分档（2026-10-21 拍板）：跳到第 14 讲时全量原文约 8 KB，会挤掉别的注入块；
 *    而「学生真正需要的前置」几乎都在近两讲。判据正文仍可自己读 knowledge_points.md 那一节。
 */
export const PREREQ_FULL_WINDOW = 2

/** 本模块的错误类型：参数越界／教室文件不可用——都是**看得出原因**的失败，不静默。 */
export class LessonJumpError extends Error {
  constructor(message) {
    super(message)
    this.name = 'LessonJumpError'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 参数与跳过集合（纯函数）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 校验「跳到第 N 讲」的 N。EC 逐条落在这里：0／超上界／非数字／小数／负数全部**报错**
 * （报错信息里带上合法区间，模型能自己改对——与 `classroom_set_phase` 未知相位同口径）。
 *
 * @param {unknown} raw — 模型传来的参数值（JSON 里可能是数字，也可能是 `"3"`）
 * @param {{max?: number|null}} [opts] — max 来自 manifest 的 `classroom.lessons`；null＝不设上界
 * @returns {number} 合法讲次（>=1 的整数）
 */
export function parseLessonNumber(raw, { max = null } = {}) {
  let value
  if (typeof raw === 'number') {
    value = raw
  } else if (typeof raw === 'string' && /^\s*-?\d+\s*$/.test(raw)) {
    value = Number.parseInt(raw.trim(), 10)
  } else {
    throw new LessonJumpError(
      `讲次必须是整数（得到 ${JSON.stringify(raw)}）` +
        (max === null ? '，如 `5`（从第 5 讲开始）。' : `，合法区间是 1–${max}，如 \`5\`（从第 5 讲开始）。`),
    )
  }
  if (!Number.isInteger(value)) {
    throw new LessonJumpError(
      `讲次必须是整数（得到 ${JSON.stringify(raw)}）` +
        (max === null ? '。' : `，合法区间是 1–${max}。`),
    )
  }
  if (value < 1) {
    throw new LessonJumpError(
      `第 ${value} 讲不是一个讲次：第 0 讲＝还没开始（` +
        `progress.md 的 current_lesson 语义是「本轮要讲的讲次」，从 1 起）。` +
        (max === null ? '' : `合法区间是 1–${max}。`),
    )
  }
  if (max !== null && value > max) {
    throw new LessonJumpError(
      `本教室只声明了 ${max} 讲（classroom.yaml 的 classroom.lessons），第 ${value} 讲超出上界。` +
        `合法区间是 1–${max}。`,
    )
  }
  return value
}

/**
 * 算跳讲之后的「跳过讲次」集合（J2 的唯一口径）。
 *
 * 规则（确定性，见 test/lessonjump.test.mjs 的「跳过集合」一节逐条断言）：
 *   · 只保留 `< N` 的旧值——学生回到第 N 讲之后，第 N 讲及其之后的讲次都是**将要在课上**
 *     走到的，不再是「跳过」。这一条同时解决了 EC「跳讲之后又要求从头开始」（回到第 1 讲
 *     → 跳过集合清空，机器行随之删除，不留 `skipped_lessons: ` 空值行）。
 *   · 前进（N > previous）时，把 `[previous, N)` 整段记成跳过——含当时正在上的那一讲
 *     （`current_lesson` 的语义是「本轮要讲的讲次」，讲到一半就走了＝这一讲没上完）。
 *   · 后退（N < previous）不新记跳过：那些讲次已经上过（EC「跳回已经上过的讲次」）。
 *   · 跳回一个**曾被跳过**的讲次（N ∈ skipped）时，N 自己从集合里消失——它现在正要被上。
 *
 * @param {{previous:number, lesson:number, skipped:Set<number>}} input
 * @returns {Set<number>} 新的跳过集合（升序插入，便于渲染）
 */
export function nextSkippedLessons({ previous, lesson, skipped }) {
  const next = new Set()
  for (const s of skipped ?? []) if (Number.isInteger(s) && s < lesson) next.add(s)
  if (Number.isInteger(previous) && lesson > previous) {
    for (let n = previous; n < lesson; n += 1) next.add(n)
  }
  return next
}

/**
 * 把讲次集合渲染成人读文本：连续段用区间，不连续用顿号。
 * `{1,2,3,4}` → `第 1–4 讲`；`{1,3}` → `第 1、3 讲`；`{}` → `—`。
 * @param {Iterable<number>} set
 * @returns {string}
 */
export function formatLessonRanges(set) {
  const list = [...new Set([...(set ?? [])])].filter((n) => Number.isInteger(n)).sort((a, b) => a - b)
  if (list.length === 0) return '—'
  const runs = []
  for (const n of list) {
    const last = runs[runs.length - 1]
    if (last !== undefined && n === last[1] + 1) last[1] = n
    else runs.push([n, n])
  }
  return runs
    .map(([a, b]) => (a === b ? `第 ${a} 讲` : `第 ${a}–${b} 讲`))
    .join('、')
}

/** 机器行的值：`1,2,3`（升序、逗号分隔、无空格——与契约 K3.3 的示例同形）。 */
export function renderSkippedLine(set) {
  const list = [...new Set([...(set ?? [])])].filter((n) => Number.isInteger(n)).sort((a, b) => a - b)
  if (list.length === 0) return null
  return `${SKIPPED_KEY}: ${list.join(',')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// ② progress.md 渲染（纯函数）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把一份 `progress.md` 全文渲染成「跳到第 N 讲之后」的样子。
 *
 * 只动四处，其余**逐字保留**（教室文件的表格、注释、记录一律不碰）：
 *   1. 机器行 `current_lesson: <int>` → N（找不到就报错：那说明教室根本没用讲次门，
 *      静默插一行会让 `readRuntimeLesson` 的口径变成两个来源）；
 *   2. 机器行 `skipped_lessons: …` → 重写；集合为空则**删掉整行**
 *      （契约 K3.3：「缺失＝无跳过」，不留空值行）；
 *   3. 人读行 `| 本轮要讲 | … |` → 与机器行同值（两处永远同一个数）；
 *   4. 人读行 `| 跳过的讲次 | … |` → 文件里有就跟着改；没有就不造。
 *
 * @param {string} content — progress.md 全文
 * @param {{lesson:number, title?:string|null, skipped:Set<number>, file?:string}} input
 * @returns {string} 新全文
 */
export function renderProgressLesson(content, { lesson, title = null, skipped = new Set(), file } = {}) {
  if (!Number.isInteger(lesson) || lesson < 1) {
    throw new LessonJumpError(`renderProgressLesson 的 lesson 必须是 >=1 的整数（得到 ${JSON.stringify(lesson)}）`)
  }
  const where = file ?? 'progress.md'
  const lines = String(content ?? '').split(/\r?\n/)

  // 1) current_lesson
  const lessonIndex = lines.findIndex((line) => /^\s*-?\s*current_lesson\s*:/.test(line))
  if (lessonIndex < 0) {
    throw new LessonJumpError(
      `${where} 里没有机器可读行 \`current_lesson: <整数>\`——讲次是引擎从这一行读的，` +
        `不能由工具凭空插（教室的 runtime_store 声明与这一行必须是同一处）。`,
    )
  }
  lines[lessonIndex] = `${lines[lessonIndex].match(/^\s*/)[0]}current_lesson: ${lesson}`

  // 2) skipped_lessons
  const skippedLine = renderSkippedLine(skipped)
  const skippedIndex = lines.findIndex((line) => new RegExp(`^\\s*-?\\s*${SKIPPED_KEY}\\s*:`).test(line))
  if (skippedIndex >= 0 && skippedLine === null) {
    lines.splice(skippedIndex, 1)
  } else if (skippedIndex >= 0) {
    lines[skippedIndex] = `${lines[skippedIndex].match(/^\s*/)[0]}${skippedLine}`
  } else if (skippedLine !== null) {
    lines.splice(lessonIndex + 1, 0, skippedLine)
  }

  // 3) 人读「本轮要讲」行（与机器行同值；标题只在教室文件里真有时才写，不编）
  const rowIndex = lines.findIndex((line) => new RegExp(`^\\|\\s*${LESSON_ROW_LABEL}\\s*\\|`).test(line))
  if (rowIndex < 0) {
    throw new LessonJumpError(
      `${where} 里没有「| ${LESSON_ROW_LABEL} | … |」这一行——教室的事实契约要求人读行与 ` +
        `current_lesson 同值（AGENTS.md 的课后更新段），两处不同步就会被面板判成口径不一致。`,
    )
  }
  const cell = title === null || title === '' ? `**第 ${lesson} 讲**` : `**第 ${lesson} 讲 · ${title}**`
  lines[rowIndex] = `| ${LESSON_ROW_LABEL} | ${cell} |`

  // 4) 人读「跳过的讲次」行（可选：文件里有才维护）
  const skippedRowIndex = lines.findIndex((line) => new RegExp(`^\\|\\s*${SKIPPED_ROW_LABEL}\\s*\\|`).test(line))
  if (skippedRowIndex >= 0) {
    lines[skippedRowIndex] = `| ${SKIPPED_ROW_LABEL} | ${formatLessonRanges(skipped)} |`
  }

  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// ③ 机械取文：故事连续性 ＋ 前置知识点（纯函数，输入是文件全文）
// ─────────────────────────────────────────────────────────────────────────────

/** markdown 标题表：`{ level, title, line }`（与 `manifest.sliceSection` 同口径）。 */
function headingsOf(text) {
  const out = []
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((line, i) => {
      const m = line.match(/^(#{1,6})\s+(.*?)\s*$/)
      if (m) out.push({ level: m[1].length, title: m[2], line: i })
    })
  return out
}

/**
 * 取某个 `## ` 段的正文行（到下一个同级或更高级标题为止），**不做 trim 之外的任何改写**。
 * @returns {string[]} 正文行（已去掉首尾空行）
 */
function sectionLines(text, title) {
  const lines = String(text ?? '').split(/\r?\n/)
  const headings = headingsOf(text)
  const hit = headings.find((h) => h.title === title)
  if (hit === undefined) return null
  const next = headings.find((h) => h.line > hit.line && h.level <= hit.level)
  const end = next === undefined ? lines.length : next.line
  const body = lines.slice(hit.line + 1, end)
  while (body.length > 0 && body[0].trim() === '') body.shift()
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop()
  return body
}

/** 按标题里的关键词找段正文（overview.md 的标题带序号，如「## 一、她的人物弧（三段）」）。 */
function sectionByKeyword(text, keyword) {
  const hit = headingsOf(text).find((h) => h.title.includes(keyword))
  return hit === undefined ? null : sectionLines(text, hit.title)
}

/** markdown 表格的数据行 → 单元格数组（跳过分隔行 `|---|`）。 */
function tableRows(lines) {
  const rows = []
  for (const line of lines ?? []) {
    if (!/^\s*\|/.test(line)) continue
    const cells = line
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((c) => c.trim())
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue // 分隔行
    rows.push(cells)
  }
  return rows
}

/**
 * 取一讲的故事「连续性要点」：`story/ch{NN}.md` 的「本讲位置」（ch01 是「这一讲在故事里的作用」）。
 * 🔴 只取这一段：`场景节点`／`机会节点`／`暗线种子` 里写着**后面几讲**的回收点，
 *    取它们就等于提前剧透（J3／验收 A1）。
 * @param {string} text — 该讲 story 文件全文
 * @returns {{title:string, body:string}|null} 找不到 → null（由调用方记进 missing）
 */
export function extractContinuity(text) {
  for (const title of CONTINUITY_SECTIONS) {
    const body = sectionLines(text, title)
    if (body !== null) return { title, body: body.join('\n').trim() }
  }
  return null
}

/**
 * 取 `story/overview.md` 里与第 N 讲有关的两块（**只取到 N 为止**）：
 *   · 人物弧：讲次区间**包含 N** 的那一行，只取「段 / 讲次 / 状态」三格
 *     （第四格「标志」写的是"第 9 讲她主动讲起…"这类**后面几讲的里程碑**＝剧透，丢掉）；
 *   · 每讲核心疑问：只取 `< N` 的行（第 N 讲自己的疑问由 `curriculum.md` 的注入块给，
 *     不在这里重复；更不取 `> N` 的行）。
 *
 * @param {string} text — overview.md 全文
 * @param {{lesson:number}} input
 * @returns {{arc:{name:string, range:string, state:string}|null, questions:{lesson:number, core:string}[]}}
 */
export function extractOverviewRecap(text, { lesson }) {
  let arc = null
  const arcLines = sectionByKeyword(text, '人物弧')
  if (arcLines !== null) {
    for (const cells of tableRows(arcLines)) {
      if (cells.length < 3) continue
      const m = cells[1].match(/(\d+)\s*[–—\-~]\s*(\d+)/) ?? cells[1].match(/^(\d+)$/)
      if (m === null) continue
      const from = Number.parseInt(m[1], 10)
      const to = m[2] === undefined ? from : Number.parseInt(m[2], 10)
      if (lesson < from || lesson > to) continue
      arc = { name: cells[0], range: cells[1], state: cells[2] }
      break
    }
  }

  const questions = []
  for (const cells of tableRows(sectionByKeyword(text, '核心疑问'))) {
    if (cells.length < 2) continue
    if (!/^\d+$/.test(cells[0])) continue
    const n = Number.parseInt(cells[0], 10)
    if (n >= lesson) continue
    questions.push({ lesson: n, core: cells[1] })
  }
  return { arc, questions }
}

/**
 * 取 `knowledge_points.md` 里某一讲的讲次标题与知识点原文行。
 * @param {string} text
 * @param {{lesson:number}} input
 * @returns {{title:string|null, lines:string[]}} 没有该讲 → `{title:null, lines:[]}`
 */
export function extractKnowledgePoints(text, { lesson }) {
  const headings = headingsOf(text)
  let title = null
  let body = null
  for (const h of headings) {
    const m = h.title.match(/^第\s*(\d+)\s*讲\s*[·・]\s*(.+)$/)
    if (m === null || Number.parseInt(m[1], 10) !== lesson) continue
    title = m[2].trim()
    const next = headings.find((x) => x.line > h.line && x.level <= h.level)
    body = String(text).split(/\r?\n/).slice(h.line + 1, next === undefined ? undefined : next.line)
    break
  }
  if (title === null) return { title: null, lines: [] }
  // 只取知识点行（`- [ ] **KP-x.y …`）；段内的说明文字不取，免得把格式说明当内容注入
  const lines = body.filter((line) => /^\s*-\s*\[[ x~]\]/.test(line))
  return { title, lines }
}

/**
 * 把一条知识点行压成标题：`- [ ] **KP-3.2 FIFO 的问题** —— 判据：…` → `KP-3.2 FIFO 的问题`。
 * 用于「更早的讲次只列标题」这一档；抽不出 id 的行原样保留（不猜、不丢）。
 * @param {string} line
 * @returns {string}
 */
export function knowledgePointHeading(line) {
  const m = String(line).match(/^\s*-\s*\[[ x~]\]\s*\*\*(KP-\d+\.\d+)\s+([^*]+?)\s*\*\*/)
  if (m === null) return String(line).trim()
  return `${m[1]} ${m[2]}`
}

// ─────────────────────────────────────────────────────────────────────────────
// ④ 拼「前情提要 ＋ 前置知识点」（纯函数）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 拼注入块。**只用传进来的原文**：本函数不新增任何教学事实，只做摘录与标号。
 *
 * @param {object} input
 * @param {number} input.lesson — 要进入的第 N 讲
 * @param {string} input.title — 第 N 讲的标题（knowledge_points.md；没有则空）
 * @param {number[]} [input.skipped] — 写进 progress.md 的跳过讲次（人读文本用）
 * @param {{lesson:number, file:string, title:string, body:string}[]} input.continuity
 * @param {{arc:{name,range,state}|null, questions:{lesson,core}[]}} input.overview
 * @param {{lesson:number, title:string|null, lines:string[], full:boolean}[]} input.prerequisites
 * @param {string[]} [input.missing] — 没摘到的文件／段（如实列出，不假装完整）
 * @returns {string}
 */
export function buildRecap({
  lesson,
  title = '',
  skipped = [],
  continuity = [],
  overview = { arc: null, questions: [] },
  prerequisites = [],
  missing = [],
}) {
  const out = []
  const before = lesson - 1
  const head = title === '' ? `第 ${lesson} 讲` : `第 ${lesson} 讲 · ${title}`
  out.push(`【前情提要 · 进入${head}】`)
  out.push(
    `下面几段是**引擎从教室自己的文件里机械摘录**的（story/overview.md、story/ch*.md、knowledge_points.md），` +
      `不是总结，也不要改写：把它当代课老师交接给你的前情使用。`,
  )
  if (before < 1) {
    out.push('')
    out.push('这是第 1 讲，前面没有讲次。')
  } else {
    out.push(
      skipped.length === 0
        ? `前面 ${before} 讲都在上课记录里（没有跳过的讲次）。`
        : `学生没上过${formatLessonRanges(skipped)}（progress.md 已记为「跳过」，不是「掌握」）。`,
    )
    if (overview.arc !== null) {
      out.push('')
      out.push(`人物弧（本讲所属）：${overview.arc.name}｜${overview.arc.range}｜${overview.arc.state}`)
    }
    if (overview.questions.length > 0) {
      out.push('')
      out.push('▶ 前面几讲的核心疑问（每讲的入口问题）')
      for (const q of overview.questions) out.push(`· 第 ${q.lesson} 讲：${q.core}`)
    }
    if (continuity.length > 0) {
      out.push('')
      out.push('▶ 前面几讲发生了什么（连续性要点，逐字摘录）')
      for (const c of continuity) {
        out.push('')
        out.push(`第 ${c.lesson} 讲 · ${c.file}「${c.title}」`)
        out.push(c.body)
      }
    }
  }

  if (prerequisites.length > 0) {
    const full = prerequisites.filter((p) => p.full !== false).map((p) => p.lesson)
    out.push('')
    out.push(`【第 ${lesson} 讲的前置知识点（取自 knowledge_points.md）】`)
    out.push(
      '这些是前面几讲要拿下的知识点，学生没有它们的记录——按需补讲，不要假设他已经会了。' +
        (full.length > 0 && full.length < prerequisites.length
          ? `${formatLessonRanges(full)}给条目原文，更早的只列标题（判据在 knowledge_points.md 里，需要时自己读那一节）。`
          : ''),
    )
    for (const p of prerequisites) {
      out.push('')
      out.push(p.title === null ? `第 ${p.lesson} 讲` : `第 ${p.lesson} 讲 · ${p.title}`)
      if (p.full === false) {
        for (const line of p.lines) out.push(`· ${knowledgePointHeading(line)}`)
      } else {
        for (const line of p.lines) out.push(line)
      }
    }
  }

  if (missing.length > 0) {
    out.push('')
    out.push('【没摘到的部分（如实列出：这些内容不在前情提要里）】')
    for (const m of missing) out.push(`· ${m}`)
  }

  out.push('')
  out.push(
    `▶ 现在开始上第 ${lesson} 讲。**不要**把上面这些当正文念给学生，也不要把第 ${lesson + 1} 讲之后的东西提前拿出来。`,
  )
  return out.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 读教室文件 ＋ 落盘（唯一有 IO 的两处）
// ─────────────────────────────────────────────────────────────────────────────

/** 读一个文件；不存在返回 null（故事文件可以缺，知识点文件也可以缺——但会记进 missing）。 */
async function readOrNull(file) {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * 收集「跳到第 N 讲」要注入的全部原料（**只读**，不写任何文件）。
 * @param {{classroomDir:string, lesson:number}} input
 * @returns {Promise<{title:string, continuity:object[], overview:object, prerequisites:object[], missing:string[]}>}
 */
export async function readLessonContext({ classroomDir, lesson }) {
  const missing = []

  // knowledge_points.md：第 N 讲的标题 + 第 1..N-1 讲的条目
  const kpText = await readOrNull(join(classroomDir, 'knowledge_points.md'))
  let title = ''
  const prerequisites = []
  if (kpText === null) {
    missing.push('knowledge_points.md 不存在 → 第 N 讲的前置知识点为空')
  } else {
    const own = extractKnowledgePoints(kpText, { lesson })
    if (own.title === null) missing.push(`knowledge_points.md 里没有「## 第 ${lesson} 讲 · …」这一节`)
    else title = own.title
    for (let n = 1; n < lesson; n += 1) {
      const got = extractKnowledgePoints(kpText, { lesson: n })
      if (got.title === null || got.lines.length === 0) {
        missing.push(`knowledge_points.md 里第 ${n} 讲没有知识点条目`)
        continue
      }
      prerequisites.push({ lesson: n, title: got.title, lines: got.lines, full: n >= lesson - PREREQ_FULL_WINDOW })
    }
  }

  // story/overview.md：人物弧一节 + 每讲核心疑问
  const overviewText = await readOrNull(join(classroomDir, 'story', 'overview.md'))
  const overview = overviewText === null ? { arc: null, questions: [] } : extractOverviewRecap(overviewText, { lesson })
  if (overviewText === null) missing.push('story/overview.md 不存在 → 没有人物弧与各讲核心疑问')
  else if (overview.arc === null) missing.push('story/overview.md 里没有包含第 N 讲讲次区间的人物弧行')

  // story/ch{01..N-1}.md：每讲的连续性要点
  const continuity = []
  for (let n = 1; n < lesson; n += 1) {
    const rel = `story/ch${String(n).padStart(2, '0')}.md`
    const text = await readOrNull(join(classroomDir, rel))
    if (text === null) {
      missing.push(`${rel} 不存在 → 第 ${n} 讲的连续性要点没摘到`)
      continue
    }
    const got = extractContinuity(text)
    if (got === null || got.body === '') {
      missing.push(`${rel} 里没有「${CONTINUITY_SECTIONS.join('」/「')}」段 → 第 ${n} 讲的连续性要点没摘到`)
      continue
    }
    continuity.push({ lesson: n, file: rel, title: got.title, body: got.body })
  }

  return { title, continuity, overview, prerequisites, missing }
}

/**
 * 「跳到第 N 讲」的完整动作（IO）：算跳过集合 → 渲染 → **原子写盘**。
 *
 * 🔴 落盘顺序（任务书的硬要求）：**写盘成功才算跳成**。失败时返回
 *    `{ persisted:false, lesson:<previous>, note:<原因> }`——调用方按 `persisted` 决定要不要改内存，
 *    `lesson` 字段本身也已经退回旧值，两种接线方式都不会出现「内存说 5、盘上还是 1」。
 *
 * @param {object} input
 * @param {string} input.classroomDir — 教室目录（progress.md 的相对路径基准）
 * @param {object} input.manifest — `loadManifest` 产出
 * @param {number|string} input.lesson — 目标讲次（校验在 `parseLessonNumber`）
 * @param {(msg:string)=>void} [input.log]
 * @param {{withFileLock:Function, writeFileAtomic:Function}} [input.io] — 注入用（单测造写盘失败）
 * @returns {Promise<object>} 见返回值组装处
 */
export async function enterLesson({ classroomDir, manifest, lesson, log = () => {}, io = null }) {
  const max = lessonsDeclaredBy(manifest?.classroom)
  const target = parseLessonNumber(lesson, { max })
  const previous = readRuntimeLesson(manifest, { baseDir: classroomDir })

  const file = resolveProgressFile(manifest, { baseDir: classroomDir })
  if (file === null) {
    return {
      persisted: false,
      lesson: previous,
      previous,
      skipped: [],
      title: '',
      recap: '',
      file: null,
      note: '本教室未声明 runtime_store → 没有 progress 文件可写，跳讲无法落盘（讲次不移动）',
    }
  }

  // 注入块先备好（只读教室文件；写盘失败也不浪费，返回值里仍然给出去处）
  let context
  try {
    context = await readLessonContext({ classroomDir, lesson: target })
  } catch (cause) {
    context = { title: '', continuity: [], overview: { arc: null, questions: [] }, prerequisites: [], missing: [`读教室文件失败：${cause?.message ?? cause}`] }
  }

  // 原子写：测试可注入（`io`），生产走本地实现（lib/atomic-write.mjs，与宿主同语义）。
  const host = io ?? { withFileLock, writeFileAtomic }

  let nextSkipped = new Set()
  try {
    await host.withFileLock(file, async () => {
      const text = await readFile(file, 'utf8')
      // 跳过集合的唯一读法：notestore 的 readProgressState（同一个键名、同一份解析）
      nextSkipped = nextSkippedLessons({ previous, lesson: target, skipped: readProgressState(text).skippedLessons })
      const rendered = renderProgressLesson(text, {
        lesson: target,
        title: context.title,
        skipped: nextSkipped,
        file,
      })
      await host.writeFileAtomic(file, rendered, { mode: 0o600 })
    })
  } catch (cause) {
    const reason = cause?.message ?? String(cause)
    log(`🔴 跳讲落盘失败（讲次不移动）：${reason}`)
    return {
      persisted: false,
      lesson: previous,
      previous,
      skipped: [...nextSkipped].sort((a, b) => a - b),
      title: context.title,
      recap: '',
      file,
      note: `落盘失败（讲次未移动，仍是第 ${previous} 讲）：${reason}`,
    }
  }

  const skipped = [...nextSkipped].sort((a, b) => a - b)
  const recap = buildRecap({
    lesson: target,
    title: context.title,
    skipped,
    continuity: context.continuity,
    overview: context.overview,
    prerequisites: context.prerequisites,
    missing: context.missing,
  })
  log(
    `跳讲：第 ${previous} 讲 → 第 ${target} 讲（跳过 ${skipped.length === 0 ? '无' : skipped.join(',')}）` +
      `｜已写回 ${file}`,
  )
  return {
    persisted: true,
    lesson: target,
    previous,
    skipped,
    title: context.title,
    recap,
    file,
    note: `已写回 ${file}（current_lesson: ${target}${skipped.length === 0 ? '' : `，${SKIPPED_KEY}: ${skipped.join(',')}`}）`,
  }
}
