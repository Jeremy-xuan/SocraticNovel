// clients/classroom-ui/lib/typert.narrative.host.js
//
// 叙事只读服务的 typert **host face** 清单（`classroomNarrative`：status / diaries）。
//
// 为什么单独一个文件而不是塞进 `typert.host.js`：
//   · `typert.host.js` 已经是白板那一套（save/load/index），本轮不动它的任何一条；
//   · 日记这一套**依赖一个可能不存在的服务**（叙事包没装时 `ctx.get('narrative')` 为空），
//     单独放一处，读的人一眼能看出这两条 invocation 的失败是"能力缺席"而不是"白板坏了"。
//
// 🔴 `dsh-typert-loader` 只认 `package.json` 的 `exports["./typert"]` **一个**产物
//    （0.2.1-rc.2 的 `typertExportOf`：字符串或带 `default` 的对象，别的一律不用）。
//    所以本文件**不是**第二个入口，而是被 `typert.host.js` 引入并合并进同一份 `TYPERT`。
//    别把 `exports["./typert"]` 改指向这里——那样白板的 save/load/index 会整批消失。
//
// 形状与口径全部照 `lib/typert.host.js`（0.2.1 要求每个 codec 带 **`create()` 工厂**，
// 不再收 `schema`；见那份文件头的两段 🔴 说明）。

import { z } from 'zod'

/** 服务名 / 命名空间（与 `lib/narrative-host.mjs` 的 `SERVICE_KEY` 必须逐字一致）。 */
const SERVICE_KEY = 'classroomNarrative'

const _scopeSchema = z.intersection(z.string(), z.unknown())
const _numberSchema = z.number()
const _unknownSchema = z.unknown()

/** 0.2.1 strict codec：{mode, typeSymbol, create(), jsonSchema}。 */
const _codec = (typeSymbol, create, jsonSchema) => ({ mode: 'strict', typeSymbol, create, jsonSchema })

/** 第一参数：会话作用域（由网关用 `workspaceFileScope` lookup 解析成 `{sessionId, workspaceRoot}`）。 */
const SCOPE_PARAM = {
  name: 'scope',
  wire: 'workspaceFileScopeId',
  source: 'lookup',
  lookup: 'workspaceFileScope',
  codec: _codec('@deepseek-ai/dsh-session/types#SessionId', () => _scopeSchema, { type: 'string' }),
}

/**
 * 两条 invocation：status / diaries。
 *
 * `limit` 是**可缺省**的 JSON 参数（`acceptsUndefined: true` —— 网关据此把这个 wire 字段
 * 从"必填"里摘出来；缺省时由 `narrative-host.mjs` 的 `clampLimit` 填默认值 20）。
 */
export const NARRATIVE_INVOCATIONS = [
  {
    id: 'classroom-ui#classroomNarrative/status',
    service: SERVICE_KEY,
    namespace: SERVICE_KEY,
    method: 'status',
    invocation: { kind: 'direct' },
    parameters: [SCOPE_PARAM],
    result: _codec('unknown', () => _unknownSchema, {}),
    description: 'Read the narrative service run status (last error / recent runs); reports narrative-absent when the package is not installed.',
    // sourceLocation 仅作审计锚点（指向本仓库源码行）；不影响运行。
    sourceLocation: { file: 'clients/classroom-ui/lib/narrative-host.mjs', line: 119, column: 3 },
  },
  {
    id: 'classroom-ui#classroomNarrative/diaries',
    service: SERVICE_KEY,
    namespace: SERVICE_KEY,
    method: 'diaries',
    invocation: { kind: 'direct' },
    parameters: [
      SCOPE_PARAM,
      {
        name: 'limit',
        wire: 'limit',
        source: 'json',
        acceptsUndefined: true,
        codec: _codec('number', () => _numberSchema, { type: 'number' }),
      },
    ],
    result: _codec('unknown', () => _unknownSchema, {}),
    description: 'Read the most recent diary entries ({date, lesson, text}) for the classroom of this session.',
    sourceLocation: { file: 'clients/classroom-ui/lib/narrative-host.mjs', line: 136, column: 3 },
  },
]

/** `classroomNarrative` 的服务形状（与白板那条同构：`types` 必须给空数组）。 */
export const NARRATIVE_SERVICE = {
  description: 'Expose the narrative package read-only: run status and recent diary entries, resolved to the classroom of the calling session.',
  summary: 'Expose the narrative read-only status and diaries.',
  tags: [],
  jsDoc: '/** Expose the narrative read-only status and diaries. */',
  key: SERVICE_KEY,
  exportName: 'ClassroomNarrative',
  types: [],
  members: [
    {
      kind: 'method',
      name: 'status',
      signature: 'async status(scope: WorkspaceFileScope): Promise<{ ok: true, status: object } | { ok: false, reason: string, message?: string }>',
      summary: 'Read the narrative run status; reports narrative-absent when the package is not installed.',
      jsDoc: '/** Read the narrative run status. */',
    },
    {
      kind: 'method',
      name: 'diaries',
      signature: 'async diaries(scope: WorkspaceFileScope, limit?: number): Promise<{ ok: true, entries: object[], bad: number } | { ok: false, reason: string, message?: string }>',
      summary: 'Read the most recent diary entries for the classroom of this session.',
      jsDoc: '/** Read the most recent diary entries. */',
    },
  ],
}

export { SERVICE_KEY }
