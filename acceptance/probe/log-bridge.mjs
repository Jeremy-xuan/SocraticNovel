// probe/log-bridge.mjs — 「静默失败检查」的日志桥 ＋ 调用形状运行时探针（测试基础设施）
//
// 🔴 它解决的问题：headless profile 里 **cordis 的日志默认不落任何地方**。
//   证据（安装版源码）：
//     · cordis `LoggerService` 构造时只注册一个 exporter，做的事是
//       `self.buffer.push(message)`（内存环形缓冲，1000 条）——**不打印**。
//       `@deepseek-ai/cordis/lib/index.js:588-601`
//     · 全安装版里注册 exporter 的只有 web 前端
//       （`grep -rl "logger.exporter" <app>/node_modules/@deepseek-ai/` → 只有 cordis 自己与 dsh-web-frontend 的 dist）
//     · 各 bundle 的 cordis.patch.yml 里**没有任何 logger 行**（实测 grep 零命中）
//   → 所以"插件有没有把错误吞掉"在默认 headless 里**根本看不见**。
//     本插件注册一个自己的 exporter（**放开 level 门**，见下），把日志落到文件，
//     让"有没有该有的报错"变成可判定的。
//
// 🔴 第二个坑（第一版探针踩到）：exporter 的 level 门。
//   `Logger._method` 里：`if ((exporter.levels?.[name] ?? exporter.levels?.default ?? this.level ?? 1) < level) continue`
//   —— 不显式给 `levels` 时门限是 **1**，于是 `info`(1) 能过、`warn`(2)/`debug`(3) **被静默过滤**。
//   本桥显式 `levels: { default: 3 }`，把所有级别都收下来，避免"桥没收到"被误读成"没人记日志"。
//
// 🔴 第三个坑：调用形状。
//   cordis 的 `ctx.logger` 是**可调用的服务对象**：`ctx.logger(name)` 返回一个具名 Logger
//   （`LoggerService[symbols.invoke](name)`，`@deepseek-ai/cordis/lib/index.js:625-641`），
//   **它只接受 name 一个参数**。
//   正确用法（安装版自己的用法）：`ctx.logger("loader").warn(msg, ...args)`
//     —— `@deepseek-ai/dsh-app-boot/lib/index.js:202`
//   错误用法：`ctx.logger("name", ...args)` —— 其余参数被丢弃，返回的 Logger 被抛弃。
//   本探针在**运行时**同时做这两种调用，用"日志桥里收到几条"来判定（不靠读源码下结论）。

import { appendFileSync, writeFileSync } from 'node:fs'

export const name = 'socratic-accept-log-bridge'

export function apply(ctx) {
  const logFile = process.env.ACCEPT_LOG_FILE ?? ''
  const probeFile = process.env.ACCEPT_LOG_PROBE ?? ''
  const received = []

  const bridgeAvailable = typeof ctx.logger?.exporter === 'function'
  if (bridgeAvailable && logFile !== '') {
    ctx.logger.exporter({
      colors: 0,
      // 🔴 必须显式放开：不给 levels 时门限是 1，warn/debug 会被静默过滤
      levels: { default: 3 },
      export: (message) => {
        const row = {
          sn: message.sn,
          ts: message.ts,
          type: message.type,
          level: message.level,
          name: message.name,
          args: (message.args ?? []).map((a) => {
            if (a instanceof Error) return { error: a.message, stack: String(a.stack ?? '').slice(0, 1500) }
            if (typeof a === 'object' && a !== null) {
              try {
                return JSON.parse(JSON.stringify(a))
              } catch {
                return String(a)
              }
            }
            return a
          }),
        }
        received.push(row)
        try {
          appendFileSync(logFile, `${JSON.stringify(row)}\n`)
        } catch {
          /* 桥自己的写失败不能反过来影响会话 */
        }
      },
    })
  }

  const probe = {
    at: new Date().toISOString(),
    loggerDefined: ctx.logger !== undefined && ctx.logger !== null,
    loggerType: typeof ctx.logger,
    exporterMethodAvailable: bridgeAvailable,
    exporterLevels: { default: 3 },
    logFile,
    positiveControl: null,
    engineShape: null,
  }

  // ── 正向对照：**正确调用形状**，三个级别各来一条，必须全部被桥收到 ────────────
  const CONTROL_NAME = '[socratic-accept-probe:positive-control]'
  const control = { shape: 'ctx.logger(name).<level>(text)', controlName: CONTROL_NAME, byLevel: {} }
  for (const level of ['error', 'info', 'warn']) {
    try {
      ctx.logger(CONTROL_NAME)[level](`正向对照 ${level}：这条形状应当出现在日志桥里`)
      control.byLevel[level] = received.filter((r) => r.name === CONTROL_NAME && r.type === level).length
    } catch (error) {
      control.byLevel[level] = `抛错：${error?.message ?? error}`
    }
  }
  control.received = received.filter((r) => r.name === CONTROL_NAME).length
  probe.positiveControl = control

  // ── 被测形状：引擎 index.mjs 里 `log()` 用的那一条 ─────────────────────────
  //   index.mjs:50-56  `const log = (...args) => { ctx.logger?.('[socratic-engine]', ...args) }`
  const ENGINE_SHAPE_NAME = '[socratic-engine]'
  const ENGINE_SHAPE_TEXT = '被测形状：这段文字在引擎的调用形状下应当被丢掉'
  try {
    const returned = ctx.logger(ENGINE_SHAPE_NAME, ENGINE_SHAPE_TEXT)
    probe.engineShape = {
      shape: "ctx.logger('[socratic-engine]', ...args)",
      returnedType: typeof returned,
      returnedConstructor: returned?.constructor?.name ?? null,
      returnedHasWarn: typeof returned?.warn === 'function',
      received: received.filter((r) => r.name === ENGINE_SHAPE_NAME).length,
      note:
        'received=0 而正向对照 received>0 ⇒ 这条形状只创建了一个具名 Logger 并丢弃全部参数' +
        '（cordis 的 ctx.logger(name) 只接受 name 一个参数）',
    }
    // 反证：同一级别、同一出口，只要形状对就能收到
    ctx.logger(`${ENGINE_SHAPE_NAME}:shape-control`).warn(ENGINE_SHAPE_TEXT)
    probe.engineShape.shapeControlReceived = received.filter((r) => r.name === `${ENGINE_SHAPE_NAME}:shape-control`).length
  } catch (error) {
    probe.engineShape = { shape: "ctx.logger('[socratic-engine]', ...args)", error: String(error?.message ?? error) }
  }

  probe.receivedCountAtProbeTime = received.length
  probe.receivedNamesAtProbeTime = [...new Set(received.map((r) => r.name))]

  // ── 🔴 ACCEPT-2 负向对照（故意制造一条**不在白名单里**的宿主告警）────────────────
  //   为什么要有它：A6.5 是"宿主告警里出现非白名单新条目 → 判失败"的断言。
  //   一条只会在"白名单全覆盖"时通过的断言，必须**被证明它真的会红**——
  //   否则它可能只是一条永远为真的空断言。
  //   做法：只在显式打开开关时（`ACCEPT_NEGATIVE_CONTROL=1`）打一条特定模块名的 warn，
  //   模块名 `[socratic-accept-probe:negative-control]` **不在** lib/whitelist.mjs 里
  //   → A6.5 必须因此失败。撤掉开关后必须回绿。
  //   ⚠️ 这是**测试脚手架**，不是回退逻辑：默认关闭，正常验收路径一行都不打。
  const NEGATIVE_CONTROL_NAME = '[socratic-accept-probe:negative-control]'
  const negativeControlEnabled = process.env.ACCEPT_NEGATIVE_CONTROL === '1'
  probe.negativeControl = {
    enabled: negativeControlEnabled,
    controlName: NEGATIVE_CONTROL_NAME,
    emitted: 0,
    note: 'ACCEPT-2：显式开关下故意打一条不在白名单里的宿主告警，用来证明 A6.5 真的会红',
  }
  if (negativeControlEnabled) {
    try {
      ctx.logger(NEGATIVE_CONTROL_NAME).warn('ACCEPT-2 负向对照：这条不在白名单里，A6.5 应当因此判失败')
      probe.negativeControl.emitted = received.filter((r) => r.name === NEGATIVE_CONTROL_NAME).length
    } catch (error) {
      probe.negativeControl.error = String(error?.message ?? error)
    }
  }

  if (probeFile !== '') {
    try {
      writeFileSync(probeFile, `${JSON.stringify(probe, null, 2)}\n`)
    } catch {
      /* 探针落盘失败不影响会话 */
    }
  }
  process.stderr.write(`[accept-log-bridge] ${JSON.stringify({ bridgeAvailable, received: received.length })}\n`)
}
