/**
 * Host half of the `classroom-ui` client plugin.
 *
 * 右栏「教室」面板（curriculum / current lesson / current phase / progress）由浏览器半边
 * （`lib/client.js`）从教室自己的文件读取，无需宿主侧代码。
 *
 * 宿主侧只挂**一个**只读服务 `classroomNarrative`（status / diaries），给面板「日记」tab 用。
 * 它把叙事包的公开出口转成 Remote，**不读**叙事包的内部账本；叙事包没装时两个方法回
 * `{ ok: false, reason: 'narrative-absent' }`（不抛、不让面板崩）。
 * 服务的 host face 清单在 `lib/typert.host.js`（＋ `typert.narrative.host.js`），由
 * `dsh-typert-loader` 自动注册进 `ctx.typert`。
 *
 * 🔴 2026-10-21（B2）：白板 `whiteboardStore` 服务**已下线**（save / load / index 三条一起）——
 *    浏览器半边 0 处调用（板书历史改读 `<教室>/runtime/diagrams/index.md`），它是无消费者的死服务，
 *    却拖着 `dsh-typert-protocol` + `dsh-atomic-write` 两份宿主依赖。
 *    论证见 `docs/历史报告/实现报告_B2_去宿主包依赖_2026-10-21.md` §4。
 */

import { ClassroomNarrative } from './narrative-host.mjs'

/**
 * Mount the host half.
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主 cordis 上下文
 */
export function apply(ctx) {
  // 注册叙事只读服务（「日记」tab）。
  //
  // 🔴 它**总是**被 provide，即使叙事包没装：面板要能拿到 `ctx.remote.classroomNarrative`
  //    这个命名空间，才知道"叙事服务在不在"；如果缺席时连服务都不 provide，浏览器侧只会看到
  //    `remote.classroomNarrative` 是 undefined —— 那样也判得出缺席，但每加一个消费点就要多
  //    一处 `typeof` 防御，且日志里没有一句"为什么没有"。这里统一在一个地方回答。
  //
  // 幂等注册的理由：本包在 profile 里会被加载两次（`dsh.client.inject` 的依赖面与
  // `dsh.profile.bundles` 各触发一次），第二次 `ctx.provide` 会抛 `service … has been registered`。
  ctx.effect(() => {
    let existing = null
    try { existing = ctx.classroomNarrative } catch { existing = null }
    if (existing) return
    try {
      return ctx.provide('classroomNarrative', new ClassroomNarrative(ctx))
    } catch (error) {
      if (/has been registered/.test(String(error && error.message))) return
      throw error
    }
  }, 'classroom-ui: classroomNarrative')
}
