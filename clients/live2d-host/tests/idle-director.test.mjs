/**
 * idle-director.test.mjs —— 通用待机编排层单测（零依赖，纯 Node 可跑）
 *
 * 覆盖任务书要求的「可注入 seed 复现」「能力发现驱动（不绑 Haru 参数名）」
 * 「缺失参数明说降级」「write/speak 分工 + 嘴闸门」四项。
 *
 * 运行：node clients/live2d-host/tests/idle-director.test.mjs
 * 冻结帧：用注入的假时钟 + 假 model（记录每次 setParameterValueById），断言数值不靠看图。
 */

import { IdleDirector, makeRng, DEFAULT_IDLE_CONFIG } from '../src/idle-director.js';
import assert from 'node:assert';

// ── 假 model：把参数写进一个普通对象，记录每次 set/add ──────────────
function makeFakeModel(knownParams) {
  const store = {};
  for (const p of knownParams) store[p] = 0;
  const writes = [];
  return {
    store,
    writes,
    getParameterValueById(id) {
      return store[id] ?? 0;
    },
    setParameterValueById(id, v) {
      store[id] = Math.max(-100, Math.min(100, v));
      writes.push({ id, v: store[id], mode: 'set' });
    },
    addParameterValueById(id, v, weight = 1) {
      store[id] = (store[id] ?? 0) + v * weight;
      writes.push({ id, v: store[id], mode: 'add' });
    }
  };
}

// ── 假 host：只暴露 director 需要的东西 ───────────────────────────
function makeFakeHost(knownParams, { motionActive = false } = {}) {
  const model = makeFakeModel(knownParams);
  return {
    userModel: {
      getModel: () => model,
      _motionUpdated: motionActive
    },
    // 没有 lipSync updater：嘴闸门分支走不到 speaking 判定，write 模式应直接锁 0
    _lipSyncUpdater: null,
    _motionUpdated: motionActive,
    __model: model
  };
}

// ── 一个"通用模型"的参数全集（故意不用 Haru 默认名，验证不绑死）────
const UNIVERSE = [
  'PARAM_BODY_ANGLE_X', // 呼吸/重心注入目标
  'PARAM_EYE_BALL_X',
  'PARAM_EYE_BALL_Y',
  'PARAM_EYE_L_OPEN',
  'PARAM_EYE_R_OPEN',
  'PARAM_MOUTH_OPEN_Y'
];
const CAP = {
  parameterUniverse: UNIVERSE,
  eyeBlink: { parameters: ['PARAM_EYE_L_OPEN', 'PARAM_EYE_R_OPEN'] },
  lipSync: { parameters: ['PARAM_MOUTH_OPEN_Y'] }
};

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n      ${e.message}`);
  }
}

console.log('[idle-director] 单测开始');

// ── 1. 可注入 seed：同 seed 同曲线，异 seed 不同 ──────────────────
test('seed 可复现：相同 seed → 完全相同的眨眼间隔序列', () => {
  const a = new IdleDirector(makeFakeHost(UNIVERSE), CAP, {}, { seed: 12345, now: () => 0 });
  const b = new IdleDirector(makeFakeHost(UNIVERSE), CAP, {}, { seed: 12345, now: () => 0 });
  // 触发多次 blink 调度，收集延迟序列
  const seqA = [];
  const seqB = [];
  for (let i = 0; i < 5; i++) {
    // 直接调内部 nextBlinkDelay 的等价路径：跑时间推进让 blink 发生
    a._blink.delayMs = 0; // 强制到点
    a.apply(0, 0.001);
    seqA.push(a._blink.delayMs);
    b._blink.delayMs = 0;
    b.apply(0, 0.001);
    seqB.push(b._blink.delayMs);
  }
  assert.deepStrictEqual(seqA, seqB, '相同 seed 应产生相同序列');
});

test('seed 可复现：不同 seed → 眨眼间隔序列不同', () => {
  const a = new IdleDirector(makeFakeHost(UNIVERSE), CAP, {}, { seed: 111, now: () => 0 });
  const b = new IdleDirector(makeFakeHost(UNIVERSE), CAP, {}, { seed: 222, now: () => 0 });
  const seqA = [];
  const seqB = [];
  for (let i = 0; i < 6; i++) {
    a._blink.delayMs = 0;
    a.apply(0, 0.001);
    seqA.push(Math.round(a._blink.delayMs));
    b._blink.delayMs = 0;
    b.apply(0, 0.001);
    seqB.push(Math.round(b._blink.delayMs));
  }
  // 不是"必然全不同"，但 6 个里至少应有一个不同（确定性但 seed 敏感）
  assert.notDeepStrictEqual(seqA, seqB, '不同 seed 应产生不同序列');
});

// ── 2. 能力发现驱动：不绑 Haru 参数名 ──────────────────────────────
test('不绑 Haru 默认名：用 PARAM_* 形态也能绑定呼吸/眨眼/视线', () => {
  const d = new IdleDirector(makeFakeHost(UNIVERSE), CAP, {}, { seed: 7, now: () => 0 });
  assert.strictEqual(d.bodyAngleX, 'PARAM_BODY_ANGLE_X');
  assert.strictEqual(d.eyeBallX, 'PARAM_EYE_BALL_X');
  assert.deepStrictEqual(d.eyeParams, ['PARAM_EYE_L_OPEN', 'PARAM_EYE_R_OPEN']);
  assert.strictEqual(d.degradation.length, 0, '参数齐全时不应有降级');
});

test('能力发现缺失 → 明说降级，不静默', () => {
  // 给一个"零参数"的能力清单：没有任何 eye/body/eyeBall/mouth
  const emptyCap = { parameterUniverse: ['ParamAngleX'], eyeBlink: { parameters: [] }, lipSync: { parameters: [] } };
  const d = new IdleDirector(makeFakeHost(['ParamAngleX']), emptyCap, {}, { seed: 1, now: () => 0 });
  // 三项都该被记录进 degradation（呼吸/眨眼/视线都找不到可用参数）
  assert.ok(d.degradation.length >= 1, '应至少报一条降级原因');
  assert.ok(d.degradation.some((s) => s.includes('blink')), '应明确报"眨眼参数缺失"');
  // 应用不应抛错
  d.apply(0, 0.016);
});

// ── 3. 呼吸：静置 N 秒应产生非零摆动且不过度漂移 ─────────────────
test('呼吸生命感：10 秒内 bodyAngleX 有起伏且幅度受控', () => {
  const host = makeFakeHost(UNIVERSE);
  const d = new IdleDirector(host, CAP, { breathAmplitudeDeg: 0.6 }, { seed: 42, now: () => 0 });
  const vals = [];
  let t = 0;
  const dt = 1 / 30;
  for (let i = 0; i < 300; i++) {
    t += dt * 1000;
    // 🔴 模拟真实宿主：每帧 model.update() 会把参数复位到"已保存休息姿态"，
    //    导演的呼吸贡献是在该基线上 additive，不会跨帧累加。
    host.__model.store['PARAM_BODY_ANGLE_X'] = 0;
    d.apply(t, dt);
    vals.push(host.__model.store['PARAM_BODY_ANGLE_X']);
  }
  const nonZero = vals.filter((v) => Math.abs(v) > 1e-4).length;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min;
  assert.ok(nonZero > 100, `应有明显比例的呼吸摆动，实际 ${nonZero}/300`);
  assert.ok(range > 0.05, `呼吸幅度过小（无生命感）range=${range}`);
  assert.ok(range < 1.5, `呼吸幅度过大（过度漂移）range=${range}`);
});

// ── 4. 眨眼：应在合理时间内发生，且 eyeOpen 会降到接近 0 ─────────────
test('非机械眨眼：10 秒内至少眨眼 1 次，且眼睛有闭的动作', () => {
  const host = makeFakeHost(UNIVERSE);
  const d = new IdleDirector(host, CAP, { blinkIntervalMinMs: 1500, blinkIntervalMaxMs: 3000 }, { seed: 9, now: () => 0 });
  const eyeVals = [];
  let t = 0;
  const dt = 1 / 30;
  for (let i = 0; i < 300; i++) {
    t += dt * 1000;
    d.apply(t, dt);
    eyeVals.push(host.__model.store['PARAM_EYE_L_OPEN']);
  }
  const minOpen = Math.min(...eyeVals);
  assert.ok(minOpen < 0.1, `眨眼应把眼睛闭到接近 0，实际最小=${minOpen}`);
});

// ── 5. write/speak 分工 + 嘴闸门 ───────────────────────────────────
test('speak 模式：嘴闸门不接管（信任 lipSync provider 控制嘴）', () => {
  const host = makeFakeHost(UNIVERSE);
  const d = new IdleDirector(host, CAP, {}, { seed: 3, now: () => 0 });
  d.setMode('speak');
  // 先模拟"说话残留嘴型"
  host.__model.store['PARAM_MOUTH_OPEN_Y'] = 0.8;
  const s = d.apply(1000, 1 / 30);
  // speak 模式且没在播动作、没 handoff → 导演不应把嘴压成 0，也不应标记 mouthGated
  assert.strictEqual(s.mouthGated, false, 'speak 模式导演不应锁嘴');
  assert.strictEqual(host.__model.store['PARAM_MOUTH_OPEN_Y'], 0.8, 'speak 模式嘴应由 provider 控制，导演不锁 0');
});

test('write 模式：嘴闸门恒锁 0（writeMouthGate 生效）', () => {
  const host = makeFakeHost(UNIVERSE);
  const d = new IdleDirector(host, CAP, {}, { seed: 3, now: () => 0 });
  d.setMode('write');
  // 先把嘴弄开（模拟上一帧说话残留）
  host.__model.store['PARAM_MOUTH_OPEN_Y'] = 0.8;
  for (let i = 0; i < 10; i++) d.apply(1000 + i * 33, 1 / 30);
  assert.strictEqual(host.__model.store['PARAM_MOUTH_OPEN_Y'], 0, 'write 模式嘴必须恒为 0');
});

test('write 模式压稳：呼吸幅度显著小于 speak 模式', () => {
  function breatheRange(mode) {
    const host = makeFakeHost(UNIVERSE);
    const d = new IdleDirector(host, CAP, { breathAmplitudeDeg: 0.6, writeStabilizeBreath: 0.55 }, { seed: 5, now: () => 0 });
    d.setMode(mode);
    const vals = [];
    let t = 0;
    const dt = 1 / 30;
    for (let i = 0; i < 300; i++) {
      t += dt * 1000;
      d.apply(t, dt);
      vals.push(host.__model.store['PARAM_BODY_ANGLE_X']);
    }
    return Math.max(...vals) - Math.min(...vals);
  }
  const speakRange = breatheRange('speak');
  const writeRange = breatheRange('write');
  assert.ok(writeRange < speakRange, `write 应比 speak 更稳：${writeRange} < ${speakRange}`);
});

// ── 6. 视线漂移：eyeBall 应有轻微移动非零 ──────────────────────────
test('轻微视线：eyeBallX 静置期间偏离基线（非完全静止）', () => {
  const host = makeFakeHost(UNIVERSE);
  const d = new IdleDirector(host, CAP, {}, { seed: 11, now: () => 0 });
  const vals = [];
  let t = 0;
  const dt = 1 / 30;
  for (let i = 0; i < 300; i++) {
    t += dt * 1000;
    d.apply(t, dt);
    vals.push(host.__model.store['PARAM_EYE_BALL_X']);
  }
  const range = Math.max(...vals) - Math.min(...vals);
  assert.ok(range > 0.001, `视线应有轻微漂移 range=${range}`);
  assert.ok(range < 0.5, `视线漂移应轻微，不应大幅 range=${range}`);
});

console.log(`\n[idle-director] 通过 ${passed} / 失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
