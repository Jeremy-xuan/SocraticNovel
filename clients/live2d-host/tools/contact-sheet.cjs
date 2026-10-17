/**
 * contact-sheet.cjs —— 把全部样本的首帧拼成一张「联系表（contact sheet）」，供人一眼挑模型。
 *
 * 为什么要自己拼：本机只有 `sips`（不能合成），没有 ImageMagick；项目纪律不许新增依赖。
 * 所以这里复用手写 PNG 编解码（与 tools/mouth-iso.cjs 的 decodePNG 同源），
 * 输出一张真 PNG，不引入任何库。
 *
 * 版式：3 列 × N 行，每格 <cell>×<cell>（默认 320），格内把 720×720 首帧按面积等比缩放居中；
 *       每格下方 22px 写模型名（内置 5×7 点阵字，只用 A–Z a–z 0–9 与少数符号）；
 *       每格右侧一列状态条：绿=能直接当占位 / 黄=可用但有限 / 红=必须改代码才能用。
 *
 * 用法（项目根）：node $HOST/tools/contact-sheet.cjs [--cell=320] [--out=<path>]
 * 输入：evidence/matrix_<Model>_frame.png（render-matrix.cjs 产出）+ evidence/render_matrix.json
 * 产出：evidence/contact_sheet.png
 */

const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const zlib = require('node:zlib');

const { hostDir } = require('./_common.cjs');
const HOST_DIR = hostDir();
const EVID = join(HOST_DIR, 'evidence');

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const CELL = Number(arg('cell', 320));
const PAD = 10;
const LABEL_H = 24;
const BG = [10, 10, 10];        // #0a0a0a，与 DSH 右栏一致
const TILE_BG = [255, 255, 255]; // 模型首帧是白底，格子也铺白，避免锯齿边
const INK = [255, 255, 255];

// ── PNG 解码（8bit RGB/RGBA，无隔行；Chromium 截图产物）──────────────────
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let off = 8, width = 0, height = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const d = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = d.readUInt32BE(0); height = d.readUInt32BE(4); colorType = d[9]; interlace = d[12]; }
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (interlace !== 0) throw new Error('不支持隔行 PNG');
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!ch) throw new Error(`不支持 colorType=${colorType}`);
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

// ── PNG 编码（RGBA，filter 0，单个 IDAT）─────────────────────────────────
function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return t;
  })();
  const crc32 = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── 5×7 点阵字（只用我们需要的字符；每字符 7 行 × 5 列，'#'=亮）──────────
const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#..##', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '·': ['.....', '.....', '.....', '.....', '..#..', '.....', '.....'],
  '(': ['..#..', '.#...', '.#...', '.#...', '.#...', '.#...', '..#..'],
  ')': ['..#..', '...#.', '...#.', '...#.', '...#.', '...#.', '..#..'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  ':': ['.....', '..#..', '.....', '.....', '..#..', '.....', '.....']
};

function drawText(rgba, W, H, text, x0, y0, scale, color) {
  let cx = x0;
  for (const chRaw of text.toUpperCase()) {
    const g = GLYPHS[chRaw] || GLYPHS[' '];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (g[r][c] !== '#') continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const x = cx + c * scale + dx, y = y0 + r * scale + dy;
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const i = (y * W + x) * 4;
            rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2]; rgba[i + 3] = 255;
          }
        }
      }
    }
    cx += 6 * scale;
  }
}

function fillRect(rgba, W, H, x0, y0, w, h, color) {
  for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) {
      const i = (y * W + x) * 4;
      rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2]; rgba[i + 3] = 255;
    }
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────────
const matrix = JSON.parse(readFileSync(join(EVID, 'render_matrix.json'), 'utf8'));
const entries = matrix
  .map((r) => ({ ...r }))
  .filter((r) => existsSync(join(EVID, `matrix_${r.model}_frame.png`)));

// 状态分档（判据来自 render_matrix.json 的实测字段，不靠人工）
function grade(r) {
  const mouthOk = r.mouthResponds === true;
  const exprOk = (r.expressionCount || 0) >= 6;
  if (!r.rendered) return { key: 'red', label: 'NO RENDER' };
  if (mouthOk && exprOk) return { key: 'green', label: 'READY' };
  if (mouthOk && !exprOk) return { key: 'yellow', label: 'NO FACE' };
  if (!mouthOk && exprOk) return { key: 'yellow', label: 'NO MOUTH' };
  return { key: 'red', label: 'CODE FIX' };
}
const COLORS = { green: [46, 160, 67], yellow: [210, 153, 34], red: [218, 54, 51] };

const cols = 3;
const rows = Math.ceil(entries.length / cols);
const W = PAD + cols * (CELL + PAD);
const H = PAD + rows * (CELL + LABEL_H + PAD);
const rgba = Buffer.alloc(W * H * 4);
fillRect(rgba, W, H, 0, 0, W, H, BG);

entries.forEach((r, idx) => {
  const col = idx % cols, row = Math.floor(idx / cols);
  const x0 = PAD + col * (CELL + PAD);
  const y0 = PAD + row * (CELL + LABEL_H + PAD);

  const src = decodePNG(readFileSync(join(EVID, `matrix_${r.model}_frame.png`)));
  fillRect(rgba, W, H, x0, y0, CELL, CELL, TILE_BG);

  // 面积等比缩放居中
  const s = Math.min(CELL / src.width, CELL / src.height);
  const dw = Math.round(src.width * s), dh = Math.round(src.height * s);
  const ox = x0 + Math.floor((CELL - dw) / 2), oy = y0 + Math.floor((CELL - dh) / 2);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / s));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / s));
      const si = (sy * src.width + sx) * src.channels;
      const di = ((oy + y) * W + (ox + x)) * 4;
      rgba[di] = src.data[si]; rgba[di + 1] = src.data[si + 1]; rgba[di + 2] = src.data[si + 2]; rgba[di + 3] = 255;
    }
  }

  // 标签行：名字 + 表情数 + 嘴是否响应
  const g = grade(r);
  fillRect(rgba, W, H, x0, y0 + CELL + 6, 3, 7, COLORS[g.key]);
  const name = String(r.model).toUpperCase();
  const mouth = r.mouthResponds ? 'MOUTH+' : 'MOUTH-';
  const expr = 'EXPR' + String(r.expressionCount || 0);
  drawText(rgba, W, H, `${name}  ${mouth} ${expr}`, x0 + 9, y0 + CELL + 6, 1, INK);
});

writeFileSync(join(EVID, 'contact_sheet.png'), encodePNG(W, H, rgba));
console.log(`[contact-sheet] ${entries.length} 格 / ${cols} 列 → ${join(EVID, 'contact_sheet.png')} (${W}×${H})`);
console.log('');
console.log('| 格位 | 模型 | 渲染 | 嘴响应(写0→1像素) | 表情数 | 相位→表情 | 档位 |');
console.log('|---|---|---|---|---|---|---|');
entries.forEach((r, idx) => {
  const g = grade(r);
  const pos = `r${Math.floor(idx / cols) + 1}c${(idx % cols) + 1}`;
  const phase = (r.expressionCount || 0) === 0 ? 'unavailable(静默失效)' : (r.expressionCount || 0) < 6 ? 'partial(取模回绕)' : 'ok';
  console.log(`| ${pos} | ${r.model} | ${r.rendered ? '✅' : '❌'} | ${r.mouthResponse ? r.mouthResponse.changedPixels : '—'} | ${r.expressionCount} | ${phase} | ${g.label} |`);
});
