# 证据 · prior art 源码逐字摘录（airi commit eeea3a1a / OLV 992309c0）

> 采集时间 2026-09-24｜本地 clone：/tmp/airi（922 MB）、/tmp/ollmvt
> 🔴 下列每段都是**逐字**从源码/文件里取出的，行号是该 commit 的真实行号。

## A1 · airi 模型不入库（.gitignore:87）
```
**/server/public/*
**/public/assets/js/*
**/assets/live2d/models/*
**/assets/vrm/models/*

```

## A2 · airi 构建时下载模型（apps/stage-web/vite.config.ts:245-249）
```ts
    DownloadLive2DSDK(),
    Download('https://dist.ayaka.moe/live2d-models/hiyori_free_zh.zip', 'hiyori_free_zh.zip', 'live2d/models', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir }),
    Download('https://dist.ayaka.moe/live2d-models/hiyori_pro_zh.zip', 'hiyori_pro_zh.zip', 'live2d/models', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir }),
    Download('https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-A/AvatarSample_A.vrm', 'AvatarSample_A.vrm', 'vrm/models/AvatarSample-A', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir }),
    Download('https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-B/AvatarSample_B.vrm', 'AvatarSample_B.vrm', 'vrm/models/AvatarSample-B', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir }),
```

## A3 · airi 五种舞台（packages/stage-ui/src/stores/settings/stage-model.ts:12）
```ts
export type StageModelRenderer = 'live2d' | 'vrm' | 'spine' | 'tachie' | 'mmd' | 'godot' | 'disabled' | undefined
```

## A4 · airi 素材格式枚举（packages/stage-ui/src/stores/display-models.ts:9-21）
```ts
  Live2dZip = 'live2d-zip',
  Live2dDirectory = 'live2d-directory',
  VRM = 'vrm',
  SpineZip = 'spine-zip',
  TachieZip = 'tachie-zip',
  PMXZip = 'pmx-zip',
  PMXDirectory = 'pmx-directory',
  PMD = 'pmd',
}

export type DisplayModel
  = | DisplayModelFile
    | DisplayModelURL
```

## A5 · airi 预置模型 URL（display-models.ts:24-26, 52-55）
```ts
const presetLive2dFreeUrl = new URL('../assets/live2d/models/hiyori_free_zh.zip', import.meta.url).href
const presetLive2dPreview = new URL('../assets/live2d/models/hiyori/preview.png', import.meta.url).href
const presetVrmAvatarAUrl = new URL('../assets/vrm/models/AvatarSample-A/AvatarSample_A.vrm', import.meta.url).href
  { id: 'preset-live2d-1', format: DisplayModelFormat.Live2dZip, type: 'url', url: presetLive2dProUrl, name: 'Hiyori (Pro)', previewImage: presetLive2dPreview, importedAt: 1733113886840 },
  { id: 'preset-live2d-2', format: DisplayModelFormat.Live2dZip, type: 'url', url: presetLive2dFreeUrl, name: 'Hiyori (Free)', previewImage: presetLive2dPreview, importedAt: 1733113886840 },
  { id: 'preset-vrm-1', format: DisplayModelFormat.VRM, type: 'url', url: presetVrmAvatarAUrl, name: 'AvatarSample_A', previewImage: presetVrmAvatarAPreview, importedAt: 1733113886840 },
  { id: 'preset-vrm-2', format: DisplayModelFormat.VRM, type: 'url', url: presetVrmAvatarBUrl, name: 'AvatarSample_B', previewImage: presetVrmAvatarBPreview, importedAt: 1733113886840 },
```

## A6 · airi Tachie README（packages/stage-ui-tachie/README.md 全文）
```md
# `@proj-airi/stage-ui-tachie`

Tachie scene rendering for characters represented by a small set of complete,
static emotion images.

## What it does

- Loads `.tachie.zip` archives from local files, blob URLs, or HTTP(S) URLs.
- Selects images through AIRI's shared emotion vocabulary.
- Renders the active image with PixiJS on a transparent, responsive canvas.
- Persists scale, position, render scale, and theme-colored shadow settings.
- Exposes canvas capture for stage screenshots and theme-color extraction.

## Archive format

`neutral` is required. Every other image is optional, and missing emotions fall
back to `neutral`. File extensions are not part of the protocol; image content
only needs to be decodable by the browser.

```text
character.tachie.zip
├── neutral.png
├── happy.webp
└── surprised.jpg
```

A single wrapping directory is also accepted:

```text
character.tachie.zip
└── character/
    ├── neutral.png
    └── happy.webp
```

Supported names are `neutral`, `happy`, `sad`, `angry`, `think`, `surprised`,
`awkward`, `question`, and `curious`. Matching is case-insensitive. Every
recognized image must use the same pixel dimensions.

## How to use

```vue
<script setup lang="ts">
import { TachieScene } from '@proj-airi/stage-ui-tachie'
</script>

<template>
  <TachieScene :model-src="modelUrl" />
</template>
```

## When to use it

Use Tachie for low-asset characters whose visual state can be represented by
one complete image per emotion.

Do not use it for layered sprites, rigged animation, lip-sync, or parameterized
eye and body tracking. Use Live2D, Spine, VRM, or MMD for those models.
```

## A7 · airi Tachie 情绪词表（stage-ui-tachie/src/constants/emotions.ts:8-18）
```ts
  'happy',
  'sad',
  'angry',
  'think',
  'surprised',
  'awkward',
  'question',
  'curious',
  'neutral',
] as const

```

## A8 · airi 角色卡的人格↔立绘绑定（stage-ui/src/types/airiCard.ts:33-46）
```ts
    vrm?: {
      source?: 'file' | 'url'
      file?: string
      url?: string
    }

    live2d?: {
      source?: 'file' | 'url'
      file?: string
      url?: string
    }

    /** ID from the display-models store. */
    displayModelId?: string
```

## A9 · 切卡＝切立绘（stage-ui/src/stores/modules/airi-card.ts:125-126）
```ts
    if (modules.displayModelId !== undefined)
      stageModel.stageModelSelected = modules.displayModelId
```

## B1 · OLV 随仓库分发模型（目录实测）
```
live2d-models/mao_pro/ReadMe.txt
live2d-models/mao_pro/runtime/expressions/exp_01.exp3.json
live2d-models/mao_pro/runtime/expressions/exp_02.exp3.json
live2d-models/mao_pro/runtime/expressions/exp_03.exp3.json
live2d-models/mao_pro/runtime/expressions/exp_04.exp3.json
live2d-models/mao_pro/runtime/expressions/exp_05.exp3.json
live2d-models/mao_pro/runtime/expressions/exp_06.exp3.json
live2d-models/mao_pro/runtime/expressions/exp_07.exp3.json
live2d-models/mao_pro/runtime/expressions/exp_08.exp3.json
live2d-models/mao_pro/runtime/mao_pro.4096/texture_00.png
live2d-models/mao_pro/runtime/mao_pro.cdi3.json
live2d-models/mao_pro/runtime/mao_pro.moc3
live2d-models/mao_pro/runtime/mao_pro.model3.json
live2d-models/mao_pro/runtime/mao_pro.physics3.json
live2d-models/mao_pro/runtime/mao_pro.pose3.json
live2d-models/mao_pro/runtime/motions/mtn_01.motion3.json
live2d-models/mao_pro/runtime/motions/mtn_02.motion3.json
live2d-models/mao_pro/runtime/motions/mtn_03.motion3.json
live2d-models/mao_pro/runtime/motions/mtn_04.motion3.json
live2d-models/mao_pro/runtime/motions/special_01.motion3.json
live2d-models/mao_pro/runtime/motions/special_02.motion3.json
live2d-models/mao_pro/runtime/motions/special_03.motion3.json
live2d-models/shizuku/ReadMe.txt
live2d-models/shizuku/runtime/motion/01.motion3.json
live2d-models/shizuku/runtime/motion/02.motion3.json
live2d-models/shizuku/runtime/motion/03.motion3.json
live2d-models/shizuku/runtime/motion/04.motion3.json
live2d-models/shizuku/runtime/shizuku.1024/texture_00.png
live2d-models/shizuku/runtime/shizuku.1024/texture_01.png
live2d-models/shizuku/runtime/shizuku.1024/texture_02.png
live2d-models/shizuku/runtime/shizuku.1024/texture_03.png
live2d-models/shizuku/runtime/shizuku.1024/texture_04.png
live2d-models/shizuku/runtime/shizuku.cdi3.json
live2d-models/shizuku/runtime/shizuku.moc3
live2d-models/shizuku/runtime/shizuku.model3.json
live2d-models/shizuku/runtime/shizuku.physics3.json
live2d-models/shizuku/runtime/shizuku.pose3.json
```

## B2 · OLV mao_pro/ReadMe.txt 全文（含 License Agreement 段）
```

============================================================

    Sample Model
    Niziiro Mao (PRO Version)

============================================================

    This model provides examples of using Blend Shapes, multiply color and screen color for you to learn.
    Blend Shapes are used to add differential shapes to the mouth, eyebrows, hair movement, etc.
    As for the multiply color and screen color, they are used to express color changes in effects.
    This is also a front-facing model that is suitable for VTuber usage, with a wide movable range for the face.

    ※”Motions for magic effects and facial expressions”, which are not used in conjunction with the general motions for facial expressions, are also included.


------------------------------
    License Agreement
------------------------------

    You need to agree "Free Material License Agreement" and "Terms of Use" to use this sample model.
    General Users and Small-Scale Enterprise Users can use the model for commercial purposes by accepting the "Free Material License Agreement".
    Parties other than General User or Small-Scale Enterprise User are allowed to use the model for Internal or Supervision Purpose.
    Please refer to this agreement for more details.

    For more information on licensing, please see the following page.
    https://www.live2d.com/en/download/sample-data/


------------------------------
    Creator
------------------------------

    - Illustration: Live2D Inc.
    - Modeling: Live2D Inc.


------------------------------
    Sample Data Composition
------------------------------

    - Model data (.cmo3)
    - Basic motion (.can3)
    - Embedded file set (.runtime folder)
        - Model data (.moc3)
        - Expression data (.exp3.json)
        - Motion data (.motion3.json)
        - Model setting file (.model3.json)
        - Physical calculation setting file (.physics3.json)
        - Pose setting file (.pose3.json)
        - Display auxiliary file (.cdi3.json)


------------------------------
    Release Note
------------------------------

    - 2025-03-14
        - Fixed issues related to runtime files.

    - 2024-09-05
        - Added scene to playlist.

    - 2023-09-21
        - Added motion using new features of Cubism 5.0.

    - 2023-05-31
        - Corrected parameter name.

    - 2022-07-21
        - Modified some Parameter IDs of the arms.
        - Added some keyframes at the beginnning of the scenes.

    - 2022-06-23
        - Released.
```

## B3 · OLV shizuku/ReadMe.txt（ライセンス段）
```

============================================================

サンプルモデル　しずく PRO版

============================================================

　「しずくの時間」でお馴染みのモデルです。
　手の細かい動きによって表情豊かな演出ができます。

　※本データはCubism 2.1にて作成されたデータを
　Cubism 4およびCubism Viewer 4および対応するソフトウェアにて動作する形式に変換したものです

------------------------------
ライセンスについて
------------------------------

　一般ユーザーおよび小規模事業者は規約同意により商用利用可能です。
　中・大規模事業者は非公開テスト用途でのみ利用可能です。
　ご利用に際しては以下の『無償提供マテリアルの使用許諾契約書』
　(ライセンスタイプ ・Live2Dオリジナルキャラクター)および利用条件への同意が必要です。

　ライセンスの詳細については、下記ページをご覧ください。
　https://www.live2d.com/download/sample-data/


------------------------------
クリエイター
------------------------------

```
