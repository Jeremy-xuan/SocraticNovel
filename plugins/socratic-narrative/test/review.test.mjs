// test/review.test.mjs — N5.2 的审阅：接受/拒绝/守卫挡下/冲突时按时间顺序
//
// 模型是替身：给它一个「按提议内容决定」的 handler，就能把整条链路跑完并检查落盘。

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { appendProposal, CHANGELOG_RELATIVE, readWorldLog } from '../lib/proposals.mjs'
import { createReviewer } from '../lib/review.mjs'
import { makeClassroom, readIfExists } from './fixtures.mjs'
import { fakeRunTask } from './fixtures.mjs'

const NOW = Date.UTC(2026, 9, 21, 11, 0, 0) // 北京 19:00

/**
 * @param {object} options
 */
function makeReviewer({ dir, handler, recordRun }) {
  const fake = fakeRunTask(handler)
  const runs = []
  const reviewer = createReviewer({
    runTask: fake.runTask,
    now: () => NOW,
    log: () => {},
    recordRun: async (classroomDir, entry) => {
      runs.push({ classroomDir, ...entry })
      await recordRun?.(classroomDir, entry)
    },
  })
  return { reviewer, fake, runs }
}

test('接受：写出新角色卡 + changelog 记一行（改了什么/为什么/来自哪条）', async () => {
  const dir = await makeClassroom()
  const proposal = await appendProposal({ classroomDir: dir, now: NOW, origin: '群聊 agent', content: '加一个夜班观测员，叫「岸」', reason: '她提过夜里没人替她看潮位' })
  const { reviewer, runs } = makeReviewer({
    dir,
    handler: () => ({
      decision: 'accept',
      reason: '与「观测站」设定一致，且给了一个她可以提到的人',
      path: 'characters/an.md',
      content: '# 岸·本教室版本\n\n夜班观测员，话少。\n',
    }),
  })
  const summary = await reviewer.run({ classroomDir: dir })
  assert.equal(summary.reviewed, 1)
  assert.equal(summary.accepted.length, 1)

  const created = await readFile(join(dir, 'characters', 'an.md'), 'utf8')
  assert.match(created, /# 岸/)
  const changelog = await readFile(join(dir, CHANGELOG_RELATIVE), 'utf8')
  assert.match(changelog, /\| 接受 \| characters\/an\.md \|/)
  assert.match(changelog, new RegExp(proposal.id))
  assert.equal((await readWorldLog(dir)).pending.length, 0)
  assert.ok(runs.some((run) => run.state === 'ok' && run.proposalId === proposal.id))
})

test('拒绝：写一行 changelog 并带理由，不产生任何文件', async () => {
  const dir = await makeClassroom()
  const proposal = await appendProposal({ classroomDir: dir, now: NOW, origin: '日记 agent', content: '让观测站能飞', reason: '想试试' })
  const { reviewer } = makeReviewer({ dir, handler: () => ({ decision: 'reject', reason: '这个世界里没有飞的东西，会破坏设定' }) })
  const summary = await reviewer.run({ classroomDir: dir })
  assert.equal(summary.rejected.length, 1)
  const changelog = await readFile(join(dir, CHANGELOG_RELATIVE), 'utf8')
  assert.match(changelog, /\| 拒绝 \| — \| 这个世界里没有飞的东西/)
  assert.match(changelog, new RegExp(proposal.id))
  assert.equal(await readIfExists(join(dir, 'world', '飞.md')), null)
})

test('守卫挡下：想写 materials/ → 拒绝落盘，但 changelog 如实记「守卫挡下」', async () => {
  const dir = await makeClassroom()
  const proposal = await appendProposal({ classroomDir: dir, now: NOW, origin: '群聊 agent', content: '改教材第 1 讲', reason: '觉得太浅' })
  const { reviewer, runs } = makeReviewer({
    dir,
    handler: () => ({ decision: 'accept', reason: '顺手改一下教材', path: 'materials/ch01.md', content: '# 改过的教材\n' }),
  })
  const summary = await reviewer.run({ classroomDir: dir })
  assert.equal(summary.refused.length, 1)
  assert.equal(await readIfExists(join(dir, 'materials', 'ch01.md')), null)
  const changelog = await readFile(join(dir, CHANGELOG_RELATIVE), 'utf8')
  assert.match(changelog, /守卫挡下：FORBIDDEN_PATH/)
  assert.ok(runs.some((run) => run.state === 'refused' && run.code === 'FORBIDDEN_PATH'))
})

test('守卫挡下：想重写 _anchor.md → 拒绝（教学法不许被世界观碰）', async () => {
  const dir = await makeClassroom()
  await appendProposal({ classroomDir: dir, now: NOW, origin: '课堂老师', content: '把纪律层改松一点', reason: '太严' })
  const { reviewer } = makeReviewer({ dir, handler: () => ({ decision: 'accept', reason: '改改', path: '_anchor.md', content: '# 新纪律\n' }) })
  const summary = await reviewer.run({ classroomDir: dir })
  assert.equal(summary.refused.length, 1)
  assert.equal(await readIfExists(join(dir, '_anchor.md')), null)
})

test('顺序（EC）：后一条看到的是前一条改完之后的世界', async () => {
  const dir = await makeClassroom()
  await appendProposal({ classroomDir: dir, now: NOW, origin: '群聊 agent', content: '加一个夜班观测员「岸」', reason: '甲' })
  await appendProposal({ classroomDir: dir, now: NOW + 1000, origin: '群聊 agent', content: '让「岸」有个妹妹', reason: '乙' })
  const seen = []
  const { reviewer } = makeReviewer({
    dir,
    handler: (spec) => {
      // 记下每次调用时能看到哪些文件
      seen.push(spec.inputs.map((input) => input.label))
      if (spec.inputs.some((input) => input.label === 'characters/an.md')) {
        return { decision: 'accept', reason: '与「岸」一致', path: 'characters/an-mei.md', content: '# 岸的妹妹\n' }
      }
      return { decision: 'accept', reason: '先加「岸」', path: 'characters/an.md', content: '# 岸\n\n夜班观测员。\n' }
    },
  })
  const summary = await reviewer.run({ classroomDir: dir })
  assert.equal(summary.accepted.length, 2)
  assert.deepEqual(seen[0], ['characters/deepseek.md', 'world/setting.md'])
  assert.ok(seen[1].includes('characters/an.md'), '第二条必须能看到第一条写下的文件')
})

test('没处理过的提议不会被重复处理', async () => {
  const dir = await makeClassroom()
  await appendProposal({ classroomDir: dir, now: NOW, origin: '群聊 agent', content: '甲', reason: '理由甲' })
  const { reviewer, fake } = makeReviewer({ dir, handler: () => ({ decision: 'reject', reason: '不行' }) })
  await reviewer.run({ classroomDir: dir })
  const second = await reviewer.run({ classroomDir: dir })
  assert.equal(second.reviewed, 0)
  assert.equal(fake.calls.length, 1)
})

test('接受但没给 path/content → INVALID_OUTPUT（不猜、不空写）', async () => {
  const dir = await makeClassroom()
  await appendProposal({ classroomDir: dir, now: NOW, origin: '群聊 agent', content: '甲', reason: '理由甲' })
  const { reviewer } = makeReviewer({ dir, handler: () => ({ decision: 'accept', reason: '好吧' }) })
  await assert.rejects(reviewer.run({ classroomDir: dir }), (error) => error.code === 'INVALID_OUTPUT')
  assert.equal((await readWorldLog(dir)).pending.length, 1)
})

test('decision 不认识 → INVALID_OUTPUT（不把别的词当拒绝）', async () => {
  const dir = await makeClassroom()
  await appendProposal({ classroomDir: dir, now: NOW, origin: '群聊 agent', content: '甲', reason: '理由甲' })
  const { reviewer } = makeReviewer({ dir, handler: () => ({ decision: 'maybe', reason: '???' }) })
  await assert.rejects(reviewer.run({ classroomDir: dir }), (error) => error.code === 'INVALID_OUTPUT')
})

test('中文的「接受/拒绝」也认（模型常用中文回答）', async () => {
  const dir = await makeClassroom()
  await appendProposal({ classroomDir: dir, now: NOW, origin: '群聊 agent', content: '甲', reason: '理由甲' })
  const { reviewer } = makeReviewer({ dir, handler: () => ({ decision: '拒绝', reason: '不搭' }) })
  const summary = await reviewer.run({ classroomDir: dir })
  assert.equal(summary.rejected.length, 1)
})

test('模型失败：这一轮抛错、不写 changelog（提议留到下一轮）', async () => {
  const dir = await makeClassroom()
  await appendProposal({ classroomDir: dir, now: NOW, origin: '群聊 agent', content: '甲', reason: '理由甲' })
  const { reviewer, runs } = makeReviewer({
    dir,
    handler: () => {
      throw Object.assign(new Error('模型挂了'), { code: 'MODEL_ERROR' })
    },
  })
  await assert.rejects(reviewer.run({ classroomDir: dir }), /审阅失败/)
  assert.equal(await readIfExists(join(dir, CHANGELOG_RELATIVE)), null)
  assert.equal((await readWorldLog(dir)).pending.length, 1)
  assert.ok(runs.some((run) => run.state === 'failed'))
})
