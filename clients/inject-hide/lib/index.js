/**
 * Host half of the `inject-hide` client plugin.
 *
 * It is deliberately empty. A Loader row mounts a package's host half in node
 * and reads that same package's `dsh.client` declaration to compose the browser
 * roster, so a client-only plugin still needs an importable host module — this
 * is that module, not a placeholder for future work.
 *
 * The whole change lives in the browser half (`lib/client.js`): it shadows the
 * shipped `conversation.chat.node` renderer for the `context` kind and renders
 * nothing for the engine's own injection source. Nothing host-side participates.
 */

/**
 * Mount the host half. Nothing to provide: the browser half owns the rendering.
 * @returns nothing.
 */
export function apply() {}
