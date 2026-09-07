// settings.ts — the satellite's own settings shape, its field definitions, and
// the ONE-SHOT adoption of the host's `modules.provenance.config`.
//
// ── Why adoption exists ──────────────────────────────────────────────────────
//
// Before this extraction the provenance surface was a capability MODULE inside
// the Governor host, and its configuration lived in the host's data.json at
// `modules.provenance.config` — the plugin-notes root, the notes layout, and the
// audit note's path. A user who upgrades gets a brand-new plugin with a
// brand-new, EMPTY data.json. For provenance an empty config is not merely
// cosmetic: `notesDir` and `auditNote` are the two settings #257 exists because
// of. A vault that pointed the audit somewhere other than the shipped default
// and then lost that pointer would either scan a folder that no longer holds its
// plugin notes (reporting a clean vault it never looked at) or aim a WRITE at a
// note it does not own — which the destination guard refuses, loudly, but only
// after the user has been told the audit is broken. So the satellite adopts the
// host's values once, on first load.
//
// Three rules, all deliberate, and identical to the skills, triage,
// cross-session and bases satellites':
//
//   1. IT NEVER WRITES THE HOST'S SETTINGS. Not to delete the adopted keys, not
//      to mark them migrated, not at all. The host's settings shape is the
//      host's; a satellite reaching into another plugin's data.json to tidy up
//      is exactly the boundary this split exists to draw. The host's copy stays
//      where it is and simply stops being read (the module is gone from the
//      host, so nothing reads it there either).
//   2. IT RUNS ONCE. `adoptedFromHost` latches, so a later host edit does not
//      reach back in and overwrite what the user has since set here.
//   3. THE SATELLITE'S OWN VALUES WIN. If this plugin already has config keys
//      (host installed after the satellite, say), adoption fills only the gaps.
//
// If the host is ABSENT at first load, nothing is adopted and the latch is NOT
// set — the satellite keeps its defaults, and if the host shows up later the
// adoption still gets its one chance. The same is true when the host is present
// but its `settings` is still UNDEFINED: the host declares that field without an
// initializer and assigns it mid-onload, so an instance visible in the plugins
// map before that assignment is HOST NOT READY, not "host with empty settings".
// Treating it as the latter burns the one-shot latch on nothing and the user's
// config never adopts — found by the review of the skills extraction, and the
// reason the check in main.ts is `!== undefined` rather than a truthiness test.
//
// EVERY FAILURE PATH HOLDS THE LATCH OPEN so the next load retries. That is the
// cross-session review's lesson (2026-09-05), where a swallowed `saveData`
// failure burned the latch while the log said adoption had succeeded: the latch
// lives in the SAME object `saveData` persists, so main.ts only treats it as
// burned once that write has resolved. `adoptHostConfig` below is pure — it
// returns the settings to persist and decides nothing about persistence — which
// is what makes that testable.
//
// ── IS THERE A SECOND ADOPTION? NO, AND THAT WAS CHECKED ─────────────────────
//
// The cross-session satellite needed a SECOND, separately-latched adoption
// because it had live operational state outside data.json (`crosssession-
// receipts.json`, in the HOST's plugin directory). This surface has none, and
// the absence is a finding rather than an oversight:
//
//   * the pure core (src/kernel/*) reads and writes NOTHING but the injected
//     ProvenanceSource — four vault primitives, no file handles, no `fs`;
//   * the only write anywhere in this package is `ProvenanceWriter.writeNote`,
//     which writes ONE vault NOTE (the audit) — a note the vault already owns
//     and that stays exactly where it is across the extraction;
//   * nothing in the module ever read or wrote the host's plugin directory:
//     `manifest.dir`, `install-id`, the journal directory and any `*.json` state
//     file are all absent from the module's source. The audit's own freshness
//     witness lives in the audit note's own frontmatter, in the vault.
//
// So the three config keys are the whole migration. Pinned by a test over
// DEFAULT_PLUGIN_SETTINGS' key set, so a second latch cannot be added without
// the claim above being revisited.

import { DEFAULT_PROVENANCE_CONFIG, DEFAULT_NOTES_DIR, DEFAULT_AUDIT_NOTE } from "./kernel/index.js";

/** The satellite's persisted settings (its own data.json). */
export interface ProvenancePluginSettings {
  /** Config overrides, keyed exactly as the host's `modules.provenance.config`
   *  was — same key names, same meanings — so adoption is a straight copy and a
   *  hand-migrated file works too. Missing keys fall back to
   *  DEFAULT_PROVENANCE_CONFIG via `provenanceConfigOf`. */
  config: Record<string, unknown>;
  /** The one-shot config-adoption latch (rule 2 above). */
  adoptedFromHost: boolean;
}

export const DEFAULT_PLUGIN_SETTINGS: ProvenancePluginSettings = {
  config: {},
  adoptedFromHost: false,
};

/** Coerce whatever `loadData()` returned into a settings object. A hand-edited
 *  or corrupt data.json degrades to the defaults rather than throwing during
 *  onload — the same skip-and-report discipline `provenanceConfigOf` uses. */
export function settingsOf(raw: unknown): ProvenancePluginSettings {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const config = r.config && typeof r.config === "object" && !Array.isArray(r.config)
    ? { ...(r.config as Record<string, unknown>) }
    : {};
  return {
    config,
    adoptedFromHost: r.adoptedFromHost === true,
  };
}

/** The config keys adoption carries across — exactly the fields the host's
 *  provenance module manifest declared. An unknown key in the host's record is
 *  NOT copied: it was never a provenance config field, and copying it would
 *  import someone else's mistake. */
export const ADOPTABLE_KEYS: readonly string[] = Object.keys(DEFAULT_PROVENANCE_CONFIG);

/**
 * The pure half of config adoption. Returns the settings to persist, or `null`
 * when there is nothing to do (already adopted, or the host is absent / not
 * ready).
 *
 * `hostSettings` is the host plugin's own settings object, read but never
 * written. A host that is present with no provenance config still LATCHES: the
 * question was asked and answered, and re-asking every load would let a much
 * later host edit reach in.
 */
export function adoptHostConfig(
  current: ProvenancePluginSettings,
  hostSettings: unknown,
): ProvenancePluginSettings | null {
  if (current.adoptedFromHost) return null;
  if (!hostSettings || typeof hostSettings !== "object") return null; // host absent / not ready — try again next load
  const modules = (hostSettings as { modules?: unknown }).modules;
  const provenance = modules && typeof modules === "object"
    ? (modules as Record<string, unknown>).provenance
    : undefined;
  const hostConfig = provenance && typeof provenance === "object"
    ? (provenance as { config?: unknown }).config
    : undefined;
  const adopted: Record<string, unknown> = {};
  if (hostConfig && typeof hostConfig === "object" && !Array.isArray(hostConfig)) {
    for (const key of ADOPTABLE_KEYS) {
      const value = (hostConfig as Record<string, unknown>)[key];
      // Rule 3: the satellite's own value wins where it already has one.
      if (value !== undefined && !(key in current.config)) adopted[key] = value;
    }
  }
  return { ...current, config: { ...current.config, ...adopted }, adoptedFromHost: true };
}

/** What one adoption attempt concluded. `persisted: false` is the case the
 *  cross-session review was written about: the write FAILED, so `settings` is
 *  the caller's UNCHANGED object — latch still open — and the next load retries. */
export interface AdoptionOutcome {
  /** The settings the plugin should now hold. Unchanged unless the adopted
   *  object actually reached disk. */
  settings: ProvenancePluginSettings;
  /** True only when something was adopted AND persisted. */
  adopted: boolean;
  /** False only when `save` threw. */
  persisted: boolean;
}

/**
 * The whole adoption step, with persistence INJECTED so the latch discipline is
 * headlessly provable rather than only promised.
 *
 * The rule it implements: EVERY FAILURE PATH HOLDS THE LATCH OPEN. The latch
 * lives inside the same object `save` persists, so the adopted object replaces
 * the current one only after that write has resolved. A throwing `save` leaves
 * `adoptedFromHost` false both in memory and on disk, and the next load tries
 * again — instead of a burnt latch and a log line claiming success, which is
 * exactly what the cross-session extraction shipped and its review caught.
 */
export async function runConfigAdoption(
  current: ProvenancePluginSettings,
  hostSettings: unknown,
  save: (settings: ProvenancePluginSettings) => Promise<void>,
): Promise<AdoptionOutcome> {
  const next = adoptHostConfig(current, hostSettings);
  if (!next) return { settings: current, adopted: false, persisted: true };
  try {
    await save(next);
  } catch {
    return { settings: current, adopted: false, persisted: false };
  }
  return { settings: next, adopted: true, persisted: true };
}

// ── settings-tab field definitions (pure data; rendered by settings-tab.ts) ──
//
// Ported VERBATIM from the host's provenance module manifest
// (`PROVENANCE_CONFIG_FIELDS`, in `mcp/modules-mount.ts` while the module lived
// there) — same keys, same labels, same help text, minus the
// `modules.provenance.config.` prefixes that no longer name anything. (The
// host's own field help never spelled that prefix; the surrounding manifest and
// the host's config tab did. Nothing shipped from this package may point at it:
// a string naming a path that does not exist is worse than no string, and a test
// pins that over both the field help AND the tool descriptions.) The host
// rendered these through its generic manifest-driven config tab; this plugin
// renders them itself. The help text is the user-facing documentation of each
// key, so it moves with the keys rather than being rewritten.

export type ProvenanceFieldType = "text";

export interface ProvenanceField {
  key: string;
  label: string;
  type: ProvenanceFieldType;
  help: string;
}

export const PROVENANCE_FIELDS: ProvenanceField[] = [
  {
    key: "notesDir",
    label: "Plugin-notes root",
    type: "text",
    help:
      "Vault-relative folder holding the per-plugin notes the audit reconciles against installed/enabled plugins. " +
      `Blank ⇒ the default (${DEFAULT_NOTES_DIR}).`,
  },
  {
    key: "notesSource",
    label: "Notes layout",
    type: "text",
    help:
      '"jd-slots" (default) — one JD slot per repo under the root, the folder note carrying `github-repo:`. ' +
      '"flat" — one note per plugin directly in the root, each carrying `plugin.id`. ' +
      "An explicit `plugin.id` is authoritative in both layouts; slot matching is deliberately strict and " +
      "reports what it cannot place rather than guessing.",
  },
  {
    key: "auditNote",
    label: "Audit note path",
    type: "text",
    help:
      "Vault-relative path of the audit note itself — a NOTE path including the .md filename, not a folder. " +
      `Blank ⇒ ${DEFAULT_AUDIT_NOTE} in jd-slots mode; in FLAT mode blank derives the name from the notes root instead. ` +
      "It is a path rather than a folder because naming a note " +
      "after its folder is the JD folder-note convention: derived from a slot root it would resolve onto that " +
      "folder's own note and rewrite it.",
  },
];
