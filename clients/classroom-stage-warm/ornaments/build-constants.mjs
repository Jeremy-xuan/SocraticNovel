// 把密采样折线转成平滑三次贝塞尔（Catmull-Rom → Cubic），并输出可直接粘进 client.js 的常量片段。
// 用法：node build-constants.mjs > constants.snippet.js
const f = (n) => Math.round(n * 10) / 10;

// Catmull-Rom 样条 → 三次贝塞尔，输出 M + C 序列
function smooth(pts) {
  if (pts.length < 2) return '';
  const out = [`M${f(pts[0][0])},${f(pts[0][1])}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    out.push(`C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`);
  }
  return out.join(' ');
}

function voluteH({ x0 = 0, y0 = 0, sx = -1, lead = 3, r0 = 9, r1 = 1.3, turns = 1.15, dir = 1, samples = 22 }) {
  const p = [];
  const xa = x0 + sx * lead;
  const cx = xa + sx * r0;
  const total = Math.PI * 2 * turns;
  const a0 = sx > 0 ? Math.PI : 0;
  p.push([x0, y0], [xa, y0]);
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const a = a0 + dir * total * t;
    const r = r0 + (r1 - r0) * t;
    p.push([cx + r * Math.cos(a), y0 + r * Math.sin(a)]);
  }
  return p;
}

function voluteV({ x0 = 0, y0 = 0, sy = -1, lead = 3, r0 = 8, r1 = 1.2, turns = 1.1, dir = 1, samples = 22 }) {
  const p = [];
  const ya = y0 + sy * lead;
  const cy = ya + sy * r0;
  const startA = sy < 0 ? Math.PI / 2 : -Math.PI / 2;
  const total = Math.PI * 2 * turns;
  p.push([x0, y0], [x0, ya]);
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const a = startA + dir * total * t;
    const r = r0 + (r1 - r0) * t;
    p.push([x0 + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return p;
}

// ── 端饰（viewBox 0 0 32 50）────────────────────────────────────────────
const END_TOP = smooth(voluteH({ x0: 25, y0: 9, sx: -1, lead: 2, r0: 5.6, r1: 1.0, turns: 1.1, dir: 1 }));
const END_BOT = smooth(voluteH({ x0: 25, y0: 41, sx: -1, lead: 2, r0: 5.6, r1: 1.0, turns: 1.1, dir: -1 }));
const END_MID = smooth(voluteH({ x0: 25, y0: 25, sx: -1, lead: 2, r0: 8.2, r1: 1.1, turns: 1.2, dir: 1 }));

// ── 四角卷草（viewBox 0 0 40 40）────────────────────────────────────────
const CORNER_H = smooth(voluteH({ x0: 12, y0: 12, sx: 1, lead: 1, r0: 7.2, r1: 1.1, turns: 1.1, dir: -1 }));
const CORNER_V = smooth(voluteV({ x0: 12, y0: 12, sy: 1, lead: 1, r0: 7.2, r1: 1.1, turns: 1.1, dir: 1 }));

// ── 抬头双波浪（viewBox 0 0 58 26）──────────────────────────────────────
const wave = (yy, amp) => {
  const pts = [];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    pts.push([4 + t * 84, yy + Math.sin(t * Math.PI * 3.2) * amp * (0.30 + 0.70 * t)]);
  }
  return smooth(pts);
};
const WAVE_TOP = wave(8, 3.6);
const WAVE_BOT = wave(18, 3.6);
const WAVE_TAIL = smooth(voluteH({ x0: 90, y0: 13, sx: 1, lead: 1, r0: 5.5, r1: 1, turns: 1.0, dir: 1 }));

// ── 叶形分隔带（viewBox 0 0 160 26）────────────────────────────────────
const leafSide = (sgn) => {
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const x = 80 + sgn * (12 + t * 68);
    const y = 13 + Math.sin(t * Math.PI * 2.2) * 2.4 * t;
    pts.push([x, y]);
  }
  return smooth(pts);
};
const LEAF_BAND_L = leafSide(-1);
const LEAF_BAND_R = leafSide(1);

const snippet = `  // ── 花饰构件（2026-10-17 增补：补「图形装饰 0 族」这个缺口）
  // 形状＝阿基米德螺旋密采样后转贝塞尔（见 ornaments/build-constants.mjs，可重生成）；
  // 颜色一律走 currentColor，由 CSS 决定；线宽在 CSS 里给。
  const END_TOP = '${END_TOP}'
  const END_BOT = '${END_BOT}'
  const END_MID = '${END_MID}'
  const CORNER_H = '${CORNER_H}'
  const CORNER_V = '${CORNER_V}'
  const WAVE_TOP = '${WAVE_TOP}'
  const WAVE_BOT = '${WAVE_BOT}'
  const WAVE_TAIL = '${WAVE_TAIL}'
  const LEAF_BAND_L = '${LEAF_BAND_L}'
  const LEAF_BAND_R = '${LEAF_BAND_R}'

  // 端饰：竖双柱 ＋ 三卷须 ＋ 中横羽（左右镜像用 scaleX(-1)）
  const ORN_END = (tag) => H('svg', { key: tag, viewBox: '0 0 32 50', className: 'orn-end' },
    H('path', { d: 'M25.6 2 L25.6 48' }),
    H('path', { d: 'M30 5 L30 45' }),
    H('path', { d: END_TOP }),
    H('path', { d: END_BOT }),
    H('path', { d: END_MID }),
    H('path', { d: 'M25 25 L17 25' }))

  // 抬头括号：双平行波浪 ＋ 远端收卷
  const ORN_WAVE = (mirror) => H('svg', {
    key: mirror ? 'wv-r' : 'wv-l', viewBox: '0 0 100 26', className: 'orn-wave',
    style: mirror ? { transform: 'scaleX(-1)' } : undefined,
  },
    H('path', { d: WAVE_TOP }),
    H('path', { d: WAVE_BOT }),
    H('path', { d: WAVE_TAIL }))

  // 当前项指示：一枚尖叶
  const LEAF_SVG = H('svg', { key: 'leaf', viewBox: '0 0 14 26', className: 'leaf' },
    H('path', { d: 'M7 2 C11 8 11 18 7 24 C3 18 3 8 7 2 Z' }))

  // 叶形分隔带：柳叶 ＋ 中脉 ＋ 双侧波浪蔓延
  const ORN_LEAF_BAND = H('svg', { key: 'leaf-band', viewBox: '0 0 160 26', className: 'leaf-band' },
    H('path', { d: LEAF_BAND_L }),
    H('path', { d: LEAF_BAND_R }),
    H('path', { d: 'M80 3 C88 9 88 17 80 23 C72 17 72 9 80 3 Z' }),
    H('path', { d: 'M80 3 L80 23', className: 'leaf-mid' }))
`;

process.stdout.write(snippet);
