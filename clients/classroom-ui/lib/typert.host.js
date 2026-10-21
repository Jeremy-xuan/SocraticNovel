// clients/classroom-ui/lib/typert.host.js
//
// 白板存储服务的 typert **host face** 清单（手工维护，与 `dsh-api-workspace-files/lib/typert.host.js`
// 同构；由 `dsh-typert-loader` 自动导入并注册进 `ctx.typert`）。
//
// 本清单描述「宿主侧」暴露给浏览器的三个远程方法：save / load / index。
// 第一参数 `workspaceFileScope` 与 `dsh-api-workspace-files` 完全一致（sessionId lookup），
// 浏览器侧经 `ctx.remote.whiteboardStore.<method>(sessionId, ...)` 调用。
//
// 注意：本文件是「契约清单」，不是运行时代码；运行态方法实现在 `whiteboard-host.mjs`。
// 若改了方法签名/服务名，必须同步改这里，否则 `typert-loader` 校验失败会导致整包激活抛错。

import { z } from 'zod'

// 🔴 2026-10-19：0.1.5-rc.1 的 dsh-typert-loader 会校验每个 invocation 参数的 codec 必须是
//    **真的 zod v4 schema 实例**（它检查 `"_zod" in schema.schema`）。原先这里是 `undefined`，
//    于是报 `invocation … parameter codec is not backed by a zod v4 schema`，整包装载失败、实例起不来。
//    形状对照 `@deepseek-ai/dsh-api-workspace-files/lib/typert.host.js`。
//
// 🔴 2026-10-20（迁 0.2.1）：0.2.1-rc.2 的 dsh-typert-loader 改了口径——codec 里不再收 `schema`
//    字段，改为要一个 **`create()` 工厂**（`requireSchemaProjection`：`typeof value.create !==
//    "function"` → `… has no create() factory`）。参数 codec 与 result codec 都过这一条校验，
//    缺一个就整包不激活（实测报错：`classroom-ui invocation "…/save" parameter codec has no
//    create() factory`）。所以下面统一用 `_codec(typeSymbol, create, jsonSchema)` 产出：
//    `create` 是返回 zod schema 的**惰性工厂**（与 0.2.1 官方清单同构），`jsonSchema` 是同一形状的
//    JSON Schema 投影。
const _scopeSchema = z.intersection(z.string(), z.unknown())
const _numberSchema = z.number()
const _stringSchema = z.string()
const _unknownSchema = z.unknown()

/** 0.2.1 strict codec：{mode, typeSymbol, create(), jsonSchema}。 */
const _codec = (typeSymbol, create, jsonSchema) => ({ mode: 'strict', typeSymbol, create, jsonSchema })

export const TYPERT = {
  package: 'classroom-ui',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: 'classroom-ui#whiteboardStore/save',
      service: 'whiteboardStore',
      namespace: 'whiteboardStore',
      method: 'save',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'scope',
          wire: 'workspaceFileScopeId',
          source: 'lookup',
          lookup: 'workspaceFileScope',
          codec: _codec('@deepseek-ai/dsh-session/types#SessionId', () => _unknownSchema, { type: 'string' }),
        },
        { name: 'lesson', wire: 'lesson', source: 'json', codec: _codec('number', () => _numberSchema, { type: 'number' }) },
        { name: 'body', wire: 'body', source: 'json', codec: _codec('unknown', () => _stringSchema, { type: 'string' }) },
        { name: 'baseRev', wire: 'baseRev', source: 'json', codec: _codec('number', () => _stringSchema, { type: 'string' }) },
      ],
      result: _codec('unknown', () => _unknownSchema, {}),
      // sourceLocation 仅作审计锚点（指向本仓库源码行）；不影响运行。
      sourceLocation: { file: 'clients/classroom-ui/lib/whiteboard-host.mjs', line: 90, column: 3 },
    },
    {
      id: 'classroom-ui#whiteboardStore/load',
      service: 'whiteboardStore',
      namespace: 'whiteboardStore',
      method: 'load',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'scope',
          wire: 'workspaceFileScopeId',
          source: 'lookup',
          lookup: 'workspaceFileScope',
          codec: _codec('@deepseek-ai/dsh-session/types#SessionId', () => _unknownSchema, { type: 'string' }),
        },
        { name: 'lesson', wire: 'lesson', source: 'json', codec: _codec('number', () => _numberSchema, { type: 'number' }) },
      ],
      result: _codec('unknown', () => _unknownSchema, {}),
      sourceLocation: { file: 'clients/classroom-ui/lib/whiteboard-host.mjs', line: 132, column: 3 },
    },
    {
      id: 'classroom-ui#whiteboardStore/index',
      service: 'whiteboardStore',
      namespace: 'whiteboardStore',
      method: 'index',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'scope',
          wire: 'workspaceFileScopeId',
          source: 'lookup',
          lookup: 'workspaceFileScope',
          codec: _codec('@deepseek-ai/dsh-session/types#SessionId', () => _unknownSchema, { type: 'string' }),
        },
      ],
      result: _codec('unknown', () => _unknownSchema, {}),
      sourceLocation: { file: 'clients/classroom-ui/lib/whiteboard-host.mjs', line: 166, column: 3 },
    },
  ],
  // 🔴 2026-10-19：0.1.5-rc.1 的 typert-loader 要求清单里必须有 `model`（描述宿主暴露给浏览器的
  //    服务形状），缺它会直接判 `TYPERT.model must be an object` 并把整个 profile 拉不起来。
  //    形状对照 `@deepseek-ai/dsh-api-workspace-files/lib/typert.host.js` 的 model 段。
  model: {
    services: [
      {
        description: 'Host the classroom whiteboard store: atomic writes, revision checks and path-bound writes over the workspace filesystem.',
        summary: 'Host the classroom whiteboard store.',
        tags: [],
        jsDoc: '/** Host the classroom whiteboard store. */',
        key: 'whiteboardStore',
        exportName: 'WhiteboardStore',
        // typert-loader 要求每个 service 都带 types 数组（形状见 dsh-typert-loader 的 requireTypes）；
        // 白板服务的方法参数是 JSON，没有额外的命名类型要导出，给空数组即可。
        types: [],
        members: [
          {
            kind: 'method',
            name: 'save',
            signature: 'async save(scope: WorkspaceFileScope, lesson: number, body: string, baseRev: string | null): Promise<{ rev: string }>',
            summary: 'Write one lesson whiteboard body atomically; rejects on revision conflict.',
            jsDoc: '/** Write one lesson whiteboard body atomically. */',
          },
          {
            kind: 'method',
            name: 'load',
            signature: 'async load(scope: WorkspaceFileScope, lesson: number): Promise<{ body: string, rev: string } | null>',
            summary: 'Read the current whiteboard body and its revision for one lesson.',
            jsDoc: '/** Read the current whiteboard body for one lesson. */',
          },
          {
            kind: 'method',
            name: 'index',
            signature: 'async index(scope: WorkspaceFileScope): Promise<Array<{ lesson: number, rev: string }>>',
            summary: 'List the lessons that already have a whiteboard, with their revisions.',
            jsDoc: '/** List lessons that already have a whiteboard. */',
          },
        ],
      },
    ],
    // 0.1.5-rc.1 的 typert-loader 还要求这两项存在（可以是空数组）：事件与对象模型。
    // 0.1.7 起似乎放宽了，但为了在班级服务器的版本上能起来，显式给空数组。
    events: [],
    objects: [],
  },
}
