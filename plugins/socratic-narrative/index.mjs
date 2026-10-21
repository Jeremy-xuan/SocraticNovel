// index.mjs — socratic-narrative（车道 N · 叙事层地基）
//
// 五个交付物：
//   N1 独立上下文 agent 运行器 —— lib/runner.mjs（读文件 → 调模型 → 结构化结果 → 写文件）
//   N2 日记                     —— lib/diary.mjs（在 N1 之上）
//   N3 群聊                     —— lib/groupservice.mjs + lib/group.mjs + lib/groupstore.mjs
//                                  （契约 K4 的四个 Remote 方法；真源 runtime/wechat_group.jsonl）
//   N4 定时主动消息             —— lib/proactive.mjs（北京时间 8:00–23:00、预生成、确定性检查、退避）
//   N5 世界观提议               —— lib/proposals.mjs + lib/review.mjs + lib/worldguard.mjs
//
// 宿主面只有一件事：把服务以名字 `narrative` 提供给引擎（`ctx.get('narrative')` /
// `ctx.narrative`，取决于引擎怎么接）。**本轮不改引擎**——接线说明见 README §7。
//
// 🔴 三条纪律：
//   ① 零运行时依赖：不 import 任何 `@deepseek-ai/*`（验收铁律③，见 lib/atomic.mjs 文件头）
//   ② 不硬编码模型与密钥：路由走 `ctx.llm` 已配置的通道；模型名的来源见 README §2
//   ③ 失败要大声：runDiary 永不 reject（面板/引擎不接就得崩溃），但**一定**写日志 +
//      在 `status()` 里留下 `lastError`（N1.4 / A6 红线）

import { ERROR_CODES, NarrativeError, describeError } from './lib/errors.mjs'
import { DIARY_SCHEMA, buildDiaryPrompt, buildDiarySystem, collectDiaryInputs, createDiaryStore, readRecentDiaries } from './lib/diary.mjs'
import { ClassroomGroupService } from './lib/groupservice.mjs'
import { appendProposal, readWorldLog } from './lib/proposals.mjs'
import { createReviewer } from './lib/review.mjs'
import { createAgentRunner } from './lib/runner.mjs'
import { createRunLog } from './lib/runlog.mjs'
import { createRunRegistry } from './lib/state.mjs'
import { isLessonIdleClosed } from './lib/trigger.mjs'
import { formatLocalDate } from './lib/text.mjs'

export const name = 'socratic-narrative'

export const inject = ['llm']

/**
 * 建服务（**不注册**）。测试直接用它，不需要 cordis；`apply` 只是把它 `ctx.provide` 出去。
 *
 * @param {object} [options]
 * @param {() => {stream: Function} | undefined} [options.llm] - 惰性取 `ctx.llm`
 * @param {() => {provider: string, model: string, reasoningEffort?: string} | undefined} [options.instanceModel] - 惰性取实例默认模型（`ctx.agentDefaultModel.currentSelection()`）
 * @param {object} [options.config] - 插件配置（`provider` / `model` / `models` / `timeoutMs`）
 * @param {(level: 'info'|'error', ...args: any[]) => void} [options.log]
 * @param {() => number} [options.now]
 * @param {object} [options.io] - 测试注入：`{read, write, exists, append}`（见 lib/atomic.mjs、lib/runlog.mjs）
 */
/**
 * 已经**实现**的模型路由任务集合（`config.models.<task>` 与 `classroom.yaml` 的
 * `narrative.models.<task>` 共用这套名字）。
 *
 * 🔴 这是**开放集合**：新增一个任务（例如 N4 上线时的 `group`）只要在这里加一个键，
 * 并在 `resolveRoute` 的调用点用同一个名字。**未知键一律报错，绝不忽略**——写错的键
 * 被静默忽略时，实际生效的是实例默认模型，人只会在事后发现"怎么调了模型没变"。
 */
export const NARRATIVE_TASKS = Object.freeze(['diary', 'group', 'review'])

/**
 * 校验 `config.models`：键必须在 {@link NARRATIVE_TASKS} 里，值必须是 `{provider, model}`。
 * @param {object} models
 * @throws {NarrativeError} INVALID_CONFIG
 */
function validateModelsConfig(models) {
  if (models === undefined) return
  if (models === null || typeof models !== 'object' || Array.isArray(models)) {
    throw new NarrativeError(ERROR_CODES.INVALID_CONFIG, 'config.models 必须是对象（形如 { diary: { provider, model } }）', {
      detail: { reason: 'MODELS_NOT_OBJECT' },
    })
  }
  for (const [task, route] of Object.entries(models)) {
    if (!NARRATIVE_TASKS.includes(task)) {
      throw new NarrativeError(
        ERROR_CODES.INVALID_CONFIG,
        `config.models 里有未实现的任务名 "${task}"；目前只有 ${NARRATIVE_TASKS.join(' / ')}。` +
          '写错的键会被当成"没配过"，实际生效的是实例默认模型——所以这里直接报错，不忽略。',
        { detail: { reason: 'UNKNOWN_TASK', task, known: NARRATIVE_TASKS } },
      )
    }
    if (route === null || typeof route !== 'object' || typeof route.provider !== 'string' || typeof route.model !== 'string') {
      throw new NarrativeError(ERROR_CODES.INVALID_CONFIG, `config.models.${task} 必须是 { provider, model }（两个都是字符串）`, {
        detail: { reason: 'BAD_ROUTE', task },
      })
    }
  }
}

export function createNarrativeService({
  llm = () => undefined,
  instanceModel = () => undefined,
  config = {},
  log = () => {},
  now = () => Date.now(),
  io = {},
} = {}) {
  validateModelsConfig(config?.models)
  const registry = createRunRegistry({ now })
  /** @type {Map<string, ReturnType<typeof createRunLog>>} */
  const runLogs = new Map()
  /** @type {Promise<unknown>} */
  let tail = Promise.resolve()

  /** 每个教室一条日志（教室目录在运行中途可能换，按目录分桶是唯一安全的做法）。 */
  function runLogFor(classroomDir) {
    let runLog = runLogs.get(classroomDir)
    if (runLog === undefined) {
      runLog = createRunLog({ classroomDir, now, ...(io.append === undefined ? {} : { append: io.append }), ...(io.read === undefined ? {} : { read: io.read }) })
      runLogs.set(classroomDir, runLog)
    }
    return runLog
  }

  /**
   * 解析模型路由。取值顺序（README §2 写死）：
   *   ① 本次调用显式给的
   *   ② 插件配置里按任务名的 `models[task]`
   *   ③ 插件配置的 `provider` / `model`
   *   ④ 实例已配置的默认模型（`agentDefaultModel.currentSelection()`）
   * 四者都空 → 抛 ROUTE_MISSING（不猜、不写死模型名）
   */
  function resolveRoute(task, explicit) {
    const candidates = [
      ['调用参数', explicit],
      [`配置 models.${task}`, config?.models?.[task]],
      ['配置 provider/model', config?.provider !== undefined && config?.model !== undefined ? { provider: config.provider, model: config.model } : undefined],
      ['实例默认模型', instanceModel()],
    ]
    for (const [, candidate] of candidates) {
      if (candidate?.provider !== undefined && candidate?.model !== undefined) {
        return {
          provider: candidate.provider,
          model: candidate.model,
          ...(candidate.reasoningEffort === undefined ? {} : { reasoningEffort: candidate.reasoningEffort }),
        }
      }
    }
    throw new NarrativeError(
      ERROR_CODES.ROUTE_MISSING,
      `任务 ${task} 没有可用的模型路由：调用参数、配置 models.${task}、配置 provider/model、实例默认模型都取不到。` +
        '在 classroom.yaml 的 narrative.models.' + task + ' 或本插件 config 里指定 provider 与 model。',
      { detail: { reason: 'ROUTE_MISSING', task } },
    )
  }

  const runner = createAgentRunner({
    llm,
    resolveRoute,
    log: (...args) => log('info', ...args),
    now,
    ...(config?.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
  })

  /** 运行日志的公共写入口（日记与群聊/审阅共用一份文件）。 */
  async function recordRun(classroomDir, entry) {
    await runLogFor(classroomDir).record(entry)
  }

  /**
   * N5.2 的审阅器：每节课结束、跑日记的那一轮顺带把积压的提议处理完。
   * 待审 = `world/proposals.md` 里没有在 `world/changelog.md` 出现过的那些。
   */
  const reviewer = createReviewer({ runTask: (spec) => runner.runTask(spec), now, log, recordRun })

  /**
   * K4 群聊服务（typert Remote 的宿主半边 + 服务端节奏 + N4 定时）。
   * `apply()` 会把它以 `classroomGroup` 这个名字 provide 出去。
   */
  const group = new ClassroomGroupService({
    runTask: (spec) => runner.runTask(spec),
    now,
    rng: typeof config?.rng === 'function' ? config.rng : Math.random,
    log,
    classroomDir: typeof config?.classroomDir === 'string' ? config.classroomDir : null,
    ...(config?.groupTickMs === undefined ? {} : { tickMs: config.groupTickMs }),
    appendProposal: (input) => appendProposal({ ...input, now: input.now ?? now() }),
    recordRun,
  })

  /**
   * N1 的通用入口：跑一次独立上下文任务。**抛错**（调用方要自己接，这是「大声」的一半）。
   * @param {object} spec - 见 lib/runner.mjs `runTask`
   */
  async function runTask(spec) {
    return runner.runTask(spec)
  }

  /**
   * N2 主入口：异步写一条日记。**永不 reject**（浮空调用安全），结果在 `done` 里。
   *
   * 幂等语义（N2.1）：键 = `sessionId + lesson`。同一节课再触发一次 → `state='skipped'`，
   * 不写第二次、也不算失败。
   *
   * @param {object} request
   * @param {string} request.sessionId - 宿主 sessionId（幂等键的一半）
   * @param {string} request.classroomDir - 教室目录绝对路径
   * @param {number|null} request.lesson - 讲次（幂等键的另一半；无讲次门时给 0 或 null）
   * @param {string} [request.trigger] - `close`（收课相位）｜`idle`（闲置兜底）｜其它字符串
   * @param {string} [request.date] - 覆盖条目日期（默认取本地今天）
   * @param {{provider?: string, model?: string, reasoningEffort?: string}} [request.model]
   * @param {number} [request.timeoutMs]
   * @returns {{accepted: boolean, runId: string|null, reason?: string, state: string, done: Promise<object>}}
   */
  function runDiary(request = {}) {
    const { sessionId, classroomDir, lesson = null, trigger = 'close' } = request
    if (typeof sessionId !== 'string' || sessionId === '') {
      const error = new NarrativeError(ERROR_CODES.INVALID_OUTPUT, 'runDiary 需要 sessionId（幂等键的一半）', {
        detail: { reason: 'NO_SESSION' },
      })
      log('error', `[narrative] 日记被拒：${error.message}`)
      return { accepted: false, runId: null, reason: 'NO_SESSION', state: 'failed', done: Promise.resolve({ ok: false, error: describeError(error) }) }
    }
    if (typeof classroomDir !== 'string' || classroomDir === '') {
      const error = new NarrativeError(ERROR_CODES.INVALID_OUTPUT, 'runDiary 需要 classroomDir', { detail: { reason: 'NO_CLASSROOM' } })
      log('error', `[narrative] 日记被拒：${error.message}`)
      return { accepted: false, runId: null, reason: 'NO_CLASSROOM', state: 'failed', done: Promise.resolve({ ok: false, error: describeError(error) }) }
    }

    const run = registry.begin({ task: 'diary', sessionId, lesson, trigger })
    const date = typeof request.date === 'string' && request.date !== '' ? request.date : formatLocalDate(now())
    const runLog = runLogFor(classroomDir)

    const done = (async () => {
      try {
        const collected = await collectDiaryInputs({ classroomDir, lesson, ...(io.read === undefined ? {} : { read: io.read }) })
        const store = createDiaryStore({
          classroomDir,
          now,
          ...(io.read === undefined ? {} : { read: io.read }),
          ...(io.write === undefined ? {} : { write: io.write }),
          ...(io.exists === undefined ? {} : { exists: io.exists }),
        })

        const result = await runner.runTask({
          task: 'diary',
          system: buildDiarySystem({ rules: collected.rules, characterName: collected.facts.characterName }),
          prompt: buildDiaryPrompt({ date, lesson }),
          inputs: collected.inputs,
          root: classroomDir,
          schema: DIARY_SCHEMA,
          ...(request.model === undefined ? {} : { model: request.model }),
          ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
          apply: async (value) => {
            const appended = await store.append({ sessionId, lesson, date, text: value.text })
            const writes = [...appended.writes]
            // N5.1：日记 agent 也可以提议扩充世界观（两个字段要一起给，否则当没提）
            const content = typeof value.proposal_content === 'string' ? value.proposal_content.trim() : ''
            const reason = typeof value.proposal_reason === 'string' ? value.proposal_reason.trim() : ''
            if (content !== '' && reason !== '') {
              const proposal = await appendProposal({
                classroomDir,
                now: now(),
                origin: '日记 agent',
                content,
                reason,
                quote: value.text,
              })
              writes.push({ path: proposal.path, bytes: proposal.bytes })
            }
            return { writes, skipped: appended.skipped }
          },
        })

        const skipped = result.writes.length === 0
        run.done(result)
        await safeRecord(runLog, {
          runId: run.runId,
          task: 'diary',
          state: skipped ? 'skipped' : 'ok',
          sessionId,
          lesson,
          trigger,
          provider: result.provider,
          model: result.model,
          elapsedMs: result.elapsedMs,
          writes: result.writes.map((write) => write.path),
          chars: typeof result.value?.text === 'string' ? [...result.value.text].length : null,
        })
        log('info', `[narrative] 日记${skipped ? '已存在，跳过' : '已写入'}（第 ${lesson ?? '?'} 讲，${result.elapsedMs}ms）`)
        const review = await runReviewRound({ classroomDir, sessionId, lesson, request })
        return { ok: true, state: skipped ? 'skipped' : 'ok', writes: result.writes, value: result.value, review }
      } catch (cause) {
        const error = cause instanceof NarrativeError ? cause : new NarrativeError(ERROR_CODES.MODEL_ERROR, String(cause?.message ?? cause), { cause })
        run.failed(error)
        // 🔴 两条出口都必须走：日志（跨重启）+ status()（面板可见）
        log('error', `[narrative] 日记失败（${error.code}）：${error.message}`)
        await safeRecord(runLog, {
          runId: run.runId,
          task: 'diary',
          state: 'failed',
          sessionId,
          lesson,
          trigger,
          code: error.code,
          message: error.message,
          ...(error.detail === undefined ? {} : { detail: error.detail }),
        })
        return { ok: false, state: 'failed', error: describeError(error) }
      }
    })()

    // 供 `whenIdle()` 与测试等待；`done` 自己永不 reject，所以这里也不需要 catch
    tail = tail.then(() => done)
    return { accepted: true, runId: run.runId, state: 'running', done }
  }

  /**
   * N5.2 的「顺带审阅」：日记那一轮跑完（写成功、跳过都算）后处理积压提议。
   *
   * 🔴 失败**不吞**：① 记 `runtime/.narrative/agent-runs.jsonl`；② 在 `status()` 里留一条
   * `task: 'review'` 的失败记录；③ 结果里如实写 `{ok:false, error}`。
   *
   * @param {{classroomDir: string, sessionId: string, lesson: number|null, request: object}} input
   * @returns {Promise<{ok: boolean, reviewed?: number, accepted?: object[], rejected?: object[], refused?: object[], error?: object}>}
   */
  async function runReviewRound({ classroomDir, sessionId, lesson, request }) {
    if (config?.review === false) return { ok: true, reviewed: 0 }
    // 没有积压就不开这一轮：不记状态、不写日志（「什么都没发生」不该在日志里留一行噪音）
    const world = await readWorldLog(classroomDir)
    if (world.pending.length === 0) return { ok: true, reviewed: 0, accepted: [], rejected: [], refused: [] }
    const run = registry.begin({ task: 'review', sessionId, lesson, trigger: 'diary-round' })
    const runLog = runLogFor(classroomDir)
    try {
      const summary = await reviewer.run({
        classroomDir,
        ...(request.model === undefined ? {} : { model: request.model }),
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
      })
      run.done({ bytes: summary.accepted.length })
      await safeRecord(runLog, { runId: run.runId, task: 'review', state: 'ok', sessionId, lesson, ...summary, accepted: summary.accepted.length })
      if (summary.reviewed > 0) {
        log('info', `[narrative] 世界观提议审阅：处理 ${summary.reviewed} 条（接受 ${summary.accepted.length} / 拒绝 ${summary.rejected.length} / 守卫挡下 ${summary.refused.length}）`)
      }
      return { ok: true, ...summary }
    } catch (cause) {
      const error = cause instanceof NarrativeError ? cause : new NarrativeError(ERROR_CODES.MODEL_ERROR, String(cause?.message ?? cause), { cause })
      run.failed(error)
      log('error', `[narrative] 世界观提议审阅失败（${error.code}）：${error.message}`)
      await safeRecord(runLog, { runId: run.runId, task: 'review', state: 'failed', sessionId, lesson, code: error.code, message: error.message })
      return { ok: false, error: describeError(error) }
    }
  }

  /**
   * 写一条运行日志；日志本身失败只报给 logger（**不**递归进 status，避免状态机自吞）。
   * @param {ReturnType<typeof createRunLog>} runLog
   * @param {object} entry
   */
  async function safeRecord(runLog, entry) {
    try {
      await runLog.record(entry)
    } catch (cause) {
      log('error', `[narrative] 运行日志写失败：${cause?.message ?? cause}`)
    }
  }

  return {
    /** N1 通用入口（抛出 `NarrativeError`）。 */
    runTask,
    /** N2 入口（浮空调用安全，永不 reject）。 */
    runDiary,
    /** K4 群聊服务（引擎可直接调；宿主侧也以 `classroomGroup` 这个名字 provide）。 */
    group,
    /** N5.2 审阅：手动跑一轮（引擎/测试用；正常触发在 runDiary 里顺带）。 */
    reviewProposals: (request) => runReviewRound({ classroomDir: request.classroomDir, sessionId: request.sessionId ?? 'manual', lesson: request.lesson ?? null, request }),
    /** N5.1 追加一条世界观提议（课堂老师用）。 */
    appendProposal: (request) => appendProposal({ ...request, now: request.now ?? now() }),
    /** N5 只读：提议与变更记录（面板/引擎排障用）。 */
    readWorldLog: (classroomDir) => readWorldLog(classroomDir),
    /** N2.4 读取出口：最近 N 条日记。 */
    readRecentDiaries: (request) => readRecentDiaries({ ...request, ...(io.read === undefined ? {} : { read: io.read }) }),
    /** N2.1 兜底判据（纯函数，引擎拿去判断）。 */
    isLessonIdleClosed,
    /** N1.4 只读状态出口（面板/引擎读它，别读内部变量）。 */
    status: () => registry.status(),
    /** 等本服务上所有在跑的运行落定（测试与优雅退出用）。 */
    whenIdle: () => tail.then(() => undefined),
    /** 运行日志的落盘路径（面板要读跨重启历史时用）。 */
    runLogPath: (classroomDir) => runLogFor(classroomDir).file,
  }
}

/**
 * 插件入口：把服务提供为 `narrative`。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [config]
 */
export function apply(ctx, config = {}) {
  const logger = typeof ctx.logger === 'function' ? ctx.logger('[socratic-narrative]') : null
  const log = (level, ...args) => {
    try {
      if (logger == null) return
      if (level === 'error' && typeof logger.error === 'function') logger.error(...args)
      else logger.info?.(...args)
    } catch {
      /* logger 不可用不致命：状态出口（status()）仍然有记录 */
    }
  }

  const service = createNarrativeService({
    llm: () => ctx.get('llm'),
    instanceModel: () => {
      const defaults = ctx.get('agentDefaultModel')
      if (typeof defaults?.currentSelection !== 'function') return undefined
      return defaults.currentSelection()
    },
    config,
    log,
  })

  ctx.provide('narrative', service)
  // K4.1：群聊服务的宿主半边。名字就是契约里的 `classroomGroup`（浏览器侧 ctx.remote.classroomGroup）
  ctx.provide('classroomGroup', service.group)
  const ticker = service.group.start()
  if (typeof ctx.effect === 'function') ctx.effect(() => () => ticker.stop(), 'socratic-narrative group ticker')
  log(
    'info',
    `[narrative] 叙事层已装载（timeoutMs=${config.timeoutMs ?? '默认'}，群聊调度=${config.groupTickMs === undefined ? 5000 : config.groupTickMs}ms）`,
  )
}

export { ERROR_CODES, NarrativeError } from './lib/errors.mjs'
