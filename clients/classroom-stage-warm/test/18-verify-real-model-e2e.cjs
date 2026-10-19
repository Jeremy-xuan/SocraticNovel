// 真模型端到端（goal 第 4 条）：舞台输入条 → 真会话 → 等老师（真模型）回复
// 用法：node 18-verify-real-model-e2e.cjs "http://127.0.0.1:PORT/?token=XXX" "要发的消息" [截图路径]
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2];
  const text = process.argv[3] || '老师好，一句话说说今天讲什么。';
  const shot = process.argv[4] || '/tmp/avalon-recon/real-e2e.png';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errs.push(m.text().slice(0, 200)); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);

  const send = async () => page.evaluate((t) => {
    const root = document.querySelector('.stage-warm-root');
    const ta = root.querySelector('.composer textarea');
    if (!ta) return 'no-textarea';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, t);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  }, text);
  const typed = await send();
  await page.waitForTimeout(400);
  const clicked = await page.evaluate(() => {
    const b = document.querySelector('.stage-warm-root .composer button.send');
    if (!b) return 'no-button';
    if (b.disabled) return 'button-disabled';
    b.click();
    return 'clicked';
  });

  // 轮询：等老师那侧出现 ★ 标记
  const t0 = Date.now();
  let snap = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(3000);
    snap = await page.evaluate(() => {
      const root = document.querySelector('.stage-warm-root');
      const lines = Array.from(root.querySelectorAll('.line')).map((e) => ({ cls: e.className, t: e.innerText.trim().slice(0, 160) }));
      return {
        running: root.getAttribute('data-running'),
        hint: (root.querySelector('.composer .hint') || {}).innerText || '',
        lines: lines,
        opts: Array.from(root.querySelectorAll('.oc')).map((e) => ({ cls: e.className, t: (e.querySelector('.tx') || {}).innerText })),
        footer: (root.querySelector('.band-core') || {}).innerText || '',
      };
    });
    if (snap.lines.some((l) => l.cls.includes('mark'))) break;
    if (!snap.running && i > 3 && snap.lines.length >= 2) break;
  }
  const elapsed = Math.round((Date.now() - t0) / 1000);
  await page.screenshot({ path: shot });
  console.log(JSON.stringify({ typed, clicked, elapsedSec: elapsed, snap, errs }, null, 1));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
