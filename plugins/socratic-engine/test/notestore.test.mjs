// test/notestore.test.mjs — lib/notestore.mjs 的单测（K3 课堂记录）
//
// 纪律：不调 LLM、不起宿主、不碰真实教室目录、不碰 $DSH_HOME。
// IO 注入：假 io 用**真实临时目录 + 同一算法**的原子写（临时文件 + rename），
// `withFileLock` 用按路径的互斥队列（宿主版是 `<file>.lock` 跨进程锁）——
// 目的是让"并发写不能丢记录"这条 AC 在单进程里也能被真正测到。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, rename, mkdir, stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  GENERATED_LINE,
  KP_FILE,
  MAX_QUOTE_CHARS,
  MISTAKE_LOG_FILE,
  NOTES_FILE,
  NOTE_TYPES,
  REVIEW_INTERVALS,
  REVIEW_QUEUE_FILE,
  applyKpProjection,
  appendNoteLine,
  cleanRecordText,
  compareNotes,
  createNoteStore,
  deriveNotes,
  findDuplicateNote,
  idStamp,
  isoWithOffset,
  nextSeqFor,
  noteIdOf,
  parseKnowledgePoints,
  parseNotesJsonl,
  readProgressState,
  renderMistakeLog,
  renderNoteLine,
  renderReviewQueue,
  sortNotes,
  stripMarkdown,
  validateNoteArgs,
} from '../lib/notestore.mjs'
import { stripEmotionMarkers } from '../lib/emotionmark.mjs'

// ---------------------------------------------------------------- 测试替身

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

/** 按路径串行化的假文件锁（同路径的临界区互斥；不同路径互不影响）。 */
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

const KP_FIXTURE = `# 知识点清单 · 测试

> 三档：\`[ ]\` ｜ \`[~]\` ｜ \`[x]\`。

## 第 1 讲 · 一
- [ ] **KP-1.1 进程是什么** —— 判据：能区分程序与进程。
- [ ] **KP-1.2 虚拟化 CPU** —— 判据：能解释时间共享。

## 第 2 讲 · 二
- [ ] **KP-2.1 fork 的语义** —— 判据：能解释父子都往下走。

## 第 3 讲 · 三
- [ ] **KP-3.2 FIFO 的问题** —— 判据：能举出长任务堵短任务的例子。
`

const PROGRESS_FIXTURE = `# 学习进度

current_lesson: 3

| 项 | 值 |
|---|---|
| 本轮要讲 | **第 3 讲** |
`

/** 起一个铺好的临时教室（runtime/ + knowledge_points.md + progress.md）。 */
async function setup({ kp = KP_FIXTURE, progress = PROGRESS_FIXTURE, notes = null } = {}) {
  const classroomDir = await mkdtemp(join(tmpdir(), 'socratic-note-'))
  const runtimeDir = join(classroomDir, 'runtime')
  await mkdir(runtimeDir, { recursive: true })
  await writeFile(join(classroomDir, KP_FILE), kp)
  await writeFile(join(runtimeDir, 'progress.md'), progress)
  if (notes !== null) await writeFile(join(runtimeDir, NOTES_FILE), notes)
  const io = makeFakeIo()
  return { classroomDir, runtimeDir, io }
}

let clock = 1_760_000_000_000
function makeStore({ classroomDir, runtimeDir, io }, { advance = 1000 } = {}) {
  clock += advance
  return createNoteStore({ classroomDir, runtimeDir, io, now: () => clock, log: () => {} })
}

const MISCONCEPTION = {
  type: 'misconception',
  kp: 'KP-3.2',
  quote: 'FIFO 里长任务排前面，短任务也会一样快吧？',
  note: '把"平均"当成了"每个"',
}

// ---------------------------------------------------------------- 文本清洗

test('stripMarkdown：剥格式不改字（围栏、井号、引用、列表、链接、强调）', () => {
  assert.equal(stripMarkdown('**fork 是复制**'), 'fork 是复制')
  assert.equal(stripMarkdown('## 标题'), '标题')
  assert.equal(stripMarkdown('> 引用'), '引用')
  assert.equal(stripMarkdown('- 列表项'), '列表项')
  assert.equal(stripMarkdown('1. 第一项'), '第一项')
  assert.equal(stripMarkdown('[文字](https://example.com)'), '文字')
  assert.equal(stripMarkdown('![图](x.png)'), '图')
  assert.equal(stripMarkdown('~~删掉~~'), '删掉')
  assert.equal(stripMarkdown('`fork` 与 `exec`'), 'fork 与 exec')
  assert.equal(stripMarkdown('```\nflowchart TD\n```'), 'flowchart TD')
})

test('stripMarkdown：**不剥下划线**（代码里的名字不能被改坏）', () => {
  assert.equal(stripMarkdown('fork_exec 是一个函数名'), 'fork_exec 是一个函数名')
})

test('cleanRecordText：先按 K1 剥情绪标记，再去 markdown（两步都幂等）', () => {
  const raw = '**fork 之后**都从同一行往下走〔emo:shy:0.60〕？'
  assert.equal(cleanRecordText(raw), 'fork 之后都从同一行往下走？')
  assert.equal(cleanRecordText(cleanRecordText(raw)), cleanRecordText(raw))
  // 非法标记也要剥掉（K1.3-3：不显示、不报错）
  assert.equal(cleanRecordText('这样对吧〔emo:angry:0.60〕'), '这样对吧')
  assert.equal(cleanRecordText('这样对吧〔emo:shy:0.6〕'), '这样对吧')
})

test('cleanRecordText：未闭合的〔原样保留（那是正文，不是标记）', () => {
  assert.equal(cleanRecordText('see 〔 emo 半截'), 'see 〔 emo 半截')
  assert.equal(stripEmotionMarkers('a〔emo:calm:0.50'), 'a〔emo:calm:0.50')
})

// ---------------------------------------------------------------- JSONL

test('parseNotesJsonl：坏行跳过并如实报告行号（不静默、不猜）', () => {
  const text = [
    JSON.stringify({ v: 1, id: 'N-20261020T231500-001', ts: '2026-10-20T23:15:00-04:00', session: 's', lesson: 3, turn: 5, type: 'misconception', kp: 'KP-3.2', quote: 'q', note: '', origin: 'teacher' }),
    '{坏行',
    JSON.stringify({ v: 2, id: 'x' }),
    '',
  ].join('\n')
  const { records, bad } = parseNotesJsonl(text)
  assert.equal(records.length, 1)
  assert.equal(records[0].id, 'N-20261020T231500-001')
  assert.equal(bad.length, 2)
  assert.deepEqual(bad.map((b) => b.line), [2, 3])
  assert.match(bad[1].reason, /v=2/)
})

test('parseNotesJsonl：缺字段按缺省值补齐，不抛错（读方按版本分派）', () => {
  const { records } = parseNotesJsonl(JSON.stringify({ v: 1, id: 'x' }))
  assert.equal(records.length, 1)
  assert.equal(records[0].lesson, 0)
  assert.equal(records[0].kp, null)
  assert.equal(records[0].quote, '')
})

test('id/ts：带时区的 ISO 与 `<stamp>-<三位序号>` 形状（K3.2）', () => {
  const ms = new Date('2026-10-20T23:15:00-04:00').getTime()
  assert.match(isoWithOffset(ms), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
  assert.match(idStamp(ms), /^\d{8}T\d{6}$/)
  assert.equal(noteIdOf(idStamp(ms), 7), `N-${idStamp(ms)}-007`)
  assert.throws(() => noteIdOf('20261020T231500', 0), /1\.\.999/)
  assert.throws(() => noteIdOf('20261020T231500', 1000), /1\.\.999/)
})

test('nextSeqFor：同一秒内递增，跨秒从 0 重来；其余 stamp 不影响', () => {
  const records = [
    { id: 'N-20261020T231500-001' },
    { id: 'N-20261020T231500-002' },
    { id: 'N-20261020T231501-009' },
  ]
  assert.equal(nextSeqFor(records, '20261020T231500'), 3)
  assert.equal(nextSeqFor(records, '20261020T231502'), 1)
  assert.equal(nextSeqFor([], '20261020T231500'), 1)
})

test('renderNoteLine：字段顺序固定、不写 resolved（K3.2 表末行）', () => {
  const line = renderNoteLine({
    id: 'N-1-001',
    ts: 't',
    session: 's',
    lesson: 3,
    turn: 5,
    type: 'misconception',
    kp: 'KP-3.2',
    quote: 'q',
    note: 'n',
    origin: 'teacher',
    resolved: true,
  })
  assert.equal(
    line,
    '{"v":1,"id":"N-1-001","ts":"t","session":"s","lesson":3,"turn":5,"type":"misconception","kp":"KP-3.2","quote":"q","note":"n","origin":"teacher"}\n',
  )
  assert.equal(line.includes('resolved'), false)
})

test('appendNoteLine：只追加，不重排、不改写原有行', () => {
  const first = '{"v":1}\n'
  assert.equal(appendNoteLine('', first), first)
  assert.equal(appendNoteLine(first, '{"v":2}\n'), `${first}{"v":2}\n`)
  // 原文件末尾缺换行 → 补一个，不粘行
  assert.equal(appendNoteLine('{"v":1}', '{"v":2}\n'), '{"v":1}\n{"v":2}\n')
})

test('compareNotes：按 (lesson, turn, id) 字典序 = 时间序（K3.3）', () => {
  const a = { lesson: 3, turn: 5, id: 'N-20261020T231500-001' }
  const b = { lesson: 3, turn: 5, id: 'N-20261020T231500-002' }
  const c = { lesson: 3, turn: 6, id: 'N-20261020T231400-001' }
  const d = { lesson: 4, turn: 1, id: 'N-20261020T230000-001' }
  assert.deepEqual(sortNotes([d, c, b, a]).map((r) => r.id), [a.id, b.id, c.id, d.id])
})

// ---------------------------------------------------------------- 解析

test('parseKnowledgePoints：读出编号、讲次、三档状态；totalLessons = 最大讲次', () => {
  const parsed = parseKnowledgePoints(KP_FIXTURE)
  assert.equal(parsed.byId.size, 4)
  assert.equal(parsed.totalLessons, 3)
  assert.equal(parsed.byId.get('KP-3.2').lesson, 3)
  assert.equal(parsed.byId.get('KP-1.1').status, ' ')
})

test('readProgressState：读 current_lesson；skipped_lessons 缺省＝没有跳过', () => {
  assert.deepEqual(readProgressState(PROGRESS_FIXTURE).currentLesson, 3)
  assert.equal(readProgressState(PROGRESS_FIXTURE).skippedLessons.size, 0)
  const withSkip = readProgressState('current_lesson: 5\nskipped_lessons: 1,2, 3\n')
  assert.equal(withSkip.currentLesson, 5)
  assert.deepEqual([...withSkip.skippedLessons], [1, 2, 3])
  assert.equal(readProgressState('随便什么内容').currentLesson, null)
})

// ---------------------------------------------------------------- 推导

const r = (over = {}) => ({
  v: 1,
  id: 'N-20261020T231500-001',
  ts: '2026-10-20T23:15:00-04:00',
  session: 's',
  lesson: 3,
  turn: 5,
  type: 'misconception',
  kp: 'KP-3.2',
  quote: 'q',
  note: '',
  origin: 'teacher',
  ...over,
})

test('推导①：最后一条是 evidence → [x]；是 misconception/blocker → [~]；没有记录 → 不在表里', () => {
  const records = [
    r({ id: 'N-1', type: 'misconception' }),
    r({ id: 'N-2', type: 'evidence', kp: 'KP-1.1', lesson: 3, turn: 6 }),
  ]
  const derived = deriveNotes(records)
  assert.equal(derived.kpStates.get('KP-3.2').status, '~')
  assert.equal(derived.kpStates.get('KP-1.1').status, 'x')
  assert.equal(derived.kpStates.has('KP-1.2'), false)
})

test('推导①：顺序由 (lesson,turn,id) 决定，与传入顺序无关', () => {
  const later = r({ id: 'N-9', type: 'evidence', turn: 9 })
  const earlier = r({ id: 'N-1', type: 'misconception', turn: 1 })
  assert.equal(deriveNotes([later, earlier]).kpStates.get('KP-3.2').status, 'x')
  assert.equal(deriveNotes([earlier, later]).kpStates.get('KP-3.2').status, 'x')
})

test('🔴 红线：没有 evidence 记录就绝不会有 [x]（"老师讲过"不产生记录）', () => {
  const derived = deriveNotes([r({ type: 'misconception' })])
  assert.notEqual(derived.kpStates.get('KP-3.2').status, 'x')
  // 一条记录都没有 → 表里根本没有这个 kp → 投影一个字都不改
  assert.equal(deriveNotes([]).kpStates.size, 0)
})

test('推导①（J2 红线）：kp 所属讲次被跳过 → skipped=true、状态不写', () => {
  const derived = deriveNotes([r({ type: 'evidence' })], { skippedLessons: new Set([3]) })
  assert.equal(derived.kpStates.get('KP-3.2').skipped, true)
  const kp = applyKpProjection(KP_FIXTURE, derived)
  assert.match(kp.text, /- \[ \] \*\*KP-3\.2 FIFO 的问题\*\* —— 判据：能举出长任务堵短任务的例子。（跳过）/)
  assert.equal(kp.text.includes('- [x] **KP-3.2'), false)
})

test('推导②：同一 kp 上有更晚的 evidence → resolved，并记下是谁解决的', () => {
  const records = [
    r({ id: 'N-1', lesson: 3, turn: 5 }),
    r({ id: 'N-3', type: 'evidence', lesson: 4, turn: 2 }),
  ]
  const derived = deriveNotes(records)
  assert.equal(derived.mistakes.length, 1)
  assert.equal(derived.mistakes[0].resolved, true)
  assert.equal(derived.mistakes[0].resolvedBy.id, 'N-3')
})

test('推导②：更早的 evidence 不解决后来的卡点（时间序，不是"存在即解决"）', () => {
  const records = [
    r({ id: 'N-1', type: 'evidence', lesson: 3, turn: 4 }),
    r({ id: 'N-2', type: 'blocker', lesson: 3, turn: 5 }),
  ]
  assert.equal(deriveNotes(records).mistakes[0].resolved, false)
})

test('推导②：group_question 不进错题本', () => {
  const derived = deriveNotes([r({ type: 'group_question', kp: null })])
  assert.equal(derived.mistakes.length, 0)
})

test(`推导③：到期点 = 记录讲次 + {${REVIEW_INTERVALS.join(',')}}，只留 ≤ 总讲数`, () => {
  const derived = deriveNotes([r({ lesson: 3 })], { totalLessons: 10 })
  assert.deepEqual(derived.review[0].dueLessons, [4, 6, 10])
  const tight = deriveNotes([r({ lesson: 3 })], { totalLessons: 5 })
  assert.deepEqual(tight.review[0].dueLessons, [4])
})

test('推导③：当前讲次 ≥ 到期讲次且未解决 → 到期；未到 → 不到期', () => {
  const records = [r({ lesson: 3 })]
  assert.equal(deriveNotes(records, { totalLessons: 10, currentLesson: 3 }).review[0].duePoint, null)
  assert.equal(deriveNotes(records, { totalLessons: 10, currentLesson: 4 }).review[0].duePoint, 4)
  assert.equal(deriveNotes(records, { totalLessons: 10, currentLesson: 9 }).review[0].duePoint, 6)
})

test('推导③：已解决 → 后续到期点作废（不再到期）', () => {
  const records = [r({ id: 'N-1', lesson: 3, turn: 5 }), r({ id: 'N-2', type: 'evidence', lesson: 4, turn: 1 })]
  const derived = deriveNotes(records, { totalLessons: 10, currentLesson: 9 })
  assert.equal(derived.review[0].resolved, true)
  assert.equal(derived.review[0].duePoint, null)
  assert.deepEqual(derived.review[0].dueLessons, [4, 6, 10]) // 计划还在，只是作废
})

test('推导③：同一 kp 多条记录只保留最早一条的到期点（避免堆积）', () => {
  const records = [r({ id: 'N-1', lesson: 3 }), r({ id: 'N-2', lesson: 5 })]
  const derived = deriveNotes(records, { totalLessons: 10 })
  assert.equal(derived.review.length, 1)
  assert.equal(derived.review[0].record.id, 'N-1')
})

test('推导③：没有讲次门的记录（lesson=0）不排复习', () => {
  const derived = deriveNotes([r({ lesson: 0 })], { totalLessons: 10 })
  assert.deepEqual(derived.review[0].dueLessons, [])
  assert.equal(derived.review[0].duePoint, null)
})

// ---------------------------------------------------------------- 投影渲染

test('renderMistakeLog：文件头写「机械生成」、两段都在、已解决的保留并标解决位置', () => {
  const derived = deriveNotes([
    r({ id: 'N-1', lesson: 3, turn: 5, quote: '长任务排前面短任务也快吧' }),
    r({ id: 'N-2', type: 'evidence', lesson: 4, turn: 2 }),
    r({ id: 'N-3', type: 'blocker', lesson: 4, turn: 3, kp: 'KP-1.2', quote: '说不清时间共享' }),
  ])
  const text = renderMistakeLog(derived)
  assert.ok(text.includes(GENERATED_LINE))
  assert.ok(text.includes('## 未解决'))
  assert.ok(text.includes('## 已解决'))
  assert.ok(text.includes('已解决（第 4 讲 · 第 2 回合）'))
  assert.ok(text.includes('说不清时间共享')) // 未解决那条仍在
  assert.ok(text.includes('长任务排前面短任务也快吧')) // 已解决的不删除
  assert.match(text, /^\|\s*$|^\| /m)
})

test('renderMistakeLog：空教室（没有记录）两段都非空（空段会让 manifest 块静默失效）', () => {
  const text = renderMistakeLog(deriveNotes([]))
  const unresolved = text.split('## 未解决')[1].split('## 已解决')[0].trim()
  const resolved = text.split('## 已解决')[1].trim()
  assert.ok(unresolved.length > 0)
  assert.ok(resolved.length > 0)
  assert.ok(unresolved.includes('（暂无未解决的卡点或误解）'))
  assert.ok(resolved.includes('（暂无已解决的记录）'))
})

test('renderReviewQueue：文件头、两段、到期标注与"当前讲次"', () => {
  const derived = deriveNotes([r({ lesson: 3 })], { totalLessons: 10, currentLesson: 4 })
  const text = renderReviewQueue(derived, { currentLesson: 4 })
  assert.ok(text.includes(GENERATED_LINE))
  assert.ok(text.includes('## 到期待复习'))
  assert.ok(text.includes('## 全部复习计划'))
  assert.ok(text.includes('**到期**（当前第 4 讲 ≥ 第 4 讲）'))
  assert.ok(text.includes('第 4 讲 / 第 6 讲 / 第 10 讲'))
})

test('renderReviewQueue：不到期 / 已解决 / 空队列三种文案都具确定性', () => {
  const notDue = renderReviewQueue(deriveNotes([r({ lesson: 3 })], { totalLessons: 10, currentLesson: 2 }), {
    currentLesson: 2,
  })
  assert.ok(notDue.includes('（当前没有到期的复习项）'))
  assert.ok(notDue.includes('未到期'))
  const resolved = renderReviewQueue(
    deriveNotes([r({ id: 'N-1', lesson: 3 }), r({ id: 'N-2', type: 'evidence', lesson: 4, turn: 1 })], {
      totalLessons: 10,
      currentLesson: 9,
    }),
    { currentLesson: 9 },
  )
  assert.ok(resolved.includes('已解决（后续到期点作废）'))
  const empty = renderReviewQueue(deriveNotes([]), { currentLesson: null })
  assert.ok(empty.includes('（当前没有到期的复习项）'))
  assert.ok(empty.includes('（还没有任何卡点或误解记录）'))
  assert.ok(empty.includes('读不到 `runtime/progress.md` 的 `current_lesson`'))
})

test('applyKpProjection：只动有记录的 kp，其余逐字不变；幂等', () => {
  const derived = deriveNotes([r({ type: 'misconception' })])
  const once = applyKpProjection(KP_FIXTURE, derived)
  assert.match(once.text, /- \[~\] \*\*KP-3\.2 FIFO 的问题\*\*/)
  assert.match(once.text, /- \[ \] \*\*KP-1\.1 进程是什么\*\*/) // 没有记录 → 不动
  assert.equal(applyKpProjection(once.text, derived).text, once.text)
})

test('applyKpProjection：「（跳过）」幂等（重复推导不叠加）', () => {
  const derived = deriveNotes([r({ type: 'evidence' })], { skippedLessons: new Set([3]) })
  const once = applyKpProjection(KP_FIXTURE, derived)
  const twice = applyKpProjection(once.text, derived)
  assert.equal(twice.text, once.text)
  assert.equal(once.text.split('（跳过）').length, 2)
})

test('applyKpProjection：evidence 之后 [x]；随后又在同一 kp 记了卡点 → 回到 [~]', () => {
  const x = applyKpProjection(KP_FIXTURE, deriveNotes([r({ id: 'N-1', type: 'evidence' })])).text
  assert.match(x, /- \[x\] \*\*KP-3\.2/)
  const back = applyKpProjection(x, deriveNotes([r({ id: 'N-1', type: 'evidence' }), r({ id: 'N-2', turn: 9 })]))
  assert.match(back.text, /- \[~\] \*\*KP-3\.2/)
  assert.equal(back.changed, 1)
})

// ---------------------------------------------------------------- 入参校验（EC）

test('validateNoteArgs：type 非法 → 报错并列出可用类型', () => {
  const check = validateNoteArgs({ type: 'bogus', kp: 'KP-3.2', quote: 'q' })
  assert.equal(check.ok, false)
  for (const t of NOTE_TYPES) assert.ok(check.problems.join(' ').includes(t))
})

test('validateNoteArgs：quote 为空 / 全空白 / 只有标记 → 报错（不静默落盘）', () => {
  for (const quote of ['', '   ', '\n\t', '〔emo:shy:0.60〕', '**']) {
    const check = validateNoteArgs({ type: 'misconception', kp: 'KP-3.2', quote })
    assert.equal(check.ok, false, `quote=${JSON.stringify(quote)} 应当被拒`)
    assert.match(check.problems.join(' '), /quote 为空/)
  }
})

test('validateNoteArgs：quote 过长 → 报错（不截断）', () => {
  const check = validateNoteArgs({ type: 'misconception', kp: 'KP-3.2', quote: '字'.repeat(MAX_QUOTE_CHARS + 1) })
  assert.equal(check.ok, false)
  assert.match(check.problems.join(' '), /quote 过长/)
})

test('validateNoteArgs：kp 不存在 → 报错并给出现有编号示例', () => {
  const kps = parseKnowledgePoints(KP_FIXTURE).byId
  const check = validateNoteArgs({ type: 'misconception', kp: 'KP-9.9', quote: 'q' }, { kps })
  assert.equal(check.ok, false)
  assert.match(check.problems.join(' '), /KP-9\.9.*不存在/)
  assert.match(check.problems.join(' '), /KP-1\.1/)
})

test('validateNoteArgs：kp 形状不对 → 报错', () => {
  const kps = parseKnowledgePoints(KP_FIXTURE).byId
  const check = validateNoteArgs({ type: 'misconception', kp: '3.2', quote: 'q' }, { kps })
  assert.equal(check.ok, false)
  assert.match(check.problems.join(' '), /形状不对/)
})

test('validateNoteArgs：group_question 可以不填 kp；其它类型不填则报错', () => {
  const kps = parseKnowledgePoints(KP_FIXTURE).byId
  assert.equal(validateNoteArgs({ type: 'group_question', quote: '群里问的' }, { kps }).ok, true)
  const bad = validateNoteArgs({ type: 'blocker', quote: 'q' }, { kps })
  assert.equal(bad.ok, false)
  assert.match(bad.problems.join(' '), /kp 必填/)
})

test('validateNoteArgs：合法入参 → 清洗后的 value（quote 去 markdown、kp 去空白）', () => {
  const kps = parseKnowledgePoints(KP_FIXTURE).byId
  const check = validateNoteArgs(
    { type: 'misconception', kp: ' KP-3.2 ', quote: '**FIFO** 快吧？〔emo:calm:0.50〕', note: ' 把平均当成每个 ' },
    { kps },
  )
  assert.equal(check.ok, true)
  assert.equal(check.value.kp, 'KP-3.2')
  assert.equal(check.value.quote, 'FIFO 快吧？')
  assert.equal(check.value.note, '把平均当成每个')
})

test('findDuplicateNote：同回合同内容 → 命中；不同回合/不同原话 → 不命中', () => {
  const records = [r({ session: 's', turn: 5, type: 'misconception', kp: 'KP-3.2', quote: 'a' })]
  assert.equal(findDuplicateNote(records, { session: 's', turn: 5, type: 'misconception', kp: 'KP-3.2', quote: 'a' }).id, 'N-20261020T231500-001')
  assert.equal(findDuplicateNote(records, { session: 's', turn: 6, type: 'misconception', kp: 'KP-3.2', quote: 'a' }), null)
  assert.equal(findDuplicateNote(records, { session: 's', turn: 5, type: 'blocker', kp: 'KP-3.2', quote: 'a' }), null)
  assert.equal(findDuplicateNote(records, { session: 's', turn: 5, type: 'misconception', kp: 'KP-3.2', quote: 'b' }), null)
})

// ---------------------------------------------------------------- 落盘（IO）

test('落盘：一条误解 → JSONL 一行 + 三份投影整文件重写（含机械生成头）', async () => {
  const env = await setup()
  const store = makeStore(env)
  const result = await store.append(MISCONCEPTION, { session: 'sess-1', lesson: 3, turn: 5 })
  assert.equal(result.ok, true)
  assert.equal(result.duplicate, false)
  assert.equal(result.record.id.startsWith('N-'), true)
  assert.equal(result.record.lesson, 3)
  assert.equal(result.record.turn, 5)
  assert.equal(result.record.session, 'sess-1')
  assert.equal(result.record.origin, 'teacher')

  const notes = await readFile(join(env.runtimeDir, NOTES_FILE), 'utf8')
  assert.equal(notes.trim().split('\n').length, 1)
  assert.equal(JSON.parse(notes.trim()).quote, MISCONCEPTION.quote)
  assert.equal('resolved' in JSON.parse(notes.trim()), false)

  for (const file of [MISTAKE_LOG_FILE, REVIEW_QUEUE_FILE]) {
    const text = await readFile(join(env.runtimeDir, file), 'utf8')
    assert.ok(text.includes(GENERATED_LINE), `${file} 缺机械生成头`)
  }
  const kp = await readFile(join(env.classroomDir, KP_FILE), 'utf8')
  assert.match(kp, /- \[~\] \*\*KP-3\.2/)
})

test('落盘：文件权限 0600（与教室既有 runtime 文件一致）', async () => {
  const env = await setup()
  await makeStore(env).append(MISCONCEPTION, { session: 's', lesson: 3, turn: 5 })
  const mode = (await stat(join(env.runtimeDir, NOTES_FILE))).mode & 0o777
  assert.equal(mode, 0o600)
})

test('幂等：同一回合重复调用 → 只留一条，返回 duplicate=true', async () => {
  const env = await setup()
  const store = makeStore(env, { advance: 1000 })
  const first = await store.append(MISCONCEPTION, { session: 's', lesson: 3, turn: 5 })
  const second = await makeStore(env, { advance: 1000 }).append(MISCONCEPTION, { session: 's', lesson: 3, turn: 5 })
  assert.equal(second.duplicate, true)
  assert.equal(second.record.id, first.record.id)
  const notes = await readFile(join(env.runtimeDir, NOTES_FILE), 'utf8')
  assert.equal(notes.trim().split('\n').length, 1)
})

test('幂等：同一回合记两条**不同原话**是合法的（各一条记录）', async () => {
  const env = await setup()
  await makeStore(env).append(MISCONCEPTION, { session: 's', lesson: 3, turn: 5 })
  await makeStore(env).append(
    { ...MISCONCEPTION, quote: '那 SJF 是不是就能知道未来？' },
    { session: 's', lesson: 3, turn: 5 },
  )
  const notes = await readFile(join(env.runtimeDir, NOTES_FILE), 'utf8')
  assert.equal(notes.trim().split('\n').length, 2)
})

test('并发：20 条同时写 → 一条不丢，且 id 不重复（原子写 + 文件锁）', async () => {
  const env = await setup()
  const store = makeStore(env)
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      store.append(
        { type: 'misconception', kp: 'KP-3.2', quote: `第 ${i} 句原话` },
        { session: 's', lesson: 3, turn: i + 1 },
      ),
    ),
  )
  const ids = results.map((res) => res.record.id)
  assert.equal(new Set(ids).size, 20)
  const notes = await readFile(join(env.runtimeDir, NOTES_FILE), 'utf8')
  const lines = notes.trim().split('\n')
  assert.equal(lines.length, 20)
  const parsed = lines.map((line) => JSON.parse(line))
  assert.equal(new Set(parsed.map((p) => p.id)).size, 20)
  // 投影也跟着重算（20 条未解决）
  const log = await readFile(join(env.runtimeDir, MISTAKE_LOG_FILE), 'utf8')
  assert.equal(log.split('\n').filter((l) => l.startsWith('| 2026') || /^\| \d{4}-\d{2}-\d{2}/.test(l)).length, 20)
})

test('EC：kp 不存在 → 抛错，且 JSONL 与三份投影一个字都没写', async () => {
  const env = await setup()
  const store = makeStore(env)
  const before = await readFile(join(env.classroomDir, KP_FILE), 'utf8')
  await assert.rejects(
    () => store.append({ ...MISCONCEPTION, kp: 'KP-9.9' }, { session: 's', lesson: 3, turn: 5 }),
    /KP-9\.9.*不存在/s,
  )
  await assert.rejects(() => readFile(join(env.runtimeDir, NOTES_FILE), 'utf8'), /ENOENT/)
  await assert.rejects(() => readFile(join(env.runtimeDir, MISTAKE_LOG_FILE), 'utf8'), /ENOENT/)
  assert.equal(await readFile(join(env.classroomDir, KP_FILE), 'utf8'), before)
})

test('EC：quote 为空 → 抛错，不落盘', async () => {
  const env = await setup()
  await assert.rejects(
    () => makeStore(env).append({ ...MISCONCEPTION, quote: '   ' }, { session: 's', lesson: 3, turn: 5 }),
    /quote 为空/,
  )
  await assert.rejects(() => readFile(join(env.runtimeDir, NOTES_FILE), 'utf8'), /ENOENT/)
})

test('EC：先误解后掌握证据 → 状态 [x]、错题本那条标已解决且不删除', async () => {
  const env = await setup()
  await makeStore(env).append(MISCONCEPTION, { session: 's', lesson: 3, turn: 5 })
  await makeStore(env).append(
    { type: 'evidence', kp: 'KP-3.2', quote: '长任务占着 CPU，后面的短任务只能等它让出来。', note: '自己举了例' },
    { session: 's', lesson: 4, turn: 2 },
  )
  const kp = await readFile(join(env.classroomDir, KP_FILE), 'utf8')
  assert.match(kp, /- \[x\] \*\*KP-3\.2/)
  const log = await readFile(join(env.runtimeDir, MISTAKE_LOG_FILE), 'utf8')
  assert.ok(log.includes('已解决（第 4 讲 · 第 2 回合）'))
  assert.ok(log.includes(MISCONCEPTION.quote))
  const notes = await readFile(join(env.runtimeDir, NOTES_FILE), 'utf8')
  assert.equal(notes.trim().split('\n').length, 2)
})

test('EC：跳过讲次 → 状态位不动、只加「（跳过）」', async () => {
  const env = await setup({ progress: 'current_lesson: 3\nskipped_lessons: 3\n' })
  await makeStore(env).append({ type: 'evidence', kp: 'KP-3.2', quote: '能解释堵住的原因' }, {
    session: 's',
    lesson: 3,
    turn: 5,
  })
  const kp = await readFile(join(env.classroomDir, KP_FILE), 'utf8')
  assert.match(kp, /- \[ \] \*\*KP-3\.2 FIFO 的问题\*\*.*（跳过）/)
})

test('EC：group_question 不填 kp 也能落盘，但不进三份投影', async () => {
  const env = await setup()
  const result = await makeStore(env).append(
    { type: 'group_question', quote: '群里问：MMU 到底在哪里？' },
    { session: 's', lesson: 3, turn: 5 },
  )
  assert.equal(result.record.kp, null)
  const log = await readFile(join(env.runtimeDir, MISTAKE_LOG_FILE), 'utf8')
  assert.ok(log.includes('（暂无未解决的卡点或误解）'))
  const kp = await readFile(join(env.classroomDir, KP_FILE), 'utf8')
  assert.equal(kp, KP_FIXTURE)
})

test('EC：落盘前剥净情绪标记与 markdown（quote 与 note 都剥）', async () => {
  const env = await setup()
  await makeStore(env).append(
    {
      type: 'misconception',
      kp: 'KP-3.2',
      quote: '**FIFO 里长任务排前面**，短任务也会一样快吧？〔emo:puzzled:0.70〕',
      note: '`平均` ≠ `每个`',
    },
    { session: 's', lesson: 3, turn: 5 },
  )
  const record = JSON.parse((await readFile(join(env.runtimeDir, NOTES_FILE), 'utf8')).trim())
  assert.equal(record.quote, 'FIFO 里长任务排前面，短任务也会一样快吧？')
  assert.equal(record.note, '平均 ≠ 每个')
  assert.equal(JSON.stringify(record).includes('emo:'), false)
})

test('reproject：不发新记录、只按真源重算三份投影', async () => {
  const env = await setup()
  const store = makeStore(env)
  await store.append(MISCONCEPTION, { session: 's', lesson: 3, turn: 5 })
  // 手写坏投影（模拟别的写入者或历史遗留）
  await writeFile(join(env.runtimeDir, MISTAKE_LOG_FILE), '# 手写的错题本\n只有这一行\n')
  const result = await store.reproject()
  assert.equal(result.records, 1)
  const log = await readFile(join(env.runtimeDir, MISTAKE_LOG_FILE), 'utf8')
  assert.ok(log.startsWith('# 错题本（机械生成）'))
  assert.ok(log.includes(GENERATED_LINE))
})

test('createNoteStore：缺 classroomDir / runtimeDir → 当场抛错（不静默）', () => {
  assert.throws(() => createNoteStore({ runtimeDir: '/tmp/x' }), /classroomDir/)
  assert.throws(() => createNoteStore({ classroomDir: '/tmp/x' }), /runtimeDir/)
})
