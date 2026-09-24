// lib/phasestore.mjs — 相位与回合状态（P1 骨架存根）
//
// 🔴 设计纪律（实测报告 §2-3）：不依赖宿主 turn 号算术（T2 跨 turn 语义未测）。
// 本模块自维护计数：宿主 'agent/pre-step' 每次触发时由 index.mjs 判定
// "本 turn 的第一个 step"（step===1 && 消息批非空）并调 noteTurnStart()。
// ⚠️ 上述「step===1 && 消息批非空」前提**已被 S3 取证推翻**（改为 (sessionId,turn) 幂等门，
//    见 lib/dedup.mjs 与 index.mjs）；本注释保留原文，未随接线改写。
//
// TODO（P1 正式版）：相位持久化走 ctx.sessionProjections（L5 已核：核心机制，
// agent-loop/src/agent.ts；持久化/回放/崩溃恢复官方原生）——骨架先用内存态，
// 因为 sessionProjections 的注册 API 需要一次集成实测再接（诚实边界，不瞎写）。
//
// ── M3-STATE（2026-09-24）相位推进的裁定与落点 ──────────────────────────────
// 🔴 推进方式：**不由引擎按规则推进**（草案的 `phase.advance_on` 已裁定不做，写了会报错）。
//    改由教师在课堂上调用 `classroom_set_phase` 工具宣布 → 本模块的 `setPhase()` 是唯一入口，
//    index.mjs 的工具体调用它。引擎只负责**记录 + 按相位门控注入**。
// 🔴 状态的落点（草案 §2.0 只说 `runtime_store` 是"模板变量与相位状态的来源"，未写死字段名）：
//    ① **会话内真源 = 本模块的内存态**（`phase` 闭包变量）——跨回合不丢，`classroom_status` 可见；
//    ② **落盘镜像 = runtime_store.progress 文件里的 `current_phase: <id>` 行**
//       （读：lib/manifest.mjs 的 readRuntimePhase；写：index.mjs 的 classroom_set_phase）。
//       → 换一个会话也能接上；教室未声明 runtime_store 时退化为纯内存态。
//    字段名 `current_phase` 由引擎定（草案未写实）——见实现报告待确认清单。

// 🔴 P0-1 修复（2026-09-23）：相位值域**不再在本模块硬编码**。
//   值域由调用方从 manifest 传入（顶层 `phases:` 声明，顺序即推进顺序；
//   见 lib/manifest.mjs 的 phaseDomainOf / defaultPhaseOf）。
//   `PHASES` 保留为 **legacy 显式命名回退**：manifest 未声明顶层 `phases:` 时，
//   index.mjs 会传入 manifest.mjs 的 LEGACY_PHASES；直接调 createPhaseStore() 的
//   纯逻辑调用方（既有单测）也仍拿到这套旧值域。
import { LEGACY_PHASES } from './manifest.mjs'
export { LEGACY_PHASES as PHASES } from './manifest.mjs'

/**
 * @param {string|{domain?: string[], initialPhase?: string}} [initialPhaseOrOptions]
 *   兼容旧签名（相位名字符串）与 options 形态 `{ domain, initialPhase }`。
 * @param {{domain?: string[]}} [maybeOptions]
 */
export function createPhaseStore(initialPhaseOrOptions = undefined, maybeOptions = undefined) {
  const isOptions = initialPhaseOrOptions !== null && typeof initialPhaseOrOptions === 'object'
  const opts = isOptions ? initialPhaseOrOptions : (maybeOptions ?? {})
  const domain = Array.isArray(opts.domain) && opts.domain.length > 0 ? [...opts.domain] : [...LEGACY_PHASES]
  const initial = isOptions ? opts.initialPhase : initialPhaseOrOptions
  const start = initial === undefined || initial === null || initial === '' ? domain[0] : initial

  if (!domain.includes(start)) {
    throw new Error(`未知相位：${start}（可用：${domain.join('/')}）`)
  }

  let phase = start
  let turnCount = 0
  const injectedOnce = new Set()
  // M3-STATE：`frequency.anchor: lesson_start` 的记账（块 id → 上次注入时的讲次）。
  // 🔴 为什么不是"块 id 集合"：讲次**变回去**也算变化（第 1 讲 → 第 2 讲 → 回第 1 讲时，
  //    第 1 讲的材料必须重新在场）。所以记的是「上次注入发生在哪一讲」，而不是"注入过"。
  const injectedLesson = new Map()

  return {
    /** 本次生效的相位值域（有序）。 */
    get domain() {
      return [...domain]
    },
    get phase() {
      return phase
    },
    /**
     * 切换相位。🔴 取值必须落在值域内，否则抛错并**列出合法 id**（不静默忽略）。
     * @param {string} next
     * @returns {string} 切换后的相位（＝ next）
     */
    setPhase(next) {
      if (!domain.includes(next)) {
        throw new Error(
          `未知相位：${JSON.stringify(next)}（可用：${domain.join('/')}）—— ` +
            `相位取值必须来自本教室 classroom.yaml 顶层 phases 声明`,
        )
      }
      phase = next
      return phase
    },
    get turnCount() {
      return turnCount
    },
    noteTurnStart() {
      turnCount += 1
    },
    /** 注入引擎内部状态（injectedOnce 由 injector 共享）。 */
    get injectedOnce() {
      return injectedOnce
    },
    /** 每讲一次（`anchor: lesson_start`）的记账表，由 injector 共享。 */
    get injectedLesson() {
      return injectedLesson
    },
    snapshot() {
      // 🔴 形态**保持 M2 原样**（`test/injector.test.mjs` 用 deepEqual 钉着它，不改既有断言）。
      //    每讲一次的记账走上面的 `injectedLesson` getter 读（引擎与单测都从那里取）。
      return { phase, turnCount, onceDone: [...injectedOnce] }
    },
  }
}
