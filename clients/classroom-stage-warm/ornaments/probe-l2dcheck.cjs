const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  const logs = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 180)); });
  p.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 200)));
  const reqs = [];
  p.on('response', (r) => { const u = r.url(); if (u.includes('/stage-static/l2d/') || u.includes('/stage-static/models/')) reqs.push(r.status() + ' ' + u.split('/stage-static')[1].slice(0, 60)); });
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(25000);
  const st = await p.evaluate(() => {
    const c = document.querySelector('.cast-l2d');
    const wrap = document.querySelector('.cast-wrap');
    return {
      stage: !!document.querySelector('#stage-warm-root'),
      wrapMode: wrap && wrap.getAttribute('data-l2d'),
      hasCanvas: !!c,
      canvasBox: c ? { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight } : null,
      hasImg: !!document.querySelector('.cast'),
      pixi: typeof window.PIXI !== 'undefined',
      live2d: !!(window.PIXI && window.PIXI.live2d),
    };
  });
  console.log(JSON.stringify(st, null, 1));
  console.log('l2d/models 请求:', reqs.slice(0, 12));
  console.log('错误/警告:', logs.slice(0, 6));
  await p.screenshot({ path: '/tmp/l2d-stage2.png' });
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
