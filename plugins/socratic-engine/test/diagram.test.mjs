// test/diagram.test.mjs — T3a「画图工具」单测：classroom_draw 的三段（结构校验 → 真解析 → 落盘）。
//
// 覆盖（任务书交付物 ②）：
//   · 正常：12 种图类型的源码通过结构校验；真解析器解析通过；文件落盘；索引追加。
//   · 非法入参**报错**（不静默）：空内容／超长（不截断）／markdown 围栏／图类型关键字对不上／
//     只有关键字没有内容／字符拼的示意图／括号不配平／引号未闭合／title 多行或超长／caption 超长。
//   · 落盘：文件内容＝源码原文（只补行尾换行）；索引首次建表头、之后只追加；rows 计数。
//   · 真解析不可用 → **报错**（不降级放行）：worker 起不来时 parse 必须 reject。
//
// 纪律：不调 LLM、不起宿主、不碰真实教室目录、不碰 $DSH_HOME（教室副本建在 mkdtemp 里）。
// 运行：/opt/homebrew/bin/node test/diagram.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, rename, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import {
  DIAGRAM_KIND_IDS,
  MAX_SOURCE_CHARS,
  appendIndexRow,
  checkDiagramArgs,
  diagramFileName,
  findUnbalancedBracket,
  renderIndexHeader,
  renderIndexRow,
  uniqueFileName,
} from '../lib/diagram.mjs'
import { drawDiagram, saveDiagram } from '../lib/diagramstore.mjs'
import { createMermaidParser } from '../lib/mermaid-parse.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------- 测试替身

/** 与宿主 writeFileAtomic 同算法：wx 独占创建临时文件 → rename 覆盖（同 postclass.test.mjs）。 */
async function writeFileAtomic(filename, content, options) {
  await mkdir(dirname(filename), { recursive: true })
  const temp = `${filename}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, content, { mode: options?.mode, flag: 'wx' })
    await rename(temp, filename)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

const fakeIo = { writeFileAtomic, withFileLock: (_filename, operation) => operation() }

/** 固定的时间戳（文件名与索引行都可预测）。 */
const AT = new Date(2026, 8, 24, 10, 15, 30).getTime() // 2026-09-24 10:15:30
const NOW = () => AT

/** 每种图类型一份**真实可解析**的最小源码（真解析用例直接复用）。 */
const SAMPLES = {
  flowchart: 'flowchart TD\n  A[进程A] --> B{被切走?}\n  B -->|是| C[内核保存状态]\n',
  sequence: 'sequenceDiagram\n  participant A as 进程A\n  participant K as 内核\n  A->>K: 系统调用\n  K-->>A: 返回\n',
  state: 'stateDiagram-v2\n  [*] --> 就绪\n  就绪 --> 运行: 获得CPU\n  运行 --> [*]\n',
  class: 'classDiagram\n  class 进程 { +int pid }\n  进程 <|-- 线程\n',
  er: 'erDiagram\n  进程 ||--o{ 打开文件 : 持有\n',
  gantt: 'gantt\n  title 时间片\n  dateFormat YYYY-MM-DD\n  section 轮转\n  进程A :a1, 2026-09-24, 1d\n',
  pie: 'pie title 时间占比\n  "A" : 60\n  "B" : 40\n',
  mindmap: 'mindmap\n  root((两个程序不捣乱))\n    时分共享\n    地址隔离\n',
  journey: 'journey\n  title 一次切换\n  section 内核\n    保存A: 5: 内核\n',
  timeline: 'timeline\n  title 进程一生\n  2026 : 就绪 : 运行\n',
  gitgraph: 'gitGraph\n  commit\n  branch dev\n  commit\n  checkout main\n  merge dev\n',
  quadrant: 'quadrantChart\n  title 机制归类\n  x-axis 快 --> 慢\n  y-axis 内核管 --> 用户管\n  quadrant-1 特权\n  A: [0.3, 0.6]\n',
}

/** 建一个空的教室副本目录（含 runtime/）。 */
async function makeRuntimeDir() {
  const dir = await mkdtemp(join(tmpdir(), 't3a-runtime-'))
  await mkdir(join(dir, 'runtime'), { recursive: true })
  return dir
}

/** 列目录（不存在时返回空数组，供"什么都没落盘"的断言用）。 */
async function listDir(dir) {
  try {
    return await readdir(dir)
  } catch (cause) {
    if (cause?.code === 'ENOENT') return []
    throw cause
  }
}

// ---------------------------------------------------------------- ① 结构校验

test('结构校验：12 种图类型的合法源码全部通过，且 problems 为空', () => {
  for (const kind of DIAGRAM_KIND_IDS) {
    const check = checkDiagramArgs({ kind, source: SAMPLES[kind], title: '标题' })
    assert.equal(check.ok, true, `${kind} 应当通过：${check.problems.join(' / ')}`)
    assert.deepEqual(check.problems, [])
    assert.equal(check.kind, kind)
  }
  assert.equal(DIAGRAM_KIND_IDS.length, Object.keys(SAMPLES).length)
})

test('结构校验：kind 缺失 → 报错并列出全部可用值', () => {
  const check = checkDiagramArgs({ source: SAMPLES.flowchart })
  assert.equal(check.ok, false)
  assert.match(check.problems.join('\n'), /kind 必填/)
  for (const kind of DIAGRAM_KIND_IDS) assert.match(check.problems.join('\n'), new RegExp(kind))
})

test('结构校验：kind 不在枚举内 → 报错（不静默当成 flowchart）', () => {
  const check = checkDiagramArgs({ kind: 'sequenceDiagram', source: SAMPLES.sequence })
  assert.equal(check.ok, false)
  assert.match(check.problems.join('\n'), /不是支持的图类型/)
})

test('结构校验：source 为空 / 纯空白 / 非字符串 → 报错，且说清期望什么', () => {
  for (const source of ['', '   \n\t ', undefined, 42]) {
    const check = checkDiagramArgs({ kind: 'flowchart', source })
    assert.equal(check.ok, false)
    assert.match(check.problems.join('\n'), /source 为空/)
    assert.match(check.problems.join('\n'), /完整的 mermaid 源码正文/)
  }
})

test('结构校验：source 超长 → 报错（🔴 不截断，源码原样留在返回值里）', () => {
  const long = `flowchart TD\n${'  A --> B\n'.repeat(4000)}`
  assert.ok(long.length > MAX_SOURCE_CHARS)
  const check = checkDiagramArgs({ kind: 'flowchart', source: long })
  assert.equal(check.ok, false)
  assert.match(check.problems.join('\n'), /source 过长/)
  assert.match(check.problems.join('\n'), /引擎不截断/)
  assert.equal(check.source.length, long.length) // 一个字都没被切掉
})

test('结构校验：source 带 markdown 围栏 → 报错（落盘的是源码正文，围栏会原样写进文件）', () => {
  const check = checkDiagramArgs({ kind: 'flowchart', source: '```mermaid\nflowchart TD\n A --> B\n```\n' })
  assert.equal(check.ok, false)
  assert.match(check.problems.join('\n'), /markdown 围栏/)
})

test('结构校验：首行关键字与 kind 对不上 → 报错并写出期望的关键字', () => {
  const check = checkDiagramArgs({ kind: 'sequence', source: SAMPLES.flowchart })
  assert.equal(check.ok, false)
  assert.match(check.problems.join('\n'), /图类型关键字对不上/)
  assert.match(check.problems.join('\n'), /"sequenceDiagram"/)
})

test('结构校验：首行前允许空行与 %% 注释（关键字仍被认出来）', () => {
  const check = checkDiagramArgs({ kind: 'flowchart', source: '%% 本讲第 1 张图\n\nflowchart TD\n  A --> B\n' })
  assert.equal(check.ok, true, check.problems.join(' / '))
  assert.equal(check.header, 'flowchart TD')
})

test('结构校验：只有图类型关键字、没有任何内容 → 报错', () => {
  const check = checkDiagramArgs({ kind: 'flowchart', source: 'flowchart TD\n\n%% 只有注释\n' })
  assert.equal(check.ok, false)
  assert.match(check.problems.join('\n'), /图里没有任何内容/)
})

test('结构校验：字符拼的示意图（制表符边框）→ 报错，并指出去用 mermaid 重画', () => {
  const ascii = ['flowchart TD', '  ┌──────┐', '  │ 进程A │', '  └──────┘'].join('\n')
  const check = checkDiagramArgs({ kind: 'flowchart', source: ascii })
  assert.equal(check.ok, false)
  assert.match(check.problems.join('\n'), /制表符边框字符/)
  assert.match(check.problems.join('\n'), /mermaid 语法把图重画/)
})

test('结构校验：括号不配平 → 报错并带行号', () => {
  const check = checkDiagramArgs({ kind: 'flowchart', source: 'flowchart TD\n  A[进程A --> B\n' })
  assert.equal(check.ok, false)
  assert.match(check.problems.join('\n'), /第 2 行/)
  assert.match(check.problems.join('\n'), /括号不配平/)
})

test('结构校验：引号未闭合 → 报错（不许当成合法标签）', () => {
  const check = checkDiagramArgs({ kind: 'flowchart', source: 'flowchart TD\n  A["进程A] --> B\n' })
  assert.equal(check.ok, false)
  assert.match(check.problems.join('\n'), /引号/)
})

test('结构校验：ER 图的基数记号（`o{` / `}o`）不参与配平（实测踩过的假阳性）', () => {
  const er = 'erDiagram\n  进程 ||--o{ 打开文件 : 持有\n  打开文件 }o--|| 磁盘 : 位于\n'
  const check = checkDiagramArgs({ kind: 'er', source: er })
  assert.equal(check.ok, true, check.problems.join(' / '))
  // 但 ER 图里的圆括号/方括号仍要配平
  assert.equal(checkDiagramArgs({ kind: 'er', source: 'erDiagram\n  A ||--o{ B : 持有(x\n' }).ok, false)
})

test('结构校验：note / title / %% 自由文本行里的括号不参与配平（不误报）', () => {
  const seq = 'sequenceDiagram\n  Note over A: 这一半（内存）不是靠用户态\n  A->>B: ok\n'
  assert.equal(checkDiagramArgs({ kind: 'sequence', source: seq }).ok, true)
  const state = 'stateDiagram-v2\n  note right of A\n    内存隔离不是靠"用户态"这个名字（见教材）\n  end note\n  [*] --> A\n'
  assert.equal(checkDiagramArgs({ kind: 'state', source: state }).ok, true)
  const pie = 'pie title 时间占比（大致）\n  "A" : 60\n'
  assert.equal(checkDiagramArgs({ kind: 'pie', source: pie }).ok, true)
})

test('括号配平：纯函数对配平/不配平/引号内的括号给出确定结果', () => {
  assert.equal(findUnbalancedBracket(['A --> B']), null)
  assert.equal(findUnbalancedBracket(['A["a (b)"] --> B']), null)
  assert.match(findUnbalancedBracket(['A[未闭合']), /没有闭合/)
  assert.match(findUnbalancedBracket(['A] --> B']), /没有对应的/)
  assert.match(findUnbalancedBracket(['A --> B["未闭合引号]']), /引号/)
})

test('结构校验：title 多行 / 超长，caption 超长 → 报错；正常值被 trim', () => {
  const multi = checkDiagramArgs({ kind: 'flowchart', source: SAMPLES.flowchart, title: '第一行\n第二行' })
  assert.equal(multi.ok, false)
  assert.match(multi.problems.join('\n'), /title 必须是单行/)

  const longTitle = checkDiagramArgs({ kind: 'flowchart', source: SAMPLES.flowchart, title: '标'.repeat(121) })
  assert.equal(longTitle.ok, false)
  assert.match(longTitle.problems.join('\n'), /title 过长/)

  const longCaption = checkDiagramArgs({ kind: 'flowchart', source: SAMPLES.flowchart, caption: '说'.repeat(501) })
  assert.equal(longCaption.ok, false)
  assert.match(longCaption.problems.join('\n'), /caption 过长/)

  const trimmed = checkDiagramArgs({ kind: 'flowchart', source: SAMPLES.flowchart, title: '  两个程序  ' })
  assert.equal(trimmed.title, '两个程序')
})

test('结构校验：多个问题一次报全（模型一轮就能改完）', () => {
  const check = checkDiagramArgs({ kind: 'flowchart', source: '```\nsequenceDiagram\n  A->>B: x\n```\n', title: 'a\nb' })
  assert.equal(check.ok, false)
  assert.ok(check.problems.length >= 3, `期望一次报全，实际 ${check.problems.length} 条`)
})

// ---------------------------------------------------------------- ② 文件名与索引

test('文件名：含讲次 / 回合 / 时间戳 / 图类型，无讲次时写 Lxx', () => {
  assert.equal(
    diagramFileName({ lesson: 1, turn: 3, at: AT, kind: 'flowchart' }),
    'L01-T03-20260924-101530-flowchart.mmd',
  )
  assert.equal(diagramFileName({ lesson: 12, turn: 40, at: AT, kind: 'state' }), 'L12-T40-20260924-101530-state.mmd')
  assert.equal(diagramFileName({ lesson: null, turn: 1, at: AT, kind: 'pie' }), 'Lxx-T01-20260924-101530-pie.mmd')
})

test('文件名去重：同名已存在时依次加 -2 / -3 后缀', () => {
  const taken = new Set(['L01-T01-20260924-101530-flowchart.mmd', 'L01-T01-20260924-101530-flowchart-2.mmd'])
  const name = uniqueFileName('L01-T01-20260924-101530-flowchart.mmd', (c) => taken.has(c))
  assert.equal(name, 'L01-T01-20260924-101530-flowchart-3.mmd')
  assert.equal(uniqueFileName('新图.mmd', () => false), '新图.mmd')
})

test('索引：表头字段固定，行里标题的竖线被转义、空标题有占位', () => {
  const header = renderIndexHeader()
  assert.match(header, /^# 板书图索引/)
  assert.match(header, /\| 日期 \| 讲次 \| 回合 \| 图类型 \| 标题 \| 说明 \| 源文件 \|/)
  const row = renderIndexRow({
    timeLabel: '2026-09-24 10:15',
    lesson: 1,
    turn: 3,
    kind: 'flowchart',
    title: 'A | B',
    file: 'L01-T03-x-flowchart.mmd',
  })
  assert.equal(row, '| 2026-09-24 10:15 | 第 1 讲 | 3 | flowchart | A \\| B | — | `L01-T03-x-flowchart.mmd` |')
  assert.match(
    renderIndexRow({ timeLabel: 't', lesson: null, turn: 1, kind: 'pie', title: '', file: 'f.mmd' }),
    /（未给标题）/,
  )
})

test('索引：caption 落进"说明"列（换行折成空格、竖线转义、空说明占位）', () => {
  const withCaption = renderIndexRow({
    timeLabel: 't', lesson: 1, turn: 1, kind: 'flowchart', title: '标题',
    caption: '把"不捣乱"拆成两层\n第一层今天讲 | 第二层后面讲', file: 'f.mmd',
  })
  assert.match(withCaption, /拆成两层 第一层今天讲 \\| 第二层后面讲/)
  const noCaption = renderIndexRow({ timeLabel: 't', lesson: 1, turn: 1, kind: 'pie', title: '标题', file: 'f.mmd' })
  assert.match(noCaption, /\| 标题 \| — \|/, '空说明应占位')
})

test('索引：首次追加带表头，之后只追加数据行（不重复表头）', () => {
  const first = appendIndexRow(null, '| 行1 |')
  assert.match(first, /^# 板书图索引/)
  assert.equal(first.split('\n').filter((l) => l.startsWith('| 日期 ')).length, 1)
  const second = appendIndexRow(first, '| 行2 |')
  assert.equal(second.split('\n').filter((l) => l.startsWith('| 日期 ')).length, 1)
  assert.match(second, /\| 行1 \|\n\| 行2 \|\n$/)
})

// ---------------------------------------------------------------- ③ 落盘

test('落盘：源文件内容＝源码原文（只补行尾换行），索引追加一行，rows=1', async (t) => {
  const runtimeDir = await makeRuntimeDir()
  t.after(() => rm(runtimeDir, { recursive: true, force: true }))

  const saved = await saveDiagram(
    {
      ...checkDiagramArgs({ kind: 'flowchart', source: SAMPLES.flowchart, title: '两个程序' }),
      caption: '第 1 讲题眼',
      lesson: 1,
      turn: 3,
    },
    { runtimeDir, io: fakeIo, now: NOW },
  )
  assert.equal(saved.file, 'diagrams/L01-T03-20260924-101530-flowchart.mmd')
  assert.equal(saved.indexFile, 'diagrams/index.md')
  // SAMPLES.flowchart 本身已以换行结尾 → 落盘内容与源码**逐字相同**
  assert.equal(await readFile(saved.filePath, 'utf8'), SAMPLES.flowchart)
  assert.equal(saved.rows, 1)

  const index = await readFile(saved.indexPath, 'utf8')
  assert.match(index, /^# 板书图索引/)
  assert.match(
    index,
    /\| 2026-09-24 10:15 \| 第 1 讲 \| 3 \| flowchart \| 两个程序 \| 第 1 讲题眼 \| `L01-T03-20260924-101530-flowchart\.mmd` \|/,
  )
})

test('落盘：同一分钟连画两张 → 两个文件、索引两行（都留着，不覆盖）', async (t) => {
  const runtimeDir = await makeRuntimeDir()
  t.after(() => rm(runtimeDir, { recursive: true, force: true }))

  const first = await saveDiagram(
    { kind: 'flowchart', source: SAMPLES.flowchart, title: '第一张', caption: '', lesson: 1, turn: 1 },
    { runtimeDir, io: fakeIo, now: NOW },
  )
  const second = await saveDiagram(
    { kind: 'state', source: SAMPLES.state, title: '第二张', caption: '', lesson: 1, turn: 1 },
    { runtimeDir, io: fakeIo, now: NOW },
  )
  assert.notEqual(first.file, second.file)
  assert.equal(second.rows, 2)
  const files = (await listDir(join(runtimeDir, 'diagrams'))).filter((f) => f.endsWith('.mmd'))
  assert.equal(files.length, 2)
})

test('落盘：缺 runtimeDir → 抛错（不写进当前工作目录）', async () => {
  await assert.rejects(
    () => saveDiagram({ kind: 'flowchart', source: SAMPLES.flowchart, title: '', caption: '', lesson: 1, turn: 1 }, { io: fakeIo }),
    /需要 runtimeDir/,
  )
})

// ---------------------------------------------------------------- ④ 编排（drawDiagram）

/** 记录调用次数的假解析器。 */
function fakeParser(result = { diagramType: 'flowchart-v2' }) {
  const calls = []
  return {
    calls,
    parse: async (source) => {
      calls.push(source)
      if (result instanceof Error) throw result
      return result
    },
  }
}

test('编排：成功 → 返回落盘信息；解析器收到的是**原样**源码', async (t) => {
  const runtimeDir = await makeRuntimeDir()
  t.after(() => rm(runtimeDir, { recursive: true, force: true }))
  const parser = fakeParser({ diagramType: 'flowchart-v2' })

  const result = await drawDiagram(
    { kind: 'flowchart', source: SAMPLES.flowchart, title: '两个程序为什么不会互相捣乱' },
    { runtimeDir, lesson: 1, turn: 2, parser, io: fakeIo, now: NOW },
  )
  assert.equal(result.kind, 'flowchart')
  assert.equal(result.diagramType, 'flowchart-v2')
  assert.equal(result.lesson, 1)
  assert.equal(result.turn, 2)
  assert.equal(result.rows, 1)
  assert.equal(result.time, '2026-09-24 10:15')
  assert.equal(parser.calls.length, 1)
  assert.equal(parser.calls[0], SAMPLES.flowchart)
  assert.equal(existsSync(join(runtimeDir, 'diagrams', 'L01-T02-20260924-101530-flowchart.mmd')), true)
})

test('编排：结构校验不过 → 抛错，**不调用解析器、什么都不落盘**', async (t) => {
  const runtimeDir = await makeRuntimeDir()
  t.after(() => rm(runtimeDir, { recursive: true, force: true }))
  const parser = fakeParser()

  await assert.rejects(
    () => drawDiagram({ kind: 'flowchart', source: '   ' }, { runtimeDir, lesson: 1, turn: 1, parser, io: fakeIo, now: NOW }),
    /classroom_draw 拒绝这次调用，什么都没有落盘/,
  )
  assert.equal(parser.calls.length, 0)
  assert.deepEqual(await listDir(join(runtimeDir, 'diagrams')), [])
})

test('编排：真解析不过 → 抛错并带上解析器报错原文，什么都不落盘', async (t) => {
  const runtimeDir = await makeRuntimeDir()
  t.after(() => rm(runtimeDir, { recursive: true, force: true }))
  const parser = fakeParser(new Error('Parse error on line 4: expecting ...'))

  await assert.rejects(
    () =>
      drawDiagram(
        { kind: 'flowchart', source: SAMPLES.flowchart, title: '' },
        { runtimeDir, lesson: 1, turn: 1, parser, io: fakeIo, now: NOW },
      ),
    (error) => {
      assert.match(error.message, /渲染不出来/)
      assert.match(error.message, /Parse error on line 4/)
      return true
    },
  )
  assert.deepEqual(await listDir(join(runtimeDir, 'diagrams')), [])
})

test('编排：解析器本身不可用（mermaid 没装上）→ 抛错，**不降级放行**', async (t) => {
  const runtimeDir = await makeRuntimeDir()
  t.after(() => rm(runtimeDir, { recursive: true, force: true }))
  const parser = fakeParser(new Error("Cannot find package 'mermaid' imported from ..."))

  await assert.rejects(
    () =>
      drawDiagram(
        { kind: 'flowchart', source: SAMPLES.flowchart, title: '' },
        { runtimeDir, lesson: 1, turn: 1, parser, io: fakeIo, now: NOW },
      ),
    /渲染不出来[\s\S]*Cannot find package 'mermaid'/,
  )
  assert.deepEqual(await listDir(join(runtimeDir, 'diagrams')), [])
})

test('编排：IO 失败 → 抛错说明"图没有写进教室 runtime/"', async (t) => {
  const runtimeDir = await makeRuntimeDir()
  t.after(() => rm(runtimeDir, { recursive: true, force: true }))
  const io = {
    writeFileAtomic: async () => {
      throw new Error('ENOSPC: no space left on device')
    },
    withFileLock: (_f, op) => op(),
  }
  await assert.rejects(
    () =>
      drawDiagram(
        { kind: 'flowchart', source: SAMPLES.flowchart, title: '' },
        { runtimeDir, lesson: 1, turn: 1, parser: fakeParser(), io, now: NOW },
      ),
    /落盘失败（图没有写进教室 runtime\/）：ENOSPC/,
  )
})

// ---------------------------------------------------------------- ⑤ 真解析（真 mermaid，冷启动约 1 s）

test('真解析：12 种图类型全部解析通过，返回 mermaid 自己的图类型名', async () => {
  const parser = createMermaidParser()
  try {
    const seen = {}
    for (const kind of DIAGRAM_KIND_IDS) {
      const result = await parser.parse(SAMPLES[kind])
      assert.ok(result.diagramType !== '', `${kind} 应当返回 diagramType`)
      seen[kind] = result.diagramType
    }
    assert.equal(seen.flowchart, 'flowchart-v2')
    assert.equal(seen.sequence, 'sequence')
    assert.equal(seen.state, 'stateDiagram')
  } finally {
    await parser.close()
  }
})

test('真解析：语法错的图 → reject（这就是"能不能渲染"的权威判据）', async () => {
  const parser = createMermaidParser()
  try {
    await assert.rejects(() => parser.parse('flowchart TD\n  A[未闭合 --> B\n'), /Parse error|Lexical error/)
    await assert.rejects(() => parser.parse('这不是任何图\n'), /No diagram type detected/)
    // 解析器坏了之后仍要继续可用（不能一次失败就把工具废掉）
    assert.equal((await parser.parse(SAMPLES.flowchart)).diagramType, 'flowchart-v2')
  } finally {
    await parser.close()
  }
})

test('真解析：worker 起不来 → reject（🔴 绝不静默当成"校验通过"）', async () => {
  const parser = createMermaidParser({ workerUrl: new URL('./fixtures/不存在的-worker.mjs', import.meta.url) })
  try {
    await assert.rejects(() => parser.parse(SAMPLES.flowchart), /worker|Cannot find|ERR_MODULE_NOT_FOUND|ENOENT/)
  } finally {
    await parser.close()
  }
})

test('真解析：解析完**不 close** 时进程也能自己退出（worker 不得吊住事件循环）', async () => {
  // 🔴 实测踩过的坑：常驻 worker 会让宿主进程永不退出（无头会话挂到 600 s 超时被杀）。
  // 判据：子进程跑完 parse 后什么都不做，必须在 20 s 内以 0 退出。
  // （mermaid 源码走 argv 传，避免在生成的脚本里拼转义字符。）
  const script = join(tmpdir(), `t3a-exit-${randomBytes(4).toString('hex')}.mjs`)
  const parserUrl = new URL('../lib/mermaid-parse.mjs', import.meta.url).href
  await writeFile(
    script,
    [
      `import { createMermaidParser } from ${JSON.stringify(parserUrl)}`,
      'const parser = createMermaidParser()',
      'const r = await parser.parse(process.argv[2])',
      "process.stdout.write('parsed:' + r.diagramType)",
      '// 故意不 close()：进程仍须自己退出',
      '',
    ].join('\n'),
  )
  try {
    const child = spawn(process.execPath, [script, SAMPLES.flowchart], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (c) => (out += c.toString()))
    child.stderr.on('data', (c) => (err += c.toString()))
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error('worker 吊住了进程：20 s 内没退出'))
      }, 20000)
      child.on('close', (c) => {
        clearTimeout(timer)
        resolve(c)
      })
    })
    assert.equal(code, 0, `子进程退出码非 0；stderr=\n${err}`)
    assert.equal(out, 'parsed:flowchart-v2')
  } finally {
    await rm(script, { force: true })
  }
})

test('端到端：真解析器 + 落盘（工具的实际链路）', async (t) => {
  const runtimeDir = await makeRuntimeDir()
  t.after(() => rm(runtimeDir, { recursive: true, force: true }))
  const parser = createMermaidParser()
  t.after(() => parser.close())

  const result = await drawDiagram(
    { kind: 'flowchart', source: SAMPLES.flowchart, title: '两个程序为什么不会互相捣乱', caption: '第 1 讲题眼' },
    { runtimeDir, lesson: 1, turn: 1, parser, io: fakeIo, now: NOW },
  )
  assert.equal(result.diagramType, 'flowchart-v2')
  const stored = await readFile(join(runtimeDir, result.file), 'utf8')
  assert.equal(stored, SAMPLES.flowchart)
})

test('端到端：ASCII 拼的示意图走完整链路 → 被拒，目录里一个文件都没有', async (t) => {
  const runtimeDir = await makeRuntimeDir()
  t.after(() => rm(runtimeDir, { recursive: true, force: true }))
  const parser = createMermaidParser()
  t.after(() => parser.close())

  const ascii = ['flowchart TD', '  ┌──────┐', '  │ 进程A │', '  └──────┘'].join('\n')
  await assert.rejects(
    () => drawDiagram({ kind: 'flowchart', source: ascii, title: '' }, { runtimeDir, lesson: 1, turn: 1, parser, io: fakeIo, now: NOW }),
    /制表符边框字符/,
  )
  assert.deepEqual(await listDir(join(runtimeDir, 'diagrams')), [])
})
