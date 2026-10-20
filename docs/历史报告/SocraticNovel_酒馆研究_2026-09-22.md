# SillyTavern（酒馆）角色扮演提示词系统 · 解剖与可搬运结论（2026-09-22）

> 🔴🔴 **本件已降级（2026-09-22 用户裁定"重新开始调研"）**
> **原因**：本件**只读了官方文档 + V2 规范 + 第三方博客，没有读 SillyTavern 源码**（`public/scripts/*.js` 零抓取）。它自己在 §7 第 1／2／6 条也承认"未核源码"。
> **后果**：其中**基于文档描述的机制归纳不足以作为架构依据** —— 主代理随后自查源码即发现，文档说的"Post-History Instructions"在实现里**不是独立机制**，只是 `injection_depth` 的一个取值（见 `SocraticNovel_角色扮演架构_2026-09-22.md` §2.0）。
> **处置**：**本件降级为"文档级参考"，不得作为架构决策依据**；架构依据以**源码级重做版** `SocraticNovel_酒馆源码调研_2026-09-22.md` 为准。**内容一字未删，保留供对照。**

> 子代理调研产出（2026-09-22）。来源：SillyTavern 官方文档站 docs.sillytavern.app、GitHub character-card-spec-v2 规范仓库、Web 检索补充。
> 引用规则：所有引文为页面原文（英文），中文为转述/推断（每条判断在 §5 标注【原文】/【推断】）；未核条目在 §7 待确认清单。

## 摘要（≤10 条，每条一句话）

1. 【原文】提示词是"分层拼装"：Main/System Prompt + 卡片永久字段（name/description/personality/scenario 每轮必发）+ first_mes（仅开头一次）+ example messages（挤出式保留）+ World Info（按需触发）+ Author's Note（按频率注入）+ 摘要/向量（可选扩展）。
2. 【原文】位置优先级由顺序与深度共同决定：Prompt Manager 列表"Placed closer to the top of the interface are sent earlier"；Author's Note "The closer … to the bottom of the prompt, the more impact it has on the next AI response."
3. 【原文】depth 机制 = 把注记插到聊天历史指定深度（Depth 0 = 最后一条消息之后 = prompt 末尾）；Character's Note "always stays at a static depth in the chat history, regardless of its progression"——固定深度防止被长对话稀释。
4. 【原文】World Info = 关键词/正则触发 + 递归扫描 + token 预算 + 扫描深度 + 8 种注入位置 + 可选向量匹配；官方明示注入"does not guarantee its appearance in the generated output messages"。
5. 【原文】角色卡 V2 字段：spec / creator_notes / system_prompt / post_history_instructions / alternate_greetings / character_book / tags / creator / character_version / extensions；system_prompt 与 post_history_instructions 默认覆盖用户全局设置，均支持 {{original}} 嵌入原值。
6. 【原文】V2 spec 明写的经验法则："system instructions written after the conversation history have a much stronger weight on current models' generations than instructions written before the conversation history"——历史之后的指令权重更高。
7. 【原文】宏 = "dynamic placeholders that get replaced with actual values when text is processed"，支持嵌套/条件/变量读写——模板化是长对话一致性的基础。
8. 【原文】四类长期记忆：永久 token、WI 按需注入、AN 常驻、摘要压缩（"may lose some important details or contain hallucinations"）；所有注入都不保证生效。
9. 【原文】社区对"记忆下降/角色漂移"的归因：context window 挤爆（thredly.io）、字段模糊或矛盾（blog.mini-tavern.com）；官方文档本次检索未见 drift 专章。
10. 【原文+推断】酒馆教学实践集中在语言学习（LanguageLearningHelper、NihongoHelper 的 "Language Assistant Side Chat — Slide-out meta tutor panel"）；无系统性课程框架 → 教材自动进场景、事实回查、答案评估需自研（§5-C）。

## §1 提示词架构（含位置/优先级/depth 机制）

### 1a. Prompt Manager（Chat Completion API 用；Text Completion API 用 Advanced Formatting）
【来源】https://docs.sillytavern.app/usage/prompts/prompt-manager/ （HTTP 200，2026-09-22 抓取）

- 定位（原文）："The Prompt Manager is a system that provides more control over the prompt-building strategy for Chat Completion APIs."；"The Prompt Manager forms the backbone of the prompt sent to the Chat Completion model. It controls what is sent as well as the order in which it is sent."
- **Prompts List = 拖拽排序界面（原文）**："Prompts placed closer to the top of the interface are sent earlier. The bottom of the list is the last thing sent to the model (typically, this would be your Post-History Instructions)."
- **Pinned（默认）prompts 清单（原文）**：Main Prompt, World Info (before/after), Persona Description, Character Description, Character Personality, Scenario, Enhance Definitions, Auxiliary Prompt, Chat Examples, Chat History, Post-History Instructions——"The default prompts cannot be removed from the list of selected prompts. … If these are not desired, they can be toggled 'OFF', but not removed or deleted outright."
- 每个 prompt 可配：Role（System / AI Assistant / User）、Triggers（Normal/Continue/Impersonate/Swipe/Regenerate/Quiet）、**Position（Relative 按列表顺序 / In-Chat + Depth）**、Order（"Prompts that have the same Role and Depth will be grouped together and ordered by their Order value. The order is as follows (from top to bottom): User, AI Assistant, System."）。
- 预设与角色卡同名时自动选中（原文）："If a preset shares a name with one of your character cards, it will be automatically selected when starting a chat with that character."
- Utility Prompts（原文）：Format Templates 用 `{0}`（World Info）/`{{scenario}}`/`{{personality}}` 占位包裹注入信息；New Chat/New Group Chat/New Example Chat 在历史前告知模型"背景信息结束、对话开始"；Continue Nudge 在 prompt 末尾。

### 1b. **Depth（深度）机制 —— 本报告重点**
- Prompt Manager 的 In-Chat Depth（原文）："When Position is set to In-Chat, this defines how deep the prompt is sent within the chat history. The higher the number, the deeper it is sent. For example, a Depth of 0 will be sent after the last chat message, a Depth of 1 will be sent before the last chat message, and a Depth of 2 will be sent before the second-to-last chat message, and so on."（深度 0 = 最后一条消息之后 = prompt 最末尾）
- World Info 的 @ D 位置（原文，见 §2）："World Info entry is inserted at a specific depth in the chat (Depth 0 being the bottom of the prompt)."
- **Character's Note（角色常驻注记）用深度注入（原文）**：https://docs.sillytavern.app/usage/core-concepts/characterdesign/ ——"A text to be used as an in-chat prompt injection for the character at a specific message depth. It is usually used to reinforce certain character traits, as it always stays at a static depth in the chat history, regardless of its progression. @ Depth : The number of messages in the chat history after which this note will be injected (in order from newest to oldest). If set to 0, it will be injected after the last message." Role 可配 User/System/Assistant。
- Story String（Text Completion 侧）也可放 In-chat @ Depth（原文，context-template 页）："you can move it to a dynamic position by choosing the 'In-chat @ Depth' option, which places the story string at a specific depth in the chat context." ⚠️ 警告（原文）："If the template contains static prompt elements (model-specific prefixes or suffixes) for wrapping the story string, using the 'In-Chat @ Depth' position will cause it to be incorrectly double-wrapped with duplicate sequences."
- **为什么要有 depth（推理，非原文）**：越靠近 prompt 末尾（贴近最后一条消息/生成点）的文本对模型输出影响越大——World Info 文档在 Insertion Order 处明说"larger order numbers will be inserted closer to the end of the context as they will have more impact on the output"，同一原理适用于深度注入。Character's Note 文档说它"always stays at a static depth in the chat history, regardless of its progression"——即不随对话增长被挤出，保证常驻影响力。【推断：depth 是"固定位置影响力"与"不被长对话稀释"两件事的工程解。】

### 1c. Context Template / Story String（Text Completion API 的组装模板）
【来源】https://docs.sillytavern.app/usage/prompts/context-template/ （HTTP 200）

- Story String 是 prompt 前言的模板（原文）："This field is a template for the prompt preamble (known internally as a story string). This is the main way to add the information defined in Character Cards for text completion and instruct models." 支持 Handlebars 语法 + 宏。
- 可用参数（原文）：{{anchorBefore}} / {{anchorAfter}}（固定位置锚点）、{{description}}、{{scenario}}、{{personality}}、{{system}}、{{persona}}、{{char}}、{{user}}、{{wiBefore}}/{{loreBefore}}、{{wiAfter}}/{{loreAfter}}、{{mesExamples}}、{{mesExamplesRaw}}。**WARNING（原文）**："If any of the above parameters are missing from the story string template, they will not be sent in the prompt at all."
- **Prompt Anchors（原文）**："The {{anchorBefore}} and {{anchorAfter}} are generic placeholders for prompts added by various extensions and miscellaneous features in a chosen static position, for example: Author's Note / Summaries / Chat Vectorization / Data Bank / STscript injections / Web Search"——即外部注入统一走锚点。
- 默认位置（原文）："By default, the rendered story string (with all placeholders replaced) is placed at the very beginning of the prompt, followed by example messages and the visible chat history."
- 其他（原文）：Example Separator 替换 <START>；Chat Start 插在 story string 与 example 之后、第一条消息之前；Names as Stop Strings "Recommended to keep it on to prevent model impersonation"；Always add character's name to prompt 在文本末尾追加 "Character:" 强制模型以角色口吻续写（Instruct Mode 下无效）。

### 1d. Advanced Formatting（Text Completion 总控）
【来源】https://docs.sillytavern.app/usage/core-concepts/advancedformatting/ （HTTP 200）

- System Prompt（原文）："The System Prompt defines the general instructions for the model to follow. It sets the tone and context for the conversation. … The System Prompt is a part of the Story String and usually the first part of the prompt that the model receives."
- Context Template（原文）："Usually, AI models require you to provide the character data to them in some specific way. SillyTavern includes a list of pre-made conversion rules for different models, but you may customize them however you like."
- Backend-defined templates（原文）：部分后端（仅 llama.cpp / KoboldCpp）比对模型 tokenizer_config.json 里的 chat template 哈希自动选模板（Llama 3, Gemma 2, Mistral V7 等默认模板）。
- Start Reply With（原文）：Text Completion 侧"Prefills the last line of the prompt, forcing the model to continue from that point"；Chat Completion 侧"Adds an assistant role message to the end of the prompt"（预填充回复）。

### 1e. Character Design 里的"每轮必发 vs 非必发"
【来源】https://docs.sillytavern.app/usage/core-concepts/characterdesign/ （HTTP 200）

- **Permanent Tokens（原文）**："These will always be sent to the AI with every generation request: Character Name / Character Description Box / Character Personality Box / Scenario Box"。
- **非 permanent（原文）**："The first message box - only sent once at the start of the chat. / Example messages box - only kept until chat history fills up the context (optionally these can be forced to be kept in context)"
- token 代价（原文）："If you're working with an AI model with a 2048 context token limit, a 1000-token character definition cuts the AI's 'memory' in half."；定义超过上下文一半时 token 计数器变红。
- First Message 风格定调（原文）："The model is more likely to pick up the style and length constraints from the first message than anything else"。
- Prompt Overrides（原文）：Main Prompt 与 Post-History Instructions 可被角色卡覆盖（需用户设置 Prefer Char. Prompt / Prefer Char. Instructions）；{{original}} 宏可在覆写文本中嵌入原默认值。

### 1f. Author's Note —— 可编程常驻注记（depth 机制的典型应用）
【来源】https://docs.sillytavern.app/usage/core-concepts/authors-note/ （HTTP 200，2026-09-22 抓取）

- 定义（原文）："Author's Note is a powerful tool for customizing AI responses which inserts a section of text into the prompt at any position and at any frequency you desire."
- 两种放置（原文）：After Scenario："This places the Author's Note towards the top of the context after the 'Scenario' section of the Character Definition. If no scenario is specified, it will be placed after the last portion of the Character Definition, and before the Example messages."；In-chat："Depth 0 = placed at the very end of the chat history. Depth 4 = placed before the most recent 3 chat history messages, making it become the 4th entity in the chat history."
- **影响力原理（原文，本项目最值得抄的一句）**："The closer the Author's Note is to the bottom of the prompt, the more impact it has on the next AI response."
- Insertion Frequency（原文）："Frequency 0 = Author's Note will never be inserted. Frequency 1 = Author's Note will be inserted with every user input prompt. Frequency 4 = Author's Note will be inserted into every 4th user input prompt."（§2 已记：若 Frequency=0，WI 条目在 AN 位置也会被忽略。）
- 官方用例（原文）：提醒回复格式（[Your next response must be 300 tokens in length.]）、强化指令（[Remember the instructions you were given at the beginning of this chat.]）、临时 World Info / Character Bias / 非 Instruct 模型的 Instruct（[{{char}} is in the library]）。
- 每条 chat 有独立 AN，另有 Default Author's Note 应用到每个新 chat（原文）。

### 1g. 宏系统（Macros）
【来源】https://docs.sillytavern.app/usage/core-concepts/macros/ （HTTP 200，2026-09-22 抓取，正文截断至变量宏一节）

- 定义（原文）："Macros are dynamic placeholders that get replaced with actual values when text is processed. They are used throughout SillyTavern in prompts, character cards, lorebooks, Quick Replies, and more."
- 语法（原文）：双花括号 {{macroName}}；**宏名大小写不敏感**（{{User}}/{{USER}}/{{user}} 相同）；支持参数（空格 / :: 分隔）、**嵌套**（内层先解析）、**作用域**（{{macro}}…{{/macro}}，内容自动去缩进）、**条件** {{if}}/{{else}}/{{/if}}、变量简写（. 局部 / $ 全局）与运算符（= ++ -- += -= || ?? ||= ??= == != > >= < <=）、注释 {{//}}、转义 \{\{。
- 常用宏清单（原文表格）：身份类 {{user}}（当前用户/persona 名）、{{char}}（当前角色名）、{{charIfNotGroup}}、{{group}}；卡片字段类 {{description}} {{personality}} {{scenario}} {{persona}} {{charPrompt}} {{charInstruction}} {{charDepthPrompt}}（角色的 @ Depth Note）、{{charCreatorNotes}} {{charVersion}} {{mesExamples}} {{mesExamplesRaw}} {{charFirstMessage}}；**{{original}}："Original message content for substitution in character prompt overrides"**；聊天类 {{lastMessage}} {{lastUserMessage}} {{lastCharMessage}} {{firstIncludedMessageId}} {{summary}}（"Latest chat summary from the Summarize extension (when available)"）；时间类 {{time}} {{date}} {{weekday}} {{isotime}} {{isodate}} {{datetimeformat}} {{idleDuration}} {{timeDiff}}。
- 变量持久性（原文）：{{setvar}}/{{getvar}}/{{incvar}} 及 . $ 简写——变量可在对话中读写，用于跨轮状态（示例 {{.health -= 10}}）。
- Legacy 语法 <USER>/<BOT> 自动转换为 {{user}}/{{char}}（原文）。
- **长对话一致性要点（原文+推断）**：宏在每次构建 prompt 时重新求值（如 {{time}}/{{lastMessage}}），{{charDepthPrompt}} 让角色注记按深度常驻，{{summary}} 提供摘要宏——思路是"提示词模板化 + 每次渲染"。【推断：对我们的启发是 markdown 教室也可以定义"每次加载时渲染的模板字段"，而不是把状态写死在静态文件里。】

### 1h. Instruct Mode / Context Template（不同模型族的提示词外壳）
【来源】https://docs.sillytavern.app/usage/core-concepts/instructmode/ （HTTP 200，2026-09-22 抓取）

- 定义（原文）："Instruct Mode allows you to adjust the prompting for instruction-following models trained on various prompt formats, such as Alpaca, ChatML, Llama2, etc." 仅适用于 Text Completion API；Chat Completion 侧"not supported (and not needed) … They use an entirely different prompt builder."
- 模板（原文）："Provides ready-made templates with sequences for some well-known instruct models."；Activation Regex："If defined as a valid regular expression, when connected to a model and its name matches this regex, will automatically select this template."
- 核心 = 消息包装序列（原文）：Story String Prefix/Suffix、User/Assistant/System Message Prefix/Suffix、First Assistant Prefix、Last Assistant Prefix、System Instruction Prefix（后台生成用）、User Filler Message（"Will be inserted at the start of the chat history if it doesn't start with a User message. Use case: when an instruct format strictly requires prompts to be user-first and have messages with alternating roles only, examples: Llama 2 Chat, Mistral Instruct."）、Stop Sequence（"Text that denotes the end of the reply. Also sent as a stopping string to the backend API."）。
- Include Names 三档（原文）：Never / Groups and Past Personas / Always——给聊天历史消息加名字前缀。
- 注意（原文）："All prefix sequences will also be automatically used as stopping strings."；NovelAI 的 instruct 模块由花括号指令自动激活（"User: { Write a happy song about Nintendo Switch. }"）。
- **与 Prompt Manager 的关系（原文+推断）**：同一层功能在两套 API 上的双实现——Text Completion 用 Instruct Mode + Context Template（故事字符串 + 序列包装），Chat Completion 用 Prompt Manager（角色化消息列表）。【推断：对我们无直接意义（我们走 DSH 的 system 指令 + 工具），但"模板要与具体模型族的训练格式匹配"是普适教训——写 system 指令时要按目标模型的指令遵循习惯组织。】

## §2 世界书与触发式注入（World Info 原文机制）

【来源】https://docs.sillytavern.app/usage/core-concepts/worldinfo/ （HTTP 200，2026-09-22 抓取）

**定义（原文）**：World Info (also known as Lorebooks or Memory Books) 是 "a powerful tool available in ST to insert prompts dynamically into your chat to help guide the AI replies."；"It functions like a dynamic dictionary that only inserts relevant information from World Info entries when keywords associated with the entries are present in the message text." 关键警告（原文）："while World Info helps guide the AI toward the desired content, it does not guarantee its appearance in the generated output messages. That depends on how good your model is at making use of additional information!"

**触发器字段（原文）**：Key（关键词列表，默认大小写不敏感、可配置）；支持正则（Javascript regex 风格，/ 作分隔符）；Optional Filter（AND ANY / AND ALL / NOT ANY / NOT ALL 组合逻辑）；Probability (Trigger %)："Probability = 100 means that the entry will be inserted on every activation. Probability = 50 … 1:1 chance. Probability = 0 … NOT be inserted"（用于随机事件）。常数条目（Blue Circle）："The entry does not need any keywords, and will trigger regardless of content."

**扫描深度与预算（原文）**：
- Scan Depth："Defines how many messages in the chat history should be scanned for World Info keys. If set to 0, then only recursed entries and Author's Note are evaluated. If set to 1, then SillyTavern only scans the last message. 2 = two last messages, etc."
- Context % / Budget："Defines how many tokens could be used by World Info entries at once. … If the budget is exhausted, then no more entries are activated even if the keys are present in the prompt. Constant entries will be inserted first. Then entries with larger order numbers."
- Min Activations：非零时无视 scan-depth 向后扫日志直到触发足够条目（仍受 Max Depth 与预算限制）。Min Activations 与 Max Recursion Steps 互斥。
- Include Names：是否把参与者名字作为前缀计入扫描缓冲（启用后可仅靠名字触发）。

**递归扫描（原文）**："Recursive scanning allows for entries to activate other entries or be activated by others"——条目内容里提到另一条目的 key 即触发它。示例（原文）：Entry #1 keyword Bessie, content "Bessie is a cow and is friends with Rufus."；Entry #2 keyword Rufus → 消息里只提 Bessie 会把两条都拉进上下文。每条三个开关：Non-recursable（不被其他条目激活）／Prevent further recursion（激活后不再触发其他条目）／Delay until recursion（只在递归轮激活，配合 Recursion Level 分级）。

**三条绑定层级（原文）**：Character Lore（可绑一个 primary World Info 到角色，导出角色卡时内嵌："When exporting the character, this file will also get embedded in the character card data."）、Persona Lorebook（绑到 persona，选该 persona 即激活）、Chat Lorebook（绑到单个聊天，只在该对话生效）。三类之外的全局 WI 选择器随角色/persona/聊天自动激活。

**Insertion Order（原文）**："Numeric value. Defines a priority of the entry if multiple were activated at once. Entries with larger order numbers will be inserted closer to the end of the context as they will have more impact on the output. For example, an entry with Order number 100 will appear in the context before an entry with Order number 250."

**Insertion Position 全部取值（原文）**：Before Char Defs（角色描述/scenario 前，moderate impact）／After Char Defs（其后，greater impact）／Before/After Example Messages／Top of AN / Bottom of AN（附注原文："If your Author's Note is disabled (Insertion Frequency = 0), World Info entries in A/N positions will be ignored!"）／**@ D**："World Info entry is inserted at a specific depth in the chat (Depth 0 being the bottom of the prompt)."／Outlet（不自动注入，存到命名 outlet，用 {{outlet::Name}} 宏手动放置）。

**Outlet 机制（原文）**："Use the {{outlet::YourName}} macro in the Prompt Manager or Advanced Formatting prompt fields. When the prompt is built, the macro is replaced with the combined content of every World Info entry that shares the same outlet name, separated by newlines, sorted by their Insertion Order value." 限制（原文）：outlet 宏不能放进 WI 条目内容（无限循环风险）；不能嵌套；角色卡字段（Description, Personality, Scenario 等）与 Author's Note 编辑器里不能解析 outlet；outlet 名大小写敏感。

**向量匹配（Vector Storage，原文）**："provides an alternative to keyword matching by using the similarity between the recent chat messages and World Info entry contents." 前提：Vector Storage 扩展启用 + "Enable for World Info" 勾选 + 条目为 Vectorized 状态或全局开关。规则要点："The Scan Depth setting from Activation Settings or entry overrides is not used. The Vector Storage Query messages value is utilized instead"；"If you want deterministic and predictable results, stick to keyword matching."（因为 "it's impossible to predict exactly what entries will be inserted"——检索质量取决于 embedding 模型输出）。

**其他机制**：Inclusion Group（同组多条同时触发只插一条，按 Group Weight 随机，或 Prioritize Inclusion 按最高 Order 确定性选择——"useful for creating fallback sequences"）；Automation ID（与 Quick Replies/STscript 联动）；Character Filter（按角色名/标签过滤）；Timed Effects（Sticky 激活后保持 N 条消息、Cooldown N 条消息内不能再激活、Delay 最少消息数；按"消息数"计，分支继承，示例：sticky=3, cooldown=2, delay=2 → 消息7 可再激活）；Match whole words 默认开启、对中日文不友好（原文："this setting can have a detrimental effect when used with languages that don't use whitespace to separate words (e.g. Japanese or Chinese)"）。

【注】本文档的 Pro Tips 还提示：激活关键词与标题不会进上下文（"Activation keywords, titles, and other information that is not in the Content field is not inserted into context, so each World Info entry should have a comprehensive, standalone description"）；条目内容应简洁以省 token（"To conserve prompt tokens, it is advisable to keep entry contents concise"）。

## §3 角色卡规范（字段清单）

### 3a. Character Card V2 规范（社区事实标准）
【来源】https://github.com/malfoyslastname/character-card-spec-v2 （README.md 与 spec_v2.md，main 分支，2026-09-22 经 GitHub API 抓取；2023-05-17 spec 定稿）

**V1（现行事实格式）TS 定义（原文）**：
```
type TavernCardV1 = { name: string; description: string; personality: string; scenario: string; first_mes: string; mes_example: string }
```

**V2 TS 定义（原文）**：spec: 'chara_card_v2'（MUST）；spec_version: '2.0'（MUST）；data 嵌套（原因原文："to prevent V1-only editors from successfully loading a V2 card, but silently destroying its V2-only fields"）：
- 旧字段（移入 data）：name / description / personality / scenario / first_mes / mes_example
- 新字段：**creator_notes**（"A field where creators can include information that will never be included in the prompts"，MUST NOT 进 prompt，SHOULD 对用户高可见度）、**system_prompt**（默认 MUST 覆盖用户全局 system prompt，空串则回退；MUST 支持 {{original}} 占位嵌入"无此字段时前端会用的默认值"）、**post_history_instructions**（默认 MUST 覆盖 ujb/jailbreak；MUST 支持 {{original}}）、**alternate_greetings**（string 数组，前端 MUST 提供首条消息 swipe）、**character_book?**（见下）、tags（SHOULD NOT 用于 prompt 工程）、creator / character_version（MUST NOT 用于 prompt 工程）、**extensions**（MUST 默认 {}，MUST NOT 销毁未知键值对，建议命名空间如 "agnai/voice"）。

**CharacterBook 字段（原文 TS）**：name? / description? / **scan_depth?**（"agnai: Memory: Chat History Depth"）/ **token_budget?**（"agnai: Memory: Context Limit"）/ recursive_scanning?（"whether entry content can trigger other entries"）/ extensions；entries[] 每项：keys / content / extensions / enabled / insertion_order（"if two entries inserted, lower insertion order = inserted higher"）/ case_sensitive? / name? / priority?（"if token budget reached, lower priority value = discarded first"）/ id? / comment? / selective? + secondary_keys? / constant?（"if true, always inserted in the prompt (within budget limit)"）/ position?（'before_char' | 'after_char'）。

**角色书与世界书的叠加规则（原文）**："Character books should stack with world books, not replace them"；且 "the Character Book should be used first, and then if there is any remaining space allocated for the prompt's lorebook section, the World Book should be used second."（spec_v2.md 措辞：Character book SHOULD take full precedence over world book。）

**PNG 内嵌（tEXt chunk）**：V2 文件说明指向 V1 spec（"All V1 fields follow the V1 spec, other than being nested inside the data property"）；PNG 嵌入 JSON 的具体做法见 spec_v1.md（待补 §3b）。

### 3b. V1 嵌入方法与字段 MUST 语义（spec_v1.md）
【来源】https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v1.md （2026-09-22 经 GitHub API 抓取）

- **嵌入方法（原文）**："- .json file with no image. Discouraged for user-friendliness. / - PNG/APNG: JSON string encoded in base64 inside the 'Chara' EXIF metadata field. / - WEBP: Not covered by the spec due to technical ambiguities."
  - ⚠️ 注意：**spec 原文写的是 EXIF 元数据字段，不是 tEXt chunk**。任务书预先写了"tEXt chunk"，二者差异列入 §7 待确认（酒馆实际实现以源码为准，本次未核）。
- 字段 MUST 语义（原文）：所有字段 MUST 默认为空字符串（非 null/缺失）；prompt 中 description/personality/scenario/first_mes/mes_example 内的 {{char}}/<BOT> 与 {{user}}/<USER> MUST 被替换（大小写不敏感）；用户默认名 MUST 存在。
- description/personality/scenario：SHOULD 默认每次 prompt 都包含（原文）。
- first_mes（原文）："The chatbot MUST be the first one to send a message, and that message MUST be the string inside first_mes."
- mes_example（原文）：以 <START> 分隔示例对话；"Example conversations SHOULD, by default, only be included in the prompt until actual conversation fills up the context size, and then be pruned to make room for actual conversation history."

## §4 长期记忆与防漂移

### 4a. 四类记忆机制（触发条件与代价，均有原文出处）

| 机制 | 触发条件 | 代价（原文） | 出处 |
|---|---|---|---|
| 角色卡永久 token（name/description/personality/scenario） | 每次生成必发 | "a 1000-token character definition cuts the AI's 'memory' in half"（2048 上下文时）；"At worst … less room left in the context for other things" | characterdesign 页 |
| World Info / Lorebook 按需注入 | 关键词/正则/向量命中 + budget 未耗尽 | "does not guarantee its appearance in the generated output messages. That depends on how good your model is"；预算耗尽则不再激活 | worldinfo 页 |
| Author's Note 常驻注入 | 按 Insertion Frequency（每 N 条用户输入一次）+ 放置位置（depth/After Scenario） | "The closer … to the bottom of the prompt, the more impact it has"；Frequency=0 时 WI 的 AN 位置条目也被忽略 | authors-note 页 |
| Summarize 摘要压缩 | 每 X 条消息/每 X 词自动或手动触发 | "the outputs may lose some important details or contain hallucinations, so you're always advised to keep track of the summary state and correct it manually"；Raw 模式对 llama.cpp 等慢后端不推荐 | extensions/summarize 页 |
| 向量检索（Vector Storage / Data Bank RAG + Chat Vectorization） | 语义相似度（embedding 模型输出），score threshold 过滤 | "it's impossible to predict exactly what entries will be inserted. If you want deterministic and predictable results, stick to keyword matching"；换 embedding 模型必须重算向量（原文 Warning） | worldinfo 页 + data-bank 页 |

**Summarize 补充原文**：摘要"could be interpreted as a long-term memory, but take that statement with a grain of salt"；当前摘要存入"the chat file's metadata"（删除/编辑带摘要的消息会回滚到上一个有效摘要）；注入模板用 {{summary}} 宏，Injection Position 规则与 Author's Note 相同（main prompt 前后或 in-chat 深度）；Raw 模式提示词 = [摘要提示词] + [上一版摘要] + [新消息]。

### 4b. 防漂移（persona / character drift）：有出处的说法

逐条只记本次检索到的出处：

1. **永久 token 是防"忘角色"的结构性手段**——characterdesign 页（原文）："What are a Character's 'Permanent Tokens'? These will always be sent to the AI with every generation request: Character Name / Character Description Box / Character Personality Box / Scenario Box"；first_mes/example messages 则会被挤出（"only kept until chat history fills up the context"）。社区博客（tavernsprite.com/blog/sillytavern-character-card-fields/，2026-09-11）："Some fields are sent to the model on every single message: Description, Personality, and Scenario. They never scroll out of the conversation. That is powerful (the character never forgets who they are) and expensive (that text permanently occupies part of your context window)."
2. **Character's Note 官方明示用途就是强化角色特质**——characterdesign 页（原文）："A text to be used as an in-chat prompt injection for the character at a specific message depth. It is usually used to reinforce certain character traits, as it always stays at a static depth in the chat history, regardless of its progression."（深度固定 → 不随对话增长被稀释。）
3. **First Message 定风格**（原文）："The model is more likely to pick up the style and length constraints from the first message than anything else"——开场即锚定口吻。
4. **历史之后指令权重更高**——V2 spec README（原文）："It was discovered recently … that system instructions written *after* the conversation history have a much stronger weight on current models' generations than instructions written *before* the conversation history (specifically, the system prompt and the description field)."——这正是 Post-History Instructions / 酒馆 Jailbreak 的原理。
5. **注入不保证生效**——worldinfo 页（原文）："while World Info helps guide the AI toward the desired content, it does not guarantee its appearance in the generated output messages."
6. **字段质量差导致角色崩坏的社区说法**——blog.mini-tavern.com（2026-06-21）："When any of these fields are missing, malformed, or contradictory, the AI can produce nonsense. Elena the Enchantress, for instance, might suddenly start speaking in modern slang if her example dialogues were accidentally swapped with a different card."（字段缺失/畸形/互相矛盾 → 角色输出失控；例子：example dialogues 换错卡 → 角色突然说现代俚语。）
7. **对抗漂移的常用手法 = 常驻强化注记**——authors-note 页的 Common Use Cases（原文）："[Remember the instructions you were given at the beginning of this chat.]"。

【未找到】官方文档本次检索未见以 "drift" 为名的专门章节/诊断条目（已试检索词：character drift / persona drift / forgets personality；检索渠道：官方文档站 + Web 搜索）。对策散落在上述机制中。【推断：漂移的根因在上下文滚动（旧消息出窗）+ 注入不保证生效 + 字段矛盾三处，酒馆用"每轮必发+深度固定+历史后指令"三层对冲。】

**补充社区说法（第二轮检索，均有 URL 与原文）**：
8. **context window 归因**——https://thredly.io/sillytavern-context（原文）："If your SillyTavern character has stopped remembering earlier scenes, started contradicting established events, or your responses have slowed to a crawl in a long roleplay, you've hit the context window. Every long-running SillyTavern chat gets there eventually."
9. **字段质量/模型容量归因**——https://blog.mini-tavern.com/blog/sillytavern-character-card-troubleshooting-fix-common-errors-and-improve-ai-resp-9a4526（2026-06-21，原文）："The AI Ignores the Character's Personality … Symptom: Elena the Enchantress, a wise magical mentor, starts acting like a sarcastic teenager or gives generic advice. … Root Cause: The personality field is too vague, or the model you're using (e.g., a 7B parameter model) doesn't have enough processing [capacity]."（另一篇同站 2026-06-27 补充："the card's description or personality field is too long or poorly structured" 也会导致 AI 像白板。）
10. **结构化记忆扩展（社区实践）**——https://github.com/JasperCatStudios/sillytavern-character-memory（原文）："This extension automatically extracts structured character memories from chat and stores them in the character's Data Bank. Memories are vectorized by SillyTavern's Vector Storage so the most relevant ones are retrieved at generation time — your character remembers things from old conversations."——社区用"抽取→向量化→按需检索"补长程记忆。
11. **lorebook 用途收敛**——https://sillycard.xyz/blog/silly-tavern-lorebook-world-info-guide（原文）："World Info guides the model—it does not guarantee the model will quote your lore verbatim. Quality still depends on the model and your main instructions." + "Treatment: Treat WI as general prompt management, not only character backstory."

## §5 可搬运 / 已过时 / 需自研（三栏，逐条给理由）

> 每条判断标注【原文】（机制由酒馆文档原文证实）或【推断】（机制成立但搬到我们系统的方式是我的判断）。

### A. 值得直接照搬（写进 markdown 教室的加载策略）

| # | 酒馆机制 | 照搬方式 | 依据 |
|---|---|---|---|
| A1 | **永久 token（name/description/personality/scenario 每轮必发）** | 老师人设/课程定位/学生档案作为固定 system 段每轮在场，不放进会滚动的内容里 | 【原文】"These will always be sent to the AI with every generation request"（characterdesign 页） |
| A2 | **历史之后的指令权重更高** | 教学纪律类指令（"先问后答"、"不许直接给答案"）放在 system 指令的尾部、贴近本轮对话处，而非只堆在最前面 | 【原文】"system instructions written *after* the conversation history have a much stronger weight on current models' generations than instructions written *before* the conversation history"（V2 spec README，完整原文见 §4b-4 与 §8-11） |
| A3 | **深度注入 @ Depth（固定深度、不随对话滚动）** | 教室加载策略声明"核心教学提示以固定深度重注入"（DSH 的 system-reminder 机制即此类）；"Depth 0 = 最后一条消息之后"= 贴近生成点 | 【原文】"a Depth of 0 will be sent after the last chat message…"（prompt-manager 页）；"as it always stays at a static depth… regardless of its progression"（Character's Note） |
| A4 | **注入频率（Insertion Frequency）** | 教学要点按"每 N 轮注入一次"控制注意力成本，避免每轮都重复整段 | 【原文】"Frequency 1 = … inserted with every user input prompt. Frequency 4 = … every 4th"（authors-note 页） |
| A5 | **常驻注记强化特质（Character's Note）** | 老师的"角色锚"（苏格拉底式先问后答/鼓励纠错文化）用短注记常驻，不用每次写全 | 【原文】"It is usually used to reinforce certain character traits"（characterdesign 页） |
| A6 | **宏模板每次渲染** | 教室 markdown 定义模板字段（学生名/当前课次/日期/上次进度摘要）每次加载时替换，状态不写死在静态文件 | 【原文】"Macros are dynamic placeholders that get replaced with actual values when text is processed"（macros 页） |
| A7 | **摘要作为可纠错长期记忆** | 状态笔记本 = 可编辑/可回滚的长期记忆；借鉴 "Restore Previous"（回滚到上一个有效摘要） | 【原文】"you're always advised to keep track of the summary state and correct it manually"；"Restore Previous - removes the current summary, rolling it back to the previous state"（summarize 页） |
| A8 | **注入位置分级** | 教材进场景分档：核心事实→前置固定段；教学示例→示例段；即时提醒→贴近对话末尾；各档对应酒馆的 Before Char Defs / Example 区 / @D | 【原文】Insertion Position 全部取值（worldinfo 页）：Before/After Char Defs、Before/After Example Messages、@D、AN 位置 |
| A9 | **First Message 定风格** | 每节课/每个新单元给"开场白样例"定调（口吻、长度、提问风格），让模型跟着开场风格走 | 【原文】"The model is more likely to pick up the style and length constraints from the first message than anything else"（characterdesign 页） |

### B. 因 1M 上下文而变得不必要（或降级为可选）

| # | 机制 | 结论与理由 |
|---|---|---|
| B1 | **关键词触发式 World Info 注入（含递归/预算/Min Activations/Inclusion Group）** | 【推断】整套机制的存在前提是"上下文预算小到放不下全部资料"（WI 预算原文："Defines how many tokens could be used by World Info entries at once"）。1M 下教材全文可常驻，关键词扫描/预算分配/递归链/组互斥都不再必要。注意区分：**"全放进去"≠"全都有效"**，所以配套 B2/B3 与 C 栏的"锚定"设计仍需要。 |
| B2 | **摘要压缩（Summarize）** | 【原文+推断】摘要的设计触发点是"消息即将被挤出 prompt"（原文："you'd want to have the first summary generated when the messages are starting to get dropped out of the prompt"）。1M 下对话历史很少被挤出；但**长对话中后段仍有注意力稀释**，故降级为可选——只对"跨多日课程"保留进度摘要（A7 的做法），不对对话本身做压缩。 |
| B3 | **向量检索（Vector Storage / Data Bank RAG / Chat Vectorization）** | 【原文+推断】检索的价值在"从超出上下文的语料中捞相关片段"；1M 下教材在上下文内，无需检索。且检索有不可预测性（原文："it's impossible to predict exactly what entries will be inserted. If you want deterministic and predictable results, stick to keyword matching"）——教学以知识正确性为底线，**不可接受不可预测注入**。 |
| B4 | **Instruct Mode / Context Template 多模板体系** | 【原文+推断】该体系服务于"对接多种模型族的训练格式"（原文："models trained on various prompt formats, such as Alpaca, ChatML, Llama2"）。DSH 模型栈固定，无需多模板；但"按目标模型的指令遵循习惯组织 system 段"（A2）依然适用。 |
| B5 | **概率触发/随机事件（Probability、Inclusion Group 随机权重、Timed Effects）** | 【原文】这些是角色扮演的随机性/游戏化机制（"Use this to create random events in your chats"）。教学场景不需要随机注入。 |

### C. 它没做好、我们必须自己解决

| # | 缺口（酒馆侧原文依据） | 我们的解法 |
|---|---|---|
| C1 | **教材不会自动进场景**——酒馆靠用户手动导入/绑定世界书；character_book 字段的诞生正是因为这个痛点（README 原文："botmakers are not confident that users are properly getting their recommended world books, and the extra effort required for users to download and import external worldbooks turns them away"） | 我们的教材就是工作区文件，由 DSH 文件工具直接读取，零用户配置；"自动进场景"是系统行为而不是用户行为。 |
| C2 | **注入与摘要都会失真**——WI"does not guarantee its appearance in the generated output messages"；摘要"may lose some important details or contain hallucinations" | 事实层不依赖生成式注入：知识点原文经文件工具逐字读取，答案可回查文件；摘要只用于进度，不用于事实。 |
| C3 | **无进度/课程状态概念**——酒馆的状态散在变量宏、chat metadata、手动 AN 里 | 我们建状态笔记本文件（当前课次/掌握矩阵/待复习），由工具读写，取代宏变量。 |
| C4 | **无输出正确性评估**——酒馆从不判断回复对不对 | 教学场景加"对答案"环节：学生作答后由系统调知识文件比对/讲解。 |
| C5 | **官方对漂移无专章对策**（本次检索未找到 drift 专章） | 自建"知识锚"：核心事实常驻 + 每轮末尾短校验（本课要点是否与教材一致）。 |

### D. 它已有的教学/学习方向实践（问题 C-4 的答案）

- **语言学习**：Enerccio/SillyTavern-LanguageLearningHelper（GitHub）——"roleplay with characters in your target learning languages while dynamically streaming tucked-away, interactive translation and gram[mar] annotations"；Wolfsblvt/SillyTavern-NihongoHelper（GitHub）——日语学习，含 **"Language Assistant Side Chat — Slide-out meta tutor panel"（侧栏元老师面板）**——与我们"元老师"思路同构的先例。
- **AI tutor 用例**：mustafa.net 工具页列出 "Educational language practice through conversations with AI tutors in character"。
- **助手型构建**：z's basic sillytavern guide——"setting up your SillyTavern similarly to a CustomGPT"（assistant-as-companion）。
- 【推断】以上全部集中在"语言练习 + 角色扮演 tutor"，**没有系统性课程教学/知识正确性保证的框架**——这正是我们要自研的部分（C2/C4）。

## §6 与我们系统的逐项对照表

| 维度 | 酒馆 | 我们 | 逐项结论 |
|---|---|---|---|
| 载体 | 角色卡（PNG/JSON，V1/V2 规范）+ 世界书（World Info/Lorebook） | 一个文件夹的 markdown（角色 / 课程表 / 故事线 / 状态笔记本） | 分层思想同构：角色卡 = 我们的"角色文件"（对应 §5-A1 permanent 字段、A5 角色锚）；世界书 = 我们的"课程表/故事线文件"（对应 §5-A8 注入位置分级）；chat 文件 metadata（存摘要） = 我们的"状态笔记本"（对应 §5-A7）。PNG/EXIF 内嵌对我们无意义——那套是为了单文件可移植分发，文件夹天然可移植【推断】。 |
| 宿主 | 自带前端 + 多种 API 后端（Text Completion 走 Advanced Formatting/Instruct Mode；Chat Completion 走 Prompt Manager） | DSH，不改 agent loop，靠系统指令 + 文件工具 | 酒馆的 Prompt Manager/Story String 是"每轮拼装提示词"的前端逻辑；DSH 里的对应物 = 系统指令 + system-reminder + 文件工具。可搬运：宏模板每次渲染（§5-A6）、注入频率（§5-A4）、"历史后指令"（§5-A2）。多模型族模板体系（§5-B4）不需要。 |
| 上下文 | 用户自设 token 预算，通常远小于 1M（文档举例 2048/8192/128k/200k/2M） | 1M 上下文 | §5-B1/B2/B3 三栏：WI 关键词触发注入、Summarize 摘要压缩、向量检索（RAG）均因"教材全文可常驻"而失去必要性；注入的不可预测性反而有害（教学要确定性）。但 1M 用满仍有注意力稀释风险 → 保留"每轮末尾短校验"（§5-C5）与"核心事实常驻 + 细节按需"的层级（§5-A8）。 |
| 目标 | 陪伴/扮演（知识正确性不设底线；官方明示注入与摘要都不保证正确） | 教学（叙事是手段，知识正确性是底线） | 酒馆机制默认"引导而非保证"，教学必须"保证且可回查"：事实层用文件工具读原文而非依赖注入（§5-C2）；新增答案评估/讲解环节（§5-C4）；新增教材自动进场景（§5-C1，酒馆靠用户手动绑世界书、V2 的 character_book 正是为解决用户不导入世界书而设计——其失败模式对我们即"教材必须由系统加载，不依赖任何人配置"）。 |

**一句话总结【推断】**：搬走它的"分层 + 深度 + 频率 + 模板化"四件事（§5-A），丢掉它的"检索 + 压缩 + 随机"三件事（§5-B），自己做它没做的"自动加载 + 事实回查 + 答案评估"三件事（§5-C）。

## §7 待确认清单

> 本子代理禁止询问类工具；以下各项按最佳判断执行，请主代理转呈用户核定。

1. **PNG 内嵌载体**：V1 spec 原文为 "JSON string encoded in base64 inside the 'Chara' EXIF metadata field"（EXIF），而任务书预先写"tEXt chunk"（tEXt 是 PNG 的另一种元数据块）。本次未核 SillyTavern 源码的实际读写实现，两说并存，请确认以哪个为准（不排除酒馆实现就是 tEXt 而 spec 写 EXIF）。
2. **宏系统"每次构建时重新求值"**：官方文档原文只到 "Macros are dynamic placeholders that get replaced with actual values when text is processed"（macros 页）；"每轮渲染"是我对其机制的理解【推断】，未深挖源码验证，如后续要引用请先核 public/scripts/ 下宏引擎实现。
3. **mustafa.net 的"Educational language practice through conversations with AI tutors"**：只抓到搜索结果摘要片段，未读页面全文，链接可用性未验证（https://mustafa.net/tools/ai/sillytavern/）。
4. **persona drift 官方专章**：本次检索（官方文档站站内 + Web 搜索，检索词：character drift / persona drift / forgets personality / forgets established events）未找到官方以 drift 为名的章节；§4 只收录了有出处的机制与社区说法。若主代理掌握其他来源可补充。
5. **Instruct Mode 的 URL 形态**：/usage/prompts/instruct-mode/ 404，实际在 /usage/core-concepts/instructmode/；文档站内链结构存在重复路径，不影响结论。
6. **tEXt 与 EXIF 的差异结论**：若酒馆实现确为 tEXt（PNG tEXt chunk，非 EXIF），则任务书预设成立、spec 原文表述过时——请主代理以源码为准做最终裁定。
7. **Summarize 扩展的"当前摘要存 chat metadata"**：原文为 "The summary is updated and embedded into the chat file's metadata for the message that was the last in context"——"chat file"在酒馆实现中即聊天存档 JSON，本项目无对应物，由"状态笔记本"文件替代【推断】。

## §8 来源与可复跑命令（每条 URL + 你实际抓到的原文片段）

> 抓取方式：docs.sillytavern.app 用 scrape_webpage（HTTP 200，2026-09-22）；GitHub 仓库用 mcp__github__get_file_contents（main 分支）。所有引文均来自下列页面原文，未改写。

1. **World Info** — https://docs.sillytavern.app/usage/core-concepts/worldinfo/
   片段："It functions like a dynamic dictionary that only inserts relevant information from World Info entries when keywords associated with the entries are present in the message text."；"Defines how many messages in the chat history should be scanned for World Info keys. If set to 0, then only recursed entries and Author's Note are evaluated."；"If the budget is exhausted, then no more entries are activated even if the keys are present in the prompt."；"Entries with larger order numbers will be inserted closer to the end of the context as they will have more impact on the output."；"World Info entry is inserted at a specific depth in the chat (Depth 0 being the bottom of the prompt)."
2. **Character Design** — https://docs.sillytavern.app/usage/core-concepts/characterdesign/
   片段："These will always be sent to the AI with every generation request: Character Name / Character Description Box / Character Personality Box / Scenario Box"；"The first message box - only sent once at the start of the chat."；"A text to be used as an in-chat prompt injection for the character at a specific message depth. It is usually used to reinforce certain character traits, as it always stays at a static depth in the chat history, regardless of its progression."；"The model is more likely to pick up the style and length constraints from the first message than anything else"；"a 1000-token character definition cuts the AI's 'memory' in half"（2048 上下文示例）。
3. **Author's Note** — https://docs.sillytavern.app/usage/core-concepts/authors-note/
   片段："Author's Note is a powerful tool for customizing AI responses which inserts a section of text into the prompt at any position and at any frequency you desire."；"Depth 0 = placed at the very end of the chat history. Depth 4 = placed before the most recent 3 chat history messages"；"The closer the Author's Note is to the bottom of the prompt, the more impact it has on the next AI response."；"Frequency 0 = Author's Note will never be inserted. Frequency 1 = … every user input prompt."
4. **Macros** — https://docs.sillytavern.app/usage/core-concepts/macros/
   片段："Macros are dynamic placeholders that get replaced with actual values when text is processed."；"Macro names are case-insensitive."；{{summary}}："Latest chat summary from the 'Summarize' extension (when available)"；变量运算符表（= ++ -- += -= || ?? ||= ??= == != > >= < <=）。
5. **Advanced Formatting** — https://docs.sillytavern.app/usage/core-concepts/advancedformatting/
   片段："The System Prompt defines the general instructions for the model to follow. … The System Prompt is a part of the Story String and usually the first part of the prompt that the model receives."
6. **Prompt Manager** — https://docs.sillytavern.app/usage/prompts/prompt-manager/
   片段："Prompts placed closer to the top of the interface are sent earlier. The bottom of the list is the last thing sent to the model"；"a Depth of 0 will be sent after the last chat message, a Depth of 1 will be sent before the last chat message"；Pinned 清单："Main Prompt, World Info (before/after), Persona Description, Character Description, Character Personality, Scenario, Enhance Definitions, Auxiliary Prompt, Chat Examples, Chat History, and Post-History Instructions."
7. **Context Template** — https://docs.sillytavern.app/usage/prompts/context-template/
   片段："This field is a template for the prompt preamble (known internally as a story string)."；"If any of the above parameters are missing from the story string template, they will not be sent in the prompt at all."；"Prompt Anchors … for example: Author's Note / Summaries / Chat Vectorization / Data Bank / STscript injections / Web Search"。
8. **Instruct Mode** — https://docs.sillytavern.app/usage/core-concepts/instructmode/
   片段："Instruct Mode allows you to adjust the prompting for instruction-following models trained on various prompt formats, such as Alpaca, ChatML, Llama2, etc."；"All prefix sequences will also be automatically used as stopping strings."；User Filler Message 用例："when an instruct format strictly requires prompts to be user-first and have messages with alternating roles only, examples: Llama 2 Chat, Mistral Instruct."
9. **Data Bank (RAG)** — https://docs.sillytavern.app/usage/core-concepts/data-bank/
   片段："Retrieval-augmented generation (RAG) is a technique for providing external sources of knowledge to the LLM."；"Chunk size (chars) - sets the target size of an individual chunk (in textual characters, not model tokens!)"；"Score threshold … Sane values are in a range between 0.2 (more loose) and 0.5 (more focused)"；"Embeddings are only usable when they are retrieved using the same model that generated them."
10. **Summarize** — https://docs.sillytavern.app/extensions/summarize/
    片段："Summarization can help with outlining general details of what is happening in the story, which could be interpreted as a long-term memory, but take that statement with a grain of salt. Since the summaries are generated by language models, the outputs may lose some important details or contain hallucinations"；"Ideally, you'd want to have the first summary generated when the messages are starting to get dropped out of the prompt."
11. **Character Card V2 规范（三文件）** — https://github.com/malfoyslastname/character-card-spec-v2 （README.md / spec_v2.md / spec_v1.md，main 分支）
    片段（spec_v2.md）："The value for this field MUST be 'chara_card_v2'."；"creator_notes … MUST NOT be used inside prompts."；"Frontends' default behavior MUST be to replace what users understand to be the 'system prompt' global setting with the value inside this field."；"Frontends MUST support the {{original}} placeholder"；CharacterBook："scan_depth? / token_budget? / recursive_scanning? … position?: 'before_char' | 'after_char'"。片段（README.md）："system instructions written *after* the conversation history have a much stronger weight on current models' generations than instructions written *before* the conversation history"；"Character books should stack with world books, not replace them"；"the extra effort required for users to download and import external worldbooks turns them away"。片段（spec_v1.md）："PNG/APNG: JSON string encoded in base64 inside the 'Chara' EXIF metadata field."；"Example conversations SHOULD, by default, only be included in the prompt until actual conversation fills up the context size, and then be pruned."
12. **Web 搜索补充命中**：
    - https://thredly.io/sillytavern-context — "you've hit the context window. Every long-running SillyTavern chat gets there eventually."
    - https://blog.mini-tavern.com/blog/sillytavern-character-card-troubleshooting-fix-common-errors-and-improve-ai-resp-9a4526 （2026-06-21）— "The personality field is too vague, or the model you're using (e.g., a 7B parameter model) doesn't have enough processing"；同站 2026-06-27 篇（…-how-to-fix-common-errors-and-improve-ee76b3）— "the card's description or personality field is too long or poorly structured"。
    - https://tavernsprite.com/blog/sillytavern-character-card-fields/ （2026-09-11）— "They never scroll out of the conversation. That is powerful (the character never forgets who they are)"。
    - https://sillycard.xyz/blog/silly-tavern-lorebook-world-info-guide — "World Info guides the model—it does not guarantee the model will quote your lore verbatim."
    - https://github.com/JasperCatStudios/sillytavern-character-memory — "This extension automatically extracts structured character memories from chat and stores them in the character's Data Bank."
    - 教学方向：https://github.com/Enerccio/SillyTavern-LanguageLearningHelper ；https://github.com/Wolfsblvt/SillyTavern-NihongoHelper （"Language Assistant Side Chat — Slide-out meta tutor panel"）；https://mustafa.net/tools/ai/sillytavern/ ；https://sites.google.com/view/z-basic-sillytavern-guide/ 。
13. **可复跑命令**：
    - 官方文档页：`scrape_webpage({url: "https://docs.sillytavern.app/usage/core-concepts/{worldinfo|characterdesign|authors-note|macros|advancedformatting|instructmode|data-bank}/", maxChars: 20000})`；`scrape_webpage({url: "https://docs.sillytavern.app/usage/prompts/{prompt-manager|context-template}/", maxChars: 20000})`；`scrape_webpage({url: "https://docs.sillytavern.app/extensions/summarize/", maxChars: 20000})`
    - GitHub 规范：`mcp__github__get_file_contents(owner: "malfoyslastname", repo: "character-card-spec-v2", path: "README.md|spec_v2.md|spec_v1.md", branch: "main")`
    - 检索：`web_search({queries: ["SillyTavern character drift how to fix", "SillyTavern character forgets personality long chat fix", "SillyTavern educational character tutor learning use case"]})`
    - 抓取失败记录：https://docs.sillytavern.app/usage/core-concepts/author/ （404，正确路径为 authors-note）；https://docs.sillytavern.app/usage/prompts/instruct-mode/ （404，正确路径为 core-concepts/instructmode）。

