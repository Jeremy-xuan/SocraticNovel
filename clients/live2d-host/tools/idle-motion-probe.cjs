/**
 * idle-motion-probe.cjs —— 「起动作」自动探针（零新增依赖）
 *
 * 为什么需要它：
 *   「起 Idle 动作」这条路径过去只能**人点**，而它恰恰是整棵渲染宿主里唯一
 *   会崩的地方（详见 实现报告_L2D-FIX-IDLE）。人点无法进 CI、无法回归。
 *   本探针把这条路径变成可自动判定的：**起一次动作 → 采样 N 帧画布 → 判"是否真的在动"**。
 *
 * 判据（两条都要）：
 *   ① 画布逐帧真的在变：相邻帧**像素级**比较，changedPixels > 0（不是只看截图顺眼）；
 *      —— 同时输出 sha256 与逐帧变化量（changedPixels / maxAbsDiff），便于人工核对；
 *   ② 零报错：`pageerror` ＋ `window.onerror`/`unhandledrejection` ＋ 页面日志里的
 *      `[frame-error]` 三条通道全部为空。
 *   ⚠️ 只收 `pageerror` 会漏掉被 demo 的 try/catch 吞进日志的帧内异常
 *      （上一路就因此报"脚本 0 错"）——所以三条通道缺一不可。
 *
 * 用法（项目根）：
 *   node clients/live2d-host/tools/idle-motion-probe.cjs [模型名] [选项]
 *
 * 选项：
 *   --frames=N      点按钮前后各采样 N 帧（默认 12）
 *   --interval=MS   帧间隔毫秒（默认 700）
 *                   ⚠️ 窗口必须**长于该模型 Idle 动作的时长**，否则测不出
 *                   「动作播完 → 再起一次」这条路径（这正是崩溃发生的地方）。
 *                   默认 12×700ms ≈ 7.7s，覆盖官方样本里最长的短 Idle（5–6s）。
 *   --json=PATH     把结果 JSON 写到该路径
 *   --host=DIR      宿主目录（默认本脚本上一级）
 *   --button=#motion  改点哪个按钮（默认 #motion「起 Idle 动作」）
 *   --quiet         不打印逐帧表
 *
 * 退出码：
 *   0 = 起动作后画面在动，且零报错
 *   1 = 画面冻住 或 有报错（= 崩溃复现 / 回归失败）
 *   2 = 装载或环境失败（拿不到基线，判据不成立）
 */

const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { createReadStream, existsSync, statSync, writeFileSync, readFileSync } = require('node:fs');
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
const FRAMES = argNum('frames', 12);
const INTERVAL = argNum('interval', 700);
const JSON_OUT = argStr('json', '');
const BUTTON = argStr('button', '#motion');
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

/** 像素级比较两张 PNG：changedPixels / changedRatio / maxAbsDiff */
function pixelDiff(aBuf, bBuf, inset = 2) {
  const A = decodePNG(aBuf), B = decodePNG(bBuf);
  let changed = 0, max = 0, sum = 0;
  for (let y = inset; y < A.height - inset; y++) {
    for (let x = inset; x < A.width - inset; x++) {
      const ia = (y * A.width + x) * A.channels, ib = (y * B.width + x) * B.channels;
      let d = 0;
      for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(A.data[ia + k] - B.data[ib + k]));
      if (d > 2) { changed++; sum += d; if (d > max) max = d; }
    }
  }
  const total = (A.width - 2 * inset) * (A.height - 2 * inset);
  return {
    changedPixels: changed,
    changedRatio: +(changed / total).toFixed(5),
    meanAbsDiffOnChanged: changed ? +(sum / changed).toFixed(2) : 0,
    maxAbsDiff: max
  };
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

async function sampleFrames(page, n, interval) {
  const frames = [];
  for (let i = 0; i < n; i++) {
    const png = await page.locator('#stagewrap').screenshot();
    frames.push({ i, sha256: sha(png), png });
    if (i < n - 1) await page.waitForTimeout(interval);
  }
  return frames;
}

/** 页面内部状态快照（需要 demo.html 暴露 window.__host；缺了就返回 null） */
async function internals(page) {
  return page.evaluate(() => {
    const h = window.__host;
    if (!h || !h.userModel) return null;
    const mm = h.userModel.getMotionManager();
    const entries = (mm.getCubismMotionQueueEntries() || []).map((e) => ({
      autoDelete: e ? e._autoDelete : null,
      finished: e ? e.isFinished() : null,
      started: e ? e.isStarted() : null,
      motionDataNull: e && e._motion ? e._motion._motionData == null : null
    }));
    return {
      loaded: h.loaded,
      idleGroup: h.idleGroup ? { name: h.idleGroup.name, count: h.idleGroup.count } : null,
      motionGroups: h.motionGroups.map((g) => ({ name: g.name, count: g.count })),
      queueLength: entries.length,
      entries,
      cachedMotions: h.motionGroups.map((g) => ({
        group: g.name,
        motions: g.motions.map((m) => ({
          name: m ? m._motionName : null,
          motionDataNull: m ? m._motionData == null : null,
          isLoop: m ? m._isLoop : null
        }))
      })),
      lipSyncIds: h.lipSyncIds,
      frameErrLogged: window.__l2dErrLogged === true
    };
  });
}

function summarize(frames) {
  const hashes = frames.map((f) => f.sha256);
  const deltas = [];
  for (let i = 1; i < frames.length; i++) {
    deltas.push({ from: i - 1, to: i, ...pixelDiff(frames[i - 1].png, frames[i].png) });
  }
  return {
    distinctHashes: new Set(hashes).size,
    frameCount: frames.length,
    hashes,
    deltas,
    movedPixelsTotal: deltas.reduce((s, d) => s + d.changedPixels, 0),
    identicalPairs: deltas.filter((d) => d.changedPixels === 0).length
  };
}

(async () => {
  const result = {
    probe: 'idle-motion-probe',
    model: MODEL,
    button: BUTTON,
    frames: FRAMES,
    intervalMs: INTERVAL,
    at: new Date().toISOString(),
    setupOk: false,
    errors: { pageerror: [], windowOnerror: [], consoleError: [], frameErrorInLog: [] }
  };
  let exitCode = 2;
  const { server, port } = await startServer(OUT_DIR);
  let browser = null;
  try {
    browser = await chromium.launch({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
    });
    const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 1 });

    // ⚠️ 三条报错通道全部收（只收 pageerror 会漏掉被页面 try/catch 吞掉的帧内异常）
    page.on('pageerror', (e) => result.errors.pageerror.push(String(e.message || e)));
    page.on('console', (m) => {
      if (m.type() === 'error') result.errors.consoleError.push(m.text());
    });
    await page.addInitScript(() => {
      window.__probeOnerrors = [];
      window.addEventListener('error', (e) => window.__probeOnerrors.push(String((e && e.message) || e)));
      window.addEventListener('unhandledrejection', (e) =>
        window.__probeOnerrors.push('unhandledrejection: ' + String((e && e.reason && e.reason.message) || e.reason))
      );
    });

    // ?nomodel=1：不自动装载，装载由本脚本显式触发（判据才可归因）
    await page.goto(`http://127.0.0.1:${port}/demo.html?nomodel=1`, { waitUntil: 'load' });
    await page.selectOption('#model', MODEL);
    await page.click('#load');
    await page.waitForFunction(
      () => document.getElementById('log').textContent.includes('[shaders] ready=true'),
      null,
      { timeout: 120000 }
    );
    await page.waitForTimeout(800);
    result.setupOk = true;
    result.before = await internals(page);

    // ① 基线：点按钮之前，画面本来在不在动
    const beforeFrames = await sampleFrames(page, FRAMES, INTERVAL);
    result.baseline = summarize(beforeFrames);

    // ② 起动作（与用户点「起 Idle 动作」完全同一条路径）
    await page.click(BUTTON);
    await page.waitForTimeout(200);
    const afterFrames = await sampleFrames(page, FRAMES, INTERVAL);
    result.afterClick = summarize(afterFrames);
    result.after = await internals(page);

    const log = await page.evaluate(() => document.getElementById('log').textContent);
    result.errors.frameErrorInLog = log.split('\n').filter((l) => l.includes('[frame-error]') || l.includes('[frame-stack]') || l.includes('[window-error]'));
    result.logTail = log.split('\n').slice(-8);

    const errCount =
      result.errors.pageerror.length +
      result.errors.windowOnerror.length +
      result.errors.consoleError.length +
      result.errors.frameErrorInLog.length;

    result.verdict = {
      movedBeforeClick: result.baseline.movedPixelsTotal > 0,
      movedAfterClick: result.afterClick.movedPixelsTotal > 0,
      identicalPairsAfterClick: result.afterClick.identicalPairs,
      errorCount: errCount
    };
    result.verdict.pass = result.verdict.movedAfterClick && errCount === 0;
    exitCode = result.verdict.pass ? 0 : 1;
  } catch (e) {
    result.fatal = String((e && e.stack) || e);
    exitCode = 2;
  } finally {
    try {
      if (browser) {
        const pages = browser.contexts().flatMap((c) => c.pages());
        if (pages[0]) {
          result.errors.windowOnerror = await pages[0].evaluate(() => window.__probeOnerrors || []).catch(() => []);
        }
      }
    } catch { /* 忽略：收尾阶段读不到页面错误不影响主判据 */ }
    if (browser) await browser.close().catch(() => {});
    server.close();
  }

  // 收尾时再合并一次 window.onerror（finally 里已尽力读）
  const errCountFinal =
    result.errors.pageerror.length +
    result.errors.windowOnerror.length +
    result.errors.consoleError.length +
    result.errors.frameErrorInLog.length;
  if (result.verdict) {
    result.verdict.errorCount = errCountFinal;
    result.verdict.pass = result.verdict.movedAfterClick && errCountFinal === 0;
    exitCode = result.verdict.pass ? 0 : 1;
  }

  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(result, null, 2));

  if (!QUIET) {
    console.log(`[probe] model=${MODEL} button=${BUTTON}`);
    if (!result.setupOk) {
      console.log('[probe] SETUP FAILED（装载未完成，判据不成立）');
      console.log(result.fatal || '');
    } else {
      const line = (tag, s) =>
        `${tag}  frames=${s.frameCount}  distinctHashes=${s.distinctHashes}  movedPixelsTotal=${s.movedPixelsTotal}  identicalPairs=${s.identicalPairs}`;
      console.log(line('  点按钮前', result.baseline));
      console.log(line('  点按钮后', result.afterClick));
      console.log('  逐帧变化量（点按钮后）：');
      for (const d of result.afterClick.deltas) {
        console.log(
          `    #${d.from}→#${d.to}  changedPixels=${d.changedPixels}  ratio=${d.changedRatio}  maxAbsDiff=${d.maxAbsDiff}`
        );
      }
      console.log(`  报错：pageerror=${result.errors.pageerror.length} window.onerror=${result.errors.windowOnerror.length} console.error=${result.errors.consoleError.length} log[frame-error]=${result.errors.frameErrorInLog.length}`);
      for (const e of result.errors.pageerror) console.log('    pageerror: ' + e);
      for (const e of result.errors.windowOnerror) console.log('    window.onerror: ' + e);
      for (const e of result.errors.frameErrorInLog) console.log('    log: ' + e);
      if (result.after) {
        console.log(`  动作队列：length=${result.after.queueLength}  entries=${JSON.stringify(result.after.entries)}`);
        const nulls = result.after.cachedMotions.flatMap((g) => g.motions.filter((m) => m.motionDataNull).map((m) => `${g.group}/${m.name}`));
        console.log(`  缓存动作里 _motionData==null 的：${nulls.length ? nulls.join(', ') : '（无）'}`);
      }
      console.log(`  VERDICT pass=${result.verdict.pass}  (movedBeforeClick=${result.verdict.movedBeforeClick} movedAfterClick=${result.verdict.movedAfterClick} errors=${result.verdict.errorCount})`);
    }
  }
  process.exit(exitCode);
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(2);
});
