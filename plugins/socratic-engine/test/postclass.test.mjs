// test/postclass.test.mjs — lib/postclass.mjs 的纯逻辑单测
//
// 纪律：不调 LLM、不起宿主、不碰真实教室目录、不碰 $DSH_HOME。
// 运行：/opt/homebrew/bin/node --test test/postclass.test.mjs
//
// IO 注入：`opts.atomicWrite` 由本测试注入一个**同一算法**的实现
// （wx 独占创建随机后缀临时文件 + rename 覆盖），与宿主
// `@deepseek-ai/dsh-atomic-write` 的 writeFileAtomic 等价；单进程测试里
// withFileLock 退化为直接执行操作体（宿主版是 `<file>.lock` 跨进程锁）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, rename, mkdir, stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_SESSION_LOG_FILE,
  SESSION_LOG_UPDATER,
  appendEntryToContent,
  extractTurnFacts,
  formatLocalTime,
  normalizeLesson,
  parseTurnMarkers,
  registerPostClass,
  renderSessionLogEntry,
  summarizeStudentActivity,
  turnMarker,
} from '../lib/postclass.mjs'
import { EVENTS, STUDENT_LINE_TURN2, TURN2_LAST_TIME } from './fixtures/postclass-turn-sample/events.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures', 'postclass-runtime')
const SESSION_ID = 'test-session'
const PHASE = 'quiz'
const TIME_LABEL = '2026-09-23 21:03'
const MARKER_TURN2 = `<!-- socratic-engine:session=${SESSION_ID} turn=2 -->`

// ---------------------------------------------------------------- 测试替身

/** 与宿主 writeFileAtomic 同算法：wx 独占创建临时文件 → rename 覆盖。 */
async function writeFileAtomic(filename, content, options) {
  await mkdir(dirname(filename), { recursive: true })
  const temp = `${filename}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, content, { mode: options?.mode, flag: 'wx' })
    await rename(temp, filename)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

const fakeIo = { writeFileAtomic, withFileLock: (_filename, operation) => operation() }

/** 假 ctx：只捕获 'agent/turn-stopping' 的监听器。 */
function makeCtx() {
  const listeners = new Map()
  return {
    on(name, handler) {
      listeners.set(name, handler)
    },
    async fire(name, payload) {
      const handler = listeners.get(name)
      assert.ok(handler, `未注册 ${name} 监听器`)
      return handler(payload)
    },
    has(name) {
      return listeners.has(name)
    },
  }
}

/** 假 agent：session 只需 id + snapshotEvents。 */
function makeAgent(events) {
  return { session: { id: SESSION_ID, snapshotEvents: () => events } }
}

/** 起一个已注册的课后更新器，并把 runtime/ 铺好（含真实 session_log.md）。 */
async function setup({ events = EVENTS, phase = PHASE, runtime = true, lesson = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'socratic-postclass-'))
  const runtimeDir = join(dir, 'runtime')
  if (runtime) {
    await mkdir(runtimeDir, { recursive: true })
    await writeFile(join(runtimeDir, DEFAULT_SESSION_LOG_FILE), await readFile(join(FIXTURES, 'session_log.md'), 'utf8'))
  }
  const ctx = makeCtx()
  const logs = []
  const result = registerPostClass(ctx, {
    runtimeDir,
    getPhase: () => phase,
    getLesson: () => lesson,
    formatTime: () => TIME_LABEL,
    atomicWrite: fakeIo,
    log: (...args) => logs.push(args.join(' ')),
  })
  return {
    dir,
    runtimeDir,
    ctx,
    logs,
    result,
    agent: makeAgent(events),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

// ---------------------------------------------------------------- 纯函数

test('extractTurnFacts：第 1 回合切出学生原话与工具成败', () => {
  const facts = extractTurnFacts(EVENTS, { turn: 1 })
  assert.equal(facts.turn, 1)
  assert.deepEqual(facts.studentTexts, ['第 1 讲开始吧'])
  assert.deepEqual(facts.toolCalls, [{ name: 'bash', isError: false }])
  assert.equal(facts.time, 1789800000600)
  assert.equal(facts.hasContent, true)
})

test('extractTurnFacts：第 2 回合排除注入消息，且未完成的工具不谎报成功', () => {
  const facts = extractTurnFacts(EVENTS, { turn: 2 })
  assert.deepEqual(facts.studentTexts, [STUDENT_LINE_TURN2], 'agent-instructions / socratic-engine 注入不得计入学生消息')
  assert.deepEqual(facts.toolCalls, [
    { name: 'classroom_status', isError: true },
    { name: 'bash', isError: null },
  ])
  assert.equal(facts.time, TURN2_LAST_TIME)
  assert.equal(facts.hasContent, true)
})

test('extractTurnFacts：第 1 回合不得混入第 2 回合的事件', () => {
  const facts = extractTurnFacts(EVENTS, { turn: 1 })
  assert.ok(!facts.studentTexts.includes(STUDENT_LINE_TURN2))
  assert.equal(facts.toolCalls.length, 1)
})

test('extractTurnFacts：空回合 hasContent=false', () => {
  const events = [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    {
      type: 'user/message',
      seq: 1,
      time: 2,
      data: { role: 'user', id: 'm', source: { kind: 'agent-instructions' }, content: [{ type: 'text', text: 'AGENTS' }] },
    },
    {
      type: 'assistant/message',
      seq: 2,
      time: 3,
      data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '（空转）' }] } },
    },
  ]
  const facts = extractTurnFacts(events, { turn: 1 })
  assert.deepEqual(facts.studentTexts, [])
  assert.deepEqual(facts.toolCalls, [])
  assert.equal(facts.hasContent, false)
})

test('extractTurnFacts：事件不是数组时返回空事实（不抛）', () => {
  const facts = extractTurnFacts(undefined, { turn: 1 })
  assert.equal(facts.hasContent, false)
  assert.deepEqual(facts.studentTexts, [])
})

test('turnMarker：去重键 = sessionId + turn', () => {
  assert.equal(turnMarker(SESSION_ID, 2), MARKER_TURN2)
  assert.notEqual(turnMarker(SESSION_ID, 3), MARKER_TURN2)
  assert.notEqual(turnMarker('other', 2), MARKER_TURN2)
})

// ── DRAW-2：逐回合标记带讲次（讲次作同行第二个注释；旧标记逐字不变） ──────────

test('turnMarker：带讲次时旧标记逐字保留，同行追加 lesson 注释', () => {
  const marker = turnMarker(SESSION_ID, 2, 1)
  assert.ok(marker.startsWith(MARKER_TURN2), '旧标记必须是新标记的前缀（老解析方不受影响）')
  assert.equal(marker, `${MARKER_TURN2}<!-- socratic-engine:lesson=1 -->`)
})

test('turnMarker：没有讲次（null/0/负数/非整数/缺省）时逐字节等于旧标记', () => {
  for (const value of [null, undefined, 0, -1, 1.5, '3', Number.NaN]) {
    assert.equal(turnMarker(SESSION_ID, 2, value), MARKER_TURN2, `lesson=${String(value)} 不应产生讲次注释`)
  }
})

test('normalizeLesson：只有正整数算有讲次', () => {
  assert.equal(normalizeLesson(1), 1)
  assert.equal(normalizeLesson(14), 14)
  assert.equal(normalizeLesson(0), null)
  assert.equal(normalizeLesson(-2), null)
  assert.equal(normalizeLesson(null), null)
  assert.equal(normalizeLesson('2'), null)
})

test('renderSessionLogEntry：有讲次时标题带「第 N 讲」，其余逐字不变', () => {
  const facts = extractTurnFacts(EVENTS, { turn: 2 })
  facts.phase = PHASE
  facts.lesson = 1
  assert.equal(
    renderSessionLogEntry(facts, { marker: turnMarker(SESSION_ID, 2, 1), timeLabel: TIME_LABEL }),
    [
      `${MARKER_TURN2}<!-- socratic-engine:lesson=1 -->`,
      '### 第 2 回合 · 2026-09-23 21:03 · 相位 quiz · 第 1 讲',
      '- 学生：我不太懂 指针是什么',
      '- 工具：classroom_status（失败） ／ bash（未完成）',
    ].join('\n'),
  )
})

test('renderSessionLogEntry：无相位但有讲次时仍带讲次', () => {
  const facts = extractTurnFacts(EVENTS, { turn: 2 })
  facts.lesson = 3
  assert.equal(
    renderSessionLogEntry(facts, { marker: turnMarker(SESSION_ID, 2, 3), timeLabel: TIME_LABEL }).split('\n')[1],
    '### 第 2 回合 · 2026-09-23 21:03 · 第 3 讲',
  )
})

test('parseTurnMarkers：老记录（无 lesson）与新记录都能解析', () => {
  const text = [
    `${MARKER_TURN2}`,
    '### 第 2 回合 · 2026-09-23 21:03 · 相位 quiz',
    '',
    `${turnMarker('s2', 1, 4)}`,
    '### 第 1 回合 · 2026-09-24 10:00 · 相位 open · 第 4 讲',
    '',
    '<!-- socratic-engine:session=s3 turn=7 lesson=5 -->',
    '### 第 7 回合 · 2026-09-24 11:00 · 第 5 讲',
  ].join('\n')
  assert.deepEqual(
    parseTurnMarkers(text).map(({ session, turn, lesson }) => ({ session, turn, lesson })),
    [
      { session: SESSION_ID, turn: 2, lesson: null },
      { session: 's2', turn: 1, lesson: 4 },
      { session: 's3', turn: 7, lesson: 5 },
    ],
  )
})

test('parseTurnMarkers：空文本 / 非字符串不抛', () => {
  assert.deepEqual(parseTurnMarkers(''), [])
  assert.deepEqual(parseTurnMarkers(undefined), [])
})

test('renderSessionLogEntry：确切文本', () => {
  const facts = extractTurnFacts(EVENTS, { turn: 2 })
  facts.phase = PHASE
  assert.equal(
    renderSessionLogEntry(facts, { marker: MARKER_TURN2, timeLabel: TIME_LABEL }),
    [
      MARKER_TURN2,
      '### 第 2 回合 · 2026-09-23 21:03 · 相位 quiz',
      '- 学生：我不太懂 指针是什么',
      '- 工具：classroom_status（失败） ／ bash（未完成）',
    ].join('\n'),
  )
})

test('renderSessionLogEntry：无相位时省略相位段', () => {
  const facts = extractTurnFacts(EVENTS, { turn: 2 })
  const text = renderSessionLogEntry(facts, { marker: MARKER_TURN2, timeLabel: TIME_LABEL })
  assert.equal(text.split('\n')[1], '### 第 2 回合 · 2026-09-23 21:03')
})

test('appendEntryToContent：移除「尚无」占位行并追加到末尾', async () => {
  const original = await readFile(join(FIXTURES, 'session_log.md'), 'utf8')
  const expected = await readFile(join(FIXTURES, 'session_log.expected.md'), 'utf8')
  const facts = extractTurnFacts(EVENTS, { turn: 2 })
  facts.phase = PHASE
  const entry = renderSessionLogEntry(facts, { marker: MARKER_TURN2, timeLabel: TIME_LABEL })
  assert.equal(appendEntryToContent(original, entry), expected)
})

test('appendEntryToContent：幂等重入（把结果再当输入）不会丢内容', async () => {
  const expected = await readFile(join(FIXTURES, 'session_log.expected.md'), 'utf8')
  const again = appendEntryToContent(expected, 'X')
  assert.ok(again.includes(MARKER_TURN2))
  assert.ok(again.endsWith('\n\nX\n'))
})

test('formatLocalTime：本地时间 YYYY-MM-DD HH:mm', () => {
  assert.match(formatLocalTime(1789800000000), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
})

// ---------------------------------------------------------------- 端到端（注入 IO + 临时目录）

test('端到端：给定投影样本 → runtime/session_log.md 追加确切文本', async () => {
  const env = await setup()
  try {
    assert.equal(env.result.enabled, true)
    assert.ok(env.ctx.has('agent/turn-stopping'))
    await env.ctx.fire('agent/turn-stopping', { agent: env.agent, turn: 2, signal: { aborted: false } })
    const written = await readFile(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8')
    assert.equal(written, await readFile(join(FIXTURES, 'session_log.expected.md'), 'utf8'))
  } finally {
    await env.cleanup()
  }
})

test('端到端：幂等 —— 同一 turn 两次调用只写一次', async () => {
  const env = await setup()
  try {
    await env.ctx.fire('agent/turn-stopping', { agent: env.agent, turn: 2, signal: { aborted: false } })
    const first = await readFile(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8')
    await env.ctx.fire('agent/turn-stopping', { agent: env.agent, turn: 2, signal: { aborted: false } })
    const second = await readFile(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8')
    assert.equal(second, first)
    assert.equal(second.split(MARKER_TURN2).length - 1, 1, '去重标记只应出现一次')
  } finally {
    await env.cleanup()
  }
})

test('端到端：不同 turn 各写一条，互不覆盖', async () => {
  const env = await setup()
  try {
    await env.ctx.fire('agent/turn-stopping', { agent: env.agent, turn: 1, signal: { aborted: false } })
    await env.ctx.fire('agent/turn-stopping', { agent: env.agent, turn: 2, signal: { aborted: false } })
    const text = await readFile(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8')
    assert.ok(text.includes(turnMarker(SESSION_ID, 1)))
    assert.ok(text.includes(MARKER_TURN2))
    assert.ok(text.indexOf(turnMarker(SESSION_ID, 1)) < text.indexOf(MARKER_TURN2), '按时间顺序追加')
  } finally {
    await env.cleanup()
  }
})

test('端到端：空回合不写', async () => {
  const env = await setup({
    events: [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      {
        type: 'user/message',
        seq: 1,
        time: 2,
        data: { role: 'user', id: 'm', source: { kind: 'agent-instructions' }, content: [{ type: 'text', text: 'AGENTS' }] },
      },
    ],
  })
  try {
    const before = await readFile(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8')
    await env.ctx.fire('agent/turn-stopping', { agent: env.agent, turn: 1, signal: { aborted: false } })
    assert.equal(await readFile(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8'), before)
    assert.ok(env.logs.some((line) => line.includes('空回合')))
  } finally {
    await env.cleanup()
  }
})

test('端到端：runtime 目录不存在 → 不写、不崩、记录原因', async () => {
  const env = await setup({ runtime: false })
  try {
    await env.ctx.fire('agent/turn-stopping', { agent: env.agent, turn: 2, signal: { aborted: false } })
    await assert.rejects(stat(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE)), { code: 'ENOENT' })
    assert.ok(env.logs.some((line) => line.includes('runtimeDir 不存在')))
  } finally {
    await env.cleanup()
  }
})

test('端到端：runtime 目录在但目标文件缺失 → 不凭空造格式，记录原因', async () => {
  const env = await setup()
  try {
    await rm(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE))
    await env.ctx.fire('agent/turn-stopping', { agent: env.agent, turn: 2, signal: { aborted: false } })
    await assert.rejects(stat(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE)), { code: 'ENOENT' })
    assert.ok(env.logs.some((line) => line.includes('读')))
  } finally {
    await env.cleanup()
  }
})

test('端到端：signal 已 abort → 不写', async () => {
  const env = await setup()
  try {
    const before = await readFile(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8')
    await env.ctx.fire('agent/turn-stopping', { agent: env.agent, turn: 2, signal: { aborted: true } })
    assert.equal(await readFile(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8'), before)
  } finally {
    await env.cleanup()
  }
})

test('端到端：turn 非整数 → 不写', async () => {
  const env = await setup()
  try {
    const before = await readFile(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8')
    await env.ctx.fire('agent/turn-stopping', { agent: env.agent, turn: undefined, signal: { aborted: false } })
    assert.equal(await readFile(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8'), before)
  } finally {
    await env.cleanup()
  }
})

test('端到端：取不到 session → 不写、不崩', async () => {
  const env = await setup()
  try {
    const before = await readFile(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8')
    await env.ctx.fire('agent/turn-stopping', { agent: {}, turn: 2, signal: { aborted: false } })
    assert.equal(await readFile(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8'), before)
    assert.ok(env.logs.some((line) => line.includes('取不到 session')))
  } finally {
    await env.cleanup()
  }
})

test('端到端：updater 抛错也不得打断会话', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'socratic-postclass-'))
  try {
    const runtimeDir = join(dir, 'runtime')
    await mkdir(runtimeDir, { recursive: true })
    await writeFile(join(runtimeDir, 'session_log.md'), 'x\n')
    const ctx = makeCtx()
    const logs = []
    registerPostClass(ctx, {
      runtimeDir,
      updaters: [
        {
          file: 'session_log.md',
          render: () => {
            throw new Error('updater 崩了')
          },
        },
      ],
      atomicWrite: fakeIo,
      log: (...args) => logs.push(args.join(' ')),
    })
    await assert.doesNotReject(() =>
      ctx.fire('agent/turn-stopping', { agent: makeAgent(EVENTS), turn: 2, signal: { aborted: false } }),
    )
    assert.ok(logs.some((line) => line.includes('课后更新异常')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('端到端：opts 缺省（无 runtimeDir）→ 关闭且不抛', () => {
  const ctx = makeCtx()
  const result = registerPostClass(ctx, {})
  assert.equal(result.enabled, false)
  assert.equal(result.reason, 'runtimeDir 缺省')
  assert.equal(ctx.has('agent/turn-stopping'), false)
})

test('端到端：enabled=false → 不注册监听器', () => {
  const ctx = makeCtx()
  const result = registerPostClass(ctx, { runtimeDir: '/tmp/whatever', enabled: false })
  assert.equal(result.enabled, false)
  assert.equal(ctx.has('agent/turn-stopping'), false)
})

test('默认 updater 只声明 session_log.md（其余 7 个文件留接口不实现）', () => {
  assert.equal(SESSION_LOG_UPDATER.file, 'session_log.md')
  assert.equal(DEFAULT_SESSION_LOG_FILE, 'session_log.md')
})

test('端到端：runtimeDir 传函数时按回合求值（配合教室自动发现）', async () => {
  const env = await setup()
  try {
    let dir = null
    const ctx = makeCtx()
    const logs = []
    registerPostClass(ctx, {
      runtimeDir: () => dir,
      getPhase: () => PHASE,
      formatTime: () => TIME_LABEL,
      atomicWrite: fakeIo,
      log: (...args) => logs.push(args.join(' ')),
    })
    const before = await readFile(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8')
    await ctx.fire('agent/turn-stopping', { agent: env.agent, turn: 2, signal: { aborted: false } })
    assert.equal(await readFile(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8'), before, '函数返回 null 时不写')
    assert.ok(logs.some((line) => line.includes('runtimeDir 缺省')))

    dir = env.runtimeDir
    await ctx.fire('agent/turn-stopping', { agent: env.agent, turn: 2, signal: { aborted: false } })
    assert.equal(
      await readFile(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8'),
      await readFile(join(FIXTURES, 'session_log.expected.md'), 'utf8'),
    )
  } finally {
    await env.cleanup()
  }
})

test('端到端：写入权限位沿用教室现有 0600', async () => {
  const env = await setup()
  try {
    await env.ctx.fire('agent/turn-stopping', { agent: env.agent, turn: 2, signal: { aborted: false } })
    const info = await stat(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE))
    assert.equal(info.mode & 0o777, 0o600)
  } finally {
    await env.cleanup()
  }
})

// ── DRAW-2：端到端 —— 讲次进标记与标题，且不破坏老行为 ──────────────────────

test('端到端：getLesson 给出讲次 → 标记与标题都带讲次', async () => {
  const env = await setup({ lesson: 1 })
  try {
    await env.ctx.fire('agent/turn-stopping', { agent: env.agent, turn: 2, signal: { aborted: false } })
    const text = await readFile(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8')
    assert.ok(text.includes(`${MARKER_TURN2}<!-- socratic-engine:lesson=1 -->`), '标记应带讲次')
    assert.ok(text.includes('### 第 2 回合 · 2026-09-23 21:03 · 相位 quiz · 第 1 讲'), '标题应带讲次')
    const parsed = parseTurnMarkers(text)
    assert.deepEqual(parsed.map((m) => m.lesson), [1], '唯一一条记录带讲次')
    assert.deepEqual(parsed.map((m) => m.turn), [2])
  } finally {
    await env.cleanup()
  }
})

test('端到端：getLesson 返回 null → 逐字节等于升级前的期望文件', async () => {
  const env = await setup({ lesson: null })
  try {
    await env.ctx.fire('agent/turn-stopping', { agent: env.agent, turn: 2, signal: { aborted: false } })
    const text = await readFile(join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8')
    assert.equal(text, await readFile(join(FIXTURES, 'session_log.expected.md'), 'utf8'))
    assert.ok(!text.includes('socratic-engine:lesson='), '没有讲次就不许出现讲次注释')
  } finally {
    await env.cleanup()
  }
})

test('端到端：幂等跨格式 —— 文件里已有老格式标记时，同一回合不再追加', async () => {
  const env = await setup({ lesson: 1 })
  try {
    // 预置一条"升级前写的"老记录（同 session 同 turn，无 lesson 注释）
    const target = join(env.runtimeDir, DEFAULT_SESSION_LOG_FILE)
    const before = await readFile(target, 'utf8')
    await writeFile(target, `${before.replace(/\s+$/, '')}\n\n${MARKER_TURN2}\n### 第 2 回合 · 2026-09-23 21:03\n`)
    await env.ctx.fire('agent/turn-stopping', { agent: env.agent, turn: 2, signal: { aborted: false } })
    const text = await readFile(target, 'utf8')
    assert.equal(text.split('turn=2 -->').length - 1, 1, '老记录已存在 → 不得再追加第二条')
    assert.ok(!text.includes('socratic-engine:lesson='), '被跳过的回合不写讲次注释')
  } finally {
    await env.cleanup()
  }
})

// ──────────────────────────────────────────────────────────── K1：落盘前剥情绪标记

test('🔴 落盘前剥净情绪标记（K1.2 末：防御性，历史事件里可能带标记）', () => {
  const facts = {
    turn: 5,
    time: null,
    phase: 'probe',
    lesson: 3,
    studentTexts: ['FIFO 快吧？〔emo:puzzled:0.70〕', '那 SJF 呢〔emo:calm:0.50〕'],
    toolCalls: [],
    hasContent: true,
  }
  const entry = renderSessionLogEntry(facts, { marker: MARKER_TURN2, timeLabel: TIME_LABEL })
  assert.equal(entry.includes('emo:'), false, 'session_log 里不得出现标记原文')
  assert.match(entry, /FIFO 快吧？/)
  assert.match(entry, /那 SJF 呢/)
})

// ══════════════════════════════════════════════════════════════════════════════
// N 接线（2026-10-21）：N2.1 的**闲置兜底**
//   「学生至少 5 个回合发言 且 会话闲置超过 2 小时」→ 也算一节课结束，起一次日记。
//   判据用叙事服务的纯函数（不在引擎里另写阈值）；turn-stopping 里**任何异常都不许外抛**。
// ══════════════════════════════════════════════════════════════════════════════

const STUDENT_T0 = 1789800000000
const studentEvent = (seq, time, text = '嗯') => ({
  type: 'user/message',
  seq,
  time,
  data: {
    id: `m-${seq}`,
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text }],
  },
})

/** 造 n 条学生发言（每 10 分钟一条）。 */
const studentTurns = (n, start = STUDENT_T0) => Array.from({ length: n }, (_, i) => studentEvent(i, start + i * 600000, `第 ${i + 1} 句`))

/** 只测闲置兜底：铺一个 runtime/ 与一个只捕获 turn-stopping 的假 ctx。 */
async function setupIdle({ events, service, now = () => STUDENT_T0 + 5 * 600000 + 3 * 3600000, lesson = 2 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'socratic-postclass-idle-'))
  const runtimeDir = join(dir, 'runtime')
  await mkdir(runtimeDir, { recursive: true })
  await writeFile(join(runtimeDir, DEFAULT_SESSION_LOG_FILE), await readFile(join(FIXTURES, 'session_log.md'), 'utf8'))
  const ctx = makeCtx()
  const logs = []
  registerPostClass(ctx, {
    runtimeDir,
    getPhase: () => 'open',
    getLesson: () => lesson,
    getNarrative: () => service,
    getClassroomDir: () => '/tmp/classroom-idle',
    getDiaryModel: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
    now,
    formatTime: () => TIME_LABEL,
    atomicWrite: fakeIo,
    log: (...args) => logs.push(args.join(' ')),
  })
  return {
    dir,
    runtimeDir,
    ctx,
    logs,
    agent: makeAgent(events),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

const fireStopping = (ctx, agent, turn = 3) => ctx.fire('agent/turn-stopping', { agent, turn, signal: { aborted: false } })

test('summarizeStudentActivity：只数学生发言，时刻取**学生最后一次**（引擎注入不算学生还在）', () => {
  const events = [
    studentEvent(0, STUDENT_T0),
    { type: 'user/message', seq: 1, time: STUDENT_T0 + 10, data: { source: { kind: 'socratic-engine' }, content: [{ type: 'text', text: '注入块' }] } },
    studentEvent(2, STUDENT_T0 + 1000),
    { type: 'assistant/message', seq: 3, time: STUDENT_T0 + 9_999_999, data: { content: [{ type: 'text', text: '老师说了很久' }] } },
  ]
  assert.deepEqual(summarizeStudentActivity(events), { studentTurns: 2, lastActivityAt: STUDENT_T0 + 1000 })
  assert.deepEqual(summarizeStudentActivity([]), { studentTurns: 0, lastActivityAt: null })
})

test('闲置兜底：≥5 学生回合且闲置 >2h → 起一次日记（trigger=idle，讲次/教室/模型透传）', async () => {
  const s = await setupIdle({ events: studentTurns(5) })
  const calls = []
  const service = {
    isLessonIdleClosed: (input) => {
      calls.push(input)
      return { closed: true, reason: '学生发言 5 回合且闲置 180 分钟' }
    },
    runDiary: (request) => {
      calls.push(request)
      return { accepted: true, done: new Promise(() => {}) } // 永不落定：证明不 await
    },
  }
  const s2 = await setupIdle({ events: studentTurns(5), service })
  try {
    await fireStopping(s2.ctx, s2.agent)
    const verdict = calls.find((c) => c && typeof c === 'object' && 'studentTurns' in c)
    assert.deepEqual(verdict, { studentTurns: 5, lastActivityAt: STUDENT_T0 + 4 * 600000, now: STUDENT_T0 + 5 * 600000 + 3 * 3600000 })
    const request = calls.find((c) => c && typeof c === 'object' && 'trigger' in c)
    assert.equal(request.trigger, 'idle')
    assert.equal(request.sessionId, SESSION_ID)
    assert.equal(request.classroomDir, '/tmp/classroom-idle')
    assert.equal(request.lesson, 2)
    assert.deepEqual(request.model, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    assert.ok(s2.logs.some((m) => m.includes('闲置兜底命中')), '命中要留日志（兜底不是静默行为）')
  } finally {
    await s.cleanup()
    await s2.cleanup()
  }
})

test('闲置兜底：同一回合 turn-stopping 派发两次 → 只扫一次（回合级记账）', async () => {
  const calls = []
  const service = {
    isLessonIdleClosed: (input) => {
      calls.push(input)
      return { closed: false, reason: '闲置 10 分钟，未满 120 分钟' }
    },
  }
  const s = await setupIdle({ events: studentTurns(5), service })
  try {
    await fireStopping(s.ctx, s.agent, 7)
    await fireStopping(s.ctx, s.agent, 7)
    assert.equal(calls.length, 1, '第二次数不到 —— 同一回合不重复跑扫描')
    assert.ok(s.logs.some((m) => m.includes('闲置扫描本回合已跑过')))
    // 新回合仍然会扫（不是"一辈子只扫一次"）
    await fireStopping(s.ctx, s.agent, 8)
    assert.equal(calls.length, 2)
  } finally {
    await s.cleanup()
  }
})

test('闲置兜底：未达条件 → 不触发日记（但扫描仍然发生）', async () => {
  const calls = { idle: 0, diary: 0 }
  const service = {
    isLessonIdleClosed: () => {
      calls.idle += 1
      return { closed: false, reason: '学生发言 3 回合，未达 5' }
    },
    runDiary: () => {
      calls.diary += 1
      return { accepted: true, done: new Promise(() => {}) }
    },
  }
  const s = await setupIdle({ events: studentTurns(3), service })
  try {
    await fireStopping(s.ctx, s.agent)
    assert.equal(calls.idle, 1)
    assert.equal(calls.diary, 0)
  } finally {
    await s.cleanup()
  }
})

test('闲置兜底：叙事服务缺失 → 什么都不做、不崩（课堂照常）', async () => {
  const s = await setupIdle({ events: studentTurns(5), service: null })
  try {
    await fireStopping(s.ctx, s.agent)
    const log = await readFile(join(s.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8')
    assert.ok(log.includes(`turn=3`), '课后更新（session_log）照旧发生')
  } finally {
    await s.cleanup()
  }
})

test('闲置兜底：判据抛错 / 服务没有该方法 / runDiary 抛错 → 全部吞掉并记日志，turn-stopping 不抛', async () => {
  const throwing = await setupIdle({
    events: studentTurns(5),
    service: {
      isLessonIdleClosed: () => {
        throw new Error('判据炸了')
      },
    },
  })
  try {
    await fireStopping(throwing.ctx, throwing.agent, 4)
    assert.ok(throwing.logs.some((m) => m.includes('判据炸了')))
  } finally {
    await throwing.cleanup()
  }

  const missing = await setupIdle({ events: studentTurns(5), service: { runDiary: () => ({ accepted: true }) } })
  try {
    await fireStopping(missing.ctx, missing.agent, 5)
    assert.ok(missing.logs.some((m) => m.includes('没有 isLessonIdleClosed')))
  } finally {
    await missing.cleanup()
  }

  const runThrows = await setupIdle({
    events: studentTurns(5),
    service: {
      isLessonIdleClosed: () => ({ closed: true, reason: '够久了' }),
      runDiary: () => {
        throw new Error('runDiary 炸了')
      },
    },
  })
  try {
    await fireStopping(runThrows.ctx, runThrows.agent, 6)
    assert.ok(runThrows.logs.some((m) => m.includes('runDiary 炸了')))
    const log = await readFile(join(runThrows.runtimeDir, DEFAULT_SESSION_LOG_FILE), 'utf8')
    assert.ok(log.includes('turn=6'), 'runDiary 炸了也不影响课后更新')
  } finally {
    await runThrows.cleanup()
  }
})

test('闲置兜底：本回合没有内容（空回合）也会扫——空回合正是"学生走了"要覆盖的形状', async () => {
  let scanned = 0
  const service = {
    isLessonIdleClosed: () => {
      scanned += 1
      return { closed: false, reason: '未满' }
    },
  }
  const s = await setupIdle({ events: studentTurns(5), service })
  try {
    // turn 9 在事件里完全没有内容 → extractTurnFacts.hasContent=false（会走"空回合不写"早退）
    await fireStopping(s.ctx, s.agent, 9)
    assert.equal(scanned, 1, '扫描必须在空回合早退之前发生')
  } finally {
    await s.cleanup()
  }
})
