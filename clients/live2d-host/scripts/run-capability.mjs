/**
 * run-capability.mjs —— 把 8 个官方样本逐个跑一遍能力发现，产出表格
 *
 * 用法（产出目录内）：node scripts/run-capability.mjs
 * 产出：
 *   evidence/capability_table.md    —— 给人看的表（报告直接引用）
 *   evidence/capability_table.json  —— 完整清单（含每条的 detail 与来源）
 *
 * 🔴 为什么必须逐样本跑：官方 8 个样本里 LipSync 参数名有 4 种形态
 *    （ParamMouthOpenY / ParamA / PARAM_MOUTH_OPEN_Y / 空数组），
 *    只看一个样本会得出错误结论。这张表是「三级回退真的在起作用」的验收证据。
 */

import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCapability } from '../src/capability.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const RES = join(ROOT, 'samples', 'Resources');
const EVID = join(ROOT, 'evidence');

const models = readdirSync(RES)
  .filter((d) => existsSync(join(RES, d, `${d}.model3.json`)))
  .sort();

const rows = [];
const full = {};

for (const m of models) {
  const dir = join(RES, m);
  const model3 = JSON.parse(readFileSync(join(dir, `${m}.model3.json`), 'utf8'));

  let displayInfo = null;
  let displayInfoMissingReason = null;
  const diName = model3.FileReferences?.DisplayInfo;
  if (diName && existsSync(join(dir, diName))) {
    displayInfo = JSON.parse(readFileSync(join(dir, diName), 'utf8'));
  } else {
    displayInfoMissingReason = diName
      ? `model3.json 声明了 DisplayInfo=${diName}，但文件不存在`
      : 'model3.json 未声明 FileReferences.DisplayInfo';
  }

  const cap = parseCapability(model3, { modelId: m, displayInfo, displayInfoMissingReason });
  full[m] = cap;

  rows.push({
    model: m,
    motionGroups: cap.motionGroupUnion.join('+') || '（无）',
    motionCounts: cap.motionGroups.map((g) => `${g.name}:${g.count}`).join(' '),
    expressions: cap.expressionCount,
    expressionNames: cap.expressions.map((e) => e.name).join(',') || '（无）',
    lipSyncDeclared: JSON.stringify(cap.parameterGroups.LipSync ?? null),
    lipSyncActual: cap.lipSync.parameter ?? '—',
    lipSyncStatus: cap.lipSync.status,
    lipSyncLevel: cap.lipSync.source,
    eyeBlink: (cap.eyeBlink.parameters || []).join(',') || '—',
    eyeBlinkStatus: cap.eyeBlink.status,
    paramUniverse: cap.parameterUniverseCount ?? '（无 cdi3）',
    cdiMouthGroup: cap.displayInfoParameterGroups.mouthGroupParameters.join(',') || '（无「口」组）',
    hitAreas: cap.hitAreas.join(',') || '（无）',
    phaseExprStatus: cap.phaseExpression.status,
    phaseExprDetail: cap.phaseExpression.detail,
    detail: cap.lipSync.detail
  });
}

// ── Markdown 表 ──
const md = [];
md.push(`# ${models.length} 个样本的能力发现表（脚本生成，勿手改）`);
md.push('');
md.push(`生成命令：\`node scripts/run-capability.mjs\``);
md.push(`样本来源：\`Live2D/CubismWebSamples @ b1de66b0b1f1cb881d95fb6158622aeb6a2827bd\` 的 \`Samples/Resources/*/*.model3.json\``);
md.push(`样本目录：\`samples/Resources/\`（脚本按目录列举，不写死名单；\`Teacher\` 是 L2D-TRY 用 Hiyori 造的试装件，非官方样本）`);
md.push('');
md.push('| 样本 | 动作组（并集） | 动作数 | 表情数 | 表情名 | `Groups.LipSync` 声明值 | 实际取到的嘴参数 | 命中级别 | **相位→表情** | 眨眼参数 | 参数全集(cdi3) | cdi3「口」组参数 | HitAreas |');
md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  md.push(
    `| **${r.model}** | ${r.motionGroups} | ${r.motionCounts} | ${r.expressions} | ${r.expressionNames} | \`${r.lipSyncDeclared}\` | \`${r.lipSyncActual}\` | ${r.lipSyncLevel} | **${r.phaseExprStatus}** | ${r.eyeBlink} | ${r.paramUniverse} | ${r.cdiMouthGroup} | ${r.hitAreas} |`
  );
}
md.push('');
md.push('## 🔴 「相位→表情」能不能用（0 表情 = 静默失效，见每行 detail）');
md.push('');
md.push('| 样本 | 表情数 | phaseExpression.status | detail |');
md.push('|---|---|---|---|');
for (const r of rows) {
  md.push(`| **${r.model}** | ${r.expressions} | \`${r.phaseExprStatus}\` | ${r.phaseExprDetail} |`);
}
md.push('');
const byPhase = {};
for (const r of rows) byPhase[r.phaseExprStatus] = (byPhase[r.phaseExprStatus] || 0) + 1;
md.push('| phaseExpression.status | 样本数 | 含义 |');
md.push('|---|---|---|');
md.push(`| \`ok\` | ${byPhase.ok || 0} | 表情 ≥ 6，6 个相位都能各取到一个表情 |`);
md.push(`| \`partial\` | ${byPhase.partial || 0} | 表情 1–5 个，下标取模回绕，多个相位同一张脸 |`);
md.push(`| \`unavailable\` | ${byPhase.unavailable || 0} | **表情 0 个 → 相位→表情静默失效**（面板不报错、不换表情） |`);
md.push('');
md.push('## 逐样本的判定依据（detail 原文）');
md.push('');
for (const r of rows) {
  md.push(`- **${r.model}**（status=\`${r.lipSyncStatus}\`）：${r.detail}`);
}
md.push('');
md.push('## 汇总（脚本统计，非人工概括）');
const byLevel = {};
for (const r of rows) byLevel[r.lipSyncLevel] = (byLevel[r.lipSyncLevel] || 0) + 1;
const byStatus = {};
for (const r of rows) byStatus[r.lipSyncStatus] = (byStatus[r.lipSyncStatus] || 0) + 1;
const declaredForms = {};
for (const r of rows) declaredForms[r.lipSyncDeclared] = (declaredForms[r.lipSyncDeclared] || 0) + 1;
md.push('');
md.push('| 命中级别 | 样本数 |');
md.push('|---|---|');
for (const [k, v] of Object.entries(byLevel)) md.push(`| ${k} | ${v} |`);
md.push('');
md.push('| status | 样本数 |');
md.push('|---|---|');
for (const [k, v] of Object.entries(byStatus)) md.push(`| ${k} | ${v} |`);
md.push('');
md.push('| cdi3 是否提供参数语义分组 | 样本数 |');
md.push('|---|---|');
const byCdiGroups = {};
for (const m of Object.keys(full)) {
  const k = full[m].displayInfoParameterGroups.available ? '有分组' : '无分组（ParameterGroups 为空）';
  byCdiGroups[k] = (byCdiGroups[k] || 0) + 1;
}
for (const [k, v] of Object.entries(byCdiGroups)) md.push(`| ${k} | ${v} |`);
md.push('');
md.push('| `Groups.LipSync` 的原始形态 | 样本数 |');
md.push('|---|---|');
for (const [k, v] of Object.entries(declaredForms)) md.push(`| \`${k}\` | ${v} |`);
md.push('');

writeFileSync(join(EVID, 'capability_table.md'), md.join('\n'));
writeFileSync(join(EVID, 'capability_table.json'), JSON.stringify(full, null, 2));

console.log(md.join('\n'));
console.log(`\n[written] ${join(EVID, 'capability_table.md')}`);
console.log(`[written] ${join(EVID, 'capability_table.json')}`);

// 🔴 「0 表情 = 相位→表情静默失效」在**运行时段**也要出声（不能只写在表里）
const silent = rows.filter((r) => r.phaseExprStatus === 'unavailable');
const partial = rows.filter((r) => r.phaseExprStatus === 'partial');
if (silent.length > 0) {
  console.log('');
  console.log(`[warn] ${silent.length} 个样本的表达式个数 = 0 → **相位→表情将不可用（静默失效）**：${silent.map((r) => r.model).join(', ')}`);
  console.log('[warn] 面板的 applyPhase 在 expressions.length === 0 时直接 return（不报错、不换表情）。');
  console.log('[warn] 要用这些模型当教室立绘，必须先按 README「面板接线说明」把这件事显示出来，或改用有表情的模型。');
}
if (partial.length > 0) {
  console.log('');
  console.log(`[note] ${partial.length} 个样本的表情数不足 6 → 下标取模回绕（多相位同一张脸）：${partial.map((r) => `${r.model}(${r.expressions})`).join(', ')}`);
}
