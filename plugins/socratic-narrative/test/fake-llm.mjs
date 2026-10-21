// test/fake-llm.mjs — 模型通道替身（单测**不真调模型**，AC 要求）
//
// 形状照 `ctx.llm` 的最小面：只有一个 `stream(options)`，返回 AsyncIterable<StreamChunk>。
// 每次调用都把 options 记下来（`calls`），断言提示词里有什么、没有什么全靠它。

/**
 * 造一个替身。
 *
 * @param {object} behavior
 * @param {string} [behavior.text] - 正常返回的文本（会切成几段 delta）
 * @param {string} [behavior.finish] - finish 的 kind，默认 'stop'
 * @param {{message?: string, code?: string}} [behavior.failure] - finish 是 error/aborted 时带的 failure
 * @param {Error} [behavior.throwOnStart] - `stream()` 同步抛错
 * @param {Error} [behavior.throwMidStream] - 迭代到一半抛错
 * @param {boolean} [behavior.hang] - 永不产出、永不结束（用来测超时）
 * @param {{inputTokens?: number, outputTokens?: number}} [behavior.usage]
 */
export function fakeLlm(behavior = {}) {
  const calls = []
  return {
    calls,
    stream(options) {
      calls.push(options)
      if (behavior.throwOnStart !== undefined) throw behavior.throwOnStart
      return makeStream(behavior)
    },
  }
}

/** @param {object} behavior */
async function* makeStream(behavior) {
  if (behavior.hang === true) {
    // 一个永不 resolve 的 promise：不占句柄、不阻止进程退出，但迭代器永远不会再产出
    yield* []
    await new Promise(() => {})
    return
  }
  if (behavior.throwMidStream !== undefined) {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    throw behavior.throwMidStream
  }
  if (behavior.usage !== undefined) {
    yield { type: 'usage', usage: behavior.usage }
  }
  if (typeof behavior.text === 'string' && behavior.text !== '') {
    const chunks = splitForStream(behavior.text)
    for (const [index, text] of chunks.entries()) {
      // 第一块先声明 block-start，和真实适配器同序（runner 不依赖它，但不该靠"它没来"才对）
      if (index === 0) yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
    }
  }
  const kind = behavior.finish ?? 'stop'
  yield {
    type: 'finish',
    reason: kind === 'stop' || kind === 'max-tokens' ? { kind } : { kind, failure: behavior.failure ?? { message: '（替身没有给 failure）' } },
  }
}

/**
 * 把文本切成几段（长度刻意不等，模拟真实流式切分）。
 * @param {string} text
 * @returns {string[]}
 */
function splitForStream(text) {
  const size = Math.max(1, Math.ceil([...text].length / 3))
  const points = [...text]
  const chunks = []
  for (let index = 0; index < points.length; index += size) {
    chunks.push(points.slice(index, index + size).join(''))
  }
  return chunks
}

/**
 * 造一个「实例已配置的默认模型」替身。
 * @param {string} [provider]
 * @param {string} [model]
 */
export function fakeInstanceModel(provider = 'deepseek-official', model = 'deepseek-v4-flash') {
  return () => ({ provider, model })
}
