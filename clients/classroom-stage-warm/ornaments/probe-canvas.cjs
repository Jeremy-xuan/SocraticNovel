const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(22000);
  for (const l of ['开始使用','知道了']) { try { const e=p.getByText(l,{exact:true}).first(); if(await e.count()){await e.click({timeout:2000}); await p.waitForTimeout(600);} } catch {} }
  await p.keyboard.press('Control+Shift+M'); await p.waitForTimeout(1000);
  try { const loc=p.getByText('操作系统第一讲',{exact:false}); if(await loc.count()) await loc.first().click({timeout:3000}); } catch {}
  await p.waitForTimeout(2000);
  await p.keyboard.press('Control+Shift+U'); await p.waitForTimeout(8000);
  const el = await p.$('.cast-l2d');
  if (el) {
    await el.screenshot({ path: '/tmp/canvas-only.png' });
    console.log('canvas 元素截图已存');
  } else { console.log('找不到 .cast-l2d'); }
  // 读 banner 里的 warnings（舞台会显示 warnings）
  const btxt = await p.evaluate(() => {
    const b2 = document.querySelector('.banner');
    return b2 ? b2.innerText.slice(0, 300) : null;
  });
  console.log('banner:', btxt);
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
