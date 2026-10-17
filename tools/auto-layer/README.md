# auto-layer —— 「一张静态立绘 → 自动分层 → 真 `.moc3`」的自研编排与闸门源码

> 本文件是**本目录（`tools/auto-layer/`）的唯一入口文档**：本目录收什么、缺什么会在哪一步响亮失败、每个脚本要什么前置、以及这批脚本量出来的原始数字。
> 来源标注：`【源码】`＝从本目录源码逐行读出来的事实；`【实测】`＝本批脚本在 Apple M3 上跑出来的原始数字（2026-09-24 那一轮）；`【推断】`＝我的判断。

---

## 🔴 一 · 本目录收什么、不收什么

**只收自研的编排／探针／闸门源码** —— 即"把第三方模型串起来、把结果量出来、把不合格的产出挡住"这一层。**不含**第三方模型代码、权重、素材。

**第三方资产一律不随本仓库分发**：

| 未分发的资产 | 出处（自行获取） | 本目录里谁需要它 |
|---|---|---|
| See-through 上游源码 `vendor/see-through/` | `https://github.com/shitagaki-lab/see-through` | `20_patch_device.py`（唯一会改它的脚本）、`30/32/40/41`（import 它）、`31/33`（`sys.path`） |
| image2live2d（i2l）源码 | 使用者自备 | `50_wire_to_i2l.py`（`--i2l`）、`60_mouth_gate.py`（读它出的模型） |
| 模型权重 | HuggingFace，见 §五 成本表 | `30/32/33/40/41`（`--ckpt` / `--w-*`） |
| 输入素材、官方 Live2D 样本模型、Cubism Core／Framework | 见 `clients/live2d-host/README.md` 的「官方出处」 | `30`（输入图）、`60/62`（真渲染宿主） |
| **权重下载脚本** | — | **本目录不含**：`10_fetch_weights.sh` / `11_fetch_weights_curl.sh` 已**排除**。取权重是使用者自己的环境准备动作，**不是本仓库的安装步骤**。 |

> 📌 **同批产出的两份实现报告**（`实现报告_L2D-LAYER-GPU_本地GPU自动分层_2026-09-24.md`、`实现报告_MOUTH-FIX2_第三道闸修复_2026-09-24.md`）**不在本仓库内**，未随本目录分发。本 README 只保留其中可直接复跑的数字与判据。

---

## 🔴 二 · 目录契约：缺什么、在哪一步失败

**没有降级假实现。** 本目录不存在"缺模型就用近似结果顶上""探测不到就当作通过"这类分支。缺失一律表现为**非零退出 + 说清缺什么、去哪儿取**。

| 契约项 | 期望位置（默认值） | 缺失时的行为 |
|---|---|---|
| 上游源码 | `vendor/see-through/`（本目录下，已 gitignore） | `20_patch_device.py` → `FATAL: 找不到 …` 退出码 **2**；`30/32/40/41` 在 `import` 阶段 `ModuleNotFoundError` |
| i2l 源码 | `--i2l`，默认 `/tmp/p2l2/src/image2live2d-main/src` | `50_wire_to_i2l.py` → `[FAIL] 找不到 image2live2d 源码` 退出码 **2** |
| SAM 权重 | `--ckpt`，默认旧工作区路径 `${AUTO_LAYER_SCRATCH:-$HOME/dsh-scratch/auto-layer}/weights/sam_bodyparsing_ckpt18000.pt` | `30_run_sam_mps.py` → `[FAIL] 本地权重不存在` **并直接退出**（🔴 **不退回 huggingface_hub 下载**，见 §七坑②） |
| LaMa 权重 | `--ckpt`，默认原机 `…/weights/lama_anime_512.ckpt` | `32/33` 在 `torch.load` 处抛错并落 `result.json`，退出码 **4** |
| 重型路线权重 | `--w-layerdiff` / `--w-marigold` / `--w-unet` | `40/41` 在 `from_pretrained` 处抛错 |
| 真渲染宿主 | 向上逐级找 `<祖先>/clients/live2d-host`（判据：含 `tools/mouth-iso.cjs`）；可用 `AUTO_LAYER_HOST` 覆盖 | `60_mouth_gate.py` → `[FAIL] …找不到渲染宿主…` |
| 宿主**已构建** | `clients/live2d-host/out/demo.html`（由 `scripts/build.mjs` 生成） | `60_mouth_gate.py` → `[FAIL] 渲染宿主未构建` —— **不出结论，也不降级成软件光栅** |
| Python 解释器（venv） | `AUTO_LAYER_PY`，默认旧工作区路径 `${AUTO_LAYER_SCRATCH:-$HOME/dsh-scratch/auto-layer}/venv/bin/python` | `63_mem_two_channel.sh` → `[FAIL] 解释器不可执行` 退出码 **2** |
| 输出目录 | `out/**`、`evidence/**`（均已 gitignore） | 脚本自己 `makedirs`；缺父目录时直接抛错，不静默跳过 |

> 🔴 **默认值里的 `${AUTO_LAYER_SCRATCH:-$HOME/dsh-scratch/auto-layer}/…`（旧工作区路径）不是本仓库的路径。** 换机器必须用上表的**环境变量或 CLI 参数**覆盖；这些路径指向的 venv／权重按设计就**不在仓库里**（14 GB 量级）。
> 🔴 **唯一的"故意重放旧行为"开关**：`33_make_layers.py --order legacy --hole-mode all` 精确复现 MOUTH-FIX-2 之前的错误行为，**只用于对照实验**；其它任何 `--hole-mode all` 组合都会被 `check_occlusion_direction()` 判死（见 §四）。

---

## 三 · 脚本清单（本目录 = 自研层全量）

| 脚本 | 作用 | 前置 | 退出码约定 |
|---|---|---|---|
| `00_env_probe.py` | 本机 GPU 能力探针：**真跑 24 项算子**，不看布尔值 | 只需 torch | — |
| `20_patch_device.py` | 把上游写死的 `device='cuda'` 参数化（8 处 + 1 处上游 bug），幂等，落 diff | `vendor/see-through/` | 2 缺文件 / 3 替换点不符 / 4 找不到插入点 |
| `30_run_sam_mps.py` | 语义部件分割（SemanticSam 19 类）→ 掩码 PNG | vendor + SAM 权重 + 输入图 | 2 MPS 不可用 / 3 加载失败 / 4 推理失败 |
| `31_make_contact_sheet.py` | 19 类掩码接触表（目视） | 30 的产出 | — |
| `32_run_lama_mps.py` | LaMa 修补：能力自检（擦脸重建）＋ 真实用途（补被头发遮的脸） | vendor + LaMa 权重 + 30 的产出 | 3 / 4 |
| **`33_make_layers.py`** | ✅ **核心**：立绘 → 语义层（可见区 ∪ 补全区），含 MOUTH-FIX-2 三处修正 | vendor + LaMa 权重 + 30 的产出 | 3 载入失败 / 4 LaMa 失败 / **6 判据不成立** |
| `34_layer_contact_sheet.py` | 层接触表（棋盘底看 alpha） | 33 的产出 | — |
| `34_layer_regression.py` | MOUTH-FIX-2 逐部件回归：改前/改后**逐像素**对照 | 两套层集 + 源图 | — |
| `34_minpx_probe.py` | 出层阈值 `--min-px` 的实测（降阈值会放进真部件还是碎块） | 30 的产出 | — |
| `35_order_probe.py` | **绘制序表与补全判据的可核依据**（两张表的矛盾条数、前后发可分性） | 30 的产出 | — |
| `36_occlusion_selfcheck_probe.py` | 把 `33` 的"判据不成立就响亮报错"**单独跑一遍**（不加载模型） | 只需 numpy/PIL | 1 = 有不符合预期的情形 |
| `40_run_pipeline_mps.py` | 重型路线：LayerDiff 3D ＋ Marigold ＋ further_extr | vendor + 13 GB 权重 + **必须先打补丁** | 3 补丁未打 / 4–6 各步失败 |
| `41_unet_mps_probe.py` | 隔离实验：**只把 SDXL UNet 放上 MPS** | vendor + 10 GB 权重 | 3 / 4 |
| `50_wire_to_i2l.py` | 接线：层 → 改名（i2l 命名契约）→ 真 `.moc3` | i2l 源码 + 33 的产出 | 2 缺源码/缺层 / 5 没写出 `.moc3` |
| **`60_mouth_gate.py`** | ✅ **产品级闸门**：真渲染器里驱动 `ParamMouthOpenY` 0→1，像素差 < 20 就报红 | 已构建的宿主 + i2l 出的模型 | 0 过闸 / **1 报红** / 2 环境装载失败 |
| `62_mouth_contact_sheet.py` | 闸门接触表：真渲染器「闭/开/差异热图」×12 放大 | `60` 落盘的探针证据 | — |
| `63_mem_two_channel.sh` | 内存测量：**两条独立通道 + 单位实测标定** | `AUTO_LAYER_PY` + 33 的输入 | 2 解释器/工作负载不合法 |

---

## 四 · 一条命令复现（以核心的轻量路线为例）

```bash
# 工作目录 = 本目录（tools/auto-layer）
PY="${AUTO_LAYER_PY:-<装了 torch/numpy/PIL/opencv 的 venv>/bin/python}"
SRC="<你自备的立绘 png>"

# ① 本机 GPU 能力探针（不下载任何东西）
"$PY" scripts/00_env_probe.py

# ② 取上游源码到 vendor/see-through/（按 §一 的出处），再打设备补丁
"$PY" scripts/20_patch_device.py

# ③ 语义分割 → ④ 分层 → ⑤ 接触表
"$PY" scripts/30_run_sam_mps.py --device mps --srcp "$SRC" --tag sam_mps_mine \
      --ckpt <SAM 权重>/sam_bodyparsing_ckpt18000.pt
"$PY" scripts/33_make_layers.py  --device mps --samdir out/sam/sam_mps_mine --tag light_mps \
      --ckpt <LaMa 权重>/lama_anime_512.ckpt
"$PY" scripts/34_layer_contact_sheet.py --layerdir out/layers/light_mps/layers \
      --src out/sam/sam_mps_mine/input.png

# ⑥ 接回下游：层 → 真 .moc3
"$PY" scripts/50_wire_to_i2l.py --layerdir out/layers/light_mps/layers --name myl2dchar \
      --i2l <i2l 源码>/src

# ⑦ 产品级闸门（宿主须先构建；--control-nomouth 给"同层集去掉嘴层"的对照模型）
"$PY" scripts/60_mouth_gate.py --model myl2dchar --control-nomouth myl2dchar_nomouth \
      --samdir out/sam/sam_mps_mine
"$PY" scripts/62_mouth_contact_sheet.py
```

> ⚠️ `33` 重跑前**会先清空** `out/layers/<tag>/layers/`——旧层与新层混在一起会污染接触表与下游接线（实测踩过）。

---

## 五 · 成本表（动手前实测，不是估的）

### 5.1 目标方案 See-through 的权重

| 模型 | HF 仓库 | 体积（HF API 实测） | 用途 |
|---|---|---|---|
| LayerDiff 3D | `layerdifforg/seethroughv0.0.2_layerdiff3d` | **10.16 GB**（unet 单文件 8.14 GB） | SDXL 扩散生成透明层 |
| Marigold Depth | `24yearsold/seethroughv0.0.1_marigold` | **3.28 GB** | 伪深度（定层序） |
| SAM Body Parsing | `24yearsold/l2d_sam_iter2` | **1.29 GB** | 19 类语义部件分割 |
| | | **合计 14.73 GB** | |

- **上游环境要求**【源码】：`torch==2.8.0+cu128`、`diffusers==0.37.0`、`transformers==5.0.0`、`timm`（git 直装）、`psd-tools[composite]`、`PyQt6`；可选层 `mmcv/mmdet`（上游 README 明写 **Requires CUDA toolkit**）、`bitsandbytes`（NF4，**CUDA-only**）、`detectron2`、`sam-2`。
- **上游 README 明写的显存**：默认 bf16、1280 分辨率需 **12–16 GB VRAM**；`--group_offload` 降到 ~10 GB。
- **上游有没有写 Apple Silicon**：README **全文零处**提到 macOS／MPS／Apple；但**代码里有 4 处 MPS 分支**（`layerdiff3d.py` 的 `is_mps` dtype 处理、`diffusers_kdiffusion_sdxl.py` 两处 MPS latents dtype 修补、`depth_anything_v2` 的 device 三元式）。→ 【推断】作者处理过 MPS 的算子坑，但没把**设备**这一层参数化。
- **有没有 CPU-only 可能**：有。`inference_utils.py` 里 24 处 `device='cpu'`（对照 28 处 `'cuda'`），且 `apply_inpaint` 有 `if device in {'cuda'}` 的 `else` 分支。

### 5.2 替代实现（先读现成实现，再决定借什么）

| # | 实现 | 权重体积 | 需 CUDA？ | 我们借什么 / 不借什么 |
|---|---|---|---|---|
| 1 | **动漫 LaMa**（`dreMaz/AnimeMangaInpainting` 的 `lama_large_512px.ckpt`，See-through 自带 `annotators/lama_inpainter`） | **204.5 MB** | **不需要** | 🔴 **借**：最值钱的一个 —— 它替掉了 10.16 GB 的 SDXL 去做"补全被遮挡区"。**不借**：训练目标不是"分层"，只解决"补洞"。 |
| 2 | **LayerDiffuse**（lllyasviel） | 5.74 GB（**另需 SDXL 底座 ~7 GB**） | 不需要 | **不借**：总量与 See-through 同量级。**借**：证明"透明层生成"可以小到 5.74 GB。 |
| 3 | **AnimeInstanceSegmentation**（`dreMaz/AnimeInstanceSegmentation`） | 2.23 GB | 可选层要 | **不借**：它做的是**角色实例**分割，不是**部件**分割。**借**：ZoeD 深度（1.44 GB）可作 Marigold 的轻量替代。 |
| 4 | **anime-segmentation**（SkyTNT，`isnet_is`） | 模型 ~176 MB（HF 上那个 17.49 GB 是**训练数据**） | 不需要 | **不借**：只出二值 alpha。**借**：若要"抠人"这一步，它最省。 |

**结论**：真正值得借的是 **#1 动漫 LaMa** —— 整件事从"14.73 GB / 要 CUDA"变成"**1.50 GB / MPS 直接跑**"。

---

## 六 · 实测数字（2026-09-24，Apple M3 / 10 核 GPU / Metal 3 / 24 GB / 无 CUDA）

| 项 | 数字 |
|---|---|
| 算子探针 | **22/24 通过**；仅 `float64 matmul`、`randn(mps, generator=cpu)` 失败 |
| 显存预算 | `recommended_max_memory = 17.18 GB` |
| SAM 推理 | mps **9.59 s** vs cpu **112.61 s**（**11.74×**）；RSS 1269 MB vs 2616.7 MB；**两边命中类别集合完全相同** |
| LaMa | 载入 0.46–0.55 s；擦脸重建自检 1.67–2.70 s；补被头发遮的脸 1.35 s；RSS 776–812 MB |
| 轻量路线端到端 | 载图 0.14 s ＋ 载 LaMa 0.49 s ＋ 逐部件补全 **18.22 s**；**加分割 ≈ 29 s**；RSS 峰值 947.5 MB |
| 出层（12 层） | `010_hair` / `012_legwear_l,r` / `015_bottomwear` / `020_topwear` / `025_neck` / `030_face` / `055_ears` / `060_eyes_l,r` / `065_handwear_l,r` |
| 重型路线整条 | ⚠️ **未跑完**：峰值 **23 GB**，swap 34.47/35.84 GB，进程 `STAT=U`（`sample` 抓到 `at::MPS_gelu` → MPSGraph → `_dispatch_semaphore_wait_slow` ⇒ **在算，被换页拖死**） |
| 重型路线隔离实验 | ✅ **跑通**：UNet 4071.3 M 参数；fp32 载入 15.10 s；`.to(mps,bf16)` 10.38 s；forward（latent 96＝768²）**40.47 s / 101.1 s**；输出 `[1,13,4,96,96]`；MPS driver 峰值 **19.87 GB** |
| 接回下游 | 11 个层文件 → 画布 928×1232；rig `parts=19 textures=19 parameters=25 physics=5 animations=18`；`.moc3` **4,639,808 B**，头部 `4D4F433301000000`（MOC3 v3.00） |

→ 【推断】结论要拆成三句：① 上游 `device='cuda'` **确实写死了**（8 处），但这是**参数化问题，不是能力问题**；② 模型本体对 MPS 的算子支持**远好于预期**（22/24）；③ 重型路线跑不动的原因是**内存**（峰值 23 GB），**不是 MPS 能力**。

---

## 七 · 踩过的坑（都写进代码注释了，别改回去）

| # | 坑 | 现象 | 正解 |
|---|---|---|---|
| ① | 上游 `device` 写死成 `'cuda'` | 8 处 `.to(device='cuda')` / `enable_group_offload('cuda',…)`；本机 `cuda.is_available()=False` → 必然抛错 | `20_patch_device.py` 参数化：`SEETHROUGH_DEVICE` > cuda > mps > cpu |
| ② | 🔴 `huggingface_hub` 下载器在本机会挂 | `snapshot_download` 卡在 **0 字节**；8.14 GB unet 卡在 737 MB 不动，进程还活着；同一时刻 curl 稳定 11–12 MB/s | 权重一律 **curl 预取**（脚本已排除，见 §一）；`30_run_sam_mps.py` **已改为缺权重即响亮退出，不退回 hub** |
| ③ | 🔴 Python 默认找不到 CA bundle | `urllib`/`requests` 一律 `CERTIFICATE_VERIFY_FAILED`；curl 同时正常 | 显式 `export SSL_CERT_FILE=/etc/ssl/cert.pem`（Clash TUN 环境的坑） |
| ④ | 🔴 上游 LaMa 真 bug：`device` 参数被丢掉 | `apply_inpaint(..., device='mps')` 没往下传给 `inpaint_preprocess` → 该函数用默认 `device='cuda'` → `AssertionError` ⇒ **这个 API 在非 CUDA 机器上永远跑不通** | 补一行 `device=device`（`20_patch_device.py` 的 `REPL2`） |
| ⑤ | `apply_inpaint` 没有 `inpaint_size` 参数 | 多传一个参数 → `NameError` | 只传 `device` |
| ⑥ | `LamaFourier` 不是 `nn.Module` | `m.parameters()` → `AttributeError` | 参数在 `m.generator` 上 |
| ⑦ | `lama_inpainter` 是 `annotators/` 的子包 | `ModuleNotFoundError` | `sys.path` 要加 `vendor/see-through/annotators` |
| ⑧ | 上游 `visualize_segs_with_labels` 形状不符 | `cannot reshape array of size 18292736 into shape (1232,928,4)` | 自己画接触表（`31`/`34`）；**与 MPS 无关** |
| ⑨ | 缺 `matplotlib` / `pycocotools` | `live2d.scrap_model` → `utils.visualize` 链式 import 失败 | 装进隔离 venv |
| ⑩ | 上游脚本要仓库根有 `assets/` 软链 | 上游 README 明写 `ln -sf common/assets assets` | 在 vendor 副本里建软链 |

### MOUTH-FIX-2 的三处修正（`33_make_layers.py`，第三道闸）

| # | 原样 | 现象（实测） | 改法 |
|---|---|---|---|
| ① | 补全区遮挡物 = **所有其它部件的并集** | 把**画在下面**的部件也当遮挡物 → `hair` 从 **136,917 px** 膨胀到 **204,899 px**，接成 `hair_front` 后 100% 盖住嘴 ⇒ 真渲染器 **0 px** | 只取**绘制序更高**的部件（`OCCLUSION_DIRECTION='above'`）；判据不成立**抛错**，不静默降级 |
| ② | 绘制序表是**反的**（`hair=10` 最底、`face=30`） | 脸盖在头发上，与 Live2D 惯例（刘海最上）相反 | 按 i2l `samples.py` 的规范层序重排（`face_base 24 → nose 55 → eyes 60 → mouth 70 → hair_front 90`），并用 `35_order_probe.py` 对 SAM 可见掩码做逐对一致性核验：**修前 1–2 条矛盾、修后 ≤1 条**（残留那条是 SAM 掩码自身的抗锯齿重叠） |
| ③ | SAM 的 `hair` 是**前后发合并**的一块 | 整块放最上＝盖住脸；放最底＝后发跑到脖子/上衣前面 | 按"脸区域"（脸掩码闭运算 31 px ＋ 外扩 6 px）几何拆成 `hair_back`(6) / `hair_front`(90) |

> 🔴 另外两条**必须在补全之前**做的事：**双侧部件拆左右**（补全区会把左右两块连通起来，事后再拆连通域只剩 1 块）；**重跑前清空层目录**。

### 闸门判据（`60_mouth_gate.py`，阈值写死在源码里）

```
GATE_MIN_RENDER_PX            = 20    # 真渲染器 ParamMouthOpenY 0→1 的像素差低于此值即报红
GATE_MAX_STATIC_POLLUTION_PX  = 20    # 静止帧下「嘴窗口之外」的差异像素数上限
```

- **为什么是 20**：上一路实测的失准案例是 **5 px**（真立绘 19 px 嘴层：能力表全绿、`talk` 照常 shipped，画面只动 5 px）。噪声底实测 **0**（宿主自带 `mouth-iso.cjs` 的可逆性判据逐例 0 px）。
- **第二条判据（MOUTH-FIX-2 新增）**：**静止帧对照** —— 不驱动任何参数，把本模型与「同层集去掉嘴层」的对照模型逐像素比，要求**落在嘴窗口之外**的差异 ≤ 20 px。🔴 **不是"差异必须为 0"**：本模型多一个嘴层，嘴本身在静止帧就该被画出来（我方立绘 918 px 嘴 ⇒ 截图里 447 px 差异）。要抓的是"差异跑到嘴以外"——那正是坏嘴层被 LaMA 重画成整张脸的表现。窗口＝嘴层 alpha 的模型坐标 bbox × `截图宽/画布宽`（实测 720/1024 = 0.703125），再外扩 2%。
- **对照表里的历史行**（`62_mouth_contact_sheet.py` 的 `CASES`）：修前 `mouthfix_*` = **0 px**；消融 `ablate_hairhole_*` = **359 px / 13 px**；修后 `fix2_*` 为主角。

---

## 八 · 已知边界（换素材/换场景要重核）

1. **轻量路线的"层"不等于 See-through 的"层"**：本路线给的是**可见区 ∪ 补全区**的 RGBA；上游 SDXL 那步给的是**学习出来的、带绘制顺序的完整透明层**。
2. **部件左右拆分用的是连通域＋质心**（上游 `--tblr_split` 走深度，属重型路线，本轮没跑到）。
3. **没有 eyebrow / blush / eye_white / pupil**：SAM 的 19 类里没有，i2l 的 `SemanticRole` 里有 → 这几个角色本路线填不上。
4. **没有背景层**（`background`）：分层结果叠起来背景是透明的。
5. **补全质量未经美术评审**：自检那张脸重建后"像一张动漫脸"，但细节与原图不同（那是 LaMa 重画的）。
6. **只测了 2 张图**（上游 `test_image1.png` ＋ 我方平色立绘）。
7. **重型路线的 1280 分辨率未测**（受 17.18 GB 预算限制）。
8. **本轮没填上的 i2l 角色**：`eyebrow_l/r`、`eye_white_l/r`、`pupil_l/r`、`blush`、`hair_side`/`hair_back` 的深度拆分版、`ear_l/r`（`ears` 只有一个连通域）、`background`。

---

## 九 · 收拢时对本目录脚本做的改动（逐条可核，共 4 处）

收拢进本仓库时，只改了**与新仓库目录结构冲突**和**与"缺失即响亮失败"契约冲突**的地方；其余 13 个脚本**逐字未动**（sha256 相同，见 §十）。

| 文件 | 原样 | 现样 | 为什么 |
|---|---|---|---|
| `60_mouth_gate.py` | `_workspace()` 向上找旧工作区路径 `开源线/DSH定制/clients/live2d-host`（**该路径已删，此处仅为改动留痕**），且要求 `tools/mouth-iso.cjs` **与** `out/demo.html` 同时存在才算找到 | `_host_dir()` 向上找 `clients/live2d-host`（判据只看 `tools/mouth-iso.cjs`），支持 `AUTO_LAYER_HOST` 覆盖；`out/demo.html` 的检查**独立出来**，缺了就报"宿主未构建"并给出构建命令 | ① 清掉旧工作区的绝对/相对路径；② 把"找不到宿主"与"宿主没构建"两种失败**分开报**，后者给出可执行的正解 |
| `30_run_sam_mps.py` | 本地权重不存在时**静默退回** `huggingface_hub` 下载（`download_from_hf=True`） | 权重不存在即 `[FAIL] 本地权重不存在` **退出**，`download_from_hf=False` | 本机实测 hub 客户端会**永久卡住** ⇒ 那个"兜底"等于把失败变成无限等待；且本目录**不含**取权重的脚本，下载不该藏在运行路径里 |
| `36_occlusion_selfcheck_probe.py` | 把自检结果 `json.dump` 到 `out/probe/`，**不建目录** | 写盘前 `os.makedirs(out/probe, exist_ok=True)` | 它是**唯一不依赖任何第三方资产就能跑**的脚本（不加载模型、不读 vendor）⇒ 干净检出上第一次跑就会 `FileNotFoundError`，而那是"目录没建"，不是"自检不通过" |
| `63_mem_two_channel.sh` | `PY=<旧工作区路径>/venv/bin/python`（写死，不可覆盖） | `PY="${AUTO_LAYER_PY:-${AUTO_LAYER_SCRATCH:-$HOME/dsh-scratch/auto-layer}/venv/bin/python}"`，且不可执行时**退出码 2** 并提示怎么指 | 解释器是**环境契约**，不是仓库内容；写死会让"跑不起来"表现为一堆难懂的 import 错误 |

> 📌 **未改动**：其余旧工作区路径默认值（`--ckpt` / `--w-*`）**保持原样**——它们本来就是**有 CLI 覆盖口的参数**，且指向的是按设计不放进仓库的 venv／权重（§二 已逐条列出覆盖方式）。
> 📌 **未收拢**：`gen_anchors.py`（为那两份**不在本仓库**的实现报告生成旁挂锚点表的工具，其输入是报告文件与 `logs/`、`evidence/` 的产物）—— 它不属于"分层编排／闸门"这条链，且会引入指向未分发文件的悬空引用，故**排除**。
> 📌 **未收拢**：`10_fetch_weights.sh` / `11_fetch_weights_curl.sh` —— 取权重是使用者的环境准备动作，收进来等于把"下载"包装成"本仓库的安装步骤"。

---

## 十 · 收拢时的验证记录（做到哪一步、哪些标 N/A）

**① 语法层（全绿）**：17 个脚本全部 `py_compile`（`PYTHONPYCACHEPREFIX` 指向 `/tmp`，树里不留 `__pycache__`）＋ `63_mem_two_channel.sh` 过 `bash -n`。

**② 静态扫描：同目录/相对路径引用逐条解析**

| 引用 | 解析结果 |
|---|---|
| `36` → `os.path.join(HERE, "33_make_layers.py")` | ✅ 存在（本目录内） |
| `60` → `HOST/tools/mouth-iso.cjs` | ✅ 存在（`clients/live2d-host/tools/mouth-iso.cjs`） |
| `60` → `HOST/out/demo.html` | ⛔ 缺失 —— **预期阻塞**（宿主未构建，需第三方 `vendor/`+`samples/`） |
| `20/30/31/32/33/40/41` → `ROOT/vendor/see-through/**` | ⛔ 缺失 —— **预期阻塞**（第三方源码未分发） |
| `33` → `ROOT/out/layers/**`、`30` → `ROOT/out/sam/**`、`62` → `ROOT/evidence/**` 等 | ⛔ 尚未存在 —— **运行产物**，脚本自己 `makedirs`（`36` 的缺口已按 §九 修掉） |

**③ 纯函数自测：38/38 通过**（不加载模型、不读 vendor/i2l）

- `35_order_probe.py`：`contained_frac` 四种情形；**修前表 / 修后表的顺序约束**（`hair_back < face < hair_front`、`mouth > face`、`hair_front > mouth`）。
- `33_make_layers.py`：`DRAW_ORDER` 与 `35` 的 `ORDER_AFTER` **逐项相等**、`DRAW_ORDER_LEGACY` 与 `ORDER_BEFORE` 逐项相等（防两张表漂移）；`_hair_split` 的前发⊂脸区域、前+后＝原掩码、无脸掩码时整块按后发。
- `50_wire_to_i2l.py`：`split_lr` 的左右判据与 `min_px` 行为；`SINGLE` 表含 `mouth`/`nose`/`hair_back`/`hair_front` 且 `mouth` 序 > `face_base`。
- `34_layer_regression.py`：`composite` 按绘制序自底向上、重叠处高序层胜出。
- `60_mouth_gate.py`：`_decode_png` 像素往返；`frame_diff` 的差异计数/bbox/`outside_region` 三件（含"窗口盖住差异 → outside=0"）；`mouth_screen_region` 的 `720/1024 = 0.703125` 换算与无嘴层时返回 `None`；两条闸门阈值确为 `20 / 20`。
- `36_occlusion_selfcheck_probe.py`：四条判据自检 **✅ 全符合预期**（① 正常静默通过；② 查不到序、③ 非法组合、④ 序全相同 —— 三条都 `SystemExit` 且脚本内声明值 = 6）。

**④ 实际跑通的（本机无第三方资产也能跑）**

- `00_env_probe.py` **实跑**：`torch 2.11.0`、`mps_built=True`、`mps_available=True`、`cuda=False`；**22/24 项算子 OK**（仅 `float64 matmul`、`randn(mps, generator=cpu)` 失败）；`recommended_max_memory = 17.18 GB` → **与 §六 记录逐项吻合**。
- `63_mem_two_channel.sh calib_only` **实跑**：通道 A `ps -o rss=` = **813 MB**、通道 B `footprint phys_footprint` = **808 MB** ⇒ 单位标定（KB / MB）成立。
- `20_patch_device.py`（缺 vendor）→ `FATAL: 找不到 …inference_utils.py`，退出码 **2**；`--check` 在缺文件时不崩。
- `60_mouth_gate.py`（宿主未构建）→ `[FAIL] 渲染宿主未构建…` **不做任何降级**。
- `63_mem_two_channel.sh`（解释器不可执行）→ `[FAIL] 解释器不可执行`，退出码 **2**。

**⑤ 依赖第三方 → 实跑标 N/A**

`30/31/32/33/34_*/35/40/41/50/62` 与 `60` 的**真实闸门判定**都要求 `vendor/see-through`、i2l 源码、13 GB 权重、官方样本模型或已构建的宿主——这些**都不在本仓库**。因此"端到端复现 §六 的数字"在本仓库里**做不到**：那些数字是原机环境的实测记录，不是本仓库能重跑的东西。**这类失败是预期阻塞，不是代码缺陷。**

**⑥ 已知的粗糙处（如实记，未修）**

- `50_wire_to_i2l.py` 的 `--layerdir` 指向不存在的目录时，抛的是裸 `FileNotFoundError`（退出码 1）——**响亮但不好读**；它对"目录存在但没 png"那条路径是有友好报错的，只漏了"目录本身不存在"。
- `62_mouth_contact_sheet.py` 在 `out/probe/mouthiso_evidence/` 为空时，报的是 `ValueError: max() iterable argument is empty`（退出码 1）——同样是**响亮但不好读**，真正的正解是"先跑 `60_mouth_gate.py`"。
- 两处都**没有**降级成"跳过判据"，所以不违反 §二 的契约；本目录只在"漏报/静默"与"报错不友好"之间选择了后者。

