/**
 * classroom-stage-warm —— SocraticNovel「教室舞台」客户端插件 · **宿主半边**
 * ==========================================================================
 * 只做两件事（其余全在浏览器半边 lib/client.js）：
 *
 *   1. **素材静态路由** `/stage-static/*`（loopback-only）
 *      - `GET /stage-static/manifest.json` → 舞台素材清单（本包 assets/stage/ 下的文件）
 *      - `GET /stage-static/assets/<文件名>` → 素材原图（PNG）
 *      - `GET /stage-static/health`        → 自检（宿主侧看到什么、客户端半边有没有报到）
 *
 *   2. **设置持久化** `ctx.settings.register('classroom-stage-warm', …)`
 *      → 落进 `$DSH_HOME/settings.yaml`（**宽松 schema ＋ 代码内归一化**，注册不可能失败）
 *
 * ★★ 为什么这个文件写得这么"怂"（每一层 try/catch + 逐项降级）
 * ==========================================================================
 * 皮肤一旦进了 `dsh.profile.bundles`，它就从"一个插件"变成"**启动链路的一部分**"：
 * 包名/目录/package.json 一坏 → **整个 profile 起不来**，而报错发生在加载任何插件之前，
 * **代码层面兜不住**。所以这一半只可能"少干活"，不可能"把 DSH 弄挂"：
 *   · `apply()` 整体包在 try/catch 里，任何异常都不向上抛
 *   · 两个子系统各自独立 try/catch（一块坏了不影响另一块）
 *   · 设置用**可调用鸭子类型 schema**（不 import 任何外部包 ⇒ 少一个模块解析点）
 *   · 支持 **安全模式**（`SAFE_MODE` 文件 / `STAGE_WARM_SAFE=1`），命中即完全不注册
 *
 * ★ 已知不需要的东西（避免多两个失败点）：
 *   · **不 import `@deepseek-ai/schemastery`**、**不 import `@deepseek-ai/dsh-tools`**
 *   · 宿主半边**不需要** `dsh.bundle` 声明之外的任何配置（`cordis.patch.yml` 只有一条 insert）
 *
 * 出处：装载链路与三层保险的实测见
 *   `docs/历史报告/实测_Avalon皮肤装载链路_2026-09-30.md`
 * ==========================================================================
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'classroom-stage-warm'
export const inject = ['webServer', 'settings']

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const ROUTE_BASE = '/stage-static'
/** 板书闭环（契约 K2.2）与情绪通道（K1.4）的路由前缀。 */
const BOARD_ROUTE = '/stage-board'
const SETTINGS_NS = 'classroom-stage-warm'
const ASSET_DIR = path.join(PKG_ROOT, 'assets', 'stage')
// 🔴 2026-10-19：Live2D 接入新增两个静态根 —— 运行时库与模型目录。
//    和 stage/ 一样只走 loopback、同样的目录穿越防护。
const L2D_LIB_DIR = path.join(PKG_ROOT, 'assets', 'l2d')
const MODEL_DIR = path.join(PKG_ROOT, 'assets', 'models')
const BOARD_DIR = path.join(PKG_ROOT, 'assets', 'board')
const ANIM_DIR = path.join(PKG_ROOT, 'assets', 'anim')

const MIME = {
  '.json': 'application/json; charset=utf-8',
  '.moc3': 'application/octet-stream',   // Live2D 模型本体（二进制）
  '.js': 'text/javascript; charset=utf-8',  // 本地运行时库（PIXI / Cubism Core / display）
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
}

const DEFAULTS = {
  enabled: true,          // 舞台总开关（关掉＝退回 DSH 原生界面）
  character: 'teacher',   // 当前立绘（'teacher' | 'none'）
  showSprite: true,       // 显示立绘
  showBand: true,         // 显示正文纸带
  // ── 板书闭环 / 情绪通道用到的两个定位项（契约 K2.2、K1.4）──────────────
  classroom: 'cs-os',     // 教室目录名（`classrooms/<这个名字>/`）
  workspaceRoot: '',      // 工作区根；留空＝按「登记表 → cwd」自动找（见 classroomRootOf）
}

/** 客户端半边报到状态（自检用：区分"bundle 没到浏览器"与"到了但没渲染"）。 */
const diag = {
  hostStartedAt: new Date().toISOString(),
  clientSeen: false,
  clientReports: [],
  warnings: [],
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/**
 * 🔴 取 logger 必须"先取再调级别方法"——不能把参数塞给 `ctx.logger()`。
 * cordis 的 `ctx.logger(name)` 只接受一个参数，多给的会被丢弃、返回的 Logger 被抛弃，
 * 于是**插件的报错一条都不落任何地方**（2026-09-24 实证）。级别用 `info`：默认门限下
 * 只有 `info` 及以下可见，`warn`/`debug` 会被静默跳过 —— 想要"一定能被看见"就用 `info`。
 */
function log(level, msg, err) {
  try {
    const lg = ctxRef && ctxRef.logger && ctxRef.logger(name)
    if (lg && typeof lg[level] === 'function') {
      lg[level]('[stage-warm] ' + msg, err || '')
      return
    }
  } catch { /* 日志是尽力而为，绝不因它抛错 */ }
  try { console.log('[stage-warm] ' + msg) } catch { /* ignore */ }
}

function noteWarning(msg) {
  try {
    diag.warnings.push(String(msg).slice(0, 400))
    if (diag.warnings.length > 30) diag.warnings.shift()
  } catch { /* ignore */ }
}

function isLoopback(req) {
  const addr = (req && req.socket && req.socket.remoteAddress) || ''
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function sendJSON(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.statusCode = status
  res.setHeader('content-type', MIME['.json'])
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function sendText(res, status, text) {
  res.statusCode = status
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.end(text)
}

/**
 * 兜底 schema：**可调用 ＋ 有 `toJSON`＋ `~standard` 标记**的鸭子类型。
 * 字段合法性全部交给 normalizeSettings —— 存了脏值也不会让注册失败。
 */
function makeDuckSchema() {
  const fn = function (value) {
    try {
      if (value && typeof value === 'object' && !Array.isArray(value)) return value
      return {}
    } catch {
      return {}
    }
  }
  fn.toJSON = () => ({
    type: 'object',
    additionalProperties: true,
    description: 'classroom-stage-warm loose schema',
  })
  fn['~standard'] = { version: 1, vendor: 'stage-warm-loose' }
  return fn
}

function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULTS.enabled,
    character: typeof s.character === 'string' && s.character ? s.character : DEFAULTS.character,
    showSprite: typeof s.showSprite === 'boolean' ? s.showSprite : DEFAULTS.showSprite,
    showBand: typeof s.showBand === 'boolean' ? s.showBand : DEFAULTS.showBand,
    classroom: typeof s.classroom === 'string' && s.classroom ? s.classroom : DEFAULTS.classroom,
    workspaceRoot: typeof s.workspaceRoot === 'string' ? s.workspaceRoot : DEFAULTS.workspaceRoot,
  }
}

/** 素材清单：目录里真实存在的文件（不写死名单，免得与磁盘漂移）。 */
function listAssets() {
  const out = []
  try {
    for (const ent of fs.readdirSync(ASSET_DIR, { withFileTypes: true })) {
      if (!ent.isFile()) continue
      const ext = path.extname(ent.name).toLowerCase()
      if (!MIME[ext]) continue
      const stat = fs.statSync(path.join(ASSET_DIR, ent.name))
      // 🔴 rev＝mtime：客户端会把它拼成 `?v=<rev>`。换图后 mtime 变 → URL 变 → 浏览器不会拿旧缓存。
      //    （实测踩过：直接把 teacher_gen.png 换掉，页面还在显示旧立绘，因为 URL 没变。）
      out.push({ name: ent.name, bytes: stat.size, mime: MIME[ext], rev: Math.round(stat.mtimeMs) })
    }
  } catch (err) {
    noteWarning('素材目录读取失败：' + String((err && err.message) || err))
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Live2D 模型清单：`assets/models/<名字>/<名字>.model3.json` 的目录名。 */
function listModels() {
  const out = []
  try {
    for (const ent of fs.readdirSync(MODEL_DIR, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue
      const m3 = path.join(MODEL_DIR, ent.name, ent.name + '.model3.json')
      if (!fs.existsSync(m3)) continue
      out.push({ name: ent.name, model3: ent.name + '/' + ent.name + '.model3.json' })
    }
  } catch (err) {
    noteWarning('模型目录读取失败：' + String((err && err.message) || err))
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Live2D 运行时库清单（按加载阶段顺序给出，客户端照此顺序插 script）。 */
function listLibs() {
  const phases = [['pixi.min.js'], ['live2d.min.js', 'live2dcubismcore.min.js', 'index.min.js']]
  return phases
    .map((phase) => phase.filter((f) => fs.existsSync(path.join(L2D_LIB_DIR, f))))
    .filter((phase) => phase.length > 0)
}

/** 板书（whiteboard.scene.v1）清单：目录里真实存在的课次文件。 */
function listBoards() {
  const out = []
  try {
    for (const ent of fs.readdirSync(BOARD_DIR, { withFileTypes: true })) {
      if (ent.isFile() && ent.name.endsWith('.scene.json')) out.push(ent.name.replace(/\.scene\.json$/, ''))
    }
  } catch (err) {
    noteWarning('板书目录读取失败：' + String((err && err.message) || err))
  }
  return out.sort()
}

/** 教学动画清单：`assets/anim/<id>/` 下每个目录算一条（读它的 scene.json 取标签）。 */
function listAnimations() {
  const out = []
  try {
    for (const ent of fs.readdirSync(ANIM_DIR, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue
      let label = ent.name
      try {
        const j = JSON.parse(fs.readFileSync(path.join(ANIM_DIR, ent.name, 'scene.json'), 'utf8'))
        label = j.label || ent.name
      } catch { /* 缺 scene.json 也照样列出来，只是没有标签 */ }
      out.push({ id: ent.name, label: label })
    }
  } catch (err) {
    noteWarning('动画目录读取失败：' + String((err && err.message) || err))
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

/** 安全模式：文件或环境变量任一命中 → 本插件完全不注册任何东西。 */
function safeMode() {
  try {
    if (fs.existsSync(path.join(PKG_ROOT, 'SAFE_MODE'))) return { safe: true, why: 'SAFE_MODE 文件' }
  } catch { /* ignore */ }
  const env = String(process.env.STAGE_WARM_SAFE || '').trim()
  if (env && env !== '0' && env.toLowerCase() !== 'false') return { safe: true, why: 'STAGE_WARM_SAFE=' + env }
  return { safe: false, why: '' }
}

// ---------------------------------------------------------------------------
// 教室目录 / 板书图 / 情绪通道（契约 K2.2、K1.4）
//
// ★ 为什么要"找"教室目录，而不是写死路径
//   ========================================================================
//   舞台是**客户端插件**：它不知道用户在哪个工作区、哪个教室上课（同一份插件会被
//   多个教室复用）。而且宿主进程的 cwd 与"用户打开的工作区"**不一定相同**。
//   所以按**有序候选**解析，并把试过哪些候选一起报出来（`/stage-board/health`），
//   让"读不到图"这件事能从 HTTP 层直接归因，而不是靠猜。
//
//   顺序（先命中先赢，每条都是"看磁盘上真的有这个目录"）：
//     ① settings.workspaceRoot（显式配置，最可信）
//     ② ctx.get('workspaceRegistry').list() 的每个 path（宿主登记的工作区）
//     ③ process.cwd()（兜底：从仓库根启动时就是它）
//   在每个候选下认两种形状：`<candidate>/classrooms/<教室>/` 或 candidate 本身就是教室目录。
//   🔴 这只是"找目录"的确定性顺序，**不是**出错时的静默降级：找不到就一路回 404 并带上 tried。
// ---------------------------------------------------------------------------

const DIAGRAM_ID_RE = /^[A-Za-z0-9_-]+$/
const CLASSROOM_DEFAULT = 'cs-os'

function isDir(p) {
  try { return fs.statSync(p).isDirectory() } catch { return false }
}

/** 一个目录像不像教室目录（有 classroom.yaml 或 runtime/ 就算）。 */
function looksLikeClassroom(p) {
  try {
    if (!isDir(p)) return false
    return fs.existsSync(path.join(p, 'classroom.yaml')) || isDir(path.join(p, 'runtime'))
  } catch { return false }
}

/** 宿主的 workspaceRegistry（未声明 inject ⇒ 只能走 ctx.get，且必须容错）。 */
function listWorkSpaces(ctx) {
  const out = []
  try {
    const reg = ctx && typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : null
    const rows = reg && typeof reg.list === 'function' ? reg.list() : []
    for (const w of Array.isArray(rows) ? rows : []) {
      const p = w && typeof w.path === 'string' ? w.path : ''
      if (p && out.indexOf(p) === -1) out.push(p)
    }
  } catch { /* 没有登记表就跳过这一批候选 */ }
  return out
}

/**
 * 解析教室目录。**纯决策 + 磁盘探测**，返回 `{ dir, source, tried }`；找不到时 `dir: null`。
 * @param {{workspaceRoot?:string, classroom?:string, workspaces?:string[], cwd?:string}} opts
 */
function classroomRootOf(opts) {
  const o = opts || {}
  const dirName = String(o.classroom || CLASSROOM_DEFAULT).replace(/^\/+|\/+$/g, '') || CLASSROOM_DEFAULT
  const tried = []
  const candidates = []
  if (o.workspaceRoot) candidates.push({ path: o.workspaceRoot, why: 'settings.workspaceRoot' })
  for (const w of (o.workspaces || [])) candidates.push({ path: w, why: 'workspaceRegistry' })
  if (o.cwd) candidates.push({ path: o.cwd, why: 'process.cwd' })
  for (const c of candidates) {
    let base
    try { base = path.resolve(String(c.path)) } catch { continue }
    if (tried.indexOf(base) !== -1) continue
    tried.push(base)
    const nested = path.join(base, 'classrooms', dirName)
    if (looksLikeClassroom(nested)) return { dir: nested, source: c.why, tried }
    if (looksLikeClassroom(base)) return { dir: base, source: c.why + '(self)', tried }
  }
  return { dir: null, source: '', tried }
}

/** 当前上下文的教室目录（路由用；每次请求现算，配置改了立刻生效）。 */
function currentClassroom(settings) {
  const s = settings || {}
  return classroomRootOf({
    workspaceRoot: s.workspaceRoot || '',
    classroom: s.classroom || CLASSROOM_DEFAULT,
    workspaces: listWorkSpaces(ctxRef),
    cwd: (function () { try { return process.cwd() } catch { return '' } })(),
  })
}

function diagramsDirOf(classroomDir) {
  return classroomDir ? path.join(classroomDir, 'runtime', 'diagrams') : ''
}

/**
 * 把 URL 里的 `<id>` 解析成板书源文件的绝对路径。**四条拒绝规则逐条独立**，
 * 任一不满足就 400（**不是 500**）：这不是"内部错误"，是客户端送了不该送的东西。
 *
 *   ① 原文必须匹配 `^[A-Za-z0-9_-]+$`
 *   ② `decodeURIComponent` 之后仍必须匹配（`%2e%2e` 这类编码穿越）
 *   ③ `path.resolve` 之后父目录必须**就是**根（单段文件名，不许下钻）
 *   ④ `realpathSync` 之后仍必须在根内（防符号链接指到外面）
 *
 * 缺文件是 404；根目录不存在也是 404（并带 tried，便于归因）。
 *
 * @returns {{ok:true, abs:string, id:string} | {ok:false, status:number, reason:string}}
 */
function resolveDiagramFile(rootDir, rawId) {
  const fail = (status, reason) => ({ ok: false, status: status, reason: reason })
  if (!rootDir) return fail(404, 'no-classroom')
  if (typeof rawId !== 'string' || rawId === '') return fail(400, 'empty-id')
  if (!DIAGRAM_ID_RE.test(rawId)) return fail(400, 'bad-chars')                        // ①
  let decoded
  try { decoded = decodeURIComponent(rawId) } catch { return fail(400, 'bad-encoding') }
  if (!DIAGRAM_ID_RE.test(decoded)) return fail(400, 'bad-chars-after-decode')          // ②
  let realRoot
  try { realRoot = fs.realpathSync(path.resolve(rootDir)) } catch { return fail(404, 'no-diagrams-dir') }
  const abs = path.resolve(rootDir, decoded + '.mmd')
  if (path.dirname(abs) !== path.resolve(rootDir)) return fail(400, 'outside-root')     // ③
  let realAbs
  try { realAbs = fs.realpathSync(abs) } catch { return fail(404, 'file-missing') }
  const rel = path.relative(realRoot, realAbs)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return fail(400, 'symlink-escape')  // ④
  if (!rel.endsWith('.mmd') || !DIAGRAM_ID_RE.test(rel.replace(/\.mmd$/, ''))) return fail(400, 'bad-name')
  return { ok: true, abs: realAbs, id: decoded }
}

/**
 * 索引表格行 → 结构化。
 *
 * 🔴 **按表头名取列，不按固定下标**（2026-10-20 引擎侧给表格末尾加了「会话」列：
 *    回合号在新会话里从 1 重来，只靠「讲次+回合」分不清两次会话）。
 *    老索引没有「会话」列 → `session` 给空串并照常返回，**不许把整个列表判成坏数据**。
 *    表头也认不出时退回位置口径（兼容更早的手写索引）。
 */
function parseIndexRows(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim())
  const cellsOf = (t) => t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  const isRow = (t) => t.startsWith('|') && !/^\|\s*:?-{2,}/.test(t)

  // ① 找表头（含「日期」与「源文件」的那一行），建 列名 → 下标
  const col = {}
  let headerAt = -1
  for (let i = 0; i < lines.length; i++) {
    if (!isRow(lines[i])) continue
    const cells = cellsOf(lines[i])
    if (cells.indexOf('日期') === -1 && cells.indexOf('源文件') === -1) continue
    for (let c = 0; c < cells.length; c++) {
      const name = cells[c].replace(/[`\\]/g, '').trim()
      if (name && col[name] === undefined) col[name] = c
    }
    headerAt = i
    break
  }
  const DEFAULT_COL = { 日期: 0, 讲次: 1, 回合: 2, 图类型: 3, 标题: 4, 说明: 5, 源文件: 6 }
  const at = (name) => (col[name] !== undefined ? col[name] : (headerAt === -1 ? DEFAULT_COL[name] : -1))

  const out = []
  for (let i = headerAt + 1; i < lines.length; i++) {
    const t = lines[i]
    if (!isRow(t)) continue
    const cells = cellsOf(t)
    const fileAt = at('源文件')
    const rawFile = fileAt >= 0 && fileAt < cells.length ? cells[fileAt] : ''
    const file = String(rawFile).replace(/[`\\]/g, '').trim()
    if (!file.endsWith('.mmd')) continue
    const get = (name) => {
      const idx = at(name)
      return idx >= 0 && idx < cells.length ? cells[idx] : ''
    }
    const lessonNum = Number((/第\s*(\d+)\s*讲/.exec(get('讲次')) || [])[1])
    const turnNum = Number(get('回合'))
    const title = get('标题')
    const caption = get('说明')
    const session = get('会话')
    out.push({
      time: get('日期'),
      lesson: Number.isFinite(lessonNum) ? lessonNum : null,
      turn: Number.isFinite(turnNum) ? turnNum : null,
      kind: get('图类型'),
      title: title === '（未给标题）' ? '' : title,
      caption: caption === '—' ? '' : caption,
      file: file,
      session: session === '' ? '' : session,
    })
  }
  return out
}

/** 板书清单（K2.2 的形状）：按时间倒序。 */
function listDiagrams(rootDir) {
  const items = []
  try {
    if (!rootDir || !isDir(rootDir)) return { items: items, root: rootDir || '' }
    let indexed = []
    try { indexed = parseIndexRows(fs.readFileSync(path.join(rootDir, 'index.md'), 'utf8')) } catch { /* 索引可缺 */ }
    const byFile = new Map()
    for (const r of indexed) byFile.set(r.file, r)
    for (const name of fs.readdirSync(rootDir)) {
      if (!name.endsWith('.mmd')) continue
      const id = name.replace(/\.mmd$/, '')
      if (!DIAGRAM_ID_RE.test(id)) continue
      const row = byFile.get(name) || null
      let mtime = 0
      try { mtime = fs.statSync(path.join(rootDir, name)).mtimeMs } catch { mtime = 0 }
      items.push({
        id: id,
        lesson: row ? row.lesson : null,
        turn: row ? row.turn : null,
        kind: row ? row.kind : '',
        title: row ? row.title : '',
        time: row ? row.time : (mtime ? new Date(mtime).toISOString() : ''),
        file: name,
        // 会话键：老索引没有「会话」列 → 空串（不猜，也不把整条判坏）
        session: row ? row.session : '',
        _mtime: Math.round(mtime),
      })
    }
    // 时间倒序（mtime 是内部排序键，不进对外 JSON —— 契约 K2.2 的形状只有七个字段）
    items.sort((a, b) => (b._mtime - a._mtime) || String(b.id).localeCompare(String(a.id)))
    for (const it of items) delete it._mtime
  } catch (err) {
    noteWarning('板书目录读取失败：' + String((err && err.message) || err))
  }
  return { items: items, root: rootDir || '' }
}

/**
 * 情绪通道（K1.4）：读 `<教室>/runtime/emotions.jsonl` 里 `seq > after` 的事件。
 * 坏行跳过（这个文件是 append-only，进程被杀时最后一行可能半截）。
 * @returns {{events:Array<object>, nextSeq:number, total:number}}
 */
function readEmotionEvents(runtimeDir, afterSeq) {
  const after = Number.isFinite(Number(afterSeq)) ? Number(afterSeq) : 0
  const out = []
  let nextSeq = after
  let total = 0
  try {
    if (!runtimeDir) return { events: out, nextSeq: nextSeq, total: 0 }
    const file = path.join(runtimeDir, 'emotions.jsonl')
    const text = fs.readFileSync(file, 'utf8')
    const lines = text.split('\n')
    for (const line of lines) {
      const t = line.trim()
      if (!t) continue
      let ev = null
      try { ev = JSON.parse(t) } catch { continue }
      if (!ev || typeof ev !== 'object') continue
      total += 1
      const seq = Number(ev.seq)
      if (!Number.isFinite(seq)) continue
      if (seq > nextSeq) nextSeq = seq
      if (seq > after) out.push(ev)
    }
    // 上限保护：一次最多回 200 条（250ms 轮一次，正常远小于这个数）
    if (out.length > 200) out.splice(0, out.length - 200)
  } catch { /* 文件不存在＝还没有情绪事件，正常情况 */ }
  return { events: out, nextSeq: nextSeq, total: total }
}

/** 取 yaml 里某个顶层键的缩进块（不引 yaml 依赖：只认这个文件的实际形状）。 */
function yamlBlockOf(text, key) {
  const lines = String(text || '').split('\n')
  const head = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*$')
  const start = lines.findIndex((l) => head.test(l))
  if (start === -1) return ''
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (l.trim() === '') { out.push(l); continue }
    if (!/^\s+\S/.test(l)) break
    out.push(l)
  }
  return out.join('\n')
}

/**
 * 教室标识：`classroom.yaml` 的 `classroom.title` ＋「当课老师」显示名。
 *
 * 老师名的**权威来源**（按顺序，命中即停）：
 *   ① classroom.yaml 里 `layer: persona` 的块 → 该块的 `path: characters/<x>.md`
 *      → 那个文件里的 `| 名字 | <显示名> |` 表格行
 *   ② 同一文件的 H1（`# 鲸（DeepSeek 娘）· 本教室版本` → 取 `·` 与全角括号之前的部分）
 *   ③ 都没有 → `name: null`（前端只显示「在场」，**绝不写死任何名字**）
 */
function readClassroomInfo(classroomDir) {
  const info = { id: '', title: '', teacher: { name: null, source: '' } }
  try {
    if (!classroomDir) return info
    let yaml = ''
    try { yaml = fs.readFileSync(path.join(classroomDir, 'classroom.yaml'), 'utf8') } catch { yaml = '' }
    const block = yamlBlockOf(yaml, 'classroom')
    const idM = /^\s+id:\s*(\S+)\s*$/m.exec(block)
    const titleM = /^\s+title:\s*(.+?)\s*$/m.exec(block)
    if (idM) info.id = idM[1]
    if (titleM) info.title = titleM[1]
    if (!info.id) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(classroomDir, 'package.json'), 'utf8'))
        if (pkg && typeof pkg.name === 'string') info.id = pkg.name
      } catch { /* 没有 package.json 就算了 */ }
    }
    if (!info.id) info.id = path.basename(classroomDir)

    // ① 找 persona 块里的 path
    let rel = ''
    const lines = yaml.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s+layer:\s*persona\s*$/.test(lines[i])) continue
      for (let j = i; j >= 0 && j > i - 12; j--) {
        const m = /^\s+path:\s*(characters\/\S+)\s*$/.exec(lines[j])
        if (m) { rel = m[1]; break }
      }
      if (rel) break
    }
    if (!rel) {
      // 没有显式声明的 persona 块：只有 characters/ 下恰好一个 .md 时才认它
      try {
        const files = fs.readdirSync(path.join(classroomDir, 'characters')).filter((f) => f.endsWith('.md'))
        if (files.length === 1) rel = 'characters/' + files[0]
      } catch { /* 没有 characters/ 目录 */ }
    }
    if (!rel) return info
    info.teacher.source = rel
    let md = ''
    try { md = fs.readFileSync(path.join(classroomDir, rel), 'utf8') } catch { md = '' }
    const nameRow = /^\|\s*名字\s*\|\s*(.+?)\s*\|/m.exec(md)
    if (nameRow && nameRow[1]) {
      info.teacher.name = nameRow[1].replace(/\*\*/g, '').trim()
    } else {
      const h1 = /^#\s+(.+?)\s*$/m.exec(md)
      if (h1 && h1[1]) info.teacher.name = h1[1].split('·')[0].replace(/（[^）]*）/g, '').trim() || null
    }
  } catch (err) {
    noteWarning('教室标识读取失败：' + String((err && err.message) || err))
  }
  return info
}


// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

let ctxRef = null

export function apply(ctx) {
  ctxRef = ctx

  const safe = safeMode()
  if (safe.safe) {
    log('info', `安全模式已开启（${safe.why}）：本插件不注册任何东西。删除 SAFE_MODE 或设 STAGE_WARM_SAFE=0 后重启即可恢复。`)
    return
  }

  // ---- 1. 设置（宽松 schema ⇒ 注册不可能失败）------------------------
  let current = Object.assign({}, DEFAULTS)
  try {
    const scope = ctx.settings.register(SETTINGS_NS, makeDuckSchema(), { applies: 'live' })
    current = normalizeSettings(scope && typeof scope.get === 'function' ? scope.get() : {})
    ctx.effect(() => scope.watch((next) => {
      try { current = normalizeSettings(next) } catch { /* 归一化失败保留上次值 */ }
    }), 'stage-warm: settings watch')
  } catch (err) {
    log('info', '设置注册失败，改用内存默认值（舞台其余部分照常）', err)
  }

  // ---- 2. 静态路由：三条各自独立 try/catch --------------------------
  const registerRoute = (label, route) => {
    try {
      ctx.effect(() => ctx.webServer.register(route), 'stage-warm: ' + label)
    } catch (err) {
      noteWarning(`路由 ${route.path} 注册失败：` + String((err && err.message) || err))
      log('info', `路由 ${route.path} 注册失败（舞台其余部分照常）`, err)
    }
  }

  /**
   * 通用静态目录路由：把 `<urlBase>/<相对路径>` 映射到 `<dirBase>/<相对路径>`。
   *
   * 与 assets 路由同口径：只允许 loopback、解析后的绝对路径必须仍在该根内（防目录穿越）、
   * 只发 MIME 表里认识的类型（`.moc3` 走 application/octet-stream）。
   * 抽成工厂是因为 Live2D 接入后有三个静态根（stage / l2d / models），复制三份会漂。
   */
  function registerStaticDir(label, urlBase, dirBase) {
    registerRoute(label, {
      kind: 'prefix',
      path: urlBase,
      handler: (req, res) => {
        if (!isLoopback(req)) return sendText(res, 403, 'loopback only')
        try {
          const url = new URL(String(req.url), 'http://localhost')
          let rel = decodeURIComponent(url.pathname.slice(urlBase.length))
          rel = rel.replace(/^\/+/, '')
          const abs = path.resolve(dirBase, rel)
          const rootWithSep = dirBase.endsWith(path.sep) ? dirBase : dirBase + path.sep
          if (!abs.startsWith(rootWithSep)) return sendText(res, 403, 'forbidden')
          const ext = path.extname(abs).toLowerCase()
          if (!MIME[ext]) return sendText(res, 415, 'unsupported type')
          const bytes = fs.readFileSync(abs)
          res.statusCode = 200
          res.setHeader('content-type', MIME[ext])
          // 模型与库都不该被浏览器长期缓存（换角色/升级时要立刻生效）
          res.setHeader('cache-control', 'no-cache')
          res.end(bytes)
        } catch (err) {
          sendText(res, 404, '资源不存在：' + String((err && err.message) || err))
        }
      },
    })
  }

  registerRoute('manifest', {
    kind: 'exact',
    path: ROUTE_BASE + '/manifest.json',
    handler: (req, res) => {
      if (!isLoopback(req)) return sendText(res, 403, 'loopback only')
      try {
        sendJSON(res, 200, {
          ok: true,
          routeBase: ROUTE_BASE,
          assetBase: ROUTE_BASE + '/assets/',
          settings: current,
          assets: listAssets(),
          models: listModels(),
          l2d: listLibs(),
          boards: listBoards(),
          animations: listAnimations(),
          // 教室标识（角色显示名/教室名一律从磁盘读，前端**不写死**任何名字）
          classroom: readClassroomInfo(currentClassroom(current).dir),
        })
      } catch (err) {
        sendText(res, 500, 'manifest 生成失败：' + String((err && err.message) || err))
      }
    },
  })

  registerRoute('assets', {
    kind: 'prefix',
    path: ROUTE_BASE + '/assets',
    handler: (req, res) => {
      if (!isLoopback(req)) return sendText(res, 403, 'loopback only')
      try {
        const url = new URL(String(req.url), 'http://localhost')
        let rel = decodeURIComponent(url.pathname.slice((ROUTE_BASE + '/assets').length))
        rel = rel.replace(/^\/+/, '')
        // 🔴 目录穿越防护：解析后的绝对路径必须仍在素材根内
        const abs = path.resolve(ASSET_DIR, rel)
        const rootWithSep = ASSET_DIR.endsWith(path.sep) ? ASSET_DIR : ASSET_DIR + path.sep
        if (!abs.startsWith(rootWithSep)) return sendText(res, 403, 'forbidden')
        const ext = path.extname(abs).toLowerCase()
        if (!MIME[ext]) return sendText(res, 415, 'unsupported type')
        const bytes = fs.readFileSync(abs)
        res.statusCode = 200
        res.setHeader('content-type', MIME[ext])
        res.setHeader('cache-control', 'no-cache')
        res.end(bytes)
      } catch (err) {
        sendText(res, 404, '素材不存在：' + String((err && err.message) || err))
      }
    },
  })

  // ── Live2D 运行时库（PIXI / Cubism Core / pixi-live2d-display）──────────────
  registerStaticDir('l2d', ROUTE_BASE + '/l2d', L2D_LIB_DIR)
  // ── Live2D 模型目录（<模型>/*.model3.json + moc3 + 贴图 + motion3/exp3）──────
  registerStaticDir('models', ROUTE_BASE + '/models', MODEL_DIR)

  registerRoute('board', {
    kind: 'prefix',
    path: ROUTE_BASE + '/board',
    handler: (req, res) => {
      if (!isLoopback(req)) return sendText(res, 403, 'loopback only')
      try {
        const url = new URL(String(req.url), 'http://localhost')
        let rel = decodeURIComponent(url.pathname.slice((ROUTE_BASE + '/board').length))
        rel = rel.replace(/^\/+/, '')
        // 🔴 只允许「<课次>.scene.json」这一种形状：白名单式校验，从根上挡目录穿越
        if (!/^[A-Za-z0-9_.-]+\.json$/.test(rel)) {
          return sendJSON(res, 200, { ok: false, error: 'bad-name', boards: listBoards() })
        }
        const abs = path.resolve(BOARD_DIR, rel)
        const bytes = fs.readFileSync(abs)
        const scene = JSON.parse(bytes.toString('utf8'))
        if (!scene || scene.version !== 'whiteboard.scene.v1' || !Array.isArray(scene.elements)) {
          return sendJSON(res, 200, { ok: false, error: 'bad-schema', boards: listBoards() })
        }
        res.statusCode = 200
        res.setHeader('content-type', MIME['.json'])
        res.setHeader('cache-control', 'no-cache')
        res.end(bytes)
      } catch (err) {
        // 缺件时**不报 5xx**：把可用清单回给客户端，舞台自己降级
        try { sendJSON(res, 200, { ok: false, error: 'not-found', boards: listBoards() }) }
        catch { /* ignore */ }
      }
    },
  })

  registerRoute('animation', {
    kind: 'prefix',
    path: ROUTE_BASE + '/anim',
    handler: (req, res) => {
      if (!isLoopback(req)) return sendText(res, 403, 'loopback only')
      try {
        const url = new URL(String(req.url), 'http://localhost')
        const rel = decodeURIComponent(url.pathname.slice((ROUTE_BASE + '/anim').length)).replace(/^\/+/, '')
        // 白名单式：`<id>/<文件名>`，两段都不许出现 `.` 开头的目录跳转
        if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(rel) || rel.includes('..')) {
          return sendJSON(res, 200, { ok: false, error: 'bad-name', animations: listAnimations() })
        }
        const abs = path.resolve(ANIM_DIR, rel)
        const rootWithSep = ANIM_DIR.endsWith(path.sep) ? ANIM_DIR : ANIM_DIR + path.sep
        if (!abs.startsWith(rootWithSep)) return sendText(res, 403, 'forbidden')
        const ext = path.extname(abs).toLowerCase()
        if (!MIME[ext]) return sendText(res, 415, 'unsupported type')
        const bytes = fs.readFileSync(abs)
        res.statusCode = 200
        res.setHeader('content-type', MIME[ext])
        // 视频要支持 Range 才能被 <video> 顺畅播（这里给整段 + 允许字节范围即可）
        res.setHeader('accept-ranges', 'bytes')
        res.setHeader('cache-control', 'no-cache')
        res.end(bytes)
      } catch (err) {
        // 归因用：把"为什么没取到"原样回给客户端（文件不存在／路径越界／MIME 不支持）
        try {
          sendJSON(res, 200, {
            ok: false, error: 'anim-read-failed', animations: listAnimations(),
            reason: String((err && err.message) || err).slice(0, 200),
          })
        } catch { /* ignore */ }
      }
    },
  })

  // ── 板书闭环（契约 K2.2）＋ 情绪通道（K1.4）─────────────────────────────
  // 🔴 这三条路由的**拒绝规则**是安全边界，不是"顺手校验"：
  //    路径来自浏览器 URL，`..`／编码斜杠／符号链接都能穿越到教室目录之外，
  //    而那个目录旁边就是学生的笔记（runtime/notes.jsonl）。规则逐条见 resolveDiagramFile。
  registerRoute('stage-board-health', {
    kind: 'exact',
    path: BOARD_ROUTE + '/health',
    handler: (req, res) => {
      if (!isLoopback(req)) return sendText(res, 403, 'loopback only')
      try {
        const cc = currentClassroom(current)
        const root = diagramsDirOf(cc.dir)
        const info = readClassroomInfo(cc.dir)
        sendJSON(res, 200, {
          ok: !!cc.dir,
          classroom: { dir: cc.dir, source: cc.source, id: info.id, title: info.title, teacher: info.teacher },
          diagramsDir: root,
          diagrams: listDiagrams(root).items.length,
          emotions: readEmotionEvents(cc.dir ? path.join(cc.dir, 'runtime') : '', 0).total,
          tried: cc.tried,
          settings: { classroom: current.classroom, workspaceRoot: current.workspaceRoot },
        })
      } catch (err) {
        sendText(res, 500, 'stage-board/health 失败：' + String((err && err.message) || err))
      }
    },
  })

  // ① 清单：`{ items: [ { id, lesson, turn, kind, title, time, file } ] }`，按时间倒序
  registerRoute('diagrams-list', {
    kind: 'exact',
    path: BOARD_ROUTE + '/diagrams',
    handler: (req, res) => {
      if (!isLoopback(req)) return sendText(res, 403, 'loopback only')
      if (req.method !== 'GET') return sendText(res, 405, 'GET only')
      try {
        const cc = currentClassroom(current)
        const root = diagramsDirOf(cc.dir)
        const list = listDiagrams(root)
        sendJSON(res, 200, {
          items: list.items,
          root: root || '',
          classroom: cc.dir || '',
          // 读不到时把"试过哪些目录"一并回给客户端：归因用，不靠猜
          tried: cc.dir ? undefined : cc.tried,
        })
      } catch (err) {
        sendJSON(res, 200, { items: [], error: String((err && err.message) || err) })
      }
    },
  })

  // ② 单张图的 mermaid 源码：text/plain（浏览器半边拿它去真渲染）
  registerRoute('diagram-source', {
    kind: 'prefix',
    path: BOARD_ROUTE + '/diagrams',
    handler: (req, res) => {
      if (!isLoopback(req)) return sendText(res, 403, 'loopback only')
      if (req.method !== 'GET') return sendText(res, 405, 'GET only')
      let rawId = ''
      try {
        const url = new URL(String(req.url), 'http://localhost')
        rawId = url.pathname.slice((BOARD_ROUTE + '/diagrams').length).replace(/^\/+/, '')
      } catch {
        return sendText(res, 400, 'bad-url')
      }
      const cc = currentClassroom(current)
      const r = resolveDiagramFile(diagramsDirOf(cc.dir), rawId)
      if (!r.ok) {
        // 🔴 400（请求不合法）与 404（图不在）分开：前者是安全边界拒绝，后者是正常缺件
        return sendText(res, r.status, r.reason)
      }
      try {
        const body = fs.readFileSync(r.abs, 'utf8')
        res.statusCode = 200
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(body)
      } catch (err) {
        sendText(res, 404, 'read-failed：' + String((err && err.message) || err))
      }
    },
  })

  // ③ 情绪通道：`GET /stage-board/emotions?after=<seq>` → `{ events, nextSeq }`
  //    契约 K1.4：只回 `seq > after`；浏览器半边每 250ms 轮一次（不做长轮询）。
  registerRoute('emotions', {
    kind: 'exact',
    path: BOARD_ROUTE + '/emotions',
    handler: (req, res) => {
      if (!isLoopback(req)) return sendText(res, 403, 'loopback only')
      if (req.method !== 'GET') return sendText(res, 405, 'GET only')
      try {
        const url = new URL(String(req.url), 'http://localhost')
        const after = Number(url.searchParams.get('after') || 0)
        const cc = currentClassroom(current)
        const r = readEmotionEvents(cc.dir ? path.join(cc.dir, 'runtime') : '', Number.isFinite(after) ? after : 0)
        sendJSON(res, 200, { events: r.events, nextSeq: r.nextSeq })
      } catch (err) {
        sendJSON(res, 200, { events: [], nextSeq: 0, error: String((err && err.message) || err) })
      }
    },
  })

  registerRoute('health', {
    kind: 'exact',
    path: ROUTE_BASE + '/health',
    handler: async (req, res) => {
      if (!isLoopback(req)) return sendText(res, 403, 'loopback only')
      try {
        if (req.method === 'POST') {
          // 浏览器半边报到：用来区分"bundle 没到浏览器"与"到了但没渲染"
          diag.clientSeen = true
          let body = {}
          try {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
          } catch { /* 报到体坏了也不影响 */ }
          diag.clientReports.push({ at: new Date().toISOString(), body })
          if (diag.clientReports.length > 20) diag.clientReports.shift()
          if (Array.isArray(body.warnings)) for (const w of body.warnings) noteWarning(w)
          return sendJSON(res, 200, { ok: true })
        }
        sendJSON(res, 200, {
          ok: true,
          hostStartedAt: diag.hostStartedAt,
          clientSeen: diag.clientSeen,
          clientReports: diag.clientReports.slice(-3),
          warnings: diag.warnings,
          settings: current,
          assetDir: ASSET_DIR,
          assetCount: listAssets().length,
          boards: listBoards(),
          animations: listAnimations(),
          safeMode: false,
        })
      } catch (err) {
        sendText(res, 500, 'health 失败：' + String((err && err.message) || err))
      }
    },
  })

  log('info', `已注册：${ROUTE_BASE}/manifest.json ｜ ${ROUTE_BASE}/assets/* ｜ ${ROUTE_BASE}/health（素材 ${listAssets().length} 个，板书 ${listBoards().length} 课，动画 ${listAnimations().length} 条）`)
}

/**
 * 供单测直接调用（**不影响**宿主装载：cordis 只读 default/name/inject/apply）。
 * 拒绝规则、索引解析、情绪读法都在这里被逐条验证过（test/21-stage-board.test.mjs）。
 */
export const stageInternals = {
  resolveDiagramFile,
  listDiagrams,
  parseIndexRows,
  readEmotionEvents,
  classroomRootOf,
  readClassroomInfo,
  diagramsDirOf,
  isLoopback,
}

export default { name, inject, apply }
