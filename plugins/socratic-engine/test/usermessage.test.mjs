// test/usermessage.test.mjs — lib/usermessage.mjs 的单测（B2，2026-10-21）
//
// 🔴 纪律：不起宿主、不落盘。
//
// 字段契约的来源**不是**猜的：宿主 `@deepseek-ai/dsh-session/lib/index.js` 的
// `assertMessageEventShape()` 是落盘时的唯一把关点，它逐条要求 ——
//   · `message.id` 是**非空字符串**（否则 `lacks an identified message`）
//   · `message.role === 'user'`（`MESSAGE_ROLE_BY_TYPE['user/message']`）
//   · `message.source` 是对象且 `source.kind` 是非空字符串
//   · `message.content` 是数组
// 宿主 `createUserMessage` 只做三件事：加 `role:'user'`、加 `id: randomUUID()`、
// `structuredClone` + 深度冻结。本文件把这三件事和上面四条一起钉死。

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createUserMessage, deepFreeze } from '../lib/usermessage.mjs'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('字段：role=user、id 是 v4 UUID、content/source 原样带过去', () => {
  const source = { kind: 'socratic-engine', form: 'classroom-block', block: 'phase:L2' }
  const content = [{ type: 'text', text: '注入正文' }]
  const message = createUserMessage({ content, source })
  assert.equal(message.role, 'user')
  assert.match(message.id, UUID_V4)
  assert.deepEqual(message.content, content)
  assert.deepEqual(message.source, source)
})

test('字段：额外字段原样透传（宿主 {...input} 的语义）', () => {
  const message = createUserMessage({ content: [], source: { kind: 'k' }, extra: 1 })
  assert.equal(message.extra, 1)
})

test('id 每次不同，且不是从输入里抄的', () => {
  const a = createUserMessage({ content: [], source: { kind: 'k' } })
  const b = createUserMessage({ content: [], source: { kind: 'k' } })
  assert.notEqual(a.id, b.id)
  const given = createUserMessage({ content: [], source: { kind: 'k' }, id: 'caller-id' })
  assert.notEqual(given.id, 'caller-id')
})

test('会话层要的四条不变量逐条成立（同一个 assertMessageEventShape 的判据）', () => {
  const message = createUserMessage({ content: [{ type: 'text', text: 'x' }], source: { kind: 'socratic-engine' } })
  assert.equal(typeof message.id === 'string' && message.id !== '', true, 'lacks an identified message')
  assert.equal(message.role, 'user')
  assert.equal(typeof message.source === 'object' && message.source !== null, true)
  assert.equal(typeof message.source.kind === 'string' && message.source.kind !== '', true)
  assert.equal(Array.isArray(message.content), true)
})

test('隔离：消息与被传进去的对象不共享可变子对象（structuredClone 的语义）', () => {
  const content = [{ type: 'text', text: '原文' }]
  const source = { kind: 'socratic-engine' }
  const message = createUserMessage({ content, source })
  content[0].text = '被改了'
  source.kind = '被改了'
  assert.equal(message.content[0].text, '原文')
  assert.equal(message.source.kind, 'socratic-engine')
})

test('不可变：消息与其子对象全被冻结（宿主 deepFreeze 的语义）', () => {
  const message = createUserMessage({ content: [{ type: 'text', text: 'x', nested: { deep: 1 } }], source: { kind: 'k' } })
  assert.equal(Object.isFrozen(message), true)
  assert.equal(Object.isFrozen(message.content), true)
  assert.equal(Object.isFrozen(message.content[0]), true)
  assert.equal(Object.isFrozen(message.content[0].nested), true)
  assert.equal(Object.isFrozen(message.source), true)
})

test('deepFreeze：处理环、跳过 AbortSignal（宿主同样跳过）', () => {
  const node = { name: 'root' }
  node.self = node
  const controller = new AbortController()
  node.signal = controller.signal
  deepFreeze(node)
  assert.equal(Object.isFrozen(node), true)
  assert.equal(Object.isFrozen(controller.signal), false, 'AbortSignal 不该被冻结（冻结会让 throwIfAborted 之外的路径出错）')
})
