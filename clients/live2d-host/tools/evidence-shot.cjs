/**
 * _l2dm1_evidence.js —— L2D-M1 取证脚本（Playwright，放项目根才能 require playwright）
 *
 * 产出（全部落盘到 产出目录/evidence/）：
 *   ① firstframe_<Model>.png           第一帧截图
 *   ② firstframe_<Model>.json          同一帧的像素统计与页面日志
 *   ③ control_blank_<Model>.png        负对照：**不装载模型**只画背景，同样截图
 *   ④ mouth_closed_<Model>.png         嘴参数=0
 *   ⑤ mouth_open_<Model>.png           嘴参数=1
 *   ⑥ mouth_diff_<Model>.json          ④⑤ 的逐像素差异统计（证明参数真的影响画面）
 *   ⑦ render_evidence_<Model>.json     以上全部汇总
 *
 * 用法（项目根）：node _l2dm1_evidence.js [模型名，默认 Haru]
 */

const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { createReadStream, existsSync, statSync, writeFileSync, readFileSync } = require('node:fs');
const { extname, join, normalize, resolve } = require('node:path');
const zlib = require('node:zlib');

const { hostDir, positional } = require('./_common.cjs');
const HOST_DIR = hostDir();
const OUT_DIR = join(HOST_DIR, 'out');
const EVID = join(HOST_DIR, 'evidence');
const MODEL = positional()[0] || 'Haru';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.moc3': 'application/octet-stream'
};

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

// ── 极简 PNG 解码（Chromium 截图：8bit RGB/RGBA，无隔行）──
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('只支持 8bit');
  if (interlace !== 0) throw new Error('不支持隔行');
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!ch) throw new Error('不支持 colorType=' + colorType);
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

function stats(buf) {
  const { width, height, channels, data } = decodePNG(buf);
  let nonWhite = 0, dark = 0, nonTransparent = 0;
  const colors = new Set();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const a = channels === 4 ? data[i + 3] : 255;
    if (a > 0) nonTransparent++;
    if (!(r > 245 && g > 245 && b > 245)) nonWhite++;
    if (r < 128 && g < 128 && b < 128) dark++;
    colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
  }
  const total = width * height;
  return {
    width, height, totalPixels: total,
    nonTransparentPixels: nonTransparent, nonTransparentRatio: +(nonTransparent / total).toFixed(4),
    nonWhitePixels: nonWhite, nonWhiteRatio: +(nonWhite / total).toFixed(4),
    darkPixels: dark, darkRatio: +(dark / total).toFixed(4),
    distinctQuantizedColors: colors.size
  };
}

function diffPNG(aBuf, bBuf, inset = 3) {
  const A = decodePNG(aBuf), B = decodePNG(bBuf);
  if (A.width !== B.width || A.height !== B.height) return { error: '尺寸不同' };
  let changed = 0, sumAbs = 0, maxAbs = 0;
  let minX = A.width, minY = A.height, maxX = -1, maxY = -1;
  // inset：跳过外圈像素（截图里 #stagewrap 有 1px 边框，会把 bbox 撑到整幅）
  for (let y = inset; y < A.height - inset; y++) for (let x = inset; x < A.width - inset; x++) {
    const ia = (y * A.width + x) * A.channels, ib = (y * B.width + x) * B.channels;
    let d = 0;
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(A.data[ia + k] - B.data[ib + k]));
    if (d > 8) {
      changed++; sumAbs += d; if (d > maxAbs) maxAbs = d;
      if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  }
  const total = (A.width - 2 * inset) * (A.height - 2 * inset);
  return {
    insetSkippedBorderPx: inset,
    comparedPixels: total,
    changedPixels: changed,
    changedRatio: +(changed / total).toFixed(4),
    meanAbsDiffOnChanged: changed ? +(sumAbs / changed).toFixed(2) : 0,
    maxAbsDiff: maxAbs,
    bbox: maxX < 0 ? null : { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 }
  };
}

(async () => {
  const { server, port } = await startServer(OUT_DIR);
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 1 });
  const consoleLines = [];
  page.on('console', (m) => { if (m.type() !== 'warning') consoleLines.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));

  const out = { model: MODEL, url: `http://127.0.0.1:${port}/demo.html`, files: {}, steps: [] };

  // ── 负对照：`?nomodel=1` 让页面不自动装载模型，此时画布只有底 ──
  //   用白色底做对照，因为「第一帧」在白色底下背景也是白的，
  //   两者之差就只剩模型像素 —— 这是「不是空白画布」的程序化证据。
  await page.goto(`http://127.0.0.1:${port}/demo.html?nomodel=1`, { waitUntil: 'load' });
  await page.selectOption('#bgsel', 'white');
  await page.waitForTimeout(400);
  const ctrlPath = join(EVID, `control_blank_${MODEL}.png`);
  await page.locator('#stagewrap').screenshot({ path: ctrlPath });
  out.files.controlBlank = ctrlPath;
  out.controlBlankStats = stats(readFileSync(ctrlPath));
  out.steps.push('负对照截图完成（?nomodel=1，未装载模型，白底）');

  // ── 正式装载：重新进页面（默认自动装载 Haru），再切到目标模型 ──
  await page.goto(`http://127.0.0.1:${port}/demo.html`, { waitUntil: 'load' });

  // ── 装载模型 ──
  await page.selectOption('#model', MODEL);
  await page.click('#load');
  await page.waitForFunction(() => document.getElementById('log').textContent.includes('[shaders] ready=true'), null, { timeout: 90000 });
  out.steps.push('模型装载 + shader 就绪');
  await page.waitForTimeout(1500); // 让呼吸/动作离开绑定姿态

  const diag = await page.evaluate(() => ({
    canvasW: document.getElementById('stage').width,
    canvasH: document.getElementById('stage').height,
    log: document.getElementById('log').textContent,
    cap: document.getElementById('cap').textContent,
    glVersion: (() => { const g = document.getElementById('stage').getContext('webgl2'); return g ? g.getParameter(g.VERSION) : null; })()
  }));
  out.canvas = { w: diag.canvasW, h: diag.canvasH };
  out.glVersion = diag.glVersion;
  out.pageLog = diag.log;
  out.pageCapability = diag.cap;

  // ── 第一帧（棋盘底：透明区域露出棋盘，肉眼可判"非空白"）──
  const firstPath = join(EVID, `firstframe_${MODEL}.png`);
  await page.locator('#stagewrap').screenshot({ path: firstPath });
  const firstBuf = readFileSync(firstPath);
  out.files.firstFrame = firstPath;
  out.firstFrameStats = stats(firstBuf);
  out.steps.push('第一帧截图完成（棋盘底）');

  // ── 同帧再截一张深色底（DSH 右栏会是深色，顺便给主代理一张干净的目视件）──
  const darkPath = join(EVID, `firstframe_dark_${MODEL}.png`);
  await page.selectOption('#bgsel', 'dark');
  await page.waitForTimeout(300);
  await page.locator('#stagewrap').screenshot({ path: darkPath });
  out.files.firstFrameDark = darkPath;
  out.firstFrameDarkStats = stats(readFileSync(darkPath));
  await page.selectOption('#bgsel', 'checker');
  await page.waitForTimeout(200);
  out.steps.push('第一帧截图完成（深色底）');

  // ── 嘴参数 0 / 1 ──
  const closedPath = join(EVID, `mouth_closed_${MODEL}.png`);
  const openPath = join(EVID, `mouth_open_${MODEL}.png`);
  await page.click('#mouth0'); await page.waitForTimeout(200);
  await page.locator('#stage').screenshot({ path: closedPath });
  await page.click('#mouth1'); await page.waitForTimeout(200);
  await page.locator('#stage').screenshot({ path: openPath });
  out.files.mouthClosed = closedPath;
  out.files.mouthOpen = openPath;
  out.mouthDiff = diffPNG(readFileSync(closedPath), readFileSync(openPath));
  out.steps.push('嘴参数 0/1 对照截图 + 逐像素差异完成');

  // ── 第一帧 vs 负对照：逐像素差异（证明"画面里确实多了模型"）──
  out.firstFrameVsBlank = diffPNG(readFileSync(ctrlPath), readFileSync(firstPath));
  out.steps.push('第一帧 vs 负对照 逐像素差异完成');

  out.consoleLines = consoleLines;
  const summary = join(EVID, `render_evidence_${MODEL}.json`);
  writeFileSync(summary, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));

  await browser.close();
  server.close();
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
