// lib/typert.host.mjs — K4.1 的 typert **host face**：清单（TYPERT）＋零依赖 codec
//
// 🔴 铁律（验收）：「绝不把任何 @deepseek-ai/* 包装进 profile 或插件的 node_modules」——
//    本包 `dependencies` 空着，所以**不能** `import { TypertRemoteService } from
//    '@deepseek-ai/dsh-typert-protocol'`，也**不能** `import { z } from 'zod'`（同一条纪律的
//    直接后果：白板那份 host face 用 zod 造 codec，我这里用 30 行自己写的校验器顶上）。
//
// 这不是「自创协议」，而是协议**已经留好的口子**（0.2.1-rc.2 安装版源码逐条核对）：
//   · 清单校验只看结构：`mode === 'strict'`、`typeSymbol` 是非空字符串、`create` 是函数、
//     `jsonSchema` 是对象（`dsh-typert-loader/lib/index.js` 的 `requireStrictCodec` /
//     `requireSchemaProjection`）——**不要求**它是 zod 实例。
//   · 边界解码调的是 `codec.create().parse(value)`（`dsh-api-gateway/lib/index.js` 的 `decode`），
//     所以 `create()` 只要返回一个带 `parse` 的对象就够。
//   · 服务发现走「类原型上的 marker 描述符 + 实例上的 `typertRemote` 绑定」
//     （`remoteMethods` / `validateBinding` / `collectSrcClaims`）——两者都是**纯数据结构**，
//     照 `clients/classroom-ui/lib/whiteboard-host.mjs` 的手工标记写法即可，不需要那个基类。
//
// 代价（写进 README）：参数校验是我自己写的（只覆盖本服务用到的 string/number），
// 拿不到 zod 的自动 JSON Schema 投影；`jsonSchema` 手写并与 `create()` 的校验保持一致。

/** 远程方法描述符挂在原型上的键（协议里的字符串常量，不是包名导入）。 */
export const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/** K4 的服务名 / 命名空间。 */
export const GROUP_SERVICE_KEY = 'classroomGroup'

/** `workspaceFileScope` lookup 的 wire 类型符号（必须与提供方逐字一致，否则 gateway 判 provider-mismatch）。 */
export const SESSION_ID_TYPE = '@deepseek-ai/dsh-session/types#SessionId'

/**
 * 造一个「只认一种 JSON 形状」的 codec（`create().parse` 在边界上做校验）。
 * @param {{typeSymbol?: string, jsonSchema: object, describe?: string, accept: (value: unknown) => boolean}} spec
 */
export function jsonCodec({ typeSymbol = 'json', jsonSchema, describe, accept }) {
  return {
    mode: 'strict',
    typeSymbol,
    ...(describe === undefined ? {} : { description: describe }),
    jsonSchema,
    create: () => ({
      parse(value) {
        if (accept(value)) return value
        throw new TypeError(`期望 ${describe ?? '符合声明的值'}（得到 ${JSON.stringify(value)}）`)
      },
    }),
  }
}

/** 字符串 codec（`text` / `clientId` 用）。 */
export function stringCodec(extra = {}) {
  return jsonCodec({ typeSymbol: 'string', jsonSchema: { type: 'string' }, describe: '字符串', accept: (value) => typeof value === 'string', ...extra })
}

/** 数字 codec（`limit` / `afterSeq` / `waitMs` / `seq` 用）。 */
export function numberCodec() {
  return jsonCodec({
    typeSymbol: 'number',
    jsonSchema: { type: 'number' },
    describe: '有限数字',
    accept: (value) => typeof value === 'number' && Number.isFinite(value),
  })
}

/** 结果 codec：返回值的形状由方法自己保证（与官方清单的 `z.unknown()` 同义：不额外校验）。 */
export function resultCodec() {
  return jsonCodec({ typeSymbol: 'unknown', jsonSchema: {}, describe: '任意 JSON', accept: () => true })
}

/**
 * 把一组方法标成 Remote（等价于 `@Remote` 装饰器写进原型的那份描述符）。
 * @param {object} prototype
 * @param {string[]} methods
 */
export function markRemoteMethods(prototype, methods) {
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze(
        methods.map((method) =>
          Object.freeze({
            method,
            invocation: Object.freeze({ kind: 'direct' }),
          }),
        ),
      ),
    }),
  })
}

/** 一条 invocation 的参数（`source: 'json'` 的都可缺省，缺省时方法自己填默认值）。 */
function jsonParam(name, wire, codec, { optional = false } = {}) {
  return {
    name,
    wire,
    source: 'json',
    ...(optional ? { acceptsUndefined: true } : {}),
    codec,
  }
}

/** 第一参数：会话作用域（由网关用 `workspaceFileScope` lookup 解析成 `{sessionId, workspaceRoot}`）。 */
const SCOPE_PARAM = {
  name: 'workspaceFileScope',
  wire: 'workspaceFileScopeId',
  source: 'lookup',
  lookup: 'workspaceFileScope',
  codec: jsonCodec({
    typeSymbol: SESSION_ID_TYPE,
    jsonSchema: { type: 'string' },
    describe: '会话 id',
    accept: (value) => typeof value === 'string',
  }),
}

/** K4.3 的四个方法（顺序 = 声明顺序，也是调用时的位置参数顺序）。 */
export const GROUP_METHODS = Object.freeze(['history', 'send', 'poll', 'markRead'])

/**
 * `./typert` 导出的清单（由 `dsh-typert-loader` 自动导入并注册进 `ctx.typert`）。
 *
 * 🔴 `package` 必须**逐字等于**本包 package.json 的 `name`（loader 校验），否则整包激活抛错。
 */
export const TYPERT = {
  package: 'socratic-narrative',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: 'socratic-narrative#classroomGroup/history',
      service: GROUP_SERVICE_KEY,
      namespace: GROUP_SERVICE_KEY,
      method: 'history',
      invocation: { kind: 'direct' },
      parameters: [SCOPE_PARAM, jsonParam('limit', 'limit', numberCodec(), { optional: true })],
      result: resultCodec(),
      description: 'Read the latest group messages, the next sequence number and the unread count.',
    },
    {
      id: 'socratic-narrative#classroomGroup/send',
      service: GROUP_SERVICE_KEY,
      namespace: GROUP_SERVICE_KEY,
      method: 'send',
      invocation: { kind: 'direct' },
      parameters: [
        SCOPE_PARAM,
        jsonParam('text', 'text', stringCodec()),
        jsonParam('clientId', 'clientId', stringCodec(), { optional: true }),
      ],
      result: resultCodec(),
      description: 'Append one student message (idempotent by clientId) and queue her reply.',
    },
    {
      id: 'socratic-narrative#classroomGroup/poll',
      service: GROUP_SERVICE_KEY,
      namespace: GROUP_SERVICE_KEY,
      method: 'poll',
      invocation: { kind: 'direct' },
      parameters: [
        SCOPE_PARAM,
        jsonParam('afterSeq', 'afterSeq', numberCodec(), { optional: true }),
        jsonParam('waitMs', 'waitMs', numberCodec(), { optional: true }),
      ],
      result: resultCodec(),
      description: 'Long-poll for messages after a sequence number; also reports whether she is typing.',
    },
    {
      id: 'socratic-narrative#classroomGroup/markRead',
      service: GROUP_SERVICE_KEY,
      namespace: GROUP_SERVICE_KEY,
      method: 'markRead',
      invocation: { kind: 'direct' },
      parameters: [SCOPE_PARAM, jsonParam('seq', 'seq', numberCodec())],
      result: resultCodec(),
      description: 'Move the read cursor forward and return the remaining unread count.',
    },
  ],
  model: {
    services: [
      {
        key: GROUP_SERVICE_KEY,
        exportName: 'ClassroomGroup',
        description: 'Host the classroom group chat: append-only JSONL storage, server-side debounce and reply scheduling.',
        summary: 'Host the classroom group chat.',
        tags: [],
        jsDoc: '/** Host the classroom group chat. */',
        types: [],
        members: [
          {
            kind: 'method',
            name: 'history',
            signature: 'async history(workspaceFileScope: WorkspaceFileScope, limit?: number): Promise<{ messages: Message[], nextSeq: number, unread: number }>',
            summary: 'Read the latest group messages, the next sequence number and the unread count.',
            jsDoc: '/** Read the latest group messages, the next sequence number and the unread count. */',
          },
          {
            kind: 'method',
            name: 'send',
            signature: 'async send(workspaceFileScope: WorkspaceFileScope, text: string, clientId?: string): Promise<{ ok: true, message: Message, unread: number } | { ok: false, error: { code: string, message: string } }>',
            summary: 'Append one student message (idempotent by clientId) and queue her reply.',
            jsDoc: '/** Append one student message and queue her reply. */',
          },
          {
            kind: 'method',
            name: 'poll',
            signature: 'async poll(workspaceFileScope: WorkspaceFileScope, afterSeq?: number, waitMs?: number): Promise<{ messages: Message[], typing: boolean, nextSeq: number, unread: number, serverTime: number }>',
            summary: 'Long-poll for messages after a sequence number; also reports whether she is typing.',
            jsDoc: '/** Long-poll for messages after a sequence number. */',
          },
          {
            kind: 'method',
            name: 'markRead',
            signature: 'async markRead(workspaceFileScope: WorkspaceFileScope, seq: number): Promise<{ unread: number }>',
            summary: 'Move the read cursor forward and return the remaining unread count.',
            jsDoc: '/** Move the read cursor forward. */',
          },
        ],
      },
    ],
    events: [],
    objects: [],
  },
}
