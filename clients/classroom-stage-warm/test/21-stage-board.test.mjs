// 21-stage-board.test.mjs —— 宿主半边的板书闭环（契约 K2.2）与情绪通道（K1.4）单测
//
// 直接 import `lib/index.js` 里的 `stageInternals`（导出它们不影响宿主装载：
// cordis 只读 default/name/inject/apply）。所有用例都在 `mkdtemp` 的临时目录里跑，
// **不碰仓库里的 classrooms/**。
//
// 跑法：node test/21-stage-board.test.mjs   （check.sh 第七组也会跑）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stageInternals } from '../lib/index.js'

let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('✔ ' + name); return }
  fail += 1
  console.log('✖ ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra)))
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want })
}

const { resolveDiagramFile, listDiagrams, parseIndexRows, readEmotionEvents, classroomRootOf, readClassroomInfo, diagramsDirOf } = stageInternals

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-board-'))
const diagrams = path.join(root, 'diagrams')
fs.mkdirSync(diagrams, { recursive: true })

const GOOD_ID = 'L03-T05-20261020-231500-flowchart'
fs.writeFileSync(path.join(diagrams, GOOD_ID + '.mmd'), 'flowchart TD\n  A-->B\n', 'utf8')
fs.writeFileSync(path.join(diagrams, 'index.md'), [
  '# 板书图索引',
  '',
  '| 日期 | 讲次 | 回合 | 图类型 | 标题 | 说明 | 源文件 |',
  '|---|---|---|---|---|---|---|',
  '| 2026-10-20 23:15:00 | 第 3 讲 | 5 | flowchart | 进程三态 | 一次典型状态迁移 | `' + GOOD_ID + '.mmd` |',
  '',
].join('\n'), 'utf8')

// ② 符号链接逃逸：根内的 link.mmd 指到根外的文件
const outside = path.join(root, 'outside.mmd')
fs.writeFileSync(outside, 'flowchart LR\n  X-->Y\n', 'utf8')
try { fs.symlinkSync(outside, path.join(diagrams, 'link.mmd')) } catch { /* 某些文件系统不许建符号链接 */ }
// ③ 根内互链（合法）：alias.mmd → GOOD_ID.mmd
try { fs.symlinkSync(path.join(diagrams, GOOD_ID + '.mmd'), path.join(diagrams, 'alias.mmd')) } catch { /* ignore */ }

// ══════════════════════════════════════════════════════════════════════════
// 一 · 拒绝规则（契约 K2.2：任一不满足返 400，不是 500）
// ══════════════════════════════════════════════════════════════════════════
const bad = [
  ['..', 'bad-chars'],
  ['../etc/passwd', 'bad-chars'],
  ['..%2F..%2Fetc%2Fpasswd', 'bad-chars'],
  ['%2e%2e', 'bad-chars'],
  ['a%2Fb', 'bad-chars'],
  ['a/b', 'bad-chars'],
  ['a b', 'bad-chars'],
  ['a.b', 'bad-chars'],
  ['a:b', 'bad-chars'],
  ['', 'empty-id'],
]
for (const [id, reason] of bad) {
  const r = resolveDiagramFile(diagrams, id)
  ok('拒绝 · ' + JSON.stringify(id) + ' → 400/' + reason,
    r.ok === false && r.status === 400 && r.reason === reason, r)
}

// 变量类型都要挡（路由可能拿到 undefined）
for (const weird of [null, undefined, 42, {}, []]) {
  const r = resolveDiagramFile(diagrams, weird)
  ok('拒绝 · 非字符串 id（' + String(weird) + '）→ 400', r.ok === false && r.status === 400, r)
}

// 存在的图：200 级别的 ok
{
  const r = resolveDiagramFile(diagrams, GOOD_ID)
  ok('通过 · 合法 id 拿到绝对路径', r.ok === true && path.basename(r.abs) === GOOD_ID + '.mmd', r)
  eq('通过 · 内容就是 mermaid 源码', fs.readFileSync(r.abs, 'utf8').trim(), 'flowchart TD\n  A-->B')
}

// 缺文件 → 404（不是 400：请求本身合法，只是图不在）
{
  const r = resolveDiagramFile(diagrams, 'L99-T01-20260101-000000-missing')
  ok('缺件 · 404 而不是 400', r.ok === false && r.status === 404 && r.reason === 'file-missing', r)
}

// 根目录不存在 → 404
{
  const r = resolveDiagramFile(path.join(root, 'nope'), GOOD_ID)
  ok('无根目录 · 404（no-diagrams-dir）', r.ok === false && r.status === 404 && r.reason === 'no-diagrams-dir', r)
}

// ④ 符号链接逃逸 → 400
{
  const hasLink = fs.existsSync(path.join(diagrams, 'link.mmd'))
  const r = resolveDiagramFile(diagrams, 'link')
  ok('符号链接逃逸 · ' + (hasLink ? '400/symlink-escape' : '跳过（无法建符号链接）'),
    hasLink ? (r.ok === false && r.status === 400 && r.reason === 'symlink-escape') : true, r)
}

// 根内互链（realpath 仍在根内）→ 放行，且返回的是真身路径
{
  const hasAlias = fs.existsSync(path.join(diagrams, 'alias.mmd'))
  const r = resolveDiagramFile(diagrams, 'alias')
  ok('根内符号链接 · ' + (hasAlias ? '放行且指向真身' : '跳过（无法建符号链接）'),
    hasAlias ? (r.ok === true && path.basename(r.abs) === GOOD_ID + '.mmd') : true, r)
}

// ══════════════════════════════════════════════════════════════════════════
// 二 · 索引解析与清单（K2.2 的 JSON 形状）
// ══════════════════════════════════════════════════════════════════════════
{
  const rows = parseIndexRows(fs.readFileSync(path.join(diagrams, 'index.md'), 'utf8'))
  eq('索引 · 解析出一行', rows.length, 1)
  eq('索引 · 字段逐条', [rows[0].lesson, rows[0].turn, rows[0].kind, rows[0].title, rows[0].file],
    [3, 5, 'flowchart', '进程三态', GOOD_ID + '.mmd'])
  eq('索引 · 表头与分隔行被跳过', parseIndexRows('| 日期 | 讲次 | 回合 | 图类型 | 标题 | 说明 | 源文件 |\n|---|---|---|---|---|---|---|').length, 0)
  eq('索引 · 空内容不出错', parseIndexRows(''), [])
  eq('索引 · 老索引（无「会话」列）→ session 空串', rows[0].session, '')

  // 🔴 2026-10-20 引擎侧给表格末尾加了「会话」列：必须按表头名取列，不按固定下标
  const withSession = [
    '| 日期 | 讲次 | 回合 | 图类型 | 标题 | 说明 | 源文件 | 会话 |',
    '|---|---|---|---|---|---|---|---|',
    '| 2026-10-21 01:02:03 | 第 7 讲 | 2 | sequenceDiagram | 双进程交互 | 说明 | `L07-T02-20261021-010203-sequence.mmd` | s-42 |',
  ].join('\n')
  const rows2 = parseIndexRows(withSession)
  eq('索引 · 有「会话」列时字段仍逐条对', [rows2[0].lesson, rows2[0].turn, rows2[0].kind, rows2[0].title, rows2[0].session],
    [7, 2, 'sequenceDiagram', '双进程交互', 's-42'])
  eq('索引 · 表头名变了也不按位置猜（源文件在倒数第二列）', rows2[0].file, 'L07-T02-20261021-010203-sequence.mmd')

  // 列序被打乱也必须认
  const shuffled = [
    '| 源文件 | 会话 | 标题 | 日期 | 回合 | 图类型 | 讲次 | 说明 |',
    '|---|---|---|---|---|---|---|---|',
    '| `A.mmd` | s-9 | 乱序表头 | 2026-10-21 02:00:00 | 4 | flowchart | 第 2 讲 | 说明2 |',
  ].join('\n')
  const rows3 = parseIndexRows(shuffled)
  eq('索引 · 列序打乱仍按表头名取', [rows3[0].file, rows3[0].session, rows3[0].title, rows3[0].turn, rows3[0].lesson],
    ['A.mmd', 's-9', '乱序表头', 4, 2])
}

{
  const list = listDiagrams(diagrams)
  ok('清单 · items 是数组', Array.isArray(list.items))
  ok('清单 · 至少含那张合法图', list.items.some((x) => x.id === GOOD_ID))
  const one = list.items.find((x) => x.id === GOOD_ID)
  eq('清单 · 形状 = 契约七字段 + session（不多不少）',
    Object.keys(one).sort(), ['file', 'id', 'kind', 'lesson', 'session', 'time', 'title', 'turn'])
  eq('清单 · 索引里的元数据带出来', [one.lesson, one.turn, one.kind, one.title], [3, 5, 'flowchart', '进程三态'])
  // 倒序：新写的文件 mtime 更新 → 排在前面
  fs.writeFileSync(path.join(diagrams, 'L04-T01-20261021-000000-sequence.mmd'), 'sequenceDiagram\n  A->>B: hi\n', 'utf8')
  const list2 = listDiagrams(diagrams)
  ok('清单 · 按时间倒序（最新在前）', list2.items[0].id === 'L04-T01-20261021-000000-sequence', list2.items.map((x) => x.id))
  // 非 .mmd 一律不进清单
  ok('清单 · 不收非 .mmd 文件', list2.items.every((x) => x.id.indexOf('index') === -1 && x.file.endsWith('.mmd')))
}

// ══════════════════════════════════════════════════════════════════════════
// 三 · 情绪通道（K1.4：只回 seq > after）
// ══════════════════════════════════════════════════════════════════════════
{
  const runtimeDir = path.join(root, 'runtime')
  fs.mkdirSync(runtimeDir, { recursive: true })
  const lines = [
    { v: 1, seq: 1, ts: '2026-10-20T23:15:00-04:00', session: 's', turn: 1, label: 'calm', intensity: 0.2 },
    { v: 1, seq: 2, ts: '2026-10-20T23:15:01-04:00', session: 's', turn: 1, label: 'shy', intensity: 0.6 },
    { v: 1, seq: 3, ts: '2026-10-20T23:15:02-04:00', session: 's', turn: 2, label: 'happy', intensity: 0.9 },
  ]
  fs.writeFileSync(path.join(runtimeDir, 'emotions.jsonl'),
    lines.map((o) => JSON.stringify(o)).join('\n') + '\n{半截坏行\n', 'utf8')

  const a = readEmotionEvents(runtimeDir, 0)
  eq('情绪 · after=0 拿到前三条（坏行跳过）', a.events.map((e) => e.seq), [1, 2, 3])
  eq('情绪 · nextSeq 是最大 seq', a.nextSeq, 3)

  const b = readEmotionEvents(runtimeDir, 2)
  eq('情绪 · after=2 只回 seq>2', b.events.map((e) => e.seq), [3])

  const c = readEmotionEvents(runtimeDir, 3)
  eq('情绪 · after=3 没有新事件', c.events, [])
  eq('情绪 · nextSeq 不回退', c.nextSeq, 3)

  const d = readEmotionEvents(path.join(root, 'no-runtime'), 0)
  eq('情绪 · 文件不存在＝空（不报错）', [d.events, d.nextSeq], [[], 0])
}

// ══════════════════════════════════════════════════════════════════════════
// 四 · 教室目录解析 + 教室标识（角色名不写死）
// ══════════════════════════════════════════════════════════════════════════
{
  const ws = path.join(root, 'ws')
  const cls = path.join(ws, 'classrooms', 'cs-os')
  fs.mkdirSync(path.join(cls, 'runtime', 'diagrams'), { recursive: true })
  fs.mkdirSync(path.join(cls, 'characters'), { recursive: true })
  fs.writeFileSync(path.join(cls, 'classroom.yaml'), [
    'format: socratic-classroom/0',
    '',
    'classroom:',
    '  id: cs-os',
    '  title: 计算机系教室 · 操作系统',
    '  lessons: 14',
    '',
    'blocks:',
    '  - id: persona.deepseek',
    '    path: characters/testteacher.md',
    '    layer: persona',
    '',
  ].join('\n'), 'utf8')
  fs.writeFileSync(path.join(cls, 'characters', 'testteacher.md'), [
    '# 测试老师（Test Teacher）· 本教室版本',
    '',
    '| 项 | 值 |',
    '|---|---|',
    '| 名字 | 测试老师（Test Teacher） |',
    '',
  ].join('\n'), 'utf8')

  const c1 = classroomRootOf({ workspaceRoot: ws, classroom: 'cs-os', cwd: '/nonexistent' })
  eq('教室目录 · settings.workspaceRoot 命中', [path.basename(c1.dir), c1.source], ['cs-os', 'settings.workspaceRoot'])
  eq('教室目录 · diagrams 子路径', path.basename(diagramsDirOf(c1.dir)), 'diagrams')

  const c2 = classroomRootOf({ workspaceRoot: '/nonexistent', classroom: 'cs-os', workspaces: [ws], cwd: '/tmp' })
  eq('教室目录 · 登记表候选', [c2.dir, c2.source], [cls, 'workspaceRegistry'])
  ok('教室目录 · 试过的候选都列出来（归因用）', c2.tried.indexOf('/nonexistent') === 0, c2.tried)

  const c3 = classroomRootOf({ workspaceRoot: '/nonexistent', classroom: 'cs-os', workspaces: [], cwd: '/tmp' })
  ok('教室目录 · 全都不命中 → dir:null（不瞎猜）', c3.dir === null && c3.tried.join(',') === '/nonexistent,/tmp', c3)

  const info = readClassroomInfo(cls)
  eq('教室标识 · id/title', [info.id, info.title], ['cs-os', '计算机系教室 · 操作系统'])
  eq('教室标识 · 老师名来自 persona 块指向的角色卡', [info.teacher.name, info.teacher.source],
    ['测试老师（Test Teacher）', 'characters/testteacher.md'])

  // 角色卡里没有「名字」行 → 退回 H1；H1 也没有 → null（前端只显示「在场」）
  fs.writeFileSync(path.join(cls, 'characters', 'testteacher.md'), '# 甲老师· 某教室版本\n', 'utf8')
  eq('教室标识 · 没有名字行时退回 H1', readClassroomInfo(cls).teacher.name, '甲老师')
  fs.writeFileSync(path.join(cls, 'characters', 'testteacher.md'), '没有标题也没有名字行\n', 'utf8')
  eq('教室标识 · 都读不到 → null（不写死人名）', readClassroomInfo(cls).teacher.name, null)

  // 没有 classroom.yaml 的目录
  const empty = path.join(root, 'empty-classroom')
  fs.mkdirSync(path.join(empty, 'runtime'), { recursive: true })
  const e = readClassroomInfo(empty)
  eq('教室标识 · 缺 classroom.yaml 时 id 退回目录名', e.id, 'empty-classroom')
}

// 收尾
fs.rmSync(root, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
