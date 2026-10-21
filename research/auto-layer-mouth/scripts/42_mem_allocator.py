#!/usr/bin/env python3
"""42_mem_allocator.py —— 内存测量的**标定负载**：分配已知大小的一块内存并逐页触碰

任务代号 LAYER-MOUTH 步骤 ④ 的第二半。
为什么需要标定：上一节（41）里 `ps` 说 393 MB、`top` 说 5238、`/usr/bin/time -l` 说 606 MB，
三个数差到 13 倍 —— **在不知道每个命令的单位与口径之前，任何一个数都不能引用**。
本负载分配 `--mb` 兆字节并**逐页写一遍**（保证真落物理页，不是 lazy 分配），
于是"真实占用"是已知的，可以反推每个命令准不准。

用法：
  PY=... $PY scripts/42_mem_allocator.py --mb 800 --hold 8
"""
import argparse
import ctypes
import os
import sys
import time


def rss_kb():
    import resource
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)   # macOS: ru_maxrss 单位是字节


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mb", type=int, default=800)
    ap.add_argument("--hold", type=float, default=8.0)
    args = ap.parse_args()

    print(f"MARK pid={os.getpid()} target_mb={args.mb}", flush=True)
    n = args.mb * 1024 * 1024
    buf = bytearray(n)
    # 逐页触碰（每 4 KiB 写一次），确保物理页真的被占用
    for i in range(0, n, 4096):
        buf[i] = 1
    print(f"MARK allocated rss_kb={rss_kb()}", flush=True)

    t0 = time.time()
    while time.time() - t0 < args.hold:
        time.sleep(0.2)
    print(f"MARK done rss_kb={rss_kb()} target_mb={args.mb}", flush=True)
    del buf
    return 0


if __name__ == "__main__":
    sys.exit(main())
