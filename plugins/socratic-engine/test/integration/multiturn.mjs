// test/integration/multiturn.mjs — 「每 turn 注入恰好一次」的多 turn 集成测试（S3，2026-09-23）
//
// 用法：
//   export DSH_HOME="$HOME/Library/Application Support/dsh-desktop/harness"
//   export DSH_BIN="/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js"
//   /opt/homebrew/bin/node test/integration/multiturn.mjs            # 默认 2 轮
//   TURNS=3 /opt/homebrew/bin/node test/integration/multiturn.mjs   # 3 轮
//
// ── 环境变量 ──────────────────────────────────────────────────────────────────
//   DSH_HOME              （必填）DSH 数据目录
//   DSH_BIN               （必填）dsh CLI 入口
//   TURNS                 （选填，默认 2）回合数
//   PROMPT_STYLE          （选填，默认 plain）`tools` = 让 turn 里出现工具调用 → 逼出多 step
//   SOCRATIC_CLASSROOM_DIR（选填，默认 test/fixtures/minimal-classroom）被测教室目录
//   SOCRATIC_PHASE        （选填，默认 boot）**本测试假定的当前相位**，用于算「本 turn 应注入哪些块」。
//       🔴 为什么需要它（FIX-1 ③，2026-09-24）：本脚本此前把 `phase: 'boot'` 硬编码进
//          `expectedPerTurn()`，而 `boot` 只是本仓库 fixture 教室（minimal-classroom）的相位。
//          拿真实教室（如 cs-os，默认相位 `open`）跑时，相位门判定全错 →
//          「注入块集合 = manifest 计划」与「相位门块在 boot 相位不注入」会报**假失败**。
//          跑非 fixture 教室时按该教室的默认相位传入，例如：
//            SOCRATIC_PHASE=open SOCRATIC_CLASSROOM_DIR=/tmp/cs-os TURNS=2 \
//              PROMPT_STYLE=tools /opt/homebrew/bin/node test/integration/multiturn.mjs
//          默认 `boot` → **对既有 fixture 的行为逐字不变**。
//
//   （另：**讲次**不设环境变量，而是按生产口径从教室的 runtime_store 读——见 `expectedPerTurn`。
//     理由：讲次是教室自己的运行时状态（`runtime/progress.md`），脚本替它猜值只会再造一个
//     「fixture 硬编码」缺陷；生产 `index.mjs` 用的就是 `readRuntimeLesson(manifest, {baseDir})`。）
//
// 🔴 这份脚本会真实调用 LLM（每轮一句话，短 prompt），产生少量花销。
//
// ── 它到底测什么 ──────────────────────────────────────────────────────────────
// 【驱动方式】安装版 headless 是「一进程一 turn」（取证§1.1），故用 `--patch` 关掉
//   `headless-runner` 行，insert 本仓库的 `multiturn-driver.mjs`，在**一个进程内对同一个
//   agent 连发 N 次 followup** → 得到真正的「同一会话多 turn」。详见取证报告 §1.5。
//
// 【计数口径】数**落盘会话事件流**里
//     type === 'user/message' && data.source.kind === 'socratic-engine'
//   的事件条数，再按所属 turn 分组（turn 号取该事件之前最近的 `turn/start` 的 data.turn）。
//   理由：这是**宿主持久化后的真相**，而不是插件自己的日志；且 LLM 重试不会重复落
//   user/message（取证§1.7），所以该指标对重试免疫。
//
// 【断言】对每个 (turn, block) 组合，**恰好 1 条**。
//   🔴 注意区分两件事，否则会把正常行为误判成双注入：
//     · 本 fixture 的 classroom.yaml 有 **2 个** `every: turn` 且相位门放行的块
//       （anchor、state-brief）→ **一个 turn 注入 2 条是正确的**；
//     · 「双注入」= **同一个 (turn, block) 出现 2 次**。
//   脚本会先把「本 turn 应注入的块集合」算出来（复用 lib/injector.mjs 的纯函数），再比对。

import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadManifest, readRuntimeLesson, usesLessonGate } from '../../lib/manifest.mjs'
import { planTurnInjections } from '../../lib/injector.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const pluginDir = join(here, '..', '..')
const DRIVER = join(here, 'multiturn-driver.mjs')

const DSH_HOME = process.env.DSH_HOME
const DSH_BIN = process.env.DSH_BIN
const TURNS = Number.parseInt(process.env.TURNS ?? '2', 10)
const CLASSROOM_DIR =
  process.env.SOCRATIC_CLASSROOM_DIR ?? join(pluginDir, 'test', 'fixtures', 'minimal-classroom')

/**
 * 本测试假定的「当前相位」，用于算「本 turn 应注入哪些块」（见 `expectedPerTurn`）。
 *
 * 🔴 默认 `boot` 是本仓库 fixture 教室（`test/fixtures/minimal-classroom`）的相位；
 *    跑别的教室必须用 `SOCRATIC_PHASE=` 覆盖成该教室的默认相位，否则相位门判定全错 →
 *    「注入块集合 = manifest 计划」与「相位门块不注入」会报**假失败**（FIX-1 ③）。
 */
const ASSUMED_PHASE = process.env.SOCRATIC_PHASE ?? 'boot'

/** 每个 turn 的一句话 prompt（短，控制花销）。 */
const PROMPTS = ['Reply with exactly: alpha', 'Reply with exactly: beta', 'Reply with exactly: gamma', 'Reply with exactly: delta']

/**
 * 🔴 工具型 prompt：**这是本测试最关键的一条路径**。
 *
 * 为什么必须有它：S3 的去重门要解决的正是「**一个 turn 内有多个 step**」——
 *   `agent/pre-step` 按 step 触发，带工具的 turn 内 3 步 = 触发 3 次
 *   （取证报告 §2.1、§2.3）。
 * 而**纯对话 prompt 只产生 1 个 step**（S3 实测：见取证报告 §3「已实测的多 step 缺口」），
 *   那种情况下每 turn 只要 pre-step 被调 1 次，去重门与旧判定的差别**测不出来**。
 * 所以判断「每 turn 注入一次」是否真成立，**必须让 turn 里出现工具调用 → ≥2 个 step**。
 *
 * 设置 `PROMPT_STYLE=tools` 使用这组 prompt。
 */
const TOOL_PROMPTS = [
  'Use the bash tool to run `echo one`. Then reply with exactly: done-one. Do not use any other tool.',
  'Use the bash tool to run `echo two`. Then reply with exactly: done-two. Do not use any other tool.',
  'Use the bash tool to run `echo three`. Then reply with exactly: done-three.',
  'Use the bash tool to run `echo four`. Then reply with exactly: done-four.',
]

/** 本轮实际使用的 prompt 组。 */
const PROMPT_STYLE = process.env.PROMPT_STYLE ?? 'plain'
const ACTIVE_PROMPTS = PROMPT_STYLE === 'tools' ? TOOL_PROMPTS : PROMPTS

// ── 结果累积（不用 process.exit 早退，先跑完再判）─────────────────────────────
const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok, detail })
  console.log(`${ok ? '✔' : '✖'} ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

function requireEnv() {
  if (DSH_HOME === undefined || DSH_HOME === '') throw new Error('multiturn.mjs: DSH_HOME must be set')
  if (DSH_BIN === undefined || DSH_BIN === '') throw new Error('multiturn.mjs: DSH_BIN must be set')
}

/** 找 sessions 下最新的一个 session 目录（按 mtime），避免依赖 cwd 编码规则。
 *  宿主把 cwd 编进目录名（'/'→'-'、' '→'~0020'、非 ASCII→'~XXXX'），规则未取证，
 *  故不自己拼路径，直接扫最新。 */
function newestSessionDir(root) {
  return pickSessionDir(root, null, null)
}

/**
 * 按 session header 的 `id` 精确定位本次运行的会话日志。
 *
 * 🔴 为什么不能只靠「最新 mtime」：同一 $DSH_HOME 上可能有**并行的其他会话**在写盘
 *   （本任务就有 3 个代理共用同一棵树），"最新"未必是我们的。
 *   可靠做法：driver 报告里的 `sessionId` → 扫每个 session 日志的**首行 header** 的 `id` 字段比对。
 *   header 形状取证：
 *   tmp/dsh-installed/dsh-session/lib/index.js:1401
 *     `...meta?.delegationDepth === void 0 ? {} : { delegationDepth: ... }` （header 记录）
 *   实测首行逐字（S3 解压既有会话）：
 *     {"type":"session","version":3,"id":"session-5a36f839-...","createdAt":...,"cwd":"...",...}
 *
 * @param {string} root - $DSH_HOME/sessions
 * @param {string|null} wantedSessionId
 * @param {number|null} modifiedAfterMs - 只考虑该时刻之后修改的日志（缩小扫描面）
 */
function pickSessionDir(root, wantedSessionId, modifiedAfterMs) {
  const buckets = readdirSafe(root)
  let best = null
  for (const bucket of buckets) {
    const bucketPath = join(root, bucket)
    for (const sessionDir of readdirSafe(bucketPath)) {
      const full = join(bucketPath, sessionDir)
      const file = findLogFile(full)
      if (file === null) continue
      const mtime = statMtime(file)
      if (modifiedAfterMs !== null && mtime < modifiedAfterMs) continue
      if (wantedSessionId !== null) {
        const headerId = readSessionHeaderId(file)
        if (headerId !== wantedSessionId) continue
      }
      if (best === null || mtime > best.mtime) best = { mtime, dir: full, file, sessionId: sessionDir }
    }
  }
  return best
}

/** 读一个 session 日志首行的 `id`（解压后用第一个 `{"type":"session"...}` 行）。找不到返回 null。 */
function readSessionHeaderId(file) {
  try {
    const raw = execFileSync('zstd', ['-dc', file], { maxBuffer: 8 * 1024 * 1024 })
    for (const line of raw.toString('utf8').split('\n', 40)) {
      const trimmed = line.trim()
      if (trimmed === '' || !trimmed.startsWith('{')) continue
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed?.type === 'session' && typeof parsed.id === 'string') return parsed.id
      } catch {
        continue
      }
    }
  } catch {
    return null
  }
  return null
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

function findLogFile(dir) {
  try {
    for (const name of readdirSync(dir)) {
      if (/^session\..*\.jsonl\.zstd$/.test(name)) return join(dir, name)
      if (/^session\.jsonl\.zstd$/.test(name)) return join(dir, name)
    }
  } catch {
    return null
  }
  return null
}

function statMtime(file) {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}

/** 解压 + 解析一个 session 日志，返回事件数组；格式不认则抛错（不静默）。 */
function readSessionEvents(file) {
  let raw
  try {
    raw = execFileSync('zstd', ['-dc', file], { maxBuffer: 512 * 1024 * 1024 })
  } catch (error) {
    throw new Error(`multiturn.mjs: failed to decompress ${file}: ${error.message}`)
  }
  const text = raw.toString('utf8')
  const events = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue // 头部/尾部的非 JSON 行忽略
    }
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.type === 'string') events.push(parsed)
  }
  if (events.length === 0) throw new Error(`multiturn.mjs: ${file} yielded no parseable events (format changed?)`)
  return events
}

/** 从事件流算出：turns 列表、每 turn 注入了哪些 block、每 turn 的 step 数。 */
function analyze(events) {
  const turns = []
  const injections = []
  const stepsPerTurn = new Map()
  let currentTurn = null
  for (const event of events) {
    if (event.type === 'turn/start') {
      currentTurn = event.data?.turn ?? null
      turns.push(currentTurn)
    } else if (event.type === 'step/start') {
      const turn = event.data?.turn ?? currentTurn
      stepsPerTurn.set(turn, (stepsPerTurn.get(turn) ?? 0) + 1)
    } else if (event.type === 'user/message') {
      const source = event.data?.source ?? {}
      if (source.kind !== 'socratic-engine') continue
      injections.push({ turn: currentTurn, block: source.block ?? '<no-block>', seq: event.seq })
    }
  }
  return { turns, injections, stepsPerTurn }
}

/**
 * 算出「本 turn 按 manifest 应该注入的块集合」（复用生产纯函数，不另写一套逻辑）。
 *
 * @param {object} manifest
 * @param {number} turnIndex
 * @param {number|null} currentLesson 本轮要讲的讲次（manifest 无讲次门时为 null）
 * @param {Set<string>} injectedOnce **跨 turn 累积**的「已注入过一次」集合
 */
function expectedPerTurn(manifest, turnIndex, currentLesson, injectedOnce) {
  const state = {
    turnCount: turnIndex,
    phase: ASSUMED_PHASE,
    injectedOnce,
    // 🔴 讲次门必须有值（FIX-1 ③ 的第二半，2026-09-24）：`lib/injector.mjs` 对用了讲次门的块
    //    **缺值一律抛错**（刻意不静默，见 injector.mjs 的 lesson 门注释）。此前本脚本不传它，
    //    故对任何带讲次门的教室（如 cs-os 的 `story.arc_gate`）会直接抛
    //    「state.currentLesson 不是整数」。口径与生产 `index.mjs` 一致：
    //    有讲次门 → readRuntimeLesson 读 runtime_store 的 progress 文件；没有 → null。
    currentLesson,
  }
  return planTurnInjections(manifest.blocks, state, { classroom: manifest.classroom.id }).map((d) => d.id).sort()
}

/**
 * 相位门是否**排除**给定相位（复刻 `lib/injector.mjs` 的 `phaseGate` 判据）。
 *
 * 🔴 为什么这里要重写一遍：`phaseGate` 是 `injector.mjs` 的私有函数（本批不许改该文件），
 *    而「相位门断言」**必须独立于 `planTurnInjections` 计算**——否则就是拿规划器的输出
 *    去校验规划器的输出（循环论证），失去独立证据价值。
 *    判据与 injector.mjs 逐字一致：`except` 命中 → 排除；`phases` 不含 → 排除。
 * @param {{phases?: string[], except?: string[]}|undefined} phase
 * @param {string} current
 * @returns {boolean}
 */
function phaseGateExcludes(phase, current) {
  if (!phase) return false
  if (phase.except?.includes(current)) return true
  if (phase.phases && !phase.phases.includes(current)) return true
  return false
}

async function main() {
  requireEnv()
  const workdir = mkdtempSync(join(tmpdir(), 'snx-multiturn-'))
  const patchPath = join(workdir, 'patch.yml')
  const reportPath = join(workdir, 'report.json')

  writeFileSync(
    patchPath,
    [
      '# S3 集成测试 patch：关掉一进程一 turn 的 headless runner，改挂多 turn driver。',
      '# 🔴 只在 socratic-headless 测试 profile 上用 --patch 临时生效，不写入任何 profile 文件。',
      '# 🔴 socratic-engine 已在 profile 的 bundle 列表里（见 socratic-headless/package.json 的',
      '#    dsh.profile.bundles）→ 这里只能**按 id 覆盖 config**，绝不能再 insert（会 duplicate loader entry id）。',
      '- id: socratic-engine',
      '  config:',
      `    classroomDir: ${CLASSROOM_DIR}`,
      '- id: headless-runner',
      '  disabled: true',
      '- insert:',
      '    - id: socratic-multiturn-driver',
      `      name: ${DRIVER}`,
      '',
    ].join('\n'),
  )

  const task = `${TURNS}|${ACTIVE_PROMPTS.slice(0, TURNS).join('|')}`
  console.log(`[multiturn] promptStyle=${PROMPT_STYLE}`)
  console.log(`[multiturn] classroomDir=${CLASSROOM_DIR}`)
  console.log(`[multiturn] assumedPhase=${ASSUMED_PHASE}${process.env.SOCRATIC_PHASE === undefined ? '（默认；非 fixture 教室请用 SOCRATIC_PHASE= 覆盖）' : ''}`)
  console.log(`[multiturn] turns=${TURNS} workdir=${workdir}`)
  console.log(`[multiturn] task=${JSON.stringify(task)}`)

  const sessionsRoot = join(DSH_HOME, 'sessions')
  const before = newestSessionDir(sessionsRoot)
  console.log(`[multiturn] sessionsRoot=${sessionsRoot}`)
  console.log(`[multiturn] before=${before === null ? '<none>' : before.file}`)

  const child = spawn(process.execPath, [DSH_BIN, '--profile', 'socratic-headless', '--patch', patchPath, task], {
    cwd: workdir,
    env: { ...process.env, SOCRATIC_MULTITURN_REPORT: reportPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  let stdout = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  const code = await new Promise((resolve) => child.on('close', resolve))

  console.log('[multiturn] --- driver stderr ---')
  console.log(stderr.trim())
  console.log(`[multiturn] exit=${code}`)
  check('driver 进程正常退出', code === 0, `exit=${code}`)

  // driver 自己的观测报告（进程内视角）
  let driverReport = null
  try {
    driverReport = JSON.parse(readFileSync(reportPath, 'utf8'))
  } catch (error) {
    check('driver 报告可读', false, error.message)
  }
  if (driverReport !== null) {
    check('进程内观测：turn 数达标', driverReport.turnStarts?.length === TURNS, `turnStarts=${JSON.stringify(driverReport.turnStarts)}`)
    check('同一会话（1 个 sessionId）', driverReport.sessionIdsSeen?.length === 1, JSON.stringify(driverReport.sessionIdsSeen))
  }

  // ── 落盘事件流（真相源）──────────────────────────────────────────────────
  // 用 driver 报告的 sessionId 精确定位我们的日志（同一 $DSH_HOME 上可能有并行会话）。
  const runStartedAt = Date.now() - 10 * 60 * 1000
  const expectedSessionId = driverReport?.sessionId ?? null
  let after = expectedSessionId === null ? null : pickSessionDir(sessionsRoot, expectedSessionId, null)
  if (after === null) {
    after = pickSessionDir(sessionsRoot, null, runStartedAt)
    if (after !== null) {
      check('按 sessionId 精确定位日志', false, `driver 报 ${expectedSessionId ?? '<none>'}，改为按时间取最新 ${after.sessionId}`)
    }
  } else {
    check('按 sessionId 精确定位到本次会话日志', true, after.sessionId)
  }

  if (after === null) {
    check('找到本次运行的落盘 session', false, `${sessionsRoot} 下没有可读日志`)
    return summarize()
  }
  const isNew = before === null || after.file !== before.file
  check('产出的是新 session（不是复用了旧日志）', isNew, `file=${after.file}`)

  const events = readSessionEvents(after.file)
  const { turns, injections, stepsPerTurn } = analyze(events)
  console.log(`[multiturn] 落盘真相：turn/start=${JSON.stringify(turns)}`)
  console.log(`[multiturn] 落盘真相：每 turn 的 step 数=${JSON.stringify(Object.fromEntries(stepsPerTurn))}`)
  console.log(`[multiturn] 落盘真相：socratic-engine 注入 ${injections.length} 条 → ${JSON.stringify(injections)}`)

  check('落盘 turn 数 = 请求轮数', turns.length === TURNS, `got ${turns.length}`)
  check('turn 号连续自 1 起（同一会话多 turn 的判据）', turns.every((t, i) => t === i + 1), JSON.stringify(turns))

  // 🔴 关键：本测试**是否真的走到了「一个 turn 多个 step」**。
  //    走不到 → 去重门与旧判定的差别不可见，本次运行的"通过"是弱证据。
  //    用 PROMPT_STYLE=tools 让 turn 里出现工具调用，才能把这条路走实。
  const multiStepTurns = [...stepsPerTurn.entries()].filter(([, count]) => count > 1)
  if (PROMPT_STYLE === 'tools') {
    check(
      '🔴 本运行真的产生了「一个 turn 多个 step」（去重门的适用场景）',
      multiStepTurns.length > 0,
      multiStepTurns.length > 0
        ? `多 step 的 turn：${JSON.stringify(multiStepTurns)}`
        : `所有 turn 都只有 1 个 step（${JSON.stringify(Object.fromEntries(stepsPerTurn))}）→ 去重门未被真正压到，本次结果只是弱证据`,
    )
  } else {
    console.log(
      `[multiturn] ⚠️ 提示：本次用 plain prompt，各 turn 的 step 数=${JSON.stringify(Object.fromEntries(stepsPerTurn))}；` +
        '若全部为 1，则「多 step 去重」未被真正验证 → 想验它请用 PROMPT_STYLE=tools 重跑。',
    )
  }

  // ── 核心断言：每个 (turn, block) 恰好一次 ────────────────────────────────
  const byTurnBlock = new Map()
  for (const row of injections) {
    const key = `${row.turn}|${row.block}`
    byTurnBlock.set(key, (byTurnBlock.get(key) ?? 0) + 1)
  }
  const duplicated = [...byTurnBlock.entries()].filter(([, count]) => count > 1)
  check(
    '🔴 无 (turn, block) 重复注入（去重核心断言）',
    duplicated.length === 0,
    duplicated.length === 0 ? '每个 (turn, block) 恰好 1 条' : JSON.stringify(duplicated),
  )

  // ── 期望块集合比对 ──────────────────────────────────────────────────────
  const manifest = loadManifest(CLASSROOM_DIR)
  // 🔴 讲次门取值口径与生产 index.mjs 逐字一致（FIX-1 ③ 的第二半）：
  //    有讲次门 → 读 runtime_store 声明的 progress 文件；没有 → null（不读盘，避免误报）。
  const currentLesson = usesLessonGate(manifest) ? readRuntimeLesson(manifest, { baseDir: CLASSROOM_DIR }) : null
  console.log(`[multiturn] 本轮要讲的讲次 = ${currentLesson === null ? '<该教室无讲次门>' : `第 ${currentLesson} 讲`}`)
  // 🔴 `injectedOnce` 必须**跨 turn 累积**（FIX-1 ③ 的第三半，2026-09-24）：
  //    `frequency: once` 的块在一个 session 内只注入一次（injector.mjs 按 `injectedOnce` 判）。
  //    此前每个 turn 都新建空 Set → 期望里每个 turn 都含 `once` 块 → 第 2 个 turn 起必然假失败
  //    （实测：cs-os 的 `story.arc_gate` 在 turn 2 期望有、实际没有，而**实际才是对的**）。
  //    生产 `index.mjs` 的 `phase.injectedOnce` 也是**全程共享**的一个 Set。
  const injectedOnce = new Set()
  for (let turnIndex = 1; turnIndex <= TURNS; turnIndex += 1) {
    const expected = expectedPerTurn(manifest, turnIndex, currentLesson, injectedOnce)
    const actual = injections.filter((r) => r.turn === turnIndex).map((r) => r.block).sort()
    const ok = JSON.stringify(expected) === JSON.stringify(actual)
    check(
      `turn ${turnIndex} 注入块集合 = manifest 计划`,
      ok,
      ok ? `${JSON.stringify(actual)}` : `expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`,
    )
  }

  // ── 频率语义：n_turns 的块不得在非 n 倍数的 turn 出现 ───────────────────
  const nTurnBlocks = manifest.blocks
    .filter((b) => b.position.target === 'chat' && b.frequency.every === 'n_turns')
    .map((b) => b.id)
  if (nTurnBlocks.length > 0) {
    const violations = injections.filter((r) => nTurnBlocks.includes(r.block) && (r.turn ?? 0) % 3 !== 0)
    check(
      'n_turns 块只在其倍数的 turn 出现',
      violations.length === 0,
      violations.length === 0 ? `块 ${nTurnBlocks.join(',')} 均合规` : JSON.stringify(violations),
    )
  }

  // ── 相位门：假定相位下被相位门排除的块不得出现 ───────────────────────────
  //    🔴 相位由 SOCRATIC_PHASE 指定（默认 boot）。断言名里的相位即本次假定值，
  //       避免「拿 boot 的期望去判 cs-os（open）的实际」这种假失败（FIX-1 ③）。
  //    🔴 判据修正（FIX-1 ③ 的第四半，2026-09-24）：旧判据是「**任何**带 phase 门的块出现即违例」，
  //       这对「该相位本来就放行的块」是错的——cs-os 在 `open` 相位下 8 个 `phases:[open]` 的块
  //       **本来就该注入**，旧判据把它们全报成违例（实测 8 条假违例）。
  //       正确判据 = 「被相位门**排除**的块不得出现」。
  const phaseGated = manifest.blocks.filter((b) => b.position.target === 'chat' && b.phase?.phases)
  if (phaseGated.length > 0) {
    const gatedIds = phaseGated.map((b) => b.id)
    const violations = injections.filter(
      (r) => gatedIds.includes(r.block) && phaseGateExcludes(phaseGated.find((b) => b.id === r.block).phase, ASSUMED_PHASE),
    )
    check(
      `被相位门排除的块在 ${ASSUMED_PHASE} 相位不注入`,
      violations.length === 0,
      violations.length === 0
        ? `${gatedIds.length} 个带相位门的块均无违例`
        : JSON.stringify(violations),
    )
  }

  rmSync(workdir, { recursive: true, force: true })
  return summarize()
}

function summarize() {
  const failed = checks.filter((c) => !c.ok)
  console.log('')
  console.log(`[multiturn] 共 ${checks.length} 项断言，通过 ${checks.length - failed.length}，失败 ${failed.length}`)
  if (failed.length > 0) {
    console.log('[multiturn] 失败项：')
    for (const f of failed) console.log(`  ✖ ${f.name} — ${f.detail}`)
  }
  process.exitCode = failed.length === 0 ? 0 : 1
}

await main()
