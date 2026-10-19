// 板书屏机核：点「板书」→ 整屏变纸 + 场景 SVG 上屏 + 面板在角色之后
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
  await page.screenshot({ path: dir + '/board-00-live.png' });
  const before = await page.evaluate(() => {
    const root = document.querySelector('.stage-warm-root');
    return { screen: root.getAttribute('data-screen'), bandH: Math.round(document.querySelector('.band').getBoundingClientRect().height) };
  });
  const clicked = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.stage-warm-root .tool')).find((x) => (x.textContent || '').indexOf('板书') >= 0);
    if (!b) return false; b.click(); return true;
  });
  await page.waitForTimeout(1600);
  const after = await page.evaluate(() => {
    const root = document.querySelector('.stage-warm-root');
    const p = document.querySelector('.boardpanel');
    const svg = p ? p.querySelector('.bp-canvas svg') : null;
    const cs = (e) => e ? getComputedStyle(e) : null;
    const cast = document.querySelector('.cast-wrap');
    return {
      screen: root.getAttribute('data-screen'),
      boardPhase: root.getAttribute('data-board'),
      panel: p ? { x: Math.round(p.getBoundingClientRect().x), y: Math.round(p.getBoundingClientRect().y),
                   w: Math.round(p.getBoundingClientRect().width), h: Math.round(p.getBoundingClientRect().height),
                   z: cs(p).zIndex, opacity: cs(p).opacity } : null,
      castOpacity: cast ? cs(cast).opacity : null,
      castZ: cast ? cs(cast).zIndex : null,
      veilOpacity: (() => { const v = document.querySelector('.veil'); return v ? cs(v).opacity : null })(),
      bandH: Math.round(document.querySelector('.band').getBoundingClientRect().height),
      title: p ? (p.querySelector('.bp-tx') || {}).textContent : null,
      rev: p ? (p.querySelector('.bp-rev') || {}).textContent : null,
      svg: svg ? { exists: true, w: Math.round(svg.getBoundingClientRect().width), h: Math.round(svg.getBoundingClientRect().height),
                   viewBox: svg.getAttribute('viewBox'), texts: svg.querySelectorAll('text').length,
                   rects: svg.querySelectorAll('rect').length, lines: svg.querySelectorAll('line').length,
                   arrows: svg.querySelectorAll('line[marker-end]').length } : { exists: false },
    };
  });
  await page.screenshot({ path: dir + '/board-01-on.png' });
  console.log(JSON.stringify({ before, clicked, after, errs }, null, 1));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
