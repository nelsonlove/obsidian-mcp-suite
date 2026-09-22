// GUARDED TERRITORIES — the vault areas Governor must never review, touch, or
// retain copies of.
//
// Extracted from governor/wiring/wiring.ts the day capture became the second
// consumer. Two hand-copied lists of the same territories would drift, and a
// drifted copy here fails PRIVATE: a prefix present in the pane's list but
// missing from capture's means the pane politely skips a folder while capture
// quietly writes its note bodies to disk. One list, two consumers.
//
// `EXCLUDED_PREFIXES` is this module's DEFAULT, not its whole story: the list
// became real configuration at #321/#396, and #397 settled where it lives — on
// the HOST plugin, which publishes it on its api so the governance provider can
// read it without keeping a second copy. A caller passes the operator's list
// into `isExcludedTerritory`'s second argument; a caller that passes none is
// unchanged. `resolveTerritories` below is the one place "blank means default"
// is decided, because two copies of that rule is the drift this module exists
// to prevent one level down.

import { posix } from "node:path";

/**
 * Top-level areas the plugin must never review or touch (guarded territories /
 * hold zones — they are archival or legally sensitive, not live governed
 * content). `80-89` is the legal/PII area with a standing rule that its
 * contents do not leave it.
 *
 * This is the DEFAULT list, used whenever a caller does not supply its own
 * (see `isExcludedTerritory`'s second argument). It remains the single
 * hardcoded fallback so a caller that has no configuration surface of its own
 * — or a configurable caller whose setting is blank — still guards these.
 */
export const EXCLUDED_PREFIXES = ["obsidian-old/", "80-89", "_keep/", "holds/"];

/**
 * Whether a vault path lies inside a guarded territory.
 *
 * `prefixes` defaults to `EXCLUDED_PREFIXES` so every existing caller is
 * unaffected; a caller with its own configurable list (#321) passes it here
 * instead.
 *
 * The path is normalized first (mirroring guard.ts's allowlist check) so a
 * spelling like `./80-89 Divorce/x.md` or `Notes/../80-89 Divorce/x.md`
 * cannot defeat the prefix match. A path that still escapes upward after
 * normalization (`../…`) answers TRUE: this predicate guards retention, so
 * "cannot tell where this points" fails closed, not open.
 */
export function isExcludedTerritory(path: string, prefixes: readonly string[] = EXCLUDED_PREFIXES): boolean {
  const p = posix.normalize(path.replace(/\\/g, "/"));
  if (p.startsWith("..")) return true;
  return prefixes.some((prefix) => p.startsWith(prefix));
}

/**
 * The configured list, or the built-in default when it is blank.
 *
 * ONE definition of "blank means default", because there are now two plugins
 * asking the question and a second copy of this three-line rule is exactly the
 * drift `EXCLUDED_PREFIXES` was centralized to prevent. Entries are trimmed and
 * empties dropped first, so a textarea that a human left with a trailing blank
 * line does not read as a configured list of one empty prefix — which would
 * match EVERY path, since `"".startsWith` is always true. That is the failure
 * this normalization exists to stop, and it fails toward the default rather
 * than toward guarding nothing.
 */
export function resolveTerritories(configured: unknown): readonly string[] {
  // Not an array at all — a hand-edited or Sync-merged `data.json` carrying
  // `guardedTerritories: "80-89"` used to throw here, and the throw surfaced in
  // the settings tab (so the operator could not open settings to repair the
  // value that broke settings) and inside the capture gate (so every read tool
  // call failed). Same discipline the host applies to `cliPolicy`: a malformed
  // value reads as "nothing configured" and falls back.
  if (!Array.isArray(configured)) return EXCLUDED_PREFIXES;
  const list = configured
    // DROP a non-string rather than stringify it. `String(null)` is `"null"` —
    // non-empty, so it would count as a configured entry, replace the default,
    // and match no path: the whole vault unguarded by one bad row.
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    // Strip a leading `./` or `/`. `isExcludedTerritory` normalizes the PATH but
    // not the prefix, so `/Private/` could never match — another way a
    // non-empty list silently guards nothing. A human typing a leading slash
    // means the vault root, which is what the bare form already means.
    .map((p) => p.replace(/^\.?\/+/, ""))
    .filter((p) => p.length > 0);
  return list.length > 0 ? list : EXCLUDED_PREFIXES;
}
