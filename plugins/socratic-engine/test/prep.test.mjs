// test/prep.test.mjs — ANIM-PREP（模板化 ＋ 备课预热）的单测。
// node --test，**零 LLM 成本、零真渲染**（spawn 是假的、IO 是 tmp 目录）。
//
// 覆盖四层：
//   ① lib/animtemplates.mjs —— 三个模板的参数校验与脚本生成（含"生成方自己守 LaTeX/Scene 约束"）
//   ② lib/prep.mjs          —— 备课声明的形状与校验、缓存键的三个维度、参数规范化的稳定性
//   ③ lib/manifest.mjs      —— 顶层 `prep:` 段的接入（缺席不挂键 / 与 animation 的交叉校验）
//   ④ lib/prepstore.mjs     —— 预热（真落盘、假 spawn）／缓存命中／失败重试上界 give-up
//
// 运行：/opt/homebrew/bin/node --test test/prep.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  TEMPLATE_IDS,
  TEMPLATES,
  checkTemplateArgs,
  describeTemplates,
  getTemplate,
} from '../lib/animtemplates.mjs'
import {
  MAX_PREP_ATTEMPTS,
  canonicalParams,
  describePrepPlan,
  normalizePrep,
  prepCacheKey,
  prepItemsForLesson,
} from '../lib/prep.mjs'
import { parseManifest } from '../lib/manifest.mjs'
import { cacheKeyForItem, prepPlan, warmUpPrep } from '../lib/prepstore.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(here, 'fixtures', 'prep-classroom')

/** 真 fs 的原子写替身（tmp + rename；够真，但不依赖宿主）。 */
const realIo = {
  async writeFileAtomic(file, content, opts = {}) {
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, content, { mode: opts.mode ?? 0o600 })
    const { renameSync } = await import('node:fs')
    renameSync(tmp, file)
  },
  async withFileLock(_file, fn) {
    return fn()
  },
}

/** 假 spawn：记下命令、返回 pid，不真起进程。 */
function fakeSpawn(log) {
  return (cmd, args, opts) => {
    log.push({ cmd, args, opts })
    return { pid: 4242, unref() {} }
  }
}

function tmpDir(prefix = 'prep-test-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

// ── ① 模板层：三个模板都能生成合法脚本 ──────────────────────────────────────

const CASES = {
  timeline: {
    title: '长任务怎么堵住短任务？',
    params: {
      lanes: [
        {
          label: '先到先服务（FIFO）：A → B → C',
          segments: [
            { start: 0, end: 100, label: 'A', endLabel: '100' },
            { start: 100, end: 120, label: 'B', endLabel: '120' },
          ],
        },
      ],
    },
  },
  state_machine: {
    title: '三态怎么走',
    params: {
      states: [
        { id: 'ready', label: '就绪' },
        { id: 'running', label: '运行' },
        { id: 'blocked', label: '阻塞' },
      ],
      transitions: [
        { from: 'ready', to: 'running', label: '被调度' },
        { from: 'running', to: 'blocked', label: '等 I/O' },
        { from: 'blocked', to: 'ready', label: 'I/O 完成' },
      ],
      walk: ['ready', 'running', 'blocked'],
    },
  },
  bar_compare: {
    title: '三种调度的平均周转时间',
    params: {
      items: [
        { label: 'FIFO', value: 96.7 },
        { label: 'SJF', value: 50 },
      ],
      highlight: 'SJF',
    },
  },
}

test('模板：三个模板都能从参数生成合法脚本（Scene 子类齐、无 LaTeX、行数在上限内）', () => {
  for (const id of TEMPLATE_IDS) {
    const c = CASES[id]
    const r = checkTemplateArgs({ template: id, params: c.params, title: c.title })
    assert.equal(r.ok, true, `${id} 应通过：${r.problems.join('；')}`)
    assert.equal(r.sceneClass, TEMPLATES[id].sceneClass)
    assert.ok(r.script.includes(`class ${r.sceneClass}(Scene):`), `${id} 生成的脚本里应有 Scene 子类`)
    assert.ok(!/\b(MathTex|Tex|NumberLine)\s*\(/.test(r.script), `${id} 生成的脚本不许出现 LaTeX 入口`)
    assert.ok(r.lines <= 300, `${id} 生成脚本 ${r.lines} 行，超过 300 行上限`)
    assert.ok(r.script.includes('font=FONT'), `${id} 的中文必须走 FONT 常量（PingFang SC）`)
    assert.ok(r.script.includes('"PingFang SC"'), `${id} 的 FONT 必须是 PingFang SC`)
  }
})

test('模板：标题/模板名/参数缺失都报错，且一次报全、不落任何东西', () => {
  const r = checkTemplateArgs({ template: 'nope', params: {}, title: '' })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => p.includes('template 必须是')))
  assert.ok(r.problems.some((p) => p.includes('title 必填')))
  assert.equal(r.script, null)
  const noParams = checkTemplateArgs({ template: 'timeline', params: null, title: 't' })
  assert.ok(noParams.problems.some((p) => p.includes('params 必须是映射')))
})

test('模板 timeline：颜色别名收敛到规范名（orange→amber；真实会话里模型真写过 orange）', () => {
  const r = checkTemplateArgs({
    template: 'timeline',
    title: 't',
    params: {
      lanes: [
        { label: 'L', segments: [{ start: 0, end: 1, color: 'orange' }, { start: 1, end: 2, color: 'gray' }] },
      ],
    },
  })
  assert.equal(r.ok, true, r.problems.join('；'))
  // 规范名进脚本（不是别名），这样"同一个视觉"只有一份缓存键
  assert.ok(r.script.includes('PALETTE["amber"]'))
  assert.ok(r.script.includes('PALETTE["grey"]'))
  assert.ok(!r.script.includes('"orange"'))
  // 别名与规范名算出**同一个**参数（→ 同一个缓存键）
  const canonical = checkTemplateArgs({
    template: 'timeline',
    title: 't',
    params: {
      lanes: [{ label: 'L', segments: [{ start: 0, end: 1, color: 'amber' }, { start: 1, end: 2, color: 'grey' }] }],
    },
  })
  assert.equal(canonicalParams(r.params), canonicalParams(canonical.params))
})

test('模板 timeline：区间倒置/未知键/非法颜色/行数超限都报错', () => {
  const bad = checkTemplateArgs({
    template: 'timeline',
    title: 't',
    params: {
      unit: 'x',
      lanes: [
        { label: 'L', segments: [{ start: 10, end: 5 }] },
        { label: 'L2', segments: [{ start: 0, end: 1, color: 'pink' }] },
      ],
    },
  })
  assert.equal(bad.ok, false)
  assert.ok(bad.problems.some((p) => p.includes('end 必须大于 start')))
  assert.ok(bad.problems.some((p) => p.includes('color') && p.includes('blue')))
  const extra = checkTemplateArgs({ template: 'timeline', title: 't', params: { lanes: [], oops: 1 } })
  assert.ok(extra.problems.some((p) => p.includes('无法识别的键')))
})

test('模板 timeline：没写 color 时按出现顺序自动配色（不是全一个色）', () => {
  const r = checkTemplateArgs({
    template: 'timeline',
    title: 't',
    params: { lanes: [{ label: 'L', segments: [{ start: 0, end: 1 }, { start: 1, end: 2 }] }] },
  })
  assert.equal(r.ok, true)
  assert.ok(r.script.includes('PALETTE["blue"]'))
  assert.ok(r.script.includes('PALETTE["amber"]'))
})

test('模板 state_machine：walk 里出现未声明的边 → 报错（推移路径必须每一步都是真迁移）', () => {
  const r = checkTemplateArgs({
    template: 'state_machine',
    title: 't',
    params: {
      states: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      transitions: [{ from: 'a', to: 'b' }],
      walk: ['a', 'b', 'a'],
    },
  })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => p.includes('没有对应的边')))
})

test('模板 state_machine：未知 state id / 自环 / 重复 id 都报错', () => {
  const r = checkTemplateArgs({
    template: 'state_machine',
    title: 't',
    params: {
      states: [
        { id: 'a', label: 'A' },
        { id: 'a', label: 'A2' },
      ],
      transitions: [{ from: 'a', to: 'zzz' }, { from: 'a', to: 'a' }],
    },
  })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => p.includes('id 重复')))
  assert.ok(r.problems.some((p) => p.includes('必须是已声明的 state id')))
  assert.ok(r.problems.some((p) => p.includes('from 与 to 相同')))
})

test('模板 bar_compare：highlight 必须命中某项；负值报错', () => {
  const r = checkTemplateArgs({
    template: 'bar_compare',
    title: 't',
    params: { items: [{ label: 'A', value: 1 }, { label: 'B', value: -2 }], highlight: 'C' },
  })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => p.includes('highlight 必须是')))
  assert.ok(r.problems.some((p) => p.includes('≥ 0')))
})

test('模板目录文本：每个模板都带 id/中文名/版本/何时用/params 形状（单一维护点）', () => {
  const text = describeTemplates()
  for (const id of TEMPLATE_IDS) {
    assert.ok(text.includes(id))
    assert.ok(text.includes(`v${TEMPLATES[id].version}`))
    assert.ok(text.includes('params:'))
  }
})

// ── ② 备课声明（lib/prep.mjs）──────────────────────────────────────────────

test('备课声明：格式正确 → 规范化出 items（模板版本、场景类都带上）', () => {
  const m = parseManifest(readFileSync(join(FIXTURE, 'classroom.yaml'), 'utf8'), { baseDir: FIXTURE })
  assert.equal(m.prep.items.length, 3)
  const first = m.prep.items[0]
  assert.equal(first.id, 'fifo-vs-sjf')
  assert.equal(first.lesson, 3)
  assert.equal(first.template, 'timeline')
  assert.equal(first.templateVersion, 1)
  assert.equal(first.sceneClass, 'TimelineScene')
  assert.equal(first.required, true)
  assert.equal(m.prep.items[1].required, false, 'required: false 要如实带出来')
  assert.equal(prepItemsForLesson(m, 3).length, 2)
  assert.equal(prepItemsForLesson(m, 4).length, 0)
  assert.equal(prepItemsForLesson(m, null).length, 0)
})

test('备课声明：没有 prep 段的教室 → manifest 里没有 prep 键（老教室形状逐字不变）', () => {
  const text = readFileSync(join(FIXTURE, 'classroom.yaml'), 'utf8')
  const stripped = text.replace(/\nprep:\n[\s\S]*?(?=\nblocks:)/, '\n')
  const m = parseManifest(stripped, { baseDir: FIXTURE })
  assert.equal('prep' in m, false)
  assert.equal(m.animation.enabled, true)
})

test('🔴 备课声明：声明了 prep 却没启用动画 → 报错（死配置，不许静默）', () => {
  const text = readFileSync(join(FIXTURE, 'classroom.yaml'), 'utf8').replace('animation:\n  enabled: true\n', '')
  assert.throws(() => parseManifest(text, { baseDir: FIXTURE }), /没有启用教学动画/)
})

test('🔴 备课声明：material 指向不存在的文件 → 报错（否则缓存永远不命中，且不报错）', () => {
  const text = readFileSync(join(FIXTURE, 'classroom.yaml'), 'utf8').replace('materials/ch03.md', 'materials/nope.md')
  assert.throws(() => parseManifest(text, { baseDir: FIXTURE }), /material 指向的文件不存在/)
})

test('备课声明：模板参数不合法 → 报错，且用的是与工具路径同一套判据', () => {
  const base = `format: socratic-classroom/0
classroom: { id: t, title: T, lessons: 14 }
animation: { enabled: true }
prep:
  items:
    - id: bad-one
      lesson: 1
      template: bar_compare
      title: T
      material: materials/ch03.md
      params: { items: [{ label: A, value: 1 }], highlight: NOPE }
blocks:
  - id: a
    text: hi
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
`
  assert.throws(() => parseManifest(base, { baseDir: FIXTURE }), /模板参数不合法[\s\S]*highlight 必须是/)
})

test('备课声明：id 重复 / 未知键 / lesson 超讲数 / 未知模板 → 都报错', () => {
  const mk = (items) => `format: socratic-classroom/0
classroom: { id: t, title: T, lessons: 14 }
animation: { enabled: true }
prep:
  items:
${items}
blocks:
  - id: a
    text: hi
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
`
  const item = (extra, params = 'items: [{ label: A, value: 1 }]') => `    - id: x
      lesson: 1
      template: bar_compare
      title: T
      material: materials/ch03.md
      params: { ${params} }
${extra}`
  assert.throws(() => parseManifest(mk(`${item('')}\n${item('')}`), { baseDir: FIXTURE }), /id 重复/)
  assert.throws(() => parseManifest(mk(item('      oops: 1')), { baseDir: FIXTURE }), /无法识别的键/)
  assert.throws(
    () => parseManifest(mk(item('').replace('lesson: 1', 'lesson: 99')), { baseDir: FIXTURE }),
    /超过了本教室声明的讲数/,
  )
  assert.throws(
    () => parseManifest(mk(item('').replace('template: bar_compare', 'template: nope')), { baseDir: FIXTURE }),
    /template 必须是已注册的模板 id/,
  )
})

test('🔴 缓存键：三个维度各自变化都要换键（讲次/教材内容/模板版本/参数）', () => {
  const base = { lesson: 3, template: 'timeline', templateVersion: 1, params: { a: 1 }, materialSha256: 'm1' }
  const k0 = prepCacheKey(base)
  assert.notEqual(k0, prepCacheKey({ ...base, lesson: 4 }), '讲次变了要换键')
  assert.notEqual(k0, prepCacheKey({ ...base, materialSha256: 'm2' }), '教材内容变了要换键')
  assert.notEqual(k0, prepCacheKey({ ...base, templateVersion: 2 }), '模板版本变了要换键')
  assert.notEqual(k0, prepCacheKey({ ...base, params: { a: 2 } }), '参数变了要换键')
  assert.equal(k0, prepCacheKey({ ...base }), '同样的输入必须得到同样的键')
})

test('缓存键：参数对象**键顺序不同**必须算出同一个键（否则同一段动画会渲两遍）', () => {
  const a = { note: 'x', lanes: [{ label: 'L', segments: [{ start: 0, end: 1 }] }] }
  const b = { lanes: [{ segments: [{ end: 1, start: 0 }], label: 'L' }], note: 'x' }
  assert.equal(canonicalParams(a), canonicalParams(b))
  const key = (params) =>
    prepCacheKey({ lesson: 1, template: 'timeline', templateVersion: 1, params, materialSha256: 'm' })
  assert.equal(key(a), key(b))
})

test('缓存键：真的读了教材文件的内容（改一个字 → 换键）', async () => {
  const m = parseManifest(readFileSync(join(FIXTURE, 'classroom.yaml'), 'utf8'), { baseDir: FIXTURE })
  const item = m.prep.items[0]
  const k1 = await cacheKeyForItem({ baseDir: FIXTURE, item })
  const dir = tmpDir()
  mkdirSync(join(dir, 'materials'), { recursive: true })
  writeFileSync(join(dir, 'materials', 'ch03.md'), `${readFileSync(join(FIXTURE, 'materials', 'ch03.md'), 'utf8')}新增一行。\n`)
  const k2 = await cacheKeyForItem({ baseDir: dir, item })
  assert.notEqual(k1.cacheKey, k2.cacheKey)
  assert.equal(k1.cacheKey, (await cacheKeyForItem({ baseDir: FIXTURE, item })).cacheKey)
})

// ── ④ 预热与缓存（lib/prepstore.mjs；假 spawn、真落盘）─────────────────────

async function prepEnv(dir, extra = {}) {
  const m = parseManifest(readFileSync(join(FIXTURE, 'classroom.yaml'), 'utf8'), { baseDir: FIXTURE })
  const spawned = []
  const runtimeDir = join(dir, 'runtime')
  mkdirSync(runtimeDir, { recursive: true })
  const plan = await warmUpPrep({
    runtimeDir,
    baseDir: FIXTURE,
    items: prepItemsForLesson(m, 3),
    lesson: 3,
    turn: 1,
    python: '/fake/python',
    manim: '/fake/manim',
    io: realIo,
    spawn: fakeSpawn(spawned),
    now: () => new Date(2026, 8, 24, 8, 0, 0).getTime(),
    ...extra,
  })
  return { m, plan, spawned, runtimeDir }
}

test('预热：把这一讲没命中的两段都起起来，脚本由模板拼、不调用模型', async () => {
  const dir = tmpDir()
  const { plan, spawned } = await prepEnv(dir)
  assert.equal(plan.started.length, 2)
  assert.equal(spawned.length, 2, '两段各起一个 detached 渲染器')
  assert.equal(spawned[0].opts.detached, true)
  // 脚本真的落盘了，而且是模板生成的（不是模型写的）
  const [first] = plan.entries
  const taskDir = join(dir, 'runtime', 'animations', first.taskId)
  const script = readFileSync(join(taskDir, 'scene.py'), 'utf8')
  assert.ok(script.includes('class TimelineScene(Scene):'))
  const task = JSON.parse(readFileSync(join(taskDir, 'task.json'), 'utf8'))
  assert.equal(task.origin, 'prep')
  assert.equal(task.prepId, 'fifo-vs-sjf')
  assert.equal(task.template, 'timeline')
  assert.equal(task.cacheKey, first.cacheKey)
  assert.equal(task.announcedAt, null)
})

test('预热：状态落 ready 后再预热同一讲 → 全部命中缓存，**一个渲染器都不起**', async () => {
  const dir = tmpDir()
  const { plan, runtimeDir } = await prepEnv(dir)
  for (const entry of plan.entries) {
    const taskDir = join(runtimeDir, 'animations', entry.taskId)
    writeFileSync(
      join(taskDir, 'status.json'),
      JSON.stringify({ state: 'ready', mp4: `${entry.taskId}.mp4`, durationSec: 9.5, bytes: 12345 }),
    )
  }
  const second = await prepEnv(dir)
  assert.equal(second.plan.started.length, 0, '命中缓存不许再起渲染')
  assert.equal(second.spawned.length, 0)
  assert.ok(second.plan.entries.every((e) => e.state === 'cached'))
  assert.ok(second.plan.entries.every((e) => typeof e.artifact === 'string' && e.artifact.endsWith('.mp4')))
})

test('🔴 预热失败退路：同一个键最多起 MAX_PREP_ATTEMPTS 次，之后落 give-up（不再自动重试）', async () => {
  const dir = tmpDir()
  /** 把盘上**所有**任务目录都写成 failed（模拟渲染器真的失败了）。 */
  const markAllFailed = (runtimeDir) => {
    const root = join(runtimeDir, 'animations')
    for (const name of readdirSync(root)) {
      const taskDir = join(root, name)
      if (!statSync(taskDir).isDirectory()) continue
      writeFileSync(
        join(taskDir, 'status.json'),
        JSON.stringify({ state: 'failed', reason: 'manim 退出码 1，且没有产出 mp4' }),
      )
    }
  }
  const first = await prepEnv(dir)
  assert.equal(first.plan.started.length, 2)
  markAllFailed(first.runtimeDir)
  // 第 2 次预热：failed 且次数 < 上界 → 还允许重试一次
  const second = await prepEnv(dir)
  assert.equal(second.plan.started.length, 2, `尝试次数 ${MAX_PREP_ATTEMPTS} 之内还该重试`)
  markAllFailed(second.runtimeDir)
  // 第 3 次：次数已达上界 → give-up，不再起
  const third = await prepEnv(dir)
  assert.equal(third.spawned.length, 0)
  assert.ok(third.plan.entries.every((e) => e.state === 'give-up'), JSON.stringify(third.plan.entries))
  assert.ok(third.plan.entries.every((e) => e.attempts >= MAX_PREP_ATTEMPTS))
  assert.ok(describePrepPlan(third.plan).includes('已放弃自动重试'))
})

test('预热：并发闸已满时不起新任务，如实记 skipped（不排队到看不见的地方）', async () => {
  const dir = tmpDir()
  const { plan, spawned } = await prepEnv(dir, { maxConcurrent: 1 })
  assert.equal(spawned.length, 1)
  assert.equal(plan.started.length, 1)
  assert.equal(plan.skipped.length, 1)
  assert.ok(plan.skipped[0].includes('并发闸已满'))
  assert.equal(plan.entries.filter((e) => e.state === 'missing').length, 1)
})

test('备课状态文案：四种状态各有话说；坏的那几段给出"别等它"的出路', async () => {
  const dir = tmpDir()
  const { plan } = await prepEnv(dir)
  const text = describePrepPlan({ lesson: 3, entries: plan.entries })
  assert.ok(text.includes('第 3 讲'))
  assert.ok(text.includes('正在预热'))
  const bad = describePrepPlan({
    lesson: 3,
    entries: [
      { id: 'a', title: 'A', state: 'cached', artifact: 'animations/x/x.mp4' },
      { id: 'b', title: 'B', state: 'blocked', reason: 'D2 文字重叠' },
      { id: 'c', title: 'C', state: 'give-up', attempts: 2, reason: '没渲出来' },
    ],
  })
  // 🔴 2026-09-24 改（ALIGN-EXEC-2）：文案从"命中缓存，0 秒"改成与教室一致的定性说法
  //    （引擎侧不再向模型报秒数——同一件事不能两个数，见 index.mjs 的动画纪律注释）。
  assert.ok(bad.includes('命中缓存，基本不用等'))
  assert.ok(bad.includes('不许播'))
  assert.ok(bad.includes('已放弃自动重试'))
  assert.ok(bad.includes('classroom_draw'))
})

test('prepPlan：只读盘不起任务；缺 prep 段时 prepItemsForLesson 回空数组', async () => {
  const dir = tmpDir()
  const { plan, runtimeDir } = await prepEnv(dir)
  const read = await prepPlan({
    runtimeDir,
    baseDir: FIXTURE,
    items: plan.entries.map((e) => ({ id: e.id, title: e.title, template: e.template, lesson: 3, material: 'materials/ch03.md', params: {}, templateVersion: 1 })),
    lesson: 3,
  })
  assert.equal(read.entries.length, 2)
  assert.equal(prepItemsForLesson({}, 3).length, 0)
  assert.equal(prepItemsForLesson({ prep: { items: [] } }, 3).length, 0)
})

test('模板注册表：每个模板的 version 是正整数（它进缓存键，不能是 undefined）', () => {
  for (const id of TEMPLATE_IDS) {
    assert.ok(Number.isInteger(TEMPLATES[id].version) && TEMPLATES[id].version >= 1, `${id} 缺 version`)
    assert.equal(getTemplate(id).id, id)
  }
  assert.equal(getTemplate('nope'), null)
  assert.equal(getTemplate(undefined), null)
})

test('预热：教材改了 → 缓存键变了 → 会重新渲染（不是命中旧片）', async () => {
  const dir = tmpDir()
  const m = parseManifest(readFileSync(join(FIXTURE, 'classroom.yaml'), 'utf8'), { baseDir: FIXTURE })
  const items = prepItemsForLesson(m, 3)
  const runtimeDir = join(dir, 'runtime')
  mkdirSync(runtimeDir, { recursive: true })
  const baseDir = join(dir, 'classroom')
  mkdirSync(join(baseDir, 'materials'), { recursive: true })
  writeFileSync(join(baseDir, 'materials', 'ch03.md'), 'v1\n')
  const first = await warmUpPrep({
    runtimeDir, baseDir, items, lesson: 3, turn: 1, python: '/p', manim: '/m',
    io: realIo, spawn: fakeSpawn([]), now: () => 1000,
  })
  for (const entry of first.entries) {
    writeFileSync(join(runtimeDir, 'animations', entry.taskId, 'status.json'), JSON.stringify({ state: 'ready' }))
  }
  assert.ok(existsSync(join(runtimeDir, 'animations')))
  writeFileSync(join(baseDir, 'materials', 'ch03.md'), 'v2 教材改了\n')
  const spawned2 = []
  const second = await warmUpPrep({
    runtimeDir, baseDir, items, lesson: 3, turn: 2, python: '/p', manim: '/m',
    io: realIo, spawn: fakeSpawn(spawned2), now: () => 2000,
  })
  assert.equal(second.started.length, 2, '教材改了必须重做，不许命中旧片')
  assert.equal(spawned2.length, 2)
})
