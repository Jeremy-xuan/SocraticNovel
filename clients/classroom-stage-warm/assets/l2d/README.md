# assets/l2d/ —— 舞台的**vendored 浏览器库**目录

这个目录是舞台唯一被 `/stage-static/l2d/*` 静态路由覆盖的 JS 目录（`lib/index.js` 的
`registerStaticDir('l2d', …)`），所以**新增的浏览器库/模块都放这里**，不需要改宿主路由。

| 文件 | 是什么 | 谁在用 |
|---|---|---|
| `pixi.min.js` | pixi.js **v6.5.2**（IIFE 全量构建） | Live2D 渲染 |
| `live2d.min.js` / `live2dcubismcore.min.js` / `index.min.js` | Live2D Cubism 2.1 core ＋ pixi-live2d-display | Live2D 渲染 |
| `mermaid.min.js` | mermaid **11.17.2**（IIFE 单文件构建） | 板书屏真渲染 |
| （X 车道新增）表情驱动模块 `.js` | — | 由 `ensureStageModule(file)` 按需加载 |

## 加载纪律

1. **pixi 一组、其余一组**：`listLibs()` 给出的 phases 里第一组只有 pixi —— 因为
   `index.min.js` 在**加载期**就要用 `window.PIXI`（`async=false` 保证按插入顺序执行）。
2. **新模块不许塞进 `listLibs()` 的 phases**（契约 K0 第 5 条）：phases 整段被
   `if (!window.PIXI) throw` 门控，Live2D 一挂就连累别的模块。新模块一律走
   `ensureStageModule(file)`（复用 `loadOneScript`，独立缓存，失败可重试）。
3. mermaid 是**按需加载**（3.5 MB，只有真画了板书才拉），不是启动就装。

## mermaid.min.js 的来源

- 逐字节复制自 `clients/classroom-ui/vendor/mermaid-11.17.2/mermaid.min.js`
  （仓库里已经 vendor 的那份，**不引入新依赖**）。
  sha256 = `581ed7d74bd9048d0e3a91363927d72ef22942d7722546b27f7cc29e35390eb8`，两处逐字节相同。
- **为什么复制而不是跨插件引用**：舞台不能依赖"另一个插件恰好装着"——classroom-ui 没装、
  换了版本、或 vendor 目录改名，板书屏立刻白屏。而 git 对相同内容按 blob 去重，
  仓库里实际只存一份。
- 版本纪律（与 classroom-ui 同一条）：**换版本＝重新验证，不得外推**。
  服务端 `classroom_draw` 用同一份构建做 `mermaid.parse()` 判"能不能渲染"，
  浏览器这半边用同一份跑 `mermaid.render()` —— 两端同源，不存在版本漂移。
