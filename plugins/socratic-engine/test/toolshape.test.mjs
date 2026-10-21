// test/toolshape.test.mjs — lib/toolshape.mjs（本地 defineTool）的单测（B2，2026-10-21）
//
// 🔴 纪律：不起宿主、不联网、不落盘；只 import lib/toolshape.mjs。
//
// 期望值**不是**凭印象写的：`docs/历史报告/实现报告_B2_去宿主包依赖_2026-10-21.md` §1
// 记录了这些用例与真宿主 `@deepseek-ai/dsh-tools@0.2.1-rc.2` 的逐字段/逐文案比对结果
// （5 组 definition 深等 + 21 组参数校验逐字一致）。改了这里的期望值，就要重跑那个比对。
//
// 覆盖：
//   ① 作者面 schema → raw JSON Schema 子集的编译（required 上提、additionalProperties 必填、
//      type:'json' 无约束、oneOf、enum/const、注解透传）
//   ② execute 的参数校验：合法放行、非法抛 ToolArgsError（消息与宿主逐字一致）
//   ③ 作者面写错时报错（不是静默生出一份坏 schema）
//   ④ presentCall / presentResult / isConcurrencySafe 的软校验

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ToolArgsError, compileParameters, compileValueSchema, defineTool, validateArgs } from '../lib/toolshape.mjs'

/** 造一个最小工具声明（只关心 schema 时用）。 */
function makeTool(overrides = {}) {
  return {
    name: 'probe',
    description: 'probe',
    parameters: {},
    output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'x' }] },
    execute: async () => 'ok',
    ...overrides,
  }
}

test('编译：parameters 的 required 从属性上提到对象根，顺序按声明', () => {
  const compiled = compileParameters({
    lesson: { type: 'integer', required: true },
    kind: { type: 'string', required: true, enum: ['a', 'b'] },
    title: { type: 'string', description: '标题' },
  })
  assert.deepEqual(compiled, {
    type: 'object',
    properties: {
      lesson: { type: 'integer' },
      kind: { type: 'string', enum: ['a', 'b'] },
      title: { type: 'string', description: '标题' },
    },
    required: ['lesson', 'kind'],
  })
})

test('编译：没有必填项时**不出现** required 键（宿主同样省略）', () => {
  const compiled = compileParameters({ a: { type: 'string' } })
  assert.equal(Object.hasOwn(compiled, 'required'), false)
})

test("编译：type:'json' 编译成只有注解、没有 type 的节点（无约束 JSON）", () => {
  assert.deepEqual(compileValueSchema({ type: 'json' }), {})
  assert.deepEqual(compileValueSchema({ type: 'json', description: 'd' }), { description: 'd' })
})

test('编译：object 必须显式写 additionalProperties；嵌套对象的 required 同样上提', () => {
  const schema = compileValueSchema({
    type: 'object',
    additionalProperties: false,
    properties: {
      board: {
        type: 'object',
        additionalProperties: true,
        properties: { kind: { type: 'string', required: true } },
      },
    },
  })
  assert.deepEqual(schema, {
    type: 'object',
    additionalProperties: false,
    properties: {
      board: { type: 'object', additionalProperties: true, properties: { kind: { type: 'string' } }, required: ['kind'] },
    },
  })
})

test('编译：数组 items 与 oneOf 分支', () => {
  assert.deepEqual(compileParameters({ list: { type: 'array', items: { type: 'integer' } } }).properties.list, {
    type: 'array',
    items: { type: 'integer' },
  })
  assert.deepEqual(compileParameters({ v: { oneOf: [{ type: 'string' }, { type: 'null' }] } }).properties.v, {
    oneOf: [{ type: 'string' }, { type: 'null' }],
  })
})

test('编译：注解（description/title/default/examples）原样透传', () => {
  const compiled = compileValueSchema({
    type: 'integer',
    description: 'd',
    title: 't',
    default: 3,
    examples: [1, 2],
  })
  assert.deepEqual(compiled, { description: 'd', title: 't', default: 3, examples: [1, 2], type: 'integer' })
})

test('编译：作者面写错 → 报错（缺 additionalProperties / required 非 true / 未知键 / oneOf 单支 / 未知 type）', () => {
  assert.throws(() => compileParameters({ v: { type: 'object', properties: {} } }), /additionalProperties must be explicitly true or false/)
  assert.throws(() => compileParameters({ v: { type: 'string', required: false } }), /required must be true when present/)
  assert.throws(() => compileParameters({ v: { type: 'string', pattern: 'x' } }), /pattern is not a supported key/)
  assert.throws(() => compileParameters({ v: { oneOf: [{ type: 'string' }] } }), /at least two value schemas/)
  assert.throws(() => compileParameters({ v: { type: 'tuple' } }), /must be string\/number\/integer\/boolean\/null\/array\/object\/json/)
  // 根上不许写 required（它只属于属性位）
  assert.throws(() => compileValueSchema({ type: 'object', additionalProperties: false, required: ['a'], properties: {} }), /required is not a supported key/)
})

test('defineTool：definition 的键与宿主一致（name/description/parameters/output/execute）', () => {
  const tool = defineTool(makeTool())
  assert.deepEqual(Object.keys(tool).sort(), ['description', 'execute', 'name', 'output', 'parameters'])
  assert.deepEqual(Object.keys(tool.output).sort(), ['render', 'schema'])
  assert.equal(typeof tool.output.render, 'function')
})

test('defineTool：presentationMeta / timeoutMs / deferLoading 该带的带、不该带的不带', () => {
  const tool = defineTool(
    makeTool({
      output: {
        schema: { type: 'object', additionalProperties: true, properties: {} },
        render: () => [],
        presentationMeta: (_args, value) => ({ board: value.board }),
      },
      timeoutMs: 5000,
      deferLoading: true,
    }),
  )
  assert.equal(typeof tool.output.presentationMeta, 'function')
  assert.equal(tool.timeoutMs, 5000)
  assert.equal(tool.deferLoading, true)
  assert.throws(() => defineTool(makeTool({ timeoutMs: 0 })), /timeoutMs must be a positive finite number/)
  assert.throws(() => defineTool(makeTool({ output: { schema: { type: 'string' } } })), /must declare output/)
})

test('execute：合法参数原样进用户实现', async () => {
  const tool = defineTool(
    makeTool({
      parameters: { lesson: { type: 'integer', required: true }, note: { type: 'string' } },
      execute: async (args) => args.lesson,
    }),
  )
  assert.equal(await tool.execute({ lesson: 3, note: 'n' }, {}), 3)
})

test('execute：非法参数抛 ToolArgsError，消息与宿主逐字一致', async () => {
  const tool = defineTool(
    makeTool({
      parameters: {
        lesson: { type: 'integer', required: true },
        kind: { type: 'string', required: true, enum: ['flowchart', 'sequence'] },
      },
      execute: async () => 'never',
    }),
  )
  await assert.rejects(tool.execute({ kind: 'sequence' }, {}), (error) => {
    assert.equal(error.name, 'ToolArgsError')
    assert.equal(error.code, 'INVALID_ARGS')
    assert.equal(error.message, 'invalid arguments: missing required property "lesson"')
    return true
  })
  await assert.rejects(tool.execute({ lesson: '3', kind: 'sequence' }, {}), /"lesson" must be an integer/)
  await assert.rejects(tool.execute({ lesson: 1, kind: 'pie' }, {}), /"kind" must be one of \["flowchart","sequence"\]/)
  await assert.rejects(tool.execute('nope', {}), /"arguments" must be an object/)
})

test('validateArgs：嵌套/数组/json 位置的三类判据', () => {
  const parameters = compileParameters({
    nested: { type: 'object', additionalProperties: false, properties: { a: { type: 'string', required: true } } },
    list: { type: 'array', items: { type: 'integer' } },
    free: { type: 'json' },
  })
  assert.deepEqual(validateArgs(parameters, { nested: { a: 'x' }, list: [1, 2], free: { q: 1 } }), [])
  assert.deepEqual(validateArgs(parameters, { nested: { a: 'x', b: 1 } }), [
    '"nested.b" is not a declared property (additionalProperties: false)',
  ])
  assert.deepEqual(validateArgs(parameters, { nested: {} }), ['missing required property "nested.a"'])
  assert.deepEqual(validateArgs(parameters, { list: [1, 'x'] }), ['"list[1]" must be an integer'])
  assert.deepEqual(validateArgs(parameters, { free: { v: NaN } }), ['"free" must be a lossless JSON value'])
  // 稀疏数组走"整串必须无损"这条（宿主一样：洞不进元素校验）
  // eslint-disable-next-line no-sparse-arrays
  assert.deepEqual(validateArgs(parameters, { list: [, 1] }), ['"list" must be a dense lossless JSON array'])
})

test('软校验：参数非法时 presentCall/presentResult 退回 undefined、isConcurrencySafe 退回 false', () => {
  const tool = defineTool(
    makeTool({
      parameters: { lesson: { type: 'integer', required: true } },
      presentCall: (args) => ({ label: `L${args.lesson}` }),
      presentResult: () => ({ done: true }),
      isConcurrencySafe: () => true,
    }),
  )
  assert.deepEqual(tool.presentCall({ lesson: 2 }), { label: 'L2' })
  assert.equal(tool.presentCall({ lesson: 'x' }), undefined)
  assert.deepEqual(tool.presentResult({ lesson: 2 }, {}), { done: true })
  assert.equal(tool.presentResult({ lesson: 'x' }, {}), undefined)
  assert.equal(tool.isConcurrencySafe({ lesson: 2 }), true)
  assert.equal(tool.isConcurrencySafe({ lesson: 'x' }), false)
})

test('ToolArgsError 是普通 Error（不是宿主 HarnessError）——这是已知差异，不是 bug', () => {
  const error = new ToolArgsError(['a', 'b'])
  assert.equal(error instanceof Error, true)
  assert.equal(error.message, 'invalid arguments: a; b')
  assert.deepEqual(error.violations, ['a', 'b'])
})
