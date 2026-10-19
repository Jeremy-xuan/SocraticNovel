// 定帧核对「面板从角色身后拉出」三段：170ms 侧身 → 560ms 拉出（过冲）→ 780ms 回正
// 用法：node 14-verify-pullout.cjs "http://127.0.0.1:PORT/?token=X#stagegallery=1" [shotsDir]
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2];
  const dir = process.argv[3] || '/tmp/avalon-recon';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 240)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errs.push(m.text().slice(0, 240)); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);
  await page.evaluate(() => { const a = document.getElementById('myh-skin-root'); if (a) a.style.display = 'none'; });
  await page.waitForTimeout(400);

  const sample = async () => page.evaluate(() => {
    const root = document.querySelector('.stage-warm-root');
    const p = document.querySelector('.boardpanel');
    const c = document.querySelector('.cast-wrap');
    const cs = (e) => e ? getComputedStyle(e) : null;
    return {
      phase: root ? root.getAttribute('data-board') : null,
      panel: p ? { exists: true, rectX: Math.round(p.getBoundingClientRect().x), rectY: Math.round(p.getBoundingClientRect().y),
                   w: Math.round(p.getBoundingClientRect().width), h: Math.round(p.getBoundingClientRect().height),
                   transform: cs(p).transform, opacity: cs(p).opacity, z: cs(p).zIndex } : { exists: false },
      cast: c ? { transform: cs(c).transform, z: cs(c).zIndex, rectX: Math.round(c.getBoundingClientRect().x) } : null,
      panelZvsCast: (p && c) ? { panel: cs(p).zIndex, cast: cs(c).zIndex } : null,
    };
  });

  const t0 = await sample();
  await page.screenshot({ path: dir + '/pull-00-before.png' });
  // 点「板书」
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.stage-warm-root .tool'));
    const b = btns.find((x) => (x.textContent || '').indexOf('板书') >= 0);
    if (!b) return false;
    b.click(); return true;
  });
  const frames = [];
  // 采密一点：0–260ms 每 40ms 一帧（覆盖"预备"与"拉出"的陡段），之后稀疏
  const stamps = [40, 80, 120, 160, 200, 240, 280, 340, 420, 520, 620, 780];
  let prev = 0;
  for (const t of stamps) {
    await page.waitForTimeout(t - prev); prev = t;
    const f = await sample();
    frames.push({ tMs: t, left: f.panel.exists ? f.panel.rectX : null, phase: f.phase,
                  transform: f.panel.transform, opacity: f.panel.opacity, castX: f.cast ? f.cast.rectX : null,
                  panelZ: f.panel.exists ? f.panel.z : null, castZ: f.cast ? f.cast.z : null });
    if (t === 40 || t === 160 || t === 280 || t === 620) await page.screenshot({ path: dir + `/pull-${String(t).padStart(3, '0')}ms.png` });
  }
  // 过冲量：稳定位置 vs 过程中的最小 left（面板从右边进来，left 先小于稳定值＝冲过头）
  const settled = frames[frames.length - 1].left;
  const minLeft = Math.min.apply(null, frames.map((f) => (f.left == null ? 1e9 : f.left)));
  const overshootPx = settled - minLeft;
  console.log(JSON.stringify({ clicked, t0, frames, overshootPx, errs }, null, 1));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
