// 机核：第 5 屏（选项卡片六态）渲染与断言
const { chromium } = require('playwright');
(async () => {
  const file = 'file:///Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/mockups/stage-modern/avalon-warm.html?screen=5';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = [], pageErrs = [], failed = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => pageErrs.push(String(e).slice(0, 300)));
  page.on('requestfailed', (r) => failed.push(r.url().slice(0, 120)));
  await page.goto(file, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const r = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const qa = (s) => [...document.querySelectorAll(s)];
    const cs = (el) => el ? getComputedStyle(el) : null;
    const oc = qa('.oc');
    const byState = (cls) => oc.filter((e) => e.classList.contains(cls)).length;
    const first = oc[0], second = oc[1];
    // 立绘入画：cast-wrap::after 的渐变是否生效
    const wrap = q('.cast-wrap');
    const afterBg = wrap ? getComputedStyle(wrap, '::after').backgroundImage.slice(0, 60) : null;
    // 卡片内框：cardframe::before 的 inset
    const cf = q('.cardframe');
    const cfBefore = cf ? getComputedStyle(cf, '::before') : null;
    return {
      visibleScreen: qa('.scr').filter((s) => s.classList.contains('on')).map((s) => s.id),
      cardCount: oc.length,
      states: { picked: byState('picked'), sent: byState('sent'), cur: byState('cur'), disabled: byState('disabled') },
      cardBorder: first ? cs(first).borderTopWidth + ' ' + cs(first).borderTopColor : null,
      cardRadius: first ? cs(first).borderTopLeftRadius : null,
      cardHeight: first ? Math.round(first.getBoundingClientRect().height) : null,
      cardBgLayers: first ? cs(first).backgroundImage.split('linear-gradient').length - 1 : 0,
      ornamentCount: qa('.orn svg').length,
      ornamentPath: q('.orn svg path') ? q('.orn svg path').getAttribute('d').slice(0, 40) : null,
      cardframeInner: cfBefore ? cfBefore.position + ' ' + cfBefore.borderTopWidth + ' ' + cfBefore.left : null,
      castVeil: afterBg,
      sansLine: q('.line.sans') ? cs(q('.line.sans')).fontFamily.slice(0, 40) : null,
      sansSize: q('.line.sans') ? cs(q('.line.sans')).fontSize : null,
      weight400: qa('#s5 *').every((e) => getComputedStyle(e).fontWeight === '400'),
      overflowX: document.documentElement.scrollWidth > 1920,
      stateStyles: oc.map((e, i) => ({ i: i + 1, cls: e.className,
        bg: cs(e).backgroundColor, bd: cs(e).borderTopColor, op: cs(e).opacity,
        tx: cs(e.querySelector('.tx')).color, h: Math.round(e.getBoundingClientRect().height),
        top: Math.round(e.getBoundingClientRect().top) })),
      geom: (() => {
        const band = q("#s5 .band"); const last = oc[oc.length-1]; const first = oc[0];
        if (!band || !last) return null;
        const br = band.getBoundingClientRect(); const lr = last.getBoundingClientRect();
        return { bandTop: Math.round(br.top), bandBottom: Math.round(br.bottom),
                 firstCardTop: Math.round(first.getBoundingClientRect().top),
                 lastCardBottom: Math.round(lr.bottom),
                 clippedBy: Math.round(lr.bottom - br.bottom) };
      })(),
    };
  });
  await page.screenshot({ path: '/tmp/avalon-recon/s5-v2-desktop.png' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/avalon-recon/s5-v2-720.png' });
  console.log(JSON.stringify({ r, errs, pageErrs, failed }, null, 1));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
