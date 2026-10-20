#!/usr/bin/env python3
"""40_mem_probe_workload.py —— 内存测量的**被测负载**（真跑 SAM 语义分割，MPS）

任务代号 LAYER-MOUTH 步骤 ④。
它只做一件事：把 auto-layer 已经跑通的那段 SAM 推理原样再跑一次，并在过程中
把「峰值保持住」（可选 --hold 秒），好让外部采样器能采到峰值。

🔴 只读复用 auto-layer 的 vendor 代码与已下权重，不改它。
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
MOUTH_ROOT = os.path.dirname(HERE)
AUTO = os.path.join(os.path.dirname(MOUTH_ROOT), "auto-layer")
sys.path.insert(0, os.path.join(AUTO, "vendor", "see-through", "common"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default="mps", choices=["mps", "cpu"])
    ap.add_argument("--srcp", default=os.path.join(AUTO, "vendor", "see-through", "common",
                                                   "assets", "test_image1.png"))
    ap.add_argument("--ckpt", default="/Users/wujunjie/dsh-scratch/auto-layer/weights/"
                                      "sam_bodyparsing_ckpt18000.pt")
    ap.add_argument("--hold", type=float, default=6.0, help="推理完成后把进程挂住多少秒（供采样）")
    ap.add_argument("--tag", default="mem_probe")
    args = ap.parse_args()

    import numpy as np
    import torch
    from PIL import Image

    rec = {"script": "40_mem_probe_workload.py", "pid": os.getpid(), "device": args.device,
           "started": time.strftime("%Y-%m-%d %H:%M:%S")}
    print(f"MARK pid={os.getpid()}", flush=True)

    from utils.torch_utils import init_model_from_pretrained
    from modules.semanticsam import SemanticSam
    t0 = time.time()
    m = init_model_from_pretrained(pretrained_model_name_or_path=args.ckpt, weights_name=None,
                                   module_cls=SemanticSam, download_from_hf=False,
                                   device=args.device, model_args=dict(class_num=19))
    m = m.to(device=args.device).eval()
    rec["load_s"] = round(time.time() - t0, 2)
    img = np.array(Image.open(args.srcp).convert("RGB"))
    t0 = time.time()
    with torch.inference_mode():
        preds = m.inference(img)[0]
        out = (preds > 0).to(device="cpu", dtype=torch.bool).numpy()
        if args.device == "mps":
            torch.mps.synchronize()
    rec["inference_s"] = round(time.time() - t0, 2)
    rec["nonzero_classes"] = sorted(int(i) for i in np.unique(np.nonzero(out)[0]))
    rec["mouth_px"] = int((out[8] > 0).sum())
    print(f"MARK inference_done mouth_px={rec['mouth_px']}", flush=True)

    # 峰值保持段：让外部采样器有机会采到稳态内存
    t0 = time.time()
    while time.time() - t0 < args.hold:
        time.sleep(0.2)
    rec["hold_s"] = args.hold
    rec["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
    os.makedirs(os.path.join(MOUTH_ROOT, "out"), exist_ok=True)
    json.dump(rec, open(os.path.join(MOUTH_ROOT, "out", f"{args.tag}_workload.json"), "w"),
              indent=2, ensure_ascii=False)
    print(json.dumps(rec, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
