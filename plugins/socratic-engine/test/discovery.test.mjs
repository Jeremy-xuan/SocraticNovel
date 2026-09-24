// test/discovery.test.mjs — lib/discovery.mjs 的单元测试（S2 新增）
//
// 🔴 纪律：不启动宿主、不调 LLM、不读网络。用 node:fs 在 os.tmpdir() 下自建临时目录树。
// 运行：/opt/homebrew/bin/node --test test/discovery.test.mjs

import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import {
  registerDiscovery,
  DEFAULT_SEARCH_DEPTH,
  OUTSIDE_ROOT_DEPTH,
  compareCandidates,
  discoverClassrooms,
  formatDiscovery,
  nodeFsAdapter,
  relativeDepth,
} from '../lib/discovery.mjs'

/** @type {string[]} 待清理的临时根 */
const tempRoots = []
/** @type {string[]} 需要恢复权限的目录（否则 rm 失败） */
const chmodBack = []

/**
 * 新建一个空工作区临时目录，返回**规范化路径**（realpath 已跟随）。
 *
 * 🔴 为什么返回规范化路径而不是 `mkdtemp` 的原始返回（FIX-1 改动，2026-09-24）：
 *   macOS 上 `os.tmpdir()` 给的是 `/var/folders/…`，而 `/var` 是 `/private/var` 的符号链接。
 *   `discoverClassrooms` 现在把工作区根与三条来源的候选**统一规范化**（FIX-1 ①④，与真实宿主
 *   `sandboxPolicy.resolve()` 的口径一致），因此候选路径都是 `/private/var/…`。
 *   测试若继续用未规范化的 `ws` 去比对，比的是**测试夹具自己造出来的符号链接差异**，
 *   而不是被测行为 —— 故这里让夹具与宿主同口径。
 *   （原始 mkdtemp 路径仍登记进 tempRoots 供清理；`nodeRealpath` 解析失败的极端情形退回原路径。）
 * @returns {Promise<string>}
 */
async function makeWorkspace() {
  const raw = await mkdtemp(join(tmpdir(), 'socratic-discovery-'))
  tempRoots.push(raw)
  try {
    return await realpath(raw)
  } catch {
    return raw
  }
}

/**
 * 在 workspace 下建一个教室包目录并写 classroom.yaml。
 * @param {string} workspace
 * @param {string} relDir 相对 workspace 的目录
 * @param {object} [manifest] classroom.yaml 内容
 * @returns {Promise<string>} 教室目录绝对路径
 */
async function makeClassroom(workspace, relDir, manifest = { format: 'socratic-classroom/0', classroom: { id: 'x' }, blocks: [] }) {
  const dir = join(workspace, relDir)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'classroom.yaml'), JSON.stringify(manifest), 'utf8')
  return dir
}

/**
 * 建一个「没有 classroom.yaml」的普通目录。
 * @param {string} workspace
 * @param {string} relDir
 * @returns {Promise<string>}
 */
async function makePlainDir(workspace, relDir) {
  const dir = join(workspace, relDir)
  await mkdir(dir, { recursive: true })
  return dir
}

/**
 * 在工作区**之外**建一个教室包目录（用于「显式指定到工作区外」的场景）。
 *
 * 目录仍建在 `os.tmpdir()` 下，与 `makeWorkspace()` 同级 —— 但**不登记**进
 * `makeWorkspace` 的 workspace 树里，故对 `discoverClassrooms` 而言它在工作区根之外。
 * @param {object} [manifest]
 * @returns {Promise<string>} 教室目录绝对路径（已规范化）
 */
async function makeOutsideClassroom(manifest = { format: 'socratic-classroom/0', classroom: { id: 'outside' }, blocks: [] }) {
  const raw = await mkdtemp(join(tmpdir(), 'socratic-outside-'))
  tempRoots.push(raw)
  const dir = join(raw, 'room')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'classroom.yaml'), JSON.stringify(manifest), 'utf8')
  try {
    return await realpath(dir)
  } catch {
    return dir
  }
}

/**
 * 深度优先遍历一个 JSON 值，对每个 number 调 visit。
 * @param {unknown} value
 * @param {(n: number) => void} visit
 */
function walkNumbers(value, visit) {
  if (typeof value === 'number') {
    visit(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) walkNumbers(item, visit)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) walkNumbers(item, visit)
  }
}

/**
 * 复刻宿主对工具输出的「非有限数」判据（见 lib/discovery.mjs 文件头 FIX-1 ②）。
 *
 * 🔴 这里**不 import 宿主包**（单测必须能在无宿主环境跑）。判据逐字取自
 *   `dsh-tools/lib/index.js` 的 `walkJsonValue`：`!Number.isFinite(current)` → 判不合格。
 *   这一层正是既有 110 项单测漏掉 P0 的原因 —— 纯逻辑单测里 `Infinity` 是合法 number。
 * @param {unknown} value
 * @returns {number[]} 所有非有限数（空数组 = 合格）
 */
function findNonFiniteNumbers(value) {
  const bad = []
  walkNumbers(value, (n) => {
    if (!Number.isFinite(n)) bad.push(n)
  })
  return bad
}

/**
 * 建一个不可读目录（mode 0o000），并登记为需要恢复权限。
 * @param {string} workspace
 * @param {string} relDir
 * @returns {Promise<string>}
 */
async function makeUnreadableDir(workspace, relDir) {
  const dir = await makePlainDir(workspace, relDir)
  chmodBack.push(dir)
  await chmod(dir, 0o000)
  return dir
}

after(async () => {
  for (const dir of chmodBack) {
    try {
      await chmod(dir, 0o755)
    } catch {
      /* 清理尽力而为 */
    }
  }
  for (const dir of tempRoots) {
    try {
      await rm(dir, { recursive: true, force: true })
    } catch {
      /* 清理尽力而为 */
    }
  }
})

describe('discoverClassrooms — 候选数量', () => {
  it('0 候选：返回 status=none 且不抛错', async () => {
    const ws = await makeWorkspace()
    await makePlainDir(ws, 'src')
    await makePlainDir(ws, 'docs')

    const result = await discoverClassrooms({ workspaceRoot: ws })

    assert.equal(result.status, 'none')
    assert.equal(result.selected, null)
    assert.deepEqual(result.candidates, [])
    assert.match(result.reason, /未发现任何含 classroom\.yaml 的目录/)
    assert.equal(result.workspaceRoot, ws)
  })

  it('1 候选（约定目录）：status=ok，选中它', async () => {
    const ws = await makeWorkspace()
    const dir = await makeClassroom(ws, 'classrooms/cs-os', { format: 'socratic-classroom/0', classroom: { id: 'cs-os' }, blocks: [] })

    const result = await discoverClassrooms({ workspaceRoot: ws })

    assert.equal(result.status, 'ok')
    assert.equal(result.selected.path, dir)
    assert.equal(result.selected.source, 'convention')
    assert.equal(result.selected.depth, 2)
    assert.equal(result.selected.selected, true)
    assert.match(result.reason, /唯一候选/)
  })

  it('1 候选（深层，非约定目录）：source=deep', async () => {
    const ws = await makeWorkspace()
    const dir = await makeClassroom(ws, 'a/b/lesson', { format: 'socratic-classroom/0', classroom: { id: 'lesson' }, blocks: [] })

    const result = await discoverClassrooms({ workspaceRoot: ws })

    assert.equal(result.status, 'ok')
    assert.equal(result.selected.path, dir)
    assert.equal(result.selected.source, 'deep')
    assert.equal(result.selected.depth, 3)
  })
})

describe('discoverClassrooms — 歧义处理（不静默选一个）', () => {
  it('多候选：全部暴露 + 确定性选中 + 理由可读', async () => {
    const ws = await makeWorkspace()
    const explicit = await makeClassroom(ws, 'vendor/pinned', { format: 'socratic-classroom/0', classroom: { id: 'pinned' }, blocks: [] })
    const convention = await makeClassroom(ws, 'classrooms/main', { format: 'socratic-classroom/0', classroom: { id: 'main' }, blocks: [] })
    const deep = await makeClassroom(ws, 'notes/deep/other', { format: 'socratic-classroom/0', classroom: { id: 'other' }, blocks: [] })

    const result = await discoverClassrooms({ workspaceRoot: ws, explicitDirs: [explicit] })

    assert.equal(result.status, 'ambiguous')
    assert.equal(result.candidates.length, 3)
    // 排序键：显式 > 约定 > 深层
    assert.deepEqual(result.candidates.map((c) => c.source), ['explicit', 'convention', 'deep'])
    assert.equal(result.selected.path, explicit)
    assert.equal(result.candidates.filter((c) => c.selected).length, 1)
    assert.match(result.reason, /按排序键/)
    assert.match(result.reason, /来源=显式指定/)

    // 「其余未选中」必须能拿到
    const rest = result.candidates.filter((c) => !c.selected).map((c) => c.path)
    assert.deepEqual(rest, [convention, deep])
    assert.equal(result.candidates.find((c) => c.path === deep).depth, 3)
  })

  it('多候选且无显式指定：约定目录优先于深层', async () => {
    const ws = await makeWorkspace()
    const convention = await makeClassroom(ws, 'classrooms/main', { format: 'socratic-classroom/0', classroom: { id: 'main' }, blocks: [] })
    await makeClassroom(ws, 'notes/deep/other', { format: 'socratic-classroom/0', classroom: { id: 'other' }, blocks: [] })

    const result = await discoverClassrooms({ workspaceRoot: ws })

    assert.equal(result.status, 'ambiguous')
    assert.equal(result.selected.path, convention)
    assert.equal(result.selected.source, 'convention')
  })

  it('同来源同深度：字典序决定（确定性，不依赖遍历顺序）', async () => {
    const ws = await makeWorkspace()
    const b = await makeClassroom(ws, 'packs/b', { format: 'socratic-classroom/0', classroom: { id: 'b' }, blocks: [] })
    const a = await makeClassroom(ws, 'packs/a', { format: 'socratic-classroom/0', classroom: { id: 'a' }, blocks: [] })

    const result = await discoverClassrooms({ workspaceRoot: ws })

    assert.equal(result.selected.path, a)
    assert.deepEqual(result.candidates.map((c) => c.path), [a, b])
  })

  it('同来源但深度不同：更浅者优先', async () => {
    const ws = await makeWorkspace()
    const shallow = await makeClassroom(ws, 'top', { format: 'socratic-classroom/0', classroom: { id: 'top' }, blocks: [] })
    await makeClassroom(ws, 'top/inner', { format: 'socratic-classroom/0', classroom: { id: 'inner' }, blocks: [] })

    const result = await discoverClassrooms({ workspaceRoot: ws })

    assert.equal(result.selected.path, shallow)
    assert.equal(result.selected.depth, 1)
  })

  it('compareCandidates 是纯函数且给出全序', () => {
    const mk = (path, source, depth) => ({ path, source, depth })
    const list = [mk('/w/z', 'deep', 3), mk('/w/a', 'explicit', 2), mk('/w/b', 'convention', 2), mk('/w/a', 'deep', 1)]
    const sorted = [...list].sort(compareCandidates)
    assert.deepEqual(sorted.map((c) => `${c.source}:${c.depth}:${c.path}`), [
      'explicit:2:/w/a',
      'convention:2:/w/b',
      'deep:1:/w/a',
      'deep:3:/w/z',
    ])
  })

  it('formatDiscovery 明说「发现 N 个 / 已选 X / 理由 Y / 其余」', async () => {
    const ws = await makeWorkspace()
    const a = await makeClassroom(ws, 'classrooms/alpha', { format: 'socratic-classroom/0', classroom: { id: 'alpha' }, blocks: [] })
    const b = await makeClassroom(ws, 'classrooms/beta', { format: 'socratic-classroom/0', classroom: { id: 'beta' }, blocks: [] })

    const text = formatDiscovery(await discoverClassrooms({ workspaceRoot: ws }))

    assert.match(text, /教室发现：2 个候选/)
    assert.match(text, /已选：/)
    assert.match(text, /理由：/)
    assert.match(text, /其余未选中（1 个/)
    assert.ok(text.includes(a) && text.includes(b))
  })
})

describe('discoverClassrooms — 深度上限', () => {
  it('默认上限 3：第 4 层教室不被发现', async () => {
    const ws = await makeWorkspace()
    await makeClassroom(ws, 'l1/l2/l3/deep', { format: 'socratic-classroom/0', classroom: { id: 'deep' }, blocks: [] })

    const result = await discoverClassrooms({ workspaceRoot: ws })

    assert.equal(DEFAULT_SEARCH_DEPTH, 3)
    assert.equal(result.status, 'none')
    assert.equal(result.scanned.maxDepth, 3)
  })

  it('提高上限即可发现第 4 层教室', async () => {
    const ws = await makeWorkspace()
    const dir = await makeClassroom(ws, 'l1/l2/l3/deep', { format: 'socratic-classroom/0', classroom: { id: 'deep' }, blocks: [] })

    const result = await discoverClassrooms({ workspaceRoot: ws, maxDepth: 4 })

    assert.equal(result.status, 'ok')
    assert.equal(result.selected.path, dir)
    assert.equal(result.selected.depth, 4)
  })

  it('node_modules 被默认跳过（不被当作候选）', async () => {
    const ws = await makeWorkspace()
    await makeClassroom(ws, 'node_modules/pkg', { format: 'socratic-classroom/0', classroom: { id: 'pkg' }, blocks: [] })

    const result = await discoverClassrooms({ workspaceRoot: ws })

    assert.equal(result.status, 'none')
  })
})

describe('discoverClassrooms — 健壮性', () => {
  it('缺 classroom.yaml 的目录不算教室（约定目录下不记噪音，深层记 skipped）', async () => {
    const ws = await makeWorkspace()
    await makePlainDir(ws, 'classrooms/not-a-classroom')
    await makePlainDir(ws, 'packs/empty')

    const result = await discoverClassrooms({ workspaceRoot: ws })

    assert.equal(result.status, 'none')
    assert.deepEqual(result.candidates, [])
    // 约定目录下缺 manifest 是常态噪音：不记 skipped
    assert.equal(result.skipped.some((s) => s.path.includes('not-a-classroom')), false)
  })

  it('符号链接目录一律拒绝（不跟随），并记入 skipped', async () => {
    const ws = await makeWorkspace()
    const real = await makeClassroom(ws, 'real-room', { format: 'socratic-classroom/0', classroom: { id: 'real' }, blocks: [] })
    await symlink(real, join(ws, 'classrooms'), 'dir')
    await symlink(real, join(ws, 'linked-room'), 'dir')

    const result = await discoverClassrooms({ workspaceRoot: ws, maxDepth: 1 })

    // 只有真实目录（real-room，depth=1，source=deep）被发现
    assert.equal(result.candidates.length, 1)
    assert.equal(result.selected.path, real)
    const symlinkSkips = result.skipped.filter((s) => s.reason.includes('符号链接'))
    assert.ok(symlinkSkips.length >= 2, `期望至少 2 条符号链接跳过记录，实得 ${symlinkSkips.length}`)
  })

  it('显式指定的符号链接目录：解析到真实目录（realpath）并按 explicit 登记', async () => {
    // 🔴 FIX-1 断言更新（2026-09-24）。旧断言要求「显式符号链接被拒 → 回退 deep 发现真实目录」。
    //    判定：**旧断言在测旧行为，不是实现错了**。理由：
    //      ① FIX-1 让显式路径也走 realpath（与 workspaceRoot／约定／深层统一口径），
    //         realpath 必然跟随**末段**符号链接，这是「口径统一」这个根因修复的直接推论；
    //      ② 真实场景需要的正是这个：I2 §6 的决定性对照里 `classroomDir=/tmp/…` 必须可用
    //         （`/tmp` 是 `/private/tmp` 的符号链接）——「不跟随末段符号链接」会把用户显式配置
    //         的教室判成不可用；
    //      ③ 「拒绝符号链接」这条安全约束的**本意是防止自动扫描走出工作区**（见文件头 ③ 深层扫描），
    //         对**用户显式配置**的路径不适用；自动扫描路径的拒绝行为**未变**，仍由
    //         「符号链接目录一律拒绝（不跟随），并记入 skipped」与「classroom.yaml 本身是符号链接时
    //         不算教室」两条断言守着。
    const ws = await makeWorkspace()
    const real = await makeClassroom(ws, 'real-room', { format: 'socratic-classroom/0', classroom: { id: 'real' }, blocks: [] })
    const link = join(ws, 'link-room')
    await symlink(real, link, 'dir')

    const result = await discoverClassrooms({ workspaceRoot: ws, explicitDirs: [link], maxDepth: 1 })

    // 显式链接被 realpath 解析 → 直接选中真实目录，来源 explicit（不再回退 deep）
    assert.equal(result.selected.path, real)
    assert.equal(result.selected.source, 'explicit')
    // 解析后与 deep 扫描发现的是**同一个路径** → candidates 里去重后只有一条
    assert.equal(result.candidates.length, 1)
    // 显式路径本身不再进 skipped（它被成功解析了，不是「不可用目录」）
    assert.equal(result.skipped.some((s) => s.source === 'explicit'), false)
  })

  it('classroom.yaml 本身是符号链接时不算教室', async () => {
    const ws = await makeWorkspace()
    const real = await makeClassroom(ws, 'real-room', { format: 'socratic-classroom/0', classroom: { id: 'real' }, blocks: [] })
    const fake = await makePlainDir(ws, 'fake-room')
    await symlink(join(real, 'classroom.yaml'), join(fake, 'classroom.yaml'))

    const result = await discoverClassrooms({ workspaceRoot: ws, maxDepth: 1 })

    assert.equal(result.candidates.length, 1)
    assert.equal(result.selected.path, real)
  })

  it('不可读目录被跳过并记录，不中断扫描', async () => {
    const ws = await makeWorkspace()
    const target = await makeClassroom(ws, 'zz-room', { format: 'socratic-classroom/0', classroom: { id: 'zz' }, blocks: [] })
    await makeUnreadableDir(ws, 'aa-blocked')

    const result = await discoverClassrooms({ workspaceRoot: ws, maxDepth: 1 })

    // 关键：扫描没有因为不可读目录而整体失败
    assert.equal(result.selected.path, target)
    const blocked = result.skipped.find((s) => s.path.includes('aa-blocked'))
    assert.ok(blocked, '不可读目录必须出现在 skipped 里')
    assert.match(blocked.reason, /不可读/)
  })

  it('工作区根不存在：返回 problems + status=none，不抛错', async () => {
    const ws = await makeWorkspace()
    const missing = join(ws, 'nope')

    const result = await discoverClassrooms({ workspaceRoot: missing })

    assert.equal(result.status, 'none')
    assert.equal(result.candidates.length, 0)
    assert.equal(result.problems.length, 1)
    assert.match(result.problems[0], /不是可读目录/)
  })
})

describe('discoverClassrooms — 显式指定', () => {
  it('显式指定优先于约定目录与深层', async () => {
    const ws = await makeWorkspace()
    const explicit = await makeClassroom(ws, 'vendor/pinned', { format: 'socratic-classroom/0', classroom: { id: 'pinned' }, blocks: [] })
    await makeClassroom(ws, 'classrooms/main', { format: 'socratic-classroom/0', classroom: { id: 'main' }, blocks: [] })

    const result = await discoverClassrooms({ workspaceRoot: ws, explicitDirs: [explicit] })

    assert.equal(result.selected.path, explicit)
    assert.equal(result.selected.source, 'explicit')
  })

  it('显式指定可以直接给 classroom.yaml 文件路径', async () => {
    const ws = await makeWorkspace()
    const dir = await makeClassroom(ws, 'vendor/pinned', { format: 'socratic-classroom/0', classroom: { id: 'pinned' }, blocks: [] })

    const result = await discoverClassrooms({ workspaceRoot: ws, explicitDirs: [join(dir, 'classroom.yaml')] })

    assert.equal(result.selected.path, dir)
    assert.equal(result.selected.source, 'explicit')
  })

  it('显式指定不存在的目录：记 skipped，扫描继续', async () => {
    const ws = await makeWorkspace()
    const dir = await makeClassroom(ws, 'classrooms/main', { format: 'socratic-classroom/0', classroom: { id: 'main' }, blocks: [] })

    const result = await discoverClassrooms({ workspaceRoot: ws, explicitDirs: [join(ws, 'ghost')] })

    assert.equal(result.selected.path, dir)
    assert.ok(result.skipped.some((s) => s.source === 'explicit' && s.path.endsWith('ghost')))
  })

  it('显式指定目录但缺 manifest：记 skipped 且不算候选', async () => {
    const ws = await makeWorkspace()
    const empty = await makePlainDir(ws, 'vendor/empty')

    const result = await discoverClassrooms({ workspaceRoot: ws, explicitDirs: [empty] })

    assert.equal(result.status, 'none')
    assert.ok(result.skipped.some((s) => s.source === 'explicit' && /没有 classroom\.yaml/.test(s.reason)))
  })

  it('相对路径的显式指定按 workspaceRoot 解析', async () => {
    const ws = await makeWorkspace()
    const dir = await makeClassroom(ws, 'vendor/pinned', { format: 'socratic-classroom/0', classroom: { id: 'pinned' }, blocks: [] })

    const result = await discoverClassrooms({ workspaceRoot: ws, explicitDirs: ['vendor/pinned'] })

    assert.equal(result.selected.path, dir)
  })
})

describe('适配器', () => {
  it('nodeFsAdapter 的 lstat 能区分 symlink / directory / file', async () => {
    const ws = await makeWorkspace()
    const real = await makeClassroom(ws, 'real', { format: 'socratic-classroom/0', classroom: { id: 'real' }, blocks: [] })
    const link = join(ws, 'link')
    await symlink(real, link, 'dir')

    const fs = nodeFsAdapter()

    assert.equal((await fs.lstat(real)).type, 'directory')
    assert.equal((await fs.lstat(link)).type, 'symlink')
    assert.equal((await fs.lstat(join(real, 'classroom.yaml'))).type, 'file')
    assert.equal(await fs.lstat(join(ws, 'missing')), undefined)
    // stat 跟随符号链接（与宿主 LocalFileSystem.probe 一致）
    assert.equal((await fs.stat(link)).type, 'directory')
  })

  it('nodeFsAdapter.listDir 返回 name+type，且不跟随符号链接', async () => {
    const ws = await makeWorkspace()
    const real = await makeClassroom(ws, 'real', { format: 'socratic-classroom/0', classroom: { id: 'real' }, blocks: [] })
    await symlink(real, join(ws, 'link'), 'dir')
    await makePlainDir(ws, 'plain')

    const entries = await nodeFsAdapter().listDir(ws)
    const byName = Object.fromEntries(entries.map((e) => [e.name, e.type]))

    assert.equal(byName.link, 'symlink')
    assert.equal(byName.plain, 'directory')
    assert.equal(byName.real, 'directory')
  })
})

/**
 * 造一个最小 ctx + 假 defineTool，用来验证工具注册与 execute 契约。
 *
 * 提为文件级 helper（FIX-1，2026-09-24）：新增的「宿主校验层等价断言」也要用它。
 * 行为与原先 describe 内的同名局部函数逐字一致。
 * @param {string} ws 工作区根
 * @returns {{ctx: object, tools: object[], fakeDefineTool: Function}}
 */
function makeHarness(ws) {
  const tools = []
  const ctx = {
    get: () => undefined, // 强制走 node:fs 兜底适配器
    tools: { register: (tool) => tools.push(tool) },
    logger: () => {},
  }
  const fakeDefineTool = (options) => options
  return { ctx, tools, fakeDefineTool }
}

describe('registerDiscovery — 工具注册（不启动宿主）', () => {
  it('注册 classroom_list，execute 返回值符合 output.schema 的字段集', async () => {
    const ws = await makeWorkspace()
    const dir = await makeClassroom(ws, 'classrooms/alpha', { format: 'socratic-classroom/0', classroom: { id: 'alpha' }, blocks: [] })
    const { ctx, tools, fakeDefineTool } = makeHarness(ws)

    registerDiscovery(ctx, { workspaceRoot: ws, defineTool: fakeDefineTool })

    assert.equal(tools.length, 1)
    const tool = tools[0]
    assert.equal(tool.name, 'classroom_list')
    // defineTool 的两个必填项都在（缺 output 会报 reading 'render'）
    assert.equal(typeof tool.output.schema, 'object')
    assert.equal(typeof tool.output.render, 'function')

    const value = await tool.execute({ refresh: true }, { agent: { session: { header: { cwd: ws } } } })

    // output.schema 用 additionalProperties:false → 返回不能多字段
    assert.deepEqual(Object.keys(value).sort(), [
      'candidates', 'problems', 'reason', 'selected', 'skipped', 'status', 'summary', 'workspaceRoot',
    ])
    assert.equal(value.status, 'ok')
    assert.equal(value.selected, dir)
    assert.equal(value.candidates.length, 1)
    assert.equal(value.candidates[0].selected, true)
    assert.match(value.summary, /教室发现：1 个候选/)

    // render 消费 summary
    const blocks = tool.output.render({}, value)
    assert.equal(blocks[0].type, 'text')
    assert.equal(blocks[0].text, value.summary)
  })

  it('多候选时工具输出把「未选中的」暴露给模型', async () => {
    const ws = await makeWorkspace()
    const a = await makeClassroom(ws, 'classrooms/alpha', { format: 'socratic-classroom/0', classroom: { id: 'alpha' }, blocks: [] })
    const b = await makeClassroom(ws, 'classrooms/beta', { format: 'socratic-classroom/0', classroom: { id: 'beta' }, blocks: [] })
    const { ctx, tools, fakeDefineTool } = makeHarness(ws)

    registerDiscovery(ctx, { workspaceRoot: ws, defineTool: fakeDefineTool })
    const value = await tools[0].execute({ refresh: true }, {})

    assert.equal(value.status, 'ambiguous')
    assert.equal(value.selected, a)
    assert.deepEqual(value.candidates.map((c) => c.path), [a, b])
    assert.equal(value.candidates.filter((c) => c.selected).length, 1)
    assert.match(value.summary, /其余未选中（1 个/)
    assert.ok(value.summary.includes(b), '未选中的候选必须出现在给模型的文本里')
  })

  it('未传 defineTool 时不注册工具，但仍能发现并回调', async () => {
    const ws = await makeWorkspace()
    await makeClassroom(ws, 'classrooms/alpha', { format: 'socratic-classroom/0', classroom: { id: 'alpha' }, blocks: [] })
    const { ctx, tools } = makeHarness(ws)
    /** @type {object[]} */
    const seen = []

    const discovery = registerDiscovery(ctx, { workspaceRoot: ws, onDiscovered: (r) => { seen.push(r) } })

    assert.equal(tools.length, 0)
    const result = await discovery.run()
    assert.equal(result.status, 'ok')
    assert.equal(seen.length, 1)
    assert.equal(seen[0].status, 'ok')
  })

  it('initialDir（= config.classroomDir）作为显式指定参与排序', async () => {
    const ws = await makeWorkspace()
    const pinned = await makeClassroom(ws, 'vendor/pinned', { format: 'socratic-classroom/0', classroom: { id: 'pinned' }, blocks: [] })
    await makeClassroom(ws, 'classrooms/main', { format: 'socratic-classroom/0', classroom: { id: 'main' }, blocks: [] })
    const { ctx, tools, fakeDefineTool } = makeHarness(ws)

    registerDiscovery(ctx, { workspaceRoot: ws, initialDir: pinned, defineTool: fakeDefineTool })
    const value = await tools[0].execute({ refresh: true }, {})

    assert.equal(value.status, 'ambiguous')
    assert.equal(value.selected, pinned)
    assert.equal(value.candidates[0].source, 'explicit')
  })

  it('refresh=false 且已有缓存时不重扫（返回上次结果）', async () => {
    const ws = await makeWorkspace()
    await makeClassroom(ws, 'classrooms/alpha', { format: 'socratic-classroom/0', classroom: { id: 'alpha' }, blocks: [] })
    const { ctx, tools, fakeDefineTool } = makeHarness(ws)

    const discovery = registerDiscovery(ctx, { workspaceRoot: ws, defineTool: fakeDefineTool })
    const first = await discovery.run()
    // 扫描后新增一个教室：不 refresh 时结果应保持不变
    await makeClassroom(ws, 'classrooms/beta', { format: 'socratic-classroom/0', classroom: { id: 'beta' }, blocks: [] })

    const cached = await tools[0].execute({ refresh: false }, {})
    assert.equal(cached.candidates.length, first.candidates.length)

    const refreshed = await tools[0].execute({ refresh: true }, {})
    assert.equal(refreshed.candidates.length, 2)
  })

  it('0 候选时工具返回明确状态而不是抛错', async () => {
    const ws = await makeWorkspace()
    const { ctx, tools, fakeDefineTool } = makeHarness(ws)

    registerDiscovery(ctx, { workspaceRoot: ws, defineTool: fakeDefineTool })
    const value = await tools[0].execute({ refresh: true }, {})

    assert.equal(value.status, 'none')
    assert.equal(value.selected, '')
    assert.deepEqual(value.candidates, [])
    assert.match(value.summary, /0 个候选/)
  })
})

// ---------------------------------------------------------------------------
// FIX-1（2026-09-24）新增：P0「显式 classroomDir 时 classroom_list 整体失败」
//   依据 取证_I2_集成实测_2026-09-24.md §6。三个缺陷各一组断言：
//     · relativeDepth 的有限性契约（② 的根）
//     · 显式路径的 realpath 口径统一（① 的根）
//     · 工具输出通过「宿主 lossless-JSON 等价校验」（宿主校验层的单测替身）
//     · skipped 按 path 去重（③）
// ---------------------------------------------------------------------------

describe('relativeDepth — 深度恒为有限整数（FIX-1 ②）', () => {
  it('p === root → 0；root 之下 → 层数', () => {
    assert.equal(relativeDepth('/w', '/w'), 0)
    assert.equal(relativeDepth('/w', '/w/a'), 1)
    assert.equal(relativeDepth('/w', '/w/a/b'), 2)
  })

  it('🔴 p 不在 root 之下 → -1，绝不是 Infinity', () => {
    const depth = relativeDepth('/w', '/elsewhere/a')
    assert.equal(depth, OUTSIDE_ROOT_DEPTH)
    assert.equal(depth, -1)
    assert.ok(Number.isFinite(depth), '深度必须是有限数（宿主拒收非有限数）')
    assert.notEqual(depth, Number.POSITIVE_INFINITY)
  })

  it('符号链接造成的「同一目录两种写法」在深度上表现为「不在 root 下」', () => {
    // /tmp ↔ /private/tmp 是 macOS 的必然不一致；规范化之前 depthOf 会给 Infinity
    assert.equal(relativeDepth('/private/tmp/w', '/tmp/w/classrooms/beta'), OUTSIDE_ROOT_DEPTH)
    // 规范化之后两者一致
    assert.equal(relativeDepth('/private/tmp/w', '/private/tmp/w/classrooms/beta'), 2)
  })

  it('任何输入都不返回非有限数', () => {
    const pairs = [
      ['/', '/a'],
      ['/a', '/'],
      ['/a', '/a/../b'],
      ['/a/b', '/a/b/c/d'],
      ['', '/x'],
      ['/x', ''],
    ]
    for (const [root, p] of pairs) {
      const depth = relativeDepth(root, p)
      assert.ok(Number.isFinite(depth), `relativeDepth(${root}, ${p}) 返回了非有限数 ${depth}`)
      assert.ok(Number.isInteger(depth), `relativeDepth(${root}, ${p}) 返回了非整数 ${depth}`)
    }
  })
})

describe('FIX-1 P0 — 显式 classroomDir 的 realpath 口径统一', () => {
  it('🔴 显式指向 /tmp/… 与 /private/tmp/… 两种写法都返回有限 depth（反向验证）', async () => {
    // /tmp 在 macOS 上是 /private/tmp 的符号链接 —— 这正是 I2 §6 的决定性对照。
    // 用 /tmp 直连（不用 os.tmpdir()，后者已是 /var/folders 规范化形态，测不出这条）。
    const raw = await mkdtemp('/tmp/socratic-fix1-')
    tempRoots.push(raw)
    const canonical = await realpath(raw)
    assert.notEqual(raw, canonical, '前提：/tmp/… 必须与它的 realpath 不同（否则本测试失去意义）')
    const dir = join(raw, 'classrooms', 'beta')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'classroom.yaml'), JSON.stringify({ format: 'socratic-classroom/0', classroom: { id: 'beta' }, blocks: [] }), 'utf8')

    for (const [label, given, root] of [
      ['符号链接写法 /tmp/…', dir, raw],
      ['规范化写法 /private/tmp/…', canonical + '/classrooms/beta', canonical],
    ]) {
      const result = await discoverClassrooms({ workspaceRoot: root, explicitDirs: [given] })

      assert.equal(result.status, 'ok', `${label}：应发现 1 个候选`)
      assert.equal(result.selected.source, 'explicit', `${label}：来源应为 explicit`)
      assert.ok(
        Number.isFinite(result.selected.depth),
        `${label}：depth 必须有限，实得 ${result.selected.depth}`,
      )
      assert.equal(result.selected.depth, 2, `${label}：depth 应为 2（root/classrooms/beta）`)
      // 两种写法必须落到**同一个**规范化路径上（这就是「口径统一」）
      assert.equal(result.selected.path, canonical + '/classrooms/beta', `${label}：路径应被规范化`)
      assert.equal(result.skipped.length, 0, `${label}：不该有 skipped`)
    }
  })

  it('🔴 显式教室在工作区根之外 → depth 是有限整数，工具仍可用（真实上课的常态）', async () => {
    const ws = await makeWorkspace()
    // 再放一个工作区内的教室，使候选数 ≥2 → 理由走「按排序键…」的完整分支（含深度渲染）
    await makeClassroom(ws, 'classrooms/alpha', { format: 'socratic-classroom/0', classroom: { id: 'alpha' }, blocks: [] })
    const outside = await makeOutsideClassroom({ format: 'socratic-classroom/0', classroom: { id: 'outside' }, blocks: [] })
    assert.ok(!outside.startsWith(ws + '/'), '前提：教室必须在工作区根之外')

    const result = await discoverClassrooms({ workspaceRoot: ws, explicitDirs: [outside] })
    const text = formatDiscovery(result)

    assert.equal(result.status, 'ambiguous')
    assert.equal(result.selected.path, outside)
    assert.equal(result.selected.source, 'explicit')
    assert.equal(result.selected.depth, OUTSIDE_ROOT_DEPTH)
    assert.ok(Number.isFinite(result.selected.depth))
    // 理由里给出可读说法，且**不得**把内部哨兵 -1 当成层数写给用户
    assert.match(result.reason, /不在工作区根下/)
    assert.doesNotMatch(result.reason, /距根 -1 层/)
    // 工作区内那个候选的深度仍照旧渲染
    assert.match(text, /距根 2 层/)
    assert.equal(findNonFiniteNumbers(result).length, 0)
  })
})

describe('FIX-1 P0 — 工具输出通过「宿主 lossless-JSON 等价校验」', () => {
  it('🔴 显式 classroomDir 在工作区外时，classroom_list 的返回值无任何非有限数', async () => {
    const ws = await makeWorkspace()
    await makeClassroom(ws, 'classrooms/alpha', { format: 'socratic-classroom/0', classroom: { id: 'alpha' }, blocks: [] })
    const outside = await makeOutsideClassroom({ format: 'socratic-classroom/0', classroom: { id: 'outside' }, blocks: [] })
    const { ctx, tools, fakeDefineTool } = makeHarness(ws)

    registerDiscovery(ctx, { workspaceRoot: ws, initialDir: outside, defineTool: fakeDefineTool })
    const value = await tools[0].execute({ refresh: true }, {})

    // ① 复刻宿主判据：任何非有限数都会让**整份输出**被拒
    assert.deepEqual(
      findNonFiniteNumbers(value),
      [],
      `工具输出含非有限数 → 宿主会判「value is not lossless JSON」并拒收整份输出：${JSON.stringify(value.candidates)}`,
    )
    // ② 反向：逐字段确认 depth 都是有限整数（不是靠「恰好没被遍历到」过关）
    for (const c of value.candidates) {
      assert.ok(Number.isFinite(c.depth), `候选 ${c.path} 的 depth 非有限：${c.depth}`)
      assert.ok(Number.isInteger(c.depth), `候选 ${c.path} 的 depth 非整数：${c.depth}`)
    }
    // ③ 也确认 schema 声明的 `depth: integer` 语义没被破坏
    assert.ok(value.candidates.some((c) => c.depth === OUTSIDE_ROOT_DEPTH), '工作区外的候选应带哨兵深度')
  })

  it('无显式 classroomDir（自动发现）路径同样无任何非有限数', async () => {
    const ws = await makeWorkspace()
    await makeClassroom(ws, 'classrooms/alpha', { format: 'socratic-classroom/0', classroom: { id: 'alpha' }, blocks: [] })
    await makeClassroom(ws, 'notes/nested/gamma', { format: 'socratic-classroom/0', classroom: { id: 'gamma' }, blocks: [] })
    const { ctx, tools, fakeDefineTool } = makeHarness(ws)

    registerDiscovery(ctx, { workspaceRoot: ws, defineTool: fakeDefineTool })
    const value = await tools[0].execute({ refresh: true }, {})

    assert.equal(value.status, 'ambiguous')
    assert.deepEqual(findNonFiniteNumbers(value), [])
  })
})

describe('FIX-1 P2 — skipped 按 path 去重', () => {
  it('🔴 同一个符号链接被「约定目录」与「深层扫描」各遇一次 → 只登记一条', async () => {
    const ws = await makeWorkspace()
    const real = await makeClassroom(ws, 'real-room', { format: 'socratic-classroom/0', classroom: { id: 'real' }, blocks: [] })
    // classrooms/ 是真实目录，里面的 linked 是指向真实教室的符号链接：
    // 约定目录扫描与深层扫描都会遇到它（I2 §5.3 的复现场景）
    await mkdir(join(ws, 'classrooms'), { recursive: true })
    const linked = join(ws, 'classrooms', 'linked')
    await symlink(real, linked, 'dir')

    const result = await discoverClassrooms({ workspaceRoot: ws })

    const linkedSkips = result.skipped.filter((s) => s.path === linked)
    assert.equal(linkedSkips.length, 1, `同一 path 只能有一条 skipped，实得 ${JSON.stringify(result.skipped)}`)
    assert.match(linkedSkips[0].reason, /符号链接/)
    // 去重后「跳过 N 项」不再虚高
    assert.match(formatDiscovery(result), /跳过 1 项/)
  })

  it('不同 path 的 skipped 全部保留（去重不误伤）', async () => {
    const ws = await makeWorkspace()
    await makePlainDir(ws, 'classrooms/not-a-classroom')
    await makeUnreadableDir(ws, 'aa-blocked')

    const result = await discoverClassrooms({ workspaceRoot: ws, maxDepth: 1 })

    const paths = result.skipped.map((s) => s.path)
    assert.equal(new Set(paths).size, paths.length, `skipped 里不应有重复 path：${JSON.stringify(paths)}`)
    assert.ok(paths.some((p) => p.includes('aa-blocked')), '不可读目录仍必须被记录')
  })

  it('去重保留**首次**出现的来源（约定目录优先于深层扫描）', async () => {
    const ws = await makeWorkspace()
    const real = await makeClassroom(ws, 'real-room', { format: 'socratic-classroom/0', classroom: { id: 'real' }, blocks: [] })
    await mkdir(join(ws, 'classrooms'), { recursive: true })
    await symlink(real, join(ws, 'classrooms', 'linked'), 'dir')

    const result = await discoverClassrooms({ workspaceRoot: ws })

    const linked = result.skipped.find((s) => s.path.endsWith('/classrooms/linked'))
    assert.equal(linked.source, 'convention')
  })
})
