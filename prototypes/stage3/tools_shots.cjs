/* ============================================================================
 * STAGE-3 · 12 屏浏览器验收（截图 + 断言）
 * ----------------------------------------------------------------------------
 * 用法（在**仓库根**执行，脚本自己解析路径，与当前工作目录无关）：
 *
 *   node prototypes/stage3/tools_shots.cjs                  # 占位模式（默认）
 *   node prototypes/stage3/tools_shots.cjs --assets=placeholder
 *   node prototypes/stage3/tools_shots.cjs --assets-base=file:///tmp/x/   # 外挂模式
 *   node prototypes/stage3/tools_shots.cjs --no-shots       # 只断言不落 PNG
 *
 * 断言（12 屏逐屏，任一不满足即 exit 1）：
 *   ① console.error / pageerror / requestfailed 三条通道都必须是 0
 *   ② 每个 <img> 都有非空 src、naturalWidth>0、可见 —— 不允许破图
 *   ③ 占位模式下 src 必须是 data: URI（自包含）；外挂模式下必须与配置一致
 *   ④ 外挂模式下每个槽位都应加载失败 → 必须有「素材缺失」角标，且
 *      console.error 条数 == 槽位数（证明"不静默忽略"）
 *   ⑤ 明确打印当前模式（占位 / 外挂 + 基准目录）
 *
 * 🔴 本脚本**只读被测文件**，不写入、不覆盖 stage3.css / stage3.js / *.html。
 *    截图只落在 <本目录>/shots/。
 * 🔴 不新增依赖：playwright 从「本仓 node_modules」或「全局 npm root」解析；
 *    两处都没有则明确报阻塞（exit 2），不会静默跳过。
 * ==========================================================================*/
'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const HERE = __dirname;                       /* <仓库根>/prototypes/stage3 */
const REPO = path.resolve(HERE, '..', '..');  /* 仓库根 */
const SHOTS = path.join(HERE, 'shots');

/* ---------- CLI ---------- */
const argv = process.argv.slice(2);
const argOf = (n) => {
  const hit = argv.find(a => a.startsWith('--' + n + '='));
  return hit ? hit.slice(n.length + 3) : null;
};
const NO_SHOTS = argv.includes('--no-shots');
const ASSETS_BASE = argOf('assets-base') || '';
/* 给了 --assets-base 就等于要跑外挂模式（否则它会是个静默失效的开关） */
const ASSETS = argOf('assets') || (ASSETS_BASE ? 'external' : 'placeholder');
/* 外挂模式下必须显式声明素材到底存不存在，不许含糊 */
const EXPECT_MISSING = argv.includes('--expect-missing');
const SCREEN = argOf('screen') || '1920x1080';

/* ---------- 解析 playwright（零新依赖） ---------- */
function resolvePlaywright() {
  const tried = [];
  const cands = [];
  if (process.env.STAGE3_PLAYWRIGHT) cands.push(process.env.STAGE3_PLAYWRIGHT);
  cands.push(path.join(REPO, 'node_modules', 'playwright'));
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    if (root) cands.push(path.join(root, 'playwright'));
  } catch (e) { tried.push('npm root -g → ' + e.message); }
  for (const c of cands) {
    try { const m = require(c); tried.push(c + ' → OK'); return { mod: m, tried }; }
    catch (e) { tried.push(c + ' → ' + e.code); }
  }
  return { mod: null, tried };
}

const pw = resolvePlaywright();
if (!pw.mod) {
  console.log('=== STAGE-3 浏览器验收：无法进行（缺少 playwright）===');
  console.log('已尝试的解析路径：');
  pw.tried.forEach(t => console.log('  · ' + t));
  console.log('本仓根没有 node_modules/playwright，也没有可用的全局 playwright。');
  console.log('按纪律**不新增依赖**，故浏览器验收标记为【阻塞】；静态自检仍可跑：');
  console.log('  node prototypes/stage3/tools_selfcheck.mjs');
  process.exit(2);
}
const { chromium } = pw.mod;

/* ---------- 被测对象 ---------- */
const PAGES = [
  ['a-nightread', 'a-nightread.html'],
  ['b-podium', 'b-podium.html'],
  ['c-library', 'c-library.html']
];
const SCENES = ['open', 'board', 'choice', 'cast'];
/* 每屏实际绑定的槽位：1 个场景（open/choice/cast 用 scene_night，board 用 scene_evening）
   + 3 个立绘。 */
const BOUND_SLOTS_PER_SCENE = 4;
const [W, H] = SCREEN.split('x').map(Number);

const MODE = ASSETS === 'placeholder' ? 'placeholder' : 'external';
const EXPECT_PER_SCENE = BOUND_SLOTS_PER_SCENE;

function urlFor(file, scene) {
  const base = 'file://' + path.join(HERE, file) + '?scene=' + scene;
  return MODE === 'placeholder' ? base + '&assets=placeholder' : base + '&assets=' + ASSETS_BASE;
}

(async () => {
  console.log('=== STAGE-3 12 屏浏览器验收 ===');
  console.log('仓库根            : ' + REPO);
  console.log('被测目录          : ' + HERE);
  console.log('playwright 来源   : ' + pw.tried[pw.tried.length - 1].split(' → ')[0]);
  console.log('视口              : ' + W + '×' + H);
  console.log('★ 素材模式        : ' + (MODE === 'placeholder'
    ? '【占位模式】零第三方素材，场景与立绘为内联 SVG（data: URI），预期 0 个网络素材请求'
    : '【外挂模式】基准目录 = ' + ASSETS_BASE + '（未填槽位仍用占位）'));
  if (MODE === 'external') {
    console.log('★ 素材预期        : ' + (EXPECT_MISSING
      ? '【故意不存在】每槽位应有一条 requestfailed + 一条 [stage3] console.error + 一枚「素材缺失」角标'
      : '【应当存在】全部槽位走外挂、零报错、零角标'));
  }
  console.log('预期每屏槽位数    : ' + EXPECT_PER_SCENE);
  if (NO_SHOTS) console.log('截图              : 已关闭（--no-shots）');
  console.log('');

  if (!NO_SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

  let hardErrors = 0, total = 0, softWarnings = 0;
  const rows = [];

  for (const [name, file] of PAGES) {
    for (const scene of SCENES) {
      const page = await ctx.newPage();
      const logs = [];
      page.on('console', m => logs.push(`[console.${m.type()}] ${m.text()}`));
      page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
      page.on('requestfailed', r => logs.push(
        `[requestfailed] ${r.url()} :: ${r.failure() && r.failure().errorText}`));

      const url = urlFor(file, scene);
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(500);   /* 等图片解码 + 首帧动效落位 */

      const probe = await page.evaluate(() => {
        const s = window.__stage3 && window.__stage3.state;
        const imgs = Array.from(document.querySelectorAll('img')).map(e => ({
          src: e.getAttribute('src') || '',
          complete: e.complete,
          nw: e.naturalWidth, nh: e.naturalHeight,
          visible: !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length)
        }));
        return {
          mode: s ? s.mode : null,
          scene: s ? s.scene : null,
          assets: s ? s.assets.map(a => ({ slot: a.slot, url: a.url, used: a.used, fallback: a.fallback })) : [],
          imgs,
          missingBadges: Array.from(document.querySelectorAll('.asset-missing'))
            .map(b => b.textContent.trim()),
          dataAttr: document.documentElement.getAttribute('data-stage3-mode')
        };
      });

      const errLines = logs.filter(l => /\[console\.error\]|\[pageerror\]|\[requestfailed\]/.test(l));
      const warnLines = logs.filter(l => /\[console\.warning\]/.test(l));
      softWarnings += warnLines.length;

      const fails = [];
      if (probe.mode !== MODE) fails.push(`运行期模式=${probe.mode}，预期 ${MODE}`);
      if (probe.scene !== scene) fails.push(`运行期 scene=${probe.scene}，预期 ${scene}`);
      if (probe.dataAttr !== MODE) fails.push(`data-stage3-mode=${probe.dataAttr}，预期 ${MODE}`);
      if (probe.assets.length !== EXPECT_PER_SCENE) {
        fails.push(`槽位绑定 ${probe.assets.length} 个，预期 ${EXPECT_PER_SCENE}（${probe.assets.map(a => a.slot).join(',')}）`);
      }
      /* ② 不许破图（decode 失败 / 未解码）。注意 display:none 是**设计上隐藏**
         （C 方向第三位立绘本来就是隐藏的），它不产生破图，故不计入破图；
         但全部图片都不可见 = 屏幕是空的，仍判失败。 */
      const broken = probe.imgs.filter(i => !i.src || !i.complete || i.nw === 0 || i.nh === 0);
      if (broken.length) fails.push(`破图/未解码 ${broken.length} 个：${JSON.stringify(broken.map(i => i.src.slice(0, 60)))}`);
      const shown = probe.imgs.filter(i => i.visible);
      if (!shown.length) fails.push('所有 <img> 都不可见（屏幕是空的）');
      /* ③ 占位模式必须全 data: */
      if (MODE === 'placeholder') {
        const notData = probe.imgs.filter(i => !/^data:image\/svg\+xml/.test(i.src));
        if (notData.length) fails.push(`占位模式下有非 data: 的图片 ${notData.length} 个：${JSON.stringify(notData.map(i => i.src.slice(0, 60)))}`);
        const ext = probe.assets.filter(a => a.url);
        if (ext.length) fails.push(`占位模式下不应有外挂槽位：${JSON.stringify(ext)}`);
        if (probe.missingBadges.length) fails.push(`占位模式下不应有缺失角标：${JSON.stringify(probe.missingBadges)}`);
        if (errLines.length) fails.push(`占位模式必须零报错，实得 ${errLines.length} 条`);
      }
      /* ④ 外挂模式：分两种预期，必须显式声明，不许含糊
         · 默认（--assets-exist）：素材应当存在 → 全部走外挂、零报错、零角标
         · --expect-missing  ：素材故意不存在 → 每槽位一条 requestfailed + 一条
           我方 [stage3] console.error + 一枚「素材缺失」角标（证明不静默忽略）
         注意：Chrome 自己还会为同一张图补一条 `Failed to load resource`，
         所以这里分开计数，不把 Chrome 的条数当契约。 */
      if (MODE === 'external') {
        const fallback = probe.assets.filter(a => a.fallback);
        const reqFailed = logs.filter(l => /\[requestfailed\]/.test(l)).length;
        const own = logs.filter(l => /\[console\.error\] \[stage3\]/.test(l)).length;
        const pe = logs.filter(l => /\[pageerror\]/.test(l)).length;
        if (pe) fails.push(`pageerror ${pe} 条，预期 0`);

        if (EXPECT_MISSING) {
          if (fallback.length !== EXPECT_PER_SCENE) {
            fails.push(`退回占位的槽位 ${fallback.length} 个，预期 ${EXPECT_PER_SCENE}`);
          }
          if (probe.missingBadges.length !== EXPECT_PER_SCENE) {
            fails.push(`「素材缺失」角标 ${probe.missingBadges.length} 枚，预期 ${EXPECT_PER_SCENE}`);
          }
          if (reqFailed !== EXPECT_PER_SCENE) {
            fails.push(`requestfailed ${reqFailed} 条，预期 ${EXPECT_PER_SCENE}（每槽位一条）`);
          }
          if (own !== EXPECT_PER_SCENE) {
            fails.push(`我方 [stage3] console.error ${own} 条，预期 ${EXPECT_PER_SCENE}（每槽位一条，证明不静默忽略）`);
          }
        } else {
          const ext = probe.assets.filter(a => a.url && a.used === 'external');
          if (ext.length !== EXPECT_PER_SCENE) {
            fails.push(`真正用上外挂素材的槽位 ${ext.length} 个，预期 ${EXPECT_PER_SCENE}（${JSON.stringify(probe.assets)}）`);
          }
          const notFile = probe.imgs.filter(i => /^data:image\/svg\+xml/.test(i.src));
          if (notFile.length) {
            fails.push(`素材应当存在，却有 ${notFile.length} 个槽位仍是占位：${JSON.stringify(notFile.map(i => i.src.slice(0, 60)))}`);
          }
          if (probe.missingBadges.length) fails.push(`素材存在时不应有缺失角标：${JSON.stringify(probe.missingBadges)}`);
          if (errLines.length) fails.push(`素材存在时必须零报错，实得 ${errLines.length} 条：${errLines.slice(0, 4).join(' | ')}`);
        }
      }

      if (!NO_SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}__${scene}.png`) });
      total++;

      if (fails.length) {
        hardErrors += fails.length;
        console.log(`  ✗ ${name}/${scene}`);
        fails.forEach(f => console.log('      - ' + f));
        errLines.slice(0, 6).forEach(l => console.log('      ! ' + l));
      } else {
        console.log(`  ✓ ${name}/${scene}  img=${probe.imgs.length} 槽位=${probe.assets.length}` +
          ` 缺失角标=${probe.missingBadges.length} 报错=${errLines.length} 警告=${warnLines.length}`);
      }
      rows.push({ name, scene, mode: probe.mode, imgs: probe.imgs.length,
        slots: probe.assets.length, badges: probe.missingBadges.length,
        errors: errLines.length, warns: warnLines.length, fails: fails.length });
      await page.close();
    }
  }

  await browser.close();

  console.log('');
  console.log('--- 汇总 ---');
  console.log(`模式              : ${MODE}${MODE === 'external' ? '（基准 ' + ASSETS_BASE + '）' : ''}`);
  console.log(`屏数              : ${total}`);
  console.log(`console.warning   : ${softWarnings}（不计入失败）`);
  console.log(`失败断言          : ${hardErrors}`);
  if (!NO_SHOTS) console.log(`截图              : ${path.join(SHOTS, '<dir>__<scene>.png')}`);
  console.log(hardErrors === 0 ? '结论              : 全部通过' : '结论              : 有失败项，见上');
  process.exit(hardErrors ? 1 : 0);
})().catch(e => {
  console.error('[tools_shots] 未捕获异常：' + (e && e.stack || e));
  process.exit(1);
});
