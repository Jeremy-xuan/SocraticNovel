// 验证 classroom-ui：右栏「教室」面板 + 白板
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(15000);
  for (const l of ['开始使用', '知道了', 'Continue']) {
    try { const e = p.getByText(l, { exact: true }).first(); if (await e.count()) { await e.click({ timeout: 2000 }); await p.waitForTimeout(800); } } catch {}
  }
  // 关舞台，看原生界面
  await p.keyboard.press('Control+Shift+M');
  await p.waitForTimeout(2500);

  const scan = await p.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      cuiNodes: document.querySelectorAll('[data-classroom-ui]').length,
      hasWhiteboard: /whiteboard|白板|板书/i.test(t),
      hasLesson: /讲次|第\s*\d+\s*讲|相位|进度/.test(t),
      tabs: [...document.querySelectorAll('[role=tab],button')].map((e) => (e.textContent || '').trim()).filter((x) => x && x.length < 12).slice(0, 20),
      text: t.slice(0, 600),
    };
  });
  console.log(JSON.stringify({ ...scan, errors: errs.slice(0, 4) }, null, 2).slice(0, 1800));
  await p.screenshot({ path: '/tmp/cui-check.png' });
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
