// test/animation.test.mjs — ANIM-ORCH（教学动画异步编排）的单测（node --test，零 LLM 成本、零真渲染）
//
// 覆盖三层：
//   ① lib/animation.mjs 的**纯函数**（预检 / LaTeX 判据 / 任务号 / 索引 / 状态文案）
//   ② lib/manifest.mjs 新增的顶层 `animation:` 段（在场 / 缺席 / false / 多写键 → 报错）
//   ③ lib/animationstore.mjs 的**编排主体**（起任务不阻塞 / 状态从盘上读 / 就绪通报幂等 / 判死）
//
// 🔴 全部用**注入的 IO 与 spawn**，不真起 manim、不写任何教室真文件（临时目录）。
// 运行：/opt/homebrew/bin/node --test test/animation.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ANIMATION_STATES,
  appendIndexRow,
  animationTaskId,
  checkAnimationArgs,
  describeState,
  findLatexUse,
  findSceneClass,
  renderIndexHeader,
  renderIndexRow,
  uniqueTaskId,
} from '../lib/animation.mjs'
import { parseManifest } from '../lib/manifest.mjs'
import {
  animationNoticeSource,
  buildAnimationNotice,
  checkAnimationRuntime,
  listTasks,
  markAnnounced,
  pendingNotices,
  runningTasks,
  settleRunningTasks,
  startAnimationTask,
  summarizeTasks,
} from '../lib/animationstore.mjs'

// ── 测试替身 ────────────────────────────────────────────────────────────────

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

/** 假 spawn：记下命令，返回一个 pid，不真起进程。 */
function fakeSpawn(log) {
  return (cmd, args, opts) => {
    log.push({ cmd, args, opts })
    return { pid: 4242, unref() {} }
  }
}

/** 本仓库根，供自检用例指向真实闸门脚本。
 * 🔴 主仓布局本地化（批次②接线 + 复审修正）：闸门工具已从研究源的旧位置
 *   收拢到**主仓根 `tools/animation-gate/`**（评审要求，避免把旧研究工作区的 `code/`
 *   包装带进主仓）。`toolRoot()` ＝ 仓库根自身
 *   （`..`×3，从 `plugins/socratic-engine/test` 上行到仓库根），指向仓库内的
 *   `tools/animation-gate/animation_gate.py`。只改解析层数／路径，不改
 *   「指向真实闸门脚本」这一语义。 */
function toolRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}

function tmpDir(prefix = 'anim-test-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

const GOOD_SCRIPT = [
  'from manim import *',
  '',
  'class FifoBlocking(Scene):',
  '    def construct(self):',
  '        t = Text("FIFO：长任务堵住短任务", font="PingFang SC")',
  '        self.play(Write(t))',
  '        self.wait(1)',
].join('\n')

// ── ① 纯函数层 ──────────────────────────────────────────────────────────────

test('动画预检：合法脚本通过，并认出 Scene 子类与行数', () => {
  const r = checkAnimationArgs({ script: GOOD_SCRIPT, title: '长任务堵住短任务' })
  assert.equal(r.ok, true, JSON.stringify(r.problems))
  assert.equal(r.sceneClass, 'FifoBlocking')
  assert.equal(r.lines, 7)
})

test('动画预检：空脚本 / 围栏 / 没有 Scene 类 → 各自报错（一次报全）', () => {
  const r = checkAnimationArgs({ script: '```python\nx = 1\n```', title: 't' })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => p.includes('Scene 子类')), r.problems.join('|'))
  assert.ok(r.problems.some((p) => p.includes('围栏')), r.problems.join('|'))
})

test('动画预检：title 必填且单行；caption 超长报错', () => {
  const noTitle = checkAnimationArgs({ script: GOOD_SCRIPT })
  assert.ok(noTitle.problems.some((p) => p.includes('title 必填')))
  const longCaption = checkAnimationArgs({ script: GOOD_SCRIPT, title: 't', caption: 'x'.repeat(501) })
  assert.ok(longCaption.problems.some((p) => p.includes('caption 过长')))
})

test('动画预检：脚本超行数上限 → 报错（不截断）', () => {
  const r = checkAnimationArgs({ script: `${GOOD_SCRIPT}\n${'pass\n'.repeat(400)}`, title: 't' })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => p.includes('行 > 上限')), r.problems.join('|'))
})

test('findSceneClass：多个类时取最后一个 Scene 子类；非 Scene 类不算', () => {
  const src = ['class Helper:', '    pass', '', 'class A(Scene):', '    pass', 'class B(Scene):', '    pass'].join('\n')
  assert.equal(findSceneClass(src), 'B')
  assert.equal(findSceneClass('class Helper:\n    pass'), null)
})

test('LaTeX 判据：Tex/MathTex 命中；注释与字符串里的提及不命中', () => {
  assert.equal(findLatexUse('x = MathTex(r"a^2")')?.name, 'MathTex')
  assert.equal(findLatexUse('# 不要用 Tex( ) 这类写法'), null)
  assert.equal(findLatexUse('t = Text("不要用 MathTex() 哦")'), null)
})

test('LaTeX 判据：NumberLine 只在带 include_numbers / elongated ticks 时命中（PoC 踩过的那一条）', () => {
  assert.equal(findLatexUse('nl = NumberLine(x_range=[0, 10])'), null)
  assert.equal(findLatexUse('nl = NumberLine(x_range=[0, 10], include_numbers=True)')?.name, 'NumberLine')
  assert.equal(
    findLatexUse('nl = NumberLine(x_range=[0, 10], numbers_with_elongated_ticks=[0])')?.name,
    'NumberLine',
  )
})

test('任务号：讲次/回合/时间戳拼装；缺讲次用 Lxx', () => {
  const at = new Date(2026, 8, 24, 13, 5, 7).getTime() // 2026-09-24 13:05:07 本地
  assert.equal(animationTaskId({ lesson: 3, turn: 2, at }), 'L03-T02-20260924-130507')
  assert.equal(animationTaskId({ lesson: null, turn: 11, at }), 'Lxx-T11-20260924-130507')
})

test('任务号冲突：加 -2 / -3 后缀', () => {
  const taken = new Set(['L01-T01-x', 'L01-T01-x-2'])
  assert.equal(uniqueTaskId('L01-T01-x', (c) => taken.has(c)), 'L01-T01-x-3')
  assert.equal(uniqueTaskId('L01-T01-y', (c) => taken.has(c)), 'L01-T01-y')
})

test('索引：表头 + 数据行；管道符被转义；空索引自动打底', () => {
  const row = renderIndexRow({
    timeLabel: '2026-09-24 13:05',
    lesson: 3,
    turn: 2,
    state: 'ready',
    title: 'a|b',
    caption: '',
    artifact: 'L03-T02-20260924-130507/L03-T02-20260924-130507.mp4',
  })
  const text = appendIndexRow(null, row)
  assert.ok(text.startsWith(renderIndexHeader()))
  assert.ok(text.includes('a\\|b'))
  assert.ok(text.trimEnd().endsWith('`L03-T02-20260924-130507/L03-T02-20260924-130507.mp4` |'))
})

test('状态文案：六态都有话说；blocked/failed 带原因', () => {
  for (const s of ANIMATION_STATES) assert.equal(typeof describeState(s), 'string')
  assert.ok(describeState('blocked', { reason: '文字重叠' }).includes('文字重叠'))
  assert.ok(describeState('ready').includes('可以播'))
})

// ── ② manifest 的 animation 段 ──────────────────────────────────────────────

const MANIFEST_BASE = `format: socratic-classroom/0
classroom:
  id: t
  title: T
phases:
  - { id: open, name: 开场 }
blocks:
  - id: a
    text: hello
    position: { target: chat, order: 1 }
    frequency: { every: turn }
`

test('manifest：无 animation 段 → 结果里**没有** animation 键（老教室形状逐字不变）', () => {
  const m = parseManifest(MANIFEST_BASE)
  assert.equal('animation' in m, false)
})

test('manifest：animation: {enabled: true} → 挂上；enabled: false → 也挂上但为 false', () => {
  const on = parseManifest(`${MANIFEST_BASE}animation: {enabled: true}\n`)
  assert.deepEqual(on.animation, { enabled: true })
  const off = parseManifest(`${MANIFEST_BASE}animation: {enabled: false}\n`)
  assert.deepEqual(off.animation, { enabled: false })
  // 只写 `animation:`（空值）→ 段在场即视为要动画
  const bare = parseManifest(`${MANIFEST_BASE}animation:\n  enabled: true\n`)
  assert.deepEqual(bare.animation, { enabled: true })
})

test('manifest：animation 段写错（多键 / 非映射 / enabled 非布尔）→ 报错，不静默忽略', () => {
  assert.throws(() => parseManifest(`${MANIFEST_BASE}animation: {enabled: true, path: /x}\n`), /无法识别的键/)
  assert.throws(() => parseManifest(`${MANIFEST_BASE}animation: [1,2]\n`), /必须是映射/)
  assert.throws(() => parseManifest(`${MANIFEST_BASE}animation: {enabled: "yes"}\n`), /必须是布尔值/)
})

// ── ③ 编排主体（落盘 + 起进程 + 状态 + 通报 + 判死）───────────────────────────

async function startOne(runtimeDir, extra = {}) {
  const spawned = []
  const result = await startAnimationTask(
    { script: GOOD_SCRIPT, title: '长任务堵住短任务' },
    {
      runtimeDir,
      lesson: 3,
      turn: 2,
      python: '/fake/python',
      manim: '/fake/manim',
      io: realIo,
      spawn: fakeSpawn(spawned),
      now: () => new Date(2026, 8, 24, 13, 5, 7).getTime(),
      ...extra,
    },
  )
  return { result, spawned }
}

test('起任务：落盘脚本与任务事实、起 detached 渲染器、**立刻**返回 queued', async () => {
  const dir = tmpDir()
  const { result, spawned } = await startOne(dir)
  assert.equal(result.state, 'queued')
  assert.equal(result.taskId, 'L03-T02-20260924-130507')
  assert.equal(result.waitedMs, undefined, '默认路径不许阻塞等待')
  assert.ok(existsSync(join(result.dir, 'scene.py')))
  assert.ok(existsSync(join(result.dir, 'task.json')))
  // 脚本逐字落盘（不补不删）
  assert.equal(readFileSync(join(result.dir, 'scene.py'), 'utf8'), GOOD_SCRIPT)
  // 起了渲染器：detached + unref；stdout/stderr 接到 runner.log 的文件描述符（不是 'ignore'——
  // 渲染器死在 main 之前时，原因只在那份日志里；实测踩过一次语法错误被吞掉）
  assert.equal(spawned.length, 1)
  assert.equal(spawned[0].cmd, '/fake/python')
  assert.equal(spawned[0].opts.detached, true)
  assert.equal(spawned[0].opts.stdio[0], 'ignore')
  assert.equal(typeof spawned[0].opts.stdio[1], 'number', 'stdout 必须接到 runner.log 的 fd')
  assert.equal(spawned[0].opts.stdio[1], spawned[0].opts.stdio[2], 'stdout/stderr 同一份日志')
  assert.ok(spawned[0].args.includes('--scene-class'))
  assert.ok(spawned[0].args.includes('FifoBlocking'))
  // 索引追加了一行
  const index = readFileSync(join(dir, 'animations', 'index.md'), 'utf8')
  assert.ok(index.includes(result.taskId))
})

test('起任务：预检不过 → 抛错，且**什么都没落盘**、渲染器没起', async () => {
  const dir = tmpDir()
  const spawned = []
  await assert.rejects(
    () =>
      startAnimationTask(
        { script: 'x = MathTex("a")', title: 't' },
        { runtimeDir: dir, lesson: 1, turn: 1, python: '/p', manim: '/m', io: realIo, spawn: fakeSpawn(spawned) },
      ),
    /LaTeX|latex/,
  )
  assert.equal(spawned.length, 0)
  assert.equal(existsSync(join(dir, 'animations')), false)
})

test('起任务：并发上限——已有 1 个在跑时还能起，2 个时拒绝', async () => {
  const dir = tmpDir()
  await startOne(dir)
  const second = await startOne(dir, { now: () => new Date(2026, 8, 24, 13, 5, 8).getTime() })
  assert.equal(second.result.state, 'queued')
  // 两个"在跑"（pid 4242 其实不存在，但心跳是刚写的 → 判活）
  await assert.rejects(
    () => startOne(dir, { now: () => new Date(2026, 8, 24, 13, 5, 9).getTime() }),
    /已经有 2 段动画在渲染中/,
  )
})

test('状态从盘上读：渲染器写 ready → pendingNotices 命中 → 标记后不再重复', async () => {
  const dir = tmpDir()
  const { result } = await startOne(dir)
  writeFileSync(
    join(result.dir, 'status.json'),
    JSON.stringify({ state: 'ready', mp4: `${result.taskId}.mp4`, durationSec: 12.5, bytes: 300000, heartbeatAt: Date.now() }),
  )
  const pending = await pendingNotices(join(dir, 'animations'))
  assert.equal(pending.length, 1)
  assert.equal(pending[0].status.state, 'ready')
  await markAnnounced(result.dir, { io: realIo })
  assert.equal((await pendingNotices(join(dir, 'animations'))).length, 0, '播报一次后不得重复通报')
})

test('通报文案：ready 说"现在就放"；blocked/failed 明说"不许播"并给出出路', () => {
  const rec = (state, reason) => ({
    taskId: 'L03-T02-x',
    dir: '/tmp/anim-x',
    task: { taskId: 'L03-T02-x', lesson: 3, turn: 2, title: '标题' },
    status: { state, reason, durationSec: 12.5, bytes: 300000, mp4: 'x.mp4' },
  })
  const ready = buildAnimationNotice(rec('ready', null))
  assert.ok(ready.includes('现在就'))
  const blocked = buildAnimationNotice(rec('blocked', '闸门判 BLOCK：2 处'))
  assert.ok(blocked.includes('不要放这段片子'))
  assert.ok(blocked.includes('闸门判 BLOCK：2 处'))
  const failed = buildAnimationNotice(rec('failed', 'manim 退出码 1'))
  assert.ok(failed.includes('没有可播的片子'))
  assert.equal(buildAnimationNotice(null), null)
})

test('通报的机器可读来源字段：客户端靠它找片子，不解析中文正文', () => {
  const src = animationNoticeSource({
    taskId: 'L03-T02-x',
    dir: '/tmp/classroom/runtime/animations/L03-T02-x',
    task: { taskId: 'L03-T02-x', lesson: 3, turn: 2, title: '标题' },
    status: { state: 'ready', durationSec: 12.5, mp4: 'L03-T02-x.mp4' },
  })
  assert.equal(src.kind, 'socratic-engine')
  assert.equal(src.form, 'animation-notice')
  assert.equal(src.block, 'animation-notice:L03-T02-x')
  assert.equal(src.state, 'ready')
  assert.equal(src.artifact, 'animations/L03-T02-x/L03-T02-x.mp4')
  assert.equal(src.absPath, '/tmp/classroom/runtime/animations/L03-T02-x/L03-T02-x.mp4')
  assert.equal(src.title, '标题')
  assert.equal(src.lesson, 3)
  assert.equal(src.durationSec, 12.5)
})

test('判死：pid 不存在且心跳停 >60 s → 前推 failed；心跳新 → 仍算在跑', async () => {
  const dir = tmpDir()
  const { result } = await startOne(dir)
  const root = join(dir, 'animations')
  const now = Date.now()
  // ① 心跳刚写（渲染器"活着"）→ 不动它
  writeFileSync(
    join(result.dir, 'status.json'),
    JSON.stringify({ state: 'rendering', runnerPid: 4242, heartbeatAt: now }),
  )
  let r = await settleRunningTasks(root, { now: () => now, io: realIo })
  assert.equal(r.settled.length, 0)
  assert.equal(r.running.length, 1)
  assert.equal((await runningTasks(root, { now: () => now })).length, 1)

  // ② 心跳停在 5 分钟前且 pid 不在 → 判死并落盘原因
  writeFileSync(
    join(result.dir, 'status.json'),
    JSON.stringify({ state: 'rendering', runnerPid: 999999, heartbeatAt: now - 300000 }),
  )
  r = await settleRunningTasks(root, { now: () => now, io: realIo })
  assert.equal(r.settled.length, 1)
  const after = JSON.parse(readFileSync(join(result.dir, 'status.json'), 'utf8'))
  assert.equal(after.state, 'failed')
  assert.ok(after.reason.includes('渲染器进程已消失'))
  assert.equal(after.settledBy, 'engine')
  assert.equal((await runningTasks(root, { now: () => now })).length, 0)
})

test('listTasks / summarizeTasks：读得回全部任务并按状态计数', async () => {
  const dir = tmpDir()
  const a = await startOne(dir)
  const b = await startOne(dir, { now: () => new Date(2026, 8, 24, 13, 5, 8).getTime() })
  writeFileSync(join(a.result.dir, 'status.json'), JSON.stringify({ state: 'ready' }))
  writeFileSync(join(b.result.dir, 'status.json'), JSON.stringify({ state: 'blocked', reason: 'x' }))
  const tasks = await listTasks(join(dir, 'animations'))
  assert.equal(tasks.length, 2)
  const s = summarizeTasks(tasks)
  assert.equal(s.total, 2)
  assert.equal(s.byState.ready, 1)
  assert.equal(s.byState.blocked, 1)
  assert.equal(s.pendingNotice, 2)
})

test('装载期自检：可执行文件缺失 / 渲染器语法错 → 逐条报出来（不留到课堂上才炸）', () => {
  // 真环境：本机 /bin/sh 一定在；用一个绝对不存在的路径当 manim
  const bad = checkAnimationRuntime({ python: '/bin/sh', manim: '/nope/does-not-exist' }, () => {})
  assert.equal(bad.ok, false)
  assert.ok(bad.problems.some((p) => p.includes('animation.manim 不存在')), bad.problems.join('|'))

  // 渲染器语法：让注入的 exec 抛错（等价于 python 解析失败），错误原文要带进 problems
  const syntax = checkAnimationRuntime(
    { python: '/bin/sh', manim: '/bin/sh' },
    () => {
      const e = new Error('Command failed')
      e.stderr = Buffer.from('SyntaxError: invalid syntax')
      throw e
    },
  )
  assert.equal(syntax.ok, false)
  assert.ok(syntax.problems.some((p) => p.includes('SyntaxError')), syntax.problems.join('|'))

  // 闸门是 `.py`，由 python 读进去跑 → **只要求可读，不要求可执行位**
  // （实测踩过：判据写成 X_OK 会让一个完全正常的闸门把装载挡在门外）
  const gateOk = checkAnimationRuntime(
    { python: '/bin/sh', manim: '/bin/sh', gate: join(toolRoot(), 'tools', 'animation-gate', 'animation_gate.py') },
    () => {},
  )
  assert.equal(gateOk.ok, true, gateOk.problems.join('|'))

  // 全绿：两个可执行文件都在 + 渲染器解析通过（注入 exec 不抛）
  const ok = checkAnimationRuntime({ python: '/bin/sh', manim: '/bin/sh' }, () => {})
  assert.equal(ok.ok, true, ok.problems.join('|'))
})

test('startAnimationTask 的同步对照模式（blocking）：等渲染器写出终态才返回', async () => {
  const dir = tmpDir()
  let written = null
  const spawn = (cmd, args) => {
    // 假装渲染器：0.3 s 后写出 ready
    const taskDir = args[args.indexOf('--task-dir') + 1]
    written = taskDir
    setTimeout(() => {
      mkdirSync(taskDir, { recursive: true })
      writeFileSync(join(taskDir, 'status.json'), JSON.stringify({ state: 'ready', mp4: 'x.mp4' }))
    }, 300)
    return { pid: 4242, unref() {} }
  }
  const result = await startAnimationTask(
    { script: GOOD_SCRIPT, title: 't' },
    { runtimeDir: dir, lesson: 1, turn: 1, python: '/p', manim: '/m', io: realIo, spawn, blocking: true },
  )
  assert.equal(result.state, 'ready')
  assert.ok(result.waitedMs >= 200, `waitedMs=${result.waitedMs}`)
  assert.ok(written !== null)
})
