#!/usr/bin/env bash
# 50_check_deliverables.sh —— 交付物自检：**产出真的在、且真的能播**。
#
# 用法：bash scripts/50_check_deliverables.sh
#
# 检查项：
#   ① 必需文件是否存在
#   ② MP4 是否可解码、帧数/分辨率/帧率是否与声明一致
#   ③ GIF 是否可解码、帧数是否一致
#   ④ 逐文件 sha256（便于跨会话核对"我拿到的和你跑出来的是不是同一份"）
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"

# 🔴 ffprobe：FFPROBE 显式优先；否则解析 PATH 上的 ffprobe；都不行就响亮失败，不硬编码 Homebrew。
resolve_exe() {
  local p
  if p="$(command -v "$1" 2>/dev/null)" && [ -n "$p" ]; then
    printf '%s' "$p"; return 0
  fi
  if [ -x "$1" ]; then printf '%s' "$1"; return 0; fi
  return 1
}
if ! FFPROBE="$(resolve_exe "${FFPROBE:-ffprobe}")"; then
  echo "❌ 找不到 ffprobe（PATH 上也没有）。" >&2
  echo "   用 FFPROBE=/path/to/ffprobe 显式指定，或先把它装进 PATH。" >&2
  exit 1
fi
FAIL=0

cd "$ROOT"

echo "=== ① 必需文件 ==="
REQUIRED="
src_assets/portrait_flat.png
src_assets/portrait_nearest.png
src_assets/palette.json
out/layers/manifest.json
out/layers/torso.png
out/layers/hair_back.png
out/layers/face.png
out/layers/eye_l.png
out/layers/eye_r.png
out/layers/mouth.png
out/layers/side_l.png
out/layers/side_r.png
out/layers/bangs.png
out/anim_idle.mp4
out/anim_speak.mp4
out/anim_write.mp4
out/anim_idle.gif
out/anim_speak.gif
out/anim_write.gif
out/verify.json
"
for f in $REQUIRED; do
  if [ -f "$f" ]; then printf "  ✅ %s\n" "$f"
  else printf "  ❌ 缺失 %s\n" "$f"; FAIL=1; fi
done

echo
echo "=== ② MP4 可解码性 ==="
# 🔴 注意 ffprobe `-of csv=p=0` 的输出顺序**不是** -show_entries 的书写顺序，
#    实测固定为 width,height,r_frame_rate,nb_frames（与声明顺序无关）。
for M in idle speak write; do
  F="out/anim_$M.mp4"
  [ -f "$F" ] || continue
  INFO=$("$FFPROBE" -v error -select_streams v:0 \
        -show_entries stream=codec_name,width,height,nb_frames,r_frame_rate \
        -of csv=p=0 "$F" 2>/dev/null)
  printf "  %-18s %s\n" "$F" "$INFO"
  case "$INFO" in
    h264,1024,1024,30/1,90) ;;
    *) printf "     ⚠️  与声明不一致（期望 h264,1024,1024,30/1,90）\n"; FAIL=1 ;;
  esac
done

echo
echo "=== ③ GIF 可解码性 ==="
for M in idle speak write; do
  F="out/anim_$M.gif"
  [ -f "$F" ] || continue
  INFO=$("$FFPROBE" -v error -select_streams v:0 \
        -show_entries stream=width,height,nb_frames -of csv=p=0 "$F" 2>/dev/null)
  printf "  %-18s %s\n" "$F" "$INFO"
  case "$INFO" in
    512,512,90) ;;
    *) printf "     ⚠️  与声明不一致（期望 512,512,90）\n"; FAIL=1 ;;
  esac
done

echo
echo "=== ④ sha256 ==="
shasum -a 256 \
  src_assets/portrait_flat.png \
  src_assets/portrait_nearest.png \
  out/anim_idle.mp4 out/anim_speak.mp4 out/anim_write.mp4 \
  out/anim_idle.gif out/anim_speak.gif out/anim_write.gif \
  out/layers/manifest.json out/verify.json

echo
if [ "$FAIL" -eq 0 ]; then echo "✅ 交付物自检通过"; else echo "❌ 交付物自检未通过"; fi
exit "$FAIL"
