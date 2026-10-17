/**
 * idle-argorder-ablation.cjs —— 「参数顺序就是根因」的**消融验证**（在**修后**产物上重放旧写法）
 *
 * 为什么需要它：
 *   修前那次全量 sweep 跑的是**开工时现盘的 `out/`**，而 `scripts/build.mjs` 会 `rmSync(out)`
 *   重建 —— 那份旧 bundle 已被覆盖、**哈希没留痕**（本轮留痕缺口，如实报告）。
 *   于是「修前崩 / 修后好」这个对照，缺一条"能在现盘上复现"的闭环。
 *   本脚本补上这条闭环：**不改源码**，只在页面里把 `host.startMotion` 换回**旧的调用写法**
 *   （`startMotionPriority(motion, priority)` —— 少传 autoDelete），然后观察：
 *     ① 修后写法：一个动作播完之后，宿主缓存里的 motion 对象**不是空壳**（`_motionData` 还在）；
 *     ② 旧写法：同一个动作播完之后，缓存对象被框架 release 成空壳（`_motionData === null`）；
 *     ③ 再用这个空壳起动作 → 渲染循环抛**与缺陷报告逐字相同**的 TypeError。
 *
 * 用法：
 *   node .../tools/idle-argorder-ablation.cjs [模型名] [--json=path]
 *   （默认用 DS_p2l2 —— 它的 Blink 组只有 1.2s，一次消融 3 秒内跑完）
 * 退出码：0 = 三条都成立（根因被证实）；1 = 有哪条不成立；2 = 环境/装载失败
 */

const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { createReadStream, existsSync, statSync, writeFileSync } = require('node:fs');
const { extname, join, normalize } = require('node:path');

const { hostDir, positional } = require('./_common.cjs');
const HOST_DIR = hostDir();
const OUT_DIR = join(HOST_DIR, 'out');
const MODEL = positional()[0] || 'DS_p2l2';
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

/** 页面内：读某个动作组缓存对象的 `_motionData` 是否已被框架掏空 */
const PROBE = ({ group, index }) => {
  const h = window.__host;
  const g = h.motionGroups.find((x) => x.name === group);
  if (!g || !g.motions[index]) return null;
  const m = g.motions[index];
  return {
    motionDataNull: m._motionData == null,
    queueLength: h.userModel.getMotionManager().getCubismMotionQueueEntries().length,
    frameErrLogged: window.__l2dErrLogged === true
  };
};

/** 页面内：挑一个「时长最短且不在 Idle 组」的动作来消融（消融要快、且不要干扰待机） */
const PICK = () => {
  const h = window.__host;
  let best = null;
  for (const g of h.motionGroups) {
    for (let i = 0; i < g.motions.length; i++) {
      const m = g.motions[i];
      const dur = m && m.getDuration ? m.getDuration() : -1;
      if (!(dur > 0)) continue;
      const score = (g.name === 'Idle' ? 1000 : 0) + dur;
      if (!best || score < best.score) best = { group: g.name, index: i, duration: dur, score };
    }
  }
  return best;
};

(async () => {
  const out = { probe: 'idle-argorder-ablation', model: MODEL, at: new Date().toISOString() };
  let exitCode = 2;
  const { server, port } = await startServer(OUT_DIR);
  let browser = null;
  try {
    browser = await chromium.launch({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
    });
    const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
    await page.goto(`http://127.0.0.1:${port}/demo.html?nomodel=1`, { waitUntil: 'load' });
    await page.selectOption('#model', MODEL);
    await page.click('#load');
    await page.waitForFunction(() => document.getElementById('log').textContent.includes('[shaders] ready=true'), null, { timeout: 120000 });
    await page.waitForTimeout(600);
    const pick = await page.evaluate(PICK);
    if (!pick) throw new Error('这个模型没有任何可用的动作，消融不成立');
    out.group = pick.group;
    out.index = pick.index;
    out.motionDurationSeconds = +pick.duration.toFixed(2);
    const settleMs = Math.round((pick.duration + 0.8) * 1000);

    // ── ① 修后写法：起一次短动作，等它播完，看缓存对象是否还完整 ─────────
    await page.evaluate(({ g, i }) => window.__host.startMotion(g, i, 2), { g: out.group, i: out.index });
    await page.waitForTimeout(settleMs); // 动作时长 + 0.8s：留足播完 + 被摘除的时间
    out.afterFix = await page.evaluate(PROBE, { group: out.group, index: out.index });

    // ── ② 把 startMotion 换回旧写法（少传 autoDelete），再走同一条路 ──────
    await page.evaluate(() => {
      window.__host.startMotion = function (groupName, index, priority = 2) {
        const g = this.motionGroups.find((x) => x.name === groupName);
        if (!g || !g.motions[index]) return false;
        // ↓↓↓ 这就是修前那一行：官方签名是 (motion, autoDelete, priority)，这里只传了两个参数
        this.userModel.getMotionManager().startMotionPriority(g.motions[index], priority);
        return true;
      };
    });
    await page.evaluate(({ g, i }) => window.__host.startMotion(g, i, 2), { g: out.group, i: out.index });
    await page.waitForTimeout(settleMs);
    out.afterOldForm = await page.evaluate(PROBE, { group: out.group, index: out.index });

    // ── ③ 用被掏空的对象再起一次 → 渲染循环应抛逐字相同的 TypeError ───────
    await page.evaluate(({ g, i }) => window.__host.startMotion(g, i, 2), { g: out.group, i: out.index });
    await page.waitForTimeout(700);
    const log = await page.evaluate(() => document.getElementById('log').textContent);
    out.frameErrorInLog = log.split('\n').filter((l) => l.includes('[frame-error]') || l.includes('[frame-stack]'));
    out.pageErrors = pageErrors;

    out.verdict = {
      fixedFormKeepsMotionAlive: out.afterFix && out.afterFix.motionDataNull === false,
      oldFormHollowsMotionOut: out.afterOldForm && out.afterOldForm.motionDataNull === true,
      crashReproduced: out.frameErrorInLog.some((l) => l.includes("Cannot read properties of null (reading 'duration')"))
    };
    out.pass = out.verdict.fixedFormKeepsMotionAlive && out.verdict.oldFormHollowsMotionOut && out.verdict.crashReproduced;
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
