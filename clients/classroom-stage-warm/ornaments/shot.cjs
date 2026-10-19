// 渲染花饰展厅（自包含 HTML → PNG，1920×1080）
// 用法：node shot.cjs <input.html> <output.png>
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const src = process.argv[2];
  const out = process.argv[3];
  const W = Number(process.argv[4] || 1920);
  const Hh = Number(process.argv[5] || 1080);
  if (!src || !out) { console.error('用法：node shot.cjs <input.html> <output.png>'); process.exit(2); }
  const url = 'file://' + encodeURI(path.resolve(src)).replace(/#/g, '%23');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: Hh }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: W, height: Hh } });
  console.log('shot ->', out);
  if (errs.length) console.log('pageerror:', errs.join(' | '));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
