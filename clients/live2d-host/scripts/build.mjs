/**
 * build.mjs —— 把官方框架 + 我们的模块打成一个浏览器可直接 import 的 ESM bundle。
 *
 * 为什么需要打包：官方框架的 `src/` 内部全部是**无扩展名的相对 import**
 * （如 `import { CubismModel } from '../model/cubismmodel';`），
 * 浏览器原生 ESM 不接受无扩展名路径 → 必须打一次包。
 *
 * 打包器：esbuild（本地 vendored，见 vendor/node_modules），**不引入任何构建框架**。
 * 官方框架源码在打包时**一行不改**（只用 `--alias:@framework=` 把官方示例用的别名指回源码目录）。
 *
 * 用法：node scripts/build.mjs
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ESBUILD = join(ROOT, 'vendor', 'node_modules', '.bin', 'esbuild');
const FW = join(ROOT, 'vendor', 'CubismWebFramework');

if (!existsSync(ESBUILD)) {
  console.error(`找不到 esbuild：${ESBUILD}\n请先在 vendor/ 目录执行 npm install（见 报告 §依赖清单）`);
  process.exit(1);
}

const OUT = join(ROOT, 'out');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ① 官方 WebGL shader（drawModel 会在运行时按 shaderBaseUrl 去取）
const shaderSrc = join(FW, 'Shaders', 'WebGL');
const shaderDst = join(OUT, 'shaders', 'WebGL');
cpSync(shaderSrc, shaderDst, { recursive: true });
console.log(`[build] shaders: ${shaderSrc} → ${shaderDst}`);

// ② 框架 + 宿主 + 两个 provider 打成单文件 ESM
const entry = join(ROOT, 'src', 'index.js');
const outfile = join(OUT, 'live2d-host.bundle.mjs');
execFileSync(
  ESBUILD,
  [
    entry,
    '--bundle',
    '--format=esm',
    '--target=es2020',
    `--outfile=${outfile}`,
    `--alias:@framework=${join(FW, 'src')}`,
    '--log-level=warning',
    '--legal-comments=inline'
  ],
  { stdio: 'inherit' }
);
console.log(`[build] bundle: ${outfile}`);

// ③ 单独把 Core 复制到 out（页面与 bundle 都从 out/ 取资源，保持 out/ 自包含）
const coreSrc = join(ROOT, 'vendor', 'Core', 'live2dcubismcore.min.js');
cpSync(coreSrc, join(OUT, 'live2dcubismcore.min.js'));

// ④ 模型资源复制到 out/models（演示页面与截图脚本都从 out/ 起服务）
const samplesDst = join(OUT, 'models');
cpSync(join(ROOT, 'samples', 'Resources'), samplesDst, { recursive: true });
console.log(`[build] models: ${samplesDst}`);

// ⑤ 演示页面复制到 out/（out/ 自包含：起一个静态服务就能看）
cpSync(join(ROOT, 'demo', 'demo.html'), join(OUT, 'demo.html'));
console.log('[build] demo: out/demo.html');

writeFileSync(
  join(OUT, 'BUILD-INFO.txt'),
  [
    `built: ${new Date().toISOString()}`,
    `framework: Live2D/CubismWebFramework @ d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b`,
    `samples:   Live2D/CubismWebSamples   @ b1de66b0b1f1cb881d95fb6158622aeb6a2827bd`,
    `esbuild:   0.25.12`,
    ''
  ].join('\n')
);
console.log('[build] done');
