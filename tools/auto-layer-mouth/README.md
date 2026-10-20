# auto-layer-mouth —— 「嘴」到底在哪一层，以及怎么把它拆出来（实测证据）

> 任务代号 **LAYER-MOUTH**。本目录是「**上一路（L2D-LAYER-GPU）自动分层出的 12 层里没有嘴**」
> 这件事的**定案 ＋ 两条拆解路线的实测 ＋ 接回 `.moc3` 的 A/B 对照**。
> 报告：`开源线/DSH定制/实现报告_LAYER-MOUTH_嘴与关键部件_2026-09-24.md`（＋旁挂锚点表）

---

## 〇 · 一句话结论

**不是"拆不出来"，是"拆出来了但两道闸都把它放走了"。**

| 问题 | 答案 |
|---|---|
| SAM 19 类里有 `mouth` 吗？ | **有，索引 8**（逐字在 `scrap_model.py` 的 `VALID_BODY_PARTS_V2`；V1/V3 表里也都有）。**没有任何 `lip` 类。** |
| 实测命中了吗？ | **命中了**：真立绘 **19 px**、我方平色立绘 **918 px**。 |
| 那 12 层里为什么没有？ | ① `33_make_layers.py` 的 `--min-px` 默认 **200** 把 19 px 滤掉；② `50_wire_to_i2l.py` 的角色表里**根本没有 mouth**。**两道独立的闸。** |
| 嘴的像素落在哪一层？ | **19 / 19 全部落在 `030_face.png`** ⇒ 在产出里表现为"焊死在脸上"。 |
| 有漏覆盖吗？ | **没有**（嘴被覆盖了；未覆盖像素里没有一块在嘴上）。 |
| 接回 i2l 能表达"说话时嘴动"吗？ | **能**（含嘴层 `mouth_open ✓`、`talk` shipped、渲染像素差 **330 px**；对照 **0 px**）。<br>🔴 **但真立绘（嘴 19 px）只有 5 px 差** —— 技术成立、产品不成立。 |

---

## 一 · 一条命令复现

```bash
TOOL="/Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/tools/auto-layer-mouth"
AUTO="/Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/code/tools/auto-layer"   # 🔴 只读
PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python            # auto-layer 已建的隔离 venv（本轮未装任何东西）
PYI=/Library/Frameworks/Python.framework/Versions/3.13/bin/python3   # 跑 i2l 用（本机已有 pydantic 2.12.5）
export SSL_CERT_FILE=/etc/ssl/cert.pem                               # 本机 Clash TUN 的坑

# ① 定案：19 类表 / alpha 加总 / 嘴部像素归属
$PY "$TOOL/scripts/10_probe_mouth_location.py"

# ② 路线 A：把嘴拆出来（above = 修正的遮挡物判据，all = 上游原样）
for t in sam_mps_test1 sam_mps_ourasset; do for m in above all; do
  $PY "$TOOL/scripts/20_make_layers_with_mouth.py" --samdir "$AUTO/out/sam/$t" --tag "${t}_$m" --min-px 16 --hole-mode $m
done; done

# ② 路线 B：眼白/虹膜/瞳孔/睫毛（眼睛掩码内 k-means）＋ 眉毛启发式
$PY "$TOOL/scripts/30_split_face_features.py" --samdir "$AUTO/out/sam/sam_mps_ourasset" --tag ourasset

# ③ A/B：含嘴 vs 不含嘴 → 能力表 / 顶点位移 / 渲染像素差 / 真 .moc3
PYTHONPATH=/tmp/p2l2/src/image2live2d-main/src \
  $PYI "$TOOL/scripts/50_wire_mouth_to_i2l.py" --layerdir "$TOOL/out/layers/ourasset_above/layers" --tag ourasset
$PY "$TOOL/scripts/60_zoom_mouth_evidence.py" --tag ourasset --variant with_mouth --k 12

# ④ 内存：先标定单位，再两条独立通道交叉验证
bash "$TOOL/scripts/43_mem_cmd_calibration.sh" 800
HOLD=8 bash "$TOOL/scripts/41_mem_crosscheck.sh"

# 先例逐字摘录（i2l 的嘴支持，带 sha256）
$PYI "$TOOL/scripts/70_collect_i2l_excerpts.py"
```

---

## 二 · 目录

```
auto-layer-mouth/
├── README.md                        本文件
├── scripts/
│   ├── 10_probe_mouth_location.py   ① 定案：19 类表 / alpha 加总 / 嘴部像素归属（只读 auto-layer 的产出）
│   ├── 20_make_layers_with_mouth.py ② 路线 A：含 mouth/nose 的出层（--hole-mode all|above）
│   ├── 30_split_face_features.py    ② 路线 B：眼白/虹膜/瞳孔/睫毛 + 眉毛启发式
│   ├── 40_mem_probe_workload.py     ④ 内存被测负载（真跑 SAM MPS 推理）
│   ├── 41_mem_crosscheck.sh         ④ 同一负载上 time -l / ps / top / footprint 四通道
│   ├── 42_mem_allocator.py          ④ 标定负载：分配已知 800 MB 并逐页触碰
│   ├── 43_mem_cmd_calibration.sh    ④ 单位标定（谁准、单位是什么）
│   ├── 50_wire_mouth_to_i2l.py      ③ A/B：含嘴/不含嘴 → 能力表 + 渲染 + 真 .moc3
│   ├── 60_zoom_mouth_evidence.py    ③ 嘴部放大对照（闭/开，最近邻不插值）
│   └── 70_collect_i2l_excerpts.py   先例摘录（/tmp 会清，所以抄成稳定证据件）
├── out/
│   ├── 10_probe_mouth_location.json ① 原始结果
│   ├── layers/<tag>_<mode>/         ② 四种配置的层 + result.json
│   ├── face_features/<tag>/         ② 眼白/虹膜/瞳孔/睫毛/眉毛 的逐件 PNG
│   ├── i2l_in/<tag>_<variant>/      ③ 改名成 i2l 角色的层（with_mouth / no_mouth）
│   ├── i2l/<tag>_<variant>/         ③ 真 .moc3 + model3/physics3/cdi3/motion3
│   ├── mem/CALIBRATION_latest.txt   ④ 单位标定（稳定文件名，报告锚它）
│   └── mem/CROSSCHECK_latest.txt    ④ 四通道交叉验证（稳定文件名，报告锚它）
└── evidence/                        全部目视证据 + 先例逐字摘录
```

---

## 三 · 四个关键数字

| 数字 | 含义 |
|---|---|
| **19 px / 918 px** | SAM 的 `mouth` 类在真立绘 / 我方平色立绘上的命中量。**这就是"能不能表达嘴动"的分水岭。** |
| **330 px vs 0 px** | 含嘴层与去掉嘴层，`ParamMouthOpenY` 0→1 的渲染像素差（我方素材）。**能力表的绿/红与画面的动/不动对得上。** |
| **5 px** | 真立绘上同样操作的渲染像素差。🔴 **能力表照样绿，画面几乎没动** —— 这一类静默失准要有产品级闸门。 |
| **499 MB vs 5220 MB** | 同一时刻 `ps` 的 RSS 与 `top`/`footprint` 的 phys_footprint。**macOS `top` 的 MEM 列不是 RSS，是 phys_footprint（含被压缩页）。** |

---

## 四 · 已知边界（换素材/换场景要重核）

1. **`above` 补全判据只对小五官成立**：对 `hair` 反而变差（`hole` 11,295 → 0），因为 SAM 的 `hair` 是前后发合并的一块。
   → 想通用，得先拆前后发（重型路线的深度步骤）。
2. **路线 B（颜色再切）在真手绘立绘上不成立**：眼白簇抓成肤色、瞳孔只剩 2 px、眉毛启发式归零。
3. **路线 C（23 类 V3 权重）权重不存在**：HF 仓库实测只有 19 类的 `checkpoint-18000.pt`。
4. **路线 D（关键点）要装 mmdet/mmcv/mmpose**（隔离 venv 里没有，上游 README 明写 mmdet 需 CUDA 工具链）→ 按纪律先报告。
5. **没做宿主侧真机验收**（`code/clients/live2d-host/` 不归本任务）。
   本轮的像素差来自 i2l 的**近似**软件光栅（上游 docstring 自认 approximate），不是 Live2D 渲染器的输出。
6. **只测了 2 张图**，没有批量耗时。
7. **`auto-layer/` 与 `image2live2d` 全程只读** —— 本目录的脚本是**自己的副本逻辑**，
   所以 §二 的结论是"**方案 ＋ 实测**"，不是"已经改好了"。

---

## 五 · 内存测量纪律（本任务立的规矩，给以后所有人）

1. 🔴 **凡结论涉及内存，必须写清"用哪个命令测的"**，并**至少两条独立通道交叉验证**。
2. 🔴 **三个口径不许混写**：**RSS**（`ps -o rss` / `ru_maxrss`，**不含**压缩与换出页，压力大时系统性偏小）／
   **phys_footprint**（`footprint`、`vmmap`，**含**压缩页）／ **系统级**（`vm_stat` ＋ `sysctl vm.swapusage`）。
3. 🔴 **单位必须实测标定**，不许照抄文档：实测 `time -l` = **字节**、`ps` = **KB**、`top` = **MB**。
4. 🔴 **不能用 `pgrep -f 脚本名` 取被测 pid**（`/usr/bin/time -l <py> 脚本.py` 的命令行里也含脚本名，
   会先匹配到包装进程）→ **让被测负载自己把 pid 打出来**。
5. **瞬时采样会漏峰**：要峰值用 rusage，要曲线用采样，**两者都要**。
