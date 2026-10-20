# 证据 · 来源清单的逐字引句与 URL（2026-09-24）

> 🔴 **本文件只记录"页面里逐字写了什么"与"抓取成功/失败"**。
> **不做条款解读、不做合规判断**——判断与取舍由用户自行研究。
> 抓取通道：`deepresearch_fetch`（jina）／`scrape_webpage`；`github.com` 直连在本会话**解析被拒**（`URL hostname "github.com" resolves to a non-public IP address`），故 GitHub 页面一律走 jina。

---

## 一、类别 A · 可免费下载的 Live2D 模型

### A1 · Live2D 官方 Sample Data Collection（Free Distribution）
- URL：https://www.live2d.com/en/learn/sample/
- 抓取：✅ 成功（`scrape_webpage`，HTTP 200，正文 6,966 字符）
- **该页有没有写明使用条件：有**。正文逐字：

> Before using this data, please review the "Free Material License Agreement" and the "Live2D Cubism Sample Data Terms of Use".

- 该页 H1 逐字：`Live2D Sample Data Collection (Free Distribution)`
- 该页 H3（模型名）共 29 项，逐字清单：
  `ずんだもん`／`Ren Foster`／`Sample for Parameter Controller`／`Kei`／`Niziiro Mao`／`Hiyori Momose`／`Mark-kun`／`Hatsune Miku`／`Jin Natori`／`Haru (receptionist version)`／`Rice Glassfield`／`Miara`／`Tororo & Hijiki`／`Mark-kun (video version)`／`Hiyori Momose (video version)`／`Simple model`／`Epsilon`／`Haru`／`Chitose`／`Shizuku`／`Hibiki`／`Koharu & Haruto`／`Wankoromochi`／`[Collaboration character] Tsumiki Harugasa`／`Unity-chan`／`Izumi`／`Gantzert & Felixander`／`Nito`（＋ `Sample for Parameter Controller`）
- 该页筛选维度逐字：`Use Case`（For avatars／For game apps／For animation／For Free Plan Users）、`Features`、`SDK Support`、`Supported Languages`
- 该页底部把 `nizima` / `nizima LIVE` / `nizima ACTION!!` / `Live2D JUKU` 列为官方服务

### A2 · `Live2D/CubismWebSamples`
- URL：https://github.com/Live2D/CubismWebSamples
- 抓取：❌ **未逐字抓取正文**（本项目 M1 报告已记录其 `Samples/Resources/` 内容与 commit `b1de66b0b1f1cb881d95fb6158622aeb6a2827bd`；本轮**只确认仓库存在**）
- **该页有没有写明使用条件：有（仓库根 `LICENSE.md`；本轮未逐字读该表述——不做许可研究）**

### A3 · 官方 Cubism SDK for Web 包（本项目实际使用）
- URL：https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.5.zip
- 状态：本项目 M1 实测 HTTP 200，20.7 MB；包内 `Core/` 自报 **Core 6.0.1**
- **该页（包内文件）有没有写明使用条件：有**（`Core/LICENSE.md`／`Core/README.md`／`Core/RedistributableFiles.txt`）

### A4 · `fghrsh/live2d_api`
- URL：https://github.com/fghrsh/live2d_api
- 抓取：✅ 成功（jina）
- **该页有没有写明使用条件：有**。README §「版权声明」逐字：

> **API 内所有模型 版权均属于原作者，仅供研究学习，不得用于商业用途**
>
> MIT © FGHRSH

- 该页「目录结构」逐字（模型目录约定）：
```
│ model_list.json // 模型列表
│ ├─model // 模型路径
│ └─GroupName // 模组分组
│   └─ModelName // 模型名称
```
- 该页「添加模型」逐字给出单模型目录形态：`index.json` / `model.moc` / `textures.cache` / `motions/idle_01.mtn…` / `textures/default-costume.png…`
  🔴 **注意：这是 Cubism 2.1 形态（`.moc` ＋ `index.json`），不是 `.moc3` ＋ `model3.json`** → **与我们的渲染宿主不兼容**（§3.1.0）

### A5 · `stevenjoezhang/live2d-widget`
- URL：https://github.com/stevenjoezhang/live2d-widget
- 抓取：未直接抓（搜索结果片段给出 README.en.md 内容）
- **该页有没有写明使用条件：没看**
- 已知逐字（搜索结果片段）：`cdnPath` 默认值 `https://fastly.jsdelivr.net/gh/fghrsh/live2d_api/`

### A6 · nizima（Live2D 官方市场）
- URL：https://docs.nizima.com/en/ ｜ 市场本体 https://nizima.com/ ｜ ❌ https://www.nizima.com/ **抓取失败**
- 抓取：文档站 ✅ 成功（jina）；`www.nizima.com` ❌ `statusCode=0，jina=422; direct=fetch failed`
- **该页有没有写明使用条件：有（间接）**。文档站正文逐字：

> nizima is an official Live2D marketplace where you can sell and purchase illustrations and Live2D data, and request custom-made models.

- 页脚链接逐字：`プライバシーポリシー`（https://www.live2d.jp/terms/privacy/）、`投稿データ利用規約`（https://docs.nizima.com/ai-research-policy/）、`ブランドガイドライン`
- 另有 `License management` 专页（https://docs.nizima.com/en/account/license/）
- 另有 `nizima model specifications`（https://docs.nizima.com/en/model-spec/）

### A7 · 官方样本下载/条款入口（OLV 两份 ReadMe 都指向它）
- URL：https://www.live2d.com/en/download/sample-data/
- 抓取：⚠️ **只拿到 cookie 同意声明**，页面正文未取到（jina）
- **该页有没有写明使用条件：没看**（正文未取到，不臆测）

### A8 · `dist.ayaka.moe`（airi 实际使用的镜像站）
- URL：`https://dist.ayaka.moe/live2d-models/hiyori_free_zh.zip` ／ `https://dist.ayaka.moe/live2d-models/hiyori_pro_zh.zip` ／ `https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-A/AvatarSample_A.vrm`
- 抓取：❌ 本轮**未抓**（只在 airi 的 `vite.config.ts` 里读到这些 URL）
- **该页有没有写明使用条件：没看**
- 🔴 说明：这是 **airi 的一手配置**（`/tmp/airi/apps/stage-web/vite.config.ts:246-249`），**不是本件的推荐**

---

## 二、类别 B · 能在浏览器里跑的其他立绘／角色方案

### B1 · `pixiv/three-vrm`
- URL：https://github.com/pixiv/three-vrm
- 抓取：✅ 成功（jina）
- **该页有没有写明使用条件：有**。README 末尾逐字：
> ## LICENSE
>
> [MIT](https://github.com/pixiv/three-vrm/blob/dev/LICENSE)

### B2 · VRoid Hub
- URL：https://hub.vroid.com/
- 抓取：✅ 成功（jina，正文截断）
- **该页有没有写明使用条件：有**。页脚链接逐字：`Terms of Use`（https://policies.pixiv.net/en.html#vroidhub）／`Guidelines`（https://hub.vroid.com/en/guidelines）／`Content Protection Policy`（https://hub.vroid.com/en/content-protection-policy）
- 页面正文逐字：`Platform for 3D character`；检索标签 `#OC`／`#short_hair`／`#BOOTH`／`#VRoidStudio`／`#VRChat`／`#commission`；部分模型标题带 **`【DL可】`** 标记（例：`【DL可】(全年齢のみ) Sメイド`）
- 页面正文提到它自己的 `API`（https://developer.vroid.com/en/api/）与 `SDK`（https://developer.vroid.com/en/sdk/）

### B3 · `EsotericSoftware/spine-runtimes` — **未看**（未抓正文）

### B4 · Rive（https://rive.app/） — **未看**（未抓正文）

### B5 · `DragonBones/DragonBonesJS` — **未看**（未抓正文）

### B6 · `guansss/pixi-live2d-display`
- URL：https://github.com/guansss/pixi-live2d-display
- 抓取：✅ 成功（jina）
- **该页有没有写明使用条件：有**。README 末尾逐字：
> The example Live2D models, Shizuku (Cubism 2.1) and Haru (Cubism 4), are redistributed under Live2D's [Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html).

- 该页逐字（特性）：`Supports all versions of Live2D models`／`Loading from uploaded files / zip files (experimental)`／`Supports PIXI.RenderTexture and PIXI.Filter`
- 该页逐字（自述定位）：*"While the official Live2D framework is just complex and problematic, this project has rewritten it to unify and simplify the APIs…"*
- 该页逐字（Cubism Core 直链警告）：*"…or be referred by a [direct link](…) (_however the direct link is quite unreliable, don't use it in production!_)"*
  🔴 **与本项目 M1 的实测互相印证**：M1 实测该直链拿到的是 **Core 5.1.0**，与 R5 框架不兼容（崩在 `csmGetMocVersion`）

### B7 · `guansss/live2d-viewer-web`
- URL：https://github.com/guansss/live2d-viewer-web ｜ 线上 https://guansss.github.io/live2d-viewer-web/
- 抓取：⚠️ 拿到的是 GitHub 页面框架（README 正文未取到）
- **该页有没有写明使用条件：没看**
- ★实测到的关键事实：**最后一次提交 2022-09-06**（页面显示 `Sep 6, 2022`，commit `f6060b2`）→ **已停更**

### B8 · `tegnike/aituber-kit`（含「動くPngTuber」）
- URL：https://github.com/tegnike/aituber-kit ｜ 被引用的 https://github.com/rotejin/MotionPNGTuber
- 抓取：✅ 成功（jina，正文截断）
- **该页有没有写明使用条件：有**。README 逐字：
> **お知らせ: 本プロジェクトはバージョン v2.0.0 以降、カスタムライセンスを採用しています。商用目的でご利用の場合は、利用規約セクションをご確認ください。**

- 该页徽章逐字：`License: Custom`（指向 `LICENSE`）
- 该页「対応モデル」段逐字：
> * **3Dモデル**: VRMファイル（モーションタグによるポーズ・ジェスチャー制御に対応）
> * **2Dモデル**: Live2Dファイル（Cubism 3以降）
> * **動くPngTuber**: 動画ベースのキャラクター表示（MotionPNGTuber）

---

## 三、类别 C · 「带立绘的人物」来源

### C-a1 · わたおきば（立ち絵素材）
- URL：https://wataokiba.net/ ｜ 规约页 https://wataokiba.net/利用規約/
- 抓取：✅ 成功（jina）
- **该页有没有写明使用条件：有**（专设「利用規約」页）。逐字摘录：
> わたおきばにて配布している素材は、利用規約の範囲内であれば、商用、非商用問わずすべて無料でご利用いただけます。 ただし著作権は放棄していません。
> ◆禁止事項◆ わたおきばでは、下記に該当する場合、素材のご利用をお断りします。
> ・素材の自作発言、作者の虚偽 ・素材自体の再配布、販売 ・法に触れる可能性のある行為に利用など ・その他著作者が不適切と判断した場合
> ◆可能なこと◆
> ○加工について ・縮小拡大、色変更、トリミング （全身イラストですので膝上、顔のみ等、使いやすいよう切り取り加工をしていただいて構いません。） ・涙や頬紅などを自分で書き加える
> ○ご利用可能コンテンツ例 ・自作ゲーム作品（フリーゲーム、同人作品、有償作品） ・自作動画（YouTube、ニコニコ動画など） ・SNSのアイコン、プロフィール画像 etc
> ◆使用報告、クレジット表記について◆ 使用報告もクレジット表記も必須ではありませんのでご自由に。
> 規約最終改訂：2018.10.13 ／ 作者：わたおび

### C-a2 · 素材POMPACK
- URL：https://pompack.net/ ｜ 规约 https://pompack.net/userpolicy/ ｜ 贩售 https://sozaipompack.booth.pm/ ／ https://pompack-ink.booth.pm/
- 抓取：✅ 成功（jina）
- **该页有没有写明使用条件：有**。逐字：
> 「素材POMPACK」で配布している素材は、利用規約の範囲内であれば、商用・非商用問わずすべてご利用いただけます。 [詳細はこちら](https://pompack.net/userpolicy/)

- 该页逐字（它提供什么）：`ゲーム・動画・TRPGなどで使用できる立ち絵素材・背景素材を販売しています。カラーイラストとペン画立ち絵の2シリーズを展開しています。`
- 商品标题形态逐字（说明"一个角色带多少表情差分"）：
  - `【立ち絵素材】怪しげな紫髪男子高校生・私服版｜表情差分13種・学園ミステリー向け`
  - `【立ち絵素材】明るく愛らしい占術師風の女性キャラクター｜水色髪・演出3スタイル・表情12種`
  - `【立ち絵素材】勇者風の青年キャラクター｜表情13種・ペン画風・ファンタジー・TRPG向け`
- 该页另有「ポーズ素体」站：https://pose.pompack.net/

### C-a3 · フリー立ち絵-RAIKO-（BOOTH）
- URL：https://raiko.booth.pm/ ｜ 例 https://booth.pm/ja/items/3202679
- 抓取：未直接抓（搜索结果片段）
- **该页有没有写明使用条件：有**。片段逐字：
> 〖お試し無料版〗 ・立ち絵…通常・笑顔 二種類のみ ・サイズ たて1500px × 幅614px png形式
> 〖有料版〗 ・立ち絵…全身図・表情差分全 １２種類 ・サイズ たて1500px × 幅614px png形式
> 〖利用可能〗 ・商用利用可 ・アダルトゲームへの使用可 ・SNSのアイコン用な

### C-a4 · Kimito-Link 免费素材
- URL：https://kimito-link.com/free-assets/
- 抓取：未直接抓（搜索结果片段）
- **该页有没有写明使用条件：有**。片段逐字：
> 商用利用OK：収益化動画・案件・グッズ等にも使えます。
> AI学習用データセットへの利用：機械学習の学習素材としての利用はご遠慮ください。

### C-a5 · FUYUKUMA（Kido Mutsumi）
- URL：https://kidomutsumi.wixsite.com/official/guidelines
- 抓取：未直接抓（搜索结果片段）
- **该页有没有写明使用条件：有**。片段逐字：
> (立ち絵素材の無料配布)FUYUKUMAでは、無料で使用できる立ち絵素材を公開しています。有料版として、大サイズ画像も販売中です。
> FUYUKUMA素材は、創作性のある成果物の一部として利用する場合に限り、商用利用が可能です。

### C-a6 · TRPG 向立ち絵フリー素材まとめ（第三方聚合页）
- URL：https://nekoko-blog.com/trpgbox/
- 抓取：未直接抓（搜索结果片段）
- **该页有没有写明使用条件：没看**（它是聚合页；它列的每个站各自的条件要逐站去看）
- 标题逐字：`〖無料配布〗TRPG向け立ち絵フリー素材まとめ｜商用利用OK`

### C-b1 · SillyTavern
- URL：https://github.com/SillyTavern/SillyTavern
- 抓取：✅ 成功（jina）
- **该页有没有写明使用条件：有**。README `## License and credits` 段逐字：
> **This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.**

- 该页逐字（它提供什么）：*"SillyTavern provides a single unified interface for many LLM APIs…, a mobile-friendly layout, **Visual Novel Mode**, Automatic1111 & ComfyUI API image generation integration, TTS, WorldInfo (lorebooks), …"*

### C-b2 · airi 角色卡（AIRI Card）— 见 `03_priorart_源码逐字摘录.md` §A8／A9

### C-c1 · `moeru-ai/airi` — 见 `03_priorart_源码逐字摘录.md` §A1–A9

### C-c2 · `Open-LLM-VTuber/Open-LLM-VTuber`
- URL：https://github.com/Open-LLM-VTuber/Open-LLM-VTuber
- 抓取：✅ 成功（jina，正文截断）
- **该页有没有写明使用条件：有**（顶部 license 徽章指向 `LICENSE`）
- 该页逐字（项目状态）：*"⚠️ This project is in its early stages and is currently under **active development**."*
- 该页逐字（它提供什么）：*"**Open-LLM-VTuber** is a unique **voice-interactive AI companion** … but also features a lively **Live2D avatar**. All functionalities can run completely offline on your computer!"*
- 该页逐字（换角色文档入口）：*"…you can refer to the [Character Customization Guide](https://open-llm-vtuber.github.io/docs/user-guide/live2d) to customize your AI companion's appearance and persona."*
- **随仓库分发的模型**（★实测 `find`）：`live2d-models/mao_pro/`（`ReadMe.txt` ＋ `runtime/`）、`live2d-models/shizuku/`（`ReadMe.txt` ＋ `runtime/`）→ 全文见 `03_priorart_源码逐字摘录.md` §B1–B3

### C-c3 · `tegnike/aituber-kit` — 见 §B8

---

## 四、抓取失败清单（如实记录，不臆测内容）

| URL | 失败形态 |
|---|---|
| https://www.nizima.com/ | `statusCode=0`，`jina=422; direct=fetch failed` |
| https://www.live2d.com/en/download/sample-data/ | 抓到 HTTP 200，但**正文只有 cookie 同意声明**，页面正文未取到 |
| `github.com` 直连（`web_fetch`） | `Error: URL hostname "github.com" resolves to a non-public IP address`（本机 Clash TUN DNS）→ 改走 `deepresearch_fetch`（jina）成功 |
| https://github.com/guansss/live2d-viewer-web | 抓到 GitHub 页面框架，README 正文未取到 |
| `platform_search(github)` 多次 | 对 `live2d_api`／`AITuberKit`／`TalkingHead` 等查询**返回 "No results found"**（该工具本轮覆盖不稳）→ 改用 `web_search` 与直接抓取 |
| `web_search`（4 条 query 的那一次） | `Error: Codex search request failed (HTTP 500)` → 拆成单条 query 重试成功 |
