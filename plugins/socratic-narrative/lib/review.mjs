// lib/review.mjs — N5.2 世界观提议的审阅（每节课结束、跑日记的那一轮顺带跑）
//
// 流程（确定性外壳 + 模型只做判断）：
//   ① 读 `world/proposals.md` 与 `world/changelog.md`；**待审 = 没在 changelog 里出现过的提议**
//   ② 按时间顺序**逐条**处理（EC：提议之间冲突时，后来的看到先前的结果）
//      —— 每条都**重新读一遍** characters/ 与 world/，所以第 2 条看到的是第 1 条改完之后的世界
//   ③ 接受 → 写一个文件（`characters/**` 或 `world/**`，N5.3 的守卫在写盘前判）+ changelog 记一行
//      拒绝 → changelog 记一行，写明理由
//   ④ 目标路径不合法（教学文件、越界、代码维护的日志）→ **拒绝写盘**，但仍记一行 changelog，
//      理由写清楚是被守卫挡下的 —— 不留「静默没做」的状态
//
// 🔴 N5.3 的硬约束由 `lib/worldguard.mjs` 在**写盘前**判，不靠提示词自觉。

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './atomic.mjs'
import { ERROR_CODES, NarrativeError } from './errors.mjs'
import { appendChangelogRow, readWorldLog } from './proposals.mjs'
import { classifyWorldWrite, CODE_OWNED_FILES } from './worldguard.mjs'

/** 审阅 agent 的输出字段（一条提议 = 一次调用 = 最多一个文件）。 */
export const REVIEW_SCHEMA = Object.freeze({
  fields: {
    decision: { type: 'string', required: true, minChars: 1, maxChars: 16 },
    reason: { type: 'string', required: true, minChars: 1, maxChars: 300 },
    path: { type: 'string', maxChars: 200 },
    content: { type: 'string', maxChars: 40_000 },
  },
})

/** 世界观目录里允许被审阅重写的文件之外的那些（代码维护的日志）。 */
const EXCLUDED_FILES = new Set(CODE_OWNED_FILES.map((path) => path.split('/').slice(1).join('/')))

/**
 * 审阅 agent 的系统位。
 * @returns {string}
 */
export function buildReviewSystem() {
  return [
    '你在维护一个教室的世界观：一个建在礁盘上的潮汐观测站，以及住在那里的一位记录员（鲸）。',
    '现在有人提了「这个世界该多一个人／该改一处设定」的提议，你决定接受还是拒绝。',
    '',
    '判断的依据：这件事会不会让这个世界更可信、更有连续性；与已有的设定和角色冲突吗；',
    '它是不是只是把教学材料换个说法（那种不要）。',
    '',
    '硬规则（越界会被代码直接拒绝，不用试）：',
    '- 只能写 characters/ 或 world/ 下的 .md 文件，一条提议最多改一个文件。',
    '- 教学文件一律不许碰：materials/、curriculum.md、knowledge_points.md、system_core.md、_anchor.md。',
    '- world/proposals.md 与 world/changelog.md 是日志，不许重写。',
    '- 接受时 `content` 是这个文件的**完整内容**（不是追加片段），`path` 是相对教室目录的路径。',
    '',
    '只输出一个 JSON 对象，不要解释。',
  ].join('\n')
}

/**
 * 审阅 agent 的正文位。
 * @param {{proposal: object, files: Array<{path: string, content: string}>}} input
 * @returns {string}
 */
export function buildReviewPrompt({ proposal, files }) {
  return [
    `提议 ${proposal.id}（${proposal.at}，来自${proposal.origin}）：`,
    `内容：${proposal.content}`,
    `理由：${proposal.reason}`,
    proposal.quote === '' ? '' : `触发它的对话：${proposal.quote}`,
    '',
    `现在 characters/ 与 world/ 里已有的文件：${files.map((file) => file.path).join('、') || '（还没有）'}`,
    '',
    '决定：接受就写 `decision: "accept"` 并给出 `path` 与 `content`；拒绝就写 `decision: "reject"` 并给出理由。',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/**
 * 列出世界观目录里可被审阅参考的文件（不含两份日志）。
 * @param {string} classroomDir
 * @returns {Promise<Array<{path: string, content: string}>>}
 */
export async function listWorldFiles(classroomDir) {
  const out = []
  for (const dir of ['characters', 'world']) {
    let entries
    try {
      entries = await readdir(join(classroomDir, dir), { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      if (dir === 'world' && EXCLUDED_FILES.has(entry.name)) continue
      const relative = `${dir}/${entry.name}`
      out.push({ path: relative, content: await readFile(join(classroomDir, relative), 'utf8') })
    }
  }
  return out
}

/**
 * 建一个审阅器。
 * @param {object} options
 * @param {(spec: object) => Promise<object>} options.runTask - 运行器的 `runTask`
 * @param {() => number} [options.now]
 * @param {(level: string, ...args: any[]) => void} [options.log]
 * @param {(classroomDir: string, entry: object) => Promise<void>} [options.recordRun]
 */
export function createReviewer({ runTask, now = () => Date.now(), log = () => {}, recordRun = null }) {
  /**
   * 跑一轮审阅（把所有积压的提议按时间顺序处理完）。
   *
   * @param {{classroomDir: string, model?: object, timeoutMs?: number}} request
   * @returns {Promise<{reviewed: number, accepted: object[], rejected: object[], refused: object[]}>}
   */
  async function run({ classroomDir, model, timeoutMs }) {
    const log0 = await readWorldLog(classroomDir)
    const pending = log0.pending
    const summary = { reviewed: 0, accepted: [], rejected: [], refused: [] }
    for (const proposal of pending) {
      summary.reviewed += 1
      // EC：每条都重读一遍 —— 后一条看到的是前一条改完的世界
      const files = await listWorldFiles(classroomDir)
      let decision
      try {
        const result = await runTask({
          task: 'review',
          system: buildReviewSystem(),
          prompt: buildReviewPrompt({ proposal, files }),
          inputs: files.map((file) => ({ label: file.path, content: file.content })),
          root: classroomDir,
          schema: REVIEW_SCHEMA,
          ...(model === undefined ? {} : { model }),
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        })
        decision = normalizeDecision(result.value)
      } catch (error) {
        const described = { proposalId: proposal.id, code: error?.code ?? 'MODEL_ERROR', message: String(error?.message ?? error) }
        await recordRun?.(classroomDir, { task: 'review', state: 'failed', proposalId: proposal.id, code: described.code, message: described.message })
        log('error', `[narrative] 提议 ${proposal.id} 审阅失败：${described.message}`)
        // 失败不写 changelog：它还没被处理，下一轮会重试（写一行「处理中」会让它永远算已处理）
        // 已经分好类的错误（比如模型输出不合约定 → INVALID_OUTPUT）原样抛，不降级成 MODEL_ERROR
        if (error instanceof NarrativeError) throw error
        throw new NarrativeError(ERROR_CODES.MODEL_ERROR, `提议 ${proposal.id} 审阅失败：${described.message}`, { cause: error, detail: described })
      }

      if (decision.decision === 'reject') {
        await appendChangelogRow({
          classroomDir,
          now: now(),
          verdict: '拒绝',
          target: '—',
          summary: decision.reason,
          proposalId: proposal.id,
        })
        summary.rejected.push({ proposalId: proposal.id, reason: decision.reason })
        continue
      }

      const guard = classifyWorldWrite(decision.path, { bytes: Buffer.byteLength(decision.content, 'utf8') })
      if (!guard.ok) {
        await appendChangelogRow({
          classroomDir,
          now: now(),
          verdict: '拒绝',
          target: decision.path === '' ? '—' : decision.path,
          summary: `${guard.reason}（守卫挡下：${guard.code}）`,
          proposalId: proposal.id,
        })
        summary.refused.push({ proposalId: proposal.id, code: guard.code, reason: guard.reason })
        log('error', `[narrative] 提议 ${proposal.id} 被世界观守卫拒绝：${guard.reason}`)
        await recordRun?.(classroomDir, { task: 'review', state: 'refused', proposalId: proposal.id, code: guard.code, path: decision.path })
        continue
      }

      await writeFileAtomic(join(classroomDir, guard.path), decision.content.endsWith('\n') ? decision.content : `${decision.content}\n`)
      await appendChangelogRow({
        classroomDir,
        now: now(),
        verdict: '接受',
        target: guard.path,
        summary: decision.reason,
        proposalId: proposal.id,
      })
      summary.accepted.push({ proposalId: proposal.id, path: guard.path, reason: decision.reason })
      await recordRun?.(classroomDir, { task: 'review', state: 'ok', proposalId: proposal.id, path: guard.path })
    }
    return summary
  }

  return { run }
}

/**
 * 把模型输出归一成决定。`decision` 只认 `accept` / `reject` 两个词（其它判不合法，不猜）。
 * @param {Record<string, unknown>} value
 * @returns {{decision: 'accept'|'reject', reason: string, path: string, content: string}}
 */
export function normalizeDecision(value) {
  const text = String(value?.decision ?? '').trim().toLowerCase()
  const raw = ['accept', '接受', 'yes', 'ok'].includes(text) ? 'accept' : ['reject', '拒绝', 'no'].includes(text) ? 'reject' : ''
  if (raw === '') {
    throw new NarrativeError(ERROR_CODES.INVALID_OUTPUT, `decision 只能是 accept 或 reject（得到 ${JSON.stringify(value?.decision)}）`, {
      detail: { reason: 'BAD_DECISION' },
    })
  }
  const reason = String(value?.reason ?? '').trim()
  if (reason === '') throw new NarrativeError(ERROR_CODES.INVALID_OUTPUT, '拒绝/接受都必须给理由', { detail: { reason: 'NO_REASON' } })
  const path = typeof value?.path === 'string' ? value.path.trim() : ''
  const content = typeof value?.content === 'string' ? value.content : ''
  if (raw === 'accept' && (path === '' || content.trim() === '')) {
    throw new NarrativeError(ERROR_CODES.INVALID_OUTPUT, '接受时必须给出 path 与 content', { detail: { reason: 'NO_FILE' } })
  }
  return { decision: raw, reason, path, content }
}
