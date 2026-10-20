# 实现报告 · LAYER-MOUTH —— 拆出「嘴」（我们的核心特征）

> 任务代号 **LAYER-MOUTH**｜日期 **2026-09-24**｜机器 **Apple M3 / 10 核 GPU / Metal 3 / 24 GB / 无 CUDA**
> 产出目录 `开源线/DSH定制/code/tools/auto-layer-mouth/`｜旁挂锚点表 `实现报告_LAYER-MOUTH_嘴与关键部件_2026-09-24.anchors.md`
> 上游链路：`code/tools/auto-layer/`（上一路 L2D-LAYER-GPU 的产物，**本任务只读，未改一个字节**）＋ `image2live2d`（P2L-2 的产物，同样只读）

---

## 〇 · 一句话结论

**「嘴」不是拆不出来 —— 是上一路把它丢在了出层阈值上；而它一旦出层，「说话时嘴动」这条核心特征在真 `.moc3` 里就成立了。**

三句话：

1. **SAM 的 19 类里本来就有 `mouth`（索引 8）**〔A01〕〔A02〕，而且**两轮实测都命中了**：真立绘上 **19 px**〔A10〕、我方平色立绘上 **918 px**〔A11〕。
   → 上一路报告里「SAM 19 类里没有 eyebrow/eye_white/pupil/blush」是对的，但**嘴不在那个名单里**；
   它被单独记在 §5.3 的表里（"SAM 出了 mouth，但本轮该图命中只有 19 px，未达出层阈值"）〔A28〕，
   **没有进"没填上的角色"主清单**〔A13〕，**也没有被翻译成产品后果** —— 而后果恰恰是最严重的那个：
   **没有独立嘴层 ⇒ `.moc3` 表达不了"说话时嘴动"。**

2. **根因是出层脚本的一行默认值，不是模型能力**：`33_make_layers.py` 的 `--min-px` 默认 **200**〔A05〕，
   部件筛选式直接把它滤掉〔A06〕。我方素材的嘴是 918 px，**若当初跑的是那张图，嘴会自动出层**。

3. **把嘴接回去之后，「说话时嘴动」在 A/B 对照里被坐实**：含嘴层的能力表 `mouth_open ✓ (has interior)`〔A27〕、
   `talk` 动作从**被抑制**变成 **shipped**、`ParamMouthOpenY=1` 时渲染像素差 **330 px**（对照：0 px）、
   真 `.moc3` **1,251,904 B**。
   → 🔴 **但同一个结论对"真手绘立绘"只成立一半**：真立绘上 SAM 只给 19 px 的嘴，
   接进去能力表照样报 `✓`，渲染像素差却只有 **5 px** —— **技术上"能"，产品上"看不出"**。

**顺带更正一条方法学**：上一路用 `ps`/`rusage` 的 **RSS** 报内存，本轮实测**同一负载同一时刻**
`ps` 说 **889 MB**、`top` 说 **5269 MB**〔A24〕、`footprint` 说 **5291 MB**——差 **约 6 倍**。
标定后（分配 800 MB 实测）查明：**macOS `top` 的 MEM/rsize 列不是 RSS，是 phys_footprint（含被压缩页）**〔A25〕。
→ 上一路的"轻量路线 RSS 峰值 947 MB / 1269 MB"**没有错，但它是 RSS**；这台机器的真实占用约 **5.2–5.3 GB**。

---

## 一 · ① 定案：嘴在哪一层（事实，不是猜）

### 1.1 SAM 那一路的 19 类，逐字列表

来源：`vendor/see-through/common/live2d/scrap_model.py`（sha256 前 16 位 `62a1a27759368de4`）〔A01〕：

| 索引 | 类名 | 索引 | 类名 |
|---|---|---|---|
| 0 | `hair` | 10 | `neckwear` |
| 1 | `headwear` | 11 | `topwear` |
| 2 | `face` | 12 | `handwear` |
| 3 | `eyes` | 13 | `bottomwear` |
| 4 | `eyewear` | 14 | `legwear` |
| 5 | `ears` | 15 | `footwear` |
| 6 | `earwear` | 16 | `tail` |
| 7 | `nose` | 17 | `wings` |
| **8** | **`mouth`** | 18 | `objects` |
| 9 | `neck` | | |

**回答"有没有 `mouth`／`lip` 类"**：**有 `mouth`，索引 8**〔A02〕；**没有任何含 `lip` 的类**。
另外两张表也在同一个文件里：`VALID_BODY_PARTS_V1`（20 类，**同样含 `mouth`**）〔A04〕、
`VALID_BODY_PARTS_V3`（23 类，含 `irides`／`eyebrow`／`eyewhite`／`eyelash`）〔A03〕。
→ **`mouth` 这个类在三张表里都在**，它不是我们以为缺失的东西。

### 1.2 实测命中（不是"表里有"，是"真的分出来了"）

| 运行 | 输入 | `mouth` 像素 | bbox（y0,y1,x0,x1） | 同图其它脸部件 |
|---|---|---|---|---|
| `sam_mps_test1` | 真手绘立绘 1232×928 | **19**〔A10〕 | 184,186,469,477（3 行 × 9 列） | `nose`=0、`eyewear`=0、`headwear`=0 |
| `sam_mps_ourasset` | 我方 P2L-1 平色立绘 1024×1024 | **918**〔A11〕 | 539,565,490,533（27 × 44） | `nose`=126 |

目视核验（`evidence/01_mouth_mask_overlay_x6.png`，6 倍放大）：那 19 px 的品红块**正好压在嘴的位置上**——
不是误检，是**欠分割**：它只抓到嘴的高光/亮部，没抓整条嘴。
颜色核对也支持这个判断：嘴区均值 RGB `[240.6, 197.1, 179.6]` vs 脸均值 `[228.6, 183.5, 166.6]`，
Δ = `[+11.9, +13.6, +12.9]` —— **比脸更亮更暖**，与"唇线比脸暗"的直觉相反，
说明这 19 px 是唇部的高光而不是整条嘴线。

### 1.3 判据：alpha 加总，分母有没有没被覆盖的像素

`test_image1.png` 是 **RGB（无 alpha）**，所以"原立绘的不透明区"要分三个口径给，才能看出结论稳不稳：

| 分母口径 | 分母 px | 被 12 层覆盖 | 未覆盖 | 未覆盖率 |
|---|---|---|---|---|
| 整张画布（RGB ⇒ 全画布都算不透明） | 1,143,296 | 205,639 | 937,657 | 82.01% |
| **白底泛洪估计的前景**（不依赖 SAM） | 208,752 | 204,446 | **4,306** | **2.06%** |
| SAM 19 类并集（SAM 认为的角色区） | 207,439 | 205,639 | 1,800 | 0.87% |

→ 第三个口径的 1,800 px 缺口，本质是"有的类没被出层"（`nose`/`mouth`/`eyewear` 等），
**不是"没被任何一层覆盖"**。第一口径的 82% 是**背景**（分层结果叠起来背景是透明的，这是设计如此）。

未覆盖像素落在哪（对第二口径做连通域）：最大的块 1,904 px（y 225–756 / x 84–146），
另有一块 928 px 贴在画布最后一行（泛洪估计的边缘伪影）。
**这些块都不在嘴的位置上。**

### 1.4 判据：嘴部像素落在哪一层

按绘制序取"最上面的覆盖层"，`mouth` 的 19 px 归属是：

```
19 px  →  030_face.png    （19 / 19，无一例外）
```

〔A26〕**嘴部像素 100% 落在 `030_face.png` 的 alpha 内。**

### 1.5 三选一的答案

| 选项 | 是否成立 | 依据 |
|---|---|---|
| **(a) 有独立的嘴层**（第一路报告漏说了） | **模型层面成立**：SAM 有 `mouth` 类〔A02〕且实测命中〔A10〕〔A11〕；**产出层面不成立**：出层清单里没有它〔A12〕 | 1.1 / 1.2 |
| **(b) 嘴在 `030_face` 里（＝焊死）** | **在本轮产出里成立**：19/19 px 全部落在 `030_face.png` 的 alpha 内〔A26〕 | 1.4 |
| **(c) 嘴根本没被任何一层覆盖** | **不成立**：嘴的像素**被覆盖了**，且没有任何未覆盖块落在嘴的位置上 | 1.3 / 1.4 |

**所以准确的定案是：(a) 与 (b) 同时成立，且 (a) 是原因、(b) 是结果。**

- **模型这一层**：嘴是独立可分的（有类、有命中）。
- **产出这一层**：它被 `--min-px` 默认 200 滤掉了〔A05〕〔A06〕，于是**在 12 层里表现为"焊死在脸上"**。
- **i2l 那一层也有一道同向的闸**：`50_wire_to_i2l.py` 的角色直映表里**根本没有 `mouth` 这一项**〔A09〕，
  所以**即便上一路把嘴出了层，接线时也会被静默跳过**。→ 这是**两道独立的闸**，不是一道。

> 🔴 **一句话**：不是"拆不出来"，是"**拆出来了但两道闸都把它放走了**"。

---

## 二 · ② 试拆「嘴／眉／眼白／瞳孔」：四条路线，两条真跑

### 2.0 先读现成实现（项目硬规矩）——最重要的一条先例

`image2live2d`（我们下游的那套）**早就把「嘴」当成一等公民**。逐字原文已抄进
`evidence/prior_art_i2l_mouth_excerpts.md`（V10，17 段，带每段源文件的 sha256 与行号）。要点：

| 事实 | 出处锚点 |
|---|---|
| 角色枚举里**本来就有** `mouth`、`mouth_cavity`、`eyebrow_l/r`、`eye_white_l/r`、`pupil_l/r`、`blush`、`nose` | 〔A23〕 |
| 「能开口」的判据 = **有 `ParamMouthOpenY` 参数 且 有 `mouth_cavity` 角色** | 〔A17〕〔A18〕 |
| 没有腔体时的诚实告警文案：*"mouth cannot open — no interior behind the lips (talk only parts the lip line)"* | 〔A17〕 |
| 腔体由 `synth.mouth` **从嘴层自己的宽度与色相**合成（暗腔/上齿/舌三色，4× 超采样），**闭嘴时垂直压扁为零** | 〔A19〕 |
| 口型同步参数就是 `ParamMouthOpenY`（`LIP_SYNC_PARAMS`）；`talk` 动作 = `Drive({"ParamMouthOpenY": 1.0}, cycles=3, hold=10, settle=20)` | 〔A21〕〔A22〕 |
| 它自己有一张**嘴区合理性包络**（宽度/深度/偏移的上下限，取自 8 个真实角色实测） | 〔A20〕 |

🔴 而且 `core/qa/harness.py` 里有一条 backlog **逐字就叫 `T9 (SAM-mouth-from-source)`**，
并写着"the rival's premise is that See-through's mouth region is unreliable … If a real character trips this check,
that premise is back and the heavy SAM path is justified"。
**我们这一轮，正好就是在给这条 backlog 交第一份真实样本。**

**借什么 / 不借什么**：
- **借**：i2l 的整套嘴机制（腔体合成、参数授权、口型同步、QA 包络）——**零改动复用**，本轮已实测。
- **不借**：i2l 的 `preview.render_pose` 只作**近似**目视（上游 docstring 逐字承认是"approximate piecewise-affine software warp"），
  **不作为验收判据**；真验收仍要看宿主。

### 2.1 路线 A：复用同一条 SAM 19 类的 `mouth` 类（**真跑**）

| 项 | 内容 |
|---|---|
| **要什么输入** | 已有 SAM 掩码（`out/sam/<tag>/masks/`）＋ 原图 ＋ 已有的动漫 LaMa 权重（204.5 MB） |
| **模型体积** | **零新增**（复用 1.29 GB 分割 ＋ 0.20 GB 补全） |
| **本机 MPS 能不能跑** | **能**，本轮实测：单图 **8.4–17.5 s**（含逐部件 LaMa 补全） |
| **预期产出** | 13 层（真立绘）／ 9 层（我方素材），其中**含独立的 `050_mouth.png`** |
| **代价** | 改动只有两处：`--min-px` 阈值（200 → 16）＋ 补全区的遮挡物判据；**零新依赖、零新权重** |

**真跑结果（四种配置）**：

| 图 | 补全判据 | `mouth` 可见 | `mouth` alpha | 膨胀 | `hole` |
|---|---|---|---|---|---|
| ourasset | `above`（只把画在上面的部件当遮挡物） | 918 | **918** | **×1.0** | 0 |
| ourasset | `all`（上游原样） | 918 | 1612 | ×1.756 | 694 |
| test1 | `above` | 19 | **19** | **×1.0** | 0 |
| test1 | `all` | 19 | 27 | ×1.421 | 8 |

接触表：`evidence/20_contact_{test1,ourasset}_{above,all}.png`（含嘴/鼻的逐件展示）。

> 🔴 **这里有一个必须写下来的方法学发现**：上游的补全区算式是
> 「**其它部件的并集** ∩ 本部件外接框 ∩ 非本部件」〔A07〕。
> 对**画在脸上面的小五官**（嘴、鼻），这个定义是**错的** —— 它把"画在**下面**的脸"当成了"盖住嘴的东西"，
> LaMa 于是把嘴外接框里的脸像素重画成嘴 → **嘴层被膨胀 ×1.76**（918 → 1612 px，见上表）。
> 本任务的 `above` 判据〔A14〕〔A15〕把它修好了（膨胀 ×1.0）。
>
> **但 `above` 不是万能修法**：对 `hair` 它反而**变差**（`hole` 从 11,295 → **0**）——
> 因为 SAM 的 `hair` 是**前后发合并的一块**，后发确实被脸遮住，而 `above` 认为脸在头发下面、不算遮挡物。
> → **结论：遮挡关系推不出来自一张合并掩码；`hair` 必须先拆前后（那是重型路线的深度步骤）。
> 在拆之前，`above` 只适用于"画在最上面的小五官"。**
>
> 顺带记一条同源的毛病：**上游那张绘制序表本身也是反的** —— 它把 `hair` 记成 10、`face` 记成 30〔A08〕，
> 也就是让**脸盖在头发上**，与 Live2D 惯例（刘海在最上）相反。
> 本任务的 `FIXED_ORDER` 把 `hair` 提到 120（＝ i2l 的 `hair_front` 序号）才修回来。
> **一张错序表 ＋ 一个"把所有其它部件都当遮挡物"的补全区，是两个独立的错，不能只修一个。**

### 2.2 路线 B：在 SAM 的 `eyes` 掩码内按颜色再切 ＋ 眉毛启发式（**真跑**）

| 项 | 内容 |
|---|---|
| **要什么输入** | 已有 SAM 掩码（`eyes`/`face`/`hair`）＋ 原图 |
| **模型体积** | **零新增**（k-means 走 sklearn，OpenCV 已在隔离 venv 里） |
| **本机 MPS 能不能跑** | 不需要 GPU（纯 CPU，秒级） |
| **预期产出** | `eye_white_l/r`、`iris_l/r`、`pupil_l/r`、`eyelash_l/r`，外加眉毛候选 |
| **代价** | 零新依赖、零新权重；**代价全在准确率上**（见下） |

**真跑结果**：

| 图 | `eye_white` L/R | `iris` L/R | `pupil` L/R | `eyelash` L/R | 眉毛（启发式） |
|---|---|---|---|---|---|
| ourasset（平色） | 684 / 667 | 1042 / 1031 | 677 / 670 | 1367 / 1345 | **317 px，4 个候选，位置正确** |
| test1（真手绘） | 167 / 259 | 228 / 215 | 39 / **2** | 234 / 217 | **0 px，0 个候选** |

接触表：`evidence/30_face_features_{test1,ourasset}_x2.png`。

**为什么在真立绘上退化**（这是诚实记录，不是调参能救的）：
- **眼白/瞳孔**：k-means 的"最亮"簇在真立绘上抓到的是**眼皮与肤色**（簇心 `[238.6, 203.5, 190.1]` ≈ 肤色），
  不是眼白；瞳孔只剩 2 px（右眼）。
- **眉毛**：搜索带被压成 **11 行**（脸掩码顶边 98、眼顶 111 —— 因为刘海盖住了额头，SAM 的 `face` 就从眼睛上方开始），
  加"比脸暗 25 灰阶、且不属于头发"两条筛选之后，候选归零。

→ **路线 B 的结论：在平色/大块素材上可用，在真手绘立绘上不成立。**

### 2.3 路线 C：换 23 类的 V3 标签表（**只给方案，没跑**）

`VALID_BODY_PARTS_V3`（源码里就有）〔A03〕＝
`front hair / back hair / headwear / face / irides / eyebrow / eyewhite / eyelash / eyewear / ears / earwear / nose / mouth / neck / neckwear / topwear / handwear / bottomwear / legwear / footwear / tail / wings / objects`（23 类）。

| 项 | 内容 |
|---|---|
| **要什么输入** | **一份 23 类的分割权重** |
| **模型体积** | 结构不变（只换 `class_num`），量级同 1.29 GB |
| **本机 MPS 能不能跑** | **能**（本轮已证这套模型在 MPS 上跑得动） |
| **预期产出** | 一次补齐 `eyebrow` ＋ `eyewhite` ＋ `irides` ＋ `eyelash`，**且是语义分割出来的，不是颜色切的** |
| **代价 / 卡点** | 🔴 **权重不存在**：HF 仓库 `24yearsold/l2d_sam_iter2` 的 API 实测**只有 `checkpoint-18000.pt` 一个文件**（19 类）。要么自己训（训练代码在 `training/`，需要 Live2D 源工程数据），要么另找模型。**卡在权重，不是算力。** |

### 2.4 路线 D：关键点 ＋ 几何裁切（**只给方案，没跑**）

`vendor/see-through/annotators/anime_face_detector/` **已经带了这套东西**：
yolov3 检脸 ＋ hrnetv2 关键点（`create_detector()` 直给）。

| 项 | 内容 |
|---|---|
| **要什么输入** | 原图；权重从 GitHub Releases 取（`mmdet_anime-face_yolov3.pth`、`mmpose_anime-face_hrnetv2.pth`） |
| **模型体积** | 两个 `.pth`，量级远小于 1.29 GB |
| **本机 MPS 能不能跑** | 未知（没装，没测） |
| **预期产出** | 脸框 ＋ 68 点关键点 → **按框把嘴/眉/眼白/瞳孔裁出来**，完全不依赖语义分割 |
| **代价 / 卡点** | 🔴 **要装 mmdet / mmcv / mmpose**（隔离 venv 里三个都没有），且上游 README 明写 mmdet **需要 CUDA 工具链**。→ 按纪律**先报告再装**，本轮**没装**。 |

### 2.5 「如果拆不出来 → 最少要补什么」

**先纠正一个可能的误解**：本轮**不是"拆不出来"** —— 嘴**拆出来了**（路线 A，膨胀 ×1.0，接触表在案）。
真正的问题是**尺寸**：

- **我方平色素材（嘴 918 px）**：什么都不用补，**降阈值 ＋ 接上 i2l 映射**即可（本轮已证 330 px 像素差）。
- **真手绘立绘（嘴 19 px）**：**调阈值救不了** —— 19 px 是**模型给的上限**，不是阈值砍掉的。
  最少要补的是「**让嘴的分割结果达到可用尺寸**」，三条路按代价排序：
  1. **画师补一张「闭嘴/张嘴」差分图**（最稳、人力最小）→ 嘴层与口腔层直接来自差分，不用合成、不用猜。
  2. **换 23 类分割权重**（路线 C）→ 但要先解决权重从哪来。
  3. **上关键点做几何裁切**（路线 D）→ 要装 mmdet/mmcv/mmpose。

---

## 三 · ③ 能不能表达「说话时嘴动」——能，但有条件

### 3.1 A/B 对照（两套层只差一个 `mouth` 文件）

用我方平色立绘（嘴 918 px）跑同一套 i2l 管线。
接线时嘴层按 `050_mouth.png → 040_mouth.png` 改名映射进 i2l 的角色表〔A16〕（这是本轮新加的那一行）：

| | **含嘴层** | **对照：去掉嘴层** |
|---|---|---|
| 层数 / 部件 / 参数 | 9 / 14 parts / **16 params** | 8 / 12 parts / 14 params |
| 能力发现 `mouth_open` | **✓（has interior）**〔A27〕 | **✗（lip line only）** |
| 能力发现 `mouth_form` | **✓** | **✗** |
| `talk` 动作 | **shipped** | **被抑制（suppressed）** |
| `smirk` 动作 | shipped | 被抑制 |
| `ParamMouthOpenY` 位移（模型空间） | 嘴唇 **0.00928** @1 档；合成腔体 **0.012207** @0 档（＝被压扁） | 无此参数 |
| **渲染像素差（0 档 vs 1 档）** | **330 px**（bbox 368,401–399,431） | **0 px** |
| 真 `.moc3` | **1,251,904 B**，头 `4D4F433301000000`（MOC3 v3.00） | 1,009,920 B，同头 |

目视证据：`evidence/60_zoom_ourasset_with_mouth_mouth_x12.png`（12 倍放大，左闭右开 —— 闭是小透镜、开是完整暗腔）。

**真立绘（test1，嘴 19 px）同样的 A/B**：

| | 含嘴层 | 去掉嘴层 |
|---|---|---|
| `mouth_open` / `mouth_form` | ✓ / ✓ | ✗ / ✗ |
| `talk` | shipped | 被抑制 |
| `ParamMouthOpenY` 位移 | 嘴唇 **0.001002** @1 档 | 无 |
| **渲染像素差** | 🔴 **5 px** | 0 px |
| `.moc3` | 4,326,592 B | 4,098,560 B |

目视证据：`evidence/60_zoom_test1_with_mouth_mouth_x12.png` —— **几乎看不出差别**。

### 3.2 结论

> **能表达，但取决于嘴层有多大。**
>
> - 嘴层 **918 px**（我方平色素材）→ **成立**：`mouth_open ✓`、`talk` 动作 shipped、开合像素差 330 px。
> - 嘴层 **19 px**（真手绘立绘）→ **技术成立、产品不成立**：能力表照样报 ✓、`talk` 照样 shipped，
>   但开合像素差只有 **5 px** —— **接上了，但看不见**。
>   🔴 **这一类"能力表绿了、画面没变"的静默失准，正是 i2l 自己那条 `T9` backlog 想抓的东西。**

### 3.3 参数名与形态（我们宿主要用的那几个）

| 参数 / 角色 | 形态 | 出处 |
|---|---|---|
| `ParamMouthOpenY` | **0.0 → 1.0**，默认 0；口型同步就只认它（`LIP_SYNC_PARAMS`） | 〔A21〕 |
| `ParamMouthForm` | **−1.0 → 1.0**，默认 0（a–i–u–e–o 的嘴形） | 〔A17〕 |
| `talk` 动作 | `Drive({"ParamMouthOpenY": 1.0}, cycles=3, hold=10, settle=20)` | 〔A22〕 |
| `mouth` 角色 | 嘴唇层（我们拆出来的那层） | 〔A23〕 |
| `mouth_cavity` 角色 | **合成腔体**：尺寸取自嘴层的**宽度**、三色取自唇线自己的色相、**闭嘴时垂直压扁为零** | 〔A19〕〔A23〕 |
| Live2D 侧分组 | `Mouth Open` / `Mouth Form` 归到 `Mouth` 组 | 〔A21〕 |

**「说话时嘴动、写字时嘴不动」怎么落地**：`talk` 动作驱动 `ParamMouthOpenY`，
而 `talk` 这个 clip **只在有嘴层时才存在**（没有嘴层时它出现在能力表的 `suppressed` 名单里）。
→ **宿主侧的"两条通道"天然可分**：说话时喂 `talk`（或直接写 `ParamMouthOpenY`），写字时不喂。
这与我们已有的 L1–L4 能力发现是**同一套判据**（`parseCapability` 读的就是 model3/cdi3 里的参数表）。

### 3.4 i2l 自己的嘴区包络：我们的结果落在哪

i2l 的包络取自 **8 个真实角色**实测（宽度 0.133–0.237 倍脸宽、深度 0.808–0.881、水平偏移 ≤0.9%）〔A20〕。
用本轮真实 mesh 算出来的值：

| 图 | 宽度 / 脸宽 | 深度 | 水平偏移 | i2l 的 QA |
|---|---|---|---|---|
| ourasset | **0.105** | 0.752 | 0.000 | 无告警 |
| test1 | **0.073** | 0.741 | 0.101 | 无告警 |

→ **两张都落在包络内（不告警），但都低于真角色实测下限 0.133** ——
与 §1.2 的"SAM 嘴欠分割"是同一个事实的两个侧面。
**包络没报警，不等于嘴区是对的**（i2l 自己写明这张包络只抓"错得离谱"的情况）。

---

## 四 · ④ 内存测量：两条独立命令的交叉验证（给以后所有人）

### 4.1 先标定，再测量（否则三个数差 10 倍不知道信谁）

`scripts/43_mem_cmd_calibration.sh`：分配**已知的 800 MB** 并**逐页触碰**（保证真落物理页），
同时对同一个进程问四条通道〔A25〕：

| 通道 | 报出的值 | 单位（实测确定） | 准不准 |
|---|---|---|---|
| `/usr/bin/time -l` 的 `maximum resident set size` | **814 MB** | **字节** | ✅ 峰值（内核 rusage，单调累计，采样漏不掉） |
| `ps -o rss=` | **814 MB** | **KB** | ✅ 瞬时值 |
| `top -stats rsize`（MEM 列） | **809M** | **MB** | ✅ |
| `footprint <pid>` 的 `phys_footprint` | **809 MB** | **MB** | ✅（含被压缩页） |

→ **无内存压力时，四条通道一致（差 ≤1%）。单位也就此确定。**

### 4.2 有内存压力时，它们分道扬镳

同一个负载（SAM 语义分割，MPS），**同一时刻**：

| 通道 | 报出的值（三次运行的范围） | 与真值的差 |
|---|---|---|
| `ps -o rss`（瞬时峰值） | **394–890 MB** | 偏小 |
| `/usr/bin/time -l` maximum RSS（全程峰值） | **606–1580 MB** | 偏小 |
| `top -stats rsize`（瞬时峰值） | **5220–5269 MB**〔A24〕 | —— |
| `footprint phys_footprint`（瞬时峰值） | **5220–5291 MB** | —— |

**关键发现（逐行核对采样文件得出）**：`top` 的 rsize 列与 `footprint` 的 phys_footprint
**在稳定采样行上逐行相等**（5220/5220、2997/2997、3001/3001、302/301）；
只有**第一行**不等（3683 vs 2456）—— 因为 `top -l 2` 是**两个样本的平均**，对快速爬升段有滞后。
→ 🔴 **macOS `top` 的 MEM/rsize 列不是 RSS，是 phys_footprint（含被压缩页）。**

**这就解释了上一路的"47 MB vs 20–23 GB"**：不是谁读错了，是**两个命令量的不是同一个东西**，
而在内存压力下它们相差一个量级。系统侧的佐证：本轮实测同一时段
`Pages stored in compressor` Δ **+24,295 ~ +449,107**、`Swapouts` Δ **+2,147 ~ +595,381**〔A24〕附近，
swap 从 4.4 GB 涨到 5.2 GB —— **确实在压缩与换出**。

### 4.3 本任务的规矩（写进报告，给以后所有人）

1. 🔴 **凡结论涉及内存，必须写清"用哪个命令测的"**，并**至少两条独立通道交叉验证**。
2. 🔴 **报内存必须区分三个口径**，不许混着写：
   - **RSS**（`ps -o rss` / rusage `ru_maxrss`）→ **不含**被压缩与被换出的页，**压力大时系统性偏小**；
   - **phys_footprint**（`footprint` / `vmmap`）→ **含**压缩页，更接近"这块进程真实占了多少"；
   - **系统级**（`vm_stat` 的 compressor / swapins / swapouts ＋ `sysctl vm.swapusage`）→ 判断"是不是在换页"。
3. 🔴 **单位必须实测标定**，不许照抄文档：本轮实测 `time -l` = 字节、`ps` = KB、`top` = MB。
4. 🔴 **不能用 `pgrep -f 脚本名` 取被测 pid**：`/usr/bin/time -l <py> 脚本.py …` 的命令行里也含脚本名，
   会先匹配到包装进程 → 本轮第一版就采到了包装器，得出"通道 B 只有 1 MB"的荒谬结论。
   **正确做法：让被测负载自己把 pid 打出来。**
5. **瞬时采样会漏峰**：0.5 s 采样峰值（394–890 MB）低于内核全程峰值（606–1580 MB）。
   → **要峰值就用 rusage，要曲线就用采样，两者都要。**

### 4.4 对上一路数字的更正

上一路报的「轻量路线 RSS 峰值 **947 MB**」「分割 RSS 峰值 **1269 MB**」——
**作为 RSS 没有错**，但**作为"这条路要多少内存"偏低约 4 倍**：
本轮同一负载的 phys_footprint 峰值是 **5.2–5.3 GB**。
在 24 GB 机器上，这仍然是安全的；但**"轻量路线只占 1 GB"这个印象必须改掉**。

---

## 五 · 复现入口（一条命令一条命令）

```bash
TOOL="/Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/tools/auto-layer-mouth"
PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python          # 隔离 venv（auto-layer 已建，本轮未改）
PYI=/Library/Frameworks/Python.framework/Versions/3.13/bin/python3 # 跑 i2l 用（本机已有 pydantic）
export SSL_CERT_FILE=/etc/ssl/cert.pem                             # 本机 Clash TUN 的坑

# ① 定案：19 类表 / alpha 加总 / 嘴部像素归属
$PY "$TOOL/scripts/10_probe_mouth_location.py"

# ② 路线 A：把嘴拆出来（四种配置；above = 修正的遮挡物判据）
for t in sam_mps_test1 sam_mps_ourasset; do for m in above all; do
  $PY "$TOOL/scripts/20_make_layers_with_mouth.py" \
      --samdir "../auto-layer/out/sam/$t" --tag "${t}_$m" --min-px 16 --hole-mode $m
done; done

# ② 路线 B：眼白/虹膜/瞳孔/睫毛 + 眉毛启发式
$PY "$TOOL/scripts/30_split_face_features.py" --samdir "../auto-layer/out/sam/sam_mps_ourasset" --tag ourasset

# ③ A/B：含嘴 vs 不含嘴 → 能力表 / 位移 / 渲染像素差 / 真 .moc3
PYTHONPATH=/tmp/p2l2/src/image2live2d-main/src \
  $PYI "$TOOL/scripts/50_wire_mouth_to_i2l.py" --layerdir "$TOOL/out/layers/ourasset_above/layers" --tag ourasset
$PY "$TOOL/scripts/60_zoom_mouth_evidence.py" --tag ourasset --variant with_mouth --k 12

# ④ 内存：先标定，再交叉验证
bash "$TOOL/scripts/43_mem_cmd_calibration.sh" 800
HOLD=8 bash "$TOOL/scripts/41_mem_crosscheck.sh"

# 先例摘录（可核的逐字原文）
$PYI "$TOOL/scripts/70_collect_i2l_excerpts.py"

# 机核（退出码必须 0）
/opt/homebrew/bin/node "/Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/tools/anchors/check-anchors.mjs" \
  "/Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/实现报告_LAYER-MOUTH_嘴与关键部件_2026-09-24.md" --list
```

---

## 六 · 未做到项（诚实清单）

1. **路线 C（23 类 V3 权重）没跑**：HF 仓库实测只有 19 类的 `checkpoint-18000.pt`，**公开权重不存在**；
   自己训需要 Live2D 源工程数据，超出本任务范围。
2. **路线 D（关键点）没跑**：要装 `mmdet/mmcv/mmpose`（隔离 venv 里没有，且上游 README 明写 mmdet 需 CUDA 工具链）。
   🔴 **按纪律"要装/下新的先报告"，本轮没装、没下。**
3. **没做宿主侧真机验收**（`code/clients/live2d-host/`）：那是 P2L-2 的地盘，本任务不碰。
   本轮的"330 px 像素差"来自 i2l 的**近似**软件光栅（上游 docstring 自认 approximate），**不是** Live2D 渲染器的输出。
4. **没做"真立绘 ＋ 画师差分图"的对照**：没有差分素材。
5. **眉毛只有启发式结果**，且**在真立绘上归零**；没有拿到可用的替代结果（C/D 两条都被依赖卡住）。
6. **只测了 2 张图**（上游 `test_image1.png` ＋ 我方 P2L-1 平色立绘）。
7. **`hair` 前后拆分没做**：所以 §2.1 的 `above` 判据**只对小五官成立**，对 `hair` 反而不如上游原样。
8. **没做批量**：全部是单图实测，没有 20 张的批量耗时。

---

## 七 · 边界声明与待确认清单

### 7.1 边界声明（本任务碰了什么、没碰什么）

- 🔴 **只写了两个地方**：本任务产出目录 `code/tools/auto-layer-mouth/` 与两份报告（正文＋旁挂锚点表）。
- 🔴 **`auto-layer/` 全程只读**：本任务**没有修改**它任何一个文件（包括 `scripts/33_make_layers.py` 与 `scripts/50_wire_to_i2l.py`）。
  本任务用的是**自己的副本逻辑**（`20_make_layers_with_mouth.py` / `50_wire_mouth_to_i2l.py`），只 `import` 它 `vendor/` 下的只读代码。
  → **因此 §2.1 与 §3 的结论都还是"方案＋实测"，不是"已经改好了"。**
- 🔴 **`image2live2d`（`/tmp/p2l2/...`）只读**；本任务没有修改它，只调它的公开 API。
- 🔴 **`code/plugins/**`、`code/clients/**`、`code/classrooms/**`、`code/skills/**`、`code/acceptance/**`、
  `code/tools/` 下别的目录（含 `auto-layer/`、`psd2moc3/`）、`~/SocraticNovel-wt/`、`~/SocraticNovel-GitHub仓库/`、
  `/Applications/DSH Desktop.app`、任何 profile —— 全部未触碰。**
- **没有 `git commit`／`git push`。**
- **没有新增依赖、没有下载新权重**（只用隔离 venv 里已装的 sklearn/OpenCV/PIL/numpy 与已下的 LaMa/SAM 权重）。

### 7.2 待确认清单（按默认继续、标注为待确认）

| # | 待确认 | 选项 | 倾向 |
|---|---|---|---|
| 1 | 是否允许**下载新权重**（23 类分割、或别的动漫 face parsing 模型）？ | ① 允许，我去找/训 ② 不允许，只用现有 | 待用户定 |
| 2 | 是否允许**安装 mmdet/mmcv/mmpose**（关键点路线 D）？ | ① 允许 ② 不允许 | 待用户定（可能牵涉 CUDA 工具链） |
| 3 | 是否允许**改 `auto-layer/` 的 `33_make_layers.py` 与 `50_wire_to_i2l.py`**（把 mouth/nose 纳进出层清单与 i2l 映射）？ | ① 允许 ② 由 auto-layer 那条线自己改 | 本任务明令不改，**建议由 auto-layer 线执行** |
| 4 | 是否给画师派「同一角色 闭嘴/张嘴 差分图」？ | ① 派 ② 先不派 | **倾向派**（§2.5 第 1 条，最稳） |
| 5 | 要不要做 `hair` 前后拆分（重型路线深度步骤）？ | ① 做 ② 不做 | 待用户定 —— 它同时决定 `above` 补全判据能否通用 |
| 6 | 真手绘立绘上「能力表绿了但只动 5 px」要不要设一道**产品级闸门**（例如开合像素差 < 20 px 就报红）？ | ① 设 ② 不设 | **倾向设**（i2l 自己的 T9 就是这个意图，但它只查几何不查渲染） |

### 7.3 风险提示（至多三行，不解读）

- 本轮只**列出**权重与模型的链接，**不解读**其使用条件；`24yearsold/l2d_sam_iter2`（HF）与
  `hysts/anime-face-detector`（GitHub Releases）两页**是否写明使用条件，本任务未逐字核**。
- `see-through` 仓库根有 `LICENSE` 文件，`image2live2d` 仓库根也有 `LICENSE` 文件，**内容本任务未读**。
- 以上两项如需判断，请用户自行研究；本任务按项目纪律不展开。
