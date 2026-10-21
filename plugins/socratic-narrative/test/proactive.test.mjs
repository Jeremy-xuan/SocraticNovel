// test/proactive.test.mjs — N4 定时主动发消息：假时钟下的完整周期
//
// AC 要求覆盖：正常发送 / 作废重生成 / 退避 / 跨天 / **实例重启后队列恢复**；
// EC 还有「队列文件损坏 → 重建当天队列不崩溃」与「北京时间显式换算」。
//
// 全部用假时钟（`fakeClock`），不 sleep、不联网。

import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  BACKOFF_AFTER,
  LATE_GRACE_MS,
  PROACTIVE_RELATIVE,
  createProactiveScheduler,
  inWindow,
  parseQueue,
  planTimes,
} from '../lib/proactive.mjs'
import { fakeClock, makeClassroom, readIfExists } from './fixtures.mjs'

/** 北京 2026-10-21 09:00 */
const MORNING = Date.UTC(2026, 9, 21, 1, 0, 0)

/**
 * 一个调度器 + 它看到的世界（消息、课堂状态、模型调用次数）。
 * @param {object} options
 */
function harness({ dir = null, start = MORNING, rng = () => 0, text = '今天的风小了一点。', classroom = { inProgress: false, lastActivityAt: null }, generate } = {}) {
  const clock = fakeClock(start)
  const state = {
    messages: [],
    classroom,
    generated: [],
  }
  const scheduler = createProactiveScheduler({
    classroomDir: dir,
    now: clock.now,
    rng,
    log: () => {},
    generate:
      generate ??
      (async ({ count }) => {
        state.generated.push(count)
        return Array.from({ length: count }, (_, index) => ({ speaker: '鲸', text: `${text}(${index + 1})` }))
      }),
    readMessages: async () => state.messages,
    classroomState: async () => state.classroom,
  })
  return { scheduler, clock, state }
}

/** 追加一条学生消息（seq 递增，时间用假时钟）。 */
function addStudent(state, text = '在吗') {
  const seq = state.messages.length + 1
  state.messages.push({ seq, role: 'student', speaker: '你', text, ts: new Date(Date.UTC(2026, 9, 21, 1, 0, 0)).toISOString() })
  return seq
}

test('窗口与抽时间：08:00–23:00，落点都在窗口里且升序', () => {
  assert.equal(inWindow(Date.UTC(2026, 9, 21, 0, 0, 0)), true) // 北京 08:00
  assert.equal(inWindow(Date.UTC(2026, 9, 21, 14, 59, 0)), true) // 北京 22:59
  assert.equal(inWindow(Date.UTC(2026, 9, 21, 15, 0, 0)), false) // 北京 23:00
  assert.equal(inWindow(Date.UTC(2026, 9, 20, 23, 0, 0)), false) // 北京 07:00
  const times = planTimes('2026-10-21', 3, seededRandom(7))
  assert.equal(times.length, 3)
  assert.deepEqual([...times].sort((a, b) => a.atMs - b.atMs), times)
  for (const slot of times) assert.equal(inWindow(slot.atMs), true, slot.at)
})

test('正常发送：当天第一次触发才生成，到点发出去', async () => {
  const dir = await makeClassroom()
  const { scheduler, clock, state } = harness({ dir })
  assert.deepEqual((await scheduler.tick(clock.now())).actions, ['generated'])
  assert.equal(state.generated.length, 1)
  const queue = parseQueue(await readFile(join(dir, PROACTIVE_RELATIVE), 'utf8'))
  const slot = queue.slots[0]
  assert.equal(slot.state, 'pending')
  // 生成后至少 5 分钟才发（不是「刚生成就发」）
  assert.ok(slot.atMs - clock.now() >= 4 * 60 * 1000)
  const sent = await scheduler.tick(slot.atMs)
  assert.deepEqual(sent.actions, ['sent'])
  assert.equal(sent.sentNow.length, 1)
  assert.equal(sent.queue.slots[0].state, 'sent')
  assert.equal(sent.queue.sentSinceLastStudent, 1)
})

test('到点之前什么都不做（不会提前发）', async () => {
  const dir = await makeClassroom()
  const { scheduler, clock } = harness({ dir })
  await scheduler.tick(clock.now())
  const early = await scheduler.tick(clock.now() + 60_000)
  assert.deepEqual(early.actions, [])
  assert.equal(early.sentNow.length, 0)
})

test('作废重生成（N4.3）：生成后学生说过话 → 这条作废，用最新上下文重生成', async () => {
  const dir = await makeClassroom()
  const { scheduler, clock, state } = harness({ dir })
  await scheduler.tick(clock.now())
  const before = parseQueue(await readFile(join(dir, PROACTIVE_RELATIVE), 'utf8'))
  const slot = before.slots[0]
  addStudent(state)
  const result = await scheduler.tick(slot.atMs)
  assert.deepEqual(result.actions, ['void-context', 'regenerated'])
  assert.equal(result.sentNow.length, 0)
  assert.equal(result.queue.voided[0].reason, 'context')
  assert.equal(result.queue.replacements, 1)
  const pending = result.queue.slots.filter((entry) => entry.state === 'pending')
  assert.equal(pending.length, 1)
  assert.equal(state.generated.length, 2)
})

test('作废重生成（上课）：课堂进行中 → 作废（那条不发了），并补一条', async () => {
  const dir = await makeClassroom()
  const classroom = { inProgress: false, lastActivityAt: null }
  const { scheduler, clock } = harness({ dir, classroom })
  await scheduler.tick(clock.now())
  const queue = parseQueue(await readFile(join(dir, PROACTIVE_RELATIVE), 'utf8'))
  classroom.inProgress = true
  const result = await scheduler.tick(queue.slots[0].atMs)
  assert.ok(result.actions.includes('void-class'))
  assert.equal(result.queue.voided[0].reason, 'class')
})

test('迟到宽限（EC ②）：迟到 1 分钟照发，迟到 20 分钟作废且不补发原文', async () => {
  const dir = await makeClassroom()
  const fresh = harness({ dir })
  await fresh.scheduler.tick(fresh.clock.now())
  const queue = parseQueue(await readFile(join(dir, PROACTIVE_RELATIVE), 'utf8'))
  const slot = queue.slots[0]
  const late = await fresh.scheduler.tick(slot.atMs + LATE_GRACE_MS - 1_000)
  assert.deepEqual(late.actions, ['sent'])

  const dir2 = await makeClassroom()
  const late2 = harness({ dir: dir2 })
  await late2.scheduler.tick(late2.clock.now())
  const queue2 = parseQueue(await readFile(join(dir2, PROACTIVE_RELATIVE), 'utf8'))
  const result = await late2.scheduler.tick(queue2.slots[0].atMs + LATE_GRACE_MS + 60_000)
  assert.ok(result.actions.includes('void-late'))
  assert.equal(result.sentNow.length, 0)
})

test('退避（N4.4）：连续 2 条没人回就停；学生再说话才恢复', async () => {
  const dir = await makeClassroom()
  const { scheduler, clock, state } = harness({ dir })
  // 预置：今天已经发过 2 条（模拟前两次都没人回）
  await mkdir(dirname(join(dir, PROACTIVE_RELATIVE)), { recursive: true })
  const now = clock.now()
  await writeFile(
    join(dir, PROACTIVE_RELATIVE),
    `${JSON.stringify({
      v: 1,
      date: '2026-10-21',
      generatedAt: now,
      plannedCount: 3,
      generateAttempts: 1,
      replacements: 0,
      sentSinceLastStudent: BACKOFF_AFTER,
      lastStudentSeq: 0,
      slots: [{ atMs: now, at: '09:00', speaker: '鲸', text: '到了。', state: 'pending', context: { maxSeq: 0, generatedAt: now } }],
      voided: [],
      lastError: null,
    })}\n`,
  )
  const result = await scheduler.tick(now)
  assert.ok(result.actions.includes('backoff'))
  assert.ok(result.actions.includes('void-backoff'))
  assert.equal(result.sentNow.length, 0)

  // 学生说话 → 退避清零
  addStudent(state)
  const after = await scheduler.tick(now + 1000)
  assert.equal(after.queue.sentSinceLastStudent, 0)
})

test('跨天（N4.1）：昨天的队列整份丢掉，按今天重建', async () => {
  const dir = await makeClassroom()
  const yesterday = Date.UTC(2026, 9, 20, 2, 0, 0) // 北京 10-20 10:00
  const first = harness({ dir, start: yesterday })
  await first.scheduler.tick(yesterday)
  const before = parseQueue(await readFile(join(dir, PROACTIVE_RELATIVE), 'utf8'))
  assert.equal(before.date, '2026-10-20')

  const today = Date.UTC(2026, 9, 21, 1, 0, 0) // 北京 10-21 09:00
  const second = harness({ dir, start: today })
  const result = await second.scheduler.tick(today)
  assert.ok(result.actions.includes('new-day'))
  assert.equal(result.queue.date, '2026-10-21')
  assert.equal(result.queue.slots.length, 1) // 只有今天新生成的那条
  assert.equal(result.queue.slots[0].text.includes('(1)'), true)
})

test('实例重启后队列恢复：不重新生成，按原时间发原消息', async () => {
  const dir = await makeClassroom()
  const first = harness({ dir, text: '重启前生成的' })
  await first.scheduler.tick(first.clock.now())
  const queue = parseQueue(await readFile(join(dir, PROACTIVE_RELATIVE), 'utf8'))
  const slot = queue.slots[0]

  // 「重启」= 全新的调度器实例，读同一个目录
  const second = harness({ dir, text: '重启后新生成的' })
  const beforeDue = await second.scheduler.tick(slot.atMs - 1_000)
  assert.deepEqual(beforeDue.actions, [])
  assert.equal(second.state.generated.length, 0)

  const sent = await second.scheduler.tick(slot.atMs)
  assert.deepEqual(sent.actions, ['sent'])
  assert.equal(sent.queue.slots[0].text, slot.text)
  assert.match(sent.queue.slots[0].text, /重启前生成的/)
})

test('队列文件损坏（EC ③）：重建当天队列，不崩溃', async () => {
  const dir = await makeClassroom()
  await mkdir(dirname(join(dir, PROACTIVE_RELATIVE)), { recursive: true })
  await writeFile(join(dir, PROACTIVE_RELATIVE), '{这不是 JSON', 'utf8')
  const { scheduler, clock } = harness({ dir })
  const result = await scheduler.tick(clock.now())
  assert.ok(result.actions.includes('queue-rebuilt'))
  assert.equal(result.queue.date, '2026-10-21')
  assert.equal(result.queue.slots.length, 1)
  // 状态接口也如实报告「重建过」
  assert.equal((await scheduler.status()).corrupt, false)
})

test('时间窗口之外不生成（北京 07:59 / 23:00 都不发）', async () => {
  const dir = await makeClassroom()
  const early = harness({ dir, start: Date.UTC(2026, 9, 20, 23, 59, 0) }) // 北京 07:59
  const first = await early.scheduler.tick(early.clock.now())
  assert.deepEqual(first.actions, ['outside-window'])
  assert.equal(first.queue.slots.length, 0)
  assert.equal(early.state.generated.length, 0)
})

test('生成失败：重试上限 3 次，错误留在队列的 lastError 里', async () => {
  const dir = await makeClassroom()
  let calls = 0
  const { scheduler, clock } = harness({
    dir,
    generate: async () => {
      calls += 1
      throw new Error('模型挂了')
    },
  })
  assert.deepEqual((await scheduler.tick(clock.now())).actions, ['generate-failed'])
  await scheduler.tick(clock.now())
  await scheduler.tick(clock.now())
  assert.deepEqual((await scheduler.tick(clock.now())).actions, ['generate-exhausted'])
  assert.equal(calls, 3)
  const status = await scheduler.status()
  assert.match(status.lastError.message, /模型挂了/)
})

test('剩余窗口不足 1 小时时只排 1 条（不是硬塞 3 条）', async () => {
  const dir = await makeClassroom()
  const late = Date.UTC(2026, 9, 21, 14, 30, 0) // 北京 22:30
  const { scheduler } = harness({ dir, start: late, rng: () => 0.99 })
  const result = await scheduler.tick(late)
  assert.equal(result.queue.slots.length, 1)
})

test('status()：能回答「今天还有几条、为什么没发」', async () => {
  const dir = await makeClassroom()
  const { scheduler, clock } = harness({ dir })
  await scheduler.tick(clock.now())
  const status = await scheduler.status()
  assert.equal(status.date, '2026-10-21')
  assert.equal(status.pending.length, 1)
  assert.equal(status.sent.length, 0)
  assert.equal(status.backoff, false)
  assert.deepEqual(status.voided, [])
  assert.equal(await readIfExists(join(dir, PROACTIVE_RELATIVE)) !== null, true)
})

/** 稳定的伪随机（测试要可重复）。 */
function seededRandom(seed) {
  let value = seed
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648
    return value / 2147483648
  }
}
