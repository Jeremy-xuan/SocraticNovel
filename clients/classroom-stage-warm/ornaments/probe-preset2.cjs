// 关掉舞台（Ctrl+Shift+M）→ 点预设下拉 → 看有没有教室预设
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(15000);
  for (const l of ['开始使用', '开始']) { try { const e = p.getByText(l, { exact: true }).first(); if (await e.count()) { await e.click({ timeout: 2500 }); await p.waitForTimeout(1200); break; } } catch {} }
  // 关舞台
  await p.keyboard.press('Control+Shift+M');
  await p.waitForTimeout(2500);
  const stageGone = await p.evaluate(() => !document.querySelector('#stage-warm-root'));
  console.log('舞台已关:', stageGone);
  await p.screenshot({ path: '/tmp/native-ui.png' });
  // 找预设下拉：点含「标准模式」的元素
  let clicked = null;
  for (const txt of ['班级标准模式', '标准模式', '预设']) {
    try {
      const loc = p.getByText(txt, { exact: false });
      const n = await loc.count();
      if (n) { await loc.first().click({ timeout: 3000 }); clicked = txt; break; }
    } catch {}
  }
  await p.waitForTimeout(2200);
  await p.screenshot({ path: '/tmp/preset-open.png' });
  const txt = await p.evaluate(() => document.body.innerText);
  console.log('点击:', clicked, '｜出现「计算机系教室」:', txt.includes('计算机系教室'));
  const cand = [...new Set(txt.split('\n').map(s=>s.trim()).filter(s=>s.length>1&&s.length<32&&/教室|模式|探索|备考|申请|元学习|指南|调研|标准/.test(s)))];
  console.log('候选:\n' + cand.slice(0,15).join('\n'));
  await b.close();
})().catch(e => { console.error('FATAL', String(e).slice(0,300)); process.exit(1); });
