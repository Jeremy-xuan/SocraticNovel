// lib/atomic-write.mjs — 本地「原子替换 + 跨进程写锁」（B2，2026-10-21）。
//
// 🔴 为什么要有一份本地的：见 `lib/toolshape.mjs` 文件头（0.2.1 删掉安装版回退目录 ⇒
//   插件 `import '@deepseek-ai/dsh-atomic-write'` 必然把宿主包装进 profile ⇒ 铁律③必红）。
//   **没有**可优先用的宿主服务：`dsh-atomic-write` 的 package.json 里没有 cordis 插件面
//   （无 `dsh` 字段，只导出两个裸函数），宿主也没有任何插件 `provide('atomicWrite')`；
//   `ctx.fs` 是另一套抽象（execution world + sandbox 策略，`writeText` 保 mode 但不带锁，
//   锁 `withLock` 只在 local 后端实现里、不在 FileSystem 契约上），换过去是**语义变更**，
//   不是等价替换。所以这里只有一条实现路径，不做双路径。
//
// 复刻对象：`@deepseek-ai/dsh-atomic-write/lib/index.js`（0.2.1-rc.2，220 行），
// 逐条保留它证明过的性质：
//   · `writeFileAtomic`：同目录随机后缀临时文件用 `wx` 打开（拒绝跟随预先埋好的符号链接），
//     权限位 `mode` 直接落在**新 inode** 上，再 `rename` 覆盖目标 ——
//     读者只会看到旧内容或新内容，且替换后的文件**恰好**是传入的 mode（不会先宽后 chmod）；
//     失败则删掉临时文件并把错误原样抛出。Windows 上对 EACCES/EBUSY/EPERM 做有界重试。
//     崩溃持久化（fsync）**不在**本模块承诺范围内（宿主同样不承诺）。
//   · `withFileLock`：`wx` 创建 `<目标>.lock`（内容 = `<pid>\n`）串行化跨进程写者；
//     争用时指数退避，超时抛错（不猜锁是否还活着）；持锁者进程已不存在（信号探针 ESRCH）
//     时，凭 `<lock>.takeover-<记录哈希>` 认领文件接管，接管前重读锁记录并用 PID 复核，
//     因此**不会**删掉一个刚被别人拿到的新锁。父目录必须已存在。
//
// 与宿主的**实质差异**（写清楚，不许当成等价）：
//   · 宿主的锁记录读失败（如 EACCES）返回 undefined，本模块同形；但宿主对 Windows
//     "EPERM 但探测不到锁" 只重试一次，本模块同样只重试一次（原样保留，不是我自己发明的策略）。
//   · 宿主内部用 `setTimeout(promises)` + AbortSignal 做退避；本模块同样用
//     `node:timers/promises` 的 `setTimeout`，`signal` 语义一致。

import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

/** Windows 上属于「暂时被别人占用」的重命名错误码。 */
const WINDOWS_TRANSIENT_RENAME_ERRORS = new Set(['EACCES', 'EBUSY', 'EPERM'])
const WINDOWS_RENAME_RETRY_INITIAL_MS = 20
const WINDOWS_RENAME_RETRY_MAX_MS = 200
const WINDOWS_RENAME_RETRY_LIMIT = 8

/** 锁争用的退避区间（与宿主一致）。 */
const LOCK_RETRY_INITIAL_MS = 20
const LOCK_RETRY_MAX_MS = 200

/** 未指定 waitMs 时的等待上限（与宿主一致：为主持一次"读-渲染-提交"而设）。 */
const DEFAULT_LOCK_WAIT_MS = 2000

/** 新建文件/锁的权限位（0o600）。 */
const LOCK_FILE_MODE = 0o600

/** Windows 的暂时性重命名失败（其它平台恒 false）。 */
function isTransientWindowsRenameError(error) {
  if (process.platform !== 'win32') return false
  return WINDOWS_TRANSIENT_RENAME_ERRORS.has(error?.code ?? '')
}

/** 有界重试地 rename（仅 Windows 的暂时性干扰才会重试）。 */
async function renameAtomicTemp(temp, filename) {
  let delay = WINDOWS_RENAME_RETRY_INITIAL_MS
  for (let retries = 0; ; retries += 1) {
    try {
      await rename(temp, filename)
      return
    } catch (error) {
      if (!isTransientWindowsRenameError(error)) throw error
      if (retries >= WINDOWS_RENAME_RETRY_LIMIT) throw error
    }
    await sleep(delay)
    delay = Math.min(delay * 2, WINDOWS_RENAME_RETRY_MAX_MS)
  }
}

/**
 * 用 `content` 原子替换 `filename`（父目录按需创建）。
 * @param {string} filename - 最终路径
 * @param {string|Uint8Array} content - 完整的新内容
 * @param {{mode: number, dirMode?: number}} options - 新 inode 的权限位（可选父目录权限位）
 * @returns {Promise<void>}
 */
export async function writeFileAtomic(filename, content, options) {
  if (typeof options?.mode !== 'number') {
    throw new TypeError(`writeFileAtomic(${filename}): options.mode is required (permission bits for the replacement inode)`)
  }
  await mkdir(dirname(filename), {
    recursive: true,
    ...(options.dirMode === undefined ? {} : { mode: options.dirMode }),
  })
  const temp = `${filename}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, content, { mode: options.mode, flag: 'wx' })
    await renameAtomicTemp(temp, filename)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

/** 独占创建是否遇到了「已有锁」（EEXIST 直接算；EPERM 只在探测到锁存在时算）。 */
async function isLockContention(error, lockPath) {
  const code = error?.code
  if (code === 'EEXIST') return true
  if (code !== 'EPERM') return false
  try {
    await lstat(lockPath)
    return true
  } catch {
    return false
  }
}

/** 记录里的持锁进程是否**已被证明**不在（信号探针 ESRCH）。 */
function holderExited(record) {
  if (!/^\d+\n$/.test(record)) return false
  const pid = Number(record.trim())
  if (pid === 0 || pid > 2147483647) return false
  if (pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return error.code === 'ESRCH'
  }
}

/** 读锁记录；读不到 → undefined。 */
async function readLockRecord(lockPath) {
  try {
    return await readFile(lockPath, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * 持锁进程已退出 → 凭认领文件删除死锁。接管是安全的：认领文件按记录哈希命名，
 * 只有拿到认领权的竞争者能删，且删前重读记录 + 复核 PID。
 * @param {string} lockPath - 锁文件
 * @returns {Promise<boolean>} 是否删掉了死持锁者的锁
 */
async function takeOverExitedLock(lockPath) {
  const record = await readLockRecord(lockPath)
  if (record === undefined || !holderExited(record)) return false
  const claim = `${lockPath}.takeover-${createHash('sha256').update(record).digest('hex').slice(0, 16)}`
  try {
    await writeFile(claim, `${process.pid}\n`, { mode: LOCK_FILE_MODE, flag: 'wx' })
  } catch (error) {
    const code = error.code
    if (code === 'EEXIST' || code === 'EPERM') return false
    throw error
  }
  try {
    if ((await readLockRecord(lockPath)) !== record || !holderExited(record)) return false
    try {
      await rm(lockPath, { force: true })
    } catch {
      return false
    }
    return true
  } finally {
    await rm(claim, { force: true }).catch(() => {})
  }
}

/**
 * 持 `<filename>.lock` 跑一次「读 → 判重 → 写」，串行化跨进程写者。
 * @param {string} filename - 被保护的最终路径（父目录必须已存在）
 * @param {() => Promise<any>} operation - 临界区
 * @param {{waitMs?: number, signal?: AbortSignal}} [options] - 等待上限 / 取消信号
 * @returns {Promise<any>} 临界区返回值（成功失败都释放锁）
 */
export async function withFileLock(filename, operation, options) {
  const lockPath = `${filename}.lock`
  const deadline = Date.now() + (options?.waitMs ?? DEFAULT_LOCK_WAIT_MS)
  let delay = LOCK_RETRY_INITIAL_MS
  let retriedUnconfirmedPermissionError = false
  for (;;) {
    options?.signal?.throwIfAborted()
    try {
      await writeFile(lockPath, `${process.pid}\n`, { mode: LOCK_FILE_MODE, flag: 'wx' })
      break
    } catch (error) {
      if (!(await isLockContention(error, lockPath))) {
        if (process.platform !== 'win32' || error?.code !== 'EPERM' || retriedUnconfirmedPermissionError) throw error
        retriedUnconfirmedPermissionError = true
      } else if (await takeOverExitedLock(lockPath)) {
        continue
      }
    }
    if (Date.now() >= deadline) throw new Error(`atomic-write: timed out waiting for the writer lock at ${lockPath}`)
    await sleep(delay, undefined, { signal: options?.signal })
    delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS)
  }
  try {
    options?.signal?.throwIfAborted()
    return await operation()
  } finally {
    await rm(lockPath, { force: true })
  }
}
