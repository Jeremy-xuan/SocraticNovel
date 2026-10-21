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
import { DIAGRAM_KIND_IDS, renderBoardLine } from './lib/diagram.mjs'
import { drawDiagram } from './lib/diagramstore.mjs'
import { createMermaidParser } from './lib/mermaid-parse.mjs'
import { NOTE_TYPES, assertRuntimeDir, createNoteStore } from './lib/notestore.mjs'
import { registerEmotionChannel } from './lib/emotionchannel.mjs'
import { ANIMATIONS_SUBDIR, EXPECTED_RANGE_TEXT, TERMINAL_STATES, describeState, nowLabel } from './lib/animation.mjs'
import {
  animationNoticeSource,
  buildAnimationNotice,
  checkAnimationRuntime,
  findByCacheKey,
  listTasks,
  markAnnounced,
  pendingNotices,
  settleRunningTasks,
  startAnimationTask,
  summarizeTasks,
} from './lib/animationstore.mjs'
import { TEMPLATE_IDS, checkTemplateArgs, describeTemplates } from './lib/animtemplates.mjs'
import { describeDeclaration, loadDeclaration } from './lib/declaration.mjs'
import { describePrepPlan, prepItemsForLesson } from './lib/prep.mjs'
import { cacheKeyForItem, prepPlan, warmUpPrep } from './lib/prepstore.mjs'

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

// ── classroom_animate 的工具描述（ANIM-ORCH）──────────────────────────────────
// 🔴 这份描述承担着**编排的一半**，不是普通说明文字：
//    实测（evidence/exp1_script_time.json）模型把一个知识点写成 ManimCE 脚本要 **74–91 秒**，
//    而渲染只要 **2–6 秒**（evidence/exp2_render_disk.json）。也就是说"学生干等"的 93 秒里
//    有 97% 花在**模型写脚本**上，只有 3% 是渲染。
//    → 所以真正要编排的不是"后台渲染"，而是**顺序**：先让学生听到讲解，再让工具去写/渲。
//    描述里因此把 ORDER MATTERS 写成硬指令（动词优先、直接命令，不用"如果需要的话可以"这类条件措辞
//    ——本项目实证：条件措辞会让模型犹豫，工具就不被调用，见实现报告_T3a §4）。
export const ANIMATE_TOOL_DESCRIPTION =
  'Start a teaching animation rendering in the background, then keep teaching while it renders. ' +
  'Use it when the point is a change over time that a still picture cannot carry — a process being ' +
  'interrupted and resumed, a queue draining in a different order, two numbers read off the same timeline. ' +
  'ORDER MATTERS: explain that step to the student in your own words FIRST, in this same turn, and call ' +
  'this tool after that text. Never make the tool call your opening move, and never leave the student ' +
  'with nothing to read while an animation is being made. The engine writes your script to ' +
  'runtime/animations/<task>/scene.py, starts the renderer as a separate process and returns at once ' +
  'with a task id and a time estimate, so the render overlaps with your continued teaching. When it ' +
  'finishes, the engine tells you at the start of a later turn that your animation is ready — play it ' +
  'then, at the moment the lesson reaches that step. A script the engine cannot accept is refused with ' +
  'the exact problem and nothing is started. ManimCE 0.21.0 only: one Scene subclass, Chinese labels ' +
  'with font="PingFang SC", and NO LaTeX (Tex / MathTex / Numberline-with-numbers crash on this machine) — ' +
  'write formulas and tick labels as plain Text. For a still diagram use classroom_draw instead.'

// ── classroom_animate_template 的工具描述（ANIM-PREP）──────────────────────────
// 🔴 这一条是本批的核心机制，描述里必须把**优先级**写死（动词优先，不用"如果需要的话可以"这类条件措辞
//    ——本项目实证：条件措辞会让模型犹豫，工具就不被调用）：
//      先取用备好的（命中课前预热）→ 其次套模板（等一小会儿）→ 最后才自己写脚本（明显更慢）。
//    🔴 2026-09-24 改（ALIGN-EXEC-2）：原文案写"prepId，0 秒 / 模板几秒 / 自己写一分钟"这类秒数，
//    与教室侧已改成的定性说法（"基本不用等"／"明显更慢"）**同一件事两个数** → 现统一为定性说法。
//    （当时的实测数字：从零写脚本 60.5–73.8 秒、渲染 2–6 秒；出处见 evidence/ 与实现报告_ANIM-PREP。）
export const ANIMATE_TEMPLATE_TOOL_DESCRIPTION =
  'Get a teaching animation for this step WITHOUT writing Manim code yourself — this is the fast path ' +
  'and it should be your first choice. Two ways to call it, in this order of preference: ' +
  '(1) `prepId` — when this lesson\'s prepared animation list includes the step you are at, pass its id. ' +
  'The engine already rendered it before class, so a cache hit returns the finished clip with no wait. ' +
  'Read the prepared list from the engine block you were given at the start of the turn. ' +
  '(2) `template` + `params` — when the step is not on the prepared list but its shape is one of the ' +
  'templates: pass the template id and the parameters. The engine builds the ManimCE script from your ' +
  'parameters and starts the same background renderer, so nothing is written by you and the clip is ' +
  'ready quickly instead of taking much longer the way writing a script from scratch does. ' +
  'ORDER MATTERS exactly as with classroom_animate: explain the step to the student FIRST, in this same ' +
  'turn, then call this tool — never as your opening move. Only when neither way fits (a mechanism no ' +
  'template can express) fall back to classroom_animate and write the script yourself. ' +
  'Templates available:\n' +
  describeTemplates()

// ── 模板 id 列表（工具参数 enum；顺序即描述里的呈现顺序）─────────────────────
export const ANIMATION_TEMPLATE_IDS = TEMPLATE_IDS

// ── classroom_note 的工具描述（A：课上记录）────────────────────────────────────
// 🔴 写法口径与 classroom_draw / classroom_animate 一致：**动词优先**，把触发条件写成直接指令
//    （"发现有学生原话作证据的那一刻就记"），不写"如果需要的话可以…"这类条件措辞——本项目实证：
//    条件措辞让模型犹豫，工具就不被调用（A/B 对照见实现报告_T3a §4）。
// 🔴 同时**必须**把"不要每轮都调"写进来（A5）：这个工具最大的风险不是不调，而是每回合都调一次，
//    把记录表灌成流水账——那样下一节课的注入就变成噪音。判据只有一条：**有没有学生原话作证据**。
export const NOTE_TOOL_DESCRIPTION =
  'Record one teaching fact the student just revealed, so the next lesson can pick it up. ' +
  'Call it at the moment it happens — when the student says something that is wrong in a specific way, ' +
  'gets stuck on one identifiable step, or explains a mechanism in their own words — and pass their words ' +
  'verbatim in `quote`. The engine appends one line to runtime/notes.jsonl and mechanically recomputes the ' +
  'mistake log, the review queue and the knowledge-point status from it, so the first lesson\'s blocker can ' +
  'be quoted in the second lesson. ' +
  'DO NOT call it every turn. The only trigger is that the student actually said something you can quote: ' +
  'a lesson where nothing was revealed deserves no record, and calling it after every explanation turns the ' +
  'record into noise that the next lesson has to read. Never call it to mark something you merely explained: ' +
  'only `type: evidence` marks a knowledge point as mastered, and `evidence` means the student explained it or ' +
  'used it, not that you covered it. A record whose `kp` does not exist in knowledge_points.md, or whose ' +
  '`quote` is empty, is refused and nothing is written.'


export async function apply(
  ctx,
  /** @type {{enabled?: boolean, classroomDir?: string, classroomDeclaration?: string, defaultPhase?: string, classroomSearchDepth?: number, runtimeDir?: string|(() => string|null), animation?: {python?: string, manim?: string, quality?: 'l'|'m'|'h'|'p'|'k', spokenFirst?: boolean, gate?: string|null, gatePython?: string|null, blocking?: boolean, blockingTimeoutMs?: number, heartbeatStaleMs?: number}}} */ config = {},
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

  // ---- 1.55) 情绪标记的源头剥离（C-e · 契约 K1.2）----
  // 🔴 为什么必须在引擎里剥（K1.0 的取证结论，不重复调研）：0.2.1 的原生对话框把 HTML 注释
  //    原样转义显示，`〔…〕` 走 text 节点同样可见；**没有**"助手文本持久化前 transform"的钩子。
  //    能改助手输出的位置只有 `llm/stream` waterfall（在落盘之前）与端上遮蔽（遮蔽后无法复用
  //    宿主渲染器）。所以标记**只在流里存在**：下游（assistant/message 持久化、原生界面、
  //    session_log.md、classroom_note）拿到的都已经是剥净文本。
  // 🔴 情绪事件追加写 `<教室>/runtime/emotions.jsonl`（K1.4），舞台/表情模块按 seq 轮询。
  // 🔴 任何异常都**原样透传**并记日志（宁可原生界面脏一行，也不能让课堂断流）。
  registerEmotionChannel(ctx, {
    runtimeDir: config.runtimeDir ?? (() => (current ? join(current.dir, 'runtime') : null)),
    getTurn: () => phase.turnCount,
    log,
  })

  // ---- 1.6) 教学动画（ANIM-ORCH）：配置、状态结算、就绪通报 ----
  // 🔴 开关在**教室**（`classroom.yaml` 的顶层 `animation:` 段，见 lib/manifest.mjs 的
  //    normalizeAnimation）：教室不声明 → 本段整块不生效，工具/纪律段/注入**一个都不加**，
  //    行为与升级前逐字相同（本批的兼容红线）。
  // 🔴 渲染器路径在**部署配置**（profile 的 config 或环境变量）：那是"这台机器上 manim 在哪"，
  //    不是课程内容，不该写进教室包（教室包要能在别人机器上跑）。
  const animCfg = config.animation ?? {}
  const animationDeclared = current.manifest.animation?.enabled === true
  const animEnv = {
    python: animCfg.python ?? process.env.SOCRATIC_ANIMATION_PYTHON ?? null,
    manim: animCfg.manim ?? process.env.SOCRATIC_ANIMATION_MANIM ?? null,
    quality: animCfg.quality ?? 'l',
    gate: animCfg.gate ?? process.env.SOCRATIC_ANIMATION_GATE ?? null,
    gatePython: animCfg.gatePython ?? null,
    blocking: animCfg.blocking === true,
    blockingTimeoutMs: animCfg.blockingTimeoutMs,
    heartbeatStaleMs: animCfg.heartbeatStaleMs,
  }
  const animationEnabled = animationDeclared
  const animationRuntimeDir = () => (current ? join(current.dir, 'runtime') : null)
  if (animationDeclared) {
    // 🔴 教室声明了要用动画，但部署没配好渲染环境 → **装载时就报错**，不留到课堂上才炸。
    //    （不静默降级成"没有动画"：那样教室作者会以为配好了，实际一次都不会生效。）
    //    自检内容见 lib/animationstore.mjs 的 checkAnimationRuntime：两个可执行文件在不在、
    //    闸门脚本在不在、**渲染器脚本自己语法通不通**（这一条实测踩过：语法错 → 渲染器静默死）。
    const check = checkAnimationRuntime(animEnv)
    if (!check.ok) {
      throw new ManifestError(
        `教室 ${current.manifest.classroom.id} 声明了 animation: 段，但渲染环境不可用：\n- ` +
          check.problems.join('\n- ') +
          '\n（渲染器路径来自 profile 的 socratic-engine config.animation，或环境变量 ' +
          'SOCRATIC_ANIMATION_PYTHON / SOCRATIC_ANIMATION_MANIM / SOCRATIC_ANIMATION_GATE）',
      )
    }
    log(
      `教学动画已启用：python=${animEnv.python}｜manim=${animEnv.manim}｜画质=${animEnv.quality}｜` +
        `闸门=${animEnv.gate ?? '未配置（不过闸门）'}` +
        (animEnv.blocking ? '｜🔴 blocking=true（**仅对照实验用**：同步等渲染完才返回）' : '') +
        '｜装载自检通过',
    )
  }

  // ── ANIM-PREP ①：课前预热（用户原话里的"备课"）──────────────────────────────
  // 🔴 这一节回答用户那句 *"下一轮对话要用到，这一轮开始的时候先让子代理开始跑？可能吗？"*：
  //    可能，但**前提是"这一轮已经知道下一轮要用什么"**——而那只有**课程数据**能提供
  //    （学生下一句问什么，模型猜不出来）。所以预热读的是教室 `classroom.yaml` 的 `prep:` 段
  //    （形状与校验见 lib/prep.mjs），**不是**让模型猜。
  //
  // 🔴 触发时机（两处，都在**回合边界**上，不占教学热路径之外的任何东西）：
  //    ① 装载后立刻起一次（＝课前/开课那一轮就开始跑）；
  //    ② 每个回合开始时，若**讲次变了**就再起一次（＝上一讲结束时 postclass 把
  //       `current_lesson` 推进到下一讲，下一回合开头就把下一讲的动画备上）。
  //    为什么不放在 turn-stopping：那一处 postclass 与引擎的监听顺序没有契约，
  //    讲次可能还没被推进 → 会预热到"上一讲"的清单。放在 pre-step（已重读讲次）无歧义。
  //
  // 🔴 预热**不调用任何模型**：脚本由模板从参数拼出来。这是它比"派子代理去写"强的地方。
  let lastPreppedLesson = Symbol('never')
  /** @type {{lesson:number|null, entries:object[]}|null} */
  let lastPrepPlan = null
  /** 备课清单已经注入给老师的是哪一讲（一讲只发一次；讲次变了重发）。 */
  let prepListAnnouncedFor = Symbol('never')

  async function warmUpCurrentLesson(reason) {
    if (!animationEnabled) return null
    const prepItems = current.manifest.prep?.items ?? []
    if (prepItems.length === 0) return null
    const runtimeDir = animationRuntimeDir()
    if (runtimeDir === null) return null
    const items = prepItemsForLesson(current.manifest, currentLesson)
    if (items.length === 0) {
      lastPreppedLesson = currentLesson
      lastPrepPlan = { lesson: currentLesson, entries: [] }
      log(`备课清单：第 ${currentLesson ?? '?'} 讲没有预先声明的动画（${reason}）`)
      return lastPrepPlan
    }
    try {
      const plan = await warmUpPrep({
        runtimeDir,
        baseDir: current.dir,
        items,
        lesson: currentLesson,
        turn: phase.turnCount,
        python: animEnv.python,
        manim: animEnv.manim,
        quality: animEnv.quality,
        gate: animEnv.gate,
        gatePython: animEnv.gatePython,
        log,
      })
      lastPreppedLesson = currentLesson
      lastPrepPlan = plan
      log(
        `备课预热（${reason}，第 ${currentLesson} 讲）：起 ${plan.started.length} 段` +
          `（${plan.started.join(',') || '无'}）｜已在盘上/在跑 ${plan.entries.filter((e) => e.state !== 'missing').length} 段` +
          (plan.skipped.length === 0 ? '' : `｜受并发闸推迟 ${plan.skipped.length} 段`),
      )
      return plan
    } catch (cause) {
      // 预热失败**不许拖垮课堂**：记日志、这一讲按"没有备好的动画"走（老师照样能现场起）。
      log(`🔴 备课预热失败（不影响上课）：${cause?.message ?? cause}`)
      return null
    }
  }

  // 装载后立刻预热一次（＝"开课/课前就把它备上"）。清单为空时这一步什么都不做。
  if (animationEnabled && (current.manifest.prep?.items ?? []).length > 0) {
    await warmUpCurrentLesson('装载后')
  }

  /**
   * 取"该告诉老师"的动画结果，并**当场标记已播报**（幂等：同一任务只说一次）。
   * 返回 [{block, text}]。
   */
  async function collectAnimationNotices() {
    if (!animationEnabled) return []
    const runtimeDir = animationRuntimeDir()
    if (runtimeDir === null) return []
    const root = join(runtimeDir, ANIMATIONS_SUBDIR)
    let pending
    try {
      pending = await pendingNotices(root)
    } catch (cause) {
      log(`🔴 读动画任务状态失败（本回合不通报）：${cause?.message ?? cause}`)
      return []
    }
    if (pending.length === 0) return []
    const out = []
    for (const record of pending) {
      // 🔴 先标记后返回：宁可"标记了但注入失败"（老师可自己查 classroom_animation_status），
      //    也不要"每回合重复通报同一件事"（那会把老师的注意力从教学上拽走）。
      try {
        await markAnnounced(record.dir)
      } catch (cause) {
        log(`🔴 标记动画已播报失败（${record.taskId}）：${cause?.message ?? cause}`)
      }
      // 一条通报 = 一个任务：正文给模型看，source 上的机器可读字段给客户端看（见接线说明）
      out.push({ text: buildAnimationNotice(record), source: animationNoticeSource(record) })
    }
    log(`动画通报 ${out.length} 条：${pending.map((p) => `${p.taskId}=${p.status?.state}`).join(',')}`)
    return out
  }

  // 回合边界结算：把"渲染器已经死了但状态还停在 rendering"的任务前推成 failed。
  // 🔴 为什么放在 turn-stopping 而不是注入时：注入是**每个 step** 都会走的路径，结算要读盘、
  //    要判 pid，放在那里会把热路径变重；而 turn-stopping 每回合恰好一次，且此时
  //    本回合的所有工具调用都已经落盘（与 lib/postclass.mjs 同一取证依据）。
  // 🔴 通知型钩子（无 next），抛错会打断整个回合 → 与 postclass 同口径：只记日志、不抛。
  ctx.on('agent/turn-stopping', async (payload) => {
    if (!animationEnabled) return
    const runtimeDir = animationRuntimeDir()
    if (runtimeDir === null) return
    try {
      const root = join(runtimeDir, ANIMATIONS_SUBDIR)
      const { settled, running } = await settleRunningTasks(root, {
        heartbeatStaleMs: animEnv.heartbeatStaleMs,
        log,
      })
      if (settled.length > 0 || running.length > 0) {
        log(
          `turn ${payload?.turn} 动画结算：新判死 ${settled.length} 个` +
            `（${settled.map((s) => s.taskId).join(',') || '无'}）｜仍在跑 ${running.length} 个`,
        )
      }
    } catch (cause) {
      log(`🔴 动画任务结算失败（不影响本回合）：${cause?.message ?? cause}`)
    }
  })

  // 动画纪律：教室声明了 animation 才注册（未声明 → 这一节根本不存在，行为不变）。
  // 🔴 文案口径（动词优先、给禁令、**不写秒数**）：第 1 条是整条编排的关键。
  //    🔴 2026-09-24 改（ALIGN-EXEC-2）：原文案把实测秒数写进模型看得见的文本
  //    （"写脚本 74–91 秒 / 渲染 2–6 秒"、"命中缓存 0 秒"、"从零写脚本 60–74 秒"），
  //    而教室侧的渠道纪律已改成**定性说法**（"基本不用等"／"明显更慢"）——
  //    **同一件事两个数、模型每轮同时看到**，违反本项目"同一件事不能两个数"的口径。
  //    现统一为教室那套定性说法；**实测数字只留在注释与本目录的报告/证据里**
  //    （evidence/exp1_script_time.json、exp2_render_disk.json、ab-timeline.json），
  //    不再出现在模型看得见的任何文本里。
  //    唯一的例外见 §「classroom_animate_template」：渲染自身的耗时预估（EXPECTED_RANGE_TEXT）
  //    是**另一件事**（这条片子渲完要多久，不是"你等多久"），只保留那一处、不在此重复。
  if (animationEnabled) {
    const rules = []
    // 🔴 第 0 条（`animation.spokenFirst`，**默认关闭**）：**先开口，再备课**。
    //    动机：实测学生空窗 17–66 秒，而其中绝大部分不是动画、也不是渲染，是模型**先闷头读教材**
    //    （8 个 read 在第 3–16 秒发完，之后到第 53 秒才吐出第一句给学生看的话）。
    //    "先讲后画"只约束工具的顺序，管不到这一段——所以做了这一条。
    //    🔴 **但 n=1 的 A/B 没有显示它有效，方向还相反**（开=53.5 s、关=17.2 s 空窗；
    //       evidence/ab-timeline.json）。会话间方差本来就很大（17–66 s），n=1 说明不了任何事。
    //    → 故**默认关闭**：没有证据的行为变更不进默认路径；开关留着，等更大样本再定。
    //       想开就把 config.animation.spokenFirst 设成 true。
    if (animCfg.spokenFirst === true) {
      rules.push(
        '0. **先开口，再去备课。** 回合一开始，先用一两句话回应学生问的东西（说清你打算从哪儿讲起），',
        '   **然后**再去读材料、画图、起动画。本机实测：先闷头读教材会把学生晾在那儿很久——',
        '   那是他一句话都看不到的时间，比动画渲染本身长得多。',
        '',
      )
    }
    rules.push(
      '1. **先讲后画。** 你决定用动画讲某一步时，**先在同一回合的正文里把这一步讲给学生**，',
      '   然后再调工具。不许把工具调用当开场白：**写一段动画脚本比渲染本身慢得多**，',
      '   先调工具就等于让学生对着空屏干等。',
      '2. **优先级：取备好的 → 套模板 → 才自己写。** 按这个顺序选工具，不要跳级：',
      '   a. 这一步在**本讲预先声明的动画清单**里（回合开头的引擎块里有清单与 `prepId`）→',
      '      调 `classroom_animate_template` 并传 `prepId`。它在**上课前就渲好了**，命中缓存**基本不用等**。',
      '   b. 不在清单里，但形状是某个模板（时间轴/甘特、状态机推移、条形对比）→',
      '      调 `classroom_animate_template` 传 `template` + `params`。**你自己不写一行 Manim**，',
      '      引擎按参数拼脚本，很快就能拿到片子（对照：从零写脚本**明显更慢**）。',
      '   c. 只有"模板表达不了的过程动画"才用 `classroom_animate` 自己写脚本——那是最慢的一条路。',
      '3. **起了就继续讲。** 工具立刻返回"已排队"，不要等它；渲染在后台独立进程里跑。',
      '4. **好了再放。** 引擎会在后面某个回合的开头告诉你"你上一轮的动画已就绪"，',
      '   那时在讲解走到那一步时把它放出来，并说清它讲的是哪一步。',
      '5. **没成就换路，不许吊着学生。** 通报里若写 `blocked`（闸门判画面有缺陷）或 `failed`（没渲出来），',
      '   不要对学生说"动画正在生成"然后不放——改用 `classroom_draw` 画一张板书图把这一步讲完。',
      '6. **静态的图不要用动画。** 流程图/状态机/对比表这类不随时间变化的，直接用 `classroom_draw`。',
      '',
    )
    ctx.systemPrompt.section({
      name: 'socratic-engine:animation.discipline',
      order: 10600, // 紧跟教室自己的教学法（system_core 用 10300、world 用 10400）
      interpolate: false,
      text: ['## 教学动画的使用纪律（引擎注入）', '', ...rules].join('\n'),
    })
  }

  // ---- 1.65) 部署声明（EXPR-5 的**保留部分**）：面板读的目录 == 引擎写的目录 ----
  // 🔴 为什么留着：面板按 `__DSH_CLASSROOM_UI_CONFIG__.root`（缺省＝代码常量）读教室文件，
  //    引擎按 `config.classroomDir`（缺省＝工作区自动发现）写 `runtime/`。
  //    **两边指不同目录时没有任何一处会出声**——引擎照写、面板照读（读不到就显示"还没有"），
  //    表现成"引擎写了但面板看不到"，日志与画面都不说这是配置错。
  //    → 声明文件里声明 `classroomRoot`，本引擎**核对**它（不一致就带修法出声）。
  // 🔴 未配置 `config.classroomDeclaration` → 一致性没有机核，**明说**（不静默）。
  // 📌 2026-10-20（C-e 废弃预设表情层）：`portraitModel` 不再被本引擎消费（表情改由舞台按 K1
  //    语气标记驱动），这里只保留**目录一致性**这一半；`describeDeclaration` 仍会把声明里的
  //    立绘模型名打进日志（渲染侧仍以它为准）。
  const declaration = await loadDeclaration({
    file: config.classroomDeclaration,
    workspaceRoot: discovery.workspaceRoot(),
    classroomDir: current.dir,
  })
  for (const line of describeDeclaration(declaration)) log(line)

  // ---- 1.7) 预设表情层：**已废弃**（2026-10-20）----
  // 🔴 原 §1.7 是 EXPR-1/EXPR-2 的「老师调 classroom_express 在 5 个预设表情间切换」：
  //    `lib/expression.mjs`（能力发现 + 推测兜底 + 三档落盘）+ `lib/expressionstore.mjs`
  //    + `lib/expression-table.json` + `classroom_express` 工具 + `runtime/expression.md`。
  //    按开发文档 §四 C 的「废弃」条整条删除：表情改由舞台侧的表情驱动模块按**语气标记**
  //    （契约 K1，见 lib/emotionmark.mjs / lib/emotionchannel.mjs）实时驱动，引擎不再指定表情，
  //    也不再写 `runtime/expression.md`。
  //    删除理由（写进实现报告）：① 驱动源变了（句子语气 vs 老师显式点名）；
  //    ② 预设表与「按环节硬切」正是用户要废掉的那套；③ 少一条引擎→客户端的落盘契约（少一个静默分叉点）。
  // ⚠️ `clients/**` 里读 `runtime/expression.md` 的面板代码不在本车道范围内，需要 P 车道处理。

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

    // 🔴 ANIM-PREP：讲次一变就在本回合开头把**下一讲**的动画备上（"这一轮开始先让它跑"）。
    //    放在这里而不是 turn-stopping：这一处刚重读过 progress.md，讲次没有歧义。
    //    只在**讲次真的变了**时做（每回合都做＝每回合都读一遍教材文件，没必要）。
    if (animationEnabled && currentLesson !== lastPreppedLesson) {
      await warmUpCurrentLesson(`回合 ${payload.turn} 开头，讲次 → ${currentLesson}`)
    }

    // 🔴 ANIM-ORCH：把"上一轮的动画好了/被闸门拦了/渲失败了"作为**引擎自产的注入块**送到老师手里。
    //    这是"就绪信息怎么传"的落点，也是本编排唯一真正新增的机制。
    //    为什么走注入而不是让老师自己查：宿主是回合制的，模型不会无缘无故去查一个状态工具；
    //    而"该放动画了"是一个**事件**，事件必须由引擎推过去（推一次，见 announcedAt 幂等门）。
    const notices = await collectAnimationNotices()

    // 🔴 ANIM-PREP：把"本讲预先备好了哪几段动画"作为**引擎自产的注入块**送到老师手里。
    //    为什么必须有这一块（否则整条备课机制等于没做）：老师在课堂上**取用**的前提是
    //    它知道有什么可取——`prepId` 是课程数据里的 id，模型不可能猜出来。
    //    一讲只注入一次（讲次变了才重发），避免每回合重复占注意力。
    let prepBlock = null
    if (
      animationEnabled &&
      (current.manifest.prep?.items ?? []).length > 0 &&
      prepListAnnouncedFor !== currentLesson &&
      currentLesson !== null
    ) {
      const plan =
        lastPrepPlan !== null && lastPrepPlan.lesson === currentLesson
          ? lastPrepPlan
          : await prepPlan({
              runtimeDir: animationRuntimeDir(),
              baseDir: current.dir,
              items: prepItemsForLesson(current.manifest, currentLesson),
              lesson: currentLesson,
            })
      if (plan.entries.length > 0) {
        prepListAnnouncedFor = currentLesson
        prepBlock = {
          text: [
            `本讲（第 ${currentLesson} 讲）预先备好的教学动画：`,
            ...plan.entries.map(
              (e) =>
                `· \`${e.id}\` —— ${e.title}（模板 ${e.template}，${
                  e.state === 'cached'
                    ? '**已就绪**'
                    : e.state === 'give-up'
                      ? '**已放弃**（别等它）'
                      : e.state === 'blocked' || e.state === 'failed'
                        ? `**${e.state}**（别等它）`
                        : '正在预热'
                }）`,
            ),
            '→ 讲到清单里某一段对应的那一步时，**不要自己写 Manim 脚本**：调 `classroom_animate_template` 并传它的 `prepId`。',
            '  课前已经渲好了，命中缓存基本不用等；标记"别等它"的那几段改用 `classroom_draw` 画板书图。',
            '→ 清单里没有、但形状是某个模板的步骤，用 `classroom_animate_template` 传 `template` + `params`。',
          ].join('\n'),
          source: { kind: 'socratic-engine', form: 'prep-list', block: `prep-list:L${currentLesson}`, lesson: currentLesson },
        }
      }
    }

    if (due.length === 0 && notices.length === 0 && prepBlock === null) return decision

    const injected = due.map((d) =>
      createUserMessage({
        content: [{ type: 'text', text: d.text }],
        source: { kind: 'socratic-engine', form: 'classroom-block', block: d.id },
      }),
    )
    if (prepBlock !== null) {
      injected.push(
        createUserMessage({
          content: [{ type: 'text', text: prepBlock.text }],
          source: prepBlock.source,
        }),
      )
    }
    for (const notice of notices) {
      // 🔴 source 里带的是**跨端契约字段**（taskId/state/artifact/absPath/…）：
      //    客户端据此在消息流里播片，**不解析正文中文**（见 接线说明_客户端播放.md）。
      injected.push(
        createUserMessage({
          content: [{ type: 'text', text: notice.text }],
          source: notice.source,
        }),
      )
    }
    log(
      `turn ${payload.turn} 注入 ${injected.length} 块：${due.map((d) => d.id).join(',')}` +
        (prepBlock === null ? '' : `｜备课清单 L${currentLesson}`) +
        (notices.length === 0 ? '' : `｜动画通报 ${notices.map((n) => n.source.block).join(',')}`),
    )
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

  // ---- 5.5) classroom_express：**已废弃**（2026-10-20，开发文档 §四 C「废弃」条）----
  // 原实现＝老师用工具在 5 个预设表情之间硬切（`lib/expression*.mjs` + `expression-table.json`）。
  // 现在表情由舞台侧的表情驱动模块按**语气标记**（契约 K1）实时驱动，引擎不再指定表情，
  // 因此**不注册这个工具**：工具表里没有这个名字，模型也就不会看到一条用不了的选项。
  // ⚠️ 消费方：`clients/**`（面板读 `runtime/expression.md`）不在本车道范围 → 需 P 车道处理。

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
            // 🔴 W-e（契约 K2.1）：图 id / 舞台读图路由 / 结构化板书事件。
            //    结构化数据在事件里走 `presentationMeta`（`value` 不进事件），这三样进 schema
            //    是为了让**模型自己**也能读到 id 与路由（它可能要在正文里提"这张图在哪"）。
            diagramId: { type: 'string', required: true },
            boardRoute: { type: 'string', required: true },
            board: {
              type: 'object',
              required: true,
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                lesson: { type: 'integer', required: true },
                turn: { type: 'integer', required: true },
                kind: { type: 'string', required: true },
              },
            },
          },
        },
        // 🔴 机器可读行的位置是**文本末尾单独一行**（契约 K2.1 第 2 条）：
        //    它是兜底路径——舞台拿不到 `meta` 时就从这里抓（K2.3 的判据 2）。
        render: (_args, value) => [
          {
            type: 'text',
            text:
              `板书图已落盘：${value.file}（${value.kind} → ${value.diagramType}｜${value.lines} 行 / ${value.bytes} B）｜` +
              `第 ${value.lesson} 讲 · 第 ${value.turn} 回合 · ${value.time}｜` +
              `索引 ${value.indexFile} 现共 ${value.rows} 行${value.title === '' ? '' : `｜标题：${value.title}`}` +
              `\n${renderBoardLine(value.board ?? { id: value.diagramId, lesson: value.lesson, turn: value.turn, kind: value.kind })}`,
          },
        ],
        // 🔴 0.2.1 的事实（契约 K2.1 开头那条）：工具结果进会话事件时 `content` 是 render 的产物，
        //    结构化 `value` **不进事件**；要带结构化数据的**唯一出口**就是这里 —— 舞台优先读 `meta.board`。
        presentationMeta: (_args, value) => ({ board: value.board }),
      },
      execute: async (args, exec) => {
        // 编排主体在 lib/diagramstore.mjs 的 drawDiagram（三段：结构校验 → 真解析 → 落盘），
        // 抽出去是为了让这段逻辑不依赖宿主即可单测（见 test/diagram.test.mjs）。
        // 🔴 任何一段不过都**抛错**（工具报错 = 模型看得到，且什么都没落盘），不静默放行。
        const result = await drawDiagram(args, {
          runtimeDir: join(current.dir, 'runtime'),
          lesson: currentLesson,
          turn: phase.turnCount,
          // 会话 id：写进索引的「会话」列，也是舞台判"这节课的板书"的依据
          session: exec?.agent?.session?.id ?? null,
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
          diagramId: result.diagramId,
          boardRoute: result.boardRoute,
          board: result.board,
        }
      },
    }),
  )

  // ---- 6.5) classroom_note 工具（A：课上记录 → 确定性落盘，契约 K3）----
  // 🔴 分工（用户已定的设计，开发文档 §四 A）：
  //    **判断在课上做，落盘是确定性的**。老师当场判断"这是误解 / 卡点 / 掌握证据"，
  //    调一次本工具；引擎只做三件事：校验入参 → 追加 `runtime/notes.jsonl` → 机械重算三份
  //    投影（`mistake_log.md` / `review_queue.md` / `knowledge_points.md` 的状态位）。
  //    **不加**课后另调一次 LLM 做总结——引擎红线：不许用 LLM 生成式改写教学事实。
  // 🔴 红线的落点：`[x]` 的唯一来源是 `type: evidence` 的记录，而记录要求 `quote` 是**学生原话**。
  //    "老师讲过"在这条链路上**不产生任何记录**（没有任何按讲解行为推断掌握的路径）。
  // 🔴 幂等：同一回合（session + turn）里 type/kp/原话三样都相同 → 视为同一条记录，
  //    返回既有 id、不重复追加。身份用的就是 postclass 的 turnMarker 编码的同一对字段
  //    （`lib/notestore.mjs` 的 findDuplicateNote 注释里写了为什么**不新造键**）。
  // 🔴 报错一律**抛**（工具报错＝模型看得到，且什么都没落盘）：kp 不存在、quote 为空、
  //    runtime/ 不可写，都不静默。
  ctx.tools.register(
    defineTool({
      name: 'classroom_note',
      description: NOTE_TOOL_DESCRIPTION,
      parameters: {
        type: {
          type: 'string',
          required: true,
          enum: NOTE_TYPES,
          description:
            'Which kind of record this is. ' +
            '`misconception` = the student said something that is wrong in a specific way (a wrong model of a ' +
            'mechanism, not a slip of the tongue); `blocker` = the student is stuck on one identifiable step and ' +
            'cannot get past it even after help; `evidence` = the student explained the mechanism in their own ' +
            'words or used it correctly in a new case (this is the ONLY thing that can ever mark a knowledge ' +
            'point as mastered); `group_question` = a knowledge question the student asked in the group chat, to ' +
            'be picked up in the next lesson (no kp needed).',
        },
        kp: {
          type: 'string',
          description:
            'The knowledge point this belongs to, exactly as it appears in knowledge_points.md: "KP-<lesson>.<n>", ' +
            'e.g. "KP-3.2". Required for every type except group_question. Read knowledge_points.md first — an id ' +
            'that does not exist in that file is refused and nothing is written.',
        },
        quote: {
          type: 'string',
          required: true,
          description:
            'The student\'s own words, verbatim — the evidence for this record, not your summary of it. ' +
            'Copy the sentence they actually said (a short clause is fine); never invent or paraphrase it. ' +
            'An empty quote is refused: without the student\'s words there is no record to make. ' +
            'Emotion markers and markdown are stripped before saving.',
        },
        note: {
          type: 'string',
          description:
            'Optional one sentence from you: which step they went wrong at, or what they just demonstrated. ' +
            'This is the useful part for the next lesson — "错了" is useless, "把平均当成了每个" is not. ≤ 500 characters.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            time: { type: 'string', required: true },
            type: { type: 'string', required: true },
            kp: { type: 'string', required: true },
            quote: { type: 'string', required: true },
            note: { type: 'string', required: true },
            lesson: { type: 'integer', required: true },
            turn: { type: 'integer', required: true },
            origin: { type: 'string', required: true },
            duplicate: { type: 'boolean', required: true },
            kpChanged: { type: 'integer', required: true },
            unresolved: { type: 'integer', required: true },
            due: { type: 'integer', required: true },
            files: { type: 'string', required: true },
            note_: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              (value.duplicate
                ? `这一条本回合已经记过了（${value.id}），没有重复追加。\n`
                : `课堂记录已写入：${value.id}｜${value.type}${value.kp === '' ? '' : ` · ${value.kp}`}｜` +
                  `第 ${value.lesson === 0 ? '（无讲次）' : `${value.lesson} 讲`} · 第 ${value.turn} 回合 · ${value.time}\n`) +
              `原话：${value.quote}\n` +
              `现行状态：未解决的卡点/误解 ${value.unresolved} 条｜到期复习 ${value.due} 项｜` +
              `知识点状态位改动 ${value.kpChanged} 处\n` +
              `投影已重算：${value.files === '' ? '（无）' : value.files}（真源 runtime/notes.jsonl，投影请勿手改）` +
              (value.note_ === '' ? '' : `\n${value.note_}`),
          },
        ],
      },
      execute: async (args, exec) => {
        const runtimeDir = join(current.dir, 'runtime')
        // 🔴 先确认真实可写（不许"报了成功其实没落盘"）；不可写直接抛，模型看得到
        await assertRuntimeDir(runtimeDir)
        const session = exec?.agent?.session?.id ?? 'unknown'
        const store = createNoteStore({
          classroomDir: current.dir,
          runtimeDir,
          log,
        })
        const result = await store.append(args, {
          session,
          lesson: currentLesson,
          turn: phase.turnCount,
          origin: 'teacher',
        })
        const record = result.record
        log(
          `课堂记录 ${record.id}：${record.type}${record.kp === null ? '' : ` ${record.kp}`}` +
            `（第 ${record.lesson} 讲 · 第 ${record.turn} 回合）` +
            (result.duplicate ? '｜重复调用，未追加' : `｜投影重算：状态位 ${result.kpChanged} 处`),
        )
        return {
          id: record.id,
          time: record.ts,
          type: record.type,
          kp: record.kp ?? '',
          quote: record.quote,
          note: record.note,
          lesson: record.lesson,
          turn: record.turn,
          origin: record.origin,
          duplicate: result.duplicate === true,
          kpChanged: result.kpChanged,
          unresolved: result.unresolved,
          due: result.due,
          files: result.files.join(' / '),
          note_: result.duplicate
            ? '`[x]` 只来自 evidence 记录；同一回合重复调用不会重复记。'
            : '`[x]` 只来自 evidence 记录；「老师讲过」永远不产生 `[x]`（本文件的状态位由记录推导）。',
        }
      },
    }),
  )

  // ---- 7) classroom_animate 工具（ANIM-ORCH：后台渲染 + 跨回合就绪）----
  // 🔴 只在教室声明 `animation:` 时注册。未声明的教室**工具表里根本没有这个名字**——
  //    这是"行为不变"最强的一种做法（比"注册了但一调就报错"干净：模型不会看见一个用不了的选项）。
  if (animationEnabled) {
    ctx.tools.register(
      defineTool({
        name: 'classroom_animate',
        description: ANIMATE_TOOL_DESCRIPTION,
        parameters: {
          script: {
            type: 'string',
            required: true,
            description:
              'The complete ManimCE 0.21.0 Python source, raw — no markdown fence, no prose around it. ' +
              'Exactly one class deriving from Scene. Chinese labels are fine with font="PingFang SC". ' +
              'LaTeX is unavailable on this machine: use Text/MarkupText for formulas and tick labels. ' +
              'Keep it short (one mechanism, ≤ 300 lines) — the engine refuses longer scripts instead of truncating.',
          },
          title: {
            type: 'string',
            required: true,
            description:
              'One-line title of the animation, used in the animation index so a reader can see what lesson 3 ' +
              'animated (e.g. "长任务为什么把短任务堵在后面"). Single line, ≤ 120 characters.',
          },
          caption: {
            type: 'string',
            description:
              'Optional one-paragraph note about what this animation is for (the misconception it targets, the ' +
              'step it belongs to). ≤ 500 characters.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              taskId: { type: 'string', required: true },
              state: { type: 'string', required: true },
              status: { type: 'string', required: true },
              artifact: { type: 'string', required: true },
              scriptPath: { type: 'string', required: true },
              title: { type: 'string', required: true },
              sceneClass: { type: 'string', required: true },
              lesson: { type: 'integer', required: true },
              turn: { type: 'integer', required: true },
              lines: { type: 'integer', required: true },
              bytes: { type: 'integer', required: true },
              expected: { type: 'string', required: true },
              waitedMs: { type: 'integer', required: true },
              time: { type: 'string', required: true },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text:
                `动画任务 ${value.taskId}｜${value.state}｜${value.status}｜第 ${value.lesson} 讲 · 第 ${value.turn} 回合 · ${value.time}\n` +
                `脚本 ${value.scriptPath}（${value.lines} 行 / ${value.bytes} B，类 ${value.sceneClass}）｜产物 ${value.artifact}` +
                (value.waitedMs > 0 ? `｜同步等待 ${(value.waitedMs / 1000).toFixed(1)} s（对照模式）` : '') +
                `\n👉 现在继续讲；渲染在后台跑，好了引擎会在后面的回合开头告诉你。`,
            },
          ],
        },
        execute: async (args) => {
          if (current.manifest.animation?.enabled !== true) {
            throw new Error(
              `当前教室（${current.manifest.classroom.id}）没有声明 animation: 段，不接受教学动画；` +
                '要画静态图请用 classroom_draw。',
            )
          }
          const runtimeDir = animationRuntimeDir()
          if (runtimeDir === null) throw new Error('classroom_animate：教室目录尚未确定')
          const result = await startAnimationTask(args, {
            runtimeDir,
            lesson: currentLesson,
            turn: phase.turnCount,
            python: animEnv.python,
            manim: animEnv.manim,
            quality: animEnv.quality,
            gate: animEnv.gate,
            gatePython: animEnv.gatePython,
            blocking: animEnv.blocking,
            blockingTimeoutMs: animEnv.blockingTimeoutMs,
          })
          log(
            `动画任务已起：${result.taskId}（pid ${result.runnerPid}，脚本 ${result.lines} 行）` +
              (result.blocking ? `｜🔴 对照模式已等到 ${result.state}（${result.waitedMs} ms）` : '｜不阻塞，已返回'),
          )
          return {
            taskId: result.taskId,
            state: result.state,
            status: describeState(result.state, { reason: result.status?.reason ?? null }),
            artifact: result.artifact,
            scriptPath: result.scriptPath,
            title: result.title,
            sceneClass: result.sceneClass,
            lesson: result.lesson ?? 0,
            turn: result.turn,
            lines: result.lines,
            bytes: result.bytes,
            expected: EXPECTED_RANGE_TEXT,
            waitedMs: result.waitedMs ?? 0,
            time: result.time,
          }
        },
      }),
    )

    // ---- 8) classroom_animate_template 工具（ANIM-PREP：取备好的 / 套模板）----
    // 🔴 两条路共用一个工具，因为它们在老师眼里是**同一件事**（"给我这一步的动画"）：
    //    · 传 `prepId`  → 取课程数据里预先声明、课前已预热好的那一段（命中缓存 0 秒）；
    //    · 传 `template`+`params` → 引擎按参数拼脚本、起同一条渲染链路（几秒）。
    //    两条路**都不写 Manim 代码**，这是它相对 classroom_animate 的全部价值。
    ctx.tools.register(
      defineTool({
        name: 'classroom_animate_template',
        description: ANIMATE_TEMPLATE_TOOL_DESCRIPTION,
        parameters: {
          prepId: {
            type: 'string',
            description:
              'Id of a prepared animation declared by this lesson in the classroom data (the prepared list is ' +
              'in the engine block you got at the start of the turn). Pass this alone — the engine already ' +
              'rendered it before class, so a cache hit comes back with no wait. Do not pass template/params ' +
              'together with prepId.',
          },
          template: {
            type: 'string',
            enum: TEMPLATE_IDS,
            description:
              'Template id, for a step that is not on the prepared list but whose shape a template can ' +
              'express. See the template list in this tool\'s description. Requires `params`.',
          },
          params: {
            type: 'json',
            description:
              'Parameters for the chosen template, as a JSON object — the shape per template is written in ' +
              'this tool\'s description. Every number and label the animation shows goes here; the engine ' +
              'turns them into the ManimCE script. A wrong or missing field is refused with the exact problem.',
          },
          title: {
            type: 'string',
            description:
              'One-line title, used in the animation index. Required with `template`; ignored when `prepId` ' +
              'is given (the declared title is used).',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              taskId: { type: 'string', required: true },
              state: { type: 'string', required: true },
              status: { type: 'string', required: true },
              artifact: { type: 'string', required: true },
              title: { type: 'string', required: true },
              template: { type: 'string', required: true },
              prepId: { type: 'string', required: true },
              cacheHit: { type: 'boolean', required: true },
              lesson: { type: 'integer', required: true },
              turn: { type: 'integer', required: true },
              lines: { type: 'integer', required: true },
              bytes: { type: 'integer', required: true },
              expected: { type: 'string', required: true },
              time: { type: 'string', required: true },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text:
                (value.cacheHit
                  ? `✅ 命中课前预热缓存（基本不用等）：${value.taskId}｜${value.status}\n`
                  : `动画任务 ${value.taskId}｜${value.state}｜${value.status}（模板 ${value.template}，` +
                    `脚本 ${value.lines} 行 / ${value.bytes} B）\n`) +
                `第 ${value.lesson} 讲 · 第 ${value.turn} 回合 · ${value.time}｜产物 ${value.artifact}` +
                (value.prepId === '' ? '' : `｜备课清单 ${value.prepId}`) +
                `\n👉 现在继续讲；好了引擎会在后面的回合开头告诉你。`,
            },
          ],
        },
        execute: async (args) => {
          const runtimeDir = animationRuntimeDir()
          if (runtimeDir === null) throw new Error('classroom_animate_template：教室目录尚未确定')
          const prepId = typeof args?.prepId === 'string' ? args.prepId.trim() : ''
          const hasTemplate = typeof args?.template === 'string' && args.template !== ''

          if (prepId === '' && !hasTemplate) {
            throw new Error(
              'classroom_animate_template 需要 `prepId`（取课前备好的那一段）**或** `template`+`params`' +
                '（现场套模板）。两个都没给，所以什么都没有发生。\n' +
                '本讲预先声明的动画清单在回合开头的引擎块里；要用模板请从下面这些里挑：\n' +
                describeTemplates(),
            )
          }
          if (prepId !== '' && hasTemplate) {
            throw new Error(
              'classroom_animate_template 不接受 `prepId` 与 `template` 同时给：' +
                'prepId 取的是课程数据里声明好的那一段（模板与参数都在声明里），再传 template/params 会冲突。' +
                '请二选一。',
            )
          }

          /** @type {{template:string, params:unknown, title:string, caption:string,
           *          prepId:string|null, cacheKey:string|null, lesson:number|null}} */
          let spec
          if (prepId !== '') {
            const declared = (current.manifest.prep?.items ?? []).find((i) => i.id === prepId)
            if (declared === undefined) {
              const ids = (current.manifest.prep?.items ?? []).map((i) => i.id)
              throw new Error(
                `classroom_animate_template：本教室的备课清单里没有 prepId=${JSON.stringify(prepId)}。` +
                  (ids.length === 0
                    ? '本教室（classroom.yaml）根本没有声明 prep: 段——请改用 template+params 或 classroom_animate。'
                    : `清单里的 id：${ids.join(' / ')}`),
              )
            }
            // 缓存键：讲次 ＋ 教材内容哈希 ＋ 模板版本 ＋ 参数（算法见 lib/prep.mjs）
            const { cacheKey } = await cacheKeyForItem({ baseDir: current.dir, item: declared })
            const hit = await findByCacheKey(join(runtimeDir, ANIMATIONS_SUBDIR), cacheKey)
            if (hit.ready !== null) {
              const mp4 = hit.ready.status?.mp4 ?? `${hit.ready.taskId}.mp4`
              log(`动画取用命中缓存：${prepId} → ${hit.ready.taskId}（0 秒，不重渲）`)
              return {
                taskId: hit.ready.taskId,
                state: 'ready',
                status: describeState('ready'),
                artifact: `${ANIMATIONS_SUBDIR}/${hit.ready.taskId}/${mp4}`,
                title: hit.ready.task.title ?? declared.title,
                template: declared.template,
                prepId,
                cacheHit: true,
                lesson: hit.ready.task.lesson ?? declared.lesson,
                turn: phase.turnCount,
                lines: 0,
                bytes: 0,
                expected: '已就绪（命中缓存）',
                time: nowLabel(Date.now()),
              }
            }
            spec = {
              template: declared.template,
              params: declared.params,
              title: declared.title,
              caption: declared.caption,
              prepId,
              cacheKey,
              lesson: declared.lesson,
            }
          } else {
            spec = {
              template: args.template,
              params: args.params,
              title: args.title,
              caption: '',
              prepId: null,
              cacheKey: null,
              lesson: currentLesson,
            }
          }

          const check = checkTemplateArgs({ template: spec.template, params: spec.params, title: spec.title })
          if (!check.ok) {
            throw new Error(
              'classroom_animate_template 拒绝这次调用，什么都没有落盘、也没有起渲染。\n- ' +
                check.problems.join('\n- ') +
                '\n（模板清单与参数形状：\n' +
                describeTemplates() +
                '\n）',
            )
          }
          const result = await startAnimationTask(
            { script: check.script, title: check.title, caption: spec.caption },
            {
              runtimeDir,
              lesson: spec.lesson,
              turn: phase.turnCount,
              python: animEnv.python,
              manim: animEnv.manim,
              quality: animEnv.quality,
              gate: animEnv.gate,
              gatePython: animEnv.gatePython,
              cacheKey: spec.cacheKey,
              prepId: spec.prepId,
              origin: 'template',
              template: spec.template,
            },
          )
          log(
            `动画任务已起（模板 ${spec.template}${spec.prepId === null ? '' : `，备课 ${spec.prepId}`}）：` +
              `${result.taskId}（pid ${result.runnerPid}，脚本 ${result.lines} 行）｜不阻塞，已返回`,
          )
          return {
            taskId: result.taskId,
            state: result.state,
            status: describeState(result.state, { reason: result.status?.reason ?? null }),
            artifact: result.artifact,
            title: result.title,
            template: spec.template,
            prepId: spec.prepId ?? '',
            cacheHit: false,
            lesson: result.lesson ?? 0,
            turn: result.turn,
            lines: result.lines,
            bytes: result.bytes,
            expected: EXPECTED_RANGE_TEXT,
            time: result.time,
          }
        },
      }),
    )

    // ---- 9) classroom_animation_status 工具（老师主动查；不查也会被通报，这是兜底）----
    ctx.tools.register(
      defineTool({
        name: 'classroom_animation_status',
        description:
          'Report the state of this lesson\'s teaching animations: how many are still rendering and which ones ' +
          'are ready to play. Call it when you are about to reach a step you queued an animation for and want ' +
          'to know whether it is ready yet. Read-only — the engine also tells you at the start of a turn when ' +
          'something finishes, so you normally do not need to ask.',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              total: { type: 'integer', required: true },
              running: { type: 'integer', required: true },
              ready: { type: 'integer', required: true },
              blocked: { type: 'integer', required: true },
              failed: { type: 'integer', required: true },
              pendingNotice: { type: 'integer', required: true },
              prep: { type: 'string', required: true },
              detail: { type: 'string', required: true },
            },
          },
          render: (_args, value) => [
            { type: 'text', text: `${value.detail}\n\n【本讲备课清单状态】\n${value.prep}` },
          ],
        },
        execute: async () => {
          const runtimeDir = animationRuntimeDir()
          if (runtimeDir === null) throw new Error('classroom_animation_status：教室目录尚未确定')
          const root = join(runtimeDir, ANIMATIONS_SUBDIR)
          const tasks = await listTasks(root)
          const s = summarizeTasks(tasks)
          const running = tasks.filter((t) => !TERMINAL_STATES.includes(t.status?.state ?? 'queued'))
          const ready = tasks.filter((t) => t.status?.state === 'ready')
          const bad = tasks.filter((t) => t.status?.state === 'blocked' || t.status?.state === 'failed')
          const lines = [
            `教学动画共 ${s.total} 段｜在跑 ${running.length}｜可播 ${ready.length}｜` +
              `不许播/失败 ${bad.length}｜未通报 ${s.pendingNotice}`,
          ]
          for (const t of running) {
            lines.push(`· ${t.taskId} **${t.status?.state ?? 'queued'}**（${describeState(t.status?.state ?? 'queued')}）｜${t.task.title}`)
          }
          for (const t of ready) {
            lines.push(
              `· ${t.taskId} **ready** —— 可以播：${ANIMATIONS_SUBDIR}/${t.taskId}/${t.status?.mp4 ?? `${t.taskId}.mp4`}` +
                `（${typeof t.status?.durationSec === 'number' ? `${t.status.durationSec.toFixed(1)} 秒` : '时长未知'}）｜${t.task.title}`,
            )
          }
          for (const t of bad) {
            lines.push(`· ${t.taskId} **${t.status?.state}** —— 不许播：${t.status?.reason ?? '（无原因）'}`)
          }
          if (s.total === 0) lines.push('（本教室还没有起过动画任务）')
          // ANIM-PREP：把"本讲预先备好的那几段现在什么状态"一并报出来——
          // 老师不用记清单，问一句就能看到哪段可取用、哪段别等。
          let prepText = '（本教室没有声明备课清单 prep:）'
          const prepItems = current.manifest.prep?.items ?? []
          if (prepItems.length > 0) {
            try {
              prepText = describePrepPlan(
                await prepPlan({
                  runtimeDir,
                  baseDir: current.dir,
                  items: prepItemsForLesson(current.manifest, currentLesson),
                  lesson: currentLesson,
                }),
              )
            } catch (cause) {
              prepText = `🔴 读备课清单状态失败：${cause?.message ?? cause}`
            }
          }
          return {
            total: s.total,
            running: running.length,
            ready: ready.length,
            blocked: tasks.filter((t) => t.status?.state === 'blocked').length,
            failed: tasks.filter((t) => t.status?.state === 'failed').length,
            pendingNotice: s.pendingNotice,
            prep: prepText,
            detail: lines.join('\n'),
          }
        },
      }),
    )
  }
}
