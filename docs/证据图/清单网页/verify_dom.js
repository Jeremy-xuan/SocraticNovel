#!/usr/bin/env node
/**
 * 功能总清单网页 · 程序化断言（真实浏览器 DOM） + 截图
 *
 * 用项目根已有的 playwright（v1.63）；本地文件走 file://（DSH 浏览器访问不了 127.0.0.1）。
 *
 * 断言
 *   ① 项数：DOM 里的条目数 == 63
 *   ② 状态：DOM 各状态计数 == 63 的分档（19/9/8/27）
 *   ③ 无外链：本页发出的全部请求都是 file://（零网络）
 *   ④ 无 JS 报错：console error / pageerror / requestfailed 全为 0
 *   ⑤ 交互：状态筛选、分组筛选、搜索 各自生效
 *   ⑥ 设计语言：底色 #0a0a0a、全部字重 400、零投影、卡片 8px 圆角、交互药丸形
 *
 * 🔴 截图纪律：脚本**不注入任何 CSS**（连平滑滚动都没关），截图＝真实渲染。
 *
 * 用法（在项目根跑）：
 *   node 开源线/DSH定制/清单网页/verify_dom.js
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const HERE = __dirname;
const HTML = path.join(HERE, '功能总清单.html');
const EVID = path.join(HERE, 'evidence');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  —— ' + detail : ''}`);
  return !!ok;
}

(async () => {
  if (!fs.existsSync(HTML)) {
    console.error('✗ 产物不存在，先跑 build.py：' + HTML);
    process.exit(1);
  }
  fs.mkdirSync(EVID, { recursive: true });

  const url = 'file://' + HTML.split('/').map(encodeURIComponent).join('/');
  const browser = await chromium.launch();

  // ---------------------------------------------------------------- 桌面宽屏
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const allRequests = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));
  page.on('requestfailed', r => failedRequests.push(r.url() + ' :: ' + (r.failure() && r.failure().errorText)));
  page.on('request', r => allRequests.push(r.url()));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(250); // 让内联 JS 跑完

  // ---------------------------------------------------------- ① ② 项数与状态
  const dom = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.sc'));
    const byStatus = {};
    cards.forEach(c => { const s = c.dataset.status; byStatus[s] = (byStatus[s] || 0) + 1; });
    return {
      total: cards.length,
      byStatus,
      sections: document.querySelectorAll('.gsec').length,
      tiles: Array.from(document.querySelectorAll('.tile .t-num')).map(e => parseInt(e.textContent, 10)),
      countText: document.getElementById('count').textContent.replace(/\s+/g, ' ').trim(),
      groups: Array.from(document.querySelectorAll('.gsec')).map(s => ({
        id: s.id, n: s.querySelectorAll('.sc').length,
      })),
    };
  });

  check('① 项数：DOM 条目数 == 63', dom.total === 63, `DOM ${dom.total} 条`);
  check('① 项数：分组区块数 == 9', dom.sections === 9, `DOM ${dom.sections} 个`);
  check('① 项数：每组条目数 == 8/16/9/5/3/6/5/3/8',
    JSON.stringify(dom.groups.map(g => g.n)) === JSON.stringify([8, 16, 9, 5, 3, 6, 5, 3, 8]),
    dom.groups.map(g => g.n).join('/'));
  check('② 状态：DOM 各状态计数 == 19/9/8/27',
    dom.byStatus.done === 19 && dom.byStatus.half === 9 &&
    dom.byStatus.doing === 8 && dom.byStatus.todo === 27,
    JSON.stringify(dom.byStatus));
  check('② 状态：总览四个大数字 == 19/9/8/27',
    JSON.stringify(dom.tiles) === JSON.stringify([19, 9, 8, 27]), JSON.stringify(dom.tiles));
  check('② 状态：页脚计数行显示 63 / 63', /显示 63 \/ 63 项/.test(dom.countText), dom.countText);

  // ---------------------------------------------------------------- ③ 无外链
  const external = allRequests.filter(u => !u.startsWith('file://'));
  check('③ 无外链：本页发出的全部请求都是 file://（零网络）',
    external.length === 0, `外部请求 ${external.length} 个${external.length ? '：' + external[0] : ''}`);

  // ---------------------------------------------------------------- ④ JS 报错
  check('④ 无 JS 报错：console error == 0', consoleErrors.length === 0,
    consoleErrors.slice(0, 2).join(' | '));
  check('④ 无 JS 报错：pageerror == 0', pageErrors.length === 0,
    pageErrors.slice(0, 2).join(' | '));
  check('④ 无 JS 报错：requestfailed == 0', failedRequests.length === 0,
    failedRequests.slice(0, 2).join(' | '));

  // ---------------------------------------------------------------- ⑥ 设计语言
  const design = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('body *'));
    const weights = new Set();
    const shadows = new Set();
    all.forEach(el => {
      const cs = getComputedStyle(el);
      weights.add(cs.fontWeight);
      shadows.add(cs.boxShadow);
    });
    const sc = document.querySelector('.sc');
    const btn = document.querySelector('.btn');
    const chip = document.querySelector('.chip');
    const css = getComputedStyle(sc);
    const cb = getComputedStyle(btn);
    const cc = getComputedStyle(chip);
    return {
      bodyBg: getComputedStyle(document.body).backgroundColor,
      weights: Array.from(weights),
      shadows: Array.from(shadows),
      scRadius: css.borderTopLeftRadius,
      scBorder: css.borderTopColor,
      scBg: css.backgroundColor,
      btnRadius: cb.borderTopLeftRadius,
      chipRadius: cc.borderTopLeftRadius,
      h1Size: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
      strongColor: getComputedStyle(document.querySelector('strong')).color,
      strongWeight: getComputedStyle(document.querySelector('strong')).fontWeight,
      monoUsed: getComputedStyle(document.querySelector('.sc-num')).fontFamily,
    };
  });

  check('⑥ 设计语言：页面底色 == #0a0a0a', design.bodyBg === 'rgb(10, 10, 10)', design.bodyBg);
  check('⑥ 设计语言：全页字重只有 400（层级不靠加粗）',
    design.weights.length === 1 && design.weights[0] === '400', design.weights.join(','));
  check('⑥ 设计语言：全页零投影（发丝线承重）',
    design.shadows.length === 1 && design.shadows[0] === 'none', design.shadows.join(' | '));
  check('⑥ 设计语言：卡片 8px 圆角', design.scRadius === '8px', design.scRadius);
  check('⑥ 设计语言：卡片底色 #191919 + 发丝线 #212327',
    design.scBg === 'rgb(25, 25, 25)' && design.scBorder === 'rgb(33, 35, 39)',
    `${design.scBg} / ${design.scBorder}`);
  check('⑥ 设计语言：按钮与标签是药丸形（radius 极大）',
    parseFloat(design.btnRadius) >= 100 && parseFloat(design.chipRadius) >= 100,
    `btn ${design.btnRadius} / chip ${design.chipRadius}`);
  check('⑥ 设计语言：strong 不靠颜色或字重拔高（400 且非纯白以外的强调）',
    design.strongWeight === '400', `weight ${design.strongWeight}, color ${design.strongColor}`);
  check('⑥ 设计语言：编号/标签走等宽体',
    /mono|Mono|Menlo|monospace/i.test(design.monoUsed), design.monoUsed.split(',')[0]);

  // ---------------------------------------------------------------- 截图 1
  // 截 fullPage 前先回到顶部：sticky 导航会按当前滚动位置落进长图里，
  // 不回顶部就会在图中部出现一条重复的导航（是截图伪影，不是页面 bug）。
  // 这里只做定位，不注入任何 CSS、不覆盖被测样式。
  const toTop = () => page.evaluate(() => window.scrollTo(0, 0));
  await toTop();
  await page.screenshot({ path: path.join(EVID, 'desktop-1440.png'), fullPage: true });

  // ---------------------------------------------------------------- ⑤ 交互
  await page.click('.btn[data-f="doing"]');
  await page.waitForTimeout(120);
  let vis = await page.evaluate(() => ({
    n: document.querySelectorAll('.sc:not([hidden])').length,
    secs: document.querySelectorAll('.gsec:not([hidden])').length,
    txt: document.getElementById('count').textContent.replace(/\s+/g, ' ').trim(),
    empty: document.getElementById('empty').hidden,
  }));
  check('⑤ 交互：点「正在做」→ 只剩 8 条 / 2 个分组',
    vis.n === 8 && vis.secs === 2 && /显示 8 \/ 63 项/.test(vis.txt) && vis.empty === true,
    `${vis.n} 条 / ${vis.secs} 组 / ${vis.txt}`);
  await toTop();
  await page.screenshot({ path: path.join(EVID, 'desktop-1440-filter-doing.png'), fullPage: true });

  await page.click('.btn[data-f="all"]');
  await page.click('.btn[data-g="g4"]');
  await page.waitForTimeout(120);
  vis = await page.evaluate(() => ({
    n: document.querySelectorAll('.sc:not([hidden])').length,
    ids: Array.from(document.querySelectorAll('.sc:not([hidden])')).map(e => e.id),
  }));
  check('⑤ 交互：点分组「教材」→ 只剩 3 条（38/39/40）',
    vis.n === 3 && JSON.stringify(vis.ids) === JSON.stringify(['item-38', 'item-39', 'item-40']),
    vis.ids.join(','));

  await page.click('.btn[data-g="all"]');
  await page.fill('#q', '白板');
  await page.waitForTimeout(120);
  vis = await page.evaluate(() => ({
    n: document.querySelectorAll('.sc:not([hidden])').length,
    ids: Array.from(document.querySelectorAll('.sc:not([hidden])')).map(e => e.id),
  }));
  check('⑤ 交互：搜索「白板」→ 命中 1 条（28）',
    vis.n === 1 && vis.ids[0] === 'item-28', vis.ids.join(','));

  await page.fill('#q', 'zzz-不存在的词');
  await page.waitForTimeout(120);
  vis = await page.evaluate(() => ({
    n: document.querySelectorAll('.sc:not([hidden])').length,
    emptyShown: !document.getElementById('empty').hidden,
  }));
  check('⑤ 交互：搜不到时显示空状态', vis.n === 0 && vis.emptyShown === true,
    `${vis.n} 条 / 空状态 ${vis.emptyShown}`);

  await page.fill('#q', '');
  await page.waitForTimeout(120);
  vis = await page.evaluate(() => document.querySelectorAll('.sc:not([hidden])').length);
  check('⑤ 交互：清空搜索后恢复 63 条', vis === 63, `${vis} 条`);

  // 横向溢出（桌面）
  const ovD = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('⑤ 布局：桌面 1440 无横向溢出', ovD <= 1, `溢出 ${ovD}px`);

  await ctx.close();

  // ---------------------------------------------------------------- 窄屏
  const ctx2 = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page2 = await ctx2.newPage();
  const err2 = [];
  page2.on('pageerror', e => err2.push(String(e && e.message || e)));
  page2.on('console', m => { if (m.type() === 'error') err2.push(m.text()); });
  await page2.goto(url, { waitUntil: 'load' });
  await page2.waitForTimeout(250);

  const narrow = await page2.evaluate(() => ({
    cards: document.querySelectorAll('.sc').length,
    cols: getComputedStyle(document.querySelector('.cards')).gridTemplateColumns.split(' ').length,
    ov: document.documentElement.scrollWidth - window.innerWidth,
    navLinksHidden: getComputedStyle(document.querySelector('.nav-links')).display === 'none',
    tileCols: getComputedStyle(document.querySelector('.tiles')).gridTemplateColumns.split(' ').length,
  }));
  check('⑤ 布局：窄屏 430 单列卡片', narrow.cols === 1, `${narrow.cols} 列`);
  check('⑤ 布局：窄屏 430 无横向溢出', narrow.ov <= 1, `溢出 ${narrow.ov}px`);
  check('⑤ 布局：窄屏收起了导航链接、条目仍是 63',
    narrow.navLinksHidden === true && narrow.cards === 63,
    `nav 隐藏 ${narrow.navLinksHidden} / ${narrow.cards} 条`);
  check('④ 无 JS 报错：窄屏同样 0 报错', err2.length === 0, err2.slice(0, 2).join(' | '));

  await page2.screenshot({ path: path.join(EVID, 'narrow-430.png'), fullPage: true });
  await ctx2.close();

  // ------------------------------------------------- 关掉 JS 也要能读全表
  const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 1000 }, javaScriptEnabled: false });
  const page3 = await ctx3.newPage();
  await page3.goto(url, { waitUntil: 'load' });
  const nojs = await page3.evaluate(() => ({
    total: document.querySelectorAll('.sc').length,
    visible: document.querySelectorAll('.sc:not([hidden])').length,
    secs: document.querySelectorAll('.gsec:not([hidden])').length,
  }));
  check('④ 关掉 JS：63 条仍然全部可见（筛选失效但不丢内容）',
    nojs.total === 63 && nojs.visible === 63 && nojs.secs === 9,
    `${nojs.visible}/${nojs.total} 条，${nojs.secs} 组`);
  await ctx3.close();
  await browser.close();

  // ---------------------------------------------------------------- 汇总
  const fail = results.filter(r => !r.ok).length;
  console.log(`\n—— 浏览器断言 ${results.length} 项：${results.length - fail} pass / ${fail} fail ——`);
  console.log('截图：');
  for (const f of fs.readdirSync(EVID).sort()) {
    const s = fs.statSync(path.join(EVID, f));
    console.log(`  ${f}  ${s.size} 字节`);
  }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('✗ 验收脚本异常：', e); process.exit(2); });
