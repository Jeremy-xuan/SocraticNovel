#!/usr/bin/env bash
# run_all.sh —— 一条命令从零跑完整个 PoC（复现入口）。
#
# 用法（工作目录任意，推荐从仓库根执行）：
#   bash tools/portrait2live/run_all.sh
#
# 它做四件事：
#   ① 生成静态立绘（代码绘制，非下载）        → src_assets/
#   ② 自动分层 + 无损校验                      → out/layers/
#   ③ 渲染三种模式各 90 帧                     → out/frames_{idle,speak,write}/
#   ④ 编码 MP4 + GIF，并跑程序化质检           → out/anim_*.{mp4,gif} + out/verify.json
#
# 🔴 Python 环境：本脚本**不安装任何东西**。它需要一个含 numpy+scipy+Pillow 的 Python 3。
#    PY 默认取 PATH 上的 `python3`；若该解释器缺依赖，下面的 import 自检会**响亮失败**并退出。
#    也可用 `PY=/path/to/python3 bash run_all.sh` 指定。
#    注：旧工作区里那个现成的 venv（poc_动画可写性/env）**不随本仓库分发**，请自备等价环境。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 🔴 解析成可执行文件的绝对路径：先走 PATH（command -v），再退到「本身就可执行」的绝对/相对路径；
#    都不是就响亮失败，不静默猜。这样既不硬编码 Homebrew，也不会出现「PATH 上的名字假失败」的问题。
resolve_exe() {
  local p
  if p="$(command -v "$1" 2>/dev/null)" && [ -n "$p" ]; then
    printf '%s' "$p"; return 0
  fi
  if [ -x "$1" ]; then printf '%s' "$1"; return 0; fi
  return 1
}

cd "$HERE"

# 🔴 旧工作区的 venv 不随仓库走；默认用 PATH 上的 python3（可经 PY 环境变量覆盖），
#    缺失依赖时由下方 import 自检响亮报错。
if ! PY="$(resolve_exe "${PY:-python3}")"; then
  echo "❌ 找不到 Python 解释器：${PY:-python3}"
  echo "   用 PY=/path/to/python3 指定一个含 numpy/scipy/Pillow 的解释器。"
  exit 1
fi

# 🔴 ffmpeg：FFMPEG 显式优先；否则解析 PATH 上的 ffmpeg；都不行就响亮失败，不硬编码 Homebrew。
if ! FFMPEG="$(resolve_exe "${FFMPEG:-ffmpeg}")"; then
  echo "❌ 找不到 ffmpeg（PATH 上也没有）。"
  echo "   用 FFMPEG=/path/to/ffmpeg 显式指定，或先把它装进 PATH。"
  exit 1
fi

echo "Python : $PY"
"$PY" -c "import numpy,scipy,PIL;print('  numpy',numpy.__version__,'scipy',scipy.__version__,'Pillow',PIL.__version__)"
echo "ffmpeg : $FFMPEG"
echo

echo "① 生成静态立绘（代码绘制）"
"$PY" scripts/00_gen_source_portrait.py

echo
echo "② 自动分层 + 无损校验"
"$PY" scripts/10_segment_layers.py

echo
echo "③ 渲染三种模式（各 90 帧 @30fps）"
for MODE in idle speak write; do
  "$PY" scripts/20_animate.py --mode "$MODE" --frames 90 --fps 30
  echo
done

echo "④ 编码 MP4 + GIF"
FFMPEG="$FFMPEG" bash scripts/40_encode.sh

echo
echo "⑤ 程序化质检"
"$PY" scripts/30_verify.py

echo
echo "✅ 全部完成。产出在 $HERE/out/"
