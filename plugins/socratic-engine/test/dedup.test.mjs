// test/dedup.test.mjs — 去重门的纯逻辑单测（P1 · S3，2026-09-23）
//
// 🔴 纪律：本文件**不起宿主、不调 LLM、不读落盘会话**——只 import lib/dedup.mjs。
// 🔴 只跑自己：/opt/homebrew/bin/node --test test/dedup.test.mjs
//
// 覆盖（对应任务书第四步）：
//   ① 一个 turn 内 3 个 step 只放行 1 次
//   ② 连续 3 个 turn 各放行 1 次
//   ③ turn 中断后重试不重复（aborted 后宿主改投 next-turn → turn 号 +1）
//   ④ 状态清理（LRU 有界，不无限增长）
//   ⑤ 拿不到 turn 标识时的退化行为
//   ⑥ 并发/重入安全、跨 session 隔离、turn 回退/重放

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  makeDedupGate,
  registerDedup,
  sessionIdOf,
  DEDUP_MODE,
  UNKNOWN_SESSION,
} from '../lib/dedup.mjs'

const SID = 'session-aaaaaaaa-1111-2222-3333-444444444444'
const OTHER = 'session-bbbbbbbb-5555-6666-7777-888888888888'
const third = 'session-cccccccc-9999-0000-1111-222222222222'

/** 收集某个 session 上被放行的 (turn, step) 序列，便于断言。 */
function runSteps(gate, sessionId, turn, steps) {
  const allowed = []
  for (const step of steps) {
    const d = gate.shouldInject({ sessionId, turn, step })
    if (d.inject) allowed.push(step)
  }
  return allowed
}

// ── ① 一个 turn 内 3 个 step 只放行 1 次 ──────────────────────────────────────
test('① 同一 turn 内 3 个 step：只放行第 1 次', () => {
  const gate = makeDedupGate()
  const allowed = runSteps(gate, SID, 1, [1, 2, 3])
  assert.deepEqual(allowed, [1], '带工具的 turn 有 3 个 step，应只注入 1 次')
  assert.equal(gate.stats.allowed, 1)
  assert.equal(gate.stats.suppressed, 2)
})

test('①b 同一 turn 内 5 个 step（更多工具步）仍只放行 1 次', () => {
  const gate = makeDedupGate()
  const allowed = runSteps(gate, SID, 7, [1, 2, 3, 4, 5])
  assert.deepEqual(allowed, [1])
})

test('①c 同一 turn 的 step 被乱序/重复调用，仍只放行 1 次', () => {
  const gate = makeDedupGate()
  const allowed = runSteps(gate, SID, 4, [1, 1, 2, 1, 3])
  assert.deepEqual(allowed, [1], '重复的 step===1 必须被幂等键吸收（旧骨架在此会双注入）')
  assert.equal(gate.stats.allowed, 1)
})

// ── ② 连续 3 个 turn 各放行 1 次 ─────────────────────────────────────────────
test('② 连续 3 个 turn：每个 turn 各放行 1 次', () => {
  const gate = makeDedupGate()
  const allowed = []
  for (const turn of [1, 2, 3]) {
    for (const step of [1, 2, 3]) {
      if (gate.shouldInject({ sessionId: SID, turn, step }).inject) allowed.push(turn)
    }
  }
  assert.deepEqual(allowed, [1, 2, 3], '3 个 turn 应各注入 1 次，共 3 次')
  assert.equal(gate.stats.allowed, 3)
})

test('②b 每 turn 只出现 1 个 step（纯对话 turn）：同样每 turn 各 1 次', () => {
  const gate = makeDedupGate()
  const allowed = []
  for (const turn of [1, 2, 3, 4]) {
    if (gate.shouldInject({ sessionId: SID, turn, step: 1 }).inject) allowed.push(turn)
  }
  assert.deepEqual(allowed, [1, 2, 3, 4])
})

test('②c turn 号从 5 开始（resume 续号，不从 1 重来）：正常放行', () => {
  // 取证②：宿主 `turnBoundary` 投影跨 resume 续号，新 turn = 历史最大 + 1。
  const gate = makeDedupGate()
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 5, step: 1 }).inject, true)
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 5, step: 2 }).inject, false)
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 6, step: 1 }).inject, true)
})

// ── ③ turn 中断后重试不重复 ──────────────────────────────────────────────────
test('③ turn 被中断（aborted）后重发 → 宿主起新 turn → 新 turn 放行 1 次，旧 turn 不重放', () => {
  const gate = makeDedupGate()
  // turn 1 正常注入
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 1, step: 1 }).inject, true)
  // ...用户中断。中断 turn 的后续 step 不应再注入
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 1, step: 2 }).inject, false)
  // 重发 → 宿主把 aborted 后的输入改投 next-turn → turn 号 +1
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 2, step: 1 }).inject, true, '中断后重试是新 turn，应注入')
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 2, step: 2 }).inject, false)
  assert.equal(gate.stats.allowed, 2, '全程共 2 次： turn1 一次 + turn2 一次，无重复')
})

test('③b LLM 层重试（同一 turn 同一 step 的 pre-step 再次进入）不双注入', () => {
  // 取证②：step() 内的 while(true) 是 LLM attempt 重试循环，不会再触发 agent/pre-step；
  // 但若宿主行为变化导致 pre-step 重入，幂等键必须吸收它。
  const gate = makeDedupGate()
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 3, step: 2 }).inject, true)
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 3, step: 2 }).inject, false, '重入必须被拦')
  assert.equal(gate.stats.allowed, 1)
})

test('③c turn 结束再结束时/轮次回退重放：不重复注入', () => {
  const gate = makeDedupGate()
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 2, step: 1 }).inject, true)
  gate.noteTurnEnd({ sessionId: SID })
  // 宿主日志重放或 turn 号回退
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 1, step: 1 }).inject, false, 'turn 号回退（<= 已放行）必须拦下')
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 2, step: 1 }).inject, false)
  assert.equal(gate.stats.allowed, 1)
})

// ── ④ 状态清理：有界，不无限增长 ──────────────────────────────────────────────
test('④ 单 session 长跑：内存 O(1)（单调游标），不随 turn 数增长', () => {
  const gate = makeDedupGate()
  for (let turn = 1; turn <= 10_000; turn += 1) {
    gate.shouldInject({ sessionId: SID, turn, step: 1 })
  }
  const snap = gate.snapshot()
  assert.equal(Object.keys(snap.sessions).length, 1, '10000 个 turn 只应留 1 条游标')
  assert.equal(snap.sessions[SID].lastAllowedTurn, 10_000)
  assert.equal(gate.stats.allowed, 10_000)
})

test('④b 多 session：超过 maxSessions 时按 LRU 淘汰，总数有界', () => {
  const gate = makeDedupGate({ maxSessions: 3 })
  for (let i = 1; i <= 10; i += 1) {
    gate.shouldInject({ sessionId: `session-${i}`, turn: 1, step: 1 })
  }
  const snap = gate.snapshot()
  assert.equal(Object.keys(snap.sessions).length, 3, '不得超过 maxSessions')
  assert.equal(gate.stats.evicted, 7, '共淘汰 7 条')
  // 最近 3 个仍在
  assert.ok(snap.sessions['session-8'] && snap.sessions['session-9'] && snap.sessions['session-10'])
  assert.equal(snap.sessions['session-1'], undefined, '最久未用的应先出局')
})

test('④c LRU 位置会被「仍在活动」的 session 刷新', () => {
  const gate = makeDedupGate({ maxSessions: 2 })
  gate.shouldInject({ sessionId: 's-a', turn: 1, step: 1 }) // 队首
  gate.shouldInject({ sessionId: 's-b', turn: 1, step: 1 })
  // s-a 仍在活动 → touch 到队尾
  gate.shouldInject({ sessionId: 's-a', turn: 2, step: 1 })
  // 塞第三个 → 应淘汰此时真正最久未用的 s-b
  gate.shouldInject({ sessionId: 's-c', turn: 1, step: 1 })
  const snap = gate.snapshot()
  assert.equal(snap.sessions['s-b'], undefined, 's-b 才是最久未用，应被淘汰')
  assert.ok(snap.sessions['s-a'] && snap.sessions['s-c'])
})

test('④d noteTurnEnd 刷新 LRU，但不删除游标（幂等键必须跨 turn 存活）', () => {
  const gate = makeDedupGate()
  gate.shouldInject({ sessionId: SID, turn: 1, step: 1 })
  gate.noteTurnEnd({ sessionId: SID })
  const snap = gate.snapshot()
  assert.equal(snap.sessions[SID].lastAllowedTurn, 1, '清理不得丢幂等键')
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 1, step: 1 }).inject, false, 'turn1 仍应被拦')
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 2, step: 1 }).inject, true)
})

test('④e forget 显式重置一个 session（插件卸载/换教室语义）', () => {
  const gate = makeDedupGate()
  gate.shouldInject({ sessionId: SID, turn: 1, step: 1 })
  assert.equal(gate.forget(SID), true)
  assert.equal(gate.forget(SID), false, '重复 forget 返回 false')
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 1, step: 1 }).inject, true, '重置后同 turn 可再放行')
})

// ── ⑤ 拿不到 turn 标识时的退化行为 ────────────────────────────────────────────
test('⑤a turn 缺失 → 退化 mode=sequential，退回 step===1 语义，并被计数', () => {
  const gate = makeDedupGate()
  const d1 = gate.shouldInject({ sessionId: SID, step: 1 })
  assert.equal(d1.inject, true)
  assert.equal(d1.mode, DEDUP_MODE.SEQUENTIAL, '必须显式标出退化')
  assert.match(d1.reason, /degraded/)
  const d2 = gate.shouldInject({ sessionId: SID, step: 2 })
  assert.equal(d2.inject, false)
  assert.equal(gate.stats.degraded, 2)
})

test('⑤b turn 非法（字符串/NaN/负数/小数/Infinity）→ 全部走退化，不抛错', () => {
  const gate = makeDedupGate()
  for (const bad of ['1', NaN, -1, 1.5, Infinity, null, undefined, {}]) {
    const d = gate.shouldInject({ sessionId: SID, turn: bad, step: 1 })
    assert.equal(d.mode, DEDUP_MODE.SEQUENTIAL, `turn=${String(bad)} 应判为不可用`)
    assert.equal(d.inject, true)
  }
  assert.equal(gate.stats.degraded, 8)
})

test('⑤c 🔴 退化的已知弱点：同 turn 内 step===1 出现两次会双放行（无跨 turn 保证）', () => {
  // 这不是 bug 而是**被显式声明的强度上限**：没有 turn 就没有幂等键。
  // 本用例把该弱点钉死在测试里，防止将来有人误以为退化路径等价于首选路径。
  const gate = makeDedupGate()
  assert.equal(gate.shouldInject({ sessionId: SID, step: 1 }).inject, true)
  assert.equal(gate.shouldInject({ sessionId: SID, step: 1 }).inject, true, '退化路径无法拦重复 step===1')
  assert.equal(gate.stats.allowed, 2)
  assert.equal(gate.stats.degraded, 2)
})

test('⑤d sessionId 缺失 → 归入 <unknown-session>，仍不抛错且有界', () => {
  const gate = makeDedupGate()
  const d = gate.shouldInject({ turn: 1, step: 1 })
  assert.equal(d.inject, true)
  assert.equal(d.mode, DEDUP_MODE.TURN, '有 turn 时 mode 仍是 turn；只有 turn 缺失才退化')
  const snap = gate.snapshot()
  assert.ok(snap.sessions[UNKNOWN_SESSION], '应落在保留键上')
})

test('⑤e 空入参/无入参不抛错（宿主异常会中断 turn，门不值得付这个代价）', () => {
  const gate = makeDedupGate()
  assert.doesNotThrow(() => gate.shouldInject())
  assert.doesNotThrow(() => gate.shouldInject({}))
  assert.doesNotThrow(() => gate.shouldInject({ sessionId: '', turn: undefined, step: undefined }))
  assert.doesNotThrow(() => gate.noteTurnEnd())
  assert.doesNotThrow(() => gate.shouldInject(null))
})

// ── ⑥ 并发/重入安全、跨 session 隔离 ─────────────────────────────────────────
test('⑥a 跨 session 隔离：不同 session 的同号 turn 互不影响', () => {
  const gate = makeDedupGate()
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 1, step: 1 }).inject, true)
  assert.equal(gate.shouldInject({ sessionId: OTHER, turn: 1, step: 1 }).inject, true, '另一 session 的 turn1 是它自己的第一次')
  assert.equal(gate.shouldInject({ sessionId: third, turn: 1, step: 1 }).inject, true)
  assert.equal(gate.stats.allowed, 3)
})

test('⑥b 同一会话「同时两处调用」= 串行两调，第二次必被拦（无 await，不可能交错）', async () => {
  const gate = makeDedupGate()
  const input = { sessionId: SID, turn: 9, step: 1 }
  // 两个并发任务同时撞同一 turn
  const [a, b] = await Promise.all([
    Promise.resolve().then(() => gate.shouldInject(input)),
    Promise.resolve().then(() => gate.shouldInject(input)),
  ])
  const allowedCount = [a, b].filter((d) => d.inject).length
  assert.equal(allowedCount, 1, '并发重入必须恰好放行 1 次')
  assert.equal(gate.stats.allowed, 1)
})

test('⑥c 模拟宿主 pre-step 的水落链：门只在放行时让下游注入', async () => {
  // 复刻 index.mjs 的接线形态：门判 → 放行才注入
  const gate = makeDedupGate()
  const injected = []
  const preStep = async (payload) => {
    const d = gate.shouldInject({
      sessionId: sessionIdOf(payload),
      turn: payload.turn,
      step: payload.step,
    })
    if (!d.inject) return { kind: 'enter', messages: [...payload.messages] }
    injected.push({ turn: payload.turn, step: payload.step })
    return { kind: 'enter', messages: [...payload.messages, { socraticBlock: true }] }
  }
  const agent = { session: { id: SID } }
  // turn 1：3 步
  for (const step of [1, 2, 3]) await preStep({ agent, messages: [{ user: true }], turn: 1, step })
  // turn 2：2 步
  for (const step of [1, 2]) await preStep({ agent, messages: [{ user: true }], turn: 2, step })
  assert.deepEqual(injected, [
    { turn: 1, step: 1 },
    { turn: 2, step: 1 },
  ], '2 个 turn、共 5 次 pre-step → 恰好注入 2 次')
})

// ── sessionIdOf：payload 形状取自取证② ──────────────────────────────────────
test('sessionIdOf 从 payload.agent.session.id 取（取证② payload 恒带 agent）', () => {
  assert.equal(sessionIdOf({ agent: { session: { id: SID } }, turn: 1, step: 1 }), SID)
  assert.equal(sessionIdOf({ agent: { session: { id: '' } } }), undefined)
  assert.equal(sessionIdOf({ agent: {} }), undefined)
  assert.equal(sessionIdOf({}), undefined)
  assert.equal(sessionIdOf(null), undefined)
  assert.equal(sessionIdOf(undefined), undefined)
  assert.equal(sessionIdOf('not-an-object'), undefined)
})

// ── registerDedup：接线助手（用假 ctx，不起宿主） ────────────────────────────
test('registerDedup 只挂 agent/turn-stopping 做 LRU 刷新，返回可用的门', () => {
  const handlers = new Map()
  const fakeCtx = {
    on(event, handler) {
      handlers.set(event, handler)
    },
  }
  const gate = registerDedup(fakeCtx)
  assert.deepEqual([...handlers.keys()], ['agent/turn-stopping'], '只注册清理侧，注入判定留给调用方')

  const agent = { session: { id: SID } }
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 1, step: 1 }).inject, true)
  // 宿主每 turn 触发一次 turn-stopping
  handlers.get('agent/turn-stopping')({ agent, turn: 1 })
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 1, step: 2 }).inject, false, '清理不得破坏幂等')
  assert.equal(gate.shouldInject({ sessionId: SID, turn: 2, step: 1 }).inject, true)
})

test('registerDedup 的 turn-stopping 处理不抛错（payload 缺 agent 时静默退化）', () => {
  const handlers = new Map()
  const gate = registerDedup({ on: (e, h) => handlers.set(e, h) }, { maxSessions: 2 })
  assert.doesNotThrow(() => handlers.get('agent/turn-stopping')({}))
  assert.doesNotThrow(() => handlers.get('agent/turn-stopping')(undefined))
  assert.ok(gate)
})
