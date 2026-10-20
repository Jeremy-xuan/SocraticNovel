const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(18000);
  for (const l of ['开始使用', '知道了']) { try { const e = p.getByText(l, { exact: true }).first(); if (await e.count()) { await e.click({ timeout: 2000 }); await p.waitForTimeout(600); } } catch {} }
  // 打开一个已有会话
  await p.keyboard.press('Control+Shift+M'); await p.waitForTimeout(1200);
  try { const loc = p.getByText('操作系统第一讲', { exact: false }); if (await loc.count()) await loc.first().click({ timeout: 3000 }); } catch {}
  await p.waitForTimeout(2500);
  await p.keyboard.press('Control+Shift+U'); await p.waitForTimeout(3000);
  const r = await p.evaluate(() => ({
    lines: [...document.querySelectorAll('.line')].map((e) => ({ cls: e.className, len: e.textContent.length, head: e.textContent.slice(0, 40) })),
    oc: document.querySelectorAll('.oc').length,
    bandTextLen: (document.querySelector('.band-core') || {}).innerText ? document.querySelector('.band-core').innerText.length : 0,
  }));
  console.log(JSON.stringify(r, null, 1).slice(0, 1200));
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
