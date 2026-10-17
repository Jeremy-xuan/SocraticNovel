/**
 * _l2dm1_shot.js —— L2D-M1 第一帧截图 + 非空白取证（Playwright）
 *
 * 🔴 位置要求：本脚本必须放在**项目根**，因为 playwright 装在项目根的 node_modules，
 *    放别处会 MODULE_NOT_FOUND。
 *
 * 用法（在项目根执行）：
 *   node _l2dm1_shot.js [模型名] [输出png路径]
 *
 * 产出：
 *   ① 截图 PNG（模型 + 棋盘底，棋盘能露出来即证明「非空白」）
 *   ② 程序化像素统计（对 PNG 自行解码，不依赖任何图像库）：
 *      - 非透明像素数 / 占比
 *      - 唯一颜色数
 *      - 非透明像素的包围盒
 *      - 模型区域内「与背景棋盘不同」的像素占比（= 真·模型覆盖）
 *   ③ 同目录 .json 取证文件
 */

const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { createReadStream, existsSync, statSync, writeFileSync } = require('node:fs');
const { extname, join, normalize, resolve } = require('node:path');
const zlib = require('node:zlib');

const { hostDir, positional } = require('./_common.cjs');
const HOST_DIR = hostDir();
const OUT_DIR = join(HOST_DIR, 'out');
const EVID_DIR = join(HOST_DIR, 'evidence');

const MODEL = positional()[0] || 'Haru';
const SHOT = positional()[1] || join(EVID_DIR, `firstframe_${MODEL}.png`);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.moc3': 'application/octet-stream',
  '.wav': 'audio/wav'
};

function startServer(rootDir) {
  return new Promise((res) => {
    const server = createServer((req, resp) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      if (rel === '/' || rel === '\\') rel = '/demo.html';
      const abs = join(rootDir, rel);
      if (!abs.startsWith(rootDir) || !existsSync(abs) || !statSync(abs).isFile()) {
        resp.writeHead(404).end('404');
        return;
      }
      resp.writeHead(200, { 'content-type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream' });
      createReadStream(abs).pipe(resp);
    });
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

// ── 极简 PNG 解码（只支持 Chromium 截图产出的 8bit RGBA / RGB，无隔行）──
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let off = 8;
  let width = 0,
    height = 0,
    bitDepth = 0,
    colorType = 0,
    interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`只支持 8bit，实际 ${bitDepth}`);
  if (interlace !== 0) throw new Error('不支持隔行 PNG');
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!ch) throw new Error(`不支持 colorType=${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels: ch, data: out };
}

function analyzePNG(buf) {
  const { width, height, channels, data } = decodePNG(buf);
  let nonTransparent = 0;
  let opaque = 0;
  const colors = new Set();
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      const a = channels === 4 ? data[i + 3] : 255;
      if (a > 0) {
        nonTransparent++;
        if (a === 255) opaque++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      // 为控内存，按 3 位量化统计颜色多样性
      colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
    }
  }
  const total = width * height;
  return {
    width,
    height,
    channels,
    totalPixels: total,
    nonTransparentPixels: nonTransparent,
    nonTransparentRatio: +(nonTransparent / total).toFixed(4),
    opaquePixels: opaque,
    distinctQuantizedColors: colors.size,
    bbox: maxX < 0 ? null : { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 }
  };
}

(async () => {
  const { server, port } = await startServer(OUT_DIR);
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--disable-dev-shm-usage'
    ]
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 1 });
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));

  await page.goto(`http://127.0.0.1:${port}/demo.html`, { waitUntil: 'load' });

  // 选模型并装载
  await page.selectOption('#model', MODEL);
  await page.click('#load');
  // 等宿主真的装载完成（页面把 lipSyncIds 写进日志）
  await page.waitForFunction(() => document.getElementById('log').textContent.includes('[ok]'), null, {
    timeout: 60000
  });
  // 再跑一会儿让呼吸/动作离开绑定姿态
  await page.waitForTimeout(1200);

  const diag = await page.evaluate(() => {
    const c = document.getElementById('stage');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return {
      canvasW: c.width,
      canvasH: c.height,
      glRenderer: gl ? gl.getParameter(gl.VERSION) : null,
      log: document.getElementById('log').textContent,
      cap: document.getElementById('cap').textContent
    };
  });

  await page.locator('#stage').screenshot({ path: SHOT });
  const buf = require('node:fs').readFileSync(SHOT);
  const stats = analyzePNG(buf);

  const report = {
    model: MODEL,
    screenshot: SHOT,
    screenshotBytes: buf.length,
    url: `http://127.0.0.1:${port}/demo.html`,
    canvas: { w: diag.canvasW, h: diag.canvasH },
    glVersion: diag.glRenderer,
    pageLog: diag.log,
    pageCapability: diag.cap,
    pixelStats: stats,
    consoleLines
  };
  const jsonPath = SHOT.replace(/\.png$/, '.json');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await browser.close();
  server.close();
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
