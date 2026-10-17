// lib/whitelist.mjs — 「宿主告警归属白名单」（ACCEPT-2 新增）
//
// 为什么有这个文件：日志桥修好之后，宿主在验收会话里打出的 error/warn 第一次变得可见
//   （实测 17 条，见外部取证件《宿主告警排查 2026-09-24》）。
//   可见之后必须变成**断言**，否则"没人会去看"。断言的形式是：
//   **出现一条不在本白名单里的 error/warn → 验收判失败。**
//
// 🔴 白名单纪律（这是本文件的全部意义，违反即失败）：
//   1. **每一条都必须写明"为什么它不是我们的问题"**，并指向取证件（逐条见下 rules 的 reason）。
//   2. **不许"凡是看不懂的就加白"**：判不出来的一律不加，让它红——红是特性，不是故障。
//   3. **按"模块名前缀"或"路径前缀"匹配，绝不按整句文本匹配**：
//      文案改一个字就漂的白名单＝假白名单（取证件里 17 条文本是逐字抄的，
//      但那是**取证**用的，不是**匹配**用的）。
//   4. 匹配必须**窄**：例如 `skill-filesystem` 只白 `~/.agents/skills/` 下的路径——
//      如果哪天被忽略的是**我们自己**的技能包（`<仓库>/skills/…`），
//      它必须**红**，不能被这条规则吞掉。
//
// 取证件（**外部文档，未随本仓库分发**）：《宿主告警排查 2026-09-24》
//   · §1   17 条逐字原文（sn / 级别 / 模块名 / 原文）
//   · §2.1 逐条归属与影响判定
//   · §2.2 归属汇总（3 探针 / 1 用户配置 / 10 第三方技能 / 3 宿主自身 / 我们的技能包 0 条）
//   · §3.4 为什么我们的技能包不出现在告警里（"没被扫到"≠"被忽略"）

import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 我们自己的验收探针的模块名前缀。
 *
 * 🔴 为什么写这么"长"（不是 `[socratic-accept-probe` 一刀切）：
 *   本模块的负向对照探针叫 `[socratic-accept-probe:negative-control]`，
 *   它的**全部意义**就是"不被白名单覆盖 → A6.5 判失败"。
 *   如果按 `[socratic-accept-probe` 前缀一刀切，负向对照会被自己的白名单吞掉
 *   （实测踩到：白名单自检因此红）。→ 只白**正向对照**那一个确切名字，
 *   将来任何**新的**探针名都必须走"写明理由后显式加白"这条路。
 */
export const OWN_PROBE_PREFIXES = ['[socratic-accept-probe:positive-control', '[socratic-engine]:shape-control']

/**
 * 用户级第三方技能目录的路径前缀（**两种写法都认**）。
 * 取证 #5–#14 的原文是**展开形式**（`<家目录>/.agents/skills/…`，取证当时记的是那台机器的家目录）；
 * 这里同时接受 `~/.agents/skills/` 写法，便于在别的机器/别的用户名下复用。
 */
export function userSkillPathPrefixes() {
  return [join(homedir(), '.agents', 'skills') + '/', '~/.agents/skills/']
}

/** 把消息的 args 拍平成一段可搜索文本（对象走 JSON，Error 取 message+stack）。 */
export function argsText(message) {
  const args = Array.isArray(message?.args) ? message.args : []
  return args
    .map((a) => {
      if (a === null || a === undefined) return ''
      if (typeof a === 'string') return a
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join('\n')
}

/** 某个 args 里是否出现了用户级第三方技能目录前缀。 */
export function hasUserSkillPath(message) {
  const text = argsText(message)
  return userSkillPathPrefixes().some((prefix) => text.includes(prefix))
}

/** 模块名是否以给定前缀之一开头。 */
export function nameHasPrefix(message, prefixes) {
  const name = typeof message?.name === 'string' ? message.name : ''
  return prefixes.some((prefix) => name.startsWith(prefix))
}

/**
 * 白名单规则表。顺序＝匹配顺序（从窄到宽）。
 * 每条：{ id, why, source, test(message) → boolean }
 *
 * 🔴 `why` 是**必须写**的：它回答"为什么这条不是我们的问题"，并给出取证依据。
 */
export const RULES = [
  {
    id: 'own-probe',
    why:
      '我们自己的验收探针（**正向对照**）：原文自带"应当出现在日志桥里／应当被丢掉"，它出现＝日志桥按预期工作（A6.1/A6.2 的正向对照）。' +
      '按**模块名前缀**匹配（不按整句文本），文案改了也不会漂；且前缀只覆盖"正向对照"这一个确切名字——' +
      '负向对照探针 `[socratic-accept-probe:negative-control]` **刻意不在白名单里**（它就是要让 A6.5 红）。',
    source: '外部取证件《宿主告警排查 2026-09-24》§1.1、§2.1 第 1–3 行',
    test: (message) => nameHasPrefix(message, OWN_PROBE_PREFIXES),
  },
  {
    id: 'user-level-third-party-skill',
    why:
      '用户级第三方技能的**历史坏文件**：被忽略的路径都在 `~/.agents/skills/` 下（缺 frontmatter／name 非法／YAML 语法错），' +
      '一条都不指向本项目的技能包。按**路径前缀**匹配，且要求模块名是 `skill-filesystem`；' +
      '若被忽略的是我们自己的包（路径在仓库内），本规则**不会**命中 → 仍然会红。',
    source: '外部取证件《宿主告警排查 2026-09-24》§1 第 5–14 条、§2.2 第 3 行',
    test: (message) => {
      const name = typeof message?.name === 'string' ? message.name : ''
      return name === 'skill-filesystem' && hasUserSkillPath(message)
    },
  },
  {
    id: 'user-config-permission-preset',
    why:
      '用户环境配置（`$DSH_HOME/settings.yaml` 的 `permission.defaultPreset: full-access-ask` 不是合法预设名）。' +
      '它属于**用户自己的环境**，修不修、怎么修由用户决定，**不该让我们的验收变红**。',
    source: '外部取证件《宿主告警排查 2026-09-24》§1 第 4 条、§4',
    test: (message) => nameHasPrefix(message, ['permission-preset-service']),
  },
  {
    id: 'host-self-session-title',
    why:
      '宿主自身：自动生成会话标题失败（输出撞 `maxOutputTokens`）。会话照常可用，只是标题没自动生成；' +
      '与本项目交付链路无关，也不可被我们修。',
    source: '外部取证件《宿主告警排查 2026-09-24》§2.1 第 15 行',
    test: (message) => nameHasPrefix(message, ['session-title-service']),
  },
  {
    id: 'host-self-subprocess-containment',
    why:
      '宿主自身：macOS 没有"持久进程范围属主"→ 子进程树强隔离弱化的**平台限制自述**。' +
      '是宿主运行时对平台能力的声明，不是我们的代码/配置引起的。',
    source: '外部取证件《宿主告警排查 2026-09-24》§2.1 第 16 行',
    test: (message) => nameHasPrefix(message, ['local-subprocess-runtime']),
  },
  {
    id: 'host-self-goal-round-driver',
    why:
      '宿主自身：解除某 agent 的 goal 时发现 goal projection 未注册 → 解除动作没生效。' +
      '不改变交付物正确性；消息文本自带 `goal-round-driver:` 前缀，故 name 与 args 两处都按前缀认。',
    source: '外部取证件《宿主告警排查 2026-09-24》§2.1 第 17 行',
    test: (message) => nameHasPrefix(message, ['goal-round-driver']) || argsText(message).includes('goal-round-driver:'),
  },
]

/** 一条消息是否属于"需要断言的级别"（error/warn）。 */
export function isProblemMessage(message) {
  return message?.type === 'error' || message?.type === 'warn'
}

/**
 * 给一条日志消息判归属。
 * @returns {{whitelisted:boolean, ruleId:string|null, why:string|null, source:string|null}}
 */
export function classify(message) {
  for (const rule of RULES) {
    if (rule.test(message)) return { whitelisted: true, ruleId: rule.id, why: rule.why, source: rule.source }
  }
  return { whitelisted: false, ruleId: null, why: null, source: null }
}

/**
 * 给一批日志消息做归属汇总（**只判 error/warn**，info/debug 不算问题消息）。
 *
 * @param {Array<object>} messages - 日志桥落盘的消息数组（cordis-log.jsonl 的每一行）
 * @returns {{
 *   totalMessages:number, problemMessages:number,
 *   whitelisted:number, unmatched:number,
 *   matchedRules:Array<{ruleId:string,count:number,why:string,source:string}>,
 *   unmatchedMessages:Array<object>,
 *   staleRules:Array<{ruleId:string,why:string,source:string}>,
 *   byName:Record<string,number>
 * }}
 */
export function classifyAll(messages) {
  const list = Array.isArray(messages) ? messages : []
  const problems = list.filter(isProblemMessage)

  const counts = new Map()
  const unmatched = []
  const byName = {}
  for (const message of problems) {
    const verdict = classify(message)
    const name = typeof message?.name === 'string' ? message.name : '(无名)'
    byName[name] = (byName[name] ?? 0) + 1
    if (verdict.whitelisted) counts.set(verdict.ruleId, (counts.get(verdict.ruleId) ?? 0) + 1)
    else unmatched.push({ sn: message?.sn ?? null, type: message?.type ?? null, name, argsText: argsText(message).slice(0, 600) })
  }

  const matchedRules = RULES.filter((r) => counts.has(r.id)).map((r) => ({
    ruleId: r.id,
    count: counts.get(r.id),
    why: r.why,
    source: r.source,
  }))
  // 🔴 没被命中的规则＝白名单可能已经过期（宿主改了名/路径），必须摆出来让人看见
  const staleRules = RULES.filter((r) => !counts.has(r.id)).map((r) => ({ ruleId: r.id, why: r.why, source: r.source }))

  return {
    totalMessages: list.length,
    problemMessages: problems.length,
    whitelisted: problems.length - unmatched.length,
    unmatched: unmatched.length,
    matchedRules,
    unmatchedMessages: unmatched,
    staleRules,
    byName,
  }
}

/** 把归属汇总渲染成给人看的一段文本（用于 detail / 报告）。 */
export function renderSummary(summary) {
  const parts = [
    `日志桥共收 ${summary.totalMessages} 条，其中 error/warn ${summary.problemMessages} 条；` +
      `白名单内 ${summary.whitelisted} 条、**不在白名单 ${summary.unmatched} 条**`,
  ]
  if (summary.matchedRules.length > 0) {
    parts.push(`命中的白名单规则：${summary.matchedRules.map((r) => `${r.ruleId}×${r.count}`).join('、')}`)
  }
  if (summary.staleRules.length > 0) {
    parts.push(`⚠️ 本次未被命中的白名单规则（可能已过期，请复核）：${summary.staleRules.map((r) => r.ruleId).join('、')}`)
  }
  if (summary.unmatched > 0) {
    parts.push(
      `不在白名单的条目：` +
        summary.unmatchedMessages
          .map((m) => `${m.type} ${m.name} :: ${m.argsText.replace(/\s+/g, ' ').slice(0, 160)}`)
          .join(' ｜ '),
    )
  }
  return parts.join('；')
}

/** 供自检脚本用：白名单规则的静态清单（不含 test 函数）。 */
export function ruleCatalog() {
  return RULES.map((r) => ({ id: r.id, why: r.why, source: r.source }))
}
