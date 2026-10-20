# THIRD-PARTY.md — 第三方组件、素材与许可

本文档列出 `sakiko-for-dsh` 中包含或依赖的第三方内容。
**每一项都标注了"是否随包分发"** —— 随包分发的部分，发布者对许可合规负责。

---

## 1. 上游项目（本项目的派生来源）

| 项目 | 作者 | 许可 | 说明 |
| --- | --- | --- | --- |
| [amadeus-for-dsh](https://github.com/yyxcnasd/amadeus-for-dsh) | yyxcnasd | **MIT**（`Copyright (c) 2025 yyxcnasd`，本机实测其发行包 `LICENSE` 与 `package/package.json` 的 `license` 字段一致） | 本项目**随包分发其派生代码**。插件架构、RPC 桥、面板骨架、多 TTS 通道、记忆与播报机制来自上游。 |

**合规动作**：上游 MIT 版权声明与许可全文已原样保留在本包 `LICENSE` 中
（MIT 要求"copies or substantial portions"必须携带该声明）。
上层权利（角色形象/声音/台词）不随 MIT 转移：上游素材权利归 MAGES./Nitroplus。

---

## 2. 随包分发的第三方内容

### 2.1 Live2D 模型（来自网络公开的粉丝制作资源）

| 项 | 值 |
| --- | --- |
| 路径 | `assets/live2d/sakiko/`（86 个文件：`model.json`、`sakiko_casual-2023.moc`、`physics.json`、29 组 expression、53 个 motion、2 张贴图） |
| 用途 | 面板立绘（Live2D 模型） |
| 来源 | **网络公开的粉丝制作 Live2D 模型**（`persona/sakiko.md` 的记录指向 claudepet 的改造版本） |
| 权利归属 | 模型版权归其原作者；角色形象权利归 BanG Dream! Project / 株式会社ブシロード / Craft Egg Inc. |
| 使用限制 | 仅限个人学习与非商业二创；**禁止商用**。若原作者或权利方提出异议，将立即移除相关素材 |

### 2.2 开源 JS 运行时（均为 MIT，随包分发）

| 文件 | 版本（文件头实测） | 许可 |
| --- | --- | --- |
| `plugin/web/vendor/pixi.min.js` | pixi.js `v7.4.2` | MIT |
| `plugin/web/vendor/pixi-v6.min.js` | pixi.js `v6.5.10` | MIT |
| `plugin/web/vendor/pld-cubism2.min.js` | pixi-live2d-display `0.4.0` | MIT |
| `plugin/web/vendor/pld-cubism4.min.js` | pixi-live2d-display `0.4.0` | MIT |

### 2.3 音频素材（随包分发）

| 文件 | 来源 | 使用限制 |
| --- | --- | --- |
| `assets/audio/ring.mp3` | 铃声，取自 Ave Mujica「Imprisoned XII」 | 音乐版权归 Ave Mujica / 株式会社ブシロード；**仅限个人使用，禁止商用** |
| `assets/audio/hum-1.wav` … `hum-8.wav` | 动画原声中角色哼唱的片段（按真实乐句切分） | 同上 |
| `assets/audio/hum-9.wav` | 由 `hum-*` 片段经自训 RVC 音色模型转换得到 | 同上（转换模型本身不随包分发） |

---

## 3. 不随包分发、但运行时可选的第三方依赖

| 依赖 | 版本 | 许可 | 说明 |
| --- | --- | --- | --- |
| [edge-tts](https://github.com/rany2/edge-tts) | 7.2.8（本机实测元数据） | **LGPL-3.0** | 默认 `edge` 语音通道。由用户在**自己的 Python 环境**里 `pip install edge-tts`，插件以**独立子进程**方式调用（非链接、非静态包含），因此不触发本项目的许可传染。 |
| [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) | — | **MIT**（`Copyright (c) 2024 RVC-Boss`，本机实测其 `LICENSE`） | `aqua` 语音通道，用户自行部署服务。 |
| [RVC](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI) | classic `2.2.231006` | **MIT**（`Copyright (c) 2023 liujing04`，本机实测其 `LICENSE`） | **仅离线**用于训练祥子音色模型；推理与训练均不在本包内。 |
| VOICEVOX / OpenAI 兼容 TTS | — | 各自许可 | 可选语音通道，由用户自行提供服务端点与 Key。 |

音色权重（GPT-SoVITS 的 `.ckpt`/`.pth` 等，约 313 MB）与语音运行环境（约 9 GB）
**不随包分发**，设计为后续的引导下载（断点续传 + SHA256 校验）。

---

## 4. 角色 IP 声明

| 作品/角色 | 权利方 |
| --- | --- |
| 《BanG Dream!》系列、豊川祥子（本项目主题） | © BanG Dream! Project / 株式会社ブシロード / Craft Egg Inc. |
| 《命运石之门》系列、牧濑红莉栖（上游主题） | © MAGES. / Nitroplus |

本项目与上述权利方均无关联，未获授权或认可；相关内容仅供个人学习交流，禁止商用。
