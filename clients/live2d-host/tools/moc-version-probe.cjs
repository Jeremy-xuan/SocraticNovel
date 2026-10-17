/**
 * moc-version-probe.cjs —— 「框架 commit ＋ Core 版本」这一对到底吃不吃这个 .moc3 的取证
 *
 * 为什么要单独做：项目踩过一次版本坑 —— 直链下的 Core 5.1.0 与 R5 框架不兼容，
 * 崩在 `csmGetMocVersion`。此后「这个模型能不能被我们这套载入」不能靠"扩展名是 .moc3"就下结论，
 * 必须真的让**本目录这套 Core**去读它，并报出**它自己认出来的 moc 版本号**。
 *
 * 本脚本报四样东西（全部来自 Core 自身，不是我们读字节猜的）：
 *   ① 文件头前 5 字节（magic ＋ 版本字节）—— 原始事实
 *   ② `csmGetMocVersion(buffer)` —— Core 认出来的 moc 版本枚举
 *   ③ `csmGetLatestMocVersion()` —— 本 Core 支持的最高版本（判断"吃不吃得下"的上界）
 *   ④ `hasMocConsistency(buffer)` —— Core 自己的完整性校验
 *
 * 用法（项目根）：node $HOST/tools/moc-version-probe.cjs [模型名 …]
 *   --host=<path> 覆盖产出目录；不给模型名 = out/models 下全部
 * 产出：evidence/moc_version_probe.json（＋ stdout 表格）
 */

const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { createReadStream, existsSync, statSync, writeFileSync, readFileSync, readdirSync } = require('node:fs');
const { extname, join, normalize } = require('node:path');

const { hostDir, positional } = require('./_common.cjs');
const HOST_DIR = hostDir();
const OUT_DIR = join(HOST_DIR, 'out');
const EVID = join(HOST_DIR, 'evidence');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.moc3': 'application/octet-stream'
};

function startServer(rootDir) {
  return new Promise((res) => {
    const server = createServer((req, resp) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      if (rel === '/' || rel === '\\') rel = '/demo.html';
      const abs = join(rootDir, rel);
      if (!abs.startsWith(rootDir) || !existsSync(abs) || !statSync(abs).isFile()) { resp.writeHead(404).end('404'); return; }
      resp.writeHead(200, { 'content-type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream' });
      createReadStream(abs).pipe(resp);
    });
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

// 官方 Core 的 MocVersion 枚举（逐字取自 vendor/Core/live2dcubismcore.js 的导出）
const MOC_VERSION_NAMES = {
  0: 'MocVersion_Unknown',
  1: 'MocVersion_30',
  2: 'MocVersion_33',
  3: 'MocVersion_40',
  4: 'MocVersion_42',
  5: 'MocVersion_50',
  6: 'MocVersion_53'
};

const ALL = readdirSync(join(OUT_DIR, 'models'))
  .filter((d) => existsSync(join(OUT_DIR, 'models', d, `${d}.model3.json`)))
  .sort();
const WANT = positional();
const MODELS = WANT.length > 0 ? WANT : ALL;

(async () => {
  const { server, port } = await startServer(OUT_DIR);
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
  });
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // demo.html 已把官方 Core 作为全局加载（<script src="./live2dcubismcore.min.js">）
  await page.goto(`http://127.0.0.1:${port}/demo.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.Live2DCubismCore !== 'undefined', null, { timeout: 30000 });

  const core = await page.evaluate(() => ({
    version: window.Live2DCubismCore.Version.csmGetVersion(),
    latestMocVersion: window.Live2DCubismCore.Version.csmGetLatestMocVersion()
  }));

  const results = [];
  for (const model of MODELS) {
    // 🔴 moc 文件名**不一定等于模型名**：试装件 Teacher 就是「目录改名、json 里的引用没改」
    //    （Teacher.model3.json 的 FileReferences.Moc 仍是 Hiyori.moc3）。
    //    所以必须按 model3.json 的引用取，不能拼 `<模型名>.moc3`。
    const m3 = JSON.parse(readFileSync(join(OUT_DIR, 'models', model, `${model}.model3.json`), 'utf8'));
    const mocRel = m3.FileReferences.Moc;
    const url = `/models/${model}/${mocRel}`;
    const r = await page.evaluate(async (u) => {
      const buf = await (await fetch(u)).arrayBuffer();
      const head = Array.from(new Uint8Array(buf.slice(0, 5)));
      const C = window.Live2DCubismCore;
      const out = { bytes: buf.byteLength, headHex: head.map((b) => b.toString(16).padStart(2, '0')).join(' '), magic: String.fromCharCode(...head.slice(0, 4)), headVersionByte: head[4] };
      try {
        out.coreMocVersion = C.Version.csmGetMocVersion(buf);
      } catch (e) {
        out.getMocVersionError = String(e && e.message ? e.message : e);
      }
      try {
        out.hasMocConsistency = C.Moc.prototype.hasMocConsistency(buf);
      } catch (e) {
        out.consistencyError = String(e && e.message ? e.message : e);
      }
      try {
        out.mocFromArrayBufferOk = C.Moc.fromArrayBuffer(buf) !== null;
      } catch (e) {
        out.mocFromArrayBufferError = String(e && e.message ? e.message : e);
      }
      return out;
    }, url);
    r.model = model;
    r.mocFile = mocRel;
    r.coreMocVersionName = MOC_VERSION_NAMES[r.coreMocVersion] || null;
    r.loadable = r.coreMocVersion > 0 && r.coreMocVersion <= core.latestMocVersion;
    results.push(r);
  }

  const out = {
    host: HOST_DIR,
    core: { ...core, coreVersionHex: '0x' + core.version.toString(16).padStart(8, '0'), latestMocVersionName: MOC_VERSION_NAMES[core.latestMocVersion] || null },
    frameworkCommit: 'd4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b',
    models: results,
    pageErrors,
    note: 'coreMocVersion / hasMocConsistency / mocFromArrayBufferOk 三列全部来自官方 Core 自身；headVersionByte 是文件头原始字节，只作对照。'
  };
  writeFileSync(join(EVID, 'moc_version_probe.json'), JSON.stringify(out, null, 2));

  console.log(`Core csmGetVersion() = ${core.version} (${out.core.coreVersionHex})  支持的最高 moc 版本 = ${core.latestMocVersion} (${out.core.latestMocVersionName})`);
  console.log('模型'.padEnd(20), '头版本'.padEnd(8), 'Core 认作'.padEnd(22), '一致'.padEnd(6), '可载入'.padEnd(8), 'moc 大小');
  for (const r of results) {
    console.log(
      String(r.model).padEnd(20),
      String(r.headVersionByte).padEnd(8),
      String(`${r.coreMocVersion} ${r.coreMocVersionName || ''}`).padEnd(22),
      String(r.hasMocConsistency).padEnd(6),
      String(r.loadable).padEnd(8),
      `${r.bytes} B`
    );
  }
  if (pageErrors.length > 0) console.log('页面报错：', pageErrors);
  console.log(`→ evidence/moc_version_probe.json`);

  await browser.close();
  server.close();
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
