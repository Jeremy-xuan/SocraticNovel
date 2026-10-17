// accept.mjs — ACCEPT-1：一条命令跑完"冻结 → 装载 → 真实课堂 → 断言 → 归档"
//
// 用法（见 run.sh）：node accept.mjs [--turns N] [--keep-profile] [--skip-session]
//
// 🔴 纪律（违反即失败）：
//   · 只写 `acceptance/**` 与报告；不改 plugins/**、classrooms/**、skills/**、clients/**
//   · **绝不碰用户的真实 DSH profile**：DSH_HOME 必须是**隔离目录**（见 run.sh 的硬判），
//     web／桌面 profile 在运行前后只做只读哈希快照比对，绝不写、绝不装、绝不启动
//   · 装完**逐文件核对哈希**，不一致就失败退出
//   · 绝不把任何 `@deepseek-ai/*` 包装进 profile 或插件 node_modules
//   · 任何一条断言失败 → 进程退出码非零，并把失败项的原始证据落盘
//
// ═══════════════════════════════════════════════════════════════════════════════
// 🔴 ACCEPT-4 的三处收紧（都是**收紧**，不是放宽）
// ═══════════════════════════════════════════════════════════════════════════════
//   ① **零接触守卫的归因：时间窗 → 写足迹**（`lib/footprint.mjs`）。
//      旧判据"某键在阶段 03/04 内被采样到变化才算 App 写的"有个**黑窗口**：
//      阶段 04 全程同步（幂等重放探针 spawnSync ＋ 断言 ＋ 落盘）→ 事件循环被占死 →
//      采样器一拍都跑不了 → 这一窗口里的变化被**默认归因给我们**（ACCEPT-3 那条假红就是这么来的：
//      `profiles/web/desktop-storage.json` 只是被常驻 App 自己重写了一次）。
//      新判据：**先列"允许写的位置"，再判"被改的东西在不在里面"** —— 不依赖采样器拍得到，
//      所以**能抓住黑窗口里发生的写入**；同时保留"命令里出现受保护 profile 名"的检查
//      （并把它从"扫 3 个日志文件"扩到"扫本流水线执行过的**全部**命令"）。
//   ② **技能包自检两份都跑**：源包**判内容**（①–④ 必须全绿；⑤ 在仓库原地跑预期内红）
//      ＋ 已装副本（`$DSH_HOME/skills/…`）**判发现链路**（应当 exit 0 全绿；**没装就明确报
//      "未安装、该检查跳过"**，不静默）。两份都**只读**（跑前跑后逐文件 sha256 一致）。
//   ③ **显式降级留痕另写固定位置**：除本次运行目录里那一份证据外，另追加一行到
//      `acceptance/降级留痕.md`（时间／模式／理由／删了哪几行／删前后哈希／run 目录），
//      让"过去一周我们悄悄关过几次动画"能一眼检索到。

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  ACCEPT_PROFILE,
  DSH_BIN,
  DSH_HOME,
  DSH_HOME_ISOLATION_ROOT,
  FORBIDDEN_PROFILES,
  NODE,
  abs,
  checkDshHomeIsolation,
  diffSnapshot,
  ensureDir,
  hashTree,
  humanBytes,
  makeLogger,
  renderSums,
  run,
  runAsync,
  runNode,
  sha256Text,
  shallowSnapshot,
  timestamp,
  writeJson,
  writeText,
} from './lib/util.mjs'
import {
  auditWhitelistRules,
  configureFootprint,
  evaluateZeroTouch,
  footprintContext,
  footprintLedger,
  ledgerCopy,
  ledgerMkdtemp,
  ledgerRemove,
  ledgerWriteFile,
  registerSessionLogDir,
  renderWhitelistMarkdown,
  scanUninstrumentedWrites,
  setFootprintStage,
} from './lib/footprint.mjs'
import { appendDegradeLedger, DEGRADE_LEDGER_NAME } from './lib/degrade.mjs'
import { freezeInto, verifyManifest, writeManifest } from './lib/freeze.mjs'
import {
  assertNoHostPackages,
  ensureProfile,
  hardlinkEvidence,
  installFrozenPlugin,
  profileDir,
  saveProfileConfig,
  verifyInstalledHashes,
} from './lib/profile.mjs'
import { analyze, findBySessionId, listAllSessions, parseEvents, decompress } from './lib/sessionlog.mjs'
import { runAll } from './lib/asserts.mjs'
import {
  ANIMATION_ENV_DIR_ENV,
  ANIMATION_GATE_ENV,
  ANIMATION_QUALITY,
  classroomDeclaresAnimation,
  disableClassroomAnimation,
  probeAnimationEnvironment,
  renderAnimationConfigYaml,
} from './lib/animation.mjs'
import {
  compareSkillCopies,
  runInstalledSkillSelfCheck,
  runSkillSelfCheck,
} from './lib/skillcheck.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
// 🔴 本流水线住在**主仓库根的 `acceptance/`** 下 → 仓库根＝本文件的上一层。
//    被测对象全部按仓库根解析（plugins/ classrooms/ skills/），**不写任何绝对路径**。
const REPO_ROOT = resolve(HERE, '..')

// ── 命令行参数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
function flag(name, fallback = null) {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : (argv[i + 1] ?? true)
}
const TURNS = Number.parseInt(flag('turns', '3'), 10)
const KEEP_PROFILE = argv.includes('--keep-profile')
const SKIP_SESSION = argv.includes('--skip-session')
// ── ACCEPT-3 新增：教学动画渲染环境 ────────────────────────────────────────────
// 🔴 教室（classrooms/cs-os）现在声明了 `animation: {enabled: true}`，而引擎的设计是
//    "声明了动画但部署没配渲染环境 → 装载时报错"（有意为之，不静默降级）。
//    → 本流水线必须自己把渲染环境配进它的专用 profile；配不上就**大声失败**。
//    → 唯一允许的降级是**人显式关掉教室的 animation 段**（下面这个开关），且必须给理由。
const DISABLE_CLASSROOM_ANIMATION = argv.includes('--disable-classroom-animation')
const ANIMATION_DISABLE_REASON = flag('animation-disable-reason', '')

// ── ACCEPT-4：负向对照开关（默认关闭；只在"证明守卫真的会红"时打开）────────────────
//   `ACCEPT4_NEGATIVE_CONTROL=outside-write` → 流水线**故意**在"允许写的位置"之外写一个文件。
//   🔴 它只做一件事：证明"写足迹白名单"这条判据是**活的**（不是被放宽成"永远绿"）。
//   🔴 它不是验收路径的一部分：打开它的那次运行**本来就该判红**（退出码非零）。
const NEGATIVE_CONTROL = process.env.ACCEPT4_NEGATIVE_CONTROL ?? null
const NEGATIVE_CONTROL_DIR = join(HERE, 'negative-control')

// ── ACCEPT-2：另一个负向对照开关（A6.5 的宿主告警判据）──────────────────────────
//   `ACCEPT_NEGATIVE_CONTROL=1` → 探针**故意**打一条不在白名单里的宿主告警，
//   用来证明 A6.5「非白名单告警 → 判失败」这条断言真的会红。
//   🔴 它由**会话子进程里的探针**（probe/log-bridge.mjs）消费 —— 也就是说：
//      **不跑会话的路径根本不会执行它**。旧版在 `--skip-session` 下把这个变量当空气，
//      于是"请求了负向对照"与"负向对照通过"在退出码上**长得一模一样**（都是 0）。
//      → 见下面 `negativeControlRequested`：请求了却没跑，本次**不予通过**。
const negativeControlRequested = (process.env.ACCEPT_NEGATIVE_CONTROL ?? '').trim() !== ''

// ── 被测对象（冻结来源）──────────────────────────────────────────────────────
const PLUGIN_SRC = join(REPO_ROOT, 'plugins', 'socratic-engine')
const CLASSROOM_SRC = join(REPO_ROOT, 'classrooms', 'cs-os')
const PROBE_SRC = join(HERE, 'probe')
const PLUGIN_PKG_NAME = 'socratic-engine'
// ── ACCEPT-3 新增：技能包自检（只读，不装、不复制到任何扫描根）──────────────────
const SKILL_SRC = join(REPO_ROOT, 'skills', 'socratic-classroom')
const SKILL_VALIDATE = join(SKILL_SRC, 'validate')

/** 三轮"像真的上课"的话（短、明确，控制在必要的最小轮数）。 */
const PROMPTS = [
  '开始上课吧。先查一下教室状态：我们上到哪一讲、现在是哪个相位？',
  '我们进入追问环节了。请按教室的规矩宣布相位切换（用 classroom_set_phase 切到 probe），然后问我第一个问题。',
  '好，今天就到这吧，下课。',
].slice(0, TURNS)

// ── 运行目录 ──────────────────────────────────────────────────────────────────
const RUNS_DIR = join(HERE, 'runs')
let stamp = timestamp()
let runDir = join(RUNS_DIR, stamp)
let n = 1
while (existsSync(runDir)) {
  n += 1
  runDir = join(RUNS_DIR, `${stamp}-${n}`)
}
// 🔴 ACCEPT-4：**先**配好写足迹上下文，再开始写任何东西（`ensureDir(RUNS_DIR)` 就是一次写）
configureFootprint({
  acceptanceDir: HERE,
  runDir,
  dshHome: DSH_HOME,
  tmpDir: tmpdir(),
  acceptProfile: ACCEPT_PROFILE,
  forbiddenProfiles: FORBIDDEN_PROFILES,
  sessionLogDirs: [],
})
ensureDir(RUNS_DIR)
ensureDir(runDir)
const LOG_FILE = join(runDir, 'accept.log')
const log = makeLogger(LOG_FILE)

const state = {
  runDir,
  startedAt: new Date().toISOString(),
  env: { DSH_HOME, DSH_HOME_ISOLATION_ROOT, DSH_BIN, NODE, ACCEPT_PROFILE, TURNS },
  stages: [],
  fatal: null,
}

/** 会话工作副本所在的临时目录（跑完统一清理；归档已在 run 目录里）。 */
const TEMP_WORK_ROOTS = []

/** 当前阶段 id（零接触采样器用它给"变化"归因）。 */
let ACTIVE_STAGE = '00'

/**
 * 🔴 ACCEPT-3：教学动画的装载决策（阶段①探测 → 阶段②写进 profile → 阶段③写进会话 overlay）。
 *   { enabled:boolean,
 *     mode:'configured'|'explicitly-disabled'|'not-declared'|'none',
 *     env:object|null, probe:object, disable:{reason,at}|null, declared:boolean }
 *
 * 🔴 三种终态，**不许混写**：
 *   · `configured`         —— 教室声明了动画，渲染环境已配上 → 写进 profile 与会话 overlay；
 *   · `explicitly-disabled`—— 教室声明了动画，人显式关掉（留痕）→ 不写配置、删工作副本那段；
 *   · `not-declared`       —— 教室**没有**声明动画 → 引擎不做自检 → 本项**不适用**（不是"通过"）。
 */
let ANIMATION = { enabled: false, mode: 'none', env: null, probe: null, disable: null, declared: false }

/**
 * 🔴 **被测对象指纹**（阶段① 冻结时填）。
 *
 * 为什么必须进报告：人读报告是"最新一次"的唯一入口，而它**天生会过期** ——
 * 源码一改，昨天那份报告里的结论就不再对现盘成立。旧版报告里只有运行时间戳，
 * 读者无法判断"这份绿说的是哪一份引擎/教室"。→ 首行钉住两份 sha256：
 * **冻结的那一份**（本次实际跑的）与**现盘的那一份**（此刻仓库里躺着的），
 * 并给出"是否一致"。不一致 = 这份报告相对现盘**已过期**。
 */
let TESTED = null

/**
 * 目录树的**单一摘要**（口径与冻结清单一致：`sha256  relpath` 逐行排序后整体再取 sha256）。
 * 🔴 为什么不存逐文件 map：报告与指纹要能一眼比对；逐文件表留给 `01-freeze/SHA256SUMS.json`。
 *
 * 🔴 两边都要**跳过 `node_modules`**：冻结时它就被排除了（依赖由 pnpm 在装载时解析，
 *    见 `stage1Freeze` 的 skipDirs），若"现盘那一份"不跳，两边必然对不上 ——
 *    那会变成一条**永远报红的假红**（实测踩到：现盘 77 文件 vs 冻结 77 文件里混着
 *    node_modules 的上万个文件，摘要自然不等）。
 */
const TREE_DIGEST_SKIP_DIRS = ['node_modules']

function treeDigest(dir) {
  const tree = hashTree(dir, { skipDirs: TREE_DIGEST_SKIP_DIRS })
  return { files: tree.files, bytes: tree.bytes, sha256: sha256Text(renderSums(tree.map)) }
}

/** 动画这项检查在本次运行里"适用且成功"吗（`not-declared` 与"显式降级"都不算成功，但都不算失败）。 */
function animationCheckVerdict() {
  if (ANIMATION.mode === 'configured') return 'configured'
  if (ANIMATION.mode === 'explicitly-disabled') return 'explicitly-disabled'
  if (ANIMATION.mode === 'not-declared') return 'not-declared'
  return 'unknown'
}

/**
 * 渲染 `socratic-engine` 的 config 槽里的 animation 部分（三种形态一处生成，两处复用）。
 * 🔴 为什么必须有这个函数：profile 的 patch 与会话的 `--patch` overlay 都要写这一段，
 *    而"教室没声明动画"这一态是**第三态**（既不是已配置、也不是显式降级）——
 *    两处各写一遍 if/else 迟早会漂。
 */
function animationConfigLines(indent = '    ') {
  const verdict = animationCheckVerdict()
  if (verdict === 'configured') return renderAnimationConfigYaml(ANIMATION.env, { indent })
  if (verdict === 'explicitly-disabled') {
    return [
      `${indent}# 🔴 本次运行为**显式降级**：教室的 animation 段已在工作副本里被删掉。`,
      `${indent}#    理由：${ANIMATION.disable?.reason ?? '<未记录>'}`,
      `${indent}#    这里不写 animation: → 引擎不会走动画自检路径。`,
    ]
  }
  return [
    `${indent}# 教室 manifest 没有顶层 \`animation:\` 段 → 引擎不做渲染环境自检，这里不写 animation。`,
    `${indent}# （本项**不适用**，不是"配好了"）`,
  ]
}

/**
 * 本次运行里"教学动画"这一项的一句话状态（人读报告与结论共用，三态不许混写）。
 * @param {object|null} a - ANIMATION 或结论里的 animation 快照
 */
function animationStatusText(a) {
  const v = a ?? {}
  if (v.enabled && v.env) {
    return (
      `已配置（渲染环境来自环境变量 ${ANIMATION_ENV_DIR_ENV}／${ANIMATION_GATE_ENV}）` +
      `python=\`${v.env.python}\`｜manim=\`${v.env.manim}\`｜闸门=\`${v.env.gate}\`｜画质=${v.env.quality}`
    )
  }
  if (v.mode === 'explicitly-disabled') return `**显式降级**理由：${v.disable?.reason ?? v.reason ?? '<未记录>'}`
  if (v.mode === 'not-declared') {
    return '⚠️ **不适用**：教室 manifest 没有顶层 `animation:` 段 → 引擎不做渲染环境自检（不是"通过"）'
  }
  return '⚠️ **未判定**（本项没有结果）'
}

/**
 * 🔴 守卫值算不算"成立"：`true` 成立；`not-applicable…` 前缀＝**显式不适用**
 *   （既不假装通过，也不判失败——与"未安装＝没验，不是通过"同一条口径）。
 *   ⚠️ 别的字符串（如 `skipped-not-installed`）**不算成立**：它们必须继续判红，
 *      直到有人把它显式改写成"不适用"并写明理由。
 */
function guardSatisfied(value) {
  return value === true || (typeof value === 'string' && value.startsWith('not-applicable'))
}

/**
 * 🔴 零接触采样器（"没碰 web/桌面 profile"的**归因证据**）。
 *
 * 为什么需要它：桌面 App 本身在跑，`profiles/web/desktop-storage.json` 会**自己变**
 * （实测：什么都不做、只隔 79 秒连拍两张，mtime 与大小都变了）。
 * 所以"运行前后比对"必须能区分"App 自己变的"与"我们碰的"。
 *
 * 判据（不靠时间窗碰运气）：**阶段 03/04（跑会话与断言）里我们一行都不写 profiles/**，
 * 所以只要某个键**在这两个阶段内被采样到变化**，它就一定是 App 自己写的。
 * 采样序列整份留档，任何一次归因都能被人复核。
 */
const PROFILE_SAMPLER = { timer: null, series: [], intervalMs: 2000, names: [...FORBIDDEN_PROFILES, 'socratic-headless'] }

function sampleProfilesOnce() {
  const row = { t: Date.now(), at: new Date().toISOString(), stage: ACTIVE_STAGE, snap: {} }
  for (const name of PROFILE_SAMPLER.names) row.snap[name] = shallowSnapshot(profileDir(name))
  PROFILE_SAMPLER.series.push(row)
}

function startProfileSampler() {
  sampleProfilesOnce()
  PROFILE_SAMPLER.timer = setInterval(sampleProfilesOnce, PROFILE_SAMPLER.intervalMs)
}

function stopProfileSampler() {
  if (PROFILE_SAMPLER.timer !== null) clearInterval(PROFILE_SAMPLER.timer)
  PROFILE_SAMPLER.timer = null
}

/** 采样序列里"在阶段 03/04 内被观察到变化"的键（＝可归因给常驻 App）。 */
function keysChangedDuringQuietStages() {
  const out = {}
  for (const name of PROFILE_SAMPLER.names) out[name] = new Set()
  const series = PROFILE_SAMPLER.series
  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1]
    const cur = series[i]
    const quiet = (cur.stage === '03' || cur.stage === '04') && (prev.stage === '03' || prev.stage === '04')
    if (!quiet) continue
    for (const name of PROFILE_SAMPLER.names) {
      for (const c of diffSnapshot(prev.snap[name] ?? {}, cur.snap[name] ?? {})) out[name].add(c.key)
    }
  }
  return out
}

function stage(id, name) {
  ACTIVE_STAGE = id
  setFootprintStage(id) // 🔴 ACCEPT-4：写足迹按阶段记账
  log.step(`${id} · ${name}`)
  const entry = { id, name, at: new Date().toISOString() }
  state.stages.push(entry)
  return entry
}

// ═════════════════════════════════════════════════════════════════════════════
// ACCEPT-4 · 负向对照：故意在"允许写的位置"之外写一次
// ═════════════════════════════════════════════════════════════════════════════
/**
 * 🔴 为什么要有它：写足迹白名单这条判据如果被写成了"永远绿"，那它比旧的假红更糟
 *   （假红至少还会喊）。→ 这个开关**故意**在白名单外写一个文件，
 *   用来证明"越界写入 → 守卫判红"这条路是通的。
 * 🔴 它写的路径**故意**选在 `acceptance/negative-control/`（＝acceptance 根目录下），
 *   它不落在任何一条白名单规则里（白名单只有 runs/<本次>/、两个固定文件、专用 profile、两个临时目录）。
 * @returns {object|null} 记录（未开启时返回 null）
 */
function runNegativeControl() {
  if (NEGATIVE_CONTROL === null) return null
  if (NEGATIVE_CONTROL !== 'outside-write') {
    throw new Error(`🔴 不认识的 ACCEPT4_NEGATIVE_CONTROL=${NEGATIVE_CONTROL}（只支持 outside-write）`)
  }
  const file = join(NEGATIVE_CONTROL_DIR, 'OUTSIDE-WHITELIST.txt')
  ledgerWriteFile(
    file,
    `ACCEPT-4 负向对照：这个文件是**故意**写在"允许写的位置之外"的（${new Date().toISOString()}）。\n` +
      '它存在的唯一目的：证明零接触守卫的"写足迹白名单"判据是活的（越界写入必须判红）。\n' +
      '本次运行的结论**本来就应当是失败**（退出码非零）。\n',
    { source: 'accept.mjs runNegativeControl（负向对照，故意越界）' },
  )
  const row = { enabled: true, mode: NEGATIVE_CONTROL, file, at: new Date().toISOString() }
  log.fail(`🔴 ACCEPT-4 负向对照已开启（ACCEPT4_NEGATIVE_CONTROL=${NEGATIVE_CONTROL}）：故意在白名单外写了 ${file} → 本次守卫**应当**判红`)
  return row
}

/** 把负向对照写出去的东西清掉（**也记写足迹**：它同样是白名单外的写，所以守卫仍会红）。 */
function cleanNegativeControl() {
  if (NEGATIVE_CONTROL === null) return null
  if (!existsSync(NEGATIVE_CONTROL_DIR)) return null
  ledgerRemove(NEGATIVE_CONTROL_DIR, {}, { source: 'accept.mjs cleanNegativeControl（负向对照收尾）' })
  return { removed: NEGATIVE_CONTROL_DIR, at: new Date().toISOString() }
}

// ═════════════════════════════════════════════════════════════════════════════
// ACCEPT-4 · 零接触证据（写足迹归因）——完整跑与 --skip-session **共用同一段**
// ═════════════════════════════════════════════════════════════════════════════
/**
 * 采集"零接触"的全部证据并判守卫。
 *
 * 🔴 与 ACCEPT-3 的区别（这是本批的核心）：
 *   · 旧：`attributableToUs = 变化的键 − 3 秒对照窗里变过的键 − 阶段 03/04 里采样到的键`。
 *     后一项依赖采样器**拍得到**，而阶段 04 把事件循环占死 → 黑窗口 → 误判。
 *   · 新：`attributableToUs = 变化的键 ∩ 本流水线的写足迹`。
 *     判据是"**我们写没写过它**"，不是"采样器拍没拍到"；写足迹本身另有白名单硬门。
 *     采样序列仍然采集、仍然落盘，但降为**旁证**（"常驻 App 自己会变"的独立观测）。
 *
 * @param {{outDir:string, beforeFile:string, label:string}} opts
 */
function computeZeroTouchEvidence(opts) {
  const { outDir, beforeFile, label } = opts
  stopProfileSampler()
  writeJson(join(outDir, 'profile-sampler.json'), {
    intervalMs: PROFILE_SAMPLER.intervalMs,
    ticks: PROFILE_SAMPLER.series.length,
    stages: PROFILE_SAMPLER.series.map((r) => ({ t: r.t, stage: r.stage })),
    series: PROFILE_SAMPLER.series,
  })
  const samplerObserved = keysChangedDuringQuietStages()

  const before = JSON.parse(readFileSync(beforeFile, 'utf8'))
  const after = {}
  for (const name of [...FORBIDDEN_PROFILES, 'socratic-headless']) after[name] = shallowSnapshot(profileDir(name))
  writeJson(join(outDir, 'profiles-after.json'), after)

  const changedByProfile = {}
  for (const name of [...FORBIDDEN_PROFILES, 'socratic-headless']) {
    changedByProfile[name] = diffSnapshot(before[name] ?? {}, after[name] ?? {}).map((c) => c.key)
  }

  const ctx = footprintContext()
  const writeWhitelistAudit = auditWhitelistRules()
  const scan = scanUninstrumentedWrites({ acceptanceDir: HERE })
  const guard = evaluateZeroTouch({
    ctx,
    ledger: footprintLedger,
    changedByProfile,
    samplerObserved: Object.fromEntries(Object.entries(samplerObserved).map(([k, v]) => [k, [...v]])),
    scan,
    writeWhitelistAudit,
  })

  // 落盘：白名单（人读）＋ 写足迹全量（机器读）＋ 守卫结论
  writeText(join(outDir, 'write-footprint-whitelist.md'), renderWhitelistMarkdown(ctx))
  writeJson(join(outDir, 'write-footprint-ledger.json'), {
    at: new Date().toISOString(),
    label,
    rules: auditWhitelistRules(),
    entries: footprintLedger.entries,
    commands: footprintLedger.commands,
    stats: footprintLedger.stats(),
  })
  writeJson(join(outDir, 'zero-touch.json'), {
    at: new Date().toISOString(),
    label,
    judge: '写足迹（不是时间窗）',
    guardOk: guard.ok,
    reasons: guard.reasons,
    attribution: guard.attribution,
    changedByProfile,
    samplerObserved: guard.samplerObserved,
    ledgerStats: guard.ledgerStats,
    outOfWhitelist: guard.outOfWhitelist,
    completenessScan: guard.scan,
    note: guard.note,
    profilesBeforeFile: beforeFile,
    profilesAfterFile: join(outDir, 'profiles-after.json'),
  })

  log[guard.ok ? 'ok' : 'fail'](
    `零接触（写足迹判据，${label}）：${guard.ok ? '通过' : `🔴 失败 → ${guard.reasons.join('；')}`}`,
  )
  log.info(
    `写足迹：${guard.ledgerStats.writes} 次写盘（白名单外 ${guard.ledgerStats.violations}）｜命令 ${guard.ledgerStats.commands} 条｜` +
      `按规则 ${Object.entries(guard.ledgerStats.byRule).map(([k, v]) => `${k}×${v}`).join('、')}｜` +
      `完整性扫描 ${guard.scan.scannedFiles} 个源文件 / ${guard.scan.callSites} 处写调用，违规 ${guard.scan.violations.length}`,
  )
  for (const name of FORBIDDEN_PROFILES) {
    const a = guard.attribution[name]
    log[a.attributedToUs.length === 0 ? 'ok' : 'fail'](
      `零接触 ${name}（写足迹归因）：归因本流水线 ${a.attributedToUs.length} 个` +
        `${a.attributedToUs.length ? ` → ${JSON.stringify(a.attributedToUs)}` : ''}；` +
        `顶层条目变化 ${a.changedKeys.length} 个` +
        `${a.notOurs.length ? `，其中 ${JSON.stringify(a.notOurs)} **不在本流水线的写足迹里**（→ 不由我们造成）` : ''}` +
        `；采样器旁证：${JSON.stringify(guard.samplerObserved[name] ?? [])}`,
    )
  }
  const headless = guard.attribution['socratic-headless']
  log.info(
    `旁证 socratic-headless（也不是本次目标）：变化 ${headless.changedKeys.length} 个，其中归因本流水线 ${headless.attributedToUs.length} 个`,
  )
  return { guard, changedByProfile, samplerObserved }
}

// ═════════════════════════════════════════════════════════════════════════════
// 阶段 0 · 预检 + 零接触快照
// ═════════════════════════════════════════════════════════════════════════════
async function stage0Preflight() {
  const entry = stage('00', '预检与零接触快照')
  const outDir = ensureDir(join(runDir, '00-preflight'))
  const checks = []
  const add = (name, ok, detail) => {
    checks.push({ name, ok, detail })
    log[ok ? 'ok' : 'fail'](`${name}${detail ? ` — ${detail}` : ''}`)
  }

  add('node 存在', NODE === 'node' || existsSync(NODE), NODE)
  add(
    'DSH_BIN 存在',
    DSH_BIN !== null && existsSync(DSH_BIN),
    DSH_BIN ?? '未找到 dsh CLI 入口 → 用 DSH_BIN=<…/@deepseek-ai/dsh/lib/bin.js> 指过来',
  )
  // 🔴 隔离硬判：DSH_HOME 必须落在本次运行的隔离根之下（**不许**跑在用户真实 harness 上）。
  //    这是本流水线唯一允许写 `$DSH_HOME` 的前提，所以放在预检的第一组里、与"文件存在"同级。
  const isolation = checkDshHomeIsolation()
  add(
    `DSH_HOME 已隔离（必须落在隔离根 ${DSH_HOME_ISOLATION_ROOT} 之下）`,
    isolation.ok,
    isolation.ok ? DSH_HOME : `${isolation.reason}`,
  )
  add('DSH_HOME 存在', existsSync(DSH_HOME), DSH_HOME)
  add('zstd 可用', run('which', ['zstd']).code === 0, run('zstd', ['--version']).stdout.split('\n')[0])
  add('pnpm 可用', run('which', ['pnpm']).code === 0, run('pnpm', ['--version']).stdout.trim())
  add('被测插件目录存在', existsSync(PLUGIN_SRC), PLUGIN_SRC)
  add('被测教室目录存在', existsSync(CLASSROOM_SRC), CLASSROOM_SRC)
  add('专用 profile 名不是受保护 profile', !FORBIDDEN_PROFILES.includes(ACCEPT_PROFILE), ACCEPT_PROFILE)
  add('技能包自检脚本存在', existsSync(SKILL_VALIDATE), SKILL_VALIDATE)

  // ── ACCEPT-4：写足迹白名单自身必须先成立（空白名单＝什么都允许 → 直接失败）─────────
  const whitelistAudit = auditWhitelistRules()
  writeText(join(outDir, 'write-footprint-whitelist.md'), renderWhitelistMarkdown(footprintContext()))
  add(
    '写足迹白名单成立（每条都写明理由）',
    whitelistAudit.ok,
    `${whitelistAudit.count} 条规则${whitelistAudit.ok ? '' : ` → ${whitelistAudit.problems.join('；')}`}`,
  )
  const scanAtStart = scanUninstrumentedWrites({ acceptanceDir: HERE })
  add(
    '写足迹完整性扫描（没有绕开 ledger 的写调用）',
    scanAtStart.ok,
    `扫 ${scanAtStart.scannedFiles} 个源文件 / ${scanAtStart.callSites} 处写调用，违规 ${scanAtStart.violations.length}` +
      `${scanAtStart.violations.length ? ` → ${scanAtStart.violations.map((v) => `${v.file}:${v.line} ${v.fn}`).join('、')}` : ''}`,
  )

  // ── ACCEPT-3：教学动画渲染环境（探测，不硬编码）──────────────────────────────
  // 🔴 教室声明了 animation → 部署必须配好渲染环境，否则引擎**装载时报错**；
  //    🔴 教室**没声明** → 引擎根本不走那条自检路径 → 本流水线不要求、也不配置渲染环境。
  //    这里探测一次并把结果落盘；真正的配置在阶段②写进 profile、阶段③写进会话 overlay。
  const animProbe = probeAnimationEnvironment({ fromDir: HERE })
  const animDeclared = classroomDeclaresAnimation(CLASSROOM_SRC)
  writeJson(join(outDir, 'animation-env-probe.json'), { declared: animDeclared, probe: animProbe })
  let animation = { enabled: false, mode: 'none', env: null, probe: animProbe, disable: null, declared: animDeclared.declared }
  if (!animDeclared.exists) {
    throw new Error(
      `🔴 教室 manifest 不存在：${animDeclared.file}（无法判断它有没有声明 animation 段）`,
    )
  }
  if (!animDeclared.declared) {
    // 🔴 不是"跳过"，是**这条检查本来就不适用**：教室没声明动画，引擎不会做渲染环境自检。
    //    显式记下来，避免读者把它读成"动画验过了"。
    animation = { enabled: false, mode: 'not-declared', env: null, probe: animProbe, disable: null, declared: false }
    log.info(
      `教学动画：教室 manifest（${animDeclared.file}）**没有**顶层 \`animation:\` 段 → 引擎不会做渲染环境自检，` +
        `本流水线不配置动画（这不是"验过了"，是"不适用"）`,
    )
  } else if (DISABLE_CLASSROOM_ANIMATION) {
    if (ANIMATION_DISABLE_REASON.trim() === '') {
      throw new Error(
        '🔴 --disable-classroom-animation 必须同时给 --animation-disable-reason <理由>：' +
          '关掉教室动画是**显式降级**（不是静默跳过），理由要原样进结论与报告。',
      )
    }
    animation = { enabled: false, mode: 'explicitly-disabled', env: null, probe: animProbe, disable: { reason: ANIMATION_DISABLE_REASON.trim(), at: new Date().toISOString() }, declared: true }
    log.fail(
      `🔴 教学动画被**显式关掉**（--disable-classroom-animation）：${ANIMATION_DISABLE_REASON.trim()}` +
        ` → 阶段③会把**工作副本**教室的 \`animation:\` 段整段删掉（教室源码不动），并把删除前后 sha256 落盘留痕`,
    )
  } else if (animProbe.ok) {
    animation = { enabled: true, mode: 'configured', env: animProbe.env, probe: animProbe, disable: null, declared: true }
    log.ok(
      `教学动画渲染环境探测通过：python=${animProbe.env.python}｜manim=${animProbe.env.manim}｜` +
        `闸门=${animProbe.env.gate}｜画质=${animProbe.env.quality}`,
    )
  } else {
    // 🔴 配不上 → **不静默跳过、也不自动降级**：把"怎么配"打出来，然后大声失败。
    const guide = animProbe.howToInstall.join('\n')
    writeText(join(outDir, 'animation-env-MISSING.txt'), `${animProbe.problems.join('\n')}\n\n${guide}\n`)
    throw new Error(
      `🔴 教室（${animDeclared.file}）声明了 \`animation:\` 段，但渲染环境没配上（引擎会在装载时报错）：\n- ${animProbe.problems.join('\n- ')}\n\n${guide}`,
    )
  }
  entry.animation = animation
  ANIMATION = animation
  writeJson(join(outDir, 'animation-decision.json'), animation)

  // 🔴 零接触证据的"前"快照：web / 桌面 profile 的顶层（不进 node_modules：web 有 489 MB）
  const before = {}
  for (const name of FORBIDDEN_PROFILES) {
    before[name] = shallowSnapshot(profileDir(name))
  }
  before['socratic-headless'] = shallowSnapshot(profileDir('socratic-headless'))
  writeJson(join(outDir, 'profiles-before.json'), before)

  // 🔴 零接触的**阴性对照**（关键一步）：
  //    桌面 App 本身在跑，它会持续写 `profiles/web/desktop-storage.json` 这类文件。
  //    如果只做"运行前后比对"，那点变化会被误读成"我们碰了 web profile"。
  //    → 在**我们什么都还没做**的时候，隔 3 秒连拍两张，把"自己就会变的键"先量出来；
  //      运行后只有"控制实验里没变过"的键才算到我们头上。
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const control = {}
  const volatile = {}
  for (const name of [...FORBIDDEN_PROFILES, 'socratic-headless']) {
    const second = shallowSnapshot(profileDir(name))
    control[name] = second
    volatile[name] = diffSnapshot(before[name] ?? {}, second).map((c) => c.key)
  }
  writeJson(join(outDir, 'profiles-volatile-control.json'), { windowSeconds: 3, volatile, snapshots: control })
  log.info(`零接触阴性对照（3 秒空窗，我们什么都还没做）：${Object.entries(volatile).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('、')}`)
  entry.volatileKeys = volatile

  // 全程采样（每 2 秒一拍）——🔴 ACCEPT-4 起它只是**旁证**（"常驻 App 自己会变"的独立观测），
  //    归因判据已换成写足迹（`lib/footprint.mjs`）：采样器拍不到的"黑窗口"不再导致误判。
  startProfileSampler()

  // ── ACCEPT-4：负向对照（只在显式开启时跑；它会让本次守卫**故意**判红）────────────
  const negativeControl = runNegativeControl()
  if (negativeControl !== null) {
    entry.negativeControl = negativeControl
    writeJson(join(outDir, 'negative-control.json'), negativeControl)
  }

  // 本流水线自己的代码指纹（断言逻辑跑的是**实时**代码，不是冻结副本 → 至少把"哪一份"钉住）
  const pipelineHashes = {}
  for (const rel of [
    'accept.mjs',
    'run.sh',
    'lib/util.mjs',
    'lib/freeze.mjs',
    'lib/profile.mjs',
    'lib/sessionlog.mjs',
    'lib/asserts.mjs',
    'lib/whitelist.mjs',
    // 🔴 ACCEPT-4 新增/改动的三个模块（写足迹守卫的全部实现都在这三个里）
    'lib/footprint.mjs',
    'lib/degrade.mjs',
    'lib/skillcheck.mjs',
  ]) {
    const file = join(HERE, rel)
    if (!existsSync(file)) continue
    const tree = hashTree(dirname(file))
    pipelineHashes[rel] = tree.map[rel.split('/').pop()]?.sha256 ?? null
  }
  writeJson(join(outDir, 'pipeline-hashes.json'), pipelineHashes)
  log.info(`流水线代码指纹：${Object.keys(pipelineHashes).length} 个文件已记录`)

  entry.checks = checks
  entry.beforeSnapshot = Object.fromEntries(Object.entries(before).map(([k, v]) => [k, Object.keys(v).length]))
  writeJson(join(outDir, 'stage.json'), entry)
  if (checks.some((c) => !c.ok)) throw new Error(`预检失败：${checks.filter((c) => !c.ok).map((c) => c.name).join('、')}`)
}

// ═════════════════════════════════════════════════════════════════════════════
// 阶段 1 · 冻结
// ═════════════════════════════════════════════════════════════════════════════
function stage1Freeze() {
  const entry = stage('01', '冻结（插件源码 + 教室 + 探针 → 独立冻结目录，并生成/复核 sha256 清单）')
  const outDir = ensureDir(join(runDir, '01-freeze'))
  const frozenDir = join(runDir, 'frozen')

  const copied = freezeInto(
    [
      { src: PLUGIN_SRC, rel: join('plugins', 'socratic-engine') },
      { src: CLASSROOM_SRC, rel: join('classrooms', 'cs-os') },
      { src: PROBE_SRC, rel: 'probe' },
    ],
    frozenDir,
    // 🔴 node_modules 不算"插件源码"：它是 pnpm/npm 装出来的依赖，
    //    体积可达上百 MB 且可能正被别的进程改写。冻结源码、依赖由 pnpm 在装载时解析，
    //    装载阶段再单独记录解析出来的依赖版本与哈希（见 02-install/deps.json）。
    { skipDirs: ['node_modules'] },
  )
  for (const c of copied) {
    log.info(`冻结 ${c.rel} ← ${c.src}（${c.files} 文件，${humanBytes(c.bytes)}）`)
  }

  const manifest = writeManifest(frozenDir, outDir)
  log.info(`清单：${manifest.files} 文件 / ${humanBytes(manifest.bytes)} → ${manifest.sumsFile}`)

  // 🔴 冻结后再校验一次清单：证明**冻结动作本身**没出错
  const verify = verifyManifest(frozenDir, manifest.jsonFile)
  log[verify.ok ? 'ok' : 'fail'](
    `冻结清单复核：${verify.expectedFiles} 条期望 / ${verify.actualFiles} 个实际文件；` +
      `不一致 ${verify.mismatched.length}、缺失 ${verify.missing.length}、多余 ${verify.extra.length}`,
  )

  // 🔴 **被测对象指纹**：报告首行要能回答"这份报告说的是哪一份引擎/教室"。
  //    两份都记：**冻结的那一份**（本次实际跑的）＋ **现盘的那一份**（此刻仓库里躺着的）。
  //    两者不一致 → 报告相对现盘**已经过期**，必须响亮地说出来（否则旧报告会冒充现盘）。
  TESTED = {
    at: new Date().toISOString(),
    frozenDir,
    frozen: {
      engine: { rel: 'plugins/socratic-engine', ...treeDigest(join(frozenDir, 'plugins', 'socratic-engine')) },
      classroom: { rel: 'classrooms/cs-os', ...treeDigest(join(frozenDir, 'classrooms', 'cs-os')) },
      probe: { rel: 'probe', ...treeDigest(join(frozenDir, 'probe')) },
    },
    disk: {
      engine: { rel: 'plugins/socratic-engine', ...treeDigest(PLUGIN_SRC) },
      classroom: { rel: 'classrooms/cs-os', ...treeDigest(CLASSROOM_SRC) },
    },
    manifest: { files: manifest.files, bytes: manifest.bytes, sumsFile: manifest.sumsFile, jsonFile: manifest.jsonFile },
  }
  TESTED.matchesDisk =
    TESTED.frozen.engine.sha256 === TESTED.disk.engine.sha256 &&
    TESTED.frozen.classroom.sha256 === TESTED.disk.classroom.sha256
  entry.tested = TESTED
  writeJson(join(outDir, 'tested-fingerprint.json'), TESTED)
  log.info(
    `被测对象指纹：引擎 ${TESTED.frozen.engine.sha256.slice(0, 16)}（${TESTED.frozen.engine.files} 文件）｜` +
      `教室 ${TESTED.frozen.classroom.sha256.slice(0, 16)}（${TESTED.frozen.classroom.files} 文件）｜` +
      `现盘${TESTED.matchesDisk ? '一致' : '🔴 **不一致**（冻结后源码又被改过）'}`,
  )

  entry.frozenDir = frozenDir
  entry.copied = copied
  entry.manifest = { files: manifest.files, bytes: manifest.bytes, sumsFile: manifest.sumsFile, jsonFile: manifest.jsonFile }
  entry.verify = verify
  writeJson(join(outDir, 'stage.json'), entry)
  if (!verify.ok) throw new Error('冻结清单复核失败（冻结动作本身出错）→ 后续结论不可信')
  return { frozenDir, verify }
}

// ═════════════════════════════════════════════════════════════════════════════
// 阶段 2 · 装载到专用测试 profile + 逐文件哈希复核
// ═════════════════════════════════════════════════════════════════════════════
function stage2Install(frozenDir) {
  const entry = stage('02', `装载到专用测试 profile（${ACCEPT_PROFILE}）并逐文件核对哈希`)
  const outDir = ensureDir(join(runDir, '02-install'))
  const frozenPluginDir = join(frozenDir, 'plugins', 'socratic-engine')

  const profile = ensureProfile({
    name: ACCEPT_PROFILE,
    template: 'headless',
    fresh: !KEEP_PROFILE,
    logFile: join(outDir, 'profile-init.log'),
    // 🔴 `--keep-profile` 复用前必须查：profile 里那条 `file:` 依赖还指得着**本次**的冻结目录吗？
    //    指向别的目录（上一轮 run）或指向已删目录 → `ensureProfile` 直接拒绝复用。
    expectPluginDir: frozenPluginDir,
  })
  log.info(`profile=${profile.name} dir=${profile.dir}`)
  log.info(`bundles=${JSON.stringify(profile.bundles)} patchReload=${profile.patchReload}`)
  if (profile.reusedFileDeps !== null) {
    const rows = profile.reusedFileDeps.entries
    log[profile.reusedFileDeps.ok ? 'ok' : 'fail'](
      `复用前查 file: 依赖（${rows.length} 条）：${rows.map((r) => `${r.name} → ${r.target}（${r.exists ? '存在' : '🔴 不存在'}${r.isCurrent ? '、＝本次冻结目录' : '、🔴 ≠ 本次冻结目录'}）`).join('；') || '<无 file: 依赖>'}`,
    )
  }
  entry.profile = profile

  const install = installFrozenPlugin(ACCEPT_PROFILE, frozenPluginDir, join(outDir, 'plugin-add.log'))
  log[install.ok ? 'ok' : 'fail'](`dsh plugin add file:<冻结目录>（exit ${install.code}）`)
  entry.install = install
  if (!install.ok) throw new Error(`装载失败（exit ${install.code}）：见 ${install.logFile}`)

  // 🔴 逐文件核对哈希：profile 里的安装副本 vs 冻结目录
  const hashes = verifyInstalledHashes(ACCEPT_PROFILE, frozenPluginDir, PLUGIN_PKG_NAME)
  entry.hashCheck = hashes
  writeJson(join(outDir, 'hash-check.json'), hashes)
  log[hashes.ok ? 'ok' : 'fail'](
    `逐文件哈希复核：核对 ${hashes.checked} 个文件，不一致 ${hashes.mismatched.length}；` +
      `冻结目录里未安装 ${hashes.frozenOnly.length} 个（pnpm 按 package.json 的 files 打包）`,
  )
  if (!hashes.ok) {
    writeText(join(outDir, 'hash-check-FAILED.txt'), JSON.stringify(hashes, null, 2))
    throw new Error('🔴 装载后逐文件哈希复核失败 → 失败退出（不许拿不一致的副本跑验收）')
  }

  // 🔴 铁律③：不许把宿主包装进 profile / 插件 node_modules
  const hostCheck = assertNoHostPackages(ACCEPT_PROFILE, PLUGIN_PKG_NAME)
  entry.hostPackageCheck = hostCheck
  log[hostCheck.ok ? 'ok' : 'fail'](hostCheck.note)
  if (!hostCheck.ok) throw new Error(`🔴 铁律③被违反：${JSON.stringify(hostCheck.offenders)}`)

  // 硬链接镜像证据（本流水线**不依赖**它，但要把事实留档）
  const hardlink = hardlinkEvidence(ACCEPT_PROFILE, frozenPluginDir, PLUGIN_PKG_NAME)
  entry.hardlink = {
    available: hardlink.available,
    sameInodeCount: hardlink.sameInodeCount,
    sameContentCount: hardlink.sameContentCount,
    total: hardlink.rows?.length ?? 0,
    rows: hardlink.rows ?? [],
  }
  log.info(
    `硬链接证据：${hardlink.sameInodeCount}/${hardlink.rows?.length ?? 0} 个文件与冻结目录同 inode、` +
      `${hardlink.sameContentCount}/${hardlink.rows?.length ?? 0} 个内容相同（本流水线以哈希为准，不依赖硬链接）`,
  )

  const saved = saveProfileConfig(ACCEPT_PROFILE, outDir)
  entry.savedConfig = saved

  // ── ACCEPT-3 ①：给专用 profile 写入教学动画的渲染环境配置 ────────────────────
  // 🔴 为什么必须在这里写：教室声明了 `animation:` → 引擎装载时会 `checkAnimationRuntime`，
  //    不通过就抛 ManifestError。本 profile 每次从 shipped 模板重建，模板里没有动画配置。
  //    🔴 教室**没声明**时这一槽什么都不写（引擎不走自检路径）—— 见 animationConfigLines。
  // 🔴 形态照 shipped 模板 profile 的 `socratic-engine` 段（只读参考，不改它）；
  //    路径来自阶段①的**探测结果**（环境变量给出），不硬编码。
  // 🔴 为什么阶段③还要再写一次：profile 的 patch 与 `--patch` overlay 都是**整个 config
  //    对象替换**（`applyEntryPatches`: `target[key] = value`，不深合并）→ 会话期那条
  //    `config: {classroomDir: …}` 会把这里写的 animation 整块抹掉。两处都写＝双保险，
  //    且这里这一份让人能直接看到"这个 profile 配了什么"。
  const profilePatchFile = join(profileDir(ACCEPT_PROFILE), 'cordis.patch.yml')
  const patchLines = [
    '# ACCEPT-3：教学动画的渲染环境（由 acceptance/lib/animation.mjs 从**环境变量**取，不硬编码）',
    '# 🔴 教室若声明了 animation: → 引擎在装载期会 checkAnimationRuntime，不通过就报错',
    '#    （有意为之，不静默降级）；教室没声明 → 引擎不走这条路径，本段留注释即可。',
    `# 生成时间：${new Date().toISOString()}`,
    '- id: socratic-engine',
    '  name: socratic-engine',
    '  config:',
    ...animationConfigLines('    '),
    '',
  ]
  writeText(profilePatchFile, patchLines.join('\n'))
  const profilePatchSha = hashTree(profileDir(ACCEPT_PROFILE)).map['cordis.patch.yml']?.sha256 ?? null
  entry.animationProfilePatch = {
    file: profilePatchFile,
    sha256: profilePatchSha,
    enabled: ANIMATION.enabled,
    mode: ANIMATION.mode,
    declared: ANIMATION.declared,
    env: ANIMATION.env,
    reason: ANIMATION.disable?.reason ?? null,
  }
  log[ANIMATION.mode === 'explicitly-disabled' ? 'fail' : 'ok'](
    ANIMATION.enabled
      ? `已把渲染环境写进 profile 的 cordis.patch.yml（sha256=${profilePatchSha?.slice(0, 12) ?? '<缺>'}）：${profilePatchFile}`
      : ANIMATION.mode === 'explicitly-disabled'
        ? `🔴 教学动画为显式降级：profile 的 cordis.patch.yml **不写** animation 段（理由：${ANIMATION.disable?.reason ?? '<未记录>'}）`
        : `教室未声明 animation → profile 的 cordis.patch.yml 不写 animation 段（本项不适用）：${profilePatchFile}`,
  )

  // ── ACCEPT-3 ② / ACCEPT-4 ②：技能包自检**两份都跑** ────────────────────────────
  // 🔴 只读：不装、不复制到任何扫描根、不改技能包一个字节（跑前/跑后各记一次哈希为证）。
  // 🔴 为什么必须两份（ACCEPT-4 收紧）：
  //    · **源包**（仓库 skills/…）判**内容**：①–④ 必须全绿；
  //      ⑤ 发现链路在仓库原地跑**必然红**（包不在任何扫描根下 —— 设计如此）。
  //    · **已装副本**（$DSH_HOME/skills/…）判**发现链路**：它就在扫描根下，应当 exit 0 全绿。
  //      只跑源包＝"宿主能不能发现这个技能"这一半**永远没人验**。
  //    · 没装 → 明确报"未安装、该检查跳过"（verdict=not-installed），**不静默**、也不替用户装。
  const skillOutDir = ensureDir(join(outDir, 'skill-selfcheck'))
  const skillTreeBefore = hashTree(SKILL_SRC)
  const skillCheck = runSkillSelfCheck({
    skillDir: SKILL_SRC,
    classroomDir: join(frozenDir, 'classrooms', 'cs-os'),
    outDir: skillOutDir,
  })
  const skillTreeAfter = hashTree(SKILL_SRC)
  const skillUnchanged =
    JSON.stringify(Object.keys(skillTreeBefore.map).sort()) === JSON.stringify(Object.keys(skillTreeAfter.map).sort()) &&
    Object.keys(skillTreeBefore.map).every((rel) => skillTreeBefore.map[rel].sha256 === skillTreeAfter.map[rel].sha256)

  // 已装副本（只读）：判发现链路
  const installedCheck = runInstalledSkillSelfCheck({ dshHome: DSH_HOME, outDir: skillOutDir })
  const copies = compareSkillCopies(SKILL_SRC, installedCheck.installedDir)

  writeJson(join(skillOutDir, 'skill-tree-unchanged.json'), {
    skillDir: SKILL_SRC,
    files: skillTreeBefore.files,
    bytes: skillTreeBefore.bytes,
    unchangedAfterSelfCheck: skillUnchanged,
    validateSha256: skillTreeBefore.map['validate']?.sha256 ?? null,
    installedCopy: {
      dir: installedCheck.installedDir,
      applicable: installedCheck.applicable,
      unchangedAfterSelfCheck: installedCheck.unchangedAfterSelfCheck ?? null,
      validateSha256: installedCheck.validateSha256 ?? null,
    },
    copies,
  })
  entry.skillSelfCheck = { ...skillCheck, skillUnchangedAfterSelfCheck: skillUnchanged }
  entry.skillInstalledCheck = installedCheck
  entry.skillCopies = copies
  log[skillCheck.ok ? 'ok' : 'fail'](
    `技能包自检【源包·判内容】：exit ${skillCheck.exitCode}，判定 ${skillCheck.verdict} — ${skillCheck.detail}`,
  )
  log[installedCheck.applicable === false || installedCheck.ok ? 'ok' : 'fail'](
    installedCheck.applicable === false
      ? `技能包自检【已装副本·判发现链路】：⚠️ ${installedCheck.detail}`
      : `技能包自检【已装副本·判发现链路】：exit ${installedCheck.exitCode}，判定 ${installedCheck.verdict} — ${installedCheck.detail}`,
  )
  log.info(
    `源包 ↔ 已装副本逐文件 sha256 比对：${copies.compared ? (copies.identical ? '逐字节相同' : `不同（只在源包 ${copies.onlyInSource.length}／只在已装 ${copies.onlyInInstalled.length}／内容不同 ${copies.differing.length}）`) : copies.note}`,
  )
  log[skillUnchanged ? 'ok' : 'fail'](
    `技能包自检是只读的：跑前跑后逐文件 sha256 一致（${skillTreeBefore.files} 文件）`,
  )
  if (!skillUnchanged) throw new Error('🔴 技能包自检改动了技能包内容 → 与"只读"纪律冲突，失败退出')
  if (!skillCheck.ok) throw new Error(`🔴 技能包自检（源包·内容）不通过（${skillCheck.verdict}）：${skillCheck.detail}`)
  if (installedCheck.applicable && !installedCheck.ok) {
    throw new Error(`🔴 技能包自检（已装副本·发现链路）不通过（${installedCheck.verdict}）：${installedCheck.detail}`)
  }

  // 依赖侧证据：冻结目录里不含 node_modules（依赖由 pnpm 在装载时解析），
  // 故这里把**解析出来的依赖**也钉住版本与哈希，让"跑的是哪一份"完整可查。
  //
  // 🔴 清单**从安装副本自己的 package.json 派生**，不写死。为什么必须这样：
  //    写死（旧版只钉 `yaml`）时，引擎新加一个运行时依赖（实测：`mermaid`、`jsdom`）
  //    会在 deps.json 里**完全不出现** —— 于是"跑的是哪一份"这件事在依赖这一维上
  //    出现一个静默的盲区：引擎加载 mermaid 失败，证据里却看不出它本该在。
  //    → 派生 + **逐个判在不在**：少一个就判红（缺运行时依赖＝引擎根本起不来）。
  const deps = {}
  const installedPluginDir = join(profileDir(ACCEPT_PROFILE), 'node_modules', PLUGIN_PKG_NAME)
  const profileNodeModules = join(profileDir(ACCEPT_PROFILE), 'node_modules')
  if (!existsSync(join(installedPluginDir, 'package.json'))) {
    throw new Error(`🔴 安装副本缺 package.json（无法派生依赖清单）：${installedPluginDir}`)
  }
  const installedPkg = JSON.parse(readFileSync(join(installedPluginDir, 'package.json'), 'utf8'))
  const declaredDeps = Object.keys(installedPkg.dependencies ?? {}).sort()
  const missingDeps = []
  for (const dep of declaredDeps) {
    const declared = installedPkg.dependencies[dep]
    const depDir = join(profileNodeModules, dep)
    if (!existsSync(join(depDir, 'package.json'))) {
      deps[dep] = { present: false, declared }
      missingDeps.push(dep)
      continue
    }
    const pkg = JSON.parse(readFileSync(join(depDir, 'package.json'), 'utf8'))
    const tree = hashTree(depDir)
    // 🔴 只存**一个树摘要**，不存逐文件 map：mermaid/jsdom 各有上千个文件，
    //    存全表会让 deps.json 膨胀到几十 MB（那是把"证据"变成"负担"）。
    //    摘要的口径与冻结清单一致（`sha256  relpath` 逐行排序后取 sha256）→ 仍可逐字节复核。
    deps[dep] = {
      present: true,
      declared,
      version: pkg.version,
      files: tree.files,
      bytes: tree.bytes,
      sha256: sha256Text(renderSums(tree.map)),
    }
  }
  // 反向：profile 里装着、但安装副本没声明的（pnpm 的传递依赖或残留）——只计数，不展开
  const presentTopLevel = existsSync(profileNodeModules) ? readdirSync(profileNodeModules) : []
  const undeclared = presentTopLevel.filter((n) => !n.startsWith('.') && !declaredDeps.includes(n)).sort()
  const depsMeta = {
    source: `安装副本 ${PLUGIN_PKG_NAME}/package.json 的 dependencies（派生，不写死）`,
    declaredCount: declaredDeps.length,
    declared: declaredDeps,
    resolvedCount: declaredDeps.filter((d) => deps[d].present).length,
    missing: missingDeps,
    undeclaredTopLevelCount: undeclared.length,
    undeclaredTopLevel: undeclared.slice(0, 40),
  }
  entry.deps = { ...deps, _meta: depsMeta }
  writeJson(join(outDir, 'deps.json'), entry.deps)
  log.info(
    `运行时依赖（从安装副本 package.json 派生）：${declaredDeps.map((d) => `${d}@${deps[d].version ?? '<缺>'}`).join('、') || '<无声明>'}`,
  )
  log[missingDeps.length === 0 ? 'ok' : 'fail'](
    missingDeps.length === 0
      ? `声明的 ${declaredDeps.length} 个运行时依赖全部解析到位（另有 ${undeclared.length} 个未声明的顶层包，pnpm 传递依赖/残留）`
      : `🔴 声明的运行时依赖有 ${missingDeps.length} 个没解析到位：${missingDeps.join('、')}（引擎会加载失败）`,
  )
  if (missingDeps.length > 0) {
    throw new Error(`🔴 安装副本声明的运行时依赖缺失：${missingDeps.join('、')} → 失败退出（不许拿起不来的 profile 跑验收）`)
  }

  writeJson(join(outDir, 'stage.json'), entry)
  return { frozenPluginDir, profileDirAbs: profile.dir }
}

// ═════════════════════════════════════════════════════════════════════════════
// 阶段 3 · 跑真实课堂（多轮，端到端）
// ═════════════════════════════════════════════════════════════════════════════
/**
 * 跑**一次**会话尝试。
 *
 * 🔴 为什么要分"尝试"：上游 LLM 流会偶发中断（实测：turn 3 报
 *   `PI_AI_ERROR: unexpected EOF`）。宿主在 turn 出错时**不会**派发
 *   `agent/turn-stopping`（`dsh-agent-loop`：派发在 try 内、错误走 catch），
 *   于是那一轮的课后写入**根本不会发生** —— 那是环境故障，不是被测对象的缺陷。
 *   → 本流水线在"某一轮以 error 结束"时整场重跑（次数由 --session-retries 控制），
 *     每一次尝试都完整归档，最后用**全部轮次正常结束**的那一次做断言。
 * @param {string} frozenDir
 * @param {number} attemptIndex - 从 1 开始
 */
async function runSessionAttempt(frozenDir, attemptIndex) {
  const entry = {
    attemptIndex,
    at: new Date().toISOString(),
    frozenClassroom: join(frozenDir, 'classrooms', 'cs-os'),
  }
  const outDir = ensureDir(join(runDir, '03-session', `attempt-${attemptIndex}`))

  // 教室的**工作副本**：会话会写它（runtime/），冻结目录保持逐字节不变、事后仍可复核。
  //
  // 🔴 为什么把它放到**系统临时目录**而不是 run 目录里（2026-09-24 实证，第一版踩到）：
  //    会话的 cwd 必须是教室目录（教室自带 AGENTS.md 要靠 cwd 这条链加载——生产口径），
  //    而 cwd 一旦落在 `acceptance/runs/<ts>/work/...`，被测模型就会**顺着相对路径
  //    爬出教室、把验收脚手架本身读了**：实测 turn 3 花了 **15 步**去
  //    `cd .../acceptance`、`grep` accept.mjs、`sed` lib/asserts.mjs、甚至读
  //    `验收报告_最新.md` 去找"验收标准"。
  //    这既是**测试污染**（模型可以照着断言调整行为），也是那次 `unexpected EOF` 的
  //    直接来源（上下文被塞爆 + 连续十几轮请求）。
  //    → 工作副本放到 /tmp 下的临时目录：教室照常加载 AGENTS.md，但验收脚手架在
  //      **相对路径不可达**的地方。运行结束后把"跑完的教室"整份拷回 run 目录归档。
  const workRoot = ledgerMkdtemp(join(tmpdir(), 'accept-classroom-'), { source: 'accept.mjs 阶段③ 教室工作副本' })
  const workClassroom = join(workRoot, 'classroom', 'cs-os')
  ensureDir(join(workRoot, 'classroom'))
  ledgerCopy(join(frozenDir, 'classrooms', 'cs-os'), join(workRoot, 'classroom', 'cs-os'), { preserveTimestamps: true }, {
    source: 'accept.mjs 阶段③ 教室工作副本（原为 cp -a）',
  })
  entry.workRoot = workRoot
  entry.sessionCwd = workClassroom
  TEMP_WORK_ROOTS.push(workRoot)

  // ── ACCEPT-3：显式降级时，在这里把**工作副本**教室的 `animation:` 段删掉 ──────
  // 🔴 改的是工作副本，冻结目录与 `classrooms/**` 一个字都不动。
  // 🔴 删什么、删前后 sha256、理由，全部落盘留痕（这是"显式降级"，不是静默跳过）。
  let animationDisable = null
  if (!ANIMATION.enabled && ANIMATION.mode === 'explicitly-disabled') {
    animationDisable = disableClassroomAnimation({
      classroomDir: workClassroom,
      reason: ANIMATION.disable?.reason ?? '',
    })
    entry.animationDisable = animationDisable
    writeJson(join(outDir, 'animation-disable.json'), animationDisable)
    if (!animationDisable.ok) throw new Error(`🔴 显式关掉教室动画失败：${animationDisable.error}`)
    log.fail(
      `🔴 已在工作副本里删掉教室的 \`animation:\` 段（显式降级）：${animationDisable.file}\n` +
        `   sha256 ${animationDisable.sha256Before?.slice(0, 12)} → ${animationDisable.sha256After?.slice(0, 12)}；` +
        `删掉第 ${animationDisable.before?.firstLine}–${animationDisable.before?.lastLine} 行（${animationDisable.before?.lines} 行）：` +
        `${JSON.stringify(animationDisable.removedLines)}；理由：${animationDisable.reason}`,
    )
    // 🔴 ACCEPT-4 ③：**另写一份固定位置的追加留痕**（跨运行可检索："过去一周关过几次动画"）
    const degradeRow = appendDegradeLedger({
      acceptanceDir: HERE,
      runDir,
      mode: 'full',
      reason: animationDisable.reason,
      disable: animationDisable,
    })
    entry.degradeLedger = degradeRow
    // 用 fail 级打印：降级本身就是"该被人看见"的事件（不是错误，但不该静默）
    log.fail(
      degradeRow.ok
        ? `🔴 已追加一行到固定位置的降级留痕 \`${DEGRADE_LEDGER_NAME}\`（累计 ${degradeRow.totalRows} 行）：\n   ${degradeRow.line}`
        : `🔴 写降级留痕失败：${degradeRow.error}`,
    )
    if (!degradeRow.ok) throw new Error(`🔴 显式降级必须留下跨运行留痕，但写 ${degradeRow.file} 失败：${degradeRow.error}`)
  } else {
    entry.animationDisable = null
  }

  // 🔴 完整性基线：工作副本 vs 冻结教室**逐文件一致**。
  //    ⚠️ ACCEPT-3 的例外：显式降级时工作副本**故意**与冻结教室差 classroom.yaml 那一处
  //    （差在哪、sha256 是多少，见上面的 animation-disable.json）→ 那时基线改取"降级后"的
  //    工作副本自身，冻结教室的完整性仍由阶段①的清单复核负责（它一个字都没被写）。
  const frozenTree = hashTree(join(frozenDir, 'classrooms', 'cs-os'))
  const workTree = hashTree(workClassroom)
  const sameAsFrozen =
    JSON.stringify(Object.keys(frozenTree.map).sort()) === JSON.stringify(Object.keys(workTree.map).sort()) &&
    Object.keys(frozenTree.map).every((rel) => frozenTree.map[rel].sha256 === workTree.map[rel].sha256)
  const baselineTree = animationDisable === null ? frozenTree : workTree
  if (animationDisable === null) {
    log[sameAsFrozen ? 'ok' : 'fail'](`工作副本与冻结教室逐文件一致：${workTree.files} 文件（${humanBytes(workTree.bytes)}）`)
    entry.workClassroom = { dir: workClassroom, files: workTree.files, bytes: workTree.bytes, sameAsFrozen }
    if (!sameAsFrozen) throw new Error('工作副本与冻结教室不一致 → 拒绝继续')
  } else {
    log.fail(
      `工作副本与冻结教室**故意**不一致（显式降级删了 animation 段）：差异 ${Object.keys(frozenTree.map).filter((rel) => frozenTree.map[rel].sha256 !== workTree.map[rel].sha256).length} 个文件；` +
        `完整性基线改取"降级后"的工作副本；冻结教室本身仍由阶段①清单复核（未被写）`,
    )
    entry.workClassroom = {
      dir: workClassroom,
      files: workTree.files,
      bytes: workTree.bytes,
      sameAsFrozen,
      baseline: 'post-disable-work-copy',
      differFromFrozen: Object.keys(frozenTree.map).filter((rel) => frozenTree.map[rel].sha256 !== workTree.map[rel].sha256),
    }
  }

  // 运行前的教室状态（断言 1/2/3 的输入）
  const progressFile = join(workClassroom, 'runtime', 'progress.md')
  const progressBefore = readFileSync(progressFile, 'utf8')
  const lessonLine = /^current_lesson:\s*(\d+)\s*$/m.exec(progressBefore)
  const phaseLine = /^current_phase:\s*(\S+)\s*$/m.exec(progressBefore)
  const sessionLogFile = join(workClassroom, 'runtime', 'session_log.md')
  const sessionLogBefore = readFileSync(sessionLogFile, 'utf8')
  const manifestRaw = readFileSync(join(workClassroom, 'classroom.yaml'), 'utf8')
  const defaultPhase = /^\s*-\s*\{\s*id:\s*([a-z_]+)/m.exec(manifestRaw)?.[1] ?? null
  const lessonAtRunStart = lessonLine === null ? null : Number.parseInt(lessonLine[1], 10)
  const phaseAtRunStart = phaseLine === null ? defaultPhase : phaseLine[1]
  entry.classroomStateBefore = {
    progressFile,
    lessonAtRunStart,
    phaseAtRunStart,
    phaseLineBefore: phaseLine === null ? null : phaseLine[0],
    sessionLogBytes: sessionLogBefore.length,
    sessionLogSha256: hashTree(workClassroom).map['runtime/session_log.md']?.sha256 ?? null,
  }
  writeText(join(outDir, 'classroom-progress-before.md'), progressBefore)
  writeText(join(outDir, 'classroom-session_log-before.md'), sessionLogBefore)
  log.info(`运行前教室状态：本轮要讲第 ${lessonAtRunStart} 讲｜相位 ${phaseAtRunStart}（progress.md 无 current_phase 行 → 取值域首个）`)

  // ── patch：关掉一进程一 turn 的 headless-runner，挂日志桥与多轮驱动 ──────────
  // 🔴 ACCEPT-3：这里**必须**带上 animation 配置。原因（实测确认，见 lib/animation.mjs 头注）：
  //    profile 的 `cordis.patch.yml` 与本 `--patch` overlay 都是**整个 config 对象替换**
  //    （`@deepseek-ai/dsh-app-boot` 的 `applyEntryPatches`：`target[key] = value`，不深合并）
  //    → 只写 `config: {classroomDir: …}` 会把 profile 里刚写好的 animation **整块抹掉**，
  //      引擎随即在装载期抛"教室声明了 animation 段但渲染环境不可用"。
  const patchFile = join(outDir, 'patch.yml')
  writeText(
    patchFile,
    [
      '# ACCEPT-1 运行时 patch（只在专用测试 profile 上临时生效，不写入任何 profile 文件）',
      '# 🔴 socratic-engine 已在 profile 的 bundle 列表里 → 这里只能按 id 覆盖 config，绝不能再 insert。',
      '- id: socratic-engine',
      '  config:',
      `    classroomDir: ${workClassroom}`,
      ...animationConfigLines('    '),
      '- id: headless-runner',
      '  disabled: true',
      '- insert:',
      '    - id: socratic-accept-log-bridge',
      `      name: ${join(frozenDir, 'probe', 'log-bridge.mjs')}`,
      '    - id: socratic-accept-driver',
      `      name: ${join(frozenDir, 'probe', 'accept-driver.mjs')}`,
      '',
    ].join('\n'),
  )

  const task = `${PROMPTS.length}|${PROMPTS.join('|')}`
  const driverReport = join(outDir, 'driver-report.json')
  const cordisLog = join(outDir, 'cordis-log.jsonl')
  const logProbe = join(outDir, 'log-probe.json')

  const args = [DSH_BIN, '--profile', ACCEPT_PROFILE, '--patch', patchFile, task]
  const cmdline = [NODE, '--expose-internals', ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')
  log.info(`启动会话：${cmdline}`)
  log.info(`cwd=${workClassroom}（教室自带 AGENTS.md 会作为系统指令加载——这是生产口径）`)
  writeText(join(outDir, 'command.txt'), `${cmdline}\n\n# cwd: ${workClassroom}\n# task: ${task}\n`)

  const t0 = Date.now()
  // 🔴 ACCEPT-2 负向对照开关（默认关闭，正常验收路径不受影响）：
  //   `ACCEPT_NEGATIVE_CONTROL=1 ./run.sh` → 探针会故意打一条**不在白名单里**的宿主告警，
  //   用来证明 A6.5「非白名单告警 → 判失败」这条断言**真的会红**（不是空断言）。
  //   环境变量在这里原样继承给会话子进程（`...process.env`），不需要额外管道。
  const child = await runAsync(NODE, ['--expose-internals', ...args], {
    cwd: workClassroom,
    timeout: Number.parseInt(process.env.ACCEPT_SESSION_TIMEOUT_MS ?? '2400000', 10),
    env: {
      ...process.env,
      ACCEPT_REPORT: driverReport,
      ACCEPT_LOG_FILE: cordisLog,
      ACCEPT_LOG_PROBE: logProbe,
    },
  })
  const elapsedMs = Date.now() - t0
  writeText(join(outDir, 'process-stdout.txt'), child.stdout)
  writeText(join(outDir, 'process-stderr.txt'), child.stderr)
  writeJson(join(outDir, 'process-meta.json'), {
    cmd: cmdline,
    cwd: workClassroom,
    code: child.code,
    signal: child.signal,
    error: child.error,
    elapsedMs,
  })
  log[child.code === 0 ? 'ok' : 'fail'](`会话进程退出码 ${child.code}（耗时 ${(elapsedMs / 1000).toFixed(1)}s）`)
  entry.process = { cmd: cmdline, code: child.code, signal: child.signal, elapsedMs }

  // ── 按 sessionId 精确定位日志（🔴 不用"最新目录"）───────────────────────────
  const driver = existsSync(driverReport) ? JSON.parse(readFileSync(driverReport, 'utf8')) : null
  entry.driverReport = driver
  const sessionsRoot = join(DSH_HOME, 'sessions')
  const sessionId = driver?.sessionId ?? null
  log.info(`驱动脚本报告的 sessionId = ${sessionId ?? '<无>'}`)

  let located = null
  if (sessionId !== null) located = findBySessionId(sessionsRoot, sessionId)
  if (located === null) {
    const all = listAllSessions(sessionsRoot)
    writeJson(join(outDir, 'sessions-diagnostic.json'), all.slice(0, 40))
    log.fail(`按 sessionId 找不到落盘日志；$DSH_HOME/sessions 下现有 ${all.length} 个会话（前 5 个：${JSON.stringify(all.slice(0, 5).map((s) => s.headerId))}）`)
    throw new Error('按 sessionId 定位会话日志失败（拒绝退回"最新目录"）')
  }
  log.ok(`按 sessionId 精确定位到日志：${located.file}`)
  writeJson(join(outDir, 'session-location.json'), located)
  // 🔴 ACCEPT-4：把"本次会话自己的落盘目录"登记进写足迹上下文
  //    （宿主必然把会话日志写进 `$DSH_HOME/sessions/…`，白名单**只放这一个目录**：
  //     目录名由本次 cwd（每次唯一的临时教室）推导，且目录里就是本次 sessionId 的日志）
  registerSessionLogDir(located.dir)
  log.info(`已登记本次会话的落盘目录（写足迹白名单 session-log-dir）：${located.dir}`)

  const text = decompress(located.file)
  const eventsFile = join(outDir, 'session-events.jsonl')
  writeText(eventsFile, text)
  const events = parseEvents(text)
  const analysis = analyze(events)
  writeJson(join(outDir, 'session-analysis.json'), {
    turns: analysis.turns,
    stepsPerTurn: analysis.stepsPerTurn,
    injections: analysis.injections.map((r) => ({ turn: r.turn, block: r.block, chars: r.chars })),
    toolCalls: analysis.toolCalls.map((r) => ({ turn: r.turn, name: r.name, callId: r.callId })),
    toolResults: analysis.toolResults.map((r) => ({ turn: r.turn, callId: r.callId, isError: r.isError, text: r.text.slice(0, 300) })),
    studentMessages: analysis.studentMessages.map((r) => ({ turn: r.turn, text: r.texts.join(' ').slice(0, 200) })),
    errors: analysis.errors,
  })

  // 运行后的教室状态
  const progressAfter = readFileSync(progressFile, 'utf8')
  const phaseLineAfter = /^current_phase:\s*(\S+)\s*$/m.exec(progressAfter)
  const lessonLineAfter = /^current_lesson:\s*(\d+)\s*$/m.exec(progressAfter)
  const sessionLogAfter = readFileSync(sessionLogFile, 'utf8')
  writeText(join(outDir, 'classroom-progress-after.md'), progressAfter)
  writeText(join(outDir, 'classroom-session_log-after.md'), sessionLogAfter)

  const workTreeAfter = hashTree(workClassroom)
  // 🔴 基线是 `baselineTree`（正常情况＝冻结教室；显式降级时＝降级后的工作副本），
  //    这样"会话改了什么"只反映**会话自己**的写入，不把降级那一处算进来。
  writeJson(join(outDir, 'classroom-changed-files.json'), {
    baseline: animationDisable === null ? 'frozen-classroom' : 'post-disable-work-copy',
    changed: Object.keys(baselineTree.map).filter(
      (rel) => (workTreeAfter.map[rel]?.sha256 ?? null) !== baselineTree.map[rel].sha256,
    ),
    added: Object.keys(workTreeAfter.map).filter((rel) => !(rel in baselineTree.map)),
    animationDisabledSection: animationDisable === null ? null : { file: animationDisable.file, reason: animationDisable.reason },
  })

  // 🔴 完整性守卫：被测模型**不许读到验收脚手架**。
  //    做法：把会话里所有工具调用的参数文本拼起来，找验收目录 / run 目录 / 脚本文件名。
  //    命中即视为本次会话被污染（模型可以照着断言调整行为），整条流水线判失败。
  const callText = analysis.toolCalls.map((c) => JSON.stringify(c.args ?? {})).join('\n')
  const contaminationNeedles = [HERE, runDir, 'accept.mjs', 'lib/asserts.mjs', '验收报告_最新.md', 'SHA256SUMS']
  const contaminationHits = contaminationNeedles.filter((needle) => callText.includes(needle))
  entry.contamination = { needles: contaminationNeedles, hits: contaminationHits, scannedCalls: analysis.toolCalls.length }
  log[contaminationHits.length === 0 ? 'ok' : 'fail'](
    `完整性守卫（模型未读到验收脚手架）：命中 ${contaminationHits.length} 项${contaminationHits.length ? ` → ${JSON.stringify(contaminationHits)}` : ''}`,
  )
  writeJson(join(outDir, 'contamination-check.json'), entry.contamination)

  // 把"跑完的教室"整份拷回 run 目录归档（工作副本本体在临时目录，不留在仓库）
  ledgerCopy(workClassroom, join(outDir, 'classroom-after'), {}, { source: 'accept.mjs 阶段③ 归档跑完的教室' })
  entry.classroomAfterArchived = join(outDir, 'classroom-after')

  entry.session = {
    sessionId,
    locatedFile: located.file,
    eventsFile,
    eventCount: events.length,
    turns: analysis.turns,
    stepsPerTurn: analysis.stepsPerTurn,
    injectionCount: analysis.injections.length,
    toolCalls: analysis.toolCalls.map((c) => c.name),
    lessonAtRunStart,
    phaseAtRunStart,
    phaseAfterRun: phaseLineAfter === null ? phaseAtRunStart : phaseLineAfter[1],
    lessonAfterRun: lessonLineAfter === null ? lessonAtRunStart : Number.parseInt(lessonLineAfter[1], 10),
    sessionLogBefore,
    sessionLogAfter,
    progressAfter,
  }
  log.info(`落盘真相：turn/start=${JSON.stringify(analysis.turns)}｜每 turn step 数=${JSON.stringify(analysis.stepsPerTurn)}`)
  log.info(`落盘真相：socratic-engine 注入 ${analysis.injections.length} 条｜工具调用 ${JSON.stringify(analysis.toolCalls.map((c) => c.name))}`)
  log.info(`运行后教室：current_lesson=${entry.session.lessonAfterRun}｜current_phase=${entry.session.phaseAfterRun}`)

  // 轮级健康度：所有请求的轮都到位、且没有哪一轮以 error 结束
  const turnErrors = (driver?.turnEnds ?? []).filter((t) => t.reason?.kind === 'error')
  const completedTurns = (driver?.turnEnds ?? []).filter((t) => t.reason?.kind === 'completed').length
  const ok = child.code === 0 && analysis.turns.length === PROMPTS.length && turnErrors.length === 0
  entry.attempt = {
    index: attemptIndex,
    ok,
    completedTurns,
    turnErrors: turnErrors.map((t) => ({ turn: t.turn, reason: t.reason })),
    requestedTurns: PROMPTS.length,
    observedTurns: analysis.turns.length,
  }
  log[ok ? 'ok' : 'fail'](
    `尝试 ${attemptIndex}：正常结束的轮 ${completedTurns}/${PROMPTS.length}，出错轮 ${turnErrors.length}` +
      (turnErrors.length > 0 ? ` → ${JSON.stringify(turnErrors.map((t) => `${t.turn}:${t.reason.error?.message ?? t.reason.kind}`))}` : ''),
  )

  writeJson(join(outDir, 'stage.json'), entry)
  return {
    entry,
    attempt: entry.attempt,
    outDir,
    workClassroom,
    analysis,
    eventsFile,
    sessionId,
    lessonAtRunStart,
    phaseAtRunStart,
    sessionLogBefore,
    sessionLogAfter,
    phaseAfterRun: entry.session.phaseAfterRun,
    progressAfter,
    child,
  }
}

/**
 * 阶段 3：跑真实课堂。若某次尝试有轮级错误 → 整场重跑（默认最多 3 次尝试）。
 *
 * 🔴 为什么要重跑：上游 LLM 中继在一次 turn 内连续 ~8 次请求后会偶发
 *   `PI_AI_ERROR: unexpected EOF`（实测 4 次尝试里 2 次踩到，都发生在"下课"那一轮
 *   连续写 5 个教室文件之后）。那是**环境/供应商**问题，不是被测对象的缺陷；
 *   而宿主在 turn 出错时不会派发 `agent/turn-stopping` → 那一轮的课后写入根本不会发生。
 *   → 整场重跑，每次尝试都完整归档，用**全部轮次正常结束**的那一次做断言。
 */
async function stage3Session(frozenDir) {
  const entry = stage('03', '跑真实课堂（多轮端到端会话，冻结教室副本，按 sessionId 定位日志）')
  const maxAttempts = 1 + Math.max(0, Number.parseInt(process.env.ACCEPT_SESSION_RETRIES ?? flag('session-retries', '2'), 10))
  const attempts = []
  let chosen = null
  for (let i = 1; i <= maxAttempts; i += 1) {
    const a = await runSessionAttempt(frozenDir, i)
    attempts.push({ index: i, ok: a.attempt.ok, completedTurns: a.attempt.completedTurns, turnErrors: a.attempt.turnErrors })
    if (a.attempt.ok) {
      chosen = a
      break
    }
    log.fail(`尝试 ${i} 有轮级错误（环境/上游故障）→ ${i < maxAttempts ? '整场重跑' : '已达尝试上限'}`)
  }
  if (chosen === null) {
    // 全部尝试都有轮级错误：仍然继续（断言会大声失败），但把事实留档
    log.fail('🔴 所有尝试都出现轮级错误；改用最后一次尝试做断言（结论不可信，需人工看原始日志）')
    chosen = await runSessionAttempt(frozenDir, maxAttempts)
    attempts.push({ index: maxAttempts, ok: chosen.attempt.ok, completedTurns: chosen.attempt.completedTurns, turnErrors: chosen.attempt.turnErrors, reused: true })
  }
  entry.attempts = attempts
  entry.chosenAttempt = chosen.attempt.index
  // 采用的那次尝试的 entry 也要带上尝试清单（结论/报告从它取数）
  chosen.entry.attempts = attempts
  chosen.entry.chosenAttempt = chosen.attempt.index
  writeJson(join(runDir, '03-session', 'stage.json'), entry)
  log.info(`采用尝试 ${chosen.attempt.index}（共尝试 ${attempts.length} 次）`)
  return chosen
}

// ═════════════════════════════════════════════════════════════════════════════
// 阶段 4 · 六条断言
// ═════════════════════════════════════════════════════════════════════════════
async function stage4Assert(frozenDir, s3) {
  const entry = stage('04', '六条断言（这就是验收标准，一条都不许省）')
  const outDir = ensureDir(join(runDir, '04-asserts'))
  ensureDir(join(outDir, 'evidence'))

  // 幂等重放探针（用冻结副本的真实 registerPostClass，对同一 turn 连发两次 turn-stopping）
  const lastStudentTurn = s3.analysis.studentMessages.length > 0
    ? s3.analysis.studentMessages[s3.analysis.studentMessages.length - 1].turn
    : s3.analysis.turns[s3.analysis.turns.length - 1]
  const idemOut = join(outDir, 'evidence', 'A4-幂等重放.json')
  const idem = runNode([
    join(frozenDir, 'probe', 'idempotency-replay.mjs'),
    '--frozen-plugin', join(frozenDir, 'plugins', 'socratic-engine'),
    '--events', s3.eventsFile,
    '--session-id', s3.sessionId,
    '--turn', String(lastStudentTurn),
    '--pristine-runtime-dir', join(frozenDir, 'classrooms', 'cs-os', 'runtime'),
    '--postrun-runtime-dir', join(s3.workClassroom, 'runtime'),
    '--phase', s3.phaseAfterRun,
    '--out', idemOut,
    '--dsh-bin', DSH_BIN,
  ])
  writeText(join(outDir, 'evidence', 'A4-幂等重放-stdout.txt'), `${idem.stdout}\n--- stderr ---\n${idem.stderr}\n`)
  log[idem.code === 0 ? 'ok' : 'fail'](`幂等重放探针（turn ${lastStudentTurn}）：exit ${idem.code}`)

  // 日志桥结果
  const logProbeFile = join(s3.outDir, 'log-probe.json')
  const logProbe = existsSync(logProbeFile) ? JSON.parse(readFileSync(logProbeFile, 'utf8')) : null
  const cordisLogFile = join(s3.outDir, 'cordis-log.jsonl')
  const logMessages = existsSync(cordisLogFile)
    ? readFileSync(cordisLogFile, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l))
    : []

  // 解析冻结教室的 manifest。
  // 🔴 用**已逐文件哈希复核过**的安装副本里的 lib/manifest.mjs：它与冻结源码逐字一致
  //    （02-install/hash-check.json 为证），且它的依赖 yaml 能从 profile 解析到。
  const installedManifestMod = join(profileDir(ACCEPT_PROFILE), 'node_modules', PLUGIN_PKG_NAME, 'lib', 'manifest.mjs')
  const manifestMod = await import(pathToFileURL(installedManifestMod).href)
  const manifest = manifestMod.loadManifest(s3.workClassroom)

  const studentEndTurnText =
    s3.analysis.studentMessages.length > 0
      ? s3.analysis.studentMessages[s3.analysis.studentMessages.length - 1].texts.join(' ')
      : ''

  const C = {
    runDir,
    analysis: s3.analysis,
    manifest,
    classroomDir: s3.workClassroom,
    workClassroomDir: s3.workClassroom,
    frozenClassroomDir: join(frozenDir, 'classrooms', 'cs-os'),
    frozenPluginDir: join(frozenDir, 'plugins', 'socratic-engine'),
    lessonAtRunStart: s3.lessonAtRunStart,
    phaseAtRunStart: s3.phaseAtRunStart,
    phaseAfterRun: s3.phaseAfterRun,
    sessionLogBefore: s3.sessionLogBefore,
    sessionLogAfter: s3.sessionLogAfter,
    idempotency: existsSync(idemOut) ? JSON.parse(readFileSync(idemOut, 'utf8')) : null,
    logProbe,
    logMessages,
    processOutput: {
      stdout: readFileSync(join(s3.outDir, 'process-stdout.txt'), 'utf8'),
      stderr: readFileSync(join(s3.outDir, 'process-stderr.txt'), 'utf8'),
    },
    studentEndTurnText,
  }

  const results = runAll(C)
  for (const r of results) {
    log[r.ok ? 'ok' : 'fail'](`${r.id} ${r.name} — ${r.detail}`)
  }
  const passed = results.filter((r) => r.ok).length
  log.info(`断言合计：通过 ${passed}/${results.length}`)

  writeJson(join(outDir, 'asserts.json'), {
    at: new Date().toISOString(),
    total: results.length,
    passed,
    failed: results.length - passed,
    results: results.map((r) => ({ id: r.id, name: r.name, ok: r.ok, detail: r.detail })),
  })
  writeText(
    join(outDir, 'asserts.md'),
    [
      '# ACCEPT-1 断言结果',
      '',
      `运行目录：\`${runDir}\``,
      `合计：**通过 ${passed}/${results.length}**`,
      '',
      '| # | 断言 | 结果 | 判定依据 |',
      '|---|---|---|---|',
      ...results.map((r) => `| ${r.id} | ${r.name} | ${r.ok ? '✅ 通过' : '❌ 失败'} | ${r.detail.replaceAll('|', '\\|')} |`),
      '',
    ].join('\n'),
  )
  entry.results = results.map((r) => ({ id: r.id, name: r.name, ok: r.ok, detail: r.detail }))
  // 🔴 ACCEPT-3：把日志桥收到的全部消息交出去——阶段⑤ 要拿它找"装载自检通过"那一条。
  s3.logMessages = logMessages
  entry.passed = passed
  writeJson(join(outDir, 'stage.json'), { ...entry, results: undefined })
  return results
}

// ═════════════════════════════════════════════════════════════════════════════
// 阶段 5 · 零接触复核 + 结论 + 人读报告
// ═════════════════════════════════════════════════════════════════════════════
/** 把绝对路径渲染成"相对仓库根"的写法（只用于人读报告）。 */
function relPath(p) {
  return String(p).replace(`${REPO_ROOT}/`, '')
}

/**
 * 🔴 报告的**头两行**：被测对象指纹（冻结的那一份 vs 现盘的那一份）。
 *
 * 为什么放在最前面：这份报告是"最新一次"的人读入口，而它**天生会过期** ——
 * 源码一改，旧报告的结论就不再对现盘成立。首行把两份 sha256 并排摆出来，
 * 读者一眼就能判"我手上这份绿，说的是不是我现在看到的这棵树"。
 * 报告生成时**再算一次现盘**（完整跑要几分钟，冻结之后源码仍可能被改）。
 */
function testedHeaderLines(tested) {
  if (tested === null || tested === undefined) {
    return [
      '> ⚠️ **被测对象指纹缺失**（阶段① 未产出）—— 本报告无法说明它说的是哪一份被测对象，**不要据此判断现盘**。',
      '',
    ]
  }
  const short = (s) => (typeof s === 'string' ? s.slice(0, 16) : '<缺>')
  const nowEngine = treeDigest(PLUGIN_SRC)
  const nowClassroom = treeDigest(CLASSROOM_SRC)
  const sameEngine = nowEngine.sha256 === tested.frozen.engine.sha256
  const sameClassroom = nowClassroom.sha256 === tested.frozen.classroom.sha256
  const fresh = sameEngine && sameClassroom
  return [
    `> 🔴 **被测对象指纹**（这份报告只对"冻结的那一份"成立）：` +
      `引擎 \`${tested.frozen.engine.rel}\` sha256=\`${short(tested.frozen.engine.sha256)}\`（${tested.frozen.engine.files} 文件）｜` +
      `教室 \`${tested.frozen.classroom.rel}\` sha256=\`${short(tested.frozen.classroom.sha256)}\`（${tested.frozen.classroom.files} 文件）`,
    `> 冻结清单：${tested.manifest.files} 文件 / ${humanBytes(tested.manifest.bytes)}｜冻结时刻 ${tested.at}`,
    fresh
      ? `> ✅ **现盘与冻结一致**（报告生成时复核：引擎 \`${short(nowEngine.sha256)}\`、教室 \`${short(nowClassroom.sha256)}\`）`
      : `> 🔴 **现盘已变** —— 报告**相对现盘已过期**，别拿这份结论判现盘：` +
        `引擎 \`${short(nowEngine.sha256)}\`${sameEngine ? '' : '（≠ 冻结）'}、` +
        `教室 \`${short(nowClassroom.sha256)}\`${sameClassroom ? '' : '（≠ 冻结）'} → 请重跑一次再引用`,
    '',
  ]
}

function stage5Conclude(results, frozenDir, s3) {
  const entry = stage('05', '零接触复核 + 结论 + 人读报告')
  const outDir = ensureDir(join(runDir, '05-conclusion'))
  // 🔴 ACCEPT-3：这两份来自前面阶段，阶段⑤ 的守卫要用它们
  //   · logMessages：日志桥收到的全部消息（找引擎的"装载自检通过"那一条）
  //   · entry02：阶段②的 stage 记录（技能包自检结论）
  const logMessages = s3.logMessages ?? []
  const entry02 = existsSync(join(runDir, '02-install', 'stage.json'))
    ? JSON.parse(readFileSync(join(runDir, '02-install', 'stage.json'), 'utf8'))
    : null

  // 🔴 ACCEPT-4：零接触证据与守卫——判据＝**写足迹**（不是时间窗）。
  //    完整跑与 --skip-session 共用同一段（`computeZeroTouchEvidence`），保证两条路径口径一致。
  //    ⚠️ 它必须**先算**：下面的"全命令口径"要用它交出来的 `commands`（ledger 记的每一条命令）。
  const zeroTouchEvidence = computeZeroTouchEvidence({
    outDir,
    beforeFile: join(runDir, '00-preflight', 'profiles-before.json'),
    label: '完整跑（含真实会话）',
  })
  const zeroTouchGuard = zeroTouchEvidence.guard

  // 🔴 "没碰 web/桌面 profile"的**可核对证据**：
  //    ① 旧口径：扫 3 个日志文件里的 `--profile`（保留，作为人读的"当时那条命令长什么样"）；
  //    ② 🔴 ACCEPT-4 新增：扫**本流水线执行过的全部命令**（`lib/footprint.mjs` 的 ledger 记账，
  //       `run`/`runAsync` 统一登记）—— 覆盖面比"3 个文件"大得多，且**不依赖采样器**。
  const commandTexts = []
  for (const f of [join(s3.outDir, 'command.txt'), join(runDir, '02-install', 'plugin-add.log'), join(runDir, '02-install', 'profile-init.log')]) {
    if (existsSync(f)) commandTexts.push({ file: f, text: readFileSync(f, 'utf8') })
  }
  const profileRefs = []
  for (const { file, text } of commandTexts) {
    for (const m of text.matchAll(/--profile\s+(\S+)/g)) profileRefs.push({ file, profile: m[1] })
  }
  const badRefs = profileRefs.filter((r) => FORBIDDEN_PROFILES.includes(r.profile.toLowerCase()))
  const nonAcceptRefs = profileRefs.filter((r) => r.profile !== ACCEPT_PROFILE)

  const ledgerProfileRefs = []
  for (const c of zeroTouchGuard.commands) {
    for (const p of c.profileRefs) ledgerProfileRefs.push({ file: `ledger#${c.seq}（${c.source}）`, profile: p, cmd: c.cmd })
  }
  const ledgerBadRefs = ledgerProfileRefs.filter((r) => FORBIDDEN_PROFILES.includes(r.profile.toLowerCase()))
  const ledgerNonAcceptRefs = ledgerProfileRefs.filter((r) => r.profile !== ACCEPT_PROFILE)
  writeJson(join(outDir, 'profile-references.json'), {
    scannedFiles: commandTexts.map((c) => c.file),
    profileRefs,
    badRefs,
    nonAcceptRefs,
    // 🔴 ACCEPT-4：全命令口径（ledger）
    ledgerCommandsScanned: zeroTouchGuard.commands.length,
    ledgerProfileRefs,
    ledgerBadRefs,
    ledgerNonAcceptRefs,
  })
  log[badRefs.length === 0 && nonAcceptRefs.length === 0 ? 'ok' : 'fail'](
    `本流水线执行过的命令里 --profile 出现 ${profileRefs.length} 次；受保护 profile 命中 ${badRefs.length} 次；` +
      `非专用 profile 命中 ${nonAcceptRefs.length} 次${nonAcceptRefs.length ? ` → ${JSON.stringify(nonAcceptRefs)}` : ''}`,
  )
  log[ledgerBadRefs.length === 0 && ledgerNonAcceptRefs.length === 0 ? 'ok' : 'fail'](
    `全命令口径（ACCEPT-4 新增，扫 ${zeroTouchGuard.commands.length} 条命令）：--profile 出现 ${ledgerProfileRefs.length} 次` +
      `（去重后 ${JSON.stringify([...new Set(ledgerProfileRefs.map((r) => r.profile))])}）；` +
      `受保护 profile 命中 ${ledgerBadRefs.length} 次；非专用 profile 命中 ${ledgerNonAcceptRefs.length} 次`,
  )

  const zeroTouch = Object.fromEntries(
    Object.entries(zeroTouchGuard.attribution).map(([name, a]) => [
      name,
      {
        changedKeys: a.changedKeys,
        attributableToUs: a.attributedToUs,
        notOurs: a.notOurs,
        rows: a.rows,
        samplerObserved: zeroTouchGuard.samplerObserved[name] ?? [],
      },
    ]),
  )

  // 冻结目录在跑完之后**仍然**能通过清单复核（工作副本才是被写的那个）
  const verifyAfter = verifyManifest(frozenDir, join(runDir, '01-freeze', 'SHA256SUMS.json'))
  log[verifyAfter.ok ? 'ok' : 'fail'](`跑完之后冻结目录仍与清单一致：不一致 ${verifyAfter.mismatched.length}、缺失 ${verifyAfter.missing.length}`)

  const passed = results.filter((r) => r.ok).length
  const allOk = passed === results.length

  // 🔴 完整性守卫（不是六条断言之一，但失败同样让进程退出码非零）：
  //    ① 零接触：归因本流水线的 web/桌面 profile 变化必须为 0
  //    ② 命令里不许出现受保护/非专用 profile
  //    ③ 被测模型不许读到验收脚手架（测试污染）
  //    ④ 🔴 ACCEPT-3：教学动画的**装载期自检真的跑过并通过**（引擎在启用动画时会打一条
  //       含 `装载自检通过` 的日志）——这是"渲染环境真的被引擎认了"的唯一直接证据，
  //       不是"我们写了配置就以为配好了"。
  //    ⑤ 🔴 ACCEPT-3：技能包自检（`socratic-classroom/validate`）通过；
  //       "只有第⑤项发现链路红"按已知/可解释处理（见 lib/skillcheck.mjs 头注）。
  const animationLoadLog = ANIMATION.enabled
    ? logMessages.find(
        (m) => m.name === '[socratic-engine]' && m.args.some((a) => typeof a === 'string' && a.includes('装载自检通过')),
      ) ?? null
    : null
  const animationLoadEvidence = {
    enabled: ANIMATION.enabled,
    mode: ANIMATION.mode,
    declared: ANIMATION.declared,
    env: ANIMATION.env,
    disable: ANIMATION.disable,
    selfCheckLogFound: animationLoadLog !== null,
    selfCheckLogText: animationLoadLog === null ? null : animationLoadLog.args.filter((a) => typeof a === 'string').join(' '),
    selfCheckLogSn: animationLoadLog?.sn ?? null,
    engineInfoMessages: logMessages
      .filter((m) => m.name === '[socratic-engine]')
      .map((m) => ({ sn: m.sn, type: m.type, text: m.args.filter((a) => typeof a === 'string').join(' ').slice(0, 300) })),
  }
  writeJson(join(outDir, 'animation-load-evidence.json'), animationLoadEvidence)
  log[animationLoadLog !== null || !ANIMATION.enabled ? 'ok' : 'fail'](
    animationLoadLog !== null
      ? `🔴 ACCEPT-3 装载自检证据（引擎日志逐字）：${animationLoadEvidence.selfCheckLogText}`
      : ANIMATION.enabled
        ? '🔴 ACCEPT-3：引擎日志里**没有**出现含 `装载自检通过` 的那一条 → 渲染环境没被引擎认下（不是"配了就完事"）'
        : ANIMATION.mode === 'not-declared'
          ? '教学动画：教室未声明 `animation:` 段 → 引擎不会打装载自检那一条，本守卫**不适用**（不是"通过"）'
          : `教学动画本次为显式降级（${ANIMATION.disable?.reason ?? '<未记录>'}）→ 引擎不会打装载自检那一条，本守卫不适用`,
  )

  const skillCheckFromStage2 = entry02?.skillSelfCheck ?? s3.entry?.skillSelfCheck ?? null
  const installedSkillCheck = entry02?.skillInstalledCheck ?? s3.entry?.skillInstalledCheck ?? null
  log[(skillCheckFromStage2?.ok ?? false) ? 'ok' : 'fail'](
    skillCheckFromStage2 === null
      ? '🔴 技能包自检（源包·内容）没有结果（阶段②未产出）'
      : `🔴 技能包自检【源包·判内容】：exit ${skillCheckFromStage2.exitCode}，判定 ${skillCheckFromStage2.verdict}；` +
        `⑤ 发现链路问题 ${skillCheckFromStage2.discoveryProblems?.length ?? 0} 条（**预期内**：源包住在仓库 skills/、宿主扫不到＝设计如此）、` +
        `其余项（①–④ 内容类）问题 ${skillCheckFromStage2.otherProblems?.length ?? 0} 条`,
  )
  log[installedSkillCheck === null ? 'fail' : installedSkillCheck.applicable === false || installedSkillCheck.ok ? 'ok' : 'fail'](
    installedSkillCheck === null
      ? '🔴 技能包自检（已装副本·发现链路）没有结果（阶段②未产出）'
      : installedSkillCheck.applicable === false
        ? `⚠️ 技能包自检【已装副本·判发现链路】：**未安装、该检查跳过** → ${installedSkillCheck.installedDir}`
        : `🔴 技能包自检【已装副本·判发现链路】：exit ${installedSkillCheck.exitCode}，判定 ${installedSkillCheck.verdict}`,
  )

  // 🔴 完整性守卫（不是六条断言之一，但失败同样让进程退出码非零）：
  //    ① 零接触：**写足迹**判据（ACCEPT-4 起）——
  //       本流水线自己的每一次写盘都在"允许写的位置"内、完整性扫描无未登记写调用、
  //       命令里没有受保护 profile、受保护 profile 的变化不在我们的写足迹里。
  //    ② 命令里不许出现受保护/非专用 profile（**全命令口径**，不只 3 个文件）
  //    ③ 被测模型不许读到验收脚手架（测试污染）
  //    ④ 教学动画的**装载期自检真的跑过并通过**（引擎日志里那条 `装载自检通过`）
  //    ⑤ 技能包自检：**源包判内容**（①–④ 全绿）＋ **已装副本判发现链路**（exit 0）
  //       —— 已装副本"未安装"是**跳过**（显式报告），不算失败，但也**不算通过**。
  const guards = {
    zeroTouchForbiddenClean: zeroTouchGuard.ok,
    noForbiddenProfileInCommands: badRefs.length === 0 && nonAcceptRefs.length === 0 && ledgerBadRefs.length === 0 && ledgerNonAcceptRefs.length === 0,
    noHarnessContamination: (s3.entry.contamination?.hits ?? []).length === 0,
    frozenIntactAfterRun: verifyAfter.ok,
    animationRuntimeConfigured: ANIMATION.enabled
      ? ANIMATION.env !== null && animationLoadLog !== null
      : ANIMATION.mode === 'explicitly-disabled'
        ? true
        : 'not-applicable（教室 manifest 未声明 animation 段 → 引擎不做渲染环境自检）',
    skillPackageSelfCheckPassed: skillCheckFromStage2?.ok === true,
    // 🔴 ACCEPT-4 新增：已装副本的发现链路（"宿主真的能发现这个技能"）。
    //    true＝装且全绿；false＝装但红；'skipped-not-installed'＝本机没装（显式跳过，不算通过也不算失败）
    skillInstalledCopyDiscoveryChain:
      installedSkillCheck === null ? false : installedSkillCheck.applicable ? installedSkillCheck.ok === true : 'skipped-not-installed',
  }
  // 🔴 硬门只认 `true`，外加**显式不适用**（`not-applicable…` 前缀）；
  //    `skipped-not-installed` 这类别的字符串仍然判红（必须被看见，不许假装通过）。
  const guardsAllOk = Object.values(guards).every(guardSatisfied)

  const conclusion = {
    at: new Date().toISOString(),
    runDir,
    // 🔴 被测对象指纹（冻结的那一份 ＋ 现盘的那一份）→ 报告首行用它
    tested: TESTED,
    total: results.length,
    passed,
    failed: results.length - passed,
    allOk,
    guards,
    guardsAllOk,
    overallOk: allOk && guardsAllOk,
    results: results.map((r) => ({ id: r.id, name: r.name, ok: r.ok, detail: r.detail })),
    zeroTouch,
    contamination: s3.entry.contamination ?? null,
    sessionCwd: s3.entry.sessionCwd ?? null,
    frozenStillIntact: verifyAfter.ok,
    frozenVerifyAfter: { mismatched: verifyAfter.mismatched.length, missing: verifyAfter.missing.length, files: verifyAfter.actualFiles },
    profileReferences: {
      total: profileRefs.length,
      bad: badRefs.length,
      nonAccept: nonAcceptRefs.length,
      refs: profileRefs,
      // 🔴 ACCEPT-4：全命令口径（ledger 记的每一条命令）
      ledgerCommandsScanned: zeroTouchGuard.commands.length,
      ledgerTotal: ledgerProfileRefs.length,
      ledgerDistinctProfiles: [...new Set(ledgerProfileRefs.map((r) => r.profile))],
      ledgerBad: ledgerBadRefs.length,
      ledgerNonAccept: ledgerNonAcceptRefs.length,
      ledgerRefs: ledgerProfileRefs,
    },
    turns: PROMPTS.length,
    sessionAttempts: s3.entry.attempts,
    chosenAttempt: s3.entry.chosenAttempt,
    chosenAttemptDir: s3.outDir,
    sessionId: s3.sessionId,
    processExitCode: s3.child.code,
    sessionElapsedMs: s3.entry.process.elapsedMs,
    // ── ACCEPT-3 新增 ──────────────────────────────────────────────────────────
    animation: animationLoadEvidence,
    skillSelfCheck: skillCheckFromStage2,
    // ── ACCEPT-4 新增 ──────────────────────────────────────────────────────────
    zeroTouchGuard,
    skillInstalledCheck: installedSkillCheck,
    skillCopies: entry02?.skillCopies ?? null,
    degradeLedger: s3.entry.degradeLedger ?? null,
    negativeControl: s3.entry.negativeControl ?? null,
    // 🔴 第三态（显式不适用）必须写出来，不许混进"通过"。没有就**不出现**这一节
    //    （`renderLatestReport` 按 `undefined` 判"无"）。
    notApplicable:
      ANIMATION.mode === 'not-declared'
        ? {
            animationRuntime: '教室 manifest 没有顶层 `animation:` 段 → 引擎不做渲染环境自检；本流水线也不配置动画。**不是"通过"**',
          }
        : undefined,
  }
  writeJson(join(outDir, 'conclusion.json'), conclusion)
  writeText(join(runDir, '05-结论.md'), renderRunConclusion(conclusion, results))

  // 人读的"最新一次"报告（顶层，只指向最近一次运行）
  writeText(join(HERE, '验收报告_最新.md'), renderLatestReport(conclusion, results, frozenDir))

  entry.conclusion = conclusion
  writeJson(join(outDir, 'stage.json'), entry)
  return conclusion
}

function renderRunConclusion(conclusion, results) {
  const lines = [
    '# ACCEPT-1 验收结论',
    '',
    `- 运行目录：\`${conclusion.runDir}\``,
    `- 结束时间：${conclusion.at}`,
    `- 断言：**通过 ${conclusion.passed}/${conclusion.total}**${conclusion.allOk ? '' : ' → 🔴 有失败项'}`,
    `- 完整性守卫：${conclusion.guardsAllOk ? '✅ 全通过' : `🔴 有失败 → ${JSON.stringify(conclusion.guards)}`}`,
    `- 总判定：${conclusion.overallOk ? '✅ 通过' : '🔴 失败（退出码非零）'}`,
    `- 🔴 零接触（**写足迹**判据，ACCEPT-4 起）：${FORBIDDEN_PROFILES.map((n) => `${n}：变化 ${conclusion.zeroTouch[n].changedKeys.length} 个、其中归因本流水线 ${conclusion.zeroTouch[n].attributableToUs.length} 个`).join('；')}`,
    `  · 判据：**受保护 profile 的变化只有出现在本流水线的写足迹里才归因给我们**（写足迹＝我们自己的写盘＋显式登记的命令写入目标）。` +
      `不在足迹里的变化只报"不由我们造成"并附判据 —— 旧的"时间窗"判据会在**采样器拍不到的黑窗口**里默认算到我们头上（ACCEPT-3 那条假红）。`,
    `  · 采样器旁证（每 2 秒一拍，仅作旁证、不参与归因）：${FORBIDDEN_PROFILES.map((n) => `${n}=${JSON.stringify(conclusion.zeroTouch[n].samplerObserved ?? [])}`).join('、')}`,
    `  · 写足迹：${conclusion.zeroTouchGuard.ledgerStats.writes} 次写盘（**白名单外 ${conclusion.zeroTouchGuard.ledgerStats.violations}**）｜按规则 ${Object.entries(conclusion.zeroTouchGuard.ledgerStats.byRule).map(([k, v]) => `${k}×${v}`).join('、')}`,
    `  · 写足迹完整性扫描：${conclusion.zeroTouchGuard.scan.scannedFiles} 个源文件 / ${conclusion.zeroTouchGuard.scan.callSites} 处写调用，未登记 ${conclusion.zeroTouchGuard.scan.violations.length} 处`,
    `  · 写足迹白名单（人读）：\`${relPath(join(conclusion.runDir, '05-conclusion', 'write-footprint-whitelist.md'))}\``,
    `- 流水线命令里出现的 --profile（旧口径：扫 3 个日志文件）：共 ${conclusion.profileReferences.total} 次，受保护 profile ${conclusion.profileReferences.bad} 次、非专用 profile ${conclusion.profileReferences.nonAccept} 次`,
    `- 🔴 全命令口径（ACCEPT-4 新增：扫 ledger 记的每一条命令，共 ${conclusion.profileReferences.ledgerCommandsScanned} 条）：--profile 出现 ${conclusion.profileReferences.ledgerTotal} 次，` +
      `去重后 ${JSON.stringify(conclusion.profileReferences.ledgerDistinctProfiles)}；受保护 profile ${conclusion.profileReferences.ledgerBad} 次、非专用 profile ${conclusion.profileReferences.ledgerNonAccept} 次`,
    `- 冻结目录跑完后仍与清单一致：${conclusion.frozenStillIntact ? '是' : '🔴 否'}`,
    `- 会话工作目录：\`${conclusion.sessionCwd}\`（在系统临时目录里，被测模型相对路径够不到验收脚手架）`,
    `- 污染守卫（模型有没有读到验收脚手架）：命中 ${(conclusion.contamination?.hits ?? []).length} 项`,
    `- 会话尝试：${conclusion.sessionAttempts.map((a) => `#${a.index}${a.ok ? '正常' : `有轮级错误(${a.turnErrors.length})`}`).join('、')}；采用 #${conclusion.chosenAttempt}`,
    `- 会话 sessionId：\`${conclusion.sessionId}\`（进程退出码 ${conclusion.processExitCode}，耗时 ${(conclusion.sessionElapsedMs / 1000).toFixed(1)}s）`,
    `- 🔴 教学动画（ACCEPT-3）：${animationStatusText(conclusion.animation)}`,
    `- 🔴 引擎装载自检（日志逐字）：${
      conclusion.animation?.selfCheckLogFound
        ? `✅ \`${conclusion.animation.selfCheckLogText}\``
        : conclusion.animation?.enabled
          ? '🔴 未在引擎日志里找到含 `装载自检通过` 的那一条'
          : '（引擎不走动画自检路径 → 本项不适用）'
    }`,
    `- 🔴 技能包自检【源包·判内容】（ACCEPT-4 起两份都跑）：exit ${conclusion.skillSelfCheck?.exitCode ?? '<无>'}，判定 \`${conclusion.skillSelfCheck?.verdict ?? '<无>'}\`；` +
      `⑤ 发现链路问题 ${conclusion.skillSelfCheck?.discoveryProblems?.length ?? 0} 条（**预期内**：源包住在仓库 \`skills/\`，宿主扫不到＝设计如此）、` +
      `其余项（①–④ 内容类）问题 ${conclusion.skillSelfCheck?.otherProblems?.length ?? 0} 条`,
    `- 🔴 技能包自检【已装副本·判发现链路】：${
      conclusion.skillInstalledCheck?.applicable === false
        ? `⚠️ **未安装、该检查跳过**（${conclusion.skillInstalledCheck.installedDir} 不存在）—— 这不是"通过"，是"**没验**"`
        : `exit ${conclusion.skillInstalledCheck?.exitCode ?? '<无>'}，判定 \`${conclusion.skillInstalledCheck?.verdict ?? '<无>'}\`（\`$DSH_HOME/skills/socratic-classroom\`，**只读**）`
    }`,
    `- 源包 ↔ 已装副本逐文件 sha256：${
      conclusion.skillCopies?.compared ? (conclusion.skillCopies.identical ? '**逐字节相同**' : `不同（只在源包 ${conclusion.skillCopies.onlyInSource.length}／只在已装 ${conclusion.skillCopies.onlyInInstalled.length}／内容不同 ${conclusion.skillCopies.differing.length}）`) : (conclusion.skillCopies?.note ?? '<未比对>')
    }`,
    `- 🔴 显式降级留痕（ACCEPT-4 起另写固定位置）：${
      conclusion.degradeLedger?.ok
        ? `本次已追加一行到 \`acceptance/${DEGRADE_LEDGER_NAME}\`（累计 ${conclusion.degradeLedger.totalRows} 行）`
        : conclusion.animation?.mode === 'explicitly-disabled'
          ? '🔴 本次为显式降级，但留痕没写成（见结论文件 degradeLedger 字段）'
          : '本次未降级 → 无需追加'
    }`,
    '',
    '| # | 断言 | 结果 | 判定依据 |',
    '|---|---|---|---|',
    ...results.map((r) => `| ${r.id} | ${r.name} | ${r.ok ? '✅ 通过' : '❌ 失败'} | ${r.detail.replaceAll('|', '\\|')} |`),
    '',
    `原始会话日志：\`${conclusion.chosenAttemptDir}/session-events.jsonl\`（按 sessionId 精确定位，非"最新目录"）`,
    '',
  ]
  return lines.join('\n')
}

function renderLatestReport(conclusion, results, frozenDir) {
  const failed = results.filter((r) => !r.ok)
  const rel = (p) => p.replace(`${REPO_ROOT}/`, '')
  return [
    '# 验收报告（最新一次）',
    '',
    ...testedHeaderLines(conclusion.tested ?? TESTED),
    `> 这份文件由 \`acceptance/run.sh\` 每次运行后自动重写，**只指向最近一次运行**。`,
    `> 历史运行全部留在 \`acceptance/runs/\` 下，一次一个目录。`,
    '',
    `- 最近一次运行：\`${rel(conclusion.runDir)}\`（${conclusion.at}）`,
    `- 结论：**${conclusion.overallOk ? '全部通过' : '有失败项'}** —— 六条断言通过 ${conclusion.passed}/${conclusion.total}；完整性守卫 ${conclusion.guardsAllOk ? '全通过' : '有失败'}`,
    '',
    '## 🔴 这次走的是哪条路径（先看这一节，别看错）',
    '',
    '- 路径：**完整跑（含真实会话）**',
    '- 🔴 **本节下面每一栏都是本次运行的真结果**；没有"不适用"的栏位时**不会**出现「不适用」一节。',
    '  （对照：`--skip-session` 那条路径会重写本文件并在开头标明路径，且单列「哪些检查不适用」一节。）',
    '',
    '## 哪些检查**不适用**（不是通过，也不是失败）',
    '',
    '> 口径与技能包那条"**未安装＝没验，不是通过**"完全一致：第三态要**显式写出来**，不许混进"通过"。',
    '> 这一节是**固定栏位**：有不适用的检查就逐条列；一条都没有就明写"无"。',
    '',
    '| 检查 | 状态 | 为什么 |',
    '|---|---|---|',
    ...(conclusion.notApplicable === undefined
      ? ['| （无） | — | 本次运行**没有**不适用的检查：会话跑了、引擎 boot 了、污染守卫与装载自检都有结果 |']
      : Object.entries(conclusion.notApplicable).map(([k, v]) => `| \`${k}\` | ⚠️ **不适用** | ${v} |`)),
    '',
    '## 完整性守卫（跑之前必须成立的前提）',
    '',
    `- 冻结清单复核（冻结后 + 跑完后各一次）：${conclusion.frozenStillIntact ? '一致' : '🔴 不一致'}`,
    `- 装载后逐文件哈希复核：见 \`${rel(conclusion.runDir)}/02-install/hash-check.json\``,
    `- 🔴 零接触（**写足迹**判据）：${FORBIDDEN_PROFILES.map((n) => `${n}：变化 ${conclusion.zeroTouch[n].changedKeys.length} 个、归因本流水线 ${conclusion.zeroTouch[n].attributableToUs.length} 个`).join('；')}`,
    `  · 写足迹 ${conclusion.zeroTouchGuard.ledgerStats.writes} 次写盘（白名单外 ${conclusion.zeroTouchGuard.ledgerStats.violations}）｜完整性扫描 ${conclusion.zeroTouchGuard.scan.scannedFiles} 个源文件、未登记写调用 ${conclusion.zeroTouchGuard.scan.violations.length} 处`,
    `- 被测模型读到验收脚手架：${(conclusion.contamination?.hits ?? []).length} 项`,
    `- 🔴 教学动画渲染环境（ACCEPT-3）：${animationStatusText(conclusion.animation)}${
      conclusion.animation?.enabled
        ? ` —— 引擎装载自检：${conclusion.animation.selfCheckLogFound ? '✅ 日志里出现 `装载自检通过`' : '🔴 未出现'}`
        : ''
    }`,
    `- 🔴 技能包自检【源包·判内容】（ACCEPT-4）：exit ${conclusion.skillSelfCheck?.exitCode ?? '<无>'} → \`${conclusion.skillSelfCheck?.verdict ?? '<无>'}\`（⑤ 发现链路 ${conclusion.skillSelfCheck?.discoveryProblems?.length ?? 0} 条＝预期内；其余项 ${conclusion.skillSelfCheck?.otherProblems?.length ?? 0} 条）`,
    `- 🔴 技能包自检【已装副本·判发现链路】（ACCEPT-4）：${
      conclusion.skillInstalledCheck?.applicable === false
        ? '⚠️ **未安装、该检查跳过**（这不是"通过"，是"没验"）'
        : `exit ${conclusion.skillInstalledCheck?.exitCode ?? '<无>'} → \`${conclusion.skillInstalledCheck?.verdict ?? '<无>'}\``
    }`,
    `- 🔴 显式降级留痕（ACCEPT-4）：${
      conclusion.degradeLedger?.ok
        ? `已追加一行到 \`acceptance/${DEGRADE_LEDGER_NAME}\`（累计 ${conclusion.degradeLedger.totalRows} 行）`
        : conclusion.animation?.mode === 'explicitly-disabled'
          ? '🔴 未写成'
          : '本次未降级'
    }`,
    `- 完整性守卫逐条：\`${JSON.stringify(conclusion.guards)}\``,
    '',
    '## 六条断言',
    '',
    '| # | 断言 | 结果 |',
    '|---|---|---|',
    ...results.map((r) => `| ${r.id} | ${r.name} | ${r.ok ? '✅ 通过' : '❌ 失败'} |`),
    '',
    ...(failed.length > 0
      ? [
          '## 失败项与原始证据',
          '',
          ...failed.flatMap((r) => [
            `### ${r.id} ${r.name}`,
            '',
            `${r.detail}`,
            '',
            `证据：\`${rel(conclusion.runDir)}/04-asserts/evidence/\``,
            '',
          ]),
        ]
      : []),
    '## 这一跑实际发生了什么（人话）',
    '',
    `1. 把插件源码、教室（含 cs-os）与三个探针脚本复制到 \`${rel(conclusion.runDir)}/frozen/\`，逐文件算 sha256 并**当场复核一次**。`,
    '2. 在专用测试 profile 里装**冻结的那一份**，然后**逐文件核对哈希**（profile 里的副本 vs 冻结目录），一致才继续。',
    `3. 用冻结教室的**工作副本**跑一次多轮真实会话（同一进程内连发 ${conclusion.turns} 次 followup）；本轮共尝试 ${conclusion.sessionAttempts.length} 次，采用第 ${conclusion.chosenAttempt} 次。`,
    '4. 六条断言全部自动判定；任何一条失败，进程退出码非零，并把失败项的原始证据落盘。',
    '',
    '## 每份证据在哪',
    '',
    `- 冻结清单与复核：\`${rel(conclusion.runDir)}/01-freeze/\``,
    `- 装载与哈希复核：\`${rel(conclusion.runDir)}/02-install/\``,
    `- 会话原始日志与摘录：\`${rel(conclusion.runDir)}/03-session/attempt-${conclusion.chosenAttempt}/\``,
    `- 断言结果与证据：\`${rel(conclusion.runDir)}/04-asserts/\``,
    `- 结论与零接触复核：\`${rel(conclusion.runDir)}/05-conclusion/\``,
    '',
    '## 覆盖不了的空白（诚实清单）',
    '',
    '见 `acceptance/README.md` 的「覆盖不了的空白（诚实清单）」一节。',
    '',
  ].join('\n')
}

/**
 * 人读的"最新一次"报告 · **`--skip-session` 路径**版（ACCEPT-5 新增）。
 *
 * 🔴 为什么必须有它：这份报告是**人读入口**，约定"只指向最近一次运行"。而旧版只在
 *    完整路径（阶段⑤）重写它 → 跑一次 `--skip-session` 之后，它**仍指向更早那次完整跑**，
 *    于是里面写着那次的红、读者却以为是刚跑出来的结果（ACCEPT-4 实况：它一直指向
 *    `runs/2026-09-24_150308` 并写着 `zeroTouchForbiddenClean:false`，而那条红**早已修掉**）
 *    → **会误导后来的人**。故本路径也重写它，并在**开头就标明这次走的是哪条路径**。
 *
 * 🔴 第三态（`not-applicable`）必须**说人话**且**不许混进"通过"**：
 *    本路径不跑会话 ⇒ 污染守卫与引擎装载自检**没被验证**（不是"通过"）。
 *    写法与技能包那条"未安装＝没验，不是通过"完全一致：单列一节，逐条写"不适用＋为什么"。
 *
 * @param {{report:object, acceptanceDir:string, runDir:string}} opts
 */
function renderLatestReportSkipped(opts) {
  const { report, runDir } = opts
  const rel = (p) => String(p).replace(`${REPO_ROOT}/`, '')
  const g = report.guards ?? {}
  const zt = report.zeroTouchGuard ?? {}
  const stats = zt.ledgerStats ?? { writes: 0, violations: 0, commands: 0, byRule: {} }
  const scan = zt.scan ?? { scannedFiles: 0, callSites: 0, violations: [] }
  const attribution = zt.attribution ?? {}
  const installed = report.skillInstalledCheck ?? null
  const source = report.skillSelfCheck ?? null
  // 🔴 第三态（`not-applicable…`）必须显示成"不适用"而不是"通过"；别的字符串一律原样显示（可能是红的线索）。
  const badge = (v) =>
    v === true
      ? '✅ 通过'
      : v === false
        ? '❌ 失败'
        : typeof v === 'string' && v.startsWith('not-applicable')
          ? `⚠️ 不适用：${v.replace(/^not-applicable[（(]?/, '').replace(/[）)]$/, '') || '（未写理由）'}`
          : `⚠️ 其它：${String(v)}`

  return [
    '# 验收报告（最新一次）',
    '',
    ...testedHeaderLines(report.tested ?? TESTED),
    `> 这份文件由 \`acceptance/run.sh\` **每次运行后**自动重写（ACCEPT-5 起，\`--skip-session\` 这条路径也重写），`,
    `> **只指向最近一次运行**，并在开头标明**这次走的是哪条路径**。历史运行全部留在 \`acceptance/runs/\` 下，一次一个目录。`,
    '',
    '## 🔴 这次走的是哪条路径（先看这一节，别看错）',
    '',
    `- 路径：**\`--skip-session\`（不跑会话的省钱路径）**`,
    `- 最近一次运行：\`${rel(runDir)}\`（${report.at}）`,
    `- 结论：**${report.guardsAllOk ? '完整性守卫全通过' : '有失败项'}**`,
    `- 🔴 这一跑**没有跑会话**，因此：**六条断言（A1–A6）本次未执行**，另有若干检查**不适用**（见下节）。`,
    `  → 本报告的绿**只覆盖**"冻结／装载／技能包自检／零接触写足迹守卫"这几件；`,
    `    它**不能**被读成"整套验收通过"——那要一次**完整跑**（\`./run.sh\`）。`,
    '',
    '## 哪些检查**不适用**（不是通过，也不是失败）',
    '',
    '> 口径与技能包那条"**未安装＝没验，不是通过**"完全一致：第三态要**显式写出来**，不许混进"通过"。',
    '',
    '| 检查 | 状态 | 为什么 |',
    '|---|---|---|',
    '| 六条断言 A1–A6 | ⚠️ **不适用（未执行）** | 本路径跳过阶段③④：没有会话事件流，就没有可判的材料注入／工具调用／课后写入事实 |',
    '| 污染守卫（被测模型有没有读到验收脚手架） | ⚠️ **不适用** | 没有模型跑过，无从谈起。**不是"通过"** |',
    '| 引擎装载自检（日志里那条 `装载自检通过`） | ⚠️ **不适用** | 本路径不 boot 引擎，那条日志**不可能**出现。要验它必须跑一次真实会话（阶段③） |',
    '',
    '## 完整性守卫（跑之前必须成立的前提）',
    '',
    `- 冻结清单复核（冻结后 + 跑完后各一次）：${report.frozenIntactAfterRun === true ? '一致' : report.frozenIntactAfterRun === false ? '🔴 不一致' : '⚠️ 本路径未做跑后复核'}`,
    `- 装载后逐文件哈希复核：见 \`${rel(runDir)}/02-install/hash-check.json\``,
    `- 🔴 零接触（**写足迹**判据，ACCEPT-4 起本路径**也照判**）：${FORBIDDEN_PROFILES.map((n) => `${n}：变化 ${(attribution[n]?.changedKeys ?? []).length} 个、归因本流水线 ${(attribution[n]?.attributedToUs ?? []).length} 个`).join('；')}`,
    `  · 写足迹 ${stats.writes} 次写盘（白名单外 ${stats.violations}）｜命令 ${stats.commands} 条｜按规则 ${Object.entries(stats.byRule ?? {}).map(([k, v]) => `${k}×${v}`).join('、') || '<无>'}`,
    `  · 完整性扫描 ${scan.scannedFiles} 个源文件 / ${scan.callSites} 处写调用，未登记写调用 ${(scan.violations ?? []).length} 处`,
    `  · 全命令口径：扫 ${(zt.commands ?? []).length} 条命令，\`--profile\` 去重后 ${JSON.stringify([...new Set((zt.commands ?? []).flatMap((c) => c.profileRefs ?? []))])}`,
    `- 🔴 教学动画渲染环境（ACCEPT-3）：${animationStatusText(report.animation)}`,
    `  · ⚠️ 但"引擎装载自检"那一条**本路径不适用**（不 boot 引擎，见上节）`,
    `- 🔴 技能包自检【源包·判内容】（ACCEPT-4）：exit ${source?.exitCode ?? '<无>'} → \`${source?.verdict ?? '<无>'}\``,
    `  · ⑤ 发现链路问题 ${source?.discoveryProblems?.length ?? 0} 条（**预期内**：源包住在仓库 \`skills/\`、宿主扫不到＝设计如此）；其余项（①–④ 内容类）问题 ${source?.otherProblems?.length ?? 0} 条`,
    `- 🔴 技能包自检【已装副本·判发现链路】（ACCEPT-4）：${
      installed === null
        ? '🔴 没有结果'
        : installed.applicable === false
          ? `⚠️ **未安装、该检查跳过**（\`${installed.installedDir}\`）—— 这不是"通过"，是"**没验**"`
          : `exit ${installed.exitCode} → \`${installed.verdict}\``
    }`,
    `- 源包 ↔ 已装副本逐文件 sha256：${
      report.skillCopies?.compared
        ? report.skillCopies.identical
          ? '**逐字节相同**'
          : '**不同**（见 02-install/skill-selfcheck/skill-tree-unchanged.json）'
        : (report.skillCopies?.note ?? '<未比对>')
    }`,
    `- 🔴 显式降级留痕（ACCEPT-4）：${
      report.degradeLedger?.ok
        ? `已追加一行到 \`acceptance/${DEGRADE_LEDGER_NAME}\`（累计 ${report.degradeLedger.totalRows} 行）`
        : report.animation?.mode === 'explicitly-disabled'
          ? '🔴 未写成'
          : '本次未降级'
    }`,
    `- 完整性守卫逐条：\`${JSON.stringify(g)}\``,
    `  · 🔴 逐条人话：${Object.entries(g).map(([k, v]) => `\`${k}\`=${badge(v)}`).join('；')}`,
    '',
    '## 六条断言（本路径未执行）',
    '',
    '| # | 断言 | 结果 |',
    '|---|---|---|',
    '| A1–A6 | 材料按讲次／按环节给、工具可用、课后写入、不重复送、静默失败检查 | ⚠️ **未执行**（本路径不跑会话） |',
    '',
    '## 这一跑实际发生了什么（人话）',
    '',
    `1. 把插件源码、教室与三个探针脚本复制到 \`${rel(runDir)}/frozen/\`，逐文件算 sha256 并**当场复核一次**。`,
    '2. 在专用测试 profile 里装**冻结的那一份**，然后**逐文件核对哈希**（profile 里的副本 vs 冻结目录），一致才继续。',
    '3. 🔴 **到此为止**：\`--skip-session\` 不跑会话、不判六条断言（省钱路径）。',
    '4. 零接触（写足迹）守卫**照判**：本流水线自己的写盘全在白名单内、命令里没有受保护 profile、受保护 profile 的变化不在我们的写足迹里。',
    '',
    '## 每份证据在哪',
    '',
    `- 冻结清单与复核：\`${rel(runDir)}/01-freeze/\``,
    `- 装载与哈希复核：\`${rel(runDir)}/02-install/\``,
    `- 本路径的结论（机器读）：\`${rel(runDir)}/02-install/skip-session-report.json\` 与 \`${rel(runDir)}/05-conclusion/skip-session-conclusion.json\``,
    `- 零接触写足迹与白名单：\`${rel(runDir)}/05-conclusion/\``,
    '',
    '## 覆盖不了的空白（诚实清单）',
    '',
    '见 `acceptance/README.md` 的「覆盖不了的空白（诚实清单）」一节；',
    '本路径特有的空白**已逐条写在上面的「哪些检查不适用」一节**。',
    '',
  ].join('\n')
}

// ═════════════════════════════════════════════════════════════════════════════
// 主流程
// ═════════════════════════════════════════════════════════════════════════════
let exitCode = 1
try {
  log.info(`ACCEPT-1 开始：runDir=${runDir}`)
  writeJson(join(runDir, '00-preflight', 'env.json'), state.env)
  await stage0Preflight()
  const { frozenDir } = stage1Freeze()
  stage2Install(frozenDir)
  if (SKIP_SESSION) {
    // 🔴 ACCEPT-3：这条省钱路径也要把"渲染环境配好了 ＋ 技能包自检过了"讲清楚，
    //    否则 `--skip-session` 的绿只是在说"冻结与装载没崩"，看不出动画与技能包的状态。
    // 🔴 ACCEPT-4：**再加一条** —— 这条路径也要跑**零接触（写足迹）守卫**。
    //    旧版 skip 路径根本不判零接触 → 它"绿"的时候其实什么都没证明；
    //    现在它与完整跑共用同一段判据（`computeZeroTouchEvidence`），越界写入照样判红。
    const entry02 = JSON.parse(readFileSync(join(runDir, '02-install', 'stage.json'), 'utf8'))
    const outDir = ensureDir(join(runDir, '05-conclusion'))
    const zt = computeZeroTouchEvidence({
      outDir,
      beforeFile: join(runDir, '00-preflight', 'profiles-before.json'),
      label: '--skip-session（不跑会话）',
    })
    const zeroTouchGuard = zt.guard
    const installedCheck02 = entry02.skillInstalledCheck ?? null
    const guards = {
      zeroTouchForbiddenClean: zeroTouchGuard.ok,
      noForbiddenProfileInCommands:
        zeroTouchGuard.commands.every((c) => c.forbiddenProfileHits.length === 0) &&
        zeroTouchGuard.commands.every((c) => c.profileRefs.every((p) => p === ACCEPT_PROFILE)),
      animationRuntimeConfigured: ANIMATION.enabled
        ? ANIMATION.env !== null
        : ANIMATION.mode === 'explicitly-disabled'
          ? true
          : 'not-applicable（教室 manifest 未声明 animation 段 → 引擎不做渲染环境自检）',
      skillPackageSelfCheckPassed: entry02.skillSelfCheck?.ok === true,
      skillInstalledCopyDiscoveryChain:
        installedCheck02 === null ? false : installedCheck02.applicable ? installedCheck02.ok === true : 'skipped-not-installed',
      // ⚠️ 本路径**不跑会话** → 这两条**不适用**（不是"通过"）：
      //    · 污染守卫（模型有没有读到验收脚手架）：没有模型跑过，无从谈起
      //    · 装载自检（引擎那条 `装载自检通过` 日志）：引擎没 boot
      sessionDependentGuards: 'not-applicable（本路径不跑会话）',
      // 🔴 ACCEPT-2 的负向对照（A6.5 的宿主告警判据）**靠会话里的探针执行** → 本路径跑不了。
      //    没请求它：**不适用**（显式写出来，不是"通过"）；
      //    请求了它：**判红** —— "请求没被满足"与"请求通过"是两回事，
      //    静默给绿会让调用方以为"非白名单告警会判失败"这条判据刚被验证过。
      negativeControlProbe: negativeControlRequested
        ? false
        : 'not-applicable（未请求负向对照；且本路径不跑会话，探针不会跑）',
    }
    // 判据与完整跑共用同一个 `guardSatisfied`（`true` 或 `not-applicable…` 前缀）
    const guardsAllOk = Object.values(guards).every(guardSatisfied)
    if (negativeControlRequested) {
      log.fail(
        '🔴 ACCEPT_NEGATIVE_CONTROL 已设置，但 `--skip-session` **不跑会话** → ' +
          'A6.5 的负向对照探针（probe/log-bridge.mjs）根本不会执行。\n' +
          '   本次**不予通过**（退出码 1）：请求了却没跑 ≠ 请求通过。要验它请走完整跑 `./acceptance/run.sh`。',
      )
    }

    // 🔴 ACCEPT-4 ③：`--skip-session` 也可能带着降级开关跑（它不删教室的 animation 段，
    //    因为没有工作副本）→ 仍要**显式记一行**（"这次运行申请了降级"本身就是跨运行要知道的事）。
    let degradeRow = null
    if (!ANIMATION.enabled && ANIMATION.mode === 'explicitly-disabled') {
      degradeRow = appendDegradeLedger({
        acceptanceDir: HERE,
        runDir,
        mode: 'skip-session',
        reason: ANIMATION.disable?.reason ?? '<未记录>',
        disable: null,
      })
      log.fail(
        degradeRow.ok
          ? `🔴 已追加一行到固定位置的降级留痕 \`${DEGRADE_LEDGER_NAME}\`（累计 ${degradeRow.totalRows} 行）：\n   ${degradeRow.line}`
          : `🔴 写降级留痕失败：${degradeRow.error}`,
      )
    }

    const skipReport = {
      at: new Date().toISOString(),
      mode: '--skip-session',
      // 🔴 报告首行要能回答"这份报告说的是哪一份被测对象"（见 renderLatestReportSkipped）
      tested: TESTED,
      animation: {
        mode: ANIMATION.mode,
        enabled: ANIMATION.enabled,
        declared: ANIMATION.declared,
        env: ANIMATION.env,
        reason: ANIMATION.disable?.reason ?? null,
        profilePatchFile: entry02.animationProfilePatch?.file ?? null,
        profilePatchSha256: entry02.animationProfilePatch?.sha256 ?? null,
        note:
          '本路径**不跑会话** → 引擎不会 boot → 拿不到"装载自检通过"那一条日志。' +
          '该证据只可能来自一次真实会话（阶段③），见 05-conclusion/animation-load-evidence.json。',
      },
      skillSelfCheck: entry02.skillSelfCheck ?? null,
      skillInstalledCheck: installedCheck02,
      skillCopies: entry02.skillCopies ?? null,
      skillUnchanged: entry02.skillSelfCheck?.skillUnchangedAfterSelfCheck ?? null,
      // 🔴 ACCEPT-4：这条路径的零接触（写足迹）结论
      zeroTouchGuard,
      guards,
      guardsAllOk,
      degradeLedger: degradeRow,
      negativeControl: entry02.negativeControl ?? null,
      // 🔴 请求了 A6.5 的负向对照却没跑 → 必须显式写进结论（见 guards.negativeControlProbe）
      negativeControlRequested,
      // 🔴 ACCEPT-5：本路径**不跑会话** ⇒ 下列检查**不适用**（不是通过）。
      //    显式落进结论文件，人读报告由 `renderLatestReportSkipped` 单列一节照抄。
      notApplicable: {
        assertions: '本路径跳过阶段③④：没有会话事件流，六条断言无从判定（未执行，不是通过）',
        contaminationGuard: '没有模型跑过，无从谈起（不适用，不是通过）',
        animationLoadSelfCheck: '本路径不 boot 引擎 → 日志里不可能出现 `装载自检通过`（不适用，不是通过）',
        ...(negativeControlRequested
          ? {
              negativeControlProbe:
                '🔴 **本次请求了 A6.5 的负向对照（ACCEPT_NEGATIVE_CONTROL 已设置），但本路径不跑会话 → 探针不会执行**。' +
                '本次**不予通过**（退出码非零）：请求没被满足 ≠ 请求通过。要验它请走完整跑。',
            }
          : {
              negativeControlProbe:
                '未请求负向对照（要验"非白名单告警会判失败"请用 `ACCEPT_NEGATIVE_CONTROL=1 ./acceptance/run.sh` 走完整跑）',
            }),
        ...(ANIMATION.mode === 'not-declared'
          ? {
              animationRuntime:
                '教室 manifest 没有顶层 `animation:` 段 → 引擎不做渲染环境自检；本流水线也不配置动画（不适用，不是通过）',
            }
          : {}),
      },
      // 本路径不做"跑完后冻结复核"（那要跑完会话才有意义）→ 显式写 null，不许当"一致"。
      frozenIntactAfterRun: null,
    }
    writeJson(join(runDir, '02-install', 'skip-session-report.json'), skipReport)
    writeJson(join(outDir, 'skip-session-conclusion.json'), skipReport)
    // 🔴 ACCEPT-5：这条路径**也**重写人读报告 —— 否则它会一直指向更早那次完整跑（含那次的红），
    //    读者却以为是刚跑出来的结果（ACCEPT-4 实况：它写着已修掉的 zeroTouchForbiddenClean:false）。
    writeText(join(HERE, '验收报告_最新.md'), renderLatestReportSkipped({ report: skipReport, acceptanceDir: HERE, runDir }))
    writeText(
      join(runDir, '05-结论.md'),
      [
        '# ACCEPT-1/3/4 验收结论（--skip-session：只跑了冻结与装载）',
        '',
        `- 运行目录：\`${runDir}\``,
        '- 断言：**未跑**（本路径跳过阶段③④⑤ 的会话与断言）',
        '- 🔴 零接触守卫（**写足迹**判据，ACCEPT-4 起本路径也判）：' +
          (zeroTouchGuard.ok ? '✅ 通过' : `🔴 失败 → ${zeroTouchGuard.reasons.join('；')}`),
        `  · 受保护 profile：${FORBIDDEN_PROFILES.map((n) => `${n}：变化 ${zeroTouchGuard.attribution[n].changedKeys.length} 个、归因本流水线 ${zeroTouchGuard.attribution[n].attributedToUs.length} 个`).join('；')}`,
        `  · 写足迹：${zeroTouchGuard.ledgerStats.writes} 次写盘（白名单外 ${zeroTouchGuard.ledgerStats.violations}）｜按规则 ${Object.entries(zeroTouchGuard.ledgerStats.byRule).map(([k, v]) => `${k}×${v}`).join('、')}`,
        `  · 完整性扫描：${zeroTouchGuard.scan.scannedFiles} 个源文件 / ${zeroTouchGuard.scan.callSites} 处写调用，未登记 ${zeroTouchGuard.scan.violations.length} 处`,
        `  · 全命令口径：扫 ${zeroTouchGuard.commands.length} 条命令，--profile 去重后 ${JSON.stringify([...new Set(zeroTouchGuard.commands.flatMap((c) => c.profileRefs))])}`,
        `  · 写足迹白名单（人读）：\`${relPath(join(outDir, 'write-footprint-whitelist.md'))}\``,
        `- 完整性守卫逐条：\`${JSON.stringify(guards)}\``,
        `- 🔴 教学动画渲染环境：${animationStatusText(ANIMATION)}`,
        `- 专用 profile 的动画配置：\`${entry02.animationProfilePatch?.file ?? '<缺>'}\`（sha256 ${entry02.animationProfilePatch?.sha256?.slice(0, 12) ?? '<缺>'}）`,
        `- 🔴 技能包自检【源包·判内容】：exit ${entry02.skillSelfCheck?.exitCode ?? '<无>'} → \`${entry02.skillSelfCheck?.verdict ?? '<无>'}\`；⑤ 发现链路 ${entry02.skillSelfCheck?.discoveryProblems?.length ?? 0} 条（预期内）、其余项 ${entry02.skillSelfCheck?.otherProblems?.length ?? 0} 条`,
        `- 🔴 技能包自检【已装副本·判发现链路】：${installedCheck02 === null ? '🔴 没有结果' : installedCheck02.applicable === false ? `⚠️ **未安装、该检查跳过**（${installedCheck02.installedDir}）` : `exit ${installedCheck02.exitCode} → \`${installedCheck02.verdict}\``}`,
        `- 源包 ↔ 已装副本逐文件 sha256：${entry02.skillCopies?.compared ? (entry02.skillCopies.identical ? '**逐字节相同**' : '不同（见 02-install/skill-selfcheck/skill-tree-unchanged.json）') : (entry02.skillCopies?.note ?? '<未比对>')}`,
        `- 🔴 显式降级留痕：${
          degradeRow !== null
            ? degradeRow.ok
              ? `已追加一行到 \`acceptance/${DEGRADE_LEDGER_NAME}\`（累计 ${degradeRow.totalRows} 行）`
              : `🔴 写失败：${degradeRow.error}`
            : ANIMATION.mode === 'explicitly-disabled'
              ? '🔴 本次申请了降级，但留痕没写成'
              : '本次未降级（教室未声明动画，或动画正常启用）'
        }`,
        '- ⚠️ 本路径**不跑会话** → 拿不到引擎的"装载自检通过"日志、也没有污染守卫（那两样要一次真实会话）。',
        '',
      ].join('\n'),
    )
    log.info('--skip-session：跳过阶段 3/4（只验冻结与装载，但**照判**零接触写足迹守卫）')
    log[ANIMATION.mode === 'explicitly-disabled' ? 'fail' : 'ok'](
      ANIMATION.enabled
        ? `教学动画渲染环境已写进 profile（${entry02.animationProfilePatch?.file}）`
        : ANIMATION.mode === 'explicitly-disabled'
          ? `🔴 教学动画为显式降级（${ANIMATION.disable?.reason ?? '<未记录>'}）`
          : '教学动画：教室未声明 `animation:` 段 → 本项不适用（不是"通过"）',
    )
    log[(entry02.skillSelfCheck?.ok ?? false) ? 'ok' : 'fail'](
      `技能包自检【源包·判内容】：exit ${entry02.skillSelfCheck?.exitCode}，判定 ${entry02.skillSelfCheck?.verdict}`,
    )
    log[installedCheck02 === null || installedCheck02.applicable === false || installedCheck02.ok ? 'ok' : 'fail'](
      installedCheck02 === null
        ? '🔴 技能包自检【已装副本·判发现链路】没有结果'
        : installedCheck02.applicable === false
          ? `技能包自检【已装副本·判发现链路】：⚠️ **未安装、该检查跳过**（${installedCheck02.installedDir}）`
          : `技能包自检【已装副本·判发现链路】：exit ${installedCheck02.exitCode}，判定 ${installedCheck02.verdict}`,
    )
    log[guardsAllOk ? 'ok' : 'fail'](
      `--skip-session 完整性守卫：${guardsAllOk ? '全通过' : `有失败 → ${JSON.stringify(guards)}`}；退出码 ${guardsAllOk ? 0 : 1}`,
    )
    exitCode = guardsAllOk ? 0 : 1
  } else {
    const s3 = await stage3Session(frozenDir)
    const results = await stage4Assert(frozenDir, s3)
    const conclusion = stage5Conclude(results, frozenDir, s3)
    exitCode = conclusion.overallOk ? 0 : 1
    log[exitCode === 0 ? 'ok' : 'fail'](
      `ACCEPT-1 结束：断言通过 ${conclusion.passed}/${conclusion.total}；完整性守卫 ${conclusion.guardsAllOk ? '全通过' : `有失败 → ${JSON.stringify(conclusion.guards)}`}；退出码 ${exitCode}`,
    )
  }
} catch (error) {
  state.fatal = error instanceof Error ? `${error.message}\n${error.stack}` : String(error)
  log.fail(`致命错误：${state.fatal}`)
  exitCode = 1
} finally {
  // 🔴 ACCEPT-3 修的一个真坑（实测）：零接触采样器的 `setInterval` 是在阶段①起的，
  //    而原来只有阶段⑤ 才停它 → `--skip-session` 这条路径**永远不会停**，
  //    setInterval 把事件循环吊住、**node 进程跑完不退出**（进程里结论都写完了、
  //    人却看到命令一直挂着，最后只能手工 kill）。→ 收尾统一停，与走哪条路径无关。
  stopProfileSampler()
  for (const root of TEMP_WORK_ROOTS) {
    try {
      // 🔴 ACCEPT-4：删除也走 ledger（写足迹要完整；临时目录的删除同样是"我们写盘"的一种）
      ledgerRemove(root, {}, { source: 'accept.mjs finally 清理临时教室工作副本' })
    } catch {
      /* 临时目录清理失败不影响结论 */
    }
  }
  // 🔴 ACCEPT-4：负向对照写出去的越界文件收尾清掉（**也记写足迹** → 守卫照样红，这正是它的用途）
  try {
    cleanNegativeControl()
  } catch {
    /* 清理失败不影响结论（它本来就是个故意的越界文件） */
  }
}

state.finishedAt = new Date().toISOString()
state.exitCode = exitCode
writeJson(join(runDir, 'accept-state.json'), state)
log.info(`运行目录：${runDir}`)
process.exitCode = exitCode
