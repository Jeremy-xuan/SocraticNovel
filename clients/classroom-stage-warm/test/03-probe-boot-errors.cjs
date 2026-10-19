// 侦查用：完整捕获 DSH web boot 的报错原文 + 我们两侧的报到
const { chromium } = require('playwright');

(async () => {
  const url = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  const all = [];
  page.on('console', (m) => all.push({ type: m.type(), text: m.text().slice(0, 2000), loc: m.location() }));
  page.on('pageerror', (e) => all.push({ type: 'pageerror', text: String(e).slice(0, 2000) }));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);

  const dom = await page.evaluate(() => ({
    stageRoot: !!document.getElementById('stage-warm-root'),
    stageChildren: (document.getElementById('stage-warm-root') || {}).children ? document.getElementById('stage-warm-root').children.length : -1,
    stageText: (document.getElementById('stage-warm-root') || {}).innerText ? document.getElementById('stage-warm-root').innerText.slice(0, 300) : '',
    avalonRoot: !!document.getElementById('myh-skin-root'),
    bodyTop: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300),
    slotErrors: [...document.querySelectorAll('[data-slot-error]')].map((e) => e.getAttribute('data-slot-error')),
  }));

  console.log(JSON.stringify({ dom, console: all }, null, 1));
  await page.screenshot({ path: '/tmp/avalon-recon/shot-stage-v1b.png' });
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
