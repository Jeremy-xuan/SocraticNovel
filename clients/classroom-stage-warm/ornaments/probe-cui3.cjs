const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 150)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 150)); });
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(16000);
  for (const l of ['开始使用', '知道了']) { try { const e = p.getByText(l, { exact: true }).first(); if (await e.count()) { await e.click({ timeout: 2000 }); await p.waitForTimeout(700); } } catch {} }
  await p.keyboard.press('Control+Shift+M');
  await p.waitForTimeout(1500);
  for (const l of ['CPU为何同时只能运行一个程序', '操作系统第一讲']) {
    try { const loc = p.getByText(l, { exact: false }); if (await loc.count()) { await loc.first().click({ timeout: 3000 }); break; } } catch {}
  }
  await p.waitForTimeout(4000);
  const r = await p.evaluate(() => ({
    guideEntries: [...document.querySelectorAll('[data-sidebar-right-guide-entry]')].map((e) => e.getAttribute('data-sidebar-right-guide-entry')),
    anyClassroomAttr: [...document.querySelectorAll('*')].map((e) => [...e.attributes].map((a) => a.name).filter((n) => /classroom|whiteboard/i.test(n))).flat().slice(0, 8),
    buttons: [...document.querySelectorAll('button')].map((e) => (e.getAttribute('aria-label') || e.title || e.textContent || '').trim()).filter(Boolean).slice(0, 25),
  }));
  console.log(JSON.stringify(r, null, 1).slice(0, 1500));
  console.log('errors:', errs.slice(0, 3));
  await p.screenshot({ path: '/tmp/cui-check3.png' });
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
