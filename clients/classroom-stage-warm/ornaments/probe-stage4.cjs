// 探针 v4：先选中一个已有会话（否则舞台处于"空会话"），再发消息，并检查选项卡片
// 用法：node probe-stage4.cjs <url> <out.png> ["消息"]
const { chromium } = require('playwright');

const URL = process.argv[2];
const OUT = process.argv[3] || '/tmp/stage4.png';
const MSG = process.argv[4] || '我想先弄明白，为什么同一时间只能有一个程序在用 CPU？';

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 160)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });

  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(14000);

  for (const l of ['开始使用', 'Continue']) {
    try { const e = p.getByText(l, { exact: true }).first(); if (await e.count()) { await e.click({ timeout: 2500 }); await p.waitForTimeout(1200); break; } } catch {}
  }

  // 关舞台，露出原生侧栏去点会话
  await p.keyboard.press('Control+Shift+M');
  await p.waitForTimeout(1500);

  // 点左侧最近的一条会话（文本形如「操作系统第一讲」）
  let picked = null;
  for (const l of ['操作系统第一讲', '操作系统第一讲学习']) {
    try {
      const loc = p.getByText(l, { exact: false });
      if (await loc.count()) { await loc.first().click({ timeout: 3500 }); picked = l; break; }
    } catch {}
  }
  console.log('选中会话:', picked);
  await p.waitForTimeout(3000);

  // 重新打开舞台（Ctrl+Shift+U）
  await p.keyboard.press('Control+Shift+U');
  await p.waitForTimeout(4000);

  const before = await p.evaluate(() => ({
    lines: document.querySelectorAll('.line').length,
    oc: document.querySelectorAll('.oc').length,
    stage: !!document.querySelector('#stage-warm-root'),
    band: (document.querySelector('.band-core') || {}).innerText ? document.querySelector('.band-core').innerText.slice(-120).replace(/\n+/g, ' | ') : '',
  }));
  console.log('发送前:', JSON.stringify(before));

  // 填 + Enter 发送
  const ta = p.locator('.composer textarea').first();
  try { await ta.click({ timeout: 6000 }); } catch {}
  await ta.fill(MSG, { force: true });
  await p.waitForTimeout(600);
  await ta.press('Enter');
  console.log('已按 Enter 发送');

  // 轮询
  const tl = [];
  let hit = false;
  for (let i = 0; i < 45; i++) {
    await p.waitForTimeout(5000);
    const st = await p.evaluate(() => ({
      lines: document.querySelectorAll('.line').length,
      oc: document.querySelectorAll('.oc').length,
      texts: [...document.querySelectorAll('.oc .tx')].map((e) => e.textContent.trim()).slice(0, 6),
      band: (document.querySelector('.band-core') || {}).innerText ? document.querySelector('.band-core').innerText.slice(-200).replace(/\n+/g, ' | ') : '',
    }));
    tl.push(`${(i + 1) * 5}s lines=${st.lines} oc=${st.oc}${st.oc ? ' OPTIONS=' + JSON.stringify(st.texts) : ''}`);
    if (st.oc > 0) { hit = true; break; }
    if (st.lines >= 3 && i > 24) break;
  }
  console.log('TIMELINE:\n' + tl.slice(-10).join('\n'));
  console.log('出现选项卡片:', hit);
  await p.screenshot({ path: OUT });
  const fin = await p.evaluate(() => ({
    lines: [...document.querySelectorAll('.line')].map((e) => e.textContent.slice(0, 100)),
    oc: [...document.querySelectorAll('.oc')].map((e) => e.innerText.replace(/\n/g, ' ').slice(0, 60)),
  }));
  console.log(JSON.stringify({ ...fin, errors: errs.slice(0, 5) }, null, 2).slice(0, 2000));
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 300)); process.exit(1); });
