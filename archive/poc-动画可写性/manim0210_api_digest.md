# ManimCE 0.21.0 · 关键 API 摘要（一手抽取）

- 抽取来源：本机 venv 内已安装的 `manim` 包，版本 `0.21.0`
- 抽取方式：`inspect.signature` + `__doc__` 首段，脚本 = `scripts/extract_api_digest.py`
- Python：3.13.2

> 🔴 本摘要是**这个版本实际装的 API**，不是记忆里的 Manim。

### `Scene.play(self, *args: 'Animation | Mobject | _AnimationBuilder', subcaption: 'str | None' = None, subcaption_duration: 'float | None' = None, subcaption_offset: 'float' = 0, **kwargs: 'Any') -> 'None'`
Plays an animation in this scene.

### `Scene.wait(self, duration: 'float' = 1.0, stop_condition: 'Callable[[], bool] | None' = None, frozen_frame: 'bool | None' = None) -> 'None'`
Plays a "no operation" animation.

### `Scene.add(self, *mobjects: 'Mobject | OpenGLMobject') -> 'Self'`
Mobjects will be displayed, from background to foreground in the order with which they are added.

### `Scene.remove(self, *mobjects: 'Mobject') -> 'Self'`
Removes mobjects in the passed list of mobjects from the scene and the foreground, by removing them from "mobjects" and "foreground_mobjects"

### `Scene.construct(self) -> 'None'`
Add content to the Scene.

### `Mobject.shift(self, *vectors: 'Vector3DLike') -> 'Self'`
Shift by the given vectors.

### `Mobject.move_to(self, point_or_mobject: 'Point3DLike | Mobject', aligned_edge: 'Vector3DLike' = array([0., 0., 0.]), coor_mask: 'Vector3DLike' = array([1, 1, 1])) -> 'Self'`
Move center of the :class:`~.Mobject` to certain Point3D.

### `Mobject.next_to(self, mobject_or_point: 'Mobject | Point3DLike', direction: 'Vector3DLike' = array([1., 0., 0.]), buff: 'float' = 0.25, aligned_edge: 'Vector3DLike' = array([0., 0., 0.]), submobject_to_align: 'Mobject | None' = None, index_of_submobject_to_align: 'int | None' = None, coor_mask: 'Vector3DLike' = array([1, 1, 1])) -> 'Self'`
Move this :class:`~.Mobject` next to another's :class:`~.Mobject` or Point3D.

### `Mobject.to_edge(self, edge: 'Vector3DLike' = array([-1.,  0.,  0.]), buff: 'float' = 0.5) -> 'Self'`
Moves this :class:`~.Mobject` to the given edge of the screen, without affecting its position in the other dimension.

### `Mobject.to_corner(self, corner: 'Vector3DLike' = array([-1., -1.,  0.]), buff: 'float' = 0.5) -> 'Self'`
Moves this :class:`~.Mobject` to the given corner of the screen.

### `Mobject.scale(self, scale_factor: 'float', *, about_point: 'Point3DLike | None' = None, about_edge: 'Vector3DLike | None' = None) -> 'Self'`
Scale the size by a factor.

### `Mobject.rotate(self, angle: 'float', axis: 'Vector3DLike' = array([0., 0., 1.]), *, about_point: 'Point3DLike | None' = None, about_edge: 'Vector3DLike | None' = None, **kwargs: 'Any') -> 'Self'`
Rotates the :class:`~.Mobject` around a specified axis and point.

### `Mobject.set_color(self, color: 'ParsableManimColor' = ManimColor('#FFFF00'), alpha: 'Any' = None, family: 'bool' = True) -> 'Self'`
Condition is function which takes in one arguments, (x, y, z). Here it just recurses to submobjects, but in subclasses this should be further implemented based on the the inner workings of color

### `Mobject.set_stroke(value: 'Any') -> 'Mobject'`
(无 docstring)

### `Mobject.set_fill(value: 'Any') -> 'Mobject'`
(无 docstring)

### `Mobject.set_opacity(value: 'Any') -> 'Mobject'`
(无 docstring)

### `Mobject.get_center(self) -> 'Point3D'`
Get center Point3Ds

### `Mobject.get_top(self) -> 'Point3D'`
Get top Point3Ds of a box bounding the :class:`~.Mobject`

### `Mobject.get_bottom(self) -> 'Point3D'`
Get bottom Point3Ds of a box bounding the :class:`~.Mobject`

### `Mobject.get_left(self) -> 'Point3D'`
Get left Point3Ds of a box bounding the :class:`~.Mobject`

### `Mobject.get_right(self) -> 'Point3D'`
Get right Point3Ds of a box bounding the :class:`~.Mobject`

### `Mobject.get_width() -> 'Any'`
(无 docstring)

### `Mobject.get_height() -> 'Any'`
(无 docstring)

### `Text.__init__(self, text: 'str', fill_opacity: 'float' = 1.0, stroke_width: 'float' = 0, color: 'ParsableManimColor | None' = None, font_size: 'float' = 48, line_spacing: 'float' = -1, font: 'str' = '', slant: 'str' = 'NORMAL', weight: 'str' = 'NORMAL', t2c: 'dict[str, str] | None' = None, t2f: 'dict[str, str] | None' = None, t2g: 'dict[str, Iterable[ParsableManimColor]] | None' = None, t2s: 'dict[str, str] | None' = None, t2w: 'dict[str, str] | None' = None, gradient: 'Iterable[ParsableManimColor] | None' = None, tab_width: 'int' = 4, warn_missing_font: 'bool' = True, height: 'float | None' = None, width: 'float | None' = None, should_center: 'bool' = True, disable_ligatures: 'bool' = False, use_svg_cache: 'bool' = False, **kwargs: 'Any')`
Initialize self.  See help(type(self)) for accurate signature.

### `MarkupText.__init__(self, text: 'str', fill_opacity: 'float' = 1, stroke_width: 'float' = 0, color: 'ParsableManimColor | None' = None, font_size: 'float' = 48, line_spacing: 'float' = -1, font: 'str' = '', slant: 'str' = 'NORMAL', weight: 'str' = 'NORMAL', justify: 'bool' = False, gradient: 'Iterable[ParsableManimColor] | None' = None, tab_width: 'int' = 4, height: 'int | None' = None, width: 'int | None' = None, should_center: 'bool' = True, disable_ligatures: 'bool' = False, warn_missing_font: 'bool' = True, **kwargs: 'Any')`
Initialize self.  See help(type(self)) for accurate signature.

### `Paragraph.__init__(self, *text: 'str', line_spacing: 'float' = -1, alignment: 'str | None' = None, **kwargs: 'Any')`
Initialize self.  See help(type(self)) for accurate signature.

### `Rectangle.__init__(self, color: 'ParsableManimColor' = ManimColor('#FFFFFF'), height: 'float' = 2.0, width: 'float' = 4.0, grid_xstep: 'float | None' = None, grid_ystep: 'float | None' = None, mark_paths_closed: 'bool' = True, close_new_points: 'bool' = True, **kwargs: 'Any')`
Initialize self.  See help(type(self)) for accurate signature.

### `RoundedRectangle.__init__(self, corner_radius: 'float | list[float]' = 0.5, **kwargs: 'Any')`
Initialize self.  See help(type(self)) for accurate signature.

### `Square.__init__(self, side_length: 'float' = 2.0, **kwargs: 'Any') -> 'None'`
Initialize self.  See help(type(self)) for accurate signature.

### `Line.__init__(self, start: 'Point3DLike | Mobject' = array([-1.,  0.,  0.]), end: 'Point3DLike | Mobject' = array([1., 0., 0.]), buff: 'float' = 0, path_arc: 'float' = 0, **kwargs: 'Any') -> 'None'`
Initialize self.  See help(type(self)) for accurate signature.

### `Arrow.__init__(self, *args: 'Any', stroke_width: 'float' = 6, buff: 'float' = 0.25, max_tip_length_to_length_ratio: 'float' = 0.25, max_stroke_width_to_length_ratio: 'float' = 5, **kwargs: 'Any') -> 'None'`
Initialize self.  See help(type(self)) for accurate signature.

### `Triangle.__init__(self, **kwargs: 'Any') -> 'None'`
Initialize self.  See help(type(self)) for accurate signature.

### `Dot.__init__(self, point: 'Point3DLike' = array([0., 0., 0.]), radius: 'float' = 0.08, stroke_width: 'float' = 0, fill_opacity: 'float' = 1.0, color: 'ParsableManimColor' = ManimColor('#FFFFFF'), **kwargs: 'Any') -> 'None'`
Initialize self.  See help(type(self)) for accurate signature.

### `Circle.__init__(self, radius: 'float | None' = None, color: 'ParsableManimColor' = ManimColor('#FC6255'), **kwargs: 'Any') -> 'None'`
Initialize self.  See help(type(self)) for accurate signature.

### `Brace.__init__(self, mobject: 'Mobject', direction: 'Vector3DLike' = array([ 0., -1.,  0.]), buff: 'float' = 0.2, sharpness: 'float' = 2, stroke_width: 'float' = 0, fill_opacity: 'float' = 1.0, background_stroke_width: 'float' = 0, background_stroke_color: 'ParsableManimColor' = ManimColor('#000000'), **kwargs: 'Any')`
Initialize self.  See help(type(self)) for accurate signature.

### `NumberLine.__init__(self, x_range: 'Sequence[float] | None' = None, length: 'float | None' = None, unit_size: 'float' = 1, include_ticks: 'bool' = True, tick_size: 'float' = 0.1, numbers_with_elongated_ticks: 'Iterable[float] | None' = None, longer_tick_multiple: 'int' = 2, exclude_origin_tick: 'bool' = False, rotation: 'float' = 0, stroke_width: 'float' = 2.0, include_tip: 'bool' = False, tip_width: 'float' = 0.35, tip_height: 'float' = 0.35, tip_shape: 'type[ArrowTip] | None' = None, include_numbers: 'bool' = False, font_size: 'float' = 36, label_direction: 'Point3DLike' = array([ 0., -1.,  0.]), label_constructor: 'type[ManimTextLabel]' = <class 'manim.mobject.text.tex_mobject.MathTex'>, scaling: '_ScaleBase' = <manim.mobject.graphing.scale.LinearBase object at 0x117822ad0>, line_to_number_buff: 'float' = 0.25, decimal_number_config: 'dict | None' = None, numbers_to_exclude: 'Iterable[float] | None' = None, numbers_to_include: 'Iterable[float] | None' = None, **kwargs: 'Any')`
Initialize self.  See help(type(self)) for accurate signature.

### `Axes.__init__(self, x_range: 'Sequence[float] | None' = None, y_range: 'Sequence[float] | None' = None, x_length: 'float | None' = 12, y_length: 'float | None' = 6, axis_config: 'dict | None' = None, x_axis_config: 'dict | None' = None, y_axis_config: 'dict | None' = None, tips: 'bool' = True, **kwargs: 'Any')`
Initialize self.  See help(type(self)) for accurate signature.

### `Create.__init__(self, mobject: 'VMobject | OpenGLVMobject | OpenGLSurface', lag_ratio: 'float' = 1.0, introducer: 'bool' = True, **kwargs) -> 'None'`
Initialize self.  See help(type(self)) for accurate signature.

### `FadeIn.__init__(self, *mobjects: 'Mobject', **kwargs: 'Any') -> 'None'`
Initialize self.  See help(type(self)) for accurate signature.

### `FadeOut.__init__(self, *mobjects: 'Mobject', **kwargs: 'Any') -> 'None'`
Initialize self.  See help(type(self)) for accurate signature.

### `Transform.__init__(self, mobject: 'Mobject | None', target_mobject: 'Mobject | None' = None, path_func: 'Callable | None' = None, path_arc: 'float' = 0, path_arc_axis: 'np.ndarray' = array([0., 0., 1.]), path_arc_centers: 'Point3DLike | Point3DLike_Array | None' = None, replace_mobject_with_target_in_scene: 'bool' = False, **kwargs) -> 'None'`
Initialize self.  See help(type(self)) for accurate signature.

### `ReplacementTransform.__init__(self, mobject: 'Mobject', target_mobject: 'Mobject', **kwargs) -> 'None'`
Initialize self.  See help(type(self)) for accurate signature.

### `Indicate.__init__(self, mobject: 'Mobject', scale_factor: 'float' = 1.2, color: 'ParsableManimColor' = ManimColor('#FFFF00'), rate_func: 'RateFunction' = <function there_and_back at 0x1149f4180>, **kwargs: 'Any')`
Initialize self.  See help(type(self)) for accurate signature.

### `Flash.__init__(self, point: 'Point3DLike | Mobject', line_length: 'float' = 0.2, num_lines: 'int' = 12, flash_radius: 'float' = 0.1, line_stroke_width: 'int' = 3, color: 'ParsableManimColor' = ManimColor('#FFFF00'), time_width: 'float' = 1, run_time: 'float' = 1.0, **kwargs: 'Any')`
Initialize self.  See help(type(self)) for accurate signature.

### `Write.__init__(self, vmobject: 'VMobject | OpenGLVMobject', rate_func: 'Callable[[float], float]' = <function linear at 0x1149eb600>, reverse: 'bool' = False, **kwargs) -> 'None'`
Initialize self.  See help(type(self)) for accurate signature.

### `GrowFromCenter.__init__(self, mobject: 'Mobject', point_color: 'ParsableManimColor | None' = None, **kwargs: 'Any')`
Initialize self.  See help(type(self)) for accurate signature.

### `GrowArrow.__init__(self, arrow: 'Arrow', point_color: 'ParsableManimColor | None' = None, **kwargs: 'Any')`
Initialize self.  See help(type(self)) for accurate signature.

### `AnimationGroup.__init__(self, *animations: 'Animation | Iterable[Animation]', group: 'Group | VGroup | OpenGLGroup | OpenGLVGroup | None' = None, run_time: 'float | None' = None, rate_func: 'Callable[[float], float]' = <function linear at 0x1149eb600>, lag_ratio: 'float' = 0, **kwargs: 'Any')`
Initialize self.  See help(type(self)) for accurate signature.

### `LaggedStart.__init__(self, *animations: 'Animation', lag_ratio: 'float' = 0.05, **kwargs: 'Any')`
Initialize self.  See help(type(self)) for accurate signature.

### `Succession.__init__(self, *animations: 'Animation', lag_ratio: 'float' = 1, **kwargs: 'Any')`
Initialize self.  See help(type(self)) for accurate signature.

### `VGroup.__init__(self, *vmobjects: 'VMobject | Iterable[VMobject]', **kwargs: 'Any') -> 'None'`
Initialize self.  See help(type(self)) for accurate signature.

### `VGroup.arrange(self, direction: 'Vector3DLike' = array([1., 0., 0.]), buff: 'float' = 0.25, center: 'bool' = True, **kwargs: 'Any') -> 'Self'`
Sorts :class:`~.Mobject` next to each other on screen.


## 本摘要抽取时**不存在**的目标（= 若模型写了这些，就是幻觉 API）

（无）