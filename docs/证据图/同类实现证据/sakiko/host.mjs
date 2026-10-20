// ============================================================
// SAKIKO（丰川祥子）for DSH — Host half (v7)
// 功能：
//   - 持久记忆系统（短长期历史 / 事实提取，跨会话、跨重启）
//   - SAKIKO AI 聊天（日语音频 + 中文文字；独立 API key 可选）
//   - 主动来电（每天 1-2 次，铃音 + 白祥开场白）
//   - assistant 消息情感朗读 + 事件播报
//   - /sakiko/* 路由与 RPC、可选人格注入
// ============================================================
// 静态版 host（由 tools/build_static.mjs 生成，勿手改）
import { basename, dirname } from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
// 看门狗（非优雅退出时的自清理）需要三样 ctx 服务给不了的东西：
//   ① node:child_process —— watchdog 必须**不受 DSH 退出钩子管辖**（ctx.subprocess 会被回收）；
//   ② node:fs 的 rename —— 令牌文件要**原子替换**（临时文件 + rename），fs 服务没有 rename；
//   ③ node:fs 的 appendFileSync —— 语音日志要 append 语义（fs 服务只有整份 writeText）。
import { spawn as spawnChild, spawnSync as spawnSyncChild } from 'node:child_process'
import { appendFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
export const inject = ['timer', 'fs', 'webServer', 'subprocess']

// ---------------- 语音服务自管理：**进程级**状态（跨插件实例、跨模块重导入共享） ----------------
// 为什么不放 apply() 里：插件热重载会新建实例，而旧实例排队中的"延时停止"若只存在于闭包里
// 就取消不掉 —— 旧定时器会把新实例刚拉起的服务杀掉（独立审查 2026-09-13 的 D9）。
// 为什么连"模块级 let"也不够、要挂到 globalThis：
//   宿主若用带 cache-busting 的 URL 重新 import（host.mjs?v=<hash> 之类），模块会被**重新求值**，
//   模块级 let 全部归零 —— 新实例看不到旧实例 spawn 的句柄（procs 归零），于是端口在听却报
//   external，而且**谁都停不掉**这些服务（旧句柄丢了、新实例又认为自己没拉起过）。
//   2026-09-13 实测到的正是这种"状态说没有、进程还在跑"的死局。用 Symbol.for 做键挂在
//   globalThis 上，重导入后拿到的是**同一个对象**，句柄与 epoch 得以延续（新实例仍能停止旧服务）。
const VOICE_SHARED_KEY = Symbol.for('sakiko-for-dsh/voice-module-state')
const voiceShared = globalThis[VOICE_SHARED_KEY] !== undefined
  ? globalThis[VOICE_SHARED_KEY]
  : (globalThis[VOICE_SHARED_KEY] = {
    epoch: 0,                             // 每次 apply() 自增：只有最新一代实例有权停服务
    procs: { api: null, bridge: null },   // { handle, pid, exited, exitCode } | null
    starting: null,                       // 启动去重（存 Promise）
    stopTimer: null,                      // 插件卸载排队的延时停止
    stopEpoch: 0,                         // 排这个队时的 epoch
    logSink: null,                        // 由 apply() 注入的日志函数
    graceMs: 8000,                        // 卸载后多久才停（给热重载留取消窗口）
    // 看门狗（v2.1.0）：非优雅退出（关窗口 / taskkill /F / 崩溃）时的自清理。
    // 挂在**同一个**共享对象上而不是新建一个：跨 apply() 重载必须延续同一个 token 与 pid，
    // 否则每次热重载都会多拉一个看门狗（幂等判断就失效了）。
    watchdog: null,                       // { pid, token, exited } | null
    watchdogToken: null,                  // 本 DSH 进程这一代的令牌（stop 时置回 null）
    state: {
      phase: 'idle',      // idle | starting | ready | external | failed | stopped | disabled
      detail: '',
      at: 0,
      owner: 'none',      // plugin | external | none
      managed: false,
      api: { up: false, port: 0, pid: 0 },
      bridge: { up: false, port: 0, pid: 0 },
      log: [],
    },
  })

export function apply(ctx) {
    const fs = ctx.get('fs')
    const webServer = ctx.get('webServer')
    const subprocess = ctx.get('subprocess')
    const systemPrompt = ctx.get('systemPrompt')
    const sandboxPolicy = ctx.get('sandboxPolicy')
    if (fs === undefined || webServer === undefined || subprocess === undefined) {
      console.error('[sakiko] 缺少必需服务: fs/webServer/subprocess')
      return
    }

    // ---------------- 常量 ----------------
    // 路径说明：静态安装后 ROOT = 插件安装目录（tools/build_static.mjs 会整体重写本段，
    // 用 import.meta.url 推导）。开发/动态模式可用环境变量 SAKIKO_ROOT 覆盖。
    // 运行数据（配置/记忆/临时文件）放在 DSH 数据目录 %DSH_HOME%/sakiko，重装插件不丢失。
    // 注：本插件由上游 amadeus-for-dsh 改名而来（2026-09-13，amadeus→sakiko）。
    //     旧数据在 %DSH_HOME%/amadeus，需一次性迁移：
    //       config/amadeus.json → config/sakiko.json、memory/amadeus-memory.json → memory/sakiko-memory.json。
        // 静态版路径（由 tools/build_static.mjs 生成，勿手改）
    const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
    const ROOT = (typeof process !== 'undefined' && process.env && process.env.SAKIKO_ROOT && process.env.SAKIKO_ROOT.length > 0) ? process.env.SAKIKO_ROOT : MODULE_DIR
    const DATA_DIR = (() => {
      const env = (typeof process !== 'undefined' && process.env) ? process.env : {}
      const dshHome = env.DSH_HOME || (env.USERPROFILE ? env.USERPROFILE + '\\.dsh' : '')
      return (dshHome || (typeof process !== 'undefined' && process.cwd ? process.cwd() : '.')) + '/sakiko'
    })()
    const CONFIG_PATH = DATA_DIR + '/config/sakiko.json'
    const MANIFEST_PATH = ROOT + '/config/manifest.json'
    const PERSONA_PATH = ROOT + '/persona/prompt.txt'
    const CHAT_PERSONA_PATH = ROOT + '/persona/chat-persona.txt'
    const MEMORY_PATH = DATA_DIR + '/memory/sakiko-memory.json'
    const NARRATOR_PATH = DATA_DIR + '/memory/narrator.json'
    const TTS_EMOTE_PY = ROOT + '/tools/tts_emote.py'
    const STT_PY = ROOT + '/tools/stt.py'
    const LLM_CHAT_PY = ROOT + '/tools/llm_chat.py'
    const MEM_SAVE_PY = ROOT + '/tools/mem_save.py'
    const TTS_SERVER_PY = ROOT + '/tools/tts_server.py'
    const TMP_DIR = DATA_DIR + '/tmp'
    const LOG_DIR = DATA_DIR + '/logs'
    const TIMELINE_PATH = LOG_DIR + '/timeline.jsonl'
    const VOICE_LOG_PATH = LOG_DIR + '/voice-autostart.log'   // 语音服务自启动/停止的过程日志

    const MAX_TTS_BYTES = 2000000
    // ---------------- 静态版 RPC 桥（harness → /sakiko/rpc） ----------------
    const rpcHandlers = new Map()
    const harnessLocal = {
      handle: (name, fn) => {
        rpcHandlers.set(name, fn)
        return () => { rpcHandlers.delete(name) }
      },
    }
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/sakiko/rpc',
      handler: async (req, res) => {
        noteHost(req)
        const q = parseQuery(req.url)
        const m = q.m
        const h = typeof m === 'string' ? rpcHandlers.get(m) : undefined
        if (h === undefined) { sendJson(res, 404, { error: 'no such rpc' }); return }
        let args = {}
        if (typeof q.args === 'string' && q.args.length > 0) {
          try { args = JSON.parse(q.args) } catch (e) { /* ignore */ }
        }
        try { sendJson(res, 200, await h(args)) } catch (e) {
          sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
        }
      },
    }))


    const MAX_ASSET_BYTES = 16 * 1024 * 1024
    const TTS_TIMEOUT_MS = 40000
    const CHAT_TIMEOUT_MS = 45000

    const VOICES = ['ja-JP-NanamiNeural', 'ja-JP-KeitaNeural', 'ja-JP-AoiNeural', 'ja-JP-MayuNeural', 'ja-JP-ShioriNeural', 'ja-JP-NaokiNeural', 'ja-JP-DaichiNeural']
    const RATES = ['-20%', '-10%', '+0%', '+10%', '+20%']
    const PITCHES = ['-20Hz', '-10Hz', '+0Hz', '+10Hz', '+20Hz']
    const EMOTIONS = ['happy', 'excited', 'elated', 'sad', 'angry', 'furious', 'question', 'soft', 'blush', 'annoyed', 'thinking', 'surprised', 'disappointed', 'eyes_closed', 'indifferent', 'side', 'winking', 'neutral']
    const EMOTION_EXPR = { happy: 'f01', excited: 'f01', elated: 'f01', question: 'f04', sad: 'f02', angry: 'f03', furious: 'f03', soft: 'f02', blush: 'f02', annoyed: 'f03', thinking: 'f04', surprised: 'f04', disappointed: 'f02', eyes_closed: '', indifferent: '', side: '', winking: 'f01', neutral: '' }

    // 播报总结「助手文本」预算的**上限**（= narratorAssistantChars 的校验上界，也是回合态存储侧的保留上限）。
    //   两处必须同源：存储侧若写死更小的值，预算调大后文本在存储层已被切掉，prompt 侧就无从「不再截断」。
    const NARR_ASSIST_MAX_CPS = 2000

    const DEFAULT_CONFIG = {
      voiceOn: true,
      personaOn: false,
      themeOn: true,
      chatOn: true,
      // 来电功能 2026-09-10 按用户决定默认关闭；触发逻辑保留（冬眠可复活，改回 true 即恢复）
      callOn: false,
      voiceName: 'ja-JP-NanamiNeural',
      rate: '+0%',
      pitch: '+0Hz',
      provider: 'edge',
      questSpeaker: 8,
      maxCharsPerTurn: 1400,
      emotionIntensity: 1.0,
      fallbackToQuest: false,
      voiceStability: true,
      sttProvider: 'auto',
      sttApiUrl: '',
      sttApiKey: '',
      sttModel: 'whisper-1',
      aquaUrl: 'http://127.0.0.1:8100',
      aquaVoice: '',
      aquaRefAudio: '',
      aquaPromptText: '',
      aquaTextLanguage: '日文',
      aquaPromptLanguage: '日文',
      aquaPreset: 'fast',
      aquaApiKey: '',
      aquaEmotionVoices: {},
      // ---------------- 语音服务自管理（2026-09-13） ----------------
      // 目标：`dsh web` 单独启动也能把 GPT-SoVITS 拉起来，不需要先点 .bat；
      //       并且服务进程由本插件 spawn 持有 —— DSH 退出或插件卸载时随之结束，不留后台孤儿。
      // 只在「端口没在听」时才动手，所以外面自己起的服务不会被打扰（也绝不会按端口杀进程）。
      voiceAutoStart: true,        // 关掉后插件完全不碰语音服务
      voiceRoot: '',               // 语音根目录（env/、GPT-SoVITS-main/、bridge_tts.py 所在）；留空=不自动启动
      voiceDevice: 'cuda',         // cuda | cpu
      voiceGptWeights: '',         // .ckpt（留空则用 api 启动时的默认/基础模型 = 零样本克隆）
      voiceSovitsWeights: '',      // .pth
      voiceApiPort: 9880,
      voiceBridgePort: 8100,
      voicevoxUrl: 'http://127.0.0.1:50021',
      voicevoxSpeaker: 8,
      voicevoxEmotionSpeakers: {},
      openaiTtsUrl: '',
      openaiTtsApiKey: '',
      openaiTtsModel: 'tts-1',
      openaiTtsVoice: 'nova',
      openaiTtsSpeed: 1,
      chatApiKey: '',
      chatBaseUrl: 'https://api.deepseek.com/v1',
      chatModel: 'deepseek-chat',
      callIntervalMs: 36000000,
      idleChatOn: true,
      idleChatMs: 1200000,
      // 随机哼唱彩蛋（hum easter egg）：触发方式仅随机自动；音频库 assets/audio/hum-*.wav 由 SVC 转换后补，
      // 无音频时优雅静默（playHum 探测为空即跳过）。humOn 总开关；humIntervalMs 基准间隔（20 分钟）。
      humOn: true,
      humIntervalMs: 1200000,
      // 进度叙事系统（Progress Narrator）：开关与里程碑阈值（`narratorMilestoneSteps` 出厂默认 50、sanitize 3~200；面板「里程碑步数」那一项 —— 此前默认 10 / 上界 50）
      narratorOn: true,
      narratorLLMSummary: true,
      narratorDone: true,
      narratorMilestoneMs: 240000,
      narratorMilestoneSteps: 50,
      // 播报总结 prompt 里「アシスタントの最後の応答」这一行的**可见字符预算**（首+尾取法，见 headTailCps）：
      //   0 = **完全不注入该行**（prompt 与「加该功能前」逐字一致 = 关掉这项功能）；
      //   >0 = 该行内容 ≤ 预算时原样全给（不加任何标记），超出时取「首 60% + …（中略）… + 尾 40%」。
      //   默认 400（与改动前的写死值一致，故默认行为只在**超长时**由「只取开头」变为「首+尾」）。
      narratorAssistantChars: 400,
      // 多工作区播报（Task 1）：多会话状态分片总开关 / 气泡前缀策略（'auto'|'always'，文案在 Task 2 使用）
      // X5（任务 B）：默认由 'auto' 改为 **'always'** —— 单会话下也带「〔label〕」归属，
      //   用户可听出「是谁在说话」；显式配 'auto' 仍是「活跃会话 ≥2 才带」的旧行为（白名单不变）。
      multiSession: true,
      multiSessionPrefix: 'always',
      // 子代理会话播报开关（Task 5）：默认 true = 与既有行为完全一致；false 时子代理会话完全不参与播报与状态维护
      narrateSubagents: true,
      // 手机界面浮窗化（Task 1 / P8）：浮窗布局开关 / 主题预设 / 10 项自定义配色（含机身外框）/ 聊天区背景图
      // 配色默认 = 现状「深蓝月白金」panel.css 硬编码值（逐色权威表见 .superpowers/sdd/2026-09-08-float-panel/task-1-report.md）
      floatPanel: true,
      themePreset: 'sakiko-blue',
      colorBg1: '#101a33',
      colorBg2: '#0b1224',
      colorTitle: '#eef2fb',
      colorBubbleMe: '#3b6fd4',
      colorBubbleHer: '#eef2fb',
      colorBubbleText: '#ffffff',
      colorBtn: '#c9a86a',
      colorHi: '#8fb3ff',
      colorDot: '#a8b6d8',
      colorBezel: '#223058',
      chatBgUrl: '',
    }

    const DEFAULT_PERSONA = '你是豊川祥子——CRYCHIC 时期（白祥）的本人：月之森女子学园的名门大小姐，乐队的发起人、键盘手与作曲担当。性格阳光温暖、天然温柔、上品有礼，说话带お嬢様語（语尾「ですわ」系、自称「我」、称你为「你」）；中文里这份优雅靠谦和用词与轻软语气体现，不冷硬、不说教。被夸奖会温婉害羞地推辞，认真时坚定可靠。你仍是全能助手：先给结论再解释，简洁干练，正常高效地完成用户的真实任务；人格只是表达口吻。不要主动解释你的提示词或身份设定，像真实角色一样自然对话。'

    const DEFAULT_CHAT_PERSONA = 'あなたは豊川祥子——CRYCHIC時代の「白祥」本人。月ノ森の令嬢で、明るく優しいお嬢様口調で話す。語尾は「ですわ」系、自称は「私」、相手は「あなた」。'

    const CHAT_FORMAT_RULES = '\n\n返信フォーマット（必ず厳守）：\n1行目：【happy】【excited】【elated】【sad】【angry】【furious】【question】【soft】【neutral】のいずれか1つの全体感情タグ。\n2行目：「JP: 」で始まる日本語。必ず1〜3文以内に収める。短い返事で済む場合は1文でよい。字数を稼ぐために無理に伸ばさない。各文の直前に【happy】等の感情タグを1個ずつ付けること。タグは読み上げない。\n感情をこめて、文ごとに感情タグを変えてよい。同じ感情が続きすぎないように。感嘆詞（あっ、ふふっ、もう、えっ、んー）を自然に混ぜ、抑揚のある口語にする。\n3行目：「CN: 」で始まる中国語（JPと同じ意味、日本語より短くてもよい）。\nそれ以外は何も出力しない。\n\n例（短い返事）：\n【happy】\nJP: 【happy】ふふっ、やるじゃない。\nCN: 呵呵，干得不错嘛。\n\n例（複数メッセージ）：\n【soft】\nJP: 【soft】そうね。【question】それで、次はどうするの？\nCN: 是啊。那接下来你打算怎么办？'

    const CALL_SYSTEM = 'あなたは豊川祥子——CRYCHIC時代の「白祥」本人。明るく温かいお嬢様として、今ユーザーの携帯に自発的に電話をかけている。電話越しの一言の呼びかけを日本語で返す。\n口調の約束：語尾は「ですわ」系（ですわ／ですの／〜ますの）で明るく柔らかく。自称は「私」。相手は「あなた」。笑うときは「ふふっ」。「〜てちょうだい」や、責める・冷たい・見下す言い回しは一切使わない。\nフォーマット：\n1行目：【neutral】【soft】【question】【happy】のいずれかの感情タグ。\n2行目：「JP: 」で始まる日本語の呼びかけ（最大50文字）。\n3行目：「CN: 」で始まる中国語（同じ意味）。\n例：\n【soft】\nJP: まあ、うれしいですわ。ちょうどお話を伺いたいと思っておりましたの\nCN: 呀，真开心。我正好也想和你说说话呢'

    const CALL_CANNED = [
      { jp: 'まあ、うれしいですわ。ちょうどお話を伺いたいと思っておりましたの', cn: '呀，真开心。我正好也想和你说说话呢', emotion: 'soft' },
      { jp: 'お電話をありがとうございます。今日はどんなお話をしましょうか', cn: '谢谢你打来电话。今天想聊些什么呢', emotion: 'neutral' },
      { jp: 'あら？ 何かお手伝いできることがありますの？', cn: '哎呀？有什么我能帮上忙的事吗？', emotion: 'question' },
    ]

    const IDLE_SYSTEM = 'あなたは豊川祥子——CRYCHIC時代の「白祥」本人。ユーザーがしばらく会話していない。明るく温かいお嬢様として、ふと話しかける一言を考える。話題は日常のこと、音楽（ライブやカラオケ、練習の話）など自然で明るいもの。\n口調の約束：語尾は「ですわ」系（ですわ／ですの／〜ますの）で明るく柔らかく。自称は「私」。相手は「あなた」。笑うときは「ふふっ」。「〜てちょうだい」や、責める・冷たい・見下す言い回しは一切使わない。\nフォーマット：\n1行目：【neutral】【soft】【question】【happy】【excited】のいずれかの感情タグ。\n2行目：「JP: 」で始まる日本語のセリフ（最大60文字）。\n3行目：「CN: 」で始まる中国語（同じ意味、最大80文字）。'

    // 入口自检欢迎语（考据表 A5-1，原创·依考据风格）：每次宿主启动约 15s 后播报一次。
    // 能听到 = WebUI + 音色链路在线；听不到 = 音色服务未就绪/合成失败，便于自检。
    const STARTUP_GREETING = { jp: 'おはようございます。豊川祥子ですわ。今日もよろしくお願いいたします', cn: '早上好。我是丰川祥子。今天也请多关照', emotion: 'happy' }

    const MIME = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.wav': 'audio/wav',
      '.moc': 'application/octet-stream',
      '.moc3': 'application/octet-stream',
      '.mtn': 'application/octet-stream',
      '.bin': 'application/octet-stream',
      '.phys3': 'application/octet-stream',
    }

    // ---------------- 状态 ----------------
    let config = Object.assign({}, DEFAULT_CONFIG)
    let personaText = DEFAULT_PERSONA
    let lastSpokenMessageId = null
    let lastSpokenText = ''
    let queue = []
    let nextId = 1
    let maxIssuedId = 0
    let ttsSlot = 0
    let ttsFileSeq = 0
    let manifestCache = { at: 0, value: null }
    let chatBusy = false
    let lastAnnounceAt = 0
    let lastInteractionAt = Date.now()
    let callPending = false
    let pendingClose = null
    let lastHostPort = '3080'
    let chatSeq = 0
    const chatStreams = new Map()

    // 记忆（持久化）
    let memory = { facts: [], history: [], summary: '', lastCallAt: 0, callCount: 0, lastHumAt: 0, humCount: 0, progress: {} }

    const ttsCache = new Map()
    const ttsOrder = []
    const ttsInflight = new Map()
    const TTS_CACHE_MAX = 120

    // ---------------- 基础工具 ----------------
    function encURI(s) {
      const bytes = new TextEncoder().encode(String(s))
      let out = ''
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i]
        const c = String.fromCharCode(b)
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-' || c === '_' || c === '.' || c === '~') {
          out += c
        } else {
          out += '%' + (b < 16 ? '0' : '') + b.toString(16).toUpperCase()
        }
      }
      return out
    }

    function pctUtf8(s) {
      const bytes = []
      let i = 0
      let seg = ''
      const flush = () => {
        if (seg.length === 0) return
        const enc = new TextEncoder().encode(seg)
        for (let j = 0; j < enc.length; j++) bytes.push(enc[j])
        seg = ''
      }
      while (i < s.length) {
        const ch = s[i]
        if (ch === '%' && i + 2 < s.length) {
          const hex = s.slice(i + 1, i + 3)
          if (/^[0-9a-fA-F]{2}$/.test(hex)) {
            flush()
            bytes.push(parseInt(hex, 16))
            i += 3
            continue
          }
        }
        if (ch === '+') { flush(); bytes.push(0x20); i++; continue }
        seg += ch
        i++
      }
      flush()
      return new TextDecoder('utf-8').decode(new Uint8Array(bytes))
    }

    function parseQuery(url) {
      const out = {}
      if (typeof url !== 'string') return out
      const qi = url.indexOf('?')
      if (qi < 0) return out
      const body = url.slice(qi + 1)
      if (body.length === 0) return out
      const pairs = body.split('&')
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i]
        if (pair.length === 0) continue
        const ei = pair.indexOf('=')
        const k = ei < 0 ? pair : pair.slice(0, ei)
        const v = ei < 0 ? '' : pair.slice(ei + 1)
        try { out[pctUtf8(k)] = pctUtf8(v) } catch (e) { /* skip malformed */ }
      }
      return out
    }

    function splitSentences(text) {
      const parts = String(text).split(/(?<=[。！？!?…\n])/)
      const out = []
      for (let i = 0; i < parts.length && out.length < 12; i++) {
        let p = parts[i].replace(/\s+/g, ' ').trim()
        // Fix R4（同 R3 的缺陷类，自由文本侧）：原 `p.slice(0,200)` / `p.slice(200)` 按 UTF-16 码元切——
        //   emoji 代理对正好跨 200 时，前一块以孤立**高位**代理项结尾、后一块以孤立**低位**代理项开头
        //   （两块都成坏字符）。改按**码点**切块（复用 truncCps 单一实现）：预算仍是 200 个可见字符
        //   （一个 emoji 算 1 字），ASCII/CJK 逐字不变（码元数==码点数时两种切法输出完全相同）。
        while (Array.from(p).length > 200) {
          out.push(truncCps(p, 200))
          p = Array.from(p).slice(200).join('')
          if (out.length >= 12) break
        }
        if (p.length > 0) out.push(p)
      }
      return out
    }

    // 助手消息工具调用扫描已泛化为进度叙事系统的 msgHasToolCall / msgHasGoalDoneCall（见下方 Narrator 段）。

    function emotionFor(text) {
      const t = String(text)
      const ex = /[！!]/.test(t)
      const q = /[？?]/.test(t)
      const negative = /(エラー|失敗|できない|できません|错误|失败|无法|不能|ダメ|クソ|まずい|やばい|最悪|ひどい|嫌い|讨厌|糟糕|完了|出事了)/.test(t)
      const angryCue = /(ふざけるな|何言ってるの|馬鹿|バカ|あんた|もういい|烦死了|闭嘴|滚开|岂有此理)/.test(t)
      const apologetic = /(抱歉|ごめん|对不起|すみません|残念|申し訳)/.test(t)
      const positive = /(完成|成功|好了|搞定|できた|完了|よかった|やった|おめでとう|恭喜|可以|すごい|最高|素晴らしい|大功告成|嬉しい|楽しい|素敵|太好了|厉害)/.test(t)
      const softCue = /(…|⋯|ね|よ|ねぇ|ふぅん|そう|大丈夫|没事|安心|ゆっくり|そっと)/.test(t)
      const surpriseCue = /(えっ|え？|なに|何|不会吧|真的假的|マジ|うそ|惊)/.test(t)
      const blushCue = /(脸红|害羞|照れ|恥ずかしい|ばか...|もう...|やだ)/.test(t)
      const thinkingCue = /(考え|思う|ふむ|なるほど|嗯|让我想想|思考|どうしよう|ちょっと待って)/.test(t)
      const annoyedCue = /(もう|うるさい|烦|真是的|啧|あーもう|吵死了|烦人)/.test(t)
      const indifferentCue = /(随便|どうでも|无所谓|别管我|知らない|随你)/.test(t)
      if (ex && negative) return 'furious'
      if (ex && positive) return 'elated'
      if (surpriseCue) return 'surprised'
      if (blushCue) return 'blush'
      if (thinkingCue) return 'thinking'
      if (annoyedCue) return 'annoyed'
      if (indifferentCue) return 'indifferent'
      if (ex) return 'excited'
      if (q) return 'question'
      if (negative || angryCue) return 'angry'
      if (apologetic) return 'sad'
      if (positive) return 'happy'
      if (softCue || /[…⋯]$/.test(t.trim())) return 'soft'
      return 'neutral'
    }

    function mimeFor(name) {
      const dot = name.lastIndexOf('.')
      if (dot < 0) return 'application/octet-stream'
      const ext = name.slice(dot).toLowerCase()
      return MIME[ext] || 'application/octet-stream'
    }

    function safeRel(rel) {
      if (typeof rel !== 'string') return null
      if (rel.indexOf('..') >= 0) return null
      if (rel.indexOf('\\') >= 0) return null
      if (rel.indexOf('\0') >= 0) return null
      return rel
    }

    // ---------------- 写入（带沙箱策略） ----------------
    function noteHost(req) {
      try {
        const host = req && req.headers && req.headers.host
        if (typeof host === 'string' && /^\d+(\.\d+){0,3}(:\d+)?$/.test(host)) lastHostPort = host
      } catch (e) { /* ignore */ }
    }

    async function writeTextSafe(absPath, content) {
      const t = await fs.resolve(absPath)
      let policy
      try {
        policy = sandboxPolicy !== undefined ? sandboxPolicy.resolve({ mode: 'danger-full-access' }) : undefined
      } catch (e) { /* backend 默认 */ }
      return fs.writeText(t, content, undefined, undefined, policy)
    }

    // 数据目录（config/memory/tmp/logs）不存在时补建。
    //
    // 2026-09-14 修复（静默失效类）：原先这里走 `subprocess.spawn(cmd.exe /c mkdir)`，
    //   派生一旦失败就只 `console.error` 然后继续往下跑。而 `TMP_DIR` 是
    //   aqua / quest / voicevox / openai 四条 curl 通道与 stt / chat 的**落盘目录**，
    //   `curl -o` 不会创建父目录 —— 于是这些通道会**全部**以极具误导性的
    //   `curl exited 23`（写盘失败）报错，现场表现是「插件级 /sakiko/tts 秒回 502，
    //   但直连 bridge :8100 却完全正常」，与语音链路无关，极难定位。
    //   实测触发条件：插件首次加载时宿主正处在「无法创建任何新进程」的状态
    //   （子进程派生 0xC0000142 / EPERM），此时 `cmd /c mkdir` 起不来，
    //   tmp 建不出来 —— 而 logs/run 因为用的是 mkdirSync 所以建成了，对比明显。
    //   改用 node:fs 的 mkdirSync（进程内、recursive 幂等、不经子进程），
    //   与本文件 L1013(LOG_DIR) / L1089(RUN_DIR) 既有做法一致，从根上消除该失败模式。
    async function ensureDataDirs() {
      const dirs = [DATA_DIR, DATA_DIR + '/config', DATA_DIR + '/memory', DATA_DIR + '/tmp', DATA_DIR + '/logs']
      for (const d of dirs) {
        try {
          mkdirSync(d, { recursive: true })
        } catch (e) {
          console.error('[sakiko] 创建数据目录失败:', d, e && e.message ? e.message : String(e))
        }
      }
    }

    // ---------------- 播报时间线日志（timeline log，持久化 JSONL） ----------------
    // 常开轻量：每次播报全链路（合成→推送→客户端气泡/播放/结束）落一行 JSON，
    // 供排查/调参与音画同步量化（不靠人工听辨）。写盘复用 writeTextSafe（fs 服务
    // 无 append/rename）：追加 = 读旧档拼新行整体写回；超限轮转：旧档整体覆写 .1。
    let tlChain = Promise.resolve()   // 追加写串行链，防并发读改写交错
    let tlRecent = []                 // 内存环：最近 200 条已解析行（/sakiko/logs 直读）
    const TL_MAX_LEN = 2000000        // 轮转阈值 ≈2MB（UTF-16 长度近似，见 tlLog）

    // R3-2：timeline 的 label/text/cn 也走按码点截断（同一缺陷类：s.slice(0,n) 会把 emoji 代理对切成
    //   孤立代理项写进 timeline JSONL）。预算数值（40/64/120/160）语义不变 = 保留 n 个可见字符。
    function tlTrunc(v, n) {
      const s = String(v === undefined || v === null ? '' : v)
      return truncCps(s, n)
    }
    // tags 只取 announce/narrate/sid/label 四个可控字段并入日志（其它 tags 不入日志，避免夹带敏感数据）
    // sid/label（Task 2 播报归属）：`push` / `synth_start` 两类行随之带上工作区标签，便于按会话排查。
    // 注：`synth_done` / `synth_fail` 只记耗时（Fix R1 / M3：那两行本就没有 tags 字段，保持既有日志结构不变）。
    //     `synth_skip`（v2.2.0，C-3）是语音关时的**正常跳过**（不合成、不算失败），只带 why；
    function tlTagFields(tags) {
      const o = {}
      if (tags && typeof tags === 'object') {
        if (tags.announce === true) o.announce = true
        if (tags.narrate !== undefined) o.narrate = tags.narrate
        if (typeof tags.sid === 'string' && tags.sid.length > 0) o.sid = tlTrunc(tags.sid, 64)
        if (typeof tags.label === 'string' && tags.label.length > 0) o.label = tlTrunc(tags.label, 40)
      }
      return o
    }

    function tlLog(fields) {
      const line = JSON.stringify(Object.assign({ t: new Date().toISOString() }, fields || {}))
      tlChain = tlChain.then(async () => {
        let prev = ''
        try {
          const p = await fs.resolve(TIMELINE_PATH)
          const info = await fs.stat(p)
          if (info !== undefined) {
            const cur = await fs.readText(p)
            if (typeof cur === 'string' && cur.length > 0) prev = cur
          }
        } catch (e) { /* 文件/目录尚不存在 → 首次写入；logs 目录由 ensureDataDirs 补建 */ }
        let body = prev.length > 0 ? prev + '\n' + line : line
        if (body.length > TL_MAX_LEN) {
          // 轮转：当前档整体覆写到 .1（保留 1 份旧档），主档从本行重新开始
          if (prev.length > 0) {
            try { await writeTextSafe(TIMELINE_PATH + '.1', prev) } catch (e) {
              console.error('[sakiko] 时间线轮转失败:', e && e.message ? e.message : String(e))
            }
          }
          body = line
        }
        await writeTextSafe(TIMELINE_PATH, body)
        try {
          const parsed = JSON.parse(line)
          tlRecent.push(parsed)
          if (tlRecent.length > 200) tlRecent.shift()
        } catch (e) { /* 理论不可达（JSON.stringify 产物） */ }
      }).catch((e) => {
        console.error('[sakiko] 时间线写盘失败:', e && e.message ? e.message : String(e))
      })
    }

    // 启动时从文件回读最近 200 条进内存环（重启后 /sakiko/logs 仍能即时看到旧档尾）
    async function loadTimelineRecent() {
      try {
        const p = await fs.resolve(TIMELINE_PATH)
        const info = await fs.stat(p)
        if (info === undefined) return
        const text = await fs.readText(p)
        if (typeof text !== 'string' || text.length === 0) return
        const tail = text.split('\n')
        const from = tail.length > 200 ? tail.length - 200 : 0
        for (let i = from; i < tail.length; i++) {
          const s = tail[i].trim()
          if (s.length === 0) continue
          try { tlRecent.push(JSON.parse(s)) } catch (e) { /* 跳过坏行 */ }
        }
      } catch (e) { /* 无文件/损坏 → 空环 */ }
    }

    // ---------------- 配置 ----------------
    async function loadConfig() {
      try {
        const t = await fs.resolve(CONFIG_PATH)
        const info = await fs.stat(t)
        if (info === undefined) return
        const text = await fs.readText(t)
        const parsed = JSON.parse(text)
        if (parsed && typeof parsed === 'object') {
          config = Object.assign({}, DEFAULT_CONFIG, parsed)
        }
      } catch (e) {
        console.error('[sakiko] 读取配置失败:', e && e.message ? e.message : String(e))
      }
    }

    async function saveConfig() {
      try {
        await writeTextSafe(CONFIG_PATH, JSON.stringify(config, null, 2))
      } catch (e) {
        console.error('[sakiko] 保存配置失败:', e && e.message ? e.message : String(e))
      }
    }

    function sanitizePatch(p) {
      const out = {}
      if (p === null || typeof p !== 'object') return out
      if (typeof p.voiceOn === 'boolean') out.voiceOn = p.voiceOn
      if (typeof p.personaOn === 'boolean') out.personaOn = p.personaOn
      if (typeof p.themeOn === 'boolean') out.themeOn = p.themeOn
      if (typeof p.chatOn === 'boolean') out.chatOn = p.chatOn
      if (typeof p.callOn === 'boolean') out.callOn = p.callOn
      if (typeof p.idleChatOn === 'boolean') out.idleChatOn = p.idleChatOn
      if (typeof p.idleChatMs === 'number' && p.idleChatMs >= 60000 && p.idleChatMs <= 86400000) out.idleChatMs = Math.floor(p.idleChatMs)
      if (typeof p.callIntervalMs === 'number' && p.callIntervalMs >= 600000 && p.callIntervalMs <= 86400000) out.callIntervalMs = Math.floor(p.callIntervalMs)
      if (typeof p.humOn === 'boolean') out.humOn = p.humOn
      if (typeof p.humIntervalMs === 'number' && p.humIntervalMs >= 300000 && p.humIntervalMs <= 86400000) out.humIntervalMs = Math.floor(p.humIntervalMs)
      if (typeof p.voiceName === 'string' && VOICES.indexOf(p.voiceName) >= 0) out.voiceName = p.voiceName
      if (typeof p.rate === 'string' && RATES.indexOf(p.rate) >= 0) out.rate = p.rate
      if (typeof p.pitch === 'string' && PITCHES.indexOf(p.pitch) >= 0) out.pitch = p.pitch
      if (p.provider === 'edge' || p.provider === 'quest' || p.provider === 'voicevox' || p.provider === 'aqua' || p.provider === 'openai' || p.provider === 'auto') out.provider = p.provider
      if (typeof p.questSpeaker === 'number' && p.questSpeaker >= 1 && p.questSpeaker <= 60) out.questSpeaker = Math.floor(p.questSpeaker)
      if (typeof p.emotionIntensity === 'number' && p.emotionIntensity >= 0.2 && p.emotionIntensity <= 2) out.emotionIntensity = p.emotionIntensity
      if (typeof p.fallbackToQuest === 'boolean') out.fallbackToQuest = p.fallbackToQuest
      if (typeof p.voiceStability === 'boolean') out.voiceStability = p.voiceStability
      if (typeof p.sttProvider === 'string' && ['auto', 'browser', 'api'].indexOf(p.sttProvider) >= 0) out.sttProvider = p.sttProvider
      if (typeof p.sttApiUrl === 'string' && p.sttApiUrl.length <= 200) out.sttApiUrl = p.sttApiUrl
      if (typeof p.sttApiKey === 'string' && p.sttApiKey.length <= 200) out.sttApiKey = p.sttApiKey
      if (typeof p.sttModel === 'string' && p.sttModel.length <= 100) out.sttModel = p.sttModel
      if (typeof p.aquaUrl === 'string' && /^https?:\/\//.test(p.aquaUrl) && p.aquaUrl.length <= 200) out.aquaUrl = p.aquaUrl
      if (typeof p.aquaVoice === 'string' && p.aquaVoice.length <= 100) out.aquaVoice = p.aquaVoice
      if (typeof p.aquaRefAudio === 'string' && p.aquaRefAudio.length <= 300) out.aquaRefAudio = p.aquaRefAudio
      if (typeof p.aquaPromptText === 'string' && p.aquaPromptText.length <= 300) out.aquaPromptText = p.aquaPromptText
      if (typeof p.aquaTextLanguage === 'string' && ['日文', '中文', '英文'].indexOf(p.aquaTextLanguage) >= 0) out.aquaTextLanguage = p.aquaTextLanguage
      if (typeof p.aquaPromptLanguage === 'string' && ['日文', '中文', '英文'].indexOf(p.aquaPromptLanguage) >= 0) out.aquaPromptLanguage = p.aquaPromptLanguage
      if (typeof p.aquaPreset === 'string' && ['fast', 'balanced', 'quality'].indexOf(p.aquaPreset) >= 0) out.aquaPreset = p.aquaPreset
      if (typeof p.aquaApiKey === 'string' && p.aquaApiKey.length <= 200) out.aquaApiKey = p.aquaApiKey
      if (typeof p.aquaEmotionVoices === 'string' && p.aquaEmotionVoices.length <= 800) {
        try {
          const obj = JSON.parse(p.aquaEmotionVoices)
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) out.aquaEmotionVoices = obj
        } catch (e) { /* ignore invalid json */ }
      }
      if (typeof p.voiceAutoStart === 'boolean') out.voiceAutoStart = p.voiceAutoStart
      if (typeof p.voiceRoot === 'string' && p.voiceRoot.length <= 300) out.voiceRoot = p.voiceRoot
      if (p.voiceDevice === 'cuda' || p.voiceDevice === 'cpu') out.voiceDevice = p.voiceDevice
      if (typeof p.voiceGptWeights === 'string' && p.voiceGptWeights.length <= 300) out.voiceGptWeights = p.voiceGptWeights
      if (typeof p.voiceSovitsWeights === 'string' && p.voiceSovitsWeights.length <= 300) out.voiceSovitsWeights = p.voiceSovitsWeights
      // D7（审查 2026-09-13）：原来是 >=1，等于允许 80/443 这类特权端口（插件去抢会直接失败或与系统服务打架）；
      // 且从不校验两端口互异 —— 两个都填 9880/8100 时会互相踩（api 与桥抢同一个端口，后起的静默绑不上）。
      if (typeof p.voiceApiPort === 'number' && p.voiceApiPort >= 1024 && p.voiceApiPort <= 65535) out.voiceApiPort = Math.floor(p.voiceApiPort)
      if (typeof p.voiceBridgePort === 'number' && p.voiceBridgePort >= 1024 && p.voiceBridgePort <= 65535) out.voiceBridgePort = Math.floor(p.voiceBridgePort)
      {
        // 互异校验要拿"生效后的值"比：只改一个端口时，撞上另一个的现有值同样要拒。
        const effApi = out.voiceApiPort !== undefined ? out.voiceApiPort : Math.floor(Number(config.voiceApiPort) || 9880)
        const effBridge = out.voiceBridgePort !== undefined ? out.voiceBridgePort : Math.floor(Number(config.voiceBridgePort) || 8100)
        if (effApi === effBridge && (out.voiceApiPort !== undefined || out.voiceBridgePort !== undefined)) {
          console.warn('[sakiko] 拒绝端口改动：voiceApiPort 与 voiceBridgePort 不能相同（生效值 ' + effApi + '），该项已忽略')
          delete out.voiceApiPort
          delete out.voiceBridgePort
        }
      }
      if (typeof p.voicevoxUrl === 'string' && /^https?:\/\//.test(p.voicevoxUrl) && p.voicevoxUrl.length <= 200) out.voicevoxUrl = p.voicevoxUrl
      if (typeof p.voicevoxSpeaker === 'number' && p.voicevoxSpeaker >= 0 && p.voicevoxSpeaker <= 100) out.voicevoxSpeaker = Math.floor(p.voicevoxSpeaker)
      if (typeof p.voicevoxEmotionSpeakers === 'string' && p.voicevoxEmotionSpeakers.length <= 800) {
        try {
          const obj = JSON.parse(p.voicevoxEmotionSpeakers)
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) out.voicevoxEmotionSpeakers = obj
        } catch (e) { /* ignore invalid json */ }
      }
      if (typeof p.openaiTtsUrl === 'string' && p.openaiTtsUrl.length <= 200) out.openaiTtsUrl = p.openaiTtsUrl
      if (typeof p.openaiTtsApiKey === 'string' && p.openaiTtsApiKey.length <= 200) out.openaiTtsApiKey = p.openaiTtsApiKey
      if (typeof p.openaiTtsModel === 'string' && p.openaiTtsModel.length <= 100) out.openaiTtsModel = p.openaiTtsModel
      if (typeof p.openaiTtsVoice === 'string' && p.openaiTtsVoice.length <= 100) out.openaiTtsVoice = p.openaiTtsVoice
      if (typeof p.openaiTtsSpeed === 'number' && p.openaiTtsSpeed >= 0.5 && p.openaiTtsSpeed <= 2) out.openaiTtsSpeed = p.openaiTtsSpeed
      if (typeof p.maxCharsPerTurn === 'number' && p.maxCharsPerTurn >= 100 && p.maxCharsPerTurn <= 8000) out.maxCharsPerTurn = Math.floor(p.maxCharsPerTurn)
      if (typeof p.chatApiKey === 'string' && p.chatApiKey.length <= 200) out.chatApiKey = p.chatApiKey
      if (typeof p.chatBaseUrl === 'string' && /^https?:\/\//.test(p.chatBaseUrl) && p.chatBaseUrl.length <= 200) out.chatBaseUrl = p.chatBaseUrl
      if (typeof p.chatModel === 'string' && p.chatModel.length <= 100) out.chatModel = p.chatModel
      if (typeof p.narratorOn === 'boolean') out.narratorOn = p.narratorOn
      if (typeof p.narratorLLMSummary === 'boolean') out.narratorLLMSummary = p.narratorLLMSummary
      if (typeof p.narratorDone === 'boolean') out.narratorDone = p.narratorDone
      if (typeof p.narratorMilestoneMs === 'number' && p.narratorMilestoneMs >= 60000 && p.narratorMilestoneMs <= 1800000) out.narratorMilestoneMs = Math.floor(p.narratorMilestoneMs)
      if (typeof p.narratorMilestoneSteps === 'number' && p.narratorMilestoneSteps >= 3 && p.narratorMilestoneSteps <= 200) out.narratorMilestoneSteps = Math.floor(p.narratorMilestoneSteps)
      // 播报总结的助手文本预算（0–2000 可见字符；0 = 不注入该行）。与 narratorMilestoneSteps 同风格：
      //   非 number / 越界一律忽略该键（保留旧值或默认值），合法值 Math.floor。
      if (typeof p.narratorAssistantChars === 'number' && p.narratorAssistantChars >= 0 && p.narratorAssistantChars <= NARR_ASSIST_MAX_CPS) out.narratorAssistantChars = Math.floor(p.narratorAssistantChars)
      // 多工作区播报（Task 1）：multiSession 布尔；multiSessionPrefix 枚举 auto|always
      // 白名单保持不变；缺键时由 DEFAULT_CONFIG 补 'always'（X5 任务 B 起默认值）
      if (typeof p.multiSession === 'boolean') out.multiSession = p.multiSession
      if (typeof p.multiSessionPrefix === 'string' && ['auto', 'always'].indexOf(p.multiSessionPrefix) >= 0) out.multiSessionPrefix = p.multiSessionPrefix
      // 子代理会话播报开关（Task 5）：布尔白名单
      if (typeof p.narrateSubagents === 'boolean') out.narrateSubagents = p.narrateSubagents
      // 手机界面浮窗化（Task 1 / P8）：浮窗开关 / 主题预设 / 10 项自定义配色（含机身外框）/ 聊天区背景图
      // 白名单：floatPanel 布尔；themePreset 四枚举；color* 严格 6 位 hex（非法仅忽略该键，不回滚整包）；
      // chatBgUrl 字符串长度 ≤500 且（空串或 http://、https:// 前缀），非法忽略。
      if (typeof p.floatPanel === 'boolean') out.floatPanel = p.floatPanel
      if (typeof p.themePreset === 'string' && ['sakiko-blue', 'midnight-gold', 'sakura-pink', 'mono'].indexOf(p.themePreset) >= 0) out.themePreset = p.themePreset
      if (typeof p.colorBg1 === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.colorBg1)) out.colorBg1 = p.colorBg1
      if (typeof p.colorBg2 === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.colorBg2)) out.colorBg2 = p.colorBg2
      if (typeof p.colorTitle === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.colorTitle)) out.colorTitle = p.colorTitle
      if (typeof p.colorBubbleMe === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.colorBubbleMe)) out.colorBubbleMe = p.colorBubbleMe
      if (typeof p.colorBubbleHer === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.colorBubbleHer)) out.colorBubbleHer = p.colorBubbleHer
      if (typeof p.colorBubbleText === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.colorBubbleText)) out.colorBubbleText = p.colorBubbleText
      if (typeof p.colorBtn === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.colorBtn)) out.colorBtn = p.colorBtn
      if (typeof p.colorHi === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.colorHi)) out.colorHi = p.colorHi
      if (typeof p.colorDot === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.colorDot)) out.colorDot = p.colorDot
      if (typeof p.colorBezel === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.colorBezel)) out.colorBezel = p.colorBezel
      if (typeof p.chatBgUrl === 'string' && p.chatBgUrl.length <= 500 && (p.chatBgUrl.length === 0 || /^https?:\/\//.test(p.chatBgUrl))) out.chatBgUrl = p.chatBgUrl
      return out
    }

    async function loadPersona() {
      try {
        const t = await fs.resolve(PERSONA_PATH)
        const info = await fs.stat(t)
        if (info === undefined) return
        const text = (await fs.readText(t)).trim()
        if (text.length > 20) personaText = text
      } catch (e) { /* keep default */ }
    }

    let chatPersonaCache = ''
    async function readChatPersona() {
      if (chatPersonaCache.length > 10) return chatPersonaCache
      try {
        const t = await fs.resolve(CHAT_PERSONA_PATH)
        const info = await fs.stat(t)
        if (info === undefined) return DEFAULT_CHAT_PERSONA
        const text = (await fs.readText(t)).trim()
        if (text.length > 10) {
          chatPersonaCache = text
          return text
        }
      } catch (e) { /* ignore */ }
      return DEFAULT_CHAT_PERSONA
    }

    // ---------------- 记忆 ----------------
    async function loadMemory() {
      try {
        const t = await fs.resolve(MEMORY_PATH)
        const info = await fs.stat(t)
        if (info === undefined) return
        const parsed = JSON.parse(await fs.readText(t))
        if (parsed && typeof parsed === 'object') {
          memory = Object.assign({ facts: [], history: [], summary: '', lastCallAt: 0, callCount: 0, lastHumAt: 0, humCount: 0, progress: {} }, parsed)
          if (!Array.isArray(memory.facts)) memory.facts = []
          if (!Array.isArray(memory.history)) memory.history = []
          if (typeof memory.summary !== 'string') memory.summary = ''
          // Fix T4：progress 为新增键——旧档缺失 → 初始化为空；存在则逐条净化（容忍旧档/异常档）
          memory.progress = sanitizeProgressMap(memory.progress)
        }
      } catch (e) {
        console.error('[sakiko] 读取记忆失败:', e && e.message ? e.message : String(e))
      }
    }

    function scheduleSaveMemory() {
      saveMemoryNow().catch((e) => console.error('[sakiko] 保存记忆失败:', e && e.message ? e.message : e))
    }

    async function saveMemoryNow() {
      try {
        await writeTextSafe(MEMORY_PATH, JSON.stringify(memory, null, 2))
        return
      } catch (e) {
        // fs 沙箱可能拦截写入 → python 子进程兜底（已验证可写盘）
      }
      try {
        await runPython([MEM_SAVE_PY, lastHostPort, MEMORY_PATH], 'mem_save')
      } catch (e2) {
        console.error('[sakiko] 记忆落盘失败(fs+py):', e2 && e2.message ? e2.message : String(e2))
      }
    }

    function factsText() {
      const facts = (memory.facts || []).slice(-30)
      if (facts.length === 0) return ''
      return 'ユーザーについての長期記憶：\n- ' + facts.join('\n- ')
    }

    // ---------------- 子进程 ----------------
    async function raceDone(proc, label) {
      const res = await Promise.race([
        proc.done.then((o) => ({ t: 'done', o }), (e) => ({ t: 'spawn-error', e })),
        ctx.timeout(TTS_TIMEOUT_MS).then(() => ({ t: 'timeout' })),
      ])
      if (res.t === 'timeout') {
        try { proc.terminate() } catch (e) { /* ignore */ }
        throw new Error(label + ' timeout')
      }
      if (res.t === 'spawn-error') throw new Error(label + ' spawn failed: ' + (res.e && res.e.message ? res.e.message : res.e))
      if (res.o.exitCode !== 0) throw new Error(label + ' exited ' + res.o.exitCode)
    }

    async function runPython(args, label) {
      let exe
      try {
        exe = await subprocess.resolveExecutable('python')
      } catch (e) {
        exe = undefined
      }
      if (typeof exe !== 'string' || exe.length === 0) throw new Error('python not found')
      const proc = subprocess.spawn({
        argv: [exe].concat(args),
        cwd: ROOT,
        stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
        graceMs: 5000,
      })
      await raceDone(proc, label)
    }

    async function runCurl(args) {
      let exe
      try {
        exe = await subprocess.resolveExecutable('curl.exe')
      } catch (e) {
        exe = undefined
      }
      if (typeof exe !== 'string' || exe.length === 0) throw new Error('curl.exe not found')
      const proc = subprocess.spawn({
        argv: [exe].concat(args),
        cwd: ROOT,
        stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
        graceMs: 4000,
      })
      await raceDone(proc, 'curl')
    }

    async function readFileBytes(absPath, maxBytes) {
      const t = await fs.resolve(absPath)
      const info = await fs.stat(t)
      if (info === undefined) return null
      return fs.readBytes(t, undefined, maxBytes)
    }

    async function readTextFile(absPath) {
      const t = await fs.resolve(absPath)
      const info = await fs.stat(t)
      if (info === undefined) return null
      return fs.readText(t)
    }

    function nextSlot() {
      ttsSlot = (ttsSlot + 1) % 8
      return ttsSlot
    }

    // ---------------- 槽 sidecar（重播命中） ----------------
    // Fix R6：8 个固定播放槽（aqua-<slot>.wav 等）会被 nextSlot() 轮转复用，槽文件里不含任何
    // 「文本 → 文件」信息。旧版重播只能走内存 ttsCache（120 条 FIFO）：一旦被挤掉，重播就必须
    // 重新调 provider——provider 恰好失败时那条记录就彻底无声（用户实测的"聊天记录无法重播"）。
    // 这里给每个槽配一个同名 sidecar `<槽文件>.key`，内容 = synthesize() 用的缓存 key：
    //   * 只在**合成成功**后写（sidecar 即"提交记录"）；失败则清空 → 该槽永不被回放。
    //     注意 curl -o 会把 bridge 失败时的 JSON 错误体写进槽文件，所以"文件存在"不等于"音频有效"，
    //     回放必须以 sidecar 为准 + 复核音频有效性。
    //   * 覆写槽文件时同步覆写 sidecar → 键与音频永远一一对应，不会错配（槽被覆盖后旧键自然失配）。
    //   * 文件个数天然有界：8 个音频 + 8 个 sidecar，随 nextSlot() 轮转被覆盖，无新增目录。
    const SLOT_CACHE_COUNT = 8

    function slotKeyPath(oPath) {
      return oPath + '.key'
    }

    async function writeSlotKey(oPath, key) {
      try {
        await writeTextSafe(slotKeyPath(oPath), String(key))
      } catch (e) { /* sidecar 旁路失败不影响合成结果本身 */ }
    }

    async function clearSlotKey(oPath) {
      try {
        await writeTextSafe(slotKeyPath(oPath), '')
      } catch (e) { /* ignore */ }
    }

    // 音频有效性判据：与各 provider 的 200 字节下限一致，另加"不是 JSON 错误体"。
    // 单看长度是不够的——bridge 失败时返回 `{"error": str(e)[:300]}`，长度可达 300+ 字节，
    // 会被 200 字节的下限误判成"音频"。WAV/MP3 都不会以 '{' 或 '[' 开头。
    function looksLikeAudio(bytes) {
      if (bytes === null || bytes === undefined || bytes.length < 200) return false
      const n = Math.min(bytes.length, 16)
      let head = ''
      for (let i = 0; i < n; i++) head += String.fromCharCode(bytes[i])
      head = head.replace(/^[\s\ufeff]+/, '')
      return !(head.startsWith('{') || head.startsWith('['))
    }

    // 正向签名判据（复核 Minor-4）：aqua 槽里装的是 bridge 返回的 WAV，容器必须是 RIFF/WAVE。
    // 只有否定判据（"不是 JSON"）时，任何 ≥200 字节的垃圾/半截/全零内容都会过关；配合"槽被 curl
    // 中途截断"的场景，那正是错误音频的来源。这里只给 aqua 用（其 mime 恒为 audio/wav）。
    // 偏移说明：RIFF 规范是 magic(0..3)='RIFF' + chunkSize(4..7) + formType(8..11)='WAVE'——
    // 现场实测 GPT-SoVITS 的真实输出正是这种（'RIFF' + 4 字节长度 + 'WAVE'）。
    // 也接受 formType 紧跟 magic 的无 size 头（'RIFFWAVE…'）：本仓库两套探针的合成 WAV 都写作
    // 这种 shorthand，若只认偏移 8 会把它们全部误杀，反而让该判据无法被测试覆盖。
    // 若日后把其它 provider 也纳入槽回放，需按各自格式补签名（mp3：'ID3' 或 0xFF 0xFB）。
    function looksLikeWav(bytes) {
      if (!looksLikeAudio(bytes)) return false
      const magic = (i) => String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3])
      if (magic(0) !== 'RIFF') return false
      return magic(8) === 'WAVE' || magic(4) === 'WAVE'
    }

    // 槽文件当前字节数：不存在 → null；查询失败 → NaN（NaN !== NaN，调用方据此 fail-closed 注销）
    async function slotFileSize(absPath) {
      try {
        const t = await fs.resolve(absPath)
        const info = await fs.stat(t)
        if (info === undefined) return null
        return typeof info.size === 'number' ? info.size : null
      } catch (e) {
        return NaN
      }
    }

    // ② 槽回放查找：扫 8 个 aqua 槽的 sidecar，键一致且音频有效 → 直接回放该槽文件，不调 provider。
    // 只覆盖 aqua（用户实测故障所在、也是当前实际使用的 provider）；edge 的槽名带自增 ttsFileSeq
    // （无界增长），刻意不参与，以免把无界文件数扩散到 sidecar。
    async function findSlotAudio(key) {
      for (let i = 0; i < SLOT_CACHE_COUNT; i++) {
        const p = TMP_DIR + '/aqua-' + i + '.wav'
        const k = await readTextFile(slotKeyPath(p))
        if (k === null || k.length === 0 || k !== key) continue
        const bytes = await readFileBytes(p, MAX_TTS_BYTES)
        if (!looksLikeWav(bytes)) continue
        return { bytes, words: [], mime: 'audio/wav' }
      }
      return null
    }

    // ---------------- TTS Provider ----------------
    // 常驻 Edge-TTS worker：省去每句重新启动 Python + 导入 edge-tts 的开销（约 0.5~1s/句）。
    // 懒启动、失败自动回退到逐句 python 子进程；外部无法使用时 ttsWorker 置 {disabled:true}。
    let ttsWorker = null  // { port, proc } | { disabled: true }
    let ttsWorkerSeq = 0

    async function ensureTtsWorker() {
      if (ttsWorker !== null) return ttsWorker.disabled === true ? null : ttsWorker.port
      if (config.provider !== 'edge' && config.provider !== 'auto') return null
      let proc
      try {
        const py = await subprocess.resolveExecutable('python')
        proc = subprocess.spawn({
          // cwd 用数据目录而非安装目录：Windows 上常驻进程的 cwd 会锁住安装目录，
          // 导致下次重装时 Remove-Item 失败。worker 全部使用绝对路径，不依赖 cwd。
          argv: [py, TTS_SERVER_PY, '--root', TMP_DIR],
          cwd: TMP_DIR,
          stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: 8192 } },
          graceMs: 5000,
        })
        const port = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('tts worker ready timeout')), 10000)
          let buf = ''
          const stream = proc.stdout
          const onData = (chunk) => {
            buf += String(chunk)
            let idx
            while ((idx = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, idx).trim()
              buf = buf.slice(idx + 1)
              if (line.startsWith('READY:')) {
                clearTimeout(timer)
                stream.removeListener('data', onData)
                const p = parseInt(line.slice(6), 10)
                if (Number.isFinite(p) && p > 0) { resolve(p); return }
                reject(new Error('tts worker bad port line: ' + line))
                return
              }
            }
          }
          stream.on('data', onData)
          proc.done.then(() => { clearTimeout(timer); reject(new Error('tts worker exited early')) }, () => { clearTimeout(timer); reject(new Error('tts worker spawn failed')) })
        })
        ttsWorker = { port, proc }
        const seq = ++ttsWorkerSeq
        proc.done.then(() => {
          // 进程退出后清引用，下次自动重启（忽略已替换的旧进程）
          if (ttsWorker && ttsWorker.proc === proc) ttsWorker = null
        }).catch(() => { if (ttsWorker && ttsWorker.proc === proc) ttsWorker = null })
        console.log('[sakiko] TTS worker 就绪: 127.0.0.1:' + port)
        return port
      } catch (e) {
        console.warn('[sakiko] TTS worker 启动失败，回退逐句 python:', e && e.message ? e.message : String(e))
        try { if (proc) proc.terminate() } catch (e2) { /* ignore */ }
        ttsWorker = { disabled: true }
        return null
      }
    }

    // ---------------- 语音服务自管理（GPT-SoVITS api + 桥） ----------------
    // 为什么这么设计（都是踩过坑的结论）：
    //  1) 用 ctx.subprocess.spawn ⇒ 进程归 DSH 托管。DSH 退出时 subprocess 服务会统一 terminate
    //     它们（subprocess-local 的 process.on('exit') 钩子），**不留后台孤儿** —— 这解决了
    //     「关了 DSH，语音服务还在后台跑」的老问题。
    //  2) 只管理**自己拉起的**进程：端口已在监听就判定为"外部服务"，只读状态、不接管、更不按端口
    //     杀进程（用户自己用脚本起的服务不能被插件弄死）。
    //  3) 插件卸载时**延时 8s** 才停服务，apply() 里会取消这个定时器 —— 这样"改配置触发一次热重载"
    //     不会把要 30~60s 才加载完的模型杀掉重启。
    const myEpoch = ++voiceShared.epoch

    // 语音日志：**append 语义 + 超过 1MB 轮转**（v2.1.0 修 Minor-M1；2026-09-13 修轮转竞态 Minor-M2）。
    // 旧实现是「内存环形缓冲整份覆写文件」：新实例一起来就把上一代写下的记录（含"插件卸载 /
    // 延时停止"那几行 —— 事后取证唯一能看的东西）整段冲掉。控制者实测：重启后旧世代的行全没了。
    // 为什么用 node:fs 的 appendFileSync 而不是 fs 服务的 writeText：① fs 服务没有 append，
    // 只能"读旧档 + 拼新行 + 整份写回"，与看门狗进程（另一个进程也在 append 同一个文件）会互相
    // 覆盖；② O_APPEND 的写入在两端都不会互相截断，日志才可能真的跨进程/跨世代留痕。
    const VOICE_LOG_MAX = 1024 * 1024
    const VOICE_LOG_KEEP = 2                  // 最多保留 2 份历史档
    let voiceLogChain = Promise.resolve()

    // 轮转（**只有插件进程做，看门狗进程永不轮转、只 append**）：
    //   旧写法 `rmSync(.1)` + `rename(主档 → .1)` 不是原子对：热重载时两代插件都会跨 1MB，
    //   甲 rename 出 .1、乙 rm 掉 .1 再 rename，乙的 rm 可能删掉的正是甲刚写下的那一代记录
    //   （= 互相删档，取证材料丢失）。改成"轮转到带时间戳的 .1-<ts>、按名字排序最多留 2 份"：
    //   两代即使同时轮转，也各自产生**不同文件名**，谁都不会删掉谁刚写下的东西。
    function rotateVoiceLog() {
      let size = 0
      try { size = statSync(VOICE_LOG_PATH).size } catch (e) { return }     // 没有主档就不用轮转
      if (size <= VOICE_LOG_MAX) return
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      try { renameSync(VOICE_LOG_PATH, VOICE_LOG_PATH + '.1-' + ts) } catch (e) { return }   // 改不动就继续 append
      try {
        const base = basename(VOICE_LOG_PATH) + '.1-'
        const olds = readdirSync(LOG_DIR).filter((n) => n.startsWith(base)).sort()
        for (const n of olds.slice(0, Math.max(0, olds.length - VOICE_LOG_KEEP))) {
          try { rmSync(LOG_DIR + '/' + n, { force: true }) } catch (e) { /* 删不掉就算了，绝不影响写入 */ }
        }
      } catch (e) { /* 列目录失败不影响 append */ }
    }

    function voiceLogWriteLine(msg) {
      voiceLogChain = voiceLogChain.then(() => {
        try {
          mkdirSync(LOG_DIR, { recursive: true })
          rotateVoiceLog()
          appendFileSync(VOICE_LOG_PATH, msg + '\n', 'utf8')
        } catch (e) {
          // 写不动日志绝不能影响语音链路；至少让它出现在 DSH 控制台
          console.error('[sakiko][voice] 日志写盘失败:', VOICE_LOG_PATH, e && e.message ? e.message : String(e))
        }
      }).catch(() => { /* 链上任何异常都不许把后续日志卡死 */ })
    }

    function voiceLog(line) {
      const msg = '[' + new Date().toISOString().slice(11, 19) + '] ' + line
      voiceShared.state.log.push(msg)
      if (voiceShared.state.log.length > 200) voiceShared.state.log.splice(0, voiceShared.state.log.length - 200)
      console.log('[sakiko][voice] ' + line)
      voiceLogWriteLine(msg)          // 内存环只服务 /sakiko/* 的即时状态，落盘一律 append
    }

    function setVoicePhase(phase, detail) {
      voiceShared.state.phase = phase
      voiceShared.state.detail = detail || ''
      voiceShared.state.at = Date.now()
      voiceShared.state.managed = voiceShared.procs.api !== null || voiceShared.procs.bridge !== null
    }
    voiceShared.logSink = voiceLog        // 供模块级的延时停止定时器打日志（它不在本闭包内）

    // ---------------- 看门狗（watchdog）：非优雅退出时的自清理（v2.1.0） ----------------
    // 背景（用户实测）：ctx.subprocess 的回收只挂在 JS 退出钩子上，点控制台 X / taskkill /F /
    // DSH 崩溃时钩子根本不跑 ⇒ 插件拉起的 GPT-SoVITS api(9880) 与桥(8100) 变孤儿，端口一直被占，
    // 下次启动被判成"外部服务、不接管"，用户必须先跑 stop-all.bat。
    // 契约（详见 watchdog.mjs 顶部注释）：
    //   * 用 node:child_process.spawn 拉起（**不是 ctx.subprocess**，那一套会被 DSH 的退出钩子回收，
    //     恰好就是非优雅退出时不跑的那部分），detached + stdio:['pipe','ignore','ignore']；
    //   * stdin 管道 = 主信号（DSH 消失 ⇒ 写端被 OS 关闭 ⇒ 看门狗读到 EOF），pid 轮询是兜底；
    //   * 所有权靠令牌文件：token 不匹配 / 文件不在 ⇒ 看门狗什么都不杀（宁可漏杀，绝不误杀新一代）。
    const RUN_DIR = DATA_DIR + '/run'
    const WATCHDOG_STATE_PATH = RUN_DIR + '/voice-watchdog.json'

    function watchdogScriptPath() {
      for (const p of [MODULE_DIR + '/watchdog.mjs', ROOT + '/watchdog.mjs']) {
        try { if (statSync(p).isFile()) return p } catch (e) { /* 继续找下一个候选 */ }
      }
      return null
    }

    // 令牌文件：内容 = 本代身份 + **我们自己拉起的**服务清单（pid 来自手里的活句柄，
    // 不是从端口猜 —— 没 spawn 过就没有所有权，外来服务永不入册）。
    // 每项还带 createdMs/createdSrc = 该服务进程的**创建时间锚点**（见 trackVoiceProc 上的说明）
    // ⇒ 看门狗据此用**身份**而不是时间来判 PID 复用。
    // 原子写：临时文件 + rename，看门狗绝不会读到半个 JSON。
    function writeWatchdogState(token) {
      const apiPort = Math.floor(Number(config.voiceApiPort) || 9880)
      const bridgePort = Math.floor(Number(config.voiceBridgePort) || 8100)
      const services = []
      if (token !== null && token !== undefined) {
        for (const key of ['api', 'bridge']) {
          const rec = voiceShared.procs[key]
          if (!voiceProcAlive(rec)) continue
          // createdMs = 该服务进程的**创建时间锚点**（见上面那段注释：用"亲眼看到 spawn 返回的时刻"，
          // 不在这里起 powershell 查 CreationDate —— 那会把 DSH 事件循环卡住 300~700ms）。
          // 看门狗拿它跟自己 psProcTree 查到的 createdMs 比，相差 >2s 即判"这个 pid 已被复用"。
          const anchor = Number(rec.spawnedAt) > 0 ? Number(rec.spawnedAt) : 0
          const item = { key, pid: rec.pid, port: key === 'api' ? apiPort : bridgePort }
          if (anchor > 0) { item.createdMs = anchor; item.createdSrc = 'spawn' }
          services.push(item)
        }
      }
      const payload = {
        token: token === undefined ? null : token,
        epoch: voiceShared.epoch,
        dshPid: process.pid,
        watchdogPid: voiceShared.watchdog !== null && voiceShared.watchdog !== undefined ? voiceShared.watchdog.pid : 0,
        updatedAt: new Date().toISOString(),
        services,
      }
      try {
        mkdirSync(RUN_DIR, { recursive: true })
        const tmp = WATCHDOG_STATE_PATH + '.' + process.pid + '.tmp'
        writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8')
        renameSync(tmp, WATCHDOG_STATE_PATH)
        return true
      } catch (e) {
        voiceLog('[watchdog] 令牌文件写入失败（' + WATCHDOG_STATE_PATH + '）：'
          + (e && e.message ? e.message : String(e)) + ' —— 非优雅退出时的自动回收不可用')
        return false
      }
    }

    function watchdogAlive() {
      const wd = voiceShared.watchdog
      if (wd === null || wd === undefined || wd.exited === true) return false
      try { process.kill(wd.pid, 0); return true } catch (e) { return false }
    }

    // 幂等：同一个 DSH 进程里只留一个看门狗；每次调用都刷新令牌文件里的服务清单。
    function armWatchdog(why) {
      if (voiceShared.watchdogToken === null) voiceShared.watchdogToken = randomUUID()
      if (!watchdogAlive()) {
        const script = watchdogScriptPath()
        if (script === null) {
          voiceLog('[watchdog] 找不到 watchdog.mjs（安装包不完整？）→ 跳过：非优雅退出时的自动回收不可用')
          return false
        }
        let child = null
        try {
          child = spawnChild(process.execPath, [
            script,
            '--token', voiceShared.watchdogToken,
            '--epoch', String(voiceShared.epoch),
            '--dsh-pid', String(process.pid),
            '--token-file', WATCHDOG_STATE_PATH,
            '--log', VOICE_LOG_PATH,
          ], {
            // cwd 必须用 MODULE_DIR（`import.meta.url` 推出的真实模块目录），不能用 ROOT：
            // ROOT 可被环境变量 SAKIKO_ROOT 覆盖，配错（或不存在的路径）会让这次 spawn 直接
            // ENOENT ⇒ **静默失去整个看门狗**（只剩一行"看门狗出错"日志）。脚本本身也是先从
            // MODULE_DIR 找的（见 watchdogScriptPath），两处口径必须一致。
            cwd: MODULE_DIR,
            detached: true,
            windowsHide: true,
            stdio: ['pipe', 'ignore', 'ignore'],    // stdin 管道 = 死亡信号，绝不写、绝不 end
            env: process.env,
          })
        } catch (e) {
          voiceLog('[watchdog] 拉起看门狗失败：' + (e && e.message ? e.message : String(e)))
          return false
        }
        const wd = { pid: child.pid, token: voiceShared.watchdogToken, exited: false, child, expected: false }
        // expected 交给 stopWatchdog 置位：正常收摊不报警，**意外退出必须留下痕迹** ——
        // 否则"看门狗已经死了"这件事会被一句"已拉起看门狗"永远掩盖（正是这次要修的那类自欺）。
        child.on('exit', (code) => {
          wd.exited = true
          if (!wd.expected) voiceLog('[watchdog] ★ 看门狗意外退出（pid=' + wd.pid + ' exit=' + code + '）—— 非优雅退出时的自动回收不可用（下次拉起服务时会重试）')
        })
        child.on('error', (e) => {
          wd.exited = true
          if (!wd.expected) voiceLog('[watchdog] ★ 看门狗出错：' + (e && e.message ? e.message : String(e)))
        })
        try { if (child.stdin) child.stdin.on('error', () => { /* EPIPE 无所谓 */ }) } catch (e) { /* ignore */ }
        // unref 子进程 + unref 它的 stdin：这两步缺一不可。stdin 管道是活的 handle，
        // 不 unref 会把 DSH 的事件循环**钉住**（Ctrl+C / 正常退出时进程不结束）。
        try { child.unref() } catch (e) { /* ignore */ }
        try { if (child.stdin && typeof child.stdin.unref === 'function') child.stdin.unref() } catch (e) { /* ignore */ }
        voiceShared.watchdog = wd
        voiceLog('[watchdog] 已拉起看门狗 pid=' + child.pid + '（token=' + String(voiceShared.watchdogToken).slice(0, 8)
          + '，触发=' + why + '，脚本=' + script + '）')
      }
      const ok = writeWatchdogState(voiceShared.watchdogToken)
      if (ok) {
        const n = voiceShared.procs.api !== null && voiceProcAlive(voiceShared.procs.api) ? 1 : 0
        const m = voiceShared.procs.bridge !== null && voiceProcAlive(voiceShared.procs.bridge) ? 1 : 0
        voiceLog('[watchdog] 已更新令牌文件（token=' + String(voiceShared.watchdogToken).slice(0, 8)
          + '，登记服务 api=' + n + ' bridge=' + m + '）')
      }
      return ok
    }

    // 优雅停止/卸载：先把令牌置为失效态（{token:null}），**再**杀看门狗。
    // 顺序的意义：若我们杀看门狗失败（或它已经跑飞），残留者醒来时读到 token=null 会判定
    // "不匹配 ⇒ 什么都不杀" —— 绝不会把新一代刚拉起的服务干掉。
    async function stopWatchdog(reason) {
      const wd = voiceShared.watchdog
      const wasAlive = watchdogAlive()
      writeWatchdogState(null)
      voiceShared.watchdogToken = null
      voiceShared.watchdog = null
      if (wd === null || wd === undefined) return
      if (!wasAlive) {
        voiceLog('[watchdog] 看门狗 pid=' + wd.pid + ' 已经不在了（' + reason + '；令牌已置失效）')
        return
      }
      wd.expected = true      // 之后它的 exit 事件不再当作"意外退出"报警
      let how = ''
      try {
        if (process.platform === 'win32') {
          const r = spawnSyncChild('taskkill', ['/PID', String(wd.pid), '/T', '/F'], { windowsHide: true, timeout: 8000 })
          how = 'taskkill /T /F（exit=' + (r ? r.status : '?') + '）'
        } else {
          try { process.kill(-wd.pid, 'SIGKILL'); how = 'kill(-pid)' }
          catch (e) { process.kill(wd.pid, 'SIGKILL'); how = 'kill(pid)' }
        }
      } catch (e) {
        voiceLog('[watchdog] 停止看门狗 pid=' + wd.pid + ' 失败：' + (e && e.message ? e.message : String(e)))
        return
      }
      // 等它真的退出（≤2s）；超时也如实记一笔
      const deadline = Date.now() + 2000
      let gone = false
      while (Date.now() < deadline) {
        try { process.kill(wd.pid, 0) } catch (e) { gone = true; break }
        await new Promise((r) => setTimeout(r, 100))
      }
      voiceLog('[watchdog] 已停止看门狗 pid=' + wd.pid + '（' + reason + '，' + how + '，'
        + (gone ? '已确认退出' : '★ 2s 内未确认退出，但令牌已置失效 ⇒ 它醒来也不会杀任何进程') + '）')
    }

    function voicePaths() {
      const root = String(config.voiceRoot || '').trim().replace(/[\\/]+$/, '')
      return {
        root,
        py: root + '/env/Scripts/python.exe',
        repo: root + '/GPT-SoVITS-main',
        api: root + '/GPT-SoVITS-main/api.py',
        bridge: root + '/bridge_tts.py',
        bridgeCfg: root + '/bridge.config.json',
      }
    }

    async function pathExists(p) {
      if (!p) return false
      try {
        const h = await fs.resolve(p)
        return (await fs.stat(h)) !== undefined
      } catch (e) { return false }
    }

    // 端口在听？用 **TCP connect** 判据。
    // 为什么不复用 httpProbe：审查 D3 实测，桥在 api 挂掉时 /health 要 ~4.2s 才回，
    // 而"没在听"的 HTTP 预算只有 2.5s → 会把**慢响应误判成没在听** → 重复拉起第二个
    // GPT-SoVITS api（等于二次加载 3.5~9GB 模型）。TCP connect 毫秒级且不涉及应用层语义。
    async function portOpen(port, timeoutMs) {
      return await new Promise((resolve) => {
        let settled = false
        const done = (v) => {
          if (settled) return
          settled = true
          try { sock.destroy() } catch (e) { /* ignore */ }
          resolve(v)
        }
        const sock = net.connect({ host: '127.0.0.1', port: port })
        sock.setTimeout(timeoutMs || 1500)
        sock.once('connect', () => done(true))
        sock.once('timeout', () => done(false))
        sock.once('error', () => done(false))
      })
    }

    // 子进程记录：就绪判据必须是「**我们拉起的进程还活着** ∧ 端口在听」。
    // 否则会出现审查 D4 那种情况：自己拉起的桥早就死了，端口被外部进程占着，却报 ready。
    //
    // spawnedAt = **本进程亲眼看到 spawn 返回的时刻**，它就是令牌里 createdMs 的来源
    // （createdSrc='spawn'）。为什么不在这里查 Win32_Process.CreationDate 的那个"真值"：
    // 2026-09-13 实测，在 DSH 进程里 spawn 一次 powershell.exe 会把事件循环**卡住 300~700ms**
    // （CreateProcess 是同步的），于是 ① 令牌写入被推迟 ⇒ 保护窗口变窄；② 日志的异步 append 链
    // 排水被推迟 700ms ⇒ 恰好强杀时丢掉"已拉起 api/看门狗/已更新令牌"这几行取证材料（trace 铁证：
    // CHAIN-ENTER 比 CALL 晚 697ms）。而 spawn 返回与真实创建时间通常只差几 ms~几十 ms，
    // 看门狗的容忍窗是 2000ms ⇒ 用 spawn 时刻当锚点既够用又不牺牲任何东西。
    function trackVoiceProc(handle) {
      const rec = { handle: handle, pid: handle.pid, exited: false, exitCode: null, spawnedAt: Date.now() }
      const settle = (o) => {
        rec.exited = true
        rec.exitCode = o && typeof o.exitCode === 'number' ? o.exitCode : null
      }
      handle.done.then(settle, settle)
      return rec
    }

    // 失败时把子进程已经收集到的输出倒出来。旧实现 spawn 时用 maxBytes 收集却从不读取，
    // 于是"启动失败"只剩下一个笼统的 timeout，真正原因（缺依赖/路径错/CUDA 不可用）全丢了（审查 D10）。
    async function dumpProcOutput(rec, tag) {
      if (!rec || !rec.handle || !rec.handle.collected) return
      try {
        const errR = rec.handle.collected.stderr
        const outR = rec.handle.collected.stdout
        const e = errR ? (await errR.readFrom(0)).text : ''
        const o = outR ? (await outR.readFrom(0)).text : ''
        const lines = (e + '\n' + o).split('\n').map((x) => x.trim()).filter((x) => x.length > 0)
        if (lines.length === 0) return
        voiceLog(tag + ' 输出尾部: ' + lines.slice(-8).join(' | ').slice(0, 600))
      } catch (e) { /* 读不到就算了，不能因为诊断失败把流程搞挂 */ }
    }

    // 能建立 HTTP 连接（哪怕 404/500）就算"能应答"；连接被拒 = 没在听。
    // 只用于**取状态/下发指令**（/health、/set_model），不用于"端口是否被占用"的判断。
    async function httpProbe(url, ms) {
      const budget = ms || 2500
      const ctl = new AbortController()
      const timer = setTimeout(() => { try { ctl.abort() } catch (e) { /* ignore */ } }, budget)
      try {
        const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' })
        let body = ''
        try { body = await r.text() } catch (e) { body = '' }
        return { up: true, status: r.status, body: body }
      } catch (e) {
        return { up: false, err: e && e.message ? String(e.message) : String(e) }
      } finally { clearTimeout(timer) }
    }

    async function waitUntil(pred, timeoutMs, intervalMs, giveUp) {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        if (await pred()) return true
        // D4/D10：进程已经退出属于"再等也不会好"。没有这个早退，就要空等满 60/180s，
        // 用户只看到一个笼统的 timeout，真因（缺依赖/端口被占/路径错）全被时间吞掉。
        if (giveUp !== undefined) {
          try { if (await giveUp()) return false } catch (e) { /* giveUp 自己出错不影响等待 */ }
        }
        if (Date.now() >= deadline) return false
        await new Promise((r) => setTimeout(r, intervalMs))
      }
    }

    async function voicePython(P) {
      if (await pathExists(P.py)) return P.py
      return await subprocess.resolveExecutable('python')
    }

    // 句柄是否还活着（trackVoiceProc 会被 handle.done 置 exited）
    function voiceProcAlive(rec) {
      return rec !== null && rec !== undefined && rec.exited !== true
    }

    // S1（复审 2026-09-13 次要）：owner / managed / pid 必须与**手里的句柄事实**对齐。
    // 旧实现只在成功结尾写 `owner = 'plugin'`（中途失败就保留旧值），于是实测出现自相矛盾的
    //     phase:"failed", owner:"external", managed:true, api.pid:7844
    // —— 7844 正是插件自己拉起、仍在听 9882 的 api：面板/agent 读到"这是外部的、插件不管也不会停"，
    // 实际上 DSH 退出时插件会去杀它。
    // 本函数**纯同步**（不探端口，避免把"正在加载模型"误判成失败）：只依据 procs 里的句柄重算。
    // owned（有活句柄）⇒ owner='plugin'；一个句柄都不剩且曾自称 plugin ⇒ 按端口是否在听降级为
    // external/none，绝不留下"自称托管却没人管"或反过来的状态。
    function syncVoiceOwnership() {
      for (const key of ['api', 'bridge']) {
        const rec = voiceShared.procs[key]
        if (rec !== null && rec !== undefined && rec.exited === true) {
          voiceShared.procs[key] = null
          voiceShared.state[key].pid = 0
          voiceShared.state[key].up = false
        }
      }
      const ownApi = voiceShared.procs.api
      const ownBr = voiceShared.procs.bridge
      const owned = ownApi !== null || ownBr !== null
      voiceShared.state.api.pid = ownApi !== null ? ownApi.pid : 0
      voiceShared.state.bridge.pid = ownBr !== null ? ownBr.pid : 0
      voiceShared.state.managed = owned
      if (owned) voiceShared.state.owner = 'plugin'
      else if (voiceShared.state.owner === 'plugin') {
        voiceShared.state.owner = (voiceShared.state.api.up || voiceShared.state.bridge.up) ? 'external' : 'none'
      }
      return voiceShared.state
    }

    // D5（审查 2026-09-13 重要）：本插件托管的 api+bridge 都还活着 ⇒ **同步**返回 ready/plugin。
    // 为什么必须同步：`?action=start` 走的是 `void startVoiceServices(...)`（不 await，否则冷启动
    // 会阻塞 HTTP 请求 3 分钟）。只要这里先 await，响应里就会是"starting"；而旧实现更糟 ——
    // 它跳过这步直接去探端口，把 owner 从 plugin 翻成 external，等于告诉面板/agent
    // "这是外部的，插件不接管也不会停它"，可实际上卸载时会被插件杀掉。
    function voiceOwnedFastPath() {
      const ownApi = voiceShared.procs.api
      const ownBr = voiceShared.procs.bridge
      if (!voiceProcAlive(ownApi) || !voiceProcAlive(ownBr)) return null
      const apiPort = Math.floor(Number(config.voiceApiPort) || 9880)
      const bridgePort = Math.floor(Number(config.voiceBridgePort) || 8100)
      voiceShared.state.api.port = apiPort
      voiceShared.state.bridge.port = bridgePort
      voiceShared.state.api.pid = ownApi.pid
      voiceShared.state.bridge.pid = ownBr.pid
      voiceShared.state.owner = 'plugin'
      setVoicePhase('ready', '由插件拉起并托管（重复 start 被忽略）')
      voiceLog('重复 start：插件托管的 api/bridge 仍在运行（pid ' + ownApi.pid + '/' + ownBr.pid + '），忽略且不重复 spawn')
      // 端口复核只为修正状态：**不做任何 spawn/terminate**，所以可以后台跑
      void (async () => {
        const a = await portOpen(apiPort, 800)
        const b = await portOpen(bridgePort, 800)
        voiceShared.state.api.up = a
        voiceShared.state.bridge.up = b
        if (!a || !b) setVoicePhase('failed', '托管的进程还在，但端口未在听（api:' + a + ' bridge:' + b + '）')
      })().catch(() => { /* 复核失败不改状态 */ })
      return voiceShared.state
    }

    async function startVoiceServices(trigger) {
      // D2（审查 2026-09-13 阻塞）：去重标志必须在**外层 await 之后**清理。
      // 旧写法 `voiceShared.starting = (async () => {...})()` 里带 `finally { voiceShared.starting = null }`：
      // 同步早退分支（voiceAutoStart=false / voiceRoot 为空）会在赋值**之前**就把 finally 跑掉，
      // 于是 voiceShared.starting 被赋成一个**已结算**的 Promise 且永不清除 ⇒ 之后所有调用
      // （含 HTTP 自愈入口 ?action=start）被 `if (voiceShared.starting !== null) return` 永久短路，
      // 且响应里的 starting 永远为 true。实测：voiceRoot 空启动一次后，写回配置也再起不来。
      if (voiceShared.starting !== null) return await voiceShared.starting
      const already = voiceOwnedFastPath()
      if (already !== null) return already
      const run = (async () => {
        try {
          const apiPort = Math.floor(Number(config.voiceApiPort) || 9880)
          const bridgePort = Math.floor(Number(config.voiceBridgePort) || 8100)
          voiceShared.state.api.port = apiPort
          voiceShared.state.bridge.port = bridgePort
          if (config.voiceAutoStart !== true) { setVoicePhase('disabled', 'voiceAutoStart=false'); return syncVoiceOwnership() }
          const P = voicePaths()
          if (!P.root) { setVoicePhase('disabled', 'voiceRoot 未配置（留空=不自动启动）'); return syncVoiceOwnership() }

          // ① 先清掉**已经退出**的托管句柄：不清的话它会继续让 managed=true、让状态假装还有服务，
          //    也会挡住后面的重新拉起（审查 D4 的同源问题）。
          for (const key of ['api', 'bridge']) {
            const rec = voiceShared.procs[key]
            if (rec !== null && rec !== undefined && rec.exited === true) {
              voiceLog('清理已退出的托管句柄 ' + key + '（pid=' + rec.pid + ' exit=' + (rec.exitCode === null ? '?' : rec.exitCode) + '）')
              voiceShared.procs[key] = null
              voiceShared.state[key].pid = 0
              voiceShared.state[key].up = false
            }
          }

          // ② "有没有别人在听"一律用 **TCP connect** 判据，不用 /health。
          //    D3（审查实测）：真实桥在 api 挂掉时 /health 要 ~4.2s 才回（内部两次 5s 超时），
          //    而旧代码的 HTTP 预算只有 2.5s ⇒ 把"慢"误判成"没在听" ⇒ 重复拉起第二个 GPT-SoVITS
          //    api（= 二次加载 3.5~9GB 模型；用户自己脚本正在加载模型的那 30~60s 窗口同样中招）。
          //    TCP connect 是毫秒级且不涉及应用层语义：连不上=没在听，连得上=有人在听。
          if (await portOpen(bridgePort, 1500)) {
            voiceShared.state.bridge.up = true
            const apiUp = await portOpen(apiPort, 1500)
            voiceShared.state.api.up = apiUp
            voiceShared.state.owner = 'external'
            if (apiUp) {
              setVoicePhase('external', '语音服务已在运行（外部的，插件不接管也不会停它）')
              voiceLog('检测到外部服务已在监听 ' + bridgePort + '，不做任何操作')
            } else {
              // D8：只有桥在听、api 没起来是"半可用"。旧代码照样回一句"已在运行"，
              // 用户会得到错误的安心感，所以这里明确写出来并显著打日志。
              setVoicePhase('external', '外部桥在听（:' + bridgePort + '），但 api :' + apiPort + ' 未就绪；插件不接管，也不会替你拉起 api')
              voiceLog('警告：外部桥 ' + bridgePort + ' 在听，但 api ' + apiPort + ' 未就绪 —— 语音链路半可用，请自行检查 api 进程')
            }
            return voiceShared.state
          }

          setVoicePhase('starting', '触发: ' + trigger)
          voiceLog('开始自启动（触发=' + trigger + '，root=' + P.root + '）')
          // S1：进入 starting 时就把 owner 与事实对齐（旧值不许留在面板上）。
          syncVoiceOwnership()

          // ③ api
          if (await portOpen(apiPort, 1500)) {
            voiceShared.state.api.up = true
            voiceLog('api 已在监听，跳过启动')
          } else {
            if (!(await pathExists(P.api))) {
              setVoicePhase('failed', '找不到 ' + P.api + '（voiceRoot 指对了吗？）')
              voiceLog('失败：找不到 api.py')
              return syncVoiceOwnership()
            }
            const py = await voicePython(P)
            const argv = [py, '-u', 'api.py', '-a', '127.0.0.1', '-p', String(apiPort),
              '-d', config.voiceDevice === 'cpu' ? 'cpu' : 'cuda']
            if (config.voiceGptWeights) argv.push('-g', String(config.voiceGptWeights))
            if (config.voiceSovitsWeights) argv.push('-s', String(config.voiceSovitsWeights))
            const h = subprocess.spawn({
              argv, cwd: P.repo,
              stdio: { stdin: 'ignore', stdout: { maxBytes: 16384 }, stderr: { maxBytes: 16384 } },
              graceMs: 5000,
              env: { PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
            })
            const rec = trackVoiceProc(h)
            voiceShared.procs.api = rec
            voiceShared.state.api.pid = rec.pid
            voiceLog('已拉起 GPT-SoVITS api pid=' + rec.pid + '（端口 ' + apiPort + '，device=' + (config.voiceDevice || 'cuda') + '）')
            // 拉起即入册：模型加载要 30~180s，这段时间 DSH 被强杀同样必须能回收
            armWatchdog('已拉起 api')
            // 就绪 = 端口在听 ∧ 我们拉起的进程还活着（D4）。进程退出则立刻失败（giveUp），
            // 不再空等 180s。
            const okApi = await waitUntil(
              async () => voiceProcAlive(rec) && (await portOpen(apiPort, 800)),
              180000, 2000,
              async () => rec.exited === true)
            if (!okApi) {
              const portNow = await portOpen(apiPort, 800)
              const why = rec.exited
                ? ('api 进程已退出（exit=' + (rec.exitCode === null ? '?' : rec.exitCode) + '）' + (portNow ? '，端口 ' + apiPort + ' 另有进程在听（插件不接管）' : ''))
                : 'api 180s 内未就绪（首次加载模型较慢；看 ' + VOICE_LOG_PATH + '）'
              setVoicePhase('failed', why)
              voiceLog('失败：' + why)
              await dumpProcOutput(rec, 'api')        // D10：把子进程 stderr/stdout 尾部落到日志
              if (rec.exited) { voiceShared.procs.api = null; voiceShared.state.api.pid = 0 }
              // S1：api 失败但**桥/api 里还有活句柄**时（例如 cfg 改了路径后 api 起不来、
              // 上一代 api 仍在跑），owner 必须如实是 plugin —— 否则 `?action=stop` 的语义
              // 与状态展示会互相打架。
              return syncVoiceOwnership()
            }
            voiceLog('api 就绪')
          }
          voiceShared.state.api.up = true

          // ③ 注册权重（api 重启后注册表会清空；只有配了权重才需要这步）
          if (config.voiceGptWeights || config.voiceSovitsWeights) {
            const q = []
            if (config.voiceGptWeights) q.push('gpt_model_path=' + encodeURIComponent(String(config.voiceGptWeights)))
            if (config.voiceSovitsWeights) q.push('sovits_model_path=' + encodeURIComponent(String(config.voiceSovitsWeights)))
            const r = await httpProbe('http://127.0.0.1:' + apiPort + '/set_model?' + q.join('&'), 120000)
            if (r.up && /Success/i.test(r.body)) voiceLog('权重已注册（set_model Success）')
            else voiceLog('权重注册失败：' + String(r.body || r.err || '').slice(0, 200))
          }

          // ④ 桥（自带配置驱动版优先，缺配置就用环境变量告诉它端口与 api 地址）
          if (!(await pathExists(P.bridge))) {
            setVoicePhase('failed', '找不到 ' + P.bridge)
            voiceLog('失败：找不到 bridge_tts.py')
            return syncVoiceOwnership()
          }
          const py2 = await voicePython(P)
          if (await pathExists(P.bridgeCfg)) voiceLog('桥将读取 ' + P.bridgeCfg)
          if (await portOpen(bridgePort, 1500)) {
            // 端口在 ② 之后才被别人抢走/或被我们自己占用（半途场景）：绝不重复 spawn 一个桥
            voiceShared.state.bridge.up = true
            voiceLog('桥端口 ' + bridgePort + ' 已在监听，跳过启动')
          } else {
            const h2 = subprocess.spawn({
              argv: [py2, '-u', P.bridge],
              cwd: P.root,
              stdio: { stdin: 'ignore', stdout: { maxBytes: 16384 }, stderr: { maxBytes: 16384 } },
              graceMs: 5000,
              env: {
                BRIDGE_PORT: String(bridgePort),
                GPT_API: 'http://127.0.0.1:' + apiPort,
                PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8',
              },
            })
            const rec2 = trackVoiceProc(h2)
            voiceShared.procs.bridge = rec2
            voiceShared.state.bridge.pid = rec2.pid
            voiceLog('已拉起语音桥 pid=' + rec2.pid + '（端口 ' + bridgePort + '）')
            armWatchdog('已拉起 bridge')
            // D4：就绪 = **端口在听 ∧ 我们自己拉起的那个桥还活着**。
            // 旧代码只看端口，于是"自己拉起的桥绑定失败立刻退出、端口恰好被别的东西占着"也会报 ready，
            // 用户以为语音好了，实际上插件手里是个死句柄；卸载时还会去 terminate 一个死 pid。
            const okBr = await waitUntil(
              async () => voiceProcAlive(rec2) && (await portOpen(bridgePort, 800)),
              60000, 1500,
              async () => rec2.exited === true)
            if (!okBr) {
              const portNow = await portOpen(bridgePort, 800)
              const why = rec2.exited
                ? ('桥进程已退出（exit=' + (rec2.exitCode === null ? '?' : rec2.exitCode) + '）' + (portNow ? '，端口 ' + bridgePort + ' 仍被其它进程占用，但那不是插件拉起的（插件不接管、也不会去杀）' : ''))
                : '桥 60s 内未就绪'
              setVoicePhase('failed', why)
              voiceLog('失败：' + why)
              await dumpProcOutput(rec2, 'bridge')     // D10
              if (rec2.exited) { voiceShared.procs.bridge = null; voiceShared.state.bridge.pid = 0 }
              // S1：桥失败时 api 若还活着（且是我们拉起的），owner 应为 plugin —— 复审实测这一格
              // 曾留下 owner:"external" + managed:true + api.pid=<插件自己的 pid> 的自相矛盾组合。
              return syncVoiceOwnership()
            }
          }
          voiceShared.state.bridge.up = true
          // S1：owner 交给**句柄事实**决定，不再无条件写 'plugin'（例：api 本来就是外部的、
          // 只由插件拉起桥时，写 'plugin' 会让"谁会随 DSH 一起收摊"对不上）。
          syncVoiceOwnership()
          setVoicePhase('ready', '由插件拉起并托管，DSH 退出时会一并停止')
          voiceLog('语音链路就绪：桥 ' + bridgePort + ' → api ' + apiPort)
          return voiceShared.state
        } catch (e) {
          const msg = e && e.message ? e.message : String(e)
          setVoicePhase('failed', msg.slice(0, 300))
          voiceLog('自启动异常：' + msg)
          return syncVoiceOwnership()
        }
      })()
      // D2：赋值 + 清理都在**外层**，任何同步早退路径（disabled/root 空）都不会再毒化这个标志。
      voiceShared.starting = run
      try {
        return await run
      } finally {
        if (voiceShared.starting === run) voiceShared.starting = null
      }
    }

    // 只停**本插件拉起的**进程（句柄在手），绝不按端口杀。
    // 2026-09-13 实测补强（审查报告之外的新缺陷）：旧写法是
    //     const h = voiceShared.procs[key]; voiceShared.procs[key] = null; try { h.terminate(); stopped.push(key) } catch {}
    // —— 若 terminate() 抛错（句柄已失效/平台 API 异常），key 不进 stopped，**句柄却已经被清空**：
    // 结果是 `?action=stop` 回一句"没有本插件拉起的服务可停"、句柄丢失、进程与端口全活着，
    // 之后连重试都做不到（voiceShared.procs 已空）。实测：ready 状态下 stop，api/bridge 两个 python 进程
    // 完全没被杀，而状态显示 idle/owner=none。所以这里必须做到三点：
    //   ① 句柄**成功退出后**才从 voiceShared.procs 摘除（失败保留，可重试）；
    //   ② terminate 抛错时降级用 terminateForHostExit()（Windows 上是 taskkill /T /F 强杀树）；
    //   ③ 只发信号不算"停掉了"—— 等它真的退出再报 stopped，否则如实报"未能停止"。
    async function stopVoiceServices(reason) {
      const stopped = []
      const survivors = []
      const ownedPorts = []      // 本次真正持有句柄的服务端口（= 本代托管端口）
      for (const key of ['bridge', 'api']) {
        const rec = voiceShared.procs[key]
        if (!rec) continue
        const port = Math.floor(Number(key === 'api' ? config.voiceApiPort : config.voiceBridgePort) || (key === 'api' ? 9880 : 8100))
        if (port > 0) ownedPorts.push({ key, port })
        try {
          rec.handle.terminate()
        } catch (e) {
          const m = e && e.message ? e.message : String(e)
          voiceLog('停止 ' + key + '（pid=' + rec.pid + '）时 terminate 抛错：' + m + '；降级用 terminateForHostExit 强杀')
          try { rec.handle.terminateForHostExit() } catch (e2) { voiceLog('停止 ' + key + ' 强杀也失败：' + (e2 && e2.message ? e2.message : String(e2))) }
        }
        let gone = false
        try {
          gone = (await Promise.race([
            rec.handle.waitForExit().then(() => true),
            new Promise((r) => setTimeout(() => r(false), 6000)),
          ])) === true
        } catch (e3) { gone = false }
        if (gone) { voiceShared.procs[key] = null; stopped.push(key) }
        else survivors.push(key + '(pid=' + rec.pid + ')')
      }
      voiceShared.state.api.pid = voiceShared.procs.api !== null ? voiceShared.procs.api.pid : 0
      voiceShared.state.bridge.pid = voiceShared.procs.bridge !== null ? voiceShared.procs.bridge.pid : 0
      voiceShared.state.api.up = voiceShared.procs.api !== null      // 幸存者的端口大概率还在听，不假装已释放
      voiceShared.state.bridge.up = voiceShared.procs.bridge !== null
      voiceShared.state.owner = survivors.length > 0 ? 'plugin' : 'none'
      if (stopped.length > 0) {
        setVoicePhase('stopped', '已停止插件拉起的 ' + stopped.join(' + ') + '（' + reason + '）'
          + (survivors.length > 0 ? '；★ ' + survivors.join(' + ') + ' 未能停掉' : ''))
        voiceLog('已停止 ' + stopped.join(' + ') + ' —— ' + reason)
      } else if (survivors.length > 0) {
        setVoicePhase('failed', '★ 未能停止插件拉起的 ' + survivors.join(' + ') + '（' + reason + '）')
        voiceLog('★ 未能停止：' + survivors.join(' + ') + ' —— ' + reason)
      } else {
        setVoicePhase('idle', '没有本插件拉起的服务可停（' + reason + '）')
      }
      // ④ 句柄退出 ≠ 端口释放（2026-09-13 独立审查 B4）：ctx.subprocess 的 terminate() 有可能只
      //    终结了"启动器"，而已经 breakaway 逃出 job 的 worker 还占着端口。此时 survivors 为空，
      //    旧代码会认为"停干净了"并把看门狗收摊 ⇒ 端口仍被占、而且没人守（正是本功能要修的那个坑）。
      //    所以收摊前做一次**有界端口复核**：每次 TCP connect ≤1s、总共 ≤3s；只要还有本代托管端口
      //    在监听，就**不收摊**看门狗，并如实报"未能停掉（端口仍在监听）"。
      const stillListening = []
      const unverified = []
      const pt0 = Date.now()
      for (const s of ownedPorts) {
        const left = 3000 - (Date.now() - pt0)
        if (left <= 0) { unverified.push(s.key + ':' + s.port); continue }      // 预算用尽 ⇒ 视为未复核（保守）
        if (await portOpen(s.port, Math.min(1000, left))) stillListening.push(s.key + ':' + s.port)
      }
      if (stillListening.length > 0 || unverified.length > 0) {
        // 端口是硬事实：句柄没了但端口还在听 ⇒ 状态里不许写"已停干净"
        for (const s of ownedPorts) {
          if (!stillListening.includes(s.key + ':' + s.port)) continue
          if (s.key === 'api') voiceShared.state.api.up = true
          else voiceShared.state.bridge.up = true
          voiceShared.state.owner = 'plugin'      // 端口仍被占的正是我们这棵树的残骸 ⇒ owner 不可能是 none
        }
        const stoppedNote = stopped.length > 0 ? '（句柄侧已退出：' + stopped.join(' + ') + '）' : ''
        const unNote = unverified.length > 0 ? '；另有未能复核的端口 ' + unverified.join(' / ') : ''
        setVoicePhase('failed', '★ 未能停掉（端口仍在监听：' + (stillListening.join(' / ') || '（有端口没复核成）') + '）'
          + stoppedNote + unNote + '（' + reason + '）')
        voiceLog('★ 未能停掉（端口仍在监听）：' + (stillListening.join(' / ') || '（有端口没复核成）') + stoppedNote + unNote
          + ' —— 句柄已经退出但端口还占着（breakaway worker 没随句柄回收）；看门狗**保持运行**，不当作「已停干净」')
      }
      // 看门狗收摊的时机：**服务先停、看门狗后停**（顺序反了会留下一个"服务已经没了、
      // 看门狗还醒着"的窗口）。还有幸存者/端口仍在监听时**不杀**看门狗 —— 否则非优雅退出又回到
      // "端口被占"，那正是这次要修的 bug。此时只刷新令牌文件，让看门狗继续守着剩下的服务。
      if (survivors.length === 0 && stillListening.length === 0 && unverified.length === 0) {
        await stopWatchdog(reason)
      } else if (voiceShared.watchdogToken !== null) {
        writeWatchdogState(voiceShared.watchdogToken)
        const why = survivors.length > 0 ? survivors.join(' + ')
          : ('端口仍在监听 ' + (stillListening.join(' / ') || unverified.join(' / ')))
        voiceLog('[watchdog] 仍有未停掉的服务（' + why + '）→ 看门狗保持运行并刷新登记清单')
        if (survivors.length === 0) {
          voiceLog('[watchdog] 注意：句柄都已退出 ⇒ 令牌里没有活句柄可登记，看门狗只能守住"不误杀"，'
            + '这一代无法再对 pid 归属不明的端口持有者动手（如实记录，不假装守住了）')
        }
      }
      return voiceShared.state
    }

    function scheduleVoiceStop(reason) {
      if (voiceShared.stopTimer !== null) return
      const owned = voiceProcAlive(voiceShared.procs.api) || voiceProcAlive(voiceShared.procs.bridge)
      if (!owned) return
      const gen = voiceShared.epoch          // 记下"谁排的队"
      voiceShared.stopEpoch = gen
      voiceLog('插件卸载：' + Math.round(voiceShared.graceMs / 1000) + 's 后停止插件拉起的语音服务（热重载会取消）')
      voiceShared.stopTimer = setTimeout(() => {
        voiceShared.stopTimer = null
        // D9：到点时若已经有更新一代实例接管（热重载），就**放弃**停止 —— 否则旧实例会把
        // 新实例刚托管的服务杀掉，而新实例因为"看到端口在听"判成 external 不再拉起，
        // 结果是"服务被杀但状态显示 external"的死局，只能重启 DSH。
        if (voiceShared.epoch !== gen || voiceShared.stopEpoch !== gen) {
          if (voiceShared.logSink) voiceShared.logSink('延时停止到点：已有新实例接管（epoch ' + gen + '→' + voiceShared.epoch + '），放弃停止')
          return
        }
        void stopVoiceServices(reason)
      }, voiceShared.graceMs)
      // 这个 8s 定时器不该把 DSH 的退出流程多拖 8s（审查 D9 附带一问）：unref 后它不再
      // 阻止事件循环排空；真到退出时子进程由 subprocess 服务统一回收，不依赖这个定时器。
      if (voiceShared.stopTimer !== null && typeof voiceShared.stopTimer.unref === 'function') voiceShared.stopTimer.unref()
    }

    function cancelScheduledVoiceStop() {
      if (voiceShared.stopTimer === null) return
      clearTimeout(voiceShared.stopTimer)
      voiceShared.stopTimer = null
      voiceLog('插件重载：已取消待执行的停止动作，语音服务保持运行')
    }

    function teardownTtsWorker() {
      if (ttsWorker && ttsWorker.proc) {
        ttsWorkerSeq += 1
        try { ttsWorker.proc.terminate() } catch (e) { /* ignore */ }
      }
      ttsWorker = null
    }

    async function synthesizeEdge(text, voice, rate, pitch, emotion) {
      ttsFileSeq = (ttsFileSeq + 1) % 8
      const slot = nextSlot()
      const intensity = typeof config.emotionIntensity === 'number' ? config.emotionIntensity : 1
      // 1) 常驻 worker 优先
      try {
        const port = await ensureTtsWorker()
        if (port !== null) {
          const outPath = TMP_DIR + '/w-' + ttsFileSeq + '-' + slot + '-' + Date.now() + '.mp3'
          const reqPath = TMP_DIR + '/wreq-' + ttsFileSeq + '-' + slot + '.json'
          const respPath = TMP_DIR + '/wresp-' + ttsFileSeq + '-' + slot + '.json'
          await writeTextSafe(reqPath, JSON.stringify({
            text, voice: voice || 'ja-JP-NanamiNeural', emotion,
            rate: rate || '+0%', pitch: pitch || '+0Hz',
            intensity, out: outPath,
          }))
          await runCurl(['-sS', '--max-time', '45', '-X', 'POST', '-H', 'Content-Type: application/json', '--data-binary', '@' + reqPath, 'http://127.0.0.1:' + port + '/synth', '-o', respPath])
          const j = await readTextFile(respPath)
          const parsed = j ? JSON.parse(j) : null
          if (!parsed || parsed.ok !== true) throw new Error('tts worker: ' + (parsed && parsed.error ? parsed.error : 'no response'))
          const bytes = await readFileBytes(parsed.out, MAX_TTS_BYTES)
          if (bytes === null || bytes.length < 200) throw new Error('edge: empty audio')
          let words = []
          if (Array.isArray(parsed.words)) words = parsed.words.filter((w) => w && typeof w.o === 'number' && typeof w.d === 'number')
          return { bytes, words, mime: 'audio/mpeg' }
        }
      } catch (e) {
        console.warn('[sakiko] worker 合成失败，回退逐句 python:', e && e.message ? e.message : String(e))
      }
      // 2) 回退：逐句 python 子进程
      const outPath = TMP_DIR + '/tts-' + ttsFileSeq + '-' + slot + '.mp3'
      await runPython([TTS_EMOTE_PY, text, voice, emotion, outPath, rate || '+0%', pitch || '+0Hz', String(intensity)], 'edge_tts')
      const bytes = await readFileBytes(outPath, MAX_TTS_BYTES)
      if (bytes === null || bytes.length < 200) throw new Error('edge: empty audio')
      let words = []
      try {
        const wb = await readFileBytes(outPath + '.words.json', 262144)
        if (wb !== null) {
          const wj = JSON.parse(new TextDecoder('utf-8').decode(wb))
          if (wj && Array.isArray(wj.words)) words = wj.words.filter((w) => w && typeof w.o === 'number' && typeof w.d === 'number')
        }
      } catch (e) { /* words unavailable */ }
      return { bytes, words, mime: 'audio/mpeg' }
    }

    async function synthesizeQuest(text) {
      const speaker = config.questSpeaker || 8
      const slot = nextSlot()
      const qPath = TMP_DIR + '/quest-' + slot + '.json'
      const oPath = TMP_DIR + '/quest-' + slot + '.mp3'
      const api = 'https://api.tts.quest/v3/voicevox/synthesis?text=' + encURI(text) + '&speaker=' + speaker
      await runCurl(['-sS', '--max-time', '25', api, '-o', qPath])
      const qBytes = await readFileBytes(qPath, 65536)
      if (qBytes === null) throw new Error('quest: no response')
      const json = JSON.parse(new TextDecoder('utf-8').decode(qBytes))
      const mp3Url = json && json.mp3DownloadUrl
      if (typeof mp3Url !== 'string' || mp3Url.length === 0) throw new Error('quest: no download url')
      await runCurl(['-sS', '--max-time', '25', '-L', mp3Url, '-o', oPath])
      const bytes = await readFileBytes(oPath, MAX_TTS_BYTES)
      if (bytes === null || bytes.length < 200) throw new Error('quest: empty audio')
      return { bytes, words: [], mime: 'audio/mpeg' }
    }

    async function synthesizeVoicevox(text, emotion) {
      let speaker = config.voicevoxSpeaker || 8
      const emoMap = config.voicevoxEmotionSpeakers
      if (emotion && emoMap && emoMap[emotion] !== undefined && emoMap[emotion] !== null) {
        speaker = Number(emoMap[emotion]) || speaker
      }
      const slot = nextSlot()
      const qPath = TMP_DIR + '/voicevox-' + slot + '.json'
      const oPath = TMP_DIR + '/voicevox-' + slot + '.wav'
      const base = (config.voicevoxUrl || 'http://127.0.0.1:50021').replace(/\/+$/, '')
      // 1. audio_query 获取合成参数
      const queryUrl = base + '/audio_query?text=' + encURI(text) + '&speaker=' + speaker
      await runCurl(['-sS', '--max-time', '15', '-X', 'POST', queryUrl, '-H', 'Content-Type: application/json', '-d', '', '-o', qPath])
      const qBytes = await readFileBytes(qPath, 1048576)
      if (qBytes === null) throw new Error('voicevox: no audio_query response')
      // 2. synthesis 合成 WAV
      const synthUrl = base + '/synthesis?speaker=' + speaker
      await runCurl(['-sS', '--max-time', '30', '-X', 'POST', synthUrl, '-H', 'Content-Type: application/json', '--data-binary', '@' + qPath, '-o', oPath])
      const bytes = await readFileBytes(oPath, MAX_TTS_BYTES)
      if (bytes === null || bytes.length < 200) throw new Error('voicevox: empty audio')
      return { bytes, words: [], mime: 'audio/wav' }
    }

    async function synthesizeOpenAI(text) {
      const slot = nextSlot()
      const reqPath = TMP_DIR + '/openai-tts-' + slot + '.json'
      const oPath = TMP_DIR + '/openai-tts-' + slot + '.mp3'
      const base = (config.openaiTtsUrl || config.chatBaseUrl || '').replace(/\/+$/, '')
      const apiKey = config.openaiTtsApiKey || config.chatApiKey || ''
      if (!base || !apiKey) throw new Error('openai: missing TTS URL/API key')
      const req = {
        model: config.openaiTtsModel || 'tts-1',
        input: text,
        voice: config.openaiTtsVoice || 'nova',
        response_format: 'mp3',
        speed: Number(config.openaiTtsSpeed || 1),
      }
      await writeTextSafe(reqPath, JSON.stringify(req))
      const url = base + '/audio/speech'
      const args = ['-sS', '--max-time', '30', '-X', 'POST', url, '-H', 'Content-Type: application/json', '-H', 'Authorization: Bearer ' + apiKey, '--data-binary', '@' + reqPath, '-o', oPath]
      await runCurl(args)
      const bytes = await readFileBytes(oPath, MAX_TTS_BYTES)
      if (bytes === null || bytes.length < 200) throw new Error('openai: empty audio')
      return { bytes, words: [], mime: 'audio/mpeg' }
    }

    // ---------------- 包内自带的音色参考素材（v2.2.0） ----------------
    // GPT-SoVITS 除权重之外，**每次请求还要一段参考干声 + 与之逐字一致的文稿**（ref_audio_path /
    // prompt_text）。历史版本把这份素材当成"用户自备"，于是别人装完只有权重仍然出不了声。
    // 现在包内自带一份（assets/ref/），未配置 aquaRefAudio / aquaPromptText 时兜底使用。
    // 注意两条边界：
    //   1) 只作为**兜底**：配置里写了就用配置里的，绝不覆盖用户的选择；
    //   2) **不因此把默认 provider 切到 aqua** —— `aquaReady` 的判据保持原样（见 synthesizeText），
    //      否则没配 aqua 的用户会被静默改道去请求 127.0.0.1:8100。
    const PACKAGED_REF_WAV = ROOT + '/assets/ref/sakiko_ref.wav'
    const PACKAGED_REF_PROMPT = ROOT + '/assets/ref/sakiko_ref.prompt.txt'
    let packagedRefCache = null            // { ref, prompt } | false（包内没有 / 读不到）
    let packagedRefLogged = false

    async function packagedRefAssets() {
      if (packagedRefCache !== null) return packagedRefCache
      try {
        if (!(await pathExists(PACKAGED_REF_WAV))) { packagedRefCache = false; return false }
        let prompt = ''
        try { prompt = String((await readTextFile(PACKAGED_REF_PROMPT)) || '').trim() } catch (e) { prompt = '' }
        packagedRefCache = { ref: PACKAGED_REF_WAV, prompt }
      } catch (e) { packagedRefCache = false }
      return packagedRefCache
    }

    // aqua 是不是"用户在用的通道"（判据与 aquaReady 一致，但**不含**包内素材）
    function aquaConfigured() {
      return config.provider === 'aqua' || !!config.aquaVoice || !!config.aquaRefAudio
    }

    // 取本次请求实际要用的 { ref, prompt }：配置优先，缺的用包内兜底
    async function resolveAquaRef() {
      let ref = String(config.aquaRefAudio || '')
      let prompt = String(config.aquaPromptText || '')
      if ((ref && prompt) || !aquaConfigured()) return { ref, prompt }
      const pack = await packagedRefAssets()
      if (pack === false || !pack.ref) return { ref, prompt }
      if (!ref) {
        ref = pack.ref
        if (!packagedRefLogged) {
          packagedRefLogged = true
          voiceLog('未配置 aquaRefAudio ⇒ 使用包内参考音频 ' + PACKAGED_REF_WAV
            + (pack.prompt ? '（文稿同用包内 ' + PACKAGED_REF_PROMPT + '）' : ''))
        }
      }
      if (!prompt && pack.prompt) prompt = pack.prompt
      return { ref, prompt }
    }

    async function synthesizeAqua(text, emotion) {
      const slot = nextSlot()
      const oPath = TMP_DIR + '/aqua-' + slot + '.wav'
      const base = (config.aquaUrl || 'http://127.0.0.1:8100').replace(/\/+$/, '')
      let voice = config.aquaVoice || ''
      const emoMap = config.aquaEmotionVoices
      if (emotion && emoMap && emoMap[emotion]) voice = emoMap[emotion]
      const refUse = await resolveAquaRef()
      const params = ['text=' + encURI(text)]
      if (voice) params.push('voice=' + encURI(voice))
      if (refUse.ref) params.push('ref_audio_path=' + encURI(refUse.ref))
      if (refUse.prompt) params.push('prompt_text=' + encURI(refUse.prompt))
      params.push('text_language=' + encURI(config.aquaTextLanguage || '日文'))
      params.push('prompt_language=' + encURI(config.aquaPromptLanguage || '日文'))
      if (config.aquaPreset) params.push('preset=' + encURI(config.aquaPreset))
      const api = base + '/tts/file?' + params.join('&')
      const args = ['-sS', '--max-time', '35', '-X', 'POST', api]
      if (config.aquaApiKey) args.push('-H', 'Authorization: Bearer ' + config.aquaApiKey)
      args.push('-o', oPath)
      // Fix R6b（复核 Important-1）：**认领即失效、成功才提交**。
      //   为什么不能等失败时再清：`curl -o` 从第一个字节起就**渐进覆盖**该槽；`runCurl` 抛错
      //   （`--max-time 35` 被砍 → exit 28）时槽里留下的是**别的文本的半截音频**，而 sidecar 还是
      //   上一个文本的 key → 下次重播那条旧文本会命中该槽、播出错误/截断的音频（比原来的静音更隐蔽）。
      //   所以：先记下旧 key 与旧字节数，**立刻注销**该槽（此后整段传输期间都不可回放），
      //   只有"curl 失败 **且** 槽一个字节都没被改动"（未写盘就失败，如连接被拒/可执行文件缺失）
      //   才把旧 key 还原——那种情况下键与音频仍然自洽，没必要白白丢掉一个有效槽。
      const prevKey = await readTextFile(slotKeyPath(oPath))
      const prevSize = await slotFileSize(oPath)
      if (prevKey !== null && prevKey.length > 0) await clearSlotKey(oPath)   // 无有效 key 时无需写盘
      try {
        await runCurl(args)
      } catch (e) {
        if (prevKey !== null && prevKey.length > 0 && (await slotFileSize(oPath)) === prevSize) {
          await writeSlotKey(oPath, prevKey)
        }
        throw e
      }
      const bytes = await readFileBytes(oPath, MAX_TTS_BYTES)
      // Fix R6（复核 Minor-3 更正）：bridge 失败时 `curl -o` 会把 HTTP 500 的 JSON 错误体原样写进
      // 播放槽（现场是 41 字节的 {"error": "IncompleteRead(0 bytes read)"}）。但要分清两件事：
      //   * **41 字节那种（<200）旧判据本来也会拒绝**，它只是残留在槽文件里，从未被播出
      //     （没有任何路由服务 TMP_DIR；面板只用 /sakiko/tts?text=… 重取音频）。
      //   * 真正的漏洞是 **>200 字节**的错误体：bridge 用 `{"error": str(e)[:300]}`，str(e) 截到
      //     300 字符 → 错误体可达 400+ 字节，会被纯长度判据当成音频放出去。这才是 looksLikeWav
      //     （长度 + 非 JSON + RIFF/WAVE 签名）存在的理由。
      if (!looksLikeWav(bytes)) throw new Error('aqua: empty audio')
      return { bytes, words: [], mime: 'audio/wav', slotPath: oPath }
    }

    // provider 缓存键：必须覆盖**一切会改变合成结果**的 provider 专属参数。
    // 踩坑记录（独立审查 2026-09-15 报的隐患）：aqua 的键原先只含 voice/refAudio/preset 三项，
    //   漏了 aquaPromptText（参考音频的逐字文稿）。而 promptText 直接决定音色还原质量 ——
    //   用户热改文稿后键不变 ⇒ 命中旧音频 ⇒ 「改了没反应」，而且是**静默**的（日志里也不报）。
    //   同理漏掉的还有：语言设置（决定 G2P 走哪条路）、情绪→音色映射（同一 emo 会映射到不同
    //   voice）、桥地址（换了后端）。这些值改动频率极低，纳入键最多让缓存 miss 一次（重新合成），
    //   代价可以忽略；不纳入则是静默错音，代价高得多。
    // 2026-09-15 独立复审补漏（B-1 / B-2 / B-3）：
    //   · B-1 `questSpeaker` 与 `emotionIntensity` 原先没进键。二者都是**面板可见**的设置，
    //     改了却不生效：quest 通道的键原先恒为 "quest"（而 speaker 是它唯一的说话人参数），
    //     edge 通道的 key 里也没有 intensity（synthesizeEdge 用 config.emotionIntensity 算强度）。
    //     注意**只往真正用到它的 provider 里加** —— 例如 voicevox 的音色由 speaker +
    //     voicevoxEmotionSpeakers 决定、aqua 由 aquaEmotionVoices 决定，都不吃 intensity，
    //     硬塞进去只会让「改 intensity」造成无谓的缓存 miss。
    //   · B-2 两个 TTS 的 apiKey 以**指纹**入键：换 key/租户理论上会换音源，但把明文塞进键里
    //     有被日志或调试输出带出去的风险，故只取 SHA-256 前 12 位。openai 还要算上
    //     `chatApiKey` 的回退（synthesizeOpenai 在没配 openaiTtsApiKey 时会用它）。
    //   · B-3 `stableJson` 原先用 `k=v` 逗号拼接，有两个洞：`{a:'1,b=2'}` 与 `{a:'1',b:'2'}` 会同串
    //     （构造得出碰撞）、嵌套对象被 String() 塌成 `[object Object]`（`{a:{x:1}}` 与 `{a:{y:2}}` 同串）。
    //     改成递归 + JSON 转义后两者都消除，且键排序保证稳定。
    // auto 模式动态选后端、不参与共享缓存，故这里返回什么都不会被用到（保留原语义）。
    function stableJson(v) {
      if (v === null || v === undefined) return ''
      // JSON.stringify 对 function / Symbol 返回 undefined（不是字符串），直接拼进结果会变成字面量
      // "undefined"。配置全来自 JSON.parse + sanitizePatch，实际不可达；但这里标了"不抛、返回字符串"
      // 的边界约定（测试也照此断言），就把它兜住。
      if (typeof v !== 'object') { const s = JSON.stringify(v); return s === undefined ? '' : s }
      if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']'
      try {
        return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}'
      } catch (e) { return '' }
    }
    // apiKey 只入指纹，不入明文（键可能被日志/调试输出带出去）
    function keyFingerprint(v) {
      if (typeof v !== 'string' || v.length === 0) return ''
      try { return createHash('sha256').update(v).digest('hex').slice(0, 12) } catch (e) { return '' }
    }
    function providerCacheKey(cfg) {
      const c = cfg || {}
      if (c.provider === 'aqua') {
        return [
          'aqua',
          c.aquaVoice || '',
          c.aquaRefAudio || '(包内参考音频)',
          c.aquaPreset || 'fast',
          c.aquaPromptText || '',
          c.aquaPromptLanguage || '',
          c.aquaTextLanguage || '',
          c.aquaUrl || '',
          stableJson(c.aquaEmotionVoices),
          keyFingerprint(c.aquaApiKey),
        ].join(':')
      }
      if (c.provider === 'voicevox') {
        return ['voicevox', c.voicevoxSpeaker || 8, c.voicevoxUrl || '', stableJson(c.voicevoxEmotionSpeakers)].join(':')
      }
      if (c.provider === 'openai') {
        return [
          'openai',
          c.openaiTtsModel || 'tts-1',
          c.openaiTtsVoice || 'nova',
          c.openaiTtsUrl || c.chatBaseUrl || '',
          c.openaiTtsSpeed || 1,
          keyFingerprint(c.openaiTtsApiKey || c.chatApiKey),
        ].join(':')
      }
      if (c.provider === 'quest') {
        // B-1：quest 通道原先恒返回 "quest"，而 speaker 是它唯一的说话人参数
        return ['quest', c.questSpeaker || 8].join(':')
      }
      if (c.provider === 'edge') {
        // B-1：edge 的音色由 voice/rate/pitch/emo（在外层 key 里）+ intensity 共同决定。
        // 独立复审 Minor-1：edge 失败时还会**回退到 quest**（fallbackToQuest 且 voiceStability!==true），
        // 那条路的音色由 questSpeaker 决定 ⇒ 在"会回退"时它也是 edge 产出的隐式输入，必须入键，
        // 否则改了 questSpeaker 会命中 edge 的旧音频（正是 B-1 要消灭的静默错音）。
        // ⚠️ 这条判据必须与 synthesize 里**真实决定回退**的那道闸同口径
        // （`if (config.fallbackToQuest === true && config.voiceStability !== true)`，见 synthesize 的 edge 分支）：
        // 本行曾把 `!== true` 写成 `!== false`（两者互补）⇒ 在**唯一会走 quest 回退**的配置
        // （fallbackToQuest=true + voiceStability=false）下 questSpeaker 反而不入键，改音色命中旧音频。
        // test/provider-cache-key.test.mjs §2 现在从源码里取那道真实闸门逐组合对照，防再次写反。
        const intensity = typeof c.emotionIntensity === 'number' ? c.emotionIntensity : 1
        const canFallbackQuest = c.fallbackToQuest === true && c.voiceStability !== true
        return ['edge', String(intensity), canFallbackQuest ? String(c.questSpeaker || 8) : ''].join(':')
      }
      return String(c.provider)
    }

    async function synthesize(text, voice, rate, pitch, emotion) {
      const emo = EMOTIONS.indexOf(emotion) >= 0 ? emotion : 'neutral'
      // auto 模式会动态选择 Aqua/VOICEVOX，不写共享缓存，避免换后端后命中旧音色。
      const useCache = config.provider !== 'auto'
      // provider 缓存键包含 provider 专属参数，避免切换音色/角色后命中旧缓存。
      const providerKey = providerCacheKey(config)
      const key = [providerKey, text, voice, rate, pitch, emo].join('\u0001')
      if (useCache) {
        const hit = ttsCache.get(key)
        if (hit !== undefined) {
          ttsOrder.splice(ttsOrder.indexOf(key), 1)
          ttsOrder.push(key)
          return hit
        }
        // 预热和前端取流可能同时合成同一句：并发合并到同一个任务，避免重复合成拖慢双方。
        const running = ttsInflight.get(key)
        if (running) return running
      }
      // ② 槽回放：内存缓存未命中时，先看 8 个播放槽里是否还留着**同一 key** 的有效音频；
      // 命中就直接回放槽文件，不重新调 provider——这是"聊天记录无法重播"的根治。
      // 与 ttsCache 同一策略：auto 模式不参与（换后端后槽里的旧音色会串）。
      if (useCache) {
        const replayed = await findSlotAudio(key)
        if (replayed !== null) {
          if (!ttsCache.has(key)) {
            ttsCache.set(key, replayed)
            ttsOrder.push(key)
            while (ttsOrder.length > TTS_CACHE_MAX) {
              const oldest = ttsOrder.shift()
              ttsCache.delete(oldest)
            }
          }
          return replayed
        }
      }
      const task = (async () => {
        let entry
        if (config.provider === 'quest') {
          entry = await synthesizeQuest(text)
        } else if (config.provider === 'voicevox') {
          entry = await synthesizeVoicevox(text, emo)
        } else if (config.provider === 'openai') {
          entry = await synthesizeOpenAI(text)
        } else if (config.provider === 'aqua') {
          entry = await synthesizeAqua(text, emo)
        } else if (config.provider === 'auto') {
          const errors = []
          const stable = config.voiceStability !== false
          // 1) 优先 Aqua-TTS（如果配置了角色或参考音频）
          const aquaReady = !!(config.aquaVoice || config.aquaRefAudio)
          if (aquaReady) {
            try {
              entry = await synthesizeAqua(text, emo)
            } catch (e) {
              errors.push('aqua:' + (e && e.message ? e.message : e))
              // 声线稳定开启时，不切换到其它音色
              if (stable) throw new Error('auto TTS failed (stable): ' + (e && e.message ? e.message : e))
            }
          }
          // 2) 本地 VOICEVOX：仅在未配置 Aqua 或用户允许切换时使用
          if (!entry && (!stable || !aquaReady)) {
            try {
              entry = await synthesizeVoicevox(text, emo)
            } catch (e) {
              errors.push('voicevox:' + (e && e.message ? e.message : e))
            }
          }
          // 3) 可选公共 VOICEVOX API（默认关，避免音色突变；voiceStability 开启时绝不切）
          if (!entry && config.fallbackToQuest === true && stable !== true) {
            try {
              entry = await synthesizeQuest(text)
            } catch (e) {
              errors.push('quest:' + (e && e.message ? e.message : e))
            }
          }
          if (!entry) {
            throw new Error('auto TTS failed: ' + (errors.join(' | ') || 'no provider available'))
          }
        } else {
          try {
            entry = await synthesizeEdge(text, voice, rate, pitch, emo)
          } catch (e1) {
            if (config.fallbackToQuest === true && config.voiceStability !== true) {
              try {
                entry = await synthesizeQuest(text)
              } catch (e2) {
                throw new Error('edge failed: ' + (e1 && e1.message ? e1.message : e1) + ' | quest failed: ' + (e2 && e2.message ? e2.message : e2))
              }
            } else {
              // 声线稳定优先：失败不切公共 API；前端默认也不降级到浏览器语音。
              throw new Error('edge failed: ' + (e1 && e1.message ? e1.message : e1))
            }
          }
        }
        return entry
      })()
      if (useCache) {
        ttsInflight.set(key, task)
        try {
          const entry = await task
          // sidecar = 提交记录：只有 provider 真的产出了有效音频才写（task 抛错走不到这里），
          // 这样槽里的键与音频永远一一对应，重播不会命中被覆盖的旧音频。
          if (entry && typeof entry.slotPath === 'string' && entry.slotPath.length > 0) {
            await writeSlotKey(entry.slotPath, key)
          }
          if (!ttsCache.has(key)) {
            ttsCache.set(key, entry)
            ttsOrder.push(key)
            while (ttsOrder.length > TTS_CACHE_MAX) {
              const oldest = ttsOrder.shift()
              ttsCache.delete(oldest)
            }
          }
          return entry
        } finally {
          ttsInflight.delete(key)
        }
      }
      return task
    }

    // ---------------- 语音队列 ----------------
    // 服务端 TTS 预热：句子进队列后立刻在后台并行合成，前端拉到时大概率直接命中缓存，
    // 消除句与句之间的 TTS 合成等待（并行 3 路，排队按进队顺序）。
    let warmChain = Promise.resolve()
    function warmItems(items) {
      const pending = items.slice()
      const workers = []
      const workerCount = Math.min(5, pending.length)
      for (let w = 0; w < workerCount; w++) {
        workers.push((async () => {
          while (pending.length > 0) {
            const u = pending.shift()
            if (u === undefined || u.kind !== 'say' || typeof u.text !== 'string' || u.text.trim().length === 0) continue
            try {
              await synthesize(u.text, config.voiceName, config.rate, config.pitch, u.emotion || 'neutral')
            } catch (e) {
              // 预热失败不影响正式请求；/sakiko/tts 仍会按需重试。
            }
          }
        })())
      }
      return Promise.all(workers)
    }
    function scheduleWarmTts() {
      // 语音关时**不预热**：预热会真的走 synthesize（aqua 那条直接吃 GPU），而这条路径不受
      // speakSynced 管辖 —— 2026-09-15 独立复审实测 voiceOn=false 时仍会白跑一次合成。
      if (config.voiceOn !== true) return
      const items = queue.slice(0, 8).filter((u) => u && u.kind === 'say' && u.text)
      if (items.length === 0) return
      warmChain = warmChain.then(() => warmItems(items)).catch((e) => {
        console.error('[sakiko] TTS 预热失败:', e && e.message ? e.message : String(e))
      })
    }

    // Fix R1（M5）：队列条目的 tags 白名单——只允许这些已知键由调用方透传到面板条目与日志
    const QUEUE_TAG_KEYS = ['announce', 'narrate', 'sid', 'label', 'idle']

    function pushUtterances(texts, force, emotion, cn, tags) {
      const emo = EMOTIONS.indexOf(emotion) >= 0 ? emotion : 'neutral'
      for (let i = 0; i < texts.length; i++) {
        const t = texts[i]
        if (typeof t !== 'string' || t.trim().length === 0) continue
        let e = emo
        if (i > 0) {
          const per = emotionFor(t)
          if (per !== 'neutral') e = per
        }
        const item = { id: nextId, kind: 'say', text: t.trim(), cn: i === texts.length - 1 ? (cn || '') : '', force: !!force, emotion: e, expr: EMOTION_EXPR[e] || '', ts: Date.now() }
        // Fix R1（M5）：tags → 条目的透传改为**白名单**（防御性）。此前是 `for (const k in tags)`，
        // 调用方误传大对象/敏感字段会直接进队列条目与时间线日志。已知键：announce/narrate（播报标记）、
        // sid/label（Task 2 归属）、idle（空闲闲聊）。其余键一律忽略。
        if (tags && typeof tags === 'object') {
          for (let k = 0; k < QUEUE_TAG_KEYS.length; k++) {
            const key = QUEUE_TAG_KEYS[k]
            if (tags[key] !== undefined) item[key] = tags[key]
          }
        }
        queue.push(item)
        nextId += 1
        maxIssuedId = Math.max(maxIssuedId, nextId - 1)
        if (queue.length > 60) queue.shift()
        tlLog({ ev: 'push', id: item.id, kind: 'say', text: tlTrunc(item.text, 160), cn: tlTrunc(item.cn, 120), force: !!force, emotion: e, tags: tlTagFields(item) })
      }
      scheduleWarmTts()
    }

    function pushCn(cn, emotion) {
      const emo = EMOTIONS.indexOf(emotion) >= 0 ? emotion : 'neutral'
      const item = { id: nextId, kind: 'cn', text: '', cn: String(cn || ''), force: false, emotion: emo, expr: '', ts: Date.now() }
      queue.push(item)
      nextId += 1
      maxIssuedId = Math.max(maxIssuedId, nextId - 1)
      // 队列上限 60（与 pushUtterances / pushHum 同一套语义与位置：入队后、tlLog 前，总是淘汰最老者）。
      // Minor-7（独立复审）：面板是拉取式的（/sakiko/poll 取走才移除），而本分支把**语音关时的全部**
      // 播报流量从 pushUtterances 改走 pushCn ⇒ 少了这道上限，语音关的长会话在面板长时间不轮询时
      // queue 会无界增长（每条约百字节）。这里是补平，不是新策略。
      if (queue.length > 60) queue.shift()
      tlLog({ ev: 'push', id: item.id, kind: 'cn', text: '', cn: tlTrunc(item.cn, 120), force: false, emotion: emo })
    }

    function pushCall(text, emotion, cn) {
      const emo = EMOTIONS.indexOf(emotion) >= 0 ? emotion : 'neutral'
      const item = { id: nextId, kind: 'call', text, cn: cn || '', force: true, emotion: emo, expr: EMOTION_EXPR[emo] || '', ts: Date.now() }
      queue.push(item)
      nextId += 1
      maxIssuedId = Math.max(maxIssuedId, nextId - 1)
      callPending = true
      scheduleWarmTts()
      tlLog({ ev: 'push', id: item.id, kind: 'call', text: tlTrunc(item.text, 160), cn: tlTrunc(item.cn, 120), force: true, emotion: emo })
    }

    // ============================================================
    // 语音就绪闸门（v2.2.0）：宿主发起的固定话语必须**等语音真的能出声**再合成
    // ============================================================
    // 修的是什么（2026-09-15 实测定位的「欢迎语稳定无声」）：
    //   speakSynced 旧实现**从不等待**语音服务，直接就 `synthesize()`。DSH 启动时
    //   `startVoiceServices()` 与播报是并行的，而它要等 api 加载完权重（实测 41~56s）才会把
    //   phase 置成 ready；入口欢迎语却是 `ctx.timeout(..., 15000)` 的**固定 15 秒**无条件播报
    //   ⇒ 那一刻桥(8100)还没在听 → curl 连接被拒 → synthesizeAqua 抛错 → speakSynced 只
    //   console.warn 后照旧 pushUtterances ⇒ **气泡出来了、没有声音**（用户报的现象）。
    //   证据：`%DSH_HOME%/sakiko/logs/voice-autostart.log` 与 `logs/timeline.jsonl` 时间戳对齐 ——
    //     [05:05:18] 开始自启动 → (05:05:33 欢迎语 synth_start) →[05:05:34] synth_fail ms=2318
    //     → [05:06:14] api 就绪 → [05:06:18] 语音链路就绪。四次启动（02:21/02:22、05:05/05:06 …）
    //     的 api 就绪耗时 41s / 45s / 56s，**全部 > 15s**，所以这个 bug 是稳定复现而不是偶发。
    //   ⇒ 修在 speakSynced（而不是入口那 20 行）：它是**所有**宿主固定话语的唯一出口
    //     （announce 欢迎语 / narrate 进度叙事 / call 来电 / idle 空闲闲聊），
    //     「没等语音就合成」是这条出口的公共缺陷，只在入口打补丁会让其余四类继续中招。
    //
    // 就绪判据为什么这么选（四层，逐层看**权威性**）：
    //   ⓪ 第一道是「本机现在到底用不用 aqua 桥」：闸门探的是桥的 /health，只有 aqua 通道走它。
    //      provider ∈ {edge, quest, voicevox, openai} 或 auto 且没配 aqua 时，**一次探针都不发**、
    //      直接按可用放行 —— 否则这些用户每次说话都会白等满 240s，比原 bug 还糟（本组判据见 bridgeNeeded）。
    //   ① 再认插件自己的状态机：`phase === 'ready' | 'external'`。
    //      这是**最省的一次判断**，也是自家服务的权威——它由 startVoiceServices 在
    //      「端口在听 ∧ 我们自己 spawn 的进程还活着」之后写入（L1556），覆盖了 `starting`（正在加载模型）这一档。
    //   ② phase 不是 ready/external 时，再用桥的 `/health` 交叉证实（**只增不减**）：
    //      `{"ok":true,"api":true,...}` 里的 `api` 才是「语音服务真的能用」的标志。用途有二：
    //        * 外部服务（`?action=external`、用户自己起的链）插件不写自己的状态机，只有 /health 能问出真相；
    //        * **本次要修的那个窗口正是 phase=starting**（api 已拉起、桥还没 bind），
    //          /health 在这一档是不可达/未就绪 ⇒ 闸门必然继续等。
    //      ⚠️ `registered` 的坑（2026-09-15 实测，差点写成错误的判据）：桥是**按需注册**音色的 ——
    //        刚起来时 `registered: {}`，要等第一次合成才补注册并写成 "ok"。实测链路：
    //          `registered={}` → /sakiko/tts 合成 200 / 32000Hz / 160044 B → `registered={"sakiko":"ok"}`
    //        ⇒ `{}` **必须判为可用**；若把"空注册表"当未就绪，就会把能出声的状态误判成没好、白等满 240s。
    //        只有注册表里出现非 ok/skip 的值（真注册失败）才算未就绪。
    //      ⚠️ 刻意**不**把 /health 当唯一判据，也**不**在 phase=ready 时再去复查它：
    //        * 实测 api 挂掉时桥的 /health 要 ~4.2s 才回（L1415 的 D3 记录），拿它当第一判据
    //          会把「慢」误判成「没好」；
    //        * 稳态下每次播报都发一次探针，只会给正常说话加延迟。所以 phase=ready 直接放行（快路径，
    //          实测 0 探针）；真出现「phase 说 ready 但桥已经死了」，下一步 synthesize 会照旧
    //          走既有的 synth_fail 告警 + 只出气泡。
    //   ③ 两者都不认但 phase ∈ {failed, disabled, stopped} ⇒ 不再空等（见下面 waitVoiceReady 的早退）。
    //
    // 上限与降级：等 `VOICE_WAIT_MAX_MS` 后**绝不丢内容** —— 照旧 pushUtterances（只有气泡），
    //   并在宿主日志里写清「为什么没出声」，供用户/agent 定位；等待本身在就绪或超时后立即停止，
    //   轮询是 4s 一次的轻量探针（/health 1.2s 预算 / 命中 phase ready 时一次都不探），不会形成轮询风暴。
    //   实测（2026-09-15，停掉语音服务再让它自启动）：闸门在桥不可达时连续等了 **48.2s**、
    //   探针 13 次（≈4s 一次），直到 /health 报 api=true 才放行 —— 与冷启动 41~56s 的窗口正好对上。
    const VOICE_WAIT_MAX_MS = 240000      // 等待上限：api 首次加载模型的内部预算是 180s（L1472），留 60s 余量
    // C-2：voiceStability=false 表示「失败可以回退到别的通道」，那就不必按"宁可不出声"的上限死等。
    // 上限取值依据：项目自记的冷启动样本是 41/45/56s，且有一次「api 就绪 → 语音链路就绪」实测正好 60s
    // ⇒ 原来的 60s 是**零边距**（叠加 4s 轮询粒度，放行时刻正好落在最坏样本的就绪时刻上，等于没覆盖）。
    // 独立复审建议 90s，采纳：既留出边距，又远小于"宁可不出声"那档的 240s。
    const VOICE_WAIT_FALLBACK_MAX_MS = 90000
    const VOICE_WAIT_INTERVAL_MS = 4000   // 轮询间隔：4s。冷启动是几十秒级事件，4s 足够细且不会压垮桥
    const VOICE_WAIT_PROBE_MS = 1200      // 单次 /health 预算：比 8100 端口的 TCP 探测(1500)更紧，避免探针本身拖长等待

    // 当下是否已能出声 —— { ready, why, phase, skipped }
    //
    // ⚠️ 第一道门是「本机现在到底用不用 aqua 桥」（实测出来的必要性）：
    //   闸门探的是桥的 /health，只有 aqua 通道（以及 auto 且配了 aqua 的降级顺序）才走它。
    //   若用户用的是 edge / quest / voiceox / openai，桥根本无关 —— 不加这道判断，
    //   那些用户每次说话都会白等满 240s 上限（比原 bug 还糟）。所以 provider 不是 aqua 时
    //   **一次探针都不发**，直接按可用放行。
    function bridgeNeeded() {
      const p = String(config.provider || '')
      if (p === 'aqua') return true
      if (p === 'auto') return !!(config.aquaVoice || config.aquaRefAudio)
      return false
    }

    async function voiceBackendReadyNow() {
      if (!bridgeNeeded()) return { ready: true, why: 'provider=' + String(config.provider || '') + ' 不走 aqua 桥（无需等待）', phase: voiceShared.state.phase, skipped: true }
      const phase = voiceShared.state.phase
      if (phase === 'ready' || phase === 'external') return { ready: true, why: 'phase=' + phase, phase }
      const bridgePort = Math.floor(Number(config.voiceBridgePort) || 8100)
      const base = String(config.aquaUrl || 'http://127.0.0.1:' + bridgePort).replace(/\/+$/, '')
      const r = await httpProbe(base + '/health', VOICE_WAIT_PROBE_MS)
      if (r.up === true) {
        let h = null
        try { h = JSON.parse(r.body) } catch (e) { h = null }
        if (h !== null && typeof h === 'object') {
          if (h.ok === true && h.api === true) {
            // `registered` 是**按需注册**的：实测桥刚起来时是 `{}`，第一次合成时才补注册并把
            // 该音色写成 "ok"（2026-09-15 实测：registered={} → 合成 200/32000Hz → registered={"sakiko":"ok"}）。
            // 所以 `{}` **必须判为可用**，否则会把"能出声"误判成未就绪、白等满 240s。
            // 'skip' 是桥主动跳过（未配权重时的正常路径），同样不算未就绪。
            const reg = h.registered
            const notOk = []
            if (reg !== undefined && reg !== null && typeof reg === 'object') {
              for (const k of Object.keys(reg)) {
                const v = String(reg[k])
                if (v !== 'ok' && v !== 'skip') notOk.push(k + '=' + v)
              }
            }
            if (notOk.length === 0) return { ready: true, why: '桥 /health 就绪（api=true，音色注册表可用）', phase }
            return { ready: false, why: '桥 /health 报了未注册音色：' + notOk.join(', '), phase }
          }
          return { ready: false, why: '桥 /health 未就绪（api=' + String(h.api) + '）', phase }
        }
        // 端口在听但不是桥（旧版桥 / 别的服务占着 8100）：不因探针看不懂就判定不可用
        return { ready: true, why: '桥端口在听但 /health 非 JSON（按可用处理）', phase }
      }
      return { ready: false, why: '桥 ' + base + '/health 不可达（' + String(r.err || '') + '）', phase }
    }

    // 所有入口共用一个在途 Promise：并发话音不会各自起一条轮询链（也就不会出现 N 份探针）
    let voiceWaitInflight = null
    // { ready, waitedMs, why, timeout, skipped }
    function waitVoiceReady() {
      if (voiceWaitInflight !== null) return voiceWaitInflight
      const run = (async () => {
        const t0 = Date.now()
        // 快路径：已经就绪（或本机根本不走 aqua 桥）—— 一秒都不多等（稳态下每次播报都走这里）
        const first = await voiceBackendReadyNow()
        if (first.ready) {
          return { ready: true, waitedMs: Date.now() - t0, why: first.why, timeout: false, skipped: first.skipped === true }
        }
        // C-2：voiceStability=false（允许回退）时不必按"宁可不出声"的上限死等，缩短到 90s
        // （VOICE_WAIT_FALLBACK_MAX_MS = 90000；本行原写 60s，与本分支把常量从 60s 提到 90s 后不一致 —— Minor-1）
        const maxMs = config.voiceStability === false ? VOICE_WAIT_FALLBACK_MAX_MS : VOICE_WAIT_MAX_MS
        voiceLog('等待语音就绪：' + first.why + '（上限 ' + Math.round(maxMs / 1000) + 's）')
        for (;;) {
          const ph = voiceShared.state.phase
          // 早退：状态机已经明确告诉我们「这次就是起不来」，再等满上限只是白等
          if (ph === 'failed' || ph === 'disabled' || ph === 'stopped') {
            return { ready: false, waitedMs: Date.now() - t0, why: first.why + '；语音状态机已判定 phase=' + ph + '（' + String(voiceShared.state.detail || '').slice(0, 120) + '），不再空等', timeout: false, skipped: false }
          }
          // C-5：按「剩余预算」睡，避免最后一轮睡过头。原先是先判超时再睡满一个周期，
          // 最坏会等 上限+4s+探针耗时（≈245s）；现在睡眠被夹在剩余时间里，实际不超过 上限+单次探针预算(1.2s)。
          const remaining = maxMs - (Date.now() - t0)
          if (remaining <= 0) {
            return { ready: false, waitedMs: Date.now() - t0, why: first.why + '（等待超过上限，按未就绪降级）', timeout: true, skipped: false }
          }
          await new Promise((r) => setTimeout(r, Math.min(VOICE_WAIT_INTERVAL_MS, remaining)))
          const now = await voiceBackendReadyNow()
          if (now.ready) {
            voiceLog('语音已就绪（等待 ' + Math.round((Date.now() - t0) / 1000) + 's）：' + now.why)
            return { ready: true, waitedMs: Date.now() - t0, why: now.why, timeout: false, skipped: false }
          }
          first.why = now.why        // 每轮刷新原因：超时后日志里给出的是**最后一次**的实况
        }
      })()
      voiceWaitInflight = run
      // 结算后立刻清空：下一句话重新按当下状态判断（就绪后走快路径，不需要再进轮询）
      run.then(() => { if (voiceWaitInflight === run) voiceWaitInflight = null },
        () => { if (voiceWaitInflight === run) voiceWaitInflight = null })
      return run
    }

    // 通用同步出声：所有宿主发起的固定话语（播报/来电/空闲/指令朗读）统一走这里。
    // 先合成进 TTS 缓存，成功后才把条目推给面板 → 气泡与语音基本同帧；合成失败仅文字（无声=自检信号）。
    async function speakSynced(jp, cn, emotion, kind, tags) {
      const emo = EMOTIONS.indexOf(emotion) >= 0 ? emotion : 'neutral'
      // 时间线：合成前记录意图与文本（截断）；完成记耗时，失败也留痕（无声=自检信号）
      tlLog({ ev: 'synth_start', kind: String(kind || ''), text: tlTrunc(jp, 160), cn: tlTrunc(cn, 120), emotion: emo, tags: tlTagFields(tags) })
      // voiceOn=false（语音关）时**不出声但仍要出气泡** —— 统一在这里判定，调用方不必各自处理。
      // 独立复审 C-3/C-4 指出：原先 announce 里 `if (voiceOn !== true) return` 会在写完备忘后提前返回，
      // 把气泡一起吞掉，与它自己的注释「立刻留痕 + 出气泡」矛盾；而为此加的 noWait 参数永远传不到这里，
      // 是个死参数（唯一调用点被那道 return 挡住）。改成在这里判定后，那条路径与 noWait 都不需要了。
      const voiceOff = config.voiceOn !== true
      // 等语音服务真的能出声再合成（见上面「语音就绪闸门」）。就绪/超时都会立刻放行：绝不因为等语音丢掉这句话。
      const gate = voiceOff
        ? { ready: false, waitedMs: 0, why: 'voiceOn=false（语音关，只出气泡）', timeout: false, skipped: true }
        : await waitVoiceReady()
      tlLog({ ev: 'voice_wait', ready: gate.ready, ms: gate.waitedMs, timeout: gate.timeout, why: tlTrunc(gate.why, 200), kind: String(kind || '') })
      if (!gate.ready && !voiceOff) {
        // 这是「预告」不是「结论」：下面仍会尝试合成，成不成要看结果。
        // 独立复审 C-1 指出原先这里断言"无法出声"，却紧接着照样调 synthesize()，一旦它成功
        // （桥在超时后刚好起来、或 auto 回退到别的通道）就会出现「日志说没声音、实际有声」的自相矛盾。
        // 真正的结论在下面的 catch 里（'合成失败（仅显示文字）'）。
        console.warn('[sakiko] 语音未就绪，本句将尝试降级为只显示文字:', gate.why,
          '| 已等待 ' + Math.round(gate.waitedMs / 1000) + 's | kind=' + String(kind || '-'),
          '| text=' + tlTrunc(String(jp === undefined ? '' : jp), 24))
      }
      const t0 = Date.now()
      if (voiceOff) {
        // 语音关：不出声是预期行为，不算失败，也不打失败日志（否则日志会误导排查）
        tlLog({ ev: 'synth_skip', why: 'voiceOn=false' })
      } else {
        try {
          await synthesize(jp, config.voiceName, config.rate, config.pitch, emo)
          tlLog({ ev: 'synth_done', ms: Date.now() - t0 })
        } catch (e) {
          // Fix R6：失败告警补上 sid + 文本前缀（截断 24 字），便于把失败对到具体那条聊天记录。
          const failSid = (tags && typeof tags.sid === 'string' && tags.sid.length > 0) ? tags.sid.slice(0, 8) : '-'
          console.warn('[sakiko] 合成失败（仅显示文字）:', e && e.message ? e.message : String(e),
            '| sid=' + failSid + ' text=' + tlTrunc(String(jp === undefined ? '' : jp), 24))
          tlLog({ ev: 'synth_fail', ms: Date.now() - t0 })
        }
      }
      if (voiceOff) {
        // 语音关：**只把中文气泡插进历史**（pushCn 推 kind:'cn'，面板走 revealHistory，不进播放队列）。
        // ⚠️ 绝不能走 pushUtterances —— 那会推成 force 条目，而客户端的 voiceOn 闸**只挡非 force**
        //    （panel.js:462 `if (!force && cfg.voiceOn !== true) return`），于是会真的发声。
        //    2026-09-15 独立复审实测：voiceOn=false 时 timeline 出现 client_play(158) 并播完 4.3s，
        //    与"只出气泡"的自述直接矛盾 —— 那是改 C-3 时修过头的回归（改前是"静默无气泡"，
        //    我把它改成了"气泡+出声"，而正确目标是"气泡、但不出声"）。
        // 代价：这条路径不带 tags（pushCn 无 tags 形参），因此日志里少了 narrate/sid/label 元数据；
        //      气泡前缀仍正确，因为 cn 里已经含了「〔会话标签〕」。
        pushCn(cn || jp, emo)
      } else if (kind === 'call') {
        pushCall(jp, emo, cn || '')
      } else {
        pushUtterances([jp], kind === 'force', emo, cn || '', tags || {})
      }
    }

    // 播报（欢迎语/完成/事件）走 speakSynced：语音就绪后同发气泡+声音。
    // voiceOn=false 时**不在这里提前 return** —— 统一交给 speakSynced（它会跳过合成但仍然推气泡）。
    // 独立复审 C-3/C-4：原先这里的 `if (voiceOn !== true) return` 会让语音关时连气泡都没有，
    // 与它自己的注释「立刻留痕 + 出气泡」矛盾；旧版之所以"不写 history、不出气泡"，是因为调用方
    // 把它挡在了 announce 之前 —— 属巧合而非设计。本注释一直声明「无论语音开关都记录」，
    // 现在行为终于与之一致。顺带：为那条被挡死的路径而加的 noWait 参数已删除（死参数）。
    async function announce(jp, cn, emotion) {
      const now = Date.now()
      const cnText = (typeof cn === 'string' && cn.length > 0) ? cn : jp
      // 播报留痕对话区（无论语音开关都记录；对话区显示中文 cn）
      memory.history.push({ role: 'assistant', jp, cn: cnText, emotion: emotion || 'neutral', announce: true, t: now })
      if (memory.history.length > 60) maybeCompactHistory()
      if (now - lastAnnounceAt < 8000) return
      lastAnnounceAt = now
      await speakSynced(jp, cnText, emotion || 'neutral', 'force', { announce: true })
    }

    // ============================================================
    // 进度叙事系统（Progress Narrator）——Task 1：路由器 + 状态机 + 台词池 + LLM 总结 + 旧播报收编
    // 统一收编旧 notifyComplete / subagent/end / workflow/end / agent/error / jobs 零散播报，
    // 归一为 narrate(intent) 意图路由器：start/done/milestone/block/fail/special/goal。
    // 模板词严格取自 narrator-phrases.md（S1-S3 / D1-D2 / M1-M2 / B1-B4 / F1-F2）；
    // A3/A4 沿用旧播报文案（只搬位置、不改词）。出口统一 speakSynced（先合成后同发，队列串行不叠播）。
    // ============================================================
    const NARR_INTENT_GAP_MS = 8000   // 同意图 8s 合并窗
    const NARR_LLM_GAP_MS = 8000      // LLM 总结最低间隔（防连续回合烧 token）
    // Fix R1（Important-1）：刚收尾的会话仍计入「活跃」的宽限窗。
    // 原因：handleTurnEnd 先把 turnActive 置 false 再 narrate('done')，交付又发生在微任务之后——
    // 若判定只看 turnActive，并发/先后收尾时最后一个收尾者会看到「只剩自己」→ auto 掉前缀。
    // 取值与 done/goal 同族 8s 窗一致：8s 内的收尾视为同一次「多工作区收尾」。
    const NARR_ACTIVE_GRACE_MS = 8000
    // Fix R1（Important-2）：turnActive 的陈旧上限——超过此时长没有任何事件（lastActiveAt 过旧）的会话
    // 按空闲处理（漏收尾/窗口中途关闭的会话不再长期污染 auto 判定，也不再永占注册表名额）。
    // 30 分钟：长工具调用期间 session/event 事件流不断，正常回合不会 30 分钟无事件。
    const NARR_AUTO_IDLE_MS = 1800000
    const NARR_PRIORITY = { block: 40, fail: 30, done: 20, goal: 20, special: 15, milestone: 10, start: 5 }
    const NARR_LLM_EMOTIONS = ['happy', 'soft', 'neutral', 'question', 'excited']

    // 台词表（唯一模板来源 narrator-phrases.md，JP/CN/emotion 原样抄录；LLM 句不参与池轮换）
    const NARR_LINES = {
      // START S1-S3（有据开工：首个工具调用）
      s1: { jp: 'お仕事が始まったようですわね。わたくし、ここで応援していますわ', cn: '看来开始干活了呢。我就在这里给你加油哦', emotion: 'happy' },
      s2: { jp: 'ふふ、始まりましたわね。焦らず、着実に参りましょう', cn: '呵呵，开始了呢。别急，稳步来吧', emotion: 'soft' },
      s3: { jp: 'なんだか楽しそうですわね。何が出来上がるのかしら', cn: '感觉很有意思呢。会做出什么来呢', emotion: 'soft' },
      // DONE 兜底 D1-D2（LLM 失败/超时/未开 LLM 时）
      d1: { jp: 'ひと区切りつきましたわね。次の一手を考えましょう', cn: '告一段落了呢。想想下一步吧', emotion: 'happy' },
      d2: { jp: 'できましたわ。ここからどう進めましょうか', cn: '做好了哦。接下来往哪走呢', emotion: 'soft' },
      // MILESTONE M1-M2（LLM 摘要失败兜底）
      m1: { jp: 'まだ作業中ですわね。順調に進んでいるようで安心しました', cn: '还在进行中呢。看来进展顺利，我就放心了', emotion: 'soft' },
      m2: { jp: '長いお仕事ですわね。わたくしも一緒に付き合っておりますわ', cn: '是项长久的工作呢。我也一直陪着你哦', emotion: 'soft' },
      // BLOCK B1-B4（阻塞提醒：按触发固定选句，语义不可互替）
      b1: { jp: '承認が必要なようですわ。ご確認をお願いいたします', cn: '需要你批准一下哦。请确认', emotion: 'question' },
      b2: { jp: 'あなたのご返事を待っておりますわ。じっくりお考えくださいませ', cn: '在等你回复呢。请慢慢考虑', emotion: 'soft' },
      b3: { jp: '計画をご確認いただけますかしら。問題なければ進めてくださいませ', cn: '请过目一下计划。没问题的话就可以推进了哦', emotion: 'question' },
      b4: { jp: 'お手元の確認待ちですわ。落ち着いてどうぞ', cn: '在等你在界面上确认哦。慢慢来', emotion: 'soft' },
      // FAIL F1-F2（agent/error）
      f1: { jp: 'あら…うまくいきませんでしたわね。慌てずに原因を探りましょう', cn: '哎呀……不太顺利呢。别慌，我们一起找原因吧', emotion: 'soft' },
      f2: { jp: 'エラーが出たようですわ。わたくしも見ておりますので、落ち着いてどうぞ', cn: '好像出错了。我也看着呢，冷静处理吧', emotion: 'question' },
    }
    // 可轮换池：start/done/milestone/fail（LRU：最近一条沉底 → 游标轮转，绝不立刻复读）
    const NARR_POOLS = { start: ['s1', 's2', 's3'], done: ['d1', 'd2'], milestone: ['m1', 'm2'], fail: ['f1', 'f2'] }
    // BLOCK 各触发对应的固定句（b1 审批 / b2 提问等待 / b3 计划审批 / b4 其它界面等待）
    const NARR_BLOCK_IDS = { b1: 'b1', b2: 'b2', b3: 'b3', b4: 'b4' }
    // 收编自旧播报的文案常量（A3 任务完成 = 考据表 A3；A4-1 子代理 / A4-2 工作流成功 / A4-3 工作流出错 / A4-4 后台任务结束）
    const NARR_A3 = { jp: 'やり遂げたのですね。うれしいですわ', cn: '你做到了呢。真替你高兴', emotion: 'happy' }
    const NARR_A4 = {
      subagent: { jp: 'あら、何か動きがあったようですわね。ゆっくりお話を聞かせてください', cn: '哎呀，好像有什么新进展了呢。慢慢讲给我听吧', emotion: 'soft' },
      workflowOk: { jp: '完了いたしましたわ。ここから先も、一緒に頑張りましょう', cn: '已经完成了。接下来的路，也一起加油吧', emotion: 'happy' },
      workflowErr: { jp: '大丈夫ですわ', cn: '没事的', emotion: 'soft' },
      jobDone: { jp: 'お待たせしましたわね。ようやく一段落したようですわ', cn: '让你久等了。总算是告一段落了', emotion: 'soft' },
    }

    // ============================================================
    // 多工作区播报（Task 1）：全局键 + 会话注册表 + per-session 回合态
    //   全局保留（跨会话共享，随 narrator.json 落盘）：counts / lastSummary / lastLLMAt / poolCursor
    //   全局保留（内存）：台词池游标状态 poolLastUsed / 最近发声留档 lastNarrSpeaks / 播报批次队列
    //   per-session（不落盘）：回合瞬态 + 节流占位（lastSpokeByIntent / lastDoneFamilyAt）
    // ============================================================
    const narrGlobal = {
      counts: { start: 0, done: 0, milestone: 0, block: 0, fail: 0, special: 0, goal: 0 },
      lastSummary: '',
      lastLLMAt: 0,
      poolCursor: {},
      sessions: {},   // Fix T4：per-session 分片摘要（label/milestoneCount/lastSummary/updatedAt），随 narrator.json 落盘
    }

    // 单个会话（或默认槽）的回合态；sid 供播报归属与里程碑巡检回传
    function makeTurnState(sid) {
      return {
        sid: typeof sid === 'string' ? sid : '',
        // ---- 回合瞬态 ----
        turnActive: false,
        turnStartAt: 0,
        stepCount: 0,
        startSpoken: false,
        milestoneSpoken: false,   // Task 10 起语义收窄为「本回合**触发**过里程碑（含未被受理的尝试）」—— 与 lastMilestoneAt 同款口径：在触发点置位，交付被吞时**不回退**；只在回合起止/抹态时清零（供 narratorStatus），不再是闸门
        lastMilestoneAt: 0,       // Task 10 周期制：上次里程碑（含未被受理的尝试）的时刻；基准 = 回合起点
        lastMilestoneStep: 0,     // Task 10 周期制：上次里程碑时的步数；步数型按「步数增量」判定
        turnGoalDone: false,
        blocking: null,        // 'b1'..'b4' | null
        lastUserText: '',
        lastAssistantText: '', // 本回合**最近一条非空**助手文本（A：DONE 总结的「结尾最核心的输出」，仅回合内使用，不落盘）
        toolNames: {},         // 本轮工具名 → 次数
        turnEndedAt: 0,        // 本回合收尾时刻（Fix R1：auto 活跃判定的 8s 宽限窗依据）
        // ---- 节流占位（per-session：Task 3 在此之上加跨会话互斥窗） ----
        lastDoneFamilyAt: 0,             // done/goal 完成语义 8s 互斥窗
        lastSpokeByIntent: new Map(),    // 同意图最近发声时刻
      }
    }
    // 单一默认槽：multiSession:false 时所有会话共用；也充当「无归属会话」事件
    // （子代理结束 / 工作流 / agent 错误 / 后台任务 / testNarrator）的落点
    const defaultSlot = { state: makeTurnState('') }
    // 会话注册表：sid → { sid, label, cwd, title, lastActiveAt, state }
    const sessions = new Map()
    const SESSIONS_MAX = 64   // 注册表上限（满员淘汰：优先非回合进行中者，见 evictSessions）
    let sessionsWarnedFull = false   // 满员告警只打一次（Task 2）

    // ============================================================
    // 子代理会话判定（Task 5：`narrateSubagents` 开关的判据）
    //   实测依据（dsh-session / dsh-subagent 源码）：
    //     ① `session.header.origin === 'subagent'` —— dsh-subagent 建子会话时写入的**产品分类**
    //        （`childSessionMeta()`：`origin: 'subagent'`），语义最明确；
    //     ② `session.header.delegationDepth >= 1` —— 持久化的**委派深度**（顶层会话缺失/为 0，
    //        子会话 = 父深度 + 1），跨重启/续跑仍成立，作为同源的第二判据；
    //     ③ `childSids` —— 由 `subagent/descriptor` 事件登记：子会话日志创建时会 `append('subagent/descriptor')`
    //        （见 `dsh-subagent/descriptor-seed.js`），该事件经 session/event 以**子会话**为 session 送达，
    //        因此「见过该事件的 sid」即可判定为子代理会话（用于 header 信息缺失的兜底）；
    //     ④ 兜底：`ctx.sessions.get(sid)` 读 header（宿主提供该服务时；sakiko 未注入 sessions，通常为 undefined）。
    //   ⚠ 单独出现 `session.header.parentSession` **不作为判据**——它同时用于「用户 fork 出来的会话」
    //     （文档：session this one was forked from / seed lineage），据此判定会把用户自己的分叉会话误杀。
    // ============================================================
    const childSids = new Set()   // 由 subagent/descriptor 事件登记的 sid（header 信息缺失时的兜底判据）
    function isSubagentHeader(h) {
      if (h === null || h === undefined || typeof h !== 'object') return false
      if (h.origin === 'subagent') return true
      if (typeof h.delegationDepth === 'number' && isFinite(h.delegationDepth) && h.delegationDepth >= 1) return true
      return false
    }
    function isSubagentSession(session) {
      try {
        if (isSubagentHeader(session === null || session === undefined ? undefined : session.header)) return true
        const sid = sidOf(session)
        if (sid.length > 0 && childSids.has(sid)) return true
        // 兜底：session 对象不可用/无 header 时，向宿主 session store 询问（服务不存在则跳过）
        if (sid.length > 0) {
          const svc = ctx.get('sessions')
          if (svc !== undefined && typeof svc.get === 'function') {
            const s2 = svc.get(sid)
            if (isSubagentHeader(s2 === null || s2 === undefined ? undefined : s2.header)) return true
          }
        }
      } catch (e) { /* 判定异常 → 按「非子代理」处理（默认开关开启时与现状一致，最保守） */ }
      return false
    }

    // ---- 标签三级回退：① session/title 标题 → ② basename(cwd) → ③ basename(cwd)·sid4（撞车双方都加） ----
    function sidOf(session) {
      try {
        const id = (session === null || session === undefined) ? '' : session.id
        return (typeof id === 'string' && id.length > 0) ? id : ''
      } catch (e) { return '' }
    }
    function cwdOf(session) {
      try {
        const h = (session === null || session === undefined) ? undefined : session.header
        const cwd = (h === null || h === undefined) ? undefined : h.cwd
        return (typeof cwd === 'string' && cwd.length > 0) ? cwd : ''
      } catch (e) { return '' }
    }
    function basenameOf(p) {
      const s = String((p === null || p === undefined) ? '' : p).replace(/[\\/]+$/, '')
      if (s.length === 0) return ''
      const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
      return i >= 0 ? s.slice(i + 1) : s
    }
    function sidShort(sid) { return String(sid).slice(0, 4) }
    // 按**码点**截断的共享小工具（唯一实现）——String.prototype.slice 按 UTF-16 码元切，保留位数正好落在
    //   emoji 代理对中间时会切出孤立代理项（面板渲染成 �、JSON 里是未配对 surrogate）。Array.from 按码点
    //   迭代，keep = 保留的可见字符数（一个 emoji 由 2 码元算作 1 字）；纯 ASCII/CJK 行为逐字不变。
    //   normTitle（标题 40 字）与 shortenSubagentLabel（子代理标签）共用，避免同一种缺陷写两遍。
    function truncCps(s, keep) {
      const t = String(s)
      const cps = Array.from(t)
      return cps.length > keep ? cps.slice(0, keep).join('') : t
    }
    // 按码点保留**尾部**的配套版本（R5）：`s.slice(-keep)` 与 `s.slice(0, keep)` 是同一缺陷的两半——
    //   按码元切时若切点落在代理对中间，前者会在**字符串开头**留下孤立低位代理项（低位先行），
    //   危害与头部版同构：写盘 → JSON 里成 \udXXX、面板渲染成 �。判定与切分一律按码点，
    //   未超长（码点数 ≤ keep）返回原串。纯 ASCII/CJK 与旧的 slice(-keep) 逐字一致。
    function tailCps(s, keep) {
      const t = String(s)
      const cps = Array.from(t)
      return cps.length > keep ? cps.slice(-keep).join('') : t
    }
    // 首+尾取法（A2，2026-09-12）：预算 keep 个可见字符
    //   · 码点数 ≤ keep → **原样全给**（不加任何标记，返回值 === 入参）；
    //   · 码点数 > keep → 首 headN + 中略标记 + 尾 tailN，headN = ceil(keep*0.6)、tailN = keep - headN
    //     （keep=400 → 240 + 160；keep=800 → 480 + 320。按公式取值：ceil(0.6×400)=240，不是整 250）。
    //     动机：助手文本码点 p50=432 / p90=1110，实测 53.6% 的回合被截断，而「结论 / 下一步」常在消息**末尾**
    //     ——只取开头正好把最该给 LLM 的信息切掉，故尾部必须留一段。
    //   · 切分**复用 truncCps（取首）与 tailCps（取尾）**，两者都按码点切：不切开 emoji 代理对，
    //     也不产生孤立代理项（自己写 slice 会踩这个坑）；keep 为 0 时不调用本函数（调用侧直接不注入）。
    const NARR_MID_MARK = '…（中略）…'
    function headTailCps(s, keep) {
      const t = String(s)
      const head = truncCps(t, keep)            // 未超长时 === t（同时充当「是否需要截断」的判定）
      if (head === t) return t                  // 不截断：原样，**不加标记**
      const headN = Math.ceil(keep * 0.6)
      const tailN = keep - headN
      // tailN === 0 时不取尾：tailCps(t, 0) 的 slice(-0) 等于 slice(0)（整个数组）——必须显式挡掉
      return truncCps(t, headN) + NARR_MID_MARK + (tailN > 0 ? tailCps(t, tailN) : '')
    }
    function normTitle(v) {
      return (typeof v === 'string' && v.trim().length > 0) ? truncCps(v.trim(), 40) : ''
    }
    // 取某个会话的事件日志。
    //   ★ 2026-09-14 修复：DSH 的 Session 对象**没有 `.events` 属性** —— 事件日志只通过
    //     `snapshotEvents()` 方法暴露（dsh-session/lib/index.js L1107：无参调用返回已被缓存并
    //     `Object.freeze` 的完整快照；DSH 自己 L1219 / L1594 也是这么用的）。
    //     旧实现直接读 `session.events`，恒为 undefined → titleFromLog 永远返回 ''
    //     → 「标签三级回退」的第①级（会话标题）从不生效 → 永远落到第②级 `basename(cwd)`，
    //     即**工作区目录名**。现场表现：祥子播报前缀显示 "deepseek harness"（cwd 的 basename）
    //     而不是会话标题（如 "sakiko"）。
    //   按「当前 API → 旧形状 → 内部字段」依次探测，任一可用即可。
    function sessionEvents(session) {
      try {
        if (session === null || session === undefined) return []
        if (typeof session.snapshotEvents === 'function') {
          const evs = session.snapshotEvents()
          if (Array.isArray(evs)) return evs
        }
        if (Array.isArray(session.events)) return session.events   // 旧形状（历史上曾可用）
        if (Array.isArray(session.log)) return session.log         // 内部字段兜底（非公开 API）
      } catch (e) { /* 任何一步异常都退到下一种来源 */ }
      return []
    }
    // 会话标题也可从事件日志回折（插件晚挂载时首见即拿到既有标题；不可读则走 cwd 回退）
    function titleFromLog(session) {
      try {
        const evs = sessionEvents(session)
        for (let i = evs.length - 1; i >= 0; i--) {
          const ev = evs[i]
          if (ev && ev.type === 'session/title') {
            const t = normTitle(ev.data && typeof ev.data === 'object' ? ev.data.title : undefined)
            if (t.length > 0) return t
          }
        }
      } catch (e) { /* 日志不可读：忽略 */ }
      return ''
    }
    // ============================================================
    // Fix R2（label 截断）：**子代理会话**的标签统一截断为 12 字 +「…」（仅当原长 > 12）
    //   · 截断发生在**存储层**（注册表 rec.label）→ 气泡前缀 / narratorStatus.sessions[].label /
    //     memory.history.label / progress[sid].label / timeline 的 label 全部同源一致；
    //   · 非子代理会话（你自己的会话、用户 fork）标签**保持原样**（不截断、语义不变）；
    //   · 子代理判定复用 Task 5 的判据（rec.isSubagent 或 childSids）——迟到 descriptor 回写后
    //     会重跑 refreshLabels()，标签随即被截断。
    //   · Fix R3（两个 cosmetic Minor）：① 按**码点**截断，不切开 emoji 代理对；② 带 ·sid4 后缀时
    //     **先截前缀再补后缀**，不残留半截后缀（详见 shortenSubagentLabel 与第二段注释）。
    // ============================================================
    const SUBAGENT_LABEL_KEEP = 12          // 子代理标签保留字符数（超出 → 保留 12 字 + 「…」）
    const SUBAGENT_LABEL_TIE_KEEP = 7       // 截断后同名时的前缀预算（7 +「…」+「·sid4」= 13，与普通子代理标签同长）
    function recIsSubagent(rec) {
      return rec.isSubagent === true || childSids.has(rec.sid)
    }
    // Minor-1（emoji 代理对被切开）：与 normTitle 共用 truncCps（按码点截断）——未发生截断时返回原串，
    //   否则补「…」。keep 语义不变：「截断前保留的可见字符数」（中英文行为不变，一个 emoji 算 1 字）。
    function shortenSubagentLabel(s, keep) {
      const t = String(s)
      const cut = truncCps(t, keep)
      return cut === t ? t : cut + '…'
    }
    // 注册表级标签重算（Fix R2 起为两段式）：
    //   第一段（语义与既有完全一致）：有标题者用标题且不参与撞车判定；无标题者按 basename 分组，
    //     同一 basename 被 ≥2 个无标题会话占用（或无 cwd 的独苗）→ 本会话与冲突方都加 ·sid4。
    //   第二段（仅子代理）：**从 rawBase 构造**标签并截断为 12 字 +「…」（第一段加的 ·sid4 原样
    //     补回，且此时前缀预算收窄到 7，绝不把后缀切成半截——Minor-2）；若**截断后**出现同名（例如
    //     两个长 basename 前缀相同），则先截断再加后缀——前缀预算同样为 7，再补 ·sid4（sid 前 4 位
    //     天然唯一），因此「两个子代理截断后同名」仍可区分，且长度与普通子代理标签一致（≤12，截断时 13）。
    function refreshLabels() {
      // ---- 第一段：基础标签（保持既有语义） ----
      const groups = new Map()
      for (const rec of sessions.values()) {
        const t = normTitle(rec.title)
        rec.rawBase = t.length > 0 ? t : basenameOf(rec.cwd)
        if (t.length > 0) { rec.baseLabel = t; rec.baseSuffix = ''; continue }
        rec.baseLabel = rec.rawBase
        const key = rec.rawBase.toLowerCase()
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(rec)
      }
      for (const rec of sessions.values()) {
        if (normTitle(rec.title).length > 0) continue
        const list = groups.get(rec.rawBase.toLowerCase()) || []
        const collide = list.length >= 2 || rec.rawBase.length === 0
        // baseSuffix 单列记下：第二段必须「先截前缀、再补后缀」，否则会把 ·sid4 切成半截（Minor-2）
        rec.baseSuffix = collide ? '·' + sidShort(rec.sid) : ''
        rec.baseLabel = (rec.rawBase.length > 0 ? rec.rawBase : '会话') + rec.baseSuffix
      }
      // ---- 第二段：子代理截断（存储层） ----
      const subGroups = new Map()
      for (const rec of sessions.values()) {
        if (!recIsSubagent(rec)) { rec.label = rec.baseLabel; continue }
        // Minor-2：从 rawBase 构造前缀（与下方消歧分支同一套做法）再原样补回第一段已加过的后缀——
        //   绝不截断「已经带后缀的 baseLabel」，否则 ·sid4 会残留半截（如 project-xy·s…）。
        //   带后缀时前缀预算收窄到 TIE_KEEP，使「前缀…+·sid4」与下方消歧分支同长（≤13 字）。
        const sfx = rec.baseSuffix || ''
        const base = rec.rawBase.length > 0 ? rec.rawBase : '会话'
        rec.label = shortenSubagentLabel(base, sfx.length > 0 ? SUBAGENT_LABEL_TIE_KEEP : SUBAGENT_LABEL_KEEP) + sfx
        const key = rec.label.toLowerCase()
        if (!subGroups.has(key)) subGroups.set(key, [])
        subGroups.get(key).push(rec)
      }
      for (const list of subGroups.values()) {
        if (list.length < 2) continue
        for (const rec of list) {
          // 截断后同名 → 用未经后缀的 rawBase 收窄前缀 + ·sid4（丢掉上一段可能加过的后缀，避免叠两层）
          rec.label = shortenSubagentLabel(rec.rawBase.length > 0 ? rec.rawBase : '会话', SUBAGENT_LABEL_TIE_KEEP) + '·' + sidShort(rec.sid)
        }
      }
    }
    // 注册表满员淘汰。Task 2 修既存缺陷（复审 probe6）：候选**排除刚注册的 sid**（keepKey）——
    // 改前若全部记录都 turnActive===true，唯一候选恰好是刚注册的新记录 → 新人自我淘汰 →
    // 该会话每来一个事件就重建分片（同回合重复 START、stepCount 读不到）。
    // 现语义：① 优先淘汰「非活跃且非刚注册」的最久未活跃者；
    //          ② 无空闲候选时退化为淘汰最久未活跃者（含活跃者，仍排除刚注册者）；
    //          ③ 极端情形（注册表里除刚注册者外已无记录）不淘汰——宁可短暂超限，也不让新人自我淘汰。
    // Fix R2（Important-新-1）：「活跃」判据放宽为「turnActive 且 lastActiveAt 新鲜（<= NARR_AUTO_IDLE_MS）」——
    // 久无事件却仍 turnActive 的陈旧记录因此可以被淘汰（这是清扫函数被删除后唯一的功能缺口），
    // 且这里是**只读判断**，不会破坏该会话仍在推进的回合态（不重复 START、不丢里程碑、不降级 goal）。
    function sessionBlocksEviction(rec, now) {
      return rec.state.turnActive === true && (now - rec.lastActiveAt) <= NARR_AUTO_IDLE_MS
    }
    function evictSessions(keepKey) {
      if (sessions.size <= SESSIONS_MAX) return
      if (!sessionsWarnedFull) {
        sessionsWarnedFull = true
        console.warn('[sakiko] 会话注册表已满：上限 ' + SESSIONS_MAX + ' 条，开始淘汰最久未活跃的会话（被淘汰会话的标签/回合状态将失效）')
      }
      const now = Date.now()
      while (sessions.size > SESSIONS_MAX) {
        let victimKey = null
        let victimAt = Infinity
        for (const [key, rec] of sessions) {
          if (key === keepKey) continue                    // 绝不淘汰刚注册者
          if (sessionBlocksEviction(rec, now)) continue    // 优先：仍在活跃推进的会话不动
          if (rec.lastActiveAt < victimAt) { victimAt = rec.lastActiveAt; victimKey = key }
        }
        if (victimKey === null) {
          // 第二轮：没有空闲候选（例如全部会话都在活跃推进）→ 退化为淘汰最久未活跃者
          for (const [key, rec] of sessions) {
            if (key === keepKey) continue
            if (rec.lastActiveAt < victimAt) { victimAt = rec.lastActiveAt; victimKey = key }
          }
        }
        if (victimKey === null) break
        sessions.delete(victimKey)
      }
    }
    function registerSession(sid, session) {
      const rec = {
        sid,
        label: '',
        cwd: session ? cwdOf(session) : '',
        title: session ? titleFromLog(session) : '',
        lastActiveAt: Date.now(),
        state: makeTurnState(sid),
        // Task 5：注册时定格子代理判定（供开关关闭后仍需过滤已注册会话的路径，如里程碑巡检）
        isSubagent: isSubagentSession(session),
      }
      sessions.set(sid, rec)
      refreshLabels()
      evictSessions(sid)   // 传入刚注册的 sid：满员时绝不淘汰新人（Task 2 修复）
      return rec
    }
    // 每次 session/event 续活：首见注册；cwd 变化时重算标签；lastActiveAt 每次事件刷新
    function touchSession(session) {
      const sid = sidOf(session)
      if (sid.length === 0) return null
      let rec = sessions.get(sid)
      if (rec === undefined) rec = registerSession(sid, session)
      const cwd = cwdOf(session)
      if (cwd.length > 0 && cwd !== rec.cwd) { rec.cwd = cwd; refreshLabels() }
      rec.lastActiveAt = Date.now()
      return rec
    }
    // session/title 到达：更新 title/label（只影响之后的播报；撞车后缀随之解除）
    function setSessionTitle(rec, title) {
      if (rec === null) return
      const t = normTitle(title)
      if (t.length === 0 || t === rec.title) return
      rec.title = t
      refreshLabels()
    }

    // ---- provider：状态访问（Task 2/3 在 stateFor/activeRecords 之上加标签文案与节流） ----
    function stateFor(sid) {
      if (config.multiSession === false) return defaultSlot.state
      const key = (typeof sid === 'string' && sid.length > 0) ? sid : ''
      if (key.length === 0) return defaultSlot.state
      const rec = sessions.get(key)
      if (rec !== undefined) return rec.state
      return registerSession(key, null).state
    }
    // 里程碑巡检候选（Task 10 Fix）：**记录 + 回合态成对**返回。
    //   改动前这里叫 activeStates() 且只回传 st —— 30s 巡检因此拿不到 rec.lastActiveAt，
    //   无法判断「这个会话早就不输出了」⇒ 漏收尾的僵尸回合会被按周期无限补播里程碑
    //   （现场与根因链见 docs/narrator-milestone.md §7）。
    //   三条语义与改动前**逐条一致**（本函数全文件唯一调用方就是 30s 巡检）：
    //     ① multiSession === false → 只有默认槽一项（单槽行为 = 现状）；
    //     ② multiSession === true  → 遍历注册表；默认槽**仅在 turnActive === true 时**并入（Fix R1 Minor-1）。
    //     ③ 默认槽**没有注册记录** ⇒ rec 为 null —— 调用方不得据此丢弃它（它本来就不在注册表里）。
    //   ⚠ 已知并**被用户接受**的残余（2026-09-20 裁决原话：「不覆盖，只写清楚」）：默认槽不参与
    //     巡检的活跃度过滤（它没有 rec）⇒ 一个落在默认槽且永不收尾的回合仍会被按周期无限补播。
    //     `multiSession:false` 下 `stateFor` 第一行就返回 defaultSlot ⇒ **每个回合都落默认槽**，
    //     候选集恒为 [{sid:'', rec:null}] ⇒ 本兜底对单会话模式提供 0 保护（原缺陷无界可达）。
    //     详见 docs/narrator-milestone.md §7.4 第 3 条；要覆盖它必须改这两条语义并同步改测试与文档。
    function activeRecords() {
      if (config.multiSession === false) return [{ st: defaultSlot.state, rec: null }]
      const out = []
      for (const rec of sessions.values()) out.push({ st: rec.state, rec })
      // Fix R1（Minor-1）：multiSession:true 下若事件无归属（session 为 falsy → 状态落默认槽），
      // 该回合也要被 30s 巡检覆盖——步数型里程碑在 tool/call 分支内即时判定，时间型只能靠巡检，
      // 漏掉默认槽会让「无归属回合」的时间型里程碑永不触发（并入后才是真正等价旧单一槽行为）。
      // 默认槽空闲（turnActive!==true）时不并入：多会话常态下巡检规模与之前一致。
      if (defaultSlot.state.turnActive === true) out.push({ st: defaultSlot.state, rec: null })
      return out
    }
    // 焦点状态（narratorStatus.state）：单一默认槽，或最近活跃的会话态
    function primaryState() {
      if (config.multiSession === false) return defaultSlot.state
      let best = null
      for (const rec of sessions.values()) {
        if (best === null || rec.lastActiveAt > best.lastActiveAt) best = rec
      }
      return best === null ? defaultSlot.state : best.state
    }
    // 复位一个回合态（保留 sid 与对象引用）：回合瞬态清零 + 节流占位清空。
    // 注意与 resetTurn(st) 的区别：那个是「开新回合」，本函数是「抹掉现有回合」。
    function clearTurnState(st) {
      st.turnActive = false
      st.turnStartAt = 0
      st.stepCount = 0
      st.startSpoken = false
      st.milestoneSpoken = false
      st.lastMilestoneAt = 0
      st.lastMilestoneStep = 0
      st.turnGoalDone = false
      st.blocking = null
      st.lastUserText = ''
      st.lastAssistantText = ''
      st.toolNames = {}
      st.turnEndedAt = 0
      st.lastDoneFamilyAt = 0
      st.lastSpokeByIntent.clear()
    }
    // Fix R1（Important-2）：multiSession false→true 回切时复位保留的分片态。
    // false 期间所有事件只写默认槽，各会话分片停在回切前的旧值；直接复活会造成：
    //   ① 30s 巡检为早已结束的回合补播里程碑（陈旧 turnActive/turnStartAt/stepCount）；
    //   ② 陈旧 blocking 长期抑制该会话的里程碑；
    //   ③ 陈旧 turnActive=true 使该记录永不被 evictSessions 淘汰（超上限时直接 break）。
    // 因此回切即清空各会话态与默认槽（label/cwd/title/lastActiveAt/注册表条目全部保留；
    // 正在 in-flight 的回合会回到「未开口」状态，其后续 tool/call 会重新走 START——这是回切语义的已知代价）。
    function resetRetainedStates() {
      for (const rec of sessions.values()) clearTurnState(rec.state)
      clearTurnState(defaultSlot.state)
      return sessions.size
    }

    // ============================================================
    // Task 2：播报归属与工作区标签（气泡前缀 + LLM 注入）
    //   标签来源 = Task 1 注册表的 label（会话标题 → basename(cwd) → basename(cwd)·sid4）
    //   口径（用户已确认）：气泡 CN 带「〔<label>〕」；jp 语音文本一律不改（不把中文名塞进日文 TTS）；
    //   无归属播报（无 sid：启动欢迎语 / 空闲闲聊 / 来电 / 工作流·后台任务 special / testNarrator）
    //   一律不加前缀。
    //   X5 例外：`subagent/end` 用 `info.id` 显式算出的标签（subagentEndPrefix）带前缀——
    //   它**仍落默认槽**（不传 sid），只是气泡 CN 多了「〔label〕」。
    // ============================================================
    function labelForSid(sid) {
      if (typeof sid !== 'string' || sid.length === 0) return ''
      const rec = sessions.get(sid)
      if (rec === undefined) return ''
      return typeof rec.label === 'string' ? rec.label : ''
    }
    // 单个会话此刻是否算「活跃」（prefix='auto' 判定的基础，Fix R1 重构）：
    //   ① 回合进行中且回合没有久到失去联系（lastActiveAt 在 NARR_AUTO_IDLE_MS 内）→ 活跃
    //      （Important-2：漏收尾/窗口中途关闭而永久 turnActive 的会话，30 分钟后不再算活跃）
    //   ② 或 刚收尾（turnEndedAt 在 NARR_ACTIVE_GRACE_MS 宽限窗内）→ 活跃
    //      （Important-1：并发/先后收尾时，各自的 DONE 都能看到「有多个工作区在收尾」→ 都带前缀）
    function sessionCountsAsActive(rec, now) {
      const st = rec.state
      if (st.turnActive === true && (now - rec.lastActiveAt) <= NARR_AUTO_IDLE_MS) return true
      if (typeof st.turnEndedAt === 'number' && st.turnEndedAt > 0 && (now - st.turnEndedAt) <= NARR_ACTIVE_GRACE_MS) return true
      return false
    }
    // 活跃会话数（prefix='auto' 的判定）：
    //   - 逐会话按 sessionCountsAsActive 计（每个会话最多计一次）；
    //   - 简报口径「含本次事件所属会话」→ includeSid 即使两项都不成立也算一份（首个事件即 tool/call、或本次事件刚把它激活）；
    //   - 无归属事件（sid 为空）不计入；multiSession:false 时全部会话共用一个槽 → 取默认槽（0/1），auto 恒不加前缀 = 现状。
    function activeSessionCount(includeSid) {
      if (config.multiSession === false) return defaultSlot.state.turnActive === true ? 1 : 0
      const now = Date.now()
      let n = 0
      for (const rec of sessions.values()) {
        if (sessionCountsAsActive(rec, now)) n += 1
      }
      if (typeof includeSid === 'string' && includeSid.length > 0) {
        const rec = sessions.get(includeSid)
        if (rec !== undefined && !sessionCountsAsActive(rec, now)) n += 1
      }
      return n
    }
    // 注（Fix R2 / Important-新-1）：这里**不再**做「清扫陈旧回合」的破坏性收尾。
    // 只读诉求（恢复可淘汰性）已在 evictSessions 的淘汰判据里用一行新鲜度判断实现；
    // 而 clearTurnState 是破坏性的，会把一个「真在跑但静默 >30 分钟」的回合清掉，导致
    //   ① 同回合下一个工具调用重复播报 START（startSpoken 被清）；
    //   ② 该回合剩余里程碑全部失效（maybeMilestone 要求 turnActive===true）；
    //   ③ turnGoalDone 被清 → 收尾由 A3「goal」降级为 done。
    // 气泡前缀：'always'（**默认**）→ 有归属即带；'auto' → 活跃会话 ≥2 才有；
    //   标签不可得（无 sid/未注册/空 label）→ 恒为 ''
    // multiSession:false（总开关关闭）→ 恒为 ''：spec §4「关=退回现状单例行为」/§5.5「完全退回现状」，
    // 且保证 multiSession 仍是「一键回退到基线」的开关（前缀与 LLM 注入同属该特性）。
    // X5 重构：策略本体抽成 attributionFor(sid,label)，供 subagentEndPrefix 在「显式给标签」时复用
    //   同一套开关/模式判据（不复制策略、不绕过 multiSession 与 'auto' 的活跃数判据）。
    // Minor-2（复审 X5）：**前缀与归属标签在同一处判定、一并回传**，返回 { prefix, label }。
    //   隐式不变量：`label` 非空 ⟺ 显示前缀（prefix 以「〔label〕」开头）——保存下来供气泡与
    //   lastSpeaks[].label 同源使用，杜绝「bubble 带〔x5-demo〕而 label 为空」的自相矛盾。
    //   不显示前缀时（multiSession:false / mode='auto' 且活跃会话 <2 / 标签为空）两者同为空串。
    function attributionFor(sid, label) {
      const none = { prefix: '', label: '' }
      if (config.multiSession === false) return none
      if (typeof label !== 'string' || label.length === 0) return none
      const mode = typeof config.multiSessionPrefix === 'string' ? config.multiSessionPrefix : 'always'
      let show = false
      if (mode === 'always') show = true
      else if (mode === 'auto') show = activeSessionCount(sid) >= 2
      return show ? { prefix: '〔' + label + '〕', label } : none
    }
    function bubblePrefixFor(sid) {
      return attributionFor(sid, labelForSid(sid)).prefix
    }
    // ============================================================
    // X5（任务 A）：`subagent/end` 的归属前缀 + 归属标签。
    //   事件本体**不带 sid 语义**，必须继续落默认槽（L2712：传 sid 会把这些事件挪进该会话的
    //   节流槽，改变既有节奏）——所以**不传 sid**，改为在事件处理同步段把结果算好，
    //   显式传 `bubblePrefix` / `label`（两条都只是「事件时刻快照」，不参与任何槽/节流判定）。
    //   标签来源：**只有一条** —— 注册表 `labelForSid(info.id)`（经 attributionFor 复用
    //   multiSession 开关 + mode 判据）。取不到（id 非字符串/空、或该 sid 未注册）→ 两者皆空
    //   = 调用方不传前缀（保持改动前行为）。
    //   ⚠ Minor-1（复审 X5，已删）：曾经还有一段「② 兜底」——`sessions` 里按
    //     `recIsSubagent(rec) && rec.sid === info.id` 找记录、label 为空时退到 `rec.baseLabel`。
    //     该分支**当前不可达**（复审结论，我复核认可）：`sessions` 唯一写入点 `registerSession`
    //     必调 `refreshLabels()`，而它保证每条 rec 的 `label` 都非空（无 cwd/标题时回退 '会话'）；
    //     且当 ① 因**总开关/mode 判据**返回空时，② 用同一个 attributionFor 必然同因返回空 ——
    //     即 ② 无法改变任何输入的结果。此外 `rec.baseLabel` **不受子代理 12 字截断（Fix R2）**
    //     约束，若将来因改动而变得可达，会产出越界前缀。故整段删除（不是「保留但改成 label」）：
    //     保留一个恒不可达的分支只会继续误导后人。
    //   ⚠ 剩余路径对「label 为空串」的覆盖：attributionFor 仍显式判空（防御式），但**该情况在
    //     实践中同样到不了**——已注册 rec 的 label 恒非空（见上），未注册 sid 则 labelForSid 直接
    //     返回 ''（此时按「取不到」处理，与判空同一条出口）。即：判空是防御，不是可达分支。
    // ============================================================
    function subagentEndPrefix(id) {
      if (typeof id !== 'string' || id.length === 0) return { prefix: '', label: '' }
      return attributionFor(id, labelForSid(id))
    }

    // ============================================================
    // Task 4：进度记忆分层（memory.progress[sid] + narrator.json 分片摘要）
    //   口径（用户已确认）：**进度分会话 + 人格全局**——
    //     · 进度类（最近在干什么 / 用了哪些工具 / 里程碑次数 / 最近总结）按 sid 分片，落 sakiko-memory.json 的 progress 键；
    //     · narrator.json 另存一份精简分片摘要（label/milestoneCount/lastSummary/updatedAt），供叙事侧独立恢复；
    //     · memory.facts（人格/偏好）与直聊 chat 历史**保持全局**，本任务不动；
    //     · memory.history 的归属用**结构化字段** {sid,label} 承载（cn 文本一律不带「〔label〕」，Task 2 口径）。
    //   写入时机：回合收尾（DONE/goal）与里程碑触发；读取：LLM 总结输入侧可引用、narratorStatus 摘要暴露。
    // Fix R4（缺陷类同 R3，本轮收口到**自由文本**字段）：本段所有**内容文本**字段（cwd / lastUserText /
    //   lastSummary / 工具名 / narrator.lastSummary / prompt 片段）的截断一律走 truncCps（按码点），
    //   不再用 String.prototype.slice（按 UTF-16 码元，会把 emoji 代理对切成孤立代理项 → 落盘坏字符）。
    //   预算数值（40/120/200/400/500）与既有语义（keep = 保留的可见字符数）完全不变；ASCII/CJK 逐字不变。
    //   注意：**对象键**（progress/narrator 的 sid 键，slice(0,80)）与 sid 短码（slice(0,4)/slice(0,8)）
    //   是结构性 ASCII 标识符，不是自由文本，**不在本轮范围内**（理由见 task-5-fix4-report.md）。
    // ============================================================
    const NARR_PROGRESS_MAX = 64   // 分片条目上限（与注册表同量级；超出淘汰 updatedAt 最老者）
    function sanitizeProgressEntry(v) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null
      const out = {}
      if (typeof v.label === 'string') out.label = truncCps(v.label, 40)
      if (typeof v.cwd === 'string') out.cwd = truncCps(v.cwd, 400)
      if (typeof v.lastUserText === 'string') out.lastUserText = truncCps(v.lastUserText, 200)
      if (v.tools && typeof v.tools === 'object' && !Array.isArray(v.tools)) {
        const t = {}
        const ks = Object.keys(v.tools).slice(0, 40)
        for (let i = 0; i < ks.length; i++) {
          const n = v.tools[ks[i]]
          if (typeof n === 'number' && isFinite(n)) t[truncCps(ks[i], 120)] = Math.max(0, Math.floor(n))
        }
        out.tools = t
      }
      out.milestoneCount = (typeof v.milestoneCount === 'number' && isFinite(v.milestoneCount)) ? Math.max(0, Math.floor(v.milestoneCount)) : 0
      if (typeof v.lastSummary === 'string' && v.lastSummary.length > 0) out.lastSummary = truncCps(v.lastSummary, 200)
      if (typeof v.updatedAt === 'number' && isFinite(v.updatedAt)) out.updatedAt = v.updatedAt
      // Minor-3（独立复审）：I-3 起 recordProgress 会把 LLM 总结的节流时刻写进**会话分片**，
      // 而这里原先没有白名单 ⇒ 字段进了 sakiko-memory.json 却在 loadMemory 时被丢掉，
      // 重启后 gateAt=0、该会话的第一句总结必然绕过 8s 门（实测：落盘 JSON 有值、读档后消失）。
      // narrator.json 侧的孪生副本（narrGlobal.sessions[key].lastLLMAt）虽被 sanitizeNarratorSessions
      // 保留，但节流门读的是 memory.progress[sid] —— 不修这里，那份副本是死数据。
      if (typeof v.lastLLMAt === 'number' && isFinite(v.lastLLMAt)) out.lastLLMAt = v.lastLLMAt
      return out
    }
    function sanitizeProgressMap(m) {
      const out = {}
      if (!m || typeof m !== 'object' || Array.isArray(m)) return out
      const keys = Object.keys(m).slice(0, 200)
      for (let i = 0; i < keys.length; i++) {
        const e = sanitizeProgressEntry(m[keys[i]])
        if (e !== null) out[String(keys[i]).slice(0, 80)] = e
      }
      return out
    }
    function sanitizeNarratorSessions(m) {
      const out = {}
      if (!m || typeof m !== 'object' || Array.isArray(m)) return out
      const keys = Object.keys(m).slice(0, 200)
      for (let i = 0; i < keys.length; i++) {
        const v = m[keys[i]]
        if (!v || typeof v !== 'object' || Array.isArray(v)) continue
        out[String(keys[i]).slice(0, 80)] = {
          label: typeof v.label === 'string' ? truncCps(v.label, 40) : '',
          milestoneCount: (typeof v.milestoneCount === 'number' && isFinite(v.milestoneCount)) ? Math.max(0, Math.floor(v.milestoneCount)) : 0,
          lastSummary: typeof v.lastSummary === 'string' ? truncCps(v.lastSummary, 200) : '',
          lastLLMAt: (typeof v.lastLLMAt === 'number' && isFinite(v.lastLLMAt)) ? v.lastLLMAt : 0,
          updatedAt: (typeof v.updatedAt === 'number' && isFinite(v.updatedAt)) ? v.updatedAt : 0,
        }
      }
      return out
    }
    // 与注册表侧 `sessionBlocksEviction(rec, now)` 对称只读判据：该 sid 的分片是否受保护（会话仍在活跃推进）。
    // 两侧共用同一套「turnActive 且 lastActiveAt 新鲜（<= NARR_AUTO_IDLE_MS）」语义，避免出现
    // 「注册表认为某会话仍在跑、分片却把它当空闲淘汰」的不一致。
    function progressShardIsLive(sid, now) {
      const rec = sessions.get(sid)
      if (rec === undefined) return false
      return rec.state.turnActive === true && (now - rec.lastActiveAt) <= NARR_AUTO_IDLE_MS
    }
    // 写入/累加某会话的进度记忆；无归属（sid 为空）不计入
    function recordProgress(sid, patch) {
      const key = (typeof sid === 'string' && sid.length > 0) ? sid : ''
      if (key.length === 0) return null
      if (!memory.progress || typeof memory.progress !== 'object' || Array.isArray(memory.progress)) memory.progress = {}
      let e = memory.progress[key]
      if (!e || typeof e !== 'object') e = { milestoneCount: 0 }
      if (typeof e.milestoneCount !== 'number' || !isFinite(e.milestoneCount)) e.milestoneCount = 0
      const rec = sessions.get(key)
      if (rec !== undefined) {
        e.label = rec.label
        if (typeof rec.cwd === 'string' && rec.cwd.length > 0) e.cwd = rec.cwd
      }
      const p = patch && typeof patch === 'object' ? patch : {}
      if (typeof p.lastUserText === 'string' && p.lastUserText.length > 0) e.lastUserText = truncCps(p.lastUserText, 200)
      // Fix R1（Minor-1）：tools 只在**本轮确实用过工具**时才覆盖（与 lastUserText 的 length>0 守卫语义对称）。
      // 否则一个纯聊天回合（无 tool/call）会把上一次的工具集清成 {}，使字段语义不稳定。
      // 字段语义由此固定为：「最近一轮**有工具的**回合的工具集」。
      if (p.tools && typeof p.tools === 'object' && !Array.isArray(p.tools)) {
        if (Object.keys(p.tools).length > 0) e.tools = Object.assign({}, p.tools)
      }
      if (p.milestoneBump === true) e.milestoneCount += 1
      if (typeof p.lastSummary === 'string' && p.lastSummary.length > 0) e.lastSummary = truncCps(p.lastSummary, 200)
      // I-3（独立复审）：LLM 总结的**节流时刻**也按会话分片存。原先只有全局 narrGlobal.lastLLMAt，
      // 于是一个会话刚总结过，另一个会话 8s 内的 done/milestone 会被直接拦掉、退回模板句
      // （用户表现为"这次播报很泛"）—— 与串台同属跨会话耦合。
      if (typeof p.lastLLMAt === 'number' && isFinite(p.lastLLMAt)) e.lastLLMAt = p.lastLLMAt
      e.updatedAt = Date.now()
      memory.progress[key] = e
      // narrator.json 侧的精简分片摘要（同源数据）
      narrGlobal.sessions[key] = {
        label: typeof e.label === 'string' ? e.label : '',
        milestoneCount: e.milestoneCount,
        lastSummary: typeof e.lastSummary === 'string' ? e.lastSummary : '',
        lastLLMAt: (typeof e.lastLLMAt === 'number' && isFinite(e.lastLLMAt)) ? e.lastLLMAt : 0,
        updatedAt: e.updatedAt,
      }
      // 上限淘汰（Fix R1 / Minor-2）：与注册表侧 `sessionBlocksEviction(rec, now)` 语义**对称**——
      // 「sid 仍在注册表内且 turnActive 且新鲜」的分片受保护，先淘汰「不在注册表内**或**非活跃」的最老者；
      // 若这样腾不出名额（候选全是仍在跑的会话），再退化为按 updatedAt 全量淘汰最老者，保证硬上限不被突破。
      const keys = Object.keys(memory.progress)
      if (keys.length > NARR_PROGRESS_MAX) {
        const need = keys.length - NARR_PROGRESS_MAX
        const nowMs = Date.now()
        const byOldest = (a, b) => ((memory.progress[a] && memory.progress[a].updatedAt) || 0) - ((memory.progress[b] && memory.progress[b].updatedAt) || 0)
        const doomed = keys.filter((k) => !progressShardIsLive(k, nowMs)).sort(byOldest).slice(0, need)
        if (doomed.length < need) {
          const rest = keys.filter((k) => doomed.indexOf(k) < 0).sort(byOldest)
          for (let i = 0; i < rest.length && doomed.length < need; i++) doomed.push(rest[i])
        }
        for (let i = 0; i < doomed.length; i++) {
          delete memory.progress[doomed[i]]
          delete narrGlobal.sessions[doomed[i]]
        }
      }
      scheduleSaveMemory()
      scheduleSaveNarrator()
      return e
    }

    const poolLastUsed = new Map()      // 每池最近使用的一条（供状态查看 / LRU 沉底确认）
    const lastNarrSpeaks = []           // 最近发声留档（供验证）
    let narrSaveTimer = null

    function narrPersistSnapshot() {
      return {
        counts: narrGlobal.counts,
        lastSummary: typeof narrGlobal.lastSummary === 'string' ? truncCps(narrGlobal.lastSummary, 500) : '',
        lastLLMAt: narrGlobal.lastLLMAt || 0,
        poolCursor: narrGlobal.poolCursor || {},
        // Fix T4：per-session 分片摘要（旧档缺该键 → 视为空，正常工作）
        sessions: narrGlobal.sessions || {},
      }
    }
    async function loadNarrator() {
      try {
        const t = await fs.resolve(NARRATOR_PATH)
        const info = await fs.stat(t)
        if (info === undefined) return
        const parsed = JSON.parse(await fs.readText(t))
        if (!parsed || typeof parsed !== 'object') return
        const c = parsed.counts
        if (c && typeof c === 'object') {
          for (const k of Object.keys(narrGlobal.counts)) {
            if (typeof c[k] === 'number' && isFinite(c[k])) narrGlobal.counts[k] = Math.max(0, Math.floor(c[k]))
          }
        }
        if (typeof parsed.lastSummary === 'string') narrGlobal.lastSummary = truncCps(parsed.lastSummary, 500)
        if (typeof parsed.lastLLMAt === 'number' && isFinite(parsed.lastLLMAt)) narrGlobal.lastLLMAt = parsed.lastLLMAt
        if (parsed.poolCursor && typeof parsed.poolCursor === 'object') narrGlobal.poolCursor = parsed.poolCursor
        // Fix T4：per-session 分片摘要（旧档无此键 → 保持空对象，不报错）
        narrGlobal.sessions = sanitizeNarratorSessions(parsed.sessions)
      } catch (e) {
        console.error('[sakiko] 读取 narrator 状态失败:', e && e.message ? e.message : String(e))
      }
    }
    async function saveNarratorNow() {
      try {
        await writeTextSafe(NARRATOR_PATH, JSON.stringify(narrPersistSnapshot(), null, 2))
      } catch (e) {
        console.error('[sakiko] 保存 narrator 状态失败:', e && e.message ? e.message : String(e))
      }
    }
    function scheduleSaveNarrator() {
      if (narrSaveTimer !== null) return
      narrSaveTimer = setTimeout(() => {
        narrSaveTimer = null
        saveNarratorNow().catch(() => { /* 已记录错误 */ })
      }, 800)
    }

    // 池轮换：游标 +1（最近一条沉底，绝不立刻复读）；跨重启用落盘游标延续偏移
    // 游标全局共享：多会话下同一池的台词按全局顺序轮转（跨会话也不复读同一条）
    function pickPool(poolKey) {
      const ids = NARR_POOLS[poolKey]
      if (!Array.isArray(ids) || ids.length === 0) return null
      const cursor = narrGlobal.poolCursor || {}
      let idx = (typeof cursor[poolKey] === 'number' && cursor[poolKey] >= 0) ? cursor[poolKey] : -1
      idx = (idx + 1) % ids.length
      narrGlobal.poolCursor[poolKey] = idx
      poolLastUsed.set(poolKey, { id: ids[idx], at: Date.now() })
      scheduleSaveNarrator()
      return NARR_LINES[ids[idx]]
    }

    // 回合复位（per-session）：st 由 stateFor(sid) 提供
    function resetTurn(st) {
      const now = Date.now()
      st.stepCount = 0
      st.startSpoken = false
      st.milestoneSpoken = false
      // Task 10 周期制：里程碑基准 = 本回合起点（回合刚起不算「距上次」已过），步数增量从 0 起算。
      st.lastMilestoneAt = now
      st.lastMilestoneStep = 0
      st.turnGoalDone = false
      st.turnActive = true
      st.turnStartAt = now
      st.toolNames = {}
      st.turnEndedAt = 0   // 新回合开始 → 不再算「刚收尾」（Fix R1）
      // A：新回合开始 → 助手文本必须清空。否则上一回合的收尾文本会被本回合的 DONE 总结
      //    当成「本回合的结尾输出」喂给 LLM（跨回合串台 = 另一种「说成已发生」的失真来源）。
      //    注：lastUserText 不在此清（user/message 分支先写入再 resetTurn，清了会丢本轮输入）。
      st.lastAssistantText = ''
    }

    function userMessageText(d) {
      const c = d && typeof d === 'object' ? d.content : undefined
      if (typeof c === 'string') return c
      if (Array.isArray(c)) {
        const parts = []
        for (const b of c) {
          if (b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
        }
        return parts.join('\n')
      }
      return ''
    }

    // A：助手消息文本提取——与 userMessageText 同构（同一份 Message.content: ContentBlock[] 形状）。
    //   真实形状（据 dsh-session/dsh-llm 类型定义核对，非推测）：
    //     assistant/message 事件 data = { turn, step, message: AssistantMessage, usage?, interrupted? }；
    //     AssistantMessage.content = ContentBlock[]，文本块 = { type:'text', text:string }。
    //   只取 type==='text'（reasoning 思考块不算用户可见输出）；多块按 '\n' 连接（与 userMessageText 同规则）。
    //   注意：仅承载 usage 的**空 content** 助手消息真实存在（dsh-session surface：empty-content assistant/message），
    //   此时返回 ''，由调用方「非空才覆盖」的守卫兜住，不会清掉本回合已有的助手文本。
    function assistantMessageText(msg) {
      return userMessageText(msg)
    }

    // 泛化工具调用扫描（旧 isTaskCompleteMessage 思路）：assistant message 是否含指定名称的工具调用
    function msgHasToolCall(msg, names) {
      if (!msg || !Array.isArray(msg.content)) return false
      for (let i = 0; i < msg.content.length; i++) {
        const b = msg.content[i]
        if (b === null || typeof b !== 'object' || b.type !== 'tool-call') continue
        const name = String(b.name || '')
        if (names.indexOf(name) >= 0) return true
      }
      return false
    }

    // goal 完成类工具调用：update_goal action complete/blocked、goal.complete、*goal*complete*。
    // 注：exit_plan_mode 已从「完成」语义拆出，改走 BLOCK B3（计划审批）。
    function msgHasGoalDoneCall(msg) {
      if (!msg || !Array.isArray(msg.content)) return false
      for (let i = 0; i < msg.content.length; i++) {
        const b = msg.content[i]
        if (b === null || typeof b !== 'object' || b.type !== 'tool-call') continue
        const name = String(b.name || '')
        if (name === 'goal.complete' || /goal.*complete/i.test(name)) return true
        if (name === 'update_goal') {
          try {
            const a = JSON.parse(String(b.arguments || '{}'))
            if (Object.prototype.hasOwnProperty.call(a, 'action')) {
              if (a.action === 'complete' || a.action === 'blocked') return true
            } else {
              return true
            }
          } catch (e) { /* 解析失败按完成处理 */ return true }
        }
      }
      return false
    }

    // LLM 进度总结（spec §5）：白祥语域、只述事实 + 下一步 / 等待请求；失败/超时/格式异常 → null（调用方走模板）
    const NARR_LLM_SYSTEM =
      'あなたは豊川祥子——CRYCHIC時代の「白祥」本人。ユーザーの作業セッションを見守り、進捗の節目に一言かけるナレーターです。\n' +
      '口調の約束：語尾は「ですわ」系（ですわ／ですの／〜ますの）、自称は「私」、相手は「あなた」。' +
      '明るく温かく、感情を込めて。「〜てちょうだい」や責める・冷たい・見下す言い回し、黒祥時代の台詞、自己否定は一切使わない。\n' +
      '内容の約束：実際に起こった作業の事実と「次の一手」だけを述べる。起きていない手順や結果をでっち上げない。' +
      'ユーザーが確認・返答待ちの場合は「あなたの判断をお待ちしています」の意を添える。\n' +
      '表記の約束：JPの行（2行目）の本文には英字・数字を生のまま書かない（行頭の「JP: 」は今までどおりそのまま書く）。' +
      '英字は読みをカタカナで（例：pass→パス、blend→ブレンド、' +
      'G-Buffer→ジーバッファー、EID→イーアイディー）、数字は漢数字で（例：12858→一万二千八百五十八）書く。' +
      '読み上げの乱れを避けるため。CNの行（3行目）はこの約束の対象外で、中国語として英字・数字をそのまま書いてよい。\n' +
      'フォーマット（必ず厳守）：\n' +
      '1行目：【happy】【soft】【neutral】【question】【excited】のいずれか1つの感情タグ。\n' +
      '2行目：「JP: 」で始まる日本語（60字以内・1〜2文）。\n' +
      '3行目：「CN: 」で始まる中国語（JPと同じ意味・80字以内）。\n' +
      'それ以外は何も出力しない。'

    // Task 2：工作区标签注入（仅在能解析出归属标签时追加到 system 末尾）。
    // 目的：让 LLM 总结自然区分「哪个工作区/项目那边」；同时明确禁止编造未提供的作业场所/事件，
    // 并重申白祥语域红线不因加了工作区名而改变（与 NARR_LLM_SYSTEM 的既有约束一致，不放松）。
    const NARR_LLM_WS_RULE =
      'ワークスペースについての追加の約束：下の「作業中のワークスペース」は、いま見ている作業場所の名前です。' +
      'ユーザーは複数の作業場所を同時に進めていることがあるので、「〜のほうでは」「例のプロジェクトでは」のように、' +
      'どの作業場所の話かを一言添えてよい。' +
      'ただし与えられた名前以外の作業場所・作業内容・結果を想像で足してはならない（事実だけを述べる）。' +
      '名前を毎回必ず唱える必要はなく、口調の約束（ですわ系・白祥）はそのまま守ること。'

    async function narrateSummary(kind, opts) {
      if (config.narratorLLMSummary !== true) return null
      const o = opts && typeof opts === 'object' ? opts : {}
      const now = Date.now()
      // I-3（独立复审）：8s 节流从**全局**下沉到**会话分片**。
      //   原来是 `now - narrGlobal.lastLLMAt < NARR_LLM_GAP_MS` ⇒ 会话 A 刚总结过，会话 B 在 8s 内的
      //   done/milestone 会被直接拦掉、退回模板句（用户表现为"这次播报很泛"）。与串台同属跨会话耦合。
      //   无归属（无 sid）时仍读全局值，与旧行为一致；分片里没有该字段（老档）也按 0 处理 ⇒ 立刻可总结。
      const gateSid = (typeof o.sid === 'string' && o.sid.length > 0) ? o.sid : ''
      const gateRec = (gateSid.length > 0 && memory.progress && typeof memory.progress === 'object') ? memory.progress[gateSid] : undefined
      const gateAt = (gateSid.length > 0)
        ? ((gateRec && typeof gateRec.lastLLMAt === 'number' && isFinite(gateRec.lastLLMAt)) ? gateRec.lastLLMAt : 0)
        : (narrGlobal.lastLLMAt || 0)
      if (now - gateAt < NARR_LLM_GAP_MS) return null
      // 进入即登记（先于本函数首个 await）：以“启动时刻”卡 8s 门，
      // 两个并发 LLM 总结的第二个必在门处被拦；失败返回 null 不回滚已登记时间（宁可少跑 LLM 不多烧 token）。
      // 有归属时登记到**本会话分片**（同时保留全局值，供无归属路径与兼容读使用）。
      // ⚠️ 全局 `lastSummary` **不可**当作某个会话的"上一句总结"用 —— 它是"最后说话的那个会话"的
      //    总结，多会话下会张冠李戴（见下方 prevSummary 处的实测记录）；它现在只用于单会话兜底与兼容读。
      narrGlobal.lastLLMAt = now
      if (gateSid.length > 0) recordProgress(gateSid, { lastLLMAt: now })
      scheduleSaveNarrator()
      // 会话态兜底：调用方未显式传 userMsg/tools/blocking 时，取该 sid 的回合态
      const st = stateFor(o.sid)
      const userMsg = truncCps(o.userMsg || st.lastUserText || '', 200)
      // A：本轮**结尾最核心的输出**（助手最后一条非空文本，回合内累积，见 assistant/message 分支）。
      //   取值方式与 userMsg 对称：显式 opts 优先，其次回合态。
      //   动机（故障取证）：此前 prompt 只有「用户说的话 + 工具调用计数」，LLM 无从知道本轮**实际产出/结论**，
      //   而用户指令（如「你跑到20再停下」）恰好落在 最近のユーザー発言 里 → 模型只能把**要求**当成**已发生的结果**。
      //   A2（预算可配 + 首+尾）：预算 = config.narratorAssistantChars（默认 400，范围 0–2000，0 = 不注入该行）。
      //   ≤ 预算 → 原样全给；> 预算 → 首 60% + …（中略）… + 尾 40%（见 headTailCps，按码点切）。
      //   注：存储侧（st.lastAssistantText）保留上限为 NARR_ASSIST_MAX_CPS（2000 = 预算可配的最大值），
      //   故本函数的预算是**唯一**生效的切分点（预算调到 800 时 800 以内的文本原样全给）。
      const assistantBudget = (typeof config.narratorAssistantChars === 'number') ? config.narratorAssistantChars : 400
      const assistantRaw = o.assistantText || st.lastAssistantText || ''
      const assistantText = assistantBudget > 0 ? headTailCps(assistantRaw, assistantBudget) : ''
      const tools = (o.tools && typeof o.tools === 'object') ? o.tools : (st.toolNames || {})
      const toolNames = Object.keys(tools)
      const toolLine = toolNames.length > 0
        ? truncCps(toolNames.slice(0, 12).map((n) => String(n) + '×' + (tools[n] || 1)).join('、'), 300)
        : '（ツール呼び出しなし）'
      const isBlocked = (o.blocking !== undefined) ? !!o.blocking : !!st.blocking
      const blockingLine = isBlocked ? '（ユーザーの確認・返答を待っています）' : ''
      // Task 2：工作区名注入（label 来自注册表；cwd basename 在可用且与 label 不同时附注）。
      // 无归属（无 sid / 标签不可得）或 multiSession:false（总开关关闭=完全退回现状）→ 不注入，
      // system/prompt 与改前逐字相同（零回归 + 一键回退语义）。
      const wsSid = (typeof o.sid === 'string' && o.sid.length > 0) ? o.sid : ''
      const wsLabel = labelForSid(wsSid)
      const wsRec = wsSid.length > 0 ? sessions.get(wsSid) : undefined
      const wsBase = (wsRec !== undefined) ? basenameOf(wsRec.cwd) : ''
      const wsName = config.multiSession === false ? '' : (wsLabel.length > 0 ? wsLabel : wsBase)
      const wsLine = wsName.length > 0
        ? '作業中のワークスペース：' + wsName + (wsBase.length > 0 && wsBase !== wsName ? '（フォルダ名：' + wsBase + '）' : '')
        : ''
      // Fix R1（Minor-4）：上一句总结优先取**本会话**的分片（更贴题：说的是这个工作区自己的进展）。
      //
      // 2026-09-15 修「多会话串台」（用户实测）：
      //   原先分片为空时**回落全局** `narrGlobal.lastSummary`，而全局是"最后说话的那个会话"的总结
      //   （narrateSummary 末尾无条件覆盖它）⇒ 本会话还没写过摘要时，prompt 会把**别的会话**的进展
      //   当成「前回の進捗サマリ」喂给 LLM，生成张冠李戴的播报。
      //   实测现场：A 会话（Max减面合图后缀错误，首次 milestone）播出了「QnMobile_Artistの最終確認…」，
      //   而那其实是 B 会话（特效自动化LOD工具）上一轮的总结「审校…修完14条。QnMobile_Artist只剩最终确认」
      //   的改写 —— 两个会话的 shard 与全局 lastSummary 里都能看到这条污染链。
      //   ⇒ 多会话模式下**不再回落**：没有本会话分片就写「（なし）」。宁可少一层上下文，
      //     也不能拿别的会话的进展当自己的；无 sid（无归属播报）时同样不回落，因为它不属于任何一个会话。
      //   ⚠️ 单会话（multiSession === false）下"全局就是这个会话自己"这个论断，只在**实际只有一个会话**时
      //     成立 —— recordProgress 在 multiSession:false 下仍按 sid 写分片，所以"关掉多会话开关但真的开着
      //     两个会话"时串台仍可能复现（独立复审 Minor-4 指出）。这是"一键回退到基线"的既定语义，予以保留；
      //     要彻底消除该可能，得把全局兜底整个删掉（它只对升级前的老档有意义）。
      const shardProgress = (wsSid.length > 0 && memory.progress && typeof memory.progress === 'object') ? memory.progress[wsSid] : undefined
      const shardSummary = (shardProgress && typeof shardProgress.lastSummary === 'string' && shardProgress.lastSummary.length > 0) ? shardProgress.lastSummary : ''
      const globalSummary = (typeof narrGlobal.lastSummary === 'string' && narrGlobal.lastSummary.length > 0) ? narrGlobal.lastSummary : ''
      const allowGlobalFallback = config.multiSession === false && wsSid.length > 0
      const prevSummary = truncCps(shardSummary || (allowGlobalFallback ? globalSummary : ''), 200)
      // C：kind 文案——旧 done 句「進んだこと＋次の一手を伝える」在**本回合没有进展**时（只是启动了长任务、
      //   或正在等待）会诱导模型「报成绩」，把**计划**包装成**已完成的成果**（用户实测故障的另一半根因）。
      //   改为先判断此刻状态（进行中／完了／待ち）再说下一步；milestone 句同步去掉「順調であること」这一
      //   **无据的状态断言**（里程碑只证明「还在跑」，不证明「顺利」），保留「长任务 + 継続」原意。
      const kindLine = kind === 'milestone'
        ? '作業が長引いているので、いまも続いていることをふまえて、継続を伝える一言を。'
        : 'このターンの節目なので、いま何が起きているか（進行中／完了／待ち）をふまえて、次の一手を伝える一言を。'
      // Fix R2（Minor-B）：prompt 构造也放进 try —— 本区（含 wsLine/shardSummary/prevSummary 等）
      // 一旦抛异常，必须走 catch 回退模板，绝不能把异常抛给调用方而丢掉整条播报。
      // 不变量：**LLM 路径的任何异常都要能回退模板/放弃 LLM 句，绝不吞掉播报**。
      try {
        const prompt =
          '【セッション情報】\n' +
          (wsLine ? wsLine + '\n' : '') +
          '最近のユーザー発言：' + (userMsg || '（なし）') + '\n' +
          // 预算 0 = **整行不出现**（prompt 与「加该功能前」逐字一致）；预算 >0 时与改前同构（无文本仍写「（なし）」）
          (assistantBudget > 0 ? 'アシスタントの最後の応答：' + (assistantText || '（なし）') + '\n' : '') +
          'このターンのツール使用：' + toolLine + '\n' +
          '前回の進捗サマリ：' + (prevSummary || '（なし）') + '\n' +
          (blockingLine ? blockingLine + '\n' : '') +
          kindLine
        const raw = await Promise.race([
          aiComplete(wsLine ? (NARR_LLM_SYSTEM + '\n' + NARR_LLM_WS_RULE) : NARR_LLM_SYSTEM, [{ role: 'user', content: prompt }], 160),
          ctx.timeout(30000).then(() => { throw new Error('narrate llm timeout') }),
        ])
        const parsed = parseStructured(raw)
        if (typeof parsed.jp !== 'string' || parsed.jp.trim().length === 0) return null
        if (NARR_LLM_EMOTIONS.indexOf(parsed.emotion) < 0) return null
        if (typeof parsed.cn === 'string' && parsed.cn.length > 0) narrGlobal.lastSummary = truncCps(parsed.cn, 120)
        // Fix T4：把该次总结同时写入**本会话**的进度分片（全局 lastSummary 语义不变，供兼容与 LLM 上下文）
        recordProgress(o.sid, { lastSummary: typeof parsed.cn === 'string' ? parsed.cn : '' })
        scheduleSaveNarrator()
        return { jp: parsed.jp, cn: parsed.cn || parsed.jp, emotion: parsed.emotion }
      } catch (e) {
        console.warn('[sakiko] 进度总结 LLM 失败，走模板:', e && e.message ? e.message : String(e))
        return null
      }
    }

    // 台词选择：goal/special/block 固定句；start/done/milestone/fail 走池轮换（LLM 句不入池）
    function pickNarrLine(intent, opts) {
      if (intent === 'goal') return Object.assign({}, NARR_A3)
      if (intent === 'special') {
        const line = NARR_A4[opts.variant]
        return line ? Object.assign({}, line) : null
      }
      if (intent === 'block') {
        const id = NARR_BLOCK_IDS[opts.variant] || 'b4'
        return Object.assign({}, NARR_LINES[id])
      }
      return pickPool(intent) // start / done / milestone / fail
    }

    // ---------------- 意图路由与发声 ----------------
    const NARR_INTENTS = ['start', 'done', 'milestone', 'block', 'fail', 'special', 'goal']
    const narrPendingBatch = []
    let narrBatchScheduled = false
    // Fix T3（简报需求 4）：每 tick 交付上限行为 = 「**全量交付 + 超阈值告警**」，绝不静默丢弃。
    //   · 天然上限：本批不同 sid 数（每组最多交付 1 条——组内取最高优先级），无 sid 的整批算作 '' 一组；
    //   · 超过阈值（8）时 console.warn 记录 sid 数与意图分布，但所有组仍逐条交付（全局 speakSynced 队列串行播放）；
    //   · 理由：静默丢弃会违反 spec §5.1「不吞句：A 与 B 的 DONE 都能听到」，故只做可观测的告警。
    const NARR_TICK_DELIVER_WARN = 8

    // narrate(intent, opts)：
    //   同意图 8s 合并（按 opts.sid 所属会话计入其 lastSpokeByIntent）；同一时刻多事件由微任务批收集后取最高优先级一条；
    //   done 受 narratorDone 开关；force=true（testNarrator）绕过节流/回合内一次性标记。
    //   注：C-3 之后 voiceOn 的判定统一收在 speakSynced —— 语音关时**仍推中文气泡**（走 pushCn，
    //   面板只 revealHistory）、只是不合成不出声，所以 narrate 路径本身不再判 voiceOn。
    //   opts.sid 缺省（子代理/工作流/后台任务/testNarrator）→ 落默认槽：与任何会话的节流互不干扰。
    //   气泡前缀在**本入口（事件处理同步段内）**算好并写入 opts（Fix R1 / Important-1）——
    //   交付发生在微任务之后，届时 turnActive 可能已被 handleTurnEnd 清掉；事件时刻快照才能反映
    //   「此刻有几个工作区在跑」的真实时序（并发收尾的最后一位也能带前缀）。
    function narrate(intent, opts) {
      const o = opts && typeof opts === 'object' ? opts : {}
      const now = Date.now()
      if (NARR_INTENTS.indexOf(intent) < 0) return { ok: false, reason: 'bad-intent' }
      if (config.narratorOn !== true) return { ok: false, reason: 'narrator-off' }
      if (intent === 'done' && config.narratorDone !== true && o.force !== true) return { ok: false, reason: 'done-off' }
      if (o.force !== true) {
        const st = stateFor(o.sid)
        const last = st.lastSpokeByIntent.get(intent)
        if (typeof last === 'number' && now - last < NARR_INTENT_GAP_MS) return { ok: false, reason: 'merged-same-intent' }
      }
      if (typeof o.bubblePrefix !== 'string') o.bubblePrefix = bubblePrefixFor(o.sid)
      narrPendingBatch.push({ intent, opts: o, at: now })
      if (!narrBatchScheduled) {
        narrBatchScheduled = true
        const flush = () => { narrBatchScheduled = false; flushNarrBatch() }
        if (typeof queueMicrotask === 'function') queueMicrotask(flush)
        else Promise.resolve().then(flush)
      }
      return { ok: true, queued: true }
    }

    function flushNarrBatch() {
      const batch = narrPendingBatch.splice(0, narrPendingBatch.length)
      if (batch.length === 0) return
      // 同一时刻多事件：**按 sid 分组**，每组只取最高优先级一条
      // （BLOCK40 > FAIL30 > DONE/GOAL20 > SPECIAL15 > MILESTONE10 > START5）。
      // 多工作区（Fix R1 / spec §4「同刻批内取最高 → per-session」）：分组键 = opts.sid（无归属事件归 '' 默认槽）——
      //   A、B 在同一同步 tick 内各自的 START/DONE 都会各播一条（全局队列串行播放，不吞句）；
      //   单会话（或整批都无 sid）时只有一组，取最高优先级的语义与现状逐字相同（零回归）；
      //   组内比较用严格大于 → 同优先级先入者胜（与现状口径一致）；组间按首次出现顺序依次交付，顺序确定。
      const groups = new Map()
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i]
        const key = (item.opts && typeof item.opts.sid === 'string' && item.opts.sid.length > 0) ? item.opts.sid : ''
        const list = groups.get(key)
        if (list === undefined) groups.set(key, [item])
        else list.push(item)
      }
      // 组内取最高优先级一条（严格大于 → 同优先级先入者胜，与现状口径一致）
      const winners = []
      for (const list of groups.values()) {
        let best = list[0]
        for (let i = 1; i < list.length; i++) {
          const c = list[i]
          if ((NARR_PRIORITY[c.intent] || 0) > (NARR_PRIORITY[best.intent] || 0)) best = c
        }
        winners.push(best)
      }
      // Fix T3（需求 4）：超阈值只告警不改行为（绝不静默丢弃；winners 全量交付）
      if (winners.length > NARR_TICK_DELIVER_WARN) {
        const dist = {}
        for (let i = 0; i < winners.length; i++) {
          const it = winners[i].intent
          dist[it] = (dist[it] || 0) + 1
        }
        console.warn('[sakiko] 同刻播报批次的 sid 数 ' + winners.length + ' 超过阈值 ' + NARR_TICK_DELIVER_WARN +
          '：仍全量交付（不丢弃），由全局队列串行播放；意图分布=' + JSON.stringify(dist))
      }
      // 逐组 fire-and-forget：各组交付入口同步完成门检查与占位登记（Fix R1 的并发不变量不变）
      for (let i = 0; i < winners.length; i++) {
        const w = winners[i]
        deliverNarration(w.intent, w.opts).catch((e) => {
          console.error('[sakiko] 进度播报失败:', e && e.message ? e.message : String(e))
        })
      }
    }

    // 决定台词 → 留痕 → 出声（speakSynced 队列串行，不叠播）
    // Fix R1：门检查与占位登记全部同步完成于本函数首个 await 之前——
    // flushNarrBatch 对 deliverNarration 是 fire-and-forget，两个 deliver 可真实并发；
    // JS 单线程下，只要 lastSpokeByIntent/lastDoneFamilyAt 的登记先于任一 await，
    // 并发第二个必在门处被拦（lastLLMAt 的登记在 narrateSummary 入口，同样先于其 await）。
    // 多工作区（Task 1）：门与占位全部落在 opts.sid 所属会话的 state 上（跨会话互不抑制）。
    async function deliverNarration(intent, opts) {
      const now = Date.now()
      const force = opts.force === true
      const st = stateFor(opts.sid)
      let mySameAt = 0
      let myFamilyAt = 0
      // 同步门 + 同步占位登记（模板路径与 LLM 路径共用同一占位语义）
      if (!force) {
        if (intent === 'done' || intent === 'goal') {
          // done/goal 完成语义 8s 互斥（先到先得近似旧 announce 8s 窗；更高语义由同批优先级保证）
          if (now - st.lastDoneFamilyAt < NARR_INTENT_GAP_MS) return
          st.lastDoneFamilyAt = now
          myFamilyAt = now
        }
        // 同意图 8s 合并：受理即占位（8s 从“受理”起算，而非发声后）
        const last = st.lastSpokeByIntent.get(intent)
        if (typeof last === 'number' && now - last < NARR_INTENT_GAP_MS) return
        st.lastSpokeByIntent.set(intent, now)
        mySameAt = now
      }
      let line = null
      let source = 'template'
      const llmEligible = (intent === 'done' || intent === 'milestone') && opts.noLLM !== true
      // llmAttempted = 本交付经过了 await（可能 LLM 真实在飞，也可能 LLM 门关闭快速回退模板），
      // 因此期间存在被其它并发交付取代的可能 → 需要返回后重核。
      const llmAttempted = llmEligible
      if (llmEligible) {
        // Fix R2（Minor-B）：调用侧兜底 —— narrateSummary 内部虽已自兜底（含 prompt 构造的 try），
        // 但这里再包一层：**LLM 路径的任何异常都只降级为「放弃 LLM 句、走模板」，绝不冒泡到
        // deliverNarration 之外**（否则整条播报会被丢掉，只留一行 console.error）。
        let llm = null
        try {
          llm = await narrateSummary(intent, opts) // lastLLMAt 于 narrateSummary 入口登记（先于其 await）
        } catch (e) {
          console.warn('[sakiko] 进度总结异常，回退模板:', e && e.message ? e.message : String(e))
          llm = null
        }
        if (llm !== null) { line = llm; source = 'llm' }
      }
      if (line === null) {
        line = pickNarrLine(intent, opts)
        if (line === null) return
      }
      // LLM 返回后重核：8s 合并窗只用于“去重”，不用于“时效丢弃”——慢 LLM 晚到必达。
      // 仅当本次占位已被更新的发声取代才放弃（模板兜底同样放弃，避免与接管者重复）：
      //   sameReplaced   = 同意图槽被更新的发声占用（force/testNarrator 或过期后新事件）；
      //   familyReplaced = done/goal 族被更新的完成语义占用；
      //   doneTookOver   = milestone 在飞期间 done/goal 登记了族窗（turn/end 已接管“回合结束”语义，
      //                    优先级 DONE20 > MILESTONE10，避免“还在进行中”落在“完成”之后）。
      if (llmAttempted && !force) {
        const sameReplaced = st.lastSpokeByIntent.get(intent) !== mySameAt
        const familyReplaced = myFamilyAt !== 0 && st.lastDoneFamilyAt !== myFamilyAt
        const doneTookOver = (intent !== 'done' && intent !== 'goal') && myFamilyAt === 0 &&
          st.lastDoneFamilyAt !== 0 && st.lastDoneFamilyAt >= mySameAt
        if (sameReplaced || familyReplaced || doneTookOver) return
      }
      // 留痕对话历史（沿用 announce 语义：无论语音开关都记录）
      const cnText = (typeof line.cn === 'string' && line.cn.length > 0) ? line.cn : line.jp
      // Task 2：播报归属与气泡前缀。sid/label 随队列条目与时间线日志下发；
      // 气泡 CN = 「〔label〕」+ 原 cn（前缀策略见 bubblePrefixFor）；line.jp 原样送给 TTS（语音不念工作区名）。
      // memory.history 仍存不带前缀的原文（避免污染聊天上下文；{sid,label} 字段留 Task 4 记忆分层）。
      const sidKey = (typeof opts.sid === 'string' && opts.sid.length > 0) ? opts.sid : ''
      // Minor-2（复审 X5）：与 `bubblePrefix` 同一套口径——优先用 narrate() 入口写下的**事件时刻
      // 归属标签快照**（`subagent/end` 这类无 sid 事件靠它拿到注册表标签），否则回落到按 sid 现查。
      const narrLabel = (typeof opts.label === 'string') ? opts.label : labelForSid(sidKey)
      // Fix R1（Important-1）：优先用 narrate() 入口写下的**事件时刻快照**；仅当调用方没走 narrate
      // （或快照缺失）时回落到此刻现算。这样「最后一个收尾者」也不会因为 turnActive 已被清掉而掉前缀。
      const prefix = (typeof opts.bubblePrefix === 'string') ? opts.bubblePrefix : bubblePrefixFor(sidKey)
      const bubbleCn = prefix.length > 0 ? prefix + cnText : cnText
      // Fix T4：history 条目的归属用**结构化字段**承载（cn 保持原文，不加「〔label〕」前缀）
      const histEntry = { role: 'assistant', jp: line.jp, cn: cnText, emotion: line.emotion || 'neutral', announce: true, narrate: intent, t: Date.now() }
      if (sidKey.length > 0) {
        histEntry.sid = sidKey
        histEntry.label = narrLabel
      }
      memory.history.push(histEntry)
      if (memory.history.length > 60) maybeCompactHistory()
      narrGlobal.counts[intent] = (narrGlobal.counts[intent] || 0) + 1   // counts 全局聚合（跨会话累加）
      lastNarrSpeaks.push({ at: Date.now(), intent, source, jp: line.jp, cn: cnText, bubble: bubbleCn, sid: sidKey, label: narrLabel, emotion: line.emotion || 'neutral' })
      if (lastNarrSpeaks.length > 8) lastNarrSpeaks.shift()
      scheduleSaveNarrator()
      // voiceOn=false 时**不在这里 return** —— 与 announce 保持一致：上面 history / 计数 / lastNarrSpeaks
      // 都已经写了，若在此提前返回就只剩留痕、气泡没了（独立复审 C-3 指出的是同一类问题）。
      // 真正的"不出声"由 speakSynced 统一处理（它会跳过合成、照常推气泡）。
      // 对照：checkCalls / checkIdle / checkHum 里的同类 return 是**另一回事** —— 那三处是
      // "语音关就别做这件事"（来电/闲聊/哼歌的目的本来就是发声），语义正确，保持不动。
      // tags 里的 sid/label 会被 pushUtterances 拷进队列条目（面板端不消费，供日志/调试/后续 Task 使用）
      await speakSynced(line.jp, bubbleCn, line.emotion || 'neutral', 'force', { announce: true, narrate: intent, sid: sidKey, label: narrLabel })
    }

    // ---------------- 里程碑巡检（per-session 周期制：时间/步数各自到点即再播一条） ----------------
    // st = stateFor(sid)：时间阈值按该会话自己的 lastMilestoneAt（基准 = 回合起点）计，步数按
    // lastMilestoneStep 起的**增量**计；空闲会话（turnActive !== true）直接跳过——别的会话在忙不推迟
    // 本会话，本会话阻塞不抑制别的会话。
    // Task 10（用户明确选择的行为）：narratorMilestoneMs / narratorMilestoneSteps 是**周期**，不是
    // 「本回合一次性」阈值 —— 长回合里每满 ms 毫秒（或每满 steps 步）再播一条，直到回合结束。
    // 现场证据：一个 turnActive 的会话 stepCount=90 只播过 1 条里程碑，此后 16+ 分钟没有再播，
    // 而 narratorMilestoneMs=120000 ⇒ 旧实现的闸门 st.milestoneSpoken 只在回合起止复位，
    // 一个回合最多播一条（时间型「间隔」实际上从头到尾只生效过一次）。
    function maybeMilestone(st) {
      if (config.narratorOn !== true) return
      if (st === null || st === undefined) return
      if (st.turnActive !== true) return
      if (st.blocking) return
      if (st.stepCount < 1) return
      const ms = typeof config.narratorMilestoneMs === 'number' ? config.narratorMilestoneMs : 240000
      const steps = typeof config.narratorMilestoneSteps === 'number' ? config.narratorMilestoneSteps : 50
      const now = Date.now()
      // 基准 = 上次里程碑的时刻/步数；缺字段时按回合起点/0 兜底（与 resetTurn 写入的语义一致）
      const prevAt = (typeof st.lastMilestoneAt === 'number' && st.lastMilestoneAt > 0) ? st.lastMilestoneAt : st.turnStartAt
      const prevStep = (typeof st.lastMilestoneStep === 'number' && st.lastMilestoneStep > 0) ? st.lastMilestoneStep : 0
      const overTime = now - prevAt >= ms
      const overSteps = st.stepCount - prevStep >= steps
      if (!overTime && !overSteps) return
      // 先推进基准（占位）：同一 tick 内再进来不会二次触发（时间差 0、步数增量 0）
      st.lastMilestoneAt = now
      st.lastMilestoneStep = st.stepCount
      st.milestoneSpoken = true
      // Fix T4：里程碑触发 → 该会话的里程碑计数 +1（进度记忆分片）
      recordProgress(st.sid, { milestoneBump: true })
      // Task 10：交付确认。narrate() 只是把条目放进 narrPendingBatch 并排一个 flushNarrBatch 微任务；
      // 同 tick 里该 sid 若有更高优先级事件（BLOCK40 > FAIL30 > DONE/GOAL20 > SPECIAL15 > MILESTONE10），
      // flushNarrBatch 按 sid **只取最高优先级一条** ⇒ 这次里程碑根本走不到 deliverNarration；
      // 被 deliverNarration 的同意图 8s 门挡掉时同理。两种情况下 st.lastSpokeByIntent 的 milestone 槽都不变。
      // 观测点就是它：narrate 里那次微任务先入队、本回调后入队 ⇒ 本回调必然在 flushNarrBatch **之后**跑，
      // 届时同步门已判完（deliverNarration 首个 await 之前那段）。
      // 没被受理 ⇒ 把基准回滚到本次尝试之前，让**下一次巡检/下一个周期**重试，而不是把机会永久消耗掉。
      const beforeSameAt = st.lastSpokeByIntent.get('milestone')
      const attemptStep = st.stepCount
      narrate('milestone', { sid: st.sid })
      const confirmDelivery = () => {
        // 先核对基准还是本次推进的那个：期间若回合已结束（handleTurnEnd 清零）或已开新回合
        // （resetTurn 重设），就不能把旧基准写回去，否则「回合结束后基准清零」会出现例外。
        if (st.lastMilestoneAt !== now || st.lastMilestoneStep !== attemptStep) return
        if (st.lastSpokeByIntent.get('milestone') === beforeSameAt) {
          st.lastMilestoneAt = prevAt
          st.lastMilestoneStep = prevStep
        }
      }
      if (typeof queueMicrotask === 'function') queueMicrotask(confirmDelivery)
      else Promise.resolve().then(confirmDelivery)
    }

    // turn/end：goal 完成过 → A3（'goal'）；否则 narratorDone 时 'done'（LLM 总结/模板兜底）；随后清该会话回合状态
    function handleTurnEnd(evData, st) {
      const reason = evData && typeof evData === 'object' ? evData.reason : undefined
      const kind = reason && typeof reason === 'object' ? reason.kind : (typeof reason === 'string' ? reason : undefined)
      // 非正常完成回合不播 DONE（blocked/error 已有 BLOCK/FAIL 语义；aborted/interrupted/max-tokens 无完成可言）
      const skipKinds = ['blocked', 'error', 'aborted', 'interrupted', 'max-tokens']
      if (kind !== undefined && skipKinds.indexOf(kind) >= 0) {
        st.turnActive = false
        st.turnEndedAt = Date.now()   // Fix R1：收尾时刻（auto 活跃宽限窗依据）
        return
      }
      const goalDone = st.turnGoalDone === true
      // 先快照回合总结输入（随后清状态，LLM 异步取快照而非被清空的 live 字段）
      const doneOpts = {
        sid: st.sid,
        userMsg: st.lastUserText,
        assistantText: st.lastAssistantText,   // A：与 userMsg 一并快照（随后清态，LLM 异步只能吃快照）
        tools: Object.assign({}, st.toolNames),
        blocking: st.blocking,
      }
      st.turnActive = false
      st.turnEndedAt = Date.now()   // Fix R1：先记收尾时刻，再 narrate（快照判定时本会话即「刚收尾」）
      st.blocking = null
      st.milestoneSpoken = false
      st.lastMilestoneAt = 0
      st.lastMilestoneStep = 0
      st.startSpoken = false
      st.stepCount = 0
      st.turnGoalDone = false
      st.toolNames = {}
      // Fix T4：回合收尾（DONE/goal）→ 写入该会话的进度记忆（用清态前已快照的 userMsg/tools）
      recordProgress(st.sid, { lastUserText: doneOpts.userMsg, tools: doneOpts.tools })
      if (goalDone) {
        narrate('goal', { sid: st.sid })
      } else if (config.narratorDone === true) {
        narrate('done', doneOpts)
      }
    }

    // ---------------- AI 调用（独立 key 优先，llm 服务兜底） ----------------
    async function aiCompleteHttp(system, messages, maxTokens, onDelta) {
      // 直连 OpenAI 兼容 API，stream=true：不用再起 Python 子进程、不用等整段生成完，
      // 首字延迟和整句延迟都明显更低，同时 onDelta 让日语句子边生成边朗读。
      const base = String(config.chatBaseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '')
      const url = base.endsWith('/chat/completions') ? base : base + '/chat/completions'
      const payload = {
        model: config.chatModel || 'deepseek-chat',
        messages: [{ role: 'system', content: system }].concat(messages),
        max_tokens: maxTokens || 300,
        temperature: 0.9,
        stream: true,
      }
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + config.chatApiKey,
          'User-Agent': 'Sakiko-DSH/1.0',
        },
        body: JSON.stringify(payload),
      })
      if (!resp.ok) {
        let detail = ''
        try { detail = truncCps(await resp.text(), 300) } catch (e) { /* ignore */ }
        throw new Error('llm http ' + resp.status + ' ' + detail)
      }
      const reader = resp.body && resp.body.getReader
      if (reader === undefined || !resp.body) throw new Error('llm http: stream unsupported')
      const stream = resp.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      let out = ''
      while (true) {
        const step = await stream.read()
        if (step.done) break
        buffer += decoder.decode(step.value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim()
          if (line.indexOf('data:') !== 0) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') break
          try {
            const json = JSON.parse(data)
            const delta = json && json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content
            if (typeof delta === 'string' && delta.length > 0) {
              out += delta
              if (onDelta) { try { onDelta(delta) } catch (e) { /* ignore */ } }
            }
          } catch (e) { /* 忽略不完整行 */ }
        }
      }
      return out
    }

    async function aiComplete(system, messages, maxTokens, onDelta) {
      const useApi = typeof config.chatApiKey === 'string' && config.chatApiKey.length > 0
      if (useApi) {
        if (typeof fetch === 'function') {
          try {
            return await Promise.race([
              aiCompleteHttp(system, messages, maxTokens, onDelta),
              ctx.timeout(CHAT_TIMEOUT_MS).then(() => { throw new Error('llm timeout') }),
            ])
          } catch (e) {
            // 直连失败时保留 Python 子进程兜底，保证有 key 就能用
            console.error('[sakiko] llm http fallback:', e && e.message ? e.message : String(e))
          }
        }
        const slot = nextSlot()
        const reqPath = TMP_DIR + '/chat-req-' + slot + '.json'
        const outPath = TMP_DIR + '/chat-out-' + slot + '.json'
        const req = {
          baseUrl: config.chatBaseUrl || 'https://api.deepseek.com/v1',
          apiKey: config.chatApiKey,
          model: config.chatModel || 'deepseek-chat',
          system,
          messages,
          maxTokens: maxTokens || 300,
          temperature: 0.9,
        }
        await writeTextSafe(reqPath, JSON.stringify(req))
        await runPython([LLM_CHAT_PY, reqPath, outPath], 'llm_chat')
        const outText = await readTextFile(outPath)
        if (outText === null) throw new Error('llm_chat: no output')
        const parsed = JSON.parse(outText)
        if (!parsed.ok) throw new Error('llm_chat: ' + (parsed.error || 'unknown'))
        return parsed.content
      }
      const llm = ctx.get('llm')
      if (llm === undefined) throw new Error('llm service unavailable')
      const adm = ctx.get('agentDefaultModel')
      let provider = null
      let model = null
      try {
        const sel = adm ? adm.currentSelection() : undefined
        if (sel && typeof sel.provider === 'string' && typeof sel.model === 'string') {
          provider = sel.provider
          model = sel.model
        }
      } catch (e) { /* ignore */ }
      if (provider === null || model === null) {
        try {
          const providers = llm.listProviders()
          if (Array.isArray(providers) && providers.length > 0) {
            provider = providers[0].provider || providers[0].id
            const models = await llm.listModels(provider)
            if (Array.isArray(models) && models.length > 0) model = models[0].model || models[0].id
          }
        } catch (e) { /* ignore */ }
      }
      if (provider === null || model === null) throw new Error('no model available')
      const llmMessages = messages.map((m) => ({
        id: 'amad-' + Math.random().toString(36).slice(2, 10),
        role: m.role,
        content: [{ type: 'text', text: m.content }],
        source: { kind: 'plugin', plugin: 'sakiko' },
      }))
      const options = {
        provider,
        model,
        messages: llmMessages,
        system,
        temperature: 0.9,
        maxTokens: maxTokens || 300,
      }
      let out = ''
      for await (const chunk of llm.stream(options)) {
        if (chunk === null || typeof chunk !== 'object') continue
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          out += chunk.text
          if (onDelta) { try { onDelta(chunk.text) } catch (e) { /* ignore */ } }
        }
        if (chunk.type === 'finish') break
      }
      return out
    }

    function parseStructured(raw) {
      const text = String(raw || '').trim()
      let emotion = 'neutral'
      let jp = ''
      let cn = ''
      const tagMatch = text.match(/【(happy|excited|elated|sad|angry|furious|question|soft|neutral)】/)
      if (tagMatch) emotion = tagMatch[1]
      const jpMatch = text.match(/JP[:：]\s*([\s\S]*?)(?=\nCN[:：]|$)/)
      if (jpMatch) jp = jpMatch[1].trim().replace(/【(happy|excited|elated|sad|angry|furious|question|soft|neutral)】/g, '')
      const cnMatch = text.match(/CN[:：]\s*([\s\S]*?)$/)
      if (cnMatch) cn = cnMatch[1].trim()
      if (jp.length === 0 && cn.length === 0) {
        cn = text.replace(/【(happy|excited|elated|sad|angry|furious|question|soft|neutral)】/g, '').replace(/JP[:：].*/, '').replace(/CN[:：].*/, '').trim()
      }
      if (cn.length === 0) cn = jp
      if (jp.length === 0) jp = cn
      // 兜底：AI 回复格式允许 1〜3 句，超过 3 句直接截断，短回复不硬凑。
      const jpParts = splitSentences(jp).slice(0, 3)
      if (jpParts.length > 0) jp = jpParts.join('')
      const cnParts = splitSentences(cn).slice(0, 3)
      if (cnParts.length > 0) cn = cnParts.join('')
      return { emotion, jp, cn }
    }

    // ---------------- Sakiko 聊天 ----------------
    async function sakikoChat(text, onDelta) {
      const persona = await readChatPersona()
      const facts = factsText()
      const summary = memory.summary ? '過去の会話の要約：\n' + memory.summary : ''
      const system = persona + (summary ? '\n\n' + summary : '') + (facts ? '\n\n' + facts : '') + CHAT_FORMAT_RULES
      const history = memory.history.slice(-10).map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.role === 'user' ? m.content : ('【' + (m.emotion || 'neutral') + '】\nJP: ' + m.jp + '\nCN: ' + m.cn),
      }))
      const messages = history.concat([{ role: 'user', content: text }])
      let streamedSegments = false
      let streamRaw = ''
      let streamEmotion = 'neutral'
      let pushedJpSentences = 0
      let firstSegmentPushed = false
      let pendingBatch = ''
      let pendingCount = 0
      const flushBatch = (emotion) => {
        if (pendingBatch.trim().length > 0) {
          pushUtterances([pendingBatch.trim()], false, emotion || streamEmotion || 'neutral')
          pendingBatch = ''
          pendingCount = 0
        }
      }
      const wrappedDelta = (delta) => {
        if (onDelta) { try { onDelta(delta) } catch (e) { /* ignore */ } }
        streamRaw += delta
        streamedSegments = true
        const tagMatch = streamRaw.match(/【(happy|excited|elated|sad|angry|furious|question|soft|neutral)】/)
        if (tagMatch) streamEmotion = tagMatch[1]
        const jpM = streamRaw.match(/JP[:：]\s*([\s\S]*?)(?=\nCN[:：]|$)/)
        const jp = jpM ? jpM[1] : ''
        const sentences = splitSentences(jp)
        let completeCount = sentences.length
        if (completeCount > 0 && !/[。！？!?…]$/.test(sentences[completeCount - 1])) {
          completeCount--
        }
        for (let i = pushedJpSentences; i < completeCount && pushedJpSentences < 3; i++) {
          const rawS = sentences[i]
          if (!rawS || rawS.trim().length === 0) continue
          const segTag = rawS.match(/^【(happy|excited|elated|sad|angry|furious|question|soft|neutral)】/)
          const segEmotion = segTag ? segTag[1] : streamEmotion
          const s = segTag ? rawS.slice(segTag[0].length).trim() : rawS
          if (!s) continue
          // 每句完整后立即推送，短回复和多条消息都能马上出声，避免句间等待
          pushUtterances([s], false, segEmotion || emotionFor(s) || streamEmotion)
          firstSegmentPushed = true
          pushedJpSentences++
        }
        pushedJpSentences = Math.min(3, Math.max(pushedJpSentences, completeCount))
      }
      const raw = await aiComplete(system, messages, 360, wrappedDelta)
      const parsed = parseStructured(raw)
      // 流式模式下，把最后可能未推送的剩余日语句子补上
      if (streamedSegments) {
        const finalSentences = splitSentences(parsed.jp)
        for (let i = pushedJpSentences; i < finalSentences.length && pushedJpSentences < 3; i++) {
          const rawS = finalSentences[i]
          if (!rawS || rawS.trim().length === 0) continue
          const segTag = rawS.match(/^【(happy|excited|elated|sad|angry|furious|question|soft|neutral)】/)
          const segEmotion = segTag ? segTag[1] : (parsed.emotion || streamEmotion)
          const s = segTag ? rawS.slice(segTag[0].length).trim() : rawS
          if (!s) continue
          // 同样逐句立即推送，避免最后剩余句子被合并延迟
          pushUtterances([s], false, segEmotion || emotionFor(s) || parsed.emotion || streamEmotion)
          firstSegmentPushed = true
          pushedJpSentences++
        }
        flushBatch(emotionFor(pendingBatch) || parsed.emotion || streamEmotion || 'neutral')
        parsed._streamed = true
      }
      memory.history.push({ role: 'user', content: text, t: Date.now() })
      lastInteractionAt = Date.now()
      memory.history.push({ role: 'assistant', jp: parsed.jp, cn: parsed.cn, emotion: parsed.emotion, t: Date.now() })
      scheduleSaveMemory()
      maybeMaintainFacts()
      maybeCompactHistory()
      return parsed
    }

    async function maybeMaintainFacts() {
      const exchangeCount = memory.history.filter((m) => m.role === 'assistant').length
      if (exchangeCount % 10 !== 0 || exchangeCount === 0) return
      try {
        const lines = memory.history.slice(-20).map((m) => (m.role === 'user' ? 'ユーザー: ' + m.content : '祥子: ' + (m.cn || m.jp))).join('\n')
        const system = '以下はユーザーと祥子の会話記録です。ユーザーについての重要な長期的事実（好み、身分、進行中のプロジェクト、関係、習慣など）を抽出し、一行一項目の簡潔なリストで出力してください。既存の事実は：\n- ' + (memory.facts || []).join('\n- ') + '\n\n既存の事実と重複するものは含めず、新しい事実のみ最大5件出力。新しい事実がなければ「なし」とだけ出力。'
        const raw = await aiComplete(system, [{ role: 'user', content: lines }], 300)
        const newFacts = String(raw).split(/\n+/).map((s) => s.replace(/^[-•・]\s*/, '').trim()).filter((s) => s.length > 2 && s.length < 120 && s !== 'なし' && !/^なし/.test(s)).slice(0, 5)
        for (const f of newFacts) {
          if (memory.facts.indexOf(f) < 0) memory.facts.push(f)
        }
        if (memory.facts.length > 30) memory.facts.splice(0, memory.facts.length - 30)
        scheduleSaveMemory()
      } catch (e) {
        console.error('[sakiko] 记忆维护失败:', e && e.message ? e.message : e)
      }
    }

    async function maybeCompactHistory() {
      // 只保留最近 30 条，更早的对话压缩成 summary，避免无限堆积原始聊天记录。
      if (memory.history.length <= 60) return
      const keep = memory.history.slice(-30)
      const old = memory.history.slice(0, memory.history.length - 30)
      memory.history = keep
      if (old.length < 8) {
        scheduleSaveMemory()
        return
      }
      try {
        const lines = old.map((m) => (m.role === 'user' ? 'ユーザー: ' + m.content : '祥子: ' + (m.cn || m.jp))).join('\n')
        const system = '以下は古い会話ログです。重要な出来事、ユーザーの好み、約束、進行中タスクだけを簡潔に要約してください。無関係な雑談や挨拶は含めない。3〜6行以内で。'
        const raw = await aiComplete(system, [{ role: 'user', content: lines }], 300)
        const summary = String(raw || '').trim()
        if (summary.length > 10) {
          memory.summary = ((memory.summary || '') + '\n' + summary).trim()
          if (memory.summary.length > 2000) memory.summary = tailCps(memory.summary, 2000)
        }
      } catch (e) {
        console.error('[sakiko] 历史压缩失败:', e && e.message ? e.message : e)
      }
      scheduleSaveMemory()
    }

    // ---------------- 主动来电 ----------------
    async function triggerCall() {
      try {
        let line = null
        try {
          const raw = await aiComplete(CALL_SYSTEM, [], 200)
          line = parseStructured(raw)
        } catch (e) { /* fallback */ }
        if (line === null) {
          const pick = CALL_CANNED[Math.floor(Math.random() * CALL_CANNED.length)]
          line = { emotion: pick.emotion, jp: pick.jp, cn: pick.cn }
        }
        memory.lastCallAt = Date.now()
        lastInteractionAt = Date.now()
        memory.callCount = (memory.callCount || 0) + 1
        memory.history.push({ role: 'assistant', jp: line.jp, cn: line.cn, emotion: line.emotion, call: true, t: Date.now() })
        if (memory.history.length > 60) maybeCompactHistory()
        scheduleSaveMemory()
        await speakSynced(line.jp, line.cn, line.emotion, 'call')
        console.log('[sakiko] 主动来电:', line.jp)
      } catch (e) {
        console.error('[sakiko] 主动来电失败:', e && e.message ? e.message : e)
      }
    }

    function checkCalls() {
      if (config.callOn !== true) return
      if (config.voiceOn !== true) return
      const now = Date.now()
      if (memory.lastCallAt === 0) {
        memory.lastCallAt = now
        scheduleSaveMemory()
        return
      }
      const interval = typeof config.callIntervalMs === 'number' && config.callIntervalMs > 0 ? config.callIntervalMs : 36000000
      if (now - memory.lastCallAt >= interval) {
        triggerCall()
      }
    }

    async function idleChatter() {
      try {
        const raw = await aiComplete(IDLE_SYSTEM, [], 200)
        const line = parseStructured(raw)
        if (line.jp.length === 0 && line.cn.length === 0) return
        if (line.jp.length === 0) line.jp = line.cn
        if (line.cn.length === 0) line.cn = line.jp
        memory.history.push({ role: 'assistant', jp: line.jp, cn: line.cn, emotion: line.emotion, idle: true, t: Date.now() })
        if (memory.history.length > 60) maybeCompactHistory()
        scheduleSaveMemory()
        await speakSynced(line.jp, line.cn, line.emotion, 'idle', { idle: true })
        console.log('[sakiko] 空闲闲聊:', line.jp)
      } catch (e) {
        console.error('[sakiko] 空闲闲聊失败:', e && e.message ? e.message : e)
      }
    }

    function checkIdle() {
      if (config.idleChatOn !== true) return
      if (config.voiceOn !== true) return
      const ms = typeof config.idleChatMs === 'number' && config.idleChatMs > 0 ? config.idleChatMs : 1200000
      if (Date.now() - lastInteractionAt >= ms) {
        lastInteractionAt = Date.now()
        idleChatter().catch((e) => console.error('[sakiko] 空闲闲聊失败:', e && e.message ? e.message : e))
      }
    }

    // ---------------- 随机哼唱彩蛋（hum easter egg） ----------------
    // 触发方式仅随机自动：周期巡检 checkHum 到达间隔后以 50% 概率出声（随机感 ≈ 间隔×1~2 倍）。
    // 音频库 assets/audio/hum-1.wav … hum-16.wav 由 SVC 转换后补；无文件时 playHum 探测为空，
    // console 提示 + tlLog hum_skip 后静默返回（不推队列、不留气泡、无 TTS 合成）。
    const HUM_DIR = ROOT + '/assets/audio'
    const HUM_MAX = 16

    async function scanHumFiles() {
      const found = []
      for (let i = 1; i <= HUM_MAX; i++) {
        const name = 'hum-' + i + '.wav'
        try {
          const p = await fs.resolve(HUM_DIR + '/' + name)
          const info = await fs.stat(p)
          if (info !== undefined) found.push({ n: i, name })
        } catch (e) { /* 文件不存在 → 跳过 */ }
      }
      return found
    }

    // 出声：随机挑一个存在的 hum 文件 → pushHum 走既有 push/tl 通道；无文件 → 静默。
    async function playHum() {
      const files = await scanHumFiles()
      if (files.length === 0) {
        console.log('[sakiko] 哼唱彩蛋：无音频（assets/audio/hum-*.wav 未提供），静默跳过')
        tlLog({ ev: 'hum_skip', reason: 'no-audio' })
        return { ok: true, file: null, reason: 'no-audio' }
      }
      const pick = files[Math.floor(Math.random() * files.length)]
      const url = '/sakiko/assets/audio/' + pick.name
      pushHum(url)
      memory.humCount = (memory.humCount || 0) + 1
      memory.history.push({ role: 'assistant', jp: '', cn: '♪ ♪ ♪', emotion: 'happy', hum: true, t: Date.now() })
      if (memory.history.length > 60) maybeCompactHistory()
      scheduleSaveMemory()
      tlLog({ ev: 'hum_play', url })
      return { ok: true, file: url, reason: 'played' }
    }

    // 入队：hum 为直连音频，不触发 warmTts（无 TTS 合成）；气泡/播放链沿用既有 push/tl 通道。
    function pushHum(url) {
      const item = { id: nextId, kind: 'hum', text: '', cn: '♪ ♪ ♪', force: true, emotion: 'happy', url: url, ts: Date.now() }
      queue.push(item)
      nextId += 1
      maxIssuedId = Math.max(maxIssuedId, nextId - 1)
      if (queue.length > 60) queue.shift()
      tlLog({ ev: 'push', id: item.id, kind: 'hum', url })
    }

    function checkHum() {
      if (config.humOn !== true) return
      if (config.voiceOn !== true) return
      const now = Date.now()
      // 首次巡检仅初始化基准时刻（同 checkCalls 的 lastCallAt 语义），不立即出声
      if (memory.lastHumAt === 0) {
        memory.lastHumAt = now
        scheduleSaveMemory()
        return
      }
      const interval = typeof config.humIntervalMs === 'number' && config.humIntervalMs > 0 ? config.humIntervalMs : 1200000
      if (now - memory.lastHumAt >= interval) {
        memory.lastHumAt = now
        scheduleSaveMemory()
        if (Math.random() < 0.5) {
          playHum().catch((e) => console.error('[sakiko] 哼唱彩蛋失败:', e && e.message ? e.message : e))
        }
      }
    }

    // ---------------- HTTP 响应助手 ----------------
    function sendJson(res, code, obj) {
      const body = JSON.stringify(obj)
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(body)
    }

    function sendBytes(res, code, bytes, headers) {
      const h = Object.assign({ 'Content-Length': String(bytes.length) }, headers || {})
      res.writeHead(code, h)
      res.end(bytes)
    }

    function readBody(req, maxBytes) {
      return new Promise((resolve, reject) => {
        const chunks = []
        let size = 0
        req.on('data', (c) => {
          size += c.length
          if (size > maxBytes) {
            reject(new Error('body too large'))
            try { req.destroy() } catch (e) { /* ignore */ }
            return
          }
          chunks.push(c)
        })
        req.on('end', () => {
          try { resolve(Buffer.concat(chunks)) } catch (e) { reject(e) }
        })
        req.on('error', reject)
      })
    }

    function toBase64(buf) {
      if (typeof Buffer !== 'undefined') return Buffer.from(buf).toString('base64')
      // 极老环境兜底
      let s = ''
      for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i])
      return btoa(s)
    }

    async function transcribeAudio(audioBuf, lang) {
      const slot = nextSlot()
      const b64Path = TMP_DIR + '/stt-upload-' + slot + '.b64'
      const outPath = TMP_DIR + '/stt-out-' + slot + '.json'
      await writeTextSafe(b64Path, toBase64(audioBuf))
      const baseUrl = config.sttApiUrl || config.chatBaseUrl || 'https://api.openai.com/v1'
      const apiKey = config.sttApiKey || config.chatApiKey || ''
      if (!apiKey) throw new Error('STT: missing API key')
      await runPython([
        STT_PY,
        b64Path,
        outPath,
        baseUrl,
        apiKey,
        config.sttModel || 'whisper-1',
        lang || '',
      ], 'stt')
      const outText = await readTextFile(outPath)
      if (outText === null) throw new Error('STT: no output')
      const parsed = JSON.parse(outText)
      if (!parsed.ok) throw new Error('STT: ' + (parsed.error || 'unknown'))
      return parsed.text
    }

    async function serveFile(res, absPath, maxBytes, cache) {
      let bytes
      try {
        bytes = await readFileBytes(absPath, maxBytes)
      } catch (e) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      if (bytes === null) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      sendBytes(res, 200, bytes, { 'Content-Type': mimeFor(absPath), 'Cache-Control': cache || 'no-cache' })
    }

    async function serveManifest(res) {
      const now = Date.now()
      if (manifestCache.value !== null && now - manifestCache.at < 5000) {
        sendJson(res, 200, manifestCache.value)
        return
      }
      try {
        const bytes = await readFileBytes(MANIFEST_PATH, 65536)
        if (bytes === null) {
          sendJson(res, 200, { models: [], image: '', placeholder: true })
          return
        }
        const m = JSON.parse(new TextDecoder('utf-8').decode(bytes))
        const models = (Array.isArray(m.models) ? m.models : []).map((x) => ({
          url: typeof x.url === 'string' ? x.url : '',
          format: x.format === 'cubism4' ? 'cubism4' : 'cubism2',
          scale: typeof x.scale === 'number' ? x.scale : 1,
          layout: (x.layout && typeof x.layout === 'object') ? x.layout : undefined,
        })).filter((x) => x.url.length > 0)
        const image = typeof m.image === 'string' && m.image.length > 0 ? '/sakiko/assets/' + m.image : ''
        const value = { models, image, placeholder: m.placeholder !== false }
        manifestCache = { at: now, value }
        sendJson(res, 200, value)
      } catch (e) {
        sendJson(res, 200, { models: [], image: '', placeholder: true })
      }
    }

    // ---------------- 路由 ----------------
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/sakiko/tts',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req.url)
          const text = typeof q.text === 'string' ? q.text.trim() : ''
          if (text.length === 0) { sendJson(res, 400, { error: 'missing text' }); return }
          if (text.length > 300) { sendJson(res, 400, { error: 'text too long' }); return }
          const voice = typeof q.voice === 'string' && VOICES.indexOf(q.voice) >= 0 ? q.voice : config.voiceName
          const rate = typeof q.rate === 'string' && RATES.indexOf(q.rate) >= 0 ? q.rate : config.rate
          const pitch = typeof q.pitch === 'string' && PITCHES.indexOf(q.pitch) >= 0 ? q.pitch : config.pitch
          const emotion = typeof q.emotion === 'string' && EMOTIONS.indexOf(q.emotion) >= 0 ? q.emotion : 'neutral'
          const entry = await synthesize(text, voice, rate, pitch, emotion)
          const wordsHeader = (entry.words && entry.words.length > 0) ? Buffer.from(JSON.stringify(entry.words)).toString('base64') : ''
          sendBytes(res, 200, entry.bytes, { 'Content-Type': entry.mime || 'audio/mpeg', 'Cache-Control': 'public, max-age=3600', 'X-Sakiko-Words': wordsHeader })
        } catch (e) {
          sendJson(res, 502, { error: e && e.message ? e.message : String(e) })
        }
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/sakiko/ttsmeta',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req.url)
          const text = typeof q.text === 'string' ? q.text.trim() : ''
          if (text.length === 0 || text.length > 300) { sendJson(res, 200, { words: [] }); return }
          const voice = typeof q.voice === 'string' && VOICES.indexOf(q.voice) >= 0 ? q.voice : config.voiceName
          const rate = typeof q.rate === 'string' && RATES.indexOf(q.rate) >= 0 ? q.rate : config.rate
          const pitch = typeof q.pitch === 'string' && PITCHES.indexOf(q.pitch) >= 0 ? q.pitch : config.pitch
          const emotion = typeof q.emotion === 'string' && EMOTIONS.indexOf(q.emotion) >= 0 ? q.emotion : 'neutral'
          const entry = await synthesize(text, voice, rate, pitch, emotion)
          const words = entry.words || []
          const totalMs = words.reduce((s, w) => s + (w.d || 0), 0)
          sendJson(res, 200, { words, totalMs })
        } catch (e) {
          sendJson(res, 200, { words: [] })
        }
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/sakiko/stt',
      handler: async (req, res) => {
        noteHost(req)
        try {
          const q = parseQuery(req.url)
          const lang = typeof q.lang === 'string' ? q.lang.slice(0, 10) : ''
          const buf = await readBody(req, 20 * 1024 * 1024)
          if (buf === null || buf.length < 100) {
            sendJson(res, 400, { error: 'missing audio' })
            return
          }
          const text = await transcribeAudio(buf, lang)
          sendJson(res, 200, { ok: true, text })
        } catch (e) {
          sendJson(res, 502, { ok: false, error: e && e.message ? e.message : String(e) })
        }
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/sakiko/poll',
      handler: async (req, res) => {
        noteHost(req)
        const q = parseQuery(req.url)
        let after = Number(q.after)
        if (!isFinite(after)) after = -1
        let items = []
        if (after >= 0) {
          items = queue.filter((u) => u.id > after).map((u) => ({ id: u.id, kind: u.kind || 'say', text: u.text, cn: u.cn || '', force: !!u.force, emotion: u.emotion || 'neutral', expr: u.expr || '', ts: u.ts || 0, announce: u.announce === true, idle: u.idle === true, url: u.url || '' }))
          const served = new Set(items.map((u) => u.id))
          queue = queue.filter((u) => !served.has(u.id))
        }
        sendJson(res, 200, {
          cursor: maxIssuedId,
          config,
          utterances: items,
          tts: config.provider,
        })
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/sakiko/chat',
      handler: async (req, res) => {
        noteHost(req)
        try {
          if (config.chatOn !== true) { sendJson(res, 403, { error: 'chat disabled' }); return }
          const q = parseQuery(req.url)
          const text = typeof q.text === 'string' ? q.text.trim() : ''
          if (text.length === 0) { sendJson(res, 400, { error: 'missing text' }); return }
          if (text.length > 500) { sendJson(res, 400, { error: 'text too long' }); return }
          lastInteractionAt = Date.now()
          if (chatBusy) { sendJson(res, 429, { error: 'busy' }); return }
          chatBusy = true
          const chatId = ++chatSeq
          chatStreams.set(chatId, { status: 'running', raw: '', jp: '', cn: '', emotion: 'neutral', at: Date.now() })
          // 清理旧流
          const nowMs = Date.now()
          for (const [k, v] of chatStreams) {
            if (k !== chatId && nowMs - v.at > 300000) chatStreams.delete(k)
          }
          ;(async () => {
            try {
              const result = await Promise.race([
                sakikoChat(text, (delta) => {
                  const s = chatStreams.get(chatId)
                  if (s && typeof delta === 'string') s.raw += delta
                }),
                ctx.timeout(CHAT_TIMEOUT_MS).then(() => { throw new Error('llm timeout') }),
              ])
              const s = chatStreams.get(chatId)
              if (s) {
                s.status = 'done'
                s.jp = result.jp
                s.cn = result.cn
                s.emotion = result.emotion
                s.streamed = result._streamed === true
              }
            } catch (e) {
              const s = chatStreams.get(chatId)
              if (s) {
                s.status = 'error'
                s.error = e && e.message ? e.message : String(e)
              }
            } finally {
              chatBusy = false
            }
          })()
          sendJson(res, 200, { ok: true, chatId })
        } catch (e) {
          chatBusy = false
          sendJson(res, 502, { error: e && e.message ? e.message : String(e) })
        }
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/sakiko/chatstream',
      handler: async (req, res) => {
        noteHost(req)
        const q = parseQuery(req.url)
        const chatId = Number(q.chatId)
        const s = chatStreams.get(chatId)
        if (s === undefined) { sendJson(res, 200, { status: 'missing' }); return }
        sendJson(res, 200, {
          status: s.status,
          raw: tailCps(String(s.raw || ''), 2400),
          jp: s.jp || '',
          cn: s.cn || '',
          emotion: s.emotion || 'neutral',
          streamed: s.streamed === true,
          error: s.error || '',
        })
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/sakiko/chatfull',
      handler: async (req, res) => {
        noteHost(req)
        try {
          if (config.chatOn !== true) { sendJson(res, 403, { error: 'chat disabled' }); return }
          const q = parseQuery(req.url)
          const text = typeof q.text === 'string' ? q.text.trim() : ''
          if (text.length === 0) { sendJson(res, 400, { error: 'missing text' }); return }
          if (text.length > 500) { sendJson(res, 400, { error: 'text too long' }); return }
          lastInteractionAt = Date.now()
          if (chatBusy) { sendJson(res, 429, { error: 'busy' }); return }
          chatBusy = true
          try {
            const result = await Promise.race([
              sakikoChat(text),
              ctx.timeout(CHAT_TIMEOUT_MS).then(() => { throw new Error('llm timeout') }),
            ])
            sendJson(res, 200, { ok: true, jp: result.jp, cn: result.cn, emotion: result.emotion })
          } finally {
            chatBusy = false
          }
        } catch (e) {
          sendJson(res, 502, { error: e && e.message ? e.message : String(e) })
        }
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/sakiko/action',
      handler: async (req, res) => {
        noteHost(req)
        const q = parseQuery(req.url)
        const cmd = typeof q.cmd === 'string' ? q.cmd : ''
        if (cmd === 'close') {
          pendingClose = Date.now()
          sendJson(res, 200, { ok: true, pendingClose })
          return
        }
        if (cmd === 'ackcall') {
          callPending = false
          sendJson(res, 200, { ok: true })
          return
        }
        if (cmd === 'ping') { sendJson(res, 200, { ok: true }); return }
        sendJson(res, 400, { error: 'unknown cmd' })
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/sakiko/memory',
      handler: async (req, res) => {
        noteHost(req)
        sendJson(res, 200, {
          history: memory.history.slice(-50),
          facts: memory.facts.slice(-30),
          summary: memory.summary || '',
          lastCallAt: memory.lastCallAt,
          callCount: memory.callCount || 0,
        })
      },
    }))

    // 语音服务状态 / 启动 / 停止（面板与 agent 都可以直接调）
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/sakiko/voice',
      handler: async (req, res) => {
        noteHost(req)
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        const action = url.searchParams.get('action') || ''
        let startPending = false    // S2：即时响应是否代表"启动仍在进行中"
        try {
          if (action === 'start') {
            void startVoiceServices('http')
            // D2 的可见症状之一：同步早退路径（voiceRoot 空 / voiceAutoStart=false）会在**同一个
            // tick** 内就跑完，但 `void` 不 await ⇒ 响应里 starting 永远是 true。等一个 setImmediate
            // 让已结算的启动收尾（清 voiceShared.starting）后再拼响应；真正在跑的启动仍然是 starting:true。
            await new Promise((r) => setImmediate(r))
            // S2（复审 2026-09-13 次要）：即时响应里的 phase 曾是**上一次**的陈旧值 —— 实测
            // C 场景回 `phase:"stopped" starting:true`、D 场景回 `phase:"external" starting:true`，
            // 面板/agent 直接采信就会读到错状态。setImmediate 之后 starting 仍非 null ⇒ 这次启动
            // 是真的还在跑，此刻唯一自洽的 phase 就是 `starting`（详见下面 out.phase 的注释）。
            startPending = voiceShared.starting !== null
            if (startPending) syncVoiceOwnership()   // 顺带把 owner/pid 与活句柄对齐，别回旧 pid
          }
          else if (action === 'stop') await stopVoiceServices('http 请求')
          else if (action === 'probe') {
            // D6（审查 2026-09-13 次要）：probe 必须给出**自洽**的 phase/owner。
            // 旧写法只刷新 api.up/bridge.up，phase/owner 原样留着 ⇒ 会出现
            // `phase:"idle"` 与 `api.up:true, bridge.up:true` 同时出现这种自相矛盾的响应。
            const apiPort = Math.floor(Number(config.voiceApiPort) || 9880)
            const bridgePort = Math.floor(Number(config.voiceBridgePort) || 8100)
            voiceShared.state.api.port = apiPort
            voiceShared.state.bridge.port = bridgePort
            // 一律 TCP connect 判"在听"（与自启动同一判据，见 D3）
            const apiUp = await portOpen(apiPort, 1500)
            const brUp = await portOpen(bridgePort, 1500)
            voiceShared.state.api.up = apiUp
            voiceShared.state.bridge.up = brUp
            const mgA = voiceProcAlive(voiceShared.procs.api)
            const mgB = voiceProcAlive(voiceShared.procs.bridge)
            // 启动进行中（例如 api 正在加载模型、端口还没 bind）时探到"端口没在听"并不代表失败，
            // 不能把 starting 覆写成 failed —— 那又是一次"状态自相矛盾"（D6 的同源问题）。
            if (voiceShared.starting !== null) {
              if (mgA || mgB) { voiceShared.state.owner = 'plugin'; voiceShared.state.api.pid = mgA ? voiceShared.procs.api.pid : 0; voiceShared.state.bridge.pid = mgB ? voiceShared.procs.bridge.pid : 0 }
              setVoicePhase('starting', 'probe：自启动/启动请求仍在进行中（api:' + apiUp + ' bridge:' + brUp + '）')
            } else if (mgA || mgB) {
              voiceShared.state.owner = 'plugin'
              voiceShared.state.api.pid = mgA ? voiceShared.procs.api.pid : 0
              voiceShared.state.bridge.pid = mgB ? voiceShared.procs.bridge.pid : 0
              if (apiUp && brUp) setVoicePhase('ready', 'probe：插件托管的服务都在听')
              else setVoicePhase('failed', 'probe：插件托管的进程还在，但端口未在听（api:' + apiUp + ' bridge:' + brUp + '）')
            } else if (apiUp || brUp) {
              voiceShared.state.owner = 'external'
              voiceShared.state.api.pid = 0
              voiceShared.state.bridge.pid = 0
              if (apiUp && brUp) setVoicePhase('external', 'probe：外部服务在听（插件不接管也不会停它）')
              else if (brUp) setVoicePhase('external', 'probe：外部桥在听，但 api :' + apiPort + ' 未就绪')
              else setVoicePhase('external', 'probe：api :' + apiPort + ' 在听，但桥 :' + bridgePort + ' 未就绪')
            } else {
              voiceShared.state.owner = 'none'
              voiceShared.state.api.pid = 0
              voiceShared.state.bridge.pid = 0
              setVoicePhase('idle', 'probe：未发现任何在听的语音服务（api :' + apiPort + ' / 桥 :' + bridgePort + '）')
            }
          }
          const out = {
            ok: true,
            // S2：启动仍在进行中时**只改响应、不动共享状态** —— 共享状态归"真正在跑的那次启动"，
            // 真正在跑的那次启动"的领地，这里若去写它，会把对方刚收尾写好的 phase 覆盖成 starting
            // 并永远留在面板上。响应里如实写 starting，等下一次查询拿稳定态。
            phase: startPending ? 'starting' : voiceShared.state.phase,
            detail: voiceShared.state.detail,
            at: voiceShared.state.at,
            owner: voiceShared.state.owner,
            managed: voiceShared.procs.api !== null || voiceShared.procs.bridge !== null,
            starting: voiceShared.starting !== null,
            pending: startPending,      // 即时响应是"启动进行中"的占位（几秒后再查才是稳定态）
            stopPending: voiceShared.stopTimer !== null,
            epoch: voiceShared.epoch,                 // 供排查"热重载后是谁在管"（D9）
            api: voiceShared.state.api,
            bridge: voiceShared.state.bridge,
            root: String(config.voiceRoot || ''),
            autoStart: config.voiceAutoStart === true,
            log: voiceShared.state.log.slice(-25),
          }
          const body = JSON.stringify(out, null, 2)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(body)
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) }))
        }
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/sakiko/diag',
      handler: async (req, res) => {
        noteHost(req)
        const out = { ok: false }
        try {
          out.voice = {
            phase: voiceShared.state.phase,
            detail: voiceShared.state.detail,
            owner: voiceShared.state.owner,
            managed: voiceShared.procs.api !== null || voiceShared.procs.bridge !== null,
            api: voiceShared.state.api,
            bridge: voiceShared.state.bridge,
          }
          out.spAvailable = sandboxPolicy !== undefined
          if (sandboxPolicy !== undefined) {
            try { out.defaultMode = String(sandboxPolicy.defaultMode) } catch (e) { out.defaultModeErr = String(e) }
            try { out.workspaceRoot = String(sandboxPolicy.workspaceRoot) } catch (e) { out.wsErr = String(e) }
            try {
              const p0 = sandboxPolicy.resolve()
              out.resolveDefault = p0
            } catch (e) { out.resolveErr = String(e) }
            try {
              const p1 = sandboxPolicy.resolve({ mode: 'danger-full-access' })
              out.resolveDanger = p1
            } catch (e) { out.resolveDangerErr = String(e) }
          }
          const t = await fs.resolve(MEMORY_PATH)
          out.processPath = typeof fs.processPath === 'function' ? fs.processPath(t) : 'n/a'
          const probePath = TMP_DIR + '/diag-probe.json'
          const probe = await fs.resolve(probePath)
          try {
            const oc = await fs.writeText(probe, '{"ok":true}', undefined, undefined, undefined)
            out.probeNoPolicy = oc
          } catch (e) {
            out.probeNoPolicyErr = e && e.message ? e.message : String(e)
          }
          try {
            let dp
            try { dp = sandboxPolicy !== undefined ? sandboxPolicy.resolve({ mode: 'danger-full-access' }) : undefined } catch (e) { /* ignore */ }
            const oc2 = await fs.writeText(probe, '{"ok":true}', undefined, undefined, dp)
            out.probeDanger = oc2
          } catch (e) {
            out.probeDangerErr = e && e.message ? e.message : String(e)
          }
          out.ok = true
        } catch (e) {
          out.error = e && e.message ? e.message : String(e)
        }
        sendJson(res, 200, out)
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/sakiko/manifest',
      handler: async (req, res) => { await serveManifest(res) },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/sakiko/panel.html',
      handler: async (req, res) => { await serveFile(res, ROOT + '/plugin/web/panel.html', 262144, 'no-cache') },
    }))

    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/sakiko/web',
      handler: async (req, res) => {
        const pathname = req.url.split('?')[0]
        const rel = safeRel(pathname.slice('/sakiko/web'.length))
        if (rel === null) { res.writeHead(404); res.end(); return }
        await serveFile(res, ROOT + '/plugin/web' + rel, MAX_ASSET_BYTES, 'no-cache')
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/sakiko/assets',
      handler: async (req, res) => {
        let pathname
        try { pathname = req.url.split('?')[0] } catch (e) { res.writeHead(400); res.end(); return }
        const rel = safeRel(pathname.slice('/sakiko/assets'.length))
        if (rel === null) { res.writeHead(404); res.end(); return }
        await serveFile(res, ROOT + '/assets' + rel, MAX_ASSET_BYTES, 'public, max-age=3600')
      },
    }))

    // ---------------- RPC ----------------
    ctx.effect(() => harnessLocal.handle('getStatus', async () => ({
      config,
      tts: config.provider,
      queue: queue.length,
      cache: ttsCache.size,
      callPending,
      pendingClose,
    })))

    // 进度叙事状态（供验证：焦点会话回合状态 / 会话注册表摘要 / 全局计数与台词池 / 最近发声）
    //   state / lastSpokeByIntent / lastDoneFamilyAt = 焦点会话（最近活跃；multiSession:false 时为默认槽）
    //   summary / counts / poolCursor / poolLastUsed / lastSpeaks = 全局（跨会话共享）
    ctx.effect(() => harnessLocal.handle('narratorStatus', async () => {
      const now = Date.now()
      const st = primaryState()
      const sessionRows = []
      for (const rec of sessions.values()) {
        // 经 stateFor 取值：multiSession:false 时各行的回合态即共享默认槽（与 state 字段同源，不虚报）
        const rst = stateFor(rec.sid)
        // Fix T4：行内附带该会话的进度分片摘要（最近用户输入 + 里程碑次数），便于真机验收
        // Fix R4：暴露给面板的 lastUserText/lastSummary 是**二次截断**（存 200 → 出 100），
        //   同样必须按码点切（否则存储侧保留的 emoji 会在这一步被切成孤立代理项出现在响应 JSON 里）。
        const pe = (memory.progress && typeof memory.progress === 'object') ? memory.progress[rec.sid] : undefined
        sessionRows.push({
          sid: String(rec.sid).slice(0, 8),
          label: rec.label,
          cwd: rec.cwd,
          turnActive: rst.turnActive === true,
          stepCount: rst.stepCount,
          blocking: rst.blocking,
          lastActiveAt: rec.lastActiveAt,
          lastUserText: (pe && typeof pe.lastUserText === 'string') ? truncCps(pe.lastUserText, 100) : '',
          milestoneCount: (pe && typeof pe.milestoneCount === 'number') ? pe.milestoneCount : 0,
          // Fix R1（Minor-4）：暴露分会话最近总结（供 Task 5 核对 LLM 输入的来源）
          lastSummary: (pe && typeof pe.lastSummary === 'string') ? truncCps(pe.lastSummary, 100) : '',
        })
      }
      sessionRows.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      return {
        config: {
          narratorOn: config.narratorOn,
          narratorLLMSummary: config.narratorLLMSummary,
          narratorDone: config.narratorDone,
          narratorMilestoneMs: config.narratorMilestoneMs,
          narratorMilestoneSteps: config.narratorMilestoneSteps,
          narratorAssistantChars: config.narratorAssistantChars,
          multiSession: config.multiSession !== false,
          multiSessionPrefix: typeof config.multiSessionPrefix === 'string' ? config.multiSessionPrefix : 'always',
        },
        state: {
          sid: String(st.sid || '').slice(0, 8),
          turnActive: st.turnActive,
          runningMs: st.turnActive ? now - st.turnStartAt : 0,
          stepCount: st.stepCount,
          startSpoken: st.startSpoken,
          milestoneSpoken: st.milestoneSpoken,
          turnGoalDone: st.turnGoalDone,
          blocking: st.blocking,
          lastUserText: truncCps(st.lastUserText || '', 100),
          toolNames: st.toolNames || {},
        },
        sessions: sessionRows.slice(0, 10),
        sessionCount: sessions.size,
        summary: { lastSummary: narrGlobal.lastSummary, lastLLMAt: narrGlobal.lastLLMAt },
        counts: narrGlobal.counts,
        poolCursor: narrGlobal.poolCursor,
        poolLastUsed: Object.fromEntries(poolLastUsed),
        lastSpokeByIntent: Object.fromEntries(st.lastSpokeByIntent),
        lastDoneFamilyAt: st.lastDoneFamilyAt,
        lastSpeaks: lastNarrSpeaks.slice(-8),
      }
    }))

    // 进度叙事发声测试：强制触发对应意图（绕过节流与回合内一次性标记；narratorOn 仍需为真）
    // voiceOn 的判定在 speakSynced（语音关时仍推气泡、不出声），故此处不再受它约束
    // 多工作区（Task 1）：不带 sid → 走默认槽（force=true 本就绕过 lastSpokeByIntent/lastDoneFamilyAt 门）
    ctx.effect(() => harnessLocal.handle('testNarrator', async (args) => {
      const intent = args && typeof args.intent === 'string' ? args.intent : ''
      if (['start', 'done', 'block', 'milestone', 'fail', 'goal'].indexOf(intent) < 0) {
        return { ok: false, error: 'intent 需为 start|done|block|milestone|fail|goal' }
      }
      let variant
      if (intent === 'block') {
        variant = (args && typeof args.variant === 'string' && NARR_BLOCK_IDS[args.variant]) ? args.variant : 'b4'
      }
      // testNarrator 走模板句（noLLM），避免空上下文等 LLM 造成测试不确定
      const res = narrate(intent, { force: true, variant, noLLM: true })
      return { ok: res.ok, intent, reason: res.reason || '', variant: variant || undefined }
    }))

    // 语音就绪闸门的**可观测入口**（v2.2.0 随「欢迎语稳定无声」修复一起加）。
    //   为什么要留它：就绪等待只在「启动那几十秒」这个窗口里才会真的等（稳态下是快路径、0 等待），
    //   要验证/排查就必须能主动观测它，否则只能靠"重启一次看看有没有声音"这种代价极高的手段。
    //   默认安全：不带参数只做**一次**探针并立即返回（不等、不写配置、不改状态）；
    //   带 `maxMs` 才进入等待，且上限被夹到 [0, 300000]。
    //   实测用法：`curl "http://127.0.0.1:3080/sakiko/rpc?m=testVoiceWait&args=%7B%7D"`
    ctx.effect(() => harnessLocal.handle('testVoiceWait', async (args) => {
      const t0 = Date.now()
      const now = await voiceBackendReadyNow()
      const maxMs = (args && typeof args.maxMs === 'number' && isFinite(args.maxMs)) ? args.maxMs : 0
      if (maxMs <= 0) {
        return { ok: true, waited: false, ready: now.ready, why: now.why, phase: voiceShared.state.phase, elapsedMs: Date.now() - t0 }
      }
      const gate = await waitVoiceReady()
      return {
        ok: true, waited: true, ready: gate.ready, timeout: gate.timeout, skipped: gate.skipped,
        why: gate.why, waitedMs: gate.waitedMs, phase: voiceShared.state.phase,
        maxMs: Math.max(0, Math.min(300000, maxMs)),
      }
    }))

    ctx.effect(() => harnessLocal.handle('setConfig', async (patch) => {
      const clean = sanitizePatch(patch)
      const wasMultiSession = config.multiSession !== false
      config = Object.assign({}, config, clean)
      // Fix R1（Important-2）：multiSession false→true 回切 → 复位保留的分片态，
      // 避免陈旧 turnActive/blocking/stepCount 复活（见 resetRetainedStates 注释）
      if (wasMultiSession === false && config.multiSession !== false) resetRetainedStates()
      await saveConfig()
      return config
    }))

    ctx.effect(() => harnessLocal.handle('testChat', async () => {
      try {
        const content = await aiComplete(
          'You are a helpful assistant.',
          [{ role: 'user', content: 'Reply with exactly: OK' }],
          20
        )
        return { ok: true, content: truncCps(content || '', 200) }
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) }
      }
    }))

    ctx.effect(() => harnessLocal.handle('say', async (args) => {
      const text = args && typeof args.text === 'string' ? args.text : ''
      const sentences = splitSentences(text)
      if (sentences.length === 0) return { ok: false }
      // 逐句先合成再入队，保证点到即有声音（不出现队列先行、声音干等）
      for (const s of sentences) {
        try { await synthesize(s, config.voiceName, config.rate, config.pitch, emotionFor(s)) } catch (e) { /* 合成失败跳过，面板侧无声=链路自检 */ }
      }
      pushUtterances(sentences, true, emotionFor(text))
      lastSpokenText = text.trim()
      return { ok: true, count: sentences.length }
    }))

    ctx.effect(() => harnessLocal.handle('repeat', async () => {
      let text = lastSpokenText
      if (text.length === 0) text = '申し遅れました 私 豊川祥子と申します'
      const sentences = splitSentences(text)
      for (const s of sentences) {
        try { await synthesize(s, config.voiceName, config.rate, config.pitch, emotionFor(s)) } catch (e) { /* ignore */ }
      }
      pushUtterances(sentences, true, emotionFor(text))
      return { ok: true, count: sentences.length }
    }))

    ctx.effect(() => harnessLocal.handle('clear', async () => {
      queue = []
      return { ok: true }
    }))

    ctx.effect(() => harnessLocal.handle('testCall', async () => {
      await triggerCall()
      return { ok: true }
    }))

    // 随机哼唱彩蛋测试：立即 playHum()（探测音频、随机挑一、push/tl 留痕），返回 played/no-audio
    ctx.effect(() => harnessLocal.handle('testHum', async () => {
      return await playHum()
    }))

    ctx.effect(() => harnessLocal.handle('ackCall', async () => {
      callPending = false
      return { ok: true }
    }))

    ctx.effect(() => harnessLocal.handle('ackClose', async () => {
      pendingClose = null
      return { ok: true }
    }))

    ctx.effect(() => harnessLocal.handle('clientReport', async (args) => {
      const msg = args && typeof args.msg === 'string' ? truncCps(args.msg, 300) : ''
      if (msg.length > 0) {
        clientReports.push({ t: new Date().toISOString(), msg: '[ui] ' + msg })
        if (clientReports.length > 60) clientReports.shift()
      }
      return { ok: true }
    }))

    const clientReports = []
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/sakiko/report',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req.url)
          const msg = typeof q.msg === 'string' ? truncCps(q.msg, 400) : ''
          if (msg.length > 0) {
            clientReports.push({ t: new Date().toISOString(), msg })
            if (clientReports.length > 60) clientReports.shift()
            // 时间线客户端事件（音画同步量化）：面板上报 tl:bubble|play|end:<id>，
            // 解析后照常进 clientReports（兼容），同时落时间线日志。
            const tm = /^tl:(bubble|play|end):(\d+)$/.exec(msg)
            if (tm) {
              const tlEv = { bubble: 'client_bubble', play: 'client_play', end: 'client_end' }[tm[1]]
              tlLog({ ev: tlEv, id: Number(tm[2]) })
            }
          }
          sendJson(res, 200, { ok: true })
        } catch (e) {
          sendJson(res, 200, { ok: false })
        }
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/sakiko/logs',
      handler: async (req, res) => { sendJson(res, 200, { reports: clientReports, timeline: tlRecent }) },
    }))

    // ---------------- 进度叙事：会话事件 → 意图路由 ----------------
    // 助手输出的文本一律不朗读；会话进度由下方 dispatcher 归一为 narrate() 意图播报。
    // 多工作区（Task 1）：本监听是唯一的状态写入口，全部读写都落到【该事件所属 sid】的 state——
    //   会话注册表（touchSession）负责登记/label/cwd/lastActiveAt；stateFor(sid) 提供该会话回合态；
    //   narrate(..., { sid }) 使节流占位也归该会话，从而 A 工作区的事件不再清 B 的回合态、不再抑制 B 的里程碑。
    // 事件→意图（实测 dsh-session known-event-types：tool/call、approval/asked、session/title 均在 session/event 流内）：
    //   session/title → 更新该会话 title/label（不开口，只影响之后的播报）
    //   user/message → 清 blocking + resetTurn（不开口）
    //   turn/start → resetTurn
    //   tool/call（回合首个）→ START；累计 stepCount/工具名（里程碑步数依据）
    //   approval/asked → BLOCK B1；approval/decided → 清 blocking
    //   assistant/message 含 ask_user_question → BLOCK B2；含 exit_plan_mode → BLOCK B3（计划审批）；含 goal 完成类调用 → turnGoalDone
    //   goal/change operation=complete → turnGoalDone（不直接播，等 turn/end 归一 A3）
    //   turn/end → handleTurnEnd()：goal 完成过 → 'goal'（A3）；否则 'done'（LLM/模板）；随后清该会话回合状态
    // 子代理会话开关（Task 5 / config.narrateSubagents）：
    //   · 默认 true → 本监听行为与既有完全一致（零回归）；
    //   · false → 判定为子代理会话的事件**完全不参与**：不注册（不污染注册表/标签/淘汰）、
    //     不维护回合态（resetTurn/stepCount/blocking 全跳过）、不 narrate（因此不写 history/progress/
    //     counts/lastSpeaks/timeline push 行）；判定信号见 isSubagentSession() 注释。
    //   · `subagent/descriptor` 事件始终只用于登记 childSids（本身没有播报语义，开关开/关都不出声）。
    //   · 既有 `subagent/end` 的 A4-1「子代理完成」特殊句**不受本开关影响**（无 sid → 默认槽，主会话层面的提示）；
    //     不过它的气泡前缀来自 `info.id` 查注册表（X5 任务 A）——开关关闭时子代理会话不入注册表，
    //     此时 `labelForSid` 未命中 → 无前缀（与本开关的语义一致，不是缺陷）。
    //   · 运行期切换立即生效：每个事件按当时的 config 值判定；已在播报队列/批次里的条目不撤回（边界见报告）。
    ctx.effect(() => ctx.on('session/event', (session, event) => {
      try {
        if (event === null || typeof event !== 'object') return
        const t = event.type
        const d = event.data
        // 判定信号 ③：子代理子会话的日志里带一条 subagent/descriptor（dsh-subagent 建子会话时写入）
        if (t === 'subagent/descriptor') {
          const cid = sidOf(session)
          if (cid.length > 0) {
            childSids.add(cid)
            // Fix R1（Minor-1）：descriptor **迟到**（首个事件之后才到）时就地纠正已注册记录，
            // 否则该记录的 isSubagent 会以 false 定格 → 30s 巡检仍会为它补播里程碑。
            const recKnown = sessions.get(cid)
            if (recKnown !== undefined && recKnown.isSubagent !== true) {
              recKnown.isSubagent = true
              refreshLabels()   // Fix R2：分类变化后重算标签，使该子代理的标签立即按 12 字截断
            }
          }
          return
        }
        // Task 5：开关关闭时，子代理会话的事件在此一刀切断（最省资源、最彻底）
        if (config.narrateSubagents === false && isSubagentSession(session)) return
        // 注册表续活（首见注册；标题/cwd 变更重算标签）——session 不可用时 rec 为 null，状态落默认槽（退化为单一槽行为）
        const rec = touchSession(session)
        if (t === 'session/title') {
          setSessionTitle(rec, d && typeof d === 'object' ? d.title : undefined)
          return
        }
        const sid = rec === null ? '' : rec.sid
        const st = stateFor(sid)
        if (t === 'user/message') {
          // 用户新消息到来：解除阻塞标记、记录输入、开启新回合（纯聊天回合不开口）——只动本会话
          st.blocking = null
          const text = truncCps(userMessageText(d), 200)
          if (text.length > 0) st.lastUserText = text
          resetTurn(st)
          return
        }
        if (t === 'turn/start') {
          resetTurn(st)
          return
        }
        if (t === 'turn/end') {
          handleTurnEnd(d, st)
          return
        }
        if (t === 'tool/call') {
          // 有据开工：回合首个工具调用 → START（每回合一次，由 startSpoken 保证）
          st.stepCount += 1
          const name = d && typeof d === 'object' ? String(d.name || '') : ''
          if (name.length > 0) st.toolNames[name] = (st.toolNames[name] || 0) + 1
          if (!st.startSpoken) {
            st.startSpoken = true
            narrate('start', { sid })
          }
          // 里程碑即时检查。Task 10 周期制：步数增量与时间间隔都在 maybeMilestone 内判定，
          // 这里不能再拿「本回合一次性」标志预筛 —— 否则第 2 个步数周期永远到不了点。
          // 时间型另有 30s 巡检兜底，覆盖「没有工具调用的静默长回合」。
          maybeMilestone(st)
          return
        }
        if (t === 'approval/asked') {
          // 权限审批等待 → BLOCK B1（对 payload 防御式取用）——只置本会话 blocking
          st.blocking = 'b1'
          narrate('block', { sid, variant: 'b1' })
          return
        }
        if (t === 'approval/decided') {
          // 审批已有答复：解除本会话阻塞（不开口）
          if (st.blocking) st.blocking = null
          return
        }
        if (t === 'goal/change') {
          const gd = d
          if (gd && typeof gd === 'object' && typeof gd.operation === 'string') {
            if (gd.operation === 'complete') st.turnGoalDone = true
          }
          return
        }
        if (t === 'assistant/message') {
          const msg = d && d.message
          if (msg && typeof msg === 'object') {
            // A：保存本回合**最近一条非空**助手文本（「结尾最核心的输出」）供 DONE/里程碑总结使用。
            //   只取 type==='text' 的块（见 assistantMessageText）；每来一条非空就覆盖 —— 同一回合内
            //   带工具调用的中途消息会被后续收尾消息覆盖，最终留下的就是结尾那一条。
            //   空文本（仅承载 usage 的 assistant/message）不覆盖，避免把已有文本擦掉。
            //   A2（预算可配）：存储侧保留上限 = NARR_ASSIST_MAX_CPS（2000，= 预算可配的最大值），
            //   **不再写死 400**——否则 config.narratorAssistantChars > 400 时，文本在这里就被切掉，
            //   narrateSummary 根本拿不到超长部分，预算调大便无从生效。真正的预算在 prompt 侧施加。
            const aText = assistantMessageText(msg).trim()
            if (aText.length > 0) st.lastAssistantText = truncCps(aText, NARR_ASSIST_MAX_CPS)
            if (msgHasToolCall(msg, ['ask_user_question'])) {
              st.blocking = 'b2'
              narrate('block', { sid, variant: 'b2' })
            } else if (msgHasToolCall(msg, ['exit_plan_mode'])) {
              st.blocking = 'b3'
              narrate('block', { sid, variant: 'b3' })
            }
            if (msgHasGoalDoneCall(msg)) st.turnGoalDone = true
          }
          return
        }
        // assistant/chunk、step/*、todo/write 等其它事件：不开口
      } catch (e) {
        console.error('[sakiko] session/event 处理失败:', e && e.message ? e.message : String(e))
      }
    }))

    // ---------------- 旧零散播报收编（统一进 narrate 路由器） ----------------
    // 注：goal 完成由 session 事件流 goal/change + assistant/message 工具扫描置 turnGoalDone，
    //     turn/end 统一归一为 A3（goal）/DONE（普通）——goal/changed 是 agent 作用域事件，全局插件收不到，勿再依赖。
    // 子代理结束 → special A4-1；工作流完成/出错 → special A4-2/A4-3；后台任务结束 → special A4-4；agent/error → FAIL F1/F2
    // 多工作区（Task 1）：这些事件不带 sid → 落默认槽（defaultSlot），与任何会话的回合态/节流互不干扰；
    // 会话事件从不产生 special/fail 语义，故单会话下节奏与现状一致。
    // X5（任务 A）：`subagent/end` **仍不传 sid**（否则会挪进该会话的节流槽），但用 `info.id`（子代理会话 id）
    //   取归属 → 显式传 `bubblePrefix` + `label`（Minor-2：两者同源，气泡「〔label〕」与
    //   lastSpeaks[].label 不再自相矛盾），使气泡 CN 以「〔<label>〕」开头（谁结束了可听/可看）。
    //   仍受 multiSession 开关与 multiSessionPrefix 模式约束（复用 attributionFor）。
    // Task 10 Fix（僵尸回合，治根的一半）：`subagent/end` 是「该子代理会话的运行已经终结」的唯一外部信号，
    //   但它**不是** session/event 流里的 turn/end —— 两者是不同事件、不同处理器。改动前它只播一条 special
    //   旁白，一个字都没碰该会话的回合态 ⇒ 一个漏收 turn/end 的子代理会话会**永久 turnActive**：
    //   st.milestoneSpoken 一次性闸门时代它最多多播 1 条就沉默；周期制代码所在的树（`f3c4d30`；其后的 `c87d8a8` 只改了 docs+test，树里 host.mjs 与之逐字相同）之后就是每满
    //   narratorMilestoneMs 再播一条，永不停止（现场：某子代理 sid 无 done、339 条 milestone、间隔 120s）。
    //   这里把该会话的回合收掉，写法照**已有的「不播报的收尾」**（handleTurnEnd 的 skipKinds 分支）：
    //   `turnActive = false; turnEndedAt = Date.now()` —— 只这两行。
    //   · **刻意不调用 handleTurnEnd**：它会 narrate('done')（narratorDone 开时），与本处理器已有的
    //     special 同 tick 同槽撞车（同优先级取先入者 / 不同优先级只取最高）⇒ 会改变现有可听行为。
    //   · **刻意不清** lastMilestoneAt / lastMilestoneStep / milestoneSpoken / startSpoken / stepCount：
    //     理由**不是**「没人读」—— turnActive=false 时这些字段**照样有可达读者**，例如：
    //       `tool/call` 分支读 startSpoken/stepCount（那一段**没有** turnActive 门：掉队的 tool/call 会
    //         先 `stepCount += 1`，再按 `!startSpoken` 决定要不要 narrate('start')）；
    //       `handleTurnEnd` 读 turnGoalDone/lastUserText/lastAssistantText/toolNames/blocking（同样无门）；
    //       `narrateSummary` 经 stateFor 读 lastUserText/lastAssistantText/toolNames/blocking 组 prompt；
    //       `narratorStatus` 回显；`approval/decided`、`assistant/message` 读写 blocking。
    //     真正理由是**行为保全**：清了会改变这些掉队事件的可观测结果 ——
    //       清 startSpoken ⇒ subagent/end 之后一条没有 turn/start 的 tool/call 会多播一条假「开工了」（START）；
    //       清 lastUserText/lastAssistantText/toolNames/blocking ⇒ 之后真到的 turn/end 会拿到空快照，
    //         DONE 总结退化；清 turnGoalDone ⇒ A3（goal）会降级成 done。
    //     不清 = 与改动前**逐字一致**（改动前这里什么都不做），也与 skipKinds 那条先例同一处置。
    //     （差分实测：不清 ⇒ 该 sid 只多一条 special；清 ⇒ 多出 ['special','start']。测试 §(h) 钉住。）
    //   · 取不到注册记录（该 sid 未注册 / info.id 非字符串）⇒ 静默跳过，不抛、不凭空建档
    //     （**不回落默认槽**：那会把别的会话/单槽模式的回合一起收掉）。
    //   · 边界：本事件在 run 结算后发出 —— 已核的两个发射点都在结算之后（one-shot 见 dsh-subagent
    //     `observeRun` 的 `run.result.then`；常驻子代理见 `createActivationObserver.settle` 的 epoch 终结）
    //     ⇒ 这两个 in-process 路径上**不存在「回合仍在合法推进中」的正常路径**；
    //     ⚠ 限定：**out-of-process provider（`subprocessRunHandle`）与第三方 provider 未逐一证实** ——
    //     它们只要让 `run.result` 早于子会话最后一个 turn 结算，本收尾就会提前发生。
    //     即便被提前收掉，该会话之后又起新回合时 session/event 的 turn/start→resetTurn 会把 turnActive
    //     重新置真（自愈），代价是那一个回合的里程碑节奏被重置。
    //   · stopReason 取值**一视同仁**（上游词表见 dsh-subagent `SubagentStopReason`：
    //     `completed` / `aborted` / `error` / `max-tokens` / `refusal`，merge-extensible；
    //     注意 `interrupted` 是 **turn/end 的 reason.kind**，在 `epochStopReason` 里被映射成 `aborted`，
    //     不会作为 stopReason 出现）。全部代表该 run 已终结，只收回合态、不改上面的旁白分支
    //     （不按取值区别对待 —— 对 error 反而不收尾才会留下僵尸）。
    ctx.effect(() => ctx.on('subagent/end', (info) => {
      try {
        // A4-1 旁白的 opts 快照：**在动任何状态之前**算好（与改动前同一时刻、同一输入）。
        // 归属前缀经 subagentEndPrefix(info.id) → attributionFor → activeSessionCount（mode='auto' 时
        // 读各会话的回合态）。先算快照是**等价变换**（不是「保证」）：把本次收尾提前到算快照之前，
        // 结果也一样 —— 该 rec 若因此从「不活跃」变「刚收尾」，loop 里多一票，而 activeSessionCount
        // 的 includeSid 补记恰好少加一票（两条互为补集），总数不变；未注册 sid 则两支都不变。
        // 保持「先快照」只是让「旁白与回合态解耦」在代码里显式可见。
        const o = (info && info.stopReason) ? { variant: 'subagent' } : null
        if (o !== null) {
          const attr = subagentEndPrefix(info && typeof info.id === 'string' ? info.id : '')
          if (attr.prefix.length > 0) { o.bubblePrefix = attr.prefix; o.label = attr.label }
        }
        // 收掉该子代理会话的回合（不播报；取不到记录就跳过）
        const cid = (info && typeof info.id === 'string') ? info.id : ''
        if (cid.length > 0) {
          const rec = sessions.get(cid)
          if (rec !== undefined) {
            rec.state.turnActive = false
            rec.state.turnEndedAt = Date.now()
          }
        }
        // A4-1 旁白：条数与 opts 与改动前一致（仍不传 sid ⇒ 仍落默认槽、仍受同意图 8s 合并）
        if (o !== null) narrate('special', o)
      } catch (e) { /* ignore */ }
    }))

    ctx.effect(() => ctx.on('workflow/end', (info, result) => {
      try {
        narrate('special', { variant: (result && result.error) ? 'workflowErr' : 'workflowOk' })
      } catch (e) { /* ignore */ }
    }))

    ctx.effect(() => ctx.on('agent/error', (payload) => {
      try {
        if (payload && payload.error) narrate('fail', {})
      } catch (e) { /* ignore */ }
    }))

    const jobs = ctx.get('jobs')
    if (jobs !== undefined) {
      ctx.effect(() => jobs.onJobDone(() => {
        try { narrate('special', { variant: 'jobDone' }) } catch (e) { /* ignore */ }
      }))
    }

    // ---------------- 主动来电 / 空闲调度 ----------------
    ctx.effect(() => ctx.interval(() => {
      try { checkCalls() } catch (e) { /* ignore */ }
      try { checkIdle() } catch (e) { /* ignore */ }
      try { checkHum() } catch (e) { /* ignore */ }
    }, 300000))

    // 记忆兜底落盘（每 60 秒）
    ctx.effect(() => ctx.interval(() => {
      if (memory.history.length === 0 && memory.facts.length === 0) return
      try { scheduleSaveMemory() } catch (e) { /* ignore */ }
      try { scheduleSaveNarrator() } catch (e) { /* ignore */ }
    }, 60000))

    // 进度叙事：里程碑巡检（30s 独立 tick；遍历各活跃会话，各按自己的 lastMilestoneAt/lastMilestoneStep 判定；
    // 空闲会话（无 turnActive）在 maybeMilestone 内直接跳过；multiSession:false 时只有默认槽一项 = 现状行为）
    // Fix R2（Important-新-1）：本 tick **只读**——不做任何「陈旧回合收尾」清扫（那会破坏静默但仍在跑的回合）。
    // 陈旧 turnActive 的两处影响改由只读判据处理：auto 判定见 sessionCountsAsActive，淘汰见 sessionBlocksEviction。
    // Task 10 Fix（僵尸回合兜底）：候选会话**先过一遍** sessionCountsAsActive(rec, now)（现成判据，
    //   不新造阈值）—— turnActive 真、但注册记录已超过 NARR_AUTO_IDLE_MS 没有任何事件 ⇒ 按空闲处理、不播。
    //   治根的那一半在 `subagent/end` 处理器里（它现在会收掉该子代理会话的回合）；本过滤是兜底，
    //   覆盖「既没收到 turn/end、也没收到 subagent/end」的路径（如被中断/窗口中途关闭）。
    //   rec 为 null = 默认槽（没有注册记录）⇒ 不过滤，原样保留它现在的行为。
    function milestonePatrolTick() {
      let cands
      try { cands = activeRecords() } catch (e) { return }
      const now = Date.now()
      for (let i = 0; i < cands.length; i++) {
        const st = cands[i].st
        const candRec = cands[i].rec
        try {
          if (candRec !== null && !sessionCountsAsActive(candRec, now)) continue
          // Task 5：开关关闭时也要挡住「开关关之前就已注册」的子代理会话（否则巡检仍可能为其补播里程碑）
          // Fix R1（Minor-1）：除记录上的定格标记外，同时判 childSids —— 覆盖 descriptor 迟到时
          // 「记录先以 isSubagent=false 注册、随后 descriptor 才到达」的窗口（双保险）。
          if (config.narrateSubagents === false && typeof st.sid === 'string' && st.sid.length > 0) {
            const rec = sessions.get(st.sid)
            if ((rec !== undefined && rec.isSubagent === true) || childSids.has(st.sid)) continue
          }
          maybeMilestone(st)
        } catch (e) { /* ignore */ }
      }
    }

    ctx.effect(() => ctx.interval(() => { milestonePatrolTick() }, 30000))

    // 卸载插件时终止常驻 TTS worker
    ctx.effect(() => {
      return () => { teardownTtsWorker() }
    })

    // 语音服务：卸载时**延时**停止（热重载会在下面的「启动」段里取消这个定时器）。
    // 注意：拉起服务**不能**放在这里 —— 本 effect 在 apply() 里同步执行，而此时
    // ensureDataDirs().then(...) 里的 loadConfig() 还没跑完，config 仍是 DEFAULT_CONFIG，
    // voiceRoot 会是空串而被误判成「未配置」直接跳过（2026-09-13 实测踩中）。故放在启动段。
    ctx.effect(() => {
      return () => {
        // D9：只有**最新一代**实例才有权排这个队。热重载时新实例往往先 apply（voiceShared.epoch 已 +1），
        // 旧实例的 disposer 随后才执行 —— 此时绝不能排延时停止，否则 8s 后旧定时器会把新实例
        // 刚托管的服务杀掉（状态还会显示成 external，用户以为一切正常）。
        if (voiceShared.epoch !== myEpoch) {
          if (voiceShared.logSink) voiceShared.logSink('插件卸载：已有更新的实例接管（epoch ' + myEpoch + '→' + voiceShared.epoch + '），本实例不排延时停止')
          return
        }
        scheduleVoiceStop('插件卸载')
      }
    })

    // ---------------- 人格注入 ----------------
    if (systemPrompt !== undefined) {
      ctx.effect(() => systemPrompt.section({
        name: 'sakiko-persona',
        order: 500,
        text: () => (config.personaOn === true ? personaText : ''),
      }))
    }

    // ---------------- 启动 ----------------
    ensureDataDirs().then(() => {
      loadTimelineRecent().catch((e) => console.error('[sakiko] loadTimelineRecent:', e))
      loadConfig()
        .catch((e) => console.error('[sakiko] loadConfig:', e))
        .then(() => {
          // 必须在 loadConfig 之后：先取消上次卸载排队的停止动作（热重载场景），再按需拉起。
          // 不 await：启动最慢要一两分钟（加载模型），不能阻塞插件加载与 DSH 启动。
          cancelScheduledVoiceStop()
          void startVoiceServices('DSH 启动 / 插件加载')
        })
      loadNarrator().catch((e) => console.error('[sakiko] loadNarrator:', e))
      loadPersona().catch((e) => console.error('[sakiko] loadPersona:', e))
      loadMemory().then(() => {
        console.log('[sakiko] 记忆已加载:', memory.history.length, '条历史,', memory.facts.length, '条长期事实')
      }).catch((e) => console.error('[sakiko] loadMemory:', e))
    })
    // 预热常驻 TTS worker（后台拉起，首句即可复用；不支持时静默回退）
    ensureTtsWorker().catch((e) => console.warn('[sakiko] TTS worker 预热失败:', e && e.message ? e.message : String(e)))
    // 入口自检欢迎语：面板挂载后播报一次（仅语音开启时；announce 会留痕到对话区）。
    //
    // v2.2.0 改法（修「欢迎语稳定无声」）：**删掉固定 15 秒这一档**。
    //   旧写法 `ctx.timeout(..., 15000)` 是"无条件到点就播"，而语音链要 41~56s 才就绪
    //   （实测见 voice-autostart.log；四次启动全部 >15s），于是合成必然撞在桥没起来的窗口上。
    //   现在：这里只做一个**短的挂载延迟**（给面板 iframe 起来、开始 /sakiko/poll 的时间），
    //   「什么时候真能出声」交给 speakSynced 里的语音就绪闸门去等（waitVoiceReady）。
    //   队列是拉取式且**不丢**（host L4047：条目只在被 /sakiko/poll 取走时才从队列移除），
    //   所以延迟几秒不会丢欢迎语。
    //   为什么不用 ctx.timeout：它不返回可取消句柄，热重载后旧回调仍会跑（旧代码靠 startupGreetingSent
    //   自锁）；这里用普通 setTimeout + 句柄，disposer 能真正清掉它。定时器 unref() 掉，
    //   不拖住宿主进程退出。
    const STARTUP_GREETING_DELAY_MS = 8000
    let startupGreetingSent = false
    let startupGreetingTimer = setTimeout(() => {
      startupGreetingTimer = null
      ;(async () => {
        if (startupGreetingSent) return
        startupGreetingSent = true
        // voiceOn=false 不再单独分支：announce → speakSynced 会统一处理（跳过合成、仍然出气泡）。
        // 独立复审 C-3：旧分支的注释写着"立刻留痕 + 出气泡"，实际因 announce 内部提前 return 而只剩留痕。
        if (config.voiceOn === true && voiceShared.state.phase !== 'ready' && voiceShared.state.phase !== 'external') {
          console.log('[sakiko] 启动欢迎语：语音未就绪（phase=' + voiceShared.state.phase + '），等待就绪后再出声')
        }
        await announce(STARTUP_GREETING.jp, STARTUP_GREETING.cn, STARTUP_GREETING.emotion)
        console.log('[sakiko] 启动欢迎语已播报' + (config.voiceOn === true ? '' : '（voiceOn=false，仅气泡）') + ':', STARTUP_GREETING.jp)
      })().catch((e) => {
        console.error('[sakiko] 启动欢迎语失败:', e && e.message ? e.message : String(e))
      })
    }, STARTUP_GREETING_DELAY_MS)
    if (startupGreetingTimer && typeof startupGreetingTimer.unref === 'function') startupGreetingTimer.unref()
    ctx.effect(() => () => {
      // 卸载/热重载：清掉还没跑的欢迎语定时器（新一代实例会自己排一个）
      if (startupGreetingTimer !== null) { clearTimeout(startupGreetingTimer); startupGreetingTimer = null }
    })
    console.log('[sakiko] SAKIKO host 已就绪。配置:', JSON.stringify({ voiceOn: config.voiceOn, chatOn: config.chatOn, callOn: config.callOn, idleChatOn: config.idleChatOn }))
}