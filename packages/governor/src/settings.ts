// THE PROVIDER'S SETTINGS, AND THE ONE RULE THAT MAKES THE SPLIT SAFE.
//
// This plugin keeps the folder and the `data.json` the pre-split plugin wrote —
// that is what "the provider keeps the id" buys, and it is why the authority
// state under `governance/` needed no migration at all. But that file also holds
// every HOST setting: the allowlist, read-only mode, the scheme instances, the
// CLI policy, the protected-property rows. The host copies its half out once on
// its first load and never writes back here.
//
// SO THIS PLUGIN MUST NEVER TRUNCATE THE FILE. `saveSettings` merges its own
// keys over whatever is already on disk and writes the union. Two reasons, and
// the second is the one that would have been found the hard way:
//
//   1. ORDERING. Obsidian gives no guarantee about which plugin loads first. If
//      this one saved a settings object containing only its own keys before the
//      host had adopted, the host's allowlist and read-only mode would be GONE
//      — and the host's fallback for "nothing to adopt" is DEFAULT_SETTINGS,
//      which is socket enabled, read-only OFF, allowlist EMPTY. The guard config
//      would silently reset to open.
//   2. ROLLBACK. The documented rollback path is: disable both plugins,
//      reinstall the single-plugin build under this id. It reads this same
//      file. Every key it ever wrote has to still be there.
//
// The host half is defined ONCE, in `@vault-mcp/core`'s `splitSettings` — not
// restated here — because a key both plugins claim gets each one's save
// overwriting the other's edit, and a key neither claims is dropped.

import { PROVIDER_SETTING_KEYS } from "@vault-mcp/core";

export interface GovernorSettings {
  /**
   * Whether the review pane is mounted. Was `modules.acceptance.enabled` in the
   * host's module registry; the module row left the host entirely at the split,
   * because the acceptance "module" never contributed an MCP tool — its whole
   * job was to carry this flag and the config block below for a pane that lived
   * somewhere else.
   *
   * DEFAULT OFF, unchanged: the accept pane is opt-in.
   */
  enabled: boolean;
  /**
   * The pane's own knobs — `showRibbonBadge`, `showViewTabBadge`, `acceptedBy`,
   * `gateMode`, `requiredFrontmatterKeys`. Read at pane-wire time through
   * `governanceDisplaySettings` / `governanceAcceptanceSettings`, exactly as
   * before. None of them confers accept capability: `acceptedBy` only labels the
   * human's own gesture, and `requiredFrontmatterKeys` can only make Accept
   * refuse MORE.
   */
  config: Record<string, unknown>;
  /**
   * Local history recording (WP4, D10). DEFAULT OFF: Git retains historical
   * bytes, and D10 makes turning that on a disclosed human choice, never a
   * shipped default. Host settings until the split, and always the provider's
   * facts — the store is the standing chain's evidence.
   */
  historyEnabled: boolean;
  /**
   * The human-chosen history scope (D10) — SEPARATE from any connection
   * allowlist, which can never widen or narrow it. whole-vault records
   * everything minus exclusions; explicit records only the included roots.
   * Exclusions always win, and the guarded territories are always appended at
   * runtime regardless of what this stores.
   */
  historyScope: { mode: "whole-vault" | "explicit"; include: string[]; exclude: string[] };
}

export const DEFAULT_GOVERNOR_SETTINGS: GovernorSettings = {
  enabled: false,
  config: {},
  historyEnabled: false,
  historyScope: { mode: "whole-vault", include: [], exclude: [] },
};

/**
 * Read this plugin's settings out of the raw `data.json` object.
 *
 * It reads BOTH shapes, and that is the whole migration: the pre-split file
 * carries `modules.acceptance.{enabled,config}` and top-level
 * `historyEnabled`/`historyScope`, so those are exactly what this reads. The
 * post-split file adds a top-level `acceptance` block that takes precedence once
 * this plugin has saved. Nothing is rewritten on read — the legacy keys stay in
 * the file for the rollback path, and a save merges over them rather than
 * replacing them.
 *
 * Fails toward NOT recording, like the host's loader did: only an explicit
 * `true` enables history, and a corrupt scope disables recording AND resets to
 * explicit-with-nothing — the shape that records ZERO paths. The first draft of
 * that logic reset to the whole-vault DEFAULT, which is the MOST-recording
 * shape: a user whose explicit include list survived a corrupted mode field
 * would silently have gone from "record Notes/" to "record everything".
 */
export function readGovernorSettings(raw: unknown): GovernorSettings {
  const row = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;

  // The post-split block wins; the pre-split module row is the fallback.
  const own = row.acceptance as { enabled?: unknown; config?: unknown } | undefined;
  const modules = row.modules as Record<string, { enabled?: unknown; config?: unknown }> | undefined;
  const legacy = modules?.acceptance;
  const source = own && typeof own === "object" ? own : legacy;

  const enabled = source?.enabled === true;
  const config =
    source?.config && typeof source.config === "object" && !Array.isArray(source.config)
      ? { ...(source.config as Record<string, unknown>) }
      : {};

  let historyEnabled = row.historyEnabled === true;
  const hs = row.historyScope as GovernorSettings["historyScope"] | undefined;
  let historyScope: GovernorSettings["historyScope"];
  if (
    !hs ||
    (hs.mode !== "whole-vault" && hs.mode !== "explicit") ||
    !Array.isArray(hs.include) ||
    !Array.isArray(hs.exclude) ||
    ![...hs.include, ...hs.exclude].every((x) => typeof x === "string")
  ) {
    historyScope = { mode: "explicit", include: [], exclude: [] };
    historyEnabled = false;
  } else {
    historyScope = { mode: hs.mode, include: [...hs.include], exclude: [...hs.exclude] };
  }

  return { enabled, config, historyEnabled, historyScope };
}

/**
 * The object to persist: everything already on disk, with this plugin's keys
 * merged over the top. See the header for why this is a merge and not a replace.
 *
 * The legacy `modules.acceptance` row is UPDATED IN PLACE as well as written to
 * the new top-level block. That is deliberate redundancy for the rollback path:
 * a reverted single-plugin build reads `modules.acceptance` and would otherwise
 * see whatever the flag was on the day of the split rather than what the human
 * has since chosen.
 */
export function mergeGovernorSettings(existing: unknown, next: GovernorSettings): Record<string, unknown> {
  const base = (existing && typeof existing === "object" && !Array.isArray(existing) ? { ...(existing as Record<string, unknown>) } : {}) as Record<string, unknown>;
  base.acceptance = { enabled: next.enabled, config: { ...next.config } };
  for (const key of PROVIDER_SETTING_KEYS) {
    if (key === "historyEnabled") base.historyEnabled = next.historyEnabled;
    if (key === "historyScope") base.historyScope = { ...next.historyScope, include: [...next.historyScope.include], exclude: [...next.historyScope.exclude] };
  }
  const modules = base.modules && typeof base.modules === "object" && !Array.isArray(base.modules)
    ? { ...(base.modules as Record<string, unknown>) }
    : undefined;
  if (modules && Object.prototype.hasOwnProperty.call(modules, "acceptance")) {
    modules.acceptance = { enabled: next.enabled, config: { ...next.config } };
    base.modules = modules;
  }
  return base;
}
