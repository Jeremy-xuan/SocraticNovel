#!/usr/bin/env python3
"""60_mouth_gate.py —— 「说话时嘴动」的产品级闸门

任务代号 MOUTH-FIX 步骤 ③。

## 判据（阈值写死在这里，报告直接引用本行）

    GATE_MIN_RENDER_PX = 20
    GATE_MAX_STATIC_POLLUTION_PX = 20

**在真渲染宿主里**（`clients/live2d-host` = 官方 Cubism 框架 + Cubism Core + WebGL，
不是 image2live2d 的近似软件光栅），把 `ParamMouthOpenY` 从 **0 驱动到 1**，
**渲染像素差 < 20 px 就报红**。

为什么是 20：**「说话时嘴动」是这个产品的核心特征**。
上一路实测的失准案例是 **5 px**（真立绘 19 px 嘴层：能力表全绿、`talk` 照常 shipped，画面只动 5 px）。
阈值取 20 是给"确有动作但极小"留一档余量，同时**远高于噪声底**
（本宿主自带的 `mouth-iso.cjs` 要求"改回闭合后 0 像素差"，实测可逆性判据为 0 px ⇒ 噪声底 = 0）。

🔴 **第二条判据（MOUTH-FIX-2 新增）：静止帧对照**。
在**不驱动任何参数**的前提下，把本模型的画面与「**同一套层集、只去掉嘴层**」的对照模型画面
逐像素比（口径与宿主探针一致：三通道最大差 > 8），要求
**落在「嘴窗口」之外的差异像素数 ≤ GATE_MAX_STATIC_POLLUTION_PX（20 px）**。

🔴 **为什么不是"差异必须为 0"**：本模型比对照模型**多一个嘴层**，静止帧下嘴本身就该被画出来
（我方立绘 918 px 的嘴 ⇒ 截图里 447 px 的差异）。所以"差异为 0"是**错的判据** ——
它会把"嘴正常显示"判成污染。真正要抓的是「**差异跑到嘴以外**」：上一轮那个坏嘴层
被 LaMA 重画成了整张脸的内容，它在静止帧里会让画面在**远离嘴的地方**与无嘴层模型不同。
嘴窗口 = 嘴层 alpha 的模型坐标 bbox × `截图宽 / 画布宽`（实测 720/1024 = 0.703125），
再外扩 `GATE_MOUTH_REGION_PAD`（2% 边长）容忍网格形变与抗锯齿。

这条判据的价值在于：**它不需要驱动任何参数就能抓出坏层**，与主判据正交。
用 `--control-nomouth <模型名>` 启用；不给就跳过（并在输出里如实标"未做"）。

## 这一道闸门要抓的是什么

不是"参数有没有"、也不是"能力表绿不绿"，而是**画面有没有动**。
所以它必须跑真渲染器、必须读**像素差**：
`mouth_open ✓` 与 `talk shipped` 都可能在"画面完全不动"的情况下成立（本轮实测 **0 px**）。

## 逐项输出

    mouth_layer_px      嘴层 alpha 像素数（i2l 改名目录里那个 `*_mouth.png`）
    sam_mouth_px        SAM 原始 `mouth` 掩码像素数（给了 --samdir 才有）→ 看补全膨胀比
    capability          i2l 能力表结论（`mouth_open` / `mouth_form` / `talk`）
    lipSyncIds          宿主从 model3.json 读到的口型参数（**空 = 根本驱动不了**）
    render_changed_px   真渲染器 0→1 档像素差
    gate                过 / 红

## 用法

    PY="${AUTO_LAYER_PY:-${AUTO_LAYER_SCRATCH:-$HOME/dsh-scratch/auto-layer}/venv/bin/python}"
    $PY scripts/60_mouth_gate.py --model mouthfix_ourasset
    $PY scripts/60_mouth_gate.py --model mouthfix_test1 --samdir out/sam/sam_mps_test1

退出码：**0 = 过闸**；**1 = 报红**；**2 = 环境/装载失败**（探测不到数，不当"过"）。

## 只读纪律

宿主 `clients/live2d-host/**` **一个字节都不改**：本脚本在 `out/host/` 下搭一个
**符号链接农场**当暂存区（bundle / Core / shaders / 样本模型全部链回原处），
只有 `demo.html` 是**拷一份到暂存区**再把模型名加进 `MODELS` 数组
（不改它没法用宿主自带的探针选中我们的模型；差异逐行打在 `stage_diff` 里，可审计）。
探针 `tools/mouth-iso.cjs` 原样调用，不改。
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                     # …/code/tools/auto-layer

# 🔴 node 走 PATH 解析（不硬编码 /opt/homebrew/bin/node）：不同机器上 node 可能来自
#    Homebrew / nvm / fnm / macports 等，写死绝对路径会让"能跑的机器"上本脚本直接失败。
#    解析不到就退回字面 "node"，让下面的 subprocess 报一个清晰的错误而非静默猜路径。
NODE = shutil.which("node") or "node"


HOST_REL = os.path.join("clients", "live2d-host")


def _host_dir(start):
    """向上找到**真正装着渲染宿主**的那个目录。

    🔴 判据不能只看目录名（实测踩过）：原工作区里存在一个**同名的空壳**
    `…/clients/live2d-host/`，所以"目录存在"不算数，必须**验证宿主的必备文件真的在**
    （`tools/mouth-iso.cjs`）。

    🔴 环境变量 `AUTO_LAYER_HOST` 优先（宿主搬走或另装一份时用它显式指定），
    否则从本脚本向上逐级找 `<祖先>/clients/live2d-host/tools/mouth-iso.cjs`。
    找不到就**响亮退出**，不做任何降级。
    """
    env = os.environ.get("AUTO_LAYER_HOST")
    if env:
        if not os.path.exists(os.path.join(env, "tools", "mouth-iso.cjs")):
            raise SystemExit(f"[FAIL] AUTO_LAYER_HOST={env} 里没有 tools/mouth-iso.cjs，不是渲染宿主")
        return os.path.abspath(env)
    p = start
    while p != os.path.dirname(p):
        cand = os.path.join(p, HOST_REL)
        if os.path.exists(os.path.join(cand, "tools", "mouth-iso.cjs")):
            return cand
        p = os.path.dirname(p)
    raise SystemExit(
        f"[FAIL] 从 {start} 向上找不到渲染宿主 {HOST_REL}（判据：要含 tools/mouth-iso.cjs）。\n"
        f"       本仓库的宿主在 <仓库根>/clients/live2d-host；\n"
        f"       它若在别处，用环境变量 AUTO_LAYER_HOST=<宿主目录> 显式指定。")


HOST = _host_dir(ROOT)
# 🔴 宿主必须**先构建**：`scripts/build.mjs` 会把 demo/demo.html 与 bundle/Core/shaders 复制到 out/。
#    未构建就**响亮退出**（不是"跳过闸门"）—— 闸门必须在真渲染器里跑，没有真渲染器就没有结论。
if not os.path.exists(os.path.join(HOST, "out", "demo.html")):
    raise SystemExit(
        f"[FAIL] 渲染宿主未构建：找不到 {os.path.join(HOST, 'out', 'demo.html')}\n"
        f"       先跑 `node clients/live2d-host/scripts/build.mjs`（它需要宿主的 vendor/ 与 samples/，\n"
        f"       这两样第三方资产**不随本仓库分发**）。\n"
        f"       闸门只认真渲染器的像素差；宿主不可用时**不出结论**，也不降级成软件光栅。")
STAGE = os.path.join(ROOT, "out", "host")

# 🔴🔴 闸门阈值 —— 报告直接引用这一行；不许当"可随时调低"的软参数 🔴🔴
GATE_MIN_RENDER_PX = 20          # 真渲染器 0→1 像素差低于此值即报红（单位：像素）
# 🔴 静止帧对照阈值（MOUTH-FIX-2 新增的第二条判据）：
#    静止帧（不驱动任何参数）下，本模型画面与「同层集去掉嘴层」的对照模型画面相比，
#    **落在「嘴窗口」之外**的差异像素数**不得超过**此值。
#    🔴 注意它数的是"**嘴窗口之外**"的差异，不是"全部差异" —— 因为本模型比对照模型
#       多一个嘴层，嘴本身在静止帧里就该被画出来（我方立绘：截图里 447 px 的差异）。
#       把"全部差异"当污染 = 把"嘴正常显示"判成坏层。
#    取 20：与主判据同量级；渲染器噪声底实测 = 0（可逆性判据逐例 0 px），
#    而"差异真的跑到嘴以外"（＝嘴层被画到别处去了）至少是这个量级。
GATE_MAX_STATIC_POLLUTION_PX = 20
# 静止帧对照的"允许差异窗口"外扩比例（相对整帧边长）：容忍网格形变与抗锯齿
GATE_MOUTH_REGION_PAD = 0.02
# 与宿主探针同一条差异判据：每像素取三通道最大差，> 8 记为一个差异像素
GATE_DIFF_CHANNEL = 8


def sha16(p):
    import hashlib
    return hashlib.sha256(open(p, "rb").read()).hexdigest()[:16]


def build_stage(models):
    """符号链接农场 + demo.html 的**唯一一处**改动（MODELS 数组）。幂等，每次重建。"""
    if os.path.isdir(STAGE):
        shutil.rmtree(STAGE)
    os.makedirs(os.path.join(STAGE, "out", "models"))
    os.makedirs(os.path.join(STAGE, "evidence"))
    for f in ("live2d-host.bundle.mjs", "live2dcubismcore.min.js"):
        os.symlink(os.path.join(HOST, "out", f), os.path.join(STAGE, "out", f))
    os.symlink(os.path.join(HOST, "out", "shaders"), os.path.join(STAGE, "out", "shaders"))
    src_models = os.path.join(HOST, "out", "models")
    for d in sorted(os.listdir(src_models)):
        os.symlink(os.path.join(src_models, d), os.path.join(STAGE, "out", "models", d))
    i2l_root = os.path.join(ROOT, "out", "i2l")
    staged_ours = []
    for d in sorted(os.listdir(i2l_root)) if os.path.isdir(i2l_root) else []:
        p = os.path.join(i2l_root, d)
        if os.path.isdir(p) and os.path.exists(os.path.join(p, f"{d}.model3.json")):
            os.symlink(p, os.path.join(STAGE, "out", "models", d))
            staged_ours.append(d)

    src_html = os.path.join(HOST, "out", "demo.html")
    text = open(src_html).read()
    m = re.search(r"const MODELS = \[[^\]]*\];", text)
    if not m:
        raise SystemExit("[FAIL] 找不到 demo.html 的 MODELS 数组，暂存区无法构建")
    have = set(re.findall(r"'([^']+)'", m.group(0)))
    extra, seen = [], set()
    for n in staged_ours + list(models):
        if n not in have and n not in seen:
            seen.add(n)
            extra.append(n)
    if extra:
        text = text.replace(m.group(0), m.group(0)[:-2] + "".join(f", '{n}'" for n in extra) + "];")
    dst_html = os.path.join(STAGE, "out", "demo.html")
    open(dst_html, "w").write(text)
    diff = subprocess.run(["diff", src_html, dst_html], capture_output=True, text=True).stdout
    return {"stage": STAGE, "staged_models": staged_ours,
            "host_demo_sha16": sha16(src_html), "stage_demo_sha16": sha16(dst_html),
            "stage_diff": diff.strip().splitlines()}


def mouth_layer_px(renamed_dir):
    if not os.path.isdir(renamed_dir):
        return None, None
    hits = [f for f in sorted(os.listdir(renamed_dir)) if f.endswith("_mouth.png")]
    if not hits:
        return 0, None
    a = np.array(Image.open(os.path.join(renamed_dir, hits[0])).convert("RGBA"))[..., 3]
    return int((a > 127).sum()), hits[0]


def sam_mouth_px(samdir):
    p = os.path.join(samdir, "masks", "08_mouth.png")
    if not os.path.exists(p):
        return None
    a = np.array(Image.open(p).convert("RGBA"))[..., 3]
    return int((a > 127).sum())


def run_probe(model, timeout=420):
    """原样调用宿主自带探针（只读）。返回 (probe_json, stdout, exit_code)。

    🔴 探针把证据写在**暂存区**里，而暂存区每次运行都重建 → 必须立刻把
    `mouthiso_<model>.json` 与三张 PNG 拷到 `out/probe/mouthiso_evidence/<model>/` 落盘，
    否则下一次跑别的模型就把上一次的证据冲掉（实测踩过：接触表只剩最后一个模型）。
    """
    cmd = [NODE, os.path.join(HOST, "tools", "mouth-iso.cjs"), model, f"--host={STAGE}"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    jf = os.path.join(STAGE, "evidence", f"mouthiso_{model}.json")
    probe = json.load(open(jf)) if os.path.exists(jf) else None
    keep = os.path.join(ROOT, "out", "probe", "mouthiso_evidence", model)
    if probe is not None:
        os.makedirs(keep, exist_ok=True)
        for f in os.listdir(os.path.join(STAGE, "evidence")):
            if f.startswith(f"mouthiso_{model}"):
                shutil.copy2(os.path.join(STAGE, "evidence", f), os.path.join(keep, f))
    return probe, r.stdout, r.returncode


def _decode_png(buf):
    """极简 PNG 解码（与宿主探针同一套：只吃 8bit RGB/RGBA，无交错）。

    为什么自己解而不是装库：**不许新增依赖**；宿主探针里已经有一份逐字实现，
    这里照它的口径重写，保证两边判据一致（每像素取三通道最大差）。
    """
    import struct
    import zlib
    off, width, height, color_type, idat = 8, 0, 0, 0, []
    while off < len(buf):
        ln = struct.unpack(">I", buf[off:off + 4])[0]
        typ = buf[off + 4:off + 8]
        d = buf[off + 8:off + 8 + ln]
        if typ == b"IHDR":
            width, height, _, color_type = struct.unpack(">IIBB", d[:10])
        elif typ == b"IDAT":
            idat.append(d)
        elif typ == b"IEND":
            break
        off += 12 + ln
    ch = 4 if color_type == 6 else 3
    raw = zlib.decompress(b"".join(idat))
    stride = width * ch
    out = bytearray(height * stride)
    pos = 0
    for y in range(height):
        f = raw[pos]; pos += 1
        line = raw[pos:pos + stride]; pos += stride
        base = y * stride
        prev = base - stride
        for x in range(stride):
            a = out[base + x - ch] if x >= ch else 0
            b = out[prev + x] if y > 0 else 0
            c = out[prev + x - ch] if (y > 0 and x >= ch) else 0
            v = line[x]
            if f == 1:
                v += a
            elif f == 2:
                v += b
            elif f == 3:
                v += (a + b) >> 1
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                v += a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
            out[base + x] = v & 255
    return {"width": width, "height": height, "channels": ch, "data": bytes(out)}


def frame_diff(pa, pb, inset=3, channel=GATE_DIFF_CHANNEL, region=None):
    """两张整帧截图之间的差异（口径与宿主探针逐字一致：三通道最大差 > channel）。

    返回 (changed_px, bbox, outside_region_px)。

    `region=(x0, y0, x1, y1)` 给定时，额外数出**落在该区域之外**的差异像素数 ——
    这是「静止帧对照」判据真正要用的量（见 `static_frame_control` 的说明）。
    """
    A, B = _decode_png(open(pa, "rb").read()), _decode_png(open(pb, "rb").read())
    if (A["width"], A["height"]) != (B["width"], B["height"]):
        raise SystemExit(f"[FAIL] 两张帧尺寸不一致：{pa} {A['width']}x{A['height']} vs "
                         f"{pb} {B['width']}x{B['height']}")
    changed, outside = 0, 0
    min_x, min_y, max_x, max_y = A["width"], A["height"], -1, -1
    for y in range(inset, A["height"] - inset):
        for x in range(inset, A["width"] - inset):
            ia = (y * A["width"] + x) * A["channels"]
            ib = (y * B["width"] + x) * B["channels"]
            d = max(abs(A["data"][ia + k] - B["data"][ib + k]) for k in range(3))
            if d > channel:
                changed += 1
                if x < min_x:
                    min_x = x
                if y < min_y:
                    min_y = y
                if x > max_x:
                    max_x = x
                if y > max_y:
                    max_y = y
                if region is not None and not (region[0] <= x <= region[2]
                                               and region[1] <= y <= region[3]):
                    outside += 1
    bbox = None if max_x < 0 else {"minX": min_x, "minY": min_y, "maxX": max_x, "maxY": max_y,
                                   "w": max_x - min_x + 1, "h": max_y - min_y + 1}
    return changed, bbox, outside


def mouth_screen_region(model, renamed, frame_w, frame_h):
    """把嘴层的**模型坐标 bbox** 换算到**截图坐标**，得到一个"允许出现差异的窗口"。

    🔴 为什么需要它：静止帧下本模型比对照模型**多一个嘴层**，所以两张图在嘴的位置上
    **本来就该有差异**（那就是嘴本身）。要抓的不是"有差异"，而是"**差异跑到嘴以外去了**"
    —— 那才是「嘴层污染静止姿态」（上一轮那种把整张脸重画进嘴层的情况）。

    换算比例：i2l 出的 `.model3.json` 里写着画布尺寸，截图是宿主把整幅模型缩放到
    720×720 视口后的结果 ⇒ `scale = frame_w / canvas_w`（我方立绘 1024 → 720，实测
    `720/1024 = 0.703125`，与"嘴层 bbox 宽度 44 px → 截图差异 bbox 宽 31 px"吻合）。
    窗口再外扩 `GATE_MOUTH_REGION_PAD` 比例，容忍网格形变与抗锯齿。

    返回 (region, detail)；拿不到嘴层或画布尺寸时返回 (None, detail)，此时退化成
    "整帧即允许区"（判据仍成立，只是更严）。
    """
    mouth_files = [f for f in sorted(os.listdir(renamed)) if f.endswith("_mouth.png")] \
        if os.path.isdir(renamed) else []
    if not mouth_files:
        return None, {"why": f"在 {renamed} 里找不到 *_mouth.png ⇒ 允许区退化为整帧（判据更严）"}
    mp = os.path.join(renamed, mouth_files[0])
    im = Image.open(mp).convert("RGBA")
    cw = float(im.size[0])          # 画布宽 = 源层 PNG 的宽（i2l 直接沿用源画布）
    a = np.array(im)[..., 3] > 127
    ys, xs = np.nonzero(a)
    if len(ys) == 0:
        return None, {"why": "嘴层 alpha 全空"}
    sc = frame_w / cw
    pad = GATE_MOUTH_REGION_PAD
    x0 = int(xs.min() * sc - pad * frame_w)
    y0 = int(ys.min() * sc - pad * frame_h)
    x1 = int(xs.max() * sc + pad * frame_w)
    y1 = int(ys.max() * sc + pad * frame_h)
    return (max(0, x0), max(0, y0), min(frame_w - 1, x1), min(frame_h - 1, y1)), {
        "mouth_model_bbox": [int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())],
        "canvas_w": cw, "scale": round(sc, 6), "pad_frac": pad,
        "region": [max(0, x0), max(0, y0), min(frame_w - 1, x1), min(frame_h - 1, y1)]}


def static_frame_control(model, control, renamed):
    """静止帧对照：本模型 vs「同层集去掉嘴层」的对照模型，**都不驱动任何参数**。

    🔴 判据（MOUTH-FIX-2 新增）：**差异必须落在嘴自己的位置上**。

    为什么不是"差异必须为 0"：本模型比对照模型**多一个嘴层**，静止帧下嘴本身就该被画出来
    （我方立绘 918 px 的嘴 ⇒ 截图里 400 多 px 的差异）。所以"差异为 0"是**错的判据**，
    它会把"嘴正常显示"判成污染。

    真正要抓的是「**差异跑到嘴以外**」——上一轮那个坏嘴层的表现就是被 LaMA 重画成
    整张脸的内容，它在静止帧里会让画面在**远离嘴的地方**与无嘴层模型不同。
    所以判据是：**落在"嘴层 bbox 换算到截图后的窗口"之外的差异像素数 ≤ GATE_MAX_STATIC_POLLUTION_PX**。

    返回 (outside_px, bbox, detail)。
    """
    if not control:
        return None, None, {"skipped": "没有给 --control-nomouth，跳过静止帧对照"}
    ctrl_probe, raw, rc = run_probe(control)
    if ctrl_probe is None:
        return None, None, {"error": f"对照模型 {control} 的探针没产出 JSON（退出码 {rc}）",
                            "raw_tail": raw[-800:]}
    a = os.path.join(ROOT, "out", "probe", "mouthiso_evidence", model,
                     f"mouthiso_{model}_closed.png")
    b = os.path.join(ROOT, "out", "probe", "mouthiso_evidence", control,
                     f"mouthiso_{control}_closed.png")
    if not (os.path.exists(a) and os.path.exists(b)):
        return None, None, {"error": f"静止帧截图缺失：{a} / {b}"}
    A = _decode_png(open(a, "rb").read())
    region, rdetail = mouth_screen_region(model, renamed, A["width"], A["height"])
    n, bb, outside = frame_diff(a, b, region=region)
    return outside, bb, {"control": control, "full_closed": a, "control_closed": b,
                         "diff_channel": GATE_DIFF_CHANNEL,
                         "changed_px_total": n, "allowed_region": region,
                         "region_detail": rdetail}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="out/i2l/<model>/ 下的模型名")
    ap.add_argument("--renamed", default=None, help="i2l 改名目录，默认 out/layers_i2l/<model>")
    ap.add_argument("--samdir", default=None, help="可选：SAM 输出目录，用来报 SAM mouth 原始 px")
    ap.add_argument("--control-nomouth", default=None,
                    help="可选：**同一套层集去掉嘴层**的对照模型名（静止帧对照用）。"
                         "给了它就会多跑一条判据：静止帧下本模型与它的差异像素数"
                         f"不得超过 GATE_MAX_STATIC_POLLUTION_PX={GATE_MAX_STATIC_POLLUTION_PX}")
    ap.add_argument("--json", default=None, help="把逐项数字另存一份 JSON")
    args = ap.parse_args()

    renamed = args.renamed or os.path.join(ROOT, "out", "layers_i2l", args.model)
    wire = os.path.join(ROOT, "out", "i2l", f"{args.model}_wire.json")

    stage_info = build_stage([args.model])
    px, layerfile = mouth_layer_px(renamed)
    sam_px = sam_mouth_px(args.samdir) if args.samdir else None

    caps = {}
    if os.path.exists(wire):
        w = json.load(open(wire))
        caps = w.get("capabilities", {})
    cap_ok = caps.get("capabilities", {})
    clips = caps.get("clips", {})

    probe, raw, rc = run_probe(args.model)
    if probe is None:
        print(f"[FAIL] 宿主探针没产出 JSON（退出码 {rc}）——环境/装载失败，不当'过'")
        print(raw[-3000:])
        return 2
    changed = probe["closedVsOpen"]["changedPixels"]
    # 探针把 CubismId 对象 JSON 化后是 {"_id": "ParamMouthOpenY"}；兼容 dict 与对象两种形态
    def _pid(i):
        if isinstance(i, dict):
            return i.get("_id") or i.get("id") or str(i)
        return getattr(i, "_id", None) or getattr(i, "id", None) or str(i)
    lip = [_pid(i) for i in probe.get("lipSyncIds", [])]

    # ── 判据②：静止帧对照（不驱动任何参数） ───────────────────────────────────
    static_px, static_bbox, static_detail = static_frame_control(
        args.model, args.control_nomouth, renamed)
    static_checked = static_px is not None
    static_ok = (not static_checked) or (static_px <= GATE_MAX_STATIC_POLLUTION_PX)

    passed = (changed >= GATE_MIN_RENDER_PX and len(lip) > 0 and static_ok)

    rec = {
        "model": args.model,
        "renamed_dir": renamed,
        "mouth_layer_px": px,
        "mouth_layer_file": layerfile,
        "sam_mouth_px": sam_px,
        "inflation_vs_sam": round(px / sam_px, 3) if (px and sam_px) else None,
        "capability": {"mouth_open": cap_ok.get("mouth_open"),
                       "mouth_form": cap_ok.get("mouth_form"),
                       "talk": "shipped" if "talk" in clips.get("shipped", []) else "suppressed"},
        "lipSyncIds": lip,
        "render_changed_px": changed,
        "render_bbox": probe["closedVsOpen"]["bbox"],
        "render_reversible_px": probe["closedVsClosedAgain"]["changedPixels"],
        "gate_min_render_px": GATE_MIN_RENDER_PX,
        "static_control_px": static_px,
        "static_control_bbox": static_bbox,
        "static_control_detail": static_detail,
        "gate_max_static_pollution_px": GATE_MAX_STATIC_POLLUTION_PX,
        "static_control_checked": static_checked,
        "static_control_ok": static_ok,
        "gate": "过" if passed else "红",
        "probe_exit": rc,
        "stage": stage_info,
        "probe_files": probe["files"],
    }
    if args.json:
        json.dump(rec, open(args.json, "w"), indent=2, ensure_ascii=False)

    print(f"=== MOUTH 闸门 | {args.model} | 阈值 GATE_MIN_RENDER_PX={GATE_MIN_RENDER_PX} "
          f"| 静止帧上限 GATE_MAX_STATIC_POLLUTION_PX={GATE_MAX_STATIC_POLLUTION_PX} ===")
    print(f"  嘴层（{layerfile or '无'}）                : {px} px" +
          (f"   （SAM 原始 mouth {sam_px} px → 补全后 ×{rec['inflation_vs_sam']}）" if sam_px else ""))
    print(f"  能力表 i2l                            : mouth_open={rec['capability']['mouth_open']} "
          f"mouth_form={rec['capability']['mouth_form']} talk={rec['capability']['talk']}")
    print(f"  宿主读到的口型参数 lipSyncIds          : {lip or '（空 —— 模型里没有可驱动的口型参数）'}")
    print(f"  真渲染器 ParamMouthOpenY 0→1 像素差   : {changed} px"
          + (f"   bbox={rec['render_bbox']}" if rec["render_bbox"] else ""))
    print(f"  可逆性（改回 0 档）像素差              : {probe['closedVsClosedAgain']['changedPixels']} px")
    if static_checked:
        tot = static_detail.get("changed_px_total")
        reg = static_detail.get("allowed_region")
        print(f"  静止帧对照（vs {static_detail.get('control')}，不驱动参数）"
              f": 差异 {tot} px，其中**落在嘴窗口外** {static_px} px"
              + (f"   嘴窗口={list(reg)}" if reg else "   嘴窗口=整帧（更严）")
              + f"   {'✅ 合格' if static_ok else '🔴 不合格（嘴层污染静止姿态）'}")
    else:
        print(f"  静止帧对照                            : 未做（{static_detail.get('skipped') or static_detail.get('error')}）")
    print(f"  闸门                                   : {'✅ 过' if passed else '🔴 红'}"
          f"（判据：渲染像素差 ≥ {GATE_MIN_RENDER_PX} px 且口型参数存在"
          f"{f' 且静止帧差异 ≤ {GATE_MAX_STATIC_POLLUTION_PX} px' if static_checked else ''}）")
    if not passed:
        why = []
        if not lip:
            why.append("模型里没有 LipSync 参数 → 宿主根本驱动不了嘴")
        if changed < GATE_MIN_RENDER_PX:
            why.append(f"驱动了但画面只动 {changed} px < {GATE_MIN_RENDER_PX} px")
        if not static_ok:
            why.append(f"静止帧下「嘴窗口之外」的差异 {static_px} px > "
                       f"{GATE_MAX_STATIC_POLLUTION_PX} px → 嘴层污染了静止姿态")
        print(f"  报红原因                               : {'；'.join(why)}")
    print(f"  暂存区 {STAGE}（宿主原文件零改动；demo.html 差异 {len(stage_info['stage_diff'])} 行）")
    for l in stage_info["stage_diff"]:
        print(f"    {l}")
    print(f"  探针原始输出                           : {os.path.join(STAGE, 'evidence', f'mouthiso_{args.model}.json')}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
