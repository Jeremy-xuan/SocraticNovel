#!/usr/bin/env python3
"""40_run_pipeline_mps.py —— 在 Apple GPU(MPS) 上跑 See-through 完整分层管线

管线（上游 `inference/scripts/inference_psd.py` 的三步）：
  ① apply_layerdiff  —— LayerDiff 3D（SDXL 底座，权重 10.16 GB）生成透明层
  ② apply_marigold   —— Marigold 深度（权重 3.28 GB）估伪深度
  ③ further_extr     —— 纯启发式后处理（眼/眉/耳/手左右拆分、头发前后拆分）→ 出 PSD
  ⚠️ 注意：**主管线不用 SAM**（SAM 那条是独立的 annotator 路径，见 30_run_sam_mps.py）。

🔴 前置：必须先跑 `20_patch_device.py`（把上游写死的 device='cuda' 参数化）。
🔴 权重走本地目录（`--w_layerdiff` / `--w_marigold`），不走 HF hub 客户端
   （本机实测 hub 下载器会挂；权重由 `11_fetch_weights_curl.sh` 用 curl 预取）。

用法：
  $PY scripts/40_run_pipeline_mps.py --device mps --resolution 768 --steps 8 \
      --srcp vendor/see-through/common/assets/test_image1.png
"""
import argparse
import json
import os
import resource
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VENDOR = os.path.join(ROOT, "vendor", "see-through")
sys.path.insert(0, os.path.join(VENDOR, "common"))


def rss_mb():
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024), 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default="mps", choices=["mps", "cpu", "cuda"])
    ap.add_argument("--srcp", required=True)
    ap.add_argument("--resolution", type=int, default=768, help="layerdiff 分辨率（上游默认 1280）")
    ap.add_argument("--resolution-depth", type=int, default=768)
    ap.add_argument("--steps", type=int, default=8, help="layerdiff 步数（上游默认 30）")
    ap.add_argument("--steps-depth", type=int, default=4)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--save-dir", default=None)
    ap.add_argument("--tag", default=None)
    ap.add_argument("--group-offload", action="store_true")
    ap.add_argument("--w-layerdiff", default=os.path.join(os.environ.get("AUTO_LAYER_SCRATCH", os.path.join(os.path.expanduser("~"), "dsh-scratch", "auto-layer")), "weights", "layerdiff3d"))
    ap.add_argument("--w-marigold", default=os.path.join(os.environ.get("AUTO_LAYER_SCRATCH", os.path.join(os.path.expanduser("~"), "dsh-scratch", "auto-layer")), "weights", "marigold"))
    ap.add_argument("--skip-psd", action="store_true")
    ap.add_argument("--only-layerdiff", action="store_true",
                    help="只跑第①步（SDXL 扩散），用于单独判定它能不能上 MPS")
    args = ap.parse_args()

    os.environ["SEETHROUGH_DEVICE"] = args.device
    tag = args.tag or f"pipe_{args.device}_r{args.resolution}_s{args.steps}"
    save_dir = args.save_dir or os.path.join(ROOT, "out", "pipeline")
    os.makedirs(save_dir, exist_ok=True)
    logd = os.path.join(ROOT, "out", "pipeline", "_runs")
    os.makedirs(logd, exist_ok=True)

    import torch

    rec = {
        "script": "40_run_pipeline_mps.py",
        "device_requested": args.device,
        "resolution": args.resolution, "steps": args.steps,
        "seed": args.seed, "srcp": os.path.abspath(args.srcp),
        "w_layerdiff": args.w_layerdiff, "w_marigold": args.w_marigold,
        "group_offload": args.group_offload,
        "torch": torch.__version__,
        "started": time.strftime("%Y-%m-%d %H:%M:%S"),
        "steps_record": {},
    }
    if args.device == "mps":
        rec["mps_recommended_max_gb"] = round(torch.mps.recommended_max_memory() / 1e9, 2)

    print(f"=== 设备 {args.device} | res={args.resolution} steps={args.steps} | {args.srcp} ===")

    from utils import inference_utils as IU
    rec["resolved_DEVICE"] = str(getattr(IU, "DEVICE", "<无 DEVICE 变量——补丁没打上>"))
    print(f"  inference_utils.DEVICE = {rec['resolved_DEVICE']}")
    if rec["resolved_DEVICE"] == "<无 DEVICE 变量——补丁没打上>":
        rec["verdict"] = "补丁未应用，终止"
        json.dump(rec, open(os.path.join(logd, f"{tag}.json"), "w"), indent=2, ensure_ascii=False)
        return 3

    def stage(name, fn):
        t0 = time.time()
        try:
            r = fn()
            dt = round(time.time() - t0, 2)
            rec["steps_record"][name] = {"ok": True, "seconds": dt, "rss_mb": rss_mb()}
            if args.device == "mps":
                rec["steps_record"][name]["mps_allocated_mb"] = round(torch.mps.current_allocated_memory() / 1e6, 1)
                rec["steps_record"][name]["mps_driver_mb"] = round(torch.mps.driver_allocated_memory() / 1e6, 1)
            print(f"  [OK  ] {name:22s} {dt:8.2f}s  RSS {rss_mb():8.1f} MB")
            return r
        except Exception as e:  # noqa: BLE001
            dt = round(time.time() - t0, 2)
            rec["steps_record"][name] = {"ok": False, "seconds": dt,
                                         "error": f"{type(e).__name__}: {str(e)[:600]}",
                                         "traceback": traceback.format_exc()[-3000:]}
            print(f"  [FAIL] {name:22s} {dt:8.2f}s\n         {type(e).__name__}: {str(e)[:400]}")
            return None

    # ---- ① LayerDiff ----
    ok = stage("apply_layerdiff", lambda: IU.apply_layerdiff(
        args.srcp, args.w_layerdiff, save_dir=save_dir, seed=args.seed,
        resolution=args.resolution, disable_progressbar=True,
        num_inference_steps=args.steps, group_offload=args.group_offload))
    if ok is None:
        rec["verdict"] = "卡在 apply_layerdiff"
        json.dump(rec, open(os.path.join(logd, f"{tag}.json"), "w"), indent=2, ensure_ascii=False)
        return 4

    if args.only_layerdiff:
        rec["verdict"] = "第①步 LayerDiff 跑通"
        rec["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
        rec["rss_peak_mb"] = rss_mb()
        json.dump(rec, open(os.path.join(logd, f"{tag}.json"), "w"), indent=2, ensure_ascii=False)
        print(f"\n结论：{rec['verdict']} | RSS 峰值 {rec['rss_peak_mb']} MB")
        return 0

    # ---- ② Marigold ----
    ok = stage("apply_marigold", lambda: IU.apply_marigold(
        args.srcp, args.w_marigold, save_dir=save_dir, seed=args.seed,
        resolution=args.resolution_depth, disable_progressbar=True,
        num_inference_steps=args.steps_depth, group_offload=args.group_offload))
    if ok is None:
        rec["verdict"] = "卡在 apply_marigold"
        json.dump(rec, open(os.path.join(logd, f"{tag}.json"), "w"), indent=2, ensure_ascii=False)
        return 5

    # ---- ③ further_extr（启发式分层 → PSD）----
    import os.path as osp
    srcname = osp.basename(osp.splitext(args.srcp)[0])
    saved = osp.join(save_dir, srcname)
    rec["saved_dir"] = saved
    if not args.skip_psd:
        ok = stage("further_extr", lambda: IU.further_extr(
            saved, rotate=False, save_to_psd=True, tblr_split=True))
        if ok is None:
            rec["verdict"] = "卡在 further_extr（①②已成功）"
            json.dump(rec, open(os.path.join(logd, f"{tag}.json"), "w"), indent=2, ensure_ascii=False)
            return 6

    rec["verdict"] = "跑通"
    rec["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
    rec["rss_peak_mb"] = rss_mb()
    rec["total_seconds"] = round(sum(v.get("seconds", 0) for v in rec["steps_record"].values()), 2)
    p = os.path.join(logd, f"{tag}.json")
    json.dump(rec, open(p, "w"), indent=2, ensure_ascii=False)
    print(f"\n结论：{rec['verdict']} | 总耗时 {rec['total_seconds']}s | RSS 峰值 {rec['rss_peak_mb']} MB")
    print(f"产出：{saved}\n台账：{p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
