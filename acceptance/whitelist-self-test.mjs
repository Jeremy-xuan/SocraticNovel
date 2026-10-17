#!/usr/bin/env node
// whitelist-self-test.mjs — ACCEPT-2 的「白名单自检」（**不跑真实会话、不花钱**）
//
// 用法：
//   node acceptance/whitelist-self-test.mjs
//
// 退出码：0 = 全部通过；1 = 有失败（**绝不静默**：任何一项查不出来都算失败）。
//
// 🔴 它证明三件事：
//   ① **白得有理**：取证件的 17 条告警逐条喂进 lib/whitelist.mjs，**17 条全部落在白名单内**
//      （3 探针 / 1 用户配置 / 10 用户级第三方技能 / 3 宿主自身），且命中的规则与取证件的归属**一一对应**；
//   ② **负向真的会红**：喂一条**不在白名单里**的宿主告警 → 必须被判为 `unmatched`（A6.5 会因此失败）；
//      并单独验证"我们的技能包被忽略"这种最危险的形态**不会被白名单吞掉**；
//   ③ **不静默**：任何一项判不出来（异常、字段缺失、条数对不上）都打印原因并非零退出。
//
// 取证件（**外部文档，未随本仓库分发**）：《宿主告警排查 2026-09-24》（§1 逐字原文、§2.1/§2.2 归属）

import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { classify, classifyAll, ruleCatalog } from './lib/whitelist.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 用户级第三方技能目录（宿主会扫的那个根）——按**本机**家目录拼，不写死用户名。 */
const AGENTS_SKILLS = join(homedir(), '.agents', 'skills') + '/'
/** 我们自己的技能包（仓库根下的 skills/socratic-classroom）——用于"最危险的形态"那条负向对照。 */
const OUR_SKILL_DIR = join(resolve(HERE, '..'), 'skills', 'socratic-classroom')

const failures = []
const notes = []
const ok = (text) => console.log(`  ✔ ${text}`)
const bad = (text) => {
  failures.push(text)
  console.log(`  ✖ ${text}`)
}

console.log('ACCEPT-2 白名单自检（不跑真实会话）')
console.log('='.repeat(72))

// ─────────────────────────────────────────────────────────────────────────────
// ① 取证件的 17 条逐条喂进去（模块名与 args 逐字取自取证件 §1）
// ─────────────────────────────────────────────────────────────────────────────
// 每条：{ sn, type, name, args, expectRule }；expectRule 取自取证件 §2.2 的归属汇总。
const FORENSIC_17 = [
  { sn: 1, type: 'error', name: '[socratic-accept-probe:positive-control]', args: ['正向对照 error：这条形状应当出现在日志桥里'], expectRule: 'own-probe' },
  { sn: 3, type: 'warn', name: '[socratic-accept-probe:positive-control]', args: ['正向对照 warn：这条形状应当出现在日志桥里'], expectRule: 'own-probe' },
  { sn: 4, type: 'warn', name: '[socratic-engine]:shape-control', args: ['被测形状：这段文字在引擎的调用形状下应当被丢掉'], expectRule: 'own-probe' },
  {
    sn: 7,
    type: 'error',
    name: 'permission-preset-service',
    args: [{ error: '$.defaultPreset expected "read-only" | "workspace-write" | "danger-full-access" but got "full-access-ask"', stack: '…schemastery/lib/index.mjs:496 → dsh-settings/lib/index.js:510' }],
    expectRule: 'user-config-permission-preset',
  },
  { sn: 8, type: 'warn', name: 'skill-filesystem', args: [`skill file ${AGENTS_SKILLS}benchmark/SKILL.md ignored: missing YAML frontmatter`], expectRule: 'user-level-third-party-skill' },
  { sn: 9, type: 'warn', name: 'skill-filesystem', args: [`skill file ${AGENTS_SKILLS}browser-qa/SKILL.md ignored: missing YAML frontmatter`], expectRule: 'user-level-third-party-skill' },
  { sn: 10, type: 'warn', name: 'skill-filesystem', args: [`skill file ${AGENTS_SKILLS}canary-watch/SKILL.md ignored: missing YAML frontmatter`], expectRule: 'user-level-third-party-skill' },
  { sn: 11, type: 'warn', name: 'skill-filesystem', args: [`skill file ${AGENTS_SKILLS}claude-api/SKILL.md ignored: invalid skill name "Codex-api"`], expectRule: 'user-level-third-party-skill' },
  { sn: 12, type: 'warn', name: 'skill-filesystem', args: [`skill file ${AGENTS_SKILLS}claude-devfleet/SKILL.md ignored: invalid skill name "Codex-devfleet"`], expectRule: 'user-level-third-party-skill' },
  { sn: 13, type: 'warn', name: 'skill-filesystem', args: [`skill file ${AGENTS_SKILLS}design-system/SKILL.md ignored: missing YAML frontmatter`], expectRule: 'user-level-third-party-skill' },
  { sn: 14, type: 'warn', name: 'skill-filesystem', args: [`skill file ${AGENTS_SKILLS}laravel-verification/SKILL.md ignored: invalid YAML frontmatter: YAMLParseError: Nested mappings are not allowed in compact mappings at line 2, column 14`], expectRule: 'user-level-third-party-skill' },
  { sn: 15, type: 'warn', name: 'skill-filesystem', args: [`skill file ${AGENTS_SKILLS}product-lens/SKILL.md ignored: missing YAML frontmatter`], expectRule: 'user-level-third-party-skill' },
  { sn: 16, type: 'warn', name: 'skill-filesystem', args: [`skill file ${AGENTS_SKILLS}safety-guard/SKILL.md ignored: missing YAML frontmatter`], expectRule: 'user-level-third-party-skill' },
  { sn: 17, type: 'warn', name: 'skill-filesystem', args: [`skill file ${AGENTS_SKILLS}skill-stocktake/SKILL.md ignored: frontmatter requires name and description`], expectRule: 'user-level-third-party-skill' },
  { sn: 18, type: 'warn', name: 'session-title-service', args: ['session "session-813c23bd-479c-4f00-bdc1-fff575f9ad24": automatic title generation failed: Error: session-title-llm: title output reached maxOutputTokens'], expectRule: 'host-self-session-title' },
  { sn: 19, type: 'warn', name: 'local-subprocess-runtime', args: ['subprocess-local is using weaker process-tree containment because macOS has no supported persistent process-range owner; descendants that escape the process group or direct-parent tree are not guaranteed to terminate or delay waitForExit()'], expectRule: 'host-self-subprocess-containment' },
  { sn: 20, type: 'warn', name: 'goal-round-driver', args: ['goal-round-driver: could not disarm agent "session-813c23bd-479c-4f00-bdc1-fff575f9ad24": goal projection is not registered'], expectRule: 'host-self-goal-round-driver' },
]

console.log('\n[①] 取证件 17 条逐条归属')
if (FORENSIC_17.length !== 17) bad(`内置取证样本条数不是 17（实际 ${FORENSIC_17.length}）——样本本身写错了`)
let misrouted = 0
for (const row of FORENSIC_17) {
  const verdict = classify(row)
  if (!verdict.whitelisted) {
    misrouted++
    bad(`sn=${row.sn} 模块名 ${row.name} **不在白名单内**（取证件判它属于 ${row.expectRule}）`)
  } else if (verdict.ruleId !== row.expectRule) {
    misrouted++
    bad(`sn=${row.sn} 命中的规则是 ${verdict.ruleId}，取证件判它是 ${row.expectRule} → 白名单的归属与取证不符`)
  }
}
if (misrouted === 0) ok('17 条全部落在白名单内，且命中规则与取证件 §2.2 归属逐条一致')

const summary = classifyAll(FORENSIC_17)
console.log(
  `    汇总：共 ${summary.totalMessages} 条（其中 error/warn ${summary.problemMessages}）｜` +
    `白名单内 ${summary.whitelisted}｜不在白名单 ${summary.unmatched}`,
)
console.log(`    命中规则：${summary.matchedRules.map((r) => `${r.ruleId}×${r.count}`).join('、')}`)
if (summary.unmatched !== 0) bad(`取证件样本里有 ${summary.unmatched} 条不在白名单——白名单没盖住取证结论`)
if (summary.problemMessages !== 17) bad(`判为 error/warn 的条数是 ${summary.problemMessages}，期望 17`)
if (summary.staleRules.length > 0) {
  // 不判失败（规则可以暂时没命中），但必须打印出来
  notes.push(`本次未被命中的白名单规则：${summary.staleRules.map((r) => r.ruleId).join('、')}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// ② 负向：不在白名单里的告警必须被抓住（＝A6.5 真的会红）
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[②] 负向对照：非白名单告警必须被抓出')

const NEGATIVE_CASES = [
  {
    label: '我们的负向对照探针（ACCEPT_NEGATIVE_CONTROL=1 时由 log-bridge 打出）',
    message: { sn: 99, type: 'warn', name: '[socratic-accept-probe:negative-control]', args: ['ACCEPT-2 负向对照：这条不在白名单里，A6.5 应当因此判失败'] },
  },
  {
    label: '🔴 最危险形态：**我们自己的技能包**被忽略（路径在仓库内，不是 ~/.agents/skills/）',
    message: { sn: 98, type: 'warn', name: 'skill-filesystem', args: [`skill file ${OUR_SKILL_DIR}/SKILL.md ignored: invalid skill name \"Socratic_Classroom\"`] },
  },
  {
    label: '一个全新模块名打出的 warn（宿主/新插件引入的新问题）',
    message: { sn: 97, type: 'warn', name: 'some-brand-new-service', args: ['something new went wrong'] },
  },
  {
    label: '被测插件自己打出的 error（我们的代码出问题）',
    message: { sn: 96, type: 'error', name: '[socratic-engine]', args: ['注入失败：…'] },
  },
]

for (const { label, message } of NEGATIVE_CASES) {
  const verdict = classify(message)
  if (verdict.whitelisted) bad(`负向样本被白名单吞掉了（ruleId=${verdict.ruleId}）：${label}`)
  else ok(`被判为"不在白名单"→ A6.5 会失败：${label}`)
}

// 整批喂进去：非白名单条数必须等于负向样本数（证明分类器不会漏也不会误伤）
const mixed = [...FORENSIC_17, ...NEGATIVE_CASES.map((c) => c.message)]
const mixedSummary = classifyAll(mixed)
console.log(
  `    混合批（17 白名单 + ${NEGATIVE_CASES.length} 非白名单）：共 ${mixedSummary.problemMessages} 条，` +
    `白名单内 ${mixedSummary.whitelisted}，不在白名单 ${mixedSummary.unmatched}`,
)
if (mixedSummary.unmatched !== NEGATIVE_CASES.length) {
  bad(`混合批里不在白名单的条数是 ${mixedSummary.unmatched}，期望 ${NEGATIVE_CASES.length}（分类器漏判或误伤）`)
} else ok(`混合批判定正确：白名单 ${mixedSummary.whitelisted} 条原样通过，${mixedSummary.unmatched} 条新告警全部被抓出`)

// info 级别不算问题消息（日志桥会把 info 也收下来，但 A6.5 只判 error/warn）
const infoOnly = classifyAll([{ sn: 1, type: 'info', name: '[socratic-accept-probe:positive-control]', args: ['正向对照 info'] }])
if (infoOnly.problemMessages !== 0) bad(`info 级消息被判成了问题消息（problemMessages=${infoOnly.problemMessages}）`)
else ok('info 级消息不计入"宿主告警"（A6.5 只判 error/warn）')

// ─────────────────────────────────────────────────────────────────────────────
// ③ 白名单自身的完整性（每条都要有理由与取证指向）
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[③] 白名单每条都必须写明理由与取证依据')
let incomplete = 0
for (const rule of ruleCatalog()) {
  if (typeof rule.why !== 'string' || rule.why.trim().length < 20) {
    incomplete++
    bad(`规则 ${rule.id} 没有写清"为什么不是我们的问题"`)
  }
  if (typeof rule.source !== 'string' || !rule.source.includes('宿主告警排查 2026-09-24')) {
    incomplete++
    bad(`规则 ${rule.id} 没有指向取证件（source=${JSON.stringify(rule.source)}）`)
  }
}
if (ruleCatalog().length !== 6) {
  incomplete++
  bad(`白名单规则数是 ${ruleCatalog().length}，期望 6（探针/第三方技能/用户配置/宿主三条）`)
}
if (incomplete === 0) ok(`${ruleCatalog().length} 条规则全部写明理由且指向取证件`)

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(72))
if (notes.length > 0) {
  console.log('说明：')
  for (const note of notes) console.log(`  · ${note}`)
}
if (failures.length === 0) {
  console.log('结论：全部通过（退出码 0）')
  process.exit(0)
}
console.log(`结论：发现 ${failures.length} 个问题（退出码 1）`)
for (const f of failures) console.log(`  - ${f}`)
process.exit(1)
