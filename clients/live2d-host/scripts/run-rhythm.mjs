/**
 * run-rhythm.mjs —— 文字节奏嘴型的数值取证（★本轮验收的核心）
 *
 * 做什么：给一段固定中文文本，按固定节奏逐字推进，每 50 ms 采样一次
 *        `TextRhythmProvider.getParameter()`，持续 3 秒，输出数值序列。
 * 关键：**用虚拟时钟**（注入 now()），所以结果完全可复现，与机器快慢无关。
 *
 * 用法（产出目录内）：node scripts/run-rhythm.mjs
 * 产出：
 *   evidence/rhythm_samples.csv     —— 原始采样（可直接进 Excel / pandas）
 *   evidence/rhythm_report.md       —— 文本表 + 程序化判据结论
 *
 * 验收看的是三条**数值判据**（不是"看起来像在说话"）：
 *   ① 文字推进时参数确实在变（出现非零值、且值有起伏）
 *   ② 标点处降为 0（且保持一小段静默）
 *   ③ 写字通道（channel=write）全程恒 0
 */

import { writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextRhythmProvider, WriteChannelProvider } from '../src/text-rhythm-provider.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVID = resolve(HERE, '..', 'evidence');

// ── 参数（全部显式写出来，便于复现与调参）──
const TICK_MS = 50; // 采样间隔
const DURATION_MS = 3000; // 采样时长（任务书要求 3 秒；末尾另加静默观察窗）
const SETTLE_TAIL_MS = 800; // 文本喂完后再多采 800 ms，用来验「会回到 0」
const TEXT_STOP_MS = Infinity; // 文本一路喂完（不吃截断，否则最后几个字喂不进去）
// 两个参数都从命令行给，便于一次跑多种「真实 chunk 粒度」的对照
const TOKEN_CHARS = Number(process.argv[2] || 3); // 每个 text-delta chunk 的字符数
const TOKEN_INTERVAL_MS = Number(process.argv[3] || 120); // chunk 到达间隔（毫秒）
const DECAY_TAU = Number(process.argv[4] || 0.25); // 衰减时间常数（秒）
const HOLD_MS = Number(process.argv[5] || 120); // 冲高后保持时长（毫秒）
const TEXT =
  '同学们好，今天我们把这一节讲完。先看定义：若函数连续，则极限存在。注意——这里有个容易错的地方，我们慢慢来。';
const SUFFIX = `_每${TOKEN_CHARS}字_间隔${TOKEN_INTERVAL_MS}ms_tau${DECAY_TAU}_hold${HOLD_MS}`;

const CONFIG = {
  charsPerTick: 3,
  jitter: 0.3,
  decayTau: DECAY_TAU,
  amplitude: 0.6,
  holdMs: HOLD_MS,
  maxValue: 1.0,
  zeroEpsilon: 0.005,
  punctuationPause: 0.18,
  punctuation: '。！？；：，、,.!?;:…—'
};

/**
 * 跑一条通道。
 * @param {'speak'|'write'} channel
 * @returns {{samples: Array, events: Array}}
 */
function run(channel) {
  let t = 0; // 虚拟时钟（毫秒）
  const now = () => t;
  const provider =
    channel === 'write' ? new WriteChannelProvider({ now }) : new TextRhythmProvider(CONFIG, { now });

  const chars = [...TEXT];
  const samples = [];
  const events = [];
  let nextCharAt = 0;
  let lastTick = 0;
  let charIdx = 0;

  for (let elapsed = 0; elapsed <= DURATION_MS + SETTLE_TAIL_MS; elapsed += TICK_MS) {
    t = elapsed;

    // 1) 到点就把下一个 token（1..N 个字符）喂进去（模拟流式 text-delta chunk）
    while (charIdx < chars.length && elapsed >= nextCharAt && elapsed <= TEXT_STOP_MS) {
      const chunk = chars.slice(charIdx, charIdx + TOKEN_CHARS).join('');
      provider.pushText(chunk);
      events.push({ t: elapsed, ch: chunk });
      charIdx += TOKEN_CHARS;
      nextCharAt += TOKEN_INTERVAL_MS;
    }

    // 2) 推进一帧（显式给 dt，保证确定性）
    const dt = (elapsed - lastTick) / 1000;
    lastTick = elapsed;
    provider.update(dt);

    samples.push({ t: elapsed, value: +provider.getParameter().toFixed(4) });
  }
  return { samples, events, stats: provider.stats() };
}

// ── 跑两条通道 ──
const speak = run('speak');
const write = run('write');

// 文本喂完的时刻（供判据 ④ 用）
const lastTextTime = speak.events.length ? Math.max(...speak.events.map((e) => e.t)) : null;
const textCompleted = speak.events.length === [...TEXT].length ? true : speak.events.length * TOKEN_CHARS >= [...TEXT].length;

// ── 程序化判据 ──
// 🔴 注意：chunk 是**多字符**的，所以判定必须用「chunk 里是否含标点」，不能用 Set.has(整串)
const isPunct = (ch) => [...ch].some((c) => CONFIG.punctuation.includes(c));
const punctTimes = speak.events.filter((e) => isPunct(e.ch)).map((e) => e.t);
const textTimes = speak.events.filter((e) => !isPunct(e.ch)).map((e) => e.t);
const values = speak.samples.map((s) => s.value);
const nonZero = values.filter((v) => v > 0);
const writeValues = write.samples.map((s) => s.value);

// 判据 ②：每个标点时刻的参数值必须为 0，且之后 punctuationPause 内保持 0
const punctChecks = punctTimes.map((pt) => {
  const windowEnd = pt + CONFIG.punctuationPause * 1000;
  const inWindow = speak.samples.filter((s) => s.t >= pt && s.t < windowEnd && s.t <= DURATION_MS);
  const maxInWindow = inWindow.length ? Math.max(...inWindow.map((s) => s.value)) : null;
  // 标点出现在 3 秒窗之外时（文本较长）该点不计入判据，避免"空窗口"被误判成失败
  return {
    punctTime: pt,
    inMeasurementWindow: inWindow.length > 0,
    samplesInWindow: inWindow.length,
    maxValueInWindow: maxInWindow
  };
});

// 判据 ①：文字推进期间出现非零，且数值有起伏（不是常数）
const speechSamples = speak.samples.filter(
  (s) => s.t >= Math.min(...textTimes) && s.t <= Math.max(...textTimes) && s.t <= DURATION_MS
);
const speechValues = speechSamples.map((s) => s.value);
const speechNonZero = speechValues.filter((v) => v > 0);
const distinctSpeechValues = new Set(speechValues.map((v) => v.toFixed(3))).size;

// 判据 ④：文本喂完之后，参数应在一个衰减时间常数内回到 0
let settleAt = null;
for (let i = 0; i + 1 < speak.samples.length; i++) {
  const a = speak.samples[i], b = speak.samples[i + 1];
  if (a.t >= (lastTextTime ?? 0) && a.value === 0 && b.value === 0) {
    settleAt = a.t;
    break;
  }
}

const verdict = {
  criterion1_textDrivesValue: {
    // 判据：说话期间必须 (a) 有明显比例的非零采样，(b) 取值不止一种
    pass:
      speechNonZero.length >= Math.max(3, Math.floor(speechValues.length * 0.3)) &&
      distinctSpeechValues >= 3,
    nonZeroSamplesDuringSpeech: speechNonZero.length,
    totalSamplesDuringSpeech: speechValues.length,
    nonZeroRatio: +(speechNonZero.length / Math.max(1, speechValues.length)).toFixed(3),
    distinctValueCount: distinctSpeechValues,
    min: Math.min(...speechValues),
    max: Math.max(...speechValues)
  },
  criterion2_punctuationZero: {
    pass:
      punctChecks.length > 0 &&
      punctChecks.filter((p) => p.inMeasurementWindow).every((p) => p.maxValueInWindow === 0) &&
      // 并且确实覆盖到了文本里的大多数标点
      punctChecks.filter((p) => p.inMeasurementWindow).length >= 5,
    punctuationCount: punctChecks.length,
    allZeroInPauseWindow: punctChecks.filter((p) => p.inMeasurementWindow).every((p) => p.maxValueInWindow === 0),
    punctuationInMeasurementWindow: punctChecks.filter((p) => p.inMeasurementWindow).length,
    detail: punctChecks
  },
  criterion3_writeChannelZero: {
    pass: writeValues.every((v) => v === 0),
    maxValue: Math.max(...writeValues),
    samples: writeValues.length
  },
  criterion4_settlesToZero: {
    // 判据：文本喂完之后，参数必须回到 0（不会一直张着嘴）。
    // 若文本在 3 秒窗内没喂完（末刻仍在说话），本条标 n/a 而不算失败。
    pass: textCompleted ? settleAt !== null : null,
    textCompleted,
    speechEndedAt: lastTextTime,
    settleAt,
    settleDelayMs: settleAt === null ? null : settleAt - lastTextTime,
    note: 'settleAt = 文本最后一个 chunk 之后，第一次连续两个采样都为 0 的时刻；null + pass=false 表示文本没喂完'
  }
};

// ── CSV ──
const csv = ['t_ms,channel_speak_value,channel_write_value'];
for (let i = 0; i < speak.samples.length; i++) {
  csv.push(`${speak.samples[i].t},${speak.samples[i].value},${write.samples[i].value}`);
}

// ── 文本曲线（每行 1 个采样；同时给一张"缩略柱状图"便于肉眼看形状）──
const bar = (v) => '█'.repeat(Math.round(v * 40)).padEnd(40, '·');
const curveLines = [];
curveLines.push('| t(ms) | 该刻喂入的字符 | 嘴参数值 | 0──────────────0.6 |');
curveLines.push('|---|---|---|---|');
const charAt = new Map(speak.events.map((e) => [e.t, e.ch]));
for (const s of speak.samples) {
  const ch = charAt.has(s.t) ? `\`${charAt.get(s.t)}\`` : '';
  curveLines.push(`| ${s.t} | ${ch} | **${s.value.toFixed(4)}** | \`${bar(s.value)}\` |`);
}

const md = [];
md.push('# 文字节奏嘴型 · 数值取证（脚本生成，勿手改）');
md.push('');
md.push(`生成命令：\`node scripts/run-rhythm.mjs\``);
md.push('');
md.push('## 0. 实验设置（完全确定性，可复现）');
md.push('');
md.push('| 项 | 值 |');
md.push('|---|---|');
md.push(`| 采样间隔 | ${TICK_MS} ms |`);
md.push(`| 采样时长 | ${DURATION_MS} ms ＋ 尾部静默观察窗 ${SETTLE_TAIL_MS} ms（共 ${DURATION_MS + SETTLE_TAIL_MS} ms）|`);
md.push(`| text-delta chunk 大小 | **${TOKEN_CHARS} 字/chunk**（真实 DSH 流式输出就是一个 chunk 几个字）|`);
md.push(`| chunk 到达间隔 | ${TOKEN_INTERVAL_MS} ms |`);
md.push(`| 折算文字速率 | ${(TOKEN_CHARS * 1000 / TOKEN_INTERVAL_MS).toFixed(1)} 字/秒（中文正常语速约 5–8 字/秒）|`);
md.push(`| 时钟 | **虚拟时钟**（注入 \`now()\`，每 tick 前进 ${TICK_MS} ms）→ 与机器快慢无关 |`);
md.push(`| 输入文本 | ${TEXT} |`);
md.push(`| 文本字符数 | ${[...TEXT].length} |`);
md.push('');
md.push('算法参数：');
md.push('');
md.push('```json');
md.push(JSON.stringify(CONFIG, null, 2));
md.push('```');
md.push('');
md.push('## 1. 程序化判据（验收看这里，不看"像不像"）');
md.push('');
md.push('```json');
md.push(JSON.stringify(verdict, null, 2));
md.push('```');
md.push('');
md.push('## 2. 采样序列（原始数据，逐条）');
md.push('');
md.push(curveLines.join('\n'));
md.push('');
md.push('## 3. 文字事件（哪个 tick 喂了哪个字）');
md.push('');
md.push('| t(ms) | 字符 | 是否标点 |');
md.push('|---|---|---|');
for (const e of speak.events) {
  md.push(`| ${e.t} | \`${e.ch}\` | ${isPunct(e.ch) ? '**是**' : ''} |`);
}
md.push('');
md.push('## 4. 两条通道的对照');
md.push('');
md.push('| 通道 | provider | 采样数 | 最大输出 | 非零采样数 | 语义 |');
md.push('|---|---|---|---|---|---|');
md.push(
  `| speak | \`TextRhythmProvider\` | ${speak.samples.length} | ${Math.max(...values)} | ${nonZero.length} | 嘴跟着文字动：冲高 + 指数衰减 + 标点闭嘴 |`
);
md.push(
  `| write | \`WriteChannelProvider\` | ${write.samples.length} | ${Math.max(...writeValues)} | ${writeValues.filter((v) => v > 0).length} | **嘴不动（恒 0）**；"写字流畅"由白板打字机效果承担，不经 Live2D |`
);
md.push('');
md.push('> 🔴 两条通道实现的是**同一个官方接口** `IParameterProvider`（`update(dt) → boolean` / `getParameter() → number`），');
md.push('> 所以上层切换通道只是换一个 provider 实例，渲染代码一行不改。');
md.push('');

writeFileSync(join(EVID, `rhythm_samples${SUFFIX}.csv`), csv.join('\n'));
writeFileSync(join(EVID, `rhythm_report${SUFFIX}.md`), md.join('\n'));
console.log(md.slice(0, 60).join('\n'));
console.log('\n--- 判据 ---');
console.log(JSON.stringify(verdict, null, 2));
console.log(`\n[written] ${join(EVID, `rhythm_samples${SUFFIX}.csv`)}`);
console.log(`[written] ${join(EVID, `rhythm_report${SUFFIX}.md`)}`);
