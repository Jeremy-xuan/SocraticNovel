// lib/expressionstore.mjs — EXPR-1 表情链路的**IO 与编排层**
//
// 与 lib/expression.mjs 的分工：那边是纯逻辑（正则表解释、能力清单取值、状态文本渲染），
// 这边碰盘与碰宿主：读渲染侧的能力发现产物、写 `runtime/expression.md`、挂 turn-stopping 兜底。
//
// ── 四条口径（用户拍板 + 主代理补充实测 + 本项目教训）──────────────────────
// ① **首选是老师自己指定**：`classroom_express` 工具（注册在 index.mjs），
//    三条**并列**路径 —— 命名表情 `expression` / 逐参数 `face` / 动作 `motion`；
//    非法名字、非法参数名、非法动作组名 → **报错并给出可用清单**（不许静默忽略）。
// ② **三条路并列，不是主/备**（三种真实模型各只有一条路可用）：
//    · 官方初音ミク 两版：命名表情 = 0，但有 17 个脸部参数 → 只有逐参数；
//    · 分层立绘转出的 `.moc3`（image2live2d / psd2live）：0 表情、17 组动作 → 只有动作；
//    · 官方样本（Haru 等）：三条都有。
//    → 只做一条会让"用户最可能选的模型"或"我们自己的产线产物"没有表情。
// ③ **兜底是推测**：老师本回合没指定时，用它**自己刚说过的话**走 13 条正则表推一个情绪，
//    再落到该模型实际有的东西上（有命名表情 → 名字；没有 → 逐参数）。
//    关键词 ≠ 情绪，所以 origin 是 `fallback`，**优先级低于 teacher**。
//    🔴 **EXPR-2 改定：每个 pre-step 重算**（旧版只在 `agent/turn-stopping` 算一次 →
//       表情比"刚说完的那句话"**晚一个回合边界**才生效，跟不上课堂）。输入只有三样，都是"本回合已有的"：
//         ① 本回合（`payload.turn`）的 `assistant/message` 文字块，按出现顺序取**最后一段**；
//         ② 本会话内 `current`（本回合老师是否已用 `classroom_express` 显式指定过）；
//         ③ 渲染侧能力发现产物（只读，按 mtime＋size 缓存）。
//       **不读**：下一回合的文字、学生的消息、教材正文、相位/进度文件——**不猜下一句**。
//       `turn-stopping` 那一处**保留**：回合结束时本回合文字才齐，用它把最后一段也算进去（两处同一份
//       核心逻辑，都幂等、都受"不许覆盖老师"约束）。
// ④ **能力发现给不出任何可选项时明说不可用**：写 `expression_origin: unavailable` ＋
//    `expression_note: <原因>`，工具调用也报同样的原因——**不静默什么都不做**。
// ⑤ **`expression_note` 始终出现**（FREQ-PARITY，2026-09-24）：末段固定是那句
//    「本文件记录的是请求值（实际值由渲染侧夹取后生效）」——引擎侧**不夹取**（权威值域只有
//    渲染侧有），读这个状态文件的第三方必须知道看到的是请求值。渲染口径在 lib/expression.mjs
//    的 `EXPRESSION_NOTE_REQUEST_VALUE`（单一维护点）。

import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import {
  EXPRESSION_STATE_FILE,
  emotionFor,
  expressionCapabilityFor,
  expressionForEmotion,
  faceParamsForEmotion,
  describeDimensions,
  motionForEmotion,
  parseCapabilityJson,
  pickPath,
  readExpressionTable,
  renderExpressionState,
  renderFaceParams,
} from './expression.mjs'

/** 本模块写进 runtime/ 的文件名（导出给测试与接线说明引用）。 */
export const EXPRESSION_FILE = EXPRESSION_STATE_FILE

async function loadHostAtomicWrite() {
  const mod = await import('@deepseek-ai/dsh-atomic-write')
  if (typeof mod?.writeFileAtomic !== 'function') {
    throw new Error('@deepseek-ai/dsh-atomic-write 未导出 writeFileAtomic')
  }
  return { writeFileAtomic: mod.writeFileAtomic }
}

/**
 * 从 session 事件里取**本回合助教说过的文字块**（纯函数）。
 *
 * 🔴 判据是实测事实（`取证_S1_turn-stopping与sessionProjections_2026-09-23.md` 第 468 行逐字）：
 *    `assistant/message` 事件的 `data.turn` 就是回合号，`data.message.content` 是
 *    `[{type:'text'|'tool-call',…}]` 混合数组 → **不必切 turn/start..turn/end 区间**。
 *    （与 lib/postclass.mjs 的切片法不同：那边要的是「学生说了什么」，本处要的是「老师说了什么」；
 *      两处刻意不互相依赖，避免一个功能的改动牵动另一个。）
 * @param {readonly object[]} events - `session.snapshotEvents()` 的结果
 * @param {number} turn
 * @returns {string[]} 按出现顺序的文字块（不含工具调用）
 */
export function assistantTextsOfTurn(events, turn) {
  const out = []
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type !== 'assistant/message') continue
    if (event?.data?.turn !== turn) continue
    const content = event?.data?.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') out.push(block.text)
    }
  }
  return out
}

/**
 * 建一个表情状态仓。index.mjs 在装载后建一次，工具与 turn-stopping 共用同一个实例
 * （所以「同一回合重复指定以最后一次为准」是同一个闭包里的赋值，天然幂等）。
 *
 * @param {object} opts
 * @param {string} [opts.capabilityFile] - 渲染侧能力发现产物的**绝对路径**；缺省＝表情通道关闭
 * @param {string} [opts.model] - 模型名（`out/models/<名>/`）；从产物里挑哪个模型的清单
 * @param {() => string|null} [opts.runtimeDir] - 教室 runtime/ 目录（每回合求值）
 * @param {() => number} [opts.getTurn] - 引擎自维护的回合号
 * @param {(msg:string)=>void} [opts.log]
 * @param {object} [opts.atomicWrite] - 注入的原子写（测试用）
 */
export function createExpressionStore(opts = {}) {
  const log = opts.log ?? (() => {})
  const table = readExpressionTable()
  const model = typeof opts.model === 'string' && opts.model !== '' ? opts.model : null
  const rawFile = typeof opts.capabilityFile === 'string' && opts.capabilityFile !== '' ? opts.capabilityFile : null
  // 🔴 相对路径**当场报错**：插件拿不到可靠的工作区根，靠 cwd 猜＝静默指向别的文件。
  //    （这是部署配置错，不是运行期状态，所以早失败；运行期的"文件读不到/模型没表情"则走"明说不可用"。）
  if (rawFile !== null && !isAbsolute(rawFile)) {
    throw new Error(
      `config.expression.capabilityFile 必须是**绝对路径**（得到 ${JSON.stringify(rawFile)}）：` +
        '引擎没有可靠的工作区根可作基准，相对路径会静默指向别处',
    )
  }
  const capabilityFile = rawFile
  const getTurn = opts.getTurn ?? (() => 0)
  const runtimeDirOpt = opts.runtimeDir ?? null

  /** 渲染侧能力发现产物的缓存（按 mtime＋size 失效：换模型/重跑发现后自动跟上）。 */
  let capabilityCache = null
  let ioPromise = null
  /** 本会话内最后一次落定的表情，`classroom_status` 与幂等判据都读它。 */
  let current = null
  /** 上一次**实际写盘**的全文（内容没变就不重写：每个 pre-step 都会走这条路，不许抖动）。 */
  let lastWritten = null
  /**
   * 最近一次 pre-step／turn-stopping 看到的**宿主回合号**。
   * 🔴 为什么表情自己维护一份：兜底要按回合号去 session 事件里找"本回合老师说过的话"
   *    （`assistant/message` 的 `data.turn` 是**宿主**的回合号），而 `opts.getTurn()` 给的是
   *    引擎自己的计数器（`phase.turnCount`，装载时从 0 起算）——两者在"装载后从第 N 回合接着上"
   *    的会话里会错开。若老师指定记一个号、兜底拿另一个号去比，**"兜底不覆盖老师"这条就会失效**
   *    （兜底会把老师刚指定的表情冲掉）。故两者统一用宿主回合号；钩子没跑过时退回 `getTurn()`。
   */
  let hostTurn = null

  function resolveRuntimeDir() {
    const value = typeof runtimeDirOpt === 'function' ? runtimeDirOpt() : runtimeDirOpt
    return typeof value === 'string' && value !== '' ? value : null
  }

  /** 此刻的"本回合"号：优先用宿主给的（钩子见过就一定有），没见过才退回引擎计数器。 */
  function turnOfNow() {
    return Number.isInteger(hostTurn) ? hostTurn : getTurn()
  }

  function resolveIo() {
    if (opts.atomicWrite) return Promise.resolve(opts.atomicWrite)
    ioPromise ??= loadHostAtomicWrite()
    return ioPromise
  }

  /**
   * 读渲染侧能力发现产物 → 该模型实际有的**两条路**的清单。**每次都问盘**（mtime 变了就重读），
   * 因为渲染侧换模型是运行期的事，缓存到装载时刻会让老师拿到过期的名字。
   */
  async function capability() {
    if (capabilityFile === null) {
      return {
        ok: false,
        names: [],
        parameters: [],
        dimensions: [],
        namedPath: false,
        paramPath: false,
        reason:
          '部署未配置表情能力来源（profile 的 socratic-engine config.expression.capabilityFile）' +
          '→ 引擎无从知道这个模型有哪些表情/参数',
        model,
        file: null,
      }
    }
    let info
    try {
      info = await stat(capabilityFile)
    } catch (cause) {
      return {
        ok: false,
        names: [],
        parameters: [],
        dimensions: [],
        namedPath: false,
        paramPath: false,
        reason: `读不到渲染侧能力发现产物 ${capabilityFile}（${cause?.code ?? cause?.message ?? cause}）`,
        model,
        file: capabilityFile,
      }
    }
    const stamp = `${info.mtimeMs}:${info.size}`
    if (capabilityCache === null || capabilityCache.stamp !== stamp) {
      let parsed
      try {
        parsed = parseCapabilityJson(await readFile(capabilityFile, 'utf8'))
      } catch (cause) {
        return {
          ok: false,
          names: [],
          parameters: [],
          dimensions: [],
          namedPath: false,
          paramPath: false,
          reason: cause?.message ?? String(cause),
          model,
          file: capabilityFile,
        }
      }
      capabilityCache = { stamp, parsed }
    }
    return { ...expressionCapabilityFor(capabilityCache.parsed, model), model, file: capabilityFile }
  }

  /**
   * 把一条状态渲染＋原子写进 `runtime/expression.md`。内容与上次相同 → 不写（幂等）。
   * 任何失败都返回结构化的原因，**不抛**（turn-stopping 抛错会打断整个回合）。
   */
  async function persist(state) {
    const runtimeDir = resolveRuntimeDir()
    if (runtimeDir === null) {
      return { persisted: false, file: null, note: '教室 runtime/ 目录尚未确定', changed: false }
    }
    const file = join(runtimeDir, EXPRESSION_FILE)
    const text = renderExpressionState(state)
    if (text === lastWritten) return { persisted: true, file, note: `内容未变，未重写 ${file}`, changed: false }
    try {
      const io = await resolveIo()
      await io.writeFileAtomic(file, text, { mode: 0o600 })
      lastWritten = text
      return { persisted: true, file, note: `已写 ${file}`, changed: true }
    } catch (cause) {
      return { persisted: false, file, note: `写 ${file} 失败：${cause?.message ?? cause}`, changed: false }
    }
  }

  /**
   * 老师用 `classroom_express` 指定表情。**两条并列路径**，二选一：
   *   · `expression` —— 命名表情（走 `model.expression(name)`）
   *   · `face`       —— 逐参数直驱（`{参数id: 数值}`）
   * 🔴 非法名字/非法参数名 → **抛错并列出可用清单**（不静默忽略、不回落兜底）。
   * 🔴 同一回合重复调用以**最后一次为准**（直接覆盖 current）。
   */
  async function specify(args) {
    const wantsName = typeof args?.expression === 'string' && args.expression.trim() !== ''
    const wantsFace = args?.face !== null && typeof args?.face === 'object' && !Array.isArray(args.face)
    const wantsMotion = typeof args?.motion === 'string' && args.motion.trim() !== ''
    const given = [wantsName, wantsFace, wantsMotion].filter(Boolean).length
    if (given > 1) {
      throw new Error(
        'classroom_express 的 `expression`／`face`／`motion` 是**三条并列手段**，一次只能给一条：' +
          '有命名表情给 `expression`，没有命名表情但有脸部参数（如初音ミク）给 `face`，' +
          '只有动作组（分层图转出来的模型）给 `motion`。',
      )
    }
    if (given === 0) {
      throw new Error(
        'classroom_express 需要 `expression`（命名表情名）／`face`（参数 id → 数值）／`motion`（动作组名）其中之一',
      )
    }
    const cap = await capability()
    if (!cap.ok) {
      throw new Error(
        `表情通道不可用，这次指定**没有生效**：${cap.reason}\n` +
          '（可用清单来自渲染侧能力发现；本引擎**不硬编码**任何表情名、参数名或动作组名）',
      )
    }
    const turn = turnOfNow()
    // 三条路的可用性一句话（每次报错都带上，模型不必再猜）
    const availText =
      `本模型（${cap.model}）的表达手段：命名表情 ${cap.names.length} 个` +
      `${cap.namedPath ? `（${cap.names.join(' / ')}）` : '（无）'}｜` +
      `脸部参数 ${cap.parameters.length} 个（${describeDimensions(cap.dimensions)}）｜` +
      `动作组 ${cap.motions.length} 个${cap.motionPath ? `（${cap.motions.join(' / ')}）` : '（无）'}`

    // ── 路径 A：命名表情 ────────────────────────────────────────────────────
    if (wantsName) {
      const name = args.expression.trim()
      if (!cap.namedPath) {
        throw new Error(
          `本模型**没有命名表情**（能力发现里 Expressions 为空）→ 按名字设表情这条路对它不成立。\n` +
            `${availText}\n请改用 \`face\`（逐参数）或 \`motion\`（动作组）。`,
        )
      }
      if (!cap.names.includes(name)) {
        throw new Error(
          `没有命名表情 ${JSON.stringify(name)}：本模型实际只有这些 —— ${cap.names.join(' / ')}\n` +
            `（清单来自渲染侧能力发现产物 ${cap.file}；请从上面这些名字里挑一个重试）`,
        )
      }
      current = { turn, path: 'named-expression', expression: name, face: {}, motion: null, origin: 'teacher', emotion: null }
      const written = await persist(stateOf(current, cap))
      log(`表情：老师指定命名表情 ${name}（第 ${turn} 回合，共 ${cap.names.length} 个可选）｜${written.note}`)
      return resultOf(current, cap, written, `命名表情 ${cap.names.join(' / ')}`, cap.names.length)
    }

    // ── 路径 C：动作组 ──────────────────────────────────────────────────────
    if (wantsMotion) {
      const group = args.motion.trim()
      if (!cap.motionPath) {
        throw new Error(
          `本模型**没有动作组**（能力发现里 motionGroups 为空）→ 用动作表达这条路对它不成立。\n${availText}`,
        )
      }
      if (!cap.motions.includes(group)) {
        throw new Error(
          `没有动作组 ${JSON.stringify(group)}：本模型实际只有这些 —— ${cap.motions.join(' / ')}\n` +
            `（清单来自渲染侧能力发现产物 ${cap.file}；请从上面这些组名里挑一个重试）`,
        )
      }
      current = { turn, path: 'motion', expression: null, face: {}, motion: group, origin: 'teacher', emotion: null }
      const written = await persist(stateOf(current, cap))
      log(`表情：老师指定动作 ${group}（第 ${turn} 回合，共 ${cap.motions.length} 个动作组可选）｜${written.note}`)
      return resultOf(current, cap, written, cap.motions.join(' / '), cap.motions.length)
    }

    // ── 路径 B：逐参数直驱 ──────────────────────────────────────────────────
    const wanted = args.face
    const ids = Object.keys(wanted)
    if (ids.length === 0) throw new Error('classroom_express 的 `face` 是空对象（至少给一个「参数 id → 数值」）')
    if (!cap.paramPath) {
      throw new Error(`本模型的能力发现里**没有参数集** → 逐参数直驱不成立。\n${availText}`)
    }
    for (const id of ids) {
      if (!cap.parameters.includes(id)) {
        throw new Error(
          `本模型（${cap.model}）没有参数 ${JSON.stringify(id)}。按维度可用的是 —— ${describeDimensions(cap.dimensions)}\n` +
            `全部参数（${cap.parameters.length} 个）：${cap.parameters.join(' / ')}`,
        )
      }
    }
    const face = {}
    for (const id of ids) {
      const value = wanted[id]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`参数 ${id} 的值必须是有限数值（得到 ${JSON.stringify(value)}）`)
      }
      face[id] = value
    }
    current = { turn, path: 'face-parameters', expression: null, face, motion: null, origin: 'teacher', emotion: null }
    const written = await persist(stateOf(current, cap))
    log(
      `表情：老师指定逐参数（第 ${turn} 回合）${ids.map((id) => `${id}=${face[id]}`).join(' ')}｜${written.note}`,
    )
    return resultOf(current, cap, written, describeDimensions(cap.dimensions), cap.parameters.length)
  }

  /**
   * 兜底：本回合老师**没有**指定表情时，用它自己刚说过的话推一个情绪 → 落到该模型实际有的东西上。
   * 🔴 **EXPR-2：每个 pre-step 调一次**（`when='pre-step'`），回合结束再调一次（`when='turn-stopping'`）
   *    把本回合最后一段文字也算进去。**同一个核心逻辑**，所以两处都幂等、都受"不覆盖老师"约束。
   * @param {{turn:number, events:readonly object[], when?:string}} input
   */
  async function fallback({ turn, events, when = 'turn-stopping' }) {
    /** 日志里标明这一趟是谁触发的（pre-step 每步都会走，回合末再走一次）。 */
    const at = when === 'pre-step' ? '每步重算' : '回合末'
    if (!Number.isInteger(turn)) return { action: 'skipped', expression: null, face: {}, motion: null, emotion: null, note: '回合号非法' }
    // 🔴 老师本回合显式指定过 → 兜底**不许覆盖**（teacher 优先级高于 fallback，这是写死的口径）
    if (current !== null && current.turn === turn && current.origin === 'teacher') {
      return {
        action: 'kept-teacher',
        expression: current.expression,
        face: current.face,
        motion: current.motion,
        emotion: null,
        note: `第 ${turn} 回合老师自己指定了（${current.path}），兜底不覆盖`,
      }
    }
    const texts = assistantTextsOfTurn(events, turn)
    if (texts.length === 0) {
      return { action: 'skipped', expression: null, face: {}, motion: null, emotion: null, note: `第 ${turn} 回合老师没有文字（无依据可推）` }
    }
    // 🔴 用**本回合最后一段**文字（＝"它自己刚说的话"）。
    //    ⚠️ sakiko 是逐句判、表情跟着最后一句走；我们只取最后一段文字块，不做分句（见报告待确认）。
    const said = texts[texts.length - 1]
    const emotion = emotionFor(said, table)
    const cap = await capability()
    if (!cap.ok) {
      const written = await persist({ path: null, expression: null, face: {}, motion: null, origin: 'unavailable', emotion: null, turn, capability: 'unavailable', model: cap.model, note: cap.reason })
      log(`表情（${at}）：第 ${turn} 回合不可用（${cap.reason}）｜${written.note}`)
      return { action: 'unavailable', expression: null, face: {}, motion: null, emotion: null, note: cap.reason }
    }

    // 🔴 三条路按**名字可读性**选（同分才按可靠性次序），理由与计分见 lib/expression.mjs 的 pathRanking。
    const path = pickPath(cap)

    if (path === 'named-expression') {
      const picked = expressionForEmotion(emotion, cap.names, table)
      current = { turn, path, expression: picked.name, face: {}, motion: null, origin: 'fallback', emotion }
      const written = await persist(stateOf(current, cap))
      log(
        `表情（${at}）：第 ${turn} 回合兜底 → 情绪 ${emotion} → 槽位 ${picked.slot} → 命名表情 ${picked.name}` +
          `（本模型 ${cap.names.length} 个命名表情）｜${written.note}`,
      )
      return { action: 'fallback', expression: picked.name, face: {}, motion: null, emotion, note: written.note }
    }

    if (path === 'face-parameters') {
      // 🔴 兜底**排除嘴型通道（LipSync）参数**：那一个参数归嘴型通道所有，兜底再写一份
      //    ＝两个写者抢同一个参数（本项目在嘴型上踩过 `addParameterValueById` 是累加、会叠加的坑）。
      //    老师用 `face` **显式**指定时不排除（那是他的明确决定），见 specify。
      const picked = faceParamsForEmotion(emotion, cap.parameters, table, { exclude: cap.lipSyncParameters })
      // 🔴 「选了这条路却一个参数都写不出」**不许静默**（EXPR-2 真会话实证：Haru 的驼峰参数名
      //    当时与 faceRoles 的正则对不上 → 落盘成空的 `expression_face: -`，而 origin 还写着 fallback
      //    ＝客户端以为有表情、实际什么都没动）。判据分两种：
      //      · 该槽位本来就**没有角色要写**（`neutral` 的 slotFace 是空对象）→ 这是刻意的"不动脸"，
      //        照旧记 fallback；
      //      · 该槽位**要写角色、但一个都没匹配上** → 明说不可用 ＋ 列出缺哪些角色。
      const wantedRoles = Object.keys(table.slotFace[picked.slot] ?? {})
      if (wantedRoles.length > 0 && Object.keys(picked.params).length === 0) {
        const note =
          `本模型（${cap.model}）的逐参数路**一个参数都没匹配上**情绪 ${emotion} 的槽位 ${picked.slot}` +
          `：缺这些角色 ${picked.missingRoles.join(',') || '（无）'}` +
          `（本模型的参数：${cap.parameters.join(' / ')}）`
        const written = await persist({ path: null, expression: null, face: {}, motion: null, origin: 'unavailable', emotion: null, turn, capability: 'ok', model: cap.model, names: cap.names, motions: cap.motions, dimensions: cap.dimensions, note })
        log(`表情（${at}）：第 ${turn} 回合兜底落空 —— ${note}｜${written.note}`)
        return { action: 'unavailable', expression: null, face: {}, motion: null, emotion, note }
      }
      current = { turn, path, expression: null, face: picked.params, motion: null, origin: 'fallback', emotion }
      const written = await persist(stateOf(current, cap))
      log(
        `表情（${at}）：第 ${turn} 回合兜底 → 情绪 ${emotion} → 槽位 ${picked.slot} → 逐参数 ` +
          `${Object.entries(picked.params).map(([id, v]) => `${id}=${v}`).join(' ') || '（无可写参数）'}` +
          (picked.missingRoles.length === 0 ? '' : `｜本模型缺这些角色：${picked.missingRoles.join(',')}`) +
          (picked.skippedIds.length === 0 ? '' : `｜跳过嘴型通道参数：${picked.skippedIds.join(',')}`) +
          `（本模型无命名表情，${cap.parameters.length} 个参数）｜${written.note}`,
      )
      return { action: 'fallback', expression: null, face: picked.params, motion: null, emotion, note: written.note }
    }

    // path === 'motion'（三条里只剩这一条：只有动作组的模型，如分层图转出来的 .moc3）
    const picked = motionForEmotion(emotion, cap.motions, table)
    if (picked.group === null) {
      // 🔴 匹配不到就**明说这次用不了**（不猜、不硬塞一个动作、不静默什么都不做）
      const note =
        `本模型只有"动作"这条路，但没有任何动作组匹配情绪 ${emotion}` +
        `（本模型的动作组：${cap.motions.join(' / ')}；表情表里该槽位的组名线索：${table.motionRoles[picked.slot].join(' / ')}）`
      const written = await persist({ path: null, expression: null, face: {}, motion: null, origin: 'unavailable', emotion: null, turn, capability: 'ok', model: cap.model, names: cap.names, motions: cap.motions, dimensions: cap.dimensions, note })
      log(`表情（${at}）：第 ${turn} 回合兜底落空 —— ${note}｜${written.note}`)
      return { action: 'unavailable', expression: null, face: {}, motion: null, emotion, note }
    }
    current = { turn, path, expression: null, face: {}, motion: picked.group, origin: 'fallback', emotion }
    const written = await persist(stateOf(current, cap))
    log(
      `表情（${at}）：第 ${turn} 回合兜底 → 情绪 ${emotion} → 槽位 ${picked.slot} → 动作 ${picked.group}` +
        `（匹配线索 ${picked.pattern}；本模型 ${cap.motions.length} 个动作组）｜${written.note}`,
    )
    return { action: 'fallback', expression: null, face: {}, motion: picked.group, emotion, note: written.note }
  }

  /** 把"当前落定"翻译成 renderExpressionState 的入参（三处 persist 共用一处口径）。 */
  function stateOf(cur, cap) {
    return {
      path: cur.path,
      expression: cur.expression,
      face: cur.face,
      motion: cur.motion,
      origin: cur.origin,
      emotion: cur.emotion,
      turn: cur.turn,
      capability: 'ok',
      model: cap.model,
      names: cap.names,
      motions: cap.motions,
      dimensions: cap.dimensions,
    }
  }

  /** 工具返回值（机器可读字段，与 index.mjs 的 output.schema 一一对应）。 */
  function resultOf(cur, cap, written, availableText, availableCount) {
    return {
      path: cur.path,
      expression: cur.expression ?? '',
      face: renderFaceParams(cur.face ?? {}),
      motion: cur.motion ?? '',
      origin: cur.origin,
      emotion: cur.emotion ?? '',
      turn: cur.turn,
      model: cap.model ?? '',
      available: availableText,
      availableCount,
      dimensions: describeDimensions(cap.dimensions),
      parameterCount: cap.parameters.length,
      motionCount: cap.motions.length,
      persisted: written.persisted,
      file: written.file ?? '',
      note: written.note,
    }
  }

  /**
   * 挂两个钩子（都**不许抛错、不许长阻塞**）：
   *   · `agent/pre-step` —— **每步重算**兜底（EXPR-2）；这一步的老师文字已经落进 session log。
   *   · `agent/turn-stopping` —— 回合末再算一次（本回合最后一段文字这时才齐）。
   * @param {object} ctx - Cordis 上下文
   */
  function register(ctx) {
    if (typeof ctx?.on !== 'function') return { enabled: false, reason: 'ctx.on 不可用' }

    /** 一趟重算：先记住"本回合"是哪个宿主回合号，再拿本回合已有的文字去推。 */
    async function recomputeFrom(payload, when) {
      try {
        if (payload?.signal?.aborted) return
        if (!Number.isInteger(payload?.turn)) return
        hostTurn = payload.turn
        const session = payload?.agent?.session
        if (!session || typeof session.snapshotEvents !== 'function') {
          log(`表情兜底（${when}）：第 ${payload.turn} 回合取不到 session，跳过`)
          return
        }
        await fallback({ turn: payload.turn, events: session.snapshotEvents(), when })
      } catch (cause) {
        // 兜底：表情永远不得打断会话
        log(`表情兜底异常（已吞掉）：${cause?.message ?? cause}`)
      }
    }

    ctx.on('agent/turn-stopping', (payload) => recomputeFrom(payload, 'turn-stopping'))

    // 🔴 EXPR-2：兜底从"只在回合末算一次"改成**每个 pre-step 重算**。
    //    旧版的问题：回合末才算 → 表情比"刚说完的那句话"晚一个回合边界才生效，跟不上课堂。
    //    新版：pre-step 时本回合**已经说出口**的文字就在 session 里（`assistant/message` 带 `data.turn`），
    //    算出来的值当步就落到 `runtime/expression.md`，客户端在回合内就能读到。
    // 🔴 **必须把 decision 原样传下去**：cordis 的 waterfall 语义是"不调 `next()` 的监听器会**否决**
    //    整条链（含宿主内建的 enter 决策）"——而这条链上还挂着"本回合注入哪些材料"那个监听器，
    //    吞掉它就等于把会话弄坏。故本监听器只做"先让链走完，再顺手重算"，返回值原样透传。
    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      if (decision?.kind === 'enter') await recomputeFrom(payload, 'pre-step')
      return decision
    })

    return { enabled: true, reason: '' }
  }

  return {
    capability,
    specify,
    fallback,
    register,
    /** 供 `classroom_status` 用的快照（不碰盘）。 */
    status: () => (current === null ? null : { ...current }),
    /** 供测试与接线说明用：本实例解析出来的能力产物路径。 */
    capabilityFile: () => capabilityFile,
    model: () => model,
  }
}

