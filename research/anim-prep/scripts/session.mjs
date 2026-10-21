// scripts/session.mjs — anim-prep 实验用的**会话驱动与事件流解析**（共享件，不自己造两套）。
//
// 口径（照抄 ANIM-ORCH 的 measure/exp1_script_time.mjs，不重复推导）：
//   · 被测对象＝真实教学会话里的模型（`socratic-headless` profile，教室＝**cs-os 的副本**，
//     cwd＝副本目录 → 教室自己的 AGENTS.md 被宿主按正常规则注入）。**绝不写真教室**。
//   · 计时来源＝宿主自己落盘的会话事件流（`turn/start` / `tool/call` / `assistant/message` 的
//     `time` 字段），不是我自述的墙钟。
//
// 🔴 本文件会真实调用 LLM（每次一条长回答）；不写任何教室真文件（只写 /tmp 副本）。

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DSH_HOME = process.env.DSH_HOME ?? join(process.env.HOME, 'Library/Application Support/dsh-desktop/harness')
export const DSH_BIN =
  process.env.DSH_BIN ?? '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js'

const here = dirname(fileURLToPath(import.meta.url))
export const toolRoot = resolve(here, '..')
export const repoRoot = resolve(toolRoot, '../../..') // 开源线/DSH定制
export const CLASSROOM_SRC = join(repoRoot, 'code', 'classrooms', 'cs-os')
export const MANIM_ENV = join(repoRoot, 'poc_动画可写性', 'env')
export const EVIDENCE = join(toolRoot, 'evidence')

export function listSessionLogs() {
  const out = new Map()
  const root = join(DSH_HOME, 'sessions')
  let buckets = []
  try {
    buckets = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())
  } catch {
    return out
  }
  for (const b of buckets) {
    const bp = join(root, b.name)
    let dirs = []
    try {
      dirs = readdirSync(bp, { withFileTypes: true }).filter((e) => e.isDirectory())
    } catch {
      continue
    }
    for (const d of dirs) {
      const full = join(bp, d.name)
      let files = []
      try {
        files = readdirSync(full)
      } catch {
        continue
      }
      for (const f of files) {
        if (/^session\..*\.jsonl\.zstd$/.test(f)) {
          try {
            out.set(join(full, f), statSync(join(full, f)).mtimeMs)
          } catch {
            /* 并发写时可能读不到 */
          }
        }
      }
    }
  }
  return out
}

/** 解压会话日志为事件数组。 */
export function readEvents(file) {
  const raw = execFileSync('zstd', ['-dc', file], { maxBuffer: 1024 * 1024 * 512 }).toString('utf8')
  const events = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (t === '' || !t.startsWith('{')) continue
    try {
      events.push(JSON.parse(t))
    } catch {
      /* 半行（写到一半）跳过 */
    }
  }
  return events
}

/**
 * 从事件流里抽出一次会话的时间线（全部相对 `turn/start`）。
 * @param {object[]} events
 */
export function timelineOf(events) {
  const all = (type, pred = () => true) => events.filter((e) => e.type === type && pred(e))
  const at = (type, pred = () => true) => events.find((e) => e.type === type && pred(e))
  const turnStart = at('turn/start')
  const t0 = turnStart?.time ?? null
  const rel = (e) => (e && typeof e.time === 'number' && t0 !== null ? e.time - t0 : null)
  const toolCalls = all('tool/call')
  const firstAssistant = at('assistant/message')
  const turnEnd = at('turn/end')
  const injections = all('user/message', (e) => e.data?.source?.kind === 'socratic-engine')
  return {
    t0,
    t_turn_start: turnStart?.time ?? null,
    ms_to_first_assistant: rel(firstAssistant),
    ms_to_turn_end: rel(turnEnd),
    steps: all('step/start').length,
    toolCalls: toolCalls.map((e) => {
      const data = e.data ?? {}
      const name = data.name ?? data.toolName ?? '?'
      // 🔴 字段名是 `arguments`（**JSON 字符串**，不是对象）——实测逐字见
      //    `session.v3.jsonl` 的 `{"type":"tool/call","data":{"name":"read","arguments":"{...}"}}`。
      //    一开始按 `args`/`input` 取，结果 argChars 全是 null（本批踩过一次）。
      const raw = data.arguments ?? data.args ?? data.input ?? null
      const argChars = typeof raw === 'string' ? raw.length : raw === null ? null : JSON.stringify(raw).length
      return { name, atMs: rel(e), argChars, raw: typeof raw === 'string' ? raw : null }
    }),
    toolNames: toolCalls.map((e) => e.data?.name ?? e.data?.toolName ?? '?'),
    turnEndReason: turnEnd?.data?.reason?.kind ?? null,
    injections: injections.map((e) => ({
      form: e.data?.source?.form ?? null,
      block: e.data?.source?.block ?? null,
      atMs: rel(e),
    })),
  }
}

/** 造一个教室副本（rsync -a；绝不写真教室）。 */
export function makeClassroomCopy(workDir, extraFiles = {}) {
  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(workDir, { recursive: true })
  const classroom = join(workDir, 'classroom')
  execFileSync('rsync', ['-a', `${CLASSROOM_SRC}/`, `${classroom}/`])
  for (const [rel, content] of Object.entries(extraFiles)) {
    const file = join(classroom, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  return classroom
}

/** 写 patch（把引擎的教室指到副本；渲染器路径来自部署配置）。 */
export function writePatch(workDir, { classroom, animation = true, extraLines = [] }) {
  const lines = ['# anim-prep 实验 patch：教室指到副本（绝不指真教室）。', '- id: socratic-engine', '  config:', `    classroomDir: ${classroom}`]
  if (animation) {
    lines.push(
      '    animation:',
      `      python: ${join(MANIM_ENV, 'bin', 'python')}`,
      `      manim: ${join(MANIM_ENV, 'bin', 'manim')}`,
      '      quality: l',
    )
  }
  lines.push(...extraLines, '')
  const patchPath = join(workDir, 'patch.yml')
  writeFileSync(patchPath, lines.join('\n'))
  return patchPath
}

/**
 * 跑一次 headless 会话（单轮）。返回原始事实（含会话日志路径）。
 */
export async function runSession({ workDir, patchPath, task, cwd, env = {}, timeoutMs = 600000 }) {
  const before = listSessionLogs()
  const t0 = Date.now()
  const child = spawn(process.execPath, [DSH_BIN, '--profile', 'socratic-headless', '--patch', patchPath, task], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (c) => (stdout += c.toString()))
  child.stderr.on('data', (c) => (stderr += c.toString()))
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
  const code = await new Promise((r) => child.on('close', r))
  clearTimeout(timer)
  const wallMs = Date.now() - t0

  const after = listSessionLogs()
  let logFile = null
  let newest = -1
  for (const [f, m] of after) {
    if (before.has(f)) continue
    if (m > newest) {
      newest = m
      logFile = f
    }
  }
  let timeline = null
  let events = null
  if (logFile !== null) {
    events = readEvents(logFile)
    timeline = timelineOf(events)
  }
  mkdirSync(join(workDir, 'session'), { recursive: true })
  writeFileSync(join(workDir, 'session', 'stdout.txt'), stdout)
  writeFileSync(join(workDir, 'session', 'stderr.txt'), stderr)
  return { code, wallMs, logFile, timeline, events, stdout, stderr, t0 }
}

/** 从事件流里捞出某次 tool/call 的完整入参（用来量"模型到底吐了多少字"）。 */
export function toolCallArgs(events, name) {
  const call = events.find((e) => e.type === 'tool/call' && (e.data?.name ?? e.data?.toolName) === name)
  if (call === undefined) return null
  const raw = call.data?.arguments ?? call.data?.args ?? call.data?.input ?? null
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/**
 * 找 manim 渲出来的 mp4。
 * 🔴 目录名是**脚本文件名**（`scene.py` → `videos/scene/480p15/`），不是 `-o` 给的输出名——
 *    一开始按 `-o a.mp4` 猜成 `videos/a/480p15/a.mp4`，于是"渲成功了却判成没渲出来"（本批踩过一次）。
 */
export function findMp4(mediaDir) {
  const videos = join(mediaDir, 'videos')
  if (!existsSync(videos)) return null
  for (const scriptName of readdirSync(videos)) {
    const res = join(videos, scriptName)
    if (!statSync(res).isDirectory()) continue
    for (const quality of readdirSync(res)) {
      const qdir = join(res, quality)
      if (!statSync(qdir).isDirectory()) continue
      for (const f of readdirSync(qdir)) {
        if (f.endsWith('.mp4')) return join(qdir, f)
      }
    }
  }
  return null
}

/** 把某次会话的引擎日志行捞出来（装载/预热/注入的轨迹都在里面）。 */
export function engineLogLines(stderr) {
  return stderr
    .split('\n')
    .filter((l) => l.includes('[socratic-engine]') || l.includes('[anim-driver]') || l.includes('[socratic-anim'))
}
