// lib/injector.mjs — 注入计划器（P1 骨架，纯函数，零 DSH 依赖）
//
// 输入：规范化 manifest blocks ＋ 运行状态（turnCount / phase / injectedOnce / lastN）
// 输出：本回合应注入的 chat 块（已按 manifest 的 wrap 规则包装、render 变量替换）。
// 系统段（target=system）不在这里——它们由 index.mjs 直接注册 section（一次性）。
//
// 实测依据（实测报告_双重注入与回合语义_2026-09-23.md §3）：
// ① 每回合注入 = turn 开始一次（不在 pre-step 每步重注——pre-step 按 step 触发）；
// ② 宿主已注入 AGENTS.md（source kind = agent-instructions）→ manifest 不声明 AGENTS.md；
// ③ 自有注入统一走 source kind 'socratic-engine'。
//
// M2-SCHEMA v0.2（2026-09-24）：新增**讲次门**判定（P0-4）。语义与取值来源见
// lib/manifest.mjs 文件头；本模块只做判定，值由 state.currentLesson 传入
// （引擎在 index.mjs 里从 runtime_store 的 progress 文件读出）。
//
// M3-STATE（2026-09-24）：新增**每讲一次**判定 `frequency: { every: once, anchor: lesson_start }`
// （草案 §2.2 已设计、此前未实现；M2 待确认 C4）。
//   · `once`（不写 anchor / `anchor: session_start`）＝ 进程生命周期内一次（**语义不变**，向后兼容）；
//   · `anchor: lesson_start` ＝ **讲次变化时重新注入一次**（同一讲内只注入一次）。
//   🔴 记账放在 state.injectedLesson（Map：块 id → 上次注入时的讲次），由 lib/phasestore.mjs 持有。
//      "变化"含**变回上一讲**（第 1 讲 → 第 2 讲 → 回第 1 讲时第 1 讲的材料重新在场）——
//      故记的是"上次注入发生在哪一讲"，不是"注入过没有"（Set 做不到这一点）。
//   🔴 不命中不记账：只有**真的注入**了才更新记账（否则相位门挡下的那一次会把额度吃掉）。

import { lessonGateAllows } from './manifest.mjs'

/** 简单 {{var}} 替换（M1 render 骨架子集；缺变量保留原样并记 missing）。 */
export function renderText(text, vars = {}) {
  const missing = []
  const out = text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key])
    missing.push(key)
    return `{{${key}}}`
  })
  return { text: out, missing }
}

/** 按 wrap 规则包装。 */
export function wrapText(text, wrap) {
  if (!wrap || wrap.style === 'none') return text
  // style === 'system-reminder'（M1：宿主自己注入 AGENTS.md 也用这个形态）
  const tag = wrap.tag ?? 'system-reminder'
  return `<${tag}>\n${text.trim()}\n</${tag}>`
}

/**
 * 单块「本回合该不该注入」的**只读**判定（不改任何记账）。
 *
 * 🔴 存在的理由（N 接线，2026-10-21）：动态块（`classroom.yaml` 的 `dynamic:`）要在
 *    **规划之前**知道内容——不该为没到点的块每回合读一遍文件。于是把频率/讲次/相位三道门
 *    抽成这个纯函数：引擎先 `isBlockDue` 判一遍、只给到点的动态块取内容，再交给
 *    `planTurnInjections` 正式规划（**记账只在真的注入之后**，仍由那边负责）。
 * 🔴 判定顺序与报错文案**逐字**沿用原实现（讲次门 → 频率 → 相位门），任何一处语义变化
 *    都会让验收侧 `predictTurnBlocks` 与生产侧分叉（`acceptance/frequency-parity.mjs` 会红）。
 *
 * @param {object} block — parseManifest 产出的规范化块
 * @param {object} state — { turnCount:number, phase:string, injectedOnce?:Set<string>,
 *                            injectedLesson?:Map<string,number>, currentLesson?:number }
 * @returns {boolean}
 */
export function isBlockDue(block, state) {
  if (block?.position?.target !== 'chat') return false

  // 讲次门（M2-SCHEMA v0.2，P0-4）：🔴 不匹配**不得静默**——缺值一律抛错。
  if (block.lesson !== null && block.lesson !== undefined) {
    if (!Number.isInteger(state.currentLesson)) {
      throw new Error(
        `块 ${block.id} 用了 lesson 讲次门，但 state.currentLesson 不是整数` +
          `（得到 ${JSON.stringify(state.currentLesson)}）—— 引擎必须先从 runtime_store 的 progress 文件读出「本轮要讲的讲次」` +
          `（见 lib/manifest.mjs 的 readRuntimeLesson），否则该块会静默不注入`,
      )
    }
    if (!lessonGateAllows(block.lesson, state.currentLesson)) return false
  }

  const { every, n, anchor } = block.frequency
  // 记账表可能还没建（纯函数独立调用）：按"空表"读，绝不就地写。
  const injectedOnce = state.injectedOnce instanceof Set ? state.injectedOnce : null
  const lessonBook = state.injectedLesson instanceof Map ? state.injectedLesson : null

  // 频率裁决
  let inject = false
  if (every === 'once') {
    if (anchor === 'lesson_start') {
      // 每讲一次：讲次变化就重新注入一次。🔴 缺讲次值不得静默（否则换讲后不注入＝静默失效）。
      if (!Number.isInteger(state.currentLesson)) {
        throw new Error(
          `块 ${block.id} 声明了 frequency.anchor: lesson_start（每讲一次），但 state.currentLesson 不是整数` +
            `（得到 ${JSON.stringify(state.currentLesson)}）—— 讲次变化是它的唯一触发条件，` +
            `没有讲次值它就无法判定（会静默不注入）`,
        )
      }
      inject = (lessonBook?.get(block.id) ?? undefined) !== state.currentLesson
    } else {
      // anchor 缺省 / session_start：进程生命周期内一次（既有语义，未变）
      inject = injectedOnce === null || !injectedOnce.has(block.id)
    }
  } else if (every === 'turn') {
    inject = true
  } else if (every === 'n_turns') {
    inject = state.turnCount % n === 0
  } else if (every === 'phase') {
    inject = phaseGate(block.phase, state.phase)
  } else if (every === 'on_demand') {
    inject = false // 工具/相位触发路径（TODO：M3 工具接入）
  }
  if (!inject) return false

  // 相位门（与 frequency.phase 可叠加：phase 门存在时必须通过）
  if (block.phase && !phaseGate(block.phase, state.phase)) return false
  return true
}

/**
 * 计算本回合应注入的 chat 块。
 * @param {object[]} blocks — parseManifest 产出的规范化 blocks（只处理 position.target==='chat'）
 * @param {object} state — { turnCount:number, phase:string, injectedOnce:Set<string>,
 *                            injectedLesson?:Map<string,number>, currentLesson?:number }
 * @param {object} [vars] — render 变量（骨架默认：phase/turn/classroom）
 * @returns {{id:string, text:string}[]} 本回合注入清单
 */
export function planTurnInjections(blocks, state, vars = {}) {
  const fullVars = { phase: state.phase, turn: state.turnCount, ...vars }
  // 每讲一次的记账表：由 lib/phasestore.mjs 持有并跨回合共享。
  // 🔴 调用方没传时**就地补一个**，只为让纯函数单测能单独调一次；引擎侧永远传真的那张表
  //    （见 index.mjs 的 `{ ...phase, currentLesson }`）。
  if (!(state.injectedLesson instanceof Map)) state.injectedLesson = new Map()
  const lessonBook = state.injectedLesson
  const due = []
  for (const block of blocks) {
    if (!isBlockDue(block, state)) continue

    // render
    let text = block.text
    if (block.render?.enabled) {
      const r = renderText(text, fullVars)
      text = r.text
      // missing 变量：骨架先放行（B2 待拍板：error 还是 default）
    }
    due.push({ id: block.id, text: wrapText(text, block.wrap) })
    // 🔴 记账只在**真的注入**之后（频率/相位/讲次三道门都在 isBlockDue 里）
    const { every, anchor } = block.frequency
    if (every === 'once') {
      if (anchor === 'lesson_start') lessonBook.set(block.id, state.currentLesson)
      else state.injectedOnce.add(block.id)
    }
  }
  return due
}

function phaseGate(phase, current) {
  if (!phase) return true
  if (phase.except?.includes(current)) return false
  if (phase.phases && !phase.phases.includes(current)) return false
  return true
}
