/**
 * serve.mjs —— 极简静态文件服务（只为本地跑演示页/截图；不引入任何依赖）。
 *
 * 用法：
 *   node scripts/serve.mjs            # 默认 127.0.0.1:4320，根目录 = 产出目录/out
 *   node scripts/serve.mjs 5000       # 指定端口
 *
 * 为什么不用 file://：Chrome 对 file:// 下的 fetch() 一律拒绝，
 * 而模型装载必须 fetch model3.json / moc3 / 纹理 → 必须走 http。
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', 'out');
const PORT = Number(process.argv[2] || process.env.PORT || 4320);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.moc3': 'application/octet-stream',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8'
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  if (rel === '/' || rel === '\\') rel = '/demo.html';
  const abs = join(ROOT, rel);

  // 目录穿越保护
  if (!abs.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`404 ${rel}`);
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
    // 模型纹理要能当 Image 用；同源即可，无需 CORS
    'access-control-allow-origin': '*'
  });
  createReadStream(abs).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[serve] http://127.0.0.1:${PORT}/  (root=${ROOT})`);
});
