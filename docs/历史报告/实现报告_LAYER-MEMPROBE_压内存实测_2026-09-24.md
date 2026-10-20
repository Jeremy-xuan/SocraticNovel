# 实现报告 · LAYER-MEMPROBE —— 重型分层到底能不能压进 17 GB

> 任务代号 **LAYER-MEMPROBE**｜日期 **2026-09-24**｜机器 **Apple M3 / 10 核 GPU / Metal 3 / 24 GB 统一内存 / 无 CUDA**
> 产出目录 `开源线/DSH定制/code/tools/auto-layer-memprobe/`｜旁挂锚点表 `实现报告_LAYER-MEMPROBE_压内存实测_2026-09-24.anchors.md`
> 上游：[shitagaki-lab/see-through](https://github.com/shitagaki-lab/see-through)（SIGGRAPH 2026）
> 前置报告：`实现报告_L2D-LAYER-GPU_本地GPU自动分层_2026-09-24.md`（权重已在本机、venv 已建，本轮**不重下**）

---

## 〇 · 一句话结论

**🔴 不能。压不到 17 GB —— 但差距不在"权重"，而在"一次前向的激活值 + VAE 解码"，而这两块目前都压不下去。**

| 问题 | 实测答案 |
|---|---|
| 重型路线**未压内存**时峰值多少 | **21.83 GB**（仅装载，不跑前向）～ **22.02 GB**（跑完 body＋head 两趟） |
| **载入即 bf16** 能省多少 | **10.72 GB**（装载 21.83 → 11.11 GB）—— 这一条**非常有效** |
| **逐组件装载＋及时释放** 能省多少 | **3.84 GB**（两份同在 14.95 → 逐组件 11.11 GB）；⚠️ 它降的是"下一个组件载入时的起点"，**不降峰值本身** |
| **切片/分块推理** 能省多少 | attention slicing 让单 UNet 前向 **19.03 → 13.98 GB**；但**VAE 解码**把它又推回 22 GB |
| 压内存后**能不能跑完一次完整 call** | ⚠️ **只跑通了前两趟**（768²、1 步，body＋head 出 26 张层，**含 `mouth`**）；**第三趟 marigold 跑不通**（`Invalid buffer size: 15.82 GiB`，与内存无关）。整次峰值 **22.62 GB**，仍然超 17 GB |
| **最低需要多少内存** | **≈ 22.6 GB**（768² 完整 call）／ **19.73 GB**（1280² 的 UNet 单跑，实测；完整 call 只会更高） |
| 让用户今晚清机器 | 🔴 **别清**。理由：清了也装不下（差 5 GB），且还有一道与内存无关的上游 bug（见 §四） |

**一句话**：**清机器解决不了这个问题** —— 瓶颈不是"别的程序占了内存"，而是这条管线**自己**在 768² 上就要 22 GB。

---

## 一 · 测什么、怎么测

### 1.1 这一轮要回答的唯一问题

用户愿意清空机器、把 24 GB 里的 **≈17 GB**（70%）给一晚上。上一路实测重型路线（See-through）整条管线峰值 **23 GB**、swap 打满 96%、被换页拖死。
→ 所以：**能不能把峰值压到 ≈17 GB 以下？** 能，则清机器有意义；不能，则**别让他白折腾一晚**。

### 1.2 测量方法（🔴 本任务的方法学纪律）

上一路差点误判一次：**`ps aux` 报的 RSS 不含被压缩/换出的页** —— 进程真实占 20–23 GB 时 `ps` 只报 **47 MB**，据此会得出"它没在干活"的相反结论。
所以本轮**不用 `ps`**，改用**三条互相独立的通道**，报告里所有内存数字都标明出处：

| 通道 | 命令 | 量的是什么 | 本轮的用法 |
|---|---|---|---|
| ① **权威** | `/usr/bin/time -l` 的 **`peak memory footprint`** | 进程的 **phys_footprint 峰值**（含被压缩页的系统记账） | **所有"峰值"结论都用它** |
| ② 交叉 | 同一条 `time -l` 的 `maximum resident set size` | 进程峰值 RSS（**不计被压缩/换出的页**） | 用来**证明通道①为什么必须存在**（见 §二之三） |
| ③ 采样 | `top -l 1 -pid <PID> -stats mem,rsize` 每 2 秒一次 ＋ `vm_stat` ＋ `sysctl vm.swapusage` | 进程 MEM 列（瞬时 phys_footprint）＋ 系统级压缩器/swap | 给出**时间序列**，定位峰值发生在哪一段 |

工具：`scripts/memwatch.sh`〔A09〕（采样器）＋ `scripts/run_measured.sh`〔A10〕（把受测命令包在 `time -l` 里、并让采样器拿到**真正在跑的那个进程**的 pid —— 不是 `/usr/bin/time` 自己的 pid）。

**为什么 `peak memory footprint` 比 RSS 准**：macOS 在内存压力下会把进程的匿名页压缩进 compressor（记账仍属该进程），换出的页则落在 swap。`ru_maxrss` 统计的是**曾经驻留过**的部分，被压缩/换出的部分会**从 RSS 里消失**；而 `phys_footprint` 把压缩页算回该进程。本轮的实测把这个差异量得非常清楚（§二之三：同一进程 RSS 542 MB / footprint 19.03 GB）。

### 1.3 测试负载的诚实交代

🔴 **本轮的测量是在"机器上有别的程序在跑"的情况下做的** —— 依任务纪律，**我没有去杀任何别的进程**。
测量期间系统现状（`top`／`sysctl vm.swapusage` 实读）：**PhysMem 约 15 GB 已用 / 约 8.9 GB 空闲；swap 已用约 2.5 GB**。

这个现状**不影响**峰值结论，因为 `peak memory footprint` 量的是**受测进程自己**的占用；但它**影响耗时与换页表现**（系统压力大时，受测进程的页更容易被换出）。§三之三的对照实验（同一配置、同一天）可以佐证：结论方向一致。

---

## 二 · ① 基线：现在到底占多少

### 2.1 上一路留下的数字（作为对照）

| 项目 | 上一路实测 |
|---|---|
| 整条管线峰值 | **23 GB**（`top` 实测） |
| swap | used **34.47 / 35.84 GB**（96%） |
| 进程状态 | `STAT=U`（不可中断等待），`ps` 报 RSS 仅 47 MB |
| 抓栈 | `at::MPS_gelu` → MPSGraph → Metal → `_dispatch_semaphore_wait_slow`（**确实在算，被换页拖死**） |
| 隔离实验（只跑 SDXL UNet） | fp32 载入 15.10 s；`.to(mps,bf16)` 10.38 s；forward 40.47 s / 101.1 s；**MPS driver 峰值 19.87 GB** |

上一路**没做**的事（它自己列在"要不要继续啃内存"的选项里，判了"不啃"）：**fp16 ＋ 逐组件装载**。本轮就是补这一刀。

### 2.2 本轮基线：复现上游默认路径的**装载**峰值

上游两条装载路径逐字都是"**先 fp32 载入、再 `.to(bfloat16)`**"〔A01〕：`from_pretrained` 不传 dtype，随后 `pipeline.unet.to(dtype=torch.bfloat16, device=...)`。
在 PyTorch 里 `module.to(dtype=...)` 是**非原地**的（先建新张量、再替换参数）→ **转换的那一瞬间，fp32 与 bf16 两份权重同时在场**。

磁盘上的 `unet/diffusion_pytorch_model.safetensors` 实测 **8,142,919,672 B ÷ 4071.3 M 参数 = 2.000 B/参数** → **磁盘上本来就是 bf16**。所以"默认 fp32 载入"是**凭空翻倍**：

| 实验 | 载入 dtype（参数直方图实测） | **peak footprint** | MPS allocated | 耗时 |
|---|---|---|---|---|
| `10_unet_load_dtype.py --mode fp32` | `torch.float32` 4071.3 M | **17.83 GB** | 8.14 GB | 33.41 s |
| `10_unet_load_dtype.py --mode bf16` | `torch.bfloat16` 4071.3 M | **9.56 GB** | 8.14 GB | 14.41 s |

（参数直方图是从模型里逐个参数统计出来的，不是看文件名猜的。）

**只这一个 UNet，默认路径就要 17.83 GB。** 而整条管线还有 vae / trans_vae / text_encoder / text_encoder_2。

### 2.3 完整装载基线（LayerDiff 管线，不跑前向）

`20_pipeline_load.py --stage layerdiff` 复刻上游装载段（trans_vae ＋ unet ＋ vae ＋ text_encoder ＋ text_encoder_2）：

| dtype | **peak footprint** | maximum RSS | MPS allocated | MPS driver | 耗时 |
|---|---|---|---|---|---|
| **fp32（上游默认）** | **21.83 GB** | 15.96 GB | 10.16 GB | 10.54 GB | 44.64 s |
| **bf16（载入即半精度）** | **11.11 GB** | 1.15 GB | 10.16 GB | 10.54 GB | 17.18 s |

**fp32 那一次的现场**（`memwatch` 时间序列，见 `evidence/mem_e2_layerdiff_fp32.csv`）：

- swap used 从 5.8 GB 一路涨到 **12.95 GB**（swap total 被系统动态扩到 14 GB）
- 系统 free 内存最低到 **57 MB**
- compressor 峰值 **12.8 GB**
- 进程 MEM 峰值 **20480 MB**

→ **这就是"换页地狱"的可复现画像**：21.83 GB 的需求撞上 24 GB 的机器。

🔴 **方法学的直接证据**：同一次运行里，`/usr/bin/time -l` 报 **maximum resident set size = 15.96 GB**，而 **peak memory footprint = 21.83 GB** —— 差 **5.87 GB**。
那 5.87 GB 就是**被压缩/换出、因而从 RSS 里消失**的部分。**只看 RSS 会低估近 6 GB。**

---

## 三 · ② 三条压内存手段，各给数字

### 3.1 手段一：fp16/bf16 **全程**（不 fp32 载入再转换）

**做法**：`from_pretrained(..., torch_dtype=torch.bfloat16)`，让权重**从磁盘到内存就是 bf16**，全程不出现 fp32 副本〔A06〕。

| 场景 | 默认路径（fp32 载入再转） | 载入即 bf16 | **省** |
|---|---|---|---|
| UNet 单模型 | **17.83 GB** | **9.56 GB** | **8.27 GB** |
| LayerDiff 整条管线（装载） | **21.83 GB** | **11.11 GB** | **10.72 GB** |

- **swap 是否仍被打满**：fp32 时 yes（used 12.95 GB、free 到 57 MB）；bf16 时 **no**（used 峰值 5.89 GB，free 最低 14 MB 但随即恢复）。
- **能不能跑完**：两者都能跑完"装载"这一步；bf16 还快 2.6 倍（17.18 s vs 44.64 s）。
- **代价**：无。磁盘上本来就是 bf16，载入即 bf16 **不损失任何精度**（不是"降精度换内存"，是"别白白翻倍"）。

> 🔴 这一条是本轮**最值钱的一刀**，而且它**不需要改上游逻辑**——只改 `from_pretrained` 的一个参数。

### 3.2 手段二：逐组件装载 ＋ 及时释放

**做法**：不让两份管线同时在场。载 LayerDiff → 用完 `del` ＋ `gc.collect()` ＋ `torch.mps.empty_cache()` → 再载 Marigold〔A12〕。
上游用的是**模块级 global 单例**（`layerdiff_pipeline` / `marigold_pipeline`），跑完一轮两份都还挂着。

**🔴 先说一个实测踩到的坑**：第一版脚本里，`del pipe` 之后 `current_allocated_memory` **纹丝不动（仍是 8.52 GB）** —— 因为跑 pipeline 的那个闭包**引用着 `pipe` 这个名字**，引用计数没归零。
改成"用 dict 容器持有、置 `None` 断开"之后才真正释放。**这类"以为释放了其实没释放"的坑，只有量 `allocated_memory` 才看得见。**

**实测对照**（`20_pipeline_load.py`，两种 stage 各跑一个独立进程，均为 bf16）：

| stage | 过程 | MPS allocated 峰值 | **peak footprint** |
|---|---|---|---|
| **concurrent**（两份都留着，＝上游 global 单例的实际行为） | 载 LayerDiff（10.16 GB）→ 再载 Marigold（＋3.27 GB） | 13.43 GB | **14.95 GB** |
| **serial**（逐组件装载＋释放） | 载 LayerDiff（10.16 GB）→ **释放** → 载 Marigold（3.27 GB） | 10.16 GB | **11.11 GB** |

释放那一步的现场读数：**`MPS allocated 0.0 GB / driver 0.0 GB`**（从 10.54 GB 直接归零，说明释放是彻底的）。

- **省 3.84 GB**。
- **swap 是否仍被打满**：两种都没打满（swap used 峰值均 < 6 GB）。
- **能不能跑完**：两种都跑完了"装载"这一步；serial 更快（20.54 s vs 22.16 s）。
- ⚠️ **它的作用范围要说清**：逐组件释放**不降低"峰值本身"**（峰值发生在某一趟前向的中间），它降的是**下一个组件载入时的起点**。所以对"整条 call 的峰值"帮助有限 —— 真正决定峰值的是 §3.3 与 §五 那两块。

### 3.3 手段三：分块／切片推理 —— **先读上游有没有现成开关**

任务要求"先读上游有没有现成开关，别自己发明"。**读的结果：上游仓库里确实自带两条省内存路径，但都不可用于本机；真正能用的是 diffusers 自己的开关。**

| 上游自带的省内存路径 | 逐字位置 | 本机能不能用 |
|---|---|---|
| `inference/scripts/inference_psd_blockswap.py`：`enable_blockswap(device)` —— UNet **块级换页**（forward 前把 block 挪上卡、forward 后挪回 CPU） | 上游脚本 | ⚠️ **可改 device 试，但**它把 `blockswap_device` 硬写成 `torch.device("cuda")`，且换页用 `torch.cuda.empty_cache()`；MPS 上每块往返传输会让本就 40–100 s/步的前向再慢一大截。**本轮未跑**（见 §八未做到项） |
| `inference/scripts/inference_psd_quantized.py`：`--quant_mode` NF4（4-bit） | 上游脚本 | ❌ **不可用**：依赖 `bitsandbytes`，而**该包在本机 venv 里不存在**（实测 `ModuleNotFoundError`），且它 CUDA-only |
| `--group_offload`（diffusers 的 `enable_group_offload`） | 上游 `inference_utils.py` 已接线 | ⚠️ 需 accelerate（**本机有 1.13.0**），但上游把它硬写成 `enable_group_offload('cuda', ...)`；MPS 上未验证 |

**真正在本机可用、且实测有效的两个开关（都是 diffusers 自带，不是我们发明的）：**

| 开关 | 作用 | 实测效果（UNet 单跑，768²，13 tag，1 次前向） |
|---|---|---|
| `unet.set_attention_slice("max")` | attention 分块计算，降激活峰值 | driver 峰值 **18.48 → 13.43 GB**；`empty_cache` 后能从 14.64 回落到 **9.12 GB**；系统 **peak footprint 19.03 → 13.98 GB**（**省 5.05 GB**） |
| `pipe.vae.use_slicing = True` | VAE **逐张解码**（diffusers `AutoencoderKL.decode` 里现成的 `use_slicing` 分支） | 见 §五 |

**attention slicing 的代价**：单次前向 **63.01 s → 77.42 s**（**慢 22.9%**）。

> 🔴 一个必须说清的事实：**`enable_vae_slicing()` 这个方法在 diffusers 0.37 的 VAE 上并不存在**（同名方法散在各 pipeline 类上，不在 See-through 这条链上）。第一次跑就是这么失败的（`AttributeError: 'AutoencoderKL' object has no attribute 'enable_vae_slicing'`）。正确做法是直接置 **`vae.use_slicing = True`** —— `AutoencoderKL.__init__` 里默认 `False`，而 `decode()` 里现成写着 `if self.use_slicing and z.shape[0] > 1:` 的逐张分支。**这是用 diffusers 自己的机制，不是自研分块。**

**为什么这条开关对本任务特别关键**：上游 `TransparentVAEDecoder.forward` 逐字是 `pixel = sd_vae.decode(latent).sample`，而 `latent` 的 batch 维**就是 tag 数**（body 组 13 / head 组 11）→ **一次解码 13 张 768² 图**。这正是 §五里峰值居高不下的主因之一。

---

## 四 · 🔴 独立发现：上游在 MPS 上还有一道**与内存无关**的硬阻塞

**这一条不在任务清单里，但它决定了"即使内存够了也跑不通"。**

`TransparentVAEDecoder.estimate_augmented` 末尾逐字是〔A03〕：

```
result = torch.stack(result, dim=0)      # 每个 eps 是 4 维 → stack 后变 5 维
median = torch.median(result, dim=0).values
return median
```

Apple MPS 上 `torch.median` 走 `MPSNDArraySort` kernel，而它**只支持 axis = 0,1,2,3**（最多 4 维）。对 5 维张量求 median 会触发 **Metal 层断言并直接 abort 进程**：

```
MPSNDArraySort.mm:208: failed assertion `(null)" Axis = 4. This class only supports axis = 0, 1, 2, 3'
```

🔴 **这是 Metal 断言，不是 Python 异常** —— `try/except` 抓不住，进程直接死（**退出码 134 / SIGABRT**）。第一版完整 call 就是这么崩的。

**最小复现（本机实测，`evidence/` 有台账）**：

| 形状 | 设备 | 结果 |
|---|---|---|
| 4 维 `[2,4,32,32]` median | MPS | ✅ OK |
| **5 维 `[1,1,4,32,32]` median** | **MPS** | ❌ **abort**（`Axis = 4 ... only supports axis = 0, 1, 2, 3`） |
| 5 维同张量 median | CPU | ✅ OK |

→ 说明**不是形状非法，是 MPS 的 kernel 限制**。

**为什么"直接返回 `result[0]`"是恒等变换、不是降级**：同一个函数的循环体逐字以 `result += [eps]` 紧接着 **`break`** 结束 → **`len(result)` 恒等于 1**。单个元素的 `median(stack([x]), dim=0)` 数学上**恒等于 `x`**。
所以本轮的 `scripts/vae_mps_patch.py`〔A07〕把它替换成 `return result[0]`，并且**在 `len(result) != 1` 时抛异常**（万一上游哪天去掉 `break`，median 就不再恒等，那时**必须响亮报错**，不许静默换个东西顶上）。

> 这是**上游的真 bug**（一段被 `break` 短路的 8 路 augmentation 代码，只留下一个必然退化的 `median`），不是"我们为了跑通而降级"。
> 🔴 它**独立于内存**：把内存压到 10 GB 也照样崩。

---

## 五 · 完整 call 的实测：把三条手段全用上，能不能跑完？

### 5.1 用的配置（每一项都有 §三／§四 的实测依据）

| 项 | 设置 | 依据 |
|---|---|---|
| 载入 dtype | `torch_dtype=torch.bfloat16`（载入即半精度） | §3.1，省 10.72 GB |
| attention | `unet.set_attention_slice("max")` | §3.3，省 5.05 GB |
| VAE | `pipe.vae.use_slicing = True` | §3.3 |
| 组件生命周期 | 逐组件装载 ＋ 释放 | §3.2 |
| 上游 median bug | 恒等修正 | §四 |
| 分辨率 / 步数 | 768² / **1 步**（步数只影响耗时，不影响峰值） | — |

### 5.2 结果：**body ＋ head 两趟跑通了，marigold 没跑通**

| 阶段 | 耗时 | MPS allocated | MPS driver | 结果 |
|---|---|---|---|---|
| 装载 LayerDiff 管线 | 14.46 s | 8.52 GB | 10.58 GB | ✅ |
| **body ＋ head 两趟**（各 1 步） | **434.43 s** | 8.52 GB | **21.60 GB** | ✅ **出 26 张层** |
| 释放 LayerDiff | 0.96 s | 8.52 GB | 11.52 GB | ⚠️ **没释放掉**（见 §5.4） |
| 装载 Marigold | 5.27 s | 2.60 GB | 3.36 GB | ✅ |
| **跑 Marigold** | 46.21 s | — | — | ❌ **`RuntimeError: Invalid buffer size: 15.82 GiB`** |

**整次运行的 `peak memory footprint` = 22.62 GB**（`/usr/bin/time -l` 实测）。

出层清单（26 个文件，其中 24 张是层）：`front hair` / `back hair` / `head` / `neck` / `neckwear` / `topwear` / `handwear` / `bottomwear` / `legwear` / `footwear` / `tail` / `wings` / `objects` / `headwear` / `face` / `irides` / `eyebrow` / `eyewhite` / `eyelash` / `eyewear` / `ears` / `earwear` / `nose` / **`mouth`** ＋ 两张输入图。
→ 对照轻量路线的 12 层，**重型路线确实多出了 `mouth`、`eyebrow`、`eyewhite`、`irides`、`eyelash`、`nose` 这些面部部件**（这正是它的质量增量所在）。

### 5.3 🔴 三道**互相独立**的阻塞（这是本轮最重要的结构性发现）

| # | 阻塞 | 性质 | 本轮怎么处置 |
|---|---|---|---|
| 1 | **内存**：最优配置下仍要 **22.62 GB**（> 17 GB） | 资源 | **压不下去**（§5.5） |
| 2 | **上游 median bug**：5 维 median 在 MPS 上 abort | 上游代码缺陷 | ✅ 已用**恒等**修正绕过〔A07〕 |
| 3 | **marigold 的 MPS attention buffer 上限**：`Invalid buffer size: 15.82 GiB` | 框架限制 | ❌ **未解决** |

**第 3 条展开**：崩点在上游 marigold 管线内部的 `F.scaled_dot_product_attention`。上游 marigold 的调用方式是**把 19 个层 ＋ 1 张 fullpage 一次性塞进 `img_list`**（`apply_marigold` 的逐字写法），20 张 768² 图一起进注意力 → MPS 要一次性分配 **15.82 GiB** 的 buffer 而拒绝。
→ 这**不是"内存不够"那种可以靠腾空间解决的**，而是 MPS 对单次 attention buffer 的硬限制；要绕开必须**改上游的批处理方式**（分批喂 `img_list`），而那是**改上游算法**，超出"压内存"的范围。

### 5.4 🔴 一个实测踩到的坑：**"以为释放了，其实没释放"**

第一版完整 call 跑完 `del pipe` 之后，`torch.mps.current_allocated_memory()` **纹丝不动（仍是 8.52 GB）**。
查明原因：跑 pipeline 的那个**闭包引用着 `pipe` 这个名字** → `del` 之后引用计数没归零，`gc.collect()` 与 `empty_cache()` 自然都是空转。
改成"用 dict 容器持有、置 `None` 先断开引用、再 gc＋empty_cache"之后，`20_pipeline_load.py --stage serial` 实测 **driver 从 10.54 GB 直接掉到 0.0 GB**（见 §3.2 的手段二数字）。

> 教训：**"释放"这件事必须用 `allocated_memory` 量，不能靠"我 `del` 了"来自信。**

### 5.5 vae slicing 的**诚实负面结果**：在这条链上它没降峰值

| 完整 call 配置 | body＋head 的 MPS driver 峰值 | body＋head 耗时 |
|---|---|---|
| attention slicing，**不开** vae slicing | 20.32 GB | 371.97 s |
| attention slicing，**开** vae slicing | **21.60 GB** | **434.43 s**（慢 17%） |

→ **开了 vae slicing 之后峰值没有下降（反而高 1.28 GB），耗时却涨了 17%。**
诚实说明：这说明**峰值的大头不在 `sd_vae.decode` 那一步**（那一步确实被切片了），而在它后面的 `TransparentVAEDecoder`（一个 UNet1024 结构，逐张跑）以及 `vae_encode` 上。
🔴 **本轮没有把峰值定位到具体算子** —— 那需要在 pipeline 内部细粒度打点，而那是**改上游**，超出本轮"压内存"的范围。**这一条如实列为未做到项**（§八）。

### 5.6 与"未压内存"的对照

| 配置 | 峰值 | 说明 |
|---|---|---|
| 上游默认（fp32 载入 ＋ 不切片 ＋ 两份管线同在） | **21.83 GB（仅装载）** / 上一路整条 **23 GB** | §2.3 / 上一路 |
| 本轮最优（bf16 ＋ attention slicing ＋ vae slicing ＋ 逐组件释放） | **22.62 GB（跑完 body＋head）** | §5.2 |

**为什么"压了内存"之后数字看起来没降？** 因为这两个数**量的不是同一件事**：
- 21.83 GB 是**只装载、不跑前向**；
- 22.62 GB 是**装载 ＋ 跑完两趟前向（含 VAE 编解码）**。

**真正可比的是同一阶段**：装载阶段 **21.83 → 11.11 GB**（省 10.72 GB，§3.1）；单次 UNet 前向 **19.03 → 13.98 GB**（省 5.05 GB，§3.3）。
**但这两刀加起来仍然不够** —— 因为前向之后还有 **VAE 编解码**这一大块，本轮没能把它压下去。

---

## 六 · ③ 要不要清机器：对照表

### 6.1 主表

| 方案 | 峰值内存 | 一晚（8 h）能出几张 | 质量增量 |
|---|---|---|---|
| **轻量路线**（已知） | **1.50 GB**（端到端 RSS 峰值 947.5 MB） | **≈ 1000 张**（29 s/张） | 12 层；**无嘴／无眉／无眼白／无瞳孔** |
| **重型路线 · 未压内存** | **21.83 GB**（装载）／ **23 GB**（上一路整条） | **0 张**（装不下，swap 打满被换页拖死） | — |
| **重型路线 · 压内存后**（本轮实测最优） | 🔴 **22.62 GB**（768²，跑完 body＋head） | 🔴 **0 张**（装不下；且 **marigold 那一趟在 MPS 上跑不通**） | 24 层，**多出 `mouth`／`eyebrow`／`eyewhite`／`irides`／`nose`** 等面部部件 |

### 6.2 768² 与 1280² 分开算

**耗时（768²，本轮实测外推）**：单步 body pass **223.85 s**（含 1 次 UNet 前向 77.42 s ＋ VAE 解码）；单步 head pass **210.42 s**。
→ 上游默认 **30 步**：body ≈ 30×77.4 ＋ 146 ≈ **41 min**，head ≈ **37 min**，**单张 ≈ 78 min**（与上一路估的 40–101 min 吻合，落在偏慢端）。

| 分辨率 | 单张耗时（30 步外推） | 一晚 8 h 能出 | 峰值内存 | 能不能跑 |
|---|---|---|---|---|
| **768²** | ≈ **78 min** | **≈ 6 张**（如果内存够） | **22.62 GB**（实测） | ❌ **内存不够**（超 17 GB 约 5.6 GB）＋ marigold 跑不通 |
| **1280²** | ≈ **7 h**（按 §6.3 的实测单次前向外推） | **≈ 1 张**（如果内存够） | **19.73 GB**（UNet 单跑，实测） | ❌ **更不可能**（内存超得更多，且一晚只够一张） |

🔴 **注意**：上表的"能出几张"是**假设内存够**的前提下算的；**本轮实测的结论是内存不够，所以实际是 0 张。**

### 6.3 1280²：**实测**（不是外推）

`30_forward_probe.py --latent 160 --tags 13 --attn-slice max`（latent 160 ＝ 1280² 图），**跑通，退出码 0**：

| 项目 | 实测 |
|---|---|
| 权重上 MPS 后 | alloc **8.14 GB**，driver 9.11 GB |
| **单次 UNet 前向** | ✅ **445.46 s**（**7.4 min**，含 13 个 tag），driver 峰值 **19.18 GB** |
| **系统 peak footprint** | **19.73 GB** |
| `empty_cache()` 后 driver | 回落到 **9.13 GB**（缓存池几乎全还） |
| swap used 峰值 | 7145 MB |
| 进程 MEM 峰值 | 18432 MB |

**单张耗时外推（30 步，上游默认）**：body pass 30 × 445.46 s ＝ **3.71 h**（仅 UNet）＋ VAE 解码（13 张 1280²，约 6.8 min）＋ head pass（11 tag，约 3.2 h）→ **单张 ≈ 7 h**；**一晚 8 h ≈ 1 张**。
（注意：这是**开了 attention slicing** 的耗时；不开切片约快 23%，但峰值会更高。）

→ **1280² 的内存需求（19.73 GB 仅是 UNet 单跑）比 768² 的完整 call 也不低，而且一晚只够出一张。这条分辨率在本机没有讨论价值。**

### 6.4 一句话总结两档分辨率

| | 768² | 1280² |
|---|---|---|
| UNet 单跑前向峰值 | 13.98 GB（实测） | **19.73 GB**（实测） |
| 完整 call 峰值 | **22.62 GB**（实测） | 未测（只会比 19.73 GB 更高） |
| 单张耗时（30 步外推） | ≈ 78 min | ≈ 7 h |
| 一晚 8 h（若内存够） | ≈ 6 张 | ≈ 1 张 |
| 本机 17 GB 预算下能不能跑 | ❌ | ❌ |

### 6.5 🔴 一句话建议

> **别清机器。**
> 理由一句话：**清机器解决不了这个问题** —— 瓶颈不是"别的程序占了内存"，而是这条管线**自己在 768² 上就要 22.62 GB**（超 17 GB 约 5.6 GB），而且它的第三趟（marigold）在 MPS 上还有一道与内存无关的 buffer 上限，清了也跑不完。

---

## 七 · ④ 顺手核的事：重型路线里有没有 `mouth` 语义类？

**有。** 而且 `mouth` 同时出现在**三个**地方（逐字如下）：

**① 语义标签表本身** —— `common/live2d/scrap_model.py` 里三个版本的表都含 `mouth`〔A04〕：

```
VALID_BODY_PARTS_V1 = ['hair', 'headwear', 'face', 'eyes', 'eyewear', 'ears', 'earwear', 'nose', 'beard', 'mouth', 'neck', 'neckwear', 'skin', 'topwear', 'handwear', 'bottomwear', 'legwear', 'footwear', 'tail', 'wings']
VALID_BODY_PARTS_V2 = ['hair', 'headwear', 'face', 'eyes', 'eyewear', 'ears', 'earwear', 'nose', 'mouth', 'neck', 'neckwear', 'topwear', 'handwear', 'bottomwear', 'legwear', 'footwear', 'tail', 'wings', 'objects']
VALID_BODY_PARTS_V3 = ['front hair', 'back hair', 'headwear', 'face', 'irides', 'eyebrow', 'eyewhite', 'eyelash', 'eyewear', 'ears', 'earwear', 'nose', 'mouth', 'neck', 'neckwear', 'topwear', 'handwear', 'bottomwear', 'legwear', 'footwear', 'tail', 'wings', 'objects']
```

**② 主管线实际下发的 tag 组** —— `common/utils/inference_utils.py` 的 `head_tag_list`〔A02〕：

```
head_tag_list = ['headwear', 'face', 'irides', 'eyebrow', 'eyewhite', 'eyelash', 'eyewear', 'ears', 'earwear', 'nose', 'mouth']
```

（`mouth` 是这一组 11 个 tag 里的最后一个。`body_tag_list` 那 13 个里没有 `mouth`。）

**③ 人脸解析的标签映射** —— `common/utils/visualize.py` 的 `VALID_FACE_GROUPS` 里有独立的 `mouth` 组〔A05〕：

```
'mouth': [11],
```

**关于 `lip`（嘴唇）**：`FACE_LABEL2NAME` 里确实有 `12:'u_lip'` 与 `13:'l_lip'`，但同一份表里对这两项**逐字标注了 "both not used"**，且它们**不出现在任何一个 `VALID_BODY_PARTS_*` 标签表里**。
→ **结论：重型路线有 `mouth`，没有作为独立语义类的 `lip`。**

**本轮的直接证据**：§5.2 的完整 call 实测**真的写出了 `mouth.png`**（在 26 个输出文件里）。

---

## 八 · 未做到项 / 待确认

### 8.1 未做到

1. 🔴 **1280² 只测到"UNet 单跑前向"**（19.73 GB，跑通），**没跑 1280² 的完整 call**（body＋head＋marigold）—— 按 768² 的经验，完整 call 只会更高，且单张就要 ≈7 h，一晚只够一张，因此没有再往下跑。
2. 🔴 **峰值没有定位到具体算子**。只知道"body＋head 两趟"整体要 21.60 GB driver，但没拆出"UNet 前向 / vae_encode / trans_vae 解码"各占多少 —— 那需要在 pipeline 内部细粒度打点，属于**改上游**，超出本轮"压内存"的范围。
3. 🔴 **marigold 那一趟没跑通**（`Invalid buffer size: 15.82 GiB`），**没有试分批喂 `img_list`**（那要改上游批处理方式）。
4. **上游自带的 `blockswap` 与 `--group_offload` 两条省内存路径都没跑**。blockswap 把 device 硬写成 `cuda`、`--group_offload` 同理；改它们要动上游脚本，且 MPS 上每块往返传输预计会极慢。**只做了代码阅读，没有实测数字。**
5. **只测了 1 张图**（上游 `test_image1.png`）、**步数只跑到 1 步**（步数不影响峰值，但"30 步真能出好图"这件事本轮没验证）。
6. **`further_extr`（出 PSD 的最后一步）没跑** —— 它依赖 marigold 的深度结果，而 marigold 没跑通。
7. **没有做质量评审**。本轮关心的是"装不装得下"，不是"出图好不好看"。

### 8.2 待确认清单

| # | 事项 | 选项 | 我的倾向 |
|---|---|---|---|
| 1 | 要不要**继续啃**（比如改上游批处理让 marigold 能跑、给峰值打点定位）？ | ① 啃；② 不啃，走轻量路线；③ 租 GPU | **倾向 ③ 或 ②** —— 本机 24 GB 与 17 GB 预算下，这条路要连过三道关（内存、上游 median bug、MPS attention buffer 上限），性价比明显不如租一张 24 GB 显存的卡 |
| 2 | 若一定要在本机跑重型路线，**能接受的分辨率下限**是多少？ | ① 768²；② 512²（未测，峰值按面积比约降到 8.14＋5.3×0.44≈10.5 GB，**很可能装得下**）；③ 不跑 | **倾向先测 512²** —— 这是唯一一条还没被证否的"本机可跑"路径 |
| 3 | 轻量路线缺的 `mouth` 怎么办（重型路线有 `mouth` 但跑不动）？ | ① 用 SAM 已有的 `mouth` 掩码＋降低出层阈值；② 单独补一个嘴部模型；③ 接受无嘴 | **无法替你判断**，交给正在定案"嘴在哪一层"的那一路 |
| 4 | `top` 的 MEM 列与 `time -l` 的 footprint 谁更权威？ | — | 两者都指向 phys_footprint（**不是 RSS**）；本轮以 `time -l` 的 `peak memory footprint` 为准，`top` 采样用于定位峰值发生在哪一段 |

---

## 九 · 风险提示（至多三行，不解读）

1. See-through 仓库自述 *"This is an open-source research project… Use at your own risk."*；`LICENSE` 在仓库根。
2. 三个模型权重页（`layerdifforg/seethroughv0.0.2_layerdiff3d`、`24yearsold/seethroughv0.0.1_marigold`、`24yearsold/l2d_sam_iter2`）与 `dreMaz/AnimeMangaInpainting` 均**未标 gated**；各页有无使用条件请自行查看。
3. 本轮**没有下载任何新权重、没有新增任何依赖**（全程复用 `~/dsh-scratch/auto-layer/` 的 venv 与已下权重）。

