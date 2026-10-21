#!/usr/bin/env bash
# 40_encode.sh —— 把渲染出来的帧编成**可播放的证据**：MP4（H.264）＋ GIF。
#
# 用法：bash scripts/40_encode.sh
#
# 说明：
#   · MP4 用 libx264 + yuv420p（最通用的播放兼容组合）；帧率与渲染一致（30 fps）。
#   · GIF 用调色板法（palettegen/paletteuse）—— 比默认 GIF 编码清晰得多；
#     同时缩放一半边长，否则 1024² 的 GIF 体积会大到不好用。
#   · 输出到 out/：anim_<mode>.mp4 / anim_<mode>.gif
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"

# 🔴 ffmpeg：FFMPEG 显式优先；否则解析 PATH 上的 ffmpeg；都不行就响亮失败，不硬编码 Homebrew。
resolve_exe() {
  local p
  if p="$(command -v "$1" 2>/dev/null)" && [ -n "$p" ]; then
    printf '%s' "$p"; return 0
  fi
  if [ -x "$1" ]; then printf '%s' "$1"; return 0; fi
  return 1
}
if ! FFMPEG="$(resolve_exe "${FFMPEG:-ffmpeg}")"; then
  echo "❌ 找不到 ffmpeg（PATH 上也没有）。" >&2
  echo "   用 FFMPEG=/path/to/ffmpeg 显式指定，或先把它装进 PATH。" >&2
  exit 1
fi
FPS=30
MODES="idle speak write"

for MODE in $MODES; do
  SRC="$ROOT/out/frames_$MODE/f_%04d.png"
  if [ ! -d "$ROOT/out/frames_$MODE" ]; then
    echo "⚠️  跳过 $MODE（没有帧目录）"; continue
  fi

  echo "── $MODE ──"

  # MP4（H.264 / yuv420p）
  "$FFMPEG" -y -loglevel error -framerate "$FPS" -i "$SRC" \
    -c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart \
    "$ROOT/out/anim_$MODE.mp4"
  MP4_SIZE=$(stat -f%z "$ROOT/out/anim_$MODE.mp4")

  # GIF（palettegen → paletteuse），边长减半
  "$FFMPEG" -y -loglevel error -framerate "$FPS" -i "$SRC" \
    -vf "scale=512:-1:flags=lanczos,palettegen=stats_mode=diff" \
    "$ROOT/out/_palette_$MODE.png"
  "$FFMPEG" -y -loglevel error -framerate "$FPS" -i "$SRC" -i "$ROOT/out/_palette_$MODE.png" \
    -lavfi "scale=512:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" \
    "$ROOT/out/anim_$MODE.gif"
  GIF_SIZE=$(stat -f%z "$ROOT/out/anim_$MODE.gif")
  rm -f "$ROOT/out/_palette_$MODE.png"

  printf "  anim_%s.mp4  %8d bytes\n" "$MODE" "$MP4_SIZE"
  printf "  anim_%s.gif  %8d bytes\n" "$MODE" "$GIF_SIZE"
done

echo
echo "全部产出："
ls -la "$ROOT/out/" | grep -E "anim_.*\.(mp4|gif)"
