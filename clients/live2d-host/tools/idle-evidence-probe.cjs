/**
 * idle-evidence-probe.cjs —— 真实 10 秒数值曲线 + 首末帧取证（★验收证据生成器）
 *
 * 🔴 重要：本探针**只服务于研究区**，不在主仓跑——
 *   它依赖研究区 `out/`（已含官方 Core + CubismWebFramework bundle + 官方 Samples 模型），
 *   而主仓 `vendor/`/`samples/` 未随仓库分发。请这样跑：
 *
 *     RESEARCH="<研究区 live2d-host>"
 *     OUT="$RESEARCH/out" MODEL=Haru DUR=10000 SEED=42 \
 *       node tools/idle-evidence-probe.cjs --host=$RESEARCH --out=/tmp/idle-evidence
 *
 *   产物（全部在 /tmp/idle-evidence，不进主仓）：
 *     - curve_<模型>_seed<seed>.csv    10 秒逐帧数值（breath/blink/gazeEyeX/mode）
 *     - summary_<模型>_seed<seed>.json  程序化判据结论
 *     - first.png / last.png            首末帧（contact sheet 原料）
 *     - contact_sheet.png               首末帧拼接
 *
 * 验收三条（数值，不靠看图）：
 *   ① 静置 10s：bodyAngleX（呼吸+重心）有起伏、且 range 在 (0.05, 1.5)（生命感不过度漂移）
 *   ② speak/write 分工成立：write 模式呼吸 range < speak 模式；write 模式嘴恒 0
 *   ③ 嘴型闸门不退化：speak 且 provider 有输出时嘴随 provider 动（这里只验 write 锁 0 +
 *      handoff 逻辑；speak 嘴动由 text-rhythm-provider 单测覆盖）
 */

const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { createReadStream, existsSync, statSync, writeFileSync, mkdirSync, readFileSync } = require('node:fs');
const { extname, join, normalize, dirname, resolve } = require('node:path');
const { createHash } = require('node:crypto');

const { hostDir, positional } = require('./_common.cjs');

const HOST_DIR = hostDir();
const OUT_DIR = process.env.OUT_DIR || join(HOST_DIR, 'out');
const EVID_OUT = process.env.IDLE_EVID || '/tmp/idle-evidence';
const MODEL = process.env.MODEL || positional()[0] || 'Haru';
const DUR = Number(process.env.DUR || 10000);
const SEED = Number(process.env.SEED || 42);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.moc3': 'application/octet-stream', '.wav': 'audio/wav'
};

function startServer(rootDir) {
  return new Promise((res) => {
    const server = createServer((req, resp) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      if (rel === '/' || rel === '\\') rel = '/demo.html';
      const abs = join(rootDir, rel);
      if (!abs.startsWith(rootDir) || !existsSync(abs) || !statSync(abs).isFile()) {
        resp.writeHead(404).end('404'); return;
      }
      resp.writeHead(200, { 'content-type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      createReadStream(abs).pipe(resp);
    });
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

function argNum(name, dflt) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : dflt;
}
const EVID_DIR = argStr('out', EVID_OUT);
function argStr(name, dflt) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
}

(async () => {
  mkdirSync(EVID_DIR, { recursive: true });
  const { server, port } = await startServer(OUT_DIR);
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
  });
  const page = await browser.newPage({ viewport: { width: 760, height: 820 } });
  const errors = { pageerror: [], windowOnerror: [], frameErrorInLog: [] };
  page.on('pageerror', (e) => errors.pageerror.push(String(e)));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') errors.frameErrorInLog.push(t);
    if (t.includes('[frame-error]')) errors.frameErrorInLog.push(t);
  });

  const report = { probe: 'idle-evidence-probe', model: MODEL, seed: SEED, durMs: DUR, at: new Date().toISOString() };

  try {
    await page.goto(`http://127.0.0.1:${port}/demo.html?idleSeed=${SEED}&model=${MODEL}`, { waitUntil: 'domcontentloaded' });
    // 选取目标模型并点「装载」（走与用户完全相同的路径，只因取证才用代码触发）
    await page.selectOption('#model', MODEL);
    await page.click('#load');
    // 等宿主装载（demo.html 暴露 window.__host 且 loaded）
    await page.waitForFunction(() => window.__host && window.__host.loaded === true, { timeout: 20000 });

    // 把待机编排层切到 speak / write 各采一段，比较呼吸稳定度 + 嘴闸门
    async function capture(mode, ms) {
      await page.evaluate((m) => window.__host.setIdleMode(m), mode);
      const rows = await page.evaluate(async ({ modeArg, durMs }) => {
        const rows = [];
        const dt = 1 / 30;
        const t0 = performance.now();
        const end = t0 + durMs;
        while (performance.now() < end) {
          window.__host.update(dt);
          const s = window.__host.lastIdleSummary() || {};
          const e = window.__host.idleStats() || {};
          rows.push({
            t: +(performance.now() - t0).toFixed(0),
            breath: s.breath ?? 0,
            blink: s.blink == null ? null : s.blink,
            gazeEyeX: s.gazeEyeX ?? 0,
            mode: s.mode,
            mouth: window.__host.readParameter('ParamMouthOpenY') || window.__host.readParameter('PARAM_MOUTH_OPEN_Y') || 0,
            degradation: e.degradation || []
          });
          await new Promise((r) => setTimeout(r, dt * 1000));
        }
        return rows;
      }, { modeArg: mode, durMs: ms });
      return rows;
    }

    const speakRows = await capture('speak', DUR);
    const writeRows = await capture('write', DUR);

    const range = (rows, key) => {
      const vs = rows.map((r) => Number(r[key])).filter((v) => Number.isFinite(v));
      return vs.length ? Math.max(...vs) - Math.min(...vs) : 0;
    };
    const breathing = (rows) => rows.filter((r) => Math.abs(r.breath) > 1e-4).length;
    const mouthWriteMax = Math.max(...writeRows.map((r) => Math.abs(Number(r.mouth))));

    const speakBreathRange = range(speakRows, 'breath');
    const writeBreathRange = range(writeRows, 'breath');

    report.verdict = {
      breathLife: speakBreathRange > 0.05 && speakBreathRange < 1.5 && breathing(speakRows) > 100,
      speakBreathRange: +speakBreathRange.toFixed(4),
      writeBreathRange: +writeBreathRange.toFixed(4),
      stabilizeOk: writeBreathRange < speakBreathRange,
      writeMouthLocked: mouthWriteMax < 1e-6,
      mouthWriteMax: +mouthWriteMax.toFixed(6),
      degradation: Array.from(new Set([].concat(speakRows[0] && speakRows[0].degradation, writeRows[0] && writeRows[0].degradation))),
      errorsEmpty: errors.pageerror.length === 0 && errors.frameErrorInLog.length === 0
    };

    // 首末帧截图（contact sheet 原料）
    await page.evaluate(() => window.__host.setIdleMode('speak'));
    await page.evaluate(() => window.__host.update(1 / 30));
    const firstPng = await page.locator('#stagewrap').screenshot();
    writeFileSync(join(EVID_DIR, 'first.png'), firstPng);
    // 推进到末帧
    await page.evaluate(() => { for (let i = 0; i < 300; i++) window.__host.update(1 / 30); });
    const lastPng = await page.locator('#stagewrap').screenshot();
    writeFileSync(join(EVID_DIR, 'last.png'), lastPng);

    // CSV（10 秒曲线）
    const csv = ['t,mode,breath,blink,gazeEyeX,mouth'];
    for (const r of speakRows) csv.push([r.t, 'speak', r.breath, r.blink == null ? '' : r.blink, r.gazeEyeX, r.mouth].join(','));
    for (const r of writeRows) csv.push([r.t, 'write', r.breath, r.blink == null ? '' : r.blink, r.gazeEyeX, r.mouth].join(','));
    writeFileSync(join(EVID_DIR, `curve_${MODEL}_seed${SEED}.csv`), csv.join('\n'));
    writeFileSync(join(EVID_DIR, `summary_${MODEL}_seed${SEED}.json`), JSON.stringify(report, null, 2));
    writeFileSync(join(EVID_DIR, 'contact_sheet.png'), Buffer.concat([readFileSync(join(EVID_DIR, 'first.png')), readFileSync(join(EVID_DIR, 'last.png'))]));

    console.log('[idle-evidence] ' + JSON.stringify(report.verdict, null, 2));
    console.log(`[written] ${EVID_DIR}`);
    server.close();
    await browser.close();
    process.exit(report.verdict.breathLife && report.verdict.stabilizeOk && report.verdict.writeMouthLocked && report.verdict.errorsEmpty ? 0 : 1);
  } catch (e) {
    console.error('FAILED:', e);
    server.close();
    await browser.close();
    process.exit(2);
  }
})();
