/**
 * idle-director.js —— 通用 Live2D 待机/演出编排层（★本轮自研点）
 *
 * ══════════════════════════════════════════════════════════════════════
 * 先例归属（逐条分清「借什么 / 不借什么 / 哪一步无先例」）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 【借 · 官方 Cubism Web Framework R5（本地 vendored，可 grep 复现）】
 *   - 呼吸/眨眼/视线机制的语义来自官方 effect + motion updater：
 *       vendor/CubismWebFramework/src/effect/cubismbreath.ts
 *       vendor/CubismWebFramework/src/effect/cubismeyeblink.ts
 *       vendor/CubismWebFramework/src/effect/cubismlook.ts
 *       vendor/CubismWebFramework/src/motion/cubismbreathupdater.ts
 *       vendor/CubismWebFramework/src/motion/cubismeyeblinkupdater.ts   ← _motionUpdated 门控
 *       vendor/CubismWebFramework/src/motion/cubismlookupdater.ts
 *     官方 CubismEyeBlinkUpdater 只在「主动作没在更新」时才眨眼；本文件沿用同一语义（见 `{@link IdleDirector#_motionUpdated}`）。
 *
 * 【借 · airi / moeru-ai（本地 `~/折腾AI/airi`，GitHub: moeru-ai/airi）】
 *   - 可注入种子的眨眼状态机（closing/opening + 随机间隔）：
 *       packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts
 *       `useMotionUpdatePluginAutoEyeBlink` 的 `resetBlinkState` / `updateForcedBlink`
 *   - 呼吸用「余弦 inhale + 余弦 exhale + 末端 dwell」曲线：
 *       packages/stage-ui-live2d/src/stores/motion-control.ts  `sampleLive2DBreath`
 *   - 视线 saccade 间隔概率表 + 朝目标的 lerp：
 *       packages/stage-ui-live2d/src/utils/eye-motions.ts  `randomSaccadeInterval`
 *       packages/stage-ui-live2d/src/composables/live2d/animation.ts  `useLive2DIdleEyeFocus`
 *   - 嘴型「说话接管 → 收尾 cross-fade → 短暂 handoff hold 再交还动作」：
 *       motion-manager.ts  `useMotionUpdatePluginLipSync`（RELEASE/HANDOFF 两段）
 *
 * 【不借 · 显式排除】
 *   - 不借 airi 对 pixi-live2d-display / Vue reactivity / `motionManager.state.currentGroup`
 *     的强耦合——本文件**框架无关**，只认「一个能 get/set 参数的 model 句柄」+ 能力清单。
 *   - 不借 `host.js` 当前 `load()` 里写死的 Haru 默认参数名
 *     （ParamAngleX/ParamAngleY/ParamAngleZ/ParamBodyAngleX/ParamBreath），
 *     那一段是**模型特化**，与「通用」目标冲突，本文件改用 capability 发现后的句柄。
 *
 * 【无先例 · 本轮自研（别人没做过的组合）】
 *   ① **单个**「能力发现驱动 + 可注入 seed + 框架无关 + 降级明说 + write/speak 分工」的
 *      通用待机编排器——airi 的同类逻辑散落在 pixi 插件链里、且写死 Param*；
 *      官方只有「单点 effect」（呼吸 XOR 眨眼 XOR 视线，且按默认参数名）。
 *   ② 「write 通道 → 嘴闸门 + 动作压稳」：官方/airi 都没有"写字时把嘴锁死、把漂移压低"
 *      这一路（本仓 `text-rhythm-provider.js` 的 WriteChannelProvider 只管嘴 0，
 *      没管待机编排层的稳定性，故整合进本层）。
 *   ③ 把呼吸**只 additive 写到 bodyAngleX**、而不是去抢官方 `ParamBreath`——
 *      这是为避免与官方 Breath updater 抢同一个参数名（跨模型兼容性决策，非官方做法）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 接入方式
 * ══════════════════════════════════════════════════════════════════════
 *   host.js 装载完成后构造 `new IdleDirector(host, capability)`，默认开启。
 *   每帧在 `model.update()` 之后调用 `director.apply(nowMs, dtSeconds)`，它去读
 *   host 已经写好的参数并做「加法/绝对」修正：
 *     - 呼吸：additive 到 bodyAngleX（轻微重心）
 *     - 视线：additive 到 eyeBallX/Y 与 bodyAngleX（轻微视线/重心）
 *     - 眨眼：绝对写入 eyeOpen 参数（被 motion 门控；write 模式不抢）
 *     - 嘴闸门：write 模式下把 lipSync 参数压成 0 + 收尾 handoff
 */

// ────────────────────────────────────────────────────────────────
// 1. 可注入种子的确定性 RNG（mulberry32）
//    🔴 为什么必须自己带：airi 用的是 `Math.random()`，不可复现；
//       本层的每次眨眼间隔 / saccade 朝向 / 呼吸幅度抖动都要能从同一个 seed 复现，
//       否则单测与取证脚本无法断言「数值曲线一致」。
// ────────────────────────────────────────────────────────────────

/** 由 32-bit 种子生成确定性 [0,1) 序列（mulberry32）。 */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 在 [min,max) 取确定性随机值。 */
function rngRange(rng, min, max) {
  return min + rng() * (max - min);
}

// ────────────────────────────────────────────────────────────────
// 2. 默认配置（全部可调；调参只在构造函数里，不在运行时偷改）
// ────────────────────────────────────────────────────────────────

export const DEFAULT_IDLE_CONFIG = {
  /** 呼吸：是否被启用 */
  breathEnabled: true,
  /** 呼吸周期（秒） */
  breathCycleSeconds: 4.0,
  /** 呼吸 additive 注入 bodyAngleX 的幅度（度）。官方样本 bodyAngleX 范围约 ±10~20 */
  breathAmplitudeDeg: 0.6,
  /** 呼吸末端 dwell（秒）：吸/呼之间停一下，更像真呼吸 */
  breathDwellSeconds: 0.6,

  /** 眨眼：是否被启用（false = 完全交给模型自带的 EyeBlink 动作/曲线） */
  blinkEnabled: true,
  /** 两次眨眼之间的最小/最大间隔（毫秒） */
  blinkIntervalMinMs: 2800,
  blinkIntervalMaxMs: 6200,
  /** 闭眼段时长（毫秒） */
  blinkCloseMs: 75,
  /** 睁眼段时长（毫秒，随机区间内） */
  blinkOpenMinMs: 150,
  blinkOpenMaxMs: 320,
  /** 眨眼时如果眼睛已被表情压到很闭（< 阈值），跳过这次眨眼（避免与表情打架） */
  blinkSkipThreshold: 0.12,

  /** 视线：是否被启用 */
  gazeEnabled: true,
  /** 一次 saccade 之间的间隔概率表（毫秒，airi 同款形状，seedable 复现） */
  saccadeIntervalMs: [800, 1100, 1250, 1400, 1250, 1100, 1000, 900, 800, 700],
  /** 视线/重心随机偏移范围（绝对参数值；eyeBall ≈ ±1，bodyAngle ≈ ±10） */
  gazeEyeBallRange: 0.18,
  /** 重心漂移 additive 到 bodyAngleX 的范围（度） */
  gazeBodyDriftRangeDeg: 0.5,
  /** 朝目标 lerp 系数（每帧） */
  gazeLerp: 0.08,

  /**
   * write 通道的「压稳 + 嘴闸门」系数。
   *   0 = 不变（即 speak 模式，完全用默认强度）；
   *   1 = 压到几乎不动 + 嘴彻底锁定。
   * 验收里这两个值必须能从 idle 曲线的「漂移幅度」上量出来差异。
   */
  writeStabilizeBreath: 0.55, // write 时呼吸幅度降到 45%
  writeStabilizeGaze: 0.5, // write 时视线漂移降到 50%
  writeMouthGate: true, // write 时把 lipSync 参数压成 0
  /** 嘴闸门收尾 handoff：从「强制 0」交还给动作前的保持时长（毫秒，airi 同款语义） */
  mouthHandoffHoldMs: 500
};

// ────────────────────────────────────────────────────────────────
// 3. 主类
// ────────────────────────────────────────────────────────────────

export class IdleDirector {
  /**
   * @param {object} host            Live2DHost 实例（需暴露 userModel / lipSyncIds /
   *                                 _motionUpdated / readParameter 等）
   * @param {object} capability      parseCapability() 的产出（本层只用到下列字段，
   *                                 全部为**可选**，缺失即降级）：
   *                                   - eyeBlink.parameters: string[]  眨眼参数名
   *                                   - lipSync.parameters: string[]   嘴参数名
   *                                   - parameterUniverse: string[]|null  参数全集（用来校验存在性）
   * @param {object} [config]        见 DEFAULT_IDLE_CONFIG
   * @param {object} [opts]
   *   - seed {number}               随机种子（默认 1）。所有随机性都从它派生 → 测试可复现。
   *   - now {() => number}          时钟注入点（毫秒）。默认 Date.now（探针可喂假时钟）。
   */
  constructor(host, capability = {}, config = {}, opts = {}) {
    this.host = host;
    this.cap = capability || {};
    this.cfg = Object.assign({}, DEFAULT_IDLE_CONFIG, config);
    this.seed = opts.seed != null ? opts.seed >>> 0 : 1;
    this._now = opts.now || (() => Date.now());

    // 🔴 能力发现后绑定「参数存在性」——不绑具体名字，按 capability 给的句柄。
    //    同时**诚实降级**：参数全集里查不到的，明确记进 missing，绝不静默假装工作了。
    const universe = this.cap.parameterUniverse || null;
    const eyeBlinkRaw = (this.cap.eyeBlink && this.cap.eyeBlink.parameters) || [];
    const lipSyncRaw = (this.cap.lipSync && this.cap.lipSync.parameters) || [];
    this.eyeParams = eyeBlinkRaw.filter((id) => !universe || universe.includes(id));
    this.mouthParams = lipSyncRaw.filter((id) => !universe || universe.includes(id));
    // 用 capability 给的"真实参数名"；拿不到就退到常用默认名（仅当参数全集允许）
    this.bodyAngleX = pickExisting(
      universe,
      ['ParamBodyAngleX', 'PARAM_BODY_ANGLE_X', 'BodyAngleX'],
      'ParamBodyAngleX'
    );
    this.eyeBallX = pickExisting(universe, ['ParamEyeBallX', 'PARAM_EYE_BALL_X'], 'ParamEyeBallX');
    this.eyeBallY = pickExisting(universe, ['ParamEyeBallY', 'PARAM_EYE_BALL_Y'], 'ParamEyeBallY');

    this._missing = [];
    if (this.cfg.blinkEnabled && this.eyeParams.length === 0)
      this._missing.push('blink: 能力发现未给出眨眼参数（Groups.EyeBlink / 命名风格回退均无），跳过自动眨眼');
    if (this.cfg.breathEnabled && !this.bodyAngleX)
      this._missing.push('breath: 参数全集里找不到可用的 bodyAngleX，跳过呼吸注入');
    if (this.cfg.gazeEnabled && (!this.eyeBallX && !this.eyeBallY) && !this.bodyAngleX)
      this._missing.push('gaze: 找不到 eyeBall / bodyAngle 任一可用参数，跳过视线漂移');

    // 确定性随机流（每个子系统的区间从主 seed 派生，互不串扰）
    this._blinkRng = makeRng(this.seed ^ 0x9e3779b9);
    this._gazeRng = makeRng(this.seed ^ 0x85ebca6b);
    this._breathRng = makeRng(this.seed ^ 0xc2b2ae35);

    // 眨眼状态机
    this._blink = {
      phase: 'idle', // idle | closing | opening
      progress: 0,
      delayMs: this._nextBlinkDelay(),
      openMin: 1,
      openMax: 1
    };
    // 视线状态
    this._gaze = {
      targetEyeX: 0,
      targetEyeY: 0,
      targetBody: 0,
      nextSaccadeMs: this._nextSaccadeDelay()
    };
    // 呼吸相位累计（秒）
    this._breathT = 0;
    // 嘴闸门 handoff
    this._mouthHandoffMs = 0;

    this.enabled = true;
    this.mode = 'speak'; // 'speak' | 'write'（write = 嘴闸门 + 压稳）
  }

  /** 降级清单（只读；上层可据其给用户提示，不静默）。 */
  get degradation() {
    return this._missing.slice();
  }

  /** 切换 speak / write 通道。 */
  setMode(mode) {
    if (mode !== 'speak' && mode !== 'write') {
      throw new Error(`IdleDirector.setMode: 只支持 'speak' | 'write'，收到 ${mode}`);
    }
    this.mode = mode;
    return this;
  }

  // ── 呼吸曲线：余弦 inhale → cosine exhale → dwell（airi sampleLive2DBreath 的语义）──
  _breathValue() {
    const c = this.cfg;
    const cycle = c.breathCycleSeconds;
    const dwell = c.breathDwellSeconds;
    const repeat = cycle + dwell;
    const t = this._breathT % repeat;
    if (t >= cycle) return 0; // dwell：回到基线
    const phase = t / cycle;
    // 半周期余弦：0→1→0，平滑无突变
    return (1 - Math.cos(2 * Math.PI * phase)) / 2;
  }

  _nextBlinkDelay() {
    return rngRange(this._blinkRng, this.cfg.blinkIntervalMinMs, this.cfg.blinkIntervalMaxMs);
  }

  _nextSaccadeDelay() {
    const arr = this.cfg.saccadeIntervalMs;
    const r = this._gazeRng();
    const idx = Math.min(arr.length - 1, Math.floor(r * arr.length));
    return arr[idx] + this._gazeRng() * 200; // 同 airi：区间 + 抖动
  }

  /**
   * 每帧应用（在 `model.update()` 之后调用）。
   * @param {number} nowMs    当前时刻（毫秒）
   * @param {number} dtSec    距上一帧的秒数
   * @returns {object} 本帧各分量的写入摘要（取证/单测直接读它）
   */
  apply(nowMs, dtSec) {
    if (!this.enabled || dtSec <= 0) {
      return { skipped: !this.enabled };
    }
    const model = this.host.userModel && this.host.userModel.getModel();
    if (!model) return { skipped: 'no-model' };

    // write 模式把压稳系数取出来（1 = 完全不压，0 = 压到底）
    const stab = this.mode === 'write' ? 1 - this.cfg.writeStabilizeBreath : 1;
    const stabGaze = this.mode === 'write' ? 1 - this.cfg.writeStabilizeGaze : 1;
    const writing = this.mode === 'write';

    const summary = {
      mode: this.mode,
      breath: 0,
      blink: null,
      gazeEyeX: 0,
      gazeEyeY: 0,
      gazeBody: 0,
      mouthGated: false
    };

    // 🔴 帧自洽写法：所有分量都相对"进入本层时参数的当前值（baseline）"改写为
    //    `baseline + 贡献`，而不是一路 addParameterValueById 累积。
    //    这样无论宿主有没有 loadParameters() 复位，都不会跨帧累加（更稳、可单测）。
    //    官方 scheduler 已把动作/表情/lipsync 写进 baseline，本层在其之上叠加/修正。

    // ── 呼吸（additive 到 bodyAngleX；不碰 ParamBreath 名称）────────────
    if (this.cfg.breathEnabled && this.bodyAngleX) {
      this._breathT += dtSec;
      // 每周期幅度抖动（确定性，从 seed 派生）：让呼吸"不是机械正弦"
      const ampJitter = 0.85 + this._breathRng() * 0.3;
      const v = this._breathValue() * this.cfg.breathAmplitudeDeg * ampJitter * stab;
      const base = model.getParameterValueById(this.bodyAngleX);
      model.setParameterValueById(this.bodyAngleX, base + v);
      summary.breath = +v.toFixed(4);
    }

    // ── 视线/重心（轻微；eyeBall 用 lerp，body 用 baseline 叠修正）────────
    if (this.cfg.gazeEnabled && (this.eyeBallX || this.eyeBallY || this.bodyAngleX)) {
      // 到点就挑一个新的 saccade 目标
      if (nowMs >= this._gaze.nextSaccadeMs) {
        this._gaze.targetEyeX = rngRange(this._gazeRng, -1, 1) * this.cfg.gazeEyeBallRange;
        this._gaze.targetEyeY = rngRange(this._gazeRng, -1, 0.7) * this.cfg.gazeEyeBallRange;
        this._gaze.targetBody = rngRange(this._gazeRng, -1, 1) * this.cfg.gazeBodyDriftRangeDeg;
        this._gaze.nextSaccadeMs = nowMs + this._nextSaccadeDelay();
      }
      const k = Math.min(1, this.cfg.gazeLerp * (dtSec * 60)); // 帧率归一
      if (this.eyeBallX) {
        const cur = model.getParameterValueById(this.eyeBallX);
        const nv = cur + (this._gaze.targetEyeX - cur) * k * stabGaze;
        model.setParameterValueById(this.eyeBallX, nv);
        summary.gazeEyeX = +nv.toFixed(4);
      }
      if (this.eyeBallY) {
        const cur = model.getParameterValueById(this.eyeBallY);
        const nv = cur + (this._gaze.targetEyeY - cur) * k * stabGaze;
        model.setParameterValueById(this.eyeBallY, nv);
        summary.gazeEyeY = +nv.toFixed(4);
      }
      if (this.bodyAngleX) {
        const base = model.getParameterValueById(this.bodyAngleX);
        const target = this._gaze.targetBody * stabGaze;
        const nv = base + (target - base) * k;
        model.setParameterValueById(this.bodyAngleX, nv);
        summary.gazeBody = +(nv - base).toFixed(4);
      }
    }

    // ── 眨眼（绝对写入；被 motion 门控，且与表情阈值互斥）──────────────
    // 🔴 沿用官方 CubismEyeBlinkUpdater 的语义：`_motionUpdated` 为真时不动眼
    //    （正在播动作，动作自己管眼），避免双重驱动把眼睛抽帧。
    const motionActive = !!(this.host._motionUpdated || (this.host.userModel && this.host.userModel._motionUpdated));
    if (this.cfg.blinkEnabled && this.eyeParams.length > 0 && !motionActive) {
      summary.blink = this._stepBlink(model, dtSec * 1000);
    }

    // ── 嘴闸门（write 模式：锁 0 + 收尾 handoff）──────────────────────
    if (writing && this.cfg.writeMouthGate && this.mouthParams.length > 0) {
      const am = this.host._lipSyncUpdater ? this.host._lipSyncUpdater._audioProvider : null;
      const speaking = am && typeof am.getParameter === 'function' && am.getParameter() > 0;
      if (!speaking) {
        for (const id of this.mouthParams) model.setParameterValueById(id, 0);
        this._mouthHandoffMs = this.cfg.mouthHandoffHoldMs;
        summary.mouthGated = true;
      }
    } else if (this._mouthHandoffMs > 0) {
      // handoff：说话结束后的短暂保持，再交还动作（airi RELEASE/HANDOFF 语义）
      this._mouthHandoffMs = Math.max(0, this._mouthHandoffMs - dtSec * 1000);
      if (this.mouthParams.length > 0) {
        for (const id of this.mouthParams) model.setParameterValueById(id, 0);
        summary.mouthGated = true;
      }
    }

    return summary;
  }

  /** 眨眼状态机推进（绝对写 eyeOpen，返回本次写出的开合度 1=睁 0=闭）。 */
  _stepBlink(model, dtMs) {
    const b = this._blink;
    const c = this.cfg;
    const easeOut = (t) => 1 - (1 - t) * (1 - t);
    const easeIn = (t) => t * t;

    if (b.phase === 'idle') {
      b.delayMs -= dtMs;
      if (b.delayMs <= 0) {
        // 若眼睛已被表情压得很闭，跳过这次眨眼
        const cur = this.eyeParams.map((id) => model.getParameterValueById(id));
        if (cur.some((v) => v < c.blinkSkipThreshold)) {
          b.delayMs = this._nextBlinkDelay();
          return cur[0] ?? 1;
        }
        b.phase = 'closing';
        b.progress = 0;
        b.openMin = cur[0] ?? 1;
        b.openMax = cur[cur.length - 1] ?? 1;
      }
      return b.openMin;
    }
    if (b.phase === 'closing') {
      b.progress = Math.min(1, b.progress + dtMs / c.blinkCloseMs);
      const e = easeOut(b.progress);
      const v = b.openMin * (1 - e);
      this._writeEyes(model, v);
      if (b.progress >= 1) {
        b.phase = 'opening';
        b.progress = 0;
        b._openDur = rngRange(this._blinkRng, c.blinkOpenMinMs, c.blinkOpenMaxMs);
      }
      return v;
    }
    // opening
    b.progress = Math.min(1, b.progress + dtMs / (b._openDur || c.blinkOpenMinMs));
    const e = easeIn(b.progress);
    const v = b.openMin * e + (1 - e) * 0; // 从 0 回到 base（base 记在 openMin）
    this._writeEyes(model, v);
    if (b.progress >= 1) {
      b.phase = 'idle';
      b.delayMs = this._nextBlinkDelay();
    }
    return v;
  }

  _writeEyes(model, openValue) {
    const v = Math.max(0, Math.min(1, openValue));
    for (const id of this.eyeParams) model.setParameterValueById(id, v);
  }

  /** 诊断快照（取证脚本直接读）。 */
  stats() {
    return {
      mode: this.mode,
      seed: this.seed,
      enabled: this.enabled,
      degradation: this.degradation,
      bound: {
        eyeParams: this.eyeParams.slice(),
        mouthParams: this.mouthParams.slice(),
        bodyAngleX: this.bodyAngleX,
        eyeBallX: this.eyeBallX,
        eyeBallY: this.eyeBallY
      },
      blinkPhase: this._blink.phase,
      gazeTarget: {
        eyeX: +this._gaze.targetEyeX.toFixed(3),
        eyeY: +this._gaze.targetEyeY.toFixed(3),
        body: +this._gaze.targetBody.toFixed(3)
      }
    };
  }
}

// ────────────────────────────────────────────────────────────────
// 工具
// ────────────────────────────────────────────────────────────────

/**
 * 从候选参数名里挑一个「确实存在于参数全集」的；拿不到 universe 就返回 fallback。
 * 🔴 关键：不假设任何具体模型名，先在 capability 给的全集里查，查不到就降级（返回 null）。
 */
function pickExisting(universe, candidates, fallback) {
  if (universe && Array.isArray(universe)) {
    const hit = candidates.find((c) => universe.includes(c));
    return hit || null;
  }
  return fallback; // 无 universe：信任 fallback 名（运行时由 Cubism 忽略不存在的写）
}
