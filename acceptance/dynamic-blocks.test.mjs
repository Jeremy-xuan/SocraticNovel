#!/usr/bin/env node
// dynamic-blocks.test.mjs — ACCEPT-5 · A2 推导模型里两类**运行期动态块**的单测（不跑会话、不花钱）
//
// 用法：
//   node acceptance/dynamic-blocks.test.mjs
//
// 退出码：0 = 全部通过；1 = 有失败。
//
// 🔴 它证明什么（每一条都是"判据没有被放宽成不比对"的直接证据）
//   ① `prep-list` **进**逐回合严格比对（时机确定：本轮讲次第一个回合，且该讲有备课条目）
//      —— 用**两次真实完整跑**的注入事实对账（`runs/` 是运行产物，干净树里没有 → 不算失败）；
//   ② `animation-notice` **不进**逐回合严格比对（出现与否取决于渲染有没有赶上会话结束），
//      但它**没有被删掉**：模型里给出"可能出现"的讲次集合（＝本轮讲次在 `prep.items` 里有条目）；
//   ③ 会话级子判据真的钉得住：讲次不同的通报、多出来的通报、条数超上界的通报、
//      通报时刻早于任务创建时刻的通报 —— **四类各自有反例**，必须报分歧；
//   ④ 没有备课条目的讲 → 两类块**都不预测**（不是"永远预测一条"的假绿）；
//      🔴 本教室每一讲都有备课条目时，这一形态**显式写"不适用"**（不是"跳过通过"）；
//   ⑤ 任务号形状判据：合法形状（含冲突后缀）通过，坏形状被抓住；
//   ⑥ `canonicalBlockId` 只用于**证据可读性**（`animation-notice:L01-…` → `animation-notice:L01`），
//      讲次逐字保留、其它块一个字节不动。
//
// 🔴 本文件的断言**一律是关系断言**（从 manifest 自身推导），不写死"应该有哪些讲次/每讲几条"：
//    · 上界来源＝教室自己声明的 `classroom.lessons`；
//    · 会话用的那一讲＝教室声明的第一个有备课条目的讲次；
//    · "无备课条目的讲"＝从 1..讲数 里找出的**空缺**；
//    · "条数超上界"＝发本讲声明条数 **+1** 条。
//    写死常量的代价见 `checkPrepStructure` 的头注（改课程表就红、且**验不到结构**）。
//    🔴 结构判据另配 **8 条负向对照**（讲次越界／非整数／material 不存在／绝对路径／缺字段／
//       template 空串／id 重复／整段删空）＋ 1 条正向对照 —— 证明它不是空壳。

import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadManifest } from '../plugins/socratic-engine/lib/manifest.mjs'
import {
  ANIMATION_NOTICE_PREFIX,
  ANIMATION_TASK_ID_RE,
  ANIMATION_TASK_ID_NO_LESSON_RE,
  animationNoticeTaskId,
  canonicalBlockId,
  predictAllTurns,
  prepItemsByLesson,
} from './lib/asserts.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CODE_DIR = resolve(HERE, '..')
const CLASSROOM_DIR = join(CODE_DIR, 'classrooms', 'cs-os')

const failures = []
const ok = (text) => console.log(`  ✔ ${text}`)
const bad = (text) => {
  failures.push(text)
  console.log(`  ✖ ${text}`)
}
const eq = (a, b, label) => {
  const sa = JSON.stringify(a)
  const sb = JSON.stringify(b)
  if (sa === sb) ok(`${label}：${sa}`)
  else bad(`${label}：${sa} ≠ ${sb}`)
}

/**
 * 🔴 备课清单声明的**关系判据**（纯函数）——教室的 `prep:` 段自己是否自洽。
 *
 * 🔴 为什么是关系断言、不是常量断言：
 *    旧版把"应该有哪些讲次、每讲几条"写死成常量（`[1,2,3,9]`、`[[1,1],[2,1],[3,2],[9,1]]`）。
 *    那种断言有两个毛病：① 教室改一次课程表（加一讲、挪一条）测试就红，而**红的原因不是缺陷**，
 *       于是下一个人会顺手把常量改掉 —— 改着改着这条断言就变成了"记录现状"，不再抓任何东西；
 *    ② 它**验不到结构**：把某条的 `material` 指到一个不存在的文件、或把 `lesson` 写成 99，
 *       只要常量的那几个数字没变，它照样绿。
 *    → 改成"从 manifest 自身推导的上界关系 ＋ 结构自洽"，并用**故意写坏的副本**证明它真的会红。
 *
 * 🔴 上界来源是**教室自己声明的** `classroom.lessons`（不是测试里写死的数字）。
 *
 * @param {object} manifest - loadManifest 的结果
 * @param {{classroomDir:string}} opts
 * @returns {string[]} 问题清单（空数组＝自洽）
 */
function checkPrepStructure(manifest, opts) {
  const { classroomDir } = opts
  const problems = []
  const lessons = manifest?.classroom?.lessons
  const items = manifest?.prep?.items ?? []
  if (!Number.isInteger(lessons) || lessons < 1) {
    problems.push(`教室未声明 classroom.lessons（给不出讲次上界）：${JSON.stringify(lessons)}`)
  }
  if (items.length === 0) problems.push('教室没有声明任何 prep.items（"模型的上界依据"为空）')
  const seenIds = new Set()
  for (const [i, item] of items.entries()) {
    const at = `prep.items[${i}]`
    if (typeof item?.id !== 'string' || item.id.trim() === '') problems.push(`${at}.id 必须是非空字符串`)
    else if (seenIds.has(item.id)) problems.push(`${at}.id 与前面重复：${item.id}`)
    else seenIds.add(item.id)
    if (!Number.isInteger(item?.lesson)) problems.push(`${at}.lesson 必须是整数（得到 ${JSON.stringify(item?.lesson)}）`)
    else if (Number.isInteger(lessons) && (item.lesson < 1 || item.lesson > lessons)) {
      problems.push(`${at}.lesson=${item.lesson} 超出教室声明的讲数 1..${lessons}`)
    }
    if (typeof item?.template !== 'string' || item.template.trim() === '') problems.push(`${at}.template 必须是非空字符串`)
    if (typeof item?.title !== 'string' || item.title.trim() === '') problems.push(`${at}.title 必须是非空字符串`)
    if (typeof item?.material !== 'string' || item.material.trim() === '') {
      problems.push(`${at}.material 必填（它是缓存键的教材哈希来源）`)
    } else if (isAbsolute(item.material)) {
      problems.push(`${at}.material 必须是**相对教室目录**的路径（得到绝对路径 ${item.material}）`)
    } else if (!existsSync(join(classroomDir, item.material))) {
      problems.push(`${at}.material 指向的文件不存在：${item.material}`)
    }
  }
  return problems
}

/** 按讲次逐讲计数（与 `prepItemsByLesson` 同口径，这里独立再算一遍用于对账）。 */
function countByLesson(items) {
  const m = new Map()
  for (const item of items) {
    if (!Number.isInteger(item?.lesson)) continue
    m.set(item.lesson, (m.get(item.lesson) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0])
}

console.log('══ A2 运行期动态块：推导模型单测 ══')

const manifest = loadManifest(CLASSROOM_DIR)
const prepByLesson = prepItemsByLesson(manifest)
const declaredLessons = [...prepByLesson.keys()].sort((a, b) => a - b)
const lessonCount = manifest?.classroom?.lessons ?? null
// 会话用的那一讲：**取教室声明的第一个有备课条目的讲次**（不是写死 1）
const sessionLesson = declaredLessons[0] ?? null
/** 任务号里的讲次是 `L%02d` 形态 —— 由讲次号推导，不写死字符串。 */
const noticeBlockFor = (lesson) => `${ANIMATION_NOTICE_PREFIX}L${String(lesson).padStart(2, '0')}`
if (sessionLesson === null) {
  bad('教室没有声明任何 prep.items → 后面的推导模型断言无从谈起（先修教室，不是改测试）')
}

// ── ① prep-list 进严格比对 ────────────────────────────────────────────────────
console.log('\n① prep-list：时机确定 → 进逐回合严格比对')
{
  const expectedPrepList = `prep-list:L${sessionLesson}`
  const predicted = predictAllTurns(manifest, { turnCount: 3, phases: ['open', 'open', 'probe'], lesson: sessionLesson })
  eq(predicted[0].blocks.filter((b) => b.startsWith('prep-list:')), [expectedPrepList], 'turn 1 的备课清单块（字面，不补零）')
  eq(predicted[1].blocks.filter((b) => b.startsWith('prep-list:')), [], 'turn 2 不再发（一讲至多一条）')
  eq(predicted[2].blocks.filter((b) => b.startsWith('prep-list:')), [], 'turn 3 不再发')
  eq(predicted[0].prepListBlock, expectedPrepList, 'prepListBlock 字段')
  // 两次真实完整跑的注入事实（**可选对账**：`runs/` 是运行产物，干净树里没有 → 不算失败）
  for (const run of ['2026-09-24_150308', '2026-09-24_152050']) {
    const f = join(HERE, 'runs', run, '04-asserts', 'evidence', 'A5-不重复送.json')
    try {
      const j = JSON.parse(readFileSync(f, 'utf8'))
      const turn1 = j.perTurn?.['1']?.blocks ?? []
      const got = turn1.filter((b) => b.startsWith('prep-list:'))
      if (JSON.stringify(got) === JSON.stringify([expectedPrepList])) ok(`真跑 ${run} 的 turn 1 注入：${JSON.stringify(got)}（与推导一致）`)
      else bad(`真跑 ${run} 的 turn 1 注入 ${JSON.stringify(got)} ≠ 推导 ${JSON.stringify([expectedPrepList])}`)
    } catch (error) {
      ok(`真跑 ${run} 的 A5 证据不可用（跳过，不算失败）：${error?.message?.split('\n')[0] ?? error}`)
    }
  }
}

// ── ② animation-notice 不进逐回合严格比对，但留在模型里 ────────────────────────
console.log('\n② animation-notice：不进逐回合严格比对，但**没有被删掉**（模型里给"可能出现"的讲次）')
{
  const predicted = predictAllTurns(manifest, { turnCount: 3, phases: ['open', 'open', 'probe'], lesson: sessionLesson })
  const inBlocks = predicted.flatMap((p) => p.blocks.filter((b) => b.startsWith(ANIMATION_NOTICE_PREFIX)))
  eq(inBlocks, [], '逐回合严格比对面里**没有**通报（它的出现时机不可预测）')
  const possible = [...new Set(predicted.flatMap((p) => p.possibleAnimationNoticeBlocks))]
  eq(possible, [noticeBlockFor(sessionLesson)], '模型里仍给出"可能出现"的通报（不是删掉）')
  const withPrep = predicted[0].possibleAnimationNoticeBlocks
  eq(withPrep, [noticeBlockFor(sessionLesson)], `第 ${sessionLesson} 讲（有备课条目）→ 可能出现`)

  // 🔴 "无备课条目的讲"这一形态：**从教室声明里找一个空缺的讲次**（不写死 6）。
  const gap = Array.from({ length: lessonCount ?? 0 }, (_, i) => i + 1).find((l) => !declaredLessons.includes(l))
  if (gap === undefined) {
    ok(
      `本教室第 1..${lessonCount} 讲**每一讲**都有备课条目 → "无备课条目的讲不预测通报"这一形态在本教室**不适用**` +
        `（显式写出来，不是"跳过通过"）`,
    )
  } else {
    const withoutPrep = predictAllTurns(manifest, { turnCount: 3, phases: ['open', 'open', 'probe'], lesson: gap })[0]
      .possibleAnimationNoticeBlocks
    eq(withoutPrep, [], `第 ${gap} 讲（无备课条目）→ 不预测（不是"永远预测一条"的假绿）`)
  }
}

// ── ③ 会话级子判据的反例：四类都必须报分歧 ────────────────────────────────────
console.log('\n③ 会话级子判据的反例（用与 A2 完全相同的判据重算一遍）')
{
  // 🔴 "可能集合"是**本次会话**的可能集合（本轮讲次的通报），不是"教室声明过的全部讲次"：
  //    第 1 讲的会话里不可能出现第 9 讲的通报 —— 那正是这一维要钉住的东西。
  const possibleLessons = [
    ...new Set(
      predictAllTurns(manifest, { turnCount: 3, phases: ['open', 'open', 'probe'], lesson: sessionLesson }).flatMap((p) =>
        p.possibleAnimationNoticeBlocks.map((b) => Number.parseInt(b.slice(ANIMATION_NOTICE_PREFIX.length + 1), 10)),
      ),
    ),
  ]
  eq(possibleLessons, [sessionLesson], `本次会话的"可能集合"（第 ${sessionLesson} 讲）`)
  const judge = (rows) => {
    const notices = rows.map((r) => {
      const m = ANIMATION_TASK_ID_RE.exec(r.taskId)
      return { ...r, lesson: m === null ? null : Number.parseInt(m[1], 10), taskTurn: m === null ? null : Number.parseInt(m[2], 10) }
    })
    const malformed = notices.filter(
      (r) => ANIMATION_TASK_ID_RE.exec(r.taskId) === null && ANIMATION_TASK_ID_NO_LESSON_RE.exec(r.taskId) === null,
    )
    const noLesson = notices.filter((r) => ANIMATION_TASK_ID_NO_LESSON_RE.exec(r.taskId) !== null)
    const undeclared = notices.filter((r) => !Number.isInteger(r.lesson) || !possibleLessons.includes(r.lesson))
    const counts = {}
    for (const r of notices) if (Number.isInteger(r.lesson)) counts[r.lesson] = (counts[r.lesson] ?? 0) + 1
    const over = Object.entries(counts).filter(([lesson, n]) => n > (prepByLesson.get(Number.parseInt(lesson, 10)) ?? 0))
    const timingBad = notices.filter((r) => r.taskTurn !== null && r.taskTurn > r.turn - 1)
    return { malformed, noLesson, undeclared, over, timingBad }
  }
  // 🔴 反例里的讲次/条数**从教室声明推导**（不写死 1 / 9 / 1 条）：
  //    · 「不在可能集合里」要挑一个**确实不在**本会话可能集合里的讲次；
  //    · 「条数超上界」要发**本讲声明条数 + 1** 条，否则在"某讲声明了 2 条"的教室上根本触发不了。
  const sessionPrepCount = prepByLesson.get(sessionLesson) ?? 0
  const outsideLesson =
    declaredLessons.find((l) => l !== sessionLesson) ??
    Array.from({ length: lessonCount ?? 0 }, (_, i) => i + 1).find((l) => l !== sessionLesson) ??
    sessionLesson + 1
  const overRows = Array.from({ length: sessionPrepCount + 1 }, (_, i) => ({
    turn: 2 + i,
    taskId: `L${String(sessionLesson).padStart(2, '0')}-T0${i}-20260924-1521${String(i).padStart(2, '0')}`,
  }))
  const l2 = (n) => `L${String(n).padStart(2, '0')}`
  const cases = [
    { label: '合法一条（真跑的那一条）', rows: [{ turn: 2, taskId: `${l2(sessionLesson)}-T00-20260924-152106` }], expect: 'clean' },
    {
      label: `讲次不在可能集合里（讲 ${outsideLesson} 没在讲 ${sessionLesson} 的会话里出现）`,
      rows: [{ turn: 2, taskId: `${l2(outsideLesson)}-T00-20260924-152106` }],
      expect: 'undeclared',
    },
    {
      label: `同一讲多出一条（条数超上界：讲 ${sessionLesson} 只声明 ${sessionPrepCount} 条）`,
      rows: overRows,
      expect: 'over',
    },
    {
      label: '通报时刻早于任务创建回合（t2 通报但任务号写 T03）',
      rows: [{ turn: 2, taskId: `${l2(sessionLesson)}-T03-20260924-152106` }],
      expect: 'timingBad',
    },
    { label: '任务号形状不合法', rows: [{ turn: 2, taskId: 'L1-T00-20260924-152106' }], expect: 'malformed' },
    { label: '无讲次形态 Lxx', rows: [{ turn: 2, taskId: 'Lxx-T00-20260924-152106' }], expect: 'noLesson' },
  ]
  for (const c of cases) {
    const v = judge(c.rows)
    const hit = Object.entries(v).filter(([, arr]) => arr.length > 0).map(([k]) => k)
    if (c.expect === 'clean') {
      if (hit.length === 0) ok(`${c.label} → 干净通过（不是"什么都报"）`)
      else bad(`${c.label} → 被误报：${JSON.stringify(hit)}`)
    } else if (hit.includes(c.expect)) ok(`${c.label} → 报出 ${c.expect}`)
    else bad(`${c.label} → **没报出** ${c.expect}（实际报出 ${JSON.stringify(hit)}）→ 这一维被放过了`)
  }
}

// ── ④ 备课清单声明的**结构**（关系断言：从 manifest 自身推导，不写死讲次/条数）────
console.log('\n④ 教室声明的备课清单：结构与上界（关系断言，不是常量）')
{
  const items = manifest?.prep?.items ?? []
  const problems = checkPrepStructure(manifest, { classroomDir: CLASSROOM_DIR })
  if (problems.length === 0) {
    ok(
      `声明自洽：${items.length} 条 / ${declaredLessons.length} 个讲次（${JSON.stringify(declaredLessons)}）/ ` +
        `讲数上界 ${lessonCount}（＝教室自己声明的 classroom.lessons）`,
    )
  } else {
    bad(`教室的 prep 声明不自洽（${problems.length} 条）：\n      - ${problems.join('\n      - ')}`)
  }

  // 🔴 上界关系：模型给出的"每讲条数上界"必须**逐格等于**教室自己声明的逐讲计数。
  //    这一条抓的是"模型把某讲的条数算错"——用两份**独立**计数对账（不是跟常量比）。
  eq(countByLesson(items), [...prepByLesson.entries()], '模型的上界表 ＝ 教室声明逐讲计数（独立算两遍对账）')

  // 🔴 讲次必须落在教室声明的范围内（用教室自己的上界，不用测试里的常量）
  const outOfRange = declaredLessons.filter((l) => !Number.isInteger(l) || l < 1 || !Number.isInteger(lessonCount) || l > lessonCount)
  if (outOfRange.length === 0) ok(`每个声明讲次都落在 1..${lessonCount} 内：${JSON.stringify(declaredLessons)}`)
  else bad(`有讲次落在教室声明的讲数之外：${JSON.stringify(outOfRange)}（上界 ${lessonCount}）`)

  // 🔴 每讲的条数必须 ≥1（"声明了这一讲却 0 条"＝死声明：占着讲次却不给模型任何上界依据）
  const zeroCount = [...prepByLesson.entries()].filter(([, n]) => n < 1)
  if (zeroCount.length === 0) ok('每个讲次的条目数都 ≥1（没有"死声明"）')
  else bad(`有条目数为 0 的讲次：${JSON.stringify(zeroCount)}`)

  // 🔴 条数之和必须等于条目总数（没有任何一条在计数里被丢掉/重复计入）
  const sum = [...prepByLesson.values()].reduce((a, b) => a + b, 0)
  eq(sum, items.length, '逐讲条数之和 ＝ prep.items 总条数（计数不丢不重）')
}

// ── ④b 负向对照：故意写坏的声明**必须被同一份判据抓出** ───────────────────────
// 🔴 没有这一段，上面的"自洽"就可能是空壳（判据永远返回空数组也算"自洽"）。
//    每一条都是"结构上真的坏掉"的形态，且**不依赖任何常量**。
console.log('\n④b 负向对照：写坏的 prep 声明必须被抓出（证明上面的判据不是空壳）')
{
  const base = manifest?.prep?.items ?? []
  if (base.length === 0) {
    bad('教室没有 prep.items → 负向对照无从构造（先修教室，不是改测试）')
  } else {
    const mutants = [
      { label: '讲次超出教室声明的讲数', mutate: (m) => { m.prep.items[0].lesson = (m.classroom.lessons ?? 1) + 1 } },
      { label: '讲次不是整数', mutate: (m) => { m.prep.items[0].lesson = '3' } },
      { label: 'material 指向不存在的文件', mutate: (m) => { m.prep.items[0].material = 'materials/ch99.md' } },
      { label: 'material 写成绝对路径', mutate: (m) => { m.prep.items[0].material = '/tmp/whatever.md' } },
      { label: 'material 缺字段', mutate: (m) => { delete m.prep.items[0].material } },
      { label: 'template 为空串', mutate: (m) => { m.prep.items[0].template = '   ' } },
      { label: 'id 与前面重复', mutate: (m) => { m.prep.items[1].id = m.prep.items[0].id } },
      { label: '整段 prep 被删空', mutate: (m) => { m.prep.items = [] } },
    ]
    for (const c of mutants) {
      const mutated = structuredClone(manifest)
      c.mutate(mutated)
      const p = checkPrepStructure(mutated, { classroomDir: CLASSROOM_DIR })
      if (p.length > 0) ok(`${c.label} → 被抓出（${String(p[0]).slice(0, 72)}）`)
      else bad(`${c.label} → **没被抓出**（判据在这一维上是空壳）`)
    }
    // 正向对照：**没改**的那一份必须仍然自洽（证明上面的红不是"什么都报"）
    const clean = checkPrepStructure(structuredClone(manifest), { classroomDir: CLASSROOM_DIR })
    eq(clean, [], '正向对照：未改动的那一份 → 自洽（判据不是"什么都报"）')
  }
}

// ── ⑤ 任务号形状判据 ─────────────────────────────────────────────────────────
console.log('\n⑤ 任务号形状判据')
{
  const good = ['L01-T00-20260924-150326', 'L14-T12-20260924-235959', 'L01-T00-20260924-150326-2']
  const badIds = ['L1-T00-20260924-150326', 'L01-T0-20260924-150326', 'L01-T00-20260924', 'L01-T00-20260924-15032', 'nonsense', 'L01-T00-2026092-150326']
  const goodFails = good.filter((id) => ANIMATION_TASK_ID_RE.exec(id) === null)
  const badPasses = badIds.filter((id) => ANIMATION_TASK_ID_RE.exec(id) !== null)
  if (goodFails.length === 0) ok(`合法形状全部通过：${JSON.stringify(good)}`)
  else bad(`合法形状被误判：${JSON.stringify(goodFails)}`)
  if (badPasses.length === 0) ok(`坏形状全部被抓出：${JSON.stringify(badIds)}`)
  else bad(`坏形状被放过：${JSON.stringify(badPasses)}`)
  eq(animationNoticeTaskId('animation-notice:L01-T00-20260924-150326'), 'L01-T00-20260924-150326', '从块 id 取任务号')
  eq(animationNoticeTaskId('prep-list:L1'), null, '非通报块 → 取不到任务号（返回 null）')
}

// ── ⑥ canonicalBlockId：只用于证据可读性 ─────────────────────────────────────
console.log('\n⑥ canonicalBlockId：只用于证据可读性，讲次逐字保留、其它块一个字节不动')
eq(canonicalBlockId('animation-notice:L01-T00-20260924-150326'), 'animation-notice:L01', '标准任务号 → 规范形')
eq(canonicalBlockId('animation-notice:L01-T02-20260924-151001-2'), 'animation-notice:L01', '带冲突后缀 → 同一规范形')
eq(canonicalBlockId('animation-notice:Lxx-T00-20260924-150326'), 'animation-notice:Lxx', '无讲次 → Lxx')
eq(canonicalBlockId('animation-notice:L09'), 'animation-notice:L09', '已规范形 → 原样（幂等）')
eq(canonicalBlockId('animation-notice:乱七八糟'), 'animation-notice:乱七八糟', '形状不合法 → 原样')
eq(canonicalBlockId('prep-list:L1'), 'prep-list:L1', '备课清单不动')
eq(canonicalBlockId('prep-list:L01'), 'prep-list:L01', '备课清单不动（不补零）')
eq(canonicalBlockId('state.progress'), 'state.progress', '普通块不动')
eq(canonicalBlockId(canonicalBlockId('animation-notice:L01-T00-20260924-150326')), 'animation-notice:L01', '折算幂等')

console.log(
  failures.length === 0
    ? '\n✅ 全部通过'
    : `\n🔴 有 ${failures.length} 项失败：\n${failures.map((f) => `  · ${f}`).join('\n')}`,
)
process.exitCode = failures.length === 0 ? 0 : 1
