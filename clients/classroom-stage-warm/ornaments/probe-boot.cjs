const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  const logs = [];
  p.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 300)));
  p.on('pageerror', (e) => logs.push('PAGEERROR: ' + String(e).slice(0, 400)));
  const bad = [];
  p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(-80)); });
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(25000);
  console.log('body 片段:', (await p.evaluate(() => document.body.innerText)).slice(0, 120).replace(/\n/g, ' | '));
  console.log('HTTP 错误:', bad.slice(0, 6));
  console.log('日志:', logs.slice(0, 10));
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
