// test/fixtures.mjs — 测试用的教室目录与替身（不是 *.test.mjs，不进测试清点）
//
// 只做一件事：在临时目录里搭一个「够用的教室」，让群聊/审阅/定时的逻辑能在**不联网、
// 不需要宿主**的条件下跑起来。内容刻意小，但结构与真教室一致（`classroom.yaml` 声明角色卡、
// `runtime/` 下的真源与规则、`world/` 下的设定）。

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** 群聊规则（与教室那份同形状：文件头一段连续的 `>` 行）。 */
export const RULES = `# 群聊的写死规则

> **群里她打字**——群里她会比当面话多，但仍短。
> 每条不超过 2 行；不使用 emoji。
> **群聊不承载知识点**。他问知识题，就简短应一句、约到课上讲。
> 群里说话的人只能是 characters/ 里已经定义过的角色，或者一次性路人（写成 \`路人·<怎么称呼>\`）。
`

/** 一条真教室形状的 classroom.yaml（只保留本包要读的 `path: characters/*.md`）。 */
export const MANIFEST = `format: socratic-classroom/0
classroom:
  id: test
blocks:
  - id: persona
    path: characters/deepseek.md
    layer: persona
`

/** 角色卡（一级标题是名字，`·` 之后是版本说明）。 */
export const CHARACTER = `# 鲸（DeepSeek 娘）· 本教室版本

> 她是观测站的记录员。

她说话慢、句子短。
`

/**
 * 建一个临时教室。
 * @param {Record<string, string>} [files] - 额外文件（相对路径 → 内容）
 * @returns {Promise<string>} 教室目录绝对路径
 */
export async function makeClassroom(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'narr-group-'))
  const all = {
    'classroom.yaml': MANIFEST,
    'characters/deepseek.md': CHARACTER,
    'world/setting.md': '# 世界观\n\n观测站建在礁盘上，水线从房间中间穿过。\n',
    'runtime/wechat_group.rules.md': RULES,
    'runtime/session_log.md': '# 课堂摘要\n\n## 记录\n\n第 1 讲：他卡在页表与 TLB 的关系。\n',
    'runtime/notes.jsonl': '',
    'runtime/progress.md': '# 学习进度\n\ncurrent_lesson: 1\n',
    'knowledge_points.md': '- [ ] **KP-1.1 进程是什么** —— 判据：说得出程序与进程的区别\n',
    ...files,
  }
  for (const [relative, content] of Object.entries(all)) {
    const target = join(dir, relative)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  return dir
}

/**
 * 读文件（不存在返回 null）。
 * @param {string} file
 */
export async function readIfExists(file) {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/**
 * 模型的替身：`runTask` 的上游（本包调用的是运行器的 runTask，测试直接给一个同形状的对象）。
 * @param {(spec: object) => object | Promise<object>} handler - 收到 spec，返回结构化 value（或整份结果）
 */
export function fakeRunTask(handler) {
  const calls = []
  return {
    calls,
    async runTask(spec) {
      calls.push(spec)
      const outcome = await handler(spec)
      if (outcome?.value !== undefined) return outcome
      return { task: spec.task, value: outcome, text: JSON.stringify(outcome), usage: null, writes: [], elapsedMs: 1, provider: 'fake', model: 'fake' }
    },
  }
}

/**
 * 可拨的假时钟。
 * @param {number} start
 */
export function fakeClock(start) {
  let current = start
  return {
    now: () => current,
    set(ms) {
      current = ms
    },
    advance(ms) {
      current += ms
      return current
    },
  }
}
