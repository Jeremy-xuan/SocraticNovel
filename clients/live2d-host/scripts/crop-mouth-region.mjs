/**
 * crop-mouth-region.mjs —— 从嘴参数隔离截图里裁出嘴部区域并放大，便于目视复核
 *
 * 为什么单独做：整幅 720×720 里嘴只有 20×12 像素，缩略图里几乎看不出差别；
 * 裁出差异包围盒并放大后，闭/开两张的差别一眼可见。
 *
 * 用法（产出目录内）：node scripts/crop-mouth-region.mjs <模型名>
 * 依赖：macOS 自带 `sips`（把 PPM 转 PNG 并放大）
 * 产出：evidence/crop_<Model>_mouth_closed.png / crop_<模型名>_mouth_open.png
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const EVID = join(ROOT, 'evidence');
const MODEL = process.argv[2] || 'Haru';

function decodePNG(buf) {
  // sips 转出来的 PNG 里 IDAT 分片被 subarray 切成了 Uint8Array，统一包回 Buffer
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 8, width = 0, height = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const d = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = d.readUInt32BE(0); height = d.readUInt32BE(4); colorType = d[9]; }
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const ch = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev ? prev[x] : 0, c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
  }
  return { width, height, channels: ch, data: out };
}

/** 找两张图的差异包围盒，按 pad 外扩 */
function diffBBox(a, b, inset = 3, pad = 20) {
  const A = decodePNG(a), B = decodePNG(b);
  let minX = A.width, minY = A.height, maxX = -1, maxY = -1, changed = 0;
  for (let y = inset; y < A.height - inset; y++) for (let x = inset; x < A.width - inset; x++) {
    const ia = (y * A.width + x) * A.channels, ib = (y * B.width + x) * B.channels;
    let d = 0;
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(A.data[ia + k] - B.data[ib + k]));
    if (d > 8) {
      changed++;
      if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { changed: 0, bbox: null };
  return {
    changed,
    bbox: {
      x0: Math.max(0, minX - pad), y0: Math.max(0, minY - pad),
      x1: Math.min(A.width - 1, maxX + pad), y1: Math.min(A.height - 1, maxY + pad)
    }
  };
}

function writeCroppedPPM(src, box, outPpm) {
  const s = decodePNG(readFileSync(src));
  const cw = box.x1 - box.x0 + 1, chh = box.y1 - box.y0 + 1;
  const buf = Buffer.alloc(cw * chh * 3);
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
    const si = ((box.y0 + y) * s.width + (box.x0 + x)) * s.channels;
    const di = (y * cw + x) * 3;
    buf[di] = s.data[si]; buf[di + 1] = s.data[si + 1]; buf[di + 2] = s.data[si + 2];
  }
  writeFileSync(outPpm, Buffer.concat([Buffer.from(`P6\n${cw} ${chh}\n255\n`), buf]));
  return { cw, chh };
}

const closed = join(EVID, `mouthiso_${MODEL}_closed.png`);
const open = join(EVID, `mouthiso_${MODEL}_open.png`);
for (const f of [closed, open]) {
  if (!existsSync(f)) {
    console.error(`找不到 ${f}\n请先跑：node tools/mouth-iso.cjs ${MODEL}`);
    process.exit(1);
  }
}

const { changed, bbox } = diffBBox(readFileSync(closed), readFileSync(open));
if (!bbox) {
  console.log(`[${MODEL}] 嘴参数 0 与 1 无差异（该模型不响应，或参数没接在嘴上）`);
  process.exit(0);
}
console.log(`[${MODEL}] 差异像素 ${changed}，裁切框 x∈[${bbox.x0},${bbox.x1}] y∈[${bbox.y0},${bbox.y1}]`);

const tmpC = '/tmp/_l2dm1_crop_c.ppm', tmpO = '/tmp/_l2dm1_crop_o.ppm';
const { cw, chh } = writeCroppedPPM(closed, bbox, tmpC);
writeCroppedPPM(open, bbox, tmpO);

const outC = join(EVID, `crop_${MODEL}_mouth_closed.png`);
const outO = join(EVID, `crop_${MODEL}_mouth_open.png`);
// sips：PPM → PNG，再按 6 倍放大（最近邻靠 -Z 不够，这里只放大到便于目视的尺寸）
for (const [src, dst] of [[tmpC, outC], [tmpO, outO]]) {
  execFileSync('sips', ['-s', 'format', 'png', src, '--out', dst], { stdio: 'ignore' });
  execFileSync('sips', ['-Z', String(Math.max(240, cw * 6)), dst, '--out', dst], { stdio: 'ignore' });
}
console.log(`[written] ${outC}`);
console.log(`[written] ${outO}`);
console.log(`（裁切尺寸 ${cw}×${chh}，已放大到便于目视）`);
