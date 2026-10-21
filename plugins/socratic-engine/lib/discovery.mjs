// lib/discovery.mjs — 教室目录自动发现（P1 教学引擎，S2 新增）
//
// 目标：运行时在工作区里发现教室包（含 classroom.yaml 的目录），不再依赖硬编码路径。
//
// 发现规则（按优先级）：
//   ① explicit   —— opts.explicitDirs / config.classroomDir 显式指定
//   ② convention —— <workspaceRoot>/classrooms/*/classroom.yaml
//   ③ deep       —— <workspaceRoot> 下任意深度（默认 ≤3）的 classroom.yaml
//
// 🔴 歧义处理：发现多个候选时**不静默选一个**。返回完整候选表 + 确定性排序键 +
//    选中理由 + 未选中的其余候选（全部暴露给调用方/模型）。
//
// 取证依据（逐字片段见 取证_S2_教室发现与运行时路径_2026-09-23.md）：
//   A4  —— 宿主官方模式：ctx.get("fs") → 判 undefined → fs.resolve + fs.stat 探测存在性
//   C1  —— fs-sandbox 只围栏 writeText/editText；resolve/stat/lstat/readText/listDir 原样透传
//   C3  —— resolve() 会 realpath 跟随符号链接；lstat() 不会 → 拒绝符号链接必须用 lstat
//   C2  —— 「路径不存在」用 stat/lstat 返回 undefined 表达；listDir 在不可读/非目录时抛 FsError
//
// 零宿主依赖：本文件不 import 任何 @deepseek-ai/* 包。宿主 fs 服务以「鸭子类型适配器」注入，
// 因此纯查找逻辑可在无宿主、无 LLM 的 node:test 里直接跑（见 test/discovery.test.mjs）。
//
// 🔴 FIX-1 修复（2026-09-24，依据 取证_I2_集成实测_2026-09-24.md §6）：
//   ① P0 —— 显式指定路径**也走 realpath**，与「工作区根」「约定目录／深层扫描」统一口径。
//      此前显式路径只做词法绝对化（absolutize 不做 realpath），而 workspaceRoot 是**规范化**路径；
//      macOS 上 `/tmp` 是 `/private/tmp` 的符号链接 → 两者必然不一致 → 深度判定为「不在工作区根下」。
//   ② P0 —— 深度一律为**有限整数**：不在工作区根下时返回 `OUTSIDE_ROOT_DEPTH`（-1），
//      不再返回 `Number.POSITIVE_INFINITY`。宿主 `snapshotJsonValue` 拒收非有限数
//      （`dsh-tools/lib/index.js` 的 `walkJsonValue`：`!Number.isFinite(current)` → 判不合格）
//      → 会让**整份工具输出**被拒（`tool "classroom_list" returned invalid output: value is not lossless JSON`）。
//      这条与「教室本来就不在工作区根下」（真实上课时的常态）正交，光靠 realpath 修不掉。
//   ③ P2 —— `skipped` 按 path 去重后再登记（同一符号链接曾被「约定目录」与「深层扫描」各记一次）。
//   ④ 工作区根本身也走一次 realpath：三种来源的**深度基准**必须是同一条规范化路径，
//      否则「约定目录／深层扫描」的候选仍会带着未规范化的前缀（半修）。

import { lstat as nodeLstat, readdir as nodeReaddir, stat as nodeStat, realpath as nodeRealpath } from 'node:fs/promises'
import { isAbsolute, join, posix, resolve as nodeResolve, sep } from 'node:path'

/** 教室包 manifest 的固定文件名（与 lib/manifest.mjs 的 MANIFEST_FILENAME 同值）。 */
export const MANIFEST_FILENAME = 'classroom.yaml'

/** 约定目录名：`<workspaceRoot>/classrooms/<name>/classroom.yaml`。 */
export const CONVENTION_DIRNAME = 'classrooms'

/** deep 扫描默认深度上限（相对工作区根；避免扫进 node_modules）。 */
export const DEFAULT_SEARCH_DEPTH = 3

/** 遍历时默认跳过的目录名（噪音源，且 classroom.yaml 出现在里面的概率可忽略）。 */
export const DEFAULT_EXCLUDED_DIRS = Object.freeze([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.cache',
  'dist',
  'build',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
])

/** 候选来源的排序权重（数字越小越优先）。 */
const SOURCE_RANK = Object.freeze({ explicit: 0, convention: 1, deep: 2 })

/**
 * 候选来源的中文说明（用于人类可读的「理由 Y」）。
 * @type {Record<string, string>}
 */
const SOURCE_LABEL = Object.freeze({
  explicit: '显式指定',
  convention: `约定目录 ${CONVENTION_DIRNAME}/*/`,
  deep: '深层扫描',
})

// ---------------------------------------------------------------------------
// 路径工具（不依赖 process.cwd，也不依赖宿主）
// ---------------------------------------------------------------------------

/**
 * 把路径统一成「以 / 分隔」的形式，便于排序与展示。
 * @param {string} p
 * @returns {string}
 */
function toPosix(p) {
  return sep === '/' ? p : p.split(sep).join('/')
}

/**
 * 「不在工作区根下」的深度哨兵值（相对深度是负数，与任何真实深度都不冲突）。
 *
 * 🔴 为什么不返回 `Number.POSITIVE_INFINITY`：宿主对工具输出做 lossless-JSON 校验时
 * **拒收非有限数**（见文件头 FIX-1 ② ），一个 Infinity 会让整份 `classroom_list` 输出被拒。
 * 而「显式指定的教室不在工作区根下」在真实上课时是**常态**（教室在 worktree，会话在项目目录）
 * → 这个值必须可表达，且必须能安全穿过宿主校验。
 */
export const OUTSIDE_ROOT_DEPTH = -1

/**
 * 计算 p 相对 root 的深度。**返回值恒为有限整数**：
 *   · p === root            → 0
 *   · p 在 root 之下        → 层数（≥1）
 *   · p 不在 root 之下      → {@link OUTSIDE_ROOT_DEPTH}（-1）
 *
 * 🔴 契约：本函数的返回值会**直接进入工具输出**，故**绝不允许**是 `Infinity`／`NaN`
 *    （宿主 lossless-JSON 校验拒收非有限数 → 整份输出被拒）。比较用 `=== OUTSIDE_ROOT_DEPTH`。
 * @param {string} root
 * @param {string} p
 * @returns {number} 有限整数
 */
export function relativeDepth(root, p) {
  const rel = posix.relative(toPosix(root), toPosix(p))
  if (rel === '') return 0
  if (rel === '..' || rel.startsWith('../')) return OUTSIDE_ROOT_DEPTH
  return rel.split('/').length
}

/**
 * 以 base 为基准把 p 变绝对（纯字符串，不访问磁盘）。
 * @param {string} base
 * @param {string} p
 * @returns {string}
 */
function absolutize(base, p) {
  return isAbsolute(p) ? p : nodeResolve(base, p)
}

/**
 * 把路径规范化为「符号链接已跟随」的形式（**不要求路径存在**）。
 *
 * 存在 → 真实路径；不存在／探测失败 → 退回词法规范化路径（`nodeResolve`）。
 * 后者与两个适配器的既有语义一致：`nodeFsAdapter.realpath` 的 catch 分支、
 * 以及宿主 `LocalFileSystem.resolveLocalTarget` 的「祖先修复」都是这么做的。
 *
 * 🔴 为什么显式指定路径必须经过它：`absolutize` 对已是绝对的路径**原样返回**（不做 realpath），
 *    而 `workspaceRoot`（`process.cwd()`／宿主 `sandboxPolicy.resolve()`）是**规范化**路径。
 *    两者只在「路径里出现过符号链接」时才不一致 —— 而 macOS 上 `/tmp`→`/private/tmp` 必然不一致
 *    → 深度判定成「不在工作区根下」。三条来源（显式／约定／深层）必须共用同一口径。
 * @param {object} fs
 * @param {string} p
 * @returns {Promise<string>}
 */
async function realpathPath(fs, p) {
  try {
    return toPosix(await fs.realpath(p))
  } catch {
    // realpath 探测失败不致命：退回词法规范化，后续 probeDirectory 会把「不存在」如实记进 skipped。
    return toPosix(nodeResolve(p))
  }
}

/**
 * 读取路径元数据，**不跟随末段符号链接**；不存在返回 undefined，其他 IO 失败抛出。
 * @param {{lstat: (path: string) => Promise<{type: string}|undefined>}} fs
 * @param {string} p
 * @returns {Promise<{type: string}|undefined>}
 */
async function lstatOrUndefined(fs, p) {
  return fs.lstat(p)
}

/**
 * 判断路径是不是「真实目录」（非符号链接、非文件、非不存在）。
 * @param {object} fs
 * @param {string} p
 * @returns {Promise<{ok: true, type: string} | {ok: false, type: string|undefined, error: Error|undefined}>}
 */
async function probeDirectory(fs, p) {
  try {
    const info = await lstatOrUndefined(fs, p)
    if (info === undefined) return { ok: false, type: undefined, error: undefined }
    if (info.type === 'symlink') return { ok: false, type: 'symlink', error: undefined }
    if (info.type !== 'directory') return { ok: false, type: info.type, error: undefined }
    return { ok: true, type: 'directory' }
  } catch (cause) {
    return { ok: false, type: undefined, error: /** @type {Error} */ (cause) }
  }
}

/**
 * 探测某个路径是否是**常规文件**（不跟随末段符号链接）。
 *
 * 三态返回是刻意的：`'missing'`（不存在或不是常规文件，含符号链接）与
 * `'error'`（探测本身失败，例如所在目录无读权限）语义不同 ——
 * 前者是常态，后者必须记进 skipped 供调用方看见。
 * @param {object} fs
 * @param {string} p
 * @returns {Promise<'file'|'missing'|'error'>}
 */
async function probeRegularFile(fs, p) {
  try {
    const info = await lstatOrUndefined(fs, p)
    return info !== undefined && info.type === 'file' ? 'file' : 'missing'
  } catch {
    return 'error'
  }
}

/**
 * 把一个目录登记为「不可用」并给出原因（读权限/符号链接/非目录/不存在）。
 * @param {object} fs
 * @param {string} dir
 * @param {'explicit'|'convention'|'deep'} source
 * @param {(entry: {path: string, source: string, reason: string}) => void} noteSkipped
 * @returns {Promise<void>}
 */
async function recordUnusableDir(fs, dir, source, noteSkipped) {
  const abs = toPosix(dir)
  let reason = '不存在'
  try {
    const info = await lstatOrUndefined(fs, abs)
    if (info === undefined) reason = '不存在'
    else if (info.type === 'symlink') reason = '符号链接（拒绝跟随）'
    else if (info.type !== 'directory') reason = `不是目录（type=${info.type}）`
    else reason = '目录不可读（无读权限）'
  } catch (cause) {
    reason = `目录不可读（${/** @type {Error} */ (cause)?.code ?? 'IO 错误'}）`
  }
  noteSkipped({ path: abs, source, reason })
}

// ---------------------------------------------------------------------------
// 适配器：宿主 ctx.fs ／ node:fs/promises
// ---------------------------------------------------------------------------

/**
 * 把宿主的 `ctx.fs`（`@deepseek-ai/dsh-fs` 的 FileSystem 服务）适配成本模块需要的窄接口。
 * 形状依据：tmp/dsh-installed/dsh-fs/lib/index.js 与 tmp/dsh-src-0923/packages/fs/fs/src/index.ts
 * （`resolve(path, opts)` / `stat(target, signal)` / `lstat(path, opts, signal)` / `listDir(target, signal)`）。
 * @param {{resolve: Function, stat: Function, lstat: Function, listDir: Function}} fileSystem
 * @returns {object} 窄接口适配器
 */
export function hostFsAdapter(fileSystem) {
  return {
    async realpath(p) {
      const target = await fileSystem.resolve(p)
      // 🔴 resolve() 内部 realpath：符号链接在这里已被跟随。
      // 故调用方必须先经 lstat 判符号链接，再走到这里（见 C3 取证）。
      return target.targetKey
    },
    async stat(p) {
      const target = await fileSystem.resolve(p)
      const info = await fileSystem.stat(target)
      return info === undefined ? undefined : { type: info.type, size: info.size }
    },
    async lstat(p) {
      const info = await fileSystem.lstat(p)
      return info === undefined ? undefined : { type: info.type, size: info.size }
    },
    async listDir(p) {
      const target = await fileSystem.resolve(p)
      const entries = await fileSystem.listDir(target)
      return entries.map((entry) => ({ name: entry.name, type: entry.type }))
    },
  }
}

/**
 * 无宿主时的兜底适配器：直接用 `node:fs/promises`。
 *
 * 说明（取证 C1/C4）：沙箱的围栏加在 `ctx.fs` 的 mutation 与 `ctx.shell` 上，
 * 不是 node 模块加载层，故插件进程内直用 node:fs **不会被拒**；此兜底同时是单测通道。
 * @returns {object} 窄接口适配器
 */
export function nodeFsAdapter() {
  return {
    async realpath(p) {
      try {
        return await nodeRealpath(p)
      } catch {
        // 路径不存在时退回「词法规范化」路径，与宿主 LocalFileSystem 的祖先修复语义一致
        // （tmp/dsh-installed/dsh-fs-local/lib/index.js 的 resolveLocalTarget）。
        return nodeResolve(p)
      }
    },
    async stat(p) {
      try {
        const info = await nodeStat(p)
        return { type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other', size: info.size }
      } catch (cause) {
        if (isMissingPathError(cause)) return undefined
        throw cause
      }
    },
    async lstat(p) {
      try {
        const info = await nodeLstat(p)
        return { type: info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other', size: info.size }
      } catch (cause) {
        if (isMissingPathError(cause)) return undefined
        throw cause
      }
    },
    async listDir(p) {
      const entries = await nodeReaddir(p, { withFileTypes: true })
      return entries.map((entry) => ({
        name: entry.name,
        type: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      }))
    },
  }
}

/**
 * 判断错误是否是「路径不存在」类（宿主 FsError 的 FS_NOT_FOUND，或 node 的 ENOENT/ENOTDIR）。
 * @param {unknown} cause
 * @returns {boolean}
 */
function isMissingPathError(cause) {
  const code = /** @type {{code?: string}} */ (cause)?.code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'FS_NOT_FOUND'
}

// ---------------------------------------------------------------------------
// 发现
// ---------------------------------------------------------------------------

/**
 * 给候选定序（确定性排序键）：
 *   ① 来源优先级：explicit > convention > deep
 *   ② 距工作区根更浅者优先（depth 小者优先）
 *   ③ 字典序（绝对路径，`localeCompare` 固定 locale 以免随环境变化）
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export function compareCandidates(a, b) {
  const rank = SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
  if (rank !== 0) return rank
  if (a.depth !== b.depth) return a.depth - b.depth
  return a.path.localeCompare(b.path, 'en')
}

/**
 * 生成「为什么选中它」的一句话理由。
 * @param {object} selected
 * @param {number} total
 * @returns {string}
 */
function selectionReason(selected, total) {
  if (total === 1) {
    return `唯一候选（来源：${SOURCE_LABEL[selected.source]}）`
  }
  return [
    `按排序键「来源优先级 > 距工作区根更浅 > 字典序」从 ${total} 个候选中选中`,
    `来源=${SOURCE_LABEL[selected.source]}`,
    describeDepth(selected.depth),
    `路径=${selected.path}`,
  ].join('；')
}

/**
 * 把深度渲染成人类可读文本。不在工作区根下时**不写 `-1`**（那是内部哨兵，不是层数）。
 *
 * 正数情形沿用既有措辞「距根 N 层」（I2 实测报告 §5.3 的逐字输出即此措辞），只改哨兵情形。
 * @param {number} depth
 * @returns {string}
 */
function describeDepth(depth) {
  return depth === OUTSIDE_ROOT_DEPTH ? '不在工作区根下' : `距根 ${depth} 层`
}

/**
 * 自动发现工作区里的教室包。
 *
 * @param {object} [options]
 * @param {string[]} [options.explicitDirs] 显式指定的教室目录或 classroom.yaml 路径（最高优先级）
 * @param {string} [options.workspaceRoot] 工作区根；缺省时用 process.cwd()（调用方应显式传入）
 * @param {number} [options.maxDepth] deep 扫描深度上限，默认 3
 * @param {object} [options.fs] 窄接口适配器；缺省用 nodeFsAdapter()
 * @param {string[]} [options.excludeDirs] 覆盖默认跳过目录名
 * @returns {Promise<{
 *   status: 'ok'|'ambiguous'|'none',
 *   workspaceRoot: string,
 *   selected: object|null,
 *   reason: string,
 *   candidates: object[],
 *   skipped: object[],
 *   problems: string[],
 *   scanned: { maxDepth: number },
 * }>}
 */
export async function discoverClassrooms(options = {}) {
  const fs = options.fs ?? nodeFsAdapter()
  // 🔴 工作区根先规范化一次（FIX-1 ④）：深度基准必须是规范化路径，否则「显式」与
  //    「约定／深层」两条来源的候选会带着不同的路径前缀，深度判定随符号链接而错。
  //    真实宿主下 workspaceRoot 本已是规范化路径（sandboxPolicy.resolve()），此步是幂等的。
  const workspaceRoot = await realpathPath(fs, options.workspaceRoot ?? process.cwd())
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : DEFAULT_SEARCH_DEPTH
  const excluded = new Set(options.excludeDirs ?? DEFAULT_EXCLUDED_DIRS)
  const explicitDirs = (options.explicitDirs ?? []).filter((p) => typeof p === 'string' && p.trim().length > 0)

  /** @type {Map<string, object>} 以绝对路径去重 */
  const found = new Map()
  /** @type {object[]} */
  const skipped = []
  /** @type {Set<string>} 已登记进 skipped 的路径（FIX-1 ③：按 path 去重） */
  const skippedPaths = new Set()
  /** @type {string[]} */
  const problems = []

  /**
   * 登记一条 skipped，**按 path 去重**（保留首次出现的来源与理由）。
   *
   * 为什么必须去重：同一个符号链接会被「约定目录扫描」与「深层扫描」各登记一次
   * （约定目录本身就在深层扫描的路径上）→ 用户会以为有两个坏目录，且 `跳过 N 项` 的 N 虚高一倍。
   * 保留**首次**（来源优先级更高的那条）而不是合并，是为了不动既有的逐条理由语义。
   * @param {{path: string, source: string, reason: string}} entry
   */
  const noteSkipped = (entry) => {
    if (skippedPaths.has(entry.path)) return
    skippedPaths.add(entry.path)
    skipped.push(entry)
  }

  /**
   * 把一个「确认含 classroom.yaml 的目录」登记为候选（同时校验该目录本身不是符号链接）。
   * @param {string} dir 绝对路径
   * @param {'explicit'|'convention'|'deep'} source
   */
  const registerCandidate = async (dir, source) => {
    const abs = await realpathPath(fs, dir)
    if (found.has(abs)) return
    const dirProbe = await probeDirectory(fs, abs)
    if (!dirProbe.ok) {
      await recordUnusableDir(fs, abs, source, noteSkipped)
      return
    }
    found.set(abs, {
      path: abs,
      source,
      depth: relativeDepth(workspaceRoot, abs),
      manifestPath: toPosix(join(abs, MANIFEST_FILENAME)),
      selected: false,
    })
  }

  // ---- ① 显式指定 ----
  for (const raw of explicitDirs) {
    // 🔴 FIX-1 ①：显式路径也走 realpath，与 workspaceRoot／约定／深层三条口径统一。
    const abs = await realpathPath(fs, absolutize(workspaceRoot, raw))
    // 允许显式给出 classroom.yaml 本身，也允许给出教室目录
    if (posix.basename(toPosix(abs)) === MANIFEST_FILENAME) {
      const dir = nodeResolve(abs, '..')
      const probe = await probeRegularFile(fs, abs)
      if (probe === 'file') await registerCandidate(dir, 'explicit')
      else noteSkipped({ path: toPosix(abs), source: 'explicit', reason: `${MANIFEST_FILENAME} 不存在、不是常规文件，或所在目录不可读（含符号链接）` })
      continue
    }
    const manifestAt = toPosix(join(abs, MANIFEST_FILENAME))
    const probe = await probeRegularFile(fs, manifestAt)
    if (probe === 'file') {
      await registerCandidate(abs, 'explicit')
      continue
    }
    const dirProbe = await probeDirectory(fs, abs)
    if (!dirProbe.ok) {
      await recordUnusableDir(fs, abs, 'explicit', noteSkipped)
    } else if (probe === 'error') {
      noteSkipped({ path: toPosix(abs), source: 'explicit', reason: `目录不可读（无读权限），无法确认 ${MANIFEST_FILENAME}` })
    } else {
      noteSkipped({ path: toPosix(abs), source: 'explicit', reason: `目录里没有 ${MANIFEST_FILENAME}（缺 manifest 不算教室）` })
    }
  }

  // ---- ② 约定目录 classrooms/*/classroom.yaml ----
  const conventionRoot = toPosix(join(workspaceRoot, CONVENTION_DIRNAME))
  const conventionProbe = await probeDirectory(fs, conventionRoot)
  if (conventionProbe.ok) {
    let entries
    try {
      entries = await fs.listDir(conventionRoot)
    } catch (cause) {
      noteSkipped({ path: conventionRoot, source: 'convention', reason: `目录不可读：${String(/** @type {Error} */ (cause)?.message ?? cause)}` })
      entries = []
    }
    for (const entry of entries) {
      const child = toPosix(join(conventionRoot, entry.name))
      if (entry.type === 'symlink') {
        noteSkipped({ path: child, source: 'convention', reason: '目录项是符号链接（拒绝跟随）' })
        continue
      }
      if (entry.type !== 'directory') continue
      const probe = await probeRegularFile(fs, toPosix(join(child, MANIFEST_FILENAME)))
      if (probe === 'file') await registerCandidate(child, 'convention')
      else if (probe === 'error') await recordUnusableDir(fs, child, 'convention', noteSkipped)
      // 约定目录下「缺 manifest 的子目录」不记 skipped：那是常态噪音，不是异常。
    }
  } else if (conventionProbe.type === 'symlink') {
    noteSkipped({ path: conventionRoot, source: 'convention', reason: `约定目录 ${CONVENTION_DIRNAME}/ 是符号链接（拒绝跟随）` })
  } else if (conventionProbe.error !== undefined) {
    problems.push(`约定目录 ${conventionRoot} 探测失败：${conventionProbe.error.message}`)
  }

  // ---- ③ 深层扫描（有深度上限；跳过符号链接/噪音目录/不可读目录） ----
  /**
   * @param {string} dir 绝对路径
   * @param {number} depth 相对工作区根的层数
   */
  const walk = async (dir, depth) => {
    let entries
    try {
      entries = await fs.listDir(dir)
    } catch (cause) {
      noteSkipped({ path: toPosix(dir), source: 'deep', reason: `目录不可读，跳过：${String(/** @type {Error} */ (cause)?.message ?? cause)}` })
      return
    }
    for (const entry of entries) {
      const child = toPosix(join(dir, entry.name))
      if (entry.type === 'symlink') {
        noteSkipped({ path: child, source: 'deep', reason: '目录项是符号链接（拒绝跟随）' })
        continue
      }
      if (entry.type !== 'directory') continue
      if (excluded.has(entry.name)) continue
      // 先探测「本层就是教室」——这一次探测同时暴露「目录不可读」：
      // 🔴 不可读目录若只在下探时才被发现，处在深度上限那一层就会静默漏记
      //    （实测：maxDepth=1 时 mode 000 的目录从未被进入 → skipped 为空）。
      const probe = await probeRegularFile(fs, toPosix(join(child, MANIFEST_FILENAME)))
      if (probe === 'file') {
        await registerCandidate(child, 'deep')
      } else if (probe === 'error') {
        await recordUnusableDir(fs, child, 'deep', noteSkipped)
        continue
      }
      if (depth + 1 < maxDepth) await walk(child, depth + 1)
    }
  }
  const rootProbe = await probeDirectory(fs, workspaceRoot)
  if (rootProbe.ok) {
    if (maxDepth >= 1) await walk(workspaceRoot, 0)
  } else {
    problems.push(`工作区根 ${workspaceRoot} 不是可读目录（type=${rootProbe.type ?? '不存在'}）：${rootProbe.error?.message ?? '未提供错误'}`)
  }

  // ---- 定序与选择 ----
  const candidates = [...found.values()].sort(compareCandidates)
  const selected = candidates.length > 0 ? candidates[0] : null
  if (selected) selected.selected = true

  const status = candidates.length === 0 ? 'none' : candidates.length === 1 ? 'ok' : 'ambiguous'
  const reason = selected === null
    ? `在 ${workspaceRoot} 下未发现任何含 ${MANIFEST_FILENAME} 的目录（已扫深度 ≤${maxDepth}）`
    : selectionReason(selected, candidates.length)

  return {
    status,
    workspaceRoot: toPosix(workspaceRoot),
    selected,
    reason,
    candidates,
    skipped,
    problems,
    scanned: { maxDepth },
  }
}

/**
 * 把发现结果渲染成给模型/日志读的多行文本（明说 N 个、选中 X、理由 Y、其余）。
 * @param {Awaited<ReturnType<typeof discoverClassrooms>>} result
 * @returns {string}
 */
export function formatDiscovery(result) {
  const lines = []
  if (result.status === 'none') {
    lines.push(`教室发现：0 个候选。${result.reason}`)
  } else {
    lines.push(`教室发现：${result.candidates.length} 个候选（状态 ${result.status}）。`)
    lines.push(`已选：${result.selected.path}`)
    lines.push(`理由：${result.reason}`)
    const rest = result.candidates.filter((c) => !c.selected)
    if (rest.length > 0) {
      lines.push(`其余未选中（${rest.length} 个，可显式指定切换）：`)
      for (const c of rest) lines.push(`  - ${c.path}（来源 ${c.source}，${describeDepth(c.depth)}）`)
    } else {
      lines.push('其余未选中：无')
    }
  }
  if (result.skipped.length > 0) {
    lines.push(`跳过 ${result.skipped.length} 项：`)
    for (const s of result.skipped.slice(0, 10)) lines.push(`  - ${s.path}：${s.reason}`)
    if (result.skipped.length > 10) lines.push(`  - …另有 ${result.skipped.length - 10} 项，见工具结构化输出`)
  }
  for (const p of result.problems) lines.push(`问题：${p}`)
  return lines.join('\n')
}

/**
 * 在给定 options 上求工作区根：显式 > ctx.sandboxPolicy > process.cwd()。
 * 取证 A3：宿主把「会话的 workspace root」定义为 session.header.cwd，经
 * ctx.sandboxPolicy.resolve({session}).workspaceRoot 暴露。
 * @param {object} ctx
 * @param {{session?: object}} [request]
 * @returns {string}
 */
export function resolveWorkspaceRootFromCtx(ctx, request = {}) {
  try {
    const session = request.session ?? ctx?.agent?.session
    const resolved = ctx?.sandboxPolicy?.resolve?.({ session })
    if (resolved?.workspaceRoot) return resolved.workspaceRoot
  } catch {
    /* 沙箱策略服务不可用不致命 */
  }
  try {
    if (typeof ctx?.sandboxPolicy?.workspaceRoot === 'string') return ctx.sandboxPolicy.workspaceRoot
  } catch {
    /* 同上 */
  }
  return process.cwd()
}

/**
 * 在给定 exec 上求工作区根：exec.agent?.session?.header?.cwd（取证 A5）优先。
 * @param {{agent?: {session?: {header?: {cwd?: string}}}}} [exec]
 * @returns {string|undefined}
 */
export function workspaceRootFromExec(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

// ---------------------------------------------------------------------------
// 工具注册（集成入口）
// ---------------------------------------------------------------------------

/**
 * 注册「教室目录发现」能力：新增工具 `classroom_list`。
 *
 * 🔴 本函数**不改动**任何既有工具（`classroom_status` 的行为由集成方决定，见
 *    `接线说明_S2.md`）；它只新增一个只读工具，并把发现结果经 `onDiscovered` 回传。
 *
 * 依赖注入说明：`defineTool` 从 `@deepseek-ai/dsh-tools` 取。为守住「插件不得把宿主核心包
 * 装进自己 node_modules」的铁律，本文件**不静态 import 宿主包**，改由调用方（index.mjs）
 * 把自己已经 import 的 `defineTool` 传进来。未传时 `registerDiscovery` 仍完成发现并回调，
 * 只是不注册工具（便于无宿主环境复用）。
 *
 * @param {object} ctx cordis 插件上下文
 * @param {object} [opts]
 * @param {Function} [opts.defineTool] 宿主的 `defineTool`（从 '@deepseek-ai/dsh-tools' 传入）
 * @param {string} [opts.initialDir] 配置里的显式教室目录（config.classroomDir）
 * @param {string} [opts.workspaceRoot] 显式工作区根；缺省按 ctx 推导
 * @param {number} [opts.maxDepth] deep 扫描深度上限
 * @param {object} [opts.fs] 窄接口适配器；缺省宿主 ctx.fs → node:fs 兜底
 * @param {(result: object) => void|Promise<void>} [opts.onDiscovered] 每次发现后的回调
 * @param {(result: object) => object} [opts.project] 可选：把发现结果投影成工具返回值（默认内置投影）
 * @returns {{ run: () => Promise<object>, last: () => object|null, workspaceRoot: () => string }}
 */
export function registerDiscovery(ctx, opts = {}) {
  // 🔴 FIX-6（2026-09-24）：与 index.mjs 同一个缺陷——`ctx.logger(name, ...args)` 的形状下
  //    cordis 只取 name、丢掉全部参数（真 cordis 4.0.2 运行时段实测：旧形状 0 条、新形状 1 条）。
  //    name 与 index.mjs 统一成 `[socratic-engine]`（原为 `[socratic-engine:discovery]`）：
  //    同一插件只占一个可辨识的 logger 名，避免"按名过滤日志"时漏掉发现层。
  //    级别 `info`：这里记的是发现过程轨迹（候选数/选中理由/跳过项），不是异常。
  const LOGGER_NAME = '[socratic-engine]'
  const log = (...args) => {
    try {
      ctx?.logger?.(LOGGER_NAME).info(...args)
    } catch {
      /* logger 不可用不致命 */
    }
  }

  /** 取文件系统适配器：宿主 ctx.fs 优先，node:fs 兜底（取证 A4 / C1）。 */
  const pickFs = () => {
    if (opts.fs) return opts.fs
    const hostFs = ctx?.get?.('fs')
    return hostFs === undefined ? nodeFsAdapter() : hostFsAdapter(hostFs)
  }

  /**
   * 求本次发现的工作区根。
   * @param {object} [request] 可带 session
   * @returns {string}
   */
  const pickRoot = (request) => opts.workspaceRoot ?? resolveWorkspaceRootFromCtx(ctx, request)

  /** @type {object|null} 最近一次发现结果 */
  let last = null
  /** @type {string} */
  let lastRoot = ''

  /**
   * 执行一次发现。
   * @param {{session?: object}} [request]
   * @returns {Promise<object>}
   */
  const run = async (request = {}) => {
    const workspaceRoot = pickRoot(request)
    const result = await discoverClassrooms({
      workspaceRoot,
      explicitDirs: opts.initialDir ? [opts.initialDir] : [],
      maxDepth: opts.maxDepth,
      fs: pickFs(),
    })
    last = result
    lastRoot = workspaceRoot
    log(`发现 ${result.candidates.length} 个候选（状态 ${result.status}），工作区根 ${workspaceRoot}`)
    if (result.status === 'none') {
      log(`无候选：${result.reason}`)
    } else if (result.status === 'ambiguous') {
      log(`候选歧义：已选 ${result.selected.path}；理由：${result.reason}`)
      log(`其余候选：${result.candidates.filter((c) => !c.selected).map((c) => c.path).join(' | ')}`)
    }
    if (result.skipped.length > 0) log(`跳过 ${result.skipped.length} 项（见 classroom_list 输出）`)
    if (result.problems.length > 0) log(`问题：${result.problems.join(' | ')}`)
    if (typeof opts.onDiscovered === 'function') await opts.onDiscovered(result)
    return result
  }

  // ---- 工具：classroom_list ----
  if (typeof opts.defineTool === 'function') {
    const defineTool = opts.defineTool
    ctx.tools.register(
      defineTool({
        name: 'classroom_list',
        description:
          'List the SocraticNovel classroom packages discovered under the workspace root, which one the engine selected, and why. Use it when the user asks which classrooms exist, why a particular classroom is active, or after editing classroom.yaml files. Read-only.',
        parameters: {
          refresh: {
            type: 'boolean',
            description: 'Re-scan the workspace now instead of returning the cached discovery from the last run.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              status: { type: 'string', required: true },
              workspaceRoot: { type: 'string', required: true },
              selected: { type: 'string', required: true },
              reason: { type: 'string', required: true },
              candidates: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    path: { type: 'string', required: true },
                    source: { type: 'string', required: true },
                    depth: { type: 'integer', required: true },
                    selected: { type: 'boolean', required: true },
                  },
                },
              },
              skipped: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    path: { type: 'string', required: true },
                    reason: { type: 'string', required: true },
                  },
                },
              },
              problems: { type: 'array', required: true, items: { type: 'string' } },
              summary: { type: 'string', required: true },
            },
          },
          render: (_args, value) => [{ type: 'text', text: value.summary }],
        },
        execute: async (args, exec) => {
          const fresh = args?.refresh === true || last === null
          const result = fresh ? await run({ session: exec?.agent?.session }) : last
          return {
            status: result.status,
            workspaceRoot: result.workspaceRoot,
            selected: result.selected === null ? '' : result.selected.path,
            reason: result.reason,
            candidates: result.candidates.map((c) => ({
              path: c.path,
              source: c.source,
              depth: c.depth,
              selected: c.selected === true,
            })),
            skipped: result.skipped.slice(0, 20).map((s) => ({ path: s.path, reason: s.reason })),
            problems: [...result.problems],
            summary: formatDiscovery(result),
          }
        },
      }),
    )
    log('已注册工具 classroom_list')
  } else {
    log('未传入 defineTool：只做发现，不注册 classroom_list 工具')
  }

  return {
    run,
    last: () => last,
    workspaceRoot: () => lastRoot,
  }
}
