#!/usr/bin/env python3
"""36_occlusion_selfcheck_probe.py —— 「补全区判据自检」的**可复现**证据

`33_make_layers.py` 的 `check_occlusion_direction()` 有一条硬要求：
**判据不成立时必须响亮报错，不许静默降级**。

本脚本把这条自检**单独跑一遍**（不加载任何模型、不产层），证明它真的会响：

  ① 正常输入 → 静默通过；
  ② 某部件在序表里查不到序（实测踩过：双侧拆分后的 `handwear_l` 没剥后缀）→ 抛 SystemExit(6)；
  ③ `--hole-mode all` 配**修后的表**（非法组合）→ 抛 SystemExit(6)；
  ④ 序表里所有值相同（`above` 分不出遮挡物）→ 抛 SystemExit(6)。

用法：
  PY="${AUTO_LAYER_PY:-${AUTO_LAYER_SCRATCH:-$HOME/dsh-scratch/auto-layer}/venv/bin/python}"
  $PY scripts/36_occlusion_selfcheck_probe.py
"""
import importlib.util
import io
import os
import sys
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def load_make_layers():
    """把 33_make_layers.py 作为模块加载（只为拿它的 check_occlusion_direction）。"""
    spec = importlib.util.spec_from_file_location(
        "make_layers", os.path.join(HERE, "33_make_layers.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def main():
    m = load_make_layers()
    cases = [
        ("① 正常：三个部件、序各不相同、判据 above", [
            ("hair_back", None, 6), ("face", None, 24), ("mouth", None, 70)],
         "above", "fixed"),
        ("② 某部件查不到序（handwear_l 没剥后缀那次的形状）", [
            ("hair_back", None, 6), ("handwear_l", None, None)],
         "above", "fixed"),
        ("③ 非法组合：--hole-mode all 配修后的表", [
            ("hair_back", None, 6), ("face", None, 24)],
         "all", "fixed"),
        ("④ 序表里所有值相同（above 分不出遮挡物）", [
            ("a", None, 7), ("b", None, 7)],
         "above", "fixed"),
    ]
    rec, rec_declared = [], []
    for name, units, direction, order_mode in cases:
        buf = io.StringIO()
        try:
            with redirect_stdout(buf):
                m.check_occlusion_direction(units, direction, order_mode)
            outcome, code, msg = "静默通过", 0, ""
        except SystemExit as e:
            # 🔴 记一个实现细节：`raise SystemExit("文本")` 时 `e.code` **就是那段文本**，
            #    解释器把它打到 stderr 并以**退出码 1** 结束；所以"脚本自己声明的 6"
            #    与"进程真正的退出码 1"是两件事，这里两个都如实记下来。
            code = e.code if isinstance(e.code, int) else 1
            declared = 6 if not isinstance(e.code, int) else e.code
            outcome, msg = "响亮报错", str(e)
            rec_declared.append(declared)
        rec.append({"case": name, "outcome": outcome, "process_exit_code": code,
                    "script_declared_code": (rec_declared[-1] if code else 0), "message": msg})
        print(f"{name}")
        print(f"   → {outcome}" + (f"（进程退出码 {code}；脚本里声明的值是 6）" if code else ""))
        if msg:
            for line in msg.splitlines():
                print(f"     {line}")
        print()
    ok = (rec[0]["outcome"] == "静默通过"
          and all(r["outcome"] == "响亮报错" and r["script_declared_code"] == 6
                  for r in rec[1:]))
    print(f"自检结论：{'✅ 四条全符合预期' if ok else '🔴 有不符合预期的情形'}")
    import json
    # 🔴 本脚本是**唯一不依赖任何第三方资产就能跑**的那一个（不加载模型、不读 vendor），
    #    所以输出目录必须自己建：否则在干净检出上第一次跑就 FileNotFoundError，
    #    而那是"目录没建"，不是"自检不通过"。
    outdir = os.path.join(ROOT, "out", "probe")
    os.makedirs(outdir, exist_ok=True)
    json.dump(rec, open(os.path.join(outdir, "36_occlusion_selfcheck.json"), "w"),
              indent=2, ensure_ascii=False)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
