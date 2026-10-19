// 点开预设下拉，看有没有教室预设
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(15000);
  for (const l of ['开始使用', '开始']) { try { const e = p.getByText(l, { exact: true }).first(); if (await e.count()) { await e.click({ timeout: 2500 }); await p.waitForTimeout(1500); break; } } catch {} }
  // 点预设下拉（当前显示「班级标准模式」）
  let opened = false;
  for (const l of ['班级标准模式', '预设']) {
    try { const e = p.getByText(l, { exact: false }).first(); if (await e.count()) { await e.click({ timeout: 3000 }); opened = true; console.log('点开:', l); await p.waitForTimeout(2000); break; } } catch {}
  }
  await p.screenshot({ path: '/tmp/preset-picker.png' });
  const txt = await p.evaluate(() => document.body.innerText);
  console.log('点开结果:', opened);
  console.log('出现「计算机系教室」:', txt.includes('计算机系教室'));
  const names = txt.split('\n').map(s => s.trim()).filter(s => s.length > 1 && s.length < 30 && /教室|模式|探索|备考|申请|元学习|指南|调研/.test(s));
  console.log('候选名:\n' + [...new Set(names)].slice(0, 15).join('\n'));
  await b.close();
})().catch(e => { console.error('FATAL', String(e).slice(0,300)); process.exit(1); });
