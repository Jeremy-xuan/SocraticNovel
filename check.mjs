#!/usr/bin/env node
/**
 * SocraticNovel 仓库级验收入口（极简、零新依赖，只用 Node 内置模块）。
 *
 * 它不替代各子包的 `npm test`，只是把「主仓库可复现基线」要查的事串起来，
 * 给一个统一的通过/失败口径与退出码：
 *
 *   ① 技能自检（skills/socratic-classroom/validate）—— 跑默认镜像教室；
 *   ② 教室真源 ↔ 技能镜像 字节一致（sha256 全文件比对，排除 .DS_Store）；
 *   ③ Live2D 宿主的**静态完整性**（clients/live2d-host）：
 *        · package.json 的每个 script 目标文件真的在盘上（glob 展开后必须有命中）；
 *        · 包内全部 JS/CJS/MJS 逐文件 `node --check` 语法检查（不写死文件数）；
 *        · `build` / `capability` 需要的 vendor/ 与 samples/ **未随仓库分发** →
 *          这两条**明确记 N/A**（不是通过，也不算失败）。
 *   ④ 客户端插件测试（clients/inject-hide/test/hide.test.mjs，＝ `npm test`）；
 *   ⑤ 客户端面板测试（clients/classroom-ui）：
 *        · test/panel.test.mjs（＝ `npm test`）；
 *        · test/whiteboard.test.mjs ＋ test/whiteboard-route.test.mjs（白板服务端，两个独立断言集）；
 *   ⑥ 舞台离线自检（clients/classroom-stage-warm/check.sh，20 项、不装 profile、不联网）；
 *   ⑦ 验收流水线的不花钱机核（acceptance/）：
 *        · 静态三守卫：footprint-self-test / whitelist-self-test / frequency-parity；
 *        · A2 运行期动态块单测：dynamic-blocks.test.mjs；
 *   ⑧ 引擎单元测试（plugins/socratic-engine，需先 `npm ci` 装好依赖）。
 *
 * 用法：
 *   node check.mjs                     # 跑全部（①②③④⑤⑥⑦⑧）
 *   node check.mjs --skill             # 只跑 ①②（纯本地，不需要引擎依赖）
 *   node check.mjs --node <exe>        # 指定运行 node 可执行文件（默认 process.execPath）
 *
 * 退出码：0 = 全部通过（N/A 项不算通过也不算失败）；1 = 有任一检查失败。
 *
 * 约定：依赖不入库（见 .gitignore）。引擎/技能测试前需先在其目录 `npm ci`。
 * 本脚本只报错、不静默：任何一步失败都会留下明确信息；任何 spawn 异常都会显式抛出，
 * 绝不把"命令没跑起来"伪装成"退出码 1"。所有 sha256 都用 node:crypto 现算，
 * 不调外部 shasum。文件数、绝对路径一律不写死（按盘上实际内容列举）。
 *
 * 关于 `node` 可执行文件：默认用 `process.execPath`（即运行本脚本的那个 node），
 * 不再做任何"是不是 Electron 壳"的猜测与回退——那是不可靠的启发式。如果在某个
 * harness 里 `process.execPath` 不是真 node，用 `--node <exe>` 显式指定即可。
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)))
const onlySkill = process.argv.includes('--skill')

// 解析 --node <exe> 参数（若有）。
let NODE = process.execPath
{
  const i = process.argv.indexOf('--node')
  if (i !== -1 && process.argv[i + 1]) NODE = process.argv[i + 1]
}
// 跨平台跑 npm：`npm` 在 Windows 上是 npm.cmd，用 shell 解析更稳；
// 否则直接 spawn 'npm' 在 POSIX 上都行。统一走 shell:true 以兼容两类平台。
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

let failures = 0
const log = (...a) => console.log(...a)

function section(name) {
  log('\n' + '='.repeat(64))
  log(name)
  log('='.repeat(64))
}

/** 运行一个 node 脚本；返回 { status, stdout }。任何 spawn 异常都显式抛出，不静默吞。 */
function runNode(entry, args = []) {
  const r = spawnSync(NODE, [entry, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  if (r.error) throw r.error // ENOENT / 信号 / 超时等：显式失败，而不是假装退出码 1
  return { status: r.status ?? 1, stdout: r.stdout ?? '' }
}

/** 在某个子包目录里跑 `npm test`；返回 { status, stdout, error? }。spawn 异常显式抛出。 */
function runNpmTest(pkgDir) {
  const r = spawnSync(npmCmd, ['test'], {
    cwd: pkgDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: true,
  })
  if (r.error) throw r.error
  return { status: r.status ?? 1, stdout: r.stdout ?? '' }
}

/**
 * 跑一条"子命令式"检查：打印它的 stdout，并按退出码计失败。
 * 返回 true 表示通过。**入口文件不存在＝失败**（不是"跳过"）。
 */
function runCheckStep({ label, entry, args = [] }) {
  if (!existsSync(entry)) {
    failures++
    log(`  ✗ 入口不存在：${relative(ROOT, entry)}`)
    return false
  }
  const r = runNode(entry, args)
  const out = r.stdout.trim()
  if (out) log(out)
  if (r.status !== 0) {
    failures++
    log(`  ✗ ${label} 退出码 ${r.status}`)
    return false
  }
  log(`  ✓ ${label} 退出码 0`)
  return true
}

/**
 * 递归收集某目录下所有普通文件（排除 .DS_Store）。返回**相对 `root`** 的路径数组。
 *
 * 🔴 相对基准必须是 `root`（递归入口），不是当前层目录：写成 `relative(dir, p)` 会让
 * 所有子目录里的文件退化成**裸文件名**（`materials/ch01.md` → `ch01.md`），于是
 * ① 同名文件（`story/ch01.md` / `materials/ch01.md`）在集合里被去重成一条，
 * ② 两个目录各自的 `ch01.md` 会被拿来互比 —— 比对结果与磁盘真相无关。
 */
function listFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name === '.DS_Store') continue
      const p = join(dir, name.name)
      if (name.isDirectory()) walk(p)
      else if (name.isFile()) out.push(relative(root, p))
    }
  }
  walk(root)
  return out
}

/** sha256 一个文件（用 node:crypto，不依赖外部 shasum）。 */
function sha256Of(path) {
  const h = createHash('sha256')
  h.update(readFileSync(path))
  return h.digest('hex')
}

/**
 * 读并哈希；读不到就**响亮**返回错误而不是崩栈。
 * 为什么需要：这个仓库同时有别的进程在写（教室真源与镜像随时可能正在被重新生成），
 * 「列目录」与「读文件」之间文件消失是真实存在的竞态 —— 它必须被报成一条**判红**，
 * 而不是让整个脚本以未捕获异常退出（那样看不到后面任何一步的结论）。
 */
function sha256OrError(path) {
  try {
    return { hash: sha256Of(path) }
  } catch (error) {
    return { error: `${error.code ?? error.name}：${error.message}` }
  }
}

/**
 * sha256 全文件比对两个目录（排除 .DS_Store），返回 { match, diffs, count }。
 * 读不到的文件（含坏掉的符号链接、比对期间被删掉的文件）也算 diff，并带上原因。
 */
function dirsIdentical(a, b) {
  const relA = listFiles(a)
  const relB = listFiles(b)
  const setA = new Set(relA)
  const setB = new Set(relB)
  const diffs = []
  for (const rel of relA) if (!setB.has(rel)) diffs.push(`仅源有：${rel}`)
  for (const rel of relB) if (!setA.has(rel)) diffs.push(`仅镜像有：${rel}`)
  for (const rel of relA) {
    if (!setB.has(rel)) continue
    const ra = sha256OrError(join(a, rel))
    const rb = sha256OrError(join(b, rel))
    if (ra.error !== undefined) diffs.push(`源读不到：${rel}（${ra.error}）`)
    if (rb.error !== undefined) diffs.push(`镜像读不到：${rel}（${rb.error}）`)
    if (ra.error === undefined && rb.error === undefined && ra.hash !== rb.hash) diffs.push(`内容不同：${rel}`)
  }
  return { match: diffs.length === 0, diffs, count: relA.length }
}

/**
 * 按扩展名递归找文件（用于语法检查这类"按盘上实际内容列举"的场景）。
 * `skipDirs` 里的目录名在**任意层级**都被跳过（依赖目录/未分发的第三方资产）。
 */
function findFilesByExt(rootDir, exts, skipDirs) {
  const out = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.DS_Store') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (skipDirs.has(e.name)) continue
        walk(p)
      } else if (e.isFile() && exts.has(p.slice(p.lastIndexOf('.')))) {
        out.push(p)
      }
    }
  }
  walk(rootDir)
  return out.sort()
}

/** 把一个 script 命令拆成"要落盘存在的目标"；找不到任何文件的目标才算缺失。 */
function missingScriptTargets(pkgDir, command) {
  const tokens = String(command).split(/\s+/).filter((t) => t && !t.startsWith('-'))
  const targets = tokens.filter((t) => t !== 'node' && !t.includes('=') && /[./]/.test(t))
  const missing = []
  for (const t of targets) {
    const abs = resolve(pkgDir, t)
    if (existsSync(abs)) continue
    // glob（如 test/*.test.mjs）：展开后必须有命中，否则这条 script 跑不起来
    if (t.includes('*')) {
      const dir = dirname(abs)
      const pattern = abs.slice(dir.length + 1)
      const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$')
      const hit = existsSync(dir) && readdirSync(dir).some((n) => re.test(n))
      if (hit) continue
      missing.push(`${t}（glob 零命中）`)
      continue
    }
    // 引擎/技能包里的无扩展名入口（如 `node validate`）→ 允许同名带扩展的文件
    if (!/\.[a-z0-9]+$/i.test(t) && ['.mjs', '.js', '.cjs'].some((x) => existsSync(abs + x))) continue
    missing.push(t)
  }
  return missing
}

// ── ① 技能自检 ──────────────────────────────────────────────────────────────
section('① 技能自检 skills/socratic-classroom/validate')
{
  const validate = join(ROOT, 'skills/socratic-classroom/validate')
  const r = runNode(validate, [])
  log(r.stdout.trim())
  if (r.status !== 0) {
    failures++
    log(`  ✗ validate 退出码 ${r.status}`)
  } else {
    log('  ✓ validate 退出码 0')
  }
}

// ── ② 真源 ↔ 镜像 字节一致 ───────────────────────────────────────────────────
section('② 教室真源(classrooms/cs-os) ↔ 技能镜像(skills/socratic-classroom/classroom)')
{
  const src = join(ROOT, 'classrooms/cs-os')
  const mir = join(ROOT, 'skills/socratic-classroom/classroom')
  if (!existsSync(src) || !existsSync(mir)) {
    failures++
    log('  ✗ 源或镜像目录缺失')
  } else {
    const { match, diffs, count } = dirsIdentical(src, mir)
    if (match) log(`  ✓ 两个目录 ${count} 个文件 sha256 全部一致（镜像＝真源的生成副本）`)
    else {
      failures++
      log(`  ✗ 不一致（共 ${count} 个文件）：`)
      for (const d of diffs) log('    - ' + d)
    }
  }
}

if (onlySkill) {
  section('仅跑技能相关检查（--skill）')
} else {
  // ── ③ Live2D 宿主：静态完整性 ────────────────────────────────────────────────
  section('③ Live2D 宿主静态完整性 clients/live2d-host')
  {
    const pkgDir = join(ROOT, 'clients/live2d-host')
    const pkgJson = join(pkgDir, 'package.json')
    if (!existsSync(pkgJson)) {
      failures++
      log(`  ✗ 缺 ${relative(ROOT, pkgJson)}（无法判"脚本目标是否都在盘上"）`)
    } else {
      let pkg = null
      try {
        pkg = JSON.parse(readFileSync(pkgJson, 'utf8'))
      } catch (error) {
        failures++
        log(`  ✗ ${relative(ROOT, pkgJson)} 解析失败：${error.message}`)
      }
      const scripts = pkg?.scripts ?? {}
      const names = Object.keys(scripts)
      if (names.length === 0) {
        failures++
        log('  ✗ package.json 没有声明任何 script（没有可判的目标）')
      } else {
        const broken = []
        for (const name of names) {
          const missing = missingScriptTargets(pkgDir, scripts[name])
          if (missing.length > 0) broken.push(`${name} → ${missing.join('、')}`)
        }
        if (broken.length === 0) {
          log(`  ✓ ${names.length} 个 script 的目标文件全部在盘上：${names.join(' / ')}`)
        } else {
          failures++
          log(`  ✗ 有 script 的目标不存在（${broken.length}/${names.length}）：`)
          for (const b of broken) log('    - ' + b)
        }
      }

      // vendor/ 与 samples/ 未随仓库分发 → 依赖它们的两条 script 明确记 N/A。
      const UNAVAILABLE = ['vendor', 'samples']
      const absent = UNAVAILABLE.filter((d) => !existsSync(join(pkgDir, d)))
      const naScripts = ['build', 'capability'].filter((n) => n in scripts)
      if (absent.length > 0 && naScripts.length > 0) {
        log(
          `  ⚠ N/A（不算通过，也不算失败）：${absent.join('／')} 未随本仓库分发 → ` +
            `${naScripts.map((n) => `\`npm run ${n}\``).join('、')} 在本仓库跑不起来。` +
            '本步只判它们的脚本目标是否在盘上 ＋ 逐文件语法检查；真跑要在补齐资产的环境里做。',
        )
      } else if (absent.length === 0) {
        log('  · vendor/ 与 samples/ 都在盘上 → 上面那两条 script 的 N/A 不适用（可在本机真跑）。')
      }

      // 逐文件语法检查（文件数按盘上实际内容列举，不写死）。
      const exts = new Set(['.js', '.cjs', '.mjs'])
      const skipDirs = new Set(['node_modules', 'vendor'])
      const files = findFilesByExt(pkgDir, exts, skipDirs)
      if (files.length === 0) {
        failures++
        log('  ✗ 一个 JS/CJS/MJS 都没找到（语法检查会变成空壳，故判失败）')
      } else {
        const syntaxBad = []
        for (const f of files) {
          const r = spawnSync(NODE, ['--check', f], { cwd: ROOT, encoding: 'utf8' })
          if (r.error) throw r.error
          if (r.status !== 0) syntaxBad.push(`${relative(ROOT, f)}：${(r.stderr ?? '').trim().split('\n')[0]}`)
        }
        if (syntaxBad.length === 0) {
          log(`  ✓ ${files.length} 个 JS/CJS/MJS 全部通过 node --check（跳过 node_modules/、vendor/）`)
        } else {
          failures++
          log(`  ✗ ${syntaxBad.length}/${files.length} 个文件语法检查失败：`)
          for (const b of syntaxBad) log('    - ' + b)
        }
      }
    }
  }

  // ── ④ 客户端插件测试：inject-hide ───────────────────────────────────────────
  section('④ 客户端插件测试 clients/inject-hide (npm test)')
  {
    const pkgDir = join(ROOT, 'clients/inject-hide')
    if (!existsSync(join(pkgDir, 'package.json'))) {
      failures++
      log('  ✗ clients/inject-hide/package.json 不存在')
    } else {
      const r = runNpmTest(pkgDir)
      log(r.stdout.trim())
      if (r.status !== 0) {
        failures++
        log(`  ✗ 退出码 ${r.status}`)
      } else {
        log('  ✓ 退出码 0')
      }
    }
  }

  // ── ⑤ 客户端面板测试（含白板服务端两个独立断言集）────────────────────────────
  section('⑤ 客户端面板测试 clients/classroom-ui')
  {
    runCheckStep({
      label: '面板 panel.test.mjs',
      entry: join(ROOT, 'clients/classroom-ui/test/panel.test.mjs'),
    })
    runCheckStep({
      label: '白板服务端 whiteboard.test.mjs',
      entry: join(ROOT, 'clients/classroom-ui/test/whiteboard.test.mjs'),
    })
    runCheckStep({
      label: '白板路由 whiteboard-route.test.mjs',
      entry: join(ROOT, 'clients/classroom-ui/test/whiteboard-route.test.mjs'),
    })
  }

  // ── ⑥ 舞台离线自检（不装 profile、不起服务、不联网）─────────────────────────
  section('⑥ 舞台离线自检 clients/classroom-stage-warm (check.sh)')
  {
    const pkgDir = join(ROOT, 'clients/classroom-stage-warm')
    const script = join(pkgDir, 'check.sh')
    if (!existsSync(script)) {
      failures++
      log('  ✗ clients/classroom-stage-warm/check.sh 不存在')
    } else {
      const r = spawnSync('bash', ['check.sh'], {
        cwd: pkgDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      if (r.error) throw r.error
      const out = (r.stdout ?? '').trim()
      if (out) log(out)
      if (r.status !== 0) {
        failures++
        log(`  ✗ 退出码 ${r.status}`)
        if ((r.stderr ?? '').trim()) log((r.stderr ?? '').trim())
      } else {
        log('  ✓ 退出码 0')
      }
    }
  }

  // ── ⑦ 验收流水线：静态三守卫 + dynamic-blocks（不跑会话、不花钱）──────────────
  section('⑦ 验收机核 acceptance/（静态三守卫 ＋ A2 运行期动态块）')
  {
    const guards = [
      ['写足迹守卫自检 footprint-self-test.mjs', 'footprint-self-test.mjs'],
      ['宿主告警白名单自检 whitelist-self-test.mjs', 'whitelist-self-test.mjs'],
      ['频率语义两处实现比对 frequency-parity.mjs', 'frequency-parity.mjs'],
      ['A2 运行期动态块 dynamic-blocks.test.mjs', 'dynamic-blocks.test.mjs'],
    ]
    for (const [label, file] of guards) {
      runCheckStep({ label, entry: join(ROOT, 'acceptance', file) })
    }
  }

  // ── ⑧ 引擎单元测试 ──────────────────────────────────────────────────────────
  section('⑧ 引擎单元测试 plugins/socratic-engine (npm test)')
  {
    const pkg = join(ROOT, 'plugins/socratic-engine')
    const nodeModules = join(pkg, 'node_modules')
    if (!existsSync(nodeModules)) {
      log('  ⚠ 未检测到依赖（plugins/socratic-engine/node_modules）。请先在该目录 `npm ci`，再跑本步。')
      failures++
    } else {
      // 走 npm test（引擎的 package.json 已声明 "test"（= node --test ..））。
      // 跨平台用 shell:true 让 npm.cmd / npm 都能被解析到。
      const r = runNpmTest(pkg)
      if (r.status !== 0) {
        failures++
        log(r.stdout.trim())
        log(`  ✗ 退出码 ${r.status}`)
      } else {
        log(r.stdout.trim())
        log('  ✓ 退出码 0')
      }
    }
  }
}

section('结论')
if (failures === 0) {
  log('全部通过（退出码 0）')
  process.exit(0)
} else {
  log(`发现 ${failures} 项失败（退出码 1）`)
  process.exit(1)
}
