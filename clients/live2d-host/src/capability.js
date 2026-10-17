/**
 * capability.js —— 能力发现层（Capability Discovery）
 *
 * 输入：一个 `model3.json`（+ 同目录的 `cdi3.json`，若存在）
 * 输出：一张「这张模型能做什么」的清单，供上层（DSH 服务端 / 工具参数校验 / 注入指令块）使用。
 *
 * 🔴 为什么要有这一层（研究_8 §1.1 一手结论）：
 *   官方 8 个样本里，`Groups[].LipSync` 的参数名**根本不统一**，共 4 种形态：
 *     ParamMouthOpenY / ParamA / PARAM_MOUTH_OPEN_Y / []（空数组）
 *   airi 硬编码 `'ParamMouthOpenY'` → 在 8 个官方样本里 4 个失效。
 *   → 所以必须先读模型自己声明的 `Groups`，读不到再按命名风格回退，**仍找不到就明确报"不支持"，绝不静默**。
 *
 * 纯 JSON 解析，**不需要加载渲染器**（可在服务端/Node 里跑）。
 * 本文件同时可被浏览器与 Node 使用（只依赖 fetch / fs，见 readJson 的注入点）。
 */

/** 已知的「嘴开合」参数命名风格（按优先级）。来源：研究_8 §1.1 的 8 样本实测 + 官方默认参数名。 */
export const KNOWN_MOUTH_PARAM_STYLES = [
  // ① 官方默认名（CubismDefaultParameterId.ParamMouthOpenY 的值）
  'ParamMouthOpenY',
  // ② 官方默认名的大写下划线变体（Wanko 形态）
  'PARAM_MOUTH_OPEN_Y',
  // ③ Mao 形态：整个嘴用一个参数
  'ParamA',
  // ④ 常见第三方/旧版命名
  'ParamMouthOpen',
  'PARAM_MOUTH_OPEN',
  'MouthOpenY',
  'MouthOpen',
  'ParamMouseOpenY'
];

/** 已知的「眨眼」参数命名风格（按优先级） */
export const KNOWN_EYEBLINK_PARAM_STYLES = [
  ['ParamEyeLOpen', 'ParamEyeROpen'],
  ['PARAM_EYE_L_OPEN', 'PARAM_EYE_R_OPEN']
];

/** 回退级别的名字（写进报告，便于逐样本核对） */
export const LIPSYNC_SOURCE = {
  MODEL_DECLARED: 'L1-模型自声明(Groups.LipSync)',
  STYLE_MATCH: 'L2-命名风格匹配(参数全集内)',
  STYLE_MATCH_UNVERIFIED: 'L2b-命名风格匹配(无参数全集，未验证存在性)',
  UNSUPPORTED: 'L3-不支持(明确报错)'
};

/**
 * 解析一个 model3.json 对象 → 能力清单。
 *
 * @param {object} model3          已解析的 model3.json
 * @param {object} [opts]
 *   - modelId {string}
 *   - displayInfo {object|null}   已解析的 cdi3.json（提供「参数全集」）
 *   - displayInfoMissingReason {string}
 * @returns {object} 能力清单
 */
export function parseCapability(model3, opts = {}) {
  const fr = model3.FileReferences || {};

  // ── 动作组（Motions，按 Group 分类）──────────────────────────
  const motionGroups = Object.keys(fr.Motions || {}).map((name) => ({
    name,
    count: (fr.Motions[name] || []).length,
    // 官方 sample 实测：File 是唯一必然存在的字段；FadeIn/FadeOut/Sound 均可选
    hasSound: (fr.Motions[name] || []).some((m) => typeof m.Sound === 'string' && m.Sound !== '')
  }));

  // ── 表情（Expressions）──────────────────────────────────────
  const expressions = (fr.Expressions || []).map((e, index) => ({
    name: e.Name,
    index, // ← 数组下标；OLV 的 emotionMap 用的就是它
    file: e.File
  }));

  // ── 参数组（Groups）─────────────────────────────────────────
  const parameterGroups = {};
  for (const g of model3.Groups || []) {
    if (!g || typeof g.Name !== 'string') continue;
    parameterGroups[g.Name] = Array.isArray(g.Ids) ? g.Ids.slice() : [];
  }

  // ── 参数全集（来自 cdi3.json 的 Parameters[].Id）────────────
  // 🔴 诚实标注：cdi3.json 是「编辑器里被登记过」的参数；未登记的参数不会出现在这里。
  //    故本字段只用于「验证某个候选参数确实存在」，不宣称是完整参数表。
  let parameterUniverse = null;
  let parameterUniverseSource = 'none';
  // 🔴 `parameters` ＝ **逐参数直驱**那条路的可写键清单，形状 `[{ id, name }]`。
  //    为什么必须是**对象带 id**而不是纯字符串数组：消费方（服务端引擎
  //    `lib/expression.mjs` 的 `expressionCapabilityFor()`）**先读 `entry.parameters`**、
  //    按 `p => typeof p === 'string' ? p : p?.id` 取 id；带 `name` 的写法同时供
  //    工具描述/面板直接显示「这个参数叫什么」，纯字符串数组就得靠消费方自己再查一遍 cdi3。
  //    旧的 `parameterUniverseCount` 只回「个数」——个数**写不出任何一个值**，这就是
  //    引擎的逐参数路此前在服务端断开的原因（报告 EXPR-3 §7）。
  //    ⚠️ 与 `parameterUniverseCount` 同口径：没有 cdi3 → 两者都为 `null`（不是空数组：
  //    「没有 cdi3」与「cdi3 里 0 个参数」是两件事，用 `parameterUniverseSource` 区分）。
  let parameters = null;
  if (opts.displayInfo && Array.isArray(opts.displayInfo.Parameters)) {
    parameterUniverse = opts.displayInfo.Parameters.map((p) => p.Id).filter((x) => typeof x === 'string');
    parameterUniverseSource = 'cdi3.json:Parameters[].Id';
    parameters = opts.displayInfo.Parameters
      .filter((p) => p && typeof p.Id === 'string' && p.Id !== '')
      .map((p) => ({ id: p.Id, name: typeof p.Name === 'string' && p.Name !== '' ? p.Name : p.Id }));
  }

  // ── 🔴 第四层信号：cdi3 的「参数语义分组」 ────────────────────
  // cdi3.json 里 Parameters[] 每条带 GroupId，ParameterGroups[] 把 GroupId 映射到
  // **语义名**（官方样本里是日文：顔 / 目 / 眉毛 / 口 / 体 / 腕 …）。
  // → 这比「参数叫什么名字」可靠得多：它能告诉我们**哪个参数属于「口」**。
  // ⚠️ 实测（8 个官方样本）：只有部分模型有这套分组（Mark 的 ParameterGroups 是空数组）。
  //    所以它是「补充证据」，不能取代前三层回退。
  const cdiGroups = [];
  if (opts.displayInfo && Array.isArray(opts.displayInfo.ParameterGroups)) {
    const byGroupId = new Map();
    for (const pg of opts.displayInfo.ParameterGroups) {
      if (pg && typeof pg.Id === 'string') byGroupId.set(pg.Id, pg.Name);
    }
    for (const prm of opts.displayInfo.Parameters || []) {
      if (prm && typeof prm.GroupId === 'string' && byGroupId.has(prm.GroupId)) {
        cdiGroups.push({ group: byGroupId.get(prm.GroupId), id: prm.Id, name: prm.Name });
      }
    }
  }
  const mouthGroupNames = ['口', 'mouth', 'Mouth', 'くち'];
  const cdiMouthGroupParameters = cdiGroups
    .filter((g) => mouthGroupNames.some((n) => g.group === n || g.group.includes(n)))
    .map((g) => g.id);

  // ── ★ 三级回退：找嘴参数 ────────────────────────────────────
  const lipSyncDeclared = parameterGroups.LipSync || null;
  const mouth = resolveMouthParameter(lipSyncDeclared, parameterUniverse);

  // ── 眨眼参数（同样先读 Groups，再按风格回退）─────────────────
  const eyeBlinkDeclared = parameterGroups.EyeBlink || null;
  const eyeBlink = resolveEyeBlinkParameters(eyeBlinkDeclared, parameterUniverse);

  return {
    modelId: opts.modelId || null,
    modelVersion: model3.Version ?? null,
    motionGroups,
    motionGroupUnion: motionGroups.map((g) => g.name),
    expressions,
    expressionCount: expressions.length,
    parameterGroups,
    parameterGroupNames: Object.keys(parameterGroups),
    parameterUniverseSource,
    parameterUniverseCount: parameterUniverse ? parameterUniverse.length : null,
    /**
     * 🔴 **逐参数直驱那条路的可写键清单**：`[{ id, name }]`（`name` 是 cdi3 里的显示名，
     * 缺名时回落成 id）。消费方是服务端引擎的 `expressionCapabilityFor()`
     * （`lib/expression.mjs`：先读本字段、按 `p?.id` 取 id；读不到才读 `parameterUniverse`）。
     * 🔴 **嘴参数不在这里另做标记**：`lipSync.parameters`（下方）就是本模型声明/命中的嘴参数，
     * 引擎与面板都读它、并在逐参数直驱时把它们**排除**（一个参数两个写者＝叠加，本项目已踩过）。
     * 没有 cdi3 → `null`（与 `parameterUniverseCount` 同口径；原因见 `parameterUniverseSource`）。
     */
    parameters,
    displayInfoMissingReason: opts.displayInfoMissingReason || null,
    lipSync: mouth,
    /** cdi3 参数语义分组（若有）；用于「第四层补充证据」 */
    displayInfoParameterGroups: {
      available: cdiGroups.length > 0,
      groups: [...new Set(cdiGroups.map((g) => g.group))],
      mouthGroupParameters: cdiMouthGroupParameters,
      note: cdiGroups.length
        ? 'cdi3.json 提供了参数语义分组；mouthGroupParameters 是「口」组下的参数 ID'
        : 'cdi3.json 未提供参数语义分组（ParameterGroups 为空），无法用语义分组佐证'
    },
    eyeBlink,
    hitAreas: (model3.HitAreas || []).map((h) => h.Name),
    /**
     * 🔴 「相位 → 表情」这一路能不能用 —— **必须报出来，不许静默**。
     *
     * 背景（源码事实）：面板按**下标**取表情（`PHASE_STATES` 的 6 个 `expressionIndex`），
     * 且有一句 `if (expressions.length === 0) return;` —— 换到 0 表情的模型时，
     * 相位→表情会**静默失效**（不报错、不变表情），换模型的人根本不知道。
     * 本字段把这件事从静默改成有声：上层（面板/工具/注入块）直接读 `status` 与 `detail` 即可。
     *
     * ⚠️ 本层**只报事实**（有几个表情、6 个相位能不能各取到一个），
     *    **不替用户标定"哪个相位该用哪个表情"**（那需要人工看表情图，见 README 换人清单第 8 条）。
     */
    phaseExpression: {
      available: expressions.length > 0,
      expressionCount: expressions.length,
      expressionNames: expressions.map((e) => e.name),
      /** 6 个相位下标（0..5）逐个取模后能不能拿到一个不同/任意的表情 */
      status: expressions.length === 0 ? 'unavailable' : expressions.length < 6 ? 'partial' : 'ok',
      detail:
        expressions.length === 0
          ? '表达式个数 = 0（相位→表情将不可用）：面板的 applyPhase 在 expressions.length === 0 时直接 return，' +
            '6 个相位（open/probe/answer/check/review/close）都不会换表情，且**不报错、不提示** —— 属静默失效。'
          : expressions.length < 6
            ? `表达式个数 = ${expressions.length}（不足 6 个相位）：下标会按取模回绕，` +
              '有多个相位会落到同一个表情（例如 close 与 open 同图）。功能可用，但"每个相位一个表情"做不到。'
            : `表达式个数 = ${expressions.length}（≥ 6 个相位）：6 个相位都能各取到一个表情。`
    },
    files: {
      moc: fr.Moc ?? null,
      textures: (fr.Textures || []).slice(),
      textureCount: (fr.Textures || []).length,
      physics: fr.Physics ?? null,
      pose: fr.Pose ?? null,
      userData: fr.UserData ?? null,
      displayInfo: fr.DisplayInfo ?? null
    }
  };
}

/**
 * 三级回退的核心。
 * @returns {{status:string, parameter:string|null, source:string, candidates:string[], detail:string}}
 */
export function resolveMouthParameter(lipSyncDeclared, parameterUniverse) {
  // ── L1：模型自声明 ─────────────────────────────────────────
  if (Array.isArray(lipSyncDeclared) && lipSyncDeclared.length > 0) {
    const declared = lipSyncDeclared.filter((x) => typeof x === 'string' && x !== '');
    if (declared.length > 0) {
      // L1 验证：如果拿得到参数全集，确认声明的参数真的存在（防「声明了但模型里没有」）
      if (parameterUniverse) {
        const missing = declared.filter((id) => !parameterUniverse.includes(id));
        if (missing.length === 0) {
          return {
            status: 'ok',
            parameter: declared[0],
            parameters: declared,
            source: LIPSYNC_SOURCE.MODEL_DECLARED,
            candidates: declared,
            detail: `Groups 里声明了 ${declared.length} 个 LipSync 参数，且全部在参数全集中存在`
          };
        }
        return {
          status: 'ok-degraded',
          parameter: declared[0],
          parameters: declared,
          source: LIPSYNC_SOURCE.MODEL_DECLARED,
          candidates: declared,
          detail: `Groups 里声明了 LipSync，但其中 ${missing.join(', ')} 在 cdi3 参数全集里找不到（声明与登记不一致，仍按声明使用）`
        };
      }
      return {
        status: 'ok-unverified',
        parameter: declared[0],
        parameters: declared,
        source: LIPSYNC_SOURCE.MODEL_DECLARED,
        candidates: declared,
        detail: 'Groups 里声明了 LipSync；无参数全集，无法验证存在性'
      };
    }
    // 落到这里 = LipSync 存在但 Ids 是空数组（Mark / Rice 就是这种）
  }

  const declaredEmpty = Array.isArray(lipSyncDeclared) && lipSyncDeclared.length === 0;

  // ── L2：按已知命名风格在参数全集里匹配 ──────────────────────
  if (parameterUniverse) {
    for (const style of KNOWN_MOUTH_PARAM_STYLES) {
      if (parameterUniverse.includes(style)) {
        return {
          status: 'fallback',
          parameter: style,
          parameters: [style],
          source: LIPSYNC_SOURCE.STYLE_MATCH,
          candidates: KNOWN_MOUTH_PARAM_STYLES.filter((s) => parameterUniverse.includes(s)),
          detail: declaredEmpty
            ? `Groups.LipSync 是空数组（声明了但不给 ID）；在 cdi3 参数全集里按命名风格命中 ${style}`
            : `Groups 里没有 LipSync 项；在 cdi3 参数全集里按命名风格命中 ${style}`
        };
      }
    }
    // 参数全集在，但一个风格都没命中 → 明确报不支持
    return {
      status: 'unsupported',
      parameter: null,
      parameters: [],
      source: LIPSYNC_SOURCE.UNSUPPORTED,
      candidates: [],
      detail: declaredEmpty
        ? 'Groups.LipSync 是空数组，且 cdi3 参数全集里没有任何已知嘴参数命名风格 → 这张模型不支持嘴型驱动'
        : 'Groups 里没有 LipSync，且 cdi3 参数全集里没有任何已知嘴参数命名风格 → 这张模型不支持嘴型驱动'
    };
  }

  // ── L2b：没有参数全集，只能给出「候选建议」，并标注未验证 ────
  return {
    status: 'unsupported-unverified',
    parameter: null,
    parameters: [],
    source: LIPSYNC_SOURCE.STYLE_MATCH_UNVERIFIED,
    candidates: KNOWN_MOUTH_PARAM_STYLES.slice(),
    detail: declaredEmpty
      ? 'Groups.LipSync 是空数组，且无 cdi3 参数全集 → 无法确认这张模型是否支持嘴型驱动（列出的候选未验证存在性）'
      : 'Groups 里没有 LipSync，且无 cdi3 参数全集 → 无法确认这张模型是否支持嘴型驱动（列出的候选未验证存在性）'
  };
}

/** 眨眼参数：Groups.EyeBlink → 命名风格回退 → 明确报不支持 */
export function resolveEyeBlinkParameters(eyeBlinkDeclared, parameterUniverse) {
  if (Array.isArray(eyeBlinkDeclared) && eyeBlinkDeclared.length > 0) {
    return { status: 'ok', parameters: eyeBlinkDeclared.slice(), source: 'L1-模型自声明(Groups.EyeBlink)' };
  }
  if (parameterUniverse) {
    for (const pair of KNOWN_EYEBLINK_PARAM_STYLES) {
      if (pair.every((id) => parameterUniverse.includes(id))) {
        return { status: 'fallback', parameters: pair.slice(), source: 'L2-命名风格匹配(参数全集内)' };
      }
    }
    return { status: 'unsupported', parameters: [], source: 'L3-不支持(明确报错)' };
  }
  return { status: 'unsupported-unverified', parameters: [], source: 'L3-不支持(无参数全集)' };
}

// ────────────────────────────────────────────────────────────────
// Node 侧便捷入口
// ────────────────────────────────────────────────────────────────

/**
 * 从磁盘读一个模型目录，产出能力清单（Node 专用；浏览器侧请直接用 parseCapability）。
 * @param {string} modelDir 目录路径
 * @param {string} modelFileName 如 'Haru.model3.json'
 */
export async function discoverFromDir(fsMod, pathMod, modelDir, modelFileName) {
  const model3Path = pathMod.join(modelDir, modelFileName);
  const model3 = JSON.parse(fsMod.readFileSync(model3Path, 'utf8'));

  let displayInfo = null;
  let displayInfoMissingReason = null;
  const diName = model3.FileReferences && model3.FileReferences.DisplayInfo;
  if (diName) {
    const diPath = pathMod.join(modelDir, diName);
    if (fsMod.existsSync(diPath)) {
      displayInfo = JSON.parse(fsMod.readFileSync(diPath, 'utf8'));
    } else {
      displayInfoMissingReason = `model3.json 声明了 DisplayInfo=${diName}，但文件不存在`;
    }
  } else {
    displayInfoMissingReason = 'model3.json 未声明 FileReferences.DisplayInfo';
  }

  return parseCapability(model3, {
    modelId: modelFileName.replace(/\.model3\.json$/, ''),
    displayInfo,
    displayInfoMissingReason
  });
}
