// test/runner.test.mjs — N1 的 AC 四件事：成功 / 模型报错 / 超时 / 输出格式不合法
// 全部用替身，**不真调模型**。

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ERROR_CODES, NarrativeError } from '../lib/errors.mjs'
import { createAgentRunner, resolveInside } from '../lib/runner.mjs'
import { fakeLlm } from './fake-llm.mjs'

const SCHEMA = { fields: { text: { type: 'string', required: true, minChars: 1, maxChars: 20 } } }

/** 固定路由的解析器（路由解析本身另有单测在 service.test.mjs）。 */
const route = () => ({ provider: 'test-provider', model: 'test-model' })

/** @param {object} [overrides] */
function makeRunner(overrides = {}) {
  const { llm: injected, ...rest } = overrides
  const llm = injected ?? fakeLlm({ text: '{"text":"好"}' })
  return { llm, runner: createAgentRunner({ llm: () => llm, resolveRoute: route, now: () => 1000, ...rest }) }
}

test('成功：结构化输出被解析，apply 收到的就是模型给的值', async () => {
  const { runner, llm } = makeRunner({ llm: fakeLlm({ text: '{"text":"记录笔漏了一滴"}' }) })
  let applied = null
  const result = await runner.runTask({
    task: 'demo',
    system: '你是测试',
    prompt: '写一条',
    schema: SCHEMA,
    apply: async (value) => {
      applied = value
      return { writes: [{ path: '/tmp/demo.md', bytes: 10 }] }
    },
  })
  assert.equal(result.value.text, '记录笔漏了一滴')
  assert.deepEqual(applied, { text: '记录笔漏了一滴' })
  assert.deepEqual(result.writes, [{ path: '/tmp/demo.md', bytes: 10 }])
  assert.equal(result.provider, 'test-provider')
  assert.equal(result.model, 'test-model')
  // 提示词里必须同时有任务说明、正文、输出格式声明（N1.1 的"输入=文件+说明、输出=结构化"）
  assert.equal(llm.calls.length, 1)
  assert.equal(llm.calls[0].system, '你是测试')
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.match(prompt, /写一条/)
  assert.match(prompt, /只输出一个 JSON 对象/)
  assert.match(prompt, /不超过 20 字/)
})

test('成功：每次运行都是全新上下文（两次调用之间不共享任何历史）', async () => {
  const { runner, llm } = makeRunner({ llm: fakeLlm({ text: '{"text":"一"}' }) })
  const spec = { task: 'demo', system: '你是测试', prompt: '写一条', schema: SCHEMA }
  await runner.runTask(spec)
  await runner.runTask(spec)
  assert.equal(llm.calls.length, 2)
  // 每次都只有一条 user 消息，没有累积任何历史
  for (const call of llm.calls) {
    assert.equal(call.messages.length, 1)
    assert.equal(call.messages[0].role, 'user')
  }
  // 而且**不传工具**（fresh context 的另一半：不继承教室工具）
  assert.equal(llm.calls[0].tools, undefined)
})

test('成功：inputs 里的文件被逐字读进提示词', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'narr-runner-'))
  await mkdir(join(dir, 'runtime'), { recursive: true })
  await writeFile(join(dir, 'runtime', 'session_log.md'), '第一讲：他卡在地址翻译。\n', 'utf8')
  const { runner, llm } = makeRunner({ llm: fakeLlm({ text: '{"text":"好"}' }) })
  await runner.runTask({
    task: 'demo',
    system: '你是测试',
    prompt: '写一条',
    root: dir,
    inputs: [{ label: 'runtime/session_log.md', path: 'runtime/session_log.md' }],
    schema: SCHEMA,
  })
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.match(prompt, /<<<FILE runtime\/session_log\.md/)
  assert.match(prompt, /第一讲：他卡在地址翻译。/)
})

test('模型报错：finish.kind=error → MODEL_ERROR，且带得上 failure 消息', async () => {
  const { runner } = makeRunner({ llm: fakeLlm({ finish: 'error', failure: { message: '429 rate limited', code: 'RATE_LIMITED' } }) })
  await assert.rejects(
    () => runner.runTask({ task: 'demo', system: 's', prompt: 'p', schema: SCHEMA }),
    (error) => {
      assert.ok(error instanceof NarrativeError)
      assert.equal(error.code, ERROR_CODES.MODEL_ERROR)
      assert.match(error.message, /429 rate limited/)
      assert.equal(error.detail.finishKind, 'error')
      return true
    },
  )
})

test('模型报错：stream 同步抛 → MODEL_ERROR（不是把异常原样漏出去）', async () => {
  const { runner } = makeRunner({ llm: fakeLlm({ throwOnStart: new Error('连接被重置') }) })
  await assert.rejects(
    () => runner.runTask({ task: 'demo', system: 's', prompt: 'p', schema: SCHEMA }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.MODEL_ERROR)
      assert.match(error.message, /连接被重置/)
      return true
    },
  )
})

test('模型报错：迭代中途抛 → MODEL_ERROR', async () => {
  const { runner } = makeRunner({ llm: fakeLlm({ throwMidStream: new Error('流断了') }) })
  await assert.rejects(
    () => runner.runTask({ task: 'demo', system: 's', prompt: 'p', schema: SCHEMA }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.MODEL_ERROR)
      assert.match(error.message, /流断了/)
      return true
    },
  )
})

test('模型报错：宿主没有 llm 服务 → MODEL_ERROR（不静默返回空文本）', async () => {
  const runner = createAgentRunner({ llm: () => undefined, resolveRoute: route, now: () => 1000 })
  await assert.rejects(
    () => runner.runTask({ task: 'demo', system: 's', prompt: 'p', schema: SCHEMA }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.MODEL_ERROR)
      assert.match(error.message, /ctx\.llm\.stream 不可用/)
      return true
    },
  )
})

test('超时：模型永不产出 → TIMEOUT（不靠适配器自己停）', async () => {
  const { runner } = makeRunner({ llm: fakeLlm({ hang: true }) })
  const startedAt = Date.now()
  await assert.rejects(
    () => runner.runTask({ task: 'demo', system: 's', prompt: 'p', schema: SCHEMA, timeoutMs: 30 }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.TIMEOUT)
      assert.match(error.message, /30ms/)
      return true
    },
  )
  // 真的在预算附近返回了，而不是挂住
  assert.ok(Date.now() - startedAt < 2000, '超时后应当很快返回')
})

test('超时：max-tokens 截断单独报（别让下游误判成"模型乱写"）', async () => {
  const { runner } = makeRunner({ llm: fakeLlm({ text: '{"text":"半截', finish: 'max-tokens' }) })
  await assert.rejects(
    () => runner.runTask({ task: 'demo', system: 's', prompt: 'p', schema: SCHEMA }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.MODEL_ERROR)
      assert.equal(error.detail.reason, 'MAX_TOKENS')
      return true
    },
  )
})

test('输出格式不合法：不是 JSON → INVALID_OUTPUT', async () => {
  const { runner } = makeRunner({ llm: fakeLlm({ text: '好的，这是今天的日记。' }) })
  await assert.rejects(
    () => runner.runTask({ task: 'demo', system: 's', prompt: 'p', schema: SCHEMA }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.INVALID_OUTPUT)
      assert.equal(error.detail.reason, 'NOT_JSON')
      return true
    },
  )
})

test('输出格式不合法：缺必填字段 → INVALID_OUTPUT（不补默认值）', async () => {
  const { runner } = makeRunner({ llm: fakeLlm({ text: '{"other":"x"}' }) })
  await assert.rejects(
    () => runner.runTask({ task: 'demo', system: 's', prompt: 'p', schema: SCHEMA }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.INVALID_OUTPUT)
      assert.deepEqual(error.detail.issues, ['缺必填字段 text'])
      return true
    },
  )
})

test('输出格式不合法：超字数 → INVALID_OUTPUT（**不**静默截断）', async () => {
  const long = '字'.repeat(21)
  const { runner } = makeRunner({ llm: fakeLlm({ text: JSON.stringify({ text: long }) }) })
  await assert.rejects(
    () => runner.runTask({ task: 'demo', system: 's', prompt: 'p', schema: SCHEMA }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.INVALID_OUTPUT)
      assert.match(error.message, /超过上限 20/)
      return true
    },
  )
})

test('输出格式不合法：JSON 是数组 → INVALID_OUTPUT', async () => {
  const { runner } = makeRunner({ llm: fakeLlm({ text: '["a"]' }) })
  await assert.rejects(
    () => runner.runTask({ task: 'demo', system: 's', prompt: 'p', schema: SCHEMA }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.INVALID_OUTPUT)
      assert.equal(error.detail.reason, 'NOT_OBJECT')
      return true
    },
  )
})

test('输出格式不合法：空输出 → INVALID_OUTPUT', async () => {
  const { runner } = makeRunner({ llm: fakeLlm({ text: '' }) })
  await assert.rejects(
    () => runner.runTask({ task: 'demo', system: 's', prompt: 'p', schema: SCHEMA }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.INVALID_OUTPUT)
      assert.equal(error.detail.reason, 'EMPTY')
      return true
    },
  )
})

test('读输入失败 → IO_ERROR（不把缺文件当成空内容）', async () => {
  const { runner } = makeRunner()
  await assert.rejects(
    () =>
      runner.runTask({
        task: 'demo',
        system: 's',
        prompt: 'p',
        root: '/tmp',
        inputs: [{ label: '不存在', path: 'definitely-not-here-12345.md' }],
        schema: SCHEMA,
      }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.IO_ERROR)
      assert.equal(error.detail.reason, 'READ_FAILED')
      return true
    },
  )
})

test('apply 没返回 writes → IO_ERROR（写没写清楚不算成功）', async () => {
  const { runner } = makeRunner()
  await assert.rejects(
    () => runner.runTask({ task: 'demo', system: 's', prompt: 'p', schema: SCHEMA, apply: async () => ({}) }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.IO_ERROR)
      assert.equal(error.detail.reason, 'NO_WRITES')
      return true
    },
  )
})

test('resolveInside 挡住 ../ 越界写', () => {
  assert.equal(resolveInside('/tmp/classroom', 'runtime/diary.md'), '/tmp/classroom/runtime/diary.md')
  assert.throws(
    () => resolveInside('/tmp/classroom', '../etc/passwd'),
    (error) => error.code === ERROR_CODES.IO_ERROR && error.detail.reason === 'PATH_ESCAPE',
  )
})

test('真实写盘一次：读文件 → 调模型 → 写文件（AC 的离线版）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'narr-e2e-'))
  await mkdir(join(dir, 'runtime'), { recursive: true })
  await writeFile(join(dir, 'runtime', 'in.md'), '材料正文\n', 'utf8')
  const { runner } = makeRunner({ llm: fakeLlm({ text: '{"text":"看见了"}' }) })
  const result = await runner.runTask({
    task: 'demo',
    system: 's',
    prompt: 'p',
    root: dir,
    inputs: [{ label: 'runtime/in.md', path: 'runtime/in.md' }],
    schema: SCHEMA,
    apply: async (value) => {
      const target = resolveInside(dir, 'runtime/out.md')
      await writeFile(target, `${value.text}\n`, 'utf8')
      return { writes: [{ path: target, bytes: Buffer.byteLength(value.text, 'utf8') }] }
    },
  })
  assert.equal(await readFile(join(dir, 'runtime', 'out.md'), 'utf8'), '看见了\n')
  assert.equal(result.writes.length, 1)
})
