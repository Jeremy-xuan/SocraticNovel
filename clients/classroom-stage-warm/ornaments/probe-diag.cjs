const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(18000);
  for (const l of ['开始使用', '知道了']) { try { const e = p.getByText(l, { exact: true }).first(); if (await e.count()) { await e.click({ timeout: 2000 }); await p.waitForTimeout(600); } } catch {} }
  await p.keyboard.press('Control+Shift+M'); await p.waitForTimeout(1000);
  try { const loc = p.getByText('操作系统第一讲', { exact: false }); if (await loc.count()) await loc.first().click({ timeout: 3000 }); } catch {}
  await p.waitForTimeout(2000);
  await p.keyboard.press('Control+Shift+U'); await p.waitForTimeout(6000);
  const r = await p.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const cw = q('.cast-wrap');
    const cv = q('.cast-l2d');
    const core = q('.band-core');
    const rect = (el) => el ? (() => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })() : null;
    return {
      castWrap: rect(cw), castWrapMode: cw && cw.getAttribute('data-l2d'),
      canvas: rect(cv), canvasAttrs: cv ? { w: cv.width, h: cv.height } : null,
      canvasStyle: cv ? { w: getComputedStyle(cv).width, h: getComputedStyle(cv).height } : null,
      bandCore: rect(core),
      scroll: core ? { top: core.scrollTop, sh: core.scrollHeight, ch: core.clientHeight } : null,
      ocCount: document.querySelectorAll('.oc').length,
      ocFirst: rect(document.querySelector('.oc')),
    };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
