const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  const logs = [];
  p.on('console', (m) => { const t = m.text(); if (t.includes('[L2D-DIAG]') || m.type() === 'error') logs.push(t.slice(0, 400)); });
  p.on('pageerror', (e) => logs.push('PAGEERROR: ' + String(e).slice(0, 300)));
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(25000);
  for (const l of ['开始使用','知道了']) { try { const e=p.getByText(l,{exact:true}).first(); if(await e.count()){await e.click({timeout:2000}); await p.waitForTimeout(600);} } catch {} }
  await p.waitForTimeout(3000);
  console.log(logs.slice(0, 6).join('\n'));
  await p.screenshot({ path: '/tmp/diag-full.png' });
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
