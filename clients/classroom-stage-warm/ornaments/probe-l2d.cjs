const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  const logs = [];
  p.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 160)));
  p.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 200)));
  const reqs = [];
  p.on('request', (r) => { const u = r.url(); if (u.includes('/l2d/') || u.includes('/models/')) reqs.push(u.split('/stage-static')[1] || u); });
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(20000);
  const st = await p.evaluate(() => {
    const c = document.querySelector('.cast-l2d');
    const img = document.querySelector('.cast');
    const wrap = document.querySelector('.cast-wrap');
    return {
      hasCanvas: !!c,
      canvasSize: c ? { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight } : null,
      hasImg: !!img,
      wrapMode: wrap ? wrap.getAttribute('data-l2d') : null,
      pixi: typeof window.PIXI !== 'undefined',
      live2dNamespace: !!(window.PIXI && window.PIXI.live2d),
    };
  });
  console.log(JSON.stringify(st, null, 1));
  console.log('库/模型请求:', reqs.slice(0, 10));
  console.log('日志:', logs.slice(-8));
  await p.screenshot({ path: '/tmp/l2d-stage.png' });
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
