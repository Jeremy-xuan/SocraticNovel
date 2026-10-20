# 证据 03 · 官方渠道的初音ミク（下载入口 ＋ 条件页链接）

> 任务代号 **L2D-LINKS**，2026-09-24 实测。
> 🔴 本件只给**链接与位置**，**不解读条款、不做合法性判断**（项目硬规矩）。

---

## 1. Live2D 官方样本页 —— 初音ミク的**具体下载入口**

### 1.1 页面位置

| 页面 | URL | 实测 |
|---|---|---|
| 样本总入口（日文） | https://www.live2d.com/learn/sample/ | 200，`<title>` = `サンプルモデル \| Live2D Cubism` |
| 样本总入口（英文） | https://www.live2d.com/en/learn/sample/ | 200 |
| **初音ミク 页（日文）** | https://www.live2d.com/learn/sample/hatsune-miku/ | 200，`<title>` = `初音ミク \| Live2D Cubism` |
| **初音ミク 页（英文）** | https://www.live2d.com/en/learn/sample/hatsune-miku/ | 200，`<title>` = `Hatsune Miku \| Live2D Cubism` |

### 1.2 下载按钮在页面上的位置（HTML 逐字）

在页面 `初音ミク` 标题 → 预览图 → 说明文字（「初音ミクの原画を元に作成したLive2Dモデルです。」）**之下**，有一个 `.sample-single-dl` 区块，内含两件东西：

```html
<div class="sample-single-dl">
  <div class="sample-single-dl-inner">
    <p class="dl-btn">
      <a id="sample_dl_btn" data-model-id="miku">ダウンロード</a>      ← 日文页按钮文字
    </p>
    <div class="dl-lang">
      <label for="sample_lang_select">ダウンロード言語：</label>
      <select id="sample_lang_select" data-model-id="miku"></select>  ← 语言下拉（由 JS 填充）
    </div>
  </div>
</div>
```

- 英文页同一位置按钮文字为 `Download`（HTML：`<a id="sample_dl_btn" data-model-id="miku">Download</a>`）。
- ⚠️ **这个 `<a>` 没有 `href`** —— 它是 JS 按钮，真实下载地址由官方脚本现拼，所以**页面上没有可直接复制的静态 zip 链接**。

### 1.3 真实下载 URL（**这是本轮的关键发现**）

官方脚本：**https://cubism.live2d.com/sample-data/js/download.js** （页面 `<script src>` 里逐字给出；实测 200，11,454 字节）

该脚本里逐字写着：

```js
let FILE_BASE_URL = "https://cubism.live2d.com/sample-data/bin/"
…
// 初音ミク
miku: {
    models: [
        { lang: "ja", url: "miku/miku_ja.zip" },
    ]
},
```

拼接规则逐字：`FILE_BASE_URL + model.url` → 初音ミク的下载地址 = **https://cubism.live2d.com/sample-data/bin/miku/miku_ja.zip**

**实测结果**：

| 检查项 | 结果 |
|---|---|
| HTTP | **200** |
| Content-Type | `application/zip` |
| 文件大小 | **43,689,423 字节**（约 41.7 MB） |
| 文件头 | `50 4B 03 04`（PK，真 ZIP） |
| 语言选项 | miku **只有 `ja`（日本語）一种**（同一脚本里 `hiyori`／`natori` 等有 en/zh-Hans/ko 四种，miku 没有） |

**ZIP 内实测 40 个条目**（解包清单）：

```
miku_pro/                                   ← Cubism PRO 版
  miku_pro/miku_sample_t02.can3
  miku_pro/miku_sample_t05.cmo3
  miku_pro/ReadMe.txt
  miku_pro/runtime/miku_sample_t04.moc3
  miku_pro/runtime/miku_sample_t04.model3.json
  miku_pro/runtime/miku_sample_t04.physics3.json
  miku_pro/runtime/miku_sample_t04.cdi3.json
  miku_pro/runtime/miku_sample_t04.2048/texture_00.png
  miku_pro/runtime/motion/miku_01…miku_08.motion3.json      ← 8 个动作
miku_free/                                  ← Cubism FREE 版
  miku_free/miku_t01.can3
  miku_free/miku_t01.cmo3
  miku_free/ReadMe.txt
  miku_free/runtime/miku.moc3
  miku_free/runtime/miku.model3.json
  miku_free/runtime/miku.physics3.json
  miku_free/runtime/miku.cdi3.json
  miku_free/runtime/miku.2048/texture_00.png
  miku_free/runtime/motions/miku_01…miku_07.motion3.json + miku_idle.motion3.json
```

→ 即：**官方给的是一套完整的 Cubism 3/4 世代 `.moc3` 运行时模型**（`moc3` ＋ `model3.json` ＋ `physics3.json` ＋ `cdi3.json` ＋ `texture` ＋ 8 个动作），另附 `.cmo3`／`.can3` 源文件。

> 📌 与项目已有结论的关系：本机此前踩过「**Cubism Core 5.1.0 与 R5 框架不兼容**、必须用 6.0.1」的坑（见 `研究_7/8_Live2D驱动*`）。本件只记录**官方 zip 给的是 `.moc3`**，**不判断**它与本机框架的兼容性（那需要另测）。

### 1.4 ZIP 内含的 `ReadMe.txt`（**事实记录**）

`miku_free/ReadMe.txt` 与 `miku_pro/ReadMe.txt` 各有一节 `ライセンスについて`（关于许可），其中**逐字给出两个链接**：

- `https://www.live2d.jp/terms/live2d-free-material-license-agreement/` （实测 200）
- `https://docs.google.com/document/d/e/2PACX-1vQW7y7xiN0cDD2JNlwqhfVnSFYEHpa2ket7pBDTqcI8Q0ybeJtoi_hbeJL1Ld4DEEu8_qwxias6lwqp/pub` （实测 200，`<title>` = `Live2D Cubism サンプルモデル利用条件`）

PRO 版 ReadMe 另指向 `https://www.live2d.com/download/sample-data/` （实测 200）。
ReadMe 也逐字写了著作者：`イラスト：クリプトン・フューチャー・メディア株式会社` ／ `モデリング：Live2D`。

---

## 2. 条件页链接（**只给链接**）

| 名称 | URL | 实测 |
|---|---|---|
| Live2D Cubism サンプルデータ利用条件（日文） | https://www.live2d.com/learn/sample/model-terms/ | 200，`<title>` = `Live2D Cubism サンプルデータ利用条件 \| Live2D Cubism` |
| Terms of Use for Live2D Cubism Sample Data（英文） | https://www.live2d.com/en/learn/sample/model-terms/ | 200 |
| 無償提供マテリアルの使用許諾契約書（日文） | https://www.live2d.com/eula/live2d-free-material-license-agreement_jp.html | 200 |
| Free Material License Agreement（英文） | https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html | （由英文页逐字给出，本轮未单独实测） |
| piapro・キャラクター・ライセンス（摘要页） | https://piapro.jp/license/pcl/summary | 200，`<title>` = `piapro \| ピアプロ・キャラクター・ライセンス(要約)` |
| Google 文档版「Live2D Cubism サンプルモデル利用条件」（来自 zip 内 ReadMe） | https://docs.google.com/document/d/e/2PACX-1vQW7y7xiN0cDD2JNlwqhfVnSFYEHpa2ket7pBDTqcI8Q0ybeJtoi_hbeJL1Ld4DEEu8_qwxias6lwqp/pub | 200 |

> 🔴 上述各页**写了什么内容，本件不摘录、不解读**。判定留用户。

---

## 3. VRoid Hub 的初音ミク（3D／VRM，**不是 Live2D**）

| 项 | 内容 |
|---|---|
| 链接 | https://hub.vroid.com/en/characters/3381543574629827407/models/4549641854869196320 |
| 实测 | HTTP **200**（该页为 JS 渲染，curl 取不到 `<title>`） |
| 前轮已记录的事实（**本件不重查，直接沿用**） | 页面正文逐字含「この作品はピアプロ・キャラクター・ライセンス（https://piapro.jp/license/pcl/summary）に基づいてクリプトン・フューチャー・メディア株式会社の『初音ミク』を3Dモデル化したものです。」；投稿者＝斬り丸（**用户投稿，非 pixiv 官方**），2022-12-28 上传 |
| VRoid Hub 站内规约入口 | https://hub.vroid.com/ （页脚有 `Terms of Use`／`Guidelines`／`Content Protection Policy`） |
| 该页有没有写使用条件 | **有**（前轮已核；指向 piapro 授权） |

> ⚠️ 形态提醒（事实）：VRoid Hub 这条是 **3D 模型（VRM）**，与 Live2D `.moc3` 是两套东西。

---

## 4. 官方渠道"有没有"的核对结论

- **Live2D 官方样本页 28 个模型里有初音ミク**：**有**（独立页 `/learn/sample/hatsune-miku/`，日英双语）。
- **可直接下载**：**有**（`https://cubism.live2d.com/sample-data/bin/miku/miku_ja.zip`，41.7MB，实测 200）。
- **下载入口在页面上是否可见**：**是**（页面中段「ダウンロード / Download」按钮；点击后由 JS 跳转到上面那个 zip）。
- **是否有静态 href 可复制**：**没有**（按钮无 `href`，靠官方 `download.js` 现拼）。
- **该页有没有写使用条件**：**有**（页面自身有「ご使用の注意」段，并指向 `model-terms` 与 `free-material-license`；zip 内 ReadMe 也有 `ライセンスについて` 段）。
