/**
 * host.js —— Live2D 立绘渲染宿主（独立模块）
 *
 * 设计目标（L2D-M1 验收项 ①）：
 *   **给定一个 canvas 与一个 model3.json 路径，就能渲染出一帧。**
 *   本文件不依赖任何页面结构、不引用页面 DOM（只使用传入的 canvas），
 *   以便下一步整体挂进 DSH 客户端插件的右侧面板。
 *
 * 渲染管线完全沿用官方 Cubism Web Framework R5 的官方顺序：
 *   model.loadParameters() → Motion 更新 → model.saveParameters()
 *   → CubismUpdateScheduler.onLateUpdate()（按官方 CubismUpdateOrder 排序）
 *   → model.update() → renderer.drawModel()
 *
 * 官方出处（本地 vendored 源码，可 grep 复现）：
 *   vendor/CubismWebFramework/src/model/cubismusermodel.ts
 *   vendor/CubismWebFramework/src/motion/cubismupdatescheduler.ts
 *   vendor/CubismWebFramework/src/motion/icubismupdater.ts   （CubismUpdateOrder 枚举）
 *   vendor/CubismWebFramework/src/motion/cubismlipsyncupdater.ts （★嘴型插拔点）
 *   Samples 侧同构实现参考：Samples/TypeScript/Demo/src/lappmodel.ts（官方 sample）
 */

import {
  CubismFramework,
  Option,
  LogLevel,
  CubismModelSettingJson,
  CubismUserModel,
  CubismDefaultParameterId,
  CubismModelMatrix,
  CubismMatrix44,
  CubismUpdateScheduler,
  CubismMotionManager,
  InvalidMotionQueueEntryHandleValue,
  CubismExpressionMotionManager,
  CubismEyeBlink,
  CubismEyeBlinkUpdater,
  CubismBreath,
  CubismBreathUpdater,
  CubismPoseUpdater,
  CubismPhysicsUpdater,
  CubismExpressionUpdater,
  CubismLipSyncUpdater,
  CubismShaderManager_WebGL,
  CubismLook,
  CubismLookUpdater,
  LookParameterData,
  BreathParameterData
} from './framework-entry.js';

// ── 待机/演出编排层（通用 IdleDirector）+ 能力发现（用来绑定参数句柄）──
import { IdleDirector, DEFAULT_IDLE_CONFIG } from './idle-director.js';
import { parseCapability } from './capability.js';

// ────────────────────────────────────────────────────────────────
// 1. 框架全局初始化（页面内只做一次）
// ────────────────────────────────────────────────────────────────

let s_frameworkReady = false;

/** 官方框架的全局初始化。可重复调用，第二次起为空操作。 */
export function initCubismFramework(logLevel = LogLevel.LogLevel_Warning) {
  if (s_frameworkReady) return;
  const option = new Option();
  option.logFunction = (msg) => console.log('[cubism]', msg);
  option.loggingLevel = logLevel;
  CubismFramework.startUp(option);
  CubismFramework.initialize();
  s_frameworkReady = true;
}

// ────────────────────────────────────────────────────────────────
// 2. 纹理装载（WebGL 原生，premultiplied alpha，与官方 sample 一致）
// ────────────────────────────────────────────────────────────────

function loadTexture(gl, url, usePremultiply) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.addEventListener(
      'load',
      () => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (usePremultiply) {
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.bindTexture(gl.TEXTURE_2D, null);
        resolve({ texture: tex, width: img.width, height: img.height });
      },
      { passive: true }
    );
    img.addEventListener('error', () => reject(new Error(`纹理装载失败: ${url}`)), {
      passive: true
    });
    img.src = url;
  });
}

// ────────────────────────────────────────────────────────────────
// 3. 模型容器：把官方 CubismUserModel 的受保护成员暴露给宿主
//    （官方 sample 的 LAppModel 也是同样的继承做法）
// ────────────────────────────────────────────────────────────────

class L2DUserModel extends CubismUserModel {
  constructor() {
    super();
    // 🔴 官方基类构造函数里已经建好 _motionManager 并给它设了事件回调
    //    （cubismusermodel.ts 的 `this._motionManager.setEventCallback(cubismDefaultMotionEventCallback, this)`）。
    //    这里**不要再 new 一个新的** —— 新实例的回调是 null，
    //    一旦动作文件里带 UserData 事件（官方样本 Mark 的 Idle 就是），
    //    官方 cubismmotionqueuemanager.ts 会直接 `this._eventCallBack(...)` 抛
    //    「this._eventCallBack is not a function」。实测踩到过，故保留基类实例。
    this._motionManager = this._motionManager || new CubismMotionManager();
    this._modelMatrix = new CubismModelMatrix(1, 1);
    this._updateScheduler = new CubismUpdateScheduler();
    /** 表情名 → ACubismMotion，供 startExpression 用（官方 sample 同样自己维护这个表） */
    this.expressions = new Map();
  }

  getUpdateScheduler() {
    return this._updateScheduler;
  }
  getMotionManager() {
    return this._motionManager;
  }
  getExpressionManager() {
    return this._expressionManager;
  }
  getDragManager() {
    return this._dragManager;
  }
  getPhysics() {
    return this._physics;
  }
  getPose() {
    return this._pose;
  }
  setMotionUpdatedFlag(v) {
    this._motionUpdated = v;
  }
}

// ────────────────────────────────────────────────────────────────
// 3.5 动作装载失败的可读错误
// ────────────────────────────────────────────────────────────────

/**
 * 造一条「哪个文件的哪个动作解析失败」的可读错误。
 *
 * 🔴 为什么必须有它：修前 `loadMotion()` 返回 null 时，下一行 `m.setEffectIds(...)`
 *    会抛 `TypeError: Cannot read properties of null (reading 'setEffectIds')` ——
 *    既没说哪个文件，也没说为什么。而**坏 JSON 走的是另一条路**：官方
 *    `CubismJson.parseBytes()` 里 `JSON.parse()` 没有 try/catch，SyntaxError
 *    （形如 `Expected double-quoted property name in JSON at position 45`）直接冒到调用方 ——
 *    连"这是个 JSON 文件"都看不出来，更别说哪个文件。
 *    → 两条路都在这里被包成同一种「人话 ＋ 文件路径 ＋ 组/下标 ＋ 原始原因」。
 *
 * @param {string} url 动作文件的完整 URL（含模型目录）
 * @param {string} group 动作组名
 * @param {number} index 组内下标
 * @param {string} motionName 宿主给该动作起的名字（`组_下标`）
 * @param {string} reason 失败原因（人话）
 * @param {Error} [cause] 官方解析器抛出的原始异常（若有）
 */
function motionLoadError(url, group, index, motionName, reason, cause) {
  const e = new Error(
    `动作解析失败：${url}（动作组「${group}」第 ${index} 个，动作名 ${motionName}）——${reason}。` +
      '装载已中止：宿主不装载「少了一部分动作」的模型 —— 静默跳过会变成「点了动作没反应」。'
  );
  e.name = 'MotionParseError';
  e.cause = cause;
  return e;
}

// ────────────────────────────────────────────────────────────────
// 4. 宿主主类
// ────────────────────────────────────────────────────────────────

export class Live2DHost {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   *   - shaderBaseUrl {string}  官方 WebGL shader 目录（需以 / 结尾）
   *   - usePremultiply {boolean} 预乘 alpha（默认 true，与官方 sample 一致）
   *   - motionFps {number} 固定步长（秒），默认 1/30
   *   - logLevel {number} 官方日志级别
   *   - onError {(err: Error) => void} 宿主级错误回调（默认 console.error，不静默）
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = Object.assign(
      { shaderBaseUrl: './shaders/WebGL/', usePremultiply: true, motionFps: 1 / 30 },
      opts
    );
    this.gl = null;
    this.userModel = null;
    this.modelSetting = null;
    this.modelHomeDir = '';
    this.textures = [];
    this.loaded = false;
    this.motionGroups = [];
    this.idleGroup = null;
    this.lipSyncIds = [];
    this.timeSeconds = 0;
    this._frameCallback = null;
    this._lastTimestamp = 0;
    /** 外部可替换的嘴型 provider（IParameterProvider 实现）；null = 不驱动嘴 */
    this.lipSyncProvider = null;
    /** 每个 updater 的执行序号快照（取证用） */
    this.updaterOrders = [];
    /** 「起 Idle 失败」是否已报过（防每帧刷屏；恢复后自动复位） */
    this._idleStartFailure = false;
  }

  /**
   * 报告一次宿主级错误。
   * 默认打到 `console.error`（**不静默吞掉**）；传了 `opts.onError` 就交给它
   * （演示页据此把错误显示到页面日志里，教室侧可以据此提示用户）。
   */
  reportError(err) {
    const e = err instanceof Error ? err : new Error(String(err));
    if (this.opts.onError) this.opts.onError(e);
    else console.error('[live2d-host] ' + e.message, e);
  }

  initGL() {
    const gl =
      this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true }) ||
      this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error('无法取得 WebGL 上下文');
    this.gl = gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    return gl;
  }

  /**
   * 装载模型。
   * @param {string} model3Url model3.json 的 URL（相对或绝对）
   */
  async load(model3Url) {
    initCubismFramework(this.opts.logLevel ?? LogLevel.LogLevel_Warning);
    const gl = this.gl || this.initGL();
    const stages = [];
    this.loadStages = stages;
    const mark = (s) => stages.push(s);

    mark('init');
    this.modelHomeDir = model3Url.replace(/[^/]*$/, '');
    const settingBuf = await (await fetch(model3Url)).arrayBuffer();
    this.modelSetting = new CubismModelSettingJson(settingBuf, settingBuf.byteLength);
    mark('setting');

    const um = new L2DUserModel();
    this.userModel = um;

    // --- moc3 ---
    const mocBuf = await (await fetch(this.modelHomeDir + this.modelSetting.getModelFileName())).arrayBuffer();
    mark('moc-fetched');
    um.loadModel(mocBuf, false);
    mark('moc-loaded');

    // --- renderer ---
    const w = this.canvas.width;
    const h = this.canvas.height;
    um.createRenderer(w, h);
    mark('renderer-created');
    const renderer = um.getRenderer();
    renderer.startUp(gl);
    mark('renderer-startup');
    renderer.loadShaders(this.opts.shaderBaseUrl);
    mark('shaders');
    renderer.setIsPremultipliedAlpha(this.opts.usePremultiply);
    um.setRenderTargetSize(w, h);
    mark('rendertarget');

    mark('before-textures');
    // --- 纹理 ---
    for (let i = 0; i < this.modelSetting.getTextureCount(); i++) {
      const name = this.modelSetting.getTextureFileName(i);
      if (!name) continue;
      const { texture } = await loadTexture(gl, this.modelHomeDir + name, this.opts.usePremultiply);
      renderer.bindTexture(i, texture);
      this.textures.push(texture);
    }

    mark('textures');
    // --- 布局 ---
    const layout = new Map();
    this.modelSetting.getLayoutMap(layout);
    um.getModelMatrix().setupFromLayout(layout);

    const model = um.getModel();
    const idm = CubismFramework.getIdManager();
    const ids = {
      angleX: idm.getId(CubismDefaultParameterId.ParamAngleX),
      angleY: idm.getId(CubismDefaultParameterId.ParamAngleY),
      angleZ: idm.getId(CubismDefaultParameterId.ParamAngleZ),
      bodyAngleX: idm.getId(CubismDefaultParameterId.ParamBodyAngleX),
      breath: idm.getId(CubismDefaultParameterId.ParamBreath),
      eyeBallX: idm.getId(CubismDefaultParameterId.ParamEyeBallX),
      eyeBallY: idm.getId(CubismDefaultParameterId.ParamEyeBallY)
    };

    mark('layout');
    const scheduler = um.getUpdateScheduler();

    // --- Expression（order=300）---
    const exprCount = this.modelSetting.getExpressionCount();
    for (let i = 0; i < exprCount; i++) {
      const name = this.modelSetting.getExpressionName(i);
      const file = this.modelSetting.getExpressionFileName(i);
      const buf = await (await fetch(this.modelHomeDir + file)).arrayBuffer();
      um.expressions.set(name, um.loadExpression(buf, buf.byteLength, name));
    }
    if (exprCount > 0) {
      scheduler.addUpdatableList(new CubismExpressionUpdater(um.getExpressionManager()));
    }

    mark('expressions');
    // --- Physics（order=600）---
    const physName = this.modelSetting.getPhysicsFileName();
    if (physName) {
      const buf = await (await fetch(this.modelHomeDir + physName)).arrayBuffer();
      um.loadPhysics(buf, buf.byteLength);
      const phys = um.getPhysics();
      if (phys) scheduler.addUpdatableList(new CubismPhysicsUpdater(phys));
    }

    mark('physics');
    // --- Pose（order=800）---
    const poseName = this.modelSetting.getPoseFileName();
    if (poseName) {
      const buf = await (await fetch(this.modelHomeDir + poseName)).arrayBuffer();
      um.loadPose(buf, buf.byteLength);
      const pose = um.getPose();
      if (pose) scheduler.addUpdatableList(new CubismPoseUpdater(pose));
    }

    mark('pose');
    // --- EyeBlink（order=200）---
    // 🔴 旧：写死 Haru 默认参数名 + 直接挂官方 CubismEyeBlinkUpdater。
    //   现改为：通用 IdleDirector 接管眨眼后，这里**不放官方 Eyelink updater**
    //   （否则两个眨眼写者抢 ParamEyeLOpen/ROpen，实测会抽搐）。官方 updater 只保留
    //   在「导演未启用」的回退路径下（极少用，保持向后兼容）。
    if (!this.opts.idleConfig && this.modelSetting.getEyeBlinkParameterCount() > 0) {
      um._eyeBlink = CubismEyeBlink.create(this.modelSetting);
      scheduler.addUpdatableList(new CubismEyeBlinkUpdater(() => um._motionUpdated, um._eyeBlink));
    }

    mark('eyeblink');
    // --- Breath（order=500）---
    // 🔴 同上：导演接管呼吸（additive 到 bodyAngleX，不抢 ParamBreath 名）后，
    //   这里不放官方 Breath updater。保留官方 updater 仅作「导演未启用」回退。
    if (!this.opts.idleConfig) {
      um._breath = CubismBreath.create();
      um._breath.setParameters([
        new BreathParameterData(ids.angleX, 0.0, 15.0, 6.5345, 0.5),
        new BreathParameterData(ids.angleY, 0.0, 8.0, 3.5345, 0.5),
        new BreathParameterData(ids.angleZ, 0.0, 10.0, 5.5345, 0.5),
        new BreathParameterData(ids.bodyAngleX, 0.0, 4.0, 15.5345, 0.5),
        new BreathParameterData(ids.breath, 0.5, 0.5, 3.2345, 1)
      ]);
      scheduler.addUpdatableList(new CubismBreathUpdater(um._breath));
    }

    mark('breath');
    // --- Look（order=400）---
    um._look = CubismLook.create();
    um._look.setParameters([
      new LookParameterData(ids.angleX, 30.0, 0.0, 0.0),
      new LookParameterData(ids.angleY, 0.0, 30.0, 0.0),
      new LookParameterData(ids.angleZ, 0.0, 0.0, -30.0),
      new LookParameterData(ids.bodyAngleX, 10.0, 0.0, 0.0),
      new LookParameterData(ids.eyeBallX, 1.0, 0.0, 0.0),
      new LookParameterData(ids.eyeBallY, 0.0, 1.0, 0.0)
    ]);
    scheduler.addUpdatableList(new CubismLookUpdater(um._look, um.getDragManager()));

    mark('look');
    // --- LipSync（order=700）：★我们的 TextRhythmProvider 就接在这里 ---
    // 官方 CubismLipSyncUpdater 只依赖 IParameterProvider 的两个方法（update / getParameter），
    // 因此这里塞什么 provider 都可以，官方代码一行不改。
    // 出处：vendor/CubismWebFramework/src/motion/cubismlipsyncupdater.ts
    for (let i = 0; i < this.modelSetting.getLipSyncParameterCount(); i++) {
      this.lipSyncIds.push(this.modelSetting.getLipSyncParameterId(i));
    }
    if (this.lipSyncIds.length > 0) {
      // provider 先给 null（= 官方行为：不驱动嘴），宿主通过 setLipSyncProvider 替换
      this._lipSyncUpdater = new CubismLipSyncUpdater(this.lipSyncIds, null);
      scheduler.addUpdatableList(this._lipSyncUpdater);
    }

    scheduler.sortUpdatableList();
    // 记下每个 updater 的执行序号（取证用：应等于官方 CubismUpdateOrder 的升序）
    for (let i = 0; i < scheduler.getUpdatableCount(); i++) {
      this.updaterOrders.push({
        index: i,
        order: scheduler.getUpdatable(i).getExecutionOrder()
      });
    }

    mark('lipsync');
    // --- 动作：把所有 motion 组读进内存 ---
    // 眨眼参数 ID 列表：官方 setting 只提供「按 index 取单个」，没有批量取的方法
    const eyeBlinkIds = [];
    for (let i = 0; i < this.modelSetting.getEyeBlinkParameterCount(); i++) {
      eyeBlinkIds.push(this.modelSetting.getEyeBlinkParameterId(i));
    }
    const mgCount = this.modelSetting.getMotionGroupCount();
    for (let i = 0; i < mgCount; i++) {
      const g = this.modelSetting.getMotionGroupName(i);
      const n = this.modelSetting.getMotionCount(g);
      const list = [];
      for (let j = 0; j < n; j++) {
        const file = this.modelSetting.getMotionFileName(g, j);
        const url = this.modelHomeDir + file;
        const motionName = `${g}_${j}`;
        // ① 文件取不到（404/500）也是一条必须说清的装载失败：说清是哪个文件、HTTP 几
        const resp = await fetch(url);
        if (!resp.ok) {
          throw motionLoadError(url, g, j, motionName, `文件取不到（HTTP ${resp.status}）`);
        }
        const buf = await resp.arrayBuffer();
        // ② 解析：官方 loadMotion() 对**坏 JSON** 是**抛异常**（不是返回 null）——
        //    CubismJson.parseBytes() 里那句 `JSON.parse(decodeBuffer)` 没有 try/catch
        //    （vendor/CubismWebFramework/src/utils/cubismjson.ts），SyntaxError 一路冒到调用方；
        //    对**空文件**才是返回 null（官方 loadMotion() 开头的 `size == 0` 分支）。
        let m = null;
        try {
          m = um.loadMotion(buf, buf.byteLength, motionName, null, null, this.modelSetting, g, j, false);
        } catch (cause) {
          throw motionLoadError(
            url, g, j, motionName,
            `官方解析器抛错：${cause && cause.message}`,
            cause
          );
        }
        if (!m) {
          throw motionLoadError(
            url, g, j, motionName,
            buf.byteLength === 0
              ? '文件为空（0 字节）：官方 loadMotion() 对空缓冲区直接返回 null'
              : `官方 loadMotion() 返回 null（文件 ${buf.byteLength} 字节，框架判定无法解析）`
          );
        }
        m.setEffectIds(eyeBlinkIds, this.lipSyncIds);
        list.push(m);
      }
      this.motionGroups.push({ name: g, count: n, motions: list });
    }
    this.idleGroup = this.motionGroups.find((g) => g.name === 'Idle') || this.motionGroups[0] || null;

    mark('motions');

    // ── 🔴 能力发现：把"这张模型有哪些参数"喂给通用编排层 ──────────────
    //   capability.js 三级回退已解决"参数名不统一"（Groups.LipSync 有 4 种形态）。
    //   IdleDirector 据此绑定句柄，**不写死 Haru 默认参数名**。
    //   注意：parseCapability 只吃 JSON，不依赖渲染器；这里直接复用已 fetch 的 setting 缓冲。
    const model3Obj = JSON.parse(
      new TextDecoder().decode(new Uint8Array(settingBuf).slice(0))
    );
    let cdi = null;
    const diName = model3Obj.FileReferences && model3Obj.FileReferences.DisplayInfo;
    if (diName) {
      const diBuf = await (await fetch(this.modelHomeDir + diName)).arrayBuffer().catch(() => null);
      if (diBuf) cdi = JSON.parse(new TextDecoder().decode(new Uint8Array(diBuf)));
    }
    const cap = parseCapability(model3Obj, {
      modelId: this.modelHomeDir.split('/').filter(Boolean).pop() || 'model',
      displayInfo: cdi,
      displayInfoMissingReason: diName ? 'fetch failed' : '未声明 DisplayInfo'
    });
    this.capability = cap;

    // ── 🔴 通用待机/演出编排层（默认开启）──────────────────────────────
    //   - 呼吸/眨眼/视线按 capability 发现的参数**组合**官方机制；
    //   - 不绑 Haru 参数名；缺失参数→降级并记进 director.degradation（不静默）；
    //   - 所有随机性从 opts.idleSeed 派生 → 测试可复现；
    //   - write 模式：嘴闸门 + 动作压稳（详见 idle-director.js 先例归属段）。
    this.idleDirector = new IdleDirector(this, cap, this.opts.idleConfig || {}, {
      seed: this.opts.idleSeed != null ? this.opts.idleSeed : 1,
      now: () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())
    });
    // 默认随嘴通道走 speak；上层可在装载后 setMode('write')（见 demo 页 / 教室接线）。
    if (this.opts.idleMode === 'write') this.idleDirector.setMode('write');

    model.saveParameters();
    this.loaded = true;
    return this;
  }

  /** 替换嘴型 provider（官方 IParameterProvider 实现，见 text-rhythm-provider.js） */
  setLipSyncProvider(provider) {
    this.lipSyncProvider = provider;
    if (this._lipSyncUpdater) {
      // 官方字段名是 _audioProvider；语义其实是「参数来源」，不一定是音频
      this._lipSyncUpdater._audioProvider = provider;
    }
    return this;
  }

  /** 切换待机编排层的通道：'speak'（默认）或 'write'（嘴闸门 + 压稳）。 */
  setIdleMode(mode) {
    if (this.idleDirector) this.idleDirector.setMode(mode);
    return this;
  }

  /** 读取待机编排层诊断快照（取证脚本直接读，不静默降级）。 */
  idleStats() {
    return this.idleDirector ? this.idleDirector.stats() : null;
  }

  /** 读取上一帧编排层写入摘要（取证脚本直接读）。 */
  lastIdleSummary() {
    return this._lastIdleSummary || null;
  }

  /**
   * 起一个动作（组名 + 组内下标）。
   *
   * 🔴 官方签名是 `startMotionPriority(motion, autoDelete, priority)`
   *    （vendor/CubismWebFramework/src/motion/cubismmotionmanager.ts）——
   *    **第二个参数是 autoDelete，不是 priority**。
   *
   *    autoDelete 必须传 `false`：本宿主的 motion 对象是 `load()` 时**一次性装载并长期缓存**的
   *    （`this.motionGroups[].motions`）。若交给框架 autoDelete（真值），动作播完时
   *    `CubismMotionQueueManager.doUpdateMotion()` 会 `entry.release()`
   *    → `ACubismMotion.delete()` → `CubismMotion.release()` → **`_motionData = null`**，
   *    缓存对象当场变成空壳；下次再起它，`doUpdateParameters()` 第一行读 `_motionData.duration`
   *    就抛 `TypeError: Cannot read properties of null (reading 'duration')`，渲染循环整条停住。
   *    → 对象生命周期归宿主，就必须让框架知道它不许删。
   */
  startMotion(groupName, index, priority = 2) {
    const g = this.motionGroups.find((x) => x.name === groupName);
    if (!g || !g.motions[index]) return false;
    const handle = this.userModel
      .getMotionManager()
      .startMotionPriority(g.motions[index], false, priority);
    // 官方约定：被拒绝时返回 InvalidMotionQueueEntryHandleValue(-1)，不检查就等于静默失败
    return handle !== InvalidMotionQueueEntryHandleValue;
  }

  /** 起随机 Idle 动作（用来离开绑定姿态） */
  startRandomIdleMotion() {
    if (!this.idleGroup || this.idleGroup.count === 0) return false;
    return this.startMotion(this.idleGroup.name, Math.floor(Math.random() * this.idleGroup.count), 1);
  }

  /** 起一个表情（按名字） */
  startExpression(name, fadeWeight = 1.0) {
    const m = this.userModel.expressions.get(name);
    if (!m) return false;
    const em = this.userModel.getExpressionManager();
    em.startMotion(m, false);
    return true;
  }

  /** 推进 dt 秒（不含绘制） */
  update(dt) {
    if (!this.loaded) return;
    const um = this.userModel;
    const model = um.getModel();
    this.timeSeconds += dt;

    model.loadParameters();
    um.setMotionUpdatedFlag(false);

    const mm = um.getMotionManager();
    if (mm.isFinished()) {
      // 没有动作在播 → 起一个 Idle 当待机。
      // isFinished() 为真只表示「队列里没有还在播的动作」，是**正常**状态，不是错误状态；
      // 要检查的是下面这一次「起」有没有成功。
      // 🔴 起失败必须出声：静默失败会让「画面冻住」看起来像正常待机。
      if (this.startRandomIdleMotion()) {
        this._idleStartFailure = false;
      } else if (!this._idleStartFailure) {
        // 只在失败状态「从无到有」时报一次，避免每帧刷屏；恢复后再失败会再报
        this._idleStartFailure = true;
        this.reportError(
          new Error(
            `起 Idle 动作失败：idleGroup=${this.idleGroup ? this.idleGroup.name : 'null'} ` +
              `count=${this.idleGroup ? this.idleGroup.count : 0}`
          )
        );
      }
    } else {
      um.setMotionUpdatedFlag(mm.updateMotion(model, dt));
    }
    model.saveParameters();

    um.getUpdateScheduler().onLateUpdate(model, dt);

    // ── 🔴 通用待机/演出编排层（呼吸/眨眼/视线/嘴闸门）────────────────
    //   与官方 scheduler 同窗口（model.update() 之前）应用：官方 updater 先把
    //   动作/表情/物理/lipsync 写到参数，这里做"轻量叠加/绝对修正"，再交给
    //   model.update() 一次性反映到顶点——避免一帧延迟。
    //   🔴 不抢官方 updater 的归属：呼吸只 additive 到 bodyAngleX、视线 additive、
    //   眨眼/嘴闸门是绝对修正且被 motion 门控（动作在播时让动作自己管）。
    if (this.idleDirector) {
      const frameSummary = this.idleDirector.apply(
        typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(),
        dt
      );
      this._lastIdleSummary = frameSummary;
    }

    model.update();
  }

  /** 绘制当前状态 */
  draw() {
    if (!this.loaded) return;
    const um = this.userModel;
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;

    gl.clear(gl.COLOR_BUFFER_BIT);

    const projection = new CubismMatrix44();
    projection.loadIdentity();
    if (um.getModel().getCanvasWidth() > 1.0 && w < h) {
      um.getModelMatrix().setWidth(2.0);
      projection.scale(1.0, w / h);
    } else {
      projection.scale(h / w, 1.0);
    }
    projection.multiplyByMatrix(um.getModelMatrix());

    const renderer = um.getRenderer();
    renderer.setMvpMatrix(projection);
    renderer.setRenderState(gl.getParameter(gl.FRAMEBUFFER_BINDING), [0, 0, w, h]);
    renderer.drawModel(this.opts.shaderBaseUrl);
  }

  /**
   * shader 是否已经编译完成。
   * 官方把 shader 源码的 fetch 做成了异步（`cubismshader_webgl.ts` 的 `generateShaders()`），
   * 在它完成前 drawModel 只会打警告「Shader program is not initialized.」且**不画任何东西**。
   * 所以「第一帧」取证前必须等它就绪。
   */
  isShaderReady() {
    if (!this.loaded) return false;
    try {
      return CubismShaderManager_WebGL.getInstance().getShader(this.gl)._isShaderLoaded === true;
    } catch {
      return false;
    }
  }

  /** 等 shader 就绪（最多 waitMs 毫秒） */
  async waitForShaders(waitMs = 10000, pollMs = 100) {
    const t0 = Date.now();
    while (Date.now() - t0 < waitMs) {
      if (this.isShaderReady()) return true;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return this.isShaderReady();
  }

  /** 单帧：更新 + 绘制 */
  step(dt) {
    this.update(dt);
    this.draw();
  }

  /** 跑固定帧数（用于「第一帧」取证：让呼吸/动作离开绑定姿态） */
  runFrames(count, dt = this.opts.motionFps) {
    for (let i = 0; i < count; i++) this.step(dt);
  }

  /**
   * 用 requestAnimationFrame 持续渲染。
   *
   * 🔴 **循环只能有一个**：重复调用会**先停掉上一条链**再起新的。
   *    否则「装载一次起一条循环」会叠加成 N 条 rAF 链，同一帧里 `step()` 被调 N 次
   *    （画面 N 倍速、白烧 CPU），而 `stopLoop()` 只能取消最后那一条 —— 旧的再也停不掉。
   *    实测：修前演示页装载 1/3/5 次 → 每帧 `step()` 次数 = 1/3/5（见 tools/raf-loop-probe.cjs）。
   */
  startLoop() {
    this.stopLoop();
    // 重启后上一轮的时间戳已无意义，清零让首帧退回固定步长（否则首帧 dt 会被钳到上限）
    this._lastTimestamp = 0;
    const tick = (ts) => {
      const dt = this._lastTimestamp ? Math.min((ts - this._lastTimestamp) / 1000, 0.1) : this.opts.motionFps;
      this._lastTimestamp = ts;
      this.step(dt);
      this._frameCallback = requestAnimationFrame(tick);
    };
    this._frameCallback = requestAnimationFrame(tick);
  }

  stopLoop() {
    if (this._frameCallback) cancelAnimationFrame(this._frameCallback);
    this._frameCallback = null;
  }

  /** 读当前模型某参数的实时值（取证用） */
  readParameter(idOrString) {
    if (!this.loaded) return null;
    const model = this.userModel.getModel();
    const handle =
      typeof idOrString === 'string' ? CubismFramework.getIdManager().getId(idOrString) : idOrString;
    const idx = model.getParameterIndex(handle);
    if (idx < 0) return null;
    return model.getParameterValueByIndex(idx);
  }
}

/**
 * 顶层便捷函数：给 canvas + model3.json，直接渲染出第一帧。
 * 这是「渲染部分做成独立模块」的入口点。
 */
export async function renderFirstFrame(canvas, model3Url, opts = {}) {
  const host = new Live2DHost(canvas, opts);
  host.initGL();
  await host.load(model3Url);
  host.runFrames(opts.warmupFrames ?? 30);
  return host;
}
