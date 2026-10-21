// test/group.test.mjs — N3 群聊 agent 的输入/提示词/确定性校验（不发请求、不写盘）
//
// 三组守卫：
//   ① 规则逐字来自教室的 `runtime/wechat_group.rules.md`（不在代码里另抄一份）
//   ② N3.6 的三条写死规则用**机器**判（≤2 行 / 不用 emoji / speaker 必须已定义）
//   ③ 🔒 提示词里不许出现「有读者」的意思（仓库红线，与日记那条同款）

import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import {
  PASSERBY_PREFIX,
  buildNudgePrompt,
  buildNudgeSystem,
  buildReplyPrompt,
  buildReplySystem,
  collectGroupInputs,
  readGroupRules,
  renderRecentNotes,
  renderTranscript,
  validateSpeech,
} from '../lib/group.mjs'
import { ERROR_CODES } from '../lib/errors.mjs'
import { makeClassroom } from './fixtures.mjs'

const REAL_CLASSROOM = join(import.meta.dirname, '..', '..', '..', 'classrooms', 'cs-os')

const NAMES = ['鲸（DeepSeek 娘）', '鲸']

test('规则：从教室文件头逐字抽出来（那条文件是真源）', async () => {
  const rules = await readGroupRules(REAL_CLASSROOM)
  assert.match(rules, /群里她打字/)
  assert.match(rules, /每条不超过 2 行/)
  assert.match(rules, /不使用 emoji/)
  assert.match(rules, /群聊不承载知识点/)
  assert.match(rules, new RegExp(PASSERBY_PREFIX))
  // 不是从代码里抄的：把真文件改一个字节，规则就跟着变
  const dir = await makeClassroom({ 'runtime/wechat_group.rules.md': '# 规则\n\n> 全新的规则行。\n' })
  assert.equal(await readGroupRules(dir), '全新的规则行。')
})

test('规则：文件里没有引用行 → NO_GROUP_RULES（不拿默认规则顶上）', async () => {
  const dir = await makeClassroom({ 'runtime/wechat_group.rules.md': '# 规则\n\n什么都没有。\n' })
  await assert.rejects(readGroupRules(dir), (error) => {
    assert.equal(error.code, ERROR_CODES.IO_ERROR)
    assert.equal(error.detail.reason, 'NO_GROUP_RULES')
    return true
  })
})

test('发言校验：正常两行以内通过；speaker 缺省用当课角色名', () => {
  const speech = validateSpeech({ text: '在。\n刚上来。' }, { names: NAMES, defaultSpeaker: '鲸（DeepSeek 娘）' })
  assert.equal(speech.speaker, '鲸（DeepSeek 娘）')
  assert.equal(speech.text, '在。\n刚上来。')
})

test('发言校验：超过 2 行 → INVALID_OUTPUT / TOO_MANY_LINES', () => {
  assert.throws(
    () => validateSpeech({ text: '一\n二\n三' }, { names: NAMES, defaultSpeaker: '鲸' }),
    (error) => error.code === ERROR_CODES.INVALID_OUTPUT && error.detail.reason === 'TOO_MANY_LINES',
  )
  // 结尾的换行不算第三行
  assert.doesNotThrow(() => validateSpeech({ text: '一\n二\n\n' }, { names: NAMES, defaultSpeaker: '鲸' }))
})

test('发言校验：emoji → INVALID_OUTPUT / EMOJI（按 Unicode 属性判，不靠人肉清单）', () => {
  for (const text of ['好呀 😀', '🐳 今天的潮位', '嗯✅']) {
    assert.throws(
      () => validateSpeech({ text }, { names: NAMES, defaultSpeaker: '鲸' }),
      (error) => error.code === ERROR_CODES.INVALID_OUTPUT && error.detail.reason === 'EMOJI',
      text,
    )
  }
  // 中文标点不是 emoji
  assert.doesNotThrow(() => validateSpeech({ text: '（记一下）嗯——好。' }, { names: NAMES, defaultSpeaker: '鲸' }))
})

test('发言校验：没定义过的名字 → INVALID_OUTPUT / UNKNOWN_SPEAKER；路人放行', () => {
  assert.throws(
    () => validateSpeech({ speaker: '值班员', text: '风大了。' }, { names: NAMES, defaultSpeaker: '鲸' }),
    (error) => error.code === ERROR_CODES.INVALID_OUTPUT && error.detail.reason === 'UNKNOWN_SPEAKER',
  )
  for (const speaker of [`${PASSERBY_PREFIX}值班员`, `${PASSERBY_PREFIX}船工`]) {
    assert.equal(validateSpeech({ speaker, text: '风大了。' }, { names: NAMES, defaultSpeaker: '鲸' }).speaker, speaker)
  }
  // 空称呼不是合法路人名
  assert.throws(() => validateSpeech({ speaker: PASSERBY_PREFIX, text: '嗯。' }, { names: NAMES, defaultSpeaker: '鲸' }))
})

test('发言校验：空文本 → EMPTY_SPEECH', () => {
  assert.throws(
    () => validateSpeech({ text: '   ' }, { names: NAMES, defaultSpeaker: '鲸' }),
    (error) => error.detail.reason === 'EMPTY_SPEECH',
  )
})

test('输入：规则/角色卡/世界/最近的群聊/课堂摘要/课堂记录都进提示词', async () => {
  const dir = await makeClassroom({
    'runtime/notes.jsonl': `${JSON.stringify({ v: 1, type: 'group_question', lesson: 1, kp: 'KP-1.1', quote: '页表是不是缓存', note: '课上讲' })}\n`,
  })
  const collected = await collectGroupInputs({
    classroomDir: dir,
    lesson: 1,
    messages: [
      { seq: 1, role: 'character', speaker: '鲸', text: '今天的风小了一点。' },
      { seq: 2, role: 'student', speaker: '你', text: '在吗' },
    ],
  })
  assert.equal(collected.character.name, '鲸（DeepSeek 娘）')
  const labels = collected.inputs.map((input) => input.label)
  assert.ok(labels.some((label) => label.includes('characters/deepseek.md')))
  assert.ok(labels.some((label) => label.includes('world/setting.md')))
  assert.ok(labels.some((label) => label.includes('最近群聊')))
  assert.ok(labels.some((label) => label.includes('session_log.md')))
  assert.ok(labels.some((label) => label.includes('notes.jsonl')))
  const notes = collected.inputs.find((input) => input.label.includes('notes.jsonl')).content
  assert.match(notes, /群里提的问题/)
  assert.match(notes, /KP-1\.1/)
})

test('输入：群里还没有消息时如实写「还没有人说话」', async () => {
  const dir = await makeClassroom()
  const collected = await collectGroupInputs({ classroomDir: dir, messages: [] })
  assert.match(collected.inputs.find((input) => input.label.includes('最近群聊')).content, /还没有人说话/)
})

test('转录与课堂记录：坏行跳过，最近 N 条', () => {
  assert.equal(renderTranscript([{ speaker: '你', text: '在吗' }]), '你：在吗')
  const raw = ['{坏行', JSON.stringify({ v: 1, type: 'evidence', lesson: 1, quote: '他自己说出来了' })].join('\n')
  const text = renderRecentNotes(raw, 8)
  assert.match(text, /掌握证据/)
  assert.doesNotMatch(text, /坏行/)
})

test('提示词：多条学生发言合并成「一次说完」，并要求只回一条', () => {
  const prompt = buildReplyPrompt({
    batch: [
      { role: 'student', text: '在吗' },
      { role: 'student', text: '今天讲什么' },
    ],
    lesson: 1,
  })
  assert.match(prompt, /一连说了 2 句/)
  assert.match(prompt, /只回一条/)
})

test('提示词：系统位里逐字有规则，并点明只有这些名字能开口', () => {
  const system = buildReplySystem({ rules: '> 规则甲\n> 规则乙', characterName: '鲸', allowedNames: NAMES })
  assert.match(system, /规则甲/)
  assert.match(system, /规则乙/)
  assert.match(system, /鲸（DeepSeek 娘）、鲸/)
  assert.match(system, new RegExp(PASSERBY_PREFIX))
})

test('提示词：主动说话的开场与定时各有各的说法', () => {
  const opening = buildNudgePrompt({ kind: 'open', count: 1, lesson: 1 })
  assert.match(opening, /第一条消息/)
  const nudge = buildNudgePrompt({ kind: 'nudge', count: 2, lesson: 3, times: ['09:12', '15:40'] })
  assert.match(nudge, /09:12/)
  assert.match(nudge, /按顺序给出 2 条/)
  const system = buildNudgeSystem({ rules: '规则', characterName: '鲸', allowedNames: NAMES })
  assert.match(system, /规则/)
})

test('🔒 提示词里不许出现「有读者」的意思', () => {
  const pieces = [
    buildReplySystem({ rules: '规则', characterName: '鲸', allowedNames: NAMES }),
    buildReplyPrompt({ batch: [{ role: 'student', text: '在吗' }], lesson: 1 }),
    buildNudgeSystem({ rules: '规则', characterName: '鲸', allowedNames: NAMES }),
    buildNudgePrompt({ kind: 'open', count: 1, lesson: 1 }),
    buildNudgePrompt({ kind: 'nudge', count: 1, lesson: 1, times: ['09:00'] }),
  ].join('\n')
  for (const forbidden of ['读者', '观众', '面板', '展示给', '给别人看', '有人会看', '会被看到', '公开', '未读', '学生', '同学']) {
    assert.equal(pieces.includes(forbidden), false, `群聊提示词里出现了「${forbidden}」`)
  }
})
