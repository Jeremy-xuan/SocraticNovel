// lib/usermessage.mjs — 本地 `createUserMessage`：构造宿主能直接落进会话日志的 user 消息。
//
// 🔴 为什么要有一份本地的（B2，2026-10-21）：同 lib/toolshape.mjs 的文件头 ——
//   0.2.1 删掉了「安装版回退目录」，插件一 `import '@deepseek-ai/dsh-llm'`，
//   包就必须进 `dependencies`，profile 的 node_modules 里必然出现 `@deepseek-ai/*`，
//   验收流水线的铁律③必红。
//
// 复刻的是宿主 `createUserMessage`（`@deepseek-ai/dsh-llm/lib/index.js` 0.2.1-rc.2）：
//
//   function createUserMessage(input) {            // ← 本模块实现的就是这两层
//     return createMessage({ ...input, role: 'user' })
//   }
//   function createMessage(input) {
//     return deepFreeze(structuredClone({ ...input, id: brandString(randomUUID()) }))
//   }
//
// 逐字段对照（`docs/历史报告/实现报告_B2_去宿主包依赖_2026-10-21.md` §2 有完整的实测表）：
//   · `role: 'user'`      —— 宿主写死；会话事件 `user/message` 的 `assertMessageEventShape`
//                            要求 `message.role === 'user'`，写错直接抛。
//   · `id`                —— **必填**（同一个校验器：`typeof message.id !== 'string' || id === ''`
//                            → `lacks an identified message`）。值是 v4 UUID 字符串；
//                            宿主的 `brandString` 在运行期是恒等函数（编译期品牌），
//                            所以这里用 `node:crypto` 的 `randomUUID()` 产出同形状的值即可。
//   · `content`           —— 原文透传（数组）。
//   · `source`            —— 原文透传；同一个校验器只要求 `source.kind` 是非空字符串。
//   · 其余字段            —— 原文透传（宿主 `{...input}` 的语义）。
//   · `structuredClone`   —— 消息与调用方**不共享可变子对象**：引擎注入块的对象后来被改，
//                            已落盘的消息不受影响。
//   · `deepFreeze`        —— 深度冻结（宿主同样递归冻结，只跳过 AbortSignal）。
//                            会话层自己也会 `deepFreeze(event.data)`，这里提前冻结是为了
//                            「拿到的就是不可变消息」这条契约在引擎内部也成立。

import { randomUUID } from 'node:crypto'

/**
 * 深度冻结（与宿主 `deepFreeze` 同语义：递归冻结可枚举子对象，跳过 AbortSignal，处理环）。
 * @template T
 * @param {T} value - 待冻结值
 * @returns {T} 同一个值（已冻结）
 */
export function deepFreeze(value) {
  /** @type {WeakSet<object>} */
  const seen = new WeakSet()
  /** @type {object[]} */
  const pending = [value]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === null || typeof node !== 'object') continue
    if (node instanceof AbortSignal) continue
    if (seen.has(node)) continue
    seen.add(node)
    Object.freeze(node)
    for (const key of Object.keys(node)) pending.push(node[key])
  }
  return value
}

/**
 * 造一条 user 消息（宿主 `createUserMessage` 的等价物）。
 * @param {{content: unknown[], source: {kind: string} & Record<string, unknown>} & Record<string, unknown>} input
 * @returns {object} 已冻结、带 `id` 的 user 消息
 */
export function createUserMessage(input) {
  return deepFreeze(structuredClone({ ...input, role: 'user', id: randomUUID() }))
}
