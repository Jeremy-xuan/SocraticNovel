// lib/animation.mjs — 教学动画（classroom_animate 工具）的**纯函数层**：入参校验、任务号、索引行。
//
// 分工（与 lib/diagram.mjs 同一套纪律，避免"谁说了算"含糊）：
//   ① 本模块＝**结构性预检**（纯函数、零 IO、零第三方依赖）：脚本非空／行数上限／
//      必须有一个 Scene 子类／不许带 markdown 围栏／不许用本机装不了的 LaTeX。
//      目的是把"模型自己能改的错"**在落盘与起渲染之前**拦下来，一轮就报全。
//   ② 权威判据在 **渲染器那一侧**（`lib/animation-runner.py`）：`py_compile` 真编译 →
//      ManimCE 真渲染 → 退出码 0 且真的产出 mp4，才算成功。
//   🔴 结构性预检**不是**真渲染的替代品，也不许拿它当"降级放行"：渲染器不可用 → 工具报错。
//
// 🔴 为什么 LaTeX 是硬拒绝而不是提示：本机没装 LaTeX（PoC 实测，`Tex`/`MathTex` 必崩
//    `FileNotFoundError: 'latex'`，逐字见 poc_动画可写性/取证 §4.4）。让这种脚本进渲染，
//    代价是白等一整个渲染周期再收到一条 python 栈——预检里拒掉，模型下一轮就能改成 `Text`。
//    （这不是"猜"：PoC 对照轮里模型自己踩过一次、自己改成 Text 手写刻度，见 取证_对照轮 §1.2。）
//
// 落盘约定（见 index.mjs 的 classroom_animate 工具）：
//   <教室目录>/runtime/animations/<任务号>/scene.py     ← 模型交来的脚本原文（逐字，不改一个字符）
//   <教室目录>/runtime/animations/<任务号>/task.json    ← **宿主写**：任务事实（讲次/回合/发起时间/是否已播报）
//   <教室目录>/runtime/animations/<任务号>/status.json  ← **渲染器写**：状态真源（rendering/ready/failed/blocked）
//   <教室目录>/runtime/animations/<任务号>/render.log   ← 渲染器 stdout+stderr 原文
//   <教室目录>/runtime/animations/<任务号>/<任务号>.mp4 ← 产物
//   <教室目录>/runtime/animations/index.md              ← 人读索引（一行一任务，只追加）

import { formatLocalTime } from './postclass.mjs'

/** 动画子目录（相对教室 runtime/）。 */
export const ANIMATIONS_SUBDIR = 'animations'
/** 人读索引文件名（与 runtime/diagrams/index.md 同形）。 */
export const INDEX_FILE = 'index.md'
/** 宿主写的任务事实文件名。 */
export const TASK_FILE = 'task.json'
/** 渲染器写的状态文件名（状态真源）。 */
export const STATUS_FILE = 'status.json'
/** 脚本原文文件名。 */
export const SCRIPT_FILE = 'scene.py'
/** 渲染日志文件名（manim 自己的 stdout/stderr，由渲染器写）。 */
export const RENDER_LOG_FILE = 'render.log'
/** 渲染器进程日志（渲染器自己的 stdout/stderr，由宿主在起进程时接上；崩溃原因在这里）。 */
export const RUNNER_LOG_FILE = 'runner.log'

/**
 * 任务状态机（**只前推，不回退**）。
 *
 *   queued    宿主已落盘脚本、已把渲染器拉起来，还没拿到渲染器的第一次回报
 *   rendering 渲染器已开始渲染
 *   gating    渲染成功，正在过质量闸门（闸门未配置时不会经过这一态）
 *   ready     ✅ 可用：mp4 已落盘，闸门放行（或闸门未配置）
 *   blocked   🔴 闸门判不通过：mp4 在，但**不许播**（画面层缺陷，见 animation-gate）
 *   failed    🔴 渲染失败：没有可播的 mp4
 *
 * 🔴 `ready` 与 `blocked` 都"渲染完成了"，但含义相反——合并成一个状态会让"闸门拦下来的片子"
 *    被当成"可以播的片子"发到学生面前，这正是闸门存在的意义所在，不能合并。
 */
export const ANIMATION_STATES = ['queued', 'rendering', 'gating', 'ready', 'blocked', 'failed']

/** 终态（不再变化）与"还在跑"的划分。 */
export const TERMINAL_STATES = ['ready', 'blocked', 'failed']
export const RUNNING_STATES = ['queued', 'rendering', 'gating']

/** 脚本字符数与行数上限（超过报错，**不截断**——截断后的脚本不是模型写的那个脚本）。 */
export const MAX_SCRIPT_CHARS = 40000
export const MAX_SCRIPT_LINES = 300

/** 标题／说明上限（与板书图同一口径）。 */
export const MAX_TITLE_CHARS = 120
export const MAX_CAPTION_CHARS = 500

/**
 * 预估渲染耗时（毫秒）与给人看的区间文案。
 *
 * 🔴 这是**实测基线**不是公式：`poc_动画可写性/安装代价实测.md` §4.2 的 12 个真实教学脚本
 *    低画质实测 2.01–3.00 s；ANIM-ORCH 复测（同 12 例，`evidence/exp2_render_disk.json`）
 *    为 2.30–5.60 s（后者在被测机器同时跑 3 个会话时有 CPU 争用，偏高）。
 *    故对外只说区间、不说点估计，且**明说这是经验值**。
 */
export const DEFAULT_EXPECTED_MS = 3000
export const EXPECTED_RANGE_TEXT = '约 2–6 秒（低画质、12 例实测区间）'

/** 一次任务最多同时允许几个在跑（超过则拒绝新任务，提示等前面的）。 */
export const MAX_CONCURRENT_TASKS = 2

/**
 * 结构性预检模型交来的动画脚本。**纯函数**（无 IO、无第三方依赖）。一次报全。
 *
 * @param {{script?: unknown, title?: unknown, caption?: unknown}} args
 * @returns {{ok:boolean, problems:string[], script:string, title:string, caption:string,
 *            sceneClass:string|null, lines:number}}
 */
export function checkAnimationArgs(args = {}) {
  const problems = []

  const rawScript = args?.script
  const script = typeof rawScript === 'string' ? rawScript : ''
  if (script.trim() === '') {
    problems.push(
      'script 为空：script 必须是**完整的 ManimCE Python 脚本正文**（含一个 Scene 子类），' +
        '不是对动画的描述、不是伪代码、不是 mermaid。',
    )
  } else if (script.length > MAX_SCRIPT_CHARS) {
    problems.push(
      `script 过长：${script.length} 字符 > 上限 ${MAX_SCRIPT_CHARS}。` +
        '请只画这一个知识点、删掉与机制无关的装饰（🔴 引擎不截断）。',
    )
  }

  const lines = script === '' ? 0 : script.split('\n').length
  if (lines > MAX_SCRIPT_LINES) {
    problems.push(`script 过长：${lines} 行 > 上限 ${MAX_SCRIPT_LINES} 行。请拆成更短的一段动画。`)
  }

  if (script.includes('```')) {
    problems.push('script 里含 markdown 围栏（``` ）：请只传围栏**内部**的 Python 源码正文。')
  }

  // Scene 子类：渲染器必须知道要渲哪个类；缺了它渲染命令没法发。
  const sceneClass = findSceneClass(script)
  if (script.trim() !== '' && sceneClass === null) {
    problems.push(
      'script 里找不到 Scene 子类：必须有一个形如 `class Xxx(Scene):` 的类' +
        '（manim 的命令行要把类名作为参数传进去）。',
    )
  }

  // LaTeX：本机没装 → 必崩。硬拒绝，并给出可执行的改法。
  const latex = findLatexUse(script)
  if (latex !== null) {
    problems.push(
      `script 第 ${latex.line} 行用了 ${latex.name}(…)：**本机没有装 LaTeX**，` +
        '这类调用一定会崩在 `FileNotFoundError: No such file or directory: \'latex\'`。' +
        '请改用 `Text`/`MarkupText` 把公式或刻度**写成普通文本**（例如刻度用 Text 逐个摆），' +
        '不要用 Tex / MathTex / MathTexTemplate / 任何内部走 LaTeX 的参数（如 NumberLine(include_numbers=True)）。',
    )
  }

  const rawTitle = args?.title
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : ''
  if (title === '') problems.push('title 必填：一句话说清这段动画讲什么（会写进索引，供课后回看）。')
  else if (title.length > MAX_TITLE_CHARS) problems.push(`title 过长：${title.length} > ${MAX_TITLE_CHARS} 字符。`)
  else if (title.includes('\n')) problems.push('title 必须单行。')

  const rawCaption = args?.caption
  const caption = typeof rawCaption === 'string' ? rawCaption.trim() : ''
  if (caption.length > MAX_CAPTION_CHARS) {
    problems.push(`caption 过长：${caption.length} > ${MAX_CAPTION_CHARS} 字符。`)
  }

  return { ok: problems.length === 0, problems, script, title, caption, sceneClass, lines }
}

/**
 * 找脚本里的 Scene 子类名（取**最后一个**——多类时 manim 通常渲染最后定义的那个；
 * 与 PoC 的取法一致，见 poc_动画可写性/scripts）。
 * @param {string} script
 * @returns {string|null}
 */
export function findSceneClass(script) {
  const names = [...script.matchAll(/^class\s+([A-Za-z_]\w*)\s*\(\s*([A-Za-z_][\w.]*)\s*\)/gm)]
    .filter((m) => /Scene/.test(m[2]))
    .map((m) => m[1])
  return names.length === 0 ? null : names[names.length - 1]
}

/** 会调 LaTeX 的入口（只列 ManimCE 0.21.0 里真的会走 `latex` 可执行文件的那些）。 */
const LATEX_ENTRIES = [
  'MathTex',
  'Tex',
  'TexTemplate',
  'MathTexTemplate',
  'TexText',
  'SingleStringMathTex',
  'DecimalNumber',
  'Integer',
  'NumberLine',
  'Matrix',
  'Brace',
  'MathTexSVG',
]

/**
 * 扫出脚本里第一处会调 LaTeX 的地方。**纯函数**。
 *
 * 🔴 口径（避免误报）：只看**真的在调用**（名字后跟 `(`）的位置，跳过注释行与字符串字面量里的提及。
 *    但 `NumberLine` 是例外：它只在 `include_numbers=True` / `numbers_with_elongated_ticks` 这类
 *    参数下才走 LaTeX，而 PoC 实测**正是这一条踩的坑**（`NumberLine(include_numbers=True)` →
 *    模型自己改成 Text 手写刻度）。故对 `NumberLine` 只在**同一行里同时出现** `include_numbers`
 *    或 `numbers_with_elongated_ticks` 时才判为 LaTeX 调用。
 * @param {string} script
 * @returns {{name:string, line:number}|null}
 */
export function findLatexUse(script) {
  const lines = script.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    const code = raw.replace(/(^|\s)#.*$/, '') // 去掉行尾注释
    if (code.trim() === '') continue
    // 去掉字符串字面量，避免把"不要用 Tex"这类说明文字判成调用
    const stripped = code.replace(/(['"])(?:\\.|(?!\1).)*\1/g, '""')
    for (const name of LATEX_ENTRIES) {
      if (!new RegExp(`\\b${name}\\s*\\(`).test(stripped)) continue
      if (name === 'NumberLine') {
        if (!/\b(include_numbers|numbers_with_elongated_ticks)\b/.test(stripped)) continue
      }
      return { name, line: i + 1 }
    }
  }
  return null
}

/** 两位补零。 */
function pad2(n) {
  return String(n).padStart(2, '0')
}

/**
 * 生成任务号：`L<讲次>-T<回合>-<yyyyMMdd-HHmmss>`（与板书图文件名同一套时间戳口径，便于对照）。
 * @param {{lesson:number|null, turn:number, at:number}} spec
 */
export function animationTaskId({ lesson, turn, at }) {
  const d = new Date(at)
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  const lessonPart = lesson === null || lesson === undefined ? 'Lxx' : `L${pad2(lesson)}`
  return `${lessonPart}-T${pad2(turn)}-${stamp}`
}

/**
 * 任务号冲突时加 `-2`/`-3` 后缀（同一秒内连起两个任务）。**纯函数**：由调用方告知哪些已存在。
 * @param {string} id
 * @param {(candidate:string) => boolean} exists
 */
export function uniqueTaskId(id, exists) {
  if (!exists(id)) return id
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${id}-${n}`
    if (!exists(candidate)) return candidate
  }
  throw new Error(`同名动画任务已存在 100 个：${id}（时间戳精度不足，请检查系统时钟）`)
}

/** 索引文件开头（首次创建时写一次；此后只追加数据行）。 */
export function renderIndexHeader() {
  return [
    '# 教学动画索引',
    '',
    '> **本文件由引擎自动追加**（`classroom_animate` 工具）：每起一段动画，就在本目录落一个任务子目录',
    '> （`scene.py` 脚本原文 ＋ `status.json` 状态 ＋ mp4 产物），并在这里追加一行。**只追加，不删。**',
    '> 🔴 **状态含义**：`ready` 可播；`blocked` 渲染出来了但**质量闸门判不通过，不许播**；',
    '> `failed` 渲染失败、没有可播的片子。讲次取自 `runtime/progress.md` 的 `current_lesson`。',
    '',
    '| 日期 | 讲次 | 回合 | 状态 | 标题 | 说明 | 产物 |',
    '|---|---|---|---|---|---|',
  ].join('\n')
}

/**
 * 渲染索引的一行。**纯函数**。`caption` 必须落进索引（模型给了说明却不落盘＝信息静默消失）。
 * @param {{timeLabel:string, lesson:number|null, turn:number, state:string, title:string,
 *          caption?:string, artifact:string}} row
 */
export function renderIndexRow({ timeLabel, lesson, turn, state, title, caption = '', artifact }) {
  const lessonCell = lesson === null || lesson === undefined ? '—' : `第 ${lesson} 讲`
  const cell = (text, empty) => (text === '' ? empty : text.replace(/\|/g, '\\|').replace(/\n+/g, ' '))
  return (
    `| ${timeLabel} | ${lessonCell} | ${turn} | ${state} | ${cell(title, '（未给标题）')} | ` +
    `${cell(caption, '—')} | \`${artifact}\` |`
  )
}

/** 把一行追加进索引全文（文件不存在时用 renderIndexHeader 打底）。**纯函数**。 */
export function appendIndexRow(content, row) {
  const base =
    content === null || content === undefined || content.trim() === ''
      ? renderIndexHeader()
      : content.replace(/\s+$/, '')
  return `${base}\n${row}\n`
}

/** 供工具返回值用：本机时间标签（与 postclass 的 session_log 口径一致）。 */
export function nowLabel(at) {
  return formatLocalTime(at)
}

/**
 * 把状态翻译成**给老师看的一句话**（工具返回值与注入块共用同一份文案，避免两处各写一份）。
 * @param {string} state
 * @param {{reason?:string|null, file?:string|null}} [extra]
 */
export function describeState(state, extra = {}) {
  const reason = extra.reason === undefined || extra.reason === null || extra.reason === '' ? null : extra.reason
  switch (state) {
    case 'queued':
      return '已排队：渲染器已启动，还没开始出帧'
    case 'rendering':
      return '渲染中：正在出帧，好了会自动告诉你'
    case 'gating':
      return '渲染完成，正在过质量闸门'
    case 'ready':
      return '已就绪：可以播了'
    case 'blocked':
      return `质量闸门判不通过，**不许播**${reason === null ? '' : `：${reason}`}`
    case 'failed':
      return `渲染失败，没有可播的片子${reason === null ? '' : `：${reason}`}`
    default:
      return `未知状态 ${JSON.stringify(state)}`
  }
}
