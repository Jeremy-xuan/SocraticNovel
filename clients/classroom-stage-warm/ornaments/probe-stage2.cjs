// 探针 v2：打开 stage，若有 workspace 无会话则点「New Session」建一个，再看舞台是否拿到会话钩子
// 用法：node probe-stage2.cjs <url> <out.png>
const { chromium } = require('playwright');

const URL = process.argv[2];
const OUT = process.argv[3] || '/tmp/stage-probe2.png';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)));
  const bad = [];
  page.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 120)); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

  const snap = async (tag) => {
    const s = await page.evaluate(() => ({
      stage: !!document.querySelector('#stage-warm-root'),
      noSession: document.body.innerText.includes('No sessions yet'),
      needWs: document.body.innerText.includes('Choose a workspace'),
      stageNoData: document.body.innerText.includes('舞台没拿到会话数据'),
      textbox: !!document.querySelector('textarea'),
      hint: (document.querySelector('.composer .hint') || {}).textContent || null,
    }));
    console.log(tag, JSON.stringify(s));
    return s;
  };

  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(5000);
    const s = await snap(`${(i + 1) * 5}s`);
    if (s.stage && !s.stageNoData) break;
  }

  // 先关掉欢迎弹窗（班级 class-welcome 的一次性 onboarding）
  for (const label of ['开始使用', '开始', '关掉', '关闭']) {
    try {
      const el = page.getByText(label, { exact: true }).first();
      if (await el.count()) { await el.click({ timeout: 3000 }); console.log('关闭弹窗:', label); await page.waitForTimeout(2500); break; }
    } catch (e) { /* 继续 */ }
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(1500);

  // 尝试点「New Session」
  let clicked = false;
  for (const label of ['New Session', '新建会话', '新会话']) {
    try {
      const el = page.getByText(label, { exact: true }).first();
      if (await el.count()) { await el.click({ timeout: 4000 }); clicked = true; console.log('点击了', label); break; }
    } catch (e) { /* 继续试下一个 */ }
  }
  if (clicked) {
    await page.waitForTimeout(9000);
    await snap('点击后');
  }

  await page.screenshot({ path: OUT });
  const info = await page.evaluate(() => ({
    url: location.href,
    stage: !!document.querySelector('#stage-warm-root'),
    oc: document.querySelectorAll('.oc').length,
    lines: document.querySelectorAll('.line').length,
    body: (document.body.innerText || '').slice(0, 500),
  }));
  console.log(JSON.stringify({ ...info, consoleErrors: errs.slice(0, 6), httpErrors: bad.slice(0, 8) }, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 300)); process.exit(1); });
