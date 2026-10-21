#!/usr/bin/env bash
# 63_mem_two_channel.sh —— 内存测量的「两条独立通道 + 单位实测标定」
#
# 上一路立下的规矩（MOUTH-FIX 任务 ④ 要求照守）：
#   ① 凡结论涉及内存，**必须写清用哪个命令**，且**至少两条独立通道**；
#   ② **三个口径不许混写**：
#        RSS（ps -o rss / getrusage.ru_maxrss）＝ 常驻物理页，**不含被压缩/换出的页**
#        phys_footprint（footprint）＝ **含被压缩页** ← macOS `top` 的 MEM/rsize 列量的就是这个，不是 RSS
#   ③ **单位必须实测标定**（不要照抄别人的换算）：先分配一个**已知大小**并逐页触碰，再读各通道。
#   ④ 🔴 **不许用 `pgrep -f 脚本名` 取 pid** —— `/usr/bin/time -l <py> 脚本.py` 的命令行里也含脚本名，
#      会先匹配到包装进程（曾据此得出"只有 1 MB"的荒谬结论）。
#      本脚本用 `$!` 直接拿**被测进程自己**的 pid（不经任何包装进程）。
#
# 用法：bash scripts/63_mem_two_channel.sh [workload]
#   workload = 33_ourasset | 33_test1 | calib_only（默认 33_test1）
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"

# 🔴 解释器走**环境变量契约**（venv 不在本仓库里，它要装 torch/PIL 等依赖）：
#    AUTO_LAYER_PY 优先；否则由 AUTO_LAYER_SCRATCH（缺省 $HOME/dsh-scratch/auto-layer）派生 venv 路径。
#    PATH 上的命令经 command -v 解析成可执行文件的绝对路径；缺失就响亮退出，不退回系统 python
#    —— 系统 python 里没有 torch 的话，被测工作负载会立刻失败，而"内存结论"会变成对一堆错误信息的解读。
resolve_exe() {
  local p
  if p="$(command -v "$1" 2>/dev/null)" && [ -n "$p" ]; then
    printf '%s' "$p"; return 0
  fi
  if [ -x "$1" ]; then printf '%s' "$1"; return 0; fi
  return 1
}
PY="${AUTO_LAYER_PY:-${AUTO_LAYER_SCRATCH:-$HOME/dsh-scratch/auto-layer}/venv/bin/python}"
if ! PY="$(resolve_exe "$PY")"; then
  echo "[FAIL] 解释器不可执行：$PY" >&2
  echo "       本脚本需要装了 torch / numpy / PIL / opencv 的 venv（不在本仓库内）。" >&2
  echo "       用环境变量指定：AUTO_LAYER_PY=<venv>/bin/python bash scripts/63_mem_two_channel.sh" >&2
  exit 2
fi
WORKLOAD="${1:-33_test1}"
OUT="$ROOT/out/probe/mem_two_channel_${WORKLOAD}.txt"
mkdir -p "$ROOT/out/probe"

rss_kb()   { ps -o rss= -p "$1" 2>/dev/null | tr -d ' '; }          # 通道 A：RSS，单位 KB（实测标定见下）
# 通道 B：phys_footprint，**字节**。
#   取法实测过两种：`footprint -p <pid>` 的头部只给"Footprint: 808 MB"（已四舍五入），
#   而 `-f bytes --noCategories` 的 Auxiliary data 里逐字给 `phys_footprint: 846776704 B` → 用后者。
foot_mb()  { footprint -p "$1" -f bytes --noCategories 2>/dev/null \
             | awk '/phys_footprint:/ {printf "%.0f", $2/1048576; exit}'; }
# 通道 C（交叉验证 top 的 MEM/rsize 到底是什么）：实测与 phys_footprint 同值
top_mb()   { top -l 1 -pid "$1" -stats rsize 2>/dev/null | tail -1 | tr -d ' M'; }

{
echo "############ 内存两条通道 ############"
echo "主机：$(sw_vers -productVersion)  $(uname -m)"
echo "脚本：$(basename "$0")   工作负载：$WORKLOAD"
echo "通道 A 命令：ps -o rss= -p <pid>           （RSS，不含被压缩页）"
echo "通道 B 命令：footprint -p <pid> -f bytes --noCategories 里的 phys_footprint（含被压缩页）"
echo "通道 C 命令：top -l 1 -pid <pid> -stats rsize（用于交叉验证「top 的 MEM 列是不是 RSS」）"
echo "取 pid 方式：\$! 直接拿被测进程 —— 不用 pgrep -f 脚本名（会匹配到包装进程）"
echo

echo "=========== ① 单位标定：分配已知 800 MB 并逐页触碰 ==========="
"$PY" - <<'PY' &
import os, sys, time
N = 800 * 1024 * 1024
buf = bytearray(N)
for i in range(0, N, 4096):     # 逐页触碰 → 保证真落物理页
    buf[i] = 1
print(f"[calib] 已分配并触碰 {N/1048576:.0f} MB，pid={os.getpid()}", flush=True)
time.sleep(8)
PY
CALIB=$!
sleep 3
echo "  标定进程 pid=$CALIB（= \$!，不是 pgrep 猜的）"
echo "  通道 A  ps -o rss=            : $(rss_kb "$CALIB") KB  →  $(awk -v k="$(rss_kb "$CALIB")" 'BEGIN{printf "%.0f", k/1024}') MB"
echo "  通道 B  footprint phys_footprint: $(foot_mb "$CALIB") MB"
wait "$CALIB" 2>/dev/null
echo "  判据：两通道都应 ≈ 800 MB ⇒ 单位分别是「KB」与「MB」；差 1000 倍会在这里露出来"
echo

if [ "$WORKLOAD" != "calib_only" ]; then
  case "$WORKLOAD" in
    33_ourasset) ARGS="--samdir out/sam/sam_mps_ourasset --tag memprobe_ourasset" ;;
    33_test1)    ARGS="--samdir out/sam/sam_mps_test1 --tag memprobe_test1" ;;
    *) echo "未知工作负载 $WORKLOAD"; exit 2 ;;
  esac
  echo "=========== ② 真实工作负载：33_make_layers.py（$WORKLOAD） ==========="
  echo "  命令：$PY scripts/33_make_layers.py --device mps $ARGS"
  cd "$ROOT" || exit 2
  "$PY" scripts/33_make_layers.py --device mps $ARGS > "out/probe/mem_${WORKLOAD}_stdout.log" 2>&1 &
  PID=$!
  echo "  被测进程 pid=$PID（\$!）"
  PEAK_RSS=0; PEAK_FOOT=0; N=0
  while kill -0 "$PID" 2>/dev/null; do
    R=$(rss_kb "$PID"); F=$(foot_mb "$PID")
    [ -n "${R:-}" ] && [ "$R" -gt "$PEAK_RSS" ] 2>/dev/null && PEAK_RSS=$R
    [ -n "${F:-}" ] && [ "$F" -gt "$PEAK_FOOT" ] 2>/dev/null && PEAK_FOOT=$F
    N=$((N+1)); sleep 2
  done
  wait "$PID"; RC=$?
  echo "  采样 $N 次（每 2 s）  工作负载退出码=$RC"
  echo "  通道 A 峰值 RSS（ps -o rss=）           : $PEAK_RSS KB → $(awk -v k="$PEAK_RSS" 'BEGIN{printf "%.0f", k/1024}') MB"
  echo "  通道 B 峰值 phys_footprint（footprint） : $PEAK_FOOT MB"
  echo "  脚本自报（getrusage ru_maxrss，也是 RSS）: $(grep -o 'RSS 峰值 [0-9.]* MB' "out/probe/mem_${WORKLOAD}_stdout.log" | tail -1)"
  echo "  ⇒ 两个口径之比 = $(awk -v a="$PEAK_RSS" -v b="$PEAK_FOOT" 'BEGIN{ if(b>0) printf "%.2f", (a/1024)/b; else print "n/a"}')（phys_footprint 含被压缩页，故更大）"
fi
echo
echo "############ 结论口径（照抄时请连命令一起抄）############"
echo "· 报 RSS   → 写 ps -o rss= / getrusage.ru_maxrss，并注明「不含被压缩页」"
echo "· 报真实占用 → 写 footprint 的 phys_footprint，并注明「含被压缩页」"
echo "· macOS top 的 MEM/rsize 列 = phys_footprint，不是 RSS"
} 2>&1 | tee "$OUT"
echo
echo "落盘：$OUT"
