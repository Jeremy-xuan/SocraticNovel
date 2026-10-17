// test/manifest.test.mjs — manifest 解析器单测（node --test，零 LLM 成本）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseManifest, loadManifest, ManifestError, MANIFEST_FORMAT } from '../lib/manifest.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(here, 'fixtures', 'minimal-classroom')

test('loadManifest 能读 fixture 并规范化 5 块', () => {
  const m = loadManifest(FIXTURE)
  assert.equal(m.format, MANIFEST_FORMAT)
  assert.equal(m.classroom.id, 'probe-cs-os')
  assert.equal(m.blocks.length, 5)
  const ids = m.blocks.map((b) => b.id)
  assert.deepEqual(ids, ['narrative-core', 'anchor', 'knowledge-anchor', 'state-brief', 'quiz-rules'])
})

test('system 块带 order、chat 块带 depth；depth 只对 chat 有效', () => {
  const m = loadManifest(FIXTURE)
  const sys = m.blocks.find((b) => b.id === 'narrative-core')
  assert.equal(sys.position.target, 'system')
  assert.equal(sys.position.order, 2100)
  assert.equal(sys.position.depth, undefined)

  const chat = m.blocks.find((b) => b.id === 'anchor')
  assert.equal(chat.position.target, 'chat')
  assert.equal(chat.position.depth, 0)
})

test('path 块读出文件内容，text 块直接用内联文本', () => {
  const m = loadManifest(FIXTURE)
  assert.match(m.blocks.find((b) => b.id === 'narrative-core').text, /编辑部隐喻/)
  assert.match(m.blocks.find((b) => b.id === 'state-brief').text, /\{\{phase\}\}/)
})

test('frequency: n_turns 带 n，turn 不带', () => {
  const m = loadManifest(FIXTURE)
  assert.deepEqual(m.blocks.find((b) => b.id === 'knowledge-anchor').frequency, { every: 'n_turns', n: 3 })
  assert.deepEqual(m.blocks.find((b) => b.id === 'anchor').frequency, { every: 'turn' })
})

test('wrap 默认 system-reminder 且 role 固定 user（宿主拒 developer）', () => {
  const m = loadManifest(FIXTURE)
  const b = m.blocks.find((b) => b.id === 'anchor')
  assert.equal(b.wrap.style, 'system-reminder')
  assert.equal(b.wrap.role, 'user')
})

test('phase 门被解析', () => {
  const m = loadManifest(FIXTURE)
  assert.deepEqual(m.blocks.find((b) => b.id === 'quiz-rules').phase, { phases: ['quiz'] })
})

// ---- 错误路径 ----

const base = (over = {}) => `format: socratic-classroom/0
classroom: { id: x }
blocks:
${over.blocks ?? '  - id: a\n    text: hi\n    position: { target: chat, depth: 0 }\n    frequency: { every: turn }\n'}
`

test('format 不符 → 报错', () => {
  assert.throws(() => parseManifest('format: wrong\nclassroom: {id: x}\nblocks: [{id: a, text: t, position: {target: chat}, frequency: {every: turn}}]'), ManifestError)
})

test('blocks 为空 → 报错', () => {
  assert.throws(() => parseManifest('format: socratic-classroom/0\nclassroom: {id: x}\nblocks: []'), /blocks 必须是非空数组/)
})

test('缺 classroom.id → 报错', () => {
  assert.throws(() => parseManifest('format: socratic-classroom/0\nclassroom: {}\nblocks: [{id: a, text: t, position: {target: chat}, frequency: {every: turn}}]'), /classroom\.id 必填/)
})

test('id 重复 → 报错', () => {
  const text = `format: socratic-classroom/0
classroom: { id: x }
blocks:
  - id: a
    text: t
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
  - id: a
    text: t2
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
`
  assert.throws(() => parseManifest(text), /id 重复/)
})

test('system 块带 depth → 报错（depth 只对 chat 有效）', () => {
  const text = `format: socratic-classroom/0
classroom: { id: x }
blocks:
  - id: a
    text: t
    position: { target: system, order: 100, depth: 1 }
    frequency: { every: once }
`
  assert.throws(() => parseManifest(text), /depth 只对 target=chat 有效/)
})

test('system 块缺 order → 报错', () => {
  const text = `format: socratic-classroom/0
classroom: { id: x }
blocks:
  - id: a
    text: t
    position: { target: system }
    frequency: { every: once }
`
  assert.throws(() => parseManifest(text), /需要 position\.order/)
})

test('n_turns 缺 n → 报错', () => {
  const text = `format: socratic-classroom/0
classroom: { id: x }
blocks:
  - id: a
    text: t
    position: { target: chat, depth: 0 }
    frequency: { every: n_turns }
`
  assert.throws(() => parseManifest(text), /n_turns 需要 n>=1/)
})

// 🔴 启动层频率（2026-09-24 立规）：系统段只在装载时注册一次，块上的 frequency 不参与裁决
//    → 非 once 的写法必须报错（不静默忽略）。官方六层把 ① 常驻层写成"系统段 · 每轮"，
//    照它写 every: turn 就会踩这一条，故判据写死在这里。
test('system 块的 frequency 非 once → 报错（系统段注册是一次性的）', () => {
  const text = `format: socratic-classroom/0
classroom: { id: x }
blocks:
  - id: a
    text: t
    position: { target: system, order: 100 }
    frequency: { every: turn }
`
  assert.throws(() => parseManifest(text), /target=system 的块只能用 frequency: \{ every: once \}/)
})

test('system 块的 frequency.anchor: lesson_start → 报错（每讲重注对系统段不成立）', () => {
  const text = `format: socratic-classroom/0
classroom: { id: x }
blocks:
  - id: a
    text: t
    position: { target: system, order: 100 }
    frequency: { every: once, anchor: lesson_start }
`
  assert.throws(() => parseManifest(text), /target=system 的块不支持 frequency\.anchor: lesson_start/)
})

test('system 块的 every: once / anchor: session_start 仍然合法（现有教室逐字不变）', () => {
  const text = `format: socratic-classroom/0
classroom: { id: x }
blocks:
  - id: a
    text: t
    position: { target: system, order: 100 }
    frequency: { every: once }
  - id: b
    text: t2
    position: { target: system, order: 200 }
    frequency: { every: once, anchor: session_start }
`
  const m = parseManifest(text)
  assert.deepEqual(m.blocks.map((b) => b.frequency), [{ every: 'once' }, { every: 'once', anchor: 'session_start' }])
})

test('未知 layer → 报错', () => {
  const text = `format: socratic-classroom/0
classroom: { id: x }
blocks:
  - id: a
    text: t
    layer: nonsense
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
`
  assert.throws(() => parseManifest(text), /layer 必须是/)
})

test('既无 path 也无 text → 报错', () => {
  const text = `format: socratic-classroom/0
classroom: { id: x }
blocks:
  - id: a
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
`
  assert.throws(() => parseManifest(text), /需要 path 或 text/)
})

test('path 不存在 → 报错（含文件路径）', () => {
  const text = `format: socratic-classroom/0
classroom: { id: x }
blocks:
  - id: a
    path: nope.md
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
`
  assert.throws(() => parseManifest(text, { baseDir: FIXTURE }), /读 nope\.md 失败/)
})

test('YAML 语法错误 → 包装为 ManifestError', () => {
  assert.throws(() => parseManifest('format: [unclosed'), ManifestError)
})
