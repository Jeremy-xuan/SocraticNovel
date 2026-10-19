// 从 lib/client.js 抽出 CSS，生成静态夹具页（不依赖 DSH 会话，纯浏览器渲染）
// 用途：改观感后一秒出图，不用起真机实例。
// 用法：node make-fixture.mjs  → 生成 fixture.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8');
const m = src.match(/const CSS = `([\s\S]*?)`\n/);
if (!m) { console.error('提取 CSS 失败：没找到 const CSS = `…`'); process.exit(2); }
const CSS = m[1];

// 花饰 path（与 build-constants.mjs 同源，这里直接读它生成的片段）
const snip = fs.readFileSync(path.join(__dirname, 'constants.snippet.js'), 'utf8');
const grab = (name) => {
  const re = new RegExp("const " + name + " = '([^']+)'");
  const x = snip.match(re);
  if (!x) { console.error('缺常量 ' + name); process.exit(2); }
  return x[1];
};
const END_TOP = grab('END_TOP'), END_BOT = grab('END_BOT'), END_MID = grab('END_MID');
const WAVE_TOP = grab('WAVE_TOP'), WAVE_BOT = grab('WAVE_BOT'), WAVE_TAIL = grab('WAVE_TAIL');
const CORNER_H = grab('CORNER_H'), CORNER_V = grab('CORNER_V');
const LEAF_BAND_L = grab('LEAF_BAND_L'), LEAF_BAND_R = grab('LEAF_BAND_R');

const endOrn = `<svg viewBox="0 0 32 50" class="orn-end">
  <path d="M25.6 2 L25.6 48"/><path d="M30 5 L30 45"/>
  <path d="${END_TOP}"/><path d="${END_BOT}"/><path d="${END_MID}"/>
  <path d="M25 25 L17 25"/></svg>`;
const waveOrn = (flip) => `<svg viewBox="0 0 100 26" class="orn-wave"${flip ? ' style="transform:scaleX(-1)"' : ''}>
  <path d="${WAVE_TOP}"/><path d="${WAVE_BOT}"/><path d="${WAVE_TAIL}"/></svg>`;
const cornerOrn = `<svg viewBox="0 0 40 40" class="corner-svg">
  <path d="M1 36 L1 8 Q1 1 8 1 L36 1"/><path d="M6 34 L6 9 Q6 6 9 6 L34 6"/>
  <path d="${CORNER_H}"/><path d="${CORNER_V}"/></svg>`;
const leafSepOrn = `<div class="leaf-sep">
  <div class="sep-line"></div>
  <svg viewBox="0 0 160 26" class="leaf-band">
    <path d="${LEAF_BAND_L}"/>
    <path d="${LEAF_BAND_R}"/>
    <path d="M80 3 C88 9 88 17 80 23 C72 17 72 9 80 3 Z"/>
    <path d="M80 3 L80 23" class="leaf-mid"/>
  </svg>
  <div class="sep-line"></div>
</div>`;

const OC = [
  { cls: 'oc picked sent', n: '01', tx: '先把 PCB 拆给我看。', go: '已送出' },
  { cls: 'oc cur', n: '02', tx: '进程和线程，到底差在哪？', go: '当前' },
  { cls: 'oc', n: '03', tx: '画一张状态迁移图。', go: '↑↓ 选 · Enter 定' },
  { cls: 'oc', n: '04', tx: '举一个我身边能看见的例子。', go: '↑↓ 选 · Enter 定' },
  { cls: 'oc picked', n: '05', tx: '我自己写一段 fork 试试。', go: '已选' },
  { cls: 'oc disabled', n: '06', tx: '先停一下，我把上一讲再看一遍。', go: '已用过' },
];

const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<title>舞台静态夹具</title>
<style>${CSS}
html,body{margin:0;width:100%;height:100%;background:#0a0a0a}
</style></head><body>
<div class="stage-warm-root" data-chrome="on" data-screen="">
  <img class="bg" src="../assets/stage/classroom_wide.png" alt="">
  <div class="veil"></div>
  <div class="corner tl">${cornerOrn}</div>
  <div class="corner br">${cornerOrn}</div>
  <div class="cast-wrap"><img class="cast" src="../assets/stage/student_f.png" alt=""></div>
  <div class="band">
    <div class="band-top"></div>
    <div class="band-core">
      <p class="line sans past">先看这两行：它们在同一个核上，却不是同时跑。</p>
      <p class="line sans cur">那你觉得，切换的时候，什么必须被保存下来？</p>
      ${leafSepOrn}
      <div class="orn">
        ${waveOrn(true)}
        <span class="tx">选 项</span>
        ${waveOrn(false)}
      </div>
      <div class="opts">
        ${OC.map((o) => `<div class="${o.cls}">
          <span class="oe l">${endOrn}</span>
          <span class="no">${o.n}</span>
          <span class="tx">${o.tx}</span>
          <span class="go">${o.go}</span>
          <span class="oe r">${endOrn}</span>
        </div>`).join('\n        ')}
      </div>
    </div>
    <div class="composer">
      <textarea placeholder="回一句，或者说「听不懂」"></textarea>
      <span class="hint">Enter 送出 · Shift+Enter 换行</span>
      <button class="send">送出</button>
    </div>
  </div>
</div>
</body></html>`;

fs.writeFileSync(path.join(__dirname, 'fixture.html'), html);
console.log('fixture.html 已生成（CSS ' + CSS.length + ' 字符）');
