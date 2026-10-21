// tools/probes/toolshape-live/index.mjs — 「本地 defineTool 的产物宿主真的认吗」活体探针（B2，2026-10-21）
//
// 为什么要有它：插件不再 import `@deepseek-ai/dsh-tools`，`defineTool` 换成
// `plugins/socratic-engine/lib/toolshape.mjs` 的本地复刻。**光有单测不算数** ——
// 单测只能证明"我认为宿主需要这个形状"，证明不了"宿主真的接受"。
// 这个探针装进**真 profile**，等引擎注册完工具后，走宿主**自己的**执行管线
// （`ctx.tools.execute()`：pre-policy → 派发 → `ToolOutputError` 校验 → `output.render`）真调两次：
//   ① 合法参数 → 必须成功，且 `content` 是 `output.render` 的产物（render 真被调用）
//   ② 非法参数 → 必须被拒，且消息是 `invalid arguments: …`（本地参数校验那一层活着）
//
// 结果写成 JSON Lines 到 `PROBE_LOG`（默认 `/tmp/socratic-toolshape-live.log`），
// 每行一个 `{ at, step, ok, detail }`。**不注册任何产品工具**，卸载即无痕。
//
// 装法（隔离 profile，别碰别人的实例）：
//   1) profile 的 cordis.patch.yml 插一行 loader 条目指向本目录
//   2) 引擎那一行要配 classroomDir（否则引擎空转、不会注册工具）

export const name = 'toolshape-live'

/** 需要工具注册表在服务表里（宿主会等它就绪再 apply）。 */
export const inject = ['tools']

import { appendFileSync } from 'node:fs'

/** 探针日志（JSON Lines；append 语义，方便与上一轮对比）。 */
const LOG = process.env.PROBE_LOG ?? '/tmp/socratic-toolshape-live.log'

/** 等引擎注册工具的轮数 × 间隔（引擎要先发现教室，可能要几秒）。 */
const POLL_TIMES = 60
const POLL_INTERVAL_MS = 250

/**
 * 追加一行 JSON（同步写，进程随时可能被 headless runner 结束）。
 * @param {object} record - 要记的内容
 */
function record(entry) {
  try {
    appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
  } catch (error) {
    console.error(`[toolshape-live] 写日志失败：${error?.message ?? error}`)
  }
}

/** 等一个工具出现在全局可见表里。 */
async function waitForTool(tools, toolName) {
  for (let attempt = 0; attempt < POLL_TIMES; attempt += 1) {
    if (tools.get(toolName) !== undefined) return tools.get(toolName)
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  return undefined
}

/**
 * 走宿主执行管线调一次工具。
 * @param {object} tools - `ctx.tools`
 * @param {string} toolName - 工具名
 * @param {object} args - 参数
 * @returns {Promise<object>} 宿主返回的最终结果（已 materialize）
 */
async function call(tools, toolName, args) {
  const controller = new AbortController()
  return tools.execute({
    callId: `probe-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name: toolName,
    arguments: args,
    signal: controller.signal,
  })
}

/**
 * 探针主体。
 * @param {object} ctx - cordis 上下文（已注入 tools）
 */
export async function apply(ctx) {
  const tools = ctx.tools
  const definition = await waitForTool(tools, 'classroom_status')
  if (definition === undefined) {
    record({ step: 'discover', ok: false, detail: 'classroom_status 始终没出现（引擎没发现教室？）' })
    return
  }
  record({
    step: 'discover',
    ok: true,
    detail: {
      name: definition.name,
      outputSchema: definition.output?.schema,
      parameters: definition.parameters,
      hasRender: typeof definition.output?.render === 'function',
    },
  })

  // ① 合法参数：空对象。成功 + content 是 render 产物 = 宿主接受了我们的 definition。
  const good = await call(tools, 'classroom_status', {})
  const text = (good.content ?? [])
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('\n')
  record({
    step: 'execute-valid',
    ok: good.isError !== true && /教室 .+｜相位 .+｜第 \d+ 回合/.test(text),
    detail: { isError: good.isError, text, error: good.error },
  })

  // ①b 面板的叙事服务：服务在不在 + 绑定是不是网关要的形状 + 清单有没有注册进 ctx.typert。
  //    （B2 把 `TypertRemoteService` 换成了本地 `lib/remote-service.mjs`，这三条是它成立的全部前提。）
  // 🔴 用 `ctx.get(name)` 而不是 `ctx.typert`：后者是注入式访问器（没 inject 'typert' 会抛
  //    `cannot get property "typert" without inject`），探针不想为一次读取改注入面。
  const typert = ctx.get('typert')
  const narrativeService = ctx.get('classroomNarrative')
  // 宿主面的 invocation 落在 `local`（当前环境的可调用定义）；`remotes` 是客户端清单那一路。
  const narrativeDescriptor = typert?.local?.get?.('classroomNarrative/status')
  const narrativeRemoteDescriptor = typert?.remotes?.get?.('classroomNarrative/status')
  record({
    step: 'panel-service',
    ok:
      typeof narrativeService === 'object' &&
      narrativeService !== null &&
      narrativeService.typertRemote?.service === narrativeService &&
      narrativeService.typertRemote?.serviceKey === 'classroomNarrative' &&
      typeof narrativeService.typertRemote?.namespace === 'string' &&
      // status(scope) 一个参数、diaries(scope, limit) 两个 —— 与清单逐条对上。
      narrativeDescriptor?.id === 'classroom-ui#classroomNarrative/status' &&
      narrativeDescriptor?.parameters?.length === 1 &&
      typert?.local?.get?.('classroomNarrative/diaries')?.parameters?.length === 2,
    detail: {
      provided: typeof narrativeService === 'object' && narrativeService !== null,
      binding: narrativeService?.typertRemote === undefined
        ? null
        : {
            sameService: narrativeService.typertRemote.service === narrativeService,
            serviceKey: narrativeService.typertRemote.serviceKey,
            namespace: narrativeService.typertRemote.namespace,
          },
      hostFaceRegistered: narrativeDescriptor !== undefined,
      clientFaceRegistered: narrativeRemoteDescriptor !== undefined,
      descriptorParameterCount: narrativeDescriptor?.parameters?.length ?? null,
      descriptorId: narrativeDescriptor?.id ?? null,
      localEndpoints: (typert?.local?.list?.() ?? []).map((entry) => `${entry.namespace}/${entry.method}`).filter((id) => id.startsWith('classroom')),
      methods: narrativeService === undefined ? null : Object.getOwnPropertyNames(Object.getPrototypeOf(narrativeService)),
    },
  })

  // ② 非法参数：lesson 给字符串 → 本地参数校验必须拦下（INVALID_ARGS 文案）。
  const enterLesson = await waitForTool(tools, 'classroom_enter_lesson')
  if (enterLesson === undefined) {
    record({ step: 'execute-invalid', ok: false, detail: 'classroom_enter_lesson 没注册，跳过这一条' })
  } else {
    const bad = await call(tools, 'classroom_enter_lesson', { lesson: 'not-a-number' })
    const badText = (bad.content ?? [])
      .filter((block) => block?.type === 'text')
      .map((block) => block.text)
      .join('\n')
    record({
      step: 'execute-invalid',
      ok: bad.isError === true && badText.includes('invalid arguments:'),
      detail: { isError: bad.isError, text: badText, error: bad.error },
    })
  }
}
