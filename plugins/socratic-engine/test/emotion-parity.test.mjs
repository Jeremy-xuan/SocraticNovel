// test/emotion-parity.test.mjs — 「同一个标记，两份实现同一个判据」的一致性闸门
//
// 为什么有这条测试：K1 的剥离语义现在有**两份独立实现**——
//   ① 引擎版 `plugins/socratic-engine/lib/emotionmark.mjs`（服务端：`llm/stream` 里剥 + 落盘前剥）
//   ② 舞台版 `clients/classroom-stage-warm/assets/l2d/stage-emotion-parse.js`（浏览器端：防御性剥离）
// 两份判据一旦漂移，就会出现「纸带剥了、落盘没剥」或反之——学生看到的与文件里存的不是同一句话。
// 这条闸门喂**同一批语料**（含全部切点），断言 `text` 与 `events` **逐字节相同**。
//
// 🔴 纪律：不许把舞台版的实现复制进引擎再各自演化。要么两份 + 本测试（现状），要么直接复用。
//
// 舞台版是**经典脚本**（副作用挂 `globalThis.__SOCRATIC_EMOTION_PARSE__`），`await import()` 能跑。
// 文件位置候选（按顺序）：
//   1. 环境变量 `SOCRATIC_STAGE_EMOTION_PARSER`（绝对路径；在**没有 clients/ 的分支/工作树**里跑本测试时用）
//   2. `<repo>/clients/classroom-stage-warm/assets/l2d/stage-emotion-parse.js`
// 两处都没有 → **响亮跳过**（不是通过：这条闸门本次没有得到验证）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createEmotionStreamParser, stripEmotionMarkers } from '../lib/emotionmark.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CANDIDATES = [
  process.env.SOCRATIC_STAGE_EMOTION_PARSER,
  join(HERE, '..', '..', '..', 'clients', 'classroom-stage-warm', 'assets', 'l2d', 'stage-emotion-parse.js'),
].filter((p) => typeof p === 'string' && p !== '')
const STAGE_FILE = CANDIDATES.find((p) => existsSync(p)) ?? null

const SKIP = STAGE_FILE === null ? `舞台版解析器不在本分支（找过：${CANDIDATES.join(' | ')}）——本条闸门未验，合并集成后必须跑` : false

/** 语料：覆盖 5 类边界（正常／跨 chunk／flush 残留／非法／越界／一句多个）。 */
const CORPUS = [
  '同学你好。',
  '同学你好。〔emo:calm:0.50〕我们开始吧。',
  '他说〔emo:shy:0.60〕好的',
  '〔emo:nope:0.50〕非法标签',
  '〔emo:shy:1.50〕越界',
  '〔emo:calm:0.6〕缺两位小数',
  '一句〔emo:calm:0.30〕两个〔emo:happy:0.90〕标记',
  '第一句。〔emo:calm:0.50〕第二句？〔emo:happy:0.90〕第三句！〔emo:excited:1.00〕',
  '换行也算一句\n〔emo:puzzled:0.70〕下一句',
  '未闭合的尾巴〔emo:ha',
  '〔不是标记〕也算括号',
  '没有标记的一段话',
  '',
]

/** 按切分点喂一家实现 → {text, events}。 */
function feed(factory, text, cuts) {
  const parser = factory()
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
  const flushed = parser.flush()
  return { text: out + flushed.text, events }
}

/** 1 段/2 段/3 段的所有切法。 */
function allSplits(text) {
  const out = [[]]
  for (let i = 1; i < text.length; i += 1) {
    out.push([i])
    for (let j = i + 1; j < text.length; j += 1) out.push([i, j])
  }
  return out
}

test('🔴 引擎版 ↔ 舞台版：同一批语料、全部切点，text 与 events 逐字节相同', { skip: SKIP }, async () => {
  await import(pathToFileURL(STAGE_FILE).href)
  const stage = globalThis.__SOCRATIC_EMOTION_PARSE__
  assert.ok(stage, '舞台版没有挂到 globalThis.__SOCRATIC_EMOTION_PARSE__')
  assert.equal(typeof stage.createEmotionStreamParser, 'function', '舞台版缺 createEmotionStreamParser')

  let compared = 0
  for (const sample of CORPUS) {
    for (const cuts of allSplits(sample)) {
      const engine = feed(createEmotionStreamParser, sample, cuts)
      const browser = feed(stage.createEmotionStreamParser, sample, cuts)
      assert.equal(
        browser.text,
        engine.text,
        `文本不一致：${JSON.stringify(sample)} 切分 ${JSON.stringify(cuts)}`,
      )
      assert.deepEqual(
        browser.events,
        engine.events,
        `事件不一致：${JSON.stringify(sample)} 切分 ${JSON.stringify(cuts)}`,
      )
      compared += 1
    }
  }
  assert.ok(compared > 100, `比对格子太少（${compared}）——语料或切分生成出了问题`)
})

test('🔴 引擎版 ↔ 舞台版：整串剥离（strip）也一致', { skip: SKIP }, async () => {
  await import(pathToFileURL(STAGE_FILE).href)
  const stage = globalThis.__SOCRATIC_EMOTION_PARSE__
  assert.equal(typeof stage.strip, 'function', '舞台版缺 strip')
  for (const sample of CORPUS) {
    assert.equal(stage.strip(sample), stripEmotionMarkers(sample), `整串剥离不一致：${JSON.stringify(sample)}`)
  }
})

test('🔴 引擎版 ↔ 舞台版：标签集相同（值域漂移＝判据漂移）', { skip: SKIP }, async () => {
  await import(pathToFileURL(STAGE_FILE).href)
  const stage = globalThis.__SOCRATIC_EMOTION_PARSE__
  assert.deepEqual([...stage.labels].sort(), ['calm', 'excited', 'happy', 'puzzled', 'shy'])
})
