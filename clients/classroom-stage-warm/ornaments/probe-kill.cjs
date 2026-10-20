const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(22000);
  for (const l of ['开始使用','知道了']) { try { const e=p.getByText(l,{exact:true}).first(); if(await e.count()){await e.click({timeout:2000}); await p.waitForTimeout(600);} } catch {} }
  const chk = async (tag) => {
    const r = await p.evaluate(() => {
      const c = document.querySelector('.cast-l2d');
      const w = document.querySelector('.cast-wrap');
      return { canvas: !!c, cw: c ? c.clientWidth : null, mode: w && w.getAttribute('data-l2d') };
    });
    console.log(tag, JSON.stringify(r));
  };
  await chk('打开时:');
  await p.keyboard.press('Control+Shift+M'); await p.waitForTimeout(2500);
  await chk('关掉后:');
  await p.keyboard.press('Control+Shift+U'); await p.waitForTimeout(8000);
  await chk('再打开:');
  await p.screenshot({ path: '/tmp/after-kill.png' });
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
