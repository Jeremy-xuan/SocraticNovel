/**
 * motion-parse-error-probe.cjs —— 「动作解析失败必须给出可读报错」的故障注入探针（零新增依赖）
 *
 * 为什么需要它：
 *   修前 `loadMotion()` 解析失败时，页面只抛一句**看不出是哪个文件**的 TypeError
 *   （`Cannot read properties of null (reading 'setEffectIds')`），而**坏 JSON 走的是另一条路**
 *   （官方 `CubismMotion.parse()` 内部抛 `... reading 'getRoot'`）。两条路都不可读。
 *   本探针**故意造坏输入**，把「报错真的出现且可读」变成可自动判定的。
 *
 * 做法：
 *   ① 在 `<host>/out/models/` 下现场生成两个坏模型（Haru 的副本，只坏一个动作文件）：
 *      · `__broken_empty__`  —— 该动作文件截成 **0 字节**（走 loadMotion() 返回 null 那条路）
 *      · `__broken_syntax__` —— 该动作文件写成**语法坏掉的 JSON**（走官方解析器抛错那条路）
 *   ② 逐个装载，收集三条通道（页面日志 `[load-error]`／pageerror／unhandledrejection）里的报错原文；
 *   ③ **负对照**：完好的 Haru 必须装载成功且**没有** `[load-error]`（证明本探针不是靠"什么都报错"过关）。
 *
 * 判据（每条都要）：
 *   · 两个坏模型都**报错**（不许静默）；
 *   · 报错原文里同时出现：**文件路径**、**动作组名**、**组内下标**、**原因**、以及"装载已中止"；
 *   · 负对照：完好模型零 `[load-error]`。
 *
 * 用法（工作区根）：
 *   node clients/live2d-host/tools/motion-parse-error-probe.cjs [选项]
 *
 * 选项：
 *   --host=DIR      宿主目录（默认脚本上一级；可用于对**修前的副本**跑同一探针做前后对照）
 *   --source=NAME   用作坏模型的底本（默认 Haru）
 *   --json=PATH     结果 JSON 落盘
 *   --quiet         不打印明细
 *
 * 退出码：0 = 全部成立；1 = 有判据不成立；2 = 环境/装载失败
 */

const { chromium } = require('playwright');
const { createServer } = require('node:http');
const {
  createReadStream, existsSync, statSync, writeFileSync, readFileSync,
  cpSync, rmSync, renameSync, mkdirSync
} = require('node:fs');
const { extname, join, normalize } = require('node:path');

const { hostDir } = require('./_common.cjs');

const HOST_DIR = hostDir();
const OUT_DIR = join(HOST_DIR, 'out');
const MODELS_DIR = join(OUT_DIR, 'models');

function argStr(name, dflt) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
}
const SOURCE = argStr('source', 'Haru');
const JSON_OUT = argStr('json', '');
const QUIET = process.argv.includes('--quiet');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.moc3': 'application/octet-stream',
  '.wav': 'audio/wav'
};

function startServer(rootDir) {
  return new Promise((res) => {
    const server = createServer((req, resp) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      if (rel === '/' || rel === '\\') rel = '/demo.html';
      const abs = join(rootDir, rel);
      if (!abs.startsWith(rootDir) || !existsSync(abs) || !statSync(abs).isFile()) {
        resp.writeHead(404).end('404');
        return;
      }
      resp.writeHead(200, {
        'content-type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      createReadStream(abs).pipe(resp);
    });
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

/**
 * 造一个坏模型：复制底本 → 改名 model3.json → 把**第一个动作文件**弄坏。
 * @returns {{group:string,index:number,file:string,url:string,bytes:number,how:string}}
 */
function makeBrokenModel(modelName, sourceName, how) {
  const srcDir = join(MODELS_DIR, sourceName);
  const dstDir = join(MODELS_DIR, modelName);
  rmSync(dstDir, { recursive: true, force: true });
  cpSync(srcDir, dstDir, { recursive: true });
  renameSync(join(dstDir, `${sourceName}.model3.json`), join(dstDir, `${modelName}.model3.json`));

  const m3 = JSON.parse(readFileSync(join(dstDir, `${modelName}.model3.json`), 'utf8'));
  const motions = m3.FileReferences.Motions;
  const group = Object.keys(motions)[0];
  const file = motions[group][0].File;
  const target = join(dstDir, file);
  if (how === 'empty') writeFileSync(target, Buffer.alloc(0));
  else writeFileSync(target, '{"Version":3,"Meta":{"Duration":1.0,"Fps":30,');
  return {
    group,
    index: 0,
    file,
    url: `models/${modelName}/${file}`,
    bytes: statSync(target).size,
    how
  };
}

/** 装载一个模型并收集报错原文（三条通道） */
async function tryLoad(browser, port, modelName, opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 1 });
  const errors = { pageerror: [], consoleError: [] };
  page.on('pageerror', (e) => errors.pageerror.push(String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.consoleError.push(m.text()); });
  await page.addInitScript(() => {
    window.__probeOnerrors = [];
    window.addEventListener('error', (e) => window.__probeOnerrors.push(String((e && e.message) || e)));
    window.addEventListener('unhandledrejection', (e) =>
      window.__probeOnerrors.push('unhandledrejection: ' + String((e && e.reason && e.reason.message) || e.reason))
    );
  });

  await page.goto(`http://127.0.0.1:${port}/demo.html?nomodel=1`, { waitUntil: 'load' });
  await page.evaluate((name) => {
    const sel = document.getElementById('model');
    sel.append(new Option(name, name));
    sel.value = name;
  }, modelName);
  await page.click('#load');

  // 等到「出错」或「装载成功」二者之一出现
  await page
    .waitForFunction(
      () => {
        const log = document.getElementById('log').textContent;
        return log.includes('[load-error]') || log.includes('[shaders] ready=true') || (window.__probeOnerrors || []).length > 0;
      },
      null,
      { timeout: 60000 }
    )
    .catch(() => {});
  await page.waitForTimeout(opts.settleMs ?? 1500);

  const log = await page.evaluate(() => document.getElementById('log').textContent);
  const windowErrors = await page.evaluate(() => window.__probeOnerrors || []);
  const loadErrorLines = log.split('\n').filter((l) => l.includes('[load-error]'));
  const loadedOk = log.includes('[shaders] ready=true');
  await page.close();
  return { modelName, loadedOk, loadErrorLines, windowErrors, ...errors, logTail: log.split('\n').slice(-6) };
}

const CASES = [
  {
    model: '__broken_empty__',
    how: 'empty',
    desc: '动作文件截成 0 字节（走 loadMotion() 返回 null 那条路）',
    expect: ['动作解析失败', '文件为空（0 字节）', '装载已中止']
  },
  {
    model: '__broken_syntax__',
    how: 'syntax',
    desc: '动作文件写成语法坏掉的 JSON（走官方解析器抛错那条路）',
    expect: ['动作解析失败', '官方解析器抛错', '装载已中止']
  }
];

(async () => {
  const result = {
    probe: 'motion-parse-error-probe',
    hostDir: HOST_DIR,
    source: SOURCE,
    at: new Date().toISOString(),
    fixtures: [],
    cases: [],
    control: null,
    errors: {}
  };
  let exitCode = 2;
  if (!existsSync(MODELS_DIR)) {
    console.error(`找不到 ${MODELS_DIR}（先跑 node scripts/build.mjs）`);
    process.exit(2);
  }
  const { server, port } = await startServer(OUT_DIR);
  let browser = null;
  try {
    // 造坏输入（在起服务之后做也行：静态服务每次请求都重新读盘）
    for (const c of CASES) result.fixtures.push({ model: c.model, ...makeBrokenModel(c.model, SOURCE, c.how) });

    browser = await chromium.launch({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
    });

    for (const c of CASES) {
      const fix = result.fixtures.find((f) => f.model === c.model);
      const r = await tryLoad(browser, port, c.model);
      const text = [...r.loadErrorLines, ...r.windowErrors, ...r.pageerror, ...r.consoleError].join('\n');
      const checks = {
        reported: text.length > 0,
        hasFilePath: text.includes(fix.file),
        hasGroup: text.includes(`动作组「${fix.group}」第 ${fix.index} 个`),
        hasReason: c.expect.every((s) => text.includes(s)),
        loadAborted: r.loadedOk === false
      };
      const pass = Object.values(checks).every(Boolean);
      result.cases.push({ ...c, fixture: fix, result: r, checks, pass });
    }

    // 负对照：完好的底本必须装载成功且没有 [load-error]
    const ctrl = await tryLoad(browser, port, SOURCE);
    result.control = {
      model: SOURCE,
      loadedOk: ctrl.loadedOk,
      loadErrorCount: ctrl.loadErrorLines.length,
      windowErrors: ctrl.windowErrors,
      pass: ctrl.loadedOk === true && ctrl.loadErrorLines.length === 0
    };

    result.pass = result.cases.every((c) => c.pass) && result.control.pass;
    exitCode = result.pass ? 0 : 1;
  } catch (e) {
    result.fatal = String((e && e.stack) || e);
    exitCode = 2;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
    // 🔴 坏模型必须清掉：tools/render-matrix.cjs 与 tools/moc-version-probe.cjs 都是
    //    「按 out/models/ 目录列举 + 找 <目录名>.model3.json」来发现模型的 —— 留着坏副本
    //    会被它们当成真模型捡走、把回归跑红。证据留在本次的 JSON/日志里，不留文件。
    for (const f of result.fixtures) {
      rmSync(join(MODELS_DIR, f.model), { recursive: true, force: true });
    }
    result.fixturesCleanedUp = result.fixtures.length > 0;
  }

  if (JSON_OUT) {
    mkdirSync(join(JSON_OUT, '..'), { recursive: true });
    writeFileSync(JSON_OUT, JSON.stringify(result, null, 2));
  }

  if (!QUIET) {
    console.log(`[motion-parse-error-probe] host=${HOST_DIR}`);
    if (result.fatal) console.log('  FATAL: ' + result.fatal);
    for (const c of result.cases) {
      console.log(`\n── ${c.model}：${c.desc} ──`);
      console.log(`  坏在哪：models/${c.model}/${c.fixture.file}（${c.fixture.bytes} 字节，动作组「${c.fixture.group}」第 ${c.fixture.index} 个）`);
      console.log(`  页面日志 [load-error]：${c.result.loadErrorLines.length} 条`);
      for (const l of c.result.loadErrorLines) console.log('    ' + l);
      for (const e of c.result.windowErrors) console.log('    window.onerror/unhandledrejection: ' + e);
      for (const e of c.result.pageerror) console.log('    pageerror: ' + e);
      for (const e of c.result.consoleError) console.log('    console.error: ' + e);
      console.log(`  判据：${JSON.stringify(c.checks)}  → pass=${c.pass}`);
    }
    console.log(`\n── 负对照（完好模型 ${SOURCE}）──`);
    console.log(`  装载成功=${result.control.loadedOk}  [load-error] 条数=${result.control.loadErrorCount}  → pass=${result.control.pass}`);
    console.log(`\n[motion-parse-error-probe] 总判：pass=${result.pass}`);
  }
  process.exit(exitCode);
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(2);
});
