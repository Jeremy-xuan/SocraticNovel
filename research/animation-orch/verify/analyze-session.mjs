// analyze-session.mjs — 把 ab-session 的落盘事件流拆成**端到端时间线**，算"学生实际等待时长"。
//
// 关键口径（写死，别改着凑）：
//   · **学生空窗** = 该回合 `turn/start` → 该回合**第一条带非空 text 的 assistant/message**。
//     🔴 只数 text，不数 reasoning（推理学生看不见），也不数"只有工具调用的 assistant 消息"。
//   · **动画就绪时刻** = 该任务 status.json 的 `finishedAt`（渲染器写的，不是自述）。
//   · **学生看到动画的时刻** = 就绪之后引擎第一条 `form: animation-notice` 的注入消息时刻。
//
// 用法：/opt/homebrew/bin/node verify/analyze-session.mjs
// 读：evidence/ab-a.json、evidence/ab-b.json；写：evidence/ab-timeline.json

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const toolRoot = resolve(here, '..')
const EVIDENCE = join(toolRoot, 'evidence')

function readEvents(file) {
  const raw = execFileSync('zstd', ['-dc', file], { maxBuffer: 1024 * 1024 * 512 }).toString('utf8')
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function textOf(event) {
  const content = event?.data?.message?.content ?? event?.data?.content ?? []
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b?.type === 'text')
    .map((b) => String(b.text ?? ''))
    .join('\n')
    .trim()
}

/** 读教室副本里 animations/ 下所有任务的状态（真实落盘文件，不是我记的）。 */
function readAnimationTasks(classroom) {
  const root = join(classroom, 'runtime', 'animations')
  if (!existsSync(root)) return []
  const out = []
  for (const name of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    const dir = join(root, name)
    const read = (f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf8'))
      } catch {
        return null
      }
    }
    out.push({ taskId: name, task: read('task.json'), status: read('status.json'), dir })
  }
  return out.sort((a, b) => a.taskId.localeCompare(b.taskId))
}

function analyze(key) {
  const meta = JSON.parse(readFileSync(join(EVIDENCE, `ab-${key}.json`), 'utf8'))
  const events = readEvents(meta.logFile)
  const turnStarts = events.filter((e) => e.type === 'turn/start')
  const turns = []
  for (const [i, ts] of turnStarts.entries()) {
    const next = turnStarts[i + 1]
    const inTurn = events.filter((e) => e.time >= ts.time && (next === undefined || e.time < next.time))
    const firstText = inTurn.find((e) => e.type === 'assistant/message' && textOf(e) !== '')
    const calls = inTurn.filter((e) => e.type === 'tool/call')
    const results = inTurn.filter((e) => e.type === 'tool/result')
    const injections = inTurn.filter((e) => e.type === 'user/message' && e.data?.source?.kind === 'socratic-engine')
    const end = inTurn.find((e) => e.type === 'turn/end')
    turns.push({
      turn: ts.data?.turn ?? i + 1,
      startMs: ts.time,
      firstStudentVisibleTextMs: firstText === undefined ? null : firstText.time - ts.time,
      firstStudentVisibleTextChars: firstText === undefined ? 0 : textOf(firstText).length,
      firstStudentVisibleTextHead: firstText === undefined ? '' : textOf(firstText).slice(0, 120),
      tools: calls.map((e, idx) => {
        // 🔴 工具**把学生挂住了多久** = tool/call → 它自己的 tool/result。
        //    这是"阻塞 vs 非阻塞"最直接的量：渲染器在后台跑时它应该只有几十毫秒。
        const result = results.find((r) => r.data?.callId !== undefined && r.data.callId === e.data?.callId)
          ?? results[idx]
        return {
          name: e.data?.name,
          atMs: e.time - ts.time,
          durationMs: result === undefined ? null : result.time - e.time,
          argHead: String(e.data?.arguments ?? '').slice(0, 90),
        }
      }),
      injections: injections.map((e) => ({
        form: e.data?.source?.form ?? null,
        block: e.data?.source?.block ?? null,
        atMs: e.time - ts.time,
        head: textOf(e).slice(0, 200),
      })),
      endMs: end === undefined ? null : end.time - ts.time,
      endReason: end?.data?.reason?.kind ?? null,
    })
  }
  return { key, mode: key.split('-')[0], question: meta.question ?? key.split('-')[1], logFile: meta.logFile, wallMs: meta.wallMs, exit: meta.exit, turns, animations: readAnimationTasks(meta.classroom) }
}

// 扫全部 ab-<mode>-<question>.json（本轮有两套点位：fifo / interrupt）
const KEYS = []
for (const f of readdirSync(EVIDENCE).filter((f) => /^ab-[ab]-[\w-]+\.json$/.test(f)).sort()) {
  KEYS.push(f.replace(/^ab-/, '').replace(/\.json$/, ''))
}
const out = { generatedAt: new Date().toISOString() }
for (const key of KEYS) out[key] = analyze(key)
writeFileSync(join(EVIDENCE, 'ab-timeline.json'), JSON.stringify(out, null, 2))

const s = (v) => (v === null || v === undefined ? 'n/a' : `${(v / 1000).toFixed(1)}s`)
for (const key of KEYS) {
  const r = out[key]
  if (r === null) {
    console.log(`\n=== ${key}：无数据 ===`)
    continue
  }
  console.log(`\n=== ${key}（exit=${r.exit}，进程墙钟 ${(r.wallMs / 1000).toFixed(1)}s）===`)
  for (const t of r.turns) {
    console.log(
      `  turn ${t.turn}：学生首次看到文字 = ${s(t.firstStudentVisibleTextMs)}（${t.firstStudentVisibleTextChars} 字）｜` +
        `回合结束 ${s(t.endMs)}（${t.endReason}）`,
    )
    for (const c of t.tools) {
      console.log(
        `     工具 ${c.name} @ ${s(c.atMs)}（占用 ${c.durationMs === null ? 'n/a' : `${c.durationMs} ms`}）  ${c.argHead}`,
      )
    }
    for (const inj of t.injections) {
      if (inj.form === 'animation-notice') console.log(`     🔔 动画通报 @ ${s(inj.atMs)}：${inj.head.replace(/\n/g, ' / ')}`)
    }
  }
  for (const a of r.animations) {
    console.log(
      `  动画任务 ${a.taskId}：state=${a.status?.state ?? '（无 status.json）'}` +
        `｜renderMs=${a.status?.renderMs ?? 'n/a'}｜durationSec=${a.status?.durationSec ?? 'n/a'}` +
        (a.status?.reason ? `｜reason=${a.status.reason}` : ''),
    )
  }
}
