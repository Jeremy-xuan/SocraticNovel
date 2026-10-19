const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  const r = await page.evaluate(() => {
    const list = [...document.querySelectorAll('[id="stage-warm-root"]')];
    return {
      count: list.length,
      outerHTMLHead: list[0] ? list[0].outerHTML.slice(0, 700) : null,
      attrs: list[0] ? [...list[0].attributes].map((a) => a.name + '=' + String(a.value).slice(0, 40)) : null,
      firstChildClass: list[0] && list[0].firstElementChild ? list[0].firstElementChild.className : null,
      firstChildTag: list[0] && list[0].firstElementChild ? list[0].firstElementChild.tagName : null,
    };
  });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
