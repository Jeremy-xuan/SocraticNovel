// lib/groupservice.mjs — K4 群聊服务（typert Remote：history / send / poll / markRead）
//
// 契约：K4.1（通路）、K4.2（存储真源）、K4.3（四个方法与返回形状）、K4.4（节奏与「课堂进行中不回群」）。
// 开发文档：N3.3（谁能说话）、N3.4（10–30 秒、合并、课堂不回）、N3.5（读课堂记录、群聊不承载知识点）、
//           N3.7（首次开场）、N4（主动消息，见 lib/proactive.mjs）。
//
// ── 节奏是**服务端**的事（不靠前端）────────────────────────────────────────
//   · 学生发言 → 立刻落盘、立刻返回（`send` 不等模型）
//   · 同时把「回复批次」记进状态：`dueAt = now + 10..30s 随机`；期间 `poll` 的 `typing` 为 true
//   · 学生再发一条 → **同一批次**重置 `dueAt`（去抖按 `afterSeq` 归并，K4.4 明写"不靠前端"）
//   · 到点由 `tick()` 跑一次模型；课堂进行中则一直挂着，收课后补回
//   · 模型失败：重试一次；仍失败就发一条 `role:'system'` 的说明（K4.2 允许 system 作为
//     「无法回复的说明」），并把错误留在 `runtime/.narrative/agent-runs.jsonl` 与 `narrative.status()`
//
// ── 课堂进行中的判据（N3.4 写死）────────────────────────────────────────────
//   相位不是 `close` **且** 最近一次回合活动在 30 分钟以内。
//   相位来源：① 引擎每回合调 `setClassroomActivity()`（推荐，带回合活动时间）；
//             ② 没有的话退而读 `runtime/progress.md` 的 `current_phase:` 行（那时拿不到回合活动时间，
//                判据按「不在上课」处理 —— 这条边界写在 README 与实现报告里，引擎接线要补上 ①）。

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { listCharacterNames, readClassroomProgress, resolveClassroomDir } from './classroom.mjs'
import { ERROR_CODES, NarrativeError } from './errors.mjs'
import {
  GROUP_REPLY_SCHEMA,
  batchSchema,
  buildNudgePrompt,
  buildNudgeSystem,
  buildReplyPrompt,
  buildReplySystem,
  collectGroupInputs,
  validateSpeech,
} from './group.mjs'
import { createGroupStore, STUDENT_SPEAKER } from './groupstore.mjs'
import { appendGroupQuestion } from './noteswrite.mjs'
import { createSerialQueue } from './serial.mjs'
import { charCount } from './text.mjs'
import { GROUP_METHODS, GROUP_SERVICE_KEY, markRemoteMethods } from './typert.host.mjs'

/** 单条学生消息的长度上限（K4.3：1–2000 字，按 Unicode 码点）。 */
export const MAX_MESSAGE_CHARS = 2000

/** 学生连发合并后的回复延迟区间（N3.4：10–30 秒随机）。 */
export const REPLY_MIN_DELAY_MS = 10_000
export const REPLY_MAX_DELAY_MS = 30_000

/** 课堂「进行中」的回合活动窗口（N3.4：30 分钟以内）。 */
export const CLASS_ACTIVE_MS = 30 * 60 * 1000

/** 一次回复最多试几次（失败要大声，但不能无限重试）。 */
export const MAX_REPLY_ATTEMPTS = 2

/** 开场最多试几次。 */
export const MAX_OPEN_ATTEMPTS = 2

/** 长轮询的上限（K4.3：waitMs 0–25000，服务端可缩短）。 */
export const MAX_POLL_WAIT_MS = 25_000

/** `history` 的默认与上限（K4.3：默认 50，上限 200）。 */
export const DEFAULT_HISTORY = 50
export const MAX_HISTORY = 200

/** 学生每分钟最多发几条（超出返回 RATE_LIMITED；防脚本把存储刷爆）。 */
export const MAX_STUDENT_MESSAGES_PER_MINUTE = 30

/**
 * 「课堂进行中」的确定性判据。
 * @param {{phase: string|null, lastActivityAt: number|null}} classroom
 * @param {number} nowMs
 * @returns {boolean}
 */
export function isClassInProgress({ phase, lastActivityAt }, nowMs) {
  if (phase === null || phase === undefined || phase === 'close') return false
  if (!Number.isFinite(lastActivityAt) || lastActivityAt === null) return false
  return nowMs - lastActivityAt <= CLASS_ACTIVE_MS
}

/**
 * 群聊服务（宿主侧）。构造后由 `index.mjs` 以 `classroomGroup` 这个名字 provide 出去。
 */
export class ClassroomGroupService {
  /**
   * @param {object} deps
   * @param {(spec: object) => Promise<object>} deps.runTask - 运行器的 `runTask`（已含路由解析）
   * @param {() => number} [deps.now]
   * @param {() => number} [deps.rng]
   * @param {(level: 'info'|'error', ...args: any[]) => void} [deps.log]
   * @param {string|null} [deps.classroomDir] - 显式指定教室目录（缺省＝按会话作用域解析）
   * @param {number} [deps.tickMs] - 调度间隔（0＝不自起定时器，测试自己调 `tick`）
   * @param {(fn: () => void, ms: number) => any} [deps.setIntervalFn]
   * @param {(handle: any) => void} [deps.clearIntervalFn]
   * @param {(ms: number) => Promise<void>} [deps.sleep]
   * @param {number} [deps.replyDelayMinMs] / [deps.replyDelayMaxMs] - 测试可压到 0
   * @param {(input: object) => Promise<object>} [deps.appendProposal] - N5 的提议写入（由 index 注入）
   * @param {(classroomDir: string, entry: object) => Promise<void>} [deps.recordRun] - 运行日志写入（由 index 注入）
   */
  constructor({
    runTask,
    now = () => Date.now(),
    rng = Math.random,
    log = () => {},
    classroomDir = null,
    tickMs = 5_000,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)),
    replyDelayMinMs = REPLY_MIN_DELAY_MS,
    replyDelayMaxMs = REPLY_MAX_DELAY_MS,
    appendProposal = null,
    recordRun = null,
  }) {
    if (typeof runTask !== 'function') throw new TypeError('ClassroomGroupService 需要 runTask（运行器的 runTask）')
    this.runTask = runTask
    this.now = now
    this.rng = rng
    this.log = log
    this.explicitDir = classroomDir
    this.tickMs = tickMs
    this.setIntervalFn = setIntervalFn
    this.clearIntervalFn = clearIntervalFn
    this.sleep = sleep
    this.replyDelayMinMs = replyDelayMinMs
    this.replyDelayMaxMs = replyDelayMaxMs
    this.appendProposal = appendProposal
    this.recordRunSink = recordRun
    /** @type {Map<string, object>} classroomDir → actor */
    this.actors = new Map()
    /** @type {Map<string, string>} sessionId → classroomDir（引擎报上来的） */
    this.sessionDirs = new Map()
    /** @type {Map<string, {phase: string|null, lastActivityAt: number|null, lesson: number|null}>} */
    this.classroomStates = new Map()
    this.timer = null
    this.tail = Promise.resolve()
    // typert 网关读的「可见绑定」（纯数据，不需要协议包的基类）
    this.typertRemote = Object.freeze({ service: this, serviceKey: GROUP_SERVICE_KEY, namespace: GROUP_SERVICE_KEY })
  }

  // ── K4.3 的四个 Remote 方法 ────────────────────────────────────────────────

  /**
   * 最近若干条消息 + 未读。
   * @param {object} workspaceFileScope - `{sessionId, workspaceRoot}`
   * @param {number} [limit]
   * @returns {Promise<{messages: object[], nextSeq: number, unread: number}>}
   */
  async history(workspaceFileScope, limit) {
    const actor = await this.resolveActor(workspaceFileScope)
    const wanted = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), MAX_HISTORY) : DEFAULT_HISTORY
    return actor.serial.run(actor.dir, async () => {
      const { messages, maxSeq } = await actor.store.readAll()
      const state = await actor.store.readState()
      return {
        messages: messages.slice(Math.max(0, messages.length - wanted)),
        nextSeq: maxSeq + 1,
        unread: unreadOf(messages, state.readSeq),
      }
    })
  }

  /**
   * 学生发言。**不抛异常**（契约要求让人能重试）：失败一律 `{ok:false, error}`。
   * @param {object} workspaceFileScope
   * @param {string} text
   * @param {string} [clientId]
   * @returns {Promise<{ok: true, message: object, unread: number} | {ok: false, error: {code: string, message: string}}>}
   */
  async send(workspaceFileScope, text, clientId) {
    let actor
    try {
      actor = await this.resolveActor(workspaceFileScope)
    } catch (error) {
      return { ok: false, error: { code: 'STORE_CORRUPT', message: `找不到教室目录：${error?.message ?? error}` } }
    }
    const raw = typeof text === 'string' ? text : ''
    if (raw.trim() === '') return { ok: false, error: { code: 'EMPTY', message: '消息是空的' } }
    const length = charCount(raw)
    if (length > MAX_MESSAGE_CHARS) {
      return { ok: false, error: { code: 'TOO_LONG', message: `消息有 ${length} 字，上限 ${MAX_MESSAGE_CHARS} 字` } }
    }
    return actor.serial.run(actor.dir, async () => {
      try {
        const nowMs = this.now()
        const { messages, bad } = await actor.store.readAll()
        if (bad > 0) {
          // 真源里有坏行：seq 的分配依据不完整，再追加就可能撞号 → 拒绝写入并如实说明
          return {
            ok: false,
            error: { code: 'STORE_CORRUPT', message: `runtime/wechat_group.jsonl 里有 ${bad} 行无法解析，先修好再发` },
          }
        }
        const recent = messages.filter((message) => message.role === 'student' && nowMs - Date.parse(message.ts) < 60_000).length
        if (recent >= MAX_STUDENT_MESSAGES_PER_MINUTE) {
          return { ok: false, error: { code: 'RATE_LIMITED', message: '发得太快了，等一下再说' } }
        }
        const appended = await actor.store.append({
          role: 'student',
          speaker: STUDENT_SPEAKER,
          text: raw,
          clientId: typeof clientId === 'string' && clientId !== '' ? clientId : null,
          kind: 'message',
        })
        const state = await actor.store.readState()
        const previous = state.pending
        const studentSeqs = [...(previous?.studentSeqs ?? []), appended.message.seq]
        const dueAt = nowMs + this.replyDelayMinMs + Math.floor(this.rng() * Math.max(1, this.replyDelayMaxMs - this.replyDelayMinMs))
        try {
          await actor.store.saveState({
            pending: {
              sinceSeq: previous?.sinceSeq ?? appended.message.seq,
              studentSeqs,
              dueAt,
              attempts: 0,
              createdAt: previous?.createdAt ?? nowMs,
            },
          })
        } catch (error) {
          // 落盘成功但排不进回复队列：如实告诉调用方「失败可重试」，并把错误留在日志里
          this.log('error', `[narrative] 群聊回复排队失败：${error?.message ?? error}`)
          await this.recordRun(actor, { task: 'group', state: 'failed', code: 'AGENT_FAILED', message: `回复排队失败：${error?.message ?? error}` })
          return { ok: false, error: { code: 'AGENT_FAILED', message: '消息已保存，但她这边没排上回复；可以再发一次' } }
        }
        const nextMessages = [...messages, appended.message]
        return { ok: true, message: appended.message, unread: unreadOf(nextMessages, state.readSeq) }
      } catch (error) {
        return { ok: false, error: { code: 'STORE_CORRUPT', message: `存储读写出错：${error?.message ?? error}` } }
      }
    })
  }

  /**
   * 长轮询。`waitMs` 会被收敛到 0..25000（服务端可以缩短）。
   * @param {object} workspaceFileScope
   * @param {number} [afterSeq]
   * @param {number} [waitMs]
   * @returns {Promise<{messages: object[], typing: boolean, nextSeq: number, unread: number, serverTime: number}>}
   */
  async poll(workspaceFileScope, afterSeq, waitMs) {
    const actor = await this.resolveActor(workspaceFileScope)
    const since = Number.isInteger(afterSeq) && afterSeq > 0 ? afterSeq : 0
    const wait = Number.isFinite(waitMs) ? Math.min(Math.max(waitMs, 0), MAX_POLL_WAIT_MS) : 0
    const deadline = this.now() + wait
    for (;;) {
      const snapshot = await actor.serial.run(actor.dir, async () => {
        const { messages, maxSeq } = await actor.store.readAll()
        const state = await actor.store.readState()
        return {
          messages: messages.filter((message) => message.seq > since),
          typing: state.pending !== null,
          nextSeq: maxSeq + 1,
          unread: unreadOf(messages, state.readSeq),
          serverTime: this.now(),
        }
      })
      if (snapshot.messages.length > 0) return snapshot
      const left = deadline - this.now()
      if (left <= 0) return snapshot
      await this.sleep(Math.min(250, left))
    }
  }

  /**
   * 把已读游标推到 `seq`（只前进，不回退）。
   * @param {object} workspaceFileScope
   * @param {number} seq
   * @returns {Promise<{unread: number}>}
   */
  async markRead(workspaceFileScope, seq) {
    const actor = await this.resolveActor(workspaceFileScope)
    const target = Number.isInteger(seq) && seq > 0 ? seq : 0
    return actor.serial.run(actor.dir, async () => {
      const { messages, maxSeq } = await actor.store.readAll()
      const state = await actor.store.readState()
      const next = Math.min(Math.max(state.readSeq, target), maxSeq)
      await actor.store.saveState({ readSeq: next })
      return { unread: unreadOf(messages, next) }
    })
  }

  // ── 引擎面（不对外暴露给浏览器）───────────────────────────────────────────

  /**
   * 引擎每回合调一次：告诉她「现在在不在上课」。**必须调**，否则「课堂进行中不回群」不生效。
   * @param {{sessionId?: string, classroomDir?: string, phase?: string|null, lastActivityAt?: number|null, lesson?: number|null}} input
   */
  setClassroomActivity(input = {}) {
    const { sessionId, classroomDir, phase = null, lastActivityAt = null, lesson = null } = input
    const key = typeof sessionId === 'string' && sessionId !== '' ? sessionId : (classroomDir ?? '__default__')
    if (typeof classroomDir === 'string' && classroomDir !== '') this.sessionDirs.set(key, classroomDir)
    this.classroomStates.set(key, { phase, lastActivityAt, lesson })
  }

  /**
   * 走一次调度（回复批次 + 首次开场 + N4 主动消息）。定时器与单测都调它。
   * @param {number} [nowMs]
   * @returns {Promise<Array<{dir: string, actions: string[]}>>}
   */
  async tick(nowMs = this.now()) {
    const dirs = await this.knownClassroomDirs()
    const results = []
    for (const dir of dirs) {
      const actor = await this.actorFor(dir)
      const actions = await actor.serial.run(actor.dir, async () => {
        const steps = []
        steps.push(...(await this.maybeOpen(actor, nowMs)))
        steps.push(...(await this.maybeReply(actor, nowMs)))
        return steps
      })
      results.push({ dir, actions })
    }
    return results
  }

  /** 起定时器（幂等）。@returns {{stop: () => void}} */
  start() {
    if (this.timer !== null || this.tickMs <= 0) return { stop: () => this.stop() }
    this.timer = this.setIntervalFn(() => {
      void this.tick().catch((error) => this.log('error', `[narrative] 群聊调度异常：${error?.message ?? error}`))
    }, this.tickMs)
    // 定时器不该拖住进程退出
    if (typeof this.timer?.unref === 'function') this.timer.unref()
    return { stop: () => this.stop() }
  }

  /** 停定时器。 */
  stop() {
    if (this.timer !== null) {
      this.clearIntervalFn(this.timer)
      this.timer = null
    }
  }

  /** 只读状态（面板/引擎排障用；不是契约 K4 的一部分）。 */
  async status() {
    const out = []
    for (const dir of await this.knownClassroomDirs()) {
      const actor = await this.actorFor(dir)
      const state = await actor.store.readState()
      const { messages, bad } = await actor.store.readAll()
      out.push({
        dir,
        messages: messages.length,
        badLines: bad,
        readSeq: state.readSeq,
        typing: state.pending !== null,
        pending: state.pending,
        lastReplyError: state.lastReplyError,
        classroom: state.classroom,
        proactive: null,
      })
    }
    return out
  }

  /** 等手上所有排队的活落定（测试用）。 */
  async whenIdle() {
    for (const actor of this.actors.values()) await actor.serial.run(actor.dir, async () => {})
  }

  // ── 内部 ────────────────────────────────────────────────────────────────

  /**
   * 解析作用域 → 教室目录 → actor。
   * @param {object} workspaceFileScope
   */
  async resolveActor(workspaceFileScope) {
    const dir = await this.resolveDir(workspaceFileScope)
    return this.actorFor(dir)
  }

  /**
   * @param {object} workspaceFileScope
   * @returns {Promise<string>}
   */
  async resolveDir(workspaceFileScope) {
    if (this.explicitDir !== null) return this.explicitDir
    const sessionId = workspaceFileScope?.sessionId
    if (typeof sessionId === 'string' && this.sessionDirs.has(sessionId)) return this.sessionDirs.get(sessionId)
    const root = workspaceFileScope?.workspaceRoot
    if (typeof root !== 'string' || root === '') {
      throw new NarrativeError(ERROR_CODES.IO_ERROR, '群聊调用缺少会话作用域（workspaceRoot）', { detail: { reason: 'NO_SCOPE' } })
    }
    const resolved = await resolveClassroomDir(root)
    if (resolved.dir !== null) {
      if (typeof sessionId === 'string' && sessionId !== '') this.sessionDirs.set(sessionId, resolved.dir)
      return resolved.dir
    }
    if (resolved.reason === 'ambiguous') {
      throw new NarrativeError(ERROR_CODES.IO_ERROR, `工作区里有不止一个教室，不静默选一个：${resolved.candidates.join(' / ')}`, {
        detail: { reason: 'AMBIGUOUS_CLASSROOM', candidates: resolved.candidates },
      })
    }
    throw new NarrativeError(ERROR_CODES.IO_ERROR, `工作区里找不到教室（缺 ${join(root, 'classroom.yaml')}）`, {
      detail: { reason: 'NO_CLASSROOM', root },
    })
  }

  /**
   * 取（或建）一个教室的 actor。
   * @param {string} dir
   */
  async actorFor(dir) {
    const cached = this.actors.get(dir)
    if (cached !== undefined) return cached
    const store = createGroupStore({ classroomDir: dir, now: this.now })
    const actor = {
      dir,
      store,
      serial: createSerialQueue(),
      proactive: null,
    }
    this.actors.set(dir, actor)
    return actor
  }

  /**
   * 课堂状态（引擎报的优先；没有就读 progress.md 的相位，回合活动时间当作未知）。
   * @param {string} dir
   * @returns {Promise<{inProgress: boolean, lastActivityAt: number|null, phase: string|null, lesson: number|null}>}
   */
  async classroomStateOf(dir) {
    let reported = null
    let reportedSession = null
    for (const [key, state] of this.classroomStates) {
      if (this.sessionDirs.get(key) === dir) {
        reported = state
        reportedSession = key
      }
    }
    const progress = await readClassroomProgress(dir)
    const phase = reported?.phase ?? progress.phase
    const lastActivityAt = reported?.lastActivityAt ?? null
    return {
      phase,
      lastActivityAt,
      lesson: reported?.lesson ?? progress.lesson,
      sessionId: reportedSession,
      inProgress: isClassInProgress({ phase, lastActivityAt }, this.now()),
    }
  }

  /** 所有已知的教室目录（显式配置 + 引擎报的 + 已建 actor 的）。 */
  async knownClassroomDirs() {
    const dirs = new Set()
    if (this.explicitDir !== null) dirs.add(this.explicitDir)
    for (const dir of this.sessionDirs.values()) dirs.add(dir)
    for (const dir of this.actors.keys()) dirs.add(dir)
    return [...dirs].sort()
  }

  /**
   * 首次开场（N3.7）：真源为空 → 先发开场消息。
   * @param {object} actor
   * @param {number} nowMs
   * @returns {Promise<string[]>}
   */
  async maybeOpen(actor, nowMs) {
    if (!(await actor.store.isFirstLaunch())) return []
    const state = await actor.store.readState()
    const attempts = Number.isInteger(state.openAttempts) ? state.openAttempts : 0
    if (attempts >= MAX_OPEN_ATTEMPTS) return []
    if (await this.classInProgress(actor)) return ['open:deferred']
    try {
      const speech = await this.generateNudge(actor, { kind: 'open' })
      await actor.store.append({ role: 'character', speaker: speech.speaker, text: speech.text, clientId: null, kind: 'open' })
      await actor.store.saveState({ openAttempts: 0, lastReplyError: null })
      await this.recordRun(actor, { task: 'group', state: 'ok', kind: 'open' })
      return ['open:sent']
    } catch (error) {
      await actor.store.saveState({ openAttempts: attempts + 1, lastReplyError: describeFailure(error) })
      await this.recordRun(actor, { task: 'group', state: 'failed', kind: 'open', code: error?.code ?? 'MODEL_ERROR', message: String(error?.message ?? error) })
      this.log('error', `[narrative] 群聊开场失败：${error?.message ?? error}`)
      return ['open:failed']
    }
  }

  /**
   * 到点就跑一次回复（合并批次）。课堂进行中就一直挂着（N3.4）。
   * @param {object} actor
   * @param {number} nowMs
   * @returns {Promise<string[]>}
   */
  async maybeReply(actor, nowMs) {
    const state = await actor.store.readState()
    const pending = state.pending
    if (pending === null || nowMs < pending.dueAt) return []
    if (await this.classInProgress(actor)) return ['reply:deferred']
    const { messages } = await actor.store.readAll()
    const batch = messages.filter((message) => message.seq >= pending.sinceSeq)
    const studentTexts = batch.filter((message) => message.role === 'student').map((message) => message.text)
    if (studentTexts.length === 0) {
      await actor.store.saveState({ pending: null })
      return ['reply:no-batch']
    }
    try {
      const speech = await this.generateReply(actor, { batch, messages })
      await actor.store.append({ role: 'character', speaker: speech.speaker, text: speech.text, clientId: null, kind: 'message' })
      await actor.store.saveState({ pending: null, lastReplyError: null })
      await this.afterReply(actor, { speech, studentTexts })
      await this.recordRun(actor, { task: 'group', state: 'ok', kind: 'reply', messages: batch.length, chars: charCount(speech.text) })
      return ['reply:sent']
    } catch (error) {
      const attempts = pending.attempts + 1
      const described = describeFailure(error)
      await this.recordRun(actor, { task: 'group', state: 'failed', kind: 'reply', code: error?.code ?? 'MODEL_ERROR', message: described.message })
      this.log('error', `[narrative] 群聊回复失败（第 ${attempts} 次）：${described.message}`)
      if (attempts < MAX_REPLY_ATTEMPTS) {
        await actor.store.saveState({ pending: { ...pending, attempts, dueAt: this.now() + 2_000 } })
        return ['reply:retry']
      }
      // 两次都失败：把学生的消息留着（下次发言会重新入队），并在群里说明一句
      await actor.store.saveState({ pending: null, lastReplyError: described })
      await actor.store.append({
        role: 'system',
        speaker: '系统',
        text: '（她那边卡住了，这条没回上。可以再说一句。）',
        clientId: null,
        kind: 'message',
      })
      return ['reply:failed']
    }
  }

  /**
   * 回复之后的两件事（N3.5 的知识题记录、N5.1 的世界观提议）。
   * @param {object} actor
   * @param {{speech: object, studentTexts: string[]}} input
   */
  async afterReply(actor, { speech, studentTexts }) {
    const classroom = await this.classroomStateOf(actor.dir)
    const lesson = classroom.lesson ?? 0
    if (speech.raw.knowledge_question === true) {
      try {
        const kp = await this.verifyKp(actor.dir, speech.raw.kp)
        const quote = studentTexts.join(' / ')
        await appendGroupQuestion({
          classroomDir: actor.dir,
          now: this.now(),
          session: typeof classroom.sessionId === 'string' && classroom.sessionId !== '' ? classroom.sessionId : 'unknown',
          lesson,
          turn: 0,
          kp,
          quote,
          note: typeof speech.raw.question === 'string' && speech.raw.question !== '' ? speech.raw.question : '群里提的问题，课上讲',
        })
      } catch (error) {
        this.log('error', `[narrative] 群里提的问题没记上：${error?.message ?? error}`)
        await this.recordRun(actor, { task: 'group', state: 'failed', kind: 'group-question', code: error?.code ?? 'IO_ERROR', message: String(error?.message ?? error) })
      }
    }
    if (this.appendProposal !== null) {
      const content = speech.raw.proposal_content
      const reason = speech.raw.proposal_reason
      if (typeof content === 'string' && content.trim() !== '' && typeof reason === 'string' && reason.trim() !== '') {
        try {
          await this.appendProposal({
            classroomDir: actor.dir,
            origin: '群聊 agent',
            content,
            reason,
            quote: studentTexts.join(' / '),
            now: this.now(),
          })
        } catch (error) {
          this.log('error', `[narrative] 世界观提议没写上：${error?.message ?? error}`)
        }
      }
    }
  }

  /** 课堂是否进行中。 @param {object} actor */
  async classInProgress(actor) {
    return (await this.classroomStateOf(actor.dir)).inProgress
  }

  /**
   * 生成一条回复（N3.5 的输入 + N3.6 的规则 + 确定性校验）。
   * @param {object} actor
   * @param {{batch: object[], messages: object[]}} input
   */
  async generateReply(actor, { batch, messages }) {
    const classroom = await this.classroomStateOf(actor.dir)
    const collected = await collectGroupInputs({
      classroomDir: actor.dir,
      messages,
      lesson: classroom.lesson,
    })
    const names = await this.allowedSpeakerNames(actor.dir, collected.character)
    const result = await this.runTask({
      task: 'group',
      system: buildReplySystem({ rules: collected.rules, characterName: collected.character.name, allowedNames: names }),
      prompt: buildReplyPrompt({ batch, lesson: classroom.lesson }),
      inputs: collected.inputs,
      root: actor.dir,
      schema: GROUP_REPLY_SCHEMA,
    })
    const speech = validateSpeech({ speaker: result.value.speaker, text: result.value.text }, { names, defaultSpeaker: collected.character.name })
    return { ...speech, raw: result.value }
  }

  /**
   * 生成主动消息（N3.7 开场 / N4 定时）。
   * @param {object} actor
   * @param {{kind?: 'open'|'nudge', count?: number, times?: string[]}} request
   * @returns {Promise<{speaker: string, text: string}>}
   */
  async generateNudge(actor, { kind = 'nudge', count = 1, times = [] } = {}) {
    const classroom = await this.classroomStateOf(actor.dir)
    const { messages } = await actor.store.readAll()
    const collected = await collectGroupInputs({ classroomDir: actor.dir, messages, lesson: classroom.lesson })
    const names = await this.allowedSpeakerNames(actor.dir, collected.character)
    if (kind === 'open') {
      const result = await this.runTask({
        task: 'group',
        system: buildNudgeSystem({ rules: collected.rules, characterName: collected.character.name, allowedNames: names }),
        prompt: buildNudgePrompt({ kind: 'open', count: 1, lesson: classroom.lesson }),
        inputs: collected.inputs,
        root: actor.dir,
        schema: GROUP_REPLY_SCHEMA,
      })
      return validateSpeech({ speaker: result.value.speaker, text: result.value.text }, { names, defaultSpeaker: collected.character.name })
    }
    const result = await this.runTask({
      task: 'group',
      system: buildNudgeSystem({ rules: collected.rules, characterName: collected.character.name, allowedNames: names }),
      prompt: buildNudgePrompt({ kind: 'nudge', count, lesson: classroom.lesson, times }),
      inputs: collected.inputs,
      root: actor.dir,
      schema: batchSchema(Math.max(1, times.length)),
    })
    const texts = result.value.messages
    return texts.map((text) => validateSpeech({ speaker: collected.character.name, text }, { names, defaultSpeaker: collected.character.name }))
  }

  /**
   * 能开口的人：`characters/*.md` 里的名字 + 当课角色名。
   * @param {string} dir
   * @param {object} character
   * @returns {Promise<string[]>}
   */
  async allowedSpeakerNames(dir, character) {
    const listed = await listCharacterNames(dir)
    const names = [...listed.names]
    for (const alias of [character.name, ...(character.aliases ?? [])]) {
      if (typeof alias === 'string' && alias !== '' && !names.includes(alias)) names.push(alias)
    }
    return names
  }

  /**
   * `kp` 必须在 `knowledge_points.md` 里真实存在（K3.2），否则写 null（不写假编号）。
   * @param {string} dir
   * @param {unknown} kp
   * @returns {Promise<string|null>}
   */
  async verifyKp(dir, kp) {
    if (typeof kp !== 'string' || kp.trim() === '') return null
    const text = await readFile(join(dir, 'knowledge_points.md'), 'utf8').catch(() => '')
    const escaped = kp.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\*\\*${escaped}(?![\\d.])`).test(text) ? kp.trim() : null
  }

  /**
   * 写一条运行日志（与日记共用 `runtime/.narrative/agent-runs.jsonl` 的形状）。
   * @param {object} actor
   * @param {object} entry
   */
  async recordRun(actor, entry) {
    if (typeof this.recordRunSink !== 'function') return
    try {
      await this.recordRunSink(actor.dir, entry)
    } catch (error) {
      this.log('error', `[narrative] 群聊运行日志写失败：${error?.message ?? error}`)
    }
  }
}

/** 未读数（seq 大于已读游标的条数）。 @param {object[]} messages @param {number} readSeq */
export function unreadOf(messages, readSeq) {
  let count = 0
  for (const message of messages) if (message.seq > readSeq) count += 1
  return count
}

/** 失败归一成一行（进日志与状态）。 @param {unknown} error */
function describeFailure(error) {
  return {
    at: Date.now(),
    code: error?.code ?? 'MODEL_ERROR',
    message: String(error?.message ?? error),
  }
}

// 把四个方法标成 Remote（等价于 @Remote 装饰器；网关按这份原型描述符发现端点）
markRemoteMethods(ClassroomGroupService.prototype, [...GROUP_METHODS])
