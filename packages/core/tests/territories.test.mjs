// territories.test.mjs — the guarded-territory list as CONFIGURATION (#321/#397).
//
// #321 made the list configurable and #396 implemented it on the Governor
// plugin; #397 found that the two consumers in the HOST plugin — observation
// capture, which writes note bodies to disk outside the vault, and the
// conformance/adopt-baseline rail — still read the compiled-in default, so a
// territory an operator added was honored in one plugin and ignored in the
// other. The list now lives on the host and Governor reads it.
//
// This file pins the piece both plugins depend on: the resolution rule. It is
// three lines of code and every one of them is a way to unguard the legal
// material by accident, which is why they are tested rather than trusted.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EXCLUDED_PREFIXES, isExcludedTerritory, resolveTerritories } from "../dist/index.js";

describe("resolveTerritories — blank means the default, never 'guard nothing'", () => {
  test("undefined, null and [] all answer with the built-in default", () => {
    // The upgrade path: an install that predates the setting has no key at all,
    // and a fresh one stores []. Both must behave exactly as the vault did
    // before the setting existed — this is what makes the change
    // default-preserving rather than a silent unguarding on upgrade.
    assert.deepEqual([...resolveTerritories(undefined)], [...EXCLUDED_PREFIXES]);
    assert.deepEqual([...resolveTerritories(null)], [...EXCLUDED_PREFIXES]);
    assert.deepEqual([...resolveTerritories([])], [...EXCLUDED_PREFIXES]);
  });

  test("a list of only blanks is still blank — the trailing-newline trap", () => {
    // THE failure this normalization exists to stop. A textarea a human left
    // with a trailing newline yields [""], and `"".startsWith(anything)` is
    // TRUE, so an unnormalized [""] would match every path in the vault and
    // silently stop all capture — a guard so total it looks like a broken
    // feature. It must read as "nothing configured" and fall back.
    assert.deepEqual([...resolveTerritories([""])], [...EXCLUDED_PREFIXES]);
    assert.deepEqual([...resolveTerritories(["", "   ", "\t"])], [...EXCLUDED_PREFIXES]);
  });

  test("entries are trimmed, and surrounding blanks do not suppress a real one", () => {
    assert.deepEqual([...resolveTerritories(["  Archive/  ", ""])], ["Archive/"]);
  });

  test("a configured list REPLACES the default rather than extending it", () => {
    // Stated as a test because it is the sharp edge of this feature, not an
    // implementation detail: an operator who configures one folder is no longer
    // guarding 80-89. That is deliberate — the operator decides — but it is why
    // the settings tab renders the list IN FORCE rather than an empty box with
    // the default as placeholder text. Typing one line into an empty box would
    // otherwise unguard the legal material with no warning.
    const configured = resolveTerritories(["Archive/"]);
    assert.deepEqual([...configured], ["Archive/"]);
    assert.ok(!configured.includes("80-89"), "the default is NOT merged in — replacement, not union");
  });
});

describe("isExcludedTerritory — the configured list is the one that matches", () => {
  test("a configured territory is guarded and a defaulted one is not, once replaced", () => {
    const list = resolveTerritories(["Archive/"]);
    assert.ok(isExcludedTerritory("Archive/old.md", list), "the operator's own territory is guarded");
    assert.ok(!isExcludedTerritory("80-89 Divorce/evidence.md", list), "and the built-in one is not, because it was replaced");
    // The same path against the DEFAULT still is — proving the difference comes
    // from the list and not from some other change in the predicate.
    assert.ok(isExcludedTerritory("80-89 Divorce/evidence.md", resolveTerritories([])), "the default still guards it");
  });

  test("normalization still applies to a configured list", () => {
    // The traversal and upward-escape rules are properties of the predicate,
    // not of the default list, so they must survive configuration.
    const list = resolveTerritories(["Archive/"]);
    assert.ok(isExcludedTerritory("./Archive/old.md", list), "leading ./ is normalized away");
    assert.ok(isExcludedTerritory("Notes/../Archive/old.md", list), "traversal into a configured territory is caught");
    assert.ok(isExcludedTerritory("../outside.md", list), "an upward escape fails CLOSED whatever the list says");
  });

  test("the default list still names the legal area", () => {
    // A cheap pin on the thing the whole module exists for: if `80-89` ever
    // falls out of the default, an unconfigured vault stops guarding the
    // legal/PII area and nothing else here would notice.
    assert.ok(EXCLUDED_PREFIXES.includes("80-89"), "the guarded legal/PII area is on the built-in list");
  });
});

describe("resolveTerritories — malformed input can never mean 'guard nothing'", () => {
  test("a non-array falls back instead of throwing", () => {
    // A hand-edited or Sync-merged data.json. Throwing here took out the
    // settings tab (so the operator could not open settings to fix the value
    // that broke settings) AND every captured read.
    for (const bad of ["80-89", {}, 42, true]) {
      assert.deepEqual([...resolveTerritories(bad)], [...EXCLUDED_PREFIXES], `${JSON.stringify(bad)} must fall back`);
    }
  });

  test("non-string entries are DROPPED, never stringified", () => {
    // `String(null)` is "null" — non-empty, so it would count as a configured
    // entry, replace the default, and match no path: the whole vault unguarded
    // by one bad row.
    assert.deepEqual([...resolveTerritories([null, undefined, 42, {}])], [...EXCLUDED_PREFIXES]);
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
