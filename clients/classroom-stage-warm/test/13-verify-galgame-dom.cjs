// 真机会话核对：galgame 造型 DOM（类名/态/几何/零报错）
// 用法：node 13-verify-galgame-dom.cjs "http://127.0.0.1:PORT/?token=XXX#stagegallery=1" [输出png]
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2];
  const out = process.argv[3] || '/tmp/avalon-recon/dom-galgame.png';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  const errs = [], pageErrs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errs.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => pageErrs.push(String(e).slice(0, 240)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);
  await page.evaluate(() => { const a = document.getElementById('myh-skin-root'); if (a) a.style.display = 'none'; });
  await page.waitForTimeout(500);

  const r = await page.evaluate(() => {
    const root = document.querySelector('.stage-warm-root');
    if (!root) return { rootFound: false, url: location.href };
    const q = (s) => root.querySelector(s);
    const qa = (s) => Array.from(root.querySelectorAll(s));
    const cs = (e, pe) => e ? getComputedStyle(e, pe) : null;
    const oc = qa('.oc');
    const core = q('.band-core');
    const last = oc[oc.length - 1];
    return {
      rootFound: true,
      gallery: root.getAttribute('data-gallery'),
      bootHash: root.getAttribute('data-boot-hash'),
      present: {
        cardframe: !!q('.cardframe'),
        cardframeInnerBorder: q('.cardframe') ? cs(q('.cardframe'), '::before').borderTopWidth : null,
        cardframeInnerInset: q('.cardframe') ? cs(q('.cardframe'), '::before').left : null,
        castWrap: !!q('.cast-wrap'),
        castVeil: q('.cast-wrap') ? String(cs(q('.cast-wrap'), '::after').backgroundImage).slice(0, 34) : null,
        orn: qa('.orn').length,
        ornPath: q('.orn svg path') ? q('.orn svg path').getAttribute('d').slice(0, 30) : null,
        opts: qa('.opts').length,
        lineSans: qa('.line.sans').length,
      },
      states: oc.map((e) => ({ cls: e.className, h: Math.round(e.getBoundingClientRect().height),
        bg: cs(e).backgroundColor, border: cs(e).borderTopColor,
        tx: e.querySelector('.tx') ? cs(e.querySelector('.tx')).color : null,
        op: cs(e).opacity,
        bracketL: String(cs(e, '::before').borderLeftWidth), bracketR: String(cs(e, '::after').borderRightWidth) })),
      geometry: (last && core) ? {
        cardsBottom: Math.round(last.getBoundingClientRect().bottom),
        coreBottom: Math.round(core.getBoundingClientRect().bottom),
        overflowPx: Math.round(last.getBoundingClientRect().bottom - core.getBoundingClientRect().bottom),
      } : null,
      weightAll400: qa('*').every((e) => getComputedStyle(e).fontWeight === '400'),
    };
  });
  await page.screenshot({ path: out });
  console.log(JSON.stringify({ r, errs, pageErrs }, null, 1));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
