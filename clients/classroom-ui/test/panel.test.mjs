/**
 * classroom-ui 的 node 侧测试：**驱动浏览器半边的真实代码**，不吃任何替身数据。
 *
 * 做法：把 `lib/client.js` 当成浏览器产物那样装一遍——伪造 `window.__ModuleLoader__`
 * 收下 `{id, factory}`，再给 factory 一个最小 `require`（只认 "react"），
 * 于是拿到与浏览器里**同一份** exports，用真实的教室文件喂它。
 *
 * 覆盖：① 产物格式与 id；② 四个解析函数对真文件的结果；③ `loadClassroom` 经
 * 「分页 read」通道读齐四个文件（分页循环也被真实驱动）；④ 单文件失败不拖垮整块。
 *
 * 跑法：/opt/homebrew/bin/node 开源线/DSH定制/code/clients/classroom-ui/test/panel.test.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 工作区根：classroom-ui/test → clients → code → DSH定制 → 开源线 → 工作区 */
const WORKSPACE = join(HERE, '..', '..', '..', '..', '..', '..')
const CLASSROOM = '开源线/DSH定制/code/classrooms/cs-os'

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
assert.equal(manifest.id, 'cs-os')
assert.equal(manifest.title, '计算机系教室 · 操作系统')
assert.equal(manifest.subject, '操作系统')
assert.equal(manifest.lessons, 14)
assert.deepEqual(manifest.phases.map((phase) => phase.id), ['open', 'probe', 'answer', 'check', 'review', 'close'])
assert.deepEqual(manifest.phases.map((phase) => phase.name), ['开场', '追问', '学生作答', '对答案', '复习', '收尾'])

const progress = panel.parseProgress(read('runtime/progress.md'))
assert.equal(progress.currentLesson, 1, 'current_lesson 机器可读行')
assert.equal(progress.currentPhase, null, 'progress.md 当前无 current_phase 行')
assert.equal(progress.teacher, '小鞠知花')
assert.equal(progress.progressText, '0 / 14 讲')
assert.equal(progress.humanLesson, '**第 0 讲（未开始）**')

const curriculum = panel.parseCurriculum(read('curriculum.md'))
assert.equal(curriculum.length, 14, '课程表必须解析出 14 讲')
assert.equal(curriculum[0].n, 1)
assert.equal(curriculum[0].title, '一个程序怎么跑起来')
assert.ok(curriculum[0].core !== null && curriculum[0].core.length > 0, '第 1 讲必须有核心疑问')
assert.equal(curriculum[13].n, 14)

const teacher = panel.parseTeacher(read('characters/komari.md'))
assert.equal(teacher.name, '小鞠知花')
assert.ok(teacher.scope !== null && teacher.scope.includes('14 讲'))

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

assert.deepEqual(loaded.sources.map((source) => source.ok), [true, true, true, true], '四个文件都应读成功')
assert.equal(loaded.data.classroomId, 'cs-os')
assert.equal(loaded.data.title, '计算机系教室 · 操作系统')
assert.equal(loaded.data.lessonsTotal, 14)
assert.equal(loaded.data.currentLesson, 1)
assert.equal(loaded.data.lessonTitle, '一个程序怎么跑起来', '当前讲次的标题由讲次号在课程表里定位')
assert.equal(loaded.data.currentPhase, null)
assert.equal(loaded.data.phaseName, null)
assert.equal(loaded.data.teacher, '小鞠知花')
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
assert.deepEqual(partial.sources.map((source) => source.ok), [false, true, true, true])
assert.equal(partial.data.title, null, 'manifest 缺失 → 标题如实为 null，不填默认值')
assert.equal(partial.data.currentLesson, 1, '其余文件仍照常解析')
assert.equal(partial.data.teacher, '小鞠知花', '老师取自 progress.md，不依赖 manifest')

console.log('✅ classroom-ui 测试通过')
console.log('   课程表讲数：', loaded.data.lessons.length)
console.log('   当前讲次：', loaded.data.currentLesson, '·', loaded.data.lessonTitle)
console.log('   当前环节：', loaded.data.currentPhase)
console.log('   当课老师：', loaded.data.teacher)
console.log('   进度：', loaded.data.progressText)
console.log('   数据来源：', loaded.sources.map((source) => `${source.ok ? '✓' : '✗'} ${source.path}`).join(' | '))
