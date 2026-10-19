// C 机真机全流程：建会话 → 确认钩子 → 发一句 → 等老师回复
const { chromium } = require('playwright');
(async () => {
  const [url, text, shot] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(9000);
  const state = async () => p.evaluate(() => {
    const root = document.querySelector('.stage-warm-root');
    const q = s => root && root.querySelector(s);
    return {
      auth: /authentication required/i.test(document.body.innerText),
      native: !!document.querySelector('[role="textbox"][contenteditable="true"]'),
      empty: q('.empty') ? q('.empty').innerText.slice(0, 40) : null,
      hint: q('.composer .hint') ? q('.composer .hint').innerText : null,
      lines: root ? Array.from(root.querySelectorAll('.line')).map(e => e.className + '::' + e.innerText.slice(0, 120)) : [],
    };
  });
  let s = await state();
  if (s.auth) { console.log(JSON.stringify({ stage: 'AUTH-FAIL' })); await b.close(); return; }
  // 建会话（若还没有）
  if (!s.native) {
    await p.evaluate(() => {
      const e = [...document.querySelectorAll('button,a,[role=button]')]
        .find(x => /New Session|新对话|新建会话/i.test((x.innerText || x.getAttribute('aria-label') || '')));
      if (e) e.click();
    });
    await p.waitForTimeout(8000);
    s = await state();
  }
  const after = { native: s.native, empty: s.empty, hint: s.hint };
  if (!s.native) { console.log(JSON.stringify({ stage: 'NO-SESSION', after, errs }, null, 1)); await b.close(); return; }
  // 发一句
  await p.evaluate(t => {
    const ta = document.querySelector('.stage-warm-root .composer textarea');
    const S = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    S.call(ta, t); ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('.stage-warm-root .composer button.send').click());
  const t0 = Date.now(); let hit = null;
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(5000);
    const cur = await p.evaluate(() => Array.from(document.querySelectorAll('.stage-warm-root .line.cur')).map(e => e.innerText.slice(0, 200)));
    if (cur.length) { hit = { sec: Math.round((Date.now() - t0) / 1000), cur }; break; }
  }
  await p.screenshot({ path: shot });
  console.log(JSON.stringify({ stage: 'SENT', after, hit, final: (await state()).lines, errs }, null, 1));
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
