// test/section.test.mjs — 块级「段级切片」单测（M2-SCHEMA v0.2，施工状态 §3 P1-1）
//
// 覆盖：正常切片 / 标题不存在报错并列出实际标题清单 / `##` 前缀写法容错 /
//       切到**同级或更高级**标题为止（三级标题不断段）/ 空段报错 / 兼容性（无 section = 整文件）。
//
// 运行：/opt/homebrew/bin/node test/section.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseManifest, loadManifest, ManifestError, sliceSection } from '../lib/manifest.mjs'
import { planTurnInjections } from '../lib/injector.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(here, 'fixtures', 'section-anchor')
const MINIMAL = join(here, 'fixtures', 'minimal-classroom')
const ANCHOR_TEXT = readFileSync(join(FIXTURE, '_anchor.md'), 'utf8')

// ── sliceSection 纯函数 ────────────────────────────────────────────────────

test('切片：取标题正文，到下一个同级标题之前为止', () => {
  const body = sliceSection(ANCHOR_TEXT, '教学取向')
  assert.match(body, /^取向段正文第一行。/)
  assert.match(body, /取向段正文第二行。/)
  assert.ok(!body.includes('本课不许违反项段正文'), '不许跨过下一个 ## 标题')
  assert.ok(!body.includes('文件头说明段'), '不许带上标题之前的正文')
})

test('切片：**三级标题不断段**（`###` 属于当前 `##` 段，必须保留）', () => {
  const body = sliceSection(ANCHOR_TEXT, '教学取向')
  assert.match(body, /### 取向段里的三级小标题/)
  assert.match(body, /三级小标题的正文/)
})

test('切片：`## 教学取向` 这种带前缀的写法容错（比对时去掉 `#`）', () => {
  assert.equal(sliceSection(ANCHOR_TEXT, '## 教学取向'), sliceSection(ANCHOR_TEXT, '教学取向'))
  assert.equal(sliceSection(ANCHOR_TEXT, '##   教学取向  '), sliceSection(ANCHOR_TEXT, '教学取向'))
  assert.equal(sliceSection(ANCHOR_TEXT, '#教学取向'), sliceSection(ANCHOR_TEXT, '教学取向'))
})

test('切片：最后一段切到文件末尾', () => {
  const body = sliceSection(ANCHOR_TEXT, '教学检查（需要校准时使用）')
  assert.equal(body, '检查段正文。')
})

test('切片：标题文本按原文精确匹配（不做模糊/前缀匹配）；首尾空白被容忍', () => {
  // 前缀写法必须报错（否则「教学」会误命中「教学取向」）
  assert.throws(() => sliceSection(ANCHOR_TEXT, '教学'), /不存在/)
  assert.throws(() => sliceSection(ANCHOR_TEXT, '教学取向（每讲更新）'), /不存在/)
  // 首尾空白无所谓（trim 后仍精确匹配）
  assert.equal(sliceSection(ANCHOR_TEXT, '  教学取向  '), sliceSection(ANCHOR_TEXT, '教学取向'))
})

test('🔴 标题不存在 → 报错，并列出该文件实际存在的标题清单', () => {
  assert.throws(() => sliceSection(ANCHOR_TEXT, '不存在的段', { file: '_anchor.md' }), (e) => {
    assert.ok(e instanceof ManifestError)
    assert.match(e.message, /section "不存在的段" 在 _anchor\.md 里不存在/)
    // 清单必须把全部实际标题打出来（帮贡献者改对）
    for (const t of ['教学取向', '本课不许违反项（每讲更新）', '角色声音速查（生成任何台词前看一眼）', '教学检查（需要校准时使用）']) {
      assert.ok(e.message.includes(t), `清单里应有「${t}」`)
    }
    assert.match(e.message, /## 教学取向/, '清单带层级前缀，便于照抄')
    return true
  })
})

test('🔴 文件里一个标题都没有 → 报错并如实说明', () => {
  assert.throws(() => sliceSection('只有正文没有标题\n', '任意'), /没有任何 markdown 标题/)
})

test('🔴 标题重复出现 → 报错（不许静默取第一个）', () => {
  const dup = '## 同名\n\nA\n\n## 同名\n\nB\n'
  assert.throws(() => sliceSection(dup, '同名'), /出现 2 次/)
})

test('🔴 空段（标题下没有正文）→ 报错（空段＝该块静默失效）', () => {
  assert.throws(() => sliceSection('## 空段\n\n## 下一段\n\n正文\n', '空段'), /是空段/)
})

test('🔴 section 为空字符串 → 报错', () => {
  assert.throws(() => sliceSection(ANCHOR_TEXT, ''), /section 不能为空字符串/)
  assert.throws(() => sliceSection(ANCHOR_TEXT, '   '), /section 不能为空字符串/)
})

test('切片：一级标题 `#` 也能切（取到文件末）', () => {
  assert.match(sliceSection(ANCHOR_TEXT, '纪律层（fixture：段级切片专用）'), /文件头说明段/)
})

// ── manifest 集成 ─────────────────────────────────────────────────────────

test('manifest：section 把 _anchor.md 切成 4 块，各段互不重叠且都在全文内', () => {
  const m = loadManifest(FIXTURE)
  const byId = Object.fromEntries(m.blocks.map((b) => [b.id, b]))
  assert.deepEqual(
    m.blocks.map((b) => b.id),
    ['anchor.rules', 'anchor.lesson_ban', 'anchor.voice', 'anchor.check', 'anchor.whole'],
  )
  const rules = byId['anchor.rules'].text
  const ban = byId['anchor.lesson_ban'].text
  const voice = byId['anchor.voice'].text
  const check = byId['anchor.check'].text
  assert.match(rules, /取向段正文第一行/)
  assert.equal(ban, '不许违反项段正文。')
  assert.equal(voice, '声音段正文。')
  assert.equal(check, '检查段正文。')
  // 四段合起来远小于全文（这就是切片的意义）
  const sliced = rules.length + ban.length + voice.length + check.length
  assert.ok(sliced < ANCHOR_TEXT.length, `四段合计 ${sliced} 应小于全文 ${ANCHOR_TEXT.length}`)
  // 都不带文件头说明段
  for (const t of [rules, ban, voice, check]) assert.ok(!t.includes('文件头说明段'))
})

test('manifest：无 section 的块仍整文件读入（兼容性对照）', () => {
  const m = loadManifest(FIXTURE)
  const whole = m.blocks.find((b) => b.id === 'anchor.whole')
  assert.equal(whole.text, ANCHOR_TEXT)
  assert.match(whole.text, /文件头说明段/)
})

test('manifest：section 只对 path 有效（内联 text + section → 报错）', () => {
  assert.throws(
    () =>
      parseManifest(`format: socratic-classroom/0
classroom: { id: t }
blocks:
  - id: a
    text: hi
    section: 教学取向
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
`),
    /section 只对 path 有效/,
  )
})

test('manifest：section 不是字符串 → 报错；path+text 同写 → 报错', () => {
  assert.throws(
    () =>
      parseManifest(`format: socratic-classroom/0
classroom: { id: t }
blocks:
  - id: a
    path: _anchor.md
    section: [教学取向]
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
`, { baseDir: FIXTURE }),
    /section 必须是字符串/,
  )
  assert.throws(
    () =>
      parseManifest(`format: socratic-classroom/0
classroom: { id: t }
blocks:
  - id: a
    path: _anchor.md
    text: hi
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
`, { baseDir: FIXTURE }),
    /path 与 text 二选一/,
  )
})

test('manifest：section 不存在 → 报错信息里带上 path 与标题清单', () => {
  assert.throws(
    () =>
      parseManifest(`format: socratic-classroom/0
classroom: { id: t }
blocks:
  - id: a
    path: _anchor.md
    section: 打错了的标题
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
`, { baseDir: FIXTURE }),
    (e) => {
      assert.match(e.message, /_anchor\.md/)
      assert.match(e.message, /打错了的标题/)
      assert.match(e.message, /教学取向/)
      return true
    },
  )
})

// ── 兼容性：既有 fixture 行为不变 ──────────────────────────────────────────

test('兼容性：既有 fixture（无任何 section）解析结果不变', () => {
  const m = loadManifest(MINIMAL)
  assert.equal(m.blocks.length, 5)
  const anchor = m.blocks.find((b) => b.id === 'anchor')
  assert.equal(anchor.text, readFileSync(join(MINIMAL, '_anchor.md'), 'utf8'))
  const due = planTurnInjections(m.blocks, { turnCount: 1, phase: 'boot', injectedOnce: new Set() })
  assert.deepEqual(due.map((d) => d.id), ['anchor', 'state-brief'])
})
