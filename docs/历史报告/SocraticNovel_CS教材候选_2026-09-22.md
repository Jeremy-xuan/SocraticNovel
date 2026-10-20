# 计算机系教室 · 教材与大纲候选（2026-09-22）

> 调研目的：为「AI 苏格拉底式家教 · 计算机系教室」找可直接复用的教材/课程资源（优先 md/tex 纯文本，避免 OCR）。全部 ★ 数 / license / 载体形态经 `gh api` 实时核实，未核实的写「未查」。
> 调研方法：`gh api repos/<owner>/<repo>`（stars/license/language/pushed_at）+ `gh api repos/<owner>/<repo>/contents/`（文件形态抽查）+ `r.jina.ai` 抓官网版权声明。本机 gh 已登录（2026-09-22 实测）。

## 摘要（≤8 条）

1. ✅ **`PKUFlyingPig/cs-self-learning`**（CS 自学指南 / CSDIY 官网源码）：**75,786★ / MIT**，mkdocs 站，**正文全在 docs/ 下为 md**——中文侧可直接复用的最佳「选课地图 + 资源聚合 + 每课课程表」。
2. ✅ **OSTEP**《Operating Systems: Three Easy Pieces》：正文在 `pages.cs.wisc.edu/~remzi/OSTEP/`，官网原文「is and will always be free in PDF form」＋「INSTRUCTORS: please just link to them directly (instead of making a copy locally)」→ **裁决：可链不可搬**；配套仓库 ostep-code 4,421★ / ostep-projects 6,073★ / ostep-homework 3,239★ / ostep-translations 3,125★，**全部无 license**。
3. ✅ **`ddy-ddy/cs-408`**：**6,225★ / MIT**，408 四门全覆盖；**正文=OneNote 导出 PDF（实测有文本层，非扫描件）**——大纲/目录可直接用，正文需 pdftotext + 公式清理。
4. ✅ **`missing-semester/missing-semester`**（MIT）：**6,069★**，README 明文 **CC BY-NC-SA 4.0**（署名-非商业-相同方式共享）；web+md 载体。
5. ✅ **Nand2Tetris**（nand2tetris.org）：官网原文「Everything is **free and open-source, as long as you operate in a non-profit setting**」→ **非营利前提下可搬**；配套书《The Elements of Computing Systems》（MIT Press）为商业书。
6. ✅ **`CyC2018/CS-Notes`**：**186,216★ / 无 license**，md 笔记（算法/OS/网络面试向知识点）——可作大纲与故事素材，正文不可搬。
7. ✅ **清华 `Salensoft/thu-cst-cracker`**：**3,068★ / MIT**，清华 CS 全课程（大一上～研究生）md 笔记+试卷；北大 `tongtzeho/PKUCourse` 2,548★ 无 license。
8. ✅ **`callmePicacho/Data-Structres`**：**3,915★ / MIT**（用户点名核实命中）——**课程配套 C 代码（上课Demo/编程作业）**，非教材正文，作「作业/示例代码」素材。

## §1 候选资源清单

| # | 名称 | 仓库/站点 | ★（已核实） | license | 语言/载体 | 覆盖课程 | 完整大纲？ | 更新时间 |
|---|---|---|---|---|---|---|---|---|
| 1 | CS 自学指南（CSDIY） | github.com/PKUFlyingPig/cs-self-learning | 75,786 | MIT | **docs/ 全 md**（mkdocs） | 美式 CS 全栈：OS/网络/组成/编译/DS/算法等 30+ 课 | ✅ 每课一页含课程表 | 2026-09-17 |
| 2 | cs-408 | github.com/ddy-ddy/cs-408 | 6,225 | MIT | **正文=OneNote 导出 PDF（有文本层）** + 目录 md | 408 四门（DS/OS/组成/网络） | ✅ 章级大纲（第1~8章） | 未查 |
| 3 | Missing Semester | github.com/missing-semester/missing-semester | 6,069 | **CC BY-NC-SA 4.0**（README 明文） | web+md（_2019/_2020/_2026） | 命令行/编辑器/版本控制等工具课 | ✅ 13 讲大纲 | 2026-09-21 |
| 4 | CS from Bottom Up | github.com/ianw/bottomupcs | 1,580 | **无 license** | 网页（CSS） | 计算机组成/OS 底层 | ✅ 章节结构 | 2025-09-26 |
| 5 | OSTEP（书正文） | pages.cs.wisc.edu/~remzi/OSTEP/ | —（书） | 免费但**无 license 文件**；作者要求「链接而非复制」 | 网页 + 分章 PDF | 操作系统 | ✅ 50+ 章完整 | v1.10 (2023-11) |
| 6 | OSTEP-Code | github.com/remzi-arpacidusseau/ostep-code | 4,421 | 无 license | C 代码 | OS 教材配套代码 | — | 2023-11-09 |
| 7 | OSTEP-Projects | github.com/remzi-arpacidusseau/ostep-projects | 6,073 | 无 license | md 项目说明 | OS 实验项目 | ✅ 章节映射 | 2024-07-19 |
| 8 | OSTEP-Translations | github.com/remzi-arpacidusseau/ostep-translations | 3,125 | 无 license | md | OS（含中文译本） | — | 2025-01-20 |
| 9 | CS-Notes | github.com/CyC2018/CS-Notes | 186,216 | **无 license** | md 笔记 | 算法/OS/网络/DB 面试向 | ✅ 知识点大纲 | 2024-08-21 |
| 10 | THU-CST-Cracker | github.com/Salensoft/thu-cst-cracker | 3,068 | MIT | md 笔记+试卷 | 清华 CS 全课程 | ✅ 课程地图（大一上~研究生） | 未查 |
| 11 | PKUCourse | github.com/tongtzeho/PKUCourse | 2,548 | 无 license | md 笔记 | 北大 CS 课程 | 部分 | 未查 |
| 12 | Data-Structres | github.com/callmePicacho/Data-Structres | 3,915 | MIT | C 代码（上课Demo/编程作业） | 数据结构课程配套 | 无讲义 | 未查 |
| 13 | 408CSFamily | github.com/142vip/408CSFamily | 704 | GPL-3.0 | **docs/ 全 md**（vuepress） | 408 四门 | ✅ 章节 | 未查 |
| 14 | CSPostgraduate-408 | github.com/CodePanda66/CSPostgraduate-408 | 5,671 | 无 license | md（vuepress，DS_0~DS_4 分节）+真题 | 408 四门+真题 | ✅ | 未查 |
| 15 | CSAPP（书+lab） | csapp.cs.cmu.edu | —（商业书） | 书=版权保留（Copyright ©2015 Bryant & O'Hallaron）；lab 免费供教学下载 | 网页 + lab 代码包 | 计算机系统（组成/汇编/链接） | ✅ 章节目录 | 3e (2015) |
| 16 | Nand2Tetris | nand2tetris.org | —（网站） | **非营利设置下 free & open-source**（官网明文） | 网页 + PDF 讲义 + 项目 | 组成原理/体系结构（NAND→CPU→OS） | ✅ 官网 syllabus | 持续 |
| 17 | MIT OCW 6.006 | ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/ | —（课程） | OCW 全站 CC BY-NC-SA（未逐页核） | 网页 + PDF 讲义/习题 | 算法 | ✅ | 2020 |
| 18 | MIT OCW 6.1810（原6.828） | ocw.mit.edu/courses/6-1810-operating-system-engineering-fall-2023/ | —（课程） | OCW 全站 CC BY-NC-SA（未逐页核） | 网页 + PDF 讲义 | OS 工程（xv6） | ✅ | 2023 |
| 19 | MIT 6.824/6.5840 分布式 | pdos.csail.mit.edu/6.824/（OCW 页已 404） | —（课程） | 课程页公开，license 未核 | 网页 + PDF 讲义 | 分布式系统 | ✅ | 2024 |
| 20 | Teach Yourself CS | teachyourselfcs.com（中文译 github.com/keithnull/TeachYourselfCS-CN） | —（书单站） | 站内推荐清单（无内容 license 问题） | 网页 | 九大主题选书/选课指南 | ✅ 主题大纲 | 2020-05 |

**载体形态速判**：直接可用（md）＝ #1 #3 #9 #10 #11 #13 #14；PDF 需转换＝ #2（有文本层可 pdftotext）＋ OCW/Nand2Tetris/OSTEP 讲义（均有文本层）；只可参考大纲＝ #4 #6 #7 #8 #12 #15 #19；纯网页/书单＝ #20。

## §2 许可可用性裁决（逐份）

| # | 资源 | license | 能否放进我们的开源仓库 | 备注 |
|---|---|---|---|---|
| 1 | cs-self-learning | MIT | ✅ **可搬正文** | 保留版权声明即可 |
| 2 | cs-408 | MIT | ✅ **可搬正文**（转换后） | 真题文件来源需再核；正文为 OneNote PDF |
| 3 | Missing Semester | CC BY-NC-SA 4.0 | ⚠️ **可搬，但传染**：仓库须整体改为 CC BY-NC-SA 且**不可商用** | 若项目要 MIT/Apache 对外则改「只链不搬」 |
| 4 | bottomupcs | 无 license | 🔴 **只可参考大纲，不搬正文** | 默认版权保留；要搬须书面联系作者 Ian Wienand |
| 5 | OSTEP 书 | 免费但无 license 文件 | 🔴 **只链不搬**（作者明文 link, don't copy） | 课程表可引用章节链接；正文让学生上官网读 |
| 6-8 | OSTEP 配套仓库 | 无 license | 🔴 代码/项目说明**只可作链接与参考** | 无 license = 保留所有权利 |
| 9 | CS-Notes | 无 license | 🔴 **只可参考知识点大纲，不搬正文** | 无 license = 保留所有权利 |
| 10 | THU-CST-Cracker | MIT | ✅ **可搬正文**（md 笔记/大纲） | 试卷含学校版权材料的文件单独核 |
| 11 | PKUCourse | 无 license | 🔴 只可参考大纲 | 同上 |
| 12 | Data-Structres | MIT | ✅ **可搬代码**（作作业/示例） | 代码类素材最佳来源之一 |
| 13 | 408CSFamily | GPL-3.0 | ⚠️ **可搬，但传染**：仓库须整体 GPL-3.0 | 若整体许可未定则先参考大纲 |
| 14 | CSPostgraduate-408 | 无 license | 🔴 只可参考大纲 | 真题来源单独核 |
| 15 | CSAPP 书/lab | 版权保留 | 🔴 书不可搬；lab 免费供教学使用（**链接下载**，不随仓库分发） | 讲义/图不可复制 |
| 16 | Nand2Tetris | 非营利 free | ✅ **可搬（仅限非营利场景）** | 官网明文 free & open-source in non-profit setting；书本身商业 |
| 17-19 | MIT OCW 课程 | OCW 全站 CC BY-NC-SA | ⚠️ **可搬（NC 传染）** | 与 #3 同样传染问题 |
| 20 | Teach Yourself CS | 书单推荐 | ✅ 引用其推荐结构即可（非内容源） | 无 license 负担 |

**总原则**：🔴 **无 license ≠ 可自由使用**（默认保留所有权利，参考大纲可以、搬正文不行）；**GPL/CC-BY-SA/CC-BY-NC 类均「传染」**——搬入前必须先定我们仓库的整体许可；**MIT 是唯一「搬了还能保持自家许可干净」的类别**（#1 #2 #10 #12）。

## §3 🔴 推荐组合（按「可复用度 ÷ 需要自己写的量」排序）

### 组合 A：操作系统教室 · OSTEP 大纲 + 自写正文（推荐首间教室）
- **课程**：操作系统（408 考纲四门之一 + 美式核心课，OSTEP 章节化最清晰、免费、受众最大）。
- **正文来源**：OSTEP 官网免费 PDF **只链不搬**（课程表每讲挂章节链接，学生在线读）；正文文字由 AI 按苏格拉底脚本自写（大纲有、原文链有，写自己的版本合法又省事）。
- **大纲来源**：OSTEP 章节目录（官网首页一次抓取即可得全部章节标题）+ cs-self-learning 的 `docs/操作系统/` 课程表（MIT 可搬）。
- **作业来源**：ostep-projects（链）、Data-Structres 代码（MIT 可搬）。
- **需要自己写**：① 每讲的苏格拉底提问脚本（项目核心资产，本来就自写）；② 课程表（把 OSTEP 50+ 章裁剪为 12-16 讲）；③ 角色与故事线；④ OSTEP 原文「摘要卡片」由 AI 生成（不复制原文）。
- **自写量**：中（正文要重写为问答形式，但素材全免费可得）。

### 组合 B：计算机组成教室 · Nand2Tetris 全免费（第二间教室 / 或首间备选）
- **课程**：计算机组成原理/体系结构（从 NAND 到可运行的程序，408「组成原理」的趣味版本）。
- **正文来源**：nand2tetris.org 讲义（PDF slide）+ 项目材料——**官网明文非营利设置下 free & open-source，可直接搬**。
- **大纲来源**：官网 extended syllabus（Google Drive PDF）+ 13 周项目排期（现成）。
- **需要自己写**：① 苏格拉底提问脚本；② 把「从零造一台计算机」写成故事线（NAND 之门 → ALU → 内存 → CPU → 汇编 → 俄罗斯方块，天然剧情递进）；③ 课程表（官网已给，裁剪即可）。
- **自写量**：少（讲义、项目、大纲全免费现成；唯一代价是**非营利**属性，正好匹配开源项目）。

### 组合 C：数据结构教室 · 中文 408 硬核（第三间教室 / 中文用户首选）
- **课程**：数据结构（考研 408 第一门，中文受众最大、痛点最具体）。
- **正文来源**：`ddy-ddy/cs-408` 的 1数据结构 章 PDF（MIT，pdftotext 有文本层，公式需清理）；或 `408CSFamily` 的 ds/ md（GPL-3.0，搬则整体传染）。
- **大纲来源**：cs-408 章节目录（现成 8 章）+ THU-CST-Cracker 清华数据结构课（MIT）。
- **代码/作业**：`callmePicacho/Data-Structres`（MIT，3,915★ 上课 Demo 直接可用）。
- **需要自己写**：① PDF→md 转换与公式清理（cs-408 载体为 OneNote PDF，工作量最大）；② 苏格拉底脚本；③ 课程表。
- **自写量**：多（多一步转换清理）。

**组合排序说明**：A 的正文「重写」最贴合项目调性且零版权风险；B 的复用率最高但主题偏「组成」而非考研四门主线；C 主题最主流但多一步 PDF 转换。**若只做一间教室 → 组合 A；若要「可画图、30 分钟见效」的第一节课 → 组合 B；若目标用户是中文考研党 → 组合 C。**

## §4 第一节课选题候选

| 组合 | 第一节课选题 | 明确痛点 | 可画图内容 | 30 分钟「我懂了」瞬间 |
|---|---|---|---|---|
| A（OS） | **「进程与并发：为什么两个程序同时跑会互相捣乱？」** | 电脑卡顿/多任务互相干扰 | 进程状态图、单核时间片轮转时序图 | 「一个 CPU 只能做一件事 → 时间片轮转让它们『看起来』同时跑」，配咖啡机排队类比 |
| A 备选 | 虚拟内存「地址空间」 | 内存不够用 / 程序崩溃越界 | 地址转换图、页表 | 「每个程序都假装独占 4GB」→ 页表映射瞬间通透 |
| B（组成） | **「从 NAND 到加法器：计算机怎么算 1+1？」** | 电脑凭什么会计算 | 真值表、NAND→XOR→半加器→全加器连线图 | 用 NAND 门拼出加法器，「计算」不再是黑魔法 |
| C（DS） | **「为什么数组插入很慢：链表 vs 数组」** | 排队插队要挪所有人 | 内存连续 vs 分散布局图、指针跳跃图 | 连续存储要整体搬移 vs 链表只改一个指针，复杂度 O(n) vs O(1) 直观可见 |

判据复核：以上四题均有①明确痛点（人人可感知）②可画图（状态图/真值表/内存布局）③30 分钟内可闭环（一个类比 + 一张图 + 一个「啊原来如此」）。

## §5 未找到 / 需人工确认

- **MIT 6.824/6.5840 的 OCW 页面 404**（6-824-spring-2020 与 6-5840-fall-2024 均 404）——该课讲义现址为 `pdos.csail.mit.edu/6.824/`（课程页，license 未核）。
- **REKCARC-TSC-UHT（清华课程攻略旧名）404**——该仓库名已不可用，正确仓库为 `Salensoft/thu-cst-cracker`（3,068★ MIT）。
- **nand2tetris GitHub org 下无主教材仓库**（仅 simulator/web-ide/projects，共 307★）——教材材料全在官网 nand2tetris.org。
- **北大/上交/浙大课件仓库**：北大查到 `tongtzeho/PKUCourse`（2,548★ 无 license）；上交/浙大未单独查（时间预算，见待确认）。
- **cs-408 与 CSPostgraduate-408 的「真题」文件版权来源**：未逐文件核，标注需人工确认。

## §6 待确认清单

1. 【需用户拍板】**我们仓库的整体 license 是什么？**——决定 #3/#13/#17-19（CC BY-NC-SA / GPL-3.0）能否搬正文，还是全部「只链不搬」。倾向：开源教育项目若允许非商业 + 相同方式共享，CC BY-NC-SA 资源可入；否则只用 MIT 类。
2. 【需人工核】OSTEP 正文「只链不搬」是否严格执行——官网原文明确「link to them directly (instead of making a copy locally)」，建议课程表链接、正文自写。
3. 【需人工核】MIT OCW 各课程页 footer 的 license 标注（未逐页抓取，按全站 CC BY-NC-SA 理解）。
4. 【推断】`ddy-ddy/cs-408` 正文 PDF 系 OneNote 导出（文件内含「2022年11月1日 星期二 22:36」时间戳），非扫描件，pdftotext 可提取但公式/排版需清理。
5. 【未查】`Salensoft/thu-cst-cracker`、`142vip/408CSFamily`、`callmePicacho/Data-Structres` 的最近更新日期（pushed_at 未逐项抓取）。
6. 【未查】上交/浙大公开课件仓库（本次未检索，可下轮补）。

## §7 来源与可复跑命令

```bash
# 仓库元数据（stars/license/language/pushed_at）
gh api repos/PKUFlyingPig/cs-self-learning --jq '{stars:.stargazers_count,license:.license.spdx_id,language,pushed_at}'
gh api repos/ddy-ddy/cs-408 --jq '{stars:.stargazers_count,license:.license.spdx_id}'
gh api repos/missing-semester/missing-semester --jq '{stars:.stargazers_count,license:.license.spdx_id}'
gh api repos/CyC2018/CS-Notes --jq '{stars:.stargazers_count,license:.license.spdx_id}'
gh api repos/Salensoft/thu-cst-cracker --jq '{stars:.stargazers_count,license:.license.spdx_id}'
gh api repos/callmePicacho/Data-Structres --jq '{stars:.stargazers_count,license:.license.spdx_id}'
gh api repos/142vip/408CSFamily --jq '{stars:.stargazers_count,license:.license.spdx_id}'
gh api repos/CodePanda66/CSPostgraduate-408 --jq '{stars:.stargazers_count,license:.license.spdx_id}'
gh api repos/ianw/bottomupcs --jq '{stars:.stargazers_count,license:.license.spdx_id}'
gh api repos/tongtzeho/PKUCourse --jq '{stars:.stargazers_count,license:.license.spdx_id}'
gh search repos "ostep" --limit 8 --json fullName,stargazersCount,license   # 定位 OSTEP 配套仓库
gh api "orgs/nand2tetris/repos?per_page=100" --jq '.[]|{name,stars:.stargazers_count}'  # nand2tetris org 无主教材仓库
gh search repos "Data-Structres" --limit 5 --json fullName,stargazersCount,license  # 核实 3,915★
# 文件形态
gh api repos/ddy-ddy/cs-408/contents/1数据结构 --jq '.[].name'          # 8 章 PDF
gh api repos/PKUFlyingPig/cs-self-learning/contents/docs --jq '.[].name' # 30+ 课程 md
gh api repos/142vip/408CSFamily/contents/docs --jq '.[].name'
gh api repos/Salensoft/thu-cst-cracker/contents/大一上 --jq '.[].name'
gh api repos/missing-semester/missing-semester/contents/README.md --jq '.content' | base64 -d | grep -i license  # CC BY-NC-SA 4.0
# 官网版权原文（经 r.jina.ai 通道）
curl -sL "https://r.jina.ai/https://pages.cs.wisc.edu/~remzi/OSTEP/" | grep -i "always be free\|link to them directly"   # OSTEP「免费但只链不搬」
curl -sL "https://r.jina.ai/https://www.nand2tetris.org/" | grep -i "non-profit"                                          # Nand2Tetris「非营利 free」
curl -sL "https://r.jina.ai/https://www.teachyourselfcs.com/" | head -c 1200                                            # 书单站（非内容源）
# OCW 课程页可用性
for u in "https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/" \
         "https://ocw.mit.edu/courses/6-1810-operating-system-engineering-fall-2023/"; do \
  curl -sL -o /dev/null -w "%{http_code} $u\n" --max-time 15 "$u"; done
# cs-408 PDF 文本层实测
curl -sL "https://raw.githubusercontent.com/ddy-ddy/cs-408/master/1%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84/%E8%83%8C%E8%AF%B5%E7%9F%A5%E8%AF%86%E7%82%B9.pdf" -o /tmp/cs408_test.pdf
pdftotext /tmp/cs408_test.pdf - | wc -c   # 363 字符 → 有文本层，非扫描件
```

**已核实的 URL 关键原文**：
- OSTEP：`pages.cs.wisc.edu/~remzi/OSTEP/`（"is and will always be free in PDF form"；"INSTRUCTORS: please just link to them directly (instead of making a copy locally)"）
- Nand2Tetris：`nand2tetris.org`（"Everything is free and open-source, as long as you operate in a non-profit setting"）
- Missing Semester：`github.com/missing-semester/missing-semester` README（"licensed under CC BY-NC-SA 4.0"）
- CSAPP：`csapp.cs.cmu.edu`（"Copyright © 2015, Randal E. Bryant and David R. O'Hallaron"）
