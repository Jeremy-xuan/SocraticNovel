// clients/classroom-ui/lib/whiteboard-route.mjs — 白板「保存」路由层（纯函数，不直接注册宿主）。
//
// 职责（任务书 S2 路由）：
//   · save body 校验（场景合法 + lesson 与 URL 一致）
//   · lesson → `runtime/whiteboard/LNN.scene.json`（LNN＝lesson 两位零补）
//   · baseRev 冲突检测 → 409
//   · 路径边界：拒绝绝对路径 / 穿越到工作区外（纯函数内做静态校验）
//   · index.jsonl 追加一行
//   · 原子写计划数据（target / temp / content / lockKey / mode）—— **只产出计划，不落盘、不注册宿主**
//
// 设计纪律：
//   · 零依赖、零宿主 I/O。所有副作用（真实写盘、锁、读 currentRev）由面板代理（S7）的宿主桥接完成，
//     本模块只返回「可执行的写计划」与状态码，因此可在 node 侧完全确定性单测。
//   · 不静默修正：lesson 与 URL 不一致、body 非法、rev 冲突一律显式报错（400 / 409）。

import { resolve, isAbsolute, sep, relative } from 'node:path'
import { check, serialize, SCENE_VERSION } from './whiteboard.mjs'

export const WHITEBOARD_DIR = 'runtime/whiteboard'
export const INDEX_FILE = 'index.jsonl'

/** lesson → 相对工作区根的文件路径。LNN：L + 两位零补。 */
export function lessonToPath(lesson) {
  if (!Number.isInteger(lesson) || lesson < 1) {
    throw new Error(`lesson 必须是 >=1 的整数，收到 ${JSON.stringify(lesson)}`)
  }
  return `${WHITEBOARD_DIR}/L${String(lesson).padStart(2, '0')}.scene.json`
}

/** 路径边界守卫：拒绝绝对 rel、拒绝穿越出 root。返回 root 下的绝对路径。 */
export function safeJoin(root, rel) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('root 必须是非空字符串')
  }
  if (typeof rel !== 'string' || rel.length === 0) {
    throw new Error('rel 必须是非空字符串')
  }
  if (isAbsolute(rel)) {
    throw new Error(`拒绝绝对路径：${rel}`)
  }
  const abs = resolve(root, rel)
  const base = resolve(root)
  const relFromBase = relative(base, abs)
  if (relFromBase.startsWith('..') || relFromBase === '..' || isAbsolute(relFromBase)) {
    throw new Error(`拒绝穿越工作区外的路径：${rel}`)
  }
  return abs
}

/** 解析某 lesson 的场景绝对路径（含边界校验）。 */
export function resolveScenePath(root, lesson) {
  return safeJoin(root, lessonToPath(lesson))
}

function badRequest(message) {
  return { status: 400, error: 'bad_request', message }
}

/**
 * planWhiteboardSave —— 纯函数：根据入参产出「保存计划」或错误响应。不落盘。
 *
 * @param {object} params
 * @param {string} params.root                       工作区根（绝对或相对皆可，内部 resolve）
 * @param {number} params.lesson                      URL 里的 lesson（决定落点文件名）
 * @param {string|object} params.body                 请求体：场景 JSON 字符串，或已解析的对象
 * @param {number} params.currentRev                 服务端当前 rev（用于冲突检测；新文件传 0）
 * @param {number} params.baseRev                    客户端最后已知 rev（必须与 currentRev 一致，否则 409）
 * @param {number} [params.now]                      时间戳（默认 Date.now），用于 index 行
 * @returns {object} 成功：{ status:200, rev, filePath, bytes, index:{path,line}, write:{...} }
 *                   失败：{ status:400, ... } 或 { status:409, ... }
 */
export function planWhiteboardSave(params) {
  // ── 入参基础校验 ──
  if (typeof params !== 'object' || params === null) return badRequest('params 必须是对象')
  const { root, lesson, body, currentRev, baseRev } = params
  if (typeof root !== 'string' || root.length === 0) return badRequest('root 必须是非空字符串')
  if (!Number.isInteger(lesson) || lesson < 1) return badRequest('lesson 必须是 >=1 的整数')
  if (!Number.isInteger(currentRev) || currentRev < 0) return badRequest('currentRev 必须是 >=0 的整数')
  if (!Number.isInteger(baseRev) || baseRev < 0) return badRequest('baseRev 必须是 >=0 的整数')

  // ── baseRev 冲突 → 409（不静默放行） ──
  if (baseRev !== currentRev) {
    return { status: 409, error: 'rev_conflict', currentRev, message: `baseRev ${baseRev} ≠ 当前 rev ${currentRev}` }
  }

  // ── save body 校验 ──
  let scene
  try {
    if (typeof body === 'string') scene = JSON.parse(body)
    else if (typeof body === 'object' && body !== null) scene = body
    else return badRequest('body 必须是场景 JSON 字符串或对象')
  } catch (e) {
    return badRequest('body 不是合法 JSON: ' + e.message)
  }
  // lesson 与 URL 一致（显式冲突一律拒绝，不静默覆盖）
  if (scene && typeof scene === 'object' && scene.lesson !== undefined && scene.lesson !== lesson) {
    return badRequest(`body.lesson (${scene.lesson}) 与 URL lesson (${lesson}) 不一致`)
  }

  const checked = check(scene)
  if (!checked.ok) {
    const detail = checked.errors.map((e) => `${e.path}: ${e.message}`).join('; ')
    return badRequest('场景校验失败: ' + detail)
  }
  // 以 URL 的 lesson 为准落点（缺失时补全；冲突已在上一步拒绝）。
  // 场景内的 rev 统一用服务端权威值 newRev（= currentRev+1），与冲突检测、index 行一致。
  const newRev = currentRev + 1
  const normalized = { ...checked.value, lesson, rev: newRev }

  // ── 序列化（>2MiB 抛错，不截断） ──
  let content
  try {
    content = serialize(normalized)
  } catch (e) {
    return badRequest('序列化失败: ' + e.message)
  }
  const bytes = Buffer.byteLength(content, 'utf8')

  // ── 落点路径（含边界校验） ──
  let filePath
  try {
    filePath = resolveScenePath(root, lesson)
  } catch (e) {
    return badRequest(e.message)
  }

  const now = typeof params.now === 'number' ? params.now : Date.now()
  const indexLine = JSON.stringify({
    lesson,
    rev: newRev,
    bytes,
    label: normalized.label || '',
    ts: now,
  })
  const indexPath = safeJoin(root, `${WHITEBOARD_DIR}/${INDEX_FILE}`)

  return {
    status: 200,
    rev: newRev,
    filePath,
    bytes,
    index: { path: indexPath, line: indexLine },
    write: {
      target: filePath,
      temp: filePath + '.tmp',
      content,
      lockKey: filePath,
      mode: 0o600,
    },
  }
}

/** 供面板代理复用的常量，避免重复硬编。 */
export const SCENE_KIND = SCENE_VERSION
