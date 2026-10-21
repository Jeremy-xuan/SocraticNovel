// lib/expression.mjs — EXPR-1 表情链路的**纯逻辑层**（唯一 IO：读同目录的表数据文件）
//
// 用户口径（2026-09-24 原话）：*"表情不规定，让 AI 自己决定和控制吧，加点自由度。"*
// → 引擎**取消"固定按环节映射表情"**，只提供两条：
//   ① **首选**：老师用 `classroom_express` 自己指定（通道在 index.mjs）；
//   ② **兜底**：老师本回合没指定时，用它**自己刚说过的话**推一个情绪 → 落到该模型**实际有的**东西上。
//
// ── 🔴 三条**并列**的落地路径（不是主/备关系）────────────────────────────────
//   路径 A「命名表情」：`model.expression(name)` —— 名字来自渲染侧能力发现的 `Expressions`。
//   路径 B「逐参数直驱」：直接写脸部参数 —— 参数名来自渲染侧能力发现的**参数全集**。
//   路径 C「用动作表达」：播一个动作组（`Motions` 的组名，如 `Surprise`）。
//
//   **为什么必须三条都当一等公民**（2026-09-24 主代理两轮补充实测，三种真实模型）：
//     · 官方初音ミク 两版（`miku` / `miku_sample_t04`）**命名表情 = 0**，但各有 **17 个脸部参数**
//       （眼 6／眉 8／口 2／颊 1）→ 只有路径 B 成立；
//     · **分层立绘转出的 `.moc3`**（`image2live2d` / `psd2live` 产物）**只有 motion3、没有 exp3.json**
//       → **命名表情 = 0**，且有 **17 组动作**（`Idle/Smile/Surprise/Sad/Angry/Shy/…`）→ 只有路径 C 成立；
//     · 官方样本（Haru 等）三条都成立。
//   → 只做路径 A 会让"用户最可能选的模型"（Miku）与"我们自己的产线产物"**都没有表情**。
//
//   🔴 **怎么挑路（EXPR-2 改定，2026-09-24）：按「名字读不读得懂」计分，不按手段类别排。**
//     **旧规则（EXPR-1，已作废）**：写死 `命名表情 > 逐参数 > 动作`，按"可靠性＋是不是持续状态"排。
//     **为什么作废（真会话证据，EXPR-1 §4.3）**：Haru 上老师**主动选了逐参数**（`ParamEyeLOpen` 等），
//       **一次都没用** `F01…F08`；miku 上逐字用了 `PARAM_EYE_L_OPEN`；分层模型上用了动作组名
//       （`Shy`／`Serious`）。→ **模型是按"名字能不能读懂"选的，不是按我们划的手段类别选的。**
//     现行规则（三档，**只按名字的形状判，不维护任何词表**）：
//       ① **有语义**（能看出是什么情绪／什么部位：`Smile`／`Sad`／`ParamEyeLOpen`／`Surprise`）→ **优先**；
//       ② **无语义编号**（`F01`／`expr_3`／`E1`）→ **次之**（**允许用，但不作为默认优选**）；
//       ③ **没有名字可读**（例如只能自己编一组数值、名字里一个字母都没有）→ **最后**。
//     计分见 `readabilityOfName()`／`scoreNames()`／`pathRanking()`；**同分才**按"可靠性次序"
//       `EXPRESSION_PATH_TIEBREAK`（命名表情 > 逐参数 > 动作）打破平局：
//       命名表情＝模型作者设计的表达单元、一次原子调用、只动脸、能先探测再调用（最可靠、是持续状态）；
//       逐参数＝同样是持续状态，但需要"先清零＋每帧平滑"、会与嘴型通道抢参数（机器多一档）；
//       动作＝**有时长的瞬态片段**、会接管 motion manager、且情绪↔组名只能靠猜（故排最后）。
//     🔴 **`F0x` 没有被禁用**：有些模型只有它（Haru 就是这样），那时它就是唯一可用的一条路。
//        判据只影响"**有得选时优先哪条**"，不影响"能不能用"。
//
// ── 兜底的正则表**不是我们发明的** ─────────────────────────────────────────
//   逐字来自相邻项目 `hg4/sakiko-for-dsh` 的 `host.mjs:392-420`
//   （13 条线索 / 13 条规则 / 优先级即语义 / 返回固定枚举，**不是模型打分**），
//   出处：`docs/历史报告/研究_同类DSH立绘插件_2026-09-24.md` §3.3.1 全文。
//   表数据落在 `lib/expression-table.json`（**不散在代码里**），本文件只做解释与求值。
//
// ── 与 sakiko 的分歧（研究件 R3 的告诫）────────────────────────────────────
//   "参数名必须来自我们自己的能力发现，不要抄他们的正则+默认名"。
//   他们的第 2 步是「情绪 → 表情名」静态表（`happy:'smile03'`）＋ 一张写死参数名的 FACE 表；
//   我们的模型叫 F01…F08（无语义）、参数名也各不相同 → 抄必失效。故改成：
//   **情绪 → 8 槽位 → ① 下标取模取名字；② 角色正则在本模型真实参数里匹配（可命中多个）**。
//   ⚠️ 槽位是**位置近似**、角色数值是**估计**，均未经画面验证（引擎看不到画面）——
//      见实现报告 §3 的诚实边界与 §7 待确认。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 本插件自带的表数据文件名（与 lib/expression.mjs 同目录）。 */
export const EXPRESSION_TABLE_FILE = 'expression-table.json'

/** 表数据的 format 标识；对不上就报错（不静默按新格式读旧文件）。 */
export const EXPRESSION_TABLE_FORMAT = 'socratic-expression/0'

/** 状态文件名（写在教室 `runtime/` 下；格式见 renderExpressionState）。 */
export const EXPRESSION_STATE_FILE = 'expression.md'

/** 状态文件里的机器可读键（客户端按行取值，**不解析中文**）。 */
export const EXPRESSION_STATE_KEYS = {
  path: 'expression_path',
  expression: 'current_expression',
  face: 'expression_face',
  motion: 'expression_motion',
  origin: 'expression_origin',
  emotion: 'expression_emotion',
  turn: 'expression_turn',
  capability: 'expression_capability',
  note: 'expression_note',
}

/** `expression_origin` 的三个取值（也是客户端的分支依据）。 */
export const EXPRESSION_ORIGINS = ['teacher', 'fallback', 'unavailable']

/** 机器可读行里"无值"的占位符（空字符串会让客户端分不清"没这一行"与"值是空"）。 */
export const EXPRESSION_NONE = '-'

/**
 * `expression_note` 里**始终**带的那一句（FREQ-PARITY，2026-09-24）。
 *
 * 依据（EXPR-5 收尾那一轮的结论）：引擎侧**不夹取**参数值是正确的（权威值域只有渲染侧有），
 * 但**代价**是：读这个状态文件的第三方看到的是**请求值**，不是最终生效值。所以这一行必须
 * 自己说清楚，别让读文件的人误判。
 * 🔴 只写这一句说明：夹取归渲染侧，本文件既不夹取、也不改别的字段。
 */
export const EXPRESSION_NOTE_REQUEST_VALUE = '本文件记录的是请求值（实际值由渲染侧夹取后生效）'

/** 三条落地路径的 id（状态文件、工具返回值、日志共用同一套名字）。 */
export const EXPRESSION_PATHS = ['named-expression', 'face-parameters', 'motion']

/**
 * **同分时的次序**（＝EXPR-1 那套"可靠性＋是不是持续状态"的理由，现在**只用来打破平局**）。
 * 🔴 挑路的第一判据是**名字可读性**（见 `pathRanking`／`pickPath`），这一条只在得分相同时生效。
 * 理由见文件头：命名表情最可靠且是持续状态 → 逐参数次之（要清零＋每帧平滑、抢嘴型参数）→
 * 动作最后（瞬态片段、接管 motion manager、组名只能猜）。
 */
export const EXPRESSION_PATH_TIEBREAK = ['named-expression', 'face-parameters', 'motion']

/** 名字可读性的三档（**只按名字的形状判**；`grade` 就是这一档的分数）。 */
export const NAME_READABILITY = [
  { kind: 'semantic', grade: 2, label: '有语义' },
  { kind: 'opaque', grade: 1, label: '无语义编号' },
  { kind: 'nameless', grade: 0, label: '没有名字' },
]

/** 档位 ← 分数（四舍五入后）。 */
const KIND_BY_GRADE = { 2: 'semantic', 1: 'opaque', 0: 'nameless' }

/**
 * 「编号式名字」的形状：**短字母前缀（0–4 个）＋可选分隔符＋纯序号**，此外什么都没有。
 * 覆盖 `F01`／`E1`／`F_01`／`expr_3`／`moc_1`；**不**覆盖 `F01_smile`（它后面还有可读的词）。
 * 🔴 这是**形状判据**，不是词表：本文件不维护任何"哪些名字算有意义"的清单。
 */
const NUMBERED_NAME = /^[A-Za-z]{0,4}[-_.]?\d+$/

/** 一个"能读出意思的词"至少要这么多个连续字母（`Sad`＝3 算，`ab` 不算）。 */
const MIN_SEMANTIC_RUN = 3

/**
 * 一个名字读不读得懂（纯形状判据，**无词表**）。
 *
 * 🔴 依据（EXPR-1 真会话 §4.3）：老师在 Haru 上**放着 8 个 `F01…F08` 不用**、自己去写
 *    `ParamEyeLOpen`，就是因为前者读不出是什么情绪。所以判据是"**这个名字里有没有一个
 *    能读出意思的词**"，而不是"它是哪一类手段"。
 * @param {string} name
 * @returns {{kind:'semantic'|'opaque'|'nameless', grade:number, reason:string}}
 */
export function readabilityOfName(name) {
  const text = String(name ?? '').trim()
  if (text === '') return { kind: 'nameless', grade: 0, reason: '空名字' }
  const letters = text.replace(/[^A-Za-z]/g, '')
  if (letters === '') return { kind: 'nameless', grade: 0, reason: '一个字母都没有（纯数字／符号）' }
  if (NUMBERED_NAME.test(text)) return { kind: 'opaque', grade: 1, reason: '编号式（前缀＋序号），读不出是什么' }
  const runs = text.match(/[A-Za-z]+/g) ?? ['']
  const longest = runs.reduce((n, run) => Math.max(n, run.length), 0)
  if (longest >= MIN_SEMANTIC_RUN) {
    return { kind: 'semantic', grade: 2, reason: `含 ${longest} 个连续字母的词` }
  }
  return { kind: 'opaque', grade: 1, reason: `缩写（最长只有 ${longest} 个连续字母），读不出是什么` }
}

/**
 * 给一份名字清单打分：**均分**（0–2）＋三档计数。空清单 → 0 分（没有名字可读）。
 * @param {string[]} names
 * @returns {{count:number, semantic:number, opaque:number, nameless:number, score:number,
 *            grade:number, kind:'semantic'|'opaque'|'nameless'}}
 */
export function scoreNames(names) {
  const list = (Array.isArray(names) ? names : []).filter((n) => typeof n === 'string' && n !== '')
  const counts = { semantic: 0, opaque: 0, nameless: 0 }
  for (const name of list) counts[readabilityOfName(name).kind] += 1
  const count = list.length
  const score = count === 0 ? 0 : (counts.semantic * 2 + counts.opaque) / count
  const grade = Math.round(score)
  return { count, ...counts, score, grade, kind: KIND_BY_GRADE[grade] }
}

/**
 * 三条路各自的名字可读性得分（**按分数从高到低**；同分按 `EXPRESSION_PATH_TIEBREAK` 的次序）。
 * @param {{names?:string[], parameters?:string[], motions?:string[],
 *          namedPath?:boolean, paramPath?:boolean, motionPath?:boolean}} capability
 * @returns {Array<{path:string, available:boolean, order:number} & ReturnType<typeof scoreNames>>}
 */
export function pathRanking(capability) {
  const inventories = {
    'named-expression': capability?.names,
    'face-parameters': capability?.parameters,
    motion: capability?.motions,
  }
  const available = {
    'named-expression': capability?.namedPath === true,
    'face-parameters': capability?.paramPath === true,
    motion: capability?.motionPath === true,
  }
  return EXPRESSION_PATH_TIEBREAK.map((path, order) => ({
    path,
    available: available[path],
    order,
    ...scoreNames(inventories[path]),
  })).sort((a, b) => b.score - a.score || a.order - b.order)
}

/** 参数按 id 归维的规则（**我们的**规则，写在这里而不是散在代码里；顺序即优先级）。 */
export const PARAMETER_DIMENSIONS = [
  { group: 'eye', label: '眼', pattern: 'EYE' },
  { group: 'brow', label: '眉', pattern: 'BROW' },
  { group: 'mouth', label: '口', pattern: 'MOUTH' },
  { group: 'cheek', label: '颊', pattern: 'CHEEK' },
]

/**
 * 把参数 id 归一到「只留字母数字、全大写」的形状，供 `faceRoles`／`PARAMETER_DIMENSIONS` 匹配。
 *
 * 🔴 为什么必须有这一步（EXPR-2 真会话实证，**这条是现场炸出来的**）：模型作者写参数名有两大流派——
 *    · `PARAM_EYE_L_OPEN`（初音ミク那种**全大写蛇形**）；
 *    · `ParamEyeLOpen`（官方样本 Haru 那种**驼峰**）。
 *    我们的 `faceRoles` 正则与维度关键词是按前者的形状写的，直接拿去匹配驼峰名会**一个都匹配不上**：
 *    Haru 上兜底选中的是逐参数路，却写出**空**的 `expression_face: -`（＝点了表情但什么都没动，
 *    而状态文件还写着 `origin: fallback`）——正是本项目最忌的"静默失效"。
 *    维度归维也一样（Haru 的 42 个参数当时全落进"其它"）。
 *
 * 🔴 做法＝**对 id 与正则两边做同一个形状变换**：去掉分隔符（`_`／`-`／空格）、统一大写，
 *    然后按子串匹配。于是 `ParamEyeLOpen` → `PARAMEYELOPEN`，正则 `EYE_[LR]_OPEN` → `EYE[LR]OPEN`，
 *    两边在同一形状上对上。**不引入任何模型专属名字**（仍然只用模型自己给的 id），
 *    也不需要"驼峰切词"那种会在大写缩写上翻车的规则（`ParamBrowLY` 这种切不开）。
 * @param {string} id
 * @returns {string}
 */
export function normalizeParameterId(id) {
  return String(id ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

/** 正则侧做**同一个**形状变换（只去分隔符＋大写；正则元字符原样保留）。 */
function normalizeParamPattern(pattern) {
  return String(pattern).replace(/[_-]/g, '').toUpperCase()
}

/**
 * 校验并规范化一张表（纯函数；`value` 可以是已解析对象或 JSON 文本）。
 * 🔴 每一处不合法都**抛错**，不静默用默认值——本项目的静默失效教训。
 * @param {object|string} value
 */
export function loadExpressionTable(value) {
  let table = value
  if (typeof value === 'string') {
    try {
      table = JSON.parse(value)
    } catch (cause) {
      throw new Error(`表情表不是合法 JSON：${cause?.message ?? cause}`)
    }
  }
  if (table === null || typeof table !== 'object' || Array.isArray(table)) {
    throw new Error('表情表必须是 JSON 对象')
  }
  if (table.format !== EXPRESSION_TABLE_FORMAT) {
    throw new Error(
      `表情表的 format 必须是 ${JSON.stringify(EXPRESSION_TABLE_FORMAT)}（得到 ${JSON.stringify(table.format)}）`,
    )
  }
  const emotions = table.emotions
  if (!Array.isArray(emotions) || emotions.length === 0) throw new Error('表情表缺 emotions 数组')
  const slots = table.slots
  if (!Array.isArray(slots) || slots.length === 0) throw new Error('表情表缺 slots 数组')

  const cues = table.cues
  if (cues === null || typeof cues !== 'object' || Array.isArray(cues)) throw new Error('表情表缺 cues 对象')
  for (const [name, cue] of Object.entries(cues)) {
    if (cue === null || typeof cue !== 'object' || typeof cue.pattern !== 'string' || cue.pattern === '') {
      throw new Error(`表情表的线索 ${name} 必须有非空 pattern 字符串`)
    }
    if (cue.input !== undefined && cue.input !== 'raw' && cue.input !== 'trimmed') {
      throw new Error(`表情表的线索 ${name} 的 input 只能是 raw / trimmed（得到 ${JSON.stringify(cue.input)}）`)
    }
    compilePattern(cue.pattern, `线索 ${name}`)
  }

  const rules = table.rules
  if (!Array.isArray(rules) || rules.length === 0) throw new Error('表情表缺 rules 数组')
  for (const [index, rule] of rules.entries()) {
    if (rule === null || typeof rule !== 'object') throw new Error(`表情表第 ${index + 1} 条规则不是对象`)
    if (!emotions.includes(rule.emotion)) {
      throw new Error(`表情表第 ${index + 1} 条规则的 emotion=${JSON.stringify(rule.emotion)} 不在 emotions 枚举内`)
    }
    const all = rule.all ?? []
    const any = rule.any ?? []
    if (!Array.isArray(all) || !Array.isArray(any)) throw new Error(`表情表第 ${index + 1} 条规则的 all/any 必须是数组`)
    if (all.length === 0 && any.length === 0) {
      throw new Error(`表情表第 ${index + 1} 条规则既没有 all 也没有 any（永远不会命中，等于死规则）`)
    }
    for (const key of [...all, ...any]) {
      if (!Object.prototype.hasOwnProperty.call(cues, key)) {
        throw new Error(`表情表第 ${index + 1} 条规则引用了不存在的线索 ${JSON.stringify(key)}`)
      }
    }
  }

  if (!emotions.includes(table.default)) {
    throw new Error(`表情表的 default=${JSON.stringify(table.default)} 不在 emotions 枚举内`)
  }

  const emotionSlot = table.emotionSlot
  if (emotionSlot === null || typeof emotionSlot !== 'object' || Array.isArray(emotionSlot)) {
    throw new Error('表情表缺 emotionSlot 对象')
  }
  // 🔴 覆盖性校验：18 个情绪一个都不能漏（漏了 → 那个情绪落到 undefined → 静默不出表情）
  const missing = emotions.filter((e) => !Number.isInteger(emotionSlot[e]))
  if (missing.length > 0) throw new Error(`表情表的 emotionSlot 缺少这些情绪：${missing.join(',')}`)
  for (const [emotion, slot] of Object.entries(emotionSlot)) {
    if (!emotions.includes(emotion)) throw new Error(`表情表的 emotionSlot 里有枚举外的情绪 ${emotion}`)
    if (slot < 0 || slot >= slots.length) {
      throw new Error(`表情表里 ${emotion} 的槽位 ${slot} 超出 slots 范围 0..${slots.length - 1}`)
    }
  }

  // ── 逐参数路（路径 B）的两张表 ────────────────────────────────────────────
  const faceRoles = table.faceRoles
  if (faceRoles === null || typeof faceRoles !== 'object' || Array.isArray(faceRoles)) {
    throw new Error('表情表缺 faceRoles 对象（逐参数直驱的角色表）')
  }
  for (const [role, patterns] of Object.entries(faceRoles)) {
    if (!Array.isArray(patterns) || patterns.length === 0) {
      throw new Error(`表情表 faceRoles 的 ${role} 必须是非空正则数组`)
    }
    for (const pattern of patterns) compilePattern(pattern, `faceRoles.${role}`)
  }
  const motionRoles = table.motionRoles
  if (motionRoles === null || typeof motionRoles !== 'object' || Array.isArray(motionRoles)) {
    throw new Error('表情表缺 motionRoles 对象（槽位 → 动作组名正则，路径 C）')
  }
  const missingMotionSlots = slots.filter((slot) => !Array.isArray(motionRoles[slot]) || motionRoles[slot].length === 0)
  if (missingMotionSlots.length > 0) {
    throw new Error(`表情表的 motionRoles 缺少这些槽位（或为空数组）：${missingMotionSlots.join(',')}`)
  }
  for (const [slot, patterns] of Object.entries(motionRoles)) {
    if (!slots.includes(slot)) throw new Error(`表情表的 motionRoles 里有 slots 之外的槽位 ${slot}`)
    for (const pattern of patterns) compilePattern(pattern, `motionRoles.${slot}`)
  }
  const slotFace = table.slotFace
  if (slotFace === null || typeof slotFace !== 'object' || Array.isArray(slotFace)) {
    throw new Error('表情表缺 slotFace 对象（槽位 → 逐参数值）')
  }
  // 🔴 8 个槽位一个都不能漏（漏了 → 那个槽位落到 undefined → 兜底静默不出表情）
  const missingSlots = slots.filter((s) => slotFace[s] === undefined)
  if (missingSlots.length > 0) throw new Error(`表情表的 slotFace 缺少这些槽位：${missingSlots.join(',')}`)
  for (const [slot, values] of Object.entries(slotFace)) {
    if (!slots.includes(slot)) throw new Error(`表情表的 slotFace 里有 slots 之外的槽位 ${slot}`)
    if (values === null || typeof values !== 'object' || Array.isArray(values)) {
      throw new Error(`表情表 slotFace.${slot} 必须是「角色 → 数值」的对象`)
    }
    for (const [role, value] of Object.entries(values)) {
      if (!Object.prototype.hasOwnProperty.call(faceRoles, role)) {
        throw new Error(`表情表 slotFace.${slot} 引用了未定义的角色 ${role}`)
      }
      if (!Number.isFinite(value)) throw new Error(`表情表 slotFace.${slot}.${role} 必须是有限数值`)
    }
  }

  return { emotions, slots, emotionSlot, faceRoles, motionRoles, slotFace, cues, rules, default: table.default }
}

function compilePattern(pattern, where) {
  try {
    return new RegExp(pattern)
  } catch (cause) {
    throw new Error(`表情表的 ${where} 不是合法正则：${cause?.message ?? cause}`)
  }
}

let cachedTable = null

/**
 * 读本插件自带的表情表（**唯一一处 IO**：读同目录的 `expression-table.json`，读一次缓存）。
 */
export function readExpressionTable() {
  if (cachedTable === null) {
    const file = join(HERE, EXPRESSION_TABLE_FILE)
    cachedTable = loadExpressionTable(readFileSync(file, 'utf8'))
  }
  return cachedTable
}

/**
 * 文本 → 情绪名（18 枚举之一）。**纯正则、按优先级，不是模型打分**。
 * 逐字对应 `host.mjs:392-420` 的判定顺序（顺序即语义，改顺序＝改行为）。
 * @param {string} text
 * @param {object} [table]
 * @returns {string} 情绪名（命不中任何规则 → table.default）
 */
export function emotionFor(text, table = readExpressionTable()) {
  const raw = String(text ?? '')
  const trimmed = raw.trim()
  const hit = {}
  for (const [name, cue] of Object.entries(table.cues)) {
    const subject = cue.input === 'trimmed' ? trimmed : raw
    hit[name] = new RegExp(cue.pattern).test(subject)
  }
  for (const rule of table.rules) {
    const all = rule.all ?? []
    const any = rule.any ?? []
    if (all.some((key) => !hit[key])) continue
    if (any.length > 0 && !any.some((key) => hit[key])) continue
    return rule.emotion
  }
  return table.default
}

/**
 * 情绪 → 8 槽位下标。
 * @param {string} emotion
 * @param {object} [table]
 * @returns {number}
 */
export function slotForEmotion(emotion, table = readExpressionTable()) {
  const slot = table.emotionSlot[emotion]
  if (!Number.isInteger(slot)) {
    throw new Error(`未知情绪 ${JSON.stringify(emotion)}（可用：${table.emotions.join('/')}）`)
  }
  return slot
}

/**
 * **路径 A**：情绪 → 该模型实际有的**命名表情**。槽位按下标取模，**不猜名字语义**。
 * @param {string} emotion
 * @param {string[]} names
 * @param {object} [table]
 * @returns {{name:string, index:number, slot:number}}
 */
export function expressionForEmotion(emotion, names, table = readExpressionTable()) {
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error('该模型没有命名表情（能力发现给出的 Expressions 为空）→ 只能走逐参数路')
  }
  const slot = slotForEmotion(emotion, table)
  const index = slot % names.length
  return { name: names[index], index, slot }
}

/**
 * **路径 B**：情绪 → 逐参数直驱的「参数 id → 数值」。
 *
 * 🔴 参数名**只能来自该模型真实存在的参数**（能力发现给的参数全集）：本函数把
 *    `slotFace[槽位]` 的角色用 `faceRoles[角色]` 的正则去**匹配模型自己的参数**，
 *    匹配不到的角色**跳过并在 missingRoles 里报出来**（不静默假装写了）。
 *    一个角色可能命中多个参数（如 eye_smile 在 miku 上命中左右眼两个）——全部写同一个值。
 * @param {string} emotion
 * @param {Array<{id:string}>|string[]} parameters - 该模型的参数全集
 * @param {object} [table]
 * @param {{exclude?:string[]}} [opts] - `exclude` ＝**别写的参数**。兜底必须排除
 *   渲染侧声明的 **LipSync（嘴）参数**：那一个参数归嘴型通道所有，兜底再写一份＝两个写者抢同一个
 *   参数（本项目已在嘴型上踩过 `addParameterValueById` 是累加、会叠加的坑）。被排除的 id 在
 *   `skippedIds` 里如实报出（不静默少写）。
 * @returns {{params:Record<string,number>, slot:string, missingRoles:string[], skippedIds:string[]}}
 */
export function faceParamsForEmotion(emotion, parameters, table = readExpressionTable(), opts = {}) {
  const ids = (Array.isArray(parameters) ? parameters : []).map((p) => (typeof p === 'string' ? p : p?.id)).filter((id) => typeof id === 'string' && id !== '')
  if (ids.length === 0) {
    throw new Error('该模型没有可用的脸部参数（能力发现给的参数集为空）→ 两条路都不可用')
  }
  const exclude = new Set((Array.isArray(opts.exclude) ? opts.exclude : []).filter((id) => typeof id === 'string'))
  const slot = table.slots[slotForEmotion(emotion, table)]
  const wanted = table.slotFace[slot] ?? {}
  const params = {}
  const missingRoles = []
  const skippedIds = []
  for (const [role, value] of Object.entries(wanted)) {
    const matched = ids.filter((id) =>
      table.faceRoles[role].some((pattern) => new RegExp(normalizeParamPattern(pattern)).test(normalizeParameterId(id))),
    )
    if (matched.length === 0) {
      missingRoles.push(role)
      continue
    }
    for (const id of matched) {
      if (exclude.has(id)) {
        skippedIds.push(id)
        continue
      }
      params[id] = value
    }
  }
  return { params, slot, missingRoles, skippedIds }
}

/**
 * **路径 C**：情绪 → 一个**动作组名**（用动作表达情绪）。
 *
 * 🔴 动作组名**只能来自该模型真实有的动作组**（能力发现的 `motionGroups` / `motionGroupUnion`）：
 *    本函数把 `motionRoles[槽位]` 的正则去匹配模型自己的组名，**大小写不敏感**
 *    （动作组名是英文、大小写不统一：`Idle` / `smile` / `Head_yaw` 都见过）。
 * 🔴 匹配不到 → **如实返回 group=null**（不猜、不硬塞一个动作）：调用方据此明说"这条路这次用不了"。
 * @param {string} emotion
 * @param {string[]} groups - 该模型的动作组名（去重后的）
 * @param {object} [table]
 * @returns {{group:string|null, slot:string, pattern:string|null}}
 */
export function motionForEmotion(emotion, groups, table = readExpressionTable()) {
  const names = (Array.isArray(groups) ? groups : []).filter((g) => typeof g === 'string' && g !== '')
  if (names.length === 0) {
    throw new Error('该模型没有动作组（能力发现给的 motionGroups 为空）→ 路径 C 不可用')
  }
  const slot = table.slots[slotForEmotion(emotion, table)]
  for (const pattern of table.motionRoles[slot]) {
    const matched = names.find((name) => new RegExp(pattern, 'i').test(name))
    if (matched !== undefined) return { group: matched, slot, pattern }
  }
  return { group: null, slot, pattern: null }
}

/**
 * 把「参数 id → 数值」渲染成状态文件里的一行机器可读值（`id=值,id=值`，按 id 排序）。
 * @param {Record<string, number>} params
 * @returns {string} 空对象 → EXPRESSION_NONE
 */
export function renderFaceParams(params) {
  const entries = Object.entries(params ?? {})
  if (entries.length === 0) return EXPRESSION_NONE
  return entries
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, value]) => `${id}=${value}`)
    .join(',')
}

/**
 * 解析状态文件里的 `expression_face` 行（客户端与测试共用的口径）。
 * @param {string|null} value
 * @returns {Record<string, number>}
 */
export function parseFaceParams(value) {
  const out = {}
  if (typeof value !== 'string' || value === '' || value === EXPRESSION_NONE) return out
  for (const part of value.split(',')) {
    const at = part.indexOf('=')
    if (at <= 0) continue
    const id = part.slice(0, at).trim()
    const num = Number(part.slice(at + 1))
    if (id !== '' && Number.isFinite(num)) out[id] = num
  }
  return out
}

/**
 * 解析渲染侧能力发现的产物（JSON 文本或对象）。
 * @param {object|string} value
 * @returns {Record<string, object>} 键＝模型名
 */
export function parseCapabilityJson(value) {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch (cause) {
      throw new Error(`能力发现产物不是合法 JSON：${cause?.message ?? cause}`)
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('能力发现产物必须是「键＝模型名」的 JSON 对象')
  }
  return parsed
}

/**
 * 按 id 把参数归维（**我们的**规则，见 PARAMETER_DIMENSIONS；匹配不到的落 `other`）。
 * @param {string[]} ids
 * @returns {Array<{group:string,label:string,parameters:string[]}>}
 */
export function groupParameters(ids) {
  const groups = PARAMETER_DIMENSIONS.map((d) => ({ group: d.group, label: d.label, parameters: [] }))
  const other = { group: 'other', label: '其它', parameters: [] }
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== 'string' || id === '') continue
    const normalized = normalizeParameterId(id)
    const dimension = PARAMETER_DIMENSIONS.find((d) => normalized.includes(d.pattern))
    ;(dimension ? groups[PARAMETER_DIMENSIONS.indexOf(dimension)] : other).parameters.push(id)
  }
  return [...groups.filter((g) => g.parameters.length > 0), ...(other.parameters.length > 0 ? [other] : [])]
}

/**
 * 从能力发现产物里取出**某个模型实际有的表情能力**（两条路各自的清单）。
 *
 * 🔴 为什么必须从渲染侧拿（不在这里硬编码）：官方样本里命名表情数从 0 到 8 不等、
 *    参数名有 4 种形态，硬编码一份清单在多数模型上直接失效（研究件 R3 的告诫）。
 *    真源＝渲染侧 `clients/live2d-host/src/capability.js` 的 `parseCapability()` 产物。
 * 🔴 **0 个命名表情 ≠ 没有可选项**：只要参数集非空，逐参数路就是可用的（Miku 正是这种）。
 * @param {Record<string, object>} capability
 * @param {string} model
 * @returns {{ok:boolean, names:string[], parameters:string[], dimensions:Array<object>,
 *            reason:string, entry:object|null, namedPath:boolean, paramPath:boolean}}
 */
export function expressionCapabilityFor(capability, model) {
  const empty = {
    ok: false,
    names: [],
    parameters: [],
    dimensions: [],
    motions: [],
    lipSyncParameters: [],
    entry: null,
    namedPath: false,
    paramPath: false,
    motionPath: false,
    path: null,
    pathRanking: [],
    pathReadability: null,
  }
  if (typeof model !== 'string' || model === '') {
    return { ...empty, reason: '未指定模型名（config.expression.model）' }
  }
  const entry = capability?.[model]
  if (entry === null || entry === undefined || typeof entry !== 'object') {
    const known = Object.keys(capability ?? {})
    return {
      ...empty,
      reason: `能力发现产物里没有模型 ${JSON.stringify(model)}（产物里有：${known.join(',') || '（空）'}）`,
    }
  }

  // 路径 A 的清单：命名表情（Expressions）
  let names = []
  if (Array.isArray(entry.expressions)) {
    names = entry.expressions.map((e) => (typeof e === 'string' ? e : e?.name)).filter((n) => typeof n === 'string' && n !== '')
  } else if (Array.isArray(entry.phaseExpression?.expressionNames)) {
    names = entry.phaseExpression.expressionNames.filter((n) => typeof n === 'string' && n !== '')
  }

  // 路径 B 的清单：参数全集（渲染侧 cdi3 的 Parameters）
  let parameters = []
  if (Array.isArray(entry.parameters)) {
    parameters = entry.parameters.map((p) => (typeof p === 'string' ? p : p?.id)).filter((id) => typeof id === 'string' && id !== '')
  } else if (Array.isArray(entry.parameterUniverse)) {
    parameters = entry.parameterUniverse.filter((id) => typeof id === 'string' && id !== '')
  }

  // 路径 C 的清单：动作组名（渲染侧能力发现的 motionGroups / motionGroupUnion）
  let motions = []
  if (Array.isArray(entry.motionGroups)) {
    motions = entry.motionGroups.map((g) => (typeof g === 'string' ? g : g?.name)).filter((n) => typeof n === 'string' && n !== '')
  } else if (Array.isArray(entry.motionGroupUnion)) {
    motions = entry.motionGroupUnion.filter((n) => typeof n === 'string' && n !== '')
  }
  motions = [...new Set(motions)]

  const namedPath = names.length > 0
  const paramPath = parameters.length > 0
  const motionPath = motions.length > 0
  // 嘴型通道（LipSync）参数：**兜底不许写它们**（一个参数两个写者＝叠加，见 faceParamsForEmotion）
  const lipSyncParameters = (
    Array.isArray(entry.lipSync?.parameters)
      ? entry.lipSync.parameters
      : Array.isArray(entry.parameterGroups?.LipSync)
        ? entry.parameterGroups.LipSync
        : []
  ).filter((id) => typeof id === 'string' && id !== '')
  if (!namedPath && !paramPath && !motionPath) {
    return {
      ...empty,
      entry,
      reason:
        `模型 ${model} **三种表达手段一个都没有**：命名表情 0 个（Expressions 为空）、` +
        '参数集为空（没有 parameters）、动作组 0 个（motionGroups 为空）' +
        '→ 这个模型无法表达情绪（不是"引擎没做"，是这个模型确实没有可用的表达手段）',
    }
  }
  const cap = {
    ok: true,
    model,
    names,
    parameters,
    dimensions: groupParameters(parameters),
    motions,
    lipSyncParameters,
    reason: '',
    entry,
    namedPath,
    paramPath,
    motionPath,
  }
  const ranking = pathRanking(cap)
  const chosen = pickPath(cap, ranking)
  return {
    ...cap,
    path: chosen,
    pathRanking: ranking,
    pathReadability: ranking.find((entry) => entry.path === chosen) ?? null,
  }
}

/**
 * 挑出这个模型该走哪条路：**先按名字可读性（`pathRanking` 的分数），同分才按可靠性次序**
 * （`EXPRESSION_PATH_TIEBREAK`：命名表情 > 逐参数 > 动作）。
 *
 * 🔴 为什么不是"按手段类别写死顺序"（EXPR-1 的旧规则）：真会话里老师在 Haru 上**放着 8 个
 *    `F01…F08` 不用**、自己去写 `ParamEyeLOpen`——他挑的是**读得懂的那条**。旧规则会把
 *    "名字读不出是什么"的那条排在前面，与现场相反。
 * 🔴 **`F0x` 没有被禁用**：判据只决定"有得选时优先哪条"；只有它可用时它照样被选中。
 * @param {{namedPath?:boolean, paramPath?:boolean, motionPath?:boolean}} capability
 * @param {Array<object>} [ranking] - 已经算好的 `pathRanking`（省一次计算）
 * @returns {'named-expression'|'face-parameters'|'motion'|null} 三条都不可用 → null
 */
export function pickPath(capability, ranking) {
  const ranked = (ranking ?? pathRanking(capability)).filter((entry) => entry.available)
  return ranked.length === 0 ? null : ranked[0].path
}

/**
 * 一句话说清"引擎为什么挑这条"（工具描述、装载日志、状态文件共用一处口径）。
 * @param {Array<object>|null|undefined} ranking
 * @param {string|null} [chosen]
 * @returns {string}
 */
export function describePathChoice(ranking, chosen) {
  const list = Array.isArray(ranking) ? ranking.filter((entry) => entry.available) : []
  if (list.length === 0) return '三条路都不可用'
  return list
    .map((entry) => {
      const mark = entry.path === chosen ? '→' : ' '
      return `${mark} ${entry.path}（${entry.kind}，均分 ${entry.score.toFixed(2)}：有语义 ${entry.semantic}／编号 ${entry.opaque}／没有名字 ${entry.nameless}）`
    })
    .join('；')
}

/**
 * 一句话说清"这个模型有哪些表达手段"（工具描述、状态文件、日志共用）。
 * 🔴 口径：**"0 个命名表情"不等于"没有可选项"**——三种手段分别报数，一条都没有才叫不可用。
 * @param {{namedPath?:boolean, paramPath?:boolean, motionPath?:boolean, names?:string[],
 *          parameters?:string[], motions?:string[], dimensions?:Array<object>}} capability
 * @returns {string}
 */
export function describeCapability(capability) {
  if (capability === null || capability === undefined || capability.ok === false) {
    return `不可用（${capability?.reason ?? '未读到能力发现' }）`
  }
  const parts = [
    `命名表情 ${capability.names?.length ?? 0} 个`,
    `脸部参数 ${capability.parameters?.length ?? 0} 个（${describeDimensions(capability.dimensions)}）`,
    `动作组 ${capability.motions?.length ?? 0} 个`,
  ]
  const chosen = capability.pathReadability ?? null
  const why =
    chosen === null
      ? '（无可用路）'
      : `${capability.path}（${chosen.kind}，均分 ${chosen.score.toFixed(2)}）`
  return parts.join('｜') + `｜按名字可读性走：${why}`
}

/**
 * 纯函数：把本回合的表情状态渲染成 `runtime/expression.md` 全文。
 * 🔴 风格照教室既有的 `runtime/progress.md`：**顶部机器可读行**（客户端按行取值，
 *    不解析中文）＋ HTML 注释解释 ＋ 给人看的表。
 * @param {{expression?:string|null, face?:Record<string,number>|null, origin:string,
 *          emotion?:string|null, turn:number, capability:'ok'|'unavailable', note?:string,
 *          model?:string|null, names?:string[], dimensions?:Array<object>}} state
 * @returns {string}
 */
export function renderExpressionState(state) {
  const origin = EXPRESSION_ORIGINS.includes(state?.origin) ? state.origin : 'unavailable'
  const turn = Number.isInteger(state?.turn) ? state.turn : 0
  const expression = typeof state?.expression === 'string' && state.expression !== '' ? state.expression : EXPRESSION_NONE
  const face = renderFaceParams(state?.face ?? {})
  const motion = typeof state?.motion === 'string' && state.motion !== '' ? state.motion : EXPRESSION_NONE
  const path = EXPRESSION_PATHS.includes(state?.path) ? state.path : EXPRESSION_NONE
  const emotion = typeof state?.emotion === 'string' && state.emotion !== '' ? state.emotion : EXPRESSION_NONE
  const capability = state?.capability === 'ok' ? 'ok' : 'unavailable'
  const K = EXPRESSION_STATE_KEYS
  const lines = [
    '# 本课表情（老师自主决定）',
    '',
    `${K.path}: ${path}`,
    `${K.expression}: ${expression}`,
    `${K.face}: ${face}`,
    `${K.motion}: ${motion}`,
    `${K.origin}: ${origin}`,
    `${K.emotion}: ${emotion}`,
    `${K.turn}: ${turn}`,
    `${K.capability}: ${capability}`,
  ]
  // 🔴 FREQ-PARITY（2026-09-24）：这一行**始终**出现，且始终带那句"记的是请求值"的说明——
  //    引擎侧不夹取（权威值域只有渲染侧有），读文件的第三方必须知道这一点（原因见常量注释）。
  const reason = typeof state?.note === 'string' && state.note !== '' ? oneLine(state.note) : null
  lines.push(`${K.note}: ${reason === null ? EXPRESSION_NOTE_REQUEST_VALUE : `${reason} ｜ ${EXPRESSION_NOTE_REQUEST_VALUE}`}`)
  lines.push(
    '',
    '<!--',
    '🔴 上面这几行是**机器可读行**，客户端（立绘面板）按行取值，**不解析中文**。',
    `🔴 \`${K.path}\` 是**客户端唯一该分支的字段**：${EXPRESSION_PATHS.join(' | ')}（或 \`${EXPRESSION_NONE}\`＝三条都不可用）。`,
    '   三条**并列**的手段，客户端**三条都要实现**（不是主/备关系）；引擎已按',
    '   **名字可读性**（有语义 > 无语义编号 > 没有名字；同分才按',
    `   可靠性次序 ${EXPRESSION_PATH_TIEBREAK.join(' > ')}）选好一条，把结果写进下面的行：`,
    `   ① 命名表情 \`${K.expression}\`：走 \`model.expression(name)\`。取值**只能**来自该模型的能力发现清单`,
    '      （渲染侧 parseCapability 产物的 `Expressions`）；对**没有命名表情的模型**（如初音ミク）本行是 `-`。',
    `   ② 逐参数直驱 \`${K.face}\`：\`参数id=值\` 逗号分隔，直接写脸部参数。参数名同样**只能**来自能力发现`,
    '      （参数全集）。**直驱前必须先把本表用到的参数清零**，否则会叠加。',
    `   ③ 动作 \`${K.motion}\`：一个**动作组名**（如 \`Surprise\`），客户端在该组里播一个动作。`,
    '      这条路给的是**有时长的片段**，不是持续状态——播完会回 idle（同分时它排最后就是这个原因）。',
    `   \`${K.origin}\`：${EXPRESSION_ORIGINS.join(' | ')} —— teacher＝老师本回合用 classroom_express 自己指定；`,
    '     fallback＝老师没指定、引擎用他刚说过的话推的（**推测**，优先级低于 teacher）；',
    '     unavailable＝能力发现给不出任何可选项（既无命名表情也无参数集）。',
    `   \`${K.emotion}\`：兜底推出的情绪（18 枚举之一）；老师显式指定时写 \`${EXPRESSION_NONE}\`。`,
    `   \`${K.turn}\`：本行是哪一回合写的（**宿主回合号**，与 session log 里 \`assistant/message\` 的`,
    '     `data.turn` 同一个——兜底要按它去本回合的文字里找依据）。',
    `   \`${K.capability}\`：ok | unavailable。`,
    `   \`${K.note}\`：**始终出现**，给人看的一行说明——` +
      '前半段是能力发现不可用时的原因（可用时没有这段），末段**固定**是那句' +
      `「${EXPRESSION_NOTE_REQUEST_VALUE}」`,
    '     🔴 那句不是废话：**引擎侧不夹取参数值**（权威值域只有渲染侧有）→ 本文件里的是**请求值**，',
    '       最终生效值要问渲染侧（客户端有"夹取账"）。写进文件是为了让读文件的第三方不误判。',
    '   格式必须是 `<键>: <值>`（写成中文或别的键名 → 客户端读不到，属静默失效）。',
    '-->',
    '',
    '| 项 | 值 |',
    '|---|---|',
    `| 走哪条路 | ${path === EXPRESSION_NONE ? '—' : path} |`,
    `| 命名表情 | ${expression === EXPRESSION_NONE ? '—' : `**${expression}**`} |`,
    `| 逐参数 | ${face === EXPRESSION_NONE ? '—' : face} |`,
    `| 动作 | ${motion === EXPRESSION_NONE ? '—' : `**${motion}**`} |`,
    `| 来源 | ${ORIGIN_LABEL[origin]} |`,
    `| 情绪（兜底依据） | ${emotion === EXPRESSION_NONE ? '—' : emotion} |`,
    `| 回合 | ${turn} |`,
    `| 能力发现 | ${capability === 'ok' ? 'ok' : `unavailable${state?.note ? `（${oneLine(state.note)}）` : ''}`} |`,
  )
  if (Array.isArray(state?.names) && state.names.length > 0) {
    lines.push('', `本模型实际有的命名表情（${state.names.length} 个）：${state.names.map((n) => `\`${n}\``).join(' / ')}`)
  }
  if (Array.isArray(state?.motions) && state.motions.length > 0) {
    lines.push('', `本模型实际有的动作组（${state.motions.length} 个）：${state.motions.map((n) => `\`${n}\``).join(' / ')}`)
  }
  if (Array.isArray(state?.dimensions) && state.dimensions.length > 0) {
    lines.push(
      '',
      '本模型实际有的脸部参数（按维度）：' +
        state.dimensions.map((d) => `${d.label} ${d.parameters.length} 个`).join(' / ') +
        `（共 ${state.dimensions.reduce((n, d) => n + d.parameters.length, 0)} 个）`,
    )
  }
  lines.push('')
  return lines.join('\n')
}

const ORIGIN_LABEL = {
  teacher: '老师指定（classroom_express）',
  fallback: '引擎兜底（由老师刚说的话推测）',
  unavailable: '不可用',
}

/**
 * 纯函数：读回 `runtime/expression.md` 里的机器可读行（客户端与引擎共用的解析口径）。
 * @param {string} text
 */
export function parseExpressionState(text) {
  const K = EXPRESSION_STATE_KEYS
  const pick = (key) => {
    const found = parseStateLine(text, key)
    if (found === null) return null
    const value = String(found).trim()
    return value === EXPRESSION_NONE ? null : value
  }
  const turnText = pick(K.turn)
  return {
    path: pick(K.path),
    expression: pick(K.expression),
    face: parseFaceParams(pick(K.face)),
    motion: pick(K.motion),
    origin: pick(K.origin),
    emotion: pick(K.emotion),
    turn: turnText === null ? null : Number.parseInt(turnText, 10),
    capability: pick(K.capability),
    note: parseStateLine(text, K.note),
  }
}

/**
 * 把维度清单压成一行（工具描述、工具返回值、状态文件、日志共用一处口径）。
 * @param {Array<{label:string, parameters:string[]}>} dimensions
 * @returns {string}
 */
export function describeDimensions(dimensions) {
  const list = Array.isArray(dimensions) ? dimensions : []
  if (list.length === 0) return '（无参数）'
  return list.map((d) => `${d.label} ${d.parameters.length} 个`).join(' / ')
}

// ── classroom_express 的工具描述（EXPR-1）────────────────────────────────────
// 🔴 写法口径与 classroom_draw / classroom_animate 一致：**动词优先**、给数字、给禁令，
//    不写"如果需要的话可以…"这类条件措辞（本项目实证：条件措辞让模型犹豫，工具就不被调用）。
// 🔴 描述里必须写**两条并列路径**与**本模型实际有的清单**：
//    · 不写清单 → 老师得先错一次才知道合法取值（多烧一个回合）；
//    · 写成"主路 + 兜底" → 对 0 个命名表情的模型（初音ミク）会引导它走一条根本不成立的路。
// 🔴 放在纯逻辑层（而不是 index.mjs 里当常量）：index.mjs 依赖宿主包，纯 Node 单测 import 不了它，
//    而这份描述是本批最需要被逐字断言的东西（它决定工具会不会被调用）。
/**
 * @param {{ok:boolean, reason?:string, model?:string, names:string[], parameters:string[],
 *          dimensions:Array<object>, namedPath?:boolean, paramPath?:boolean}} capability
 * @returns {string}
 */
export function buildExpressToolDescription(capability) {
  const cap = capability ?? { ok: false, reason: '装载时没读到能力发现产物', names: [], parameters: [], dimensions: [] }
  const head =
    'Decide the portrait\'s expression for this teaching turn and say it here — this is how the teacher takes ' +
    'control of her own face instead of leaving it to the engine. Call it when the emotional colour of the ' +
    'step matters and you want something specific. THREE parallel ways to express it — give exactly ONE of ' +
    'them: `expression` (a named expression, applied as model.expression(name)), `face` (a map of parameter ' +
    'id -> number, written straight onto the face parameters), or `motion` (the name of a motion group, e.g. ' +
    'Surprise, played as an authored clip). They are alternatives, not a main path and fallbacks: a model ' +
    'with 0 named expressions can still have `face` or `motion`, and a model with no face parameters may ' +
    'only have `motion`. A name, parameter id or motion group that this model does not have is rejected with ' +
    'the full list of what it does have — nothing is silently ignored. ' +
    'If you do not call this tool, the engine picks for you by guessing from what you just said, so ' +
    'calling it is how you take control. It only decides the expression for the current turn; it does not ' +
    'change which teaching material is injected.'
  if (cap.ok !== true) {
    return (
      head +
      ` ⚠️ UNAVAILABLE right now: ${cap.reason} — calling this tool will be rejected with the same reason, ` +
      'and the reason is also written into runtime/expression.md. Tell the user the portrait cannot be driven ' +
      'until that is fixed.'
    )
  }
  const parts = [head]
  if (cap.namedPath) {
    parts.push(
      `Path A — this model (${cap.model}) HAS ${cap.names.length} named expressions, and these are the only ` +
        `legal values of \`expression\`: ${cap.names.join(' / ')}. ${readabilityClause(cap, 'named-expression')}`,
    )
  } else {
    parts.push(
      `Path A — this model (${cap.model}) has NO named expressions (Expressions is empty), so \`expression\` ` +
        'is NOT usable for it.',
    )
  }
  if (cap.paramPath) {
    // 🔴 EXPR-5 实测更正（改前那句是 "Values are plain numbers; the renderer clamps them to the model's
    //    own range."）。逐条说清为什么改，每条都有实测／源码依据：
    //    ① **夹取确实发生，但它是静默的**：框架 `CubismModel.setParameterValueByIndex()`
    //       非 repeat 参数走 `getParameterClampValue()` → `CubismMath.clamp(value, min, max)`
    //       （`vendor/CubismWebFramework/src/model/cubismmodel.ts`），而**面板读数与状态文件都不体现
    //       "你要 3、实际是 2"**。本轮客户端把这一步变成显式的、并写进面板 → 描述里补上"会告诉你"。
    //    ② **值域是逐参数的**（实测 13 个模型 754 个参数：Haru `ParamEyeLOpen` 0…2、
    //       `ParamAngleX` ±30、`ParamArmLB` −1…5）→ 原文的 "them / the model's own range"
    //       容易被读成"整个模型一个范围"，改成 "that parameter's own range"。
    //    ③ **漏了嘴型通道那一条**：那个参数不归 `face` 管。实测（EXPR-4 会话 B）模型把
    //       `ParamMouthOpenY=0.6` 写进 `face`，客户端报 `skippedLipSync`，从模型里读回的是
    //       嘴型通道当时的 0.0432 —— 不写清就是"描述与实测不符"。
    const mouth = Array.isArray(cap.lipSyncParameters)
      ? cap.lipSyncParameters.filter((id) => typeof id === 'string' && id !== '')
      : []
    parts.push(
      `Path B — this model exposes ${cap.parameters.length} parameters (${describeDimensions(cap.dimensions)}), ` +
        `and these are the only legal keys of \`face\`: ${cap.parameters.join(' / ')}. ` +
        "Values are plain numbers; the renderer clamps each one to that parameter's own range in the model " +
        'and tells you in the panel when it had to change a value. ' +
        (mouth.length === 0
          ? ''
          : `One exception: ${mouth.join(' / ')} belongs to the mouth channel, so \`face\` does NOT drive it — ` +
            'the renderer skips it and reports that too. ') +
        readabilityClause(cap, 'face-parameters'),
    )
  } else {
    parts.push('Path B — this model exposes no parameter list, so `face` is NOT usable for it.')
  }
  if (cap.motionPath) {
    parts.push(
      `Path C — this model has ${cap.motions.length} motion groups, and these are the only legal values of ` +
        `\`motion\`: ${cap.motions.join(' / ')}. A motion is a short authored clip (it ends by itself), not a ` +
        'sustained face state. ' +
        readabilityClause(cap, 'motion'),
    )
  } else {
    parts.push('Path C — this model has no motion groups, so `motion` is NOT usable for it.')
  }
  parts.push(
    `The engine's own preference for this model is ${cap.path ?? '(no usable way)'}, chosen by how readable the ` +
      'names are: a name that tells you what it is (Smile, Sad, Surprise, ParamEyeLOpen) wins; index-style ' +
      'names such as F01 or expr_3 are USABLE but not preferred; a way whose names carry no meaning at all ' +
      `comes last. Ties fall back to reliability: ${EXPRESSION_PATH_TIEBREAK.join(' > ')}. ` +
      `Here: ${describePathChoice(cap.pathRanking, cap.path)}.`,
  )
  return parts.join(' ')
}

/**
 * 一条路的"名字读得懂吗"英文短句（工具描述用；与 `pathRanking` 同一份分数，不另立判据）。
 * @param {{pathRanking?:Array<object>}} cap
 * @param {string} path
 * @returns {string}
 */
function readabilityClause(cap, path) {
  const entry = (cap.pathRanking ?? []).find((item) => item.path === path)
  if (entry === undefined) return ''
  const verdict =
    entry.kind === 'semantic'
      ? 'These names are READABLE — you can tell what each one is from its name.'
      : entry.kind === 'opaque'
        ? 'These names are index-style: the name does not tell you what it is, so read them as positions, ' +
          'not meanings. Usable, but the engine prefers a more readable way when this model has one.'
        : 'These names carry no meaning at all (no letters), so this way is the last resort.'
  return `${verdict} (readability ${entry.score.toFixed(2)}: ${entry.semantic} readable / ${entry.opaque} index-style / ${entry.nameless} nameless)`
}

/**
 * `classroom_status` 里表情那一截的白话（工具侧口径；机器可读口径在 runtime/expression.md）。
 * @param {{expression:string, expressionFace:string, expressionOrigin:string}} value
 */
export function describeExpressionStatus(value) {
  if (value.expressionOrigin === 'off') return '通道未启用（未配置能力来源）'
  if (value.expressionOrigin === 'unavailable') return '不可用（三种表达手段都没有可选项）'
  const what =
    value.expression !== '' ? value.expression : value.expressionFace !== '' ? value.expressionFace : value.expressionMotion !== '' ? value.expressionMotion : '（无）'
  const how = value.expression !== '' ? '命名表情' : value.expressionFace !== '' ? '逐参数' : value.expressionMotion !== '' ? '动作' : '？'
  return `${what}（${how}·${value.expressionOrigin === 'teacher' ? '老师指定' : '引擎兜底'}）`
}

/**
 * 表情的**渠道纪律**（系统段注入；纯数据，放这里是为了能被单测逐条断言）。
 *
 * 🔴 为什么需要它（EXPR-1 真会话实证）：只挂工具、不给纪律时，**两个回合里一次都没调**
 *    `classroom_express`（会话 A 的工具序列：read×9 → set_phase → draw → animate_template →
 *    set_phase → draw；`classroom_express` **0 次**）。这与 ANIM-ORCH 的实测同型——
 *    "只挂工具、内容侧不提"时工具不会被调用。故照动画那一套补一段**引擎自产的纪律**
 *    （只在该通道启用时注入；未配置＝这一节根本不存在）。
 * 🔴 口径（用户拍板：*"表情不规定，让 AI 自己决定和控制吧"*）：**不规定映射**，
 *    只写"什么时候该说、怎么说、不说的后果、写错的后果"。顺序＝先说后调。
 */
export const EXPRESSION_DISCIPLINE_RULES = [
  '本课有立绘，**表情由你自己决定**：引擎**不按环节规定表情**，只在你不说的时候替你猜一个。',
  '**讲到情绪色彩明确的那一步，就把表情说出来**：调 `classroom_express`，与讲解在同一个回合里指定。',
  '   「这里是鼓励／是追问／是提醒他错了／是收束」这类时刻都算；不必每回合都调。',
  '**三条并列手段，一次只给一条**（本模型实际有哪几条，工具描述里写着）：',
  '   · 有命名表情 → 给 `expression`（名字**必须**来自工具描述里那份清单）；',
  '   · 没有命名表情但有脸部参数（例如初音ミク）→ 给 `face`（`参数 id → 数值`）；',
  '   · 只有动作组（分层图转出来的模型）→ 给 `motion`（动作组名，如 `Surprise`）。',
  '   引擎自己会挑**名字读得懂**的那条：`Smile`／`Surprise`／`ParamEyeLOpen` 这类**有语义的优先**；',
  '   `F01`／`expr_3` 这类**编号能用但不优选**（有些模型只有它，那就照用）；没有名字可读的排最后。',
  '   你显式给哪条就用哪条——工具描述里写着这个模型实际有哪几条、各自的清单是什么。',
  '**不指定就是兜底**：引擎拿你**刚说过的那段话**去猜一个情绪（关键词匹配，是**推测**）。',
  '   所以想让表情跟得上你要表达的东西，就自己指定；本回合指定过，兜底不会覆盖你。',
  '   兜底**在你这一回合里每步重算**（拿你这一回合已经说出口的文字），所以它会随着你往下讲而更新；',
  '   但它永远只是"你刚说过的话"的推测——要准确就自己指定。',
  '**顺序**：先把这一步讲给学生听，再调工具——不要让它成为本回合的第一个动作。',
  '**名字或参数名写错会被拒**：引擎报错并列出本模型真正有的清单，照那份清单重试即可。',
]

/**
 * `classroom_express` 的**工具参数规格**（纯数据，放在纯逻辑层是为了能被单测直接断言）。
 *
 * 🔴 为什么把它从 index.mjs 挪出来：宿主 `dsh-tools` 的 schema 编译器对 `type: 'object'`
 *    **强制要求显式的 `additionalProperties`**（逐字报 `…additionalProperties must be explicitly
 *    true or false`）——这条是**真会话第一次跑就炸出来的**（装载即失败 `UNSUPPORTED_SCHEMA`）。
 *    规格放在这里，单测就能在不 import 宿主包的前提下逐节点断言（见 test/expression.test.mjs 的
 *    「参数规格自检」一条），不必再靠"跑一次真会话"才发现。
 */
export function expressToolParameters() {
  return {
    expression: {
      type: 'string',
      description:
        'Path A — the name of a NAMED expression of the current portrait model. Only the names listed ' +
        'in this tool description exist; any other name is rejected with the list of legal names. ' +
        'Use it only for models that have named expressions (path B is the alternative, not a fallback).',
    },
    motion: {
      type: 'string',
      description:
        'Path C — the name of a MOTION GROUP of the current portrait model (e.g. Surprise, Smile). Only the ' +
        'groups listed in this tool description exist; any other name is rejected with the list of legal ' +
        'groups. This is the ONLY path for models whose art was converted from layered images (0 named ' +
        'expressions, no extra face parameters, but a set of authored motion groups).',
    },
    face: {
      type: 'object',
      // 参数名是**运行期从能力发现拿的**，没法静态列成 properties → 只能自由键（true）；
      // 键的合法性由 expressionstore.specify 按清单校验。
      additionalProperties: true,
      description:
        'Path B — drive the face directly by writing model parameters: an object of ' +
        '`parameter id -> number`. Every id must be one of the parameters this model actually has ' +
        '(listed in this tool description); an unknown id is rejected with the full parameter list. ' +
        'This is the ONLY path for models with no named expressions (e.g. Hatsune Miku, which has 0 ' +
        'named expressions but 17 face parameters). Give either `expression` or `face`, never both.',
    },
  }
}

/**
 * 在一段文本里找 `<key>: <值>` 机器可读行（允许前导 `-`／`*` 与缩进，与 manifest.mjs 同口径）。
 * @param {string} text
 * @param {string} key
 * @returns {string|null} 值（未找到 → null；找到但无值 → 空字符串）
 */
export function parseStateLine(text, key) {
  const pattern = new RegExp(`^\\s*-?\\s*${escapeRegExp(key)}\\s*:\\s*(.*)$`)
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const matched = pattern.exec(line)
    if (matched !== null) return matched[1]
  }
  return null
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function oneLine(value) {
  return String(value).replace(/\s+/g, ' ').trim()
}
