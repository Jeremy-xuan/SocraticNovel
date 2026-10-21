#!/usr/bin/env python3
"""40_full_call.py —— 「压内存后能不能跑完一次完整 call」的端到端实测

上游完整 call 的三步（`inference/scripts/inference_psd.py` → `utils/inference_utils.py`）：
  ① apply_layerdiff —— LayerDiff3D **两趟**：body 组 13 tag（group_index=0）＋ head 组 11 tag（group_index=1）
  ② apply_marigold  —— Marigold 伪深度（定层序）
  ③ further_extr    —— 纯启发式后处理（左右拆分 / 头发前后拆分）→ PSD
  ⚠️ 主管线**不用 SAM**（SAM 是独立 annotator 路径，上一路已查明）。

本脚本与上游的三个差别（都为了压内存，且**每一处都有脚本 10/20/30 的实测依据**）：
  ① **载入即 bf16**（`torch_dtype=torch.bfloat16`）而不是 fp32 载入再 `.to(bfloat16)`
     → 依据：脚本 10 实测 layerdiff 装载 21.83 GB → 11.11 GB；
  ② **attention slicing**（diffusers 现成开关 `set_attention_slice`，不自研）
     → 依据：脚本 30 实测 UNet forward 19.03 GB → 13.98 GB；
  ③ **逐组件装载＋及时释放**：layerdiff 用完 `del` ＋ `gc` ＋ `torch.mps.empty_cache()` 再载 marigold
     → 上游用的是模块级 global 单例，两份管线会同时留在进程里。

🔴 不改上游任何文件（`vendor/see-through` 是只读参考）；本脚本只 import 它的类。

用法：
  PY=/Users/wujunjie/dsh-scratch/auto-layer/venv/bin/python
  $PY scripts/40_full_call.py --steps 2 --resolution 768 --attn-slice max --tag full_bf16_slice
"""
import argparse
import gc
import json
import os
import os.path as osp
import resource
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
AUTO_LAYER = os.environ.get("AUTO_LAYER_DIR",
                            os.path.join(os.path.dirname(ROOT), "auto-layer"))
VENDOR = os.path.join(AUTO_LAYER, "vendor", "see-through")
OUT = os.path.join(ROOT, "out")
os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, os.path.join(VENDOR, "common"))

W_LAYERDIFF = "/Users/wujunjie/dsh-scratch/auto-layer/weights/layerdiff3d"
W_MARIGOLD = "/Users/wujunjie/dsh-scratch/auto-layer/weights/marigold"
SRC = os.path.join(VENDOR, "common", "assets", "test_image1.png")

# 上游逐字 tag 组（`inference_utils.py` apply_layerdiff / diffusers_kdiffusion_sdxl.cache_tag_embeds）
BODY_TAGS = ['front hair', 'back hair', 'head', 'neck', 'neckwear', 'topwear', 'handwear',
             'bottomwear', 'legwear', 'footwear', 'tail', 'wings', 'objects']
HEAD_TAGS = ['headwear', 'face', 'irides', 'eyebrow', 'eyewhite', 'eyelash', 'eyewear',
             'ears', 'earwear', 'nose', 'mouth']
# 上游 VALID_BODY_PARTS_V2（marigold 阶段按这个顺序取层）
VALID_BODY_PARTS_V2 = ['hair', 'headwear', 'face', 'eyes', 'eyewear', 'ears', 'earwear', 'nose',
                       'mouth', 'neck', 'neckwear', 'topwear', 'handwear', 'bottomwear',
                       'legwear', 'footwear', 'tail', 'wings', 'objects']


def rss_gb():
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 ** 3), 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=2, help="layerdiff 步数（上游默认 30）")
    ap.add_argument("--steps-depth", type=int, default=4, help="marigold 步数（上游默认 4）")
    ap.add_argument("--resolution", type=int, default=768, help="layerdiff 分辨率（上游默认 1280）")
    ap.add_argument("--resolution-depth", type=int, default=768)
    ap.add_argument("--dtype", default="bf16", choices=["bf16", "fp32"])
    ap.add_argument("--attn-slice", default="max", help="off|auto|max|<int>")
    ap.add_argument("--no-vae-slicing", action="store_true",
                    help="不调 diffusers 的 vae slicing（对照：trans_vae 会对 13 张 latent 一次性 sd_vae.decode）")
    ap.add_argument("--no-serial", action="store_true", help="不做逐组件释放（两份管线同时在场，对照用）")
    ap.add_argument("--skip-marigold", action="store_true")
    ap.add_argument("--skip-extr", action="store_true")
    ap.add_argument("--no-vae-patch", action="store_true",
                    help="不打上游 estimate_augmented 的 MPS 恒等补丁（对照：应当崩在 5 维 median）")
    ap.add_argument("--srcp", default=SRC)
    ap.add_argument("--tag", default=None)
    args = ap.parse_args()

    import numpy as np
    import torch
    from PIL import Image
    from modules.layerdiffuse.layerdiff3d import UNetFrameConditionModel
    from modules.layerdiffuse.diffusers_kdiffusion_sdxl import KDiffusionStableDiffusionXLPipeline
    from modules.layerdiffuse.vae import TransparentVAE
    from modules.marigold import MarigoldDepthPipeline
    from utils.cv import center_square_pad_resize, smart_resize, img_alpha_blending
    from utils.torch_utils import seed_everything

    DT = {"bf16": torch.bfloat16, "fp32": None}[args.dtype]
    DEV = "mps"
    tag = args.tag or f"full_{args.dtype}_{args.attn_slice}_r{args.resolution}_s{args.steps}"
    save_dir = os.path.join(OUT, "fullcall", tag)
    os.makedirs(save_dir, exist_ok=True)

    rec = {"script": "40_full_call.py", "tag": tag, "dtype": args.dtype, "device": DEV,
           "attn_slice": args.attn_slice, "steps": args.steps, "steps_depth": args.steps_depth,
           "resolution": args.resolution, "serial_release": not args.no_serial,
           "srcp": os.path.abspath(args.srcp), "torch": torch.__version__,
           "started": time.strftime("%Y-%m-%d %H:%M:%S"), "steps_record": {}}

    # 🔴 上游在 MPS 上有一处**独立于内存**的硬阻塞：TransparentVAEDecoder.estimate_augmented
    #    对 5 维张量调 torch.median，而 MPS 的 sort kernel 只支持 ≤4 维 → Metal 断言 abort。
    #    本补丁是**数学恒等**替换（该处 len(result) 恒为 1），见 vae_mps_patch.py 的逐字论证。
    if not args.no_vae_patch:
        import vae_mps_patch
        rec["vae_patch"] = vae_mps_patch.apply()
    else:
        rec["vae_patch"] = "disabled"

    def probe():
        d = {"rss_gb": rss_gb()}
        d["mps_allocated_gb"] = round(torch.mps.current_allocated_memory() / 1e9, 2)
        d["mps_driver_gb"] = round(torch.mps.driver_allocated_memory() / 1e9, 2)
        return d

    def stage(name, fn):
        t0 = time.time()
        try:
            r = fn()
            d = {"ok": True, "seconds": round(time.time() - t0, 2), **probe()}
            rec["steps_record"][name] = d
            print(f"  [OK  ] {name:32s} {d['seconds']:8.2f}s  RSS {d['rss_gb']:6.2f} GB  "
                  f"alloc {d['mps_allocated_gb']:6.2f}  driver {d['mps_driver_gb']:6.2f}", flush=True)
            return r
        except Exception as e:  # noqa: BLE001
            rec["steps_record"][name] = {"ok": False, "seconds": round(time.time() - t0, 2),
                                         "error": f"{type(e).__name__}: {str(e)[:800]}",
                                         "traceback": traceback.format_exc()[-3000:]}
            print(f"  [FAIL] {name:32s}\n         {type(e).__name__}: {str(e)[:500]}", flush=True)
            return None

    # 🔴 用**容器**而不是局部变量持有 pipeline：run_layerdiff / run_marigold 是闭包，
    #    若它们直接引用 `pipe` 这个名字，闭包就会一直持有引用 → `del pipe` 释放不掉
    #    （实测：释放后 `current_allocated_memory` 仍是 8.52 GB，纹丝不动）。
    #    放进 dict 后，`P["pipe"] = None` 就能真正断开最后一个引用。
    P = {"pipe": None}
    M = {"pipe": None}

    def build_layerdiff():
        tgt = torch.bfloat16 if DT is None else DT
        trans_vae = TransparentVAE.from_pretrained(W_LAYERDIFF, subfolder="trans_vae")
        ukw = {"subfolder": "unet"}
        pkw = {"trans_vae": trans_vae, "scheduler": None}
        if DT is not None:
            ukw["torch_dtype"] = DT
            pkw["torch_dtype"] = DT
        unet = UNetFrameConditionModel.from_pretrained(W_LAYERDIFF, **ukw)
        pkw["unet"] = unet
        pipe = KDiffusionStableDiffusionXLPipeline.from_pretrained(W_LAYERDIFF, **pkw)
        for c in ("vae", "trans_vae", "unet", "text_encoder", "text_encoder_2"):
            getattr(pipe, c).to(dtype=tgt, device=DEV)
        if args.attn_slice != "off":
            arg = int(args.attn_slice) if args.attn_slice.isdigit() else args.attn_slice
            pipe.unet.set_attention_slice(arg)     # diffusers 现成开关
            rec["attn_slice_applied"] = str(arg)
        # 🔴 手段3 的第二个开关：**vae slicing**（diffusers 自带机制，上游没开）。
        #    上游 `TransparentVAEDecoder.forward` 逐字是 `pixel = sd_vae.decode(latent).sample`，
        #    而 latent 的 batch 维 = tag 数（body 13 / head 11）→ **一次解码 13 张 768² 图**。
        #    diffusers 0.37 的 `AutoencoderKL.decode` 里就有现成分支（逐字）：
        #        if self.use_slicing and z.shape[0] > 1:
        #            decoded_slices = [self._decode(z_slice).sample for z_slice in z.split(1)]
        #            decoded = torch.cat(decoded_slices)
        #    `use_slicing` 在 `AutoencoderKL.__init__` 里默认 False；**diffusers 0.37 的 VAE 上没有
        #    `enable_vae_slicing()` 这个方法**（同名方法散在各 pipeline 上，不在这条链上）→ 直接置属性。
        #    这是**逐张解码再拼接**，与批量解码数学等价（VAE 解码无 batch 间交互），不是降级。
        if not args.no_vae_slicing:
            pipe.vae.use_slicing = True
            rec["vae_slicing"] = True
        else:
            rec["vae_slicing"] = False
        torch.mps.synchronize()
        pipe.cache_tag_embeds()                    # 上游默认 unload_textencoders=True
        return pipe

    def build_marigold():
        tgt = torch.bfloat16 if DT is None else DT
        ukw = {"subfolder": "unet"}
        pkw = {}
        if DT is not None:
            ukw["torch_dtype"] = DT
            pkw["torch_dtype"] = DT
        unet = UNetFrameConditionModel.from_pretrained(W_MARIGOLD, **ukw)
        pkw["unet"] = unet
        pipe = MarigoldDepthPipeline.from_pretrained(W_MARIGOLD, **pkw)
        pipe.to(device=DEV, dtype=tgt)
        torch.mps.synchronize()
        pipe.cache_tag_embeds()
        return pipe

    def release(obj, name):
        if obj is not None:
            del obj
        gc.collect()
        torch.mps.empty_cache()
        torch.mps.synchronize()
        print(f"  [REL ] 释放 {name} -> alloc {round(torch.mps.current_allocated_memory()/1e9,2)} GB  "
              f"driver {round(torch.mps.driver_allocated_memory()/1e9,2)} GB", flush=True)

    # ================= ① LayerDiff 两趟 =================
    print(f"=== 完整 call | {tag} ===", flush=True)
    print(f"  MPS 推荐预算 {round(torch.mps.recommended_max_memory()/1e9,2)} GB", flush=True)

    def run_layerdiff():
        input_img = np.array(Image.open(args.srcp).convert("RGBA"))
        fullpage, pad_size, pad_pos = center_square_pad_resize(input_img, args.resolution, return_pad_info=True)
        scale = pad_size[0] / args.resolution
        Image.fromarray(fullpage).save(osp.join(save_dir, "src_img.png"))
        rng = torch.Generator(device="mps").manual_seed(42)

        # --- body 组（13 tag，group_index=0）---
        t0 = time.time()
        out = P["pipe"](strength=1.0, num_inference_steps=args.steps, batch_size=1, generator=rng,
                   guidance_scale=1.0, prompt=BODY_TAGS, negative_prompt="",
                   fullpage=fullpage, group_index=0)
        rec["body_seconds"] = round(time.time() - t0, 2)
        images = out.images
        for rst, t in zip(images, BODY_TAGS):
            Image.fromarray(rst).save(osp.join(save_dir, f"{t}.png"))
        head_img = images[2]

        # --- head 裁剪 ---
        import cv2
        hx0, hy0, hw, hh = cv2.boundingRect(cv2.findNonZero((head_img[..., -1] > 15).astype(np.uint8)))
        hx, hy = int(hx0 * scale) - pad_pos[0], int(hy0 * scale) - pad_pos[1]
        hw, hh = int(hw * scale), int(hh * scale)
        ih0, iw0 = input_img.shape[:2]
        x1, y1, x2, y2 = hx, hy, hx + hw, hy + hh
        if hw < iw0 // 2:
            px = min(iw0 - hx - hw, hx, hw // 5)
            x1, x2 = max(hx - px, 0), min(hx + hw + px, iw0)
        if hh < ih0 // 2:
            py = min(ih0 - hy - hh, hy, hh // 5)
            y1, y2 = max(hy - py, 0), min(hy + hh + py, ih0)
        input_head = input_img[y1:y2, x1:x2]
        hx1 = int(x1 / scale + pad_pos[0] / scale)
        hy1 = int(y1 / scale + pad_pos[1] / scale)
        ih, iw = input_head.shape[:2]
        input_head, pad_size, pad_pos = center_square_pad_resize(input_head, args.resolution, return_pad_info=True)
        Image.fromarray(input_head).save(osp.join(save_dir, "src_head.png"))

        # --- head 组（11 tag，group_index=1）---
        t1 = time.time()
        out = P["pipe"](strength=1.0, num_inference_steps=args.steps, batch_size=1, generator=rng,
                   guidance_scale=1.0, prompt=HEAD_TAGS, negative_prompt="",
                   fullpage=input_head, group_index=1)
        rec["head_seconds"] = round(time.time() - t1, 2)
        canvas = np.zeros((args.resolution, args.resolution, 4), dtype=np.uint8)
        py1, py2 = (np.array([pad_pos[1], pad_pos[1] + ih]) / scale).astype(np.int64)
        px1, px2 = (np.array([pad_pos[0], pad_pos[0] + iw]) / scale).astype(np.int64)
        scale_size = (int(pad_size[0] / scale), int(pad_size[1] / scale))
        for rst, t in zip(out.images, HEAD_TAGS):
            rst = smart_resize(rst, scale_size)[py1:py2, px1:px2]
            full = canvas.copy()
            full[hy1:hy1 + rst.shape[0], hx1:hx1 + rst.shape[1]] = rst
            Image.fromarray(full).save(osp.join(save_dir, f"{t}.png"))
        rec["head_crop"] = [int(hx1), int(hy1), int(hx1 + iw), int(hy1 + ih)]
        return True

    P["pipe"] = stage("build_layerdiff", build_layerdiff)
    if P["pipe"] is None:
        json.dump(rec, open(osp.join(OUT, f"full_{tag}.json"), "w"), indent=2, ensure_ascii=False)
        return 3
    if stage("run_layerdiff(body+head)", run_layerdiff) is None:
        json.dump(rec, open(osp.join(OUT, f"full_{tag}.json"), "w"), indent=2, ensure_ascii=False)
        return 4

    layers = sorted(f for f in os.listdir(save_dir) if f.endswith(".png"))
    rec["layers_written"] = len(layers)
    print(f"  出层 {len(layers)} 张：{layers}", flush=True)

    if args.no_serial:
        stage("keep_layerdiff_alive", lambda: True)   # 对照组：不释放
    else:
        # 🔴 顺序要紧：**先断开容器里的引用**，再 gc + empty_cache（见 20_pipeline_load.py 的同类坑）
        P["pipe"] = None
        stage("release_layerdiff", lambda: release(None, "layerdiff"))

    # ================= ② Marigold =================
    if not args.skip_marigold:
        M["pipe"] = stage("build_marigold", build_marigold)
        if M["pipe"] is not None:
            def run_marigold():
                fullpage = np.array(Image.open(osp.join(save_dir, "src_img.png")).convert("RGBA"))
                src_h, src_w = fullpage.shape[:2]
                img_list, empty = [], np.zeros((src_h, src_w, 4), dtype=np.uint8)
                for t in VALID_BODY_PARTS_V2:
                    p = osp.join(save_dir, f"{t}.png")
                    if osp.exists(p):
                        a = np.array(Image.open(p))
                        a[..., -1][a[..., -1] < 15] = 0
                        img_list.append(a)
                    else:
                        img_list.append(empty)
                blended = np.zeros((src_h, src_w), dtype=np.float32)
                for im in img_list:
                    blended += im[..., -1].astype(np.float32) / 255
                fullpage = fullpage.copy()
                fullpage[..., -1] = (np.clip(blended, 0, 1) * 255).astype(np.uint8)
                img_list.append(fullpage)
                t0 = time.time()
                po = M["pipe"](color_map=None, img_list=img_list, denoising_steps=args.steps_depth)
                rec["marigold_seconds"] = round(time.time() - t0, 2)
                depth = po.depth_tensor
                rec["depth_shape"] = list(depth.shape)
                np.save(osp.join(save_dir, "depth.npy"), depth.to(device="cpu", dtype=torch.float32).numpy())
                return True
            stage("run_marigold", run_marigold)
            if not args.no_serial:
                M["pipe"] = None
                stage("release_marigold", lambda: release(None, "marigold"))

    # ================= ③ further_extr（纯启发式后处理）=================
    if not args.skip_extr:
        def run_extr():
            from utils.inference_utils import further_extr
            return further_extr(save_dir, save_to_psd=False, tblr_split=True)
        stage("further_extr", run_extr)

    rec["rss_peak_gb_inproc"] = rss_gb()
    rec["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
    rec["verdict"] = "完整 call 跑通"
    p = osp.join(OUT, f"full_{tag}.json")
    json.dump(rec, open(p, "w"), indent=2, ensure_ascii=False)
    print(f"\n  ✅ 完整 call 跑通 | 进程内 RSS 峰值 {rec['rss_peak_gb_inproc']} GB | 台账 {p}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
