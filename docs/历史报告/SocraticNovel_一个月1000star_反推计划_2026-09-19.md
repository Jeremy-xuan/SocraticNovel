# SocraticNovel · 一个月 1,000★ 反推执行计划（2026-09-19 立）

> **目标（用户 2026-09-19 拍板）：30 天内 ★ 从 31 → 1,000。**
> 本文是从目标**反推**出来的执行计划。所有 GitHub 数据为 **2026-09-19 当日实测**（已登录 `gh` + Search API），可复跑，命令见 §6。
> 标记法：【实测】现场查到 ｜【官方】官方原文 ｜【推断】我的推理。三类不混用。
> 配套：`开源线/SocraticNovel_复活评估_2026-09-19.md`（底数/入口/许可证）、`开源线/SocraticNovel_涨星目标与路径_2026-09-19.md`（赛道地图）。

---

## §0 反推第一步：这个目标需要什么

**算术**：1,000 − 31 = **969★ / 30 天 = 32.3★/天**（日均）。

**但 ★ 增长从来不是线性的，是脉冲式的**（事件驱动）。所以真正要凑的不是"日均"，而是**几个独立事件的总和**。一个可参照的构成：

| 来源 | 目标贡献 | 形态 |
|---|---|---|
| 生态分发（awesome list 收录 + skill 发布 + HelloGitHub） | ~200★ | 一次性脉冲 + 长尾 |
| 英文圈（Show HN / Reddit / Product Hunt） | ~250★ | 波动大、上限高 |
| 中文圈（B 站 + 知乎 + 公众号投稿） | ~250★ | 你独有的渠道 |
| **GitHub Trending** | ~300★ | **最大的单点，但需要前几项先做出 burst 才有资格上** |
| 长尾与既有自然流入 | ~100★ | 现状基线 |

### 真实速度锚点（【实测】同赛道，created → ★）

| 项目 | ★ | 活跃窗口 | 折合 |
|---|---|---|---|
| `24kchengYe/human-skill-tree` | **557★** | created 2026-03-07 → pushed 2026-03-25 = **18 天** | **≈31★/天** |
| `HugeCatLab/ChatTutor` | 1,316★ | 2025-11-05 → 2026-01-09（约 2 个月） | ≈22★/天 |
| `ChenChenyaqi/learn-anything` | 458★ | 2026-05-24 → 2026-08-29（约 3 个月） | ≈5★/天 |
| `Li-Evan/Bloom` | 269★ | 2026-03-10 → 2026-09-17（约 6 个月） | ≈1.5★/天 |
| `pguso/agents-from-scratch` | 1,018★ | 2025-12-22 → 2026-07-25（约 7 个月） | ≈5★/天 |
| `HKUDS/DeepTutor` | 40,093★ | 2025-12-28 → 2026-09-21（约 9 个月） | ≈150★/天 |

**读出来的两条硬结论**：
1. ✅ **33★/天 这个速率在本赛道有真实先例**（human-skill-tree 做到过 31★/天）→ **目标不是幻想。**
2. 🔴 **但"1,000★ / 30 天"在本赛道没有先例**（同赛道 30 天窗口的最高记录是 557★）→ **必须叠加 ≥3 个独立事件，单点爆款不够。**

---

## §1 🔴 反推出来的第一结论：现在的仓库「接不住流量」

【实测】`gh api repos/Jeremy-xuan/SocraticNovel/languages` → 返回 **`{}`**（空）；`language` 字段 = **`null`**。

**→ 这个仓库里没有一行代码，是纯 markdown。**

这带来四个后果（前三条是确定的，第四条是推断）：

| # | 后果 | 确定性 |
|---|---|---|
| 1 | **`language:` 搜索过滤对它完全无效** → 少掉 GitHub 上最大的一块发现入口 | 【实测】确定 |
| 2 | **没有语言徽标；GitHub 判定它"不是一个软件"** → 与 NUS 官方那句 "Creation of a new **software** or app" 直接冲突（叠加 `LICENSE` 被识别为 `NOASSERTION`，见复活评估 §4） | 【实测】确定 |
| 3 | **fork 后没有任何可执行入口** → 访客"看到 → 想试 → 跑不起来 → 走"，转化链在这一步断掉 | 【实测】确定 |
| 4 | Trending 主榜按语言分类，无语言仓库只能进 "All languages" 综合榜 → **上榜路径比有代码的项目窄** | 【推断】待验证 |

**结论：加代码不是"加分项"，是 1,000★ 的必要条件。** 而且要**加真的、能跑的代码**，不是塞个占位文件——最小可行动作是：
- 一个 **CLI 安装器**（`socratic init` 把 META_PROMPT 生成的系统装到目标目录）
- 一个 **结构校验器**（检查生成的 15+ 个文件是否齐全、路径是否对）
- 一个 **启动器**（自动写 `CLAUDE.md` 并交给 Claude Code）

这三样同时解决：`language=null`、入口断、fork 跑不起来、以及"它到底算不算 software"。

---

## §2 对标解剖：human-skill-tree 做对的 9 件事

`24kchengYe/human-skill-tree` 是**同赛道、中文作者、18 天 557★** 的最近先例。逐项对照：

| # | 它做了什么 | SocraticNovel 现状 | 动作 |
|---|---|---|---|
| 1 | **有语言**（TypeScript）→ 进 Trending 语言榜、可被 `language:` 搜到 | `language = null` | 🔴 加代码（§1） |
| 2 | **Live Demo 可点**（`humanskilltree.yechengzhang.com`） | **没有在线 demo** | 🔴 上一个能点的 demo（最高杠杆的转化资产） |
| 3 | **英文正文优先**（"English · 中文"，主体英文） | 默认中文，英文版是附属文件 | 🔴 英文上首屏 |
| 4 | **一句可引用的 hook**："AI got superpowers through Skills and MCPs. What about humans?" | 有 slogan，但偏文学、不易被引用 | 补一句**英文、可转发**的 hook |
| 5 | **20 个 topic，覆盖整个 agent 生态**（claude-code / claude-skills / agent-skills / mcp-server / copilot / cursor / gemini…） | **7 个 topic，且不含任何大生态入口** | 🔴 扩 topic（见下表，5 分钟的事） |
| 6 | **正式软件许可证**（AGPL-3.0，GitHub 能识别并显示） | CC BY-NC-SA → 识别为 `NOASSERTION` | 🔴 分层双许可 |
| 7 | **badge 阵列一屏说完规模**（Skills 33 / Subjects 800+ / 兼容 4 个平台） | badge 只有版本与概念 | 补"规模 + 兼容性"badge |
| 8 | **首页有图**（badge + 结构图） | 🔴 **README 里 0 张图**（实测） | 🔴 放真实课堂录屏 GIF |
| 9 | 它 **18 天后停更，★ 停在 557** | — | ⚠️ **教训：它是一次性事件驱动**。→ 你要过 1,000★ **必须叠加，不能只做一次** |

### topic 扩展清单（【实测】各 topic 真实规模）

| topic | 全站仓库数 | 榜首 | 挂不挂 |
|---|---|---|---|
| `claude-code` | **75,057** | 264,050★ | ✅ 准确（你本就是 Claude Code 框架） |
| `agent-skills` | **24,538** | 177,374★（anthropics/skills） | ✅ 准确（若按 skill 格式发布） |
| `claude-skills` | **8,739** | 94,363★ | ✅ 准确 |
| `ai-tutor` | 548 | 40,093★ | ✅ 准确 |
| `ai-education` | 445 | 1,316★ | ✅ 已有 |
| `narrative-ai` | 小 | 189★ | ✅ 已有（**这是要打第 1 的赛道**） |
| `socratic-method` | 小 | 458★ | ✅ 已有（**这是要打第 1 的赛道**） |
| `mcp-server` | 29,537 | 205,506★ | ❌ **不挂**——你不是 MCP server，挂了就是不准确 |

🔴 **纪律**：只挂**语义准确**的 topic。**不要为了"当第一"新建空 topic**——对方点进去看到整个 topic 只有 3 个仓库，反而暴露（你现在 `immersive-learning` 第 1 名就是这么来的，**别用这个第一名**）。

---

## §3 反推排期：30 天

### Week 0（D1–D4）· 修漏：**这四天不发布任何东西**
理由：现在 0 张图、无代码、入口断。**先修漏再放水**，否则流量来了全漏掉。

- [ ] 加代码：CLI 安装器 + 结构校验器 + 启动器（§1）
- [ ] 上线 **Live Demo**（对标 #2）——能点开就看到一节真实课堂
- [ ] README 首页：**真实课堂录屏 GIF** + 英文上首屏 + 英文 hook 一句
- [ ] 补根目录 `CLAUDE.md`、一键安装说明（fork 的人第一件事就是补这个）
- [ ] topic 扩到生态入口（§2 表，只挂准确的）
- [ ] 许可证分层：代码 MIT/Apache ＋ 内容 CC BY-NC-SA
- [ ] 收下 94series 的 3 个提交 → **仓库第一次外部合并**
- [ ] 开征集 issue，把 **10 个 fork 的人**叫回来

### Week 1（D5–D11）· 第一次脉冲：借生态
- [ ] 发布 **skill / plugin 版本**，提 PR 进 `awesome-claude-code`（【实测】**54,368★**，2026-09-21 仍在推）
- [ ] 走 **HelloGitHub 自荐**（【实测】**177,840★** 月刊，有自荐通道）
- [ ] B 站发第 1 条：**真实课堂录屏**（你 2 万粉，素材几乎零成本）
- 目标：**D7 ≥100★**

### Week 2（D12–D18）· 第二次脉冲：英文圈（冲 Trending）
- [ ] **Show HN**（英文 hook 方向："an AI teacher that refuses to give you the answer"）
- [ ] Reddit：r/ClaudeAI、r/LocalLLaMA、r/ChatGPTCoding（**分开发，不要同一天群发**）
- [ ] Product Hunt
- 目标：制造 **48 小时内 100–150★ 的 burst** → **触发 GitHub Trending**（Trending 看的是短期集中增速）
- 目标：**D14 ≥300★**

### Week 3（D19–D25）· 第三次脉冲：中文圈
- [ ] B 站第 2 条（若第 1 条起量则加推）
- [ ] 中文技术媒体／公众号投稿（机器之心／量子位／少数派／HelloGitHub 周刊）
- [ ] 知乎（【实测】已有 `link.zhihu.com` 带 15 次访问，入口是通的）
- 目标：**D21 ≥600★**

### Week 4（D26–D30）· 收口
- [ ] 🔴 **产出一页可上传 PDF**——HKU 只收 **PDF、单文件 ≤10MB**；HKUST 走 Upload Documents 栏，且官方说 "**be selective in your entry**" → 交的不是链接，是**一件被选中的成就**
- [ ] README 更新采用事实："被 N 个国家／地区、M 位外部贡献者使用"
- [ ] 复盘：哪个事件带了多少★（为下一轮留数据）

---

## §4 中间验收线（每周可核查，不用等 30 天）

| 时点 | ★ 线 | 同时必须成立 |
|---|---|---|
| D7 | **≥100★** | 代码已上（`language ≠ null`）＋ Live Demo 可点 ＋ 第一次外部合并已完成 |
| D14 | **≥300★** | 已被 ≥1 curated list 收录 ＋ 外部贡献者 ≥2 |
| D21 | **≥600★** | ≥1 次 Trending 或等价爆款已发生 |
| D30 | **≥1,000★** | 一页 PDF 已产出 |

**同时锁定的赛道目标**（比 ★ 数更可叙述）：
- `narrative-ai` **第 1**（需 >189★）
- `socratic-method` **第 1**（需 >458★）
- `ai-education` **前三**（需 >788★ → **1,000★ 正好把这条一起拿下**）

---

## §5 诚实边界与风险（不软化，但也不劝退）

1. 🔴 **本赛道 30 天 1,000★ 没有先例**（最高 557★/18 天）。要成，**必须 ≥3 个独立事件都命中**，不能靠一个爆款。
2. **Trending 有运气成分**（榜单竞争、算法、当天对手）。所以排期里**没有任何一周只押 Trending**——W1/W3 的中文与生态渠道是不依赖运气的。
3. **Week 0 那 4 天是最大的确定性收益**：即使后面事件全没起，修完漏之后**自然长尾也会明显变好**（现状每月 1–2★ 是在"0 图 + 无代码 + 入口断"的条件下测出来的）。
4. **★ 不是最终交付物。** 招生官看不懂 ★（本项目已核：11 个港校官方页 0 命中编程/开源维度）。**最终要交的是那页 PDF**——所以 D26–D30 那一项不能省。
5. **红线**：不买★、不刷★、不建空 topic。理由见涨星路径文件 §4——**申请材料里的链接是任何人点开就能看的，一条垂直陡升的曲线比 31★ 危险得多。**

---

## §6 需要你给的东西 / 拍板项

**我需要你提供**（没有这些，Week 0 做不完）：
1. **一段真实课堂对话的原始记录**（用于录屏 GIF 与 Live Demo）——你手上应该就有（`AP_Physics_EM/teacher/runtime/session_log.md` 那类）
2. **B 站账号是否可用于此**、以及第 1 条视频你愿意出镜/录屏到什么程度
3. **Live Demo 放哪**（GitHub Pages／你自己的域名／其他）

**待你拍板**：
1. **Week 0 是否现在就开工**（4 天，纯改造、零发布风险）
2. **代码由谁写**——我起骨架（CLI + 校验器 + 启动器）你来过目，还是你指定技术栈
3. **许可证改不改**（分层双许可）——不改的话，"software" 定性继续被削弱

---

## §7 可复跑命令

```bash
gh api repos/Jeremy-xuan/SocraticNovel/languages          # {} = 无代码
gh api repos/Jeremy-xuan/SocraticNovel --jq '{language,size,created_at}'
# 速度锚点
for r in 24kchengYe/human-skill-tree HugeCatLab/ChatTutor ChenChenyaqi/learn-anything Li-Evan/Bloom pguso/agents-from-scratch HKUDS/DeepTutor; do
  gh api repos/$r --jq '"\(.full_name) \(.stargazers_count)★ created=\(.created_at|split("T")[0]) pushed=\(.pushed_at|split("T")[0])"'
done
# topic 规模
for t in claude-code agent-skills claude-skills mcp-server ai-tutor ai-education; do
  printf "%-16s " "$t"; gh api -X GET search/repositories -f q="topic:$t" -f per_page=1 --jq '"\(.total_count) repos | top \(.items[0].full_name) \(.items[0].stargazers_count)★"'
done
# 对标解剖
gh api repos/24kchengYe/human-skill-tree --jq '{topics,description,homepage,language}'
```

⚠️ 未登录时 GitHub REST 匿名限额直接返回 `API rate limit exceeded`（本机实测）→ **必须用已登录的 `gh`**。
⚠️ 所有数字为 **2026-09-19 单日快照**；★ 与 topic 排名会变，复跑前先看日期。

---
