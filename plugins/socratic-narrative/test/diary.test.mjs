// test/diary.test.mjs — N2：输入收集 / 写法校验（120 字）/ 幂等 / 回滚 / 读回
//
// 🔴 其中一组是**发布约束**的机器守卫：给日记 agent 的提示词里不许出现「有读者」的意思
//    （开发文档 §五 N2 的开发者须知）。这条测试红了就是做错了，不是"文案不好看"。

import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { ERROR_CODES, NarrativeError } from '../lib/errors.mjs'
import {
  DIARY_RELATIVE,
  DIARY_SCHEMA,
  LEDGER_RELATIVE,
  MAX_DIARY_CHARS,
  buildDiaryPrompt,
  buildDiarySystem,
  collectDiaryInputs,
  createDiaryStore,
  diaryKey,
  extractDiaryRules,
  parseDiaryEntries,
  readDiaryLedger,
  readRecentDiaries,
  renderDiaryEntry,
  selectLessonNotes,
} from '../lib/diary.mjs'
import { decodeStructured, describeSchema } from '../lib/protocol.mjs'
import { charCount } from '../lib/text.mjs'
import { writeFileAtomic } from '../lib/atomic.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLASSROOM = join(HERE, '..', '..', '..', 'classrooms', 'cs-os')

/** 造一个最小的「教室」目录（真源文件按需覆盖）。 */
async function makeClassroom(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'narr-diary-'))
  for (const [relative, content] of Object.entries(files)) {
    const target = join(dir, relative)
    await writeFile(await ensureDir(target), content, 'utf8')
  }
  return dir
}

/** @param {string} file */
async function ensureDir(file) {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(dirname(file), { recursive: true })
  return file
}

const DIARY_HEADER = `# 日记（她的）

> **写法规则**：第一人称、短、不解释、不抒情。**只写她注意到的具体细节**。
> 每课一条，**不超过 120 字**。

---

（尚无。第 1 讲后写第一条。）
`

test('写法规则从教室 diary.md 文件头逐字抽出（真盘上的那份）', async () => {
  const markdown = await readFile(join(CLASSROOM, DIARY_RELATIVE), 'utf8')
  const rules = extractDiaryRules(markdown)
  assert.match(rules, /第一人称、短、不解释、不抒情/)
  assert.match(rules, /不超过 120 字/)
  assert.match(rules, /这是她自己的日记，不是课堂记录/)
})

test('文件头没有规则就大声报错（不悄悄用默认值顶上）', () => {
  assert.throws(
    () => extractDiaryRules('# 日记\n\n没有引用行。\n'),
    (error) => error instanceof NarrativeError && error.code === ERROR_CODES.IO_ERROR && error.detail.reason === 'NO_DIARY_RULES',
  )
})

test('解析日记条目；坏块只计不炸', () => {
  const markdown = `${DIARY_HEADER}
### 2026-10-19 · 第 1 讲
抽屉卡了一下。

### 2026-10-20
潮水退到第三档，记录板下沿干了一道白边。

### 2026-10-21 · 第 2 讲
`
  const { entries, bad } = parseDiaryEntries(markdown)
  assert.equal(entries.length, 2)
  assert.equal(bad, 1)
  assert.deepEqual(entries[0], { date: '2026-10-19', lesson: 1, text: '抽屉卡了一下。' })
  assert.deepEqual(entries[1], { date: '2026-10-20', lesson: null, text: '潮水退到第三档，记录板下沿干了一道白边。' })
})

test('渲染：有讲次带「第 N 讲」，无讲次只有日期', () => {
  assert.equal(renderDiaryEntry({ date: '2026-10-21', lesson: 3, text: ' 好 ' }), '### 2026-10-21 · 第 3 讲\n好\n')
  assert.equal(renderDiaryEntry({ date: '2026-10-21', lesson: null, text: '好' }), '### 2026-10-21\n好\n')
})

test('写法校验：120 字通过，121 字判不合法（不截断）', () => {
  const ok = '字'.repeat(MAX_DIARY_CHARS)
  const tooLong = '字'.repeat(MAX_DIARY_CHARS + 1)
  assert.equal(decodeStructured(JSON.stringify({ text: ok }), DIARY_SCHEMA).text.length, MAX_DIARY_CHARS)
  assert.throws(
    () => decodeStructured(JSON.stringify({ text: tooLong }), DIARY_SCHEMA),
    (error) => {
      assert.equal(error.code, ERROR_CODES.INVALID_OUTPUT)
      assert.match(error.message, /120/)
      return true
    },
  )
})

test('写法校验：字数按 Unicode 码点算（代理对算 1 个字）', () => {
  assert.equal(charCount('𠮷'), 1)
  // 120 个代理对字符＝120 字（若按 UTF-16 会是 240，被判超长）
  const text = '𠮷'.repeat(MAX_DIARY_CHARS)
  assert.equal(decodeStructured(JSON.stringify({ text }), DIARY_SCHEMA).text, text)
})

test('🔴 发布约束守卫：给日记 agent 的提示词里不得出现"有读者"的意思', () => {
  const system = buildDiarySystem({ rules: '第一人称、短、不超过 120 字。' })
  const prompt = buildDiaryPrompt({ date: '2026-10-21', lesson: 3 })
  const schemaText = describeSchema(DIARY_SCHEMA)
  const authored = [system, prompt, schemaText].join('\n')
  // 任何"有人在看"的暗示都不许有
  const forbidden = [/读者/, /观众/, /面板/, /展示给/, /给别人看/, /有人会看/, /会被看到/, /公开/, /学生/, /同学/, /读者群/]
  for (const pattern of forbidden) {
    assert.doesNotMatch(authored, pattern, `提示词里出现了 ${pattern}`)
  }
})

test('🔴 提示词确实把她当成私人本子的主人（而不是内容生产者）', () => {
  const system = buildDiarySystem({ rules: '第一人称、短、不超过 120 字。' })
  assert.match(system, /你叫小鞠知花/)
  assert.match(system, /写今天的日记/)
  assert.match(system, /第一人称、短、不超过 120 字。/)
})

test('幂等键：会话 + 讲次', () => {
  assert.equal(diaryKey('sess-1', 3), 'sess-1#3')
  assert.equal(diaryKey('sess-1', 0), 'sess-1#0')
  assert.equal(diaryKey('sess-1', null), 'sess-1#0')
  assert.equal(diaryKey('', 2), '<unknown-session>#2')
  assert.notEqual(diaryKey('sess-1', 3), diaryKey('sess-2', 3))
})

test('落盘：第一条替换掉「尚无」占位行，第二条接在后面，读回顺序对', async () => {
  const dir = await makeClassroom({ [DIARY_RELATIVE]: DIARY_HEADER })
  const store = createDiaryStore({ classroomDir: dir, now: () => 1_700_000_000_000 })
  const first = await store.append({ sessionId: 's1', lesson: 1, date: '2026-10-19', text: '抽屉卡了一下。' })
  assert.equal(first.skipped, false)
  const markdown = await readFile(join(dir, DIARY_RELATIVE), 'utf8')
  assert.doesNotMatch(markdown, /尚无/)
  assert.match(markdown, /### 2026-10-19 · 第 1 讲\n抽屉卡了一下。/)
  // 文件头还在（她的本子不该被重写）
  assert.match(markdown, /# 日记（她的）/)

  await store.append({ sessionId: 's1', lesson: 2, date: '2026-10-20', text: '潮水退了。' })
  const recent = await readRecentDiaries({ classroomDir: dir, limit: 3 })
  assert.deepEqual(
    recent.entries.map((entry) => entry.text),
    ['抽屉卡了一下。', '潮水退了。'],
  )
})

test('幂等：同一 (session, lesson) 再触发一次 → skipped，正文只有一个', async () => {
  const dir = await makeClassroom({ [DIARY_RELATIVE]: DIARY_HEADER })
  const store = createDiaryStore({ classroomDir: dir, now: () => 1 })
  await store.append({ sessionId: 's1', lesson: 3, date: '2026-10-21', text: '第一遍。' })
  const second = await store.append({ sessionId: 's1', lesson: 3, date: '2026-10-21', text: '第二遍。' })
  assert.equal(second.skipped, true)
  assert.equal(second.reason, 'DUPLICATE')
  assert.deepEqual(second.writes, [])
  const { entries } = await readRecentDiaries({ classroomDir: dir, limit: 10 })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].text, '第一遍。')
  // 账本里也只有一条
  const ledger = await readDiaryLedger({ classroomDir: dir })
  assert.equal(ledger.entries.length, 1)
  assert.equal(ledger.entries[0].key, 's1#3')
})

test('幂等：另一个会话的同一讲次是另一节课 → 各写一条', async () => {
  const dir = await makeClassroom({ [DIARY_RELATIVE]: DIARY_HEADER })
  const store = createDiaryStore({ classroomDir: dir, now: () => 1 })
  await store.append({ sessionId: 's1', lesson: 3, date: '2026-10-21', text: 'A。' })
  await store.append({ sessionId: 's2', lesson: 3, date: '2026-10-21', text: 'B。' })
  const { entries } = await readRecentDiaries({ classroomDir: dir, limit: 10 })
  assert.equal(entries.length, 2)
})

test('回滚：账本写失败 → 正文被恢复原样，并抛 IO_ERROR（不留半状态）', async () => {
  const dir = await makeClassroom({ [DIARY_RELATIVE]: DIARY_HEADER })
  const original = await readFile(join(dir, DIARY_RELATIVE), 'utf8')
  const store = createDiaryStore({
    classroomDir: dir,
    now: () => 1,
    write: async (file, data) => {
      if (file.endsWith('diary-ledger.jsonl')) throw new Error('磁盘满了')
      return writeFileAtomic(file, data)
    },
  })
  await assert.rejects(
    () => store.append({ sessionId: 's1', lesson: 1, date: '2026-10-19', text: '这条不该留下。' }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.IO_ERROR)
      assert.equal(error.detail.reason, 'LEDGER_WRITE_FAILED')
      return true
    },
  )
  assert.equal(await readFile(join(dir, DIARY_RELATIVE), 'utf8'), original)
  // 账本里也没有留下键（否则下一节课会静默跳过）
  const ledger = await readDiaryLedger({ classroomDir: dir })
  assert.equal(ledger.entries.length, 0)
})

test('读取出口：最近 N 条（N2.4 的注入就靠它）', async () => {
  const dir = await makeClassroom({ [DIARY_RELATIVE]: DIARY_HEADER })
  const store = createDiaryStore({ classroomDir: dir, now: () => 1 })
  for (let lesson = 1; lesson <= 5; lesson += 1) {
    await store.append({ sessionId: 's1', lesson, date: `2026-10-1${lesson}`, text: `第 ${lesson} 条。` })
  }
  const { entries } = await readRecentDiaries({ classroomDir: dir, limit: 3 })
  assert.deepEqual(
    entries.map((entry) => entry.text),
    ['第 3 条。', '第 4 条。', '第 5 条。'],
  )
  const one = await readRecentDiaries({ classroomDir: dir, limit: 1 })
  assert.equal(one.entries[0].text, '第 5 条。')
})

test('课堂记录：只取本课的卡点/误解/掌握证据/群里提的问题，坏行计数', () => {
  const raw = [
    JSON.stringify({ v: 1, type: 'misconception', lesson: 3, kp: 'KP-3.2', quote: '页表就是个缓存吧', note: '把页表与 TLB 混了' }),
    JSON.stringify({ v: 1, type: 'evidence', lesson: 3, kp: 'KP-3.1', quote: '因为要两次访存，所以才有 TLB' }),
    JSON.stringify({ v: 1, type: 'blocker', lesson: 2, kp: 'KP-2.1', quote: '上一讲的' }),
    JSON.stringify({ v: 1, type: 'group_question', lesson: 3, kp: null, quote: '为什么分页和 TLB 是一套东西' }),
    '{ 坏行',
    JSON.stringify({ v: 2, type: 'misconception', lesson: 3, quote: '未来版本的记录，本版读方应当跳过' }),
  ].join('\n')
  const { text, stats } = selectLessonNotes(raw, { lesson: 3 })
  assert.equal(stats.bad, 1)
  assert.match(text, /\[误解\] KP-3\.2/)
  assert.match(text, /页表就是个缓存吧/)
  assert.match(text, /\[掌握证据\] KP-3\.1/)
  assert.match(text, /\[群里提的问题\]/)
  assert.doesNotMatch(text, /上一讲的/)
  assert.doesNotMatch(text, /未来版本/)
})

test('输入收集：缺文件不崩，缺项如实写"缺失"', async () => {
  const dir = await makeClassroom({ [DIARY_RELATIVE]: DIARY_HEADER })
  const collected = await collectDiaryInputs({ classroomDir: dir, lesson: 1, date: '2026-10-19' })
  assert.match(collected.rules, /第一人称/)
  const labels = collected.inputs.map((input) => input.label)
  assert.ok(labels.some((label) => label.includes('session_log.md')))
  assert.ok(labels.some((label) => label.includes('notes.jsonl')))
  assert.ok(labels.some((label) => label.includes('最近三条日记')))
  assert.ok(labels.some((label) => label.includes('komari.md')))
  assert.ok(labels.some((label) => label.includes('角色声音速查')))
  assert.ok(labels.some((label) => label.includes('setting.md')))
  assert.ok(labels.some((label) => label.includes('wechat_group.md')))
  // 最近三条日记：还没写过
  assert.equal(collected.inputs.find((input) => input.label === '你最近三条日记').content, '（还没写过。）')
  assert.equal(collected.facts.recentDiaries, 0)
})

test('输入收集：真盘教室能读出角色声音段（不是整份 _anchor.md）', async () => {
  const collected = await collectDiaryInputs({ classroomDir: CLASSROOM, lesson: 1, date: '2026-10-19' })
  const voice = collected.inputs.find((input) => input.label.includes('角色声音速查')).content
  assert.match(voice, /她可以说得慢/)
  // 不该把 _anchor 的其它段落一起塞进来
  assert.doesNotMatch(voice, /教学检查/)
})

// ── 活体验证时发现的真问题：新条目必须落在条目区，不能掉到「参考口吻」提示块下面 ──
const DIARY_HEADER_WITH_FOOTER = `# 日记（她的）

> **写法规则**：第一人称、短、不解释、不抒情。**只写她注意到的具体细节**。
> 每课一条，**不超过 120 字**。

---

（尚无。第 1 讲后写第一条。）

> 参考口吻（不是模板，别照抄）：
> 抽屉卡了一下。按了两下才关上。
`

test('插入位置：第一条日记紧跟 --- 出现，口吻提示留在页脚（不被顶到日记前面）', async () => {
  const dir = await makeClassroom({ [DIARY_RELATIVE]: DIARY_HEADER_WITH_FOOTER })
  const store = createDiaryStore({ classroomDir: dir, now: () => 1 })
  await store.append({ sessionId: 's1', lesson: 1, date: '2026-10-19', text: '记录笔漏了一滴。' })
  const markdown = await readFile(join(dir, DIARY_RELATIVE), 'utf8')
  const entryAt = markdown.indexOf('### 2026-10-19')
  const footerAt = markdown.indexOf('参考口吻')
  assert.ok(entryAt > 0, '条目应当写进去了')
  assert.ok(footerAt > entryAt, '口吻提示应当在条目之后（页脚）')
  assert.doesNotMatch(markdown, /尚无/)
  // 口吻提示本身一个字都不该丢
  assert.match(markdown, /> 抽屉卡了一下。按了两下才关上。/)
})

test('插入位置：第二条接在第一条之后、页脚之前（条目区保持时间序）', async () => {
  const dir = await makeClassroom({ [DIARY_RELATIVE]: DIARY_HEADER_WITH_FOOTER })
  const store = createDiaryStore({ classroomDir: dir, now: () => 1 })
  await store.append({ sessionId: 's1', lesson: 1, date: '2026-10-19', text: '一。' })
  await store.append({ sessionId: 's1', lesson: 2, date: '2026-10-20', text: '二。' })
  const markdown = await readFile(join(dir, DIARY_RELATIVE), 'utf8')
  const first = markdown.indexOf('### 2026-10-19')
  const second = markdown.indexOf('### 2026-10-20')
  const footer = markdown.indexOf('参考口吻')
  assert.ok(first > 0 && second > first && footer > second, `顺序不对：first=${first} second=${second} footer=${footer}`)
})

test('插入位置：文件里一条日记都没有且没有页脚时，仍然只是追加', async () => {
  const dir = await makeClassroom({ [DIARY_RELATIVE]: `${DIARY_HEADER}` })
  const store = createDiaryStore({ classroomDir: dir, now: () => 1 })
  await store.append({ sessionId: 's1', lesson: 1, date: '2026-10-19', text: '一。' })
  const markdown = await readFile(join(dir, DIARY_RELATIVE), 'utf8')
  assert.match(markdown, /---\n\n### 2026-10-19 · 第 1 讲\n一。\n$/)
})
