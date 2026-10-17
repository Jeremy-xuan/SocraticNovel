// lib/util.mjs — ACCEPT-1 验收流水线的公共工具
//
// 只放"与业务无关"的东西：进程调用、文件树哈希、JSON 落盘、时间戳。
// 🔴 纪律：本目录只读别人的东西、只写自己的 runs/ 与报告；不碰 plugins、classrooms。
//
// 🔴 ACCEPT-4：**所有写盘都经 lib/footprint.mjs 的 ledger 原语**（不再直接调 node:fs 的写接口）。
//   为什么：零接触守卫的判据从"时间窗"改成了"写足迹"——那要求"我们写了什么"这件事**必须可核**。
//   本文件里 `writeJson`/`writeText`/`appendLine`/`ensureDir` 就是全流水线的写入口，
//   它们各自记一条足迹；`run`/`runAsync` 则把**执行过的命令**记下来（命令级零接触检查的输入）。
//   绕开 ledger 直接写盘 → 由 `scanUninstrumentedWrites()` 静态扫出来并判失败。

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'

import { footprintLedger, ledgerAppendFile, ledgerEnsureDir, ledgerWriteFile } from './footprint.mjs'

// ═════════════════════════════════════════════════════════════════════════════
// 0 · 运行环境：node 可执行文件 / dsh CLI / **隔离的 DSH_HOME**
// ═════════════════════════════════════════════════════════════════════════════
// 🔴 这一节的三条都不写死"这台机器上的路径"——它们是**探测＋环境变量覆盖**，
//    探不到就**大声失败**（预检会报），绝不静默退到某个猜出来的位置。

/**
 * 选真正的 node 可执行文件。
 * 🔴 为什么不能直接用 `process.execPath`：在 DSH Desktop 的图形 harness 里它是 Electron 壳
 *   （"DSH Desktop Helper"），拿它跑 `node --test` 会把 Electron 二进制当脚本解析而崩。
 *   这时退回 PATH 上的真实 node。
 */
function resolveNode() {
  if (process.env.ACCEPT_NODE) return process.env.ACCEPT_NODE
  const ep = process.execPath
  if (/[Ee]lectron|DSH Desktop Helper/i.test(ep)) {
    const probe = spawnSync('node', ['--version'], { encoding: 'utf8' })
    if (probe.status === 0) return 'node'
  }
  return ep
}

/**
 * 找 dsh CLI 的入口（`…/@deepseek-ai/dsh/lib/bin.js`）。
 * 顺序：`DSH_BIN` 环境变量 → PATH 上的 `dsh` → 几个**已知的安装位置**（探测，不是要求）。
 * 全都找不到 → 返回 null，由预检**大声失败**并告诉你用 `DSH_BIN=` 指过来。
 */
function resolveDshBin() {
  if (process.env.DSH_BIN) return process.env.DSH_BIN
  const onPath = spawnSync('which', ['dsh'], { encoding: 'utf8' })
  if (onPath.status === 0 && onPath.stdout.trim() !== '') return onPath.stdout.trim()
  const candidates = [
    '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js',
    join(process.env.HOME ?? '', 'Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js'),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

/**
 * 🔴 DSH_HOME **必须隔离**：本流水线会建 profile、装插件、跑会话（会写 `$DSH_HOME` 下的
 *   一堆东西）。跑在用户的真实 harness 上＝动用户的真实环境，绝对不许。
 *
 * 判据（**硬判**，不是"尽量"）：
 *   · `ACCEPT_DSH_HOME_ROOT`（默认 `$TMPDIR/socratic-accept-dsh`）＝本次运行的隔离根；
 *   · `DSH_HOME` 必须落在隔离根**之下**（路径段前缀，不是字符串前缀）；
 *   · 另外显式拒绝几个"一看就是真实环境"的位置（桌面 harness / 用户 Library）。
 *
 * ⚠️ 为什么不能用 `DSH_HOME ?? 默认值` 这种写法收场：本环境的 `DSH_HOME` 环境变量**本来
 *   就指向真 harness**，`??` 会安静地选中它 —— 实测踩过（连跑 4 次都跑在真 harness 上，
 *   会话记录写进了真实 sessions 目录）。→ 必须是"不是预期的隔离目录就**拒绝运行**"。
 */
export const DSH_HOME_ISOLATION_ROOT =
  process.env.ACCEPT_DSH_HOME_ROOT ?? join(tmpdir(), 'socratic-accept-dsh')

export const DSH_HOME = process.env.DSH_HOME ?? join(DSH_HOME_ISOLATION_ROOT, 'harness')

/**
 * 校验一个 DSH_HOME 是否落在允许的隔离根下。
 * @param {string} dshHome
 * @param {string} [root]
 * @returns {{ok:boolean, reason:string|null, dshHome:string, root:string}}
 */
export function checkDshHomeIsolation(dshHome = DSH_HOME, root = DSH_HOME_ISOLATION_ROOT) {
  const home = resolve(dshHome)
  const base = resolve(root)
  const looksReal =
    /(^|\/)Library\/Application Support(\/|$)/.test(home) || /dsh-desktop/.test(home)
  if (looksReal) {
    return {
      ok: false,
      reason:
        `DSH_HOME 看起来是**用户的真实 harness**（含 \`Library/Application Support\` 或 \`dsh-desktop\`）：${home}`,
      dshHome: home,
      root: base,
    }
  }
  if (home === base || home.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)) {
    return { ok: true, reason: null, dshHome: home, root: base }
  }
  return {
    ok: false,
    reason:
      `DSH_HOME 不在本次运行的隔离根之下：DSH_HOME=${home}，隔离根=${base}` +
      `（本流水线**拒绝**在非隔离的 DSH_HOME 上跑；要换根就设 ACCEPT_DSH_HOME_ROOT）`,
    dshHome: home,
    root: base,
  }
}

/** 解析出可用的 node / dsh CLI（探不到时是 null，由预检报错）。 */
export const NODE = resolveNode()
export const DSH_BIN = resolveDshBin()

/** 本流水线自己的专用测试 profile 名。 */
export const ACCEPT_PROFILE = process.env.ACCEPT_PROFILE ?? 'socratic-accept'

/**
 * 🔴 永不许碰的 profile（web / 桌面）。
 * 用于三处：① 创建前自检；② 删除 profile 目录前自检；③ 运行前后哈希快照比对。
 */
export const FORBIDDEN_PROFILES = ['web', 'desktop', 'desktop-safe-mode']

/** 绝对路径化。 */
export function abs(p) {
  return resolve(p)
}

/** 生成时间戳目录名 `YYYY-MM-DD_HHmmss`（本地时间，与人类阅读习惯一致）。 */
export function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}

/** 递归建目录（记写足迹）。 */
export function ensureDir(dir) {
  return ledgerEnsureDir(dir, { source: 'util.ensureDir' })
}

/** 写 JSON（缩进 2；结尾换行）。记写足迹。 */
export function writeJson(file, value) {
  return ledgerWriteFile(file, `${JSON.stringify(value, null, 2)}\n`, { source: 'util.writeJson' })
}

/** 写文本。记写足迹。 */
export function writeText(file, text) {
  return ledgerWriteFile(file, text, { source: 'util.writeText' })
}

/** 追加一行到日志文件（逐条落盘，禁止攒批）。记写足迹。 */
export function appendLine(file, line) {
  return ledgerAppendFile(file, `${line}\n`, { source: 'util.appendLine' })
}

/**
 * 同步执行一条外部命令，返回 {code, stdout, stderr, cmd}。
 * 🔴 不抛错：调用方必须自己判 code（本流水线要"大声失败"，但失败要带原始输出）。
 * 🔴 ACCEPT-4：**执行过的命令一律记进 ledger**（命令级零接触检查扫的就是它）。
 */
export function run(cmd, args = [], opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  })
  const row = {
    cmd: [cmd, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '),
    code: result.status,
    signal: result.signal ?? null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ? String(result.error.message ?? result.error) : null,
  }
  footprintLedger.recordCommand({ cmd: row.cmd, source: opts.footprintSource ?? 'util.run' })
  return row
}

/** 跑一段 node 代码/脚本（统一用本流水线解析出的 node ＋ --expose-internals）。 */
export function runNode(args, opts = {}) {
  return run(NODE, ['--expose-internals', ...args], opts)
}

/**
 * 异步版 `run`：**不阻塞事件循环**。
 * 🔴 为什么会话必须用它：`spawnSync` 会把整个事件循环卡住，导致
 *   「零接触采样器」的 `setInterval` 一拍都不跑（实测踩到：整场会话只采到 1 个点，
 *   于是运行窗口里的变化无法归因 → 守卫误判）。
 */
export function runAsync(cmd, args = [], opts = {}) {
  // 🔴 ACCEPT-4：命令在**启动前**就记账（进程被 kill / 超时也要留下"我们跑过它"这条足迹）
  footprintLedger.recordCommand({
    cmd: [cmd, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '),
    source: opts.footprintSource ?? 'util.runAsync',
  })
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let killedBy = null
    const timer =
      opts.timeout === undefined
        ? null
        : setTimeout(() => {
            killedBy = 'timeout'
            child.kill('SIGKILL')
          }, opts.timeout)
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      if (timer !== null) clearTimeout(timer)
      resolve({ cmd: [cmd, ...args].join(' '), code: null, signal: null, stdout, stderr, error: String(error.message ?? error), killedBy })
    })
    child.on('close', (code, signal) => {
      if (timer !== null) clearTimeout(timer)
      resolve({
        cmd: [cmd, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '),
        code,
        signal: signal ?? null,
        stdout,
        stderr,
        error: null,
        killedBy,
      })
    })
  })
}

/** 单文件 sha256。 */
export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** 单段文本 sha256。 */
export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * 递归列出目录下的普通文件（相对路径，POSIX 分隔符，字典序）。
 * @param {string} dir
 * @param {{skipDirs?: string[]}} [opts]
 */
export function walkFiles(dir, opts = {}) {
  const skip = new Set(opts.skipDirs ?? [])
  const out = []
  const visit = (current) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue
        visit(full)
      } else if (entry.isFile()) {
        out.push(relative(dir, full).split(sep).join('/'))
      } else if (entry.isSymbolicLink()) {
        // 符号链接只登记、不跟随（避免顺着链接走进别的 checkout／远端树）
        out.push(relative(dir, full).split(sep).join('/'))
      }
    }
  }
  visit(dir)
  out.sort()
  return out
}

/**
 * 目录树的逐文件 sha256 表。
 * @returns {{files: number, bytes: number, map: Record<string, {sha256:string, bytes:number, mode:number, nlink:number, ino:number}>}}
 */
export function hashTree(dir, opts = {}) {
  const map = {}
  let bytes = 0
  for (const rel of walkFiles(dir, opts)) {
    const full = join(dir, rel)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (!st.isFile()) {
      map[rel] = { sha256: null, bytes: 0, mode: st.mode & 0o777, nlink: st.nlink, ino: st.ino, symlink: true, mtimeMs: Math.round(st.mtimeMs) }
      continue
    }
    const sha256 = sha256File(full)
    bytes += st.size
    map[rel] = { sha256, bytes: st.size, mode: st.mode & 0o777, nlink: st.nlink, ino: st.ino, symlink: false, mtimeMs: Math.round(st.mtimeMs) }
  }
  return { files: Object.keys(map).length, bytes, map }
}

/** 把 hashTree 的结果渲染成 `sha256  relpath` 的清单文本（GNU coreutils 风格）。 */
export function renderSums(map) {
  return (
    Object.keys(map)
      .sort()
      .map((rel) => `${map[rel].sha256 ?? '<symlink>'}  ${rel}`)
      .join('\n') + '\n'
  )
}

/** 浅层快照一个目录（只到一层，不进 node_modules）——用于"零接触"证据。 */
export function shallowSnapshot(dir) {
  const out = {}
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    try {
      const st = statSync(full)
      out[entry.name] = {
        kind: entry.isDirectory() ? 'dir' : entry.isSymbolicLink() ? 'symlink' : 'file',
        bytes: entry.isFile() ? st.size : null,
        mtimeMs: Math.round(st.mtimeMs),
        sha256: entry.isFile() ? sha256File(full) : null,
      }
    } catch (error) {
      out[entry.name] = { kind: 'unreadable', error: String(error?.code ?? error) }
    }
  }
  return out
}

/** 比对两份 shallowSnapshot，返回变化的键。 */
export function diffSnapshot(before, after) {
  const changed = []
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of [...keys].sort()) {
    const a = before[key]
    const b = after[key]
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push({ key, before: a, after: b })
  }
  return changed
}

/** 人类可读的字节数。 */
export function humanBytes(n) {
  if (!Number.isFinite(n)) return String(n)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** 控制台打印 + 同时落盘（逐条，不攒批）。 */
export function makeLogger(logFile) {
  const write = (line) => {
    process.stdout.write(`${line}\n`)
    if (logFile) appendLine(logFile, line)
  }
  return {
    info: (msg) => write(`[accept] ${msg}`),
    step: (msg) => write(`\n[accept] ══ ${msg} ══`),
    fail: (msg) => write(`[accept] ✖ ${msg}`),
    ok: (msg) => write(`[accept] ✔ ${msg}`),
  }
}

/** 把一段文本按行做"新增行"diff 摘要（只用于报告展示，不做完整 diff 算法）。 */
export function appendedLines(before, after) {
  const beforeLines = String(before ?? '').split('\n')
  const afterLines = String(after ?? '').split('\n')
  let i = 0
  while (i < beforeLines.length && i < afterLines.length && beforeLines[i] === afterLines[i]) i += 1
  return { commonPrefixLines: i, added: afterLines.slice(i), removedTail: beforeLines.slice(i) }
}
