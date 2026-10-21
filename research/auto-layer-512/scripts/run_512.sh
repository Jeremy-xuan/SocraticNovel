#!/bin/bash
# run_512.sh —— 512² 完整 call 的受测运行（三通道记录）
#   $1 = tag   $2 = 最长采样秒  其余参数透传给 40_full_call.py
# 用法:
#   bash scripts/run_512.sh full512_s1 900  --steps 1 --resolution 512 --attn-slice max --tag full512_s1
set -u
TAG="$1"; MAX="$2"; shift 2
HERE="$(cd "$(dirname "$0")" && pwd)"
PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python
export SSL_CERT_FILE=/etc/ssl/cert.pem
exec bash "$HERE/run_measured.sh" "$TAG" "$MAX" "$PY" -u "$HERE/40_full_call.py" "$@"
