// host-lookup.ts — "which loaded plugin is the Vault MCP HOST?"
//
// Extracted from main.ts so it is Obsidian-free and therefore testable
// headlessly. It answers exactly one question and it is used for exactly one
// thing: finding the host's plugin directory, so the review pane can be derived
// from the host's write journal. Publishing and seam registration are entirely
// `vault-mcp-api`'s business.
//
// ── WHY THE `api` CHECK IS LOAD-BEARING (the S3c bug this file exists to fix) ─
//
// Before the split there was one plugin, so a bare presence test over
// `["vault-mcp", "governor"]` was a correct test for "the host is loaded".
// After the split it is not, and it fails in the worst possible direction:
// `app.plugins.plugins["governor"]` IS THIS PROVIDER. A bare presence test
// therefore always matched — the provider found ITSELF, called itself the host,
// and reported its own folder as the host's. Two consequences, both silent:
//
//   • the no-host refusal Notice in main.ts became DEAD CODE — `hostPluginDir()`
//     could not return null while this plugin was loaded, which is always; and
//   • with the host absent, the pane mounted on `<provider dir>/journal`, which
//     post-split is the FROZEN pre-split journal the host copied out at
//     adoption. A stale pending queue rendered as the current one, with nothing
//     saying so — the silent-zero class, inverted.
//
// The discriminator is the one `vault-mcp-api` already uses to find the host
// (`getApi`, src/index.ts): a plugin counts as the host only if it exposes the
// plugin-to-plugin `api` object. The provider exposes none, so it can no longer
// match itself, and a genuinely host-less vault reaches the refusal.
//
// TIMING IS NOT A RISK HERE. The host declares `api` as a class PROPERTY
// INITIALIZER (`packages/host/src/main.ts`), so it exists from construction —
// before `onload` runs. There is no window in which the host is in the plugins
// map with no `api`, unlike the host's `settings` field (declared without an
// initializer and assigned mid-onload), which is why the satellites' settings
// adoption has to treat an undefined `settings` as "not ready yet" and this
// lookup does not.
//
// APIVERSION IS DELIBERATELY NOT CHECKED. The SDK checks it because it is about
// to CALL the api; this file only wants to know whose folder holds the journal,
// and a host speaking a future api version still keeps its journal where it
// keeps it. Refusing to mount the pane against an apiVersion-2 host would be a
// worse answer than mounting it.

/**
 * The host plugin's ids, CURRENT FIRST — the same pair `vault-mcp-api` reads,
 * in the same order, and for the same reason: the host id moved `vault-mcp` →
 * `governor` at 0.12.0 and back to `vault-mcp` at the split. Order decides on a
 * vault carrying both a live pre-split host (under `governor`) and a live
 * post-split host (under `vault-mcp`): the newer one must win.
 */
export const HOST_PLUGIN_IDS = ["vault-mcp", "governor"] as const;

/** The shape of a loaded plugin this module reads. Structural — no `obsidian` import. */
export interface HostPluginLike {
  /** The plugin-to-plugin api object. Its PRESENCE is what makes a plugin the host. */
  api?: unknown;
  manifest?: { dir?: string };
}

/**
 * The loaded Vault MCP host, or null when none is loaded.
 *
 * A plugin found under a host id but exposing no `api` is SKIPPED, not treated
 * as a broken host — on the ordinary post-split vault that entry is the
 * governance provider itself, and falling through to `vault-mcp` is what must
 * happen.
 */
export function findHostPlugin(
  plugins: Record<string, HostPluginLike | undefined> | undefined
): { id: string; plugin: HostPluginLike } | null {
  for (const id of HOST_PLUGIN_IDS) {
    const plugin = plugins?.[id];
    if (!plugin || !plugin.api) continue;
    return { id, plugin };
  }
  return null;
}

/**
 * The host plugin's directory, or null when no host is loaded.
 *
 * `manifest.dir` is preferred over an id-derived path for the reason the
 * satellites prefer it too: an in-place id migration leaves folder name and
 * manifest id diverged, so the id-derived path is only the fallback for a host
 * reporting no dir.
 */
export function hostPluginDir(
  plugins: Record<string, HostPluginLike | undefined> | undefined,
  configDir: string
): string | null {
  const found = findHostPlugin(plugins);
  if (!found) return null;
  return found.plugin.manifest?.dir ?? `${configDir}/plugins/${found.id}`;
}
