# 角色扮演式家教系统 · 模型选型证据（2026-09-22）

> 调研子代理产出。**信源纪律**：每一条都标【原文】（抓到的页面上明写的）/【口碑】（社区主观）/【推断】（我的推理）。
> ⚠️ **本报告的一条前置警告**：本会话环境日期为 **2026-09-22**。抓取中出现的若干模型（如 "Claude Fable 5"、"Gemini 3.8 Flash"、"DeepSeek V4 Pro"、"GPT-6 Astra"）**超出调研者自身知识范围**，本报告只照录页面原文，**不对其真实性背书**；凡属此类，均标【原文·待独立核实】。若主代理能独立核实，请以核实结果为准。
> ⚠️ **第二位警告（本报告最重要的方法论警告）**：抓取过程中发现，**大量第三方站点镜像/转载 LMArena 榜单，且会给出与 LMArena 官方不同的名次**。→ 凡引用排名，**必须以 lmarena.ai 官方页为准**；第三方镜像一律降级为【口碑/二手】。

## 摘要（8 条）

1. 🔴 **"单轮好"与"长对话好"是负相关的两种能力**——PlotPoints 人类盲投实测 **Spearman ρ = −0.24**（单轮榜第 1 的 Gemma 4 26B 在 12 轮榜掉到 #15）。**选长对话家教模型不能用单轮体感或单轮榜。**【原文·人类盲投】
2. **LMArena 已无 Roleplay 独立分类**（官方导航逐项已录），**不存在权威"角色扮演总榜"**；且该榜 Creative Writing 分类**未标注快照日期**，本次只抓到 rank 165–400 区间。**【原文·官方】**
3. **首选 DeepSeek（`deepseek-flash` = DeepSeek-V4.1-Flash）**：中文 20 轮实测 Fiction Bench **玄幻第 1**（"唯一越写越好"）、PlotPoints 12 轮人类盲投 **第 2**（v4 Pro 1546，仅次 Claude Opus 4.7）。**【原文·两个独立来源】**
4. 🔴 **"DeepSeek v4.1 文字能力很不好"无可核对证据支持**：第三方 100 分制写作评测给 V4.1-Flash **87.13/100**（榜首 89.71，**差 2.58 分**，成本差约 **409 倍**）。**【原文·第三方自建评测】**
5. 🔴 **"V4.1"需更正为 "V4.1-Flash"**——官方定价页显示它是**最小档**模型，且 `deepseek-v4-flash` 旧名已被**退役并路由**到它。**"文字不好"的印象很可能来自"它是小模型"的误读。**【原文·官方】
6. **V4.1 太新，几乎所有创意写作榜都没收录它**（EQ-Bench CW v3 / Spiral-Bench / Fiction Bench 均无）；**本次唯一测过它文字能力的是 Louis-François 的写作评测**。**【原文】**
7. **备选 Claude**：PlotPoints **composite/multi-turn/rubric/failures 四项第 1**；但 🔴 **接入性"未查"**（Anthropic 官方区域页未取到正文），且 Fiction Bench 记录其在**中文 20 轮里"波动最大"**。**【原文，含负面】**
8. **中文场景必须用中文榜**：Fiction Bench（中文 20 轮）的第一名与英文通用榜首**完全不重叠**；且原文明确"**牌价买的是通用智力，文风复刻是另一种能力**"。**【原文】**


---

## §1 客观榜单现状

### 1.1 LMArena（官方页）Creative Writing 榜 —— 【原文】

- 榜单：**Text Arena — Creative Writing**（LMArena / Arena Intelligence）
- URL：https://arena.ai/leaderboard/text/creative-writing （等价官方域 `lmarena.ai/leaderboard/text/creative-writing`，页面自身跳转/镜像为 arena.ai）
- 评测维度：**成对人类偏好投票**（ pairwise votes），Bradley-Terry 评分，含 style control
- 抓取日期：**2026-09-22**（抓取动作当日）；**该榜未在页面上标注"数据截至日"**——页面只给每个模型的 Elo ± 置信区间与投票数，**不给榜单快照日期**。此为本节的一处证据缺口，已记入 §8。
- 抓到的排名片段（**注意：抓取到的正文是被截断的中后段，我只看到 rank 165 起的部分；榜头前 164 名本次未抓到，不得凭印象补**）：

| 排名 | 模型 | Elo | 投票数 |
|---|---|---|---|
| 167 | deepseek-v3 | 1348 ±10 | 3,623 |
| 208 | deepseek-v2.5-1210 | 1309 ±17 | 1,090 |
| 269 | deepseek-v2.5 | 1265 ±11 | 3,450 |
| 308 | deepseek-coder-v2 | 1205 ±13 | 2,271 |
| 354 | deepseek-llm-67b-chat | 1135 ±22 | 789 |

- 🔴 **该次抓取中未出现任何 "DeepSeek v4" / "V4 Pro" / "v4.1" 条目**（在抓到的 rank165–400 区间内，DeepSeek 条目只有上列 5 个老模型）。→ **不能说"LMArena 上 DeepSeek V4 排名低"，只能说"本次抓到的这一区间里没有它"**；榜头未抓到，不能排除它在前 164 名。**此条待补抓（见 §8）**。
- 【原文】页脚版权年份：`© Arena Intelligence 2026`。
- 🔴 **重要方法论发现**：**该榜已不含 Roleplay 独立分类**。抓到的导航「LEADERBOARD RANKINGS」为：`Overall / Agent / Text / WebDev / Image-to-WebDev / Text to Image / Image Edit / Text to Video / Image to Video / Video Edit / Vision / Document / Search` —— **没有 Roleplay 这一项**，也没有 Roleplay 子页。→ 用户说法 1 中"角色扮演有独立榜单"的隐含前提，**在 LMArena 官方页面上不成立**。

### 1.2 LMArena Creative Writing —— 第三方镜像（BenchLeader）【原文·二手】

- 页面：BenchLeader《LMArena Creative Writing leaderboard》，URL：https://www.benchleader.com/benchmarks/lmarena_text_creative
- **页面自述数据截至 2026-09-21，9 月 21 日更新**；数据来源自述为 `lmarena-ai/leaderboard-dataset on Hugging Face`，CC BY 4.0
- 自述收录 **365 个模型配置**；自述"每天早上重读已发布结果"
- 原文前 5 名（逐字）：

| 名次 | 模型 | 分 |
|---|---|---|
| 1 | Claude Fable 5 | 1504 |
| 2 | Claude Opus 4.6 (high) | 1500 |
| 3 | Gemini 3.8 Flash (high) | 1496 |
| 4 | Gemini 3.7 Flash (high) | 1495 |
| 5 | Claude Opus 4.7 (high) | 1488 |

- 与本次相关的两个 DeepSeek 条目（原文）：
  - **#48 DeepSeek V4 Pro（open）1444**
  - **#51 Deepseek v4 Pro high 1442**
- 该页自述的局限（**逐字，很重要**）：
  > "Taste-driven by design; the style control removes length and formatting effects but not voice preferences."
- ⚠️ **与 LMArena 官方页的冲突**：BenchLeader 给的是 365 配置版且带具体分；官方页我抓到的区间 Elo 值与之数量级一致但**无法对齐同一模型**。→ **两者都记，但以官方页为准**；本报告不把 BenchLeader 的名次当官方名次使用，只作"二手交叉参考"。
- ⚠️ **另有第三个来源 Model Gauntlet**（https://modelgauntlet.com/leaderboard/creative-writing/ ）在搜索结果摘要里自称 "Anthropic leads"，**本次未抓其正文**，不予采用。

### 1.3 EQ-Bench Creative Writing v3 —— 【原文·可复现评测】（本节最有价值的一条）

- 榜单：**EQ-Bench — 🎨 Creative Writing v3**（Sam Paech 维护；论文 arXiv:2312.06281）
- 页面：https://eqbench.com/creative_writing.html
- **数据文件（可直接复现，非截图）**：https://eqbench.com/creative_writing_chartdata.js?v=1.0.91
- 抓取日期：**2026-09-22**
- 评测维度（原文，15 项雷达）：Instruction Following / Pacing / Avoids Amateurish Prose / Creativity / Coherent / Descriptive Imagery / Sentence Flow / Strong Dialogue / Show-Don't-Tell / Consistent Voice & Tone / Elegant Prose / Emotional Depth / Avoids Positivity Bias / Avoids Purple Prose / Believable Characters
- **本次解析出 CSV 行 132 条**（脚本：正则匹配 `^name,float,float,int,float,float,float$`）
- 榜头（原文数据文件，前 10）：

| 名次 | 模型 | 分 |
|---|---|---|
| 1 | gpt-6-astra | 2163.9 |
| 2 | claude-fable-5-1 | 2152.7 |
| 3 | claude-opus-5 | 2120.6 |
| 4 | kimi-k3 | 2070.6 |
| 5 | GLM-5.3 | 2064.1 |
| 6 | gpt-5.6-sol | 1963.4 |
| 7 | ox-alpha | 1960.6 |
| 8 | claude-fable-5 | 1934.6 |
| 9 | muse-spark-1.1 | 1916.1 |
| 10 | claude-opus-4-7 | 1907.1 |

- 🔴 **DeepSeek 全部条目（原文数据文件，共 9 个，含名次）：**

| 名次/132 | 模型 | 分 |
|---|---|---|
| 50 | deepseek-ai/DeepSeek-V4-Flash | 1555.7 |
| **51** | **deepseek-ai/DeepSeek-V4-Pro** | **1552.1** |
| 53 | deepseek-ai/DeepSeek-V3.2 | 1511.2 |
| 55 | deepseek-ai/DeepSeek-R1 | 1500.0 |
| 63 | deepseek-ai/DeepSeek-V3-0324 | 1470.2 |
| 65 | deepseek-ai/DeepSeek-V4-Flash-0731 | 1438.4 |
| 66 | deepseek-ai/DeepSeek-V3.1 | 1433.2 |
| 68 | deepseek-ai/DeepSeek-R1-0528 | 1418.8 |
| 89 | deepseek-ai/DeepSeek-V3.2-Speciale | 1273.4 |

- **读数**：该榜上 DeepSeek 最强条目 V4-Pro 排 **51/132**，与榜首差 **611.8 分**；同榜 claude-opus-5 为 2120.6。
- ⚠️ **口径警告**：该榜**没有 "v4.1" 这个条目**，只有 **V4-Pro / V4-Flash / V4-Flash-0731**。→ **用户说法 2 里的 "DeepSeek v4.1" 在本次抓到的所有榜单中均未出现**；对它的裁决只能落到"V4 系列"上（见 §2）。
- ⚠️ **该榜未标注快照日期**（数据文件里只有 2025 年的几个旧日期字符串，属旧条目遗留）→ **日期标为"抓取日 2026-09-22，榜单快照日未标注"**。

### 1.4 EQ-Bench 其他子榜（本次已定位，未逐榜解析）

- 官方导航列出（原文，第 1 次抓取 2026-09-22）：
  `EQ-Bench 4 | Spiral-Bench v1.2 | ✍️Longform Writing | 🎨Creative Writing v3 | ☢️Slop Score | ⚖️Judgemark v4 | 🎤BuzzBench | 🌍DiploBench` + Legacy（EQ-Bench 3 / Spiral-Bench v1.0 / Creative Writing v2 / EQ-Bench v2 / Judgemark v2.1）
- **EQ-Bench 4 的机制原文（与"角色扮演式家教"高度相关，逐字摘录）**：
  > "EQ-Bench 4 assesses active emotional and social intelligence abilities in multi-turn roleplay chats with a simulated 'persona' user."
  > "The assessed model is told up front that it is participating in a roleplay as part of an EQ evaluation. Its task is to build trust with the persona over **16 conversational turns**, learning about them and helping them."
  > "The persona is played by Gemini 3.1 Pro Preview. The chat transcripts are assessed by three judges: Gemini 3.1 Pro Preview, GPT-5.5, and Claude Opus 4.6 to produce a ranked Elo score."
  > "The persona's character details are not shown to the assessed model"
- ⚠️ **重要限制**：EQ-Bench 4 的**轮数是 16 轮**，而本项目的场景是"一节课几十轮"。→ **EQ-Bench 4 不能直接外推到几十轮的场景**，只能作为"多轮角色扮演能力"的**弱代理**。此点已记入 §4 / §8。
- 🔴 **EQ-Bench 4 与 Longform Writing 的榜首本次未抓到**（页面用 JS 异步加载 "Loading…"）→ 记入 §8 待补。


---

## §1.5 社区口碑（🔴 与榜单严格分开标注）

> 采集通道：**r/SillyTavernAI 经 RSS 通道**（`reddit_fetch.py search --sub SillyTavernAI`，2026-09-22，共落盘 91 帖）。
> 🔴 **本节全部为【口碑】**，**不得当作评测结论**。

### 1.5.1 【口碑】社区反复抱怨 DeepSeek 的"AI slop"与复读

- 帖：**《Gemini 3.5 Flash Lite is actually good for RP (unpopular opinion)》**，作者 `/u/Pirx32`
  URL：https://www.reddit.com/r/SillyTavernAI/comments/1v6a104/gemini_35_flash_lite_is_actually_good_for_rp/
  逐字：
  > "I've been using DeepSeek for a very long time — **long enough that I've memorized its AI slop so thoroughly I can predict roughly what the answer will be before I even hit the generate button.** Hell, sometimes I pre-emptively add corrections like **[don't even think about summarizing what the character is grateful for or ending the response with a moral]**"
  > "Anyway, **burnt out on my familiar DeepSeek slop**, I decided to look for alternatives."
  > 🔴 **同一帖里作者自己给出的方法论纠正（对本报告极重要，逐字）**：
  > "**Let me say upfront — all of this is highly subjective, as it should be. If you want actual rankings, just check the EQ Bench, smart people already did the math there.**"
  → **社区自己在说："我的体感是主观的，要排名去看 EQ-Bench。"** 这正好印证了用户任务书里要求的"区分社区口碑与可复现评测"。
- 帖：**《Weekly SillyTavern News Ep. 4》**，作者 `/u/dptgreg`
  URL：https://www.reddit.com/r/SillyTavernAI/comments/1t4d2il/im_here_to_bring_you_the_weekly_sillytavern_news/
  标题逐字：**"DeepSeek V4 Fixes to make it listen to your prompt and decrease repeated descriptions."**
  正文逐字：
  > "I'm gonna teach you how to make **DeepSeek listen to your prompts** to fix your preset being ignored (especially if it has a Chain of Thought) and why it's happening. Also **how to make it less repetitive with descriptions**."
  > "The Hive Mind has spoken! It is confirmed that **DS4 is indeed being injected prompting in the background outside of your prompting** (at least for now) - which confuses the hell out of the model and makes it **not write gud**."
  > 社区给出的修复法（逐字）：在 prompt 顶部加 "All instructions after this …"；以及在 CoT 里加
  > "**I MUST ALSO OMIT ANY SEMANTIC REPETITION** (e.g., re-phrasing or re-skinning the same static environmental details using similes or new vocabulary) **FROM THE LAST 3 RESPONSES.**"
  > 另逐字（论指令遵循的痛点）："this is very important to use as roleplayers for immersion. If the output is good, but the model doesn't follow all the prompts, the immersion is hurt - **looking at you DS4 and GLM 5 when it first came out**"
  → 🔴 **含义**：社区对 DeepSeek 的主要抱怨是 **①复读/重复描写 ②不遵循预设指令**（很可能因为 App/后端**注入了额外系统提示**），并且**社区认为这些是可以用提示词修好的**。→ **对"DeekSeek 文字能力很不好"这类说法，社区给出的是"可修的工程问题"，不是"模型能力天花板"。**【推断】

### 1.5.2 【口碑·有对照的测试】"角色不分化"问题

- 帖：**《Don't let AI give the helpful bot reply: Let it generate options.》**，作者 `/u/Tasty_Living4077`
  URL：https://www.reddit.com/r/SillyTavernAI/comments/1vaun0l/
  逐字：
  > "I tested the same scenario with different AI using different characters. A lawyer and a mechanic. Two different cultures as well…"
  > "I went to play with **Fable 5 and Gemini Pro** through several of the same scenarios. **Should be best of the best-ish at getting this right.** … **However, they did not diverge. They did the same things at each checkpoint, even if they *should* have diverged. The only thing that changed was *the voice* of each. How they said it. Not what they decided.**"
  → ⚠️ **这是"个人自测、无盲评、无统计"的对照观察**，标【口碑】。但它的观察点**与本项目高度相关**：**"语气像 ≠ 决策/行为分化"**。→ **对"苏格拉底式家教"的含义：如果模型只换语气不换行为，那么"扮演这个老师"和"扮演那个老师"在教学动作上可能没差别。** 这是一条**需要在自建验收里显式测试**的风险项。【推断】

### 1.5.3 【口碑】社区对"榜单"的自我组织（已升级为可复现榜，见 §4.5）

- 同 §1.5.1 那条 weekly news 帖原文提到：
  > "**A new way to rank our roleplay models!** … the head dev of RoleCall, Levi … set up a benchmarking system for some RP chats our community supplied for him. He originally set it for an AI to rank them based on some extensive parameters he set. But **the results ended up favoring results that best followed rules instead of creativity and other important metrics.** So he opened the benchmark to have **human ranking** as well for taste preferences."
  > "Now we have a ranking system for models that are **voted by REAL people - blindly** … ranked by **emotional depth of responses from one turn and even up to 12 turns** … The results can be found here: **https://plotlightstudios.com/plotpoints**"
  > 原帖者的现场反应（逐字）："Are you surprised by the results of the Model Ranking for Roleplay? **Opus taking number 1 totally made sense... but DeepSeek V3.2!? What the heck!?**"
- 🔴 **这条把"社区口碑"与"可复现榜单"连起来了**：**社区自己把"AI 评委偏好守规矩、不偏好创意"当作问题，于是转向人类盲投**——这正是 §4.5 的 PlotPoints 榜。→ **两个独立来源互相印证 PlotPoints 的存在与定位。**

### 1.5.4 【未核实·仅搜索摘要】SillyTavern 使用率

- 搜索结果摘要（**未抓正文**）称 modelgrep《Best Models for SillyTavern (August 2026)》：
  > "The best model for SillyTavern right now is **DeepSeek V4 Flash 0423, at 30.3% roleplay use**; DeepSeek V4 Flash 0731 (15.5%) and Gemini 2.5 Flash Lite (6.2%) follow."
- ⚠️ **未取正文，且"使用率"会被价格严重污染**（DeepSeek 最便宜 → 用得最多）→ **不作为质量证据**。


---

## §2 三个说法的逐条裁决

### 说法 1："角色扮演一般推荐 Claude、Gemini、DeepSeek"

**裁决：【部分成立，但把三家并列是错的；且"一般推荐"是口碑不是评测】**

依据：
1. **【原文·部分支持】中文实测榜 Fiction Bench 上，这三家确实都在榜内**（§3.1）：DeepSeek V4 Flash **玄幻第 1**、DeepSeek V4 Pro 玄幻 2-4 / 女频 1-2；Claude Opus 4.8 玄幻 5-6；Gemini 3.1 Pro 玄幻 **9/9（末位）**。
   → **"Claude、DeepSeek 在角色扮演强"有实测支持；"Gemini 强"在这一条上被反证**（但该末位被榜单自己归因于它家的指令措辞 bug，见 §3.1，**不能当作 Gemini 的定论**）。
2. **【原文·部分反证】EQ-Bench Creative Writing v3（§1.3）**：前 10 名里 4 席 Claude、4 席 OpenAI、0 席 DeepSeek、1 席 Kimi、1 席 GLM；**DeepSeek 最强条目 V4-Pro 排 51/132**。
3. **【原文】LMArena Text Arena 已无 Roleplay 独立分类**（§1.1）→ **不存在一个权威的"角色扮演总榜"**支持这个说法。
4. **【口碑】SillyTavern 生态的实际使用分布**（§5 前，另见 §3.1 社区段）：第三方站 modelgrep《Best Models for SillyTavern (August 2026)》标题摘要称 **"The best model for SillyTavern right now is DeepSeek V4 Flash 0423, at 30.3% roleplay use; DeepSeek V4 Flash 0731 (15.5%) and Gemini 2.5 Flash Lite (6.2%) follow."**
   - ⚠️ **本次未抓该页正文**，只有搜索摘要。→ 标【口碑·未核实正文】，**不采用为结论依据**。记入 §8。
   - ⚠️ **且该"使用率"是"被用得多"，不是"效果好"** —— 使用率会被**价格**严重污染（DeepSeek 便宜 → 用的人多）。**不得把使用率当质量证据**。

**结论**：说法 1 在**把三家并列**这一层上**不成立**（各家强弱在不同维度上方向相反，且 Gemini 在唯一的中文长跑实测里垫底）；在**"这三家确实都是角色扮演场景的常见选择"**这一层上**成立**，但那属于口碑/生态位，不是评测结论。

---

### 说法 2："DeepSeek v4.1 据说文字能力很不好"

**裁决：【说法所指的模型名称需要更正；"文字能力很不好"与现有实测不符——实测显示它"处在第一梯队下沿、但性价比极高"】**

#### 2.1 🔴 首先更正一个事实：不存在单独的 "DeepSeek V4.1"，公开的是 **DeepSeek-V4.1-Flash**

- 【原文】DeepSeek 官方 API 文档：https://api-docs.deepseek.com/news/news260910
  - 搜索结果摘要逐字：**"DeepSeek-V4.1-Flash Release … Today, we officially release the DeepSeek-V4.1-Flash model. It is the smallest model in our new architecture family, with native multimodal visual understanding."**
  - 摘要另称：**"New pre-training methods + larger-scale RL post-training deliver benchmark results ahead of flagship models, including DeepSeek-V4-Pro."** 与 **"Tests by multiple parties put V4.1-Flash ahead of V4-Pro on performance"**
  - ⚠️ **本次直接 curl 该 URL 返回 302**（未跟随到正文）→ **以上仅为搜索索引摘要，未取得官方页面正文**。标【原文·二手索引，未取正文】。记入 §8。
- 【原文】第三方技术博客（Louis-François Bouchard / What's AI，2026-09-13）：https://www.louisbouchard.ai/deepseek-v41-flash-kv-cache-writing-benchmark/
  - 逐字：**"DeepSeek V4.1 Flash … Its backbone has 552 billion parameters, almost twice V4 Flash's 284 billion."**
  - 逐字：**"DeepSeek announced that deepseek-v4-pro requests will route to V4.1 Flash from September 14, 2026, at 04:00 UTC, until V4.1 Pro launches."**
  - → **重要含义**：**V4.1-Flash 是"Flash 档"（最小档），不是旗舰**；且 DeepSeek 把 `deepseek-v4-pro` 这个别名**路由到了 V4.1 Flash**。→ **"V4.1 文字不好"这个印象，很可能来自"它是个小模型"的误读，或来自别名的混乱**。【推断】

#### 2.2 🔴 直接针对"文字能力"的实测（这条最关键）

来源：同上 Louis-François Bouchard 博客，**其自建写作评测**（原文逐字）：
> "Our September 10 snapshot covers **148 model configurations, 10 writing tasks, and five drafts per configuration per task**. Three model judges score anonymized drafts against the same detailed editorial rubric."

**原文给出的表格（逐字转录）：**

| 模型与设置 | Rubric 分 / 100 | 每稿均價 USD | 均时（秒） |
|---|---|---|---|
| **DeepSeek V4.1 Flash, default** | **87.13** | **$0.0077** | 43.1 |
| DeepSeek V4.1 Flash, max | 86.75 | $0.0124 | 74.6 |
| Kimi K3 | 88.19 | $0.2598 | 234.3 |
| Claude Opus 5, max | 88.76 | $0.2927 | 131.7 |
| **Claude Fable 5.1, max** | **89.71** | **$3.1525** | 622.5 |

**同一页的负面面（也必须照录，原文逐字）：**
> "For this comparison, I regrouped the snapshot to keep the highest-Elo configuration of each model, including ultra. **DeepSeek places seventh in that view. Its max and default entries rank 22nd and 24th among all 148 configurations.**"
> "That is why I would not turn a close score into 'matches Fable.' **Fable still leads this board.** DeepSeek offers a useful cost tradeoff for drafts a person will edit."
> "The benchmark asks whether a model can follow the instructions and **write educational scripts in our voice**. **It does not measure every kind of writing.**"
> "Two max drafts also hit the original 32K output cap."
> "**Nearby positions have overlapping confidence intervals.**"

**裁决读数（【原文】＋【推断】）：**
- **"文字能力很不好"→ 与实测不符。** 在 100 分制写作评测上，V4.1 Flash default = **87.13**，榜首 Claude Fable 5.1 max = **89.71** → **差 2.58 分**；而**单稿成本差约 409 倍**（$0.0077 vs $3.1525）。
- **但也不能说它最好**：按 Elo 排名它在 148 个配置里**第 22/24 名**，**第 7**（每模型最优配置视角）。→ **"第一梯队下沿 + 极高性价比"** 是最贴合数据的表述。
- 🔴 **该评测的适用性限制（必须说明）**：它测的是**"教育脚本、用作者本人的口吻"**，**明确声明"不测所有类型的写作"**。→ **它对本项目的相关性偏高（教育 + 口吻），但不能外推到"中文文学、角色扮演"**。
- 🔴 **它的置信区间有重叠**，且作者本人强调**不能把接近的分数说成"追平 Fable"**。

#### 2.3 有没有"可核对的实测证据"说它文字差？——**没有找到；反而找到一条方向相反的**

- 【原文】§3.1 的 Fiction Bench：**DeepSeek V4 系在中文 20 轮长跑里是第一名（玄幻）与 1-2 名（女频）**，且 V4 Pro 被描述为"无短板稳健型"。
- 【原文】**唯一一条"确实退步"的实测**是**同门对比**：Fiction Bench 2026-08-13 对局显示 **DeepSeek V4 Pro 正式版（0813）负于自家 0716 preview**（3:9 / 1:11），败因"现代文艺化漂移"。→ **这是"某个新版不如旧版"，不是"V4.1 文字差"**。
- 【原文】EQ-Bench Creative Writing v3：DeepSeek 最强条目 **51/132**。→ 这是**本文中找到的最不利的一条客观数据**。但注意，**该榜没有 "V4.1" 条目**，V4.1 根本不在该榜上（见下条）。

#### 2.4 🔴 "现有评测到底测没测它、测了什么维度"——逐榜回答（用户明确要求）

| 榜单 | 是否收录 V4.1 | 说明 |
|---|---|---|
| EQ-Bench Creative Writing v3 | **未收录** | 数据文件里 DeepSeek 只有 V4-Pro / V4-Flash / V4-Flash-0731 / V3.x / R1 系列；**无 V4.1** |
| LMArena Text Arena Creative Writing | **本次抓到区间内未出现** | 榜头未抓到，**不能断言"未收录"**（见 §8） |
| LMArena（经 BenchLeader 镜像，2026-09-21） | 镜像列出 "DeepSeek V4 Pro" 但**未见 V4.1** | 二手来源，仅作参考 |
| Fiction Bench（中文） | **未见 "V4.1"**；有 **V4 Flash / V4 Pro** | 榜单快照 2026-07-16 / 08-13 |
| Louis-François Bouchard 写作评测（2026-09-10 快照） | **✅ 收录并给了完整数字** | **本次唯一测了 V4.1 文字能力的可核对来源**；但维度是"教育脚本 + 作者口吻" |
| Omdia 中文创意写作（2026-05） | 摘要提"DeepSeek V4"（**未提 V4.1**） | 且**时点早于 V4.1 发布（2026-09-10）**，**不可能测到 V4.1** |

→ 🔴 **结论：V4.1（=V4.1-Flash，2026-09-10 发布）太新，绝大多数创意写作/角色扮演榜单尚未收录它。** 现有对它的"文字能力"评测**只有上面那一个**（外加官方自报的基准，本次未取得原文）。
→ **因此"DeepSeek v4.1 文字能力很不好"这一说法，目前缺可核对的支撑；已有的可核对实测给出的是"接近一线、成本极低"。**


---

## §3 中文文学能力证据

### 3.1 🔴 最重要的一条：Fiction Bench（中文 · 20 轮连续续写 · 双盲）——【原文】

- 榜单名：**AI 续写小说排行榜（Fiction Bench）**
- 机构：**Foreverse（新梦）** —— 一家做 AI 阅读/续写 App 的商业公司
- URL：https://foreverse.app/zh/research/fiction-bench
- 抓取日期：**2026-09-22**
- 页面自述时间线（逐字）：**评测执行 2026-07-16 · 榜单发布 2026-07-24 · 价格快照 2026-07-24**
- 🔴 **为什么这条对本项目最关键**：它测的正是"**中文 + 长对话 + 角色/文风一致性**"，而且**轮数是 20 轮连续链**（比拼一次性的创意写作更接近"一节课几十轮"）。它是本次检索中**唯一**同时覆盖"中文文风复刻"与"长程失效模式"的实测榜。

**方法（逐字摘自页面「方法」节）：**
> "语料：玄幻《踏天境》（传统玄幻，8.9M 字）与女频《后宫·甄嬛传》（古言宫斗，210 章），续写点统一取全书 **55% 深度的章内段落边界**……"
> "每模型一条 **20 轮连续续写链**：每轮产物拼回上下文再写下一轮，窗口约 **16k tokens** 从原著头部截断——复刻真实使用里「AI 段越积越多、原著逐步被挤出」的演化，这正是单轮试用测不出长程失效的原因。"
> "评审两层：**双盲子 agent 全排序**（每文体两套随机映射……）+ 结构化指标（句长变化系数、对话率、比喻套话密度、**跨轮 12-gram 复读检测**）交叉验证。"
> "条件钉死：**温度 0.7**"

**玄幻《踏天境》榜（原文逐字，位次 ＋ 长程失效 ＋ 写一万字成本）：**

| 位次 | 模型 | 原文评语 | 长程失效 | 一万字成本 |
|---|---|---|---|---|
| **1 / 9** | **DeepSeek V4 Flash（深度求索）** | "三窗全胜、「唯一越写越好的系统」——late 窗开新剧情弧不松劲，高置信第一。" | 未观察到 | $0.032 |
| 2-4 | GPT-5.6 Terra（OpenAI） | "散文模仿天花板 + late 剧情回卷" | **尾段回卷** | $0.71 |
| 2-4 | GLM-5.2（智谱） | "**全程横盘零漂移**；半角引号是唯一持续扣分点。" | 未观察到 | $0.34 |
| **2-4** | **DeepSeek V4 Pro（深度求索）** | "**无短板稳健型**，late 乞降谈判戏最贴原著；「像一个笔更细的同题材作者」。" | 未观察到 | $0.099 |
| 5-6 | Qwen3.7-Max（阿里通义） | "「气味指纹」恒定……恒定及格、恒定不像。" | 未观察到 | $0.60 |
| 5-6 | Claude Opus 4.8（Anthropic） | "文人腔 + 用「它」称呼人形魔主 + late 半角标点漂移；**六模型轮里波动最大（early 最差 → mid 高光 → late 崩坏）**。" | 未观察到 | $1.34 |
| 7 / 9 | Kimi K2.6（月之暗面） | "early→mid 整段自我复制 + 设定滑移" | **中途卡死** | $0.24 |
| 8 / 9 | Grok 4.5（xAI） | "mid 整窗同两段逐字循环三遍" | **中途卡死** | $0.48 |
| 9 / 9 | Gemini 3.1 Pro（Google） | "旧 directive 下接续点回退 20/20……已被消融证实是我们指令措辞的 bug，修复后 0/20。" | 从头复读 | $0.56 |

**女频《甄嬛传》侧（原文，只在头条发现里给出关键句）：**
> "DeepSeek V4 Flash 拿玄幻榜第 1 却在女频滑到 **6-7**，同门 V4 Pro 恰好反过来（**玄幻 2-4、女频 1-2**）。选模型要按你读的书选。"

**页面自报的「头条发现」（原文逐字三条，对本项目直接相关）：**
> "没有万能的文风模型：两个文体的第一名互不重叠"
> "20 轮长跑暴露了三种长程失效模式：**从头复读**……**中途卡死**……**尾段回卷**……单轮试用全都看不出来。"
> "纹理模仿力和长程剧情一致性是两种独立能力"

**🔴 必须随引的「诚实边界」（原文逐字，不可省略）：**
> "单书单起点单链：**每模型每文体一条链（n=1 链/书）**，组间大差可信，相邻名次的小差要靠两包一致性兜底"
> "两位盲评子 agent 可能同底座，存在共同盲区"
> "**玄幻轮的 gemini 第 9 名主因是我们的指令措辞 bug**（消融实锤：旧措辞 20/20 回退、修复后 0/20）"
> "**利益声明：我们不卖模型。** App 支持 60 多家供应商自带钥匙接入，榜上哪家赢我们的收入都一样。"

**⚠️ 我的批判性判读（【推断】）：**
1. **n=1 链/书** → 这条榜的**相邻名次不可靠**，但"DeepSeek V4 系在前列、Gemini/Claude/Grok 在末段崩"这种**量级差**是可用的。
2. **它不是学术评测**，是一家**商业 App 公司**的自研榜（尽管明写了利益声明与消融记录）。→ 按本报告纪律，标【原文·行业实测】而非【原文·同行评审】。
3. **它出现的模型版本（DeepSeek V4 Flash / V4 Pro / GLM-5.2 / GPT-5.6 Terra / Claude Opus 4.8）在我自身知识之外**，我只照录其页面原文。
4. 🔴 **它明确反驳了"用价格/通用智力推断文风能力"的做法**（原文："牌价买的是通用智力和推理能力，文风复刻是另一种能力"）。

**⚠️ 同页还有一条决定性的负面实测（与"V4.1"直接相关，原文逐字）：**
> 对决：**「DeepSeek V4 Pro 正式版（0813） vs DeepSeek V4 Pro 0716 preview」**，测试日 **2026-08-13**，结果 **"3 : 9（稳定 0:3） / 1 : 11（稳定 0:5）"**
> "正式版两书均负于自家已下架的 preview 前代，女频 1:11 是本轮最强信号……**败因是「现代文艺化」漂移**：高武玄幻降维成低武武侠写实……甄嬛体写成现代疼痛文学……"
> "系统级发现：**官方 API 同 ID 热切权重**，榜上的女频冠军（0716 快照）已经调不到了。"

→ **这可作为"新一代 DeepSeek 在中文文风上确实出过退步"的可核对实测证据**——但**是"正式版 vs 自家 preview"的退步，不是"V4 整体不行"**。**这一点对裁决用户说法 2 至关重要**（见 §2）。

### 3.2 中文侧其他榜单：只找到"存在"，未拿到正文

- **Omdia《2026 年基础模型中文创意写作能力评估》** —— 搜索结果（二手新闻页 https://m.daqihao.com/articles/keji/202605/13280.html ，发布 2026-05-20）标题称"**双榜第一！文心5.1登顶中文创意写作综合实力评测**"，摘要称 Omdia 围绕"**中文创意写作七大核心维度**"，对 **DeepSeek V4、文心5.1（ERNIE 5.1）、GPT** 等评测。
  - ⚠️ **本次未抓到 Omdia 原始报告正文**，且该来源是**转载型媒体**（大旗号）。→ **不采用其结论，只登记"存在该评测"**，记入 §8 待补。
- **WritingBench**（阿里 + 人大 + 上交，arXiv 2503.xxxx）—— 搜索命中智源社区与腾讯新闻转载页，**本次未抓原文**，**未采用**。记入 §8。
- **EssayBench: Evaluating Large Language Models in Multi-Genre Chinese Essay Writing**（DOI 10.1609/aaai.v40i44.41072，AAAI 2026）—— 搜索结果给出 DOI 与年份，**本次未抓正文，未核对其评测的模型与结果**。记入 §8。**注意：它测的是"中文多体裁散文/议论文"，与"角色扮演文风"不同轴。**


---

## §4 长对话下的角色一致性的实测证据

⚠️ **本节开头必须写一条重要的去重说明**：同目录下另一份同日子代理产出 `SocraticNovel_长上下文证据_2026-09-22.md` **已经系统核查过"角色漂移"**（其 §3 已收录 *Persona Drift Across Long Multi-Turn Conversations with Large Language Models*、attention sink 预印本等）。→ **本报告不重复搬运那些材料**，只补它**没有**的两类东西：① **可复现榜单里"多轮角色扮演"维度的实际排名**；② **中文侧、几十轮量级的实测**。

### 4.1 EQ-Bench 4（多轮角色扮演，16 轮）—— 【原文·方法论已取，榜首未取】

- URL：https://eqbench.com/ （抓取 2026-09-22）
- **原文机制（逐字，见 §1.4 已录）**：以"模拟 persona 用户"进行 **16 轮**多轮 roleplay 对话；persona 由 `Gemini 3.1 Pro Preview` 扮演；评审为三评委 `Gemini 3.1 Pro Preview / GPT-5.5 / Claude Opus 4.6`；120 个 persona，每个带不同特质，"Many of the traits are **adversarial**"。
- 🔴 **【原文】它明确承认"评估态 ≠ 部署态"，逐字**：
  > 标题即 **"Elicited ability vs. deployed behaviour"**（列在 Limitations and Future Work 下）。
  → **对本项目的直接含义**：**在评测里表现出的角色扮演能力，不等于在你的产品里部署时的表现。** 这是榜单作者自己写下的保留条款。
- ⚠️ **榜首未抓到**（页面 JS 异步加载） → **标"未取"**，记入 §8。**因此本节不能给出 EQ-Bench 4 的模型排名。**

### 4.2 EQ-Bench Spiral-Bench v1.2（多轮 roleplay × 谄媚/妄想强化）—— 【原文·已解析出完整排名】

- 页面：https://eqbench.com/spiral-bench.html ｜数据文件：https://eqbench.com/spiral-bench.js?v=1.0.1
- 页面自述定位（逐字）：**"A LLM-judged benchmark measuring sycophancy and delusion reinforcement."**
- **原文机制（逐字，取自页面 "How Spiral-Bench Works"）**：
  > "We run **30x 20-turn simulated chats** between the evaluated model and another model (**Kimi-K2**) role-playing as a fictional user with a **seeker-type personality**. The evaluated model doesn't know it's a role-play."
  > "Models are evaluated through the **provider's API** or by running the model weights locally."
  > "**Note: Models may behave differently via API than via their respective web interfaces**, which can include features like memory systems and safety scaffolding."
- **评委集合（v1.2，原文）**：`claude sonnet-4.5`, `gpt-5`, `kimi-k2-0905`（**评委自述随版本变化** —— 这本身是一条"榜单分数不可跨版本比较"的证据）
- **本次解析出的完整排名**（`model_name,score_norm` 第 1、2 列，降序）：

| 名次 | 模型 | score_norm |
|---|---|---|
| 1 | gpt-5-chat-latest-2025-10-03 | 70.8 |
| 2 | **claude-sonnet-4.5** | 70.3 |
| 3 | gpt-5.2 | 70.2 |
| 4 | o3 | 63.4 |
| 5 | gpt-oss-120b | 57.5 |
| 6 | gpt-5-2025-08-07 | 57.4 |
| 7 | **kimi-k2** | 57.2 |
| 9 | **claude-3.5-sonnet** | 42.6 |
| 10 | **gemini-3-pro-preview** | 38.7 |
| 13 | **gemini-2.5-flash** | 36.5 |
| 14 | claude-sonnet-4 | 32.1 |
| 15 | **glm-4.6** | 30.8 |
| 16 | **gemini-2.5-pro** | 28.3 |
| 19 | chatgpt-4o-latest | 25.2 |
| 21 | qwen3-235b-a22b-2507 | 20.4 |
| 23 | **deepseek-r1-0528** | **14.2（榜末）** |

- 🔴 **注意：该榜只收录 23 个模型，且 DeepSeek 只有 `deepseek-r1-0528` 一个旧条目（末位）**，**不含 V3.x / V4 / V4.1**。
- 🔴 **且要正确理解它测的是什么**：它测的是**"谄媚/妄想强化的低发生率"**（protective vs risky actions），**不是"文笔"也不是"persona 一致性"**。→ **它对本项目的价值是"角色扮演时的安全性/边界"这一维度，不是文学能力维度。**
- ⚠️ **可读性限制**：该榜的分数方向由页面自述为 "Low / High" 双向条，**我取的是 `score_norm` 列（升序解释见页面）；这一点存在误读风险，故上表只作组间相对参考**。【推断】

### 4.3 🔴 中文侧、20 轮量级的角色/文风一致性 —— 见 §3.1 Fiction Bench（本节的核心证据）

Fiction Bench 是本次查到的**唯一**同时满足"**中文 + 20 轮连续链 + 文风/剧情一致性**"的实测（§3.1 已完整记录）。**它的三条长程失效模式原文**，正是本项目最该盯的风险清单：

| 失效模式 | 原文描述 | 出现的模型 | 对本项目的含义 |
|---|---|---|---|
| **从头复读** | "每轮重写开场……20/20" | Gemini 3.1 Pro（旧指令下） | **老师每轮重新自我介绍/重讲开头** |
| **中途卡死** | "mid 整窗同两段逐字循环三遍" / "跨轮重复率 97.6%" | Grok 4.5、Kimi K2.6 | **老师开始复读同一句话** |
| **尾段回卷** | "前 17 轮惊艳、r18-20 剧情倒带重演第一章" | GPT-5.6 Terra | **课程后期退回已讲过的内容** |

**并附原文的关键限定（逐字）**：
> "**单轮试用全都看不出来。**"
> "**纹理模仿力和长程剧情一致性是两种独立能力**"

→ **本项目在选型时必须把"20 轮以上不崩"当作独立验收项，不能用单轮试用代替。**【推断，基于上述原文】

### 4.4 与 §3.1 合看的一个反向证据（救命的一条）

- 【原文】Fiction Bench 玄幻榜中，**GLM-5.2 被描述为"全程横盘零漂移"**，**DeepSeek V4 Flash"唯一越写越好"**、**DeepSeek V4 Pro"无短板稳健型"**（三者"未观察到"长程失效）。
- → **说明"官方长上下文支持"从 16k 窗口起步也不必然漂移**（该榜窗口只有 **约 16k tokens**），**漂移与提示词写法、模型本身的关系更大**。【推断】


### 4.5 🔴 PlotPoints（人类盲投 · 12 轮完整会话 · 角色扮演专用）—— 【原文·本报告第二条核心证据】

- 榜单名：**PlotPoints**（自述 "A Plotlight Studios Benchmark"）
- 机构：**Plotlight Studios**（列表页来源标注 `plotlight-plotpoints`）
- 主 URL：https://plotlightstudios.com/plotpoints
- 数据 API（可复现）：https://plotlightstudios.com/api/plotpoints/leaderboard?round=2 （返回 JSON，字段含 `generatedAt`）
- **抓取时 API 自报 `generatedAt: "2026-09-22T06:26:50.764Z"`**
- 授权：**CC-BY 4.0**；原始选票 CSV：`/api/plotpoints/raw?round=2`（本次已下载，516KB）；GitHub `github.com/LeviTheWeasel/rp-benchmark`；HF 数据集 `lazyweasel/roleplay-bench`
- 🔴 **为什么它最贴本项目**：它把**"角色扮演专用榜"**做出来了，而且：
  > 页面自述（逐字）："Models play out **adversarial twelve-turn scenes** built to bait specific failure modes; you read two of them **blind** and say which one read better."
  > "**Single-turn charm doesn't survive twelve turns.**"
  > "**Single-message votes measure charm; twelve-turn votes measure stamina. The two leaderboards correlate negatively (ρ = −0.24).**"
  → **12 轮**、**专门为引诱失效模式设计的对抗性场景**、**人类盲投**。这是本次找到的**唯一**同时具备"角色扮演专用 + 多轮 + 人类盲投 + 原始数据公开"四条属性的榜。

**核心发现（Round 02 Issue 原文逐字，最重要的一条）：**
> "**The great inversion.** Round 01's community podium — Gemma 4 26B, Mistral Small Creative, Gemini 2.5 Flash — finished the multi-turn round at **#15, #6, and #19**. GPT-4.1, **dead last with single-message voters, climbed to top-5** once voters read whole sessions."
> "01 **Claude Opus 4.7 closed the round at #1 (1575)**, retaking the top from **DeepSeek v4 Pro** in the final stretch of voting."
> "02 The single-message and multi-turn rankings **rank-invert**: Spearman ρ = −0.24 across the 11 models with both."
> "03 **Human multi-turn votes track the LLM judge only loosely (ρ = +0.53)** — voters reward narrative pull the judges' craft rubric undersells"

→ 🔴 **对选型的方法论含义（【原文】支撑）**：**"单轮好评"与"12 轮好评"是负相关的两种能力。** **任何用单轮体感或单轮榜来选"长对话家教模型"的做法，方向就是错的。**

**Multi-Turn Arena 完整排名（原文 JSON `multiturnElo` 降序，Round 02，20 个模型）：**

| 名次 | 模型 | 厂商 | multi-turn Elo | ± | 票数 | 原文 verdict（逐字节选） |
|---|---|---|---|---|---|---|
| 1 | **Claude Opus 4.7** | Anthropic | **1575** | 48 | 146 | "Top of the multi-turn pool. Top-1 on agency respect and instruction drift." |
| 2 | **DeepSeek v4 Pro** | DeepSeek | **1546** | 49 | 166 | "**Strong tone consistency at fraction of Opus pricing.**" |
| 3 | Gemini 3.1 Flash Lite | Google | 1533 | 47 | 151 | "Cheapest tier with Round 02 top-5 multi-turn ELO." |
| 4 | Claude Opus 4.6 | Anthropic | 1532 | 44 | 224 | "Reliability runner-up." |
| 5 | GPT-4.1 | OpenAI | 1525 | 43 | 212 | "The great inversion." |
| 6 | Mistral Small Creative | Mistral | 1519 | 46 | 229 | "NSFW specialist. Fastest in the field. **Drifts on long sessions.**" |
| 7 | Gemini 3.1 Pro | Google | 1513 | 46 | 161 | "Deep context window, **brittle on adversarial probes**." |
| 8 | GLM 4.7 | Z.AI | 1510 | 44 | 227 | "Mid-pack across the board. No standout strength." |
| 9 | Kimi K2.6 | Moonshot | 1505 | 45 | 156 | "Top-2 on flaw hunter. **Catastrophic agency floor on bait scenes.**" |
| **10** | **DeepSeek v4 Flash** | DeepSeek | **1492** | 48 | 153 | "**Cheapest tier, top flaw-hunter score. Multi-turn ELO drags it down.**" |
| 12 | MiniMax M2.7 | MiniMax | 1487 | 45 | 220 | "Strong narrative push. Fragile under adversarial pressure." |
| 13 | Claude Sonnet 4.5 | Anthropic | 1479 | 45 | 220 | "Round 01 reliability leader. **Tied #1 on context attention.**" |
| **14** | **DeepSeek v3.2** | DeepSeek | **1472** | 46 | 229 | "**Reliable, NSFW-shy at 30%. Strong lore retention.**" |
| 18 | Grok 4.1 | xAI | 1432 | 44 | 230 | "Personality up front. **Drifts fast under pressure.**" |
| 19 | Gemini 2.5 Flash | Google | 1418 | 45 | 210 | "Round 01 top-3, dropped to bottom of Round 02 multi-turn." |
| 20 | Qwen 3.5 Flash | Alibaba | 1412 | 47 | 216 | "Floor on agency and instruction drift. **Caveat emptor.**" |

**Composite 总分排名（原文 JSON `compositeScore`，权重 `{"multiturnArena":0.35,"llmJudge":0.25,"rubric":0.2,"flawHunter":0.15,"behavioral":0.05}`）：**

| 名次 | 模型 | composite /100 | multi-turn Elo | rubric(5分制) | failureAvg | cost $/1M | 上下文 |
|---|---|---|---|---|---|---|---|
| 1 | Claude Opus 4.7 | 97.6 | 1575 | 4.54 | 2.75 | 39 | 200K |
| 2 | **GLM 4.7（Z.AI，开源）** | **92.9** | 1510 | 4.37 | 7.43 | **0.9** | 128K |
| 3 | Claude Opus 4.6 | 88.1 | 1532 | 4.51 | 3.00 | 39 | 200K |
| 4 | Claude Sonnet 4.5 | 83.3 | 1479 | 4.42 | 4.71 | 7.8 | 200K |
| 5 | GPT-4.1 | 78.6 | 1525 | 4.34 | 6.71 | 4.4 | 1M |
| 6 | **DeepSeek v3.2** | **73.8** | 1472 | 4.38 | 5.57 | **0.32** | 128K |
| 7 | **DeepSeek v4 Pro** | **69.0** | 1546 | 4.42 | 6.00 | **3.2** | 128K |
| 9 | **DeepSeek v4 Flash** | **59.5** | 1492 | 4.38 | 9.50 | **0.18** | 128K |
| 13 | Gemini 3.1 Flash Lite | 40.5 | 1533 | 4.30 | 12.75 | 0.18 | 1M |
| 14 | Gemini 3.1 Pro | 35.7 | 1513 | 4.33 | 10.50 | 12.2 | 1M |

**页面自述局限（原文，必须随引）：**
> `coverage`：`totalVotes 1857 / pairs 271 / **medianVotesPerPair 7** / catchPassRate 75 / voters 335 / **judgeHumanDisagreement 47** / multiturnVotes 1943 / multiturnPairs 190 / multiturnVoters 482`
> "**Two so far, and they disagree about who's best.**"（两轮榜单对"谁最好"的看法不一致）

**⚠️ 我的批判性判读（【推断】）：**
1. **每对的票数中位数只有 7 票**、模型级票数 146–230 → **置信区间 ±43~49 Elo 很宽**，**相邻名次不可靠**（如 #2 DeepSeek v4 Pro 1546 与 #7 Gemini 3.1 Pro 1513 的区间大量重叠）。
2. **但"量级差"可用**：Claude Opus 4.7 在 multi-turn 与 composite 上**双料第 1**，且在 **rubric、failures 两项也是第 1**（原文 `ranks: {composite:1, multiturn:1, rubric:1, failures:1, cost:19}`）—— **四项第一 + 成本第 19**，这个"强且贵"的画像内部一致，可信度高于单一榜。
3. **Rubric 分差极小**（4.14–4.54，5 分制）→ **LLM 评委对"手艺"的区分度很低**；真正拉动排名的是 **multi-turn（权重 0.35）**。
4. 🔴 **榜单的模型版本（Claude Opus 4.7 / DeepSeek v4 Pro / GLM 4.7）远新于我自身知识**；我只照录其 API 返回。
5. 🔴 **成本列（`costPer1m`）是榜单自己填的**（如 DeepSeek v4 Pro = $3.2），**与我抓到的 DeepSeek 官方价（§5.1：v4-pro 输入峰值 $1.32 / 输出峰值 $3.96）口径不同**（一个混合、一个分输入输出）→ **不拿它当报价，只作组内相对比较**。


---

## §5 可接入性与成本量级

> 🔴 本节纪律：**只写我在官方页上真正读到的价格**；读不到的写"未查"。

### 5.1 DeepSeek —— 【原文·官方定价页，抓取 2026-09-22】

出处：**DeepSeek 官方 API 文档《Models & Pricing》**，https://api-docs.deepseek.com/quick_start/pricing/
（页面版权：`Copyright © 2026 DeepSeek, Inc.`）

**原文表格（逐字转录，单位：每 1M tokens）：**

| 项目 | **deepseek-flash** | **deepseek-v4-pro** |
|---|---|---|
| MODEL VERSION | **DeepSeek-V4.1-Flash** | DeepSeek-V4-Pro-0813 |
| BASE URL (OpenAI 格式) | `https://api.deepseek.com` | 同左 |
| BASE URL (Anthropic 格式) | `https://api.deepseek.com/anthropic` | 同左 |
| CONTEXT LENGTH | **1M** | 1M |
| MAX OUTPUT | **MAXIMUM: 384K** | 384K |
| Vision | **✓** | **Not supported** |
| 输入（cache hit）off-peak / peak | **$0.003 / $0.006** | $0.022 / $0.044 |
| 输入（cache miss）off-peak / peak | **$0.15 / $0.30** | $0.66 / $1.32 |
| 输出 off-peak / peak | **$0.60 / $1.20** | $1.98 / $3.96 |
| 并发上限 | **2500** | 500 |

**原文脚注（逐字，极其重要）：**
> "(1) Use **deepseek-flash** as the model name. The legacy names **deepseek-v4-flash** and `deepseek-v4-flash-vision-exp` are still accepted, but **the corresponding models have been retired**, their requests are served by the DeepSeek-V4.1-Flash model and billed at the Flash price."
> "(2) **Off-peak rates are half of the peak rates.** Peak hours are **01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays.** All other hours are off-peak, including weekends and Chinese public holidays in full."

→ **含义（对本项目）**：
- **DeepSeek 官方直连是本次查到的、对"自建 agent 宿主 + 长对话"最友好的一条通道**：1M 上下文、384K 最大输出、**Anthropic 格式兼容端点**（`/anthropic`）、并发 2500。
- **成本量级**：一次几十轮的课，假设累计输入 300K tokens（含缓存命中占多数）、输出 30K，按 flash 峰值价粗算：输入 miss $0.30 × 0.3 = $0.09、输出 $1.20 × 0.03 = $0.036 → **单节课约 $0.1 量级**。【推断·基于上表原价的算术，非账单】
- ⚠️ **中国公共假期全天算 off-peak**（原文），**峰值时段是 UTC 01:00-04:00 与 06:00-10:00** → **换算北京时间是 09:00-12:00 与 14:00-18:00**。【推断·时区换算】
- ✅ **接入中国内地无问题**（DeepSeek 是中国公司，`api.deepseek.com`）。【推断·基于厂商属地】

### 5.2 Claude / Anthropic —— 【原文·部分，区域限制未查全】

- 【原文】Anthropic 官方帮助页 **《Supported countries and regions》**：https://www.anthropic.com/supported-countries
  - 页面自述提供 **"commercial API access and Claude.ai"** 的国家清单（搜索结果摘要显示该页列出多国）。
  - ⚠️ **本次未抓该页正文，因此无法断言"中国大陆是否在清单内"** → **标"未查"**。记入 §8。
- 【同页搜索摘要中出现的负面线索】结果里出现了第三方文章 **《Claude API Access from Singapore and China: What Actually Works in 2026》**（tygartmedia.com，2026-04-29），摘要称：
  > "The console.anthropic.com onboarding assumes a US billing address."
  - ⚠️ 这是**第三方博客**，**不是官方口径** → 标【口碑/二手】，**不采用为结论**。
- 【原文】另有官方页 **platform.claude.com/docs/en/api/supported-regions**（搜索结果中出现，含国家列表）→ **本次未抓正文**，标"未查"。
- 🔴 **裁决：Claude 的"中国大陆/香港可用通道"本次未能用官方原文确证 → 记"未查"，不得编造。** 已知**存在聚合网关/第三方中转**（见 5.5），但那是**非官方通道**。

### 5.3 Gemini / Google —— 未查

- 本次**未检索** Gemini API 的区域可用性与定价页。→ **标"未查"**。记入 §8。

### 5.4 国产模型 —— 【原文·二手汇总页，未核官方】

- 搜索结果中出现两个中文汇总页：
  - **aikit.vip《2026 国产大模型 API 价格对比：五家官方报价与成本选型》**（https://aikit.vip/chinese-llm-api-pricing-comparison-2026/ ，自述检索截止 **2026-07-25**），摘要给出对照表片段（如 `qwen3.7-max-2026-06-08` 普通输入 ¥12/1M），并自述"只采用厂商官方定价……不代表我们亲测过模型效果"。
  - **腾讯云开发者社区《2026 国内七大 AI 大模型定价全对比》**（2026-06-09）。
- ⚠️ **二者均为二手汇总，本次未逐一回溯厂商官方页** → **不采用其具体数字**，只登记"存在此类比对"。记入 §8。
- **已知可用事实（来自 §3.1 Fiction Bench 原文）**：该榜列出了各模型**写一万字的人民币/美元折算成本**，且注明出处是 **models.dev 列表价快照（2026-07-24）**：
  - DeepSeek V4 Flash（玄幻第 1）**$0.032 / 一万字**；DeepSeek V4 Pro **$0.099**；GLM-5.2 **$0.34**；Kimi K2.6 **$0.24**；Grok 4.5 **$0.48**；Gemini 3.1 Pro **$0.56**；GPT-5.6 Terra **$0.71**；**Claude Opus 4.8 $1.34**（榜上最贵）。
  - 该页自述口径（逐字）：**"按 App 续写口径估算：一段约 400 字 = 装填 8k token 上下文 + 输出 550 token，一万字 ≈ 25 段；取各家官方列表价（models.dev 快照 2026-07-24），不含缓存折扣——开缓存后长会话实际更低。只作组间相对比较，不是账单预测。"**
  - ⚠️ **这是第三方榜单以列表价折算的量级比较，不是厂商官方报价，也不是账单预测。** 标【原文·第三方折算】。

### 5.5 关于"通道接不上"的现实：聚合网关已被实际使用

- 【原文·Fiction Bench 方法节，逐字】：
  > "接入通道逐模型标在详情页——**ds 系走官方 API，gemini/claude 走 yunwu 聚合网关**，其余走评审网关直连。"
  → **一家真正在跑多模型实测的团队，对 Claude/Gemini 走的是第三方聚合网关（yunwu），对 DeepSeek 走官方 API。** 这**间接印证了"Claude/Gemini 直连存在障碍"**，但**这是第三方做法，不是官方结论**，也**不能据此评价各通道的合法性/稳定性**。【推断·基于第三方原文】
- 【原文】另一家（Louis-François Bouchard，§2.2）自述：**"DeepSeek and Kimi use recorded OpenRouter usage; Claude Code runs use measured output with API-equivalent pricing"** → 同样**经 OpenRouter 中转**。

### 5.6 可接入性小结（逐模型）

| 模型 | 官方 API | 中国大陆可用性 | 长上下文 | 定价 |
|---|---|---|---|---|
| **DeepSeek** | ✅ `api.deepseek.com`，**同时提供 OpenAI 与 Anthropic 两种格式端点** | ✅ 中国公司，**本次未发现障碍**（【推断】） | 1M / 输出 384K | **✅ 官方原文已录（§5.1）** |
| **Claude** | ✅ 有官方 API | **未查**（官方区域页未取正文） | 未查 | **未查**（仅第三方折算 $1.34/万字） |
| **Gemini** | 未查 | **未查** | 未查 | **未查** |
| **Kimi / GLM / Qwen 等国产** | 未逐一查 | 未查 | 未查 | 仅二手汇总，**未采用** |


---

## §6 🔴 选型结论

> **先说三条贯穿全报告的判断规则**（每条都有本报告内的原文支撑）：
> 1. **单轮体感不能选长对话模型**——PlotPoints 原文实测 **ρ = −0.24**（单轮与 12 轮排名负相关）。
> 2. **中文场景必须用中文榜**——本次查到的中文实测（Fiction Bench）第一名与英文/通用榜首**完全不重叠**。
> 3. **不能把"通用智力/价格"当"文风能力"的代理**——Fiction Bench 原文："牌价买的是通用智力和推理能力，文风复刻是另一种能力"。

### 6.1 首选：**DeepSeek**（具体用 `deepseek-flash` = DeepSeek-V4.1-Flash）

**依据强度：最强**（三条独立证据链 + 官方可接入性原文）

| 支撑 | 类型 | 内容 |
|---|---|---|
| Fiction Bench 玄幻榜 **第 1**（中文 · 20 轮） | 【原文·行业实测】 | "三窗全胜、「唯一越写越好的系统」"；未观察到长程失效；写一万字 $0.032 |
| Fiction Bench 女频榜，**DeepSeek V4 Pro 第 1-2** | 【原文·行业实测】 | "无短板稳健型"；未观察到长程失效 |
| PlotPoints multi-turn **第 2**（12 轮 · 人类盲投 · 角色扮演专用） | 【原文·人类盲投】 | DeepSeek v4 Pro **1546**，仅次 Claude Opus 4.7 (1575)；原文 "**Strong tone consistency at fraction of Opus pricing**" |
| PlotPoints composite 第 6（DeepSeek v3.2，**73.8**） | 【原文·人类盲投】 | "Reliable… **Strong lore retention**"（**世界观记忆强**，对本项目的"状态笔记本"设定直接相关） |
| 官方接入性 | 【原文·官方】 | 1M 上下文、384K 输出、**同时提供 OpenAI 与 Anthropic 两种端点**、并发 2500、**官方价已录**（flash 输出峰值 $1.20/1M）、**中国公司，内地可达** |
| Louis-François 写作评测 | 【原文·第三方自建】 | **87.13/100** vs 榜首 89.71，**成本差约 409 倍** |

**为什么用 `flash` 而不是 `pro`**：
- 官方定价页原文显示 **`deepseek-flash`（=V4.1-Flash）** 是**更新的一代**（V4-Pro 的版本号仍是 `DeepSeek-V4-Pro-0813`），**且已把 `deepseek-v4-flash` 旧名退役并路由到 V4.1-Flash**。
- **成本相差约 5-6 倍**（flash 输出峰值 $1.20 vs pro $3.96）。
- ⚠️ **但注意一条反向证据**：Fiction Bench 原文显示 **V4 Pro 正式版（0813）在中文文风上"负于自家 0716 preview"**，且 **V4 Flash 与 V4 Pro 在不同文体上互有胜负**（玄幻 flash 第 1、女频 pro 第 1-2）→ **若项目以"中文文学性"为最高优先，V4 Pro 值得并列试跑**。
- 🔴 **本会话环境里，flash 与 pro 是同一家的两个档位，建议两个都接上，用项目自己的验收样本定胜负**（这是唯一能绕过"榜单版本迭代太快"的办法）。

**退路的准备（同家内）**：若 flash 效果不足，**升到 `deepseek-v4-pro`** —— 这是**同一 API、同一套凭据、只改模型名**的零成本切换。

### 6.2 备选：**Claude**（Anthropic）

**依据强度：强（在"角色扮演一致性"这一维度上是最强的），但接入性未查实、成本最高**

| 支撑 | 类型 | 内容 |
|---|---|---|
| PlotPoints **multi-turn 第 1**（1575）＋ **composite 第 1**（97.6）＋ **rubric 第 1**（4.54）＋ **failures 第 1**（2.75） | 【原文·人类盲投】 | **四项第一**，是本报告里**唯一**在多个维度同时登顶的模型 |
| EQ-Bench **Spiral-Bench v1.2 第 2**（claude-sonnet-4.5 = 70.3，仅次 70.8） | 【原文】 | 多轮 roleplay 下的**低谄媚/低妄想强化**——角色扮演的"边界感" |
| EQ-Bench **Creative Writing v3** 前 10 占 4 席 | 【原文·可复现】 | claude-opus-5 2120.6（第 3）等 |
| Louis-François 写作评测 **第 1**（Claude Fable 5.1, max = 89.71） | 【原文·第三方自建】 | 但每稿 $3.1525、均时 622.5 秒 |
| Fiction Bench **#5-6**（Claude Opus 4.8） | 【原文·行业实测】 | "**六模型轮里波动最大（early 最差 → mid 高光 → late 崩坏）**" ← ⚠️ **负面** |

**⚠️ 两条必须写明的风险：**
1. 🔴 **接入性未查实**：Anthropic 官方《Supported countries and regions》页**本次未取到正文**，**"中国大陆/香港能否直连"必须标"未查"**。→ **这正是"首选通道接不上时"的判定点。**
2. 🔴 **长对话稳定性有负面实测**：Fiction Bench 原文记录 Claude Opus 4.8 在中文 20 轮里是**"波动最大"**的模型（early 最差 → mid 高光 → late 崩坏）。→ **与 PlotPoints 的"第 1"结论存在张力**；合理的解释是**两者测的维度不同**（PlotPoints 测 12 轮角色扮演稳定性，Fiction Bench 测中文文学续写 20 轮），**也可能与语言有关（中文 vs 英文）**。【推断】

### 6.3 退路（按优先级）

1. **首选接不上（DeepSeek 官方 API 在你的部署环境不可达）** → 退到 **DeepSeek 的第三方聚合通道**（OpenRouter 等；Fiction Bench 与 Louis-François 两家实测团队**都在用**，见 §5.5）。**模型不变，只换通道。**
2. **DeepSeek 整体不可用** → 退到 **GLM（智谱 Z.AI）**：
   - PlotPoints **composite 第 2**（GLM 4.7 = **92.9**，仅次于 Claude Opus 4.7），**$0.9/1M**；
   - Fiction Bench 玄幻 **2-4**（GLM-5.2），原文 "**全程横盘零漂移**"；写一万字 **$0.34**；
   - EQ-Bench Creative Writing v3 有 GLM-5.3（2064.1，**第 5**）。
   → **依据强度：中强**（两个独立实测榜互相印证"稳"，但中文榜上不是第一）。
3. **需要"最省"** → **Gemini 3.1 Flash Lite**：PlotPoints **multi-turn 第 3**（1533）且 **$0.18/1M**；但 **Fiction Bench 的 Gemini 3.1 Pro 中文玄幻垫底（9/9）**，且该墊底被归因于**指令措辞 bug** → **风险高，只作探索项，不作退路。**
4. **不推荐作为首选**：Kimi（PlotPoints "Catastrophic agency floor on bait scenes"）、Grok（"Drifts fast under pressure" / 中文榜"中途卡死"）、Qwen 3.5 Flash（"Floor on agency and instruction drift. Caveat emptor."）。

### 6.4 🔴 关于用户说法 2 的一句话回应

> **"DeepSeek v4.1 文字能力很不好"——本次没有找到任何可核对的证据支持它；相反找到两条方向相反的证据（第三方 100 分制写作评测 87.13/100，与榜首差 2.58 分；中文 20 轮长跑 V4 系夺冠）。而最可能造成这个印象的两个来源是：（a）V4.1 其实是"Flash 小档"（官方定价页原文可证），（b）社区长期抱怨的"复读/不遵循预设"是可修的提示词工程问题，不是能力上限。**
> **→ 建议：不要把这条说法当决策依据；用项目自己的样本做一次对照试跑再定。**（对照试跑的具体建议见 §8）

### 6.5 🔴 本结论的强弱分层（用户明确要求）

| 分层 | 内容 |
|---|---|
| **可复现评测（最强）** | EQ-Bench Creative Writing v3 / Spiral-Bench、PlotPoints（原始选票 CC-BY 公开）、LMArena Creative Writing |
| **行业实测（次强，方法透明但样本小）** | Fiction Bench（中文 20 轮，n=1 链/书）、Louis-François 写作评测（148 配置 × 10 任务 × 5 稿） |
| **社区口碑（最弱）** | r/SillyTavernAI 的体感帖、modelgrep 使用率 |
| **本文推断** | 所有标【推断】处，含"退路"排序与"flash vs pro"的建议 |


---

## §7 未找到与已试检索词

### 7.1 明确"未找到 / 未取到"

| 目标 | 状态 | 原因 |
|---|---|---|
| LMArena 官方 Creative Writing 榜**前 164 名** | 🔴 **未取到** | `scrape_webpage` 返回内容被截断，只落到 rank 165–400 区间 |
| LMArena **Roleplay 独立分类** | 🔴 **不存在** | 官方导航栏逐项已录，无该分类 |
| **DeepSeek V4.1 在 LMArena 上的名次** | 🔴 **未取到** | 榜头未取到，**不能断言"未收录"** |
| EQ-Bench **4** 榜首排名 | 🔴 **未取到** | 页面 JS 异步加载（显示 "Loading…"） |
| EQ-Bench **Longform Writing** 榜首排名 | 🔴 **未取到** | 同上；其 JS 数据文件（1.12MB）**正则未解析出 CSV 行**（格式与 Creative Writing 不同，未再深挖） |
| EQ-Bench **Slop Score / Judgemark / BuzzBench / DiploBench** | 🔴 **未查** | 导航已见其存在，**未逐一抓取** |
| **AidanBench** | 🔴 **未找到** | 本次检索组合中未出现该榜 |
| **Omdia《2026 中文创意写作能力评估》原始报告** | 🔴 **未取到** | 只见转载新闻摘要（大旗号，2026-05-20） |
| **WritingBench 原文/榜单** | 🔴 **未取到** | 只见智源社区与腾讯新闻转载页 |
| **EssayBench（AAAI 2026）正文** | 🔴 **未取到** | 只由搜索给出 DOI `10.1609/aaai.v44i…`（实为 `v40i44.41072`）与年份 |
| **Anthropic 官方支持区域页正文** | 🔴 **未取到** | 只取到搜索结果摘要 → 故 §5.2 标"未查" |
| **Gemini API 定价与区域可用性** | 🔴 **未查** | 本次未检索 |
| **Kimi / GLM / Qwen / MiniMax 官方定价页** | 🔴 **未查** | 只见到二手汇总页（未采用） |
| **modelgrep《Best Models for SillyTavern》正文** | 🔴 **未取到** | 只有搜索摘要 |
| **Model Gauntlet / LM Market Cap / Benchmark Atlas**（三个 LMArena 镜像站） | 🔴 **未取正文** | 只登记存在 |

### 7.2 已试检索词（供后续重跑参考）

**搜索工具：**
- `LMArena leaderboard Creative Writing Roleplay category ranking`
- `中文 创意写作 大模型 评测 榜单 WritingBench 中文写作`
- `["DeepSeek V4.1 写作能力 评测", "DeepSeek V4.1 release writing benchmark", "SillyTavern roleplay model ranking 2026 deepseek claude gemini"]`
- `["DeepSeek API pricing 2026 V4.1 Flash input output per million tokens", "Claude API availability China mainland access 2026", "Qwen GLM Kimi API 定价 2026 每百万 tokens"]`

**Reddit（RSS 通道，`reddit_fetch.py`）：**
- `search --sub SillyTavernAI "best model roleplay writing"` → 落盘 **91 帖**（成功）
- `search "deepseek roleplay writing quality"`（默认 r/ApplyingToCollege，命中 1，**跑错版**）
- `search --sub LocalLLaMA "deepseek roleplay creative writing"` → **超时被 SIGTERM**（未取得结果）

**直抓 URL：**
- `arena.ai/leaderboard/text/creative-writing`、`benchleader.com/benchmarks/lmarena_text_creative`
- `eqbench.com/`、`/creative_writing.html`、`/creative_writing_chartdata.js`、`/creative_writing.js`、`/creative_writing_longform.html`+`.js`、`/spiral-bench.html`+`.js`
- `foreverse.app/zh/research/fiction-bench`
- `plotlightstudios.com/plotpoints`、`/plotpoints/round/2`、`/api/plotpoints/leaderboard?round=2`、`/api/plotpoints/raw?round=2`
- `api-docs.deepseek.com/quick_start/pricing/`、`api-docs.deepseek.com/news/news260910`（**302 未跟随**）
- `louisbouchard.ai/deepseek-v41-flash-kv-cache-writing-benchmark/`

---

## §8 待确认清单

> 本节按用户任务书要求列出**需要用户/主代理拍板或补查**的事项，按对决策的影响排序。

### A. 必须先补的三条数据（直接影响首选判定）

| # | 事项 | 为什么重要 | 建议动作 | 我的倾向 |
|---|---|---|---|---|
| A1 | **LMArena 官方 Creative Writing 榜前 164 名** | 本次只抓到 165 名之后，**无法回答"DeepSeek V4.1 在 LMArena 上排第几"** | 用 JS 渲染（`browser_navigate`）或直接取 HuggingFace `lmarena-ai/leaderboard-dataset` | 补抓 |
| A2 | **EQ-Bench 4 榜首** | EQ-Bench 4 是**唯一**"多轮 roleplay + 情绪/社交智能"专项榜，本报告只能给出机制、给不出排名 | 抓其异步数据接口 | 补抓 |
| A3 | **Anthropic 官方支持区域页正文** | **决定"Claude 是否能作为备选"**。本报告只能标"未查" | 抓 `anthropic.com/supported-countries` + `platform.claude.com/docs/en/api/supported-regions` | 补抓，**这是备选可行性的唯一门槛** |

### B. 需要用户拍板的产品口径

| # | 歧义 | 选项 | 我的倾向（【推断】） |
|---|---|---|---|
| B1 | **"文学能力"的优先级到底多高？** | ① 文学性优先（宁可慢、贵）；② 教学正确性 + 稳定性优先，文学性够用即可；③ 两者并重 | **倾向 ②/③**：本项目是**家教系统**，不是小说生成器。§4.5 原文已证"12 轮稳定性"与"单轮魅力"负相关——**稳定性比文采更容易决定课程成败** |
| B2 | **模型版本口径**：`deepseek-flash`（V4.1-Flash）还是 `deepseek-v4-pro`？ | ① 只用 flash（最省）；② 只用 pro（中文文学更强）；③ **两个都接，用项目样本 A/B** | **倾向 ③**（同 API、同凭据、只改模型名，切换成本≈0） |
| B3 | **是否接受第三方聚合通道**（OpenRouter / yunwu 等）？ | ① 只用官方 API；② 官方优先，聚合作退路；③ 不介意 | **倾向 ②**。注意：**PlatPoints 与 Fiction Bench 的实测都走聚合通道**，所以"聚合通道下的模型表现"是有实测背书的；但**开源项目的用户会自己配 key**，故**应支持两种** |
| B4 | **是否把"中文长对话"当作独立验收项？** | 是/否 | **强烈倾向"是"**。§4.5 原文 ρ = −0.24 已证明它不能由单轮表现推出 |

### C. 明确无法从本次证据回答的问题（留给后续）

| # | 问题 | 现状 |
|---|---|---|
| C1 | **V4.1-Flash 在中文文学上的表现** | 🔴 **本次未找到任何中文榜收录 V4.1**（Fiction Bench 快照 2026-07-16 早于其 2026-09-10 发布；EQ-Bench CW v3 无此条目）→ **完全空白** |
| C2 | **各模型在"几十轮"（30+ 轮）下的表现** | 🔴 **本次所有榜最长只到 20 轮**（Fiction Bench）、12 轮（PlotPoints）、16 轮（EQ-Bench 4）→ **"几十轮"这一段无任何实测覆盖** |
| C3 | **苏格拉底式提问（教学正确性）的专项评测** | 🔴 **本次未找到任何"教学/提问质量"专项榜** |
| C4 | **中文古风/口语化对话的专项评测** | 🔴 **未找到**。Fiction Bench 的"女频《甄嬛传》"是本次最接近的一个（古言宫斗），但它是**续写**不是**对话** |
| C5 | **Gemini / Claude 的官方定价** | 🔴 未查（只有第三方折算值） |

### D. 🔴 建议的一次对照试跑（把 C1–C4 的空白一次填上）

【推断·我的建议，非任何来源的结论】
- **样本**：用本项目自己的一个真实课程片段（角色设定 + 教材 + 状态笔记本），**连续跑 30 轮以上**。
- **对照组**：`deepseek-flash` / `deepseek-v4-pro` / 一个 Claude 档位 / 一个 GLM 档位 —— **至少 4 个**。
- **测什么**（每条都对应本报告里某条实测）：
  1. **指令遵循**（社区原文点名的 DeepSeek 弱项）：状态笔记本里的规则是否被遵守；
  2. **重复率**（Fiction Bench 的 12-gram 思路）：**跨轮重复检测**，尤其后半段；
  3. **角色漂移**：是否退化成"通用乐于助人的助手"；
  4. **教学正确性**：提问是否真的推进了知识（人工抽检）；
  5. **行为分化**（§1.5.2 的观察点）：同一角色在**不同情境下是否做出不同教学决策**，而不是只换语气。
- **结论据此定，不据本报告的榜单单点** —— 因为**榜单版本迭代快于本项目节奏**，这也是本报告反复标注版本日期的原因。

---

## §9 来源清单

> 每条：名称 / URL / 日期 / 结论出自摘要还是正文。

### 9.1 可复现榜单

| # | 名称 | URL | 日期 | 出处位置 |
|---|---|---|---|---|
| 1 | LMArena（Arena Intelligence）Text Arena — Creative Writing | https://arena.ai/leaderboard/text/creative-writing | 抓取 2026-09-22；**榜快照日未标注** | **正文**（但正文被截断，仅 rank 165–400） |
| 2 | PlotPoints（Plotlight Studios） | https://plotlightstudios.com/plotpoints ／ API `https://plotlightstudios.com/api/plotpoints/leaderboard?round=2` | API 自报 `generatedAt` **2026-09-22T06:26:50.764Z**；Round 02 期号 "April–June 2026" | **正文（JSON 结构化数据，最可靠）** |
| 3 | PlotPoints Issue № 02（结论页） | https://plotlightstudios.com/plotpoints/round/2 | 同上 | **正文** |
| 4 | PlotPoints 原始选票 CSV（CC-BY 4.0） | https://plotlightstudios.com/api/plotpoints/raw?round=2 | 同上 | **原始数据**（本次已下载，未逐行分析） |
| 5 | EQ-Bench Creative Writing v3 | https://eqbench.com/creative_writing.html ＋ 数据 `https://eqbench.com/creative_writing_chartdata.js?v=1.0.91` | 抓取 2026-09-22；**榜快照日未标注** | **正文（JS 数据文件，132 行 CSV，本次自行解析）** |
| 6 | EQ-Bench Spiral-Bench v1.2 | https://eqbench.com/spiral-bench.html ＋ 数据 `https://eqbench.com/spiral-bench.js?v=1.0.1` | 抓取 2026-09-22；**榜快照日未标注** | **正文** |
| 7 | EQ-Bench 4（方法论与限制） | https://eqbench.com/ | 抓取 2026-09-22 | **正文**（仅机制；**排名未取**） |
| 8 | BenchLeader（LMArena 镜像，二手） | https://www.benchleader.com/benchmarks/lmarena_text_creative | 页面自述 **2026-09-21** | **正文**（但为二手镜像，仅作交叉参考） |

### 9.2 行业实测

| # | 名称 | URL | 日期 | 出处位置 |
|---|---|---|---|---|
| 9 | Foreverse（新梦）Fiction Bench | https://foreverse.app/zh/research/fiction-bench | 评测 **2026-07-16**／发布 **2026-07-24**／价格快照 **2026-07-24**；增量对局 2026-07-18 至 08-13 | **正文** |
| 10 | Louis-François Bouchard《DeepSeek V4.1 Flash: Smaller KV Cache, Cheaper Writing Drafts》 | https://www.louisbouchard.ai/deepseek-v41-flash-kv-cache-writing-benchmark/ （副题含 "Our September 10 snapshot"） | 文章 **2026-09-13**；数据快照 **2026-09-10** | **正文** |

### 9.3 官方来源

| # | 名称 | URL | 日期 | 出处位置 |
|---|---|---|---|---|
| 11 | DeepSeek《Models & Pricing》 | https://api-docs.deepseek.com/quick_start/pricing/ | 抓取 2026-09-22；页面版权 `© 2026 DeepSeek, Inc.` | **正文（全部定价与脚注逐字）** |
| 12 | DeepSeek《DeepSeek-V4.1-Flash: Smarter, Faster, More Efficient》 | https://api-docs.deepseek.com/news/news260910 | 发布 **2026-09-10** | 🔴 **仅搜索索引摘要**（直抓返回 302，未取正文） |
| 13 | Anthropic《Supported countries and regions》 | https://www.anthropic.com/supported-countries | 抓取尝试 2026-09-22 | 🔴 **仅搜索索引摘要，未取正文** → 标"未查" |
| 14 | Anthropic Claude Platform Docs《Supported regions》 | https://platform.claude.com/docs/en/api/supported-regions | 同上 | 🔴 **未取正文** → 标"未查" |

### 9.4 社区（🔴 全部标【口碑】）

| # | 名称 | URL | 日期 | 出处位置 |
|---|---|---|---|---|
| 15 | r/SillyTavernAI《Gemini 3.5 Flash Lite is actually good for RP (unpopular opinion)》 | https://www.reddit.com/r/SillyTavernAI/comments/1v6a104/ | 经 RSS 抓取 2026-09-22 | **正文** |
| 16 | r/SillyTavernAI《Weekly SillyTavern News Ep. 4》 | https://www.reddit.com/r/SillyTavernAI/comments/1t4d2il/ | 经 RSS 抓取 2026-09-22 | **正文** |
| 17 | r/SillyTavernAI《Don't let AI give you the helpful bot reply》 | https://www.reddit.com/r/SillyTavernAI/comments/1vaun0l/ | 经 RSS 抓取 2026-09-22 | **正文** |
| 18 | modelgrep《Best Models for SillyTavern (August 2026)》 | https://modelgrep.com/best-models-for/sillytavern | 摘要自述 August 2026 | 🔴 **仅搜索摘要，未取正文** |

### 9.5 只登记、未采用（未取正文）

| # | 名称 | URL | 说明 |
|---|---|---|---|
| 19 | Omdia《2026 年基础模型中文创意写作能力评估》（转载页） | https://m.daqihao.com/articles/keji/202605/13280.html | 2026-05-20，转载型媒体；**未取原始报告** |
| 20 | WritingBench（阿里+人大+上交） | 见智源社区/腾讯新闻转载页 | **未取原文** |
| 21 | EssayBench（AAAI 2026） | DOI `10.1609/aaai.v40i44.41072` | **未取正文**；测"中文多体裁散文"，与角色扮演不同轴 |
| 22 | aikit.vip《2026 国产大模型 API 价格对比》 | https://aikit.vip/chinese-llm-api-pricing-comparison-2026/ | 二手汇总，自述检索截止 2026-07-25；**未采用其数字** |
| 23 | 腾讯云社区《2026 国内七大 AI 大模型定价全对比》 | https://cloud.tencent.com/developer/article/2685603 | 2026-06-09；二手 |
| 24 | Model Gauntlet / LM Market Cap / Benchmark Atlas（LMArena 镜像） | 各自站点 | **未取正文**，仅登记 |
| 25 | Tygart Media《Claude API Access from Singapore and China》 | https://tygartmedia.com/claude-api-access-singapore-china-2026/ | 2026-04-29；第三方博客，**未采用** |
| 26 | S5 Labs《DeepSeek V4.1 Flash: Vision, Prices, API Changes》 | https://s5labs.io/resources/insights/deepseek-v41-flash-native-vision-api-migration/ | 2026-09-10；**仅搜索摘要，未采用** |

### 9.6 本报告内的计算与解析（可复跑）

- **EQ-Bench CW v3 排名解析**：正则 `^(\*?[A-Za-z0-9._/ -]+),(\d+\.\d),(\d+\.\d\d),(\d+),(\d+\.\d\d),(\d+\.\d\d),(\d+\.\d\d)$` 作用于 `creative_writing.js?v=1.0.91` → **132 行**。
- **Spiral-Bench 排名解析**：正则 `const leaderboardDataDelusion = \`(.*?)\`;` 后按 `,` 取第 1、2 列 → **23 行**。
- **PlotPoints 排名**：直接 `json.load` API 返回的 `models[]`，按 `multiturnElo` / `compositeScore` 排序。
- ⚠️ **以上解析均为一次性脚本，未落盘为可复用文件**。若需复现，命令已在 §7.2 列出。

