#!/bin/bash
# 07_sdpa_sweep.sh —— 逐形状、**每个形状一个干净进程**的 SDPA 上限扫描
# 依据：05 实测「同一进程第一次 Invalid buffer size 之后，后面全部失真」
# 用法: 07_sdpa_sweep.sh <out.jsonl>
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:?need out jsonl}"
PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python
export SSL_CERT_FILE=/etc/ssl/cert.pem
: > "$OUT"

# 每行: B H L  （注释说明这一档在验什么）
while read -r B H L note; do
  [ -z "${B:-}" ] && continue
  case "$B" in \#*) continue;; esac
  echo "### B=$B H=$H L=$L  ($note)" | tee -a "$OUT"
  $PY -u "$HERE/06_sdpa_one.py" --B "$B" --H "$H" --L "$L" 2>&1 | grep -E "^RESULT|Error|error" | tee -a "$OUT"
  echo | tee -a "$OUT"
done <<'LIST'
20 5 9216 768² marigold 的候选形状（预测 15.82 GiB 失败 = 复现上一路的崩点）
13 5 9216 768² layerdiff body 的候选形状（上一路实测**通过**）
20 5 4096 512² marigold 的候选形状（预测 3.13 GiB）
13 5 4096 512² layerdiff body 的候选形状（预测 2.03 GiB）
1 8 17409 05 探针里的首个失败点（复现 16.00 GiB，用于刻画上限）
1 5 9216 对照：B=1 时同 L（预测 0.79 GiB）
LIST
echo "### sweep 结束"
