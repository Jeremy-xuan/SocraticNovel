// lib/protocol.mjs — 模型结构化输出的解析与确定性校验（N1.1 + N2.3）
//
// 契约：被调模型**只回一个 JSON 对象**（运行器在提示词末尾以确定性文本写明字段）。
// 这里是唯一的解析与校验入口：
//   · 解析失败 / 不是对象 / 缺必填 / 类型不对 / 超字数 → 抛 `INVALID_OUTPUT`
//   · **绝不静默截断、绝不补默认值、绝不"尽量解析"**（N2.3 明确要求超长判格式不合法）
//
// 字段声明（schema）的形状故意很小，够用且零依赖：
//   {
//     fields: {
//       text: { type: 'string', required: true, maxChars: 120, minChars: 1 },
//       note: { type: 'string' },
//     },
//   }
//   type ∈ 'string' | 'integer' | 'boolean' | 'array'
//   array 只支持「元素是字符串」（N4.2 的「一次生成当天几条」用得到），带 minItems/maxItems/itemMaxChars。

import { NarrativeError, ERROR_CODES } from './errors.mjs'
import { charCount } from './text.mjs'

/** 允许的字段类型。 */
export const FIELD_TYPES = Object.freeze(['string', 'integer', 'boolean', 'array'])

/**
 * 去掉模型常见的一层 ``` 围栏，其余原样保留。
 *
 * 为什么允许这一步：JSON 围栏是**协议层**的常见包装，不是内容；剥一层是确定性的（有单测），
 * 不改变正文一个字。**只剥最外一层**，嵌套围栏不剥（那多半是模型跑偏了，应当判不合法）。
 * @param {string} text
 * @returns {string}
 */
export function stripCodeFence(text) {
  const trimmed = text.trim()
  const fenced = /^```[a-zA-Z0-9_-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(trimmed)
  return fenced === null ? trimmed : fenced[1].trim()
}

/**
 * 解析模型的文本输出为一个 JSON 对象。
 * @param {string} text
 * @returns {Record<string, unknown>}
 * @throws {NarrativeError} INVALID_OUTPUT
 */
export function parseStructured(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new NarrativeError(ERROR_CODES.INVALID_OUTPUT, '模型没有返回任何文本', { detail: { reason: 'EMPTY' } })
  }
  const body = stripCodeFence(text)
  let value
  try {
    value = JSON.parse(body)
  } catch (cause) {
    throw new NarrativeError(ERROR_CODES.INVALID_OUTPUT, '模型输出不是合法 JSON', {
      cause,
      detail: { reason: 'NOT_JSON', head: body.slice(0, 200) },
    })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new NarrativeError(ERROR_CODES.INVALID_OUTPUT, '模型输出的 JSON 不是对象', {
      detail: { reason: 'NOT_OBJECT', actual: Array.isArray(value) ? 'array' : typeof value },
    })
  }
  return value
}

/**
 * 按 schema 校验一个已解析的值。返回问题清单（空数组＝合法）。
 * @param {Record<string, unknown>} value
 * @param {{fields: Record<string, {type?: string, required?: boolean, maxChars?: number, minChars?: number}>}} schema
 * @returns {string[]}
 */
export function validateAgainstSchema(value, schema) {
  /** @type {string[]} */
  const issues = []
  const fields = schema?.fields ?? {}
  for (const [name, rule] of Object.entries(fields)) {
    const present = Object.prototype.hasOwnProperty.call(value, name)
    const raw = value[name]
    if (!present || raw === null || raw === undefined) {
      if (rule.required === true) issues.push(`缺必填字段 ${name}`)
      continue
    }
    const type = rule.type ?? 'string'
    if (type === 'string') {
      if (typeof raw !== 'string') {
        issues.push(`字段 ${name} 应为字符串，实际 ${typeof raw}`)
        continue
      }
      const length = charCount(raw)
      if (rule.minChars !== undefined && length < rule.minChars) {
        issues.push(`字段 ${name} 只有 ${length} 字，少于下限 ${rule.minChars}`)
      }
      if (rule.maxChars !== undefined && length > rule.maxChars) {
        issues.push(`字段 ${name} 有 ${length} 字，超过上限 ${rule.maxChars}`)
      }
      continue
    }
    if (type === 'array') {
      if (!Array.isArray(raw)) {
        issues.push(`字段 ${name} 应为数组，实际 ${typeof raw}`)
        continue
      }
      if (rule.minItems !== undefined && raw.length < rule.minItems) {
        issues.push(`字段 ${name} 有 ${raw.length} 项，少于下限 ${rule.minItems}`)
      }
      if (rule.maxItems !== undefined && raw.length > rule.maxItems) {
        issues.push(`字段 ${name} 有 ${raw.length} 项，超过上限 ${rule.maxItems}`)
      }
      const itemType = rule.itemType ?? 'string'
      if (itemType !== 'string') {
        issues.push(`字段 ${name} 的元素类型 ${itemType} 不在允许集合 string 里`)
        continue
      }
      raw.forEach((item, index) => {
        if (typeof item !== 'string') {
          issues.push(`字段 ${name} 的第 ${index + 1} 项应为字符串，实际 ${typeof item}`)
          return
        }
        const length = charCount(item)
        if (rule.itemMinChars !== undefined && length < rule.itemMinChars) {
          issues.push(`字段 ${name} 的第 ${index + 1} 项只有 ${length} 字，少于下限 ${rule.itemMinChars}`)
        }
        if (rule.itemMaxChars !== undefined && length > rule.itemMaxChars) {
          issues.push(`字段 ${name} 的第 ${index + 1} 项有 ${length} 字，超过上限 ${rule.itemMaxChars}`)
        }
      })
      continue
    }
    if (type === 'integer') {
      if (typeof raw !== 'number' || !Number.isInteger(raw)) issues.push(`字段 ${name} 应为整数`)
      continue
    }
    if (type === 'boolean') {
      if (typeof raw !== 'boolean') issues.push(`字段 ${name} 应为布尔值`)
      continue
    }
    issues.push(`字段 ${name} 的声明类型 ${type} 不在允许集合 ${FIELD_TYPES.join('/')} 里`)
  }
  return issues
}

/**
 * 解析 + 校验，一步到位。不合法就抛（带全部问题清单）。
 * @param {string} text
 * @param {{fields: Record<string, object>}} schema
 * @returns {Record<string, unknown>}
 * @throws {NarrativeError} INVALID_OUTPUT
 */
export function decodeStructured(text, schema) {
  const value = parseStructured(text)
  const issues = validateAgainstSchema(value, schema)
  if (issues.length > 0) {
    throw new NarrativeError(ERROR_CODES.INVALID_OUTPUT, `模型输出不符合约定：${issues.join('；')}`, {
      detail: { reason: 'SCHEMA', issues },
    })
  }
  return value
}

/**
 * 把 schema 渲染成给人/给模型看的一段确定文本（运行器拼进提示词）。
 * @param {{fields: Record<string, {type?: string, required?: boolean, maxChars?: number, minChars?: number}>}} schema
 * @returns {string}
 */
export function describeSchema(schema) {
  const lines = ['只输出一个 JSON 对象，不要输出别的任何字符（不要解释、不要 Markdown 围栏）。字段：']
  for (const [name, rule] of Object.entries(schema?.fields ?? {})) {
    const bits = [rule.type ?? 'string']
    if (rule.required === true) bits.push('必填')
    if (rule.minChars !== undefined) bits.push(`至少 ${rule.minChars} 字`)
    if (rule.maxChars !== undefined) bits.push(`不超过 ${rule.maxChars} 字`)
    if ((rule.type ?? 'string') === 'array') {
      bits.length = 0
      bits.push(`数组，元素是${rule.itemType === 'integer' ? '整数' : rule.itemType === 'boolean' ? '布尔值' : '字符串'}`)
      if (rule.required === true) bits.push('必填')
      if (rule.minItems !== undefined) bits.push(`至少 ${rule.minItems} 项`)
      if (rule.maxItems !== undefined) bits.push(`最多 ${rule.maxItems} 项`)
      if (rule.itemMaxChars !== undefined) bits.push(`每项不超过 ${rule.itemMaxChars} 字`)
    }
    lines.push(`- ${name}: ${bits.join('，')}`)
  }
  lines.push('字数按 Unicode 码点算；超字数会被判为不合法，不会被截断。')
  return lines.join('\n')
}
