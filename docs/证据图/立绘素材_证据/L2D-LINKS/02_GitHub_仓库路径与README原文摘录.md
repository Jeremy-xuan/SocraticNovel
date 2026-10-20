# 证据 02 · GitHub 仓库：BanG Dream! 与 Miku 的具体路径 ＋ README 原文摘录

> 任务代号 **L2D-LINKS**，2026-09-24 实测。
> 🔴 本件**只摘录原文、只给链接与路径**，不解读、不判断。
> 🔴 **未 clone 任何仓库**（17G 那种一律不碰）；目录是否存在是靠 **GitHub REST API（contents / git trees）＋ raw README** 核出来的。
> ⚠️ 实测坑：GitHub REST API 未登录额度 **60 次/小时**，本轮**用光后被 429/403 挡住**，后续改用 **raw.githubusercontent.com 取 README ＋ github.com 页面内嵌 JSON 取目录树** 绕过。

---

## 0. 先给结论表（本轮实测的"哪个仓库有什么"）

| 仓库 | BanG Dream! | 初音ミク | 备注 |
|---|---|---|---|
| `imuncle/live2d` | ❌ 无（全量 tree 检索 `bang` 零命中） | ✅ **有**（`model/miku`、`model/snow_miku`） | 老格式 Cubism 2（`.moc`） |
| `Eikanya/Live2d-model` | ✅ **有**（`BanG Dream!` 顶层目录） | ❌ 无（检索 `hatsune`／`初音` 零命中） | 名字含 miku 的两个目录**不是**初音本体，见 §2.3 |
| `violet-wdream/GamesArchive` | ❌ 无 | ❌ 无（检索 `miku`／`hatsune` 零命中） | 17G，11 个游戏目录 |
| 🆕 `haneoka-gakuen/bangdream-live2d` | ✅ **有**（按角色／服装全量分目录） | ⚠️ 只有"角色穿 Miku 联动服装"的目录 | 默认分支 = `live2d` |
| 🆕 `HELPMEEADICE/BANDORI-PET-REV` | ✅ **有**（51 角色／305+ 服装） | ❌ 无 | **模型不在仓库里**，走网盘／ModelScope |
| 🆕 `A-kirami/bestdori-live2d-downloader` | ✅ 下载器（源站 Bestdori） | ❌ 无 | Go，Releases 有可执行文件 |
| 🆕 `seia-soto/BanG-Dream-Live2D` | ✅ 有（README 一句话） | ❌ 无 | README 全文 3 行 |
| 🆕 `xiaocaoooo/PJSKLive2DModel` | ❌ 无 | ✅ **有**（PJSK 含初音ミク，源站 `storage.sekai.best`） | Python 下载器 |
| 🆕 `wasd09090030/live2Dpet_Miku` | ❌ 无 | ✅ **有**（仓库内自带一个 PJSK Miku 模型） | Electron 桌宠 |
| 🆕 `Untitled-Story/untitled-sekai-live2d-viewer` | ❌ 无 | ✅ 预览＋ZIP 导出 | Next.js |
| 🆕 `Sekai-World/sekai-live2d-updater` | ❌ 无 | ✅ 抓取/更新 | README 仅 3 行 |
| 🆕 `panxuc/live2d-widget-mygo` | ✅ 有（MyGO!!!!!，模型来自 Bestdori＋Eikanya） | ❌ 无 | 网页 widget |
| 🆕 `hg4/sakiko-for-dsh` | ✅ 有（豊川祥子，**DSH 插件**） | ❌ 无 | 上游 `yyxcnasd/amadeus-for-dsh` |

---

## 1. 任务书点名的三个仓库

### 1.1 `imuncle/live2d` —— **Miku 在这里**

- 仓库：https://github.com/imuncle/live2d
- **Miku 目录（Cubism 2 老格式）**：https://github.com/imuncle/live2d/tree/master/model/miku
  - 实测内容（git tree）：`model/miku/miku.model.json`、`model/miku/miku.physics.json`、`model/miku/moc/miku.moc`、`model/miku/moc/miku.2048/texture_00.png`、`model/miku/mtn/miku_idle_01.mtn`＋`miku_m_01…miku_m_06.mtn`＋`miku_shake_01.mtn`
- **雪ミク目录**：https://github.com/imuncle/live2d/tree/master/model/snow_miku
  - 实测内容：`model/snow_miku/model.json`、`model/snow_miku/model.moc`、`model/snow_miku/motions/`
- 模型总目录：https://github.com/imuncle/live2d/tree/master/model —— **实测 GitHub contents API 返回 79 个顶层条目**（README 自述「目前已收录 **102** 种」；两者口径不同，如实并记）
- Cubism 3 版目录：https://github.com/imuncle/live2d/tree/master/live2d_3/model —— 实测**只有 1 个子目录** `Azue Lane(JP)`（碧蓝航线）
- 展示页：https://imuncle.github.io/live2d/live2d_3 （Cubism 3）／ https://imuncle.github.io/live2d （Cubism 2）
- **BanG Dream!：无**（`git/trees?recursive=1` 全量 4,554 条路径检索 `bang` → 零命中）

**README 里"关于使用条件/声明"的原文摘录**（逐字，位于 README 末尾 `# 版权须知` 段）
链接：https://github.com/imuncle/live2d/blob/master/README.md

> 所有模型均收集自互联网，版权均归原公司/个人所有。您可将资源用于学习、非营利性的网站或项目，不得用于商业使用（付费分发售卖资源、二次修改用于盈利等）。

**怎么下载到某个具体模型**（如实写 README 说法）
- README **只给了 `git clone`／整仓下载**这一条路（`# 使用说明` 段讲的是把模型挂到自己的网页上，不是下载渠道）；**没有 Releases、没有网盘链接**。
- 单个模型文件也可以直接在 GitHub 网页上逐个打开下载（`model/miku/…` 点进文件 → Raw）。
- 本轮**没有 clone**。

---

### 1.2 `Eikanya/Live2d-model` —— **BanG Dream! 在这里**

- 仓库：https://github.com/Eikanya/Live2d-model
- **BanG Dream! 目录**：https://github.com/Eikanya/Live2d-model/tree/master/BanG%20Dream!
  - 下面两层结构：`BanG Dream!/asneeded/live2d/chara/<角色号>` 与 `BanG Dream!/startapp/live2d/chara/<角色号>`
  - 实测角色号：`asneeded` = **36 个**（001–035 ＋ 201）／`startapp` = **36 个**（001–035 ＋ 214）
  - 单个角色示例（含 .moc／.model.json／texture／motions/*.mtn）：https://github.com/Eikanya/Live2d-model/tree/master/BanG%20Dream!/asneeded/live2d/chara/001
- **初音ミク：无**
  - 全量 tree（49,377 条路径）检索 `hatsune` → 零命中；检索 `初音` → 零命中。
  - 只有两处目录名含 `miku`：`BanG Dream!/asneeded/live2d/chara/001/001_miku_nocturnality` 与 `…/001_miku_romecin`；其内部文件名为 **`kasumi_miku_nocturnality.moc`／`kasumi_miku_romecin.moc`**（`kasumi` 前缀）。
  - 🔴 如实记录该事实：**文件名前缀显示它们挂在角色 001 名下**，本轮**未判断**它们与初音ミク的关系。
- 其它可见顶层目录（实测 24 项）：`BanG Dream!`／`Live2D`／`Sacred Sword princesses`／`VenusScramble`／`destiny_child_kr 天命之子`／`galgame live2d`／`sin 七大罪～魔王崇拜～`／`アンノウンブライド`／`イモコネー届けたい恋心`／`为美好的世界献上祝福！Fantastic Days`／`凍京Nerco`／`宝石研物语`／`少女前线 girls Frontline`／`少女咖啡枪 girls cafe gun`／`少女次元`／`崩坏学园2`／`战舰少女`／`方舟指令`／`机动战队`／`碧蓝航线 Azue Lane`／`诺亚幻想`／`食物语`／`魂器学院 (炼铜学院)` ＋ `README.md`

**README 原文摘录**（逐字）
链接：https://github.com/Eikanya/Live2d-model/blob/master/README.md

> 个人收集的Live2d模型，一般提取自游戏中，手游居多。手游的Live2d，音频资源一般有加密，解密方法来源与网络上。

> 注意LICENSE,请勿作商业用途。

**怎么下载到某个具体模型**（README `**下载** **Download**` 段，逐字）
- 「文件较多，可以使用 GitZip，选择单个文件夹下载。」→ GitZip：https://gitzip.org/ ／ FastGit：https://fastgit.org/
- 或整仓 clone，README 逐字给出：
  ```
  git config --global http.postBuffer 40480M
  git config --global https.postBuffer 40480M
  git clone https://github.com/Eikanya/Live2d-model
  ```
- **没有 Releases、没有网盘**。本轮**没有 clone**。

**⚠️ README 内一处已失效链接（如实记）**：README 末尾给的「碧蓝航线Live2d在线预览」仍是 `https://l2d.alg-wiki.com/` —— 该域名**已失效**（前轮 L2D-SRC-2 已实测：现在打开是域名停放页）。

---

### 1.3 `violet-wdream/GamesArchive` —— **两个角色都没有**

- 仓库：https://github.com/violet-wdream/GamesArchive
- 顶层实测 11 个游戏目录：`AoLaXing`／`AoQiChuanShuo`／`GirlCafeGun2 (ShuangShengShiJie)`／`HuanXiangMingJiangLu (SanGuoAnother)`／`IronSaga`／`MorningMist`／`OnePercent (BaiFenZhiYi)`／`SanGuoZhiHuanXiangDaLu`／`SanGuoZhiHuanXiangDaLu2`／`Sinisistar2`／`TheMoonlitOath (HuaYiShanXinZhiYue)` ＋ `README.md`／`LICENSE`／`.github`
- **BanG Dream!：无**（全量 tree 50,464 条路径检索 `bang` → 命中全是动作文件名如 `dianjianbang.motion3.json`）
- **初音ミク：无**（检索 `miku`／`hatsune` → 零命中）

**README 原文摘录**（逐字，`## 🤓 Disclaimer` 段）
链接：https://github.com/violet-wdream/GamesArchive/blob/main/README.md

> All game data and assets in this repository are collected from **publicly available sources on the Internet**.
>
> This project is for **archival, research, and educational purposes only**.
>
> All copyrights belong to their respective owners.
> No commercial use is intended.
>
> If you are a copyright holder and believe any content in this repository should be removed, please open an issue or contact me.

同 README 的仓库信息表逐字：`Repo Size | 17G`、`Last Updated | 2026-04-06`。

**怎么下载**（README 逐字，中文段）
> 可以配合[DownGit](https://minhaskamal.github.io/DownGit/#/home)/[Gitzip](…)分目录下载，但是解析文件过多时会失败，**同时不建议下载整个仓库**。

→ 即：**只支持分目录下载**，作者本人不建议整仓下载。本轮**没有 clone**。

---

## 2. 🆕 本轮新发现的、**直接对得上**用户要的两个角色的仓库

> 任务书点名的是上面三个；但用户要的是"**BanG Dream 和 miku**"。本轮顺手在 GitHub 上搜了同类仓库，下面这些**比上面三个更直接**，一并给出（只给链接＋原文，不判断）。

### 2.1 `haneoka-gakuen/bangdream-live2d` —— BanG Dream! 全量按角色／服装分目录

- 仓库：https://github.com/haneoka-gakuen/bangdream-live2d （**默认分支是 `live2d`，不是 main/master**）
- 角色目录：https://github.com/haneoka-gakuen/bangdream-live2d/tree/live2d/live2d/chara
  - 实测该层 `totalCount` = **3,640 个目录**（页面单次返回前 1,000 条），命名形如 `001_general_rip`／`001_live_event_343_ur_rip`／`002_casual_rip`…（前缀是角色号 000–0xx，后缀是服装/卡面名）
  - 单个示例：https://github.com/haneoka-gakuen/bangdream-live2d/tree/live2d/live2d/chara/001_general_rip
  - 另有 `live2d/_info.json`：https://github.com/haneoka-gakuen/bangdream-live2d/blob/live2d/live2d/_info.json
- **名字含 `miku` 的目录**（本轮实见，共 **14 个**，均在角色号下）：`001_miku_nocturnality_rip`、`001_miku_romecin_rip`、`002_miku_nocturnality_rip`、`002_miku_romecin_rip`、`003_miku_nocturnality_rip`、`003_miku_romecin_rip`、`004_miku_nocturnality_rip`、`004_miku_romecin_rip`、`005_miku_nocturnality_rip`、`005_miku_romecin_rip`、`006_miku_lostone_rip`、`007_miku_lostone_rip`、`008_miku_lostone_rip`、`009_miku_lostone_rip`（🔴 只记目录名，**不判断其内容归属**）

**README 原文摘录**（逐字）
链接：https://github.com/haneoka-gakuen/bangdream-live2d/blob/live2d/README.md

> This repository contains a collection of Live2D models for the characters from [*BanG Dream! Girls Band Party!*](https://bang-dream.bushimo.jp/).
>
> This repository has no affiliation with [*BanG Dream! Project*](https://bang-dream.com/) or [*Bushiroad*](https://bushiroad.com/).

> This repository will try to update itself every Sunday and Wednesday.
>
> All files are from [Bestdori](https://bestdori.com/), please consider [supporting them](https://bestdori.com/home/support).

**怎么下载**：README **没写下载方式**（无 Releases、无网盘说明）；结构就是普通 git 仓库 → 网页单目录下载或 clone。本轮**没有 clone**。

---

### 2.2 `HELPMEEADICE/BANDORI-PET-REV` —— 51 角色／305+ 服装（**模型不在仓库里**）

- 仓库：https://github.com/HELPMEEADICE/BANDORI-PET-REV （422 star，最后推送 2026-09-15）
- 实测顶层**没有 `models/` 目录** → 模型确实要另外下载（与 README 一致）
- README 逐字：「支持 **51+ 位** BanG Dream! 角色、**305+ 套**服装」；「本项目代码基于 [GPLv3](LICENSE) 开源。」

**模型下载渠道（README 表格逐字，本轮照抄，未验证文件内容）**

| 包 | 渠道 | 链接 |
|---|---|---|
| zstd 流式包 ~900MB | ModelScope | https://modelscope.cn/datasets/HELPMEEADICE/BanG-Dream-Live2D/resolve/master/models.zip |
| zstd 流式包 ~900MB | Google Drive | https://drive.google.com/file/d/1rSwE6oHIyESYmbF7B_GtogAVbjASyBb9 |
| zstd 流式包 ~900MB | 百度网盘 | https://pan.baidu.com/s/1oapb5rxt1Qz5nRkyb3XZtw?pwd=3724 （提取码 `3724`） |
| 传统 7z 包 ~4GB | ModelScope | https://modelscope.cn/datasets/HELPMEEADICE/BanG-Dream-Live2D/resolve/master/models.7z |
| 传统 7z 包 ~4GB | Google Drive | https://drive.google.com/file/d/1qX9rEhBviT5auwCLg7g3klBbT5wAbjnL |
| 传统 7z 包 ~4GB | 百度网盘 | https://pan.baidu.com/s/17GAJy2_WEZZbdVdZAMfXHQ?pwd=3724 （提取码 `3724`） |

**README 原文摘录**（逐字，紧贴标题的引用块）
链接：https://github.com/HELPMEEADICE/BANDORI-PET-REV/blob/main/README.md

> **⚠️ 免责声明：本项目仅供学习交流使用。角色模型版权归原作者及版权方所有，请勿用于商业用途。详情见 [DISCLAIMER.md](DISCLAIMER.md)。**

同 README `## 📄 许可` 段逐字：

> 本项目代码基于 [GPLv3](LICENSE) 开源。
>
> 角色模型、贴图、动作等资源文件版权归原版权方所有，请勿用于商业用途。

**另有独立 `DISCLAIMER.md`**（较长，含 §2 版权归属、§6 法律合规风险等九节）：https://github.com/HELPMEEADICE/BANDORI-PET-REV/blob/main/DISCLAIMER.md
其中 §2 逐字：「本项目代码基于 [GPLv3](LICENSE) 协议开源，但**模型资源文件不包含在该开源许可范围内**。」

---

### 2.3 `A-kirami/bestdori-live2d-downloader` —— 从 Bestdori 直接下 BanG Dream 模型

- 仓库：https://github.com/A-kirami/bestdori-live2d-downloader
- README 逐字：「一个用于从 Bestdori 下载 BanG Dream! 游戏中 Live2D 模型的命令行工具。」
- 内置源站（README 配置表逐字）：`BaseAssetsURL` 默认 `https://bestdori.com/assets/`；`CharaRosterURL` = `https://bestdori.com/api/characters`；`AssetsIndexURL` = `https://bestdori.com/api/assets`
- **怎么下载**：① Releases 页直接下可执行文件 https://github.com/A-kirami/bestdori-live2d-downloader/releases ；② 或 `go build -o bestdori-live2d-downloader cmd/bestdori-live2d-downloader/main.go`
- README 许可证行逐字：「Code: MIT, 2025, Akirami」（**这是代码的许可声明**）

### 2.4 `seia-soto/BanG-Dream-Live2D`

- 仓库：https://github.com/seia-soto/BanG-Dream-Live2D
- README **全文只有三行**（逐字，`blob/master/README.md`）：
  > # BanG-Dream-Live2D
  > Lived2D models downloaded from `http://bandori.makoo.eu`.
  > ## Table of Contents
  > - none
- → **README 里没有"使用条件"声明**（记为「没写」）。下载方式 README 未写。

### 2.5 `panxuc/live2d-widget-mygo`

- 仓库：https://github.com/panxuc/live2d-widget-mygo ／ 示例页 https://live2d-widget-mygo.vercel.app/
- README 原文摘录（逐字，两条互相独立）：
  > 该项目模型来自[Eikanya/Live2d-model](https://github.com/Eikanya/Live2d-model)，仅供学习交流，请勿用于商业用途，如有侵权，请联系删除。
  > 本项目模型来自[Bestdori](https://bestdori.com/)提供的《梦想协奏曲！少女乐团派对！》游戏数据包资源。…**仅供学习交流，请勿用于商业用途，如有侵权，请联系删除**。

### 2.6 `hg4/sakiko-for-dsh` —— 🔴 **本轮的额外收获：已经有人把 BanG Dream 立绘做进 DSH 了**

- 仓库：https://github.com/hg4/sakiko-for-dsh
- README 逐字（开头）：「把 **豊川祥子**（とがわ さきこ /《BanG Dream! It's MyGO!!!!!》《BanG Dream! Ave Mujica》）请进 DeepSeek Harness：iPhone 风格的浮窗面板 + Live2D 立绘 + 日语语音 + 长期记忆 + 多会话播报。」
- 实测顶层结构：`assets/`／`config/`／`docs/`／`persona/`／`plugin/web/`／`skills/`／`test/`／`tools/` ＋ `client.js`／`client.mjs`／`cordis.patch.yml`／`host.mjs`／`index.js`／`package.json`／`THIRD-PARTY.md`／`LICENSE`／`NOTICE`／`README.md`
- README 免责声明原文摘录（逐字）：
  > **非官方二创作品。** 本项目是基于上游插件的二次开发，与 BanG Dream! Project、株式会社ブシロード、Craft Egg Inc.、Ave Mujica 及相关权利方**没有任何关联**，未获其授权或认可。仅供个人学习与技术交流，**不得用于任何商业用途**。
  > 6. **立绘素材**：Live2D 模型来自网络公开的粉丝制作资源，版权归原作者。
- **上游**：`yyxcnasd/amadeus-for-dsh`（《命运石之门 0》牧濑红莉栖，README 逐字「MIT」）https://github.com/yyxcnasd/amadeus-for-dsh
  - 安装方式 README 逐字：`dsh plugin --profile desktop add github:yyxcnasd/amadeus-for-dsh`
- 🔴 本条与 L2D-LINKS 的"链接"任务无关，但它**是本项目 DSH 定制线要找的同类现成实现**，见 `05_补充发现_DSH同类插件与更好入口.md`。

---

## 3. Miku 侧：GitHub 上的其它入口（本轮新发现）

### 3.1 `xiaocaoooo/PJSKLive2DModel` —— PJSK（世界计划）Miku 下载器

- 仓库：https://github.com/xiaocaoooo/PJSKLive2DModel
- README 逐字：「🎭 自动化下载《世界计划 彩色舞台！feat. 初音未来》Live2D模型的专业工具」
- 源站（README 逐字）：需可访问 `https://storage.sekai.best`；故障排查表也逐字写「确认可访问 `storage.sekai.best`」
- 产出格式（README 逐字）：`.moc3`／`.model3.json`／`.physics3.json`／`.2048/texture_00.png`／`motions/*.motion3.json`
- **怎么下载**：`git clone` ＋ `pip install aiohttp tqdm` ＋ `python main.py`，交互式输入角色名（README 举例 `mizuki`）或 `all`
- README 免责声明原文摘录（逐字，`## ⚖️ 免责声明` 段）：
  > **重要提示**：本项目仅供学习和研究使用。下载的模型文件版权归原开发商（SEGA/Colorful Palette）所有。请在使用时遵守相关法律法规和服务条款，不得用于商业用途。

### 3.2 `wasd09090030/live2Dpet_Miku` —— 仓库里**自带**一个 Miku 模型

- 仓库：https://github.com/wasd09090030/live2Dpet_Miku
- README 逐字（项目结构段）：`└── Model/21miku_normal_3.0_f_t03/  # Live2D 模型资源`
- README 逐字（`## PS` 段）：`- 模型来源：SeKaiViewer`
- **怎么下载**：`git clone` 整个仓库即可拿到 `Model/` 下的模型（README 未给 Releases／网盘）

### 3.3 `Untitled-Story/untitled-sekai-live2d-viewer` / `Sekai-World/sekai-live2d-updater`

- https://github.com/Untitled-Story/untitled-sekai-live2d-viewer —— README 逐字：「Browse available models from a local asset server」「Download the selected model as a ZIP」；需要本地模型服务器（`/model_list.json` 等）
- https://github.com/Sekai-World/sekai-live2d-updater —— README 全文 3 行，逐字：「Fetch and update Live2D for Project Sekai Colorful Stage」＋ `uv sync`／`uv run python main.py config.jp.py`
- https://github.com/Untitled-Story/MySekaiStoryteller （60 star）—— README 逐字：「A Live2D reading tool in Project SEKAI style」
- https://github.com/yonglanws/SEKAI_Desktop_pet —— 世界计划 Live2D 桌宠
- https://github.com/Moelimoe/snow_miku_live2d —— **无 README**（main/master 均 404）→ 记为「没写」

---

## 4. 本轮"未找到／未查"的

- `imuncle/live2d` 的 **BanG Dream!**：未找到（全量 tree 检索零命中）。
- `Eikanya/Live2d-model`、`GamesArchive` 的 **初音ミク本体模型**：未找到（检索 `hatsune`／`初音`／`miku` 零命中或仅命中服装名）。
- GitHub **Releases 形式的官方 BanG Dream／Miku 模型包**：除 `A-kirami/bestdori-live2d-downloader` 的 Releases（下的是**工具**不是模型）外，本轮**未见**。
- 所有仓库**均未 clone**、**未下载任何模型包**（含 900MB／4GB／17G 那三类）。
