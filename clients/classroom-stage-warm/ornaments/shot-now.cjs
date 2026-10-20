const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(18000);
  for (const l of ['开始使用', '知道了']) { try { const e = p.getByText(l, { exact: true }).first(); if (await e.count()) { await e.click({ timeout: 2000 }); await p.waitForTimeout(600); } } catch {} }
  await p.keyboard.press('Control+Shift+M'); await p.waitForTimeout(1200);
  try { const loc = p.getByText('操作系统第一讲', { exact: false }); if (await loc.count()) await loc.first().click({ timeout: 3000 }); } catch {}
  await p.waitForTimeout(2500);
  await p.keyboard.press('Control+Shift+U'); await p.waitForTimeout(4000);
  const m = await p.evaluate(() => {
    const c = document.querySelector('.band-core');
    if (!c) return null;
    return { scrollTop: c.scrollTop, scrollHeight: c.scrollHeight, clientHeight: c.clientHeight,
             firstLineTop: (document.querySelector('.band-core .line') || {}).getBoundingClientRect ? document.querySelector('.band-core .line').getBoundingClientRect().top - c.getBoundingClientRect().top : null };
  });
  console.log('band-core:', JSON.stringify(m));
  await p.screenshot({ path: '/tmp/scroll-fixed.png' });
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
