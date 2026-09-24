// lib/mermaid-parse.mjs — 真解析校验的**宿主侧客户端**（与 lib/mermaid-worker.mjs 成对）。
//
// 职责：把 mermaid 源码交给 worker 里的 mermaid.parse()，拿回「能解析 / 不能解析 + 错误原文」。
//
// 🔴 三条不变量（本项目的"不许静默"纪律）：
//   ① **解析器不可用 ≠ 校验通过**：worker 起不来 / mermaid 装不上 → `parseDiagram` 抛错，
//      工具**报错**，绝不静默放行（否则"能渲染"这个判定就变成了没有判定）。
//   ② worker **常驻**（进程内只起一次）：解析器冷启动实测约 0.4–0.5 s（jsdom 236 ms + mermaid 195 ms），
//      起一次之后单张图 2–30 ms。
//   ③ **零全局污染**：`window`/`document`/`navigator` 只挂在 worker 自己的 globalThis 里，
//      宿主主线程一个全局都不动（理由见 lib/mermaid-worker.mjs 文件头）。
//   ④ 🔴 **worker 不许吊住宿主进程**（实测踩过：常驻 worker 让 Node 进程永不退出，
//      无头会话因此挂到 600 s 超时被杀）：空闲时 `unref()`、每次解析期间 `ref()`——
//      空闲不拦退出，解析中不许提前退出。
//
// 依赖（装在插件自己的 node_modules 里，见 package.json dependencies）：
//   · `mermaid`（官方解析器；本机装的是 11.x）
//   · `jsdom`（mermaid 在 Node 下做标签清洗时需要的 DOM —— 是**解析器的运行前提**，
//     不是另加的功能依赖；理由与实测见 lib/mermaid-worker.mjs 文件头）
//   🔴 两者都不是 `@deepseek-ai/*`：宿主核心包**一个都不许**进插件 node_modules（会 Symbol 失配崩工具调用）。

import { Worker } from 'node:worker_threads'

/** 单次解析的等待上限（毫秒）。超时＝报错，不静默放行。 */
export const PARSE_TIMEOUT_MS = 20000

/**
 * 起一个常驻的解析 worker 客户端。
 *
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] - 单次解析等待上限
 * @param {URL|string} [opts.workerUrl] - worker 脚本位置（测试可注入）
 * @returns {{parse: (source:string) => Promise<{diagramType:string}>, close: () => Promise<void>,
 *            state: () => string}}
 */
export function createMermaidParser(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? PARSE_TIMEOUT_MS
  const workerUrl = opts.workerUrl ?? new URL('./mermaid-worker.mjs', import.meta.url)
  /** @type {Worker|null} */
  let worker = null
  /** @type {Map<number, {resolve:Function, reject:Function, timer:any}>} */
  const pending = new Map()
  let nextId = 1
  /** 'idle' | 'ready' | 'broken'；broken 之后不再重试（同一进程内解析器坏了就是坏了） */
  let state = 'idle'
  /** @type {string|null} */
  let brokenReason = null

  function fail(reason) {
    state = 'broken'
    brokenReason = reason
    worker?.unref() // 坏了也不能吊住宿主进程（见文件头 ④）
    for (const [, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error(reason))
    }
    pending.clear()
  }

  function ensureWorker() {
    if (state === 'broken') throw new Error(brokenReason)
    if (worker !== null) return worker
    worker = new Worker(workerUrl)
    worker.on('message', (message) => {
      const entry = pending.get(message?.id)
      if (entry === undefined) return
      pending.delete(message.id)
      clearTimeout(entry.timer)
      if (pending.size === 0) worker?.unref() // 这一批解析做完了 → 回到空闲态
      if (message.ok === true) entry.resolve({ diagramType: message.diagramType })
      else if (message.fatal === true) {
        const reason = `mermaid 解析器加载失败：${message.error}`
        fail(reason)
        entry.reject(new Error(reason))
      } else entry.reject(new Error(message.error))
    })
    // 🔴 空闲态立刻 unref：常驻 worker 不得拦住宿主进程退出（见文件头 ④）
    worker.unref()
    worker.on('error', (cause) => fail(`mermaid 解析 worker 出错：${cause?.message ?? cause}`))
    worker.on('exit', (code) => {
      if (state === 'broken') return
      // 正常关闭（close()）时 worker 已置 null；其余退出都算异常
      if (worker !== null && code !== 0) fail(`mermaid 解析 worker 退出（exit=${code}）`)
    })
    state = 'ready'
    return worker
  }

  /**
   * 用 mermaid 官方解析器解析一张图。
   * @param {string} source - mermaid 源码正文
   * @returns {Promise<{diagramType: string}>} 解析通过时返回图类型
   * @throws {Error} 解析失败（错误原文＝mermaid 的报错）或解析器不可用
   */
  function parse(source) {
    let active
    try {
      active = ensureWorker()
    } catch (cause) {
      return Promise.reject(cause)
    }
    const id = nextId
    nextId += 1
    // 解析期间 ref：worker 是唯一的 handle，不 ref 的话进程可能在等解析结果时提前退出
    active.ref()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        active.unref()
        reject(new Error(`mermaid 解析超时（>${timeoutMs} ms）：图可能过大或解析器卡住`))
      }, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      pending.set(id, { resolve, reject, timer })
      active.postMessage({ id, source })
    })
  }

  /** 关掉 worker（测试与宿主退出时用）。 */
  async function close() {
    const active = worker
    worker = null
    if (active === null) return
    await active.terminate()
  }

  return { parse, close, state: () => (state === 'broken' ? `broken: ${brokenReason}` : state) }
}
