// lib/proposals.mjs — N5.1/N5.2 的提议与变更记录（**两份文件都只追加**）
//
// 为什么两份都只追加（这是本模块最重要的一个判断）：
//   「这条提议处理过没有」如果靠**改写提议块里的状态行**，就需要一份读—改—写；两个 agent
//   同时提议、或审阅中途崩掉，都会把别人的块改坏。所以：
//     · `world/proposals.md`：只追加提议块（谁提的、内容、理由、触发它的对话片段）
//     · `world/changelog.md`：只追加决定行（接受/拒绝都写，接受还要写改了哪个文件）
//     · **待审 = 提议 id 没有出现在 changelog 里**（纯推导，幂等，崩了重跑也安全）
//   changelog 同时就是 N5.4 说的「乱没乱的观察窗口」：一张表，一眼扫完。
//
// EC（N5.2）：提议之间互相冲突时按**时间顺序**处理，后来的能看到先前的结果 ——
//   这件事由 `review.mjs` 保证（逐条、串行、每条都重读一遍当前文件）。

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { exists, writeFileAtomic } from './atomic.mjs'
import { withFileLock } from './lock.mjs'
import { beijingDateTime, beijingStamp } from './time.mjs'

/** 提议文件（相对教室目录）。 */
export const PROPOSALS_RELATIVE = join('world', 'proposals.md')
/** 变更记录（相对教室目录）。 */
export const CHANGELOG_RELATIVE = join('world', 'changelog.md')

/** 提议块的标题行：`## P-20261021T181500-01`。 */
const PROPOSAL_HEADING = /^##\s+(P-\d{8}T\d{6}-\d{2})\s*$/
/** 变更记录的数据行：`| 时间 | 结果 | 改了什么 | 内容与理由 | 来源 |`。 */
const CHANGELOG_ROW = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*$/

/** 提议文件的空壳（第一次追加时用）。 */
export const PROPOSALS_HEADER = `# 世界观提议

> 任何 agent 觉得该给这个世界加一个人、或改一处设定时，往这里**追加**一条：内容、理由、触发它的对话片段。
> 本文件只追加、不改写。处理结果不写在这里，写在 \`world/changelog.md\`：**没有出现在 changelog 里的提议 = 还没审**。
> 审阅发生在每节课结束后的那一轮（和日记同一轮，见开发文档 N5.2）。

`

/** 变更记录的空壳。 */
export const CHANGELOG_HEADER = `# 世界观变更记录

> 一眼扫完的窗口（N5.4）：每行一次决定。接受看「改了什么」，拒绝看「为什么」。
> 本文件只追加。时间一律北京时间。

| 时间 | 结果 | 改了什么 | 内容与理由 | 来自提议 |
|---|---|---|---|---|
`

/**
 * 提议 id：`P-<yyyymmddTHHmmss>-<两位序号>`（同一秒内靠序号区分）。
 * @param {{id: string}[]} proposals
 * @param {number} ms
 * @returns {string}
 */
export function nextProposalId(proposals, ms) {
  const stamp = beijingStamp(ms)
  let max = 0
  for (const proposal of proposals ?? []) {
    const match = /^P-(\d{8}T\d{6})-(\d{2})$/.exec(String(proposal?.id ?? ''))
    if (match === null || match[1] !== stamp) continue
    const seq = Number.parseInt(match[2], 10)
    if (seq > max) max = seq
  }
  return `P-${stamp}-${String(max + 1).padStart(2, '0')}`
}

/**
 * 解析提议文件。
 * @param {string} text
 * @returns {{proposals: Array<{id: string, at: string, origin: string, content: string, reason: string, quote: string}>, bad: number}}
 */
export function parseProposals(text) {
  const proposals = []
  let bad = 0
  let current = null
  const flush = () => {
    if (current === null) return
    if (current.content === '' || current.reason === '') {
      bad += 1
      return
    }
    proposals.push(current)
  }
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trimEnd()
    const heading = PROPOSAL_HEADING.exec(line.trim())
    if (heading !== null) {
      flush()
      current = { id: heading[1], at: '', origin: '', content: '', reason: '', quote: '' }
      continue
    }
    if (current === null) continue
    const field = /^-\s*(时间|来自|内容|理由|触发)[:：]\s*(.*)$/.exec(line.trim())
    if (field === null) continue
    const value = field[2].trim()
    if (field[1] === '时间') current.at = value
    else if (field[1] === '来自') current.origin = value
    else if (field[1] === '内容') current.content = value
    else if (field[1] === '理由') current.reason = value
    else current.quote = value
  }
  flush()
  return { proposals, bad }
}

/**
 * 解析变更记录（坏行跳过）。
 * @param {string} text
 * @returns {{rows: Array<{at: string, verdict: string, target: string, summary: string, proposalId: string}>, bad: number}}
 */
export function parseChangelog(text) {
  const rows = []
  let bad = 0
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('|')) continue
    if (/^\|\s*-+/.test(line) || line.includes('来自提议')) continue
    const match = CHANGELOG_ROW.exec(line)
    if (match === null) {
      bad += 1
      continue
    }
    rows.push({ at: match[1], verdict: match[2], target: match[3], summary: match[4], proposalId: match[5] })
  }
  return { rows, bad }
}

/**
 * 还没审的提议 = 没在 changelog 里出现过的那些（按时间顺序）。
 * @param {object[]} proposals
 * @param {{proposalId: string}[]} rows
 * @returns {object[]}
 */
export function pendingProposals(proposals, rows) {
  const handled = new Set(rows.map((row) => row.proposalId))
  return proposals.filter((proposal) => !handled.has(proposal.id))
}

/**
 * 渲染一条提议块。
 * @param {{id: string, at: string, origin: string, content: string, reason: string, quote: string}} proposal
 * @returns {string}
 */
export function renderProposal(proposal) {
  const lines = [
    `## ${proposal.id}`,
    `- 时间：${proposal.at}`,
    `- 来自：${proposal.origin}`,
    `- 内容：${oneLine(proposal.content)}`,
    `- 理由：${oneLine(proposal.reason)}`,
  ]
  if (typeof proposal.quote === 'string' && proposal.quote.trim() !== '') lines.push(`- 触发：${oneLine(proposal.quote)}`)
  return `${lines.join('\n')}\n`
}

/**
 * 渲染一行变更记录。
 * @param {{at: string, verdict: '接受'|'拒绝', target: string, summary: string, proposalId: string}} row
 * @returns {string}
 */
export function renderChangelogRow({ at, verdict, target, summary, proposalId }) {
  return `| ${at} | ${verdict} | ${cell(target)} | ${cell(summary)} | ${cell(proposalId)} |\n`
}

/**
 * 追加一条提议（N5.1）。**只追加**；文件不存在就先写空壳。
 *
 * @param {object} options
 * @param {string} options.classroomDir
 * @param {number} options.now
 * @param {string} options.origin - `群聊 agent` / `日记 agent` / `课堂老师`
 * @param {string} options.content - 想加什么/改什么
 * @param {string} options.reason - 为什么
 * @param {string} [options.quote] - 触发它的对话片段
 * @returns {Promise<{id: string, path: string, bytes: number}>}
 */
export async function appendProposal({ classroomDir, now, origin, content, reason, quote = '' }) {
  const file = join(classroomDir, PROPOSALS_RELATIVE)
  return withFileLock(`${file}.lock`, async () => {
    const previous = (await exists(file)) ? await readFile(file, 'utf8') : PROPOSALS_HEADER
    const id = nextProposalId(parseProposals(previous).proposals, now)
    const block = renderProposal({ id, at: beijingDateTime(now), origin, content, reason, quote })
    const next = `${previous.replace(/\n*$/, '\n')}\n${block}`
    await writeFileAtomic(file, next)
    return { id, path: file, bytes: Buffer.byteLength(block, 'utf8') + 0 }
  })
}

/**
 * 追加一行变更记录（N5.2）。**只追加**。
 *
 * @param {object} options
 * @param {string} options.classroomDir
 * @param {number} options.now
 * @param {'接受'|'拒绝'} options.verdict
 * @param {string} [options.target] - 改动的文件（拒绝时写 `—`）
 * @param {string} options.summary - 改了什么/为什么
 * @param {string} options.proposalId
 */
export async function appendChangelogRow({ classroomDir, now, verdict, target = '—', summary, proposalId }) {
  const file = join(classroomDir, CHANGELOG_RELATIVE)
  return withFileLock(`${file}.lock`, async () => {
    const previous = (await exists(file)) ? await readFile(file, 'utf8') : CHANGELOG_HEADER
    const row = renderChangelogRow({ at: beijingDateTime(now), verdict, target, summary, proposalId })
    const next = previous.endsWith('\n') ? `${previous}${row}` : `${previous}\n${row}`
    await writeFileAtomic(file, next)
    return { path: file, bytes: Buffer.byteLength(row, 'utf8') }
  })
}

/**
 * 读两份文件（不存在当空）。
 * @param {string} classroomDir
 * @returns {Promise<{proposals: object[], rows: object[], pending: object[], badProposals: number, badRows: number}>}
 */
export async function readWorldLog(classroomDir) {
  const [proposalsText, changelogText] = await Promise.all([
    readFile(join(classroomDir, PROPOSALS_RELATIVE), 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') return ''
      throw error
    }),
    readFile(join(classroomDir, CHANGELOG_RELATIVE), 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') return ''
      throw error
    }),
  ])
  const parsed = parseProposals(proposalsText)
  const changelog = parseChangelog(changelogText)
  return {
    proposals: parsed.proposals,
    rows: changelog.rows,
    pending: pendingProposals(parsed.proposals, changelog.rows),
    badProposals: parsed.bad,
    badRows: changelog.bad,
  }
}

/** 一个字段必须在一行里（块结构靠换行解析）。 @param {string} text */
function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

/** 表格单元里的竖线必须转义，否则整行解析会错位。 @param {string} text */
function cell(text) {
  return oneLine(text).replace(/\|/g, '／')
}
