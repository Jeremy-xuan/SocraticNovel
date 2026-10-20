# 实现报告 · L2D-LAYER-GPU —— 本机 Apple GPU 能不能跑「静态立绘自动分层」

> 任务代号 **L2D-LAYER-GPU**｜日期 **2026-09-24**｜机器 **Apple M3 / 10 核 GPU / Metal 3 / 24 GB / 无 CUDA**
> 产出目录 `开源线/DSH定制/code/tools/auto-layer/`｜旁挂锚点表 `实现报告_L2D-LAYER-GPU_本地GPU自动分层_2026-09-24.anchors.md`
> 上游实现：[shitagaki-lab/see-through](https://github.com/shitagaki-lab/see-through)（SIGGRAPH 2026）

---

## 〇 · 一句话结论

**能跑，但"跑哪条路"是决定性的。**

| 路线 | 权重 | MPS 实测 | 单张耗时（干净负载） | 结论 |
|---|---|---|---|---|
| **轻量路线**：SemanticSam 语义分割 ＋ 动漫 LaMa 补全 | **1.50 GB** | ✅ **端到端跑通** | **≈ 29 s** | 🔴 **值得挂机，本机直接可用** |
| **重型路线**：See-through 原版（LayerDiff 3D SDXL ＋ Marigold） | **13.44 GB** | ⚠️ **算得动，但内存放不下** | **≈ 40–100 min（768²）** | 不值得，见 §四 |

**关键更正**：P2L-1 报告里"本机跑不了（要 CUDA / 14.7 GB）"那条，**来源是"读到的结论"，本轮第一次在本机实测**。实测后要拆成三句：

1. **体积那条是准的** —— 上游三个模型确实合计 **14.73 GB**（逐文件实测，与旧记"14.7 GB"吻合）。
2. **"要 CUDA"那条要更正** —— 上游把 `device` **写死成字符串 `'cuda'`**（8 处），这是**参数化问题，不是能力问题**；
   而**模型本体对 MPS 的支持远好于预期**（本机算子探针 **22/24 通过**，含 bf16 conv/groupnorm/SDPA 与 `torch.fft`）。
3. **真正跑不动的原因不是 MPS，是内存** —— 重型管线实测峰值 **23 GB**（`top` 实测），在 24 GB 机器上把 swap 打满
   （`vm.swapusage` 实测 used **34.5 / 35.8 GB**），进程进 `STAT=U`（不可中断等待）。
   `sample` 抓栈显示它**确实在 GPU 上算**（`at::MPS_gelu` → MPSGraph → Metal command buffer → `_dispatch_semaphore_wait_slow`）
   —— **不是崩溃、不是死锁，是被换页拖到走不动**。

**最有价值的发现**：上游仓库里**自带**一条轻量路线 —— 动漫微调的 LaMa（**204.5 MB**，`annotators/lama_inpainter`），
它替掉了 10.16 GB 的 SDXL 去做"补全被遮挡区"这件事。加上 1.29 GB 的语义分割模型，
**整件事从「14.73 GB / 要 CUDA」变成「1.50 GB / MPS 直接跑通」**。

---

## 一 · 成本表（动手前实测，不是估的）

### 1.1 目标方案 See-through 的三个模型

| 模型 | HF 仓库 | 体积（HF API 实测） | 用途 |
|---|---|---|---|
| LayerDiff 3D | `layerdifforg/seethroughv0.0.2_layerdiff3d` | **10.16 GB**（unet 单文件 8.14 GB） | SDXL 扩散生成透明层 |
| Marigold Depth | `24yearsold/seethroughv0.0.1_marigold` | **3.28 GB** | 伪深度（定层序） |
| SAM Body Parsing | `24yearsold/l2d_sam_iter2` | **1.29 GB** | 19 类语义部件分割 |
| | | **合计 14.73 GB** | |

- **上游环境要求**：`torch==2.8.0+cu128`、`diffusers==0.37.0`、`transformers==5.0.0`、`timm`（git 直装）、
  `psd-tools[composite]`、`PyQt6`；可选层 `mmcv/mmdet`（README **明写 Requires CUDA toolkit**）、
  `bitsandbytes`（NF4 量化，**CUDA-only**）、`detectron2`、`sam-2`。
- **上游 README 明写的显存**：默认 bf16、1280 分辨率需 **12–16 GB VRAM**；`--group_offload` 降到 ~10 GB。
- **本机 MPS 预算实测**：`torch.mps.recommended_max_memory() = 17.18 GB` → **压在边缘**（实测峰值到过 19.87 GB，见 §四）。
- **上游有没有写 Apple Silicon**：README **全文零处提到 macOS / MPS / Apple**；
  但**代码里有 MPS 分支**（`layerdiff3d.py` 的 `is_mps` dtype 处理、`diffusers_kdiffusion_sdxl.py` 的 MPS latents dtype 修补）。
  → 判断：作者**处理过 MPS 的算子坑，但没把设备这一层参数化**。
- **CPU-only 可能吗**：可能。同一套代码里 CPU 路径存在（`apply_inpaint` 就有 `if device in {'cuda'}` 的 else 分支）。
  但代价见 §三：**同一张图的语义分割，CPU 比 MPS 慢 11.7 倍**。

### 1.2 替代实现（项目硬规矩：先读现成实现）

| # | 实现 | 权重体积 | 依赖 | 需 CUDA？ | 我们借什么 / 不借什么 |
|---|---|---|---|---|---|
| 1 | **动漫 LaMa**（`dreMaz/AnimeMangaInpainting` 的 `lama_large_512px.ckpt`）——**See-through 自带** `annotators/lama_inpainter` | **204.5 MB** | 纯 torch（FFC 用 `torch.fft`） | **不需要** | 🔴 **借，且这是最值钱的一个**。它替掉 10.16 GB 的 SDXL 去做"补全被遮挡区"。**本轮实测在 MPS 上跑通**。**不借**：它的训练目标不是"分层"，只解决"补洞"。 |
| 2 | **LayerDiffuse**（[lllyasviel](https://github.com/lllyasviel/sd-forge-layerdiffuse)，See-through 的上游技术） | `ld_diffusers_sdxl_conv` 3.62 GB ＋ `attn` 1.91 GB ＋ `vae_transparent_decoder` 0.21 GB ＝ **5.74 GB**（**另需 SDXL 底座 ~7 GB**） | diffusers | 不需要（LoRA 式） | **不借**：仍要 SDXL 底座，总量与 See-through 同量级。**借**：它证明"透明层生成"可以小到 5.74 GB，为将来压体积留了方向。 |
| 3 | **AnimeInstanceSegmentation**（`dreMaz/AnimeInstanceSegmentation`） | **2.23 GB**（ZoeD 深度 1.44 GB ＋ RTMDet 0.23 GB ＋ 修补） | mmdet/mmcv（**需 CUDA 工具链**） | 可选层要 | **不借**：它做的是**角色实例**分割（"这是几个人"），不是**部件**分割（"哪块是头发"）——与"分层"不是同一件事。**借**：它的 ZoeD 深度可作 Marigold 的轻量替代（1.44 GB vs 3.28 GB）。 |
| 4 | **anime-segmentation**（SkyTNT，`isnet_is`） | 模型 **~176 MB**（HF 上那个 17.49 GB 是**训练数据**，不是模型） | onnxruntime（**本机已装**） | 不需要 | **不借**：只出**二值 alpha**（人/背景），不出部件层。**借**：若要"抠人"这一步，它最省。 |

**结论**：真正值得借的是 **#1 动漫 LaMa**。它是"1.50 GB 跑通"与"14.73 GB 跑不动"之间的分水岭。

### 1.3 磁盘与网络（动手前实测）

| 项目 | 数值 |
|---|---|
| 磁盘（动手前） | **72 GiB 可用**（460 GiB 卷，已用 84%） |
| 磁盘（权重拉完后） | **55 GiB 可用** |
| 网络 | HF / GitHub / PyPI 均 **HTTP 200**；实测下载 **~12 MB/s**（curl 走 hf-mirror） |
| 隔离 venv 体积 | **132 MB**（`--system-site-packages` 复用系统 torch，只补装 12 个包，**下载量约 24 MB**） |
| 权重落点 | **工作区外** `/Users/wujunjie/dsh-scratch/auto-layer/weights`（工作区只有 2.8 GB，不该塞 14 GB） |

---

## 二 · 本机 GPU 能力探针（`00_env_probe.py`）

先回答"MPS 到底能不能算"——**真跑算子，不看文档、不看 `torch.backends` 的布尔值**。

- `torch 2.11.0`，`mps_built=True`，`mps_available=True`，`cuda_available=False`
- **22/24 项通过**。两项失败都是 MPS 的已知边界，且都**不影响本任务**：
  - `float64 matmul` → `MPS framework doesn't support float64`（上游 `layerdiff3d.py` 已用 `is_mps` 分支规避〔A07〕）
  - `randn(mps, generator=cpu)` → 生成器必须与张量同设备（MPS 生成器本身可用）
- **通过的关键项**：`conv2d bf16`、`groupnorm bf16`、`layernorm bf16`、`silu bf16`、
  `scaled_dot_product_attention fp16`、`interpolate`、`grid_sample`、`einsum`、
  **`fft.fft2 / rfft2 / irfft2 / complex64`**（LaMa 的傅里叶卷积要用）
- **显存预算**：`recommended_max_memory = 17.18 GB`

> 意义：这条探针把"本机 GPU 能不能跑深度学习"从**信念问题**变成了**可复现的测量**。
> 结论是：**MPS 的算子覆盖度远好于旧记的假设**（旧记只写了"同类实现走 MPS 直接崩"）。

---

## 三 · 轻量路线：语义分割 ＋ LaMa 补全（✅ 端到端跑通）

### 3.1 为什么先测这条路

上游三步管线里，**语义分割那一步是最小、最可能跑动的**，而且它是"分层"的语义核心
（扩散那步解决的是"被遮挡处补全"）。**先测它能在最短时间内给出确定答案**。

顺带查清一件事：**主管线 `inference_psd.py` 根本不用 SAM** —— 它只用 LayerDiff ＋ Marigold ＋ 启发式后处理；
SAM 那条是**独立的 annotator 路径**（造训练数据 / 交互 demo 用）。
两条路是**可拆的**，这正是"轻量路线"成立的前提。

### 3.2 语义部件分割（SemanticSam，647.3 M 参数，bf16）

| 运行 | 设备 | 输入 | 载入 | **推理** | RSS 峰值 | MPS 占用 | 命中类别 |
|---|---|---|---|---|---|---|---|
| `sam_mps_test1` | **mps:0** | 1232×928 | 1.39 s | **9.59 s** | 1269 MB | 1294.6 MB | 10 |
| `sam_cpu_test1` | cpu | 1232×928 | 0.25 s | **112.61 s** | 2616.7 MB | — | 10（**与 MPS 完全一致**） |
| `sam_mps_ourasset` | **mps:0** | 1024×1024（我方 P2L-1 素材） | 1.32 s | **4.90 s** | 1613 MB | 1294.6 MB | 8 |

- **MPS 比 CPU 快 11.74×**，且 RSS 只有 CPU 的一半。
- **CPU 与 MPS 命中的类别集合完全相同** → 不是"跑起来了但结果不对"。
- 为什么能跑：`modules/semanticsam.py`〔A08〕与 `modules/sam/` **零 device 硬编码**，
  device 由 `next(self.parameters()).device` 推导；且 SAM 的 xformers 路径**被强制关闭**
  （`USE_XFORMER_ATTENTION = False`，连 try 成功之后也置 False）——那个类因此走不到〔A09〕。

**目视核验**（`out/sam/sam_mps_test1/contact_sheet.png`）：19 类掩码〔A13〕各自落在正确的身体部位 ——
`hair` 25,546 px / `face` 5,365 px / `eyes` 1,498 px / `mouth` 19 px / `topwear` 34,932 px /
`bottomwear` 53,660 px / `legwear` 72,543 px。**语义像素覆盖率 18.1%**，与人物在画面中的占比相符。

### 3.3 动漫 LaMa 补全（51.0 M 参数）

为什么必须补全（不是锦上添花）：SAM 给的是**可见像素**；Live2D 要让部件动起来，需要部件的**完整纹理**
（脸被刘海遮住的部分、身体被手臂遮住的部分）。不补全，层就是破的，一动就露洞。
**这正是 See-through 用 10 GB 扩散在做的事；我们用 0.2 GB 的 LaMa 替代。**

| 操作 | 设备 | 耗时 |
|---|---|---|
| 载入（含 204.5 MB 权重） | mps:0 | 0.46–0.55 s |
| 自检：擦掉整张脸再重建 | mps:0 | **1.67–2.70 s** |
| 真实用途：补出被头发遮住的脸 | mps:0 | **1.35 s** |
| RSS 峰值 | | 776–812 MB |

**目视核验**：自检三联图（原图｜挖掉脸｜重建）显示 LaMa **重建出一张完整、色调一致的动漫脸**；
细节与原图不同（那是 LaMa 重画的），但**是可信的动漫内容，不是糊块**。

### 3.4 端到端（立绘 → 12 层）

| 阶段 | 耗时（干净负载，实测） |
|---|---|
| 语义分割（§3.2） | 9.59 s |
| 逐部件补全（12 层，每个 **1.50–1.63 s**） | **18.22 s** |
| **单张合计** | **≈ 29 s**（含模型载入） |
| RSS 峰值 | 947.5 MB |

出层（文件名前缀＝绘制顺序）：
`010_hair` / `012_legwear_l` / `012_legwear_r` / `015_bottomwear` / `020_topwear` / `025_neck` /
`030_face` / `055_ears` / `060_eyes_l` / `060_eyes_r` / `065_handwear_l` / `065_handwear_r`。

**目视核验**（`out/layers/light_mps/contact_sheet.png`）：**左右腿、左右眼、左右臂都被正确拆开**，
叠起来（COMPOSITE）忠实还原原立绘。

> 🔴 踩过的坑：**双侧部件必须在"补全之前"拆左右**。补全区是"其它部件掩码 ∩ 本部件外接框"，
> 它会把左右两块**连通起来** → 事后再拆连通域就只能得到 1 块（首轮实测报"连通域不足两个"，
> 9 层里 4 个双侧部件全部拆不出来）。修正后 12 层全出。

---

## 四 · 重型路线：See-through 原版（⚠️ 算得动，内存放不下）

### 4.1 上游唯一的硬阻塞点：`device` 被写死

上游把设备**写死成字符串 `'cuda'`**，共 **8 处**：`inference_utils.py` 里 5 个组件的 `.to(device='cuda')`、
2 处 `enable_group_offload('cuda', …)`、1 处 marigold 的 `.to(device='cuda')`。
本机 `cuda.is_available()=False` → 必然抛错。

本任务用 `20_patch_device.py` 把它参数化（`SEETHROUGH_DEVICE` 环境变量 > cuda > mps > cpu），
**幂等、落 diff**，补丁后实测 `inference_utils.DEVICE = mps` 解析正确〔A01〕〔A02〕。

**另一个上游真 bug（独立发现）**：`apply_inpaint(img, mask, device=…)` 把 `device` 传给了模型 forward，
但调用 `inpaint_preprocess(img, mask)` 时**没往下传**〔A03〕 → 该函数用自己的默认值 `device='cuda'`〔A04〕
→ `.to('cuda')` → `AssertionError: Torch not compiled with CUDA enabled`。
**即这个 API 在非 CUDA 机器上永远跑不通** —— 不是"不支持 MPS"，是"参数没接上"。补一行即通。

### 4.2 整条管线：峰值 23 GB，swap 打满

- 实测（`top`）：进程峰值 **23 GB**（24 GB 机器）
- 实测（`vm.swapusage`）：**used 34.47 / 35.84 GB**（96%）
- 实测（`ps`）：进程 `STAT=U`（不可中断等待），`ps` 报的 RSS 只有 **47 MB** —— 因为**几乎全部被换出**
  （`ps aux` 的 RSS **不含被压缩/换出的页**，这里差点据此误判"没在干活"）
- 实测（`sample` 抓栈）：`at::MPS_gelu` → `MPSStream::executeMPSGraph` → `MPSGraph encodeToCommandBuffer`
  → `AGXG15GFamilyCommandQueue` → `_dispatch_semaphore_wait_slow`
  → **确实在 GPU 上算，只是被换页拖到走不动**
- 处置：同时发现并清掉一个**我方遗留孤儿进程**（PPID=1、占 2.28 GB），swap 从 35.8 GB 回落到 13.3 GB

### 4.3 隔离实验：**只把 SDXL UNet 放上 MPS**（`41_unet_mps_probe.py`）

把"能不能跑"与"内存放不下"两个变量**拆开**，单独测 UNet：

| 项目 | 实测 |
|---|---|
| 参数量 | **4071.3 M** |
| `from_pretrained`（fp32 载入） | **15.10 s** |
| `.to(mps, bfloat16)` | **10.38 s**，MPS allocated **8.14 GB** |
| **`unet.forward`（latent 96 ＝ 768² 图，13 个 tag）** | ✅ **跑通，40.47 s / 101.1 s**（两次） |
| 输出形状 | `[1, 13, 4, 96, 96]` ✅ 正确 |
| MPS driver 峰值 | **19.87 GB**（**超过** 17.18 GB 的推荐预算） |
| RSS 峰值 | 13.78 GB |

🔴 **结论：SDXL UNet 在 MPS 上真的跑得动。** 挡住整条管线的是**内存**，不是 GPU 能力。

> 顺带查清该 UNet 的输入约定（读源码得来，不是猜的〔A10〕〔A11〕〔A12〕）：
> 它按 **tag 组**工作（`config.group_embedding_num = [13, 11]`，body 组 13 个 tag / head 组 11 个），
> `group_index` 选组；13 个 tag 走**帧维**（`CrossFrameAttn*` 就是跨 tag 注意）。
> 这也解释了为什么它一个 UNet 能一次出 19 类层。

### 4.4 重型路线耗时估算

| 分辨率 | 单次 forward | 30 步 × 2 组（60 次） | 单张 |
|---|---|---|---|
| 768² | 40.5–101.1 s | 60 次 | **≈ 40–101 min** |
| 1280²（上游默认） | ×2.78（像素比） | 60 次 | **≈ 1.9–4.7 h** |

**批量（20 张）**：768² 约 **13–34 小时**；1280² 约 **38–94 小时**。
（且这是在**没有其它负载**的前提下；实测中任何额外内存占用都会把它推进换页地狱。）

---

## 五 · 接回下游：能不能喂 `image2live2d`（✅ 链路打通）

### 5.1 契约（读 i2l 源码得来）

`image2live2d` 要求层文件名 **`{order}_{role}`**，且 `role` **必须精确等于** `SemanticRole` 枚举值
（`irr/schema.py`，共 33 个值：`face_base` / `hair_front` / `hair_side` / `hair_back` / `eye_l` / `eye_r` /
`mouth` / `neck` / `torso` / `arm_l` / `arm_r` / `leg_l` / `leg_r` / `clothing` / `accessory` / `background` …）。
`.moc3` 必须**注入 `native_moc_writer`** 才写得出来（CLI 不产 `.moc3`）—— 这点 P2L-2 已经查明，本轮**只读复用**。

### 5.2 映射与实测结果

本轮的 12 层 → i2l 角色：`hair→hair_front`、`face→face_base`、`neck→neck`、`topwear→torso`、
`bottomwear→clothing`、`eyes_l/r→eye_l/r`、`handwear_l/r→arm_l/r`、`legwear_l/r→leg_l/r`。

**实测（`50_wire_to_i2l.py`）**：

```
11 个层文件 → 画布 928x1232
rig 管线：parts=19 textures=19 parameters=25 physics=5 animations=18
✅ .moc3 = out/i2l/saml2dchar/saml2dchar.moc3  4639808 B  头部 4D4F433301000000（MOC3 v3.00）
```

**完整链路已通**：

```
一张立绘 PNG
  → ① SemanticSam 语义分割（MPS，9.6 s）→ 19 类掩码
  → ② 动漫 LaMa 补全被遮挡区（MPS，12 层共 ≈13–18 s）→ 12 个完整层
  → ③ 改名映射成 {order}_{role}
  → ④ image2live2d 注入 native_moc_writer → 真 .moc3（4,639,808 B，v3.00）
  → ⑤ 交给我们自己的宿主加载
```

**每一步都有实测数字，且全程在本机、全程 MPS。** 唯一没做的是第 ⑤ 步的宿主加载验收
（那是 P2L-2 的地盘，且本轮 `psd2moc3/` 只读未改）。

### 5.3 本轮**没填上**的角色（诚实记录）

| 缺口 | 原因 |
|---|---|
| `eyebrow_l/r`、`eye_white_l/r`、`pupil_l/r`、`blush` | SAM 的 19 类里**没有**这些角色 |
| `mouth` | SAM 出了 `mouth`，但本轮该图命中只有 **19 px**，未达出层阈值 |
| `hair_side` / `hair_back` | SAM 的 `hair` 是**一块**；上游靠 `--tblr_split` ＋ 深度拆前后，那是**重型路线**的步骤 |
| `background` | 没做抠背景 |
| `ear_l/r` | `ears` 掩码只有一个连通域（595 px），拆不出左右 |

---

## 六 · 结论：值不值得挂机

**值得，但要挂"轻量路线"，不要挂"重型路线"。**

| 问题 | 答案 |
|---|---|
| **本机能不能跑** | **能**。轻量路线端到端跑通，全程 MPS。 |
| **要多久** | 单张 **≈ 29 s**；**20 张 ≈ 10 分钟**。 |
| **质量够不够用** | **分层结构对**（左右腿/眼/臂都拆对了，叠起来还原原图）；**补全内容可信但不是原画**（LaMa 重画）。够不够用**要目视判断** —— 结果在 `out/layers/light_mps/contact_sheet.png`。 |
| **重型路线呢** | **不值得**。单张 40 min–4.7 h（20 张 13–94 h），且峰值 23 GB 会把机器打进换页地狱。 |

**若"能跑但很慢"的估算**：见 §4.4（重型路线）；轻量路线的批量估算是 **20 张 ≈ 10 分钟**。

**若某天要更好的补全质量**，替代路径按性价比排序：
① 在轻量路线上把 LaMa 换成 AnimeMangaInpainting 的更大架构（`use_mpe=True`）；
② 上 LayerDiffuse（5.74 GB ＋ SDXL 底座）但**必须先解决内存**（fp16 而非 bf16、逐组件上 MPS 再释放 fp32）；
③ 租 GPU（按 §4.4，云端跑 1280² 是合理的）；
④ 人工分层。

---

## 七 · 未做到项 / 待确认

### 7.1 未做到

1. **重型路线没有端到端跑完**。卡在内存（峰值 23 GB），不是卡在 MPS 能力。已用隔离实验证明 UNet 本身跑得动。
2. **1280 分辨率未测**（受 17.18 GB 预算限制）。
3. **宿主加载未验收**（`.moc3` 已产出，但没在 `live2d-host` 里加载看画面）—— 那是 P2L-2 的地盘，本轮只读。
4. **没有美术评审**。分层质量是**我目视**的结论（接触表），不是画师判断。
5. **只测了 2 张图**（上游 `test_image1.png` ＋ 我方 P2L-1 平色立绘）。
6. **`--tblr_split`（深度拆前后发）没跑到**，因为它在重型路线里。

### 7.2 待确认清单

| # | 事项 | 选项 | 我的倾向 |
|---|---|---|---|
| 1 | 轻量路线的**分层质量**够不够用？ | ① 够用，直接接产品；② 不够，要上重型路线；③ 不够，但要人工修 | **无法替你判断** —— 结果图在 `out/layers/light_mps/contact_sheet.png`，请你亲自目视 |
| 2 | 要不要**继续啃重型路线**（解决内存）？ | ① 啃（fp16 ＋ 逐组件装载）；② 不啃，走轻量；③ 租 GPU | 倾向 ②（性价比差 2 个数量级） |
| 3 | 补全用的 LaMa 要不要换**更大架构**（`use_mpe=True`）？ | ① 换；② 不换 | 倾向先看当前质量再定 |
| 4 | `eyes_l/r` 的拆分依据是**连通域质心**，不是语义 | ① 接受；② 要求按深度/骨骼拆 | 倾向 ①（本图结果正确） |
| 5 | 权重放工作区外（`~/dsh-scratch/auto-layer/`）是否可以 | ① 可以；② 要移进工作区 | 倾向 ①（工作区只有 2.8 GB） |

---

## 八 · 风险提示（至多三行，不解读）

1. See-through 仓库自述 *"This is an open-source research project… Use at your own risk."*，未声明额外使用条件；上游 `LICENSE` 文件在仓库根。
2. 三个模型权重页（`layerdifforg/seethroughv0.0.2_layerdiff3d`、`24yearsold/seethroughv0.0.1_marigold`、`24yearsold/l2d_sam_iter2`）与 `dreMaz/AnimeMangaInpainting` 均**未标 gated**；各页有无使用条件请自行查看。
3. 上游致谢列出的第三方项目（LayerDiffuse / Marigold / SAM / GroundingDINO / LaMa / AnimeInstanceSegmentation）各有自己的许可，本报告不解读。
