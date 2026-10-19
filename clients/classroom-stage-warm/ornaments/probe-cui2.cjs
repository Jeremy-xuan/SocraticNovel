const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  const pluginUrls = [];
  p.on('request', (r) => { const u = r.url(); if (u.includes('/plugins/')) pluginUrls.push(u); });
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(16000);
  for (const l of ['开始使用', '知道了']) { try { const e = p.getByText(l, { exact: true }).first(); if (await e.count()) { await e.click({ timeout: 2000 }); await p.waitForTimeout(700); } } catch {} }
  await p.keyboard.press('Control+Shift+M');
  await p.waitForTimeout(1200);
  // 点一个会话
  for (const l of ['CPU为何同时只能运行一个程序', '操作系统第一讲']) {
    try { const loc = p.getByText(l, { exact: false }); if (await loc.count()) { await loc.first().click({ timeout: 3000 }); break; } } catch {}
  }
  await p.waitForTimeout(4000);
  const has = pluginUrls.some((u) => u.includes('classroom-ui'));
  console.log('插件请求数:', pluginUrls.length, '｜含 classroom-ui:', has);
  if (has) console.log('  命中:', pluginUrls.filter((u) => u.includes('classroom-ui')).map((u) => u.slice(0, 120)));
  const dom = await p.evaluate(() => ({
    cui: document.querySelectorAll('[data-classroom-ui]').length,
    tabs: [...document.querySelectorAll('[role=tab]')].map((e) => (e.textContent || '').trim()).slice(0, 12),
    sidebarRight: !!document.querySelector('[class*=sidebar-right],[data-sidebar-right]'),
    anyCuiAttr: [...document.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => a.name.startsWith('data-cui'))).length,
  }));
  console.log(JSON.stringify(dom));
  await p.screenshot({ path: '/tmp/cui-check2.png' });
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
