/**
 * classroom-ui 的 node 侧测试：**驱动浏览器半边的真实代码**，不吃任何替身数据。
 *
 * 做法：把 `lib/client.js` 当成浏览器产物那样装一遍——伪造 `window.__ModuleLoader__`
 * 收下 `{id, factory}`，再给 factory 一个最小 `require`（只认 "react"），
 * 于是拿到与浏览器里**同一份** exports，用真实的教室文件喂它。
 *
 * 覆盖（两类，见下方分组标记）：
 *   A · 源码与部署检查逻辑：产物格式/id、解析函数对真文件、loadClassroom 分页通道、
 *      单文件失败不拖垮整块、部署声明（classroom.config.json）解析与两侧一致性自检、
 *      立绘接线纯函数（相位→状态、model3 引用枚举、base64、MIME、私有 scheme 解析器）、
 *      板书图入参解析/主题、皮肤参数表、逐参数表情驱动器、`classroom_draw` 派发。
 *   B · 当前未部署资产明确报 missing：live2d-host/out（Cubism 样本 + 构建产物）本仓库
 *      未分发 → 这些测试**断言代码把"缺 out"如实报成 missing**，既不因缺文件伪装通过、
 *      也不让整包不可测；立绘在缺 out 时面板显示明确未部署状态而非白屏。
 *
 * 跑法：node test/panel.test.mjs
 *   （也可经仓库级入口：node check.mjs）
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const HERE = dirname(fileURLToPath(import.meta.url))
/**
 * 工作区根：classroom-ui/test → classroom-ui → clients → 仓库根（主仓相对深度 3）。
 * 用 import.meta.url 相对解析，不依赖调用时的 cwd。
 */
const WORKSPACE = join(HERE, '..', '..', '..')
/** 教室相对工作区根的路径（cs-os 是教室真源，主仓自带）。 */
const CLASSROOM = 'classrooms/cs-os'

// ── 1 · 以浏览器的方式装载产物 ──────────────────────────────────────────────
let registration
globalThis.window = {
  __ModuleLoader__: {
    load: (value) => { registration = value },
  },
}

const BUNDLE = join(HERE, '..', 'lib', 'client.js')
const source = readFileSync(BUNDLE, 'utf8')
// 产物是经典脚本（非 ESM），用 Function 求值等价于浏览器 <script> 执行。
// eslint-disable-next-line no-new-func
new Function(source)()

assert.equal(registration.id, 'classroom-ui', '产物 id 必须等于包名（boot 图行 id）')
const panel = registration.factory((specifier) => {
  if (specifier === 'react') {
    // 只提供本模块真正用到的那几个 React API；用于驱动纯函数与读取器，不渲染。
    return {
      createElement: () => null,
      useEffect: () => {},
      useSyncExternalStore: () => null,
    }
  }
  throw new Error(`未预期的 require("${specifier}")`)
})

assert.ok(typeof panel.apply === 'function', 'exports.apply 必须是函数')
assert.ok(Array.isArray(panel.inject), 'exports.inject 必须是数组')
assert.equal(panel.TYPE_ID, 'classroom-ui')
assert.equal(panel.TYPE_KIND, 'classroom')
assert.deepEqual(panel.inject, ['slots', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles'])

// ── 2 · 解析：喂真实文件 ────────────────────────────────────────────────────
const read = (rel) => readFileSync(join(WORKSPACE, CLASSROOM, rel), 'utf8')

const manifest = panel.parseManifest(read('classroom.yaml'))
// 🔴 2026-10-19：当课老师是**教室数据**（runtime/progress.md 的表格），不是测试常量。
//    这里从那份文件里解析出来，换角色（komari → deepseek → …）时测试不需要改。
const EXPECTED_TEACHER = (function () {
  const m = read('runtime/progress.md').match(/\|\s*当课老师\s*\|\s*([^|]+?)\s*\|/)
  if (!m) throw new Error('progress.md 里找不到「当课老师」行')
  return m[1].trim()
})()

assert.equal(manifest.id, 'cs-os')
assert.equal(manifest.title, '计算机系教室 · 操作系统')
assert.equal(manifest.subject, '操作系统')
assert.equal(manifest.lessons, 14)
assert.deepEqual(manifest.phases.map((phase) => phase.id), ['open', 'probe', 'answer', 'check', 'review', 'close'])
assert.deepEqual(manifest.phases.map((phase) => phase.name), ['开场', '追问', '学生作答', '对答案', '复习', '收尾'])

const progress = panel.parseProgress(read('runtime/progress.md'))
assert.equal(progress.currentLesson, 1, 'current_lesson 机器可读行')
assert.equal(progress.currentPhase, null, 'progress.md 当前无 current_phase 行')
// 🔴 2026-10-19：这里原本硬编码 `'小鞠知花'` —— 演示角色换成「鲸」之后断言就断了。
//    角色名本来就是**教室数据**（runtime/progress.md 的「当课老师」），不该被测试钉死：
//    改成断言"字段有值且与 progress.md 里写的那个一致"。
assert.equal(progress.teacher, read('runtime/progress.md').match(/\|\s*当课老师\s*\|\s*([^|]+?)\s*\|/)[1].trim(),
  '当课老师应与 progress.md 的表格一致（不硬编码具体角色名）')
assert.equal(progress.progressText, '0 / 14 讲')
// 🔴 事实契约（classrooms/cs-os/AGENTS.md:63-66）：人读表格只给「本轮要讲」＋「已完成」，
// 没有「当前讲次」也没有「下次上课」；「本轮要讲」与机器可读行 current_lesson 必须是同一个值。
assert.equal(progress.humanLesson, '**第 1 讲 · 一个程序怎么跑起来**', '人读表格的「本轮要讲」（与 current_lesson 同值）')
assert.equal(progress.doneCount, '0 讲', '人读表格的「已完成」')
assert.equal(progress.lastDate, '—')

// ── 2.1 🔴 契约与无分叉：progress.md 不得出现「当前讲次」/「下次上课」两行，且两处口径一致 ──
{
  const text = read('runtime/progress.md')
  assert.equal(text.includes('当前讲次'), false, '契约：人读表格不得有「当前讲次」这一行')
  assert.equal(text.includes('下次上课'), false, '契约：人读表格不得有「下次上课」这一行（语义与本轮要讲重复，已删）')
  // 「本轮要讲」必须是粗体的「第 N 讲 · <标题>」，且 N 与机器可读行 current_lesson 同值
  const human = progress.humanLesson
  const humanN = human.match(/第\s*(\d+)\s*讲/)
  assert.ok(humanN !== null && Number.parseInt(humanN[1], 10) === progress.currentLesson, '本轮要讲 的讲次号＝current_lesson（两处永远同值，不许各写各的）')
  // 课程表里第 N 讲的标题必须与「本轮要讲」里的标题一致（契约不要求但面板靠它定位，必须咬合）
  const cur = panel.parseCurriculum(read('curriculum.md'))
  const hit = cur.find((lesson) => lesson.n === progress.currentLesson)
  assert.ok(hit !== undefined && human.includes(hit.title), '本轮要讲 的标题＝课程表第 N 讲标题（面板用讲次号定位标题，二者须一致）')
  // 「已完成」必须是「N 讲」形状（机器口径可核对）
  assert.ok(/^\d+\s*讲$/.test(progress.doneCount), '已完成 必须是「N 讲」形状')
}

const curriculum = panel.parseCurriculum(read('curriculum.md'))
assert.equal(curriculum.length, 14, '课程表必须解析出 14 讲')
assert.equal(curriculum[0].n, 1)
assert.equal(curriculum[0].title, '一个程序怎么跑起来')
assert.ok(curriculum[0].core !== null && curriculum[0].core.length > 0, '第 1 讲必须有核心疑问')
assert.equal(curriculum[13].n, 14)

const teacher = panel.parseTeacher(read('characters/deepseek.md'))  // 角色卡以 classroom.yaml 的 persona 声明为准
assert.equal(teacher.name, EXPECTED_TEACHER)
assert.ok(teacher.scope !== null && teacher.scope.includes('14 讲'))

// ── 2.5 · 默认教室路径（不依赖 globalThis 配置）─────────────────────────────
// 测的是产品自己给出的默认路径：未配置 `globalThis.__DSH_CLASSROOM_UI_CONFIG__` 时，
// classroomRoot() 必须回退到仓库自带的 classrooms/cs-os（不读任何外部路径）。
delete globalThis.__DSH_CLASSROOM_UI_CONFIG__
assert.equal(panel.classroomRoot(), 'classrooms/cs-os', '默认 classroomRoot 必须回退到仓库自带相对路径')
assert.equal(panel.live2dRoot(), 'clients/live2d-host/out', '默认 live2dRoot 回退到仓库自带相对路径')
assert.equal(panel.mermaidPath(), 'clients/classroom-ui/vendor/mermaid-11.17.2/mermaid.min.js', '默认 mermaid 路径回退到仓库自带 vendor')
assert.equal(panel.declarationPath(), 'clients/classroom-ui/classroom.config.json', '默认部署声明路径回退到仓库自带 classroom.config.json')
// 配置优先：注入值各自覆盖默认值，且去尾斜杠
globalThis.__DSH_CLASSROOM_UI_CONFIG__ = { root: 'x/y/', live2dRoot: 'a/b/', mermaidPath: 'c/d/', declarationPath: 'e/f/' }
assert.equal(panel.classroomRoot(), 'x/y', 'root 配置优先且去尾斜杠')
assert.equal(panel.live2dRoot(), 'a/b')
assert.equal(panel.mermaidBundlePath(), 'c/d')
assert.equal(panel.declarationPath(), 'e/f')
delete globalThis.__DSH_CLASSROOM_UI_CONFIG__

// ── 3 · loadClassroom：走「分页 read」通道读真文件 ──────────────────────────
/** 模拟宿主 workspaceFiles.read：1 基行号、按行分页、eof 语义与官方 types.ts 一致。 */
function fakeRemote(pageLines) {
  const calls = []
  return {
    calls,
    workspaceFiles: {
      read: async (_sessionId, path, range) => {
        calls.push({ path, offset: range.offset })
        const absolute = join(WORKSPACE, path)
        if (!existsSync(absolute)) {
          return { ok: false, error: { code: 'workspace-file/not-found', message: `no such file: ${path}` } }
        }
        const all = readFileSync(absolute, 'utf8').split('\n')
        const offset = range.offset === undefined ? 1 : range.offset
        const limit = range.limit === undefined ? pageLines : range.limit
        const slice = all.slice(offset - 1, offset - 1 + limit)
        return {
          ok: true,
          value: {
            absolutePath: absolute,
            version: 'test',
            offset,
            text: slice.join('\n'),
            lines: slice.length,
            eof: offset - 1 + slice.length >= all.length,
          },
        }
      },
    },
  }
}

const ctx = { remote: fakeRemote(5000) }
const loaded = await panel.loadClassroom(ctx, 'session-under-test', new AbortController().signal)

// 🔴 第 5 个来源是引擎写的 `runtime/expression.md`（EXPR-3）：**真教室里它现在还不存在**
//    ——那是运行期文件，引擎第一次真跑才会建 → 面板必须把它当「正常态」而不是错误。
// 🔴 第 6 个来源是 **部署声明**（EXPR-5）：本仓库已自带 `classrooms/cs-os/../classroom.config.json`
//    （即 clients/classroom-ui/classroom.config.json），读得到 → ok:true。
assert.deepEqual(loaded.sources.map((source) => source.ok), [true, true, true, true, false, true], '前四个文件读成功；expression.md 尚未生成（正常态）；部署声明读得到')
assert.deepEqual(loaded.sources.map((source) => source.path.replace(CLASSROOM + '/', '')), [
  'classroom.yaml', 'runtime/progress.md', 'curriculum.md', 'characters/komari.md', 'runtime/expression.md',
  panel.DEFAULT_DECLARATION_PATH,
], '面板要读的来源（顺序＝FILE 的键序，最后一条是部署声明）')
assert.equal(loaded.data.expression.source, 'absent', '没有 expression.md → 计划来源＝absent（沿用旧的相位映射）')
assert.equal(loaded.data.expression.path, null)
assert.equal(loaded.data.classroomId, 'cs-os')
assert.equal(loaded.data.title, '计算机系教室 · 操作系统')
assert.equal(loaded.data.lessonsTotal, 14)
assert.equal(loaded.data.currentLesson, 1)
assert.equal(loaded.data.lessonTitle, '一个程序怎么跑起来', '本轮要讲 的标题由讲次号在课程表里定位')
assert.equal(loaded.data.humanLesson, '**第 1 讲 · 一个程序怎么跑起来**', '快照透传人读「本轮要讲」')
assert.equal(loaded.data.doneCount, '0 讲', '快照透传人读「已完成」')
assert.equal(loaded.data.currentPhase, null)
assert.equal(loaded.data.phaseName, null)
assert.equal(loaded.data.teacher, EXPECTED_TEACHER)
assert.equal(loaded.data.progressText, '0 / 14 讲')
assert.equal(loaded.data.lessons.length, 14)
assert.equal(loaded.data.phases.length, 6)

// 分页循环：用 3 行/页读 curriculum.md（139 行）→ 必须多页且拼回全文
const paged = fakeRemote(3)
const pagedLoaded = await panel.loadClassroom({ remote: paged }, 'session-under-test', new AbortController().signal)
assert.equal(pagedLoaded.data.lessons.length, 14, '分页拼接后课程表仍须完整')
assert.ok(paged.calls.length >= 46, `分页应发生多次读取，实际 ${paged.calls.length} 次`)

// ── 4 · 单文件失败不拖垮整块 ────────────────────────────────────────────────
const broken = {
  workspaceFiles: {
    read: async (_sessionId, path, range) => {
      if (path.endsWith('classroom.yaml')) {
        return { ok: false, error: { code: 'workspace-file/not-found', message: 'no such file' } }
      }
      return ctx.remote.workspaceFiles.read('s', path, range)
    },
  },
}
const partial = await panel.loadClassroom({ remote: broken }, 'session-under-test', new AbortController().signal)
assert.deepEqual(partial.sources.map((source) => source.ok), [false, true, true, true, false, true], '只有 classroom.yaml 失败；部署声明不受影响')
assert.equal(partial.data.title, null, 'manifest 缺失 → 标题如实为 null，不填默认值')
assert.equal(partial.data.currentLesson, 1, '其余文件仍照常解析')
assert.equal(partial.data.teacher, EXPECTED_TEACHER, '老师取自 progress.md，不依赖 manifest')

// ── 5 · 立绘接线（§6.5）：纯函数 + 真实解析器 ────────────────────────────────

// 5.1 相位 → 状态
const idle = panel.phaseStateOf(null)
assert.equal(idle.provided, false, 'progress.md 无 current_phase → provided=false')
assert.equal(idle.expressionIndex, null, '未提供相位 → 不改表情（待机）')
assert.equal(idle.channel, 'speak')
assert.equal(panel.phaseStateOf('open').expressionIndex, 0)
assert.equal(panel.phaseStateOf('probe').expressionIndex, 1)
assert.equal(panel.phaseStateOf('answer').channel, 'write', 'answer 相位立绘退让：嘴不动')
assert.equal(panel.phaseStateOf('check').channel, 'write', 'check 相位对答案：通道切 write')
assert.equal(panel.phaseStateOf('review').expressionIndex, 4)
assert.equal(panel.phaseStateOf('close').expressionIndex, 5)
const bogus = panel.phaseStateOf('not-a-phase')
assert.equal(bogus.provided, true, '相位行存在但不在枚举里：如实标 provided=true')
assert.equal(bogus.expressionIndex, null, '不在枚举里 → 不改表情，不瞎映射')
assert.deepEqual(Object.keys(panel.PHASE_STATES), ['open', 'probe', 'answer', 'check', 'review', 'close'],
  '相位表必须与 classroom.yaml 的 phases 枚举一一对应')

// 5.2 model3.json 的引用枚举（**用合成对象驱动纯逻辑**，不依赖未分发的 live2d-host/out）
const SYNTHETIC_MODEL3 = {
  FileReferences: {
    Moc: 'Haru.moc3',
    Textures: ['Haru.2048/texture_00.png'],
    Physics: 'Haru.physics3.json',
    Motions: { Idle: [{ File: 'motions/Idle.motion3.json' }] },
    Expressions: [{ File: 'expressions/F01.expression3.json' }],
  },
}
const refs = panel.modelReferences(SYNTHETIC_MODEL3)
const names = refs.map((ref) => ref.rel)
assert.ok(names.includes('Haru.moc3'), '必须包含 moc3')
assert.equal(refs.find((ref) => ref.rel === 'Haru.moc3').binary, true, 'moc3 是二进制')
assert.equal(refs.find((ref) => ref.rel === 'Haru.2048/texture_00.png').binary, true, '贴图是二进制')
assert.ok(refs.filter((ref) => ref.binary).length >= 2, '至少 moc3 + 贴图是二进制')
assert.ok(names.includes('Haru.physics3.json'), '必须包含物理')
assert.ok(names.some((rel) => rel.startsWith('motions/')), '必须包含动作')
assert.ok(names.some((rel) => rel.startsWith('expressions/')), '必须包含表情')
assert.equal(refs.filter((ref) => ref.rel === 'Haru.moc3').length, 1, '同一文件只枚举一次')

// 5.3 MIME 与 base64
assert.equal(panel.mimeOf('models/Haru/Haru.2048/texture_00.png'), 'image/png')
assert.equal(panel.mimeOf('models/Haru/Haru.moc3'), 'application/octet-stream')
assert.equal(panel.mimeOf('shaders/WebGL/vertshadersrc.vert'), 'text/plain')
assert.equal(panel.mimeOf('live2d-host.bundle.mjs'), 'text/javascript')
assert.equal(panel.mimeOf('unknown.bin'), 'application/octet-stream')
assert.deepEqual([...panel.base64ToBytes('AAEC/w==')], [0, 1, 2, 255], 'base64 → 字节（含 0 与 255）')

// 5.4 私有 scheme 解析器：驱动真实实现，验「改写 + 还原」
const nativeFetchCalls = []
const nativeFetch = async (input) => { nativeFetchCalls.push(input); return { ok: true } }
class FakeImage {
  constructor() { this._src = null }
  set src(value) { this._src = value }
  get src() { return this._src }
}
globalThis.fetch = nativeFetch
globalThis.Image = FakeImage
const fakeUrls = new Map([
  ['models/Haru/Haru.moc3', 'blob:fake/moc3'],
  ['shaders/WebGL/vertshadersrc.vert', 'blob:fake/vert'],
])
const restore = panel.installAssetResolver(fakeUrls)
await globalThis.fetch(panel.ASSET_SCHEME + 'models/Haru/Haru.moc3')
assert.equal(nativeFetchCalls[0], 'blob:fake/moc3', '私有 scheme 被改写成 objectURL 后才交给原生 fetch')
await globalThis.fetch('https://example.test/x.json')
assert.equal(nativeFetchCalls[1], 'https://example.test/x.json', '非本插件的 URL 原样透传')
const image = new globalThis.Image()
image.src = panel.ASSET_SCHEME + 'shaders/WebGL/vertshadersrc.vert'
assert.equal(image._src, 'blob:fake/vert', 'Image.src 走同一条解析（贴图就靠这一条）')
const unknown = new globalThis.Image()
unknown.src = panel.ASSET_SCHEME + 'not-materialized.png'
assert.equal(unknown._src, panel.ASSET_SCHEME + 'not-materialized.png', '表里没有的资源不静默改成空串')
restore()
assert.equal(globalThis.fetch, nativeFetch, '解析器必须还原 fetch')
assert.equal(globalThis.Image, FakeImage, '解析器必须还原 Image')

// 5.5 materializeAssets：**一律走字节通道**（readAll → base64 → 字节），产出可加载的 objectURL
//     🔴 为什么立绘资源不走分页 `read`：`read` 的 `text` 契约不含末行终止符，
//        分页拼接会丢掉文件末尾的换行；官方框架把多份着色器源码直接字符串拼接成一份 GLSL，
//        少一个换行就让下一段的 `#define` 落到同一行 → 编译报
//        `ERROR: 0:354: '#' : unexpected token after conditional expression`。
//    ——本子测试**不读盘**：用合成 bytes 验证「字节通道解出的文本保留末尾换行」这一条核心不变量。
{
  const syntheticShader = 'precision mediump float;\nvoid main(){\n  gl_FragColor = vec4(1.0);\n}\n'
  const seen = []
  const byteRemote = {
    workspaceFiles: {
      read: async () => { throw new Error('立绘资源不走分页 read') },
      readAll: async (_sessionId, path) => {
        seen.push(path)
        return { ok: true, value: { data: Buffer.from(syntheticShader, 'utf8').toString('base64'), eof: true } }
      },
    },
  }
  const urls = await panel.materializeAssets(byteRemote, 'session-under-test', [
    { name: 'shaders/WebGL/frag.frag', path: 'clients/live2d-host/out/shaders/WebGL/frag.frag' },
  ], new AbortController().signal)
  assert.equal(urls.size, 1)
  assert.ok(urls.get('shaders/WebGL/frag.frag').startsWith('blob:'), '资源产出 objectURL')
  assert.deepEqual([...new Set(seen.map((entry) => entry))], ['clients/live2d-host/out/shaders/WebGL/frag.frag'], '立绘资源一律走 readAll（字节），不走分页 read')
  // 字节通道解出的文本保留末尾换行（就是上面那个编译错误的根因）
  const decoded = panel.base64ToBytes(Buffer.from(syntheticShader, 'utf8').toString('base64'))
  assert.equal(panel.decodeText(decoded).endsWith('\n'), true, '字节通道解出的文本保留末尾换行')
  // 反例：分页 read 的 `text` 契约不含末行终止符 → 拼接后末尾换行丢失（这就是必须走字节通道的原因）
  const pageText = syntheticShader.split('\n').slice(0, -1).join('\n')
  assert.equal(pageText.endsWith('\n'), false, '分页 read 的拼接结果会丢掉末尾换行（反例）')
}

// 5.6 配置读取（含调试开关默认关）
delete globalThis.__DSH_CLASSROOM_UI_CONFIG__
assert.equal(panel.debugEnabled(), false, '调试控件默认关（生产路径不出现）')
assert.equal(panel.live2dRoot(), 'clients/live2d-host/out')
assert.equal(panel.modelName(), 'Haru')
globalThis.__DSH_CLASSROOM_UI_CONFIG__ = { debug: true, model: 'Mao', live2dRoot: 'x/y/' }
assert.equal(panel.debugEnabled(), true)
assert.equal(panel.modelName(), 'Mao')
assert.equal(panel.live2dRoot(), 'x/y', '去尾斜杠')
delete globalThis.__DSH_CLASSROOM_UI_CONFIG__

// ══════════════════════════════════════════════════════════════════════════
// B · 立绘资产「读不到」时必须明确报出来（不静默白屏）
//
// 🔴 本节的前提**在 2026-09-25 变了**：`live2d-host/out`（渲染宿主构建产物 ＋ Cubism 样本）
//    **已经随仓库分发**（另一个工作线在建它，本机实测 `out/live2dcubismcore.min.js` 已存在）。
//    原来这里写死 `assert.equal(existsSync(...), false)` —— 那是一条**关于仓库当前状态的事实断言**，
//    状态一变就假红（本次就是这样被抓到的）。改成**按状态分支**：两种状态各自断言"代码做对了什么"，
//    既不因资产被分发而假红，也不因资产缺失而漏掉"不静默"的判据。
//    🔴 本测试**不替 `live2d-host` 那条线背书**：已分发时只做存在性一致性，不验它产物的内容
//       （那是它自己的验收；它改名/重建不该把本测试拖红）。
// ══════════════════════════════════════════════════════════════════════════

// B.1 「已部署」的判据＝Core 文件在不在；两种状态都必须自洽
const live2dCorePath = join(WORKSPACE, panel.live2dRoot(), 'live2dcubismcore.min.js')
const live2dDeployed = existsSync(join(WORKSPACE, panel.live2dRoot()))
assert.equal(live2dDeployed, existsSync(live2dCorePath), 'out 目录与 Core 文件的存在性必须一致（否则"已部署"这个判据本身不可信）')
if (live2dDeployed) {
  assert.ok(readFileSync(live2dCorePath).length > 0, 'Core 文件存在但为空 → 装载必然失败，这条要响')
}

// B.2 model3.json 读不到 → 立绘装载链如实报错（不静默白屏）。
//    用 readAll 返回 not-found 的假 remote 驱动真实的 materializeAssets/读盘代码：
//    缺 out 时整个资源块读不到 → 抛错，错误文案必须点名是「资源读不到」而非乱码。
{
  const missingRemote = {
    workspaceFiles: {
      read: async () => { throw new Error('not used for portrait') },
      readAll: async (_sessionId, _path) => ({ ok: false, error: { code: 'workspace-file/not-found', message: 'no such file' } }),
    },
  }
  await assert.rejects(
    () => panel.materializeAssets(missingRemote, 'session-under-test', [
      { name: 'models/Haru/Haru.model3.json', path: panel.live2dRoot() + '/models/Haru/Haru.model3.json' },
    ], new AbortController().signal),
    /no such file/,
    '缺 out 时 materializeAssets 必须抛「资源读不到」，不能静默产出空 blob',
  )
}

// B.3 部署声明：解析（读不到一律 ok:false ＋ 原因，绝不填默认值）
{
  const ok = panel.parseDeclaration(readFileSync(join(WORKSPACE, panel.DEFAULT_DECLARATION_PATH), 'utf8'))
  assert.equal(ok.ok, true, '仓库自带的声明必须可解析')
  assert.equal(ok.classroomRoot, 'classrooms/cs-os')
  assert.equal(ok.portraitModel, 'Haru')
  assert.equal(panel.parseDeclaration('{').ok, false)
  assert.equal(panel.parseDeclaration('[]').ok, false, '顶层必须是对象')
  assert.equal(panel.parseDeclaration('{"portraitModel":"Haru"}').ok, false, '缺 classroomRoot')
  assert.equal(panel.parseDeclaration('{"classroomRoot":"a"}').ok, false, '缺 portraitModel')
  assert.ok(panel.parseDeclaration('{"classroomRoot":"/abs/x","portraitModel":"Haru"}').reason.includes('工作区相对'),
    '绝对路径必须当场判不可用（面板只能读工作区相对路径）')
  assert.equal(panel.parseDeclaration('{"classroomRoot":"a/b/","portraitModel":"Haru"}').classroomRoot, 'a/b', '尾斜杠归一')
}

// B.4 一致性自检：三种结论（ok / mismatch / unreadable）＋ 每种的"怎么改"
{
  const decl = { ok: true, reason: null, classroomRoot: 'A/b', portraitModel: 'Haru' }
  const ok = panel.checkDeployment(decl, 'A/b', 'Haru', 'X/classroom.config.json')
  assert.equal(ok.status, 'ok')
  assert.deepEqual(ok.lines, [], '一致时不出声（不占地方）')

  const rootBad = panel.checkDeployment(decl, 'A/other', 'Haru', 'X/classroom.config.json')
  assert.equal(rootBad.status, 'mismatch')
  assert.equal(rootBad.rootOk, false)
  assert.ok(rootBad.lines.join('\n').includes('引擎写了但面板看不到'), '要说清后果')
  assert.ok(rootBad.lines.join('\n').includes('修法'), '要给修法')

  const modelBad = panel.checkDeployment(decl, 'A/b', 'Mao', 'X/classroom.config.json')
  assert.equal(modelBad.status, 'mismatch')
  assert.equal(modelBad.modelOk, false)
  assert.ok(modelBad.lines.join('\n').includes('不是同一张'), '模型错位的后果要说清（静默错位）')

  const unreadable = panel.checkDeployment(null, 'A/b', 'Haru', 'X/classroom.config.json')
  assert.equal(unreadable.status, 'unreadable', '"没核成"不等于"没问题" → 也要出声')
  assert.ok(unreadable.lines.join('\n').includes('没核成'))
}

// B.5 🔴 EXPR-5 ③：**立绘模型名一处声明、两侧读**——面板这一侧真的跟着声明走。
//    用仓库内的 `test/fixtures/decl-mao.json`（取代研究版的 tmp_expr5/decl-mao.json）。
{
  const declPath = 'clients/classroom-ui/test/fixtures/decl-mao.json'
  const remote = {
    workspaceFiles: {
      read: async (_sessionId, path) => {
        if (path !== declPath) return { ok: false, error: { code: 'workspace-file/not-found', message: 'no such file: ' + path } }
        return { ok: true, value: { absolutePath: path, version: 'test', offset: 1, text: readFileSync(join(WORKSPACE, declPath), 'utf8'), lines: 6, eof: true } }
      },
    },
  }
  // 页面没注入 model → 模型名应来自声明（Mao）；注入 model 时注入值优先（既有取证脚本靠它切模型）
  globalThis.__DSH_CLASSROOM_UI_CONFIG__ = { declarationPath: declPath }
  panel.resetDeclarationCache()
  await panel.ensureDeclaration(remote, 'session-under-test')
  assert.equal(panel.modelName(), 'Mao', '页面没指定模型 → 用声明里的 portraitModel')
  const read = await panel.ensureDeclaration(remote, 'session-under-test')
  assert.equal(read.declaration.portraitModel, 'Mao')
  assert.equal(panel.checkDeployment(read.declaration, panel.classroomRoot(), panel.modelName(), read.path).status, 'mismatch',
    '声明说 classroom 副本、面板默认读真教室 → 不一致（同一份声明在两处被读，不一致必被看见）')

  globalThis.__DSH_CLASSROOM_UI_CONFIG__ = { declarationPath: declPath, model: 'Haru' }
  assert.equal(panel.modelName(), 'Haru', '页面显式注入 model 时注入优先（取证脚本切模型靠这条）')
  assert.equal(panel.checkDeployment(read.declaration, panel.classroomRoot(), panel.modelName(), read.path).modelOk, false,
    '注入值 ≠ 声明 → 模型错位必须被报出来（引擎按声明挑清单、脸上是另一个模型）')

  delete globalThis.__DSH_CLASSROOM_UI_CONFIG__
  panel.resetDeclarationCache()
}

// ── 6 · 板书图（§6.7）：`classroom_draw` 的入参解析 / 节点形状 / 主题映射 ──────
//
// 这一节只驱动**纯函数**（不装载 mermaid、不碰 DOM）：真渲染由
// 仓库级 `node check.mjs` 之外的接线验证覆盖；mermaid 产物随仓库分发（vendor/），
// 但真渲染需要浏览器 DOM，本测试不覆盖。

// 6.1 槽位键必须与服务端 `defineTool({name})` 逐字一致，否则视图永远不会被派发
assert.equal(panel.DRAW_TOOL_NAME, 'classroom_draw', '槽位派发键 = wire 工具名')
assert.equal(panel.mermaidBundlePath(), 'clients/classroom-ui/vendor/mermaid-11.17.2/mermaid.min.js')
assert.equal(panel.mermaidPath(), panel.DEFAULT_MERMAID_PATH)
globalThis.__DSH_CLASSROOM_UI_CONFIG__ = { mermaidPath: 'x/y/' }
assert.equal(panel.mermaidBundlePath(), 'x/y', 'mermaid 路径可配置，且去尾斜杠')
delete globalThis.__DSH_CLASSROOM_UI_CONFIG__

// 6.2 入参解析：用**真实工具调用的 argsRaw 形状**（服务端 schema 允许的四个字段）
const DRAW_ARGS = JSON.stringify({
  kind: 'flowchart',
  source: 'flowchart TD\n  A[进程A] --> B[进程B]\n',
  title: '两个程序为什么不打架',
  caption: '把开场用的简化模型摆出来',
})
const drawParsed = panel.parseDrawArgs(DRAW_ARGS)
assert.equal(drawParsed.ok, true)
assert.equal(drawParsed.kind, 'flowchart')
assert.equal(drawParsed.source, 'flowchart TD\n  A[进程A] --> B[进程B]\n', '源码必须逐字取出（含换行），不做任何加工')
assert.equal(drawParsed.title, '两个程序为什么不打架')
assert.equal(drawParsed.caption, '把开场用的简化模型摆出来')

// 可选字段缺失 → null（不编造），但仍是 ok
const minimal = panel.parseDrawArgs(JSON.stringify({ kind: 'sequence', source: 'sequenceDiagram\n  A->>B: hi' }))
assert.equal(minimal.ok, true)
assert.equal(minimal.title, null)
assert.equal(minimal.caption, null)

// 失败态：三种都必须是 ok:false + 人读原因（组件据此降级显示源码，绝不白屏）
for (const [label, input] of [['空串', ''], ['非 JSON', '{oops'], ['不是对象', '[]'], ['没有 source', JSON.stringify({ kind: 'flowchart' })], ['source 为空', JSON.stringify({ source: '   ' })]] ) {
  const failed = panel.parseDrawArgs(input)
  assert.equal(failed.ok, false, `${label} → 必须判失败`)
  assert.ok(typeof failed.reason === 'string' && failed.reason.length > 0, `${label} → 必须给出人读原因`)
  assert.equal(failed.source, null, `${label} → 失败时不编造源码`)
}
assert.equal(panel.parseDrawArgs(undefined).ok, false, 'undefined 入参 → 失败而不是抛错')

// 6.3 节点形状：运行中 vs 已结束（判定法逐字抄官方 toolRowModel 的 `"kind" in block`）
const runningBlock = { callId: 'call_1', name: 'classroom_draw', argsRaw: DRAW_ARGS, turn: 1, step: 1, time: 1, subCalls: [] }
const runningModel = panel.drawBlockModel(runningBlock)
assert.equal(runningModel.done, false, '没有 kind 字段 = 运行中')
assert.equal(runningModel.name, 'classroom_draw')
assert.equal(runningModel.argsRaw, DRAW_ARGS)

const settledBlock = {
  kind: 'tool-result', seq: 9, time: 2, callId: 'call_1',
  call: { name: 'classroom_draw', argsRaw: DRAW_ARGS },
  callTime: 1,
  content: [{ type: 'text', text: '板书图已落盘：diagrams/L01-T01-20260924-102042-flowchart.mmd（flowchart → flowchart-v2｜3 行 / 41 B）' }],
  isError: false, subCalls: [],
}
const settledModel = panel.drawBlockModel(settledBlock)
assert.equal(settledModel.done, true, '有 kind 字段 = 已结束')
assert.equal(settledModel.argsRaw, DRAW_ARGS, '已结束时入参从 block.call.argsRaw 取（官方投影形状）')
assert.equal(settledModel.isError, false)
assert.ok(panel.toolResultText(settledModel.content).startsWith('板书图已落盘：'), '工具结果的人读摘要可取')
assert.equal(panel.toolResultText([{ type: 'image', data: 'x' }]), null, '非 text 块不瞎猜成文本')
assert.equal(panel.toolResultText(null), null)

// 已结束但 call 缺失（官方形状允许 call:null）→ argsRaw 退回空串，而不是抛错
const orphan = panel.drawBlockModel({ kind: 'tool-result', callId: 'c2', call: null, content: [], isError: true, subCalls: [] })
assert.equal(orphan.done, true)
assert.equal(orphan.argsRaw, '')
assert.equal(orphan.isError, true)
assert.equal(panel.parseDrawArgs(orphan.argsRaw).ok, false, '孤儿结果 → 组件走降级态')

// 6.4 主题配置（图里的底色/线色跟着界面走）
const lightInit = panel.mermaidInitConfigFor('light')
const darkInit = panel.mermaidInitConfigFor('dark')
assert.equal(lightInit.theme, 'base', '🔴 必须是 base 主题，否则一部分 themeVariables 会被内置主题覆盖掉')
assert.equal(darkInit.theme, 'base')
assert.equal(lightInit.themeVariables.background, '#FAF9F5', '浅色：暖象牙画布')
assert.equal(darkInit.themeVariables.background, '#262624', '深色：近黑画布')
assert.equal(lightInit.themeVariables.nodeBorder, '#D9D4C8', '浅色：节点描边是暖灰发丝')
assert.equal(darkInit.themeVariables.nodeTextColor, '#F0EEE6', '深色：暖灰字，不发蓝')
assert.equal(lightInit.themeVariables.radius, 8, '圆角 8px')
assert.equal(lightInit.themeVariables.dropShadow, 'none', '🔴 去掉默认投影')
assert.ok(typeof lightInit.themeCSS === 'string' && lightInit.themeCSS.includes('font-weight: 400'), 'themeCSS 里统一字重 400（层级不许靠加粗）')
assert.equal(lightInit.securityLevel, undefined, '🔴 主题配置**不带** securityLevel：客户端等级由调用点钉死，不因换主题被放宽')
assert.equal(darkInit.securityLevel, undefined)
assert.notDeepEqual(lightInit.themeVariables, darkInit.themeVariables, '浅/深两套必须真的不同')
assert.notEqual(lightInit.themeVariables, panel.CLAUDE_MERMAID_LIGHT, '每次返回新对象（initialize 会加工配置，共享同一个有被写脏的风险）')
const fallbackInit = panel.mermaidInitConfigFor('anything-else')
assert.equal(fallbackInit.themeVariables.background, '#FAF9F5', '未知主题名一律退回浅色，不抛错')

// 6.4b 🔴 缓存键里的主题版本号
assert.equal(typeof panel.DIAGRAM_THEME_REV, 'string')
assert.ok(panel.DIAGRAM_THEME_REV.length > 0, '主题版本号不能是空串（否则键里那一层形同不存在）')

// 6.4c 动画开关：默认 stagger，可回退到 none
assert.equal(panel.DRAW_ANIM_DEFAULT, 'stagger', '默认＝候选 B（逐层长出）')
delete globalThis.__DSH_CLASSROOM_UI_CONFIG__
assert.equal(panel.drawAnimMode(), 'stagger', '没配置 → 默认')
globalThis.__DSH_CLASSROOM_UI_CONFIG__ = { drawAnim: 'none' }
assert.equal(panel.drawAnimMode(), 'none', '🔴 写 none 即可不改代码回退到候选 A（只换主题）')
globalThis.__DSH_CLASSROOM_UI_CONFIG__ = { drawAnim: 'stream' }
assert.equal(panel.drawAnimMode(), 'stagger', 'stream（候选 C）本轮未接线 → 落到默认档，不静默装作做了')
globalThis.__DSH_CLASSROOM_UI_CONFIG__ = { drawAnim: 'nonsense' }
assert.equal(panel.drawAnimMode(), 'stagger', '不认识的值 → 默认档')
delete globalThis.__DSH_CLASSROOM_UI_CONFIG__

// 6.5 🔴「设主题 → 渲染」必须**成对串行**（用假 mermaid 驱动真实实现，只记账不渲染）
const calls = []
const fakeMermaid = {
  initialize(config) { calls.push('init:' + config.themeVariables.background) },
  async render(id, source) { calls.push('render:' + id + ':' + source); return { svg: '<svg id="' + id + '"/>' } },
}
const [first, second] = await Promise.all([
  panel.renderDiagram(fakeMermaid, 'SRC-A', 'light'),
  panel.renderDiagram(fakeMermaid, 'SRC-B', 'dark'),
])
assert.deepEqual(calls.map((c) => (c.startsWith('init:') ? c : 'render')),
  ['init:#FAF9F5', 'render', 'init:#262624', 'render'],
  '必须是 init(light)→render(A)→init(dark)→render(B)，不许交错')
assert.ok(calls[1].includes('SRC-A') && calls[3].includes('SRC-B'), '每次 render 紧跟在自己那次 initialize 后面')
assert.ok(first.svg.startsWith('<svg') && second.svg.startsWith('<svg'))
assert.ok(first.ms >= 0 && second.ms >= 0, '返回里带耗时读数')
assert.notEqual(first.svg, second.svg, '两次渲染的 id 不同 → SVG 不同')

// 6.6 一次渲染失败**不能把后面的渲染一起带崩**（链本身永不 reject）
const failing = {
  initialize() {},
  async render() { throw new Error('boom') },
}
await assert.rejects(() => panel.renderDiagram(failing, 'SRC-X', 'light'), /boom/)
const afterFailure = await panel.renderDiagram(fakeMermaid, 'SRC-C', 'light')
assert.ok(afterFailure.svg.includes('classroom-ui-diagram-'), '失败之后链仍然可用，下一张照样画出来')

// ── 7 · 皮肤（§6）：参数表自检 ＋ 「不许用加粗表达层级」的**数据层**证据 ─────────

// 7.1 🔴 方向已**定稿为唯一一个**：`library`（B 讲台骨架 ＋ C 書庫材质）。
//     改前这里是 `quiet` / `board` / `syllabus` 三个"待用户挑的方向预览"（README §4.7 自己写明
//     "不是定稿"）。用户拍板后按当时的约定**删掉没选中的两个**——留着会让"面板长什么样"有两个答案。
const SKIN_IDS = ['library']
assert.deepEqual(Object.keys(panel.SKIN_PRESETS), SKIN_IDS, '定稿方向只能有一个：library（書庫）')
assert.equal(panel.DEFAULT_SKIN, 'library', '默认方向＝定稿方向')
assert.equal(SKIN_IDS.includes('quiet') || SKIN_IDS.includes('board') || SKIN_IDS.includes('syllabus'), false,
  '预览期的三个方向必须已经删掉（不留"另一个答案"）')
for (const id of SKIN_IDS) {
  const skin = panel.SKIN_PRESETS[id]
  assert.equal(skin.id, id, `${id} 的 id 必须与键一致`)
  assert.ok(typeof skin.name === 'string' && skin.name.length > 0, `${id} 必须有一句话名字`)
  assert.ok(typeof skin.oneLiner === 'string' && skin.oneLiner.length > 10, `${id} 必须有一句话定位`)
  // C 書庫材质的取色面（深浅两套都要齐）
  for (const mode of ['light', 'dark']) {
    for (const key of ['surface', 'inner', 'wood', 'gold', 'goldRule', 'read', 'spine', 'spineDone', 'spineTodo']) {
      assert.ok(typeof skin.paper[mode][key] === 'string' && skin.paper[mode][key].length > 0,
        `${id}.paper.${mode}.${key} 必须给出（書庫材质缺一项就画不出来）`)
    }
  }
  assert.notEqual(skin.paper.light.surface, skin.paper.dark.surface, '深浅两套纸面必须不同')
}

// 7.2 🔴 皮肤表里**不许出现 fontWeight**（含 'fontWeight' 这个键）
const stringify = (value) => JSON.stringify(value)
for (const id of SKIN_IDS) {
  assert.equal(/fontWeight|font-weight|font:\s/.test(stringify(panel.SKIN_PRESETS[id])), false,
    `${id} 的参数表里不许出现 font-weight / font 简写（层级只能靠字号·字距·字色·字面）`)
}

// 7.3 四个字色档必须在，且都取自宿主 alias token（不是写死色值）
for (const id of SKIN_IDS) {
  const ink = panel.SKIN_PRESETS[id].ink
  assert.deepEqual(Object.keys(ink).map(Number), [1, 2, 3, 4], `${id} 必须给 4 级字色阶梯`)
  for (const rung of [1, 2, 3, 4]) {
    assert.ok(String(ink[rung]).startsWith('var(--dsw-alias-label-'), `${id} 的第 ${rung} 档字色必须走宿主 alias token`)
    assert.ok(String(ink[rung]).includes(','), `${id} 的第 ${rung} 档字色必须带 fallback（取不到 token 也不能空）`)
  }
  assert.equal(new Set([1, 2, 3, 4].map((r) => ink[r])).size, 4, `${id} 的四档字色必须是四个不同取值`)
}

// 7.4 发丝线口径：两处边界都是 0.5px
for (const id of SKIN_IDS) {
  const line = panel.SKIN_PRESETS[id].line
  assert.ok(line.hair.startsWith('0.5px solid '), `${id} 的分节线必须是 0.5px 发丝线`)
  assert.ok(line.box.startsWith('0.5px solid '), `${id} 的盒边界必须是 0.5px 发丝线`)
  assert.ok(line.hair.includes('var(--dsw-alias-border-'), `${id} 的分节线必须走宿主 border token`)
  assert.ok(line.box.includes('var(--dsw-alias-border-'), `${id} 的盒边界必须走宿主 border token`)
}

// 7.5 字号阶梯只取官方 **400 字重那一档**（不带 `-strong-` 后缀）
for (const id of SKIN_IDS) {
  const type = panel.SKIN_PRESETS[id].type
  assert.deepEqual(Object.keys(type).sort(), ['body', 'code', 'head', 'label', 'meta', 'prose', 'title'],
    `${id} 的排版角色必须齐（title/head/body/label/meta/prose/code）`)
  for (const [role, value] of Object.entries(type)) {
    assert.ok(Object.prototype.hasOwnProperty.call(panel.TYPE_STEPS, value.fontSize.match(/--dsw-font-([a-z0-9-]+)-font-size/)[1]),
      `${id}.${role} 的字号必须来自官方 --dsw-font-<档> 分量 token`)
    assert.equal(value.fontSize.includes('-strong-'), false, `${id}.${role} 不许用 -strong- 档（那是 500）`)
    assert.equal(value.lineHeight.includes('-strong-'), false, `${id}.${role} 不许用 -strong- 档行高`)
    assert.ok(typeof value.letterSpacing === 'string' && value.letterSpacing.length > 0, `${id}.${role} 必须给字距（层级手段之一）`)
    // 🔴 字面这一条**分两族判**：sans/mono 是 [借官方]（必须引宿主 token）；serif 是 [自己定]
    //    ——`dsh-client-ui-theme` 里**根本没有 serif token**（实测该包只有 sans/mono 两族），
    //    而 STAGE-3 的 C 方向把衬线当作纸面材质的一部分（`--font-serif` 逐字搬进本文件）。
    //    所以：引了宿主 token 的照旧；衬线的必须是**导出的那一份自定栈**，不许随手写别的字体。
    if (value.fontFamily === panel.SERIF) {
      assert.ok(panel.SERIF.includes('serif'), `${id}.${role} 的 serif 栈必须真的以 serif 收尾`)
      assert.equal(panel.SERIF.includes('var(--dsw-font-'), false, 'serif 是自定栈，不许假装引了宿主 token')
    } else {
      assert.ok(value.fontFamily.includes('var(--dsw-font-'), `${id}.${role} 的字面必须走宿主 token（sans/mono）`)
    }
    assert.equal(Object.prototype.hasOwnProperty.call(value, 'fontWeight'), false, `${id}.${role} 不许有 fontWeight`)
  }
  // 三级字面都要用上（层级手段之一：字面），否则 serif 白加了
  const families = new Set(Object.values(type).map((value) => value.fontFamily))
  assert.equal(families.size, 3, `${id} 必须真的用到三级字面（sans / serif / mono）`)
  assert.ok(families.has(panel.SANS) && families.has(panel.MONO) && families.has(panel.SERIF), `${id} 三级字面＝SANS/MONO/SERIF`)
}

// 7.6 样式键集合**不许缩水**（组件里 `S.xxx` 拿到 undefined 就是白屏）
const keySets = SKIN_IDS.map((id) => Object.keys(panel.buildStyles(panel.SKIN_PRESETS[id])).sort())
assert.equal(new Set(keySets.map((keys) => keys.join(','))).size, 1, '各方向的样式键集合必须相同')
// 面板本体（書庫）真正用到的那些键，一个都不能少
const REQUIRED_STYLE_KEYS = [
  'root', 'headTitle', 'headMeta', 'headRule', 'sectionFor', 'sectionLabel',
  'lessonLine', 'lessonNo', 'fieldRow', 'fieldLabel', 'fieldValue',
  'spineStrip', 'spine', 'spineDone', 'spineCurrent', 'spineTodo',
  'index', 'indexRow', 'indexRowCurrent', 'indexMark', 'indexNo', 'indexTitle', 'indexTitleCurrent', 'indexTitleRest', 'indexCore',
  'board', 'boardRail', 'boardNotice', 'boardSummary', 'boardDiag',
  'source', 'sourcePath', 'button', 'note', 'error',
  'portraitBox', 'portraitBoxCollapsed', 'canvas',
  'drawCard', 'drawTitle', 'drawMeta', 'drawCanvas',
]
for (const key of REQUIRED_STYLE_KEYS) {
  assert.ok(keySets[0].includes(key), `样式表必须给出 S.${key}`)
}
assert.equal(typeof panel.buildStyles(panel.SKIN_PRESETS.library).varsFor, 'function', '必须给出 varsFor(mode)（深浅两套纸面）')

// 7.7 派生的样式表里**一处 fontWeight 都不能有**（这是"不许用加粗做层级"的数据层证据）
for (const id of SKIN_IDS) {
  const styles = panel.buildStyles(panel.SKIN_PRESETS[id])
  for (const [key, value] of Object.entries(styles)) {
    if (typeof value !== 'object' || value === null) continue
    assert.equal(Object.prototype.hasOwnProperty.call(value, 'fontWeight'), false,
      `${id} 的 S.${key} 里不许出现 fontWeight`)
  }
  // 每个方向都必须给出 CSS 变量（伪类规则要用）
  for (const name of ['--cui-hover-fill', '--cui-ring', '--cui-ink-1', '--cui-ink-2', '--cui-ink-4']) {
    assert.ok(typeof styles.vars[name] === 'string' && styles.vars[name].length > 0, `${id} 必须给出 ${name}`)
  }
  assert.equal(typeof styles.sectionFor, 'function', `${id} 必须给出 sectionFor`)
}

// 7.8 `sectionFor` 的三种成形方式都能取到
for (const id of SKIN_IDS) {
  const styles = panel.buildStyles(panel.SKIN_PRESETS[id])
  const first = styles.sectionFor(false)
  const rest = styles.sectionFor(true)
  assert.ok(first !== null && rest !== null)
  const way = panel.SKIN_PRESETS[id].section
  if (way === 'rule') {
    assert.equal(Object.prototype.hasOwnProperty.call(first, 'borderTop'), false, `${id}：rule 方式下首块不画分节线`)
    assert.ok(String(rest.borderTop).startsWith('0.5px solid '), `${id}：rule 方式下非首块必须有分节线`)
  } else {
    assert.equal(String(first.border).startsWith('0.5px solid '), true, `${id}：${way} 方式每块都有边界发丝线`)
  }
}

// 7.9 皮肤 id 解析：认配置、认不出就退回默认（绝不因为配错就白屏）
//     🔴 现在只有一个合法取值：`library`。`skin` 这个配置面**保留**（键名与语义不变），
//        只是"配错名字"与"配默认名字"落到同一个方向——这正是收窄方向后的预期形状。
delete globalThis.__DSH_CLASSROOM_UI_CONFIG__
assert.equal(panel.skinId(), 'library', '未配置 → 定稿方向')
const libraryStyles = panel.styles()
assert.equal(panel.styles(), libraryStyles, '同一方向下样式对象必须被缓存（同引用）')
globalThis.__DSH_CLASSROOM_UI_CONFIG__ = { skin: 'library' }
assert.equal(panel.skinId(), 'library', '显式配 library 仍然解析得到')
assert.equal(panel.styles(), libraryStyles, '同一个方向 → 同一套样式对象')
globalThis.__DSH_CLASSROOM_UI_CONFIG__ = { skin: 'not-a-skin' }
assert.equal(panel.skinId(), 'library', '认不出的方向名 → 退回默认，不抛错')
globalThis.__DSH_CLASSROOM_UI_CONFIG__ = { skin: 'quiet' }
assert.equal(panel.skinId(), 'library', '已删除的预览方向名（quiet）也退回默认，不抛错、不白屏')
delete globalThis.__DSH_CLASSROOM_UI_CONFIG__

// 7.10 皮肤那几条 CSS 只引 `--cui-*` 变量（不许把色值/字号写死在 CSS 里）
assert.ok(panel.SKIN_CSS.includes('var(--cui-hover-fill)'), 'CSS 必须引 --cui-hover-fill')
assert.equal(/#[0-9a-fA-F]{3,8}|rgba?\(|px\s/.test(panel.SKIN_CSS.replace(/1\.5px solid var\(--cui-ring\)/, '')), false,
  'CSS 里不许出现字面色值/尺寸（除了 outline 的 1.5px 线宽）')

// ── 8 · 表情（EXPR-3）：状态文件解析 → 计划 → 逐参数驱动器 ──────────────────

// 8.1 解析 `runtime/expression.md`（**逐字用 EXPR-1 §5.2 的格式**）
const EXPR_FACE_MD = [
  '# 本课表情（老师自主决定）',
  '',
  'expression_path: face-parameters',
  'current_expression: -',
  'expression_face: PARAM_BROW_L_Y=0.25,PARAM_CHEEK=0.1,PARAM_EYE_L_OPEN=0.9',
  'expression_motion: -',
  'expression_origin: teacher',
  'expression_emotion: -',
  'expression_turn: 2',
  'expression_capability: ok',
  '',
  '<!-- 注释里的人话不影响解析 -->',
  '',
  '| 项 | 值 |',
  '|---|---|',
  '| 走哪条路 | face-parameters |',
].join('\n')

const parsedFace = panel.parseExpression(EXPR_FACE_MD)
assert.equal(parsedFace.path, 'face-parameters')
assert.equal(parsedFace.expression, null, '`-` 一律当「没有」，不当字符串 "-"')
assert.deepEqual(parsedFace.face, { PARAM_BROW_L_Y: 0.25, PARAM_CHEEK: 0.1, PARAM_EYE_L_OPEN: 0.9 })
assert.deepEqual(parsedFace.faceMalformed, [], '三个片段都合法 → 没有畸形片段')
assert.equal(parsedFace.motion, null)
assert.equal(parsedFace.origin, 'teacher')
assert.equal(parsedFace.emotion, null)
assert.equal(parsedFace.turn, '2')
assert.equal(parsedFace.capability, 'ok')

// 畸形片段必须**如实报出来**（不许静默少写）
const parsedBad = panel.parseExpressionFace('A=1,=2,B=x,C=3,,D=-0.5')
assert.deepEqual(parsedBad.face, { A: 1, C: 3, D: -0.5 })
assert.deepEqual(parsedBad.malformed, ['=2', 'B=x', ''])
assert.deepEqual(panel.parseExpressionFace(null).face, {}, '整行缺失 → 空表，不抛错')

// 8.2 `expressionPlan()`：三种来源分得很清
const planAbsent = panel.expressionPlan(null)
assert.equal(planAbsent.source, 'absent')
assert.equal(planAbsent.path, null)
assert.ok(planAbsent.reason.includes('相位映射'), '没有文件时要说清「沿用旧的相位映射」')
assert.equal(planAbsent.parsed, null)

const planFace = panel.expressionPlan(EXPR_FACE_MD)
assert.equal(planFace.source, 'engine')
assert.equal(planFace.path, 'face-parameters')
assert.equal(planFace.inferred, false, '文件里写了 expression_path → 不是推断')
assert.deepEqual(planFace.value, { PARAM_BROW_L_Y: 0.25, PARAM_CHEEK: 0.1, PARAM_EYE_L_OPEN: 0.9 })

const planNamed = panel.expressionPlan('current_expression: F04\nexpression_path: named-expression\nexpression_origin: teacher\n')
assert.equal(planNamed.path, 'named-expression')
assert.equal(planNamed.value, 'F04')

const planMotion = panel.expressionPlan('expression_path: motion\nexpression_motion: Serious\n')
assert.equal(planMotion.path, 'motion')
assert.equal(planMotion.value, 'Serious')

// 旧格式（没有 expression_path 行）→ 按引擎自己的优先级推断，**并如实标注是推断**
const planOld = panel.expressionPlan('current_expression: F04\nexpression_origin: fallback\n')
assert.equal(planOld.path, 'named-expression', '没有 path 行 → 按 named > face > motion 推断')
assert.equal(planOld.inferred, true, '推断必须被标出来（推断 ≠ 引擎声明的路）')
assert.ok(planOld.reason.includes('推断'))

// 三路都没有（引擎判定不可用）→ path 为 null ＋ 说清原因
const planNone = panel.expressionPlan('expression_path: -\ncurrent_expression: -\nexpression_face: -\nexpression_motion: -\nexpression_capability: unavailable\nexpression_origin: unavailable\nexpression_note: 该模型没有命名表情也没有脸部参数\n')
assert.equal(planNone.path, null)
assert.equal(planNone.unavailable, true)
assert.ok(planNone.reason.includes('该模型没有命名表情也没有脸部参数'), '原因原样带出来（面板要显示）')
assert.equal(panel.parseExpression('expression_path: -\n').hasPathLine, true)
assert.equal(panel.parseExpression('current_expression: F01\n').hasPathLine, false)
assert.equal(planNone.inferred, false, '引擎写了 `-`（明确不可用）→ 不许说成"推断"')
assert.equal(panel.expressionPlan('expression_path: -\ncurrent_expression: F01\n').path, null, '写了 `-` 就不许再去字段里推断')

// 声明走某条路、那一行却是空的 → 不动立绘（不猜）
const planEmpty = panel.expressionPlan('expression_path: face-parameters\nexpression_face: -\n')
assert.equal(planEmpty.path, null)
assert.ok(planEmpty.reason.includes('对应的那一行是空的'))

// 认不出的 path（引擎换词/写坏）→ 不猜
const planWeird = panel.expressionPlan('expression_path: whatever\ncurrent_expression: F01\n')
assert.equal(planWeird.path, null)
assert.ok(planWeird.reason.includes('认不出'))

// 8.3 `expressionKey()`：只有"路 + 取值"变了才重设
assert.equal(panel.expressionKey(panel.expressionPlan(EXPR_FACE_MD)), panel.expressionKey(panel.expressionPlan(EXPR_FACE_MD)))
const faceChanged = EXPR_FACE_MD.replace('PARAM_CHEEK=0.1', 'PARAM_CHEEK=0.9')
assert.notEqual(panel.expressionKey(panel.expressionPlan(EXPR_FACE_MD)), panel.expressionKey(panel.expressionPlan(faceChanged)))
assert.notEqual(panel.expressionKey(panel.expressionPlan(EXPR_FACE_MD)), panel.expressionKey(panel.expressionPlan(null)), '从有到无也必须触发一次')

// 8.4 逐参数驱动器：用假宿主把三条纪律逐条断言下来
function fakeModelHost(ids) {
  const values = new Map(ids.map((id) => [id, 0]))
  const writes = []
  const model = {
    getParameterCount: () => ids.length,
    getParameterId: (index) => ({ getString: () => ids[index] }),
    setParameterValueByIndex: (index, value) => {
      values.set(ids[index], value)
      writes.push({ id: ids[index], value })
    },
  }
  return { host: { userModel: { getModel: () => model } }, values, writes }
}

const IDS = ['PARAM_EYE_L_OPEN', 'PARAM_EYE_R_OPEN', 'PARAM_BROW_L_Y', 'PARAM_MOUTH_FORM', 'ParamMouthOpenY']
assert.deepEqual(Array.from(panel.parameterIndexMap(fakeModelHost(IDS).host.userModel.getModel()).entries()),
  IDS.map((id, index) => [id, index]), '参数 id → 下标全表（引擎给的是字符串，不能直接塞给 getParameterIndex）')

// ① 每帧平滑：触发帧**不许硬切**（第一帧只走 1/4 的差距）
{
  const fake = fakeModelHost(IDS)
  const driver = panel.createFaceDriver(fake.host, { lipSyncIds: ['ParamMouthOpenY'] })
  driver.setTargets({ PARAM_EYE_L_OPEN: 1 })
  driver.write()
  assert.equal(fake.values.get('PARAM_EYE_L_OPEN'), panel.FACE_LERP_K, '第一帧只走 k 倍差距（硬切会等于 1）')
  for (let i = 0; i < 60; i++) driver.write()
  assert.ok(Math.abs(fake.values.get('PARAM_EYE_L_OPEN') - 1) < 1e-3, '若干帧后收敛到目标值')
}

// ② 先清零再写：每一帧里，**本表出现过的全部参数**都先被写 0，再写插值结果
{
  const fake = fakeModelHost(IDS)
  const driver = panel.createFaceDriver(fake.host, { lipSyncIds: ['ParamMouthOpenY'] })
  driver.setTargets({ PARAM_EYE_L_OPEN: 1, PARAM_BROW_L_Y: 0.5 })
  fake.writes.length = 0
  driver.write()
  assert.deepEqual(fake.writes, [
    { id: 'PARAM_EYE_L_OPEN', value: 0 }, { id: 'PARAM_BROW_L_Y', value: 0 },
    { id: 'PARAM_EYE_L_OPEN', value: panel.FACE_LERP_K }, { id: 'PARAM_BROW_L_Y', value: 0.5 * panel.FACE_LERP_K },
  ], '先清零（本表出现过的全部参数）再写插值结果；两步同一帧内，那个 0 不会上屏')

  // 换表：清零范围＝**累计出现过的全部参数**（不是"当前这一条的几个"）
  driver.setTargets({ PARAM_MOUTH_FORM: -1 })
  const before = fake.values.get('PARAM_BROW_L_Y')
  fake.writes.length = 0
  driver.write()
  assert.deepEqual(fake.writes.slice(0, 3), [
    { id: 'PARAM_EYE_L_OPEN', value: 0 }, { id: 'PARAM_BROW_L_Y', value: 0 }, { id: 'PARAM_MOUTH_FORM', value: 0 },
  ], '清零范围＝累计出现过的三个参数（上一张表的两个也在内）')
  assert.ok(fake.values.get('PARAM_BROW_L_Y') < before, '上一张表的参数在淡出')
  assert.ok(fake.values.get('PARAM_MOUTH_FORM') > -1, '新参数从 0 起步（不是一步跳到 -1）')
  for (let i = 0; i < 80; i++) driver.write()
  assert.ok(Math.abs(fake.values.get('PARAM_MOUTH_FORM') + 1) < 1e-3)
  assert.ok(Math.abs(fake.values.get('PARAM_BROW_L_Y')) < 1e-3, '被撤掉的参数最终归 0（不留残值）')
}

// ③ 过滤 LipSync 参数：嘴型通道与表情通道**不许抢同一个参数**
{
  const fake = fakeModelHost(IDS)
  const driver = panel.createFaceDriver(fake.host, { lipSyncIds: ['ParamMouthOpenY'] })
  driver.setTargets({ PARAM_EYE_L_OPEN: 1, ParamMouthOpenY: 1 })
  const stats = driver.readout()
  assert.deepEqual(stats.skippedLipSync, ['ParamMouthOpenY'], '嘴参数被跳过且**如实记账**')
  assert.equal(stats.written, 1, '只写了非嘴参数那一个')
  for (let i = 0; i < 20; i++) driver.write()
  assert.equal(fake.writes.some((entry) => entry.id === 'ParamMouthOpenY'), false, '嘴参数一个字节都不许写')
}

// ④ 模型里没有的参数：跳过 ＋ 如实报（不许静默少写）
{
  const fake = fakeModelHost(IDS)
  const driver = panel.createFaceDriver(fake.host, { lipSyncIds: [] })
  driver.setTargets({ PARAM_EYE_L_OPEN: 0.5, 'PARAM_NOT_IN_MODEL': 1 })
  const stats = driver.readout()
  assert.deepEqual(stats.unknownIds, ['PARAM_NOT_IN_MODEL'])
  assert.equal(stats.written, 1)
  assert.equal(driver.readout().active, true)
}

// ⑤ 收尾：`setTargets(null)` → 淡出到 0 之后**自动停手**（把参数交还动作/呼吸）
{
  const fake = fakeModelHost(IDS)
  const driver = panel.createFaceDriver(fake.host, { lipSyncIds: [] })
  driver.setTargets({ PARAM_EYE_L_OPEN: 1 })
  for (let i = 0; i < 40; i++) driver.write()
  driver.setTargets(null)
  let frames = 0
  while (driver.readout().active && frames < 200) { driver.write(); frames += 1 }
  assert.equal(driver.readout().active, false, '收敛后必须停手（否则参数被永久钉住）')
  assert.ok(Math.abs(fake.values.get('PARAM_EYE_L_OPEN')) < 1e-3, '停手时值已经归 0')
  const frozen = fake.writes.length
  driver.write()
  assert.equal(fake.writes.length, frozen, '停手之后一帧都不许再写')
}

// ⑥ updater：执行序必须落在 late-update 段
{
  const fake = fakeModelHost(IDS)
  const driver = panel.createFaceDriver(fake.host, { lipSyncIds: [] })
  const updater = driver.updater()
  assert.equal(updater.getExecutionOrder(), panel.FACE_UPDATER_ORDER)
  assert.equal(panel.FACE_UPDATER_ORDER > 600 && panel.FACE_UPDATER_ORDER < 700, true,
    '执行序必须在 Physics(600) 与 LipSync(700) 之间（见 live2d-host 的 icubismupdater.ts 枚举）')
  for (const name of ['onLateUpdate', 'addChangeListener', 'removeChangeListener', 'getExecutionOrder']) {
    assert.equal(typeof updater[name], 'function', `scheduler 会调 ${name}，必须提供`)
  }
  driver.setTargets({ PARAM_EYE_L_OPEN: 1 })
  updater.onLateUpdate({}, 0)
  assert.ok(fake.values.get('PARAM_EYE_L_OPEN') > 0, 'onLateUpdate 必须真的写参数')
}

// 8.5 面板文案表：三条路都要有人话名字（面板显示用）
assert.deepEqual(panel.EXPRESSION_PATH_LABEL, { 'named-expression': '命名表情', 'face-parameters': '逐参数', motion: '动作组' })
assert.equal(panel.EXPRESSION_POLL_MS > 0 && panel.EXPRESSION_POLL_MS <= 1000, true, '回合内轮询间隔要在 1 秒内')

// 8.6 🔴 参数名形状：驼峰与全大写蛇形都可能出现
assert.equal(panel.parameterShape('PARAM_EYE_L_OPEN'), panel.parameterShape('ParamEyeLOpen'), '同形状归一（只用于提示）')
assert.equal(panel.parameterShape('ParamEyeLOpen'), 'PARAMEYELOPEN')
{
  const fake = fakeModelHost(['ParamEyeLOpen', 'ParamMouthForm'])
  const driver = panel.createFaceDriver(fake.host, { lipSyncIds: [] })
  driver.setTargets({ PARAM_EYE_L_OPEN: 1 })            // 形状不同 → 模型里没有这个 id
  const stats = driver.readout()
  assert.deepEqual(stats.unknownIds, ['PARAM_EYE_L_OPEN'], '认不出的 id 要如实报')
  assert.deepEqual(stats.shapeHints, [{ id: 'PARAM_EYE_L_OPEN', modelId: 'ParamEyeLOpen' }], '按形状给出提示（提示 ≠ 写值）')
  assert.equal(stats.written, 0, '一个参数都没写进去')
  assert.equal(stats.active, false, '写不进去就不该进入"在写"状态')
  for (let i = 0; i < 10; i++) driver.write()
  assert.equal(fake.writes.length, 0, '认不出的 id 一个字节都不许写（不许猜着写）')
}

// 8.7 重播判据（EXPR-3 小修 ①）：内容键只由图本身决定，**不含主题**
const keyOf = panel.drawAnimKey
assert.equal(keyOf('s1', 'flowchart', 'flowchart TD\nA-->B'), keyOf('s1', 'flowchart', 'flowchart TD\nA-->B'), '同内容 → 同键（切主题不重播）')
assert.notEqual(keyOf('s1', 'flowchart', 'flowchart TD\nA-->B'), keyOf('s1', 'flowchart', 'flowchart TD\nA-->C'), '换图源 → 键变（照常重播）')
assert.notEqual(keyOf('s1', 'flowchart', 'X'), keyOf('s2', 'flowchart', 'X'), '换会话 → 键变')
assert.notEqual(keyOf('s1', 'flowchart', 'X'), keyOf('s1', 'sequenceDiagram', 'X'), '换图类型 → 键变')
assert.equal(keyOf.length, 3, '内容键只吃三个参数——**主题不在里面**（这就是"切主题不重播"的根据）')

// ── 9 · EXPR-5：逐参数夹取（按模型自己的值域）＋ 部署声明与两侧一致性自检 ──────

// 9.1 假宿主要能给出**模型自己的值域**（真宿主＝getParameterMinimumValue/MaximumValue）。
const RANGES = { ParamEyeLOpen: [0, 2], ParamAngleX: [-30, 30], ParamBrowLY: [-1, 1] }
function fakeModelHostRanged(ids, ranges) {
  const values = new Map(ids.map((id) => [id, 0]))
  const writes = []
  const model = {
    getParameterCount: () => ids.length,
    getParameterId: (index) => ({ getString: () => ids[index] }),
    getParameterMinimumValue: (index) => ranges[ids[index]][0],
    getParameterMaximumValue: (index) => ranges[ids[index]][1],
    setParameterValueByIndex: (index, value) => { values.set(ids[index], value); writes.push({ id: ids[index], value }) },
  }
  return { host: { userModel: { getModel: () => model } }, values, writes }
}

// 9.1a 越界值 → **按模型自己的值域夹到边界**，并逐条记账（不静默）
{
  const fake = fakeModelHostRanged(['ParamEyeLOpen', 'ParamAngleX', 'ParamBrowLY'], RANGES)
  const driver = panel.createFaceDriver(fake.host, { lipSyncIds: [] })
  driver.setTargets({ ParamEyeLOpen: 3, ParamAngleX: -100, ParamBrowLY: 0.5 })
  const stats = driver.readout()
  assert.deepEqual(stats.clamped, [
    { id: 'ParamEyeLOpen', requested: 3, applied: 2, min: 0, max: 2 },
    { id: 'ParamAngleX', requested: -100, applied: -30, min: -30, max: 30 },
  ], '夹到边界并如实记账（只记真的被改过的那个；合法值不记账）')
  assert.equal(stats.values.ParamEyeLOpen.target, 2, '驱动器的目标是**夹取后**的值（读数与模型里一致）')
  assert.equal(stats.values.ParamAngleX.target, -30)
  assert.equal(stats.values.ParamBrowLY.target, 0.5, '合法值原样通过（不许夹坏正常值）')
  for (let i = 0; i < 200; i++) driver.write()
  assert.ok(Math.abs(fake.values.get('ParamEyeLOpen') - 2) < 1e-9, '收敛后模型里就是 2（不是 3）')
  assert.ok(Math.abs(fake.values.get('ParamAngleX') + 30) < 1e-9)
  assert.ok(Math.abs(fake.values.get('ParamBrowLY') - 0.5) < 1e-9, '合法值原样通过（不许夹坏正常值）')
}

// ── 10 · 视觉 DOM 断言（面板：B 讲台骨架 ＋ C 書庫材质）────────────────────────
//
// 🔴 为什么在 node 侧还要渲染一遍：`lib/client.js` 的面板是**内联样式**组件——
//    "面板长什么样"这件事**全在渲染出来的那棵树里**（色阶／字号／字距／字面／发丝线／
//    书脊的状态），而不是散在 CSS 文件里。所以这里用一个**最小的 React 替身**把
//    **真实组件**（`ClassroomBody` / `PortraitStage`）渲染成树，再对树做断言。
//    测的是真组件产出的 DOM，不是另写一份"期望长这样"的清单。
//    🔴 浏览器侧另有真截图（隔离 profile 里真读盘，见验收脚本）——两者互不替代：
//       这一节抓的是"结构／样式取值"，截图抓的是"肉眼与像素"。

/** 依赖数组是否与上次相同（`useEffect` 只在变化时重跑）。 */
function sameDeps(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  return a.every((value, index) => Object.is(value, b[index]))
}

/**
 * 最小 React 替身：够跑 `ClassroomBody` / `PortraitStage`。
 * 只实现本插件真正用到的那几个 API，并且**真的支持 setState 后重渲染**
 * （立绘那条路要靠异步失败把状态推到 `failed`，不重渲染就看不到那一行）。
 */
function makeReact() {
  const hooks = []
  const effects = []
  let cursor = 0
  let dirty = false
  return {
    api: {
      createElement: (type, props, ...kids) => ({
        __element: true,
        type,
        props: Object.assign({}, props === null || props === undefined ? {} : props,
          kids.length === 0 ? {} : { children: kids.length === 1 ? kids[0] : kids }),
      }),
      useRef: (init) => {
        const index = cursor++
        if (!(index in hooks)) hooks[index] = { current: init }
        return hooks[index]
      },
      useState: (init) => {
        const index = cursor++
        if (!(index in hooks)) hooks[index] = typeof init === 'function' ? init() : init
        return [hooks[index], (next) => {
          const value = typeof next === 'function' ? next(hooks[index]) : next
          if (!Object.is(value, hooks[index])) { hooks[index] = value; dirty = true }
        }]
      },
      useEffect: (fn, deps) => {
        const index = cursor++
        if (!(index in hooks) || !sameDeps(hooks[index], deps)) { hooks[index] = deps; effects.push(fn) }
      },
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    },
    /** 把元素树渲染成宿主树（`{tag, props, kids}`）；组件在渲染过程中被真正调用。 */
    build(node) {
      if (node === null || node === undefined || typeof node !== 'object') return node
      if (Array.isArray(node)) return node.map((kid) => this.build(kid))
      if (node.__element !== true) return node
      if (typeof node.type === 'function') return this.build(node.type(node.props))
      const host = { tag: node.type, props: node.props, kids: [] }
      // ref：React 在挂载后写 `ref.current`——立绘的装载效果全靠它拿到 canvas，必须照做。
      const ref = node.props.ref
      if (ref !== null && typeof ref === 'object') ref.current = host
      const kids = node.props.children
      host.kids = (Array.isArray(kids) ? kids : kids === undefined ? [] : [kids])
        .map((kid) => this.build(kid))
        .filter((kid) => kid !== null && kid !== undefined && kid !== false && kid !== true)
      return host
    },
    /** 渲染 + 跑效果 + 让 setState 的重渲染落地（有界循环，最多 20 轮）。 */
    async render(element) {
      let tree = null
      let quiet = 0
      for (let pass = 0; pass < 20; pass++) {
        cursor = 0
        dirty = false
        const pending = effects.splice(0, effects.length)
        tree = this.build(element)
        for (const fn of pending) fn()
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (!dirty) { quiet += 1; if (quiet >= 3) break } else quiet = 0
      }
      return tree
    },
  }
}

/** 深度优先找全部满足条件的宿主节点。 */
function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const kid of node) findAll(kid, predicate, out); return out }
  if (node.__element === true) return out
  if (predicate(node)) out.push(node)
  for (const kid of node.kids) findAll(kid, predicate, out)
  return out
}
/** 找第一个带某个 prop 的宿主节点。 */
const findOne = (tree, prop) => findAll(tree, (node) => Object.prototype.hasOwnProperty.call(node.props, prop))[0] ?? null
/** 节点上的全部文本（用于断言"这句文案真的画出来了"）。 */
function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node.__element === true) return ''
  return node.kids.map(textOf).join('')
}

/** 假 remote：读什么都失败（用来把立绘推到 `failed`——正是本机"Live2D 未部署"的真实形状）。 */
function failingRemote() {
  const missing = (path) => ({ ok: false, error: { code: 'workspace-file/not-found', message: `no entry at "${path}"` } })
  return {
    workspaceFiles: {
      read: async (_sessionId, path) => missing(path),
      readAll: async (_sessionId, path) => missing(path),
    },
  }
}

/** 一份**固定的**面板快照：直接喂给组件，不经过读盘（读盘本身在第 3 节已单独验过）。 */
function snapshotOf(data, sources, status = 'ready') {
  return { status, error: null, data, sources }
}

const react = makeReact()
const panelReact = registration.factory((specifier) => {
  if (specifier === 'react') return react.api
  throw new Error(`未预期的 require("${specifier}")`)
})
// 🔴 必须用**同一个模块实例**的样式表：`factory(require)` 每调一次就重跑一遍工厂体，
//    于是 `panel` 与 `panelReact` 各自持有一份 `stylesCache`——按 `style === S.xxx`
//    定位节点的断言只有在"同一个实例"下才成立（这里取渲染组件的那一份）。
const S = panelReact.styles()

/** 渲染一次面板；`data` 默认用真读盘的结果，`sources` 用真读盘的结果。 */
async function renderPanel(data = loaded.data, sources = loaded.sources, portrait = null) {
  const store = {
    subscribe: () => () => {},
    getSnapshot: () => snapshotOf(data, sources),
    refresh: () => {},
  }
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  // 立绘那一块挂了两个轮询定时器（表情文件、读数）；这里只验"画出来的树"，不让定时器拖着进程。
  globalThis.setInterval = () => 0
  globalThis.clearInterval = () => {}
  try {
    return await react.render(react.api.createElement(panelReact.ClassroomBody, {
      classroom: store,
      portrait: portrait === null
        ? { ctx: { remote: failingRemote() }, sessionId: 'session-under-test' }
        : portrait,
    }))
  } finally {
    globalThis.setInterval = realSetInterval
    globalThis.clearInterval = realClearInterval
  }
}

const tree = await renderPanel()

// 10.1 根：木框 ＋ 纸面（C 書庫），且方向已定稿为唯一方向 library
const root = findOne(tree, 'data-classroom-ui')
assert.ok(root !== null, '面板根必须渲染出来')
assert.equal(root.props['data-classroom-ui'], 'body')
assert.equal(root.props['data-classroom-ui-skin'], 'library', '面板必须走定稿的書庫方向')
assert.equal(root.props['data-cui-frame'], 'library', '書庫木框必须在 DOM 上可断言')
assert.equal(root.props['data-cui-theme'], 'light', '没有 document（node 侧）→ 浅色纸面')
assert.equal(root.props.style.borderImageSource, 'var(--cui-wood)', '面板根必须带木框（C 書庫的 frame）')
assert.equal(root.props.style.background, 'var(--cui-paper)', '面板根必须带纸面（C 書庫的 paper）')
assert.equal(root.props.style.backgroundClip, 'padding-box', '纸面只画在框内（不许从边框底下漏出来）')
assert.equal(root.props.style.boxSizing, 'border-box', '宽度 100% ＋ 边框必须 border-box，否则窄栏横向溢出')
assert.ok(String(root.props.style.boxShadow).includes('var(--cui-paper-inner)'), '纸面内圈那条发丝必须画出来')
for (const name of ['--cui-paper', '--cui-wood', '--cui-gold', '--cui-gold-rule', '--cui-read', '--cui-spine', '--cui-board-fill']) {
  assert.ok(typeof root.props.style[name] === 'string' && root.props.style[name].length > 0, `根元素必须给出 ${name}`)
}

// 10.2 深浅两套纸面：浅色取奶白（STAGE-3 C 的纸），深色**不是**奶白（否则深色右栏炸出一块白）
assert.ok(S.varsFor('light')['--cui-paper'].includes('#FBF7E4'), '浅色纸面＝STAGE-3 C 的奶白纸')
assert.ok(S.varsFor('dark')['--cui-paper'].includes('#241d16'), '深色纸面另给一套暖深色')
assert.notEqual(S.varsFor('light')['--cui-paper'], S.varsFor('dark')['--cui-paper'], '两套纸面必须真的不同')
assert.equal(panel.themeMode(), 'light', '没有 document → 浅色（不抛错）')

// 10.3 书脊索引：14 根，当前那根独一份（**课程表不再是表格行＋灰底＋药丸**）
const spines = findAll(tree, (node) => Object.prototype.hasOwnProperty.call(node.props, 'data-cui-spine'))
assert.equal(spines.length, 14, '书脊必须 14 根（＝课程表 14 讲）')
assert.equal(findOne(tree, 'data-cui-spines').props['data-cui-spines'], '14')
assert.deepEqual(spines.map((node) => node.props['data-cui-spine-state']),
  ['cur'].concat(Array.from({ length: 13 }, () => 'todo')),
  'doneCount=0 讲、currentLesson=1 → 第 1 根是当前，其余全未上')
assert.equal(spines.filter((node) => node.props['data-cui-spine-state'] === 'cur').length, 1, '当前书脊只能有一根')
assert.notEqual(spines[0].props.style.height, spines[1].props.style.height, '当前那根比未上的高（书脊语汇）')
assert.ok(String(spines[0].props.style.boxShadow).includes('var(--cui-gold)'), '当前书脊描金边')
assert.ok(String(spines[1].props.style.opacity) !== 'undefined' && spines[1].props.style.opacity < 1, '未上的书脊压暗')
assert.ok(String(spines[0].props.style.borderRadius).startsWith('2px 2px 0 0'), '书脊是"立着的"，上圆下平')
// 🔴 窄书脊＝**定宽**，不是 `flex:1`：`flex:1` 在 ~700px 的右栏里会把每根撑成 ~48×26 的
//    **柱状图**（本机截图实测过第一版就是这个样子）。这条断言把"窄"钉住。
assert.equal(spines[0].props.style.flex, '0 0 auto', '书脊必须是定宽（不许 flex:1 撑成柱状图）')
assert.equal(spines[0].props.style.width, '14px', '一根书脊宽 14px（"窄"的量化口径）')
assert.equal(S.spineStrip.height, '30px', '书架高 30px → 单根长宽比 ≈ 14:30，读得出是书脊')
assert.ok(String(S.spineStrip.borderBottom).includes('var(--cui-gold-rule)'), '书脊立在一条书架板上（发丝线）')
assert.ok(String(S.board.background).includes('var(--cui-board-fill)'), '讲台板面用纸面上的暖色底（不是宿主那层偏冷的交互填充）')
assert.ok(typeof S.varsFor('light')['--cui-board-fill'] === 'string' && S.varsFor('light')['--cui-board-fill'].length > 0)
// 错误告示也走書庫材质（暖橙调 ＋ 既读橙竖线），不是宿主那层偏冷的灰底卡
assert.ok(String(S.error.background).includes('var(--cui-alert-fill)'), '错误告示的底走暖橙调变量')
assert.ok(String(S.error.borderLeft).includes('var(--cui-read)'), '错误告示左边一条既读橙竖线')
assert.notEqual(S.error.background, S.vars['--cui-hover-fill'], '错误告示不再复用宿主的交互填充（那层偏冷）')
// 🔴 深色下书脊必须**比纸面亮**：第一版照抄浅色那三档，结果未上的书脊叠在深纸上几乎看不见
//    （本机实测截图 `shots/extra/dark-panel.png`）——那一排索引等于没了。
{
  const hexLum = (css) => {
    const hit = String(css).match(/#[0-9a-fA-F]{6}/)
    if (hit === null) return null
    const n = Number.parseInt(hit[0].slice(1), 16)
    return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
  }
  const darkPaper = hexLum(S.varsFor('dark')['--cui-paper'])
  assert.ok(darkPaper !== null, '深色纸面必须能用十六进制取到亮度（否则这条判据失效）')
  for (const name of ['--cui-spine', '--cui-spine-done', '--cui-spine-todo']) {
    const lum = hexLum(S.varsFor('dark')[name])
    assert.ok(lum !== null && lum > darkPaper, `深色下 ${name} 必须比纸面亮（否则索引在深纸上看不见）`)
  }
  assert.notEqual(S.varsFor('dark')['--cui-spine-todo'], S.varsFor('light')['--cui-spine-todo'],
    '深浅两套书脊配色必须各自给（不许一套通吃）')
}

// 10.4 章节索引：14 条，当前那条唯一，标题字面/字色分档（**不靠加粗**）
const items = findAll(tree, (node) => Object.prototype.hasOwnProperty.call(node.props, 'data-cui-item'))
assert.equal(items.length, 14, '章节索引必须 14 条')
const currentItems = items.filter((node) => node.props['data-cui-current'] === 'true')
assert.equal(currentItems.length, 1, '当前讲只能有一条')
assert.equal(currentItems[0].props['data-cui-item'], '1', '当前讲＝第 1 讲（来自机器可读行 current_lesson）')
assert.ok(textOf(currentItems[0]).includes('一个程序怎么跑起来'), '当前那条必须带讲题')
const core = findOne(tree, 'data-cui-core')
assert.equal(core.props['data-cui-core'], '1', '核心疑问只挂在当前讲上')
assert.ok(textOf(core).startsWith('核心疑问：'), '当前讲要带核心疑问')
assert.equal(findAll(tree, (node) => Object.prototype.hasOwnProperty.call(node.props, 'data-cui-core')).length, 1,
  '非当前讲不展开核心疑问（14 条都展开会把索引撑成正文）')
assert.ok(textOf(items[13]).includes('崩溃之后：日志与一致性'), '第 14 讲必须还在（14 讲一个都不能少）')
assert.ok(String(currentItems[0].props.style.borderBottom).includes('var(--cui-gold-rule)'), '当前那条底下走金褐发丝线')
const restItem = items[1]
assert.equal(String(restItem.props.style.borderBottom).includes('var(--cui-gold-rule)'), false, '非当前条走宿主发丝线')
assert.equal(findOne(currentItems[0], 'data-cui-item') !== null, true)
const mark = currentItems[0].kids.find((kid) => kid !== null && kid !== undefined && typeof kid === 'object' && kid.props !== undefined && kid.props.style === S.indexMark)
assert.ok(mark !== undefined, '当前讲前面那枚既读橙标必须在（C 書庫的语汇）')

// 10.5 层级手段：字号档／字距／字色阶梯／字面 —— **一处 fontWeight 都没有**
const allNodes = findAll(tree, () => true)
assert.ok(allNodes.length > 60, `渲染出的节点数应远多于几十（实际 ${allNodes.length}）`)
for (const node of allNodes) {
  assert.equal(Object.prototype.hasOwnProperty.call(node.props.style ?? {}, 'fontWeight'), false,
    `节点 <${String(node.tag)}> 不许用 fontWeight 表达层级`)
}
const currentTitle = currentItems[0].kids.find((kid) => typeof kid === 'object' && kid !== null && kid.props !== undefined && kid.props.style === S.indexTitle || (kid !== null && typeof kid === 'object' && kid.props !== undefined && kid.props.style !== undefined && kid.props.style.fontFamily === panel.SERIF))
assert.ok(currentTitle !== undefined, '当前讲题必须走衬线字面（書庫的章题）')
assert.equal(currentTitle.props.style.fontFamily, panel.SERIF, '章题字面＝衬线')
assert.ok(currentTitle.props.style.fontSize.includes('--dsw-font-xs-13-font-size'), '章题走官方 13px 档（不是靠加粗）')
assert.equal(S.sectionLabel.letterSpacing, '0.18em', '区块标签靠字距分级')
assert.equal(S.sectionLabel.color, S.ink[3], '区块标签用第 3 档字色')
assert.equal(S.fieldLabel.color, S.ink[4], '字段标签用最浅一档字色')
assert.equal(S.indexTitleRest.color, S.ink[2], '非当前讲题用第 2 档字色')
assert.equal(S.indexTitleCurrent.color, S.ink[1], '当前讲题用第 1 档字色（**靠色阶而不是加粗**）')
assert.notEqual(S.indexTitleCurrent.color, S.indexTitleRest.color, '当前/非当前必须是两个不同档位')

// 10.6 当前：讲次是这一屏的主标题（衬线＋最大档），老师/进度/环节/上次照旧在
const lessonLine = findOne(tree, 'data-cui-lesson')
assert.ok(lessonLine !== null, '「当前」必须有一行讲次主标题')
assert.ok(textOf(lessonLine).includes('第 01 讲 / 14'), '讲次号走等宽体（纯数字）')
assert.ok(textOf(lessonLine).includes('一个程序怎么跑起来'), '讲题在讲次号右边')
assert.equal(lessonLine.props.style.fontFamily, panel.SERIF, '讲次主标题走衬线（書庫的书名）')
assert.ok(lessonLine.props.style.fontSize.includes('--dsw-font-s-14-font-size'), '讲次主标题是面板里最大的一档字')
for (const [hook, expected] of [['teacher', EXPECTED_TEACHER], ['progress', '0 / 14 讲']]) {
  const field = findOne(tree, 'data-cui-field')
  const target = findAll(tree, (node) => node.props['data-cui-field'] === hook)[0]
  assert.ok(target !== undefined, `字段 ${hook} 必须画出来`)
  assert.ok(textOf(target).includes(expected), `字段 ${hook} 必须显示「${expected}」`)
  assert.equal(field !== null, true)
}
const phaseField = findAll(tree, (node) => node.props['data-cui-field'] === 'phase')[0]
assert.ok(textOf(phaseField).includes('未提供'), 'current_phase 行不存在 → 环节显示「未提供」（不猜）')

// 10.7 资源状态与重新读盘：四个来源逐条真伪 ＋ 一个药丸按钮
const sourceRows = findAll(tree, (node) => Object.prototype.hasOwnProperty.call(node.props, 'data-cui-source'))
assert.equal(sourceRows.length, loaded.sources.length, '来源行数＝真读盘的来源数')
assert.deepEqual(sourceRows.map((node) => node.props['data-cui-source-ok']),
  loaded.sources.map((source) => (source.ok ? 'true' : 'false')), '逐条如实标 ✓/✗')
assert.ok(textOf(sourceRows[0]).includes('classroom.yaml'), '来源行带真实路径')
const refresh = findOne(tree, 'data-cui-refresh')
assert.ok(refresh !== null, '「重新读盘」必须还在')
assert.equal(refresh.tag, 'button', '重新读盘是一个真按钮')
assert.equal(refresh.props.style.borderRadius, '999px', '按钮走药丸形（项目交付物样式口径）')

// 10.8 讲台（B 骨架的常驻黑板位）：板面 ＋ 顶端渐隐轨；未部署时**折起且只留一行**
const board = findOne(tree, 'data-cui-board-plate')
assert.ok(board !== null, '讲台必须是一块常驻板面（B 骨架）')
const rail = board.kids.find((kid) => kid !== null && typeof kid === 'object' && kid.props !== undefined && kid.props.style === S.boardRail)
assert.ok(rail !== undefined, '板面顶端那条金褐渐隐轨必须在（B 骨架的语汇）')
const boardBox = findOne(tree, 'data-cui-board')
assert.equal(boardBox.props['data-cui-board'], 'collapsed', '立绘装载失败 → 舞台折起（不再占 ~330px 空白纸）')
assert.equal(boardBox.props.style.height, 0, '折起＝高 0，但**元素仍在文档里**（否则永远发现不了未部署）')
assert.equal(findAll(boardBox, (node) => node.props['data-classroom-ui-portrait'] === 'canvas').length, 1,
  '画布必须仍挂在文档里（装载效果要拿到它，失败才报得出来）')

const failure = findOne(tree, 'data-cui-live2d-failure')
assert.ok(failure !== null, 'Live2D 未部署**必须显式报出来**（不静默）')
assert.equal(failure.props['data-classroom-ui-live2d'], 'failed')
assert.ok(textOf(failure).startsWith('立绘装载失败：'), '未部署那行仍带原始报错前缀')
assert.ok(textOf(failure).includes('live2dcubismcore.min.js'), '原始报错（缺哪个文件）一个字都不删')
assert.equal(failure.props.style, S.boardNotice, '未部署那行走"一行紧凑说明"的样式')
assert.notEqual(failure.props.style, S.error, '**不许**再用整块灰板（那正是"抢主视觉"的写法）')
assert.ok(String(failure.props.style.borderLeft).includes('var(--cui-gold)'), '紧凑说明左边一条金褐竖线')
assert.ok(String(failure.props.style.fontSize).includes('--dsw-font-xxxs-11-font-size'), '紧凑说明走最小一档字（11px）')

// 10.9 工程读数收进默认折起的「讲台诊断」：信息一条不删，但默认不占主视觉
const diag = findOne(tree, 'data-cui-diag')
assert.ok(diag !== null, '讲台诊断那一块必须存在')
assert.equal(diag.tag, 'details', '诊断必须装在 <details> 里')
assert.equal(Object.prototype.hasOwnProperty.call(diag.props, 'open'), false, '默认是折起的')
const summary = diag.kids.find((kid) => kid !== null && typeof kid === 'object' && kid.props !== undefined && kid.props.className === 'cui-sum')
assert.ok(summary !== undefined && textOf(summary) === '讲台诊断', '折起来的那一行叫「讲台诊断」')
assert.ok(textOf(diag).includes('clients/live2d-host/out'), '模型/资源那条读数仍在（只是默认折起）')

// 10.10 区块标签：三块都在，且课程表标题带真实讲数
const labels = findAll(tree, (node) => node.props.style === S.sectionLabel).map(textOf)
for (const expected of ['当前', '课程表 · 14 讲', '数据来源（真读盘）', '讲台']) {
  assert.ok(labels.includes(expected), `区块标签「${expected}」必须画出来`)
}
assert.equal(findAll(tree, (node) => node.props['data-classroom-ui-section'] === '1').length >= 4, true,
  '四个区块（头部/讲台/当前/课程表/来源）都要有分节')

// 10.11 进度一变，书脊状态跟着变（当前/已上/未上三种同时出现时也成立）
const progressed = Object.assign({}, loaded.data, { doneCount: '5 讲', currentLesson: 6, lessonTitle: '地址翻译：硬件怎么帮我们作弊' })
const tree2 = await renderPanel(progressed, loaded.sources)
const spines2 = findAll(tree2, (node) => Object.prototype.hasOwnProperty.call(node.props, 'data-cui-spine'))
assert.deepEqual(spines2.map((node) => node.props['data-cui-spine-state']),
  ['done', 'done', 'done', 'done', 'done', 'cur'].concat(Array.from({ length: 8 }, () => 'todo')),
  '已上 5 讲 + 当前第 6 讲 → 书脊状态逐根对上')
const items2 = findAll(tree2, (node) => Object.prototype.hasOwnProperty.call(node.props, 'data-cui-item'))
assert.equal(items2.filter((node) => node.props['data-cui-current'] === 'true')[0].props['data-cui-item'], '6',
  '换讲次后"当前"跟着走')
assert.ok(textOf(items2[5]).includes('地址翻译：硬件怎么帮我们作弊'), '第 6 讲的讲题必须画出来')
assert.equal(findAll(tree2, (node) => node.props['data-cui-live2d-failure']).length, 1, '换讲次不影响"未部署"的显式报告')
