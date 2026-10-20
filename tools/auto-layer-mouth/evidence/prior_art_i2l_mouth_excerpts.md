# 先例摘录 · image2live2d 的「嘴」支持（逐字原文，带 sha256）

> 本件是 `实现报告_LAYER-MOUTH_嘴与关键部件_2026-09-24.md` 的**稳定证据件**。
> 源树在 `/tmp/p2l2/src/image2live2d-main/`（P2L-2 的产物，本任务**只读未改**）—— `/tmp` 会被清，
> 所以把逐字原文抄到这里，锚点指向本件。每段都给出源文件路径、sha256 前 16 位、行号。

> 采集时间：2026-09-24 19:40:37｜采集脚本：`code/tools/auto-layer-mouth/scripts/70_collect_i2l_excerpts.py`

## 版本表（源文件）

| V | 文件（相对 i2l 根） | sha256 前 16 位 |
|---|---|---|
| V1 | irr/schema.py | 97356758f404a6a1 |
| V2 | irr/params.py | 50686c5a60977ffc |
| V3 | core/qa/capability.py | 4862ee23b9185507 |
| V4 | core/synth/mouth.py | 4e5ab34650a4bb7b |
| V5 | core/rig/author.py | 7a4009eec6483a9c |
| V6 | backends/live2d/mapping.py | 17c1e5f08f506101 |
| V7 | core/motion/drive.py | e07c1bc27c481c1c |
| V8 | core/qa/harness.py | 19d345d8cebe1882 |
| V9 | core/landmark/extract.py | bbb5b1127c789e1b |
| V10 | pipeline.py | 1bbfbefa846f8479 |

## 摘录表

| 锚点 | 说明 | 版本 | 行 | 片段 |
|---|---|---|---|---|
| E01 | SemanticRole 枚举里**本来就有** mouth / mouth_cavity / eyebrow_l/r / eye_white_l/r / pupil_l/r / blush / nose | V1 | 41 | `eye_l = "eye_l"` |

### 〔E01〕 irr/schema.py:41-62　SemanticRole / 角色枚举

```python
   41|     eye_l = "eye_l"
   42|     eye_r = "eye_r"
   43|     eye_white_l = "eye_white_l"
   44|     eye_white_r = "eye_white_r"
   45|     pupil_l = "pupil_l"
   46|     pupil_r = "pupil_r"
   47|     eye_closed_l = "eye_closed_l"  # synthesised closed-eye lash line — see core.synth.eye
   48|     eye_closed_r = "eye_closed_r"
   49|     nose = "nose"
   50|     mouth = "mouth"
   51|     mouth_cavity = "mouth_cavity"  # synthesised interior behind the lips — see core.synth.mouth
   52|     ear_l = "ear_l"
   53|     ear_r = "ear_r"
   54|     blush = "blush"
   55|     # Body
   56|     neck = "neck"
   57|     torso = "torso"
   58|     arm_l = "arm_l"
   59|     arm_r = "arm_r"
   60|     hand_l = "hand_l"
   61|     hand_r = "hand_r"
   62|     leg_l = "leg_l"
```

| E02 | 标准参数表里的 ParamMouthForm / ParamMouthOpenY（含范围与默认值） | V2 | 34 | `("ParamBrowRForm", -1.0, 1.0, 0.0),` |

### 〔E02〕 irr/params.py:34-38　标准参数表

```python
   34|     ("ParamBrowRForm", -1.0, 1.0, 0.0),
   35|     # Mouth
   36|     ("ParamMouthForm", -1.0, 1.0, 0.0),
   37|     ("ParamMouthOpenY", 0.0, 1.0, 0.0),
   38|     # Cheek — fades a synthesised blush overlay in (opacity 0 at rest); see core.synth.blush
```

| E03 | 能力发现判据：mouth_open 需要 ParamMouthOpenY **且** 有 mouth_cavity 角色 | V3 | 108 | `# A mouth can open only if it has an interior behind the lips (decomposed or synthesised). The lip` |

### 〔E03〕 core/qa/capability.py:108-117　能力发现

```python
  108| 
  109|     # A mouth can open only if it has an interior behind the lips (decomposed or synthesised). The lip
  110|     # param on its own just parts a stroke over skin — see core.synth.mouth.
  111|     mouth_open = has_p("ParamMouthOpenY")
  112|     has_cavity = has_r(SemanticRole.mouth_cavity)
  113|     caps.append(Capability("mouth_open", mouth_open and has_cavity,
  114|                            "has interior" if has_cavity else "lip line only"))
  115|     caps.append(Capability("mouth_form", has_p("ParamMouthForm")))
  116| 
  117|     expr = {"smile", "surprise", "sad", "angry"}
```

| E04 | 没有腔体时的诚实告警文案（"talk only parts the lip line"） | V3 | 135 | `if not has_p("ParamLegLA") and not has_p("ParamLegRA"):` |

### 〔E04〕 core/qa/capability.py:135-137　能力发现

```python
  135|     if not has_p("ParamLegLA") and not has_p("ParamLegRA"):
  136|         notes.append("no leg articulation — legs were not separated")
  137|     if mouth_open and not has_cavity:
```

| E05 | 为什么必须合成腔体：拆出来的嘴层只是唇线，后面没有东西 | V4 | 1 | `"""Synthesise the inside of the mouth.` |

### 〔E05〕 core/synth/mouth.py:1-20　嘴腔合成

```python
    1| """Synthesise the inside of the mouth.
    2| 
    3| A decomposed mouth layer is only the *lip line* — on a real character it came out 21x6 px, 118 opaque
    4| pixels: a thin closed-smile stroke. There is nothing behind it. So ``ParamMouthOpenY`` deformed the
    5| lips correctly (the P5 lens: lower lip drops, upper lip rises, corners stay anchored) and yet the mouth
    6| never *opened*, because parting a stroke over bare skin just reveals more skin. You cannot open a mouth
    7| that has no interior.
    8| 
    9| Hand-drawn rigs get an inner-mouth layer for free — the artist paints the cavity (and often teeth and a
   10| tongue) behind the lips. An auto-rigger has to make one. This module paints a cavity from the lip
   11| line's own geometry and colour, inserts it as a part just under the lips, and lets the rig drive it:
   12| collapsed to nothing while the mouth is shut (so a closed mouth is exactly the lip line it always was),
   13| opening into a lens as ``ParamMouthOpenY`` rises.
   14| 
   15| Deliberately conservative:
   16| 
   17| * The cavity is **derived from the lip line**, never invented — its width, position and hue all come
   18|   from the mouth layer's own pixels, so it cannot clash with the character's palette.
   19| * It is **hidden at rest**. A rig whose mouth stays shut renders identically to one with no cavity at
   20|   all, so this can never make a closed mouth look worse.
```

| E06 | 腔体尺寸取自嘴层的**宽度**（不是高度）＋ 三种色调 | V4 | 36 | `_CAVITY_H_FRAC = 0.55        # cavity height as a fraction of mouth width — matches the lip lens opening` |

### 〔E06〕 core/synth/mouth.py:36-53　嘴腔合成

```python
   36| _CAVITY_H_FRAC = 0.55        # cavity height as a fraction of mouth width — matches the lip lens opening
   37| # Inset from the lip line's width — the corners of a mouth close before its centre does.
   38| _CAVITY_W_INSET = 0.10
   39| # The lips part about their own line, so the cavity has to straddle it: mostly below (the jaw drops),
   40| # but far enough above to back the upper lip's smaller rise.
   41| _CAVITY_RISE_FRAC = 0.25
   42| 
   43| # The three tones of an open anime mouth, all struck from the lip line's own hue so the interior can
   44| # never fall outside the character's palette: a dark hollow, a bright band of upper teeth just under the
   45| # lip, and a warmer tongue filling the floor. (saturation, value) per tone.
   46| _TONE_CAVITY = (0.66, 0.28)   # the hollow: much darker than the lips — most of an open mouth is shadow,
   47| #                               and the teeth only read as teeth against something dark
   48| _TONE_TEETH = (0.05, 0.98)    # near-white, only faintly tinted — enamel, not paint
   49| _TONE_TONGUE = (0.42, 0.72)   # lighter and pinker than the hollow it sits in
   50| 
   51| _TEETH_H_FRAC = 0.26          # upper teeth as a fraction of cavity height, hanging from its roof
   52| _TONGUE_W_FRAC = 0.58         # the tongue is a bump on the floor of the mouth, not its contents:
   53| _TONGUE_H_FRAC = 0.42         # narrower than the mouth and confined to the lower part of it
```

| E07 | "已经是张开的嘴"的判据（同时要够高**且**有暗腔） | V4 | 78 | `# open/close capability outright, while a cavity painted behind a mouth that really is agape is mostly` |

### 〔E07〕 core/synth/mouth.py:78-85　嘴腔合成

```python
   78| # open/close capability outright, while a cavity painted behind a mouth that really is agape is mostly
   79| # occluded by the opaque open-mouth sprite — so when unsure, paint.
   80| _CLOSED_MAX_ASPECT = 0.40     # height/width below this the box is a stroke — always a closed mouth
   81| _DARK_INTERIOR_FRAC = 0.35    # a tall box is "open" only if at least this fraction of its solid pixels
   82| _DARK_REL_SKIN = 0.60         # are darker than _DARK_REL_SKIN x the skin luminance (a real cavity)
   83| 
   84| 
   85| def _palette(img) -> tuple[tuple[int, int, int], tuple[int, int, int], tuple[int, int, int]]:
```

| E08 | synthesize_mouth_cavity 主体：没有 mouth 层就返回 None | V4 | 206 | `The image is written beside the mouth texture (a decomposition work product, same as every other` |

### 〔E08〕 core/synth/mouth.py:206-225　嘴腔合成

```python
  206| def synthesize_mouth_cavity(stack: LayerStack) -> Layer | None:
  207|     """Paint an inner mouth behind the lips and splice it into ``stack``. Returns the new layer, or
  208|     ``None`` if there is nothing to do.
  209| 
  210|     The image is written beside the mouth texture (a decomposition work product, same as every other
  211|     layer). Mutates ``stack``.
  212|     """
  213|     try:
  214|         from PIL import Image
  215|     except ImportError:                                   # pragma: no cover - Pillow gated
  216|         return None
  217| 
  218|     mouths = stack.by_role(SemanticRole.mouth)
  219|     if not mouths or stack.by_role(SemanticRole.mouth_cavity):
  220|         return None
  221|     lips = mouths[0]
  222| 
  223|     src = Path(lips.texture_path)
  224|     if not src.is_file():
  225|         return None
```

| E09 | _mouth_open：嘴唇在 1 档张开、合成腔体在 0 档被压扁成零 | V5 | 771 | `def _mouth_open(` |

### 〔E09〕 core/rig/author.py:771-792　参数授权

```python
  771| def _mouth_open(
  772|     param_id: str,
  773|     lips: list[tuple[str, Mesh]],
  774|     cavity: list[tuple[str, Mesh]],
  775|     open_fn,
  776| ) -> Parameter:
  777|     """Open the mouth: the lips part into a lens *and* the synthesised cavity behind them grows from
  778|     nothing into the gap they leave.
  779| 
  780|     The two groups move oppositely, which is why this can't be a ``_two_pose``. The cavity is collapsed
  781|     **completely** when the mouth is shut — the degeneracy a blink must avoid is exactly what we want
  782|     here, because a closed mouth has to render as the bare lip line it always was, with no trace of the
  783|     part we painted behind it (see core.synth.mouth).
  784|     """
  785|     shut = Keyform(value=0.0, mesh_offsets={
  786|         **{pid: _zeros(m) for pid, m in lips},
  787|         **{pid: _collapse_vertical(m, 1.0) for pid, m in cavity},
  788|     })
  789|     opened = Keyform(value=1.0, mesh_offsets={
  790|         **{pid: open_fn(m) for pid, m in lips},
  791|         **{pid: _zeros(m) for pid, m in cavity},
  792|     })
```

| E10 | 参数接线处：ParamMouthOpenY / ParamMouthForm 挂到 mouth 与 cavity 上 | V5 | 290 | `else:` |

### 〔E10〕 core/rig/author.py:290-294　参数授权

```python
  290|         else:
  291|             open_fn = lambda m: _drop_lower(m, _MOUTH_OPEN)                  # noqa: E731
  292|         params.append(_mouth_open("ParamMouthOpenY", mouth, cavity, open_fn))
  293|         params.append(_mouth_form("ParamMouthForm", mouth, mouth_lm=lm.mouth))
  294| 
```

| E11 | Live2D 侧的标准参数映射表（Mouth Form / Mouth Open 归到 Mouth 组） | V6 | 25 | `("ParamBrowLY", "Brow L Y", "Eyes"),` |

### 〔E11〕 backends/live2d/mapping.py:25-30　Live2D 参数映射

```python
   25|     ("ParamBrowLY", "Brow L Y", "Eyes"),
   26|     ("ParamBrowRY", "Brow R Y", "Eyes"),
   27|     ("ParamMouthForm", "Mouth Form", "Mouth"),
   28|     ("ParamMouthOpenY", "Mouth Open", "Mouth"),
   29|     ("ParamBodyAngleX", "Body Angle X", "Body"),
   30|     ("ParamBodyAngleY", "Body Angle Y", "Body"),
```

| E12 | 口型同步用的就是 ParamMouthOpenY（LIP_SYNC_PARAMS） | V6 | 48 | `EYE_BLINK_PARAMS = ("ParamEyeLOpen", "ParamEyeROpen")` |

### 〔E12〕 backends/live2d/mapping.py:48-50　Live2D 参数映射

```python
   48| EYE_BLINK_PARAMS = ("ParamEyeLOpen", "ParamEyeROpen")
   49| LIP_SYNC_PARAMS = ("ParamMouthOpenY",)
   50| 
```

| E13 | talk 动作：驱动 ParamMouthOpenY（没有这个参数时该动作被抑制） | V7 | 193 | `# --- face -------------------------------------------------------------------------------------` |

### 〔E13〕 core/motion/drive.py:193-198　驱动动作

```python
  193| 
  194|     # --- face -------------------------------------------------------------------------------------
  195|     "talk": Drive({"ParamMouthOpenY": 1.0}, cycles=3, hold=10, settle=20,
  196|                   note="the mouth must actually open — a cavity, teeth and tongue behind the lips"),
  197|     "smirk": Drive({"ParamMouthForm": 1.0},
  198|                    note="corners up and down without the lips tearing from the face"),
```

| E14 | 嘴区合理性包络（宽度/深度/偏移的上下限，取自 8 个真实角色实测） | V8 | 196 | `# Mouth-region envelope, measured on the 8 real decomposed characters (model space, face_base bbox as` |

### 〔E14〕 core/qa/harness.py:196-215　QA 包络

```python
  196| 
  197| # Mouth-region envelope, measured on the 8 real decomposed characters (model space, face_base bbox as
  198| # the reference frame). The spread is remarkably tight — width 0.133-0.237 of the face, centre 0.808-
  199| # 0.881 of the way down it, and horizontally centred to within 0.9% of face width on every one — so
  200| # these bounds are set several times wider than the observed spread. They are here to catch a mouth
  201| # region that is *grossly* wrong (on the forehead, spanning the whole face, off to one side), not to
  202| # police style; a stylised character must never trip them.
  203| #
  204| # This exists because we could not otherwise tell. `synth.mouth` sizes the whole cavity from the mouth
  205| # layer's WIDTH, so a bad mouth region silently produces a bad cavity, and nothing downstream complains
  206| # — the same shape of silent-but-wrong that hid the head-turn squash and the clamped skirt. It is also
  207| # the trigger for backlog T9 (SAM-mouth-from-source): the rival's premise is that See-through's mouth
  208| # region is unreliable, and after the T8 denoise we could not reproduce that on any character. If a real
  209| # character trips this check, that premise is back and the heavy SAM path is justified; until one does,
  210| # it is not.
  211| _MOUTH_MIN_WIDTH_FRAC = 0.05   # narrower than this and it is a speck, not a mouth (measured >= 0.133)
  212| _MOUTH_MAX_WIDTH_FRAC = 0.50   # wider and the region has swallowed the jaw     (measured <= 0.237)
  213| _MOUTH_MIN_DEPTH_FRAC = 0.50   # above mid-face is the nose/eyes, not a mouth   (measured >= 0.808)
  214| _MOUTH_MAX_DEPTH_FRAC = 1.10   # below this it has fallen off the chin          (measured <= 0.881)
  215| _MOUTH_MAX_OFFSET_FRAC = 0.20  # off-centre by more than this is a mis-region   (measured <= 0.009)
```

| E15 | T9 backlog 原文：SAM-mouth-from-source 这条正是本任务在做的事 | V8 | 204 | `# layer's WIDTH, so a bad mouth region silently produces a bad cavity, and nothing downstream complains` |

### 〔E15〕 core/qa/harness.py:204-211　QA 包络

```python
  204| # This exists because we could not otherwise tell. `synth.mouth` sizes the whole cavity from the mouth
  205| # layer's WIDTH, so a bad mouth region silently produces a bad cavity, and nothing downstream complains
  206| # — the same shape of silent-but-wrong that hid the head-turn squash and the clamped skirt. It is also
  207| # the trigger for backlog T9 (SAM-mouth-from-source): the rival's premise is that See-through's mouth
  208| # region is unreliable, and after the T8 denoise we could not reproduce that on any character. If a real
  209| # character trips this check, that premise is back and the heavy SAM path is justified; until one does,
  210| # it is not.
  211| _MOUTH_MIN_WIDTH_FRAC = 0.05   # narrower than this and it is a speck, not a mouth (measured >= 0.133)
```

| E16 | 嘴部关键点（中心/左右嘴角/上下沿）从 mouth 层的轮廓算出来 | V9 | 271 | `mouth = sils.get(R.mouth)` |

### 〔E16〕 core/landmark/extract.py:271-279　关键点

```python
  271|     mouth = sils.get(R.mouth)
  272|     if mouth:
  273|         lm.mouth = MouthLandmarks(
  274|             center=mouth.centroid,
  275|             left_corner=mouth.leftmost,
  276|             right_corner=mouth.rightmost,
  277|             top=mouth.topmost,
  278|             bottom=mouth.bottommost,
  279|         )
```

| E17 | 管线里自动调用 synthesize_mouth_cavity（"a mouth with no interior cannot open"） | V10 | 137 | `"""Paint the parts the decomposer cannot see. Tolerate a missing Pillow / unreadable texture so the` |

### 〔E17〕 pipeline.py:137-144　管线

```python
  137|     """Paint the parts the decomposer cannot see. Tolerate a missing Pillow / unreadable texture so the
  138|     spine still runs (without a cavity the mouth simply stays shut, as it did before)."""
  139|     from .core.synth import synthesize_blush, synthesize_closed_eyes, synthesize_mouth_cavity
  140| 
  141|     try:
  142|         synthesize_mouth_cavity(stack)       # a mouth with no interior cannot open
  143|         synthesize_closed_eyes(stack)        # an eye with no closed pose can only squash
  144|         synthesize_blush(stack)              # no blush part exists -> paint one (opacity-gated, hidden at rest)
```
