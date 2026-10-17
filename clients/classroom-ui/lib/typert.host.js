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
}
