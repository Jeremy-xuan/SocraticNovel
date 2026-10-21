// test/service.test.mjs — 服务层：runDiary 的异步性、幂等、失败可见（N1.3 / N1.4 / N2.1）
//
// 这里不碰宿主：`llm` 是替身，`ctx` 不参与。测的是「引擎调我之后能观察到什么」。

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createNarrativeService } from '../index.mjs'
import { ERROR_CODES } from '../lib/errors.mjs'
import { DIARY_RELATIVE, readDiaryLedger, readRecentDiaries } from '../lib/diary.mjs'
import { fakeInstanceModel, fakeLlm } from './fake-llm.mjs'

const HEADER = `# 日记（她的）

> **写法规则**：第一人称、短、不解释、不抒情。**只写她注意到的具体细节**。
> 每课一条，**不超过 120 字**。

---

`

/** @param {Record<string,string>} files */
async function makeClassroom(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'narr-svc-'))
  const all = {
    [DIARY_RELATIVE]: HEADER,
    'runtime/session_log.md': '## 记录\n\n第 3 讲：他卡在页表与 TLB 的关系。\n',
    'runtime/notes.jsonl': `${JSON.stringify({ v: 1, type: 'misconception', lesson: 3, kp: 'KP-3.2', quote: '页表就是缓存吧', note: '混了页表与 TLB' })}\n`,
    'classroom.yaml': 'format: socratic-classroom/0\nclassroom:\n  id: test\nblocks:\n  - id: persona\n    path: characters/deepseek.md\n',
    'characters/deepseek.md': '# 鲸（DeepSeek 娘）· 本教室版本\n\n> 教学方式：把思路外化。\n',
    '_anchor.md': '## 角色声音速查（生成任何台词前看一眼）\n\n- **鲸**：开口时慢、低、句子短。\n\n## 教学检查\n\n- 学生是否知道我刚问的是什么？\n',
    'world/setting.md': '# 世界观\n\n观测站建在礁盘上，水线从房间中间穿过。\n',
    'runtime/wechat_group.md': '# 群聊记录\n\n值班员：今天风大。\n',
    ...files,
  }
  for (const [relative, content] of Object.entries(all)) {
    const target = join(dir, relative)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  return dir
}

/** @param {object} options */
function makeService({ llm, config = {}, now = () => 1_700_000_000_000 } = {}) {
  return createNarrativeService({ llm: () => llm, instanceModel: fakeInstanceModel(), config, now, log: () => {} })
}

test('路由：调用参数 > config.models > config.provider/model > 实例默认', async () => {
  const dir = await makeClassroom()
  const cases = [
    {
      name: '调用参数优先',
      config: { provider: 'c-provider', model: 'c-model', models: { diary: { provider: 'm-provider', model: 'm-model' } } },
      request: { model: { provider: 'a-provider', model: 'a-model' } },
      expect: 'a-provider',
    },
    {
      name: 'config.models.diary 次之',
      config: { provider: 'c-provider', model: 'c-model', models: { diary: { provider: 'm-provider', model: 'm-model' } } },
      request: {},
      expect: 'm-provider',
    },
    {
      name: 'config.provider/model 再次',
      config: { provider: 'c-provider', model: 'c-model' },
      request: {},
      expect: 'c-provider',
    },
    { name: '最后落到实例默认模型', config: {}, request: {}, expect: 'deepseek-official' },
  ]
  for (const item of cases) {
    const llm = fakeLlm({ text: '{"text":"好。"}' })
    const service = makeService({ llm, config: item.config })
    await service.runDiary({ sessionId: `s-${item.expect}`, classroomDir: dir, lesson: 1, ...item.request }).done
    assert.equal(llm.calls.at(-1).provider, item.expect, item.name)
  }
})

test('路由：四处都取不到 → ROUTE_MISSING，日志与 status 都有记录（不猜模型）', async () => {
  const dir = await makeClassroom()
  const llm = fakeLlm({ text: '{"text":"好。"}' })
  const service = createNarrativeService({ llm: () => llm, instanceModel: () => undefined, config: {}, now: () => 1, log: () => {} })
  const outcome = await service.runDiary({ sessionId: 's1', classroomDir: dir, lesson: 1 }).done
  assert.equal(outcome.ok, false)
  assert.equal(outcome.error.code, ERROR_CODES.ROUTE_MISSING)
  assert.equal(llm.calls.length, 0)
  const status = service.status()
  assert.equal(status.ok, false)
  assert.equal(status.lastError.code, ERROR_CODES.ROUTE_MISSING)
})

test('成功：写一条日记 + 账本，status() 转绿，且写入路径在 status 之外的日志里留痕', async () => {
  const dir = await makeClassroom()
  const llm = fakeLlm({ text: '{"text":"记录板下沿干了一道白边。"}' })
  const service = makeService({ llm })

  const handle = service.runDiary({ sessionId: 's1', classroomDir: dir, lesson: 3, trigger: 'close' })
  assert.equal(handle.accepted, true)
  assert.equal(handle.state, 'running')
  const outcome = await handle.done
  assert.equal(outcome.ok, true)
  assert.equal(outcome.state, 'ok')

  const markdown = await readFile(join(dir, DIARY_RELATIVE), 'utf8')
  assert.match(markdown, /### \d{4}-\d{2}-\d{2} · 第 3 讲\n记录板下沿干了一道白边。/)
  const ledger = await readDiaryLedger({ classroomDir: dir })
  assert.equal(ledger.entries.length, 1)
  assert.equal(ledger.entries[0].sessionId, 's1')
  assert.equal(ledger.entries[0].lesson, 3)
  assert.equal(ledger.entries[0].chars, [...'记录板下沿干了一道白边。'].length)

  const status = service.status()
  assert.equal(status.ok, true)
  assert.equal(status.lastError, null)
  assert.equal(status.recent.at(-1).state, 'ok')

  // 运行日志（JSONL）也落了盘——跨重启可查
  const log = await service.runLogPath(dir)
  const lines = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(lines.length, 1)
  assert.equal(lines[0].state, 'ok')
  assert.equal(lines[0].task, 'diary')
})

test('幂等：同一节课触发两次 → 第二次 skipped，正文只有一条', async () => {
  const dir = await makeClassroom()
  const service = makeService({ llm: fakeLlm({ text: '{"text":"只写这一条。"}' }) })
  await service.runDiary({ sessionId: 's1', classroomDir: dir, lesson: 3 }).done
  const second = await service.runDiary({ sessionId: 's1', classroomDir: dir, lesson: 3 }).done
  assert.equal(second.ok, true)
  assert.equal(second.state, 'skipped')
  const { entries } = await readRecentDiaries({ classroomDir: dir, limit: 10 })
  assert.equal(entries.length, 1)
})

test('异步性：runDiary 立刻返回，模型还没答（不阻塞课堂回合）', async () => {
  const dir = await makeClassroom()
  let release
  const gate = new Promise((resolveGate) => {
    release = resolveGate
  })
  const slowLlm = {
    calls: [],
    stream(options) {
      this.calls.push(options)
      return (async function* slow() {
        await gate
        yield { type: 'text-delta', index: 0, text: '{"text":"慢。"}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const service = makeService({ llm: slowLlm })
  const startedAt = Date.now()
  const handle = service.runDiary({ sessionId: 's1', classroomDir: dir, lesson: 1 })
  assert.ok(Date.now() - startedAt < 100, 'runDiary 必须立刻返回')
  assert.equal(service.status().active.length, 1, '在跑的运行要能在 status 里看到')
  release()
  await handle.done
  assert.equal(service.status().active.length, 0)
})

test('失败可见：模型报错 → status().lastError 有码有消息，且不 reject 调用方', async () => {
  const dir = await makeClassroom()
  const service = makeService({ llm: fakeLlm({ finish: 'error', failure: { message: '模型挂了' } }) })
  const handle = service.runDiary({ sessionId: 's1', classroomDir: dir, lesson: 3 })
  const outcome = await handle.done
  assert.equal(outcome.ok, false)
  assert.equal(outcome.error.code, ERROR_CODES.MODEL_ERROR)
  const status = service.status()
  assert.equal(status.ok, false)
  assert.equal(status.lastError.code, ERROR_CODES.MODEL_ERROR)
  assert.match(status.lastError.message, /模型挂了/)
  // 失败时**不许**留下半条日记
  const { entries } = await readRecentDiaries({ classroomDir: dir, limit: 10 })
  assert.equal(entries.length, 0)
})

test('失败可见：输出格式不合法 → INVALID_OUTPUT（日记超 120 字走这条，不写盘）', async () => {
  const dir = await makeClassroom()
  const service = makeService({ llm: fakeLlm({ text: JSON.stringify({ text: '字'.repeat(121) }) }) })
  const outcome = await service.runDiary({ sessionId: 's1', classroomDir: dir, lesson: 3 }).done
  assert.equal(outcome.ok, false)
  assert.equal(outcome.error.code, ERROR_CODES.INVALID_OUTPUT)
  const markdown = await readFile(join(dir, DIARY_RELATIVE), 'utf8')
  assert.equal(markdown, HEADER)
})

test('失败可见：状态是冻结的只读快照（改不动内部）', async () => {
  const dir = await makeClassroom()
  const service = makeService({ llm: fakeLlm({ finish: 'error', failure: { message: 'x' } }) })
  await service.runDiary({ sessionId: 's1', classroomDir: dir, lesson: 1 }).done
  const status = service.status()
  assert.ok(Object.isFrozen(status))
  assert.throws(() => {
    'use strict'
    status.lastError.code = 'HACKED'
  })
  assert.notEqual(service.status().lastError.code, 'HACKED')
})

test('参数缺失：不给 sessionId / classroomDir → 明确拒绝，不写任何东西', async () => {
  const dir = await makeClassroom()
  const service = makeService({ llm: fakeLlm({ text: '{"text":"好。"}' }) })
  const noSession = service.runDiary({ classroomDir: dir, lesson: 1 })
  assert.equal(noSession.accepted, false)
  assert.equal(noSession.reason, 'NO_SESSION')
  const noClassroom = service.runDiary({ sessionId: 's1', lesson: 1 })
  assert.equal(noClassroom.accepted, false)
  assert.equal(noClassroom.reason, 'NO_CLASSROOM')
})

test('提示词里用的是最近三条日记（不含更早的）', async () => {
  const dir = await makeClassroom({
    [DIARY_RELATIVE]: `${HEADER}
### 2026-10-10 · 第 1 讲
很早的一条。

### 2026-10-11 · 第 2 讲
第二条。

### 2026-10-12 · 第 3 讲
第三条。

### 2026-10-13 · 第 4 讲
第四条。
`,
  })
  const llm = fakeLlm({ text: '{"text":"好。"}' })
  const service = makeService({ llm })
  await service.runDiary({ sessionId: 's1', classroomDir: dir, lesson: 5 }).done
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.doesNotMatch(prompt, /很早的一条/)
  assert.match(prompt, /第二条。/)
  assert.match(prompt, /第三条。/)
  assert.match(prompt, /第四条。/)
})

test('输入真的进了提示词：课堂记录、角色声音、群聊都在（N2.2）', async () => {
  const dir = await makeClassroom()
  const llm = fakeLlm({ text: '{"text":"好。"}' })
  const service = makeService({ llm })
  await service.runDiary({ sessionId: 's1', classroomDir: dir, lesson: 3 }).done
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.match(prompt, /页表就是缓存吧/)
  assert.match(prompt, /开口时慢、低、句子短/)
  assert.match(prompt, /今天风大/)
  // 教学检查段不该被塞进来（角色声音段按标题切）
  assert.doesNotMatch(prompt, /学生是否知道我刚问的是什么/)
})

// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-21：`config.models` 的键是**开放集合**，未知键必须报错而不是忽略
//   （被静默忽略时实际生效的是实例默认模型，人只会在事后发现"怎么调了模型没变"）
// ─────────────────────────────────────────────────────────────────────────────

test('models 任务名是开放集合：diary / group / review 都能配', () => {
  for (const task of ['diary', 'group', 'review']) {
    assert.doesNotThrow(() =>
      createNarrativeService({
        llm: () => fakeLlm({}),
        instanceModel: fakeInstanceModel(),
        config: { models: { [task]: { provider: 'p', model: 'm' } } },
        now: () => 1,
        log: () => {},
      }),
    )
  }
})

test('🔴 models 里出现没实现的任务名 → INVALID_CONFIG（不静默忽略）', () => {
  assert.throws(
    () =>
      createNarrativeService({
        llm: () => fakeLlm({}),
        instanceModel: fakeInstanceModel(),
        config: { models: { diaryy: { provider: 'p', model: 'm' } } },
        now: () => 1,
        log: () => {},
      }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.INVALID_CONFIG)
      assert.equal(error.detail.reason, 'UNKNOWN_TASK')
      assert.deepEqual(error.detail.known, ['diary', 'group', 'review'])
      return true
    },
  )
})

test('🔴 models.<task> 不是 {provider, model} → INVALID_CONFIG', () => {
  assert.throws(
    () =>
      createNarrativeService({
        llm: () => fakeLlm({}),
        instanceModel: fakeInstanceModel(),
        config: { models: { diary: { provider: 'p' } } },
        now: () => 1,
        log: () => {},
      }),
    (error) => error.code === ERROR_CODES.INVALID_CONFIG && error.detail.reason === 'BAD_ROUTE',
  )
})
