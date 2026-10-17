/**
 * idle-rootcause-evidence.cjs —— 「起 Idle 动作冻住」的**根因取证**（一次性证据脚本）
 *
 * 与 idle-motion-probe.cjs 的分工：
 *   - probe = 回归判据（在动/冻住 + 报错，退出码 0/1/2）；
 *   - 本脚本 = 根因取证：**在演示页上按时间轴轮询宿主内部状态**，
 *     把「动作结束 → 队列条目被 release → 缓存动作 _motionData 变 null → 再次起同一对象 → 崩」
 *     这条因果链逐帧钉死。
 *
 * 它**不点任何按钮**，只观察：装载后宿主自己会 `isFinished() → startRandomIdleMotion()`，
 * 所以「动作播完一次」这件事本身就会把缓存动作打死。
 *
 * 用法：
 *   node .../tools/idle-rootcause-evidence.cjs [模型名] [--ms=14000] [--json=path]
 */

const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { createReadStream, existsSync, statSync, writeFileSync } = require('node:fs');
const { extname, join, normalize } = require('node:path');
const { createHash } = require('node:crypto');

const { hostDir, positional } = require('./_common.cjs');
const HOST_DIR = hostDir();
const OUT_DIR = join(HOST_DIR, 'out');
const MODEL = positional()[0] || 'DS_p2l2';
const MS = Number((process.argv.find((x) => x.startsWith('--ms=')) || '--ms=14000').slice(5));
const JSON_OUT = (process.argv.find((x) => x.startsWith('--json=')) || '').slice(7);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.moc3': 'application/octet-stream'
};

function startServer(rootDir) {
  return new Promise((res) => {
    const server = createServer((req, resp) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      if (rel === '/' || rel === '\\') rel = '/demo.html';
      const abs = join(rootDir, rel);
      if (!abs.startsWith(rootDir) || !existsSync(abs) || !statSync(abs).isFile()) { resp.writeHead(404).end('404'); return; }
      resp.writeHead(200, { 'content-type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      createReadStream(abs).pipe(resp);
    });
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

/** 读宿主内部状态：动作队列 + 每个缓存动作的 _motionData / _isLoop */
const SNAPSHOT = () => {
  const h = window.__host;
  if (!h || !h.userModel) return { ready: false };
  // 给每个「队列条目对象」发一个稳定编号：编号变化＝框架新起了一个动作
  // （CubismMotionQueueEntry 的 handle 就是对象自身，不能序列化，所以用 WeakMap 编号）
  if (!window.__rcEntryIds) {
    window.__rcEntryIds = new WeakMap();
    window.__rcEntrySeq = 0;
  }
  const entryId = (e) => {
    if (!window.__rcEntryIds.has(e)) window.__rcEntryIds.set(e, ++window.__rcEntrySeq);
    return window.__rcEntryIds.get(e);
  };
  const mm = h.userModel.getMotionManager();
  const entries = (mm.getCubismMotionQueueEntries() || []).map((e) => ({
    id: e ? entryId(e) : null,
    autoDelete: e ? e._autoDelete : null,
    finished: e ? e.isFinished() : null,
    started: e ? e.isStarted() : null,
    startTime: e && e.getStartTime ? +e.getStartTime().toFixed(2) : null,
    motionDataNull: e && e._motion ? e._motion._motionData == null : null
  }));
  const cached = [];
  for (const g of h.motionGroups) {
    for (const m of g.motions) {
      cached.push({
        group: g.name,
        isLoop: m ? m._isLoop : null,
        motionDataLoop: m && m._motionData ? m._motionData.loop : null,
        motionDataNull: m ? m._motionData == null : null
      });
    }
  }
  return {
    ready: true,
    t: +performance.now().toFixed(0),
    queueLength: entries.length,
    entries,
    entrySeq: window.__rcEntrySeq,
    cached,
    idleGroup: h.idleGroup ? { name: h.idleGroup.name, count: h.idleGroup.count } : null,
    frameErrLogged: window.__l2dErrLogged === true
  };
};

(async () => {
  const { server, port } = await startServer(OUT_DIR);
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  const windowErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.addInitScript(() => {
    window.__rcOnerrors = [];
    window.addEventListener('error', (e) => window.__rcOnerrors.push(String((e && e.message) || e)));
  });

  await page.goto(`http://127.0.0.1:${port}/demo.html?nomodel=1`, { waitUntil: 'load' });
  await page.selectOption('#model', MODEL);
  await page.click('#load');
  await page.waitForFunction(() => document.getElementById('log').textContent.includes('[shaders] ready=true'), null, { timeout: 120000 });

  const timeline = [];
  const hashes = [];
  const t0 = Date.now();
  while (Date.now() - t0 < MS) {
    const snap = await page.evaluate(SNAPSHOT);
    snap.wallMs = Date.now() - t0;
    timeline.push(snap);
    const png = await page.locator('#stagewrap').screenshot();
    hashes.push({ wallMs: snap.wallMs, sha256: createHash('sha256').update(png).digest('hex').slice(0, 16) });
    await page.waitForTimeout(400);
  }
  windowErrors.push(...(await page.evaluate(() => window.__rcOnerrors || [])));
  const log = await page.evaluate(() => document.getElementById('log').textContent);

  const out = {
    model: MODEL,
    observedMs: MS,
    pageErrors,
    windowErrors,
    frameErrorInLog: log.split('\n').filter((l) => l.includes('[frame-error]') || l.includes('[frame-stack]')),
    logTail: log.split('\n').slice(-6),
    canvasHashes: hashes,
    distinctHashes: new Set(hashes.map((h) => h.sha256)).size,
    entrySeqMax: Math.max(0, ...timeline.map((s) => s.entrySeq || 0)),
    timeline
  };
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 2));

  // 打印一条人可读的时间轴
  console.log(`model=${MODEL}  observedMs=${MS}`);
  for (const s of timeline) {
    if (!s.ready) { console.log(`  ${String(s.wallMs).padStart(6)}ms  (host not ready)`); continue; }
    const q = s.entries.map((e) => `[#${e.id} autoDelete=${e.autoDelete} finished=${e.finished} start=${e.startTime} dataNull=${e.motionDataNull}]`).join(' ');
    const nul = s.cached.filter((c) => c.motionDataNull).map((c) => c.group).join(',') || '-';
    console.log(`  ${String(s.wallMs).padStart(6)}ms  queue=${s.queueLength} ${q}  cachedDataNull={${nul}}  entrySeq=${s.entrySeq}  frameErr=${s.frameErrLogged}`);
  }
  console.log(`canvas distinct hashes over window = ${out.distinctHashes}/${hashes.length}`);
  console.log(`动作被起过 ${out.entrySeqMax} 次（队列条目编号最大值；>1 = 播完之后换过下一个）`);
  console.log(`pageErrors=${pageErrors.length} windowErrors=${windowErrors.length} logFrameErr=${out.frameErrorInLog.length}`);
  for (const e of pageErrors) console.log('  pageerror: ' + e);
  for (const e of out.frameErrorInLog) console.log('  log: ' + e);
  await browser.close();
  server.close();
})().catch((e) => { console.error('FAILED:', e); process.exit(2); });
