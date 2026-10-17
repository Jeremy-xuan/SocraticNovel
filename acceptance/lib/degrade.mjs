// lib/degrade.mjs — ACCEPT-4：显式降级（关教室动画）的**跨运行**固定位置留痕
//
// 🔴 为什么要有它：`--disable-classroom-animation --animation-disable-reason "…"` 的留痕
//   原来只落在**本次运行目录**里（`runs/<ts>/03-session/attempt-N/animation-disable.json`）。
//   而"过去一周我们悄悄关过几次动画"这种问题，要**跨运行**才答得上来 —— 翻 15 个 run 目录
//   不是检索，是体力活。
//   → 除本次运行目录那一份（证据本体，不动）外，**另写一份固定位置的追加文件**：
//     `acceptance/降级留痕.md`，**每条一行**（markdown 表格行，一行一条）：
//     时间／模式／理由／删了哪几行／删前后 sha256／本次 run 目录。
//
// 🔴 三条纪律：
//   ① **追加，不重写**：已有行一个字都不动（跨运行的历史不能被下一次运行抹掉）；
//   ② **一行一条**：便于 `grep '^| 2026-' 降级留痕.md | wc -l` 这类一眼检索；
//   ③ **表头只写一次**：首次创建时写，之后只追加数据行。
//
// ⚠️ 未执行删除的路径（`--skip-session`：不跑会话 → 没有教室工作副本 → 没有删除动作）
//   也会记一行，但"删了哪几行"与两个哈希写 `未执行`，并在模式列写明 —— **不许静默不记**
//   （"这次运行申请了降级"这件事本身就是跨运行要知道的）。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ledgerAppendFile } from './footprint.mjs'

export const DEGRADE_LEDGER_NAME = '降级留痕.md'

export const DEGRADE_LEDGER_HEADER = [
  '# 显式降级留痕（跨运行 · 一行一次）',
  '',
  '> 由 `acceptance/run.sh --disable-classroom-animation --animation-disable-reason "<理由>"` 追加。',
  '> **一次运行一行**；本文件只追加、不重写（历史行一个字都不动）。',
  '> 关掉教室动画是**显式降级**，不是静默跳过：理由必填，删了哪几行与删前后 sha256 逐次留痕。',
  '> 检索示例：`grep -c "^| 2026-" 降级留痕.md`（累计次数）｜`grep "^| 2026-" 降级留痕.md | tail -5`（最近 5 次）。',
  '',
  '| 时间 | 模式 | 理由 | 删了哪几行 | 删前 sha256 | 删后 sha256 | 本次 run 目录 |',
  '|---|---|---|---|---|---|---|',
  '',
].join('\n')

/** 表格单元格里不许出现 `|` 或换行（会破坏"一行一条"）。 */
function cell(value) {
  const s = value === null || value === undefined ? '<无>' : String(value)
  return s.replaceAll('|', '\\|').replaceAll('\n', ' ').trim() || '<空>'
}

/**
 * 追加一行降级留痕。
 *
 * @param {{
 *   acceptanceDir:string,                 // acceptance/
 *   runDir:string,                        // 本次运行目录
 *   mode:'full'|'skip-session',           // 本次走的是哪条路径
 *   reason:string,                        // 人给的降级理由（必填，上游已校验非空）
 *   disable:object|null,                  // disableClassroomAnimation 的返回值（未执行删除时为 null）
 * }} opts
 * @returns {{ok:boolean, file:string, row:string, line:string, totalRows:number|null, error?:string}}
 */
export function appendDegradeLedger(opts) {
  const { acceptanceDir, runDir, mode, reason, disable } = opts
  const file = join(acceptanceDir, DEGRADE_LEDGER_NAME)
  const existed = existsSync(file)

  const deleted =
    disable === null
      ? '未执行（本路径没有教室工作副本）'
      : `第 ${disable.before?.firstLine}–${disable.before?.lastLine} 行（${disable.before?.lines} 行）`
  const before = disable?.sha256Before ?? '未执行'
  const after = disable?.sha256After ?? '未执行'

  const row = [
    '',
    new Date().toISOString(),
    mode === 'skip-session' ? '--skip-session' : '完整跑',
    reason,
    deleted,
    before === '未执行' ? before : `${String(before).slice(0, 16)}…`,
    after === '未执行' ? after : `${String(after).slice(0, 16)}…`,
    runDir,
    '',
  ]
  const line = `| ${row.slice(1, -1).map(cell).join(' | ')} |`
  try {
    if (!existed) ledgerAppendFile(file, DEGRADE_LEDGER_HEADER, { source: 'lib/degrade.mjs 首次创建' })
    ledgerAppendFile(file, `${line}\n`, { source: 'lib/degrade.mjs 追加一行降级留痕' })
  } catch (error) {
    return { ok: false, file, row: line, line, totalRows: null, error: String(error?.message ?? error) }
  }
  const rows = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => /^\|\s*20\d\d-/.test(l)).length
  return { ok: true, file, row: line, line, totalRows: rows }
}
