// lib/skillcheck.mjs — ACCEPT-3：把技能包自检（`socratic-classroom/validate`）接进流水线
//
// 为什么接：技能包自检以前**只能人手动跑**——而"宿主加载技能失败全部只是 logger.warn
//   后静默跳过"这件事（见 `acceptance/README.md` 的「技能包自检」一节）意味着：
//   没人手动跑 = 没有任何地方会发现它坏了。接进流水线之后，"技能包还是不是好的"
//   变成每次验收都会自动回答的一条守卫。
//
// 🔴 退出码语义**按它自己的设计**读（`skills/socratic-classroom/validate` 文件头）：
//   · **0 = 全绿**（五项全过）；
//   · **1 = 查出问题**——但问题分两类，必须分开对待：
//       ① 内容类（① 必需文件 / ② 声明材料 / ③ 讲次 / ④ 教材正文）：**真问题，必须失败**；
//       ② ⑤ 发现链路（"本包在不在某个技能扫描根下"）：🔴 **在仓库原地跑本来就会红**
//          ——本包住在 `<仓库>/skills/socratic-classroom`，而宿主的扫描根是
//          `$DSH_HOME/skills`、`~/.agents/skills`、`<项目根>/.dsh/skills`。
//          **这是设计如此，不是缺陷**：自检的存在意义就是"告诉你宿主现在扫不到我"。
//          → 按"已知/可解释"处理：把"第⑤项红"列为**预期内**，其余项必须全绿。
//          → 🔴 不为了让它变绿去把包装进用户环境（那是动用户环境，本流水线不做）。
//   · **2 = 用法/目标错误（"残包"：连检查都做不了，例如缺 lib/mini-yaml.js）→ 真问题，必须失败**。
//
// 🔴 判"是不是只有第⑤项红"**不靠退出码**（1 对两类问题都是 1），而是解析它自己打出的
//   问题清单：`validate` 的清单按 `①…⑤` 分节打印。本模块只认**那一节里的**问题，
//   不做关键词全文匹配（避免把⑤的说明文字里提到的别处文本误判成别节的问题）。
//
// 🔴 纪律：本模块**只读**技能包（`validate` 是只读脚本）；不装、不改、不复制到任何扫描根。
//
// ═══════════════════════════════════════════════════════════════════════════════
// 🔴 ACCEPT-4：**两份都跑**（原来只跑仓库源包 → 它必然红，因为包不在扫描根下）
// ═══════════════════════════════════════════════════════════════════════════════
//   · **源包**（`<仓库>/skills/socratic-classroom`）→ **判内容**：
//     ①–④ 内容类必须全绿；⑤ 发现链路**在仓库原地跑本来就会红**（设计如此，列为预期内）。
//   · **已装副本**（`$DSH_HOME/skills/socratic-classroom`）→ **判发现链路**：
//     它就在宿主的扫描根下，所以应当 **exit 0 全绿**；跑它才能把"宿主真的能发现这个技能"
//     这条**正向路径**变成验收项（源包那一跑永远验不到这一半）。
//     🔴 **只读**：跑前跑后逐文件 sha256 一致；不装、不改、不复制。
//     🔴 **没装就明确报"未安装、该检查跳过"**（`verdict='not-installed'`），
//        **不许静默跳过** —— 它必须出现在日志、结论与报告里，人一眼能看见"这一项没验"。
//
// 🔴 为什么"未安装"不算失败：本流水线**不许动用户环境**（把包装进 `$DSH_HOME/skills` 是用户的事）。
//   若那台机器上就是没装，正确的行为是**如实说"没装、跳过"**，而不是替用户装一个、也不是假装绿。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashTree, runNode, writeJson, writeText } from './util.mjs'

/** 五个检查节的标题（逐字取自 validate 的打印，顺序即它的打印顺序）。 */
export const SECTIONS = ['① 必需文件', '② 声明材料', '③ 讲次', '④ 教材正文', '⑤ 发现链路']

/** 属于"发现链路"的那一节——在仓库原地跑**预期内**会红。 */
export const DISCOVERY_SECTION = '⑤ 发现链路'

/** 已装副本在 `$DSH_HOME` 下的相对位置（宿主的用户级扫描根）。 */
export const INSTALLED_SKILL_REL = join('skills', 'socratic-classroom')

/** 本模块的公共退出码语义说明（两个跑法共用）。 */
export const EXIT_CODE_NOTE =
  '退出码语义按 validate 自己的设计读：0=全绿；1=查出问题（**分两类**：①–④ 内容类＝真问题必须失败；' +
  '⑤ 发现链路＝**在不在扫描根下**，取决于跑的是哪一份）；2=残包/用法错误＝真问题必须失败。'

/**
 * 解析 `validate` 的问题清单。
 * 清单长这样（`validate` 末尾逐字打印）：
 *   ================================================================
 *   结论：发现 1 个问题（退出码 1）
 *
 *   ⑤ 发现链路（1）
 *     1. 本包不在任何扫描根的直接子目录下（…）
 *
 * @param {string} stdout
 * @returns {{bySection:Record<string,string[]>, otherSections:Record<string,string[]>, total:number}}
 */
export function parseProblemList(stdout) {
  const lines = String(stdout ?? '').split('\n')
  const marker = lines.findIndex((line) => /^结论：发现\s*\d+\s*个问题/.test(line))
  const bySection = {}
  const otherSections = {}
  if (marker === -1) return { bySection, otherSections, total: 0 }

  let current = null
  const sectionHead = /^(①|②|③|④|⑤)\s*(.+?)（(\d+)）\s*$/
  for (const line of lines.slice(marker + 1)) {
    const head = sectionHead.exec(line)
    if (head !== null) {
      current = `${head[1]} ${head[2]}`
      bySection[current] ??= []
      continue
    }
    const item = /^\s+\d+\.\s+(.*)$/.exec(line)
    if (item !== null && current !== null) {
      bySection[current].push(item[1].trim())
      continue
    }
    if (line.trim() === '') continue
    // 落不进已知分节的行：留档但不计分（清单格式若变了要能看见）
    current = null
    otherSections['<未归类行>'] ??= []
    otherSections['<未归类行>'].push(line.trim())
  }
  const total = Object.values(bySection).reduce((n, rows) => n + rows.length, 0)
  return { bySection, otherSections, total }
}

/**
 * 跑一次 `validate` 并把结论判成"通过 / 不通过 / 已知可解释"。
 *
 * @param {{
 *   role:'workspace-source'|'installed-copy', // 跑的是哪一份（决定 ⑤ 的读法）
 *   skillDir:string,       // 技能包目录（含 validate）
 *   classroomArg:string|null, // 传给 validate 的教室目录；null＝让它查自带的 ./classroom
 *   outDir:string,         // 证据落盘目录
 *   filePrefix:string,     // 证据文件名前缀（两份的产物不互相覆盖）
 * }} opts
 */
function runOneValidate(opts) {
  const { role, skillDir, classroomArg, outDir, filePrefix } = opts
  const validate = join(skillDir, 'validate')
  const stdoutFile = join(outDir, `${filePrefix}-stdout.txt`)
  const stderrFile = join(outDir, `${filePrefix}-stderr.txt`)
  const note = `${EXIT_CODE_NOTE} 本次角色＝${role}。`

  if (!existsSync(validate)) {
    writeText(stderrFile, `validate 不存在：${validate}\n`)
    writeText(stdoutFile, '')
    return {
      role,
      ok: false,
      exitCode: null,
      skillDir,
      classroomDir: classroomArg,
      validateSha256: null,
      bySection: {},
      discoveryProblems: [],
      otherProblems: [],
      verdict: 'usage-error',
      detail: `🔴 技能包自检脚本不存在：${validate}`,
      stdoutFile,
      stderrFile,
      note,
      tree: null,
    }
  }

  // 跑之前先钉住"跑的是哪一份"（技能包可能被人手改过）
  const treeBefore = hashTree(skillDir)
  const validateSha = treeBefore.map['validate']?.sha256 ?? null
  const args = classroomArg === null ? [validate] : [validate, classroomArg]
  const res = runNode(args, { cwd: skillDir })
  writeText(stdoutFile, res.stdout)
  writeText(stderrFile, res.stderr)
  // 跑之后再钉一次：证明"自检本身没有动这个包"
  const treeAfter = hashTree(skillDir)
  const unchanged =
    JSON.stringify(Object.keys(treeBefore.map).sort()) === JSON.stringify(Object.keys(treeAfter.map).sort()) &&
    Object.keys(treeBefore.map).every((rel) => treeBefore.map[rel].sha256 === treeAfter.map[rel].sha256)

  const parsed = parseProblemList(res.stdout)
  const discoveryProblems = parsed.bySection[DISCOVERY_SECTION] ?? []
  const otherProblems = Object.entries(parsed.bySection)
    .filter(([section]) => section !== DISCOVERY_SECTION)
    .flatMap(([section, rows]) => rows.map((text) => `${section}｜${text}`))

  let verdict
  let ok
  let detail
  if (res.code === 0) {
    verdict = 'green'
    ok = true
    detail =
      `全绿（退出码 0）：①–④ 内容类与 ⑤ 发现链路都没有问题；` +
      `教室目录 ${classroomArg ?? `${skillDir}/classroom（自带副本）`}；validate sha256=${validateSha?.slice(0, 12) ?? '<缺>'}`
  } else if (res.code === 2) {
    verdict = 'broken-package'
    ok = false
    detail =
      `🔴 退出码 2（残包/用法错误——"连检查都做不了"）：${(res.stdout + res.stderr).trim().split('\n').slice(-6).join(' ｜ ')}`
  } else if (res.code === 1 && otherProblems.length === 0 && discoveryProblems.length > 0) {
    if (role === 'workspace-source') {
      verdict = 'expected-discovery-only'
      ok = true
      detail =
        `退出码 1，**问题全部落在 ⑤ 发现链路**（${discoveryProblems.length} 条）→ 按"已知/可解释"处理：` +
        `源包住在仓库 \`skills/\` 下，而宿主只扫 \`$DSH_HOME/skills\`、\`~/.agents/skills\`、\`<项目根>/.dsh/skills\`，` +
        `**在仓库原地跑本来就会红**（这正是该自检存在的意义）；①–④ 内容类 0 条问题、frontmatter 合法 → **内容侧全绿**。` +
        `🔴 本流水线不为了让它变绿而把包装进用户环境；"宿主到底能不能发现"由**已装副本**那一跑回答。`
    } else {
      verdict = 'discovery-chain-problem'
      ok = false
      detail =
        `🔴 这一份**已经装进扫描根**（${skillDir}），却仍然报 ⑤ 发现链路问题 ${discoveryProblems.length} 条 → ` +
        `"宿主能发现它"这条正向路径**没成立**：${discoveryProblems.slice(0, 3).join(' ｜ ')}`
    }
  } else if (res.code === 1) {
    verdict = 'content-problems'
    ok = false
    detail =
      `🔴 退出码 1，且问题**不止** ⑤ 发现链路：内容类 ${otherProblems.length} 条 → ` +
      `${otherProblems.slice(0, 6).join(' ｜ ')}`
  } else {
    verdict = res.code === null ? 'crashed' : 'usage-error'
    ok = false
    detail =
      `🔴 异常退出（exit ${res.code}${res.error ? `，${res.error}` : ''}）：` +
      `${(res.stderr || res.stdout).trim().split('\n').slice(-6).join(' ｜ ')}`
  }

  writeJson(join(outDir, `${filePrefix}-result.json`), {
    at: new Date().toISOString(),
    role,
    skillDir,
    classroomArg,
    validate,
    cmd: res.cmd,
    exitCode: res.code,
    validateSha256: validateSha,
    treeFiles: treeBefore.files,
    treeBytes: treeBefore.bytes,
    unchangedAfterSelfCheck: unchanged,
    sectionsFound: Object.keys(parsed.bySection),
    discoveryProblems,
    otherProblems,
    unclassifiedLines: parsed.otherSections['<未归类行>'] ?? [],
    verdict,
    ok,
    detail,
    note,
  })

  return {
    role,
    ok,
    exitCode: res.code,
    skillDir,
    classroomDir: classroomArg,
    validateSha256: validateSha,
    bySection: parsed.bySection,
    discoveryProblems,
    otherProblems,
    verdict,
    detail,
    stdoutFile,
    stderrFile,
    note,
    tree: { files: treeBefore.files, bytes: treeBefore.bytes, map: treeBefore.map },
    unchangedAfterSelfCheck: unchanged,
  }
}

/**
 * 跑**仓库源包**自检 → **判内容**（①–④ 必须全绿；⑤ 预期内红）。
 * @param {{skillDir:string, classroomDir:string, outDir:string}} opts
 */
export function runSkillSelfCheck(opts) {
  const out = runOneValidate({
    role: 'workspace-source',
    skillDir: opts.skillDir,
    classroomArg: opts.classroomDir,
    outDir: opts.outDir,
    filePrefix: 'skill-validate',
  })
  // 兼容原有字段名（ACCEPT-3 起的调用方与报告都在用）
  return {
    ok: out.ok,
    exitCode: out.exitCode,
    skillDir: out.skillDir,
    classroomDir: out.classroomDir,
    validateSha256: out.validateSha256,
    skillTreeSha256: null,
    bySection: out.bySection,
    discoveryProblems: out.discoveryProblems,
    otherProblems: out.otherProblems,
    verdict: out.verdict,
    detail: out.detail,
    stdoutFile: out.stdoutFile,
    stderrFile: out.stderrFile,
    note: out.note,
    unchangedAfterSelfCheck: out.unchangedAfterSelfCheck,
    tree: out.tree,
  }
}

/**
 * 跑**已装副本**自检 → **判发现链路**（应当 exit 0 全绿）。
 * 🔴 只读：不装、不改、不复制；跑前跑后逐文件 sha256 一致（不一致即失败）。
 * 🔴 未安装 → `verdict='not-installed'`、`applicable=false`，**显式报告"该检查跳过"**（不静默）。
 *
 * @param {{dshHome:string, outDir:string}} opts
 * @returns {{
 *   applicable:boolean, ok:boolean|null, installedDir:string, verdict:string, exitCode:number|null,
 *   detail:string, identicalToSource:boolean|null, sourceDiff:string[], ...
 * }}
 */
export function runInstalledSkillSelfCheck(opts) {
  const { dshHome, outDir } = opts
  const installedDir = join(dshHome, INSTALLED_SKILL_REL)
  const reportFile = join(outDir, 'skill-installed-result.json')
  if (!existsSync(installedDir)) {
    const out = {
      applicable: false,
      ok: null,
      installedDir,
      verdict: 'not-installed',
      exitCode: null,
      detail:
        `⚠️ **未安装、该检查跳过**：${installedDir} 不存在 → 本机没有可判"发现链路"的已装副本。` +
        `🔴 这不是"通过"，是"**没验**"：源包那一跑只能判内容（①–④），` +
        `"宿主能不能发现这个技能"这一半**本次没有得到验证**（要验就得把包复制进扫描根 —— 那是用户环境，本流水线不做）。`,
      note: EXIT_CODE_NOTE,
    }
    writeJson(reportFile, { at: new Date().toISOString(), ...out })
    return out
  }
  const out = runOneValidate({
    role: 'installed-copy',
    skillDir: installedDir,
    classroomArg: null, // 查它**自带**的 classroom 副本（validate 的默认行为）
    outDir,
    filePrefix: 'skill-installed-validate',
  })
  const result = {
    applicable: true,
    ok: out.ok,
    installedDir,
    verdict: out.verdict,
    exitCode: out.exitCode,
    detail: out.detail,
    discoveryProblems: out.discoveryProblems,
    otherProblems: out.otherProblems,
    validateSha256: out.validateSha256,
    unchangedAfterSelfCheck: out.unchangedAfterSelfCheck,
    stdoutFile: out.stdoutFile,
    note: out.note,
    tree: out.tree,
  }
  writeJson(reportFile, { at: new Date().toISOString(), ...result })
  return result
}

/**
 * 比对"源包 ↔ 已装副本"的逐文件 sha256（回答"已装的那份是不是就是源包那份"）。
 * @returns {{compared:boolean, identical:boolean|null, onlyInSource:string[], onlyInInstalled:string[], differing:string[], note:string}}
 */
export function compareSkillCopies(sourceDir, installedDir) {
  if (!existsSync(sourceDir) || !existsSync(installedDir)) {
    return {
      compared: false,
      identical: null,
      onlyInSource: [],
      onlyInInstalled: [],
      differing: [],
      note: '有一份不存在 → 没得比（源包或已装副本缺）',
    }
  }
  const a = hashTree(sourceDir).map
  const b = hashTree(installedDir).map
  const onlyInSource = Object.keys(a).filter((rel) => !(rel in b)).sort()
  const onlyInInstalled = Object.keys(b).filter((rel) => !(rel in a)).sort()
  const differing = Object.keys(a)
    .filter((rel) => rel in b && a[rel].sha256 !== b[rel].sha256)
    .sort()
  const identical = onlyInSource.length === 0 && onlyInInstalled.length === 0 && differing.length === 0
  return {
    compared: true,
    identical,
    onlyInSource,
    onlyInInstalled,
    differing,
    note:
      '逐文件 sha256 比对（不依赖 mtime/inode）。两份**逐字节相同**时 `identical=true`；' +
      '不同则列出只在源包/只在已装副本/内容不同的文件，供人判"要不要同步"。',
  }
}

/** 把技能包自检结论渲染成人读的一段（进结论文件与报告）。 */
export function renderSkillCheckRow(check) {
  const icon = check.ok ? (check.verdict === 'green' ? '✅' : '🟡') : '❌'
  return `${icon} 技能包自检（socratic-classroom/validate）：exit ${check.exitCode}，判定 \`${check.verdict}\` — ${check.detail}`
}

/** 把"已装副本"那一跑的结论渲染成人读的一段。 */
export function renderInstalledSkillRow(check) {
  if (check === null || check === undefined) return '❌ 已装副本自检**没有结果**（阶段②未产出）'
  if (!check.applicable) return `⚠️ ${check.detail}`
  const icon = check.ok ? '✅' : '❌'
  return (
    `${icon} 已装副本自检（\`$DSH_HOME/skills/socratic-classroom\`，判**发现链路**）：` +
    `exit ${check.exitCode}，判定 \`${check.verdict}\` — ${check.detail}`
  )
}

/** 读回已落盘的技能包自检证据（阶段⑤ 复核用）。 */
export function readSkillCheck(outDir) {
  const file = join(outDir, 'skill-validate.json')
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8'))
}
