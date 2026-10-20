# A1 · airi「LLM 输出 → 立绘动作」标签解析链路（源码级取证）

> **取证方式**：`git clone --depth 1 https://github.com/moeru-ai/airi.git /tmp/airi`（933 MB，通道 = **git 协议**，非 HTTP 抓取）。
> **取证时间**：2026-09-24
> **commit**：`eeea3a1a5a061a33da076574ef5830f81a43392b`（`Thu Sep 24 03:28:59 2026 +0800`，subject: `fix(stage-tamagotchi): correct island dock and simplify chat controls (#2649)`）
> **纪律**：路径与行号均为本地 clone 真实行号；引句逐字抄录。凡我的概括另标「概括」。

---

## 0. 🔴 首要发现：DeepWiki 索引已过期，且仓库里存在**两套语法不同的 ACT 解析器**

任务书给的线索来自 DeepWiki（索引于 commit `c1d23081`）。**本次 clone 的 commit 是 `eeea3a1a`，仓库已重构**：

| DeepWiki 线索 | 本次源码实况 |
|---|---|
| `stage-ui-live2d/.../live2d/Model.vue` 注册多个 motion update plugin | `packages/stage-ui-live2d/` 确实存在，但**目录结构已变**；另有独立的 `packages/model-driver-*` 一族新包 |
| 标签解析在 stage-ui | **解析器已下沉到 `packages/pipelines-audio/` 与 `packages/core-agent/`**（见下） |

**并且——这是本轮最要紧的一条——仓库里同时存在两套 ACT 语法，互不兼容：**

| # | 位置 | 前缀常量 | 接受的语法 |
|---|---|---|---|
| ① | `packages/pipelines-audio/src/llm-streaming-control/parsers/act.ts:3` | `'<|ACT '`（**ACT 后跟空格**） | `<|ACT {...}|>` |
| ② | `packages/stage-ui/src/composables/queues.ts:25` | 正则 `/<\|ACT\s*(?::\s*)?(\{[\s\S]*\})\|>/i` | `<|ACT {...}|>` **或** `<|ACT: {...}|>` |

→ **①是带空格的正规形式，②额外容忍冒号**。两套并存说明 airi 自己也在演进期；**我们要抄的是哪一套，必须先选**（本报告 §3 给建议）。

---

## 1. 第一层：把原始流切成「literal」与「special」

**文件**：`packages/core-agent/src/runtime/llm-marker-parser.ts`

**常量（第 1–4 行，逐字）**：

```ts
const TAG_OPEN = '<|'
const TAG_CLOSE = '|>'
const ESCAPED_TAG_OPEN = '<{\'|\'}'
const ESCAPED_TAG_CLOSE = '{\'|\'}>'
```

**转义还原（第 81–83 行，逐字）**：

```ts
      buffer += textPart
      buffer = buffer
        .replaceAll(ESCAPED_TAG_OPEN, TAG_OPEN)
        .replaceAll(ESCAPED_TAG_CLOSE, TAG_CLOSE)
```

> **概括**：模型若需要**字面输出** `<|`，写 `<{'|'}`；解析器先还原成 `<|` —— 但还原发生在**切分之前**，所以转义写法**保护不了**自己（见 §6 反证）。

**核心状态机（第 85–114 行，逐字节选）**：

```ts
      while (buffer.length > 0) {
        if (!inTag) {
          const openTagIndex = buffer.indexOf(TAG_OPEN)
          if (openTagIndex < 0) {
            if (buffer.length - tailLength >= minLiteralEmitLength) {
              const emit = buffer.slice(0, -tailLength)
              buffer = buffer.slice(-tailLength)
              await onLiteral(emit)
            }
            break
          }

          if (openTagIndex > 0) {
            const emit = buffer.slice(0, openTagIndex)
            buffer = buffer.slice(openTagIndex)
            await onLiteral(emit)
          }
          inTag = true
        }
        else {
          const closeTagIndex = buffer.indexOf(TAG_CLOSE)
          if (closeTagIndex < 0)
            break

          const emit = buffer.slice(0, closeTagIndex + TAG_CLOSE.length)
          buffer = buffer.slice(closeTagIndex + TAG_CLOSE.length)
          await onSpecial(emit)
          inTag = false
        }
      }
```

**保留尾部长度的计算（第 74 行，逐字）**：

```ts
  const tailLength = Math.max(TAG_OPEN.length - 1, ESCAPED_TAG_OPEN.length - 1)
```

> **概括（重要工程细节）**：`tailLength` 保证**跨 chunk 边界的 `<|` 不会被误当普通文本吐出**——未闭合时最多只吐 `buffer.slice(0, -tailLength)`，把可能构成标签开头的尾巴留在缓冲里。这是流式解析必须处理的问题（我们要复用）。

**对外 API（第 171–184 行，逐字签名）**：

```ts
export function useLlmmarkerParser(options: {
  onLiteral?: (literal: string) => void | Promise<void>
  onSpecial?: (special: string) => void | Promise<void>
  onEnd?: (fullText: string) => void | Promise<void>
  minLiteralEmitLength?: number
})
```

**消费与收尾（第 203–216 行，逐字）**：

```ts
    async consume(textPart: string) {
      fullText += textPart
      write(textPart)
    },

    async end() {
      close()
      await processing
      await options.onEnd?.(fullText)
    },
```

---

## 2. 第二层：special token → 结构化信号

**文件**：`packages/pipelines-audio/src/llm-streaming-control/controller.ts`
**工厂函数**：`createStreamingControlParser`（第 42 行）

**默认 parser 注册（第 50–54 行，逐字）**：

```ts
  const parsers = options.parsers ?? [
    tokenAct(),
    tokenDelay(),
    tokenCall(),
  ]
```

**匹配是「第一个 match 的就赢」（第 62–64 行，逐字）**：

```ts
  function findParser(input: string) {
    return parsers.find(parser => parser.match(input))
  }
```

**派发主流程（第 145–178 行，逐字节选）**：

```ts
    async dispatchWith(special, context) {
      const parser = findParser(special)

      if (!parser) {
        emit(context, {
          reason: 'no-matching-parser',
          type: 'rejected',
        })

        return false
      }

      const parsed = parser.parse(special)

      if (!parsed) {
        emit(context, {
          parserName: parser.name,
          reason: 'parse-failed',
          type: 'rejected',
        })

        return false
      }
```

> **概括（可直接照抄的设计）**：`dispatchWith` 返回 `true` 表示「这个 special 我认领了」，返回 `false` 表示「不认识，交给别的处理器」。**这是一个干净的插件化扩展点**——我们完全可以照这个形状设计。

### 2.1 ACT parser 逐字

**文件**：`packages/pipelines-audio/src/llm-streaming-control/parsers/act.ts`

```ts
const actTokenPrefix = '<|ACT '       // 第 3 行
const markerSuffix = '|>'             // 第 4 行
```

```ts
    match(special) {                                          // 第 25–28 行
      const trimmed = special.trim()
      return trimmed.startsWith(actTokenPrefix) && trimmed.endsWith(markerSuffix)
    },
    parse(special) {                                          // 第 29–49 行
      const trimmed = special.trim()
      const rawPayload = trimmed.slice(actTokenPrefix.length, -markerSuffix.length).trim()

      let parsed: unknown
      try {
        parsed = JSON.parse(rawPayload)
      }
      catch {
        return undefined
      }

      if (!isPlainObject(parsed)) {
        return undefined
      }

      return {
        type: 'act',
        payload: parsed,
      }
    },
```

> **注意**：ACT 的 `parse` **只做 JSON 解析与「是对象」校验，完全不校验 emotion 名**。校验在下一层（§2.3）。

### 2.2 DELAY parser 逐字

**文件**：`packages/pipelines-audio/src/llm-streaming-control/parsers/delay.ts`

```ts
const delayTokenPrefix = '<|DELAY '     // 第 3 行
```

```ts
    parse(special) {                                          // 第 25–41 行
      const trimmed = special.trim()
      const rawPayload = trimmed.slice(delayTokenPrefix.length, -markerSuffix.length).trim()
      if (!/^\d+(?:\.\d+)?$/.test(rawPayload)) {
        return undefined
      }

      const seconds = Number.parseFloat(rawPayload)
      if (!Number.isFinite(seconds) || seconds <= 0) {
        return undefined
      }

      return {
        type: 'delay',
        seconds,
      }
    },
```

> **🔴 语法不一致警告**：正规解析器要求 `<|DELAY 1|>`（**空格**），而 `queues.ts:70/77` 的正则是 `/<\|DELAY:(\d+)\|>/i`（**冒号 + 仅整数**）。**两套真的不一样。**

### 2.3 情绪白名单与强度归一化（这是「情绪→立绘」的关键约束）

**文件**：`packages/pipelines-audio/src/llm-streaming-control/payloads.ts`

**白名单（第 6–16 行，逐字）**：

```ts
const emotionValues = [
  'happy',
  'sad',
  'angry',
  'think',
  'surprised',
  'awkward',
  'question',
  'curious',
  'neutral',
] as const
```

**强度归一化（第 62–75 行，逐字）**：

```ts
function normalizeIntensity(value: unknown): number {
  const numeric
    = typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN

  if (!Number.isFinite(numeric)) {
    return 1
  }

  return Math.max(0, Math.min(1, numeric))
}
```

**情绪解析支持三种输入形态（第 85–121 行，逐字节选）**：

```ts
function normalizeEmotion(
  value: unknown,
): StreamingControlEmotionPayload | undefined {
  if (typeof value === 'string') {
    const name = normalizeEmotionName(value)

    return name
      ? {
          name,
          intensity: 1,
        }
      : undefined
  }
  ...
  const name
    = typeof normalizedValue.name === 'string'
      ? normalizeEmotionName(normalizedValue.name)
      : undefined

  if (!name) {
    return undefined
  }

  return {
    name,
    intensity: normalizeIntensity(normalizedValue.intensity),
  }
}
```

**归一化后的对外结构（第 30–35 行，逐字）**：

```ts
export interface NormalizedActPayload {
  /** Emotion request emitted by the model, when present and supported. */
  emotion?: StreamingControlEmotionPayload
  /** Motion cue emitted by the model, when present. */
  motion?: string
}
```

> **概括**：`motion` 字段**不做白名单校验**（第 128–138 行只 trim + 非空判断）——即 motion 名是**自由字符串**，由渲染层自行匹配。**这是 airi 的弱点，也是我们要改进的点**（见 §3 能力发现层）。

### 2.4 CALL parser（airi 的「工具化」通道，对我们的相位机最有参考价值）

**文件**：`packages/pipelines-audio/src/llm-streaming-control/parsers/call.ts`

```ts
const callTokenPrefix = '<|CALL '       // 第 7 行
```

```ts
    parse(special) {                                          // 第 81–111 行
      ...
      if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 2) {
        return undefined
      }

      const [name, payload] = parsed
      if (typeof name !== 'string' || name.trim().length === 0) {
        return undefined
      }

      if (payload !== undefined && !isPlainObject(payload)) {
        return undefined
      }

      return {
        type: 'call',
        name: name.trim(),
        payload,
      }
    },
```

**模型侧指令是「从注册表自动渲染」的（第 37–60 行，逐字节选）**：

```ts
export function renderCallManifestPrompt(manifests: LlmStreamingControlCallManifest[]) {
  if (manifests.length === 0) {
    return ''
  }

  const lines = [
    'Available streaming CALL tokens:',
    'Use these only as text special tokens when the matching plugin action is needed.',
    'Syntax: <|CALL ["call.name"]|> or <|CALL ["call.name", {"key":"value"}]|>.',
    'Never write provider tool names inside <|CALL ...|>.',
    'Never write JSON payload after the closing |>; all payload data belongs inside the JSON array.',
    '',
  ]

  for (const manifest of manifests) {
    lines.push(`- ${manifest.name}: ${manifest.prompt}`)
    lines.push('  Examples:')
    for (const example of renderCallManifestExamples(manifest)) {
      lines.push(`  - ${example}`)
    }
  }

  return lines.join('\n')
}
```

> **🔴 这一条对我们价值最高**：airi 的 CALL **不是一个写死的表**，而是 `manifest`（name + prompt + examples）**注册进去、自动渲染成模型指令**。manifest 的注释逐字写着（`types.ts:57–62`）：
>
> ```
>  * The manifest is registered with the callback so the runtime can render
>  * few-shot instructions from the same source of truth that executes the call.
> ```
>
> **「同一份真源既渲染指令又执行回调」= 我们要的「能力发现层」的现成范式**（见设计 §3）。CALL 的 handler 注册/注销（`controller.ts:425–457`）还带**引用计数清理**：handler 集合空了就同时删 manifest，保证 prompt 里不会出现「模型被告知有、实际没人接」的幽灵动作。

---

## 3. 第三层：stage-ui 侧的另一套解析（含冒号容忍）

**文件**：`packages/stage-ui/src/composables/queues.ts:24–53`（逐字）

```ts
  function parseActEmotion(content: string) {
    const match = /<\|ACT\s*(?::\s*)?(\{[\s\S]*\})\|>/i.exec(content)
    if (!match)
      return { ok: false, emotion: null as EmotionPayload | null }

    const payloadText = match[1]
    try {
      const payload = JSON.parse(payloadText) as { emotion?: unknown }
      const emotion = payload?.emotion
      if (typeof emotion === 'string') {
        const normalized = normalizeEmotionName(emotion)
        if (normalized)
          return { ok: true, emotion: { name: normalized, intensity: 1 } }
      }
      else if (emotion && typeof emotion === 'object' && !Array.isArray(emotion)) {
        if ('name' in emotion && typeof (emotion as { name?: unknown }).name === 'string') {
          const normalized = normalizeEmotionName((emotion as { name: string }).name)
          if (normalized) {
            const intensity = normalizeIntensity((emotion as { intensity?: unknown }).intensity)
            return { ok: true, emotion: { name: normalized, intensity } }
          }
        }
      }
    }
    catch (e) {
      console.warn(`[parseActEmotion] Failed to parse ACT payload JSON: "${payloadText}"`, e)
    }

    return { ok: false, emotion: null as EmotionPayload | null }
  }
```

**DELAY 侧（`queues.ts:68–100`，逐字节选）**：

```ts
  function splitDelays(content: string) {
    if (!(/<\|DELAY:\d+\|>/i.test(content))) {
      return {
        ok: false,
        delay: 0,
      }
    }

    const delayExecArray = /<\|DELAY:(\d+)\|>/i.exec(content)
```

**延迟的实际执行（`queues.ts:102–112`，逐字）**：

```ts
  return createQueue<string>({
    handlers: [
      async (ctx) => {
        const { ok, delay } = splitDelays(ctx.data)
        if (ok) {
          ctx.emit('delay', delay)
          await sleep(delay * 1000)
        }
      },
    ],
  })
```

> **概括**：DELAY 的实现就是 **`await sleep(秒 × 1000)` 阻塞在队列 handler 里** —— 靠**串行队列**达成时序同步，没有任何时间轴调度器。这个做法很朴素，但**在有 TTS 的场合够用**（因为音频播放本身也要排队）；**在我们「无 TTS、纯文字」的场合，它等价于「让文字一条条慢慢出」，未必是我们想要的**（见设计 §4 讨论）。

---

## 4. 「情绪 → 后端」的映射表在哪？

DeepWiki 说「把情绪映射到 Live2D motion 名 / VRM expression key / Spine 动画名」。**本次要在源码里找到那张表。**

`emotionValues`（payloads.ts）只是**白名单**，不是映射表。真正的映射在**各渲染后端自己的包**里（`stage-ui-live2d` / `stage-ui-three` / `stage-ui-spine`）。

→ 见证据文件 `A2_airi_Live2D驱动层.md`（下一份，正在取证）。
→ 见证据文件 `A3_airi_motion_driver与能力发现.md`。

---

## 5. 本节的「二手索引 vs 源码核实」清单

| 说法（来自 DeepWiki 线索） | 本次核实结果 |
|---|---|
| 从 LLM 文本流解析 `<|ACT ... |>`，支持简单情绪名与带强度 JSON | ✅ **源码确认**（act.ts + payloads.ts，两种形态都实现了） |
| 强度归一化 0–1 | ✅ **源码确认**（`Math.max(0, Math.min(1, numeric))`，非法值回退 1） |
| 解析 `<|DELAY:seconds|>` | ⚠️ **部分不符**：正规 parser 是 `<|DELAY 秒|>`（**空格**），`<|DELAY:秒|>` 只存在于 `queues.ts` 的宽松正则里 |
| 情绪映射到 motion 名 / VRM expression / Spine 动画名 | ⏳ **待核实**（见 A2/A3） |
| `Model.vue` 里注册多个 motion update plugin | ⏳ **待核实**（路径已变，见 A2） |
| Beat Sync（音频节拍 → `angleX/Y/Z`） | ⏳ **待核实** |
| MediaPipe 面部追踪反馈进 LLM | ⏳ **待核实** |
| `live2dStore.availableMotions` | ⏳ **待核实** |

---

## 6. 反证 / 坑（本节已可确认的）

1. **两套语法并存**（§0 表）——照抄时**必须选一套**，否则模型写 `<|DELAY:1|>` 而正规 parser 不认（`match` 要求 `'<|DELAY '` 空格开头）→ 静默走 `no-matching-parser` 分支，**只在 observer 里留一条事件，用户看不出任何异常**。
2. **解析失败是静默的**。`dispatchWith` 失败只 `emit(...)` 观测事件（`controller.ts:149–166`），**不抛错、不打断流**。→ 对我们：**标签写错 = 立绘不动，且没有任何报错**。必须自己加「解析失败计数」的可观测性。
3. **转义顺序有洞**：`ESCAPED_TAG_OPEN` 在切分前就被还原成 `<|`（第 82–83 行），因此**模型无法通过转义来输出字面 `<|`**——还原后立刻被当标签开头。→ 概括：**转义机制看起来是想解决这个问题，实际顺序反了**。这是 airi 的既有 bug 风险，**我们设计时要避开**（或直接不提供转义，见设计 §3）。
4. **`minLiteralEmitLength` 默认 1**（第 73 行 `?? 1`）→ 逐字符吐字。配合 DELAY 的 `sleep` 实现，**「视觉时序」实际是「文字流被 sleep 卡住」**，不是独立的动作时间轴。
