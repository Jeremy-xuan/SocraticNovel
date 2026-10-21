// test/persona.test.mjs — N6.1「单一人格源」的跨模块守卫
//
// 开发文档 N6.1：课堂、群聊、日记三个 agent 加载**同一份**角色卡与 `_anchor.md` 的
// 「角色声音速查」段，不另写「群聊版人设」。
//
// 这个文件守着两件事（都是 2026-10-21 集成侧抓到的真问题）：
//   ① 日记曾经**硬编码** `characters/komari.md`（上一个角色），而 `classroom.yaml` 声明的是
//      `characters/deepseek.md` —— 日记会按另一个角色写。
//   ② 群聊的输入里**根本没有**角色卡与声音段，只能靠 `world/setting.md` 猜。
//
// 做法：两边都调自己的输入收集函数，断言「同一份来源」的三条可观察事实。

import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { buildDiarySystem, collectDiaryInputs } from '../lib/diary.mjs'
import { buildReplySystem, collectGroupInputs } from '../lib/group.mjs'
import { makeClassroom } from './fixtures.mjs'

const MANIFEST = (card) => `format: socratic-classroom/0
classroom:
  id: test
blocks:
  - id: persona
    path: ${card}
    layer: persona
`

const ANCHOR = `# _anchor.md — 纪律层

## 角色声音速查（生成任何台词前看一眼）

- **鲸**：开口时慢、低、句子短；写下来又密又准。
- 不要用感叹号堆情绪。

## 教学检查

- 学生是否知道我刚问的是什么？
`

const SPARE = `# 小鞠知花（Komari Chika）· 本教室版本

> 旧的对照卡，不该被这一版教室加载。
`

const DIARY_MD = `# 日记（她的）

> **写法规则**：第一人称、短、不解释。

---

`

/**
 * 一个「该有的都有」的教室。
 * @param {{card?: string}} [options]
 */
async function makePersonaClassroom({ card = 'characters/deepseek.md' } = {}) {
  return makeClassroom({
    'classroom.yaml': MANIFEST(card),
    '_anchor.md': ANCHOR,
    'characters/komari.md': SPARE,
    'runtime/diary.md': DIARY_MD,
  })
}

/** 两边的输入收集各跑一次。 */
async function collectBoth(classroomDir) {
  const diary = await collectDiaryInputs({ classroomDir, lesson: 1, date: '2026-10-21' })
  const group = await collectGroupInputs({ classroomDir, messages: [] })
  return { diary, group }
}

test('🔴 日记与群聊用同一张当课角色卡（同一路径、同一字节）', async () => {
  const dir = await makePersonaClassroom()
  const { diary, group } = await collectBoth(dir)

  const diaryCard = diary.inputs.find((input) => input.label.endsWith('（你是谁）'))
  const groupCard = group.inputs.find((input) => input.label.endsWith('（你是谁）'))
  assert.ok(diaryCard !== undefined, '日记的输入里必须有角色卡')
  assert.ok(groupCard !== undefined, '群聊的输入里必须有角色卡')
  assert.equal(diaryCard.label, 'characters/deepseek.md（你是谁）')
  assert.equal(groupCard.label, diaryCard.label, '两边必须是同一份卡（路径也一样）')
  assert.equal(groupCard.content, diaryCard.content, '两边拿到的内容必须逐字一致')
  assert.match(diaryCard.content, /鲸（DeepSeek 娘）/)

  // 事实字段也来自同一次解析
  assert.equal(diary.facts.character, 'characters/deepseek.md')
  assert.equal(group.facts.character, diary.facts.character)
  assert.equal(group.facts.characterName, diary.facts.characterName)
})

test('🔴 日记与群聊用同一段「角色声音速查」（不是整份 _anchor.md）', async () => {
  const dir = await makePersonaClassroom()
  const { diary, group } = await collectBoth(dir)
  const pick = (inputs) => inputs.find((input) => input.label.includes('角色声音速查')).content
  const diaryVoice = pick(diary.inputs)
  const groupVoice = pick(group.inputs)
  assert.match(diaryVoice, /开口时慢/)
  assert.equal(groupVoice, diaryVoice, '两边的声音段必须逐字一致')
  assert.doesNotMatch(diaryVoice, /教学检查/, '不该把 _anchor 的其它段落一起塞进来')
})

test('🔴 两边都不该读到「上一个角色」的卡（komari 回归守卫）', async () => {
  const dir = await makePersonaClassroom()
  const { diary, group } = await collectBoth(dir)
  const all = [...diary.inputs, ...group.inputs].map((input) => `${input.label}\n${input.content}`).join('\n')
  assert.doesNotMatch(all, /小鞠知花/)
  assert.doesNotMatch(all, /komari/)
})

test('换角：classroom.yaml 一改，两边同时跟着换（不各改各的）', async () => {
  const dir = await makePersonaClassroom()
  await writeFile(join(dir, 'classroom.yaml'), MANIFEST('characters/komari.md'), 'utf8')
  const { diary, group } = await collectBoth(dir)
  assert.equal(diary.facts.character, 'characters/komari.md')
  assert.equal(group.facts.character, 'characters/komari.md')
  assert.match(diary.inputs.find((input) => input.label.endsWith('（你是谁）')).content, /小鞠知花/)
  assert.match(group.inputs.find((input) => input.label.endsWith('（你是谁）')).content, /小鞠知花/)
})

test('没声明角色卡 → 两边都明确报错（不猜、不回退）', async () => {
  const dir = await makeClassroom({ 'classroom.yaml': 'format: socratic-classroom/0\nclassroom:\n  id: test\n', '_anchor.md': ANCHOR })
  await assert.rejects(collectDiaryInputs({ classroomDir: dir, lesson: 1, date: '2026-10-21' }), /NO_CHARACTER|没有/)
  await assert.rejects(collectGroupInputs({ classroomDir: dir, messages: [] }), /NO_CHARACTER|没有/)
})


// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-21 集成侧抓到的第二层问题：**输入**换成了当课角色卡，但**系统提示**还写死旧名字
//   （`buildDiarySystem` 里硬编码「你叫小鞠知花」）。所以守卫必须看提示词，不只看输入。
// ─────────────────────────────────────────────────────────────────────────────

const REAL_CLASSROOM = join(import.meta.dirname, '..', '..', '..', 'classrooms', 'cs-os')

test('🔴 真教室：日记与群聊的**提示词**里都是当前角色，不是旧卡', async () => {
  const diary = await collectDiaryInputs({ classroomDir: REAL_CLASSROOM, lesson: 1, date: '2026-10-21' })
  const diarySystem = buildDiarySystem({ rules: diary.rules, characterName: diary.facts.characterName })
  const group = await collectGroupInputs({ classroomDir: REAL_CLASSROOM, messages: [] })
  const groupSystem = buildReplySystem({ rules: group.rules, characterName: group.character.name, allowedNames: [group.character.name] })

  assert.equal(diary.facts.characterName, group.character.name, '两边的当课角色名必须一致')
  for (const [label, text] of [
    ['日记系统位', diarySystem],
    ['群聊系统位', groupSystem],
  ]) {
    assert.match(text, /鲸/, `${label} 里应当有当前角色名`)
    assert.doesNotMatch(text, /小鞠|komari/, `${label} 里不该出现上一个角色`)
  }
})

test('🔴 换角后提示词跟着换（两边），不需要改代码', async () => {
  const dir = await makePersonaClassroom()
  await writeFile(join(dir, 'classroom.yaml'), MANIFEST('characters/komari.md'), 'utf8')
  const diary = await collectDiaryInputs({ classroomDir: dir, lesson: 1, date: '2026-10-21' })
  const group = await collectGroupInputs({ classroomDir: dir, messages: [] })
  const diarySystem = buildDiarySystem({ rules: diary.rules, characterName: diary.facts.characterName })
  const groupSystem = buildReplySystem({ rules: group.rules, characterName: group.character.name, allowedNames: [group.character.name] })
  assert.match(diarySystem, /小鞠知花/)
  assert.match(groupSystem, /小鞠知花/)
})
