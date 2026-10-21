// test/lessonjump.test.mjs — J · 任意讲次进入（J1 / J2 / J3 ＋ EC）
//
// 任务书：开发文档_功能开发_2026-10-20.md §五 J
// 契约：契约_功能开发_2026-10-20.md K3.3（`skipped_lessons` 是跳过讲次的**唯一键名**）
//
// 本节的分工（每条都对应任务书里一句话）：
//   J1 · 写盘 + 前情提要 + 前置知识点 —— 「①参数」「②跳过集合」「③progress 渲染」
//        「④机械取文」「⑤注入集合（J3）」
//   J2 · 跳过 ≠ 掌握 —— 「⑥J2 红线：跳过的讲次不出 [x]」（与 notestore 的推导串起来测）
//   EC · 越界 / 跳回已上过的讲次 / 跳讲后要求从头开始 —— 「①」「②」「⑦端到端」逐条铺
//   🔴 落盘顺序（先写盘、后改内存）—— 「⑦」用造出来的写盘失败证明：失败时返回的
//      `lesson` 仍是旧值，调用方按它赋值不会出现「内存说 5、盘上还是 1」。
//
// 纪律：不调 LLM、不起宿主、不碰 $DSH_HOME；教室内容的读取一律**只读**真文件，
// 需要写盘的用例把真教室的几份文件**复制**到临时目录再动。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import {
  CONTINUITY_SECTIONS,
  LESSON_ROW_LABEL,
  LessonJumpError,
  PREREQ_FULL_WINDOW,
  SKIPPED_KEY,
  SKIPPED_ROW_LABEL,
  buildRecap,
  enterLesson,
  extractContinuity,
  extractKnowledgePoints,
  extractOverviewRecap,
  formatLessonRanges,
  knowledgePointHeading,
  nextSkippedLessons,
  parseLessonNumber,
  readLessonContext,
  renderProgressLesson,
  renderSkippedLine,
} from '../lib/lessonjump.mjs'
import { loadManifest, readRuntimeLesson, resolveProgressFile, usesLessonGate } from '../lib/manifest.mjs'
import { planTurnInjections } from '../lib/injector.mjs'
import {
  applyKpProjection,
  deriveNotes,
  parseKnowledgePoints,
  readProgressState,
} from '../lib/notestore.mjs'

// 真教室（只读）：test/ → socratic-engine/ → plugins/ → classrooms/cs-os
const HERE = dirname(fileURLToPath(import.meta.url))
const CS_OS = join(HERE, '..', '..', '..', 'classrooms', 'cs-os')

const dirs = []
test.after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

/** 与宿主 writeFileAtomic 同算法：临时文件（wx）→ rename 覆盖。 */
async function writeFileAtomic(filename, content, options) {
  await mkdir(dirname(filename), { recursive: true })
  const temp = `${filename}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, content, { mode: options?.mode, flag: 'wx' })
    await rename(temp, filename)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

/** 按路径串行化的假文件锁（与 test/notestore.test.mjs 同一手法）。 */
function makeFakeIo() {
  const chains = new Map()
  return {
    writeFileAtomic,
    withFileLock(filename, operation) {
      const prev = chains.get(filename) ?? Promise.resolve()
      const run = prev.then(() => operation())
      chains.set(
        filename,
        run.then(
          () => {},
          () => {},
        ),
      )
      return run
    },
  }
}

/**
 * 把真教室**整份**复制到临时目录（54 个文件 / 约 0.5MB）。复制的是真内容，所以断言里的
 * 取文与注入裁决就是生产路径上的那一套（manifest 里声明的文件必须全在，否则 parseManifest 会报错）。
 */
async function copyClassroom({ progress = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'socratic-jump-'))
  dirs.push(dir)
  await cp(CS_OS, dir, { recursive: true })
  if (progress !== null) await writeFile(join(dir, 'runtime', 'progress.md'), progress, 'utf8')
  return dir
}

// 真教室的几段特征串（用来判「有没有把后面几讲取进来」）
const CH05 = await readFile(join(CS_OS, 'story', 'ch05.md'), 'utf8')
const CH06 = await readFile(join(CS_OS, 'story', 'ch06.md'), 'utf8')
const CH09 = await readFile(join(CS_OS, 'story', 'ch09.md'), 'utf8')
const CH14 = await readFile(join(CS_OS, 'story', 'ch14.md'), 'utf8')
const OVERVIEW = await readFile(join(CS_OS, 'story', 'overview.md'), 'utf8')
const KP_TEXT = await readFile(join(CS_OS, 'knowledge_points.md'), 'utf8')
const CSOS_PROGRESS = await readFile(join(CS_OS, 'runtime', 'progress.md'), 'utf8')

// ══════════════════════════════════════════════════════════════════════════════
// ① 「跳到第 N 讲」的 N：合法与越界（EC：0 / 15 / 非数字 / 小数 / 负数）
// ══════════════════════════════════════════════════════════════════════════════

test('① N 合法：1–14 的整数（数字与数字串都收），越界与非整数**报错**且带上合法区间', () => {
  assert.equal(parseLessonNumber(1, { max: 14 }), 1)
  assert.equal(parseLessonNumber(5, { max: 14 }), 5)
  assert.equal(parseLessonNumber('7', { max: 14 }), 7)

  // EC · 0：第 0 讲＝还没开始，不是讲次
  assert.throws(() => parseLessonNumber(0, { max: 14 }), LessonJumpError)
  assert.throws(() => parseLessonNumber(0, { max: 14 }), /第 0 讲不是一个讲次/)
  // EC · 15：超出教室声明的 14 讲
  assert.throws(() => parseLessonNumber(15, { max: 14 }), /只声明了 14 讲/)
  // EC · 非数字
  for (const bad of ['abc', '', ' ', null, undefined, {}, [], true, '第5讲']) {
    assert.throws(() => parseLessonNumber(bad, { max: 14 }), LessonJumpError, `应拒绝 ${JSON.stringify(bad)}`)
  }
  // 小数 / 负数 / NaN
  for (const bad of [5.5, -1, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => parseLessonNumber(bad, { max: 14 }), LessonJumpError, `应拒绝 ${JSON.stringify(bad)}`)
  }
  // 报错信息里必须有可用的合法区间（模型据此自己改对）
  assert.throws(() => parseLessonNumber(15, { max: 14 }), /1–14/)
  assert.throws(() => parseLessonNumber('x', { max: 14 }), /1–14/)
})

test('① 教室没声明讲数上界（classroom.lessons 缺省）→ 只校验 >=1，不猜上界', () => {
  assert.equal(parseLessonNumber(99, { max: null }), 99)
  assert.throws(() => parseLessonNumber(0, { max: null }), LessonJumpError)
})

test('① 讲次门本身仍按真文件读：真教室的第 1 讲读得出来，上界＝14', async () => {
  const manifest = loadManifest(CS_OS)
  assert.equal(usesLessonGate(manifest), true)
  assert.equal(readRuntimeLesson(manifest, { baseDir: CS_OS }), 1)
})

// ══════════════════════════════════════════════════════════════════════════════
// ② 跳过集合（J2 的口径；EC：跳回已上过的讲次 / 跳讲后要求从头开始）
// ══════════════════════════════════════════════════════════════════════════════

test('② 前进：第 1 讲 → 第 5 讲，跳过 ＝ 1,2,3,4（AC 的那条）', () => {
  assert.deepEqual([...nextSkippedLessons({ previous: 1, lesson: 5, skipped: new Set() })], [1, 2, 3, 4])
})

test('② EC 跳回已经上过的讲次：第 8 讲 → 第 3 讲，不新记跳过，且第 3 讲之后的不再算跳过', () => {
  const skipped = new Set([1, 2]) // 之前真跳过的（还没上）
  assert.deepEqual([...nextSkippedLessons({ previous: 8, lesson: 3, skipped })], [1, 2])
})

test('② EC 跳讲之后要求从头开始：第 8 讲 → 第 1 讲，跳过集合清空（机器行随之删除）', () => {
  const skipped = new Set([1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual([...nextSkippedLessons({ previous: 8, lesson: 1, skipped })], [])
  assert.equal(renderSkippedLine(new Set()), null)
})

test('② 跳回一个曾被跳过的讲次：它自己从集合里消失（现在正要上它）', () => {
  const skipped = new Set([1, 2, 3, 4])
  assert.deepEqual([...nextSkippedLessons({ previous: 5, lesson: 3, skipped })], [1, 2])
})

test('② 再往前跳：第 5 讲 → 第 9 讲，跳过累积成 1–8（5 也没上完，算跳过）', () => {
  assert.deepEqual(
    [...nextSkippedLessons({ previous: 5, lesson: 9, skipped: new Set([1, 2, 3, 4]) })],
    [1, 2, 3, 4, 5, 6, 7, 8],
  )
})

test('② 跳到当前讲次（重复调用）：集合不变（幂等）', () => {
  assert.deepEqual([...nextSkippedLessons({ previous: 5, lesson: 5, skipped: new Set([1, 2, 3, 4]) })], [1, 2, 3, 4])
})

test('② 人读文本：连续段折成区间，不连续用顿号，空集用破折号', () => {
  assert.equal(formatLessonRanges(new Set([1, 2, 3, 4])), '第 1–4 讲')
  assert.equal(formatLessonRanges([1, 3, 5]), '第 1 讲、第 3 讲、第 5 讲')
  assert.equal(formatLessonRanges([1, 2, 4, 5, 6]), '第 1–2 讲、第 4–6 讲')
  assert.equal(formatLessonRanges([]), '—')
  assert.equal(renderSkippedLine(new Set([3, 1, 2])), `${SKIPPED_KEY}: 1,2,3`)
})

// ══════════════════════════════════════════════════════════════════════════════
// ③ progress.md 渲染（J1：机器行 + 人读行同步；只动该动的行）
// ══════════════════════════════════════════════════════════════════════════════

test('③ 渲染：current_lesson、人读「本轮要讲」、skipped_lessons 三处同时更新', () => {
  const out = renderProgressLesson(CSOS_PROGRESS, { lesson: 5, title: '内存：每个程序都有自己的世界', skipped: new Set([1, 2, 3, 4]) })
  assert.match(out, /^current_lesson: 5$/m)
  assert.match(out, /^skipped_lessons: 1,2,3,4$/m)
  assert.match(out, /\| 本轮要讲 \| \*\*第 5 讲 · 内存：每个程序都有自己的世界\*\* \|/)
  // 🔴 跳过讲次写在 current_lesson 的**下一行**（机器可读行区）
  const lines = out.split('\n')
  assert.equal(lines[lines.indexOf('current_lesson: 5') + 1], 'skipped_lessons: 1,2,3,4')
})

test('③ 渲染：其余行逐字保留（表格、注释、记录、待办一个字节都不动）', () => {
  const out = renderProgressLesson(CSOS_PROGRESS, { lesson: 5, title: 't', skipped: new Set([1, 2, 3, 4]) })
  // 滤掉「该动的三行」与因插入/删除而多出/少掉的那一行，剩下的必须逐行相同
  const keep = (text) =>
    text
      .split('\n')
      .filter((l) => !/^skipped_lessons:/.test(l) && !/^\| (本轮要讲|跳过的讲次) \|/.test(l))
      .map((l) => l.replace(/^current_lesson: \d+$/, 'current_lesson: <N>'))
  assert.deepEqual(keep(out), keep(CSOS_PROGRESS))
})

test('③ 渲染：跳过集合为空 → 整行删除（契约：「缺失＝无跳过」，不留空值行）', () => {
  const withLine = renderProgressLesson(CSOS_PROGRESS, { lesson: 5, title: 't', skipped: new Set([1, 2]) })
  const back = renderProgressLesson(withLine, { lesson: 1, title: '一个程序怎么跑起来', skipped: new Set() })
  assert.equal(/^skipped_lessons:/m.test(back), false)
  assert.match(back, /^current_lesson: 1$/m)
  assert.match(back, /\| 跳过的讲次 \| — \|/)
})

test('③ 渲染：没有 classroom 标题（title 为空）也不编标题，只写「第 N 讲」', () => {
  const out = renderProgressLesson(CSOS_PROGRESS, { lesson: 7, title: null, skipped: new Set() })
  assert.match(out, /\| 本轮要讲 \| \*\*第 7 讲\*\* \|/)
})

test('🔴 ③ 渲染：progress 里没有 current_lesson 行 → 报错（不凭空插一行造出第二个来源）', () => {
  assert.throws(
    () => renderProgressLesson('# 学习进度\n\n| 本轮要讲 | x |\n', { lesson: 5, skipped: new Set() }),
    /没有机器可读行/,
  )
})

test('🔴 ③ 渲染：progress 里没有「本轮要讲」行 → 报错（人读行与机器行必须同值）', () => {
  assert.throws(() => renderProgressLesson('current_lesson: 1\n', { lesson: 5, skipped: new Set() }), /没有「\| 本轮要讲 \|/)
})

// ══════════════════════════════════════════════════════════════════════════════
// ④ 机械取文（前情提要 ＋ 前置知识点；不许生成式改写）
// ══════════════════════════════════════════════════════════════════════════════

test('④ 连续性：ch02–14 取「本讲位置」，ch01 取「这一讲在故事里的作用」', async () => {
  const ch01 = await readFile(join(CS_OS, 'story', 'ch01.md'), 'utf8')
  const ch02 = await readFile(join(CS_OS, 'story', 'ch02.md'), 'utf8')
  const a = extractContinuity(ch01)
  assert.equal(a.title, CONTINUITY_SECTIONS[1])
  assert.match(a.body, /学生第一次以\*\*从海面下来的人\*\*的身份走进潮汐观测站/)
  const b = extractContinuity(ch02)
  assert.equal(b.title, CONTINUITY_SECTIONS[0])
  assert.match(b.body, /承接第 1 讲的"进程"概念/)
})

test('🔴 ④ 连续性只取那一段：不取「留给后面的事」「暗线种子」「机会节点」（那些写着后面几讲的回收点）', () => {
  const ch02 = extractContinuity(
    '## 本讲位置\n位置正文\n## 机会节点\n学生问 X → 她说"我做第一次记录的时候"\n## 暗线种子\n- 埋：她抄过一份（ch14 回收）\n',
  )
  assert.equal(ch02.body, '位置正文')
  const ch01 = extractContinuity('## 这一讲在故事里的作用\n作用正文\n## 留给后面的事\n鲸过去在深水区经历的失误尚未到讲明的时候\n')
  assert.equal(ch01.body, '作用正文')
})

test('④ overview：人物弧只取「段/讲次/状态」三格，第四格（后面几讲的里程碑）不取', () => {
  const recap = extractOverviewRecap(OVERVIEW, { lesson: 5 })
  assert.equal(recap.arc.range, '5–10')
  assert.match(recap.arc.name, /Ⅱ 反差的常态化/)
  assert.match(recap.arc.state, /主动\*\*拿起笔/)
  // 第四格写的是「第 9 讲她主动讲起那份被覆盖的记录」——那是剧透，必须没被取进来
  assert.equal(JSON.stringify(recap.arc).includes('第 9 讲'), false)
  assert.equal(JSON.stringify(recap.arc).includes('被覆盖'), false)
})

test('④ overview：核心疑问只取 < N 的行（第 N 讲自己的由 curriculum 注入，不在这里重复）', () => {
  const at5 = extractOverviewRecap(OVERVIEW, { lesson: 5 })
  assert.deepEqual(at5.questions.map((q) => q.lesson), [1, 2, 3, 4])
  const at1 = extractOverviewRecap(OVERVIEW, { lesson: 1 })
  assert.deepEqual(at1.questions, [])
  assert.equal(at1.arc.range, '1–4')
})

test('④ 前置知识点：取第 1..N-1 讲的条目原文', () => {
  const got = extractKnowledgePoints(KP_TEXT, { lesson: 3 })
  assert.equal(got.title, '调度：谁来决定下一个跑谁')
  assert.equal(got.lines.length, 5)
  assert.match(got.lines[0], /KP-3\.1 调度指标/)
  assert.equal(extractKnowledgePoints(KP_TEXT, { lesson: 99 }).title, null)
})

test('④ 拼装的前情提要：只有 < N 的内容，且不含「第 N 讲之后」的任何故事节点正文', async () => {
  const recap = buildRecap({ lesson: 5, ...(await readLessonContext({ classroomDir: CS_OS, lesson: 5 })) })
  // 该在的：第 1–4 讲
  assert.match(recap, /第 1 讲 · story\/ch01\.md/)
  assert.match(recap, /第 4 讲 · story\/ch04\.md/)
  assert.match(recap, /【第 5 讲的前置知识点/)
  assert.match(recap, /KP-4\.4 单队列 vs 每核一队列/)
  // 不该在的：第 5 讲及以后的故事节点正文（逐文件比对，不靠"大概没提"）
  for (const [name, text] of [
    ['ch05', CH05],
    ['ch06', CH06],
    ['ch09', CH09],
    ['ch14', CH14],
  ]) {
    const bullet = text.split('\n').find((l) => l.startsWith('- ') && l.length > 40)
    assert.ok(bullet !== undefined, `${name} 里应有可用来比对的正文行`)
    assert.equal(recap.includes(bullet), false, `前情提要里混进了 ${name} 的正文`)
  }
  // 第 5 讲自己的知识点也不进「前置知识点」段（它由 curriculum 与本讲清单给）
  assert.equal(recap.includes('KP-5.1 地址空间'), false)
  // 分档（2026-10-21 拍板）：第 3、4 讲（N-2、N-1）给条目原文，第 1、2 讲只列标题
  assert.match(recap, /- \[ \] \*\*KP-4\.1 彩票调度的机制\*\* —— 判据：/)
  assert.match(recap, /- \[ \] \*\*KP-3\.1 调度指标\*\* —— 判据：/)
  assert.match(recap, /· KP-1\.1 进程是什么/)
  assert.equal(recap.includes('KP-1.1 进程是什么** —— 判据：'), false)
})

test('④ 拼装：跳到第 1 讲（从头开始）→ 没有前几讲，也没有前置知识点，只剩一句实话', () => {
  const recap = buildRecap({ lesson: 1, title: '一个程序怎么跑起来', skipped: [], continuity: [], overview: { arc: null, questions: [] }, prerequisites: [] })
  assert.match(recap, /这是第 1 讲，前面没有讲次/)
  assert.equal(recap.includes('前置知识点'), false)
  assert.match(recap, /现在开始上第 1 讲/)
})

test('④ 拼装：没摘到的文件如实列出（不假装完整）', () => {
  const recap = buildRecap({ lesson: 4, skipped: [1, 2, 3], missing: ['story/ch03.md 不存在 → 第 3 讲的连续性要点没摘到'] })
  assert.match(recap, /【没摘到的部分/)
  assert.match(recap, /story\/ch03\.md 不存在/)
})

// ══════════════════════════════════════════════════════════════════════════════
// ⑤ J3：跳到第 N 讲之后，注入集合里没有第 N 讲之后的故事节点
// ══════════════════════════════════════════════════════════════════════════════

test('⑤ J3 注入集合：真教室 ＋ current_lesson=5 ＋ open 相位 → 只有 story.node.05，06–14 一个都不在', () => {
  const manifest = loadManifest(CS_OS)
  const due = planTurnInjections(
    manifest.blocks,
    { turnCount: 1, phase: 'open', injectedOnce: new Set(), injectedLesson: new Map(), currentLesson: 5 },
    { classroom: manifest.classroom.id },
  )
  const story = due.filter((d) => d.id.startsWith('story.node.'))
  assert.deepEqual(story.map((d) => d.id), ['story.node.05'])
})

test('⑤ J3 注入集合：每个讲次只放行自己那一个故事节点（1–14 全扫一遍）', () => {
  const manifest = loadManifest(CS_OS)
  for (let n = 1; n <= 14; n += 1) {
    const due = planTurnInjections(
      manifest.blocks,
      { turnCount: 1, phase: 'open', injectedOnce: new Set(), injectedLesson: new Map(), currentLesson: n },
      { classroom: manifest.classroom.id },
    )
    const story = due.filter((d) => d.id.startsWith('story.node.')).map((d) => d.id)
    assert.deepEqual(story, [`story.node.${String(n).padStart(2, '0')}`], `第 ${n} 讲的故事节点集合不对`)
  }
})

test('🔴 ⑤ J3 端到端：跳讲的返回值里没有第 6 讲及以后的故事节点（跳到第 5 讲）', async () => {
  const dir = await copyClassroom()
  const manifest = loadManifest(dir)
  const result = await enterLesson({ classroomDir: dir, manifest, lesson: 5, io: makeFakeIo() })
  assert.equal(result.persisted, true)
  // 第 5 讲自己的节点与后面的节点都不该出现在前情提要里（recap 只讲 < N）
  for (const n of [5, 6, 7, 9, 14]) {
    const rel = `story/ch${String(n).padStart(2, '0')}.md`
    const bullet = (await readFile(join(CS_OS, rel), 'utf8')).split('\n').find((l) => l.startsWith('- ') && l.length > 40)
    assert.equal(result.recap.includes(bullet), false, `recap 混进了 ${rel} 的正文`)
  }
  // 且落盘后的 progress 让下一回合的注入确实只放行第 5 讲
  const after = loadManifest(dir)
  assert.equal(readRuntimeLesson(after, { baseDir: dir }), 5)
  const due = planTurnInjections(
    after.blocks,
    { turnCount: 2, phase: 'open', injectedOnce: new Set(), injectedLesson: new Map(), currentLesson: 5 },
    { classroom: after.classroom.id },
  )
  assert.deepEqual(due.filter((d) => d.id.startsWith('story.node.')).map((d) => d.id), ['story.node.05'])
})

// ══════════════════════════════════════════════════════════════════════════════
// ⑥ J2：跳过 ≠ 掌握（与 notestore 的推导串起来测，不另写一份判定）
// ══════════════════════════════════════════════════════════════════════════════

test('🔴 ⑥ J2：跳讲写出的 skipped_lessons 被 notestore 读到，跳过的讲次一个 [x] 都不出', async () => {
  const dir = await copyClassroom()
  const manifest = loadManifest(dir)
  const result = await enterLesson({ classroomDir: dir, manifest, lesson: 5, io: makeFakeIo() })
  assert.deepEqual(result.skipped, [1, 2, 3, 4])

  const progressText = await readFile(join(dir, 'runtime', 'progress.md'), 'utf8')
  const state = readProgressState(progressText)
  assert.equal(state.currentLesson, 5)
  assert.deepEqual([...state.skippedLessons].sort(), [1, 2, 3, 4])

  // 假设课上真给第 3 讲记了一条 evidence（学生原话作证据）——按契约它也不得变成 [x]：
  // 那一讲的 kp 属于被跳过的讲次，状态位不动，只加「（跳过）」。
  const kpParsed = parseKnowledgePoints(KP_TEXT)
  assert.equal(kpParsed.byId.get('KP-3.2').lesson, 3)
  const derived = deriveNotes(
    [
      {
        v: 1,
        id: 'N-20261021T000000-001',
        ts: '2026-10-21T00:00:00-04:00',
        session: 's',
        lesson: 3,
        turn: 1,
        type: 'evidence',
        kp: 'KP-3.2',
        quote: 'q',
        note: '',
        origin: 'teacher',
      },
    ],
    { currentLesson: state.currentLesson, totalLessons: kpParsed.totalLessons, skippedLessons: state.skippedLessons },
  )
  assert.equal(derived.kpStates.get('KP-3.2').skipped, true)
  const projected = applyKpProjection(KP_TEXT, derived)
  assert.equal(/- \[x\] \*\*KP-3\.2/.test(projected.text), false)
  assert.match(projected.text, /- \[ \] \*\*KP-3\.2 FIFO 的问题\*\*.*（跳过）/)
})

test('⑥ J2：跳讲不改写 knowledge_points.md（投影只由 classroom_note 的记录重算）', async () => {
  const dir = await copyClassroom()
  const before = await readFile(join(dir, 'knowledge_points.md'), 'utf8')
  await enterLesson({ classroomDir: dir, manifest: loadManifest(dir), lesson: 5, io: makeFakeIo() })
  assert.equal(await readFile(join(dir, 'knowledge_points.md'), 'utf8'), before)
})

// ══════════════════════════════════════════════════════════════════════════════
// ⑦ 端到端落盘（J1 的「先写盘、后改内存」；EC 逐条走一遍）
// ══════════════════════════════════════════════════════════════════════════════

test('⑦ 端到端：从第 1 讲跳到第 5 讲 → 盘上三处都对，返回值带前情提要', async () => {
  const dir = await copyClassroom()
  const manifest = loadManifest(dir)
  const result = await enterLesson({ classroomDir: dir, manifest, lesson: 5, io: makeFakeIo() })

  assert.equal(result.persisted, true)
  assert.equal(result.previous, 1)
  assert.equal(result.lesson, 5)
  assert.equal(result.title, '内存：每个程序都有自己的世界')
  assert.deepEqual(result.skipped, [1, 2, 3, 4])
  assert.match(result.note, /已写回/)

  const text = await readFile(join(dir, 'runtime', 'progress.md'), 'utf8')
  assert.match(text, /^current_lesson: 5$/m)
  assert.match(text, /^skipped_lessons: 1,2,3,4$/m)
  assert.match(text, /\| 本轮要讲 \| \*\*第 5 讲 · 内存：每个程序都有自己的世界\*\* \|/)
  assert.match(text, /\| 跳过的讲次 \| 第 1–4 讲 \|/)
  // 面板那条口径：人读行里必须含讲次数字（否则面板判「口径不一致」）
  assert.equal(text.includes('第 5 讲'), true)
  assert.deepEqual(result.skipped, [1, 2, 3, 4])
})

test('🔴 ⑦ 写盘失败：persisted:false ＋ 原因，且返回值里的 lesson 仍是旧值（内存不会被改错）', async () => {
  const dir = await copyClassroom()
  const manifest = loadManifest(dir)
  const brokenIo = {
    withFileLock: (f, op) => op(),
    writeFileAtomic: async () => {
      throw new Error('模拟：原子写失败（磁盘只读）')
    },
  }
  const result = await enterLesson({ classroomDir: dir, manifest, lesson: 5, io: brokenIo })
  assert.equal(result.persisted, false)
  assert.match(result.note, /落盘失败/)
  assert.match(result.note, /磁盘只读/)
  assert.equal(result.lesson, 1, '失败时 lesson 必须退回旧值（调用方按它赋值＝内存不会被改）')
  assert.equal(result.previous, 1)
  // 盘上仍是第 1 讲
  const text = await readFile(join(dir, 'runtime', 'progress.md'), 'utf8')
  assert.match(text, /^current_lesson: 1$/m)
  assert.equal(/^skipped_lessons:/m.test(text), false)
})

test('⑦ 落盘用宿主同形原子写：同一次调用里 current_lesson 与 skipped_lessons 一起落地（不是两次写）', async () => {
  const dir = await copyClassroom()
  const writes = []
  const io = {
    withFileLock: (f, op) => op(),
    writeFileAtomic: async (file, content) => {
      writes.push(content)
      await writeFileAtomic(file, content)
    },
  }
  await enterLesson({ classroomDir: dir, manifest: loadManifest(dir), lesson: 6, io })
  assert.equal(writes.length, 1, '跳讲必须是一次整文件写')
  assert.match(writes[0], /^current_lesson: 6$/m)
  assert.match(writes[0], /^skipped_lessons: 1,2,3,4,5$/m)
})

test('⑦ EC 跳回已经上过的讲次：第 5 讲 → 第 3 讲可行，跳过集合只留 1,2', async () => {
  const dir = await copyClassroom()
  await enterLesson({ classroomDir: dir, manifest: loadManifest(dir), lesson: 5, io: makeFakeIo() })
  const result = await enterLesson({ classroomDir: dir, manifest: loadManifest(dir), lesson: 3, io: makeFakeIo() })
  assert.equal(result.persisted, true)
  assert.equal(result.previous, 5)
  assert.deepEqual(result.skipped, [1, 2])
  const text = await readFile(join(dir, 'runtime', 'progress.md'), 'utf8')
  assert.match(text, /^skipped_lessons: 1,2$/m)
  assert.match(text, /\| 本轮要讲 \| \*\*第 3 讲 · 调度：谁来决定下一个跑谁\*\* \|/)
})

test('⑦ EC 跳讲之后又要求从头开始：第 5 讲 → 第 1 讲，机器行删除、人读行「—」', async () => {
  const dir = await copyClassroom()
  await enterLesson({ classroomDir: dir, manifest: loadManifest(dir), lesson: 5, io: makeFakeIo() })
  const result = await enterLesson({ classroomDir: dir, manifest: loadManifest(dir), lesson: 1, io: makeFakeIo() })
  assert.equal(result.persisted, true)
  assert.deepEqual(result.skipped, [])
  const text = await readFile(join(dir, 'runtime', 'progress.md'), 'utf8')
  assert.match(text, /^current_lesson: 1$/m)
  assert.equal(/^skipped_lessons:/m.test(text), false)
  assert.match(text, /\| 跳过的讲次 \| — \|/)
})

test('⑦ EC N 越界：0 / 15 / 非数字在**写盘之前**就被拒（盘上文件一字不改）', async () => {
  const dir = await copyClassroom()
  const before = await readFile(join(dir, 'runtime', 'progress.md'), 'utf8')
  const manifest = loadManifest(dir)
  for (const bad of [0, 15, 'abc', 2.5]) {
    await assert.rejects(() => enterLesson({ classroomDir: dir, manifest, lesson: bad, io: makeFakeIo() }), LessonJumpError)
  }
  assert.equal(await readFile(join(dir, 'runtime', 'progress.md'), 'utf8'), before)
})

test('🔴 ⑦ 没有讲次门的教室：连「当前讲次」都读不到 → 工具层直接拒绝（不猜、不假成功）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'socratic-jump-bare-'))
  dirs.push(dir)
  await writeFile(
    join(dir, 'classroom.yaml'),
    `format: socratic-classroom/0
classroom: { id: bare }
phases:
  - { id: open, name: 开场 }
blocks:
  - id: plain
    text: x
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
`,
    'utf8',
  )
  const manifest = loadManifest(dir)
  // 没有讲次门 → 连"当前讲次"都读不到（readRuntimeLesson 报错），也没有 progress 文件可写。
  // 生产路径上 index.mjs 的 execute 先判 currentLesson === null 并抛错，不会走到 enterLesson。
  assert.throws(() => readRuntimeLesson(manifest, { baseDir: dir }), /runtime_store/)
  assert.equal(resolveProgressFile(manifest, { baseDir: dir }), null)
  assert.equal(usesLessonGate(manifest), false)
})

test('⑦ 重复跳到同一讲：幂等（第二次写出的内容与第一次一致）', async () => {
  const dir = await copyClassroom()
  await enterLesson({ classroomDir: dir, manifest: loadManifest(dir), lesson: 5, io: makeFakeIo() })
  const once = await readFile(join(dir, 'runtime', 'progress.md'), 'utf8')
  const result = await enterLesson({ classroomDir: dir, manifest: loadManifest(dir), lesson: 5, io: makeFakeIo() })
  assert.equal(result.persisted, true)
  assert.equal(result.previous, 5)
  assert.deepEqual(result.skipped, [1, 2, 3, 4])
  assert.equal(await readFile(join(dir, 'runtime', 'progress.md'), 'utf8'), once)
})

test('⑦ 教室缺 story/ 与 knowledge_points.md：仍然能跳，缺的部分如实报在 missing 里', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'socratic-jump-nofiles-'))
  dirs.push(dir)
  await writeFile(
    join(dir, 'classroom.yaml'),
    `format: socratic-classroom/0
classroom: { id: t, lessons: 3 }
runtime_store:
  dir: runtime/
  progress: runtime/progress.md
  lesson_key: current_lesson
phases:
  - { id: open, name: 开场 }
blocks:
  - id: gated
    text: x
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
    lesson: { current: true, of: 2 }
`,
    'utf8',
  )
  await mkdir(join(dir, 'runtime'), { recursive: true })
  await writeFile(
    join(dir, 'runtime', 'progress.md'),
    'current_lesson: 1\n\n| 项 | 值 |\n|---|---|\n| 本轮要讲 | **第 1 讲** |\n',
    'utf8',
  )
  const result = await enterLesson({ classroomDir: dir, manifest: loadManifest(dir), lesson: 2, io: makeFakeIo() })
  assert.equal(result.persisted, true)
  assert.deepEqual(result.skipped, [1])
  assert.match(result.recap, /【没摘到的部分/)
  assert.match(result.recap, /knowledge_points\.md 不存在/)
  assert.match(result.recap, /story\/ch01\.md 不存在/)
})

// ══════════════════════════════════════════════════════════════════════════════
// ⑧ 工具面（index.mjs）：描述必须把三条硬事实写死，否则模型会自己猜
// ══════════════════════════════════════════════════════════════════════════════

test('⑧ 工具描述：跳过≠掌握 / 返回值带机械摘录 / 落盘失败要如实说 —— 三句都在', async () => {
  const engine = await import('../index.mjs')
  assert.equal(engine.name, 'socratic-engine')
  const d = engine.ENTER_LESSON_TOOL_DESCRIPTION
  assert.match(d, /recorded as SKIPPED, never as mastered/)
  assert.match(d, /none of its knowledge points becomes \[x\]/)
  assert.match(d, /hands you back a recap assembled mechanically/)
  assert.match(d, /persisted:false plus the reason and the lesson does NOT move/)
  assert.match(d, /Nothing from lesson N\+1 onward is included/)
  // 动词优先、不用条件措辞（本项目实证：条件措辞让模型犹豫，工具就够不着）
  assert.equal(/if you need to|you may want to/i.test(d), false)
  assert.match(d, /^Move the class to a different lesson/)
})

// ══════════════════════════════════════════════════════════════════════════════
// ⑨ 集成：把 index.mjs 的 apply() 拉起来（假 ctx），按真实工具的 execute/render 走一遍
//    ——这是「工具真的注册了、真的改了内存、真的把提要交到模型手里」的直接证据。
// ══════════════════════════════════════════════════════════════════════════════

test('⑨ 集成：apply() 注册 classroom_enter_lesson；execute 改盘＋改内存；render 带前情提要', async () => {
  const { apply } = await import('../index.mjs')
  const dir = await copyClassroom()
  const tools = new Map()
  const logs = []
  const ctx = {
    logger: () => ({ info: (...a) => logs.push(a.join(' ')) }),
    on: () => {},
    // cordis 的 ctx.inject（registry 方法）；引擎用它登记可选的 `narrative` 服务键。
    inject: () => {},
    systemPrompt: { section: () => {} },
    tools: { register: (t) => tools.set(t.name, t) },
  }
  // cs-os 声明了 animation: 段 → 必须给渲染器路径（否则 apply 直接报错，这是既有行为）
  await apply(ctx, { classroomDir: dir, animation: { python: '/usr/bin/true', manim: '/usr/bin/true' } })
  assert.ok(tools.has('classroom_enter_lesson'), '工具必须注册')

  const tool = tools.get('classroom_enter_lesson')
  const value = await tool.execute({ lesson: 5 })
  assert.equal(value.persisted, true)
  assert.equal(value.lesson, 5)
  assert.equal(value.previous, 1)
  assert.deepEqual(value.skipped, [1, 2, 3, 4])
  assert.match(value.recap, /【前情提要 · 进入第 5 讲/)
  assert.match(value.recap, /学生没上过第 1–4 讲/)

  // 内存态：classroom_status 读的是同一个闭包变量
  assert.equal((await tools.get('classroom_status').execute({})).lesson, 5)

  // 模型看到的那一段文本：标题行 ＋ recap
  const rendered = tool.output.render({ lesson: 5 }, value)[0].text
  assert.match(rendered, /^已切到第 5 讲 · 内存：每个程序都有自己的世界（原第 1 讲）/)
  assert.match(rendered, /跳过的讲次：第 1–4 讲/)
  assert.match(rendered, /【第 5 讲的前置知识点/)
  // 盘上：下一回合真的按第 5 讲注入
  assert.equal(readRuntimeLesson(loadManifest(dir), { baseDir: dir }), 5)
})

test('🔴 ⑨ 集成：写盘失败时内存态不动（classroom_status 仍报旧讲次）', async () => {
  const { apply } = await import('../index.mjs')
  const dir = await copyClassroom()
  const tools = new Map()
  const ctx = {
    logger: () => ({ info: () => {} }),
    on: () => {},
    inject: () => {},
    systemPrompt: { section: () => {} },
    tools: { register: (t) => tools.set(t.name, t) },
  }
  await apply(ctx, { classroomDir: dir, animation: { python: '/usr/bin/true', manim: '/usr/bin/true' } })
  assert.equal((await tools.get('classroom_status').execute({})).lesson, 1)

  // 造一个**写得进去才怪**的盘：runtime 目录改成只读（读 progress.md 仍然成功，所以能走到写盘那一步）
  const runtime = join(dir, 'runtime')
  const before = await readFile(join(runtime, 'progress.md'), 'utf8')
  await chmod(runtime, 0o500)
  let value
  try {
    value = await tools.get('classroom_enter_lesson').execute({ lesson: 5 })
  } finally {
    await chmod(runtime, 0o700)
  }

  assert.equal(value.persisted, false)
  assert.match(value.note, /落盘失败/)
  assert.equal(value.lesson, 1)
  // 🔴 内存态没有跟着动：classroom_status 读的是同一个闭包变量
  assert.equal((await tools.get('classroom_status').execute({})).lesson, 1)
  // 盘上也没变
  assert.equal(await readFile(join(runtime, 'progress.md'), 'utf8'), before)
  // 模型看到的是"没切成功"，不是"已切到"
  const rendered = tools.get('classroom_enter_lesson').output.render({ lesson: 5 }, value)[0].text
  assert.match(rendered, /^🔴 没有切讲成功/)
  assert.match(rendered, /本轮仍是第 1 讲/)
})

test('③ 真教室的 progress.md 有两行工具要用的人读行（模板不能悄悄丢掉它们）', () => {
  assert.match(CSOS_PROGRESS, new RegExp(`^\\| ${LESSON_ROW_LABEL} \\|`, 'm'))
  assert.match(CSOS_PROGRESS, new RegExp(`^\\| ${SKIPPED_ROW_LABEL} \\|`, 'm'))
})

test('④ 知识点行压成标题：抽得出 KP id 就压，抽不出就原样保留（不猜不丢）', () => {
  assert.equal(knowledgePointHeading('- [ ] **KP-3.2 FIFO 的问题** —— 判据：学生能举出例子。'), 'KP-3.2 FIFO 的问题')
  assert.equal(knowledgePointHeading('- [~] **KP-10.4 锁的粒度** —— 判据：…'), 'KP-10.4 锁的粒度')
  assert.equal(knowledgePointHeading('随便一行'), '随便一行')
})

test('④ 跳到第 14 讲：只近两讲给原文（N-2、N-1），更早的 1–11 讲只列标题，块体量腰斩', async () => {
  const ctx = await readLessonContext({ classroomDir: CS_OS, lesson: 14 })
  const skipped = Array.from({ length: 13 }, (_, i) => i + 1)
  const recap = buildRecap({ lesson: 14, skipped, ...ctx })
  const kpBlock = recap.slice(recap.indexOf('【第 14 讲的前置知识点'), recap.indexOf('【没摘到的部分'))
  const fullTagged = ctx.prerequisites.filter((p) => p.full).map((p) => p.lesson)
  assert.deepEqual(fullTagged, [14 - PREREQ_FULL_WINDOW, 13])
  // 近两讲是原文，更早的是「· KP-x.y 标题」
  assert.match(kpBlock, /- \[ \] \*\*KP-12\.1 非死锁缺陷\*\*/)
  assert.match(kpBlock, /- \[ \] \*\*KP-13\.1 inode\*\*/)
  assert.match(kpBlock, /· KP-1\.1 进程是什么/)
  assert.equal(kpBlock.includes('判据：能区分静态程序文件'), false)
  // 体量：全量原文时约 7.6KB，分档后 < 4KB（这就是分档的目的）
  const allFull = buildRecap({ lesson: 14, skipped, ...ctx, prerequisites: ctx.prerequisites.map((p) => ({ ...p, full: true })) })
  const allBlock = allFull.slice(allFull.indexOf('【第 14 讲的前置知识点'), allFull.indexOf('【没摘到的部分'))
  assert.ok(Buffer.byteLength(kpBlock) < 4000, `分档后应 < 4KB，实得 ${Buffer.byteLength(kpBlock)}`)
  assert.ok(Buffer.byteLength(kpBlock) * 2 < Buffer.byteLength(allBlock), '分档后应不到全量原文的一半')
})
