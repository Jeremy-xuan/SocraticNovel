# psd2moc3 —— 「分层立绘 → 真 `.moc3`」的跑通证据

> 任务代号 **P2L-2**。本目录是「**分层图 → 真 Live2D 模型（`.moc3`）→ 在我们自己的宿主里加载并驱动嘴**」
> 这条技术方案的**跑通证据**。
> 配套报告（不在本仓库内）：`实现报告_P2L2_静态立绘转真模型_2026-09-24.md`

---

## 〇 · 一句话结论

**成了。** 我们手上 P2L-1 的分层结果（9 层平色 PNG）→ 真 `.moc3`（**v3.00，文件头 `4D4F4333 01000000`**）
→ **装进外部宿主 `clients/live2d-host/` 的试装目录 → 能加载、能渲染、嘴参数命中 `ok`、喂一句话嘴真的动**
（`changedPixels = 267`，闭合重测 `0` 像素漂移）。
**P2L-1 那条"位图帧"路线用不上的 `.moc3` 机制，这条路全部复用得上。**

---

## 一 · 一条命令复现

```bash
# 从仓库根执行
bash tools/psd2moc3/scripts/00_fetch_prior_art.sh          # ① 取 3 个现成实现的源码（codeload，约 150 MB，默认 /tmp/p2l2/src）
PY=/path/to/python3                                       # 需含 numpy/Pillow/pydantic
I2L_SRC=/tmp/p2l2/src/image2live2d-main/src \
  $PY tools/psd2moc3/scripts/20_convert_moc3.py           # ③ 真出 .moc3（注入 native_moc_writer）
$PY tools/psd2moc3/scripts/30_crop_zoom.py                 # ④ 把嘴部差异裁出来放大（目视证据，需自备 mouth-iso 证据）
```

🔴 **③ 的依赖说明**：`20_convert_moc3.py` 需要 `image2live2d`（第三方，Apache-2.0，由 ① 下载）
与 `pydantic`。本机若无法 `pip install pydantic`，可用 `PYTHONPATH=/path/to/pydantic/site-packages` 复用。
`I2L_SRC` 环境变量指向 ① 解包的 image2live2d 源码树。

宿主侧（**只读复用，宿主不在本仓库内**，见 §四）：

```bash
HOST=/path/to/live2d-host                                 # 外部仓库 clients/live2d-host，需自备
node "$HOST/scripts/build.mjs"                       # 把新样本打进 out/
node "$HOST/tools/moc-version-probe.cjs" p2l2char    # 版本配对取证
node "$HOST/tools/render-matrix.cjs"                 # 渲染 + 嘴响应
node "$HOST/tools/mouth-iso.cjs" p2l2char            # 嘴参数隔离验证
LIVE2D_HOST_DIR="$HOST" \
  node tools/psd2moc3/scripts/40_acceptance.cjs p2l2char   # 文字→嘴参数→画面 全链路
```
（以上命令走 PATH 上的 `node`，不再写死 `/opt/homebrew/bin/node` —— node 可能来自 Homebrew / nvm / fnm / macports 等；若不在 PATH，用 `NODE=/path/to/node <命令>` 显式指定即可。）

---

## 二 · 产出长什么样

| 文件 | 说明 |
|---|---|
| `out/i2l/p2l2char.moc3` | 🔴 **真 Live2D 模型**，1,726,528 B，文件头 `4D 4F 43 33 01 00 00 00`（MOC3 v3.00） |
| `out/i2l/p2l2char.model3.json` | 模型清单（14 张贴图 / physics3 / cdi3 / 17 组 motion3） |
| `out/i2l/textures/*.png` | 14 张图集切片（含 i2l 自动合成的 `blush_l/r`、`eye_closed_l/r`） |
| `out/i2l/p2l2char.*.motion3.json` | **17 组**动作（Idle／Blink／Talk／Smile／Head_yaw…） |
| `out/layers_i2l/*.png` ＋ `_rename_map.json` | 改名后的图层（逐文件 sha256 证明像素没动） |
| `out/zoom/zoom_*_mouth.png` | 嘴部「闭合 vs 张开」放大 6 倍对照 |
| `out/acceptance/p2l2char_fullpage.png` | 浏览器里整页截图 |
| `out/acceptance_p2l2char.json` | 全链路验收数值（嘴参数逐帧采样） |

🔴 **未随仓库分发的产出**：`out/prior_art_evidence/`（三个现成实现的源码片段，由 ① 下载后生成）、
`../实现报告_P2L2_….anchors.md`（报告锚点表，报告不在本仓库）。这些 `out/` 产物全部由脚本重新生成或被外部报告持有，不入库。

---

## 三 · 管线三步

```
tools/portrait2live/out/layers/*.png        P2L-1 的分层结果（只读复用，需先跑 portrait2live）
        ↓  scripts/10_prepare_layers.py         改名成 {order}_{role}.png，sha256 逐文件复核
out/layers_i2l/{order}_{role}.png
        ↓  scripts/20_convert_moc3.py           注入 native_moc_writer 出 .moc3
out/i2l/p2l2char.{moc3,model3.json,physics3.json,cdi3.json,*motion3.json}
        ↓  scripts/30_crop_zoom.py              裁嘴部差异放大（目视）
        ↓  scripts/40_acceptance.cjs            浏览器里跑「文字→嘴参数→画面」
```

### 3.1 🔴 为什么必须改名（不是"顺手整理"）

`image2live2d` 的 `core/decompose/sources.py`：

- `parse_layer_name()` 逐字要求 `{order}_{role}`，`head.isdigit()` 为假就 `raise ValueError`；
- `from_layer_dir()` 逐字 `role = SemanticRole(role_str)`，**role 必须精确等于枚举值**，否则 `raise ValueError`。

P2L-1 的文件名（`torso.png` / `eye_l.png`）**语义对得上、格式过不了**。
改名后**逐文件 sha256 复核源与目标一致**，证明只动了名字没动像素。

### 3.2 🔴 为什么不能直接用 CLI

`image2live2d` 的 **CLI 不产 `.moc3`**：

- `__main__.py` 的 `--live2d` 只写 4 个开放 JSON；
- `.moc3` 由 `Live2DEmitter(moc_writer=...)` 这个**注入口**决定；
- 不注入时 `backends/live2d/moc3.py` 的 `write_moc3_from_template()` `raise NotImplementedError`，
  而 `backends/live2d/emitter.py` 里 **`Live2DEmitter.build()`** 的 `except NotImplementedError: pass`
  把它**静默吞掉** → 产出"JSON-only bundle"。

→ 必须绕开 CLI，注入 `image2live2d.backends.live2d.moc3_emit` 的模块级函数 **`native_moc_writer()`**。

🔴 **本节按模块／类／函数定位，不写行号**：`image2live2d` 是**第三方源码，不随本仓库分发**
（由 §一 的 `00_fetch_prior_art.sh` 现场下载），而该脚本取的是 `refs/heads/main` 的**当次分支顶端**
——**没有钉住 commit／tag，外部源码版本不随本仓固定**，写下的行号会随上游提交**静默失准**。

---

## 四 · 在宿主里的结果（**只读复用，没改宿主的实现**）

**改动清单（全部可核）**：宿主树里只动了**一处** —— `demo/demo.html` 第 127 行的 `MODELS` 数组
（加两个新样本名，好让页面能选到）；`out/` 下的一切都是 `build.mjs` 重新生成的。
其余全是**新增目录**（`samples/Resources/DS_p2l2`、`samples/Resources/p2l2char`）与**新增证据文件**。

| 检查项 | 结果 |
|---|---|
| Core 版本 | `csmGetVersion() = 100663297 (0x06000001)`，支持到 `MocVersion_53` |
| `csmGetMocVersion(p2l2char.moc3)` | **1 = MocVersion_30**，与文件头一致，`hasMocConsistency = true` |
| 渲染 | ✅ `rendered=true` |
| 嘴参数命中级别 | ✅ `lipSync.status = ok`，`parameter = ParamMouthOpenY`，`source = L1-模型自声明(Groups.LipSync)` |
| 写值看画面 | ✅ `changedPixels = 267`（bbox 27×27），**改回后 `changedPixels = 0`** |
| 文字 → 嘴参数 | ✅ 24 帧采样，`max = 0.344`，8 帧非零，**0 条 pageerror** |
| 相位→表情 | ❌ **`unavailable`（表情个数 = 0）** —— 但 **17 组动作**可用（见报告 §六） |
| 动作组 | p2l2char **17 组**（Idle/Blink/Talk/Smile/…）／DS_p2l2 **4 组**（Idle/Blink/Nod/Shake） |

🔴 **顺带查出一条与本次产物无关、但会挡产品的既有缺陷**（报告 §五详述）：
`src/host.js` 的 `update()` 在 `motionManager.isFinished()` 为真时无条件
`startRandomIdleMotion()` → `startMotionPriority(null, …)` → 下一帧 `updateMotion()` 读到 **null** →
`TypeError: Cannot read properties of null (reading 'duration')` → **渲染循环停住**。
**Haru／DS_p2l2／p2l2char 三个模型全部复现**，属宿主侧集成问题，不是 `.moc3` 的问题。

---

## 五 · 已知边界（换素材/换场景要重核）

1. **本轮的"分层图"来自 P2L-1 的程序化分层**（平色块画风）。真实手绘立绘（渐变／厚涂）**过不了那一关**，
   得先解决"单图分层"——`image2live2d` 自己也是把这一步外包给 See-through（要 CUDA）。
2. **两条侧发共用同一个 `hair_side` 语义**（枚举里没有左右之分）→ 摆动会一起走。
3. **图层缝隙可见**：平色块图层在关节处有细线／锯齿（见 `contact_sheet.png` 最后一行）。
   真实产品需要画师出规范 PSD（i2l / psd2live 都给了命名规范）。
4. **只测了"静态加载 + 嘴驱动"**：头转／物理／17 组动作**只验了声明与能力发现，没逐条看画面**。
5. **`.moc3` 是 i2l 自研编解码器产的 v3.00**，不是 Cubism 官方编辑器产的；本机 Cubism Viewer 未安装，
   **"官方运行时里长什么样"本轮没验**。
