// 动画屏机核：点「动画」→ 整屏铺开 → <video> 播放 → ended 自动回阅读态
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2]; const dir = process.argv[3] || '/tmp/avalon-recon';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 240)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errs.push(m.text().slice(0, 240)); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);
  await page.evaluate(() => { const a = document.getElementById('myh-skin-root'); if (a) a.style.display = 'none'; });
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => {
    const r = document.querySelector('.stage-warm-root');
    return { anim: r.getAttribute('data-anim'), hasScr: !!document.querySelector('.animscr') };
  });
  const clicked = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.stage-warm-root .tool')).find((x) => (x.textContent || '').trim() === '动画');
    if (!b) return false; b.click(); return true;
  });
  await page.waitForTimeout(1800);
  const on = await page.evaluate(() => {
    const r = document.querySelector('.stage-warm-root');
    const scr = document.querySelector('.animscr'); const v = document.querySelector('.animscr video');
    const cs = (e) => e ? getComputedStyle(e) : null;
    return {
      phase: r.getAttribute('data-anim'),
      scrExists: !!scr,
      scrRect: scr ? { x: Math.round(scr.getBoundingClientRect().x), y: Math.round(scr.getBoundingClientRect().y),
                       w: Math.round(scr.getBoundingClientRect().width), h: Math.round(scr.getBoundingClientRect().height),
                       z: cs(scr).zIndex } : null,
      title: scr ? (scr.querySelector('.as-tx') || {}).textContent : null,
      video: v ? { src: v.currentSrc || v.src, readyState: v.readyState, duration: Math.round((v.duration || 0) * 1000),
                   playing: !v.paused, w: Math.round(v.getBoundingClientRect().width), h: Math.round(v.getBoundingClientRect().height) } : null,
    };
  });
  await page.screenshot({ path: dir + '/anim-01-on.png' });
  // 等它自己放完（片长 3s）→ 应当自动回阅读态
  await page.waitForTimeout(6000);
  const after = await page.evaluate(() => {
    const r = document.querySelector('.stage-warm-root');
    return { phase: r.getAttribute('data-anim'), scrExists: !!document.querySelector('.animscr') };
  });
  await page.screenshot({ path: dir + '/anim-02-after.png' });
  console.log(JSON.stringify({ before, clicked, on, after, errs }, null, 1));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
