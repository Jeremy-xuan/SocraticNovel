// index.mjs — socratic-engine（P1 教学引擎 · 骨架，2026-09-23）
//
// 宿主面唯一文件（结构模板：dsh-memento v0.5.0）。骨架实现：
//   1) classroom.yaml 加载（lib/manifest.mjs，M1 v0 schema 子集）——显式指定优先，
//      其次工作区自动发现（lib/discovery.mjs，S2）
//   2) target=system 块 → systemPrompt.section 注册（实测①已证明生产链路生效）
//   3) target=chat 块 → 每 (sessionId, turn) 注入一次（lib/dedup.mjs 幂等门，S3）；
//      source kind = 'socratic-engine'
//   4) classroom_status / classroom_list / classroom_set_phase 工具
//   5) 相位存储（lib/phasestore.mjs 内存态；值域来自 manifest 顶层 phases 声明）
//      M3-STATE：相位由**模型自己**用 classroom_set_phase 宣布（引擎不按规则推进），
//      内存态是会话内真源，并镜像到 runtime_store.progress 的 `current_phase:` 行（见 lib/phasestore.mjs 文件头）
//   6) 课后自动更新教室 runtime/（lib/postclass.mjs 监听 agent/turn-stopping，S1）
//   7) classroom_draw 工具（T3a）：把白板图**真的画出来并落盘**——
//      结构校验（lib/diagram.mjs）→ 真解析校验（lib/mermaid-parse.mjs，worker 里的 mermaid）
//      → 写 runtime/diagrams/<文件>.mmd ＋ 追加索引 index.md（lib/diagramstore.mjs）。
//      工具描述**动词优先**（导出常量 DRAW_TOOL_DESCRIPTION，A/B 对照只改这一处）。
//
// 明确 TODO（骨架不做，避免未验证代码）：
//   - on_demand 块的工具触发路径（对答案/回查工具，M3）
//   - render.missing 的 error/default 语义（M1-B2 待拍板）
//   - 运行时切教室（系统段注册是一次性的，见 接线说明_S2.md §2.3 注）

import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  loadManifest,
  ManifestError,
  phaseDomainOf,
  defaultPhaseOf,
  readRuntimeLesson,
  readRuntimePhase,
  renderRuntimePhase,
  resolveProgressFile,
  usesLessonGate,
} from './lib/manifest.mjs'
import { planTurnInjections } from './lib/injector.mjs'
import { createPhaseStore, PHASES } from './lib/phasestore.mjs'
import { registerDiscovery } from './lib/discovery.mjs'
import { registerDedup, sessionIdOf } from './lib/dedup.mjs'
import { registerPostClass } from './lib/postclass.mjs'
import { DIAGRAM_KIND_IDS } from './lib/diagram.mjs'
import { drawDiagram } from './lib/diagramstore.mjs'
import { createMermaidParser } from './lib/mermaid-parse.mjs'

export const name = 'socratic-engine'

export const inject = ['systemPrompt', 'tools']

// ── classroom_draw 的工具描述（T3a）────────────────────────────────────────────
// 🔴 写法口径（本项目旧仓库的实测教训）：**动词优先**——第一句就是"画"，把触发条件写成
//    直接指令（"每讲到机制就画"），**不写"如果需要的话可以…"这类条件触发措辞**——
//    条件措辞会让模型犹豫，工具就不被调用（A/B 对照见实现报告 §4）。
// 🔴 单独提成一个常量：T3a 的对照组（B 组）要**只改这一处**、其余逐字节不变，
//    改成条件触发措辞后重跑同一场景（见 实现报告_T3a_画图工具_2026-09-24.md §4）。
export const DRAW_TOOL_DESCRIPTION =
  'Draw the whiteboard picture for the current teaching turn and save it into the classroom. ' +
  'Call it every time the lesson needs a mechanism on the board — a flow of steps, a state machine, ' +
  'a sequence of interactions between a process and the kernel, a comparison of two cases — ' +
  'and pass the mermaid diagram type in `kind` plus the complete mermaid source in `source`. ' +
  'Do not describe the picture in prose and do not sketch it with ASCII characters: draw it here. ' +
  'The engine parses the source with the real mermaid parser before writing anything, saves the source ' +
  'under runtime/diagrams/ and appends one row to the diagram index, so the picture survives the session ' +
  'and can be read back after class. A source the parser rejects is refused with the parser error and ' +
  'nothing is written; a markdown fence or an ASCII sketch is refused too — pass the raw mermaid source, ' +
  'first line = the diagram type keyword (flowchart / sequenceDiagram / stateDiagram-v2 / ...).'

export async function apply(
  ctx,
  /** @type {{enabled?: boolean, classroomDir?: string, defaultPhase?: string, classroomSearchDepth?: number, runtimeDir?: string|(() => string|null)}} */ config = {},
) {
  if (config.enabled === false) return
  // 🔴 FIX-6（2026-09-24）：原来的形状是 `ctx.logger?.('[socratic-engine]', ...args)`——
  //    cordis 的 `ctx.logger(name)` **只接受 name 一个参数**（`@deepseek-ai/cordis/lib/index.js`
  //    的 `LoggerService[symbols.invoke](name)`），其余参数被丢弃、返回的 Logger 被抛弃
  //    → 插件所有日志一条都不落任何地方（真 cordis 4.0.2 运行时段实测：旧形状收 0 条、
  //    同级别同出口的新形状收 1 条）。正确形状是**先取 logger、再调级别方法**。
  //    级别选 `info`：本函数记的是装载/发现/注入/相位/落盘等**正常运行轨迹**，
  //    非异常；`info`(level 1) 是这些消息的语义档，也是默认 exporter 门限下可见的档。
  const LOGGER_NAME = '[socratic-engine]'
  const log = (...args) => {
    try {
      ctx.logger?.(LOGGER_NAME).info(...args)
    } catch {
      /* logger 不可用不致命 */
    }
  }

  // ---- 1) manifest 加载：显式指定优先，其次工作区自动发现 ----
  // 发现结果由 lib/discovery.mjs 给出；多个候选时不静默选一个（带排序键与理由）。
  /** @type {{dir: string, manifest: object} | null} */
  let current = null
  // 🔴 讲次门（P0-4）：state.currentLesson = **本轮要讲的讲次**，唯一来源是
  //    runtime_store 声明的 progress 文件里的机器可读行 `<lesson_key>: <int>`。
  //    装载时读一次（早失败），每个回合开始前再读一次（课后更新改了讲次就立刻跟上）。
  /** @type {number|null} */
  let currentLesson = null
  const loadInto = (dir) => {
    const loaded = loadManifest(dir)
    current = { dir, manifest: loaded }
    // 有讲次门就必须真读得到值；读不到 → ManifestError（不静默失效）
    currentLesson = usesLessonGate(loaded) ? readRuntimeLesson(loaded, { baseDir: dir }) : null
    log(
      `教室已装载：${loaded.classroom.id}（${loaded.blocks.length} 块，来自 ${dir}）` +
        (currentLesson === null ? '' : `｜本轮要讲的讲次 = 第 ${currentLesson} 讲`),
    )
    return loaded
  }

  const discovery = registerDiscovery(ctx, {
    defineTool, // 宿主已 import 的 defineTool
    initialDir: config.classroomDir, // 有配置就作为最高优先级的「显式指定」
    maxDepth: config.classroomSearchDepth, // 缺省 3（见 接线说明_S2.md §3）
    onDiscovered: async (result) => {
      if (result.status === 'none') {
        log(`未发现任何教室：${result.reason}`)
        return
      }
      try {
        loadInto(result.selected.path)
      } catch (cause) {
        if (cause instanceof ManifestError) {
          log(`发现的教室 manifest 校验失败：${cause.message}（路径 ${result.selected.path}）`)
          return
        }
        throw cause
      }
    },
  })

  const initial = await discovery.run()
  if (initial.status === 'none') {
    log(`0 候选：${initial.reason}；插件空转（skill 模式兜底生效中）`)
    return
  }
  if (initial.status === 'ambiguous') {
    log(`🔴 发现 ${initial.candidates.length} 个候选，已选 ${initial.selected.path}；理由：${initial.reason}`)
    log(
      `其余候选（未被选用，可用 config.classroomDir 显式切换）：${initial.candidates
        .filter((c) => !c.selected)
        .map((c) => c.path)
        .join(' | ')}`,
    )
  }
  if (current === null) {
    log('发现的候选 manifest 校验失败，插件空转')
    return
  }

  // 相位值域来自 manifest 顶层 phases 声明（P0-1 修复；顺序即推进顺序），
  // 未声明时回退 legacy 显式枚举；config.defaultPhase 可覆盖但须在值域内。
  const phase = createPhaseStore({
    domain: phaseDomainOf(current.manifest),
    initialPhase: defaultPhaseOf(current.manifest, config.defaultPhase),
  })
  // M3-STATE：相位状态的落盘镜像（草案 §2.0：runtime_store 是「相位状态的来源」）。
  // 声明了 runtime_store 且文件里有 `current_phase: <id>` 行 → 用它接上（换会话不丢）；
  // 🔴 取值不在值域内 → **抛错**（不静默回退默认值——本项目已被"静默不生效"坑过两次）。
  {
    const restored = readRuntimePhase(current.manifest, { baseDir: current.dir })
    if (restored.phase !== null) {
      if (!phase.domain.includes(restored.phase)) {
        throw new ManifestError(
          `progress 文件里的 current_phase=${JSON.stringify(restored.phase)} 不在本教室的相位值域内` +
            `（可用：${phase.domain.join('/')}）：${restored.file}\n` +
            `  （教室改过 phases 声明、或该行被手改坏了；删掉该行即回到默认相位 ${phase.domain[0]}）`,
        )
      }
      phase.setPhase(restored.phase)
      log(`相位从 runtime_store 接上：${restored.phase}（${restored.file}）`)
    }
  }
  log(`相位值域：${phase.domain.join('/')}（默认 ${phase.domain[0]}，当前 ${phase.phase}）`)

  /**
   * 把当前相位写回 runtime_store.progress 的 `current_phase:` 行（原子写）。
   * 🔴 内存态才是会话内真源；这里是**镜像**，失败不静默——返回结构里带 `persisted:false` 与原因，
   *    由 classroom_set_phase 的返回值原样报给模型（见 lib/phasestore.mjs 文件头）。
   * @param {string} next
   * @returns {Promise<{persisted:boolean, file:string|null, note:string}>}
   */
  async function persistPhase(next) {
    let file
    try {
      file = resolveProgressFile(current.manifest, { baseDir: current.dir })
    } catch (cause) {
      return { persisted: false, file: null, note: `runtime_store 声明不可用：${cause?.message ?? cause}` }
    }
    if (file === null) {
      return {
        persisted: false,
        file: null,
        note: '本教室未声明 runtime_store → 相位只存于本次会话（换会话回到默认相位）',
      }
    }
    try {
      const io = await import('@deepseek-ai/dsh-atomic-write')
      await io.withFileLock(file, async () => {
        const text = await readFile(file, 'utf8')
        await io.writeFileAtomic(file, renderRuntimePhase(text, next), { mode: 0o600 })
      })
      return { persisted: true, file, note: `已写回 ${file}` }
    } catch (cause) {
      const reason = cause?.message ?? String(cause)
      log(`🔴 相位落盘失败（内存态已切换）：${reason}`)
      return { persisted: false, file, note: `落盘失败（相位已在本会话生效）：${reason}` }
    }
  }

  // 每回合注入的幂等门：键 = (sessionId, turn)，键的来源见 lib/dedup.mjs 顶部取证注释。
  const dedup = registerDedup(ctx)

  // ---- 1.5) 课后自动更新教室 runtime/（B2「它记得你」宿主侧） ----
  // runtimeDir 传取值函数：教室目录可能随发现结果在同一进程内变化。
  registerPostClass(ctx, {
    runtimeDir: config.runtimeDir ?? (() => (current ? join(current.dir, 'runtime') : null)),
    getPhase: () => phase.phase,
    // 讲次（DRAW-2）：回合标记里带上**当时**的讲次，让"课后更新有没有写完"可直接判。
    // 🔴 取的是本回合**开始时**读到的 `current_lesson`（该回合就是在这个讲次下上的课）——
    //    模型在回合内把 progress.md 改成下一讲，不影响本回合记录归属（记录的是"当时"）。
    //    教室没有讲次门 → currentLesson 为 null → 标记与标题都不带讲次（行为同升级前）。
    getLesson: () => currentLesson,
    log,
  })

  // ---- 2) 系统段注册（一次性） ----
  let registered = 0
  for (const block of current.manifest.blocks) {
    if (block.position.target !== 'system') continue
    ctx.systemPrompt.section({
      name: `socratic-engine:${block.id}`,
      order: block.position.order,
      text: block.text,
      interpolate: false, // 骨架：系统段不做 {{var}} 插值；状态渲染走 chat 注入
    })
    registered += 1
  }
  log(`系统段注册 ${registered} 块`)

  // ---- 3) 每回合 chat 注入（幂等门：键 = sessionId + turn） ----
  // 取证：agent/pre-step 按 **step** 触发，payload = { agent, messages, turn, step, signal }
  //   tmp/dsh-installed/dsh-agent-loop/lib/index.js:894,937
  //   tmp/dsh-installed/dsh-agent/lib/index.js:209（waterfall 注入 agent）
  // 旧判定 `payload.step === 1 && payload.messages.length > 0` 把「是否注入」与
  // 「本次 claim 是否非空」耦合在一起：step===1 但空批 → 漏注入且计数不推进。
  // 改为只看 (sessionId, turn)：同 turn 一律拦、新 turn 一律放，与 messages 空否无关。
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    // 先拿到下游汇合结果：只有真要进这个 step 时才消耗本 turn 的注入额度，
    // 否则 reject 路径会把额度吃掉却不注入（见 接线说明_S3.md §5 的不变量 I3）。
    if (decision?.kind !== 'enter') return decision

    const gate = dedup.shouldInject({
      sessionId: sessionIdOf(payload),
      turn: payload.turn,
      step: payload.step,
    })
    if (!gate.inject) return decision
    if (gate.mode !== 'turn') log(`去重门退化（${gate.reason}）`)

    phase.noteTurnStart()
    const blocks = current.manifest.blocks

    // 讲次门：每个回合开始前重读 progress 文件（课后更新会把讲次 +1）。
    // 🔴 读不到/值非法 → 报错（不静默）。宿主钩子报错会打断用户这一轮，故先拦一层记日志。
    let due
    try {
      if (usesLessonGate(current.manifest)) {
        currentLesson = readRuntimeLesson(current.manifest, { baseDir: current.dir })
      }
      due = planTurnInjections(blocks, { ...phase, currentLesson }, { classroom: current.manifest.classroom.id })
    } catch (cause) {
      log(`🔴 注入计划失败（本回合不注入任何块）：${cause?.message ?? cause}`)
      throw cause
    }
    if (due.length === 0) return decision

    const injected = due.map((d) =>
      createUserMessage({
        content: [{ type: 'text', text: d.text }],
        source: { kind: 'socratic-engine', form: 'classroom-block', block: d.id },
      }),
    )
    log(`turn ${payload.turn} 注入 ${injected.length} 块：${due.map((d) => d.id).join(',')}`)
    return { kind: 'enter', messages: [...decision.messages, ...injected] }
  })

  // ---- 4) classroom_status 工具 ----
  // 🔴 只注册一次（宿主同名工具重复注册会抛错，tmp/dsh-installed/dsh-tools/lib/index.js:2538）；
  //    execute 读可变快照 current，故发现结果刷新后无需重注册。
  ctx.tools.register(
    defineTool({
      name: 'classroom_status',
      description:
        'Report the current SocraticNovel classroom phase and turn count. Use it when the user asks about lesson progress or the engine state. Read-only.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            classroom: { type: 'string', required: true },
            phase: { type: 'string', required: true },
            turn: { type: 'integer', required: true },
            lesson: { type: 'integer', required: true },
            classroomDir: { type: 'string', required: true },
            discovered: { type: 'integer', required: true },
            selectedBy: { type: 'string', required: true },
            ambiguity: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `教室 ${value.classroom}｜相位 ${value.phase}｜第 ${value.turn} 回合｜本轮要讲第 ${value.lesson} 讲｜候选 ${value.discovered} 个（来源 ${value.selectedBy}）`,
          },
        ],
      },
      execute: async () => {
        const result = discovery.last()
        const selected = result?.selected ?? null
        return {
          classroom: current.manifest.classroom.id,
          phase: phase.phase,
          turn: phase.turnCount,
          // 讲次门未启用的教室回 0（"无讲次概念"），与 schema 的 required integer 对齐
          lesson: currentLesson ?? 0,
          classroomDir: current.dir,
          discovered: result?.candidates.length ?? 0,
          selectedBy: selected?.source ?? 'none',
          ambiguity: result !== null && result.status === 'ambiguous' ? result.reason : '',
        }
      },
    }),
  )

  // ---- 5) classroom_set_phase 工具（M3-STATE：相位推进由模型自己宣布）----
  // 🔴 设计口径（2026-09-24 用户拍板）：**引擎不硬编码教学行为**，只做两件事——
  //    ① 记录模型宣布的相位（值必须在教室声明的枚举内，否则抛错并列出合法 id）；
  //    ② 按新相位重新裁决所有 `frequency: phase` / `phase: { phases: [...] }` 的块
  //       （下一回合生效：本回合的消息已经在 pre-step 注入完了）。
  // 🔴 工具描述用**动词优先**写法，不写"如果需要的话可以…"这类条件措辞
  //    （本项目教训：条件措辞让模型犹豫，工具就不被调用）。
  ctx.tools.register(
    defineTool({
      name: 'classroom_set_phase',
      description:
        'Switch the SocraticNovel classroom to another teaching phase. Call it the moment the lesson ' +
        'moves into a new phase — opening into questioning, questioning into the student answering, ' +
        'answering into checking answers, checking into review, review into wrap-up — and pass one phase id ' +
        'from the classroom\'s declared phase list. The engine records the phase and re-decides every ' +
        'phase-gated teaching block from the next turn on, so what you get injected changes with it. ' +
        'An id outside the declared list is rejected with the legal ids.',
      parameters: {
        phase: {
          type: 'string',
          required: true,
          description:
            'The phase id to switch to. Must be one of the classroom\'s declared phases ' +
            '(call classroom_status to see the current one; the declared list is echoed back in the error if you pass an unknown id).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            phase: { type: 'string', required: true },
            previous: { type: 'string', required: true },
            domain: { type: 'string', required: true },
            turn: { type: 'integer', required: true },
            lesson: { type: 'integer', required: true },
            persisted: { type: 'boolean', required: true },
            note: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              `相位 ${value.previous} → ${value.phase}（可用：${value.domain}）｜第 ${value.turn} 回合｜` +
              `本轮要讲第 ${value.lesson} 讲｜${value.persisted ? '已落盘' : '未落盘'}：${value.note}`,
          },
        ],
      },
      execute: async (args) => {
        const previous = phase.phase
        // 🔴 不在枚举内 → setPhase 抛错并列出合法 id（不静默忽略、不回落默认值）
        phase.setPhase(args.phase)
        const persisted = await persistPhase(phase.phase)
        log(`相位切换：${previous} → ${phase.phase}（persisted=${persisted.persisted}）`)
        return {
          phase: phase.phase,
          previous,
          domain: phase.domain.join('/'),
          turn: phase.turnCount,
          lesson: currentLesson ?? 0,
          persisted: persisted.persisted,
          note: persisted.note,
        }
      },
    }),
  )

  // ---- 6) classroom_draw 工具（T3a：把白板真的画出来并落盘）----
  // 🔴 三段判据，缺一不可（每一段失败都**报错**，都不静默）：
  //    ① 结构性校验（lib/diagram.mjs，纯函数）：空/超长/围栏/图类型关键字/括号配平/字符拼图；
  //    ② **真解析校验**（lib/mermaid-parse.mjs → worker 里的 mermaid.parse）：能不能渲染由它说了算，
  //       解析器本身不可用也**报错**（不许降级放行）；
  //    ③ 落盘（lib/diagramstore.mjs）：runtime/diagrams/<文件>.mmd + 索引 index.md 追加一行。
  // 🔴 解析器**惰性创建**：不画图就不起 worker（冷启动实测约 1.3 s，见实现报告 §2.2）。
  /** @type {ReturnType<typeof createMermaidParser>|null} */
  let mermaidParser = null
  const getMermaidParser = () => {
    mermaidParser ??= createMermaidParser()
    return mermaidParser
  }

  ctx.tools.register(
    defineTool({
      name: 'classroom_draw',
      description: DRAW_TOOL_DESCRIPTION,
      parameters: {
        kind: {
          type: 'string',
          required: true,
          enum: DIAGRAM_KIND_IDS,
          description:
            'The mermaid diagram type to draw. Pick the one that fits the mechanism being taught: ' +
            'flowchart for a flow of steps or decisions, sequence for interactions between actors over time, ' +
            'state for a lifecycle with states and transitions, class / er for structure, mindmap / timeline / ' +
            'journey / pie / gantt / gitgraph / quadrant for the rest. The source\'s first line must start with ' +
            'the matching mermaid keyword (kind=flowchart → "flowchart TD", kind=sequence → "sequenceDiagram").',
        },
        source: {
          type: 'string',
          required: true,
          description:
            'The complete mermaid source of the picture, raw — no markdown fence, no prose around it, no ASCII ' +
            'sketch. First non-empty line = the diagram type keyword, then the nodes / participants / states and ' +
            'the arrows between them. Write the teaching labels directly in the diagram (Chinese is fine); the ' +
            'diagram is the explanation, so put the mechanism in it rather than in the surrounding chat text.',
        },
        title: {
          type: 'string',
          description:
            'One-line title of the picture, used in the diagram index so a reader can see what lesson 1 drew ' +
            '(e.g. "两个程序为什么不会互相捣乱"). Single line, ≤ 120 characters.',
        },
        caption: {
          type: 'string',
          description:
            'Optional one-paragraph note about what this picture is for (the misconception it targets, the ' +
            'question it leaves open). ≤ 500 characters.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            file: { type: 'string', required: true },
            indexFile: { type: 'string', required: true },
            kind: { type: 'string', required: true },
            diagramType: { type: 'string', required: true },
            title: { type: 'string', required: true },
            lesson: { type: 'integer', required: true },
            turn: { type: 'integer', required: true },
            lines: { type: 'integer', required: true },
            bytes: { type: 'integer', required: true },
            rows: { type: 'integer', required: true },
            time: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              `板书图已落盘：${value.file}（${value.kind} → ${value.diagramType}｜${value.lines} 行 / ${value.bytes} B）｜` +
              `第 ${value.lesson} 讲 · 第 ${value.turn} 回合 · ${value.time}｜` +
              `索引 ${value.indexFile} 现共 ${value.rows} 行${value.title === '' ? '' : `｜标题：${value.title}`}`,
          },
        ],
      },
      execute: async (args) => {
        // 编排主体在 lib/diagramstore.mjs 的 drawDiagram（三段：结构校验 → 真解析 → 落盘），
        // 抽出去是为了让这段逻辑不依赖宿主即可单测（见 test/diagram.test.mjs）。
        // 🔴 任何一段不过都**抛错**（工具报错 = 模型看得到，且什么都没落盘），不静默放行。
        const result = await drawDiagram(args, {
          runtimeDir: join(current.dir, 'runtime'),
          lesson: currentLesson,
          turn: phase.turnCount,
          parser: getMermaidParser(),
        })
        log(`板书图落盘：${result.file}（${result.kind} → ${result.diagramType}，${result.bytes} B）`)
        return {
          file: result.file,
          indexFile: result.indexFile,
          kind: result.kind,
          diagramType: result.diagramType,
          title: result.title,
          lesson: result.lesson ?? 0,
          turn: result.turn,
          lines: result.lines,
          bytes: result.bytes,
          rows: result.rows,
          time: result.time,
        }
      },
    }),
  )
}
