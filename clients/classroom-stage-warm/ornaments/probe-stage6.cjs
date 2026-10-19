// 探针 v6：连上多轮（点选项推进），判据用「行数增长 + 选项更新」，不用 oc>0
// 用法：node probe-stage6.cjs <url> [prefix] [rounds]
const { chromium } = require('playwright');

const URL = process.argv[2];
const PREFIX = process.argv[3] || '/tmp/stage6';
const ROUNDS = Number(process.argv[4] || 3);

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 120)));

  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(13000);
  for (const l of ['开始使用', '知道了', 'Continue']) {
    try { const e = p.getByText(l, { exact: true }).first(); if (await e.count()) { await e.click({ timeout: 2500 }); await p.waitForTimeout(900); } } catch {}
  }

  // 选一条已有会话
  await p.keyboard.press('Control+Shift+M');
  await p.waitForTimeout(1200);
  for (const l of ['操作系统第一讲', '操作系统']) {
    try { const loc = p.getByText(l, { exact: false }); if (await loc.count()) { await loc.first().click({ timeout: 3000 }); break; } } catch {}
  }
  await p.waitForTimeout(2500);
  await p.keyboard.press('Control+Shift+U');
  await p.waitForTimeout(3500);

  const state = () => p.evaluate(() => ({
    lines: [...document.querySelectorAll('.line')].map((e) => e.textContent.trim()),
    oc: [...document.querySelectorAll('.oc')].map((e) => e.innerText.replace(/\n/g, ' ').trim()),
    sent: document.querySelectorAll('.oc.picked.sent').length,
  }));

  let prevLines = (await state()).lines.length;
  console.log('起始行数:', prevLines);

  for (let round = 1; round <= ROUNDS; round++) {
    const st = await state();
    if (round === 1 && st.oc.length === 0) {
      // 第一轮：主动发一句
      const ta = p.locator('.composer textarea').first();
      try { await ta.click({ timeout: 6000 }); } catch {}
      await ta.fill('我想弄明白，进程切换的时候到底什么必须被保存下来？', { force: true });
      await p.waitForTimeout(400);
      await ta.press('Enter');
      console.log(`\n== 第 ${round} 轮：发了开场问题`);
    } else {
      if (st.oc.length === 0) { console.log(`\n== 第 ${round} 轮：没有选项可点，停`); break; }
      const first = p.locator('.oc').first();
      await first.click({ force: true, timeout: 8000 }).catch(() => {});
      console.log(`\n== 第 ${round} 轮：点了「${st.oc[0].slice(0, 24)}…」`);
    }

    // 等「行数增长」或「选项换新」
    const before = (await state()).lines.length;
    let advanced = false;
    for (let i = 0; i < 40; i++) {
      await p.waitForTimeout(5000);
      const s = await state();
      if (s.lines.length > before) {
        // 行数涨了 = 有新消息进来；再看是否出选项（可能还在生成）
        if (s.oc.length > 0) { advanced = true; break; }
        if (i > 12) { advanced = true; break; }   // 60s 后即使没选项也算推进了
      }
    }
    const fin = await state();
    console.log(`   -> 行数 ${fin.lines.length}｜选项 ${fin.oc.length}｜已送出 ${fin.sent}`);
    if (fin.oc.length) fin.oc.forEach((t, i) => console.log(`      选项${i + 1}: ${t.slice(0, 40)}`));
    await p.screenshot({ path: `${PREFIX}-r${round}.png` });
    if (!advanced) { console.log(`第 ${round} 轮未推进，停`); break; }
  }

  await p.screenshot({ path: `${PREFIX}-final.png` });
  console.log('\n错误:', errs.slice(0, 3));
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 300)); process.exit(1); });
