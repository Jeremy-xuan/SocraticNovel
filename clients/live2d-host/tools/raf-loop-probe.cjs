/**
 * raf-loop-probe.cjs —— 「渲染循环只能有一个」自动探针（零新增依赖）
 *
 * 为什么需要它：
 *   演示页每次「装载并渲染」都会新起一条 requestAnimationFrame 循环，**旧的没有停**。
 *   装载 N 次之后，同一帧里 `step()` 会被调用 N 次（画面 3 倍速、白烧 CPU）。
 *   这个缺陷**看不出来**：画面照样在动、脚本照样零报错 —— 所以它必须靠**计数器**判，
 *   不能靠"看起来卡不卡"。
 *
 * 判据（三条合取，缺一不可）：
 *   ① **每帧 step 次数恒为 1**：把 `Live2DHost.prototype.step` 包一层计数，
 *      再用页面内的 rAF 采样器按「帧」分桶 → 输出每帧次数的直方图与最大值；
 *      ⚠️ **分桶是相位偏移一帧的**：采样器的 rAF 回调注册得比演示页的 tick 早，
 *      所以同一帧里它先跑，读到的是**上一帧**的 step 次数 → 第 1 桶恒为 0（窗口边界）。
 *      判据因此取「**除第 1 桶外**每桶恒为 1」，并把原始序列（firstFrames）一并打出来供核对。
 *   ② **画面仍然在动**：相邻两张画布截图**像素级**比较，changedPixels > 0
 *      （与 tools/idle-motion-probe.cjs 同一判据，不是"看一眼觉得流畅"）；
 *   ③ 零报错：pageerror ＋ window.onerror/unhandledrejection ＋ console.error ＋ 页面日志 [frame-error]。
 *
 * 用法（工作区根）：
 *   node clients/live2d-host/tools/raf-loop-probe.cjs [模型名] [选项]
 *
 * 选项：
 *   --loads=1,3,5    依次测「装载 N 次」三种情况（默认 1,3,5）
 *   --shots=N        连续性判据采样的画布帧数（默认 8）
 *   --interval=MS    画布帧间隔毫秒（默认 150）
 *   --window=MS      每帧计数器的观察窗口毫秒（默认 1500）
 *   --json=PATH      结果 JSON 落盘
 *   --host=DIR       宿主目录（默认脚本上一级）
 *   --quiet          不打印逐项明细
 *
 * 退出码：
 *   0 = 每个装载次数下：每帧 step 次数恒为 1，且画面在动、零报错
 *   1 = 出现「每帧 step 次数 > 1」（叠加复现）或画面冻住或有报错
 *   2 = 装载或环境失败（拿不到基线，判据不成立）
 */

const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { createReadStream, existsSync, statSync, writeFileSync } = require('node:fs');
const { extname, join, normalize } = require('node:path');
const { createHash } = require('node:crypto');
const zlib = require('node:zlib');

const { hostDir, positional } = require('./_common.cjs');

const HOST_DIR = hostDir();
const OUT_DIR = join(HOST_DIR, 'out');

function argNum(name, dflt) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : dflt;
}
function argStr(name, dflt) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
}

const MODEL = positional()[0] || 'Haru';
const LOADS = argStr('loads', '1,3,5').split(',').map((s) => Number(s.trim()));
const SHOTS = argNum('shots', 8);
const INTERVAL = argNum('interval', 150);
const WINDOW_MS = argNum('window', 1500);
const JSON_OUT = argStr('json', '');
const QUIET = process.argv.includes('--quiet');

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
      resp.writeHead(200, {
        'content-type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      createReadStream(abs).pipe(resp);
    });
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

// ── PNG 解码（只为本探针服务；不引第三方库）───────────────────────────────
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

function pixelDiff(aBuf, bBuf, inset = 2) {
  const A = decodePNG(aBuf), B = decodePNG(bBuf);
  let changed = 0, max = 0;
  for (let y = inset; y < A.height - inset; y++) {
    for (let x = inset; x < A.width - inset; x++) {
      const ia = (y * A.width + x) * A.channels, ib = (y * B.width + x) * B.channels;
      let d = 0;
      for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(A.data[ia + k] - B.data[ib + k]));
      if (d > 2) { changed++; if (d > max) max = d; }
    }
  }
  return { changedPixels: changed, maxAbsDiff: max };
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * 在页面里装计数器：
 *   ① 把模块导出的 `Live2DHost.prototype.step` 包一层 —— 演示页 import 的是同一个模块实例
 *      （同一 realm、同一 URL → ES 模块注册表里是同一条记录），所以这里改原型 = 改演示页用的类；
 *   ② 起一条**只读**的 rAF 采样器，按帧把 step 计数分桶（它自己不调 step）。
 *      演示页的 tick 与本采样器都在同一帧的 rAF 回调表里，每帧各跑一次 → 分桶结果就是"每帧几次"。
 */
async function instrument(page) {
  return page.evaluate(async () => {
    const mod = await import('./live2d-host.bundle.mjs');
    if (!mod.Live2DHost) return { ok: false, why: 'bundle 里没有导出 Live2DHost' };
    const proto = mod.Live2DHost.prototype;
    window.__stepCount = 0;
    if (!proto.__rafProbePatched) {
      const orig = proto.step;
      proto.step = function (dt) {
        window.__stepCount++;
        return orig.call(this, dt);
      };
      proto.__rafProbePatched = true;
    }
    let last = 0;
    let sampling = false;
    window.__frames = [];
    window.__probeStart = () => {
      last = window.__stepCount;
      window.__frames = [];
      sampling = true;
    };
    window.__probeStop = () => {
      sampling = false;
      return { frames: window.__frames.slice(), total: window.__stepCount };
    };
    const sample = () => {
      if (sampling) {
        window.__frames.push(window.__stepCount - last);
        last = window.__stepCount;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    return { ok: true, patched: proto.__rafProbePatched === true };
  });
}

/** 装载一次：点「装载并渲染」，等到日志出现 [shaders] ready=true（每次装载开头会清空日志） */
async function loadOnce(page, model) {
  await page.selectOption('#model', model);
  await page.click('#load');
  await page.waitForFunction(
    () => document.getElementById('log').textContent.includes('[shaders] ready=true'),
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(300);
}

function histogram(frames) {
  const h = new Map();
  for (const f of frames) h.set(f, (h.get(f) || 0) + 1);
  return [...h.entries()].sort((a, b) => a[0] - b[0]).map(([stepCallsPerFrame, frames]) => ({ stepCallsPerFrame, frames }));
}

/** 一次测量：开窗口 → 采 N 张画布 → 关窗口 */
async function measure(page, label) {
  await page.evaluate(() => window.__probeStart());
  const pngs = [];
  for (let i = 0; i < SHOTS; i++) {
    const png = await page.locator('#stagewrap').screenshot();
    pngs.push({ i, sha256: sha(png), png });
    if (i < SHOTS - 1) await page.waitForTimeout(INTERVAL);
  }
  const counted = await page.evaluate(() => window.__probeStop());
  const frames = counted.frames;
  // 第 1 桶是窗口边界（采样器先于演示页 tick 执行，相位偏移一帧）→ 判据只看第 2 桶起
  const tail = frames.slice(1);
  const deltas = [];
  for (let i = 1; i < pngs.length; i++) deltas.push({ from: i - 1, to: i, ...pixelDiff(pngs[i - 1].png, pngs[i].png) });
  return {
    label,
    rafFramesObserved: frames.length,
    stepCallsTotal: frames.reduce((s, n) => s + n, 0),
    stepCallsPerFrameMax: frames.length ? Math.max(...frames) : null,
    stepCallsPerFrameMin: frames.length ? Math.min(...frames) : null,
    stepCallsPerFrameMean: frames.length ? +(frames.reduce((s, n) => s + n, 0) / frames.length).toFixed(3) : null,
    stepCallsPerFrameTailMin: tail.length ? Math.min(...tail) : null,
    stepCallsPerFrameTailMax: tail.length ? Math.max(...tail) : null,
    histogram: histogram(frames),
    firstFrames: frames.slice(0, 12),
    canvas: {
      shots: pngs.length,
      distinctHashes: new Set(pngs.map((p) => p.sha256)).size,
      identicalPairs: deltas.filter((d) => d.changedPixels === 0).length,
      movedPixelsTotal: deltas.reduce((s, d) => s + d.changedPixels, 0),
      deltas: deltas.map((d) => ({ from: d.from, to: d.to, changedPixels: d.changedPixels }))
    }
  };
}

(async () => {
  const result = {
    probe: 'raf-loop-probe',
    model: MODEL,
    loads: LOADS,
    shots: SHOTS,
    intervalMs: INTERVAL,
    windowMs: WINDOW_MS,
    at: new Date().toISOString(),
    cases: [],
    errors: { pageerror: [], windowOnerror: [], consoleError: [], frameErrorInLog: [] }
  };
  let exitCode = 2;
  const { server, port } = await startServer(OUT_DIR);
  let browser = null;
  try {
    browser = await chromium.launch({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
    });

    for (const L of LOADS) {
      const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 1 });
      const errs = { pageerror: [], consoleError: [], logFrameErr: [] };
      page.on('pageerror', (e) => errs.pageerror.push(String(e.message || e)));
      page.on('console', (m) => { if (m.type() === 'error') errs.consoleError.push(m.text()); });
      await page.addInitScript(() => {
        window.__probeOnerrors = [];
        window.addEventListener('error', (e) => window.__probeOnerrors.push(String((e && e.message) || e)));
        window.addEventListener('unhandledrejection', (e) =>
          window.__probeOnerrors.push('unhandledrejection: ' + String((e && e.reason && e.reason.message) || e.reason))
        );
      });

      const c = { loads: L, setupOk: false };
      await page.goto(`http://127.0.0.1:${port}/demo.html?nomodel=1`, { waitUntil: 'load' });
      c.instrument = await instrument(page);
      if (!c.instrument.ok) throw new Error('计数器安装失败：' + c.instrument.why);

      for (let i = 0; i < L; i++) await loadOnce(page, MODEL);
      c.setupOk = true;

      // ① 演示页自身的循环：装载 L 次之后，每帧 step 几次？
      await page.waitForTimeout(WINDOW_MS);
      c.demoLoop = await measure(page, `装载 ${L} 次（演示页循环）`);

      // ② 宿主 API 幂等性：先勾「冻结动画」让演示页循环只 draw（不进计数），
      //    再连调两次 startLoop() —— 循环只能有一个，所以仍应恒为 1
      await page.check('#pause');
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        window.__host.startLoop();
        window.__host.startLoop();
      });
      await page.waitForTimeout(WINDOW_MS);
      c.hostStartLoopTwice = await measure(page, `装载 ${L} 次（host.startLoop() 连调两次）`);

      const log = await page.evaluate(() => document.getElementById('log').textContent);
      errs.logFrameErr = log.split('\n').filter((l) => l.includes('[frame-error]') || l.includes('[load-error]') || l.includes('[host-error]') || l.includes('[window-error]'));
      c.errors = { ...errs, windowOnerror: await page.evaluate(() => window.__probeOnerrors || []) };
      c.errorCount = errs.pageerror.length + errs.consoleError.length + errs.logFrameErr.length + c.errors.windowOnerror.length;
      c.verdict = {
        demoStepsPerFrameIsOne: c.demoLoop.stepCallsPerFrameTailMax === 1 && c.demoLoop.stepCallsPerFrameTailMin === 1,
        hostStartLoopIdempotent:
          c.hostStartLoopTwice.stepCallsPerFrameTailMax === 1 && c.hostStartLoopTwice.stepCallsPerFrameTailMin === 1,
        canvasMoving: c.demoLoop.canvas.identicalPairs === 0 && c.demoLoop.canvas.movedPixelsTotal > 0,
        errorCount: c.errorCount
      };
      c.verdict.pass =
        c.verdict.demoStepsPerFrameIsOne && c.verdict.hostStartLoopIdempotent && c.verdict.canvasMoving && c.errorCount === 0;
      result.cases.push(c);
      await page.close();
    }

    result.pass = result.cases.every((c) => c.verdict.pass);
    exitCode = result.pass ? 0 : 1;
  } catch (e) {
    result.fatal = String((e && e.stack) || e);
    exitCode = 2;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }

  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(result, null, 2));

  if (!QUIET) {
    console.log(`[raf-probe] model=${MODEL} loads=${LOADS.join(',')} shots=${SHOTS} interval=${INTERVAL}ms`);
    if (result.fatal) console.log('[raf-probe] FATAL: ' + result.fatal);
    for (const c of result.cases) {
      const d = c.demoLoop, h = c.hostStartLoopTwice;
      console.log(`\n── 装载 ${c.loads} 次 ──`);
      if (!d) { console.log('  setup 未完成'); continue; }
      console.log(`  演示页循环：观察 rAF 帧 ${d.rafFramesObserved} 帧，step 总次数 ${d.stepCallsTotal}，每帧次数 min/max/mean = ${d.stepCallsPerFrameMin}/${d.stepCallsPerFrameMax}/${d.stepCallsPerFrameMean}（除第 1 桶外 min/max = ${d.stepCallsPerFrameTailMin}/${d.stepCallsPerFrameTailMax}）`);
      console.log(`    每帧次数直方图：${JSON.stringify(d.histogram)}`);
      console.log(`    前 12 帧：${JSON.stringify(d.firstFrames)}`);
      console.log(`    画布：${d.canvas.shots} 张截图，不同哈希 ${d.canvas.distinctHashes}/${d.canvas.shots}，完全相同对 ${d.canvas.identicalPairs}，变化像素合计 ${d.canvas.movedPixelsTotal}`);
      console.log(`    逐帧变化量：${JSON.stringify(d.canvas.deltas.map((x) => x.changedPixels))}`);
      if (h) {
        console.log(`  host.startLoop() 连调两次：观察 ${h.rafFramesObserved} 帧，每帧次数 min/max/mean = ${h.stepCallsPerFrameMin}/${h.stepCallsPerFrameMax}/${h.stepCallsPerFrameMean}（除第 1 桶外 min/max = ${h.stepCallsPerFrameTailMin}/${h.stepCallsPerFrameTailMax}），直方图 ${JSON.stringify(h.histogram)}`);
      }
      console.log(`  报错：pageerror=${c.errors.pageerror.length} window.onerror=${c.errors.windowOnerror.length} console.error=${c.errors.consoleError.length} 日志=${c.errors.logFrameErr.length}`);
      for (const e of c.errors.pageerror) console.log('    pageerror: ' + e);
      for (const e of c.errors.logFrameErr) console.log('    log: ' + e);
      console.log(`  VERDICT pass=${c.verdict.pass}  每帧恒 1=${c.verdict.demoStepsPerFrameIsOne} startLoop 幂等=${c.verdict.hostStartLoopIdempotent} 画面在动=${c.verdict.canvasMoving} 报错=${c.verdict.errorCount}`);
    }
    console.log(`\n[raf-probe] 总判：pass=${result.pass}`);
  }
  process.exit(exitCode);
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(2);
});
