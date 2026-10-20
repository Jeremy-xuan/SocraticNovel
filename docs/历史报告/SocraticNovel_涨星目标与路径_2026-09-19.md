# SocraticNovel 涨星目标与路径（2026-09-19）

> **状态：待用户拍板目标数字。** 本文回答两件事：① "多少 ★ 会让招生官眼前一亮"；② "从 31★ 出发怎么做到"。
> 全部数据为 **2026-09-19 当日实测**（本机已登录的 `gh` + GitHub Search API），可复跑，命令见 §6。
> 标记法：【实测】现场查到 ｜【官方】官方原文 ｜【推断】我的推理。三类不混用。
> 配套文件：`开源线/SocraticNovel_复活评估_2026-09-19.md`（现状底数与入口/许可证诊断）。

---

## §0 先给答案

**"眼前一亮"的门槛 = 1,000★。** 依据不是"1000 这个数字好听"，而是**实测：在 `ai-education` 这个赛道，1,000★ 就是全球第 3**（第 1 名 1,316★、第 2 名 1,018★）——1,000★ 在这个题材里等于"你已经是这个方向上最有名的几个项目之一"。
**能独立撑起一条叙事的量级 = 3,000★ 以上。**

**但真正该定的大目标是另一个东西**——见 §1。**★ 是给技术圈看的，招生官看不懂 ★**（§3）。所以我把目标拆成两条轨：

| 轨 | 目标 | 时限 | 为什么这么定 |
|---|---|---|---|
| **A 轨 · 主目标（可达）** | **三个细分方向 topic 全球第 1** ＋ **外部合并 ≥1** ＋ **外部贡献者 ≥2** ＋ **被 ≥1 个 curated list 收录** | **2–4 周** | 实测：`immersive-learning` 你**已经是第 1**；`narrative-ai` 第 1 只要 **>189★**、`socratic-method` 第 1 只要 **>458★**。→ **"这个方向上被使用最多的开源项目"这句话，不需要 1,000★ 就能成立** |
| **B 轨 · 大目标（不设时限）** | **1,000★**（并带出外部贡献者 ≥3） | 做到为止 | 1,000★ 有真实先例（同赛道 ChatTutor 1,316★）；**够大，且不是幻想** |

**两条轨不冲突**：A 轨是 B 轨的必经前置——★ 几乎总是先有"被收录、被采用、被贡献"才涨，不是反过来。

---

## §1 赛道地图：你现在到底站在哪（🔴 关键发现）

【实测】GitHub Search API 按 topic 排序取前几名：

| topic | 第 1 | 第 2 | 第 3 | **SocraticNovel** |
|---|---|---|---|---|
| `immersive-learning` | **SocraticNovel 31★** | 3★ | 3★ | 🥇 **第 1**（⚠️ 但全 topic 只有 5 个仓库，分母极小） |
| `narrative-ai` | 189★（dramatica-flow） | 43★ | **31★ = 你** | 🥉 **第 3** |
| `socratic-method` | 458★（learn-anything） | 269★（Bloom） | 124★ | ❌ **未进前 5** |
| `ai-education` | 1,316★（ChatTutor） | 1,018★ | 788★ | ❌ 未进前 8 |
| `ai-tutor` | **40,093★**（HKUDS/DeepTutor） | 557★ | 486★ | ❌ 未进前 5 |

**从这张表读出来的三件事**：

1. 🔴 **`immersive-learning` 的"全球第一"是虚的**——分母只有 5 个仓库，第 2 名才 3★。**写进材料会被一眼看穿**（对方点进 topic 页就看见了）。**不要用这个第一名。**
2. ✅ **真正值钱的目标是 `narrative-ai` 与 `socratic-method` 的第一名**——它们的分母是真实的（第 1 分别 189★ / 458★），且**语义完全准确**（你的项目就是"叙事 AI"＋"苏格拉底教学法"）。**拿到这两个第一，"全球第一"这句话才站得住。**
3. 📌 **`ai-tutor` 第 1 是 40,093★ 的 `HKUDS/DeepTutor`**——**香港大学数据科学实验室**的项目。→ 说明**"AI 教学系统"这个题材在港大体系内有真实语境**（【实测】事实；**不等于录取偏好，不作任何录取推断**）。

**由 3 得出的战术**：★ 的攀爬顺序应当是 **31★ → 200★（拿下 narrative-ai 第 1）→ 500★（拿下 socratic-method 第 1）→ 1,000★（进入 ai-education 前三）**。每跨一档都换回一句**可核查、能被非技术读者读懂**的话。

---

## §2 GitHub 全局标尺（2026-09-19 实测）

| 门槛 | 全站仓库数 |
|---|---|
| ≥100★ | **476,457** |
| ≥500★ | **123,132** |
| ≥1,000★ | **64,960** |
| ≥5,000★ | **12,581** |
| ≥10,000★ | **5,573** |

【推断】读法：**★ 在全局一点都不稀有**（6.5 万个仓库 ≥1,000★）→ **"我有 1,000★"本身不是卖点，"我在哪个方向上第几"才是**。这正好支持 §1 的 A 轨打法。

**参照物（实测，同日）**：
- `hesreallyhim/awesome-claude-code` = **54,368★**（2026-09-21 仍在推）→ **这个题材最精准的分发入口**
- `521xueweihan/HelloGitHub` = **177,840★** 月刊 → **中文开源最大的单一杠杆之一**（有自荐通道）
- 你现在的 31★，其中 **10 颗来自建仓头 3 天**（3 月 22–31 日）→ 说明**初始发布那一次是有效的**，之后靠自然长尾衰减到每月 1–2 颗。

---

## §3 🔴 最重要的一条：★ 是给技术圈看的，招生官要的是"翻译"

**本项目已有实测**：`阶段二_采集/补缺_港大GitHub说法核证与活动材料通道.md` 核了 11 个港校官方页——**官方评估依据里没有任何"编程/开源/代码库"维度**；港大官方列举的评估依据是"学业成绩、面试、个人陈述、推荐信、其他提交材料"。

**同时该项目也核出了两个真实的上传口**（【官方】逐字）：
- **HKUST**（`join.hkust.edu.hk/.../application-procedures`）："**We welcome any other supporting documents that you wish to be taken into consideration.** You can log in to the online application system and upload any supporting documents (i.e. awards, achievements)…"；工学院 FAQ Q19 同句："**Whatever documents or information you feel can support your application are welcome.**"——但 Q20 紧跟着说："Do let us know of your MAJOR interest and achievements, **but be selective in your entry**."
- **HKU**（Step-by-Step Guide）："Any other required documents you would like to add to support your application"（兜底栏）＋ CV ≤2 页 A4；**上传硬限制：仅 PDF、单文件 ≤10MB、多份须合并**。

**结论（三条，都可执行）**：
1. **★ 数不会自己起作用**——它必须被**翻译成一句非技术读者能读懂的话**。招生官不是程序员。
2. **HKUST 那句 "be selective" 决定了打法**：你要交的**不是"一个链接"，而是"一件被选中的成就"**。所以 A 轨那四个事实（赛道第一／被收录／有外部贡献者／被采用）**必须能被压进 2 页 A4 的 CV 里**。
3. 🔴 **产出的最终形态是一个 PDF**（HKU 只收 PDF ≤10MB 单文件；HKUST 走 Upload Documents 栏）——所以**做涨星的同时就要同步做"可上传的一页纸"**，否则涨了也交不上去。

---

## §4 路径：四个杠杆，按"杠杆 ÷ 成本"排序

### L1 · 转化率（最便宜，先做）
【实测】**当前 README 里 0 张图片**（只有 HTML badge），24KB 纯文字。一个"沉浸式轻小说教学"项目，**首页没有一个画面**——这是最大的浪费：★ 是"看到 → 看懂 → fork → 用"这条链的末端，而链条前端现在是断的。

| 动作 | 为什么 |
|---|---|
| 首页放**一段真实课堂对话的录屏 GIF**（不用剪，原样录） | 这是"沉浸式轻小说教学"唯一的说服方式；也是你 B 站素材的复用 |
| 补根目录 `CLAUDE.md`、修 README 快速开始 | 【实测】shentianming1994 fork 后**第一件事就是补 CLAUDE.md** → 入口是断的；**fork 是 GitHub 权重最重的信号之一** |
| 英文 README 提到首屏 | 国际流量是 GitHub 发现的主体，现在默认中文 |

### L2 · 借生态分发（持续长尾，性价比最高）
| 动作 | 实测依据 |
|---|---|
| 把框架做成一个 **Claude Code skill / plugin**，进 `awesome-claude-code` | 该 list **54,368★**；你的项目天然就是"Claude Code 教学框架" |
| 走 **HelloGitHub 自荐** | 该月刊 **177,840★**，有社区推荐/自荐通道 |
| 提交其他 curated list（awesome-llm-apps / awesome-education 等） | 被收录 = **一条能被一句话写进 CV 的事实**，且长期带流量 |

### L3 · 一次性爆点（要"上榜"，不是"发一次"）
- **HN Show HN** ／ **Reddit r/ClaudeAI、r/LocalLLaMA** ／ **Product Hunt** ／ **X**
- 🔴 **B 站是你独有、别人没有的渠道**（你有 2 万粉）：一段"AI 老师真的在上课"的录屏 → B 站 → 挂 GitHub。
- 【实测旁证】站外渠道**是通的**：近 14 天 referrer 里 **link.zhihu.com 带 15 次访问**。→ 中文渠道已证明有效，只是**没有规模化**。
- 目标形态：**制造一次 GitHub Trending**（短期集中增速才触发），上榜一次通常带几百到几千★。

### L4 · 制造"采用事实"（这才是给招生官看的那一半）
- 收下 94series 的 3 个提交 → **仓库第一次外部合并**（见复活评估 §2）
- 开一个征集 issue，把 **10 个 fork 的人**叫回来 → 他们已经在改你的项目了，只差一个入口
- 目标产出：**"来自 N 个国家／地区的 M 位外部贡献者"**——**这种句子招生官能读懂，★ 数不能。**

### 🔴 一条红线（只说一次）
**买 ★／互赞群／机器人刷 —— 不要做。** 两个理由，都硬：① 违反 GitHub 的 star 操纵政策，会被清除；② **申请材料里的链接是任何人点开就能看的**，一条垂直陡升的 ★ 曲线比 31★ 危险得多——它自己就是造假证据。
**同理**：只挂**真实存在、语义准确**的 topic（你现有 7 个都准确）；**不要为了"当第一"新建空 topic**——对方点进去看到整个 topic 只有 3 个仓库，反而暴露。

---

## §5 建议的目标定案（待你拍板）

| | 内容 | 验收（可核查） |
|---|---|---|
| **主目标** | ① `narrative-ai` 第 1（>189★）② `socratic-method` 第 1（>458★）③ 外部合并 ≥1 ④ 外部贡献者 ≥2 ⑤ 被 ≥1 curated list 收录 ⑥ **产出一页可上传 PDF** | 每一项都能截图／给链接；**⑥ 是最终交付物** |
| **大目标** | **1,000★**（＝ ai-education 全球前三的量级） | 不设时限，做到为止 |
| **明确不做** | 买★／刷★／为排名建空 topic／为追★ 而持续运营内容（10–11 月时间轴不允许，见复活评估 §5） | — |

⚠️ **诚实边界**：从 31★ 到 1,000★ 需要一个真正的破圈事件（Trending／大 list 收录／爆款视频），**不是靠日常更新累积出来的**。所以大目标照定，但**主目标的每一项都不依赖运气**——这是我把它设成主目标的唯一理由。

---

## §6 来源与可复跑命令

```bash
# 全局标尺
for q in "stars:>100" "stars:>500" "stars:>1000" "stars:>5000" "stars:>10000"; do
  printf "%-16s " "$q"; gh api -X GET search/repositories -f q="$q" -f per_page=1 --jq '.total_count'
done
# 赛道地图（按 topic 取前几名）
for t in narrative-ai immersive-learning socratic-method ai-education ai-tutor; do
  echo "== $t =="; gh api -X GET search/repositories -f q="topic:$t" -f sort=stars -f per_page=5 --jq '.items[]|"\(.stargazers_count)★ \(.full_name)"'
done
# 分发入口规模
for r in hesreallyhim/awesome-claude-code 521xueweihan/HelloGitHub HKUDS/DeepTutor; do
  gh api repos/$r --jq '"\(.full_name) \(.stargazers_count)★"'
done
# 自家底数
gh api repos/Jeremy-xuan/SocraticNovel --jq '{stargazers_count,forks_count}'
```

⚠️ 未登录时 GitHub REST 匿名限额直接返回 `API rate limit exceeded`（本机实测）→ **必须用已登录的 `gh`**。
⚠️ 本文所有数字为 **2026-09-19 单日快照**（`awesome-claude-code` 的 pushed_at 显示到 09-21，为当日 API 返回值）。**★ 与 topic 排名会变，复跑前先看日期。**

---
