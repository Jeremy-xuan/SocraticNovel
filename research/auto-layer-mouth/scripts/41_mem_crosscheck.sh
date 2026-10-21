#!/usr/bin/env bash
# 41_mem_crosscheck.sh —— 内存测量的**两条独立命令交叉验证**（任务代号 LAYER-MOUTH 步骤 ④）
#
# 为什么需要这个脚本（上一路差点误判）：
#   `ps aux` 的 RSS **不含被换出（swapped out）与被压缩（compressor）的页**。
#   上一路因此一度以为进程只占 47 MB，`top` 才看到真实的 20–23 GB。
#   → 结论：**测内存不能只报一个数、不能用瞬时 RSS 当峰值。**
#
# 本脚本对**同一个负载**同时用两条互相独立的通道测峰值，并要求两数一致：
#   通道 A（进程外，内核记账）：/usr/bin/time -l 的 "maximum resident set size"
#       —— 为什么准：这是 wait4(2) 返回的 rusage.ru_maxrss，由**内核**在整个进程生命周期里
#          单调累计的峰值，采样不到、也漏不掉瞬时尖峰。
#   通道 B（进程外，周期采样）：top -l 2 -pid <pid> -stats rsize,vsize,mem  ＋ ps -o rss=,vsz=
#       —— 为什么也要它：它是**独立实现**（采样 /proc 等价物），能交叉验证 A；
#           且它给出瞬时曲线，能看出"峰值出现在哪一段"。
#   辅助 C（系统级换页/压缩证据）：sysctl vm.swapusage ＋ vm_stat 的
#       "Pages stored in compressor" / "Pageins" / "Swapouts" 前后差值
#       —— 为什么必须带：RSS 少而 swap/compressor 高，说明"没占内存"是假象。
#
# 用法：
#   bash scripts/41_mem_crosscheck.sh [--device mps|cpu] [--hold 6]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
PY="${PY:-/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python}"
DEVICE="${DEVICE:-mps}"
HOLD="${HOLD:-6}"
OUTDIR="$ROOT/out/mem"
mkdir -p "$OUTDIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
SAMPLE="$OUTDIR/${STAMP}_samples.txt"
TIMELL="$OUTDIR/${STAMP}_timel.txt"
# 稳定文件名：报告要引用它，所以不能是带时间戳的一次性文件
STABLE="$OUTDIR/CROSSCHECK_latest.txt"
exec > >(tee "$STABLE") 2>&1

echo "=== 负载：SAM 语义分割（${DEVICE}）｜peak 保持 ${HOLD}s ==="
echo "--- 通道 C 前置：系统换页/压缩基线"
sysctl vm.swapusage | tee "$OUTDIR/${STAMP}_swap_before.txt"
vm_stat > "$OUTDIR/${STAMP}_vmstat_before.txt"
grep -E "Pages stored in compressor|Pageins|Pageouts|Swapins|Swapouts" "$OUTDIR/${STAMP}_vmstat_before.txt" || true

# ---------- 通道 A：/usr/bin/time -l（内核 rusage 峰值）----------
/usr/bin/time -l "$PY" "$HERE/40_mem_probe_workload.py" --device "$DEVICE" --hold "$HOLD" \
    --tag "mem_${DEVICE}_${STAMP}" > "$OUTDIR/${STAMP}_workload.log" 2> "$TIMELL" &
WRAPPER_PID=$!

# 🔴 取被测 python 的 pid —— **不能用 `pgrep -f 脚本名`**：
#    实测踩过：`/usr/bin/time -l <py> 40_mem_probe_workload.py …` 的命令行里也含脚本名，
#    pgrep 会先匹配到 **/usr/bin/time 这个包装进程**（RSS 1 MB、VSZ 400 GB）→ 采到的是包装器，
#    于是"通道 B 只有 1 MB"这种荒谬结论就出来了。
#    正确做法：让被测负载自己把 pid 打出来（脚本里 `print("MARK pid=…")`），从日志里取。
for _ in $(seq 1 60); do
    PYPID="$(sed -n 's/^MARK pid=\([0-9]*\).*/\1/p' "$OUTDIR/${STAMP}_workload.log" 2>/dev/null | head -1)"
    [ -n "${PYPID:-}" ] && break
    sleep 0.2
done
echo "python pid = ${PYPID:-（未取到）}"
if [ -z "${PYPID:-}" ]; then
    echo "⚠️ 取不到被测进程 pid —— 通道 B 无意义，只信通道 A" >&2
fi

# ---------- 通道 B：周期采样（三条独立实现：top / ps / footprint）----------
# 🔴 单位已由 43_mem_cmd_calibration.sh 标定（分配 800 MB 实测）：
#     ps -o rss  = **KB**；top 的 rsize 与 mem 列 = **MB**；footprint = MB
: > "$SAMPLE"
echo "# epoch  ps_rss_kb  ps_vsz_kb  top_rsize_MB  top_mem  phys_footprint_MB" >> "$SAMPLE"
MAX_PS=0
MAX_TOP=0
MAX_FP=0
while kill -0 "$WRAPPER_PID" 2>/dev/null; do
    if [ -n "${PYPID:-}" ] && kill -0 "$PYPID" 2>/dev/null; then
        PSV="$(ps -o rss=,vsz= -p "$PYPID" 2>/dev/null | tr -s ' ' | sed 's/^ //')"
        PS_RSS="$(echo "$PSV" | awk '{print $1+0}')"
        PS_VSZ="$(echo "$PSV" | awk '{print $2+0}')"
        TOPV="$(top -l 2 -pid "$PYPID" -stats rsize,vsize,mem 2>/dev/null | tail -1 | tr -s ' ')"
        TOP_RSIZE="$(echo "$TOPV" | awk '{print $1+0}')"
        TOP_VSIZE="$(echo "$TOPV" | awk '{print $2}')"
        TOP_MEM="$(echo "$TOPV" | awk '{print $3}')"
        # 🔴 通道 D：phys_footprint（**含被压缩页**）—— 这是 RSS 之外的真相
        FP="$(footprint "$PYPID" 2>/dev/null | sed -n 's/.*phys_footprint: *\([0-9]*\) *MB.*/\1/p' | head -1)"
        echo "$(date +%s) $PS_RSS $PS_VSZ ${TOP_RSIZE:-0} ${TOP_MEM:-?} ${FP:-0}" >> "$SAMPLE"
        [ "$PS_RSS" -gt "$MAX_PS" ] 2>/dev/null && MAX_PS=$PS_RSS
        [ "${TOP_RSIZE:-0}" -gt "$MAX_TOP" ] 2>/dev/null && MAX_TOP=$TOP_RSIZE
        [ "${FP:-0}" -gt "$MAX_FP" ] 2>/dev/null && MAX_FP=$FP
    fi
    sleep 0.5
done
wait "$WRAPPER_PID"
echo "（负载结束）"

# ---------- 通道 C 后置 ----------
sysctl vm.swapusage | tee "$OUTDIR/${STAMP}_swap_after.txt"
vm_stat > "$OUTDIR/${STAMP}_vmstat_after.txt"

# ---------- 汇总 ----------
echo
echo "=== 通道 A：/usr/bin/time -l（内核 rusage 峰值）==="
grep -E "maximum resident set size|real|user|sys|page reclaims|page faults|swaps" "$TIMELL" | sed 's/^/  /'

echo
echo "=== 通道 B：周期采样（三条独立实现，各自最大值）==="
N=$(awk 'NR>1' "$SAMPLE" | wc -l | tr -d ' ')
echo "  采样点 $N 个"
echo "  ps  -o rss（KB）          峰值 = ${MAX_PS} KB = $(echo "scale=1; $MAX_PS/1024" | bc) MB"
echo "  top -stats rsize（MB）    峰值 = ${MAX_TOP} MB"
echo "  footprint phys_footprint  峰值 = ${MAX_FP} MB   ← 含被压缩页"
echo "  采样文件：$SAMPLE"

echo
echo "=== 通道 C：换页/压缩（RSS 之外的内存）==="
echo "  swap 前：$(cat "$OUTDIR/${STAMP}_swap_before.txt")"
echo "  swap 后：$(cat "$OUTDIR/${STAMP}_swap_after.txt")"
for k in "Pages stored in compressor" "Pageins" "Pageouts" "Swapins" "Swapouts"; do
    b=$(grep "$k" "$OUTDIR/${STAMP}_vmstat_before.txt" | awk '{print $NF}' | tr -d '.')
    a=$(grep "$k" "$OUTDIR/${STAMP}_vmstat_after.txt" | awk '{print $NF}' | tr -d '.')
    echo "  ${k}: ${b:-0} → ${a:-0}  (Δ $(( ${a:-0} - ${b:-0} )))"
done

echo
echo "=== 判定（单位已由 43_mem_cmd_calibration.sh 标定）==="
A_BYTES=$(grep "maximum resident set size" "$TIMELL" | awk '{print $1}')
A_MB=$(( A_BYTES / 1024 / 1024 ))
PS_MB=$(( MAX_PS / 1024 ))
echo "  通道 A /usr/bin/time -l  maximum RSS  = ${A_MB} MB（内核 rusage 峰值，字节换算）"
echo "  通道 B ps  -o rss        瞬时峰值     = ${PS_MB} MB"
echo "  通道 B top rsize         瞬时峰值     = ${MAX_TOP} MB"
echo "  通道 B footprint         瞬时峰值     = ${MAX_FP} MB（含压缩页）"
echo "  → A 与 B(ps) 差 = $(( A_MB > PS_MB ? A_MB - PS_MB : PS_MB - A_MB )) MB；"
echo "    A 与 footprint 差 = $(( A_MB > MAX_FP ? A_MB - MAX_FP : MAX_FP - A_MB )) MB"
echo "  ⚠ 这三个数**不一定相等**，差多少、往哪边差，正是「这条命令准不准」的证据："
echo "     · RSS（ps/time）**不含**被压缩与被换出的页 → 内存压力大时系统性偏小；"
echo "     · phys_footprint（footprint/vmmap）**含**压缩页 → 更接近「这块进程真实占了多少」。"
echo "  落盘：$OUTDIR/${STAMP}_*"
