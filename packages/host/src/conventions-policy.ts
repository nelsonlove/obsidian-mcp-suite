// conventions-policy.ts — the host's rules for the `vaultConventions` setting
// (#403, ruled 2026-09-26: "GOVERNOR_VAULT_CONVENTIONS should be renamed and its
// keys exposed via settings for the user"). Two pure pieces, headless-tested:
//
//  1. `conventionsOnLoad` — the ONE reader of `LEGACY_CONVENTIONS_SEED`. The
//     plugin ships the three keys EMPTY (every scalar convention dead, the legacy
//     packs registered and not measured until the operator points them). An
//     install whose data.json predates the setting is seeded ONCE with what it
//     used to measure, so an upgrade changes nothing for it; a fresh install
//     starts empty; an install that has the key keeps exactly what it has. The
//     key is then always persisted, so the branch cannot run twice — the same
//     shape as `territoriesOnLoad` (#397), for the same reason.
//  2. `CONVENTION_FIELDS` — the settings-tab fields as data (key, label,
//     help, kind), so the tab renders a list rather than hand-written
//     blocks, and a test can pin that every key of the record has a field.

import {
  EMPTY_VAULT_CONVENTIONS,
  LEGACY_CONVENTIONS_SEED,
  resolveConventions,
  type VaultConventions,
} from "./conformance/vault-conventions.js";

export interface ConventionsOnLoad {
  conventions: VaultConventions;
  /** True when the key was absent (seeded or fresh): write it now so this branch never runs again. */
  persist: boolean;
}

export function conventionsOnLoad(own: unknown, adopted?: unknown): ConventionsOnLoad {
  const asObject = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
  // The plugin's own data.json first; failing that, the settings adopted from
  // the pre-split provider on this first load. An adopted install is an
  // EXISTING install — it measured with the old built-in paths — so it takes
  // the seed, not empty.
  const stored = asObject(own) ?? asObject(adopted);
  if (!stored) return { conventions: resolveConventions(EMPTY_VAULT_CONVENTIONS), persist: true };
  if (!Object.prototype.hasOwnProperty.call(stored, "vaultConventions")) {
    return { conventions: resolveConventions(LEGACY_CONVENTIONS_SEED), persist: true };
  }
  return { conventions: resolveConventions(stored.vaultConventions), persist: false };
}

export type ConventionFieldKind = "path" | "paths";

export interface ConventionField {
  key: keyof VaultConventions;
  label: string;
  help: string;
  kind: ConventionFieldKind;
}

/** One field per key of `VaultConventions`, in the order the tab shows them.
 *  A `path` field is one folder or note path (blank = that convention is
 *  DEAD, its packs not measured); a `paths` field is one path per line (empty
 *  = none). The help names the packs each key feeds, from `CONVENTION_PACKS`. */
export const CONVENTION_FIELDS: readonly ConventionField[] = [
  { key: "registriesRoot", label: "Registries root", kind: "path", help: "Folder under which the structure check's blueprint registry lives. Feeds conformance_check. Blank = not measured." },
  { key: "systemRoot", label: "System root", kind: "path", help: "The governed system spine's root folder (the drift check's category-number scan). Feeds drift_audit. Blank = not measured." },
  { key: "ungovernedRoots", label: "Ungoverned roots", kind: "paths", help: "One folder per line the structure check never treats as governed content. Empty = everything under the root is governed." },
];

/** The value a settings-tab field commits for `key`, from the raw text the
 *  operator typed: a `path` field's text trimmed, a `paths` field's lines
 *  trimmed and blanks dropped. Pure, so the tab's commit rule is pinned. */
export function conventionFieldValue(field: ConventionField, raw: string): string | string[] {
  return field.kind === "path" ? raw.trim() : raw.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** The record the settings tab STORES after one field loses focus: the
 *  current setting (whatever shape it has) coerced, that one key replaced by
 *  what the operator typed, coerced again — so what the tab writes is exactly
 *  what `resolveConventions` reads back on the next debt or drift run. Pure:
 *  the tab is Obsidian-bound, this rule is not, and a blank committed here is
 *  a dead convention on the next run (pinned in conventions-policy.test.mjs). */
export function commitConvention(current: unknown, field: ConventionField, raw: string): VaultConventions {
  const next = resolveConventions(current) as unknown as Record<string, unknown>;
  next[field.key] = conventionFieldValue(field, raw);
  return resolveConventions(next);
}
