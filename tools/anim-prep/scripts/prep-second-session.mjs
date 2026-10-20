// scripts/prep-second-session.mjs — 验证"同一个动画只生成一次"的**跨会话**那一半。
//
// 场景：`prep-session.mjs` 已经在那份教室副本里预热好了第 3 讲的两段动画（盘上有 ready 的 status.json）。
// 现在**另起一次真实会话**（新进程、新 sessionId，＝下一节课），老师照样按清单取用 ——
// 应当**命中缓存**：盘上不新增任何任务目录、不重新渲染。
//
// 🔴 与 `prep-session.mjs` 的分工：那个验的是"预热 → 同一次会话内取用"；
//    这个验的是"**上一个进程预热好的，下一个进程直接命中**"（缓存键落在盘上，不靠内存）。
//
// 用法：/opt/homebrew/bin/node scripts/prep-second-session.mjs
// 产物：evidence/prep-second-session.json

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EVIDENCE, engineLogLines, repoRoot, runSession, toolCallArgs, writePatch } from './session.mjs'

const WORK = join(tmpdir(), 'animprep-prep-session')
const prior = JSON.parse(readFileSync(join(EVIDENCE, 'prep-session.json'), 'utf8'))
const classroom = prior.classroomCopy
if (!existsSync(join(classroom, 'classroom.yaml'))) {
  throw new Error(`先跑一次 scripts/prep-session.mjs（副本不在：${classroom}）`)
}
const GATE = join(repoRoot, 'code', 'tools', 'animation-gate', 'animation_gate.py')
const animRoot = join(classroom, 'runtime', 'animations')
const before = new Set(readdirSync(animRoot))
console.log(`[prep2] 复用副本 ${classroom}；盘上已有任务目录 ${before.size} 个`)

const patchPath = writePatch(WORK, {
  classroom,
  animation: true,
  extraLines: [
    `      gate: ${GATE}`,
    `      gatePython: ${join(repoRoot, 'poc_动画可写性', 'env', 'bin', 'python')}`,
  ],
})
const task =
  '继续第 3 讲。学生问：「那如果换成最短作业优先，平均周转时间会变成多少？」请按你的教学判断讲这一小段。'
const session = await runSession({ workDir: join(WORK, 'session-run2'), patchPath, task, cwd: classroom })
const toolArgs = toolCallArgs(session.events ?? [], 'classroom_animate_template')
const newTaskDirs = readdirSync(animRoot).filter((n) => !before.has(n))
console.log(
  `[prep2] 会话 exit=${session.code} 墙钟=${(session.wallMs / 1000).toFixed(1)}s｜` +
    `工具调用=${(session.timeline?.toolNames ?? []).join(',')}｜新增任务目录=${newTaskDirs.length}`,
)
console.log(`[prep2] 引擎日志：\n${engineLogLines(session.stderr).join('\n')}`)

mkdirSync(EVIDENCE, { recursive: true })
const out = {
  generatedAt: new Date().toISOString(),
  classroomCopy: classroom,
  taskDirsBefore: [...before],
  session: {
    exit: session.code,
    wallMs: session.wallMs,
    logFile: session.logFile,
    toolNames: session.timeline?.toolNames ?? [],
    toolCalls: session.timeline?.toolCalls ?? [],
    injections: session.timeline?.injections ?? [],
    ms_to_first_assistant: session.timeline?.ms_to_first_assistant ?? null,
    templateArgs: toolArgs,
    newTaskDirs,
    engineLog: engineLogLines(session.stderr),
    stderrTail: session.stderr.slice(-1200),
  },
}
writeFileSync(join(EVIDENCE, 'prep-second-session.json'), JSON.stringify(out, null, 2))
console.log('[prep2] 已落盘 evidence/prep-second-session.json')
