// test/groupservice.test.mjs — K4.3 的四个方法 + N3.4 的节奏 + N3.5 的双向互通
//
// 模型是替身（`fakeRunTask`），时钟是假的（`fakeClock`，固定在北京 03:00 → 定时消息天然不参与），
// 教室在临时目录。测的是「引擎/面板调我之后能观察到什么」。

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { ClassroomGroupService, isClassInProgress, unreadOf } from '../lib/groupservice.mjs'
import { GROUP_RELATIVE } from '../lib/groupstore.mjs'
import { fakeClock, fakeRunTask, makeClassroom, readIfExists } from './fixtures.mjs'

// 北京 2026-10-21 03:00（在 08:00–23:00 之外：定时主动消息不会掺进来）
const NIGHT = Date.UTC(2026, 9, 20, 19, 0, 0)

const SCOPE = { sessionId: 's-1', workspaceRoot: '/tmp/whatever' }

/** 只看群聊自己的动作（`proactive:` 前缀是 N4 定时消息的动作，另有专门的测试）。 */
function groupActions(results) {
  return results.flatMap((result) => result.actions).filter((action) => !action.startsWith('proactive:'))
}

/** @param {object} options */
function makeService({ dir, handler, clock = fakeClock(NIGHT), replyDelay = 0 }) {
  const fake = fakeRunTask(handler ?? (() => ({ speaker: '鲸', text: '在。' })))
  const runs = []
  const service = new ClassroomGroupService({
    runTask: fake.runTask,
    now: clock.now,
    rng: () => 0,
    classroomDir: dir,
    tickMs: 0,
    replyDelayMinMs: replyDelay,
    replyDelayMaxMs: replyDelay,
    log: () => {},
    recordRun: async (classroomDir, entry) => {
      runs.push({ classroomDir, ...entry })
    },
  })
  return { service, fake, clock, runs }
}

test('history：空群 → 空列表、nextSeq=1、未读 0；limit 被收敛到 1..200', async () => {
  const dir = await makeClassroom()
  const { service } = makeService({ dir, handler: () => ({ speaker: '鲸', text: '嗯。' }) })
  const empty = await service.history(SCOPE)
  assert.deepEqual(empty, { messages: [], nextSeq: 1, unread: 0 })
  for (let index = 0; index < 3; index += 1) await service.send(SCOPE, `第 ${index} 条`, `c-${index}`)
  assert.equal((await service.history(SCOPE, 2)).messages.length, 2)
  assert.equal((await service.history(SCOPE, 999)).messages.length, 3)
  assert.equal((await service.history(SCOPE, 0)).messages.length, 1)
})

test('send：落盘立刻返回（不等模型），并把这批排进回复队列（typing=true）', async () => {
  const dir = await makeClassroom()
  const { service, fake } = makeService({ dir, handler: () => ({ speaker: '鲸', text: '在。' }), replyDelay: 10_000 })
  const clock = fakeClock(NIGHT)
  service.now = clock.now
  const result = await service.send(SCOPE, '在吗', 'c-1')
  assert.equal(result.ok, true)
  assert.equal(result.message.role, 'student')
  assert.equal(result.message.speaker, '你')
  assert.equal(fake.calls.length, 0)
  const state = await service.status()
  assert.equal(state[0].typing, true)
  assert.equal(state[0].messages, 1)
})

test('send：空消息 → EMPTY；超长 → TOO_LONG（按 Unicode 码点算）', async () => {
  const dir = await makeClassroom()
  const { service } = makeService({ dir })
  assert.deepEqual((await service.send(SCOPE, '   ', 'c-1')).error.code, 'EMPTY')
  assert.deepEqual((await service.send(SCOPE, '', 'c-2')).error.code, 'EMPTY')
  const tooLong = await service.send(SCOPE, '字'.repeat(2001), 'c-3')
  assert.equal(tooLong.error.code, 'TOO_LONG')
  // 2000 个代理对字符（码点 2000）应当放行
  const surrogatePairs = '𠮷'.repeat(2000)
  assert.equal((await service.send(SCOPE, surrogatePairs, 'c-4')).ok, true)
})

test('send：同一个 clientId 重发只落一条（重试不重复写入）', async () => {
  const dir = await makeClassroom()
  const { service } = makeService({ dir })
  const first = await service.send(SCOPE, '在吗', 'c-same')
  const again = await service.send(SCOPE, '在吗', 'c-same')
  assert.equal(first.message.seq, again.message.seq)
  assert.equal((await service.history(SCOPE)).messages.length, 1)
})

test('send：真源里有坏行 → STORE_CORRUPT（不猜 seq，不继续追加）', async () => {
  const dir = await makeClassroom({ [GROUP_RELATIVE]: '{坏行\n' })
  const { service } = makeService({ dir })
  const result = await service.send(SCOPE, '在吗', 'c-1')
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'STORE_CORRUPT')
})

test('send：一分钟内发太多 → RATE_LIMITED', async () => {
  const dir = await makeClassroom()
  const { service } = makeService({ dir })
  for (let index = 0; index < 30; index += 1) assert.equal((await service.send(SCOPE, `第 ${index} 条`, `c-${index}`)).ok, true)
  assert.equal((await service.send(SCOPE, '第 31 条', 'c-30')).error.code, 'RATE_LIMITED')
})

test('两个请求并发发言：一条都不丢', async () => {
  const dir = await makeClassroom()
  const { service } = makeService({ dir })
  const results = await Promise.all([service.send(SCOPE, '第一条', 'c-a'), service.send(SCOPE, '第二条', 'c-b')])
  assert.ok(results.every((result) => result.ok === true))
  const history = await service.history(SCOPE)
  assert.deepEqual(
    history.messages.map((message) => message.text),
    ['第一条', '第二条'],
  )
})

test('tick：到点回一条；学生连发两条只回一次（服务端去抖合并）', async () => {
  const dir = await makeClassroom()
  const { service, fake, clock } = makeService({ dir, handler: () => ({ speaker: '鲸', text: '在。' }), replyDelay: 10_000 })
  await service.send(SCOPE, '在吗', 'c-1')
  await service.send(SCOPE, '今天讲什么', 'c-2')
  // 还没到点
  await service.tick(NIGHT + 5_000)
  assert.equal(fake.calls.length, 0)
  // 到点（第二条把 dueAt 重新推后了 10s，从第二条算）
  await service.tick(NIGHT + 10_001)
  assert.equal(fake.calls.length, 1)
  assert.match(fake.calls[0].prompt, /一连说了 2 句/)
  const history = await service.history(SCOPE)
  assert.equal(history.messages.length, 3)
  assert.equal(history.messages.at(-1).role, 'character')
  assert.equal(history.messages.at(-1).text, '在。')
  // 只回一次：再 tick 不会重复
  await service.tick(NIGHT + 60_000)
  assert.equal(fake.calls.length, 1)
})

test('tick：课堂进行中不回群；相位切到 close 后补回（N3.4）', async () => {
  const dir = await makeClassroom()
  const { service, fake } = makeService({ dir, handler: () => ({ speaker: '鲸', text: '下课了。' }), replyDelay: 0 })
  service.setClassroomActivity({ sessionId: SCOPE.sessionId, classroomDir: dir, phase: 'probe', lastActivityAt: NIGHT, lesson: 1 })
  await service.send(SCOPE, '在吗', 'c-1')
  assert.deepEqual(groupActions(await service.tick(NIGHT + 1_000)), ['reply:deferred'])
  assert.equal(fake.calls.length, 0)
  // 收课：相位 close
  service.setClassroomActivity({ sessionId: SCOPE.sessionId, classroomDir: dir, phase: 'close', lastActivityAt: NIGHT + 2_000, lesson: 1 })
  assert.deepEqual(groupActions(await service.tick(NIGHT + 3_000)), ['reply:sent'])
  assert.equal((await service.history(SCOPE)).messages.at(-1).text, '下课了。')
})

test('isClassInProgress：相位 close / 没有活动时间 / 超过 30 分钟都不算上课', () => {
  const now = NIGHT
  assert.equal(isClassInProgress({ phase: 'probe', lastActivityAt: now }, now), true)
  assert.equal(isClassInProgress({ phase: 'close', lastActivityAt: now }, now), false)
  assert.equal(isClassInProgress({ phase: null, lastActivityAt: now }, now), false)
  assert.equal(isClassInProgress({ phase: 'probe', lastActivityAt: null }, now), false)
  assert.equal(isClassInProgress({ phase: 'probe', lastActivityAt: now - 30 * 60 * 1000 - 1 }, now), false)
})

test('首次开场（N3.7）：真源为空 → 先发一条 kind=open 的消息', async () => {
  const dir = await makeClassroom()
  const { service, fake } = makeService({ dir, handler: () => ({ speaker: '鲸', text: '群里就我们两个。' }) })
  assert.deepEqual(groupActions(await service.tick(NIGHT)), ['open:sent'])
  const history = await service.history(SCOPE)
  assert.equal(history.messages.length, 1)
  assert.equal(history.messages[0].kind, 'open')
  assert.equal(history.messages[0].role, 'character')
  assert.match(fake.calls[0].prompt, /第一条消息/)
})

test('首次开场失败：记日志、重试上限 2 次后不再纠缠', async () => {
  const dir = await makeClassroom()
  const { service, runs } = makeService({
    dir,
    handler: () => {
      throw Object.assign(new Error('模型挂了'), { code: 'MODEL_ERROR' })
    },
  })
  assert.deepEqual(groupActions(await service.tick(NIGHT)), ['open:failed'])
  assert.deepEqual(groupActions(await service.tick(NIGHT)), ['open:failed'])
  assert.deepEqual(groupActions(await service.tick(NIGHT)), [])
  assert.ok(runs.some((run) => run.state === 'failed' && run.kind === 'open'))
  assert.equal((await service.history(SCOPE)).messages.length, 0)
})

test('回复失败：重试一次；仍失败就发一条 system 说明，并把错误留在日志与状态里', async () => {
  const dir = await makeClassroom()
  let attempt = 0
  const { service, runs } = makeService({
    dir,
    replyDelay: 0,
    handler: (spec) => {
      if (spec.task === 'group' && attempt++ >= 0) throw Object.assign(new Error('这轮失败'), { code: 'MODEL_ERROR' })
      return { speaker: '鲸', text: '嗯。' }
    },
  })
  // 开场那一步就会失败：先让它过去（两次失败后用尽）
  await service.tick(NIGHT)
  await service.tick(NIGHT)
  const result = await service.send(SCOPE, '在吗', 'c-1')
  assert.equal(result.ok, true)
  assert.deepEqual(groupActions(await service.tick(NIGHT + 1)).filter((action) => action.startsWith('reply')), ['reply:retry'])
  assert.ok(groupActions(await service.tick(NIGHT + 3_000)).includes('reply:failed'))
  const history = await service.history(SCOPE)
  assert.equal(history.messages.at(-1).role, 'system')
  assert.match(history.messages.at(-1).text, /卡住/)
  const status = await service.status()
  assert.ok(status[0].lastReplyError !== null)
  assert.ok(runs.filter((run) => run.kind === 'reply' && run.state === 'failed').length >= 2)
})

test('群里问知识题：写一条 group_question 进 notes.jsonl，并把 kp 核对到真实存在', async () => {
  const dir = await makeClassroom()
  const { service } = makeService({
    dir,
    replyDelay: 0,
    handler: (spec) => {
      if (spec.task !== 'group') return { speaker: '鲸', text: '嗯。' }
      return { speaker: '鲸', text: '这个课上讲。', knowledge_question: true, kp: 'KP-1.1', question: '页表是不是缓存' }
    },
  })
  await service.send(SCOPE, '页表是不是缓存', 'c-1')
  await service.tick(NIGHT + 1)
  const notes = (await readIfExists(join(dir, 'runtime', 'notes.jsonl'))) ?? ''
  const records = notes.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  assert.equal(records.length, 1)
  const record = records[0]
  assert.equal(record.type, 'group_question')
  assert.equal(record.origin, 'group_agent')
  assert.equal(record.kp, 'KP-1.1')
  assert.equal(record.quote, '页表是不是缓存')
  assert.equal(record.session, 'unknown')
  assert.equal('resolved' in record, false)
  assert.match(record.id, /^N-\d{8}T\d{6}-\d{3}$/)
})

test('群里问知识题：kp 写了不存在的编号 → 落盘写 null（不写假编号）', async () => {
  const dir = await makeClassroom()
  const { service } = makeService({
    dir,
    replyDelay: 0,
    handler: () => ({ speaker: '鲸', text: '课上讲。', knowledge_question: true, kp: 'KP-9.9' }),
  })
  await service.send(SCOPE, '这个 KP 是什么', 'c-1')
  await service.tick(NIGHT + 1)
  const record = JSON.parse(((await readIfExists(join(dir, 'runtime', 'notes.jsonl'))) ?? '').trim())
  assert.equal(record.kp, null)
})

test('提议：群聊 agent 顺手提的世界观提议写进 world/proposals.md（N5.1）', async () => {
  const dir = await makeClassroom()
  const proposals = []
  const { service } = makeService({
    dir,
    replyDelay: 0,
    handler: () => ({ speaker: '鲸', text: '夜里其实挺静的。', proposal_content: '加一个夜班观测员', proposal_reason: '她提过夜里没人替她看潮位' }),
  })
  service.appendProposal = async (input) => {
    proposals.push(input)
    return { id: 'P-20261021T030000-01', path: 'world/proposals.md', bytes: 10 }
  }
  await service.send(SCOPE, '你晚上一个人不害怕吗', 'c-1')
  await service.tick(NIGHT + 1)
  assert.equal(proposals.length, 1)
  assert.equal(proposals[0].origin, '群聊 agent')
  assert.equal(proposals[0].content, '加一个夜班观测员')
  assert.equal(proposals[0].quote, '你晚上一个人不害怕吗')
})

test('poll：只回 afterSeq 之后的消息；waitMs=0 立刻返回且形状固定', async () => {
  const dir = await makeClassroom()
  const { service } = makeService({ dir })
  await service.send(SCOPE, '在吗', 'c-1')
  const first = await service.poll(SCOPE, 0, 0)
  assert.equal(first.messages.length, 1)
  assert.equal(first.nextSeq, 2)
  assert.equal(first.typing, true)
  assert.equal(typeof first.serverTime, 'number')
  const second = await service.poll(SCOPE, 1, 0)
  assert.deepEqual(second.messages, [])
  assert.equal(second.nextSeq, 2)
})

test('markRead：未读归零；游标只前进不回退', async () => {
  const dir = await makeClassroom()
  const { service } = makeService({ dir })
  await service.send(SCOPE, '一', 'c-1')
  await service.send(SCOPE, '二', 'c-2')
  assert.equal(unreadOf((await service.history(SCOPE)).messages, 0), 2)
  assert.deepEqual(await service.markRead(SCOPE, 2), { unread: 0 })
  assert.deepEqual(await service.markRead(SCOPE, 1), { unread: 0 })
  await service.send(SCOPE, '三', 'c-3')
  assert.equal((await service.history(SCOPE)).unread, 1)
})

test('作用域 → 教室目录：显式配置优先；工作区里没有教室就报 NO_CLASSROOM', async () => {
  const dir = await makeClassroom()
  const { service } = makeService({ dir })
  // 显式配置了 classroomDir → 不看 scope
  assert.equal((await service.history({ sessionId: 'x', workspaceRoot: '/tmp/nope' })).messages.length, 0)
  // 没配置时按 scope 解析
  const bare = new ClassroomGroupService({ runTask: async () => ({ value: {} }), classroomDir: null, tickMs: 0, now: () => NIGHT, log: () => {} })
  await assert.rejects(bare.history({ sessionId: 'y', workspaceRoot: '/tmp/definitely-nope' }), /找不到教室/)
})

test('作用域 → 教室目录：引擎报过 classroomDir 就按会话走（不再解析工作区）', async () => {
  const dir = await makeClassroom()
  const service = new ClassroomGroupService({ runTask: async () => ({ value: {} }), classroomDir: null, tickMs: 0, now: () => NIGHT, log: () => {} })
  service.setClassroomActivity({ sessionId: 'sess-x', classroomDir: dir, phase: 'close', lastActivityAt: NIGHT, lesson: 1 })
  const history = await service.history({ sessionId: 'sess-x', workspaceRoot: '/tmp/nope' })
  assert.deepEqual(history.messages, [])
})

test('运行日志：成功/失败都进 recordRun（与日记同一份 agent-runs.jsonl）', async () => {
  const dir = await makeClassroom()
  const { service, runs } = makeService({ dir, replyDelay: 0, handler: () => ({ speaker: '鲸', text: '在。' }) })
  await service.tick(NIGHT) // 开场
  await service.send(SCOPE, '在吗', 'c-1')
  await service.tick(NIGHT + 1)
  assert.ok(runs.some((run) => run.kind === 'open' && run.state === 'ok'))
  assert.ok(runs.some((run) => run.kind === 'reply' && run.state === 'ok'))
  assert.ok(runs.every((run) => run.classroomDir === dir))
})
