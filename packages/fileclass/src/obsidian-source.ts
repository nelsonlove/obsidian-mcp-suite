// obsidian-source.ts — the plugin's only Obsidian coupling, and it is small.
//
// The fileclass surface is a CLI proxy: the vault is reached by the `fileclass`
// binary talking to the LIVE Fileclass plugin through `obsidian eval`, not by
// this package reading files. So the whole adapter is two questions the tool
// layer must ask about the running app:
//
//   1. Is the Fileclass plugin LOADED? (`app.plugins.plugins.fileclass` — the
//      loaded INSTANCE, never `app.plugins.enabledPlugins`, which can list a
//      configured-but-uninstalled plugin as a stale entry. The host's own
//      plugin-gated tools use the same rule.)
//   2. What is this vault called? (pinned into every CLI call as
//      `--vault <name>`, so a session can never cross into another vault.)
//
// Duck-typed against `app` with no `obsidian` import, so this file compiles and
// bundles like the rest — but it is NOT reached headlessly, exactly like the
// other satellites' adapters. Verify it against a running Obsidian.

import { FILECLASS_PLUGIN_ID } from "./tools.js";

interface AppLike {
  vault: { getName(): string };
  plugins?: { plugins?: Record<string, unknown> };
}

/** Whether the Fileclass plugin is loaded in this app instance. */
export function fileclassPluginPresent(app: unknown): boolean {
  return !!(app as AppLike)?.plugins?.plugins?.[FILECLASS_PLUGIN_ID];
}

/** This vault's name, for `--vault`. */
export function vaultNameOf(app: unknown): string {
  return (app as AppLike).vault.getName();
}
