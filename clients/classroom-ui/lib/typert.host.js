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

const _scope_schema = /** @type {any} */ (undefined)

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
          codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', schema: _scope_schema },
        },
        { name: 'lesson', wire: 'lesson', source: 'json', codec: { mode: 'strict', typeSymbol: 'number', schema: _scope_schema } },
        { name: 'body', wire: 'body', source: 'json', codec: { mode: 'strict', typeSymbol: 'unknown', schema: _scope_schema } },
        { name: 'baseRev', wire: 'baseRev', source: 'json', codec: { mode: 'strict', typeSymbol: 'number', schema: _scope_schema } },
      ],
      result: { mode: 'strict', typeSymbol: 'unknown', schema: _scope_schema },
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
          codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', schema: _scope_schema },
        },
        { name: 'lesson', wire: 'lesson', source: 'json', codec: { mode: 'strict', typeSymbol: 'number', schema: _scope_schema } },
      ],
      result: { mode: 'strict', typeSymbol: 'unknown', schema: _scope_schema },
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
          codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', schema: _scope_schema },
        },
      ],
      result: { mode: 'strict', typeSymbol: 'unknown', schema: _scope_schema },
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
