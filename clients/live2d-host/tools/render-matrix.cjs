/**
 * render-matrix.cjs —— 全部样本的「渲染 + 能力发现 + 嘴参数响应」全矩阵
 *
 * 一次跑完，产出 evidence/render_matrix.json：
 *   每个模型 → 是否能渲染（页面日志 + 像素统计）/ 三级回退取到的嘴参数 /
 *             把该参数写 0 与写 1 后画面的逐像素差异（证明「参数真的驱动了嘴」）
 *
 * 用法（项目根）：node $HOST/tools/render-matrix.cjs
 */

const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { createReadStream, existsSync, statSync, writeFileSync, readFileSync, readdirSync } = require('node:fs');
const { extname, join, normalize, resolve } = require('node:path');
const zlib = require('node:zlib');

const { hostDir, positional } = require('./_common.cjs');
const HOST_DIR = hostDir();
const OUT_DIR = join(HOST_DIR, 'out');
const EVID = join(HOST_DIR, 'evidence');
// 模型清单按 out/models/ 目录列举（与 run-capability.mjs 同一条筛选规则），不写死名单 —— 试装新模型后自动进来。
const MODELS = readdirSync(join(OUT_DIR, 'models'))
  .filter((d) => existsSync(join(OUT_DIR, 'models', d, `${d}.model3.json`)))
  .sort();

const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.moc3':'application/octet-stream','.css':'text/css' };

function startServer(rootDir) {
  return new Promise((res) => {
    const server = createServer((req, resp) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      if (rel === '/' || rel === '\\') rel = '/demo.html';
      const abs = join(rootDir, rel);
      if (!abs.startsWith(rootDir) || !existsSync(abs) || !statSync(abs).isFile()) { resp.writeHead(404).end('404'); return; }
      resp.writeHead(200, { 'content-type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream' });
      createReadStream(abs).pipe(resp);
    });
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

function decodePNG(buf) {
  let off = 8, width = 0, height = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const d = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = d.readUInt32BE(0); height = d.readUInt32BE(4); colorType = d[9]; }
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const ch = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev ? prev[x] : 0, c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
  }
  return { width, height, channels: ch, data: out };
}

function pixelStats(buf) {
  const { width, height, channels, data } = decodePNG(buf);
  let nonWhite = 0;
  const colors = new Set();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (!(r > 245 && g > 245 && b > 245)) nonWhite++;
    colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
  }
  const total = width * height;
  return { totalPixels: total, nonWhitePixels: nonWhite, nonWhiteRatio: +(nonWhite / total).toFixed(4), distinctQuantizedColors: colors.size };
}

function diff(aBuf, bBuf, inset = 3) {
  const A = decodePNG(aBuf), B = decodePNG(bBuf);
  let changed = 0, sum = 0, max = 0, minX = A.width, minY = A.height, maxX = -1, maxY = -1;
  for (let y = inset; y < A.height - inset; y++) for (let x = inset; x < A.width - inset; x++) {
    const ia = (y * A.width + x) * A.channels, ib = (y * B.width + x) * B.channels;
    let d = 0;
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(A.data[ia + k] - B.data[ib + k]));
    if (d > 8) {
      changed++; sum += d; if (d > max) max = d;
      if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  }
  const total = (A.width - 2 * inset) * (A.height - 2 * inset);
  return {
    changedPixels: changed, changedRatio: +(changed / total).toFixed(4),
    meanAbsDiffOnChanged: changed ? +(sum / changed).toFixed(2) : 0, maxAbsDiff: max,
    bbox: maxX < 0 ? null : { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 }
  };
}

(async () => {
  const { server, port } = await startServer(OUT_DIR);
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl'] });
  const results = [];

  for (const MODEL of MODELS) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 1 });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message)));
    const rec = { model: MODEL };
    try {
      await page.goto(`http://127.0.0.1:${port}/demo.html`, { waitUntil: 'load' });
      await page.selectOption('#model', MODEL);
      await page.click('#load');
      await page.waitForFunction(() => document.getElementById('log').textContent.includes('[shaders] ready=true'), null, { timeout: 90000 });
      await page.waitForTimeout(1200);
      await page.selectOption('#bgsel', 'white');
      await page.waitForTimeout(250);

      const cap = JSON.parse(await page.textContent('#cap'));
      rec.lipSyncResolved = cap['嘴参数'];
      rec.lipSyncIdsInHost = await page.evaluate(() => (document.getElementById('log').textContent.match(/lipSyncIds=\[([^\]]*)\]/) || [])[1] || null);
      rec.motionGroups = cap['动作组'];
      rec.expressionCount = cap['表情数'];

      const shot = join(EVID, `matrix_${MODEL}_frame.png`);
      await page.locator('#stagewrap').screenshot({ path: shot });
      rec.frameStats = pixelStats(readFileSync(shot));
      rec.frameFile = shot;
      rec.rendered = rec.frameStats.nonWhiteRatio > 0.02;

      // 冻结动画后做嘴参数隔离测试
      await page.check('#pause');
      await page.waitForTimeout(300);
      const c = join(EVID, `matrix_${MODEL}_mouth0.png`);
      const o = join(EVID, `matrix_${MODEL}_mouth1.png`);
      await page.click('#mouth0'); await page.waitForTimeout(350);
      await page.locator('#stagewrap').screenshot({ path: c });
      await page.click('#mouth1'); await page.waitForTimeout(350);
      await page.locator('#stagewrap').screenshot({ path: o });
      rec.mouthResponse = diff(readFileSync(c), readFileSync(o));
      rec.mouthResponds = rec.mouthResponse.changedPixels > 0;
    } catch (e) {
      rec.error = String(e.message || e);
    }
    rec.pageErrors = errs;
    results.push(rec);
    console.log(`${MODEL}: rendered=${rec.rendered} lipSync=${rec.lipSyncResolved && rec.lipSyncResolved.parameter} responds=${rec.mouthResponds} changed=${rec.mouthResponse && rec.mouthResponse.changedPixels}${rec.error ? ' ERROR=' + rec.error : ''}`);
    await page.close();
  }

  writeFileSync(join(EVID, 'render_matrix.json'), JSON.stringify(results, null, 2));
  console.log(`\n[written] ${join(EVID, 'render_matrix.json')}`);
  await browser.close(); server.close();
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
