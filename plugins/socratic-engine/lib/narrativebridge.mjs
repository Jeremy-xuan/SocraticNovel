// lib/narrativebridge.mjs — 教学引擎 ↔ 叙事层（socratic-narrative）的接线（车道 E，2026-10-21）
//
// 这个模块只做四件事，全部**不阻塞课堂回合**、全部**可单测**（不 import 任何 @deepseek-ai/*）：
//   ① 取服务：`narrative` 由叙事插件 `ctx.provide('narrative', …)` 提供（README §3）。
//      🔴 取不到就返回 null——**引擎照常跑**（服务是可选的：没装叙事层就没有日记/群聊注入，
//         但不是"插件 never started"，也不是把课堂弄坏）。
//   ② 动态块取内容（N2.4 / N3.5）：`classroom.yaml` 里 `dynamic: {kind: diary|wechat}` 的块，
//      内容在**注入时**现取——日记读 `readRecentDiaries({limit:1})` 的最后一条，
//      群聊读 `runtime/wechat_group.jsonl` 的最后 N 条（契约 K4.2 的存储形状）。
//   ③ 触发日记（N2.1）：收课相位 / 闲置兜底；`runDiary` 返回句柄后**立刻返回**，
//      结果由 `handle.done` 在后台落地（README §3：`done` 永不 reject，失败进日志与 status()）。
//   ④ 回合级记账：同一回合不重复触发（收课时连续两次 close、turn-stopping 被派发两次）。
//      🔴 这是**调用侧**的幂等（省掉一次重复的模型调用）；日记本身「每节课一条」的幂等
//         由叙事服务的 `sessionId + lesson` 账本保证（README §3），这里不重复实现。
//
// 🔴 与叙事包的边界：本模块**不改**它的接口、不 import 它的内部文件——
//    只按 README §3 的公开签名调用（runDiary / readRecentDiaries / isLessonIdleClosed）。
//    为什么必须是运行时服务查找（而不是 `import`）：叙事包是**可选插件**，没装时引擎要能启动
//    （cordis 4.0.5 的 `inject` 全是硬依赖：列进去而服务缺席 → fiber 永远 PENDING＝插件 never started）。

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 叙事服务的注册名（README §3）。 */
export const NARRATIVE_SERVICE = 'narrative'

/** 动态块取值：最近一条日记（N2.4）。 */
export const DIARY_KIND = 'diary'
/** 动态块取值：最近若干条群聊（N3.5）。 */
export const WECHAT_KIND = 'wechat'

/** 群聊消息的存储真源（契约 K4.2：一行一条 JSON，append-only）。 */
export const WECHAT_JSONL = 'wechat_group.jsonl'

// ── 空内容 / 读不到时的**确定性占位行** ──────────────────────────────────────
// 🔴 为什么不是"什么都不注入"：这两块是 manifest 的普通块，频率门过了就必须出现——
//    否则验收侧 `predictTurnBlocks`（独立推导）会预测它、生产侧却不注入，A2 立刻红；
//    而且"下节课读到日记"这条链路会在没有叙事服务时**静默消失**，没人知道它没生效。
//    占位行说的是**事实**（没有 / 读不到），不是编出来的内容。
export const DIARY_PLACEHOLDER_EMPTY = '（你还没有写过日记。）'
export const DIARY_PLACEHOLDER_MISSING = '（这次读不到你的日记：叙事服务没有装载。）'
export const DIARY_PLACEHOLDER_FAILED = '（这次读不到你的日记。）'
export const WECHAT_PLACEHOLDER_EMPTY = '（群里还没有消息。）'
export const WECHAT_PLACEHOLDER_FAILED = '（这次读不到群里的消息。）'

/**
 * 取叙事服务（可能是 null）。**不抛**：`ctx.get` 对未提供的服务返回 undefined。
 * @param {{get?: (name: string) => unknown}} ctx
 * @returns {object|null}
 */
export function narrativeOf(ctx) {
  if (ctx === null || ctx === undefined || typeof ctx.get !== 'function') return null
  const service = ctx.get(NARRATIVE_SERVICE)
  return service !== null && typeof service === 'object' ? service : null
}

/** 把多行文本压成单行（只折叠空白，不改字）。 */
function oneLine(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** `ts`（ISO 8601）→ 本地 `HH:mm`；解析不了就返回空串（不编时间）。 */
export function clockOf(ts) {
  if (typeof ts !== 'string' || ts === '') return ''
  const ms = Date.parse(ts)
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 读 `runtime/wechat_group.jsonl` 的最后 N 条**可注入**消息。
 *
 * 判据（契约 K4.2）：
 *   · 一行一条 JSON；坏行**跳过并计数**（一行坏数据不该让整份读废）；
 *   · `role ∈ {student, character, system}`；`kind !== 'typing'`（typing 本来不落盘，防御性过滤）；
 *   · `text` 非空。
 * 🔴 文件不存在＝**空**（不是错误）：N3 还没上线、或这个教室不用群聊，都是合法状态。
 *
 * @param {{runtimeDir: string, limit?: number, read?: (file: string) => Promise<string>}} opts
 * @returns {Promise<{messages: object[], bad: number, missing: boolean}>}
 */
export async function readRecentGroupMessages({ runtimeDir, limit = 8, read = (file) => readFile(file, 'utf8') }) {
  if (typeof runtimeDir !== 'string' || runtimeDir === '') throw new Error('readRecentGroupMessages：runtimeDir 必填')
  const wanted = Number.isInteger(limit) && limit > 0 ? limit : 8
  const file = join(runtimeDir, WECHAT_JSONL)
  let text
  try {
    text = await read(file)
  } catch (cause) {
    if (cause?.code === 'ENOENT') return { messages: [], bad: 0, missing: true }
    throw cause
  }
  const messages = []
  let bad = 0
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
    if (parsed === null || typeof parsed !== 'object') {
      bad += 1
      continue
    }
    if (parsed.kind === 'typing') continue
    if (!['student', 'character', 'system'].includes(parsed.role)) {
      bad += 1
      continue
    }
    if (typeof parsed.text !== 'string' || parsed.text.trim() === '') {
      bad += 1
      continue
    }
    messages.push(parsed)
  }
  return { messages: messages.slice(Math.max(0, messages.length - wanted)), bad, missing: false }
}

/**
 * 最近一条日记 → 注入块正文。**纯函数**。
 * @param {{date?: string, lesson?: number|null, text: string}} entry
 * @returns {string}
 */
export function formatDiaryText(entry) {
  const date = typeof entry?.date === 'string' && entry.date !== '' ? entry.date : ''
  const lesson = Number.isInteger(entry?.lesson) && entry.lesson > 0 ? ` · 第 ${entry.lesson} 讲` : ''
  const when = `${date}${lesson}` === '' ? '' : `${date}${lesson}`
  const head = when === '' ? '你最近写的一条日记：' : `你最近写的一条日记（${when}）：`
  return `${head}\n${String(entry?.text ?? '').trim()}`
}

/**
 * 最近若干条群聊 → 注入块正文。**纯函数**。
 * @param {object[]} messages
 * @returns {string}
 */
export function formatGroupText(messages) {
  const list = Array.isArray(messages) ? messages : []
  if (list.length === 0) return WECHAT_PLACEHOLDER_EMPTY
  const lines = [`群里的最近 ${list.length} 条（旧 → 新）：`]
  for (const message of list) {
    const clock = clockOf(message?.ts)
    const speaker = typeof message?.speaker === 'string' && message.speaker !== '' ? message.speaker : String(message?.role ?? '')
    lines.push(`· ${clock === '' ? '' : `${clock} `}${speaker}：${oneLine(message?.text)}`)
  }
  return lines.join('\n')
}

/** 日记块的正文（读服务、格式化成注入文本；失败只记日志＋占位，绝不抛）。 */
async function resolveDiaryText({ narrative, classroomDir, log }) {
  if (narrative === null || typeof narrative.readRecentDiaries !== 'function') {
    log?.('叙事服务未装载（或没有 readRecentDiaries）→ 日记注入块用占位行（不是错误）')
    return DIARY_PLACEHOLDER_MISSING
  }
  try {
    const result = await narrative.readRecentDiaries({ classroomDir, limit: 1 })
    const entries = Array.isArray(result?.entries) ? result.entries : []
    const last = entries.length === 0 ? null : entries[entries.length - 1]
    if (last === null) return DIARY_PLACEHOLDER_EMPTY
    return formatDiaryText(last)
  } catch (cause) {
    // 🔴 读不到 ≠ 课堂要停：吐占位行 + 记日志（错误细节留在日志里，不进模型可见文本）。
    log?.(`🔴 读最近一条日记失败（注入块用占位行）：${cause?.message ?? cause}`)
    return DIARY_PLACEHOLDER_FAILED
  }
}

/** 群聊块的正文（读 jsonl；不存在/为空 → 空占位；其余读失败 → 读不到占位）。 */
async function resolveGroupText({ runtimeDir, limit, log }) {
  try {
    const { messages, bad } = await readRecentGroupMessages({ runtimeDir, limit })
    if (bad > 0) log?.(`群聊注入：跳过 ${bad} 行坏数据（契约 K4.2：一行坏数据不该让整份读废）`)
    return formatGroupText(messages)
  } catch (cause) {
    log?.(`🔴 读群聊记录失败（注入块用占位行）：${cause?.message ?? cause}`)
    return WECHAT_PLACEHOLDER_FAILED
  }
}

/**
 * 取一个动态块的正文。**不给未知 kind 兜底**：`kind` 在装载期已由 manifest 校验过，
 * 走到未知分支就是引擎的 bug（抛出去，别静默注入空块）。
 * @param {object} block — manifest 规范化块（带 `dynamic`）
 * @param {{narrative: object|null, classroomDir: string, runtimeDir: string, log?: Function}} deps
 * @returns {Promise<string>}
 */
export async function resolveDynamicText(block, deps) {
  const dynamic = block?.dynamic
  if (dynamic === null || dynamic === undefined) return block?.text ?? ''
  if (dynamic.kind === DIARY_KIND) return resolveDiaryText(deps)
  if (dynamic.kind === WECHAT_KIND) return resolveGroupText({ runtimeDir: deps.runtimeDir, limit: dynamic.limit, log: deps.log })
  throw new Error(`未知的 dynamic.kind：${JSON.stringify(dynamic.kind)}（manifest 装载期应当已经拒绝它）`)
}

/**
 * 把「本回合到点的动态块」的正文取出来，返回一份**新数组**（不改 manifest）。
 *
 * 🔴 只给 `isBlockDue` 为真的块取内容：没到点的块（比如同一讲已经发过日记块了）
 *    不该每回合读一遍文件。`isBlockDue` 是只读判定，记账仍归 `planTurnInjections`。
 *
 * @param {object[]} blocks
 * @param {{state: object, narrative: object|null, classroomDir: string, runtimeDir: string,
 *          log?: Function, isBlockDue: (block: object, state: object) => boolean}} deps
 * @returns {Promise<object[]>}
 */
export async function resolveDynamicBlocks(blocks, { state, narrative, classroomDir, runtimeDir, log, isBlockDue }) {
  const out = []
  for (const block of blocks) {
    if (block.dynamic === null || block.dynamic === undefined) {
      out.push(block)
      continue
    }
    if (!isBlockDue(block, state)) {
      out.push(block)
      continue
    }
    const text = await resolveDynamicText(block, { narrative, classroomDir, runtimeDir, log })
    out.push({ ...block, text })
  }
  return out
}

/**
 * 触发一次日记（N2.1）。**同步返回、绝不抛、绝不 await 日记跑完**。
 *
 * 返回一个状态字符串，只用于日志与单测：
 *   'started'（已交给叙事服务）/ 'rejected'（服务不接受这次请求）/
 *   'no-service' / 'no-runDiary' / 'no-session' / 'no-classroom' / 'threw'。
 *
 * @param {{narrative: object|null, sessionId?: string, classroomDir?: string,
 *          lesson?: number|null, trigger: string, model?: object|null, log?: Function}} req
 * @returns {string}
 */
export function fireDiary({ narrative, sessionId, classroomDir, lesson, trigger, model, log }) {
  if (narrative === null) {
    log?.(`日记未触发（trigger=${trigger}）：叙事服务未装载`)
    return 'no-service'
  }
  if (typeof narrative.runDiary !== 'function') {
    log?.(`日记未触发（trigger=${trigger}）：叙事服务没有 runDiary（接口不匹配）`)
    return 'no-runDiary'
  }
  if (typeof sessionId !== 'string' || sessionId === '') {
    log?.(`日记未触发（trigger=${trigger}）：取不到 sessionId`)
    return 'no-session'
  }
  if (typeof classroomDir !== 'string' || classroomDir === '') {
    log?.(`日记未触发（trigger=${trigger}）：取不到教室目录`)
    return 'no-classroom'
  }

  const request = {
    sessionId,
    classroomDir,
    lesson: Number.isInteger(lesson) && lesson > 0 ? lesson : null,
    trigger,
  }
  // 顶层 `narrative.models.diary`（manifest 已校验过形状）；有才传，别传空对象。
  if (model !== null && model !== undefined && typeof model.provider === 'string' && typeof model.model === 'string') {
    request.model = { provider: model.provider, model: model.model }
  }

  let handle
  try {
    handle = narrative.runDiary(request)
  } catch (cause) {
    // 浮空调用失败也不能把课堂弄坏（收课时抛错会变成工具报错；闲置时抛错会打断 turn）。
    log?.(`🔴 触发日记失败（trigger=${trigger}）：${cause?.message ?? cause}（课堂不受影响）`)
    return 'threw'
  }
  if (handle?.accepted === false) {
    log?.(`日记未接受（trigger=${trigger}）：${handle?.reason ?? '服务没给原因'}`)
    return 'rejected'
  }

  // 🔴 **这里不 await**：N1.3 要求不阻塞课堂回合；结果由 done 在后台落地。
  //    done 按 README §3 永不 reject，但仍接一个 rejection 处理——借来的实现不一定守约，
  //    而引擎这边**不能留下未处理的 rejection**（那会在某些宿主里变成进程级告警）。
  Promise.resolve(handle?.done).then(
    (result) => {
      const state = result?.state ?? (result?.ok === true ? 'ok' : 'unknown')
      const writes = Array.isArray(result?.writes) ? result.writes.length : 0
      log?.(
        `日记跑完（trigger=${trigger}${request.lesson === null ? '' : `，第 ${request.lesson} 讲`}）：` +
          `${state}${writes === 0 ? '' : `，写 ${writes} 个文件`}` +
          (result?.ok === false ? `｜错误 ${result?.error?.code ?? 'UNKNOWN'}：${result?.error?.message ?? ''}` : ''),
      )
    },
    (cause) => {
      log?.(`🔴 日记的 done 拒绝（不该发生，已吞掉）：${cause?.message ?? cause}`)
    },
  )
  log?.(`日记已排队（trigger=${trigger}${request.lesson === null ? '' : `，第 ${request.lesson} 讲`}，不阻塞课堂）`)
  return 'started'
}

/**
 * 回合级记账（进程内、有界）。用于「同一回合不重复触发」。
 *
 * 🔴 为什么是进程内：触发动作发生在**本进程的课堂回合里**，同一回合被派发两次也发生在
 *    同一进程；跨进程/跨重启的"这节课已经写过日记"由叙事服务的 session+lesson 账本负责。
 *    两张表各管一段，不互相替代（README §3 的幂等语义不动）。
 * @param {{max?: number}} [opts]
 */
export function createTurnLedger({ max = 64 } = {}) {
  const seen = new Set()
  return {
    /** 本回合第一次见到 → true 并记账；已经见过 → false。 */
    claim(key) {
      if (seen.has(key)) return false
      seen.add(key)
      while (seen.size > max) {
        const oldest = seen.values().next()
        if (oldest.done === true) break
        seen.delete(oldest.value)
      }
      return true
    },
    has(key) {
      return seen.has(key)
    },
    get size() {
      return seen.size
    },
  }
}
