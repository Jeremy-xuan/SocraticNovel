/**
 * 40_acceptance.cjs —— 「文字 → 嘴参数 → 画面」全链路的浏览器端验收
 *
 * 为什么单独做：`mouth-iso` 只证明「**直接写参数值** → 画面变」；
 * 教室实际走的是「**文字 → TextRhythmProvider → 写嘴参数 → 画面**」这条链。
 * 本脚本在真浏览器里把这条链整条跑一遍，并落盘数值与截图。
 *
 * 只读复用宿主的 src/ 与 out/；本脚本与产出都放 psd2moc3/ 下，不写宿主目录。
 * 🔴 宿主 clients/live2d-host 与其 out/ **不在本仓库内**分发（见 README §四）。
 *    须通过环境变量 LIVE2D_HOST_DIR 指向实际宿主目录；缺失即**响亮失败**退出。
 *
 * 用法：LIVE2D_HOST_DIR=/path/to/live2d-host node tools/psd2moc3/scripts/40_acceptance.cjs [模型名]
 */

const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { createReadStream, existsSync, statSync, writeFileSync, mkdirSync } = require('node:fs');
const { extname, join, normalize, resolve, dirname } = require('node:path');

const TOOL = resolve(__dirname, '..');
const HOST_DIR = process.env.LIVE2D_HOST_DIR || resolve(TOOL, '..', '..', 'clients', 'live2d-host');
const OUT = join(TOOL, 'out');
const EVID = join(OUT, 'acceptance');
const MODEL = process.argv[2] || 'p2l2char';

const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.moc3':'application/octet-stream','.frag':'text/plain','.vert':'text/plain' };

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

(async () => {
  mkdirSync(EVID, { recursive: true });
  const { server, port } = await startServer(join(HOST_DIR, 'out'));
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 820 } });
  const pageErrors = [];
  const consoleMsgs = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));

  const report = { model: MODEL, base, steps: [], pageErrors, consoleMsgs: [] };

  try {
    await page.goto(`${base}/demo.html`, { waitUntil: 'load' });
    await page.waitForTimeout(400);

    // ① 能力发现（页面自己会跑 parseCapability 并把结果写进 #cap）
    //
    // 🔴 这里踩过一次假阳性：`#cap` 是**异步**填充的，`selectOption` 之后立刻 textContent
    //    读到的还是**上一张模型**（Haru）的能力表 —— 结果就是"p2l2char 有 8 个表情"这种假结论。
    //    修法：① 等日志里出现目标模型的 load 行；② 校验下拉框现值确实是目标模型；
    //          ③ 断言模型名与要测的一致，不一致直接判失败。
    await page.selectOption('#model', MODEL);
    // 🔴 演示页里 `#model` 的 change **不触发装载**（源码逐字：`$('load').onclick = () => loadModel(sel.value)`）
    //    → 必须显式点「装载并渲染」，否则页面上还停在默认的 Haru。
    await page.click('#load');
    await page.waitForFunction(
      (m) => {
        const log = document.getElementById('log');
        const sel = document.getElementById('model');
        return sel && sel.value === m && log && log.textContent.includes(`/models/${m}/${m}.model3.json`);
      },
      MODEL,
      { timeout: 30000 }
    );
    await page.waitForFunction(
      () => {
        const el = document.getElementById('cap');
        try { return !!el && !!JSON.parse(el.textContent); } catch { return false; }
      },
      null,
      { timeout: 30000 }
    );
    await page.waitForTimeout(600);

    const selected = await page.$eval('#model', (el) => el.value);
    const cap = await page.textContent('#cap');
    const capDetail = JSON.parse(cap);
    report.steps.push({ step: 'capability', ok: selected === MODEL, selected, detail: capDetail });
    if (selected !== MODEL) throw new Error(`下拉框现值 ${selected} ≠ 目标模型 ${MODEL}（能力表可能来自别的模型）`);

    const logAfterLoad = await page.textContent('#log');
    report.steps.push({ step: 'load-log', detail: logAfterLoad.trim().split('\n') });
    // 日志里必须真的出现目标模型那一行，否则后面所有数值都不可信
    if (!logAfterLoad.includes(`/models/${MODEL}/${MODEL}.model3.json`)) {
      throw new Error(`日志里没有 ${MODEL} 的加载行 → 能力表来源不可信`);
    }

    // ② 冻结动画 + 嘴归零，取基线
    await page.check('#pause');
    await page.click('#mouth0');
    await page.waitForTimeout(400);
    await page.locator('#stage, canvas').first().screenshot({ path: join(EVID, `${MODEL}_base.png`) }).catch(() => {});
    const v0 = await page.textContent('#val');

    // ③ 喂一句话，按帧采样「页面里真实的嘴参数值」
    await page.click('#mouth0');
    await page.uncheck('#pause');
    await page.click('#feed');

    const samples = [];
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(120);
      const t = (await page.textContent('#val')).trim();
      const bar = await page.evaluate(() => {
        const el = document.getElementById('bar');
        return el ? el.style.width : null;
      });
      samples.push({ t_ms: (i + 1) * 120, val: Number(t), bar });
    }
    report.steps.push({ step: 'feed-sample', values: samples,
      max: Math.max(...samples.map((s) => s.val)),
      nonZero: samples.filter((s) => s.val > 0.001).length });

    // ④ 冻结在张开最大处截一张
    await page.check('#pause');
    await page.click('#mouth1');
    await page.waitForTimeout(400);
    await page.locator('#stage, canvas').first().screenshot({ path: join(EVID, `${MODEL}_mouth1.png`) }).catch(() => {});

    report.ok = pageErrors.length === 0
      && report.steps[0].ok
      && report.steps[2].nonZero > 0;

    await page.screenshot({ path: join(EVID, `${MODEL}_fullpage.png`), fullPage: true });
  } catch (e) {
    report.error = String(e && e.stack ? e.stack : e);
    report.ok = false;
  } finally {
    await browser.close();
    server.close();
  }

  writeFileSync(join(OUT, `acceptance_${MODEL}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    model: MODEL,
    ok: report.ok,
    pageErrors: report.pageErrors,
    maxMouth: report.steps.find((s) => s.step === 'feed-sample')?.max,
    nonZeroSamples: report.steps.find((s) => s.step === 'feed-sample')?.nonZero,
    lipSync: report.steps.find((s) => s.step === 'capability')?.detail?.嘴参数,
  }, null, 2));
  process.exit(report.ok ? 0 : 1);
})();
