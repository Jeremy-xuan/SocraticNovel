# STATUS · 这个仓库现在到哪了

> **这是全仓库唯一的状态源。** 其他任何文档里写的「已完成／半成品／能用了」都只是**当时的记录**，
> 与这里冲突时**以本文件为准**；要改状态，只改这里。
>
> 上次核对：**2026-10-21**（核对人：DSH 会话，命令与输出见每行的「证据」）。
> 本轮批量变更的原始证据在 `docs/证据图/迁移0.2.1/`，实现报告在 `docs/历史报告/实现报告_{B,A,S,P,X}_*.md`。

---

## 一 · 先看这一节：三级门槛

「能用」不是一个感觉，是三个等级。**没到对应等级，就不许在 README、宣传、对外的任何地方写「可用」。**

| 级 | 名字 | 判据 | 谁跑 |
|---|---|---|---|
| **L1** | 机核 | 一条命令、纯本地、不联网、不花钱；退出码 0 | `node check.mjs` |
| **L2** | 真机隔离 | 克隆一份 `DSH_HOME`、独立端口、装进 profile，真的渲染／真的收发 | `cd clients/classroom-stage-warm && ./check.sh --live` 等 |
| **L3** | 端到端 | 真模型、真会话、按一节课走完，落盘事实可核 | `./acceptance/run.sh`（会花钱） |

**L1 绿只说明「代码没坏」，不说明「学生用得上」。** 想看"现在能不能开课"，直接跳到 §三。

---

## 二 · 能力总表

状态列：🟢 已到 L3（可对外说能用）｜🟡 只到 L1/L2（可试，需有人在场）｜🔴 不可用（缺件或未接线）｜⬜ 没开始。

| # | 能力 | 代码在哪 | 状态 | 证据（2026-10-20 实测） | 差什么才能升级 |
|---|---|---|---|---|---|
| 1 | 教学引擎（相位、注入、工具、课后更新） | `plugins/socratic-engine/` | 🟡 L1 | `node check.mjs` 第 ⑧ 步：**461/461** 通过 | 一次完整 `acceptance/run.sh`（L3），卡在验收流水线的「铁律③ vs 0.2.1」冲突（见 §二之二） |
| 2 | 教室包（操作系统 14 讲） | `classrooms/cs-os/` | 🟡 L1 | `check.mjs` 第 ① 步：17 个必需文件齐全、声明路径全在盘、14 讲正文齐全；第 ② 步与技能镜像 **54 文件 sha256 全一致** | 已在 stage 实例上做成 0.2.1 的插件行形态预设且真浏览器可选（`docs/证据图/迁移0.2.1/stage-preset-picker-0.2.1.json`），L2 装配过 |
| 3 | 技能包（装上就能用的分发形态） | `skills/socratic-classroom/` | 🟡 L1 | `check.mjs` ①②：`validate` 退出码 0；与教室真源 sha256 全一致 | L2 安装＋被发现（09-24 做过，迁移后未复验） |
| 4 | 整屏舞台（暖色教室界面） | `clients/classroom-stage-warm/` | 🟡 L2 | `./check.sh` **35/35**（原 20 项）；`--live` 33/33；真浏览器（swiftshader）里 canvas `399x546`、**立绘画出来了**、`pageerror` 0、K0 挂载点 11 键齐全 | 无崩溃交互回归；完整课堂对话属 M4-T |
| 5 | 右栏面板（课程表／立绘／板书历史） | `clients/classroom-ui/` | 🟡 L2 | `check.mjs` 第 ⑤ 步：panel ＋ 白板服务端 **69** ＋ 白板路由 **44** 全绿；真浏览器里 tab 能开、`data-cui-portrait-mode="pixi-idle"`、15.0 fps、舞台打开时 0 帧 | 「没装舞台」的 profile 里静态立绘读不到（面板只能读工作区相对路径，插件包内没有读通道） |
| 6 | 板书闭环（老师画 → 舞台自动切屏 → 面板只读历史） | `clients/classroom-stage-warm` ＋ `classroom-ui` ＋ 引擎 `classroom_draw` | 🔴 **舞台那一段没接上** | 引擎侧与路由侧都真跑通了：一次 mock 真回合里 `classroom_draw` 落出 `L01-T01-…-flowchart.mmd` + 索引行，`GET /stage-board/diagrams[/<id>]` 返回正确内容（副本与命令见 `docs/证据图/迁移0.2.1/端到端产物/`）。**但舞台 `data-screen` 全程停在 `live`；手动点「板书」显示的是预制静态场景，不是刚画的那张** | 舞台读错了数据源：它读自己变换后的 `messages`（kind 只有 `you`/`tool`/`teacher`，`tool` 不带 `name`），而契约 K2.3 的判据要的是宿主 Chat 节点的 `kind==='tool-result' && name==='classroom_draw'`。改成读 `useChat` 的 `nodes`，并把手动按钮改成「有当前图先渲染当前图」 |
| 7 | 课堂记录（第一节课的卡点，第二节课被引用） | 引擎 `lib/notestore.mjs` ＋ `runtime/notes.jsonl` ＋ 三份机械投影 | 🟡 L1 | `test/notestore.test.mjs` + `postclass` 覆盖：三档状态推导、跳讲不算掌握、review +1/+3/+7、幂等、(lesson,turn,id) 定序、resolved 推导 | **stage 上的真实两节课验证**（要真实模型与两次会话） |
| 8 | 立绘（Live2D 渲染宿主） | `clients/live2d-host/` | 🔴 本仓库跑不起来 | `check.mjs` 第 ③ 步：只做语法与脚本目标检查；`vendor/`、`samples/` 不随仓库分发 | 已确定**不再是主路径**：舞台与面板都改用 `assets/l2d/` 的 pixi+cubism 那套（见技术债） |
| 9 | 表情驱动（老师的脸跟着语气变） | `clients/classroom-stage-warm/assets/l2d/stage-emotion*.js` ＋ `vendor/soullink/` ＋ 引擎 `llm/stream` 剥离 | 🟡 L2 | 解析器 14/14（任意切分逐字节一致）、驱动 16/16、真机 driver 已注册且每帧写 16 个参数、`pageerror` 0、五态截图 | **情绪轮询端到端缺**：需要引擎写出 `runtime/emotions.jsonl` ＋ 一个 running 回合 |
| 10 | 注入隐藏（引擎上下文不显示给学生） | `clients/inject-hide/` | 🟡 L1 | `check.mjs` 第 ④ 步：**21/21**（1 项 N/A） | 装进 profile 看真实会话里注入消失（L2） |
| 11 | 教学动画（课前预渲染 ＋ 课上放） | `plugins/socratic-engine/lib/animation*`、`tools/animation-gate/` | 🟡 L1 | 引擎单测覆盖模板/闸门/缓存键；**渲染环境其实在本机**：`/Library/Frameworks/Python.framework/Versions/3.13/bin/manim` = Manim Community v0.20.1，`acceptance` 的 `stage0Preflight` 带上三个环境变量即通过 | 跑一次真正渲片（L3） |
| 12 | 验收流水线 | `acceptance/` | 🔴 被前提冲突卡住 | 第 ⑦ 步 4 项机核全绿；`--skip-session` 走过 preflight 后卡在第 02 步「铁律③」 | 见 §二之二：铁律③ 假定「宿主包由安装版回退目录提供」，而 0.2.1 删了那个回退 |
| 13 | 部署（服务器上的 stage 实例） | `tools/deploy/` ＋ 服务器 | 🟡 L2 | stage 已升 **0.2.1-rc.2**：`NRestarts=0`、端口 10 秒 listen、装载零告警、教室预设真浏览器可选且默认；`deploy-stage.sh` 已补预设自动转换与端口轮询 | 一次从零部署；u001–u005 的同类迁移未做（未授权） |
| 14 | v1 参考教室（AP 物理） | `AP_Physics_EM/`、`META_PROMPT.md` | 🟡 静态内容 | 内容完整 | 不是当前主线 |

**§二之二 · 本轮查明的两个「卡点不是 bug，是前提过期」**

1. **验收流水线 vs 0.2.1**：第 02 步的「铁律③」禁止把 `@deepseek-ai/*` 装进 profile/插件
   `node_modules`，理由是「会造成双实例与 Symbol 失配」，而它的前提注释写着「宿主包由**安装版回退目录**提供」
   ——**0.2.1 把这个回退删掉了**（`@deepseek-ai/dsh/lib/bin.js` 里 `NODE_PATH`/`registerHooks`/`modulePaths`
   全部 0 命中）。所以「插件 import 宿主包」与「铁律③」在 0.2.1 上不可兼得。三条出路（含我倾向的那条）写在
   `docs/历史报告/实现报告_B_迁移0.2.1_2026-10-20.md` §5.1，**需要人来定**，我没有擅自放宽检查。
2. **`STATUS.md` 旧说法「渲染环境随旧工作区删除」不准**：Manim 0.20.1 就在本机
   `/Library/Frameworks/Python.framework/Versions/3.13/bin/`，`tools/animation-gate/animation_gate.py` 也在盘。

**门槛覆盖率**：`node check.mjs` 现在 8 步，覆盖 ①②③④⑤⑥⑦⑧，合计 **461（引擎）＋ 69＋44（白板）＋ 21（注入隐藏）＋ 35（舞台 check.sh）** 条断言，退出码 0。
舞台另有 `./check.sh --live` 33 项（建隔离 profile、真装进去、`--dump-config` 预检）。

---

## 三 · 现在能给别人什么

| 给谁 | 给什么 | 前提 |
|---|---|---|
| 想读内容的人 | `classrooms/cs-os/`（14 讲、58 条知识点、故事线、角色） | 直接读；不依赖运行时 |
| 想装技能的人 | `skills/socratic-classroom/` 整包 → 放进 `<DSH_HOME>/skills/` | 装完跑 `node skills/socratic-classroom/validate`，退出码 0 才算装对 |
| 想看界面的人 | `clients/classroom-stage-warm` 的离线自检 ＋ 截图 | `./check.sh` 绿＝界面代码没坏；`./check.sh --live` 绿＝能装进隔离 profile 并预检通过。**浏览器里的实际渲染没验过**，要看得自己起服跑 `test/13–16` |
| 想上课的人 | **暂时给不了** | 引擎只到 L1、教室包没做成预设、完整验收从未跑过——这三件凑齐才有「一节课」 |

---

## 四 · 明确冻结的东西（不要再投入，也不要对外说"在做"）

| 项 | 冻结理由 | 解冻条件 |
|---|---|---|
| 白板（学生**在板上写字**） | 产品决定：学生不写；实时白板只由老师在舞台板书屏上产出，面板只做只读历史 | 产品决定改变 |
| 完整课堂（M4／M4-T） | 从未跑过；预设封装已就（stage 上可选），缺一次 L3 验收 | §二 第 1、2、12 行都到 L3 |
| 多角色同台（AI 同学） | 设计已定，实现未开工；依赖 turn 语义取证 | 单角色课堂先到 L3 |
| 语音、出题、复习调度、教材导入 | 功能清单里都是「⬜ 没开始」 | 不在当前主线，需要时单独立项 |

---

## 五 · 怎么维护这份文件

1. **只有这里改状态。** 历史报告、计划、盘点一律不再更新状态；它们的时间戳就是它们的边界。
2. 每行必须有**证据**：一条能复跑的命令，或一份带日期的报告路径。写不出证据的，状态最高只能标 🟡。
3. **过了 30 天没复验的 🟢／🟡 自动降级**为 🟡／🔴，直到有人重跑那条证据命令。
4. 新增能力先加到表里（哪怕状态是 ⬜），再动手；不允许"做完了才想起来登记"。
5. 目录的生命周期（product / research / archive）见根 `AGENTS.md`；研究产物不进这张表。
