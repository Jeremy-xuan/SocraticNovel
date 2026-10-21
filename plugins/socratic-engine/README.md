# socratic-engine（P1 教学引擎 · 骨架 v0.0.1）

SocraticNovel 的**宿主侧教学引擎**：读教室包 manifest，按 `position`+`frequency` **确定性注入**教室内容（不依赖模型自觉读文件），并承载教学相位与教学工具。

> 架构依据：`docs/历史报告/形态裁定_初筛_2026-09-23.md`（引擎×内容分离）｜`教室manifest格式_草案_v0.md`（数据侧格式）｜`插件维护难度审计_2026-09-23.md`（包粒度与依赖面）
> 实测证据：`实测报告_双重注入与回合语义_2026-09-23.md`｜`实测报告_P1骨架与装载坑_2026-09-23.md`

## 已实现（集成实测通过）

| 能力 | 机制 |
|---|---|
| manifest 加载与校验 | `lib/manifest.mjs`（M1 v0 schema 子集；14 项错误路径） |
| 系统段注册（`target: system` 块） | `ctx.systemPrompt.section()`，一次性 |
| **每回合注入**（`target: chat` 块） | `agent/pre-step` 的**每 turn 首步**注入，`source.kind='socratic-engine'`，`<system-reminder>` 包装 |
| 注入频率 | `once` / `turn` / `n_turns` / `phase`（门）/ `on_demand`（占位） |
| 状态层模板渲染 | `render.enabled` + `{{phase}}`/`{{turn}}`/`{{classroom}}` |
| 相位与回合自计数 | `lib/phasestore.mjs`（**不依赖宿主 turn 号算术**） |
| 教学工具 | `classroom_status`（相位/回合查询）／`classroom_set_phase`／`classroom_draw`／`classroom_animate*`／**`classroom_express`（表情，EXPR-1）** |

## 安装（🔴 两个坑，务必照做）

```bash
export DSH_HOME=~/Library/Application\ Support/dsh-desktop/harness
DSH_BIN="/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js"
node "$DSH_BIN" plugin --profile <profile> add "file:$HOME/SocraticNovel-wt/plugins/socratic-engine"
```

1. 🔴 **不要**把 `@deepseek-ai/dsh-tools`／`dsh-llm` 等宿主核心包装进 profile 或插件本地 node_modules——会造成**模块实例分裂**（Symbol 失配），工具调用崩在 `Cannot read properties of undefined (reading 'prepare')`。宿主自带解析。
2. 用 **`file:`** 装（`link:` 会让插件从自己路径解析、找不到宿主核心包）。开发循环：`file:` 装一次，之后改完 `cp -R index.mjs lib <profile>/node_modules/socratic-engine/`。

## 配置（profile 的 `cordis.patch.yml`）

```yaml
- id: socratic-engine
  name: socratic-engine
  config:
    classroomDir: /abs/path/to/classroom   # 必填；缺省时插件空转（skill 模式兜底）
    defaultPhase: boot                      # 可选
    enabled: true                           # 可选
    # ── EXPR-1（老师自己决定表情）：不配这段＝表情通道关闭（不注册工具、不挂兜底，只记一条日志）
    expression:
      capabilityFile: /abs/path/to/capability.json   # 🔴 必须是**绝对路径**；键＝模型名的 JSON
      model: Haru                                    # 从产物里挑哪个模型的清单
```

`capabilityFile` 的**形状＝渲染侧能力发现的产物**（键＝模型名），每个模型至少要能让引擎看到这三样：
`expressions[].name`（命名表情）、`parameters[]`（脸部参数 id）、`motionGroups[].name`（动作组名）。
**引擎不硬编码任何表情名／参数名／动作组名**——三条并列手段各取其一，见
`实现报告_EXPR1_表情自主控制_2026-09-24.md` §1–§3。

🔴 **EXPR-2 起，引擎挑哪条路按「名字读不读得懂」算分**（不再按手段类别写死顺序）：
有语义的名字（`Smile`／`Sad`／`ParamEyeLOpen`／`Surprise`）优先 → 无语义编号（`F01`／`expr_3`）
**能用但不优选** → 没有名字可读的排最后；同分才按可靠性次序（命名表情 > 逐参数 > 动作）。
老师显式指定哪条就用哪条。见 `实现报告_EXPR2_表情优先级修正_2026-09-24.md`。

兜底（老师没指定时的推测）**每个 `agent/pre-step` 重算一次**，回合末再算一次——
输入只有"本回合已说出口的文字 ＋ 本会话内老师是否指定过 ＋ 渲染侧能力产物"三样。
表情状态写在教室 `runtime/expression.md`（引擎是唯一写者；格式见同报告 §3）。

## 教学动画与备课（ANIM-ORCH / ANIM-PREP / ALIGN-EXEC）

- 顶层 `animation:` 段（`enabled` 等）控制动画通道：段**缺席** → 引擎不注册动画工具；启用后
  注册 `classroom_animate`（自己写 Manim 脚本）与 `classroom_animate_template`（用预置模板，命中
  课前预热缓存基本不用等）。模板与预热逻辑见 `lib/animtemplates.mjs`／`lib/prepstore.mjs`。
- 顶层 `prep:` 段声明"每一讲课前预先渲染好的动画清单"（`items: []`，一条＝一段要预渲的动画）。
  引擎在回合开头按讲次注入 `prep-list:L<讲次>` 块、并按终态通报 `animation-notice:<任务号>`。
  🔴 死配置守卫：声明了 `prep:` 却没启用 `animation:` → **报错**（不许静默）。
- 动画纪律（见 `index.mjs` 注释）：① 老师**先讲**这一步、再调动画工具；② 引擎侧**不向模型报秒数**
  （同一件事不能两个数——缓存命中与否用定性说法，与 `prep:` 文案一致）。

## 开发

测试零 LLM 成本（纯 node --test，直接吃 `lib/*.mjs` 与 `test/fixtures/`）：

```bash
npm ci                              # 按 package-lock.json 精确装回依赖（node_modules 已被 .gitignore 忽略，不入库）
npm test                            # = node --test test/*.test.mjs，跑全部单测
node --test test/manifest.test.mjs test/injector.test.mjs   # 只跑某个文件
```

> 仓库根 `.gitignore` 已忽略 `node_modules/`；干净 checkout 必须 `npm ci` 后再 `npm test`。

## TODO（骨架未做，避免未验证代码）

- `agent/turn-stopping` 课后自动更新教室 `runtime/`（B2）——需先接 `ctx.sessionProjections`（核心机制，待一次集成实测）
- `on_demand` 块的工具触发路径：对答案逐字回查、知识点读取、画图（M3）
- `render.missing` 语义（M1-B2 待用户拍板：error 还是 default）
- 教室目录自动发现（现由 config 显式指定）
- 跨 turn 注入去重（headless 单 turn 测不到；多 turn 集成测试时关）
