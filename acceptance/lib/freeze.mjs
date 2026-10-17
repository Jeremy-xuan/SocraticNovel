// lib/freeze.mjs — 阶段① 冻结：把被测的两份东西复制进独立冻结目录，并生成/复核 sha256 清单
//
// 🔴 为什么必须先冻结（真实事故，不是假想需求）：
//   `file:` 安装会让 profile 里的插件文件与仓库镜像**共享 inode（硬链接）**；
//   而 `edit`/`write` 是"写新文件再替换" → **第一次编辑就打断硬链接**，profile 里停在旧版本。
//   实例：M3 第一次真实会话因此失败（模型调不到新注册的工具）。
//   → 不冻结、不复核哈希的验收跑出来的结论不可信。
//
// 本模块只做三件事：copy → 列清单 → 复核清单。全部逐文件、逐条落盘。

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ensureDir, hashTree, renderSums, writeJson, writeText } from './util.mjs'
// 🔴 ACCEPT-4：复制/删除也走 ledger（写足迹要完整，否则"按写足迹归因"就不可信）
import { ledgerCopy, ledgerRemove } from './footprint.mjs'

/**
 * 把若干来源复制进冻结目录。
 * @param {{src: string, rel: string}[]} sources - rel 是冻结目录下的相对落点
 * @param {string} frozenDir
 * @param {{skipDirs?: string[]}} [opts]
 * @returns {{rel: string, src: string, dst: string, files: number, bytes: number}[]}
 */
export function freezeInto(sources, frozenDir, opts = {}) {
  ensureDir(frozenDir)
  const skip = new Set(opts.skipDirs ?? [])
  const copied = []
  for (const { src, rel } of sources) {
    if (!existsSync(src)) throw new Error(`freeze: 来源不存在：${src}`)
    const dst = join(frozenDir, rel)
    ledgerRemove(dst, {}, { source: 'freeze.freezeInto' })
    ensureDir(join(dst, '..'))
    ledgerCopy(
      src,
      dst,
      {
        // 🔴 不跟随符号链接：教室里没有符号链接，但万一有，跟随会把外部目录整棵拷进来
        dereference: false,
        filter: (from) => {
          const name = from.split('/').pop()
          return !(skip.has(name) && statSync(from).isDirectory())
        },
      },
      { source: 'freeze.freezeInto' },
    )
    const tree = hashTree(dst)
    copied.push({ rel, src, dst, files: tree.files, bytes: tree.bytes })
  }
  return copied
}

/**
 * 生成冻结清单（逐文件 sha256）并落盘两份：人读 .txt ＋ 机器读 .json。
 * @returns {{ok: true, files: number, bytes: number, sumsFile: string, jsonFile: string}}
 */
export function writeManifest(frozenDir, outDir) {
  const tree = hashTree(frozenDir)
  const sumsFile = writeText(join(outDir, 'SHA256SUMS.txt'), renderSums(tree.map))
  const jsonFile = writeJson(join(outDir, 'SHA256SUMS.json'), {
    frozenDir,
    generatedAt: new Date().toISOString(),
    files: tree.files,
    bytes: tree.bytes,
    map: tree.map,
  })
  return { ok: true, files: tree.files, bytes: tree.bytes, sumsFile, jsonFile }
}

/**
 * 复核清单：重算冻结目录里每个文件的 sha256，与清单逐条比对。
 * 🔴 这一步证明的是"冻结动作本身没出错"，不是"冻结内容是对的"。
 * @returns {{ok:boolean, expectedFiles:number, actualFiles:number, mismatched:object[], missing:string[], extra:string[]}}
 */
export function verifyManifest(frozenDir, sumsJsonFile) {
  const expected = JSON.parse(readFileSync(sumsJsonFile, 'utf8'))
  const actual = hashTree(frozenDir)
  const mismatched = []
  const missing = []
  for (const rel of Object.keys(expected.map)) {
    const want = expected.map[rel]
    const got = actual.map[rel]
    if (got === undefined) {
      missing.push(rel)
      continue
    }
    if (got.sha256 !== want.sha256 || got.bytes !== want.bytes) {
      mismatched.push({ rel, expected: want.sha256, actual: got.sha256, expectedBytes: want.bytes, actualBytes: got.bytes })
    }
  }
  const extra = Object.keys(actual.map).filter((rel) => !(rel in expected.map))
  return {
    ok: mismatched.length === 0 && missing.length === 0 && extra.length === 0,
    expectedFiles: Object.keys(expected.map).length,
    actualFiles: actual.files,
    mismatched,
    missing,
    extra,
  }
}

/**
 * 逐文件核对两个目录树（用于「安装后 profile vs 冻结目录」）。
 * 只核对**安装副本里存在的文件**——pnpm 按 package.json 的 `files` 字段打包，
 * 冻结目录里的 test/ 与 tmp/ 本来就不该进 profile。
 * @param {string} installedDir - profile 里的安装副本
 * @param {string} frozenDir - 冻结来源
 * @returns {{ok:boolean, checked:number, mismatched:object[], frozenOnly:string[], installedOnly:string[]}}
 */
export function compareTrees(installedDir, frozenDir) {
  const installed = hashTree(installedDir)
  const frozen = hashTree(frozenDir)
  const mismatched = []
  let checked = 0
  for (const rel of Object.keys(installed.map)) {
    const a = installed.map[rel]
    const b = frozen.map[rel]
    checked += 1
    if (b === undefined) {
      mismatched.push({ rel, reason: '冻结目录里没有这个文件', installed: a.sha256, frozen: null })
      continue
    }
    if (a.sha256 !== b.sha256) {
      mismatched.push({ rel, reason: '内容不同', installed: a.sha256, frozen: b.sha256 })
    }
  }
  const installedOnly = Object.keys(installed.map).filter((rel) => !(rel in frozen.map))
  const frozenOnly = Object.keys(frozen.map).filter((rel) => !(rel in installed.map))
  return { ok: mismatched.length === 0, checked, mismatched, frozenOnly, installedOnly }
}
