// settings.ts — the satellite's own settings shape, its field definitions, and
// the ONE-SHOT adoption of the host's `modules.fileclass.config`.
//
// ── Why adoption exists ─────────────────────────────────────────────────────
//
// Before this extraction the fileclass surface was a capability MODULE inside
// the Governor host, and its configuration lived in the host's data.json at
// `modules.fileclass.config` — one key, `binaryPath`, an explicit override for
// the `fileclass` CLI binary. A user who upgrades gets a brand-new plugin with a
// brand-new, EMPTY data.json. An empty `binaryPath` is not a safety hole (blank
// is the documented "auto-detect" value), but a user who set it did so because
// the probe did NOT find their binary — so losing it means the plugin publishes
// NOTHING and reads as "the fileclass tools are gone", not as "a setting was
// lost". So the satellite adopts the host's value once, on first load.
//
// Three rules, all deliberate, identical to the skills, triage, cross-session
// and bases satellites':
//
//   1. IT NEVER WRITES THE HOST'S SETTINGS. Not to delete the adopted key, not
//      to mark it migrated, not at all. The host's settings shape is the host's;
//      a satellite reaching into another plugin's data.json to tidy up is
//      exactly the boundary this split exists to draw. The host's copy stays
//      where it is and simply stops being read (the module is gone from the
//      host, so nothing reads it there either).
//   2. IT RUNS ONCE. `adoptedFromHost` latches, so a later host edit cannot
//      reach back in and overwrite what the user has since set here.
//   3. THE SATELLITE'S OWN VALUES WIN. If this plugin already has the key (host
//      installed after the satellite, say), adoption fills only the gaps.
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
// AND EVERY FAILURE PATH HOLDS THE LATCH OPEN, including a persist failure.
// That is the cross-session review's lesson (2026-09-05): there, both a failed
// read and a failed write were swallowed into their happy-path shapes, the latch
// was burned, and live state was permanently dropped while the log said it had
// been adopted. Here `main.ts` only records the latch AFTER `saveData` resolves,
// and a throw leaves it open for the next load. Pinned by test.
//
// ── There is NO second adoption, and that is a checked fact ────────────────
//
// Cross-session needed one because it had LIVE OPERATIONAL STATE outside
// data.json — a receipt file in the host's plugin directory. This surface has
// none: it is a subprocess proxy end to end. It writes no state file, keeps no
// cache across calls, and the only thing it ever persisted anywhere was the one
// config key above. Recorded so the absence is a finding rather than an
// oversight, and pinned by a test over DEFAULT_PLUGIN_SETTINGS' key set.

/** The satellite's persisted settings (its own data.json). */
export interface FileclassPluginSettings {
  /** Config overrides, keyed exactly as the host's `modules.fileclass.config`
   *  was — same key name, same meaning — so adoption is a straight copy and a
   *  hand-migrated file works too. */
  config: Record<string, unknown>;
  /** The one-shot config-adoption latch (rule 2 above). */
  adoptedFromHost: boolean;
}

/** The shipped defaults, ported verbatim from the host's
 *  `DEFAULT_FILECLASS_CONFIG`. Blank `binaryPath` is the documented
 *  "auto-detect on the standard install paths" value, not a missing setting. */
export const DEFAULT_FILECLASS_CONFIG: Record<string, unknown> = { binaryPath: "" };

export const DEFAULT_PLUGIN_SETTINGS: FileclassPluginSettings = {
  config: {},
  adoptedFromHost: false,
};

/** Coerce whatever `loadData()` returned into a settings object. A hand-edited
 *  or corrupt data.json degrades to the defaults rather than throwing during
 *  onload — the same skip-and-report discipline the config validation uses. */
export function settingsOf(raw: unknown): FileclassPluginSettings {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const config =
    r.config && typeof r.config === "object" && !Array.isArray(r.config)
      ? { ...(r.config as Record<string, unknown>) }
      : {};
  return { config, adoptedFromHost: r.adoptedFromHost === true };
}

/** The config keys adoption carries across — exactly the fields the host's
 *  fileclass module manifest declared. An unknown key in the host's record is
 *  NOT copied: it was never a fileclass config field, and copying it would
 *  import someone else's mistake. */
export const ADOPTABLE_KEYS: readonly string[] = Object.keys(DEFAULT_FILECLASS_CONFIG);

/**
 * The pure half of config adoption. Returns the settings to persist, or `null`
 * when there is nothing to do (already adopted, or the host is absent / not
 * ready).
 *
 * `hostSettings` is the host plugin's own settings object, READ and never
 * written. A host that is present with no fileclass config still LATCHES: the
 * question was asked and answered, and re-asking every load would let a much
 * later host edit reach in.
 */
export function adoptHostConfig(
  current: FileclassPluginSettings,
  hostSettings: unknown,
): FileclassPluginSettings | null {
  if (current.adoptedFromHost) return null;
  if (!hostSettings || typeof hostSettings !== "object") return null; // host absent / not ready — try again next load
  const modules = (hostSettings as { modules?: unknown }).modules;
  const fileclass =
    modules && typeof modules === "object" ? (modules as Record<string, unknown>).fileclass : undefined;
  const hostConfig =
    fileclass && typeof fileclass === "object" ? (fileclass as { config?: unknown }).config : undefined;
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

/** Validate the config: `binaryPath`, when present, must be a string. (An empty
 *  string is the documented "auto-detect" value.) Ported verbatim from the
 *  host's `validateFileclassConfig`. */
export function validateFileclassConfig(config: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (config.binaryPath !== undefined && typeof config.binaryPath !== "string") {
    problems.push("binaryPath must be a string (an absolute path, or blank to auto-detect)");
  }
  return problems;
}

/** The effective config: the user's overrides layered over the shipped
 *  defaults. Read per call by the tool layer, never captured. */
export function fileclassConfigOf(config: Record<string, unknown>): Record<string, unknown> {
  return { ...DEFAULT_FILECLASS_CONFIG, ...config };
}

// ── settings-tab field definitions (pure data; rendered by settings-tab.ts) ──
//
// Ported verbatim from FILECLASS_CONFIG_FIELDS in the host's
// mcp/modules-mount.ts — same key, same label, same help text, minus the
// `modules.fileclass.config.` prefix that no longer names anything. The host
// rendered them through its generic manifest-driven config tab; this plugin
// renders them itself. The help text is the user-facing documentation of the
// key, so it moves with the key rather than being rewritten.

export interface FileclassField {
  key: string;
  label: string;
  type: "text";
  help: string;
}

export const FILECLASS_FIELDS: FileclassField[] = [
  {
    key: "binaryPath",
    label: "fileclass CLI path",
    type: "text",
    help:
      "Absolute path to the `fileclass` CLI binary. Blank ⇒ auto-detect on the standard install paths " +
      "(/usr/local/bin, /opt/homebrew/bin, ~/.local/bin, ~/.npm-global/bin, /usr/bin). The tools are published only " +
      "when BOTH the Fileclass plugin is installed+enabled AND this binary is found.",
  },
];
