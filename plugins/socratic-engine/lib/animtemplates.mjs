// lib/animtemplates.mjs — 教学动画的**参数化模板层**（纯函数：参数校验 ＋ 生成 ManimCE 脚本）。
//
// 🔴 为什么要有这一层（这是本批最大的杠杆，理由是实测出来的）：
//    ANIM-ORCH 测出模型**从零写一段 ManimCE 脚本要 60.5–73.8 秒**（均值 67.3 s，n=3 真实会话），
//    而渲染只要 2.85 s。也就是说端到端里 **96% 的墙钟花在"模型逐行吐 Python"上**。
//    常见教学图元（时间轴/甘特、状态机推移、条形对比）**形状是固定的、只有数字和文字在变**——
//    这类东西不该让模型每次重新写一遍 Python，而应该让模型只填**参数**，脚本由引擎拼。
//    → 模型要吐的 token 从「~130 行 Python」降到「~10 行 JSON」，这是把 60 秒压到几秒的路子。
//    ⚠️ 是否真的更快**以实测为准**（见 实现报告_ANIM-PREP §1）；本模块只负责"能不能拼出正确的脚本"。
//
// 与 lib/animation.mjs 的分工：
//   · animation.mjs       = **模型自己写的脚本**的结构性预检（收什么就验什么）；
//   · 本模块              = **引擎自己生成的脚本**：参数校验 → 拼脚本 → 交给同一条落盘/渲染链路。
//   两条路的**落盘、渲染、闸门、通报完全共用**（都走 lib/animationstore.mjs 的 startAnimationTask），
//   所以模板不是"另一套系统"，只是"脚本从哪里来"多了一个来源。
//
// 🔴 模板版本（TEMPLATE_VERSION）进**缓存键**（见 lib/prep.mjs 的 prepCacheKey）：
//    改了模板生成的脚本 → 版本 +1 → 旧缓存自动失效。不 +1 就会把旧脚本渲出来的片子当新片用。
//
// 生成脚本的三条硬约束（与 animation.mjs 的预检同源，这里是生成方自己先守住）：
//   ① 只有一个 Scene 子类；② 不用 LaTeX（本机没装，用了必崩）；③ 中文一律 font="PingFang SC"。

/** 中文字体（PoC 实测 macOS 自带，逐字见 poc_动画可写性/安装代价实测.md）。 */
export const CJK_FONT = 'PingFang SC'

/** 画面可用横轴范围（ManimCE 默认帧 14.22 × 8，左右各留 0.7 边距）。 */
const X_LEFT = -5.9
const X_RIGHT = 5.9

/** 调色板：模板参数里的 `color` 只能写这些名字（写错报错并列出可用值，不静默给个默认色）。 */
export const TEMPLATE_COLORS = {
  blue: '#3b82f6',
  amber: '#f59e0b',
  green: '#10b981',
  red: '#ef4444',
  purple: '#8b5cf6',
  grey: '#6b7280',
}

/** 自动配色顺序（参数没写 color 时按出现顺序取）。 */
const AUTO_COLORS = ['blue', 'amber', 'green', 'purple', 'red', 'grey']

/**
 * 颜色别名 → 规范名。
 *
 * 🔴 为什么要有别名（**真实会话实测出来的**，不是想当然）：本批第一次跑模板路径时，
 *    模型把第二个任务写成 `color: "orange"` —— 一个完全合理的说法，而白名单里只有 `amber`，
 *    于是那一次调用**被拒**、模型多花一轮重试（evidence/ab-template-template.json run1：
 *    两次 `classroom_animate_template` 调用）。多花的那一轮是**纯粹的浪费**：
 *    它不改语义，只改一个词的拼法。
 *    → 常见同义词一律**收敛到规范名**（`normalized.color` 存规范名，缓存键与脚本都用它），
 *      这样"同一个视觉"不会因为写法不同被算成两个参数、两份缓存。
 *    ⚠️ 边界：只收**同义**（gray≡grey、orange≡amber 这类同一色系的常见说法），
 *      不收"近似色"——那会让作者以为写什么都行，白名单就失去意义了。
 */
const COLOR_ALIASES = {
  orange: 'amber',
  yellow: 'amber',
  gray: 'grey',
  violet: 'purple',
  cyan: 'blue',
  sky: 'blue',
}

/** 白名单里允许写的全部颜色写法（规范名 ＋ 别名）。 */
export const TEMPLATE_COLOR_NAMES = [...Object.keys(TEMPLATE_COLORS), ...Object.keys(COLOR_ALIASES)]

/** 单个模板的参数上限（超过报错，不截断）。 */
export const MAX_LANES = 3
export const MAX_SEGMENTS_PER_LANE = 6
export const MAX_STATES = 5
export const MAX_TRANSITIONS = 8
export const MAX_WALK = 4
export const MAX_BARS = 5
export const MAX_LABEL_CHARS = 24
export const MAX_TITLE_CHARS = 120

/** Python 字符串字面量（JSON 的转义是 Python 的子集，中文原样保留）。 */
function pyStr(text) {
  return JSON.stringify(String(text))
}

/** 数字 → Python 浮点字面量（去掉多余小数位，避免 `0.30000000000000004` 这种）。 */
function pyNum(value) {
  const rounded = Math.round(value * 1e6) / 1e6
  return Number.isInteger(rounded) ? `${rounded}.0` : String(rounded)
}

/** 刻度文本：整数不写小数点。 */
function tickLabel(value) {
  const rounded = Math.round(value * 1e4) / 1e4
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

// ── 参数校验的小工具（一次报全，路径带出来）────────────────────────────────────

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkKnownKeys(raw, allowed, at, problems) {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      problems.push(`${at} 无法识别的键 ${JSON.stringify(key)}（可用：${allowed.join(' / ')}）`)
    }
  }
}

function checkLabel(value, at, problems, { max = MAX_LABEL_CHARS, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) problems.push(`${at} 必填：一句给学生在图上看的短标签`)
    return ''
  }
  if (typeof value !== 'string') {
    problems.push(`${at} 必须是字符串（得到 ${JSON.stringify(value)}）`)
    return ''
  }
  const text = value.trim()
  if (text.includes('\n')) problems.push(`${at} 必须单行（图上放不下换行标签）`)
  if (text.length > max) problems.push(`${at} 过长：${text.length} > ${max} 字符（图上放不下，请缩短）`)
  return text.replace(/\n/g, ' ')
}

function checkFiniteNumber(value, at, problems) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push(`${at} 必须是有限数字（得到 ${JSON.stringify(value)}）`)
    return null
  }
  return value
}

function checkColor(value, at, problems) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') {
    problems.push(`${at} 必须是颜色名（得到 ${JSON.stringify(value)}；可用：${TEMPLATE_COLOR_NAMES.join(' / ')}）`)
    return null
  }
  const canonical = COLOR_ALIASES[value] ?? value
  if (TEMPLATE_COLORS[canonical] === undefined) {
    problems.push(`${at} 不是可用的颜色名（得到 ${JSON.stringify(value)}；可用：${TEMPLATE_COLOR_NAMES.join(' / ')}）`)
    return null
  }
  return canonical
}

// ── ① 时间轴 / 甘特 ──────────────────────────────────────────────────────────
//
// 用在哪：**同一根时间轴上的多个区间**——"两个任务抢 CPU 谁先谁后""先到先服务 vs 最短作业优先
// 两条时间轴对比"。这是操作系统课里最需要动画、也最不需要自由发挥的一类图。
//
// params:
//   lanes: [{ label, segments: [{ start, end, label?, color?, endLabel? }] }]
//   unit?: string   刻度单位（只进注释，不上屏）
//   note?: string   图下一行小字（例如"周转时间 = 完成时刻 − 到达时刻"）

const TIMELINE_KEYS = ['lanes', 'unit', 'note']

function checkTimeline(params) {
  const problems = []
  checkKnownKeys(params, TIMELINE_KEYS, 'params(timeline)', problems)
  const lanes = params.lanes
  if (!Array.isArray(lanes) || lanes.length === 0) {
    problems.push('params(timeline).lanes 必须是非空数组：一行 = 一根泳道（一个方案/一个任务）')
    return { problems, normalized: null }
  }
  if (lanes.length > MAX_LANES) {
    problems.push(`params(timeline).lanes 过多：${lanes.length} > ${MAX_LANES}（画面只放得下 ${MAX_LANES} 行）`)
  }
  const out = []
  let tmax = 0
  lanes.slice(0, MAX_LANES).forEach((lane, i) => {
    const at = `params(timeline).lanes[${i}]`
    if (!isPlainObject(lane)) {
      problems.push(`${at} 必须是映射 {label, segments}`)
      return
    }
    checkKnownKeys(lane, ['label', 'segments'], at, problems)
    const label = checkLabel(lane.label, `${at}.label`, problems)
    const segs = lane.segments
    if (!Array.isArray(segs) || segs.length === 0) {
      problems.push(`${at}.segments 必须是非空数组：一行里至少一个区间`)
      return
    }
    if (segs.length > MAX_SEGMENTS_PER_LANE) {
      problems.push(`${at}.segments 过多：${segs.length} > ${MAX_SEGMENTS_PER_LANE}`)
    }
    const segOut = []
    segs.slice(0, MAX_SEGMENTS_PER_LANE).forEach((seg, j) => {
      const sat = `${at}.segments[${j}]`
      if (!isPlainObject(seg)) {
        problems.push(`${sat} 必须是映射 {start, end, label?, color?, endLabel?}`)
        return
      }
      checkKnownKeys(seg, ['start', 'end', 'label', 'color', 'endLabel'], sat, problems)
      const start = checkFiniteNumber(seg.start, `${sat}.start`, problems)
      const end = checkFiniteNumber(seg.end, `${sat}.end`, problems)
      if (start !== null && end !== null && !(end > start)) {
        problems.push(`${sat} 的 end 必须大于 start（得到 start=${start}, end=${end}）`)
      }
      const segLabel = checkLabel(seg.label, `${sat}.label`, problems, { required: false, max: 12 })
      const color = checkColor(seg.color, `${sat}.color`, problems)
      const endLabel = checkLabel(seg.endLabel, `${sat}.endLabel`, problems, { required: false, max: 10 })
      if (start !== null && end !== null && end > start) {
        tmax = Math.max(tmax, end)
        segOut.push({ start, end, label: segLabel, color, endLabel })
      }
    })
    out.push({ label, segments: segOut })
  })
  // 自动配色：同一行里没写 color 的按顺序取
  for (const lane of out) {
    lane.segments.forEach((seg, j) => {
      if (seg.color === null) seg.color = AUTO_COLORS[j % AUTO_COLORS.length]
    })
  }
  let unit = ''
  if (params.unit !== undefined && params.unit !== null) {
    unit = checkLabel(params.unit, 'params(timeline).unit', problems, { required: false, max: 20 })
  }
  let note = ''
  if (params.note !== undefined && params.note !== null) {
    note = checkLabel(params.note, 'params(timeline).note', problems, { required: false, max: 60 })
  }
  if (tmax <= 0) problems.push('params(timeline)：所有区间都无效（tmax ≤ 0），没有可画的时间轴')
  return { problems, normalized: { lanes: out, unit, note, tmax } }
}

function buildTimelineScript(title, p) {
  const n = p.lanes.length
  const step = 1.15
  // 纵向布局：内容块（最后一行的刻度标签 → 第一行的行标题）整体居中于标题之下。
  // 🔴 行标题写在**泳道正上方**（左对齐 X0），不写左侧——中文行标题写左侧会顶出画面左边界。
  const top = (n - 1) * step - 0.2
  const barH = 0.6
  const labelLift = 0.55
  const axisY = top - (n - 1) * step - 0.75
  const scale = (X_RIGHT - X_LEFT) / p.tmax
  const tx = (t) => X_LEFT + t * scale
  const ticks = [0]
  if (p.tmax >= 4) ticks.push(p.tmax / 2)
  ticks.push(p.tmax)

  const lines = []
  lines.push('from manim import *')
  lines.push('')
  lines.push('# 由 socratic-engine 的动画模板 timeline 生成（参数来自课程数据，脚本不由模型逐行写）。')
  lines.push(`FONT = ${pyStr(CJK_FONT)}`)
  lines.push('PALETTE = {')
  for (const [name, hex] of Object.entries(TEMPLATE_COLORS)) lines.push(`    ${pyStr(name)}: ${pyStr(hex)},`)
  lines.push('}')
  lines.push(`X0 = ${pyNum(X_LEFT)}`)
  lines.push(`X1 = ${pyNum(X_RIGHT)}`)
  lines.push(`SCALE = ${pyNum(scale)}`)
  lines.push('')
  lines.push('')
  lines.push('def tx(t):')
  lines.push('    return X0 + t * SCALE')
  lines.push('')
  lines.push('')
  lines.push('class TimelineScene(Scene):')
  lines.push('    def construct(self):')
  lines.push(`        title = Text(${pyStr(title)}, font=FONT, font_size=32).move_to([0, 3.6, 0])`)
  lines.push('        self.play(FadeIn(title, shift=DOWN * 0.2))')
  if (p.note !== '') {
    lines.push(`        note = Text(${pyStr(p.note)}, font=FONT, font_size=19, color=GREY_B).move_to([0, 3.05, 0])`)
    lines.push('        self.play(FadeIn(note))')
  }
  lines.push('')
  lines.push(`        axis_y = ${pyNum(axisY)}`)
  lines.push('        axis = Line([X0, axis_y, 0], [X1, axis_y, 0], color=GREY_B, stroke_width=2)')
  lines.push('        self.play(Create(axis))')
  lines.push(`        for value, label in (${ticks.map((v) => `(${pyNum(v)}, ${pyStr(tickLabel(v))})`).join(', ')}):`)
  lines.push('            x = tx(value)')
  lines.push('            tick = Line([x, axis_y - 0.1, 0], [x, axis_y + 0.1, 0], color=GREY_B, stroke_width=2)')
  lines.push('            mark = Text(label, font=FONT, font_size=18, color=GREY_B).move_to([x, axis_y - 0.32, 0])')
  lines.push('            self.add(tick, mark)')
  lines.push('        self.wait(0.2)')
  lines.push('')

  p.lanes.forEach((lane, i) => {
    const barY = top - i * step
    const labelY = barY + labelLift
    lines.push(`        lane${i}_label = Text(${pyStr(lane.label)}, font=FONT, font_size=19, color=WHITE)`)
    lines.push(`        lane${i}_label.move_to([X0 + lane${i}_label.width / 2, ${pyNum(labelY)}, 0])`)
    lines.push(`        self.play(FadeIn(lane${i}_label))`)
    const barNames = []
    lane.segments.forEach((seg, j) => {
      const name = `lane${i}_bar${j}`
      barNames.push(name)
      const x0 = tx(seg.start)
      const x1 = tx(seg.end)
      const width = x1 - x0
      const cx = (x0 + x1) / 2
      lines.push(
        `        ${name} = Rectangle(width=${pyNum(width)}, height=${pyNum(barH)}, ` +
          `fill_color=PALETTE[${pyStr(seg.color)}], fill_opacity=1.0, stroke_color=WHITE, stroke_width=1.5)`,
      )
      lines.push(`        ${name}.move_to([${pyNum(cx)}, ${pyNum(barY)}, 0])`)
    })
    lines.push(`        self.play(*[GrowFromEdge(b, LEFT) for b in (${barNames.join(', ')})], run_time=0.6)`)
    // 块内文字：🔴 一律**写在矩形内部**（居中或左右对齐），绝不写到矩形外面——
    //    写到外面就会和相邻泳道/刻度撞上（闸门判 D2 文字重叠、直接 blocked）。
    const texts = []
    lane.segments.forEach((seg, j) => {
      const name = `lane${i}_bar${j}`
      const x0 = tx(seg.start)
      const x1 = tx(seg.end)
      const width = x1 - x0
      const bothLabels = seg.label !== '' && seg.endLabel !== ''
      if (seg.label !== '') {
        const tname = `lane${i}_t${j}`
        texts.push(tname)
        if (bothLabels && width >= 1.5) {
          // 两个标签：左对齐名字、右对齐完成时刻（各留 0.15 内边距）
          lines.push(`        ${tname} = Text(${pyStr(seg.label)}, font=FONT, font_size=18).move_to([${pyNum(x0 + 0.15)}, ${pyNum(barY)}, 0], aligned_edge=LEFT)`)
        } else if (width >= 0.55) {
          lines.push(`        ${tname} = Text(${pyStr(seg.label)}, font=FONT, font_size=18).move_to(${name}.get_center())`)
        } else {
          texts.pop()
        }
      }
      if (seg.endLabel !== '' && width >= 1.5) {
        const ename = `lane${i}_e${j}`
        texts.push(ename)
        lines.push(
          `        ${ename} = Text(${pyStr(seg.endLabel)}, font=FONT, font_size=17, color=YELLOW)` +
            `.move_to([${pyNum(x1 - 0.15)}, ${pyNum(barY)}, 0], aligned_edge=RIGHT)`,
        )
      }
    })
    if (texts.length > 0) lines.push(`        self.play(FadeIn(VGroup(${texts.join(', ')})))`)
    lines.push('')
  })
  lines.push('        self.wait(1.2)')
  lines.push('')
  return lines.join('\n')
}

// ── ② 状态机推移 ─────────────────────────────────────────────────────────────
//
// 用在哪：**一个对象在一组状态之间按顺序走**——进程三态（就绪 → 运行 → 阻塞 → 就绪）、
//  TCP 连接状态、页面置换。要点是"推移"，所以 `walk` 会按顺序把状态逐个点亮。
//
// params:
//   states: [{ id, label }]                  2..5 个状态
//   transitions: [{ from, to, label? }]      有向边（from/to 必须是已声明的 state id）
//   walk?: [stateId, ...]                    高亮推移路径（最多 4 步）
//   note?: string

const STATE_MACHINE_KEYS = ['states', 'transitions', 'walk', 'note']

function checkStateMachine(params) {
  const problems = []
  checkKnownKeys(params, STATE_MACHINE_KEYS, 'params(state_machine)', problems)
  const states = params.states
  if (!Array.isArray(states) || states.length < 2) {
    problems.push('params(state_machine).states 必须是至少 2 个元素的数组 [{id, label}]')
    return { problems, normalized: null }
  }
  if (states.length > MAX_STATES) {
    problems.push(`params(state_machine).states 过多：${states.length} > ${MAX_STATES}`)
  }
  const stateOut = []
  const ids = []
  states.slice(0, MAX_STATES).forEach((state, i) => {
    const at = `params(state_machine).states[${i}]`
    if (!isPlainObject(state)) {
      problems.push(`${at} 必须是映射 {id, label}`)
      return
    }
    checkKnownKeys(state, ['id', 'label'], at, problems)
    const id = state.id
    if (typeof id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) {
      problems.push(`${at}.id 必须是字母开头的标识符（得到 ${JSON.stringify(id)}）——它要在 transitions 里被引用`)
      return
    }
    if (ids.includes(id)) problems.push(`${at}.id 重复：${id}`)
    ids.push(id)
    const label = checkLabel(state.label, `${at}.label`, problems, { max: 12 })
    stateOut.push({ id, label })
  })

  const transitions = params.transitions ?? []
  if (!Array.isArray(transitions)) {
    problems.push('params(state_machine).transitions 必须是数组 [{from, to, label?}]')
    return { problems, normalized: null }
  }
  if (transitions.length > MAX_TRANSITIONS) {
    problems.push(`params(state_machine).transitions 过多：${transitions.length} > ${MAX_TRANSITIONS}`)
  }
  const transOut = []
  transitions.slice(0, MAX_TRANSITIONS).forEach((tr, i) => {
    const at = `params(state_machine).transitions[${i}]`
    if (!isPlainObject(tr)) {
      problems.push(`${at} 必须是映射 {from, to, label?}`)
      return
    }
    checkKnownKeys(tr, ['from', 'to', 'label'], at, problems)
    for (const key of ['from', 'to']) {
      if (!ids.includes(tr[key])) {
        problems.push(`${at}.${key} 必须是已声明的 state id（得到 ${JSON.stringify(tr[key])}；已声明：${ids.join(' / ') || '（无）'}）`)
      }
    }
    if (tr.from === tr.to) problems.push(`${at} 的 from 与 to 相同（自环画不出来，请删掉或改成两条不同的边）`)
    const label = checkLabel(tr.label, `${at}.label`, problems, { required: false, max: 10 })
    transOut.push({ from: tr.from, to: tr.to, label })
  })

  let walk = []
  if (params.walk !== undefined && params.walk !== null) {
    if (!Array.isArray(params.walk)) {
      problems.push('params(state_machine).walk 必须是 state id 数组（推移顺序）')
    } else {
      if (params.walk.length > MAX_WALK) {
        problems.push(`params(state_machine).walk 过长：${params.walk.length} > ${MAX_WALK} 步`)
      }
      params.walk.slice(0, MAX_WALK).forEach((id, i) => {
        if (!ids.includes(id)) {
          problems.push(`params(state_machine).walk[${i}] 必须是已声明的 state id（得到 ${JSON.stringify(id)}；已声明：${ids.join(' / ')}）`)
        }
      })
      walk = params.walk.slice(0, MAX_WALK).filter((id) => ids.includes(id))
      // 相邻两步之间必须真有一条声明的边，否则"推移"是假的（动画会指向不存在的迁移）
      for (let i = 1; i < walk.length; i += 1) {
        const from = walk[i - 1]
        const to = walk[i]
        if (!transOut.some((tr) => tr.from === from && tr.to === to)) {
          problems.push(
            `params(state_machine).walk 第 ${i} → ${i + 1} 步（${from} → ${to}）在 transitions 里没有对应的边：` +
              '推移路径上的每一步都必须是一条已声明的迁移，否则动画讲不通。',
          )
        }
      }
    }
  }
  let note = ''
  if (params.note !== undefined && params.note !== null) {
    note = checkLabel(params.note, 'params(state_machine).note', problems, { required: false, max: 60 })
  }
  return { problems, normalized: { states: stateOut, transitions: transOut, walk, note } }
}

function buildStateMachineScript(title, p) {
  const n = p.states.length
  const radius = n <= 3 ? 1.75 : 2.05
  const centerY = n <= 3 ? 0.05 : 0.15
  const angles = []
  for (let i = 0; i < n; i += 1) angles.push(90 - (360 / n) * i)
  const pos = p.states.map((_, i) => {
    const a = (angles[i] * Math.PI) / 180
    return [Math.round(Math.cos(a) * radius * 1e6) / 1e6, Math.round((centerY + Math.sin(a) * radius) * 1e6) / 1e6]
  })
  const indexOf = (id) => p.states.findIndex((s) => s.id === id)

  const lines = []
  lines.push('import math')
  lines.push('')
  lines.push('from manim import *')
  lines.push('')
  lines.push('# 由 socratic-engine 的动画模板 state_machine 生成（参数来自课程数据，脚本不由模型逐行写）。')
  lines.push(`FONT = ${pyStr(CJK_FONT)}`)
  lines.push('')
  lines.push('')
  lines.push('class StateMachineScene(Scene):')
  lines.push('    def construct(self):')
  lines.push(`        title = Text(${pyStr(title)}, font=FONT, font_size=32).move_to([0, 3.6, 0])`)
  lines.push('        self.play(FadeIn(title, shift=DOWN * 0.2))')
  if (p.note !== '') {
    lines.push(`        note = Text(${pyStr(p.note)}, font=FONT, font_size=19, color=GREY_B).move_to([0, 3.05, 0])`)
    lines.push('        self.play(FadeIn(note))')
  }
  lines.push('')
  lines.push('        nodes = {}')
  lines.push('        specs = [')
  p.states.forEach((state, i) => {
    lines.push(`            (${pyStr(state.id)}, ${pyStr(state.label)}, ${pyNum(pos[i][0])}, ${pyNum(pos[i][1])}),`)
  })
  lines.push('        ]')
  lines.push('        for sid, label, px, py in specs:')
  lines.push('            circle = Circle(radius=0.78, stroke_color=WHITE, stroke_width=2.5, fill_color=BLUE_E, fill_opacity=0.45)')
  lines.push('            circle.move_to([px, py, 0])')
  lines.push('            text = Text(label, font=FONT, font_size=21).move_to([px, py, 0])')
  lines.push('            nodes[sid] = VGroup(circle, text)')
  lines.push('        self.play(*[FadeIn(node, scale=0.85) for node in nodes.values()], run_time=0.8)')
  lines.push('')
  // 双向边成对出现时用弧线，避免两条箭头重叠
  const pairSeen = new Set()
  lines.push('        arrows = {}')
  lines.push('        labels = VGroup()')
  p.transitions.forEach((tr, i) => {
    const a = indexOf(tr.from)
    const b = indexOf(tr.to)
    const hasReverse = p.transitions.some((other) => other.from === tr.to && other.to === tr.from)
    const key = `${tr.from}->${tr.to}`
    const curved = hasReverse
    // 成对反向边：按声明顺序一正一负，两条弧分开
    let angle = 0
    if (curved) {
      const pairKey = [tr.from, tr.to].sort().join('|')
      const first = !pairSeen.has(pairKey)
      pairSeen.add(pairKey)
      angle = first ? 0.5 : -0.5
    }
    const dx = pos[b][0] - pos[a][0]
    const dy = pos[b][1] - pos[a][1]
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    // 🔴 端点自己算（落在圆周外、留 0.12 缝隙），**不用 `buff` 参数**：
    //    manim 0.21.0 的 CurvedArrow 不接受 `buff`（实测报 `TypeError: Mobject.__init__()
    //    got an unexpected keyword argument 'buff'`）；而 Arrow 与 CurvedArrow 必须用同一套
    //    端点算法，两条边看起来才是一套。
    const gap = 0.78 + 0.12
    const sx = Math.round((pos[a][0] + ux * gap) * 1e6) / 1e6
    const sy = Math.round((pos[a][1] + uy * gap) * 1e6) / 1e6
    const ex = Math.round((pos[b][0] - ux * gap) * 1e6) / 1e6
    const ey = Math.round((pos[b][1] - uy * gap) * 1e6) / 1e6
    const mx = (pos[a][0] + pos[b][0]) / 2
    const my = (pos[a][1] + pos[b][1]) / 2
    // 法向偏移：直线边 0.42，弧线边 1.05（弧朝外，标签再往外一点）
    const nx = -dy / len
    const ny = dx / len
    const offset = curved ? 1.05 * (angle > 0 ? 1 : -1) : 0.42
    const lx = Math.round((mx + nx * offset) * 1e6) / 1e6
    const ly = Math.round((my + ny * offset) * 1e6) / 1e6
    const ctor = curved ? 'CurvedArrow' : 'Arrow'
    const extra = curved
      ? `, angle=${pyNum(angle)}, stroke_width=3.0, color=WHITE`
      : ', stroke_width=3.0, color=WHITE'
    lines.push(
      `        arrows[${pyStr(key)}] = ${ctor}([${pyNum(sx)}, ${pyNum(sy)}, 0], [${pyNum(ex)}, ${pyNum(ey)}, 0]${extra})`,
    )
    if (tr.label !== '') {
      lines.push(
        `        labels.add(Text(${pyStr(tr.label)}, font=FONT, font_size=17, color=GREY_B)` +
          `.move_to([${pyNum(lx)}, ${pyNum(ly)}, 0]))`,
      )
    }
  })
  lines.push('        self.play(*[Create(arrow) for arrow in arrows.values()], run_time=0.8)')
  lines.push('        if len(labels) > 0:')
  lines.push('            self.play(FadeIn(labels))')
  lines.push('        self.wait(0.3)')
  lines.push('')
  if (p.walk.length > 0) {
    const walkLabels = p.walk.map((id) => p.states[indexOf(id)].label)
    lines.push(`        walk = ${JSON.stringify(p.walk).replace(/"/g, "'")}`)
    lines.push(`        walk_labels = [${walkLabels.map((l) => pyStr(l)).join(', ')}]`)
    lines.push('        caption = Text("", font=FONT, font_size=22, color=YELLOW).move_to([0, -3.35, 0])')
    lines.push('        self.add(caption)')
    lines.push('        for step_index, sid in enumerate(walk):')
    lines.push('            next_caption = Text("第 %d 步：%s" % (step_index + 1, walk_labels[step_index]), font=FONT, font_size=22, color=YELLOW)')
    lines.push('            next_caption.move_to([0, -3.35, 0])')
    lines.push('            self.play(Indicate(nodes[sid], scale_factor=1.12, color=YELLOW), Transform(caption, next_caption), run_time=0.9)')
    lines.push('            if step_index > 0:')
    lines.push('                key = "%s->%s" % (walk[step_index - 1], sid)')
    lines.push('                if key in arrows:')
    lines.push('                    self.play(arrows[key].animate.set_color(YELLOW), run_time=0.4)')
    lines.push('        self.wait(1.0)')
  } else {
    lines.push('        self.wait(1.2)')
  }
  lines.push('')
  return lines.join('\n')
}

// ── ③ 条形对比 ───────────────────────────────────────────────────────────────
//
// 用在哪：**同一把尺子量出来的几个数**——"三种调度的平均周转时间""三种算法的缺页次数"。
// 参数里没有"随时间变化"，所以它**本来不该用动画**；做成模板是为了在真的需要一个
// "长出来"的对比时不必让模型写脚本（也顺手给了 classroom_draw 之外的第二个快路）。
//
// params:
//   items: [{ label, value, color? }]
//   unit?: string     值后面的单位（只进注释）
//   note?: string
//   highlight?: string 要高亮的那一项 label（其余压暗）

const BAR_KEYS = ['items', 'unit', 'note', 'highlight']

function checkBarCompare(params) {
  const problems = []
  checkKnownKeys(params, BAR_KEYS, 'params(bar_compare)', problems)
  const items = params.items
  if (!Array.isArray(items) || items.length === 0) {
    problems.push('params(bar_compare).items 必须是非空数组 [{label, value}]')
    return { problems, normalized: null }
  }
  if (items.length > MAX_BARS) {
    problems.push(`params(bar_compare).items 过多：${items.length} > ${MAX_BARS}`)
  }
  const out = []
  let vmax = 0
  items.slice(0, MAX_BARS).forEach((item, i) => {
    const at = `params(bar_compare).items[${i}]`
    if (!isPlainObject(item)) {
      problems.push(`${at} 必须是映射 {label, value, color?}`)
      return
    }
    checkKnownKeys(item, ['label', 'value', 'color'], at, problems)
    const label = checkLabel(item.label, `${at}.label`, problems, { max: 10 })
    const value = checkFiniteNumber(item.value, `${at}.value`, problems)
    if (value !== null && value < 0) problems.push(`${at}.value 必须 ≥ 0（条形长度不能是负的）`)
    const color = checkColor(item.color, `${at}.color`, problems)
    if (value !== null && value >= 0) {
      vmax = Math.max(vmax, value)
      out.push({ label, value, color })
    }
  })
  let highlight = ''
  if (params.highlight !== undefined && params.highlight !== null && params.highlight !== '') {
    highlight = checkLabel(params.highlight, 'params(bar_compare).highlight', problems, { required: false, max: 10 })
    if (highlight !== '' && !out.some((item) => item.label === highlight)) {
      problems.push(
        `params(bar_compare).highlight 必须是 items 里某一项的 label（得到 ${JSON.stringify(highlight)}；` +
          `现有：${out.map((i) => i.label).join(' / ')}）`,
      )
    }
  }
  let unit = ''
  if (params.unit !== undefined && params.unit !== null) {
    unit = checkLabel(params.unit, 'params(bar_compare).unit', problems, { required: false, max: 20 })
  }
  let note = ''
  if (params.note !== undefined && params.note !== null) {
    note = checkLabel(params.note, 'params(bar_compare).note', problems, { required: false, max: 60 })
  }
  if (vmax <= 0) problems.push('params(bar_compare)：所有 value 都是 0，没有可画的长度')
  out.forEach((item, j) => {
    if (item.color === null) item.color = highlight !== '' && item.label === highlight ? 'amber' : AUTO_COLORS[j % AUTO_COLORS.length]
  })
  return { problems, normalized: { items: out, vmax, unit, note, highlight } }
}

function buildBarCompareScript(title, p) {
  const n = p.items.length
  const step = 0.95
  const top = ((n - 1) * step) / 2
  const x0 = -1.6
  const x1 = 5.2
  const scale = (x1 - x0) / p.vmax
  const barH = 0.62

  const lines = []
  lines.push('from manim import *')
  lines.push('')
  lines.push('# 由 socratic-engine 的动画模板 bar_compare 生成（参数来自课程数据，脚本不由模型逐行写）。')
  lines.push(`FONT = ${pyStr(CJK_FONT)}`)
  lines.push('PALETTE = {')
  for (const [name, hex] of Object.entries(TEMPLATE_COLORS)) lines.push(`    ${pyStr(name)}: ${pyStr(hex)},`)
  lines.push('}')
  lines.push(`X0 = ${pyNum(x0)}`)
  lines.push(`SCALE = ${pyNum(scale)}`)
  lines.push('')
  lines.push('')
  lines.push('class BarCompareScene(Scene):')
  lines.push('    def construct(self):')
  lines.push(`        title = Text(${pyStr(title)}, font=FONT, font_size=32).move_to([0, 3.6, 0])`)
  lines.push('        self.play(FadeIn(title, shift=DOWN * 0.2))')
  if (p.note !== '') {
    lines.push(`        note = Text(${pyStr(p.note)}, font=FONT, font_size=19, color=GREY_B).move_to([0, 3.05, 0])`)
    lines.push('        self.play(FadeIn(note))')
  }
  lines.push('')
  lines.push(`        axis = Line([X0, ${pyNum(top + 0.7)}, 0], [X0, ${pyNum(-top - 0.7)}, 0], color=GREY_B, stroke_width=2)`)
  lines.push('        self.play(Create(axis))')
  lines.push('')
  p.items.forEach((item, i) => {
    const y = top - i * step
    const width = item.value * scale
    lines.push(`        bar${i} = Rectangle(width=${pyNum(width)}, height=${pyNum(barH)}, fill_color=PALETTE[${pyStr(item.color)}], fill_opacity=1.0, stroke_color=WHITE, stroke_width=1.5)`)
    lines.push(`        bar${i}.move_to([X0 + ${pyNum(width)} / 2, ${pyNum(y)}, 0])`)
    lines.push(`        lab${i} = Text(${pyStr(item.label)}, font=FONT, font_size=20, color=WHITE)`)
    lines.push(`        lab${i}.move_to([X0 - 0.25 - lab${i}.width / 2, ${pyNum(y)}, 0])`)
    lines.push(`        val${i} = Text(${pyStr(tickLabel(item.value))}, font=FONT, font_size=20, color=YELLOW)`)
    lines.push(`        val${i}.move_to([X0 + ${pyNum(width)} + 0.2 + val${i}.width / 2, ${pyNum(y)}, 0])`)
  })
  lines.push(`        self.play(*[FadeIn(m) for m in (${p.items.map((_, i) => `lab${i}, val${i}`).join(', ')})])`)
  lines.push(
    `        self.play(*[GrowFromEdge(b, LEFT) for b in (${p.items.map((_, i) => `bar${i}`).join(', ')})], run_time=0.9)`,
  )
  lines.push('        self.wait(1.2)')
  lines.push('')
  return lines.join('\n')
}

// ── 注册表 ───────────────────────────────────────────────────────────────────

/**
 * 模板注册表。每个模板：
 *   id / version / sceneClass / label（中文名）/ useWhen（什么时候该选它）/ paramsDoc（参数形状，进工具描述）
 *   check(params)  → {problems, normalized}
 *   build(title, normalized) → ManimCE 源码
 *
 * 🔴 `version` 一改就换缓存（见 lib/prep.mjs）。**改模板生成逻辑必须 +1**。
 */
export const TEMPLATES = {
  timeline: {
    id: 'timeline',
    version: 1,
    sceneClass: 'TimelineScene',
    label: '时间轴 / 甘特',
    useWhen:
      '同一根时间轴上有多个区间：谁先占、谁后占、同一段时间里两个方案各是什么样（调度顺序、甘特、执行流水）',
    paramsDoc:
      '{"lanes":[{"label":"行标题","segments":[{"start":0,"end":100,"label":"A","color":"blue","endLabel":"100"}]}],' +
      '"note":"图下一行小字"}',
    check: checkTimeline,
    build: buildTimelineScript,
  },
  state_machine: {
    id: 'state_machine',
    version: 1,
    sceneClass: 'StateMachineScene',
    label: '状态机推移',
    useWhen:
      '一个对象在一组状态之间按顺序走，且要让学生看见"它这一步走到哪了"（进程三态、连接生命周期）',
    paramsDoc:
      '{"states":[{"id":"ready","label":"就绪"}],"transitions":[{"from":"ready","to":"running","label":"被调度"}],' +
      '"walk":["ready","running"],"note":"图下一行小字"}',
    check: checkStateMachine,
    build: buildStateMachineScript,
  },
  bar_compare: {
    id: 'bar_compare',
    version: 1,
    sceneClass: 'BarCompareScene',
    label: '条形对比',
    useWhen: '同一把尺子量出来的几个数摆在一起比大小（平均周转时间、缺页次数、命中率）',
    paramsDoc: '{"items":[{"label":"FIFO","value":40,"color":"blue"}],"highlight":"SJF","note":"图下一行小字"}',
    check: checkBarCompare,
    build: buildBarCompareScript,
  },
}

/** 模板 id 列表（顺序＝工具描述里的呈现顺序）。 */
export const TEMPLATE_IDS = Object.keys(TEMPLATES)

/** 取一个模板；不存在返回 null（调用方决定怎么报错）。 */
export function getTemplate(id) {
  return typeof id === 'string' && Object.hasOwn(TEMPLATES, id) ? TEMPLATES[id] : null
}

/**
 * 从**已规范化**的参数拼出脚本。**纯函数**。
 *
 * 🔴 为什么单独拆出来（本批实测踩过一次）：`checkTemplateArgs` 会**同时**做校验与生成，
 *    而它返回的 `params` 是**规范化后**的（补了自动配色、补了 tmax 这类派生字段）。
 *    预热层如果拿这份规范化参数**再走一遍校验**，就会报「无法识别的键 tmax」——
 *    把引擎自己补的字段当成作者写错了。→ 声明在装载期校验**一次**，预热只负责拼脚本。
 *
 * @param {string} templateId
 * @param {string} title
 * @param {object} normalizedParams - `template.check(...)` 的 `normalized`
 * @returns {{script:string, lines:number, bytes:number, sceneClass:string}}
 */
export function renderTemplateScript(templateId, title, normalizedParams) {
  const template = getTemplate(templateId)
  if (template === null) throw new Error(`renderTemplateScript：未知模板 ${JSON.stringify(templateId)}`)
  const script = template.build(title, normalizedParams)
  // 生成方自己先守一遍硬约束（这两条错了会渲不出来或必崩，绝不许流到渲染器）
  if (!new RegExp(`^class\\s+${template.sceneClass}\\s*\\(\\s*Scene\\s*\\)`, 'm').test(script)) {
    throw new Error(`引擎内部错误：模板 ${templateId} 生成的脚本里找不到 ${template.sceneClass}(Scene)`)
  }
  if (/\b(MathTex|Tex|TexTemplate|TexText|DecimalNumber|Integer|NumberLine|Matrix|Brace)\s*\(/.test(script)) {
    throw new Error(`引擎内部错误：模板 ${templateId} 生成的脚本里出现了 LaTeX 入口（本机没装 LaTeX，必崩）`)
  }
  return {
    script,
    lines: script.split('\n').length,
    bytes: Buffer.byteLength(script, 'utf8'),
    sceneClass: template.sceneClass,
  }
}

/**
 * 校验模板调用参数并**生成脚本**。纯函数。
 *
 * @param {{template?:unknown, params?:unknown, title?:unknown}} args
 * @returns {{ok:boolean, problems:string[], template:string|null, templateVersion:number|null,
 *            sceneClass:string|null, title:string, params:object|null, script:string|null, bytes:number, lines:number}}
 */
export function checkTemplateArgs(args = {}) {
  const problems = []
  const template = getTemplate(args?.template)
  const rawTitle = args?.title
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : ''
  if (template === null) {
    problems.push(
      `template 必须是 ${TEMPLATE_IDS.join(' / ')} 之一（得到 ${JSON.stringify(args?.template)}）。` +
        '模板形状对不上就别硬套——用 classroom_animate 自己写脚本。',
    )
  }
  if (title === '') problems.push('title 必填：一句话说清这段动画讲什么（会写进索引，供课后回看）。')
  else if (title.length > MAX_TITLE_CHARS) problems.push(`title 过长：${title.length} > ${MAX_TITLE_CHARS} 字符。`)
  else if (title.includes('\n')) problems.push('title 必须单行。')

  const params = args?.params
  if (!isPlainObject(params)) {
    problems.push(
      'params 必须是映射（对象）。' +
        (template === null ? '' : `本模板的形状：${template.paramsDoc}`),
    )
    return {
      ok: false,
      problems,
      template: template?.id ?? null,
      templateVersion: template?.version ?? null,
      sceneClass: template?.sceneClass ?? null,
      title,
      params: null,
      script: null,
      bytes: 0,
      lines: 0,
    }
  }

  if (template !== null) {
    const result = template.check(params)
    problems.push(...result.problems)
    if (problems.length === 0 && result.normalized !== null) {
      const built = renderTemplateScript(template.id, title, result.normalized)
      return {
        ok: true,
        problems,
        template: template.id,
        templateVersion: template.version,
        sceneClass: built.sceneClass,
        title,
        params: result.normalized,
        script: built.script,
        bytes: built.bytes,
        lines: built.lines,
      }
    }
    return {
      ok: false,
      problems,
      template: template.id,
      templateVersion: template.version,
      sceneClass: template.sceneClass,
      title,
      params: result.normalized,
      script: null,
      bytes: 0,
      lines: 0,
    }
  }

  return {
    ok: false,
    problems,
    template: null,
    templateVersion: null,
    sceneClass: null,
    title,
    params: null,
    script: null,
    bytes: 0,
    lines: 0,
  }
}

/**
 * 模板目录文本（进工具描述与错误信息，只有一处维护点）。
 * 每条：`id（中文名，版本 v）—— 什么时候选它；params 形状：…`
 */
export function describeTemplates() {
  return TEMPLATE_IDS.map((id) => {
    const t = TEMPLATES[id]
    return `· ${t.id}（${t.label}，v${t.version}）—— ${t.useWhen}\n  params: ${t.paramsDoc}`
  }).join('\n')
}
