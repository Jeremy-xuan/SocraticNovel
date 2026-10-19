// 生成「暖纸花饰」构件展厅 HTML（螺旋用密采样生成，避免手写贝塞尔画不像）
// 用法：node gen-sheet.mjs > ornaments.html  &&  node shot.cjs ornaments.html render.png
const f = (n) => Math.round(n * 100) / 100;

// 水平卷须：从 (x0,y0) 向 sx 方向（-1 左 / +1 右）引出 lead，然后卷成 turns 圈
// r0 起点半径、r1 卷心半径、dir 卷向（+1 视觉顺时针 / -1 逆时针）、samples 采样数
function voluteH({ x0 = 0, y0 = 0, sx = -1, lead = 3, r0 = 9, r1 = 1.3, turns = 1.15, dir = 1, samples = 28 }) {
  const p = [];
  const xa = x0 + sx * lead;
  const cx = xa + sx * r0;
  const cy = y0;
  const total = Math.PI * 2 * turns;
  const a0 = sx > 0 ? Math.PI : 0;           // 从圆心看起点：sx=-1 时点在 +r0 侧 → 角 0
  p.push([x0, y0], [xa, y0]);
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const a = a0 + dir * total * t;
    const r = r0 + (r1 - r0) * t;
    p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return p;
}

// 竖直卷须：从 (x0,y0) 向 sy 方向（-1 上 / +1 下）引出，然后卷
function voluteV({ x0 = 0, y0 = 0, sy = -1, lead = 3, r0 = 8, r1 = 1.2, turns = 1.1, dir = 1, samples = 26 }) {
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

const d = (pts) => pts.map(([x, y], i) => (i ? 'L' : 'M') + f(x) + ',' + f(y)).join(' ');
const g = (pts) => pts.map(([x, y]) => `<circle cx="${f(x)}" cy="${f(y)}" r="0.9" fill="none"/>`).join('');

// ── ① 端饰：竖柱 + 向左的卷须（画布 30×50）──────────────────────────
// 三条卷须：上/中/下，中间那条为主
const endTop = d(voluteH({ x0: 25, y0: 9, sx: -1, lead: 2, r0: 5.6, r1: 1.0, turns: 1.1, dir: 1 }));
const endBot = d(voluteH({ x0: 25, y0: 41, sx: -1, lead: 2, r0: 5.6, r1: 1.0, turns: 1.1, dir: -1 }));
const endMid = d(voluteH({ x0: 25, y0: 25, sx: -1, lead: 2, r0: 8.2, r1: 1.1, turns: 1.2, dir: 1 }));

function endOrnament() {
  return `<svg width="32" height="50" viewBox="0 0 32 50">
    <path d="M25.6,2 L25.6,48" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M30,5 L30,45" stroke="currentColor" stroke-width="1.2" fill="none" opacity=".6" stroke-linecap="round"/>
    <path d="${endTop}" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${endBot}" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${endMid}" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M25,25 L17,25" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </svg>`;
}

// ── ② 四角：直角臂 + 角内卷须（画布 40×40）───────────────────────────
const cornerCurl = d(voluteH({ x0: 13, y0: 13, sx: 1, lead: 1, r0: 4.6, r1: 0.9, turns: 1.05, dir: -1 }));
const cornerCurlV = d(voluteV({ x0: 13, y0: 13, sy: 1, lead: 1, r0: 4.6, r1: 0.9, turns: 1.05, dir: 1 }));
function cornerOrnament() {
  return `<svg width="40" height="40" viewBox="0 0 40 40">
    <path d="M1,36 L1,8 Q1,1 8,1 L36,1" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M6,34 L6,9 Q6,6 9,6 L34,6" stroke="currentColor" stroke-width="1.1" fill="none" opacity=".55" stroke-linecap="round"/>
    <path d="${cornerCurl}" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${cornerCurlV}" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// ── ③ 抬头括号：双波浪 + 远端小卷（画布 56×26，左右镜像）──────────────
function waveBracket() {
  const w = (yy, amp) => {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const x = 4 + t * 44;
      const y = yy + Math.sin(t * Math.PI * 2.6) * amp * (0.25 + 0.75 * t);
      pts.push([x, y]);
    }
    return d(pts);
  };
  const tail = d(voluteH({ x0: 50, y0: 13, sx: 1, lead: 1, r0: 5.5, r1: 1, turns: 1.0, dir: 1 }));
  return `<svg width="58" height="26" viewBox="0 0 58 26">
    <path d="${w(10, 1.6)}" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <path d="${w(16, 1.6)}" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <path d="${tail}" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// ── ④ 叶形分隔带（画布 160×26）────────────────────────────────────────
function leafBand() {
  const side = (sgn) => {
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const x = 80 + sgn * (12 + t * 68);
      const y = 13 + Math.sin(t * Math.PI * 2.2) * 2.4 * t;
      pts.push([x, y]);
    }
    return d(pts);
  };
  return `<svg width="160" height="26" viewBox="0 0 160 26">
    <path d="${side(-1)}" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <path d="${side(1)}" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <path d="M80,3 C88,9 88,17 80,23 C72,17 72,9 80,3 Z" stroke="currentColor" stroke-width="1.5" fill="none"/>
    <path d="M80,3 L80,23" stroke="currentColor" stroke-width="1" fill="none" opacity=".55"/>
  </svg>`;
}

// ── ⑤ 尖叶指示（画布 14×26）──────────────────────────────────────────
function leafIndicator() {
  return `<svg width="14" height="26" viewBox="0 0 14 26">
    <path d="M7,2 C11,8 11,18 7,24 C3,18 3,8 7,2 Z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/>
  </svg>`;
}

const html = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>暖纸花饰 · 展厅 v2</title>
<style>
:root{--paper:#F3E9DA;--ink:#2A211A;--ink2:#4A3B2E;--gilt:#C2861F;--amber:#E0921C;--rust:#B84A1C;
      --hair:rgba(42,33,26,.16);--serif:"Songti SC","Source Han Serif SC",serif;--mono:"SF Mono",Menlo,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--serif);width:1920px;height:1080px;overflow:hidden}
.sheet{width:1920px;height:1080px;padding:30px 40px}
h1{font-size:19px;font-weight:400;letter-spacing:.22em;margin:0 0 3px}
.sub{font-family:var(--mono);font-size:11px;color:var(--ink2);margin-bottom:18px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 26px}
.cell{border:1px solid var(--hair);padding:10px 12px}
.cell h2{font-size:12px;font-weight:400;letter-spacing:.16em;margin:0 0 1px}
.note{font-family:var(--mono);font-size:10px;color:rgba(74,59,46,.7);margin-bottom:7px}
.dark{background:#1E1B18;border-radius:2px;padding:6px 10px;display:flex;align-items:center;gap:10px}
.rowbar{position:relative;flex:1;height:52px;display:flex;align-items:center}
.body{flex:1;height:48px;margin:0 22px 0 30px;background:linear-gradient(180deg,#3B3029,#26201B);
      border-top:1px solid rgba(224,146,28,.5);border-bottom:1px solid rgba(224,146,28,.32);
      display:flex;align-items:center;padding:0 16px}
.body .n{font-family:var(--mono);font-size:11px;color:#E0921C;margin-right:12px}
.body .t{font-size:18px;color:#F3E9DA;letter-spacing:.03em}
.ornL{position:absolute;left:0;top:50%;transform:translateY(-50%);color:var(--gilt)}
.ornR{position:absolute;right:0;top:50%;transform:translateY(-50%) scaleX(-1);color:var(--gilt)}
.head{display:flex;align-items:center;justify-content:center;gap:12px;color:var(--gilt)}
.head .tx{font-size:18px;letter-spacing:.32em;color:#E4DACC}
.sep{display:flex;align-items:center;color:var(--rust)}
.sep .ln{flex:1;height:1px;background:linear-gradient(90deg,var(--hair),rgba(42,33,26,.34),var(--hair))}
.trio{display:flex;align-items:center;gap:26px;color:var(--rust);height:44px}
.li{display:inline-block;line-height:0}
.sep svg{display:block}
.cornerbox{position:relative;width:190px;height:108px;background:#26221E;color:var(--gilt)}
.cornerbox .c{position:absolute;opacity:.9}
.cornerbox .tl{left:7px;top:7px}
.cornerbox .tr{right:7px;top:7px;transform:scaleX(-1)}
.cornerbox .bl{left:7px;bottom:7px;transform:scaleY(-1)}
.cornerbox .br{right:7px;bottom:7px;transform:scale(-1,-1)}
</style></head><body><div class="sheet">
<h1>暖 纸 花 饰 · 构 件 展 厅</h1>
<div class="sub">v2 · 螺旋密采样 · 1920×1080 实尺 · 只定形状，颜色走暖纸令牌</div>
<div class="grid">

  <div class="cell">
    <h2>① 端饰 · 三卷须＋双柱（选项行左右两端）</h2>
    <div class="note">柱高 42 · 卷须 r 7.5–9.5 · 线与柱同为金色</div>
    <div class="dark"><div class="rowbar">
      <div class="ornL">${endOrnament()}</div>
      <div class="body"><span class="n">01</span><span class="t">先把 PCB 拆给我看。</span></div>
      <div class="ornR">${endOrnament()}</div>
    </div></div>
    <div class="dark" style="margin-top:8px"><div class="rowbar">
      <div class="ornL" style="color:#E0921C">${endOrnament()}</div>
      <div class="body" style="background:linear-gradient(180deg,#C2521F,#B84A1C);border-color:#E0921C">
        <span class="n" style="color:#FFF7EC">02</span><span class="t" style="color:#FFF7EC">进程和线程，到底差在哪？</span></div>
      <div class="ornR" style="color:#E0921C">${endOrnament()}</div>
    </div></div>
  </div>

  <div class="cell">
    <h2>② 四角 · 卷草（整屏四角／纸卡四角）</h2>
    <div class="note">直角臂 ×2（1.5 / 1.0 双线）＋ 角内单卷须</div>
    <div class="dark" style="justify-content:center;padding:10px">
      <div class="cornerbox">
        <div class="c tl">${cornerOrnament()}</div><div class="c tr">${cornerOrnament()}</div>
        <div class="c bl">${cornerOrnament()}</div><div class="c br">${cornerOrnament()}</div>
      </div>
    </div>
  </div>

  <div class="cell">
    <h2>③ 抬头 · 双波浪括号（选项屏抬头）</h2>
    <div class="note">两条平行波线，振幅随距离增长，远端收一个卷</div>
    <div class="dark" style="justify-content:center;padding:12px 10px">
      <div class="head">
        <span style="transform:scaleX(-1);display:block">${waveBracket()}</span>
        <span class="tx">选 项 Ⅰ</span>
        ${waveBracket()}
      </div>
    </div>
    <div class="note" style="margin-top:8px">同一构件在纸色底上的样子（正文区抬头）</div>
    <div style="display:flex;justify-content:center;padding:8px 0;color:var(--gilt)">
      <div class="head"><span style="transform:scaleX(-1);display:block">${waveBracket()}</span>
      <span class="tx" style="color:#4A3B2E">板 书</span>${waveBracket()}</div>
    </div>
  </div>

  <div class="cell">
    <h2>④ 叶形分隔带 ／ ⑤ 尖叶指示</h2>
    <div class="note">叶形带：柳叶居中，两侧波浪蔓延（分隔正文与选项）</div>
    <div class="sep" style="padding:6px 0"><div class="ln" style="flex:1"></div><span style="flex:none">${leafBand()}</span><div class="ln" style="flex:1"></div></div>
    <div class="note" style="margin-top:6px">尖叶：贴在当前项编号右侧（三档大小）</div>
    <div class="trio" style="padding:6px 0">
      <span class="li" style="transform:scale(.75)">${leafIndicator()}</span>
      <span class="li">${leafIndicator()}</span>
      <span class="li" style="transform:scale(1.35)">${leafIndicator()}</span>
    </div>
  </div>

</div></div></body></html>`;

process.stdout.write(html);
