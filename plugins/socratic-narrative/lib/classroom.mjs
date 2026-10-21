// lib/classroom.mjs — 教室目录与教室内容的确定性读取（零依赖，不猜）
//
// 本模块回答四个问题，每个都只给一个确定答案（找不到就抛/返回 null，不猜第二个）：
//   ① 这次调用对应哪个教室目录？（`resolveClassroomDir`）
//   ② 这一版教室的**当课角色卡**是哪一份、她叫什么？（`resolveCharacter`）
//   ③ 教室里有哪几个人可以开口说话？（`listCharacterNames`）
//   ④ 现在讲到第几讲、相位是什么、哪些讲次跳过？（`readProgress`）
//
// 🔴 为什么不当场硬编码 `characters/komari.md`：N2 的第一版就是硬编码的，而这一版教室的
//   当课老师已经换成「鲸（DeepSeek 娘）」——硬编码会让日记/群聊读到的是一张留在树里当
//    对照组的旧卡（N6.1「单一人格源」会直接破功）。真源是 `classroom.yaml` 里
//    `layer: persona` 那个块的 `path:`；换角色只换那一行。

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ERROR_CODES, NarrativeError } from './errors.mjs'

/** 教室 manifest 的固定文件名（与引擎 `lib/discovery.mjs` 同名）。 */
export const MANIFEST_FILENAME = 'classroom.yaml'

/** 约定目录名：`<root>/classrooms/<name>/classroom.yaml`（与引擎同一约定）。 */
export const CONVENTION_DIRNAME = 'classrooms'

/**
 * 判断一个目录是不是教室目录（有 `classroom.yaml`）。
 * @param {string} dir
 * @returns {Promise<boolean>}
 */
async function isClassroomDir(dir) {
  try {
    const info = await stat(join(dir, MANIFEST_FILENAME))
    return info.isFile()
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false
    throw error
  }
}

/**
 * 把「某个根目录」解析成教室目录。
 *
 * 规则（只有三条，且**绝不静默选一个**）：
 *   ① 根目录自己就是教室 → 用它（会话 cwd 就是教室时的常态）；
 *   ② 根目录下有**恰好一个** `<root>/classrooms/<name>/classroom.yaml` → 用它；
 *   ③ 其余（一个都没有 / 有多个）→ 返回 `null` 或抛 `AMBIGUOUS_CLASSROOM`。
 *
 * @param {string} root - 工作区根或教室目录（绝对路径）
 * @returns {Promise<{dir: string|null, candidates: string[], reason: string}>}
 */
export async function resolveClassroomDir(root) {
  if (await isClassroomDir(root)) return { dir: root, candidates: [root], reason: 'root-is-classroom' }

  let entries
  try {
    entries = await readdir(join(root, CONVENTION_DIRNAME), { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return { dir: null, candidates: [], reason: 'no-classroom' }
    }
    throw error
  }
  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(root, CONVENTION_DIRNAME, entry.name)
    if (await isClassroomDir(dir)) candidates.push(dir)
  }
  candidates.sort()
  if (candidates.length === 1) return { dir: candidates[0], candidates, reason: 'convention' }
  if (candidates.length === 0) return { dir: null, candidates, reason: 'no-classroom' }
  return { dir: null, candidates, reason: 'ambiguous' }
}

/**
 * 解析当课角色卡：`classroom.yaml` 里第一个 `path: characters/*.md`。
 *
 * 只认真正的 `path:` 行（注释与 license 里出现的 `characters/...` 不算）。
 *
 * @param {string} classroomDir
 * @returns {Promise<{relative: string, name: string, aliases: string[], content: string}>}
 * @throws {NarrativeError} IO_ERROR / NO_CHARACTER / AMBIGUOUS_CHARACTER
 */
export async function resolveCharacter(classroomDir) {
  let manifest
  try {
    manifest = await readFile(join(classroomDir, MANIFEST_FILENAME), 'utf8')
  } catch (cause) {
    throw new NarrativeError(ERROR_CODES.IO_ERROR, `读不到 ${join(classroomDir, MANIFEST_FILENAME)}——取不到当课角色卡`, {
      cause,
      detail: { reason: 'NO_CLASSROOM_MANIFEST', file: MANIFEST_FILENAME },
    })
  }
  const paths = []
  for (const line of manifest.split('\n')) {
    // 行首（允许缩进与列表号）必须是 `path:`；整行注释以 # 开头，天然不匹配
    const match = /^\s*(?:-\s*)?path:\s*["']?(characters\/[^\s"'#]+\.md)["']?\s*$/.exec(line)
    if (match !== null && !paths.includes(match[1])) paths.push(match[1])
  }
  if (paths.length === 0) {
    throw new NarrativeError(ERROR_CODES.IO_ERROR, `${MANIFEST_FILENAME} 里没有任何 path: characters/*.md —— 取不到当课角色卡`, {
      detail: { reason: 'NO_CHARACTER' },
    })
  }
  if (paths.length > 1) {
    throw new NarrativeError(ERROR_CODES.IO_ERROR, `${MANIFEST_FILENAME} 里声明了不止一张角色卡（${paths.join(' / ')}）—— 不静默选一张`, {
      detail: { reason: 'AMBIGUOUS_CHARACTER', paths },
    })
  }
  const relative = paths[0]
  let content
  try {
    content = await readFile(join(classroomDir, relative), 'utf8')
  } catch (cause) {
    throw new NarrativeError(ERROR_CODES.IO_ERROR, `角色卡 ${relative} 读不到：${cause?.message ?? cause}`, {
      cause,
      detail: { reason: 'CHARACTER_UNREADABLE', relative },
    })
  }
  const name = characterNameOf(content) ?? relative
  return { relative, name, aliases: aliasesOf(name), content }
}

/**
 * 从角色卡的一级标题里取名字：`# 鲸（DeepSeek 娘）· 本教室版本` → `鲸（DeepSeek 娘）`。
 * @param {string} markdown
 * @returns {string|null}
 */
export function characterNameOf(markdown) {
  for (const line of String(markdown ?? '').split('\n')) {
    const match = /^#\s+(.+?)\s*$/.exec(line)
    if (match === null) continue
    const title = match[1]
    const cut = title.indexOf('·')
    return (cut === -1 ? title : title.slice(0, cut)).trim() || null
  }
  return null
}

/**
 * 一个名字的可用写法：`鲸（DeepSeek 娘）` → `['鲸（DeepSeek 娘）', '鲸']`。
 * 群里她可能只写短名，两种都认。
 * @param {string} name
 * @returns {string[]}
 */
export function aliasesOf(name) {
  const trimmed = String(name ?? '').trim()
  if (trimmed === '') return []
  const names = [trimmed]
  const short = trimmed.split('（')[0].split('(')[0].trim()
  if (short !== '' && short !== trimmed) names.push(short)
  return names
}

/**
 * 教室里有哪几个人能开口（`characters/*.md` 的一级标题）。
 * 一次性路人以 `路人·` 开头，由调用方单独放行（见 lib/group.mjs 的 validateSpeech）。
 * @param {string} classroomDir
 * @returns {Promise<{names: string[], files: string[]}>}
 */
export async function listCharacterNames(classroomDir) {
  const dir = join(classroomDir, 'characters')
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return { names: [], files: [] }
    throw error
  }
  const names = []
  const files = []
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const content = await readFile(join(dir, entry.name), 'utf8')
    const name = characterNameOf(content)
    if (name === null) continue
    files.push(`characters/${entry.name}`)
    for (const alias of aliasesOf(name)) if (!names.includes(alias)) names.push(alias)
  }
  return { names, files }
}

/**
 * 从 `runtime/progress.md` 里读机器可读行（只读，**不写**）。
 *
 * @param {string} text
 * @returns {{lesson: number|null, phase: string|null, skippedLessons: number[]}}
 */
export function readProgress(text) {
  let lesson = null
  let phase = null
  let skippedLessons = []
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim()
    const lessonMatch = /^current_lesson:\s*(\d+)\s*$/.exec(trimmed)
    if (lessonMatch !== null) {
      lesson = Number(lessonMatch[1])
      continue
    }
    const phaseMatch = /^current_phase:\s*([A-Za-z0-9_-]+)\s*$/.exec(trimmed)
    if (phaseMatch !== null) {
      phase = phaseMatch[1]
      continue
    }
    const skippedMatch = /^skipped_lessons:\s*(.*)$/.exec(trimmed)
    if (skippedMatch !== null) {
      skippedLessons = skippedMatch[1] === '—' || skippedMatch[1] === ''
        ? []
        : skippedMatch[1].split(',').map((part) => Number.parseInt(part.trim(), 10)).filter((n) => Number.isInteger(n))
    }
  }
  return { lesson, phase, skippedLessons }
}

/**
 * 读教室的进度文件（文件不存在 → 全 null/空，不抛）。
 * @param {string} classroomDir
 * @returns {Promise<{lesson: number|null, phase: string|null, skippedLessons: number[]}>}
 */
export async function readClassroomProgress(classroomDir) {
  try {
    return readProgress(await readFile(join(classroomDir, 'runtime', 'progress.md'), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return { lesson: null, phase: null, skippedLessons: [] }
    throw error
  }
}
