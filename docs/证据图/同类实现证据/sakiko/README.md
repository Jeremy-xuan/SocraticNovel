# sakiko-for-dsh（SAKIKO）

把 **豊川祥子**（とがわ さきこ /《BanG Dream! It's MyGO!!!!!》《BanG Dream! Ave Mujica》）
请进 DeepSeek Harness：iPhone 风格的浮窗面板 + Live2D 立绘 + 日语语音 + 长期记忆 + 多会话播报。

> **非官方二创作品。** 本项目是基于上游插件的二次开发，与 BanG Dream! Project、
> 株式会社ブシロード、Craft Egg Inc.、Ave Mujica 及相关权利方**没有任何关联**，
> 未获其授权或认可。仅供个人学习与技术交流，**不得用于任何商业用途**。

---

## 一、参考与免责声明

### 参考

| | 项目 | 说明 |
| --- | --- | --- |
| 上游 | [**yyxcnasd/amadeus-for-dsh**](https://github.com/yyxcnasd/amadeus-for-dsh) | 《命运石之门 0》Amadeus —— 牧濑红莉栖智能助手（MIT） |
| 本项目 | [**hg4/sakiko-for-dsh**](https://github.com/hg4/sakiko-for-dsh) | 在上游基础上改为《BanG Dream!》豊川祥子（CRYCHIC 期「白祥」）版本 |

本项目的插件架构、Live2D 面板骨架、多 TTS 通道、长期记忆、事件播报、词级口型同步等
基础实现沿用上游；本项目在其上完成角色与人格替换、美术与主题、语音接入，
并新增多工作区播报、语音服务自管理等能力。

上游著作权归其作者 yyxcnasd 所有；本项目与上游作者无隶属或合作关系。

### 免责声明

1. **角色与作品版权**：《BanG Dream!》系列及角色「豊川祥子」的著作权、商标权及相关权利，
   归 © BanG Dream! Project / 株式会社ブシロード / Craft Egg Inc. 等权利方所有。
2. **本项目性质**：由爱好者制作的**非官方、非营利二次创作**，与上述权利方无任何隶属、
   赞助、授权或认可关系。项目名称、角色名称的使用仅用于说明与指代。
3. **上游角色素材**：《命运石之门》相关权利归 MAGES./Nitroplus。
4. **使用限制**：仅供**个人学习、研究与技术交流**。**禁止任何形式的商业使用**
   （包括但不限于售卖、付费分发、植入广告、以本插件作为付费服务的一部分）。
5. **语音模型**：音色权重由公开动画音源训练而成，仅供个人试听与研究。权重以**独立 Release 资产**
   的形式提供（**不随插件包分发**），下载后请仅用于个人学习 —— **不要再分发、不要商用**。
   若权利方对相关内容提出异议，将立即删除相关素材与模型。
6. **立绘素材**：Live2D 模型来自网络公开的粉丝制作资源，版权归原作者。
7. **第三方组件**：pixi.js 等第三方组件遵循其各自许可，
   详见 [`THIRD-PARTY.md`](./THIRD-PARTY.md)。
8. **无担保**：本软件按「原样」提供，不附带任何明示或默示的担保；
   使用本插件所产生的一切后果由使用者自行承担。

### 许可

本项目的**自有代码**以 MIT 许可发布（见 [`LICENSE`](./LICENSE)，其中保留上游
`Copyright (c) 2025 yyxcnasd` 的版权声明）。角色形象、语音素材等**不适用** MIT 许可，
其权利归各自原作者所有。

---

## 二、支持的功能

- **浮窗面板** —— iPhone 直板风格，常驻 Web 界面
- **Live2D 立绘** —— 豊川祥子模型；表情与动作由文本情绪驱动，另有标定模式可微调位置与缩放
- **日语语音** —— 多通道可选，支持重播：

  | 通道 | 说明 |
  | --- | --- |
  | `aqua` | **祥子本人音色**（GPT-SoVITS 自训练音色；需自备服务） |
  | `edge` | 默认。日语女声，需 Python 3 + `edge-tts` |
  | `voicevox` | 日语多说话人，需自备 VOICEVOX 服务 |
  | `openai` | 任意 OpenAI 兼容 TTS 端点 |

- **语音服务自管理** —— `dsh web` 启动时自动拉起 GPT-SoVITS api 与协议桥，退出时一并回收，
  不需要额外的启动脚本；若端口上已有你自己启动的服务，插件只读状态、不接管也不停它
- **人格** —— 人设提示词与台词可自行修改
- **长期记忆** —— 对话要点本地落盘
- **多工作区播报** —— 多个会话共用一个祥子，按会话分别记录进度、串行排队播报，
  气泡前缀标注播报来源会话
- **彩蛋** —— 偶尔会哼一段歌

---

## 三、安装说明

### 1. 安装插件

**推荐装固定版本**（跟 Release，行为可预期）：

```powershell
dsh plugin --profile web add github:hg4/sakiko-for-dsh#v2.2.1
```

把 `v2.2.1` 换成 [Releases](https://github.com/hg4/sakiko-for-dsh/releases) 上的最新 tag 即可。
也可以下载对应 Release 的 tarball 后本地安装：

```powershell
dsh plugin --profile web add file:<下载目录>\sakiko-for-dsh-2.2.1.tgz
```

**想跟随主干**（拿到的是最新提交，可能不稳定，适合本地开发调试）：

```powershell
dsh plugin --profile web add github:hg4/sakiko-for-dsh
```

**装完即生效，不需要手工改任何配置文件。** 重启 `dsh web` 后，Web 界面右侧会出现祥子的浮窗面板。

> ⚠️ **改动过 `host.mjs` 的版本需要重启 `dsh web` 才生效** —— profile patch 的热重载只会重新
> `apply()` 同一个已加载模块，不会重新 import 宿主模块。

要换版本时**先 `remove` 再 `add`**：

```powershell
dsh plugin --profile web remove sakiko-for-dsh
dsh plugin --profile web add <新的 spec>
```

> 💡 **关于 `pnpm-lock.yaml`**：用浮动 spec（`github:hg4/sakiko-for-dsh`）时，pnpm 会把依赖
> **钉死在安装那一刻的 commit**。之后想更新到最新主干，要重新 `remove` + `add`，或者
> `pnpm update sakiko-for-dsh` —— 直接 `pnpm install` 只会按 lock 把旧版本还原回来。
> 用带 tag 的 spec（`#vX.Y.Z`）则锁在对应发布版本上，升级时改 tag 即可。

### 2. 安装语音

音色通道 `aqua` 要准备的东西**全部有公开来源，不需要网盘**：

| 要准备的 | 从哪来 | 大小 |
| --- | --- | --- |
| GPT-SoVITS 本体 | 官方仓库 <https://github.com/RVC-Boss/GPT-SoVITS> | — |
| GPT-SoVITS 基础模型（含中文 G2P、NLTK 数据） | ModelScope 整合包，三个 zip 一条命令下完 —— 见 [安装 skill 第 2 步](./skills/sakiko-voice-setup/SKILL.md) | 约 4.8 GB |
| **祥子音色权重**（`.ckpt` + `.pth` 成对） | **本项目 Release**：<https://github.com/hg4/sakiko-for-dsh/releases/download/weights-v2p/sakiko-weights-v2p.tar.gz> | **289.4 MB** |
| Python 运行环境（3.10 + torch 2.5.1/cu121） | 自行建立，逐条命令见 skill 第 1 步 | 约 4 GB |

权重包 SHA256（下载后可校验）：

```
169283eb1b611e0d5d0e0156429ba05eb2f4ea25e2022b8f4529d6af6c706f4a
```

包内是 **ASCII 文件名**（`sakiko_v2p.ckpt` / `sakiko_v2p.pth`，刻意避开中文名在解压工具里的乱码坑），
解压后放进语音根目录的 `weights\`，再把两个绝对路径填进配置的 `voiceGptWeights` / `voiceSovitsWeights`。

**音色参考素材已随包分发**（`assets/ref/`）：GPT-SoVITS 除了权重，每次请求还需要一段**参考干声**
与**与它逐字一致的文稿**（`ref_audio_path` / `prompt_text`）。

| 包内文件 | 内容 |
| --- | --- |
| `assets/ref/sakiko_ref.wav` | 参考干声：7.6 秒 / 24 kHz 单声道 |
| `assets/ref/sakiko_ref.prompt.txt` | 与上面那段音频逐字一致的日文文稿 |

配置里 `aquaRefAudio` / `aquaPromptText` **留空**时自动使用包内这份（日志会写一行
「未配置 aquaRefAudio ⇒ 使用包内参考音频」）；想换音色就填自己的绝对路径，配置**优先**。
注意：包内素材只是**兜底**，不会因此把默认 TTS 通道切到 aqua —— 要启用日语语音仍需把
`aquaVoice`（例如 `sakiko`）或 `aquaRefAudio` 配上。

**推荐做法**：把包内自带的安装 skill 放进 DSH，然后交给 AI agent 完成：

```powershell
$src = "$env:USERPROFILE\.dsh\profiles\web\node_modules\sakiko-for-dsh\skills\sakiko-voice-setup"
$dst = "$env:USERPROFILE\.dsh\skills\sakiko-voice-setup"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item "$src\*" $dst -Recurse -Force
```

重启 DSH 后，直接对 agent 说「**帮我装祥子语音**」（或「祥子插件不出声了」）即可。
skill 内含分步操作、每步判据、验证阶梯（含反例对照）与故障速查，
以及已实测的协议桥 `bridge_tts.py` 和一键体检脚本 `preflight.py`。

> **不想用 agent**：skill 目录里的 [`SKILL.md`](./skills/sakiko-voice-setup/SKILL.md)
> 本身就是一份完整的手动操作手册，照做即可。
> 也可以先跑体检看缺什么：
>
> ```powershell
> python "$env:USERPROFILE\.dsh\skills\sakiko-voice-setup\preflight.py" --voice-root "<语音根目录>"
> ```

### 3. 卸载

```powershell
dsh plugin --profile web remove sakiko-for-dsh
```

运行时数据（配置、记忆、日志）在 `~/.dsh/sakiko/`，如需彻底清理请手动删除该目录。
