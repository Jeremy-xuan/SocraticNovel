# 研究 9 · 检索与取证日志（证据目录）

> 本文件记录**实际执行过的检索与克隆动作**，用于可复现与"未找到项"的举证。
> 所有时间为本机时间（UTC+8 区域，2026-09-24）。

---

## 1. 源码克隆（prior art）

**方法**：`git clone`（本机完全可用，**比网页抓取可靠**——本轮实测：网页抓取对 `aclanthology.org`、`blog.character.ai` 报 `non-public IP address`，clone 全部成功）。

| # | 仓库 | commit | 日期 | 命令 | 状态 |
|---|---|---|---|---|---|
| 1 | `SillyTavern/SillyTavern` | `06bde939fb1e9c4c8d8641d810f0a916b5bce127` | 2026-09-14 | `git clone --depth 1 --filter=blob:none --sparse https://github.com/SillyTavern/SillyTavern.git st && git sparse-checkout set public/scripts src` | ✅ 成功 |
| 2 | `microsoft/autogen` | `027ecf0a379bcc1d09956d46d12d44a3ad9cee14` | 2026-04-06 | `git clone --depth 1 https://github.com/microsoft/autogen.git ag` | ⚠️ **部分失败**（工作区被清空，`git status` 显示大量 `D`）→ **改用 `git restore --source=HEAD -- <路径>` 取回所需文件**，成功 |
| 3 | `joonspk-research/generative_agents` | `fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4` | 2023-08-11 | `git clone --depth 1 https://github.com/joonspk-research/generative_agents.git ga` | ✅ 成功 |
| 4 | `renpy/renpy` | `412ab4470b0a17e39de3b56cbed759539935e461` | 2026-09-19 | `git clone --depth 1 --filter=blob:none --sparse https://github.com/renpy/renpy.git renpy && git sparse-checkout set renpy` | ⚠️ sparse 未生效（工作区仅顶层）→ **改用 `git show HEAD:renpy/character.py` 读 blob**，成功 |
| 5 | `monogatari/monogatari` | `86659baf065178071f0956092f754e1d76be0072` | 2026-06-17 | `git clone --depth 1 --filter=blob:none --sparse https://github.com/monogatari/monogatari.git mono && git sparse-checkout set src` | ⚠️ sparse 未生效 → **改用 `git restore --source=HEAD -- src/...` ＋ `git ls-tree`／`git grep`**，成功 |
| 6 | `UKPLab/llm-roleplay` | （`--depth 1`，未记 commit） | —— | `git clone --depth 1 https://github.com/UKPLab/llm-roleplay.git uklp` | ✅ 成功（**结论：与我们的场景不同构，未单独立章**） |

🔴 **一条可复用的教训（写下来给后来者）**：
> **`--sparse` 在本机对部分仓库不生效**（实例：`renpy`、`monogatari` 的工作区只落了顶层文件）。
> **绕过办法（本轮全部实测可用）**：
> - `git ls-tree -r --name-only HEAD | grep <关键词>` —— 不落盘就能看清单；
> - `git show HEAD:<path>` —— 不落盘就能读文件；
> - `git restore --source=HEAD -- <path>` —— 只取需要的文件；
> - `git grep -n <pattern> HEAD -- '*.css'` —— 在**仓库对象**里搜，不依赖工作区。

---

## 2. 网页抓取（附失败记录）

| # | 目标 | 通道 | 结果 |
|---|---|---|---|
| 1 | `https://blog.character.ai/new-feature-announcement-character-group-chat/` | `web_fetch` | ❌ `URL hostname resolves to a non-public IP address` |
| 1′ | 同上 | `read_page` | ✅ **成功**（本地通道，200 OK，全文） |
| 2 | `https://arcanumrpgs.com/blog/character-ai-group-chat/` | `read_page` | ✅ **成功**（200 OK，全文） |
| 3 | `https://aclanthology.org/2025.findings-emnlp.888/` | `web_fetch` | ❌ `non-public IP address`（**未重试其他通道** —— 该论文与本任务的相关性在读完摘要片段后判定为"参考性"，未继续） |

⚠️ **`read_page` 的告警（逐字摘）**：`Fell back to local after: firecrawl: firecrawl rejected the keyless request (403). ... your IP address looks suspicious` → **即 firecrawl 无 key 时被拒，实际由本地通道完成**。

---

## 3. 检索（web_search）

**已执行的检索式**（对应产出 §3.5）：

1. `multi-character LLM roleplay turn taking open source`
2. `LLM group chat orchestration framework speaker selection`
3. `NPC interjection tutoring agent classroom`
4. `multi-agent tutoring system LLM Socratic`
5. `Character.AI Rooms multiple characters group chat how it works`
6. `Character.AI Rooms speaker name label UI multiple bots`

**命中与处置**：

| 命中 | URL | 处置 |
|---|---|---|
| **KELE: A Multi-Agent Framework for Structured Socratic Teaching with Large Language Models**（Findings of EMNLP 2025） | `https://aclanthology.org/2025.findings-emnlp.888/` | ⚠️ **仅读到检索摘要**（逐字：*"KELE constructs a structured Socratic teaching rule system (SocRule) and a 'consultant–teacher' multi-agent collaborative teaching mechanism, in which two LLMs respectively take charge of teaching…"*）。**抓取被 `non-public IP` 拒绝，未读全文**。🔴 **与本任务高度相关（"consultant–teacher" 双角色教学）→ 列入 §14 待确认，建议后续单独取证。** |
| **SocraticAI: Transforming LLMs into Guided CS Tutors Through Scaffolded Interaction**（arXiv 2512.03501） | `https://arxiv.org/abs/2512.03501` | ⚠️ **仅读到检索摘要**（逐字：*"a scaffolded AI tutoring system that integrates large language models (LLMs) into undergraduate Computer Science education through structured constraints rather than prohibition"*）。**未读全文**。**列入 §14 待确认。** |
| `UKPLab/llm-roleplay` | `https://github.com/UKPLab/llm-roleplay` | ✅ **clone 并读源码** → 判定为"两人 inquirer/responder 交替，`num_turns: 12`"，**与我们的场景不同构，未单独立章**（依据：其 `dialogue_generator.py:79–81` 是 `while turn < self.task_cfg.num_turns` 的二人交替） |
| `ArkAscendedAI/tracyhill-rp` | `https://github.com/ArkAscendedAI/tracyhill-rp` | ❌ **未读**（多用户协作写作客户端，与"AI 角色同台"不同构） |
| `microsoft/agent-framework`（`GroupChatBuilder` / `group_chat_simple_selector.py`） | `https://learn.microsoft.com/en-us/python/api/agent-framework-core/agent_framework.groupchatbuilder`；`https://github.com/microsoft/agent-framework/blob/main/python/samples/03-workflows/orchestrations/group_chat_simple_selector.py` | ⚠️ **仅见检索摘要**（逐字：*"High-level builder for manager-directed group chat workflows with dynamic orchestration"*、*"Demonstrates the selection_func parameter for GroupChat orchestration — Uses a pure Python function to control speaker…"*）。🔴 **这是 AutoGen 的继任者（agent-framework）→ 与 §2 同源，但本轮未取证。列入 §14 待确认。** |
| Character.AI 官方博文 | 见上 | ✅ 已读全文 |
| Character.AI 第三方分析 | 见上 | ✅ 已读全文（标注为第三方观察） |

---

## 4. 本机源码取证（DSH 安装版）

**运行时真源**：`/Users/wujunjie/Documents/ChatGPT/大学申请/tmp/dsh-installed/`（`0.1.5-rc.2`）

**读过的文件与行号区间**（产出 §5 引用）：

| 文件 | 行号 | 内容 |
|---|---|---|
| `dsh-api-session-controller/lib/typert.host.js` | `:1335`、`:1591` | `AgentMessageSource` / `MessageSourceMap` 官方类型声明 |
| `dsh-cordis-host-runner/lib/typert.host.js` | `:1091` | 同上（第二处） |
| `dsh-agent-presets/lib/typert.host.js` | `:613` | 同上（第三处） |
| `dsh-session-format-v0-to-v1/lib/index.js` | `:760–921` | `messageSourceValue`（**source.kind 的 schema 校验，含 `default` 开放分支**） |
| `dsh-session-format-v0-to-v1/lib/index.js` | `:917–940` | `pluginSourceValue`（`form` 的 6 个合法值） |
| `dsh-session-format-v0-to-v1/lib/index.js` | `:275–1073` | 全部事件类型 `case` 清单 |
| `dsh-agent-presets/package.json` | 全文 | 包描述（`Per-session agent composition from preset cordis.yml files`） |
| `dsh-agent-presets/presets/{minimal,standard}/preset.yml`、`minimal/agent.cordis.yml` | 全文 | preset 结构 |
| `dsh-agent-presets/lib/index.js` | `:440–500`、`:1065–1077`、`:1440–1470` | `notWritable`（`agent-preset/read-only`）、`agentPreset` 投影、`resolveMountable` |
| `dsh-subagent/lib/index.js` | `:435–545` | `parentAgentOptionsForDelegation`、`resolveChildAgentOptions`、`childSessionMeta` |
| `dsh-subagent/lib/index.js` | `:521–553` | **`applyChildComposition`（子代理 persona 覆盖，用固定 section 名）** |
| `dsh-subagent/lib/index.js` | `:595–605` | `agentMessageSource`（`kind: "agent-message", form: "relay"`） |
| `dsh-subagent/lib/index.js` | `:1631–1734` | `startContinuable` |
| `dsh-system-prompt/lib/index.js` | `:11–45` | `SECTION_ORDERS` / `CONTEXT_ORDERS` 常量表 |
| `dsh-system-prompt/lib/index.js` | `:200–270` | `section()` / `getSectionOrder()` / `context()` 与 shadow 语义 |

**项目文件**（产出 §7–§10 引用）：
- `开源线/DSH定制/code/plugins/socratic-engine/index.mjs`（`:1–120`、`:211–249`）
- `开源线/DSH定制/code/plugins/socratic-engine/lib/manifest.mjs`（`:53`、`:55`、`:126–129`、`:540–590`、`:719–722`）
- `开源线/DSH定制/code/classrooms/cs-os/classroom.yaml`（全文）
- `开源线/DSH定制/code/classrooms/cs-os/characters/komari.md`（全文）
- `开源线/DSH定制/code/classrooms/cs-os/_anchor.md`（全文）
- `开源线/DSH定制/code/classrooms/cs-os/system_core.md`（`:1–30`）
- `开源线/DSH定制/code/classrooms/cs-os/world/setting.md`（`:1–50`）
- `开源线/DSH定制/code/classrooms/cs-os/knowledge_points.md`（`:1–80`）
- `开源线/DSH定制/code/classrooms/cs-os/runtime/{mistake_log,progress,learner_profile}.md`（全文）
- `开源线/DSH定制/code/classrooms/cs-os/curriculum.md`（`:1–35`）
- `开源线/DSH定制/code/classrooms/cs-os/materials/ch01.md`（`:1–40`）
- `开源线/DSH定制/取证_S3_headless多turn与注入去重_2026-09-23.md`（全文）
- `开源线/DSH定制/取证_P3_客户端槽位与派发语义_2026-09-24.md`（`:600–800`，客户端归属部分）
- `开源线/DSH定制/研究_8_Live2D驱动与集成_2026-09-24.md`（`:1120–1180`，相位→立绘）

---

## 5. 本轮未做（诚实声明）

| 未做 | 原因 |
|---|---|
| **起任何真实会话** | 🔴 **红线禁止**（任务书纪律） |
| **跑任何 prior art 的代码** | 全部为**静态源码阅读**；`autogen`／`generative_agents` 需 API key 与环境 |
| **读 KELE 论文全文** | 抓取被 `non-public IP` 拒绝（**未重试其他通道**） |
| **读 AI Dungeon** | 任务书提及，但**与我们的场景差异更大**（单人冒险 + AI 主持人）→ **本轮未覆盖，标【未覆盖】** |
| **实测子代理延迟** | 需起真实会话（红线禁止） |
| **UI 原型／截图** | 本轮是研究，不是实现 |
