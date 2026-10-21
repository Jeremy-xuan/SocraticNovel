// 22-read-messages.test.mjs —— 契约 K2.3 判据的单测，**用真机节点形状**（node --test）
//
// 为什么单独一份、而且非要测 `readMessages`：
//   2026-10-21 的真回合（mock 老师 + 隔离 profile）实测出的节点形状，与契约 K2.3 写的不一样 ——
//   外层节点叫 `tool-call`，工具结果折在它的 `data.root` 里（那个 root 的 `kind` 才是
//   `tool-result`，带 `name` / `content` / `isError` / `meta`）。原来只认外层
//   `kind === 'tool-result'`，于是舞台一条板书信号都没收到（快照里只有 you/tool/teacher）。
//   这份单测就是拿**那一次抓到的形状**当输入，钉住「外层 tool-call + root.tool-result 也要命中」。
//
// 怎么跑：
//   node clients/classroom-stage-warm/test/22-read-messages.test.mjs
//   node --test clients/classroom-stage-warm/test/22-read-messages.test.mjs
//   ./check.sh          （第七组 7f 会跑它）
//
// 加载方式：舞台浏览器半边是 `__ModuleLoader__` 闭包，`module.exports` 不上 window。
// 这里给一个最小的 `window.__ModuleLoader__` 把它接下来（真实文件、真实代码，不另写一份实现）。

import test from 'node:test'
import assert from 'node:assert/strict'

// ── 最小浏览器外壳（只够让 lib/client.js 求值，不跑 apply）─────────────────
const g = globalThis
g.window = g
const el = () => ({
  style: {}, dataset: {},
  setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {},
  querySelector: () => null, querySelectorAll: () => [],
})
g.document = Object.assign(el(), { head: el(), body: el(), createElement: el, getElementById: () => null, documentElement: el() })
g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
g.location = { search: '', href: 'http://127.0.0.1/' }

let definition = null
g.__ModuleLoader__ = { load: (d) => { definition = d } }

const ReactStub = {
  createElement: () => null,
  useState: (v) => [v, () => {}],
  useEffect() {}, useRef: (v) => ({ current: v }), useMemo: (f) => f(),
  memo: (f) => f, Fragment: 'Fragment',
}
const requireStub = (id) => (
  id === 'react' ? ReactStub
    : id === 'react-dom/client' ? { createRoot: () => ({ render() {} }) }
      : {}
)

await import('../lib/client.js')
assert.ok(definition, 'lib/client.js 没有调用 window.__ModuleLoader__.load()')
const api = definition.factory(requireStub)
const { readMessages, boardEventOf, latestBoardOf, shouldAutoOpenBoard } = api.__test

// ══════════════════════════════════════════════════════════════════════════
// 一 · 真机抓到的节点形状（逐字照抄那次 dump 的键）
//    NODEKIND tool-call {"nk":[…],"dk":["root"],
//      "rootKind":"tool-result","rootName":"classroom_draw",
//      "rootKeys":["kind","seq","time","callId","name","args","call","callTime","content","isError","meta","subCalls"]}
// ══════════════════════════════════════════════════════════════════════════
const T0 = 1792561297915   // 真回合那一刻（mock 在 2026-10-21 01:41 画的那张）
const BOARD_ID = 'L01-T01-20261021-014137-flowchart'
const BOARD_TEXT =
  `板书图已落盘：diagrams/${BOARD_ID}.mmd（flowchart → flowchart-v2｜2 行 / 64 B）｜` +
  `第 1 讲 · 第 1 回合 · 2026-10-21 01:41｜索引 diagrams/index.md 现共 1 行｜标题：长任务把短任务堵在后面\n` +
  `[board] id=${BOARD_ID} lesson=1 turn=1 kind=flowchart`

/** 一个真的 `tool-call` 节点（结果已落）：data.root 才是 tool-result 对象。 */
function realToolCallNode (over) {
  return {
    key: 'tool-1',
    kind: 'tool-call',
    id: 'tool-1',
    data: {
      root: Object.assign({
        kind: 'tool-result',
        seq: 20,
        time: T0,
        callId: 'call_1',
        name: 'classroom_draw',
        args: {},
        call: { name: 'classroom_draw', argsRaw: '{}' },
        callTime: T0 - 5,
        content: [{ type: 'text', text: BOARD_TEXT }],
        isError: false,
        meta: { board: { id: BOARD_ID, lesson: 1, turn: 1, kind: 'flowchart' } },
        subCalls: [],
      }, over || {}),
    },
  }
}

const chatOf = (nodes) => ({
  order: nodes.map((n) => n.key),
  nodes: new Map(nodes.map((n) => [n.key, n])),
  legacy: {},
})
const boardEntries = (msgs) => msgs.filter((m) => m.role === 'board')

test('真机形状：外层 tool-call + data.root.kind=tool-result → 推出 board 条目', () => {
  const msgs = readMessages(chatOf([realToolCallNode()]))
  const b = boardEntries(msgs)
  assert.equal(b.length, 1, '应当有且只有一条 board 条目：' + JSON.stringify(msgs.map((m) => m.role)))
  assert.equal(b[0].board.id, BOARD_ID)
  assert.equal(b[0].board.from, 'meta', 'meta.board.id 优先于文本里的 [board] 行')
  assert.equal(b[0].board.time, T0, 'board 条目要带上事件时间（供 shouldAutoOpenBoard 用）')
  assert.equal(latestBoardOf(msgs).id, BOARD_ID)
  // 纸带那一行照旧：role:tool 还在（板书信号是**额外**一条，不顶掉工具行）
  assert.equal(msgs.filter((m) => m.role === 'tool').length, 1)
})

test('契约文档写的形状（独立 tool-result 节点）也照样命中', () => {
  const node = realToolCallNode()
  node.kind = 'tool-result'
  node.data = node.data.root          // 独立节点这一形状：结果对象直接就是 data
  const msgs = readMessages(chatOf([node]))
  assert.equal(boardEntries(msgs).length, 1)
  assert.equal(latestBoardOf(msgs).id, BOARD_ID)
})

test('只有文本没有 meta：退化到 [board] 行', () => {
  const msgs = readMessages(chatOf([realToolCallNode({ meta: undefined })]))
  const b = boardEntries(msgs)
  assert.equal(b.length, 1)
  assert.equal(b[0].board.from, 'text')
  assert.deepEqual([b[0].board.id, b[0].board.lesson, b[0].board.turn, b[0].board.kind], [BOARD_ID, 1, 1, 'flowchart'])
})

test('两个来源都没有 id：不推 board 条目（不切屏）', () => {
  const msgs = readMessages(chatOf([realToolCallNode({
    meta: undefined,
    content: [{ type: 'text', text: '画好了，但是没给 id' }],
  })]))
  assert.equal(boardEntries(msgs).length, 0)
  // 工具行照旧在
  assert.equal(msgs.filter((m) => m.role === 'tool').length, 1)
})

test('isError:true 的结果不算板书（契约 K2.3 第 3 条）', () => {
  const msgs = readMessages(chatOf([realToolCallNode({ isError: true })]))
  assert.equal(boardEntries(msgs).length, 0)
})

test('还在跑（root 是 phase:start 的准备态）不算板书', () => {
  const node = realToolCallNode()
  node.data.root = { phase: 'start', callId: 'call_1', name: 'classroom_draw', argsRaw: '{}', turn: 1, step: 1, time: T0, subCalls: [] }
  const msgs = readMessages(chatOf([node]))
  assert.equal(boardEntries(msgs).length, 0)
  assert.equal(msgs.filter((m) => m.role === 'tool').length, 1)
})

test('callId 已由 assistant-step 报过：工具行去重，但 board 信号**不能**被一起吞掉', () => {
  const step = {
    key: 'step-1',
    kind: 'assistant-step',
    id: 'step-1',
    data: {
      status: 'settled',
      blocks: [
        { kind: 'text', text: '我画一张图。' },
        { kind: 'tool-call', name: 'classroom_draw', callId: 'call_1', argsRaw: '{}' },
      ],
    },
  }
  const msgs = readMessages(chatOf([step, realToolCallNode()]))
  assert.deepEqual(msgs.map((m) => m.role), ['teacher', 'board'], '工具行被去重，board 条目必须留下')
  assert.equal(latestBoardOf(msgs).id, BOARD_ID)
})

test('单个节点只推一条 board（不会因为先判板书再判工具行而推两遍）', () => {
  const msgs = readMessages(chatOf([realToolCallNode()]))
  assert.equal(boardEntries(msgs).length, 1)
  assert.deepEqual(msgs.map((m) => m.role), ['board', 'tool'])
})

// ══════════════════════════════════════════════════════════════════════════
// 二 · shouldAutoOpenBoard：刷新页面不许弹历史图，课上新画的必须弹
// ══════════════════════════════════════════════════════════════════════════
test('没有 id / 没有对象 → 不弹', () => {
  assert.equal(shouldAutoOpenBoard(T0, '', null), false)
  assert.equal(shouldAutoOpenBoard(T0, '', {}), false)
  assert.equal(shouldAutoOpenBoard(T0, '', { id: '' }), false)
})

test('刷新页面：历史里那张（时间早于挂载）不弹', () => {
  assert.equal(shouldAutoOpenBoard(T0, '', { id: BOARD_ID, time: T0 - 60000 }), false)
})

test('课上刚画的（时间晚于挂载）→ 弹', () => {
  assert.equal(shouldAutoOpenBoard(T0, '', { id: BOARD_ID, time: T0 + 1 }), true)
})

test('同一张已经处理过 → 不重复弹（哪怕又来一次渲染）', () => {
  assert.equal(shouldAutoOpenBoard(T0, BOARD_ID, { id: BOARD_ID, time: T0 + 5000 }), false)
})

test('时间未知（老事件没带 time）→ 保守按新事件弹', () => {
  assert.equal(shouldAutoOpenBoard(T0, '', { id: BOARD_ID }), true)
  assert.equal(shouldAutoOpenBoard(T0, '', { id: BOARD_ID, time: null }), true)
})

test('挂载时刻未知 → 只靠 id 去重（不会因此吞掉新图）', () => {
  assert.equal(shouldAutoOpenBoard(null, '', { id: BOARD_ID, time: 1 }), true)
})

// ══════════════════════════════════════════════════════════════════════════
// 三 · boardEventOf 的 time 字段（老调用点不该因此变成 undefined 比较）
// ══════════════════════════════════════════════════════════════════════════
test('boardEventOf 带出事件时间；别的工具仍旧不算', () => {
  assert.equal(boardEventOf(realToolCallNode()).time, T0)
  const other = realToolCallNode({ name: 'classroom_note' })
  assert.equal(boardEventOf(other), null)
  const noTime = realToolCallNode({ time: undefined })
  assert.equal(boardEventOf(noTime).time, null)
})
