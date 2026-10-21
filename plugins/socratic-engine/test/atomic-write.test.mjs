// test/atomic-write.test.mjs — lib/atomic-write.mjs 的单测（B2，2026-10-21）
//
// 🔴 纪律：只写 `mkdtemp` 出来的临时目录，不碰教室 / 不碰 $DSH_HOME。
//
// 要钉住的性质（与宿主 `@deepseek-ai/dsh-atomic-write` 同一套，见该文件头）：
//   ① 替换是原子的：读者要么看到旧全文、要么看到新全文，看不到半截
//   ② 替换后的权限位**恰好**是传入的 mode（不只对已有文件 chmod；新建也是 0600）
//   ③ 写失败不留临时文件、目标不动、错误原样抛
//   ④ 写锁串行化：并发两个写者不会交错；waitMs 到点抛错而不是猜锁死没死
//   ⑤ 持锁进程已消失 → 自动接管（不会永久卡死）；活着的持锁者不会被抢
//   ⑥ 临界区抛错后锁一定释放

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { withFileLock, writeFileAtomic } from '../lib/atomic-write.mjs'

/** 建一个临时目录，`fn` 结束后删除。 */
async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'socratic-atomic-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** 目录里剩下的临时/锁文件（断言"没留垃圾"用）。 */
async function leftovers(dir) {
  const entries = await readdir(dir)
  return entries.filter((name) => name.endsWith('.tmp') || name.endsWith('.lock'))
}

test('写：新建文件、内容逐字、权限位 0600', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'a.md')
    await writeFileAtomic(file, '第一版\n', { mode: 0o600 })
    assert.equal(await readFile(file, 'utf8'), '第一版\n')
    const info = await stat(file)
    assert.equal(info.mode & 0o777, 0o600)
    assert.deepEqual(await leftovers(dir), [])
  })
})

test('写：父目录按需创建（含多层）', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'x', 'y', 'z.md')
    await writeFileAtomic(file, 'deep', { mode: 0o600 })
    assert.equal(await readFile(file, 'utf8'), 'deep')
  })
})

test('写：替换已有文件时权限位被**收紧**（不是沿用旧 inode 的 0644）', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'wide.md')
    await writeFile(file, 'old', { mode: 0o644 })
    assert.equal((await stat(file)).mode & 0o777, 0o644)
    await writeFileAtomic(file, 'new', { mode: 0o600 })
    assert.equal(await readFile(file, 'utf8'), 'new')
    assert.equal((await stat(file)).mode & 0o777, 0o600)
  })
})

test('写：目标路径是符号链接时替换**链接本身**，不写穿到被指向的文件', async () => {
  await withTempDir(async (dir) => {
    const real = join(dir, 'real.md')
    const link = join(dir, 'link.md')
    await writeFile(real, 'real-original', { mode: 0o600 })
    const { symlink } = await import('node:fs/promises')
    await symlink(real, link)
    await writeFileAtomic(link, 'replaced', { mode: 0o600 })
    assert.equal(await readFile(link, 'utf8'), 'replaced')
    assert.equal((await stat(link)).isSymbolicLink(), false, '链接应被替换成普通文件')
    assert.equal(await readFile(real, 'utf8'), 'real-original', '被指向的文件不许被动')
  })
})

test('写：失败（mode 缺失）立即报错且不落任何文件', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'a.md')
    await assert.rejects(writeFileAtomic(file, 'x', {}), /options\.mode is required/)
    assert.deepEqual(await readdir(dir), [])
  })
})

test('写：临时文件在 rename 前失败 → 临时文件被清掉、目标保持旧内容', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'a.md')
    await writeFileAtomic(file, 'good', { mode: 0o600 })
    // 让临时路径的父目录不可写是平台相关做法，这里用"目标是一个目录"造 rename 失败。
    const dirTarget = join(dir, 'dir-target')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(dirTarget)
    await assert.rejects(writeFileAtomic(dirTarget, 'x', { mode: 0o600 }))
    assert.equal(await readFile(file, 'utf8'), 'good')
    const entries = await readdir(dir)
    assert.deepEqual(entries.filter((name) => name.endsWith('.tmp')), [])
  })
})

test('锁：临界区串行（后一个写者看得见前一个的提交）', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'log.md')
    await writeFile(file, '', { mode: 0o600 })
    const order = []
    const writer = (tag) =>
      withFileLock(file, async () => {
        const current = await readFile(file, 'utf8')
        order.push(`enter:${tag}`)
        await new Promise((resolve) => setTimeout(resolve, 20))
        await writeFileAtomic(file, `${current}${tag}\n`, { mode: 0o600 })
        order.push(`leave:${tag}`)
      })
    await Promise.all([writer('a'), writer('b')])
    const text = await readFile(file, 'utf8')
    assert.equal(text.trim().split('\n').length, 2, '两次追加都落盘了')
    // 🔴 只断言「不交错」，不断言「谁先」：互斥只保证临界区不重叠，**不保证 FIFO**。
    //    原来写死了 a 先 b 后，实测会翻（2026-10-21 在本机两次运行结果相反）——那是测试的
    //    假设比实现更强，不是实现错。这里的真性质是：任一 writer 的 enter/leave 必须相邻。
    assert.equal(order.length, 4, '两个 writer 各进出一次')
    assert.equal(order[0].startsWith('enter:'), true)
    assert.equal(order[1], order[0].replace('enter:', 'leave:'), '同一个 writer 的 enter/leave 必须相邻（不交错）')
    assert.equal(order[2].startsWith('enter:'), true)
    assert.equal(order[3], order[2].replace('enter:', 'leave:'), '同一个 writer 的 enter/leave 必须相邻（不交错）')
    assert.notEqual(order[0], order[2], '两个 writer 都跑了')
    assert.deepEqual(await leftovers(dir), [])
  })
})

test('锁：临界区抛错 → 锁仍然被释放（下一次能立刻拿到）', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'a.md')
    await assert.rejects(
      withFileLock(file, async () => {
        throw new Error('boom')
      }),
      /boom/,
    )
    assert.deepEqual((await leftovers(dir)).filter((name) => name.endsWith('.lock')), [])
    await withFileLock(file, async () => 'second')
  })
})

test('锁：活着的持锁者不会被抢，到点**抛错**而不是硬闯', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'a.md')
    // 拿本进程 pid 造一把"活着"的锁（holderExited 对自身 pid 返回 false）
    await writeFile(`${file}.lock`, `${process.pid}\n`, { mode: 0o600 })
    await assert.rejects(withFileLock(file, async () => 'never', { waitMs: 60 }), /timed out waiting for the writer lock/)
    // 锁还在（没人抢掉它）
    assert.equal(await readFile(`${file}.lock`, 'utf8'), `${process.pid}\n`)
    await rm(`${file}.lock`, { force: true })
  })
})

test('锁：持锁进程已消失 → 接管并继续（不会永久卡死）', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'a.md')
    // 造一个确定不存在的 pid（先起一个子进程再等它退出，pid 一定已死）
    const deadPid = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', 'process.exit(0)'])
      child.on('error', reject)
      child.on('exit', () => resolve(child.pid))
    })
    await writeFile(`${file}.lock`, `${deadPid}\n`, { mode: 0o600 })
    const result = await withFileLock(file, async () => 'took-over')
    assert.equal(result, 'took-over')
    assert.deepEqual(await leftovers(dir), [], '锁与认领文件都清干净了')
  })
})

test('锁：锁记录不完整（不是 <pid>\\n）→ 当作"有人在持锁"，等到超时就报错', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'a.md')
    await writeFile(`${file}.lock`, 'garbage', { mode: 0o600 })
    await assert.rejects(withFileLock(file, async () => 'never', { waitMs: 60 }), /timed out/)
    await rm(`${file}.lock`, { force: true })
  })
})

test('锁：signal 已 abort → 立刻抛错，不建锁', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'a.md')
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await assert.rejects(withFileLock(file, async () => 'never', { signal: controller.signal }), /cancelled/)
    assert.deepEqual(await leftovers(dir), [])
  })
})
