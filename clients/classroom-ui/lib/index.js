/**
 * Host half of the `classroom-ui` client plugin.
 *
 * 右栏「教室」面板（curriculum / current lesson / current phase / progress）仍由浏览器半边
 * （`lib/client.js`）从教室自己的文件读取，无需宿主侧代码。
 *
 * 本文件新增：挂载「白板存储」Remote 服务（S3 宿主接线）。它与 `dsh-api-workspace-files`
 * 同构 —— 通过 `@deepseek-ai/dsh-typert-protocol` 暴露 `whiteboardStore` 服务，浏览器半边
 * 经 `ctx.remote.whiteboardStore` 调用（save / load / index）。服务的 host face 清单在
 * `lib/typert.host.js`，由 `dsh-typert-loader` 自动注册进 `ctx.typert`。
 */

import { WhiteboardStore } from './whiteboard-host.mjs'

/**
 * Mount the host half.
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主 cordis 上下文
 */
export function apply(ctx) {
  // 注册白板存储服务（connection + fs 鉴权、原子写、rev409、路径边界都在 WhiteboardStore 内）。
  // 以 fiber effect 挂载，插件卸载时自动卸载。
  //
  // 🔴 2026-10-19：**幂等注册**。实测该包在 profile 里会被加载两次（`dsh.client.inject` 的依赖面
  //    与 `dsh.profile.bundles` 各触发一次），第二次 `ctx.provide('whiteboardStore')` 直接抛
  //    `service "whiteboardStore" has been registered`，整个 profile 起不来。
  //    （曾经试过把本包 `cordis.patch.yml` 置空来规避 —— 那样更糟：Loader 里没有本包条目，
  //      前端半边根本不下发，面板与白板一起消失。）
  //    所以正确做法是保留 patch、这里判一下已存在就跳过：只可能少注册一次，不可能把实例弄挂。
  ctx.effect(() => {
    // 已存在就跳过（`ctx.whiteboardStore` 由 provide 注入；读不到时下面还有一层兜底）
    let existing = null
    try { existing = ctx.whiteboardStore } catch { existing = null }
    if (existing) return
    try {
      return ctx.provide('whiteboardStore', new WhiteboardStore(ctx))
    } catch (error) {
      // 只吞「已经注册过」这一种：说明另一个加载面先注册了，本次不重复即可。
      // 其他错误照原样抛，不许静默。
      if (/has been registered/.test(String(error && error.message))) return
      throw error
    }
  }, 'classroom-ui: whiteboardStore')
}
