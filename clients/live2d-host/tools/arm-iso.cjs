/**
 * arm-iso.cjs —— 「手臂参数 → 画面」的隔离验证
 *
 * 照 mouth-iso.cjs 改：冻结动画后只改 ParamArmL{A,B}，两图之差只可能来自手臂参数。
 * 用途：证明 image2live2d 生成的手臂参数**真的驱动几何**（而不只是出现在 cdi3 清单里）。
 *
 * 为什么要单独做：Idle 动作在持续播放，普通截图里身体/头发也在动，
 * 逐像素差异无法归因给嘴参数。本脚本**先冻结动画**，再只改 LipSync 参数截两张图
 * → 两张图之差 100% 来自嘴参数。
 *
 * 🔴 「冻结」是**两步**，缺一不可（修前只做第一步，读数不可作断言）：
 *   ① 勾「冻结动画」→ 演示页的渲染循环只 draw 不 update（画面不再被动作推着走）；
 *   ② 把姿态钉成**确定性**状态 → `stopAllMotions()` 清空动作队列 ＋ 全部参数复位到
 *      moc 里的默认值 ＋ `model.update()`。只做①时，冻结姿态取决于"冻结发生在装载后
 *      第几帧"，同一模型连跑三次 changedPixels = 20 / 89 / 82（修前实测）。
 *   ⚠️ ②里的 `stopAllMotions()` 依赖宿主已按官方签名把 `autoDelete` 传 `false`
 *      （L2D-FIX-IDLE）：否则 `release()` 会把宿主长期缓存的动作对象掏空。
 *
 * 用法（工作区根）：/opt/homebrew/bin/node tools/arm-iso.cjs [模型名]
 * 产出：evidence/mouthiso_<Model>_{closed,open,closed_again}.png ＋ mouthiso_<Model>.json
 *
 * 不变量（三条，全部要在 verdict 里成立）：
 *   ① 写值后差异 > 0；② 差异是局部小面积（粗筛：整只模型动起来是百分之几十，嘴部是千分之几）；
 *   ③ 改回闭合后 0 像素差。
 * 退出码：0 = 三条不变量全部成立；1 = 有不成立；2 = 环境/装载失败。
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

const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.moc3':'application/octet-stream' };

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

function diff(aBuf, bBuf, inset = 3) {
  const A = decodePNG(aBuf), B = decodePNG(bBuf);
  let changed = 0, sum = 0, max = 0, minX = A.width, minY = A.height, maxX = -1, maxY = -1;
  const hist = new Map();
  for (let y = inset; y < A.height - inset; y++) for (let x = inset; x < A.width - inset; x++) {
    const ia = (y * A.width + x) * A.channels, ib = (y * B.width + x) * B.channels;
    let d = 0;
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(A.data[ia + k] - B.data[ib + k]));
    if (d > 8) {
      changed++; sum += d; if (d > max) max = d;
      if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      const band = Math.floor(y / 20) * 20;
      hist.set(band, (hist.get(band) || 0) + 1);
    }
  }
  const total = (A.width - 2 * inset) * (A.height - 2 * inset);
  return {
    comparedPixels: total, changedPixels: changed, changedRatio: +(changed / total).toFixed(4),
    meanAbsDiffOnChanged: changed ? +(sum / changed).toFixed(2) : 0, maxAbsDiff: max,
    bbox: maxX < 0 ? null : { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 },
    changedByRowBand: [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([y, c]) => ({ yBand: y, changed: c }))
  };
}

const ARM_PARAMS = ['ParamArmLA','ParamArmRA','ParamArmLB','ParamArmRB'];

/** 按 ID 写参数并重绘。
 *  🔴 正确 API：getParameterIndex(id) + setParameterValueById(id, v)。
 *     第一版我用 getParameterId(i) 枚举 → 返回空 → 参数一个都没写上，读数全 0。 */
async function setParams(page, values) {
  return page.evaluate((vals) => {
    const h = window.__host;
    const model = h.userModel.getModel();
    const applied = {};
    for (const [id, v] of Object.entries(vals)) {
      const idx = model.getParameterIndex(id);
      if (idx === undefined || idx === null || idx < 0) { applied[id] = { found: false }; continue; }
      const mn = model.getParameterMinimumValue(idx);
      const mx = model.getParameterMaximumValue(idx);
      const dflt = model.getParameterDefaultValue(idx);
      const value = mn + (mx - mn) * v;          // 0..1 归一 → [min,max]
      model.setParameterValueById(id, value);
      applied[id] = { found: true, idx, min: mn, max: mx, defaultValue: dflt, wrote: +value.toFixed(3) };
    }
    model.update();
    h.draw();
    return applied;
  }, values);
}

(async () => {
  const { server, port } = await startServer(OUT_DIR);
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

  await page.goto(`http://127.0.0.1:${port}/demo.html`, { waitUntil: 'load' });
  await page.selectOption('#model', MODEL);
  await page.click('#load');
  await page.waitForFunction(() => document.getElementById('log').textContent.includes('[shaders] ready=true'), null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  await page.selectOption('#bgsel', 'white');
  await page.waitForTimeout(300);

  // ★ 冻结动画（两步，见文件头说明）
  //   ① 只 draw 不 update
  await page.check('#pause');
  await page.waitForTimeout(400);
  //   ② 姿态钉死：停掉所有动作 + 全部参数复位到 moc 默认值
  const freeze = await page.evaluate(() => {
    const h = window.__host;
    const mm = h.userModel.getMotionManager();
    mm.stopAllMotions();
    const model = h.userModel.getModel();
    const n = model.getParameterCount();
    for (let i = 0; i < n; i++) model.setParameterValueByIndex(i, model.getParameterDefaultValue(i));
    model.update();
    h.draw();
    return {
      queueLengthAfterStop: mm.getCubismMotionQueueEntries().length,
      parameterCount: n,
      lipSyncIds: h.lipSyncIds,
      pose: 'moc 默认值（确定性）'
    };
  });

  const rest   = join(EVID, `armiso_${MODEL}_rest.png`);
  const raised = join(EVID, `armiso_${MODEL}_raised.png`);
  const back   = join(EVID, `armiso_${MODEL}_rest_again.png`);

  const neutral = { ParamArmLA:0.5, ParamArmRA:0.5, ParamArmLB:0.5, ParamArmRB:0.5 };
  const up01    = { ParamArmLA:1.0, ParamArmRA:1.0, ParamArmLB:1.0, ParamArmRB:1.0 };

  const appliedNeutral = await setParams(page, neutral);
  await page.waitForTimeout(500);
  await page.locator('#stagewrap').screenshot({ path: rest });

  const appliedUp = await setParams(page, up01);
  await page.waitForTimeout(500);
  await page.locator('#stagewrap').screenshot({ path: raised });

  await setParams(page, neutral);
  await page.waitForTimeout(500);
  await page.locator('#stagewrap').screenshot({ path: back });

  const closedVsOpen = diff(readFileSync(rest), readFileSync(raised));
  const armApplied = { neutral: appliedNeutral, up: appliedUp };
  const closedVsClosedAgain = diff(readFileSync(rest), readFileSync(back));
  const bbox = closedVsOpen.bbox;
  const invariants = {
    // ① 写值后差异 > 0（嘴确实被参数驱动了）
    valueChangesPixels: closedVsOpen.changedPixels > 0,
    // ② 差异是**局部小面积**（粗筛：整只模型动起来是百分之几十，嘴部是千分之几）
    localChange:
      bbox !== null && (bbox.w * bbox.h) / closedVsOpen.comparedPixels < 0.02,
    // ③ 改回闭合后 0 像素差（可逆、无累积漂移）
    reversible: closedVsClosedAgain.changedPixels === 0
  };
  const out = {
    model: MODEL,
    frozen: true,
    freeze,
    files: { rest, raised, restAgain: back },
    armApplied,
    lipSyncIds: freeze.lipSyncIds,
    closedVsOpen,
    closedVsClosedAgain,
    invariants,
    verdict: { pass: Object.values(invariants).every(Boolean) },
    note:
      '动画已冻结（只 draw 不 update）＋ 姿态已钉死（stopAllMotions + 参数复位到 moc 默认值），' +
      '因此 closed↔open 的全部差异只可能来自 LipSync 参数；读数可作断言（连跑多次应完全相同）'
  };
  writeFileSync(join(EVID, `mouthiso_${MODEL}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close(); server.close();
  process.exit(out.verdict.pass ? 0 : 1);
})().catch((e) => { console.error('FAILED:', e); process.exit(2); });
