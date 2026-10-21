# auto-layer-512 —— 「512² 是不是本机可跑的最后一条路」的实测证据

> 任务代号 **LAYER-512**。报告：`开源线/DSH定制/实现报告_LAYER-512_低分辨率实测_2026-09-24.md`（＋旁挂锚点表）。
> 机器：**Apple M3 / 10 核 GPU / Metal 3 / 24 GB 统一内存 / 无 CUDA**。
> 上游：`code/tools/auto-layer/vendor/see-through/`（**只读**，本任务全程未改动，sha256 与上一路一致）。
> 上一路：`code/tools/auto-layer-memprobe/`（768² 压内存实测，**只读复用**）。

---

## 〇 · 一句话结论

**是，512² 是本机可跑的最后一条路，而且装得下 —— 但必须给 marigold 的 UNet 也上 attention slice。**

| 配置（512²，1 步 / marigold 4 步） | 权威峰值 `peak memory footprint` | 总耗时 | marigold |
|---|---|---|---|
| 上一路配置（只给 layerdiff 上 slice） | **24.97 GiB**（超 17 GB 预算） | 1003 s | 855 s（慢，且是峰值来源） |
| **＋给 marigold 也上 slice** | **14.10 GiB ✅**（预算 17.18 GB，余量 ~2 GB） | **398 s** | **222 s** |

→ 唯一新增的开关是 `pipe.unet.set_attention_slice("max")`（**diffusers 自带**，会把
`AttnProcessor2_0` 换成 `SlicedAttnProcessor`）。**没有它，512² 一样装不下。**

---

## 一 · 目录

```
auto-layer-512/
├── README.md                       本文件
├── scripts/
│   ├── 05_sdpa_limit_probe.py     探针：MPS 上 SDPA 的「Invalid buffer size」随什么缩放（**同进程连测会中毒，见 §四**）
│   ├── 06_sdpa_one.py             探针：一次一个形状，**每个形状必须独立进程**
│   ├── 07_sdpa_sweep.sh           驱动：把若干形状逐个丢给 06（每个一个干净进程）
│   ├── 40_full_call.py            完整 call（**逐字复制**自 auto-layer-memprobe，只多一个 --marigold-attn-slice 开关）
│   ├── run_512.sh                 受测运行包装器（512² 专用入口）
│   ├── run_measured.sh            （复制自上一路）把命令包进 /usr/bin/time -l，并让采样器拿到真 pid
│   ├── memwatch.sh                （复制自上一路）采样 top 的 MEM 列（＝phys_footprint）＋ vm_stat ＋ swapusage
│   ├── vae_mps_patch.py           （复制自上一路）上游 5 维 median 在 MPS 上必崩的**恒等**修正
│   ├── 50_layer_contact_sheet.py  层接触表（RGB 叠棋盘 ＋ alpha 灰度并排）
│   ├── 51_composite_compare.py    叠回去的 composite 与 SOURCE 1:1 并排 ＋ 边缘最密窗放大
│   ├── 52_zoom_face.py            脸窗 12× 放大（逐脸部件，标出各部件 alpha 像素数）
│   ├── 60_inventory_compare.py    轻量 vs 重型的**机读**对比台账（含边缘过渡带宽）
│   └── 61_light_vs_heavy.py       轻量 vs 重型的**目视**对照（全图 ＋ 脸窗放大）
├── evidence/                       原始证据：time_*.txt（权威峰值）／mem_*.csv（时间序列）／stdout/stderr
└── out/                            机读台账：full_*.json ＋ fullcall/<tag>/ 的完整出层 ＋ 512_layers/ 的目视图
```

**权重与 venv 不在本目录**（复用上一路建的，**本任务未下任何新权重、未装任何新依赖**）：
`/Users/wujunjie/dsh-scratch/auto-layer/{venv,weights,models,logs}`

---

## 二 · 一条命令复现（按顺序）

```bash
TOOL="/Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/tools/auto-layer-512"
PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python
export SSL_CERT_FILE=/etc/ssl/cert.pem          # 本机 Python 找不到 CA bundle（上一路已记）

# ① 崩点公式：合成张量复现 768² 的 Invalid buffer size（每个形状独立进程，约 30 s）
bash "$TOOL/scripts/07_sdpa_sweep.sh" "$TOOL/evidence/sdpa_sweep.jsonl"

# ② 512² 完整 call —— 上一路配置（预期峰值 ≈ 25 GiB）
bash "$TOOL/scripts/run_512.sh" full512_s1 1200 $PY -u "$TOOL/scripts/40_full_call.py" \
     --steps 1 --resolution 512 --attn-slice max --tag full512_s1

# ③ 512² 完整 call —— **＋marigold 也上 slice**（预期峰值 ≈ 14 GiB，快 2.5×）
bash "$TOOL/scripts/run_512.sh" full512_s1_mgs 1500 $PY -u "$TOOL/scripts/40_full_call.py" \
     --steps 1 --resolution 512 --attn-slice max --marigold-attn-slice max --skip-extr --tag full512_s1_mgs

# ④ 质量证据（步数取上游默认 30，约 1.5–2 h）
bash "$TOOL/scripts/run_512.sh" full512_q30 7200 $PY -u "$TOOL/scripts/40_full_call.py" \
     --steps 30 --resolution 512 --attn-slice max --marigold-attn-slice max --skip-extr --tag full512_q30

# ⑤ 目视件
$PY "$TOOL/scripts/50_layer_contact_sheet.py" --layerdir "$TOOL/out/fullcall/full512_q30" --tag full512_q30
$PY "$TOOL/scripts/51_composite_compare.py"  --layerdir "$TOOL/out/fullcall/full512_q30" --tag full512_q30
$PY "$TOOL/scripts/52_zoom_face.py"          --layerdir "$TOOL/out/fullcall/full512_q30" --tag full512_q30
$PY "$TOOL/scripts/61_light_vs_heavy.py" --heavy "$TOOL/out/fullcall/full512_q30" --heavy-tag full512_q30 \
     --light "$TOOL/../auto-layer/out/layers/light_mps/layers" \
     --src   "$TOOL/../auto-layer/out/sam/sam_mps_test1/input.png"
```

---

## 三 · 怎么读内存数字（沿用上一路的方法学纪律，未改）

| 通道 | 命令 | 量的是什么 | 角色 |
|---|---|---|---|
| ① **权威** | `/usr/bin/time -l` 的 **`peak memory footprint`** | 进程 **phys_footprint 峰值**（含被压缩页的记账） | 所有"峰值"结论 |
| ② 交叉 | 同一条 `time -l` 的 `maximum resident set size` | 峰值 RSS（**不计被压缩/换出的页**） | 证明通道①为什么必须存在 |
| ③ 采样 | `top -l 1 -pid <PID> -stats pid,mem,rsize` ＋ `vm_stat` ＋ `sysctl vm.swapusage` | `top` 的 MEM 列＝phys_footprint；系统级压缩器/swap | 时间序列，定位峰值发生在哪一段 |

🔴 **取 pid 用 pidfile（`echo $$ > pidf; exec "$@"`），不用 `pgrep -f`**（包装进程的命令行里也含脚本名）。
🔴 **三条口径不许混写**：RSS 不含压缩/换出页；`top` 的 MEM 列是 phys_footprint；系统级看 `vm_stat`＋`sysctl vm.swapusage`。

---

## 四 · 踩过的坑（都写进脚本注释了，别改回去）

| # | 坑 | 现象 | 正解 |
|---|---|---|---|
| ① | 🔴 **SDPA 探针不能在一个进程里连测** | 第一档失败后，后面**每一档都失败**，报 `MPS backend out of memory (other allocations: 39.41 GiB, max allowed: 27.20 GiB)` —— allocator 留下无法归还的 other allocations，`empty_cache()` 也救不回来 | **每个形状一个干净进程**（`06`＋`07`）。据此还纠了 05 的一个伪影：它报的 `Invalid buffer size: 16.00 GiB` 是中毒态下的假数，干净进程里同一个形状**是过的** |
| ② | 🔴 **`Invalid buffer size` 与 `Failed to allocate private MTLBuffer` 是两道不同的闸** | 前者是 PyTorch MPS allocator 的**上限检查**（打印的尺寸＝bf16 张量字节数 `B·H·L²·2`）；后者是 Metal 真的去申请**私有 buffer**（＝`B·H·L²·4`，fp32）后失败，**直接 abort，Python 抓不住** | 判"能不能过"要**两道都算**：768² marigold 死在第一道（15.82 GiB），768² layerdiff body 死在第二道（20.57 GiB 的私有 buffer） |
| ③ | **head 组裁剪在"头贴到图像左边缘"时切出 0 宽** | `x1 = hx` 为 −1（四舍五入跨过 0）→ `img[y1:y2, -1:927]` 被 numpy 当负索引 → 宽度 0 → **head 组 11 个 tag 全空** | 🔴 **上游 `_crop_head` 有同样的形状**（本任务只记录，**未改上游**）；1 步噪声会让 `head` 层的 bbox 铺满整幅 → 必触发。真步数渲染是否仍触发，见报告 |
| ④ | **`further_extr` 需要上游 `apply_marigold` 写出的 `info.json`** | `FileNotFoundError: .../info.json` | 本任务的 `run_marigold` 只算 depth、不写那个中间件 → 用 `--skip-extr`。**与 512² 无关**（768² 同样跑不了这一步） |
| ⑤ | **1 步的输出不能用来判断质量** | 1 步的 composite 是**纯噪声**（我目视过：整幅糊成一团色块），head 层的 bbox 也退化 | 质量结论**必须**跑上游默认步数（30） |

---

## 五 · 边界（诚实交代）

1. **测量是在"机器上有别的程序在跑"的情况下做的**（依纪律**没有杀任何别的进程**）。不影响峰值结论（`peak memory footprint` 量的是受测进程自己），但影响耗时与换页表现 —— 同一配置两次跑的 layerdiff 就差了 121.8 s vs 151.2 s。
2. **`Invalid buffer size` 的上限常量没有量到精确值**：只夹出区间 **(10.28, 15.82] GiB**（10.28 GiB 过、15.82 GiB 不过）。继续二分需要在真机上尝试 20+ GiB 的私有 buffer，**风险大于收益，主动放弃**。
3. **峰值没有定位到具体算子**（只知道落在哪一阶段）。
4. **`further_extr`（左右拆分 / PSD 导出）本任务未跑通**，原因见坑④。
5. **未下任何新权重、未装任何新依赖、未改上游任何文件。**
