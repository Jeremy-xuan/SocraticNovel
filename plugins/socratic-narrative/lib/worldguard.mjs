// lib/worldguard.mjs — N5.3 的**代码级守卫**：世界观改动不许碰教学文件
//
// 仓库红线第 1 条「叙事不得污染教学正确性」。开发文档 N5.3 把它落成一句可检查的话：
//   世界观改动**不能碰** `materials/`、`curriculum.md`、`knowledge_points.md`、
//   `system_core.md`，以及 `_anchor.md` 的教学法部分。
//
// 🔴 为什么要有代码守卫，而不是「在提示词里说一句」：提示词是建议，模型可以不听；
//    这条是**唯一**的硬约束（N5.3 原文），它必须在写盘前用代码判、命中就拒绝并记日志。
//
// 两层判据（先黑名单，再白名单）：
//   ① 黑名单：教学文件与运行记录一律拒绝。**先判黑名单**——这样即便将来白名单写错，
//      教学文件也仍然进不来（_anchor.md 整份拒绝，不做「教学法部分」的段落级解析：
//      按段拆一个混合文件比整份拒绝更容易出错）。
//   ② 白名单：只允许 `characters/**.md` 与 `world/**.md`（N5.2 说「写进 characters/ 或 world/」）。
//      其中 `world/proposals.md` 与 `world/changelog.md` 是**代码维护的日志**，模型不许重写。
//
// 🔴 2026-10-21 收窄（用户裁定）：**改既有文件只允许追加，不许整份重写**。
//   理由：`world/setting.md`、`world/metaphor.md`、`characters/*.md` 都有人写下的作者意图，
//   整份覆盖是**不可逆**的（一次模型跑偏就把设定洗掉）；而追加是**可逆的**（块带 changeId，
//   人想撤就删那一段）。所以：
//     · 目标文件不存在 → 新建（这是「扩张世界观」的主要形态）；
//     · 目标文件已存在 → 只能追加一个带固定标记的段：
//         `<!-- worldview:N5 change=<changeId> -->` … `<!-- /worldview:N5 change=<changeId> -->`
//       同一 changeId 已经追加过 → **不重复追加**（重试安全）。
//   代价（写进报告）：接受提议的表达力变弱了——不能再删掉某个角色设定、不能改写既有段落，
//   只能"往上长"。换来的是「世界观不会被人以外的东西悄悄洗掉」。
//
// 另外两条：路径不许越界（绝对路径 / `..`）、单文件（或单次追加段）大小上限。

/** 一律拒绝的路径（前缀或整文件名）。 */
export const FORBIDDEN_PREFIXES = Object.freeze([
  'materials/',
  'runtime/',
  'story/',
  'tools/',
])

/** 一律拒绝的整文件名。 */
export const FORBIDDEN_FILES = Object.freeze([
  'curriculum.md',
  'knowledge_points.md',
  'system_core.md',
  '_anchor.md',
  'classroom.yaml',
  'AGENTS.md',
  'CLAUDE.md',
])

/** 允许写入的目录（白名单）。 */
export const ALLOWED_PREFIXES = Object.freeze(['characters/', 'world/'])

/** 代码自己维护的日志（模型不许重写）。 */
export const CODE_OWNED_FILES = Object.freeze(['world/proposals.md', 'world/changelog.md'])

/** 单次写入上限（字节）：新建＝整份；追加＝这一段的正文。 */
export const MAX_WRITE_BYTES = 60 * 1024

/** 追加段标记的固定前缀（人扫一眼就知道「这段不是手写的」）。 */
export const WORLDVIEW_MARKER = 'worldview:N5'

/**
 * 判一条相对路径能不能写。
 *
 * @param {string} relative - 相对教室目录的路径（`characters/an.md`）
 * @param {{bytes?: number}} [context] - 本次要写的字节数（可选）
 * @returns {{ok: true, path: string} | {ok: false, code: string, reason: string}}
 */
export function classifyWorldWrite(relative, { bytes = 0 } = {}) {
  if (typeof relative !== 'string' || relative.trim() === '') {
    return { ok: false, code: 'EMPTY_PATH', reason: '路径是空的' }
  }
  const path = relative.trim().replace(/\\/g, '/')
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    return { ok: false, code: 'ABSOLUTE_PATH', reason: `只接受相对教室目录的路径（得到 ${relative}）` }
  }
  const segments = path.split('/')
  if (segments.includes('..') || segments.includes('.')) {
    return { ok: false, code: 'PATH_ESCAPE', reason: `路径里不许出现 . 或 ..（得到 ${relative}）` }
  }
  if (path.endsWith('/')) return { ok: false, code: 'NOT_A_FILE', reason: '目标不是文件' }

  for (const prefix of FORBIDDEN_PREFIXES) {
    if (path.startsWith(prefix)) {
      return { ok: false, code: 'FORBIDDEN_PATH', reason: `${prefix} 是教学文件/运行记录，世界观改动不许碰（N5.3）` }
    }
  }
  if (FORBIDDEN_FILES.includes(path)) {
    return { ok: false, code: 'FORBIDDEN_PATH', reason: `${path} 是教学文件，世界观改动不许碰（N5.3）` }
  }
  if (CODE_OWNED_FILES.includes(path)) {
    return { ok: false, code: 'CODE_OWNED', reason: `${path} 由代码维护（提议与变更记录只能追加，不能重写）` }
  }
  const allowed = ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))
  if (!allowed) {
    return { ok: false, code: 'OUT_OF_SCOPE', reason: `只允许写 characters/ 或 world/（得到 ${path}）` }
  }
  if (!path.endsWith('.md')) {
    return { ok: false, code: 'NOT_MARKDOWN', reason: `世界观文件必须是 .md（得到 ${path}）` }
  }
  if (bytes > MAX_WRITE_BYTES) {
    return { ok: false, code: 'TOO_LARGE', reason: `${bytes} 字节超过单文件上限 ${MAX_WRITE_BYTES} 字节` }
  }
  return { ok: true, path }
}

/**
 * 一次追加段的开头/结尾标记。
 * @param {string} changeId - 提议 id（`P-…`）或别的稳定标记
 * @returns {{open: string, close: string}}
 */
export function worldviewMarker(changeId) {
  const id = String(changeId ?? '').trim()
  if (id === '') throw new Error('worldviewMarker 需要 changeId')
  return {
    open: `<!-- ${WORLDVIEW_MARKER} change=${id} -->`,
    close: `<!-- /${WORLDVIEW_MARKER} change=${id} -->`,
  }
}

/**
 * 文本里是否已经有这个 changeId 的追加段（重试安全：有就不再追加）。
 *
 * 容忍 `N5change=` 这种没空格的写法（人的手写习惯不同，检测要宽容；写出永远带空格）。
 * @param {string} text
 * @param {string} changeId
 * @returns {boolean}
 */
export function hasWorldviewChange(text, changeId) {
  const id = String(changeId ?? '').trim()
  if (id === '') return false
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`<!--\\s*/?\\s*${WORLDVIEW_MARKER}\\s*change=${escaped}\\s*-->`).test(String(text ?? ''))
}

/**
 * 模型给的正文里**不许**出现标记本身（否则它可以伪造/闭合别人的段）。
 * @param {string} text
 * @returns {boolean}
 */
export function containsWorldviewMarker(text) {
  return new RegExp(`${WORLDVIEW_MARKER}\\s*change=`).test(String(text ?? ''))
}

/**
 * 把一段正文包成可追加的块（前后各留一个换行，块内正文原样保留）。
 * @param {string} content
 * @param {string} changeId
 * @returns {string}
 */
export function wrapWorldviewAppend(content, changeId) {
  const body = String(content ?? '').trim()
  if (body === '') throw new Error('wrapWorldviewAppend 需要非空正文')
  const marker = worldviewMarker(changeId)
  return `\n${marker.open}\n${body}\n${marker.close}\n`
}

/**
 * 判一次世界观写入的**方式**：新建 or 追加（N5.3 收窄后的唯一口径）。
 *
 * @param {string} relative - 相对教室目录的路径
 * @param {{exists: boolean, bytes?: number}} context - 目标文件是否已存在、这次要写多少字节
 * @returns {{ok: true, path: string, mode: 'create'|'append'} | {ok: false, code: string, reason: string}}
 */
export function planWorldWrite(relative, { exists, bytes = 0 } = {}) {
  const verdict = classifyWorldWrite(relative, { bytes })
  if (verdict.ok !== true) return verdict
  return { ok: true, path: verdict.path, mode: exists === true ? 'append' : 'create' }
}
