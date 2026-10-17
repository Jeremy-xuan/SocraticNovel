// lib/animationstore.mjs — 教学动画的**落盘 + 起进程 + 读状态**层（classroom_animate 工具的主体）。
//
// 🔴 这一段是 ANIM-ORCH 编排的核心，四句话说完设计：
//   ① 工具**不阻塞**：落盘脚本 → 拉起 detached 渲染器 → **立刻返回**"已排队＋预计几秒"。
//      模型拿到返回值就继续讲，渲染在后台与"模型继续写讲解"重叠。
//   ② 状态**在盘上**（`status.json`），不在内存里：宿主重启、渲染器被杀、换会话，都读得回来。
//   ③ 就绪**跨回合**送达：下一回合注入时，把"你上一轮的动画好了"作为一条注入块送给老师
//      （见 index.mjs 的 pre-step 路径与本模块的 pendingNotices）。
//   ④ 死亡**可判定**：渲染器每 10 s 写一次心跳；宿主在 pid 消失**或**心跳超过 60 s 没更新时
//      判它死了，并把状态前推到 failed（带原因）——不靠猜、不静默挂住。
//
// 为什么不用宿主的 `ctx.jobs`／worker 线程（🔴 设计决定，见报告 §2.3）：
//   · 渲染是**跨语言**的（Python/ManimCE），进程边界本来就跑不掉；
//   · 宿主是回合制的，worker 线程只能在同一进程里并行，而真正要跨的是**回合**；
//   · `ctx.jobs` 是内存注册表：宿主一重启就空，而"上一节课的动画好了没"必须跨进程可读。
//   → detached 子进程 ＋ 磁盘状态 = 更少机制、更稳。
//
// 与 lib/diagramstore.mjs 的分工口径一致：`drawDiagram` 是**同步**的（解析 2–30 ms，模型等得起），
//   本模块是**异步**的（渲染 2–6 s 且要跨回合）——两者不是同一类问题，故不共用一套代码。

import { execFileSync, spawn } from 'node:child_process'
import { accessSync, closeSync, constants, existsSync, openSync } from 'node:fs'
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ANIMATIONS_SUBDIR,
  ANIMATION_STATES,
  INDEX_FILE,
  MAX_CONCURRENT_TASKS,
  RENDER_LOG_FILE,
  RUNNER_LOG_FILE,
  RUNNING_STATES,
  SCRIPT_FILE,
  STATUS_FILE,
  TASK_FILE,
  TERMINAL_STATES,
  animationTaskId,
  appendIndexRow,
  checkAnimationArgs,
  describeState,
  nowLabel,
  renderIndexRow,
  uniqueTaskId,
} from './animation.mjs'

/** 教室 runtime 文件现有权限位为 0600（实测既有文件是 `-rw-------`）。 */
export const DEFAULT_FILE_MODE = 0o600

/** 心跳超过这个毫秒数没更新，且 pid 也不在 → 判渲染器已死。 */
export const DEFAULT_HEARTBEAT_STALE_MS = 60000

/** 渲染器脚本位置（与 lib/animation.mjs 同目录）。 */
export const RUNNER_PATH = join(dirname(fileURLToPath(import.meta.url)), 'animation-runner.py')

/**
 * **装载期自检**：教室声明了动画时，把渲染环境当场验一遍。
 *
 * 🔴 为什么必须在装载期做（本批真实踩过两次，都发生在"上课时才炸"）：
 *   ① 渲染器脚本自己一处语法错误 → 进程死在 `main()` 之前、status.json 一个字都没写，
 *      宿主只能判"渲染器消失了"，课堂上白等一个超时；
 *   ② 画质档 `ql` 被拼进 manim 的 `-q` → manim exit 2，同样是课堂上才发现。
 *   两次的共同点：**配置错在装载时就能判出来**，却拖到学生面前才暴露。
 *   → 这里用真 python 真解析一遍渲染器脚本，并真看几个可执行文件在不在。
 *
 * @param {{python?:string, manim?:string, gate?:string|null, gatePython?:string|null}} env
 * @param {typeof execFileSync} [exec] - 注入（测试用）
 * @returns {{ok:boolean, problems:string[]}}
 */
export function checkAnimationRuntime(env, exec = execFileSync) {
  const problems = []
  /** 被当作**进程**直接启动的路径（python / manim / gatePython）→ 必须有可执行位。 */
  const runnable = (p, label) => {
    if (typeof p !== 'string' || p === '') {
      problems.push(`${label} 未配置`)
      return false
    }
    if (!existsSync(p)) {
      problems.push(`${label} 不存在：${p}`)
      return false
    }
    try {
      accessSync(p, constants.X_OK)
    } catch {
      problems.push(`${label} 不可执行：${p}`)
      return false
    }
    return true
  }
  /**
   * 被**解释器读进去**的路径（渲染器脚本、闸门脚本）→ 只需要可读。
   * 🔴 实测踩过：一开始对 `animation.gate`（一个 `.py`）也要 X_OK，于是装载期直接报
   *    "animation.gate 不可执行" —— 而闸门本来就是 `python animation_gate.py` 这样跑的，
   *    没有可执行位完全正常。判据必须与**实际怎么起它**一致。
   */
  const readable = (p, label) => {
    if (typeof p !== 'string' || p === '') {
      problems.push(`${label} 未配置`)
      return false
    }
    if (!existsSync(p)) {
      problems.push(`${label} 不存在：${p}`)
      return false
    }
    try {
      accessSync(p, constants.R_OK)
    } catch {
      problems.push(`${label} 不可读：${p}`)
      return false
    }
    return true
  }
  const pyOk = runnable(env.python, 'animation.python')
  runnable(env.manim, 'animation.manim')
  if (env.gate !== null && env.gate !== undefined) {
    readable(env.gate, 'animation.gate')
    if (env.gatePython !== null && env.gatePython !== undefined) runnable(env.gatePython, 'animation.gatePython')
  }
  if (!existsSync(RUNNER_PATH)) {
    problems.push(`渲染器脚本不存在：${RUNNER_PATH}`)
  } else if (pyOk) {
    try {
      exec(env.python, ['-c', 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())', RUNNER_PATH], {
        stdio: ['ignore', 'ignore', 'pipe'],
      })
    } catch (cause) {
      const detail = String(cause?.stderr ?? cause?.message ?? cause).trim()
      problems.push(`渲染器脚本语法不通过（${RUNNER_PATH}）：${detail}`)
    }
  }
  return { ok: problems.length === 0, problems }
}

/** 宿主原子写包（动态 import：单测环境无宿主也能加载本模块）。 */
async function loadHostAtomicWrite() {
  const mod = await import('@deepseek-ai/dsh-atomic-write')
  if (typeof mod?.writeFileAtomic !== 'function' || typeof mod?.withFileLock !== 'function') {
    throw new Error('@deepseek-ai/dsh-atomic-write 未导出 writeFileAtomic/withFileLock')
  }
  return { writeFileAtomic: mod.writeFileAtomic, withFileLock: mod.withFileLock }
}

/** 读一个 JSON 文件；不存在/半截 → null（调用方按"没有"处理，不抛）。 */
async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (cause) {
    if (cause?.code === 'ENOENT') return null
    return null
  }
}

/** 进程是否还在（pid 为 0/负数＝没记 pid，按"不在"处理）。 */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    // EPERM ＝ 进程存在但不是我的 → 仍算活着
    return cause?.code === 'EPERM'
  }
}

/**
 * 起一个动画任务：结构预检 → 落盘脚本与任务事实 → 拉起 detached 渲染器 → 立刻返回。
 *
 * @param {{script?:unknown, title?:unknown, caption?:unknown}} args - 模型给的入参
 * @param {object} env
 * @param {string} env.runtimeDir - 教室 runtime/ 目录绝对路径
 * @param {number|null} env.lesson - 本轮要讲的讲次
 * @param {number} env.turn - 本会话回合号
 * @param {string} env.python - venv 里的 python（跑渲染器）
 * @param {string} env.manim - venv 里的 manim
 * @param {string} [env.quality] - manim 的画质字母 l/m/h/p/k（默认 l = 低画质 854×480@15fps）
 * @param {string|null} [env.gate] - animation_gate.py 路径（null＝不过闸门）
 * @param {string|null} [env.gatePython] - 跑闸门的 python（缺省＝env.python）
 * @param {boolean} [env.blocking] - 🔴 **仅用于 A/B 对照实验**：true＝同步等渲染完再返回
 * @param {number} [env.blockingTimeoutMs] - blocking 模式的等待上限（默认 120000）
 * @param {() => number} [env.now]
 * @param {typeof spawn} [env.spawn] - 注入 spawn（测试用）
 * @param {{writeFileAtomic:Function, withFileLock:Function}} [env.io] - 注入 IO（测试用）
 */
export async function startAnimationTask(args, env) {
  const check = checkAnimationArgs(args)
  if (!check.ok) {
    throw new Error(
      'classroom_animate 拒绝这次调用，什么都没有落盘、也没有起渲染。\n- ' + check.problems.join('\n- '),
    )
  }
  const runtimeDir = env.runtimeDir
  if (typeof runtimeDir !== 'string' || runtimeDir === '') throw new Error('startAnimationTask 需要 runtimeDir')
  if (typeof env.python !== 'string' || env.python === '') {
    throw new Error('classroom_animate 未配置渲染环境：缺少 animation.python（见报告「接线」一节）')
  }
  if (typeof env.manim !== 'string' || env.manim === '') {
    throw new Error('classroom_animate 未配置渲染环境：缺少 animation.manim（见报告「接线」一节）')
  }

  const io = env.io ?? (await loadHostAtomicWrite())
  const at = (env.now ?? Date.now)()
  const root = join(runtimeDir, ANIMATIONS_SUBDIR)
  await mkdir(root, { recursive: true })

  // 并发闸：同时在跑的渲染最多 MAX_CONCURRENT_TASKS 个（多了就明说，不排队到看不见的地方）
  const running = await runningTasks(root, env)
  if (running.length >= MAX_CONCURRENT_TASKS) {
    throw new Error(
      `classroom_animate 拒绝这次调用：已经有 ${running.length} 段动画在渲染中` +
        `（上限 ${MAX_CONCURRENT_TASKS}）：${running.map((r) => r.taskId).join(', ')}。` +
        '先讲，等它们好了再起新的（下一回合引擎会告诉你哪段好了）。',
    )
  }

  const taskId = uniqueTaskId(
    animationTaskId({ lesson: env.lesson ?? null, turn: env.turn, at }),
    (candidate) => existsSync(join(root, candidate)),
  )
  const taskDir = join(root, taskId)
  await mkdir(taskDir, { recursive: true })

  // ① 脚本原文落盘（**逐字**，不补不删——出问题时这是唯一能复现的东西）
  const scriptFile = join(taskDir, SCRIPT_FILE)
  await io.writeFileAtomic(scriptFile, check.script, { mode: DEFAULT_FILE_MODE })

  // ② 任务事实落盘（宿主写；状态不在这里——状态归渲染器的 status.json）
  // 🔴 ANIM-PREP 新增三个**可选**字段（缺席时 task.json 与升级前逐字相同）：
  //    · cacheKey —— 「同一个动画只生成一次」的唯一凭据（算法见 lib/prep.mjs 的 prepCacheKey）；
  //    · prepId   —— 这条任务对应课程数据里的哪一条备课声明（老师课上按 id 取用）；
  //    · origin   —— 谁起的：teacher（课堂上现场起）/ prep（课前预热）/ template（课堂现场套模板）。
  const task = {
    taskId,
    lesson: env.lesson ?? null,
    turn: env.turn,
    createdAt: at,
    title: check.title,
    caption: check.caption,
    sceneClass: check.sceneClass,
    scriptFile: SCRIPT_FILE,
    quality: env.quality ?? 'l',
    gate: env.gate ?? null,
    expectedMs: env.expectedMs ?? null,
    announcedAt: null,
  }
  if (env.cacheKey) task.cacheKey = env.cacheKey
  if (env.prepId) task.prepId = env.prepId
  if (env.origin) task.origin = env.origin
  if (env.template) task.template = env.template
  await io.writeFileAtomic(join(taskDir, TASK_FILE), JSON.stringify(task, null, 1), { mode: DEFAULT_FILE_MODE })

  // ③ 拉起 detached 渲染器（新会话 + unref：宿主退出也不杀它）
  // 🔴 stdio **不是** 'ignore'：渲染器自己的 stderr 必须落到盘上（`runner.log`）。
  //    实测踩过：渲染器脚本里一处语法错误 → 进程在 `main()` 之前就死了 → status.json 一个字都没写，
  //    宿主只能判"渲染器消失了"，**看不到为什么**（而 'ignore' 把错误吞进了黑洞）。
  //    用文件描述符而不是 'inherit'：既保住 detached 的独立性，又留下可读的原文。
  const runnerLogPath = join(taskDir, RUNNER_LOG_FILE)
  const runnerLogFd = openSync(runnerLogPath, 'a', DEFAULT_FILE_MODE)
  const runnerArgs = [
    RUNNER_PATH,
    '--task-dir', taskDir,
    '--manim', env.manim,
    '--quality', env.quality ?? 'l',
    '--scene-class', check.sceneClass,
  ]
  if (env.gate) {
    runnerArgs.push('--gate', env.gate, '--gate-python', env.gatePython ?? env.python)
  }
  let child
  try {
    child = (env.spawn ?? spawn)(env.python, runnerArgs, {
      detached: true,
      stdio: ['ignore', runnerLogFd, runnerLogFd],
    })
    child.unref()
  } finally {
    closeSync(runnerLogFd)
  }
  const runnerPid = child.pid ?? null

  // ④ 索引追加（人读；只追加不删）
  const indexPath = join(root, INDEX_FILE)
  const row = renderIndexRow({
    timeLabel: nowLabel(at),
    lesson: env.lesson ?? null,
    turn: env.turn,
    state: 'queued',
    title: check.title,
    caption: check.caption,
    artifact: `${taskId}/${taskId}.mp4`,
  })
  let rows = 0
  await io.withFileLock(indexPath, async () => {
    let current = null
    try {
      current = await readFile(indexPath, 'utf8')
    } catch (cause) {
      if (cause?.code !== 'ENOENT') throw new Error(`读动画索引失败：${indexPath}（${cause?.code ?? cause?.message}）`)
    }
    const next = appendIndexRow(current, row)
    await io.writeFileAtomic(indexPath, next, { mode: DEFAULT_FILE_MODE })
    rows = countIndexRows(next)
  })

  const result = {
    taskId,
    dir: taskDir,
    runtimeDir,
    artifact: `${ANIMATIONS_SUBDIR}/${taskId}/${taskId}.mp4`,
    scriptPath: `${ANIMATIONS_SUBDIR}/${taskId}/${SCRIPT_FILE}`,
    statusPath: `${ANIMATIONS_SUBDIR}/${taskId}/${STATUS_FILE}`,
    lesson: env.lesson ?? null,
    turn: env.turn,
    title: check.title,
    sceneClass: check.sceneClass,
    lines: check.lines,
    bytes: check.script.length,
    runnerPid,
    rows,
    state: 'queued',
    time: nowLabel(at),
    // 🔴 同步对照模式（仅实验）：等渲染器写出终态再返回。默认 false = 不阻塞。
    blocking: env.blocking === true,
  }
  if (result.blocking) {
    const settled = await waitForTerminal(taskDir, {
      timeoutMs: env.blockingTimeoutMs ?? 120000,
      now: env.now,
      sleep: env.sleep,
    })
    result.state = settled.status?.state ?? 'failed'
    result.status = settled.status
    result.waitedMs = settled.waitedMs
  }
  return result
}

/** 轮询等待任务写出终态（**只给对照实验用**：生产路径不许阻塞）。 */
export async function waitForTerminal(taskDir, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 120000
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const t0 = now()
  for (;;) {
    const status = await readJsonIfExists(join(taskDir, STATUS_FILE))
    if (status !== null && TERMINAL_STATES.includes(status.state)) {
      return { status, waitedMs: now() - t0 }
    }
    if (now() - t0 > timeoutMs) return { status, waitedMs: now() - t0 }
    await sleep(250)
  }
}

/** 数索引里的数据行（表头与分隔行不算）。 */
function countIndexRows(text) {
  return text
    .split('\n')
    .filter((l) => l.startsWith('| ') && !/^\|\s*-+/.test(l) && !l.startsWith('| 日期 ')).length
}

/**
 * 按缓存键找任务。**纯读盘**（不看内存）。
 *
 * 🔴 为什么按缓存键查而不是按任务号查：任务号里带时间戳，每次起任务都不一样；
 *    而"同一个动画只生成一次"要的是**跨讲次、跨会话、跨进程**都认得出"这就是同一段动画"，
 *    唯一稳定的标识就是缓存键（讲次＋教材哈希＋模板版本＋参数，见 lib/prep.mjs）。
 *
 * @param {string} root - runtime/animations/
 * @param {string} cacheKey
 * @returns {Promise<{ready: object|null, attempts: number, latest: object|null}>}
 *   `ready`＝已存在且 state=ready 的那条（命中缓存，老师课上可 0 秒取用）；
 *   `attempts`＝这个键一共起过几次（失败重试的上界靠它，不靠内存计数——宿主重启也不丢）。
 */
export async function findByCacheKey(root, cacheKey) {
  const tasks = await listTasks(root)
  const mine = tasks.filter((t) => t.task?.cacheKey === cacheKey)
  const ready = mine.filter((t) => t.status?.state === 'ready')
  return {
    ready: ready.length === 0 ? null : ready[ready.length - 1],
    attempts: mine.length,
    latest: mine.length === 0 ? null : mine[mine.length - 1],
  }
}

/** 读一个任务目录（task.json + status.json）。目录不存在返回 null。 */
export async function readTask(taskDir) {
  const task = await readJsonIfExists(join(taskDir, TASK_FILE))
  if (task === null) return null
  const status = await readJsonIfExists(join(taskDir, STATUS_FILE))
  return { taskId: task.taskId ?? dirname(taskDir).split('/').pop(), dir: taskDir, task, status }
}

/** 列出一个 runtime/animations/ 下的全部任务（按任务号排序＝按时间排序）。 */
export async function listTasks(root) {
  let names = []
  try {
    names = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch (cause) {
    if (cause?.code === 'ENOENT') return []
    throw cause
  }
  const out = []
  for (const name of names.sort()) {
    const rec = await readTask(join(root, name))
    if (rec !== null) out.push(rec)
  }
  return out
}

/**
 * 当前还在跑的任务（queued/rendering/gating）。
 * 🔴 判活**不看状态字段本身**（那是渲染器写的、可能停在半路），而是 pid ＋ 心跳两个事实。
 */
export async function runningTasks(root, opts = {}) {
  const tasks = await listTasks(root)
  const now = (opts.now ?? Date.now)()
  const staleMs = opts.heartbeatStaleMs ?? DEFAULT_HEARTBEAT_STALE_MS
  return tasks.filter((t) => {
    const state = t.status?.state ?? 'queued'
    if (!RUNNING_STATES.includes(state)) return false
    const pid = t.status?.runnerPid ?? t.task.runnerPid ?? null
    const hb = t.status?.heartbeatAt ?? t.status?.startedAt ?? t.task.createdAt ?? 0
    const dead = !pidAlive(pid) && now - hb > staleMs
    return !dead
  })
}

/**
 * 结算：把"渲染器已经死了但状态还停在 running"的任务前推成 failed。
 *
 * 🔴 判据是**两个事实**，不是猜：① pid 不在了（或从没记下 pid）② 心跳超过 staleMs 没更新。
 *    两个都成立才判死——只看 pid 会被 pid 复用骗到，只看时间会在长渲染上误判。
 * @returns {{settled: object[], running: object[]}}
 */
export async function settleRunningTasks(root, opts = {}) {
  const now = (opts.now ?? Date.now)()
  const staleMs = opts.heartbeatStaleMs ?? DEFAULT_HEARTBEAT_STALE_MS
  const tasks = await listTasks(root)
  const settled = []
  const running = []
  for (const t of tasks) {
    const state = t.status?.state ?? 'queued'
    if (!RUNNING_STATES.includes(state)) continue
    const pid = t.status?.runnerPid ?? t.task.runnerPid ?? null
    const hb = t.status?.heartbeatAt ?? t.status?.startedAt ?? t.task.createdAt ?? 0
    const silentMs = now - hb
    if (pidAlive(pid) || silentMs <= staleMs) {
      running.push(t)
      continue
    }
    // 渲染器自己留下的 stderr 尾部（语法错误、import 失败这类"死在 main 之前"的原因只在这里）
    let runnerTail = ''
    try {
      const text = await readFile(join(t.dir, RUNNER_LOG_FILE), 'utf8')
      runnerTail = text.trim().slice(-800)
    } catch {
      /* 没有 runner.log 就没有——不编原因 */
    }
    const next = {
      ...(t.status ?? {}),
      state: 'failed',
      reason:
        `渲染器进程已消失（pid ${pid ?? '未记录'}），且心跳已停 ${Math.round(silentMs / 1000)} 秒；` +
        '没有写出终态——这段动画没有可播的片子。' +
        (runnerTail === '' ? '' : `\n渲染器日志尾部：\n${runnerTail}`),
      updatedAt: now,
      finishedAt: now,
      settledBy: 'engine',
    }
    const io = opts.io ?? (await loadHostAtomicWrite())
    await io.writeFileAtomic(join(t.dir, STATUS_FILE), JSON.stringify(next, null, 1), { mode: DEFAULT_FILE_MODE })
    settled.push({ ...t, status: next })
    if (typeof opts.log === 'function') {
      opts.log(`动画任务 ${t.taskId} 判死并前推为 failed（pid ${pid ?? '未记录'}，静默 ${Math.round(silentMs / 1000)}s）`)
    }
  }
  return { settled, running }
}

/**
 * 取"还没播报给老师"的终态任务（ready / blocked / failed）。
 * 🔴 播报一次就不再重复：`task.json.announcedAt` 是这条幂等门的唯一凭据（落盘，跨回合有效）。
 */
export async function pendingNotices(root) {
  const tasks = await listTasks(root)
  return tasks.filter((t) => {
    const state = t.status?.state ?? null
    if (state === null || !TERMINAL_STATES.includes(state)) return false
    return t.task.announcedAt === null || t.task.announcedAt === undefined
  })
}

/** 标记"已播报"（写 task.json 的 announcedAt）。 */
export async function markAnnounced(taskDir, opts = {}) {
  const io = opts.io ?? (await loadHostAtomicWrite())
  const file = join(taskDir, TASK_FILE)
  const task = await readJsonIfExists(file)
  if (task === null) throw new Error(`markAnnounced：读不到 ${file}`)
  const next = { ...task, announcedAt: (opts.now ?? Date.now)() }
  await io.writeFileAtomic(file, JSON.stringify(next, null, 1), { mode: DEFAULT_FILE_MODE })
  return next
}

/**
 * 把一个任务的结果拼成**给老师的一段注入文本**。纯函数（无 IO）。
 *
 * 🔴 一次只拼**一个任务**（不是一批）：注入通道是"一条消息 = 一个来源"，
 *    客户端要按消息上的机器可读字段去找片子播（见 animationNoticeSource），
 *    一条消息里塞多段动画就没法给每条自己的字段了。
 *
 * 🔴 文案口径（本项目教训：条件措辞会让模型犹豫）：
 *   · `ready` → 动词开头，直接说"现在就放"，并给出文件路径与时长；
 *   · `blocked`/`failed` → 明说"不许播"，并给出两条可执行的出路（改脚本重试 / 改用板书图）。
 * @param {object} r - pendingNotices 的产物（单个）
 * @param {{wrap?: (text:string)=>string}} [opts]
 */
export function buildAnimationNotice(r, opts = {}) {
  if (r === null || r === undefined) return null
  const wrap = opts.wrap ?? ((t) => t)
  const state = r.status?.state ?? 'unknown'
  const st = describeState(state, { reason: r.status?.reason ?? null })
  const dur = typeof r.status?.durationSec === 'number' ? `${r.status.durationSec.toFixed(1)} 秒` : '时长未知'
  const size = typeof r.status?.bytes === 'number' ? `${Math.round(r.status.bytes / 1024)} KB` : '大小未知'
  const lesson = r.task.lesson === null || r.task.lesson === undefined ? '无讲次' : `第 ${r.task.lesson} 讲`
  // 🔴 ANIM-PREP：课前预热起的任务与老师课上起的任务，**说法必须不同**——
  //    预热的这一段不是"你上一轮起的"，而是"课程数据早就声明好的、引擎在课前渲好的"。
  //    说成前者会让老师以为要自己重新生成一遍（那正是这条机制要消掉的动作）。
  const isPrep = r.task.origin === 'prep'
  const prepTag = isPrep && r.task.prepId ? `（备课清单 ${r.task.prepId}）` : ''
  const lines = [
    (isPrep ? '课前按课程数据预热的教学动画有结果了：' : '你上一轮起的教学动画有结果了：') +
      `${r.taskId}${prepTag}（${lesson} · 第 ${r.task.turn} 回合）**${state}** —— ${st}` +
      `｜标题：${r.task.title}｜片子：${r.status?.mp4 ?? '（无）'}（${dur} / ${size}）`,
  ]
  if (state === 'ready') {
    lines.push(
      isPrep
        ? '→ 讲到那一步时**直接放这段**（它是这一讲预先声明好的，不必再自己写脚本）：' +
          `客户端会从 ${ANIMATIONS_SUBDIR}/${r.taskId}/${r.taskId}.mp4 读片。`
        : '→ 现在就在讲解里把它放出来：讲到那一步时直接播这段动画，并告诉学生它讲的是哪一步。' +
          `（客户端会从 ${ANIMATIONS_SUBDIR}/${r.taskId}/${r.taskId}.mp4 读片）`,
    )
  } else if (state === 'blocked') {
    lines.push(
      (isPrep ? '→ **这段别等了**：' : '→ **不要放这段片子**：') +
        '机器判定它有画面层缺陷（文字重叠／消失／被压住这类），学生看不懂。' +
        '改用 classroom_draw 画一张板书图把这一步讲完；确实需要动画再现场调 classroom_animate 自己写一段。',
    )
    if (typeof r.status?.reason === 'string') lines.push(`→ 原因：${r.status.reason}`)
  } else if (state === 'failed') {
    lines.push(
      (isPrep ? '→ **这段别等了**：' : '→ 这段动画没渲出来，**没有可播的片子**。') +
        '改用 classroom_draw 画一张板书图把这一步讲完；确实需要动画再现场调 classroom_animate 自己写一段。' +
        '**不要对学生说"动画正在生成"然后不放**。',
    )
    if (typeof r.status?.reason === 'string') lines.push(`→ 原因：${r.status.reason}`)
  }
  return wrap(lines.join('\n'))
}

/**
 * 注入消息上的**机器可读来源字段**（客户端据此找片子播，不去解析自然语言）。
 *
 * 🔴 为什么必须有它（而不是让客户端从注入正文里抠路径）：正文是给模型看的中文，
 *    措辞随时会改；客户端解析中文＝把两端的耦合藏在一句话里，改一次文案就断一次。
 *    宿主会把 `source` 原样落进会话事件流（`user/message` 事件的 `data.source`），
 *    所以这几个字段是**跨端契约**，也是本轮客户端接线说明的唯一依据。
 * @param {object} r - pendingNotices 的产物（单个）
 */
export function animationNoticeSource(r) {
  const state = r.status?.state ?? 'unknown'
  const mp4 = r.status?.mp4 ?? `${r.taskId}.mp4`
  return {
    kind: 'socratic-engine',
    form: 'animation-notice',
    block: `animation-notice:${r.taskId}`,
    taskId: r.taskId,
    state,
    // 教室相对路径（客户端若以教室为工作区，这就是可读路径）
    artifact: `${ANIMATIONS_SUBDIR}/${r.taskId}/${mp4}`,
    // 绝对路径（教室不在会话工作区时用得上；客户端能不能读要另说，见接线说明）
    absPath: join(r.dir, mp4),
    title: r.task.title,
    lesson: r.task.lesson ?? null,
    turn: r.task.turn,
    // ANIM-PREP：客户端要能区分"课前预热好的"与"老师课上现起的"（文案与播放时机不同）
    origin: r.task.origin ?? 'teacher',
    prepId: r.task.prepId ?? null,
    template: r.task.template ?? null,
    durationSec: typeof r.status?.durationSec === 'number' ? r.status.durationSec : null,
  }
}

/**
 * `classroom_animation_status` 工具的返回体：全部任务的状态摘要。纯函数（无 IO）。
 */
export function summarizeTasks(records, opts = {}) {
  const byState = {}
  for (const s of ANIMATION_STATES) byState[s] = 0
  for (const r of records) {
    const s = r.status?.state ?? 'queued'
    if (byState[s] !== undefined) byState[s] += 1
  }
  const pending = records.filter((r) => r.task.announcedAt === null || r.task.announcedAt === undefined)
  return {
    total: records.length,
    byState,
    pendingNotice: pending.length,
    latest: records.length === 0 ? null : records[records.length - 1],
  }
}

/** 供测试与日志用：任务目录里的文件是否齐（不做判定，只报事实）。 */
export async function inspectTaskDir(taskDir) {
  const out = {}
  for (const f of [TASK_FILE, STATUS_FILE, SCRIPT_FILE, RENDER_LOG_FILE, RUNNER_LOG_FILE]) {
    try {
      out[f] = (await stat(join(taskDir, f))).size
    } catch {
      out[f] = null
    }
  }
  return out
}
