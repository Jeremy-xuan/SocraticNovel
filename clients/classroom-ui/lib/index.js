/**
 * Host half of the `classroom-ui` client plugin.
 *
 * It is deliberately empty. A Loader row mounts a package's host half in node
 * and reads that same package's `dsh.client` declaration to compose the browser
 * roster, so a client-only plugin still needs an importable host module — this
 * is that module, not a placeholder for future work.
 *
 * The panel needs no host-side code: every fact it shows is read from the
 * classroom's own files through the `workspaceFiles` Remote that the web
 * surface already provides (see `lib/client.js` and `README.md` §数据通道).
 */

/**
 * Mount the host half. Nothing to provide: the browser half owns the panel.
 * @returns nothing.
 */
export function apply() {}
