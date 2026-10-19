const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 150)));
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(15000);
  for (const l of ['开始使用', '知道了']) { try { const e = p.getByText(l, { exact: true }).first(); if (await e.count()) { await e.click({ timeout: 2000 }); await p.waitForTimeout(700); } } catch {} }
  await p.keyboard.press('Control+Shift+M');
  await p.waitForTimeout(1200);
  for (const l of ['CPU为何同时只能运行一个程序', '操作系统第一讲']) {
    try { const loc = p.getByText(l, { exact: false }); if (await loc.count()) { await loc.first().click({ timeout: 3000 }); break; } } catch {}
  }
  await p.waitForTimeout(3000);
  // 开右栏
  try { const btn = p.locator('button[aria-label="Open right sidebar"]').first(); if (await btn.count()) await btn.click({ timeout: 4000 }); } catch {}
  await p.waitForTimeout(2500);
  // 找指南条目
  const guides = await p.evaluate(() => [...document.querySelectorAll('[data-sidebar-right-guide-entry]')].map((e) => ({
    kind: e.getAttribute('data-sidebar-right-guide-entry'),
    text: (e.innerText || '').replace(/\n/g, ' / ').slice(0, 60),
  })));
  console.log('指南条目:', JSON.stringify(guides));
  // 点「教室」那条
  let opened = false;
  try {
    const el = p.locator('[data-sidebar-right-guide-entry="classroom"]').first();
    if (await el.count()) { await el.click({ timeout: 5000 }); opened = true; }
  } catch (e) { console.log('点指南条目失败:', String(e).slice(0, 80)); }
  await p.waitForTimeout(3500);
  const after = await p.evaluate(() => ({
    tabs: [...document.querySelectorAll('[role=tab]')].map((e) => (e.textContent || '').trim()).slice(0, 10),
    cui: document.querySelectorAll('[data-classroom-ui]').length,
    kw: (() => { const t = document.body.innerText || ''; return { lesson: /第\s*\d+\s*讲/.test(t), phase: /相位/.test(t), progress: /进度/.test(t), teacher: /小鞠/.test(t) }; })(),
    panel: [...document.querySelectorAll('aside,[class*=sidebar]')].map((e) => (e.innerText || '').replace(/\n+/g, ' | ').slice(0, 180)).filter(Boolean).slice(0, 2),
  }));
  console.log('点开教室后:', JSON.stringify(after, null, 1).slice(0, 900));
  console.log('点了教室:', opened, '| errors:', errs.slice(0, 2));
  await p.screenshot({ path: '/tmp/panel-check.png' });
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
