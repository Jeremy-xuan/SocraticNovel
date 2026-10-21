#!/usr/bin/env node
/**
 * record.cjs —— 用 Playwright 把 PoC 跑出可看的证据
 *
 * 产出（全部落在 out/）：
 *   compare-A-default-vs-claude.png   默认 vs Claude 风（候选 A）并排
 *   compare-B-stagger.png             候选 B 终态
 *   compare-C-stream.png              候选 C 终态
 *   anim-B-stagger.gif                候选 B 动画（逐层长出）
 *   anim-C-stream.gif                 候选 C 动画（按源码边长）
 *   perf.json                         渲染耗时 / 动画时长 / 节点数上限
 *
 * 跑法（在项目根）：
 *   /opt/homebrew/bin/node 开源线/DSH定制/code/tools/mermaid-pretty/record.cjs
 *
 * 依赖：项目根已有 playwright@1.63（不新增任何依赖）。
 * 静态服务：用 page.route 从磁盘喂，不另起 http 服务。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '../../../../..'); // 工作区根
const OUT = path.join(HERE, 'out');
const ORIGIN = 'http://mermaid-pretty.local';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

async function main() {
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();

  // ── 静态服务：把工作区目录当站点根 ──
  async function newPage(extra = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...extra });
    await ctx.route(`${ORIGIN}/**`, (route) => {
      const u = new URL(route.request().url());
      const file = path.join(ROOT, decodeURIComponent(u.pathname));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        return route.fulfill({ status: 404, body: 'not found' });
      }
      route.fulfill({
        status: 200,
        contentType: MIME[path.extname(file)] || 'application/octet-stream',
        body: fs.readFileSync(file),
      });
    });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('  [console.error]', m.text());
    });
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
    return { ctx, page };
  }

  const DEMO = `${ORIGIN}/开源线/DSH定制/code/tools/mermaid-pretty/demo.html`;

  // ════════════════════════════════════════════════
  // 1 · 静态对比图（候选 A）
  // ════════════════════════════════════════════════
  {
    const { ctx, page } = await newPage();
    await page.goto(DEMO, { waitUntil: 'load' });
    await page.waitForFunction('globalThis.__demoReady === true', null, { timeout: 60000 });
    for (const [src, name] of [['flow', 'flow'], ['seq', 'seq'], ['state', 'state']]) {
      await page.evaluate((k) => globalThis.__demo.setSource(k), src);
      await page.waitForTimeout(600);
      await page.locator('main').screenshot({ path: path.join(OUT, `compare-A-${name}.png`) });
      console.log('✔ compare-A-' + name + '.png');
    }
    await ctx.close();
  }

  // ════════════════════════════════════════════════
  // 2 · 候选 B / C 终态截图
  // ════════════════════════════════════════════════
  for (const [mode, name] of [['B', 'stagger'], ['C', 'stream']]) {
    const { ctx, page } = await newPage();
    await page.goto(DEMO, { waitUntil: 'load' });
    await page.waitForFunction('globalThis.__demoReady === true', null, { timeout: 60000 });
    await page.evaluate((m) => globalThis.__demo.setMode(m), mode);
    await page.waitForTimeout(mode === 'C' ? 6000 : 3000);
    await page.locator('main').screenshot({ path: path.join(OUT, `compare-${mode}-${name}.png`) });
    console.log(`✔ compare-${mode}-${name}.png`);
    await ctx.close();
  }

  // ════════════════════════════════════════════════
  // 3 · 录 GIF（Playwright video → ffmpeg palette）
  // ════════════════════════════════════════════════
  for (const [mode, name] of [['B', 'stagger'], ['C', 'stream']]) {
    const vidDir = path.join(OUT, '_video-' + name);
    fs.rmSync(vidDir, { recursive: true, force: true });
    const { ctx, page } = await newPage({ recordVideo: { dir: vidDir, size: { width: 1280, height: 720 } } });
    await page.goto(DEMO, { waitUntil: 'load' });
    await page.waitForFunction('globalThis.__demoReady === true', null, { timeout: 60000 });
    await page.waitForTimeout(700); // 让开场静一下
    await page.evaluate((m) => globalThis.__demo.setMode(m), mode);
    await page.waitForTimeout(mode === 'C' ? 7000 : 4200);
    const v = page.video();
    await ctx.close();
    const webm = await v.path();
    const gif = path.join(OUT, `anim-${mode}-${name}.gif`);
    const pal = path.join(OUT, '_pal-' + name + '.png');
    execFileSync('/opt/homebrew/bin/ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
      '-i', webm, '-vf', `fps=14,scale=960:-1:flags=lanczos,palettegen=stats_mode=diff`, pal]);
    execFileSync('/opt/homebrew/bin/ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
      '-i', webm, '-i', pal, '-lavfi',
      `fps=14,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
      '-loop', '0', gif]);
    fs.rmSync(vidDir, { recursive: true, force: true });
    fs.rmSync(pal, { force: true });
    console.log(`✔ anim-${mode}-${name}.gif (${(fs.statSync(gif).size / 1024 / 1024).toFixed(2)} MB)`);
  }

  // ════════════════════════════════════════════════
  // 4 · 性能数字
  // ════════════════════════════════════════════════
  {
    const { ctx, page } = await newPage();
    await page.goto(DEMO, { waitUntil: 'load' });
    await page.waitForFunction('globalThis.__demoReady === true', null, { timeout: 60000 });

    const perf = await page.evaluate(async () => {
      const m = globalThis.mermaid;
      const { claudeMermaidConfig } = await import('/开源线/DSH定制/code/tools/mermaid-pretty/claude-mermaid-theme.mjs');
      const { animateStagger, streamRender } = await import('/开源线/DSH定制/code/tools/mermaid-pretty/claude-mermaid-anim.mjs');

      function mkSource(n) {
        const L = ['flowchart TD', '    N0[节点 0]'];
        for (let i = 1; i < n; i += 1) {
          L.push(`    N${i - 1} --> N${i}[节点 ${i}]`);
          if (i % 3 === 0 && i + 1 < n) L.push(`    N${i - 1} --> N${i + 1}[节点 ${i + 1}]`);
        }
        return L.join('\n');
      }

      const stage = document.createElement('div');
      stage.style.cssText = 'position:fixed;left:-99999px;top:0;width:1400px';
      document.body.appendChild(stage);

      const rows = [];
      for (const n of [5, 10, 20, 40, 80, 160]) {
        const src = mkSource(n);
        const rec = { nodes: n, srcLines: src.split('\n').length - 1 };

        // 默认主题
        m.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'default' });
        let t0 = performance.now();
        let out = await m.render('p-d-' + n, src, undefined);
        rec.renderDefaultMs = performance.now() - t0;
        stage.innerHTML = out.svg;
        rec.nodeCountDefault = stage.querySelectorAll('g.node').length;

        // Claude 主题
        m.initialize(claudeMermaidConfig());
        t0 = performance.now();
        out = await m.render('p-c-' + n, src, undefined);
        rec.renderClaudeMs = performance.now() - t0;
        stage.innerHTML = out.svg;
        rec.svgBytes = out.svg.length;
        rec.nodeCount = stage.querySelectorAll('g.node').length;
        rec.edgeCount = stage.querySelectorAll('path.flowchart-link').length;

        // 候选 B：装饰 + 播放到结束（含总时长封顶后的实际值）
        const svg = stage.querySelector('svg');
        const ctrl = animateStagger(svg, { kind: 'flowchart' });
        rec.animTotalMs = ctrl.total;
        rec.animLayerDelay = ctrl.layerDelay;
        rec.animLayers = ctrl.layers;
        rec.animRawLayers = ctrl.rawLayers;
        rec.animUnits = ctrl.units;
        t0 = performance.now();
        await ctrl.play();
        rec.animWallMs = performance.now() - t0;
        ctrl.finish();

        // 候选 C：增量重渲染（interval=0，只量渲染成本；再单列 120ms 间隔的墙钟）
        const c0 = performance.now();
        const rC = await streamRender(stage, src, m, { interval: 0 });
        rec.streamRenderMs = performance.now() - c0;
        rec.streamRenders = rC.renders;
        rec.streamSteps = rC.steps;
        rec.streamWallWith120ms = rC.steps * 120 + rC.ms;

        rows.push(rec);
      }
      stage.remove();
      return rows;
    });

    fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify(perf, null, 2));
    console.table(perf.map((r) => ({
      节点: r.nodes,
      源码行: r.srcLines,
      '默认渲染ms': +r.renderDefaultMs.toFixed(1),
      'Claude主题ms': +r.renderClaudeMs.toFixed(1),
      SVG_KB: +(r.svgBytes / 1024).toFixed(1),
      '层→步': `${r.animRawLayers}→${r.animLayers}`,
      '步延迟ms': +r.animLayerDelay.toFixed(1),
      'B动画ms': Math.round(r.animTotalMs),
      'C重渲染次': r.streamRenders,
      'C纯渲染ms': Math.round(r.streamRenderMs),
      'C_120ms间隔墙钟ms': Math.round(r.streamWallWith120ms),
    })));
    await ctx.close();
  }

  await browser.close();
  console.log('\n全部产出在 ' + path.relative(ROOT, OUT));
}

main().catch((e) => { console.error(e); process.exit(1); });
