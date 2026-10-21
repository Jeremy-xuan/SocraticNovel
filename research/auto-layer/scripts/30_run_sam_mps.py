#!/usr/bin/env python3
"""30_run_sam_mps.py —— 用本机 Apple GPU 跑 See-through 的「语义部件分割」模型

这是 See-through 三步管线里的**第三步**（`further_extr` 用的语义层），
也是**唯一不需要 10 GB SDXL 扩散**的一步：
  SemanticSam(class_num=19)，权重 1.29 GB（`24yearsold/l2d_sam_iter2`），
  输出 19 个语义部件的掩码（头发/脸/眼/嘴/衣服…）。

为什么先测它：
  ① 体积最小、最可能跑得动 → 能最快给出"本地 GPU 行不行"的确定答案；
  ② 它是**分层**这件事的语义核心（扩散那步解决的是"被遮挡处补全"）。

上游代码把它写死成 `.to(device='cuda')`（notebook 与 infer_sam.py 都是），
但模型本体（`modules/semanticsam.py` + `modules/sam/`）**零 device 硬编码**，
device 由 `next(self.parameters()).device` 推导 → 理论上换 device 即可。

用法：
  PY=/path/to/python
  $PY scripts/30_run_sam_mps.py --device mps --srcp vendor/see-through/common/assets/test_image1.png
  $PY scripts/30_run_sam_mps.py --device cpu --srcp ...   # 对照
"""
import argparse
import json
import os
import subprocess
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VENDOR = os.path.join(ROOT, "vendor", "see-through")
sys.path.insert(0, os.path.join(VENDOR, "common"))  # `from utils... / from modules... / from live2d...`


def rss_mb():
    """当前进程 RSS（MB）—— macOS 上 /usr/bin/time -l 的 maximum resident set size 更准，
    这里取实时值，峰值另用 resource.getrusage 取。"""
    import resource
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024), 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default="mps", choices=["mps", "cpu", "cuda"])
    ap.add_argument("--srcp", required=True)
    ap.add_argument("--outdir", default=os.path.join(ROOT, "out", "sam"))
    ap.add_argument("--tag", default=None)
    # 🔴 本地 .pt 路径：本机 huggingface_hub 的下载器会挂（实测），所以权重一律用 curl 预取，
    #    这里走 download_from_hf=False 从本地文件加载，完全绕开 hub 客户端。
    ap.add_argument("--ckpt", default=os.path.join(os.environ.get("AUTO_LAYER_SCRATCH", os.path.join(os.path.expanduser("~"), "dsh-scratch", "auto-layer")), "weights", "sam_bodyparsing_ckpt18000.pt"))
    args = ap.parse_args()

    import numpy as np
    import torch
    from PIL import Image

    tag = args.tag or f"sam_{args.device}"
    outdir = os.path.join(args.outdir, tag)
    os.makedirs(outdir, exist_ok=True)

    rec = {
        "script": "30_run_sam_mps.py",
        "device_requested": args.device,
        "srcp": os.path.abspath(args.srcp),
        "torch": torch.__version__,
        "started": time.strftime("%Y-%m-%d %H:%M:%S"),
        "steps": {},
    }

    def step(name, fn):
        t0 = time.time()
        try:
            r = fn()
            rec["steps"][name] = {"ok": True, "seconds": round(time.time() - t0, 2)}
            print(f"  [OK  ] {name:34s} {time.time()-t0:7.2f}s")
            return r
        except Exception as e:  # noqa: BLE001
            rec["steps"][name] = {"ok": False, "seconds": round(time.time() - t0, 2),
                                  "error": f"{type(e).__name__}: {str(e)[:500]}",
                                  "traceback": traceback.format_exc()[-2000:]}
            print(f"  [FAIL] {name:34s} {time.time()-t0:7.2f}s\n         {type(e).__name__}: {str(e)[:300]}")
            return None

    if args.device == "mps" and not torch.backends.mps.is_available():
        rec["abort"] = "MPS 不可用"
        print("MPS 不可用，终止。")
        json.dump(rec, open(os.path.join(outdir, "result.json"), "w"), indent=2, ensure_ascii=False)
        return 2

    print(f"=== 设备 {args.device} | 输入 {args.srcp} ===")

    from utils.torch_utils import init_model_from_pretrained
    from modules.semanticsam import SemanticSam
    from live2d.scrap_model import VALID_BODY_PARTS_V2

    def _load():
        # 🔴 缺失就**响亮退出**，不退回 hub 下载：本机实测 `huggingface_hub` 的下载器会挂
        #    （卡在 0 字节、进程还活着），退回去等于把"失败"变成"永远等下去"。
        #    SAM 权重不随本仓库分发，须自行取好后用 --ckpt 指过来。
        if not os.path.exists(args.ckpt):
            raise SystemExit(
                f"[FAIL] 本地权重不存在：{args.ckpt}\n"
                f"       SemanticSam 权重（`24yearsold/l2d_sam_iter2` 的 checkpoint-18000.pt，1.29 GB）\n"
                f"       **不随本仓库分发**；请自行取好后用 --ckpt 指向本地文件。\n"
                f"       这里**不退回 huggingface_hub 下载**：本机实测该客户端会卡住（见 60_mouth_gate.py 同款纪律）。")
        print(f"  从本地权重加载（绕开 hub 客户端）：{args.ckpt}")
        m = init_model_from_pretrained(
            pretrained_model_name_or_path=args.ckpt,
            weights_name=None,
            module_cls=SemanticSam,
            download_from_hf=False,
            device=args.device,          # ← 上游此处写死 'cuda'，这里参数化
            model_args=dict(class_num=19),
        )
        m = m.to(device=args.device).eval()
        return m

    model = step("load_model", _load)
    if model is None:
        rec["verdict"] = "模型加载失败"
        json.dump(rec, open(os.path.join(outdir, "result.json"), "w"), indent=2, ensure_ascii=False)
        return 3

    rec["model_param_device"] = str(next(model.parameters()).device)
    rec["model_dtype"] = str(next(model.parameters()).dtype)
    rec["model_params_m"] = round(sum(p.numel() for p in model.parameters()) / 1e6, 2)
    print(f"  模型落在 {rec['model_param_device']} / {rec['model_dtype']} / {rec['model_params_m']} M 参数")
    rec["rss_after_load_mb"] = rss_mb()

    img = step("load_image", lambda: np.array(Image.open(args.srcp).convert("RGB")))
    if img is None:
        return 3
    rec["image_shape"] = list(img.shape)
    Image.fromarray(img).save(os.path.join(outdir, "input.png"))

    def _infer():
        with torch.inference_mode():
            preds = model.inference(img)[0]
            out = (preds > 0).to(device="cpu", dtype=torch.bool).numpy()
            if args.device == "mps":
                torch.mps.synchronize()
            return out

    masks = step("inference", _infer)
    if masks is None:
        rec["verdict"] = "推理失败"
        json.dump(rec, open(os.path.join(outdir, "result.json"), "w"), indent=2, ensure_ascii=False)
        return 4

    rec["masks_shape"] = list(masks.shape)
    rec["nonzero_classes"] = sorted(int(i) for i in np.unique(np.nonzero(masks)[0]))
    rec["per_class_pixels"] = {str(i): int((masks[i] > 0).sum()) for i in range(masks.shape[0])}
    rec["rss_peak_mb"] = rss_mb()
    if args.device == "mps":
        rec["mps_current_allocated_mb"] = round(torch.mps.current_allocated_memory() / 1e6, 1)
        rec["mps_driver_allocated_mb"] = round(torch.mps.driver_allocated_memory() / 1e6, 1)

    # 逐类导出掩码 PNG（这就是"层"的原料）
    def _dump():
        d = os.path.join(outdir, "masks")
        os.makedirs(d, exist_ok=True)
        n = 0
        for i in range(masks.shape[0]):
            m = masks[i] > 0
            if m.sum() == 0:
                continue
            name = VALID_BODY_PARTS_V2[i] if i < len(VALID_BODY_PARTS_V2) else f"class{i}"
            name = str(name).replace("/", "_").replace(" ", "_")
            rgba = np.zeros((*m.shape, 4), dtype=np.uint8)
            rgba[..., :3] = img
            rgba[..., 3] = np.where(m, 255, 0).astype(np.uint8)
            Image.fromarray(rgba).save(os.path.join(d, f"{i:02d}_{name}.png"))
            n += 1
        return n

    n = step("dump_masks", _dump)
    rec["mask_files"] = n

    # 带标签的可视化（上游自带函数）
    def _vis():
        from utils.visualize import visualize_segs_with_labels
        v = visualize_segs_with_labels(masks, img, VALID_BODY_PARTS_V2)
        Image.fromarray(v).save(os.path.join(outdir, "segments_labeled.png"))
        return list(v.shape)

    step("visualize", _vis)

    rec["verdict"] = "跑通"
    rec["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
    json.dump(rec, open(os.path.join(outdir, "result.json"), "w"), indent=2, ensure_ascii=False)
    print(f"\n结论：{rec['verdict']} | 命中类别 {rec['nonzero_classes']} | RSS 峰值 {rec['rss_peak_mb']} MB")
    print(f"产出：{outdir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
