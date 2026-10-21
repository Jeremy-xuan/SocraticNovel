// lib/lock.mjs — 跨进程的建议性文件锁（零依赖，`open(..., 'wx')` + 陈旧锁回收）
//
// 为什么需要它：契约 K4.3 要求「两个标签页同时发言不能丢消息」。同一进程内
// `lib/serial.mjs` 已经能串行；但两个标签页是**同一个进程**，而两个 DSH 实例（或引擎与
// 本包）指向同一个教室目录时是**两个进程** —— 那需要一把跨进程的锁。
//
// 🔴 为什么不用 `@deepseek-ai/dsh-atomic-write` 的 `withFileLock`：验收铁律③「绝不把任何
//    @deepseek-ai/* 包装进 profile 或插件的 node_modules」（会造成宿主包双实例）。这是
//    本包第三次为此自己实现（atomic / serial / lock 三者加起来不到 150 行）。
//
// 机制（标准做法，不做启发式）：
//   ① 以 `wx` 创建 `<目标>.lock`，成功即持锁；文件里写 `{pid, token, acquiredAt}`。
//   ② 已存在 → 读它：若 `acquiredAt` 早于 `staleMs`，判为持有者已死/卡死，**删掉重抢**
//      （stale 判据是时间，不是猜测）；否则按 `delayMs` 退避重试，最多 `retries` 次。
//   ③ 释放：先核对 token（不删别人的锁），再 unlink。
//
// 边界（写进 README）：这是**建议性锁**——不参与本协议的写者（比如引擎自己的
// `withFileLock`）不会看这份锁文件。要真正互斥得全仓统一，本轮不做。

import { mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

/** 拿不到锁的失败（单独一个错误类，调用方靠 `code` 判，不靠消息文本）。 */
export class LockTimeoutError extends Error {
  /**
   * @param {string} file - 锁文件路径
   * @param {number} waitedMs
   */
  constructor(file, waitedMs) {
    super(`等锁超时：${file}（已等 ${waitedMs}ms）`)
    this.name = 'LockTimeoutError'
    this.code = 'LOCK_TIMEOUT'
  }
}

/**
 * 拿锁执行一段操作。
 *
 * @param {string} lockFile - 锁文件绝对路径（通常是 `<目标文件>.lock`）
 * @param {() => Promise<T>} operation
 * @param {object} [options]
 * @param {number} [options.staleMs] - 超过这个时长未释放即视为陈旧（默认 30s）
 * @param {number} [options.retries] - 最多尝试次数（默认 200）
 * @param {number} [options.delayMs] - 两次尝试的间隔（默认 15ms）
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.sleep] - 测试可注入（默认 setTimeout）
 * @returns {Promise<T>}
 * @template T
 */
export async function withFileLock(lockFile, operation, { staleMs = 30_000, retries = 200, delayMs = 15, now = () => Date.now(), sleep = defaultSleep } = {}) {
  const token = randomUUID()
  const startedAt = now()
  // 锁文件所在目录可能还不存在（第一次写 world/ 或 runtime/.narrative/）——先建出来
  await mkdir(dirname(lockFile), { recursive: true })
  let handle = null
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      handle = await open(lockFile, 'wx', 0o600)
      break
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      if (await isStale(lockFile, staleMs, now)) {
        // 持有者已死：删掉重抢。删失败（别人先删了）不算错，下一轮会重新 open。
        await rm(lockFile, { force: true }).catch(() => {})
        continue
      }
      if (attempt === retries - 1) throw new LockTimeoutError(lockFile, now() - startedAt)
      await sleep(delayMs)
    }
  }
  if (handle === null) throw new LockTimeoutError(lockFile, now() - startedAt)

  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, token, acquiredAt: now() }))
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    return await operation()
  } finally {
    await releaseIfMine(lockFile, token)
  }
}

/**
 * 锁文件是否已陈旧。读不到（刚被别人删掉）也算陈旧：让调用方重抢一次最省事。
 * @param {string} lockFile
 * @param {number} staleMs
 * @param {() => number} now
 * @returns {Promise<boolean>}
 */
async function isStale(lockFile, staleMs, now) {
  try {
    const text = await readFile(lockFile, 'utf8')
    const parsed = JSON.parse(text)
    if (Number.isFinite(parsed?.acquiredAt) === false) return false
    return now() - parsed.acquiredAt > staleMs
  } catch (error) {
    if (error?.code === 'ENOENT') return true
    // 内容坏掉（写了一半 / 被截断）：用文件 mtime 兜底判陈旧，仍然只看时间
    try {
      const info = await stat(lockFile)
      return now() - info.mtimeMs > staleMs
    } catch {
      return true
    }
  }
}

/**
 * 只删自己那把锁（token 不符就不动），避免把别人刚抢到的锁删掉。
 * @param {string} lockFile
 * @param {string} token
 */
async function releaseIfMine(lockFile, token) {
  try {
    const text = await readFile(lockFile, 'utf8')
    const parsed = JSON.parse(text)
    if (parsed?.token === token) await rm(lockFile, { force: true })
  } catch {
    // 锁文件已经不在 = 目标状态；删不掉也不该把业务结果变成失败
  }
}

/** @param {number} ms */
function defaultSleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}
