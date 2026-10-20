# 锚点表 · 实现报告_L2D-LAYER-GPU_本地GPU自动分层_2026-09-24.md

> 本表是 `实现报告_L2D-LAYER-GPU_本地GPU自动分层_2026-09-24.md` 的旁挂锚点表。正文只写锚点（`〔A01〕`），行号集中在这里。

> 机核：`node 开源线/DSH定制/code/tools/anchors/check-anchors.mjs 开源线/DSH定制/实现报告_L2D-LAYER-GPU_本地GPU自动分层_2026-09-24.md --list`（退出码须为 0）。

> 🔴 **本表锚定的文件全部在本任务自己的产出目录内**（`code/tools/auto-layer/vendor/see-through/` 是我方只读副本，
> 仅 `20_patch_device.py` 会改其中 2 个文件，改动已落 diff 于 `out/patch/`）。
> 报告另外引用的 **`image2live2d` 源码在 `/tmp/p2l2/src/`（P2L-2 的产物，本任务只读未改）**，
> 该路径**易失**（`/tmp` 可能被清），故**不设锚点**，只在正文里点名文件（`irr/schema.py` / `core/decompose/sources.py`）。

## 版本表

| V | 文件 | sha256 前 16 位 |
|---|---|---|
| V1 | 开源线/DSH定制/code/tools/auto-layer/vendor/see-through/common/utils/inference_utils.py | a153a1e26324fc71 |
| V2 | 开源线/DSH定制/code/tools/auto-layer/vendor/see-through/annotators/lama_inpainter/__init__.py | 367f54ccfab2d6c6 |
| V3 | 开源线/DSH定制/code/tools/auto-layer/vendor/see-through/common/modules/layerdiffuse/layerdiff3d.py | dc7ccfc535c339e4 |
| V4 | 开源线/DSH定制/code/tools/auto-layer/vendor/see-through/common/live2d/scrap_model.py | 62a1a27759368de4 |
| V5 | 开源线/DSH定制/code/tools/auto-layer/vendor/see-through/common/modules/semanticsam.py | c8e37fa78fbd5168 |
| V6 | 开源线/DSH定制/code/tools/auto-layer/vendor/see-through/common/modules/sam/modeling/transformer.py | 996d0a0d27342ac6 |

## 锚点表

| 锚点 | 说明 | 版本 | 行 | 片段 |
|---|---|---|---|---|
| A01 | 设备参数化补丁插入的 DEVICE 解析（环境变量 > cuda > mps > cpu） | V1 | 23 | `DEVICE = (_os_l2d.environ.get('SEETHROUGH_DEVICE')` |
| A02 | 补丁后 UNet 落到 DEVICE（上游原为 `device='cuda'`） | V1 | 77 | `layerdiff_pipeline.unet.to(dtype=torch.bfloat16, device=DEVICE)` |
| A03 | 上游 bug：`device` 在这里才被往下传（原为 `inpaint_preprocess(img, mask)`，漏传 device） | V2 | 511 | `img_torch, mask_torch, rel_pos, direct, img_original, mask_original, pad_bottom, pad_right = inpaint_preprocess(img, mask, device=device)` |
| A04 | 被漏传 device 时实际生效的落点（`inpaint_preprocess` 自己的默认 `device='cuda'`） | V2 | 495 | `img_torch = img_torch.to(device)` |
| A07 | 上游自带的 MPS dtype 分支（float64 不可用时的规避） | V3 | 1433 | `is_mps = sample.device.type == "mps"` |
| A08 | 语义分割模型类定义处（该模块零 device 硬编码） | V5 | 267 | `class SemanticSam(BaseExtendSam):` |
| A09 | xformers 内存高效注意力类（其开关 `USE_XFORMER_ATTENTION` 被强制关闭在上一行） | V6 | 86 | `class MemoryEfficientCrossAttention(nn.Module):` |
| A10 | UNet 前向体按「帧维＝tag 维」解释 sample | V3 | 1667 | `batch_size, num_frames = sample.shape[:2]` |
| A11 | 13 个 tag 的 text_embeds 形状约束（`reshape((13, -1))`） | V3 | 1500 | `time_embeds = time_embeds.reshape((text_embeds.shape[0], -1))` |
| A12 | tag 组嵌入的构造（组大小来自 `group_embedding_num=[13,11]`） | V3 | 730 | `self.group_embeds.append(GroupEmbedding(n, 1280))` |
| A13 | 19 类语义部件的名字表（SAM 那一路用的就是这一套） | V4 | 32 | `VALID_BODY_PARTS_V2 = [` |

## 行号散写豁免

| 文件 | 行 | 理由 |
|---|---|---|
| 实现报告_L2D-LAYER-GPU_本地GPU自动分层_2026-09-24.md | — | 本件正文不含散写行号（已机核） |

---

## 产物哈希表（机核不校验；给人看）

| 产物 | 说明 |
|---|---|
| `code/tools/auto-layer/out/probe/env_probe.json` | 本机 GPU 算子探针原始结果（22/24 通过） |
| `code/tools/auto-layer/out/probe/unet_probe_mps.json` | SDXL UNet 隔离实验台账（前向 40.47 s / 101.1 s） |
| `code/tools/auto-layer/out/patch/inference_utils.py.diff` | 设备参数化补丁 diff（8 处） |
| `code/tools/auto-layer/out/patch/__init__.py.diff` | LaMa `device` 漏传 bug 的补丁 diff（1 处） |
| `code/tools/auto-layer/out/sam/sam_mps_test1/contact_sheet.png` | 19 类语义掩码接触表（目视证据） |
| `code/tools/auto-layer/out/lama/lama_mps/selfcheck_face_triple.png` | LaMa 自检三联图（原图｜挖掉脸｜重建） |
| `code/tools/auto-layer/out/layers/light_mps/contact_sheet.png` | 🔴 **轻量路线 12 层接触表（请目视这一张）** |
| `code/tools/auto-layer/out/i2l/saml2dchar/saml2dchar.moc3` | 下游产物：真 `.moc3`（4,639,808 B，v3.00） |
