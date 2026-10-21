# classroom-stage-warm —— 教室舞台（DSH web 客户端插件 · v0.0.1）

> **一句话**：把 DSH 的会话界面整屏换成「教室舞台」——暖纸配色、老师立绘、纸带正文、自带输入条。
> 形态是 **整屏接管**，落点**不在任何插槽里**（自建容器挂 `document.body`），所以它崩了只影响它自己。

**包名** `classroom-stage-warm` ｜ **两个半边**：

| 半边 | 文件 | 跑在哪 | 负责 |
|---|---|---|---|
| 宿主 | `lib/index.js` | Node | 素材静态路由 `/stage-static/*`（loopback-only）＋ 设置持久化 |
| 浏览器 | `lib/client.js` | 浏览器 | 整屏舞台（手写 `__ModuleLoader__` bundle，无构建步骤） |

---

## 〇 · 先跑这一条：**唯一验收入口**

```bash
cd clients/classroom-stage-warm
./check.sh                 # 离线自检：20 项（不装 profile、不起服务、不联网）
PORT=4498 ./check.sh --live    # 再加真机冒烟 4 项（自克隆隔离 harness → 建 profile → 装插件 → 预检）
# 退出码 0 = 全绿
```

它检查的东西（**这就是本包的可机核验收标准**）：

| 组 | 查什么 |
|---|---|
| 1 | 两半语法（`lib/index.js` / `lib/client.js`） |
| 2 | 🔴 **CSS 模板串里不许有裸反引号**（踩过：模板串会提前结束、报错跑到文件末尾） |
| 3 | **九类造型节点真的产出**：`cardframe` / `line sans` / `cast-wrap` / `orn` / `opts` / `oc picked sent` / `oc cur` / `oc disabled` / `quiet` |
| 4 | 宿主 5 条路由 ＋ `listBoards` / `listAnimations` |
| 5 | 素材与 **schema**：舞台图 ／ 板书 `whiteboard.scene.v1` ／ 动画 `animation.scene.v1` ＋ 视频体积 |
| 6 | 逃生门两快捷键 ／ `SAFE_MODE` ／ **仅 loopback** ／ **整屏层级 1080** |
| 7 | 纯函数单测：**从真源码逐字抽出** `parseOptions` 再跑（9 例） |
| 8 | （`--live`）克隆隔离 harness → 建 profile → 装插件 → `--dump-config exit 0`，**跑完自清** |

真机浏览器段（铺满／六态／拉出／板书／动画那条线）另跑 `test/13`–`test/16`（每个都要先起服拿 token，见 §六）。

---

## 一 · 装法（**隔离 profile**，别碰在用的 web/桌面 profile）

```bash
# 1) 隔离一个 harness（只拷 profiles 层；不拷 sessions/storages）
ISO=/tmp/stage-home
rsync -a "$DSH_HOME/profiles" "$ISO/"
export DSH_HOME=$ISO

# 2) 从出厂 web 模板建 profile（★ 必须带 --from-default-profile，否则 bundles 里没有 dsh-web-app，起不了 UI）
# 🔴 这一条会**顺手把 web 应用起起来**（它按 profile 名推断要跑的应用）——
#    照抄时务必**后台跑 + 十几秒后杀掉**，否则你会得到一个占着端口的服务：
#      dsh --profile stage --from-default-profile web >/dev/null 2>&1 &
#      sleep 12; kill %1
#    （建 profile 只需要那十几秒；这一步只写 profiles/stage/，不启动任何常驻进程即可）
dsh --profile stage --from-default-profile web

# 3) 预检（组合 profile 但不启动应用）—— exit 0 才好往下走
dsh --profile stage --dump-config > /dev/null && echo OK

# 4) 装插件（本地包一律用 file:，**不要** link:）
dsh plugin --profile stage add file:"$PWD"

# 5) 🔴 每次 add/remove 之后都核一遍 bundles 名单（新 profile 必须是三件）
node -e "console.log(require(process.env.DSH_HOME+'/profiles/stage/package.json').dsh.profile.bundles)"
# → ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","classroom-stage-warm"]

# 6) 起（换端口，别撞上在跑的桌面实例）；token 在启动输出里，**每次重启都变**
dsh --profile stage --port 4400 --no-open
```

### 🔴 改完代码怎么让它生效

`file:` 装出来的 profile 副本**不保证**跟着工作区走（本地包经 pnpm 打包时会按 `package.json` 的
`files` 白名单裁剪，硬链接也不抗「替换式写入」）。**跑之前显式同步 + 哈希复核**：

```bash
PROF="$DSH_HOME/profiles/stage/node_modules/classroom-stage-warm"
cp lib/client.js lib/index.js "$PROF/lib/"
shasum -a 256 lib/client.js "$PROF/lib/client.js"   # 两边前 16 位必须一致
```

---

## 二 · 逃生门（整屏接管**必须**有，否则用户回不去）

| 操作 | 作用 |
|---|---|
| `Ctrl+Shift+M` | **就地关闭舞台**（顺带清掉 DSH 错误边界留下的崩溃占位） |
| `Ctrl+Shift+U` | 恢复舞台 |
| 地址栏 `?stage=off` / `?stage=on` | 同上（走 localStorage 记住） |

关闭出口挂**自建 DOM 上的键盘监听**，不在任何插槽里 —— 所以插槽级崩溃时它仍然可用。

---

## 三 · ★★ 四条铁律（都踩过，别改回去）

1. **层级要写在根节点上，且是 1080 不是 900。**
   - 挂载容器 `#stage-warm-root` 是个**普通 div**（`position:static`、在 body 流末、高度 0）。
     整屏那层的 `position:fixed; inset:0; z-index` **必须落在它内部的根 div 上**，
     否则子件的 `absolute` 会相对「初始包含块」落位 —— 看着位置对，其实是运气。
   - 取 900 会被**零层级的原生件**盖住：实测空会话状态下 `document.elementFromPoint()`
     在舞台输入框中心命中的是原生 hero 输入卡 `uV2eYG_hero` → **点不到我们自己的输入框**。
     1080 在所有应用内容之上、仍在 **DSH 浮层 1100 之下**（弹窗/菜单照常可用）。
   - ⚠️ 与同类整屏皮肤（如 Avalon 也取 900）**同开时后者会被盖住** → 同类皮肤**一次只开一个**。
2. **hooks 全部集中在上半段、排在任何 `return` 之前。** 禁 `useX ? useX() : y`
   —— 设置是异步到达的瞬时状态，条件 hook 会抛 React #310（`Rendered more hooks…`），
   而且报错**没有任何可读信息**、这棵 React 树直接废掉。
3. **只用 `React.createElement`。** 外壳播种的 `jsx` 只吃两个参数，**变长 children 被静默丢弃**。
4. **读会话走 `chat.order` + `chat.nodes.get(key)`**，`legacy.nodes` 只当兜底、去重键绝不退化成下标；
   工具调用在 DSH 里有**两个节点**（`assistant-step.data.blocks` 里一份 ＋ 独立 `tool-call`），**按 `callId` 去重**。
   另：`SessionListState` **没有** `current` 字段；`SessionSnapshot` **没有** `cwd`（`cwd` 只在列表行的 `SessionSummary` 上）。
5. 🔴 **功能开关不能走 URL query**（实战踩过）：宿主接管时会连 `?token=…` 带我们自己的参数一起抹掉，
   模块加载那一刻 `location.search` 已是空串 → 开关走 **hash**（`#stagegallery=1`）或 **localStorage**。
6. 🔴 **"DOM 对、样式对、就是看不见／点不到"要三层分别判**（本项目已三次同族）：
   ① **定位上下文**（谁给绝对定位兜底）② **z 层级**（有没有被同层或零层级原生件盖住）③ **几何**（有没有落到可视区外／被容器裁掉）。
   判据是**像素** ＋ **命中测试** ＋ **`getBoundingClientRect`**，不是目视。
7. 🔴 **立绘/背景这类"入画"效果的判据是渐变是否真的命中**（`getComputedStyle(el,'::after').backgroundImage`），
   不是"图换成了 `div` 就算做了"。

---

## 四 · 它现在能做什么（v0.0.1 实测通过的部分）

| 能力 | 状态 | 怎么验的 |
|---|---|---|
| 装上后宿主起得来 | ✅ | 隔离 profile `--dump-config` exit 0；真启动无 boot 失败 |
| 浏览器半边下发成功 | ✅ | 宿主 `/stage-static/health` 的 `clientSeen=true` |
| 拿到会话数据 | ✅ | 传感器注册进 `conversation.input.right`（list / session / **无占位人**） |
| 整屏舞台渲染 | ✅ | 截图 `shots/01-…png`（背景 ＋ 立绘 ＋ 纸带 ＋ 姓名短册 ＋ 输入条） |
| 读到会话消息 | ✅ | 用户消息以 `line you` 出现在纸带上（截图 `shots/02-…png`） |
| **发送消息** | ✅ | 舞台输入条 → `inputActions.setDraft()` → 下一帧 `submit()` → 真进会话 |
| **galgame 造型 DOM** | ✅ | 真机会话实测（`test/13`）：纸卡内框 `::before` 1px/inset 9.765px ｜ 立绘入画 `::after` 渐变命中 ｜ 花饰 SVG `M1 11 C7 3,…` ｜ **六态 6 张卡**（`picked sent` / `cur` / `oc`×2 / `picked` / `disabled`），数值如 `bg=rgb(74,60,49)`、`tx=rgb(255,248,238)`；`font-weight` 全 400；`pageerror` 0 |
| **面板从角色身后拉出**（170/390/220ms ＋ −24px 过冲） | ❌ CSS 时序未落（节拍与过冲值已定案，见 `pull-out.html` 与对比件 §二） |
| 白板＝舞台的一个「屏」（整屏变纸） | ❌ 未做（**已定案走这条**，不再等拍板） |
| 动画整屏放完自动回 | ❌ 未做（**已定案**；且走模板/预渲染，不指望实时生成） |
| 三态（直排／纸卡短答／纸卡给选项） | 🟡 纸卡与六态样式已就位；**由谁裁决三态**（相位 vs 长度）仍按顶层口径（交给 AI） |
| Live2D 立绘 | ❌ 未做（当前是静态 PNG） |
| 逃生门 | ⚠️ 未在无头浏览器验（键盘事件合成不可靠），**按 Avalon 同款实现** |

### ★ 六态样张怎么看（真机验证造型用）

```
http://127.0.0.1:<port>/?token=<本次 token>#stagegallery=1
```
🔴 **开关必须走 hash（`#stagegallery=1`）或 localStorage（`stage-warm:gallery=1`），不能走 query** ——
宿主接管 URL 时会把 `?token=…` **连同我们自己的 query 一起抹掉**，模块加载那一刻 `location.search` 已经是空串（实测踩过，见下条铁律）。

---

## 五 · 素材

`assets/stage/` 5 张 PNG（教室广角／夜／老师／两位学生），来源是本项目**自产的生成素材**
（样稿目录 `code/mockups/stage-modern/assets/gen/`），不是任何原作解包物。

> 📌 参照物 Avalon 皮肤**不含任何图像／音频**（`.gitignore` 明写 `skin/assets/*`），
> 它的视觉要靠使用者从原著解包产物自行装配 —— 所以我们**借它的骨架与机制，不借它的皮**。
> 详见 `docs/历史报告/实测_Avalon皮肤装载链路_2026-09-30.md`。

---

## 五之二 · 新人走查记录（2026-09-30 实测，照本 README 从零走一遍）

| 步骤 | 结果 | 卡点 |
|---|---|---|
| `./check.sh`（离线） | ✅ 退出码 0，20 项全绿 | 无 |
| `PORT=4497 ./check.sh --live` | ✅ 退出码 0，24 项全绿（含真机 4 项） | 无（跑完自清隔离根、不留服务器） |
| §一 手工建隔离 profile | ✅ bundles 三件齐、插件装上、预检 exit 0 | 🔴 **`--from-default-profile` 会顺手把 web 应用起起来** → 必须 `&` + `sleep 12` + `kill %1`（已写进 §一） |

---

## 六 · 自检脚本（`test/`）

全部是 Playwright 脚本，**工作目录必须 = 项目根**（`playwright` 装在项目根的 node_modules）。

```bash
cd <项目根>
node <本包>/test/03-probe-boot-errors.cjs   "http://127.0.0.1:4400/?token=<本次 token>"  # boot 有没有失败
node <本包>/test/08-probe-hit-test.cjs      "…?token=…"                                  # 输入框点得到吗
node <本包>/test/09-flow-submit.cjs         "…?token=…" "测试消息"                        # 端到端送出一条
```

- `01` 截图 ＋ 收集三类报错 ｜ `02` 打印槽位清单与输入框 DOM ｜ `03` 完整 boot 报错原文
- `04` 绘制证据（几何 ＋ 图元 ＋ 像素采样） ｜ `05` CSS 规则是否命中 ｜ `06` outerHTML/属性
- `07` 逐层隐藏做遮挡归因 ｜ `08` `elementFromPoint` 命中测试 ｜ `09` 端到端提交

---

## 七 · 出处

- 契约取证（座目录／标准 kit／快照结构／种子模块白名单）：见项目根的会话记录与
  `` 下 2026-09-30 的实测件
- 装载链路与三层保险：`docs/历史报告/实测_Avalon皮肤装载链路_2026-09-30.md`
- 样式令牌与逐条 CSS：`docs/架构/规格_舞台样式令牌_2026-09-30.md`
