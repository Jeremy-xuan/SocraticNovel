// test/emotionmark.test.mjs — K1 情绪标记的单测（K1.1 语法、K1.3 流式解析、K1.4 通道）
//
// 🔴 本文件的**第一条纪律**是 K1.3-5：同一段文本，**任意切分方式**的 chunk 序列，
//    输出必须与一次性喂入**逐字节相同**（文本与事件序列都相同）。所以下面有专门的
//    "全切分点穷举"用例：对每段样本文本，把它的每一个位置都切成 1/2/3 段各试一遍。
//
// 纪律：不调 LLM、不起宿主、不碰真实教室目录、不碰 $DSH_HOME。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  EMOTION_LABELS,
  INTENSITY_RE,
  MARK_CLOSE,
  MARK_OPEN,
  createEmotionStreamParser,
  parseEmotionBody,
  stripEmotionMarkers,
  stripEmotionMarkersClean,
} from '../lib/emotionmark.mjs'
import {
  EMOTIONS_FILE,
  MAX_CHANNEL_BYTES,
  collapseIfNeeded,
  createEmotionChannel,
  isoWithOffset,
  nextSeqFrom,
  renderEmotionLine,
  wrapChunkStream,
} from '../lib/emotionchannel.mjs'

// ---------------------------------------------------------------- 替身

async function writeFileAtomic(filename, content, options) {
  const { mkdir, writeFile, rename } = await import('node:fs/promises')
  await mkdir(dirname(filename), { recursive: true })
  const temp = `${filename}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(temp, content, { mode: options?.mode, flag: 'wx' })
  await rename(temp, filename)
}

function makeFakeIo() {
  const chains = new Map()
  return {
    writeFileAtomic,
    withFileLock(filename, operation) {
      const prev = chains.get(filename) ?? Promise.resolve()
      const run = prev.then(() => operation())
      chains.set(
        filename,
        run.then(
          () => {},
          () => {},
        ),
      )
      return run
    },
  }
}

// ---------------------------------------------------------------- K1.1 语法

test('标签集只有五个（calm/happy/shy/puzzled/excited）', () => {
  assert.deepEqual(EMOTION_LABELS, ['calm', 'happy', 'shy', 'puzzled', 'excited'])
})

test('parseEmotionBody：合法标记 → {label, intensity}', () => {
  assert.deepEqual(parseEmotionBody('emo:calm:0.50'), { label: 'calm', intensity: 0.5 })
  assert.deepEqual(parseEmotionBody('emo:excited:1.00'), { label: 'excited', intensity: 1 })
  assert.deepEqual(parseEmotionBody('emo:shy:0.00'), { label: 'shy', intensity: 0 })
})

test('parseEmotionBody：非法标签 / 强度越界 / 缺两位小数 / 大写 → null（不做容错）', () => {
  for (const bad of [
    'emo:angry:0.50', // 不在五个标签里
    'emo:Happy:0.50', // 必须全小写
    'emo:calm:0.6', // 缺两位小数
    'emo:calm:1.50', // 越界
    'emo:calm:0.5',
    'emo:calm:1.0',
    'emo::0.50',
    'emo:calm',
    'calm:0.50',
    ' emo:calm:0.50',
  ]) {
    assert.equal(parseEmotionBody(bad), null, `${JSON.stringify(bad)} 必须判非法`)
  }
})

test('INTENSITY_RE：只认 0.xx 与 1.00', () => {
  for (const ok of ['0.00', '0.07', '0.60', '1.00']) assert.ok(INTENSITY_RE.test(ok), ok)
  for (const bad of ['0.6', '1.0', '1.01', '00.50', '.50', '0,50']) assert.equal(INTENSITY_RE.test(bad), false, bad)
})

test('stripEmotionMarkers：合法与非法标记都剥掉；未闭合的〔原样保留', () => {
  assert.equal(stripEmotionMarkers('你好。〔emo:calm:0.50〕'), '你好。')
  assert.equal(stripEmotionMarkers('a〔emo:angry:0.50〕b'), 'ab')
  assert.equal(stripEmotionMarkers('a〔emo:calm:0.5〕b'), 'ab')
  assert.equal(stripEmotionMarkers('a〔emo:calm:0.50'), 'a〔emo:calm:0.50')
  assert.equal(stripEmotionMarkers('没有标记'), '没有标记')
  assert.equal(stripEmotionMarkersClean('a。〔emo:calm:0.50〕  b'), 'a。 b')
})

test('stripEmotionMarkers：**不是标记形状**的括号对原样保留（不把正文当标记吃掉）', () => {
  // 判据与舞台版一致：只有以 `emo:` 开头的括号对才是标记候选
  assert.equal(stripEmotionMarkers('a〔不是标记〕b'), 'a〔不是标记〕b')
  assert.equal(stripEmotionMarkers('〔emo〕还是字'), '〔emo〕还是字')
  assert.equal(stripEmotionMarkers('〔EMO:calm:0.50〕大写不算'), '〔EMO:calm:0.50〕大写不算')
  assert.equal(stripEmotionMarkers('〔〕空括号'), '〔〕空括号')
  // 但标记形状的非法内容照样剥（K1.3-3）
  assert.equal(stripEmotionMarkers('a〔emo:〕b'), 'ab')
  assert.equal(stripEmotionMarkers('a〔emo:calm〕b'), 'ab')
})

// ---------------------------------------------------------------- K1.3 解析器

/** 一次性喂入（整串）→ {text, events} */
function feedWhole(parser, text) {
  const pushed = parser.push(text)
  const flushed = parser.flush()
  return { text: pushed.text + flushed.text, events: pushed.events }
}

/** 按切分点喂入 → {text, events} */
function feedSplit(text, cuts) {
  const parser = createEmotionStreamParser()
  let out = ''
  const events = []
  let last = 0
  for (const cut of [...cuts, text.length]) {
    const piece = text.slice(last, cut)
    last = cut
    const r = parser.push(piece)
    out += r.text
    events.push(...r.events)
  }
  const f = parser.flush()
  return { text: out + f.text, events }
}

/** 所有"1 段/2 段/3 段"切法。 */
function allSplits(text) {
  const out = [[]]
  for (let i = 1; i < text.length; i += 1) {
    out.push([i])
    for (let j = i + 1; j < text.length; j += 1) out.push([i, j])
  }
  return out
}

const SAMPLES = [
  '同学你好。',
  '同学你好。〔emo:calm:0.50〕我们开始吧。',
  '这样对吗？〔emo:puzzled:0.70〕',
  '好厉害！〔emo:excited:1.00〕',
  '嗯……〔emo:shy:0.30〕',
  'A。〔emo:calm:0.50〕B。〔emo:happy:0.90〕C',
  '一句里两个〔emo:calm:0.50〕标记〔emo:happy:0.90〕后面的正文',
  '非法〔emo:angry:0.50〕标签也要剥掉',
  '缺两位小数〔emo:calm:0.6〕也剥',
  '未闭合的〔emo:calm:0.50',
  '没有标记的一段话，换行也算一句\n〔emo:calm:0.50〕下一句',
  '全角〔不是标记〕括号',
  '括号里只有 em〔emo:ca',
]

test('🔴 K1.3-5：任意切分方式，文本与事件序列都逐字节一致', () => {
  for (const sample of SAMPLES) {
    const whole = feedWhole(createEmotionStreamParser(), sample)
    for (const cuts of allSplits(sample)) {
      const split = feedSplit(sample, cuts)
      assert.equal(split.text, whole.text, `切分 ${JSON.stringify(cuts)} 的文本与整串不一致：${JSON.stringify(sample)}`)
      assert.deepEqual(split.events, whole.events, `切分 ${JSON.stringify(cuts)} 的事件与整串不一致：${JSON.stringify(sample)}`)
    }
  }
})

test('K1.3-1 跨 chunk 拼接：标记被切两半时不漏出半截', () => {
  const parser = createEmotionStreamParser()
  const a = parser.push('他说〔emo:sh')
  assert.equal(a.text, '他说', '还没闭合的标记整段扣住，正文照常下发')
  assert.deepEqual(a.events, [])
  const b = parser.push('y:0.60〕好的')
  assert.equal(b.text, '好的')
  assert.deepEqual(b.events, [{ label: 'shy', intensity: 0.6 }])
  assert.deepEqual(parser.flush(), { text: '' })
})

test('K1.3-2 flush 时仍不完整 → 原样交回、不发事件', () => {
  const parser = createEmotionStreamParser()
  const a = parser.push('半截〔emo:calm')
  assert.equal(a.text, '半截')
  assert.deepEqual(parser.flush(), { text: '〔emo:calm' })
})

test('K1.3-3 非法标签 / 强度越界 / 缺两位小数 → 整段剥掉且不发事件', () => {
  for (const bad of ['〔emo:angry:0.50〕', '〔emo:calm:1.50〕', '〔emo:calm:0.6〕', '〔emo:〕']) {
    const r = feedWhole(createEmotionStreamParser(), `前${bad}后`)
    assert.equal(r.text, '前后', `${bad} 必须整段剥掉`)
    assert.deepEqual(r.events, [], `${bad} 不得发事件`)
  }
})

test('K1.3-4 一句多个标记：取第一个，其余剥掉', () => {
  const one = feedWhole(createEmotionStreamParser(), '一句〔emo:calm:0.50〕两个〔emo:happy:0.90〕')
  assert.equal(one.text, '一句两个')
  assert.deepEqual(one.events, [{ label: 'calm', intensity: 0.5 }])
})

test('一句多个标记：句子边界（。？！…换行）之后重新计数', () => {
  const r = feedWhole(createEmotionStreamParser(), '第一句。〔emo:calm:0.50〕第二句？〔emo:happy:0.90〕')
  assert.deepEqual(r.events, [
    { label: 'calm', intensity: 0.5 },
    { label: 'happy', intensity: 0.9 },
  ])
})

test('事件顺序＝标记在文本里的出现顺序', () => {
  const r = feedWhole(createEmotionStreamParser(), 'a。〔emo:shy:0.20〕b。〔emo:excited:1.00〕c。〔emo:calm:0.00〕')
  assert.deepEqual(
    r.events.map((e) => e.label),
    ['shy', 'excited', 'calm'],
  )
})

test('解析器可复用：flush 之后状态清空（同一个解析器再来一轮结果相同）', () => {
  const parser = createEmotionStreamParser()
  const first = feedWhole(parser, 'a。〔emo:calm:0.50〕')
  const second = feedWhole(parser, 'a。〔emo:calm:0.50〕')
  assert.deepEqual(second, first)
})

// ---------------------------------------------------------------- K1.4 通道

test('isoWithOffset：带时区偏移的 ISO 8601', () => {
  assert.match(isoWithOffset(new Date('2026-10-20T23:15:00-04:00').getTime()), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
})

test('renderEmotionLine：字段与顺序固定（K1.4 逐字）', () => {
  assert.equal(
    renderEmotionLine({ seq: 7, ts: 'ts', session: 's', turn: 5, label: 'shy', intensity: 0.6 }),
    '{"v":1,"seq":7,"ts":"ts","session":"s","turn":5,"label":"shy","intensity":0.6}\n',
  )
})

test('nextSeqFrom：从末行续号；折叠行的 upTo 也算数；坏行跳过', () => {
  assert.equal(nextSeqFrom(''), 1)
  assert.equal(nextSeqFrom('{"v":1,"seq":3}\n{"v":1,"seq":4}\n'), 5)
  assert.equal(nextSeqFrom('{"v":1,"collapsed":true,"upTo":41}\n{"v":1,"seq":42}\n'), 43)
  assert.equal(nextSeqFrom('坏行\n{"v":1,"seq":2}\n'), 3)
})

test('collapseIfNeeded：未超限不动；超限折叠成一行并保留末尾几行', () => {
  const small = '{"v":1,"seq":1}\n'
  assert.equal(collapseIfNeeded(small).collapsed, false)

  const lines = Array.from({ length: 4000 }, (_, i) => `{"v":1,"seq":${i + 1},"pad":"${'x'.repeat(20)}"}\n`)
  const big = lines.join('')
  assert.ok(Buffer.byteLength(big, 'utf8') > MAX_CHANNEL_BYTES)
  const out = collapseIfNeeded(big)
  assert.equal(out.collapsed, true)
  assert.match(out.content, /^\{"v":1,"collapsed":true,"upTo":\d+\}\n/)
  const kept = out.content.trim().split('\n')
  assert.ok(kept.length <= 9, `折叠后应只剩折叠行 + 少量末尾记录，实际 ${kept.length} 行`)
  assert.equal(kept[kept.length - 1], lines[lines.length - 1].trim())
  assert.ok(out.upTo >= 3900)
})

test('通道：追加写、seq 单调、字段齐全（K1.4）', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'socratic-emotions-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const channel = createEmotionChannel({ runtimeDir: () => dir, io: makeFakeIo(), now: () => 1_760_000_000_000 })
  const first = await channel.append([{ label: 'shy', intensity: 0.6 }], { session: 'sess-1', turn: 5 })
  assert.equal(first.written, 1)
  const second = await channel.append([{ label: 'happy', intensity: 1 }], { session: 'sess-1', turn: 5 })
  assert.equal(second.written, 1)
  const text = await readFile(join(dir, EMOTIONS_FILE), 'utf8')
  const rows = text.trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => r.seq), [1, 2])
  assert.equal(rows[0].label, 'shy')
  assert.equal(rows[0].session, 'sess-1')
  assert.equal(rows[0].turn, 5)
  assert.match(rows[0].ts, /[+-]\d{2}:\d{2}$/)
  assert.equal((await stat(join(dir, EMOTIONS_FILE))).mode & 0o777, 0o600)
})

test('通道：教室还没确定 → 不写、不抛（返回原因）', async () => {
  const channel = createEmotionChannel({ runtimeDir: () => null, io: makeFakeIo() })
  const r = await channel.append([{ label: 'calm', intensity: 0.5 }], {})
  assert.equal(r.written, 0)
  assert.match(r.reason, /教室目录尚未确定/)
})

test('通道：IO 失败只记日志、不抛（课堂不能因为记不上情绪而断流）', async () => {
  const logs = []
  const channel = createEmotionChannel({
    runtimeDir: () => '/tmp/does-not-matter',
    io: { withFileLock: async () => { throw new Error('boom') }, writeFileAtomic },
    log: (m) => logs.push(m),
  })
  const r = await channel.append([{ label: 'calm', intensity: 0.5 }], {})
  assert.equal(r.written, 0)
  assert.match(logs.join('\n'), /情绪通道写入失败/)
})

test('通道：原子写包不可用 → 记录原因、不抛', async () => {
  const logs = []
  const channel = createEmotionChannel({ runtimeDir: () => '/tmp/x', io: { writeFileAtomic } , log: (m) => logs.push(m) })
  // io 缺 withFileLock → append 里的 io.withFileLock 会抛 TypeError，被 catch 住
  const r = await channel.append([{ label: 'calm', intensity: 0.5 }], {})
  assert.equal(r.written, 0)
  assert.ok(logs.length > 0)
})

// ---------------------------------------------------------------- 流包装

/** 把数组变成 async iterable。 */
async function* asStream(chunks) {
  for (const chunk of chunks) yield chunk
}

async function collect(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

test('包装：只改 text-delta 的 text，其它 chunk 原样透传（引用同一对象）', async () => {
  const events = []
  const other = { type: 'usage', usage: { input: 1 } }
  const finish = { type: 'finish', reason: { kind: 'end' } }
  const blockStart = { type: 'block-start', index: 0, blockType: 'text' }
  const out = await collect(
    wrapChunkStream(
      asStream([blockStart, { type: 'text-delta', index: 0, text: '你好。〔emo:calm:0.50〕' }, other, finish]),
      { onEvents: (e) => events.push(...e) },
    ),
  )
  assert.equal(out[0], blockStart, 'block-start 必须原样透传（同一引用）')
  assert.deepEqual(out[1], { type: 'text-delta', index: 0, text: '你好。' })
  assert.equal(out[2], other, 'usage 必须原样透传（同一引用）')
  assert.equal(out[3], finish, 'finish 必须原样透传（同一引用）')
  assert.deepEqual(events, [{ label: 'calm', intensity: 0.5 }])
})

test('包装：跨 chunk 的标记不留半截（顺序与内容都要对）', async () => {
  const events = []
  const out = await collect(
    wrapChunkStream(
      asStream([
        { type: 'text-delta', index: 0, text: '他说〔emo:sh' },
        { type: 'text-delta', index: 0, text: 'y:0.60〕好' },
        { type: 'finish', reason: { kind: 'end' } },
      ]),
      { onEvents: (e) => events.push(...e) },
    ),
  )
  const text = out.filter((c) => c.type === 'text-delta').map((c) => c.text).join('')
  assert.equal(text, '他说好')
  assert.deepEqual(events, [{ label: 'shy', intensity: 0.6 }])
})

test('包装：finish 之前把扣住的残余文本补出去（不吞正文）', async () => {
  const out = await collect(
    wrapChunkStream(
      asStream([{ type: 'text-delta', index: 0, text: '半截〔emo:calm' }, { type: 'finish', reason: { kind: 'end' } }]),
      {},
    ),
  )
  const text = out.filter((c) => c.type === 'text-delta').map((c) => c.text).join('')
  assert.equal(text, '半截〔emo:calm')
  assert.equal(out[out.length - 1].type, 'finish', 'finish 必须是最后一个 chunk')
})

test('包装：enabled=false → 完全透传（一个字段都不改）', async () => {
  const chunk = { type: 'text-delta', index: 0, text: '你好。〔emo:calm:0.50〕' }
  const out = await collect(wrapChunkStream(asStream([chunk]), { enabled: false }))
  assert.equal(out[0], chunk)
  assert.equal(out[0].text.includes('emo:'), true)
})

test('包装：onEvents 回调抛错不影响流转（吞掉并记日志）', async () => {
  const logs = []
  const out = await collect(
    wrapChunkStream(
      asStream([{ type: 'text-delta', index: 0, text: '你好。〔emo:calm:0.50〕' }, { type: 'finish', reason: {} }]),
      {
        onEvents: () => {
          throw new Error('sink down')
        },
        log: (m) => logs.push(m),
      },
    ),
  )
  assert.equal(out.filter((c) => c.type === 'text-delta').map((c) => c.text).join(''), '你好。')
  assert.match(logs.join('\n'), /情绪事件回调失败/)
})

test('包装：非对象 / null chunk 也原样透传', async () => {
  const out = await collect(wrapChunkStream(asStream([null, 42, { type: 'text-delta', index: 0, text: 'a' }]), {}))
  assert.equal(out[0], null)
  assert.equal(out[1], 42)
})

// ---------------------------------------------------------------- block-end 的 text 也要剥

test('🔴 block-end 的 block.text 也剥（宿主 BlockAssembler 用它覆盖累加的 delta）', async () => {
  // 依据：dsh-llm 的 BlockAssembler 在 block-end 处 `partial.block = chunk.block`，
  // 而适配器给的 block.text 是未剥原文 → 只剥 delta 会让落盘与原生界面仍然带标记。
  const out = await collect(
    wrapChunkStream(
      asStream([
        { type: 'text-delta', index: 0, text: '你好。〔emo:calm:0.50〕' },
        { type: 'block-end', index: 0, block: { type: 'text', text: '你好。〔emo:calm:0.50〕' } },
        { type: 'finish', reason: { kind: 'end' } },
      ]),
      {},
    ),
  )
  const blockEnd = out.find((c) => c.type === 'block-end')
  assert.equal(blockEnd.block.text, '你好。')
  assert.equal(blockEnd.block.type, 'text')
})

test('block-end：没有标记时原样透传（同一引用）；reasoning 块不动', async () => {
  const clean = { type: 'block-end', index: 0, block: { type: 'text', text: '没有标记' } }
  const reasoning = { type: 'block-end', index: 1, block: { type: 'reasoning', text: '想〔emo:calm:0.50〕' } }
  const out = await collect(wrapChunkStream(asStream([clean, reasoning]), {}))
  assert.equal(out[0], clean, '无标记的文本块必须原样透传（同一引用）')
  assert.equal(out[1], reasoning, 'reasoning 块不在剥离范围（学生看不到它）')
})
