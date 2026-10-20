# 锚点表 · 实现报告_LAYER-MOUTH_嘴与关键部件_2026-09-24.md

> 本表是 `实现报告_LAYER-MOUTH_嘴与关键部件_2026-09-24.md` 的旁挂锚点表。正文只写锚点（`〔A01〕`），行号集中在这里。

> 机核：`node 开源线/DSH定制/code/tools/anchors/check-anchors.mjs 开源线/DSH定制/实现报告_LAYER-MOUTH_嘴与关键部件_2026-09-24.md --list`（退出码须为 0）。

> 🔴 **本表锚定的文件全部落在两处稳定位置**：
> ① 本任务自己的产出目录 `code/tools/auto-layer-mouth/`；
> ② `code/tools/auto-layer/`（**只读**引用——本任务没有改它任何一个字节，见报告 §七）。
>
> **不设锚点的引用**：`image2live2d` 源码在 `/tmp/p2l2/src/image2live2d-main/`（P2L-2 的产物，本任务只读未改）——
> `/tmp` 会被清，锚点会静默失效，所以它的原文被**逐字抄进本任务自己的** `evidence/prior_art_i2l_mouth_excerpts.md`（= V10），
> 正文锚点一律指向那份摘录件。

## 版本表

| V | 文件 | sha256 前 16 位 |
|---|---|---|
| V1 | 开源线/DSH定制/code/tools/auto-layer/vendor/see-through/common/live2d/scrap_model.py | 62a1a27759368de4 |
| V2 | 开源线/DSH定制/code/tools/auto-layer/scripts/33_make_layers.py | cdf26a1b4d3b35f0 |
| V3 | 开源线/DSH定制/code/tools/auto-layer/scripts/50_wire_to_i2l.py | 368c3dc828eb1ebf |
| V4 | 开源线/DSH定制/code/tools/auto-layer/out/sam/sam_mps_test1/result.json | 2e00718bd60e33b8 |
| V5 | 开源线/DSH定制/code/tools/auto-layer/out/sam/sam_mps_ourasset/result.json | 2c40bd65b84951f6 |
| V6 | 开源线/DSH定制/code/tools/auto-layer/out/layers/light_mps/result.json | 1571664bcc501d5f |
| V7 | 开源线/DSH定制/code/tools/auto-layer/README.md | d8e71bfeb39551f6 |
| V8 | 开源线/DSH定制/code/tools/auto-layer-mouth/scripts/20_make_layers_with_mouth.py | a0e8101cb755b01f |
| V9 | 开源线/DSH定制/code/tools/auto-layer-mouth/scripts/50_wire_mouth_to_i2l.py | 531e1b83e2921e6e |
| V10 | 开源线/DSH定制/code/tools/auto-layer-mouth/evidence/prior_art_i2l_mouth_excerpts.md | 0be39e104cf9e6b6 |
| V11 | 开源线/DSH定制/code/tools/auto-layer-mouth/out/mem/CROSSCHECK_latest.txt | 1489f1774d65b480 |
| V12 | 开源线/DSH定制/code/tools/auto-layer-mouth/out/mem/CALIBRATION_latest.txt | 32e9abfc77aa06b6 |
| V13 | 开源线/DSH定制/code/tools/auto-layer-mouth/out/10_probe_mouth_location.json | 0386d00383409ff5 |
| V14 | 开源线/DSH定制/code/tools/auto-layer-mouth/out/50_wire_mouth_ourasset.json | 8cb113a209dbf01d |
| V15 | 开源线/DSH定制/实现报告_L2D-LAYER-GPU_本地GPU自动分层_2026-09-24.md | 0e40726e24c5b346 |

## 锚点表

| 锚点 | 说明 | 版本 | 行 | 片段 |
|---|---|---|---|---|
| A01 | SAM 那一路用的 19 类语义标签表 VALID_BODY_PARTS_V2 的定义处 | V1 | 32 | `VALID_BODY_PARTS_V2 = [` |
| A02 | V2 表里含 mouth 的那一行（前面 8 个是 hair…nose ⇒ mouth 的索引是 8） | V1 | 33 | `'hair', 'headwear', 'face', 'eyes', 'eyewear', 'ears', 'earwear', 'nose', 'mouth',` |
| A03 | 23 类表 VALID_BODY_PARTS_V3 定义处（含 irides/eyebrow/eyewhite/eyelash） | V1 | 39 | `VALID_BODY_PARTS_V3 = [` |
| A04 | 20 类表 VALID_BODY_PARTS_V1 定义处（同样含 mouth ⇒ 这个类一直都在） | V1 | 25 | `VALID_BODY_PARTS_V1 = [` |
| A05 | 出层阈值 `--min-px` 的默认值 200（丢掉 19 px 的嘴的直接原因） | V2 | 83 | `ap.add_argument("--min-px", type=int, default=200, help="小于此像素数的部件跳过")` |
| A06 | 部件筛选式：低于阈值的类直接不进 parts | V2 | 155 | `parts = [p for p in LABELS if p in masks and int(masks[p].sum()) >= args.min_px]` |
| A07 | 补全区的定义式（其它部件并集 ∩ 本部件外接框 ∩ 非本部件） | V2 | 200 | `hole = others & box & (~m)` |
| A08 | 上游的绘制序表（hair 记成 10 ⇒ 排在最底，与 Live2D 惯例相反） | V2 | 46 | `DRAW_ORDER = {` |
| A09 | i2l 角色直映表起点（表里没有 mouth ⇒ 即便出了嘴层也会被跳过） | V3 | 40 | `SINGLE = {` |
| A10 | 真立绘（test_image1）上 mouth 类的实测像素数 = 19 | V4 | 66 | `"8": 19,` |
| A11 | 我方平色立绘（portrait_flat）上 mouth 类的实测像素数 = 918 | V5 | 64 | `"8": 918,` |
| A12 | 轻量路线实际出层的部件清单（不含 mouth） | V6 | 100 | `"parts": [` |
| A13 | 上一路 README 的「本轮没填上的 i2l 角色」那一行（嘴不在其中） | V7 | 225 | `**本轮没填上的 i2l 角色**` |
| A14 | 本任务的遮挡物判据（`all` = 上游原样 / `above` = 只取绘制序更高的部件） | V8 | 191 | `def occluders_of(name):` |
| A15 | 本任务的补全区算式（与上游逐字一致，只换了遮挡物集合） | V8 | 217 | `hole = others & box & (~m)` |
| A16 | 本轮把嘴层接进 i2l 的角色映射（`050_mouth.png` → `040_mouth.png`） | V9 | 47 | `"050_mouth.png": ("040_mouth.png", "mouth"),` |
| A17 | i2l 的能力发现：mouth_open 要有 ParamMouthOpenY **且** 有腔体 | V10 | 77 | `mouth_open = has_p("ParamMouthOpenY")` |
| A18 | 腔体角色存在性判据（没有腔体就只能「part 开一条唇线」） | V10 | 78 | `has_cavity = has_r(SemanticRole.mouth_cavity)` |
| A19 | 合成腔体的三色（暗腔/上齿/舌）全部由唇线自身的色相推出 | V10 | 138 | `_TONE_CAVITY = (0.66, 0.28)` |
| A20 | 嘴区合理性包络的最后一条（水平偏移上限 0.20 倍脸宽） | V10 | 291 | `_MOUTH_MAX_OFFSET_FRAC = 0.20` |
| A21 | 口型同步用的就是 ParamMouthOpenY（LIP_SYNC_PARAMS） | V10 | 250 | `LIP_SYNC_PARAMS = ("ParamMouthOpenY",)` |
| A22 | `talk` 动作的定义：驱动 ParamMouthOpenY（无此参数时该动作被抑制） | V10 | 261 | `"talk": Drive({"ParamMouthOpenY": 1.0}` |
| A23 | 角色枚举里本来就有 mouth_cavity（合成腔体不是我们发明的） | V10 | 43 | `mouth_cavity = "mouth_cavity"` |
| A24 | 同一次负载上 `top` 报的 rsize 峰值（与同刻 `ps` 的 RSS 差一个量级） | V11 | 39 | `通道 B top rsize         瞬时峰值     = 5269 MB` |
| A25 | 标定：真实分配 800 MB 时 `footprint` 的 phys_footprint = 809 MB | V12 | 22 | `phys_footprint      = 809 MB` |
| A26 | 嘴部像素归属：19 px 全部落在 030_face.png 的 alpha 内 | V13 | 631 | `"Q3_mouth_ownership": {` |
| A27 | A/B 对照：含嘴层的能力表里 mouth_open = true | V14 | 123 | `"mouth_open": true,` |
| A28 | 上一路报告 §5.3 的表里那条 mouth 记录（"未达出层阈值"）—— 证明它被记过、但没进主清单 | V15 | 265 | `但本轮该图命中只有 **19 px**，未达出层阈值` |

## 行号散写豁免

| 文件 | 行 | 理由 |
|---|---|---|
| 实现报告_LAYER-MOUTH_嘴与关键部件_2026-09-24.md | — | 本件正文不含散写行号（已机核） |

---

## 产物哈希表（机核不校验；给人看）

| 产物 | 说明 |
|---|---|
| `code/tools/auto-layer-mouth/out/10_probe_mouth_location.json` | ① 定案的原始结果（19 类表 / alpha 加总 / 像素归属） |
| `code/tools/auto-layer-mouth/out/layers/{test1,ourasset}_{above,all}/result.json` | ② 路线 A 四种配置的逐部件账（可见/alpha/hole/膨胀） |
| `code/tools/auto-layer-mouth/out/30_face_features_{test1,ourasset}.json` | ② 路线 B 的簇心与逐角色像素数 |
| `code/tools/auto-layer-mouth/out/50_wire_mouth_{test1,ourasset}.json` | ③ A/B 对照（能力表 / 位移 / 渲染像素差 / `.moc3` 体积） |
| `code/tools/auto-layer-mouth/out/i2l/*/*.moc3` | ③ 四个真 `.moc3`（2 图 × 含嘴/不含嘴） |
| `code/tools/auto-layer-mouth/out/mem/CALIBRATION_latest.txt` | ④ 内存命令的单位标定 |
| `code/tools/auto-layer-mouth/out/mem/CROSSCHECK_latest.txt` | ④ 同一负载上三条独立通道的交叉验证 |
| `code/tools/auto-layer-mouth/evidence/*.png` | 全部目视证据（接触表 / 放大对照） |
| `code/tools/auto-layer-mouth/evidence/prior_art_i2l_mouth_excerpts.md` | 先例逐字摘录（= V10） |
