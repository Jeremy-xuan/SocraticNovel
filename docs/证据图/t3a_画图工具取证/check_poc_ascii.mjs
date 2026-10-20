// check_poc_ascii.mjs — 真阳性核查：PoC 的 A 组（不给工具时的 10 份产物）**全部是字符拼示意图**，
// 过一遍 T3a 的结构校验，看是不是**全部被拒**。
//
// 判据（先写死）：10/10 必须被拒（这些产物当年 0/10 可渲染）。任何一份被放行 = 校验器漏了口子。
// 注意口径：A 组的产物**没有** mermaid 首行关键字，所以 kind 只能由"调用方声明"给出——
// 这里按最有利模型的方式假设 kind='flowchart'（即"模型说它画的是流程图"），仍须被拒。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = '/Users/wujunjie/Documents/ChatGPT/大学申请'
const RAW = join(ROOT, '开源线/DSH定制/poc_白板可写性/raw')
const { checkDiagramArgs } = await import(join(ROOT, '开源线/DSH定制/code/plugins/socratic-engine/lib/diagram.mjs'))

function fencedBlocks(text) {
  const out = []
  const re = /```([^\n`]*)\n([\s\S]*?)```/g
  let m
  while ((m = re.exec(text)) !== null) out.push({ lang: (m[1] || '').trim().toLowerCase(), body: m[2] })
  return out
}

const rows = []
for (const f of readdirSync(RAW).filter((f) => /-A-r\d\.out\.txt$/.test(f)).sort()) {
  const id = f.replace('.out.txt', '')
  const text = readFileSync(join(RAW, f), 'utf8')
  // A 组产物 = 无语言标记围栏里的等宽示意图（PoC 报告 §2.2 的口径）
  const fig = fencedBlocks(text).filter((b) => b.lang === '' || b.lang === 'text').map((b) => b.body).join('\n')
  const check = checkDiagramArgs({ kind: 'flowchart', source: fig, title: 'x' })
  rows.push({ id, chars: fig.length, rejected: !check.ok, problems: check.problems })
}
console.log('id'.padEnd(14), 'chars'.padEnd(6), 'rejected'.padEnd(9), 'first-problem')
for (const r of rows) console.log(r.id.padEnd(14), String(r.chars).padEnd(6), String(r.rejected).padEnd(9), (r.problems[0] ?? '').slice(0, 70))
const rejected = rows.filter((r) => r.rejected).length
console.log(`\n合计 ${rejected}/${rows.length} 被拒（期望 ${rows.length}/${rows.length}：这些是"画不出来却当成交差"的字符拼示意图）`)
writeFileSync(join(ROOT, '开源线/DSH定制/t3a_画图工具取证/poc_ascii_check.json'), JSON.stringify(rows, null, 2))
