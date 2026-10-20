// render_warm.js — 把暖纸样稿渲染成 1920x1080 PNG（供与真实 UI 用同一套算法对量）
//
// 运行（必须让 node 解析到项目根的 playwright）：
//   NODE_PATH="/Users/wujunjie/Documents/ChatGPT/大学申请/node_modules" node render_warm.js
//
// 输出（默认落 /tmp/mahoyo-metrics，可用 OUT= 覆盖）：
//   warm_avalon_s1.png / s2.png / s3.png / s4.png    整屏 1920x1080
//   warm_reading_v2_default.png                       整屏（默认 state-n）
//   warm_reading_v2_ao.png                            整屏（点「给选项 · 纸卡」后 state-ao）
//   warm_reading_v2_a.png                             整屏（state-a 短答·纸卡）
//   warm_rects.json                                   各构件 getBoundingClientRect + 计算样式摘要
//
// 说明：构件级裁剪在 Python 侧做（crop 自整屏 PNG + warm_rects.json 的矩形），
//       避免元素截图对 height:0 的装饰线（.band-top）直接失败。
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const MOCK = '/Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/mockups/stage-modern';
const OUT = process.env.OUT || '/tmp/mahoyo-metrics';

const SEL = [
  // avalon-warm
  ['s1', '.tmenu'], ['s1', '.titem'], ['s1', '.titem.on'], ['s1', '.frame'], ['s1', '.corner.tl'],
  ['s1', '.title-block'],
  ['s2', '.band'], ['s2', '.band-top'], ['s2', '.band-core'], ['s2', '.topbar'], ['s2', '.corner.tl'],
  ['s2', '.composer'], ['s2', '.who'], ['s2', '.line'],
  ['s3', '.panel'], ['s3', '.ptitle'], ['s3', '.prule'],
  // reading-v2
  ['v2n', '.topbar'], ['v2n', '.dock'], ['v2n', '.caption'], ['v2n', '.body'], ['v2n', '.composer'],
  ['v2ao', '.dock'], ['v2ao', '.opts'], ['v2ao', '.opt'], ['v2ao', '.sect'],
];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  const rects = {};

  async function load(url) {
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await Promise.all(Array.from(document.images).map(i => i.complete ? 0 :
        new Promise(r => { i.onload = r; i.onerror = r; })));
    });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;}' });
    await page.waitForTimeout(400);
  }

  async function collectScreen(tag, outName) {
    await page.screenshot({ path: path.join(OUT, outName) });
    rects[tag] = rects[tag] || {};
    for (const [t, sel] of SEL) {
      if (t !== tag) continue;
      const r = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
          visible: b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
          bg: cs.backgroundColor, borderB: cs.borderBottomWidth + ' ' + cs.borderBottomColor,
          borderT: cs.borderTopWidth + ' ' + cs.borderTopColor,
          color: cs.color, fs: cs.fontSize, radius: cs.borderRadius,
        };
      }, sel);
      rects[tag][sel] = r;
    }
    console.log('shot', outName);
  }

  const base = 'file://' + path.join(MOCK, 'avalon-warm.html');
  for (const s of [1, 2, 3, 4]) {
    await load(base + '?screen=' + s);
    await collectScreen('s' + s, `warm_avalon_s${s}.png`);
  }

  await load('file://' + path.join(MOCK, 'reading-v2.html'));
  await collectScreen('v2n', 'warm_reading_v2_default.png');
  await page.click('button[data-state="ao"]'); await page.waitForTimeout(400);
  await collectScreen('v2ao', 'warm_reading_v2_ao.png');
  await page.click('button[data-state="a"]'); await page.waitForTimeout(400);
  await collectScreen('v2a', 'warm_reading_v2_a.png');

  fs.writeFileSync(path.join(OUT, 'warm_rects.json'), JSON.stringify(rects, null, 2));
  await browser.close();
  console.log('done', OUT);
})();
