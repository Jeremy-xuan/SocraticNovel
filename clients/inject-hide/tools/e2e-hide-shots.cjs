/**
 * e2e-hide-shots.cjs —— HIDE-INJECT 的端到端取证（真实会话 · A/B 两相 · 同一份会话）
 *
 * 跑的是**真实会话**（真实模型、真实工具、真实消息流、真实 `socratic-dev` profile 起的 UI，
 * 但 `DSH_HOME` 是 `/tmp` 的克隆、教室是 `/tmp` 的副本）。
 *
 * 两个 phase 的差别**只有一个**：profile 里装没装 `inject-hide`。
 * 两相读的是**同一份会话**（`without` 相不新发消息、不跑模型，只重开那一页），
 * 于是"看得见 / 看不见"不能归因给模型这次怎么答、也不能归因给环境差异。
 *
 *   --phase with     : 新建会话 → 发一条消息 → 等整轮跑完 → 读数 ＋ 截图
 *   --phase without  : 打开**同一份会话** → 读数 ＋ 截图
 *
 * 读数一律走 DOM 事实，不靠目视（目视只用来做"给人看"的图）：
 *   · `[data-chat-flow-kind="context"]` 的**条数**＝宿主为注入行建了几个 flowItem
 *     → 条数 > 0 证明"引擎确实注入了"；
 *   · 其中 `innerText` 非空 / 高度 > 0 的条数 → 证明"到底显不显示"；
 *   · `[data-chat-flow-kind="assistant-step"]` / `[data-chat-call-id]` / `"user"` 的条数
 *     → 证明"正常对话与工具调用没被一起藏掉"。
 *
 * 用法（项目根执行，playwright 装在项目根）：
 *   HIDE_URL="http://127.0.0.1:4398/?token=..." \
 *     /opt/homebrew/bin/node 开源线/DSH定制/code/clients/inject-hide/tools/e2e-hide-shots.cjs --phase with
 *
 * 🔴 本脚本**只关掉无关项**：唯一注入项是把"是否装了插件"这个事实读出来做交叉核对，
 *    不覆盖任何被测样式、不动任何被观察的 DOM。
 */
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')

/** 工作区根：本文件 → tools → inject-hide → clients → code → DSH定制 → 开源线 → 工作区 */
const WORKSPACE = path.join(__dirname, '..', '..', '..', '..', '..', '..')
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(path.join(WORKSPACE, 'node_modules', 'playwright'))

const OUT = path.join(WORKSPACE, '开源线/DSH定制/code/clients/inject-hide/evidence')
const PHASE = process.argv.includes('--phase') ? process.argv[process.argv.indexOf('--phase') + 1] : 'with'
const URL_ = process.env.HIDE_URL

/** 这一轮的提示词：既让引擎注入（每轮都注入），又逼出一次**工具调用**（证明工具行没被藏）。 */
const PROMPT = [
  '先调用 classroom_status 查一下当前讲次与相位，然后用两三句话告诉我这一讲要做什么。',
  '',
  '🔴 不要调用别的工具，不要改任何文件。',
].join('\n')

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

/** 读数：注入行与"别的行"的 DOM 事实（纯读，不写 DOM）。 */
function probeHide() {
  const all = [...document.querySelectorAll('[data-chat-flow-kind]')]
  const byKind = {}
  for (const node of all) {
    const kind = node.getAttribute('data-chat-flow-kind')
    byKind[kind] = (byKind[kind] || 0) + 1
  }
  const contexts = all.filter((n) => n.getAttribute('data-chat-flow-kind') === 'context')
  const visible = (n) => n.getBoundingClientRect().height > 0
  const nonEmpty = contexts.filter((n) => n.innerText.trim() !== '')
  const toolRows = [...document.querySelectorAll('[data-chat-call-id]')]
  const text = document.body.innerText
  // 消息流的滚动高度：A/B 两相若"隐藏"真的不占位，这个数只该差"那些行本身的高度"。
  const scroller = [...document.querySelectorAll('*')].find(
    (n) => n.scrollHeight > n.clientHeight + 40 && n.clientHeight > 300,
  )
  const column = document.querySelector('.EvIC1a_column')
  const box = (n) => {
    const s = getComputedStyle(n)
    return {
      height: Math.round(n.getBoundingClientRect().height),
      top: Math.round(n.getBoundingClientRect().top),
      marginTop: s.marginTop,
      display: s.display,
      cssEmpty: n.matches(':empty'),
    }
  }
  return {
    flowKindHistogram: byKind,
    contextSlots: contexts.length,
    contextSlotsNonEmpty: nonEmpty.length,
    contextSlotsVisible: contexts.filter(visible).length,
    contextSlotHeights: contexts.map((n) => Math.round(n.getBoundingClientRect().height)),
    // 🔴 残留读数的三条：隐藏槽自己多高、还占不占外边距、是否被 CSS 判成 `:empty`
    hiddenContextBoxes: contexts.filter((n) => !visible(n)).map(box),
    // 只有**还参与布局**的隐藏槽才算残留（`display:none` 的元素 getComputedStyle 仍会报出
    // marginTop，但它已经不在布局里了——按 display 判，别按计算值判）。
    hiddenContextMarginTotal: contexts
      .filter((n) => !visible(n) && getComputedStyle(n).display !== 'none')
      .reduce((sum, n) => sum + (parseFloat(getComputedStyle(n).marginTop) || 0), 0),
    columnHeight: column === null ? null : Math.round(column.getBoundingClientRect().height),
    columnFlowItems: column === null ? null : column.querySelectorAll(':scope > [data-chat-flow-kind]').length,
    contextSlotChildCounts: contexts.map((n) => n.childElementCount),
    contextRowTexts: nonEmpty.map((n) => n.innerText.replace(/\s+/g, ' ').slice(0, 160)),
    bodyHasContextInjectionTitle: /上下文注入|Context injection/.test(text),
    bodyHasEngineSourceLabel: /socratic-engine/.test(text),
    assistantStepRows: byKind['assistant-step'] || 0,
    userRows: byKind['user'] || 0,
    toolRowCount: toolRows.length,
    toolRowTexts: toolRows.map((n) => n.innerText.replace(/\s+/g, ' ').slice(0, 120)),
    messageScrollHeight: scroller === undefined ? null : scroller.scrollHeight,
    bodyTextLen: text.length,
    bodyTextHead: text.replace(/\s+/g, ' ').slice(0, 400),
    composerPresent: document.querySelector('[contenteditable="true"]') !== null,
    leftSidebarPresent: document.querySelector('div[role="treeitem"]') !== null,
  }
}

/** 新建会话（保证它是「大学申请」工作区里的）。 */
async function newSession(page) {
  const wsRow = page.locator('div[role="treeitem"]').filter({ hasText: '大学申请' }).first()
  await wsRow.hover()
  await page.waitForTimeout(800)
  const wsNew = page.locator('button[aria-label^="New session in 大学申请"]')
  if ((await wsNew.count()) > 0) await wsNew.first().click()
  else await page.locator('button[aria-label="New session"]').first().click()
  await page.waitForTimeout(3500)
}

/** 用来在左栏树里认领本轮那个会话的串（会话标题取自提示词首行，实测含它）。 */
const SESSION_MARK = process.env.HIDE_SESSION_MARK ?? 'classroom_status'

/**
 * 打开「大学申请」工作区下**本轮那个**会话。
 *
 * 🔴 两条都踩过：
 *   ① 只按"工作区行之后的第一个 treeitem"找 → 实测那个位置可能是应用自己的
 *      `New Session` 空占位行（本轮第一遍就点进了空会话，读到的 DOM 全是 0）；
 *   ② 只按标题找 → 标题是应用自己生成的摘要，**不保证**与提示词里的词重合（MERMAID-2 记过这个坑）。
 * 所以：**先按标记串找，找不到再退回"工作区行之后第一个非 New Session 的行"**，两条都记进证据。
 * @returns 左栏树的前若干行文本，供证据核对"到底点开了哪一行"
 */
async function openSession(page) {
  const wsRow = page.locator('div[role="treeitem"]').filter({ hasText: '大学申请' }).first()
  await wsRow.hover()
  await page.waitForTimeout(1200)
  const items = page.locator('div[role="treeitem"]')
  const texts = await items.allInnerTexts()
  const wsIndex = texts.findIndex((t) => t.includes('大学申请'))
  const marked = texts.findIndex((t, i) => i !== wsIndex && t.includes(SESSION_MARK))
  let index = marked
  let how = '按标记串找'
  if (index < 0) {
    index = texts.findIndex((t, i) => i > wsIndex && !/New Session/i.test(t))
    how = '退回：工作区行之后第一个非 New Session 行'
  }
  if (index < 0) throw new Error(`左栏树里找不到本轮的会话行：${JSON.stringify(texts.slice(0, 12))}`)
  await items.nth(index).click()
  await page.waitForTimeout(3000)
  // 等到消息流真的挂上来（否则读数会读到空会话）
  try {
    await page.waitForFunction(() => document.querySelectorAll('[data-chat-flow-kind]').length > 0, null, {
      timeout: 30000,
    })
  } catch (error) {
    throw new Error(`点开第 ${index} 行后消息流一直没出现（选行方式：${how}）：${String(error).slice(0, 160)}`)
  }
  await page.waitForTimeout(3000)
  return { how, index, treeItems: texts.slice(0, 12) }
}

/**
 * 发消息（composer 是 Lexical：必须 insertText 一次性插入，不能逐字 type）。
 * 发送判据＝composer 被清空（"发送按钮可用"不能当回合结束/发出成功的判据）。
 * @returns 第几次点击才生效
 */
async function send(page, text) {
  const composer = page.locator('[contenteditable="true"]').first()
  await composer.click()
  await composer.evaluate((node, value) => {
    node.focus()
    document.execCommand('insertText', false, value)
  }, text)
  await page.waitForTimeout(1500)
  const cleared = () =>
    page.evaluate(() => {
      const node = document.querySelector('[contenteditable="true"]')
      return node !== null && node.innerText.trim() === ''
    })
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await page.waitForFunction(
      () => {
        const btn = [...document.querySelectorAll('button')].find(
          (b) => b.getAttribute('aria-label') === 'Send message',
        )
        return btn !== undefined && btn.disabled === false
      },
      null,
      { timeout: 30000 },
    )
    await page.locator('button[aria-label="Send message"]').first().click()
    await page.waitForTimeout(2500)
    if (await cleared()) return attempt
  }
  await page.screenshot({ path: path.join(OUT, PHASE + '-99-send-failure.png') })
  throw new Error('点了 4 次发送，composer 始终没清空 → 消息没发出去')
}

;(async () => {
  if (URL_ === undefined || URL_ === '') throw new Error('需要 HIDE_URL（含 token 的 dsh web 地址）')
  fs.mkdirSync(OUT, { recursive: true })
  const out = { phase: PHASE, url: URL_, steps: [], files: {}, consoleErrors: [] }

  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1900, height: 1200 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  page.on('pageerror', (e) => out.consoleErrors.push('[pageerror] ' + String(e).slice(0, 300)))
  page.on('console', (m) => {
    if (m.type() === 'error') out.consoleErrors.push('[console] ' + m.text().slice(0, 200))
  })

  await page.goto(URL_, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(10000)

  if (PHASE === 'with') {
    await newSession(page)
    out.steps.push('已在「大学申请」工作区新建会话')
    out.sendAttempts = await send(page, PROMPT)
    out.steps.push(`消息已发出（第 ${out.sendAttempts} 次点击生效）`)

    // 等整轮跑完。主判据＝**`turn-tail` 节点出现**（宿主在 `turn/end` 时才发布它，
    // 与"停止生成按钮""发送按钮"那类判据不同，它真的等价于"这一轮结束了"）。
    try {
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[data-chat-flow-kind="turn-tail"]').length > 0 &&
          document.querySelectorAll('[data-chat-call-id]').length >= 1,
        null,
        { timeout: 300000 },
      )
      out.turnEnded = true
    } catch (error) {
      out.turnEnded = false
      out.turnEndWaitError = String(error).slice(0, 200)
    }
    out.turnSignals = await page.evaluate(async () => {
      const hasStop = () =>
        [...document.querySelectorAll('button')].some((b) => /stop/i.test(b.getAttribute('aria-label') || ''))
      const first = document.body.innerText
      await new Promise((r) => setTimeout(r, 6000))
      return { stopButtonPresent: hasStop(), textStable6s: document.body.innerText === first }
    })
    out.steps.push(`整轮结束判据 turn-tail：${out.turnEnded}；辅助信号：${JSON.stringify(out.turnSignals)}`)
    await page.waitForTimeout(2500)
  } else {
    out.sessionPick = await openSession(page)
    out.steps.push(`已打开本轮会话（选行方式：${out.sessionPick.how}，第 ${out.sessionPick.index} 行）`)
    await page.waitForTimeout(2000)
  }

  out.sessionUrl = page.url()
  out.probes = await page.evaluate(probeHide)

  const shot = async (name, clip) => {
    const file = path.join(OUT, `${PHASE}-${name}.png`)
    await page.screenshot(clip === undefined ? { path: file } : { path: file, clip })
    out.files[name] = file
    return file
  }
  await shot('00-full-window')

  // 消息流那一列（把左栏与右栏切掉），给人看"这一段里有没有注入行"
  const column = await page.evaluate(() => {
    const node = document.querySelector('[data-chat-flow-kind]')
    if (node === null) return null
    const r = node.getBoundingClientRect()
    return { x: Math.max(0, r.x - 60), y: Math.max(0, r.y - 120), width: Math.min(1400, r.width + 120), height: 900 }
  })
  if (column !== null) await shot('10-message-column', column)

  // 往上看历史：把消息流滚到顶再拍一张（长会话里注入行不止一条）
  await page.evaluate(() => {
    const scroller = [...document.querySelectorAll('*')].find(
      (n) => n.scrollHeight > n.clientHeight + 40 && n.clientHeight > 300,
    )
    if (scroller !== undefined) scroller.scrollTop = 0
  })
  await page.waitForTimeout(1200)
  await shot('20-scrolled-top')

  const json = path.join(OUT, `${PHASE}-probe.json`)
  fs.writeFileSync(json, JSON.stringify(out, null, 2))
  out.files.json = json
  out.jsonSha = sha(fs.readFileSync(json))

  await browser.close()

  // ── 判定（写在 stdout，人读；判据本身也在 JSON 里）──────────────────────
  const p = out.probes
  const verdict = {
    '引擎确实注入了（context flowItem 条数 > 0）': p.contextSlots > 0,
    '注入行不可见（非空 context 条数 === 0）': p.contextSlotsNonEmpty === 0,
    '页面上没有注入行标题（上下文注入 / Context injection）': p.bodyHasContextInjectionTitle === false,
    '页面上没有 socratic-engine 这个来源标签': p.bodyHasEngineSourceLabel === false,
    '正常对话还在（assistant-step > 0）': p.assistantStepRows > 0,
    '学生消息还在（user > 0）': p.userRows > 0,
    '工具调用还在（tool row > 0）': p.toolRowCount > 0,
    '控制台零报错': out.consoleErrors.length === 0,
  }
  console.log(JSON.stringify({ phase: PHASE, probes: p, consoleErrors: out.consoleErrors, verdict }, null, 2))
  console.log(`\n[${PHASE}] 证据 JSON：${json}`)
})().catch((error) => {
  console.error('E2E FAILED:', error)
  process.exit(1)
})
