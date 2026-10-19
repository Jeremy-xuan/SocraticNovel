// 探针：打开 stage 实例页面，检查舞台插件是否挂载、会话钩子是否可用，并截图
// 用法：node probe-stage.mjs <url> <out.png>
const { chromium } = require('playwright');

const URL = process.argv[2];
const OUT = process.argv[3] || '/tmp/stage-probe.png';

(async () => {
  const browser = await chromium.launch({
    args: ['--host-resolver-rules=MAP stage.dsharness.dpdns.org 127.0.0.1'],
  });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  const errs = [];
  const pageErrs = [];
  const failed = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => pageErrs.push(String(e).slice(0, 200)));
  page.on('requestfailed', (r) => failed.push(r.url().slice(0, 120) + ' :: ' + (r.failure() || {}).errorText));
  const bad = [];
  page.on('response', (r) => { const st = r.status(); if (st >= 400) bad.push(st + ' ' + r.url().slice(0, 140)); });
  const reqs = [];
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith('data:')) reqs.push(r.method() + ' ' + u.slice(0, 120)); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // 轮询等舞台根出现（最多 100 秒），并记录过程
  const timeline = [];
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(5000);
    const st = await page.evaluate(() => ({
      stage: !!document.querySelector('#stage-warm-root'),
      len: (document.body.innerText || '').length,
      txt: (document.body.innerText || '').slice(0, 60).replace(/\n/g, ' '),
    }));
    timeline.push(`${(i + 1) * 5}s stage=${st.stage} len=${st.len} "${st.txt}"`);
    if (st.stage) break;
  }
  console.log('TIMELINE:\n' + timeline.join('\n'));

  const info = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const root = q('#stage-warm-root');
    const oc = document.querySelectorAll('.oc').length;
    const text = (document.body.innerText || '').slice(0, 600);
    return {
      title: document.title,
      url: location.href,
      bodyChildren: document.body.children.length,
      stageRoot: !!root,
      stageRect: root ? (() => { const r = root.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), z: getComputedStyle(root).zIndex }; })() : null,
      optionCount: oc,
      hasTextbox: !!q('textarea'),
      hintText: (q('.composer .hint') || {}).textContent || null,
      bodyTextSample: text,
      nativeBanners: [...document.querySelectorAll('[class*=banner],[class*=empty],[class*=hero]')].map((e) => (e.textContent || '').slice(0, 80)).slice(0, 5),
    };
  });

  await page.screenshot({ path: OUT });
  console.log(JSON.stringify({ ...info, consoleErrors: errs.slice(0, 8), pageErrors: pageErrs.slice(0, 8), failedRequests: failed.slice(0, 6), httpErrors: bad.slice(0, 10), requestCount: reqs.length, lastRequests: reqs.slice(-12) }, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 400)); process.exit(1); });
