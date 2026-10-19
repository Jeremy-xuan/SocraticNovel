const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1680, height: 1050 } });
  const p = await ctx.newPage();
  // 禁缓存 + 记录立绘请求
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  p.on('response', (r) => { if (r.url().includes('student_f')) console.log('立绘响应:', r.status(), r.url()); });
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(15000);
  for (const l of ['开始使用', '知道了']) { try { const e = p.getByText(l, { exact: true }).first(); if (await e.count()) { await e.click({ timeout: 2000 }); await p.waitForTimeout(700); } } catch {} }
  await p.waitForTimeout(2500);
  const st = await p.evaluate(() => {
    const img = document.querySelector('.cast') || document.querySelector('img[src*="student"]');
    return img ? { src: img.src, w: img.naturalWidth, h: img.naturalHeight } : null;
  });
  console.log('页面里的立绘:', JSON.stringify(st));
  await p.screenshot({ path: '/tmp/portrait-nocache.png' });
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
