// check_poc_samples.mjs — 假阳性核查：拿 PoC 的 10 份**真实 mermaid 产物**（当年全部渲染成功）
// 过一遍 T3a 的结构校验 + 真解析，看有没有被误杀。
//
// 判据（先写死）：10/10 必须通过结构校验；10/10 必须真解析通过。
//   任何一份被拒 = 我的校验器有假阳性 → 必须修（不许把"合法图被判死"当噪声放过）。
// 产物抽取复用 PoC 自己的口径：优先 ```mermaid 围栏，其次正文里裸 mermaid 语法头。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = '/Users/wujunjie/Documents/ChatGPT/大学申请'
const RAW = join(ROOT, '开源线/DSH定制/poc_白板可写性/raw')
const LIB = join(ROOT, '开源线/DSH定制/code/plugins/socratic-engine/lib')
const { checkDiagramArgs, DIAGRAM_KINDS } = await import(join(LIB, 'diagram.mjs'))
const { createMermaidParser } = await import(join(LIB, 'mermaid-parse.mjs'))

function fencedBlocks(text) {
  const out = []
  const re = /```([^\n`]*)\n([\s\S]*?)```/g
  let m
  while ((m = re.exec(text)) !== null) out.push({ lang: (m[1] || '').trim().toLowerCase(), body: m[2] })
  return out
}
function extractMermaid(text) {
  const blocks = fencedBlocks(text)
  const hit = blocks.find((b) => b.lang === 'mermaid')
  if (hit) return { ok: true, code: hit.body }
  const loose = text.match(/(sequenceDiagram|stateDiagram-v2|flowchart\s+(TD|LR|TB)|graph\s+(TD|LR|TB))[\s\S]*?(?=\n\n```|\n\n【|$)/)
  if (loose) return { ok: true, code: loose[0] }
  return { ok: false, code: null }
}
/** 从源码首行关键字反推 kind（本核查的目标是"别把合法的判死"，故 kind 由源码决定）。 */
function kindOf(code) {
  const header = code.split('\n').map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('%%')) ?? ''
  for (const [kind, def] of Object.entries(DIAGRAM_KINDS)) {
    if (def.keywords.some((k) => header.toLowerCase().startsWith(k.toLowerCase()))) return kind
  }
  return null
}

const parser = createMermaidParser()
const rows = []
for (const f of readdirSync(RAW).filter((f) => /-B1-r\d\.out\.txt$/.test(f)).sort()) {
  const id = f.replace('.out.txt', '')
  const ex = extractMermaid(readFileSync(join(RAW, f), 'utf8'))
  const code = ex.ok ? ex.code : ''
  const kind = code === '' ? null : kindOf(code)
  const check = checkDiagramArgs({ kind, source: code, title: 'x' })
  let parsed = null
  let parseError = null
  if (check.ok) {
    try { parsed = (await parser.parse(check.source)).diagramType } catch (e) { parseError = String(e.message).split('\n')[0] }
  }
  rows.push({
    id, extracted: ex.ok, kind, chars: code.length,
    structural: check.ok, problems: check.problems,
    parse: parsed, parseError,
    verdict: check.ok && parsed !== null ? 'ACCEPT' : 'REJECT',
  })
}
await parser.close()

console.log('id'.padEnd(14), 'kind'.padEnd(10), 'chars'.padEnd(6), 'struct'.padEnd(7), 'parse'.padEnd(14), 'verdict')
for (const r of rows) {
  console.log(r.id.padEnd(14), String(r.kind).padEnd(10), String(r.chars).padEnd(6), String(r.structural).padEnd(7), String(r.parse ?? r.parseError).slice(0,13).padEnd(14), r.verdict)
  for (const p of r.problems) console.log('   ↳ 被拒原因：', p)
}
const accepted = rows.filter((r) => r.verdict === 'ACCEPT').length
console.log(`\n合计 ${accepted}/${rows.length} 通过（期望 ${rows.length}/${rows.length}：这些是 PoC 里全部渲染成功的合法图）`)
writeFileSync(join(ROOT, '开源线/DSH定制/t3a_画图工具取证/poc_samples_check.json'), JSON.stringify(rows, null, 2))
