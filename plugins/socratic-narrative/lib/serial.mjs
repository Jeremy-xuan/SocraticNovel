// lib/serial.mjs — 按 key 串行化的异步队列（同一进程内的写顺序保证）
//
// 用途：日记要「读 diary.md → 追加 → 写 ledger」，两个触发（收课相位 + 闲置兜底）可能同时到；
// 串行化后第二次一定看到第一次的落盘结果，从而幂等判断成立。
//
// 明确边界：**只保证同一进程内**。跨进程并发（两个 DSH 实例指同一个教室目录）不在本轮范围，
// 见 README「已知边界」。

/**
 * 建一个按 key 串行的队列。
 * @returns {{run: <T>(key: string, operation: () => Promise<T>) => Promise<T>, size: () => number}}
 */
export function createSerialQueue() {
  /** @type {Map<string, Promise<unknown>>} */
  const tails = new Map()

  return {
    /**
     * 排队执行 `operation`；同一 key 上的操作严格按调用顺序执行。
     * 前一个失败不会卡死后面的（错误只传导给它自己的调用方）。
     * @template T
     * @param {string} key
     * @param {() => Promise<T>} operation
     * @returns {Promise<T>}
     */
    run(key, operation) {
      const previous = tails.get(key) ?? Promise.resolve()
      // 用 then 的两个分支都接上：前一个 reject 也要让这一个跑
      const result = previous.then(operation, operation)
      // 尾链只吸收结果，不让一个失败污染后面无关的调用
      const tail = result.then(
        () => undefined,
        () => undefined,
      )
      tails.set(key, tail)
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key)
      })
      return result
    },
    /** 当前还挂着尾链的 key 数（测试与自检用）。 */
    size() {
      return tails.size
    },
  }
}
