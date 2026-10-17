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
  ctx.effect(() => ctx.provide('whiteboardStore', new WhiteboardStore(ctx)), 'classroom-ui: whiteboardStore')
}
