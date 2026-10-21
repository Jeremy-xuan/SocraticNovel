// lib/diagramstore.mjs — 板书图的**落盘层**：写 .mmd 源文件 + 追加人读索引。
//
// 落点（写死，见 index.mjs 的 classroom_draw 工具）：
//   <教室目录>/runtime/diagrams/<文件名>.mmd   ← 文件内容 = 校验通过的 mermaid 源码（末尾补一个换行）
//   <教室目录>/runtime/diagrams/index.md       ← 索引：一行一张图（日期／讲次／回合／类型／标题／源文件）
//
// 为什么另开一个子目录而不是塞进 runtime/ 根：教室既有 runtime/ 的 8 个文件是**状态文件**
//   （progress / learner_profile / mistake_log / …），每个都被 classroom.yaml 声明为注入块；
//   板书图是**产物**不是状态，混进去会让人误以为它们也要被注入。索引文件用 markdown + 表格，
//   与既有 runtime/ 文件的写法（`# 标题` + `> 规则说明` + 表格）保持一致。
//
// 🔴 写入失败一律**抛出**（工具据此报错），绝不吞掉——"画了但没落盘"必须让模型知道。
//    对照：postclass.mjs 的课后更新吞错是**对的**（它是 turn 边界的旁路通知，抛错会打断整轮），
//    而 classroom_draw 是模型主动调用的工具，它报成功就必须真的写成了。
//
// 原子写：用宿主的 `@deepseek-ai/dsh-atomic-write`（临时文件 + rename + 文件锁），
//   与 lib/postclass.mjs 同一套；测试可注入 `io` 绕开宿主。

import { existsSync } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DIAGRAMS_SUBDIR,
  INDEX_FILE,
  appendIndexRow,
  boardRouteOf,
  boardSummary,
  checkDiagramArgs,
  diagramFileName,
  diagramIdOf,
  nowLabel,
  renderIndexRow,
  uniqueFileName,
} from './diagram.mjs'

/** 教室 runtime 文件的权限位（实测既有文件是 `-rw-------`，见 postclass.mjs）。 */
export const DEFAULT_FILE_MODE = 0o600

/** 宿主原子写包（动态 import：单测环境无宿主也能加载本模块）。 */
async function loadHostAtomicWrite() {
  const mod = await import('@deepseek-ai/dsh-atomic-write')
  if (typeof mod?.writeFileAtomic !== 'function' || typeof mod?.withFileLock !== 'function') {
    throw new Error('@deepseek-ai/dsh-atomic-write 未导出 writeFileAtomic/withFileLock')
  }
  return { writeFileAtomic: mod.writeFileAtomic, withFileLock: mod.withFileLock }
}

/**
 * 把一张校验通过的图落盘，并更新索引。**幂等性说明**：本函数不判重——
 * 同一张图重画两次就留两份（时间戳不同），这是有意的：板书图是**过程产物**，
 * 改写会让人看不出"当时画的是哪一版"。
 *
 * @param {{kind:string, source:string, title:string, caption:string, diagramType:string,
 *          lesson:number|null, turn:number, session?:string|null}} spec
 * @param {object} [opts]
 * @param {string} opts.runtimeDir - 教室 runtime/ 目录绝对路径
 * @param {{writeFileAtomic:Function, withFileLock:Function}} [opts.io] - 注入 IO（测试用）
 * @param {() => number} [opts.now] - 取当前时间（默认 Date.now）
 * @param {number} [opts.mode] - 写入权限位
 * @returns {Promise<{file:string, filePath:string, indexFile:string, indexPath:string,
 *                    timeLabel:string, bytes:number, rows:number}>}
 */
export async function saveDiagram(spec, opts = {}) {
  const runtimeDir = opts.runtimeDir
  if (typeof runtimeDir !== 'string' || runtimeDir === '') {
    throw new Error('saveDiagram 需要 runtimeDir（教室 runtime/ 目录绝对路径）')
  }
  const io = opts.io ?? (await loadHostAtomicWrite())
  const mode = opts.mode ?? DEFAULT_FILE_MODE
  const at = (opts.now ?? Date.now)()
  const dir = join(runtimeDir, DIAGRAMS_SUBDIR)
  await mkdir(dir, { recursive: true })

  const name = uniqueFileName(
    diagramFileName({ lesson: spec.lesson, turn: spec.turn, at, kind: spec.kind }),
    (candidate) => existsSync(join(dir, candidate)),
  )
  const filePath = join(dir, name)
  // 落盘内容 = 校验通过的源码原文；只补一个行尾换行（POSIX 文本文件约定），不改任何字符
  const content = spec.source.endsWith('\n') ? spec.source : `${spec.source}\n`
  await io.writeFileAtomic(filePath, content, { mode })

  const indexPath = join(dir, INDEX_FILE)
  // 🔴 W-e：索引多一列「会话」——回合号是**会话内**自增的（新会话从 1 重来），
  //    同一讲跨两次会话时，"哪些图属于本节课"必须靠 session 才分得清（见 lib/diagram.mjs 的注释）。
  const row = renderIndexRow({
    timeLabel: nowLabel(at),
    lesson: spec.lesson,
    turn: spec.turn,
    kind: spec.kind,
    title: spec.title,
    caption: spec.caption,
    file: name,
    session: spec.session ?? null,
  })
  let rows = 0
  await io.withFileLock(indexPath, async () => {
    let current = null
    try {
      current = await readFile(indexPath, 'utf8')
    } catch (cause) {
      if (cause?.code !== 'ENOENT') {
        throw new Error(`读索引失败：${indexPath}（${cause?.code ?? cause?.message ?? cause}）`)
      }
    }
    const next = appendIndexRow(current, row)
    await io.writeFileAtomic(indexPath, next, { mode })
    rows = next.split('\n').filter((l) => l.startsWith('| ') && !/^\|\s*-+/.test(l) && !l.startsWith('| 日期 ')).length
  })

  const info = await stat(filePath)
  const diagramId = diagramIdOf(name)
  const board = boardSummary({ diagramId, lesson: spec.lesson, turn: spec.turn, kind: spec.kind })
  return {
    file: `${DIAGRAMS_SUBDIR}/${name}`,
    filePath,
    indexFile: `${DIAGRAMS_SUBDIR}/${INDEX_FILE}`,
    indexPath,
    timeLabel: nowLabel(at),
    bytes: info.size,
    rows,
    diagramId,
    boardRoute: boardRouteOf(diagramId),
    board,
  }
}

/**
 * `classroom_draw` 工具的**编排主体**（校验 → 真解析 → 落盘）。
 *
 * 抽在这里而不是写在 index.mjs 的 execute 里，是为了让它**不依赖宿主**即可单测
 * （index.mjs 顶部要 import 宿主包，纯 node 跑不起来；本模块零宿主依赖）。
 *
 * 🔴 三段失败各自抛**面向模型**的错误（说清"期望什么"，模型下一轮能自己改）：
 *    ① 结构性校验不过 → 列出全部问题；
 *    ② 真解析不过 → 带上 mermaid 的报错原文与行号；
 *    ③ 解析器本身不可用 → 明确说"没有落盘"，绝不降级放行。
 *
 * @param {{kind?:unknown, source?:unknown, title?:unknown, caption?:unknown}} args - 模型给的入参
 * @param {object} env
 * @param {string} env.runtimeDir - 教室 runtime/ 目录绝对路径
 * @param {number|null} env.lesson - 本轮要讲的讲次（无讲次概念时 null）
 * @param {number} env.turn - 本会话回合号
 * @param {string|null} [env.session] - 宿主 session id（写进索引的「会话」列；取不到写 null）
 * @param {{parse:(source:string)=>Promise<{diagramType:string}>}} env.parser - 真解析器（lib/mermaid-parse.mjs 的产物）
 * @param {{writeFileAtomic:Function, withFileLock:Function}} [env.io] - 注入 IO（测试用）
 * @param {() => number} [env.now] - 取当前时间（测试用）
 * @returns {Promise<{file:string, indexFile:string, kind:string, diagramType:string, title:string,
 *                    lesson:number|null, turn:number, lines:number, bytes:number, rows:number, time:string,
 *                    diagramId:string, boardRoute:string,
 *                    board:{id:string, lesson:number, turn:number, kind:string}}>}
 */
export async function drawDiagram(args, env) {
  // ① 结构性校验（纯函数；一次报全）
  const check = checkDiagramArgs(args)
  if (!check.ok) {
    throw new Error(
      'classroom_draw 拒绝这次调用，什么都没有落盘。source 必须是完整的 mermaid 源码正文。\n- ' +
        check.problems.join('\n- '),
    )
  }
  // ② 真解析校验（权威判据：能不能渲染）
  let parsed
  try {
    parsed = await env.parser.parse(check.source)
  } catch (cause) {
    const reason = cause?.message ?? String(cause)
    throw new Error(
      'classroom_draw 拒绝这次调用，什么都没有落盘：这张图**渲染不出来**。\n' +
        `mermaid 解析器报错：${reason}\n` +
        '请按报错的行号改 source 后重画（首行必须是图类型关键字，如 "flowchart TD"；' +
        '节点文字写 A[文字]，连线写 A --> B，方括号/圆括号要成对）。',
    )
  }
  // ③ 落盘：源文件 + 索引追加
  let saved
  try {
    saved = await saveDiagram(
      {
        kind: check.kind,
        source: check.source,
        title: check.title,
        caption: check.caption,
        diagramType: parsed.diagramType,
        lesson: env.lesson ?? null,
        turn: env.turn,
        session: env.session ?? null,
      },
      { runtimeDir: env.runtimeDir, io: env.io, now: env.now },
    )
  } catch (cause) {
    const reason = cause?.message ?? String(cause)
    throw new Error(`classroom_draw 落盘失败（图没有写进教室 runtime/）：${reason}`)
  }
  return {
    file: saved.file,
    indexFile: saved.indexFile,
    kind: check.kind,
    diagramType: parsed.diagramType,
    title: check.title,
    lesson: env.lesson ?? null,
    turn: env.turn,
    lines: check.source.split('\n').length,
    bytes: saved.bytes,
    rows: saved.rows,
    time: saved.timeLabel,
    // 🔴 W-e（契约 K2.1）：图 id / 舞台读图路由 / 结构化板书事件，三样一起给
    diagramId: saved.diagramId,
    boardRoute: saved.boardRoute,
    board: saved.board,
  }
}
