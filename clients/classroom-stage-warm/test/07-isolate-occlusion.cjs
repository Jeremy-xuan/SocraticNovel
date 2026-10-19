const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);

  const probe = async (label, setup) => {
    await page.evaluate(setup);
    await page.waitForTimeout(700);
    const path = '/tmp/avalon-recon/hide-' + label + '.png';
    await page.screenshot({ path });
    // 程序化判据：纸带区域是否出现纸色
    const hit = await page.evaluate(() => {
      const b = document.querySelector('#stage-warm-root .band');
      if (!b) return 'no-band';
      const r = b.getBoundingClientRect();
      return { y: Math.round(r.y), h: Math.round(r.height), bg: getComputedStyle(b).backgroundColor };
    });
    return { label, hit };
  };

  const out = [];
  out.push(await probe('00-baseline', () => {}));
  out.push(await probe('01-avalon-off', () => { const a = document.getElementById('myh-skin-root'); if (a) a.style.display = 'none'; }));
  out.push(await probe('02-app-off', () => {
    // 把 DSH 应用根隐藏（保留我们的容器）
    for (const el of [...document.body.children]) {
      if (el.id === 'stage-warm-root') continue;
      el.style.visibility = 'hidden';
    }
    document.documentElement.style.background = '#ff00ff';
    document.body.style.background = '#ff00ff';
  }));
  out.push(await probe('03-both', () => {
    const a = document.getElementById('myh-skin-root'); if (a) a.style.display = 'none';
    for (const el of [...document.body.children]) {
      if (el.id === 'stage-warm-root') continue;
      el.style.visibility = 'hidden';
    }
    document.documentElement.style.background = '#ff00ff';
    document.body.style.background = '#ff00ff';
  }));
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
