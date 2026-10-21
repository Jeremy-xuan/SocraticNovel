// test/proposals.test.mjs — N5.1 的提议与 N5.2 的变更记录（两份都只追加）
//
// 关键语义：「待审」是**推导**出来的（提议 id 没出现在 changelog 里），不是写进提议块的状态位。

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  appendChangelogRow,
  appendProposal,
  CHANGELOG_RELATIVE,
  CHANGELOG_HEADER,
  nextProposalId,
  parseChangelog,
  parseProposals,
  pendingProposals,
  PROPOSALS_HEADER,
  PROPOSALS_RELATIVE,
  readWorldLog,
  renderChangelogRow,
  renderProposal,
} from '../lib/proposals.mjs'
import { makeClassroom, readIfExists } from './fixtures.mjs'

const NOW = Date.UTC(2026, 9, 21, 10, 15, 0) // 北京 18:15

test('提议：追加一条就出现在文件里，id 是 P-<时间戳>-<两位序号>', async () => {
  const dir = await makeClassroom()
  const first = await appendProposal({ classroomDir: dir, now: NOW, origin: '群聊 agent', content: '加一个夜班观测员', reason: '她提过夜里没人替她看潮位', quote: '你晚上一个人不害怕吗' })
  assert.match(first.id, /^P-\d{8}T\d{6}-\d{2}$/)
  assert.equal(first.id, 'P-20261021T181500-01')
  const text = await readFile(join(dir, PROPOSALS_RELATIVE), 'utf8')
  assert.match(text, /## P-20261021T181500-01/)
  assert.match(text, /- 来自：群聊 agent/)
  assert.match(text, /- 触发：你晚上一个人不害怕吗/)
  const parsed = parseProposals(text)
  assert.equal(parsed.proposals.length, 1)
  assert.equal(parsed.proposals[0].content, '加一个夜班观测员')
})

test('提议：同一秒内两条靠序号区分', async () => {
  const dir = await makeClassroom()
  const first = await appendProposal({ classroomDir: dir, now: NOW, origin: '日记 agent', content: '甲', reason: '理由甲' })
  const second = await appendProposal({ classroomDir: dir, now: NOW, origin: '日记 agent', content: '乙', reason: '理由乙' })
  assert.equal(first.id, 'P-20261021T181500-01')
  assert.equal(second.id, 'P-20261021T181500-02')
  assert.equal(parseProposals(await readFile(join(dir, PROPOSALS_RELATIVE), 'utf8')).proposals.length, 2)
})

test('提议：文件不存在时先写空壳（含「只追加」的说明）', async () => {
  const dir = await makeClassroom()
  await appendProposal({ classroomDir: dir, now: NOW, origin: '课堂老师', content: '甲', reason: '乙' })
  const text = await readFile(join(dir, PROPOSALS_RELATIVE), 'utf8')
  assert.ok(text.startsWith('# 世界观提议'))
  assert.match(text, /只追加/)
})

test('待审 = 没出现在 changelog 里的提议（推导，不靠状态位）', async () => {
  const dir = await makeClassroom()
  const first = await appendProposal({ classroomDir: dir, now: NOW, origin: '群聊 agent', content: '甲', reason: '理由甲' })
  await appendProposal({ classroomDir: dir, now: NOW + 1000, origin: '群聊 agent', content: '乙', reason: '理由乙' })
  await appendChangelogRow({ classroomDir: dir, now: NOW + 2000, verdict: '拒绝', target: '—', summary: '和已有设定冲突', proposalId: first.id })
  const world = await readWorldLog(dir)
  assert.equal(world.proposals.length, 2)
  assert.equal(world.rows.length, 1)
  assert.deepEqual(
    world.pending.map((proposal) => proposal.content),
    ['乙'],
  )
})

test('pendingProposals：只按 id 匹配，不被正文里的 id 串扰', () => {
  const proposals = [{ id: 'P-20261021T181500-01' }, { id: 'P-20261021T181500-02' }]
  const rows = [{ proposalId: 'P-20261021T181500-02' }]
  assert.deepEqual(pendingProposals(proposals, rows), [proposals[0]])
})

test('changelog：一行一次决定，坏行跳过', async () => {
  const dir = await makeClassroom()
  await appendChangelogRow({ classroomDir: dir, now: NOW, verdict: '接受', target: 'characters/an.md', summary: '新增角色「岸」：夜班观测员。', proposalId: 'P-20261021T181500-01' })
  await appendChangelogRow({ classroomDir: dir, now: NOW + 60_000, verdict: '拒绝', target: '—', summary: '太怪了', proposalId: 'P-20261021T181500-02' })
  const text = await readFile(join(dir, CHANGELOG_RELATIVE), 'utf8')
  assert.ok(text.startsWith('# 世界观变更记录'))
  const parsed = parseChangelog(`${text}\n| 坏行 |\n`)
  assert.equal(parsed.rows.length, 2)
  assert.equal(parsed.bad, 1)
  assert.equal(parsed.rows[0].verdict, '接受')
  assert.equal(parsed.rows[0].target, 'characters/an.md')
  assert.equal(parsed.rows[1].verdict, '拒绝')
})

test('渲染：表格单元里的竖线被换掉（否则整行解析会错位）', () => {
  const row = renderChangelogRow({ at: '2026-10-21 18:15', verdict: '拒绝', target: '—', summary: '理由里有 | 竖线', proposalId: 'P-1' })
  assert.equal(parseChangelog(`| 时间 | 结果 | 改了什么 | 内容与理由 | 来自提议 |\n|---|---|---|---|---|\n${row}`).rows.length, 1)
})

test('渲染：提议块里的换行被压成一行（块结构靠换行解析）', () => {
  const block = renderProposal({ id: 'P-20261021T181500-01', at: '2026-10-21 18:15', origin: '群聊 agent', content: '第一行\n第二行', reason: '理由' })
  assert.equal(block.split('\n').filter((line) => line.startsWith('- 内容：')).length, 1)
  assert.match(block, /- 内容：第一行 第二行/)
})

test('nextProposalId：不同秒各自从 01 起', () => {
  assert.equal(nextProposalId([], NOW), 'P-20261021T181500-01')
  assert.equal(nextProposalId([{ id: 'P-20261021T181500-01' }, { id: 'P-20261021T181500-03' }], NOW), 'P-20261021T181500-04')
  assert.equal(nextProposalId([{ id: 'P-20261021T181500-01' }], NOW + 1000), 'P-20261021T181501-01')
})

test('两份文件缺失时 readWorldLog 当空处理（不抛）', async () => {
  const dir = await makeClassroom()
  const world = await readWorldLog(dir)
  assert.deepEqual(world.proposals, [])
  assert.deepEqual(world.pending, [])
  assert.equal(await readIfExists(join(dir, PROPOSALS_RELATIVE)), null)
  assert.ok(CHANGELOG_HEADER.startsWith('# 世界观变更记录'))
  assert.ok(PROPOSALS_HEADER.startsWith('# 世界观提议'))
})
