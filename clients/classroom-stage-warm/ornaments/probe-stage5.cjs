// 探针 v5：连上 3 轮真对话（点选项推进），每轮截图并记录选项
// 用法：node probe-stage5.cjs <url> [outPrefix]
const { chromium } = require('playwright');

const URL = process.argv[2];
const PREFIX = process.argv[3] || '/tmp/stage5';
const ROUNDS = Number(process.argv[4] || 3);

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 140)));

  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(14000);

  // 关各种弹窗
  for (const l of ['开始使用', '知道了', 'Continue', '关闭']) {
    for (let k = 0; k < 2; k++) {
      try { const e = p.getByText(l, { exact: true }).first(); if (await e.count()) { await e.click({ timeout: 2200 }); await p.waitForTimeout(900); } else break; } catch { break; }
    }
  }

  // 选一条已有会话（关舞台后点侧栏）
  await p.keyboard.press('Control+Shift+M');
  await p.waitForTimeout(1200);
  for (const l of ['操作系统第一讲', '操作系统']) {
    try { const loc = p.getByText(l, { exact: false }); if (await loc.count()) { await loc.first().click({ timeout: 3000 }); break; } } catch {}
  }
  await p.waitForTimeout(2500);
  await p.keyboard.press('Control+Shift+U');
  await p.waitForTimeout(3500);

  const snap = async (tag) => {
    const s = await p.evaluate(() => ({
      lines: [...document.querySelectorAll('.line')].map((e) => e.textContent.trim()).slice(-3),
      oc: [...document.querySelectorAll('.oc')].map((e) => e.innerText.replace(/\n/g, ' ').trim()),
      band: (document.querySelector('.band-core') || {}).innerText ? (document.querySelector('.band-core').innerText || '').slice(-140).replace(/\n+/g, ' | ') : '',
    }));
    console.log(`[${tag}] lines=${s.lines.length} oc=${s.oc.length}`);
    if (s.oc.length) s.oc.forEach((t, i) => console.log(`   选项${i + 1}: ${t.slice(0, 50)}`));
    return s;
  };

  for (let round = 1; round <= ROUNDS; round++) {
    const ta = p.locator('.composer textarea').first();
    const msg = round === 1 ? '我想先弄明白，为什么同一时间只能有一个程序在用 CPU？' : null;

    if (msg) {
      try { await ta.click({ timeout: 6000 }); } catch {}
      await ta.fill(msg, { force: true });
      await p.waitForTimeout(400);
      await ta.press('Enter');
      console.log(`\n== 第 ${round} 轮：已发送开场问题`);
    } else {
      // 点第一个选项推进
      const opts = p.locator('.oc');
      const n = await opts.count();
      if (!n) { console.log(`\n== 第 ${round} 轮：没有选项可点，跳过`); break; }
      await opts.first().click({ force: true, timeout: 6000 });
      console.log(`\n== 第 ${round} 轮：点了第 1 个选项`);
    }

    // 等这一轮出结果（选项 或 老师新句）
    let done = false;
    for (let i = 0; i < 42; i++) {
      await p.waitForTimeout(5000);
      const s = await snap(`R${round}-${(i + 1) * 5}s`);
      if (s.oc.length > 0) { done = true; break; }
    }
    await p.screenshot({ path: `${PREFIX}-round${round}.png` });
    if (!done) console.log(`第 ${round} 轮：本轮结束没等到选项`);
  }

  await p.screenshot({ path: `${PREFIX}-final.png` });
  console.log('\n错误(前3):', errs.slice(0, 3));
  await b.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 300)); process.exit(1); });
