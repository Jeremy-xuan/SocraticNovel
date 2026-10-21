# 实现报告 · DEMO-1 课堂实录（录屏）＋ README 出图

> 📌 **2026-10-20 路径变更**：文中 `demo/`、`demo/images/`、`demo/raw/` 现已移到
> [`docs/证据图/课堂实录_2026-09-24/`](../证据图/课堂实录_2026-09-24/)（成片与截图）；
> `raw/`、`logs/` 等中间产物未随仓库分发。`开源线/DSH定制/...` 是旧工作区路径，已迁入本仓库。

> **任务代号**：DEMO-1 ｜ **日期**：2026-09-24 ｜ **工作目录**：`/Users/wujunjie/Documents/ChatGPT/大学申请`
> **一句话**：把"这套东西在做什么"变成**别人能一眼看懂的图与录屏**——一张真流程图、一节真课、34 秒实录，并接进产品仓 README。
> **纪律自述**：未做任何 git commit / push；未新增任何依赖（Playwright 1.63 与 ffmpeg 8.0.1 均为本机已有）；未碰 `code/clients/classroom-ui/lib/**`、`code/plugins/socratic-engine/**`、`code/classrooms/**`（只读）、`code/skills/**`、`code/acceptance/**`、任何 profile 的安装内容、安装版 app、`$DSH_HOME`（见 §6 的例外说明）。

---

## 0 · 一页速览

| 交付物 | 路径 | 一句说明 |
|---|---|---|
| 图 ×6 | `开源线/DSH定制/demo/images/*.png` | 全部从**一次真实会话**截下来；同一份已拷进产品仓 `demo/images/`（逐文件 sha256 一致） |
| 录屏 ×3 | `开源线/DSH定制/demo/课堂实录_精华34秒.mp4`（主）／`课堂实录_完整版.mp4`／`课堂实录_画图瞬间.gif` | 精华 34.0 s、完整版 153.3 s，均为 1280×720 H.264，带对齐字幕 |
| README 改动 ×3 | 产品仓 `README.md`／`README_EN.md`／`skills/socratic-classroom/README.md` | **纯新增**（0 删除行）：共 +34／+36／+13 行，含 4 张图与 1 行"怎么试"命令 |
| 可复跑脚本 ×7 | `开源线/DSH定制/demo/*.cjs`、`*.mjs`、`*.py` | 录屏、出图、后期、验收各一条命令，全部幂等 |
| 证据 | `demo/raw/`（原始录像、timeline.json、images_facts.json、subtitle_plan.json、diffs/）＋ `demo/logs/`（3 次运行的完整日志） | 每个数字都能回查 |

**本轮真实会话花费**：**3 次**（1 次成功 + 2 次基础设施/脚本失败）。按任务书"基础设施失败的另计并记录"口径，本报告把三次全部列出（§5）。

---

## 1 · 每个产物的路径与一句说明

### 1.1 静态图（`demo/images/`，同时拷进产品仓 `demo/images/`）

| 文件 | 尺寸 | 一句说明（可直接当 README 图注） |
|---|---|---|
| `整窗总览.png` | 1600×900 | 左边是上课的对话，右边是「教室」面板，老师画的图落在消息流里——一张图说清"这是什么" |
| `教室面板.png` | 720×1435 | 右栏「教室」全高：讲台立绘／当前（讲次 `第 1 讲 / 14 · 一个程序怎么跑起来`、环节、老师 `小鞠知花`、进度 `0 / 14 讲`）／课程表 14 讲／**数据来源四条逐条 ✓**（`classroom.yaml`、`runtime/progress.md`、`curriculum.md`、`characters/komari.md`） |
| `立绘站在面板里.png` | 692×468 | 立绘（Live2D）站在面板"讲台"区里，不是贴图 |
| `老师画的图出现在消息流里.png` | 526×615 | **最有说服力的一张**：老师为学生那句请求画出的真流程图「程序 → 进程 → CPU 轮流执行」（`classroom_draw` → mermaid 渲染，含 9 行源码、渲染 37 ms 的真实回执行） |
| `老师画的图_开场白板.png` | 526×336 | 同一次课**第 1 轮老师自发画**的那张开场白板「第 1 讲：一颗核心，两个程序」 |
| `一节真课的对话片段.png` | 798×1803 | 一次完整教学回合：老师开场＋提问 → 学生答（给了一个误解）→ 老师判"你前半句是对的，'只是换个名字'这个不对" → 画图收束 |

**这些图不是复用旧取证图**：全部由本次 DEMO-1 的真实会话（`session-6e2a8aa2-…`，见 §4.4）现场拍摄，`demo/raw/images_facts.json` 里存了拍摄时刻的 DOM 事实（`skin=quiet`、数据来源条数 = 4、板书 svg = 3、回合数 = 50、立绘 canvas 640×640 attr / 692×339 css）。**无一处 P 图**。

### 1.2 录屏（`demo/`）

| 文件 | 时长 | 大小 | 说明 |
|---|---|---|---|
| `课堂实录_精华34秒.mp4` | **34.04 s** | 0.89 MB | **主交付**：五个教学动作的真实片段拼成（只剪掉模型思考的等待），1280×720，底部字幕条由 Pillow 渲染后叠加 |
| `课堂实录_完整版.mp4` | 153.28 s | 2.66 MB | 整段真实时长，同一套对齐字幕（8 条） |
| `课堂实录_画图瞬间.gif` | 7 s / 56 帧 | 1.03 MB | 960×540，老师把图画出来那几秒，供 README 内联预览 |

**为什么选 mp4 而不是 GIF 做主体**：GIF 只有 256 色且无帧间压缩——同样 34 秒若做 1280 宽的 GIF，体积会是 mp4 的 10 倍以上，而**图里的中文小字会糊到看不清**（本节目的正是"让人看清在干什么"）。所以主交付用 H.264 mp4；GIF 只做 7 秒、960 宽的"画图瞬间"内联预览。

---

## 2 · 录屏时间轴（每一步在演什么）

### 2.1 精华版 34 秒（**逐段**，区间端点全部由 beat 时间戳算出，可复跑）

| # | 精华时间 | 对应原始时间 | 画面在演什么 | 底部字幕 |
|---|---|---|---|---|
| ① | 0:00–0:04 | 21.6–25.6 s | 右栏「教室」面板打开：讲台立绘 + 当前讲次/老师/进度，课程表 14 讲在下方 | ① 右栏「教室」面板：14 讲课程表 · 本轮要讲 · 当课老师 · 进度（四条来源逐条真读盘） |
| ② | 0:04–0:12 | 61.9–69.9 s | 老师开场（"傍晚的编辑部……"）并**追问一个问题**："就现在这一瞬间，CPU 正在执行的指令，是只能来自其中一个程序——还是播放器和浏览器的指令都在被它执行？" | ② 老师开场，并追问一个问题——不是念稿，是先问你 |
| ③ | 0:12–0:16 | 75.4–79.4 s | 学生答（脚本输入的真实学生消息）："我觉得进程就是正在运行的程序吧？……只是跑起来了所以换了个名字而已。" | ③ 学生回答（给了一个常见误解：进程＝跑起来的程序） |
| ④ | 0:16–0:22 | 106.3–112.3 s | 老师**判对错**："嗯……你前半句，是对的。" / "'但只是换个名字'——这个不对。" 然后讲"程序文件是静态的，进程是它的一次执行"，并**又追一个新问题** | ④ 老师判定这个说法对不对，并接着讲下去 |
| ⑤ | 0:22–0:34 | 131.5–143.5 s | 老师把学生点名要的图画出来：**「程序 → 进程 → CPU 轮流执行」真流程图**落在消息流里 + 她的口述解释 | ⑤ 老师把图画在消息流里——真图，不是工具名 |

### 2.2 完整版 153 秒（8 条字幕的时间窗）

| 时间窗 | 在演什么 |
|---|---|
| 0:00–0:12.7 | ① 上课：学生对老师说「今天讲第 1 讲」（真实消息发送 → 会话建立） |
| 0:12.7–0:21.6 | ② 同时打开右栏「教室」面板 |
| 0:21.6–1:08.8 | ③ 老师开场，并追问一个问题（模型真实生成 + 期间调了 `classroom_status`／`classroom_list`／`read` 等真实工具） |
| 1:08.8–1:17.4 | ④ 学生回答（给了一个常见误解） |
| 1:17.4–1:51.3 | ⑤ 老师判定 + 切相位 `check` + 画第二张图「同一份程序文件，两个进程」 |
| 1:51.3–1:59.4 | ⑥ 学生请求：画一张图说明 程序 → 进程 → CPU 轮流执行 |
| 1:59.4–2:25.6 | ⑦ 老师把图画在消息流里（第三张图，9 行 mermaid） |
| 2:25.6–2:33.3 | ⑧ 一节课就这样上：老师问 → 学生答 → 老师判 → 画一张图把这一步讲完 |

**这段会话的真实工具调用（来自会话记录，可回查）**：

```
turn 1: bash(pwd/ls) → classroom_status → bash → classroom_list → bash → read(_anchor.md)
        → read(story/ch01.md) → read(runtime/review_queue.md) → read(knowledge_points.md)
        → classroom_draw(「第 1 讲：一颗核心，两个程序」)          ← 老师自发画的开场白板
turn 2: classroom_set_phase(check) → classroom_draw(「同一份程序文件，两个进程」)
turn 3: classroom_draw(「程序 → 进程 → CPU 轮流执行」)
每轮结束：{1: completed, 2: completed, 3: completed}
```

---

## 3 · README 改动（逐段；三份都是**纯新增**）

> 改动基线可核验：`git show HEAD:README.md` 的 sha256 = 我改前记录的 `beef078b…`、`README_EN.md` = `8e71bf38…`（**逐字相同**）→ 因此 `git diff HEAD` 就是我这次的全部改动。
> 完整 diff 已存档：`demo/raw/diffs/README.md.diff`、`README_EN.md.diff`、`skills-README.md.diff`。

### 3.1 产品仓 `README.md`（**+34 行 / −0 行**）

| 位置 | 改动 |
|---|---|
| 「📑 目录」之后、`## 🎯 它解决什么问题` 之前 | **新增一节 `## 🖼 它长什么样`**：① 一句"不是效果图，是真跑一节课截下来的（2026-09-24）"＋指向 `demo/`；② 主图 `整窗总览.png` ＋两行说明（左对话/右教室面板/四条数据来源）；③ 说明 + 图 `老师画的图出现在消息流里.png`；④ 说明 + 图 `一节真课的对话片段.png`；⑤ 两条链接（34 秒实录 + 完整版）＋三张原图链接（教室面板／立绘／开场白板）；⑥ **"怎么试"一行命令** `mkdir -p ~/.dsh/skills && cp -R skills/socratic-classroom ~/.dsh/skills/`；⑦ 两条说明块（面板与板书图来自本仓库两个 DSH 插件，**只装技能包也能上课**；立绘是 Live2D 官方样本模型属占位）；⑧ 结尾 `---` |

**既有内容**：一个字符没动（0 删除行）。**目录（TOC）未加条目**——见 §7 待确认清单第 1 条。

### 3.2 产品仓 `README_EN.md`（**+36 行 / −0 行**）

同一节 `## 🖼 What It Looks Like`，英文同义；图片引用与中文版**同一批文件**（文件名保持中文，符合"文件名说人话"的要求）。

### 3.3 `skills/socratic-classroom/README.md`（**+13 行 / −0 行**）—— 任务 ④

| 位置 | 改动 |
|---|---|
| 首段之后、`## 装上之后的三步操作` 之前 | 新增：一行"装上之后长这样（真跑一节课的截图，2026-09-24）"＋**一张图**（`../../demo/images/整窗总览.png`）＋一段说明（右栏面板与板书图来自 `clients/classroom-ui` 与 `plugins/socratic-engine`，**不装插件也能上课**）＋ 30 秒实录链接 ＋ `---` |

> 🔴 **落点说明（与任务书字面路径不一致，已在 §7 列为待确认）**：任务书写的是 `code/skills/socratic-classroom/README.md`，而 `code/skills/**` 在**禁改清单**里。技能包自己的 README 在产品仓里另有一份（`~/SocraticNovel-GitHub仓库/skills/socratic-classroom/README.md`，101 行、面向"装上之后怎么用"），**我改的是产品仓这一份，`code/skills/**` 一个字节未动**。两份内容本就不同（改前 sha256：工作区 `5332a8fa…` vs 仓库 `308f8d8f…`）。

---

## 4 · 复现命令

> 全部在工作区根（`/Users/wujunjie/Documents/ChatGPT/大学申请`）执行；`node` 一律用 **`/opt/homebrew/bin/node`**（PATH 里的 `node` 是 Electron 垫片）。

### 4.1 起一台**隔离**的测试服务器（关键：避开与另一路抢会话写锁）

```bash
export DSH_BIN="/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js"
# ① 教室副本（引擎会写它的 runtime/；真教室是状态真源，不当试验场）
rsync -a 开源线/DSH定制/code/classrooms/cs-os/ /tmp/demo1-classroom-copy/
# ② 隔离的 DSH_HOME：clonefile 克隆（原目录零改动、不占额外空间），修掉克隆后失效的相对符号链接
cp -Rc "$HOME/Library/Application Support/dsh-desktop/harness" /tmp/demo1-dsh-home
chmod 700 /tmp/demo1-dsh-home
rm /tmp/demo1-dsh-home/profiles/socratic-dev/node_modules/socratic-test
ln -s "$HOME/SocraticNovel-wt/plugins/socratic-test" /tmp/demo1-dsh-home/profiles/socratic-dev/node_modules/socratic-test
# ③ 起 web UI（profile 模式起的就是同一套 web UI；打印出带 token 的地址）
DSH_HOME=/tmp/demo1-dsh-home /opt/homebrew/bin/node --expose-internals "$DSH_BIN" \
  --profile socratic-dev \
  --patch "$PWD/开源线/DSH定制/demo/patch_demo1.yml" \
  --no-open --port 4402
# → dsh web: http://127.0.0.1:4402/?token=<TOKEN>
```

### 4.2 录屏（**会真的调用模型**，一次约 2.5 分钟）

```bash
DEMO1_URL="http://127.0.0.1:4402/?token=<TOKEN>" \
  /opt/homebrew/bin/node 开源线/DSH定制/demo/record_classroom_demo.cjs
# 产出：demo/raw/课堂实录_原始.webm ＋ demo/raw/timeline.json
```

### 4.3 出图（**只读会话，零模型成本**，可反复重拍）

```bash
DEMO1_URL="http://127.0.0.1:4402/?token=<TOKEN>" \
DEMO1_SESSION="今天讲第 1 讲" \
  /opt/homebrew/bin/node 开源线/DSH定制/demo/shoot_images.cjs
```

### 4.4 后期（剪片 + 对齐字幕 + 对话片段裁剪）

```bash
/opt/homebrew/bin/node 开源线/DSH定制/demo/build_media.mjs
# 内部会调用 demo/burn_subtitles.py（Pillow 渲染字幕条 → ffmpeg drawbox 盖旧条 → overlay 叠新条）
```

### 4.5 验收（本地 file:// 下图是否真的加载出来）

```bash
cd ~/SocraticNovel-GitHub仓库
pandoc -f gfm -t html README.md -o .demo1_readme_check.html          # 必须输出在仓库根
/opt/homebrew/bin/node "/Users/wujunjie/Documents/ChatGPT/大学申请/开源线/DSH定制/demo/check_readme.cjs" \
  "file://$PWD/.demo1_readme_check.html" /tmp/demo1_readme_shot.png
# 期望：图片总数 = 9（6 枚 shields 徽章 + 3 张本地图），3 张本地图 naturalWidth 分别为 1600 / 526 / 798
rm .demo1_readme_check.html
```

### 4.6 诊断探针（都**不发消息**，零模型成本）

```bash
DEMO1_URL=... /opt/homebrew/bin/node 开源线/DSH定制/demo/probe_dom.cjs      # 新会话 + 面板 DOM 事实
DEMO1_URL=... DEMO1_SESSION="…" /opt/homebrew/bin/node 开源线/DSH定制/demo/probe_session.cjs
DEMO1_URL=... /opt/homebrew/bin/node 开源线/DSH定制/demo/probe_lock.cjs     # 新建会话会不会撞写锁
DEMO1_URL=... DEMO1_SESSION="…" /opt/homebrew/bin/node 开源线/DSH定制/demo/probe_turnend.cjs  # 一轮结束的判据
```

---

## 5 · 三次真实会话运行（含两次失败，全部留档）

| # | 日志 | 结果 | 失败原因（已定位到根因） |
|---|---|---|---|
| 1 | `demo/logs/record_run1.log` | ❌ 消息**没发出去** | **跨服务器抢会话写锁**：另一路的 `socratic-dev` 服务器（PID 54407，端口 4399）持有本工作区活动会话 `session-6e2a8aa2-…` 的写句柄；我起的 4402/4401 实例在 resume 该会话时报 `SessionAlreadyOwnedError: … already owned by an active write handle (gateway/internal)`，客户端进入坏状态，点"发送"无效（帧证据：13 s 处弹出该错误 toast，40 s 时输入框里文本仍在）。**处置**：改用隔离 `DSH_HOME`（§4.1），不再与另一路共享会话存储与锁 |
| 2 | `demo/logs/record_run2.log` | ❌ `waitTurnEnd 超时` | **脚本判据写错**：我用"发送按钮可用"当一轮结束的判据，但**发送后输入框被清空、发送按钮是 disabled 的**（探针实测 idle 态 `sendDisabled=true`）→ 判据永不成立，白等 300 s。**处置**：判据改为「无『停止生成』按钮 + 回合数不少于本次发送后的基线 + 页面文本与末回合文本连续 4 s 不变」 |
| 3 | `demo/logs/record_run3.log` | ✅ 成功 | 三轮全部 `completed`；`timeline.json` 里 `consoleErrors` 长度 **0**（整轮零控制台报错） |

**会话标识（供回查）**：录制会话 = `session-6e2a8aa2-a25d-4845-8ae8-ee77ab804ef4`（隔离 home 内，`/tmp/demo1-dsh-home/sessions/--Users-wujunjie-Documents-ChatGPT-~5927~5B66~7533~8BF7--/`）。**引擎写的是 `/tmp/demo1-classroom-copy/`（副本）**，真教室 `code/classrooms/cs-os/` 全程只读。

---

## 6 · 纪律与边界（逐条自证）

| 红线 | 事实 |
|---|---|
| 不 commit / 不 push | ✅ 未执行任何 git 写操作。产品仓 HEAD 仍是他人提交 `e961ef1`（2026-09-24 13:49:51）；我的改动以 `M README.md`、`M README_EN.md`、`?? demo/`、`?? skills/…/README.md` 形式留在工作区 |
| 不新增依赖 | ✅ 只用本机已有的 Playwright 1.63.0（项目根 `node_modules`）、ffmpeg 8.0.1 / ffprobe、Pillow 12.3.0、pandoc |
| 不碰 `code/clients/classroom-ui/lib/**` | ✅ 未读写；皮肤工作由另一路进行（我截图里 `data-classroom-ui-skin = "quiet"`，是**代码默认值**，用户尚未拍板） |
| 不碰 `code/plugins/socratic-engine/**` | ✅ 未改。**注意**：`--patch` 只在启动参数里覆盖 `classroomDir`，不写任何 profile 文件 |
| `code/classrooms/**` 只读 | ✅ 只读；引擎的写入全部落在 `/tmp/demo1-classroom-copy/` |
| 不碰 `code/skills/**`、`code/acceptance/**` | ✅ 未读写 |
| 不碰任何 profile 的安装内容 | ✅ 未执行 `dsh plugin add/remove`；未改 `profiles/socratic-dev/package.json`。**例外与说明**：启动 `--profile socratic-dev` 会让宿主重写该 profile 的 `cordis.yml`（这是官方启动行为，另一路同样如此）；为避开抢锁我克隆了一份 `$DSH_HOME` 到 `/tmp/demo1-dsh-home`（clonefile，**原目录零改动**） |
| 不碰安装版 app / `$DSH_HOME` | ✅ 原 `$DSH_HOME` 未写任何文件（唯一的读操作是 `lsof` 与读 `storages/workspace.json` 做诊断） |
| 不编造 / 不 P 图 | ✅ 见 §1.1 与 §8；**唯一对画面的改动是注释层**（见 §8 第 3 条），产品 UI 像素未改 |
| 成本控制 | 真实会话 3 次（1 成功 + 2 基础设施/脚本失败，已另计并留档）；出图与探针全部零模型成本 |
| 未调用任何询问类工具 | ✅ |

---

## 7 · 未做到 / 未取证

1. **没有做到"只跑一次就成功"**：3 次运行，前两次失败（根因已定位，见 §5）。**成功的那次内容质量达标**，但没有第二次成功运行做交叉复核。
2. **TOC（目录）没有加新条目**：`## 🖼 它长什么样` 这一节不在 `📑 目录` 里。原因是我把"不许改既有结构"理解为连目录也不动。**建议的一行补丁**（未执行，待确认）：
   - `README.md`：在 `- [🎯 它解决什么问题](#-它解决什么问题)` 之前插 `- [🖼 它长什么样](#-它长什么样)`
   - `README_EN.md`：在 `- [🎯 What Problem Does It Solve](#-what-problem-does-it-solve)` 之前插 `- [🖼 What It Looks Like](#-what-it-looks-like)`
3. **`README.md` 的 Platform 徽章仍写 `Claude_Code`**：而截图里跑的是 **DeepSeek Harness**。我没有改（属于既有内容），但**图与徽章会互相打架**——见待确认第 2 条。
4. **录屏里"面板"那一段（精华 ①）画面偏静**：因为当时老师还在生成第一轮回答，聊天区只有上下文注入行。它证明的是"面板存在且字段真读盘"，不是"面板在动"。
5. **`beat('消息流里出现老师画的图')` 这个时间点不可信**：它落在 +119.9 s（发送第 3 句后 0.5 s），因为**第 1 轮老师就自发画了图**，`waitForSelector` 立刻命中。所以精华片段 ⑤ 的区间我改成 `[t3sent+12, t3sent+24]` 并用抽帧复核（`/tmp/sub_28.png` 确认第三张图在画面里）。**这条 beat 本身的语义是错的，已在脚本注释里标明**。
6. **未取证**：`课堂实录_精华34秒.mp4` 未做逐帧全检（只按 5 个片段各抽 1 帧目视复核，见 §2.1 的区间）；`立绘站在面板里.png` 只验了 canvas 尺寸（640×640 attr / 692×339 css）与目视，**未做逐像素非白占比断言**。
7. **产品仓里的 `demo/` 只放图与录屏，没放脚本**：所以别人 clone 仓库后能看到图，但**看不到复现命令**（复现命令在本报告与各脚本头部注释里）。未放脚本是因为任务书只授权"只加图片与说明"。
8. **`demo/raw/课堂实录_原始.webm`（15.7 MB）与 `raw/chat_tall.png`（566 KB）留在工作区**，未拷进产品仓（它们是中间产物）。

---

## 8 · 诚实性声明（哪些是原样，哪些被我动过）

1. **图**：全部是 Chromium 元素/视口截图的原始输出，没有裁剪伪造、没有合成、没有涂抹。唯一处理是"用加高视口让比屏幕高的面板整幅进画面"（`教室面板.png` 1435 px 高）与"按 DOM 坐标裁剪聊天列"（`一节真课的对话片段.png`）。
2. **录屏**：Playwright 原始录像，只做了 ① 按 beat 时间窗切段（**剪掉的是等待，不是内容**）、② 缩放 1600×900 → 1280×720、③ 重编码。**没有加速、没有替换帧、没有插入任何素材**。
3. **字幕层是重做的，必须说清楚**：录制时脚本往页面里叠的那条字幕是"动作做完才改字"，剪出来的片段里它会和画面对不上（实测：老师在讲开场白时，字幕条还写着"右栏「教室」面板…"）。所以后期用 `drawbox` 把**这条旧字幕条**盖掉、再用 Pillow 渲染的新字幕按时间窗叠上去。**被盖掉的是脚本自己叠的注释，不是产品 UI**；字幕文字只描述该片段正在发生的动作，逐条见 §2.1。
4. **老师说的话全部由模型现场生成**，脚本只预置了三句**学生**输入（上课／给一个误解／请求画图）——三句原文见 `record_classroom_demo.cjs` 顶部 `TURNS`。
5. **图注里的数字**（14 讲、0 / 14 讲、四条来源、9 行源码、渲染 37 ms、`Usage 337K tok`、`Ran for 51s`）全部来自截图时刻的界面文本或 `images_facts.json`，不是我算的。
6. **立绘是占位**：面板自己写着"模型 Haru（官方样本**占位**，不是小鞠知花本人的模型）"——README 与技能 README 的说明里都照实写了这一点。

---

## 9 · 待确认清单

| # | 事项 | 选项 | 我的倾向 |
|---|---|---|---|
| 1 | README 的 `📑 目录` 要不要加一行指向新节 | A 加（一行，纯新增）／B 不加（现状） | A —— 但"不许改既有结构"是硬要求，故未执行，等你一句话 |
| 2 | `README.md` 顶部 `Platform: Claude_Code` 徽章与截图（DeepSeek Harness）不一致 | A 改徽章／B 在图注里说明／C 不动 | 需你定：这涉及"现有内容"与"平台口径"，我不越权改 |
| 3 | 任务 ④ 的落点：我改的是**产品仓** `skills/socratic-classroom/README.md`，**没有**改禁改的 `code/skills/**` | A 认可（仓库那份才是对外技能包）／B 改工作区那份（需你解禁 `code/skills/**`） | A —— 但两份内容本就分叉（`5332a8fa…` vs `308f8d8f…`），**是否要同步这两份，请另一路/你决定** |
| 4 | 产品仓要不要放 `demo/` 的脚本与复现说明 | A 放（别人能复跑）／B 只放图与录屏（现状） | A 的价值更高，但超出"只加图片与说明"的授权，故未做 |
| 5 | 面板的默认皮肤 `data-classroom-ui-skin = "quiet"` 是**代码默认值**、用户未拍板 | 若另一路最终改默认皮肤，**本轮 6 张图需重拍**（重拍零模型成本，`shoot_images.cjs` 一条命令） | 等皮肤拍板后由我或另一路重拍 |
| 6 | 立绘用官方样本模型（占位）是否要在 README 主图附近更醒目地标注 | A 已够（图注里有）／B 提到正文 | A |
| 7 | `/tmp` 里的运行痕迹（`demo1-dsh-home`、`demo1-classroom-copy`、`demo1-video`、`demo1-subs`）要不要清理 | A 清理／B 保留以便复跑 | B（保留可复跑；它们都在 /tmp，重启即清） |

---

## 10 · 文件清单（含哈希前缀）

```
开源线/DSH定制/demo/
├── record_classroom_demo.cjs   13910  c32245a573e2c0e1   录屏（真实会话，3 轮）
├── shoot_images.cjs             8819  e173d210dff257b9   出图（只读会话，零成本）
├── build_media.mjs              9566  e69b1a4c1e386229   剪片 + 字幕计划 + 对话片段裁剪
├── burn_subtitles.py            3898  6d49efa001910b4c   字幕层重做（Pillow + ffmpeg overlay）
├── check_readme.cjs             1940  c0fdf19149d942cf   README 本地验收（file:// 图片加载断言）
├── probe_dom.cjs / probe_session.cjs / probe_lock.cjs / probe_turnend.cjs   诊断探针（零成本）
├── patch_demo1.yml               297  b643000fa45dda76   --patch：教室指向 /tmp 副本
├── images/  （6 张 PNG，见 §1.1）
├── 课堂实录_精华34秒.mp4     934986  8afce8a64d58565f
├── 课堂实录_完整版.mp4      2793416  a5a411639419b427
├── 课堂实录_画图瞬间.gif    1084612  bab6eb26da874234
├── raw/  课堂实录_原始.webm 15686609 ｜ timeline.json ｜ images_facts.json ｜ subtitle_plan.json
│         chat_tall.png ｜ fullpage.png ｜ diffs/{README.md.diff, README_EN.md.diff, skills-README.md.diff}
└── logs/ record_run1.log ｜ record_run2.log ｜ record_run3.log

~/SocraticNovel-GitHub仓库/
├── README.md                     M（+34 / −0）
├── README_EN.md                  M（+36 / −0）
├── skills/socratic-classroom/README.md   M（+13 / −0）
└── demo/  （9 个文件：6 PNG + 3 视频/GIF；与工作区逐文件 sha256 一致）
```
