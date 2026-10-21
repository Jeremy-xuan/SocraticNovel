#!/bin/bash
# run_measured.sh —— 一次「受测运行」的三通道记录包装器
#
# 三通道（互相独立，用于交叉验证）：
#   ① `/usr/bin/time -l`  -> maximum resident set size ＋ **peak memory footprint**
#      （后者就是 macOS 的 phys_footprint 峰值，是"真实占用"最权威的一个数）
#   ② `memwatch.sh` 定时采样 `top -pid` 的 MEM 列（＝进程 phys_footprint 瞬时值）
#      ＋ 系统级 `vm_stat` / `sysctl vm.swapusage`
#   ③ 受测进程内部自记的 `resource.ru_maxrss`（写进各自的 json 台账）
#
# 🔴 为什么不用 `ps aux`：它的 RSS **不含被压缩/换出的页**。上一路实测进程真占 20–23 GB 时
#    `ps` 只报 47 MB，差点据此误判"没在干活"。
#
# 用法: run_measured.sh <tag> <最长采样秒> <命令...>
set -u
TAG="${1:?need tag}"; MAXSEC="${2:?need maxsec}"; shift 2

HERE="$(cd "$(dirname "$0")" && pwd)"
E="$(cd "$HERE/.." && pwd)/evidence"
mkdir -p "$E"
PIDF="$E/.pid_$TAG"
rm -f "$PIDF"

echo "[run_measured] tag=$TAG  maxsec=$MAXSEC  cmd=$*"

# `echo $$ > pidf; exec "$@"` 让 bash 把自己的 pid 交给 python，且 exec 后 pid 不变
# → memwatch 能拿到**真正在跑的那个进程**的 pid（不是 /usr/bin/time 的）
/usr/bin/time -l -o "$E/time_${TAG}.txt" \
  bash -c 'echo $$ > "'"$PIDF"'"; exec "$@"' _ "$@" \
  > "$E/stdout_${TAG}.log" 2> "$E/stderr_${TAG}.log" &
WRAP=$!

for _ in $(seq 1 200); do [ -s "$PIDF" ] && break; sleep 0.1; done
PID="$(cat "$PIDF" 2>/dev/null || true)"
if [ -n "${PID:-}" ]; then
  bash "$HERE/memwatch.sh" "$PID" 2 "$MAXSEC" "$E/mem_${TAG}.csv"
else
  echo "[run_measured] ⚠️ 没拿到 pid，采样跳过"
fi

wait $WRAP; RC=$?
echo "[run_measured] tag=$TAG 退出码=$RC"
[ -f "$E/time_${TAG}.txt" ] && grep -E "maximum resident set size|peak memory footprint|real" "$E/time_${TAG}.txt"
exit $RC
