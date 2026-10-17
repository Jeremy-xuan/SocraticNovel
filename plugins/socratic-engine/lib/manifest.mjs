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
//
// ── T8A 新增：多角色同台的**数据层**（`cast:` / `cue:`）─────────────────────
// 依据：研究_9_多角色同台机制_2026-09-24.md §10（schema）＋ 排产计划_技术线 §八 C2
//       （「角色表放顶层 cast:/cue:，**并加进解析白名单**（避免"写错静默失效"）」）。
// 🔴 本批**只做数据层**：能声明 ＋ 能校验 ＋ 能被解析。**不做行为**（谁出场、说什么台词
//    是下一批；顺序硬规定：先跑一讲"没有同学"的真实课把错题数据攒出来）。
// 🔴 向后兼容：不写 `cast:`／`cue:` 的教室，manifest 对象**形状逐字不变**（下面只在
//    段存在时才挂键）。老教室零改动、行为不变。
// 🔴 硬约束：`cast` 只声明老师时，引擎行为必须与现在**完全一致** —— 判定入口是本文件
//    导出的纯函数 `peerRolesOf()`（返回空数组 ⇒ 没有同学在场 ⇒ 下一批的 cue 裁决必须
//    直接短路）。这是"先跑没有同学的课"那条顺序在**代码层**的保障。
// 🔴 行号：本段起，`cast`／`cue` 的报错一律带 `（第 N 行）`＋期望值（作者能自己改）。
//    行号来源 = `parseDocument` 的节点 `range` 偏移 → 行号索引（见 makeLocator）。

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { parseDocument } from 'yaml'
import { normalizePrep } from './prep.mjs'

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

// ── T8A：`cast:` / `cue:` 的值域与常量（多角色同台的数据层）─────────────────

/**
 * `cast.roles[].role` 值域。
 * - `teacher` 老师（本教室＝`characters/komari.md`）——**不参与认知风格匹配**
 * - `buddy`   固定搭子（约束⑤：记得你上次错在哪）
 * - `guest`   每讲客串（约束⑤：每讲 1 位）
 * 🔴 只有 `buddy`／`guest` 算「同学」——`peerRolesOf()` 就是按这条判的。
 */
export const CAST_ROLE_KINDS = ['teacher', 'buddy', 'guest']

/**
 * `cast.roles[].style` 值域＝四种认知风格（研究 §0.3 约束⑤：
 * "玩法多样"来源＝**认知风格差异 × 知识点错法**，故匹配必须是**查表**、不是算分）。
 * 🔴 闭合值域：写错即报错（不静默降级成"没有风格"）。
 */
export const CAST_STYLES = ['intuitive', 'precise', 'stubborn', 'counterexample']

/**
 * `cue.triggers[].when` 值域＝三条出场路（研究 §6.4 门 4）。
 * - `stall`                        路 A · 僵局（最高优先，需同段 `cue.stall` 判据参数）
 * - `student-hit-known-wrong-step` 路 B · 错法命中（需 `source` 指向错法库文件）
 * - `teacher-invite`               路 C · 老师用工具显式邀请
 * 🔴 数组顺序**即优先级**（与顶层 `phases:` 的"顺序即推进顺序"同一约定）。
 */
export const CUE_TRIGGER_WHENS = ['stall', 'student-hit-known-wrong-step', 'teacher-invite']

/** 需要（且只允许）写 `source` 的 `when` 取值。 */
export const CUE_SOURCE_WHENS = ['student-hit-known-wrong-step']

/** `cast` 段允许出现的键（白名单：多写一个键＝报错，不静默忽略）。 */
const CAST_KEYS = ['policy', 'roles']

/** `cast.policy` 段允许出现的键。 */
const CAST_POLICY_KEYS = ['lessonQuota', 'minTurnGap', 'allowedPhases']

/** `cast.roles[]` 允许出现的键。 */
const CAST_ROLE_KEYS = ['id', 'file', 'name', 'role', 'enabled', 'style', 'styleLabel']

/** `cue` 段允许出现的键。 */
const CUE_KEYS = ['stall', 'triggers']

/** `cue.triggers[]` 允许出现的键。 */
const CUE_TRIGGER_KEYS = ['when', 'roles', 'source']

/** `cue.stall` 段允许出现的键。 */
const CUE_STALL_KEYS = [
  'nTurns',
  'shortWindow',
  'shortRatio',
  'shortFloor',
  'dontKnowPatterns',
  'dontKnowExempt',
]

// ── ANIM-ORCH：教学动画开关（顶层 `animation:` 段）────────────────────────────
// 🔴 语义（写死）：**教室声明"我这一课要不要放教学动画"**，引擎只实现机制。
//    · 段**缺席** → manifest 里**根本不挂** `animation` 键 → 引擎不注册动画工具、
//      不注册动画纪律段、不做任何动画相关注入 → **老教室行为逐字不变**（本批的兼容红线）。
//    · 段在场且 `enabled` 不为 false → 引擎挂上动画工具与纪律段。
//    🔴 渲染器路径（python/manim/闸门）**不在教室里写**——那是部署事实，不是课程内容；
//      由 profile 的 config / 环境变量给（见 index.mjs 的 animation 配置块）。
const ANIMATION_KEYS = ['enabled']

/**
 * 规范化顶层 `animation:` 段。**纯函数**。
 * @param {unknown} raw
 * @param {{loc:(path:(string|number)[])=>number}} ctx
 * @returns {{enabled:boolean}}
 */
export function normalizeAnimation(raw, { loc } = {}) {
  if (!isPlainMap(raw)) {
    throw new ManifestError(
      `${whereAt(['animation'], loc)}必须是映射（写成 animation: {enabled: true}；` +
        '不安排教学动画就整段删掉——段在就意味着这个教室要用动画）',
    )
  }
  assertKnownKeys(raw, ANIMATION_KEYS, ['animation'], loc)
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    throw new ManifestError(
      `${whereAt(['animation', 'enabled'], loc)}必须是布尔值（得到 ${JSON.stringify(raw.enabled)}）`,
    )
  }
  return { enabled: raw.enabled !== false }
}

// ── T8A：报错定位（行号）────────────────────────────────────────────────────
// 🔴 为什么要行号：本项目的报错标准是"作者能照着改"（见 classroom.yaml 既有风格：
//    相位值域报错会列出可用值）。段一多，光有 `cast.roles[1].id` 还得自己数行。
// 实现：`parseDocument` 的每个节点带 `range = [start, valueEnd, nodeEnd]`（字符偏移），
//    先把全文的换行偏移做成索引，再二分求行号；键不存在时退到最近的**已存在祖先**节点
//    （缺失键指向它所在的映射，这才是作者该看的那一行）。

/** 把 `['cast','roles',0,'id']` 渲染成 `cast.roles[0].id`（与既有 `blocks[0](a)` 同风格）。 */
function pathString(path) {
  let out = ''
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`
    else out += out === '' ? String(seg) : `.${seg}`
  }
  return out
}

/**
 * 造一个「YAML 路径 → 行号」的查询函数（1-based）。
 * 找不到该路径时**逐级回退到祖先**；连根都找不到则回 1（不抛错——定位失败不该盖住真错误）。
 * @param {import('yaml').Document} doc — parseDocument 的产物（**不是** toJS 的结果）
 * @param {string} text — 原文（用于建换行偏移索引）
 * @returns {(path:(string|number)[]) => number}
 */
function makeLocator(doc, text) {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  const lineOfOffset = (offset) => {
    if (!Number.isInteger(offset) || offset < 0) return 1
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
  return (path) => {
    for (let end = path.length; end >= 0; end -= 1) {
      const node = doc.getIn(path.slice(0, end), true)
      if (node !== undefined && node !== null && Array.isArray(node.range)) {
        return lineOfOffset(node.range[0])
      }
    }
    return 1
  }
}

/** `cast`／`cue` 段内所有报错的统一前缀：路径 ＋ 行号。 */
function whereAt(path, loc) {
  return `${pathString(path)}（第 ${loc(path)} 行）`
}

/** 该键是否被写过（`undefined` 与 `null` 都算没写——YAML 的 `key:` 空值解析成 null）。 */
function isAbsent(value) {
  return value === undefined || value === null
}

function isPlainMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

/**
 * 白名单校验：出现未声明的键 → 报错（🔴 C2 的落点：避免"写错静默失效"）。
 * @param {object} raw — 待校验的映射
 * @param {string[]} allowed — 允许的键
 * @param {(string|number)[]} path — 该映射在 YAML 里的路径（用于行号与文案）
 * @param {(path:(string|number)[])=>number} loc
 */
function assertKnownKeys(raw, allowed, path, loc) {
  const stray = Object.keys(raw).filter((k) => !allowed.includes(k))
  if (stray.length === 0) return
  throw new ManifestError(
    `${whereAt(path, loc)}有无法识别的键 ${JSON.stringify(stray)}（可用：${allowed.join('/')}）——` +
      `未实现的键一律报错，不静默忽略（写错的声明若被放过，就成了"配了不生效"）`,
  )
}

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

// ── T8A：`cast:` / `cue:` 的解析与校验 ─────────────────────────────────────

/**
 * 本教室**在场且启用**的同学角色（`role` 不是 `teacher` 且 `enabled === true`）。
 *
 * 🔴 这是任务书那条硬约束在代码层的落点：**返回空数组 ⇒ 引擎行为必须与今天完全一致**。
 *    下一批的 cue 裁决入口第一句就该是
 *      `if (peerRolesOf(manifest).length === 0) return null`
 *    （不注入、不读错法库、不写 cue_log）——这就是「先跑一讲**没有同学**的真实课」这条
 *    顺序在代码里的保障。
 * 未声明 `cast:` 的教室同样返回 `[]`（向后兼容：老教室零改动）。
 * @param {{cast?:{roles:{role:string, enabled:boolean}[]}}} manifest — parseManifest 产出
 * @returns {{id:string, role:string}[]}
 */
export function peerRolesOf(manifest) {
  const roles = manifest?.cast?.roles
  if (!Array.isArray(roles)) return []
  return roles.filter((r) => r.role !== 'teacher' && r.enabled === true)
}

/**
 * 规范化并校验顶层 `cast:` 段（角色表）。
 * 段内 schema 与逐字段依据见实现报告_T8a §1；本函数只做**解析＋校验**，不做行为。
 * @param {unknown} raw — doc.cast
 * @param {object} options
 * @param {(path:(string|number)[])=>number} options.loc
 * @param {string} [options.baseDir] — 有它才校验 `file` 的存在性
 * @param {string[]} options.phaseDomain — 相位值域（校验 allowedPhases）
 * @returns {{policy?:object, roles:object[]}} — 无 policy 时不挂该键
 */
export function normalizeCast(raw, { loc, baseDir, phaseDomain }) {
  const root = ['cast']
  if (!isPlainMap(raw)) {
    throw new ManifestError(`${whereAt(root, loc)}必须是映射（形如：cast: { roles: [...] }）`)
  }
  assertKnownKeys(raw, CAST_KEYS, root, loc)
  if (!Array.isArray(raw.roles) || raw.roles.length === 0) {
    throw new ManifestError(
      `${whereAt([...root, 'roles'], loc)}必须是非空数组（每位在场角色一项，老师也要声明；` +
        `一位都不声明就别写 cast: 段）`,
    )
  }

  const index = new Map()
  const roles = raw.roles.map((item, i) => normalizeCastRole(item, i, { loc, baseDir, root, index }))

  const teacherIndexes = roles.map((r, i) => (r.role === 'teacher' ? i : -1)).filter((i) => i >= 0)
  if (teacherIndexes.length > 1) {
    // 指向**第二位** teacher 的 role 行（作者要改的是它，不是列表开头）
    const second = teacherIndexes[1]
    throw new ManifestError(
      `${whereAt([...root, 'roles', second, 'role'], loc)}是本教室第 ${teacherIndexes.length} 位 teacher` +
        `（${teacherIndexes.map((i) => roles[i].id).join('/')}）—— 本教室只有一位老师，role: teacher 至多一项`,
    )
  }

  const peers = roles.filter((r) => r.role !== 'teacher')
  const enabledPeers = peers.filter((r) => r.enabled)
  if (isAbsent(raw.policy)) {
    if (enabledPeers.length > 0) {
      throw new ManifestError(
        `${whereAt([...root, 'policy'], loc)}必填：本教室声明了 ${enabledPeers.length} 位启用中的同学` +
          `（${enabledPeers.map((r) => r.id).join('/')}），而"每讲几次、开场保护几回合、哪些相位可以出场"` +
          `三项是**教室级**规则，必须显式声明（引擎不内置默认值——免得调不了）`,
      )
    }
    return { roles }
  }
  const policy = normalizeCastPolicy(raw.policy, { loc, root, phaseDomain })
  return { policy, roles }
}

/** 规范化并校验 `cast.policy`（教室级出场规则；字段全必填，无引擎默认值）。 */
export function normalizeCastPolicy(raw, { loc, root, phaseDomain }) {
  const p = [...root, 'policy']
  if (!isPlainMap(raw)) {
    throw new ManifestError(`${whereAt(p, loc)}必须是映射（lessonQuota / minTurnGap / allowedPhases）`)
  }
  assertKnownKeys(raw, CAST_POLICY_KEYS, p, loc)

  const quotaAt = [...p, 'lessonQuota']
  if (!Number.isInteger(raw.lessonQuota) || raw.lessonQuota < 1) {
    throw new ManifestError(
      `${whereAt(quotaAt, loc)}必须是 >=1 的整数（得到 ${JSON.stringify(raw.lessonQuota)}）` +
        `—— 这是"每讲最多出场几次"，用户口径 3–5 次（约束④：发言是稀疏事件）`,
    )
  }
  const gapAt = [...p, 'minTurnGap']
  if (!Number.isInteger(raw.minTurnGap) || raw.minTurnGap < 0) {
    throw new ManifestError(
      `${whereAt(gapAt, loc)}必须是 >=0 的整数（得到 ${JSON.stringify(raw.minTurnGap)}）` +
        `—— 这是开场保护：前几回合不出场（0＝不保护）`,
    )
  }
  const phasesAt = [...p, 'allowedPhases']
  if (!Array.isArray(raw.allowedPhases) || raw.allowedPhases.length === 0) {
    throw new ManifestError(
      `${whereAt(phasesAt, loc)}必须是非空数组（得到 ${JSON.stringify(raw.allowedPhases)}）` +
        `—— 列"同学可以出场的相位"；一个都不列就别写 cast: 段`,
    )
  }
  const seen = new Set()
  raw.allowedPhases.forEach((id, i) => {
    const at = [...phasesAt, i]
    if (!isNonEmptyString(id)) {
      throw new ManifestError(`${whereAt(at, loc)}必须是非空字符串（得到 ${JSON.stringify(id)}）`)
    }
    if (seen.has(id)) {
      throw new ManifestError(`${whereAt(at, loc)}重复：${JSON.stringify(id)}`)
    }
    seen.add(id)
    if (!phaseDomain.includes(id)) {
      throw new ManifestError(
        `${whereAt(at, loc)}的相位 ${JSON.stringify(id)} 不在值域内（可用：${phaseDomain.join('/')}）` +
          `—— 不在值域内的相位永远不会命中，等于白写`,
      )
    }
  })

  return { lessonQuota: raw.lessonQuota, minTurnGap: raw.minTurnGap, allowedPhases: [...raw.allowedPhases] }
}

/** 规范化并校验 `cast.roles[i]`（一位在场角色）。 */
function normalizeCastRole(raw, i, { loc, baseDir, root, index }) {
  const p = [...root, 'roles', i]
  if (!isPlainMap(raw)) throw new ManifestError(`${whereAt(p, loc)}必须是映射`)
  assertKnownKeys(raw, CAST_ROLE_KEYS, p, loc)

  const idAt = [...p, 'id']
  if (!isNonEmptyString(raw.id)) {
    throw new ManifestError(`${whereAt(idAt, loc)}必须是非空字符串（得到 ${JSON.stringify(raw.id)}）`)
  }
  if (index.has(raw.id)) {
    throw new ManifestError(
      `${whereAt(idAt, loc)}重复：${JSON.stringify(raw.id)}（已在 cast.roles[${index.get(raw.id)}] 声明）` +
        `—— id 是引用键（cue.triggers[].roles 要引用它），必须唯一`,
    )
  }
  index.set(raw.id, i)

  const fileAt = [...p, 'file']
  if (!isNonEmptyString(raw.file)) {
    throw new ManifestError(
      `${whereAt(fileAt, loc)}必须是非空字符串（得到 ${JSON.stringify(raw.file)}）` +
        `—— 指向该角色的人格文件（格式照 characters/komari.md）`,
    )
  }
  if (baseDir !== undefined && !existsSync(resolve(baseDir, raw.file))) {
    throw new ManifestError(
      `${whereAt(fileAt, loc)}指向的人格文件不存在：${raw.file}（相对教室根 ${baseDir} 解析）`,
    )
  }

  const nameAt = [...p, 'name']
  if (!isNonEmptyString(raw.name)) {
    throw new ManifestError(
      `${whereAt(nameAt, loc)}必须是非空字符串（得到 ${JSON.stringify(raw.name)}）—— 这是名牌上显示的名字`,
    )
  }

  const roleAt = [...p, 'role']
  if (!CAST_ROLE_KINDS.includes(raw.role)) {
    throw new ManifestError(
      `${whereAt(roleAt, loc)}必须是 ${CAST_ROLE_KINDS.join('/')} 之一（得到 ${JSON.stringify(raw.role)}）` +
        `—— teacher 是老师；buddy 是固定搭子；guest 是每讲客串`,
    )
  }

  const enabledAt = [...p, 'enabled']
  if (typeof raw.enabled !== 'boolean') {
    throw new ManifestError(
      `${whereAt(enabledAt, loc)}必须是布尔值 true/false（得到 ${JSON.stringify(raw.enabled)}）` +
        `—— 这是本讲的开关（默认关闭的角色就写 false，而不是把它删掉）`,
    )
  }

  const isTeacher = raw.role === 'teacher'
  const styleAt = [...p, 'style']
  const labelAt = [...p, 'styleLabel']
  if (isTeacher) {
    for (const at of [styleAt, labelAt]) {
      if (!isAbsent(raw[at[at.length - 1]])) {
        throw new ManifestError(
          `${whereAt(at, loc)}不该出现：老师不参与认知风格匹配（约束⑤的匹配只发生在同学身上）`,
        )
      }
    }
  } else {
    if (!CAST_STYLES.includes(raw.style)) {
      throw new ManifestError(
        `${whereAt(styleAt, loc)}必须是 ${CAST_STYLES.join('/')} 之一（得到 ${JSON.stringify(raw.style)}）` +
          `—— 选人按"认知风格 × 错法"查表（约束⑤），写错值会让这位角色永远选不上`,
      )
    }
    if (!isNonEmptyString(raw.styleLabel)) {
      throw new ManifestError(
        `${whereAt(labelAt, loc)}必须是非空字符串（得到 ${JSON.stringify(raw.styleLabel)}）` +
          `—— 这是台词里给学生看的中文风格标签（如"精确型"）；机器键 style 不能直接给学生看`,
      )
    }
  }

  const out = { id: raw.id, file: raw.file, name: raw.name, role: raw.role, enabled: raw.enabled }
  if (!isTeacher) {
    out.style = raw.style
    out.styleLabel = raw.styleLabel
  }
  return out
}

/**
 * 规范化并校验顶层 `cue:` 段（出场提示）。
 * @param {unknown} raw — doc.cue
 * @param {object} options
 * @param {(path:(string|number)[])=>number} options.loc
 * @param {string} [options.baseDir] — 有它才校验 `source` 的存在性
 * @param {string[]} options.roleIds — `cast.roles[].id`（校验引用）
 * @returns {{stall?:object, triggers:object[]}} — 无 stall 时不挂该键
 */
export function normalizeCue(raw, { loc, baseDir, roleIds }) {
  const root = ['cue']
  if (!isPlainMap(raw)) throw new ManifestError(`${whereAt(root, loc)}必须是映射（stall / triggers）`)
  assertKnownKeys(raw, CUE_KEYS, root, loc)

  const triggersAt = [...root, 'triggers']
  if (!Array.isArray(raw.triggers)) {
    throw new ManifestError(
      `${whereAt(triggersAt, loc)}必须是数组（得到 ${JSON.stringify(raw.triggers)}）—— ` +
        `写空数组 [] ＝本教室**不安排同学出场**（"先跑一讲没有同学的真实课"就用它）`,
    )
  }
  const whens = new Set()
  const triggers = raw.triggers.map((item, i) =>
    normalizeCueTrigger(item, i, { loc, baseDir, root, roleIds, whens }),
  )

  const needsStall = triggers.some((t) => t.when === 'stall')
  if (needsStall && isAbsent(raw.stall)) {
    throw new ManifestError(
      `${whereAt([...root, 'stall'], loc)}必填：triggers 里有 when: stall（僵局路），` +
        `但本段没有声明判据参数（nTurns / shortWindow / shortRatio / shortFloor / dontKnowPatterns / dontKnowExempt）`,
    )
  }
  if (!needsStall && !isAbsent(raw.stall)) {
    throw new ManifestError(
      `${whereAt([...root, 'stall'], loc)}不该出现：triggers 里没有 when: stall，` +
        `这段判据参数永远不会被读到（要开僵局路就加一条 when: stall 的 trigger）`,
    )
  }
  if (!needsStall) return { triggers }
  return { stall: normalizeStall(raw.stall, { loc, root }), triggers }
}

/** 规范化并校验 `cue.triggers[i]`（一条出场路）。 */
function normalizeCueTrigger(raw, i, { loc, baseDir, root, roleIds, whens }) {
  const p = [...root, 'triggers', i]
  if (!isPlainMap(raw)) throw new ManifestError(`${whereAt(p, loc)}必须是映射`)
  assertKnownKeys(raw, CUE_TRIGGER_KEYS, p, loc)

  const whenAt = [...p, 'when']
  if (!CUE_TRIGGER_WHENS.includes(raw.when)) {
    throw new ManifestError(
      `${whereAt(whenAt, loc)}必须是 ${CUE_TRIGGER_WHENS.join('/')} 之一（得到 ${JSON.stringify(raw.when)}）`,
    )
  }
  if (whens.has(raw.when)) {
    throw new ManifestError(
      `${whereAt(whenAt, loc)}重复：${raw.when}——同一个出场路只准声明一次` +
        `（数组顺序即优先级；想调优先级就调顺序）`,
    )
  }
  whens.add(raw.when)

  const out = { when: raw.when }

  const rolesAt = [...p, 'roles']
  if (!isAbsent(raw.roles)) {
    if (!Array.isArray(raw.roles) || raw.roles.length === 0) {
      throw new ManifestError(
        `${whereAt(rolesAt, loc)}必须是非空数组（得到 ${JSON.stringify(raw.roles)}）—— 不限制就整个键都不写`,
      )
    }
    const seen = new Set()
    out.roles = raw.roles.map((rid, j) => {
      const at = [...rolesAt, j]
      if (!isNonEmptyString(rid)) {
        throw new ManifestError(`${whereAt(at, loc)}必须是非空字符串（得到 ${JSON.stringify(rid)}）`)
      }
      if (!roleIds.includes(rid)) {
        throw new ManifestError(
          `${whereAt(at, loc)}引用了不存在的角色 ${JSON.stringify(rid)}（cast.roles 里可用：${roleIds.join('/')}）`,
        )
      }
      if (seen.has(rid)) throw new ManifestError(`${whereAt(at, loc)}重复：${JSON.stringify(rid)}`)
      seen.add(rid)
      return rid
    })
  }

  const sourceAt = [...p, 'source']
  const needsSource = CUE_SOURCE_WHENS.includes(raw.when)
  if (needsSource && !isNonEmptyString(raw.source)) {
    throw new ManifestError(
      `${whereAt(sourceAt, loc)}必填（非空字符串）：when: ${raw.when} 要从错法库里取错法，` +
        `必须写明来源文件（如 runtime/wrong_step_library.md）—— 错法不许模型即兴编（约束③）`,
    )
  }
  if (!needsSource && !isAbsent(raw.source)) {
    throw new ManifestError(
      `${whereAt(sourceAt, loc)}不该出现：when: ${raw.when} 不读错法库（只有 ${CUE_SOURCE_WHENS.join('/')} 需要 source）`,
    )
  }
  if (needsSource) {
    if (baseDir !== undefined && !existsSync(resolve(baseDir, raw.source))) {
      throw new ManifestError(
        `${whereAt(sourceAt, loc)}指向的错法库文件不存在：${raw.source}（相对教室根 ${baseDir} 解析）`,
      )
    }
    out.source = raw.source
  }
  return out
}

/** 规范化并校验 `cue.stall`（僵局判据参数；字段全必填，无引擎默认值）。 */
export function normalizeStall(raw, { loc, root }) {
  const p = [...root, 'stall']
  if (!isPlainMap(raw)) throw new ManifestError(`${whereAt(p, loc)}必须是映射`)
  assertKnownKeys(raw, CUE_STALL_KEYS, p, loc)

  const intAtLeast = (key, min) => {
    const at = [...p, key]
    const v = raw[key]
    if (!Number.isInteger(v) || v < min) {
      throw new ManifestError(`${whereAt(at, loc)}必须是 >=${min} 的整数（得到 ${JSON.stringify(v)}）`)
    }
    return v
  }
  const nTurns = intAtLeast('nTurns', 1)
  const shortWindow = intAtLeast('shortWindow', 1)
  const shortFloor = intAtLeast('shortFloor', 0)

  const ratioAt = [...p, 'shortRatio']
  if (typeof raw.shortRatio !== 'number' || !(raw.shortRatio > 0 && raw.shortRatio <= 1)) {
    throw new ManifestError(
      `${whereAt(ratioAt, loc)}必须是 (0,1] 的数（得到 ${JSON.stringify(raw.shortRatio)}）—— 学生消息长度降到中位数的这个比例以下才算"变短"`,
    )
  }

  const dkAt = [...p, 'dontKnowPatterns']
  if (!isPlainMap(raw.dontKnowPatterns)) {
    throw new ManifestError(`${whereAt(dkAt, loc)}必须是映射 { high: [...], mid: [...] }`)
  }
  assertKnownKeys(raw.dontKnowPatterns, ['high', 'mid'], dkAt, loc)

  const stringList = (value, at, minLength) => {
    if (!Array.isArray(value)) {
      throw new ManifestError(`${whereAt(at, loc)}必须是字符串数组（得到 ${JSON.stringify(value)}）`)
    }
    if (value.length < minLength) {
      throw new ManifestError(`${whereAt(at, loc)}至少要 ${minLength} 项（得到 ${value.length} 项）`)
    }
    value.forEach((s, j) => {
      if (!isNonEmptyString(s)) {
        throw new ManifestError(`${whereAt([...at, j], loc)}必须是非空字符串（得到 ${JSON.stringify(s)}）`)
      }
    })
    return [...value]
  }

  const high = stringList(raw.dontKnowPatterns.high, [...dkAt, 'high'], 1)
  const mid = stringList(raw.dontKnowPatterns.mid, [...dkAt, 'mid'], 0)
  const exempt = stringList(raw.dontKnowExempt, [...p, 'dontKnowExempt'], 0)

  return {
    nTurns,
    shortWindow,
    shortRatio: raw.shortRatio,
    shortFloor,
    dontKnowPatterns: { high, mid },
    dontKnowExempt: exempt,
  }
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
 * @returns {{format:string, classroom:object, phases:{id:string,name?:string}[], blocks:object[],
 *   runtime_store?:object, cast?:{policy?:object, roles:object[]}, cue?:{stall?:object, triggers:object[]}}}
 *   规范化 manifest。`cast`／`cue` **只在源文件写了该段时才挂键**（老教室形状不变）。
 */
export function parseManifest(text, { baseDir } = {}) {
  // 🔴 用 parseDocument（不是 parse）是为了拿到**节点偏移**→ 行号（T8A 的报错要带行号）。
  //    行为与 parse 等价：warnings 走 log.warn、errors 抛 YAMLParseError、最后 toJS()。
  const yamlDoc = parseDocument(text)
  // 与 yaml 的 `parse()` 内部一致：warning 走 process.emitWarning（默认 logLevel='warn' 全放行）
  yamlDoc.warnings.forEach((warning) => {
    process.emitWarning(warning)
  })
  if (yamlDoc.errors.length > 0) {
    throw new ManifestError(`YAML 语法错误：${yamlDoc.errors[0].message}`)
  }
  const loc = makeLocator(yamlDoc, text)
  const doc = yamlDoc.toJS()
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
  // 🔴 T8A：`cast:` / `cue:`（多角色同台的数据层）。
  // 🔴 向后兼容的关键在**下面这两行 if**：段不存在时**根本不挂键** → 老教室拿到的
  //    manifest 对象形状与加本批之前**逐字相同**（`deepEqual` 也过）。
  // 🔴 `cue` 依赖 `cast`（触发条件要引用角色 id）→ 必须先解析 cast，且 cast 缺席时报错。
  let cast
  if (!isAbsent(doc.cast)) cast = normalizeCast(doc.cast, { loc, baseDir, phaseDomain: domain })
  let cue
  if (!isAbsent(doc.cue)) {
    if (cast === undefined) {
      throw new ManifestError(
        `${whereAt(['cue'], loc)}没有可引用的角色：本文件未声明 cast: 段` +
          `（cue 的触发条件要引用 cast.roles[].id；不安排同学出场就别写 cue: 段）`,
      )
    }
    cue = normalizeCue(doc.cue, { loc, baseDir, roleIds: cast.roles.map((r) => r.id) })
    // 🔴 交叉校验：声明了出场路，却没有任何**同学**角色（只有老师）→ 死配置，报错。
    //    这条不违反"cast 只声明老师时行为不变"：那种教室本来就不该写 triggers。
    const declaredPeers = cast.roles.filter((r) => r.role !== 'teacher')
    if (cue.triggers.length > 0 && declaredPeers.length === 0) {
      throw new ManifestError(
        `${whereAt(['cue', 'triggers'], loc)}声明了 ${cue.triggers.length} 条出场路，` +
          `但 cast.roles 里一位同学都没有（只有老师）——这些出场路永远不会命中，故报错；` +
          `"先跑一讲没有同学的真实课"请把 triggers 写成 []`,
      )
    }
  }

  // 🔴 ANIM-ORCH：顶层 `animation:` 段。缺席 → **不挂键**（老教室 manifest 形状逐字不变）。
  let animation
  if (!isAbsent(doc.animation)) animation = normalizeAnimation(doc.animation, { loc })

  // 🔴 ANIM-PREP：顶层 `prep:` 段（备课清单）。缺席 → **不挂键**（同上，老教室形状逐字不变）。
  //    形状与校验口径见 lib/prep.mjs 的文件头。
  let prep
  if (!isAbsent(doc.prep)) {
    // 🔴 交叉校验：声明了备课清单却没用动画 → **死配置**。预热跑不了、工具也没注册，
    //    而作者会以为"我备过课了"（本项目已被"静默不生效"坑过两次，故这里直接报错）。
    if (animation === undefined || animation.enabled !== true) {
      throw new ManifestError(
        `${whereAt(['prep'], loc)}声明了备课清单，但本教室没有启用教学动画` +
          `（顶层缺 animation: {enabled: true}）——这份清单永远不会被用到，预热也起不来。` +
          `要么加上 animation: {enabled: true}，要么把 prep: 整段删掉。`,
      )
    }
    prep = normalizePrep(doc.prep, {
      loc,
      baseDir,
      ManifestError,
      classroomLessons: lessonsDeclaredBy(classroom),
    })
  }

  const manifest = { format: doc.format, classroom, phases, blocks, runtime_store: doc.runtime_store }
  if (cast !== undefined) manifest.cast = cast
  if (cue !== undefined) manifest.cue = cue
  if (animation !== undefined) manifest.animation = animation
  if (prep !== undefined) manifest.prep = prep
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

  // 🔴 启动层（target: system）的频率：引擎**只在装载时注册一次** `systemPrompt.section`
  //    （index.mjs 第 2 节），注册后常驻 system prompt（每轮都在）→ 块上的 `frequency`
  //    **不参与任何裁决**。故非 `once` 的写法一律报错，**不静默忽略**（与 assertKnownKeys 同一条规矩：
  //    "配了不生效"正是本项目反复踩过的坑）。
  //    为什么现在才加：官方六层把 ① 常驻层写成"系统段 · 每轮"，照它写 `every: turn` 的作者
  //    以为自己在声明"每轮重注"，实际拿到的是"装载时注册一次"——两份文档说同一件事、行为不同。
  //    改法（报错文案里给）：要随讲/随相位变化的内容改用 `target: chat` 的块
  //    （`frequency.anchor: lesson_start` 或 `phase` 门）。
  if (position.target === 'system') {
    if (frequency.every !== 'once') {
      throw new ManifestError(
        `${at}(${id}) target=system 的块只能用 frequency: { every: once }（得到 ${JSON.stringify(frequency)}）——` +
          `系统段在装载时注册一次并常驻 system prompt，块上的频率不参与裁决；` +
          `要随讲次/相位变化的内容请改成 target: chat 的块（可用 frequency.anchor: lesson_start 或 phase 门）`,
      )
    }
    if (frequency.anchor === 'lesson_start') {
      throw new ManifestError(
        `${at}(${id}) target=system 的块不支持 frequency.anchor: lesson_start（每讲重注）——` +
          `系统段注册是一次性的（见 index.mjs），写它等于声明了一个不会发生的行为；` +
          `要每讲重读的内容请改成 target: chat 的块`,
      )
    }
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
