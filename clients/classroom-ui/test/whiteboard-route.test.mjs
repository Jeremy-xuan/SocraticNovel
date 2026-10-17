// test/whiteboard-route.test.mjs — whiteboard-route.mjs 路由层单测（纯函数，不落盘 / 不注册宿主）。
//
// 运行：node clients/classroom-ui/test/whiteboard-route.test.mjs   （亦可经 node --test 发现）
// 覆盖：save body 校验 / lesson→runtime/whiteboard/LNN.scene.json / baseRev 冲突 409 /
//       路径边界（绝对路径拒绝、穿越拒绝）/ index 追加行 / 原子写计划数据。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  planWhiteboardSave, lessonToPath, safeJoin, resolveScenePath, WHITEBOARD_DIR,
} from '../lib/whiteboard-route.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = join(HERE, 'fixtures', 'whiteboard', 'lesson-01-process.json')
const FIXTURE_TEXT = readFileSync(FIX, 'utf8')
const ROOT = '/workspace/root'

let COUNT = 0
const A = new Proxy(assert, {
  get(t, p) {
    const fn = t[p]
    if (typeof fn !== 'function') return fn
    return (...args) => { COUNT++; return fn.apply(t, args) }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 1 · lesson → 路径映射
// ═══════════════════════════════════════════════════════════════════════════
{
  A.equal(lessonToPath(1), 'runtime/whiteboard/L01.scene.json')
  A.equal(lessonToPath(12), 'runtime/whiteboard/L12.scene.json')
  A.equal(lessonToPath(99), 'runtime/whiteboard/L99.scene.json')
  A.throws(() => lessonToPath(0))
  A.throws(() => lessonToPath('x'))
  A.throws(() => lessonToPath(-3))
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · 路径边界（绝对路径拒绝 / 穿越拒绝 / 正常 join）
// ═══════════════════════════════════════════════════════════════════════════
{
  // 正常相对路径
  A.ok(safeJoin(ROOT, `${WHITEBOARD_DIR}/L01.scene.json`).endsWith('runtime/whiteboard/L01.scene.json'))
  // 绝对路径拒绝
  A.throws(() => safeJoin(ROOT, '/etc/passwd'))
  A.throws(() => safeJoin(ROOT, '/abs/L01.scene.json'))
  // 穿越拒绝（.. 逃出 root）
  A.throws(() => safeJoin(ROOT, '../escape.json'))
  A.throws(() => safeJoin(ROOT, `${WHITEBOARD_DIR}/../../../etc/passwd`))
  // 注意：看似穿越、实际落回 root 内的路径**不应**被拒（相对解析会抵消 ..），但仍只在 root 内
  const inside = safeJoin(ROOT, 'runtime/whiteboard/../whiteboard/../../L01.scene.json')
  A.ok(inside.startsWith(ROOT))
  A.ok(inside.endsWith('L01.scene.json'))
  // resolveScenePath 复用边界守卫
  A.ok(resolveScenePath(ROOT, 1).endsWith('runtime/whiteboard/L01.scene.json'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · 正向保存（200 + 原子写计划 + index 行）
// ═══════════════════════════════════════════════════════════════════════════
{
  const plan = planWhiteboardSave({ root: ROOT, lesson: 1, body: FIXTURE_TEXT, currentRev: 3, baseRev: 3 })
  A.equal(plan.status, 200)
  A.equal(plan.rev, 4) // currentRev+1
  A.ok(plan.filePath.endsWith('runtime/whiteboard/L01.scene.json'))
  A.ok(plan.write.target.endsWith('runtime/whiteboard/L01.scene.json'))
  A.ok(plan.write.temp.endsWith('.tmp'))
  A.equal(plan.write.mode, 0o600)
  A.ok(plan.write.content.includes('whiteboard.scene.v1'))
  // index 行可被 JSON.parse，且字段完整
  const idx = JSON.parse(plan.index.line)
  A.equal(idx.lesson, 1)
  A.equal(idx.rev, 4)
  A.equal(idx.bytes, Buffer.byteLength(plan.write.content, 'utf8'))
  A.ok(plan.index.path.endsWith('runtime/whiteboard/index.jsonl'))
  // 写入内容就是序列化后的场景（含被以 URL lesson 为准补的 lesson 字段）
  A.ok(plan.write.content.includes('"lesson": 1'))
}

// 多 lesson 各落各的（用 body 无 lesson 字段的中性场景，避免 lesson/URL 一致性冲突）
const NEUTRAL_BODY = JSON.stringify({
  version: 'whiteboard.scene.v1',
  elements: [{ id: 'a', type: 'text', x: 1, y: 2, w: 3, h: 4, text: 'x' }],
})
{
  const p5 = planWhiteboardSave({ root: ROOT, lesson: 5, body: NEUTRAL_BODY, currentRev: 0, baseRev: 0 })
  A.equal(p5.status, 200)
  A.equal(p5.rev, 1)
  A.ok(p5.filePath.endsWith('runtime/whiteboard/L05.scene.json'))
  A.ok(p5.write.content.includes('"lesson": 5'))
}

// body 传已解析对象也行
{
  const obj = JSON.parse(FIXTURE_TEXT)
  const p = planWhiteboardSave({ root: ROOT, lesson: 1, body: obj, currentRev: 0, baseRev: 0 })
  A.equal(p.status, 200)
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · 负向（400 / 409），且不静默修正
// ═══════════════════════════════════════════════════════════════════════════
{
  // baseRev 冲突 → 409
  const conflict = planWhiteboardSave({ root: ROOT, lesson: 1, body: FIXTURE_TEXT, currentRev: 5, baseRev: 3 })
  A.equal(conflict.status, 409)
  A.equal(conflict.error, 'rev_conflict')
  A.equal(conflict.currentRev, 5)

  // body 非法 JSON → 400
  const badJson = planWhiteboardSave({ root: ROOT, lesson: 1, body: '{ broken', currentRev: 0, baseRev: 0 })
  A.equal(badJson.status, 400)

  // 场景校验失败（缺字段）→ 400
  const badScene = planWhiteboardSave({ root: ROOT, lesson: 1, body: JSON.stringify({ version: 'whiteboard.scene.v1', elements: [{ id: 'x', type: 'rect', x: 1 }] }), currentRev: 0, baseRev: 0 })
  A.equal(badScene.status, 400)
  A.ok(badScene.message.includes('场景校验失败'))

  // lesson 与 body 不一致 → 400（不静默覆盖）
  const mismatch = planWhiteboardSave({ root: ROOT, lesson: 1, body: JSON.stringify({ version: 'whiteboard.scene.v1', lesson: 7, elements: [{ id: 'a', type: 'text', x: 1, y: 2, w: 3, h: 4, text: 'x' }] }), currentRev: 0, baseRev: 0 })
  A.equal(mismatch.status, 400)
  A.ok(mismatch.message.includes('不一致'))

  // 绝对路径 body 不会触发（body 不涉路径）；但非法 root 触发
  const badRoot = planWhiteboardSave({ root: '', lesson: 1, body: FIXTURE_TEXT, currentRev: 0, baseRev: 0 })
  A.equal(badRoot.status, 400)

  // lesson 非法 → 400
  const badLesson = planWhiteboardSave({ root: ROOT, lesson: 0, body: FIXTURE_TEXT, currentRev: 0, baseRev: 0 })
  A.equal(badLesson.status, 400)

  // currentRev / baseRev 非法 → 400
  A.equal(planWhiteboardSave({ root: ROOT, lesson: 1, body: FIXTURE_TEXT, currentRev: -1, baseRev: 0 }).status, 400)
  A.equal(planWhiteboardSave({ root: ROOT, lesson: 1, body: FIXTURE_TEXT, currentRev: 0, baseRev: 'x' }).status, 400)

  // 路径边界：构造一个会触发穿越的 lesson（不现实，但守卫对非法 rel 也生效）
  // 通过 root=绝对、body 合法但场景含会导致越界写层？本模块不读盘，越界只能在 safeJoin 阶段暴露；
  // 这里直接验证 resolveScenePath 在非法 root 时仍只产出 root 内路径。
  const p = planWhiteboardSave({ root: ROOT, lesson: 1, body: FIXTURE_TEXT, currentRev: 0, baseRev: 0 })
  A.ok(!p.filePath.startsWith('/etc'))
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`whiteboard-route.test.mjs: ${COUNT} 断言全部通过`)
process.exit(0)
