#!/usr/bin/env python3
"""50_wire_mouth_to_i2l.py —— 把「嘴层」接进 image2live2d，回答"能不能表达说话时嘴动"

任务代号 LAYER-MOUTH 步骤 ③。

做的事（**A/B 对照**，两套层只差一个 `mouth` 文件）：
  A 组 = 本目录 20_make_layers_with_mouth.py 出的层，**含 mouth**
  B 组 = 同一批层，**去掉 mouth**（= 上一路 12 层的等价物）
两组各自跑同一条 image2live2d 管线，然后对照：
  ① `rig_capabilities()` 的能力表（重点看 `mouth_open` / `mouth_form`）
  ② `deform_at(rig, 'ParamMouthOpenY', 1.0)` 的顶点位移（数值证据）
  ③ `preview.render_pose()` 在 ParamMouthOpenY=0/1 两档各渲一张 → 目视证据
  ④ `Live2DEmitter` + `native_moc_writer` → 真 `.moc3`

🔴 只读复用：`/tmp/p2l2/src/image2live2d-main`（P2L-2 的产物）与 auto-layer 的层。
   本脚本不改这两棵树中的任何文件。

用法：
  PY=/Library/Frameworks/Python.framework/Versions/3.13/bin/python3
  PYTHONPATH=/tmp/p2l2/src/image2live2d-main/src \
    $PY scripts/50_wire_mouth_to_i2l.py --layerdir out/layers/ourasset_above/layers --tag ourasset
"""
import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
MOUTH_ROOT = HERE.parent
OUT = MOUTH_ROOT / "out"
EVID = MOUTH_ROOT / "evidence"
I2L_SRC = Path("/tmp/p2l2/src/image2live2d-main/src")

# 本轮层的文件名 → i2l 的 {order}_{SemanticRole}
ROLE_MAP = {
    "120_hair.png": ("120_hair_front.png", "hair_front"),
    "020_topwear.png": ("020_torso.png", "torso"),
    "025_neck.png": ("025_neck.png", "neck"),
    "030_face.png": ("030_face_base.png", "face_base"),
    "045_nose.png": ("045_nose.png", "nose"),
    "050_mouth.png": ("040_mouth.png", "mouth"),
    "055_eyes_l.png": ("050_eye_l.png", "eye_l"),
    "055_eyes_r.png": ("050_eye_r.png", "eye_r"),
    "012_legwear_l.png": ("012_leg_l.png", "leg_l"),
    "012_legwear_r.png": ("012_leg_r.png", "leg_r"),
    "015_bottomwear.png": ("015_clothing.png", "clothing"),
    "065_handwear_l.png": ("065_arm_l.png", "arm_l"),
    "065_handwear_r.png": ("065_arm_r.png", "arm_r"),
    "055_ears.png": ("055_ear_l.png", "ear_l"),
}


def sha16(p):
    import hashlib
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()[:16]


def build_renamed(src: Path, dst: Path, drop=()):
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)
    written, skipped = [], []
    for f in sorted(os.listdir(src)):
        if not f.endswith(".png"):
            continue
        if f in drop:
            skipped.append({"file": f, "why": "对照组主动剔除"})
            continue
        if f not in ROLE_MAP:
            skipped.append({"file": f, "why": "本脚本没有对应的 i2l 角色映射"})
            continue
        name, role = ROLE_MAP[f]
        shutil.copy2(src / f, dst / name)
        written.append({"file": name, "from": f, "role": role, "sha16": sha16(dst / name)})
    return written, skipped


def crop_face(img: Image.Image, frac_box=(0.22, 0.05, 0.78, 0.55)):
    w, h = img.size
    x0, y0, x1, y1 = frac_box
    return img.crop((int(w * x0), int(h * y0), int(w * x1), int(h * y1)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layerdir", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--i2l", default=str(I2L_SRC))
    ap.add_argument("--res", type=int, default=768)
    args = ap.parse_args()

    i2l = Path(args.i2l)
    if not i2l.is_dir():
        print(f"[FAIL] 找不到 image2live2d 源码：{i2l}", file=sys.stderr)
        return 2
    sys.path.insert(0, str(i2l))

    from image2live2d.backends.live2d import Live2DEmitter
    from image2live2d.backends.live2d.moc3_emit import native_moc_writer
    from image2live2d.core import decompose
    from image2live2d.core.qa import check as qa_check
    from image2live2d.core.qa import rig_capabilities
    from image2live2d.pipeline import rig_from_stack
    from image2live2d.preview import render_pose

    src = Path(args.layerdir)
    rec = {"script": "50_wire_mouth_to_i2l.py", "tag": args.tag, "layerdir": str(src),
           "i2l_src": str(i2l), "res": args.res,
           "started": time.strftime("%Y-%m-%d %H:%M:%S"), "runs": {}}

    results = {}
    for variant, drop in (("with_mouth", ()), ("no_mouth", ("050_mouth.png",))):
        print(f"\n===== 变体 {variant}（剔除 {list(drop)}）=====")
        ldir = OUT / "i2l_in" / f"{args.tag}_{variant}"
        written, skipped = build_renamed(src, ldir, drop=drop)
        print(f"  层文件 {len(written)} 个：{[w['file'] for w in written]}")

        stack = decompose.from_layer_dir(str(ldir))
        rig = rig_from_stack(stack, name=f"{args.tag}_{variant}", source=str(ldir))
        caps = rig_capabilities(rig)
        issues = qa_check(rig)
        roles = sorted({p.semantic_role.value for p in rig.parts})

        print(caps.format())
        if issues:
            for it in issues:
                print(f"  [QA {getattr(it, 'severity', '?')}] {getattr(it, 'code', '?')}: "
                      f"{str(getattr(it, 'message', it))[:160]}")

        # 数值证据：ParamMouthOpenY 在 0 与 1 两档时，各部件相对静止网格的最大顶点位移
        # 🔴 i2l 的嘴部设计（读 core/rig/author.py 的 _mouth_open）：嘴唇在 1 档张开成透镜形；
        #    合成腔体反过来 —— 0 档被垂直压扁成零（闭嘴时看不见），1 档回到静止位置。
        #    所以"腔体在 1 档位移为 0"是**对的**，必须两档一起看才不误判。
        moved = {}
        if any(p.id == "ParamMouthOpenY" for p in rig.parameters):
            from image2live2d.core.qa import deform_at
            for val in (0.0, 1.0):
                d = deform_at(rig, "ParamMouthOpenY", val)
                for part_id, verts in d.items():
                    part = next((p for p in rig.parts if p.id == part_id), None)
                    mesh = rig.mesh_for(part_id)
                    if mesh is None or part is None:
                        continue
                    base = np.array(mesh.vertices, dtype=float)
                    cur = np.array(verts, dtype=float)
                    disp = float(np.sqrt(((cur - base) ** 2).sum(axis=1)).max())
                    e = moved.setdefault(part_id, {"role": part.semantic_role.value,
                                                   "n_vertices": len(verts)})
                    e[f"max_disp_at_{val:g}"] = round(disp, 6)
            print(f"  ParamMouthOpenY 位移：{json.dumps(moved, ensure_ascii=False)}")
        else:
            print("  ⚠ 没有 ParamMouthOpenY 参数")

        # 目视证据：渲染 0 / 1 两档
        renders = {}
        try:
            for label, val in (("closed", 0.0), ("open", 1.0)):
                img = render_pose(stack, rig.meshes, rig.parameters,
                                  {"ParamMouthOpenY": val}, res=args.res)
                p = EVID / f"50_{args.tag}_{variant}_mouth_{label}.png"
                img.save(p)
                renders[label] = str(p.relative_to(MOUTH_ROOT))
            # 脸部裁剪对照
            a = crop_face(Image.open(EVID / f"50_{args.tag}_{variant}_mouth_closed.png").convert("RGBA"))
            b = crop_face(Image.open(EVID / f"50_{args.tag}_{variant}_mouth_open.png").convert("RGBA"))
            k = 2
            W = a.width * k * 2 + 12
            H = a.height * k
            sheet = Image.new("RGBA", (W, H), (24, 24, 24, 255))
            sheet.paste(a.resize((a.width * k, a.height * k), Image.NEAREST), (0, 0), a.resize((a.width * k, a.height * k), Image.NEAREST))
            sheet.paste(b.resize((b.width * k, b.height * k), Image.NEAREST), (a.width * k + 12, 0), b.resize((b.width * k, b.height * k), Image.NEAREST))
            sp = EVID / f"50_{args.tag}_{variant}_face_closed_vs_open_x{k}.png"
            sheet.convert("RGB").save(sp)
            renders["face_closed_vs_open"] = str(sp.relative_to(MOUTH_ROOT))
            # 像素差
            import numpy as np2
            arr0 = np2.array(Image.open(EVID / f"50_{args.tag}_{variant}_mouth_closed.png").convert("RGBA")).astype(int)
            arr1 = np2.array(Image.open(EVID / f"50_{args.tag}_{variant}_mouth_open.png").convert("RGBA")).astype(int)
            diff = (np2.abs(arr0 - arr1).max(axis=2) > 8)
            renders["changed_pixels"] = int(diff.sum())
            if diff.sum():
                ys, xs = np2.nonzero(diff)
                renders["changed_bbox_xyxy"] = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
            print(f"  渲染像素差：{renders['changed_pixels']} px  bbox={renders.get('changed_bbox_xyxy')}")
        except Exception as e:  # noqa: BLE001
            renders["error"] = f"{type(e).__name__}: {e}"
            print(f"  [渲染失败] {type(e).__name__}: {e}")

        # 真出 .moc3
        dest = OUT / "i2l" / f"{args.tag}_{variant}"
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True)
        moc_info = {}
        try:
            bundle = Live2DEmitter(asset_root=ldir, moc_writer=native_moc_writer).build(rig, dest)
            moc = Path(str(getattr(bundle, "moc3_path", "") or ""))
            if not moc.is_file():
                cands = list(dest.glob("*.moc3"))
                moc = cands[0] if cands else None
            if moc and moc.is_file():
                head = moc.read_bytes()[:8]
                moc_info = {"path": str(moc), "bytes": moc.stat().st_size,
                            "head_hex": head.hex().upper(), "moc_written": bool(getattr(bundle, "moc_written", False))}
                print(f"  ✅ .moc3 = {moc_info['bytes']} B  头 {moc_info['head_hex']}")
        except Exception as e:  # noqa: BLE001
            moc_info = {"error": f"{type(e).__name__}: {e}"}
            print(f"  [moc3 失败] {type(e).__name__}: {e}")

        results[variant] = {
            "layers": written, "skipped": skipped,
            "n_layers": len(written),
            "roles": roles,
            "has_mouth_role": "mouth" in roles,
            "has_mouth_cavity_role": "mouth_cavity" in roles,
            "parts": len(rig.parts), "textures": len(rig.textures),
            "parameters": [p.id for p in rig.parameters],
            "physics": len(rig.physics), "animations": len(rig.animations),
            "capabilities": caps.to_dict(),
            "qa_issues": [{"severity": str(getattr(i, "severity", "?")),
                           "code": str(getattr(i, "code", "?")),
                           "message": str(getattr(i, "message", i))} for i in issues],
            "mouth_open_moved_parts": moved,
            "renders": renders,
            "moc3": moc_info,
        }

    # 对照表
    A, B = results["with_mouth"], results["no_mouth"]
    rec["compare"] = {
        "mouth_open": {"with_mouth": A["capabilities"]["capabilities"].get("mouth_open"),
                       "no_mouth": B["capabilities"]["capabilities"].get("mouth_open")},
        "mouth_form": {"with_mouth": A["capabilities"]["capabilities"].get("mouth_form"),
                       "no_mouth": B["capabilities"]["capabilities"].get("mouth_form")},
        "notes": {"with_mouth": A["capabilities"]["notes"], "no_mouth": B["capabilities"]["notes"]},
        "changed_pixels": {"with_mouth": A["renders"].get("changed_pixels"),
                           "no_mouth": B["renders"].get("changed_pixels")},
    }
    rec["runs"] = results
    rec["verdict"] = ("含嘴层可表达嘴型" if A["capabilities"]["capabilities"].get("mouth_open")
                      else "含嘴层仍不能表达嘴型")
    rec["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
    os.makedirs(OUT, exist_ok=True)
    json.dump(rec, open(OUT / f"50_wire_mouth_{args.tag}.json", "w"), indent=2, ensure_ascii=False)

    print("\n===== A/B 对照 =====")
    for k, v in rec["compare"].items():
        print(f"  {k}: {json.dumps(v, ensure_ascii=False)}")
    print(f"结论：{rec['verdict']}")
    print(f"落盘：{OUT / f'50_wire_mouth_{args.tag}.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
