// test/no-host-imports.test.mjs — 机核：引擎插件**不许** import 任何宿主包（B2，2026-10-21）
//
// 🔴 这条为什么必须存在：验收流水线的铁律③查的是**结果**（profile / 插件 node_modules 里
// 不许出现 `@deepseek-ai/*`），而根因在**源码**——只要有人再写一句
// `import '@deepseek-ai/dsh-xxx'`，包就必须进 `package.json` 的 dependencies，
// 铁律③就必然红。这个测试把根因这一侧也钉住，跑在普通 `npm test` 里，不依赖宿主。
//
// 判据（两条都要过）：
//   ① 源码里没有 `from '@deepseek-ai/...'`（静态 import / export … from）
//   ② 源码里没有 `import('@deepseek-ai/...')`（动态 import —— 前一轮就是靠"失败只记日志"
//      藏了 5 处，报错被吞掉时看起来"没事"）
//
// 注释里出现这个字符串是允许的（本仓库大量注释在解释"为什么不用它"），所以先剥注释再匹配。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/** 递归列出源码文件（跳过 node_modules / 测试夹具）。 */
async function sourceFiles(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)))
    else if (/\.(mjs|js)$/.test(entry.name)) out.push(path)
  }
  return out
}

/** 去掉行注释与块注释（够用即可：本仓库没有把 import 写进字符串的代码）。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const HOST_STATIC = /(?:^|\s)(?:import|export)[^;\n]*?from\s*['"]@deepseek-ai\//
const HOST_DYNAMIC = /import\s*\(\s*['"]@deepseek-ai\//

test('引擎源码里没有任何 @deepseek-ai/* 的 import（静态或动态）', async () => {
  const offenders = []
  for (const file of await sourceFiles(ROOT)) {
    const text = stripComments(await readFile(file, 'utf8'))
    for (const [lineNumber, line] of text.split('\n').entries()) {
      if (HOST_STATIC.test(line) || HOST_DYNAMIC.test(line)) {
        offenders.push(`${relative(ROOT, file)}:${lineNumber + 1}  ${line.trim()}`)
      }
    }
  }
  assert.deepEqual(offenders, [], `发现宿主包 import（会逼着把包写进 dependencies，铁律③必红）：\n${offenders.join('\n')}`)
})

test('package.json 的 dependencies 里没有任何 @deepseek-ai/*', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const host = Object.keys(pkg.dependencies ?? {}).filter((name) => name.startsWith('@deepseek-ai/'))
  assert.deepEqual(host, [], 'dependencies 里不该有宿主包（0.2.1 没有安装版回退目录）')
})
