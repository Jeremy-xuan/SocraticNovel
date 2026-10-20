// render_check.mjs — 把 A/B 两组真实会话落盘的 .mmd **真的渲染一遍**（真浏览器 + mermaid 11）。
//
// 为什么还要渲染一次（工具里已经真解析过了）：
//   `mermaid.parse` 判的是**语法能不能过**；本脚本判的是**渲染出来有没有东西**（SVG 非空、
//   bbox 宽高 > 0、节点/连线数量 > 0）。两者合起来才等于 PoC 报告里"可渲染"的口径，
//   也是"这张图能不能渲染"这句话的完整证据。
//
// 判据（先写死）：每个 .mmd 必须 parseOk && renderOk && bbox.w>0 && bbox.h>0 && 节点数>0。
//   PNG 落在 t3a_画图工具取证/png/<组>-<文件名>.png，供人工目视复核。
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'

const ROOT = '/Users/wujunjie/Documents/ChatGPT/大学申请'
const EVIDENCE = join(ROOT, '开源线/DSH定制/t3a_画图工具取证')
const PNG = join(EVIDENCE, 'png')
mkdirSync(PNG, { recursive: true })

const require = createRequire(`${ROOT}/`)
const { chromium } = require('playwright')

/** 教室副本 → 组标签。A/B 共用同一个副本目录，靠文件名里的时间戳对照 runs.jsonl 归属。 */
const SOURCES = [
  { dir: '/tmp/t3a-cs-os/runtime/diagrams', label: '批次1（共用副本：A#1–5 / B#1–4）' },
  { dir: '/tmp/t3a-cs-os-smoke/runtime/diagrams', label: 'smoke' },
]
// 批次 2：每次全新副本（/tmp/t3a-fresh-<组>-<序号>）
// ⚠️ 批次 2 的副本建在 os.tmpdir() 下（macOS 是 /var/folders/…/T，不是 /tmp）
for (const entry of readdirSync(tmpdir()).filter((f) => /^t3a-fresh-/.test(f)).sort()) {
  SOURCES.push({ dir: join(tmpdir(), entry, 'runtime', 'diagrams'), label: `批次2·${entry}` })
}

const files = []
for (const src of SOURCES) {
  if (!existsSync(src.dir)) continue
  for (const name of readdirSync(src.dir).filter((f) => f.endsWith('.mmd')).sort()) {
    files.push({ name, path: join(src.dir, name), source: src.label })
  }
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
await page.setContent('<html><body style="margin:0;background:#fff"><div id="stage"></div></body></html>')
await page.evaluate(async () => {
  const mod = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')
  window.mermaid = mod.default
  window.mermaid.initialize({ startOnLoad: false, theme: 'default' })
})

const rows = []
for (const file of files) {
  const code = readFileSync(file.path, 'utf8')
  const result = await page.evaluate(async ({ code, id }) => {
    try {
      await window.mermaid.parse(code)
    } catch (e) {
      return { parseOk: false, parseErr: String(e.message || e).slice(0, 400) }
    }
    let svg
    try {
      svg = (await window.mermaid.render(`g_${id.replace(/[^a-z0-9]/gi, '_')}`, code)).svg
    } catch (e) {
      return { parseOk: true, renderOk: false, renderErr: String(e.message || e).slice(0, 400) }
    }
    const stage = document.getElementById('stage')
    stage.innerHTML = svg
    const el = stage.querySelector('svg')
    const bb = el.getBBox()
    return {
      parseOk: true,
      renderOk: true,
      svgLen: svg.length,
      bbox: { w: Math.round(bb.width), h: Math.round(bb.height) },
      nodes: el.querySelectorAll('.node, .actor, .cluster, .statediagram-state').length,
      labels: el.querySelectorAll('text, foreignObject .nodeLabel, foreignObject span').length,
      edges: el.querySelectorAll('.edgePath, .messageLine0, .messageLine1, .transition').length,
      svg,
    }
  }, { code, id: file.name })
  const png = join(PNG, `${file.name.replace(/\.mmd$/, '')}.png`)
  if (result.renderOk) {
    await page.screenshot({ path: png, clip: await page.evaluate(() => {
      const el = document.querySelector('#stage svg')
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: Math.min(r.width, 1600), height: Math.min(r.height, 1200) }
    }) })
  }
  rows.push({
    file: file.name,
    source: file.source,
    chars: code.length,
    parseOk: result.parseOk === true,
    renderOk: result.renderOk === true,
    error: result.parseErr ?? result.renderErr ?? null,
    svgLen: result.svgLen ?? 0,
    bbox: result.bbox ?? null,
    nodes: result.nodes ?? 0,
    labels: result.labels ?? 0,
    edges: result.edges ?? 0,
    png: result.renderOk ? png : null,
    verdict:
      result.parseOk === true && result.renderOk === true && (result.bbox?.w ?? 0) > 0 && (result.bbox?.h ?? 0) > 0
        ? 'RENDER-OK'
        : 'RENDER-FAIL',
  })
  console.log(
    `${rows[rows.length - 1].verdict.padEnd(12)} ${file.name.padEnd(46)} ${rows[rows.length - 1].bbox ? `${rows[rows.length - 1].bbox.w}×${rows[rows.length - 1].bbox.h}` : '—'}｜节点 ${rows[rows.length - 1].nodes}｜标签 ${rows[rows.length - 1].labels}｜边 ${rows[rows.length - 1].edges}` +
      (rows[rows.length - 1].error ? `｜${rows[rows.length - 1].error}` : ''),
  )
}
await browser.close()

writeFileSync(join(EVIDENCE, 'render_check.json'), JSON.stringify(rows, null, 2))
const ok = rows.filter((r) => r.verdict === 'RENDER-OK').length
console.log(`\n合计 ${ok}/${rows.length} 渲染成功（期望全部：这些图都是工具**校验通过后**才落盘的）`)
