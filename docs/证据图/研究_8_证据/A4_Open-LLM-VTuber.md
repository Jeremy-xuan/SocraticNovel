# A4 · prior art #2：Open-LLM-VTuber（能力发现做得对的那一个）

> **取证方式**：`git clone --depth 1`（git 协议通道）
> **主仓库**：`https://github.com/Open-LLM-VTuber/Open-LLM-VTuber` → `/tmp/ollmvt`，commit `992309c0aa19845960228f880013d4685fde93b5`（`Fri May 15 00:18:03 2026 -0700`）
> **前端仓库**（主仓库里 `frontend/` 是**空目录**，是 git submodule）：`https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web` → `/tmp/ollmvt-web`，commit `d176e7df2366952e3bacbf12cf9a8b18a4315932`（`Fri Sep 5 21:00:45 2025 +0800`）
> **维护状态（GitHub API，2026-09-24 取）**：`archived: False`｜`pushed_at: 2026-05-15T07:18:04Z`｜`stars: 13896`｜最近 release `v1.2.1`（`2025-08-26`）

---

## 1. 它怎么把「AI 输出」变成「模型参数变化」——完整链路

### 步骤 ①：模型侧声明「情绪关键词 → expression 索引」的映射

**文件**：`/tmp/ollmvt/model_dict.json`（脚本直读输出，逐字）

```json
[
  {
    "name": "mao_pro",
    "description": "",
    "url": "/live2d-models/mao_pro/runtime/mao_pro.model3.json",
    "kScale": 0.5,
    "initialXshift": 0,
    "initialYshift": 0,
    "kXOffset": 1150,
    "idleMotionGroupName": "Idle",
    "emotionMap": {
      "neutral": 0,
      "anger": 2,
      "disgust": 2,
      "fear": 1,
      "joy": 3,
      "smirk": 3,
      "sadness": 1,
      "surprise": 3
    },
    "tapMotions": {
      "HitAreaHead": { "": 1 },
      "HitAreaBody": { "": 1 }
    }
  }
]
```

> **🔴 关键设计（与 airi 形成鲜明对照）**：
> - `emotionMap` 的**值是一个数字索引**（`0`/`1`/`2`/`3`），**不是动作组名**。
>   这个索引是**该模型 `Expressions[]` 数组的下标**（见步骤 ④ 的 `getExpressionName(index)`）。
> - `emotionMap` 的**键（`neutral`/`anger`/`joy`/…）是模型级配置，不是全局常量**。
> - 所以：**换模型 = 换一份 `emotionMap`，代码不动**。
>
> 对比 airi：airi 的 9 个情绪是**代码里的 enum**，动作名是**代码里的字面量**（`A2` §3.2）。**Open-LLM-VTuber 把这两样都外置到模型配置里了。**

### 步骤 ②：把「这个模型实际支持的情绪关键词」渲染进 system prompt（**动态**）

**文件**：`/tmp/ollmvt/src/open_llm_vtuber/live2d_model.py:47–53`（逐字）

```python
        self.model_info: dict = self._lookup_model_info(model_name)
        self.emo_map: dict = {
            k.lower(): v for k, v in self.model_info["emotionMap"].items()
        }
        self.emo_str: str = " ".join([f"[{key}]," for key in self.emo_map.keys()])
        # emo_str is a string of the keys in the emoMap dictionary. The keys are enclosed in square brackets.
        # example: `"[fear], [anger], [disgust], [sadness], [joy], [neutral], [surprise]"`
```

**prompt 模板**：`/tmp/ollmvt/prompts/utils/live2d_expression_prompt.txt`（全文 13 行，逐字）

```
## Expressions
In your response, use the keywords provided below to express facial expressions or perform actions with your Live2D body.

Here are all the expression keywords you can use. Use them regularly:
- [<insert_emomap_keys>]

## Examples
Here are some examples of how to use expressions in your responses:

"Hi! [expression1] Nice to meet you!"

"[expression2] That's a great question! [expression3] Let me explain..."

Note: you are only allowed to use the keywords explicity listed above. Don't use keywords unlisted above. Remember to include the brackets `[]`
```

**注入点**：`/tmp/ollmvt/src/open_llm_vtuber/service_context.py:457–460`（逐字）

```python
            if prompt_name == "live2d_expression_prompt":
                prompt_content = prompt_content.replace(
                    "[<insert_emomap_keys>]", self.live2d_model.emo_str
                )
```

> **🔴 这就是「能力发现层」的正确形态**：
> **模型有哪些情绪 → 就只把哪些情绪告诉 LLM。** 一份真源（`emotionMap`）同时决定「prompt 里出现什么关键词」和「关键词落到哪个 expression」。
>
> **这与 airi 的 CALL manifest 机制是同一个设计思想**（`A1` §2.4：*「同一份真源既渲染指令又执行回调」*），**但 Open-LLM-VTuber 把它用在了情绪/表情上，而 airi 的 CALL 只用于插件回调、情绪仍走写死的表**。
> → **我们要做的「能力发现层」= airi 的 manifest 思想 + Open-LLM-VTuber 的外置 emotionMap**，两者都有先例，**组合方式是我们的设计**。

### 步骤 ③：服务端从流式输出里抽关键词（**纯字符串扫描，不用正则**）

**文件**：`/tmp/ollmvt/src/open_llm_vtuber/live2d_model.py:146–172`（逐字）

```python
    def extract_emotion(self, str_to_check: str) -> list:
        """
        Check the input string for any emotion keywords and return a list of values (the expression index) of the emotions found in the string.
        ...
        """

        expression_list = []
        str_to_check = str_to_check.lower()

        i = 0
        while i < len(str_to_check):
            if str_to_check[i] != "[":
                i += 1
                continue
            for key in self.emo_map.keys():
                emo_tag = f"[{key}]"
                if str_to_check[i : i + len(emo_tag)] == emo_tag:
                    expression_list.append(self.emo_map[key])
                    i += len(emo_tag) - 1
                    break
            i += 1
        return expression_list
```

**🔴 注意语法差异（与我们/AIRI 都不同）**：Open-LLM-VTuber 用的是**方括号 `[joy]` 内联关键词**，**不是 `<|...|>` 标签**。

> **概括（这条对 DSH 侧决策极重要）**：
> **`[joy]` 这种语法天然会与 Markdown 的链接语法 `[text](url)` 冲突**，但作者选择了它，原因是：
> ① 极短、模型易学；② 服务端扫描极简单（`str[i] == "["` 起手）；
> ③ **服务端剥离后，客户端只收到结构化数据**（见步骤 ⑤）。
> → **但它有个明显代价**：正文里任何方括号都会被扫描。**我们的教学场景里，方括号是数学/化学/代码的高频字符**（如区间 `[0,1]`、数组 `[1,2,3]`、浓度 `[H+]`）。→ **我们不能用 `[...]` 语法**（设计 §3 会给理由）。

### 步骤 ④：服务端在句子级抽取，并放进结构化的 `Actions`

**文件**：`/tmp/ollmvt/src/open_llm_vtuber/agent/transformers.py:58–98`（逐字节选）

```python
def actions_extractor(live2d_model: Live2dModel):
    """
    Decorator that extracts actions from sentences, passing through dicts.
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            stream = func(*args, **kwargs)
            async for item in stream:
                if isinstance(item, SentenceWithTags):
                    sentence = item
                    actions = Actions()
                    # Only extract emotions for non-tag text
                    if not any(
                        tag.state in [TagState.START, TagState.END]
                        for tag in sentence.tags
                    ):
                        expressions = live2d_model.extract_emotion(sentence.text)
                        if expressions:
                            actions.expressions = expressions
                    yield sentence, actions  # Yield the tuple
```

**输出类型**：`/tmp/ollmvt/src/open_llm_vtuber/agent/output_types.py:7–16`（逐字）

```python
class Actions:
    """Represents actions that can be performed alongside text output"""

    expressions: Optional[List[str] | List[int]] = None
    pictures: Optional[List[str]] = None
    sounds: Optional[List[str]] = None

    def to_dict(self) -> dict:
        """Convert Actions object to a dictionary for JSON serialization"""
        return {k: v for k, v in asdict(self).items() if v is not None}
```

> **🔴 这就是任务书里问的「服务端剥离 → 转结构化事件」的现成先例。**
> 链路：`SentenceWithTags` → `extract_emotion()` 得到索引列表 → 塞进 `Actions` dataclass → 随消息一起序列化下发。
> **注意**：抽取是**逐句**发生的（`async for item in stream` 里的 `SentenceWithTags`），**不是等全文**。→ **天然支持流式**。

### 步骤 ⑤：客户端按索引取 expression 名并应用

**文件**：`/tmp/ollmvt-web/src/renderer/src/hooks/canvas/use-live2d-expression.ts:14–36`（逐字）

```ts
  const setExpression = useCallback((
    expressionValue: string | number,
    lappAdapter: any,
    logMessage?: string,
  ) => {
    try {
      if (typeof expressionValue === 'string') {
        // Set expression by name
        lappAdapter.setExpression(expressionValue);
      } else if (typeof expressionValue === 'number') {
        // Set expression by index
        const expressionName = lappAdapter.getExpressionName(expressionValue);
        if (expressionName) {
          lappAdapter.setExpression(expressionName);
        }
      }
```

**调用点**：`/tmp/ollmvt-web/src/renderer/src/hooks/utils/use-audio-task.ts:128–136`（逐字）

```ts
        // Set expression if available
        const lappAdapter = (window as any).getLAppAdapter?.();
        if (lappAdapter && expressions?.[0] !== undefined) {
          setExpression(
            expressions[0],
            lappAdapter,
            `Set expression to: ${expressions[0]}`,
          );
        }
```

**适配器**：`/tmp/ollmvt-web/src/renderer/WebSDK/src/lappadapter.ts:76–77`（逐字）

```ts
  public setExpression(name: string): void {
    this.getModel()?.setExpression(name);
  }
```

> **概括**：**每句只取第一个情绪**（`expressions[0]`），**强度概念不存在**（`emotionMap` 的值只有索引，没有强度）。
> → **这是 Open-LLM-VTuber 的一个明确弱点**：多情绪叠加、强度渐变都做不到。**airi 在这点上更强**（有 `intensity` 归一化，虽然 Live2D 路径上也没落地，见 `A2` §3.4）。
> → **我们的设计要同时拿两边的长处**：Open-LLM-VTuber 的「动态能力发现」+ airi 的「强度字段」，并把强度**真正落到参数**（设计 §4）。

---

## 2. 🔴 它读 `Groups` 了——而且带 fallback（airi 没做的第二件事）

**文件**：`/tmp/ollmvt-web/src/renderer/WebSDK/src/lappmodel.ts:373–400`（逐字）

```ts
    // LipSyncIds
    const setupLipSyncIds = (): void => {

      const lipSyncIdCount = this._modelSetting.getLipSyncParameterCount();

      for (let i = 0; i < lipSyncIdCount; ++i) {
        this._lipSyncIds.pushBack(this._modelSetting.getLipSyncParameterId(i));
      }

      // Fallback if no LipSync IDs are defined in the model setting
      if (this._lipSyncIds.getSize() === 0) {
        console.warn('[Fallback] No LipSync IDs defined in model setting. Attempting fallback to "ParamMouthOpenY".');
        
        const idManager = CubismFramework.getIdManager();
        if (idManager) {
          const fallbackId: CubismIdHandle = idManager.getId(CubismDefaultParameterId.ParamMouthOpenY);

          // Check if the model actually has this parameter before adding it
          if (this._model && fallbackId && this._model.getParameterIndex(fallbackId) !== -1) {
            this._lipSyncIds.pushBack(fallbackId);
            console.log('[Fallback] Successfully added "ParamMouthOpenY" as LipSync ID.');
          } else {
            console.warn('[Fallback] Fallback ID "ParamMouthOpenY" not found in the current model or model not loaded.');
          }
        } else {
          console.warn('[Fallback] Could not access IdManager. LipSync fallback unavailable.');
        }
      }
```

> **🔴 这正是我在 `A3` §3 提议的做法的现成先例**：
> 1. **先读模型声明的 `Groups` 里的 `LipSync` 参数 ID**（`getLipSyncParameterCount()` / `getLipSyncParameterId(i)`）；
> 2. **读不到才回退到标准默认 `ParamMouthOpenY`**；
> 3. **回退后还要验证该参数真的存在于模型上**（`getParameterIndex(fallbackId) !== -1`）。
>
> 🔴 **所以「读 Groups 并回退」这一步不是我们的自研点——Open-LLM-VTuber 已经做了。我们要做的是照抄它。**
> （同理，`lappmodel.ts:1278–1293` 用 `CubismDefaultParameterId.ParamAngleX/ParamAngleY/ParamAngleZ/ParamEyeBallX/ParamEyeBallY/ParamBodyAngleX` 而非字面量。）

---

## 3. 嘴型（无音频时也不适用）：RMS 方案

**文件**：`/tmp/ollmvt-web/src/renderer/WebSDK/src/lappmodel.ts:614–630`（逐字）

```ts
    // Lip sync settings
    if (this._lipsync) {
      let value = 0.0;
      this._wavFileHandler.update(deltaTimeSeconds);
      value = this._wavFileHandler.getRms();
      value = Math.min(1.0, value * 1.5);

      const lipSyncWeight = 4.0;

      for (let i = 0; i < this._lipSyncIds.getSize(); ++i) {
        this._model.addParameterValueById(
          this._lipSyncIds.at(i),
          value,
          lipSyncWeight
        );
      }
    }
```

**RMS 来源**：`/tmp/ollmvt-web/src/renderer/WebSDK/src/lappwavfilehandler.ts`

```ts
      this._lastRms = rms;                       // 第 85 行
      this._sampleOffset = goalOffset;
      return true;
    }
```

```ts
  public getRms(): number {                      // 第 101–103 行
    return this._lastRms;
  }
```

**前端还把灵敏度放大 2 倍**（`use-audio-task.ts:164–193`，逐字节选）：

```ts
        // Enhance lip sync sensitivity
        const lipSyncScale = 2.0;
```

```ts
              const originalUpdate = model._wavFileHandler.update.bind(model._wavFileHandler);
              model._wavFileHandler.update = function (deltaTimeSeconds: number) {
                const result = originalUpdate(deltaTimeSeconds);
                // @ts-ignore
                this._lastRms = Math.min(2.0, this._lastRms * lipSyncScale);
                return result;
              };
```

> **适用前提**：
> 1. **必须有音频文件（WAV）**：`_wavFileHandler.start(audioDataUrl)` 喂的是 `data:audio/wav;base64,...`。
> 2. 依赖官方 Cubism Web SDK 的 `LAppWavFileHandler`（**sample 代码**，非 framework 本体）。
> 3. 写参数用 **`addParameterValueById(id, value, weight)`**（**加性**，权重 4.0），**不是 `setParameterValueById`**（**覆盖**）。
>    → 对比 airi 用 `setParameterValueById`（覆盖）。
>    **🔴 这是一个重要的机制分歧**：加性写入会与 motion/expression 的写入**累加**（可能超界），覆盖写入会**抹掉**别人的值。**我们该选哪个，取决于嘴型是否要与其他表情共存**（设计 §4 讨论）。
>
> → **对我们的结论不变**：**RMS 方案同样必须有音频，我们第一版用不了。**

---

## 4. 技术栈（一手证据，供选型）

**它用的是官方 Cubism Web SDK 的 sample 代码（`LAppModel` / `LAppAdapter` / `LAppWavFileHandler`），不是 `pixi-live2d-display`。**

依据（逐字，`lappmodel.ts:9`）：

```ts
import { CubismDefaultParameterId } from "@framework/cubismdefaultparameterid";
```

且 `/tmp/ollmvt-web/src/renderer/WebSDK/` 下同时存在 `Framework/`（官方 framework）与 `src/`（官方 sample 的 `LApp*` 类）。

**前端框架**：React + TypeScript（`src/renderer/src/App.tsx`、`main.tsx`），Electron 打包。

> **适用前提小结**：
> - **需要音频**（嘴型）；
> - **前端是 React + Electron**，但它把 Live2D 封装成 `window.getLAppAdapter?.()` 全局钩子（`use-audio-task.ts:107`、`129`）→ **Live2D 部分与 React 耦合不深**，理论上可搬；
> - **依赖官方 sample 的 `LApp*` 类**（这些是 sample 代码，不是 framework 的稳定 API 面）。
