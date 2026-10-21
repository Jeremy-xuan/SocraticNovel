// clients/classroom-ui/lib/narrative-host.mjs
//
// 宿主半边「叙事只读」Remote 服务（N2.5「日记」tab 的数据口）。
//
// 落点：右栏面板「日记」tab。它要两样东西（见 `docs/历史报告/实现报告_NE_引擎接线_2026-10-21.md`
//   §7「给面板接线时需要在哪加什么」）：
//   ① `status()`   —— 最近一次跑完的运行有没有失败（`lastError` / `recent`）。这是 N1.4「错误
//      必须在面板可见」的消费方：**日记没写成功这件事，面板要自己说出来**，不能只在日志里。
//   ② `diaries()`  —— 最近 N 条日记正文，形状 `{ date, lesson, text }`（叙事包已把标题行切走）。
//
// 机制与 `whiteboard-host.mjs` 同构：继承 `TypertRemoteService`，把方法标成 Remote
//   （字符串键描述符，等价于 `@Remote` 装饰器），随 `package.json` 的 `"./typert"` 导出被
//   `dsh-typert-loader` 自动注册进 `ctx.typert`；浏览器半边经 `ctx.remote.classroomNarrative` 调用。
//
// 🔴 三条硬约束（任务书红线）：
//   ① **叙事包缺席时不许抛**：没装 `plugins/socratic-narrative` 时两个方法都回
//      `{ ok: false, reason: 'narrative-absent' }`，面板据此显示一句中性说明（不白屏、不报错）。
//      服务本身**照样 provide**——否则 `ctx.remote.classroomNarrative` 这个命名空间都不存在，
//      浏览器侧连"问她有没有"都做不到。
//   ② **不读叙事包的内部账本**：数据只经叙事服务的公开出口（`status()` / `readRecentDiaries()`）。
//      `runtime/.narrative/` 里的账本与运行日志是**运行过程**，不是展示内容（NE 报告 §7.4）。
//   ③ **教室目录由叙事服务自己解析**（`narrative.group.resolveDir(scope)`）：面板只有
//      `workspaceFileScope`，而"工作区根 → 教室目录"的判定（根目录自己就是教室 / 只有一个
//      `classrooms/<name>` / 多个时不许静默选一个）是叙事包的知识。抄一份到面板＝两份判定会漂移，
//      所以这里**委托**，不复制。

import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

// ── 手动标记 Remote 方法（等价于 @Remote 装饰器，避免装饰器语法依赖） ──────────
// 与 `whiteboard-host.mjs` 的 `markRemote` 同一形状：在类原型上写入字符串键
// `"@deepseek-ai/dsh-typert-protocol/remote-methods"` 的描述符（version:1 + methods 数组）。
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'

function sameInvocation(left, right) {
  if (left.kind === 'direct') return right.kind === 'direct'
  if (right.kind === 'direct') return false
  return left.context === right.context
}

function markRemote(prototype, method, invocation = { kind: 'direct' }) {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, REMOTE_METHOD_DESCRIPTOR)?.value
  const marker = Object.freeze({ method, invocation: Object.freeze(invocation) })
  const current = descriptor?.methods?.find((candidate) => candidate.method === method)
  if (current !== undefined) {
    if (sameInvocation(current.invocation, marker.invocation) && current.mode === marker.mode) return
    throw new Error(`narrative-host: Remote 方法 "${method}" 的调用标记冲突`)
  }
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze([...(descriptor?.methods ?? []), marker]),
    }),
  })
}

/** 服务名 / wire 命名空间（与 `lib/typert.narrative.host.js` 的清单必须逐字一致）。 */
const SERVICE_KEY = 'classroomNarrative'

/** `limit` 的收敛区间（与叙事包 `readRecentDiaries` 的口径一致：至少 1、多了没意义）。 */
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

/** 错误信息的稳定提取（`NarrativeError` 有 message，普通 Error 也有；都不是时给 String）。 */
function messageOf(error) {
  if (error === null || error === undefined) return '未知错误'
  if (typeof error === 'string') return error
  return typeof error.message === 'string' && error.message.length > 0 ? error.message : String(error)
}

/** 把外部传进来的 `limit` 收敛成一个确定的正整数（NaN / 负数 / 字符串都收得住，不抛）。 */
function clampLimit(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT
  const whole = Math.trunc(value)
  if (whole < 1) return 1
  return whole > MAX_LIMIT ? MAX_LIMIT : whole
}

/**
 * 取叙事服务（**不抛**）。没装叙事包时 cordis 的 `ctx.get` 直接给 `undefined`。
 * @param {object} service - 本服务实例（读它的 `ctx`）
 * @returns {object|null}
 */
function narrativeOf(service) {
  let found = null
  try {
    found = service.ctx.get('narrative')
  } catch {
    // `ctx.get` 在缺服务时返回 undefined；抛错只可能来自上下文已销毁 —— 同样当缺席。
    found = null
  }
  return found === null || found === undefined ? null : found
}

/** 叙事包缺席时两个方法都回这一份（每次新对象：调用方改不动别人手里的那份）。 */
function absent() {
  return { ok: false, reason: 'narrative-absent' }
}

/**
 * 教室目录：**委托叙事服务自己解析**（见文件头 ③）。
 *
 * @param {object} narrative - 叙事服务
 * @param {object} scope - `workspaceFileScope`
 * @returns {Promise<{ok: true, classroomDir: string} | {ok: false, reason: string, message: string}>}
 */
async function classroomDirOf(narrative, scope) {
  const group = narrative.group
  if (group === null || group === undefined || typeof group.resolveDir !== 'function') {
    // 叙事服务版本不含群聊/教室解析：这是"能力缺席"，不是故障 —— 用同一族 reason 报出来。
    return { ok: false, reason: 'no-classroom', message: '叙事服务没有暴露教室目录解析（group.resolveDir）' }
  }
  try {
    const dir = await group.resolveDir(scope)
    if (typeof dir !== 'string' || dir.length === 0) {
      return { ok: false, reason: 'no-classroom', message: '叙事服务没解析出教室目录' }
    }
    return { ok: true, classroomDir: dir }
  } catch (error) {
    // 没有教室 / 有多个教室不许静默选一个 —— 叙事包会抛，这里转成可展示的原因。
    return { ok: false, reason: 'no-classroom', message: messageOf(error) }
  }
}

/**
 * 叙事只读 Remote 服务：把「日记」tab 需要的两件事接到叙事服务上。
 *
 * 🔴 **不用 class private 方法（`#foo`）**：网关派发 Remote 方法时的接收者不是本类的
 *    裸实例（cordis 的 Service 会被代理一层），一碰 `#` 私有字段就抛
 *    `TypeError: Receiver must be an instance of class ClassroomNarrative`
 *    （活体实测：日记页整页变成"读日记失败：gateway/internal — Receiver must be…"）。
 *    所以类里只留**公开方法**做转发，其余逻辑都是模块级函数（拿 `service.ctx` 读上下文）。
 */
export class ClassroomNarrative extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, SERVICE_KEY)
    markRemote(ClassroomNarrative.prototype, 'status')
    markRemote(ClassroomNarrative.prototype, 'diaries')
  }

  /**
   * status —— 转发 `narrative.status()`（`ok / active / lastError / lastSuccess / recent`）。
   *
   * 🔴 返回值是叙事服务的**冻结深拷贝**，可以直接进 UI（NE 报告 §7.3）。
   * 🔴 永不抛：叙事服务内部状态异常也只回 `{ok:false, reason:'status-failed'}`，
   *    面板据此显示"状态读不到"，而不是把整个槽位崩成占位（`SlotErrorBoundary` 会永久锁死）。
   *
   * @param {object} scope - `workspaceFileScope` lookup 结果（`{sessionId, workspaceRoot}`）
   * @returns {Promise<{ok: true, status: object} | {ok: false, reason: string, message?: string}>}
   */
  async status(scope) {
    const narrative = narrativeOf(this)
    if (narrative === null || typeof narrative.status !== 'function') return absent()
    try {
      return { ok: true, status: narrative.status() }
    } catch (error) {
      return { ok: false, reason: 'status-failed', message: messageOf(error) }
    }
  }

  /**
   * diaries —— 最近 N 条日记（时间顺序，由叙事服务保证；面板负责倒序展示）。
   *
   * @param {object} scope - `workspaceFileScope` lookup 结果
   * @param {number} [limit] - 条数（收敛到 1..50，缺省 20）
   * @returns {Promise<{ok: true, entries: Array<object>, bad: number} | {ok: false, reason: string, message?: string}>}
   */
  async diaries(scope, limit) {
    const narrative = narrativeOf(this)
    if (narrative === null || typeof narrative.readRecentDiaries !== 'function') return absent()

    const dir = await classroomDirOf(narrative, scope)
    if (dir.ok !== true) return dir

    try {
      const result = await narrative.readRecentDiaries({ classroomDir: dir.classroomDir, limit: clampLimit(limit) })
      const entries = Array.isArray(result?.entries) ? result.entries : []
      return { ok: true, entries, bad: typeof result?.bad === 'number' ? result.bad : 0 }
    } catch (error) {
      // 读盘失败（文件权限、条目全坏……）：如实回原因，面板显示错误状态但**不崩**。
      return { ok: false, reason: 'read-failed', message: messageOf(error) }
    }
  }
}

export { SERVICE_KEY, DEFAULT_LIMIT, MAX_LIMIT, clampLimit }
