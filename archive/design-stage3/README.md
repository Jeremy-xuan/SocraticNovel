# STAGE-3 · 教室舞台（安全骨架批次）

三个界面方向的静态原型：**A 夜读 / B 讲台 / C 書庫**，同一份课程内容（操作系统 · 第 3 讲「进程」），
每个方向四屏（开场 / 板书 / 选择肢 / 多角色同台），共 **12 屏**。

纯前端、零外链、零新依赖，`file://` 直接可开。

---

## 一 · 本批次的边界（先看这里）

本批次是**安全骨架**：只保留形态与几何，**不包含任何第三方游戏 / 角色素材及其衍生图**。

- ❌ 不复制 `assets/`（第三方游戏场景与立绘）
- ❌ 不复制 `shots/`（上一轮的第三方素材截图）
- ❌ 不复制 `probe/`（含第三方素材的探针图）
- ❌ 不复制 `tools_measure.py`（针对第三方素材的量测脚本）

取而代之的是「**CSS/SVG 自包含占位 + 可选素材外挂契约**」：
默认无第三方图片也能**完整展示 A/B/C 三种形态**，素材存在时由**一个明确配置点**替换。

## 二 · 文件白名单

| 文件 | 作用 |
|---|---|
| `index.html` | 总览页：12 屏用**活 iframe** 内嵌（**不引用 `shots/`**，本目录没有它也不会破图） |
| `a-nightread.html` / `b-podium.html` / `c-library.html` | 三个形态页，各四屏：`?scene=open\|board\|choice\|cast` |
| `stage3.css` | 设计令牌 + 三方向骨架 + 占位/缺失角标样式 |
| `stage3.js` | 场景渲染 + 内联 SVG 占位生成 + 素材解析（含失败退回） |
| `stage3.assets.js` | **唯一素材配置点**（`mode` + `slots`） |
| `tools_selfcheck.mjs` | 静态自检（零依赖，随时可跑） |
| `tools_shots.cjs` | 12 屏浏览器验收（截图 + 断言） |
| `README.md` | 本文件 |
| `.gitignore` | 忽略 `shots/` 与 `.DS_Store`（截图是运行期产物，不入库） |
| `shots/` | **运行期产物**：12 张 PNG（已被 `.gitignore` 忽略，可删、可重生成） |

## 三 · 素材契约

### 默认：占位模式（自包含）

`stage3.assets.js` 里 `mode: 'placeholder'`、`slots` 全部留空。
场景与立绘由 `stage3.js` 生成**内联 SVG**（`data:image/svg+xml,...`）：

- 不发任何网络请求 → 不会出现破图图标，也不会有 404
- 场景 = 与舞台同尺寸的渐变（标「占位 · 场景 · 夜 / 傍晚」）
- 立绘 = 角色剪影，**画布里不写任何文字**（画布 300×1080，≈真立绘的窄长比例）。
  🔴 图上文字会跟着立绘的层高跑进正文区、把台词压住——已实测踩过，故槽位名改由
  页面上一枚 15px 角标承担，且**只在外挂素材时显示**（占位模式下三个剪影本身够辨识）。

### 换成真素材：外挂模式

只改 `stage3.assets.js` 一处：

```js
window.STAGE3_ASSETS_CONFIG = {
  mode: 'external',
  slots: {
    scene_night:   'assets/scene/night.jpg',
    scene_evening: 'assets/scene/evening.jpg',
    cast_a:        'assets/cast/cast_a.png',
    cast_b:        'assets/cast/cast_b.png',
    cast_c:        'assets/cast/cast_c.png'
  }
};
```

- **只填一部分也可以**：填了的槽位用真素材，没填的继续用占位。
- **加载失败不静默忽略**：该槽位退回占位 ＋ 挂一枚红色「**素材缺失：&lt;路径&gt;**」角标
  ＋ 打一条 `console.error('[stage3] 素材加载失败 → 退回占位：槽位=… 路径=… 原因=load-error')`。

### 不改文件临时切换（验收用）

URL 查询参数优先于配置文件：

- `?assets=placeholder` → 强制占位
- `?assets=<目录>/` → 把全部 5 个槽位指向该目录下的
  `scene_night.png` / `scene_evening.png` / `cast_a.png` / `cast_b.png` / `cast_c.png`
  （可写相对本目录的路径，也可写 `file://` / `http(s)://` 绝对 URL）

运行期事实可从 `window.__stage3.state` 读到：
`{ mode, scene, assets: [{ slot, url, used, fallback }] }`。

## 四 · 怎么跑

### 1）静态自检（零依赖，随时可跑）

```bash
node prototypes/stage3/tools_selfcheck.mjs
```

查的是纪律本身（41 项）：白名单 / 禁止物 / 三页引用的本地文件是否存在 /
页面里有没有第三方素材路径 / `index.html` 有没有用 `src|href` 引用 `shots/` /
配置点默认值 / 截图脚本的路径与开关纪律。退出码 0 = 全绿。

### 2）12 屏浏览器验收（截图 + 断言）

```bash
# 占位模式（默认）：零第三方素材，预期零报错、零缺失角标
node prototypes/stage3/tools_shots.cjs

# 外挂模式 · 素材应当存在：全部走外挂、零报错、零角标
node prototypes/stage3/tools_shots.cjs --assets-base=file:///path/to/dir/

# 外挂模式 · 素材故意不存在：每槽位应有 1 条 requestfailed + 1 条 [stage3] console.error + 1 枚角标
node prototypes/stage3/tools_shots.cjs --assets-base=file:///nonexistent/ --expect-missing

# 只断言不落图
node prototypes/stage3/tools_shots.cjs --no-shots
```

**依赖解析**：脚本不新增依赖。`playwright` 按
`$STAGE3_PLAYWRIGHT` → `<仓库根>/node_modules/playwright` → `npm root -g` 顺序解析；
三处都没有就**明确报阻塞（exit 2）**并打印已尝试的路径，不静默跳过。
静态自检不需要浏览器，任何情况下都能跑。

**纪律**：脚本只**读**被测文件（HTML/CSS/JS），只**写** `shots/*.png`——
不覆盖 `stage3.css`，也不改任何被测页面。路径全部相对脚本自身（`__dirname`）解析，
与当前工作目录无关。

## 五、12 屏断言清单

每屏都断言：

1. 运行期模式 / 屏名 / `data-stage3-mode` 与预期一致
2. 绑定的槽位数 = 4（1 场景 + 3 立绘）
3. **不许破图**：每个 `<img>` 有非空 `src`、已 decode、`naturalWidth/Height > 0`
   （`display:none` 是设计上隐藏，不计入破图；但全部不可见仍判失败）
4. 占位模式：全部 `src` 是 `data:image/svg+xml`，零外挂槽位，零角标，**零报错**
5. 外挂模式（素材存在）：4 个槽位全部走外挂、零角标、**零报错**
6. 外挂模式（素材不存在）：4 个槽位全部退回占位、4 枚角标、4 条 `requestfailed`、
   4 条我方 `[stage3]` `console.error`（**证明不静默忽略**）

> 计数只认我方 `[stage3]` 前缀的报错，不把 Chrome 自己补的
> `Failed to load resource` 条数当契约——那是浏览器实现细节，会随版本变。

## 六 · 版式纪律（2026-09-25 按目视复核重排）

**正文可读性优先**：三方向的立绘都摆到正文列**之外**，不许压字。实测依据：

| 方向 | 正文列横向范围 | 立绘摆位 | 为什么 |
|---|---|---|---|
| A 夜读 | x 17.2%–80.2% | 8% / 37% / 64%，84%/78%/74% 高 | 立绘可见剪影只占画布下部（y 470–1040/1080），84% 高时剪影从 y≈617 起，落在正文列底边（652）之外 |
| B 讲台 | x 17.2%–61.4% | 1% / 6% / 11%，44%/41%/43% 高 | 原摆 26%/41%/12% 正落在正文列里、大面积叠字 → 三尊一律收进**左侧空带**（x 0–17.2%）并贴底 |
| C 書庫 | 对话带 x 8%–92% | 62% / 86%，44%/40% 高 | 两尊收进**右侧空带**，贴底当前景压边 |

C 的对话带另做两处修正：

1. **改成顶对齐**（`top:46%`，与 A/B 同一锚法）。原来 `bottom:3.2%` 贴底，行数一多就向上长，
   末行压到左下角取景标（实测 band bottom 1046 vs tag top 1042）。
2. **只把 C 的对话字号降一档到 40px**（几何与 A/B 仍是同一套令牌）。
   C 这一屏内容比 A/B 长，47px 在 84% 宽里占 360px 高，顶对齐后底边 ≈857px——
   取景标（1042）不被压、1080 画布不裁切。

> 立绘占位画布的尺寸也是这条纪律的一部分：早先用 720 宽画布，84% 高时立绘宽达 **605px**，
> 于是压掉正文；改成 300 宽画布（≈真立绘的窄长比例）后降到 **252px**。
