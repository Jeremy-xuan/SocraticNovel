#!/usr/bin/env bash
# 43_mem_cmd_calibration.sh —— 内存命令的**单位与口径标定**（任务代号 LAYER-MOUTH 步骤 ④）
#
# 目的：在同一个进程上同时问四个命令，而**真实占用是已知的**（42_mem_allocator.py 分配 --mb 并逐页触碰）。
#   A `/usr/bin/time -l`      → maximum resident set size（内核 rusage，单位**字节**）
#   B `ps -o rss=,vsz=`       → rss / vsz（单位 KB）
#   C `top -l 2 -pid P -stats rsize,vsize,mem` → 实测口径见下（不是 RSS！）
#   D `footprint P` / `vmmap P` → Physical footprint（**含被压缩页**）
#
# 🔴 顺序有讲究：`/usr/bin/time -l` 的统计是**进程退出时**才写进 stderr 的，
#    所以必须先采样 B/C/D、再 `wait`、最后才读 time -l。第一版没注意这点，读到 0 MB。
#
# 用法：
#   bash scripts/43_mem_cmd_calibration.sh [MB]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
PY="${PY:-/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python}"
MB="${1:-800}"
OUTDIR="$ROOT/out/mem"
mkdir -p "$OUTDIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
LOG="$OUTDIR/${STAMP}_calib_workload.log"
TIMELL="$OUTDIR/${STAMP}_calib_timel.txt"
REPORT="$OUTDIR/${STAMP}_calibration.txt"
STABLE="$OUTDIR/CALIBRATION_latest.txt"      # 稳定名：报告要锚它

echo "=== 标定负载：分配 ${MB} MB 并逐页触碰 ==="
/usr/bin/time -l "$PY" "$HERE/42_mem_allocator.py" --mb "$MB" --hold 10 > "$LOG" 2> "$TIMELL" &
WRAPPER=$!
for _ in $(seq 1 60); do
    P="$(sed -n 's/^MARK pid=\([0-9]*\).*/\1/p' "$LOG" 2>/dev/null | head -1)"
    [ -n "${P:-}" ] && break
    sleep 0.2
done
echo "pid = ${P:-未取到}"
# 等分配完成（日志里出现 MARK allocated）
for _ in $(seq 1 60); do
    grep -q "^MARK allocated" "$LOG" 2>/dev/null && break
    sleep 0.2
done
sleep 1.0

PSOUT="$(ps -o rss=,vsz= -p "$P")"
TOPOUT="$(top -l 2 -pid "$P" -stats rsize,vsize,mem 2>/dev/null | tail -1)"
VMOUT="$(vmmap "$P" 2>/dev/null | grep -iE "^Physical footprint" )"
FPOUT="$(footprint "$P" 2>/dev/null | sed -n 's/.*phys_footprint: *\([0-9]*\) *MB.*/\1/p' | head -1)"
FP2="$(footprint "$P" 2>/dev/null | sed -n 's/.*phys_footprint_peak: *\([0-9]*\) *MB.*/\1/p' | head -1)"

wait "$WRAPPER" 2>/dev/null
AB="$(grep "maximum resident set size" "$TIMELL" | awk '{print $1}')"

{
echo "### 标定：真实分配 = ${MB} MB（逐页触碰，物理页确已占用）"
echo
echo "--- A) /usr/bin/time -l 的 maximum resident set size（单位：字节）---"
grep -E "maximum resident set size|page reclaims|page faults|swaps" "$TIMELL" | sed 's/^/    /'
echo "    换算 = $(( ${AB:-0} / 1024 / 1024 )) MB"
echo
echo "--- B) ps -o rss=,vsz= -p $P ---"
echo "    $PSOUT   （KB）"
echo "    换算 rss = $(( $(echo "$PSOUT" | awk '{print $1}') / 1024 )) MB"
echo
echo "--- C) top -l 2 -pid $P -stats rsize,vsize,mem（最后一行）---"
echo "    $TOPOUT"
echo "    表头逐字为 MEM / VSIZE / MEM；第一个 MEM 即 rsize 列"
echo
echo "--- D) vmmap $P ---"
echo "    $VMOUT" | sed 's/^/    /'
echo "--- D2) footprint $P ---"
echo "    phys_footprint      = ${FPOUT} MB"
echo "    phys_footprint_peak = ${FP2} MB"
echo
echo "--- 被测进程自报（resource.getrusage 的 ru_maxrss，单位字节）---"
grep "^MARK" "$LOG" | sed 's/^/    /'
echo
echo "--- 结论 ---"
echo "    真实值 = ${MB} MB。以上各命令谁准、单位是什么，看上面对比。"
} | tee "$REPORT" "$STABLE"

echo
echo "落盘：$REPORT"
