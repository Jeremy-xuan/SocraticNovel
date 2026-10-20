# SocraticNovel 复活评估（2026-09-19）

> **状态：待用户拍板。** 本文是 `交接文档.md` §6 待办 **O1** 的输入底数 ＋ 复活方案，**不含结论性决定**。
> 数据口径：所有 GitHub 数据为 **2026-09-19 当日实测**（本机已登录的 `gh` CLI，账号 `Jeremy-xuan`），可原样复跑，命令见 §8。
> 标记法：【实测】现场查到 ｜【官方】官方原文 ｜【推断】我的推理。三类不混用。

---

## §0 先回答那个问题：算不算「开源线的另一条支线」

**答：同一个大类（开源课外）下的第二条腿，但不是同一条支线——两条腿证明的东西相反。**

| | 开源线主线（给别人提 PR） | SocraticNovel（自有仓库） |
|---|---|---|
| 证据性质 | **外部认可**：别人的项目收下了你的改动 | **自主创造**：从 0 造出一个东西 |
| 命中哪句官方话 | NUS 官方成就示例 "contribution to an open-source software" | **同一句的前半句** "Creation of a new software or app" |
| 现在有没有 | 见 `开源线/提交说明.md`（PR1–PR8 状态） | **已成立**——仓库公开、能打开、有 5 份设计文档 |
| 🔴 缺什么 | 缺 merged 记录 | **缺"外部认可"这一半：全历史 0 issue、0 PR、contributor 只有你 1 人** |

→ 所以"复活"的正确目标**不是继续写内容**（内容那一半已经成立），而是**补上它唯一缺的那一半：外部协作痕迹**。
→ 而这一半**恰好已经躺在你手上**：**13 个提交正躺在别人的 fork 里，一个都没回流**（§2）。

---

## §1 现状底数（2026-09-19 实测）

| 项 | 值 |
|---|---|
| 仓库 | `Jeremy-xuan/SocraticNovel`（公开，建仓 2026-03-22） |
| ★ | **31** |
| forks | **10** |
| issues（`state=all`） | **0** |
| PRs（`state=all`） | **0** |
| contributors | **1**（`Jeremy-xuan`，17 个提交） |
| 最后推送 | **2026-03-26**（停更近半年） |
| license | `NOASSERTION`（实际文件是 CC BY-NC-SA 4.0，见 §4） |
| topics | ai-education / claude / immersive-learning / light-novel / narrative-ai / prompt-engineering / socratic-method |

**★ 的时间分布（逐颗可取，实测）**：3 月 **10**、4 月 **10**、5 月 **2**、6 月 **6**、7 月 **2**、8 月 **1** → 共 31，最后一颗 **2026-08-06**。

- 【推断】停更之后**仍在进星** = 有自然发现；但**速率在衰减**（前两月各 10 → 近两月 1–2）。
- 【推断】按此斜率，自然涨到 **100★ 需要 12 个月以上**，与申请时间窗（2026-11 港校 / 2027-02 NUS）不重叠 → **若按你 2026-09-17 的"<100★ 不算有力帮助"口径，这条线不该按"涨 star"立项。**

**近 14 天流量（GitHub traffic API 只给 14 天窗口，实测）**：views **70**／uniques 28；clones **15**／uniques 12。
**来源**：github.com 21 ／ **link.zhihu.com 15（2 uniques）** ／ Baidu 1 ／ zhihu.com 1。
**被看的页面**：Overview 26 ／ **`/issues` 6** ／ META_PROMPT.md 6 ／ AI_GUIDE.md 4 ／ **`/pulls` 3** ／ NARRATIVE_DESIGN.md 2 ／ `tree/main/参考资料` 2 ／ `runtime/session_log.md` 2。

- 【实测】站外有真实入口，**知乎是最大的一条**（15 次／2 uniques）——⚠️ **需你确认是不是你发的**，我无法从数据判断。
- 【推断·弱】`/issues` 与 `/pulls` 被访问而两页**都是空的** → 有人走到了"想提点什么"的位置，然后发现没地方提。**样本太小，不作为结论**，只作为"入口值得补"的旁证。

---

## §2 两个领先 fork：性质完全不同（🔴 更正既有判断）

🔴 **更正**：`开源候选_深度检索.md` §四 写的"**把它们的成果请回上游是成本最低、见效最快的一步**"——**过于乐观，需更正**。实测两条 fork 一条能合、一条不能整体合。

| fork | ahead | 变更 | 内容 | 能不能回流 |
|---|---|---|---|---|
| **94series** | **+3** | 173 文件：**172 新增／0 删除**（+19892 / −0） | 新学科系统 **`Advanced_Math`（膜材料数学）** ＋ 把 `system_core` 拆成 **5 个 Skill** ＋ 新增**白板 Skill** ＋「三人同时在场」；结构改成 `.kilo/skills/`（另一个 agent 平台） | ✅ **可干净合并**（纯新增、零删除、behind=0 无冲突），且**逐字命中 README「特别期待」第 1 项「新学科的完整系统」** |
| **shentianming1994** | **+10** | 94 文件：45 新增／**48 删除**（+10140 / −5914） | **删掉上游整个 `AP_Physics_EM` 演示**，换成自己的 `DL_FromScratch`（三老师：瑠夏／千鶴／墨）；含"等距轮換"重构 ＋ 三条感情弧 | ❌ **不能整体合**——它会删掉上游 README 里作为"实战案例"的演示系统 |

- 【实测】两条 fork **behind = 0**：都没落后上游，合并零冲突。
- 【实测】`shentianming1994` 的第一个动作是 **"Add root CLAUDE.md to route Claude Code to DL_FromScratch system"** → **一个真实用户 fork 后的第一件事就是补 `CLAUDE.md`**（见 §3）。
- 【推断】可回流的净值：94series 的 3 个提交**可整条收下**；shentianming1994 里值得抽的是**方法层**（等距轮換的轮值节奏、感情弧结构），**不是文件**。
- ⚠️ **回流前必核一处**：94series 把课程讲义放在 `Advanced_Math/materials/textbook/目录/`（lesson_00–lesson_29，约 2 万行）。上游 `.gitignore` 正是为"版权材料"设的（规则：`AP_Physics_EM/materials/textbook/`）。**我抽查了 `lesson_01.md`：内容是作者自己写的叙事型讲义，不是教材原文**（【实测】），但 29 份未逐份核 → **合并前须逐份确认，或先剥离该目录**。

---

## §3 为什么五个月零 issue 零 PR：门在邀请，但没装把手（实测）

| 检查项 | 结果 |
|---|---|
| README 首推平台 | "把 `META_PROMPT.md` 喂给 **Claude Code**"（路径 A）／"在 `AP_Physics_EM/` 下启动 Claude Code，说'开始吧'（AI **自动读取** `copilot-instructions.md`）"（路径 B） |
| 仓库里实际有什么 | `AP_Physics_EM/copilot-instructions.md`；**根目录没有 `CLAUDE.md`**（【实测】） |
| README 自己的记录 | v2.0 更新记录：**"CLAUDE.md → copilot-instructions.md"**（是有意改名，为平台无关） |
| 由此的问题 | 【推断，**待实测**】`copilot-instructions.md` 既不在 `.github/` 下，也不是 Claude Code 的自动加载入口（`CLAUDE.md`）→ **README 承诺的"说'开始吧'就自动读取"，在它首推的那个平台上很可能不成立** |
| 外部佐证 | 【实测】shentianming1994 fork 后**第一件事就是补根目录 `CLAUDE.md`** → 有真实用户撞到了这个入口 |
| 贡献通道 | **无 `.github/`**：无 issue 模板、无 PR 模板、无 `CONTRIBUTING.md`（【实测】） |
| 但 README 在邀请 | §🤝 一起来 明确写"**提 PR——哪怕只是修一个错别字也欢迎**"，并列出"特别期待"4 项（新学科系统／不同文化角色／框架改进／使用报告） |

→ 【推断】这是一个**邀请写在门上、门却没装把手**的状态：README 在征集，但没人知道从哪进；即便进来了，也没模板告诉他该改哪。
→ **94series 干的正是"特别期待"第 1 项，却只能躺在 fork 里——因为没有 PR 通道，也没有维护者在看。**

---

## §4 许可证：CC BY-NC-SA 4.0 用在了"框架／软件"上（实测）

- 【实测】仓库 `LICENSE` = **Creative Commons Attribution-NonCommercial-ShareAlike 4.0**；GitHub API 识别为 **`NOASSERTION`** → 仓库页面**不显示许可证徽标**，许可证筛选／识别失效。
- 三个后果（均可核查）：
  1. **定性**：Creative Commons 官方**不建议把 CC 许可用于软件**；而这个项目要走的落点之一正是 NUS 那句 "Creation of a **new software or app**"——用内容许可证，等于自己把"软件"的定性削掉一半。
  2. **规模**：**NC（禁商用）＋ SA（传染）** → 公司／团队／学校机构都不能采用、不能二次分发 → **直接压低"被使用规模"**，而 NUS 那条官方条款考的恰恰是 `used by many people`。
  3. **回流**：别人 fork 出来的东西（如 94series 的 `Advanced_Math`）在 NC-SA 下同样受限 → 影响它能否被正常合并与再分发。
- **建议（可核查的通行做法，待拍板，未改）**：**分层双许可**——代码／框架用 `MIT` 或 `Apache-2.0`，叙事与文本内容保留 `CC BY-NC-SA`。

---

## §5 复活方案：三档，按你 10–11 月的真实时间轴给

🔴 **时间轴纪律**（本项目已因"只算美本内部"被纠正过一次）：你的 **10 月 = TMUA ＋ UCAS ＋ 托福 ＋ 主文书**；**11 月 = EA 弄完接香港（11/13–26 阶梯）＋ UC（11/30）**。**所以本线只能按"一次性低工时"设计，不能按"持续运营"设计。**

| 档 | 内容 | 工时 | 产出（可写进材料的形态） |
|---|---|---|---|
| **A · 归档式复活（建议）** | ① 收下 94series 的 3 个提交（走一次**真实 PR/merge**，这是仓库**第一次外部合并**）② 补 `.github/`：issue 模板 ＋ PR 模板 ＋ `CONTRIBUTING.md` ③ 修入口：根目录补 `CLAUDE.md`、README 快速开始纠错 ④ 许可证分层 ⑤ 发一个"征集"issue（把 10 个 fork 的人叫回来） | **半天**（①②③④ 可子代理并行；⑤ 约 15 分钟） | 仓库从"停更 ＋ 零协作"变成"**有外部合并记录 ＋ 有活着的贡献入口**"；**且这条记录不需要你之后再投入** |
| **B · A ＋ 内容回填** | 再抽取 shentianming1994 的"等距轮換"方法层，写成一篇设计文档合回（**不合并它的文件**） | A ＋ 半天 | 多一份"框架迭代"的证据 |
| **C · 运营（现在不做）** | 持续更内容、追 star、做宣传 | 每周数小时、跨月 | 与 10–11 月硬冲突；且按 <100★ 口径，**在申请窗口内到不了线** |

**明确不做的事**：
- ❌ 不追 100★（§1：斜率不支持，且与你自己的口径冲突）；
- ❌ 不整体合并 shentianming1994 的 fork（会删掉上游演示）；
- ❌ 不为这个仓库新写教学系统内容（内容已成立，缺的不是这个）。

---

## §6 与申请落点的对应（只写证据性质，不含任何概率）

| 落点 | 这条线能提供什么 | 强度 |
|---|---|---|
| **NUS（2027-02）** | "Creation of a new software or app"——**自有、公开、可打开、有文档**；若做完档 A，再加"**被外部用户使用并改进**"（对应 `used by many people` 的方向） | 自有仓库：**已成立**；外部使用：**目前为零，档 A 后可产生第一批** |
| **港校（2026-11）** | 可核实的公开作品链接 | 见 `开源线/案例_先例综述_2026-09-17.md` §5：**官方从未提及 ＋ 先例 0** → 该线评分**已降级为"证据不足"**（降级的是评分，不是"开源没用"） |
| 文书 / 卡三 | 项目源自"一个真实运作的 AP 物理辅导系统"（README 原话）→ 与你**公开教学**那条素材同源 | ⚠️ **本文不判断**：涉及卡三与叙事口径（homeschool 三条纪律），须走叙事线，**不得由本文顺手写进申请材料** |

---

## §7 待你拍板（3 个）

1. **做不做档 A**（半天）？——这是我能看到的**唯一**一条"用最低工时给这个仓库制造外部认可证据"的路，且做完不需要后续运营。
2. **许可证改不改**（代码 MIT/Apache ＋ 内容 CC BY-NC-SA）？——不改的话，§4 的三个后果继续成立。
3. **回流授权**：94series 的 3 个提交（含约 2 万行自制讲义）——**整条收下**，还是**只收 skill 拆分／白板那部分、剥离 `materials/textbook/`**？（后者更稳，前者更完整）

---

## §8 来源与可复跑命令

```bash
gh api repos/Jeremy-xuan/SocraticNovel --jq '{stargazers_count,forks_count,open_issues_count,license:.license.spdx_id,pushed_at}'
gh api "repos/Jeremy-xuan/SocraticNovel/issues?state=all"    # 空
gh api "repos/Jeremy-xuan/SocraticNovel/pulls?state=all"     # 空
gh api "repos/Jeremy-xuan/SocraticNovel/contributors"
gh api "repos/Jeremy-xuan/SocraticNovel/stargazers?per_page=100" -H "Accept: application/vnd.github.star+json"
gh api repos/Jeremy-xuan/SocraticNovel/traffic/views
gh api repos/Jeremy-xuan/SocraticNovel/traffic/popular/referrers
gh api "repos/Jeremy-xuan/SocraticNovel/compare/main...94series:main" --jq '{ahead_by,behind_by,files:(.files|length)}'
gh api "repos/Jeremy-xuan/SocraticNovel/compare/main...shentianming1994:main" --jq '{ahead_by,behind_by,files:(.files|length)}'
```

⚠️ **未登录时 GitHub REST 匿名限额会直接返回 `API rate limit exceeded`**（本机实测）→ **必须用已登录的 `gh`**，不要用裸 `curl`。
⚠️ 本文所有 GitHub 数据为 **2026-09-19 单日快照**；star／fork／流量会变，重跑前先看日期。

---
