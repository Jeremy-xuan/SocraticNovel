// lib/footprint.mjs — ACCEPT-4：把「零接触」的归因从**时间窗**改成**写足迹**
//
// 🔴 为什么改（ACCEPT-3 留下的一条**假红**，查清了但没敢单方面放宽）：
//   旧守卫的判据是"某键在阶段 03/04 内被采样到变化 → 归因给常驻桌面 App；否则算我们头上"。
//   但阶段 04 全程同步（幂等重放探针用 `spawnSync`、断言与证据落盘）→ **事件循环被整段占住**，
//   采样器一拍都跑不了 → 这一窗口对守卫而言是**黑的**；而阴性对照窗只有开头 3 秒，
//   量不到"隔几分钟自己重写一次"的文件。于是**黑窗口里的变化被默认归因给我们**
//   （实测：`profiles/web/desktop-storage.json` 字节数一字节没变、只是内容变了）。
//
// 🔴 新判据（**收紧**，不是放宽）：**先列出本流水线允许写的位置，再判"被改的东西在不在里面"**。
//   ① **写足迹白名单**：流水线**自己**的每一次写盘（以及它显式登记的"命令写入目标"）
//      都必须落在白名单内 —— 这一条**不依赖采样器能不能拍到**，所以**能抓住黑窗口里的写入**。
//      白名单为空、上下文没配置、扫描不到源文件 → 一律**判失败**（绝不静默通过）。
//   ② **写足迹归因**：受保护 profile 的变化，**只有当它出现在我们的写足迹里**才归因给我们。
//      写足迹已被 ① 证明全部落在白名单内，而白名单里唯一的 profile 是专用测试 profile
//      → 受保护 profile 的变化**不可能**是我们的写足迹造成的。
//   ③ **命令级检查（保留并扩展）**：旧版只扫 3 个日志文件里的 `--profile`；
//      新版扫**本流水线执行过的全部命令**（`run`/`runAsync` 统一记账），
//      出现受保护 profile 名或受保护 profile 目录下的路径 → 红。
//
// 🔴 这条守卫**证明什么、不证明什么**（写进结论，别让人误读）：
//   · 证明：**我们的写足迹干净** —— 我们的代码没有在白名单外写过一个字节；
//     且我们的命令里没有一条指向受保护 profile。
//   · 不证明：**用户 profile 没被动过**。别的进程（常驻桌面 App、别的会话）照样可能写它；
//     本守卫对那类变化**只报"不由我们造成"并附上判据**，不声称"什么都没发生"。
//     （旧守卫把这类变化默认算到我们头上 → 就是那条假红的来源。）
//
// 🔴 完整性：写足迹要可信，前提是"没有绕开 ledger 的写入"。所以本模块另做一件机器可核的事：
//   `scanUninstrumentedWrites()` —— 静态扫 `acceptance/**` 的源码，
//   除**写原语实现处**（本模块）与**在会话子进程里跑的探针**（写目标逐条登记）外，
//   任何文件出现直接写盘调用（`writeFileSync`/`cpSync`/`rmSync`/…）即判失败。
//   ⚠️ 诚实边界：这是**静态近似**——它保证"没有未登记的写调用形状"，
//   不能保证"运行期没有别的进程写盘"（后者见上一条"不证明"）。

import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

// ═════════════════════════════════════════════════════════════════════════════
// 0 · 路径规范化
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 规范化路径用于比较。
 * 🔴 macOS 上 `tmpdir()` 返回 `/var/folders/...`，而真实路径是 `/private/var/folders/...`
 *   → 不做 realpath 会让"临时目录里的写入"全部判成白名单外（假红）。
 *   故：能 realpath 就 realpath，不能（路径还不存在）就退回落 resolve 的**最长存在前缀**＋剩余段。
 */
export function canonPath(p) {
  const abs = resolve(p)
  let existing = abs
  const tail = []
  for (let i = 0; i < 40; i += 1) {
    if (existsSync(existing)) break
    tail.unshift(existing.slice(existing.lastIndexOf(sep) + 1))
    const parent = dirname(existing)
    if (parent === existing) break
    existing = parent
  }
  let base
  try {
    base = realpathSync(existing)
  } catch {
    base = existing
  }
  return tail.length === 0 ? base : join(base, ...tail)
}

/** 前缀判据（按路径段，不做字符串前缀——避免 `/a/bc` 命中 `/a/b`）。 */
export function isUnder(child, parent) {
  const c = canonPath(child)
  const p = canonPath(parent)
  if (c === p) return true
  return c.startsWith(p.endsWith(sep) ? p : `${p}${sep}`)
}

/**
 * **名字前缀**判据（字符串前缀）。
 * 🔴 为什么需要它：`mkdtemp` 的产物名是"前缀 + 随机串"（`accept-classroom-a1b2c3`），
 *   而前缀本身以 `-` 收尾 → 按**路径段**判会漏（`accept-classroom-a1b2c3/…` 并不以
 *   `accept-classroom-/` 开头）。这类"名字前缀"必须按字符串判。
 * 🔴 代价要说清：字符串前缀比路径段前缀**松**，所以只用在"目录名由我们自己拼出来、
 *   且前缀足够独特"的两个 tmp 目录上（`accept-classroom-`、`accept-idem-`）。
 */
export function isNameUnder(child, namePrefix) {
  const c = canonPath(child)
  const p = canonPath(namePrefix)
  return c === p || c.startsWith(p)
}

// ═════════════════════════════════════════════════════════════════════════════
// 1 · 写足迹白名单（每条都必须写明"为什么这个位置算我们的"）
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 白名单规则。
 * `target(ctx)` 返回**绝对路径**或**绝对路径数组**；`kind`：
 *   · `prefix`  —— 该路径**及其子孙**（目录，按路径段判）
 *   · `name-prefix` —— 路径**字符串**以它开头（用于 `mkdtemp` 的"前缀＋随机串"名字）
 *   · `file`    —— **恰好这一个文件**
 *   · `any-prefix` —— 数组里任一路径及其子孙（按路径段判）
 */
export const WRITE_WHITELIST = [
  {
    id: 'runs-root',
    label: '`runs/` 这个根目录**本身**（只此一层，不含别的运行目录）',
    kind: 'file',
    target: (ctx) => join(ctx.acceptanceDir, 'runs'),
    why:
      '`runs/` 可能还不存在（第一次跑），建它是一次写盘。**只允许建这个目录本身**：' +
      'kind=file 的判据是"路径完全相等"，所以写进 `runs/<别的运行目录>/…` **不**落在本规则里' +
      '（历史运行目录受 run-dir 规则保护，只能写本次那一个）。',
    source: 'accept.mjs 的 RUNS_DIR 常量',
  },
  {
    id: 'run-dir',
    label: '本次运行的证据归档目录 `runs/<时间戳>/**`',
    kind: 'prefix',
    target: (ctx) => ctx.runDir,
    why:
      '流水线的全部产物（预检快照／冻结清单与逐文件哈希／装载日志／会话原始日志与摘录／' +
      '六条断言的证据／结论）都写在**这一次运行自己的目录**里，一次运行一个目录、不覆盖历史。' +
      '这是 ACCEPT-1 起的固定形态，也是"跑完还能被人复核"的前提。',
    source: 'accept.mjs 阶段 0–5 的 outDir 全在 runDir 下；run.sh 的 runs/ 约定',
  },
  {
    id: 'latest-report',
    label: '人读的「最新一次」报告 `验收报告_最新.md`（只此一个文件）',
    kind: 'file',
    target: (ctx) => join(ctx.acceptanceDir, '验收报告_最新.md'),
    why:
      '约定的人读入口：它**只指向最近一次运行**、每次被整体重写，历史一律留在 runs/ 里。' +
      '除它之外，流水线不在 acceptance 根目录写任何东西（这一条由本白名单的粒度保证）。',
    source: 'accept.mjs 阶段 ⑤ 的 renderLatestReport 落盘处',
  },
  {
    id: 'degrade-ledger',
    label: '跨运行的显式降级留痕 `降级留痕.md`（只此一个文件）',
    kind: 'file',
    target: (ctx) => join(ctx.acceptanceDir, '降级留痕.md'),
    why:
      'ACCEPT-4 新增：`--disable-classroom-animation` 是**显式降级**，除本次运行目录里留痕外，' +
      '另在固定位置追加一行（时间／理由／删了哪几行／删前后哈希／run 目录），' +
      '让"过去一周我们悄悄关过几次动画"能一眼检索到。一次运行最多追加一行。',
    source: 'lib/degrade.mjs（ACCEPT-4 新增）',
  },
  {
    id: 'accept-profile',
    label: '本流水线的**专用**测试 profile `profiles/socratic-accept/**`',
    kind: 'prefix',
    target: (ctx) => join(ctx.dshHome, 'profiles', ctx.acceptProfile),
    why:
      '这是**我们自己的**测试 profile：每次从 shipped 的 headless 模板**重建**，' +
      '只装冻结的那一份插件；名字由 run.sh 硬性拒绝（`web`／`desktop`／`desktop-safe-mode` 直接退 2）。' +
      '它既是装载阶段的产物，也是会话真正跑起来的载体 —— 不写它就没有验收。',
    source: 'lib/profile.mjs 的 ensureProfile/installFrozenPlugin；run.sh 的 ACCEPT_PROFILE 自检',
  },
  {
    id: 'tmp-classroom',
    label: '会话的教室**工作副本** `$TMPDIR/accept-classroom-*/**`',
    kind: 'name-prefix',
    target: (ctx) => join(ctx.tmpDir, 'accept-classroom-'),
    why:
      '会话的 cwd **必须**是教室目录（教室自带的 AGENTS.md 靠 cwd 这条链加载 —— 生产口径），' +
      '而 cwd 一旦落在 `runs/<ts>/…`，被测模型就会顺着相对路径爬出去把验收脚手架读了' +
      '（实测 turn 3 花 15 步去 grep `accept.mjs`）。故工作副本放系统临时目录：' +
      '教室照常加载，验收脚手架在相对路径不可达处；跑完整份拷回 run 目录归档并删除临时目录。',
    source: 'accept.mjs 阶段 ③ 的 mkdtempSync(tmpdir(), \'accept-classroom-\')',
  },
  {
    id: 'tmp-idem-scratch',
    label: '幂等重放探针的一次性 scratch `$TMPDIR/accept-idem-*/**`',
    kind: 'name-prefix',
    target: (ctx) => join(ctx.tmpDir, 'accept-idem-'),
    why:
      '断言 A5（不重复送）要拿**真实的** `registerPostClass` 对同一 turn 连发两次 turn-stopping。' +
      '探针把教室的 runtime 目录复制到 tmp 的一次性 scratch 再写，**避免污染工作副本**，' +
      '跑完即删。写它的是**会话子进程**里的探针（不在主进程 ledger 内，故由静态扫描逐目标登记）。',
    source: 'probe/idempotency-replay.mjs 的 mkdtempSync(tmpdir(), \'accept-idem-\')',
  },
  {
    id: 'session-log-dir',
    label: '本次会话自己的落盘目录 `$DSH_HOME/sessions/<本次 cwd 的桶>/<本次会话目录>/**`',
    kind: 'any-prefix',
    target: (ctx) => ctx.sessionLogDirs,
    why:
      '跑真实会话**必然**由宿主把会话日志写进 `$DSH_HOME/sessions/…`（阶段 ③ 正是按 sessionId' +
      '在这个根下精确定位日志的）。白名单**只放本次会话自己那一个目录**：' +
      '目录名由会话 cwd（＝本次的临时教室工作副本，每次唯一）推导，且目录里就是本次 sessionId 的日志。' +
      '→ 用户在同一 workspace 下的历史会话目录**不在**白名单内。',
    source: 'accept.mjs 阶段 ③ 用 findBySessionId 定位到的 located.dir',
  },
]

/** 白名单的"为什么不"清单（诚实边界：这些写入**不**归我们，也**不**由本守卫断言）。 */
export const WHITELIST_EXCLUSIONS = [
  {
    id: 'toolchain-cache',
    what: '宿主/CLI 自身的缓存与依赖 store（`dsh plugin add` 内部的 pnpm store、`$DSH_HOME/cache` 等）',
    why: '那是**工具链自己的**行为，不是本流水线的产物；本流水线既不登记也不据此归因。',
  },
  {
    id: 'resident-app',
    what: '常驻桌面 App 自己写的文件（如 `profiles/web/desktop-storage.json`）',
    why:
      '它与本流水线并行运行。本守卫对它的变化只报"**不由我们造成**"（判据：它不在我们的写足迹里），' +
      '不声称"什么都没发生"——旧守卫正是把这类变化默认算到我们头上，才产生了 ACCEPT-3 那条假红。',
  },
]

// ═════════════════════════════════════════════════════════════════════════════
// 2 · 足迹上下文（白名单判据依赖的绝对路径）
// ═════════════════════════════════════════════════════════════════════════════

let CTX = null

/** 配置/更新足迹上下文。可在拿到 sessionLogDir 后再调一次（增量并入）。 */
export function configureFootprint(partial) {
  CTX = {
    runDir: null,
    acceptanceDir: null,
    dshHome: null,
    tmpDir: null,
    acceptProfile: null,
    forbiddenProfiles: [],
    sessionLogDirs: [],
    ...(CTX ?? {}),
    ...partial,
    sessionLogDirs: [...new Set([...(CTX?.sessionLogDirs ?? []), ...(partial.sessionLogDirs ?? [])])],
  }
  return CTX
}

export function footprintContext() {
  return CTX
}

/** 登记"本次会话自己的落盘目录"（阶段 ③ 定位到日志后调用）。 */
export function registerSessionLogDir(dir) {
  if (CTX === null) throw new Error('registerSessionLogDir 早于 configureFootprint：足迹上下文未配置')
  const c = canonPath(dir)
  if (!CTX.sessionLogDirs.includes(c)) CTX.sessionLogDirs.push(c)
  return c
}

/**
 * 判一个绝对路径是否落在白名单内。
 * @returns {{allowed:boolean, ruleId:string|null, why:string}}
 */
export function classifyWritePath(absPath, ctx = CTX) {
  if (ctx === null || ctx.runDir === null) {
    return { allowed: false, ruleId: null, why: '足迹上下文未配置（白名单判不了）→ 按失败处理' }
  }
  const target = canonPath(absPath)
  for (const rule of WRITE_WHITELIST) {
    const t = rule.target(ctx)
    if (t === null || t === undefined) continue
    const list = Array.isArray(t) ? t : [t]
    for (const one of list) {
      if (one === null || one === undefined) continue
      const hit =
        rule.kind === 'file'
          ? canonPath(one) === target
          : rule.kind === 'name-prefix'
            ? isNameUnder(target, one)
            : isUnder(target, one)
      if (hit) return { allowed: true, ruleId: rule.id, why: rule.why }
    }
  }
  return { allowed: false, ruleId: null, why: '不落在任何一条白名单规则内 → 这是"允许位置之外的写入"' }
}

// ═════════════════════════════════════════════════════════════════════════════
// 3 · 写足迹 ledger（**唯一的写原语**：本模块之外不许直接调 fs 写接口）
// ═════════════════════════════════════════════════════════════════════════════

/** 白名单规则自身的完整性要求：每条都要有 id/label/why/source，且 why 够长（不是敷衍）。 */
export function auditWhitelistRules(rules = WRITE_WHITELIST) {
  const problems = []
  const seen = new Set()
  for (const rule of rules) {
    if (typeof rule.id !== 'string' || rule.id.trim() === '') problems.push('有规则缺 id')
    else if (seen.has(rule.id)) problems.push(`规则 id 重复：${rule.id}`)
    else seen.add(rule.id)
    for (const field of ['label', 'why', 'source']) {
      if (typeof rule[field] !== 'string' || rule[field].trim().length < 20) {
        problems.push(`规则 ${rule.id} 的 ${field} 没写清（长度 < 20）`)
      }
    }
    if (typeof rule.target !== 'function') problems.push(`规则 ${rule.id} 缺 target()`)
    if (!['prefix', 'name-prefix', 'file', 'any-prefix'].includes(rule.kind)) {
      problems.push(`规则 ${rule.id} 的 kind 非法：${rule.kind}`)
    }
  }
  if (rules.length === 0) problems.push('白名单是空的 —— 空白名单等于"什么都允许"，必须判失败')
  return { ok: problems.length === 0, count: rules.length, problems }
}

/** 写足迹记账器。 */
export class WriteLedger {
  constructor() {
    this.entries = []
    this.commands = []
    this.violations = []
  }

  /** 记一次写盘（写原语内部调用）。 */
  recordWrite({ kind, path, stage, source, extra = null }) {
    const abs = canonPath(path)
    const verdict = classifyWritePath(abs, CTX)
    const row = {
      seq: this.entries.length + 1,
      at: new Date().toISOString(),
      stage: stage ?? ACTIVE_STAGE,
      kind,
      path: abs,
      source,
      ruleId: verdict.ruleId,
      allowed: verdict.allowed,
      extra,
    }
    this.entries.push(row)
    if (!verdict.allowed) this.violations.push({ ...row, why: verdict.why })
    return row
  }

  /** 记一条执行过的命令（含它解析出的 --profile 与受保护 profile 命中）。 */
  recordCommand({ cmd, argv, stage, source }) {
    const text = cmd ?? (argv ?? []).join(' ')
    const profileRefs = [...String(text).matchAll(/--profile\s+(\S+)/g)].map((m) => m[1])
    const forbidden = (CTX?.forbiddenProfiles ?? []).filter((name) =>
      profileRefs.some((p) => p.toLowerCase() === name.toLowerCase()),
    )
    // 🔴 声明写目标（子进程的写主进程看不见，只能按命令形状声明；没登记过的新形状＝红）
    const declared = declaredWriteTargetsFor(text, CTX)
    const row = {
      seq: this.commands.length + 1,
      at: new Date().toISOString(),
      stage: stage ?? ACTIVE_STAGE,
      source: source ?? 'run/runAsync',
      cmd: String(text),
      profileRefs,
      forbiddenProfileHits: forbidden,
      declaredWriteTargets: declared.targets,
      declaredRegistered: declared.registered,
      declaredWhy: declared.why,
    }
    this.commands.push(row)
    return row
  }

  outOfWhitelist() {
    return this.violations
  }

  stats() {
    const byRule = {}
    for (const row of this.entries) {
      const key = row.ruleId ?? '<白名单外>'
      byRule[key] = (byRule[key] ?? 0) + 1
    }
    return { writes: this.entries.length, commands: this.commands.length, violations: this.violations.length, byRule }
  }
}

/** 当前阶段（由 accept.mjs 的 stage() 维护；这里只读，避免循环依赖）。 */
let ACTIVE_STAGE = '00'
export function setFootprintStage(id) {
  ACTIVE_STAGE = id
}

/** 进程级唯一 ledger。 */
export const footprintLedger = new WriteLedger()

// ═════════════════════════════════════════════════════════════════════════════
// 3.5 · 命令的**声明写目标**（子进程的写，主进程 ledger 看不见 → 只能按"命令形状"声明）
// ═════════════════════════════════════════════════════════════════════════════
//
// 🔴 为什么必须有：ledger 记的是**我们代码**的写盘；而 `dsh` CLI / pnpm 是**子进程**，
//   它们的写主进程看不见。只扫 `--profile` 只能证明"命令里没出现受保护 profile 名"，
//   证不了"这条命令没有别的写目标"。
//   → 按**命令形状**逐类声明写目标：新形状（没登记过的命令）→ **判红**，
//     逼着人先登记"它会写哪儿、为什么在白名单内"。
//
// 🔴 实测依据（ACCEPT-4 本批做的一次对照实验，不是推断）：
//   单独跑 `dsh plugin --profile socratic-accept add file:<冻结目录>` 之后，
//   **只有 `socratic-accept` 的 pnpm-lock.yaml 变了**（14:56:24 → 14:56:55），
//   同目录下的 `socratic-headless`（14:56:27/14:56:25）与 `socratic-dev`（14:56:09）
//   一个字节都没动 → "`--profile X` 只写 X"这条声明有实测支撑。

/** 声明写目标的类别记号：会话日志根（真实目录由本次会话 cwd 推导，白名单只放本次那一个）。 */
export const CLASS_SESSIONS = 'class:sessions'

/**
 * 按命令形状判"这条命令会写哪儿"。
 * @param {string} cmd
 * @param {object} ctx
 * @returns {{registered:boolean, targets:string[], why:string}}
 */
export function declaredWriteTargetsFor(cmd, ctx) {
  const text = String(cmd ?? '')
  const profileArg = /--profile\s+(\S+)/.exec(text)?.[1] ?? null
  const profilesDir = ctx?.dshHome ? join(ctx.dshHome, 'profiles') : '<dshHome>/profiles'

  // ① 只读命令（查询版本、找可执行文件）——不写
  if (/^(which|zstd|pnpm)\s/.test(text) || /--version\s*$/.test(text)) {
    return { registered: true, targets: [], why: '只读命令（查版本／查可执行文件路径），不写盘' }
  }
  // ② 技能包自检（validate）——只读脚本；"跑前跑后逐文件 sha256 一致"是它的实证
  if (/socratic-classroom\/validate\b/.test(text)) {
    return { registered: true, targets: [], why: '技能包自检是只读脚本（跑前跑后逐文件 sha256 一致为证）' }
  }
  // ②b 幂等重放探针（`probe/idempotency-replay.mjs`）：
  //     它把教室 runtime 复制到 $TMPDIR 的一次性 scratch 上重放，并把结果写 `--out`（run 目录里）
  if (/probe\/idempotency-replay\.mjs\b/.test(text)) {
    const out = /--out\s+(\S+)/.exec(text)?.[1] ?? null
    return {
      registered: true,
      targets: [join(ctx?.tmpDir ?? '<tmpDir>', 'accept-idem-'), ...(out === null ? [] : [out])],
      why:
        '幂等重放探针：写 `$TMPDIR/accept-idem-*`（一次性 scratch，跑完删）＋ `--out` 指定的那个文件' +
        `（流水线给的是 run 目录里的 04-asserts/evidence/…）。`,
    }
  }
  // ③ dsh CLI：profile 初始化（--dump-config 只组合配置树、不 boot）
  if (/--dump-config\b/.test(text) && profileArg !== null) {
    return { registered: true, targets: [join(profilesDir, profileArg)], why: `profile 初始化只写 profiles/${profileArg}` }
  }
  // ④ dsh CLI：装插件（pnpm 把包装进该 profile；实测只碰该 profile）
  if (/\bplugin\b/.test(text) && /\badd\b/.test(text) && profileArg !== null) {
    return {
      registered: true,
      targets: [join(profilesDir, profileArg)],
      why:
        `dsh plugin add 只写 profiles/${profileArg}（ACCEPT-4 实测：跑完之后同目录下 socratic-headless/socratic-dev 的 ` +
        'package.json 与 pnpm-lock.yaml 的 mtime 一个都没变）',
    }
  }
  // ⑤ dsh CLI：跑会话（写 profile ＋ 宿主把会话日志写进 $DSH_HOME/sessions/<cwd 推导的桶>/）
  if (/--patch\b/.test(text) && profileArg !== null) {
    return {
      registered: true,
      targets: profileArg === null ? [] : [join(profilesDir, profileArg), CLASS_SESSIONS],
      why:
        `会话只写 profiles/${profileArg}（--profile 指定）＋ $DSH_HOME/sessions/<本次 cwd 推导的桶>/` +
        '（会话日志；本流水线在阶段③把**本次会话自己的那一个目录**登记进白名单）',
    }
  }
  return {
    registered: false,
    targets: [],
    why: '🔴 没登记过的命令形状 → 它可能写哪儿、为什么在白名单内，都还没有人声明过（必须先登记再跑）',
  }
}

// ── 写原语（**只有本模块**可以直接调 node:fs 的写接口）────────────────────────

function metaOf(meta) {
  return { stage: meta?.stage, source: meta?.source ?? 'lib/footprint.mjs' }
}

export function ledgerEnsureDir(dir, meta) {
  footprintLedger.recordWrite({ kind: 'dir', path: dir, ...metaOf(meta) })
  mkdirSync(dir, { recursive: true })
  return dir
}

export function ledgerWriteFile(file, content, meta) {
  footprintLedger.recordWrite({ kind: 'file', path: file, ...metaOf(meta) })
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content, 'utf8')
  return file
}

export function ledgerAppendFile(file, content, meta) {
  footprintLedger.recordWrite({ kind: 'append', path: file, ...metaOf(meta) })
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, content, 'utf8')
  return file
}

export function ledgerCopy(src, dst, opts, meta) {
  footprintLedger.recordWrite({ kind: 'copy', path: dst, extra: { from: canonPath(src) }, ...metaOf(meta) })
  cpSync(src, dst, { recursive: true, dereference: false, ...opts })
  return dst
}

export function ledgerRemove(target, opts, meta) {
  footprintLedger.recordWrite({ kind: 'remove', path: target, ...metaOf(meta) })
  rmSync(target, { recursive: true, force: true, ...opts })
  return target
}

export function ledgerMkdtemp(prefix, meta) {
  // mkdtemp 的产物路径事前不可知 → 先按 prefix 判一次白名单（prefix 必须在白名单内）
  footprintLedger.recordWrite({ kind: 'mkdtemp-prefix', path: prefix, ...metaOf(meta) })
  return mkdtempSync(prefix)
}

// ═════════════════════════════════════════════════════════════════════════════
// 4 · 完整性：静态扫"有没有绕开 ledger 的写调用"
// ═════════════════════════════════════════════════════════════════════════════

/** 写调用形状（出现即需要登记）。 */
export const WRITE_CALL_RE =
  /\b(writeFileSync|appendFileSync|cpSync|mkdirSync|mkdtempSync|rmSync|renameSync|createWriteStream|writeFile|appendFile)\s*\(/g

/**
 * 允许直接写盘的文件（每条都要理由）。除这些之外，任何文件出现写调用 → 判失败。
 * `targetCheck`：是否还要逐条核对"写目标表达式"（只有**在会话子进程里跑的探针**需要，
 * 因为它们的写目标不是主进程 ledger 能看见的；写原语实现处不需要——它的目标就是调用方传进来的参数）。
 */
export const WRITE_CALL_ALLOWLIST = [
  {
    rel: 'lib/footprint.mjs',
    targetCheck: false,
    why:
      '**写原语的唯一实现处**：本模块必须能调 fs 写接口（`ledgerWriteFile`/`ledgerCopy`/… 都在这里落地）。' +
      '它自己产生的"写目标"就是调用方传进来的参数，故不逐条登记；调用方一律要过 `classifyWritePath` 白名单。',
  },
  {
    rel: 'footprint-self-test.mjs',
    targetCheck: true,
    why:
      '**自检脚本**（只由人手工跑，不在流水线运行路径上）：它必须能造"合成的坏形状"来证明扫描器不是空壳，' +
      '产物全部落在 `$TMPDIR/accept4-selftest-*/`（跑完删除）。登记它的写目标是因为' +
      '**自检脚本也不许有绕开 ledger 的写** —— 那正是本扫描存在的意义。',
  },
  {
    rel: 'probe/accept-driver.mjs',
    targetCheck: true,
    why: '在**会话子进程**里跑（不在主进程 ledger 内）；写目标逐条登记见 PROBE_WRITE_TARGETS。',
  },
  {
    rel: 'probe/log-bridge.mjs',
    targetCheck: true,
    why: '同上：会话子进程内的日志桥；写目标逐条登记见 PROBE_WRITE_TARGETS。',
  },
  {
    rel: 'probe/idempotency-replay.mjs',
    targetCheck: true,
    why: '同上：幂等重放探针；写目标逐条登记见 PROBE_WRITE_TARGETS。',
  },
  {
    rel: 'a2-replay.mjs',
    targetCheck: true,
    why:
      '**A2 的离线复评脚本**（ACCEPT-5 新增；只由人手工跑，不在流水线运行路径上）：拿**已落盘的真实会话事件流**' +
      '重喂 A2 的新判据，因此它必须能把证据写到盘上。' +
      '🔴 它**只写 `--out` 目录**（默认 `$TMPDIR/accept5-a2-replay/`，一次性 scratch）——' +
      '**不碰仓库、不碰 run 归档、不碰用户 profile**。写目标逐条登记见 PROBE_WRITE_TARGETS。',
  },
]

/**
 * 探针的写目标登记表：每条写调用**第一个（cpSync 取第二个）实参表达式**必须在这里。
 * 🔴 新增/改变写目标 = 必须在这里登记并写明"这条路径从哪来、落在白名单的哪一条"。
 */
export const PROBE_WRITE_TARGETS = {
  'footprint-self-test.mjs': [
    { expr: 'scratch', why: '＝`join(tmpdir(), \'accept4-selftest-<pid>\')`：自检自己的临时根（跑完 rmSync 删除）。' },
    { expr: 'd', why: '自检在临时根下造的几个目录（runDir/acceptance/dsh-home/tmp/sessionLogDir）。' },
    { expr: "join(scanRoot, 'probe')", why: '＝临时根下的**合成**扫描根，用来喂"未登记写调用"给扫描器（不是真实流水线目录）。' },
    { expr: "join(scanRoot, 'lib')", why: '同上。' },
    { expr: "join(scanRoot, 'accept.mjs')", why: '同上（合成文件，内容是"走 ledger 原语"的干净形状）。' },
    { expr: "join(scanRoot, 'lib', 'util.mjs')", why: '同上。' },
    { expr: "join(scanRoot, 'lib', 'sneaky.mjs')", why: '同上（合成文件，内容是"绕开 ledger"的坏形状）。' },
    { expr: "join(scanRoot, 'probe', 'log-bridge.mjs')", why: '同上（合成文件，内容是"探针未登记写目标"的坏形状）。' },
    { expr: "join(scanRoot, `file-${n}.mjs`)", why: '同上（凑够扫描器的"至少扫到 6 个文件"门槛）。' },
  ],
  'probe/accept-driver.mjs': [
    {
      expr: 'reportPath',
      why: '＝`process.env.ACCEPT_REPORT`，流水线给的是 `<runDir>/03-session/attempt-N/driver-report.json`（白名单 run-dir）。',
    },
  ],
  'probe/log-bridge.mjs': [
    {
      expr: 'logFile',
      why: '＝`process.env.ACCEPT_LOG_FILE`，流水线给的是 `<runDir>/03-session/attempt-N/cordis-log.jsonl`（白名单 run-dir）。',
    },
    {
      expr: 'probeFile',
      why: '＝`process.env.ACCEPT_LOG_PROBE`，流水线给的是 `<runDir>/03-session/attempt-N/log-probe.json`（白名单 run-dir）。',
    },
  ],
  'probe/idempotency-replay.mjs': [
    { expr: 'scratch', why: '＝`mkdtempSync(tmpdir(), \'accept-idem-\')`：一次性 scratch（白名单 tmp-idem-scratch）。' },
    { expr: 'h.scratch', why: '同上（同一批 scratch 的句柄）。' },
    { expr: 'resolve(args.out)', why: '＝`--out` 参数；流水线给的是 `<runDir>/04-asserts/...` 下的路径（白名单 run-dir）。' },
    { expr: 'join(tmpdir(), \'accept-idem-\')', why: '＝mkdtemp 的 prefix 本身（白名单 tmp-idem-scratch 的前缀）。' },
  ],
  'a2-replay.mjs': [
    {
      expr: 'outDir',
      why: '＝`--out` 目录（默认 `$TMPDIR/accept5-a2-replay/`）：A2 复评的输出根，建它是一次写盘。**不进仓库、不进 run 归档**。',
    },
    {
      expr: 'join(outDir, run)',
      why: '＝`<--out 目录>/<run 目录名>`：A2 复评把证据写到**临时输出根**下按 run 名分目录的位置（默认 `$TMPDIR/accept5-a2-replay/`）。',
    },
    {
      expr: 'resultFile',
      why: '＝`join(outDir, run, \'A2-replay-result.json\')`：同上目录下的复评结论（每跑一份）。',
    },
  ],
}

/** 取第 n 个实参表达式（简单按顶层逗号切分；不处理嵌套逗号以外的花哨语法）。 */
export function nthArg(text, from, n) {
  const inner = text.slice(from)
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of inner) {
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break
      depth -= 1
    }
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  return (parts[n] ?? '').trim()
}

/**
 * 扫 `acceptance/**` 的源码，找"没登记的写调用"。
 * @param {{acceptanceDir:string, extraFiles?:string[]}} opts
 */
export function scanUninstrumentedWrites(opts) {
  const dir = opts.acceptanceDir
  const allow = new Map(WRITE_CALL_ALLOWLIST.map((r) => [r.rel, r]))
  const files = []
  const scanDir = (d, prefix) => {
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === 'runs' || e.name === 'node_modules' || e.name.startsWith('.')) continue
        scanDir(join(d, e.name), prefix === '' ? e.name : `${prefix}/${e.name}`)
      } else if (e.isFile() && (e.name.endsWith('.mjs') || e.name === 'run.sh')) {
        files.push(prefix === '' ? e.name : `${prefix}/${e.name}`)
      }
    }
  }
  scanDir(dir, '')
  for (const extra of opts.extraFiles ?? []) files.push(extra)

  const violations = []
  const rows = []
  for (const rel of files.sort()) {
    const abs = join(dir, rel)
    if (!existsSync(abs)) continue
    const text = readFileSync(abs, 'utf8')
    const lines = text.split('\n')
    for (const [i, line] of lines.entries()) {
      WRITE_CALL_RE.lastIndex = 0
      let m
      while ((m = WRITE_CALL_RE.exec(line)) !== null) {
        const fn = m[1]
        const argIndex = fn === 'cpSync' ? 1 : 0
        const expr = nthArg(line, m.index + m[0].length, argIndex)
        const allowedFile = allow.get(rel)
        const registered = (PROBE_WRITE_TARGETS[rel] ?? []).find((t) => t.expr === expr)
        rows.push({ file: rel, line: i + 1, fn, expr, fileAllowed: allowedFile !== undefined, registered: registered !== undefined })
        if (allowedFile === undefined) {
          violations.push({
            file: rel,
            line: i + 1,
            fn,
            expr,
            why: `${rel} 不在"允许直接写盘"的名单里，却出现了 ${fn}() → 这次写入绕开了 ledger（写足迹就不可信了）`,
          })
        } else if (allowedFile.targetCheck && !registered) {
          violations.push({
            file: rel,
            line: i + 1,
            fn,
            expr,
            why: `${rel} 的写目标 ${JSON.stringify(expr)} 没有在 PROBE_WRITE_TARGETS 里登记 → 新增写目标必须先登记理由`,
          })
        }
      }
    }
  }
  return {
    scannedFiles: files.length,
    callSites: rows.length,
    violations,
    ok: violations.length === 0 && files.length >= 6,
    note:
      '静态近似：保证"没有未登记的写调用形状"；不保证"运行期没有别的进程写盘"。' +
      '扫到的文件：' + files.join('、'),
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 5 · 守卫判定
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 受保护 profile 的变化归因（**按写足迹，不按时间窗**）。
 * @param {{ctx:object, changedByProfile:Record<string,string[]>, ledger:WriteLedger}} opts
 */
export function attributeProtectedChanges(opts) {
  const { ctx, changedByProfile, ledger } = opts
  const out = {}
  // 🔴 名单＝受保护的三个 profile ∪ 任何"顺带观测"的 profile（`socratic-headless`）。
  //    用 changedByProfile 的键当名单：观测了谁就判谁（不漏判，也不凭空造条目）。
  const names = [...new Set([...ctx.forbiddenProfiles, ...Object.keys(changedByProfile ?? {})])]
  for (const name of names) {
    const changedKeys = changedByProfile[name] ?? []
    const rows = []
    for (const key of changedKeys) {
      const abs = join(ctx.dshHome, 'profiles', name, key)
      const hit = ledger.entries.find(
        (e) => e.path === canonPath(abs) || isUnder(abs, e.path) || isUnder(e.path, abs),
      )
      rows.push({
        key,
        path: abs,
        inOurFootprint: hit !== undefined,
        footprintEntry: hit === undefined ? null : { seq: hit.seq, kind: hit.kind, stage: hit.stage, source: hit.source },
        attribution: hit === undefined ? 'not-ours' : 'ours',
        why:
          hit === undefined
            ? '这条路径**不在本流水线的写足迹里**；而写足迹已被白名单检查证明全部落在允许写的位置内，' +
              '白名单里唯一的 profile 是专用测试 profile（socratic-accept）→ 不是我们写的'
            : `本流水线的写足迹里有这条路径（ledger#${hit.seq}，${hit.kind}，阶段 ${hit.stage}）→ 归因给我们`,
      })
    }
    out[name] = {
      changedKeys,
      rows,
      attributedToUs: rows.filter((r) => r.attribution === 'ours').map((r) => r.key),
      notOurs: rows.filter((r) => r.attribution === 'not-ours').map((r) => r.key),
    }
  }
  return out
}

/**
 * 判"零接触"这条守卫。
 * @param {{
 *   ctx:object, ledger:WriteLedger, changedByProfile:Record<string,string[]>,
 *   samplerObserved:Record<string,string[]>, scan:object, writeWhitelistAudit:object,
 * }} opts
 * @returns {{ok:boolean, reasons:string[], ...}}
 */
export function evaluateZeroTouch(opts) {
  const { ctx, ledger, changedByProfile, samplerObserved, scan, writeWhitelistAudit } = opts
  const reasons = []

  // ① 白名单自身必须成立（空白名单＝什么都允许）
  if (!writeWhitelistAudit.ok) reasons.push(`写足迹白名单本身不成立：${writeWhitelistAudit.problems.join('；')}`)

  // ② 上下文必须配置
  if (ctx === null || ctx.runDir === null || ctx.dshHome === null) {
    reasons.push('写足迹上下文未配置 → 判不了"允许写的位置"，按失败处理')
  }

  // ③ 完整性扫描：不许有绕开 ledger 的写调用
  if (!scan.ok) {
    reasons.push(
      `写足迹完整性扫描不通过（${scan.violations.length} 条）：` +
        scan.violations.map((v) => `${v.file}:${v.line} ${v.fn}(${v.expr})`).join('、'),
    )
  }

  // ④ 写足迹本身：每一条都必须在白名单内；且足迹不许为空（空足迹＝没记账，不可信）
  const outOfWhitelist = ledger.outOfWhitelist()
  if (outOfWhitelist.length > 0) {
    reasons.push(
      `🔴 有 ${outOfWhitelist.length} 次写盘落在"允许写的位置"之外：` +
        outOfWhitelist.map((v) => `${v.path}（阶段 ${v.stage}，来源 ${v.source}）`).join('、'),
    )
  }
  if (ledger.entries.length === 0) reasons.push('写足迹是空的（一次写盘都没记上）→ 记账本身失效，按失败处理')

  // ⑤ 命令级：本流水线执行过的命令里不许出现受保护 profile
  const badCommands = ledger.commands.filter((c) => c.forbiddenProfileHits.length > 0)
  if (badCommands.length > 0) {
    reasons.push(
      `🔴 本流水线的命令里出现受保护 profile：` +
        badCommands.map((c) => `${c.cmd} → ${JSON.stringify(c.forbiddenProfileHits)}`).join('、'),
    )
  }

  // ⑤b 命令级：**每条命令的声明写目标**必须登记过、且落在白名单内
  //     （子进程的写主进程看不见 → 只能按命令形状声明；没登记过的新形状＝红）
  const unregisteredCommands = ledger.commands.filter((c) => c.declaredRegistered !== true)
  if (unregisteredCommands.length > 0) {
    reasons.push(
      `🔴 有 ${unregisteredCommands.length} 条命令的形状**没有登记写目标**（新命令必须先登记"它会写哪儿"）：` +
        unregisteredCommands.map((c) => c.cmd.slice(0, 120)).join('、'),
    )
  }
  const outOfWhitelistCommandTargets = []
  for (const c of ledger.commands) {
    for (const t of c.declaredWriteTargets ?? []) {
      if (t === CLASS_SESSIONS) continue // 会话日志根：由 session-log-dir 规则＋阶段③登记的具体目录负责
      const verdict = classifyWritePath(t, ctx)
      if (!verdict.allowed) outOfWhitelistCommandTargets.push({ cmd: c.cmd.slice(0, 120), target: t, why: verdict.why })
    }
  }
  if (outOfWhitelistCommandTargets.length > 0) {
    reasons.push(
      `🔴 有命令的声明写目标落在白名单外：` +
        outOfWhitelistCommandTargets.map((r) => `${r.target}（来自 ${r.cmd}）`).join('、'),
    )
  }
  const sessionsClassCommands = ledger.commands.filter((c) => (c.declaredWriteTargets ?? []).includes(CLASS_SESSIONS))
  if (sessionsClassCommands.length > 0 && (ctx?.sessionLogDirs ?? []).length === 0) {
    reasons.push(
      '🔴 有会话命令声明会写 `$DSH_HOME/sessions/…`，但本流水线**没有登记本次会话自己的落盘目录**' +
        '（阶段③ 应按 sessionId 定位后登记）→ 白名单里那条规则无对象，判不了',
    )
  }

  // ⑥ 受保护 profile 的变化归因（按写足迹）
  const attribution = attributeProtectedChanges({ ctx, changedByProfile, ledger })
  for (const name of ctx.forbiddenProfiles) {
    if (attribution[name].attributedToUs.length > 0) {
      reasons.push(
        `🔴 ${name} 的变化出现在本流水线的写足迹里：${JSON.stringify(attribution[name].attributedToUs)}`,
      )
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    writeWhitelistAudit,
    scan: { ok: scan.ok, scannedFiles: scan.scannedFiles, callSites: scan.callSites, violations: scan.violations, note: scan.note },
    ledgerStats: ledger.stats(),
    outOfWhitelist,
    commandTargetAudit: {
      commands: ledger.commands.length,
      unregisteredShapes: unregisteredCommands.length,
      outOfWhitelistTargets: outOfWhitelistCommandTargets,
      sessionsClassCommands: sessionsClassCommands.length,
    },
    attribution,
    samplerObserved,
    commands: ledger.commands,
    note:
      '本守卫证明的是"**本流水线的写足迹干净**"（自己的写盘全在允许写的位置内、命令里没有受保护 profile）；' +
      '它**不**声称"用户 profile 没被动过"——别的进程照样可能写它，那类变化只报"不由我们造成"并附判据。',
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 6 · 人读渲染
// ═════════════════════════════════════════════════════════════════════════════

export function renderWhitelistMarkdown(ctx = CTX) {
  const lines = [
    '# 写足迹白名单（ACCEPT-4）',
    '',
    '> 由 `lib/footprint.mjs` 的 `WRITE_WHITELIST` 生成（**单一来源**，不许手改本文件）。',
    '> 判据：本流水线**自己**的每一次写盘（以及它显式登记的"命令写入目标"）都必须落在下表之内；',
    '> 落在表外＝违规（守卫 `zeroTouchForbiddenClean` 判红）。',
    '',
    '| # | 位置 | 形态 | 为什么这个位置算我们的 | 出处 |',
    '|---|---|---|---|---|',
    ...WRITE_WHITELIST.map((r, i) => {
      const t = ctx === null ? null : r.target(ctx)
      const shown = Array.isArray(t) ? (t.length === 0 ? '<本次运行尚未登记>' : t.join('、')) : (t ?? '<未配置>')
      return `| ${i + 1} | \`${shown}\` | ${r.kind} | ${r.why} | ${r.source} |`
    }),
    '',
    '## 明确**不**列入白名单、也**不**归因给我们的写入',
    '',
    '| # | 是什么 | 为什么不列 |',
    '|---|---|---|',
    ...WHITELIST_EXCLUSIONS.map((e, i) => `| ${i + 1} | ${e.what} | ${e.why} |`),
    '',
  ]
  return lines.join('\n')
}

export function renderFootprintRow(zeroTouch) {
  const stats = zeroTouch.ledgerStats
  return (
    `写足迹：${stats.writes} 次写盘（白名单外 ${stats.violations}）｜命令 ${stats.commands} 条｜` +
    `按规则：${Object.entries(stats.byRule).map(([k, v]) => `${k}×${v}`).join('、')}`
  )
}
