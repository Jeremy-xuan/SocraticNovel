// test/narrative-wiring.test.mjs — 引擎侧接线（N2.1 收课触发 / N2.4 下节课注入）的集成单测
//
// 打的是**真 index.mjs 的 apply()**（假 ctx、假叙事服务），走的是真的工具 execute 与
// 真的 `agent/pre-step` 注入链——和 lessonjump.test.mjs 的 ⑨ 同一手法。
//
// 覆盖（逐条对应任务书 EC）：
//   · 收课相位 close → 日记在 **persistPhase 写盘之后**才被触发，且**不 await**（done 挂着也返回）
//   · 同一回合两次 close → 只触发一次
//   · 叙事服务不存在 → 引擎照常启动、set_phase 照常成功、注入块给占位行
//   · runDiary 抛错 → set_phase 照常成功（引擎不崩）
//   · 下一节课（讲次变化）→ 注入里有刚写的那条日记；同一讲内不重复注入群聊/日记块
//
// 纪律：不调 LLM、不起宿主、不碰 $DSH_HOME；教室是从真 classrooms/cs-os **复制**到临时目录的。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const CS_OS = join(HERE, '..', '..', '..', 'classrooms', 'cs-os')

const dirs = []
test.after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

/** 复制真教室到一个临时目录（所有写操作都只落在这里）。 */
async function copyClassroom() {
  const dir = await mkdtemp(join(tmpdir(), 'socratic-narrative-wiring-'))
  dirs.push(dir)
  await cp(CS_OS, dir, { recursive: true })
  return dir
}

/** 假 ctx：多监听器（index.mjs 会往同名事件上挂好几个处理器）＋ 可选叙事服务。 */
function makeCtx({ narrative = undefined, group = undefined } = {}) {
  const listeners = new Map()
  const injectCalls = []
  const sections = []
  const toolsByName = new Map()
  return {
    logger: () => ({ info: () => {} }),
    on(name, handler) {
      const list = listeners.get(name) ?? []
      list.push(handler)
      listeners.set(name, list)
    },
    async fire(name, ...args) {
      const list = listeners.get(name) ?? []
      assert.ok(list.length > 0, `未注册 ${name} 监听器`)
      let result
      for (const handler of list) result = await handler(...args)
      return result
    },
    listeners(name) {
      return listeners.get(name) ?? []
    },
    inject(deps, callback) {
      injectCalls.push({ deps, callback })
      // 真实的 cordis 会等服务出现再跑 callback；这里不模拟（服务缺席时它就该一直 PENDING）。
    },
    get(name) {
      if (name === 'narrative') return narrative
      if (name === 'classroomGroup') return group
      return undefined
    },
    systemPrompt: { section: (section) => sections.push(section) },
    tools: { register: (tool) => toolsByName.set(tool.name, tool) },
    injectCalls,
    sections,
    toolMap: toolsByName,
  }
}

async function boot({ narrative = undefined, group = undefined, classroomDir } = {}) {
  const { apply } = await import('../index.mjs')
  const ctx = makeCtx({ narrative, group })
  const dir = classroomDir ?? (await copyClassroom())
  await apply(ctx, { classroomDir: dir, animation: { python: '/usr/bin/true', manim: '/usr/bin/true' } })
  return { ctx, dir }
}

const SESSION = 'session-lane-e2'
const execWithSession = { agent: { session: { id: SESSION } } }
const enter = async () => ({ kind: 'enter', messages: [] })

/** 取本回合注入里某块的正文（source.block = 块 id）。 */
function textOf(messages, blockId) {
  for (const message of messages) {
    if (message?.source?.block === blockId) {
      return (message.content ?? []).map((b) => b?.text ?? '').join('\n')
    }
  }
  return null
}

// ══════════════════════════════════════════════════════════════════════════════
// ① 收课触发：顺序、不阻塞、同回合一次
// ══════════════════════════════════════════════════════════════════════════════

test('收课 close：在 persistPhase 写盘**之后**触发日记；不 await done；参数带上讲次/教室/模型', async () => {
  const requests = []
  const progressSeen = []
  let resolveDone
  const done = new Promise((resolve) => {
    resolveDone = resolve
  })
  const narrative = {
    runDiary: (request) => {
      requests.push(request)
      // 触发时盘上必须**已经**是 close（这就是"写盘之后"的直接证据）
      progressSeen.push(readFileSync(join(request.classroomDir, 'runtime', 'progress.md'), 'utf8'))
      return { accepted: true, runId: 'run-1', state: 'running', done }
    },
  }
  const { ctx, dir } = await boot({ narrative })
  const tool = ctx.toolMap.get('classroom_set_phase')
  const value = await tool.execute({ phase: 'close' }, execWithSession)

  assert.equal(value.phase, 'close')
  assert.equal(value.persisted, true)
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0], { sessionId: SESSION, classroomDir: await realpath(dir), lesson: 1, trigger: 'close' })
  assert.match(progressSeen[0], /^current_phase: close$/m, '触发日记时相位必须已经落盘')
  // 不 await：done 还挂着，工具已经返回了
  resolveDone({ ok: true, state: 'ok', writes: [] })
  await done
})

test('收课 close：同一回合里 open→close 两次切换，日记只触发一次（回合级记账）', async () => {
  const requests = []
  const narrative = {
    runDiary: (request) => {
      requests.push(request)
      return { accepted: true, runId: 'run-1', state: 'running', done: new Promise(() => {}) }
    },
  }
  const { ctx } = await boot({ narrative })
  const tool = ctx.toolMap.get('classroom_set_phase')

  // 第一次：切到 close（触发）
  await tool.execute({ phase: 'close' }, execWithSession)
  // 同一回合：open → close（previous !== close，但仍属同一回合 → 不重复调用）
  await tool.execute({ phase: 'open' }, execWithSession)
  await tool.execute({ phase: 'close' }, execWithSession)
  assert.equal(requests.length, 1, '同一回合只触发一次（幂等由叙事服务的 session+lesson 兜第二道）')

  // 下一回合（turn 递增）再收课 → 允许再调（叙事服务会按 session+lesson 判 skipped）
  await ctx.fire('agent/pre-step', { agent: { session: { id: SESSION } }, turn: 2, step: 1 }, enter)
  await tool.execute({ phase: 'open' }, execWithSession)
  await tool.execute({ phase: 'close' }, execWithSession)
  assert.equal(requests.length, 2)
})

test('收课 close：close → close 是 no-op，不算一次收课（不触发）', async () => {
  const requests = []
  const narrative = {
    runDiary: (request) => {
      requests.push(request)
      return { accepted: true, done: new Promise(() => {}) }
    },
  }
  const { ctx } = await boot({ narrative })
  const tool = ctx.toolMap.get('classroom_set_phase')
  await tool.execute({ phase: 'close' }, execWithSession)
  await tool.execute({ phase: 'close' }, execWithSession)
  assert.equal(requests.length, 1)
})

test('收课 close：叙事服务不存在 → set_phase 照常成功，不抛（引擎照常启动）', async () => {
  const { ctx } = await boot({ narrative: undefined })
  const tool = ctx.toolMap.get('classroom_set_phase')
  const value = await tool.execute({ phase: 'close' }, execWithSession)
  assert.equal(value.phase, 'close')
  assert.equal(value.persisted, true)
  // 服务键仍然被登记在案（嵌套 inject），只是没装 → 那段一直 PENDING
  assert.deepEqual(ctx.injectCalls[0].deps, ['narrative'])
})

test('收课 close：runDiary 抛错 → set_phase 照常成功（引擎不崩，错误只进日志）', async () => {
  const narrative = {
    runDiary: () => {
      throw new Error('借来的实现炸了')
    },
  }
  const { ctx } = await boot({ narrative })
  const tool = ctx.toolMap.get('classroom_set_phase')
  const value = await tool.execute({ phase: 'close' }, execWithSession)
  assert.equal(value.phase, 'close')
  assert.equal(value.persisted, true)
})

test('收课 close：取不到 sessionId → 不触发（叙事服务需要它做幂等键），也不抛', async () => {
  const requests = []
  const narrative = {
    runDiary: (request) => {
      requests.push(request)
      return { accepted: true, done: new Promise(() => {}) }
    },
  }
  const { ctx } = await boot({ narrative })
  const tool = ctx.toolMap.get('classroom_set_phase')
  const value = await tool.execute({ phase: 'close' }, {}) // 没有 agent
  assert.equal(value.phase, 'close')
  assert.equal(requests.length, 0)
})

// ══════════════════════════════════════════════════════════════════════════════
// ② 下一节课注入（N2.4 / N3.5）：讲次门 ＋ 相位门 ＋ 既有记账
// ══════════════════════════════════════════════════════════════════════════════

test('open 相位：注入最近一条日记与最近群聊（内容来自叙事服务 / jsonl）', async () => {
  const dir = await copyClassroom()
  // 写一条日记（服务替身只回它）、一份群聊 jsonl
  const narrative = {
    readRecentDiaries: async ({ limit }) => {
      assert.equal(limit, 1)
      return { entries: [{ date: '2026-10-21', lesson: 1, text: '回程时浪把浮标推歪了一格。' }], bad: 0 }
    },
  }
  await writeFile(
    join(dir, 'runtime', 'wechat_group.jsonl'),
    [
      JSON.stringify({ ts: '2026-10-20T23:15:00-04:00', role: 'student', speaker: '你', text: '在吗', kind: 'message' }),
      JSON.stringify({ ts: '2026-10-20T23:16:00-04:00', role: 'character', speaker: '鲸', text: '在。刚把浮标扶正。', kind: 'message' }),
    ].join('\n') + '\n',
    'utf8',
  )
  const { ctx } = await boot({ narrative, classroomDir: dir })

  const decision = await ctx.fire(
    'agent/pre-step',
    { agent: { session: { id: SESSION } }, turn: 1, step: 1 },
    enter,
  )
  const diary = textOf(decision.messages, 'state.diary.recent')
  const group = textOf(decision.messages, 'state.wechat.recent')
  assert.ok(diary !== null, 'open 相位必须注入最近一条日记块')
  assert.match(diary, /你最近写的一条日记（2026-10-21 · 第 1 讲）：/)
  assert.match(diary, /回程时浪把浮标推歪了一格。/)
  assert.ok(group !== null, 'open 相位必须注入最近群聊块')
  assert.match(group, /群里的最近 2 条/)
  assert.match(group, /你：在吗/)
  assert.match(group, /鲸：在。刚把浮标扶正。/)
})

test('服务不存在 / 群聊文件不存在 → 注入占位行，不报错（块仍然出现，频率门才算数）', async () => {
  const dir = await copyClassroom()
  // 这份副本里没有 wechat_group.jsonl，也没有叙事服务
  const { ctx } = await boot({ narrative: undefined, classroomDir: dir })
  const decision = await ctx.fire(
    'agent/pre-step',
    { agent: { session: { id: SESSION } }, turn: 1, step: 1 },
    enter,
  )
  assert.match(textOf(decision.messages, 'state.diary.recent'), /（这次读不到你的日记：叙事服务没有装载。）/)
  assert.match(textOf(decision.messages, 'state.wechat.recent'), /（群里还没有消息。）/)
})

test('同一讲内不重复；讲次一变（progress.md 改成第 2 讲）→ 下一回合重新注入最近一条日记', async () => {
  const dir = await copyClassroom()
  let diaryText = '旧的日记。'
  const narrative = {
    readRecentDiaries: async () => ({ entries: [{ date: '2026-10-21', lesson: 1, text: diaryText }], bad: 0 }),
  }
  const { ctx } = await boot({ narrative, classroomDir: dir })

  const turn1 = await ctx.fire('agent/pre-step', { agent: { session: { id: SESSION } }, turn: 1, step: 1 }, enter)
  assert.ok(turn1.messages.some((m) => m.source?.block === 'state.diary.recent'))

  // 同一讲、仍是 open：第二回合不该再注入（每讲一次）
  const turn2 = await ctx.fire('agent/pre-step', { agent: { session: { id: SESSION } }, turn: 2, step: 1 }, enter)
  assert.ok(!turn2.messages.some((m) => m.source?.block === 'state.diary.recent'), '同一讲只注入一次')

  // 收课 → 新日记落盘 → progress.md 推进到第 2 讲（下节课）
  await ctx.toolMap.get('classroom_set_phase').execute({ phase: 'close' }, execWithSession)
  await ctx.fire('agent/pre-step', { agent: { session: { id: SESSION } }, turn: 3, step: 1 }, enter)
  await ctx.toolMap.get('classroom_set_phase').execute({ phase: 'open' }, execWithSession)
  diaryText = '回程时浪把浮标推歪了一格。'
  const progress = await readFile(join(dir, 'runtime', 'progress.md'), 'utf8')
  await writeFile(join(dir, 'runtime', 'progress.md'), progress.replace(/^current_lesson: 1$/m, 'current_lesson: 2'), 'utf8')

  const turn4 = await ctx.fire('agent/pre-step', { agent: { session: { id: SESSION } }, turn: 4, step: 1 }, enter)
  const diary = textOf(turn4.messages, 'state.diary.recent')
  assert.ok(diary !== null, '换讲之后必须重新注入（"下一节课读到"）')
  assert.match(diary, /回程时浪把浮标推歪了一格。/)
})

test('close 相位：日记/群聊块不注入（相位门 phase: open）', async () => {
  const dir = await copyClassroom()
  const narrative = { readRecentDiaries: async () => ({ entries: [{ date: '2026-10-21', lesson: 1, text: '嗯。' }], bad: 0 }) }
  const { ctx } = await boot({ narrative, classroomDir: dir })
  await ctx.toolMap.get('classroom_set_phase').execute({ phase: 'close' }, execWithSession)
  const decision = await ctx.fire('agent/pre-step', { agent: { session: { id: SESSION } }, turn: 2, step: 1 }, enter)
  assert.ok(!decision.messages.some((m) => m.source?.block === 'state.diary.recent'))
  assert.ok(!decision.messages.some((m) => m.source?.block === 'state.wechat.recent'))
})


// ══════════════════════════════════════════════════════════════════════════════
// ⑥ N3.4：群聊活动上报（课堂进行中不回群靠它）
// ══════════════════════════════════════════════════════════════════════════════

test('N3.4 每个回合把会话/相位/讲次报给群聊服务（群聊才知道课堂在不在上）', async () => {
  const calls = []
  const group = { setClassroomActivity: (input) => calls.push(input) }
  const { ctx, dir } = await boot({ group })

  await ctx.fire('agent/pre-step', { agent: { session: { id: SESSION } }, turn: 1, step: 1 }, enter)

  assert.equal(calls.length, 1, '一个回合应上报恰好一次')
  const [call] = calls
  assert.equal(call.sessionId, SESSION)
  assert.equal(call.classroomDir, await realpath(dir), '教室目录必须是引擎真正在用的那个')
  assert.equal(typeof call.phase, 'string')
  assert.ok(call.phase.length > 0, '相位不能是空串')
  assert.equal(typeof call.lastActivityAt, 'number', '活动时间应是毫秒时间戳')
  assert.ok(call.lastActivityAt > 0)
})

test('N3.4 群聊服务不存在 → 引擎照常进入这一回合（不抛、不静默改行为）', async () => {
  const { ctx } = await boot()
  const decision = await ctx.fire(
    'agent/pre-step',
    { agent: { session: { id: SESSION } }, turn: 1, step: 1 },
    enter,
  )
  assert.equal(decision.kind, 'enter')
})

test('N3.4 上报自己抛错 → 只记日志，课堂照常进入（旁路不许打断学生这一轮）', async () => {
  const logs = []
  const group = {
    setClassroomActivity: () => {
      throw new Error('群聊服务内部炸了')
    },
  }
  const { ctx } = await boot({ group })
  ctx.logger = () => ({ info: (line) => logs.push(String(line)) })

  const decision = await ctx.fire(
    'agent/pre-step',
    { agent: { session: { id: SESSION } }, turn: 1, step: 1 },
    enter,
  )
  assert.equal(decision.kind, 'enter', '上报失败不许影响注入决策')
})
