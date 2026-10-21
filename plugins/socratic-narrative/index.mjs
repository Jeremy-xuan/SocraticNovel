// index.mjs — socratic-narrative（车道 N · 叙事层地基）
//
// 两个交付物：
//   N1 独立上下文 agent 运行器 —— lib/runner.mjs（读文件 → 调模型 → 结构化结果 → 写文件）
//   N2 日记                     —— lib/diary.mjs（在 N1 之上）
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
export function createNarrativeService({
  llm = () => undefined,
  instanceModel = () => undefined,
  config = {},
  log = () => {},
  now = () => Date.now(),
  io = {},
} = {}) {
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
          system: buildDiarySystem({ rules: collected.rules }),
          prompt: buildDiaryPrompt({ date, lesson }),
          inputs: collected.inputs,
          root: classroomDir,
          schema: DIARY_SCHEMA,
          ...(request.model === undefined ? {} : { model: request.model }),
          ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
          apply: async (value) => {
            const appended = await store.append({ sessionId, lesson, date, text: value.text })
            return { writes: appended.writes, skipped: appended.skipped }
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
        return { ok: true, state: skipped ? 'skipped' : 'ok', writes: result.writes, value: result.value }
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
  log('info', `[narrative] 叙事层已装载（timeoutMs=${config.timeoutMs ?? '默认'}）`)
}

export { ERROR_CODES, NarrativeError } from './lib/errors.mjs'
