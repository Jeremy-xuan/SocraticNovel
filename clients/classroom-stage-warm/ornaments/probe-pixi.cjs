const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  const logs = [];
  p.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 160)));
  p.on('pageerror', (e) => logs.push('PAGEERROR: ' + String(e).slice(0, 260)));
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(22000);
  const r = await p.evaluate(() => {
    const out = { pixiVersion: window.PIXI && window.PIXI.VERSION, hasApp: false };
    const cv = document.querySelector('.cast-l2d');
    out.canvasBefore = cv ? { w: cv.width, h: cv.height, cw: cv.clientWidth, ch: cv.clientHeight } : null;
    // 手动试一次：能不能把 canvas 尺寸改掉
    if (cv && window.PIXI) {
      try {
        const app = new window.PIXI.Application({ view: cv, width: 400, height: 550, backgroundAlpha: 0 });
        out.hasApp = true;
        out.afterNew = { w: cv.width, h: cv.height };
        try { app.renderer.resize(420, 560); out.afterResize = { w: cv.width, h: cv.height }; } catch (e) { out.resizeErr = String(e).slice(0, 120) }
        try { app.destroy(false) } catch (e) {}
      } catch (e) { out.newErr = String(e).slice(0, 200) }
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  console.log('logs:', logs.slice(-5));
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
