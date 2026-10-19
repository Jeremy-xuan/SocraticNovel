const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const jobs = [
    ['file:///Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/mockups/stage-modern/reading-v2.html?state=long', '/tmp/avalon-recon/ours-reading.png'],
    ['file:///Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/mockups/stage-modern/reading-v2.html?state=ao', '/tmp/avalon-recon/ours-choice.png'],
    ['file:///Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/mockups/stage-modern/reading-v2.html?state=a', '/tmp/avalon-recon/ours-card.png'],
  ];
  for (const [url, out] of jobs) {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: out });
    console.log('shot', out);
  }
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
