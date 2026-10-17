// test/whiteboard.test.mjs — whiteboard.scene.v1 引擎单测（S1–S3 基础层）。
//
// 运行：node clients/classroom-ui/test/whiteboard.test.mjs   （亦可经 node --test 发现）
// 纪律：不调 LLM、不起宿主、不落盘、不碰 $DSH_HOME。零依赖，纯函数直装。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  check, normalize, serialize, parse,
  sceneToSvgModel, renderElement, hitTest, applyEdit,
  MAX_ELEMENTS, MAX_BYTES, SCENE_VERSION, ELEMENT_TYPES,
} from '../lib/whiteboard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = join(HERE, 'fixtures', 'whiteboard', 'lesson-01-process.json')

// ── 断言计数包装（仅用于汇报，不影响行为） ──────────────────────────────────
let COUNT = 0
const A = new Proxy(assert, {
  get(t, p) {
    const fn = t[p]
    if (typeof fn !== 'function') return fn
    return (...args) => { COUNT++; return fn.apply(t, args) }
  },
})

const loadFixture = () => parse(readFileSync(FIX, 'utf8'))

// ═══════════════════════════════════════════════════════════════════════════
// 1 · 真实 fixture 贯穿（来自研究区 PoC：cs-os 第1讲进程示意，仅复制 JSON）
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = loadFixture()
  A.equal(s.version, SCENE_VERSION)
  A.equal(s.lesson, 1)
  A.equal(s.rev, 3)
  A.equal(s.elements.length, 15)
  // 五种元素类型都在 fixture 内
  const types = new Set(s.elements.map((e) => e.type))
  for (const t of ELEMENT_TYPES) A.ok(types.has(t), `fixture 应含类型 ${t}`)
  // 往返深比较：parse(serialize(s)) 深等于 normalize(s)
  const round = parse(serialize(s))
  A.deepEqual(round, s)
  // 归一化把所有可选字段填上（检查默认补值，不修正非法）
  const rect = s.elements.find((e) => e.type === 'rect')
  A.equal(rect.rx, 8)
  const merm = s.elements.find((e) => e.type === 'mermaid')
  A.equal(merm.theme, 'dark')
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · check：合法 / 非法，且绝不静默修正
// ═══════════════════════════════════════════════════════════════════════════
{
  const good = { version: SCENE_VERSION, elements: [{ id: 'a', type: 'text', x: 1, y: 2, w: 3, h: 4, text: 'hi' }] }
  const r = check(good)
  A.equal(r.ok, true)
  A.equal(r.value.elements[0].color, '#ffffff')

  // 非法 type
  A.equal(check({ version: SCENE_VERSION, elements: [{ id: 'a', type: 'donut', x: 1, y: 2, w: 3, h: 4 }] }).ok, false)
  // 缺失 id
  A.equal(check({ version: SCENE_VERSION, elements: [{ type: 'text', x: 1, y: 2, w: 3, h: 4, text: 'x' }] }).ok, false)
  // 非法数字（非有限）
  A.equal(check({ version: SCENE_VERSION, elements: [{ id: 'a', type: 'rect', x: Infinity, y: 0, w: 10, h: 10 }] }).ok, false)
  A.equal(check({ version: SCENE_VERSION, elements: [{ id: 'a', type: 'rect', x: 1, y: 'no', w: 10, h: 10 }] }).ok, false)
  // w <= 0
  A.equal(check({ version: SCENE_VERSION, elements: [{ id: 'a', type: 'rect', x: 1, y: 1, w: 0, h: 10 }] }).ok, false)
  // 非有限 line 坐标
  A.equal(check({ version: SCENE_VERSION, elements: [{ id: 'a', type: 'line', x1: 1, y1: 2, x2: NaN, y2: 4 }] }).ok, false)
  // 错误 version
  A.equal(check({ version: 'whiteboard.scene.v0', elements: [] }).ok, false)
  // 重复 id
  A.equal(check({
    version: SCENE_VERSION,
    elements: [
      { id: 'dup', type: 'text', x: 1, y: 2, w: 3, h: 4, text: 'a' },
      { id: 'dup', type: 'text', x: 1, y: 2, w: 3, h: 4, text: 'b' },
    ],
  }).ok, false)
  // 超过 2000 元素
  const many = Array.from({ length: MAX_ELEMENTS + 1 }, (_, i) => ({ id: 'e' + i, type: 'text', x: 1, y: 2, w: 3, h: 4, text: 'x' }))
  A.equal(check({ version: SCENE_VERSION, elements: many }).ok, false)
  // 恰好 2000 通过
  const exact = Array.from({ length: MAX_ELEMENTS }, (_, i) => ({ id: 'e' + i, type: 'text', x: 1, y: 2, w: 3, h: 4, text: 'x' }))
  A.equal(check({ version: SCENE_VERSION, elements: exact }).ok, true)
  // 非法输入不被静默修正：color='' 应报错而非填默认
  A.equal(check({ version: SCENE_VERSION, elements: [{ id: 'a', type: 'text', x: 1, y: 2, w: 3, h: 4, text: 'x', color: '' }] }).ok, false)
  // arrow markerEnd 非法值
  A.equal(check({ version: SCENE_VERSION, elements: [{ id: 'a', type: 'arrow', x1: 1, y1: 1, x2: 2, y2: 2, markerEnd: 'triangle' }] }).ok, false)
  // mermaid theme 非法值
  A.equal(check({ version: SCENE_VERSION, elements: [{ id: 'a', type: 'mermaid', x: 1, y: 2, w: 3, h: 4, source: 'g', theme: 'neon' }] }).ok, false)
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · normalize / serialize / parse
// ═══════════════════════════════════════════════════════════════════════════
{
  const good = { version: SCENE_VERSION, rev: 2, lesson: 5, elements: [{ id: 'a', type: 'text', x: 1, y: 2, w: 3, h: 4, text: 'hi' }] }
  const n = normalize(good)
  A.equal(n.rev, 2)
  A.equal(n.lesson, 5)
  A.equal(n.canvas.width, 960) // 默认画布
  const ser = serialize(good)
  A.ok(ser.startsWith('{\n  "version"'))
  A.throws(() => parse('{ not json'))
  // 不截断：2MiB+ 抛错
  const big = { version: SCENE_VERSION, elements: [{ id: 'm', type: 'mermaid', x: 1, y: 2, w: 3, h: 4, source: 'x'.repeat(MAX_BYTES) }] }
  A.throws(() => serialize(big), /2MiB/)
  // parse 空字符串抛错
  A.throws(() => parse(''), SyntaxError)
  // normalize 非法场景抛错（错误信息含路径）
  A.throws(() => normalize({ version: SCENE_VERSION, elements: [{ id: 'a', type: 'bad' }] }), /whiteboard.scene 非法/)
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · sceneToSvgModel / renderElement
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = loadFixture()
  const model = sceneToSvgModel(s)
  A.equal(model.width, 960)
  A.equal(model.background, '#0a0a0a')
  A.equal(model.elements.length, 15)

  const rect = s.elements.find((e) => e.type === 'rect')
  const rs = renderElement(rect)
  A.ok(rs.startsWith('<rect'), 'rect 渲染为 <rect>')
  A.ok(rs.includes('class="wb-rect"'))

  const line = s.elements.find((e) => e.type === 'line')
  A.ok(renderElement(line).includes('<line'))

  const arrow = s.elements.find((e) => e.type === 'arrow')
  const ar = renderElement(arrow)
  A.ok(ar.includes('marker-end="url(#arrow-'))
  A.ok(ar.includes('<marker'))

  const text = s.elements.find((e) => e.type === 'text')
  const tx = renderElement(text)
  A.ok(tx.includes('<text'))
  A.ok(tx.includes('&lt;') === false) // 普通文本不做误转义

  const merm = s.elements.find((e) => e.type === 'mermaid')
  const mr = renderElement(merm)
  // 集成缝：S7 面板据此读取 source + theme 交给 vendored mermaid
  A.ok(mr.includes('data-source='))
  A.ok(mr.includes('data-theme="dark"'))
  A.ok(mr.includes('class="wb-mermaid"'))

  // 文本转义：< > & 必须被转义（防注入）
  const evil = renderElement({ id: 'e', type: 'text', x: 1, y: 2, w: 3, h: 4, text: '<script>&"x' })
  A.ok(evil.includes('&lt;script&gt;'))
  A.ok(evil.includes('&amp;'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · hitTest（最上层优先）
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = loadFixture()
  // 标题文本坐标命中
  A.equal(hitTest(s, { x: 50, y: 50 }), 't-title')
  // 空白处不命中
  A.equal(hitTest(s, { x: 5, y: 620 }), null)
  // 最上层：后绘制覆盖先绘制（数组末尾优先）
  const stacked = { version: SCENE_VERSION, elements: [
    { id: 'bottom', type: 'rect', x: 0, y: 0, w: 100, h: 100 },
    { id: 'top', type: 'rect', x: 0, y: 0, w: 100, h: 100 },
  ] }
  A.equal(hitTest(stacked, { x: 10, y: 10 }), 'top')
  // 非法 point 抛错
  A.throws(() => hitTest(s, { x: 'no', y: 1 }))
  A.throws(() => hitTest(s, { x: 1, y: NaN }))
}

// ═══════════════════════════════════════════════════════════════════════════
// 6 · applyEdit（不可变、报错不静默）
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = loadFixture()
  // add
  const added = applyEdit(s, { op: 'add', element: { id: 'new', type: 'rect', x: 1, y: 1, w: 10, h: 10 } })
  A.equal(added.elements.length, s.elements.length + 1)
  A.equal(s.elements.length, 15) // 入参未被修改
  // add 重复 id 抛错
  A.throws(() => applyEdit(s, { op: 'add', element: { id: 't-title', type: 'rect', x: 1, y: 1, w: 10, h: 10 } }))
  // update
  const upd = applyEdit(s, { op: 'update', id: 't-title', patch: { text: '改了' } })
  A.equal(upd.elements.find((e) => e.id === 't-title').text, '改了')
  A.equal(s.elements.find((e) => e.id === 't-title').text, '进程 = 程序的一次执行 + 它的执行状态')
  // update 不存在 id 抛错
  A.throws(() => applyEdit(s, { op: 'update', id: 'nope', patch: {} }))
  // update 导致非法（w=0）抛错
  A.throws(() => applyEdit(s, { op: 'update', id: 't-title', patch: { w: 0 } }))
  // remove
  const rm = applyEdit(s, { op: 'remove', id: 't-title' })
  A.equal(rm.elements.length, s.elements.length - 1)
  // remove 不存在 id 抛错
  A.throws(() => applyEdit(s, { op: 'remove', id: 'nope' }))
  // replace
  const rep = applyEdit(s, { op: 'replace', elements: [{ id: 'only', type: 'text', x: 1, y: 2, w: 3, h: 4, text: 'z' }] })
  A.equal(rep.elements.length, 1)
  // replace 含重复 id → 抛错
  A.throws(() => applyEdit(s, { op: 'replace', elements: [
    { id: 'd', type: 'text', x: 1, y: 2, w: 3, h: 4, text: 'a' },
    { id: 'd', type: 'text', x: 1, y: 2, w: 3, h: 4, text: 'b' },
  ] }))
  // setCanvas
  const sc = applyEdit(s, { op: 'setCanvas', canvas: { width: 1920, height: 1080, background: '#000000' } })
  A.equal(sc.canvas.width, 1920)
  // 非法 op
  A.throws(() => applyEdit(s, { op: 'frobnicate' }))
  // 非法入参
  A.throws(() => applyEdit(s, { op: 'add' }))
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`whiteboard.test.mjs: ${COUNT} 断言全部通过`)
process.exit(0)
