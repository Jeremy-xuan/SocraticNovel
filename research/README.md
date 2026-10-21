# research/ —— 一次性实验的源码与证据

> **这里不是产品。** 放的是「为了回答某个问题，在某一轮里写的脚本、量出来的数字、留的证据」。
> 它们的结论已经写进 `docs/历史报告/`；这里留源码只为**可复算**，不承诺能直接跑、不随产品升级维护。

## 怎么判断一个东西该放这里

- 它服务的是**一个问题**（"512² 能不能跑""嘴在哪一层""本地立绘能不能自动分层"），不是一条产品能力；
- 它的产出**已经被消费掉**了（结论进了报告、参数进了产品代码）；
- 产品代码**不 import 它**。

被产品直接调用的工具留在 `tools/`（目前是 `animation-gate`／`anchors`／`deploy`）。
被取代的实现进 `archive/`。

## 目录

| 目录 | 当初要回答的问题 | 结论落在哪 | 原位置（2026-10-20 前） |
|---|---|---|---|
| `anim-prep/` | 备课阶段能不能把动画模板先渲好、课上直接取缓存？ | `docs/历史报告/实现报告_ANIM-PREP_备课与模板化_2026-09-24.md` | `tools/anim-prep/` |
| `animation-orch/` | 动画渲染能不能异步编排、不阻塞课堂？ | `docs/历史报告/实现报告_ANIM-ORCH_动画异步编排_2026-09-24.md` | `tools/animation-orch/` |
| `auto-layer/` | 一张静态立绘能不能自动分层到可做 Live2D 的程度？ | `docs/历史报告/实现报告_LAYER-GPU_*` | `tools/auto-layer/` |
| `auto-layer-memprobe/` | 重型分层能不能压进 17 GB 内存？ | `docs/历史报告/实现报告_LAYER-MEMPROBE_压内存实测_2026-09-24.md` | `tools/auto-layer-memprobe/` |
| `auto-layer-512/` | 512² 是不是本机可跑的最后一条路？ | `docs/历史报告/实现报告_LAYER-512_低分辨率实测_2026-09-24.md` | `tools/auto-layer-512/` |
| `auto-layer-mouth/` | 自动分层出的层里为什么没有「嘴」？怎么拆出来？ | `docs/历史报告/实现报告_LAYER-MOUTH_嘴与关键部件_2026-09-24.md` | `tools/auto-layer-mouth/` |
| `portrait2live/` | 静态立绘能不能不装模型权重就"动起来"？ | `docs/历史报告/实现报告_P2L1_静态立绘转动起来_2026-09-24.md` | `tools/portrait2live/` |
| `psd2moc3/` | 分层图能不能生成真 `.moc3` 并在我们宿主里驱动？ | `docs/历史报告/实现报告_P2L2_静态立绘转真模型_2026-09-24.md` | `tools/psd2moc3/` |
| `mermaid-pretty/` | mermaid 图能不能做成"克劳德那种观感"？ | `docs/历史报告/实现报告_MERMAID1_Claude式图表_2026-09-24.md` | `tools/mermaid-pretty/` |

## 三条注意

1. **路径是当时的**：脚本里出现的 `code/tools/...`、旧工作区绝对路径不会再被修（它们是历史记录的一部分）。
   要复跑，先按上表把路径改到本仓库。
2. **第三方资产不在这**：`vendor/`、模型权重、样本素材按各子目录 README 的官方出处获取。
3. **不要在这里加新功能**。新实验可以放这里，但产品能力的实现必须在 `plugins/`／`clients/`。
