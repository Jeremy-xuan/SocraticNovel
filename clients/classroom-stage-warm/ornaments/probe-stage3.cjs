// 探针 v3：在 stage 实例里真发一句话，等老师回复（真模型端到端）
// 用法：node probe-stage3.cjs <url> <out.png> ["要发的话"]
const { chromium } = require('playwright');

const URL = process.argv[2];
const OUT = process.argv[3] || '/tmp/stage-e2e.png';
const MSG = process.argv[4] || '老师好，我想学操作系统第一讲。';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)));

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // 等舞台出现
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(5000);
    if (await page.evaluate(() => !!document.querySelector('#stage-warm-root'))) break;
  }
  // 关欢迎弹窗
  for (const label of ['开始使用', '开始']) {
    try {
      const el = page.getByText(label, { exact: true }).first();
      if (await el.count()) { await el.click({ timeout: 3000 }); await page.waitForTimeout(1500); break; }
    } catch (e) { /* ignore */ }
  }
  await page.waitForTimeout(1500);

  const before = await page.evaluate(() => document.body.innerText.length);
  console.log('发送前文本长度', before);

  // 填输入框并送出
  const ta = page.locator('.composer textarea').first();
  try { await ta.click({ timeout: 8000 }); } catch (e) { console.log('click 失败，改 force fill'); }
  await ta.fill(MSG, { force: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT.replace('.png', '-before.png') });

  let sent = false;
  try {
    await page.getByText('送出', { exact: true }).first().click({ timeout: 6000, force: true });
    sent = true;
  } catch (e) {
    await ta.press('Enter').catch(() => {});
    sent = 'enter';
  }
  console.log('发送方式:', sent);

  // 轮询等回复
  const timeline = [];
  let lastLen = before;
  for (let i = 0; i < 42; i++) {
    await page.waitForTimeout(5000);
    const st = await page.evaluate(() => ({
      len: document.body.innerText.length,
      lines: document.querySelectorAll('.line').length,
      oc: document.querySelectorAll('.oc').length,
      running: /停止生成|Stop/.test(document.body.innerText),
      tail: (document.querySelector('.band-core') || {}).innerText ? (document.querySelector('.band-core').innerText || '').slice(-160).replace(/\n+/g, ' | ') : '',
    }));
    timeline.push(`${(i + 1) * 5}s len=${st.len} lines=${st.lines} oc=${st.oc} running=${st.running} :: ${st.tail}`);
    // 判据：出现「老师的句子」——band-core 里除「你：」以外的正文，且长度明显增长
    const hasTeacher = st.tail && !/^你：/.test(st.tail) && st.tail.length > 12;
    if (hasTeacher && st.lines >= 2) break;
    lastLen = Math.max(lastLen, st.len);
  }
  console.log('TIMELINE:\n' + timeline.join('\n'));

  await page.screenshot({ path: OUT });
  const fin = await page.evaluate(() => {
    const bc = document.querySelector('.band-core');
    return {
      lines: document.querySelectorAll('.line').length,
      oc: document.querySelectorAll('.oc').length,
      bandText: bc ? (bc.innerText || '').slice(0, 800) : '',
      bodySnippet: (document.body.innerText || '').slice(0, 300),
    };
  });
  console.log(JSON.stringify({ ...fin, consoleErrors: errs.slice(0, 6) }, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 300)); process.exit(1); });
