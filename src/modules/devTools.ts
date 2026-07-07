/**
 * Dev-loop tools: reload / install plugins from inside Zotero.
 * Gated by eval.enabled — installing an XPI is arbitrary-code execution,
 * same trust level as run_javascript.
 */

// Must exceed the synchronous response flush+close (which completes before any timer fires);
// 500ms is pure safety margin.
const SELF_OP_DEFER_MS = 500;

function getAddonManager(): any {
  return ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs").AddonManager;
}

/** Reload an installed plugin. Omitting addonId means "reload this plugin itself". */
export async function reloadPlugin(addonId: string | undefined, selfId: string): Promise<any> {
  const AddonManager = getAddonManager();
  const targetId = addonId || selfId;
  const addon = await AddonManager.getAddonByID(targetId);
  if (!addon) throw new Error(`Addon not found: ${targetId}`);
  if (addon.id === selfId) {
    // Reloading ourselves kills this server mid-response: reply first, reload after.
    setTimeout(() => {
      addon.reload().catch((e: any) => ztoolkit.log(`[devTools] self-reload failed: ${e}`, "error"));
    }, SELF_OP_DEFER_MS);
    return { scheduled: true, addonId: addon.id, note: "Self-reload in 500ms; this connection will drop briefly. Reconnect and verify via /mcp/status." };
  }
  await addon.reload();
  return { reloaded: addon.id, version: addon.version };
}

/**
 * Download and install/upgrade a plugin XPI from a URL reachable FROM the Zotero machine.
 * `selfUpgrade` declares whether the XPI is THIS plugin (default true — the common deploy-loop case):
 * self installs are deferred so the response can flush before the server dies; non-self
 * installs run inline and report the installed id/version.
 */
export async function installPluginFromUrl(url: string, selfUpgrade: boolean): Promise<any> {
  if (!/^(https?|file):\/\//i.test(String(url || ""))) {
    throw new Error("URL must be http(s):// or file://");
  }
  const AddonManager = getAddonManager();
  const install = await AddonManager.getInstallForURL(url);
  if (selfUpgrade) {
    setTimeout(() => {
      install.install().catch((e: any) => ztoolkit.log(`[devTools] deferred self-upgrade failed: ${e}`, "error"));
    }, SELF_OP_DEFER_MS);
    return {
      scheduled: true,
      note: "Self-upgrade deferred; this connection will drop. Reconnect and verify the new version via /mcp/status.",
    };
  }
  await install.install();
  // install.addon is populated once install() completes (post-download).
  return { installed: install.addon?.id, version: install.addon?.version };
}
