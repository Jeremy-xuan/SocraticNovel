const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(22000);
  for (const l of ['开始使用','知道了']) { try { const e=p.getByText(l,{exact:true}).first(); if(await e.count()){await e.click({timeout:2000}); await p.waitForTimeout(600);} } catch {} }
  await p.keyboard.press('Control+Shift+M'); await p.waitForTimeout(1000);
  try { const loc=p.getByText('操作系统第一讲',{exact:false}); if(await loc.count()) await loc.first().click({timeout:3000}); } catch {}
  await p.waitForTimeout(2500);
  await p.keyboard.press('Control+Shift+U'); await p.waitForTimeout(6000);
  await p.screenshot({ path: '/tmp/final-stage.png' });
  const s = await p.evaluate(() => {
    const c = document.querySelector('.band-core');
    return { lines: document.querySelectorAll('.line').length, oc: document.querySelectorAll('.oc').length,
             scroll: c ? { top: Math.round(c.scrollTop), sh: c.scrollHeight, ch: c.clientHeight } : null,
             canvas: !!document.querySelector('.cast-l2d') };
  });
  console.log(JSON.stringify(s));
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
