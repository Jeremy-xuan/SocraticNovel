// test/cast.test.mjs — T8A：多角色同台的**数据层**（`cast:` / `cue:` 的解析与校验）
//
// 依据：研究_9_多角色同台机制_2026-09-24.md §10（schema）＋ 排产计划_技术线 §八 C2
//   （「角色表放顶层 cast:/cue:，**并加进解析白名单**」）。
// 🔴 本文件只测**数据层**：能声明、能校验、能被解析。**不测行为**（谁出场、说什么）——
//    那是下一批；顺序硬规定：先跑一讲"没有同学"的真实课把错题数据攒出来。
// 🔴 三条必测：
//    ① 合法 cast/cue 能解析；每类非法输入的**错误原文逐字**（含行号与期望值）；
//    ② 老教室（无 cast/cue）**形状逐字不变**；
//    ③ 硬约束：cast 只声明老师 ⇒ `peerRolesOf()` 返回空数组（＝引擎行为与今天一致）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { parseManifest, loadManifest, peerRolesOf, ManifestError } from '../lib/manifest.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const CAST_FIXTURE = join(here, 'fixtures', 'cast-classroom')
const TEACHER_ONLY_FIXTURE = join(here, 'fixtures', 'cast-teacher-only')
const MINIMAL_FIXTURE = join(here, 'fixtures', 'minimal-classroom')

// ── 造 YAML 的小工具 ────────────────────────────────────────────────────────
// 头部固定 8 行，`cast:` 从第 9 行开始；但测试**不硬编码行号**——见 expectErrorAt。
const HEAD = `format: socratic-classroom/0
classroom: { id: x }
phases: [open, probe, check, review, close]
blocks:
  - id: a
    text: hi
    position: { target: chat, depth: 0 }
    frequency: { every: turn }
`

const text = (extra) => HEAD + extra

/** 某个子串在 YAML 里所在的行号（1-based）；`nth` 用于同一子串出现多次时取第几个（默认第 1 个）。 */
function lineOf(yaml, marker, nth = 1) {
  const lines = yaml.split('\n')
  let seen = 0
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes(marker)) continue
    seen += 1
    if (seen === nth) return i + 1
  }
  throw new Error(`fixture 自身写错了：找不到第 ${nth} 处 ${JSON.stringify(marker)}`)
}

/** 断言抛出 ManifestError，并返回错误原文。 */
function catchManifestError(fn) {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof ManifestError, `期望 ManifestError，得到 ${error?.name}: ${error?.message}`)
    return error.message
  }
  throw new Error('期望抛错，但没抛')
}

/**
 * 跑一次 parseManifest，断言**错误原文逐字**等于
 *   `classroom.yaml: <where>（第 <marker 所在行> 行）<tail>`
 * 行号由 `marker` 在 YAML 里的真实位置**现算** → 一次断言同时验了"文案"和"行号是真定位出来的"。
 * `marker` 可以写成 `[子串, 第几次出现]`（同一子串出现多次时用）。
 * @returns {string} 错误原文
 */
function expectErrorAt(yaml, marker, where, tail, options) {
  const msg = catchManifestError(() => parseManifest(yaml, options))
  const [needle, nth] = Array.isArray(marker) ? marker : [marker, 1]
  assert.equal(msg, `classroom.yaml: ${where}（第 ${lineOf(yaml, needle, nth)} 行）${tail}`)
  return msg
}

const TEACHER_ROLE = `    - id: komari
      file: characters/komari.md
      name: 小鞠知花
      role: teacher
      enabled: true
`

const BUDDY_ROLE = `    - id: chengji
      file: characters/chengji.md
      name: 程霁
      role: buddy
      enabled: true
      style: precise
      styleLabel: 精确型
`

const POLICY = `  policy:
    lessonQuota: 4
    minTurnGap: 5
    allowedPhases: [probe, check, review]
`

const CAST_WITH_PEER = `cast:\n${POLICY}  roles:\n${TEACHER_ROLE}${BUDDY_ROLE}`

const CUE_EMPTY = `cue:\n  triggers: []\n`

// ════════════════════════════════════════════════════════════════════════════
// ① 合法路径
// ════════════════════════════════════════════════════════════════════════════

test('合法 cast ＋ cue 能解析（fixture：老师＋搭子＋客串，三条出场路）', () => {
  const m = loadManifest(CAST_FIXTURE)

  assert.deepEqual(m.cast.policy, {
    lessonQuota: 4,
    minTurnGap: 5,
    allowedPhases: ['probe', 'check', 'review'],
  })
  assert.deepEqual(
    m.cast.roles.map((r) => [r.id, r.role, r.enabled]),
    [
      ['komari', 'teacher', true],
      ['chengji', 'buddy', true],
      ['ache', 'guest', false],
    ],
  )
  // 老师不参与认知风格匹配 → 不挂 style/styleLabel 键
  assert.equal(m.cast.roles[0].style, undefined)
  assert.equal(m.cast.roles[0].styleLabel, undefined)
  assert.equal(m.cast.roles[1].style, 'precise')
  assert.equal(m.cast.roles[1].styleLabel, '精确型')

  assert.deepEqual(
    m.cue.triggers.map((t) => t.when),
    ['stall', 'student-hit-known-wrong-step', 'teacher-invite'],
  )
  assert.deepEqual(m.cue.triggers[0].roles, ['chengji'])
  assert.equal(m.cue.triggers[1].source, 'runtime/wrong_step_library.md')
  assert.equal(m.cue.stall.nTurns, 3)
  assert.deepEqual(m.cue.stall.dontKnowPatterns, { high: ['不知道', '不会', '想不出来'], mid: ['大概', '我不确定'] })
  assert.deepEqual(m.cue.stall.dontKnowExempt, ['不会影响', '不会导致'])
})

test('内联合法 cast（含 cue.triggers: []）能解析', () => {
  const m = parseManifest(text(CAST_WITH_PEER + CUE_EMPTY))
  assert.equal(m.cast.roles.length, 2)
  assert.deepEqual(m.cue, { triggers: [] })
})

test('🔴 有同学角色但**全部 enabled: false** ⇒ cast.policy 可省（没有启用中的同学）', () => {
  const guestOff = `    - id: ache
      file: characters/ache.md
      name: 阿澈
      role: guest
      enabled: false
      style: intuitive
      styleLabel: 直觉型
`
  const m = parseManifest(text(`cast:\n  roles:\n${TEACHER_ROLE}${guestOff}`))
  assert.equal(m.cast.policy, undefined)
  assert.deepEqual(peerRolesOf(m), [])
})

// ════════════════════════════════════════════════════════════════════════════
// ② 向后兼容 ＋ 硬约束（"老教室零改动、行为不变"）
// ════════════════════════════════════════════════════════════════════════════

test('🔴 没有 cast/cue 的老教室：manifest **不挂这两个键**（形状与加本批之前逐字相同）', () => {
  const m = parseManifest(text(''))
  assert.deepEqual(Object.keys(m), ['format', 'classroom', 'phases', 'blocks', 'runtime_store'])
  assert.equal('cast' in m, false)
  assert.equal('cue' in m, false)
})

test('🔴 既有 fixture（minimal-classroom）装载结果逐项不变', () => {
  const m = loadManifest(MINIMAL_FIXTURE)
  assert.equal(m.blocks.length, 5)
  assert.deepEqual(
    m.blocks.map((b) => b.id),
    ['narrative-core', 'anchor', 'knowledge-anchor', 'state-brief', 'quiz-rules'],
  )
  assert.equal('cast' in m, false)
  assert.equal('cue' in m, false)
  assert.deepEqual(peerRolesOf(m), [])
})

test('🔴 硬约束：cast 只声明老师 ⇒ peerRolesOf 返回空数组（引擎行为与今天一致）', () => {
  const m = loadManifest(TEACHER_ONLY_FIXTURE)
  assert.equal(m.cast.roles.length, 1)
  assert.equal(m.cast.roles[0].role, 'teacher')
  assert.equal(m.cast.policy, undefined)
  assert.equal('cue' in m, false)
  assert.deepEqual(peerRolesOf(m), [])
})

test('peerRolesOf：只算 enabled 的同学（老师与 enabled:false 都不算）', () => {
  const m = loadManifest(CAST_FIXTURE)
  assert.deepEqual(peerRolesOf(m).map((r) => r.id), ['chengji'])
})

// ════════════════════════════════════════════════════════════════════════════
// ③ cast 的非法输入（逐类：错误原文）
// ════════════════════════════════════════════════════════════════════════════

test('cast 不是映射 → 报错（带行号）', () => {
  const yaml = text('cast: 42\n')
  expectErrorAt(yaml, 'cast: 42', 'cast', '必须是映射（形如：cast: { roles: [...] }）')
})

test('cast 有未知键 → 报错并列出可用键（白名单：写错不静默）', () => {
  const yaml = text(`cast:\n  casts:\n    - a\n  roles:\n${TEACHER_ROLE}`)
  expectErrorAt(
    yaml,
    'casts:',
    'cast',
    '有无法识别的键 ["casts"]（可用：policy/roles）——未实现的键一律报错，不静默忽略（写错的声明若被放过，就成了"配了不生效"）',
  )
})

test('cast.roles 缺失 → 报错', () => {
  const yaml = text('cast:\n  policy: {}\n')
  expectErrorAt(
    yaml,
    'policy: {}',
    'cast.roles',
    '必须是非空数组（每位在场角色一项，老师也要声明；一位都不声明就别写 cast: 段）',
  )
})

test('cast.roles 空数组 → 报错', () => {
  const yaml = text('cast:\n  roles: []\n')
  expectErrorAt(yaml, 'roles: []', 'cast.roles', '必须是非空数组（每位在场角色一项，老师也要声明；一位都不声明就别写 cast: 段）')
})

test('cast.roles[i] 不是映射 → 报错', () => {
  const yaml = text('cast:\n  roles:\n    - hello\n')
  expectErrorAt(yaml, '- hello', 'cast.roles[0]', '必须是映射')
})

test('缺 id → 报错（必填缺失）', () => {
  const yaml = text('cast:\n  roles:\n    - file: characters/komari.md\n      name: 小鞠知花\n      role: teacher\n      enabled: true\n')
  expectErrorAt(yaml, '- file:', 'cast.roles[0].id', '必须是非空字符串（得到 undefined）')
})

test('id 类型错（数字）→ 报错', () => {
  const yaml = text('cast:\n  roles:\n    - id: 7\n      file: characters/komari.md\n      name: 小鞠知花\n      role: teacher\n      enabled: true\n')
  expectErrorAt(yaml, 'id: 7', 'cast.roles[0].id', '必须是非空字符串（得到 7）')
})

test('角色 id 重复 → 报错并指出第一次出现在哪一项', () => {
  const dup = `    - id: komari
      file: characters/komari.md
      name: 小鞠知花 2
      role: teacher
      enabled: true
`
  const yaml = text(`cast:\n  roles:\n${TEACHER_ROLE}${dup}`)
  expectErrorAt(
    yaml,
    ['- id: komari', 2],
    'cast.roles[1].id',
    '重复："komari"（已在 cast.roles[0] 声明）—— id 是引用键（cue.triggers[].roles 要引用它），必须唯一',
  )
})

test('缺 file → 报错', () => {
  const yaml = text('cast:\n  roles:\n    - id: komari\n      name: 小鞠知花\n      role: teacher\n      enabled: true\n')
  expectErrorAt(
    yaml,
    '- id: komari',
    'cast.roles[0].file',
    '必须是非空字符串（得到 undefined）—— 指向该角色的人格文件（格式照 characters/komari.md）',
  )
})

test('file 指向不存在的文件 → 报错（有 baseDir 时）；无 baseDir 则不做存在性校验', () => {
  const yaml = text('cast:\n  roles:\n    - id: nope\n      file: characters/nope.md\n      name: 无\n      role: teacher\n      enabled: true\n')
  expectErrorAt(
    yaml,
    'file: characters/nope.md',
    'cast.roles[0].file',
    `指向的人格文件不存在：characters/nope.md（相对教室根 ${CAST_FIXTURE} 解析）`,
    { baseDir: CAST_FIXTURE },
  )
  // parseManifest 仍是"无 baseDir 也能跑的纯函数"
  assert.equal(parseManifest(yaml).cast.roles[0].file, 'characters/nope.md')
})

test('缺 name → 报错', () => {
  const yaml = text('cast:\n  roles:\n    - id: komari\n      file: characters/komari.md\n      role: teacher\n      enabled: true\n')
  expectErrorAt(yaml, '- id: komari', 'cast.roles[0].name', '必须是非空字符串（得到 undefined）—— 这是名牌上显示的名字')
})

test('role 值域外 → 报错并列出可用值', () => {
  const yaml = text('cast:\n  roles:\n    - id: komari\n      file: characters/komari.md\n      name: 小鞠\n      role: student\n      enabled: true\n')
  expectErrorAt(
    yaml,
    'role: student',
    'cast.roles[0].role',
    '必须是 teacher/buddy/guest 之一（得到 "student"）—— teacher 是老师；buddy 是固定搭子；guest 是每讲客串',
  )
})

test('两位 teacher → 报错（本教室只有一位老师）', () => {
  const second = `    - id: komari2
      file: characters/komari.md
      name: 另一位老师
      role: teacher
      enabled: true
`
  const yaml = text(`cast:\n  roles:\n${TEACHER_ROLE}${second}`)
  expectErrorAt(
    yaml,
    ['role: teacher', 2],
    'cast.roles[1].role',
    '是本教室第 2 位 teacher（komari/komari2）—— 本教室只有一位老师，role: teacher 至多一项',
  )
})

test('enabled 非布尔 → 报错', () => {
  const yaml = text('cast:\n  roles:\n    - id: komari\n      file: characters/komari.md\n      name: 小鞠\n      role: teacher\n      enabled: yes\n')
  expectErrorAt(
    yaml,
    'enabled: yes',
    'cast.roles[0].enabled',
    '必须是布尔值 true/false（得到 "yes"）—— 这是本讲的开关（默认关闭的角色就写 false，而不是把它删掉）',
  )
})

test('老师写了 style/styleLabel → 报错（老师不参与风格匹配）', () => {
  const yaml = text('cast:\n  roles:\n    - id: komari\n      file: characters/komari.md\n      name: 小鞠\n      role: teacher\n      enabled: true\n      style: precise\n      styleLabel: 精确型\n')
  expectErrorAt(yaml, 'style: precise', 'cast.roles[0].style', '不该出现：老师不参与认知风格匹配（约束⑤的匹配只发生在同学身上）')
})

test('同学缺 style → 报错', () => {
  const yaml = text('cast:\n  roles:\n    - id: chengji\n      file: characters/chengji.md\n      name: 程霁\n      role: buddy\n      enabled: true\n      styleLabel: 精确型\n')
  expectErrorAt(
    yaml,
    '- id: chengji',
    'cast.roles[0].style',
    '必须是 intuitive/precise/stubborn/counterexample 之一（得到 undefined）—— 选人按"认知风格 × 错法"查表（约束⑤），写错值会让这位角色永远选不上',
  )
})

test('style 值域外 → 报错', () => {
  const yaml = text('cast:\n  roles:\n    - id: chengji\n      file: characters/chengji.md\n      name: 程霁\n      role: buddy\n      enabled: true\n      style: smart\n      styleLabel: 聪明型\n')
  expectErrorAt(
    yaml,
    'style: smart',
    'cast.roles[0].style',
    '必须是 intuitive/precise/stubborn/counterexample 之一（得到 "smart"）—— 选人按"认知风格 × 错法"查表（约束⑤），写错值会让这位角色永远选不上',
  )
})

test('同学缺 styleLabel → 报错', () => {
  const yaml = text('cast:\n  roles:\n    - id: chengji\n      file: characters/chengji.md\n      name: 程霁\n      role: buddy\n      enabled: true\n      style: precise\n')
  expectErrorAt(
    yaml,
    '- id: chengji',
    'cast.roles[0].styleLabel',
    '必须是非空字符串（得到 undefined）—— 这是台词里给学生看的中文风格标签（如"精确型"）；机器键 style 不能直接给学生看',
  )
})

test('有启用中的同学却没写 cast.policy → 报错（并点名是谁）', () => {
  const yaml = text(`cast:\n  roles:\n${TEACHER_ROLE}${BUDDY_ROLE}`)
  expectErrorAt(
    yaml,
    '  roles:',
    'cast.policy',
    '必填：本教室声明了 1 位启用中的同学（chengji），而"每讲几次、开场保护几回合、哪些相位可以出场"三项是**教室级**规则，必须显式声明（引擎不内置默认值——免得调不了）',
  )
})

test('cast.policy 未知键 → 报错', () => {
  const yaml = text(`cast:\n  policy:\n    lessonQuota: 4\n    minTurnGap: 5\n    allowedPhases: [probe]\n    density: sparse\n  roles:\n${TEACHER_ROLE}${BUDDY_ROLE}`)
  expectErrorAt(
    yaml,
    'lessonQuota: 4',
    'cast.policy',
    '有无法识别的键 ["density"]（可用：lessonQuota/minTurnGap/allowedPhases）——未实现的键一律报错，不静默忽略（写错的声明若被放过，就成了"配了不生效"）',
  )
})

test('policy.lessonQuota 类型/取值错 → 报错（含 0）', () => {
  const mk = (v) => text(`cast:\n  policy:\n    lessonQuota: ${v}\n    minTurnGap: 5\n    allowedPhases: [probe]\n  roles:\n${TEACHER_ROLE}${BUDDY_ROLE}`)
  expectErrorAt(mk('four'), 'lessonQuota: four', 'cast.policy.lessonQuota', '必须是 >=1 的整数（得到 "four"）—— 这是"每讲最多出场几次"，用户口径 3–5 次（约束④：发言是稀疏事件）')
  expectErrorAt(mk(0), 'lessonQuota: 0', 'cast.policy.lessonQuota', '必须是 >=1 的整数（得到 0）—— 这是"每讲最多出场几次"，用户口径 3–5 次（约束④：发言是稀疏事件）')
})

test('policy.minTurnGap 负数 → 报错', () => {
  const yaml = text(`cast:\n  policy:\n    lessonQuota: 4\n    minTurnGap: -1\n    allowedPhases: [probe]\n  roles:\n${TEACHER_ROLE}${BUDDY_ROLE}`)
  expectErrorAt(yaml, 'minTurnGap: -1', 'cast.policy.minTurnGap', '必须是 >=0 的整数（得到 -1）—— 这是开场保护：前几回合不出场（0＝不保护）')
})

test('policy.allowedPhases 空数组 / 相位不在值域内 / 重复 → 报错', () => {
  const mk = (v) => text(`cast:\n  policy:\n    lessonQuota: 4\n    minTurnGap: 5\n    allowedPhases: ${v}\n  roles:\n${TEACHER_ROLE}${BUDDY_ROLE}`)
  expectErrorAt(mk('[]'), 'allowedPhases: []', 'cast.policy.allowedPhases', '必须是非空数组（得到 []）—— 列"同学可以出场的相位"；一个都不列就别写 cast: 段')
  expectErrorAt(
    mk('[probe, lecture]'),
    'allowedPhases: [probe, lecture]',
    'cast.policy.allowedPhases[1]',
    '的相位 "lecture" 不在值域内（可用：open/probe/check/review/close）—— 不在值域内的相位永远不会命中，等于白写',
  )
  expectErrorAt(mk('[probe, probe]'), 'allowedPhases: [probe, probe]', 'cast.policy.allowedPhases[1]', '重复："probe"')
})

// ════════════════════════════════════════════════════════════════════════════
// ④ cue 的非法输入
// ════════════════════════════════════════════════════════════════════════════

test('写了 cue 却没有 cast → 报错（cue 要引用角色）', () => {
  const yaml = text(CUE_EMPTY)
  expectErrorAt(yaml, 'triggers: []', 'cue', '没有可引用的角色：本文件未声明 cast: 段（cue 的触发条件要引用 cast.roles[].id；不安排同学出场就别写 cue: 段）')
})

test('cue 有未知键 → 报错', () => {
  const yaml = text(CAST_WITH_PEER + 'cue:\n  trigger: []\n')
  expectErrorAt(
    yaml,
    'trigger: []',
    'cue',
    '有无法识别的键 ["trigger"]（可用：stall/triggers）——未实现的键一律报错，不静默忽略（写错的声明若被放过，就成了"配了不生效"）',
  )
})

test('cue.triggers 不是数组 → 报错（并说明空数组＝不出场）', () => {
  const yaml = text(CAST_WITH_PEER + 'cue:\n  triggers: none\n')
  expectErrorAt(yaml, 'triggers: none', 'cue.triggers', '必须是数组（得到 "none"）—— 写空数组 [] ＝本教室**不安排同学出场**（"先跑一讲没有同学的真实课"就用它）')
})

test('cue.triggers[i] 不是映射 → 报错', () => {
  const yaml = text(CAST_WITH_PEER + 'cue:\n  triggers:\n    - stall\n')
  expectErrorAt(yaml, '- stall', 'cue.triggers[0]', '必须是映射')
})

test('cue.triggers[i] 未知键 → 报错', () => {
  const yaml = text(CAST_WITH_PEER + 'cue:\n  triggers:\n    - when: teacher-invite\n      priority: 1\n')
  expectErrorAt(
    yaml,
    '- when: teacher-invite',
    'cue.triggers[0]',
    '有无法识别的键 ["priority"]（可用：when/roles/source）——未实现的键一律报错，不静默忽略（写错的声明若被放过，就成了"配了不生效"）',
  )
})

test('when 值域外 → 报错并列出三条路', () => {
  const yaml = text(CAST_WITH_PEER + 'cue:\n  triggers:\n    - when: student-silent\n')
  expectErrorAt(yaml, 'when: student-silent', 'cue.triggers[0].when', '必须是 stall/student-hit-known-wrong-step/teacher-invite 之一（得到 "student-silent"）')
})

test('when 重复 → 报错（顺序即优先级）', () => {
  const yaml = text(CAST_WITH_PEER + 'cue:\n  triggers:\n    - when: teacher-invite\n    - when: teacher-invite\n')
  expectErrorAt(yaml, ['- when: teacher-invite', 2], 'cue.triggers[1].when', '重复：teacher-invite——同一个出场路只准声明一次（数组顺序即优先级；想调优先级就调顺序）')
})

test('🔴 cue.triggers[].roles 引用了不存在的角色 → 报错并列出可用 id', () => {
  const yaml = text(CAST_WITH_PEER + 'cue:\n  triggers:\n    - when: teacher-invite\n      roles: [chengji, xuyan]\n')
  expectErrorAt(yaml, 'roles: [chengji, xuyan]', 'cue.triggers[0].roles[1]', '引用了不存在的角色 "xuyan"（cast.roles 里可用：komari/chengji）')
})

test('cue.triggers[].roles 空数组 / 重复 → 报错', () => {
  const empty = text(CAST_WITH_PEER + 'cue:\n  triggers:\n    - when: teacher-invite\n      roles: []\n')
  expectErrorAt(empty, 'roles: []', 'cue.triggers[0].roles', '必须是非空数组（得到 []）—— 不限制就整个键都不写')

  const dup = text(CAST_WITH_PEER + 'cue:\n  triggers:\n    - when: teacher-invite\n      roles: [chengji, chengji]\n')
  expectErrorAt(dup, 'roles: [chengji, chengji]', 'cue.triggers[0].roles[1]', '重复："chengji"')
})

test('when: stall 却没写 cue.stall → 报错（并列出该写的字段）', () => {
  const yaml = text(CAST_WITH_PEER + 'cue:\n  triggers:\n    - when: stall\n')
  expectErrorAt(
    yaml,
    'triggers:',
    'cue.stall',
    '必填：triggers 里有 when: stall（僵局路），但本段没有声明判据参数（nTurns / shortWindow / shortRatio / shortFloor / dontKnowPatterns / dontKnowExempt）',
  )
})

test('写了 cue.stall 但没有任何 when: stall → 报错（死配置）', () => {
  const stall = `  stall:
    nTurns: 3
    shortWindow: 5
    shortRatio: 0.4
    shortFloor: 8
    dontKnowPatterns:
      high: ["不知道"]
      mid: []
    dontKnowExempt: []
`
  const yaml = text(CAST_WITH_PEER + 'cue:\n' + stall + '  triggers:\n    - when: teacher-invite\n')
  expectErrorAt(yaml, 'nTurns: 3', 'cue.stall', '不该出现：triggers 里没有 when: stall，这段判据参数永远不会被读到（要开僵局路就加一条 when: stall 的 trigger）')
})

test('when: student-hit-known-wrong-step 缺 source → 报错', () => {
  const yaml = text(CAST_WITH_PEER + 'cue:\n  triggers:\n    - when: student-hit-known-wrong-step\n')
  expectErrorAt(
    yaml,
    'when: student-hit-known-wrong-step',
    'cue.triggers[0].source',
    '必填（非空字符串）：when: student-hit-known-wrong-step 要从错法库里取错法，必须写明来源文件（如 runtime/wrong_step_library.md）—— 错法不许模型即兴编（约束③）',
  )
})

test('不该有 source 的 when 写了 source → 报错', () => {
  const yaml = text(CAST_WITH_PEER + 'cue:\n  triggers:\n    - when: teacher-invite\n      source: runtime/mistake_log.md\n')
  expectErrorAt(
    yaml,
    'source: runtime/mistake_log.md',
    'cue.triggers[0].source',
    '不该出现：when: teacher-invite 不读错法库（只有 student-hit-known-wrong-step 需要 source）',
  )
})

test('source 指向不存在的错法库 → 报错（有 baseDir 时）', () => {
  const yaml = text(CAST_WITH_PEER + 'cue:\n  triggers:\n    - when: student-hit-known-wrong-step\n      source: runtime/nope.md\n')
  expectErrorAt(
    yaml,
    'source: runtime/nope.md',
    'cue.triggers[0].source',
    `指向的错法库文件不存在：runtime/nope.md（相对教室根 ${CAST_FIXTURE} 解析）`,
    { baseDir: CAST_FIXTURE },
  )
})

const stallBody = (over = {}) => `  stall:
    nTurns: ${over.nTurns ?? 3}
    shortWindow: ${over.shortWindow ?? 5}
    shortRatio: ${over.shortRatio ?? 0.4}
    shortFloor: ${over.shortFloor ?? 8}
${over.dontKnowPatterns ?? '    dontKnowPatterns:\n      high: ["不知道"]\n      mid: []\n'}    dontKnowExempt: ${over.dontKnowExempt ?? '[]'}
`

test('stall 参数类型/取值错 → 逐条报错', () => {
  const mk = (over) => text(CAST_WITH_PEER + 'cue:\n' + stallBody(over) + '  triggers:\n    - when: stall\n')

  expectErrorAt(mk({ nTurns: 0 }), 'nTurns: 0', 'cue.stall.nTurns', '必须是 >=1 的整数（得到 0）')
  expectErrorAt(mk({ shortWindow: 1.5 }), 'shortWindow: 1.5', 'cue.stall.shortWindow', '必须是 >=1 的整数（得到 1.5）')
  expectErrorAt(
    mk({ shortRatio: 0 }),
    'shortRatio: 0',
    'cue.stall.shortRatio',
    '必须是 (0,1] 的数（得到 0）—— 学生消息长度降到中位数的这个比例以下才算"变短"',
  )
  expectErrorAt(
    mk({ shortRatio: 1.2 }),
    'shortRatio: 1.2',
    'cue.stall.shortRatio',
    '必须是 (0,1] 的数（得到 1.2）—— 学生消息长度降到中位数的这个比例以下才算"变短"',
  )
  expectErrorAt(mk({ shortFloor: -1 }), 'shortFloor: -1', 'cue.stall.shortFloor', '必须是 >=0 的整数（得到 -1）')
})

test('stall.dontKnowPatterns.high 空数组 / 缺 high / 未知键 → 报错', () => {
  const mk = (dk) => text(CAST_WITH_PEER + 'cue:\n' + stallBody({ dontKnowPatterns: dk }) + '  triggers:\n    - when: stall\n')

  expectErrorAt(
    mk('    dontKnowPatterns:\n      high: []\n      mid: []\n'),
    'high: []',
    'cue.stall.dontKnowPatterns.high',
    '至少要 1 项（得到 0 项）',
  )
  expectErrorAt(
    mk('    dontKnowPatterns:\n      high: ["不知道"]\n      mid: []\n      low: []\n'),
    'high: ["不知道"]',
    'cue.stall.dontKnowPatterns',
    '有无法识别的键 ["low"]（可用：high/mid）——未实现的键一律报错，不静默忽略（写错的声明若被放过，就成了"配了不生效"）',
  )
  expectErrorAt(
    mk('    dontKnowPatterns:\n      mid: []\n'),
    'mid: []',
    'cue.stall.dontKnowPatterns.high',
    '必须是字符串数组（得到 undefined）',
  )
})

test('stall.dontKnowExempt 非数组 → 报错', () => {
  const yaml = text(CAST_WITH_PEER + 'cue:\n' + stallBody({ dontKnowExempt: '不会影响' }) + '  triggers:\n    - when: stall\n')
  expectErrorAt(yaml, 'dontKnowExempt: 不会影响', 'cue.stall.dontKnowExempt', '必须是字符串数组（得到 "不会影响"）')
})

test('🔴 只有老师 + 非空 triggers → 报错（死配置；"先跑没有同学的课"请写 triggers: []）', () => {
  const yaml = text(`cast:\n  roles:\n${TEACHER_ROLE}` + 'cue:\n  triggers:\n    - when: teacher-invite\n')
  expectErrorAt(
    yaml,
    '- when: teacher-invite',
    'cue.triggers',
    '声明了 1 条出场路，但 cast.roles 里一位同学都没有（只有老师）——这些出场路永远不会命中，故报错；"先跑一讲没有同学的真实课"请把 triggers 写成 []',
  )
})

// ════════════════════════════════════════════════════════════════════════════
// ⑤ YAML 语法错误仍走原路径（改用 parseDocument 后不得退化）
// ════════════════════════════════════════════════════════════════════════════

test('YAML 语法错误 → 仍是 ManifestError（parseDocument 迁移不退化）', () => {
  assert.throws(() => parseManifest('format: [unclosed'), ManifestError)
  assert.match(catchManifestError(() => parseManifest('format: [unclosed')), /^classroom\.yaml: YAML 语法错误：/)
})
