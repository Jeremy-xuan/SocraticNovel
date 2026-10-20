# A2 · airi 的 Live2D 驱动层（多插件分层 / 优先级 / 嘴型 / 能力发现）

> **取证方式**：`git clone --depth 1 https://github.com/moeru-ai/airi.git /tmp/airi`（git 协议通道）
> **commit**：`eeea3a1a5a061a33da076574ef5830f81a43392b`
> **取证时间**：2026-09-24

---

## 1. 🔴 多插件的注册与优先级（任务书点名要的「怎么排的」）

**文件**：`packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue:435–462`（逐字）

```ts
    motionManagerUpdate.register(useMotionUpdatePluginBeatSync(beatSync), 'pre')
    motionManagerUpdate.register(useMotionUpdatePluginIdleDisable(), 'pre')
    motionManagerUpdate.register(useMotionUpdatePluginIdleFocus(), 'post')
    // Both run in 'final' stage (ignores handled state).
    // Expression first: sets desired parameter values (e.g. closed eyes = 0).
    // Blink second: reads post-expression eye values, Multiply-modulates on top.
    // This ensures blink respects expression state (0 × blinkFactor = 0).
    motionManagerUpdate.register(useMotionUpdatePluginExpression(expressionController), 'final')
    motionManagerUpdate.register(useMotionUpdatePluginAutoEyeBlink(live2dExpressionEnabled), 'final')
    // After the blink plugin, so that it only narrows the value a blink returns
    // to. The signal is the light behind the character, not the screen level:
    // that is a mean over the whole capture, and a bright window opening in a
    // far corner would otherwise reach the eyes.
    motionManagerUpdate.register(
      useMotionUpdatePluginLightSquint(
        () => ambientLightPerceptualLevel(screenAmbientLightEnvironment.value.behindLuminance),
        () => (screenAmbientLightActive.value ? screenAmbientLightSquint.value : 0),
      ),
      'final',
    )
    motionManagerUpdate.register(useMotionUpdatePluginManualControl(manualMotionControl, manualMotionSpring), 'final')
    motionManagerUpdate.register(useMotionUpdatePluginLipSync(mouthOpenSize, nowSpeaking), 'final')
    motionManagerUpdate.register(useMotionUpdatePluginBreathControl(manualBreathControl), 'final')

    const hookedUpdate = motionManager.update as (model: PixiLive2DInternalModel['coreModel'], now: number) => boolean
    motionManager.update = function (model: PixiLive2DInternalModel['coreModel'], now: number) {
      return motionManagerUpdate.hookUpdate(model, now, hookedUpdate)
    }
```

### 1.1 三档优先级的实现（逐字）

**文件**：`packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts:113–179`

```ts
  const prePlugins: MotionManagerPlugin[] = []
  const postPlugins: MotionManagerPlugin[] = []
  const finalPlugins: MotionManagerPlugin[] = []

  function register(plugin: MotionManagerPlugin, stage: 'pre' | 'post' | 'final' = 'pre') {
    if (stage === 'pre')
      prePlugins.push(plugin)
    else if (stage === 'final')
      finalPlugins.push(plugin)
    else
      postPlugins.push(plugin)
  }

  function runPlugins(plugins: MotionManagerPlugin[], ctx: MotionManagerPluginContext) {
    for (const plugin of plugins) {
      if (ctx.handled)
        break
      plugin(ctx)
    }
  }
```

```ts
    runPlugins(prePlugins, ctx)

    if (!ctx.handled && ctx.hookedUpdate) {
      const result = ctx.hookedUpdate.call(motionManager, model, now)
      if (result)
        ctx.handled = true
    }

    runPlugins(postPlugins, ctx)

    // Final plugins always run regardless of handled state (e.g. expression overrides)
    for (const plugin of finalPlugins) {
      plugin(ctx)
    }

    lastUpdateTime.value = now
    return ctx.handled
  }
```

### 1.2 三条叠加规则（**这是我们要照抄的核心机制**）

| 档位 | 语义（源码依据） | 短路行为 |
|---|---|---|
| `pre` | 在 SDK 原生 motion update **之前**跑 | **`handled=true` 即 break**（第 128–130 行）；若 pre 阶段就 handled，则**跳过 SDK 原生 update**（第 164 行 `if (!ctx.handled && ctx.hookedUpdate)`） |
| （中间）| **SDK 原生 `motionManager.update`** | 返回 true 则 `handled = true`（第 165–168 行） |
| `post` | 在 SDK 原生 update **之后**跑 | **同样受 `handled` 短路**（复用 `runPlugins`） |
| `final` | **无视 `handled`，永远执行**（第 172–175 行注释逐字：`Final plugins always run regardless of handled state (e.g. expression overrides)`） | 不短路，按注册顺序依次执行 |

**`handled` 的产生与消费（逐字）**：

```ts
  isIdleMotion: boolean
  handled: boolean
  markHandled: () => void
```
（`MotionManagerPluginContext`，第 42–44 行）

```ts
      handled: false,
      markHandled: () => {
        ctx.handled = true
      },
```
（第 156–159 行）

> **概括 → 我们的设计含义**：
> - `pre` / `post` 是**「抢占式」**通道（谁先 `markHandled` 谁就终止后面的），适合**互斥的事件层**（一次性动作）。
> - `final` 是**「后写覆盖式」**通道（永不短路），适合**持续状态层**（表情、眨眼、嘴型、呼吸）——后注册的覆盖先注册的。
> - **注册顺序 = 覆盖优先级**。airi 的注释明确解释了为什么 Expression 必须在 Blink 之前（第 438–441 行）：Expression 先写目标值，Blink 再**乘性**调制，这样「闭眼表情 × 眨眼系数 = 0」仍然闭着。
>
> 🔴 **我们直接沿用这套三档语义**，因为它正好对应我们需要的「基础层 / 状态层 / 事件层」（见设计 §4）。

### 1.3 一个必须注意的副作用

`motionManager.update` 被**整体替换**成 wrapper（第 459–462 行），并且 AIRI 还**删掉了 SDK 自带的呼吸**（`disableLive2DSdkBreath`，`motion-manager.ts:67–69` 逐字）：

```ts
export function disableLive2DSdkBreath(internalModel: { breath?: unknown }) {
  delete internalModel.breath
}
```

> **概括**：AIRI 的思路是**「把 SDK 自带的自动行为全部摘掉，改用自己可控的插件重做」**——呼吸如此（用自己的 `ParamBreath` 曲线），眨眼也如此（`useMotionUpdatePluginAutoEyeBlink`）。
> **对我们的意义**：如果我们只想"最小可用"，可以**先不摘** SDK 自带行为（呼吸/眨眼白送），只在 `final` 档追加我们自己的状态层。**这是 airi 与我们的一个合理分歧点**（见设计 §4）。

---

## 2. 嘴型（LipSync）：**唯一与音频强耦合的一层，且接口极窄**

### 2.1 渲染侧插件（只做「写参数 + 收尾混合」）

**文件**：`packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts:751–800`（逐字）

```ts
export function useMotionUpdatePluginLipSync(
  mouthOpenSize: Ref<number>,
  nowSpeaking: Ref<boolean>,
): MotionManagerPlugin {
  // 200 ms covers a typical phoneme tail without lagging behind the next utterance.
  const RELEASE_DURATION_MS = 200
  // After the release tail, keep forcing the mouth shut for this long before
  // handing control back to motion/expression plugins. This guarantees the
  // mouth actually closes even on the first idle frame, where a non-zero
  // resting motion curve would otherwise reopen it immediately.
  const HANDOFF_HOLD_MS = 500

  let releaseRemainingMs = 0
  let handoffRemainingMs = 0
  let lastForcedValue = 0

  // Smoothstep: 3t^2 - 2t^3, eases in/out with zero slope at endpoints.
  const smoothstep = (t: number) => t * t * (3 - 2 * t)

  return (ctx) => {
    if (nowSpeaking.value) {
      lastForcedValue = mouthOpenSize.value
      releaseRemainingMs = RELEASE_DURATION_MS
      handoffRemainingMs = HANDOFF_HOLD_MS
      ctx.model.setParameterValueById('ParamMouthOpenY', mouthOpenSize.value)
      return
    }

    if (releaseRemainingMs <= 0) {
      if (handoffRemainingMs > 0) {
        // Release tail elapsed. Keep forcing the mouth shut through the handoff
        // hold so a non-zero idle motion curve cannot reopen it on the first
        // idle frame. After the hold we stop owning the parameter and let
        // motion/expression plugins drive it again.
        handoffRemainingMs = Math.max(0, handoffRemainingMs - ctx.timeDelta * 1000)
        ctx.model.setParameterValueById('ParamMouthOpenY', 0)
      }
      return
    }

    releaseRemainingMs = Math.max(0, releaseRemainingMs - ctx.timeDelta * 1000)
    const blend = smoothstep(1 - releaseRemainingMs / RELEASE_DURATION_MS)

    // ParamMouthOpenY was already written by motion + expression plugins this frame.
    const motionValue = ctx.model.getParameterValueById('ParamMouthOpenY') as number
    const blended = lastForcedValue * (1 - blend) + motionValue * blend

    ctx.model.setParameterValueById('ParamMouthOpenY', blended)
  }
}
```

**🔴 这条对我们最关键**：整个嘴型插件只依赖**两个外部输入**：

```ts
  mouthOpenSize: Ref<number>      // 0–1 的开口量
  nowSpeaking: Ref<boolean>       // 是否正在说话
```

**参数名是硬编码的字符串 `'ParamMouthOpenY'`**（第 775、786、795、798 行）。

> **概括 → 我们的替代方案（这是本轮最实用的一条结论）**：
> **我们不需要改这个插件。** 只要写一个「文本节奏驱动」的小模块，产出同样形状的 `mouthOpenSize` + `nowSpeaking` 两个信号，就能**原样插进 `final` 档**，得到不依赖音频的嘴型。
> 具体怎么由文字产生这两个信号 = **我们相对 airi 的自研点**（airi 全部嘴型信号都来自 `wlipsync` 音频分析，见 §2.2，**无音频路径在 airi 里不存在**）。

### 2.2 音频侧的驱动（airi 唯一路径 = 音频）

**文件**：`packages/model-driver-lipsync/src/live2d/index.ts`

**逐字（第 5–14 行）**：

```ts
const RAW_KEYS = ['A', 'E', 'I', 'O', 'U', 'S'] as const
const RAW_TO_VOWEL: Record<typeof RAW_KEYS[number], VowelKey> = {
  A: 'A',
  E: 'E',
  I: 'I',
  O: 'O',
  U: 'U',
  // Treat S as silence/closed; map to a small I-like mouth to avoid a hard snap
  S: 'I',
}
```

**逐字（第 91–107 行）**：

```ts
  const getVowelWeights = (): Record<VowelKey, number> => {
    const projected: Record<VowelKey, number> = { A: 0, E: 0, I: 0, O: 0, U: 0 }
    const amp = Math.min((node.volume ?? 0) * volumeScale, 1) ** volumeExponent

    for (const raw of RAW_KEYS) {
      const vowel = RAW_TO_VOWEL[raw]
      const rawVal = node.weights?.[raw] ?? 0
      projected[vowel] = Math.max(projected[vowel], Math.min(cap, rawVal * amp))
    }

    return projected
  }

  const computeMouthOpen = () => {
    const weights = Object.values(getVowelWeights())
    return weights.length ? Math.max(...weights) : 0
  }
```

**默认参数（第 78–82 行，逐字）**：

```ts
  const cap = options.cap ?? 0.7
  const volumeScale = options.volumeScale ?? 0.9
  const volumeExponent = options.volumeExponent ?? 0.7
  const mouthUpdateIntervalMs = options.mouthUpdateIntervalMs ?? 40
  const mouthLerpWindowMs = options.mouthLerpWindowMs ?? 120
```

**平滑（第 116–127 行，逐字）**：

```ts
  const getSmoothedMouthOpen = (timestamp: number) => {
    if (lastSmoothedMs === 0 || mouthLerpWindowMs <= 0) {
      smoothedMouthOpen = lastRawMouthOpen
      lastSmoothedMs = timestamp
      return smoothedMouthOpen
    }

    const alpha = Math.min(1, (timestamp - lastSmoothedMs) / mouthLerpWindowMs)
    smoothedMouthOpen += (lastRawMouthOpen - smoothedMouthOpen) * alpha
    lastSmoothedMs = timestamp
    return smoothedMouthOpen
  }
```

**依赖声明（`packages/model-driver-lipsync/src/live2d/index.ts:1–3`，逐字）**：

```ts
import type { Profile } from 'wlipsync'

import { createWLipSyncNode } from 'wlipsync'
```

> **🔴 适用前提（任务书要求逐条给）**：
> 1. **必须有音频**。整条链路基于 `AudioWorkletNode`（`wlipsync`）+ 音量 + 元音权重。
> 2. **必须能拿到一个 AudioNode 源**（`connectSource`）。
> 3. **`cap = 0.7` 是刻意的**：注释逐字 `Defaults to 0.7 to keep Live2D mouth movement natural` —— 即**嘴不会张满**，这是"自然"的取舍。
> 4. 元音只有 5 个（AEIOU），`S` 被并入 `I`（第 12–13 行注释：`Treat S as silence/closed; map to a small I-like mouth to avoid a hard snap`）。
> 5. **不依赖前端框架**（纯 `AudioContext` + worklet），**但依赖 `wlipsync` 这个第三方包**。
>
> → **对我们**：第 1、2 条我们**不满足**（无 TTS）。所以 **airi 的音频嘴型链路我们整段不借**，只借 §2.1 那个**只吃两个标量的插件**。

---

## 3. 能力发现层（Capability Discovery）：**发现是真的，但没喂给 LLM**

### 3.1 从已加载模型里提取动作清单（逐字）

**文件**：`packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue:364–377`

```ts
const internalModel = model.value.internalModel
const coreModel = internalModel.coreModel
const motionManager = internalModel.motionManager
disableLive2DSdkBreath(internalModel)
coreModel.setParameterValueById('ParamMouthOpenY', mouthOpenSize.value)

availableMotions.value = Object
.entries(motionManager.definitions)
.flatMap(([motionName, definition]) => (definition?.map((motion: any, index: number) => ({
motionName,
motionIndex: index,
fileName: motion.File,
})) || []))
.filter(Boolean)
```

> **概括**：`availableMotions` **确实是从已加载模型的 `motionManager.definitions` 动态提取的**（不是读 `model3.json` 文本，而是读 `pixi-live2d-display` 解析后的运行时结构）。
> **注意**：这行代码执行时，模型**已经加载完成**（`await Live2DFactory.setupLive2DModel(...)` 在第 335 行）。

**存储定义（`packages/stage-ui-live2d/src/stores/model-parameters.ts:63`，逐字）**：

```ts
  const availableMotions = useLocalStorageManualReset<{ motionName: string, motionIndex: number, fileName: string }[]>('settings/live2d/available-motions', () => [])
```

→ 类型是 `{ motionName, motionIndex, fileName }[]`，**持久化到 localStorage**。

### 3.2 🔴 关键矛盾：发现出来的清单**没有喂给 LLM**，喂给 LLM 的是一张**静态表**

**喂给 LLM 的那份（`packages/stage-ui/src/composables/use-airi-runtime-prompt.ts`，全文 29 行，逐字核心）**：

```ts
import { EMOTION_EmotionMotionName_value, EMOTION_VALUES } from '../constants/emotions'
...
    return [
      t('base.prompt.emotion'),
      EMOTION_VALUES
        .map(emotion => `- ${emotion} (Emotion for feeling ${EMOTION_EmotionMotionName_value[emotion]})`)
        .join('\n'),
      t('base.prompt.suffix'),
      t('base.prompt.emoji'),
    ].join('\n\n')
```

**它引用的静态表（`packages/stage-ui-live2d/src/constants/emotions.ts:15–35`，逐字）**：

```ts
export const EmotionHappyMotionName = 'Happy'
export const EmotionSadMotionName = 'Sad'
export const EmotionAngryMotionName = 'Angry'
export const EmotionAwkwardMotionName = 'Awkward'
export const EmotionThinkMotionName = 'Think'
export const EmotionSurpriseMotionName = 'Surprise'
export const EmotionQuestionMotionName = 'Question'
export const EmotionNeutralMotionName = 'Idle'
export const EmotionCuriousMotionName = 'Curious'

export const EMOTION_EmotionMotionName_value = {
  [Emotion.Happy]: EmotionHappyMotionName,
  [Emotion.Sad]: EmotionSadMotionName,
  [Emotion.Angry]: EmotionAngryMotionName,
  [Emotion.Think]: EmotionThinkMotionName,
  [Emotion.Surprise]: EmotionSurpriseMotionName,
  [Emotion.Awkward]: EmotionAwkwardMotionName,
  [Emotion.Question]: EmotionQuestionMotionName,
  [Emotion.Neutral]: EmotionNeutralMotionName,
  [Emotion.Curious]: EmotionCuriousMotionName,
}
```

**VRM 的映射表（同文件第 37–47 行，逐字）**：

```ts
export const EMOTION_VRMExpressionName_value = {
  [Emotion.Happy]: 'happy',
  [Emotion.Sad]: 'sad',
  [Emotion.Angry]: 'angry',
  [Emotion.Think]: undefined,
  [Emotion.Surprise]: 'surprised',
  [Emotion.Awkward]: undefined,
  [Emotion.Question]: undefined,
  [Emotion.Neutral]: undefined,
  [Emotion.Curious]: 'surprised',
} satisfies Record<Emotion, string | undefined>
```

> **🔴 概括（这是 airi 最值得批评、也是我们最该改进的一点）**：
> - **9 个情绪名是硬编码的**（`Emotion` enum），**motion 名也是硬编码的**（`'Happy'`/`'Sad'`/`'Idle'`/…）。
> - 而 `availableMotions` 是从真实模型里**动态发现**的 —— **两者从不交叉验证**。
> - 后果：**换一个模型（motion 组名不叫 `Happy`）→ 情绪映射直接落空**，而 LLM 收到的 prompt 里**仍然宣称**这些情绪可用。
> - **`availableMotions` 只被用来**：① 设置界面里给用户看（`live2d.vue:322`）；② 建立 `motionMap`（见 §3.3）。
>
> → **这就是我们要做的「能力发现层」的真正增量：把发现结果反向喂进 LLM 的 prompt，而不是喂一张写死的表。**

### 3.3 `motionMap`：发现结果 → 情绪名的**单向**兜底（逐字）

**文件**：`packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue:336–343`

```ts
availableMotions.value.forEach((motion) => {
if (motion.motionName in Emotion) {
motionMap.value[motion.fileName] = motion.motionName
}
else {
motionMap.value[motion.fileName] = EmotionNeutralMotionName
}
})
```

> **概括**：这是「**模型自带的 motion 组名恰好等于某个情绪名**」时，才把该 motion 认作那个情绪；**否则一律降级为 `Idle`**。
> **注意方向**：是**从模型名去匹配情绪名**（`motion.motionName in Emotion`），**不是**从情绪名去找可用动作。所以**模型不配合时，没有 fallback 到"最接近的可用动作"，只有"回 Idle"**。
> **这是我们明确要改进的地方**（设计 §3 会给双向匹配 + 显式 fallback 链）。

### 3.4 情绪 → 动作的实际触发点

**文件**：`packages/stage-ui/src/components/scenes/Stage.vue:266`（逐字）

```ts
        currentMotion.value = { group: EMOTION_EmotionMotionName_value[ctx.data.name] }
```

> **概括**：情绪事件的落地就是**设置 `currentMotion` 的 group 名**，交给 `motionManager` 去播放该组动作。**没有强度参与**（`intensity` 在这一层被丢弃 —— 强度只到 `EmotionPayload` 为止）。

🔴 **重要缺口**：`payloads.ts` 里辛苦归一化的 `intensity`（0–1），**在 Live2D 路径上没有落到任何参数**。→ 若我们要"强度可感"，必须自己接（设计 §4 给方案）。

---

## 4. Beat Sync / 眼动 / 面部追踪（任务书点名，逐一核实）

| 项 | 核实结果 |
|---|---|
| Beat Sync（音频节拍 → `angleX/Y/Z`） | ✅ **文件存在**：`packages/stage-ui-live2d/src/composables/live2d/beat-sync.ts`（359 行），已注册在 `'pre'` 档（`Model.vue:435`）。**逐字细节见 A3** |
| MediaPipe 面部追踪把**用户**表情/视线反馈进 LLM | ⏳ 见 A3（`packages/model-driver-mediapipe/` 存在） |
| `live2dStore.availableMotions` | ✅ **已核实**（§3.1）。但**它叫 `useLive2dParams`（pinia store id `'live2d'`）**，在 `packages/stage-ui-live2d/src/stores/model-parameters.ts` |
| Eye tracking | ✅ 文件存在：`eye-tracking.ts`（59 行） |
| Idle focus / Idle disable | ✅ 存在，注册在 `post` / `pre` 档（`Model.vue:436–437`） |

---

## 5. 依赖与技术栈（一手证据，供选型参考）

**文件**：`packages/stage-ui-live2d/package.json`（逐字节选）

```json
  "dependencies": {
    ...
    "pixi-live2d-display": "catalog:",
    ...
  },
```

**AIRI 对这个包打了补丁**：`patches/pixi-live2d-display.patch`（逐字，第 1 个实质改动）：

```diff
-      const settingsFile = files.find((file) => file.name.endsWith("model.json") || file.name.endsWith("model3.json"));
+      const settingsFile = files.find((file) => !file.name.endsWith("items_pinned_to_model.json") && (file.name.endsWith("model.json") || file.name.endsWith("model3.json")));
```

```diff
-    settings.validateFiles(files.map((file) => encodeURI(file.webkitRelativePath)));
+    settings.validateFiles(files.map((file) => file.webkitRelativePath));
```

> **🔴 概括（对我们的选型有直接意义）**：
> 1. **AIRI 用的是 `pixi-live2d-display`，并且需要打 patch 才能正常工作**（修 zip 内 `model3.json` 识别、修 `encodeURI` 破坏中文/特殊字符路径）。→ **这个库确实需要打补丁**，不是开箱即用。
> 2. `package.json` 里用的是 **PixiJS v6 时代的独立子包**（`@pixi/app` / `@pixi/core` / `@pixi/loaders` / `@pixi/runner` …），**不是 `pixi.js` 单体包**。→ 这是 `pixi-live2d-display` 对 Pixi 版本的硬约束信号（**细节见 A4 选型核实**）。
> 3. AIRI 自己写的是 **Cubism 4 类型**：`import type { Cubism4InternalModel, InternalModel } from 'pixi-live2d-display/cubism4'`（`motion-manager.ts:1`）。→ **Cubism 4 路径是 AIRI 实际在用的**。
