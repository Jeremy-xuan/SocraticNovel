#!/usr/bin/env python3
"""20_patch_device.py —— 把 See-through 的「设备」从写死的 'cuda' 参数化

🔴 为什么需要这一步（实测取证，不是猜）：
  上游 `common/utils/inference_utils.py` 把设备**写死成字符串 'cuda'**——
    · 第 65–69 行：`layerdiff_pipeline.{vae,trans_vae,unet,text_encoder,text_encoder_2}.to(dtype=bfloat16, device='cuda')`
    · 第 71 行 / 第 198 行：`enable_group_offload('cuda', ...)`
    · 第 195 行：`marigold_pipeline.to(device='cuda', dtype=bfloat16)`
  本机 `torch.cuda.is_available()` 为 **False**（Apple M3，无 CUDA）→ 这些 `.to(device='cuda')`
  必然抛错。**但模型本体（`modules/layerdiffuse`、`modules/marigold`、`modules/sam`）里
  已有 MPS 分支**（`layerdiff3d.py` 的 `is_mps` dtype 处理、`diffusers_kdiffusion_sdxl.py`
  的 MPS latents dtype 修补），且 `modules/sam/` **零 device 硬编码**、xformers 被强制关闭。
  → 所以「设备」这一层是**唯一**的硬阻塞点，参数化后即可上 MPS。

本脚本对**我方 vendor 副本**做精确字符串替换（幂等，可重复跑），并落一份 diff 供核对。
🔴 只改 `vendor/see-through/`（本任务自己的副本），**不碰任何别的树**。

用法： $PY scripts/20_patch_device.py [--check]
       --check  只报告当前是否已打补丁，不写盘
"""
import argparse
import difflib
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VENDOR = os.path.join(ROOT, "vendor", "see-through")
OUT = os.path.join(ROOT, "out", "patch")

DEVICE_HEADER = '''
# === [L2D-LAYER-GPU 补丁] 设备参数化：上游此处写死 'cuda'，本机无 CUDA（Apple M3） ===
# 解析顺序：环境变量 SEETHROUGH_DEVICE > cuda > mps > cpu
import os as _os_l2d
DEVICE = (_os_l2d.environ.get('SEETHROUGH_DEVICE')
          or ('cuda' if torch.cuda.is_available()
              else 'mps' if torch.backends.mps.is_available()
              else 'cpu'))
# === [/补丁] ===
'''

# ---- 文件 1：主管线设备 ----
F1 = os.path.join(VENDOR, "common", "utils", "inference_utils.py")
REPL1 = [
    ("layerdiff_pipeline.vae.to(dtype=torch.bfloat16, device='cuda')",
     "layerdiff_pipeline.vae.to(dtype=torch.bfloat16, device=DEVICE)", 1),
    ("layerdiff_pipeline.trans_vae.to(dtype=torch.bfloat16, device='cuda')",
     "layerdiff_pipeline.trans_vae.to(dtype=torch.bfloat16, device=DEVICE)", 1),
    ("layerdiff_pipeline.unet.to(dtype=torch.bfloat16, device='cuda')",
     "layerdiff_pipeline.unet.to(dtype=torch.bfloat16, device=DEVICE)", 1),
    ("layerdiff_pipeline.text_encoder.to(dtype=torch.bfloat16, device='cuda')",
     "layerdiff_pipeline.text_encoder.to(dtype=torch.bfloat16, device=DEVICE)", 1),
    ("layerdiff_pipeline.text_encoder_2.to(dtype=torch.bfloat16, device='cuda')",
     "layerdiff_pipeline.text_encoder_2.to(dtype=torch.bfloat16, device=DEVICE)", 1),
    ("layerdiff_pipeline.enable_group_offload('cuda', num_blocks_per_group=1)",
     "layerdiff_pipeline.enable_group_offload(DEVICE, num_blocks_per_group=1)", 1),
    ("marigold_pipeline.to(device='cuda', dtype=torch.bfloat16)",
     "marigold_pipeline.to(device=DEVICE, dtype=torch.bfloat16)", 1),
    ("marigold_pipeline.enable_group_offload('cuda', num_blocks_per_group=1)",
     "marigold_pipeline.enable_group_offload(DEVICE, num_blocks_per_group=1)", 1),
]

# ---- 文件 2：LaMa 修补器（🔴 上游 bug：device 参数被丢掉）----
# `apply_inpaint(img, mask, device=...)` 把 device 传给了模型 forward，
# 但调用 `inpaint_preprocess(img, mask)` 时**没往下传** → 该函数用自己的默认值 `device='cuda'`
# → 第 495 行 `img_torch.to('cuda')` → `AssertionError: Torch not compiled with CUDA enabled`。
# 即：**这个 API 在非 CUDA 机器上永远跑不通**，不是"不支持"，是"参数没接上"。
F2 = os.path.join(VENDOR, "annotators", "lama_inpainter", "__init__.py")
REPL2 = [
    ("img_torch, mask_torch, rel_pos, direct, img_original, mask_original, pad_bottom, pad_right = inpaint_preprocess(img, mask)",
     "img_torch, mask_torch, rel_pos, direct, img_original, mask_original, pad_bottom, pad_right = inpaint_preprocess(img, mask, device=device)",
     1),
]

FILES = [(F1, REPL1, True), (F2, REPL2, False)]



def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if args.check:
        for path, _, _ in FILES:
            src = open(path).read() if os.path.exists(path) else ""
            print(f"  {'已打' if 'L2D-LAYER-GPU 补丁' in src or 'inpaint_size=inpaint_size, device=device' in src else '未打'}  {path}")
        return 0

    os.makedirs(OUT, exist_ok=True)
    total = 0
    for path, repl, add_header in FILES:
        if not os.path.exists(path):
            print(f"FATAL: 找不到 {path}")
            return 2
        src = open(path).read()
        # 幂等判据：所有"旧串"都已不存在 → 视为已打补丁（不依赖注释头，因为文件 2 不加头）
        if all(old not in src for old, _, _ in repl):
            print(f"已打过补丁，跳过（幂等）：{path}")
            continue

        new = src
        problems = []
        for old, rep, want in repl:
            got = new.count(old)
            if got != want:
                problems.append(f"  期望 {want} 处、实际 {got} 处：{old[:80]}")
                continue
            new = new.replace(old, rep)
        if problems:
            print(f"FATAL: 替换点与预期不符，未写盘（上游可能已改动）：{path}")
            print("\n".join(problems))
            return 3

        if add_header:
            m = re.search(r"^import torch\s*$", new, re.M)
            if not m:
                print(f"FATAL: {path} 里找不到 'import torch'，无法插入 DEVICE 定义")
                return 4
            new = new[:m.end()] + "\n" + DEVICE_HEADER + new[m.end():]

        name = os.path.basename(path)
        with open(os.path.join(OUT, f"{name}.diff"), "w") as f:
            f.writelines(difflib.unified_diff(
                src.splitlines(True), new.splitlines(True),
                fromfile=f"a/{name}", tofile=f"b/{name}"))
        with open(path, "w") as f:
            f.write(new)
        total += len(repl)
        print(f"补丁已应用（{len(repl)} 处）-> {path}")

    print(f"\ndiff 目录 -> {OUT}\n合计替换 {total} 处")
    return 0


if __name__ == "__main__":
    sys.exit(main())
