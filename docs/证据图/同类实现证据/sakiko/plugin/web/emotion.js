/* ============================================================
 * SAKIKO (豊川祥子, Cubism2 本地模型) 情绪/表情/动作映射表
 *
 * Task5 结论（见 task-5-report.md）：
 *  - vendor/pld-cubism2.min.js 内置 Cubism2 ExpressionManager（class tt），
 *    model.expression(name) 支持按名字解析（definitions.findIndex(e=>e.name===name)），
 *    Sakiko model.json 注册 29 个 expressions（smile01-06/angry01/02/07/...），
 *    因此表情体系直接走运行时 expression API（主路径）。
 *  - EXPR: 情绪 → Sakiko expression 名（供 setExpression/model.expression 用）
 *  - EXPR_TO_EMO: expression 名 → 情绪（供 gestureEmotion 回退解析）
 *  - FACE:   保留上游 Amadeus（Cubism4）旧骨架的参数直驱表（本 C2 模型用不到，仅兼容）
 *  - C2_FACE: Cubism2 无 expression 文件/名未命中时的参数直驱兜底；
 *            参数 id 一律取 assets/live2d/sakiko/data/expressions/*.exp.json 中真实存在的
 *            （PARAM_EYE_R_SMILE/PARAM_BROW_R_FORM/PARAM_MOUTH_FORM_01 等，
 *             并经 sakiko_casual-2023.moc 二进制扫描确认存在；shizuku 独有单键
 *             PARAM_EYE_SMILE 已删除，Sakiko 只有左右分键）。
 *  - GESTURE: 白祥系幅度整体上浮约 5~10%（微笑/害羞类调高），注释见下。
 * ============================================================ */
window.SakikoEmotion = (function () {
  // 情绪 → Sakiko expression 名（model.json expressions 的 name 字段，勿改拼写）
  var EXPR = {
    happy: 'smile03',
    excited: 'smile05',
    elated: 'smile06',
    sad: 'sad01',
    angry: 'angry01',
    furious: 'angry07',
    question: 'thinking01',
    soft: 'smile01',
    blush: 'shame01',
    annoyed: 'sigh01',
    thinking: 'thinking02',
    surprised: 'surprised01',
    disappointed: 'sad02',
    eyes_closed: 'idle01',
    indifferent: 'serious01',
    side: 'kime01',
    winking: 'smile04',
    neutral: 'default'
  }

  // expression 名 → 情绪（与 EXPR 互为反查；空串 → neutral 兼容旧消息）
  var EXPR_TO_EMO = {
    smile03: 'happy',
    smile05: 'excited',
    smile06: 'elated',
    sad01: 'sad',
    angry01: 'angry',
    angry07: 'furious',
    thinking01: 'question',
    smile01: 'soft',
    shame01: 'blush',
    sigh01: 'annoyed',
    thinking02: 'thinking',
    surprised01: 'surprised',
    sad02: 'disappointed',
    idle01: 'eyes_closed',
    serious01: 'indifferent',
    kime01: 'side',
    smile04: 'winking',
    default: 'neutral',
    '': 'neutral'
  }

  // 上游 Amadeus（Cubism4）旧骨架参数直驱（本 Sakiko C2 模型用不到，保留结构作兼容）。
  var FACE = {
    happy:        { ParamEyeRSmile: 0.75, Param9: 0.45, ParamMouthForm: 0.45 },
    excited:      { ParamEyeRSmile: 0.85, Param9: 0.55, ParamMouthForm: 0.6 },
    elated:       { ParamEyeRSmile: 0.95, Param9: 0.65, ParamMouthForm: 0.7, ParamEyeBallX: 0.1 },
    sad:          { ParamEyeRSmile: -0.4, Param8: 0.3, ParamMouthForm: -0.35 },
    angry:        { ParamEyeRSmile: -0.6, Param8: 0.85, ParamMouthForm: 0.4, Param9: 0.2 },
    furious:      { ParamEyeRSmile: -0.8, Param8: 1.0, ParamMouthForm: 0.6, Param9: 0.3, ParamEyeBallY: -0.15 },
    question:     { Param8: 0.55, ParamEyeBallX: 0.16, ParamEyeBallY: 0.12, ParamMouthForm: 0.15 },
    soft:         { ParamEyeRSmile: 0.35, Param9: 0.18, ParamMouthForm: -0.15 },
    blush:        { Param9: 1.0, ParamEyeRSmile: 0.5, ParamMouthForm: -0.12 },
    annoyed:      { Param8: 0.7, ParamEyeRSmile: -0.4, ParamMouthForm: 0.25 },
    thinking:     { Param8: 0.55, ParamEyeBallX: -0.18, ParamEyeBallY: 0.22, ParamMouthForm: -0.2 },
    surprised:    { ParamEyeLOpen: 1, ParamEyeROpen: 1, ParamMouthOpenY: 0.55, Param8: 0.5 },
    disappointed: { ParamEyeRSmile: -0.35, Param8: 0.35, ParamMouthForm: -0.4 },
    eyes_closed:  { ParamEyeLOpen: 0, ParamEyeROpen: 0, ParamEyeRSmile: 0.1 },
    indifferent:  { ParamEyeLOpen: 0.65, ParamEyeROpen: 0.65, ParamMouthForm: -0.2 },
    side:         { ParamAngleY: 0.28, ParamAngleZ: -0.08, ParamEyeBallX: 0.3 },
    winking:      { ParamEyeLOpen: 1, ParamEyeROpen: 0, ParamEyeRSmile: 0.5 },
    neutral:      {}
  }

  // Cubism2 Sakiko 参数直驱兜底表。
  // 仅当 model.expression 不可用/名字未命中时才驱动；值从对应 exp.json 提炼。
  // 眼开度(EYE_*_OPEN) 由 panel.js 的眨眼/表情分层(applyEyeLids)负责，不在此重复占位。
  var C2_FACE = {
    happy:        { PARAM_EYE_R_SMILE: 1, PARAM_EYE_L_SMILE: 1, PARAM_EYE_FORM: 1, PARAM_BROW_R_ANGLE: 0.33, PARAM_BROW_R_FORM: -2, PARAM_BROW_L_ANGLE: 0.33, PARAM_BROW_L_FORM: -2, PARAM_MOUTH_FORM_01: 0.5, PARAM_MOUTH_SCALE: -0.35 },
    excited:      { PARAM_EYE_R_SMILE: 1, PARAM_EYE_L_SMILE: 1, PARAM_BROW_R_Y: -0.2, PARAM_BROW_R_ANGLE: 0.36, PARAM_BROW_R_FORM: -2, PARAM_BROW_L_Y: -0.2, PARAM_BROW_L_ANGLE: 0.36, PARAM_BROW_L_FORM: -2, PARAM_MOUTH_FORM_01: 1.5, PARAM_CHEEK2: 0.55 },
    elated:       { PARAM_EYE_FORM: -0.26, PARAM_BROW_R_Y: 0.44, PARAM_BROW_R_X: 0.08, PARAM_BROW_R_ANGLE: 0.19, PARAM_BROW_R_FORM: 0.5, PARAM_BROW_L_Y: 0.44, PARAM_BROW_L_X: 0.08, PARAM_BROW_L_ANGLE: 0.19, PARAM_BROW_L_FORM: 0.5, PARAM_MOUTH_FORM_01: 0.5, PARAM_MOUTH_SCALE: -1 },
    sad:          { PARAM_EYE_FORM: 0.46, PARAM_BROW_R_Y: -0.56, PARAM_BROW_R_X: -0.12, PARAM_BROW_R_ANGLE: 0.15, PARAM_BROW_R_FORM: -1.5, PARAM_BROW_L_Y: -0.56, PARAM_BROW_L_X: -0.12, PARAM_BROW_L_ANGLE: 0.15, PARAM_BROW_L_FORM: -1.5, PARAM_MOUTH_FORM_01: -0.5, PARAM_MOUTH_SCALE: -1 },
    angry:        { PARAM_BROW_R_Y: -0.87, PARAM_BROW_R_X: -0.23, PARAM_BROW_R_ANGLE: -0.4, PARAM_BROW_R_FORM: -1, PARAM_BROW_L_Y: -0.87, PARAM_BROW_L_X: -0.23, PARAM_BROW_L_ANGLE: -0.4, PARAM_BROW_L_FORM: -1, PARAM_MOUTH_FORM_01: -1 },
    furious:      { PARAM_EYE_BALL_Y: 0.18, PARAM_EYE_FORM: -1, PARAM_BROW_R_Y: -0.8, PARAM_BROW_R_X: -0.23, PARAM_BROW_R_ANGLE: -0.4, PARAM_BROW_R_FORM: -2.5, PARAM_BROW_L_Y: -0.8, PARAM_BROW_L_X: -0.23, PARAM_BROW_L_ANGLE: -0.4, PARAM_BROW_L_FORM: -2.5, PARAM_EYE_BROWS: 0.5, PARAM_MOUTH_FORM_01: -2.5, PARAM_MOUTH_SCALE: 0.57 },
    question:     { PARAM_BROW_R_X: 0.12, PARAM_BROW_R_ANGLE: 0.21, PARAM_BROW_R_FORM: 2, PARAM_BROW_L_X: 0.12, PARAM_BROW_L_ANGLE: 0.21, PARAM_BROW_L_FORM: 2, PARAM_MOUTH_FORM_01: -0.5, PARAM_MOUTH_SCALE: -0.33 },
    soft:         { PARAM_EYE_R_SMILE: 1, PARAM_EYE_L_SMILE: 1, PARAM_EYE_FORM: 1, PARAM_BROW_R_Y: 0.47, PARAM_BROW_R_X: 0.13, PARAM_BROW_R_ANGLE: 0.19, PARAM_BROW_R_FORM: 1.5, PARAM_BROW_L_Y: 0.47, PARAM_BROW_L_X: 0.13, PARAM_BROW_L_ANGLE: 0.19, PARAM_BROW_L_FORM: 1.5, PARAM_MOUTH_FORM_01: 0.5, PARAM_MOUTH_FORM_Y: -0.01 },
    blush:        { PARAM_EYE_FORM: -0.35, PARAM_BROW_R_ANGLE: 0.49, PARAM_BROW_R_FORM: -2.5, PARAM_BROW_L_ANGLE: 0.49, PARAM_BROW_L_FORM: -2.5, PARAM_EYE_BROWS: 0.01, PARAM_MOUTH_FORM_01: -0.5, PARAM_CHEEK: 1, PARAM_CHEEK2: 0.35 },
    annoyed:      { PARAM_EYE_FORM: 0.19, PARAM_BROW_R_Y: -0.58, PARAM_BROW_R_X: -0.23, PARAM_BROW_R_ANGLE: -0.05, PARAM_BROW_L_Y: -0.58, PARAM_BROW_L_X: -0.23, PARAM_BROW_L_ANGLE: -0.05, PARAM_MOUTH_FORM_01: -1 },
    thinking:     { PARAM_EYE_FORM: -0.26, PARAM_BROW_R_Y: -0.35, PARAM_BROW_R_ANGLE: 0.02, PARAM_BROW_R_FORM: -3, PARAM_BROW_L_Y: -0.35, PARAM_BROW_L_ANGLE: 0.02, PARAM_BROW_L_FORM: -3, PARAM_MOUTH_FORM_01: -1 },
    surprised:    { PARAM_BROW_R_Y: 0.49, PARAM_BROW_R_X: 0.12, PARAM_BROW_R_ANGLE: 0.31, PARAM_BROW_R_FORM: 2, PARAM_BROW_L_Y: 0.49, PARAM_BROW_L_X: 0.12, PARAM_BROW_L_ANGLE: 0.31, PARAM_BROW_L_FORM: 2, PARAM_MOUTH_FORM_01: -1, PARAM_MOUTH_SCALE: 0.21 },
    disappointed: { PARAM_EYE_FORM: 0.35, PARAM_BROW_R_Y: -0.35, PARAM_BROW_R_ANGLE: 0.11, PARAM_BROW_R_FORM: -3, PARAM_BROW_L_Y: -0.35, PARAM_BROW_L_ANGLE: 0.11, PARAM_BROW_L_FORM: -3, PARAM_MOUTH_FORM_01: -3, PARAM_MOUTH_SCALE: -1 },
    eyes_closed:  { PARAM_EYE_L_OPEN: 0, PARAM_EYE_R_OPEN: 0 },
    indifferent:  { PARAM_EYE_FORM: 0.09, PARAM_BROW_R_Y: -0.42, PARAM_BROW_R_X: -0.23, PARAM_BROW_R_ANGLE: -0.4, PARAM_BROW_R_FORM: -1, PARAM_BROW_L_Y: -0.42, PARAM_BROW_L_X: -0.23, PARAM_BROW_L_ANGLE: -0.4, PARAM_BROW_L_FORM: -1, PARAM_MOUTH_FORM_01: -1 },
    side:         { PARAM_BROW_R_Y: -0.32, PARAM_BROW_R_X: 0.08, PARAM_BROW_R_ANGLE: -0.2, PARAM_BROW_R_FORM: 0.5, PARAM_BROW_L_Y: -0.32, PARAM_BROW_L_X: 0.08, PARAM_BROW_L_ANGLE: -0.2, PARAM_BROW_L_FORM: 0.5, PARAM_MOUTH_FORM_01: 1.5 },
    winking:      { PARAM_EYE_R_SMILE: 1, PARAM_EYE_L_SMILE: 1, PARAM_EYE_FORM: 0.22, PARAM_EYE_SCALE: 0.67, PARAM_BROW_R_Y: -0.08, PARAM_BROW_R_X: -0.23, PARAM_BROW_R_ANGLE: -0.12, PARAM_BROW_R_FORM: -2, PARAM_BROW_L_Y: -0.08, PARAM_BROW_L_X: -0.23, PARAM_BROW_L_ANGLE: -0.12, PARAM_BROW_L_FORM: -2, PARAM_MOUTH_FORM_01: 1.5, PARAM_CHEEK2: 0.58 },
    neutral:      {}
  }

  // 说话动作幅度/速度 —— 白祥(Sakiko)调教：
  // 整体幅度上浮约 5~10%（较旧 kurisu 表更外放）；微笑/害羞/兴奋类情绪取 +10% 档，
  // 其余取 +5~8% 档，保证优雅感的同时不至于缩手缩脚。
  var GESTURE = {
    angry:        { amp: 1.5, speed: 1.25 },
    furious:      { amp: 1.5, speed: 1.25 },
    excited:      { amp: 1.38, speed: 1.15 },
    elated:       { amp: 1.38, speed: 1.15 },
    happy:        { amp: 1.21, speed: 1.05 },
    sad:          { amp: 0.65, speed: 0.7 },
    soft:         { amp: 0.77, speed: 0.8 },
    question:     { amp: 0.99, speed: 0.9 },
    blush:        { amp: 0.88, speed: 0.8 },
    annoyed:      { amp: 1.3, speed: 1.1 },
    thinking:     { amp: 0.77, speed: 0.6 },
    surprised:    { amp: 1.4, speed: 1.3 },
    disappointed: { amp: 0.6, speed: 0.65 },
    eyes_closed:  { amp: 0.44, speed: 0.5 },
    indifferent:  { amp: 0.55, speed: 0.7 },
    side:         { amp: 0.6, speed: 0.6 },
    winking:      { amp: 1.1, speed: 1.0 },
    neutral:      { amp: 1.08, speed: 1 }
  }

  return {
    EXPR: EXPR,
    EXPR_TO_EMO: EXPR_TO_EMO,
    FACE: FACE,
    C2_FACE: C2_FACE,
    GESTURE: GESTURE
  }
})()
