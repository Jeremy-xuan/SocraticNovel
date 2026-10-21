// lib/emotionchannel.mjs — 情绪标记的**引擎侧唯一边界**：`llm/stream` 包装 + 情绪通道（契约 K1.2 / K1.4）
//
// 分工（写死，避免"谁说了算"含糊）：
//   · `lib/emotionmark.mjs` = **纯函数**（语法、流式解析、整串剥离）；
//   · 本文件 = **唯一接线点**：包一层 `llm/stream` waterfall，逐 chunk 剥标记，
//     并把剥出的情绪事件**追加**写 `<教室>/runtime/emotions.jsonl`。
//
// ── 为什么只能在 `llm/stream` 里剥（K1.0 / K1.2 取证）────────────────────────
//   0.2.1 的原生对话框用 micromark + mdast 自建渲染器，HTML 注释被当作字符串原样转义显示；
//   全站唯一零输出的节点是 definition / footnoteDefinition（只能出现在段落开头，做不了逐句标记）；
//   **没有**"助手文本持久化前 transform"的钩子。能改助手输出的位置只有 `llm/stream` waterfall
//   （`dsh-llm/lib/index.js` 的 `streamWithRegistration` → `ctx.waterfall(this, "llm/stream", options, …)`）
//   与端上渲染遮蔽（遮蔽后无法复用宿主渲染器）。所以：**标记只在流里存在，落盘与显示的全是剥净文本。**
//
// ── 0.2.1 的 chunk 形状（本机实测，不是猜）──────────────────────────────────
//   隔离 profile 里挂只 observer 的 `llm/stream` 监听器，打出来的实际形状：
//     · 监听器签名：`(options, next)`，`next()` 返回**同步**的 async iterable（会 `for await`）
//     · `options` 键：provider / model / maxTokens / reasoningEffort / messages / toolHistory /
//       tools / sessionId / signal（会话标题那次调用另有 `system` 与 `purpose`）
//     · 文本增量 chunk：`{ type: 'text-delta', index: 0, text: '…' }`（与 shipped 的 .d.ts 一致）
//     · 其它：`block-start{index,blockType}` / `block-end{index,block}` / `usage` / `finish{reason}`
//   证据见 docs/历史报告/实现报告_A_课后写回_2026-10-20.md 的「K1 chunk 形状实测」节。
//
// 🔴 纪律（K1.2）：
//   1. 只改 `text-delta` 的 `text`；**其它 chunk 原样透传**（一个字段都不许改）。
//   2. 任何异常：**放弃剥离、原样透传**并记日志。宁可原生界面脏一行，也不能让课堂断流。
//   3. 情绪通道只**追加**、不重写（除了超过 64 KB 的折叠，见下）。

import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createEmotionStreamParser, stripEmotionMarkers } from './emotionmark.mjs'

/** 情绪通道文件名（相对教室 `runtime/`）。 */
export const EMOTIONS_FILE = 'emotions.jsonl'

/** 通道体积上限：超过就把老记录折叠成一行（K1.4）。 */
export const MAX_CHANNEL_BYTES = 64 * 1024

/** 教室 runtime 文件权限位（与 postclass / notestore 一致）。 */
export const DEFAULT_FILE_MODE = 0o600

/** 宿主原子写包（动态 import：单测环境无宿主也能加载本模块）。 */
async function loadHostAtomicWrite() {
  const mod = await import('@deepseek-ai/dsh-atomic-write')
  if (typeof mod?.writeFileAtomic !== 'function' || typeof mod?.withFileLock !== 'function') {
    throw new Error('@deepseek-ai/dsh-atomic-write 未导出 writeFileAtomic/withFileLock')
  }
  return { writeFileAtomic: mod.writeFileAtomic, withFileLock: mod.withFileLock }
}

/** 本地时间 + 时区偏移的 ISO 8601（与 notestore 的口径一致）。 */
function pad2(n) {
  return String(Math.abs(n)).padStart(2, '0')
}

/**
 * 带时区偏移的 ISO 8601。**纯函数**。
 * @param {number} [ms]
 * @returns {string}
 */
export function isoWithOffset(ms = Date.now()) {
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
 * 从通道全文推出下一个 `seq`。**纯函数**。
 *
 * 通道只增不改，唯一的结构变化是体积超限时的折叠行 `{"v":1,"collapsed":true,"upTo":N}`。
 * 口径：取「所有行里出现过的最大 seq」+ 1；坏行跳过（读方按版本分派）。
 * @param {string|null|undefined} content
 * @returns {number}
 */
export function nextSeqFrom(content) {
  let max = 0
  for (const raw of String(content ?? '').split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (parsed === null || typeof parsed !== 'object') continue
    if (parsed.collapsed === true && Number.isInteger(parsed.upTo) && parsed.upTo > max) max = parsed.upTo
    if (Number.isInteger(parsed.seq) && parsed.seq > max) max = parsed.seq
  }
  return max + 1
}

/**
 * 渲染一条情绪事件（K1.4 字段）。**纯函数**。
 * @param {{seq:number, ts:string, session:string, turn:number, label:string, intensity:number}} event
 * @returns {string} 一行 JSON（含结尾换行）
 */
export function renderEmotionLine(event) {
  const ordered = {
    v: 1,
    seq: event.seq,
    ts: event.ts,
    session: event.session,
    turn: event.turn,
    label: event.label,
    intensity: event.intensity,
  }
  return `${JSON.stringify(ordered)}\n`
}

/**
 * 折叠策略（纯函数）：超过 64 KB 时，把「老记录」换成一行 collapsed。
 *
 * 保留 `max(MIN_KEEP_LINES)` 行最近记录（保持"读末尾即可"），折叠行的 `upTo` ＝ 被丢掉的记录的
 * 最大 seq。为什么保留最近几行：舞台按 `after=<seq>` 轮询，保留末尾才能立刻回放最近的语气。
 * @param {string} content - 通道全文
 * @param {{maxBytes?:number, keepLines?:number}} [opts]
 * @returns {{content:string, collapsed:boolean, upTo:number}}
 */
export function collapseIfNeeded(content, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_CHANNEL_BYTES
  const keepLines = opts.keepLines ?? 8
  const text = String(content ?? '')
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { content: text, collapsed: false, upTo: 0 }

  const lines = text.split('\n').filter((line) => line.trim() !== '')
  const keep = lines.slice(-keepLines)
  const dropped = lines.slice(0, lines.length - keep.length)
  let upTo = 0
  for (const line of dropped) {
    try {
      const parsed = JSON.parse(line)
      if (Number.isInteger(parsed?.seq) && parsed.seq > upTo) upTo = parsed.seq
      if (Number.isInteger(parsed?.upTo) && parsed.upTo > upTo) upTo = parsed.upTo
    } catch {
      /* 坏行不参与记账 */
    }
  }
  const collapsedLine = `${JSON.stringify({ v: 1, collapsed: true, upTo })}\n`
  return { content: `${collapsedLine}${keep.join('\n')}\n`, collapsed: true, upTo }
}

/**
 * 情绪通道（追加写；`<教室>/runtime/emotions.jsonl`）。
 *
 * @param {object} opts
 * @param {() => string|null} opts.runtimeDir - 教室 runtime/ 绝对路径取值函数（可能尚未确定）
 * @param {() => number} [opts.now]
 * @param {{writeFileAtomic:Function, withFileLock:Function}} [opts.io] - 注入 IO（测试用）
 * @param {number} [opts.mode]
 * @param {(...args:any[])=>void} [opts.log]
 */
export function createEmotionChannel(opts = {}) {
  const runtimeDirOf = opts.runtimeDir ?? (() => null)
  const now = opts.now ?? Date.now
  const mode = opts.mode ?? DEFAULT_FILE_MODE
  const log = opts.log ?? (() => {})
  let ioPromise = null
  const resolveIo = () => (ioPromise ??= opts.io ? Promise.resolve(opts.io) : loadHostAtomicWrite())
  /** 进程内计数器（首次写入时从文件末行续号，K1.4）。 */
  let seqCounter = null

  /**
   * 追加一批事件。**失败只记日志、不抛**（课堂不能因为记不上情绪而断流）。
   * @param {{label:string, intensity:number}[]} events
   * @param {{session?:string, turn?:number}} meta
   * @returns {Promise<{written:number, reason?:string}>}
   */
  async function append(events, meta = {}) {
    const list = Array.isArray(events) ? events.filter((e) => e && typeof e.label === 'string') : []
    if (list.length === 0) return { written: 0 }
    const runtimeDir = runtimeDirOf()
    if (typeof runtimeDir !== 'string' || runtimeDir === '') return { written: 0, reason: '教室目录尚未确定' }
    const file = join(runtimeDir, EMOTIONS_FILE)
    let io
    try {
      io = await resolveIo()
    } catch (cause) {
      log(`情绪通道不可用（原子写包解析失败）：${cause?.message ?? cause}`)
      return { written: 0, reason: 'no-io' }
    }
    try {
      await mkdir(runtimeDir, { recursive: true })
      return await io.withFileLock(file, async () => {
        let current = ''
        let size = 0
        try {
          const [text, info] = await Promise.all([readFile(file, 'utf8'), stat(file)])
          current = text
          size = info.size
        } catch (cause) {
          if (cause?.code !== 'ENOENT') throw cause
        }
        if (seqCounter === null) seqCounter = nextSeqFrom(current)
        const ts = isoWithOffset(now())
        const rendered = list.map((event) => {
          const record = {
            seq: seqCounter,
            ts,
            session: typeof meta.session === 'string' ? meta.session : 'unknown',
            turn: Number.isInteger(meta.turn) ? meta.turn : 0,
            label: event.label,
            intensity: event.intensity,
          }
          seqCounter += 1
          return renderEmotionLine(record)
        })
        // 老文件末尾缺换行时补一个，绝不把两条记录粘成一行
        const suffix = `${current !== '' && !current.endsWith('\n') ? '\n' : ''}${rendered.join('')}`
        const nextContent = `${current}${suffix}`
        const collapsed = collapseIfNeeded(nextContent)
        if (collapsed.collapsed || size === 0) {
          // 折叠（或首次创建）走整文件重写：这也是"保持读末尾即可"的代价
          await io.writeFileAtomic(file, collapsed.content, { mode })
          if (collapsed.collapsed) log(`情绪通道超过 ${MAX_CHANNEL_BYTES} B，老记录已折叠到 upTo=${collapsed.upTo}`)
        } else {
          await appendFile(file, suffix, { mode })
        }
        return { written: rendered.length }
      })
    } catch (cause) {
      log(`情绪通道写入失败（已吞掉，不影响课堂）：${cause?.message ?? cause}`)
      return { written: 0, reason: cause?.message ?? String(cause) }
    }
  }

  return { append, file: () => join(runtimeDirOf() ?? '', EMOTIONS_FILE) }
}

/**
 * 把一个 chunk 流包上"剥标记 + 播情绪"，返回新的 async iterable。**纯逻辑 + 一个回调**。
 *
 * 抽成独立函数（而不是写在监听器里）是为了让"哪些 chunk 被改、哪些原样透传"可单测：
 * 只碰 `text-delta`，其余对象的**引用与字段一个都不动**（测试按 `===` 断言）。
 *
 * @param {AsyncIterable<object>} source
 * @param {object} [hooks]
 * @param {(events:{label:string,intensity:number}[]) => void} [hooks.onEvents] - 剥出事件时的回调
 * @param {(...args:any[])=>void} [hooks.log]
 * @param {boolean} [hooks.enabled] - false → 完全透传（不改任何 chunk）
 * @returns {AsyncIterable<object>}
 */
export async function* wrapChunkStream(source, hooks = {}) {
  const onEvents = hooks.onEvents ?? (() => {})
  const log = hooks.log ?? (() => {})
  if (hooks.enabled === false) {
    yield* source
    return
  }
  const parser = createEmotionStreamParser()
  /** 最后一个 text-delta 的 index（flush 时把残余文本补在这个块上）。 */
  let lastTextIndex = 0
  /** 一旦解析抛错就永久退化为透传（K1.2-4）。 */
  let degraded = false

  const drainEvents = (events) => {
    if (events.length === 0) return
    try {
      onEvents(events)
    } catch (cause) {
      log(`情绪事件回调失败（已吞掉）：${cause?.message ?? cause}`)
    }
  }

  /** 把解析器里扣住的残余文本作为一条 text-delta 补发（在块边界之前）。 */
  const flushInto = function* () {
    let rest
    try {
      rest = parser.flush()
    } catch (cause) {
      degraded = true
      log(`情绪标记解析器 flush 失败（退化为透传）：${cause?.message ?? cause}`)
      return
    }
    if (rest.text !== '') yield { type: 'text-delta', index: lastTextIndex, text: rest.text }
  }

  for await (const chunk of source) {
    if (degraded || chunk === null || typeof chunk !== 'object') {
      yield chunk
      continue
    }
    const type = chunk.type
    if (type === 'text-delta' && typeof chunk.text === 'string') {
      lastTextIndex = Number.isInteger(chunk.index) ? chunk.index : lastTextIndex
      let parsed
      try {
        parsed = parser.push(chunk.text)
      } catch (cause) {
        degraded = true
        log(`情绪标记解析失败（本流退化为透传）：${cause?.message ?? cause}`)
        yield chunk
        continue
      }
      drainEvents(parsed.events)
      if (parsed.text === '') continue
      yield parsed.text === chunk.text ? chunk : { ...chunk, text: parsed.text }
      continue
    }
    // 🔴 `block-end` 的 `block.text` 也要剥（**契约 K1.2 的必要补充**，实测发现）：
    //    宿主 `dsh-llm` 的 `BlockAssembler` 在 `block-end` 处用 `partial.block = chunk.block`
    //    **覆盖**它自己按 `text-delta` 累出来的文本（`dsh-llm/lib/index.js:992`），而适配器发来的
    //    `block.text` 是**未剥的原文**（`dsh-llm-deepseek/lib/index.js` 的 `block-end` 用
    //    `{...block.content}`）。只剥 delta 的后果是实打实的：**落盘与原生界面仍然是带标记的原文**
    //    （本机实测：`emotions.jsonl` 里拿到了事件，而 headless 打印出来的正文里标记还在）。
    //    所以这里对**文本块**的 `block.text` 做同一份剥净（reasoning 块不动）。
    if (type === 'block-start' || type === 'block-end' || type === 'finish') {
      yield* flushInto()
      if (type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') {
        const clean = stripEmotionMarkers(chunk.block.text)
        yield clean === chunk.block.text ? chunk : { ...chunk, block: { ...chunk.block, text: clean } }
        continue
      }
      yield chunk
      if (type === 'finish') return
      continue
    }
    yield chunk
  }
  // 流自然结束（没有 finish chunk，例如被上游关掉）：残余文本仍然要给出去
  if (!degraded) yield* flushInto()
}

/**
 * 注册 `llm/stream` 包装（契约 K1.2）。**只包一层**，幂等靠宿主的事件注册（同插件只调一次）。
 *
 * 🔴 监听器必须是**同步**函数并同步返回 async iterable：`llm.stream()` 直接把 waterfall 的返回值
 *    交给调用方 `for await`（`dsh-agent-loop` 的 `for await (const chunk of stream)`）。
 *    返回 Promise 会让调用方拿到一个 Promise 而崩——这是 0.2.1 的实测形状。
 *
 * @param {object} ctx - Cordis 上下文（需要 `on`）
 * @param {object} opts
 * @param {() => string|null} [opts.runtimeDir] - 教室 runtime/（取值函数，教室可能尚未确定）
 * @param {() => number} [opts.getTurn] - 取当前回合号（引擎的 phase.turnCount）
 * @param {boolean} [opts.enabled]
 * @param {(events:object[], meta:object)=>Promise<object>} [opts.onEvents] - 覆盖默认落盘（测试用）
 * @param {(...args:any[])=>void} [opts.log]
 * @returns {{enabled: boolean}}
 */
export function registerEmotionChannel(ctx, opts = {}) {
  const log = opts.log ?? (() => {})
  if (opts.enabled === false) return { enabled: false }
  if (typeof ctx?.on !== 'function') {
    log('情绪通道未启用：ctx.on 不可用')
    return { enabled: false }
  }
  const getTurn = opts.getTurn ?? (() => 0)
  const channel = opts.onEvents
    ? { append: opts.onEvents }
    : createEmotionChannel({ runtimeDir: opts.runtimeDir, log })

  ctx.on('llm/stream', (options, next) => {
    let inner
    try {
      inner = next()
    } catch (cause) {
      // 连下游都没起来：不吞错，交给宿主
      log(`llm/stream 下游启动失败（不剥标记）：${cause?.message ?? cause}`)
      throw cause
    }
    // 只对"教师说话的那条流"播情绪：会话标题等旁路调用带 `purpose`（实测见文件头）
    const isTeacherTurn = typeof options?.purpose !== 'string' || options.purpose === ''
    const sessionId = typeof options?.sessionId === 'string' ? options.sessionId : 'unknown'
    const onEvents = (events) => {
      if (!isTeacherTurn) return
      void channel
        .append(events, { session: sessionId, turn: getTurn() })
        .catch((cause) => log(`情绪事件落盘失败（已吞掉）：${cause?.message ?? cause}`))
    }
    return wrapChunkStream(inner, { onEvents, log })
  })
  log('情绪通道已启用：llm/stream 逐 chunk 剥离〔emo:label:intensity〕，事件追加写 runtime/emotions.jsonl')
  return { enabled: true }
}
