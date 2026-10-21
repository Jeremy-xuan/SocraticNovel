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
// 另外两条：路径不许越界（绝对路径 / `..`）、单文件大小上限（防止把整本教材灌进一张角色卡）。

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

/** 单文件写入上限（字节）。 */
export const MAX_WRITE_BYTES = 60 * 1024

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
