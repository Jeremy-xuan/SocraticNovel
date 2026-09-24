// lib/postclass.mjs — 课后自动更新教室 runtime/（P1 · B2「它记得你」宿主侧实现）
//
// 目标：一节课（= 一个宿主 turn）结束后，把该回合的**确定性事实**追加进教室
//       `runtime/` 下的状态文件。第一版只实现 `runtime/session_log.md`，其余 7 个
//       文件（diary / learner_profile / mistake_log / progress / review_queue /
//       session_archive / wechat_group）留 `updaters` 接口，**不实现**。
//
// 🔴 项目红线：**不许用 LLM 生成式地改写教学事实。** 本模块只做确定性结构化追加：
//    事实一律逐字取自 session log 的持久事件，不做概括、不做润色、不做改写。
//
// 取证依据（全部来自 tmp/dsh-installed/，与安装版 dsh 0.1.5-rc.2 逐字节相同；
// 详见 开源线/DSH定制/取证_S1_turn-stopping与sessionProjections_2026-09-23.md）：
//   ① `agent/turn-stopping` 是 turn 自然停止边界上的唯一 awaited 通知：
//      dsh-agent-loop/lib/index.js:967 `await this.dispatch.serial("agent/turn-stopping", { turn, signal })`
//      派发在 `turn/end` 之前、`step/end` 之后 → 本回合的 user/assistant/tool 事件
//      **已经全部 append 进 session log**，可安全读取。
//   ② payload 形状（dsh-tool-cordis/lib/index.js:5074 逐字签名）：
//      `(this: Scoped<Agent>, payload: { agent: Agent; turn: number; signal: AbortSignal })`
//      —— **通知型，无 `next`**，不能改决策。
//   ③ 消息事实只能从持久 session 事件取（官方：turn/step 边界不是 agent 事件）：
//      `session.snapshotEvents()` / `session.seq`（dsh-session/lib/index.js:1106、1124）。
//      **`user/message` 事件不带 turn 字段**（20 个真实会话实测）→ 用 seq 区间切本回合。
//   ④ 学生输入判据（实测白名单）：`user/message` 且 `source.kind === 'user'`。
//   ⑤ 原子写：`@deepseek-ai/dsh-atomic-write` 的 `writeFileAtomic` / `withFileLock`
//      （wx 独占创建随机后缀临时文件 + rename → 读者永不看到半截内容）。

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** 本插件自有注入的 source.kind（index.mjs 注入 classroom 块时使用）。 */
export const ENGINE_SOURCE_KIND = 'socratic-engine'

/** 学生（人类）输入的 source.kind（实测白名单，见取证件 b-3b）。 */
export const STUDENT_SOURCE_KIND = 'user'

/** 第一版唯一实现的 runtime 文件。 */
export const DEFAULT_SESSION_LOG_FILE = 'session_log.md'

/** 教室 runtime 文件现有权限位为 0600（`-rw-------`，实测 `ls -l`）。 */
export const DEFAULT_FILE_MODE = 0o600

/** 教室 `session_log.md` 里「尚无记录」的占位行（首条追加时移除）。 */
const EMPTY_PLACEHOLDER = /^（尚无。[^\n]*）[ \t]*\n?/m

/**
 * 幂等去重标记。写前先读文件，命中该标记即视为本回合已写过。
 *
 * 🔴 **讲次字段（DRAW-2）**：讲次作为**同一行上的第二个注释**追加，`session=… turn=…`
 *   这一截**逐字不变**——理由：既有解析方（`code/acceptance/lib/asserts.mjs` 的
 *   `/<!-- socratic-engine:session=(\S+) turn=(\d+) -->/`）钉的是旧形式，改成一格内含
 *   `lesson=` 会让它一条都匹配不到（而 acceptance 树不在本轮可改范围内）。
 *   两个注释都在同一行上，所以"逐回合标记带讲次"成立，老解析方不受影响。
 *   `lesson` 缺省（教室没有讲次门／取不到值）→ **原样返回旧标记**（逐字节相同）。
 *
 * @param {string} sessionId - 宿主 session id
 * @param {number} turn - 回合号
 * @param {number|null} [lesson] - 当时的讲次；非正整数＝没有讲次概念
 * @returns {string} 单行 HTML 注释（渲染后不可见，但留在文件里可被检索）
 */
export function turnMarker(sessionId, turn, lesson = null) {
  const base = `<!-- socratic-engine:session=${sessionId} turn=${turn} -->`
  const n = normalizeLesson(lesson)
  return n === null ? base : `${base}<!-- socratic-engine:lesson=${n} -->`
}

/** 讲次规范化：只有正整数才算"有讲次"（其余一律当没有，不写字段）。 */
export function normalizeLesson(value) {
  return Number.isInteger(value) && value > 0 ? value : null
}

/** 逐回合标记的宽松解析式（一格内含 lesson 的形式也认；老记录缺 lesson 时该组不参与匹配）。 */
const MARKER_RE = /<!--\s*socratic-engine:session=(\S+)\s+turn=(\d+)(?:\s+lesson=(\d+))?\s*-->/g
/** 同行追加的讲次注释（DRAW-2 的新形式）。 */
const LESSON_ONLY_RE = /<!--\s*socratic-engine:lesson=(\d+)\s*-->/g

/**
 * 从 `session_log.md` 全文里解析出逐回合标记。**纯函数**，容忍两种格式：
 *   ① 老记录：`<!-- socratic-engine:session=X turn=2 -->` → `lesson: null`
 *   ② 新记录：`… turn=2 --><!-- socratic-engine:lesson=1 -->` → `lesson: 1`
 *   （另外也认一格内含 `lesson=` 的写法，便于将来收敛成单注释形式。）
 * @param {string} content - 文件全文
 * @returns {{session:string, turn:number, lesson:number|null, line:string}[]}
 */
export function parseTurnMarkers(content) {
  const out = []
  for (const line of String(content ?? '').split('\n')) {
    for (const m of line.matchAll(MARKER_RE)) {
      let lesson = m[3] === undefined ? null : Number.parseInt(m[3], 10)
      if (lesson === null) {
        for (const l of line.matchAll(LESSON_ONLY_RE)) {
          lesson = Number.parseInt(l[1], 10)
          break
        }
      }
      out.push({ session: m[1], turn: Number.parseInt(m[2], 10), lesson, line })
    }
  }
  return out
}

/** 取一条消息里全部 text 块的文本（其余块类型忽略）。 */
function textBlocksOf(message) {
  const content = message?.content
  if (!Array.isArray(content)) return []
  const out = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text !== '') out.push(block.text)
  }
  return out
}

/** 把多行文本压成单行（仅折叠空白，不改字）。 */
function oneLine(text) {
  return text.replace(/\s+/g, ' ').trim()
}

/** 本地时间 `YYYY-MM-DD HH:mm`。 */
export function formatLocalTime(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 从 session 事件里切出「本回合」的确定性事实。**纯函数**。
 *
 * 区间判法（取证 b-3 / b-3b）：本回合 = 最后一个 `turn/start{turn}` 之后，
 * 到同回合 `turn/end{turn}`（若已存在）之前的一段事件。
 * turn-stopping 触发时 `turn/end` 尚未 append，故切片自然延伸到日志末尾。
 *
 * @param {readonly object[]} events - `session.snapshotEvents()` 的结果
 * @param {{turn: number}} options
 * @returns {{turn:number, time:number|null, phase:string|null, lesson:number|null,
 *            studentTexts:string[], toolCalls:{name:string,isError:boolean|null}[], hasContent:boolean}}
 */
export function extractTurnFacts(events, { turn } = {}) {
  const list = Array.isArray(events) ? events : []
  let start = -1
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.type === 'turn/start' && list[i]?.data?.turn === turn) {
      start = i
      break
    }
  }
  let end = list.length
  if (start >= 0) {
    for (let i = start + 1; i < list.length; i += 1) {
      if (list[i]?.type === 'turn/end' && list[i]?.data?.turn === turn) {
        end = i
        break
      }
    }
  } else {
    start = 0 // 未找到 turn/start（异常日志）：退化为整段扫描，宁可不写也不猜区间
  }

  const studentTexts = []
  const calls = new Map()
  const order = []
  let lastTime = null

  for (const event of list.slice(start, end)) {
    if (typeof event?.time === 'number' && (lastTime === null || event.time > lastTime)) lastTime = event.time

    if (event?.type === 'user/message') {
      if (event.data?.source?.kind === STUDENT_SOURCE_KIND) studentTexts.push(...textBlocksOf(event.data))
      continue
    }
    if (event?.type === 'tool/call') {
      const callId = event.data?.callId
      if (typeof callId === 'string' && !calls.has(callId)) {
        calls.set(callId, { name: event.data?.name ?? '(未命名)', isError: null })
        order.push(callId)
      }
      continue
    }
    if (event?.type === 'tool/result') {
      const block = event.data?.message?.content?.[0]
      const callId = block?.toolCallId ?? event.data?.message?.source?.callId
      if (typeof callId !== 'string') continue
      const isError = block?.isError === true
      const known = calls.get(callId)
      if (known) known.isError = isError
      else {
        calls.set(callId, { name: '(未配对)', isError })
        order.push(callId)
      }
    }
  }

  return {
    turn,
    time: lastTime,
    phase: null,
    lesson: null,
    studentTexts,
    toolCalls: order.map((callId) => calls.get(callId)),
    hasContent: studentTexts.length > 0 || order.length > 0,
  }
}

/**
 * 渲染 `session_log.md` 的一条追加记录。**纯函数**。
 * 只写确定性事实：回合号、时间、相位、**当时的讲次**、学生原话、工具名与成败。
 * 🔴 讲次（DRAW-2）：有讲次时写进标题（人读，`第 N 讲`）＋ 标记（机读，`lesson=N`）；
 *    没有讲次时**一个字都不加**（老教室／老记录的行为逐字节不变）。
 * @param {object} facts - extractTurnFacts 的返回值
 * @param {{marker:string, timeLabel:string}} env
 * @returns {string} 不含首尾空行的多行文本
 */
export function renderSessionLogEntry(facts, { marker, timeLabel }) {
  const head = [`第 ${facts.turn} 回合`, timeLabel]
  if (facts.phase) head.push(`相位 ${facts.phase}`)
  const lesson = normalizeLesson(facts.lesson)
  if (lesson !== null) head.push(`第 ${lesson} 讲`)
  const lines = [marker, `### ${head.join(' · ')}`]
  if (facts.studentTexts.length > 0) {
    lines.push(`- 学生：${facts.studentTexts.map(oneLine).join(' ／ ')}`)
  }
  if (facts.toolCalls.length > 0) {
    const tools = facts.toolCalls.map((c) => `${c.name}（${toolOutcome(c.isError)}）`)
    lines.push(`- 工具：${tools.join(' ／ ')}`)
  }
  return lines.join('\n')
}

/** 工具成败的三态标签：无结果记录＝未完成（不得谎报成功）。 */
function toolOutcome(isError) {
  if (isError === true) return '失败'
  if (isError === false) return '成功'
  return '未完成'
}

/**
 * 把一条记录追加到文件全文末尾（保持原格式，只追加）。**纯函数**。
 * 首条追加时移除教室自带的「（尚无…）」占位行（该行原文即指示首条写在此处）。
 * @param {string} content - 文件当前全文
 * @param {string} entry - renderSessionLogEntry 的产物
 * @returns {string} 新全文
 */
export function appendEntryToContent(content, entry) {
  const base = String(content ?? '').replace(EMPTY_PLACEHOLDER, '')
  const trimmed = base.replace(/\s+$/, '')
  return trimmed === '' ? `${entry}\n` : `${trimmed}\n\n${entry}\n`
}

/** 宿主原子写包（`@deepseek-ai/dsh-atomic-write`）。动态 import：单测环境无宿主也能加载本模块。 */
async function loadHostAtomicWrite() {
  const mod = await import('@deepseek-ai/dsh-atomic-write')
  if (typeof mod?.writeFileAtomic !== 'function' || typeof mod?.withFileLock !== 'function') {
    throw new Error('@deepseek-ai/dsh-atomic-write 未导出 writeFileAtomic/withFileLock')
  }
  return { writeFileAtomic: mod.writeFileAtomic, withFileLock: mod.withFileLock }
}

/** 第一版唯一 updater：追加 `runtime/session_log.md`。 */
export const SESSION_LOG_UPDATER = {
  file: DEFAULT_SESSION_LOG_FILE,
  render: (facts, env) => renderSessionLogEntry(facts, env),
}

/**
 * 课后更新主入口。集成时只需在 index.mjs 里 `registerPostClass(ctx, {...})`。
 *
 * @param {object} ctx - Cordis 上下文（需要 `ctx.on`）
 * @param {object} opts
 * @param {string | (() => string | null)} [opts.runtimeDir] - 教室 runtime/ 目录绝对路径；也可传「每回合求值的取值函数」（配合教室自动发现）。缺省＝不写＋记录原因
 * @param {boolean} [opts.enabled] - 默认 true
 * @param {object[]} [opts.updaters] - 更新器清单，默认 `[SESSION_LOG_UPDATER]`
 * @param {number} [opts.mode] - 写入权限位，默认 0o600
 * @param {() => string|null} [opts.getPhase] - 取当前相位（用于记录；不可用则省略该字段）
 * @param {() => number|null} [opts.getLesson] - 取**当时的讲次**（本轮要讲的讲次，用于记录；
 *        缺省或取不到值 → 标记与标题都不带讲次，行为与升级前逐字节相同）
 * @param {() => number} [opts.now] - 取当前时间（默认 Date.now）
 * @param {(ms:number) => string} [opts.formatTime] - 时间格式化（默认 formatLocalTime）
 * @param {{writeFileAtomic:Function, withFileLock:Function}} [opts.atomicWrite] - 注入 IO（测试用）
 * @param {(...args:any[])=>void} [opts.log]
 * @returns {{enabled: boolean, reason?: string}}
 */
export function registerPostClass(ctx, opts = {}) {
  const log = opts.log ?? (() => {})
  if (opts.enabled === false) return { enabled: false, reason: 'enabled=false' }
  if (typeof ctx?.on !== 'function') return { enabled: false, reason: 'ctx.on 不可用' }
  if (!opts.runtimeDir) {
    log('未配置 runtimeDir：课后更新关闭（不写任何文件）')
    return { enabled: false, reason: 'runtimeDir 缺省' }
  }

  const runtimeDirOpt = opts.runtimeDir
  const updaters = opts.updaters ?? [SESSION_LOG_UPDATER]
  const mode = opts.mode ?? DEFAULT_FILE_MODE
  const getPhase = opts.getPhase ?? (() => null)
  const getLesson = opts.getLesson ?? (() => null)
  const now = opts.now ?? (() => Date.now())
  const formatTime = opts.formatTime ?? formatLocalTime
  const injectedIo = opts.atomicWrite ?? null
  let ioPromise = null

  function resolveIo() {
    if (injectedIo) return Promise.resolve(injectedIo)
    ioPromise ??= loadHostAtomicWrite()
    return ioPromise
  }

  /** runtimeDir 允许是字符串或「每回合求值的取值函数」（教室自动发现会在会话中途切换教室）。 */
  function resolveRuntimeDir() {
    const value = typeof runtimeDirOpt === 'function' ? runtimeDirOpt() : runtimeDirOpt
    return typeof value === 'string' && value !== '' ? value : null
  }

  /**
   * 对单个 runtime 文件做一次「读 → 判重 → 原子写」。
   * 任何失败都只记录、不抛出（turn-stopping 抛错会打断整个 turn）。
   */
  async function updateOne(runtimeDir, updater, facts, env) {
    const target = join(runtimeDir, updater.file)
    const entry = updater.render(facts, env)
    let io
    try {
      io = await resolveIo()
    } catch (cause) {
      log(`原子写不可用，跳过 ${updater.file}：${cause?.message ?? cause}`)
      return 'no-io'
    }
    try {
      return await io.withFileLock(target, async () => {
        let current
        try {
          current = await readFile(target, 'utf8')
        } catch (cause) {
          log(`读 ${target} 失败，跳过：${cause?.code ?? cause?.message ?? cause}`)
          return 'unreadable'
        }
        // 🔴 幂等判据用 dedupKey（＝不含讲次的那一截）：老记录（无 lesson 注释）也必须判成
        //    "本回合已写过"，否则升级后重跑同一回合会追加第二条。
        if (current.includes(env.dedupKey ?? env.marker)) return 'skipped'
        await io.writeFileAtomic(target, appendEntryToContent(current, entry), { mode })
        return 'written'
      })
    } catch (cause) {
      log(`写 ${target} 失败，跳过：${cause?.message ?? cause}`)
      return 'failed'
    }
  }

  async function onTurnStopping(payload) {
    try {
      const { agent, turn, signal } = payload ?? {}
      if (signal?.aborted) return
      if (!Number.isInteger(turn)) return
      const session = agent?.session
      if (!session || typeof session.snapshotEvents !== 'function') {
        log(`turn ${turn}：取不到 session，跳过课后更新`)
        return
      }
      const runtimeDir = resolveRuntimeDir()
      if (runtimeDir === null) {
        log(`turn ${turn}：runtimeDir 缺省（教室尚未确定），跳过课后更新`)
        return
      }
      // 教室目录必须存在；不存在＝不写＋记录原因（不抛崩会话）
      try {
        const info = await stat(runtimeDir)
        if (!info.isDirectory()) {
          log(`runtimeDir 不是目录，跳过课后更新：${runtimeDir}`)
          return
        }
      } catch (cause) {
        log(`runtimeDir 不存在，跳过课后更新：${runtimeDir}（${cause?.code ?? cause?.message ?? cause}）`)
        return
      }

      const facts = extractTurnFacts(session.snapshotEvents(), { turn })
      if (!facts.hasContent) {
        log(`turn ${turn}：空回合（无学生消息、无工具调用），不写`)
        return
      }
      facts.phase = getPhase() ?? null
      facts.lesson = normalizeLesson(getLesson())
      const env = {
        sessionId: session.id ?? 'unknown',
        marker: turnMarker(session.id ?? 'unknown', turn, facts.lesson),
        dedupKey: turnMarker(session.id ?? 'unknown', turn),
        timeLabel: formatTime(facts.time ?? now()),
      }

      for (const updater of updaters) {
        const result = await updateOne(runtimeDir, updater, facts, env)
        if (result !== 'skipped') log(`turn ${turn} → ${updater.file}：${result}`)
      }
    } catch (cause) {
      // 兜底：课后更新永远不得打断会话
      log(`课后更新异常（已吞掉）：${cause?.message ?? cause}`)
    }
  }

  ctx.on('agent/turn-stopping', onTurnStopping)
  const initialDir = resolveRuntimeDir()
  log(`课后更新已启用：${initialDir ?? '(runtimeDir 待求值)'}（${updaters.map((u) => u.file).join(', ')}）`)
  return { enabled: true }
}
