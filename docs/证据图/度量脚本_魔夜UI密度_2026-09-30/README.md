# 度量脚本 · 魔夜 UI 装饰密度（2026-09-30）

配套报告：`../度量_真实魔夜UI密度_2026-09-30.md`

本目录是那条报告里**所有数字**的产生地。所有度量用同一个内核 `measure_png.py`，真实 PNG 与我们的暖纸渲染
**走同一套算法**，可逐项复算。

## 一键复跑

```bash
cd "开源线/DSH定制/度量脚本_魔夜UI密度_2026-09-30"

# 1) 暖纸渲染（playwright 在项目根，必须让 node 解析得到）
OUT="$PWD/render" NODE_PATH="/Users/wujunjie/Documents/ChatGPT/大学申请/node_modules" \
  node render_warm.js

# 2) 真实 PNG 整图 + atlas 单格 + 主色表 + 并排差距表
python3 run_all.py

# 3) 暖纸整屏 + 构件裁件（依赖 1) 产出的 render/ 与 warm_rects.json）
python3 measure_warm.py
```

## 脚本

| 脚本 | 作用 | 主要产出 |
|---|---|---|
| `measure_png.py` | **度量内核**：α 占比／外圈占比（3×3 腐蚀）／内部描线占比（σ=1 高斯 + Sobel，增益 8.0 已用线性斜坡标定；判据 G>0.08 与 >0.03 两档）／梯度分位／HSV 色相圆周中位数（S≥0.15 & V≥0.10 门限）／α 峰值与 p95 | 直接打 JSON |
| `extract_cells.py` | 把 atlas 型 PNG 按 α 投影自动切成单格（滤 <2px 碎片），逐格调内核 | `cells.json`、`cells_report.txt` |
| `row_structure.py` | 517×64 单行的逐列剖面、花饰显著列段（dev > 3×median）、横向可拉伸中段、跨家族 α 差异、非空格计数 | `row_structure.json` |
| `render_warm.js` | Playwright 渲染 `avalon-warm.html?screen=1..4`、`reading-v2.html` 三态（1920×1080，关动画），并抓 `getBoundingClientRect` + 计算样式 | `render/warm_*.png`、`warm_rects.json` |
| `measure_warm.py` | 用同一内核量暖纸整屏与构件裁件 | `warm.json`、`crop_*.png` |
| `palette.py` | 两侧最高频色（RGB + HSV，不经饱和度门限） | `palette.json` |
| `compare.py` | 并排差距表 + 无文字条带（分开"文字梯度"与"装饰梯度"） | `compare_rows.json`、`strips.json`、`strip_*.png` |
| `run_all.py` | 除渲染外一次性复跑全部 | `real.json` 等 |

## 数据

| 文件 | 内容 |
|---|---|
| `real.json` | 10 张真实目标图（`mu_text1` 四态 + `back_win`／`archive_window_waku`／`menu_window`／`modepanel_window`／`archive_txtsentaku`／`mu_text0`）整图读数 |
| `cells.json` | 上述 10 张按 α 投影切出的全部单格读数（含网格几何、每格 `cell_box_xyxy`） |
| `row_structure.json` | 单行剖面、花饰列段、跨家族逐列差异 |
| `warm.json` / `warm_rects.json` | 暖纸整屏与构件裁件读数 / 各构件矩形与计算样式 |
| `palette.json` | 两侧主色表 |
| `compare_rows.json` | 52 行并排表（真实／暖纸／尺寸／四项读数） |
| `strips.json` | 6 条"无文字条带"读数 |
| `run_all.log` | 最近一次全量复跑的日志 |

## 证据图

`preview_target10.png`（10 张真实目标图预览）· `mu_text0_2x.png`／`mu_text1_cell00_2x.png`（单行 2×）·
`ends_mu_text0r0_8x.png`（行端 8×）· `components_sheet.png`（构件族预览）·
`selwin_row_ends_6x.png`（选项行端饰 6×）· `dialogwin_corner_5x.png`（对话框四角 5×）·
`nz13LU_zoom.png`（对话气泡 3×）· `nz13_pieces_colored.png`（五片着色叠加，用于说明"非互斥切片"）·
`row_compare_3x.png` · `crop_*.png`（暖纸构件裁件）· `strip_*.png`（无文字条带）

## 只读声明

这些脚本**只读**素材：

- `~/Desktop/moye/hfa_png/out/data00000/`（1094 个 PNG，只读）
- `开源线/DSH定制/参考素材_真实界面/`（截图与放大图，只读）
- `开源线/DSH定制/code/mockups/stage-modern/`（暖纸 HTML，只读；渲染用 `file://`）

写入只发生在**本目录**与 `render/`。
