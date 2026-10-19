#!/usr/bin/env python3
"""33_make_layers.py —— 轻量路线端到端：一张立绘 → 19 类语义层（含被遮挡区补全）

这是本次**最有价值的产出**：不碰 10.16 GB 的 SDXL 扩散，只用
  · SemanticSam 1.29 GB（语义部件分割）  ← MPS 实测 9.6 s
  · 动漫 LaMa   0.20 GB（补全被遮挡区）  ← MPS 实测 1.4–2.7 s
合计 **1.5 GB 权重**，在 Apple M3 的 MPS 上跑通。

为什么必须补全（不是"锦上添花"）：
  SAM 给的是**可见像素**。Live2D 要让部件动起来，需要部件的**完整纹理**——
  例如脸被刘海遮住的部分、身体被手臂遮住的部分。不补全，层就是破的，一动就露洞。
  这正是 See-through 用 10 GB 扩散模型在做的事；我们用 0.2 GB 的 LaMa 替代。

做法（每个部件 P）：
  ① 取 P 的可见掩码 M_P（SAM 输出）；
  ② 补全区 = **画在 P 上面的**部件的掩码 ∩（M_P 外接框外扩 pad）∩ 非 P
     —— 即"盖住 P 的地方"（判据见下 `OCCLUSION_DIRECTION`，MOUTH-FIX-2 修正）；
  ③ 让 LaMa 把该区重画成 P 的内容（`apply_inpaint`，mask=1 表示要填的洞）；
  ④ 层 = RGB 用修补后的整图，alpha = M_P ∪ 补全区。

🔴 MOUTH-FIX-2 改了这里的三件事（都是"嘴在真渲染器里动不动"的卡点）：

  ① **补全区的遮挡物判据**：原式是"**其它部件的并集**"，把**画在 P 下面**的部件
     也当成了遮挡物 —— 对画在最上面的小五官（嘴/鼻）是错的：脸在嘴下面，
     却把嘴外接框里的脸像素重画成嘴。实测：`hair` 因此从 136,917 px 膨胀到 204,899 px，
     它接成 `hair_front` 之后 100% 盖住嘴 ⇒ 真渲染器 0 px（嘴根本不动）。
     现改为**只取绘制序更高的部件**（`OCCLUSION_DIRECTION = 'above'`）。
     判据不成立时**抛错**，不静默降级（见 `check_occlusion_direction`）。

  ② **绘制序表**：原表是反的（`hair=10` 在最底 ⇒ 脸盖在头发上），与 Live2D 惯例
     （刘海在最上）相反。现按 image2live2d `samples.py` 的规范层序重排（见 `DRAW_ORDER`）。

  ③ **前后发拆分**：SAM 的 `hair` 是**前后发合并的一块**。单块无论放最上（盖住脸）
     还是放最底（后发跑到脖子/上衣前面）都是错的 ⇒ 按"脸区域"几何拆成
     `hair_back`（脸区域外）与 `hair_front`（脸区域内＝刘海/鬓发）。

用法：
  $PY scripts/33_make_layers.py --device mps --samdir out/sam/sam_mps_test1 --tag light_mps
"""
import argparse
import json
import os
import resource
import sys
import time
import traceback

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VENDOR = os.path.join(ROOT, "vendor", "see-through")
sys.path.insert(0, os.path.join(VENDOR, "common"))
sys.path.insert(0, VENDOR)
sys.path.insert(0, os.path.join(VENDOR, "annotators"))

LABELS = ['hair', 'headwear', 'face', 'eyes', 'eyewear', 'ears', 'earwear', 'nose',
          'mouth', 'neck', 'neckwear', 'topwear', 'handwear', 'bottomwear', 'legwear',
          'footwear', 'tail', 'wings', 'objects']
CKPT = os.path.join(os.environ.get("AUTO_LAYER_SCRATCH", os.path.join(os.path.expanduser("~"), "dsh-scratch", "auto-layer")), "weights", "lama_anime_512.ckpt")

# ── 补全区的遮挡物判据（MOUTH-FIX-2） ──────────────────────────────────────────
# 'above'  = 只把**绘制序更高**（画在上面）的部件当遮挡物 ← 现行，唯一正确的方向
# 'all'    = 上游原样：所有其它部件的并集 ← 已废（会把画在下面的部件当遮挡物）
OCCLUSION_DIRECTION = 'above'

# ── 修前的绘制序表（**只在做对照实验时用**，见 `--order legacy`） ──────────────
# 它**是反的**：`hair=10` 在最底、`face=30` 在上面 ⇒ **脸盖在头发上**，
# 与 Live2D 惯例（后发最底、刘海最上）相反。留在这里是为了让"改前/改后"的对照
# **可由当前代码复现**（不是靠记忆，也不是靠翻旧文件）。
DRAW_ORDER_LEGACY = {
    'hair': 10, 'headwear': 130, 'face': 30, 'eyes': 60, 'eyewear': 70,
    'ears': 55, 'earwear': 56, 'nose': 45, 'mouth': 50, 'neck': 25,
    'neckwear': 26, 'topwear': 20, 'handwear': 65, 'bottomwear': 15,
    'legwear': 12, 'footwear': 11, 'tail': 8, 'wings': 9, 'objects': 140,
}
LEGACY_FALLBACK_ORDER = 99      # 修前代码里 `DRAW_ORDER.get(p, 99)` 的兜底值

# ── 绘制顺序表（数值大的盖住数值小的） ────────────────────────────────────────
# 🔴 MOUTH-FIX-2 改对了。原表把 `hair` 记成 10（最底）、`face` 记成 30
#    ⇒ **脸盖在头发上**，与 Live2D 惯例（后发最底、刘海最上）相反。
#
# **依据（两条，不是凭感觉）**：
#   ① image2live2d `samples.py` 的两份 `spec`（逐字注释 "back to front"）：
#      fullbody：`hair_back 0` → `leg 5/6` → `arm 8/9` → `torso 12` → `clothing 13`
#                → `hair_side 20` → `face_base 24` → `eyebrow 40/41` → `eye_white 50/51`
#                → `eye 52/53` → `nose 55` → `pupil 60/61` → `mouth 70` → `hair_front 90`
#      face-only：`face_base 0` → `eyebrow 40` → `eye_white 50` → `eye 52` → `nose 55`
#                → `pupil 60` → `mouth 70` → `hair_front 90`
#   ② 本目录 `scripts/35_order_probe.py` 对 SAM 可见掩码的**实测约束**
#      （"被对方包住的像素规模" ⇒ 谁只能画在谁上面），修前表 1–2 条矛盾、修后表 ≤1 条
#      （残留那条是 SAM 掩码自身的抗锯齿重叠，见 out/probe/35_order_*.json）。
DRAW_ORDER = {
    # —— 背景层：后发与身后物件（原表这里是 `tail 8` / `wings 9`，位置对，数值归一化）——
    'tail': 4, 'wings': 8, 'hair_back': 6, 'hair': 6,     # `hair` 兜底＝按后发处理
    # —— 身体与衣物（顺序逐字对齐 i2l `samples.py` fullbody 的 spec：
    #    leg 5/6 < arm 8/9 < torso 12 < clothing 13）——
    'legwear': 10, 'footwear': 11, 'bottomwear': 13, 'topwear': 15, 'handwear': 17,
    'neckwear': 18, 'neck': 20,
    # —— 脸与脸侧 ——
    'face': 24, 'ears': 28, 'earwear': 29,
    # —— 五官（顺序逐字对齐 i2l `samples.py`：nose 55 < eyes 60 < mouth 70）——
    'nose': 55, 'eyes': 60, 'eyewear': 66, 'mouth': 70,
    # —— 前发 / 头饰 / 前景物件（最上）——
    'hair_front': 90, 'headwear': 92, 'objects': 94,
}

# 出层阈值：**按部件**给，不做一刀切。
#
# 理由（本目录 out/probe/minpx_{ourasset,test1}.json 的连通域实测）：
#   · 同一张图上，`topwear` 有 132,396 px、`mouth` 只有 918 px（我方平色）或 **19 px**（真手绘），
#     `nose` 126 px —— 相差最多 7,000 倍。一个全局数字不可能同时服务这两端：
#     任何能滤掉碎块的值，都会把嘴/鼻一起删掉（实测：默认 200 下 test1 的 mouth 被整块滤除）。
#   · 而这两者不是碎块：test1 的 mouth 是**单个连通域、距主块 0 span**（碎块的实测特征是
#     ~15.9 span 之外，见 minpx 探针），语义上就是"一个很小的真部件"。
#   · 所以阈值差异是**部件属性**，不是噪声判据 —— 按部件给值，全局 --min-px 只作其余部件的默认。
#
# 取值 8：低于实测最小真部件（19 px）留有余量，同时仍高于 SAM 输出里已知的散落碎块
# （ourasset `ears` 的 11 px / 6 px 碎块位于 15.92 span 之外）。
MIN_PX_BY_PART = {'mouth': 8, 'nose': 8}

# 前后发拆分：拿"脸区域"当几何判据（脸掩码 → 形态学闭运算填掉五官留下的洞 → 外扩 N px）。
# 脸区域**内**的头发像素 = 前发（刘海/鬓发，画在脸上面）；
# 脸区域**外**的 = 后发（画在最底）。
# 依据：SAM 给的是可见像素，而可见像素本身就带着"谁盖住谁"的信息 ——
# 头发在脸区域内的可见部分，只可能是**画在脸上面的那部分头发**。
HAIR_FACE_GROW = 6
HAIR_FACE_CLOSE_KERNEL = 31



def rss_mb():
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024), 1)


def _split_lr(alpha_bool, min_px=200):
    """按连通域把一块掩码拆左右：取面积最大的两块，按质心 x 定左右。
    图像坐标 x 小 = 画面左。返回 (左掩码, 右掩码) 或 None。"""
    import cv2
    n, labels, stats, cents = cv2.connectedComponentsWithStats(
        (alpha_bool > 0).astype(np.uint8), connectivity=8)
    if n <= 1:
        return None
    idx = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= min_px]
    if len(idx) < 2:
        return None
    idx.sort(key=lambda i: -stats[i, cv2.CC_STAT_AREA])
    a, b = idx[0], idx[1]
    l, r = (a, b) if cents[a][0] <= cents[b][0] else (b, a)
    return (labels == l), (labels == r)


def _face_region(face_mask, grow=HAIR_FACE_GROW, kernel=HAIR_FACE_CLOSE_KERNEL):
    """「脸区域」的实心化版本 —— 前后发拆分的几何判据。

    为什么必须实心化：脸的**可见**掩码在眼/嘴/鼻处有洞（那些像素被五官占了），
    直接拿它当判据会把五官位置判成"脸区域外"。闭运算把洞填掉，再外扩 grow px 吃掉边界毛刺。

    为什么可以用它当判据：SAM 给的是**可见**像素，而可见像素自带"谁盖住谁"的信息 ——
    头发在脸区域内的可见部分，只可能是**画在脸上面的那部分头发**（＝刘海/鬓发）；
    落在脸区域外的，只可能是**没被脸盖住的后发**。
    """
    import cv2
    m = (face_mask.astype(np.uint8)) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE,
                         cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel, kernel)))
    if grow > 0:
        m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1, 2 * grow + 1)))
    return m > 127


def check_occlusion_direction(units, direction, order_mode='fixed'):
    """🔴 判据不成立时**响亮报错**，不静默降级。

    判据 `above` 成立的前提：每个部件都**真的**有绘制序可依，且序表给出的方向与图上
    实际的遮挡关系一致。这里做三项硬检查，任何一项不成立就抛 `SystemExit(6)`：

      ① `direction` 只能是 'above'（'all' 是已废的上游行为，用它就等于放弃判据）；
      ② 每个部件都必须能在表里查到绘制序（否则它算不出补全区）；
      ③ 序表里至少要有两个不同的值（否则 `above` 分不出遮挡物）。

    🔴 `--order legacy` ＋ `--hole-mode all` 是**唯一的合法例外** —— 它精确复现修前行为，
    专供"改前/改后"对照实验；`--hole-mode all` 配**修后的表**一律报错
    （那种组合既没有旧行为的可解释性，又丢掉了判据）。

    `SystemExit(6)` 的后果说清：**这一跑不会产出层** —— 因为"用哪一半部件当遮挡物"
    直接决定层 alpha 的大小，判据不成立时产出的层是**不可信的**（上一版就是因此
    把嘴层膨胀到 1.667 倍、并把 `hair` 膨胀到 ×1.497 盖住整张脸）。
    """
    if direction != 'above' and order_mode != 'legacy':
        raise SystemExit(
            f"[FATAL] --hole-mode={direction!r} 不是受支持的判据。\n"
            f"        只有 'above'（只取绘制序更高的遮挡物）是对的；'all' 是已废的上游行为，\n"
            f"        仅在 `--order legacy`（精确复现修前行为、做对照实验）时才被允许。\n"
            f"        后果：用 'all' 会把画在下面的部件当遮挡物，产出的层 alpha 不可信。")
    missing = [n for n, _, o in units if o is None]
    if missing:
        raise SystemExit(
            f"[FATAL] 以下部件在 DRAW_ORDER 里没有绘制序，算不出补全区：{missing}\n"
            f"        后果：它们的层 alpha 会退化成「可见像素」，被遮挡区无法补全。")
    orders = [o for _, _, o in units]
    if len(set(orders)) < 2:
        raise SystemExit(
            f"[FATAL] 所有部件的绘制序都相同（{orders[:3]}…）—— 判据 'above' 无法区分遮挡物。\n"
            f"        后果：补全区恒为空，等于放弃补全。")


def _hair_split(hair, face, min_px=1):
    """把 SAM 合并的 `hair` 掩码拆成 (前发, 后发)。

    判据见 `_face_region`。返回 (front, back, info)；两块任一为空则整块当后发
    （宁可"刘海丢失"也不要"整块跑到最上盖住脸"），并在 info 里如实记录。
    """
    fr = _face_region(face)
    front = hair & fr
    back = hair & (~fr)
    info = {"criterion": f"hair ∩ 脸区域(脸掩码闭运算 {HAIR_FACE_CLOSE_KERNEL}px "
                         f"+ 外扩 {HAIR_FACE_GROW}px)",
            "face_region_px": int(fr.sum()),
            "front_px": int(front.sum()), "back_px": int(back.sum())}
    if front.sum() < min_px:
        info["degraded"] = "前发为空 → 整块 hair 按后发处理（刘海会丢失，但不会盖住脸）"
        return None, hair, info
    return front, back, info



def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default="mps", choices=["mps", "cpu", "cuda"])
    ap.add_argument("--samdir", required=True)
    ap.add_argument("--outdir", default=os.path.join(ROOT, "out", "layers"))
    ap.add_argument("--tag", default=None)
    ap.add_argument("--ckpt", default=CKPT)
    ap.add_argument("--pad", type=float, default=0.10, help="外接框外扩比例")
    ap.add_argument("--min-px", type=int, default=200,
                    help="**其余部件**的默认出层阈值；MIN_PX_BY_PART 里点名的部件用各自的值")
    ap.add_argument("--order", default="fixed", choices=["fixed", "legacy"],
                    help="绘制序表：fixed=MOUTH-FIX-2 修后的表（默认）；"
                         "legacy=修前那张反的表 —— 🔴 **只用于对照实验**，不要用它产出交付物")
    ap.add_argument("--hole-mode", default="above", choices=["above", "all"],
                    help="补全区遮挡物判据：above=只取绘制序更高的（默认、唯一正确）；"
                         "all=上游原样（已废）—— 🔴 **只用于对照实验**")
    ap.add_argument("--no-hair-split", action="store_true",
                    help="关掉前后发拆分（对照用）：hair 整块按后发接")
    args = ap.parse_args()

    def min_px_for(part):
        """部件 p 的出层阈值：点名的部件用 MIN_PX_BY_PART，其余用 --min-px。"""
        return MIN_PX_BY_PART.get(part, args.min_px)

    order_table = DRAW_ORDER if args.order == "fixed" else DRAW_ORDER_LEGACY
    fallback = None if args.order == "fixed" else LEGACY_FALLBACK_ORDER

    def order_for(part):
        """部件 p 的绘制序：修后的表直接查；修前的表带 `LEGACY_FALLBACK_ORDER` 兜底。

        🔴 双侧部件在 `units` 里叫 `eyes_l` / `handwear_r` 这类名字，但序表里只有**基名**
        （`eyes` / `handwear`）—— 所以查表前必须剥掉 `_l` / `_r` 后缀。
        （实测踩过：不剥后缀 ⇒ `handwear_l` 查不到序 ⇒ 判据自检**响亮报错**退出 6。
        这条报错是对的：它正是"判据不成立时不许静默降级"该有的样子。）
        """
        base = part[:-2] if part.endswith(("_l", "_r")) else part
        return order_table.get(base, fallback)

    tag = args.tag or f"layers_{args.device}"
    outdir = os.path.join(args.outdir, tag)
    ldir = os.path.join(outdir, "layers")
    # 🔴 必须先清空：上一轮可能留下未拆分的旧层（实测：重跑后目录里新旧混在一起，
    #    接触表与后续接线都会被污染）
    if os.path.isdir(ldir):
        import shutil
        shutil.rmtree(ldir)
    os.makedirs(ldir, exist_ok=True)

    import torch

    rec = {"script": "33_make_layers.py", "device_requested": args.device,
           "samdir": os.path.abspath(args.samdir), "pad": args.pad,
           "min_px_default": args.min_px, "min_px_by_part": dict(MIN_PX_BY_PART),
           "order_table": args.order, "hole_mode": args.hole_mode,
           "hair_split_enabled": not args.no_hair_split,
           "torch": torch.__version__, "started": time.strftime("%Y-%m-%d %H:%M:%S"),
           "per_part": {}}

    def stage(name, fn):
        t0 = time.time()
        try:
            r = fn()
            print(f"  [OK  ] {name:26s} {time.time()-t0:7.2f}s")
            return r
        except Exception as e:  # noqa: BLE001
            rec.setdefault("errors", {})[name] = {
                "error": f"{type(e).__name__}: {str(e)[:500]}",
                "traceback": traceback.format_exc()[-2000:]}
            print(f"  [FAIL] {name:26s} {time.time()-t0:7.2f}s -> {type(e).__name__}: {str(e)[:250]}")
            return None

    print(f"=== 轻量路线分层 | 设备 {args.device} | samdir={args.samdir} ===")

    def _load():
        img = np.array(Image.open(os.path.join(args.samdir, "input.png")).convert("RGB"))
        mdir = os.path.join(args.samdir, "masks")
        masks = {}
        for f in sorted(os.listdir(mdir)):
            if not f.endswith(".png"):
                continue
            i = int(f.split("_")[0])
            a = np.array(Image.open(os.path.join(mdir, f)).convert("RGBA"))[..., 3]
            masks[LABELS[i]] = a > 127
        return img, masks

    loaded = stage("load_image_and_masks", _load)
    if loaded is None:
        return 3
    img, masks = loaded
    H, W = img.shape[:2]
    rec["image_shape"] = [H, W, 3]

    def _load_lama():
        from lama_inpainter import LamaFourier
        import lama_inpainter as LI
        m = LamaFourier(build_discriminator=False, use_mpe=False, large_arch=True)
        sd = torch.load(args.ckpt, map_location="cpu", weights_only=False)
        m.generator.load_state_dict(sd["gen_state_dict"])
        m.eval().to(args.device)
        LI.model = m
        rec["lama_params_m"] = round(sum(p.numel() for p in m.generator.parameters()) / 1e6, 1)
        return m

    lama = stage("load_lama", _load_lama)
    if lama is None:
        json.dump(rec, open(os.path.join(outdir, "result.json"), "w"), indent=2, ensure_ascii=False)
        return 4

    import lama_inpainter
    from lama_inpainter import apply_inpaint

    # 🔴 2026-10-19：上游 `lama_inpainter.apply_inpaint` 内部调 `inpaint_preprocess(img, mask)`
    #    **不传 device** → 用函数默认值 `device='cuda'`。本机无 CUDA（Apple M3），于是每一层都抛
    #    `AssertionError: Torch not compiled with CUDA enabled`（实测：12 层里 6 层挂）。
    #    这里在**我们自己的脚本**里把那个默认值接到当前选定的 device 上，不动 vendor 的源码树。
    _CUR_DEVICE = {"device": args.device}
    _orig_preprocess = lama_inpainter.inpaint_preprocess

    def _preprocess_with_device(img, mask, inpaint_size=1024, device=None):
        return _orig_preprocess(img, mask, inpaint_size, device or _CUR_DEVICE["device"])

    lama_inpainter.inpaint_preprocess = _preprocess_with_device

    parts = [p for p in LABELS if p in masks and int(masks[p].sum()) >= min_px_for(p)]
    rec["parts"] = parts
    rec["min_px_used"] = {p: min_px_for(p) for p in parts}
    rec["dropped_by_min_px"] = {p: int(masks[p].sum()) for p in LABELS
                               if p in masks and 0 < int(masks[p].sum()) < min_px_for(p)}
    print(f"  参与分层的部件 {len(parts)} 个：{parts}")
    if rec["dropped_by_min_px"]:
        print(f"  被阈值滤掉的部件（px）：{rec['dropped_by_min_px']}")

    # 🔴 双侧部件必须**在补全之前**按可见掩码拆左右。
    # 原因（实测踩过）：补全区是"其它部件掩码 ∩ 本部件外接框"，它会把左右两块**连通起来**
    # → 事后再拆连通域就只能得到 1 块（实测报"连通域不足两个"）。
    # 而 image2live2d 的 SemanticRole 要 eye_l/eye_r 分开，所以必须在这里拆。
    # 拆分粒度：每个子部件各自独立走"取掩码 → 算补全区 → LaMa 补 → 出层"。
    BILATERAL = {"eyes", "ears", "handwear", "legwear"}
    units = []          # (输出名, 掩码, 绘制顺序)
    for p in parts:
        if p in BILATERAL:
            sp = _split_lr(masks[p], args.min_px)
            if sp is None:
                print(f"    [警告] {p} 连通域不足两块，按单块处理")
                units.append((p, masks[p], order_for(p)))
            else:
                lm, rm = sp
                units.append((f"{p}_l", lm, order_for(p)))
                units.append((f"{p}_r", rm, order_for(p)))
                print(f"    左右拆分 {p} -> {p}_l ({int(lm.sum())} px) / {p}_r ({int(rm.sum())} px)")
        else:
            units.append((p, masks[p], order_for(p)))

    # ── ③ 前后发拆分（MOUTH-FIX-2） ───────────────────────────────────────────
    # 必须在**算出 units 之后、补全之前**做：拆分判据用的是脸的可见掩码，与补全无关。
    hair_info = None
    if args.no_hair_split and any(n == 'hair' for n, _, _ in units):
        print("    [对照] --no-hair-split：hair 整块按后发处理")
        hair_info = {"skipped": "--no-hair-split（对照用）"}
    elif any(n == 'hair' for n, _, _ in units) and 'face' in masks:
        front, back, hair_info = _hair_split(masks['hair'], masks['face'])
        new_units = []
        for n, m, o in units:
            if n != 'hair':
                new_units.append((n, m, o))
                continue
            new_units.append(('hair_back', back, order_for('hair_back')))
            if front is not None:
                new_units.append(('hair_front', front, order_for('hair_front')))
        units = new_units
        print(f"    前后发拆分：hair {int(masks['hair'].sum())} px → "
              f"hair_front {hair_info['front_px']} px / hair_back {hair_info['back_px']} px"
              f"（判据：{hair_info['criterion']}）")
        if 'degraded' in hair_info:
            print(f"    [警告] {hair_info['degraded']}")
    elif any(n == 'hair' for n, _, _ in units):
        print("    [警告] SAM 没出 face 掩码 → 前后发拆不开，hair 整块按后发处理")
        hair_info = {"degraded": "无 face 掩码，整块 hair 按后发处理"}

    rec["units"] = [u[0] for u in units]
    rec["draw_order_used"] = {n: o for n, _, o in units}
    rec["occlusion_direction"] = args.hole_mode
    if hair_info:
        rec["hair_split"] = hair_info

    # ── ① 补全判据：只把**画在上面的**部件当遮挡物 ────────────────────────────
    check_occlusion_direction(units, args.hole_mode, args.order)

    # 每个部件的"遮挡物并集"：按 --hole-mode 取序更高的那些部件
    occluders_of = {}
    for name, m, order in units:
        o = np.zeros((H, W), dtype=bool)
        for other, om, oorder in units:
            if other == name:
                continue
            if args.hole_mode == 'above' and oorder <= order:
                continue                      # 画在下面 ⇒ 不是遮挡物
            o |= om
        occluders_of[name] = o

    # 判据自检：**每个有遮挡物的部件**都必须真的算出非空补全区；
    # 若"其它部件全在下面"⇒ 该部件其实没有被任何东西盖住，补全区为空是**正确**结果。
    # 真正要防的是"序表把方向搞反了" —— 表现为**画在最上面的五官**也被算出巨大补全区。
    occl_report = {}
    for name, m, order in units:
        above = [n for n, _, o in units if o > order and n != name]
        occl_report[name] = {"order": order, "n_parts_above": len(above)}
    rec["occluder_report"] = occl_report

    total_t0 = time.time()
    for name, m, order in units:
        def _one(name=name, m=m, order=order):
            others = occluders_of[name]
            ys, xs = np.nonzero(m)
            y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
            py = int((y1 - y0) * args.pad); px = int((x1 - x0) * args.pad)
            box = np.zeros((H, W), dtype=bool)
            box[max(0, y0 - py):min(H, y1 + py), max(0, x0 - px):min(W, x1 + px)] = True
            hole = others & box & (~m)
            if hole.sum() < 16:
                # 没有遮挡 → 直接出层（可见区就是全部）
                alpha = (m.astype(np.uint8)) * 255
                Image.fromarray(np.dstack([img, alpha])).save(os.path.join(ldir, f"{order:03d}_{name}.png"))
                return 0.0, 0, 0
            t0 = time.time()
            out = apply_inpaint(img, (hole.astype(np.uint8) * 255),
                                device=args.device, precision=torch.float32)
            if args.device == "mps":
                torch.mps.synchronize()
            dt = time.time() - t0
            alpha = ((m | hole).astype(np.uint8)) * 255
            Image.fromarray(np.dstack([out, alpha])).save(os.path.join(ldir, f"{order:03d}_{name}.png"))
            return dt, int(hole.sum()), 0


        r = stage(f"layer:{name}", _one)
        if r is None:
            rec["per_part"][name] = {"ok": False}
            continue
        dt, hole_px, _ = r
        rec["per_part"][name] = {"ok": True, "inpaint_s": round(dt, 2),
                                 "hole_px": hole_px, "visible_px": int(m.sum()),
                                 "order": order}

    rec["total_inpaint_s"] = round(time.time() - total_t0, 2)
    rec["rss_peak_mb"] = rss_mb()
    if args.device == "mps":
        rec["mps_current_allocated_mb"] = round(torch.mps.current_allocated_memory() / 1e6, 1)
        rec["mps_driver_allocated_mb"] = round(torch.mps.driver_allocated_memory() / 1e6, 1)
    rec["verdict"] = "跑通"
    rec["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")

    n = len([f for f in os.listdir(ldir) if f.endswith(".png")])
    rec["layer_files"] = n
    json.dump(rec, open(os.path.join(outdir, "result.json"), "w"), indent=2, ensure_ascii=False)
    print(f"\n结论：{rec['verdict']} | 出层 {n} 个 | 补全总耗时 {rec['total_inpaint_s']}s | RSS 峰值 {rec['rss_peak_mb']} MB")
    print(f"产出：{ldir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
