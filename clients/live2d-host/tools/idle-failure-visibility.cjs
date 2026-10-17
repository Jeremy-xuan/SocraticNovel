/**
 * idle-failure-visibility.cjs —— 「起动作失败必须出声」的**故障注入**验证
 *
 * 为什么要有它：
 *   修复要求里有一条「失败时要有可见的报错（不是静默）」。光看正常路径证明不了这条 ——
 *   正常路径根本不失败。所以这里**注入一个必然失败的条件**（把宿主的 idleGroup 置空，
 *   等价于「这个模型没有可用的 Idle 动作」），再看两个入口是否都出声：
 *     ① 渲染循环里的自动待机（`update()` 的 isFinished 分支）；
 *     ② 演示页的「起 Idle 动作」按钮。
 *   两个入口都必须在页面日志里留下 `[host-error]` 字样，且**不许**抛异常打断渲染循环。
 *
 * 🔴 注入方式：`window.__host.idleGroup = null`（演示页已暴露 __host，见锚点 A12）。
 *    **不改任何源码**，因此这个验证对现盘产物成立。
 *
 * 用法：
 *   node .../tools/idle-failure-visibility.cjs [模型名] [--json=path]
 * 退出码：0 = 两个入口都出声；1 = 有一处静默；2 = 环境/装载失败
 */

const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { createReadStream, existsSync, statSync, writeFileSync } = require('node:fs');
const { extname, join, normalize } = require('node:path');

const { hostDir, positional } = require('./_common.cjs');
const HOST_DIR = hostDir();
const OUT_DIR = join(HOST_DIR, 'out');
const MODEL = positional()[0] || 'Haru';
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

(async () => {
  const out = { probe: 'idle-failure-visibility', model: MODEL, at: new Date().toISOString() };
  let exitCode = 2;
  const { server, port } = await startServer(OUT_DIR);
  let browser = null;
  try {
    browser = await chromium.launch({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
    });
    const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    const windowErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
    await page.addInitScript(() => {
      window.__fvOnerrors = [];
      window.addEventListener('error', (e) => window.__fvOnerrors.push(String((e && e.message) || e)));
    });

    await page.goto(`http://127.0.0.1:${port}/demo.html?nomodel=1`, { waitUntil: 'load' });
    await page.selectOption('#model', MODEL);
    await page.click('#load');
    await page.waitForFunction(() => document.getElementById('log').textContent.includes('[shaders] ready=true'), null, { timeout: 120000 });
    await page.waitForTimeout(600);

    // ── 入口 ①：渲染循环的自动待机 ───────────────────────────────
    // 注入必然失败的条件：idleGroup 置空（= 没有可用的 Idle 动作）。
    // 还必须把当前正在播的动作停掉 —— 因为 update() 里「起 Idle」只发生在
    // 「队列里没有还在播的动作」时；否则要等当前动作自己播完（官方样本最长 10s）。
    // 顺带也是 autoDelete=false 的旁证：stopAllMotions() 后缓存动作依然不是空壳。
    const afterStop = await page.evaluate(() => {
      window.__host.idleGroup = null;
      window.__host.userModel.getMotionManager().stopAllMotions();
      const m = window.__host.motionGroups.find((g) => g.name === 'Idle');
      return {
        queueLength: window.__host.userModel.getMotionManager().getCubismMotionQueueEntries().length,
        cachedIdleMotionDataNull: m ? m.motions.some((x) => x._motionData == null) : null
      };
    });
    out.afterStopAllMotions = afterStop;
    await page.waitForTimeout(1200);
    const logAfterLoop = await page.evaluate(() => document.getElementById('log').textContent);

    // ── 入口 ②：演示页「起 Idle 动作」按钮 ───────────────────────
    await page.evaluate(() => { document.getElementById('log').textContent = ''; });
    await page.click('#motion');
    await page.waitForTimeout(600);
    const logAfterButton = await page.evaluate(() => document.getElementById('log').textContent);

    windowErrors.push(...(await page.evaluate(() => window.__fvOnerrors || [])));

    out.loopReported = /\[host-error\][^\n]*起 Idle 动作失败/.test(logAfterLoop);
    out.buttonReported = /\[host-error\][^\n]*起 Idle 动作失败/.test(logAfterButton);
    out.loopLogLines = logAfterLoop.split('\n').filter((l) => l.includes('[host-error]'));
    out.buttonLogLines = logAfterButton.split('\n').filter((l) => l.includes('[host-error]'));
    // 出声但**不许**把渲染循环打断（异常逃逸会进 pageerror / window.onerror）
    out.pageErrors = pageErrors;
    out.windowErrors = windowErrors;
    out.noThrow = pageErrors.length === 0 && windowErrors.length === 0;
    out.pass = out.loopReported && out.buttonReported && out.noThrow;
    exitCode = out.pass ? 0 : 1;
  } catch (e) {
    out.fatal = String((e && e.stack) || e);
    exitCode = 2;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(exitCode);
})().catch((e) => { console.error('FAILED:', e); process.exit(2); });
