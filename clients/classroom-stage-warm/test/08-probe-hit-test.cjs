const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  await page.evaluate(() => { const a = document.getElementById('myh-skin-root'); if (a) a.style.display = 'none'; });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const wrap = document.getElementById('stage-warm-root');
    const inner = wrap.firstElementChild;
    const ta = wrap.querySelector('textarea');
    const send = wrap.querySelector('button.send');
    const cs = getComputedStyle(inner);
    const wr = wrap.getBoundingClientRect(), ir = inner.getBoundingClientRect(), tr = ta.getBoundingClientRect(), sr = send.getBoundingClientRect();
    const hitTa = document.elementFromPoint(tr.x + tr.width / 2, tr.y + tr.height / 2);
    const hitSend = document.elementFromPoint(sr.x + sr.width / 2, sr.y + sr.height / 2);
    const desc = (e) => e ? (e.tagName + '#' + (e.id || '') + '.' + String(e.className).slice(0, 40)) : 'null';
    return {
      wrap: { rect: [Math.round(wr.x), Math.round(wr.y), Math.round(wr.width), Math.round(wr.height)], pos: getComputedStyle(wrap).position, cls: wrap.className, z: getComputedStyle(wrap).zIndex },
      inner: { rect: [Math.round(ir.x), Math.round(ir.y), Math.round(ir.width), Math.round(ir.height)], pos: cs.position, z: cs.zIndex, cls: inner.className, pe: cs.pointerEvents },
      ta: { rect: [Math.round(tr.x), Math.round(tr.y), Math.round(tr.width), Math.round(tr.height)], z: getComputedStyle(ta).zIndex },
      hitAtTa: desc(hitTa), hitAtSend: desc(hitSend),
      peChain: (() => { let e = ta, out = []; while (e && e !== document.body) { out.push(e.tagName + ':' + getComputedStyle(e).pointerEvents); e = e.parentElement; } return out; })(),
    };
  });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
