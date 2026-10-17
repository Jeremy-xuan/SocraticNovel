// probe/idempotency-replay.mjs — 「课后写入幂等」的确定性重放探针（测试基础设施）
//
// 🔴 为什么需要它（而不是只数标记）：
//   `agent/turn-stopping` 在正常路径上**每个 turn 只派发一次**，所以"同一个回合被写两次"
//   在真实会话里**碰不到**——只数标记只能证明"没发生"，不能证明"发生了也会被挡住"。
//   本探针把被测代码**原样拿过来**（冻结副本的 `lib/postclass.mjs`），
//   用**本次运行的真实事件流**造出同一个 turn 的 payload，在两份文件上各做一次实验：
//
//   A · 干净起点重放（--pristine-runtime-dir，取**冻结教室**的 runtime/）：
//       第 1 次 fire 必须写盘；第 2 次 fire（同 sessionId + 同 turn）必须**零字节变化**；
//       写完后 `(session, turn)` 标记恰好 1 个。
//       → 这一步证明"重复结束不会重复追加"是**被门挡住的**，不是"碰巧没发生"。
//   B · 真实结果重放（--postrun-runtime-dir，取**跑完的教室** runtime/）：
//       直接 fire 一次，必须**零字节变化**。
//       → 这一步证明真实会话里那个回合**已经写过了**，再来一次不会追加第二条。
//
// 🔴 它不引入宿主包的第二实例：宿主原子写包用 `createRequire(DSH_BIN)` 从**安装版自己的
//   node_modules** 解析后 `import()`（独立进程，无 Symbol 共享）。

import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, cpSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (!key.startsWith('--')) continue
    out[key.slice(2)] = argv[i + 1]
    i += 1
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const DSH_BIN = args['dsh-bin'] ?? process.env.DSH_BIN
const result = {
  probe: 'idempotency-replay',
  at: new Date().toISOString(),
  inputs: {
    frozenPlugin: args['frozen-plugin'],
    events: args.events,
    sessionId: args['session-id'],
    turn: Number.parseInt(args.turn ?? '', 10),
    pristineRuntimeDir: args['pristine-runtime-dir'] ?? args['runtime-dir'] ?? null,
    postrunRuntimeDir: args['postrun-runtime-dir'] ?? null,
  },
  ok: false,
  phaseA: null,
  phaseB: null,
  error: null,
}

const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

function readEvents(file) {
  const events = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || !trimmed.startsWith('{')) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed !== null && typeof parsed === 'object' && typeof parsed.type === 'string') events.push(parsed)
    } catch {
      continue
    }
  }
  return events
}

async function main() {
  const frozenPlugin = resolve(args['frozen-plugin'])
  const turn = result.inputs.turn
  if (!Number.isInteger(turn)) throw new Error('--turn 必须是整数')
  const sessionId = args['session-id']
  if (!sessionId) throw new Error('--session-id 必填')
  const pristineDir = result.inputs.pristineRuntimeDir
  if (pristineDir === null) throw new Error('--pristine-runtime-dir 必填')

  // ── 1) 真实宿主原子写包（从安装版解析，独立进程，无 Symbol 共享）─────────────
  const require1 = createRequire(DSH_BIN)
  const atomicWritePath = require1.resolve('@deepseek-ai/dsh-atomic-write')
  const io = await import(pathToFileURL(atomicWritePath).href)

  // ── 2) 冻结副本里的被测模块 ────────────────────────────────────────────────
  const postclassPath = join(frozenPlugin, 'lib', 'postclass.mjs')
  if (!existsSync(postclassPath)) throw new Error(`找不到 ${postclassPath}`)
  const postclass = await import(pathToFileURL(postclassPath).href)

  // ── 3) 事件流 → 同一 turn 的真实 payload ───────────────────────────────────
  const events = readEvents(resolve(args.events))
  const facts = postclass.extractTurnFacts(events, { turn })
  result.facts = {
    turn: facts.turn,
    studentTexts: facts.studentTexts,
    toolCalls: facts.toolCalls,
    hasContent: facts.hasContent,
    events: events.length,
    atomicWritePath,
    postclassPath,
  }

  const marker = postclass.turnMarker(sessionId, turn)
  result.marker = { text: marker }
  const fakeAgent = { session: { id: sessionId, snapshotEvents: () => events } }
  const payload = { agent: fakeAgent, turn, signal: { aborted: false } }

  /** 在给定 runtime 目录的**一次性副本**上造出真实的 turn-stopping 处理器。 */
  const makeHandler = (runtimeDir) => {
    const scratch = mkdtempSync(join(tmpdir(), 'accept-idem-'))
    cpSync(resolve(runtimeDir), scratch, { recursive: true })
    const handlers = new Map()
    const fakeCtx = { on: (event, handler) => handlers.set(event, handler) }
    const logs = []
    const reg = postclass.registerPostClass(fakeCtx, {
      runtimeDir: scratch,
      getPhase: () => args.phase ?? null,
      atomicWrite: { writeFileAtomic: io.writeFileAtomic, withFileLock: io.withFileLock },
      log: (...parts) => logs.push(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')),
    })
    const handler = handlers.get('agent/turn-stopping')
    if (typeof handler !== 'function') throw new Error('registerPostClass 没有注册 agent/turn-stopping 处理器')
    return { scratch, handler, logs, reg }
  }

  // ── 阶段 A · 干净起点：第 1 次必须写、第 2 次必须零变化 ─────────────────────
  {
    const h = makeHandler(pristineDir)
    const target = join(h.scratch, 'session_log.md')
    const before = readFileSync(target, 'utf8')
    await h.handler(payload)
    const afterFirst = readFileSync(target, 'utf8')
    await h.handler(payload)
    const afterSecond = readFileSync(target, 'utf8')
    const count = afterSecond.split(marker).length - 1
    result.phaseA = {
      pristineRuntimeDir: resolve(pristineDir),
      registered: h.reg,
      bytesBefore: before.length,
      bytesAfterFirst: afterFirst.length,
      bytesAfterSecond: afterSecond.length,
      sha256Before: sha256File(target),
      fire1Wrote: afterFirst !== before,
      fire2NoChange: afterSecond === afterFirst,
      markerCount: count,
      logs: h.logs,
      addedLines: afterFirst === before ? [] : afterFirst.slice(before.trimEnd().length).split('\n').filter((l) => l !== ''),
    }
    rmSync(h.scratch, { recursive: true, force: true })
  }

  // ── 阶段 B · 真实结果：再 fire 一次必须零变化（那个回合已经写过了）───────────
  if (result.inputs.postrunRuntimeDir !== null) {
    const h = makeHandler(result.inputs.postrunRuntimeDir)
    const target = join(h.scratch, 'session_log.md')
    const before = readFileSync(target, 'utf8')
    await h.handler(payload)
    const after = readFileSync(target, 'utf8')
    const count = after.split(marker).length - 1
    result.phaseB = {
      postrunRuntimeDir: resolve(result.inputs.postrunRuntimeDir),
      bytesBefore: before.length,
      bytesAfter: after.length,
      noChange: after === before,
      markerCount: count,
      logs: h.logs,
    }
    rmSync(h.scratch, { recursive: true, force: true })
  }

  result.verdict = {
    A_fire1Wrote: result.phaseA.fire1Wrote,
    A_fire2Skipped: result.phaseA.fire2NoChange,
    A_markerExactlyOnce: result.phaseA.markerCount === 1,
    B_postrunNoChange: result.phaseB === null ? null : result.phaseB.noChange,
    B_markerExactlyOnce: result.phaseB === null ? null : result.phaseB.markerCount === 1,
  }
  result.ok =
    result.verdict.A_fire1Wrote &&
    result.verdict.A_fire2Skipped &&
    result.verdict.A_markerExactlyOnce &&
    (result.phaseB === null || (result.verdict.B_postrunNoChange && result.verdict.B_markerExactlyOnce))
}

try {
  await main()
} catch (error) {
  result.error = error instanceof Error ? `${error.message}\n${error.stack}` : String(error)
  result.ok = false
}

if (args.out) writeFileSync(resolve(args.out), `${JSON.stringify(result, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ ok: result.ok, verdict: result.verdict ?? null, error: result.error }, null, 2)}\n`)
process.exitCode = result.ok ? 0 : 1
