// 文档行锚机核（docs/narrator-milestone.md §7.6 的那张表）
//
// 为什么要有这个工具：文档正文里**散写** host.mjs 行号时，任何一次插行都会让一批行号悄悄失准
// （2026-09-20 实测：一个提交在三个位置插了行，只更新了表、正文里约 15 个行号全漂）。
// 因此本页约定：**行号只出现在 §7.6 的表里**，正文一律用锚点编号（如 `〔A07〕`）引用。
// 本工具逐行核对那张表 —— 表对了，正文就对。
//
// 用法：
//   node tools/check-anchors.mjs            # 在仓库根目录跑
//   node tools/check-anchors.mjs <repoRoot>
// 输出：每行 `OK/BAD + 锚点 + 文件:行 + 片段 + 该行原文`；末行 `锚点共 N 条，坏 M 条`。
// 退出码：坏 0 条 ⇒ 0；否则 1。
//
// 表的一行形如（4 列，片段用反引号包住；片段里的 `⏎` 表示换行 —— 多行锚点用）：
//   | A07 · 门：本会话回合是否活跃 | host.mjs | 3620 | `if (st.turnActive !== true) return` |
//
// 判据（每条都必须成立，缺一即 BAD）：
//   ① 文件存在；② 片段在该文件里**恰好命中一次**（0 次 = 锚点失效，>1 次 = 锚点不唯一、定位不到行）；
//   ③ 命中处的行号 === 表里写的行号；
//   ④ 正文里出现的每一个 `〔Axx〕` 引用都能在表里找到（**悬空引用**同样算坏 —— 改名/删行漏改正文时会撞上）；
//   ⑤ 表里每一行都至少被正文引用一次（防止「表里留着一堆没人用的锚点」这种反向漂移）；
//   ⑥ 表内 **id 不得重复**（重复时按 id 集合判「是否被引用」会让多出来那一行静默通过）。
//
// 文件列的 `#unescape` 后缀：该文件是**转义构建产物**（如 `client.js` 把非 ASCII 写成 `\uXXXX`），
//   核对前先把 `\uXXXX` 解码 —— 于是其片段按**解码后**文本写，纯粹的产物重生成（转义十六进制大小写变化、
//   引号风格变化）不会造成假红。`\uXXXX` 解码是 1:1 的（不产生换行），所以行号不受影响。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

export const DOC_REL = 'docs/narrator-milestone.md'
const TABLE_HEADING = '### 7.6 行锚（机核）'
// 列：锚点 | 文件 | 行 | 该行含有的片段。**按 `|` 切分后再 trim** ⇒ 表里补对齐空格不算改动。
const ROW_RE = /^\|\s*([A-Z]\d+)\s*·\s*(.*?)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*`(.*)`\s*\|\s*$/
const UNESCAPE_SUFFIX = '#unescape'

export function unescapeUnicode(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

// 从文档正文里解析出锚点表：[{ id, desc, file, line, snippet, decode }]
// file 是**去掉 #unescape 后缀**的真实路径；decode 表示核对前是否先解码 \uXXXX。
export function parseAnchorTable(docText) {
  const lines = docText.split('\n')
  const start = lines.findIndex((l) => l.trim() === TABLE_HEADING)
  if (start < 0) return { rows: [], error: '文档里找不到标题「' + TABLE_HEADING + '」' }
  const rows = []
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (l.trim().length === 0) continue
    if (!l.startsWith('|')) {
      if (rows.length > 0) break   // 表结束
      continue                     // 表头/分隔行
    }
    const m = ROW_RE.exec(l)
    if (m === null) continue       // 表头 `| 锚点 | 文件 | 行 | ... |` 与 `| --- | --- |` 落到这里
    let file = m[3]
    let decode = false
    if (file.endsWith(UNESCAPE_SUFFIX)) { file = file.slice(0, -UNESCAPE_SUFFIX.length).trim(); decode = true }
    rows.push({ id: m[1], desc: m[2], file: file, line: Number(m[4]), snippet: m[5], decode: decode })
  }
  if (rows.length === 0) return { rows: [], error: '表里一行锚点都没解析到（列格式变了？）' }
  return { rows: rows, error: null }
}

// 逐条核对；files 可选：{ 'host.mjs': '<文本>' } —— 给了就用它，不再读盘（供测试注入变异）
export function checkAnchors(repoRoot, files) {
  const root = resolve(repoRoot)
  const readRel = (rel) => {
    if (files !== undefined && Object.prototype.hasOwnProperty.call(files, rel)) return files[rel]
    return readFileSync(join(root, rel), 'utf8')
  }
  let docText
  try { docText = readRel(DOC_REL) } catch (e) {
    return { total: 0, bad: 1, rows: [], error: '读不到 ' + DOC_REL + '：' + (e && e.message ? e.message : String(e)) }
  }
  const parsed = parseAnchorTable(docText.split('\r\n').join('\n'))
  if (parsed.error !== null) return { total: 0, bad: 1, rows: [], error: parsed.error }

  const rawCache = new Map()
  const rawOf = (rel) => {
    if (!rawCache.has(rel)) {
      let t = null
      try { t = readRel(rel).split('\r\n').join('\n') } catch (e) { t = null }
      rawCache.set(rel, t)
    }
    return rawCache.get(rel)
  }
  // decode=true 的文件先解码；解码是 1:1 的 ⇒ 行号与原始文件一致
  const textOf = (rel, decode) => {
    const t = rawOf(rel)
    if (t === null || !decode) return t
    return unescapeUnicode(t)
  }

  const out = []
  let bad = 0

  // ⑥ 表内 id 不得重复（重复时按 id 集合判「是否被引用」会让多出来那一行静默通过）
  const seenId = new Map()
  for (const row of parsed.rows) seenId.set(row.id, (seenId.get(row.id) || 0) + 1)
  for (const [id, n] of seenId) {
    if (n > 1) {
      bad++
      out.push({ id: id, desc: '（表内 id 重复）', file: DOC_REL, line: 0, snippet: '', ok: false, hits: n, actual: null, why: '表内 id 重复：' + id + ' 出现了 ' + n + ' 行（多出来的那行不会被 ④/⑤ 的 id 集合判据看见）' })
    }
  }

  for (const row of parsed.rows) {
    const snippet = row.snippet.split('⏎').join('\n')
    const text = textOf(row.file, row.decode === true)
    if (text === null) { bad++; out.push({ id: row.id, desc: row.desc, file: row.file, line: row.line, snippet: row.snippet, ok: false, hits: -1, actual: null, why: '文件读不到' }); continue }
    let hits = 0
    let at = text.indexOf(snippet)
    const first = at
    while (at >= 0) { hits++; at = text.indexOf(snippet, at + 1) }
    if (hits !== 1) {
      bad++
      out.push({ id: row.id, desc: row.desc, file: row.file, line: row.line, snippet: row.snippet, ok: false, hits: hits, actual: null, why: hits === 0 ? '片段在该文件里 0 命中（锚点失效）' : '片段命中 ' + hits + ' 次（锚点不唯一）' })
      continue
    }
    const actual = text.slice(0, first).split('\n').length
    // 「该行原文」一律回**原始文件**取（decode 只用于定位，行号 1:1）
    const rawText = rawOf(row.file)
    const srcLine = rawText === null ? text.split('\n')[actual - 1] : rawText.split('\n')[actual - 1]
    const ok = actual === row.line
    if (!ok) bad++
    out.push({ id: row.id, desc: row.desc, file: row.file, line: row.line, snippet: row.snippet, ok: ok, hits: hits, actual: actual, actualText: srcLine, why: ok ? null : '表写 ' + row.line + ' 行，实际在 ' + actual + ' 行' })
  }

  // ④/⑤ 正文引用与表的一致性（正文里只允许出现 `〔Axx〕` 形式的引用，行号一律在表里）
  const ids = new Set(parsed.rows.map((r) => r.id))
  const refCount = new Map()
  for (const m of docText.matchAll(/〔(A\d+)〕/g)) {
    const id = m[1]
    refCount.set(id, (refCount.get(id) || 0) + 1)
    if (!ids.has(id)) {
      bad++
      out.push({ id: id, desc: '（正文引用了表里不存在的锚点）', file: DOC_REL, line: 0, snippet: '〔' + id + '〕', ok: false, hits: 0, actual: null, why: '悬空引用：正文写了 〔' + id + '〕，但 §7.6 表里没有这一行' })
    }
  }
  for (const row of parsed.rows) {
    if (!refCount.has(row.id)) {
      bad++
      out.push({ id: row.id, desc: row.desc, file: DOC_REL, line: 0, snippet: '', ok: false, hits: 0, actual: null, why: '孤儿锚点：§7.6 表里有这一行，但正文一次都没引用它' })
    }
  }
  return { total: out.length, bad: bad, rows: out, error: null, tableRows: parsed.rows.length, refs: refCount.size }
}

// CLI
const isMain = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url))
  const root = process.argv[2] !== undefined ? process.argv[2] : resolve(here, '..')
  const r = checkAnchors(root)
  if (r.error !== null) {
    console.log('BAD  ' + r.error)
    console.log('锚点共 0 条，坏 1 条')
    process.exit(1)
  }
  for (const row of r.rows) {
    if (row.ok) {
      console.log('OK   ' + row.id + '  ' + row.file + ':' + row.actual + '  `' + row.snippet + '`  →  ' + row.actualText)
    } else {
      console.log('BAD  ' + row.id + '  ' + row.file + ':' + row.line + '  `' + row.snippet + '`  ← ' + row.why + (row.actualText === undefined ? '' : '；该行实际是：' + row.actualText))
    }
  }
  console.log('锚点共 ' + r.total + ' 条，坏 ' + r.bad + ' 条')
  process.exit(r.bad === 0 ? 0 : 1)
}
