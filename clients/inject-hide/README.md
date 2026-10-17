# inject-hide · 让引擎注入的上下文不显示在界面上

> 任务代号 **HIDE-INJECT**。本目录是它的实现产物：manifest ＋ 宿主半边 ＋ 浏览器半边 ＋ node 侧测试。
> 取证素材（A/B 截图与探针 JSON）与真跑脚本**不随包提供**，理由见文末「本仓库不含什么」。

## 一句话

教学引擎注入到会话里的每一块课堂编排（状态块 / 备课清单 / 动画通报），在学生的消息流里
**不再显示**；宿主自己的上下文注入（AGENTS.md、技能目录、跨会话召回）与**别人家插件的注入
一个都不受影响**，正常对话与工具调用也一个都不受影响。

## 它改的是什么（一句话：渲染层的分类，不是样式）

安装版 `dsh-client-ui-chat` 把**一切 `source.kind !== 'user'` 的 `user/message`** 投影成
`kind: 'context'` 的 Chat 节点，并用 `ContextMessageNodeView` 渲染成默认折叠的
「上下文注入 · socratic-engine」行。本插件在**同一个座位的同一格里以更低优先级注册自己**，
于是胜出，然后只做一件事：**分类**。

- 来源是引擎自己的注入 → 返回 `null`；
- 其它任何来源 → **原样委派给宿主原本那个渲染器**（连 props 都是同一个对象）。

委派对象是**算出来的**，三条纪律（细节与理由见 `lib/client.js` 顶部注释）：

- **按组件身份排除自己**，不按优先级值——同格里可能有第三方条目也注册在 -1，它不是本插件，
  本该是可以委派的对象；
- **跳过座位已判退位（abdicated）的条目**，忠实复现 `entriesOfSlot`。公开面**没有退位状态探针**
  （`isLive` 只答"还在台账里"；`snapshot().occupants[].active` 答的是"是不是胜者"，会把被遮蔽的
  活条目也算成 false，拿它当退位判据会误杀），唯一的公开缝是 `onEntryError` 这条**通知**——
  官方文档称它为 *the supervision seam for plugins mirroring contribution health*。故本插件
  按官方说法**镜像一份台账**，挂在 `ctx.effect` 上随插件卸载释放；
- 若该格里**只剩本插件自己**（宿主实现变了/没了）→ **主动抛错退位**，宁可响亮地退位，
  也不静默地把宿主自己的上下文行一并藏掉。

没有 CSS、没有 `display:none`、没有把行高设 0。理由与座契约见 `lib/client.js` 顶部注释。

## 为什么"返回 null"之外还要一条 CSS（**这不是遮掩**）

座位外壳是 `<div class="… flowItem" data-chat-flow-kind="context">`。宿主自己的样式表里有一条
`.flowItem:empty{display:none}`（外加"空 flowItem 不参与相邻间距"的那半条），本意就是
**"这一格没内容 ⇒ 整条不参与布局"**。但它在本机**判不出来**：`renderSlot` 永远会给条目套一个
`display: contents` 的槽位外壳，于是 flowItem 里总有一个子元素、`:empty` 永不成立。

后果是实测出来的：**行高 0，却仍各占一条 `margin-top: var(--dsh-chat-flow-gap)`＝16px**
（10 条注入＝160px 空白；同一份会话的列高只从 994px 降到 754px）。所以本插件补一条规则，
把宿主**本来就想说**的那句话用**宿主的数据属性**（不是它那套带构建哈希的类名）重说一遍：

```css
[data-chat-flow-kind]:has(> [data-slot="conversation.chat.node"]:empty) { display: none; }
```

它不移除任何内容（外壳为空时本来就没有内容），只是让**空盒子彻底退出布局**——
与"把行高设成 0 让它看不见"那类遮掩正相反：那是留一个不可见元素，这是**不留元素**。
补上之后同一份会话列高 **994 → 594px**，那 10 条注入对布局的贡献**精确为 0**。

## 装的与不装的

| 项 | 值 |
|---|---|
| 形态 | **客户端插件**（只有浏览器半边有逻辑，宿主半边是空模块） |
| 依赖 | 无。不新增任何 npm 依赖；只 `require("react")`（宿主平台 seed） |
| 宿主改动 | **零**。不改 `/Applications` 里的 app，不改任何 `@deepseek-ai/*` 包 |
| 落点 | `conversation.chat.node`（keyed / session）的 `context` 键，`priority: -1` |
| 额外 | 一条只引宿主数据属性的空行样式（见上），幂等插入一个 `<style>`，**随插件卸载摘除**（多实例共享时最后一个释放才摘） |
| 台账 | 一份**退位条目**镜像（订阅 `onEntryError`），只在渲染层用来跳过已退位的委派目标 |

## 自检

```bash
# node 侧单测（驱动浏览器半边的同一份产物；22 条）
node clients/inject-hide/test/hide.test.mjs   # ＝ npm test
```

（最后一条会去读**安装版** `@deepseek-ai/dsh-client-ui-chat` 的产物做漂移告警：
`context` 那条一旦开始声明 `priority ≤ -1`，遮蔽就失效，这条就是告警。
未装宿主源码时它**记为「不适用」**（打印 `⊘ N/A`），纯单测照跑、退出码仍为 0——
在别的机器上跑可用 `DSH_INSTALLED_ROOT=<…/node_modules/@deepseek-ai>` 指定安装根。）

## 装进测试 profile（本地包一律 `file:`，绝不用 `link:`）

```bash
# <仓库根> 换成实际克隆路径；只在测试 profile（socratic-dev / socratic-headless）里装，
# 不碰 web / 桌面 profile。
export DSH_BIN="/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js"
node "$DSH_BIN" plugin --profile socratic-dev add "file:<仓库根>/clients/inject-hide"
```

⚠️ **两条装载纪律（实测）**：

1. `dsh plugin add` 会**重算 `dsh.profile.bundles` 列表**——它只保留声明了 `dsh.bundle` 的依赖。
   实测：往 `socratic-dev` 里加本插件时，原来在列表里的 `socratic-test`（没声明 `dsh.bundle`）
   **被移出了 bundles**。要装进真实 profile 的话，装完请核一遍那份列表。
2. 本地 `file:` 安装后，profile 里的文件与工作区**共享 inode**；但任何一次 `edit`/`write`
   都是"写新文件再替换"，会**打断硬链接** → **跑真实会话前必须重新 `add`（先 `remove`）并核哈希**。

## 卸掉（回到"看得见注入行"）

```bash
node "$DSH_BIN" plugin --profile socratic-dev remove inject-hide
```

## 真跑取证（A/B 两相，同一份会话）

本仓库不含真跑脚本（见文末），方法记录如下，四条纪律值得照抄：

1. **起 UI**：独立端口 ＋ `--patch` 覆盖层；`DSH_HOME` 指向 `/tmp` 的克隆（**不碰真 harness**）。
2. **with 相**：新建会话、真发一条消息、等整轮跑完 → 截图 ＋ DOM 探针。
3. **without 相**：卸掉插件、重开**同一份会话**（不跑模型）→ 同点位截图 ＋ 探针。
4. **with-replay 相**：装回插件、重开同一份会话（与 without 相**完全对称**）。

判据：with 相的消息流里没有注入行；without 相重新出现；with-replay 相与 with 相一致。
两相必须**同一份会话**、同一点位，否则量到的是会话差异而不是插件差异。

## 要收窄/放宽范围时改哪里

`lib/client.js` 的 `HIDDEN_KINDS`（白名单）。默认只含 `"socratic-engine"`。
把它填成宿主那四种 kind（`agent-instructions` / `plugin` / `skill-invocation` /
`session-reference`）就等于**连宿主自己的上下文行也一并藏掉**——本插件默认**不**这么做，
且当委派对象不存在时会主动抛错退位，不会静默扩大隐藏范围。

## 升级时的已知风险

- 若宿主把 `context` 那条注册的 `priority` 改到 **≤ -1**，遮蔽失效（注入行重新可见）——
  单测第 22 条（安装版契约检查）就是这条漂移的告警。
- 若宿主把 `context` 渲染器改成 `chain` 座或换 key，本插件的委派目标找不到 → 主动抛错退位
  （注入行重新可见，但**不会**把宿主自己的行藏掉）。
- 🔴 **一处已知的不可判**（不是 bug，是公开面不足）：座位**在挂载前**就已退位、且优先级
  **高于**本插件的条目，从公开面上与"被本插件遮蔽的活条目"**无法区分**（`isLive` 只答台账
  在不在，`snapshot().occupants[].active` 只答是不是胜者）→ 这种情况下委派仍可能落到它头上，
  结果是本条目跟着退位、座位 fallback 接管（降级渲染，**不会**静默藏掉宿主自己的行）。
  能补的两种情形都已补：挂载后的退位走 `onEntryError` 台账，优先级更低的退位走
  "本插件是胜者 ⇒ 更低者必已退位"的推断。

## 本仓库不含什么

| 未收录 | 内容 | 为什么 |
|---|---|---|
| `evidence/` | A/B 两相的截图与 DOM 探针 JSON | 取证素材，绑定取证时的本机环境与会话 |
| `tools/` | 真跑脚本 `e2e-hide-shots.cjs`、覆盖层 `hide-patch.yml` | 含开发机绝对路径，属取证工具而非产品文件 |

因此 `package.json` 的 `files` 只列运行时与文档文件：**测试与取证素材都不进安装副本**
（`dsh plugin add file:` 会按 `files` 白名单裁剪安装副本，列进去反而让"安装副本＝工作区副本"这句话失真）。
