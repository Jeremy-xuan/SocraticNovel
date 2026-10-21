// lib/diagram.mjs — 板书图（classroom_draw 工具）的**纯函数层**：入参校验、文件名、索引渲染。
//
// 分工（写死，避免"谁说了算"含糊）：
//   ① 本模块＝**结构性校验**（图类型关键字／括号配平／有没有图内容／是不是字符拼的示意图）
//      —— 纯函数、零 IO、不依赖任何第三方解析器，永远可跑。
//   ② `lib/mermaid-parse.mjs` ＝**真解析校验**（mermaid 官方 parse，跑在 worker 里）
//      —— 权威判据：能不能渲染，由它说了算（见该文件头）。
//   🔴 结构性校验**不是**真解析的替代品，也不许拿它当"降级路径"：
//      真解析不可用 → 工具**报错**（不静默放行），见 lib/mermaid-parse.mjs。
//
// 🔴 为什么入参非法一律**报错**而不是静默修正（本项目已被"静默不生效"坑过三次）：
//    · 空内容／超长／围栏包裹／类型关键字对不上／括号不配平 → 全是**模型自己能改**的错，
//      错误信息里直接写清"期望什么"（见 problems 文案），模型下一轮就能改对；
//    · 静默截断或静默去围栏＝把"模型写错了"这件事藏起来，等于让一张画不出来的图落盘。
//
// 落盘约定（见 index.mjs 的 classroom_draw 工具）：
//   <教室目录>/runtime/diagrams/<文件名>.mmd   ← 文件内容 = **逐字**的 mermaid 源码（无围栏、无包装）
//   <教室目录>/runtime/diagrams/index.md       ← 人读索引：一行一张图（第几讲画了什么）

import { formatLocalTime } from './postclass.mjs'

/** 图类型 → mermaid 首行关键字。**只列本机 mermaid 11 实测能解析的类型**（见报告 §1）。 */
export const DIAGRAM_KINDS = {
  flowchart: { keywords: ['flowchart', 'graph'], label: '流程图' },
  sequence: { keywords: ['sequenceDiagram'], label: '时序图' },
  state: { keywords: ['stateDiagram-v2', 'stateDiagram'], label: '状态图' },
  class: { keywords: ['classDiagram'], label: '类图' },
  er: { keywords: ['erDiagram'], label: '实体关系图' },
  gantt: { keywords: ['gantt'], label: '甘特图' },
  pie: { keywords: ['pie'], label: '饼图' },
  mindmap: { keywords: ['mindmap'], label: '思维导图' },
  journey: { keywords: ['journey'], label: '旅程图' },
  timeline: { keywords: ['timeline'], label: '时间线' },
  gitgraph: { keywords: ['gitGraph'], label: '提交图' },
  quadrant: { keywords: ['quadrantChart'], label: '象限图' },
}

/** 合法的 kind 值（宿主 schema 的 enum 与错误文案都从这里取，避免两处各写一份）。 */
export const DIAGRAM_KIND_IDS = Object.keys(DIAGRAM_KINDS)

/** mermaid 源码字符数上限。超过 → 报错（**不截断**：截断后的图不是模型画的那张图）。 */
export const MAX_SOURCE_CHARS = 20000

/** 标题／说明的字数上限（标题还必须单行）。 */
export const MAX_TITLE_CHARS = 120
export const MAX_CAPTION_CHARS = 500

/** 板书图子目录（相对教室目录）与索引文件名。 */
export const DIAGRAMS_SUBDIR = 'diagrams'
export const INDEX_FILE = 'index.md'

/**
 * 舞台读图路由的前缀（契约 K2.1：`boardRoute` 恒为 `"/stage-board/diagrams/" + diagramId`）。
 * 🔴 这是**跨端契约**的一部分：舞台宿主半边的 `GET /stage-board/diagrams/<id>` 就按它读。
 */
export const BOARD_ROUTE_PREFIX = '/stage-board/diagrams/'

/**
 * 图 id：`.mmd` 文件名去掉扩展名（契约 K2.1 逐字：如 `L03-T05-20261020-231500-flowchart`）。
 * 接受带目录的路径（`diagrams/x.mmd`）。**纯函数**。
 * @param {string} file
 * @returns {string}
 */
export function diagramIdOf(file) {
  const base = String(file ?? '').split(/[\\/]/).pop() ?? ''
  return base.replace(/\.mmd$/u, '')
}

/**
 * 舞台读图路由（契约 K2.1）。**纯函数**。
 * @param {string} diagramId
 * @returns {string} `"/stage-board/diagrams/<id>"`
 */
export function boardRouteOf(diagramId) {
  return `${BOARD_ROUTE_PREFIX}${diagramId}`
}

/**
 * 板书事件的结构化形状（K2.1 的 `board` 字段 / `presentationMeta` 的内容）。**纯函数**。
 * 🔴 `lesson` 缺失写 `0`（契约："lesson 缺失时写 lesson=0"）。
 * @param {{diagramId:string, lesson:number|null|undefined, turn:number, kind:string}} spec
 * @returns {{id:string, lesson:number, turn:number, kind:string}}
 */
export function boardSummary({ diagramId, lesson, turn, kind }) {
  return {
    id: String(diagramId),
    lesson: Number.isInteger(lesson) && lesson > 0 ? lesson : 0,
    turn: Number.isInteger(turn) ? turn : 0,
    kind: String(kind),
  }
}

/**
 * `output.render` 文本末尾那行**机器可读行**（契约 K2.1 的兜底路径，也是给模型自己看的）。**纯函数**。
 * 形状写死：`[board] id=<diagramId> lesson=<N> turn=<T> kind=<kind>`
 * （舞台侧按行首锚定的正则抓这一行，见契约 K2.3；格式一改，两个消费方都要跟）。
 * @param {{id:string, lesson:number, turn:number, kind:string}} board
 * @returns {string}
 */
export function renderBoardLine(board) {
  return `[board] id=${board.id} lesson=${board.lesson} turn=${board.turn} kind=${board.kind}`
}

/** 字符拼示意图里必然出现、而合法 mermaid 里不会出现的制表符边框字符。 */
const BOX_DRAWING = /[─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬▏▕]/

/** mermaid 的自由文本行（这些行里的括号/引号是**给人读的文字**，不参与配平）。 */
const FREE_TEXT_LINE = /^(note|end note|%%|title|acctitle|accdescr|section)\b/i

/**
 * 校验并解析一次画图入参。**纯函数**（无 IO、无第三方解析器）。
 *
 * 判定顺序即 problems 的顺序；**一次报全**（模型一轮就能全改完，不用来回试）。
 *
 * @param {{kind?: unknown, source?: unknown, title?: unknown, caption?: unknown}} args
 * @returns {{ok: boolean, problems: string[], kind: string|null, source: string,
 *            title: string, caption: string, header: string, bodyLines: number}}
 */
export function checkDiagramArgs(args = {}) {
  const problems = []
  const rawKind = args?.kind
  const kind = typeof rawKind === 'string' && rawKind !== '' ? rawKind : null

  // ① 图类型必须是枚举内的值（宿主 schema 也拦一层；这里保证纯函数单独可测）
  if (kind === null) {
    problems.push(`kind 必填，且必须是下列之一：${DIAGRAM_KIND_IDS.join(' / ')}`)
  } else if (!Object.hasOwn(DIAGRAM_KINDS, kind)) {
    problems.push(`kind=${JSON.stringify(kind)} 不是支持的图类型；可用：${DIAGRAM_KIND_IDS.join(' / ')}`)
  }

  // ② 内容非空
  const rawSource = args?.source
  const source = typeof rawSource === 'string' ? rawSource : ''
  if (source.trim() === '') {
    problems.push(
      'source 为空：source 必须是**完整的 mermaid 源码正文**（含首行的图类型关键字），' +
        `例如 "flowchart TD\\n  A[进程A] --> B[进程B]"`,
    )
  } else if (source.length > MAX_SOURCE_CHARS) {
    problems.push(
      `source 过长：${source.length} 字符 > 上限 ${MAX_SOURCE_CHARS}。` +
        `请把图拆成更小的几张、或删掉与机制无关的细节（🔴 引擎不截断——截断后的图不是你画的那张图）`,
    )
  }

  // ③ 不许把 markdown 围栏一起塞进来（落盘的是源码正文，围栏会原样写进 .mmd 文件）
  if (source.includes('```')) {
    problems.push(
      'source 里含 markdown 围栏（``` ）：请只传围栏**内部**的 mermaid 源码正文，' +
        '第一行就是图类型关键字（如 flowchart / sequenceDiagram / stateDiagram-v2）',
    )
  }

  // ④ 首行（跳过空行与 %% 注释）必须是该 kind 对应的 mermaid 关键字
  const lines = source.split('\n')
  let headerIndex = -1
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (trimmed === '' || trimmed.startsWith('%%')) continue
    headerIndex = i
    break
  }
  const header = headerIndex === -1 ? '' : lines[headerIndex].trim()
  if (header !== '' && kind !== null && Object.hasOwn(DIAGRAM_KINDS, kind)) {
    const keywords = DIAGRAM_KINDS[kind].keywords
    const matched = keywords.some((k) => header.toLowerCase().startsWith(k.toLowerCase()))
    if (!matched) {
      problems.push(
        `图类型关键字对不上：kind=${kind} 要求首行以 ${keywords.map((k) => `"${k}"`).join(' 或 ')} 开头，` +
          `实际首行是 ${JSON.stringify(header)}`,
      )
    }
  }

  // ⑤ 光有图类型关键字不算图：后面至少要有一行内容
  let bodyLines = 0
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (trimmed === '' || trimmed.startsWith('%%')) continue
    bodyLines += 1
  }
  if (header !== '' && bodyLines === 0) {
    problems.push('图里没有任何内容：首行图类型关键字之后至少要有一行节点/连线/条目')
  }

  // ⑥ 字符拼的示意图不是 mermaid（PoC 实测：不给工具时模型就是这样交差的）
  const boxed = source.match(BOX_DRAWING)
  if (boxed !== null) {
    problems.push(
      `source 里出现字符拼示意图用的制表符边框字符 ${JSON.stringify(boxed[0])}：` +
        '这不是 mermaid 源码。请用 mermaid 语法把图重画一遍（节点写 A[文字]、连线写 A --> B）',
    )
  }

  // ⑦ 括号配平（自由文本行除外——那些括号是给人读的文字）
  //    🔴 ER 图**不查花括号**：ER 的基数记号本身就是不配平的花括号
  //    （`A ||--o{ B : 持有` 里的 `o{`、`}o--||` 里的 `}o`）。实测踩过：全查会把合法 ER 图判死。
  const unbalanced = findUnbalancedBracket(lines, { checkBraces: kind !== 'er' })
  if (unbalanced !== null) problems.push(unbalanced)

  // ⑧ 标题/说明的形状
  const title = typeof args?.title === 'string' ? args.title.trim() : ''
  const caption = typeof args?.caption === 'string' ? args.caption.trim() : ''
  if (title.includes('\n')) problems.push('title 必须是单行（不要换行）')
  else if (title.length > MAX_TITLE_CHARS) {
    problems.push(`title 过长：${title.length} 字符 > 上限 ${MAX_TITLE_CHARS}`)
  }
  if (caption.length > MAX_CAPTION_CHARS) {
    problems.push(`caption 过长：${caption.length} 字符 > 上限 ${MAX_CAPTION_CHARS}`)
  }

  return {
    ok: problems.length === 0,
    problems,
    kind,
    source,
    title,
    caption,
    header,
    bodyLines,
  }
}

/**
 * 括号配平检查（`()` `[]` `{}`，忽略引号内的字符与自由文本行）。
 * @param {string[]} lines
 * @param {{checkBraces?: boolean}} [opts] - `checkBraces:false` 时只查 `()` `[]`（ER 图用，见调用处）
 * @returns {string|null} 不配平时返回一句可改的错误文案；配平返回 null
 */
export function findUnbalancedBracket(lines, opts = {}) {
  const pairs = opts.checkBraces === false ? { '(': ')', '[': ']' } : { '(': ')', '[': ']', '{': '}' }
  const closers = Object.fromEntries(Object.entries(pairs).map(([open, close]) => [close, open]))
  const stack = []
  let inNote = false
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (/^note\b/i.test(trimmed)) inNote = true
    if (inNote) {
      if (/^end note\b/i.test(trimmed)) inNote = false
      continue
    }
    if (trimmed === '' || FREE_TEXT_LINE.test(trimmed)) continue
    let quote = null
    for (const ch of lines[i]) {
      if (quote !== null) {
        if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'") {
        quote = ch
        continue
      }
      if (pairs[ch] !== undefined) stack.push({ ch, line: i + 1 })
      else if (closers[ch] !== undefined) {
        const top = stack.pop()
        if (top === undefined || top.ch !== closers[ch]) {
          return `第 ${i + 1} 行的 ${ch} 没有对应的 ${closers[ch]}（括号不配平）：${trimmed}`
        }
      }
    }
    if (quote !== null) return `第 ${i + 1} 行的引号 ${quote} 没有闭合：${trimmed}`
  }
  if (stack.length > 0) {
    const top = stack[stack.length - 1]
    return `第 ${top.line} 行的 ${top.ch} 没有闭合（括号不配平）：${lines[top.line - 1].trim()}`
  }
  return null
}

/** 两位补零。 */
function pad2(n) {
  return String(n).padStart(2, '0')
}

/**
 * 生成源文件名：`L<讲次>-T<回合>-<yyyyMMdd-HHmmss>-<图类型>.mmd`。
 * @param {{lesson:number|null, turn:number, at:number, kind:string}} spec
 */
export function diagramFileName({ lesson, turn, at, kind }) {
  const d = new Date(at)
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  const lessonPart = lesson === null || lesson === undefined ? 'Lxx' : `L${pad2(lesson)}`
  return `${lessonPart}-T${pad2(turn)}-${stamp}-${kind}.mmd`
}

/**
 * 文件名冲突时加 `-2`/`-3` 后缀（同一秒内连画两张时用）。**纯函数**：由调用方告知哪些已存在。
 * @param {string} name - diagramFileName 的产物
 * @param {(candidate:string) => boolean} exists
 */
export function uniqueFileName(name, exists) {
  if (!exists(name)) return name
  const stem = name.replace(/\.mmd$/, '')
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${stem}-${n}.mmd`
    if (!exists(candidate)) return candidate
  }
  throw new Error(`同名板书图已存在 100 个：${name}（时间戳精度不足，请检查系统时钟）`)
}

/** 索引文件的开头（首次创建时写一次；此后只追加数据行）。 */
export function renderIndexHeader() {
  return [
    '# 板书图索引',
    '',
    '> **本文件由引擎自动追加**（`classroom_draw` 工具）：每画一张图，就在本目录落一个 `.mmd` 源文件',
    '> （内容＝**逐字**的 mermaid 源码），并在这里追加一行。**只追加，不删。**',
    '> 🔴 本文件是给人看的目录；图的内容看对应源文件。讲次取自 `runtime/progress.md` 的 `current_lesson`，',
    '> 回合号是本会话内的第几个回合；**「会话」列是「这节课是哪一次会话」的唯一判据**',
    '> （回合号在新会话里从 1 重来，所以只靠「讲次+回合」分不清两次会话的板书）。',
    '',
    // 🔴 分隔行按**表头列数**给（8 列 → 8 组 `---`）：原先是 7 列表头配 6 组分隔符，
    //    多一列的同时把这个老笔误一并纠正。
    '| 日期 | 讲次 | 回合 | 图类型 | 标题 | 说明 | 源文件 | 会话 |',
    '|---|---|---|---|---|---|---|---|',
  ].join('\n')
}

/**
 * 渲染索引的一行。**纯函数**。
 * 🔴 `caption` 必须落进索引：模型给了说明却不落盘＝信息静默消失（本项目红线）。
 * 🔴 **会话列（W-e，契约 K2.1）**：索引原来只有「日期/讲次/回合/图类型/标题/说明/源文件」七列，
 *    没有「这节课是哪一次会话」，而**回合号是会话内自增的**（新会话从 1 重来）——
 *    同一讲跨两次会话时，只靠「讲次+回合」分不清哪些图属于"本节课"。
 *    故**在末尾追加一列 `会话`**（放末尾是为了让按位置取前 7 格的老读法不受影响）。
 *    取不到 session id 时写 `—`（不编造）。
 * @param {{timeLabel:string, lesson:number|null, turn:number, kind:string, title:string,
 *          caption?:string, file:string, session?:string|null}} row
 */
export function renderIndexRow({ timeLabel, lesson, turn, kind, title, caption = '', file, session = null }) {
  const lessonCell = lesson === null || lesson === undefined ? '—' : `第 ${lesson} 讲`
  const cell = (text, empty) => (text === '' ? empty : text.replace(/\|/g, '\\|').replace(/\n+/g, ' '))
  const sessionCell = typeof session === 'string' && session !== '' ? `\`${session}\`` : '—'
  return (
    `| ${timeLabel} | ${lessonCell} | ${turn} | ${kind} | ${cell(title, '（未给标题）')} | ` +
    `${cell(caption, '—')} | \`${file}\` | ${sessionCell} |`
  )
}

/**
 * 把一行追加进索引全文（文件不存在时用 renderIndexHeader 打底）。**纯函数**。
 * @param {string|null} content - 索引当前全文（null＝文件不存在）
 * @param {string} row
 */
export function appendIndexRow(content, row) {
  const base = content === null || content === undefined || content.trim() === ''
    ? renderIndexHeader()
    : content.replace(/\s+$/, '')
  return `${base}\n${row}\n`
}

/** 供工具返回值用：本机时间标签（与 postclass 的 session_log 口径一致）。 */
export function nowLabel(at) {
  return formatLocalTime(at)
}
