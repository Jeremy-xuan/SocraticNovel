#!/usr/bin/env bash
# 00_fetch_prior_art.sh —— 取 3 个现成实现的源码（本机 github.com 直连被 Clash TUN 劫持 → 走 codeload）
#
# 🔴 本机实测（2026-09-24）：
#   - api.github.com 未鉴权时**会 403 rate limit**（同 IP 共享额度）→ 只用于"搜索找仓库名"，不要用于取内容
#   - codeload.github.com **可用**（HTTP 200），走它下 tar.gz 最稳
#
# 用法：bash scripts/00_fetch_prior_art.sh [目标目录]     默认 /tmp/p2l2/src
set -euo pipefail

DST="${1:-/tmp/p2l2/src}"
mkdir -p "$DST"
cd "$DST"

fetch() {
  local repo="$1" branch="$2" out="$3"
  if [ -d "$out" ]; then echo "[skip] $out 已存在"; return 0; fi
  local tgz="/tmp/p2l2/$(echo "$repo" | tr '/' '_').tar.gz"
  echo "[get ] $repo@$branch"
  curl -sSL -m 300 -o "$tgz" -w "       HTTP %{http_code} size=%{size_download}\n" \
    "https://codeload.github.com/$repo/tar.gz/refs/heads/$branch"
  tar xzf "$tgz"
  # 解包后目录名带 -<branch>
  local unpacked="${repo##*/}-${branch}"
  [ -d "$unpacked" ] && [ "$unpacked" != "$out" ] && mv "$unpacked" "$out"
  echo "       -> $out"
}

# ① image2live2d —— 纯 Python，Apache-2.0，**本轮的 .moc3 生成器就是它**
fetch "Wzhang3912/image2live2d" main image2live2d-main

# ② psd2live —— Kotlin/Gradle 桌面应用，GPL-3.0
#    🔴 关键：它**单独 checkout 编译不了** —— settings.gradle.kts 里写死
#       `includeBuild("../umamo")`，而 umamo **不在这个仓库里**。
fetch "tsunehimatoi/psd2live" main psd2live-main

# ③ umamo —— psd2live 真正依赖的 MOC3 编解码器在这里（GPL-3.0）
fetch "umamoorg/umamo" master umamo-master

echo
echo "[ok] 源码在 $DST"
echo "     image2live2d 的 moc3 生成器：image2live2d-main/src/image2live2d/backends/live2d/moc3_emit.py"
echo "     psd2live 的 moc3 写出：psd2live-main/src/main/kotlin/io/github/psd2live/core/PSD2LivePipeline.kt:78-88"
echo "     umamo 的 moc3 编码器：umamo-master/module/format/src/commonMain/kotlin/org/umamo/format/moc3/encode/MocEncoder.kt"
