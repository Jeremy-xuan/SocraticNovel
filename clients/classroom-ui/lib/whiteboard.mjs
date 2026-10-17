// clients/classroom-ui/lib/whiteboard.mjs — 轻量 SVG 白板「场景引擎」（纯函数，零依赖）。
//
// 落点：右栏「白板」tab（S7 面板接线，本文件只提供模型与渲染模型，不碰 DOM）。
// 设计纪律：
//   · 零新增依赖；不引入任何宿主 / 浏览器全局（保证 node 侧单测可直装）。
//   · 所有函数纯函数：不改入参、出错显式抛出或返回 {ok:false}，绝不静默修正。
//   · 上限：2000 元素 / 2 MiB。**超限即报错，不截断**（2 MiB 是对序列化产物的硬上限）。
//   · mermaid 元素只产出「源 + 主题」的渲染模型；真渲染由 S7 面板交给 vendored mermaid。
//
// 元素类型（scene.v1）：text / rect / line / arrow / mermaid
//
// 导出（任务书交付物 S1–S3 基础层）：
//   check / normalize / serialize / parse / sceneToSvgModel / renderElement / hitTest / applyEdit
//   + 常量 MAX_ELEMENTS / MAX_BYTES / SCENE_VERSION / ELEMENT_TYPES

export const SCENE_VERSION = 'whiteboard.scene.v1'
export const MAX_ELEMENTS = 2000
export const MAX_BYTES = 2 * 1024 * 1024 // 2 MiB
export const ELEMENT_TYPES = ['text', 'rect', 'line', 'arrow', 'mermaid']

// ── 数值 / 类型小工具 ────────────────────────────────────────────────────────
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isNonEmptyStr = (v) => typeof v === 'string' && v.length > 0
const isInt = (v, min = 0) => Number.isInteger(v) && v >= min
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const clone = (v) => structuredClone(v)

// ── 默认样式（仅对「可选且缺失」的字段生效；不修正任何非法输入） ────────────────
const DEFAULTS = {
  canvas: { width: 960, height: 640, background: '#0a0a0a' },
  text: { fontSize: 16, color: '#ffffff', rotation: 0 },
  rect: { fill: '#101010', stroke: '#3b82f6', strokeWidth: 2, rx: 0 },
  line: { stroke: '#9ca3af', strokeWidth: 2 },
  arrow: { stroke: '#f59e0b', strokeWidth: 2 },
  mermaid: { theme: 'dark' },
}
const ARROW_MARKERS = ['arrow', 'none']
const MERMAID_THEMES = ['dark', 'light']

function pushErr(errors, path, code, message) {
  errors.push({ path, code, message })
}

// ── 单元素校验（只收集错误，不修正） ─────────────────────────────────────────
function validateElement(el, idx, errors) {
  const base = `elements[${idx}]`
  if (!isObj(el)) {
    pushErr(errors, base, 'INVALID_TYPE', '元素必须是对象')
    return
  }
  if (!isNonEmptyStr(el.id)) {
    pushErr(errors, `${base}.id`, 'MISSING', '元素 id 必须是非空字符串')
  }
  if (!ELEMENT_TYPES.includes(el.type)) {
    pushErr(errors, `${base}.type`, 'INVALID_TYPE',
      `元素 type 必须是 ${ELEMENT_TYPES.join('/')} 之一，收到 ${JSON.stringify(el.type)}`)
    return
  }
  switch (el.type) {
    case 'text':
      if (!isFiniteNum(el.x)) pushErr(errors, `${base}.x`, 'NOT_FINITE', 'x 必须是有限数字')
      if (!isFiniteNum(el.y)) pushErr(errors, `${base}.y`, 'NOT_FINITE', 'y 必须是有限数字')
      if (!isFiniteNum(el.w) || el.w <= 0) pushErr(errors, `${base}.w`, 'OUT_OF_RANGE', 'w 必须是 >0 的有限数字')
      if (!isFiniteNum(el.h) || el.h <= 0) pushErr(errors, `${base}.h`, 'OUT_OF_RANGE', 'h 必须是 >0 的有限数字')
      if (typeof el.text !== 'string') pushErr(errors, `${base}.text`, 'INVALID_TYPE', 'text 必须是字符串')
      if (el.fontSize !== undefined && (!isFiniteNum(el.fontSize) || el.fontSize <= 0))
        pushErr(errors, `${base}.fontSize`, 'OUT_OF_RANGE', 'fontSize 必须是 >0 的有限数字')
      if (el.rotation !== undefined && !isFiniteNum(el.rotation))
        pushErr(errors, `${base}.rotation`, 'NOT_FINITE', 'rotation 必须是有限数字')
      if (el.color !== undefined && !isNonEmptyStr(el.color))
        pushErr(errors, `${base}.color`, 'INVALID_TYPE', 'color 必须是非空字符串')
      break
    case 'rect':
      for (const k of ['x', 'y', 'w', 'h']) {
        if (!isFiniteNum(el[k])) pushErr(errors, `${base}.${k}`, 'NOT_FINITE', `${k} 必须是有限数字`)
      }
      if (isFiniteNum(el.w) && el.w <= 0) pushErr(errors, `${base}.w`, 'OUT_OF_RANGE', 'w 必须 >0')
      if (isFiniteNum(el.h) && el.h <= 0) pushErr(errors, `${base}.h`, 'OUT_OF_RANGE', 'h 必须 >0')
      if (el.fill !== undefined && !isNonEmptyStr(el.fill)) pushErr(errors, `${base}.fill`, 'INVALID_TYPE', 'fill 必须是非空字符串')
      if (el.stroke !== undefined && !isNonEmptyStr(el.stroke)) pushErr(errors, `${base}.stroke`, 'INVALID_TYPE', 'stroke 必须是非空字符串')
      if (el.strokeWidth !== undefined && (!isFiniteNum(el.strokeWidth) || el.strokeWidth < 0))
        pushErr(errors, `${base}.strokeWidth`, 'OUT_OF_RANGE', 'strokeWidth 必须 >=0')
      if (el.rx !== undefined && (!isFiniteNum(el.rx) || el.rx < 0))
        pushErr(errors, `${base}.rx`, 'OUT_OF_RANGE', 'rx 必须 >=0')
      break
    case 'line':
    case 'arrow':
      for (const k of ['x1', 'y1', 'x2', 'y2']) {
        if (!isFiniteNum(el[k])) pushErr(errors, `${base}.${k}`, 'NOT_FINITE', `${k} 必须是有限数字`)
      }
      if (el.stroke !== undefined && !isNonEmptyStr(el.stroke)) pushErr(errors, `${base}.stroke`, 'INVALID_TYPE', 'stroke 必须是非空字符串')
      if (el.strokeWidth !== undefined && (!isFiniteNum(el.strokeWidth) || el.strokeWidth < 0))
        pushErr(errors, `${base}.strokeWidth`, 'OUT_OF_RANGE', 'strokeWidth 必须 >=0')
      if (el.type === 'arrow' && el.markerEnd !== undefined && !ARROW_MARKERS.includes(el.markerEnd))
        pushErr(errors, `${base}.markerEnd`, 'INVALID_TYPE', `markerEnd 必须是 ${ARROW_MARKERS.join('/')} 之一`)
      break
    case 'mermaid':
      if (!isFiniteNum(el.x)) pushErr(errors, `${base}.x`, 'NOT_FINITE', 'x 必须是有限数字')
      if (!isFiniteNum(el.y)) pushErr(errors, `${base}.y`, 'NOT_FINITE', 'y 必须是有限数字')
      if (!isFiniteNum(el.w) || el.w <= 0) pushErr(errors, `${base}.w`, 'OUT_OF_RANGE', 'w 必须 >0')
      if (!isFiniteNum(el.h) || el.h <= 0) pushErr(errors, `${base}.h`, 'OUT_OF_RANGE', 'h 必须 >0')
      if (!isNonEmptyStr(el.source)) pushErr(errors, `${base}.source`, 'MISSING', 'source 必须是非空字符串（mermaid 源码）')
      if (el.theme !== undefined && !MERMAID_THEMES.includes(el.theme))
        pushErr(errors, `${base}.theme`, 'INVALID_TYPE', `theme 必须是 ${MERMAID_THEMES.join('/')} 之一`)
      break
  }
}

function validateScene(scene, errors) {
  if (!isObj(scene)) {
    pushErr(errors, '$', 'INVALID_TYPE', '场景必须是对象')
    return
  }
  if (scene.version !== SCENE_VERSION) {
    pushErr(errors, 'version', 'BAD_VERSION',
      `version 必须是 ${SCENE_VERSION}，收到 ${JSON.stringify(scene.version)}`)
  }
  if (scene.lesson !== undefined && !isInt(scene.lesson, 1))
    pushErr(errors, 'lesson', 'OUT_OF_RANGE', 'lesson 必须是 >=1 的整数')
  if (scene.rev !== undefined && !isInt(scene.rev, 0))
    pushErr(errors, 'rev', 'OUT_OF_RANGE', 'rev 必须是 >=0 的整数')
  if (scene.label !== undefined && typeof scene.label !== 'string')
    pushErr(errors, 'label', 'INVALID_TYPE', 'label 必须是字符串')
  if (scene.canvas !== undefined) {
    if (!isObj(scene.canvas)) {
      pushErr(errors, 'canvas', 'INVALID_TYPE', 'canvas 必须是对象')
    } else {
      if (!isFiniteNum(scene.canvas.width) || scene.canvas.width <= 0)
        pushErr(errors, 'canvas.width', 'OUT_OF_RANGE', 'canvas.width 必须 >0')
      if (!isFiniteNum(scene.canvas.height) || scene.canvas.height <= 0)
        pushErr(errors, 'canvas.height', 'OUT_OF_RANGE', 'canvas.height 必须 >0')
      if (scene.canvas.background !== undefined && !isNonEmptyStr(scene.canvas.background))
        pushErr(errors, 'canvas.background', 'INVALID_TYPE', 'canvas.background 必须是非空字符串')
    }
  }
  if (!Array.isArray(scene.elements)) {
    pushErr(errors, 'elements', 'INVALID_TYPE', 'elements 必须是数组')
    return
  }
  if (scene.elements.length > MAX_ELEMENTS) {
    pushErr(errors, 'elements', 'OVER_LIMIT', `元素数量 ${scene.elements.length} 超过上限 ${MAX_ELEMENTS}`)
  }
  const seen = new Set()
  for (let i = 0; i < scene.elements.length; i++) {
    validateElement(scene.elements[i], i, errors)
    const id = scene.elements[i] && scene.elements[i].id
    if (isNonEmptyStr(id)) {
      if (seen.has(id)) pushErr(errors, `elements[${i}].id`, 'DUPLICATE_ID', `元素 id 重复：${id}`)
      seen.add(id)
    }
  }
}

// ── 单元素归一化（假设已通过校验；按固定 key 顺序产出，保证往返稳定） ──────────
function normalizeElement(el) {
  const out = { id: el.id, type: el.type }
  switch (el.type) {
    case 'text':
      out.x = el.x; out.y = el.y; out.w = el.w; out.h = el.h
      out.text = el.text
      out.fontSize = el.fontSize ?? DEFAULTS.text.fontSize
      out.color = el.color ?? DEFAULTS.text.color
      out.rotation = el.rotation ?? DEFAULTS.text.rotation
      break
    case 'rect':
      out.x = el.x; out.y = el.y; out.w = el.w; out.h = el.h
      out.fill = el.fill ?? DEFAULTS.rect.fill
      out.stroke = el.stroke ?? DEFAULTS.rect.stroke
      out.strokeWidth = el.strokeWidth ?? DEFAULTS.rect.strokeWidth
      out.rx = el.rx ?? DEFAULTS.rect.rx
      break
    case 'line':
      out.x1 = el.x1; out.y1 = el.y1; out.x2 = el.x2; out.y2 = el.y2
      out.stroke = el.stroke ?? DEFAULTS.line.stroke
      out.strokeWidth = el.strokeWidth ?? DEFAULTS.line.strokeWidth
      break
    case 'arrow':
      out.x1 = el.x1; out.y1 = el.y1; out.x2 = el.x2; out.y2 = el.y2
      out.stroke = el.stroke ?? DEFAULTS.arrow.stroke
      out.strokeWidth = el.strokeWidth ?? DEFAULTS.arrow.strokeWidth
      out.markerEnd = el.markerEnd ?? 'arrow'
      break
    case 'mermaid':
      out.x = el.x; out.y = el.y; out.w = el.w; out.h = el.h
      out.source = el.source
      out.theme = el.theme ?? DEFAULTS.mermaid.theme
      break
  }
  return out
}

function normalizeScene(scene) {
  const out = {
    version: SCENE_VERSION,
    rev: scene.rev ?? 0,
    lesson: scene.lesson ?? null,
    label: scene.label ?? '',
    canvas: {
      width: scene.canvas?.width ?? DEFAULTS.canvas.width,
      height: scene.canvas?.height ?? DEFAULTS.canvas.height,
      background: scene.canvas?.background ?? DEFAULTS.canvas.background,
    },
    elements: scene.elements.map(normalizeElement),
  }
  return out
}

/**
 * check —— 校验场景，不修正。
 * @returns {{ok:true, value:object} | {ok:false, errors:Array<{path,code,message}>}}
 */
export function check(scene) {
  const errors = []
  validateScene(scene, errors)
  if (errors.length) return { ok: false, errors }
  return { ok: true, value: normalizeScene(scene) }
}

/**
 * normalize —— 校验通过则返回归一化深拷贝（固定 key 顺序 + 补可选默认值）；失败抛错。
 * 注意：仅对「可选且缺失」的字段填默认值，绝不静默修正非法值（非法值已被 check 拒掉）。
 */
export function normalize(scene) {
  const r = check(scene)
  if (!r.ok) {
    const msg = r.errors.map((e) => `${e.path}: ${e.message}`).join('; ')
    throw new Error('whiteboard.scene 非法: ' + msg)
  }
  return r.value
}

/**
 * serialize —— 归一化后序列化为 JSON 字符串（2 空格缩进）。**不截断**。
 * 超限（>2MiB）抛错，不静默裁剪。
 */
export function serialize(scene) {
  const value = normalize(scene)
  const text = JSON.stringify(value, null, 2)
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > MAX_BYTES) {
    throw new Error(`whiteboard.scene 序列化产物 ${bytes} 字节，超过 2MiB 上限（${MAX_BYTES}）`)
  }
  return text
}

/**
 * parse —— 字符串 → 场景对象（先 JSON.parse，再 normalize）。非法 JSON 或非法场景均抛错。
 * 与 serialize 构成往返：parse(serialize(s)) 深等于 normalize(s)。
 */
export function parse(text) {
  if (typeof text !== 'string') throw new Error('parse 入参必须是字符串')
  let obj
  try {
    obj = JSON.parse(text)
  } catch (e) {
    throw new SyntaxError('whiteboard.scene 不是合法 JSON: ' + e.message)
  }
  return normalize(obj)
}

// ── SVG 渲染模型 / 元素渲染 ────────────────────────────────────────────────────
/** 元素渲染模型（供面板/SVG 直接使用；mermaid 只给源与主题，真渲染走 S7）。 */
export function elementModel(el) {
  return normalizeElement(el)
}

/** sceneToSvgModel —— 整场渲染模型：画布尺寸 + 归一化后的元素列表。 */
export function sceneToSvgModel(scene) {
  const v = normalize(scene)
  return {
    width: v.canvas.width,
    height: v.canvas.height,
    background: v.canvas.background,
    elements: v.elements.map(elementModel),
  }
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** renderElement —— 单个元素 → SVG 片段字符串。 */
export function renderElement(el) {
  const m = normalizeElement(el)
  switch (m.type) {
    case 'text': {
      const rot = m.rotation ? ` transform="rotate(${m.rotation} ${m.x} ${m.y})"` : ''
      return `<g class="wb-text"${rot}>` +
        `<text x="${m.x}" y="${m.y + m.fontSize}" font-size="${m.fontSize}" fill="${m.color}">${esc(m.text)}</text>` +
        `</g>`
    }
    case 'rect':
      return `<rect class="wb-rect" x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" ` +
        `rx="${m.rx}" fill="${m.fill}" stroke="${m.stroke}" stroke-width="${m.strokeWidth}"/>`
    case 'line':
      return `<line class="wb-line" x1="${m.x1}" y1="${m.y1}" x2="${m.x2}" y2="${m.y2}" ` +
        `stroke="${m.stroke}" stroke-width="${m.strokeWidth}"/>`
    case 'arrow': {
      const mid = `arrow-${m.id}`
      return `<g class="wb-arrow">` +
        `<defs><marker id="${mid}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
        `<path d="M0,0 L10,5 L0,10 z" fill="${m.stroke}"/></marker></defs>` +
        `<line x1="${m.x1}" y1="${m.y1}" x2="${m.x2}" y2="${m.y2}" stroke="${m.stroke}" ` +
        `stroke-width="${m.strokeWidth}" marker-end="url(#${mid})"/></g>`
    }
    case 'mermaid':
      // 集成缝：data-source / data-theme 由 S7 面板读取后交给 vendored mermaid 真渲染。
      return `<g class="wb-mermaid" data-source="${esc(m.source)}" data-theme="${m.theme}">` +
        `<rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" rx="8" ` +
        `fill="#0d1117" stroke="#30363d" stroke-width="1"/>` +
        `<text x="${m.x + 10}" y="${m.y + 20}" font-size="12" fill="#8b949e">mermaid</text></g>`
    default:
      // 不可达：normalizeElement 已保证 type 合法
      throw new Error('未知元素类型: ' + m.type)
  }
}

/** renderScene —— 整场 → 完整 <svg> 字符串（组合 sceneToSvgModel + renderElement）。 */
export function renderScene(scene) {
  const model = sceneToSvgModel(scene)
  const body = model.elements.map((el) => renderElement(el)).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${model.width}" height="${model.height}" ` +
    `viewBox="0 0 ${model.width} ${model.height}" style="background:${model.background}">${body}</svg>`
}

// ── 命中测试 ───────────────────────────────────────────────────────────────────
function bbox(el) {
  switch (el.type) {
    case 'text':
    case 'rect':
    case 'mermaid':
      return { x0: el.x, y0: el.y, x1: el.x + el.w, y1: el.y + el.h }
    case 'line':
    case 'arrow':
      return {
        x0: Math.min(el.x1, el.x2), y0: Math.min(el.y1, el.y2),
        x1: Math.max(el.x1, el.x2), y1: Math.max(el.y1, el.y2),
      }
    default:
      return null
  }
}

/**
 * hitTest —— 返回包含点 {x,y} 的「最上层」元素 id（数组末尾 = 后绘制 = 最上层）。
 * 无命中返回 null。
 */
export function hitTest(scene, point) {
  if (!isObj(point) || !isFiniteNum(point.x) || !isFiniteNum(point.y)) {
    throw new Error('hitTest 入参 point 必须是 {x,y} 有限数字')
  }
  const v = normalize(scene)
  let hit = null
  for (const el of v.elements) {
    const b = bbox(el)
    if (!b) continue
    if (point.x >= b.x0 && point.x <= b.x1 && point.y >= b.y0 && point.y <= b.y1) hit = el.id
  }
  return hit
}

// ── 编辑（不可变；返回新场景） ─────────────────────────────────────────────────
function revalidate(next) {
  // 把「编辑后可能非法」的状态显式抛出，绝不静默放过。
  return normalize({ ...next, elements: next.elements })
}

/**
 * applyEdit —— 对场景做不可变编辑，返回**新归一化场景**（不修改入参）。
 * @param {object} scene
 * @param {{op:string, element?:object, id?:string, patch?:object, elements?:Array<object>, canvas?:object}} edit
 *   op: 'add' | 'update' | 'remove' | 'replace' | 'setCanvas'
 * 找不到目标 / 重复 id / 结果非法 → 抛错（不静默）。
 */
export function applyEdit(scene, edit) {
  if (!isObj(edit)) throw new Error('edit 必须是对象')
  const v = clone(normalize(scene))
  switch (edit.op) {
    case 'add': {
      if (!isObj(edit.element)) throw new Error("op='add' 需要 element")
      if (v.elements.some((e) => e.id === edit.element.id)) {
        throw new Error(`add 失败：id 已存在 ${edit.element.id}`)
      }
      return revalidate({ ...v, elements: [...v.elements, edit.element] })
    }
    case 'update': {
      if (!isNonEmptyStr(edit.id)) throw new Error("op='update' 需要 id")
      const idx = v.elements.findIndex((e) => e.id === edit.id)
      if (idx < 0) throw new Error(`update 失败：找不到 id ${edit.id}`)
      if (!isObj(edit.patch)) throw new Error("op='update' 需要 patch 对象")
      const merged = { ...v.elements[idx], ...edit.patch, id: edit.id }
      const next = [...v.elements]; next[idx] = merged
      return revalidate({ ...v, elements: next })
    }
    case 'remove': {
      if (!isNonEmptyStr(edit.id)) throw new Error("op='remove' 需要 id")
      const next = v.elements.filter((e) => e.id !== edit.id)
      if (next.length === v.elements.length) throw new Error(`remove 失败：找不到 id ${edit.id}`)
      return revalidate({ ...v, elements: next })
    }
    case 'replace': {
      if (!Array.isArray(edit.elements)) throw new Error("op='replace' 需要 elements 数组")
      return revalidate({ ...v, elements: edit.elements })
    }
    case 'setCanvas': {
      if (!isObj(edit.canvas)) throw new Error("op='setCanvas' 需要 canvas 对象")
      return revalidate({ ...v, canvas: edit.canvas })
    }
    default:
      throw new Error(`未知 edit.op: ${JSON.stringify(edit.op)}`)
  }
}
