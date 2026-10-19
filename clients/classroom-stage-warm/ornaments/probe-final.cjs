const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1680, height: 1050 } });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  for (let i = 1; i <= 8; i++) {
    await p.waitForTimeout(10000);
    const s = await p.evaluate(() => ({
      t: document.body.innerText.slice(0, 40).replace(/\n/g, ' '),
      stage: !!document.querySelector('#stage-warm-root'),
      canvas: !!document.querySelector('.cast-l2d'),
      img: !!document.querySelector('.cast'),
    }));
    console.log(`${i*10}s stage=${s.stage} canvas=${s.canvas} img=${s.img} :: "${s.t}"`);
    if (s.stage) break;
  }
  console.log('errors:', errs.slice(0, 3));
  await p.screenshot({ path: '/tmp/l2d-final.png' });
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
