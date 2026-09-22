// territory-policy.ts — the host's three decisions about guarded territories,
// pure and obsidian-free so each is testable rather than trusted (#396/#397).
//
// The ruling (Nelson, 2026-09-22): the plugin ships NO territory list. An empty
// list guards nothing, honestly, and capture refuses to run while it is empty.
// The four folder names the old default guarded survive only as
// `LEGACY_TERRITORY_SEED`, written ONCE into an upgrading install's own
// settings by `territoriesOnLoad`, so that upgrade does not silently unguard
// the operator's legal material.
//
// Each function here has exactly the callers its test pins by source scan;
// the recurring defect this repo keeps finding is "a setting exists but nothing
// proves a path reads it", and a predicate with two hand-written copies is how
// that defect starts.

import { LEGACY_TERRITORY_SEED, resolveTerritories } from "@vault-mcp/core";

/** What `loadSettings` should hold for `guardedTerritories`, and whether it must persist the answer now. */
export interface TerritoriesOnLoad {
  territories: string[];
  /** True when the key was absent from the stored settings — the one-time migration ran and its result must be saved so it never runs again. */
  persist: boolean;
}

/**
 * The one-time migration. `own` is the plugin's OWN stored data.json (null or
 * undefined on a fresh install). The discriminator is "does this plugin already
 * have a data.json without the key": that install predates the setting and gets
 * the legacy seed; a fresh install starts EMPTY; an install that has the key —
 * even as [] — keeps exactly what it has. `persist` is true whenever the key was
 * absent, including on a fresh install, so the key is written and this branch
 * cannot run twice: a new user who later saves any other setting can never
 * inherit the legacy operator's folder names.
 */
export function territoriesOnLoad(own: unknown): TerritoriesOnLoad {
  const stored = own && typeof own === "object" ? (own as Record<string, unknown>) : null;
  if (!stored) return { territories: [], persist: true };
  if (!Object.prototype.hasOwnProperty.call(stored, "guardedTerritories")) {
    return { territories: [...LEGACY_TERRITORY_SEED], persist: true };
  }
  return { territories: [...resolveTerritories(stored.guardedTerritories)], persist: false };
}

/** Whether at least one territory is configured — the precondition for capture. */
export function hasGuardedTerritory(settings: { guardedTerritories?: unknown }): boolean {
  return resolveTerritories(settings.guardedTerritories).length > 0;
}

/**
 * Whether capture may run: explicitly on (a literal `true`, so a corrupt
 * data.json cannot turn it on) AND at least one territory configured, because
 * with an empty list capture would retain ANY note it was shown, and there is
 * no built-in list to catch that any more. The settings UI refuses the toggle
 * on the same second condition (`hasGuardedTerritory`); this is the runtime gate.
 */
export function captureAllowed(settings: { captureObservations?: unknown; guardedTerritories?: unknown }): boolean {
  return settings.captureObservations === true && hasGuardedTerritory(settings);
}
