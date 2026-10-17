/**
 * text-rhythm-provider.js —— 用「文字节奏」驱动嘴型（★本轮自研点）
 *
 * ══ 为什么可以这么做（先例归属，逐条分清）══
 *  ✅ **接口是官方的**：官方 Cubism Web Framework R5 定义了
 *     `IParameterProvider`，只有两个抽象方法：
 *         update(deltaTimeSeconds?) → boolean
 *         getParameter() → number
 *     出处（本地 vendored 源码，可 grep 复现）：
 *       vendor/CubismWebFramework/src/motion/iparameterprovider.ts
 *     官方 `CubismLipSyncUpdater` **只依赖这个接口**：
 *       vendor/CubismWebFramework/src/motion/cubismlipsyncupdater.ts
 *     官方唯一的实现类是音频（sample 的 `LAppWavFileHandler.getParameter() → getRms()`）。
 *  🔴 **「用文本节奏而不是音频喂给它」这个实现没有先例**：
 *     同行两个大仓库（airi / Open-LLM-VTuber）都只做音频驱动（研究_8 §1.4 逐字取证）。
 *     → 本文件即该自研点。
 *
 * ══ 输出语义 ══
 *   `getParameter()` 返回 [0, 1] 的**嘴开合量**，直接对应模型的 LipSync 参数
 *   （通常是 `ParamMouthOpenY`；具体名字由 capability.js 三级回退给出）。
 *   官方 `CubismLipSyncUpdater.onLateUpdate` 用 **加性**写入（`addParameterValueById`），
 *   故返回值会被叠加到状态层已写的值上；官方参数自带 min/max，越界会被 clamp。
 *
 * ══ 算法（三档，本文件实现档 1 + 档 2）══
 *   档 1 · 字符节奏：每收到一个文本增量 chunk → target = min(1, 字符数 / charsPerTick)
 *                    每帧 value 按 τ 指数衰减（断续感就来自「冲高 + 衰减」）
 *   档 2 · 句读节奏：遇到标点 → 强制闭嘴（value 直接归 0），并保持一小段静默
 *   档 3 · 音素近似：**明确不做**（研究_8 §4.2 已裁定：无音频时无人校验，成本高收益低）
 */

/**
 * 官方接口的**形状副本**（不 import 官方模块）。
 *
 * 为什么要副本而不是直接 extends 官方那个类：
 *   官方 `IParameterProvider` 是零实现的抽象基类，官方 `CubismLipSyncUpdater`
 *   对它**只做鸭子类型调用**（`provider.update(dt)` / `provider.getParameter()`），
 *   没有 `instanceof` 检查。所以继承与否在运行时完全等价。
 *   而本文件被「纯 Node 的取证脚本」直接 import（那里没有 `@framework` 别名），
 *   一旦 import 官方模块就会连带整棵框架树 → 直接跑不起来。
 *   → 取一个零依赖的形状副本，让 provider 能独立在 Node 与浏览器两侧跑。
 *
 * 官方原文（本地 vendored，可 grep 复现）：
 *   vendor/CubismWebFramework/src/motion/iparameterprovider.ts
 *     export abstract class IParameterProvider {
 *       abstract update(deltaTimeSeconds?: number): boolean;
 *       abstract getParameter(): number;
 *     }
 * 官方消费者（只依赖上面两个方法）：
 *   vendor/CubismWebFramework/src/motion/cubismlipsyncupdater.ts
 */
export class IParameterProvider {
  update(deltaTimeSeconds) {
    throw new Error('IParameterProvider.update() 是抽象方法');
  }
  getParameter() {
    throw new Error('IParameterProvider.getParameter() 是抽象方法');
  }
}

/**
 * 默认参数（全部可调；调参只在构造函数里，不在运行时偷改）。
 *
 * 🔴 与「研究_8 §4.2 档 1」的差异，以及为什么改（实测驱动的修正，别照着旧公式写）：
 *   研究里的档 1 写的是 `target = min(1, n / CHARS_PER_TICK)`、`CHARS_PER_TICK ≈ 3`。
 *   实测发现它把「幅度」和「速率」混在了一个常数里，结果是：
 *     一个 chunk 只带 1 个字 → target = 1/3 ≈ 0.33，`getParameter() = value * AMPLITUDE`
 *     还要再乘 0.6 → 实际只到 0.2；而 τ=0.1 s 的衰减在 80 ms 后就把它打到 0.09 → 吸附到 0。
 *     → 曲线变成「0.2 → 0」的方形脉冲，**没有起伏、看不到节奏**（实测 CSV 可复现）。
 *   本实现把两个量分开：
 *     ① `charsPerTick` 改为「**一个 chunk 多少字算打满幅度**」（幅度归一化基准，默认 6）；
 *     ② 幅度只用 `amplitude` 一次；
 *     ③ 加 `holdMs`：一次冲高后先保持一小段（默认 90 ms）再开始衰减，
 *        这样「断续」来自 hold 之后的衰减，而不是靠把峰值压到噪声以下。
 *   改完的实测曲线见 `evidence/rhythm_report_*.md`。
 */
export const DEFAULT_RHYTHM_CONFIG = {
  /** 一个 text-delta chunk 里多少字算「打满幅度」（幅度归一化基准，不是速率） */
  charsPerTick: 3,
  /** 衰减时间常数（秒）。越大越黏，越小越断续 */
  decayTau: 0.25,
  /** 幅度上限（对应 LipSync 参数的值域上限） */
  amplitude: 0.6,
  /** 冲高后先保持多久再开始衰减（毫秒）。这就是「卡、断续」的来源 */
  holdMs: 60,
  /** 单次冲高的上限（防「一次吐 50 字符 → 嘴大张一下」） */
  maxValue: 1.0,
  /** 值低于这个数就吸附到 0（避免浮点残留一直有个小开口） */
  zeroEpsilon: 0.005,
  /** 标点后的强制闭嘴时长（秒） */
  punctuationPause: 0.18,
  /** 哪些字符算「句读」 */
  punctuation: '。！？；：，、,.!?;:…—',
  /**
   * 逐 chunk 的幅度抖动（0 = 不抖）。默认 0.3 表示每个 chunk 的目标值再乘
   * 一个落在 [1-jitter, 1] 的确定性随机系数。
   * 为什么需要它：没有抖动时，同样字数的 chunk 给出完全相同的目标值，
   * 曲线会退化成「重复的两三个数」；加了抖动才有「音节长短不一」的形状。
   * 实现是**确定性**的（对 chunk 内容做哈希），所以仍然可复现。
   */
  jitter: 0.3,
  /** 情绪/强调时的幅度倍率（**本轮只给常量**，标定留给下一批） */
  emphasisGain: 1.0,
  /** 情绪/强调时的衰减倍率（>1 表示更快回落） */
  emphasisDecayGain: 1.0
};

/**
 * 说话通道：文字节奏 → 嘴型参数。
 * 实现官方 `IParameterProvider`。
 */
export class TextRhythmProvider extends IParameterProvider {
  /**
   * @param {object} [config] 见 DEFAULT_RHYTHM_CONFIG
   * @param {object} [opts]
   *   - now {() => number} 时钟注入点（毫秒）。默认 performance.now / Date.now
   *     注入是为了「确定性可复现」：验证脚本可喂一个假时钟，产出完全一致的曲线。
   */
  constructor(config = {}, opts = {}) {
    super();
    this.cfg = Object.assign({}, DEFAULT_RHYTHM_CONFIG, config);
    this._now =
      opts.now ||
      (typeof performance !== 'undefined' && performance.now
        ? () => performance.now()
        : () => Date.now());

    this.value = 0; // 当前嘴开合量 [0, amplitude]
    this._holdUntilMs = 0; // 本次冲高的保持截止时刻
    this._pauseUntilMs = 0; // 标点闭嘴持续到这个时刻
    this._emphasis = 1.0; // 当前强调倍率
    this._lastDeltaChars = 0;
    this._deltaCount = 0;
    this._punctCount = 0;
    /** 事件日志：喂进去的每个 chunk 与产生的效果（验证脚本直接读它） */
    this.log = [];
  }

  // ── 官方接口 1/2：update(dt) → boolean ────────────────────────
  /**
   * 推进一帧。
   * @param {number} [deltaTimeSeconds] 帧间隔（秒）；缺省时用注入的时钟自算
   * @returns {boolean} true = 本次更新成功（官方 CubismLipSyncUpdater 只在这时才取参数）
   */
  update(deltaTimeSeconds) {
    const now = this._now();
    let dt = deltaTimeSeconds;
    if (dt === undefined || dt === null) {
      dt = this._lastTickMs == null ? 0 : (now - this._lastTickMs) / 1000;
    }
    this._lastTickMs = now;
    if (!(dt > 0)) return true; // dt 为 0 时不动，但仍算成功

    // 标点闭嘴窗口内：直接 0，且不衰减（保持住「停」）
    if (now < this._pauseUntilMs) {
      this.value = 0;
      return true;
    }

    // 冲高后的保持窗口内：不衰减（让「张一下」在视觉上成立，而不是一闪而过）
    if (now < this._holdUntilMs) {
      return true;
    }

    // 指数衰减：value *= exp(-dt / τ)
    const tau = this.cfg.decayTau / Math.max(1e-6, this._emphasis * this.cfg.emphasisDecayGain);
    this.value = this.value * Math.exp(-dt / tau);
    if (this.value < this.cfg.zeroEpsilon) this.value = 0;
    return true;
  }

  // ── 官方接口 2/2：getParameter() → number ────────────────────
  /** @returns {number} 嘴开合量，值域 [0, 1]（实际上限 = amplitude） */
  getParameter() {
    return this.value;
  }

  // ── 我们的输入口：喂文字增量 ─────────────────────────────────

  /**
   * 喂一个文本增量（对应 DSH 流式输出的 text-delta chunk）。
   * @param {string} chunk 增量文本
   */
  pushText(chunk) {
    if (!chunk) return this;
    const now = this._now();
    const punctRe = new RegExp(`[${escapeForCharClass(this.cfg.punctuation)}]`);
    const puncts = (chunk.match(new RegExp(punctRe.source, 'g')) || []).length;

    // 计「实际发音字符」= 总长 - 标点 - 空白
    const speakable = chunk.replace(punctRe, '').replace(/\s/g, '').length;

    this._deltaCount++;
    this._lastDeltaChars = speakable;
    this.log.push({ t: now, kind: 'text', chunk, chars: speakable, puncts });

    if (puncts > 0) {
      // 档 2：句读 → 闭嘴，并保持一段静默
      this._punctCount++;
      this.value = 0;
      this._pauseUntilMs = now + this.cfg.punctuationPause * 1000;
      this._holdUntilMs = 0;
      this.log.push({ t: now, kind: 'pause', ms: this.cfg.punctuationPause * 1000, chunk });
      return this;
    }

    if (speakable === 0) return this; // 纯空白，不驱动

    // 档 1：冲高。
    //   charsPerTick = 「多少字算打满幅度」的归一化基准；
    //   归一化用**平方根**而不是线性 —— 因为一个 chunk 的字数在 1..50 之间跨两个数量级，
    //   线性映射会把「1 个字」压到 1/6 ≈ 0.17（再乘 amplitude 就只剩 0.1），
    //   小 chunk 就永远推不动嘴（实测：逐字喂时 43 个采样里只有 16 个非零、且只有 2 种取值）。
    //   平方根把 1 个字抬到 √(1/6) ≈ 0.41，大 chunk 仍受 maxValue 与 amplitude 双重封顶。
    const gain = this.cfg.emphasisGain * this._emphasis;
    const norm = Math.min(1, Math.sqrt(Math.max(0, speakable) / this.cfg.charsPerTick));
    // 逐 chunk 抖动（确定性：同样的 chunk 内容 → 同样的系数，便于复现）
    const j = 1 - this.cfg.jitter * hash01(chunk);
    const target = Math.min(this.cfg.maxValue, norm * this.cfg.amplitude * gain * j);
    // 冲高 = 取大（避免连续小 chunk 把嘴越压越小）
    this.value = Math.max(this.value, target);
    this._holdUntilMs = now + this.cfg.holdMs;
    this.log.push({ t: now, kind: 'open', target, value: this.value, chunk, jitter: +j.toFixed(3) });
    return this;
  }

  /**
   * 情绪/强调 → 只改幅度参数（**本轮是常量，不做标定**）。
   * @param {number} gain 幅度倍率
   * @param {number} [decayGain] 衰减倍率
   */
  setEmphasis(gain = 1.0, decayGain = 1.0) {
    this._emphasis = gain;
    this.cfg.emphasisDecayGain = decayGain;
    return this;
  }

  /** 立刻闭嘴（例如回合被打断） */
  silence() {
    this.value = 0;
    this._pauseUntilMs = 0;
    return this;
  }

  /** 诊断快照 */
  stats() {
    return {
      channel: 'speak',
      value: this.value,
      deltas: this._deltaCount,
      punctuations: this._punctCount,
      amplitude: this.cfg.amplitude,
      decayTau: this.cfg.decayTau,
      charsPerTick: this.cfg.charsPerTick,
      holdMs: this.cfg.holdMs,
      punctuationPause: this.cfg.punctuationPause
    };
  }
}

/**
 * 写字通道：`getParameter()` 恒返回 0 —— **嘴不动**。
 *
 * 这是教室设定「她说话卡、写字流畅」的落点：
 *   - `speak` → 嘴型走 TextRhythmProvider（冲高 + 衰减 + 标点停顿 = 视觉上「卡、断续」）
 *   - `write` → 嘴走本类（恒 0 = 不动），而「流畅」由白板打字机效果承担（不走 Live2D）
 * 两条通道的视觉对比本身就是人物辨识特征（研究_8 §4.2 / §5.3）。
 *
 * 接口与说话通道**完全相同**（同一个 `IParameterProvider`），
 * 因此上层只需换一个 provider 实例，不需要改渲染代码。
 */
export class WriteChannelProvider extends IParameterProvider {
  constructor(opts = {}) {
    super();
    this._updates = 0;
    this._pushedChars = 0;
    this._now = opts.now || (() => Date.now());
  }

  /** 官方接口 1：写字通道不需要推进任何值，恒成功 */
  update(deltaTimeSeconds) {
    this._updates++;
    return true;
  }

  /** 官方接口 2：**恒 0** —— 嘴不动 */
  getParameter() {
    return 0;
  }

  /** 仍然接受文字（用于统计/未来给白板用），但不产生任何嘴部值 */
  pushText(chunk) {
    if (chunk) this._pushedChars += chunk.length;
    return this;
  }

  stats() {
    return {
      channel: 'write',
      value: 0,
      updates: this._updates,
      pushedChars: this._pushedChars,
      note: '恒 0：嘴不动。「写字流畅」由白板打字机效果承担，不经 Live2D'
    };
  }
}

/** 便捷：按 channel 名造 provider */
export function createProvider(channel, config = {}, opts = {}) {
  if (channel === 'write') return new WriteChannelProvider(opts);
  if (channel === 'speak') return new TextRhythmProvider(config, opts);
  throw new Error(`未知 channel: ${channel}（只支持 'speak' | 'write'）`);
}

/**
 * 把字符串确定性地映射到 [0, 1)。
 * 用 FNV-1a 的简化版：同样的 chunk 内容永远得到同样的抖动系数 → 曲线可复现。
 */
function hash01(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h / 4294967296;
}

function escapeForCharClass(s) {
  return s.replace(/[\\\]^-]/g, (m) => '\\' + m);
}
