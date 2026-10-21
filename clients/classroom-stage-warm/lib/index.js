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

export default { name, inject, apply }
