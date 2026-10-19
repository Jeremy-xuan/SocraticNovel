const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  const r = await page.evaluate(() => {
    const el = document.getElementById('stage-warm-root');
    const sheet = [...document.styleSheets].find((s) => s.ownerNode && s.ownerNode.id === 'stage-warm-css');
    const rules = sheet ? [...sheet.cssRules].slice(0, 4).map((x) => ({ sel: x.selectorText, head: String(x.cssText).slice(0, 200) })) : null;
    const allFirstRule = sheet && sheet.cssRules[0] ? sheet.cssRules[0].cssText : null;
    const declared = sheet && sheet.cssRules[0] && sheet.cssRules[0].style ? sheet.cssRules[0].style.cssText.slice(0, 260) : null;
    return {
      className: el ? el.className : null,
      id: el ? el.id : null,
      parent: el && el.parentElement ? el.parentElement.tagName : null,
      sheetFound: !!sheet,
      ruleCount: sheet ? sheet.cssRules.length : -1,
      firstRuleSelector: rules ? rules[0].sel : null,
      firstRuleStyleText: declared,
      matchesSelf: el ? el.matches('.stage-warm-root') : null,
      bandMatches: el ? !!el.querySelector('.band') && el.querySelector('.band').matches('.band') : null,
      bandPos: el && el.querySelector('.band') ? getComputedStyle(el.querySelector('.band')).position : null,
      rootPos: el ? getComputedStyle(el).position : null,
    };
  });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
