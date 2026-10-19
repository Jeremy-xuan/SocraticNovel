// 看预设选择器里有没有教室预设
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(14000);
  // 关欢迎弹窗
  for (const l of ['开始使用', '开始']) {
    try { const e = p.getByText(l, { exact: true }).first(); if (await e.count()) { await e.click({ timeout: 2500 }); await p.waitForTimeout(1200); break; } } catch {}
  }
  // 点 New Session 打开预设选择
  for (const l of ['New Session', '新建会话']) {
    try { const e = p.getByText(l, { exact: true }).first(); if (await e.count()) { await e.click({ timeout: 3000 }); console.log('点了', l); await p.waitForTimeout(2500); break; } } catch {}
  }
  await p.screenshot({ path: '/tmp/presets-list.png' });
  const txt = await p.evaluate(() => document.body.innerText);
  const hit = txt.includes('计算机系教室');
  console.log('页面里出现「计算机系教室」:', hit);
  const lines = txt.split('\n').filter(l => /教室|标准模式|自我探索|备考|申请|元学习|指南/.test(l)).slice(0, 20);
  console.log('相关行:\n' + lines.join('\n'));
  console.log('--- 前 900 字 ---\n' + txt.slice(0, 900));
  await b.close();
})().catch(e => { console.error('FATAL', String(e).slice(0,300)); process.exit(1); });
