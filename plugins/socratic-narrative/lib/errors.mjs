// lib/errors.mjs — 叙事层的错误分类（N1.4「失败要大声」的唯一错误类型）
//
// 🔴 为什么要一个分类：验收流水线 A6 的红线是「静默失败」。所以本包**只有一种**错误出口
//    （NarrativeError），每个错误都带一个稳定的 `code`——面板、日志、测试断言都读这个 code，
//    不读中文消息文本（消息会改，code 不会）。

/** 错误码。**新增码就写在这里**，不要在别处拼字符串。 */
export const ERROR_CODES = Object.freeze({
  /** 模型通道调不通 / 适配器返回 error 或 aborted finish。 */
  MODEL_ERROR: 'MODEL_ERROR',
  /** 超过本次运行的超时预算（不依赖适配器自己停，运行器主动废弃）。 */
  TIMEOUT: 'TIMEOUT',
  /** 模型输出不是合法 JSON、缺必填字段、或违反字段约束（如日记超 120 字）。 */
  INVALID_OUTPUT: 'INVALID_OUTPUT',
  /** 取不到模型路由（调用参数、插件配置、agentDefaultModel 三处都没有）。 */
  ROUTE_MISSING: 'ROUTE_MISSING',
  /** 读写教室文件失败（路径越界、文件不可读、写盘失败）。 */
  IO_ERROR: 'IO_ERROR',
  /** 调用方主动取消。 */
  ABORTED: 'ABORTED',
})

/** 错误码全集（便于测试枚举）。 */
export const ERROR_CODE_VALUES = Object.freeze(Object.values(ERROR_CODES))

/**
 * 叙事层的唯一错误类型。所有对外抛出的失败都是它，调用方 switch `code` 即可。
 */
export class NarrativeError extends Error {
  /**
   * @param {string} code - 见 {@link ERROR_CODES}；未知码会被原样保留（不静默改成别的）
   * @param {string} message - 人读的消息（可以中文）
   * @param {object} [options]
   * @param {unknown} [options.cause] - 原始错误
   * @param {Record<string, unknown>} [options.detail] - 结构化细节（进日志，不进消息）
   */
  constructor(code, message, { cause, detail } = {}) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'NarrativeError'
    this.code = code
    if (detail !== undefined) this.detail = detail
  }
}

/**
 * 把任意 throw 归一成 NarrativeError（已经是的就原样返回）。
 * @param {unknown} error
 * @param {string} fallbackCode - 不是 NarrativeError 时用的码
 * @returns {NarrativeError}
 */
export function asNarrativeError(error, fallbackCode = ERROR_CODES.MODEL_ERROR) {
  if (error instanceof NarrativeError) return error
  return new NarrativeError(fallbackCode, error instanceof Error ? error.message : String(error), { cause: error })
}

/**
 * 错误 → 可序列化的一行（进 JSONL 日志、进 status() 的 lastError）。
 * @param {NarrativeError} error
 * @returns {{code: string, message: string, detail?: unknown}}
 */
export function describeError(error) {
  const normalized = asNarrativeError(error)
  return {
    code: normalized.code,
    message: normalized.message,
    ...(normalized.detail === undefined ? {} : { detail: normalized.detail }),
  }
}
