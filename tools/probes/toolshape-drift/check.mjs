#!/usr/bin/env node
// tools/probes/toolshape-drift/check.mjs — 宿主升级后的**漂移探针**（B2，2026-10-21）
//
// 背景：插件不再 import `@deepseek-ai/dsh-tools`（0.2.1 删掉了安装版回退目录，import 就会把
// 宿主包装进 profile，违反验收铁律③），`defineTool` 由 `plugins/socratic-engine/lib/toolshape.mjs`
// 本地复刻。这份复刻**没有**任何自动的"宿主改了没"的保护 —— 所以要有这个探针：
// 拿一份**真的** `@deepseek-ai/dsh-tools` 与本地实现同时编译同一批工具声明，
// 逐字段、逐条错误文案比对，只要有一处分叉就非零退出。
//
// 用法（探针目录里不装依赖，宿主包由你给路径；装到一个临时目录即可）：
//
//   mkdir -p /tmp/dsh-tools-ref && cd /tmp/dsh-tools-ref && npm init -y >/dev/null \
//     && npm i @deepseek-ai/dsh-tools@0.2.1-rc.2
//   node tools/probes/toolshape-drift/check.mjs /tmp/dsh-tools-ref/node_modules/@deepseek-ai/dsh-tools
//
// 退出码：0 = 一致；1 = 有漂移（打印第一处差异与全部用例结论）；2 = 用法/加载错误。
//
// 🔴 什么时候该跑：① 宿主版本升级；② 给工具加了新的 schema 特性（object/additionalProperties/
//    数组/oneOf/enum…）；③ 改了 lib/toolshape.mjs。语料集在下面 `SPEC_CASES`，加新特性就加用例。

import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname
const OUR_TOOLSHAPE = join(HERE, '..', '..', '..', 'plugins', 'socratic-engine', 'lib', 'toolshape.mjs')

const target = process.argv[2]
if (target === undefined) {
  console.error('用法：node tools/probes/toolshape-drift/check.mjs <path-to-@deepseek-ai/dsh-tools>')
  process.exit(2)
}
const hostEntry = join(target, 'lib', 'index.js')
if (!existsSync(hostEntry)) {
  console.error(`找不到宿主入口：${hostEntry}（第一个参数要指到 dsh-tools 包目录）`)
  process.exit(2)
}

const host = await import(pathToFileURL(hostEntry).href)
const ours = await import(pathToFileURL(OUR_TOOLSHAPE).href)
if (typeof host.defineTool !== 'function' || typeof host.validateArgs !== 'function') {
  console.error('宿主 dsh-tools 没导出 defineTool / validateArgs —— 契约变了，先读它再改探针')
  process.exit(2)
}

/** 语料：覆盖本仓库工具用到的全部作者面特性 + 边界。 */
const SPEC_CASES = [
  {
    label: '空参数 + 全必填对象 output（classroom_status）',
    parameters: {},
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        classroom: { type: 'string', required: true },
        turn: { type: 'integer', required: true },
        skipped: { type: 'array', required: true, items: { type: 'integer' } },
      },
    },
  },
  {
    label: '一个必填 string（classroom_set_phase）',
    parameters: { phase: { type: 'string', required: true, description: 'd' } },
    schema: { type: 'object', additionalProperties: false, properties: { persisted: { type: 'boolean', required: true } } },
  },
  {
    label: 'enum + 可选参数（classroom_draw）',
    parameters: {
      kind: { type: 'string', required: true, enum: ['flowchart', 'sequence', 'state'], description: 'k' },
      source: { type: 'string', required: true, description: 's' },
      title: { type: 'string', description: 't' },
    },
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        board: { type: 'object', additionalProperties: true, properties: { kind: { type: 'string', required: true } } },
      },
    },
  },
  {
    label: 'type:json 参数 + 嵌套数组 output（classroom_animate_template）',
    parameters: {
      prepId: { type: 'string', description: 'p' },
      template: { type: 'string', enum: ['a', 'b'], description: 't' },
      params: { type: 'json', description: 'q' },
    },
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tasks: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { id: { type: 'string', required: true }, state: { type: 'string', required: true } },
          },
        },
        note: { type: 'string', required: true },
      },
    },
  },
  { label: 'oneOf 联合', parameters: { v: { oneOf: [{ type: 'string' }, { type: 'integer' }] } }, schema: { type: 'string' } },
  {
    label: '注解四件套 + const/enum',
    parameters: {
      n: { type: 'number', default: 1, examples: [1, 2], title: 't', description: 'd' },
      c: { type: 'string', const: 'fixed' },
      e: { type: 'integer', enum: [1, 2, 3] },
    },
    schema: { type: 'null' },
  },
]

/** 作者面写错时两边都必须抛（错误文案各写各的，只比"是否都拒绝"）。 */
const BAD_CASES = [
  { label: 'object 缺 additionalProperties', parameters: { v: { type: 'object', properties: {} } } },
  { label: 'required: false', parameters: { v: { type: 'string', required: false } } },
  { label: 'oneOf 单支', parameters: { v: { oneOf: [{ type: 'string' }] } } },
  { label: 'oneOf 与 type 同写', parameters: { v: { oneOf: [{ type: 'string' }, { type: 'null' }], type: 'string' } } },
  { label: '未知键', parameters: { v: { type: 'string', pattern: 'x' } } },
  { label: '未知 type', parameters: { v: { type: 'tuple' } } },
  { label: 'enum 空数组', parameters: { v: { type: 'string', enum: [] } } },
]

/** 参数值语料（对着第一组 parameters 校验）。 */
const VALUE_CASES = [
  { label: '合法全量', args: { classroom: 'cs-os', turn: 3, skipped: [1, 2] } },
  { label: '缺必填', args: { turn: 3 } },
  { label: '类型错', args: { classroom: 'cs-os', turn: '3' } },
  { label: '整数给小数', args: { classroom: 'cs-os', turn: 1.5 } },
  { label: '数组元素类型错', args: { classroom: 'cs-os', turn: 1, skipped: [1, 'x'] } },
  { label: '多余键（根开放）', args: { classroom: 'cs-os', turn: 1, extra: true } },
  { label: '非对象', args: 'nope' },
  { label: '稀疏数组', args: { classroom: 'cs-os', turn: 1, skipped: [, 2] } },
]

const failures = []
const report = (ok, label, detail = '') => {
  console.log(`${ok ? '✔' : '✘'} ${label}${ok || detail === '' ? '' : `\n    ${detail}`}`)
  if (!ok) failures.push(label)
}

const build = (defineTool, parameters, schema) =>
  defineTool({
    name: 'probe',
    description: 'probe',
    parameters,
    output: { schema, render: () => [] },
    execute: async () => ({}),
  })

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log(`宿主入口：${hostEntry}`)
console.log(`本地实现：${OUR_TOOLSHAPE}\n`)

for (const testCase of SPEC_CASES) {
  let hostTool
  let ourTool
  try {
    hostTool = build(host.defineTool, testCase.parameters, testCase.schema)
    ourTool = build(ours.defineTool, testCase.parameters, testCase.schema)
  } catch (error) {
    report(false, `${testCase.label}（编译抛错）`, error.message)
    continue
  }
  const fieldOk = same(hostTool.parameters, ourTool.parameters)
  const schemaOk = same(hostTool.output.schema, ourTool.output.schema)
  const keysOk = same(Object.keys(hostTool).sort(), Object.keys(ourTool).sort())
  report(
    fieldOk && schemaOk && keysOk,
    `编译：${testCase.label}`,
    !fieldOk
      ? `parameters 分叉：\n    host=${JSON.stringify(hostTool.parameters)}\n    ours=${JSON.stringify(ourTool.parameters)}`
      : !schemaOk
        ? `output.schema 分叉：\n    host=${JSON.stringify(hostTool.output.schema)}\n    ours=${JSON.stringify(ourTool.output.schema)}`
        : `definition 键分叉：host=${Object.keys(hostTool).sort()} ours=${Object.keys(ourTool).sort()}`,
  )
}

for (const testCase of BAD_CASES) {
  let hostThrew = false
  let ourThrew = false
  try {
    build(host.defineTool, testCase.parameters, { type: 'string' })
  } catch {
    hostThrew = true
  }
  try {
    build(ours.defineTool, testCase.parameters, { type: 'string' })
  } catch {
    ourThrew = true
  }
  report(hostThrew === ourThrew, `作者错误：${testCase.label}`, `host 抛=${hostThrew}，ours 抛=${ourThrew}`)
}

for (const testCase of VALUE_CASES) {
  const hostViolations = host.validateArgs(SPEC_CASES[0].parameters, testCase.args)
  const ourViolations = ours.validateArgs(ours.compileParameters(SPEC_CASES[0].parameters), testCase.args)
  report(
    same(hostViolations, ourViolations),
    `参数校验：${testCase.label}`,
    `host=${JSON.stringify(hostViolations)}\n    ours=${JSON.stringify(ourViolations)}`,
  )
}

console.log('')
if (failures.length > 0) {
  console.error(`🔴 漂移：${failures.length} 处不一致 —— 宿主契约变了，改 lib/toolshape.mjs 之前先读宿主源码`)
  for (const label of failures) console.error(`  · ${label}`)
  process.exit(1)
}
console.log(`✔ 一致：${SPEC_CASES.length} 组编译 + ${BAD_CASES.length} 组作者错误 + ${VALUE_CASES.length} 组参数校验`)
