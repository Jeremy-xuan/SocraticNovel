// emotion-parse.test.mjs —— 契约 K1.3 流式解析器的单测（零依赖，node --test）
//
// 判据（K1.3 第 5 条）是**逐字节**的：同一段文本，任意切分方式的 chunk 序列，
// 拼起来的 text 与 events 必须和一次性喂入完全相同。所以这里的核心不是挑几个例子，
// 而是把「所有切法」跑一遍。

import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 以「经典 <script>」的同一份源码为被测对象：import 它的副作用就是挂上 window 全局。
// 舞台里也是这么用（没有构建、没有模块解析）。
const SRC_PATH = fileURLToPath(new URL('../assets/l2d/stage-emotion-parse.js', import.meta.url))
await import('../assets/l2d/stage-emotion-parse.js')
const api = globalThis.__SOCRATIC_EMOTION_PARSE__
const SOURCE = readFileSync(SRC_PATH, 'utf8')

const make = () => api.createEmotionStreamParser()

/** 一次性喂入（作为基准）。 */
function feedAll (text) {
  const p = make()
  const r = p.push(text)
  const f = p.flush()
  return { text: r.text + f.text, events: r.events }
}

/** 按切点数组切分后逐块喂入，返回拼起来的结果。 */
function feedSplit (text, cuts) {
  const p = make()
  let text_ = ''
  const events = []
  let at = 0
  const bounds = cuts.concat([text.length])
  for (const b of bounds) {
    const r = p.push(text.slice(at, b))
    text_ += r.text
    events.push(...r.events)
    at = b
  }
  const f = p.flush()
  return { text: text_ + f.text, events }
}

/** 所有 k 段切分（k=1..3）的切点组合。 */
function allCutSets (len, maxParts = 3) {
  const out = [[]]
  if (len >= 1) {
    for (let a = 1; a < len; a++) out.push([a])
    if (maxParts >= 3) {
      for (let a = 1; a < len; a++) {
        for (let b = a + 1; b < len; b++) out.push([a, b])
      }
    }
  }
  return out
}

const M = (label, intensity) => ({ label, intensity })

test('基本：标记剥净、事件带 label 与数值强度', () => {
  const r = feedAll('好呀〔emo:happy:0.60〕。')
  assert.equal(r.text, '好呀。')
  assert.deepEqual(r.events, [M('happy', 0.6)])
})

test('五个合法标签都能解析；1.00 与 0.00 是边界内', () => {
  for (const label of ['calm', 'happy', 'shy', 'puzzled', 'excited']) {
    const r = feedAll(`嗯〔emo:${label}:0.85〕`)
    assert.deepEqual(r.events, [M(label, 0.85)], label)
  }
  assert.deepEqual(feedAll('〔emo:calm:1.00〕').events, [M('calm', 1)])
  assert.deepEqual(feedAll('〔emo:calm:0.00〕').events, [M('calm', 0)])
})

test('判据：任意 1/2/3 段切分，输出与一次性喂入逐字节相同', () => {
  const samples = [
    '同学你好〔emo:happy:0.60〕，我们看这一行〔emo:puzzled:0.75〕。',
    '先别急〔emo:calm:0.40〕……你刚刚说的「指针」指的是地址吗？〔emo:puzzled:0.90〕',
    '［］〔emo:shy:0.55〕正文里的〔注〕不该被吃掉〔emo:excited:1.00〕。',
    '〔emo:excited:0.95〕〔emo:shy:0.20〕〔emo:happy:0.33〕一句三个',
    '没有标记的一整段中文，句号。还有英文。And a dot. 结束',
    '〔emo:badlabel:0.50〕〔emo:happy:1.01〕〔emo:happy:0.6〕〔emo:happy:0.600〕全是废标记',
    '尾巴不闭合〔emo:hap',
    '〔',
    ''
  ]
  for (const s of samples) {
    const base = feedAll(s)
    for (const cuts of allCutSets(s.length, 3)) {
      const got = feedSplit(s, cuts)
      assert.equal(got.text, base.text, `text @ ${JSON.stringify(s)} cuts=${cuts}`)
      assert.deepEqual(got.events, base.events, `events @ ${JSON.stringify(s)} cuts=${cuts}`)
    }
  }
})

test('判据：随机切分（含空 chunk）也逐字节相同', () => {
  const samples = [
    '你这句话〔emo:shy:0.62〕让我有点意外〔emo:happy:0.44〕。再说一遍？',
    '好〔emo:calm:0.10〕。〔emo:excited:0.99〕'
  ]
  let seed = 1234567
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (const s of samples) {
    const base = feedAll(s)
    for (let k = 0; k < 300; k++) {
      const p = make()
      let out = ''
      const ev = []
      let i = 0
      // 先切好 chunk 序列（含随机插入的空 chunk），再逐块喂
      const chunks = []
      while (i < s.length) {
        // 空 chunk 单独插，不能靠 take=0 —— 那样会漏掉一个字符（本测试自己踩过）
        if (rnd() < 0.15) chunks.push('')
        const take = 1 + Math.floor(rnd() * 4)
        chunks.push(s.slice(i, i + take))
        i += take
      }
      for (const chunk of chunks) {
        const r = p.push(chunk)
        out += r.text
        ev.push(...r.events)
      }
      out += p.flush().text
      assert.equal(out, base.text, `random text ${k}`)
      assert.deepEqual(ev, base.events, `random events ${k}`)
    }
  }
})

test('flush：未闭合的尾巴原样交回且不发事件', () => {
  const p = make()
  const a = p.push('好的〔emo:sh')
  assert.equal(a.text, '好的')
  assert.deepEqual(a.events, [])
  const f = p.flush()
  assert.equal(f.text, '〔emo:sh')
  assert.deepEqual(f.events, undefined) // flush 的返回里没有 events 字段
})

test('跨 chunk 拼接：半截标记在补齐之前绝不外传', () => {
  const p = make()
  assert.equal(p.push('老师〔emo:sh').text, '老师')
  assert.equal(p.push('y:0.60').text, '')
  const r = p.push('〕好的')
  assert.equal(r.text, '好的')
  assert.deepEqual(r.events, [M('shy', 0.6)])
})

test('非法形态一律剥掉：非法标签 / 越界 / 非两位小数 / 大写 / 空格', () => {
  const bad = [
    '〔emo:angry:0.50〕',
    '〔emo:happy:1.01〕',
    '〔emo:happy:-0.10〕',
    '〔emo:happy:0.6〕',
    '〔emo:happy:0.600〕',
    '〔emo:HAPPY:0.50〕',
    '〔emo:happy:0.50 〕',
    '〔emo::0.50〕',
    '〔emo:happy〕'
  ]
  for (const b of bad) {
    const r = feedAll('A' + b + 'B')
    assert.equal(r.text, 'AB', b)
    assert.deepEqual(r.events, [], b)
  }
})

test('一句多个标记取第一个，其余剥掉不发事件', () => {
  const r = feedAll('前半〔emo:happy:0.60〕后半〔emo:puzzled:0.90〕。')
  assert.equal(r.text, '前半后半。')
  assert.deepEqual(r.events, [M('happy', 0.6)])
})

test('换句后可以再收一个事件', () => {
  const r = feedAll('第一句〔emo:happy:0.60〕。第二句〔emo:shy:0.30〕。')
  assert.equal(r.text, '第一句。第二句。')
  assert.deepEqual(r.events, [M('happy', 0.6), M('shy', 0.3)])
})

test('非 emo 的〔〕是正文，原样保留', () => {
  const r = feedAll('参见〔注一〕与〔附录〕。')
  assert.equal(r.text, '参见〔注一〕与〔附录〕。')
  assert.deepEqual(r.events, [])
})

test('空 chunk 与非字符串输入不抛、不改变输出', () => {
  const p = make()
  assert.deepEqual(p.push(''), { text: '', events: [] })
  assert.deepEqual(p.push(null), { text: '', events: [] })
  assert.deepEqual(p.push(undefined), { text: '', events: [] })
  const r = p.push('〔emo:calm:0.20〕')
  assert.equal(r.text, '')
  assert.deepEqual(r.events, [M('calm', 0.2)])
})

test('实例之间互不干扰（状态只在自己身上）', () => {
  const a = make()
  const b = make()
  a.push('〔emo:ha')
  const rb = b.push('纯文本')
  assert.equal(rb.text, '纯文本')
  assert.deepEqual(rb.events, [])
  assert.equal(a.flush().text, '〔emo:ha')
})

test('经典 <script> 形态：没有 module 时挂上 window 全局（模拟浏览器）', () => {
  const sandbox = {}
  sandbox.window = sandbox // 浏览器里 window 就是 globalThis；这里把两者对齐
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox)
  const g = sandbox.window.__SOCRATIC_EMOTION_PARSE__
  assert.ok(g, '未挂上 window.__SOCRATIC_EMOTION_PARSE__')
  const p = g.createEmotionStreamParser()
  const r = p.push('嗨〔emo:excited:0.88〕')
  assert.equal(r.text, '嗨')
  // 跨 vm realm 的对象原型不同，deepEqual 会因「同结构不同引用」失败，故走 JSON 比较
  assert.equal(JSON.stringify(r.events), JSON.stringify([M('excited', 0.88)]))
})

test('零依赖：源码里没有 import / require / fetch / DOM 访问', () => {
  assert.equal(/^\s*import\s/m.test(SOURCE), false, '出现 import 语句')
  assert.equal(/\brequire\s*\(/.test(SOURCE), false, '出现 require(')
  assert.equal(/\bdocument\b/.test(SOURCE), false, '访问了 document')
  assert.equal(/\bfetch\s*\(/.test(SOURCE), false, '出现 fetch(')
})
