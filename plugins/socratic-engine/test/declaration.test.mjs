// test/declaration.test.mjs — EXPR-5「部署声明」的单测
//
// 覆盖三层：
//   ① `parseDeclaration()` 的**纯解析**：合法 / 坏 JSON / 顶层不是对象 / 缺键 / 绝对路径 / 尾斜杠归一；
//   ② `loadDeclaration()` 的**核对**：没配 / 相对路径 / 文件不存在 / 目录不存在 /
//      **一致**（含 realpath 跟随符号链接的形态）/**不一致**；
//   ③ `describeDeclaration()` 的**日志**：不一致时必须出声、必须带修法；一致时不许喊 🔴。
//
// 🔴 全部用临时目录，不碰任何教室真文件、不碰真 profile。
// 运行：/opt/homebrew/bin/node --test test/declaration.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describeDeclaration, loadDeclaration, normalizeRelative, parseDeclaration } from '../lib/declaration.mjs'

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'expr5-'))
}

/** 造一棵最小工作区：`<root>/教室/classroom.yaml` ＋ 一份声明文件。 */
function makeWorkspace(declarationText, options = {}) {
  const root = tmpDir()
  const classroomRel = options.classroomRel ?? 'code/classrooms/cs-os'
  const classroomAbs = join(root, classroomRel)
  mkdirSync(classroomAbs, { recursive: true })
  writeFileSync(join(classroomAbs, 'classroom.yaml'), 'classroom:\n  id: cs-os\n')
  const declFile = join(root, 'code/clients/classroom-ui/classroom.config.json')
  mkdirSync(join(root, 'code/clients/classroom-ui'), { recursive: true })
  if (declarationText !== null) writeFileSync(declFile, declarationText)
  return { root, classroomRel, classroomAbs, declFile }
}

const good = (rel) => JSON.stringify({ classroomRoot: rel, portraitModel: 'Haru' })

// ── ① 纯解析 ─────────────────────────────────────────────────────────────────
test('parseDeclaration：合法声明逐字取出两个字段', () => {
  const parsed = parseDeclaration('{"classroomRoot":"A/b","portraitModel":"Haru","note":"x"}')
  assert.deepEqual(parsed, { ok: true, reason: null, classroomRoot: 'A/b', portraitModel: 'Haru' })
})

test('parseDeclaration：读不到的一律 ok:false ＋ 原因（绝不填默认值）', () => {
  assert.equal(parseDeclaration('{').ok, false)
  assert.match(parseDeclaration('{').reason, /不是合法 JSON/)
  assert.equal(parseDeclaration('[]').ok, false)
  assert.match(parseDeclaration('[]').reason, /顶层必须是对象/)
  assert.match(parseDeclaration('{"portraitModel":"Haru"}').reason, /classroomRoot/)
  assert.match(parseDeclaration('{"classroomRoot":"A"}').reason, /portraitModel/)
  assert.match(parseDeclaration('{"classroomRoot":"","portraitModel":"Haru"}').reason, /classroomRoot/)
  assert.match(parseDeclaration('{"classroomRoot":"/abs/x","portraitModel":"Haru"}').reason, /工作区相对/)
  // 相对路径的三种常见写法都要归一，否则"同一目录"会被判成两个
  assert.equal(normalizeRelative('./A/b/'), 'A/b')
  assert.equal(parseDeclaration('{"classroomRoot":"./A/b/","portraitModel":"Haru"}').classroomRoot, 'A/b')
})

// ── ② 核对 ───────────────────────────────────────────────────────────────────
test('loadDeclaration：没配置 → 明说"没有机核"（configured:false）', async () => {
  const state = await loadDeclaration({ workspaceRoot: '/tmp' })
  assert.equal(state.configured, false)
  assert.equal(state.ok, false)
  assert.match(state.reason, /未配置 config\.classroomDeclaration/)
  assert.match(state.reason, /没有机核/)
})

test('loadDeclaration：config 给了相对路径 → 当场判失败（与 capabilityFile 同一口径）', async () => {
  const state = await loadDeclaration({ file: 'relative/classroom.config.json', workspaceRoot: '/tmp' })
  assert.equal(state.ok, false)
  assert.match(state.reason, /必须是\*\*绝对路径\*\*/)
})

test('loadDeclaration：文件不存在 / 声明写坏了 → 结构化原因，不抛', async () => {
  const ws = makeWorkspace(null)
  const missing = await loadDeclaration({ file: ws.declFile, workspaceRoot: ws.root, classroomDir: ws.classroomAbs })
  assert.equal(missing.ok, false)
  assert.match(missing.reason, /读不到部署声明/)

  const brokenWs = makeWorkspace('{"classroomRoot":')
  const broken = await loadDeclaration({ file: brokenWs.declFile, workspaceRoot: brokenWs.root, classroomDir: brokenWs.classroomAbs })
  assert.equal(broken.ok, false)
  assert.match(broken.reason, /不可用/)
})

test('loadDeclaration：声明的教室目录不存在 → 明说（不拿它去猜）', async () => {
  const ws = makeWorkspace(good('code/classrooms/不存在'))
  const state = await loadDeclaration({ file: ws.declFile, workspaceRoot: ws.root, classroomDir: ws.classroomAbs })
  assert.equal(state.ok, false)
  assert.match(state.reason, /不存在/)
})

test('🔴 loadDeclaration：一致 → rootMatches:true（realpath 逐字比较）', async () => {
  const ws = makeWorkspace(good('code/classrooms/cs-os'))
  const state = await loadDeclaration({ file: ws.declFile, workspaceRoot: ws.root, classroomDir: ws.classroomAbs })
  assert.equal(state.ok, true)
  assert.equal(state.rootMatches, true)
  assert.equal(state.portraitModel, 'Haru')
  assert.equal(state.classroomRoot, 'code/classrooms/cs-os')
})

test('🔴 loadDeclaration：不一致 → rootMatches:false（这就是"引擎写了但面板看不到"那条）', async () => {
  const ws = makeWorkspace(good('code/classrooms/cs-os'))
  // 引擎被 --patch 指到别处（EXPR-4 取证时的形状：一份教室副本）
  const copyAbs = join(ws.root, 'tmp/classroom-copy')
  mkdirSync(copyAbs, { recursive: true })
  const state = await loadDeclaration({ file: ws.declFile, workspaceRoot: ws.root, classroomDir: copyAbs })
  assert.equal(state.ok, true)
  assert.equal(state.rootMatches, false)
  assert.notEqual(state.classroomDirAbs, state.declaredDirAbs)
})

test('🔴 loadDeclaration：符号链接形态下仍判"一致"（macOS 的 /tmp → /private/tmp 那类坑）', async () => {
  const ws = makeWorkspace(good('code/classrooms/cs-os'))
  // 造一条指向真教室的软链，并让"引擎装载的目录"走软链那条路
  const linkAbs = join(ws.root, 'link-to-classroom')
  symlinkSync(ws.classroomAbs, linkAbs)
  const state = await loadDeclaration({ file: ws.declFile, workspaceRoot: ws.root, classroomDir: linkAbs })
  assert.equal(state.rootMatches, true, '词法比较会把同一个目录判成两个 → 必须 realpath 后再比')
})

test('loadDeclaration：引擎还没装载教室 → 说明"无从核对"，不假装核过', async () => {
  const ws = makeWorkspace(good('code/classrooms/cs-os'))
  const state = await loadDeclaration({ file: ws.declFile, workspaceRoot: ws.root })
  assert.equal(state.ok, false)
  assert.match(state.reason, /还没装载任何教室/)
})

// ── ③ 日志 ───────────────────────────────────────────────────────────────────
test('🔴 describeDeclaration：不一致 → 出声 ＋ 给修法（三条都指向"改一处"）', () => {
  const state = {
    configured: true, ok: true, file: '/w/classroom.config.json', reason: null,
    classroomRoot: 'code/classrooms/cs-os', portraitModel: 'Haru',
    declaredDirAbs: '/w/code/classrooms/cs-os', classroomDirAbs: '/w/tmp/classroom-copy', rootMatches: false,
  }
  const lines = describeDeclaration(state, undefined).join('\n')
  assert.match(lines, /🔴 部署声明不一致/)
  assert.match(lines, /引擎写了但面板看不到/)
  assert.match(lines, /修法/)
  assert.match(lines, /classroomRoot/)
  assert.match(lines, /classroomDir/)
})

test('describeDeclaration：一致 → 不喊 🔴，且把"同一路径"说出来', () => {
  const state = {
    configured: true, ok: true, file: '/w/classroom.config.json', reason: null,
    classroomRoot: 'code/classrooms/cs-os', portraitModel: 'Haru',
    declaredDirAbs: '/w/code/classrooms/cs-os', classroomDirAbs: '/w/code/classrooms/cs-os', rootMatches: true,
  }
  const lines = describeDeclaration(state, 'Haru')
  assert.equal(lines.some((line) => line.includes('🔴')), false)
  assert.match(lines.join('\n'), /两侧同一路径/)
  assert.match(lines.join('\n'), /立绘模型 Haru/)
})

test('🔴 describeDeclaration：config.expression.model 与声明冲突 → 出声并说明"以声明为准"', () => {
  const state = {
    configured: true, ok: true, file: '/w/classroom.config.json', reason: null,
    classroomRoot: 'code/classrooms/cs-os', portraitModel: 'Haru',
    declaredDirAbs: '/w/code/classrooms/cs-os', classroomDirAbs: '/w/code/classrooms/cs-os', rootMatches: true,
  }
  const lines = describeDeclaration(state, 'Mao').join('\n')
  assert.match(lines, /config\.expression\.model="Mao"/)
  assert.match(lines, /以声明为准/)
})

test('describeDeclaration：没核成 → 出声并说明怎么修（不静默放过）', () => {
  const lines = describeDeclaration({ configured: true, ok: false, file: '/w/x.json', reason: '读不到部署声明 /w/x.json（ENOENT）' }).join('\n')
  assert.match(lines, /🔴 部署一致性\*\*没核成\*\*/)
  assert.match(lines, /修法/)
})
