// clients/classroom-ui/lib/whiteboard-host.mjs
//
// 宿主半边「白板存储」Remote 服务（typert host face）。
//
// 落点：右栏白板 tab 的 save/load 鉴权端点（S3 宿主接线）。
// 机制：与安装版 `dsh-api-workspace-files` 同构 —— 继承 `TypertRemoteService`，
//   用 `markRemote` 把方法标成 Remote（等价于 `@Remote` 装饰器写入的运行时描述符，
//   见 `dsh-typert-protocol/lib/index.js`），并随 `package.json` 的 `"./typert"` 导出被
//   `dsh-typert-loader` 自动注册进 `ctx.typert`。浏览器半边经 `ctx.remote.whiteboardStore`
//   调用本服务（与 `ctx.remote.workspaceFiles` 同一条通道）。
//
// 鉴权（connection + fs）：
//   · 第一参数 `scope` 是 `workspaceFileScope` lookup 结果（与 workspaceFiles 同款），
//     由网关用 `dsh-api-workspace-files` 已注册的 lookup 解析出
//     `{ sessionId, workspaceRoot }`；非法/越权会话在解析阶段即失败。
//   · 落点路径经 `safeJoin` 静态守卫，拒绝绝对路径与穿出工作区（与 S2 路由一致）。
//   · 写盘走 `dsh-atomic-write` 的 `withFileLock` + `writeFileAtomic`：锁串行化、rename 原子提交。
//
// ⚠️ 本文件只依赖 node 标准库 + `dsh-atomic-write` + 本包内的 `whiteboard.mjs` /
//   `whiteboard-route.mjs`；不依赖 `ctx.fs` / `ctx.sessions` / `ctx.typert`，以最大化跨环境健壮性。

import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { readFile, appendFile, mkdir } from 'node:fs/promises'
import { SCENE_VERSION } from './whiteboard.mjs'
import {
  planWhiteboardSave,
  WHITEBOARD_DIR,
  INDEX_FILE,
  safeJoin,
  lessonToPath,
} from './whiteboard-route.mjs'

// ── 手动标记 Remote 方法（等价于 @Remote 装饰器，避免装饰器语法依赖） ──────────
// 与 `dsh-typert-protocol/lib/index.js` 的 `mark` 完全同形：在类原型上写入字符串键
// `"@deepseek-ai/dsh-typert-protocol/remote-methods"` 的描述符（version:1 + methods 数组）。
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'

function sameInvocation(left, right) {
  if (left.kind === 'direct') return right.kind === 'direct'
  if (right.kind === 'direct') return false
  return left.context === right.context
}

function markRemote(prototype, method, invocation = { kind: 'direct' }, mode, exportName) {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, REMOTE_METHOD_DESCRIPTOR)?.value
  const marker = Object.freeze({
    method,
    ...(exportName === undefined || exportName === method ? {} : { exportName }),
    ...(mode === undefined ? {} : { mode }),
    invocation: Object.freeze(invocation),
  })
  const current = descriptor?.methods?.find((c) => c.method === method)
  if (current !== undefined) {
    if (current.exportName === marker.exportName && current.mode === marker.mode && sameInvocation(current.invocation, invocation)) return
    throw new Error(`whiteboard-host: Remote 方法 "${method}" 的调用标记冲突`)
  }
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze([...(descriptor?.methods ?? []), marker]),
    }),
  })
}

const SERVICE_KEY = 'whiteboardStore'
const DEFAULT_FILE_MODE = 0o600

/**
 * 白板存储 Remote 服务：把右栏白板 tab 的「保存 / 读取 / 索引」接到会话工作区。
 */
export class WhiteboardStore extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, SERVICE_KEY)
    // 把 save / load / index 标成 Remote 方法（与 @Remote 装饰器等价）。
    markRemote(WhiteboardStore.prototype, 'save')
    markRemote(WhiteboardStore.prototype, 'load')
    markRemote(WhiteboardStore.prototype, 'index')
  }

  /**
   * 解析会话工作区根（来自 workspaceFileScope lookup 的结果，已由网关解析）。
   * @param {object} scope - { sessionId, workspaceRoot }
   */
  #rootOf(scope) {
    if (scope === undefined || typeof scope !== 'object') {
      throw new RemoteErrorLike('whiteboard/bad-scope', '缺少会话作用域')
    }
    const root = scope.workspaceRoot
    if (typeof root !== 'string' || root.length === 0) {
      throw new RemoteErrorLike('whiteboard/no-workspace', '会话没有可用的工作区根', { sessionId: scope.sessionId })
    }
    return root
  }

  /**
   * 读取当前已落盘场景的 rev（用于冲突检测）。文件不存在 → 0。
   */
  async #readCurrentRev(root, lesson) {
    const path = safeJoin(root, lessonToPath(lesson))
    try {
      const text = await readFile(path, 'utf8')
      const obj = JSON.parse(text)
      return typeof obj.rev === 'number' ? obj.rev : 0
    } catch (e) {
      if (e && e.code === 'ENOENT') return 0
      throw e
    }
  }

  /**
   * save —— 保存某 lesson 的白板场景。
   * @param {object} scope - workspaceFileScope lookup 结果（含 sessionId / workspaceRoot）
   * @param {number} lesson - URL 里的 lesson
   * @param {string|object} body - 场景 JSON（字符串或对象）
   * @param {number} baseRev - 客户端最后已知 rev（与当前 rev 一致才放行，否则 409）
   * @returns {{rev:number, bytes:number, path:string}}
   */
  async save(scope, lesson, body, baseRev) {
    const root = this.#rootOf(scope)
    const currentRev = await this.#readCurrentRev(root, lesson)
    const plan = planWhiteboardSave({ root, lesson, body, currentRev, baseRev })
    if (plan.status === 409) {
      throw new RemoteErrorLike('whiteboard/rev-conflict', plan.message, { currentRev: plan.currentRev })
    }
    if (plan.status !== 200) {
      throw new RemoteErrorLike('whiteboard/bad-request', plan.message, {})
    }
    // 原子写场景文件 + 追加 index 行（写锁串行化，rename 原子提交）。
    // 写锁要求父目录已存在，故先幂等建目录（再锁再写）。
    await mkdir(safeJoin(root, WHITEBOARD_DIR), { recursive: true })
    await withFileLock(plan.write.target, async () => {
      await writeFileAtomic(plan.write.target, plan.write.content, { mode: plan.write.mode })
      await appendFile(plan.index.path, plan.index.line + '\n', 'utf8')
    })
    return { rev: plan.rev, bytes: plan.bytes, path: plan.filePath }
  }

  /**
   * load —— 读取某 lesson 的白板场景（返回原始 JSON 文本，由浏览器半边解析/渲染）。
   * @param {object} scope - workspaceFileScope lookup 结果
   * @param {number} lesson - URL 里的 lesson
   * @returns {{rev:number, text:string}}
   */
  async load(scope, lesson) {
    const root = this.#rootOf(scope)
    const path = safeJoin(root, lessonToPath(lesson))
    let text
    try {
      text = await readFile(path, 'utf8')
    } catch (e) {
      if (e && e.code === 'ENOENT') {
        throw new RemoteErrorLike('whiteboard/not-found', `lesson ${lesson} 的白板场景尚不存在`, { lesson })
      }
      throw e
    }
    let rev = 0
    try { rev = JSON.parse(text).rev ?? 0 } catch { /* 读出的 rev 仅用于展示，损坏不静默修正 */ }
    return { rev, text }
  }

  /**
   * index —— 读取白板索引（index.jsonl 的全部行，逐行解析；非法行跳过但计数）。
   * @param {object} scope - workspaceFileScope lookup 结果
   * @returns {{entries:Array<object>, count:number}}
   */
  async index(scope) {
    const root = this.#rootOf(scope)
    const path = safeJoin(root, `${WHITEBOARD_DIR}/${INDEX_FILE}`)
    let text = ''
    try {
      text = await readFile(path, 'utf8')
    } catch (e) {
      if (e && e.code === 'ENOENT') return { entries: [], count: 0 }
      throw e
    }
    const entries = []
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (t.length === 0) continue
      try { entries.push(JSON.parse(t)) } catch { /* 跳过损坏行，不静默修正 */ }
    }
    return { entries, count: entries.length }
  }
}

/**
 * 轻量 RemoteError 替身：携带稳定 code（网关据此映射为 HTTP 状态，bad-request→400、
 * rev-conflict→409、not-found→404、其余→500）。不依赖 `dsh-typert-protocol` 的具体类，
 * 仅复制其 `{ isDSHRemoteError, code, message }` 契约。
 */
class RemoteErrorLike extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'RemoteError'
    this.isDSHRemoteError = true
    this.code = code
    this.details = details
  }
}

export { SERVICE_KEY, SCENE_VERSION, DEFAULT_FILE_MODE }
