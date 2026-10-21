// lib/runner.mjs — N1 的核心：**独立上下文跑一次模型任务**
//
// 契约（N1.1）：每次运行都是全新上下文——
//   输入 = 本次需要的文件内容（`spec.inputs`，逐字读盘、逐字进提示词）＋ 任务说明（`spec.system` + `spec.prompt`）
//   输出 = 结构化结果（`spec.schema` 声明字段；`spec.apply` 决定写哪些文件、写什么）
//   记忆靠文件，不靠长会话：本模块**不持有任何历史**，两次调用之间零状态。
//
// 为什么是 `ctx.llm.stream()` 而不是 subagent（N1.5 结论，三条依据见实现报告）：
//   ① 没有会话：手搓 messages 直连 provider，**根本不存在**「出现在学生会话列表」的可能
//      （subagent 靠 `origin:'subagent'` 被 `sessionVisible` 过滤，是本包不必依赖的补丁）；
//   ② 上下文真的是空的：subagent 会继承父 agent 的 preset 与工具（`childSessionMeta` 复制
//      `agentPreset`），教室工具与教学系统提示会渗进日记上下文；这里连 tools 都不传；
//   ③ 可测：`llm` 是个可注入的替身，成功/报错/超时/格式不合法四种情况都能离线断言，
//      不需要真宿主、不需要活 agent（subagent 要求 `ctx.agents.get(parent.id) === parent` 的**活父代理**）。
//
// N1.4「失败要大声」：本模块只抛 `NarrativeError`（带 code），不返回 `null`、不吞错。

import { readFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { NarrativeError, ERROR_CODES, asNarrativeError } from './errors.mjs'
import { decodeStructured, describeSchema } from './protocol.mjs'
import { fileBlock } from './text.mjs'

/** 单次运行默认超时（N2 的 AC 要求收课后 2 分钟内出日记，留足余量）。 */
export const DEFAULT_TIMEOUT_MS = 60_000

/** `finish.reason.kind` 里属于「失败」的两种（其余：stop / tool-calls / max-tokens）。 */
const FAILURE_KINDS = new Set(['error', 'aborted'])

/**
 * 建一个运行器。运行器本身无状态（记忆靠文件），只有配置与注入的通道。
 *
 * @param {object} options
 * @param {() => {stream: (options: object) => AsyncIterable<object>}} options.llm - 惰性取 `ctx.llm`（测试注入替身）
 * @param {(task: string, explicit?: {provider?: string, model?: string, reasoningEffort?: string}) => {provider: string, model: string, reasoningEffort?: string}} options.resolveRoute - 解析模型路由；取不到必须抛 ROUTE_MISSING
 * @param {(level: 'info'|'error', ...args: any[]) => void} [options.log]
 * @param {() => number} [options.now]
 * @param {number} [options.timeoutMs]
 */
export function createAgentRunner({ llm, resolveRoute, log = () => {}, now = () => Date.now(), timeoutMs = DEFAULT_TIMEOUT_MS }) {
  /**
   * 跑一次任务。
   *
   * @param {object} spec
   * @param {string} spec.task - 任务名（`diary` / `group` / …；用于路由与日志）
   * @param {string} spec.system - 任务说明（**系统位**）。🔴 不得写入任何「有读者」的意思（见 README §5）
   * @param {string} spec.prompt - 本次的具体要求（正文位）
   * @param {Array<{label: string, path?: string, content?: string}>} [spec.inputs] - 本次需要的文件；给了 `path` 就逐字读盘
   * @param {string} [spec.root] - 相对路径的基准目录（教室目录）
   * @param {{fields: Record<string, object>}} spec.schema - 结构化输出声明
   * @param {{provider?: string, model?: string, reasoningEffort?: string}} [spec.model] - 本次的路由覆盖
   * @param {number} [spec.timeoutMs]
   * @param {AbortSignal} [spec.signal]
   * @param {(value: any, ctx: {root: string, task: string}) => Promise<{writes: Array<{path: string, bytes: number}>}>} [spec.apply] - 把结构化结果落到文件
   * @returns {Promise<{task: string, value: any, text: string, usage: object|null, writes: Array<{path: string, bytes: number}>, elapsedMs: number, provider: string, model: string}>}
   */
  async function runTask(spec) {
    const startedAt = now()
    const task = spec?.task
    if (typeof task !== 'string' || task === '') {
      throw new NarrativeError(ERROR_CODES.INVALID_OUTPUT, 'runTask 需要 spec.task', { detail: { reason: 'NO_TASK' } })
    }
    const route = resolveRoute(task, spec.model)
    const blocks = await readInputs(spec.inputs ?? [], { root: spec.root ?? null })
    const schema = spec.schema
    if (schema?.fields === undefined) {
      throw new NarrativeError(ERROR_CODES.INVALID_OUTPUT, 'runTask 需要声明 spec.schema.fields', {
        detail: { reason: 'NO_SCHEMA', task },
      })
    }

    const prompt = [spec.prompt ?? '', blocks.join('\n\n'), describeSchema(schema)].filter((part) => part !== '').join('\n\n---\n\n')
    const system = spec.system ?? ''

    const { text, usage } = await streamText({
      llm,
      route,
      system,
      prompt,
      task,
      timeoutMs: clampTimeout(spec.timeoutMs ?? timeoutMs),
      signal: spec.signal,
    })

    const value = decodeStructured(text, schema)

    let writes = []
    if (typeof spec.apply === 'function') {
      const applied = await spec.apply(value, { root: spec.root ?? null, task })
      if (applied?.writes === undefined) {
        throw new NarrativeError(ERROR_CODES.IO_ERROR, `任务 ${task} 的 apply 没有返回 writes（写没写清楚）`, {
          detail: { reason: 'NO_WRITES' },
        })
      }
      writes = applied.writes
    }

    return {
      task,
      value,
      text,
      usage,
      writes,
      elapsedMs: now() - startedAt,
      provider: route.provider,
      model: route.model,
    }
  }

  return { runTask }
}

/**
 * 逐字读入本次运行要用的文件。
 * @param {Array<{label: string, path?: string, content?: string}>} inputs
 * @param {{root: string|null}} context
 * @returns {Promise<string[]>}
 */
async function readInputs(inputs, { root }) {
  const blocks = []
  for (const input of inputs) {
    const label = input.label ?? '<未命名输入>'
    if (typeof input.content === 'string') {
      blocks.push(fileBlock(label, input.content))
      continue
    }
    if (typeof input.path !== 'string') {
      throw new NarrativeError(ERROR_CODES.IO_ERROR, `输入 ${label} 既没有 path 也没有 content`, {
        detail: { reason: 'INPUT_EMPTY', label },
      })
    }
    const file = isAbsolute(input.path) ? input.path : root === null ? resolve(input.path) : join(root, input.path)
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (cause) {
      throw new NarrativeError(ERROR_CODES.IO_ERROR, `读不到输入文件 ${label}（${file}）：${cause?.message ?? cause}`, {
        cause,
        detail: { reason: 'READ_FAILED', label, file },
      })
    }
    blocks.push(fileBlock(label, text))
  }
  return blocks
}

/**
 * 调一次模型并把文本拼起来。
 *
 * 超时**不依赖**适配器自己停：本函数自己起一个计时器，到点 abort 并废弃这次流
 * （`iterator.return()`），然后抛 TIMEOUT。这样即便适配器忽略了 signal 也不会挂住服务。
 *
 * @param {object} options
 * @returns {Promise<{text: string, usage: object|null}>}
 */
async function streamText({ llm, route, system, prompt, task, timeoutMs, signal }) {
  if (signal?.aborted === true) {
    throw new NarrativeError(ERROR_CODES.ABORTED, '运行在开始前被取消', { detail: { task } })
  }

  const service = llm()
  if (service === undefined || service === null || typeof service.stream !== 'function') {
    throw new NarrativeError(ERROR_CODES.MODEL_ERROR, '宿主没有提供 llm 服务（ctx.llm.stream 不可用）', {
      detail: { reason: 'NO_LLM_SERVICE', task },
    })
  }

  const controller = new AbortController()
  const onOuterAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onOuterAbort, { once: true })

  /** @type {object[]} */
  const deltas = []
  /** @type {object | null} */
  let usage = null
  /** @type {object | null} */
  let finish = null

  let iterator
  try {
    iterator = service
      .stream({
        provider: route.provider,
        model: route.model,
        ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        signal: controller.signal,
      })[Symbol.asyncIterator]()
  } catch (cause) {
    signal?.removeEventListener('abort', onOuterAbort)
    const normalized = asNarrativeError(cause)
    throw new NarrativeError(ERROR_CODES.MODEL_ERROR, `模型调用没起来：${normalized.message}`, {
      cause,
      detail: { reason: 'STREAM_START_FAILED' },
    })
  }

  const consume = (async () => {
    for (;;) {
      const step = await iterator.next()
      if (step.done === true) return
      const chunk = step.value
      if (chunk?.type === 'text-delta') deltas.push(chunk.text)
      else if (chunk?.type === 'usage') usage = chunk.usage ?? null
      else if (chunk?.type === 'finish') finish = chunk.reason ?? null
    }
  })()
  // 超时胜出时 consume 会继续跑到自己结束；挂一个空 catch，避免变成 unhandled rejection
  consume.catch(() => {})

  let timer
  const timeout = new Promise((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout({ kind: 'timeout' }), timeoutMs)
  })

  let outcome
  try {
    outcome = await Promise.race([
      consume.then(
        () => ({ kind: 'ok' }),
        (error) => ({ kind: 'error', error }),
      ),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }

  if (outcome.kind === 'timeout') {
    controller.abort(new Error(`narrative task ${task} timeout`))
    // 不等它，只请求收尾；真正的失败已经确定了
    Promise.resolve(iterator.return?.()).catch(() => {})
    throw new NarrativeError(ERROR_CODES.TIMEOUT, `模型调用超过 ${timeoutMs}ms 未完成（任务 ${task}）`, {
      detail: { reason: 'TIMEOUT', task, timeoutMs },
    })
  }
  if (outcome.kind === 'error') {
    const cause = outcome.error
    if (signal?.aborted === true) {
      throw new NarrativeError(ERROR_CODES.ABORTED, '运行被调用方取消', { cause, detail: { task } })
    }
    const normalized = asNarrativeError(cause)
    throw new NarrativeError(ERROR_CODES.MODEL_ERROR, `模型调用失败：${normalized.message}`, {
      cause,
      detail: { reason: 'STREAM_FAILED', task },
    })
  }

  if (finish !== null && FAILURE_KINDS.has(finish.kind) === true) {
    const failure = finish.failure ?? {}
    const code = signal?.aborted === true ? ERROR_CODES.ABORTED : ERROR_CODES.MODEL_ERROR
    throw new NarrativeError(code, `模型以 ${finish.kind} 结束：${failure.message ?? '（无消息）'}`, {
      detail: { reason: 'FINISH_FAILURE', task, finishKind: finish.kind, failureCode: failure.code ?? null },
    })
  }
  if (finish !== null && finish.kind === 'max-tokens') {
    // 截断的 JSON 一定解析不了；这里先给出准确的原因，别让下游误判成「模型乱写」
    throw new NarrativeError(ERROR_CODES.MODEL_ERROR, '模型输出被 max-tokens 截断', {
      detail: { reason: 'MAX_TOKENS', task },
    })
  }

  return { text: deltas.join(''), usage }
}

/**
 * 超时预算收敛：非正数或非有限值一律回到默认（配置写错了不该变成「立刻超时」或「永不超时」）。
 * @param {number} value
 * @returns {number}
 */
function clampTimeout(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_TIMEOUT_MS
}

/**
 * 断言一个相对路径落在 root 之内（防 `../` 越界写到教室外面）。
 * @param {string} root
 * @param {string} relative
 * @returns {string} 绝对路径
 * @throws {NarrativeError} IO_ERROR
 */
export function resolveInside(root, relative) {
  if (typeof root !== 'string' || root === '') {
    throw new NarrativeError(ERROR_CODES.IO_ERROR, '写文件需要 root（教室目录）', { detail: { reason: 'NO_ROOT' } })
  }
  const base = resolve(root)
  const target = resolve(base, normalize(relative))
  if (target !== base && !target.startsWith(base + sep)) {
    throw new NarrativeError(ERROR_CODES.IO_ERROR, `拒绝写到教室目录之外：${relative}`, {
      detail: { reason: 'PATH_ESCAPE', relative, target },
    })
  }
  return target
}
