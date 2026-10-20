# 长上下文（256k→1M）与"旧经验失效"命题 · 证据核查（2026-09-22）

> 核查对象（用户原话转述）："我设计这套系统时的大模型技术和现在很不一样了，特别是**上下文从 256k 到 1M 的改进**让模型不容易出现注意力涣散或者漂移的问题，所以很多东西要针对性改进，**旧时代的经验没用了**。"
>
> 本文件只做一件事：把该命题拆成 4 条，逐条标 **有证据支持 / 部分支持 / 无证据 / 被证据反驳**。
> 标注约定：【原文】= 抓到的出处原文（附 URL）；【转述】= 对原文的概括；【推断】= 无直接出处的推理（我自己的判断，不作为结论）；【常见说法但未找到直接证据】= 广泛流传但本次未检索到可核对出处的说法。

**状态：已完成（2026-09-22）**｜§1–§3 为公开证据核查，§4 为逐条裁决，**§4.5 为本机文件实测**。

---

## 摘要：命题拆成 4 条，逐条给裁决

> 命题原文（用户）："我设计这套系统时的大模型技术和现在很不一样了，特别是**上下文从 256k 到 1M 的改进**让模型不容易出现注意力涣散或者漂移的问题，所以很多东西要针对性改进，**旧时代的经验没用了**。"

| 拆分 | 命题主张 | 裁决 | 一句话依据（详见各节） |
|---|---|---|---|
| **①能力** | 1M 上下文让长文档定位与利用变好 | **部分支持（但"用得上"未被支持）** | 窗口确实到了 1M（Anthropic 官方："1M is the default"）；但公开基准一致测出**"宣称支持 ≠ 在该长度有效"**（RULER／NoLiMa／Chroma／Rizwan 2026） |
| **②失效模式消失** | 注意力涣散/漂移的老问题没了 | 🔴 **被证据反驳** | lost-in-the-middle 仍成立且被归因于**内在 U 形注意力偏置**（Hsieh 2024 "regardless of their relevance"）；context rot 被**厂方文档自己写进产品文档**（Anthropic："more context isn't automatically better… accuracy and recall degrade"） |
| **③漂移成因** | （隐含）漂移主要源于旧时代上下文太小 | 🔴 **被证据反驳（方向相反）** | 有出处把漂移拆成"训练期 + **推理期**"，而**推理期成因正是长上下文**："long contexts **dilute the influence of early-context system prompts** in attention computations" |
| **④旧经验没用了** | 旧做法应整体废弃 | **部分支持、部分反驳** | **被反驳**：一次性塞满上下文（6 条里唯一有明确反面证据；且厂方把 compaction 定为 primary strategy）。**仍必要**：按需注入、摘要压缩、每轮锚定。**该废弃的不是做法，是"4000 字"这类**具体阈值**与其**理由**（【常见说法但未找到直接证据】） |

**最重要的一句**：命题里最有价值的部分不是"旧经验没用了"，而是"**很多东西要针对性改进**"——证据支持的正是后半句。**要改的是理由和阈值，不是把旧做法整体丢掉。**

**并且，落到我们自己的教室（§4.5 本机实测）**：这间教室**并不因文件多而 token 吃紧**（每课必读约 **20.4k token**）；真正的结构问题只有两个——① `system_core.md`（21,553B，始终加载）把**教学正确性**与**叙事规则**混在一起；② **非当课的两个角色文件（28,631B ≈ 9.2k tok）是可避免的最大开销**。

---

## §1 长上下文能力改善了什么的实测证据

### 1.1 【原文】"支持长输入"≠"在长输入上有效" —— 这是公开基准反复测出的分离

**出处 A：RULER benchmark（Hsieh et al., 2024, arXiv:2404.06654）**
- 标题：*RULER: What's the Real Context Size of Your Long-Context Language Models?*
- 作者：Cheng-Ping Hsieh, Simeng Sun, Samuel Kriman, Shantanu Acharya, Dima Rekesh, Fei Jia, Yang Zhang, Boris Ginsburg
- 年份：2024｜URL：http://arxiv.org/abs/2404.06654v3
- 出处位置：**摘要**
- 摘要原文（关键句）：
  > "Despite achieving nearly perfect accuracy in the vanilla NIAH test, almost all models exhibit large performance drops as the context length increases. While these models all claim context sizes of 32K tokens or greater, only half of them can maintain satisfactory performance at the length of 32K."
- 摘要原文（对 NIAH 的评价）：
  > "this simple retrieval-based test is indicative of only a superficial form of long-context understanding."
- 【转述】17 个长上下文模型 × 13 个任务：**宣称的上下文长度与实际可维持性能的长度是两回事**；宣称 ≥32K 的模型中只有一半在 32K 上还能维持"令人满意"的表现。
- 【对命题的意义】**直接支持"宣称支持"与"在该长度上有效"必须分开对待**——这正是本报告要区分的两件事。但注意：RULER 测的是 2024 年的模型，**不能直接用来描述 2025-2026 的 1M 级模型**（见 §1.2 的更新证据）。

**出处 B：NoLiMa（Modarressi et al., 2025, arXiv:2502.05167）**
- 标题：*NoLiMa: Long-Context Evaluation Beyond Literal Matching*
- 作者：Ali Modarressi, Hanieh Deilamsalehy, Franck Dernoncourt, Trung Bui, Ryan A. Rossi, Seunghyun Yoon, Hinrich Schütze
- 年份：2025｜URL：http://arxiv.org/abs/2502.05167v3
- 出处位置：**摘要**
- 摘要原文（关键句）：
  > "Recent large language models (LLMs) support long contexts ranging from 128K to 1M tokens... We evaluate 13 popular LLMs that claim to support contexts of at least 128K tokens. While they perform well in short contexts (<1K), performance degrades significantly as context length increases. At 32K, for instance, 11 models drop below 50% of their strong short-length baselines. Even GPT-4o, one of the top-performing exceptions, experiences a reduction from an almost-perfect baseline of 99.3% to 69.7%."
- 摘要原文（归因）：
  > "Our analysis suggests these declines stem from the increased difficulty the attention mechanism faces in longer contexts when literal matches are absent, making it harder to retrieve relevant information. Even models enhanced with reasoning capabilities or CoT prompting struggle to maintain performance in long contexts."
- 【转述】NoLiMa 的关键设计是**去掉问题与"针"之间的字面重合**（要求模型推断潜在关联）。在这种条件下，**128K→1M 这一档模型在 32K 就大面积跌破基线一半**；GPT-4o 从 99.3% 掉到 69.7%。
- 【对命题的意义】**这是对"上下文变大 → 不漂移"最直接的弱化证据**：NoLiMa 的摘要明确把退化归因于**注意力机制本身在长上下文下的困难**，而不是"字面匹配技巧"这种可以随规模消失的问题。且它测的正是 128K–1M 这一档。

**出处 C：Chroma《Context Rot》技术报告（2025-07-14 发布）**
- 标题：*Context Rot: How Increasing Input Tokens Impacts LLM Performance*
- 作者：Chroma（机构）；具体作者名单本次未取自原文（**未取到，不臆测**）
- 年份：2025｜URL：https://www.trychroma.com/research/context-rot ｜代码库：https://github.com/chroma-core/context-rot
- 出处位置：**正文（Introduction / Contributions / Related Work 章节）**
- 正文原文（关键句，均逐字）：
  > "We demonstrate that even under these minimal conditions, model performance degrades as input length increases, often in surprising and non-uniform ways."
  > "We present the following: An evaluation across **18 LLMs**, including leading closed-source and open-weights models, revealing **nonuniform performance with increasing input length**."
  > "It is common for modern LLMs to have input context lengths in the millions of tokens. Gemini 1.5 Pro first introduced their 1M context window in early 2024, followed by the recent GPT-4.1's 1M context window and Llama 4 with 10M."
  > "Because these models achieve near-perfect scores on widely adopted benchmarks like Needle in a Haystack (NIAH), **it's often assumed that their performance is uniform across long-context tasks.**"
  > "While useful as a scalable test, it measures a narrow capability: lexical retrieval. Models typically perform well on NIAH, which has led to the **perception that long-context is largely solved.**"
  > "Real-world applications typically involve much greater complexity, implying that the influence of input length may be even more pronounced in practice."
  > 关于 distractor 的区分（正文原文）："Distractors are topically related to the needle, but do not quite answer the question. Irrelevant content is unrelated to the needle and question."
- 【转述】该报告的实验设计是**固定任务复杂度、只改变输入长度**，以此把"长度的影响"从"题目变难的影响"里剥离出来（原文："our experiments hold task complexity constant while varying only the input length—allowing us to directly measure the effect of input length alone"）。结论是**长度本身单独就能造成性能下降，且下降是非均匀的（nonuniform）**。
- 🔴 **重要限定（避免过度解读）**：本次抓取到的正文**只在 Introduction/Contributions 与 Related Work 段落**取得了上述论断；**具体模型的逐长度实测曲线与百分比数字未取到**（页面在 ¶57 之后被截断）。→ 引用本报告时**不得编造具体百分比**。
- 【对命题的意义】**直接反驳"上下文变大以后这个问题就没有了"**：报告写于 2025 年 7 月，明确针对"1M 上下文已经普及"这一局面（点名 Gemini 1.5 Pro / GPT-4.1 / Llama 4），并指出**"长上下文基本已解决"是一种错觉（perception）**。

---

## §2 已知失效模式的当前状态（逐条：现象 / 出处 / 是否仍然成立）

### 2.1 "lost in the middle"（中间位置信息利用率下降）

- **原始出处**：Liu, Lin, Hewitt, Paranjape, Bevilacqua, Petroni, Liang（2023）*Lost in the Middle: How Language Models Use Long Contexts*，arXiv:2307.03172v3，URL: http://arxiv.org/abs/2307.03172v3
- **出处位置**：**摘要**
- **摘要原文**：
  > "We find that performance can degrade significantly when changing the position of relevant information, indicating that current language models do not robustly make use of information in long input contexts. In particular, we observe that performance is often highest when relevant information occurs at the beginning or end of the input context, and significantly degrades when models must access relevant information in the middle of long contexts, **even for explicitly long-context models.**"
- **是否仍然成立**：**有后续证据表明该现象在 2024 年仍然成立，并被归因为模型内在的注意力偏置。**
  - 续证出处：Hsieh, Chuang, Li, Wang, Le, Kumar, Glass, Ratner, Lee, Krishna, Pfister（2024）*Found in the Middle: Calibrating Positional Attention Bias Improves Long Context Utilization*，arXiv:2406.16008v2，URL: http://arxiv.org/abs/2406.16008v2
  - 出处位置：**摘要**
  - 摘要原文：
    > "Large language models (LLMs), **even when specifically trained to process long input contexts, struggle to capture relevant information located in the middle of their input.** This phenomenon has been known as the lost-in-the-middle problem. ... we establish a connection between lost-in-the-middle to LLMs' intrinsic attention bias: LLMs exhibit a **U-shaped attention bias** where the tokens at the beginning and at the end of its input receive higher attention, **regardless of their relevance.**"
  - 摘要原文（缓解效果）："found-in-the-middle ... eventually leads to improved retrieval-augmented generation (RAG) performance across various tasks, **outperforming existing methods by up to 15 percentage points.**"
- **裁决**：**仍然成立（截至本次找到的最新出处 2024）。** 且关键限定来自原文——**"even when specifically trained to process long input contexts"**（即使专门为长上下文训练过）与 **"regardless of their relevance"**（与相关性无关）。→ 这直接冲击"训练出 1M 上下文就解决了位置偏置"的推论。
- ⚠️ **本次未找到**针对 2025-2026 年 1M 级旗舰模型、专门重测 lost-in-the-middle 的论文（检索词与结果见 §5）。

### 2.2 长上下文下的性能衰减（context rot / 随长度增长而下降的实测曲线）

- **出处**：Chroma, *Context Rot: How Increasing Input Tokens Impacts LLM Performance*, 2025-07-14, https://www.trychroma.com/research/context-rot
- **出处位置**：**正文（Introduction / Contributions）**
- **原文**（见 §1.1 出处 C 的逐字摘录）：18 个模型、固定任务复杂度只变输入长度，结果 "nonuniform performance with increasing input length"；"the perception that long-context is largely solved" 是错觉。
- **裁决**：**仍然成立，且是针对"1M 时代"专门做的实验。**（但具体曲线数值本次未取到 —— 见 §1.1 的红字限定。）
- **旁证（同报告 Related Work 引用的任务）**：
  - *AbsenceBench*：测"识别某段文本**不存在**"的能力 —— 报告记其"also demonstrate performance degradation with growing input length"（【转述】）
  - *Latent List*：填充无关内容的方式不同，对性能影响不同；"adding list operations that locally cancel each other out degrades model performance more significantly compared to adding print statements"（【原文】）→ **"无关内容"的性质本身会影响结果**，不是纯粹的填充量问题。

### 2.3 多跳 / 多事实检索在长上下文下的退化

- **出处**：RULER（arXiv:2404.06654v3，见 §1.1 出处 A）
- **出处位置**：**摘要**
- **摘要原文**：
  > "RULER introduces new task categories **multi-hop tracing** and **aggregation** to test behaviors beyond searching from context. ... Despite achieving nearly perfect accuracy in the vanilla NIAH test, **almost all models exhibit large performance drops as the context length increases.**"
- **另证**：NoLiMa 摘要（arXiv:2502.05167v3，见 §1.1 出处 B）记其基准包含 "fact chaining, and in-context reasoning" 的扩展，并给出 32K 上 11/13 模型跌破基线一半的实测（【原文】）。
- **裁决**：**成立**。多跳与聚合类任务在长上下文下退化明显；RULER 的原文把"纯 NIAH 近乎满分"与"多跳/聚合大幅掉分"并置，说明**简单检索的成功不能外推到多跳**。

### 2.4 冗余上下文（distractor）造成的准确率下降

- **出处**：Chroma《Context Rot》，**正文 "Impact of Distractors" 实验节**
- **出处位置**：**正文**（实验设计段落，结果数值本次未取到）
- **原文**（实验设计与背景）：
  > "Taking a high-similarity needle-question pair, we write four distractors. We have the following setups: Baseline: needle only, no distractors / Single distractor: needle + one randomly positioned distractor / Multiple distractors: needle + all four distractors randomly positioned"
  > "Prior work has demonstrated that distractors have **non-uniform impact**, yet most evaluations involve short input lengths and older models. **Current state-of-the-art models are claimed to be more resilient to distractors, yet their performance has not been extensively tested across various input lengths.**"
  > "Models often have to deal with distractors as well, which has been shown to degrade performance."
- **另证（新的、更细的结论）**：*The First Drop of Ink: Nonlinear Impact of Misleading Information in Long-Context Reasoning*（arXiv:2605.10828v1，URL: https://arxiv.org/html/2605.10828v1）
  - 出处位置：**摘要/开头段**（本次只抓到该页开头，为网页摘要段）
  - 原文（关键句）："...understanding how distracting information affects long-context performance becomes critical. **Prior work shows that semantically relevant yet misleading documents...**"
  - ⚠️ 该页本次**只取到开头段，完整结论与数值未取到**，**不作为结论引用**，仅登记为线索。
- **裁决**：**成立（但强度需限定）**。Chroma 报告把"最新模型被宣称对 distractor 更有韧性"直接列为**未经验证的宣称**（"has not been extensively tested across various input lengths"），并把 distractor 影响写进 Contributions 作为其发现之一。**具体降幅本次未取到。**

### 2.5 🔴 【厂方文档·最强的反命题证据】Anthropic 官方文档自己承认 context rot，并把它作为"为什么必须做上下文管理"的理由

- **出处**：Anthropic Claude Platform Docs，《Context windows》
- **URL**：https://platform.claude.com/docs/en/build-with-claude/context-windows
- **出处位置**：**正文 "How the context window works" 节第一段**（该页 ¶6，逐字）
- **原文（逐字，英文原句）**：
  > "A larger context window allows the model to handle more complex and lengthy prompts, but **more context isn't automatically better. As token count grows, accuracy and recall degrade, a phenomenon known as _context rot_**. This makes **curating what's in context just as important as how much space is available**."
  > "As conversations grow, you'll eventually approach context window limits. For long-running conversations and agentic workflows, **server-side compaction is the primary strategy for context management**."（同页 ¶4）
- **同页其它可引用事实（原文）**：
  > "Claude Fable 5.1, Claude Mythos 5.1, Claude Fable 5, Claude Mythos 5, Claude Opus 5, Claude Opus 4.8, Claude Opus 4.7, Claude Opus 4.6, Claude Sonnet 5, Claude Sonnet 4.6 ... have a **1M-token context window**."
  > "**For every model with a 1M-token context window, 1M is the default: you don't need a beta header**, and long-context requests are billed at standard pricing."
- 🔴 **本条对命题的分量（这是本报告最有分量的一条）**：
  - 这是**厂商自己的产品文档**，写给**要拿它做生产系统的人**看。
  - 文档在**同一条**"1M 上下文已是默认、无需 beta 头"的页面上，**同时写下"更多的上下文并不自动更好，token 数增长时准确率与召回率都会下降"**，并**把"管理上下文里放什么"提升到与"有多少空间"同等重要**。
  - 该厂商给出的**首选上下文管理策略是"压缩（compaction）"**——即 Anthropic 官方在 1M 已成默认的时代，**仍然把"摘要压缩"当作生产系统的 primary strategy**。
  - → **对命题"上下文变大 → 旧经验没用了"构成直接反驳**：若"一次性塞满上下文"能解决问题，官方不会把 compaction 定为 primary strategy。

### 2.6 【原文】"注意力汇点（attention sink）"与 1M 上下文：机制层面的近因证据（2026-09）

- **出处**：Rizwan, Abdus Salam, Uddin（2026）*Do New Attention Mechanisms Actually Fix Attention Sinks at Million-Token Context?*
- **URL**：http://arxiv.org/abs/2609.08574v2（arXiv:2609.08574，v1 2026-09-08，v2 2026-09-18；cs.CL）
- **出处位置**：**摘要**（该页 ¶5 逐字）
- **摘要原文（逐字）**：
  > "Long context language models now advertise windows of one million tokens, but **two habits limit how much of that window is used.** Attention heads with nothing useful to read still spend their budget on the first token, which is called the **attention sink**, and **where a fact sits in the context changes whether the model finds it.** Gated attention cut first token attention from 46.7 percent to 4.8 percent at NeurIPS 2025 ... This paper asks whether the fix survives that jump. ... Three results follow. **The training objective produces the sink, not the architecture. Gating did not reproduce its published effect at our scale. Sink mass, activations and position bias moved independently.**"
- **【转述】三条可直接引用的结论**：① **训练目标（training objective）产生注意力汇点，而不是架构**；② **（在作者规模上）门控注意力没有复现其已发表的效应**；③ **汇点质量、激活与位置偏置三者的变化是彼此独立的**（即修好一个不等于修好另一个）。
- ⚠️ **强度限定（必须写明）**：作者自陈测的是 **four small models**（"四个小模型，只在 token 混合与深度的方式上不同"），**不是 1M 级旗舰模型**；且是 arXiv 预印本，**未见同行评审证据**。→ 引用时只能说"有一篇 2026-09 的预印本报告……"，**不得写成领域定论**。
- 【对命题的意义】这是 **2026 年 9 月（最新）**的证据，指向"**1M 窗口宣称 vs 实际用得上多少**"这道题**在机制层面仍未关闭**，且明确说"**事实放在上下文的哪个位置，会改变模型能否找到它**"（位置偏置仍在）。

---

## §3 角色漂移（persona drift）的成因：有出处的说法

### 3.1 【原文·相关性最高】把漂移拆成"训练期成因 + 推理期成因"，其中推理期成因直接归给长上下文

- **出处**：*Persona Drift Across Long Multi-Turn Conversations with Large Language Models*
- **发布处**：clawrxiv.io（preprint 预印本站，**非 ACL/arXiv，未见同行评审证据**），2026-04-28
- **URL**：https://clawrxiv.io/abs/2604.01980
- **出处位置**：**正文 §5 Discussion**（引文见该页 ¶31）
- **原文（逐字）**：
  > "Drift appears to be partly a **training-time** phenomenon — models trained heavily on cooperative, conversational data **revert toward an 'average helpful assistant' attractor**. It is also partly an **inference-time** phenomenon: **long contexts dilute the influence of early-context system prompts in attention computations** [Liu et al. 2024 'lost in the middle']."
  > "Mitigations target the inference-time component. The training-time component would require fine-tuning or RL with persona-fidelity rewards, which is out of scope for our deployment-friendly remit."
- **【转述】该文把成因明确归为两类：**
  1. **训练期**：训练数据以"合作型对话"为主 → 模型会向**"average helpful assistant"吸引子**回退。**这一部分不随上下文变长而消失**（原文说它需要微调/RL 才能解决）。
  2. **推理期**：**长上下文在注意力计算中稀释了早期 system prompt 的影响**（该文自己引 Liu et al. 2024 的 lost-in-the-middle 作为依据）。
- 🔴 **对命题的直接冲击**：命题说"上下文 256k→1M 让模型不容易漂移"。**该文说的恰恰相反——长上下文本身就是漂移的推理期成因之一**（"long contexts dilute the influence of early-context system prompts"）。**上下文窗口变大，不自动解决这个问题；它就是这个问题的机制。**
- ⚠️ **可信度限定（必须写明）**：本文档登载在 clawrxiv.io，**本次未找到其同行评审或期刊版本的证据**；其数值（71%/89%、各缓解手段的降幅）**只应作为"有一个预印本这样报告"引用，不应作为领域共识**。且该文自陈局限：用户侧由 LLM 模拟（另有 40 段 50 轮的人类小样本，作者称"qualitatively similar"但"prevents strong claims"）；persona 签名只覆盖可量化维度，幽默/温度等未覆盖。

### 3.2 【原文·同行评审出处】persona fidelity 随对话轮次下降，且与"指令遵循"存在权衡

- **出处**：Luz de Araujo, Hedderich, Modarressi, Schuetze, Roth（2026）*Persistent Personas? Role-Playing, Instruction Following, and Safety in Extended Interactions*
- **发表处**：**EACL 2026（The 19th Conference of the EACL, Volume 1: Long Papers），pp. 5329–5359**；DOI: 10.18653/v1/2026.eacl-long.246；URL: https://aclanthology.org/2026.eacl-long.246/
- **出处位置**：**摘要**（该页 ¶28）
- **摘要原文（逐字）**：
  > "We introduce an evaluation protocol that combines long persona dialogues (**over 100 rounds**) and evaluation datasets to create **dialogue-conditioned benchmarks that can robustly measure long-context effects**. We then investigate the effects of **dialogue length** on persona fidelity, instruction-following, and safety of seven state-of-the-art open- and closed-weight LLMs. We find that **persona fidelity degrades over the course of dialogues**, especially in goal-oriented conversations, where models must sustain both persona fidelity and instruction following. We identify a **trade-off between fidelity and instruction following**, with non-persona baselines initially outperforming persona-assigned models; as dialogues progress and fidelity fades, persona responses become increasingly similar to baseline responses. Our findings highlight the **fragility of persona applications in extended interactions**."
- **【转述】三条可从摘要直接引用的结论**：① persona fidelity **随对话推进而下降**（7 个 SOTA 模型、>100 轮）；② 存在 **fidelity ↔ 指令遵循的权衡**（非 persona 基线一开始反而更好）；③ 漂移的表现是**persona 回答逐渐变得和基线回答一样**（即向"通用助手"回退——与 §3.1 的"average helpful assistant attractor"说法方向一致，但这是两条独立出处）。
- **对命题的意义**：这是**同行评审出处**，测的正是"长上下文效应"，结论是**persona 在长交互中脆弱**。**不构成"长上下文已被解决"的证据，反而是反例。**

### 3.3 漂移被归因的其它说法（登记，本次证据强度较低）

- **实体歧义 / 认知边界缺失** → 主张角色知识召回失败来自"entity ambiguity"与"lack of awareness of the character's cognitive boundaries"。
  - 出处：Wang, Leung, Shen（2025）*RoleRAG: Enhancing LLM Role-Playing via Graph Guided Retrieval*，arXiv:2505.18541v1，http://arxiv.org/abs/2505.18541v1
  - 出处位置：**摘要**
  - 摘要原文："We attribute these failures to: (1) the inability to accurately recall character-specific knowledge due to **entity ambiguity**, and (2) a **lack of awareness of the character's cognitive boundaries**."
  - 【转述】这是**检索/知识定位**层面的归因，与"上下文长度"是不同的机制。→ 若命题成立（长上下文解决一切），这一条也**不会被自动解决**。
- **未找到**：把角色漂移主要归因于"提示词结构（prompt structure）"的可核对出处。→ 见 §5。

---

## §4 对提示词架构的影响：逐条裁决

> 裁决口径：**不必要** = 已有证据表明该做法要解决的问题已被长上下文消除；**仍必要** = 证据表明问题仍在，做法仍要保留；**更重要** = 证据表明长上下文**反而放大**了该问题。
> 每条给「理由 + 出处」。**没有出处的一律标【推断】**。

### 4.1 多文件拆分（"单体 prompt 超 4000 字后注意力被稀释"）

- **裁决：仍必要（但理由要换掉，不是"4000 字"）。**
- **"4000 字"这个具体阈值**：【常见说法但未找到直接证据】——本次检索**未找到**任何公开论文/技术报告给出"4000 字"或任何具体字符阈值作为注意力稀释的拐点。该说法在本项目中来自对 AnimaTutor 设计的转述（见 `SocraticNovel_碎片化与长期陪伴_2026-09-19.md` §1.1 表内逐字引用），**属于项目内既有说法，不是文献结论**。
- **但"拆分"要解决的问题有出处**：
  - 【原文】Liu et al. 2023（arXiv:2307.03172v3，摘要）：关键信息**在开头或结尾时表现最好，在中间时显著下降**——"performance is often highest when relevant information occurs at the beginning or end of the input context, and significantly degrades when models must access relevant information in the middle"。
  - 【原文】Hsieh et al. 2024（arXiv:2406.16008v2，摘要）：存在 **U 形注意力偏置**，"tokens at the beginning and at the end of its input receive higher attention, **regardless of their relevance**"。
  - 【原文】Chroma《Context Rot》正文：填充内容的**性质**会影响结果——"adding list operations that locally cancel each other out degrades model performance more significantly compared to adding print statements"。
- **【推断·我的判断】** 拆分的价值不是"把 prompt 压到某个字数以下"，而是**把'必须被看到的东西'放进开头或结尾、把'可能干扰的东西'移出去**（对齐 Liu 2023 的首尾优势 + Chroma 的"填充内容性质"）。→ **该保留拆分，但目标要从"控字数"改成"控位置与控干扰"。**
- ⚠️ 反驳"拆分的必要性会随上下文变大而消失"的证据：**没有**。反而 §2.1/§2.2 的出处都是在"已经支持长上下文"的模型上测出来的。

### 4.2 每轮刷新锚定（每轮重新注入角色核心）

- **裁决：仍必要；且有证据表明它是对症的（不是迷信）。**
- **理由与出处**：
  - 【原文】Liu et al. 2023（arXiv:2307.03172v3，摘要）：位置影响利用率，中间最差。
  - 【原文】Hsieh et al. 2024（arXiv:2406.16008v2，摘要）：位置偏置与相关性**无关**（"regardless of their relevance"）——即**重要的东西放在中间也不会因为重要而被多看**。
  - 【原文】Persona Drift 预印本（clawrxiv，2026-04-28，§5 Discussion）："**long contexts dilute the influence of early-context system prompts in attention computations**"——**直接把"早期 system prompt 被稀释"写成长上下文导致的推理期成因**。
  - 【原文】同上，§4 Mitigations：**Periodic re-injection** 在 K=20 时把第 200 轮的漂移**降低 47%**，代价是 prompt token 总量约 +8%。
  - 【原文·厂方】Anthropic Claude 文档（context-windows）：漂移/退化的官方对策是**把上下文管理当一等公民**（"curating what's in context just as important as how much space is available"）。
- 🔴 **注意方向**：这几条证据合起来的意思是——**上下文越长，早期 system prompt 被稀释的可能性越大**，所以"每轮刷新锚定"**从"小模型时代的权宜之计"变成了"长上下文时代的对症手段"**。这与命题"长上下文让漂移不容易发生"**方向相反**。
- ⚠️ **强度限定**：47% 这个数字来自**未经同行评审的预印本**（clawrxiv），且作者自陈用户侧由 LLM 模拟。**不得当作定论引用**，只能当"有一份预印本这样报告"。

### 4.3 关键词触发式按需注入（类似 World Info / RAG 检索）

- **裁决：仍必要，但**必要性来源变了**——从"塞不进去"变成"塞进去更差 + 更贵"。**
- **理由与出处**：
  - 【原文·厂方】Anthropic Claude 文档：**"more context isn't automatically better. As token count grows, accuracy and recall degrade, a phenomenon known as _context rot_"** → 即"全部塞进去"这条路的收益是负的。
  - 【原文】Li, Li, Zhang, Mei, Bendersky（2024）*Retrieval Augmented Generation or Long-Context LLMs? A Comprehensive Study and Hybrid Approach*，arXiv:2407.16833v2，http://arxiv.org/abs/2407.16833v2，**摘要**："Results reveal that when resourced sufficiently, **LC consistently outperforms RAG in terms of average performance. However, RAG's significantly lower cost remains a distinct advantage.** Based on this observation, we propose **Self-Route**, a simple yet effective method that routes queries to RAG or LC based on model self-reflection."
  - 【转述】该文的结论**不是"长上下文让 RAG 过时"**，而是：**长上下文在资源充足时平均表现更好，RAG 的成本优势仍然显著**；其提出的方案是**按查询路由**（简单查询走 RAG，复杂查询走长上下文）。
  - 【原文】Chroma《Context Rot》正文：distractor 与无关内容会降低表现，且"how the type of 'irrelevant content' matters"。
- **【推断·我的判断】** 对本项目而言，这条的结论是：**不要因为窗口大了就取消按需注入**；要取消的是"因为塞不下才按需注入"这个理由——**新的理由是"塞进去会引入 distractor，且引入 distractor 有实测代价"**。

### 4.4 摘要压缩历史对话

- **裁决：更重要（而且这是厂方自己的首选策略）。**
- **理由与出处**：
  - 【原文·厂方】Anthropic Claude 文档：**"As conversations grow, you'll eventually approach context window limits. For long-running conversations and agentic workflows, server-side compaction is the primary strategy for context management."**（同页还有一节专门讲 compaction）。
  - 【原文】Persona Drift 预印本 §4：**Summary-and-restate** 使第 200 轮漂移**降低 53%**，代价是 token 总量平均 **+18%**（因其自身要生成摘要 token）。
  - 【原文】Chroma《Context Rot》正文：16 个模型里"model performance degrades as input length increases"——**不压缩＝让输入长度继续增长＝继续踩这条曲线**。
- 🔴 **对命题的意义（关键）**：如果"上下文变大就不需要压缩"成立，那么**厂商在自己的 1M 默认产品文档里不会把 compaction 写成 primary strategy**。这条证据本身即是对命题的反驳。
- ⚠️ **强度限定**：53%/18% 来自**未评审预印本**；Anthropic 的"primary strategy"是**厂方建议**（vendor guidance），不是实测基准结论——引用时须区分。

### 4.5 向量检索式长期记忆

- **裁决：仍必要（但本次**未找到**"向量检索 vs 长上下文"的直接对照实证）。**
- **可引用的相邻出处**：
  - 【原文】Li et al. 2024（arXiv:2407.16833v2，摘要）：RAG（含检索式记忆）**成本显著更低**，且在简单查询上与长上下文可比；该文主张**路由而非替换**。
  - 【原文】Post-§2.4 登记：Chroma 报告把 distractor 的负面影响列为实验发现之一。
- **【推断·我的判断】** 加一条**证据之外的**理由（明确标推断）：向量检索的价值在本项目里不只是"省 token"，还有**可审计性**（能说出"这条记忆是从哪个文件哪一段来的"）——这一条**本次未找到公开出处**，是项目自身需求，**不作为文献结论**。

### 4.6 全部教材一次性放进上下文

- **裁决：被证据反驳（这是 6 条里唯一一条有明确反面证据的）。**
- **理由与出处（多条独立）**：
  1. 【原文·厂方】Anthropic Claude 文档：**"more context isn't automatically better. As token count grows, accuracy and recall degrade"**。
  2. 【原文】Chroma《Context Rot》正文：18 个模型、固定任务复杂度只变长度 → "nonuniform performance with increasing input length"；NIAH 近乎满分造成的"长上下文已解决"是"**perception**"。
  3. 【原文】RULER（arXiv:2404.06654v3，摘要）：宣称 ≥32K 的模型**只有一半**能在 32K 维持满意表现。
  4. 【原文】NoLiMa（arXiv:2502.05167v3，摘要）：128K–1M 档模型在 32K 上 11/13 跌破基线一半；GPT-4o 99.3%→69.7%。
  5. 【原文】Rizwan et al. 2026（arXiv:2609.08574v2，摘要）：**"where a fact sits in the context changes whether the model finds it"**、**"two habits limit how much of that window is used"**。
- 【推断·我的判断】对教室的具体含义：把"整个学期的教材"一次塞进去，**不是"信息更全"，而是"给每一节课都加了一层 distractor 与更长的输入"**。

---

## §4.5 🔴 落到我们自己的教室：哪些文件现在可以合并（本地实测，不靠网页）

> ⚠️ **编号说明**：本节编号「§4.5」是**章号**，与 §4 内部的条目「4.5 向量检索式长期记忆」**无关**（后者是第 5 条旧做法）。引用时请写「§4.5 本机实测节」以免混淆。
>
> 本节**全部数据来自本机实测**（`wc -c` / `wc -m` / `python3` 逐文件统计），**不含网页推断**。
> 目标仓库：`/Users/wujunjie/SocraticNovel-GitHub仓库/AP_Physics_EM/`（`find . -type f -not -path "./.git/*" | wc -l` = **52**，与任务书所述一致）。
> **实测时间**：2026-09-22。

### 4.5.0 token 粗估口径（先声明，别当精确值）

实测：本仓库中文文件里 **CJK 字符占比 43%–80%**（§4.5.1 表）。故用**混合口径**：

- **口径 A（简化）**：`token ≈ 字符数 ÷ 1.6`（适用于中英混排的粗估）
- **口径 B（分语种）**：`token ≈ CJK 字数 × 1 + 其余字符数 ÷ 4`
- 两口径对同一文件的结果相差约 15%（如 `system_core.md`：A=5799，B=6775）
- 🔴 **两者都是粗估，不精确**。若要精确必须用真实 tokenizer 跑一遍（本次未做）。下文**统一采用口径 B**（更保守，倾向高估）。

### 4.5.1 实测文件清单与体量（按目录汇总）

| 目录 | 文件数 | 字节 | 字符 | CJK 字 | CJK 占比 | token(口径B) |
|---|---:|---:|---:|---:|---:|---:|
| `teacher/config/`（不含 `knowledge_points/`） | 4 | 34,877 | 16,217 | 8,127 | 50.1% | **10,362** |
| `teacher/config/knowledge_points/` | 6 | 12,512 | 6,491 | 2,810 | 43.3% | **3,513** |
| `teacher/runtime/` | 9 | 10,542 | 4,958 | 2,512 | 50.7% | **3,124** |
| `teacher/story_progression/`（`ch*.md` 10 个） | 10 | 23,350 | 8,690 | 6,386 | 73.5% | **6,961** |
| `teacher/story_progression/`（非 ch：overview/appendix/unit_tests/exam_epilogue） | 4 | 16,937 | 7,255 | 4,285 | 59.1% | **5,146** |
| `teacher/characters/` | 3 | 41,744 | 15,068 | 11,827 | 78.5% | **13,594** |
| `teacher/reference/`（幽鬼文笔标杆，**教学时不加载**） | 1 | 61,032 | 21,655 | 17,301 | 79.9% | **20,714** |
| 根目录 `AGENTS.md` + `MAINTAINER.md` | 2 | 28,478 | 16,005 | 5,130 | 32.1% | **7,633** |
| `archive/`（6 个，**归档，不加载**） | 6 | 119,804 | — | — | — | — |
| `materials/`（**只有 README 与 .DS_Store**，教材 PDF 因版权未入公开仓库） | 2 | 8,663 | — | — | — | — |

**逐文件明细（教学相关，字节实测）**

| 文件 | 字节 | 行数 |
|---|---:|---:|
| `AGENTS.md` | 7,233 | 117 |
| `MAINTAINER.md` | 21,245 | 384 |
| `teacher/config/system_core.md` | 21,553 | 368 |
| `teacher/config/system_reference.md` | 6,480 | 145 |
| `teacher/config/curriculum.md` | 5,401 | 102 |
| `teacher/config/learner_profile.md` | 1,443 | 35 |
| `teacher/config/knowledge_points/overview.md` | 1,239 | 24 |
| `teacher/config/knowledge_points/ch21.md` | 1,824 | 26 |
| `teacher/config/knowledge_points/ch22.md` | 2,249 | 32 |
| `teacher/config/knowledge_points/ch23.md` | 2,369 | 33 |
| `teacher/config/knowledge_points/ch24.md` | 2,765 | 38 |
| `teacher/config/knowledge_points/ch25.md` | 2,066 | 32 |
| `teacher/story.md` | 10,703 | 179 |
| `teacher/prologue.md` | 14,180 | 201 |
| `teacher/characters/rin.md` | 13,513 | 198 |
| `teacher/characters/ritsu.md` | 13,118 | 164 |
| `teacher/characters/saku.md` | 15,113 | 175 |
| `teacher/story_progression/overview.md` | 6,909 | 137 |
| `teacher/story_progression/appendix.md` | 5,544 | 94 |
| `teacher/story_progression/unit_tests.md` | 2,188 | 63 |
| `teacher/story_progression/exam_epilogue.md` | 2,296 | 48 |
| `teacher/story_progression/ch23_gauss.md` | 2,637 | 38 |
| `teacher/story_progression/ch24_potential.md` | 1,889 | 27 |
| `teacher/story_progression/ch25_capacitor.md` | 2,021 | 36 |
| `teacher/story_progression/ch26_current.md` | 2,264 | 29 |
| `teacher/story_progression/ch27_kirchhoff.md` | 1,795 | 26 |
| `teacher/story_progression/ch28_magnetic.md` | 2,166 | 28 |
| `teacher/story_progression/ch29_ampere.md` | 2,817 | 31 |
| `teacher/story_progression/ch30_faraday.md` | 2,373 | 35 |
| `teacher/story_progression/ch31_oscillation.md` | 2,712 | 36 |
| `teacher/story_progression/ch32_maxwell.md` | 2,676 | 33 |
| `teacher/runtime/`（9 个） | 10,542 | 223 |
| `teacher/reference/幽鬼_prompt_v6_文笔标杆.md` | 61,032 | 1,005 |

🔴 **关键实测发现（直接关系到"要不要合并"）**：
1. **真正每课都被读的体量极小**。按 §4.5.2 的启动顺序，第一步 5 个文件合计 **40,917 字节 ≈ 12,975 token**（口径B）。
2. **第二步（课前按需）再加 5 个文件** 23,258 字节 ≈ 7,451 token；**第一+第二步合计 64,175 字节 ≈ 20,426 token**。
3. **真正的大块头（`reference/幽鬼_prompt_v6` 61KB ≈ 20.7k tok、`archive/` 120KB、`MAINTAINER.md` 21KB、`characters/` 41.7KB）根本不在每课必读路径上**。
4. **但 `characters/` 里 3 个角色文件里，每节课只读 1 个**（由 `progress.md` 排班决定）——见 §4.5.3 第 2 条，这是**现成的、免费的 token 优化**。

**结论（先给一句）**：**这间教室并不"因为文件太多而 token 爆掉"——每课必读的只有约 20k token。真正的浪费不在"文件数量"，而在① `system_core.md` 把三种职责混在一份里；② 非当课角色的两个文件被放在可以整体读的位置。** 因此"合并文件"能省的不是 token，而是**降低污染与误读风险**（见 §4.5.5 的风险栏）。

### 4.5.2 现成的三级加载机制原文（`AGENTS.md`，117 行）

**实测原文（照抄，不改写）**：

| 级别 | 原文标题 | 原文列出的文件 |
|---|---|---|
| **第一步** | "加载核心（必须完整读取）" | 1 `teacher/config/system_core.md` 2 `teacher/story.md` 3 `teacher/story_progression/overview.md` 4 `teacher/config/learner_profile.md` 5 `teacher/runtime/progress.md` |
| **第二步** | "按需加载（课前必须完成）" | 6 `teacher/runtime/review_queue.md` 7 当课老师的角色文档（`teacher/characters/`，由 `progress.md` 排班决定）8 `teacher/story_progression/ch{XX}_{name}.md` 9 本节课对应的教材章节 10 `teacher/config/knowledge_points/ch{XX}.md` **仅当课章节** 11 `teacher/runtime/wechat_group.md` |
| **第三步** | "延迟加载（用到时再读）" | `runtime/session_log.md`、`runtime/session_archive.md`、`runtime/mistake_log.md`、`runtime/diary.md`、`runtime/wechat_unread.md`、`runtime/temp_math.md`、**非当课老师的角色文档**、`config/curriculum.md`、`config/knowledge_points/overview.md`、`config/system_reference.md`、`story_progression/appendix.md`、`story_progression/unit_tests.md` |

**原文硬约束（逐字）**：
> "**不得跳过第一步和第二步。不得在读完上述文件之前开始教学。**"

**原文关于 `system_core.md` 的自述（`AGENTS.md` 项目结构注释行，逐字）**：
> "`system_core.md` # 核心指令（**始终加载**，~19KB）"

→ 🔴 **实测字节 21,553（≈21.6KB），注释写的是 ~19KB**。**该注释已过期**（差约 2.5KB / 12%）。这是一条可立即修的小 bug，登记在 §6。

**由三级机制推出的事实（【推断】，但依据是上面原文）**：
- **每课必读**：第一步 5 个 + 第二步 4–5 个 ≈ **10 个文件、约 20.4k token**。
- **几乎不读**：`archive/`（119.8KB）、`teacher/reference/`（61KB）、`MAINTAINER.md`（21.2KB）、`teacher/prologue.md`（14.2KB，仅首次启动）、非当课角色 2 个（28.6KB）。
- **🔴 一个可疑项**：`AGENTS.md` 把"**非当课老师的角色文档**"列为**第三步（用到才读）**，但 §4 引到的证据（位置偏置 regardless of relevance、注意力稀释）说明：**把 28.6KB 的两个非当课角色放在"可随时整体读"的位置，其唯一的实际风险是——某次群聊生成时把它们整体读进来，此时队首/队尾的位置分配会决定谁被真正"看见"**。这是**推断**，不是实测。

### 4.5.3 🔴 六条旧做法 → 落到具体文件的裁决

| # | 旧做法 | 影响的**具体文件** | 在 1M 下该怎么改 | 依据 |
|---|---|---|---|---|
| 1 | **多文件拆分**（"单体超 4000 字注意力稀释"） | `teacher/config/system_core.md`（21,553B，**单文件最大且始终加载**）；`teacher/story.md`（10,703B）；`story_progression/*` | **保留拆分，但换理由**：不再为"控 4000 字"而拆，而为"**把必须被看到的放首尾、把干扰移出**"而拆。🔴 **优先处理 `system_core.md`**——它一份里混了**教学法 + 叙事规则 + 角色声音 + 流程 + 复习系统 + 做题系统**六类职责（见下方结构实测），是"拆分收益最高"的单一对象 | 出处：Liu 2023（arXiv:2307.03172v3）首尾优势；Hsieh 2024（arXiv:2406.16008v2）U 形偏置 regardless of relevance；Chroma 正文（填充内容性质影响结果）。"4000 字"阈值【常见说法但未找到直接证据】 |
| 2 | **每轮刷新锚定** | `teacher/config/system_core.md`（§"三条铁律（永远在工作记忆中）"485B、§"防漂移机制"、§"5. 角色声音速查"2,128B）；`teacher/characters/{rin,ritsu,saku}.md` | **保留并强化**：把"必须每轮在场的锚"（铁律 + 当课角色声音）单独抽成一节，**放上下文最前或最后**。🔴 **现成的免费优化**：`characters/` 三个文件每节课**只需 1 个**（排班决定），但三者合计 **41,744B ≈ 13.6k tok**——**非当课的 2 个（28,631B）不该进每课上下文** | 出处：Liu 2023 首尾优势；Hsieh 2024 regardless of relevance；Persona Drift 预印本（clawrxiv 2026-04-28）§5 "long contexts dilute the influence of early-context system prompts in attention computations" + §4 periodic re-injection K=20 降 47%（**未评审**） |
| 3 | **关键词触发式按需注入**（World Info / RAG 式） | **现成的按需机制已在跑**：`config/knowledge_points/ch{XX}.md`（**仅当课章节**，6 个共 12,512B）、`story_progression/ch{XX}*.md`（10 个共 23,350B）、`runtime/{session_log,mistake_log,diary,wechat_unread,temp_math}.md`（第三步，合计 5,085B） | **保留，且理由要从"塞不下"改成"塞进去更差"**。→ `knowledge_points/` 与 `story_progression/ch*` 的按章拆分**必须留**（这是本项目最符合证据的结构） | 出处：Anthropic Claude 文档 "more context isn't automatically better. As token count grows, accuracy and recall degrade, a phenomenon known as context rot"；Li et al. 2024（arXiv:2407.16833v2）摘要"LC consistently outperforms RAG… However, RAG's significantly lower cost remains a distinct advantage"＋路由方案；Chroma 正文 distractor 段 |
| 4 | **摘要压缩历史对话** | `teacher/runtime/session_log.md`（1,370B，**头部已含压缩归档规则**）、`runtime/session_archive.md`（409B）、`runtime/wechat_group.md`（3,692B，**唯一会持续增长的文件**） | **保留，且升格**：`wechat_group.md` 是目前**唯一一个随使用单调增长、且在第二步就被读**的文件→它就是本项目 compaction 的**唯一必需落点**。`session_log.md` 头部已有规则，**机制已具备，不需要新建** | 出处：Anthropic Claude 文档 "For long-running conversations and agentic workflows, **server-side compaction is the primary strategy for context management**"；Persona Drift 预印本 §4 summary-and-restate 降 53%/token +18%（**未评审**）；Chroma 正文 "performance degrades as input length increases" |
| 5 | **向量检索式长期记忆** | `runtime/mistake_log.md`（754B）、`runtime/review_queue.md`（1,047B）、`runtime/diary.md`（1,524B） | **保留**。实测这三个文件**合计仅 3,325B** → **本项目的瓶颈根本不在它们的体量**。→ 【推断】向量检索在本项目的真实价值是**可审计性**（能说出这条记忆出自哪个文件哪一段），**不是省 token**；该价值主张**本次未找到公开出处** | 出处（成本优势）：Li et al. 2024 摘要 "RAG's significantly lower cost remains a distinct advantage"。可审计性＝【推断】 |
| 6 | **全部教材一次性放进上下文** | `materials/`（**实测只有 README + .DS_Store，共 8,663B；教材 PDF 因版权不在公开仓库**）；`teacher/reference/幽鬼_prompt_v6_文笔标杆.md`（**61,032B，教学时不加载**） | 🔴 **不要做**。教材按 `curriculum.md` 的章节路径**逐节取**（`AGENTS.md` 原文已如此规定），**不要整册载入**。`reference/幽鬼_prompt_v6`（20.7k tok）**保持"不加载"即可**——它已是仓库里最大的单个文件，且不在启动序列里，**这一点现行设计是对的** | 出处：Anthropic Claude 文档 "more context isn't automatically better"；Chroma 正文（18 模型、固定复杂度只变长度仍退化）；RULER 摘要（宣称≥32K 只有一半能在 32K 维持）；NoLiMa 摘要（32K 上 11/13 跌破基线一半）；Rizwan et al. 2026 摘要 "where a fact sits in the context changes whether the model finds it" |

**`system_core.md` 内部结构实测**（决定第 1 条怎么拆；单位为**字节**，按 `##`/`###`/`####` 标题粗切，脚本统计）

| 一级职责块 | 字节 |
|---|---:|
| 你是谁（650） | 650 |
| 核心原则 → 1. 苏格拉底教学法（含三条铁律 485／防模式切换 586／关键规则 2,077／五级支持梯度 809／学生反问 301／学生类型预案 578／快速自检 786） | ≈5,850 |
| 核心原则 → 4. 叙事规则（绝对红线 623／视角 485／散文标准 1,074／叙事节奏 496／角色真实感 431／叙事优先级 684／学习者主体性 801） | ≈4,595 |
| 核心原则 → 5. 角色声音速查 | 2,128 |
| 上课流程（课前 2,380／过渡 257／课中 1,112／课后更新 511） | ≈4,260 |
| 复习系统规则（间隔复习 549／掌握度双轨 234） | ≈784 |
| 做题系统规则（随堂 245／错题 132／模块测验 164） | ≈541 |
| 老师轮值 | 233 |
| 防漂移机制 | （尾节，未单独计） |
| **合计（实测）** | **21,553** |

→ 🔴 **实测结论**：`system_core.md` 里 **叙事规则 ≈4,595B** 与 **苏格拉底教学法 ≈5,850B** 是**两个不同物种**（一个管"故事怎么说"，一个管"教学正确不正确"），却同在"始终加载"的一份里。**这正是 §4.5.5 红线所指的那个结构。**

### 4.5.4 建议合并表

> **判定规则**：**为省 token 而拆的 → 可以合并；职责不同（尤其叙事 vs 教学正确性）的 → 不合并。**
> 字节数全部来自 §4.5.1 的 `wc` 实测。

| 现在（文件/字节） | 建议（合并成几个） | 理由 | 风险（写实话） |
|---|---|---|---|
| `story_progression/` 的 10 个 `ch*.md`（**23,350B 合计，单文件 1,795–2,817B，平均 2,335B ≈ 900 tok**） | **按单元合并为 5 个**（U1=ch23-24／U2=ch25／U3=ch26-27／U4=ch28-30／U5=ch31-32；单元映射见 `overview.md` 实测第 24–28 行） | 🔴 **收益很小**：每节课只读 1 章（≈900 tok），合并后 U4 也只有 7,356B ≈ 2,300 tok。**省下的 token 微不足道** | ① **合并会破坏"当章定位"**：现在按章文件名直接对应，合并后每次都要在同一文件里找章——**多一次检索，反而多一层出错机会**；② 与 §4.5.3 第 3 条（按需注入）**方向相反**。→ **结论：不建议合并**，保持 10 个 |
| `teacher/config/knowledge_points/` 6 个（**12,512B**；5 个 `ch*.md` 合计 11,273B） | **不建议合并**（保持按章 + overview） | 每课只取当章（1,824–2,765B ≈ 700–1,100 tok）；overview 兼作"更新规则"说明 | 合并后 overview 的"更新规则"与"各章 LO"混在一起，**写回时易误改其他章**（这是"职责不同"的例子之一） |
| `teacher/runtime/session_log.md`（1,370B）＋ `session_archive.md`（409B） | **可以合并为 1 个**（当前合计 1,779B） | 两者是同一职责（历史回顾）的两段：log = 近期，archive = 更早；`AGENTS.md` 也已把它们并列在第三步 | 合并后需保留"压缩归档规则"在文件头部（现 `session_log.md` 头部有）；**风险低**，但**收益也低**（1.7KB）。→ 优先级排最后 |
| `teacher/runtime/temp_math.md`（1,247B，**每课清空**）与其它 runtime 文件 | **不合并** | 它是**唯一"用完即弃"**的文件（头部含公式格式规则、每课清空），生命周期与其它 runtime 文件不同 | 合并会让"每课清空"波及到不该清空的内容 → **这是"职责不同"的典型，红线适用** |
| `teacher/config/system_reference.md`（6,480B，按需）＋ `system_core.md` 的叙事规则节（≈4,595B） | **不合并**（保持分离） | 两者在 `AGENTS.md` 里已被正确区分（core=始终加载，reference=校准检查时参考） | 合并会把"按需"的东西拖进"始终加载"，**直接增加每课上下文** —— 方向错误 |
| 🔴 `teacher/config/system_core.md`（**21,553B，始终加载**） | **建议拆为 2 份**：**A. 教学正确性核心**（苏格拉底教学法+铁律+五级梯度+自检+复习系统+做题系统+老师轮值 ≈ 7,400B）｜**B. 叙事与角色声音**（叙事规则 4,595B+角色声音速查 2,128B ≈ 6,700B）｜上课流程（≈4,260B）可视需要并入 A 或独立 | ① **它不是"为省 token 而拆的"，而是"职责不同"必须拆**——A 管"教得对不对"，B 管"故事怎么说"，**放同一个始终加载的文件里，是叙事污染教学正确性的最高风险位置**；② 拆后 A（≈7.4k）可继续"始终加载"，B（≈6.7k）改为**与当课角色文件一起在第二步加载**（本来就每课都要角色声音），**每课总量不增反可减**；③ 符合 §4.5.3 第 1/2 条的"位置与干扰"口径 | 🔴 **风险（实话）**：① **拆分会制造版本分叉风险**——现在"绝对红线""叙事优先级"等条目可能与教学规则在同一段里有交叉引用，拆开后若一处改另一处未改，会出现**两份文件互相矛盾**，比现状更糟；② 拆分**不会省 token**（总量不变），甚至略增（两份的标题与前言）；**它的收益是"污染面变小 + 可以单独把叙事规则放到队尾"**，不是省钱；③ **【推断】拆到哪一行是判断题，本次没有实测证据告诉你最优切分点**——建议先只做"最小切分"（把 `### 4. 叙事规则` + `### 5. 角色声音速查` 整块移出，约 6.7KB），**不要一次大改** |

### 4.5.5 一句话落到动作

- **值得做的**（按性价比排序）：
  1. **`system_core.md` 最小切分**（移出叙事规则+角色声音 ≈6.7KB）→ 把"叙事 vs 教学正确性"的红线结构问题解决，且**叙事块可放到队尾**（对齐 Liu 2023 首尾优势）。
  2. **确认非当课角色文件不整体加载**（可省 28,631B / ≈9.2k tok，是仓库里**最大的一笔可避免开销**）。
  3. **`wechat_group.md` 的压缩规则**——它是唯一单调增长且每课必读的文件。
- **不值得做的**：合并 `story_progression/ch*`（省约 0 token、增出错面）、合并 runtime 小文件（3,124B 总量，本来就不是瓶颈）、把教材整册载入。
- **顺带修一处漂移**：`AGENTS.md` 里 `system_core.md` 的注释写 "**~19KB**"，实测 **21,553B**。

---

## §5 未找到的部分（列出已试检索词与 URL）

| 想找的东西 | 已试检索词 / 入口 | 结果 |
|---|---|---|
| 2025–2026 年**旗舰 1M 模型**上重测 lost-in-the-middle 的专门论文 | `lost in the middle`（arXiv 学术检索）；`context rot long context performance degradation input length`（Semantic Scholar） | **未找到**。找到的最新专论仍是 2023 原始文与 2024 的 calibration 文。Semantic Scholar 本次两次返回 HTTP 429（免 key 额度 100 req/5min 用尽），**属于渠道受限，不等于"不存在"** |
| "**4000 字**"（或任何具体字符阈值）作为注意力稀释拐点的出处 | 本仓库全量 grep `4000 字`（命中 4 处，**全部是本项目对 AnimaTutor 设计的转述**，非文献）；网页检索无专门检索 | **未找到公开出处**。→ 标 【常见说法但未找到直接证据】 |
| 把**角色漂移**主要归因于"提示词结构（prompt structure）"的可核对出处 | `persona drift role-playing language model long conversation`（arXiv）；`persona drift LLM role-play long conversation cause study`（web） | **未找到**直接出处。找到的归因是：训练期回退 + 推理期上下文稀释（clawrxiv 预印本）、实体歧义（RoleRAG） |
| Chroma《Context Rot》的**具体百分比/曲线** | 抓 https://www.trychroma.com/research/context-rot （deepresearch_fetch，via jina） | **未取到**：页面在 Related Work 之后被截断（约 ¶57）。已取到的是 Introduction/Contributions 的文字结论。**不得编造数字** |
| **"向量检索 vs 长上下文"的直接对照实测**（本项目场景：文件式记忆 vs 全量上下文） | `long context versus retrieval augmented generation comparison`（arXiv）；`long context window vs retrieval augmentation RAG necessary`（Semantic Scholar → 429） | **未找到**本项目口径的对照实验。找到的最近似：Li et al. 2024（arXiv:2407.16833v2）的一般性 RAG vs LC 比较 |
| 厂商侧"**长上下文足够大后不再需要 RAG**"的正式主张 | OpenAI GPT-4.1 prompting guide（web.archive 与直连均 403）；`GPT-4.1 1M context window technical report MRCR benchmark degradation` | **未取到原文**（403）。🟡 **线索（未验证）**：搜索摘要提到 GPT-4.1 / Gemini / Claude "score nearly 100% on single-needle retrieval across their full context"（来源为第三方站点 vectoringai.com，**非厂商原文，本次未抓取，不作依据**） |
| **"1M 上下文下位置偏置已消除"**的证据 | 见上各条 | **未找到**；反而找到 2026-09 的预印本说"where a fact sits in the context changes whether the model finds it"（arXiv:2609.08574v2） |

**渠道限制说明（影响可检索面）**：
- `web_fetch` 对若干域名报 "resolves to a non-public IP address"（如 `www.trychroma.com`、`aclanthology.org`）→ 改走 `deepresearch_fetch`（Jina Reader）后成功。
- `firecrawl_scrape` / `firecrawl_search`：**未配置 API key，不可用**。
- `web.archive.org` 镜像与 `cookbook.openai.com`：**403**。
- Semantic Scholar：**429（免 key 共享额度耗尽）**。

---

## §6 待确认清单

> 本子代理**未调用任何询问类工具**（按纪律）。以下为需用户/主代理拍板的项，**在拍板前不得当定论**。

1. **【待确认·影响 §4.5】`system_core.md` 是否执行"最小切分"**：把 `### 4. 叙事规则`（≈4,595B）+ `### 5. 角色声音速查`（2,128B）整块移出成新文件，改为第二步加载。
   - 倾向：**建议做，但先只做这一处最小切分**；理由见 §4.5.4 风险栏（拆分不省 token，收益是"污染面变小"）。
   - 需拍板点：**是否接受"拆分后可能出现两份文件互相矛盾"的维护风险**（这是拆分的主要代价）。
   - 若拒绝：§4.5 的其它建议仍独立成立（尤其第 2 条）。
2. **【待确认·影响 §4.5】`AGENTS.md` 中"非当课老师的角色文档"这一条**：现行写法把它放在**第三步（用到再读）**，但它**没有写"只能读摘要/声音速查段"**。是否要改成"**非当课角色只读 `### 角色声音速查` 对应段，不整体载入**"？（可避免 28,631B ≈ 9.2k tok）——**这属于改项目约定，需用户同意**。
3. **【待确认·事实核对】`AGENTS.md` 注释 "system_core.md ~19KB" vs 实测 21,553B**：是否确认为"注释过期"（我的判断）而非"我量错了"？量法：`wc -c teacher/config/system_core.md`。
4. **【待确认·引用强度】clawrxiv 预印本（2026-04-28）能否进本项目文档**：它是 §3／§4 中**唯一直接说"长上下文稀释早期 system prompt"的出处**，且给出 47%/53%/31% 的缓解幅度——但**未见同行评审**。
   - 选项 A：全文引用但每次标"未评审预印本"（本报告已如此处理）。
   - 选项 B：只保留其"方向性论断"，**不引用任何百分比**。
   - 倾向：**A，但百分比一律不进对外材料**。
5. **【待确认·口径】token 估算口径**：本报告 §4.5 用**口径 B（CJK×1 + 其余÷4）**，与口径 A（字符÷1.6）差约 15%。若要精确，需用真实 tokenizer 重跑——**本次未做**。
6. **【待确认·范围】`archive/`（119,804B，6 文件）**是否已彻底退出加载路径？本报告依据 `AGENTS.md` 的三级列表（其中未出现 `archive/`）判定"不加载"，**但未在代码/配置层面找到硬性排除**（本项目是"靠指令加载"而非"靠脚本加载"，故排除依赖的是 AI 遵守 AGENTS.md）。→ 这是**机制层面的事实**，需确认。

---

## §7 来源清单

> 每条：标题 / 作者 / 年份 / URL / **结论出自摘要还是正文**。
> 🔴 标注 **【未评审】** 者为预印本或厂方文档，**不得当作同行评审结论**。

| # | 标题 | 作者 | 年份 | URL | 出处位置 |
|---|---|---|---|---|---|
| S1 | *Lost in the Middle: How Language Models Use Long Contexts* | Nelson F. Liu, Kevin Lin, John Hewitt, Ashwin Paranjape, Michele Bevilacqua, Fabio Petroni, Percy Liang | 2023 | http://arxiv.org/abs/2307.03172v3 | **摘要** |
| S2 | *Found in the Middle: Calibrating Positional Attention Bias Improves Long Context Utilization* | Cheng-Yu Hsieh, Yung-Sung Chuang, Chun-Liang Li, Zifeng Wang, Long T. Le, Abhishek Kumar, James Glass, Alexander Ratner, Chen-Yu Lee, Ranjay Krishna, Tomas Pfister | 2024 | http://arxiv.org/abs/2406.16008v2 | **摘要** |
| S3 | *RULER: What's the Real Context Size of Your Long-Context Language Models?* | Cheng-Ping Hsieh, Simeng Sun, Samuel Kriman, Shantanu Acharya, Dima Rekesh, Fei Jia, Yang Zhang, Boris Ginsburg | 2024 | http://arxiv.org/abs/2404.06654v3 | **摘要** |
| S4 | *NoLiMa: Long-Context Evaluation Beyond Literal Matching* | Ali Modarressi, Hanieh Deilamsalehy, Franck Dernoncourt, Trung Bui, Ryan A. Rossi, Seunghyun Yoon, Hinrich Schütze | 2025 | http://arxiv.org/abs/2502.05167v3 | **摘要** |
| S5 | *Context Rot: How Increasing Input Tokens Impacts LLM Performance* | Chroma（**具体作者名单本次未取到，不臆测**） | 2025-07-14 | https://www.trychroma.com/research/context-rot ；代码 https://github.com/chroma-core/context-rot | **正文**（Introduction／Contributions／Related Work；**页面在 ¶57 后截断，具体数值未取到**） |
| S6 | *Persona Drift Across Long Multi-Turn Conversations with Large Language Models* **【未评审·预印本】** | 本次未取到作者名单（页面未列） | 2026-04-28 | https://clawrxiv.io/abs/2604.01980 | **正文**（§1/§3/§4/§5 Discussion/§6 Limitations） |
| S7 | *Persistent Personas? Role-Playing, Instruction Following, and Safety in Extended Interactions* | Pedro Henrique Luz de Araujo, Michael A. Hedderich, Ali Modarressi, Hinrich Schuetze, Benjamin Roth | 2026 | https://aclanthology.org/2026.eacl-long.246/ ；DOI 10.18653/v1/2026.eacl-long.246 ；EACL 2026 Long Papers pp. 5329–5359 | **摘要** |
| S8 | *RoleRAG: Enhancing LLM Role-Playing via Graph Guided Retrieval* | Yongjie Wang, Jonathan Leung, Zhiqi Shen | 2025 | http://arxiv.org/abs/2505.18541v1 | **摘要** |
| S9 | *Do New Attention Mechanisms Actually Fix Attention Sinks at Million-Token Context?* **【未评审·预印本】** | Sara Rizwan, Samaanah Abdus Salam, Mohammed Mudassir Uddin | 2026（v1 09-08／v2 09-18） | http://arxiv.org/abs/2609.08574v2 | **摘要** |
| S10 | *Retrieval Augmented Generation or Long-Context LLMs? A Comprehensive Study and Hybrid Approach* | Zhuowan Li, Cheng Li, Mingyang Zhang, Qiaozhu Mei, Michael Bendersky | 2024 | http://arxiv.org/abs/2407.16833v2 | **摘要** |
| S11 | *Context windows*（产品文档）**【厂方文档·非论文】** | Anthropic | 页面无日期（**本次抓取于 2026-09-22**） | https://platform.claude.com/docs/en/build-with-claude/context-windows | **正文**（"How the context window works" / "Manage context with compaction"） |
| S12 | *The First Drop of Ink: Nonlinear Impact of Misleading Information in Long-Context Reasoning* | 本次未取到作者名单 | （arXiv 编号 2605.10828v1） | https://arxiv.org/html/2605.10828v1 | ⚠️ **仅取到页面开头段，未形成结论，仅登记为线索，未在任何裁决中使用** |
| S13 | *Thus Spake Long-Context Large Language Model*（综述） | Xiaoran Liu, Ruixiao Li, Mianqiu Huang, Zhigeng Liu, Yuerong Song, Qipeng Guo, Siyang He, Qiqi Wang, Linlin Li, Qun Liu, Ziwei He, Yaqian Zhou, Xuanjing Huang, Xipeng Qiu | 2025 | http://arxiv.org/abs/2502.17129v2 | **摘要**（登记为综述入口，**本报告未用其结论**） |

**本机实测来源（§4.5）**：
- 仓库：`/Users/wujunjie/SocraticNovel-GitHub仓库/AP_Physics_EM/`（52 个非 .git 文件）
- 命令：`find . -type f -not -path "./.git/*" | xargs wc -c -l`；目录汇总用 `python3` 逐文件解码统计（字节／字符／CJK 字数／CJK 占比）；token 用口径 B 估算
- 现成加载机制原文：`AP_Physics_EM/AGENTS.md`（117 行，"启动顺序（强制）"三步）
- 单元映射：`teacher/story_progression/overview.md` 第 22–28 行（U1=Ch.21-24／U2=Ch.25／U3=Ch.26-27／U4=Ch.28-30／U5=Ch.31-32）

---

## §8 一句话结论（不是建议，是本次证据能支撑的最大范围）

**证据支持**：上下文窗口确实从 128K/256K 级扩到 1M 级，且这是可核实的厂商事实（Anthropic："1M is the default"）。
**证据不支持**：窗口变大**没有**消除位置偏置、长度衰减、distractor 干扰与角色漂移；**有多个独立出处表明长上下文本身就是漂移的一个成因**（"long contexts dilute the influence of early-context system prompts"），且**厂商自己在 1M 已成默认的产品文档里把"压缩历史"定为 primary strategy**。
**最可操作的一条**：把"旧经验"里的**阈值（4000 字）与理由（塞不下）**换成**位置与干扰的口径**（把必须被看到的东西放首尾、把可能干扰的移出去），并按此重审我们自己的加载顺序与 `system_core.md` 的职责切分。

---
