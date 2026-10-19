const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  const pending = new Map();
  const failed = [];
  p.on('request', (r) => { if (r.url().includes('/plugins/')) pending.set(r.url(), Date.now()); });
  p.on('requestfinished', (r) => { pending.delete(r.url()); });
  p.on('requestfailed', (r) => { failed.push(r.url().slice(-60) + ' :: ' + (r.failure()||{}).errorText); pending.delete(r.url()); });
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  for (let i = 1; i <= 6; i++) {
    await p.waitForTimeout(10000);
    const txt = await p.evaluate(() => document.body.innerText.slice(0, 60).replace(/\n/g, ' '));
    console.log(`${i * 10}s: "${txt}" 未完成请求=${pending.size}`);
    if (!txt.includes('Loading plugins')) { console.log('已加载完成'); break; }
  }
  console.log('失败请求:', failed.slice(0, 5));
  const stuck = [...pending.keys()].map((u) => u.slice(-70));
  console.log('仍挂着的请求:', stuck.slice(0, 5));
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
