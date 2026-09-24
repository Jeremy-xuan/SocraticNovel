// lib/mermaid-worker.mjs — **真解析校验**的执行体（跑在 worker 线程里）。
//
// 为什么是 worker 而不是主线程（🔴 这是设计决定，不是随手）：
//   mermaid 在 Node 里跑 `parse()` 需要一套 DOM —— 实测（报告 §2.2）：
//     · 不带 DOM：`flowchart` 这类**带标签**的图直接抛 `DOMPurify.addHook is not a function`
//       （mermaid 内部用 DOMPurify 洗标签，而 DOMPurify 在 Node 下拿不到 window）；
//     · 补上 jsdom 的 `window`/`document` 后，12 种图类型全部 parse 通过。
//   → 必须把 `window`/`document`/`navigator` 挂到全局。**挂到宿主主线程的全局**会改变宿主进程里
//     所有 `typeof window !== 'undefined'` 的判断（DSH 宿主是 Node 程序，改它的全局＝动别人的地基）。
//   → 所以放进 **worker**：worker 有自己独立的 globalThis，宿主主线程**一个全局都不动**。
//
// 协议（与 lib/mermaid-parse.mjs 成对）：
//   ← { id: number, source: string }
//   → { id: number, ok: true, diagramType: string } | { id: number, ok: false, error: string }
//   → { id: number, ok: false, error: string, fatal: true }  ← 解析器本身没起来（宿主侧必须当错误处理）

import { parentPort } from 'node:worker_threads'

/** 解析器是否已就绪（惰性初始化，只做一次）。 */
let ready = null

/**
 * 装好 DOM 与 mermaid。失败时抛错（错误原文带回宿主，由宿主决定怎么报给模型）。
 * @returns {Promise<{parse: (source: string) => Promise<{diagramType: string}>}>}
 */
async function init() {
  if (ready !== null) return ready
  ready = (async () => {
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM('<!doctype html><html><body></body></html>')
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    globalThis.DOMParser = dom.window.DOMParser
    // navigator 在 Node 25 里是只读 getter，必须用 defineProperty
    Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
    return mermaid
  })()
  return ready
}

parentPort?.on('message', async (message) => {
  const id = message?.id
  try {
    const mermaid = await init()
    const result = await mermaid.parse(String(message?.source ?? ''))
    parentPort.postMessage({ id, ok: true, diagramType: String(result?.diagramType ?? '') })
  } catch (cause) {
    const error = cause?.message ?? String(cause)
    const fatal = /Cannot find package|Cannot find module|ERR_MODULE_NOT_FOUND/.test(error)
    parentPort.postMessage({ id, ok: false, error, fatal })
  }
})
