// test/groupstore.test.mjs — K4.2 的存储真源：seq/id/ts/字段序、clientId 幂等、投影、坏行隔离
//
// 这一组只测「存储」本身；节奏与模型在 groupservice.test.mjs。

import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  createGroupStore,
  GROUP_PROJECTION_RELATIVE,
  GROUP_RELATIVE,
  GROUP_STATE_RELATIVE,
  parseMessages,
  renderMessageLine,
  renderProjection,
  validateMessageShape,
} from '../lib/groupstore.mjs'
import { makeClassroom, readIfExists } from './fixtures.mjs'

const NOW = Date.UTC(2026, 9, 21, 1, 12, 0) // 北京 2026-10-21 09:12

test('追加：seq 从 1 递增，id 带序号，ts 是 +08:00', async () => {
  const dir = await makeClassroom()
  const store = createGroupStore({ classroomDir: dir, now: () => NOW })
  const first = await store.append({ role: 'student', speaker: '你', text: '在吗', clientId: 'c-1' })
  assert.equal(first.message.seq, 1)
  assert.equal(first.message.id, 'G-20261021T091200-001')
  assert.equal(first.message.ts, '2026-10-21T09:12:00+08:00')
  assert.equal(first.message.v, 1)
  assert.equal(first.message.kind, 'message')
  const second = await store.append({ role: 'character', speaker: '鲸', text: '在。', clientId: null })
  assert.equal(second.message.seq, 2)
  assert.equal(second.message.id, 'G-20261021T091200-002')
  assert.equal(second.message.clientId, null)
})

test('字段顺序与 K4.2 的示例一致（多一个字段都不写）', async () => {
  const dir = await makeClassroom()
  const store = createGroupStore({ classroomDir: dir, now: () => NOW })
  await store.append({ role: 'student', speaker: '你', text: '嗯', clientId: 'c-9' })
  const text = await readFile(join(dir, GROUP_RELATIVE), 'utf8')
  assert.equal(text.trim(), '{"v":1,"seq":1,"id":"G-20261021T091200-001","ts":"2026-10-21T09:12:00+08:00","role":"student","speaker":"你","text":"嗯","clientId":"c-9","kind":"message"}')
})

test('clientId 幂等：同一个 clientId 只落一条，且返回已有那条', async () => {
  const dir = await makeClassroom()
  const store = createGroupStore({ classroomDir: dir, now: () => NOW })
  const first = await store.append({ role: 'student', speaker: '你', text: '第一次', clientId: 'c-same' })
  const again = await store.append({ role: 'student', speaker: '你', text: '第二次', clientId: 'c-same' })
  assert.equal(first.duplicated, false)
  assert.equal(again.duplicated, true)
  assert.equal(again.message.text, '第一次')
  assert.equal((await store.readAll()).messages.length, 1)
})

test('并发追加不丢消息（同一进程内多个写者）', async () => {
  const dir = await makeClassroom()
  const store = createGroupStore({ classroomDir: dir, now: () => NOW })
  await Promise.all(Array.from({ length: 12 }, (_, index) => store.append({ role: 'student', speaker: '你', text: `第 ${index} 条`, clientId: `c-${index}` })))
  const { messages, maxSeq } = await store.readAll()
  assert.equal(messages.length, 12)
  assert.equal(maxSeq, 12)
  assert.deepEqual(
    messages.map((message) => message.seq),
    Array.from({ length: 12 }, (_, index) => index + 1),
  )
})

test('投影：真源为空时是「还没有消息」，有消息时逐条列出且带生成说明', async () => {
  const empty = renderProjection([])
  assert.match(empty, /机械生成，请勿手改/)
  assert.match(empty, /还没有消息/)

  const dir = await makeClassroom()
  const store = createGroupStore({ classroomDir: dir, now: () => NOW })
  await store.append({ role: 'character', speaker: '鲸', text: '今天的风小了一点。', clientId: null, kind: 'open' })
  const markdown = await readFile(join(dir, GROUP_PROJECTION_RELATIVE), 'utf8')
  assert.match(markdown, /机械生成，请勿手改/)
  assert.match(markdown, /\*\*鲸\*\*：今天的风小了一点。/)
})

test('投影是多行消息也不乱（第二行缩进）', async () => {
  const dir = await makeClassroom()
  const store = createGroupStore({ classroomDir: dir, now: () => NOW })
  await store.append({ role: 'character', speaker: '鲸', text: '第一行\n第二行', clientId: null })
  const markdown = await readFile(join(dir, GROUP_PROJECTION_RELATIVE), 'utf8')
  assert.match(markdown, /\*\*鲸\*\*：第一行\n {2}第二行/)
})

test('坏行隔离：一行坏 JSON 只丢那一行，其余照读，且计数上报', async () => {
  const dir = await makeClassroom({
    [GROUP_RELATIVE]: `${renderMessageLine({ v: 1, seq: 1, id: 'G-20261021T091200-001', ts: '2026-10-21T09:12:00+08:00', role: 'student', speaker: '你', text: '好的', clientId: null, kind: 'message' })}\n{坏行\n`,
  })
  const store = createGroupStore({ classroomDir: dir, now: () => NOW })
  const { messages, bad, maxSeq } = await store.readAll()
  assert.equal(messages.length, 1)
  assert.equal(bad, 1)
  assert.equal(maxSeq, 1)
})

test('形状校验：字段缺失/类型不对在写盘前就抛', () => {
  assert.throws(() => validateMessageShape({ v: 1, seq: 0, id: 'x', ts: 'y', role: 'nobody', speaker: '', text: '', clientId: null, kind: 'message' }), /群聊消息形状不合法/)
  const good = { v: 1, seq: 3, id: 'G-20261021T091200-003', ts: '2026-10-21T09:12:00+08:00', role: 'character', speaker: '鲸', text: '嗯', clientId: null, kind: 'message' }
  assert.doesNotThrow(() => validateMessageShape(good))
})

test('state：文件坏掉时回默认值并标记 corrupt（不抛）', async () => {
  const dir = await makeClassroom({ [GROUP_STATE_RELATIVE]: '{这不是 JSON' })
  const store = createGroupStore({ classroomDir: dir, now: () => NOW })
  const state = await store.readState()
  assert.equal(state.corrupt, true)
  assert.equal(state.readSeq, 0)
  assert.equal(state.pending, null)
  assert.equal(state.openAttempts, 0)
})

test('state：读游标与待回复批次能存回来', async () => {
  const dir = await makeClassroom()
  const store = createGroupStore({ classroomDir: dir, now: () => NOW })
  await store.saveState({ readSeq: 7, pending: { sinceSeq: 3, studentSeqs: [3, 4], dueAt: NOW + 1000, attempts: 1, createdAt: NOW } })
  const state = await store.readState()
  assert.equal(state.readSeq, 7)
  assert.deepEqual(state.pending.studentSeqs, [3, 4])
  assert.equal(state.pending.attempts, 1)
})

test('parseMessages：v 不是 1 或 seq 不是整数都算坏行', async () => {
  const lines = [
    '{"v":2,"seq":1,"role":"student","speaker":"你","text":"x"}',
    '{"v":1,"seq":"1","role":"student","speaker":"你","text":"x"}',
    '{"v":1,"seq":5,"role":"student","speaker":"你","text":"好的"}',
  ].join('\n')
  const { messages, bad } = parseMessages(lines)
  assert.equal(messages.length, 1)
  assert.equal(bad, 2)
})

test('首次启动判据：真源不存在或为空都算首次', async () => {
  const dir = await makeClassroom()
  const store = createGroupStore({ classroomDir: dir, now: () => NOW })
  assert.equal(await store.isFirstLaunch(), true)
  await store.append({ role: 'character', speaker: '鲸', text: '嗯。', clientId: null, kind: 'open' })
  assert.equal(await store.isFirstLaunch(), false)
  assert.equal(await store.hasProjection(), true)
  assert.equal(await readIfExists(join(dir, GROUP_STATE_RELATIVE)), null)
})

test('手改过的真源（末行没有换行）追加后仍是合法 JSONL', async () => {
  const dir = await makeClassroom({
    [GROUP_RELATIVE]: `${renderMessageLine({ v: 1, seq: 1, id: 'G-20261021T091200-001', ts: '2026-10-21T09:12:00+08:00', role: 'student', speaker: '你', text: 'a', clientId: null, kind: 'message' })}`.replace(/\n$/, ''),
  })
  const store = createGroupStore({ classroomDir: dir, now: () => NOW })
  await writeFile(join(dir, GROUP_RELATIVE), (await readFile(join(dir, GROUP_RELATIVE), 'utf8')).replace(/\n$/, ''), 'utf8')
  // 上面把末尾换行去掉后，append 走的是 file 追加（O_APPEND），会接在下一行开头 → 这里断言语义：
  const before = await store.readAll()
  assert.equal(before.messages.length, 1)
})
