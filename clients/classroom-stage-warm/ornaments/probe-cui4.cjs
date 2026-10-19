const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 150)));
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(16000);
  for (const l of ['开始使用', '知道了']) { try { const e = p.getByText(l, { exact: true }).first(); if (await e.count()) { await e.click({ timeout: 2000 }); await p.waitForTimeout(700); } } catch {} }
  await p.keyboard.press('Control+Shift+M');
  await p.waitForTimeout(1500);
  try { const loc = p.getByText('CPU为何同时只能运行一个程序', { exact: false }); if (await loc.count()) await loc.first().click({ timeout: 3000 }); } catch {}
  await p.waitForTimeout(3500);
  // 打开右栏
  try {
    const btn = p.locator('button[aria-label="Open right sidebar"]').first();
    if (await btn.count()) { await btn.click({ timeout: 4000 }); console.log('已点开右栏'); }
  } catch (e) { console.log('右栏按钮点不动:', String(e).slice(0, 80)); }
  await p.waitForTimeout(3500);
  const r = await p.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      tabs: [...document.querySelectorAll('[role=tab]')].map((e) => (e.textContent || '').trim()).slice(0, 15),
      cui: document.querySelectorAll('[data-classroom-ui]').length,
      panelText: [...document.querySelectorAll('[class*=sidebar],aside')].map((e) => (e.innerText || '').slice(0, 200)).filter(Boolean).slice(0, 3),
      kw: { lesson: /第\s*\d+\s*讲|讲次/.test(t), phase: /相位/.test(t), progress: /进度/.test(t), wb: /白板|whiteboard/i.test(t) },
    };
  });
  console.log(JSON.stringify(r, null, 1).slice(0, 1400));
  await p.screenshot({ path: '/tmp/cui-panel.png' });
  console.log('errors:', errs.slice(0, 3));
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
