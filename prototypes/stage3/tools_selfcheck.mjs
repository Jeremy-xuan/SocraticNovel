#!/usr/bin/env node
/* ============================================================================
 * STAGE-3 · 静态自检（零依赖，只用 Node 内置模块，随时可跑）
 * ----------------------------------------------------------------------------
 *   node prototypes/stage3/tools_selfcheck.mjs
 *
 * 它查的是「安全骨架」这条纪律本身，不需要浏览器：
 *   ① 白名单：本目录只允许出现约定文件；不得出现 assets/ shots/ probe/
 *      tools_measure.py 等含第三方素材或其衍生图的东西
 *   ② 三个形态页：引用的本地文件都存在；没有 <img src> 写死第三方素材
 *   ③ 页面里不得出现任何第三方素材路径（assets/scene|cast、.jpg/.png 等）
 *   ④ index.html 不得引用 shots/（那目录不在本批次里）；12 屏用活 iframe
 *   ⑤ stage3.assets.js 是唯一素材配置点：mode/slots 齐、默认 placeholder
 *   ⑥ 截图脚本：路径必须相对脚本自身解析（不许写死绝对路径 / 不许覆盖被测 CSS）
 *
 * 退出码：0 = 全绿；1 = 有失败项。
 * ==========================================================================*/
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REL = (p) => relative(process.cwd(), p) || '.';

let failures = 0, checks = 0;
const ok = (m) => { checks++; console.log('  ✓ ' + m); };
const bad = (m) => { checks++; failures++; console.log('  ✗ ' + m); };
const head = (m) => console.log('\n' + m);

const read = (f) => readFileSync(join(HERE, f), 'utf8');

/* ---------- ① 白名单与禁止物 ---------- */
head('① 白名单 / 禁止物');

const ALLOWED_FILES = new Set([
  'index.html', 'a-nightread.html', 'b-podium.html', 'c-library.html',
  'stage3.css', 'stage3.js', 'stage3.assets.js',
  'tools_shots.cjs', 'tools_selfcheck.mjs', 'README.md', '.gitignore'
]);
const ALLOWED_DIRS = new Set(['shots']);   /* 截图输出目录，运行期生成（已被 .gitignore 忽略） */

const entries = readdirSync(HERE, { withFileTypes: true });
const unexpected = [];
for (const e of entries) {
  if (e.name === '.DS_Store') { unexpected.push(e.name + '（系统垃圾文件）'); continue; }
  if (e.isDirectory()) {
    if (!ALLOWED_DIRS.has(e.name)) unexpected.push(e.name + '/（目录不在白名单）');
  } else if (!ALLOWED_FILES.has(e.name)) {
    unexpected.push(e.name + '（文件不在白名单）');
  }
}
unexpected.length
  ? bad('本目录出现白名单外的条目：' + unexpected.join('、'))
  : ok('目录条目全部在白名单内（' + entries.filter(e => !e.isDirectory()).length + ' 个文件 + ' +
       entries.filter(e => e.isDirectory()).length + ' 个目录）');

/* 运行期产物必须被本目录自己的 .gitignore 忽略（shots/ 有 12 张约 7MB PNG） */
const GI = join(HERE, '.gitignore');
if (!existsSync(GI)) {
  bad('缺本目录 .gitignore（shots/ 运行期产物会进版本库）');
} else {
  const rules = readFileSync(GI, 'utf8').split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  rules.includes('shots/')
    ? ok('本目录 .gitignore 已忽略 shots/（运行期产物不入库）')
    : bad('本目录 .gitignore 没有忽略 shots/，实得规则：' + rules.join('、'));
}

for (const forbidden of ['assets', 'probe', 'tools_measure.py']) {
  existsSync(join(HERE, forbidden))
    ? bad('出现禁止物：' + forbidden)
    : ok('无禁止物：' + forbidden);
}

/* shots/ 只允许装本脚本自己产的 PNG（运行期），不允许出现第三方素材命名 */
if (existsSync(join(HERE, 'shots'))) {
  const shots = readdirSync(join(HERE, 'shots'));
  const weird = shots.filter(f => !/^[abc]-[a-z]+__(open|board|choice|cast)\.png$/.test(f));
  weird.length
    ? bad('shots/ 里有非本脚本命名的文件：' + weird.join('、'))
    : ok('shots/ 内 ' + shots.length + ' 个文件全部是本脚本产出的 12 屏命名');
} else {
  ok('shots/ 不存在（尚未跑过截图脚本，属正常）');
}

/* ---------- ②③ 三个形态页 ---------- */
head('②③ 三个形态页');

const PAGES = ['a-nightread.html', 'b-podium.html', 'c-library.html'];
const THIRD_PARTY_RE = /(assets\/(scene|cast)|\.(jpg|jpeg|png|webp|gif)\b)/i;

for (const f of PAGES) {
  if (!existsSync(join(HERE, f))) { bad('缺文件：' + f); continue; }
  const html = read(f);

  /* 引用的本地文件必须存在 */
  const refs = [...html.matchAll(/(?:src|href)="([^"#?:]+)"/g)].map(m => m[1])
    .filter(u => !/^(https?:)?\/\//.test(u));
  const missingRefs = refs.filter(u => !existsSync(join(HERE, u)));
  missingRefs.length
    ? bad(`${f} 引用了不存在的文件：${missingRefs.join('、')}`)
    : ok(`${f} 引用的 ${refs.length} 个本地文件都存在（${refs.join('、')}）`);

  /* 不许写死第三方素材 */
  const hits = [...html.matchAll(new RegExp(THIRD_PARTY_RE.source, 'gi'))].map(m => m[0]);
  hits.length
    ? bad(`${f} 里出现第三方素材引用：${[...new Set(hits)].join('、')}`)
    : ok(`${f} 无第三方素材引用（场景/立绘由 JS 注入）`);

  /* 素材配置点必须按顺序先于 stage3.js 加载 */
  const iCfg = html.indexOf('src="stage3.assets.js"');
  const iJs = html.indexOf('src="stage3.js"');
  (iCfg >= 0 && iJs >= 0 && iCfg < iJs)
    ? ok(`${f} 加载顺序正确：stage3.assets.js → stage3.js`)
    : bad(`${f} 必须按 stage3.assets.js → stage3.js 的顺序加载（实得 cfg@${iCfg} js@${iJs}）`);

  /* 4 个 <img>（1 场景 + 3 立绘），且都不写死 src */
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
  const withSrc = imgs.filter(t => /\bsrc\s*=/.test(t));
  imgs.length === 4
    ? ok(`${f} 有 4 个 <img>（1 场景 + 3 立绘）`)
    : bad(`${f} 的 <img> 数为 ${imgs.length}，预期 4`);
  withSrc.length === 0
    ? ok(`${f} 的 <img> 都没有写死 src（由 JS 注入占位/外挂）`)
    : bad(`${f} 有 ${withSrc.length} 个 <img> 写死了 src：${withSrc.join(' ')}`);
}

/* ---------- ④ index.html ---------- */
head('④ index.html');

if (!existsSync(join(HERE, 'index.html'))) {
  bad('缺 index.html');
} else {
  const idx = read('index.html');
  /* 只判「真的去取 shots/ 里的文件」，不判正文里提到这个词（正文说明"不需要 shots/"是合法的） */
  const shotsRefs = [...idx.matchAll(/(?:src|href)\s*=\s*"(shots\/[^"]+)"/g)].map(m => m[1]);
  shotsRefs.length
    ? bad('index.html 用 src/href 引用了 shots/ 下的文件：' + shotsRefs.join('、'))
    : ok('index.html 不用 src/href 引用 shots/（12 屏走活 iframe）');
  const hits = [...idx.matchAll(new RegExp(THIRD_PARTY_RE.source, 'gi'))].map(m => m[0]);
  hits.length
    ? bad('index.html 出现第三方素材引用：' + [...new Set(hits)].join('、'))
    : ok('index.html 无第三方素材引用');
  const iframes = [...idx.matchAll(/<iframe\b[^>]*src="([^"]+)"/g)].map(m => m[1]);
  const expect = PAGES.length * 4;
  iframes.length === expect
    ? ok(`index.html 有 ${expect} 个活 iframe（3 方向 × 4 屏）`)
    : bad(`index.html 的 iframe 数为 ${iframes.length}，预期 ${expect}`);
  const dangling = iframes.filter(u => !existsSync(join(HERE, u.split('?')[0])));
  dangling.length
    ? bad('index.html 的 iframe 指向不存在的页面：' + dangling.join('、'))
    : ok('index.html 的 iframe 目标页面全部存在');
  const scenes = new Set(iframes.map(u => (u.split('scene=')[1] || '').split('&')[0]));
  ['open', 'board', 'choice', 'cast'].every(s => scenes.has(s))
    ? ok('index.html 覆盖全部四屏：' + [...scenes].sort().join('、'))
    : bad('index.html 未覆盖全部四屏，实得：' + [...scenes].join('、'));
}

/* ---------- ⑤ 素材配置点 ---------- */
head('⑤ stage3.assets.js（唯一素材配置点）');

const CFG_FILE = 'stage3.assets.js';
if (!existsSync(join(HERE, CFG_FILE))) {
  bad('缺 ' + CFG_FILE);
} else {
  const cfg = read(CFG_FILE);
  /window\.STAGE3_ASSETS_CONFIG\s*=/.test(cfg)
    ? ok('暴露 window.STAGE3_ASSETS_CONFIG')
    : bad('没有 window.STAGE3_ASSETS_CONFIG');
  const modeM = cfg.match(/mode\s*:\s*'([a-z]+)'/);
  modeM && modeM[1] === 'placeholder'
    ? ok("默认 mode = 'placeholder'（零第三方素材，自包含）")
    : bad("默认 mode 必须是 'placeholder'，实得 " + (modeM ? modeM[1] : '未找到'));
  const slots = ['scene_night', 'scene_evening', 'cast_a', 'cast_b', 'cast_c'];
  const missingSlots = slots.filter(s => !new RegExp(s + "\\s*:\\s*'").test(cfg));
  missingSlots.length
    ? bad('slots 缺槽位：' + missingSlots.join('、'))
    : ok('slots 含全部 ' + slots.length + ' 个槽位');
  /* 只看真正生效的赋值行（去掉注释行，注释里举例不算填了素材） */
  const codeLines = cfg.split('\n').filter(l => !/^\s*(\/\*|\*|\/\/)/.test(l));
  const filled = slots.filter(s => codeLines.some(l => new RegExp(s + "\\s*:\\s*'[^']+'").test(l)));
  filled.length === 0
    ? ok('slots 全部留空（默认不带任何素材）')
    : bad('slots 默认不该填素材路径，实得非空：' + filled.join('、'));
}

/* ---------- ⑥ 截图脚本纪律 ---------- */
head('⑥ tools_shots.cjs / stage3.js 纪律');

const SHOTS_JS = 'tools_shots.cjs';
if (!existsSync(join(HERE, SHOTS_JS))) {
  bad('缺 ' + SHOTS_JS);
} else {
  const s = read(SHOTS_JS);
  /__dirname/.test(s)
    ? ok('路径相对脚本自身解析（__dirname），与当前工作目录无关')
    : bad('未使用 __dirname，路径可能依赖当前工作目录');
  const abs = [...s.matchAll(/['"]\/(?:Users|home|tmp)\//g)].map(m => m[0]);
  abs.length
    ? bad('出现写死的绝对路径：' + [...new Set(abs)].join('、'))
    : ok('无写死的绝对路径');
  /stage3\.css/.test(s) && /writeFileSync|appendFileSync|copyFileSync/.test(s)
    ? bad('截图脚本里同时出现 stage3.css 与写文件操作，可能覆盖被测样式')
    : ok('截图脚本不写被测样式（只读 HTML/CSS/JS，只写 shots/*.png）');
  /--no-shots/.test(s)
    ? ok('支持 --no-shots（只断言不落图）')
    : bad('缺少 --no-shots 开关');
  /assets-base/.test(s)
    ? ok('支持 --assets-base（外挂模式验收）')
    : bad('缺少 --assets-base 开关');
  /ASSETS_BASE \? 'external' : 'placeholder'/.test(s)
    ? ok('--assets-base 会自动切到外挂模式（不会成为静默失效的开关）')
    : bad('--assets-base 没有自动切模式，可能静默失效');
  /--expect-missing/.test(s)
    ? ok('外挂模式必须显式声明素材是否存在（--expect-missing）')
    : bad('缺少 --expect-missing，外挂模式的预期会含糊');
  /* 外挂失败断言必须按「我方 [stage3] 报错条数」判，不能把 Chrome 自带的
     `Failed to load resource` 条数当契约（那是浏览器实现细节，会随版本变） */
  const hasOwn = /const own\s*=\s*logs\.filter/.test(s);
  const ownUsed = /if \(own !== EXPECT_PER_SCENE\)/.test(s);
  const usesRawErrLines = /if \(errLines\.length !== EXPECT_PER_SCENE\)/.test(s);
  (hasOwn && ownUsed && !usesRawErrLines)
    ? ok('外挂失败断言按「我方 [stage3] 报错条数」判，不把 Chrome 自己的条数当契约')
    : bad('外挂失败断言没有区分我方报错与 Chrome 自带报错（own=' + hasOwn + ' used=' + ownUsed + ' raw=' + usesRawErrLines + '）');
}

const JS = 'stage3.js';
if (!existsSync(join(HERE, JS))) {
  bad('缺 ' + JS);
} else {
  const s = read(JS);
  /data:image\/svg\+xml/.test(s)
    ? ok('stage3.js 生成内联 SVG 占位（data: URI）')
    : bad('stage3.js 没有内联 SVG 占位生成');
  /console\.error/.test(s)
    ? ok('素材加载失败会显式 console.error（不静默忽略）')
    : bad('素材加载失败没有显式报错通道');
  /asset-missing/.test(s)
    ? ok('素材加载失败会挂「素材缺失」角标（肉眼可见）')
    : bad('素材加载失败没有可见角标');
  const hard = [...s.matchAll(/(?:src|href)\s*=\s*['"]([^'"]*\.(?:jpg|jpeg|png|webp|gif))['"]/gi)]
    .map(m => m[1]);
  hard.length
    ? bad('stage3.js 里写死了图片路径：' + [...new Set(hard)].join('、'))
    : ok('stage3.js 里没有写死的图片路径');
}

/* ---------- 结果 ---------- */
head('结果');
console.log(`  检查项 ${checks}，失败 ${failures}`);
console.log(failures === 0 ? '  → 静态自检通过' : '  → 静态自检未通过');
process.exit(failures ? 1 : 0);
