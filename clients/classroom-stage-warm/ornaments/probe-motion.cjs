const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 150)));
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(20000);
  for (const l of ['开始使用', '知道了']) { try { const e = p.getByText(l, { exact: true }).first(); if (await e.count()) { await e.click({ timeout: 2000 }); await p.waitForTimeout(700); } } catch {} }
  const st = await p.evaluate(() => {
    const c = document.querySelector('.cast-l2d');
    return { canvas: !!c, w: c && c.width, h: c && c.height, wrap: (document.querySelector('.cast-wrap')||{}).getAttribute && document.querySelector('.cast-wrap').getAttribute('data-l2d') };
  });
  console.log('初始:', JSON.stringify(st));
  await p.screenshot({ path: '/tmp/motion-idle.png' });
  // 发一句，看动作是否切换（截图对比 + 无报错）
  const ta = p.locator('.composer textarea').first();
  try { await ta.click({ timeout: 6000 }); } catch {}
  await ta.fill('老师好，我想学操作系统第一讲。', { force: true });
  await p.waitForTimeout(400);
  await ta.press('Enter');
  await p.waitForTimeout(12000);
  await p.screenshot({ path: '/tmp/motion-thinking.png' });
  await p.waitForTimeout(60000);
  await p.screenshot({ path: '/tmp/motion-speak.png' });
  console.log('errors:', errs.slice(0, 3));
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
