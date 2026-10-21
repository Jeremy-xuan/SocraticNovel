// lib/atomic.mjs — 最小原子写（临时文件 + rename），零依赖
//
// 🔴 为什么不用 `@deepseek-ai/dsh-atomic-write`：验收铁律③「绝不把任何 @deepseek-ai/* 包装进
//    profile 或插件的 node_modules」（acceptance/lib/profile.mjs 文件头，会造成宿主包双实例、
//    Symbol 失配 → 工具调用崩溃）。本包要能被 `dsh plugin add` 装进干净 profile，所以**不声明
//    任何宿主包依赖**，落盘用这 40 行自己实现。
//
// 语义上对齐引擎的做法（plugins/socratic-engine/lib/postclass.mjs 用 writeFileAtomic）：
//   · 同目录随机后缀临时文件 → 写完 rename 覆盖目标：读方永远看不到半截内容
//   · 权限位默认 0600（教室 runtime/ 现有文件就是 0600）
// 明确不做的事：**没有跨进程文件锁**。本包的写全部经由自己的串行队列（lib/serial.mjs），
// 同一进程内不会交叉；跨进程（两个 DSH 实例指同一个教室目录）不在本轮范围内，写进 README「已知边界」。

import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 教室 runtime/ 文件的既有权限位。 */
export const DEFAULT_FILE_MODE = 0o600

/**
 * 原子写一个文件（同目录临时文件 + rename）。
 * @param {string} file - 目标绝对路径
 * @param {string | Uint8Array} data - 全文内容（**覆盖**写，不是追加）
 * @param {{mode?: number}} [options]
 * @returns {Promise<{path: string, bytes: number}>}
 */
export async function writeFileAtomic(file, data, { mode = DEFAULT_FILE_MODE } = {}) {
  const bytes = typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : data.byteLength
  await mkdir(dirname(file), { recursive: true })
  const temp = join(dirname(file), `.${basenameOf(file)}.tmp-${process.pid}-${randomUUID()}`)
  try {
    const handle = await open(temp, 'wx', mode)
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, file)
  } catch (error) {
    // 临时文件没 rename 成功就清掉，别在教室目录里留垃圾
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
  return { path: file, bytes }
}

/**
 * 读文本文件；不存在返回 `null`（**只有** ENOENT 走这条，别的 IO 错误照常抛）。
 * @param {string} file
 * @returns {Promise<string | null>}
 */
export async function readTextIfExists(file) {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/**
 * 文件是否存在（`stat` 一次）。
 * @param {string} file
 * @returns {Promise<boolean>}
 */
export async function exists(file) {
  try {
    await stat(file)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

/** @param {string} file */
function basenameOf(file) {
  const index = file.lastIndexOf('/')
  return index === -1 ? file : file.slice(index + 1)
}
