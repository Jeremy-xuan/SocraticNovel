#!/bin/bash
# memwatch.sh —— 进程级 + 系统级内存采样器（macOS）
#
# 为什么需要它（本任务的方法学纪律）：
#   `ps aux` 报的 RSS **不含被压缩/换出的页**。上一路实测里，进程真实占 20–23 GB 时
#   `ps` 只报 47 MB（几乎全被换出），差点据此误判"没在干活"。
#   → 所以本采样器**不用 ps**，改用两条能反映真实占用的通道：
#     ① `top -pid <PID> -stats mem,rsize` —— MEM 列＝进程 phys_footprint（含被压缩页的记账）
#     ② `vm_stat` + `sysctl vm.swapusage` —— 系统级压缩器占用与 swap 使用
#   与 `/usr/bin/time -l`（给出 maximum resident set size ＋ peak memory footprint）交叉验证。
#
# 用法: memwatch.sh <PID> <间隔秒> <最长秒数> <输出csv>
set -u

PID="${1:?need pid}"
INT="${2:-2}"
DUR="${3:-7200}"
OUT="${4:?need out csv}"

echo "elapsed_s,swap_total_mb,swap_used_mb,swap_free_mb,compressor_mb,free_mb,wired_mb,proc_mem_mb,proc_rsize,swapins,swapouts" > "$OUT"

START=$(date +%s)
while :; do
  NOW=$(date +%s)
  EL=$((NOW - START))
  [ "$EL" -gt "$DUR" ] && break
  kill -0 "$PID" 2>/dev/null || break

  SW=$(sysctl -n vm.swapusage 2>/dev/null)
  ST=$(echo "$SW" | sed -n 's/.*total = \([0-9.]*\)M.*/\1/p')
  SU=$(echo "$SW" | sed -n 's/.*used = \([0-9.]*\)M.*/\1/p')
  SF=$(echo "$SW" | sed -n 's/.*free = \([0-9.]*\)M.*/\1/p')

  VM=$(vm_stat 2>/dev/null)
  PS=$(sysctl -n hw.pagesize 2>/dev/null || echo 16384)
  COMP=$(echo "$VM" | sed -n 's/^Pages occupied by compressor: *\([0-9]*\)\..*/\1/p')
  FREE=$(echo "$VM" | sed -n 's/^Pages free: *\([0-9]*\)\..*/\1/p')
  WIRED=$(echo "$VM" | sed -n 's/^Pages wired down: *\([0-9]*\)\..*/\1/p')
  SIN=$(echo "$VM" | sed -n 's/^Swapins: *\([0-9]*\)\..*/\1/p')
  SOUT=$(echo "$VM" | sed -n 's/^Swapouts: *\([0-9]*\)\..*/\1/p')

  TOPLINE=$(top -l 1 -pid "$PID" -stats pid,mem,rsize 2>/dev/null | tail -1)
  # top 的 MEM/RSIZE 带 K/M/G 后缀（如 "2056M"），归一到 MB，便于后续统计
  norm() { echo "${1:-}" | awk '{v=$0; if(v=="") {print ""; exit} u=substr(v,length(v),1);
            n=substr(v,1,length(v)-1);
            if(u=="G") print n*1024; else if(u=="M") print n; else if(u=="K") print n/1024;
            else print n}'; }
  PMEM=$(norm "$(echo "$TOPLINE" | awk '{print $2}')")
  PRSS=$(norm "$(echo "$TOPLINE" | awk '{print $3}')")

  mb() { [ -n "${1:-}" ] && echo "scale=1; $1*$PS/1048576" | bc || echo ""; }
  awk -F, -v OFS=, -v e="$EL" -v st="$ST" -v su="$SU" -v sf="$SF" \
      -v c="$(mb "$COMP")" -v f="$(mb "$FREE")" -v w="$(mb "$WIRED")" \
      -v pm="${PMEM:-}" -v pr="${PRSS:-}" -v si="${SIN:-}" -v so="${SOUT:-}" \
      'BEGIN{print e,st,su,sf,c,f,w,pm,pr,si,so}' >> "$OUT"

  sleep "$INT"
done

echo "# memwatch 结束：PID=$PID 采样 $(($(wc -l < "$OUT") - 1)) 次 -> $OUT"
