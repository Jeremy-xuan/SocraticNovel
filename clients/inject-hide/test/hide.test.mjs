/**
 * inject-hide 的 node 侧测试：**驱动浏览器半边的真实产物**，不吃替身数据。
 *
 * 做法（与 classroom-ui 同款）：把 `lib/client.js` 当成浏览器产物装一遍——伪造
 * `window.__ModuleLoader__` 收下 `{id, factory}`，再给 factory 一个最小 `require`（只认 "react"），
 * 于是拿到与浏览器里**同一份** exports，用真实输入喂它。
 *
 * 覆盖：
 *   ① 产物格式与 id（boot 图行 id 必须等于包名）；
 *   ② `shouldHideSource` 的判据边界（引擎 kind / 宿主的四种 kind / 缺字段 / 非对象）；
 *   ③ `shadowTarget` 逐字复现 `entriesOfSlot`：**按组件身份排除自己**（不按优先级值）、
 *      **跳过已退位条目**、按优先级升序取最低者；
 *   ④ `createView` 四条分支：藏 / 原样委派（props 必须是同一个对象）/ 跳过已退位目标 /
 *      无委派对象时抛错；
 *   ⑤ `apply` 真的按契约注册（座名、键、优先级、locale）＋ 退位台账真的接在 `onEntryError` 上；
 *   ⑥ 空行样式：只引数据属性、幂等、**随 effect 卸载摘除**（多实例共享时最后一个才摘）；
 *   ⑦ 安装版契约检查：直接读 `dsh-client-ui-chat` 的**已安装产物**，确认 `context` 那一条
 *      **没有声明 priority**（＝0）——它一旦改成 ≤ -1，本插件的遮蔽就会失效，这条就是那个告警。
 *      **缺宿主源码时记为「不适用」**，纯单测照跑，不整套失败。
 *
 * 跑法：node clients/inject-hide/test/hide.test.mjs（＝ npm test）
 *   宿主安装根可用环境变量覆盖（默认 macOS 桌面版路径）：
 *     DSH_INSTALLED_ROOT=<…/node_modules/@deepseek-ai>
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 安装版 `@deepseek-ai/*` 的真实位置（app 内 node_modules）；可用环境变量覆盖。 */
const INSTALLED_ROOT =
  process.env.DSH_INSTALLED_ROOT ??
  '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai'

let passed = 0
const cases = []
const skipped = []
/** 跑一条用例：失败立刻抛，成功计数并记账。 */
function test(name, fn) {
  try {
    fn()
    passed += 1
    cases.push(`  ✓ ${name}`)
  } catch (error) {
    cases.push(`  ✗ ${name}`)
    console.log(cases.join('\n'))
    throw error
  }
}

// ── 1 · 以浏览器的方式装载产物 ──────────────────────────────────────────────
let registration
globalThis.window = {
  __ModuleLoader__: {
    load: (value) => {
      registration = value
    },
  },
}

/** 记录 `React.createElement` 的每次调用，用来观察委派是否发生、传了什么。 */
const created = []
const FAKE_REACT = {
  createElement: (type, props) => {
    created.push({ type, props })
    return { type, props }
  },
}

const BUNDLE = join(HERE, '..', 'lib', 'client.js')
// 产物是经典脚本（非 ESM），用 Function 求值等价于浏览器 <script> 执行。
// eslint-disable-next-line no-new-func
new Function(readFileSync(BUNDLE, 'utf8'))()

const mod = registration.factory((specifier) => {
  if (specifier === 'react') return FAKE_REACT
  throw new Error(`未预期的 require("${specifier}")`)
})

test('产物 id 必须等于包名（boot 图行 id）', () => {
  assert.equal(registration.id, 'inject-hide')
})

test('exports.inject 只要 slots 一个服务', () => {
  assert.deepEqual(mod.inject, ['slots'])
  assert.ok(typeof mod.apply === 'function')
})

// ── 2 · shouldHideSource 的边界 ─────────────────────────────────────────────
test('引擎注入（socratic-engine）判为要藏', () => {
  assert.equal(mod.shouldHideSource({ kind: 'socratic-engine' }), true)
  // 引擎的 source 还带 form / block 等跨端契约字段，多字段不影响判定
  assert.equal(
    mod.shouldHideSource({ kind: 'socratic-engine', form: 'classroom-block', block: 'state' }),
    true,
  )
})

test('宿主的四种已知 kind 一律不藏', () => {
  for (const source of [
    { kind: 'agent-instructions', changes: [{ path: 'AGENTS.md' }] },
    { kind: 'plugin', plugin: 'compact' },
    { kind: 'skill-invocation', name: 'socratic-classroom' },
    { kind: 'session-reference', references: [{ label: 'x' }] },
  ]) {
    assert.equal(mod.shouldHideSource(source), false, JSON.stringify(source))
  }
})

test('缺字段/非对象一律不藏（判据是白名单，不是"非 user 就藏"）', () => {
  for (const source of [undefined, null, 'socratic-engine', 42, {}, { kind: undefined }]) {
    assert.equal(mod.shouldHideSource(source), false, String(source))
  }
})

// ── 3 · shadowTarget 复现 entriesOfSlot 的选举 ──────────────────────────────
/** 造一条座位台账条目（只带本插件会读的字段）。 */
const entry = (key, priority, tag) => ({
  component: { displayName: tag },
  options: priority === undefined ? { key } : { key, priority },
})
/** 本插件自己的组件替身：台账里按**身份**认它。 */
const SELF = { displayName: 'ours' }
/** 造一条"本插件自己"的台账条目（优先级＝插件声明的 -1）。 */
const ownEntry = () => ({ component: SELF, options: { key: 'context', priority: -1 } })
/** 空台账：没有任何已知退位条目。 */
const NO_RETIRED = new WeakSet()

test('除自己外没有别的条目 → undefined（无委派对象）', () => {
  assert.equal(mod.shadowTarget([ownEntry()], SELF, NO_RETIRED), undefined)
})

test('只有一个 shipped（未声明 priority＝0）→ 选它', () => {
  const shipped = entry('context', undefined, 'shipped')
  assert.equal(mod.shadowTarget([shipped, ownEntry()], SELF, NO_RETIRED), shipped)
})

test('按组件身份排除自己：同优先级的第三方条目不被误排除', () => {
  const peer = entry('context', -1, 'peer')
  const shipped = entry('context', undefined, 'shipped')
  // peer 与本插件同在 -1，但它**不是**本插件，本该是可以委派的对象（且优先级低于 shipped）。
  assert.equal(mod.shadowTarget([shipped, ownEntry(), peer], SELF, NO_RETIRED), peer)
})

test('优先级升序取最低者，且排除自己', () => {
  const a = entry('context', 5, 'a')
  const b = entry('context', 0, 'b')
  assert.equal(mod.shadowTarget([a, b, ownEntry()], SELF, NO_RETIRED), b)
})

test('比本插件优先级更低的台账条目必然已退位 → 跳过', () => {
  const b = entry('context', 0, 'b')
  const lower = entry('context', -2, 'lower')
  // 本插件正被渲染 ⇒ 本插件就是胜者 ⇒ -2 那条若还活着，胜者就是它。故它必然已退位。
  assert.equal(mod.shadowTarget([b, ownEntry(), lower], SELF, NO_RETIRED), b)
})

test('已知退位条目（onEntryError 台账）→ 跳过', () => {
  const a = entry('context', 5, 'a')
  const b = entry('context', 0, 'b')
  const retired = new WeakSet([b])
  assert.equal(mod.shadowTarget([a, b, ownEntry()], SELF, retired), a)
})

test('别的键（如 user / assistant-step）不参与', () => {
  const shipped = entry('context', undefined, 'shipped')
  assert.equal(mod.shadowTarget([entry('user', -9, 'user'), shipped], SELF, NO_RETIRED), shipped)
})

// ── 4 · createView 四条分支 ────────────────────────────────────────────────
/** 造一个台账可变的假 ctx（`entries` 每次读当前数组内容）。 */
const ctxWith = (ledger) => ({ slots: { entries: () => ledger } })
const propsOf = (source) => ({ node: { kind: 'context', data: { source } }, t: () => '' })
/** 装一个 view，并把"本插件自己"那条登记进台账（身份＝view 函数本身）。 */
function mountedView(ledger, retired = NO_RETIRED) {
  const view = mod.createView(ctxWith(ledger), retired)
  ledger.push({ component: view, options: { key: 'context', priority: -1 } })
  return view
}

test('引擎来源 → 渲染 null（不产生任何 DOM）', () => {
  created.length = 0
  const view = mountedView([entry('context', undefined, 'shipped')])
  assert.equal(view(propsOf({ kind: 'socratic-engine', form: 'classroom-block' })), null)
  assert.equal(created.length, 0, '藏起来的那条不许碰 React.createElement')
})

test('别的来源 → 原样委派给 shipped，props 是同一个对象', () => {
  created.length = 0
  const shipped = entry('context', undefined, 'shipped')
  const view = mountedView([shipped])
  const props = propsOf({ kind: 'agent-instructions', changes: [{ path: 'AGENTS.md' }] })
  view(props)
  assert.equal(created.length, 1)
  assert.equal(created[0].type, shipped.component, '必须委派给 shipped 组件本体')
  assert.equal(created[0].props, props, 'props 必须原样转交（同一个对象）')
})

test('委派目标已退位 → 交给下一个存活条目', () => {
  created.length = 0
  const shipped = entry('context', undefined, 'shipped')
  const next = entry('context', 1, 'next')
  const view = mountedView([shipped, next], new WeakSet([shipped]))
  view(propsOf({ kind: 'plugin', plugin: 'compact' }))
  assert.equal(created.length, 1)
  assert.equal(created[0].type, next.component, '已退位的 shipped 不许被委派')
})

test('该格里只剩自己 → 抛错退位（不静默藏掉宿主自己的上下文行）', () => {
  const view = mountedView([])
  assert.throws(
    () => view(propsOf({ kind: 'agent-instructions' })),
    /没有别的渲染器/,
  )
})

// ── 5 · apply 真的按契约注册 ＋ 退位台账 ────────────────────────────────────
/** 装一个够 `apply` 用的假 ctx：effect 记名并收下释放器，slots 记账并暴露可变台账与退位通知。 */
function fakeCtx(ledger) {
  const effectNames = []
  const effects = new Map()
  const injected = []
  const registered = []
  const errorHandlers = []
  return {
    effectNames,
    effects,
    injected,
    registered,
    errorHandlers,
    ctx: {
      effect: (fn, name) => {
        effectNames.push(name)
        const dispose = fn()
        effects.set(name, typeof dispose === 'function' ? dispose : () => {})
        return () => effects.get(name)()
      },
      slots: {
        inject: (key, callback) => {
          injected.push(key)
          return callback()
        },
        register: (options, component) => {
          registered.push({ options, component })
          return () => {}
        },
        entries: () => ledger,
        onEntryError: (fn) => {
          errorHandlers.push(fn)
          return () => {}
        },
      },
    },
  }
}

test('apply 按契约注册：三条 effect ＋ 座名/键/优先级/locale', () => {
  const applied = fakeCtx([])
  const { doc, styles } = fakeDocument()
  globalThis.document = doc
  try {
    mod.apply(applied.ctx)
    assert.deepEqual(applied.effectNames, [
      'inject-hide: 空行样式',
      'inject-hide: 退位台账',
      'inject-hide: 隐藏引擎注入行',
    ])
    assert.deepEqual(applied.injected, ['conversation.chat.node'])
    assert.equal(applied.registered.length, 1)
    assert.deepEqual(applied.registered[0].options, {
      name: 'conversation.chat.node',
      key: 'context',
      priority: -1,
      locale: 'chat',
    })
    assert.equal(typeof applied.registered[0].component, 'function')
    assert.equal(styles.length, 1, 'apply 必须补上那条空行样式')
  } finally {
    delete globalThis.document
    applied.effects.get('inject-hide: 空行样式')()
  }
})

test('apply 的退位台账：只收本座的 abdicated 报告，并让委派跳过它', () => {
  const shipped = entry('context', undefined, 'shipped')
  const next = entry('context', 1, 'next')
  const ledger = [shipped, next]
  const applied = fakeCtx(ledger)
  const { doc } = fakeDocument()
  globalThis.document = doc
  try {
    mod.apply(applied.ctx)
    assert.equal(applied.errorHandlers.length, 1, '退位台账必须订阅 onEntryError')
    const view = applied.registered[0].component
    ledger.push({ component: view, options: { key: 'context', priority: -1 } })
    const report = applied.errorHandlers[0]
    report('conversation.chat.other', shipped, new Error('x'), true)
    report(mod.SLOT, shipped, new Error('x'), false)
    created.length = 0
    view(propsOf({ kind: 'plugin', plugin: 'compact' }))
    assert.equal(created[0].type, shipped.component, '别的座 / 非 abdicated 的报告都不许影响委派')
    report(mod.SLOT, shipped, new Error('boom'), true)
    created.length = 0
    view(propsOf({ kind: 'plugin', plugin: 'compact' }))
    assert.equal(created[0].type, next.component, '记进台账的条目必须被跳过')
  } finally {
    delete globalThis.document
    applied.effects.get('inject-hide: 空行样式')()
  }
})

// ── 6 · 空行样式：只引数据属性 ＋ 幂等 ＋ 卸载摘除 ──────────────────────────
/** 最小 document 替身：够 `installEmptyRowCss` 用（querySelector + createElement + head.appendChild）。 */
function fakeDocument() {
  const styles = []
  const doc = {
    head: {
      appendChild: (node) => {
        styles.push(node)
      },
    },
    querySelector: (selector) => {
      const m = selector.match(/^style\[data-plugin-css="(.+)"\]$/)
      if (m === null) throw new Error(`假 document 不认这个选择器：${selector}`)
      return styles.find((s) => s.dataset.pluginCss === m[1]) ?? null
    },
    createElement: (tag) => {
      const node = {
        tag,
        dataset: {},
        textContent: '',
        remove: () => {
          const at = styles.indexOf(node)
          if (at >= 0) styles.splice(at, 1)
        },
      }
      return node
    },
  }
  return { doc, styles }
}

test('空行样式只引宿主的数据属性，不引带构建哈希的类名', () => {
  assert.ok(mod.EMPTY_ROW_CSS.includes('[data-chat-flow-kind]'))
  assert.ok(mod.EMPTY_ROW_CSS.includes('[data-slot="conversation.chat.node"]'))
  assert.ok(!/\.EvIC1a|_[a-z0-9]{6}_/.test(mod.EMPTY_ROW_CSS), `不许引哈希类名：${mod.EMPTY_ROW_CSS}`)
  assert.ok(mod.EMPTY_ROW_CSS.includes(':empty'), '判据必须是"槽位外壳为空"')
})

test('空行样式幂等：插两次只留一个 <style>', () => {
  const { doc, styles } = fakeDocument()
  const first = mod.installEmptyRowCss(doc)
  const second = mod.installEmptyRowCss(doc)
  assert.equal(styles.length, 1)
  assert.equal(first, second)
  assert.equal(first.dataset.plugin, 'inject-hide')
  assert.equal(first.dataset.pluginCss, mod.STYLE_TAG_ID)
  assert.equal(first.textContent, mod.EMPTY_ROW_CSS)
})

test('空行样式随卸载摘除；多实例共享时最后一个释放才摘', () => {
  const { doc, styles } = fakeDocument()
  const releaseA = mod.acquireEmptyRowCss(doc)
  const releaseB = mod.acquireEmptyRowCss(doc)
  assert.equal(styles.length, 1, '两个持有者共用一个 <style>')
  releaseA()
  assert.equal(styles.length, 1, '还有持有者，不许摘')
  releaseA()
  assert.equal(styles.length, 1, '释放器必须幂等')
  releaseB()
  assert.equal(styles.length, 0, '最后一个持有者释放后摘除')
})

// ── 7 · 安装版契约检查（缺宿主源码时明确不适用）────────────────────────────
const CHAT_SOURCE = join(INSTALLED_ROOT, 'dsh-client-ui-chat/lib/client.js')

if (existsSync(CHAT_SOURCE)) {
  test('安装版 shipped 的 context 条目仍未声明 priority（本插件遮蔽成立的前提）', () => {
    const source = readFileSync(CHAT_SOURCE, 'utf8')
    // 取 `key: "context"` 那一次注册的 options 字面量（到最近的 `},` 结束）。
    const at = source.indexOf('key: "context",\n\t\t\t\tlocale:')
    assert.ok(at > 0, '在安装版里找不到 key: "context" 的注册处（宿主实现已变，本插件需重新取证）')
    const block = source.slice(at, source.indexOf('}', at) + 1)
    assert.ok(!/\bpriority\b/.test(block), `shipped 的 context 条目开始声明 priority：${block}`)
  })
} else {
  skipped.push(
    `  ⊘ N/A 安装版契约检查：未找到宿主源码 ${CHAT_SOURCE}\n` +
      `        （装了 DSH Desktop 走默认路径；否则设 DSH_INSTALLED_ROOT=<…/node_modules/@deepseek-ai> 启用）`,
  )
}

console.log(cases.join('\n'))
if (skipped.length > 0) console.log(skipped.join('\n'))
console.log(
  `\n[inject-hide] ${passed}/${cases.length} 绿${skipped.length > 0 ? `，${skipped.length} 项不适用` : ''}`,
)
