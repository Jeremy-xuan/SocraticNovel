// clients/classroom-ui/lib/typert.host.js
//
// 面板服务的 typert **host face** 清单（手工维护，与 `dsh-api-workspace-files/lib/typert.host.js`
// 同构；由 `dsh-typert-loader` 自动导入并注册进 `ctx.typert`）。
//
// 🔴 2026-10-21（B2）：白板那三条（`whiteboardStore` 的 save / load / index）**已整体下线** ——
//    那个服务没有任何浏览器消费者（板书历史改读 `<教室>/runtime/diagrams/index.md`，见
//    `lib/client.js` §6.9），留着它只会让面板继续依赖 `dsh-typert-protocol` + `dsh-atomic-write`，
//    而那两份依赖正是验收铁律③红掉的原因。下线论证见
//    `docs/历史报告/实现报告_B2_去宿主包依赖_2026-10-21.md` §4。
//
// 现在这份清单只剩「叙事只读」两条（`classroomNarrative` 的 status / diaries，「日记」tab 的数据口），
// 在 `typert.narrative.host.js` 里维护，这里把它们**并入同一份 TYPERT**。
//
// 注意：本文件是「契约清单」，不是运行时代码；运行态方法实现在 `narrative-host.mjs`。
// 若改了方法签名/服务名，必须同步改二者，否则 `typert-loader` 校验失败会导致整包激活抛错。

// 叙事只读那两条（`classroomNarrative`：status / diaries，P2「日记」tab 的数据口）
// 在 `typert.narrative.host.js` 里单独维护，这里只是把它们**并入同一份 TYPERT**。
// 🔴 为什么必须并进来：`dsh-typert-loader` 只认 `package.json` 的 `exports["./typert"]`
//    **一个**产物（0.2.1-rc.2 的 `typertExportOf` 只处理字符串或带 `default` 的对象，
//    别的一律不用）。所以「再加一个 `./typert.narrative` 导出」不会被任何人读到；
//    而把 `./typert` 改指向叙事那份，白板的 save/load/index 会整批从注册表里消失。
import { NARRATIVE_INVOCATIONS, NARRATIVE_SERVICE } from './typert.narrative.host.js'

// 🔴 2026-10-19：0.1.5-rc.1 的 dsh-typert-loader 会校验每个 invocation 参数的 codec 必须是
// 🔴 codec 口径（沿革，别照着旧文档改回去）：0.1.5-rc.1 的 loader 要求 codec.schema 是**真的**
//    zod v4 实例（检查 `"_zod" in schema.schema`）；0.2.1-rc.2 改成要一个 **`create()` 工厂**
//    （`requireSchemaProjection`：`typeof value.create !== "function"` → `… has no create() factory`）。
//    本清单里现在只剩叙事那两条，它们的 `_codec(typeSymbol, create, jsonSchema)` 定义在
//    `typert.narrative.host.js`，形状与官方清单同构（`create` 是惰性 zod 工厂）。

export const TYPERT = {
  package: 'classroom-ui',
  face: 'host',
  schemas: [],
  invocations: [
    // ── 叙事只读（P2「日记」tab，见 `lib/typert.narrative.host.js`）──────────────
    //    同样 `service`/`namespace` 一致、`invocation.kind: 'direct'`、codec 带 `create()`。
    ...NARRATIVE_INVOCATIONS,
  ],
  // 🔴 2026-10-19：0.1.5-rc.1 的 typert-loader 要求清单里必须有 `model`（描述宿主暴露给浏览器的
  //    服务形状），缺它会直接判 `TYPERT.model must be an object` 并把整个 profile 拉不起来。
  //    形状对照 `@deepseek-ai/dsh-api-workspace-files/lib/typert.host.js` 的 model 段。
  model: {
    services: [
      // 叙事只读服务的形状（status / diaries）。`types: []`：参数都是 JSON，没有命名类型要导出。
      NARRATIVE_SERVICE,
    ],
    // 0.1.5-rc.1 的 typert-loader 还要求这两项存在（可以是空数组）：事件与对象模型。
    // 0.1.7 起似乎放宽了，但为了在班级服务器的版本上能起来，显式给空数组。
    events: [],
    objects: [],
  },
}
