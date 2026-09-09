// host-lookup.ts — "which loaded plugin is the Vault MCP HOST?"
//
// Extracted from main.ts so it is Obsidian-free and therefore testable
// headlessly. THIS FILE IS THE ONE COPY WITH A BEHAVIOURAL TEST
// (`tests/host-lookup.test.mjs`). The other eight satellites carry the same two
// lines inline with a pointer here — the coverage choice is stated plainly in
// the S3c release-fix commit rather than paid for nine times over.
//
// ── WHAT WAS WRONG, AND WHY IT MATTERED LESS HERE THAN IN THE PROVIDER ───────
//
// Every satellite resolved the host by BARE PRESENCE over the id list, with the
// list in the PRE-SPLIT order `["governor", "vault-mcp"]`. Both halves are wrong
// after S3c:
//
//   • the ORDER. `vault-mcp` is the host id again; `governor` is the id of a
//     plugin that is no longer a host. Current first, so a vault carrying both
//     a live pre-split host (under `governor`) and a live post-split host binds
//     the newer one.
//   • the MATCH. `app.plugins.plugins["governor"]` is now the governance
//     PROVIDER, and a bare presence test matches it. A satellite would then read
//     the provider's settings as if they were the host's, and (here) look for
//     the host's read receipts in the provider's folder.
//
// The discriminator is the one `vault-mcp-api`'s `getApi` already uses: a plugin
// counts as the host only if it exposes the plugin-to-plugin `api` object. The
// provider exposes none.
//
// LIVE IMPACT WAS NIL and that is worth recording rather than glossing: every
// satellite's adoption latch closed before S3c, so no live vault re-runs this
// lookup for adoption. It is wrong for a FRESH install, which is the whole
// population from the release onward.
//
// APIVERSION IS DELIBERATELY NOT CHECKED. The SDK checks it because it is about
// to CALL the api; this file only asks whose settings and whose folder to adopt
// from, and a host speaking a future api version still keeps both where it keeps
// them.

/**
 * The host plugin's ids, CURRENT FIRST — the same pair, in the same order, that
 * `vault-mcp-api` reads. The host id moved `vault-mcp` → `governor` at 0.12.0
 * and back to `vault-mcp` at the suite split.
 */
export const HOST_PLUGIN_IDS = ["vault-mcp", "governor"] as const;

/** The shape of a loaded plugin this module reads. Structural — no `obsidian` import. */
export interface HostPluginLike {
  /** The plugin-to-plugin api object. Its PRESENCE is what makes a plugin the host. */
  api?: unknown;
  settings?: unknown;
  manifest?: { dir?: string };
}

/**
 * The loaded Vault MCP host, or undefined when none is loaded.
 *
 * A plugin found under a host id but exposing no `api` is SKIPPED, not treated
 * as a broken host — on the ordinary post-split vault that entry is the
 * governance provider, and falling through to `vault-mcp` is what must happen.
 *
 * Note this is a WEAKER readiness test than the callers need: the host declares
 * `api` as a class property initializer, so it is present from construction,
 * whereas `settings` is declared without one and assigned mid-onload. A caller
 * adopting settings must still treat an undefined `settings` as "host not ready"
 * rather than as "host present, empty settings" — see `adoptFromHostOnce`.
 */
export function findHostPlugin(
  plugins: Record<string, HostPluginLike | undefined> | undefined
): HostPluginLike | undefined {
  for (const id of HOST_PLUGIN_IDS) {
    const host = plugins?.[id];
    if (!host || !host.api) continue;
    return host;
  }
  return undefined;
}
