# 酒馆角色卡生态 · 能不能不自建（2026-09-22）

> 调研子代理产出。核心问题：社区现成的 SillyTavern（酒馆）角色卡能不能直接拿来当我们教室的角色？
> 硬纪律：每条判断标【原文】/【推断】；查不到写"未查"；不编造 ★ 数/license/字段名。
> 写盘进度：**状态：已完成**（§1–§8 全部落盘；§1/§2 为初版成果，§3–§8 为增量补齐，2026-09-22）

## 摘要（≤8 条）

1. 【原文】角色卡已成为有正式规范的生态：V2 规范仓库 `malfoyslastname/character-card-spec-v2`（192★、**无 license**）定义了 `spec: 'chara_card_v2'` + `data{}` 的 JSON 结构，含 `character_book`（世界书）、`extensions`、`system_prompt`、`post_history_instructions`、`alternate_greetings`、`tags`、`creator`、`character_version` 等字段。
2. 【原文】卡片的三种主流载体：**PNG 内嵌 JSON（tEXt chunk `chara`）、纯 JSON 文件、YAML**（text-generation-webui 用 YAML）。PNG 与 JSON 两种都能被脚本解析（Go/Python/JS 均有现成读取器）。
3. 【原文】GitHub 上确实存在"成百上千张打包"的角色卡仓库：`leigegehaha/sillytavernassets`（144★、**无 license**）git 树实测 **3283 个 PNG + 548 个 JSON ≈ 3831 张卡**，按题材分目录（正常向/校园/单人/同人/系统/世界卡/英文卡…，也有大量成人向）。
4. 【原文】社区最大的卡片分享站是 **Chub.ai**（chub.ai/characters，前身 characterhub.org）；社区另有 JanitorAI、AI Character Cards、Character Tavern 等站；中文站如 sillytavern.one 自述"33000+ 张"（**自述未核实**）。chub 的公开 API 在本机返回 "This service is not available in your country"——**地理封锁，无法批量拉取**。
5. 【原文】V2 规范仓库与绝大多数大型卡片合集**都没有 license**（无 license ≠ 可自由使用；默认保留所有权利）。具名 license 的多为"工具/转换器"仓库（MIT/AGPL-3.0/GPL-3.0），不是卡片内容本身。
6. 【原文】有现成"搬用"级转换工具：`leigegehaha/tavern-card-distiller`（157★、**无 license**）把酒馆卡蒸馏成 **Claude Code 沉浸式 RP skill**（仓库自带已蒸馏的 rp-* 目录与 `scripts/`），与我们的技术栈（Claude/DSH agent 运行时）同构。
7. 【原文】chub.ai 上以 "socratic"/"tutor" 检索的教师卡**未能通过 API 核实**（地理封锁）；GitHub 仓储检索 "socratic sillytavern"、"teacher character card" 均**无实质命中**——教学定位卡不是该生态的存量主流（该生态主流是恋爱/成人/ACG 同人）。
8. 【推断】结论倾向：**"直接用"档基本不存在**——社区卡多为核心定位为陪伴/恋爱/18+ 的 ACG 角色，缺教材、课程表、隐喻映射、教学法四样我们必需的东西；**"改造后用/只能参考"是现实档**；教师人格"皮"（语气、提问方式）可借鉴，教学骨架必须自建。

---

## §1 资源清单（表格：名称 / URL / ★ / license / 卡片数 / 语言 / 格式 / 更新）

### A. GitHub 角色卡合集仓库（重点——整包下载）

| 名称 | URL | ★ | license | 卡片数 | 语言 | 格式 | 更新 |
|---|---|---|---|---|---|---|---|
| siltytavernassets（SillyTavern 角色卡+预设合集） | https://github.com/leigegehaha/sillytavernassets | 144 | **无 license** | **3283 PNG + 548 JSON**（git 树实测） | 中文为主 | PNG/JSON | 2026-09-22 |
| tavern-card-distiller（酒馆卡→Claude Code skill 蒸馏器，含已蒸馏卡片集） | https://github.com/leigegehaha/tavern-card-distiller | 157 | **无 license** | 已蒸馏 rp-* skill 目录 11 个 + scripts | 中文为主 | 目录/skill | 2026-09-21 |
| sillytavern-fast（"一键食用，超多角色卡"容器） | https://github.com/Writer-z/sillytavern-fast | 7 | **无 license** | 未查 | 中文 | PNG/JSON | 未查 |

### B. 规范与工具类仓库（license 明确的多数在此）

| 名称 | URL | ★ | license | 说明 | 格式/语言 | 更新 |
|---|---|---|---|---|---|---|
| character-card-spec-v2（V2 规范） | https://github.com/malfoyslastname/character-card-spec-v2 | 192 | **无 license** | V1/V2 规范原文（spec_v1.md/spec_v2.md） | Markdown | 2026-09-19 |
| SillyTavern（主程序，含卡管理能力） | https://github.com/SillyTavern/SillyTavern | 33659 | AGPL-3.0 | 前端本体；AGPL 覆盖主程序，**不含用户卡片内容** | — | 2026-09-22 |
| TavernAI（V1 格式发源地） | https://github.com/TavernAI/TavernAI | 81 | **无 license** | V1 卡格式起源 | — | 2026-09-21 |
| SillyInnkeeper（本地卡管理器：扫 PNG、抽元数据） | https://github.com/dmitryplyaskin/SillyInnkeeper | 63 | AGPL-3.0 | 批量整理大卡库 | — | 未查 |
| go-png-chunks-chara（Go：读改写 PNG 内嵌卡数据 V1/V2） | https://github.com/chrisbward/go-png-chunks-chara | 5 | **无 license（SPDX 未声明）** | 批量解析 PNG 卡 | Go | 未查 |
| convertCharacterCard.py（Python：V2 卡→dict） | https://github.com/Hihousou/convertCharacterCard.py | 1 | Unlicense | 极简转换函数 | Python | 未查 |
| tavern_card_tools | https://github.com/Barafu/tavern_card_tools | 19 | MIT | SillyTavern 卡工具集 | — | 未查 |
| aimaker（前端工具：创建/锻造/抽取 V2 卡） | https://github.com/altkriz/aimaker | 8 | **无 license** | 免后端 | Web | 未查 |
| SillyTavern-CharacterTools（卡分析/改进插件） | https://github.com/Inktomi93/SillyTavern-CharacterTools | 25 | AGPL-3.0 | 卡质量分析 | 插件 | 未查 |
| character-card-editor（V2/V3 独立编辑器） | https://github.com/zer0thgear/character-card-editor | 27 | **无 license** | 编辑 | 未查 | 未查 |
| CharacterVault（V2/V3 编辑器） | https://github.com/spaceman2408/CharacterVault | 12 | GPL-3.0 | 编辑 | 未查 | 未查 |
| chararchive（chub ~500k 卡 dump 本地浏览器） | https://github.com/ungabunga55/chararchive | 1 | **无 license** | 自述基于 chub dump | — | 未查 |

### C. 分享站（非 GitHub；卡本体在此）

| 名称 | URL | license | 卡量 | 语言 | 格式 | 备注 |
|---|---|---|---|---|---|---|
| Chub AI（前 characterhub.org） | https://chub.ai/characters | 每卡各自条款（站 ToS 未查） | 自述生态最大（chararchive 自称 ~500k）【推断】 | 多语 | V2 PNG 下载 | API 地理封锁，无法程序化拉取【原文】 |
| JanitorAI | https://janitorai.com | 未查 | 大 | 多语 | 站内导出 | 自述"站内试聊后导出"【原文-二手】 |
| AI Character Cards | https://aicharactercards.com | 未查 | 较小 | 英 | PNG | 上传门槛高【原文-二手】 |
| Character Tavern | https://character-tavern.com | 未查 | 未查 | 英 | PNG | 【原文-二手】 |
| SillyTavern Pro（中文站，自称 33000+ 张） | https://sillytavern.one/sillytavern-character-cards-zh | **无（站未披露）** | 自述 33000+【自述未核实】 | 中文 | PNG/在线导入 | 聚合 Chub/Pygmalion 等【自述】 |

> 🔴 重要：**卡片站着陆的信息多为二手/自述**，卡片数、license 均需逐个点开核实；本表"未查"项指本代理本次未能核实。

## §2 卡片格式与可程序化读取性

### 2.1 V2 字段清单（来自 spec_v2.md 原文，字段名照抄）

```ts
type TavernCardV2 = {
  spec: 'chara_card_v2'
  spec_version: '2.0'
  data: {
    name: string
    description: string
    personality: string
    scenario: string
    first_mes: string
    mes_example: string
    creator_notes: string
    system_prompt: string
    post_history_instructions: string
    alternate_greetings: Array<string>
    character_book?: CharacterBook
    tags: Array<string>
    creator: string
    character_version: string
    extensions: Record<string, any>   // 必填，默认 {}，禁止销毁未知字段
  }
}
```

`character_book`（世界书/lorebook）关键字段（原文照抄）：`name / description / scan_depth / token_budget / recursive_scanning / extensions / entries[]`；entry 内：`keys / content / extensions / enabled / insertion_order / case_sensitive / name / priority / id / comment / selective / secondary_keys / constant / position('before_char'|'after_char')`。

> 判定：**V2 是纯 JSON 结构，字段名稳定**——完全可被脚本解析为 dict → 转 markdown。这是"搬用"的技术可行性基石。【原文-字段】【推断-可行性】

### 2.2 卡片载体形态与可解析性

| 形态 | 结构 | 脚本可解析？ |
|---|---|---|
| **PNG 内嵌** | 图片 IDAT 之外附带 tEXt chunk，key=`chara`，值为 base64 的 V1/V2 JSON【原文-规范】 | ✅ Go 库 go-png-chunks-chara；Python 手工读 tEXt；SillyInnkeeper 扫 PNG 抽 metadata |
| **纯 JSON** | `*.json` 文件，内容即 V2 JSON | ✅ 直接 json.load / 正则抽取值 |
| **YAML**（text-generation-webui 系） | `*.yaml`，`name/context/example_dialogue/greeting` 等 | ✅ yaml.load；但字段名与 V2 不同，需映射【推断】 |
| 其他（角色卡导出包 .card / 站内格式） | 各站自定 | ⚠️ 需逐站确认 |

### 2.3 现成批量导出/转换工具（给"搬用"用）

1. **tavern-card-distiller**（157★）：酒馆卡 → **Claude Code 沉浸式 RP skill**（仓库自带 `scripts/` 与已蒸馏示例）。与我们的"markdown 文件夹 + agent 扮演"技术栈**同构**——最接近的现成转换管线。【原文-功能】【推断-同构】⚠️ 其示例卡多为 18+/恋爱向。
2. **SillyInnkeeper**（63★，AGPL-3.0）：本地卡库管理器，批量扫描 PNG 抽 metadata（AGPL 传染限于改它的代码，用它管理自有卡库不传染【推断】）。
3. **go-png-chunks-chara**（Go，5★）：读/写 PNG 内嵌 chara 数据，V1/V2——批量解包搬运的底层库。
4. **convertCharacterCard.py**（Python，Unlicense）：V2 卡 → dict 极简函数，可作解析样例。
5. **chararchive**：面向 chub 大 dump 的本地浏览/镜像脚本（chub API 被地理封锁时，自建 dump 的可行性待确认【推断】）。

> 工具链小结【推断】：**纯技术上看，PNG/JSON 卡 → markdown 角色设定完全可自动化**，V2 字段到 markdown 的映射是确定性的。卡点在许可与内容，不在解析。

---

## §3 🔴 许可与法务裁决（逐份）

### 3.0 三条法务基准（先立规矩，再逐份判）

**基准一：无 license ≠ 可自由使用。**【原文】GitHub 官方（choosealicense.com / GitHub Docs licensing 页）原话："Generally speaking, the absence of a license means that default copyright laws apply. This means that you retain all rights to your source code and that nobody else may reproduce, distribute, or create derivative works from your work."（引自 [choosealicense.com 的 no-license.md 镜像](https://github.com/j-sp/choosealicense.com/blob/9e6528c68f8886da6b977d0ad28107113a7666db/no-license.md)，交叉验证：[law.stackexchange 同题](https://law.stackexchange.com/questions/1006/if-no-open-source-license-is-given-on-a-github-account-what-rules-apply)）→ **无 license 的仓库默认"保留所有权利"：看可以、抄写法可以（思想/格式不受版权保护），逐字复制或再分发其内容不可以**。【推断-应用】

**基准二：卡片是"文本作品"，作者版权 + 角色 IP 双层结构。**【推断】一张 ACG 同人卡至少含两层权利：
- **卡作者层**：description / system_prompt / first_mes 等文字表述是卡作者的创作 → 归卡作者（无 license 即全保留）；
- **原作 IP 层**：卡里用的角色名、形象、设定来自原作（米哈游／型月／任天堂等）→ 归原作方（著作权 + 商标），**卡作者自己也无权授权别人商用**；
- 结论：**即使卡作者同意，只要角色是他人 IP，就绕不开原作方**；反之亦然。

**基准三：我们的既定立场能解决什么、不能解决什么。**【推断-应用】既定立场 = 代码 MIT ＋ 内容 CC BY-NC-SA ＋ 角色用 IP 定位二创 ＋ 提供替换角色机制：
- NC 条款能解决："我们不拿 IP 角色做商业售卖"（解决**我们的商业模式**与 IP 方的冲突）；
- NC **不能**解决："我们把别人写的卡文本搬进我们的仓库再分发"（那是**卡作者**的授权问题，NC 管不到第三方作品）；
- 替换角色机制能解决：用户不需要触碰任何 IP 角色，可全部用原创等价角色上课（把 IP 依赖降为零）；
- ⚠️ 因此：**"我们是非商业二创"只豁免我们与 IP 方的关系，不豁免我们与"卡作者"的关系**——搬卡文本仍须卡作者授权。

### 3.2 逐份裁决（对应 §1 各表）

裁决档位：**✅ 可直接使用 ／ 🔧 可改造使用 ／ 📖 只能参考不能搬**

| 资源 | license（实测） | 裁决 | 依据 |
|---|---|---|---|
| leigegehaha/sillytavernassets（3283 PNG+548 JSON 中文卡库） | **无 license** | 📖 只能参考不能搬 | 无 license=保留所有权利【原文-基准一】；且绝大多数为 ACG 同人/成人向，卡作者与 IP 方均无授权链【推断】 |
| leigegehaha/tavern-card-distiller（蒸馏器+已蒸馏 rp-* 卡集） | README badge 自述 MIT，但**仓库根无 LICENSE 文件**，gh api 报 NO_LICENSE【原文】 | 🔧 工具可改造使用（低风险）；📖 其中 rp-* 卡内容只能参考 | 工具代码有 MIT 自述可作授权主张（无 LICENSE 文件是瑕疵，向作者确认更稳【待确认】）；rp-* 目录里的卡是他人卡蒸馏而来，**无 license 授权链** → 不能搬其文本 |
| Writer-z/sillytavern-fast | 无 license | 📖 | 无 license；且内容来源未披露 |
| character-card-spec-v2（V2 规范） | **无 license** | ✅ 可直接使用（字段结构） | 我们复用的是**字段名/结构（事实与格式，不受版权保护）**，不是规范原文文本【推断】；这是全生态的事实标准 |
| SillyTavern（主程序） | AGPL-3.0 | ✅ 程序可直接使用；不涉及搬卡 | AGPL 只约束对**程序本身**的修改分发；用户卡内容不在其中【推断】 |
| TavernAI | 无 license | 📖 参考其 V1 格式 | 同基准一；格式可学、文本不搬 |
| SillyInnkeeper（卡库管理器） | AGPL-3.0 | 🔧 工具可用；改代码须 AGPL | 拿它管理**自有**卡库无传染问题【推断】 |
| go-png-chunks-chara | SPDX NOASSERTION（有 license 文件但非标准 SPDX） | 🔧 需人工看其 LICENSE 文件再定【待确认】 | NOASSERTION=有声明但未被 SPDX 识别【推断】 |
| convertCharacterCard.py | Unlicense | ✅ 可直接使用 | 公有领域声明 |
| tavern_card_tools | MIT | ✅ 可直接使用/改造 | MIT 明示 |
| aimaker | 无 license | 📖 | 无 license |
| SillyTavern-CharacterTools | AGPL-3.0 | 🔧 同 SillyInnkeeper | AGPL |
| character-card-editor | 无 license | 📖 | 无 license |
| CharacterVault | GPL-3.0 | 🔧 工具可用；改代码须 GPL | GPL |
| chararchive（chub dump 浏览器） | 无 license | 📖 | 无 license；且依赖 chub 数据（见下） |
| Chub.ai 站 | 站 ToS 未查【待确认】 | 📖 浏览/学写法；**批量下载与再分发逐卡看作者条款** | 站内每卡由各自作者发布；API 地理封锁实测【原文】 |
| JanitorAI / AI Character Cards / Character Tavern | 未查 | 📖 默认 | 未核实前一律按"不能搬"处理【推断-保守】 |
| SillyTavern Pro（sillytavern.one，自称 33000+ 张） | 未披露 | 📖 默认；且自述"聚合"他站 → 授权链最可疑【推断】 | 自称聚合 Chub/Pygmalion，二手再分发，**源头授权无法成立** |

### 3.3 ACG 同人角色在本立场下的使用边界（汇总）

| 场景 | 我们做 | 合法？ | 依据 |
|---|---|---|---|
| 角色人格"写法"（语气/提问风格/prompt 组织） | 参考 → 自己写 | ✅ | 思想/写法不受版权保护【推断】 |
| 拿一张现成同人卡的 description 原文进仓库 | 搬文本 | ❌ | 无 license + 卡作者未授权【原文-基准一】 |
| 自建"原创角色，职业是老师"，但世界背景借用某 IP 世界观 | 自写 + 借设定 | ⚠️ 灰色 | 世界观元素若构成"实质性相似"仍有风险；替换角色机制下我们可不做【推断】 |
| 自建完全原创教师角色 + 原创世界观 | 自写 | ✅ | 无第三方权利 |
| 用户侧自行导入任意社区卡（不进我们仓库） | 由用户自担 | ⚠️ | 我们只做格式兼容（V2 规范），不承担用户导入内容的再分发责任【推断】 |

> **一句话裁决【推断】**：生态里**能"直接搬进仓库"的卡 ≈ 零**（无 license 是绝对多数，IP 双层授权链几乎不存在）；**能"参考写法"的是全部**；**能"改造后用"的只有极少数明确开放授权（CC/自述 MIT 且无 IP 的原创卡）**。我们仓库的角色必须**自己写**，但可以（也应该）把社区卡当"写法范本"研究。

## §4 教学类角色卡现状

| 检索通道 | 做了什么 | 结果 |
|---|---|---|
| GitHub 仓储检索 | `socratic sillytavern`、`sillthetavern teacher character card tutor`、`AI tutor character card`、`角色卡 老师` | 均**无实质命中**（0 条或仅 0★ 无关仓库）【原文】 |
| Chub.ai API | `query=socratic tutor` / `query=teacher` | **"This service is not available in your country"（地理封锁），无法核实**卡量【原文】 |
| characterhub.org API | 同款查询 | TLS 连接失败（SSL_ERROR_SYSCALL）【原文】 |
| 中文大卡库抽查 | leigegehaha/sillytavernassets 的「校园」目录 42 项全列 | 42 项中**无一张是"教学/苏格拉底导师"定位**——全部为恋爱/成人向（只列了目录名做元数据判断，未复述内容）【原文-目录名】【推断-定位】 |
| 相关替代物 | `awaa-col/Character_Card`（15★，"个人在 Claude 学习写卡的笔记"） | 存在，但与"教学卡"无关，是**写卡方法论笔记**，可作参考【原文】 |

**结论【原文-未找到】**：在本代理能力范围内（GitHub 全量仓储检索 + 两个卡片站 API + 中文大卡库抽查），**未找到任何"老师/助教/苏格拉底式导师"定位的现成酒馆角色卡，更不存在"教师+教材+课程"一体的卡**。教学定位不是该生态的存量主流（主流=陪伴/恋爱/18+/ACG 同人）。chub 上是否存在此类卡**因地理封锁无法核实，如实标注"未核实"**，不编数字。

---

## §5 🔴 结论：四档裁决 + 候选 + "直接搬用缺什么"

### 5.1 四档裁决表

| 档 | 判定 | 对应工作量 |
|---|---|---|
| **直接用**（拿来就能上课） | **不存在**。社区卡无一"教师+教材+课程"一体；连"老师定位"的卡都未找到（§4）。无 license 也使任何逐字搬用不合法（§3） | 工作量 N/A——没有可用的对象；即使有也需先解决授权 |
| **改造后用**（换世界/换教材/加教学法） | **理论可行但性价比低**。技术上：PNG/JSON 卡 → markdown 全自动化（§2.3）；但"可改造"的底卡必须同时满足①卡作者开放授权（CC/MIT 自述等）②不含未授权 IP——两者同时满足的存量极少 | 0.5–1 天搭解析管线（extract_card.py 类工具）；每张卡重写 description/system_prompt 为教师人格 = **改造量 ≈ 重写量**（1–2 天/卡）→ 不如直接自建【推断】 |
| **只能参考**（借写法，角色自己写） | **✅ 现实档，价值最大**。借 V2 字段结构、世界书组织方式、高口碑卡的"人格写法"（语气/提问/破限），全部自己写原创教师角色 | 0.5–1 天：挑 3–5 张高口碑卡（从 chub/卡库）做写法拆解，提炼模式 → 写入我们的角色模板；零授权风险【推断】 |
| **必须自建**（社区没有能用的） | **✅ 最终判定：我们的角色必须自建**——教师人格、教材、课程表、隐喻映射、教学法五样全是社区卡不提供的（见 5.3） | 2–4 天核心工作：教师角色卡（V2 JSON/markdown）+ 教材文件 + 课程表 + 隐喻映射表 + 苏格拉底教学法指令；但**复用**：V2 规范字段（✅）、解析/生成脚本（✅）、世界书结构（✅）、写法范本（📖） |

> **总判定【推断】**：回答用户"能不能不自建"——**不能完全不自建**。技术生态成熟（格式、工具、规范全都有），**内容生态对我们空手**（无老师卡、无授权链）。最优路径 = **"自建内容 + 复用生态的格式与工具 + 参考写法"**。

### 5.2 2–3 个具体候选（要搬/要参考就选这些）

1. **V2 规范 + 保底模板** — `malfoyslastname/character-card-spec-v2`（192★，无 license）
   选它：字段结构是全生态事实标准；我们要的是**格式**不是文本（✅ 可直接使用，见 §3.2）。产出：我们的卡直接按此 schema 写，天然被酒馆生态兼容。
2. **蒸馏/生成管线** — `leigegehaha/tavern-card-distiller` 的 `scripts/extract_card.py`（157★，badge 自述 MIT / 无 LICENSE 文件【待确认】）
   选它：实现"PNG/JSON 卡 ↔ 结构化 markdown"双向转换，与"markdown 文件夹给模型扮演"的技术栈同构；解析逻辑可当参考实现。**用法**：参考其管线写我们自己的转换脚本（避免直接拷贝代码的授权争议），或向作者确认授权后直接用。
3. **公有领域解析样例** — `Hihousou/convertCharacterCard.py`（1★，Unlicense）
   选它：唯一 license 干净（公有领域）的 V2→dict 实现，可直接抄/改，作为我们解析器的起点。
   （备选参考对象：`awaa-col/Character_Card` 15★——中文写卡方法论笔记，学写法不搬内容。）

### 5.3 如果直接搬用，缺什么（点名我们教室必需的五样）

| 必需品 | 社区卡有没有 | 缺在哪 |
|---|---|---|
| **教师人格**（苏格拉底式提问） | 基本没有（§4：未找到老师定位卡） | 即使有恋爱/校园卡，其 system_prompt 管的是"角色扮演+破限"，不是"引导学习者思考" |
| **教材**（计算机课内容） | 无 | 卡只有角色设定，没有任何课程知识资产；知识正确性无人兜底【推断】 |
| **课程表**（上课顺序/进度） | 无 | 卡是"一次对话"产物，无课程结构概念；`alternate_greetings` 只有开场白数组，无进度状态 |
| **隐喻映射**（抽象概念→故事世界） | 无 | 卡生态的"世界书/场景"服务于 RP 沉浸，不服务于"把递归讲成迷宫"这类教学隐喻 |
| **教学法**（提问策略/反馈/评估） | 无 | 卡生态无"教学目标/形成性评估/追问策略"概念；`character_book` 是 lorebook（知识触发），不是教学编排 |
| （附带）**状态笔记本**（进度持久化） | 弱 | `extensions` 可承载自定义状态（V2 支持任意键值【原文】），但无现成实现，需自建【推断】 |

> **结论句【推断】**：社区能给我们的是"**容器**"（V2 格式、解析工具、世界书机制、写法范本），给不了"**内容**"（教师、教材、课程、隐喻、教法）。**格式搬生态，内容必须自建**——且自建内容恰好全部落在我们仓库的 markdown 资产（角色设定/教材/课程表/故事线/状态笔记本）里，与既定产品形态天然一致。

## §6 未找到 / 已试检索词

**明确未找到（不编）：**
- "老师/助教/苏格拉底式导师"定位的现成角色卡（GitHub 仓储检索 0 实质命中；chub/characterhub API 被封锁无法核实，如实标"未核实"而非"没有"）
- 任何带可核查 license 授权链的大型中文角色卡合集（两个最大中文卡库均无 license）
- 我们仓库可直接搬用的"教学内容类"卡（教材/课程类卡，零命中）

**已试检索词（供复跑/反查）：**
- GitHub 仓储：`sillytavern character cards` / `character card v2` / `tavern card` / `character cards collection` / `character cards pack` / `sillytavern cards` / `酒馆 角色卡` / `角色卡 合集` / `角色卡 破限` / `AI 角色卡` / `角色卡 老师` / `tavernai cards json` / `AI tutor character card` / `socratic sillytavern` / `teacher character card tutor`
- 站 API：chub.ai `/api/characters/search`（地理封锁）、api.characterhub.org（TLS 失败）
- Web 检索：酒馆角色卡下载站点、characterhub 中文站、MiniTavern 博客、SillyTavern 角色卡指南

## §7 待确认清单（供主代理转呈用户/后续核实）

1. **chub.ai 的 ToS 是否允许批量下载与再分发**？——未查（API 地理封锁挡在门外）。若 chub 上有理想"老师卡"，需走网页手动浏览 + 逐卡看作者声明。
2. **tavern-card-distiller 的授权状态**：README badge 自述 MIT 但仓库无 LICENSE 文件（gh api NO_LICENSE）——以 badge 为准还是需作者确认？工具代码可否直接拷入我们仓库？
3. **分享站（JanitorAI / AI Character Cards / Character Tavern / sillytavern.one）各自的 ToS 与卡作者默认条款**——全部未查；裁决暂按"不能搬"保守处理。
4. **leigegehaha/sillytavernassets「单人」目录 157 张**未逐一核名（只核了「校园」42 张）——如后续需要，用 extract_card.py 批量抽元数据再筛。
5. **go-png-chunks-chara 的 LICENSE 文件内容**（SPDX 报 NOASSERTION，未人工查看）——若要用它做底层解析库，先确认具体条款。
6. **立场确认**：我们是否接受"参考写法（不搬文本）"作为唯一搬用形态？若接受，§5.1 的"只能参考"档即定案。

## §8 来源与可复跑命令

**本报告事实来源（全部经工具实测，非记忆）：**
- GitHub API（`gh api`，本机已登录）：`search/repositories`（★ 数/license/描述）、`repos/<owner>/<repo>`（updated_at/license）、`repos/.../contents/`（目录结构）、`repos/.../git/trees/<branch>?recursive=1`（全树文件统计）、`repos/.../contents/<file>`（取原文，如 spec_v2.md、extract_card.py、README.md）
- chub.ai 公开 API：`curl https://api.chub.ai/api/characters/search?query=...`（返回地理封锁原文）
- 官方规范原文：`gh api repos/malfoyslastname/character-card-spec-v2/contents/spec_v2.md`（字段清单来源）
- 无 license 政策原文：GitHub Docs/choosealicense.com 的 no-license.md（web 检索交叉验证）
- 分享站格局：web_search（MiniTavern 博客等，二手信息已在文中标注）

**可复跑命令样例：**
```bash
# 1) 搜角色卡仓库（★ + license 一次拿全）
gh api -X GET search/repositories -f q="sillytavern character cards" -f sort=stars \
  --jq '.items[]|"\(.stargazers_count)★ \(.full_name) | lic:\(.license.spdx_id // "NO_LICENSE")"'

# 2) 查单个仓库 license 与更新时间
gh api repos/leigegehaha/sillytavernassets --jq '"\(.stargazers_count)★ lic:\(.license.spdx_id // "NO_LICENSE") updated:\(.updated_at)"'

# 3) 数仓库里的卡（PNG/JSON 文件数）
gh api "repos/leigegehaha/sillytavernassets/git/trees/main?recursive=1" \
  --jq '[.tree[] | select(.path | test("png$|json$"; "i"))] | {png: ([.[] | select(.path | test("png$";"i"))] | length), json: ([.[] | select(.path | test("json$";"i"))] | length)}'

# 4) 取 V2 规范原文
gh api repos/malfoyslastname/character-card-spec-v2/contents/spec_v2.md --jq '.content' | base64 -d

# 5) 试 chub API（预期：地理封锁）
curl -sS "https://api.chub.ai/api/characters/search?query=teacher&limit=5"
```

**卡片数量实测依据：** leigegehaha/sillytavernassets 全树统计 = 3283 PNG + 548 JSON（2026-09-22 实测）；「校园」目录 42 项（2026-09-22 实测目录列表）。