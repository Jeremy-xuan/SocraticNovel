// test/lesson.test.mjs — 块级「讲次门」单测（M2-SCHEMA v0.2，施工状态 §3 P0-4）
//
// 🔴 本特性的教训就是「不匹配会静默不生效」——所以四条路径全部覆盖：
//   ① 命中（注入）② 不命中（不注入）③ 缺声明（报错）④ 值非法（报错）。
// 外加兼容性：**没写 lesson 门的块一律照旧注入**（既有 fixture 不许变红）。
//
// 🔴 关于 `of`：`{current:true}` 若只判"存在 current_lesson"，对**每个** story.node.NN
//   都成立 → 14 块全注入 = 等于没加门（P0-4 症状原样复发）。所以「本块所属讲次」
//   必须显式写成 `of`，本文件第 3 节专门测这条。
//
// 运行：/opt/homebrew/bin/node test/lesson.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseManifest,
  loadManifest,
  ManifestError,
  normalizeLessonGate,
  lessonGateAllows,
  readRuntimeLesson,
  usesLessonGate,
  resolveRuntimeLessonSource,
  validateRuntimeStore,
  DEFAULT_LESSON_KEY,
} from '../lib/manifest.mjs'
import { planTurnInjections } from '../lib/injector.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(here, 'fixtures', 'minimal-classroom')

// ── 测试脚手架 ─────────────────────────────────────────────────────────────

const dirs = []
/** 建一个临时教室目录：写 classroom.yaml + runtime/progress.md，返回目录。 */
async function makeClassroom({ yaml, progress }) {
  const dir = await mkdtemp(join(tmpdir(), 'socratic-lesson-'))
  dirs.push(dir)
  await writeFile(join(dir, 'classroom.yaml'), yaml, 'utf8')
  if (progress !== null) {
    await mkdir(join(dir, 'runtime'), { recursive: true })
    await writeFile(join(dir, 'runtime', 'progress.md'), progress ?? '', 'utf8')
  }
  return dir
}
test.after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

const PROGRESS_OK = `# 学习进度

current_lesson: 3

| 项 | 值 |
|---|---|
| 当前讲次 | 第 3 讲 |
`

/** 造一份用讲次门的 manifest 文本。store=null 表示不声明 runtime_store。 */
const yamlWith = ({ lesson = 'lesson: { current: true, of: 3 }', store = true, blocks = null } = {}) => `
format: socratic-classroom/0
classroom: { id: t }
${store ? `runtime_store:\n  dir: runtime/\n  progress: runtime/progress.md\n  lesson_key: current_lesson` : ''}
phases:
  - { id: open, name: 开场 }
  - { id: close, name: 收尾 }
blocks:
${blocks ??
  `  - id: gated
    text: gated-body
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
    ${lesson}
`}`

const chatState = (currentLesson, turn = 1, phase = 'open') => ({
  turnCount: turn,
  phase,
  injectedOnce: new Set(),
  currentLesson,
})

// ── ① 命中 / ② 不命中 ─────────────────────────────────────────────────────

test('讲次门 current+of：progress 说第 3 讲、块 of:3 → 命中注入', async () => {
  const dir = await makeClassroom({ yaml: yamlWith(), progress: PROGRESS_OK })
  const m = loadManifest(dir)
  assert.equal(readRuntimeLesson(m, { baseDir: dir }), 3)
  const due = planTurnInjections(m.blocks, chatState(3))
  assert.deepEqual(due.map((d) => d.id), ['gated'])
})

test('🔴 讲次门 current+of：块 of:3 在第 1 讲**不**注入（P0-4 的核心断言）', () => {
  const m = parseManifest(yamlWith()) // of: 3
  assert.ok(!planTurnInjections(m.blocks, chatState(1)).some((d) => d.id === 'gated'))
  assert.ok(!planTurnInjections(m.blocks, chatState(2)).some((d) => d.id === 'gated'))
  assert.ok(planTurnInjections(m.blocks, chatState(3)).some((d) => d.id === 'gated'))
  assert.ok(!planTurnInjections(m.blocks, chatState(4)).some((d) => d.id === 'gated'))
})

test('讲次门 list：[1,2] 只在第 1、2 讲注入，第 3 讲不注入', () => {
  const m = parseManifest(yamlWith({ lesson: 'lesson: { list: [1, 2] }' }))
  assert.ok(planTurnInjections(m.blocks, chatState(1)).some((d) => d.id === 'gated'))
  assert.ok(planTurnInjections(m.blocks, chatState(2)).some((d) => d.id === 'gated'))
  assert.ok(!planTurnInjections(m.blocks, chatState(3)).some((d) => d.id === 'gated'))
})

test('讲次门 range：[1,3] 是闭区间（1 与 3 都命中，4 不命中）', () => {
  const m = parseManifest(yamlWith({ lesson: 'lesson: { range: [1, 3] }' }))
  assert.ok(planTurnInjections(m.blocks, chatState(1)).some((d) => d.id === 'gated'))
  assert.ok(planTurnInjections(m.blocks, chatState(3)).some((d) => d.id === 'gated'))
  assert.ok(!planTurnInjections(m.blocks, chatState(4)).some((d) => d.id === 'gated'))
})

test('讲次门不命中 = 不注入，且**不**污染 injectedOnce（frequency=once 的块）', () => {
  const m = parseManifest(yamlWith({ blocks: `  - id: gated
    text: x
    position: { target: chat, depth: 0 }
    frequency: { every: once }
    lesson: { current: true, of: 5 }
` }))
  const state = chatState(3)
  assert.equal(planTurnInjections(m.blocks, state).length, 0)
  assert.equal(state.injectedOnce.has('gated'), false, '不命中时不该记 once')
  // 第 5 讲来了就该注入（证明上面那次不命中没把额度吃掉）
  assert.deepEqual(planTurnInjections(m.blocks, chatState(5)).map((d) => d.id), ['gated'])
})

// ── `of` 的语义（无 of ＝ 只要有讲次在讲就放行）────────────────────────────

test('🔴 `of` 是「本块所属讲次」：同一份 yaml 换 of 就换讲次（14 块互不串台）', () => {
  // 模拟 cs-os 的 14 个 story.node.NN：每个 of 各不同，同一回合只应放行 1 个
  const blocksYaml = Array.from(
    { length: 14 },
    (_, i) => `  - id: story.node.${String(i + 1).padStart(2, '0')}
    text: ch${i + 1}
    position: { target: chat, depth: 2 }
    frequency: { every: phase }
    phase: { phases: [open] }
    lesson: { current: true, of: ${i + 1} }
`,
  ).join('')
  const m = parseManifest(yamlWith({ blocks: blocksYaml }))
  for (const lesson of [1, 3, 7, 14]) {
    const due = planTurnInjections(m.blocks, chatState(lesson))
    assert.deepEqual(
      due.map((d) => d.id),
      [`story.node.${String(lesson).padStart(2, '0')}`],
      `第 ${lesson} 讲只该注入 story.node.${String(lesson).padStart(2, '0')}`,
    )
  }
  // 第 1 讲绝不注入第 2–14 讲（剧透防线）
  const l1 = planTurnInjections(m.blocks, chatState(1)).map((d) => d.id)
  assert.equal(l1.length, 1)
  assert.ok(!l1.includes('story.node.14'))
})

test('`{current:true}` **不带 of** ＝ 只要有讲次在讲就放行（跨讲常驻块，如 curriculum.map）', () => {
  const m = parseManifest(yamlWith({ lesson: 'lesson: { current: true }' }))
  for (const lesson of [1, 2, 9, 14]) {
    assert.ok(
      planTurnInjections(m.blocks, chatState(lesson)).some((d) => d.id === 'gated'),
      `第 ${lesson} 讲应放行（无 of）`,
    )
  }
})

test('🔴 of 缺值/非法 → 报错；of 与 list/range 混用 → 报错；未知键 → 报错', () => {
  assert.throws(() => parseManifest(yamlWith({ lesson: 'lesson: { current: true, of: 0 }' })), /of 必须是 >=1 的整数/)
  assert.throws(() => parseManifest(yamlWith({ lesson: 'lesson: { current: true, of: "3" }' })), /of 必须是 >=1 的整数/)
  assert.throws(() => parseManifest(yamlWith({ lesson: 'lesson: { current: true, of: 1.5 }' })), /of 必须是 >=1 的整数/)
  assert.throws(
    () => parseManifest(yamlWith({ lesson: 'lesson: { list: [1], of: 1 }' })),
    /of 只与 current 连用/,
  )
  assert.throws(
    () => parseManifest(yamlWith({ lesson: 'lesson: { range: [1, 2], of: 1 }' })),
    /of 只与 current 连用/,
  )
  assert.throws(() => parseManifest(yamlWith({ lesson: 'lesson: { current: true, fro: 1 }' })), /无法识别的键/)
})

// ── ③ 缺声明 / 值非法 → 一律报错（不静默）──────────────────────────────────

test('🔴 块用了 lesson 门但顶层未声明 runtime_store → 报错（带块 id 与声明模板）', () => {
  assert.throws(() => parseManifest(yamlWith({ store: false })), (e) => {
    assert.ok(e instanceof ManifestError)
    assert.match(e.message, /lesson 讲次门/)
    assert.match(e.message, /未声明 runtime_store/)
    assert.match(e.message, /lesson_key: current_lesson/)
    return true
  })
})

test('🔴 声明了 runtime_store 但 progress 文件里没有 current_lesson 行 → 报错（带路径与键名）', async () => {
  const dir = await makeClassroom({
    yaml: yamlWith(),
    progress: '# 学习进度\n\n| 当前讲次 | 第 3 讲 |\n',
  })
  const m = loadManifest(dir) // 解析期只校验声明，不读盘
  assert.throws(() => readRuntimeLesson(m, { baseDir: dir }), (e) => {
    assert.ok(e instanceof ManifestError)
    assert.match(e.message, /找不到机器可读行/)
    assert.match(e.message, /current_lesson/)
    assert.ok(e.message.includes(join(dir, 'runtime', 'progress.md')), '报错必须带文件路径')
    return true
  })
})

test('🔴 progress 里的 current_lesson 不是整数 → 报错（带读到的东西）', async () => {
  const dir = await makeClassroom({ yaml: yamlWith(), progress: 'current_lesson: 三\n' })
  const m = loadManifest(dir)
  assert.throws(() => readRuntimeLesson(m, { baseDir: dir }), (e) => {
    assert.match(e.message, /不是整数/)
    assert.match(e.message, /"三"/)
    return true
  })
})

test('🔴 progress 文件本身不存在 → 报错（带路径与期望键名）', async () => {
  const dir = await makeClassroom({ yaml: yamlWith(), progress: null })
  const m = loadManifest(dir)
  assert.throws(() => readRuntimeLesson(m, { baseDir: dir }), /读 runtime_store 的 progress 文件失败/)
})

test('🔴 current_lesson: 0 或负数 → 报错（第 0 讲＝未开始，不是合法讲次）', async () => {
  const dir = await makeClassroom({ yaml: yamlWith(), progress: 'current_lesson: 0\n' })
  const m = loadManifest(dir)
  assert.throws(() => readRuntimeLesson(m, { baseDir: dir }), /必须 >=1/)
})

test('🔴 lesson.list 空数组 → 报错', () => {
  assert.throws(() => parseManifest(yamlWith({ lesson: 'lesson: { list: [] }' })), /list 必须是非空数组/)
})

test('🔴 lesson.list 里出现非整数 → 报错（带下标）', () => {
  assert.throws(() => parseManifest(yamlWith({ lesson: 'lesson: { list: [1, "2"] }' })), /list\[1\] 必须是 >=1 的整数/)
  assert.throws(() => parseManifest(yamlWith({ lesson: 'lesson: { list: [1, 1.5] }' })), /list\[1\] 必须是 >=1 的整数/)
})

test('🔴 lesson.range 形态非法（不是两个元素 / 起>止 / 非整数）→ 报错', () => {
  assert.throws(() => parseManifest(yamlWith({ lesson: 'lesson: { range: [1] }' })), /range 必须是 \[起, 止\]/)
  assert.throws(() => parseManifest(yamlWith({ lesson: 'lesson: { range: [3, 1] }' })), /起点不得大于终点/)
  assert.throws(() => parseManifest(yamlWith({ lesson: 'lesson: { range: [1, x] }' })), /range\[1\] 必须是 >=1 的整数/)
})

test('🔴 lesson 三键同写 / 一个都不写 / current 不是 true → 报错', () => {
  assert.throws(
    () => parseManifest(yamlWith({ lesson: 'lesson: { current: true, list: [1] }' })),
    /必须且只能写一个键/,
  )
  assert.throws(() => parseManifest(yamlWith({ lesson: 'lesson: {}' })), /必须且只能写一个键/)
  assert.throws(() => parseManifest(yamlWith({ lesson: 'lesson: { current: false }' })), /current 只能写 true/)
})

test('🔴 引擎侧：块带讲次门但 state.currentLesson 缺值 → planTurnInjections 抛错', () => {
  const m = parseManifest(yamlWith())
  const bad = { turnCount: 1, phase: 'open', injectedOnce: new Set() } // 没有 currentLesson
  assert.throws(() => planTurnInjections(m.blocks, bad), /state\.currentLesson 不是整数/)
  assert.throws(() => planTurnInjections(m.blocks, chatState('3')), /state\.currentLesson 不是整数/)
})

// ── 解析器单元：normalizeLessonGate / lessonGateAllows / 值来源 ─────────────

test('normalizeLessonGate 四种形态规范化结果正确', () => {
  assert.deepEqual(normalizeLessonGate({ current: true }, 'blocks[0]', 'b'), { current: true })
  assert.deepEqual(normalizeLessonGate({ current: true, of: 3 }, 'blocks[0]', 'b'), { current: true, of: 3 })
  assert.deepEqual(normalizeLessonGate({ list: [1, 2] }, 'blocks[0]', 'b'), { list: [1, 2] })
  assert.deepEqual(normalizeLessonGate({ range: [1, 3] }, 'blocks[0]', 'b'), { range: [1, 3] })
  assert.throws(() => normalizeLessonGate(true, 'blocks[0]', 'b'), /lesson 必须是映射/)
})

test('lessonGateAllows 纯判定（null 门＝放行；非法讲次＝不放行）', () => {
  assert.equal(lessonGateAllows(null, 3), true)
  assert.equal(lessonGateAllows({ current: true }, 7), true) // 无 of：只要有讲次在讲
  assert.equal(lessonGateAllows({ current: true, of: 3 }, 3), true)
  assert.equal(lessonGateAllows({ current: true, of: 3 }, 4), false)
  assert.equal(lessonGateAllows({ current: true }, undefined), false)
  assert.equal(lessonGateAllows({ current: true, of: 3 }, undefined), false)
  assert.equal(lessonGateAllows({ list: [2] }, 2), true)
  assert.equal(lessonGateAllows({ list: [2] }, 3), false)
  assert.equal(lessonGateAllows({ range: [2, 4] }, 4), true)
  assert.equal(lessonGateAllows({ range: [2, 4] }, 5), false)
})

test('progress.md 行解析容错：注释、YAML 列表前缀、前后空白、行尾注释', async () => {
  const cases = [
    ['current_lesson: 7\n', 7],
    ['  current_lesson:   7  \n', 7],
    ['- current_lesson: 7\n', 7],
    ['current_lesson: 7   # 本轮要讲的讲次\n', 7],
    ['# 注释\n\ncurrent_lesson: 7\n', 7],
    ['其它字段: 1\ncurrent_lesson: 7\n', 7],
  ]
  for (const [progress, expected] of cases) {
    const dir = await makeClassroom({ yaml: yamlWith(), progress })
    const m = loadManifest(dir)
    assert.equal(readRuntimeLesson(m, { baseDir: dir }), expected, `progress=${JSON.stringify(progress)}`)
  }
})

test('lesson_key 可自定义（缺省 current_lesson；自定义键名照读）', async () => {
  const yaml = yamlWith().replace('lesson_key: current_lesson', 'lesson_key: next_lesson')
  const dir = await makeClassroom({ yaml, progress: 'next_lesson: 9\n' })
  const m = loadManifest(dir)
  assert.equal(readRuntimeLesson(m, { baseDir: dir }), 9)
  // 缺省键名常量正确
  assert.equal(DEFAULT_LESSON_KEY, 'current_lesson')
  // 键名写错 → 报错（不静默）
  const dir2 = await makeClassroom({ yaml: yamlWith(), progress: 'next_lesson: 9\n' })
  const m2 = loadManifest(dir2)
  assert.throws(() => readRuntimeLesson(m2, { baseDir: dir2 }), /找不到机器可读行/)
})

test('runtime_store 缺 dir / progress / lesson_key 非法 → 报错', () => {
  const src = (over) =>
    parseManifest(`format: socratic-classroom/0
classroom: { id: t }
runtime_store:
${over}
blocks:
  - id: g
    text: x
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
    lesson: { current: true }
`)
  assert.throws(() => src('  progress: p.md'), /runtime_store\.dir 必填/)
  assert.throws(() => src('  dir: runtime/'), /runtime_store\.progress 必填/)
  assert.throws(() => src('  dir: runtime/\n  progress: p.md\n  lesson_key: 3'), /lesson_key 必须是非空字符串/)
})

test('resolveRuntimeLessonSource：相对路径按 baseDir 解析，绝对路径原样', () => {
  const m = parseManifest(yamlWith())
  assert.deepEqual(validateRuntimeStore(m), { progress: 'runtime/progress.md', lessonKey: 'current_lesson' })
  assert.deepEqual(resolveRuntimeLessonSource(m, { baseDir: '/tmp/room' }), {
    file: '/tmp/room/runtime/progress.md',
    lessonKey: 'current_lesson',
  })
  assert.throws(() => resolveRuntimeLessonSource(m), /必须提供 baseDir/)
  const abs = parseManifest(
    `format: socratic-classroom/0
classroom: { id: t }
runtime_store: { dir: runtime/, progress: /abs/p.md }
blocks:
  - id: g
    text: x
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
    lesson: { current: true }
`,
  )
  assert.equal(resolveRuntimeLessonSource(abs, { baseDir: '/tmp/room' }).file, '/abs/p.md')
})

test('usesLessonGate / 无讲次门的 manifest 不读 progress（兼容性关键）', () => {
  const plain = parseManifest(`format: socratic-classroom/0
classroom: { id: t }
blocks:
  - id: a
    text: x
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
`)
  assert.equal(usesLessonGate(plain), false)
  assert.equal(plain.blocks[0].lesson, null)
  // 没有 runtime_store 也不报错 —— 因为根本没用到讲次门
  assert.equal(plain.runtime_store, undefined)
})

// ── 兼容性：既有 fixture 行为完全不变 ──────────────────────────────────────

test('兼容性：既有 fixture 无 lesson 门 → 解析结果与解析器改动前一致（含 lesson:null 字段）', () => {
  const m = loadManifest(FIXTURE)
  assert.equal(m.blocks.length, 5)
  assert.deepEqual(
    m.blocks.map((b) => b.id),
    ['narrative-core', 'anchor', 'knowledge-anchor', 'state-brief', 'quiz-rules'],
  )
  for (const b of m.blocks) assert.equal(b.lesson, null, `${b.id} 的 lesson 应为 null`)
  // 无讲次门 → 不要求 currentLesson，照旧按频率/相位裁决
  const due = planTurnInjections(m.blocks, { turnCount: 1, phase: 'boot', injectedOnce: new Set() })
  assert.deepEqual(due.map((d) => d.id), ['anchor', 'state-brief'])
})
