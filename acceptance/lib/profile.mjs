// lib/profile.mjs — 阶段② 装载：专用测试 profile 的创建、装载、逐文件哈希复核
//
// 🔴 三条纪律（违反即失败）：
//   ① `web` 与桌面 profile **零接触**：不读之外的写操作、不装、不启动。
//      本模块用 FORBIDDEN_PROFILES 做三重自检（创建前、删除前、路径断言）。
//   ② 装完**必须逐文件核对哈希**（profile 里的文件 vs 冻结目录），不一致就失败退出。
//   ③ **绝不把任何 `@deepseek-ai/*` 包装进 profile 或插件的 node_modules**
//      （会造成宿主包双实例、Symbol 失配 → 工具调用崩溃）。装完显式检查。
//
// 为什么优先用**专用 profile**（socratic-accept）而不是复用 socratic-headless：
//   复用会让"验收跑出的结论"与"开发时手工改过的状态"混在一起；
//   专用 profile 每次从 shipped 模板 headless 重建 → 每跑一次都是干净起点。

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  ACCEPT_PROFILE,
  DSH_BIN,
  DSH_HOME,
  FORBIDDEN_PROFILES,
  ensureDir,
  hashTree,
  runNode,
  shallowSnapshot,
  writeJson,
  writeText,
} from './util.mjs'
import { compareTrees } from './freeze.mjs'
// 🔴 ACCEPT-4：删专用 profile 目录也走 ledger（写足迹要完整）
import { ledgerRemove } from './footprint.mjs'

/** profile 目录绝对路径。 */
export function profileDir(name = ACCEPT_PROFILE) {
  return join(DSH_HOME, 'profiles', name)
}

/** 名字自检：永不许把 web/桌面 profile 当成我们的目标。 */
export function assertSafeProfileName(name) {
  const lower = name.toLowerCase()
  if (FORBIDDEN_PROFILES.includes(lower)) {
    throw new Error(`🔴 拒绝操作受保护 profile：${name}（web/桌面零接触是硬纪律）`)
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(`profile 名不合法（只允许小写字母数字与连字符）：${name}`)
  }
  return name
}

/**
 * 🔴 校验 profile 里的 `file:` 依赖**还指得着东西**（`--keep-profile` 复用时必查）。
 *
 * 为什么必须查：本流水线每次运行都会把插件冻结到 `acceptance/runs/<时间戳>/frozen/…`，
 * 而 `dsh plugin add file:<冻结目录>` 会把**那个绝对路径**写进 profile 的 `package.json`。
 * 于是"复用上一轮的 profile"＝复用一条指向**上一轮 run 目录**的依赖：
 *   · 那个目录被清掉（`runs/` 是运行产物，随时可能被删）→ 依赖悬空，pnpm 解析失败或
 *     留着旧的 `node_modules` 软链 → **跑的是哪一份**变成不可知；
 *   · 那个目录还在、但不是本次的冻结目录 → 复用等于**在测上一轮那份源码**（静默测错东西）。
 * 两种都不许悄悄发生 → 复用前逐条查，不合就**拒绝复用**（要求重建，或先删 profile）。
 *
 * @param {string} dir - profile 目录
 * @param {string|null} expectedPluginDir - 本次的冻结插件目录（须与 profile 里那条一致）
 * @returns {{ok:boolean, entries:Array<object>, problems:string[]}}
 */
export function verifyProfileFileDeps(dir, expectedPluginDir = null) {
  const pkgFile = join(dir, 'package.json')
  if (!existsSync(pkgFile)) {
    return { ok: false, entries: [], problems: [`profile 缺 package.json：${pkgFile}`] }
  }
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
  const entries = []
  const problems = []
  for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
    if (typeof spec !== 'string' || !spec.startsWith('file:')) continue
    const target = resolve(dir, spec.slice('file:'.length))
    const exists = existsSync(target)
    const isCurrent = expectedPluginDir !== null && resolve(expectedPluginDir) === target
    entries.push({ name, spec, target, exists, isCurrent })
    if (!exists) {
      problems.push(`\`${name}\` 的 file: 依赖指向一个**不存在的目录**：${target}（那个 run 目录已被清掉？）`)
    } else if (expectedPluginDir !== null && !isCurrent) {
      problems.push(
        `\`${name}\` 的 file: 依赖指向**别的目录**：${target}\n` +
          `      本次的冻结目录是：${resolve(expectedPluginDir)} → 复用会在测上一轮那份源码`,
      )
    }
  }
  return { ok: problems.length === 0, entries, problems }
}

/**
 * 用 shipped 模板建一个全新的专用 profile。
 * 走的是 CLI 自己的 `--from-default-profile`（不是手写 package.json），
 * 所以 bundle 清单与 patchReload 都是安装版的原生口径。
 * @param {{name?:string, template?:string, fresh?:boolean, logFile:string, expectPluginDir?:string|null}} opts
 */
export function ensureProfile(opts) {
  const name = assertSafeProfileName(opts.name ?? ACCEPT_PROFILE)
  const template = opts.template ?? 'headless'
  const dir = profileDir(name)
  const logFile = opts.logFile
  const steps = []
  let reusedFileDeps = null

  if (opts.fresh !== false && existsSync(dir)) {
    // 自检：即将删除的路径必须真的在 profiles/ 下、且名字不是受保护 profile
    const expected = join(DSH_HOME, 'profiles', name)
    if (dir !== expected) throw new Error(`🔴 删除路径自检失败：${dir} !== ${expected}`)
    assertSafeProfileName(name)
    ledgerRemove(dir, {}, { source: 'profile.ensureProfile 重建专用 profile' })
    steps.push({ action: 'rm -rf', dir })
  }

  if (!existsSync(join(dir, 'package.json'))) {
    // 🔴 用 --dump-config：它会 prepareProfile(...) 完成初始化，但不 boot 应用
    const res = runNode([DSH_BIN, '--profile', name, '--from-default-profile', template, '--dump-config'])
    steps.push({ action: `init --from-default-profile ${template}`, code: res.code, cmd: res.cmd })
    writeText(logFile, `$ ${res.cmd}\n[exit ${res.code}]\n--- stdout (前 4000 字符) ---\n${res.stdout.slice(0, 4000)}\n--- stderr ---\n${res.stderr}\n`)
    if (res.code !== 0) throw new Error(`profile 初始化失败（exit ${res.code}）：见 ${logFile}`)
  } else {
    // 🔴 复用路径（`--keep-profile`）：**先查 file: 依赖还指得着不指得着**再决定复不复用。
    const fileDeps = verifyProfileFileDeps(dir, opts.expectPluginDir ?? null)
    reusedFileDeps = fileDeps
    steps.push({ action: 'profile 已存在（fresh=false）', dir, fileDeps: fileDeps.entries })
    if (!fileDeps.ok) {
      throw new Error(
        `🔴 拒绝复用这个 profile：它的 file: 依赖已经不可信 ——\n- ${fileDeps.problems.join('\n- ')}\n` +
          `  （复用会变成"在测上一轮那份冻结源码"或"依赖悬空"，两种都不许悄悄发生。）\n` +
          `  改法：① 去掉 --keep-profile（默认每次从 shipped 模板重建）；或 ② 先删掉 ${dir} 再跑。`,
      )
    }
  }

  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  return {
    name,
    template,
    dir,
    bundles: manifest.dsh?.profile?.bundles ?? [],
    patchReload: manifest.dsh?.profile?.patchReload ?? null,
    dependencies: manifest.dependencies ?? {},
    reusedFileDeps,
    steps,
  }
}

/**
 * 把**冻结的那一份**插件装进 profile（`file:` 协议——铁律②）。
 * 🔴 不用 `link:`：link 会让插件从自己路径解析，找不到宿主核心包。
 * @returns {{ok:boolean, code:number, logFile:string}}
 */
export function installFrozenPlugin(profileName, frozenPluginDir, logFile) {
  assertSafeProfileName(profileName)
  const res = runNode([DSH_BIN, 'plugin', '--profile', profileName, 'add', `file:${frozenPluginDir}`])
  writeText(
    logFile,
    `$ ${res.cmd}\n[exit ${res.code}]\n\n--- stdout ---\n${res.stdout}\n\n--- stderr ---\n${res.stderr}\n`,
  )
  return { ok: res.code === 0, code: res.code, logFile, cmd: res.cmd }
}

/**
 * 🔴 装完逐文件核对哈希：profile 里的安装副本 vs 冻结目录。
 * @returns {object} compareTrees 的结果 ＋ 安装副本文件数
 */
export function verifyInstalledHashes(profileName, frozenPluginDir, pkgName) {
  assertSafeProfileName(profileName)
  const installedDir = join(profileDir(profileName), 'node_modules', pkgName)
  if (!existsSync(installedDir)) {
    return { ok: false, checked: 0, mismatched: [{ rel: '<安装副本缺失>', reason: installedDir }], frozenOnly: [], installedOnly: [] }
  }
  return { ...compareTrees(installedDir, frozenPluginDir), installedDir }
}

/**
 * 🔴 铁律③检查：profile 自己与插件的 node_modules 里不许出现宿主核心包。
 * @returns {{ok:boolean, offenders:string[], note:string}}
 */
export function assertNoHostPackages(profileName, pkgName) {
  assertSafeProfileName(profileName)
  const dir = profileDir(profileName)
  const offenders = []
  const targets = [
    join(dir, 'node_modules', '@deepseek-ai'),
    join(dir, 'node_modules', pkgName, 'node_modules', '@deepseek-ai'),
  ]
  for (const target of targets) {
    if (!existsSync(target)) continue
    let entries = []
    try {
      entries = readdirSync(target)
    } catch {
      continue
    }
    for (const entry of entries) offenders.push(`${target}/${entry}`)
  }
  return {
    ok: offenders.length === 0,
    offenders,
    note:
      offenders.length === 0
        ? 'profile 自身的 node_modules 与插件 node_modules 里都没有 @deepseek-ai/*（宿主包由安装版回退目录提供，不进 profile）'
        : '🔴 发现宿主包被装进了 profile/插件 node_modules —— 会造成双实例与 Symbol 失配',
  }
}

/**
 * 记录 profile 安装副本的 inode/link 数——这是"硬链接镜像"的直接证据，
 * 也是本流水线**不依赖**硬链接（而依赖逐文件哈希复核）的理由。
 */
export function hardlinkEvidence(profileName, frozenPluginDir, pkgName) {
  assertSafeProfileName(profileName)
  const installedDir = join(profileDir(profileName), 'node_modules', pkgName)
  if (!existsSync(installedDir)) return { available: false }
  const installed = hashTree(installedDir)
  const frozen = hashTree(frozenPluginDir)
  const rows = []
  for (const rel of Object.keys(installed.map)) {
    const a = installed.map[rel]
    const b = frozen.map[rel]
    if (b === undefined) continue
    rows.push({
      rel,
      installedIno: a.ino,
      frozenIno: b.ino,
      sameInode: a.ino === b.ino,
      installedNlink: a.nlink,
      frozenNlink: b.nlink,
      sameContent: a.sha256 === b.sha256,
    })
  }
  return {
    available: true,
    installedDir,
    frozenDir: frozenPluginDir,
    sameInodeCount: rows.filter((r) => r.sameInode).length,
    sameContentCount: rows.filter((r) => r.sameContent).length,
    rows,
  }
}

/** 快照 profile 顶层（零接触证据用）。 */
export function snapshotProfile(name) {
  return shallowSnapshot(profileDir(name))
}

/** 把 profile 的关键文件（package.json / cordis.patch.yml）落盘留证。 */
export function saveProfileConfig(profileName, outDir) {
  const dir = profileDir(profileName)
  const saved = {}
  for (const rel of ['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml']) {
    const file = join(dir, rel)
    if (!existsSync(file)) continue
    saved[rel] = writeText(join(outDir, rel.replaceAll('/', '__')), readFileSync(file, 'utf8'))
  }
  writeJson(join(outDir, 'profile-summary.json'), {
    name: profileName,
    dir,
    saved,
    nodeModulesHostScope: existsSync(join(dir, 'node_modules', '@deepseek-ai'))
      ? readdirSync(join(dir, 'node_modules', '@deepseek-ai'))
      : null,
  })
  return saved
}

/** 确保 runs 目录存在。 */
export function ensureRunDir(runDir) {
  return ensureDir(runDir)
}
