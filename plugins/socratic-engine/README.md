# socratic-engine（P1 教学引擎 · 骨架 v0.0.1）

SocraticNovel 的**宿主侧教学引擎**：读教室包 manifest，按 `position`+`frequency` **确定性注入**教室内容（不依赖模型自觉读文件），并承载教学相位与教学工具。

> 架构依据：`开源线/DSH定制/形态裁定_初筛_2026-09-23.md`（引擎×内容分离）｜`教室manifest格式_草案_v0.md`（数据侧格式）｜`插件维护难度审计_2026-09-23.md`（包粒度与依赖面）
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
| 教学工具 | `classroom_status`（相位/回合查询） |

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
```

## 开发

```bash
/opt/homebrew/bin/node --test test/manifest.test.mjs test/injector.test.mjs   # 28 项，零 LLM
```

## TODO（骨架未做，避免未验证代码）

- `agent/turn-stopping` 课后自动更新教室 `runtime/`（B2）——需先接 `ctx.sessionProjections`（核心机制，待一次集成实测）
- `on_demand` 块的工具触发路径：对答案逐字回查、知识点读取、画图（M3）
- `render.missing` 语义（M1-B2 待用户拍板：error 还是 default）
- 教室目录自动发现（现由 config 显式指定）
- 跨 turn 注入去重（headless 单 turn 测不到；多 turn 集成测试时关）
