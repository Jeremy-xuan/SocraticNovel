#!/usr/bin/env node
// 行锚机核（ANCHOR-1）
//
// 为什么要有这个工具：我们的取证/实现报告里**散写源码行号**（`client.js:800-803`）。
// 源码一被改动，这些行号就全漂 —— 本仓库已真实发生多次：
//   · 另一路改客户端，行号从 f269 飘到 f279，接线说明当场失效；
//   · 皮肤那一路 `lib/client.js` sha256 变了两轮、行号漂了一次；
//   · 本工具首跑实例：`live2d-host/README.md` §三 记的 client.js sha256 是
//     `f0a6356a…`（2144 行），而现盘是 `10efcc45…`（2302 行）——正文 9 处行号全部失准。
//
// 因此本页约定：
//   ① 文档正文**只写锚点**（`〔A07〕`），不写行号；
//   ② 行号集中在**锚点表**里；锚点表是**每份文档一份的旁挂文件** `<文档名>.anchors.md`；
//   ③ 锚点表自己也要声明**版本**（引用文件当时的 sha256 前 16 位）—— 这是"这段代码我引用的是哪个版本"。
//
// 用法（一条命令，可传文档或目录）：
//   node check-anchors.mjs <文档.md | 目录> [更多…] [--root <仓库根>] [--list] [--quiet]
//   node check-anchors.mjs <文档.md | 目录> --scan      # 只量现状（不需要锚点表）
//   退出码：ERROR 0 条 ⇒ 0；有 ERROR ⇒ 1；用法/目标错 ⇒ 2（可直接进 CI）。
//
//   --scan 是"病灶计数"模式：不建锚点表也能量出正文散写了多少处行号。
//   它**不做**悬空/孤儿/版本核对（那需要锚点表）→ `--scan` 绿 **不等于**文档已合格。
//
// 锚点表格式（三张表，标题逐字）：
//   ## 版本表
//   | V | 文件 | sha256 前 16 位 |
//   |---|---|---|
//   | V1 | 相对仓库根/相对文档所在目录 | 10efcc450ded17a0 |
//
//   ## 锚点表
//   | 锚点 | 说明 | 版本 | 行 | 片段 |
//   |---|---|---|---|---|
//   | A01 | 静默失效那一句 | V1 | 1302 | `if (expressions.length === 0) {` |
//   片段里 `⏎` 表示换行（多行锚点用）；片段内**不得含 `|` 或反引号**。
//   行可以写区间（`1553-1557`）：机核只按**起始行**核对，区间用于人读。
//
//   ## 行号散写豁免
//   | 文件 | 行 | 理由 |
//   |---|---|---|
//   | some.md | 511 | 代码块里的示例，不是引用 |
//
// 判据（任一不成立即 ERROR）：
//   ① 版本表指向的文件存在，且**当前 sha256 前 16 位 === 表里记的值**（对不上＝引用的版本已过期）；
//   ② 锚点片段在该文件里**恰好命中一次**（0 次＝锚点失效；>1 次＝锚点不唯一，定位不到行）；
//   ③ 命中行号 === 表里写的起始行号；
//   ④ 同一行号**不得被两个锚点占用**（一行一锚，否则"唯一指到一段代码"不成立）；
//   ⑤ 正文里每个 `〔Axx〕` 都能在锚点表里找到（**悬空引用**）；
//   ⑥ 锚点表里每一行都至少被正文引用一次（**孤儿锚点**）；
//   ⑦ 锚点 id 不得重复（重复时 ⑤/⑥ 的集合判据会漏掉多出来那行）；
//   ⑧ 锚点表里每一条版本（V 列）至少被一条锚点用到（**孤儿版本**）；
//   ⑨ 正文里**不得散写行号**（`文件.ext:123` 或 `（123-456 行）`）—— 除非在"行号散写豁免"表里登记。
//
// 刻意不做的事（诚实边界，见实现报告 §局限）：
//   · 不自动改写行号。版本对不上就报 ERROR，让人重取行号 —— 静默自愈＝下一次静默漂移。
//   · 不解析非 md 文档（HTML/JSON 里散写的行号不在扫描范围）。
//   · 不判断"片段语义对不对"—— 只判断"这段文字在不在这一行"。语义漂移机核看不见。

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

// ─────────────────────────────────────────────────────────────
// 常量与正则（全部集中在这里，便于测试与复核）
// ─────────────────────────────────────────────────────────────

export const VERSION_HEADING = '## 版本表'
export const ANCHOR_HEADING = '## 锚点表'
export const WAIVER_HEADING = '## 行号散写豁免'

export const HASH_LEN = 16
export const SIDECAR_SUFFIX = '.anchors.md'

// 版本表：| V1 | path | 10efcc450ded17a0 |
const VERSION_ROW_RE = /^\|\s*([A-Za-z]\d+)\s*\|\s*([^|]+?)\s*\|\s*([0-9a-fA-F]{8,64})\s*\|\s*$/
// 锚点表：| A01 | 说明 | V1 | 1234 | `片段` |
const ANCHOR_ROW_RE = /^\|\s*([A-Za-z]\d+)\s*\|\s*(.*?)\s*\|\s*([A-Za-z]\d+)\s*\|\s*(\d+)\s*(?:-\s*(\d+))?\s*\|\s*`(.*)`\s*\|\s*$/
// 豁免表：| doc.md | 511 | 理由 |
const WAIVER_ROW_RE = /^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*$/

// 正文里的锚点引用：〔A07〕（区间写成 〔A04〕~〔A05〕，两个都要在表里）
const REF_RE = /〔([A-Za-z]\d+)〕/g

// 行号散写检测式（两条，都在**单行内**匹配 —— `[^\n]` 是必须的，否则会跨行吞掉整段）
//   ① 反引号内的 `文件.ext:123…`（可带区间、可后跟中文说明）
const SCATTER_BACKTICK_RE =
  /`[^`\n]*[A-Za-z0-9_][A-Za-z0-9_.\-/]*\.(?:mjs|cjs|js|mts|ts|tsx|jsx|json|json5|ya?ml|md|py|sh|css|html|txt|toml|ini|cfg|log):[0-9]+[^`\n]*`/g
//   ② 中文括号里的行号：`（2144-2150 行）` / `（1282 行）`。**要求括注以"行"收尾**，
//      这样 `（2026-09-24 12:55 读取）` 这类日期时间不会被误判。
const SCATTER_CN_RE = /[（(]\s*[0-9]{2,6}(?:\s*[-–—~]\s*[0-9]{2,6})?\s*行\s*[）)]/g

// ─────────────────────────────────────────────────────────────
// 纯函数：解析
// ─────────────────────────────────────────────────────────────

// 找标题行；找不到返回 -1。标题必须**整行**相等（允许前后空白）。
export function findHeading(lines, heading) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === heading) return i
  }
  return -1
}

// 从标题下一行开始读连续的 `|` 行，跳过表头与分隔行，返回 { rows, badRows, endLine }
// 遇到第一个非 `|` 的非空行即认为表结束。
// 表头识别用 firstCell 判据：首格是中文列名或全 `-`/`:` 的分隔行即跳过 —— 比正则猜测可靠。
export function readTable(lines, startIdx, rowRe, firstCellIsHeader) {
  const rows = []
  const badRows = []
  let i = startIdx + 1
  for (; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t.length === 0) continue
    if (!t.startsWith('|')) break
    const firstCell = (t.split('|')[1] === undefined ? '' : t.split('|')[1]).trim()
    if (firstCellIsHeader(firstCell)) continue
    const m = rowRe.exec(t)
    if (m === null) {
      badRows.push({ line: i + 1, text: t })
      continue
    }
    rows.push({ line: i + 1, raw: t, m })
  }
  return { rows, badRows, endLine: i }
}

// 表头/分隔行的通用判据：全 `-`/`:`/空，或首格就是文档里的列名（中文）
const HEADER_CELLS = new Set(['V', '锚点', '文件', '行', '理由', '说明', '版本', '片段', 'id', 'ID', '---'])
function isHeaderCell(cell) {
  if (cell.length === 0) return true
  if (/^[-:]+$/.test(cell)) return true
  return HEADER_CELLS.has(cell)
}

export function parseAnchorTable(docText) {
  const lines = docText.split('\r\n').join('\n').split('\n')

  const out = { versions: [], anchors: [], waivers: [], problems: [] }

  // ── 版本表
  const vi = findHeading(lines, VERSION_HEADING)
  if (vi < 0) {
    out.problems.push({ kind: 'missing-heading', msg: '锚点表里找不到标题「' + VERSION_HEADING + '」' })
  } else {
    const t = readTable(lines, vi, VERSION_ROW_RE, isHeaderCell)
    for (const r of t.rows) {
      out.versions.push({ id: r.m[1], file: r.m[2].trim(), hash: r.m[3].toLowerCase(), tableLine: r.line })
    }
    for (const b of t.badRows) {
      out.problems.push({ kind: 'bad-row', line: b.line, msg: '版本表第 ' + b.line + ' 行列格式不合规：' + b.text })
    }
  }

  // ── 锚点表
  const ai = findHeading(lines, ANCHOR_HEADING)
  if (ai < 0) {
    out.problems.push({ kind: 'missing-heading', msg: '锚点表里找不到标题「' + ANCHOR_HEADING + '」' })
  } else {
    const t = readTable(lines, ai, ANCHOR_ROW_RE, isHeaderCell)
    for (const r of t.rows) {
      out.anchors.push({
        id: r.m[1],
        desc: r.m[2].trim(),
        version: r.m[3],
        lineStart: Number(r.m[4]),
        lineEnd: r.m[5] === undefined ? null : Number(r.m[5]),
        snippet: r.m[6].split('⏎').join('\n'),
        tableLine: r.line,
      })
    }
    for (const b of t.badRows) {
      out.problems.push({ kind: 'bad-row', line: b.line, msg: '锚点表第 ' + b.line + ' 行列格式不合规（列数/片段反引号/片段含 `|` 都会落到这里）：' + b.text })
    }
  }

  // ── 行号散写豁免表（可选，缺了不报错）
  const wi = findHeading(lines, WAIVER_HEADING)
  if (wi >= 0) {
    const t = readTable(lines, wi, WAIVER_ROW_RE, isHeaderCell)
    for (const r of t.rows) {
      out.waivers.push({ file: r.m[1].trim(), line: Number(r.m[2]), reason: r.m[3].trim() })
    }
  }
  return out
}

// 文档里的全部锚点引用（含出现次数与行号）
export function collectRefs(docText) {
  const lines = docText.split('\r\n').join('\n').split('\n')
  const refs = new Map() // id -> [{ line }]
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(REF_RE)) {
      const id = m[1]
      if (!refs.has(id)) refs.set(id, [])
      refs.get(id).push(i + 1)
    }
  }
  return refs
}

// 正文里散写的行号
export function scanScatteredLineNumbers(docText) {
  const lines = docText.split('\r\n').join('\n').split('\n')
  const hits = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    for (const re of [SCATTER_BACKTICK_RE, SCATTER_CN_RE]) {
      re.lastIndex = 0
      for (const m of l.matchAll(re)) hits.push({ line: i + 1, text: m[0] })
    }
  }
  return hits
}

// ─────────────────────────────────────────────────────────────
// 核对（files 可选：{ '相对路径': '<文本>' } —— 给了就用它，不再读盘，供自测注入变异）
// ─────────────────────────────────────────────────────────────

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function countOccurrences(haystack, needle) {
  let n = 0
  let at = haystack.indexOf(needle)
  while (at >= 0) {
    n++
    at = haystack.indexOf(needle, at + 1)
  }
  return n
}

// 解析一行路径。锚点表里写相对路径时，**基准是"哪一层"并不总一样**：
//   有的锚点表写 `clients/classroom-ui/lib/client.js`（相对**仓库根**），
//   有的写相对**文档所在目录**的路径。所以按顺序试，命中即用：
//     ① 仓库根；② 文档所在目录；③ 从文档目录**逐级向上**到仓库根为止的每一层。
//   全部落空时返回"仓库根＋该路径"（报错信息里会列出试过哪些基准）。
export function resolveSourcePath(repoRoot, docDir, rel) {
  return resolveSourcePathDetail(repoRoot, docDir, rel).path
}

// 同上的详细版：同时给出"试过哪些基准"，供报错信息使用
export function resolveSourcePathDetail(repoRoot, docDir, rel) {
  if (rel.startsWith('/')) return { path: rel, tried: [rel] }
  const tried = [resolve(repoRoot, rel), resolve(docDir, rel)]
  let dir = docDir
  const stop = resolve(repoRoot)
  for (let i = 0; i < 32; i++) {
    const parent = resolve(dir, '..')
    if (parent === dir) break
    tried.push(resolve(parent, rel))
    if (parent === stop) break
    dir = parent
  }
  for (const c of tried) {
    if (existsSync(c)) return { path: c, tried: tried }
  }
  return { path: tried[0], tried: tried }
}

export function checkDoc(opts) {
  const { docPath, sidecarPath, repoRoot, files } = opts
  const problems = [] // { level, kind, src, docLine, msg }；src = 'doc' 正文 / 'sidecar' 锚点表
  const add = (level, kind, src, docLine, msg) => problems.push({ level, kind, src, docLine, msg })

  // 读文档
  let docText = null
  const readVia = (p) => {
    if (files !== undefined) {
      const key = p
      if (Object.prototype.hasOwnProperty.call(files, key)) return files[key]
      const key2 = relative(repoRoot, p)
      if (Object.prototype.hasOwnProperty.call(files, key2)) return files[key2]
    }
    return readFileSync(p, 'utf8')
  }
  try {
    docText = readVia(docPath)
  } catch (e) {
    add('ERROR', 'doc-unreadable', 'doc', null, '读不到文档 ' + docPath + '：' + (e && e.message ? e.message : String(e)))
    return { docPath, problems, counts: countProblems(problems), stats: { anchors: 0, versions: 0, refs: 0 } }
  }

  // 读旁挂锚点表
  let sideText = null
  try {
    sideText = readVia(sidecarPath)
  } catch (e) {
    add('ERROR', 'sidecar-missing', 'sidecar', null, '找不到旁挂锚点表 ' + sidecarPath + '（约定：每份文档一份 `<文档名>.anchors.md`）')
    return { docPath, problems, counts: countProblems(problems), stats: { anchors: 0, versions: 0, refs: 0 } }
  }

  const parsed = parseAnchorTable(sideText.split('\r\n').join('\n'))
  for (const p of parsed.problems) add('ERROR', p.kind, 'sidecar', p.line === undefined ? null : p.line, p.msg)

  const docDir = dirname(docPath)
  const textCache = new Map()
  const readSource = (abs) => {
    if (textCache.has(abs)) return textCache.get(abs)
    let t = null
    try {
      t = readVia(abs).split('\r\n').join('\n')
    } catch (e) {
      t = null
    }
    textCache.set(abs, t)
    return t
  }

  const versions = new Map()
  for (const v of parsed.versions) {
    if (versions.has(v.id)) {
      add('ERROR', 'version-id-duplicate', 'sidecar', v.tableLine, '版本 id 重复：' + v.id + '（版本表第 ' + v.tableLine + ' 行）')
      continue
    }
    versions.set(v.id, v)
  }

  // ⑨ 正文散写行号
  const waivers = parsed.waivers
  for (const h of scanScatteredLineNumbers(docText)) {
    const waived = waivers.some((w) => w.line === h.line && (w.file === basename(docPath) || w.file === relative(repoRoot, docPath)))
    if (!waived) {
      add('ERROR', 'scattered-line-number', 'doc', h.line, '正文散写行号（应改成锚点引用）：' + h.text)
    }
  }
  // 豁免表里登记的、实际并不存在散写行号的条目 → 提示（防止豁免越积越多）
  for (const w of waivers) {
    const real = scanScatteredLineNumbers(docText).some((h) => h.line === w.line)
    if (!real) add('WARN', 'stale-waiver', 'sidecar', w.line, '行号散写豁免表里第 ' + w.line + ' 行已无散写行号（豁免可删）')
  }

  // ⑦ id 重复
  const idCount = new Map()
  for (const a of parsed.anchors) idCount.set(a.id, (idCount.get(a.id) || 0) + 1)
  for (const [id, n] of idCount) {
    if (n > 1) add('ERROR', 'anchor-id-duplicate', 'sidecar', null, '锚点 id 重复：' + id + ' 出现了 ' + n + ' 行（多出来的那行不会被 ⑤/⑥ 的集合判据看见）')
  }

  // ④ 同一行号不得被两个锚点占用
  const lineOwner = new Map()
  for (const a of parsed.anchors) {
    const key = a.version + '@' + a.lineStart
    if (lineOwner.has(key)) {
      add('ERROR', 'line-collision', 'sidecar', a.tableLine, '锚点 ' + a.id + ' 与 ' + lineOwner.get(key) + ' 抢同一行（' + key + '）：一行一锚，否则定位不唯一')
    } else {
      lineOwner.set(key, a.id)
    }
  }

  // ①②③ 逐条核对
  const results = []
  for (const a of parsed.anchors) {
    const v = versions.get(a.version)
    if (v === undefined) {
      add('ERROR', 'dangling-version', 'sidecar', a.tableLine, '锚点 ' + a.id + ' 的版本列写了 ' + a.version + '，但版本表里没有这一条')
      results.push({ ...a, status: 'BAD' })
      continue
    }
    const res = resolveSourcePathDetail(repoRoot, docDir, v.file)
    const abs = res.path
    const relReport = relative(repoRoot, abs).startsWith('..') ? abs : relative(repoRoot, abs)
    const text = readSource(abs)
    if (text === null) {
      const triedList = res.tried.map((c) => relative(repoRoot, c)).join(' ／ ')
      add(
        'ERROR',
        'source-missing',
        'sidecar',
        a.tableLine,
        '锚点 ' + a.id + '：源文件不存在或读不到 —— 锚点表写的是 ' + v.file + '；试过的基准路径：' + triedList,
      )
      results.push({ ...a, status: 'BAD' })
      continue
    }
    // ① 版本
    const nowHash = sha256Hex(text).slice(0, HASH_LEN)
    const versionOk = nowHash === v.hash
    if (!versionOk) {
      add(
        'ERROR',
        'version-drift',
        'sidecar',
        a.tableLine,
        '锚点 ' + a.id + '：引用的版本已过期 —— ' + relReport + ' 记的是 ' + v.hash + '，现盘是 ' + nowHash + '（重新取行号并把版本表改成现盘哈希）',
      )
    }
    // ② 片段唯一性
    const hits = countOccurrences(text, a.snippet)
    if (hits !== 1) {
      add(
        'ERROR',
        'snippet-not-unique',
        'sidecar',
        a.tableLine,
        '锚点 ' + a.id + '：片段在 ' + relReport + ' 里命中 ' + hits + ' 次' + (hits === 0 ? '（锚点失效）' : '（锚点不唯一，定位不到行）'),
      )
      results.push({ ...a, status: 'BAD', hits })
      continue
    }
    // ③ 行号
    const at = text.indexOf(a.snippet)
    const actual = text.slice(0, at).split('\n').length
    const lineOk = actual === a.lineStart
    if (!lineOk) {
      add('ERROR', 'line-drift', 'sidecar', a.tableLine, '锚点 ' + a.id + '：表写第 ' + a.lineStart + ' 行，实际在第 ' + actual + ' 行（' + relReport + '）')
    }
    results.push({ ...a, file: relReport, status: versionOk && lineOk ? 'OK' : 'BAD', hits, actual, actualText: text.split('\n')[actual - 1] })
  }

  // ⑧ 孤儿版本 —— 判据是「有没有锚点**引用**它」，不是「它的文件在不在」：
  //    源文件读不到时锚点已单独报 source-missing，不该把版本也报成孤儿（那是误导）。
  const usedVersions = new Set()
  for (const r of results) {
    if (versions.has(r.version)) usedVersions.add(r.version)
  }
  for (const v of versions.values()) {
    if (!usedVersions.has(v.id)) {
      add('ERROR', 'orphan-version', 'sidecar', v.tableLine, '孤儿版本：版本表里的 ' + v.id + '（' + v.file + '）没有任何锚点用到')
    }
  }

  // ⑤ 悬空引用 / ⑥ 孤儿锚点
  const refs = collectRefs(docText)
  const ids = new Set(parsed.anchors.map((a) => a.id))
  for (const [id, at] of refs) {
    if (!ids.has(id)) {
      add('ERROR', 'dangling-ref', 'doc', at[0], '悬空引用：正文写了 〔' + id + '〕，但锚点表里没有这一条（第 ' + at.join('、') + ' 行）')
    }
  }
  for (const a of parsed.anchors) {
    if (!refs.has(a.id)) {
      add('ERROR', 'orphan-anchor', 'sidecar', a.tableLine, '孤儿锚点：锚点表里的 ' + a.id + '（' + a.desc + '）正文一次都没引用')
    }
  }

  return {
    docPath,
    sidecarPath,
    problems,
    counts: countProblems(problems),
    results,
    stats: { anchors: parsed.anchors.length, versions: parsed.versions.length, refs: refs.size },
  }
}

function countProblems(problems) {
  let e = 0
  let w = 0
  for (const p of problems) {
    if (p.level === 'ERROR') e++
    else w++
  }
  return { error: e, warn: w }
}

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────

function walkMarkdown(dir, acc) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    let st = null
    try {
      st = statSync(p)
    } catch (e) {
      continue
    }
    if (st.isDirectory()) walkMarkdown(p, acc)
    else if (name.endsWith('.md') && !name.endsWith(SIDECAR_SUFFIX)) acc.push(p)
  }
  return acc
}

function parseArgv(argv) {
  const targets = []
  let repoRoot = null
  let list = false
  let quiet = false
  let scan = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--root') {
      repoRoot = argv[++i]
    } else if (a === '--list') {
      list = true
    } else if (a === '--quiet') {
      quiet = true
    } else if (a === '--scan') {
      scan = true
    } else if (a.startsWith('--')) {
      return { error: '不认识的参数：' + a }
    } else {
      targets.push(a)
    }
  }
  if (targets.length === 0) return { error: '至少要给一个文档或目录' }
  return { targets, repoRoot, list, quiet, scan }
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isMain) {
  const argv = process.argv.slice(2)
  const opt = parseArgv(argv)
  if (opt.error !== undefined) {
    console.log('用法：node check-anchors.mjs <文档.md | 目录> [更多…] [--root <仓库根>] [--list] [--quiet]')
    console.log('BAD  ' + opt.error)
    process.exit(2)
  }
  const here = dirname(fileURLToPath(import.meta.url))
  // 默认仓库根 = 本工具往上两级（<仓库根>/tools/anchors → <仓库根>）；`??` 而不是 `!== undefined`：
  // parseArgv 在没给 --root 时给的是 null，`null !== undefined` 为真会把 null 传进 resolve。
  const repoRoot = resolve(opt.repoRoot ?? join(here, '../..'))

  const docs = []
  for (const t of opt.targets) {
    const p = resolve(t)
    if (!existsSync(p)) {
      console.log('BAD  目标不存在：' + t)
      process.exit(2)
    }
    if (statSync(p).isDirectory()) walkMarkdown(p, docs)
    else docs.push(p)
  }
  if (docs.length === 0) {
    console.log('BAD  目标里没有 .md 文档')
    process.exit(2)
  }

  let totalError = 0
  let totalWarn = 0
  let checked = 0
  let skipped = 0
  let scanned = 0

  for (const docPath of docs) {
    const sidecarPath = docPath.slice(0, -3) + SIDECAR_SUFFIX
    const relDoc = relative(repoRoot, docPath)

    // `--scan`：**只量现状**，不需要锚点表。
    // 用途是"给未接入机核的文档一个诚实的病灶数字"——不建锚点表也能量出散写了多少处行号。
    // 它**不**做悬空/孤儿/版本核对（那需要锚点表），所以 `--scan` 的绿不等于"文档已合格"。
    if (opt.scan) {
      scanned++
      let text = null
      try {
        text = readFileSync(docPath, 'utf8')
      } catch (e) {
        console.log('── ' + relDoc + '  读不到')
        continue
      }
      const hits = scanScatteredLineNumbers(text)
      const refs = collectRefs(text)
      let refTotal = 0
      for (const v of refs.values()) refTotal += v.length
      totalError += hits.length
      console.log('── ' + relDoc + '  （正文锚点引用 ' + refTotal + ' 处 / 散写行号 ' + hits.length + ' 处）')
      for (const h of hits) console.log('   ERROR  [scattered-line-number]  ' + relDoc + ':' + h.line + '  ' + h.text)
      if (hits.length === 0) console.log('   OK  没有散写行号')
      continue
    }

    if (!existsSync(sidecarPath)) {
      if (!opt.quiet) console.log('SKIP ' + relDoc + '  （无旁挂锚点表，未纳入机核；只想量现状用 --scan）')
      skipped++
      continue
    }
    checked++
    const r = checkDoc({ docPath, sidecarPath, repoRoot })
    totalError += r.counts.error
    totalWarn += r.counts.warn
    if (!opt.quiet || r.counts.error > 0) {
      console.log(
        '── ' + relDoc + '  （锚点 ' + r.stats.anchors + ' 条 / 版本 ' + r.stats.versions + ' 条 / 正文引用 ' + r.stats.refs + ' 处）',
      )
      if (opt.list && r.results !== undefined) {
        for (const row of r.results) {
          const loc = row.actual === undefined ? row.lineStart + '(未定位)' : row.actual
          const where = row.file === undefined ? '(见问题清单)' : row.file
          console.log(
            '   ' + row.status + '  ' + row.id + '  ' + where + ':' + loc + '  `' + row.snippet + '`' + (row.actualText === undefined ? '' : '  →  ' + row.actualText.trim()),
          )
        }
      }
      for (const p of r.problems) {
        const at =
          p.docLine === null || p.docLine === undefined
            ? relDoc
            : (p.src === 'doc' ? relDoc : basename(sidecarPath)) + ':' + p.docLine
        console.log('   ' + p.level + '  [' + p.kind + ']  ' + at + '  ' + p.msg)
      }
      if (r.problems.length === 0) console.log('   OK  没有发现问题')
    }
  }

  console.log('')
  if (opt.scan) {
    console.log(
      '量现状结果（--scan，不做锚点/版本核对）：量了 ' + scanned + ' 份 · 散写行号 ' + totalError + ' 处',
    )
  } else {
    console.log(
      '机核结果：核了 ' + checked + ' 份（跳过 ' + skipped + ' 份无锚点表）· ERROR ' + totalError + ' 条 · WARN ' + totalWarn + ' 条',
    )
  }
  process.exit(totalError === 0 ? 0 : 1)
}
