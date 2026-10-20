# 证据 05 · 补充发现（超出"链接清单"范围，但对本项目直接有用）

> 任务代号 **L2D-LINKS**。本件是找链接时**顺手撞到的同类现成实现**，按项目规矩「**技术选型第一步先读现成实现（prior art）**」单独落一份，供父代理决定是否另开一轮。
> 🔴 本件**只给链接与原文**，不评价、不判断。

---

## 1. 🔴 已经有人把「动漫角色立绘 + 语音 + 长期记忆」做进 DeepSeek Harness 了

### 1.1 `hg4/sakiko-for-dsh`（豊川祥子 · BanG Dream!）

| 项 | 内容 |
|---|---|
| 仓库 | https://github.com/hg4/sakiko-for-dsh |
| README 逐字 | 「把 **豊川祥子**（とがわ さきこ /《BanG Dream! It's MyGO!!!!!》《BanG Dream! Ave Mujica》）请进 DeepSeek Harness：iPhone 风格的浮窗面板 + Live2D 立绘 + 日语语音 + 长期记忆 + 多会话播报。」 |
| 实测顶层结构 | `assets/`／`config/`／`docs/`／`persona/`／`plugin/web/`／`skills/`／`test/`／`tools/` ＋ `client.js`／`client.mjs`／`cordis.patch.yml`／`host.mjs`／`index.js`／`package.json`／`THIRD-PARTY.md`／`LICENSE`／`NOTICE`／`README.md` |
| 关键机制（README 逐字） | 「**浮窗面板** —— iPhone 直板风格，常驻 Web 界面」；「**Live2D 立绘** —— 豊川祥子模型；表情与动作由**文本情绪驱动**，另有**标定模式**可微调位置与缩放」；语音通道 `aqua`／`edge`／`voicevox`／`openai`；「**语音服务自管理** —— `dsh web` 启动时自动拉起 GPT-SoVITS api 与协议桥，退出时一并回收」 |
| 上游 | https://github.com/yyxcnasd/amadeus-for-dsh （《命运石之门 0》牧濑红莉栖；README 逐字「MIT」） |
| 上游安装方式（README 逐字） | `dsh plugin --profile desktop add github:yyxcnasd/amadeus-for-dsh` ／ `dsh plugin --profile web add github:yyxcnasd/amadeus-for-dsh`；README 逐字说明「仓库根即 npm 包（`amadeus-for-dsh`，声明了 `dsh.bundle.patch`）」 |
| 免责声明（README 逐字，本件照抄不解读） | 「**非官方二创作品。** 本项目是基于上游插件的二次开发，与 BanG Dream! Project、株式会社ブシロード、Craft Egg Inc.、Ave Mujica 及相关权利方**没有任何关联**，未获其授权或认可。仅供个人学习与技术交流，**不得用于任何商业用途**。」「6. **立绘素材**：Live2D 模型来自网络公开的粉丝制作资源，版权归原作者。」 |

> 📌 与本项目的关系（**只陈述事实，不判断**）：本项目 DSH 定制线正在做「教室 + 立绘 + 多角色」；上面两个仓库**恰好是同一宿主（DSH）上已跑通的"角色面板 + Live2D 立绘 + TTS + 记忆"实现**，且用的是 `dsh plugin add github:` 的装载方式。
> ⚠️ 与项目铁律的交叉点：本项目已立「**插件绝不能把宿主核心包装进 profile**」「**本地包用 `file:` 装**」两条铁律（见 AGENTS.md 工具链表）；上面两个仓库的 `package.json`／装载方式**本轮未读**，未做任何判断。

---

## 2. BanG Dream! 立绘：本轮新找到的**比任务书三个仓库更直接**的入口

| 仓库 | 是什么 | 链接 | 拿模型的方式 |
|---|---|---|---|
| `haneoka-gakuen/bangdream-live2d` | 按角色/服装全量分目录的 BanG Dream Live2D 集合（默认分支 `live2d`） | https://github.com/haneoka-gakuen/bangdream-live2d/tree/live2d/live2d/chara | 普通 git 仓库，README 未写下载方式 |
| `HELPMEEADICE/BANDORI-PET-REV` | 51 角色／305+ 服装；**模型在 ModelScope/网盘，不在仓库** | https://github.com/HELPMEEADICE/BANDORI-PET-REV | 下 `models.zip`(~900MB) 或 `models.7z`(~4GB)，见证据 02 §2.2 |
| `A-kirami/bestdori-live2d-downloader` | 从 Bestdori 拉模型的 CLI（Go） | https://github.com/A-kirami/bestdori-live2d-downloader | Releases 下可执行文件，或 `go build` |
| `panxuc/live2d-widget-mygo` | 网页 Live2D widget（MyGO!!!!!） | https://github.com/panxuc/live2d-widget-mygo | 直接引 JS/CSS；模型来自 Bestdori＋Eikanya |
| `seia-soto/BanG-Dream-Live2D` | 从 `bandori.makoo.eu` 下载的存档 | https://github.com/seia-soto/BanG-Dream-Live2D | README 未写 |

**Bestdori（BanG Dream 模型的上游来源）**：https://bestdori.com/ —— 实测 200；`A-kirami` 的下载器默认从 `https://bestdori.com/assets/` 与 `https://bestdori.com/api/characters` 取。

---

## 3. 初音ミク立绘：本轮新找到的入口

| 仓库 | 是什么 | 链接 | 拿模型的方式 |
|---|---|---|---|
| `xiaocaoooo/PJSKLive2DModel` | PJSK（世界计划，含初音ミク）Live2D 下载器 | https://github.com/xiaocaoooo/PJSKLive2DModel | `python main.py`，源站 `https://storage.sekai.best` |
| `wasd09090030/live2Dpet_Miku` | 仓库内自带 PJSK Miku 模型 `Model/21miku_normal_3.0_f_t03` | https://github.com/wasd09090030/live2Dpet_Miku | `git clone` 即得 |
| `Untitled-Story/untitled-sekai-live2d-viewer` | 浏览器预览 + ZIP 导出 | https://github.com/Untitled-Story/untitled-sekai-live2d-viewer | 需自备本地模型服务器 |
| `Sekai-World/sekai-live2d-updater` | 抓取/更新 PJSK Live2D | https://github.com/Sekai-World/sekai-live2d-updater | `uv run python main.py config.jp.py` |
| `Untitled-Story/MySekaiStoryteller` | Live2D 剧情阅读工具（60 star） | https://github.com/Untitled-Story/MySekaiStoryteller | README 未写 |
| `Moelimoe/snow_miku_live2d` | 雪ミク Live2D | https://github.com/Moelimoe/snow_miku_live2d | **无 README** |

**PJSK 模型命名规律（事实，来自两个仓库的自述／结构）**：初音ミク的模型目录名以 `21miku` 开头（`wasd…` 仓库逐字 `21miku_normal_3.0_f_t03`；`xiaocaoooo` README 举例 `20mizuki_cloth001`，前缀两位数字为角色号）。

---

## 4. 本轮**没有**做的事（边界声明）

- 未 clone 任何仓库；未下载任何模型包（900MB／4GB／17G 三类都没碰）；只下载了官方那个 41.7MB 的 Miku zip 用于**验证下载入口真实存在**（解包清单已记入证据 03，zip 本身留在 `/tmp`，未入工作区）。
- 未读 `sakiko-for-dsh`／`amadeus-for-dsh` 的源码与 `package.json`（只读了 README 与顶层目录名）。
- 未做任何法律／许可解读。
