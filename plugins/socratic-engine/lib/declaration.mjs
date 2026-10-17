// lib/declaration.mjs — EXPR-5：**部署声明**（教室面板与教学引擎读的同一份）
//
// ── 要解决的问题（EXPR-4 §2.4／§8 第 3 条如实报过）─────────────────────────
// 面板按 `__DSH_CLASSROOM_UI_CONFIG__.root`（缺省＝代码里的常量）读教室文件；
// 引擎按 `config.classroomDir`（缺省＝工作区里自动发现）写 `runtime/expression.md`。
// **两边指不同目录时没有任何一处会出声**：引擎照写、面板照读（读不到就显示"还没有表情"），
// 表现是"引擎写了但面板看不到"，而日志与画面都不说这是配置错。
//
// ── 做法：一处声明 ＋ 两侧各自机核 ────────────────────────────────────────
// 声明文件（`classroom.config.json`，本线放在 `clients/classroom-ui/` 里）同时声明两件事：
//   · `classroomRoot`  —— 教室包在工作区里的相对路径（**面板读它、引擎按它核对**）
//   · `portraitModel`  —— 立绘模型名（**两侧都读它**，见 §③：改模型名从"2 处手工对齐"变"1 处"）
// 引擎装载时读它，并把「我实际装载/写盘的教室目录」与「声明里的教室目录」做 **realpath 逐字比较**；
// 不一致 → **一条带修法的响亮日志**（不静默）。面板那一侧做同一件事（见 lib/client.js）。
//
// 🔴 为什么比较要 realpath：macOS 上 `/tmp` 是 `/private/tmp` 的符号链接，
//    词法比较会把同一个目录判成两个（lib/discovery.mjs 的 FIX-1 已踩过这个坑）。
//
// 🔴 为什么引擎**不**用声明里的教室目录去覆盖发现结果：发现逻辑（explicit > convention > deep）
//    是 S2 的既有契约，本模块**只核对、不改写**它。声明不一致时报出来，由人决定改哪一处。

import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

/** 声明文件的固定文件名（与 `clients/classroom-ui/classroom.config.json` 同名）。 */
export const DECLARATION_FILENAME = 'classroom.config.json'

/**
 * 解析声明 JSON（**纯函数**，不碰盘：测试直接喂字符串）。
 * 读不到的东西一律 `null` ＋ 原因，**绝不填默认值**（静默的默认值会把配置漂移藏起来）。
 * @param {string} text - 声明文件全文
 * @returns {{ok:boolean, reason:string|null, classroomRoot:string|null, portraitModel:string|null}}
 */
export function parseDeclaration(text) {
  const fail = (reason) => ({ ok: false, reason, classroomRoot: null, portraitModel: null })
  let raw
  try {
    raw = JSON.parse(text)
  } catch (cause) {
    return fail(`不是合法 JSON（${cause?.message ?? cause}）`)
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fail('顶层必须是对象')
  const root = raw.classroomRoot
  if (typeof root !== 'string' || root.trim() === '') return fail('缺 `classroomRoot`（字符串：教室包在工作区里的相对路径）')
  if (isAbsolute(root)) {
    // 面板只能读**工作区相对**路径（`workspaceFiles` 的语义），所以声明里不许写绝对路径。
    return fail(`\`classroomRoot\` 必须是**工作区相对**路径（得到绝对路径 ${JSON.stringify(root)}）：面板只能按工作区相对路径读文件`)
  }
  const model = raw.portraitModel
  if (typeof model !== 'string' || model.trim() === '') return fail('缺 `portraitModel`（字符串：立绘模型名，如 Haru）')
  return { ok: true, reason: null, classroomRoot: normalizeRelative(root), portraitModel: model.trim() }
}

/** 归一一条工作区相对路径：去首尾空白、去 `./` 前缀、去尾斜杠（**只做词法归一，不 realpath**）。 */
export function normalizeRelative(value) {
  let out = String(value).trim().replace(/^\.\//, '')
  while (out.endsWith('/') && out.length > 1) out = out.slice(0, -1)
  return out
}

/**
 * 读声明并核对「引擎装载的教室目录」是否就是「声明里的那个」。
 * 任何失败都不抛：返回结构化结果，由调用方决定怎么说（本项目的口径：出声，但不打断会话）。
 * @param {object} opts
 * @param {string} [opts.file] - `config.classroomDeclaration`（**绝对路径**）
 * @param {string} opts.workspaceRoot - 本次发现用的工作区根（`discovery.workspaceRoot()`）
 * @param {string} [opts.classroomDir] - 引擎实际装载的教室目录（绝对路径）
 * @param {object} [opts.fs] - 可注入的 `{readFile, realpath}`（测试用）
 * @returns {Promise<object>} 见下方 `state` 的字段
 */
export async function loadDeclaration(opts = {}) {
  const io = opts.fs ?? { readFile, realpath }
  const file = typeof opts.file === 'string' && opts.file !== '' ? opts.file : null
  const state = {
    configured: file !== null,
    ok: false,
    file,
    reason: null,
    classroomRoot: null,
    portraitModel: null,
    declaredDirAbs: null,
    classroomDirAbs: null,
    rootMatches: null,
    sameModelAsConfig: null,
  }
  if (file === null) {
    state.reason = '未配置 config.classroomDeclaration → 本引擎与面板的「同一目录」这件事**没有机核**'
    return state
  }
  if (!isAbsolute(file)) {
    // 与 capabilityFile 同一口径：相对路径会静默指向别处，故当场判失败（不抛：装载期不打断会话）。
    state.reason = `config.classroomDeclaration 必须是**绝对路径**（得到 ${JSON.stringify(file)}）：引擎没有可靠的工作区根可作基准，相对路径会静默指向别处`
    return state
  }
  let text
  try {
    text = await io.readFile(file, 'utf8')
  } catch (cause) {
    state.reason = `读不到部署声明 ${file}（${cause?.code ?? cause?.message ?? cause}）`
    return state
  }
  const parsed = parseDeclaration(text)
  if (!parsed.ok) {
    state.reason = `部署声明 ${file} 不可用：${parsed.reason}`
    return state
  }
  state.classroomRoot = parsed.classroomRoot
  state.portraitModel = parsed.portraitModel
  const workspaceRoot = typeof opts.workspaceRoot === 'string' && opts.workspaceRoot !== '' ? opts.workspaceRoot : null
  if (workspaceRoot === null) {
    state.reason = '求不到工作区根 → 声明里的相对路径无从解析，一致性未核'
    return state
  }
  try {
    state.declaredDirAbs = await io.realpath(resolve(workspaceRoot, parsed.classroomRoot))
  } catch (cause) {
    state.reason = `声明里的教室目录 ${join(workspaceRoot, parsed.classroomRoot)} 不存在（${cause?.code ?? cause?.message ?? cause}）`
    return state
  }
  if (typeof opts.classroomDir !== 'string' || opts.classroomDir === '') {
    state.reason = '引擎还没装载任何教室 → 无从核对'
    return state
  }
  try {
    state.classroomDirAbs = await io.realpath(opts.classroomDir)
  } catch (cause) {
    state.reason = `引擎装载的教室目录 ${opts.classroomDir} 取不到真实路径（${cause?.code ?? cause?.message ?? cause}）`
    return state
  }
  state.ok = true
  state.rootMatches = state.declaredDirAbs === state.classroomDirAbs
  return state
}

/**
 * 把 `loadDeclaration()` 的结果翻成**日志行**（装载期就落盘，带"怎么改"）。
 * 🔴 一致性不成立时**必须**出声：这是"引擎写了但面板看不到"那条静默失效的唯一防线。
 * @param {object} state - `loadDeclaration()` 的返回值
 * @param {string} [configModel] - `config.expression.model`（若同时配了，一并核对；声明优先）
 * @returns {string[]} 逐行日志（调用方按自己的 logger 逐条打）
 */
export function describeDeclaration(state, configModel) {
  if (state.configured !== true) return [`部署声明：${state.reason}`]
  if (state.ok !== true) {
    return [
      `🔴 部署一致性**没核成**：${state.reason}`,
      `   → 修法：确认 ${state.file} 存在、是合法 JSON、含 classroomRoot（工作区相对）与 portraitModel；` +
        '或把它所在的 profile 配置改对（socratic-engine 的 config.classroomDeclaration，绝对路径）。',
    ]
  }
  const lines = []
  if (state.rootMatches === true) {
    lines.push(`部署声明：教室目录两侧同一路径（${state.classroomRoot}）`)
  } else {
    lines.push(
      `🔴 部署声明不一致 —— **引擎写盘 / 面板读盘不是同一个目录**：` +
        `引擎装载的是 ${state.classroomDirAbs}，声明里的教室是 ${state.declaredDirAbs}（${state.classroomRoot}）。` +
        '后果：引擎照写 runtime/expression.md，而面板读的是另一个目录 → **引擎写了但面板看不到**（不报错）。',
    )
    lines.push(
      `   → 修法（改一处即可）：① 若确实要用现在这个教室：把 ${state.file} 的 classroomRoot 改成这个目录的工作区相对路径；` +
        '② 若要用声明里的那个教室：去掉 --patch／profile 里的 config.classroomDir（让它按声明/自动发现装载）；' +
        '③ 面板侧也要指同一个目录（`__DSH_CLASSROOM_UI_CONFIG__.root` 不设＝用声明）。',
    )
  }
  lines.push(`部署声明：立绘模型 ${state.portraitModel}（两侧都读这一处）`)
  if (typeof configModel === 'string' && configModel !== '' && configModel !== state.portraitModel) {
    lines.push(
      `🔴 config.expression.model=${JSON.stringify(configModel)} 与部署声明的 portraitModel=${JSON.stringify(state.portraitModel)} 不一致：` +
        '**以声明为准**（一处声明、两侧读）→ 请把 config.expression.model 删掉，只改声明。',
    )
  }
  return lines
}
