// lib/manifest.mjs — classroom.yaml 解析与校验（P1 骨架，零 DSH 依赖，纯函数可测）
//
// 依据：开源线/DSH定制/教室manifest格式_草案_v0.md（M1，2026-09-23）
// 本骨架实现其 schema 的 v0 子集：format / classroom / runtime_store / phases[] / blocks[]，
// 每块支持 layer / position{target,order|depth} / frequency{every,n} /
// phase{phases,except} / render{enabled,vars} / wrap{style} / path|text。
// 明确 TODO（M1 定稿后补）：render.missing/default 语义、x_ 扩展位透传。
// 🔴 `phase.advance_on` **不再列为 TODO**（2026-09-24 用户拍板）：相位推进**不由规则决定**，
//    改由教师在课堂上用 `classroom_set_phase` 工具自己宣布（引擎只负责记录＋按相位门控注入）。
//    → 校验器仍然不解析 `advance_on`（写了也不会生效，故**报错**，见 normalizeBlock 的 phase 段）。
//
// ── M2-SCHEMA v0.2 新增（2026-09-24，施工状态 §3 P0-4／P1-1）────────────────
// ① 块级**讲次门** `lesson: {current:true, of:N} | {current:true} | {list:[..]} | {range:[a,b]}`：
//    值唯一来源 = 顶层 `runtime_store` 声明的 progress 文件里的机器可读行
//    `<lesson_key>: <int>`（缺省键名 `current_lesson`）。
//    🔴 **语义写死**：`current_lesson` = **本轮要讲的讲次**（不是"已完成的讲次"）；
//       初始 `1`（第一节课讲第 1 讲）。
//    🔴 `of` 是「**本块所属讲次**」，与 `current_lesson` 相等才注入。
//       没有 `of` 时 `{current:true}` ＝「只要有讲次在讲就注入」（跨讲常驻块用）。
//       （为什么必须有 `of`：只判"存在 current_lesson"对每个 story.node.NN 都成立
//        → 14 块全注入 = 等于没加门。见 normalizeLessonGate 的注释。）
//    🔴 **不匹配不得静默**（本 bug 的教训）：缺 runtime_store 声明 / 找不到该行 /
//       值不是整数 / list・range 里出现非整数或空数组 / `of` 不是 >=1 整数
//       —— **一律抛 ManifestError**，报错带块 id、文件路径与期望键名。
//    兼容：**没写 `lesson` 门的块一律照旧注入**（既有 fixture 行为不变）。
// ② 块级**段级切片** `section: <二级标题文本>`（只对 `path` 有效）：
//    取该标题的正文，到**下一个同级或更高级标题之前**为止。
//    🔴 section 不存在 → 抛错并**列出该文件实际存在的标题清单**（帮贡献者改对）。
//    一个块只准一个 section 字符串（本项目规矩：不为假想需求预留扩展）。
//
// ── M3-STATE 新增（2026-09-24，施工状态 §3 P0-2／M2 待确认 C4、C12）────────────
// ③ `frequency.anchor: lesson_start | session_start`（草案 §2.2 已设计、此前未实现）：
//    **只与 `every: once` 连用**；`lesson_start` ＝「讲次变化时重新注入一次」（同一讲内只一次），
//    `session_start` ＝ 进程生命周期内一次（＝不写 anchor 的既有语义，显式写法）。
//    🔴 未知取值 / 与别的 every 连用 → 抛错（不静默降级）。
//    判定在 lib/injector.mjs（记账 Map 由 lib/phasestore.mjs 持有）。
// ④ **`of` 上界校验**（M2 待确认 C12）：教室声明 `classroom.lessons: N` 时，
//    讲次门里出现的讲次号（`of` / `list[*]` / `range[*]`）**不得超过 N** → 否则抛错。
//    没有 `lessons` 声明 → 不做上界校验（无可靠上界来源，见 `lessonsDeclaredBy`）。
// ⑤ **相位状态的落点**（草案 §2.0：`runtime_store` 是「模板变量与相位状态的来源」）：
//    相位写在 runtime_store.progress 文件里的机器可读行 `current_phase: <phase_id>`。
//    无 runtime_store 声明 / 无该行 → 用 manifest 的默认相位（向后兼容，不报错）；
//    有该行但取值不在相位值域内 → **抛错**（不静默）。
//    🔴 字段名 `current_phase` 由本文件定（草案未写死字段名）——见实现报告待确认清单。

import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

export const MANIFEST_FILENAME = 'classroom.yaml'
export const MANIFEST_FORMAT = 'socratic-classroom/0'

export const LAYERS = ['persona', 'discipline', 'context', 'state', 'anchor']
export const POSITION_TARGETS = ['system', 'chat']
export const FREQUENCY_MODES = ['once', 'turn', 'n_turns', 'phase', 'on_demand']
export const WRAP_STYLES = ['none', 'system-reminder']

// ── M3-STATE：`frequency.anchor` 值域（草案 §2.2）───────────────────────────
// 🔴 只与 `every: once` 连用。`session_start` 与「不写 anchor」等价（进程生命周期一次），
//    保留它是为了**显式**表达草案的两种锚点，且让「写错值」能被报出来（而不是当没写）。
export const FREQUENCY_ANCHORS = ['lesson_start', 'session_start']

// ── M3-STATE：相位状态的机器可读键名（草案 §2.0 的 runtime_store）───────────
// 与 `current_lesson` 同构：写在 runtime_store.progress 文件里的一行 `<key>: <phase_id>`。
export const PHASE_STATE_KEY = 'current_phase'

// ── 相位值域（P0-1 修复，2026-09-23）────────────────────────────────────────
// 权威依据：教室manifest格式_草案_v0.md §2.0 —— 顶层 `phases:` 是**教学内容的一部分**
//   （「不同教室的相位可能不同（比如实验课有"动手"相位）。写进数据侧才符合
//   "引擎×内容分离"」），**顺序即推进顺序**；并预留可推翻点「若引擎把相位机做成
//   固定枚举，`phases` 退化为校验清单（引擎报错"未定义的 phase id"）」。
//
// 🔴 修复的 bug：相位值域原先硬编码在 lib/phasestore.mjs（['boot','lecture',...]），
//   而真实教室 cs-os 声明的是 open/probe/answer/check/review/close → 交集只有
//   answer/review 且 yaml 未用到 → 20 个带相位门的块（含全部 14 个 story 块）
//   **一个都不会注入且不报错**（静默失效）。
//
// 值域来源（三档）：
//   ① 顶层 `phases:` 声明（权威，顺序即推进顺序）→ 值域 = 声明列表
//   ② 未声明 → **legacy 显式命名回退** `LEGACY_PHASES`（不是"从块求并集"）
//   ③ config.defaultPhase 可覆盖默认相位，但必须落在值域内（见 lib/phasestore.mjs）
export const LEGACY_PHASES = ['boot', 'lecture', 'quiz', 'answer', 'review', 'wrapup']

/** 相位 id 的合法形态：非空字符串，且不含空白/控制字符（防手滑写成 "open " 之类）。 */
const PHASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

// ── M2-SCHEMA：讲次门（lesson gate）与段级切片（section）的值域与常量 ────────

/** 讲次门缺省键名（顶层 runtime_store 未写 lesson_key 时用它）。 */
export const DEFAULT_LESSON_KEY = 'current_lesson'

/** 讲次必须是 >=1 的整数（第 0 讲＝未开始，不是合法讲次门取值）。 */
function assertLessonNo(value, where) {
  if (!Number.isInteger(value) || value < 1) {
    throw new ManifestError(`${where} 必须是 >=1 的整数（得到 ${JSON.stringify(value)}）`)
  }
}

/**
 * 规范化并校验块级讲次门。
 * 形态（三选一，恰好一个）：
 *   lesson: { current: true, of: 3 }  → 只在"本轮要讲的讲次 == 本块所属讲次(3)"时注入
 *   lesson: { current: true }         → 只在"有讲次在讲"时注入（与具体讲次无关）
 *   lesson: { list: [1, 2] }          → 指定讲次
 *   lesson: { range: [1, 3] }         → 闭区间
 *
 * 🔴 `current` 为什么需要 `of`（M2 落地时发现的表达力缺口，已留痕）：
 *   `current: true` 若只判"存在 current_lesson"，则对**每一个** `story.node.NN`
 *   都成立 → 14 块全部注入，等于没加门（本 bug 的原始症状原样复发）。
 *   所以「本块属于第几讲」必须**显式写出来**（`of`），不靠 id 或 path 猜
 *   （猜＝隐式耦合，会静默失效——正是 P0-4 的教训）。
 * @returns {{current:true, of?:number}|{list:number[]}|{range:[number,number]}}
 */
export function normalizeLessonGate(raw, at, id) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ManifestError(`${at}(${id}).lesson 必须是映射：{current:true, of:N} / {list:[..]} / {range:[a,b]}`)
  }
  const where = `${at}(${id}).lesson`
  const keys = ['current', 'list', 'range'].filter((k) => raw[k] !== undefined)
  if (keys.length !== 1) {
    throw new ManifestError(
      `${where} 必须且只能写一个键（current / list / range），得到 ${JSON.stringify(keys)}` +
        `（原文 ${JSON.stringify(raw)}）`,
    )
  }
  const stray = Object.keys(raw).filter((k) => !['current', 'list', 'range', 'of'].includes(k))
  if (stray.length > 0) {
    throw new ManifestError(`${where} 有无法识别的键 ${JSON.stringify(stray)}（可用：current/list/range/of）`)
  }
  const key = keys[0]
  if (key === 'current') {
    if (raw.current !== true) {
      throw new ManifestError(`${where}.current 只能写 true（得到 ${JSON.stringify(raw.current)}）`)
    }
    if (raw.of === undefined) return { current: true }
    assertLessonNo(raw.of, `${where}.of`)
    return { current: true, of: raw.of }
  }
  if (raw.of !== undefined) {
    throw new ManifestError(`${where}.of 只与 current 连用（list/range 本身已写明讲次）`)
  }
  if (key === 'list') {
    const list = raw.list
    if (!Array.isArray(list) || list.length === 0) {
      throw new ManifestError(`${where}.list 必须是非空数组（得到 ${JSON.stringify(list)}）`)
    }
    list.forEach((v, i) => assertLessonNo(v, `${where}.list[${i}]`))
    return { list: [...list] }
  }
  const range = raw.range
  if (!Array.isArray(range) || range.length !== 2) {
    throw new ManifestError(`${where}.range 必须是 [起, 止] 两个元素（得到 ${JSON.stringify(range)}）`)
  }
  assertLessonNo(range[0], `${where}.range[0]`)
  assertLessonNo(range[1], `${where}.range[1]`)
  if (range[0] > range[1]) {
    throw new ManifestError(`${where}.range 起点不得大于终点（得到 ${JSON.stringify(range)}）`)
  }
  return { range: [range[0], range[1]] }
}

/**
 * 判定讲次门是否放行某个讲次。
 * 🔴 不匹配/缺值一律由调用方报错（见 lib/injector.mjs），本函数只做纯判定。
 * 语义：
 *   - 无门（null/undefined） → 放行
 *   - `{current:true, of:N}` → 只在 lessonNo === N 时放行（**本块所属讲次 == 本轮要讲的讲次**）
 *   - `{current:true}`       → 只要有讲次在讲就放行（跨讲常驻块，与具体讲次无关）
 *   - `{list:[..]}`          → lessonNo ∈ list
 *   - `{range:[a,b]}`        → a ≤ lessonNo ≤ b
 */
export function lessonGateAllows(gate, lessonNo) {
  if (gate === null || gate === undefined) return true
  if (!Number.isInteger(lessonNo)) return false
  if (gate.current === true) return gate.of === undefined || gate.of === lessonNo
  if (Array.isArray(gate.list)) return gate.list.includes(lessonNo)
  if (Array.isArray(gate.range)) return lessonNo >= gate.range[0] && lessonNo <= gate.range[1]
  return false
}

/** 本 manifest 里是否有块用了讲次门（决定是否必须声明 runtime_store）。 */
export function lessonGatedBlocks(manifest) {
  return (manifest?.blocks ?? []).filter((b) => b.lesson !== null && b.lesson !== undefined)
}

/**
 * 教室声明的讲数上界（`classroom.lessons`）。
 * 🔴 缺省 `null` ＝「教室没有可用的讲数声明」→ **不做上界校验**（不猜、不从块数或文件名反推：
 *    猜＝隐式耦合，正是 P0-4 的教训）。cs-os 声明了 `lessons: 14`（依据 curriculum.md「14 讲」）。
 * @param {object} classroom — manifest.classroom
 * @returns {number|null}
 */
export function lessonsDeclaredBy(classroom) {
  const value = classroom?.lessons
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value) || value < 1) {
    throw new ManifestError(`classroom.lessons 必须是 >=1 的整数（得到 ${JSON.stringify(value)}）`)
  }
  return value
}

/**
 * 讲次门引用到的**最大讲次号**（`of` / `list[*]` / `range[*]`）。
 * @param {{current:true,of?:number}|{list:number[]}|{range:[number,number]}} gate
 * @returns {number}
 */
export function lessonGateUpperBound(gate) {
  if (gate === null || gate === undefined) return 0
  if (Array.isArray(gate.list)) return Math.max(...gate.list)
  if (Array.isArray(gate.range)) return gate.range[1]
  return gate.of ?? 0
}

/**
 * 上界校验（M2 待确认 C12）：讲次门引用的讲次号不得超过教室声明的讲数。
 * 🔴 不校验的后果：`of: 99` 而教室只有 14 讲 → 该块**永不注入且不报错**（"不匹配静默"同类风险）。
 * @param {object} gate — normalizeLessonGate 的产物
 * @param {number|null} maxLesson — lessonsDeclaredBy 的产物；null ＝ 无声明 → 跳过
 * @param {string} where — 报错定位串，如 `blocks[3](story.node.03).lesson`
 */
export function assertLessonGateWithinBounds(gate, maxLesson, where) {
  if (maxLesson === null || gate === null || gate === undefined) return
  const bound = lessonGateUpperBound(gate)
  if (bound > maxLesson) {
    throw new ManifestError(
      `${where} 引用了第 ${bound} 讲，但教室声明的讲数只有 ${maxLesson}（classroom.lessons）——` +
        `这个门永远不会命中，块会静默不注入，故报错（原文 ${JSON.stringify(gate)}）`,
    )
  }
}

/** 是否有任何块用了讲次门。 */
export function usesLessonGate(manifest) {
  return lessonGatedBlocks(manifest).length > 0
}

/**
 * 校验顶层 `runtime_store` 的**声明**（不读盘），返回 { progress, lessonKey }。
 * 🔴 只在**确有块用讲次门**时才要求声明（未用的教室不受影响，兼容既有 fixture）。
 * 与「读值」分开的理由：解析期不该依赖磁盘上的 runtime 状态（`parseManifest` 是无 baseDir
 * 也能跑的纯函数），读值由引擎在装载/每回合调 `readRuntimeLesson`。
 * @param {object} manifest — parseManifest 产出（只读 runtime_store）
 * @returns {{progress:string, lessonKey:string}}
 */
export function validateRuntimeStore(manifest) {
  const store = manifest?.runtime_store
  if (!store || typeof store !== 'object') {
    throw new ManifestError(
      `块用了 lesson 讲次门，但顶层未声明 runtime_store（需要在顶层写：\n` +
        `  runtime_store:\n    dir: runtime/\n    progress: runtime/progress.md\n    lesson_key: ${DEFAULT_LESSON_KEY}\n` +
        `）`,
    )
  }
  if (typeof store.dir !== 'string' || !store.dir) {
    throw new ManifestError(`runtime_store.dir 必填（字符串，如 runtime/）`)
  }
  if (typeof store.progress !== 'string' || !store.progress) {
    throw new ManifestError(`runtime_store.progress 必填（字符串，如 runtime/progress.md）`)
  }
  let lessonKey = DEFAULT_LESSON_KEY
  if (store.lesson_key !== undefined) {
    if (typeof store.lesson_key !== 'string' || !store.lesson_key) {
      throw new ManifestError(`runtime_store.lesson_key 必须是非空字符串（得到 ${JSON.stringify(store.lesson_key)}）`)
    }
    lessonKey = store.lesson_key
  }
  return { progress: store.progress, lessonKey }
}

/**
 * 校验顶层 `runtime_store` 声明，返回解析后的 progress 文件绝对路径与键名。
 * @param {object} manifest — parseManifest 产出
 * @param {{baseDir?: string}} [options]
 * @returns {{file:string, lessonKey:string}}
 */
export function resolveRuntimeLessonSource(manifest, { baseDir } = {}) {
  const { lessonKey } = validateRuntimeStore(manifest)
  const file = resolveProgressFile(manifest, { baseDir }) // 合法性已由 validateRuntimeStore 保证
  return { file, lessonKey }
}

/**
 * 解析 runtime_store 声明的 progress 文件**绝对路径**；未声明 runtime_store → null。
 * 🔴 与 `validateRuntimeStore` 的分工：本函数**不要求 lesson_key**——
 *    相位状态（`current_phase`）也落在同一个文件里，而用了相位持久化的教室
 *    不一定用讲次门（见文件头 ⑤）。
 * @param {object} manifest
 * @param {{baseDir?: string}} [options]
 * @returns {string|null}
 */
export function resolveProgressFile(manifest, { baseDir } = {}) {
  const store = manifest?.runtime_store
  if (!store || typeof store !== 'object') return null
  if (typeof store.progress !== 'string' || !store.progress) {
    throw new ManifestError(`runtime_store.progress 必填（字符串，如 runtime/progress.md）`)
  }
  if (!baseDir) throw new ManifestError(`runtime_store.progress 是相对路径，必须提供 baseDir 才能解析`)
  return isAbsolute(store.progress) ? store.progress : resolve(baseDir, store.progress)
}

/**
 * 读 runtime_store 声明的 progress 文件里的**相位行** `current_phase: <phase_id>`。
 * 🔴 只读不判值域：值域校验由调用方做（值域来自 manifest 顶层 `phases:`，
 *    见 lib/phasestore.mjs 的 setPhase 与 index.mjs 的装载路径）。
 * @param {object} manifest
 * @param {{baseDir?: string}} [options]
 * @returns {{phase: string|null, file: string|null}} 无声明/无该行 → phase=null
 */
export function readRuntimePhase(manifest, { baseDir } = {}) {
  const file = resolveProgressFile(manifest, { baseDir })
  if (file === null) return { phase: null, file: null }
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (cause) {
    throw new ManifestError(
      `读 runtime_store 的 progress 文件失败：${file}（期望其中可有一行 \`${PHASE_STATE_KEY}: <相位 id>\`）：` +
        `${cause?.message ?? cause}`,
    )
  }
  const found = parseStateLine(text, PHASE_STATE_KEY)
  if (found === null) return { phase: null, file }
  return { phase: String(found).trim(), file }
}

/**
 * 纯函数：把 progress 文件全文里的相位行改成 `current_phase: <phaseId>`。
 * 已有该行 → 原地替换（保留行尾注释之外的原样缩进）；没有该行 → 插在
 * 第一处机器可读行区（`current_lesson` 行之后；两者都没有则插在首个非空行之后）。
 * 🔴 不改动任何其它行（教室文件的表格与注释一律原样保留）。
 * @param {string} content
 * @param {string} phaseId
 * @returns {string}
 */
export function renderRuntimePhase(content, phaseId) {
  if (typeof phaseId !== 'string' || !PHASE_ID_PATTERN.test(phaseId)) {
    throw new ManifestError(`相位 id 非法：${JSON.stringify(phaseId)}`)
  }
  const lines = String(content ?? '').split(/\r?\n/)
  const isPhaseLine = (line) => new RegExp(`^\\s*-?\\s*${PHASE_STATE_KEY}\\s*:`).test(line)
  const index = lines.findIndex(isPhaseLine)
  const rendered = `${PHASE_STATE_KEY}: ${phaseId}`
  if (index >= 0) {
    const indent = lines[index].match(/^\s*/)[0]
    lines[index] = `${indent}${rendered}`
    return lines.join('\n')
  }
  const lessonIndex = lines.findIndex((line) => /^\s*-?\s*[A-Za-z_][A-Za-z0-9_]*\s*:/.test(line))
  const at = lessonIndex >= 0 ? lessonIndex + 1 : 0
  lines.splice(at, 0, rendered)
  return lines.join('\n')
}

/**
 * 从 runtime_store 声明的 progress 文件里读**机器可读行** `<lesson_key>: <int>`。
 * 🔴 语义（写死，不许改）：`current_lesson` = **本轮要讲的讲次**，不是"已完成的讲次"。
 * @param {object} manifest
 * @param {{baseDir?: string}} [options]
 * @returns {number} 本轮要讲的讲次（>=1 的整数）
 */
export function readRuntimeLesson(manifest, { baseDir } = {}) {
  const { file, lessonKey } = resolveRuntimeLessonSource(manifest, { baseDir })
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (cause) {
    throw new ManifestError(
      `读 runtime_store 的 progress 文件失败：${file}（期望其中有一行 \`${lessonKey}: <整数>\`）：` +
        `${cause?.message ?? cause}`,
    )
  }
  const found = parseStateLine(text, lessonKey)
  if (found === null) {
    throw new ManifestError(
      `progress 文件里找不到机器可读行 \`${lessonKey}: <整数>\`：${file}\n` +
        `  （引擎按行匹配 \`${lessonKey}: <整数>\`；找不到就不注入任何带讲次门的块——这会静默失效，故报错）`,
    )
  }
  if (!Number.isInteger(found)) {
    throw new ManifestError(
      `progress 文件里的 \`${lessonKey}\` 不是整数：${file}（读到 ${JSON.stringify(found)}；` +
        `期望 \`${lessonKey}: <整数>\`，如 \`${lessonKey}: 1\`）`,
    )
  }
  if (found < 1) {
    throw new ManifestError(
      `progress 文件里的 \`${lessonKey}\` 必须 >=1：${file}（读到 ${found}；第 0 讲＝未开始，不是合法讲次）`,
    )
  }
  return found
}

/**
 * 按行找 `<key>: <值>`，返回解析后的值；找不到返回 null。
 * 容错：行首行尾空白、行内 `# 注释`、YAML 列表前缀 `- `。
 * 值部分**非空但非整数**时返回原始字符串（由调用方报错，不静默当没找到）。
 * 🔴 同时服务 `current_lesson`（整数）与 `current_phase`（相位 id 字符串）——
 *    后者天然不是整数，故"非整数"不能当失败。
 */
function parseStateLine(text, key) {
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*-\s+/, '').replace(/\s*#.*$/, '').trim()
    if (!line) continue
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/)
    if (!m || m[1] !== key) continue
    const value = m[2].trim()
    if (!/^-?\d+$/.test(value)) return value === '' ? null : value
    return Number(value)
  }
  return null
}

// ── M2-SCHEMA：段级切片（section）──────────────────────────────────────────

/**
 * 切出 markdown 某标题下的正文（到下一个**同级或更高级**标题之前为止）。
 * @param {string} text — 文件全文
 * @param {string} section — 标题文本（`## ` 前缀可有可无，比对时去掉）
 * @param {{file?: string}} [options] — file 只用于报错信息
 * @returns {string} 该段正文（已 trim）
 */
export function sliceSection(text, section, { file } = {}) {
  const want = String(section).replace(/^#+\s*/, '').trim()
  if (!want) throw new ManifestError(`section 不能为空字符串（${file ?? '内联文本'}）`)

  const lines = String(text).split(/\r?\n/)
  const headings = [] // { level, title, line }
  lines.forEach((line, i) => {
    const m = line.match(/^(#{1,6})\s+(.*?)\s*$/)
    if (m) headings.push({ level: m[1].length, title: m[2], line: i })
  })

  const hits = headings.filter((h) => h.title === want)
  if (hits.length === 0) {
    const list = headings.length > 0 ? headings.map((h) => `${'#'.repeat(h.level)} ${h.title}`).join('\n  ') : '（该文件里没有任何 markdown 标题）'
    throw new ManifestError(
      `section ${JSON.stringify(section)} 在 ${file ?? '内联文本'} 里不存在。该文件实际存在的标题：\n  ${list}`,
    )
  }
  if (hits.length > 1) {
    throw new ManifestError(
      `section ${JSON.stringify(section)} 在 ${file ?? '内联文本'} 里出现 ${hits.length} 次（第 ${hits
        .map((h) => h.line + 1)
        .join('、')} 行）—— 标题必须唯一，请给该标题改名或改用更具体的标题`,
    )
  }

  const hit = hits[0]
  const rest = headings.filter((h) => h.line > hit.line && h.level <= hit.level)
  const end = rest.length > 0 ? rest[0].line : lines.length
  const body = lines.slice(hit.line + 1, end).join('\n').trim()
  if (!body) {
    throw new ManifestError(
      `section ${JSON.stringify(section)} 在 ${file ?? '内联文本'} 里是空段（第 ${hit.line + 1} 行标题之下没有正文）—— 空段会让该块静默失效，故报错`,
    )
  }
  return body
}

/**
 * 解析顶层 `phases:` 声明。
 * 元素形态同时容忍两种（草案 §2.0 用 `{ id, name }`；裸字符串是更省事的等价写法）：
 *   - `{ id: open, name: 开场 }`
 *   - `open`
 * @param {unknown} raw
 * @returns {{id:string, name?:string}[]} 有序声明列表（顺序即推进顺序）
 */
export function normalizePhases(raw) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new ManifestError('phases 必须是数组（元素为 {id,name} 或裸字符串）')
  const out = []
  const seen = new Set()
  raw.forEach((item, i) => {
    const at = `phases[${i}]`
    let id
    let name
    if (typeof item === 'string') {
      id = item
    } else if (item && typeof item === 'object') {
      id = item.id
      if (item.name !== undefined) {
        if (typeof item.name !== 'string') throw new ManifestError(`${at}.name 必须是字符串`)
        name = item.name
      }
    } else {
      throw new ManifestError(`${at} 必须是 {id,name} 映射或字符串`)
    }
    if (typeof id !== 'string' || !PHASE_ID_PATTERN.test(id)) {
      throw new ManifestError(`${at}.id 必须是非空字符串（得到 ${JSON.stringify(id)}）`)
    }
    if (seen.has(id)) throw new ManifestError(`${at}.id 重复：${id}`)
    seen.add(id)
    out.push(name === undefined ? { id } : { id, name })
  })
  return out
}

/**
 * 求本次装载生效的相位值域（有序 id 数组）。
 * @param {{phases?: {id:string}[]}} manifest
 * @returns {string[]}
 */
export function phaseDomainOf(manifest) {
  const declared = manifest?.phases
  if (Array.isArray(declared) && declared.length > 0) return declared.map((p) => p.id)
  return [...LEGACY_PHASES]
}

/**
 * 求默认相位：显式覆盖（须在值域内）> 声明列表第一个 > legacy 第一个。
 * @param {{phases?: {id:string}[]}} manifest
 * @param {string} [override] — config.defaultPhase
 * @returns {string}
 */
export function defaultPhaseOf(manifest, override) {
  const domain = phaseDomainOf(manifest)
  if (override !== undefined && override !== null && override !== '') {
    if (!domain.includes(override)) {
      throw new ManifestError(`config.defaultPhase=${JSON.stringify(override)} 不在相位值域内（可用：${domain.join('/')}）`)
    }
    return override
  }
  return domain[0]
}

export class ManifestError extends Error {
  constructor(message) {
    super(`classroom.yaml: ${message}`)
    this.name = 'ManifestError'
  }
}

/**
 * 解析并校验 manifest 文本。
 * @param {string} text — classroom.yaml 全文
 * @param {object} [options]
 * @param {string} [options.baseDir] — 解析 path 的基准目录（教室包根）
 * @returns {{format:string, classroom:object, phases:{id:string,name?:string}[], blocks:object[]}} 规范化 manifest
 */
export function parseManifest(text, { baseDir } = {}) {
  let doc
  try {
    doc = parseYaml(text)
  } catch (cause) {
    throw new ManifestError(`YAML 语法错误：${cause?.message ?? cause}`)
  }
  if (!doc || typeof doc !== 'object') throw new ManifestError('根节点必须是映射')
  if (doc.format !== MANIFEST_FORMAT) {
    throw new ManifestError(`format 必须是 ${MANIFEST_FORMAT}（得到 ${JSON.stringify(doc.format)}）`)
  }
  const classroom = doc.classroom
  if (!classroom || typeof classroom !== 'object' || typeof classroom.id !== 'string' || !classroom.id) {
    throw new ManifestError('classroom.id 必填')
  }
  if (!Array.isArray(doc.blocks) || doc.blocks.length === 0) {
    throw new ManifestError('blocks 必须是非空数组')
  }

  const seen = new Set()
  const blocks = doc.blocks.map((raw, i) => normalizeBlock(raw, i, { baseDir, seen }))

  // 顶层相位声明（草案 §2.0；顺序即推进顺序）
  const phases = normalizePhases(doc.phases)

  // 🔴 P0-1 校验点：块里用到的 phase id 必须落在值域内，否则**报错**。
  // 值域 = 顶层 phases 声明；未声明则回退到 legacy 显式枚举（见文件头注释）。
  const domain = phaseDomainOf({ phases })
  for (const block of blocks) {
    for (const key of ['phases', 'except']) {
      for (const id of block.phase?.[key] ?? []) {
        if (!domain.includes(id)) {
          throw new ManifestError(
            `blocks[${block.id}].phase.${key} 的相位 ${JSON.stringify(id)} 不在值域内（可用：${domain.join('/')}）` +
              (phases.length === 0 ? '；本文件未声明顶层 phases，值域取引擎 legacy 枚举' : ''),
          )
        }
      }
    }
  }

  // 🔴 M2-SCHEMA 校验点（P0-4 的教训：不匹配不得静默）：
  // 只要有块用了 lesson 讲次门，顶层 runtime_store 必须声明齐全（dir/progress/lesson_key）。
  // 没写讲次门的教室**完全不受影响**（既有 fixture 行为不变）。
  // 注意：此处只校验**声明**，不读盘——progress 文件的值由引擎调 readRuntimeLesson 读
  // （装载时一次 + 每回合一次），这样 parseManifest 不需要 baseDir 也能跑。
  const manifest = { format: doc.format, classroom, phases, blocks, runtime_store: doc.runtime_store }
  if (usesLessonGate(manifest)) validateRuntimeStore(manifest)

  // 🔴 M3-STATE 校验点（M2 待确认 C12）：讲次门引用的讲次号不得超过教室声明的讲数。
  //    `classroom.lessons` 未声明 → 无可靠上界 → 跳过（见 lessonsDeclaredBy 的注释）。
  const maxLesson = lessonsDeclaredBy(classroom)
  if (maxLesson !== null) {
    for (const block of lessonGatedBlocks(manifest)) {
      assertLessonGateWithinBounds(block.lesson, maxLesson, `blocks[${block.id}].lesson`)
    }
  }

  return manifest
}

function normalizeBlock(raw, i, { baseDir, seen }) {
  const at = `blocks[${i}]`
  if (!raw || typeof raw !== 'object') throw new ManifestError(`${at} 必须是映射`)
  const id = raw.id
  if (typeof id !== 'string' || !id) throw new ManifestError(`${at}.id 必填`)
  if (seen.has(id)) throw new ManifestError(`${at}.id 重复：${id}`)
  seen.add(id)

  const layer = raw.layer ?? 'context'
  if (!LAYERS.includes(layer)) throw new ManifestError(`${at}(${id}).layer 必须是 ${LAYERS.join('/')}`)

  // 内容：path 或 text 二选一
  let text = ''
  if (typeof raw.text === 'string') {
    if (raw.path !== undefined) {
      throw new ManifestError(`${at}(${id}) path 与 text 二选一（同时写了 path=${JSON.stringify(raw.path)} 与内联 text）`)
    }
    if (raw.section !== undefined) {
      throw new ManifestError(`${at}(${id}) section 只对 path 有效（内联 text 无法切片）`)
    }
    text = raw.text
  } else if (typeof raw.path === 'string') {
    if (!baseDir) throw new ManifestError(`${at}(${id}) 用 path 时必须提供 baseDir`)
    let raw_text
    try {
      raw_text = readFileSync(resolve(baseDir, raw.path), 'utf8')
    } catch (cause) {
      throw new ManifestError(`${at}(${id}) 读 ${raw.path} 失败：${cause?.message ?? cause}`)
    }
    if (raw.section !== undefined) {
      if (typeof raw.section !== 'string') {
        throw new ManifestError(`${at}(${id}).section 必须是字符串（得到 ${JSON.stringify(raw.section)}）`)
      }
      text = sliceSection(raw_text, raw.section, { file: raw.path })
    } else {
      text = raw_text
    }
  } else {
    throw new ManifestError(`${at}(${id}) 需要 path 或 text`)
  }

  // position（M1：target=system 用 order；target=chat 用 depth，depth 只对 chat 有效）
  const pos = raw.position
  if (!pos || typeof pos !== 'object' || !POSITION_TARGETS.includes(pos.target)) {
    throw new ManifestError(`${at}(${id}).position.target 必须是 system/chat`)
  }
  const position = { target: pos.target }
  if (pos.target === 'system') {
    if (typeof pos.order !== 'number' || !Number.isFinite(pos.order)) {
      throw new ManifestError(`${at}(${id}) target=system 需要 position.order（有限数字）`)
    }
    position.order = pos.order
    if (pos.depth !== undefined) throw new ManifestError(`${at}(${id}) depth 只对 target=chat 有效`)
  } else {
    const depth = pos.depth ?? 0
    if (!Number.isInteger(depth) || depth < 0) throw new ManifestError(`${at}(${id}) depth 必须是非负整数`)
    position.depth = depth
  }

  // frequency
  const freq = raw.frequency
  if (!freq || !FREQUENCY_MODES.includes(freq.every)) {
    throw new ManifestError(`${at}(${id}).frequency.every 必须是 ${FREQUENCY_MODES.join('/')}`)
  }
  const frequency = { every: freq.every }
  if (freq.every === 'n_turns') {
    if (!Number.isInteger(freq.n) || freq.n < 1) throw new ManifestError(`${at}(${id}) n_turns 需要 n>=1`)
    frequency.n = freq.n
  }
  // anchor（M3-STATE；草案 §2.2）：只在 every=once 时有意义 → 别处写了就是错，不静默忽略
  if (freq.anchor !== undefined && freq.anchor !== null) {
    if (freq.every !== 'once') {
      throw new ManifestError(
        `${at}(${id}).frequency.anchor 只与 every: once 连用（得到 every=${JSON.stringify(freq.every)}，` +
          `anchor=${JSON.stringify(freq.anchor)}）——anchor 描述的是「once 以什么为界」，别的 every 没有这个界`,
      )
    }
    if (!FREQUENCY_ANCHORS.includes(freq.anchor)) {
      throw new ManifestError(
        `${at}(${id}).frequency.anchor 必须是 ${FREQUENCY_ANCHORS.join('/')}（得到 ${JSON.stringify(freq.anchor)}）`,
      )
    }
    frequency.anchor = freq.anchor
  }

  // phase 门（骨架子集：phases/except）
  let phase = null
  if (raw.phase && typeof raw.phase === 'object') {
    // 🔴 M3-STATE：`advance_on`（草案 §2.3）**已裁定不做** —— 相位推进由教师在课堂上用
    //    `classroom_set_phase` 工具宣布，引擎不按规则推进。写了它＝永远不会生效 →
    //    必须报错（本项目已被"静默不生效"坑过两次）。
    if (raw.phase.advance_on !== undefined) {
      throw new ManifestError(
        `${at}(${id}).phase.advance_on 已不再支持（2026-09-24 起）：相位推进改由教师在课堂上` +
          `调用 classroom_set_phase 工具宣布，引擎只记录、不按规则推进。` +
          `请删掉这一行（原文 ${JSON.stringify(raw.phase.advance_on)}），否则它会静默不生效`,
      )
    }
    phase = {}
    if (Array.isArray(raw.phase.phases) && raw.phase.phases.length > 0) phase.phases = [...raw.phase.phases]
    if (Array.isArray(raw.phase.except)) phase.except = [...raw.phase.except]
  }

  // lesson 讲次门（M2-SCHEMA v0.2，P0-4）：没写 = null（照旧注入，兼容既有 fixture）
  const lesson = raw.lesson === undefined || raw.lesson === null ? null : normalizeLessonGate(raw.lesson, at, id)

  // wrap（骨架子集：只支持 none/system-reminder；role 一律 user——宿主 serialize 拒 developer，L1 已核）
  const wrapStyle = raw.wrap?.style ?? 'system-reminder'
  if (!WRAP_STYLES.includes(wrapStyle)) throw new ManifestError(`${at}(${id}).wrap.style 必须是 ${WRAP_STYLES.join('/')}`)
  const wrap = { style: wrapStyle, role: 'user', tag: raw.wrap?.tag ?? 'system-reminder' }

  // render（骨架：enabled + 简单 {{var}} 替换标记；缺省变量先不报错——B2 待拍板）
  const render = { enabled: raw.render?.enabled ?? false, vars: raw.render?.vars ?? {} }

  return { id, layer, text, position, frequency, phase, lesson, wrap, render, source: raw.path ?? null }
}

/** 便捷入口：从教室包目录加载。 */
export function loadManifest(classroomDir) {
  const file = join(classroomDir, MANIFEST_FILENAME)
  return parseManifest(readFileSync(file, 'utf8'), { baseDir: classroomDir })
}
