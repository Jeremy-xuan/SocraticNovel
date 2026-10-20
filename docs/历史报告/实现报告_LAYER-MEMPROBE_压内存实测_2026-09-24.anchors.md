# 锚点表 · 实现报告_LAYER-MEMPROBE_压内存实测_2026-09-24.md

> 本表是 `实现报告_LAYER-MEMPROBE_压内存实测_2026-09-24.md` 的旁挂锚点表。正文只写锚点（`〔A03〕`），行号集中在这里。

> 机核：`node 开源线/DSH定制/code/tools/anchors/check-anchors.mjs 开源线/DSH定制/实现报告_LAYER-MEMPROBE_压内存实测_2026-09-24.md --list`（退出码须为 0）。

> 🔴 **V1–V4 锚定的是上游 See-through 源码的只读副本**（`code/tools/auto-layer/vendor/see-through/`）——本任务**全程没有改动它**，所以哈希稳定。
> **V5–V9 锚定的是本任务自己的产出脚本**（`code/tools/auto-layer-memprobe/scripts/`）——脚本一旦被编辑，哈希即变，机核会**响亮报错**而不是静默失准。

## 版本表

| V | 文件 | sha256 前 16 位 |
|---|---|---|
| V1 | code/tools/auto-layer/vendor/see-through/common/utils/inference_utils.py | a153a1e26324fc71 |
| V2 | code/tools/auto-layer/vendor/see-through/common/modules/layerdiffuse/vae.py | 337475e9576de8e1 |
| V3 | code/tools/auto-layer/vendor/see-through/common/live2d/scrap_model.py | 62a1a27759368de4 |
| V4 | code/tools/auto-layer/vendor/see-through/common/utils/visualize.py | 095e27129902f059 |
| V5 | code/tools/auto-layer-memprobe/scripts/10_unet_load_dtype.py | c4f72dac1ce4906e |
| V6 | code/tools/auto-layer-memprobe/scripts/vae_mps_patch.py | 3f0ae9529ff700d1 |
| V7 | code/tools/auto-layer-memprobe/scripts/memwatch.sh | 1e9442bf2b21e5e5 |
| V8 | code/tools/auto-layer-memprobe/scripts/run_measured.sh | 2b8dc06be8c83c79 |
| V9 | code/tools/auto-layer-memprobe/scripts/20_pipeline_load.py | ab7a590eb82a466e |

## 锚点表

| 锚点 | 说明 | 版本 | 行 | 片段 |
|---|---|---|---|---|
| A01 | 上游"先 fp32 载入、再 .to(bfloat16)"里的转换那一行（`.to` 非原地 → 两份权重同时在场） | V1 | 77 | `layerdiff_pipeline.unet.to(dtype=torch.bfloat16, device=DEVICE)` |
| A02 | 主管线 head 组的 11 个 tag（含 mouth） | V1 | 153 | `head_tag_list = ['headwear', 'face', 'irides', 'eyebrow', 'eyewhite', 'eyelash', 'eyewear', 'ears', 'earwear', 'nose', 'mouth']` |
| A03 | 上游对 5 维张量求 median 的那一行（MPS 上必崩） | V2 | 232 | `median = torch.median(result, dim=0).values` |
| A04 | 语义标签表 V2（含 mouth） | V3 | 32 | `VALID_BODY_PARTS_V2 = [` |
| A05 | 人脸解析里的 mouth 分组 | V4 | 512 | `'mouth': [11],` |
| A06 | 本任务脚本：载入即目标 dtype（跳过 fp32 中间态） | V5 | 104 | `kw["torch_dtype"] = DT` |
| A07 | 本任务补丁：把 stack＋median(5维) 换成恒等的 result[0] | V6 | 84 | `TransparentVAEDecoder.estimate_augmented = estimate_augmented` |
| A09 | 本任务采样器：为什么不用 ps 而改用 top 的 MEM 列 | V7 | 7 | `#   → 所以本采样器**不用 ps**，改用两条能反映真实占用的通道：` |
| A10 | 本任务包装器：用 /usr/bin/time -l 拿权威的 peak memory footprint | V8 | 28 | `/usr/bin/time -l -o "$E/time_${TAG}.txt" \` |
| A12 | 本任务装载脚本：逐组件装载＋及时释放的释放函数 | V9 | 147 | `    def release(obj, name):` |

---

## 与正文的对应（给人看，机核不校验）

| 锚点 | 正文出现处 |
|---|---|
| A01 | §2.2（上游默认路径 = fp32 载入再转） |
| A02 | §七（主管线 head 组含 mouth） |
| A03 | §四（5 维 median 的崩点） |
| A04 | §七（语义标签表含 mouth） |
| A05 | §七（人脸解析的 mouth 分组） |
| A06 | §3.1（载入即 bf16 的写法） |
| A07 | §四（恒等修正）、§5.3（三道阻塞之第 2 条） |
| A09 | §1.2（三条测量通道） |
| A10 | §1.2（三条测量通道） |
| A12 | §3.2（逐组件装载＋及时释放） |

## 证据文件清单（机核不校验；给人看）

> 目的：正文里每个内存数字，都可以顺着这张表回盘复核。
> 全部位于 `code/tools/auto-layer-memprobe/evidence/`；权威峰值取 `time_*.txt` 里的 `peak memory footprint`，时间序列看 `mem_*.csv`。

| 实验 | `time_*.txt`（权威峰值出处） | `mem_*.csv`（时间序列） |
|---|---|---|
| UNet 载入 fp32 | time_e1_fp32.txt | mem_e1_fp32.csv |
| UNet 载入 bf16 | time_e1_bf16.txt | mem_e1_bf16.csv |
| LayerDiff 装载 fp32（基线） | time_e2_layerdiff_fp32.txt | mem_e2_layerdiff_fp32.csv |
| LayerDiff 装载 bf16 | time_e2_layerdiff_bf16.txt | mem_e2_layerdiff_bf16.csv |
| 逐组件释放（serial） | time_e3_serial_bf16.txt | mem_e3_serial_bf16.csv |
| 两份同在（concurrent） | time_e3_concurrent_bf16.txt | mem_e3_concurrent_bf16.csv |
| UNet 前向 768²（无切片） | time_e4_fwd_bf16_l96.txt | mem_e4_fwd_bf16_l96.csv |
| UNet 前向 768²（切片 max） | time_e4_fwd_bf16_l96_slicemax.txt | mem_e4_fwd_bf16_l96_slicemax.csv |
| UNet 前向 1280²（切片 max） | time_e4_fwd_bf16_l160.txt | mem_e4_fwd_bf16_l160.csv |
| 完整 call 768²（含 marigold，v3） | time_full_r768_s1_v3.txt | mem_full_r768_s1_v3.csv |
| 完整 call 768²（无 vae slicing，冒烟） | time_smoke3.txt | mem_smoke3.csv |
