// test/expression.test.mjs — EXPR-1／EXPR-2（老师自己决定表情 + 没指定时兜底）的单测
//
// 覆盖五层：
//   ① lib/expression.mjs 的**纯逻辑**：13 条线索逐条自测、情绪→槽位、能力清单取值、状态文本
//   ② lib/expression-table.json 的**表校验**（缺字段/坏正则/枚举外的情绪 → 报错）
//   ③ lib/expressionstore.mjs 的**三条并列路径**：命名表情 / 逐参数直驱 / 动作（含非法名报错带清单）
//   ④ **0 个命名表情的模型（初音ミク）**：命名路必须报错并指向另两条，另两条必须真的能用
//   ⑤ 🔴 **EXPR-2 两处修正**：挑路按**名字可读性**计分（`F0x` 仍可用但不优选）＋
//      兜底**每个 pre-step 重算**（且回归：不覆盖老师本回合的显式指定）
//
// 🔴 全部用临时目录与**注入的原子写**，不碰任何教室真文件。
// 运行：/opt/homebrew/bin/node --test test/expression.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EXPRESSION_DISCIPLINE_RULES,
  EXPRESSION_NOTE_REQUEST_VALUE,
  EXPRESSION_PATH_TIEBREAK,
  EXPRESSION_NONE,
  EXPRESSION_STATE_FILE,
  buildExpressToolDescription,
  describePathChoice,
  emotionFor,
  expressionCapabilityFor,
  expressionForEmotion,
  expressToolParameters,
  faceParamsForEmotion,
  groupParameters,
  loadExpressionTable,
  normalizeParameterId,
  parseExpressionState,
  parseFaceParams,
  pathRanking,
  pickPath,
  readabilityOfName,
  readExpressionTable,
  renderExpressionState,
  renderFaceParams,
  scoreNames,
  slotForEmotion,
} from '../lib/expression.mjs'
import { assistantTextsOfTurn, createExpressionStore, EXPRESSION_FILE } from '../lib/expressionstore.mjs'

const TABLE = readExpressionTable()

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'expr1-'))
}

/** 注入的原子写（真写文件，但不依赖宿主包）。 */
const io = { writeFileAtomic: async (file, text) => writeFileSync(file, text) }

// ── 能力发现产物的两种真实形态 ────────────────────────────────────────────────
/** Haru：8 个**命名表情**（官方样本，实测 expressionCount=8）。 */
const HARU = {
  expressions: [
    { name: 'F01', index: 0 },
    { name: 'F02', index: 1 },
    { name: 'F03', index: 2 },
    { name: 'F04', index: 3 },
    { name: 'F05', index: 4 },
    { name: 'F06', index: 5 },
    { name: 'F07', index: 6 },
    { name: 'F08', index: 7 },
  ],
  phaseExpression: { expressionNames: ['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08'] },
  parameters: [
    { id: 'PARAM_EYE_L_OPEN' },
    { id: 'PARAM_EYE_R_OPEN' },
    { id: 'PARAM_MOUTH_OPEN_Y' },
    { id: 'PARAM_BODY_ANGLE_X' },
  ],
}

/** 初音ミク（FREE `miku`）：**命名表情 0 个**，脸部参数 17 个（眼 6／眉 8／口 2／颊 1）。 */
const MIKU = {
  expressions: [],
  lipSync: { status: 'ok', parameter: 'PARAM_MOUTH_OPEN_Y', parameters: ['PARAM_MOUTH_OPEN_Y'] },
  phaseExpression: { available: false, expressionNames: [], status: 'unavailable' },
  parameters: [
    'PARAM_ANGLE_X',
    'PARAM_ANGLE_Y',
    'PARAM_ANGLE_Z',
    'PARAM_EYE_L_OPEN',
    'PARAM_EYE_L_SMILE',
    'PARAM_EYE_R_OPEN',
    'PARAM_EYE_R_SMILE',
    'PARAM_EYE_BALL_X',
    'PARAM_EYE_BALL_Y',
    'PARAM_BROW_L_Y',
    'PARAM_BROW_R_Y',
    'PARAM_BROW_L_X',
    'PARAM_BROW_R_X',
    'PARAM_BROW_L_ANGLE',
    'PARAM_BROW_R_ANGLE',
    'PARAM_BROW_L_FORM',
    'PARAM_BROW_R_FORM',
    'PARAM_MOUTH_FORM',
    'PARAM_MOUTH_OPEN_Y',
    'PARAM_CHEEK',
    'PARAM_ARM_L',
    'PARAM_ARM_R',
    'PARAM_BODY_ANGLE_X',
    'PARAM_BODY_ANGLE_Y',
    'PARAM_BODY_ANGLE_Z',
    'PARAM_BREATH',
    'PARAM_HAIR_FRONT',
    'PARAM_HAIR_BACK',
    'PARAM_HAIR_BACK_L',
    'PARAM_HAIR_BACK_R',
  ],
}

/**
 * 分层立绘转出的 `.moc3`（`image2live2d` / `psd2live` 产物）——**第三种情况**：
 * 只有 motion3、没有 exp3.json → **命名表情 0 个**、**没有额外脸部参数**，但有 **17 组动作**。
 * （数据形状照主代理 2026-09-24 实测：动作组名是英文且有语义）
 */
const LAYERED = {
  expressions: [],
  phaseExpression: { available: false, expressionNames: [], status: 'unavailable' },
  parameters: [],
  motionGroups: [
    { name: 'Idle', count: 1 },
    { name: 'Smile', count: 1 },
    { name: 'Surprise', count: 1 },
    { name: 'Sad', count: 1 },
    { name: 'Angry', count: 1 },
    { name: 'Shy', count: 1 },
    { name: 'Head_yaw', count: 1 },
    { name: 'Body_sway', count: 1 },
    { name: 'Talk', count: 1 },
    { name: 'Blink', count: 1 },
    { name: 'Nod', count: 1 },
    { name: 'Shake', count: 1 },
    { name: 'Think', count: 1 },
    { name: 'Serious', count: 1 },
    { name: 'Calm', count: 1 },
    { name: 'Laugh', count: 1 },
    { name: 'Wait', count: 1 },
  ],
}

/** 写一份能力发现产物到临时目录，返回绝对路径。 */
function writeCapability(table, name = 'capability.json') {
  const dir = tmpDir()
  const file = join(dir, name)
  writeFileSync(file, JSON.stringify(table, null, 1))
  return file
}

function makeStore({ capability, model, runtimeDir, turn = 1 }) {
  return createExpressionStore({
    capabilityFile: writeCapability(capability),
    model,
    runtimeDir: () => runtimeDir,
    getTurn: () => turn,
    atomicWrite: io,
  })
}

// ════════════════════════════════════════════════════════════════════════════
// ① 13 条线索逐条自测（**真跑，下面会打印原始表**）
// ════════════════════════════════════════════════════════════════════════════

/** 每条线索的探针：一条只（尽量）命中该线索的文本 ＋ 期望情绪。 */
const CUE_PROBES = [
  ['ex', '跑起来了！', 'excited'],
  ['q', '这样可以吗？', 'question'],
  ['negative', '这个失败了', 'angry'],
  ['angryCue', '闭嘴', 'angry'],
  ['apologetic', '对不起', 'sad'],
  ['positive', '搞定了', 'happy'],
  ['softCue', '大丈夫', 'soft'],
  ['surpriseCue', 'えっ、そうなの', 'surprised'],
  ['blushCue', '脸红', 'blush'],
  ['thinkingCue', '让我想想', 'thinking'],
  ['annoyedCue', '真是的', 'annoyed'],
  ['indifferentCue', '随便吧', 'indifferent'],
  ['ellipsisTail', '再说吧…', 'soft'],
]

test('13 条线索逐条自测：每条都真的命中，并给出它落到的情绪（打印原始表）', () => {
  const rows = []
  for (const [cue, text, expected] of CUE_PROBES) {
    const regex = new RegExp(TABLE.cues[cue].pattern)
    const subject = TABLE.cues[cue].input === 'trimmed' ? text.trim() : text
    const cueHit = regex.test(subject)
    const matched = Object.entries(TABLE.cues)
      .filter(([, c]) => new RegExp(c.pattern).test(c.input === 'trimmed' ? text.trim() : text))
      .map(([name]) => name)
    const emotion = emotionFor(text, TABLE)
    rows.push({ cue, text, cueHit, matchedCues: matched.join('+'), emotion })
    assert.equal(cueHit, true, `线索 ${cue} 没被 ${JSON.stringify(text)} 命中`)
    assert.equal(emotion, expected, `线索 ${cue} 的文本 ${JSON.stringify(text)} 落到 ${emotion}，期望 ${expected}`)
  }
  console.log('\n=== 13 条线索逐条自测（原始输出） ===')
  console.log('线索 | 探针文本 | 该线索命中 | 全部命中线索 | 落到的情绪')
  for (const r of rows) {
    console.log(`${r.cue} | ${r.text} | ${r.cueHit} | ${r.matchedCues} | ${r.emotion}`)
  }
  console.log('=== 表结束 ===\n')
  assert.equal(rows.length, 13, '线索自测必须覆盖全部 13 条')
})

test('优先级即语义：感叹号＋负面 → furious，感叹号＋正面 → elated（顺序不许改）', () => {
  assert.equal(emotionFor('失败了！', TABLE), 'furious')
  assert.equal(emotionFor('成功了！', TABLE), 'elated')
  // 同样两个线索，去掉感叹号就落到低优先级那档
  assert.equal(emotionFor('失败了', TABLE), 'angry')
  assert.equal(emotionFor('成功了', TABLE), 'happy')
})

test('命不中任何线索 → default（neutral）', () => {
  assert.equal(emotionFor('今天讲了进程调度', TABLE), 'neutral')
  assert.equal(emotionFor('', TABLE), 'neutral')
  assert.equal(TABLE.default, 'neutral')
})

test('标点独立成一维：？→ question；而 surpriseCue 优先级更高，含「何」的问句先命中它', () => {
  assert.equal(emotionFor('这样可以吗？', TABLE), 'question')
  assert.equal(emotionFor('真的假的？', TABLE), 'surprised')
  // 注意「为什么」里**没有**「何」字（本表是逐字照抄上游，不做同义扩展）
  assert.equal(emotionFor('为什么？', TABLE), 'question')
})

test('行尾省略号 → soft（⚠️ 与 softCue 重叠：本表忠实照抄上游，两条路径都指向 soft）', () => {
  assert.equal(emotionFor('再说吧…', TABLE), 'soft')
  assert.equal(emotionFor('再说吧⋯', TABLE), 'soft')
  // ellipsisTail 只在"文本里没有其它 soft 线索"时才可能是唯一命中者——此处记录该重叠事实
  assert.equal(new RegExp(TABLE.cues.softCue.pattern).test('…'), true)
  assert.equal(new RegExp(TABLE.cues.ellipsisTail.pattern).test('…'.trim()), true)
})

// ════════════════════════════════════════════════════════════════════════════
// ② 表校验（坏表必须报错，不静默）
// ════════════════════════════════════════════════════════════════════════════

test('表校验：format 不对 / 缺字段 / 坏正则 / 枚举外的情绪 / 槽位越界 → 全部报错', () => {
  const good = JSON.parse(readFileSync(new URL('../lib/expression-table.json', import.meta.url), 'utf8'))
  const clone = () => JSON.parse(JSON.stringify(good))
  assert.equal(loadExpressionTable(clone()).emotions.length, 18)

  const badFormat = clone()
  badFormat.format = 'x'
  assert.throws(() => loadExpressionTable(badFormat), /format/)

  const badRegex = clone()
  badRegex.cues.ex = { pattern: '([' }
  assert.throws(() => loadExpressionTable(badRegex), /不是合法正则/)

  const badEmotion = clone()
  badEmotion.rules[0].emotion = 'rage'
  assert.throws(() => loadExpressionTable(badEmotion), /不在 emotions 枚举内/)

  const deadRule = clone()
  deadRule.rules[0] = { emotion: 'happy' }
  assert.throws(() => loadExpressionTable(deadRule), /既没有 all 也没有 any/)

  const unknownCue = clone()
  unknownCue.rules[0] = { emotion: 'happy', any: ['nope'] }
  assert.throws(() => loadExpressionTable(unknownCue), /不存在的线索/)

  const missingSlot = clone()
  delete missingSlot.emotionSlot.disappointed
  assert.throws(() => loadExpressionTable(missingSlot), /emotionSlot 缺少/)

  const badSlot = clone()
  badSlot.emotionSlot.happy = 99
  assert.throws(() => loadExpressionTable(badSlot), /超出 slots 范围/)

  const missingSlotFace = clone()
  delete missingSlotFace.slotFace.angry
  assert.throws(() => loadExpressionTable(missingSlotFace), /slotFace 缺少/)

  const badRole = clone()
  badRole.slotFace.happy.nosuchrole = 1
  assert.throws(() => loadExpressionTable(badRole), /未定义的角色/)

  const badValue = clone()
  badValue.slotFace.happy.eye_smile = 'high'
  assert.throws(() => loadExpressionTable(badValue), /必须是有限数值/)
})

// ════════════════════════════════════════════════════════════════════════════
// ③ 能力清单取值（两条并列的路）
// ════════════════════════════════════════════════════════════════════════════

test('能力清单：Haru 有命名表情 + 参数 → 命名表情与逐参数都可用', () => {
  const cap = expressionCapabilityFor({ Haru: HARU }, 'Haru')
  assert.equal(cap.ok, true)
  assert.equal(cap.namedPath, true)
  assert.equal(cap.paramPath, true)
  assert.equal(cap.names.length, 8)
  assert.equal(cap.parameters.length, 4)
})

test('🔴 能力清单：miku 命名表情 = 0 但参数 17 个 → **可用**（不许变成"没有任何可选项"）', () => {
  const cap = expressionCapabilityFor({ miku: MIKU }, 'miku')
  assert.equal(cap.ok, true, cap.reason)
  assert.equal(cap.namedPath, false)
  assert.equal(cap.paramPath, true)
  assert.equal(cap.names.length, 0)
  assert.equal(cap.parameters.length, 30)
  const face = cap.dimensions.filter((d) => d.group !== 'other')
  const count = (group) => face.find((d) => d.group === group)?.parameters.length ?? 0
  console.log('\n=== miku 的维度（原始输出）===')
  console.log(cap.dimensions.map((d) => `${d.label}(${d.group}) ${d.parameters.length} 个：${d.parameters.join(',')}`).join('\n'))
  console.log('=== 维度表结束 ===\n')
  assert.equal(count('eye'), 6, '眼 6 个')
  assert.equal(count('brow'), 8, '眉 8 个')
  assert.equal(count('mouth'), 2, '口 2 个')
  assert.equal(count('cheek'), 1, '颊 1 个')
  assert.equal(count('eye') + count('brow') + count('mouth') + count('cheek'), 17, '脸部参数共 17 个')
})

test('能力清单：模型名不在产物里 / 模型名缺省 / 三种手段都空 → 各自的明确原因', () => {
  const missing = expressionCapabilityFor({ Haru: HARU }, 'Natori')
  assert.equal(missing.ok, false)
  assert.match(missing.reason, /没有模型 "Natori"/)
  assert.match(missing.reason, /Haru/)

  const noModel = expressionCapabilityFor({ Haru: HARU }, '')
  assert.equal(noModel.ok, false)
  assert.match(noModel.reason, /未指定模型名/)

  const nothing = expressionCapabilityFor({ X: { expressions: [], parameters: [], motionGroups: [] } }, 'X')
  assert.equal(nothing.ok, false)
  assert.match(nothing.reason, /三种表达手段一个都没有/)
  assert.match(nothing.reason, /无法表达情绪/)
})

test('维度归维：按 id 归类，认不出的落 other；顺序即 PARAMETER_DIMENSIONS', () => {
  const groups = groupParameters(['PARAM_MOUTH_FORM', 'PARAM_EYE_L_OPEN', 'PARAM_BREATH', 'PARAM_CHEEK'])
  assert.deepEqual(
    groups.map((g) => g.group),
    ['eye', 'mouth', 'cheek', 'other'],
  )
})

test('情绪 → 槽位 → 命名表情：按下标取模，不猜名字语义', () => {
  assert.equal(slotForEmotion('happy', TABLE), 1)
  const picked = expressionForEmotion('happy', ['F01', 'F02', 'F03', 'F04'], TABLE)
  assert.deepEqual(picked, { name: 'F02', index: 1, slot: 1 })
  // 表情数少于槽位数 → 取模回绕（如实回绕，不假装有更多表情）
  const wrapped = expressionForEmotion('indifferent', ['F01', 'F02'], TABLE)
  assert.equal(wrapped.index, 1)
  assert.throws(() => expressionForEmotion('happy', [], TABLE), /没有命名表情/)
  assert.throws(() => slotForEmotion('rage', TABLE), /未知情绪/)
})

test('情绪 → 逐参数：角色正则只在本模型**真实参数**里匹配，匹配不到的角色如实报出', () => {
  const mikuIds = MIKU.parameters
  const happy = faceParamsForEmotion('happy', mikuIds, TABLE)
  const mikuCap = expressionCapabilityFor({ miku: MIKU }, 'miku')
  console.log('\n=== 逐参数兜底（原始输出，miku 参数集；**已按兜底口径排除嘴型通道参数**）===')
  for (const emotion of ['happy', 'excited', 'thinking', 'sad', 'angry', 'soft', 'indifferent', 'neutral']) {
    const r = faceParamsForEmotion(emotion, mikuIds, TABLE, { exclude: mikuCap.lipSyncParameters })
    console.log(
      `${emotion} → 槽位 ${r.slot}｜${Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(' ')}｜` +
        `缺角色 ${r.missingRoles.join(',') || '无'}｜跳过嘴参数 ${r.skippedIds.join(',') || '无'}`,
    )
  }
  console.log('=== 逐参数表结束 ===\n')
  assert.equal(happy.slot, 'happy')
  // eye_smile 在 miku 上命中左右眼两个参数（一个角色 → 多个参数）
  assert.equal(happy.params.PARAM_EYE_L_SMILE, 1)
  assert.equal(happy.params.PARAM_EYE_R_SMILE, 1)
  assert.equal(happy.params.PARAM_MOUTH_FORM, 0.8)
  assert.equal(happy.params.PARAM_BROW_L_Y, 0.4)
  assert.equal(happy.params.PARAM_BROW_R_Y, 0.4)
  assert.deepEqual(happy.missingRoles, [])
  assert.equal(faceParamsForEmotion('neutral', mikuIds, TABLE).params && Object.keys(faceParamsForEmotion('neutral', mikuIds, TABLE).params).length, 0)
  // 参数集为空 → 报错（不静默返回空对象）
  assert.throws(() => faceParamsForEmotion('happy', [], TABLE), /没有可用的脸部参数/)
})

test('参数序列化／反序列化：renderFaceParams ↔ parseFaceParams 往返一致', () => {
  const params = { PARAM_MOUTH_FORM: 0.8, PARAM_CHEEK: 1 }
  const text = renderFaceParams(params)
  assert.equal(text, 'PARAM_CHEEK=1,PARAM_MOUTH_FORM=0.8') // 按 id 排序，确定性
  assert.deepEqual(parseFaceParams(text), params)
  assert.equal(renderFaceParams({}), EXPRESSION_NONE)
  assert.deepEqual(parseFaceParams(EXPRESSION_NONE), {})
})

// ════════════════════════════════════════════════════════════════════════════
// ④ 状态文件：渲染 ↔ 解析
// ════════════════════════════════════════════════════════════════════════════

test('状态文件：命名表情路 / 逐参数路 / 不可用 三种形态都能往返解析（动作路见后一条）', () => {
  const named = renderExpressionState({
    expression: 'F04',
    face: {},
    origin: 'teacher',
    emotion: null,
    turn: 7,
    capability: 'ok',
    model: 'Haru',
    names: ['F01', 'F02'],
    dimensions: [],
  })
  assert.match(named, /^# 本课表情/)
  const parsedNamed = parseExpressionState(named)
  assert.equal(parsedNamed.expression, 'F04')
  assert.equal(parsedNamed.origin, 'teacher')
  assert.equal(parsedNamed.turn, 7)
  assert.equal(parsedNamed.capability, 'ok')
  assert.deepEqual(parsedNamed.face, {})

  const face = renderExpressionState({
    expression: null,
    face: { PARAM_CHEEK: 1 },
    origin: 'fallback',
    emotion: 'blush',
    turn: 3,
    capability: 'ok',
    model: 'miku',
    names: [],
    dimensions: [{ group: 'cheek', label: '颊', parameters: ['PARAM_CHEEK'] }],
  })
  const parsedFace = parseExpressionState(face)
  assert.equal(parsedFace.expression, null)
  assert.deepEqual(parsedFace.face, { PARAM_CHEEK: 1 })
  assert.equal(parsedFace.origin, 'fallback')
  assert.equal(parsedFace.emotion, 'blush')
  assert.match(face, /颊 1 个/)

  const unavailable = renderExpressionState({
    expression: null,
    face: {},
    origin: 'unavailable',
    emotion: null,
    turn: 4,
    capability: 'unavailable',
    note: '读不到能力发现产物 /x/y.json',
  })
  const parsedUnavailable = parseExpressionState(unavailable)
  assert.equal(parsedUnavailable.origin, 'unavailable')
  assert.equal(parsedUnavailable.capability, 'unavailable')
  assert.match(parsedUnavailable.note, /读不到能力发现产物/)
  assert.equal(EXPRESSION_STATE_FILE, 'expression.md')
})

test('🔴 状态文件：expression_note **始终**写明「本文件记录的是请求值」（引擎不夹取，读的人要知道）', () => {
  // 可用（命名表情路）：没有"不可用原因"，但那句说明必须在
  const ok = renderExpressionState({
    expression: 'F04',
    face: {},
    origin: 'teacher',
    emotion: null,
    turn: 7,
    capability: 'ok',
  })
  assert.match(ok, new RegExp(`^expression_note: ${EXPRESSION_NOTE_REQUEST_VALUE}$`, 'm'))
  // 不可用：原因在前、那句说明在后，两段都要在（原因不许被那句说明顶掉）
  const dead = renderExpressionState({
    expression: null,
    face: {},
    origin: 'unavailable',
    emotion: null,
    turn: 8,
    capability: 'unavailable',
    note: '读不到能力发现产物 /x/y.json',
  })
  const noteLine = dead.split('\n').find((line) => line.startsWith('expression_note: '))
  assert.ok(noteLine.includes('读不到能力发现产物 /x/y.json'), '原因必须原样还在（面板要显示它）')
  assert.ok(noteLine.includes(EXPRESSION_NOTE_REQUEST_VALUE), '那句说明必须也在')
  assert.match(parseExpressionState(dead).note, /读不到能力发现产物/)
  // 夹取行为不在这棵树里：引擎侧**不**改值、**不**写夹取账（只有渲染侧有权威值域）
  assert.match(ok, /^expression_face: -$/m)
})

// ════════════════════════════════════════════════════════════════════════════
// ⑤ 状态仓：两条路径的落盘与报错契约
// ════════════════════════════════════════════════════════════════════════════

test('命名表情路：合法名通过并落盘；同一回合重复指定以最后一次为准（幂等、可重入）', async () => {
  const runtimeDir = tmpDir()
  const logs = []
  const store = createExpressionStore({
    capabilityFile: writeCapability({ Haru: HARU }),
    model: 'Haru',
    runtimeDir: () => runtimeDir,
    getTurn: () => 5,
    atomicWrite: io,
    log: (m) => logs.push(m),
  })
  const first = await store.specify({ expression: 'F02' })
  assert.equal(first.path, 'named-expression')
  assert.equal(first.expression, 'F02')
  assert.equal(first.origin, 'teacher')
  assert.equal(first.availableCount, 8)
  assert.equal(first.persisted, true)
  assert.equal(existsSync(join(runtimeDir, EXPRESSION_FILE)), true)
  assert.equal(parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8')).expression, 'F02')

  const second = await store.specify({ expression: 'F07' })
  assert.equal(second.expression, 'F07')
  assert.equal(parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8')).expression, 'F07')
  assert.equal(store.status().expression, 'F07')
  assert.equal(store.status().turn, 5)
  // 🔴 「在日志里说清」：老师指定也要留痕（第几回合、指定了什么、共几个可选）
  assert.ok(
    logs.some((m) => m.includes('老师指定命名表情 F07') && m.includes('第 5 回合') && m.includes('8 个可选')),
    `日志里没有指定链路：${logs.join(' | ')}`,
  )
})

test('🔴 非法／不存在的表情名 → 报错，且错误里带**完整可用清单**（不许静默忽略）', async () => {
  const runtimeDir = tmpDir()
  const store = makeStore({ capability: { Haru: HARU }, model: 'Haru', runtimeDir })
  await assert.rejects(
    () => store.specify({ expression: 'smile03' }),
    (error) => {
      assert.match(error.message, /没有命名表情 "smile03"/)
      for (const name of ['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08']) {
        assert.ok(error.message.includes(name), `错误里缺可用名 ${name}`)
      }
      return true
    },
  )
  // 报错不得落盘（什么都没生效）
  assert.equal(existsSync(join(runtimeDir, EXPRESSION_FILE)), false)
})

test('🔴 逐参数路：合法参数通过并落盘；非法参数名 → 报错且列出全部参数', async () => {
  const runtimeDir = tmpDir()
  const store = makeStore({ capability: { miku: MIKU }, model: 'miku', runtimeDir })
  const ok = await store.specify({ face: { PARAM_CHEEK: 1, PARAM_MOUTH_FORM: 0.5 } })
  assert.equal(ok.path, 'face-parameters')
  assert.equal(ok.expression, '')
  assert.match(ok.face, /PARAM_CHEEK=1/)
  assert.equal(ok.availableCount, 30) // 走逐参数路时 availableCount ＝ 参数个数
  assert.match(ok.dimensions, /眼 6 个/)
  const written = parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8'))
  assert.deepEqual(written.face, { PARAM_CHEEK: 1, PARAM_MOUTH_FORM: 0.5 })
  assert.equal(written.origin, 'teacher')

  await assert.rejects(
    () => store.specify({ face: { ParamMouthOpenY: 1 } }),
    (error) => {
      assert.match(error.message, /没有参数 "ParamMouthOpenY"/)
      assert.match(error.message, /PARAM_MOUTH_OPEN_Y/)
      assert.match(error.message, /眼 6 个/)
      return true
    },
  )
  await assert.rejects(() => store.specify({ face: {} }), /空对象/)
  await assert.rejects(() => store.specify({ face: { PARAM_CHEEK: 'on' } }), /必须是有限数值/)
})

test('🔴 三条路只能选一条：同时给两条 → 报错；一条都不给 → 报错', async () => {
  const runtimeDir = tmpDir()
  const store = makeStore({ capability: { Haru: HARU }, model: 'Haru', runtimeDir })
  await assert.rejects(() => store.specify({ expression: 'F01', face: { PARAM_CHEEK: 1 } }), /一次只能给一条/)
  await assert.rejects(() => store.specify({ face: { PARAM_CHEEK: 1 }, motion: 'Idle' }), /一次只能给一条/)
  await assert.rejects(() => store.specify({}), /需要 `expression`/)
})

test('🔴 对 0 个命名表情的模型走命名路 → 报错并**指向另外两条**（这就是"三条并列"的验收）', async () => {
  const runtimeDir = tmpDir()
  const store = makeStore({ capability: { miku: MIKU }, model: 'miku', runtimeDir })
  await assert.rejects(
    () => store.specify({ expression: 'F01' }),
    (error) => {
      assert.match(error.message, /没有命名表情/)
      assert.match(error.message, /改用 `face`（逐参数）或 `motion`（动作组）/)
      assert.match(error.message, /眼 6 个/)
      return true
    },
  )
})

test('能力发现不可用（文件读不到 / 模型不在产物里 / 三种手段都空）→ 工具**明说不可用**，不静默', async () => {
  const runtimeDir = tmpDir()
  const missingFile = createExpressionStore({
    capabilityFile: join(tmpDir(), 'nope.json'),
    model: 'Haru',
    runtimeDir: () => runtimeDir,
    getTurn: () => 1,
    atomicWrite: io,
  })
  const capMissing = await missingFile.capability()
  assert.equal(capMissing.ok, false)
  assert.match(capMissing.reason, /读不到渲染侧能力发现产物/)
  await assert.rejects(() => missingFile.specify({ expression: 'F01' }), /表情通道不可用/)

  const wrongModel = makeStore({ capability: { Haru: HARU }, model: 'Natori', runtimeDir })
  await assert.rejects(() => wrongModel.specify({ expression: 'F01' }), /没有模型 "Natori"/)

  const nothing = makeStore({ capability: { X: { expressions: [], parameters: [], motionGroups: [] } }, model: 'X', runtimeDir })
  await assert.rejects(() => nothing.specify({ face: { A: 1 } }), /三种表达手段一个都没有/)
})

test('未配置能力来源 → 通道关闭（工具不会被注册；store 仍明说原因）', async () => {
  const store = createExpressionStore({ model: 'Haru', runtimeDir: () => tmpDir(), getTurn: () => 1, atomicWrite: io })
  assert.equal(store.capabilityFile(), null)
  const cap = await store.capability()
  assert.equal(cap.ok, false)
  assert.match(cap.reason, /未配置表情能力来源/)
})

test('capabilityFile 必须是绝对路径（相对路径＝静默指向别处，故当场报错）', () => {
  assert.throws(() => createExpressionStore({ capabilityFile: 'relative/cap.json', model: 'Haru' }), /必须是\*\*绝对路径\*\*/)
})

// ════════════════════════════════════════════════════════════════════════════
// ⑥ 兜底（turn-stopping）：teacher 优先、两条路各自落地
// ════════════════════════════════════════════════════════════════════════════

/** 造一段 session 事件（只用 assistant/message，带 data.turn）。 */
function eventsFor(turn, texts) {
  return [
    { type: 'turn/start', data: { turn } },
    ...texts.map((text) => ({
      type: 'assistant/message',
      data: { turn, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } },
    })),
    { type: 'turn/end', data: { turn } },
  ]
}

test('assistantTextsOfTurn：只取本回合、只取文字块（工具调用不算）', () => {
  const events = [
    { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '上一回合' }] } } },
    {
      type: 'assistant/message',
      data: {
        turn: 2,
        message: {
          content: [
            { type: 'text', text: '这一回合' },
            { type: 'tool-call', name: 'classroom_draw' },
            { type: 'text', text: '   ' },
          ],
        },
      },
    },
  ]
  assert.deepEqual(assistantTextsOfTurn(events, 2), ['这一回合'])
  assert.deepEqual(assistantTextsOfTurn(events, 1), ['上一回合'])
  assert.deepEqual(assistantTextsOfTurn(events, 3), [])
  assert.deepEqual(assistantTextsOfTurn(null, 1), [])
})

test('兜底（命名表情路）：名字**有语义**时走命名路 —— 用本回合最后一段文字推情绪 → 按下标取名字', async () => {
  const runtimeDir = tmpDir()
  const logs = []
  // 🔴 EXPR-2 起：走命名表情路的前提是"它的名字读得懂"（Haru 的 F01…F08 是编号 → 会走逐参数，
  //    见下面那条"兜底也按名字可读性挑路"）。这里用一个名字有语义的模型，专门验命名路本身。
  const NAMED = {
    expressions: [
      { name: 'Smile' }, { name: 'Sad' }, { name: 'Surprise' }, { name: 'Angry' },
      { name: 'Calm' }, { name: 'Shy' }, { name: 'Think' }, { name: 'Blink' },
    ],
  }
  const store = createExpressionStore({
    capabilityFile: writeCapability({ Named: NAMED }),
    model: 'Named',
    runtimeDir: () => runtimeDir,
    getTurn: () => 2,
    atomicWrite: io,
    log: (m) => logs.push(m),
  })
  const result = await store.fallback({ turn: 2, events: eventsFor(2, ['我们来看看这个机制。', '搞定了！']) })
  assert.equal(result.action, 'fallback')
  assert.equal(result.emotion, 'elated') // "搞定了！" → 感叹号＋正面 → elated（优先级第 2 条）
  assert.equal(result.expression, 'Surprise') // elated → 槽位 2 → 下标 2
  const written = parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8'))
  assert.equal(written.origin, 'fallback')
  assert.equal(written.expression, 'Surprise')
  assert.equal(written.emotion, 'elated')
  assert.equal(written.turn, 2)
  // 🔴 「在日志里说清」：兜底链路必须可读（情绪 → 槽位 → 表情 ＋ 候选个数）
  assert.ok(
    logs.some((m) => m.includes('兜底') && m.includes('elated') && m.includes('槽位 2') && m.includes('Surprise')),
    `日志里没有兜底链路：${logs.join(' | ')}`,
  )
})

test('兜底（逐参数路）：0 个命名表情的模型 → 走参数直驱，落盘的是参数而不是名字', async () => {
  const runtimeDir = tmpDir()
  const store = makeStore({ capability: { miku: MIKU }, model: 'miku', runtimeDir, turn: 2 })
  const result = await store.fallback({ turn: 2, events: eventsFor(2, ['失败了！']) })
  assert.equal(result.action, 'fallback')
  assert.equal(result.emotion, 'furious')
  assert.equal(result.expression, null)
  const written = parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8'))
  assert.equal(written.expression, null)
  assert.equal(written.origin, 'fallback')
  assert.equal(written.emotion, 'furious')
  // furious → 槽位 angry → 眼/眉/口 三组都命中
  assert.ok(Object.keys(written.face).length > 0)
  assert.equal(written.face.PARAM_EYE_L_OPEN, 0.9)
})

test('🔴 兜底**不许覆盖**老师本回合的显式指定（teacher 优先级更高）', async () => {
  const runtimeDir = tmpDir()
  const store = makeStore({ capability: { Haru: HARU }, model: 'Haru', runtimeDir, turn: 3 })
  await store.specify({ expression: 'F05' })
  const result = await store.fallback({ turn: 3, events: eventsFor(3, ['失败了！']) })
  assert.equal(result.action, 'kept-teacher')
  assert.equal(result.expression, 'F05')
  const written = parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8'))
  assert.equal(written.expression, 'F05')
  assert.equal(written.origin, 'teacher')
})

test('兜底：本回合没有文字 → 跳过（不写盘、不猜）；能力不可用 → 写 origin=unavailable 并带原因', async () => {
  const runtimeDir = tmpDir()
  const store = makeStore({ capability: { Haru: HARU }, model: 'Haru', runtimeDir, turn: 4 })
  const skipped = await store.fallback({ turn: 4, events: eventsFor(4, []) })
  assert.equal(skipped.action, 'skipped')
  assert.equal(existsSync(join(runtimeDir, EXPRESSION_FILE)), false)

  const dead = createExpressionStore({
    capabilityFile: join(tmpDir(), 'nope.json'),
    model: 'Haru',
    runtimeDir: () => runtimeDir,
    getTurn: () => 4,
    atomicWrite: io,
  })
  const unavailable = await dead.fallback({ turn: 4, events: eventsFor(4, ['搞定了']) })
  assert.equal(unavailable.action, 'unavailable')
  const written = parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8'))
  assert.equal(written.origin, 'unavailable')
  assert.equal(written.capability, 'unavailable')
  assert.match(written.note, /读不到/)
})

test('兜底：内容没变就不重写（turn-stopping 每回合都走这条路，不许抖动）', async () => {
  const runtimeDir = tmpDir()
  const store = makeStore({ capability: { Haru: HARU }, model: 'Haru', runtimeDir, turn: 2 })
  const first = await store.fallback({ turn: 2, events: eventsFor(2, ['搞定了！']) })
  assert.match(first.note, /已写/)
  const second = await store.fallback({ turn: 2, events: eventsFor(2, ['搞定了！']) })
  assert.match(second.note, /内容未变/)
})

test('register：挂 turn-stopping 兜底；钩子里抛错也不打断回合（吞掉并记日志）', async () => {
  const runtimeDir = tmpDir()
  const logs = []
  const store = createExpressionStore({
    capabilityFile: writeCapability({ Haru: HARU }),
    model: 'Haru',
    runtimeDir: () => runtimeDir,
    getTurn: () => 1,
    atomicWrite: io,
    log: (m) => logs.push(m),
  })
  const handlers = new Map()
  const ctx = { on: (name, fn) => handlers.set(name, fn) }
  const registered = store.register(ctx)
  assert.equal(registered.enabled, true)
  assert.equal(typeof handlers.get('agent/turn-stopping'), 'function')

  const session = { snapshotEvents: () => eventsFor(1, ['搞定了！']) }
  await handlers.get('agent/turn-stopping')({ agent: { session }, turn: 1 })
  assert.equal(parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8')).origin, 'fallback')

  // 坏 session：抛错必须被吞掉（turn-stopping 抛错会打断整个回合）
  await handlers.get('agent/turn-stopping')({ agent: { session: { snapshotEvents: () => { throw new Error('boom') } } }, turn: 2 })
  assert.ok(logs.some((m) => m.includes('表情兜底异常')))
  // 无 ctx.on → 明确返回未启用
  assert.equal(store.register({}).enabled, false)
})

// ════════════════════════════════════════════════════════════════════════════
// ⑥-b 🔴 EXPR-2：兜底改成**每个 pre-step 重算**（旧版只在回合末算 → 晚一个回合边界）
// ════════════════════════════════════════════════════════════════════════════

/** 挂上钩子并拿回 handler（与 register 测试同一手法）。 */
function registerHandlers(store) {
  const handlers = new Map()
  const registered = store.register({ on: (name, fn) => handlers.set(name, fn) })
  assert.equal(registered.enabled, true)
  return handlers
}

test('🔴 每 pre-step 重算：钩子存在，且把 decision **原样透传**（waterfall 里不调 next 会否决整条链）', async () => {
  const runtimeDir = tmpDir()
  const store = createExpressionStore({
    capabilityFile: writeCapability({ Haru: HARU }),
    model: 'Haru',
    runtimeDir: () => runtimeDir,
    getTurn: () => 1,
    atomicWrite: io,
  })
  const handlers = registerHandlers(store)
  const preStep = handlers.get('agent/pre-step')
  assert.equal(typeof preStep, 'function')

  const decision = { kind: 'enter', messages: ['用户这条'] }
  let nextCalls = 0
  const passed = await preStep(
    { agent: { session: { snapshotEvents: () => eventsFor(1, []) } }, turn: 1, step: 2 },
    async () => {
      nextCalls += 1
      return decision
    },
  )
  assert.equal(nextCalls, 1, '必须调用 next()——否则链上"注入材料"那个监听器与宿主内建的 enter 决策都会被否决')
  assert.equal(passed, decision, 'decision 必须原样透传（不能吞掉、不能改写）')
})

test('🔴 每 pre-step 重算：本回合文字一出现就当步落盘（不再等到回合末），且回合号＝**宿主**回合号', async () => {
  const runtimeDir = tmpDir()
  const logs = []
  const store = createExpressionStore({
    capabilityFile: writeCapability({ Haru: HARU }),
    model: 'Haru',
    runtimeDir: () => runtimeDir,
    getTurn: () => 99, // 引擎自己的计数器（故意与宿主错开）
    atomicWrite: io,
    log: (m) => logs.push(m),
  })
  const preStep = registerHandlers(store).get('agent/pre-step')
  const session = { snapshotEvents: () => eventsFor(7, ['搞定了！']) }
  await preStep({ agent: { session }, turn: 7, step: 2 }, async () => ({ kind: 'enter', messages: [] }))

  const written = parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8'))
  assert.equal(written.origin, 'fallback')
  assert.equal(written.turn, 7, '状态里的回合号必须是宿主回合号（兜底要按它去 session 里找本回合的文字）')
  assert.ok(logs.some((m) => m.includes('每步重算')), `日志里应标明这是每步重算：${logs.join(' | ')}`)
})

test('🔴 重算的输入只有"本回合已说出口的文字"：还没说 → 跳过；说了 → 写；话变了 → 跟着变；没变 → 不重写', async () => {
  const runtimeDir = tmpDir()
  let writes = 0
  const countingIo = {
    writeFileAtomic: async (file, text) => {
      writes += 1
      writeFileSync(file, text)
    },
  }
  const store = createExpressionStore({
    capabilityFile: writeCapability({ Haru: HARU }),
    model: 'Haru',
    runtimeDir: () => runtimeDir,
    getTurn: () => 1,
    atomicWrite: countingIo,
  })
  const preStep = registerHandlers(store).get('agent/pre-step')
  const decision = { kind: 'enter', messages: [] }
  let texts = []
  const session = { snapshotEvents: () => eventsFor(3, texts) }

  // step 1：本回合还没有任何文字 → 无依据可推 → 不写盘、不猜下一句
  await preStep({ agent: { session }, turn: 3, step: 1 }, async () => decision)
  assert.equal(existsSync(join(runtimeDir, EXPRESSION_FILE)), false, '本回合还没说话时不许写盘')

  // step 2：第 1 步说了一句负面 → 当步写出兜底值
  texts = ['这个失败了']
  await preStep({ agent: { session }, turn: 3, step: 2 }, async () => decision)
  assert.equal(parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8')).emotion, 'angry')
  const afterFirst = writes

  // step 3：又说了句带感叹号的负面 → 情绪变了 → 跟着更新
  texts = ['这个失败了', '这个失败了！']
  await preStep({ agent: { session }, turn: 3, step: 3 }, async () => decision)
  assert.equal(parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8')).emotion, 'furious')
  assert.ok(writes > afterFirst, '情绪变了必须重写')

  // step 4：本回合文字没变 → 内容未变 → **不重写**（每步都写会抖动）
  const beforeIdle = writes
  await preStep({ agent: { session }, turn: 3, step: 4 }, async () => decision)
  assert.equal(writes, beforeIdle, '内容没变时不许重写')
})

test('🔴 回归：pre-step 重算**不许覆盖**老师本回合的显式指定', async () => {
  const runtimeDir = tmpDir()
  const store = createExpressionStore({
    capabilityFile: writeCapability({ Haru: HARU }),
    model: 'Haru',
    runtimeDir: () => runtimeDir,
    getTurn: () => 1, // 引擎计数器；宿主说这是第 5 回合 → 两者故意错开
    atomicWrite: io,
  })
  const preStep = registerHandlers(store).get('agent/pre-step')
  const decision = { kind: 'enter', messages: [] }
  const session = { snapshotEvents: () => eventsFor(5, ['失败了！']) }

  // 第 5 回合第 1 步：老师还没说话 → 兜底跳过（此时也把"本回合＝5"记下来）
  await preStep({ agent: { session }, turn: 5, step: 1 }, async () => decision)
  // 老师在同一回合里显式指定（工具调用发生在 step 内，pre-step 已经见过 turn=5）
  await store.specify({ expression: 'F05' })
  assert.equal(store.status().turn, 5, '老师指定记的必须是**宿主**回合号（否则下面那条判据会失效）')

  // 之后的每一步都会重算 → 必须 kept-teacher，不许把老师冲掉
  await preStep({ agent: { session }, turn: 5, step: 2 }, async () => decision)
  const written = parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8'))
  assert.equal(written.expression, 'F05')
  assert.equal(written.origin, 'teacher')
  assert.equal(written.turn, 5)
})

test('🔴 引擎计数器与宿主回合号错开时，"兜底不覆盖老师"仍然成立（统一用宿主回合号）', async () => {
  const runtimeDir = tmpDir()
  const store = createExpressionStore({
    capabilityFile: writeCapability({ Haru: HARU }),
    model: 'Haru',
    runtimeDir: () => runtimeDir,
    getTurn: () => 1,
    atomicWrite: io,
  })
  const preStep = registerHandlers(store).get('agent/pre-step')
  const decision = { kind: 'enter', messages: [] }
  const session = { snapshotEvents: () => eventsFor(9, ['这个失败了！']) }
  await preStep({ agent: { session }, turn: 9, step: 1 }, async () => decision)
  await store.specify({ expression: 'F02' })
  // 直接调 fallback 也认得出"本回合老师指定过"（同一条判据，两处钩子共用）
  const kept = await store.fallback({ turn: 9, events: eventsFor(9, ['这个失败了！']), when: 'pre-step' })
  assert.equal(kept.action, 'kept-teacher')
  assert.equal(kept.expression, 'F02')
  // 旧实现会拿引擎计数器 1 去比宿主回合 9 → 判不出"老师本回合指定过" → 把老师冲成兜底值
  assert.equal(parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8')).expression, 'F02')
})

test('pre-step 钩子：signal 已中止 / 取不到 session / session 抛错 → 都不打断（吞掉并记日志）', async () => {
  const runtimeDir = tmpDir()
  const logs = []
  const store = createExpressionStore({
    capabilityFile: writeCapability({ Haru: HARU }),
    model: 'Haru',
    runtimeDir: () => runtimeDir,
    getTurn: () => 1,
    atomicWrite: io,
    log: (m) => logs.push(m),
  })
  const preStep = registerHandlers(store).get('agent/pre-step')
  const decision = { kind: 'enter', messages: [] }
  // 已中止 → 不动
  await preStep({ agent: { session: { snapshotEvents: () => eventsFor(1, ['搞定了！']) } }, turn: 1, step: 1, signal: { aborted: true } }, async () => decision)
  assert.equal(existsSync(join(runtimeDir, EXPRESSION_FILE)), false)
  // 取不到 session → 记日志、不抛
  await preStep({ turn: 1, step: 1 }, async () => decision)
  assert.ok(logs.some((m) => m.includes('取不到 session')), logs.join(' | '))
  // session 抛错 → 吞掉
  await preStep({ agent: { session: { snapshotEvents: () => { throw new Error('boom') } } }, turn: 2, step: 1 }, async () => decision)
  assert.ok(logs.some((m) => m.includes('表情兜底异常')), logs.join(' | '))
  // reject 的 step 不重算（那一轮根本不会进）
  await preStep({ agent: { session: { snapshotEvents: () => eventsFor(3, ['搞定了！']) } }, turn: 3, step: 1 }, async () => ({ kind: 'reject' }))
  assert.equal(existsSync(join(runtimeDir, EXPRESSION_FILE)), false)
})

test('落盘失败不抛：runtimeDir 未确定时如实回报 persisted=false', async () => {
  const store = createExpressionStore({
    capabilityFile: writeCapability({ Haru: HARU }),
    model: 'Haru',
    runtimeDir: () => null,
    getTurn: () => 1,
    atomicWrite: io,
  })
  const result = await store.specify({ expression: 'F01' })
  assert.equal(result.persisted, false)
  assert.match(result.note, /runtime\/ 目录尚未确定/)
  assert.equal(store.status().expression, 'F01') // 会话内仍然生效（内存态是真源）
})

test('🔴 参数规格自检：每个 object 型节点都必须显式写 additionalProperties（宿主编译器强制）', () => {
  // 依据：宿主 `dsh-tools` 的 runSchemaCompiler 对 `type:'object'` 逐字报
  //   `…additionalProperties must be explicitly true or false`。
  //   这条是**真会话第一次跑就炸出来的**（装载即失败 UNSUPPORTED_SCHEMA，见报告 §4）——
  //   规格放在纯逻辑层，就是为了让它在单测里当场红，而不是等一次真会话。
  const spec = expressToolParameters()
  const walk = (node, path) => {
    if (node === null || typeof node !== 'object') return
    if (node.type === 'object') {
      assert.equal(typeof node.additionalProperties, 'boolean', `${path} 缺显式 additionalProperties`)
      for (const [key, child] of Object.entries(node.properties ?? {})) walk(child, `${path}.properties.${key}`)
    }
    if (node.type === 'array' && node.items !== undefined) walk(node.items, `${path}.items`)
  }
  for (const [key, node] of Object.entries(spec)) walk(node, `parameters.${key}`)
  assert.deepEqual(Object.keys(spec).sort(), ['expression', 'face', 'motion'])
  assert.equal(spec.face.additionalProperties, true)
})

test('工具描述按能力生成：有名字的模型写名字、没名字的模型明说命名路不成立并给参数', async () => {
  const haru = buildExpressToolDescription(expressionCapabilityFor({ Haru: HARU }, 'Haru'))
  assert.match(haru, /F01 \/ F02/)
  assert.match(haru, /THREE parallel ways/)
  const miku = buildExpressToolDescription(expressionCapabilityFor({ miku: MIKU }, 'miku'))
  assert.match(miku, /NO named expressions/)
  assert.match(miku, /PARAM_EYE_L_SMILE/)
  assert.match(miku, /眼 6 个/)
  const layered = buildExpressToolDescription(expressionCapabilityFor({ Layered: LAYERED }, 'Layered'))
  assert.match(layered, /NO named expressions/)
  assert.match(layered, /no parameter list, so `face` is NOT usable/)
  assert.match(layered, /Surprise/)
  // 🔴 EXPR-2：描述里必须**明示"按名字可读性挑"这个偏好**（让老师选得明白）
  assert.match(layered, /chosen by how readable the names are/)
  assert.match(layered, /USABLE but not preferred/)
  assert.match(layered, /Ties fall back to reliability: named-expression > face-parameters > motion/)
  // Haru 的三条路各自带上可读性判词：A 是编号、B 可读、C 可读
  assert.match(haru, /Path A — this model \(Haru\) HAS 8 named expressions[\s\S]*index-style/)
  assert.match(haru, /Path B — this model exposes 4 parameters[\s\S]*READABLE/)
  assert.match(haru, /preference for this model is face-parameters/)
  // 🔴 EXPR-5：Path B 那句"渲染器会夹取"必须**说全**。
  //    改前逐字是 "Values are plain numbers; the renderer clamps them to the model's own range."
  //    → ① 值域是**逐参数**的（实测 Haru：ParamEyeLOpen 0…2、ParamAngleX ±30）；
  //      ② 夹取**要报出来**（框架自己会夹，但一声不响）；
  //      ③ 漏了嘴型通道那一条（那个参数不归 `face` 管，客户端会跳过并如实报）。
  assert.match(haru, /clamps each one to that parameter's own range in the model/)
  assert.match(haru, /tells you in the panel when it had to change a value/)
  assert.match(miku, /belongs to the mouth channel, so `face` does NOT drive it/)
  assert.match(miku, /the renderer skips it and reports that too/)
  // 没有嘴型声明的模型（Haru 夹具）不该凭空多出这一句
  assert.equal(/belongs to the mouth channel/.test(haru), false)
  const dead = buildExpressToolDescription({ ok: false, reason: '读不到 X', names: [], parameters: [], dimensions: [] })
  assert.match(dead, /UNAVAILABLE right now: 读不到 X/)
})

test('临时目录里真的写出了一个能被教室读到的 runtime/expression.md', async () => {
  const classroom = tmpDir()
  mkdirSync(join(classroom, 'runtime'), { recursive: true })
  const store = makeStore({ capability: { Haru: HARU }, model: 'Haru', runtimeDir: join(classroom, 'runtime') })
  await store.specify({ expression: 'F03' })
  const text = readFileSync(join(classroom, 'runtime', 'expression.md'), 'utf8')
  assert.match(text, /^current_expression: F03$/m)
  assert.match(text, /^expression_origin: teacher$/m)
  assert.match(text, /^expression_capability: ok$/m)
})

test('🔴 兜底必须排除嘴型通道（LipSync）参数：一个参数不许两个写者', () => {  const mikuIds = MIKU.parameters
  const cap = expressionCapabilityFor({ miku: MIKU }, 'miku')
  assert.deepEqual(cap.lipSyncParameters, ['PARAM_MOUTH_OPEN_Y'])
  // 不排除时 excited 会写 PARAM_MOUTH_OPEN_Y
  const naive = faceParamsForEmotion('excited', mikuIds, TABLE)
  assert.equal(naive.params.PARAM_MOUTH_OPEN_Y, 0.7)
  // 排除后不写它，且**如实报出跳过了谁**
  const guarded = faceParamsForEmotion('excited', mikuIds, TABLE, { exclude: cap.lipSyncParameters })
  assert.equal(guarded.params.PARAM_MOUTH_OPEN_Y, undefined)
  assert.deepEqual(guarded.skippedIds, ['PARAM_MOUTH_OPEN_Y'])
  assert.equal(guarded.params.PARAM_MOUTH_FORM, 0.6)
})

test('兜底（逐参数路）真的排除了嘴参数（端到端：状态文件里没有 LipSync 参数）', async () => {
  const runtimeDir = tmpDir()
  const store = makeStore({ capability: { miku: MIKU }, model: 'miku', runtimeDir, turn: 2 })
  await store.fallback({ turn: 2, events: eventsFor(2, ['跑起来了！']) })
  const written = parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8'))
  assert.equal(written.emotion, 'excited')
  assert.equal(written.face.PARAM_MOUTH_OPEN_Y, undefined)
  assert.ok(written.face.PARAM_MOUTH_FORM !== undefined)
})

// ════════════════════════════════════════════════════════════════════════════
// ⑦-b 🔴 EXPR-2 真会话连带炸出来的缺陷：驼峰参数名（Haru）匹配不上我们的正则
// ════════════════════════════════════════════════════════════════════════════

/** 官方样本 Haru 的**真实**参数名（驼峰流派；取自渲染侧 cdi3 的 `Parameters[].Id`）。 */
const HARU_CAMEL = [
  'ParamAngleX', 'ParamAngleZ', 'ParamEyeLOpen', 'ParamEyeLSmile', 'ParamEyeROpen', 'ParamEyeRSmile',
  'ParamEyeBallX', 'ParamEyeBallY', 'ParamBrowLY', 'ParamBrowRY', 'ParamBrowLForm', 'ParamBrowRForm',
  'ParamMouthForm', 'ParamMouthOpenY', 'ParamBodyAngleX', 'ParamBreath', 'ParamHairFront', 'ParamScarf',
]

test('🔴 参数 id 归一化：驼峰（ParamEyeLOpen）与蛇形（PARAM_EYE_L_OPEN）折叠到同一形状', () => {
  // 判据＝"去掉分隔符＋全大写"，**两边（id 与正则）做同一个变换**再按子串匹配。
  assert.equal(normalizeParameterId('ParamEyeLOpen'), 'PARAMEYELOPEN')
  assert.equal(normalizeParameterId('PARAM_EYE_L_OPEN'), 'PARAMEYELOPEN')
  assert.equal(normalizeParameterId('ParamBrowLY'), 'PARAMBROWLY')
  assert.equal(normalizeParameterId('PARAM_BROW_L_Y'), 'PARAMBROWLY')
  assert.equal(normalizeParameterId('eye-l open'), 'EYELOPEN')
  assert.equal(normalizeParameterId('ParamEyeBallY'), 'PARAMEYEBALLY')
})

test('🔴 驼峰参数名也能命中角色表（真会话缺陷的回归：Haru 上兜底曾落盘空的 expression_face）', () => {
  // 现场事实（EXPR-2 会话 A）：Haru 的兜底走逐参数路，却写出 `expression_face: -`（一个参数都没有）
  // —— 因为 faceRoles 的正则是按 `PARAM_EYE_L_OPEN` 这种形状写的。
  for (const emotion of ['happy', 'thinking', 'sad', 'elated', 'furious']) {
    const picked = faceParamsForEmotion(emotion, HARU_CAMEL, TABLE)
    assert.ok(Object.keys(picked.params).length > 0, `${emotion} 在 Haru 的驼峰参数上必须写出至少一个参数`)
    assert.deepEqual(picked.missingRoles, [])
  }
  // 具体落点：happy 写左右眼的 smile ＋ 嘴形 ＋ 眉
  const happy = faceParamsForEmotion('happy', HARU_CAMEL, TABLE)
  assert.equal(happy.params.ParamEyeLSmile, 1)
  assert.equal(happy.params.ParamEyeRSmile, 1)
  assert.equal(happy.params.ParamMouthForm, 0.8)
  assert.equal(happy.params.ParamBrowLY, 0.4)
})

test('🔴 参数归维也认驼峰名（Haru 的 42 个参数曾全落进"其它"）', () => {
  const dims = groupParameters(HARU_CAMEL)
  const byGroup = Object.fromEntries(dims.map((d) => [d.group, d.parameters.length]))
  assert.ok(byGroup.eye >= 4, `眼应识别出多个，得到 ${JSON.stringify(byGroup)}`)
  assert.ok(byGroup.brow >= 4)
  assert.ok(byGroup.mouth >= 2)
  assert.equal(dims.find((d) => d.group === 'other').parameters.includes('ParamEyeLOpen'), false)
})

test('🔴 逐参数路"一个参数都写不出"时不许静默：明说不可用 ＋ 列出缺哪些角色', async () => {
  const runtimeDir = tmpDir()
  // 参数名与角色表完全对不上（既不是蛇形也不是驼峰语义名）→ 兜底必须**明说落空**，
  // 不许落盘成 `expression_face: -` 却写 `origin: fallback`（那等于告诉客户端"有表情"）。
  const weird = { expressions: [], parameters: ['Foo', 'Bar', 'Baz'] }
  const store = makeStore({ capability: { W: weird }, model: 'W', runtimeDir, turn: 2 })
  const result = await store.fallback({ turn: 2, events: eventsFor(2, ['搞定了！']) })
  assert.equal(result.action, 'unavailable')
  assert.match(result.note, /一个参数都没匹配上/)
  assert.match(result.note, /Foo \/ Bar \/ Baz/)
  const written = parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8'))
  assert.equal(written.origin, 'unavailable')
  assert.equal(written.capability, 'ok') // 能力没问题，是"这个情绪在这个模型上没有可写的参数"
})

test('兜底：neutral 槽位**刻意不动脸**（该槽位没有角色要写）→ 仍记 fallback，不算落空', async () => {
  const runtimeDir = tmpDir()
  const store = makeStore({ capability: { Haru: HARU }, model: 'Haru', runtimeDir, turn: 2 })
  const result = await store.fallback({ turn: 2, events: eventsFor(2, ['今天讲了进程调度']) })
  assert.equal(result.emotion, 'neutral')
  assert.equal(result.action, 'fallback')
  assert.deepEqual(result.face, {})
})

test('渠道纪律文案：动词优先、写清三条并列手段与"不说就兜底"，且不含任何固定映射', () => {
  const text = EXPRESSION_DISCIPLINE_RULES.join('\n')
  assert.match(text, /classroom_express/)
  assert.match(text, /不按环节规定表情/)
  assert.match(text, /没有命名表情/)
  assert.match(text, /兜底/)
  assert.match(text, /先把这一步讲给学生听/)
  // 不规定映射：纪律里不许出现"相位 X 配表情 Y"这类固定映射
  for (const phase of ['open', 'probe', 'answer', 'check', 'review', 'close']) {
    assert.ok(!text.includes(`${phase} `), `纪律里出现了相位名：${phase}`)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// ⑦ 三条路（命名表情 / 逐参数 / 动作）＋ 优先级 ＋ "三种都没有" 的明说
// ════════════════════════════════════════════════════════════════════════════

test('🔴 第三种情况（分层图转出的 .moc3）：0 表情、0 参数、17 组动作 → 能力**可用**，走动作', () => {
  const cap = expressionCapabilityFor({ Layered: LAYERED }, 'Layered')
  assert.equal(cap.ok, true, cap.reason)
  assert.equal(cap.namedPath, false)
  assert.equal(cap.paramPath, false)
  assert.equal(cap.motionPath, true)
  assert.equal(cap.motions.length, 17)
  assert.equal(cap.path, 'motion')
  assert.match(cap.motions.join(','), /Surprise/)
  console.log('\n=== 分层模型的动作组（原始输出）===')
  console.log(cap.motions.join(' / '))
  console.log('=== 动作组表结束 ===\n')
})

// ── 🔴 EXPR-2：挑路按「名字读不读得懂」，不按手段类别 ──────────────────────────

test('🔴 名字可读性计分：有语义 / 无语义编号 / 没有名字 三档（**只按名字形状判，无词表**）', () => {
  // 有语义：能看出是什么情绪、什么部位
  for (const name of [
    'Smile', 'Sad', 'Shy', 'Surprise', 'Serious', 'Idle', 'Head_yaw', 'Laugh',
    'ParamEyeLOpen', 'ParamMouthForm', 'PARAM_EYE_L_OPEN', 'PARAM_CHEEK', 'F01_smile',
  ]) {
    assert.equal(readabilityOfName(name).kind, 'semantic', `${name} 应判为有语义`)
  }
  // 无语义编号：**能用，但不作为默认优选**
  for (const name of ['F01', 'F08', 'E1', 'F_01', 'expr_3', 'moc_1', 'x1', 'ab']) {
    assert.equal(readabilityOfName(name).kind, 'opaque', `${name} 应判为无语义编号`)
  }
  // 没有名字：一个字母都没有（纯数字／符号）
  for (const name of ['01', '_', '']) {
    assert.equal(readabilityOfName(name).kind, 'nameless', `${name} 应判为没有名字`)
  }
  // 均分与档位
  assert.deepEqual(scoreNames(['F01', 'F02']), { count: 2, semantic: 0, opaque: 2, nameless: 0, score: 1, grade: 1, kind: 'opaque' })
  assert.equal(scoreNames(['Smile', 'Sad']).kind, 'semantic')
  assert.equal(scoreNames(['01', '02']).kind, 'nameless')
  assert.equal(scoreNames([]).score, 0)
  // 一份混合清单按均分落档（8 个编号 + 4 个可读 = 1.33 → 档位 1）
  assert.equal(scoreNames([...Array(8).fill('F01'), 'Smile', 'Sad', 'Shy', 'Idle']).kind, 'opaque')
})

test('🔴 挑路按名字可读性：Haru 上「参数名可读」胜过「F01…F08 编号」→ 走逐参数（**真会话现场**）', () => {
  // 依据（EXPR-1 §4.3 真会话）：老师在 Haru 上**放着 8 个 F01…F08 不用**、自己去写 ParamEyeLOpen。
  // 旧规则（按手段类别写死"命名表情优先"）会与现场相反 → EXPR-2 改成按名字计分。
  const haru = expressionCapabilityFor({ Haru: HARU }, 'Haru')
  assert.equal(haru.path, 'face-parameters')
  const named = haru.pathRanking.find((entry) => entry.path === 'named-expression')
  const face = haru.pathRanking.find((entry) => entry.path === 'face-parameters')
  assert.equal(named.kind, 'opaque')
  assert.equal(face.kind, 'semantic')
  assert.ok(face.score > named.score, `参数 ${face.score} 应高于名字 ${named.score}`)
  assert.equal(haru.pathReadability.path, 'face-parameters')
  // 可解释：一句话说清为什么挑这条
  assert.match(describePathChoice(haru.pathRanking, haru.path), /→ face-parameters/)
})

test('🔴 反向也成立：命名表情有语义、参数是编号 → 走命名表情（判据是名字，不是类别）', () => {
  const cap = expressionCapabilityFor(
    { M: { expressions: [{ name: 'Smile' }, { name: 'Sad' }, { name: 'Surprise' }], parameters: ['P01', 'P02'] } },
    'M',
  )
  assert.equal(cap.path, 'named-expression')
})

test('🔴 `F0x` **没有被禁用**：模型只有编号命名表情时它照样被选中（能用，只是有更读得懂的路时不优选）', () => {
  const only = expressionCapabilityFor({ M: { expressions: [{ name: 'F01' }, { name: 'F02' }] } }, 'M')
  assert.equal(only.namedPath, true)
  assert.equal(only.path, 'named-expression') // 只有它 → 就是它（不许因为"读不懂"就判它不可用）
  assert.equal(only.pathReadability.kind, 'opaque')
  // 工具描述必须**明示这个偏好**，让老师选得明白
  const desc = buildExpressToolDescription(only)
  assert.match(desc, /F01 \/ F02/)
  assert.match(desc, /index-style/)
  assert.match(desc, /USABLE but not preferred/)
})

test('🔴 同分才按可靠性次序（命名表情 > 逐参数 > 动作）：三条都是可读名字 → 仍选命名表情', () => {
  assert.deepEqual(EXPRESSION_PATH_TIEBREAK, ['named-expression', 'face-parameters', 'motion'])
  const cap = expressionCapabilityFor(
    {
      M: {
        expressions: [{ name: 'Smile' }],
        parameters: ['ParamEyeLOpen'],
        motionGroups: [{ name: 'Surprise' }],
      },
    },
    'M',
  )
  assert.equal(cap.path, 'named-expression')
  assert.deepEqual(
    cap.pathRanking.filter((entry) => entry.available).map((entry) => entry.path),
    ['named-expression', 'face-parameters', 'motion'],
  )
})

test('挑路的兜底口径：只有逐参数 → 逐参数；只有动作 → 动作；三种都没有 → null 并明说"无法表达情绪"', () => {
  const noName = expressionCapabilityFor({ M: { expressions: [], parameters: ['ParamEyeLOpen'] } }, 'M')
  assert.equal(noName.path, 'face-parameters')
  const onlyMotion = expressionCapabilityFor({ L: LAYERED }, 'L')
  assert.equal(onlyMotion.path, 'motion')
  const none = expressionCapabilityFor({ N: { expressions: [], parameters: [], motionGroups: [] } }, 'N')
  assert.equal(none.path, null)
  assert.match(none.reason, /无法表达情绪/)
  assert.equal(pickPath({ namedPath: false, paramPath: false, motionPath: false }), null)
  // 名字全无意义（没有名字可读）→ 排最后：可读的命名表情赢
  const readableBeatsNameless = expressionCapabilityFor(
    { M: { expressions: [{ name: 'Smile' }], parameters: ['01', '02'] } },
    'M',
  )
  assert.equal(readableBeatsNameless.path, 'named-expression')
  assert.equal(pathRanking(readableBeatsNameless).find((entry) => entry.path === 'face-parameters').kind, 'nameless')
})

test('动作路：合法动作组名通过并落盘（expression_path=motion）；非法组名 → 报错且列出全部动作组', async () => {
  const runtimeDir = tmpDir()
  const store = makeStore({ capability: { Layered: LAYERED }, model: 'Layered', runtimeDir, turn: 3 })
  const ok = await store.specify({ motion: 'Surprise' })
  assert.equal(ok.path, 'motion')
  assert.equal(ok.motion, 'Surprise')
  assert.equal(ok.availableCount, 17)
  const written = parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8'))
  assert.equal(written.path, 'motion')
  assert.equal(written.motion, 'Surprise')
  assert.equal(written.expression, null)
  assert.equal(written.origin, 'teacher')

  await assert.rejects(
    () => store.specify({ motion: 'Excited' }),
    (error) => {
      assert.match(error.message, /没有动作组 "Excited"/)
      assert.match(error.message, /Surprise/)
      assert.match(error.message, /Body_sway/)
      return true
    },
  )
})

test('🔴 动作路对"没有动作组的模型"报错，并指向另两条（三条并列的对称性）', async () => {
  const runtimeDir = tmpDir()
  const store = makeStore({ capability: { Haru: HARU }, model: 'Haru', runtimeDir })
  // Haru fixture 里没有 motionGroups 字段 → 动作路不成立
  await assert.rejects(
    () => store.specify({ motion: 'Idle' }),
    (error) => {
      assert.match(error.message, /没有动作组/)
      assert.match(error.message, /命名表情 8 个/)
      return true
    },
  )
})

test('兜底（动作路）：只有动作组的模型 → 情绪推到一个真实动作组名', async () => {
  const runtimeDir = tmpDir()
  const logs = []
  const store = createExpressionStore({
    capabilityFile: writeCapability({ Layered: LAYERED }),
    model: 'Layered',
    runtimeDir: () => runtimeDir,
    getTurn: () => 2,
    atomicWrite: io,
    log: (m) => logs.push(m),
  })
  const result = await store.fallback({ turn: 2, events: eventsFor(2, ['真的假的？']) })
  assert.equal(result.action, 'fallback')
  assert.equal(result.emotion, 'surprised')
  assert.equal(result.motion, 'Surprise')
  assert.equal(result.expression, null)
  const written = parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8'))
  assert.equal(written.path, 'motion')
  assert.equal(written.motion, 'Surprise')
  assert.equal(written.origin, 'fallback')
  assert.ok(logs.some((m) => m.includes('动作 Surprise') && m.includes('匹配线索')), logs.join(' | '))
})

test('🔴 兜底（动作路）匹配不到动作组时**明说这次用不了**（不猜、不静默）', async () => {
  const runtimeDir = tmpDir()
  const thin = { expressions: [], parameters: [], motionGroups: [{ name: 'Idle', count: 1 }] }
  const store = makeStore({ capability: { Thin: thin }, model: 'Thin', runtimeDir, turn: 2 })
  const result = await store.fallback({ turn: 2, events: eventsFor(2, ['搞定了！']) })
  assert.equal(result.action, 'unavailable')
  assert.match(result.note, /只有"动作"这条路/)
  assert.match(result.note, /Idle/)
  const written = parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8'))
  assert.equal(written.origin, 'unavailable')
  assert.equal(written.capability, 'ok') // 能力没问题，是"这次这个情绪没动作可配"
})

test('🔴 兜底也按名字可读性挑路：Haru（参数名可读、F0x 是编号）→ 兜底写参数，不写 F0x、不放动作', async () => {
  const runtimeDir = tmpDir()
  const both = { ...HARU, motionGroups: [{ name: 'Smile', count: 1 }, { name: 'Surprise', count: 1 }] }
  const store = makeStore({ capability: { Haru: both }, model: 'Haru', runtimeDir, turn: 2 })
  const result = await store.fallback({ turn: 2, events: eventsFor(2, ['搞定了！']) })
  assert.equal(result.action, 'fallback')
  assert.equal(result.expression, null)
  assert.equal(result.motion, null)
  assert.ok(Object.keys(result.face).length > 0)
  const written = parseExpressionState(readFileSync(join(runtimeDir, EXPRESSION_FILE), 'utf8'))
  assert.equal(written.path, 'face-parameters')
})

test('兜底：命名表情有语义（Smile/Sad/Surprise）→ 兜底走命名表情（可读性优先，同分才看类别）', async () => {
  const runtimeDir = tmpDir()
  const semantic = { expressions: [{ name: 'Smile' }, { name: 'Sad' }, { name: 'Surprise' }], parameters: ['P01', 'P02'] }
  const store = makeStore({ capability: { M: semantic }, model: 'M', runtimeDir, turn: 2 })
  const result = await store.fallback({ turn: 2, events: eventsFor(2, ['搞定了！']) })
  assert.equal(result.action, 'fallback')
  assert.equal(result.emotion, 'elated')
  assert.equal(result.expression, 'Surprise') // elated → 槽位 2 → 下标 2
  assert.deepEqual(result.face, {})
})

test('状态文件三种形态都能往返：path/expression/face/motion 四行一一对应', () => {
  const base = { origin: 'teacher', emotion: null, turn: 1, capability: 'ok' }
  const named = parseExpressionState(renderExpressionState({ ...base, path: 'named-expression', expression: 'F01', face: {}, motion: null }))
  assert.equal(named.path, 'named-expression')
  assert.equal(named.expression, 'F01')
  const face = parseExpressionState(renderExpressionState({ ...base, path: 'face-parameters', expression: null, face: { A: 1 }, motion: null }))
  assert.equal(face.path, 'face-parameters')
  assert.deepEqual(face.face, { A: 1 })
  const motion = parseExpressionState(renderExpressionState({ ...base, path: 'motion', expression: null, face: {}, motion: 'Smile' }))
  assert.equal(motion.path, 'motion')
  assert.equal(motion.motion, 'Smile')
  // 不可用时 path 为 '-'
  const dead = parseExpressionState(renderExpressionState({ ...base, path: null, expression: null, face: {}, motion: null, origin: 'unavailable', capability: 'unavailable', note: 'x' }))
  assert.equal(dead.path, null)
  assert.equal(dead.origin, 'unavailable')
})
