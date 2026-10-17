// lib/asserts.mjs — 阶段④ 六条断言（"验收标准"，一条都不许省）
//
// 🔴 设计原则：**判定用的期望值独立于被测代码**。
//   · "本回合应当注入哪些块"由本文件按 classroom.yaml 的字段**自己重新推一遍**
//     （不调用被测的 `lib/injector.mjs`，避免拿规划器的输出校验规划器）；
//   · "实际注入了哪些块"取自**宿主持久化的会话事件流**（落盘真相），不取插件自己的日志。
//
// 每条断言返回：{ id, name, ok, detail, evidence }。任何一条 false → 进程退出码非零。

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendedLines, sha256Text, writeJson, writeText } from './util.mjs'
import { injectionListOf, pairToolCalls } from './sessionlog.mjs'
import { classifyAll, renderSummary, ruleCatalog } from './whitelist.mjs'

// ─────────────────────────────────────────────────────────────────────────────
// 独立推导：按 manifest 字段重算"本回合应注入哪些 chat 块"
// ─────────────────────────────────────────────────────────────────────────────

/** 讲次门判定（独立实现，逐条对齐 classroom.yaml 文件头的语义声明）。 */
function lessonGateAllowsLocal(gate, lessonNo) {
  if (gate === null || gate === undefined) return true
  if (!Number.isInteger(lessonNo)) return false
  if (gate.current === true) return gate.of === undefined || gate.of === lessonNo
  if (Array.isArray(gate.list)) return gate.list.includes(lessonNo)
  if (Array.isArray(gate.range)) return lessonNo >= gate.range[0] && lessonNo <= gate.range[1]
  return false
}

/** 相位门判定：`except` 命中 → 排除；`phases` 不含 → 排除。 */
function phaseAllows(phase, current) {
  if (!phase) return true
  if (Array.isArray(phase.except) && phase.except.includes(current)) return false
  if (Array.isArray(phase.phases) && !phase.phases.includes(current)) return false
  return true
}

/**
 * 独立推导某回合应注入的块 id 清单。
 * @param {object} manifest
 * @param {{phase:string, lesson:number, turn:number, injectedOnce:Set<string>, lessonBook:Map<string,number>}} state
 */
export function predictTurnBlocks(manifest, state) {
  const due = []
  for (const block of manifest.blocks) {
    if (block.position.target !== 'chat') continue
    if (block.lesson !== null && block.lesson !== undefined) {
      if (!lessonGateAllowsLocal(block.lesson, state.lesson)) continue
    }
    const every = block.frequency?.every
    const n = block.frequency?.n
    const anchor = block.frequency?.anchor
    let inject = false
    if (every === 'once') {
      if (anchor === 'lesson_start') inject = state.lessonBook.get(block.id) !== state.lesson
      else inject = !state.injectedOnce.has(block.id)
    } else if (every === 'turn') {
      inject = true
    } else if (every === 'n_turns') {
      inject = state.turn % n === 0
    } else if (every === 'phase') {
      inject = phaseAllows(block.phase, state.phase)
    } else if (every === 'on_demand') {
      inject = false
    }
    if (!inject) continue
    if (block.phase && !phaseAllows(block.phase, state.phase)) continue
    due.push(block.id)
    if (every === 'once') {
      if (anchor === 'lesson_start') state.lessonBook.set(block.id, state.lesson)
      else state.injectedOnce.add(block.id)
    }
  }
  return due
}

// ─────────────────────────────────────────────────────────────────────────────
// 运行期动态块（引擎在**回合边界**自产、**不经过** manifest 频率规划器的两类注入）
//
// 🔴 为什么单列一节：ACCEPT-4 的断言 A2 报过一条红，成因**不在插件**，而是**推导模型过期**——
//    引擎新增了两条"运行期才有"的注入通道，而本文件只按 `manifest.blocks` 推，于是
//    "实际注入集合 ≠ 独立推导集合"。修法**不是**在断言里声明"这两类不参与比对"
//    （那等于把整条断言变成不比对），而是**按结构把这两类建进模型**。
//
// 两类块各自的**出现条件与数量规则**（逐条读引擎源码得出，锚点见本批报告的锚点表）：
//
// ① `prep-list:<讲次>` —— 备课清单（教室 `prep:` 段声明的"这一讲预先备好了哪几段动画"）。
//    出现条件（三个都要成立）：教室启用了动画（`classroom.yaml` 顶层 `animation.enabled === true`）
//      ∧ 本讲有备课条目（`prep.items` 里 `lesson === 本轮讲次` 的条目数 > 0）
//      ∧ 这一讲还没发过（记账变量 `prepListAnnouncedFor !== 本轮讲次`）。
//    数量规则：**一讲至多一条**；发过就记下讲次，**讲次一变重新发**（变回上一讲也重发）。
//    时机：**本轮讲次的第一个回合**（引擎在 pre-step 里判，判完就在本回合注入）。
//    🔴 讲次号本身**完全可预测**（就是 `lesson`，值域来自教室 `prep.items[].lesson`）→ 字面比对。
//
// ② `animation-notice:<任务号>` —— 动画就绪通报（"你上一轮起的/课前预热的那段片子有结果了"）。
//    出现条件：存在**终态（ready/blocked/failed）且尚未播报**的动画任务
//      （`task.json.announcedAt === null`）。引擎每回合开头取一次、**取到就当场标记已播报**
//      （幂等门落在 `announcedAt` 这个落盘字段上）→ 同一任务**至多通报一次**。
//    数量规则：**每条终态未播报的任务各一条**；上界 = 这一讲声明的备课条目数
//      （预热是这些条目的唯一来源；老师课上现起的任务不在教室数据里，见下）。
//    任务号形状：`L<两位讲次>-T<两位回合>-<yyyyMMdd-HHmmss>`，冲突时加 `-2`/`-3` 后缀。
//    🔴 **逐维判可预测性**（哪几维进严格比对、哪几维只做等价处理）：
//      · 讲次（`L01`）——**可预测**：任务由"这一讲的备课条目"预热而来 → **字面比对**
//        （在 A2 里由"会话级 ⊆ 可能集合"这条子判据承担）；
//      · 条数上界——**可预测**：每讲 ≤ 该讲声明的备课条目数 → **子判据**；
//      · 任务号形状——**可预测**：`L<两位讲次>-T<两位回合>-<yyyyMMdd-HHmmss>`（可带冲突后缀）→ **子判据**；
//      · 通报时刻 ≥ 创建时刻——**可预测**：任务号里就记着创建回合 → **子判据**；
//      · **出现与否**——❌ **不可预测**：取决于"那段渲染在本次会话结束前有没有变终态"
//        （实测两次真跑都有 1 条，但更早的跑 0 条）→ **不进逐回合严格比对**；
//      · 回合号（`T00`）——❌ **不可预测**：通报发生在"任务变终态之后的下一个回合"，
//        而渲染耗时可长可短（实测一次预热在装载后起、到第 2 回合才就绪）；
//      · 时间戳（`20260924-150326`）——❌ **不可预测**：任务创建时刻到秒，冲突时还加后缀。
//      → 后三维**不进**逐回合严格集合比对；前四维由 `assert2PhaseGating` 里的
//        「会话级通报子判据」逐条承担。**不是**把整条断言变成不比对。
//
// ⚠️ 诚实边界：老师**课堂上现场**起的动画任务（`origin: teacher`）其存在与条数不在教室数据里
//    （取决于模型课上做了什么）→ 本模型只覆盖"由教室 `prep:` 声明预热而来"的那一类，
//    这类之外出现通报会被下面的子判据判**失败**（宁可响亮报错，也不静默放过）。
//    🔴 另一条边界：**"该出现而没出现"判不了**（见 `assert2PhaseGating` 的 `possibleLessons` 子判据）。
// ─────────────────────────────────────────────────────────────────────────────

/** 备课清单块 id 的前缀（引擎逐字：`prep-list:L${currentLesson}`）。 */
export const PREP_LIST_PREFIX = 'prep-list:'
/** 动画通报块 id 的前缀（引擎逐字：`animation-notice:${taskId}`）。 */
export const ANIMATION_NOTICE_PREFIX = 'animation-notice:'
/** 任务号形状（引擎逐字：`L<两位讲次>-T<两位回合>-<yyyyMMdd-HHmmss>`，冲突时带 `-<n>` 后缀）。 */
export const ANIMATION_TASK_ID_RE = /^L(\d{2})-T(\d{2})-(\d{8})-(\d{6})(?:-\d+)?$/
/**
 * 无讲次时的任务号形态（引擎逐字：讲次为 null 时 `lessonPart = 'Lxx'`）。
 * 🔴 它**不是**"合法任务号"（拿不到讲次就没法判讲次归属），只是**可被折算**：
 *    折算后仍是 `animation-notice:Lxx`，而推导侧只在该讲有备课条目时才预测 `L\d\d` 形态
 *    → 出现 `Lxx` 通报时**集合比对会报分歧**（响亮失败），正是我们要的。
 */
export const ANIMATION_TASK_ID_NO_LESSON_RE = /^Lxx-T(\d{2})-(\d{8})-(\d{6})(?:-\d+)?$/

/** 按讲次取教室声明的备课条目（与引擎 `prepItemsForLesson` 同一口径：`manifest.prep.items[].lesson`）。 */
export function prepItemsByLesson(manifest) {
  const byLesson = new Map()
  for (const item of manifest?.prep?.items ?? []) {
    if (!Number.isInteger(item?.lesson)) continue
    byLesson.set(item.lesson, (byLesson.get(item.lesson) ?? 0) + 1)
  }
  return byLesson
}

/**
 * 把"含不可预测维度"的块 id 折算成**可读的规范形**（**只用于证据与报错文案**，不用于集合比对）。
 *
 * 🔴 集合比对**不靠**折算：逐回合的严格比对只放"时机确定"的块（见 `predictAllTurns` 头注），
 *    动画通报由**会话级**子判据比（观察到的 ⊆ 可能出现的 ＋ 讲次／条数／时刻三条）。
 *    本函数只是把 `animation-notice:L01-T00-20260924-150326` 写成 `animation-notice:L01`，
 *    让证据文件与失败文案里"哪一讲的通报"一眼可读。
 */
export function canonicalBlockId(id) {
  if (typeof id !== 'string' || !id.startsWith(ANIMATION_NOTICE_PREFIX)) return id
  const taskId = id.slice(ANIMATION_NOTICE_PREFIX.length)
  const m = ANIMATION_TASK_ID_RE.exec(taskId)
  if (m !== null) return `${ANIMATION_NOTICE_PREFIX}L${m[1]}`
  if (ANIMATION_TASK_ID_NO_LESSON_RE.exec(taskId) !== null) return `${ANIMATION_NOTICE_PREFIX}Lxx`
  return id
}

/** 从通报块 id 里取出任务号（取不到 → null）。 */
export function animationNoticeTaskId(id) {
  if (typeof id !== 'string' || !id.startsWith(ANIMATION_NOTICE_PREFIX)) return null
  return id.slice(ANIMATION_NOTICE_PREFIX.length)
}

/**
 * 一次性推出"每个回合"的期望块清单（跨回合累积 once 记账，与生产口径一致）。
 *
 * 除 `manifest.blocks` 的静态规划结果外，另按**结构**建模两类运行期动态块（见本节头注）：
 *   · `prep-list:L<讲次>` —— 本轮讲次的第一个回合，且该讲有备课条目 → **进 `blocks`**（逐回合字面比对）；
 *   · `animation-notice:L<讲次>` —— 该讲有备课条目时的通报**规范形** → **不进 `blocks`**，
 *     单列在 `possibleAnimationNoticeLessons` 里，由 A2 的**会话级**子判据比（理由见下）。
 *
 * 🔴 **为什么通报不逐回合进 `blocks`**（这是本批**唯一**一处"不逐回合严格比对"的维度，理由必须写清）：
 *    通报的**出现与否**本身就是不可预测的 —— 它取决于"那段渲染在**本次会话结束前**有没有变终态"。
 *    实测两次完整跑就是两种结果：`runs/2026-09-24_150308` 有 1 条（turn 2），
 *    `runs/2026-09-24_152050` 也有 1 条（turn 2），而**同一讲只通报一次**（幂等门落在
 *    `task.json.announcedAt`）→ 于是它**可能**落在第 2 回合、**可能**落在第 3 回合、
 *    **也可能一条都没有**（渲染没赶上会话结束）。
 *    🔴 把它当"每回合必有"会**过预测**（ACCEPT-5 第一次完整跑就因此报了一条**我自己造的假红**，
 *    见报告的 §四.3）；把它从比对里**整条删掉**又是**放宽判据**（ACCEPT-4 明确不许）。
 *    → 折中且不放松的做法：**块本身留在模型里**（`possibleAnimationNoticeLessons`），
 *      会话级比"**观察到的通报 ⊆ 可能出现的通报**"，再用三条子判据（讲次归属／条数上界／
 *      通报时刻不早于任务创建时刻）把它钉住。**逐回合的严格集合比对**只施加在
 *      `blocks`（静态规划结果 ＋ 备课清单）上 —— 那两类的时机是**确定**的。
 *
 * @returns {{turn:number, phase:string, lesson:number, blocks:string[], prepListBlock:string|null,
 *            possibleAnimationNoticeBlocks:string[]}[]}
 */
export function predictAllTurns(manifest, { turnCount, phases, lesson }) {
  const injectedOnce = new Set()
  const lessonBook = new Map()
  const prepByLesson = prepItemsByLesson(manifest)
  const out = []
  for (let turn = 1; turn <= turnCount; turn += 1) {
    const phase = phases[turn - 1]
    const blocks = predictTurnBlocks(manifest, { phase, lesson, turn, injectedOnce, lessonBook })
    // ① 备课清单：本轮讲次的**第一个回合**发一条（引擎的 `prepListAnnouncedFor` 记账等价物）。
    //    🔴 本函数的 `lesson` 是**整个会话单一值**（引擎侧由 `runtime/progress.md` 的
    //       `current_lesson` 决定，本轮会话全程第 1 讲）→ "本轮讲次的第一个回合"就是 turn 1。
    //       会话中途换讲的情形不在本函数的输入里；真换讲时这里会**少推**一条，
    //       而 A2 的逐回合严格比对会把它报成"实际多出未预测的块"（响亮失败，不静默）。
    const firstTurnOfLesson = turn === 1
    const prepCount = prepByLesson.get(lesson) ?? 0
    const prepListBlock = prepCount > 0 && firstTurnOfLesson ? `${PREP_LIST_PREFIX}L${lesson}` : null
    // ② 动画通报：本讲有备课条目 → 通报**可能出现**（规范形）。**不进 `blocks`**，理由见头注。
    const possibleAnimationNoticeBlocks = prepCount > 0 ? [`${ANIMATION_NOTICE_PREFIX}L${String(lesson).padStart(2, '0')}`] : []
    out.push({
      turn,
      phase,
      lesson,
      blocks: [...blocks, ...(prepListBlock === null ? [] : [prepListBlock])],
      prepListBlock,
      possibleAnimationNoticeBlocks,
    })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 断言
// ─────────────────────────────────────────────────────────────────────────────

function result(id, name, ok, detail, evidence = {}) {
  return { id, name, ok, detail, evidence }
}

/**
 * 断言 1 · 材料按讲次给。
 * 会话里送进对话的材料**没有提前剧透后面讲次的故事节点**。
 */
export function assert1LessonGating(C) {
  const { analysis, manifest, classroomDir, frozenClassroomDir, lessonAtRunStart, runDir } = C
  const evidence = {}
  const failures = []

  // 1a 结构级：注入的 story.node.NN 必须只属于本轮要讲的讲次
  const storyNodes = analysis.injections
    .map((row) => ({ ...row, m: /^story\.node\.(\d+)$/.exec(row.block) }))
    .filter((row) => row.m !== null)
  const storyLessons = [...new Set(storyNodes.map((row) => Number.parseInt(row.m[1], 10)))]
  const wrongLesson = storyNodes.filter((row) => Number.parseInt(row.m[1], 10) !== lessonAtRunStart)
  evidence.storyNodeInjections = storyNodes.map((row) => ({ turn: row.turn, block: row.block, chars: row.chars }))
  evidence.lessonAtRunStart = lessonAtRunStart
  evidence.storyLessonsInjected = storyLessons
  if (wrongLesson.length > 0) {
    failures.push(`注入了非本轮讲次的故事节点：${JSON.stringify(wrongLesson.map((r) => `${r.block}@turn${r.turn}`))}`)
  }

  // 1b 内容级：注入文本里不得出现**后面讲次**故事节点的首行标题
  const leakTokens = []
  for (let n = 1; n <= 14; n += 1) {
    const file = join(frozenClassroomDir, 'story', `ch${String(n).padStart(2, '0')}.md`)
    if (!existsSync(file)) continue
    const firstHeading = readFileSync(file, 'utf8').split('\n').find((line) => line.startsWith('# '))
    if (firstHeading === undefined) continue
    leakTokens.push({ lesson: n, token: firstHeading.trim(), file })
  }
  const leaks = []
  for (const row of analysis.injections) {
    for (const text of row.texts) {
      for (const { lesson, token } of leakTokens) {
        if (lesson === lessonAtRunStart) continue
        if (text.includes(token)) leaks.push({ turn: row.turn, block: row.block, leakedLesson: lesson, token })
      }
    }
  }
  evidence.leakTokens = leakTokens.map((t) => ({ lesson: t.lesson, token: t.token }))
  evidence.leaks = leaks
  if (leaks.length > 0) failures.push(`注入文本里出现后面讲次的节点标题：${JSON.stringify(leaks)}`)

  // 1c 逐字级：story.node.01 的注入文本必须就是 story/ch01.md 的全文（证明给的是当讲那一份）
  const expectedFile = join(frozenClassroomDir, 'story', `ch${String(lessonAtRunStart).padStart(2, '0')}.md`)
  const expectedBlock = `story.node.${String(lessonAtRunStart).padStart(2, '0')}`
  const expectedText = `<system-reminder>\n${readFileSync(expectedFile, 'utf8').trim()}\n</system-reminder>`
  const got = analysis.injections.filter((row) => row.block === expectedBlock)
  evidence.exactMatch = {
    block: expectedBlock,
    occurrences: got.length,
    expectedSha256: sha256Text(expectedText),
    actualSha256: got.map((row) => sha256Text(row.texts.join('\n'))),
    expectedChars: expectedText.length,
    actualChars: got.map((row) => row.chars),
  }
  if (got.length === 0) failures.push(`从未注入 ${expectedBlock}（本轮要讲第 ${lessonAtRunStart} 讲）`)
  else if (!got.some((row) => sha256Text(row.texts.join('\n')) === sha256Text(expectedText))) {
    failures.push(`${expectedBlock} 的注入文本与 ${expectedFile} 的全文不一致`)
  }

  // 1d 该教室的讲次门清单本身（给人看的"这一讲都挂了哪些块"）
  const gated = manifest.blocks
    .filter((b) => b.lesson !== null && b.lesson !== undefined)
    .map((b) => ({ id: b.id, lesson: b.lesson }))
  evidence.lessonGatedBlocks = gated

  writeJson(join(runDir, '04-asserts', 'evidence', 'A1-材料按讲次给.json'), evidence)
  return result(
    'A1',
    '材料按讲次给（不提前剧透后面讲次的故事节点）',
    failures.length === 0,
    failures.length === 0
      ? `本轮要讲第 ${lessonAtRunStart} 讲；注入的 story.node 只有 ${JSON.stringify(storyLessons)}；` +
        `第 2–14 讲节点标题在注入文本里零命中；${expectedBlock} 与源文件逐字一致（sha256 相同）`
      : failures.join(' ｜ '),
    evidence,
  )
}

/**
 * 断言 2 · 材料按环节给。
 * 老师宣布换环节之后，下一个回合的材料集合按新环节变化（给出前后两份清单）。
 */
export function assert2PhaseGating(C) {
  const { analysis, manifest, phaseAtRunStart, lessonAtRunStart, runDir, phaseAfterRun } = C
  const evidence = {}
  const failures = []

  // 🔴 相位切换的**事实**取自工具返回值本身（`相位 <from> → <to>（可用：…）`）：
  //    不猜、也不假设"第一次调用就是那次切换"——模型可能先宣告 open 再宣告 probe，
  //    也可能把同一个相位再宣告一次（那是 no-op，不算"换了环节"）。
  const paired = pairToolCalls(analysis)
  const switches = paired
    .filter((c) => c.name === 'classroom_set_phase' && c.result !== null && c.result.isError === false)
    .map((c) => {
      // 🔴 相位 id 只取 `[A-Za-z_][\w-]*`：工具返回值是
      //   `相位 open → probe（可用：open/probe/…）｜第 2 回合｜…`，
      //   用 `\S+` 会把 `probe（可用：…）｜第` 整段吃进来（实测踩到 → 相位门判定全错、A2 假失败）。
      const m = /相位\s*([A-Za-z_][\w-]*)\s*→\s*([A-Za-z_][\w-]*)/.exec(c.result.text)
      return { turn: c.turn, callId: c.callId, from: m?.[1] ?? null, to: m?.[2] ?? null, resultText: c.result.text }
    })
  const effective = switches.filter((s) => s.from !== null && s.from !== s.to)
  evidence.allPhaseSwitches = switches
  evidence.effectivePhaseSwitches = effective
  evidence.phaseAtRunStart = phaseAtRunStart
  evidence.phaseAfterRun = phaseAfterRun

  // 🔴 只挑**有下一回合可比**的那次切换：断言要证的是"换环节之后**下一个回合**的材料变了"。
  //    实测踩到过：模型很乖地在最后一轮（收尾）才把相位切到 close，于是"最后一次切换"
  //    后面根本没有回合可比 → 假失败。取"最后一次仍然后续有回合"的切换才是断言的本意。
  const lastTurn = analysis.turns.length > 0 ? analysis.turns[analysis.turns.length - 1] : 0
  const comparable = effective.filter((s) => s.turn < lastTurn)
  evidence.lastTurn = lastTurn
  evidence.comparableSwitches = comparable

  if (effective.length === 0 || comparable.length === 0) {
    failures.push(
      `没有一次"有下一回合可比"的相位切换（全部切换：${JSON.stringify(switches.map((s) => `t${s.turn}:${s.from}→${s.to}`))}；` +
        `会话共 ${lastTurn} 轮）→ 无法判定"换环节之后材料是否变化"`,
    )
    writeJson(join(runDir, '04-asserts', 'evidence', 'A2-材料按环节给.json'), evidence)
    return result('A2', '材料按环节给（换环节后材料集合变化）', false, failures.join(' ｜ '), evidence)
  }

  const last = comparable[comparable.length - 1]
  const switchTurn = last.turn
  const nextTurn = switchTurn + 1
  const phaseBefore = last.from
  const phaseAfter = last.to
  evidence.phaseSwitch = {
    turn: switchTurn,
    phaseBefore,
    phaseAfter,
    callResult: last.resultText,
    comparedTurns: { before: switchTurn, after: nextTurn },
  }

  const before = injectionListOf(analysis, switchTurn)
  const after = injectionListOf(analysis, nextTurn)
  evidence.materialsBefore = before
  evidence.materialsAfter = after

  if (after.length === 0) {
    failures.push(`turn ${nextTurn} 没有任何注入 → 无法比较（会话是否只跑到 turn ${switchTurn}？）`)
  }

  // 独立推导：两回合各自"应当"注入哪些块
  // 🔴 相位序列的口径：`classroom_set_phase` 是在 **turn `switchTurn` 之内**调的，
  //    而引擎在**回合开头**就按当时的相位把材料注入完了（工具调用在注入之后）→
  //    turn `switchTurn` 仍是**旧相位** `phaseBefore`，新相位从 **turn `nextTurn`** 起生效。
  const predicted = predictAllTurns(manifest, {
    turnCount: nextTurn,
    phases: Array.from({ length: nextTurn }, (_, i) => (i + 1 <= switchTurn ? phaseBefore : phaseAfter)),
    lesson: lessonAtRunStart,
  })
  evidence.predicted = predicted
  const pBefore = predicted.find((p) => p.turn === switchTurn)
  const pAfter = predicted.find((p) => p.turn === nextTurn)
  // 🔴 两套比对面，各按各的可预测性：
  //   · **逐回合严格集合比对**（下面这两个 a*）：只放"时机确定"的块 ——
  //     manifest 静态规划结果 ＋ 备课清单（`prep-list:L<讲次>`）。
  //     故这里把**动画通报**从实际注入里摘出来（它由会话级子判据单独比，理由见下与本节头注）。
  //   · **会话级**：通报比"观察到的 ⊆ 可能出现的"＋三条子判据。
  const isAnimationNotice = (id) => typeof id === 'string' && id.startsWith(ANIMATION_NOTICE_PREFIX)
  const aBefore = before.map((r) => r.block).filter((b) => !isAnimationNotice(b)).sort()
  const aAfter = after.map((r) => r.block).filter((b) => !isAnimationNotice(b)).sort()
  evidence.comparison = {
    observedBefore: aBefore,
    observedAfter: aAfter,
    observedBeforeRaw: before.map((r) => r.block).sort(),
    observedAfterRaw: after.map((r) => r.block).sort(),
    predictedBefore: pBefore?.blocks.slice().sort() ?? null,
    predictedAfter: pAfter?.blocks.slice().sort() ?? null,
    onlyInBefore: aBefore.filter((b) => !aAfter.includes(b)),
    onlyInAfter: aAfter.filter((b) => !aBefore.includes(b)),
    comparedSetExcludes: `动画通报（${ANIMATION_NOTICE_PREFIX}…）：它的**出现时机**不可预测（见「运行期动态块」节头注），故不在逐回合集合比对里；由下面的会话级子判据比`,
  }

  // ── 会话级通报子判据（把"不进逐回合严格比对"的那一维钉住）──────────────────────
  // ① 任务号形状必须合法（`L<两位讲次>-T<两位回合>-<yyyyMMdd-HHmmss>`，可带 `-<n>` 冲突后缀）；
  // ② 通报的**讲次**必须落在**本次会话可能出现的通报讲次**里（＝"观察到的 ⊆ 可能出现的"）；
  // ③ 每讲通报条数 ≤ 该讲声明的备课条目数（预热是这些条目的唯一来源；同一任务只通报一次）；
  // ④ 通报时刻不得早于任务创建时刻（任务号里的 `T<回合>` 必须早于通报所在回合）。
  const prepByLesson = prepItemsByLesson(manifest)
  const declaredLessons = [...prepByLesson.keys()].sort((a, b) => a - b)
  const possibleNoticeLessons = predicted.flatMap((p) => p.possibleAnimationNoticeBlocks).map((b) => Number.parseInt(b.slice(ANIMATION_NOTICE_PREFIX.length + 1), 10))
  const possibleLessons = [...new Set(possibleNoticeLessons)].sort((a, b) => a - b)
  const notices = analysis.injections
    .map((row) => ({ turn: row.turn, id: row.block, taskId: animationNoticeTaskId(row.block) }))
    .filter((row) => row.taskId !== null)
    .map((row) => {
      const m = ANIMATION_TASK_ID_RE.exec(row.taskId)
      return {
        ...row,
        lesson: m === null ? null : Number.parseInt(m[1], 10),
        taskTurn: m === null ? null : Number.parseInt(m[2], 10),
        // 任务号里的时间戳 `yyyyMMdd-HHmmss`（本地时间）→ 用于判"通报不早于任务创建"
        createdAt: m === null ? null : `${m[3].slice(0, 4)}-${m[3].slice(4, 6)}-${m[3].slice(6, 8)}T${m[4].slice(0, 2)}:${m[4].slice(2, 4)}:${m[4].slice(4, 6)}`,
      }
    })
  const malformed = notices.filter(
    (row) => ANIMATION_TASK_ID_RE.exec(row.taskId) === null && ANIMATION_TASK_ID_NO_LESSON_RE.exec(row.taskId) === null,
  )
  // 🔴 无讲次的形态（`Lxx-…`）：形状**合法**，但**没有讲次** → 讲次归属判不了。
  //    单列一条（不是"形状不合法"，也不是"讲次不在声明里"），报出来让人一眼看清是什么。
  const noLessonNotices = notices.filter((row) => ANIMATION_TASK_ID_NO_LESSON_RE.exec(row.taskId) !== null)
  const noticeLessons = [...new Set(notices.map((row) => row.lesson).filter((n) => Number.isInteger(n)))].sort((a, b) => a - b)
  const undeclaredNotices = notices.filter((row) => !Number.isInteger(row.lesson) || !possibleLessons.includes(row.lesson))
  const perLessonCounts = {}
  for (const row of notices) {
    if (Number.isInteger(row.lesson)) perLessonCounts[row.lesson] = (perLessonCounts[row.lesson] ?? 0) + 1
  }
  const overCount = Object.entries(perLessonCounts).filter(([lesson, n]) => n > (prepByLesson.get(Number.parseInt(lesson, 10)) ?? 0))
  // 通报时刻 vs 任务创建时刻：任务号里记着创建时的回合号与时间戳（本地时间）。
  // 通报发生在**创建之后**，故 `taskTurn <= noticeTurn - 1`，且创建时刻不得晚于通报所在回合的结束。
  const timing = notices
    .filter((row) => row.taskTurn !== null)
    .map((row) => ({ ...row, timingOk: row.taskTurn <= row.turn - 1 }))
  const timingBad = timing.filter((row) => !row.timingOk)
  evidence.dynamicBlocks = {
    rule: {
      prepList:
        '教室 animation.enabled ∧ 本讲 prep.items 条数 > 0 ∧ 本讲未发过 → 本轮讲次**第一个回合**注入一条 `prep-list:L<讲次>`；' +
        '一讲至多一条、讲次变化重发。**时机确定**（引擎在回合边界的 pre-step 里判）→ 进**逐回合严格集合比对**，字面比。',
      animationNotice:
        '存在终态(ready/blocked/failed)且 announcedAt 为空的动画任务 → 每回合开头各通报一条 `animation-notice:<任务号>`，取到即标记（同一任务至多一次）。' +
        '🔴 **出现与否本身不可预测**：取决于"那段渲染在本次会话结束前有没有变终态"（渲染耗时可长可短）→ 不进逐回合严格比对；' +
        '改由**会话级**比"**观察到的通报 ⊆ 可能出现的通报**"（可能集合＝本轮讲次在 `prep.items` 里有条目的那些讲）＋下面四条子判据。' +
        '任务号里**讲次可预测**（由该讲备课条目预热而来）→ 讲次字面比；**回合号与时间戳不可预测**（通报发生在任务变终态之后的下一个回合；时间戳是任务创建时刻到秒）→ 这两维不参与比对，改用"条数上界"与"通报不早于创建"两条判据钉住。',
      note: '老师课上现起的动画（origin=teacher）其存在与条数不在教室数据里 → 本模型不预测；一旦出现即由下面的子判据判失败（不静默放过）。',
    },
    declaredPrepLessons: declaredLessons,
    possibleNoticeLessons: possibleLessons,
    observedNoticeTaskIds: notices.map((r) => ({ turn: r.turn, taskId: r.taskId, lesson: r.lesson, taskTurn: r.taskTurn, createdAt: r.createdAt })),
    noticeLessons,
    perLessonCounts,
    malformedTaskIds: malformed,
    noLessonTaskIds: noLessonNotices.map((r) => ({ turn: r.turn, taskId: r.taskId })),
    undeclaredLessons: undeclaredNotices.map((r) => ({ turn: r.turn, taskId: r.taskId })),
    overCount,
    timingBad: timingBad.map((r) => ({ turn: r.turn, taskId: r.taskId, taskTurn: r.taskTurn })),
  }

  if (JSON.stringify(aBefore) !== JSON.stringify(pBefore?.blocks.slice().sort() ?? null)) {
    failures.push(
      `turn ${switchTurn} 实际注入 ${JSON.stringify(aBefore)} ≠ 独立推导 ${JSON.stringify(pBefore?.blocks.slice().sort() ?? null)}`,
    )
  }
  if (JSON.stringify(aAfter) !== JSON.stringify(pAfter?.blocks.slice().sort() ?? null)) {
    failures.push(
      `turn ${nextTurn} 实际注入 ${JSON.stringify(aAfter)} ≠ 独立推导 ${JSON.stringify(pAfter?.blocks.slice().sort() ?? null)}`,
    )
  }
  if (JSON.stringify(aBefore) === JSON.stringify(aAfter)) {
    failures.push(`turn ${switchTurn} 与 turn ${nextTurn} 的材料集合完全相同 → 换环节没有换来材料`)
  }
  if (malformed.length > 0) {
    failures.push(
      `动画通报的任务号形状不合法（应为 \`L<两位讲次>-T<两位回合>-<yyyyMMdd-HHmmss>\`）：${JSON.stringify(malformed.map((r) => r.taskId))}`,
    )
  }
  if (noLessonNotices.length > 0) {
    failures.push(
      `动画通报的任务号里**没有讲次**（形态 \`Lxx-…\`）→ 讲次归属判不了、也与教室 prep 声明对不上：` +
        `${JSON.stringify(noLessonNotices.map((r) => `t${r.turn}:${r.taskId}`))}`,
    )
  }
  if (undeclaredNotices.length > 0) {
    failures.push(
      `动画通报的讲次**不在"可能出现的通报"里**（本轮可能集合 ${JSON.stringify(possibleLessons)}，教室 prep 声明 ${JSON.stringify(declaredLessons)}）：` +
        `${JSON.stringify(undeclaredNotices.map((r) => `t${r.turn}:${r.taskId}`))}`,
    )
  }
  if (overCount.length > 0) {
    failures.push(
      `某一讲的动画通报条数超过该讲声明的备课条目数：${JSON.stringify(overCount)}（声明 ${JSON.stringify(Object.fromEntries(prepByLesson))}）`,
    )
  }
  if (timingBad.length > 0) {
    failures.push(
      `动画通报的时刻**早于**它自己任务号里记的创建回合（不可能发生）→ 任务号与通报对不上：` +
        `${JSON.stringify(timingBad.map((r) => `通报 t${r.turn} 但任务号写 T${String(r.taskTurn).padStart(2, '0')}`))}`,
    )
  }

  writeJson(join(runDir, '04-asserts', 'evidence', 'A2-材料按环节给.json'), evidence)
  const noticeNote =
    notices.length === 0
      ? `动画通报：本次会话 0 条（可能出现的是讲 ${JSON.stringify(possibleLessons)}；通报取决于渲染有没有在会话结束前变终态 → **0 条不算失败**）`
      : `动画通报：${notices.length} 条（${notices.map((r) => `t${r.turn}:${r.taskId}`).join('、')}）；讲次 ${JSON.stringify(noticeLessons)} ⊆ 可能集合 ${JSON.stringify(possibleLessons)}`
  return result(
    'A2',
    '材料按环节给（换环节后下一回合材料集合变化）',
    failures.length === 0,
    failures.length === 0
      ? `turn ${switchTurn}（${phaseBefore}）：${JSON.stringify(aBefore)} → ` +
        `turn ${nextTurn}（${phaseAfter}）：${JSON.stringify(aAfter)}；` +
        `去掉 ${JSON.stringify(evidence.comparison.onlyInBefore)}，新增 ${JSON.stringify(evidence.comparison.onlyInAfter)}；` +
        noticeNote
      : failures.join(' ｜ '),
    evidence,
  )
}

/** 断言 3 · 工具可用：老师能查到教室状态与当前讲次/环节。 */
export function assert3Tools(C) {
  const { analysis, runDir, workClassroomDir, phaseAfterRun } = C
  const evidence = {}
  const failures = []
  const paired = pairToolCalls(analysis)
  evidence.toolCalls = paired.map((c) => ({
    turn: c.turn,
    name: c.name,
    hasResult: c.result !== null,
    isError: c.result?.isError ?? null,
    resultHead: (c.result?.text ?? '').slice(0, 400),
  }))

  const status = paired.filter((c) => c.name === 'classroom_status')
  evidence.classroomStatus = status.length
  if (status.length === 0) failures.push('模型没有调用 classroom_status')
  else {
    const ok = status.find((c) => c.result !== null && c.result.isError === false)
    if (ok === undefined) failures.push('classroom_status 没有成功返回（tool/result 缺失或 isError）')
    else if (!/cs-os/.test(ok.result.text)) failures.push(`classroom_status 的返回值里没有教室 id：${ok.result.text.slice(0, 200)}`)
  }

  const setPhase = paired.filter((c) => c.name === 'classroom_set_phase')
  evidence.classroomSetPhase = setPhase.length
  if (setPhase.length === 0) failures.push('模型没有调用 classroom_set_phase')
  else {
    const ok = setPhase.find((c) => c.result !== null && c.result.isError === false)
    if (ok === undefined) failures.push('classroom_set_phase 没有成功返回')
  }

  // 落盘侧证据：相位真的写回了教室 runtime/progress.md
  const progressFile = join(workClassroomDir, 'runtime', 'progress.md')
  const progressText = existsSync(progressFile) ? readFileSync(progressFile, 'utf8') : ''
  const phaseLine = /^current_phase:\s*(\S+)\s*$/m.exec(progressText)
  evidence.progressPhaseLine = phaseLine === null ? null : phaseLine[0].trim()
  evidence.progressPhaseFile = progressFile
  // 交叉核对：progress.md 里的相位 vs **工具返回值里最后宣布的那个相位**
  //   （两个独立通道：一个是宿主文件，一个是工具的返回消息）
  const declared = setPhase
    .filter((c) => c.result !== null && c.result.isError === false)
    .map((c) => ({ turn: c.turn, to: /相位\s*[A-Za-z_][\w-]*\s*→\s*([A-Za-z_][\w-]*)/.exec(c.result.text)?.[1] ?? null }))
    .filter((d) => d.to !== null)
  evidence.declaredPhases = declared
  const lastDeclared = declared.length > 0 ? declared[declared.length - 1].to : null
  evidence.lastDeclaredPhase = lastDeclared
  if (phaseLine === null) failures.push(`教室 runtime/progress.md 里没有 current_phase 行（相位未落盘）：${progressFile}`)
  else {
    if (phaseAfterRun !== null && phaseLine[1] !== phaseAfterRun) {
      failures.push(`progress.md 的 current_phase=${phaseLine[1]} 与运行后读到的 ${phaseAfterRun} 不一致`)
    }
    if (lastDeclared !== null && phaseLine[1] !== lastDeclared) {
      failures.push(`progress.md 的 current_phase=${phaseLine[1]} 与工具最后宣布的 ${lastDeclared} 不一致`)
    }
  }

  writeJson(join(runDir, '04-asserts', 'evidence', 'A3-工具可用.json'), evidence)
  return result(
    'A3',
    '工具可用（能查到教室状态与当前讲次/环节）',
    failures.length === 0,
    failures.length === 0
      ? `classroom_status 调用 ${status.length} 次且成功返回教室 id；classroom_set_phase 调用 ${setPhase.length} 次且成功；` +
        `progress.md 已落盘 \`${phaseLine[0].trim()}\``
      : failures.join(' ｜ '),
    evidence,
  )
}

/**
 * 断言 4 · 课后写入（追加 + 幂等）。
 * 学生说"今天到这"后，教室的课堂摘要文件被追加了新内容；重复结束不会重复追加。
 */
export function assert4PostClass(C) {
  const { runDir, workClassroomDir, sessionLogBefore, sessionLogAfter, idempotency, analysis, studentEndTurnText } = C
  const evidence = {}
  const failures = []

  const diff = appendedLines(sessionLogBefore, sessionLogAfter)
  evidence.file = join(workClassroomDir, 'runtime', 'session_log.md')
  evidence.bytesBefore = sessionLogBefore.length
  evidence.bytesAfter = sessionLogAfter.length
  evidence.commonPrefixLines = diff.commonPrefixLines
  evidence.addedLines = diff.added
  evidence.removedTailLines = diff.removedTail
  evidence.changed = sessionLogBefore !== sessionLogAfter

  if (!evidence.changed) failures.push('课堂摘要文件 session_log.md 在会话后没有任何变化 → 课后写入没发生')

  const markers = [...sessionLogAfter.matchAll(/<!-- socratic-engine:session=(\S+) turn=(\d+) -->/g)].map((m) => ({
    session: m[1],
    turn: m[2],
    full: m[0],
  }))
  const counts = new Map()
  for (const m of markers) counts.set(m.full, (counts.get(m.full) ?? 0) + 1)
  const duplicated = [...counts.entries()].filter(([, n]) => n > 1)
  evidence.markers = markers
  evidence.duplicatedMarkers = duplicated
  if (markers.length === 0) failures.push('追加内容里没有 socratic-engine 的回合标记 → 不是课后更新写的')
  if (duplicated.length > 0) failures.push(`同一个 (session, turn) 标记出现多次：${JSON.stringify(duplicated)}`)

  // 追加内容必须含学生原话（确定性事实，不是模型生成）
  const addedStudentLines = diff.added.filter((line) => line.startsWith('- 学生：'))
  evidence.addedStudentLines = addedStudentLines
  const wanted = String(studentEndTurnText ?? '').trim().slice(0, 6)
  if (addedStudentLines.length === 0) failures.push('追加内容里没有"学生："行 → 没有记录学生的结束发言')
  else if (wanted !== '' && !addedStudentLines.some((line) => line.includes(wanted))) {
    failures.push(`追加的"学生："行里没有出现结束发言片段 ${JSON.stringify(wanted)}：${JSON.stringify(addedStudentLines)}`)
  }

  // 幂等：确定性重放探针
  //   A 段（干净起点，取自冻结教室的 runtime/）：第 1 次写盘、第 2 次零字节变化、标记恰好 1 次
  //   B 段（跑完的教室 runtime/）：再 fire 一次必须零变化（该回合已经写过了）
  evidence.idempotencyReplay = idempotency
  if (idempotency === null || idempotency === undefined) {
    failures.push('幂等重放探针没有产出结果')
  } else if (idempotency.ok !== true) {
    failures.push(`幂等重放探针失败：${JSON.stringify(idempotency.verdict ?? idempotency.error ?? null)}`)
  }

  evidence.turnsWithStudentMessages = [...new Set(analysis.studentMessages.map((m) => m.turn))]
  evidence.postclassEntriesForRun = markers.length

  writeJson(join(runDir, '04-asserts', 'evidence', 'A4-课后写入.json'), evidence)
  return result(
    'A4',
    '课后写入（追加新内容，且重复结束不重复追加）',
    failures.length === 0,
    failures.length === 0
      ? `session_log.md ${evidence.bytesBefore} → ${evidence.bytesAfter} 字节，追加 ${diff.added.length} 行（含结束发言那条）；` +
        `(session,turn) 标记 ${markers.length} 个、无重复；` +
        `重放探针 A：第 1 次写盘 / 第 2 次零字节变化 / 标记恰好 1 次；B：对跑完的文件再 fire 零变化`
      : failures.join(' ｜ '),
    evidence,
  )
}

/** 断言 5 · 不重复送：同一回合内没有把同一份材料送两遍。 */
export function assert5NoDuplicateInjection(C) {
  const { analysis, runDir } = C
  const evidence = {}
  const failures = []
  const perTurn = {}
  for (const row of analysis.injections) {
    const key = String(row.turn)
    perTurn[key] ??= []
    perTurn[key].push(row)
  }
  evidence.perTurn = {}
  for (const [turn, rows] of Object.entries(perTurn)) {
    const blocks = rows.map((r) => r.block)
    const blockDup = blocks.filter((b, i) => blocks.indexOf(b) !== i)
    const hashes = rows.map((r) => sha256Text(r.texts.join('\n')))
    const textDup = hashes.filter((h, i) => hashes.indexOf(h) !== i)
    evidence.perTurn[turn] = {
      blocks,
      blockDuplicates: [...new Set(blockDup)],
      textDuplicates: [...new Set(textDup)],
      chars: rows.reduce((n, r) => n + r.chars, 0),
    }
    if (blockDup.length > 0) failures.push(`turn ${turn} 同一块送了多次：${JSON.stringify([...new Set(blockDup)])}`)
    if (textDup.length > 0) failures.push(`turn ${turn} 同一份文本送了多次：${JSON.stringify([...new Set(textDup)])}`)
  }
  evidence.totalInjections = analysis.injections.length
  evidence.turns = Object.keys(perTurn)

  writeJson(join(runDir, '04-asserts', 'evidence', 'A5-不重复送.json'), evidence)
  return result(
    'A5',
    '不重复送（同一回合内没有把同一份材料送两遍）',
    failures.length === 0,
    failures.length === 0
      ? `${analysis.injections.length} 条注入，覆盖 ${Object.keys(perTurn).length} 个回合；每个回合内块 id 与文本 sha256 均无重复`
      : failures.join(' ｜ '),
    evidence,
  )
}

/**
 * 断言 6 · 静默失败检查。
 * 拆成五小项，任一小项失败即整条失败：
 *   6.1 日志桥可用（exporter 注册成功）＋ 正向对照到达（证明桥真的能收消息）
 *   6.2 被测插件的日志是否真的落到了可观测处（期望 ≥1 条 name === '[socratic-engine]'）
 *   6.3 进程 stdout/stderr 里的错误/警告扫描（全部打印，不筛不藏）
 *   6.4 静态：被测插件里"吞掉异常"的 catch 点清点（只作参考信息）
 *   6.5 🔴 ACCEPT-2 新增：**宿主告警归属断言**——日志桥收到的 error/warn 里，
 *       出现**不在白名单内**的新条目 → 整条 A6 判失败（白名单与逐条理由见 lib/whitelist.mjs）。
 *
 * 🔴 为什么把它挂在 A6 之下（而不是新开一条 A7）：
 *   · A6 的主题是"有没有什么东西被静默吞掉/静默漏掉"，而"宿主告警没人看"正是同一主题的
 *     另一种形态（看得见了但没人管）——它天然属于 6.x 家族，且 A6 本来就是多小项结构；
 *   · 宿主告警的**输入**就是 A6.1 那套日志桥（`logMessages`），A7 会重复取数、重复解释桥；
 *   · 既有 A1–A6 的编号与语义因此**一个都不动**（新增小项只在 A6 内部）。
 */
export function assert6SilentFailure(C) {
  const { runDir, logProbe, logMessages, processOutput, frozenPluginDir } = C
  const evidence = {}
  const failures = []

  evidence.logProbe = logProbe
  evidence.logMessagesTotal = logMessages.length
  evidence.logMessageNames = [...new Set(logMessages.map((m) => m.name))]

  // 6.1 桥 + 正向对照（三个级别各一条，必须都到达；否则"桥不工作"）
  const control = logProbe?.positiveControl
  evidence.positiveControl = control
  if (logProbe === null || logProbe === undefined) {
    failures.push('6.1 日志桥探针没有产出结果（exporter 未注册或未落盘）')
  } else if (logProbe.exporterMethodAvailable !== true) {
    failures.push('6.1 ctx.logger.exporter 不可用 → 日志桥注册失败，headless 下日志无处可去')
  } else if ((control?.received ?? 0) < 1) {
    failures.push(`6.1 正向对照未到达日志桥（received=${control?.received}）→ 桥本身不工作，后续判定不可信`)
  }

  // 6.2 被测插件的日志
  const engineMessages = logMessages.filter((m) => m.name === '[socratic-engine]')
  evidence.engineMessages = engineMessages
  evidence.engineMessageCount = engineMessages.length
  evidence.engineShape = logProbe?.engineShape ?? null
  if (engineMessages.length === 0) {
    failures.push(
      '6.2 被测插件的日志一条都没到达可观测处（期望 ≥1 条 name="[socratic-engine]"）：' +
        '插件 index.mjs 的 log() 用 `ctx.logger?.(name, ...args)` 这条**错误调用形状**' +
        '（cordis 的 `ctx.logger(name)` 只接受 name 一个参数，返回 Logger；正确用法是 `ctx.logger(name).warn(...)`）' +
        '→ 参数被丢弃、返回的 Logger 被抛弃，所有报错/警告**全部静默消失**；' +
        '因此本次运行**无法排除静默失败**（同级别、同出口的形状对照 received=' +
        `${logProbe?.engineShape?.shapeControlReceived} 证明通道本身是通的）`,
    )
  }

  // 6.3 进程输出 + cordis 日志里的错误/警告（全部打印，不筛不藏）
  const outText = `${processOutput?.stdout ?? ''}\n${processOutput?.stderr ?? ''}`
  const lines = outText.split('\n')
  const suspects = lines.filter((line) => /error|Error|ERROR|warn|Warn|WARN|失败|异常|🔴|Unhandled|reject/i.test(line))
  evidence.processOutputSuspectLines = suspects
  evidence.processOutputSuspectCount = suspects.length
  evidence.processOutputTotalLines = lines.length
  evidence.redFlagCount = lines.filter((line) => line.includes('🔴')).length
  const fatal = lines.filter((line) => /Unhandled|unhandledRejection|FATAL|Cannot read properties of undefined/i.test(line))
  evidence.processOutputFatalLines = fatal
  if (fatal.length > 0) failures.push(`6.3 进程输出里有致命错误行：${JSON.stringify(fatal.slice(0, 5))}`)

  // cordis 日志里 host/其他插件记下的 error/warn（这是"该有的报错"，必须摆出来）
  const cordisProblems = logMessages.filter((m) => m.type === 'error' || m.type === 'warn')
  evidence.cordisProblemMessages = cordisProblems
  evidence.cordisProblemCount = cordisProblems.length

  // 6.4 静态清点：吞异常的 catch 点（遍历冻结副本里的**全部** .mjs，不挑文件）
  const swallowSites = []
  const mjsFiles = []
  const collect = (dir, prefix = '') => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        collect(full, rel)
      } else if (entry.isFile() && entry.name.endsWith('.mjs')) mjsFiles.push(rel)
    }
  }
  collect(frozenPluginDir)
  mjsFiles.sort()
  for (const rel of mjsFiles) {
    const file = join(frozenPluginDir, rel)
    const text = readFileSync(file, 'utf8')
    const re = /catch\s*(?:\([^)]*\))?\s*\{([\s\S]{0,200}?)\}/g
    let m
    let count = 0
    while ((m = re.exec(text)) !== null) {
      const body = m[1].trim()
      const silent = body === '' || /^\/\*[\s\S]*\*\/$/.test(body) || /^\/\//.test(body)
      count += 1
      if (silent) swallowSites.push({ file: rel, body: body.replace(/\s+/g, ' ').slice(0, 80) })
    }
    evidence[`catchSites_${rel}`] = count
  }
  evidence.scannedFiles = mjsFiles
  evidence.silentSwallowSites = swallowSites

  // ── 6.5 宿主告警归属断言（ACCEPT-2 新增）────────────────────────────────────
  //   规则：日志桥收到的 error/warn 里，出现**不在白名单内**的条目 → 失败。
  //   白名单逐条理由见 lib/whitelist.mjs（每条都指向外部取证件《宿主告警排查 2026-09-24》）。
  const whitelist = classifyAll(logMessages)
  evidence.hostWarnings = {
    ruleCatalog: ruleCatalog(),
    ...whitelist,
  }
  if (logProbe === null || logProbe === undefined) {
    failures.push('6.5 无法判定宿主告警归属：日志桥探针没有产出结果（见 6.1）')
  } else if (logProbe.exporterMethodAvailable !== true) {
    failures.push('6.5 无法判定宿主告警归属：日志桥 exporter 未注册（见 6.1）')
  } else if (whitelist.totalMessages === 0) {
    // 🔴 桥注册成功、正向对照也到达，却一条日志都没收到 → 不能静默通过，必须报出来
    failures.push(
      '6.5 桥已注册且正向对照到达，但日志文件里一条消息都没有 → "没有非白名单告警"这个结论不成立' +
        `（证据文件：${join(runDir, '03-session')}）`,
    )
  } else if (whitelist.unmatched > 0) {
    failures.push(
      `6.5 出现 ${whitelist.unmatched} 条**不在白名单内**的宿主告警（可能是新引入的问题，也可能是白名单过期）：` +
        whitelist.unmatchedMessages
          .map((m) => `[${m.type}] ${m.name} :: ${m.argsText.replace(/\s+/g, ' ').slice(0, 200)}`)
          .join(' ｜ ') +
        ` —— 若确认它不归我们，请按 lib/whitelist.mjs 的纪律（写明理由＋指向取证件）加白；` +
        `不许"看不懂就加白"`,
    )
  }

  writeJson(join(runDir, '04-asserts', 'evidence', 'A6-静默失败检查.json'), evidence)
  writeText(join(runDir, '04-asserts', 'evidence', 'A6-进程原始输出.txt'), outText)
  // 宿主告警归属单独落一份（便于人直接看，不用在 A6 大 JSON 里翻）
  writeJson(join(runDir, '04-asserts', 'evidence', 'A6-5-宿主告警归属.json'), whitelist)
  writeText(join(runDir, '04-asserts', 'evidence', 'A6-5-宿主告警归属.md'), renderHostWarningReport(whitelist))

  const ok = failures.length === 0
  return result(
    'A6',
    '静默失败检查（插件有没有把错误吞掉；宿主告警有没有非白名单新条目）',
    ok,
    ok
      ? `日志桥可用且正向对照到达；被测插件日志 ${engineMessages.length} 条全部可见；进程输出里无致命错误；` +
        renderSummary(whitelist)
      : failures.join(' ｜ '),
    evidence,
  )
}

/** 把宿主告警归属渲染成人读的一页（谁、为什么在名单里、有没有新条目）。 */
function renderHostWarningReport(summary) {
  const lines = [
    '# 宿主告警归属（A6.5）',
    '',
    `- 日志桥共收：**${summary.totalMessages}** 条；其中 error/warn：**${summary.problemMessages}** 条`,
    `- 白名单内：**${summary.whitelisted}** 条；🔴 不在白名单：**${summary.unmatched}** 条`,
    '',
    '## 命中的白名单规则（每条都写明"为什么不是我们的问题"）',
    '',
    '| 规则 | 命中 | 为什么它不是我们的问题 | 取证依据 |',
    '|---|---|---|---|',
    ...summary.matchedRules.map(
      (r) => `| \`${r.ruleId}\` | ${r.count} | ${r.why.replaceAll('|', '\\|')} | ${r.source} |`,
    ),
    '',
    summary.staleRules.length > 0
      ? `⚠️ **本次未被命中的白名单规则**（宿主可能改了名/路径，白名单可能已过期，请复核）：${summary.staleRules
          .map((r) => `\`${r.ruleId}\``)
          .join('、')}\n`
      : '（全部白名单规则本次都命中过 → 白名单没有明显过期项）\n',
    '## 不在白名单的条目（有则必须处理：确认归属后加白，或修）',
    '',
    ...(summary.unmatchedMessages.length === 0
      ? ['（无）']
      : summary.unmatchedMessages.map(
          (m) => `- \`[${m.type}]\` \`${m.name}\` :: ${m.argsText.replace(/\s+/g, ' ').slice(0, 400)}`,
        )),
    '',
    '## 按模块名分布（error/warn）',
    '',
    '| 模块名 | 条数 |',
    '|---|---|',
    ...Object.entries(summary.byName)
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `| \`${name}\` | ${n} |`),
    '',
  ]
  return lines.join('\n')
}

/** 依次跑六条断言，返回结果数组。 */
export function runAll(C) {
  return [assert1LessonGating(C), assert2PhaseGating(C), assert3Tools(C), assert4PostClass(C), assert5NoDuplicateInjection(C), assert6SilentFailure(C)]
}
