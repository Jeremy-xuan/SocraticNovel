// test/protocol.test.mjs — 结构化输出的解析与校验（N4.2 的「一次生成几条」需要数组）
//
// 这一组补的是「数组字段」：`protocol.mjs` 的原有三种类型（string/integer/boolean）
// 在 N1/N2 里够用，N4 的定时消息要一次生成 N 条，所以扩了 `array`（元素只支持字符串）。
// 活体验证抓到过这个缺口（schema 里写了 array，校验器不认，生成直接判 INVALID_OUTPUT）。

import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeStructured, describeSchema, parseStructured, validateAgainstSchema } from '../lib/protocol.mjs'
import { ERROR_CODES } from '../lib/errors.mjs'

const schema = {
  fields: {
    messages: { type: 'array', itemType: 'string', required: true, minItems: 2, maxItems: 2, itemMaxChars: 6 },
  },
}

test('数组：项数、元素类型、每项字数都按声明校验', () => {
  assert.deepEqual(validateAgainstSchema({ messages: ['一', '二'] }, schema), [])
  assert.match(validateAgainstSchema({ messages: ['一'] }, schema).join(), /少于下限 2/)
  assert.match(validateAgainstSchema({ messages: ['一', '二', '三'] }, schema).join(), /超过上限 2/)
  assert.match(validateAgainstSchema({ messages: ['一', 2] }, schema).join(), /第 2 项应为字符串/)
  assert.match(validateAgainstSchema({ messages: ['一二三四五六七', '二'] }, schema).join(), /第 1 项有 7 字/)
  assert.match(validateAgainstSchema({ messages: '一二' }, schema).join(), /应为数组/)
  assert.match(validateAgainstSchema({}, schema).join(), /缺必填字段 messages/)
})

test('数组：元素字数按 Unicode 码点算（代理对算 1 个字）', () => {
  const wide = { fields: { messages: { type: 'array', required: true, itemMaxChars: 2 } } }
  assert.deepEqual(validateAgainstSchema({ messages: ['𠮷𠮷'] }, wide), [])
  assert.match(validateAgainstSchema({ messages: ['𠮷𠮷𠮷'] }, wide).join(), /有 3 字/)
})

test('数组：元素类型只支持 string，写别的类型是声明错误', () => {
  const bad = { fields: { items: { type: 'array', itemType: 'integer' } } }
  assert.match(validateAgainstSchema({ items: [1] }, bad).join(), /不在允许集合 string/)
})

test('数组：describeSchema 把项数上限写进提示词（模型看得到）', () => {
  const text = describeSchema(schema)
  assert.match(text, /messages: 数组，元素是字符串，必填，至少 2 项，最多 2 项，每项不超过 6 字/)
})

test('decodeStructured：数组字段照样只有一条出口（不合法就抛 INVALID_OUTPUT）', () => {
  assert.deepEqual(decodeStructured('{"messages":["一","二"]}', schema), { messages: ['一', '二'] })
  assert.throws(
    () => decodeStructured('{"messages":["一"]}', schema),
    (error) => error.code === ERROR_CODES.INVALID_OUTPUT && error.detail.reason === 'SCHEMA',
  )
})

test('parseStructured：围栏只剥一层，其余原样', () => {
  assert.deepEqual(parseStructured('```json\n{"a":1}\n```'), { a: 1 })
  assert.throws(() => parseStructured('不是 JSON'), (error) => error.detail.reason === 'NOT_JSON')
  assert.throws(() => parseStructured('[]'), (error) => error.detail.reason === 'NOT_OBJECT')
})
