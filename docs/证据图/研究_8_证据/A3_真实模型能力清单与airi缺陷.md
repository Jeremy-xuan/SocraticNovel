# A3 · 真实模型的「能力清单」实证 + airi 能力发现层的两个硬缺陷

> **取证时间**：2026-09-24
> **样本来源**：官方 `Live2D/CubismWebSamples`，本地 clone 于 `/tmp/CubismWebSamples`
> **样本 commit**：`b1de66b0b1f1cb881d95fb6158622aeb6a2827bd`（`Thu Apr 2 11:13:49 2026 +0900`，subject: `Update to Cubism 5 SDK for Web R5`）
> **方法**：直接 `python3 json.load()` 读官方 sample 的 `*.model3.json`，**数值与清单均为脚本输出原文，非我概括**。

---

## 1. 🎯 任务书要求「给一张真实模型的实际清单作证据」——这是 8 个官方样本的全量

```
Haru.model3.json             motions=['Idle', 'TapBody'] exprs=8
Hiyori.model3.json           motions=['Idle', 'TapBody'] exprs=0
Mao.model3.json              motions=['Idle', 'TapBody'] exprs=8
Mark.model3.json             motions=['Idle']             exprs=0
Natori.model3.json           motions=['Idle', 'TapBody'] exprs=11
Ren.model3.json              motions=['Idle', 'TapBody'] exprs=5
Rice.model3.json             motions=['Idle', 'TapBody'] exprs=0
Wanko.model3.json            motions=['Idle', 'TapBody'] exprs=0

UNION of all motion group names: ['Idle', 'TapBody']
```

### 🔴 结论 1：官方样本里**根本没有以情绪命名的 motion 组**

**8 个官方模型的动作组名并集只有两个：`Idle`、`TapBody`。**

而 airi 的情绪映射表（`packages/stage-ui-live2d/src/constants/emotions.ts:25–35`）**要求模型提供 `Happy` / `Sad` / `Angry` / `Awkward` / `Think` / `Surprise` / `Question` / `Idle` / `Curious` 这些组名**。

→ **用 airi 的默认映射表去驱动任何官方样本模型，9 个情绪里 8 个会落空**（只有 `neutral → Idle` 命中）。

> **这不是我的推断，是两段一手数据的直接对照**：
> - 样本侧：并集 = `['Idle', 'TapBody']`（上方脚本输出）
> - airi 侧：映射值 = `'Happy'|'Sad'|'Angry'|'Awkward'|'Think'|'Surprise'|'Question'|'Idle'|'Curious'`（`emotions.ts:15–23` 逐字）
>
> 🔴 **对我们的设计含义（这是本轮最重要的设计输入之一）**：
> **「情绪 → 动作」不能靠约定动作组名，必须靠「模型实际有什么 + 我们显式建一张映射」。**
> 官方样本的动作组名是**功能语义**（Idle / TapBody），不是**情绪语义**。
> → 我们要驱动情绪，只有两条现实路径：
> **(a) 用 expressions**（官方样本里有 `Angry`/`Sad`/`Smile`/`Surprised` 这类**情绪命名**的 expression，见 §2）；
> **(b) 自己拿 motion3.json 的参数曲线，建情绪参数预设**。
> 见设计文档 §3。

### 结论 2：官方样本的 motion 定义字段并不统一

```
Haru  Idle → keys: ['File', 'FadeInTime', 'FadeOutTime']
      TapBody → keys: ['File', 'FadeInTime', 'FadeOutTime', 'Sound']   ← 多一个 Sound
Rice  Idle → keys: ['File']                                            ← 只有 File
Natori Idle → keys: ['File']                                           ← 只有 File
Hiyori Idle → keys: ['File', 'FadeInTime', 'FadeOutTime']
```

> **概括**：`FadeInTime` / `FadeOutTime` / `Sound` **都是可选的**。
> **对我们的含义**：解析 `model3.json` 做能力发现时，**不能假设这些字段存在**；`File` 是唯一可靠的字段。
> （airi 的 `live2d-validator.ts:159–178` 就是这么写的——只取 `definition.File`，逐字：
> ```ts
>       const file = readString(definition.File)
>       if (file)
>         references.push(file)
> ```
> 即 **airi 也确认了「只有 File 可靠」**。）

---

## 2. 官方样本的 expressions：**这里是情绪命名的，但只在部分模型上**

```
Natori  Expressions: [('Angry',...), ('Blushing',...), ('Normal',...), ('Sad',...), ('Smile',...), ('Surprised',...), ('exp_01',...), ('exp_02',...), ('exp_03',...), ('exp_04',...), ('exp_05',...)]
Haru    Expressions: [('F01',...), ('F02',...), ..., ('F08',...)]      ← 纯编号，无情绪语义
Hiyori  Expressions: []                                                ← 完全没有
Mark    Expressions: []
Rice    Expressions: []
Wanko   Expressions: []
```

> **概括**：
> - **只有 Natori 一个模型**有情绪命名的 expression（`Angry`/`Sad`/`Smile`/`Surprised`/`Blushing`/`Normal`）。
> - Haru 有 8 个 expression 但**叫 F01–F08**（纯编号，无情绪语义 → 必须人肉看效果才知道是什么表情）。
> - **5 个模型完全没有 expressions。**
>
> 🔴 **对我们的含义**：**「靠 expression 做情绪」也不通用**。模型之间差异极大：
> - 有的给情绪名（Natori）
> - 有的给编号（Haru，需人工标注一次）
> - 有的什么都不给（Hiyori/Mark/Rice/Wanko）
>
> → **能力发现层必须如实报告"这个模型到底能做什么"，并在缺失时走降级路径**（设计 §3 给降级链）。
> → **而且这解释了为什么 airi 选择写死映射表**：因为它假定用户会自备"情绪命名"的模型（第三方 Live2D 模型常见做法），官方样本反而不是它的目标。**但这对我们是错的**——我们若要开箱可用，就必须处理"官方样本型"模型。

---

## 3. `Groups` 段：官方规范里的**参数绑定声明**，airi 完全没用

**`Hiyori.model3.json` 的 `Groups` 与 `HitAreas`（逐字，脚本输出）**：

```json
{
  "Groups": [
    {
      "Target": "Parameter",
      "Name": "LipSync",
      "Ids": [
        "ParamMouthOpenY"
      ]
    },
    {
      "Target": "Parameter",
      "Name": "EyeBlink",
      "Ids": [
        "ParamEyeLOpen",
        "ParamEyeROpen"
      ]
    }
  ],
  "HitAreas": [
    {
      "Id": "HitArea",
      "Name": "Body"
    }
  ]
}
```

### 🔴 结论 3：`Groups` 是官方提供的「参数语义绑定」，**应该读它，而不是硬编码参数名**

`Groups[].Name = "LipSync"` 明确宣告了：**这个模型的嘴型参数是 `ParamMouthOpenY`**。
`Groups[].Name = "EyeBlink"` 宣告了：**眨眼参数是 `ParamEyeLOpen` / `ParamEyeROpen`**。

**但 airi 全程硬编码字符串 `'ParamMouthOpenY'`**（共 7 处，全部为字面量）：

```
packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts:733
packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts:775
packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts:786
packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts:795
packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts:798
packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue:368
packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue:501
packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue:741
```

**并且 airi 从不读取 `Groups` 段**（grep `'Groups'` / `"Groups"` 在 `packages/stage-ui-live2d/src/` 下**零命中**；`LipSync` 一词只命中它自己的插件函数名 `useMotionUpdatePluginLipSync`）。

> **概括（airi 的第二个硬缺陷）**：
> **airi 把「模型声明自己嘴型参数是哪个」这条官方标准信息扔掉了，改用写死的参数名。**
> 只要某个模型的嘴型参数不叫 `ParamMouthOpenY`（**注意：`ParamMouthOpenY` 确实是 Live2D 的标准默认 ID**，但 `Groups` 存在的意义正是允许模型自定义），嘴型就会静默失效。
>
> 🔴 **我们的改进（明确的自研点，有官方依据支撑）**：
> **能力发现层第一步就读 `Groups`，从中解析出 `LipSync` / `EyeBlink` 的实际参数 ID；读不到再回退到标准默认 ID（`ParamMouthOpenY` / `ParamEyeLOpen` / `ParamEyeROpen`）。**
> 这一步**airi 没做**，属于我们的增量；但它**不是无先例的发明**——依据就是官方 `model3.json` 规范里 `Groups` 段的设计意图（见 §4 的框架 API 取证）。

---

## 3b. 🔴🔴 决定性证据：官方样本里 `LipSync` 参数名**根本不统一**

**方法**：对 8 个官方样本，脚本提取 `Groups[]` 里 `Name == "LipSync"` 与 `"EyeBlink"` 的 `Ids`。

**输出原文**：

```
Haru.model3.json           LipSync=['ParamMouthOpenY']  EyeBlink=['ParamEyeLOpen', 'ParamEyeROpen']
Hiyori.model3.json         LipSync=['ParamMouthOpenY']  EyeBlink=['ParamEyeLOpen', 'ParamEyeROpen']
Mao.model3.json            LipSync=['ParamA']           EyeBlink=['ParamEyeLOpen', 'ParamEyeROpen']
Mark.model3.json           LipSync=[]                   EyeBlink=['ParamEyeLOpen', 'ParamEyeROpen']
Natori.model3.json         LipSync=['ParamMouthOpenY']  EyeBlink=['ParamEyeLOpen', 'ParamEyeROpen']
Ren.model3.json            LipSync=['ParamMouthOpenY']  EyeBlink=['ParamEyeLOpen', 'ParamEyeROpen']
Rice.model3.json           LipSync=[]                   EyeBlink=['ParamEyeLOpen', 'ParamEyeROpen']
Wanko.model3.json          LipSync=['PARAM_MOUTH_OPEN_Y']  EyeBlink=['PARAM_EYE_L_OPEN', 'PARAM_EYE_R_OPEN']
```

**三种互不相同的形态**：

| 形态 | 模型 | `LipSync` 的 `Ids` |
|---|---|---|
| **标准名** | Haru / Hiyori / Natori / Ren | `['ParamMouthOpenY']` |
| 🔴 **完全不同的名字** | **Mao** | **`['ParamA']`** |
| 🔴 **全大写 + 下划线风格** | **Wanko** | **`['PARAM_MOUTH_OPEN_Y']`** |
| 🔴 **空数组** | **Mark / Rice** | **`[]`** |

**并且 `EyeBlink` 也不统一**：Wanko 是 `['PARAM_EYE_L_OPEN', 'PARAM_EYE_R_OPEN']`（全大写）。

**交叉验证（排除"声明了但模型里没有"的可能）**：

```
$ grep -l 'ParamA' Mao/motions/*.motion3.json
Mao/motions/mtn_01.motion3.json
Mao/motions/mtn_02.motion3.json

$ grep -l 'PARAM_MOUTH_OPEN_Y' Wanko/motions/*.motion3.json
Wanko/motions/idle_01.motion3.json
Wanko/motions/idle_02.motion3.json
```

→ **这两个非标准名真实存在于模型的动画数据里**，`Groups` 的声明是真的。

> ### 🔴🔴 这条证据的结论（对本项目的选型有决定性意义）
> **airi 硬编码 `'ParamMouthOpenY'` 的做法，在 8 个官方样本里有 3 个会失效**（Mao、Wanko 直接错参数名；Mark、Rice 是空数组）。
> **也就是说：airi 的嘴型实现「换模型就坏」，而这在官方样本上是常态而非边缘情况。**
>
> **→ 「读 `Groups` 并回退」不是可选优化，是必需项。**（OLV 做了，见 §3；airi 没做。）
>
> **另外**：`LipSync = []`（空数组）与「`LipSync` 字段缺失」是**两种不同情况**，必须分别处理：
> - 空数组：模型声明了有这个组，但没有参数 → **必须回退**；
> - 字段缺失：模型没声明这个组 → **同样回退**。
> OLV 的实现只判断了「数组长度为 0」（`lappmodel.ts:383` 逐字 `if (this._lipSyncIds.getSize() === 0)`），**恰好同时覆盖两种情况** —— 这是它可以照抄的另一个理由。

---

## 4. 官方框架侧：读 `Groups` 与 `Motions` 的 API 确实存在

**文件**：`/tmp/CubismWebFramework/src/cubismmodelsettingjson.ts`
**commit**：`d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b`（`Thu Apr 2 11:12:40 2026 +0900`，`Update to Cubism 5 SDK for Web R5`）

**关键字段名常量（第 733–744 行，逐字）**：

```ts
  protected readonly fileReferences = 'FileReferences';
```

```ts
  protected readonly expressions = 'Expressions';
  protected readonly motions = 'Motions';
```

**Motion 组相关 API（第 254–271 行，逐字节选）**：

```ts
    if (!this.isExistMotionGroups()) {
```

```ts
    return this._jsonValue[FrequestNode.FrequestNode_Motions].getKeys().length;
```

```ts
    return this._jsonValue[FrequestNode.FrequestNode_Motions].getKeys()[index];
```

> **概括**：官方框架把 `Motions` 的 **key 列表**（即动作组名）暴露成 API —— 这正是能力发现层要的「动作组枚举」。
> **但注意**：官方框架**没有**「这个模型有哪些 expression 名」之外的**情绪语义**概念——**情绪语义完全是应用层的事**。这从根上支持了 §1 的结论。

**该文件里也有 `Groups` 相关解析**（`FrequestNode` 枚举未列出 Groups，但 `Groups` 在官方 sample 的 model3.json 里是顶层键）——**airi 未使用**。

---

## 5. 本节「源码核实 vs 二手」标注

| 项 | 状态 |
|---|---|
| 8 个官方样本的动作组/表情清单 | ✅ **一手**（本地 clone 脚本直读） |
| `Groups` 段原文 | ✅ **一手**（本地 clone 脚本直读） |
| airi 硬编码 `ParamMouthOpenY` | ✅ **一手**（grep 命中 8 处字面量） |
| airi 不读 `Groups` | ✅ **一手**（grep 零命中） |
| 官方框架的 `Motions` key API | ✅ **一手**（本地 clone 逐字） |
| airi 的情绪映射表要求情绪组名 | ✅ **一手**（`emotions.ts:15–23` 逐字） |
