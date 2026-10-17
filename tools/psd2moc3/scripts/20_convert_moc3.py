#!/usr/bin/env python3
"""20_convert_moc3.py —— 用 image2live2d 把「分层 PNG」转成**真 `.moc3`**

关键事实（读源码得来，不是猜的）：
  image2live2d 的 **CLI 不产 `.moc3`**。`__main__.py` 的 `--live2d` 只写 4 个开放 JSON
  （model3/physics3/motion3/cdi3）；`.moc3` 由 `Live2DEmitter` 的 `moc_writer` 这个**注入口**决定，
  不注入时 `moc3.py:write_moc3_from_template()` 直接 `raise NotImplementedError`，
  `emitter.py:91` 的 `except NotImplementedError: pass` 把它**静默吞掉**，于是产出"JSON-only bundle"。

  要拿到 `.moc3` 必须绕开 CLI，直接注入 `moc3_emit.native_moc_writer`
  （`moc3_emit.py:768`，docstring 逐字 "generates a `.moc3` from the IRR **from scratch** — no
  Cubism template needed"）。

依赖：
  - pydantic（image2live2d 的唯一核心依赖，`irr/schema.py:21`）
    🔴 本机 pip 走不通（Clash TUN 下 SSL 证书校验失败）→ **不装**，改为
       `PYTHONPATH=<本机已有 3.13 的 pydantic site-packages>` 复用（见 run_all.sh 里的注释）。
  - numpy / Pillow：工作区已有 venv 里就有。
  - triangle / cv2：源码里**没有 import**（已 grep 确认），不需要。

输出：`out/i2l/` —— image2live2d 的 Live2D bundle（含 `.moc3`）
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOL = HERE.parent
LAYERS = TOOL / "out" / "layers_i2l"
OUT = TOOL / "out" / "i2l"
NAME = "p2l2char"

# 🔴 image2live2d 的源码树是**第三方**（Apache-2.0），不随本仓库分发。
#    须先跑 `scripts/00_fetch_prior_art.sh <目录>` 下载并解包；
#    其默认输出目录即下方默认值，也可用环境变量 I2L_SRC 覆盖。
I2L_SRC = Path(os.environ.get("I2L_SRC", "/tmp/p2l2/src/image2live2d-main/src"))


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> int:
    if not I2L_SRC.is_dir():
        print(f"[FAIL] 找不到 image2live2d 源码：{I2L_SRC}\n"
              f"       先跑 scripts/00_fetch_prior_art.sh 下载解包。", file=sys.stderr)
        return 2
    if not LAYERS.is_dir():
        print(f"[FAIL] 找不到图层目录：{LAYERS}\n       先跑 scripts/10_prepare_layers.py。", file=sys.stderr)
        return 2

    sys.path.insert(0, str(I2L_SRC))

    from image2live2d.backends.live2d import Live2DEmitter
    from image2live2d.backends.live2d.moc3_emit import native_moc_writer
    from image2live2d.core import decompose
    from image2live2d.core.qa import evaluate
    from image2live2d.pipeline import rig_from_stack

    print(f"[1/4] 读图层：{LAYERS}")
    stack = decompose.from_layer_dir(LAYERS)
    print(f"      画布 {stack.canvas_width}x{stack.canvas_height}，{len(stack.layers)} 层")
    for l in stack.layers:
        print(f"      - id={l.id:20s} role={l.semantic_role.value:12s} order={l.draw_order}")

    print("[2/4] 跑 rig 管线（mesh → rig authoring → physics → motion）")
    rig = rig_from_stack(stack, name=NAME, source=str(LAYERS))
    print(f"      parts={len(rig.parts)} textures={len(rig.textures)} "
          f"parameters={len(rig.parameters)} physics={len(rig.physics)} animations={len(rig.animations)}")

    print("[3/4] 导出（注入 native_moc_writer → 真的写 .moc3）")
    if OUT.exists():
        import shutil
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    bundle = Live2DEmitter(asset_root=LAYERS, moc_writer=native_moc_writer).build(rig, OUT)
    print(f"      model3 = {bundle.model3_path}")
    print(f"      moc_written = {bundle.moc_written}")
    print(f"      文件：{bundle.files}")

    print("[4/4] QA")
    qa = evaluate(rig, NAME)
    print(f"      passed = {qa.passed}")

    moc = OUT / f"{NAME}.moc3"
    rows = []
    for f in sorted(OUT.rglob("*")):
        if f.is_file():
            rows.append({"rel": str(f.relative_to(OUT)), "bytes": f.stat().st_size,
                         "sha256": sha256(f)})
    (TOOL / "out" / "i2l_manifest.json").write_text(json.dumps(
        {"name": NAME, "layers_dir": str(LAYERS), "moc_written": bundle.moc_written,
         "qa_passed": qa.passed, "files": rows}, ensure_ascii=False, indent=2))

    if not moc.is_file():
        print("[FAIL] 没产出 .moc3 —— moc_written=False", file=sys.stderr)
        return 1

    head = moc.read_bytes()[:8]
    print(f"\n[ok] .moc3 = {moc}  {moc.stat().st_size} B")
    print(f"     文件头前 8 字节 = {' '.join(f'{b:02X}' for b in head)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
