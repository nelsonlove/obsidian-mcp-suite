// vault-conventions.ts — the vault-shaped paths the ported legacy packs depend
// on, in ONE place, injectable, and since #403 (ruled 2026-09-26) a HOST
// SETTING with EMPTY defaults: the plugin ships no vault layout.
//
// WHY THIS FILE EXISTS. The four legacy packs are faithful ports of Python
// scripts written for one specific vault, so they necessarily know that vault's
// folder layout: where the registries live, where the plugin-stack note is,
// which template is uid-exempt. That knowledge is legitimate — it is the packs'
// subject matter — but scattering it as string literals through the pack
// sources made it invisible and unchangeable: a different vault could not use
// these packs at all, and changing a path meant a release.
//
// So the keys are named and discoverable in one file. Where they point is the
// operator's: the six keys are a host setting (settings tab, Conformance),
// read live per call by the in-app debt and drift sources, and the standalone
// CLI takes them from `VAULT_MCP_CONVENTIONS` (a JSON object; the old spellings
// `GOVERNOR_VAULT_CONVENTIONS` and `ASSENT_VAULT_CONVENTIONS` are accepted as
// legacy aliases for one release and warned on). An EMPTY key reads as that
// convention DEAD: its packs register, are not measured, and the report says
// so (#298's mechanism). The former shipped values survive only as
// `LEGACY_CONVENTIONS_SEED`, written ONCE into an install whose data.json
// predates the setting, by exactly one reader (`conventions-policy.ts`).
//
// This does NOT make the packs vault-agnostic — a pack that checks "registry
// entries are named consistently" is meaningful only where such a registry
// exists. It makes the coupling explicit and configurable rather than baked in,
// which is the difference between a documented assumption and a hidden one.


export interface VaultConventions {
  /** Root under which the registry families (action/property/type/tag) live. */
  registriesRoot: string;
  /** The governed system spine's root folder. */
  systemRoot: string;
  /** Artifacts root the port checks resolve module/script/template surfaces under. */
  artifactsRoot: string;
  /** The note recording which plugins are live. */
  pluginStackPath: string;
  /** Notes exempt from the uid-coverage check (payload templates, not identity). */
  uidExemptPaths: string[];
  /** Roots the structure pack never treats as governed content. */
  ungovernedRoots: string[];
}

/** The six keys, EMPTY: what the plugin ships. Every scalar key empty reads as
 *  dead (its packs are not measured); the two list keys empty read as "none",
 *  a legitimate configuration (nothing exempt, nothing ungoverned). */
export const EMPTY_VAULT_CONVENTIONS: VaultConventions = Object.freeze({
  registriesRoot: "",
  systemRoot: "",
  artifactsRoot: "",
  pluginStackPath: "",
  uidExemptPaths: [],
  ungovernedRoots: [],
}) as VaultConventions;

/** The keys whose value is one path (a blank one is a DEAD convention). */
export const SCALAR_CONVENTION_KEYS = ["registriesRoot", "systemRoot", "artifactsRoot", "pluginStackPath"] as const;
/** The keys whose value is a list of paths (an empty list is "none", not dead). */
export const LIST_CONVENTION_KEYS = ["uidExemptPaths", "ungovernedRoots"] as const;

/** Coerce an UNTRUSTED settings value (data.json, a hand edit, a partial
 *  object) into a full record: strings trimmed, lists of trimmed non-blank
 *  strings, anything else the EMPTY value for that key. Never throws, never
 *  guesses a path — the same discipline as core's `resolveTerritories`. */
export function resolveConventions(raw: unknown): VaultConventions {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const list = (v: unknown) => {
    const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split("\n") : [];
    return arr.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
  };
  return {
    registriesRoot: str(o.registriesRoot),
    systemRoot: str(o.systemRoot),
    artifactsRoot: str(o.artifactsRoot),
    pluginStackPath: str(o.pluginStackPath),
    uidExemptPaths: list(o.uidExemptPaths),
    ungovernedRoots: list(o.ungovernedRoots),
  };
}

/**
 * The former shipped conventions — one operator's vault as it stood before
 * two renumberings. NOT a default since #403: it is written once, on upgrade,
 * into an install whose data.json predates the `vaultConventions` setting, so
 * that install keeps measuring exactly what it measured (the same pattern as
 * core's territory seed, #397). Exactly ONE reader, `conventions-policy.ts`,
 * pinned by a source scan; a second reader is the shipped default coming back
 * under another name.
 */
export const LEGACY_CONVENTIONS_SEED: VaultConventions = {
  registriesRoot: "00-09 System/00 System management/00.05 Registries for the system",
  systemRoot: "00-09 System",
  artifactsRoot: "00-09 System/02 Obsidian/02.03 Artifacts for 02 Obsidian",
  pluginStackPath: "00-09 System/02 Obsidian/02.12 Plugin stack.md",
  uidExemptPaths: [
    "00-09 System/00 System management/00.05 Registries for the system/Daily notes/Daily note.template.md",
  ],
  // The framework corpus, ungoverned since it is written as prose rather than
  // filed as vault content. It was the vault-root `Assent/` tree; it was
  // refiled under 00.89 (2026-08-17) and that folder was then renamed from
  // `Assent` to `obsidian-governor` (2026-08-19). One prefix now covers both
  // it and the `Vault archaeology` corpus, which moved inside it — the old
  // bare `"Vault archaeology"` root no longer resolves anywhere in the vault.
  // Renamed again to `obsidian-mcp-suite` with the repo (2026-09-22); the
  // path is a fact about the vault, corrected as one.
  ungovernedRoots: ["00-09 System/00 System management/00.89 obsidian-mcp-suite"],
};

/** The CLI's environment knob for the conventions, and its two legacy spellings. */
export const CONVENTIONS_ENV = "VAULT_MCP_CONVENTIONS";
export const CONVENTIONS_ENV_LEGACY = ["GOVERNOR_VAULT_CONVENTIONS", "ASSENT_VAULT_CONVENTIONS"] as const;

/**
 * Conventions for a standalone CLI invocation, from the environment. This is
 * the CLI's ONLY source (the in-app sources read the host setting), and it
 * is not a default: unset means EMPTY, every scalar convention dead, the
 * legacy packs registered and not measured, the report saying so. The knob is
 * `VAULT_MCP_CONVENTIONS` (a JSON object, merged key-wise over EMPTY through
 * `resolveConventions`); `GOVERNOR_VAULT_CONVENTIONS` and
 * `ASSENT_VAULT_CONVENTIONS` are read as legacy aliases for one release, with
 * a warning naming the new spelling. Malformed JSON warns and reads as EMPTY —
 * loud in the report (every convention dead), never a silent default, and
 * never a throw that takes the rail down.
 */
export function conventionsFromEnv(
  env: Record<string, string | undefined>,
  warn: (msg: string) => void = (msg) => console.error(msg),
): VaultConventions {
  let raw = env[CONVENTIONS_ENV];
  if (raw === undefined) {
    for (const legacy of CONVENTIONS_ENV_LEGACY) {
      if (env[legacy] !== undefined) {
        warn(`conformance: ${legacy} is a legacy spelling — set ${CONVENTIONS_ENV} instead (read this once more, this release).`);
        raw = env[legacy];
        break;
      }
    }
  }
  if (raw === undefined || raw.trim() === "") return { ...EMPTY_VAULT_CONVENTIONS, uidExemptPaths: [], ungovernedRoots: [] };
  try {
    return resolveConventions(JSON.parse(raw));
  } catch (e) {
    warn(`conformance: ${CONVENTIONS_ENV} is not valid JSON — every convention reads as EMPTY (dead) for this run. ${e instanceof Error ? e.message : String(e)}`);
    return { ...EMPTY_VAULT_CONVENTIONS, uidExemptPaths: [], ungovernedRoots: [] };
  }
}

// ── dead paths are loud, never "checked and clean" (#298) ────────────────────
//
// A convention path that names nothing never errors: a registries root that
// does not exist means the registry checks find no registries and report
// clean; a uid-exempt path that has moved means the template is no longer
// exempt. Both directions are silent, which is how six of seven shipped paths
// drifted dead without a test noticing. So every path-valued key is checked
// against the walk BEFORE the legacy packs run, and a dead one becomes a
// `conformance_engine / dead_convention` finding (NEW, so the run fails loudly)
// while the pack that depends on it is treated as NOT MEASURED — which is what
// `coverageRefusal` then refuses over, exactly as it refuses a pack that threw.
// Nothing here guesses a replacement path: where a convention should point is
// a vault filing question (#298's own blocking ambiguity), answered by the
// operator in the plugin's Conformance settings (or `VAULT_MCP_CONVENTIONS`
// for the CLI), never by a default. Since #403 a BLANK scalar key is dead too:
// the plugin ships every key blank, and "blank reads as dead, loudly" is what
// keeps that from reading as "checked and clean".

export type ConventionPathKey = keyof VaultConventions;

export interface DeadConvention {
  key: ConventionPathKey;
  path: string;
}

/** Which legacy packs each convention key feeds — the packs that cannot
 *  measure honestly while the key is dead. A key can feed more than one:
 *  `registriesRoot` is both drift's registry-family root and structure's
 *  blueprint-registry root (#401 review — the first cut listed one reader and
 *  left `conformance_check` measuring over an empty registry). `port_lint`
 *  and `ste_lint` read no convention. Pinned against the packs' own sources. */
export const CONVENTION_PACKS: Record<ConventionPathKey, readonly string[]> = {
  registriesRoot: ["drift_audit", "conformance_check"],
  systemRoot: ["drift_audit"],
  artifactsRoot: ["drift_audit"],
  pluginStackPath: ["drift_audit"],
  uidExemptPaths: ["drift_audit"],
  ungovernedRoots: ["conformance_check"],
};

const FILE_KEYS: ReadonlySet<ConventionPathKey> = new Set(["pluginStackPath", "uidExemptPaths"]);

function underAny(path: string, roots: readonly string[]): boolean {
  return roots.some((r) => {
    const root = r.replace(/\/+$/, "");
    return root !== "" && (path === root || path.startsWith(root + "/"));
  });
}

/** What the walk chose NOT to look at — a convention path in here is not
 *  dead, it is unobserved, and is skipped rather than reported. */
export interface WalkPruning {
  /** `--exclude` roots (vault-relative prefixes). */
  excludedRoots?: readonly string[];
  /** Guarded territories the walk stepped around (#398). */
  skippedTerritories?: readonly { path: string }[];
  /** Directory NAMES the walk never enters anywhere (`.git`, `.obsidian`, …). */
  skipDirs?: ReadonlySet<string>;
}

/**
 * Every convention path the walk did not see. `dirs`/`files` are the walk's
 * own listings (vault-relative) and are REQUIRED: an absent listing throws,
 * never reads as "everything is dead" — the absence-read-as-emptiness idiom
 * this rail refuses by name (`requireListing_`). A path under anything the
 * walk pruned — an excluded root, a skipped territory, a skip-dir segment — is
 * skipped, not reported: its absence says nothing about the vault.
 * Deterministic: keys in declaration order, list entries in their own order.
 */
export function deadConventionPaths(
  conv: VaultConventions,
  walk: { dirs?: readonly string[]; files?: readonly string[] },
  pruning: WalkPruning = {},
): DeadConvention[] {
  if (walk.dirs === undefined || walk.files === undefined) {
    throw new Error(
      "deadConventionPaths needs the walk's 'dirs' and 'files' listings. Refusing to treat a missing listing as " +
        "an empty one: every convention would then read dead and every legacy pack unmeasured.",
    );
  }
  const dirs = new Set(walk.dirs.map((d) => d.replace(/\/+$/, "")));
  const files = new Set(walk.files);
  const prunedRoots = [...(pruning.excludedRoots ?? []), ...(pruning.skippedTerritories ?? []).map((t) => t.path)];
  const skipDirs = pruning.skipDirs ?? new Set<string>();
  const pruned = (path: string) => underAny(path, prunedRoots) || path.split("/").some((seg) => skipDirs.has(seg));
  const dead: DeadConvention[] = [];
  const check = (key: ConventionPathKey, raw: string) => {
    const path = raw.replace(/\/+$/, "");
    if (!path) { dead.push({ key, path: "" }); return; } // a BLANK scalar key: dead, reported as such (#403)
    if (pruned(path)) return;
    const live = FILE_KEYS.has(key) ? files.has(path) : dirs.has(path);
    if (!live) dead.push({ key, path });
  };
  for (const key of Object.keys(CONVENTION_PACKS) as ConventionPathKey[]) {
    const v = conv[key];
    // A list key: each named entry is checked; an EMPTY list is "none", not dead.
    if (Array.isArray(v)) for (const entry of v) { if (entry.trim()) check(key, entry); }
    else check(key, v);
  }
  return dead;
}
