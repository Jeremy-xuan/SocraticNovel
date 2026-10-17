// lib/prepstore.mjs — 「备课」的**运行层**：算缓存键 → 查缓存 → 批量预热 → 失败退路。
//
// 🔴 一句话说清这一层在干什么：
//   把"上课时老师现场等模型写脚本（实测 60.5–73.8 秒）"改成"**上课前**由引擎按课程数据
//   批量把片子渲好，上课时老师只是**取用**"。
//
// 三段（顺序固定）：
//   ① 缓存键：讲次 ＋ **教材内容哈希** ＋ 模板（含版本）＋ 参数（算法在 lib/prep.mjs）；
//   ② 查缓存：盘上已有同键且 state=ready 的任务 → **命中，0 秒**（不重渲）；
//   ③ 预热：没命中的按声明顺序起任务（复用 ANIM-ORCH 已有的非阻塞 detached 渲染器），
//      受同一个并发闸约束（超出就留在下一回合边界再起，不排队到看不见的地方）。
//
// 🔴 为什么"教材内容哈希"必须是**内容**哈希而不是 mtime：
//    本项目已有实证——`rsync -a` 会保留源 mtime，`git checkout` 也会改 mtime 而不改内容。
//    用 mtime 判"教材变没变"两个方向都会错（该重做的没重做 / 没变的白重做）。
//
// 🔴 失败退路（写死，不许静默）：
//   · 渲染失败（failed）／闸门判不通过（blocked）→ **不自动无限重试**；
//   · 同一个键最多自动起 MAX_PREP_ATTEMPTS(2) 次，第 2 次还不行 → 状态落 `give-up`，
//     并在回合开头的注入里明说"这段别等了，改用 classroom_draw"（老师有明确出路）；
//   · 计数从**盘上**数（同键的任务目录个数），不用内存计数——宿主重启后不会重新开始刷。
//
// 🔴 预热**不调用任何模型**：脚本由模板从参数拼出来（lib/animtemplates.mjs）。
//    这是它比"派子代理去写"强的地方——子代理写脚本仍要一次模型调用（就是那 60 秒的来源），
//    而模板路径的模型成本是 **0**（参数早就写在课程数据里了）。

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { MAX_CONCURRENT_TASKS, RUNNING_STATES, TERMINAL_STATES } from './animation.mjs'
import { listTasks, runningTasks, startAnimationTask } from './animationstore.mjs'
import { renderTemplateScript } from './animtemplates.mjs'
import { MAX_PREP_ATTEMPTS, hashMaterial, prepCacheKey } from './prep.mjs'

/**
 * 算一条备课声明的缓存键（要读教材文件）。
 * @param {{baseDir:string, item:object}} input
 * @returns {Promise<{cacheKey:string, materialSha256:string, materialPath:string}>}
 */
export async function cacheKeyForItem({ baseDir, item }) {
  const materialPath = resolve(baseDir, item.material)
  let text
  try {
    text = await readFile(materialPath, 'utf8')
  } catch (cause) {
    throw new Error(
      `备课声明 ${item.id} 的 material 读不到：${materialPath}（${cause?.code ?? cause?.message}）。` +
        '它是缓存键的输入——读不到就没法判断"教材改没改"，故报错而不是跳过。',
    )
  }
  const materialSha256 = hashMaterial(text)
  return {
    cacheKey: prepCacheKey({
      lesson: item.lesson,
      template: item.template,
      templateVersion: item.templateVersion,
      params: item.params,
      materialSha256,
    }),
    materialSha256,
    materialPath,
  }
}

/**
 * 给一讲的备课清单算状态（**只读盘，不起任务**）。
 * @returns {Promise<{lesson:number|null, entries:object[]}>}
 */
export async function prepPlan({ runtimeDir, baseDir, items, lesson }) {
  const root = join(runtimeDir, 'animations')
  const entries = []
  for (const item of items) {
    const key = await cacheKeyForItem({ baseDir, item })
    const found = await findByKey(root, key.cacheKey)
    const state = found.ready !== null ? 'cached' : stateOf(found, key.cacheKey)
    entries.push({
      id: item.id,
      title: item.title,
      template: item.template,
      lesson: item.lesson,
      cacheKey: key.cacheKey,
      materialSha256: key.materialSha256,
      attempts: found.attempts,
      state,
      taskId: found.ready?.taskId ?? found.latest?.taskId ?? null,
      artifact: found.ready === null ? null : artifactOf(found.ready),
      reason: found.latest?.status?.reason ?? null,
      required: item.required,
    })
  }
  return { lesson, entries }
}

/** 盘上按缓存键找（薄封装，便于单测注入）。 */
async function findByKey(root, cacheKey) {
  const tasks = await listTasks(root)
  const mine = tasks.filter((t) => t.task?.cacheKey === cacheKey)
  const ready = mine.filter((t) => t.status?.state === 'ready')
  return {
    ready: ready.length === 0 ? null : ready[ready.length - 1],
    attempts: mine.length,
    latest: mine.length === 0 ? null : mine[mine.length - 1],
  }
}

function artifactOf(record) {
  const mp4 = record.status?.mp4 ?? `${record.taskId}.mp4`
  return `animations/${record.taskId}/${mp4}`
}

/** 没有 ready 时，按"盘上最后一条"和尝试次数给一个状态。 */
function stateOf(found, cacheKey) {
  if (found.latest === null) return 'missing'
  const state = found.latest.status?.state ?? 'queued'
  if (state === 'blocked' || state === 'failed') {
    return found.attempts >= MAX_PREP_ATTEMPTS ? 'give-up' : state
  }
  if (TERMINAL_STATES.includes(state)) return state
  return state // queued / rendering / gating
}

/**
 * 预热一讲的备课清单：把没命中缓存的按顺序起起来。
 *
 * 🔴 并发：受**同一个**并发闸约束（MAX_CONCURRENT_TASKS，默认 2）。超过的条目**不起**，
 *    状态留在 `missing`，由回合边界再调一次（见 index.mjs 的 turn-stopping）——
 *    这样"一讲 5 段动画"不会把 CPU 打满，也不会有一堆看不见的排队。
 *
 * @param {{runtimeDir:string, baseDir:string, items:object[], lesson:number|null,
 *          python:string, manim:string, quality?:string, gate?:string|null, gatePython?:string|null,
 *          maxConcurrent?:number, turn?:number, now?:()=>number, log?:(m:string)=>void}} env
 * @returns {Promise<{lesson:number|null, entries:object[], started:string[], skipped:string[]}>}
 */
export async function warmUpPrep(env) {
  const log = env.log ?? (() => {})
  const root = join(env.runtimeDir, 'animations')
  const limit = env.maxConcurrent ?? MAX_CONCURRENT_TASKS
  const plan = await prepPlan({ runtimeDir: env.runtimeDir, baseDir: env.baseDir, items: env.items, lesson: env.lesson })
  const started = []
  const skipped = []

  let slots = limit - (await runningTasks(root, { now: env.now })).length
  if (slots < 0) slots = 0

  for (const entry of plan.entries) {
    if (entry.state !== 'missing' && entry.state !== 'failed' && entry.state !== 'blocked') {
      continue // cached / 在跑 / give-up 都不动
    }
    const item = env.items.find((i) => i.id === entry.id)
    if (slots <= 0) {
      skipped.push(`${entry.id}（并发闸已满 ${limit}，留到下一个回合边界再起）`)
      continue
    }
    const built = renderTemplateScript(item.template, item.title, item.params)
    const result = await startAnimationTask(
      { script: built.script, title: item.title, caption: item.caption },
      {
        runtimeDir: env.runtimeDir,
        lesson: item.lesson,
        turn: env.turn ?? 0,
        python: env.python,
        manim: env.manim,
        quality: env.quality,
        gate: env.gate ?? null,
        gatePython: env.gatePython ?? null,
        cacheKey: entry.cacheKey,
        prepId: item.id,
        origin: 'prep',
        template: item.template,
        now: env.now,
        // 注入点（单测用；生产不传＝走宿主的原子写与真 spawn）
        io: env.io,
        spawn: env.spawn,
      },
    )
    entry.state = 'queued'
    entry.taskId = result.taskId
    started.push(`${entry.id}→${result.taskId}`)
    slots -= 1
    log(`预热已起：${entry.id} → ${result.taskId}（模板 ${item.template}，pid ${result.runnerPid}）`)
  }
  return { lesson: plan.lesson, entries: plan.entries, started, skipped }
}

/** 缓存键的短展示形式（日志/通报里用，避免把 64 位十六进制铺满一行）。 */
export function shortKey(cacheKey) {
  return typeof cacheKey === 'string' && cacheKey.length >= 12 ? cacheKey.slice(0, 12) : String(cacheKey ?? '')
}

/** 供测试：把一段文本按与 hashMaterial 相同口径算键（不读盘）。 */
export function cacheKeyFromText({ lesson, item, text }) {
  return prepCacheKey({
    lesson,
    template: item.template,
    templateVersion: item.templateVersion,
    params: item.params,
    materialSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
  })
}

export { RUNNING_STATES }
