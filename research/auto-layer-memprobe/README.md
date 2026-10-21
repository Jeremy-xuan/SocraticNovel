# auto-layer-memprobe —— 「重型分层能不能压进 17 GB」的实测证据

> 任务代号 **LAYER-MEMPROBE**。报告：`开源线/DSH定制/实现报告_LAYER-MEMPROBE_压内存实测_2026-09-24.md`（＋旁挂锚点表）。
> 机器：**Apple M3 / 10 核 GPU / Metal 3 / 24 GB 统一内存 / 无 CUDA**。
> 上游：`code/tools/auto-layer/vendor/see-through/`（**只读**，本任务全程未改动）。

---

## 〇 · 一句话结论

**🔴 压不进 17 GB。** 最优配置（载入即 bf16 ＋ attention slicing ＋ vae slicing ＋ 逐组件释放）下，
768² 跑完 body＋head 两趟的峰值是 **22.62 GB**；而且第三趟（marigold）在 MPS 上还有一道
**与内存无关**的 buffer 上限（`Invalid buffer size: 15.82 GiB`）。
→ **别清机器**（清了也装不下，差约 5.6 GB）。

| 手段 | 效果 |
|---|---|
| 载入即 bf16（不 fp32 载入再转） | **省 10.72 GB**（装载 21.83 → 11.11 GB） |
| 逐组件装载＋及时释放 | **省 3.84 GB**（14.95 → 11.11 GB），但不降峰值本身 |
| attention slicing max | **省 5.05 GB**（UNet 单跑前向 19.03 → 13.98 GB），代价是慢 22.9% |
| vae slicing | ⚠️ **没降峰值**（21.60 vs 20.32 GB），耗时 +17% —— 诚实负面结果 |

---

## 一 · 目录

```
auto-layer-memprobe/
├── README.md                          本文件
├── scripts/
│   ├── memwatch.sh                    采样器：top 的 MEM 列（phys_footprint）＋ vm_stat ＋ sysctl vm.swapusage
│   ├── run_measured.sh                包装器：把受测命令包进 /usr/bin/time -l，并让采样器拿到真正在跑的 pid
│   ├── 10_unet_load_dtype.py          实验：fp32 载入 vs 载入即 bf16（单模型）
│   ├── 20_pipeline_load.py            实验：管线装载 —— layerdiff / marigold / concurrent / serial
│   ├── 30_forward_probe.py            实验：UNet 单跑前向 ＋ attention slicing ＋ 分辨率
│   ├── 40_full_call.py                实验：完整 call（body＋head＋marigold）
│   └── vae_mps_patch.py               上游 5 维 median 在 MPS 上必崩的**恒等**修正（自带 selftest）
├── evidence/                          原始证据：time_*.txt（权威峰值）／mem_*.csv（时间序列）／stdout/stderr
└── out/                               机读台账：*_*.json ＋ 完整 call 的输出层
```

**权重与 venv 不在本目录**（复用上一路建的，不重下）：
`/Users/wujunjie/dsh-scratch/auto-layer/{venv,weights,models,logs}`

---

## 二 · 一条命令复现（按顺序）

```bash
TOOL="/Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/tools/auto-layer-memprobe"
PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python
export SSL_CERT_FILE=/etc/ssl/cert.pem          # 本机 Python 找不到 CA bundle（上一路已记）

# ① 补丁自检（不碰 MPS，秒出）
$PY "$TOOL/scripts/vae_mps_patch.py"

# ② 手段1：载入 dtype 对照（各约 15–35 s）
bash "$TOOL/scripts/run_measured.sh" e1_fp32 300 $PY -u "$TOOL/scripts/10_unet_load_dtype.py" --mode fp32
bash "$TOOL/scripts/run_measured.sh" e1_bf16 300 $PY -u "$TOOL/scripts/10_unet_load_dtype.py" --mode bf16

# ③ 基线：LayerDiff 管线装载（fp32 那次会推 swap，约 45 s）
bash "$TOOL/scripts/run_measured.sh" e2_fp32 600 $PY -u "$TOOL/scripts/20_pipeline_load.py" --stage layerdiff --dtype fp32
bash "$TOOL/scripts/run_measured.sh" e2_bf16 300 $PY -u "$TOOL/scripts/20_pipeline_load.py" --stage layerdiff --dtype bf16

# ④ 手段2：逐组件释放 vs 两份同在（各约 20 s）
bash "$TOOL/scripts/run_measured.sh" e3_serial    300 $PY -u "$TOOL/scripts/20_pipeline_load.py" --stage serial     --dtype bf16
bash "$TOOL/scripts/run_measured.sh" e3_concurrent 300 $PY -u "$TOOL/scripts/20_pipeline_load.py" --stage concurrent --dtype bf16

# ⑤ 手段3：UNet 单跑前向 ＋ attention slicing（768² 约 1.5 min；1280² 约 8 min）
bash "$TOOL/scripts/run_measured.sh" fwd_off 600 $PY -u "$TOOL/scripts/30_forward_probe.py" --dtype bf16 --latent 96 --tags 13 --attn-slice off
bash "$TOOL/scripts/run_measured.sh" fwd_max 600 $PY -u "$TOOL/scripts/30_forward_probe.py" --dtype bf16 --latent 96 --tags 13 --attn-slice max
bash "$TOOL/scripts/run_measured.sh" fwd_1280 1500 $PY -u "$TOOL/scripts/30_forward_probe.py" --dtype bf16 --latent 160 --tags 13 --attn-slice max

# ⑥ 完整 call（768²、1 步，约 8–9 min；marigold 那一趟会失败，见报告 §5.3）
bash "$TOOL/scripts/run_measured.sh" full 1800 $PY -u "$TOOL/scripts/40_full_call.py" --steps 1 --resolution 768 --attn-slice max --skip-extr --tag full_v3
```

---

## 三 · 怎么读内存数字（🔴 本任务的方法学纪律）

| 通道 | 命令 | 量的是什么 | 在报告里的角色 |
|---|---|---|---|
| ① **权威** | `/usr/bin/time -l` 的 **`peak memory footprint`** | 进程的 **phys_footprint 峰值**（含被压缩页的记账） | 所有"峰值"结论 |
| ② 交叉 | 同一条 `time -l` 的 `maximum resident set size` | 进程峰值 RSS（**不计被压缩/换出的页**） | 证明通道①为什么必须存在 |
| ③ 采样 | `top -l 1 -pid <PID> -stats pid,mem,rsize` ＋ `vm_stat` ＋ `sysctl vm.swapusage` | `top` 的 **MEM 列是 phys_footprint**（不是 RSS）；系统级压缩器/swap | 时间序列，定位峰值发生在哪一段 |

🔴 **三条不许混写**：`ps`/`ru_maxrss` 的 RSS **不含被压缩/换出的页**，内存压力大时会系统性偏小
（本轮实测：同一进程 RSS **542 MB** / footprint **19.03 GB**）；`top` 的 MEM 列则是 phys_footprint。
**这就是上一路"ps 只报 47 MB"怪现象的来源 —— 不是谁读错，是两个命令量的不是同一个东西。**

---

## 四 · 踩过的坑（都写进脚本注释了，别改回去）

| # | 坑 | 现象 | 正解 |
|---|---|---|---|
| ① | 🔴 **上游 `torch.median` 对 5 维张量在 MPS 上必崩** | `MPSNDArraySort.mm:208: failed assertion (null)" Axis = 4 ... only supports axis = 0, 1, 2, 3`，**Metal 断言，Python 抓不住，进程直接 SIGABRT（退出码 134）** | `vae_mps_patch.py` 的**恒等**替换（该处 `len(result)` 恒为 1，median 恒等于 `result[0]`），且 `len != 1` 时抛异常 |
| ② | 🔴 **`enable_vae_slicing()` 在 diffusers 0.37 的 VAE 上不存在** | `AttributeError: 'AutoencoderKL' object has no attribute 'enable_vae_slicing'` | 直接置 **`pipe.vae.use_slicing = True`**（`AutoencoderKL.__init__` 默认 False，`decode()` 里有现成的逐张分支） |
| ③ | 🔴 **"以为释放了，其实没释放"** | `del pipe` 后 `current_allocated_memory` **纹丝不动（8.52 GB）** —— 跑 pipeline 的**闭包引用着 `pipe` 这个名字** | 用 dict 容器持有，**先 `P["pipe"] = None` 再 gc＋empty_cache**；释放必须量 `allocated_memory` 验证 |
| ④ | 🔴 **`&` 会把整条 `&&` 链后台化** | `cd X && ... && nohup cmd > log &` → 后面的 `sleep; tail log` 在原 cwd 跑，找不到文件 | 后台跑用工具的后台能力，别在链尾加 `&` |
| ⑤ | **marigold 的 MPS attention buffer 上限** | `RuntimeError: Invalid buffer size: 15.82 GiB`（崩在 `F.scaled_dot_product_attention`） | ❌ **未解决** —— 上游把 19 层＋1 张 fullpage 一次性塞进 `img_list`，要绕开必须改上游批处理方式 |
| ⑥ | 上游 LaMa 的 `device` 参数被丢掉（上一路已记） | 本任务未复现（没走 LaMa 那条路） | 见 `auto-layer/README.md` 坑④ |

---

## 五 · 边界（诚实交代）

1. **测量是在"机器上有别的程序在跑"的情况下做的**（依纪律**没有去杀任何别的进程**）。这不影响峰值结论（`peak memory footprint` 量的是受测进程自己），但影响耗时与换页表现。
2. **峰值没有定位到具体算子** —— 只知道"body＋head 两趟"整体要 21.60 GB driver，没拆出 UNet 前向 / vae_encode / trans_vae 解码各占多少（那需要改上游打点）。
3. **步数只跑到 1 步**（步数不影响峰值，但"30 步真能出好图"本轮没验证）。
4. **上游自带的 `blockswap` 与 `--group_offload` 只做了代码阅读，没有实测数字**（两者都把 device 硬写成 `cuda`）。
5. **没有下载任何新权重、没有新增任何依赖。**
