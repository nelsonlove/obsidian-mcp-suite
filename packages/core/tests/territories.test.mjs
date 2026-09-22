// territories.test.mjs — the guarded-territory list as CONFIGURATION with NO
// SHIPPED DEFAULT (#321 → #396 → #397, ruled by Nelson 2026-09-22).
//
// The plugin used to ship four folder names as a default. They were one
// operator's vault — `80-89` means "legal material" only in a Johnny Decimal
// vault — baked into a plugin with a community-submission directory. A default
// that is wrong for everyone but its author manufactures confidence, so it is
// gone: the list starts EMPTY, empty means "guard nothing" honestly, and the
// host refuses to turn capture on while it is empty. The four folders survive
// only as `LEGACY_TERRITORY_SEED`, read by exactly one caller — the host's
// one-time migration for installs that predate the setting.
//
// This file pins the resolution rule both plugins share. Every branch of it is
// a way a NON-EMPTY list could still guard nothing, which is why each is
// tested rather than trusted.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LEGACY_TERRITORY_SEED, isExcludedTerritory, resolveTerritories } from "../dist/index.js";

describe("resolveTerritories — there is no default, and blank is honestly empty", () => {
  test("undefined, null and [] all resolve to an EMPTY list, never to a shipped default", () => {
    // The whole point of #397's ruling. If any of these ever answers with a
    // list, a default has crept back in.
    assert.deepEqual([...resolveTerritories(undefined)], []);
    assert.deepEqual([...resolveTerritories(null)], []);
    assert.deepEqual([...resolveTerritories([])], []);
  });

  test("the legacy seed is NOT consulted by the resolver", () => {
    // `LEGACY_TERRITORY_SEED` exists for the host's one-time migration and
    // nothing else. If the resolver ever falls back to it, the shipped default
    // is back under another name.
    const r = resolveTerritories([]);
    for (const p of LEGACY_TERRITORY_SEED) assert.ok(!r.includes(p), `resolver must not fall back to seed entry ${p}`);
  });

  test("a list of only blanks is empty — the trailing-newline trap", () => {
    // A textarea left with a trailing newline yields [""], and
    // `"".startsWith(anything)` is TRUE — an unnormalized [""] would match every
    // path in the vault and silently stop all capture. Blanks are dropped.
    assert.deepEqual([...resolveTerritories([""])], []);
    assert.deepEqual([...resolveTerritories(["", "   ", "\t"])], []);
  });

  test("entries are trimmed, and blanks beside a real entry do not suppress it", () => {
    assert.deepEqual([...resolveTerritories(["  Archive/  ", ""])], ["Archive/"]);
  });
});

describe("resolveTerritories — malformed input can never throw, and never guards by accident", () => {
  test("a non-array resolves to empty instead of throwing", () => {
    // A hand-edited or Sync-merged data.json. A throw here used to take out
    // the settings tab (so the operator could not open settings to fix the
    // value that broke settings) AND every captured read.
    for (const bad of ["80-89", {}, 42, true]) {
      assert.deepEqual([...resolveTerritories(bad)], [], `${JSON.stringify(bad)} must resolve to empty`);
    }
  });

  test("non-string entries are DROPPED, never stringified", () => {
    // `String(null)` is "null" — non-empty, so it would count as a configured
    // entry that matches no path.
    assert.deepEqual([...resolveTerritories([null, undefined, 42, {}])], []);
    assert.deepEqual([...resolveTerritories(["Archive/", null])], ["Archive/"], "a good entry survives a bad neighbour");
  });

  test("a leading separator is stripped, not left to match nothing", () => {
    // `isExcludedTerritory` normalizes the PATH but not the PREFIX, so
    // `/Private/` could never match — a non-empty list guarding nothing.
    assert.deepEqual([...resolveTerritories(["/Private/"])], ["Private/"]);
    assert.deepEqual([...resolveTerritories(["./Private/"])], ["Private/"]);
    assert.ok(isExcludedTerritory("Private/x.md", resolveTerritories(["/Private/"])), "and it matches after stripping");
  });
});

describe("isExcludedTerritory — the configured list is the only list", () => {
  test("an EMPTY list guards nothing — except the upward escape, which fails closed regardless", () => {
    // "Empty means nothing" must be TRUE or it is not a rule. The one thing an
    // empty list still refuses is a path that escapes the vault after
    // normalization, because that is a property of the predicate ("cannot tell
    // where this points"), not of any list.
    assert.ok(!isExcludedTerritory("80-89 Divorce/evidence.md", []), "nothing is guarded by an empty list, legal area included");
    assert.ok(!isExcludedTerritory("obsidian-old/x.md", []));
    assert.ok(isExcludedTerritory("../outside.md", []), "an upward escape still fails CLOSED");
  });

  test("a configured territory is guarded; everything else is not", () => {
    const list = resolveTerritories(["Archive/"]);
    assert.ok(isExcludedTerritory("Archive/old.md", list));
    assert.ok(!isExcludedTerritory("80-89 Divorce/evidence.md", list), "no default is merged in — the list is the whole list");
  });

  test("normalization applies to a configured list", () => {
    const list = resolveTerritories(["Archive/"]);
    assert.ok(isExcludedTerritory("./Archive/old.md", list), "leading ./ is normalized away");
    assert.ok(isExcludedTerritory("Notes/../Archive/old.md", list), "traversal into a configured territory is caught");
  });

  test("the legacy seed still names the legal area, for the migration's sake", () => {
    // The seed is what an upgrading install gets written into its own
    // settings. If `80-89` fell out of it, that operator's upgrade would
    // silently unguard the legal material — the one outcome the migration
    // exists to prevent.
    assert.ok(LEGACY_TERRITORY_SEED.includes("80-89"));
  });
});
