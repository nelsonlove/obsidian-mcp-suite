// territories.ts — the guarded-territory PREDICATE, and nothing else.
//
// A guarded territory is a vault area whose contents must never be RETAINED
// outside the vault. Two plugins consume the predicate: the host (observation
// capture, which writes note bodies to `~/.claude/vault-mcp/observations/`,
// and the conformance rail) and the governance provider (review pane,
// proposals, auto-accept, local history). One predicate, two consumers — a
// second copy would be a PII leak, not a style nit.
//
// THE LIST IS NOT HERE, and that is the ruling (#397, Nelson 2026-09-22). This
// module used to ship a default — four folder names that were ONE operator's
// vault baked into a plugin with a community-submission directory. `80-89`
// means "legal material" only in a Johnny Decimal vault; `obsidian-old/` and
// `_keep/` were that operator's history. A default that is wrong for everyone
// but its author is worse than none, because it manufactures confidence. So:
//
//   • the plugin ships with NO territories configured;
//   • an empty list means "guard nothing", honestly, and the host refuses to
//     turn observation capture ON while it is empty;
//   • the one operator whose folders the old default named gets them written
//     into his own data.json by a one-time migration on upgrade
//     (`LEGACY_TERRITORY_SEED`, host `loadSettings`) — the ONLY reader of that
//     constant, never a fallback.
//
// The same ruling retired the conformance rail's `hold`/`holds` segment
// heuristic and its hardcoded territory labels: with an empty list the rail
// would otherwise still have refused paths, and "empty means nothing" must be
// true or it is not a rule.

import { posix } from "node:path";

/**
 * Top-level areas the plugin must never review or touch (guarded territories /
 * hold zones — they are archival or legally sensitive, not live governed
 * content). `80-89` is the legal/PII area with a standing rule that its
 * contents do not leave it.
 *
 * This is what the plugin USED to ship as its default (#321 → #397). It is
 * not a default any more and nothing falls back to it; see the seed below.
 */
/**
 * The four folders the pre-#397 shipped default named. Read by EXACTLY ONE
 * caller — the host's one-time migration that writes them into an existing
 * install's own settings so that upgrade changes nothing for it. Never a
 * fallback: `resolveTerritories` does not consult this, and an empty
 * configured list is empty. Do not add a second reader.
 */
export const LEGACY_TERRITORY_SEED: readonly string[] = ["obsidian-old/", "80-89", "_keep/", "holds/"];

/**
 * Whether a vault path lies inside a guarded territory.
 *
 * `prefixes` is REQUIRED — there is no default list any more (see the module
 * header). A caller passes the operator's configured list, resolved through
 * `resolveTerritories`; an empty list guards nothing except the upward escape.
 *
 * The path is normalized first (mirroring guard.ts's allowlist check) so a
 * spelling like `./80-89 Divorce/x.md` or `Notes/../80-89 Divorce/x.md`
 * cannot defeat the prefix match. A path that still escapes upward after
 * normalization (`../…`) answers TRUE: this predicate guards retention, so
 * "cannot tell where this points" fails closed, not open.
 */
export function isExcludedTerritory(path: string, prefixes: readonly string[]): boolean {
  const p = posix.normalize(path.replace(/\\/g, "/"));
  if (p.startsWith("..")) return true;
  return prefixes.some((prefix) => matchesTerritoryPrefix(p, prefix));
}

/**
 * The operator's configured list, cleaned. NO FALLBACK: an absent, blank or
 * malformed setting resolves to `[]`, which guards nothing — and the host
 * refuses to enable capture on an empty list, so "nothing" is a visible state
 * rather than a silent one.
 *
 * ONE definition, because two plugins ask the question and a second copy of
 * this rule is the drift a shared module exists to prevent. Every branch here
 * closes a way a NON-EMPTY list could still guard nothing:
 *   • non-array → `[]`, not a throw (a hand-edited or Sync-merged data.json
 *     used to take out the settings tab AND every captured read);
 *   • non-string entries DROPPED, not stringified (`String(null)` is "null" —
 *     an entry that matches no path);
 *   • leading `./` or `/` stripped (`isExcludedTerritory` normalizes the path,
 *     never the prefix, so `/Private/` could never match);
 *   • blanks dropped (`"".startsWith` is true for every path — one stray
 *     newline would have matched the whole vault).
 */
export function resolveTerritories(configured: unknown): readonly string[] {
  if (!Array.isArray(configured)) return [];
  return configured
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim().replace(/^\.?\/+/, ""))
    .filter((p) => p.length > 0);
}

/**
 * Whether `candidate` (a normalized vault-relative path, or one path segment)
 * falls under `prefix` — the ONE boundary rule both plugins use (#321 asked for
 * it by name: "`80-89` never accidentally matches `80-89-archive/`").
 *
 * The rule, exactly: compared case-insensitively; the candidate must start
 * with the entry, and the character right after the entry must not CONTINUE
 * a name — a letter, a digit, `_` or `-` continues it; anything else (end of
 * the candidate, `/`, a space, `.`, `(` …) is a boundary. So `80-89` covers
 * `80-89 Divorce/`, `80-89/` and `80-89 Divorce (old)/` — every folder whose
 * name begins `80-89` and then breaks — but not `80-891/` or `80-89-archive/`.
 * An entry that ends in `/` covers exactly that folder: `Archive/` covers
 * `Archive/old.md` and not `Archive Old/` or `Archives/`. Over-inclusion is the
 * safe direction here (the entry guards a little more, never less), which is
 * why a space is a boundary and not a continuation. The conformance walker
 * decides its descend refusals with this same rule over the same
 * vault-relative paths (see `isExcludedTerritory`).
 */
export function matchesTerritoryPrefix(candidate: string, prefix: string): boolean {
  const c = candidate.toLowerCase();
  const p = prefix.toLowerCase();
  if (!p || !c.startsWith(p)) return false;
  if (c.length === p.length || p.endsWith("/")) return true;
  return !/[\p{L}\p{N}_-]/u.test(c.charAt(p.length));
}
