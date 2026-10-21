// lib/runlog.mjs — 运行日志（N1.4 的「写日志」）
//
// 落盘位置：`<classroomDir>/runtime/.narrative/agent-runs.jsonl`
//   · 放在 `runtime/` 下的隐藏子目录：不进教室内容的命名空间，也不与契约 K3 的
//     `runtime/notes.jsonl`（教学记录真源）混淆——那是**教学事实**，这是**运行过程**。
//   · 一行一条 JSON：跨重启可查。面板将来要回答「上次为什么失败」直接读它。
//
// 🔴 日志写失败**不能**变成静默失败：`record` 把错误抛给调用方，服务层据此记 logger.error
//    并进 status()。绝不吞。
// 追加用 `appendFile`（`flag:'a'`）＋进程内串行链：一行一条、写入顺序确定，不做整文件重写。

import { appendFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readTextIfExists } from './atomic.mjs'

/** 运行日志相对教室目录的路径。 */
export const RUN_LOG_RELATIVE = join('runtime', '.narrative', 'agent-runs.jsonl')

/**
 * 建一个运行日志写入器。
 * @param {{classroomDir: string, now?: () => number, append?: (file: string, text: string) => Promise<void>, read?: typeof readTextIfExists}} options
 */
export function createRunLog({ classroomDir, now = () => Date.now(), append = appendLine, read = readTextIfExists }) {
  const file = join(classroomDir, RUN_LOG_RELATIVE)
  let chain = Promise.resolve()

  return {
    /** 日志文件绝对路径（只读出口，测试与面板用）。 */
    file,
    /**
     * 追加一行。串行化：并发调用不会交错成半行。
     * @param {Record<string, unknown>} entry
     * @returns {Promise<void>}
     */
    record(entry) {
      const line = `${JSON.stringify({ ...entry, loggedAt: entry.loggedAt ?? now() })}\n`
      const operation = chain.then(() => append(file, line))
      // 链尾吸收失败，别让一次写日志失败卡死后续所有写（失败本身仍然抛给本次调用方）
      chain = operation.then(
        () => undefined,
        () => undefined,
      )
      return operation
    },
    /**
     * 读回最近 `limit` 条（坏行跳过并计入 `bad`——**不**让一行坏数据把整份日志读废，
     * 对齐契约 K3.5 对 `notes.jsonl` 的读法）。
     * @param {number} [limit]
     * @returns {Promise<{entries: object[], bad: number}>}
     */
    async tail(limit = 20) {
      const text = (await read(file)) ?? ''
      const entries = []
      let bad = 0
      for (const raw of text.split('\n')) {
        const line = raw.trim()
        if (line === '') continue
        try {
          entries.push(JSON.parse(line))
        } catch {
          bad += 1
        }
      }
      return { entries: entries.slice(Math.max(0, entries.length - limit)), bad }
    },
  }
}

/**
 * 默认写入：确保目录存在后按追加方式落一行。
 * @param {string} file
 * @param {string} text
 */
async function appendLine(file, text) {
  await mkdir(dirname(file), { recursive: true })
  await appendFile(file, text, { mode: 0o600 })
}
