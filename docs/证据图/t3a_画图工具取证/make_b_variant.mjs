// make_b_variant.mjs — 生成 B 组（条件触发描述）的插件副本：**只改 DRAW_TOOL_DESCRIPTION 一处**。
//
// 判据（先写死）：除该常量外，A/B 两个 index.mjs 必须**逐字节相同**；脚本自己核对并打印证据。
import { cpSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const ROOT = '/Users/wujunjie/Documents/ChatGPT/大学申请'
const SRC = join(ROOT, '开源线/DSH定制/code/plugins/socratic-engine')
const DST = '/tmp/t3a-b-plugin'
const EVIDENCE = join(ROOT, '开源线/DSH定制/t3a_画图工具取证')

const START = 'export const DRAW_TOOL_DESCRIPTION ='
const END = "'first line = the diagram type keyword (flowchart / sequenceDiagram / stateDiagram-v2 / ...).'"

/** B 组描述：**同一批信息**，只把语气改成条件触发（"如果需要的话，可以…"）。 */
const B_DESCRIPTION = [
  "export const DRAW_TOOL_DESCRIPTION =",
  "  'You can draw the whiteboard picture for the current teaching turn and save it into the classroom ' +",
  "  'if you need to. If a lesson would benefit from a picture — a flow of steps, a state machine, ' +",
  "  'a sequence of interactions between a process and the kernel, a comparison of two cases — you may ' +",
  "  'call it with the mermaid diagram type in `kind` and the mermaid source in `source`. ' +",
  "  'It might be helpful to draw rather than describe the picture in prose, and an ASCII sketch would ' +",
  "  'probably not be as good. The engine can parse the source with the mermaid parser before writing ' +",
  "  'anything, save the source under runtime/diagrams/ and append one row to the diagram index, so the ' +",
  "  'picture survives the session and can be read back after class. If you pass a source the parser ' +",
  "  'rejects, it will be refused with the parser error and nothing will be written; a markdown fence ' +",
  "  'would also be refused — pass the raw mermaid source, ' +",
  "  " + END,
].join('\n')

rmSync(DST, { recursive: true, force: true })
cpSync(SRC, DST, { recursive: true, filter: (src) => !src.includes('node_modules') })

const aText = readFileSync(join(SRC, 'index.mjs'), 'utf8')
const startAt = aText.indexOf(START)
const endAt = aText.indexOf(END)
if (startAt < 0 || endAt < 0) throw new Error('定位不到 DRAW_TOOL_DESCRIPTION 常量边界')
const region = aText.slice(startAt, endAt + END.length)
const bText = aText.slice(0, startAt) + B_DESCRIPTION + aText.slice(endAt + END.length)
writeFileSync(join(DST, 'index.mjs'), bText)

// ── 证据：除该区域外逐字节相同 ──────────────────────────────────────────────
const sha = (s) => createHash('sha256').update(s).digest('hex')
const outsideA = sha(aText.slice(0, startAt) + aText.slice(endAt + END.length))
const outsideB = sha(bText.slice(0, startAt) + bText.slice(startAt + B_DESCRIPTION.length))
const files = (dir) => readdirSync(dir, { recursive: true }).filter((f) => statSync(join(dir, f)).isFile() && !f.includes('node_modules')).sort()
const aFiles = files(SRC)
const bFiles = files(DST)
const changed = aFiles.filter((f) => f !== 'index.mjs' && readFileSync(join(SRC, f), 'utf8') !== readFileSync(join(DST, f), 'utf8'))

const report = {
  src: SRC,
  dst: DST,
  aDescriptionSha: sha(region),
  bDescriptionSha: sha(B_DESCRIPTION),
  outsideRegionShaA: outsideA,
  outsideRegionShaB: outsideB,
  outsideRegionIdentical: outsideA === outsideB,
  fileListIdentical: JSON.stringify(aFiles) === JSON.stringify(bFiles),
  changedFilesBesidesIndex: changed,
  aDescriptionChars: region.length,
  bDescriptionChars: B_DESCRIPTION.length,
  aDescription: region,
  bDescription: B_DESCRIPTION,
}
writeFileSync(join(EVIDENCE, 'b_variant_evidence.json'), JSON.stringify(report, null, 2))
console.log('B 副本：', DST)
console.log('除描述常量外逐字节相同：', report.outsideRegionIdentical)
console.log('文件清单相同：', report.fileListIdentical, '｜除 index.mjs 外被改动的文件：', JSON.stringify(changed))
console.log('A 描述', report.aDescriptionChars, '字符｜B 描述', report.bDescriptionChars, '字符')
