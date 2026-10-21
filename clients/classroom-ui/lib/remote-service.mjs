// clients/classroom-ui/lib/remote-service.mjs — 本地「typert source-mode 远程服务」基类（B2，2026-10-21）
//
// 🔴 为什么会有一份本地的：面板的 `classroomNarrative` 服务仍在服役（「日记」tab 的消费者还在
//   `lib/client.js`），但 `@deepseek-ai/dsh-typert-protocol` 一旦被 import 就必须写进
//   `package.json` 的 dependencies，于是 profile 的 node_modules 里必然出现 `@deepseek-ai/*`，
//   验收流水线的铁律③（不许双实例 / Symbol 失配）必然红（0.2.1 删掉了安装版回退目录）。
//
// 宿主那一侧到底认什么（逐字取证，见报告 §4；文件与行号对 `0.2.1-rc.2`）：
//   ① `ctx.provide(key, value)` 把 `ctx.reflect.props[key]` 记成 `{ type: 'service' }`
//      —— `@deepseek-ai/cordis/lib/index.js` 的 `Reflect.provide()`。
//      宿主网关的 `collectSrcClaims()` / `resolveSrcDescriptor()` 正是遍历
//      `ctx.reflect.props` 里 `type === 'service'` 的条目来找 Remote 方法。
//   ② `dsh-api-gateway/lib/index.js` 的 `readBinding()` 逐字段要求：
//      `binding.service === originalOf(receiver)`、`binding.serviceKey === serviceKey`、
//      `typeof binding.namespace === 'string'`。`originalOf()` 读 `Symbol.for('cordis.original')`，
//      取不到就返回接收者本身 —— 所以把 `service` 指成 `this` 就够。
//   ③ 方法清单读的是**原型上的字符串键描述符** `"@deepseek-ai/dsh-typert-protocol/remote-methods"`
//      （`{ version: 1, methods: [{ method, invocation, … }] }`），值由 `markRemote()` 写入。
//   ④ 方法形参名靠 `Function.prototype.toString` 解析，按 `typert.host.js` 清单的顺序装配实参。
//
// 与宿主 `TypertRemoteService` 的**实质差异**（写清楚，不当等价）：
//   · 不自己注册：宿主那个类在构造函数里 `super(ctx, key)` 就 `ctx.reflect.provide` 了；
//     这里由 `lib/index.js` 的 `ctx.provide(key, new X(ctx))` 注册（**同一条** cordis 路径，
//     只是把"谁注册"挪到调用点，便于保留既有的"已注册就跳过"幂等门）。
//   · 实例上不打 cordis 的 `Symbol.for('cordis.tracker')`：没有它，`ctx.get(key)` 返回**裸实例**
//     （`getTraceable()` 见 tracker 才包 proxy）。两个后果都无害：
//     ① `this` 就是实例本身（宿主那边是 proxy，所以它们连 `#private` 字段都不能碰）；
//     ② 方法里读不到派发时 extend 出来的 `ctx.invocation` —— 本服务的两个方法都不读它。
//   · 不装 root 上的 `ctx.invocation` 访问器（宿主 `bindTypertRemote` 的 `provideInvocationAccessor`）：
//     那是宿主自己的官方服务早就装过的 root 级约定，面板不该去动宿主的 root 状态。

/** 原型上的 Remote 方法描述符键（字节与宿主 `dsh-typert-protocol` 一致，是跨端契约）。 */
export const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/** 两种 invocation 标记是否相同（`direct` 比 kind；`context` 比 kind+context）。 */
function sameInvocation(left, right) {
  if (left.kind === 'direct') return right.kind === 'direct'
  if (right.kind === 'direct') return false
  return left.context === right.context
}

/**
 * 把一个方法标成 Remote（等价于宿主的 `@Remote` 装饰器写入的运行时描述符）。
 *
 * 🔴 重复标记且内容不同 → 抛错（不静默覆盖：两个调用点写出不同签名一定是 bug）。
 * @param {object} prototype - 类原型
 * @param {string} method - 方法名
 * @param {{kind: 'direct'} | {kind: 'context', context: unknown}} [invocation] - 派发方式
 * @param {'stream'} [mode] - 流式标记
 * @param {string} [exportName] - 对外暴露的方法名（缺省＝方法名）
 * @returns {void}
 */
export function markRemote(prototype, method, invocation = { kind: 'direct' }, mode, exportName) {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, REMOTE_METHOD_DESCRIPTOR)?.value
  const marker = Object.freeze({
    method,
    ...(exportName === undefined || exportName === method ? {} : { exportName }),
    ...(mode === undefined ? {} : { mode }),
    invocation: Object.freeze(invocation),
  })
  const current = descriptor?.methods?.find((candidate) => candidate.method === method)
  if (current !== undefined) {
    if (
      current.exportName === marker.exportName &&
      current.mode === marker.mode &&
      sameInvocation(current.invocation, marker.invocation)
    ) {
      return
    }
    throw new Error(`remote-service: Remote 方法 "${method}" 的调用标记冲突`)
  }
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({ version: 1, methods: Object.freeze([...(descriptor?.methods ?? []), marker]) }),
  })
}

/**
 * typert source-mode 远程服务基类。
 * @param {object} ctx - cordis 上下文（由调用点负责 `ctx.provide`）
 * @param {string} serviceKey - cordis 服务名（同时是默认的 wire 命名空间）
 * @param {{namespace?: string}} [options] - 覆盖 wire 命名空间
 */
export class RemoteService {
  /**
   * @param {object} ctx - 所属上下文
   * @param {string} serviceKey - 服务名＝wire 命名空间
   * @param {{namespace?: string}} [options] - 命名空间覆盖
   */
  constructor(ctx, serviceKey, options = {}) {
    this.ctx = ctx
    this.name = serviceKey
    /** 网关据此把方法挂到 `ctx.remote.<namespace>.<method>`（见文件头 ②）。 */
    this.typertRemote = Object.freeze({
      service: this,
      serviceKey,
      namespace: options.namespace ?? serviceKey,
    })
  }
}
