const { chromium } = require('playwright');
(async () => {
  const [url, text, shot] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0,150)));
  await p.goto(url, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(9000);
  await p.evaluate(t => { const ta=document.querySelector('.stage-warm-root .composer textarea');
    const S=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
    S.call(ta,t); ta.dispatchEvent(new Event('input',{bubbles:true})); }, text);
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('.stage-warm-root .composer button.send').click());
  const t0 = Date.now(); let hit = null;
  for (let i = 0; i < 60; i++) {                 // 最多 60×5s = 300s
    await p.waitForTimeout(5000);
    const s = await p.evaluate(() => {
      const r = document.querySelector('.stage-warm-root');
      return { run: r.getAttribute('data-running'),
        cur: Array.from(r.querySelectorAll('.line.sans.cur')).map(e=>e.innerText.slice(0,200)),
        n: r.querySelectorAll('.line').length };
    });
    if (s.cur.length) { hit = { sec: Math.round((Date.now()-t0)/1000), s }; break; }
    if (i % 6 === 5) console.log('  … ' + Math.round((Date.now()-t0)/1000) + 's  lines=' + s.n + ' running=' + s.run);
  }
  await p.screenshot({ path: shot });
  console.log(JSON.stringify({ hit, errs }, null, 1));
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
