// lib/prep.mjs — 「备课」的**数据层**（纯函数：声明解析与校验 ＋ 缓存键）。
//
// 🔴 这一层回答的是用户原话里的那个问题：
//   *"难道'备课'？比如下一轮对话要用到，这一轮开始的时候先让子代理开始跑？可能吗？"*
//   答案是**可能的，但有一个硬前提**：**这一轮必须已经知道下一轮要用什么**。
//   模型猜不出来（学生下一句问什么，谁也猜不到）；**只有课程数据能预先声明**。
//   → 所以本模块存在的意义就是给"预先知道"一个**可校验的落点**：教室在 `classroom.yaml` 里
//     写清楚"第 N 讲要放哪几段动画、用哪个模板、参数是什么"，引擎在上课前就能把它们全起起来。
//
// 与 lib/animation.mjs / lib/animtemplates.mjs 的分工：
//   · animation.mjs    —— 模型自己写的脚本（收什么验什么）；
//   · animtemplates.mjs—— 引擎按参数拼脚本（模板层）；
//   · **prep.mjs**     —— 「哪几段、什么时候要、参数是多少」这份**课程数据**的形状与校验。
//   三者最终都落到同一条落盘/渲染/通报链路（lib/animationstore.mjs）。
//
// ── 声明格式（写进 classroom.yaml 顶层 `prep:` 段；格式即契约）────────────────────
//
//   prep:
//     items:
//       - id: fifo-vs-sjf              # 必填，本教室内唯一（老师课上按这个 id 取用）
//         lesson: 3                    # 必填，讲次（整数；本教室用讲次门时必须是讲次号）
//         template: timeline           # 必填，模板 id（见 lib/animtemplates.mjs）
//         title: 长任务怎么堵住短任务？  # 必填，写进动画索引
//         params: {...}                # 必填，模板参数（形状由模板定，校验在模板里）
//         material: materials/ch03.md  # 必填，**相对教室目录**：缓存键的教材哈希来源
//         caption: ...                 # 可选，一句话说明这段动画针对什么误解
//
// 🔴 三条设计口径（都是被"静默失效"坑出来的）：
//   ① `template` 与 `params` 必须**当场校验**（复用模板自己的校验器，报错文案与工具路径逐字相同）
//      —— 写错一个参数不该等到上课预热时才炸；
//   ② 声明了 `prep:` 却没有 `animation: {enabled: true}` → **报错**（死配置：预热跑不了、工具也没有）；
//   ③ `material` 必须指向教室目录内的真实文件 —— 它是缓存键的输入，指向不存在的文件
//      等于"缓存永远不命中"，而那种失败**不会报错、只会每次都重渲**（最难查的一类）。
//      （文件是否**存在**在这里校验；内容哈希在预热时算，见 lib/prepstore.mjs。）

import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { checkTemplateArgs, getTemplate } from './animtemplates.mjs'

/** `prep:` 段允许出现的键（多写一个键＝报错，不静默忽略）。 */
export const PREP_KEYS = ['items']
/** `prep.items[]` 允许出现的键。 */
export const PREP_ITEM_KEYS = ['id', 'lesson', 'template', 'title', 'params', 'material', 'caption', 'required']

/** 同一段动画最多自动重试几次（含第一次）——失败两次就不再来，改由老师换路。 */
export const MAX_PREP_ATTEMPTS = 2

/** 缓存键的版本前缀：**键的算法本身**变了要 +1（否则新旧键会互相命中）。 */
export const PREP_CACHE_KEY_VERSION = 'v1'

/**
 * 参数规范化成**稳定字符串**（键排序、数字归一）。
 *
 * 🔴 为什么不能直接 `JSON.stringify`：对象键顺序在 JS 里是插入序，两个语义相同的参数
 *    写成不同顺序会算出**两个不同的缓存键** → 同一段动画被渲两遍，而缓存看起来"没命中"。
 */
export function canonicalParams(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(canonicalParams).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalParams(value[k])}`).join(',')}}`
}

/**
 * 缓存键：**讲次 ＋ 教材内容哈希 ＋ 模板（含版本）＋ 参数**。
 *
 * 🔴 为什么是这四个（逐条对应用户要的"同一个动画只生成一次"）：
 *   · **讲次**：同一段动画在不同讲是两次不同的教学事件（索引行、通报、课后回看都按讲次归类）；
 *   · **教材内容哈希**：教材改了 → 这段动画讲的例子可能已经过时 → **必须重做**。
 *     这是"内容变了缓存自动失效"的唯一凭据（用 mtime 判会误判：rsync/checkout 都会改 mtime）；
 *   · **模板版本**：模板生成逻辑改了 → 旧片子不是新模板的产物 → 必须重做；
 *   · **参数**：同模板不同参数当然是两段片子。
 *
 * ⚠️ 老实说一个**已知的取舍**：讲次进键 ⇒ 两讲声明了**逐字相同**的一段动画时会各渲一次。
 *    本项目里教材按讲分文件（materials/ch03.md 与 ch05.md 内容不同），哈希本来就不同，
 *    所以这条在实践中不产生额外成本；真要跨讲共享，把 lesson 从键里去掉即可（见报告「待确认」）。
 *
 * @param {{lesson:number|null, template:string, templateVersion:number, params:unknown, materialSha256:string}} input
 */
export function prepCacheKey({ lesson, template, templateVersion, params, materialSha256 }) {
  const material = typeof materialSha256 === 'string' && materialSha256 !== '' ? materialSha256 : 'no-material'
  const payload = [
    PREP_CACHE_KEY_VERSION,
    `lesson=${lesson === null || lesson === undefined ? 'none' : lesson}`,
    `template=${template}@${templateVersion}`,
    `material=${material}`,
    `params=${canonicalParams(params)}`,
  ].join('|')
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

/** 教材内容哈希（预热时用；纯函数，输入是文件正文）。 */
export function hashMaterial(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 与 manifest.mjs 同形的行号定位器（复用它的报错风格：作者能照着改）。 */
function whereAt(path, loc) {
  const line = typeof loc === 'function' ? loc(path) : 1
  return `${path.join('.')}（第 ${line} 行）`
}

function isPlainMap(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 规范化顶层 `prep:` 段。**纯函数**（只读 material 文件的**存在性**，不算哈希）。
 *
 * @param {unknown} raw
 * @param {{loc?:(path:(string|number)[])=>number, baseDir?:string, ManifestError?:Function, classroomLessons?:number|null}} ctx
 * @returns {{items: object[]}}
 */
export function normalizePrep(raw, ctx = {}) {
  const Fail = ctx.ManifestError ?? Error
  const loc = ctx.loc ?? (() => 1)
  const at = (path) => whereAt(path, loc)

  if (!isPlainMap(raw)) {
    throw new Fail(`${at(['prep'])}必须是映射（写成 prep: {items: [...]}；不预先备课就整段删掉）`)
  }
  for (const key of Object.keys(raw)) {
    if (!PREP_KEYS.includes(key)) {
      throw new Fail(`${at(['prep'])} 无法识别的键 ${JSON.stringify(key)}（可用：${PREP_KEYS.join(' / ')}）`)
    }
  }
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw new Fail(
      `${at(['prep', 'items'])} 必须是非空数组：一条 = 一段要在上课前预先渲染好的动画` +
        `（不预先备课就整段删掉 prep:）`,
    )
  }
  const seen = new Set()
  const items = raw.items.map((item, i) => {
    const iat = at(['prep', 'items', i])
    if (!isPlainMap(item)) throw new Fail(`${iat} 必须是映射`)
    for (const key of Object.keys(item)) {
      if (!PREP_ITEM_KEYS.includes(key)) {
        throw new Fail(`${iat} 无法识别的键 ${JSON.stringify(key)}（可用：${PREP_ITEM_KEYS.join(' / ')}）`)
      }
    }
    const id = item.id
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      throw new Fail(
        `${iat}.id 必须是小写字母/数字/连字符（得到 ${JSON.stringify(id)}）——` +
          `老师在课上用这个 id 取用，它也是日志里的键`,
      )
    }
    if (seen.has(id)) throw new Fail(`${iat}.id 重复：${id}`)
    seen.add(id)

    if (!Number.isInteger(item.lesson) || item.lesson < 1) {
      throw new Fail(`${iat}.lesson 必须是 ≥ 1 的整数（得到 ${JSON.stringify(item.lesson)}）`)
    }
    if (ctx.classroomLessons !== null && ctx.classroomLessons !== undefined && item.lesson > ctx.classroomLessons) {
      throw new Fail(
        `${iat}.lesson = ${item.lesson} 超过了本教室声明的讲数 ${ctx.classroomLessons}` +
          `（classroom.lessons）——这条声明永远不会被用到`,
      )
    }

    const template = getTemplate(item.template)
    if (template === null) {
      throw new Fail(
        `${iat}.template 必须是已注册的模板 id（得到 ${JSON.stringify(item.template)}）——` +
          `可用的模板见 lib/animtemplates.mjs 的 TEMPLATES`,
      )
    }
    if (typeof item.title !== 'string' || item.title.trim() === '') {
      throw new Fail(`${iat}.title 必填：一句话说清这段动画讲什么（会写进动画索引）`)
    }
    // 🔴 复用**工具路径同一个校验器**：写错的报错文案与老师在课堂上调工具时逐字相同，
    //    这样"课前写声明"与"课上现生成"两条路不会各有一套判据。
    const check = checkTemplateArgs({ template: item.template, params: item.params, title: item.title })
    if (!check.ok) {
      throw new Fail(
        `${iat} 的模板参数不合法（与课堂上调 classroom_animate_template 同一套判据）：\n- ` +
          check.problems.join('\n- '),
      )
    }

    const material = item.material
    if (typeof material !== 'string' || material.trim() === '') {
      throw new Fail(
        `${iat}.material 必填：它是**缓存键的教材哈希来源**（例如 materials/ch03.md，相对教室目录）。` +
          `不写它就没有"教材改了要重做"这条判据，缓存会永远命中一份过时的片子。`,
      )
    }
    if (isAbsolute(material)) {
      throw new Fail(`${iat}.material 必须是**相对教室目录**的路径（得到绝对路径 ${material}）`)
    }
    if (ctx.baseDir !== undefined && ctx.baseDir !== null && !existsSync(resolve(ctx.baseDir, material))) {
      throw new Fail(
        `${iat}.material 指向的文件不存在：${resolve(ctx.baseDir, material)}。` +
          `它不存在 ⇒ 缓存键永远算不出来 ⇒ 每次上课都会重渲一遍（这种失败不会报错，只会在账上多花钱）。`,
      )
    }

    let caption = ''
    if (item.caption !== undefined && item.caption !== null) {
      if (typeof item.caption !== 'string') throw new Fail(`${iat}.caption 必须是字符串`)
      if (item.caption.length > 500) throw new Fail(`${iat}.caption 过长：${item.caption.length} > 500 字符`)
      caption = item.caption.trim()
    }
    let required = true
    if (item.required !== undefined && item.required !== null) {
      if (typeof item.required !== 'boolean') throw new Fail(`${iat}.required 必须是布尔值`)
      required = item.required
    }

    return {
      id,
      lesson: item.lesson,
      template: template.id,
      templateVersion: template.version,
      sceneClass: template.sceneClass,
      title: item.title.trim(),
      params: check.params,
      material,
      caption,
      required,
    }
  })
  return { items }
}

/** 取某一讲的备课清单（没有 prep 段或没有这一讲 → 空数组）。纯函数。 */
export function prepItemsForLesson(manifest, lesson) {
  const items = manifest?.prep?.items ?? []
  if (lesson === null || lesson === undefined) return []
  return items.filter((item) => item.lesson === lesson)
}

/**
 * 把一份备课计划渲染成**给老师看的一段文字**（预热结果）。纯函数。
 *
 * 🔴 口径与 animation.mjs 的 describeState 一致：说状态就说**能不能用**，并给出出路。
 * @param {{lesson:number|null, entries:{id:string, title:string, state:string, taskId?:string|null,
 *   artifact?:string|null, reason?:string|null, attempts?:number}[]}} plan
 */
export function describePrepPlan(plan) {
  const entries = plan.entries ?? []
  if (entries.length === 0) {
    return `第 ${plan.lesson ?? '?'} 讲没有预先声明的动画（教室的 classroom.yaml 里没有对应的 prep.items）。`
  }
  const usable = entries.filter((e) => e.state === 'cached' || e.state === 'queued' || e.state === 'rendering')
  const bad = entries.filter((e) => e.state === 'blocked' || e.state === 'failed' || e.state === 'give-up')
  const lines = [
    `第 ${plan.lesson} 讲预先声明的动画共 ${entries.length} 段｜可用/在跑 ${usable.length}｜` +
      `不许播或没渲出来 ${bad.length}`,
  ]
  for (const e of entries) {
    const head = `· ${e.id}（${e.title}）`
    if (e.state === 'cached') lines.push(`${head} **已就绪（命中缓存，基本不用等）**：${e.artifact}`)
    else if (e.state === 'queued' || e.state === 'rendering') lines.push(`${head} 正在预热：${e.taskId}`)
    else if (e.state === 'blocked') lines.push(`${head} **闸门判不通过，不许播**：${e.reason ?? '（无原因）'}`)
    else if (e.state === 'failed') lines.push(`${head} **没渲出来**：${e.reason ?? '（无原因）'}`)
    else if (e.state === 'give-up') lines.push(`${head} **已放弃自动重试**（试了 ${e.attempts ?? 0} 次）：${e.reason ?? ''}`)
    else lines.push(`${head} 状态未知：${e.state}`)
  }
  if (bad.length > 0) {
    lines.push('→ 这些段别等它了：讲到那一步改用 `classroom_draw` 画一张板书图讲完，或现场用 classroom_animate 自己写一段。')
  }
  return lines.join('\n')
}
