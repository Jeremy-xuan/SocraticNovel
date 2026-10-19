// 端到端：隐藏 Avalon → 点舞台输入框 → 打字 → 送出 → 看会话流与报错
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2];
  const text = process.argv[3] || '老师在吗？';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 400)); });
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + String(e).slice(0, 400)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);

  // 只隐藏那个同层级的其它皮肤
  await page.evaluate(() => { const a = document.getElementById('myh-skin-root'); if (a) a.style.display = 'none'; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/avalon-recon/flow-0-before.png' });

  // 在舞台自己的输入框里打字
  await page.click('#stage-warm-root textarea');
  await page.type('#stage-warm-root textarea', text, { delay: 30 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/avalon-recon/flow-1-typed.png' });
  await page.click('#stage-warm-root button.send');

  // 等自动发送 + 首轮回复（隔离 profile 没配模型凭据，多半停在这一步）
  const events = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(3000);
    const snap = await page.evaluate(() => {
      const core = document.querySelector('#stage-warm-root .band-core');
      return {
        hint: (document.querySelector('#stage-warm-root .composer .hint') || {}).innerText || '',
        lines: [...document.querySelectorAll('#stage-warm-root .band-core .line')].map((e) => e.className + '|' + e.innerText.slice(0, 60)),
        tl: [...document.querySelectorAll('#stage-warm-root .tline')].map((e) => e.innerText.slice(0, 60)),
        nativeDraft: (document.querySelector('[role="textbox"][contenteditable="true"]') || {}).innerText || '',
        coreText: core ? core.innerText.slice(0, 200) : '',
      };
    });
    events.push({ i, ...snap });
    if (snap.lines.length > 0 || snap.tl.length > 0) { /* 还在流式也要等完 */ }
    if (snap.nativeDraft && i > 2) break;
  }
  await page.screenshot({ path: '/tmp/avalon-recon/flow-2-after.png' });
  console.log(JSON.stringify({ logs: logs.slice(0, 8), events: events.slice(-6) }, null, 1));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
