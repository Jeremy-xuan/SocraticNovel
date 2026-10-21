// test/narrativebridge.test.mjs — 引擎 ↔ 叙事层接线（N2.1 / N2.4 / N3.5）的纯逻辑单测
//
// 纪律：不调 LLM、不起宿主、不碰真实教室目录、不碰 $DSH_HOME。
// 覆盖（逐条对应任务书 EC）：
//   · 叙事服务不存在 → 取值为 null、动态块给占位行、触发日记只记日志（不抛）
//   · 群聊 jsonl 不存在/为空/坏行 → 注入内容为空占位、不报错
//   · 日记读失败（服务抛错）→ 占位行 + 日志，绝不抛
//   · fireDiary 不 await done（立刻返回）、done 决议之后才写日志、done 拒绝也只是记日志
//   · 回合级记账：同一回合 claim 一次

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  DIARY_PLACEHOLDER_EMPTY,
  DIARY_PLACEHOLDER_FAILED,
  DIARY_PLACEHOLDER_MISSING,
  WECHAT_PLACEHOLDER_EMPTY,
  WECHAT_PLACEHOLDER_FAILED,
  clockOf,
  createTurnLedger,
  fireDiary,
  formatDiaryText,
  formatGroupText,
  narrativeOf,
  readRecentGroupMessages,
  resolveDynamicBlocks,
  resolveDynamicText,
} from '../lib/narrativebridge.mjs'

const dirs = []
test.after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

async function makeRuntimeDir() {
  const dir = await mkdtemp(join(tmpdir(), 'socratic-bridge-'))
  dirs.push(dir)
  return dir
}

/** 造一个「只会被问一次」的叙事服务替身。 */
function fakeNarrative({ readRecentDiaries, runDiary, isLessonIdleClosed } = {}) {
  const calls = { readRecentDiaries: [], runDiary: [], isLessonIdleClosed: [] }
  const service = {}
  if (readRecentDiaries !== undefined) {
    service.readRecentDiaries = async (request) => {
      calls.readRecentDiaries.push(request)
      return readRecentDiaries(request)
    }
  }
  if (runDiary !== undefined) {
    service.runDiary = (request) => {
      calls.runDiary.push(request)
      return runDiary(request)
    }
  }
  if (isLessonIdleClosed !== undefined) {
    service.isLessonIdleClosed = (input) => {
      calls.isLessonIdleClosed.push(input)
      return isLessonIdleClosed(input)
    }
  }
  return { service, calls }
}

// ---------------------------------------------------------------- ① 取服务

test('narrativeOf：ctx 没有 get / 服务未提供 / 取值不是对象 → null（引擎照常跑）', () => {
  assert.equal(narrativeOf(undefined), null)
  assert.equal(narrativeOf({}), null)
  assert.equal(narrativeOf({ get: () => undefined }), null)
  assert.equal(narrativeOf({ get: () => null }), null)
  assert.equal(narrativeOf({ get: () => 'narrative' }), null)
  const service = { runDiary: () => ({}) }
  assert.equal(narrativeOf({ get: (name) => (name === 'narrative' ? service : undefined) }), service)
})

// ---------------------------------------------------------------- ② 群聊 jsonl

test('readRecentGroupMessages：文件不存在 → 空且 missing（不是错误）', async () => {
  const runtimeDir = await makeRuntimeDir()
  const result = await readRecentGroupMessages({ runtimeDir })
  assert.deepEqual(result, { messages: [], bad: 0, missing: true })
})

test('readRecentGroupMessages：空文件 → 空', async () => {
  const runtimeDir = await makeRuntimeDir()
  await writeFile(join(runtimeDir, 'wechat_group.jsonl'), '', 'utf8')
  const result = await readRecentGroupMessages({ runtimeDir })
  assert.deepEqual(result.messages, [])
  assert.equal(result.missing, false)
})

test('readRecentGroupMessages：取最后 N 条（保持旧→新），坏行计入 bad 且不废整份', async () => {
  const runtimeDir = await makeRuntimeDir()
  const lines = []
  for (let seq = 1; seq <= 12; seq += 1) {
    lines.push(
      JSON.stringify({
        v: 1,
        seq,
        ts: '2026-10-20T23:15:00-04:00',
        role: seq % 2 === 0 ? 'character' : 'student',
        speaker: seq % 2 === 0 ? '鲸' : '你',
        text: `第 ${seq} 条`,
        kind: 'message',
      }),
    )
  }
  // 坏行：不是 JSON / 空文本 / 未知 role / typing（不落盘，但仍防御性过滤）
  lines.push('{ 这不是 JSON')
  lines.push(JSON.stringify({ v: 1, seq: 13, role: 'student', speaker: '你', text: '   ', kind: 'message' }))
  lines.push(JSON.stringify({ v: 1, seq: 14, role: 'robot', speaker: '谁', text: '未知角色', kind: 'message' }))
  lines.push(JSON.stringify({ v: 1, seq: 15, role: 'student', speaker: '你', text: '正在输入', kind: 'typing' }))
  await writeFile(join(runtimeDir, 'wechat_group.jsonl'), `${lines.join('\n')}\n`, 'utf8')

  const result = await readRecentGroupMessages({ runtimeDir, limit: 8 })
  assert.equal(result.messages.length, 8)
  assert.deepEqual(
    result.messages.map((m) => m.seq),
    [5, 6, 7, 8, 9, 10, 11, 12],
  )
  assert.equal(result.bad, 3, '非 JSON / 空文本 / 未知 role 各算一行坏数据；typing 是合法行、只是被过滤')
  assert.equal(result.missing, false)
})

test('readRecentGroupMessages：非 ENOENT 的读失败向上抛（由调用方决定怎么兜）', async () => {
  await assert.rejects(
    readRecentGroupMessages({ runtimeDir: '/tmp', read: async () => Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' })) }),
    /EACCES/,
  )
})

// ---------------------------------------------------------------- ③ 格式化

test('formatGroupText：空 → 空占位；有消息 → 逐行「时间 说话人：内容」', () => {
  assert.equal(formatGroupText([]), WECHAT_PLACEHOLDER_EMPTY)
  const text = formatGroupText([
    { ts: '2026-10-20T23:15:00-04:00', speaker: '你', text: '在吗' },
    { ts: '2026-10-20T23:16:00-04:00', speaker: '鲸', text: '在。刚把\n浮标扶正。' },
  ])
  assert.match(text, /^群里的最近 2 条（旧 → 新）：/)
  assert.match(text, /· .*你：在吗/)
  assert.match(text, /· .*鲸：在。刚把 浮标扶正。/)
})

test('clockOf：合法 ISO → 本地 HH:mm；解析不了 → 空串（不编时间）', () => {
  assert.match(clockOf('2026-10-20T23:15:00-04:00'), /^\d{2}:\d{2}$/)
  assert.equal(clockOf('不是时间'), '')
  assert.equal(clockOf(undefined), '')
})

test('formatDiaryText：带日期与讲次；缺讲次/日期都不编', () => {
  const full = formatDiaryText({ date: '2026-10-21', lesson: 3, text: '  抽屉卡了一下。 ' })
  assert.equal(full, '你最近写的一条日记（2026-10-21 · 第 3 讲）：\n抽屉卡了一下。')
  assert.equal(formatDiaryText({ date: '2026-10-21', lesson: null, text: '嗯。' }), '你最近写的一条日记（2026-10-21）：\n嗯。')
  assert.equal(formatDiaryText({ text: '嗯。' }), '你最近写的一条日记：\n嗯。')
})

// ---------------------------------------------------------------- ④ 动态块取值

test('日记：服务未装载 → 占位行 + 日志，不抛', async () => {
  const logs = []
  const text = await resolveDynamicText(
    { dynamic: { kind: 'diary' } },
    { narrative: null, classroomDir: '/tmp', runtimeDir: '/tmp', log: (m) => logs.push(m) },
  )
  assert.equal(text, DIARY_PLACEHOLDER_MISSING)
  assert.ok(logs.some((m) => m.includes('叙事服务未装载')))
})

test('日记：服务没有 readRecentDiaries → 同一个占位（接口不匹配不是课堂的事）', async () => {
  const text = await resolveDynamicText(
    { dynamic: { kind: 'diary' } },
    { narrative: {}, classroomDir: '/tmp', runtimeDir: '/tmp' },
  )
  assert.equal(text, DIARY_PLACEHOLDER_MISSING)
})

test('日记：还没写过 → 空占位；写过 → 取**最后一条**', async () => {
  const empty = fakeNarrative({ readRecentDiaries: async () => ({ entries: [], bad: 0 }) })
  assert.equal(
    await resolveDynamicText({ dynamic: { kind: 'diary' } }, { narrative: empty.service, classroomDir: '/tmp', runtimeDir: '/tmp' }),
    DIARY_PLACEHOLDER_EMPTY,
  )

  const filled = fakeNarrative({
    readRecentDiaries: async () => ({
      entries: [
        { date: '2026-10-19', lesson: 1, text: '旧的' },
        { date: '2026-10-21', lesson: 3, text: '新的' },
      ],
      bad: 0,
    }),
  })
  const text = await resolveDynamicText(
    { dynamic: { kind: 'diary' } },
    { narrative: filled.service, classroomDir: '/tmp', runtimeDir: '/tmp' },
  )
  assert.equal(text, '你最近写的一条日记（2026-10-21 · 第 3 讲）：\n新的')
  assert.deepEqual(filled.calls.readRecentDiaries, [{ classroomDir: '/tmp', limit: 1 }], 'N2.4 只要最近一条')
})

test('日记：读失败（服务抛错）→ 读不到占位 + 日志，绝不抛', async () => {
  const logs = []
  const broken = fakeNarrative({
    readRecentDiaries: async () => {
      throw new Error('磁盘炸了')
    },
  })
  const text = await resolveDynamicText(
    { dynamic: { kind: 'diary' } },
    { narrative: broken.service, classroomDir: '/tmp', runtimeDir: '/tmp', log: (m) => logs.push(m) },
  )
  assert.equal(text, DIARY_PLACEHOLDER_FAILED)
  assert.ok(logs.some((m) => m.includes('磁盘炸了')))
})

test('群聊：文件不存在 → 空占位；有文件 → 最近 N 条；读失败 → 读不到占位 + 日志', async () => {
  const runtimeDir = await makeRuntimeDir()
  assert.equal(
    await resolveDynamicText({ dynamic: { kind: 'wechat', limit: 8 } }, { narrative: null, classroomDir: '/tmp', runtimeDir }),
    WECHAT_PLACEHOLDER_EMPTY,
  )

  await writeFile(
    join(runtimeDir, 'wechat_group.jsonl'),
    `${JSON.stringify({ ts: '2026-10-20T23:15:00-04:00', role: 'student', speaker: '你', text: '在吗', kind: 'message' })}\n`,
    'utf8',
  )
  const text = await resolveDynamicText({ dynamic: { kind: 'wechat', limit: 8 } }, { narrative: null, classroomDir: '/tmp', runtimeDir })
  assert.match(text, /群里的最近 1 条/)
  assert.match(text, /你：在吗/)

  const logs = []
  // 把 `wechat_group.jsonl` 造成一个**目录**：readFile 报 EISDIR（不是 ENOENT）→ 走"读不到"占位。
  const brokenDir = await makeRuntimeDir()
  await mkdir(join(brokenDir, 'wechat_group.jsonl'))
  const failed = await resolveDynamicText(
    { dynamic: { kind: 'wechat', limit: 8 } },
    { narrative: null, classroomDir: '/tmp', runtimeDir: brokenDir, log: (m) => logs.push(m) },
  )
  assert.equal(failed, WECHAT_PLACEHOLDER_FAILED)
  assert.ok(logs.some((m) => m.includes('读群聊记录失败')))
})

test('未知 dynamic.kind → 抛（装载期已校验，走到这里就是 bug，不静默注入空块）', async () => {
  await assert.rejects(
    resolveDynamicText({ dynamic: { kind: 'telepathy' } }, { narrative: null, classroomDir: '/tmp', runtimeDir: '/tmp' }),
    /未知的 dynamic\.kind/,
  )
})

test('非动态块原样返回它的 text（同一条路径上两种块共存）', async () => {
  assert.equal(await resolveDynamicText({ text: '静态' }, { narrative: null, classroomDir: '/tmp', runtimeDir: '/tmp' }), '静态')
})

// ---------------------------------------------------------------- ⑤ 批量取值（只给到点的块取）

test('resolveDynamicBlocks：只给 isBlockDue 为真的块取内容，且不改原数组', async () => {
  const runtimeDir = await makeRuntimeDir()
  await writeFile(
    join(runtimeDir, 'wechat_group.jsonl'),
    `${JSON.stringify({ ts: '2026-10-20T23:15:00-04:00', role: 'student', speaker: '你', text: '在吗', kind: 'message' })}\n`,
    'utf8',
  )
  const blocks = [
    { id: 'static', text: '静态块' },
    { id: 'wechat.due', dynamic: { kind: 'wechat', limit: 8 }, text: '' },
    { id: 'wechat.not-due', dynamic: { kind: 'wechat', limit: 8 }, text: '' },
  ]
  const resolved = await resolveDynamicBlocks(blocks, {
    state: {},
    narrative: null,
    classroomDir: '/tmp',
    runtimeDir,
    isBlockDue: (block) => block.id === 'wechat.due',
  })
  assert.equal(resolved[0].text, '静态块')
  assert.match(resolved[1].text, /你：在吗/)
  assert.equal(resolved[2].text, '', '没到点的块不读盘、正文保持原样（记账仍归 planTurnInjections）')
  assert.equal(blocks[1].text, '', '不得就地修改 manifest 里的块')
  assert.notEqual(resolved, blocks, '返回新数组')
})

// ---------------------------------------------------------------- ⑥ 触发日记（浮空、不阻塞）

test('fireDiary：服务缺失 / 接口缺失 / 缺 sessionId / 缺教室目录 → 只记状态与日志，不抛', () => {
  const logs = []
  const log = (m) => logs.push(m)
  assert.equal(fireDiary({ narrative: null, sessionId: 's', classroomDir: '/tmp', trigger: 'close', log }), 'no-service')
  assert.equal(fireDiary({ narrative: {}, sessionId: 's', classroomDir: '/tmp', trigger: 'close', log }), 'no-runDiary')
  assert.equal(
    fireDiary({ narrative: { runDiary: () => ({ accepted: true }) }, sessionId: null, classroomDir: '/tmp', trigger: 'close', log }),
    'no-session',
  )
  assert.equal(
    fireDiary({ narrative: { runDiary: () => ({ accepted: true }) }, sessionId: 's', classroomDir: null, trigger: 'close', log }),
    'no-classroom',
  )
  assert.equal(logs.length, 4, '四种情况各留一条日志（失败不静默）')
})

test('fireDiary：accepted:false → rejected；runDiary 抛错 → threw（都不外抛）', () => {
  const logs = []
  const rejected = fireDiary({
    narrative: { runDiary: () => ({ accepted: false, reason: 'NO_SESSION' }) },
    sessionId: 's',
    classroomDir: '/tmp',
    trigger: 'close',
    log: (m) => logs.push(m),
  })
  assert.equal(rejected, 'rejected')
  const threw = fireDiary({
    narrative: {
      runDiary: () => {
        throw new Error('借来的实现炸了')
      },
    },
    sessionId: 's',
    classroomDir: '/tmp',
    trigger: 'close',
    log: (m) => logs.push(m),
  })
  assert.equal(threw, 'threw')
  assert.ok(logs.some((m) => m.includes('借来的实现炸了')))
})

test('fireDiary：立刻返回（done 还没落定），done 决议之后才写结果日志', async () => {
  let resolveDone
  const done = new Promise((resolve) => {
    resolveDone = resolve
  })
  const logs = []
  const requests = []
  const service = {
    runDiary: (request) => {
      requests.push(request)
      return { accepted: true, runId: 'run-1', state: 'running', done }
    },
  }
  const status = fireDiary({
    narrative: service,
    sessionId: 'session-1',
    classroomDir: '/tmp/classroom',
    lesson: 3,
    trigger: 'close',
    model: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    log: (m) => logs.push(m),
  })
  assert.equal(status, 'started')
  assert.deepEqual(requests, [
    {
      sessionId: 'session-1',
      classroomDir: '/tmp/classroom',
      lesson: 3,
      trigger: 'close',
      model: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    },
  ])
  assert.ok(logs.some((m) => m.includes('日记已排队')), '排队立刻记，说明没 await')
  assert.ok(!logs.some((m) => m.includes('日记跑完')), 'done 未落定前不得有结果日志')

  resolveDone({ ok: true, state: 'ok', writes: [{ path: 'a', bytes: 1 }] })
  await done
  await Promise.resolve()
  assert.ok(logs.some((m) => m.includes('日记跑完') && m.includes('ok')), 'done 落定后写结果')
})

test('fireDiary：done 拒绝也只是日志（不留未处理的 rejection）', async () => {
  const logs = []
  fireDiary({
    narrative: { runDiary: () => ({ accepted: true, done: Promise.reject(new Error('done 炸了')) }) },
    sessionId: 's',
    classroomDir: '/tmp',
    trigger: 'idle',
    log: (m) => logs.push(m),
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(logs.some((m) => m.includes('done 拒绝')))
})

test('fireDiary：lesson 非正整数 → 传 null（叙事层按"无讲次"记作 0）；不传空 model', () => {
  const requests = []
  const service = {
    runDiary: (request) => {
      requests.push(request)
      return { accepted: true, done: Promise.resolve({ ok: true, state: 'ok', writes: [] }) }
    },
  }
  fireDiary({ narrative: service, sessionId: 's', classroomDir: '/tmp', lesson: null, trigger: 'idle', model: {}, log: () => {} })
  fireDiary({ narrative: service, sessionId: 's', classroomDir: '/tmp', lesson: 0, trigger: 'idle', log: () => {} })
  assert.equal(requests[0].lesson, null)
  assert.equal(requests[1].lesson, null)
  assert.ok(!('model' in requests[0]), '不完整的模型路由不传（叙事层按自己的顺序解析）')
})

// ---------------------------------------------------------------- ⑦ 回合级记账

test('createTurnLedger：同一 key 只放行一次；有界淘汰最旧', () => {
  const ledger = createTurnLedger({ max: 2 })
  assert.equal(ledger.claim('s#1'), true)
  assert.equal(ledger.claim('s#1'), false)
  assert.equal(ledger.claim('s#2'), true)
  assert.equal(ledger.claim('s#3'), true)
  assert.equal(ledger.size, 2)
  assert.equal(ledger.has('s#1'), false, '最旧的被淘汰')
  assert.equal(ledger.claim('s#1'), true, '淘汰之后可以重新 claim（它是内存记账，不是持久幂等）')
})
