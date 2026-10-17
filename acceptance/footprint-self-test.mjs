#!/usr/bin/env node
// footprint-self-test.mjs — ACCEPT-4 的「写足迹守卫自检」（**不跑真实会话、不花钱**）
//
// 用法：
//   node acceptance/footprint-self-test.mjs
//
// 退出码：0 = 全部通过；1 = 有失败（**绝不静默**：任何一项查不出来都算失败）。
//
// 🔴 它证明五件事（每一件都是"这条守卫没被放宽成永远绿"的直接证据）：
//   ① **白得有理**：写足迹白名单每一条都写了"为什么这个位置算我们的"，且**空白名单判失败**；
//   ② **正常足迹 → 通过**：一份落在白名单内的写足迹 → 守卫绿；
//   ③ **越界写入 → 判红**（负向对照 A）：白名单外的写 → 守卫红，并指名那条路径；
//   ④ **受保护 profile 的变化若出现在我们的足迹里 → 判红**（负向对照 B）：
//      这就是"我们真去写了用户 profile"的形态；同时验证**反例**——
//      同样的变化若**不在**足迹里（＝常驻 App 自己写的，ACCEPT-3 那条假红）→ 不归因给我们；
//   ⑤ **完整性扫描不是空壳**：给扫描器喂一个"绕开 ledger 的写调用" → 必须报出来。
//
// 🔴 本脚本**不写用户环境**：所有产物落在 `$TMPDIR/accept4-selftest-*/`（跑完删除）。

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  WriteLedger,
  auditWhitelistRules,
  attributeProtectedChanges,
  configureFootprint,
  evaluateZeroTouch,
  scanUninstrumentedWrites,
  WRITE_WHITELIST,
} from './lib/footprint.mjs'
import { runInstalledSkillSelfCheck } from './lib/skillcheck.mjs'

const failures = []
const ok = (text) => console.log(`  ✔ ${text}`)
const bad = (text) => {
  failures.push(text)
  console.log(`  ✖ ${text}`)
}

const scratch = join(tmpdir(), `accept4-selftest-${process.pid}`)
mkdirSync(scratch, { recursive: true })

console.log('ACCEPT-4 写足迹守卫自检（不跑真实会话）')
console.log('='.repeat(72))

// ─────────────────────────────────────────────────────────────────────────────
// ① 白名单自身的完整性：每条都要写明理由；空白名单必须判失败
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[①] 写足迹白名单：每条都要写明"为什么这个位置算我们的"')
const audit = auditWhitelistRules()
if (audit.ok) ok(`${audit.count} 条规则全部写明理由（id/label/why/source 齐全，why 长度 ≥ 20）`)
else bad(`白名单规则不完整：${audit.problems.join('；')}`)
const emptyAudit = auditWhitelistRules([])
if (emptyAudit.ok) bad('空白名单被判成"成立" —— 空白名单等于"什么都允许"，必须判失败')
else ok(`空白名单被判失败（如设计）：${emptyAudit.problems[0]}`)
console.log(`    规则清单：${WRITE_WHITELIST.map((r) => r.id).join('、')}`)

// 合成一个"运行上下文"（全部在 $TMPDIR 下，不碰任何真实目录）
const fake = {
  runDir: join(scratch, 'runs', '2026-09-24_000000'),
  acceptanceDir: join(scratch, 'acceptance'),
  dshHome: join(scratch, 'dsh-home'),
  tmpDir: join(scratch, 'tmp'),
  acceptProfile: 'socratic-accept',
  forbiddenProfiles: ['web', 'desktop', 'desktop-safe-mode'],
  sessionLogDirs: [join(scratch, 'dsh-home', 'sessions', '--tmp-classroom--', 'session-x')],
}
for (const d of [fake.runDir, fake.acceptanceDir, join(fake.dshHome, 'profiles'), fake.tmpDir, fake.sessionLogDirs[0]]) {
  mkdirSync(d, { recursive: true })
}
configureFootprint(fake)

const cleanScan = { ok: true, scannedFiles: 16, callSites: 19, violations: [], note: '（自检里用一份"干净的扫描结论"占位）' }
const changedWithNothing = { web: [], desktop: [], 'desktop-safe-mode': [] }

// ─────────────────────────────────────────────────────────────────────────────
// ② 正常足迹（全部在白名单内）→ 守卫必须绿
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[②] 正常跑一次：写足迹全在白名单内 → 守卫应当**通过**')
const goodLedger = new WriteLedger()
goodLedger.recordWrite({ kind: 'dir', path: fake.runDir, stage: '00', source: '自检' })
goodLedger.recordWrite({ kind: 'file', path: join(fake.runDir, '00-preflight', 'env.json'), stage: '00', source: '自检' })
goodLedger.recordWrite({ kind: 'file', path: join(fake.acceptanceDir, '验收报告_最新.md'), stage: '05', source: '自检' })
goodLedger.recordWrite({ kind: 'file', path: join(fake.dshHome, 'profiles', 'socratic-accept', 'cordis.patch.yml'), stage: '02', source: '自检' })
goodLedger.recordWrite({ kind: 'mkdtemp-prefix', path: join(fake.tmpDir, 'accept-classroom-'), stage: '03', source: '自检' })
goodLedger.recordWrite({ kind: 'file', path: join(fake.tmpDir, 'accept-classroom-abc', 'classroom', 'cs-os', 'classroom.yaml'), stage: '03', source: '自检' })
goodLedger.recordCommand({ cmd: `node bin.js --profile socratic-accept --patch /x/patch.yml`, source: '自检' })
const goodGuard = evaluateZeroTouch({
  ctx: fake,
  ledger: goodLedger,
  changedByProfile: changedWithNothing,
  samplerObserved: { web: [], desktop: [], 'desktop-safe-mode': [] },
  scan: cleanScan,
  writeWhitelistAudit: audit,
})
if (goodGuard.ok) ok(`守卫通过（写足迹 ${goodLedger.entries.length} 条全在白名单内，命令 ${goodLedger.commands.length} 条无受保护 profile）`)
else bad(`正常足迹竟被判红 → ${goodGuard.reasons.join('；')}`)

// ─────────────────────────────────────────────────────────────────────────────
// ③ 负向对照 A：越界写入 → 必须判红
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[③] 负向对照 A：在"允许写的位置之外"写一次 → 守卫必须**判红**')
const badLedger = new WriteLedger()
badLedger.recordWrite({ kind: 'file', path: join(fake.runDir, 'ok.json'), stage: '00', source: '自检' })
badLedger.recordWrite({ kind: 'file', path: join(fake.acceptanceDir, 'negative-control', 'OUTSIDE-WHITELIST.txt'), stage: '00', source: '自检（故意越界）' })
const badGuard = evaluateZeroTouch({
  ctx: fake,
  ledger: badLedger,
  changedByProfile: changedWithNothing,
  samplerObserved: { web: [], desktop: [], 'desktop-safe-mode': [] },
  scan: cleanScan,
  writeWhitelistAudit: audit,
})
if (!badGuard.ok && badGuard.reasons.some((r) => r.includes('OUTSIDE-WHITELIST.txt'))) {
  ok(`越界写入被抓出（判红），理由逐字：${badGuard.reasons.find((r) => r.includes('OUTSIDE-WHITELIST'))}`)
} else {
  bad(`越界写入**没有**被抓出 → 守卫被放宽成了"永远绿"（reasons=${JSON.stringify(badGuard.reasons)}）`)
}

// 再验一条"反向"的：白名单外的**临时目录**（不是 accept-classroom- 前缀）也必须判红
const tmpLedger = new WriteLedger()
tmpLedger.recordWrite({ kind: 'file', path: join(fake.tmpDir, 'some-other-tmp-file'), stage: '03', source: '自检（故意越界）' })
const tmpGuard = evaluateZeroTouch({
  ctx: fake,
  ledger: tmpLedger,
  changedByProfile: changedWithNothing,
  samplerObserved: { web: [], desktop: [], 'desktop-safe-mode': [] },
  scan: cleanScan,
  writeWhitelistAudit: audit,
})
if (!tmpGuard.ok) ok('白名单外的临时目录写入同样判红（不是"只要在 $TMPDIR 里就放过"）')
else bad('$TMPDIR 下的**非白名单**目录被放过了 → 白名单太松')

// ─────────────────────────────────────────────────────────────────────────────
// ③b 命令的声明写目标：新形状必须登记；受保护 profile 必须命中
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[③b] 命令级：新命令形状必须登记写目标；受保护 profile 必须被抓出')
const unregLedger = new WriteLedger()
unregLedger.recordWrite({ kind: 'file', path: join(fake.runDir, 'ok.json'), stage: '00', source: '自检' })
unregLedger.recordCommand({ cmd: 'rsync -a /some/src /some/dst', source: '自检（未登记形状）' })
const unregGuard = evaluateZeroTouch({
  ctx: fake,
  ledger: unregLedger,
  changedByProfile: changedWithNothing,
  samplerObserved: { web: [], desktop: [], 'desktop-safe-mode': [] },
  scan: cleanScan,
  writeWhitelistAudit: audit,
})
if (!unregGuard.ok && unregGuard.reasons.some((r) => r.includes('没有登记写目标'))) {
  ok('没登记过写目标的命令形状被判红（新命令必须先声明"它会写哪儿"）')
} else {
  bad(`未登记的命令形状被放过了：${JSON.stringify(unregGuard.reasons)}`)
}
const webCmdLedger = new WriteLedger()
webCmdLedger.recordWrite({ kind: 'file', path: join(fake.runDir, 'ok.json'), stage: '02', source: '自检' })
webCmdLedger.recordCommand({ cmd: `node bin.js plugin --profile web add file:/x`, source: '自检（模拟误用 web profile）' })
const webCmdGuard = evaluateZeroTouch({
  ctx: fake,
  ledger: webCmdLedger,
  changedByProfile: changedWithNothing,
  samplerObserved: { web: [], desktop: [], 'desktop-safe-mode': [] },
  scan: cleanScan,
  writeWhitelistAudit: audit,
})
const hitForbidden = webCmdGuard.reasons.some((r) => r.includes('命令里出现受保护 profile'))
const hitTarget = webCmdGuard.reasons.some((r) => r.includes('声明写目标落在白名单外'))
if (hitForbidden && hitTarget) ok('`--profile web` 同时触发"命令里出现受保护 profile"与"声明写目标在白名单外"两条')
else bad(`` + `--profile web 没有被双重抓住（forbidden=${hitForbidden}, target=${hitTarget}）`)


console.log('\n[④] 受保护 profile 的变化：在足迹里＝我们的（红）；不在足迹里＝不是我们的（绿）')

// B1：变化**在**我们的写足迹里 → 归因给我们 → 红（这就是"我们真去写了用户 profile"的形态）
const oursLedger = new WriteLedger()
oursLedger.recordWrite({ kind: 'file', path: join(fake.dshHome, 'profiles', 'web', 'desktop-storage.json'), stage: '03', source: '自检（模拟"我们写了 web profile"）' })
const attrOurs = attributeProtectedChanges({
  ctx: fake,
  changedByProfile: { web: ['desktop-storage.json'], desktop: [], 'desktop-safe-mode': [] },
  ledger: oursLedger,
})
if (attrOurs.web.attributedToUs.length === 1 && attrOurs.web.rows[0].attribution === 'ours') {
  ok('变化出现在我们的足迹里 → 归因给我们（web 命中 ledger 条目，判红）')
} else {
  bad(`"我们写了 web profile"这种形态没被判成我们的：${JSON.stringify(attrOurs.web)}`)
}
const oursGuard = evaluateZeroTouch({
  ctx: fake,
  ledger: oursLedger,
  changedByProfile: { web: ['desktop-storage.json'], desktop: [], 'desktop-safe-mode': [] },
  samplerObserved: { web: [], desktop: [], 'desktop-safe-mode': [] },
  scan: cleanScan,
  writeWhitelistAudit: audit,
})
if (!oursGuard.ok) ok(`守卫判红，理由：${oursGuard.reasons[0]}`)
else bad('"我们写了受保护 profile"竟被判绿 → 守卫失效')

// B2：变化**不在**足迹里 → 不归因给我们 → 绿（**这正是 ACCEPT-3 那条假红的形态**）
const cleanLedger = new WriteLedger()
cleanLedger.recordWrite({ kind: 'file', path: join(fake.runDir, 'x.json'), stage: '03', source: '自检' })
cleanLedger.recordWrite({ kind: 'file', path: join(fake.runDir, 'y.json'), stage: '04', source: '自检（模拟"黑窗口"里我们在写自己的证据）' })
const attrNotOurs = attributeProtectedChanges({
  ctx: fake,
  changedByProfile: { web: ['desktop-storage.json'], desktop: [], 'desktop-safe-mode': [] },
  ledger: cleanLedger,
})
if (attrNotOurs.web.attributedToUs.length === 0 && attrNotOurs.web.notOurs.length === 1) {
  ok(`不在足迹里 → 不归因给我们（判据逐字：${attrNotOurs.web.rows[0].why.slice(0, 60)}…）`)
} else {
  bad(`"常驻 App 自己写的变化"被误算到我们头上：${JSON.stringify(attrNotOurs.web)}`)
}
const cleanGuard = evaluateZeroTouch({
  ctx: fake,
  ledger: cleanLedger,
  changedByProfile: { web: ['desktop-storage.json'], desktop: [], 'desktop-safe-mode': [] },
  samplerObserved: { web: [], desktop: [], 'desktop-safe-mode': [] },
  scan: cleanScan,
  writeWhitelistAudit: audit,
})
if (cleanGuard.ok) ok('守卫通过（ACCEPT-3 那条假红的形态在新判据下不再误报）')
else bad(`假红形态仍被判红 → ${cleanGuard.reasons.join('；')}`)

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 完整性扫描不是空壳：喂一个"绕开 ledger 的写调用" → 必须报出来
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[⑤] 写足迹完整性扫描：绕开 ledger 的写调用必须被抓出')
const scanRoot = join(scratch, 'scan-root')
mkdirSync(join(scanRoot, 'probe'), { recursive: true })
mkdirSync(join(scanRoot, 'lib'), { recursive: true })
// 干净的形状：走 util 的 ledger 原语（不出现 fs 写调用）
writeFileSync(join(scanRoot, 'accept.mjs'), "import { writeJson } from './lib/util.mjs'\nwriteJson('/x/y.json', {})\n")
writeFileSync(join(scanRoot, 'lib', 'util.mjs'), "export function writeJson() {}\n")
// 坏形状 1：不在允许名单里的文件直接调 writeFileSync
writeFileSync(join(scanRoot, 'lib', 'sneaky.mjs'), "import { writeFileSync } from 'node:fs'\nwriteFileSync('/somewhere/else.json', '{}')\n")
// 坏形状 2：探针里出现**未登记**的写目标
writeFileSync(join(scanRoot, 'probe', 'log-bridge.mjs'), "import { appendFileSync } from 'node:fs'\nappendFileSync(someUndeclaredPath, 'x')\n")
for (const n of ['a', 'b', 'c', 'd']) writeFileSync(join(scanRoot, `file-${n}.mjs`), '// 占位文件\n')
const scan = scanUninstrumentedWrites({ acceptanceDir: scanRoot })
const sneaky = scan.violations.find((v) => v.file === 'lib/sneaky.mjs')
const undeclared = scan.violations.find((v) => v.file === 'probe/log-bridge.mjs')
if (sneaky !== undefined) ok(`不在允许名单里的文件被抓住：lib/sneaky.mjs:${sneaky.line} ${sneaky.fn}(${sneaky.expr})`)
else bad('lib/sneaky.mjs 的直接写盘**没有**被抓出来 → 完整性扫描是空壳')
if (undeclared !== undefined) ok(`探针的未登记写目标被抓住：probe/log-bridge.mjs:${undeclared.line} ${undeclared.fn}(${undeclared.expr})`)
else bad('探针的未登记写目标**没有**被抓出来')
const realScan = scanUninstrumentedWrites({ acceptanceDir: join(import.meta.dirname) })
if (realScan.ok) {
  ok(`真实流水线代码扫描通过：${realScan.scannedFiles} 个源文件 / ${realScan.callSites} 处写调用，未登记 0 处`)
} else {
  bad(`真实流水线代码里有未登记的写调用：${realScan.violations.map((v) => `${v.file}:${v.line} ${v.fn}(${v.expr})`).join('、')}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ 技能包自检的"未安装"路径：必须**显式报"未安装、该检查跳过"**（不静默）
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[⑥] 技能包自检（已装副本）"未安装"路径：必须显式报跳过')
const notInstalled = runInstalledSkillSelfCheck({ dshHome: join(scratch, 'dsh-home-NOT-EXIST'), outDir: scratch })
if (notInstalled.applicable === false && notInstalled.verdict === 'not-installed' && notInstalled.detail.includes('未安装、该检查跳过')) {
  ok(`未安装 → applicable=false、verdict=not-installed、文案含"未安装、该检查跳过"`)
  console.log(`    逐字：${notInstalled.detail}`)
} else {
  bad(`"未安装"没有被显式报出来：${JSON.stringify({ applicable: notInstalled.applicable, verdict: notInstalled.verdict })}`)
}
const realInstalled = runInstalledSkillSelfCheck({
  // 🔴 用**隔离的** DSH_HOME（与 run.sh 同口径）：本自检只读它，绝不碰用户真实 harness
  dshHome: process.env.DSH_HOME ?? join(tmpdir(), 'socratic-accept-dsh', 'harness'),
  outDir: scratch,
})
console.log(
  `    本机实况（只读）：${realInstalled.applicable ? `已装 → exit ${realInstalled.exitCode}、判定 ${realInstalled.verdict}` : '未装（该检查跳过）'}`,
)

// ─────────────────────────────────────────────────────────────────────────────
rmSync(scratch, { recursive: true, force: true })
console.log('\n' + '='.repeat(72))
if (failures.length === 0) {
  console.log('结论：全部通过（退出码 0）')
  process.exit(0)
}
console.log(`结论：发现 ${failures.length} 个问题（退出码 1）`)
for (const f of failures) console.log(`  - ${f}`)
process.exit(1)
