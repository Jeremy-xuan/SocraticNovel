// lib/animation.mjs — ACCEPT-3：给验收流水线的**专用 profile** 配好教学动画的渲染环境
//
// 🔴 为什么必须有这个模块：
//   引擎的设计是：**教室声明了动画、但部署没配渲染环境 → 装载时直接报错**（有意为之，
//   不静默降级成"没有动画"）。而本流水线每次从 shipped 模板**重建**专用 profile
//   → profile 里没有任何动画配置 → 只要教室声明了 `animation:`，装载阶段就会直接抛
//   ManifestError，整条流水线跑不起来。
//   🔴 所以本模块**先问教室有没有声明**（`classroomDeclaresAnimation`）：没声明就什么都不做
//      （引擎根本不走那条自检路径）；声明了才要求把渲染环境配上，配不上就大声失败。
//      旧版把"教室声明了动画"写死成前提 —— 那是**原仓库的状态**，不是仓库的约定。
//
// 🔴 两条口径（本模块的全部设计）：
//   ① **路径必须来自部署方，不许硬编码**：渲染环境在哪个 python/manim、闸门脚本在哪，
//      都是"这台机器上的事实"。硬编码会在换机器/换目录时静默指向错的东西。
//      → 两个环境变量：`SOCRATIC_ANIMATION_ENV_DIR` 与 `SOCRATIC_ANIMATION_GATE`
//        （值可以是绝对路径，也可以是仓库相对路径，相对路径按仓库根解析）。
//   ② **配不上时不许静默跳过**（二选一，必须由人显式选）：
//      a) 默认：**大声失败**，并打印"怎么把渲染环境指过来"的可照做指引；
//      b) `--disable-classroom-animation --animation-disable-reason <理由>`：
//         显式地把**工作副本**教室的 `animation:` 段整段删掉（教室源码一个字不动），
//         并把"删了哪几行、原文件与改后文件的 sha256、理由"全部落盘留痕。
//      🔴 绝不允许"配不上就自己关掉"——那正是引擎刻意不做的静默降级。
//
// 🔴 另一条必须写在这里的坑（实测确认，见 accept.mjs 阶段③的注释）：
//   profile 的 `cordis.patch.yml` 与 `--patch` 覆盖层都是**整个 config 对象替换**
//   （`@deepseek-ai/dsh-app-boot` 的 `applyEntryPatches`：`target[key] = value`，不做深合并）。
//   → 会话期那条 `- id: socratic-engine / config: {classroomDir: …}` 的 overlay 会把
//     profile 里的 `animation:` **整块抹掉**。所以配置要写**两处**：
//     profile 的 patch 文件（装载阶段，让人能直接看到"这个 profile 配了什么"）
//     ＋ 会话期的 `--patch` overlay（真正生效的那一处）。两处都出自本模块的同一个结果。

import { createHash } from 'node:crypto'
import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 🔴 ACCEPT-4：显式降级要改**工作副本**教室的 classroom.yaml —— 那是写盘，必须记进写足迹 ledger
import { ledgerWriteFile } from './footprint.mjs'

/**
 * 🔴 渲染环境的位置由**环境变量**给出（不猜、不写死）。
 *
 * 为什么不能像别的路径那样"按仓库相对路径拼"：渲染环境（一个装了 manim 的 venv）与闸门脚本
 * 是**部署侧的事实**，不进本仓库（venv 里有二进制、有平台相关的 site-packages，本就不该入库）。
 * 仓库里只可能有"约定位置"的猜测，而猜测会在换机器时**静默指向错的东西** —— 那正是本模块
 * 一开始要避免的（旧版把仓库相对路径写死在源码里，等于把某台机器的目录结构当成了规范）。
 *
 * 认**两套变量名**（同一批事实的两种写法，谁先命中用谁）：
 *
 * | 本流水线的写法 | 引擎自己的写法（`plugins/socratic-engine` 装载期读的那套） |
 * |---|---|
 * | `SOCRATIC_ANIMATION_ENV_DIR`（venv 的 `bin/`，里面有 `python` 与 `manim`） | — |
 * | — | `SOCRATIC_ANIMATION_PYTHON`（python 的**完整路径**） |
 * | — | `SOCRATIC_ANIMATION_MANIM`（manim 的**完整路径**） |
 * | `SOCRATIC_ANIMATION_GATE` | `SOCRATIC_ANIMATION_GATE` |
 *
 * 🔴 为什么要认引擎那套：引擎装载期自己会读 `SOCRATIC_ANIMATION_PYTHON/MANIM/GATE`。
 *    如果只认本流水线那套，就会出现"按引擎文档配好了、引擎也认，但流水线说没配 → 判红"
 *    这种**两边不一致**的假红。值可以是绝对路径，也可以是**仓库相对**路径（按仓库根解析）。
 */
export const ANIMATION_ENV_DIR_ENV = 'SOCRATIC_ANIMATION_ENV_DIR'
export const ANIMATION_GATE_ENV = 'SOCRATIC_ANIMATION_GATE'
export const ENGINE_ANIMATION_PYTHON_ENV = 'SOCRATIC_ANIMATION_PYTHON'
export const ENGINE_ANIMATION_MANIM_ENV = 'SOCRATIC_ANIMATION_MANIM'

/** 画质档：与参考 profile（socratic-headless）逐字一致。 */
export const ANIMATION_QUALITY = 'l'

/**
 * 从本文件位置往上找**主仓库根**（同时含 `classrooms/` 与 `plugins/` 的那一层）。
 * 🔴 不靠 cwd：流水线可能从任何目录被启动。
 * @param {string} fromDir - 起始目录（本模块自己的目录）
 * @returns {string|null}
 */
export function findRepoRoot(fromDir) {
  let dir = resolve(fromDir)
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, 'classrooms')) && existsSync(join(dir, 'plugins'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * 🔴 教室**有没有声明** `animation:` 段（顶层键）。
 *
 * 为什么必须先问这一句：引擎的判据是「教室声明了动画、但部署没配渲染环境 → **装载时报错**」。
 * 反过来，**教室没声明动画时引擎根本不走那条自检路径**，此时"渲染环境没配"不是缺陷。
 * 旧版把"教室声明了动画"当成**前提**写死（它在原仓库里确实成立），
 * 于是换到教室还没声明动画的仓库上时，流水线会**为一件不存在的事**大声失败。
 * → 这里按教室 manifest 的**实际内容**判，而不是按"原仓库长什么样"判。
 *
 * @param {string} classroomDir
 * @returns {{declared:boolean, file:string, exists:boolean}}
 */
export function classroomDeclaresAnimation(classroomDir) {
  const file = join(classroomDir, 'classroom.yaml')
  if (!existsSync(file)) return { declared: false, file, exists: false }
  const text = readFileSync(file, 'utf8')
  return { declared: /^animation:\s*(#.*)?$/m.test(text), file, exists: true }
}

/** 路径是否"能被当进程直接启动"（存在 ＋ 可执行位；Windows 下只判存在）。 */
function isRunnable(p) {
  if (typeof p !== 'string' || p === '') return false
  if (!existsSync(p)) return false
  if (process.platform === 'win32') return statSync(p).isFile()
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** 路径是否"能被解释器读进去"（存在 ＋ 可读）。 */
function isReadable(p) {
  if (typeof p !== 'string' || p === '') return false
  if (!existsSync(p)) return false
  try {
    accessSync(p, constants.R_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 探测本机的教学动画渲染环境。
 *
 * 判据与**引擎自己的装载期自检**（`lib/animationstore.mjs` 的 `checkAnimationRuntime`）
 * 逐条对齐——判据必须与"实际怎么起它"一致：
 *   · python / manim / gatePython 被当**进程**启动 → 必须有可执行位；
 *   · gate（一个 .py）是被 `python <gate>` **读进去**的 → 只需要可读（不需要 X_OK）；
 *   · 引擎还会自己 `ast.parse` 渲染器脚本查语法，本探测不重复那一步（装载期会报）。
 *
 * @param {{fromDir?:string, envDir?:string, python?:string, manim?:string, gate?:string, env?:NodeJS.ProcessEnv}} [opts]
 * @returns {{ok:boolean, repoRoot:string|null, problems:string[], env:object|null,
 *            candidates:Record<string,{path:string,ok:boolean,reason:string,sha256?:string}>,
 *            howToInstall:string[]}}
 */
export function probeAnimationEnvironment(opts = {}) {
  const fromDir = opts.fromDir ?? dirname(fileURLToPath(import.meta.url))
  const environ = opts.env ?? process.env
  const repoRoot = findRepoRoot(fromDir)
  const candidates = {}
  const problems = []

  const judge = (key, path, kind) => {
    const ok = kind === 'run' ? isRunnable(path) : isReadable(path)
    const reason = ok
      ? 'ok'
      : !existsSync(path)
        ? '不存在'
        : kind === 'run'
          ? '存在但不可执行'
          : '存在但不可读'
    candidates[key] = { path, ok, reason }
    if (!ok) problems.push(`${key} ${reason}：${path}`)
    return ok
  }

  const howToInstall = [
    '怎么把渲染环境指给本流水线（认两套变量名，二选一；值可以是绝对路径，也可以是仓库相对路径）：',
    `  1a) ${ANIMATION_ENV_DIR_ENV} = 渲染环境目录（venv 的 bin/，里面要有可执行的 python 与 manim）`,
    `       ＋ ${ANIMATION_GATE_ENV} = 动画闸门脚本（.py，可读即可，由 python 读进去）`,
    `  1b) ${ENGINE_ANIMATION_PYTHON_ENV} / ${ENGINE_ANIMATION_MANIM_ENV} = python 与 manim 的**完整路径**`,
    `       ＋ ${ANIMATION_GATE_ENV}（与 1a 同一个变量）`,
    '      · 缺渲染环境就先建 venv 并装 manim（路径随意，只要把它指给上面某个变量）：',
    '        python3 -m venv <某处>/env',
    '        <某处>/env/bin/pip install manim',
    '  2) 指好之后**重跑**本流水线即可；不需要改任何代码（路径来自环境变量，不写死在源码里）。',
    '  3) 若这台机器上就是没有渲染环境、且本次验收不打算验动画：',
    '     显式关掉教室的 animation 段（会留痕，不是静默降级）：',
    '       ./acceptance/run.sh --disable-classroom-animation --animation-disable-reason "<为什么这台机器上关掉>"',
  ]

  if (repoRoot === null) {
    problems.push(
      `从 ${fromDir} 往上找不到同时含 \`classrooms/\` 与 \`plugins/\` 的仓库根 → 无法解析仓库相对路径（本流水线不做路径猜测）`,
    )
    return { ok: false, repoRoot: null, problems, env: null, candidates, howToInstall }
  }

  /** 环境变量给的路径：绝对路径原样用；相对路径按**仓库根**解析。 */
  const fromEnv = (value) => (value === undefined || value === '' ? null : resolve(repoRoot, value))
  const pick = (...values) => values.find((v) => v !== undefined && v !== null && v !== '')

  // 🔴 三个入口各自解析（不是"先要一个目录再拼文件名"）：
  //    引擎那套变量给的是**文件路径**，基名不一定是 `python`（可能是 `python3.12`）。
  const envDir = fromEnv(pick(opts.envDir, environ[ANIMATION_ENV_DIR_ENV]))
  const pythonRaw = pick(opts.python, environ[ENGINE_ANIMATION_PYTHON_ENV], envDir === null ? null : join(envDir, 'python'))
  const manimRaw = pick(opts.manim, environ[ENGINE_ANIMATION_MANIM_ENV], envDir === null ? null : join(envDir, 'manim'))
  const gatePath = fromEnv(pick(opts.gate, environ[ANIMATION_GATE_ENV]))

  const python = pythonRaw === null ? null : fromEnv(pythonRaw)
  const manim = manimRaw === null ? null : fromEnv(manimRaw)

  if (python === null) {
    problems.push(
      `未配置 python：设 ${ANIMATION_ENV_DIR_ENV}（目录）或 ${ENGINE_ANIMATION_PYTHON_ENV}（完整路径）`,
    )
  }
  if (manim === null) {
    problems.push(
      `未配置 manim：设 ${ANIMATION_ENV_DIR_ENV}（目录）或 ${ENGINE_ANIMATION_MANIM_ENV}（完整路径）`,
    )
  }
  if (gatePath === null) problems.push(`未设置 ${ANIMATION_GATE_ENV}（动画闸门脚本 .py）`)

  const pyOk = python === null ? false : judge('python', python, 'run')
  if (manim !== null) judge('manim', manim, 'run')
  if (gatePath !== null) judge('gate', gatePath, 'read')
  // gatePython：闸门由哪个解释器起。与渲染器同一个 python（探测出来的那一个）。
  if (pyOk) candidates.gatePython = { path: python, ok: true, reason: 'ok（与 python 同一个解释器）' }
  else {
    candidates.gatePython = { path: python ?? '<未配置>', ok: false, reason: 'python 不可用，无法给出 gatePython' }
  }

  // 可核对指纹：闸门脚本与渲染器脚本的 sha256（"跑的是哪一份"留痕）
  for (const [key, row] of Object.entries(candidates)) {
    if (!row.ok) continue
    try {
      const bytes = readFileSync(row.path)
      row.bytes = bytes.length
      row.sha256 = sha256OfBytes(bytes)
    } catch {
      row.sha256 = null
    }
  }

  const env = {
    python,
    manim,
    gate: gatePath,
    gatePython: python,
    quality: ANIMATION_QUALITY,
  }
  return { ok: problems.length === 0, repoRoot, problems, env, candidates, howToInstall }
}

/** 内部用：单段文本的 sha256（与 util.mjs 的实现同口径，这里内联以保持本模块自包含）。 */
function sha256Of(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 内部用：单份字节的 sha256。 */
function sha256OfBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * 渲染 `socratic-engine` 的 config 片段（YAML，缩进 4 空格）。
 * 🔴 形态与参考 profile（`profiles/socratic-headless/cordis.patch.yml` 的
 *   `socratic-engine` 段）**逐字同形**：同样的五个键、同样的 quality=l。
 * @param {{python:string,manim:string,gate:string,gatePython:string,quality:string}} env
 * @param {{indent?:string}} [opts]
 */
export function renderAnimationConfigYaml(env, opts = {}) {
  const i = opts.indent ?? '    '
  return [
    `${i}animation:`,
    `${i}  python: ${env.python}`,
    `${i}  manim: ${env.manim}`,
    `${i}  gate: ${env.gate}`,
    `${i}  gatePython: ${env.gatePython}`,
    `${i}  quality: ${env.quality}`,
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// 显式降级：把教室的 `animation:` 段整段删掉（只动工作副本，教室源码一个字不动）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 删掉 `animation:` 段（**顶层**键，块内缩进比它深）。
 * 纯函数：输入文本，输出 {text, removed:[行], before:{firstLine,lastLine,lines}}。
 * 🔴 只认顶层的 `animation:`（顶格），不碰块内任何 `animation` 字样。
 * @param {string} text
 */
export function stripAnimationSection(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => /^animation:\s*(#.*)?$/.test(line))
  if (start === -1) return { text, removed: [], found: false, before: null }
  let end = start + 1
  while (end < lines.length) {
    const line = lines[end]
    const blank = line.trim() === ''
    const indented = /^\s/.test(line) && line.trim() !== ''
    if (blank || indented) {
      end += 1
      continue
    }
    break
  }
  // 段尾的连续空行留给下一段，不一起删（保持文件可读）
  let cut = end
  while (cut > start + 1 && lines[cut - 1].trim() === '') cut -= 1
  const removed = lines.slice(start, cut)
  const next = [...lines.slice(0, start), ...lines.slice(end)]
  return {
    text: next.join('\n'),
    removed,
    found: true,
    before: { firstLine: start + 1, lastLine: cut, lines: removed.length },
  }
}

/**
 * 在**工作副本**教室目录里显式关掉动画。
 * 🔴 三件事必须同时做，少一件就是"静默降级"：
 *   ① 改的是工作副本，教室源码目录一个字都不动；
 *   ② 落盘 before/after 的 sha256 ＋ 被删的原文；
 *   ③ 要求调用方给出一条**理由**（空理由＝拒绝执行）。
 *
 * @param {{classroomDir:string, reason:string}} opts
 * @returns {{ok:boolean, error?:string, file?:string, reason?:string, sha256Before?:string,
 *            sha256After?:string, removedLines?:string[], before?:object}}
 */
export function disableClassroomAnimation(opts) {
  const { classroomDir, reason } = opts
  if (typeof reason !== 'string' || reason.trim() === '') {
    return {
      ok: false,
      error:
        '🔴 --disable-classroom-animation 必须配 --animation-disable-reason <理由>：' +
        '关掉动画是**显式降级**，必须写明为什么（这句话会原样进报告与结论，供人复核）。',
    }
  }
  const file = join(classroomDir, 'classroom.yaml')
  if (!existsSync(file)) return { ok: false, error: `教室 manifest 不存在：${file}` }
  const textBefore = readFileSync(file, 'utf8')
  const stripped = stripAnimationSection(textBefore)
  if (!stripped.found) {
    return {
      ok: false,
      error: `${file} 里没有顶层 \`animation:\` 段 → 教室本来就没声明动画，不需要（也不该）执行降级。`,
    }
  }
  ledgerWriteFile(file, stripped.text, { source: 'animation.disableClassroomAnimation（工作副本教室）' })
  return {
    ok: true,
    file,
    reason: reason.trim(),
    sha256Before: sha256Of(textBefore),
    sha256After: sha256Of(stripped.text),
    removedLines: stripped.removed,
    before: stripped.before,
  }
}
