#!/usr/bin/env node
/*
 * scan-residue.mjs —— 教室内容「残留形状」结构化扫描
 *
 * 为什么有这个脚本（写死，防重犯）：
 *   CH02-14 体例统一批的自检报告里写过「回合脚本残留检查（应为 0）… 13 份全部零命中」，
 *   而主代理实测在 story/ 里有 2 处命中。根因不是判据错，是**扫描口径只落在 materials/**
 *   （13 份 = materials/ch02–14），报告却没写口径 → 读起来像"全部文件都扫过"。
 *   紧接着第二轮又证明：**判据本身也写窄了**——只查 7 个关键词时只报 9 处，
 *   按"节内条件触发形状"重新全扫，实际是 32 处（story 26 ＋ materials 5 ＋ characters 1）。
 *   本项目已有多次「扫描口径写窄」的教训（另见 AGENTS.md 里"关键词扫描会漏掉换了说法的残留"
 *   与"文件类型不能只限 .md"两条）。
 *   → 所以把口径固化成脚本，并**按节判定**（不是只按关键词）：
 *     **默认同时扫 story/ 与 materials/**，逐类列出「命中数 + 文件清单」。
 *
 * 判据（①–⑤ 参与退出码；⑥–⑦ 只列不判）：
 *   ① 旧节标题        —— 旧体例的节标题（**只匹配标题行**，不匹配正文提到这些词）
 *   ② 回合脚本形状    —— CH02-14 批报告 §6.2 逐字列的 7 个关键词
 *   ③ 预写问句        —— story/ 的问号必须为 0（materials/ 的问号是设计如此，只报不判）
 *   ④ 覆盖对照表      —— 旧体的「本讲知识点覆盖对照表」整节
 *   ⑤ 「可以发生的细节」条件触发形状 —— **按节判定**：节内不许出现"学生若/问/说 X（时）→ 她 Y"
 *                        这类把教师行为挂在学生话语上的条件触发（判据＝story/ch01 的「可以发生的细节」
 *                        口径：只写"她可能…"，不写"如果学生…，她可以…"）
 *   ⑥ 「开场怎样进入教学」预写台词候选 —— 只列不判（该节允许写"进入教学的路径"，
 *                        但 ch01 明令"不在故事文件里预写台词"；判"问 X"这类句式需要人看上下文）
 *   ⑦ 条件触发·查表式 · 全量候选 —— 只列不判。**故意写宽**，把"小鞠在课堂中的样子"里
 *                        "学生已经说出…之后顺势往下讲"、`characters/komari.md` 声明为
 *                        "行为触发条件"的整节等**by-design** 命中一并列出，避免再次只扫一半。
 *
 * 用法：
 *   node tools/scan-residue.mjs                      # 默认扫脚本所在教室（tools/ 的上一级）
 *   node tools/scan-residue.mjs <教室目录>            # 指定教室目录
 *   node tools/scan-residue.mjs <教室目录> --wide     # 额外扫教室其余 .md/.yaml，只列不判
 *
 * 退出码：0 = 干净（①–⑤ 全部零命中）；1 = 有残留；2 = 用法/目录错误。
 * 无第三方依赖。node 路径用 /opt/homebrew/bin/node。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const wide = args.includes('--wide');
const positional = args.filter((a) => !a.startsWith('--'));
const root = resolve(positional[0] ?? join(HERE, '..'));

if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`用法错误：${root} 不是一个目录`);
  process.exit(2);
}
if (!statSync(join(root, 'classroom.yaml'), { throwIfNoEntry: false })?.isFile()) {
  console.error(`用法错误：${root} 不是一个教室目录（找不到 classroom.yaml）`);
  process.exit(2);
}

// ── 判据表 ────────────────────────────────────────────────────────────────────

// ① 旧节标题：只匹配标题行。正文里提到这些词（例如 _anchor.md 的纪律用语、
//    story/ch01.md 里「不是本讲要完成的"犯错节点"」这类否定引用）不算残留。
const OLD_SECTIONS = [
  '本讲核心事实',
  '类比的边界',
  '教学地图（选择动作',
  '本讲要回答的核心疑问',
  '检验理解的一个新情境',
  '角色内的讲法',
  '场景节点',
  '机会节点',
  '犯错节点',
  '余韵场景方向',
  '暗线种子',
];

// ② 回合脚本形状：CH02-14 批报告 §6.2 逐字列出的 7 个关键词。
const TURN_SCRIPTS = [
  '学生若问',
  '学生如果说',
  '顺着问',
  '然后问',
  '接着问',
  '那就问',
  '让学生自己圈',
];

// ④ 覆盖对照表：旧体整节名。
const COVERAGE_TABLE = ['覆盖对照表'];

// ⑤ 「可以发生的细节」条件触发形状（**按节判定**）。
//    三条择一命中即报：条件连词开头 / "学生…时，" / "学生…，她<动作>"。
//    🔴 只写"她可能让学生自己算"这类**不带条件从句**的句子不算命中——判据是"条件触发形状"，
//       不是"出现『学生』两个字"（这一条是第二轮踩出来的：一开始只按关键词扫，漏了一半）。
const DETAIL_TRIGGER_RES = [
  /(?:如果|若|当|一旦)学生/,
  /学生[^。]{0,60}时[，,]/,
  /学生[^。]{0,60}[，,]\s*她(?:可以|可能|会|直接|先|不|只|能|要|也)/,
];

// ⑤ 的**已裁决例外表**（不是白名单兜底，是"有授权、有理由、有失效条件"的显式例外）。
//
// 为什么需要它：基准件 `story/ch01.md` 的「可以发生的细节」第 1 条**自身就是条件触发形状**，
//   但它**两个分支都带"可能"、属场景描述**，不是"学生做 X→教师做 Y"的教学指令。
//   主代理 2026-09-24 裁决 ①：**基准件是用户提交的，不擅改，该行回退保留**；
//   裁决 ② 把判据 2 收敛为"不许写成教学指令／允许双分支带可能的场景描述"。
//   → 于是"这一条是例外"是**被裁决过的**，把它写进判据表才是正当做法（放宽判据或删锚点都不是）。
//
// 🔴 但它**不是永久豁免**：例外按 (文件, 行, 逐字) 三者精确匹配——
//   该行**一旦被改动或挪位**，例外立即失效，⑤ 会**重新报红**并打印 `⚠️ 例外失效`。
//   每次运行都会把例外**原样打印出来**，所以它不会被忘记。
const DETAIL_TRIGGER_EXCEPTIONS = [
  {
    rel: 'story/ch01.md',
    line: 31,
    text: '- 旧排期留在白板一角。如果学生注意到，她可以说这是上个月改过的安排；如果没人注意，它就只是屋里的一部分。第 3 讲可以再遇见它，不必保证一个揭谜场面。',
    reason: '基准件例外 · 主代理裁决 ①（保留用户提交的基准原样；该行双分支带"可能"，属场景描述，不属"教学指令"形状）',
  },
];

// ⑥ 「开场怎样进入教学」预写台词候选：`问` 后面直接跟宾语（排除"问法/问题"）。
const OPENING_CUE_RE = /问(?!法|题)[^，。；：！？、“”"]{1,12}/;

// ⑦ 条件触发·查表式 · 全量候选（**故意写宽**，只列不判）。
const ADVISORY = [
  '学生若', '学生如果', '如果学生', '当学生', '学生一旦', '若学生',
  '学生问', '学生说', '学生答', '学生提到', '学生注意', '学生沉默',
  '学生抽到', '学生把', '学生提出', '学生算', '学生需要', '学生已经',
  '学生通常', '学生常', '学生可能', '学生不必', '学生追问', '学生问到',
  '只在学生', '让学生说', '让学生自己', '让她说', '学生会问', '学生**',
  '顺着问', '然后问', '接着问', '那就问',
];

// ── 扫描对象 ──────────────────────────────────────────────────────────────────

const CH = /^ch\d{2}\.md$/;

function chaptersIn(sub) {
  const dir = join(root, sub);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => CH.test(f))
    .sort()
    .map((f) => ({ rel: `${sub}/${f}`, abs: join(dir, f) }));
}

const story = chaptersIn('story');
const materials = chaptersIn('materials');
const scope = [...story, ...materials];

if (scope.length === 0) {
  console.error(`用法错误：${root} 下没有找到 story/chNN.md 或 materials/chNN.md`);
  process.exit(2);
}

// ── 扫描 ──────────────────────────────────────────────────────────────────────

/** 逐行匹配关键词，返回 [{rel, line, text, hit}] */
function scan(files, patterns, { headingsOnly = false } = {}) {
  const out = [];
  for (const { rel, abs } of files) {
    readFileSync(abs, 'utf8').split('\n').forEach((text, i) => {
      if (headingsOnly && !/^#{1,6}\s/.test(text)) return;
      for (const p of patterns) {
        if (text.includes(p)) out.push({ rel, line: i + 1, text: text.trim(), hit: p });
      }
    });
  }
  return out;
}

/** 逐行匹配正则，返回 [{rel, line, text, hit}] */
function scanRe(files, res) {
  const out = [];
  for (const { rel, abs } of files) {
    readFileSync(abs, 'utf8').split('\n').forEach((text, i) => {
      for (const re of res) {
        const m = re.exec(text);
        if (m) out.push({ rel, line: i + 1, text: text.trim(), hit: m[0] });
      }
    });
  }
  return out;
}

/** 取某个 `## 标题` 节的行（含行号），到下一个 `## ` 为止 */
function sectionLines({ rel, abs }, heading) {
  const lines = readFileSync(abs, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) break;
    out.push({ rel, line: i + 1, text: lines[i] });
  }
  return out;
}

/** 在某个节内做正则判定。🔴 按**行**去重：一行被两条正则命中只算 1 处（计数＝命中行数） */
function scanSection(files, heading, res) {
  const out = [];
  for (const f of files) {
    for (const { rel, line, text } of sectionLines(f, heading)) {
      for (const re of res) {
        const m = re.exec(text);
        if (m) { out.push({ rel, line, text: text.trim(), hit: m[0] }); break; }
      }
    }
  }
  return out;
}

/** 问号计数：返回 [{rel, count}]，只列 count>0 */
function countQuestionMarks(files) {
  const out = [];
  for (const { rel, abs } of files) {
    const n = (readFileSync(abs, 'utf8').match(/[？?]/g) ?? []).length;
    if (n > 0) out.push({ rel, count: n });
  }
  return out;
}

function report(title, hits, { files } = {}) {
  const clean = hits.length === 0;
  console.log(`\n${clean ? '✅' : '❌'} ${title}`);
  if (files !== undefined) {
    console.log(`   扫描范围：${files} 份（story/ ＋ materials/ 的全部 chNN.md）`);
  }
  console.log(`   命中：${hits.length} 处${clean ? '' : '，涉及文件 ' + new Set(hits.map((h) => h.rel)).size + ' 份'}`);
  for (const h of hits) console.log(`     ${h.rel}:${h.line}  [${h.hit}]  ${h.text}`);
  return clean;
}

const scopeNote = `${scope.length}`;

console.log('════════════════════════════════════════════════════════════════');
console.log(`教室残留扫描：${root}`);
console.log(`扫描对象：story/chNN.md ${story.length} 份 ＋ materials/chNN.md ${materials.length} 份 ＝ ${scope.length} 份`);
console.log('════════════════════════════════════════════════════════════════');

let ok = true;

ok = report('① 旧节标题（应为 0，只匹配标题行）', scan(scope, OLD_SECTIONS, { headingsOnly: true }), { files: scopeNote }) && ok;
ok = report('② 回合脚本形状（应为 0）', scan(scope, TURN_SCRIPTS), { files: scopeNote }) && ok;

const qStory = countQuestionMarks(story);
console.log(`\n${qStory.length === 0 ? '✅' : '❌'} ③ 预写问句 · story/（应为 0）`);
console.log(`   扫描范围：${story.length} 份`);
console.log(`   命中：${qStory.length} 份含问号`);
for (const h of qStory) console.log(`     ${h.rel}  问号 ${h.count} 个`);
ok = (qStory.length === 0) && ok;

const qMat = countQuestionMarks(materials);
console.log(`\nℹ️  ③b 预写问句 · materials/（**设计如此，不参与判定**）`);
console.log(`   含问号：${qMat.length}/${materials.length} 份`);
console.log(`   说明：新体例要求 materials 写「问题是：**……？**」与「可用来观察理解的新情境」的新情境问题，`);
console.log(`        问号在这里是必需的。旧体例要求"不许预写"的是 story/ 的故事方向。`);
console.log(`   明细：${qMat.map((h) => `${h.rel.replace('materials/', '')}=${h.count}`).join('  ')}`);

ok = report('④ 覆盖对照表（应为 0）', scan(scope, COVERAGE_TABLE), { files: scopeNote }) && ok;

// ⑤ 判定：先取全量命中，再按**已裁决例外表**分流（例外按 文件+行+逐字 精确匹配，文本一变即失效）
const detailHits = scanSection(story, '## 可以发生的细节', DETAIL_TRIGGER_RES);
const detailExcepted = [];
const detailReal = [];
const exceptionUsed = new Set();
for (const h of detailHits) {
  const ex = DETAIL_TRIGGER_EXCEPTIONS.find(
    (e) => e.rel === h.rel && e.line === h.line && e.text === h.text,
  );
  if (ex) {
    detailExcepted.push({ ...h, reason: ex.reason });
    exceptionUsed.add(ex);
  } else {
    detailReal.push(h);
  }
}
const staleExceptions = DETAIL_TRIGGER_EXCEPTIONS.filter((e) => !exceptionUsed.has(e));

ok = report('⑤ 「可以发生的细节」条件触发形状（应为 0，**按节判定**）', detailReal) && ok;

if (detailExcepted.length > 0) {
  console.log(`\n⚪ ⑤ 已裁决例外（**原样打印，不报红**）：${detailExcepted.length} 处`);
  for (const h of detailExcepted) console.log(`     ${h.rel}:${h.line}  ${h.reason}`);
}
for (const e of staleExceptions) {
  console.log(`\n⚠️ ⑤ 例外失效：${e.rel} 第 ${e.line} 行**已不再逐字匹配**该例外 → 例外不生效，`)
  console.log(`   若该行现在命中 ⑤ 判据，它会作为正常残留报红。请重新裁决后再改这张表。`);
  ok = false;
}

console.log('\n──────────────────────── 以下只列不判（不参与退出码） ────────────────────────');

report('⑥ 「开场怎样进入教学」预写台词候选', scanSection(story, '## 开场怎样进入教学', [OPENING_CUE_RE]));
console.log('   说明：该节**允许**写"进入教学的路径"（先做什么、学生说出什么之后进入技术部分），');
console.log('        但 ch01 明令"不在故事文件里预写台词"。命中项需要人看上下文判断是"路径"还是"台词"。');

const adv = scan(scope, ADVISORY);
console.log(`\nℹ️  ⑦ 条件触发·查表式 · 全量候选（**故意写宽**，含 by-design 命中）`);
console.log(`   命中：${adv.length} 处，涉及文件 ${new Set(adv.map((h) => h.rel)).size} 份`);
for (const h of adv) console.log(`     ${h.rel}:${h.line}  [${h.hit}]  ${h.text}`);
console.log('   说明：本类**故意**把"小鞠在课堂中的样子"里"学生已经说出…之后顺势往下讲"、');
console.log('         以及 `characters/komari.md` 声明为"行为触发条件"的整节一并列出——');
console.log('         那些是 by-design，不是残留；列出它们是为了**不再只扫一半**。');

// ── wide 模式：教室其余文件只列不判 ────────────────────────────────────────────
if (wide) {
  const others = [];
  const selfDir = relative(root, HERE); // 跳过本脚本自己（它内含判据关键词字面量，会自命中）
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (relative(root, p) !== selfDir) walk(p); continue; }
      if (!/\.(md|ya?ml|json|sh|mjs)$/.test(e.name)) continue;
      const rel = relative(root, p);
      if (CH.test(e.name) && /^(story|materials)\//.test(rel)) continue;
      others.push({ rel, abs: p });
    }
  };
  walk(root);
  const wHits = [
    ...scan(others, OLD_SECTIONS, { headingsOnly: true }),
    ...scan(others, TURN_SCRIPTS),
    ...scanRe(others, DETAIL_TRIGGER_RES),
    ...scan(others, ADVISORY),
  ];
  console.log(`\nℹ️  --wide 附加扫描（**不参与退出码**）：教室其余文件 ${others.length} 份`);
  console.log(`   命中：${wHits.length} 处`);
  for (const h of wHits) console.log(`     ${h.rel}:${h.line}  [${h.hit}]  ${h.text}`);
  console.log(`   说明：_anchor.md／system_core.md／AGENTS.md 里的「本讲核心事实」是**纪律用语**、`);
  console.log(`         story/overview.md 的「暗线种子总表」是 AGENTS.md 目录结构里声明过的正式节名、`);
  console.log(`         characters/komari.md 的「行为触发条件」整节是**声明过的接口**——`);
  console.log(`         它们不是旧体例残留；这正是 ① 只匹配标题行、且默认范围限定章节文件的原因。`);
}

console.log('\n════════════════════════════════════════════════════════════════');
console.log(ok ? '结论：①–⑤ 全部干净（退出码 0）' : '结论：①–⑤ 有残留（退出码 1）');
console.log('════════════════════════════════════════════════════════════════');
process.exit(ok ? 0 : 1);
