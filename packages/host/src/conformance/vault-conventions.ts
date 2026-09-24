// vault-conventions.ts — the vault-shaped constants the ported legacy packs
// depend on, in ONE place, injectable, with the current values as defaults.
//
// WHY THIS FILE EXISTS. The four legacy packs are faithful ports of Python
// scripts written for one specific vault, so they necessarily know that vault's
// folder layout: where the registries live, where the plugin-stack note is,
// which template is uid-exempt. That knowledge is legitimate — it is the packs'
// subject matter — but scattering it as string literals through the pack
// sources made it invisible and unchangeable: a different vault could not use
// these packs at all, and changing a path meant a release.
//
// So the values are unchanged (parity keys are byte-identical by construction —
// the defaults ARE the former literals) but they are now named, discoverable in
// one file, and overridable via `GOVERNOR_VAULT_CONVENTIONS` (a JSON object;
// legacy alias `ASSENT_VAULT_CONVENTIONS`) for
// a vault that arranges itself differently.
//
// This does NOT make the packs vault-agnostic — a pack that checks "registry
// entries are named consistently" is meaningful only where such a registry
// exists. It makes the coupling explicit and configurable rather than baked in,
// which is the difference between a documented assumption and a hidden one.

import { envAliased } from "../env-alias.js";

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

export const DEFAULT_VAULT_CONVENTIONS: VaultConventions = {
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

/**
 * Conventions for this invocation. `GOVERNOR_VAULT_CONVENTIONS` (legacy alias
 * `ASSENT_VAULT_CONVENTIONS`) is a JSON object
 * merged key-wise over the defaults; malformed JSON falls back to the defaults
 * and warns rather than throwing — a bad override must not take the rail down,
 * and a SILENT fallback would be the absence-read-as-emptiness mistake again.
 */
export function vaultConventionsFrom(env: Record<string, string | undefined>): VaultConventions {
  const raw = (envAliased(env, "VAULT_CONVENTIONS") ?? "").trim();
  if (!raw) return DEFAULT_VAULT_CONVENTIONS;
  try {
    const parsed = JSON.parse(raw) as Partial<VaultConventions>;
    return { ...DEFAULT_VAULT_CONVENTIONS, ...parsed };
  } catch (e) {
    console.error(
      `conformance: GOVERNOR_VAULT_CONVENTIONS (or legacy ASSENT_VAULT_CONVENTIONS) is not valid JSON — using defaults. ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return DEFAULT_VAULT_CONVENTIONS;
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
// operator through `GOVERNOR_VAULT_CONVENTIONS`, never by a default.

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
    if (!path || pruned(path)) return;
    const live = FILE_KEYS.has(key) ? files.has(path) : dirs.has(path);
    if (!live) dead.push({ key, path });
  };
  for (const key of Object.keys(CONVENTION_PACKS) as ConventionPathKey[]) {
    const v = conv[key];
    if (Array.isArray(v)) for (const entry of v) check(key, entry);
    else check(key, v);
  }
  return dead;
}
