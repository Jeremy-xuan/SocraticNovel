#!/usr/bin/env python3
"""00_env_probe.py —— 本机 Apple GPU 能力实测（证据件）

回答三个问题，全部用**真跑一次算子**取证，不看文档、不看 torch.backends 的布尔值：
  ① MPS 到底能不能执行运算（不是"报告 available"就完事）；
  ② MPS 支持哪些 dtype / 算子（SDXL 类扩散模型需要的那批）；
  ③ 显存预算上限是多少（`torch.mps.recommended_max_memory()`）。

输出： out/probe/env_probe.json
用法： PY=/path/to/python $PY scripts/00_env_probe.py
"""
import json
import os
import platform
import subprocess
import sys
import time

import torch

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "out", "probe")
os.makedirs(OUT, exist_ok=True)

rec = {
    "python": sys.version.split()[0],
    "platform": platform.platform(),
    "machine": platform.machine(),
    "torch": torch.__version__,
    "mps_built": torch.backends.mps.is_built(),
    "mps_available": torch.backends.mps.is_available(),
    "cuda_available": torch.cuda.is_available(),
    "results": {},
    "memory": {},
}


def try_op(name, fn):
    """真跑一次；记录 OK/FAIL + 耗时 + 结果形状。绝不静默吞异常。"""
    t0 = time.time()
    try:
        r = fn()
        rec["results"][name] = {"ok": True, "seconds": round(time.time() - t0, 4),
                                "result": str(r)[:120]}
    except Exception as e:  # noqa: BLE001 —— 这里就是要抓住一切失败并如实记录
        rec["results"][name] = {"ok": False, "seconds": round(time.time() - t0, 4),
                                "error": f"{type(e).__name__}: {str(e)[:200]}"}
    flag = "OK  " if rec["results"][name]["ok"] else "FAIL"
    extra = rec["results"][name].get("error") or rec["results"][name]["result"]
    print(f"  [{flag}] {name:42s} {extra[:110]}")


def main():
    print(f"torch {torch.__version__}  mps_built={rec['mps_built']} "
          f"mps_available={rec['mps_available']} cuda={rec['cuda_available']}")
    if not rec["mps_available"]:
        print("MPS 不可用 —— 后续 MPS 结论一律不成立，只能走 CPU。")

    d = torch.device("mps")
    print("\n=== ① 基础算子 / dtype 覆盖 ===")
    try_op("matmul fp32", lambda: (torch.randn(512, 512, device=d)
                                   @ torch.randn(512, 512, device=d)).sum().item())
    try_op("matmul fp16", lambda: (torch.randn(512, 512, device=d, dtype=torch.float16)
                                   @ torch.randn(512, 512, device=d, dtype=torch.float16)).sum().item())
    try_op("matmul bfloat16", lambda: (torch.randn(512, 512, device=d, dtype=torch.bfloat16)
                                       @ torch.randn(512, 512, device=d, dtype=torch.bfloat16)).sum().item())
    try_op("matmul float64", lambda: (torch.randn(64, 64, device=d, dtype=torch.float64)
                                      @ torch.randn(64, 64, device=d, dtype=torch.float64)).sum().item())
    try_op("conv2d fp32", lambda: torch.nn.Conv2d(64, 64, 3, padding=1).to(d)(
        torch.randn(1, 64, 128, 128, device=d)).shape)
    try_op("conv2d bfloat16", lambda: torch.nn.Conv2d(64, 64, 3, padding=1).to(d, dtype=torch.bfloat16)(
        torch.randn(1, 64, 128, 128, device=d, dtype=torch.bfloat16)).shape)
    try_op("groupnorm bfloat16", lambda: torch.nn.GroupNorm(8, 64).to(d, dtype=torch.bfloat16)(
        torch.randn(1, 64, 32, 32, device=d, dtype=torch.bfloat16)).shape)
    try_op("layernorm bfloat16", lambda: torch.nn.LayerNorm(128).to(d, dtype=torch.bfloat16)(
        torch.randn(2, 16, 128, device=d, dtype=torch.bfloat16)).shape)
    try_op("silu bfloat16", lambda: torch.nn.functional.silu(
        torch.randn(1, 64, 32, 32, device=d, dtype=torch.bfloat16)).shape)
    try_op("scaled_dot_product_attention fp16", lambda: torch.nn.functional.scaled_dot_product_attention(
        torch.randn(1, 8, 256, 64, device=d, dtype=torch.float16),
        torch.randn(1, 8, 256, 64, device=d, dtype=torch.float16),
        torch.randn(1, 8, 256, 64, device=d, dtype=torch.float16)).shape)
    try_op("interpolate bilinear", lambda: torch.nn.functional.interpolate(
        torch.randn(1, 4, 64, 64, device=d), scale_factor=2, mode="bilinear").shape)
    try_op("grid_sample", lambda: torch.nn.functional.grid_sample(
        torch.randn(1, 4, 64, 64, device=d), torch.rand(1, 64, 64, 2, device=d) * 2 - 1).shape)
    try_op("einsum", lambda: torch.einsum("bchw,bdhw->bcd", torch.randn(1, 4, 8, 8, device=d),
                                          torch.randn(1, 4, 8, 8, device=d)).shape)
    try_op("upsample nearest", lambda: torch.nn.functional.interpolate(
        torch.randn(1, 4, 64, 64, device=d), scale_factor=2, mode="nearest").shape)

    print("\n=== ② 随机数发生器（扩散模型每步都要用）===")
    try_op("Generator(device='mps')", lambda: torch.Generator(device="mps").manual_seed(42).initial_seed())
    try_op("randn(mps, generator=mps)", lambda: torch.randn(
        4, device=d, generator=torch.Generator(device="mps").manual_seed(42)).tolist())
    try_op("randn(mps, generator=cpu)", lambda: torch.randn(
        4, device=d, generator=torch.Generator(device="cpu").manual_seed(42)).tolist())
    try_op("randn_like(mps)", lambda: torch.randn_like(torch.zeros(2, 2, device=d)).shape)

    print("\n=== ③ 显存预算 / 管理 API ===")
    for name, fn in [
        ("recommended_max_memory", lambda: round(torch.mps.recommended_max_memory() / 1e9, 3)),
        ("driver_allocated_memory", lambda: round(torch.mps.driver_allocated_memory() / 1e6, 2)),
        ("current_allocated_memory", lambda: round(torch.mps.current_allocated_memory() / 1e6, 2)),
        ("synchronize", lambda: (torch.mps.synchronize(), "ok")[1]),
        ("empty_cache", lambda: (torch.mps.empty_cache(), "ok")[1]),
        ("set_per_process_memory_fraction(0.9)", lambda: (torch.mps.set_per_process_memory_fraction(0.9), "ok")[1]),
    ]:
        try_op(name, fn)
    if rec["results"].get("recommended_max_memory", {}).get("ok"):
        rec["memory"]["recommended_max_memory_gb"] = float(
            rec["results"]["recommended_max_memory"]["result"])

    print("\n=== ④ 硬件事实（system_profiler）===")
    try:
        sp = subprocess.run(["system_profiler", "SPDisplaysDataType"],
                            capture_output=True, text=True, timeout=60).stdout
        rec["system_profiler_gpu"] = sp.strip()[:2000]
        for line in sp.splitlines():
            if "Chipset Model" in line or "Total Number of Cores" in line or "Metal Support" in line:
                print("  " + line.strip())
    except Exception as e:  # noqa: BLE001
        rec["system_profiler_gpu"] = f"FAILED: {e}"
        print("  system_profiler 失败:", e)

    p = os.path.join(OUT, "env_probe.json")
    with open(p, "w") as f:
        json.dump(rec, f, indent=2, ensure_ascii=False)
    ok = sum(1 for v in rec["results"].values() if v["ok"])
    print(f"\n结果：{ok}/{len(rec['results'])} 项算子 OK -> {p}")


if __name__ == "__main__":
    main()
