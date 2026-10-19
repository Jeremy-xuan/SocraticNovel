// 侦查：舞台根到底画没画出来（用绘制证据，不用 elementFromPoint）
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);
  const info = await page.evaluate(() => {
    const el = document.getElementById('stage-warm-root');
    if (!el) return { exists: false };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const band = el.querySelector('.band');
    const bs = band ? getComputedStyle(band) : null;
    const br = band ? band.getBoundingClientRect() : null;
    const img = el.querySelector('img.bg');
    const ir = img ? img.getBoundingClientRect() : null;
    return {
      exists: true,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      style: { position: cs.position, zIndex: cs.zIndex, display: cs.display, opacity: cs.opacity,
               visibility: cs.visibility, pointerEvents: cs.pointerEvents, inset: cs.inset, overflow: cs.overflow },
      band: band ? { rect: { y: Math.round(br.y), h: Math.round(br.height), w: Math.round(br.width) },
                     bg: bs.backgroundColor, color: bs.color, zIndex: bs.zIndex } : null,
      bgImg: img ? { rect: { y: Math.round(ir.y), w: Math.round(ir.width), h: Math.round(ir.height) },
                     complete: img.complete, naturalW: img.naturalWidth, naturalH: img.naturalHeight, src: img.src } : null,
      avalon: (() => { const a = document.getElementById('myh-skin-root'); if (!a) return null;
        const acs = getComputedStyle(a); return { zIndex: acs.zIndex, display: acs.display, opacity: acs.opacity }; })(),
      // 绘制证据：取舞台纸带中心点上方的像素（用 canvas 读不到跨域？同源可读）
      styleTags: [...document.querySelectorAll('style[id]')].map((s) => s.id),
    };
  });
  // 像素证据：截取舞台纸带区域
  await page.screenshot({ path: '/tmp/avalon-recon/draw-proof-full.png' });
  const box = await page.evaluate(() => {
    const b = document.querySelector('#stage-warm-root .band');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  });
  if (box) await page.screenshot({ path: '/tmp/avalon-recon/draw-proof-band.png', clip: box });
  console.log(JSON.stringify({ info, box }, null, 1));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
