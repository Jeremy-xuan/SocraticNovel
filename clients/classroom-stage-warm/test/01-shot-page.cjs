// 侦察用：打开隔离 profile 的 web UI，截图 + 收集运行期报错
const { chromium } = require('playwright');

const URL = process.argv[2];
const OUT = process.argv[3] || '/tmp/avalon-recon/shot-default.png';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  const errors = [];
  const pageErrors = [];
  const failed = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  page.on('requestfailed', (r) => failed.push(`${r.url().slice(0, 160)} :: ${r.failure()?.errorText}`));

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(9000);

  const report = await page.evaluate(() => {
    const g = (sel) => document.querySelector(sel);
    const skin = g('#myh-skin-root');
    const st = skin ? getComputedStyle(skin) : null;
    const r = skin ? skin.getBoundingClientRect() : null;
    const imgs = [...document.images].map((i) => i.currentSrc || i.src).slice(0, 40);
    return {
      title: document.title,
      url: location.href,
      bodyChildren: document.body.children.length,
      skinRoot: skin
        ? { exists: true, zIndex: st.zIndex, position: st.position, pointerEvents: st.pointerEvents,
            rect: { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) },
            textLen: skin.innerText.length, textHead: skin.innerText.slice(0, 180) }
        : { exists: false },
      styleTags: document.querySelectorAll('style,link[rel=stylesheet]').length,
      imgCount: document.images.length,
      imgHosts: imgs.map((u) => { try { return new URL(u).origin + new URL(u).pathname; } catch { return String(u).slice(0, 60); } }).slice(0, 12),
      bodyTextHead: document.body.innerText.replace(/\s+/g, ' ').slice(0, 240),
    };
  });

  await page.screenshot({ path: OUT });
  console.log(JSON.stringify({ report, errors: errors.slice(0, 15), pageErrors: pageErrors.slice(0, 15), failed: failed.slice(0, 15) }, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
