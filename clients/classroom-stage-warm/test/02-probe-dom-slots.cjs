// 侦查用：把隔离 profile 页面上「DSH 原生 composer / 槽位」的 DOM 事实挖出来
const { chromium } = require('playwright');

(async () => {
  const url = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);

  const info = await page.evaluate(() => {
    const pick = (el, max = 300) => {
      if (!el) return null;
      return {
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 120),
        role: el.getAttribute('role'),
        ph: el.getAttribute('placeholder'),
        ce: el.getAttribute('contenteditable'),
        visible: !!(el.offsetWidth || el.offsetHeight),
        rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
        text: String(el.innerText || el.value || '').slice(0, max),
      };
    };
    const slots = [...document.querySelectorAll('[data-slot]')].map((e) => e.getAttribute('data-slot'));
    const slotErrors = [...document.querySelectorAll('[data-slot-error]')].map((e) => e.getAttribute('data-slot-error'));
    const inputs = [...document.querySelectorAll('input, textarea, [contenteditable="true"]')].map((e) => pick(e));
    const btns = [...document.querySelectorAll('button')].map((b) => ({ text: String(b.innerText || '').slice(0, 30), aria: b.getAttribute('aria-label'), title: b.getAttribute('title'), type: b.getAttribute('type') })).slice(0, 30);
    return { slots, slotErrors, inputs, btns, bodyText: document.body.innerText.replace(/\s+/g, ' ').slice(0, 400) };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
