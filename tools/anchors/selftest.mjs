#!/usr/bin/env node
// 行锚机核 · 自测（ANCHOR-1）
//
// 纪律（照抄相邻项目 `sakiko/tools/check-anchors.mjs` 的两条，R6）：
//   ① 锚点找不到就 FATAL —— 不允许"测了个空壳还全绿"；
//   ② 本测试**显式声明它不覆盖什么**（见文件末尾「作用域声明」）。
//
// 做法：在临时目录里造一个**真源码 + 真文档 + 真锚点表**的最小仓库，
//       然后**逐类注入一种错误**，断言工具报出该类的错误码与条数。
//       最后证明**干净输入退出码 0**。
//
// 跑法：/opt/homebrew/bin/node selftest.mjs
// 退出码：全过 ⇒ 0；有断言失败 ⇒ 1。

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOL = join(HERE, 'check-anchors.mjs')
const NODE = process.execPath

// ── 断言小工具 ────────────────────────────────────────────────
let pass = 0
const fails = []
function ok(cond, label) {
  if (cond) {
    pass++
    console.log('  ✅ ' + label)
  } else {
    fails.push(label)
    console.log('  ❌ ' + label)
  }
}

// ── 造最小仓库 ────────────────────────────────────────────────
const ROOT = mkdtempSync(join(tmpdir(), 'anchor-selftest-'))
mkdirSync(join(ROOT, 'src'), { recursive: true })

// 真源码：唯一行、且行号是确定的
const SRC = [
  '// fixture source',
  'export function alpha() {',
  '  return 1;',
  '}',
  '',
  'export function beta() {',
  '  if (missing === true) return;',
  '  return 2;',
  '}',
  '',
  '// UNIQUE_SENTINEL_FOR_ANCHOR',
  'export const gamma = 3;',
  '',
].join('\n')
writeFileSync(join(ROOT, 'src', 'mod.mjs'), SRC)

const HASH = createHash('sha256').update(SRC, 'utf8').digest('hex').slice(0, 16)

// 干净文档：正文只用锚点
const CLEAN_DOC = [
  '# 干净文档',
  '',
  '第一处引用见 〔A01〕，第二处见 〔A02〕，第三处见 〔A03〕。',
  '',
].join('\n')

function cleanSidecar(hash) {
  return [
    '# 干净文档 · 行锚表（机核）',
    '',
    '## 版本表',
    '',
    '| V | 文件 | sha256 前 16 位 |',
    '|---|---|---|',
    '| V1 | src/mod.mjs | ' + hash + ' |',
    '',
    '## 锚点表',
    '',
    '| 锚点 | 说明 | 版本 | 行 | 片段 |',
    '|---|---|---|---|---|',
    '| A01 | alpha 的定义 | V1 | 2 | `export function alpha() {` |',
    '| A02 | 静默 return 那一句 | V1 | 7 | `if (missing === true) return;` |',
    '| A03 | 唯一哨兵 | V1 | 11 | `// UNIQUE_SENTINEL_FOR_ANCHOR` |',
    '',
  ].join('\n')
}

function writeCase(name, docText, sideText) {
  const dir = join(ROOT, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'doc.md'), docText)
  writeFileSync(join(dir, 'doc.anchors.md'), sideText)
  return join(dir, 'doc.md')
}

// 跑工具：返回 { code, out }；withRoot=false 时不传 --root（走工具自己的默认仓库根）
function run(docPath, withRoot = true) {
  let out = ''
  let code = 0
  const args = withRoot ? [TOOL, docPath, '--root', ROOT] : [TOOL, docPath]
  try {
    out = execFileSync(NODE, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    code = e.status === undefined ? -1 : e.status
    out = String(e.stdout === undefined ? '' : e.stdout) + String(e.stderr === undefined ? '' : e.stderr)
  }
  return { code, out }
}

console.log('行锚机核自测 · fixture 根 = ' + ROOT)
console.log('源码 src/mod.mjs sha256[0:16] = ' + HASH)
console.log('')

// ── 0 · 干净输入必须退出码 0 ──────────────────────────────────
console.log('【0】干净输入')
{
  const doc = writeCase('clean', CLEAN_DOC, cleanSidecar(HASH))
  const r = run(doc)
  console.log(r.out.trimEnd())
  ok(r.code === 0, '干净输入退出码 = 0（实际 ' + r.code + '）')
  ok(/ERROR 0 条/.test(r.out), '汇总行显示 ERROR 0 条')
  console.log('')
}

// ── 1 · 悬空引用（正文引用了表里没有的锚点）────────────────────
console.log('【1】悬空引用')
{
  const doc = writeCase('dangling-ref', CLEAN_DOC.split('〔A03〕').join('〔A03〕与〔A99〕'), cleanSidecar(HASH))
  const r = run(doc)
  console.log(r.out.trimEnd())
  ok(r.code === 1, '退出码 = 1')
  ok(/\[dangling-ref\][^\n]*〔A99〕/.test(r.out), '抓到 dangling-ref 并点名 A99')
  ok(/doc\.md:3/.test(r.out), '报出文档行号 doc.md:3')
  console.log('')
}

// ── 2 · 孤儿锚点（表里有、正文没人用）──────────────────────────
console.log('【2】孤儿锚点')
{
  const doc = writeCase('orphan-anchor', CLEAN_DOC.split('，第三处见 〔A03〕').join(''), cleanSidecar(HASH))
  const r = run(doc)
  console.log(r.out.trimEnd())
  ok(r.code === 1, '退出码 = 1')
  ok(/\[orphan-anchor\][^\n]*A03/.test(r.out), '抓到 orphan-anchor 并点名 A03')
  console.log('')
}

// ── 3 · id 重复 ───────────────────────────────────────────────
console.log('【3】id 重复')
{
  const side = cleanSidecar(HASH) + '| A03 | 重复的第三条 | V1 | 12 | `export const gamma = 3;` |\n'
  const doc = writeCase('dup-id', CLEAN_DOC, side)
  const r = run(doc)
  console.log(r.out.trimEnd())
  ok(r.code === 1, '退出码 = 1')
  ok(/\[anchor-id-duplicate\][^\n]*A03/.test(r.out), '抓到 anchor-id-duplicate 并点名 A03')
  console.log('')
}

// ── 4 · 代码内容与锚点记录的版本对不上（版本漂移）──────────────
console.log('【4】版本漂移（源文件被改过，哈希对不上）')
{
  const doc = writeCase('version-drift', CLEAN_DOC, cleanSidecar('deadbeefdeadbeef'))
  const r = run(doc)
  console.log(r.out.trimEnd())
  ok(r.code === 1, '退出码 = 1')
  const n = (r.out.match(/\[version-drift\]/g) || []).length
  ok(n === 3, '每条锚点各报一次 version-drift（3 条，实际 ' + n + '）')
  ok(r.out.includes('deadbeefdeadbeef') && r.out.includes(HASH), '同时报出「表里记的」与「现盘的」两个哈希')
  console.log('')
}

// ── 5 · 行号漂移（哈希对，但行号写错）──────────────────────────
console.log('【5】行号漂移')
{
  const side = cleanSidecar(HASH).replace('| A02 | 静默 return 那一句 | V1 | 7 |', '| A02 | 静默 return 那一句 | V1 | 8 |')
  const doc = writeCase('line-drift', CLEAN_DOC, side)
  const r = run(doc)
  console.log(r.out.trimEnd())
  ok(r.code === 1, '退出码 = 1')
  ok(/\[line-drift\][^\n]*A02[^\n]*表写第 8 行，实际在第 7 行/.test(r.out), '抓到 line-drift 并给出「表写 vs 实际」')
  console.log('')
}

// ── 6 · 片段不唯一 / 片段失效 ─────────────────────────────────
console.log('【6】片段不唯一 + 片段失效')
{
  let side = cleanSidecar(HASH)
  side = side.replace('| A01 | alpha 的定义 | V1 | 2 | `export function alpha() {` |', '| A01 | 片段不唯一 | V1 | 2 | `return` |')
  side = side.replace('| A03 | 唯一哨兵 | V1 | 11 | `// UNIQUE_SENTINEL_FOR_ANCHOR` |', '| A03 | 片段失效 | V1 | 11 | `NO_SUCH_TEXT_ANYWHERE_XYZ` |')
  const doc = writeCase('snippet', CLEAN_DOC, side)
  const r = run(doc)
  console.log(r.out.trimEnd())
  ok(r.code === 1, '退出码 = 1')
  ok(/\[snippet-not-unique\][^\n]*A01[^\n]*命中 3 次/.test(r.out), '抓到「不唯一」并报命中次数（`return` 命中 3 次）')
  ok(/\[snippet-not-unique\][^\n]*A03[^\n]*命中 0 次[^\n]*锚点失效/.test(r.out), '抓到「失效」并标注锚点失效')
  console.log('')
}

// ── 7 · 正文散写行号（工具存在的理由）────────────────────────
console.log('【7】正文散写行号')
{
  const doc = writeCase(
    'scattered',
    '# 散写文档\n\n定位（`src/mod.mjs:7`，当前行号）：\n\n另一处（11-12 行）与 `src/mod.mjs:2`。\n\n引用 〔A01〕〔A02〕〔A03〕。\n',
    cleanSidecar(HASH),
  )
  const r = run(doc)
  console.log(r.out.trimEnd())
  ok(r.code === 1, '退出码 = 1')
  const n = (r.out.match(/\[scattered-line-number\]/g) || []).length
  ok(n === 3, '抓到 3 处散写行号（反引号式 2 处 ＋ 中文括注 1 处，实际 ' + n + '）')
  ok(r.out.includes('src/mod.mjs:7') && r.out.includes('（11-12 行）'), '把散写的原文打出来')
  console.log('')
}

// ── 8 · 散写行号豁免（豁免表登记后应放行）────────────────────
console.log('【8】散写行号豁免')
{
  const docText = '# 豁免文档\n\n示例（`src/mod.mjs:7`）不是引用。\n\n引用 〔A01〕〔A02〕〔A03〕。\n'
  const side = cleanSidecar(HASH) + '\n## 行号散写豁免\n\n| 文件 | 行 | 理由 |\n|---|---|---|\n| doc.md | 3 | 代码示例，不是引用 |\n'
  const doc = writeCase('waived', docText, side)
  const r = run(doc)
  console.log(r.out.trimEnd())
  ok(r.code === 0, '登记豁免后退出码 = 0（实际 ' + r.code + '）')
  ok(!/\[scattered-line-number\]/.test(r.out), '不再报 scattered-line-number')
  console.log('')
}

// ── 9 · 孤儿版本 / 悬空版本 / 源文件不存在 / 行号被两个锚点抢 ──
console.log('【9】孤儿版本 + 悬空版本 + 源文件不存在 + 行号冲突')
{
  const side = [
    '# 结构错 · 行锚表',
    '',
    '## 版本表',
    '',
    '| V | 文件 | sha256 前 16 位 |',
    '|---|---|---|',
    '| V1 | src/mod.mjs | ' + HASH + ' |',
    '| V2 | src/nope.mjs | ' + HASH + ' |',
    '| V3 | src/mod.mjs | ' + HASH + ' |',
    '',
    '## 锚点表',
    '',
    '| 锚点 | 说明 | 版本 | 行 | 片段 |',
    '|---|---|---|---|---|',
    '| A01 | 抢 2 行 | V1 | 2 | `export function alpha() {` |',
    '| A02 | 也抢 2 行 | V1 | 2 | `return 1;` |',
    '| A03 | 版本列指向不存在的 V9 | V9 | 11 | `// UNIQUE_SENTINEL_FOR_ANCHOR` |',
    '| A04 | 源文件不存在 | V2 | 1 | `anything` |',
    '',
  ].join('\n')
  const doc = writeCase('structural', CLEAN_DOC.split('〔A03〕').join('〔A01〕〔A02〕〔A03〕〔A04〕'), side)
  const r = run(doc)
  console.log(r.out.trimEnd())
  ok(r.code === 1, '退出码 = 1')
  ok(/\[orphan-version\][^\n]*V3/.test(r.out), '抓到 orphan-version（V3 无人用）')
  ok(!/\[orphan-version\][^\n]*V2/.test(r.out), 'V2 有锚点引用（虽源文件缺失）→ 不误报成孤儿版本')
  ok(/\[dangling-version\][^\n]*A03[^\n]*V9/.test(r.out), '抓到 dangling-version（A03 指向不存在的 V9）')
  ok(/\[source-missing\][^\n]*A04/.test(r.out), '抓到 source-missing（A04 的源文件不存在）')
  ok(/\[line-collision\][^\n]*A02/.test(r.out), '抓到 line-collision（A01 与 A02 抢同一行）')
  console.log('')
}

// ── 10 · 假阳性防线：URL / 时间 / 端口不得被当成散写行号 ───────
console.log('【10】假阳性防线')
{
  const docText = [
    '# 假阳性文档',
    '',
    '- 页面地址：`http://127.0.0.1:4320/`',
    '- 端口 `4320` 与时刻 `12:55` 与日期 `2026-09-24` 都不是行号。',
    '- 表头 `| A | B |` 与注释里的 `§9.3` 也不是。',
    '- 代码块：',
    '',
    '```bash',
    'curl -sS -L "https://example.com/x:8080/y"',
    '```',
    '',
    '引用 〔A01〕〔A02〕〔A03〕。',
    '',
  ].join('\n')
  const doc = writeCase('false-positive', docText, cleanSidecar(HASH))
  const r = run(doc)
  console.log(r.out.trimEnd())
  ok(r.code === 0, 'URL/端口/时刻/日期都不触发，退出码 = 0（实际 ' + r.code + '）')
  ok(!/\[scattered-line-number\]/.test(r.out), '零 scattered-line-number')
  console.log('')
}

// ── 11 · 无旁挂锚点表 → 跳过（不报错、不计入）──────────────────
console.log('【11】无旁挂锚点表')
{
  const dir = join(ROOT, 'no-sidecar')
  mkdirSync(dir, { recursive: true })
  const doc = join(dir, 'plain.md')
  writeFileSync(doc, '# 没有锚点表的文档\n\n正文（`src/mod.mjs:7`）。\n')
  const r = run(doc)
  console.log(r.out.trimEnd())
  ok(r.code === 0, '无锚点表 ⇒ 跳过，退出码 0（实际 ' + r.code + '）')
  ok(/SKIP/.test(r.out), '输出里有 SKIP 行')
  console.log('')
}

// ── 12 · 幂等：同一输入连跑两次，输出完全一致 ─────────────────
console.log('【12】幂等 / 可重跑')
{
  const doc = writeCase('idem', CLEAN_DOC, cleanSidecar(HASH))
  const a = run(doc)
  const b = run(doc)
  ok(a.code === b.code && a.out === b.out, '连跑两次：退出码与输出逐字一致')
  const before = readFileSync(doc, 'utf8')
  ok(before === CLEAN_DOC, '工具不修改文档（只读）')
  console.log('')
}

// ── 13 · FATAL 纪律：锚点表缺标题必须报错，不能静默全绿 ────────
console.log('【13】锚点表缺标题 = FATAL（不许"测了个空壳还全绿"）')
{
  const doc = writeCase('no-heading', CLEAN_DOC, '# 只有标题没有表\n\n随便写点什么。\n')
  const r = run(doc)
  console.log(r.out.trimEnd())
  ok(r.code === 1, '退出码 = 1')
  ok(/missing-heading/.test(r.out), '抓到 missing-heading（不许静默全绿）')
  console.log('')
}

// ── 14 · 不传 --root 时走默认仓库根（真实用法；fixture 里用相对路径必须能解析）──
console.log('【14】不传 --root（默认仓库根）')
{
  const dir = join(ROOT, 'default-root')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'mod.mjs'), SRC)
  const doc = join(dir, 'doc.md')
  writeFileSync(doc, CLEAN_DOC)
  writeFileSync(
    join(dir, 'doc.anchors.md'),
    cleanSidecar(HASH).replace('| V1 | src/mod.mjs |', '| V1 | ' + join(dir, 'src', 'mod.mjs') + ' |'),
  )
  // 用**绝对路径**目标 + 不传 --root：仓库根会退化成工具自身位置，
  // 而版本表里写的是绝对路径 → 仍必须解析成功、退出码 0。
  const r = run(doc, false)
  console.log(r.out.trimEnd())
  ok(r.code === 0, '不传 --root 时不崩、退出码 = 0（实际 ' + r.code + '）')
  ok(!/ERR_INVALID_ARG_TYPE|TypeError/.test(r.out), '无 TypeError（默认仓库根路径拼接正确）')
  console.log('')
}

// ── 15 · --scan：无锚点表也能量出现状（病灶计数）─────────────
console.log('【15】--scan 量现状')
{
  const dir = join(ROOT, 'scan-only')
  mkdirSync(dir, { recursive: true })
  const doc = join(dir, 'raw.md')
  writeFileSync(doc, '# 没锚点表的文档\n\n`src/mod.mjs:7` 与 `src/mod.mjs:2` 两处散写。\n')
  let out = ''
  let code = 0
  try {
    out = execFileSync(NODE, [TOOL, doc, '--root', ROOT, '--scan'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    code = e.status === undefined ? -1 : e.status
    out = String(e.stdout === undefined ? '' : e.stdout)
  }
  console.log(out.trimEnd())
  ok(code === 1, '有散写行号时 --scan 退出码 = 1（实际 ' + code + '）')
  ok(/散写行号 2 处/.test(out), '数出 2 处散写行号')
  ok(/raw\.md:3/.test(out), '报出文档行号 raw.md:3')
  console.log('')
}

// ── 汇总 ──────────────────────────────────────────────────────
console.log('═'.repeat(70))
console.log('自测结果：通过 ' + pass + ' 条，失败 ' + fails.length + ' 条')
if (fails.length > 0) {
  for (const f of fails) console.log('   失败：' + f)
}
console.log('fixture 根（保留供复核）：' + ROOT)
console.log('')
console.log('【作用域声明 —— 本测试**不覆盖**什么】')
console.log('  1. 不覆盖**跨文档**引用：A 文档引用 B 文档的锚点不被支持（设计上不支持，不是漏测）。')
console.log('  2. 不覆盖 **非 md 文档**：HTML/JSON/YAML 里散写的行号不在扫描范围（工具只读 .md）。')
console.log('  3. 不覆盖**语义漂移**：片段文字仍在原行、但含义已变（例如函数体被改），机核看不见 —— 这是本工具的已知盲区。')
console.log('  4. 不覆盖**未转义构建产物**（相邻项目 R6 的 `#unescape`）：我们目前没有"把非 ASCII 写成 \\uXXXX"的产物文档，故未实现该列后缀。')
console.log('  5. 不覆盖 **CRLF 之外的换行形态**（只把 CRLF 归一成 LF；不处理裸 CR）。')
console.log('  6. 不覆盖**目录级批量性能**（未做大规模压测）。')
process.exit(fails.length === 0 ? 0 : 1)
