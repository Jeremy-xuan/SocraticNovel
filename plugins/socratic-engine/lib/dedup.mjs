// lib/dedup.mjs — 「每回合只注入一次」的确定性去重门（P1，2026-09-23）
//
// 目的：把「每个 turn 注入恰好一次」从「依赖 step 号巧合」变成**可证明的幂等门**。
//
// ── 取证依据（见 开源线/DSH定制/取证_S3_headless多turn与注入去重_2026-09-23.md）──
// ① `agent/pre-step` 的 payload 由宿主确定性地带 `{ agent, messages, turn, step, signal }`：
//      tmp/dsh-installed/dsh-agent-loop/lib/index.js:894  dispatch.waterfall("agent/pre-step", { messages, ...position, signal })
//      tmp/dsh-installed/dsh-agent-loop/lib/index.js:937  this.preStep(target, { turn, step })
//      tmp/dsh-installed/dsh-agent/lib/index.js:209      agentEvents(...).waterfall → fused(payload) = { ...payload, agent }
// ② `turn` 号在一个 session 内**唯一、单调**，且**跨 resume 续号不从 1 重来**：
//      tmp/dsh-installed/dsh-agent-loop/lib/index.js:924   const turn = phase.turn + 1
//      tmp/dsh-installed/dsh-agent-loop/lib/index.js:765   stateOf(session, "turnBoundary")?.lastTurn ?? 0
//      （`lastTurn` 由持久化投影从事件日志重放得出 → 全生命期单调）
// ③ `turn/start` / `turn/end` / `step/start` / `step/end` 是宿主官方边界事件；
//      `agent/turn-stopping` 每个 turn 恰好触发一次（可用于状态清理）：
//      tmp/dsh-installed/dsh-agent-loop/lib/index.js:926 / 994 / 951 / 960 / 967
//
// ── 为什么键是 (sessionId, turn) 而不是 step ──
// 旧骨架判定 = `payload.step === 1 && payload.messages.length > 0`（index.mjs:72）。
// 它把「是否注入」与「本次 pre-step 是否 claim 到非空消息批」**耦合**在一起，
// 而这两件事在语义上无关：
//   · step===1 但 claim 为空 → 直接 return next()，不注入、不推进计数（**漏注入**，
//     并让 injector 的 frequency=n_turns（turnCount % n）相位漂移）；
//   · 任何原因导致同一 turn 内 step===1 再次出现 → had 无跨 turn 幂等键 → **双注入**。
// 去重门只看 (sessionId, turn)：同 turn 一律拦，新 turn 一律放，与 messages 是否为空无关。
//
// 🔴 本模块零 DSH 依赖（纯逻辑 + 一个 ctx 事件注册助手），可被单测直接 import，
//    不起宿主、不调 LLM。

/**
 * 去重判定模式。用于**显式暴露**本次判定拿到了多少信息——
 * 绝不把「拿不到 turn 时的退化行为」伪装成同等强度的保证。
 */
export const DEDUP_MODE = Object.freeze({
  /** 首选：拿到了 (sessionId, turn)，保证同 turn 至多放行一次。 */
  TURN: 'turn',
  /** 退化：拿不到可用 turn，只能退回「step === 1 即放行」＝旧骨架语义（**无跨 turn 保证**）。 */
  SEQUENTIAL: 'sequential',
})

/** 退化键：sessionId 缺失或非法时使用，保证门永不抛错打断宿主循环。 */
export const UNKNOWN_SESSION = '<unknown-session>'

/**
 * sessionId 是否可用作去重键的一部分。
 * 只接受非空字符串：sessionId 是 brandString 出来的不透明串（dsh-llm-retry/lib/index.js:8-11
 * 的 brandString 实现就是 `return id`），所以字符串判据足够，不需要 instanceof。
 * @param {unknown} sessionId
 * @returns {boolean}
 */
function usableSessionId(sessionId) {
  return typeof sessionId === 'string' && sessionId.length > 0
}

/**
 * turn 是否可用：非负安全整数。
 * 宿主侧 turn 由 `phase.turn + 1` 自增得出（见取证②），故合法值必为非负整数；
 * 0 不是宿主会产出的 turn（从 1 起），但容许它以免把"第 0 回合"这类外部调用判成非法。
 * @param {unknown} turn
 * @returns {boolean}
 */
function usableTurn(turn) {
  return typeof turn === 'number' && Number.isSafeInteger(turn) && turn >= 0
}

/**
 * 把任意入参归一成对象。默认参数 `= {}` 只覆盖 `undefined`，**不覆盖 `null`**
 * （`shouldInject(null)` 会直接 TypeError）。宿主异常会中断整个 turn，
 * 去重门不该为此付代价，故显式归一。
 * @param {unknown} input
 * @returns {{sessionId?: unknown, turn?: unknown, step?: unknown}}
 */
function normalizeInput(input) {
  return input !== null && typeof input === 'object' ? /** @type {any} */ (input) : {}
}

/**
 * 建一个「每回合只注入一次」的幂等门。
 *
 * 语义（首选路径，mode === 'turn'）：
 *   shouldInject({ sessionId, turn }) 放行 **当且仅当** 该 session 尚未放行过 `turn`，
 *   即 `turn > lastAllowedTurn(sessionId)`。于是
 *     · 同一 turn 内调用 N 次（带工具的 turn = 3 个 step 共 3 次 pre-step）→ 只放行第 1 次；
 *     · 连续 3 个 turn → 各放行 1 次（共 3 次）；
 *     · turn 中断后重试（宿主把 aborted 后的输入改投 next-turn → turn 号 +1）→ 新 turn 正常放行；
 *     · turn 号回退/重放（例如日志重放）→ 拦下，不重复注入。
 *
 * @param {object} [opts]
 * @param {number} [opts.maxSessions] — 最多记忆多少个 session 的游标（默认 64），LRU 淘汰，防无限增长。
 * @param {number} [opts.maxTurnsPerSession] — 单 session 最多记忆多少个已放行 turn（默认 1，取「单调游标」即可，
 *   保留参数仅为可读性；单调游标本身就是 O(1) 内存，不需要 set）。
 * @returns {{
 *   shouldInject(input: {sessionId?: string, turn?: number, step?: number}): {inject: boolean, mode: string, reason: string},
 *   noteTurnEnd(input: {sessionId?: string}): void,
 *   forget(sessionId?: string): boolean,
 *   snapshot(): {sessions: object, stats: object},
 *   readonly stats: object,
 * }}
 */
export function makeDedupGate(opts = {}) {
  const maxSessions = Number.isSafeInteger(opts.maxSessions) && opts.maxSessions > 0 ? opts.maxSessions : 64

  /**
   * sessionId → { lastTurn: number, lastAllowedTurn: number|null, degradedCalls: number }
   * Map 的迭代顺序 = 插入顺序，用于 LRU 淘汰（touch 时先 delete 再 set 即刷新到队尾）。
   * @type {Map<string, {lastTurn:number, lastAllowedTurn:number|null, degradedCalls:number}>}
   */
  const sessions = new Map()

  const stats = { allowed: 0, suppressed: 0, degraded: 0, evicted: 0 }

  function touch(key) {
    const entry = sessions.get(key)
    if (entry === undefined) return undefined
    // 刷新 LRU 位置：删掉再塞回队尾。
    sessions.delete(key)
    sessions.set(key, entry)
    return entry
  }

  function ensure(key) {
    const existing = touch(key)
    if (existing !== undefined) return existing
    const created = { lastTurn: -1, lastAllowedTurn: null, degradedCalls: 0 }
    sessions.set(key, created)
    // LRU 淘汰：队首页（最久未 touch）优先出局。
    while (sessions.size > maxSessions) {
      const oldest = sessions.keys().next()
      if (oldest.done === true) break
      sessions.delete(oldest.value)
      stats.evicted += 1
    }
    return created
  }

  return {
    /**
     * 本回合是否放行注入。
     *
     * 退化策略（🔴 已标风险，见本文件末尾「风险与边界」）：
     *   拿不到可用 turn → mode='sequential'，放行条件退回 `step === 1`
     *   ＝ 旧骨架语义，**没有跨 turn 幂等保证**（同 turn 内多次 step===1 会重复放行）。
     *   每次退化都计进 stats.degraded 并由返回值 mode/reason 显式暴露，便于调用方记日志。
     *
     * 本函数**不抛错**：宿主循环里的异常会中断 turn，去重门不值得付这个代价。
     *
     * @param {{sessionId?: string, turn?: number, step?: number}} input
     * @returns {{inject: boolean, mode: string, reason: string}}
     */
    shouldInject(rawInput = {}) {
      const input = normalizeInput(rawInput)
      const sessionId = input.sessionId
      const turn = input.turn
      const key = usableSessionId(sessionId) ? sessionId : UNKNOWN_SESSION

      if (!usableTurn(turn)) {
        stats.degraded += 1
        const entry = ensure(key)
        entry.degradedCalls += 1
        // 退化：只能把 step 判别交给宿主/调用方，与旧骨架同强度。
        const inject = input.step === 1
        if (inject) stats.allowed += 1
        else stats.suppressed += 1
        return {
          inject,
          mode: DEDUP_MODE.SEQUENTIAL,
          reason: usableSessionId(sessionId) ? 'turn unavailable: degraded to step===1' : 'sessionId and turn unavailable: degraded to step===1',
        }
      }

      const entry = ensure(key)
      entry.lastTurn = Math.max(entry.lastTurn, turn)
      if (entry.lastAllowedTurn !== null && turn <= entry.lastAllowedTurn) {
        stats.suppressed += 1
        return {
          inject: false,
          mode: DEDUP_MODE.TURN,
          reason: `turn ${turn} already injected (last allowed ${entry.lastAllowedTurn})`,
        }
      }
      entry.lastAllowedTurn = turn
      stats.allowed += 1
      return { inject: true, mode: DEDUP_MODE.TURN, reason: `first step of turn ${turn}` }
    },

    /**
     * turn 结束钩子（挂宿主 `agent/turn-stopping`，每 turn 恰好一次）。
     *
     * 🔴 刻意**不删除**该 session 的游标——`lastAllowedTurn` 必须跨 turn 保留才是幂等键。
     * 本钩子只负责刷新 LRU 位置（把仍在活动的 session 留在队尾），使长期不动的
     * session 先被淘汰，从而在「多 session 长跑」下内存有界。
     * @param {{sessionId?: string}} input
     */
    noteTurnEnd(rawInput = {}) {
      const input = normalizeInput(rawInput)
      const key = usableSessionId(input.sessionId) ? input.sessionId : UNKNOWN_SESSION
      touch(key)
    },

    /**
     * 主动忘记一个 session 的游标。只有插件被卸载/换教室这类**语义上重置**的场合才该用；
     * 不能在 turn 边界用（那会破坏幂等）。
     * @param {string} [sessionId]
     * @returns {boolean} 是否确实删掉了一条
     */
    forget(sessionId) {
      const key = usableSessionId(sessionId) ? sessionId : UNKNOWN_SESSION
      return sessions.delete(key)
    },

    /** 只读快照（测试与诊断用；不暴露内部 Map）。 */
    snapshot() {
      const out = {}
      for (const [key, entry] of sessions) {
        out[key] = { ...entry }
      }
      return { sessions: out, stats: { ...stats } }
    },

    /** 只读统计（引用稳定，便于外部持续读取）。 */
    get stats() {
      return stats
    },
  }
}

/**
 * 把门的**清理侧**接到宿主事件上，返回门本身供注入侧使用。
 *
 * 只注册清理（`agent/turn-stopping` 的 LRU 刷新），**不注册 `agent/pre-step`**——
 * 注入判定必须由调用方（index.mjs 的 pre-step 处理器）在同一处完成，
 * 否则「判定」与「注入」会被拆到两个监听器里，顺序由宿主注册序决定，容易读错。
 *
 * 🔴 `agent/turn-stopping` 是 serial 事件、每 turn 一次，证据：
 *    tmp/dsh-installed/dsh-agent-loop/lib/index.js:966-972
 *
 * @param {{on: Function, effect?: Function}} ctx — 宿主插件 context（只用 `on`）
 * @param {object} [opts] — 透传给 makeDedupGate
 * @returns {ReturnType<typeof makeDedupGate>}
 */
export function registerDedup(ctx, opts = {}) {
  const gate = makeDedupGate(opts)
  ctx.on('agent/turn-stopping', (payload) => {
    gate.noteTurnEnd({ sessionId: sessionIdOf(payload) })
  })
  return gate
}

/**
 * 从 `agent/pre-step` / `agent/turn-stopping` 的 payload 里取 sessionId。
 *
 * 形状依据（取证②）：payload 恒带 `agent`（dsh-agent/lib/index.js:209 的 fused），
 * 而 Agent 持有 `session`，Session 持有 `id`。
 * 取不到时返回 `undefined`，由门自己走退化路径（不抛错）。
 *
 * @param {unknown} payload
 * @returns {string|undefined}
 */
export function sessionIdOf(payload) {
  if (payload === null || typeof payload !== 'object') return undefined
  const agent = /** @type {any} */ (payload).agent
  const id = agent?.session?.id
  return usableSessionId(id) ? id : undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// 风险与边界（诚实声明，不粉饰）
//
// R1 · 拿不到 turn 时退化（mode='sequential'）
//     此时放行条件 = `step === 1`，**与旧骨架同强度**：同一 turn 内若 step===1 出现两次仍会双注入。
//     缓解：返回值 mode/reason 显式暴露 + stats.degraded 计数，调用方应记日志。
//     无法在纯逻辑层根治——没有 turn 就没有幂等键。宿主确定性地提供 turn（取证①），
//     故该路径只应在宿主接口变动时出现。
//
// R2 · 插件实例被热重载 / 重新挂载
//     门是内存态；插件重建后 `lastAllowedTurn` 从 null 起，故重载后遇到的第一个 turn
//     会再注入一次（该 turn 此前可能已注入过）。
//     现状按「新实例无记忆，首 turn 放行」处理，属可接受且可预测的行为；
//     唯一更彻底的做法是把游标落进 `ctx.sessionProjections` 状态（跨进程/跨重载重放），
//     但那是 B2（课后状态持久化）的范围，且新增投影键需与同树其他代理协调，本任务不做。
//
// R3 · 子代理（subagent）会话
//     去重键含 sessionId → 每个子代理 session 有自己的游标，各自 per-turn 注入一次。
//     这是「每 session 每 turn 一次」的自然语义，不是过度注入；若产品上不希望教室纪律进
//     子代理，那是**独立的范围过滤需求**，应由 manifest/配置决定，不该混进去重门。
//
// R4 · 并发/重入
//     shouldInject 是同步纯函数式判定（无 await），JS 单线程下同一 microtask 内不可能交错；
//     Map 读改写在一次调用内完成，故同一会话「同时两处调用」= 串行两调，第二次必被拦。
//     已由 test/dedup.test.mjs 的并发/重入用例覆盖。
// ─────────────────────────────────────────────────────────────────────────────
