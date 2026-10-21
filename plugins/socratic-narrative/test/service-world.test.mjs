// test/service-world.test.mjs — N5.2 的接线：**跑日记的那一轮顺带审阅提议**
//
// 这一组测的是服务层，不是审阅器本身：
//   · 日记写成功之后，积压的提议被处理（同一轮，不另起调度）
//   · 日记 agent 自己也能提一条（N5.1）
//   · 审阅失败不吞：日记仍然 ok，但结果里 review.ok=false，且 status() 里有失败记录

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { createNarrativeService } from '../index.mjs'
import { DIARY_RELATIVE } from '../lib/diary.mjs'
import { appendProposal, CHANGELOG_RELATIVE, PROPOSALS_RELATIVE } from '../lib/proposals.mjs'
import { fakeInstanceModel, fakeLlm } from './fake-llm.mjs'
import { makeClassroom } from './fixtures.mjs'

const DIARY_HEADER = `# 日记（她的）

> **写法规则**：第一人称、短、不解释。

---

`

const NOW = Date.UTC(2026, 9, 21, 11, 0, 0)

/** @param {object} options */
function makeService({ dir, handler, config = {} }) {
  let step = 0
  const llm = {
    calls: [],
    stream(options) {
      this.calls.push(options)
      const body = String(options.messages?.[0]?.content?.[0]?.text ?? '')
      const isReview = body.includes('提议 P-') || body.includes('你决定接受还是拒绝')
      const text = isReview ? handler({ step: step++, body }) : JSON.stringify({ text: '记录板下沿干了一道白边。' })
      return (async function* stream() {
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const service = createNarrativeService({ llm: () => llm, instanceModel: fakeInstanceModel(), config, now: () => NOW, log: () => {} })
  return { service, llm }
}

test('日记那一轮顺带审阅：积压的提议被接受并写进 characters/', async () => {
  const dir = await makeClassroom({ [DIARY_RELATIVE]: DIARY_HEADER })
  const proposal = await appendProposal({ classroomDir: dir, now: NOW, origin: '群聊 agent', content: '加一个夜班观测员「岸」', reason: '她提过夜里没人' })
  const { service } = makeService({
    dir,
    handler: () => JSON.stringify({ decision: 'accept', reason: '与观测站设定一致', path: 'characters/an.md', content: '# 岸\n\n夜班观测员。\n' }),
  })
  const outcome = await service.runDiary({ sessionId: 's-1', classroomDir: dir, lesson: 1 }).done
  assert.equal(outcome.ok, true)
  assert.equal(outcome.review.ok, true)
  assert.equal(outcome.review.reviewed, 1)
  assert.equal(outcome.review.accepted.length, 1)
  const created = await readFile(join(dir, 'characters', 'an.md'), 'utf8')
  assert.match(created, /# 岸/)
  const changelog = await readFile(join(dir, CHANGELOG_RELATIVE), 'utf8')
  assert.match(changelog, new RegExp(proposal.id))
  // 日记本身也写好了
  assert.match(await readFile(join(dir, DIARY_RELATIVE), 'utf8'), /记录板下沿干了一道白边/)
})

test('日记 agent 自己也能提一条（N5.1）：两个字段一起给才落盘', async () => {
  const dir = await makeClassroom({ [DIARY_RELATIVE]: DIARY_HEADER })
  const llm = {
    calls: [],
    stream(options) {
      this.calls.push(options)
      return (async function* stream() {
        yield { type: 'text-delta', index: 0, text: JSON.stringify({ text: '今天板上多了一道白边。', proposal_content: '加一个修板的木匠', proposal_reason: '板子老是卡' }) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const service = createNarrativeService({ llm: () => llm, instanceModel: fakeInstanceModel(), config: {}, now: () => NOW, log: () => {} })
  const outcome = await service.runDiary({ sessionId: 's-2', classroomDir: dir, lesson: 1 }).done
  assert.equal(outcome.ok, true)
  const proposals = await readFile(join(dir, PROPOSALS_RELATIVE), 'utf8')
  assert.match(proposals, /加一个修板的木匠/)
  assert.match(proposals, /- 来自：日记 agent/)
})

test('只有 content 没有 reason：当没提，不落盘（不写半条提议）', async () => {
  const dir = await makeClassroom({ [DIARY_RELATIVE]: DIARY_HEADER })
  const llm = {
    calls: [],
    stream() {
      return (async function* stream() {
        yield { type: 'text-delta', index: 0, text: JSON.stringify({ text: '今天没什么。', proposal_content: '只想了一半' }) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const service = createNarrativeService({ llm: () => llm, instanceModel: fakeInstanceModel(), config: {}, now: () => NOW, log: () => {} })
  const outcome = await service.runDiary({ sessionId: 's-3', classroomDir: dir, lesson: 1 }).done
  assert.equal(outcome.ok, true)
  await assert.rejects(readFile(join(dir, PROPOSALS_RELATIVE), 'utf8'), (error) => error.code === 'ENOENT')
})

test('审阅失败不吞：日记仍 ok，但 review.ok=false 且 status 里有 review 的失败', async () => {
  const dir = await makeClassroom({ [DIARY_RELATIVE]: DIARY_HEADER })
  await appendProposal({ classroomDir: dir, now: NOW, origin: '群聊 agent', content: '甲', reason: '理由甲' })
  const { service } = makeService({
    dir,
    handler: () => {
      throw new Error('审阅这次挂了')
    },
  })
  const outcome = await service.runDiary({ sessionId: 's-4', classroomDir: dir, lesson: 1 }).done
  assert.equal(outcome.ok, true)
  assert.equal(outcome.review.ok, false)
  assert.equal(outcome.review.error.code, 'MODEL_ERROR')
  const status = service.status()
  assert.equal(status.ok, false)
  assert.equal(status.lastError.task, 'review')
})

test('没有积压提议就不开审阅这一轮（日志里不留噪音）', async () => {
  const dir = await makeClassroom({ [DIARY_RELATIVE]: DIARY_HEADER })
  const llm = fakeLlm({ text: '{"text":"今天没别的事。"}' })
  const service = createNarrativeService({ llm: () => llm, instanceModel: fakeInstanceModel(), config: {}, now: () => NOW, log: () => {} })
  const outcome = await service.runDiary({ sessionId: 's-5', classroomDir: dir, lesson: 1 }).done
  assert.equal(outcome.review.reviewed, 0)
  const lines = (await readFile(await service.runLogPath(dir), 'utf8')).trim().split('\n')
  assert.equal(lines.length, 1)
})

test('appendProposal / readWorldLog 从服务层也能用（课堂老师接线用）', async () => {
  const dir = await makeClassroom()
  const { service } = makeService({ dir, handler: () => '{}' })
  const proposal = await service.appendProposal({ classroomDir: dir, origin: '课堂老师', content: '他今天一直在问海底', reason: '也许该多一个能下水的人', quote: '海底到底有什么' })
  assert.match(proposal.id, /^P-/)
  const world = await service.readWorldLog(dir)
  assert.equal(world.pending.length, 1)
  assert.equal(world.pending[0].origin, '课堂老师')
})
