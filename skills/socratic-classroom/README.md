# 苏格拉底式教室 · 技能包

把一整套「教室」交给任何一台装了 DSH 的机器：装一次，新开对话就能上课。

包里自带一个现成的教室：**计算机系教室 · 操作系统**（14 讲，教材正文写到第 7 讲，其余在写）。
你也可以换成自己的教室 —— 只要那个目录里有 `classroom.yaml`。

---

装上之后长这样（真跑一节课的截图，2026-09-24）：

![装上之后长这样：右栏是「教室」面板（14 讲课程表 · 本轮要讲 · 当课老师 · 进度），对话里是老师在讲课]( ../../demo/images/整窗总览.png)

右边那个「教室」面板、以及对话里老师画出来的板书图，来自仓库里的两个 DSH 插件
（[`clients/classroom-ui`](../../clients/classroom-ui) 与 [`plugins/socratic-engine`](../../plugins/socratic-engine)）。
**不装插件也能上课**——技能包本身管的是「教室内容 ＋ 教学法 ＋ 课程表 ＋ 课后存档」，
插件只是把「右栏面板」和「板书图」这两处渲染出来。

30 秒课堂实录：[`../../demo/课堂实录_精华34秒.mp4`](../../demo/课堂实录_精华34秒.mp4)

---

## 装上之后的三步操作

### 第一步：把这个文件夹整个复制到「技能目录」

复制的是**整个 `socratic-classroom` 文件夹**（里面有 `SKILL.md`、`classroom/` 等），不是里面某个文件。
两个位置都行，二选一：

**A. 只给一个项目用** —— 复制到那个项目的根目录下：

```sh
mkdir -p "<你的项目>/.dsh/skills"
cp -R socratic-classroom "<你的项目>/.dsh/skills/"
```

**B. 所有项目都能用**（推荐）—— 复制到你的 DSH 主目录下：

```sh
mkdir -p ~/.dsh/skills
cp -R socratic-classroom ~/.dsh/skills/
```

> 如果你装的是桌面版 DSH，主目录可能不在 `~/.dsh`。在 DSH 里随便跑一条 `echo $DSH_HOME`，
> 把结果显示的路径后面接上 `/skills` 就是 B 方案要放的地方。

复制完不用重启，也不用装任何插件。想确认装没装上：新开一个对话，问一句「有哪些技能可用」，
列表里出现 `socratic-classroom` 就成了。

### 第二步：新开一个对话，说一句话开始上课

```
用 socratic-classroom 技能，开始上操作系统课
```

（想用别的教室就说：「用 socratic-classroom 技能，教室目录是 `<路径>`」。）

### 第三步：上课，结束时说「今天到这」

上课过程中正常对话就行 —— 提问、答错、要求讲慢一点，都可以。

**结束的时候一定要说「今天到这」**（或类似的话）。这句话是课后存档的开关：它会让 AI 把进度、
课堂摘要、错题、复习计划写回教室文件。**不说的后果**：下次接着上时，它还停在上一讲。

---

## 想检查教室完不完整

教室自带一个自检命令（需要装 Node）：

```sh
node <技能目录>/socratic-classroom/validate
```

它会报出四件事：教室缺哪些必需文件、课程表里声明的每份材料是不是真的在磁盘上、
声明的讲次有没有超出教室讲数、教材正文还缺哪几讲。

- 退出码 `0` = 全部通过；`1` = 查出问题（逐条打印出来）；`2` = 连检查都做不了（目录或解析器缺失）。
- **报「缺第 N 讲正文」是正常的** —— 教室正文还在写。它不是脚本报错，是内容进度。

---

## 目录里有什么

| 路径 | 作用 |
|---|---|
| `SKILL.md` | 技能本体。DSH 在会话开始时只读它的名字和一句话说明；真正上课时才读全文 |
| `classroom/` | **教室内容**（自包含副本）。课程表、知识点、故事节点、教材正文、教师人格、世界观、纪律便条、运行记录，都在这里 |
| `validate` | 自检命令（依赖声明在 `package.json`，经 `npm ci` 安装） |
| `sync-classroom.sh` | 把源教室目录同步进 `classroom/`（改教室内容后跑一次，副本才跟上） |

### 依赖来源

`validate` 只用 Node 内置模块，外加一个 YAML 解析器 `yaml`（**钉在 2.6.1**）。

它是本技能包**自己声明的依赖**（见 `package.json` 的 `dependencies` 与 `package-lock.json`），
与教学引擎 `plugins/socratic-engine` 使用的同一包、同一版本——不引入其他任何包。
安装方式：

```sh
cd skills/socratic-classroom
npm ci        # 按 package-lock.json 精确装回 yaml@2.6.1，写到 node_modules/（已被 .gitignore 忽略，不入库）
```

> ⚠️ `node_modules/` **不入库**（见仓库根 `.gitignore`）。干净 checkout 里没有它，
> 必须先 `npm ci` 再跑 `validate`／`npm test`，否则 `require('yaml')` 失败、自检直接退出码 2。
>
> 为什么不用手写解析：`classroom.yaml` 的解析结果决定了自检报不报得出问题，
> 手写一个"够用"的解析器会在它不认识的结构上悄悄少报 —— 那正是自检最不该犯的错。

### 副本与源教室的关系（🔴 谁是真源）

`classroom/` 是 `classrooms/cs-os/` 的**生成镜像（generated mirror），不是第二真源**。
真正的教室内容只写在 **`classrooms/cs-os/`**，技能包里的 `classroom/` 只是它的同步副本：

```sh
sh sync-classroom.sh              # 从默认源教室（classrooms/cs-os）同步
sh sync-classroom.sh <教室目录>    # 从别的教室同步
```

**同步是确定性的**：脚本用 `rsync -a --delete`，会让 `classroom/` 与源字节一致
（源里删掉的文件在副本里也删掉）。改了 `classrooms/cs-os/` 之后必须手动跑一次同步，
否则副本会旧——这正是「镜像」与「真源」的关系，**任何改动都应落在 `classrooms/cs-os/`，
再同步到 `classroom/`**。

**代价说清楚**：复制 = 包体积翻倍，且源教室更新后必须手动跑一次同步，否则副本会旧。
换来的好处是「一个文件夹复制过去就能用」，不依赖任何外部路径。
