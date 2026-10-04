/**
 * env-alias.test.mjs — the GOVERNOR_* / ASSENT_* env-var alias contract
 * (0.12.0 naming unification, part 3).
 *
 * Every conformance/survey env knob is read through envAliased:
 * GOVERNOR_<X> is primary; the pre-rename ASSENT_<X> spelling is a fallback
 * alias. Pinned: GOVERNOR_ wins when both are set; a set-but-empty GOVERNOR_
 * value still wins (it does not fall through to the legacy spelling); the
 * real call sites honor the alias in both directions.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { envAliased, envAliasNames } from "../src/env-alias.ts";
import {
  acceptedByFrom,
  baselineRelFrom,
  excludedRootsFrom,
  rootDiscoveryRefusal,
  staleAfterFrom,
  registerDirFrom,
  debtBudgetFrom,
} from "../src/conformance/cli.ts";
import { conventionsFromEnv, EMPTY_VAULT_CONVENTIONS } from "../src/conformance/vault-conventions.ts";

describe("envAliased — the precedence contract", () => {
  test("GOVERNOR_ wins when both are set", () => {
    assert.equal(envAliased({ GOVERNOR_X: "new", ASSENT_X: "old" }, "X"), "new");
  });
  test("ASSENT_ is read when GOVERNOR_ is unset", () => {
    assert.equal(envAliased({ ASSENT_X: "old" }, "X"), "old");
  });
  test("a set-but-empty GOVERNOR_ still wins (never falls through)", () => {
    assert.equal(envAliased({ GOVERNOR_X: "", ASSENT_X: "old" }, "X"), "");
  });
  test("neither set ⇒ undefined", () => {
    assert.equal(envAliased({}, "X"), undefined);
  });
  test("envAliasNames spells both forms", () => {
    assert.deepEqual(envAliasNames("CONTENT_ROOT"), {
      primary: "GOVERNOR_CONTENT_ROOT",
      legacy: "ASSENT_CONTENT_ROOT",
    });
  });
});

describe("real call sites honor the alias", () => {
  test("acceptedByFrom: GOVERNOR_ACCEPTED_BY wins over ASSENT_ACCEPTED_BY", () => {
    assert.equal(acceptedByFrom([], { GOVERNOR_ACCEPTED_BY: "Nelson", ASSENT_ACCEPTED_BY: "other" }), "Nelson");
    assert.equal(acceptedByFrom([], { ASSENT_ACCEPTED_BY: "legacy-human" }), "legacy-human");
    assert.equal(acceptedByFrom([], {}), "human");
  });

  test("baselineRelFrom: both spellings, GOVERNOR_ first", () => {
    assert.equal(baselineRelFrom({ GOVERNOR_BASELINE_REL: "A.md", ASSENT_BASELINE_REL: "B.md" }), "A.md");
    assert.equal(baselineRelFrom({ ASSENT_BASELINE_REL: "B.md" }), "B.md");
  });

  // #493: the plugin ships no baseline path (Nelson, 2026-10-03: "No folder
  // names are ever in the live code"). The order is the env override, then the
  // vault conventions' baselineRel, then "" (none configured) — never a constant.
  test("baselineRelFrom order (#493): env override > conventions.baselineRel > \"\"", () => {
    const conv = { baselineRel: "  Conv/Base.md  " };
    assert.equal(baselineRelFrom({ GOVERNOR_BASELINE_REL: "Env.md" }, conv), "Env.md", "the env override wins over the setting");
    assert.equal(baselineRelFrom({ ASSENT_BASELINE_REL: "Old.md" }, conv), "Old.md", "the legacy spelling is an override too");
    assert.equal(baselineRelFrom({}, conv), "Conv/Base.md", "no override: the setting, trimmed");
    assert.equal(baselineRelFrom({ GOVERNOR_BASELINE_REL: "   " }, conv), "Conv/Base.md", "a blank override falls through to the setting");
    assert.equal(baselineRelFrom({}, { baselineRel: "  " }), "", "a blank setting is none configured");
    assert.equal(baselineRelFrom({}, EMPTY_VAULT_CONVENTIONS), "", "EMPTY conventions: none configured");
    assert.equal(baselineRelFrom({}, null), "");
    assert.equal(baselineRelFrom({}), "", "nothing configured anywhere: \"\", not a shipped default");
  });

  test("excludedRootsFrom: both spellings", () => {
    assert.deepEqual(excludedRootsFrom([], { GOVERNOR_EXCLUDED_ROOTS: "A, B", ASSENT_EXCLUDED_ROOTS: "C" }), ["A", "B"]);
    assert.deepEqual(excludedRootsFrom([], { ASSENT_EXCLUDED_ROOTS: "C" }), ["C"]);
  });

  test("staleAfterFrom / registerDirFrom / debtBudgetFrom: legacy spelling still works", () => {
    assert.equal(staleAfterFrom([], { ASSENT_STALE_AFTER_DAYS: "30" }), 30);
    assert.equal(staleAfterFrom([], { GOVERNOR_STALE_AFTER_DAYS: "10", ASSENT_STALE_AFTER_DAYS: "30" }), 10);
    assert.equal(registerDirFrom([], { ASSENT_REGISTER_DIR: "/r" }), "/r");
    assert.equal(registerDirFrom([], { GOVERNOR_REGISTER_DIR: "/g", ASSENT_REGISTER_DIR: "/r" }), "/g");
    assert.equal(debtBudgetFrom([], { ASSENT_DEBT_BUDGET: "5" }), 5);
    assert.equal(debtBudgetFrom([], { GOVERNOR_DEBT_BUDGET: "2", ASSENT_DEBT_BUDGET: "5" }), 2);
  });

  test("rootDiscoveryRefusal: either content-root spelling suffices; either opt-in spelling suffices", () => {
    assert.equal(rootDiscoveryRefusal([], { GOVERNOR_CONTENT_ROOT: "/v" }), null);
    assert.equal(rootDiscoveryRefusal([], { ASSENT_CONTENT_ROOT: "/v" }), null);
    assert.equal(rootDiscoveryRefusal([], { GOVERNOR_ALLOW_ROOT_DISCOVERY: "1" }), null);
    assert.equal(rootDiscoveryRefusal([], { ASSENT_ALLOW_ROOT_DISCOVERY: "1" }), null);
    const refusal = rootDiscoveryRefusal([], {});
    assert.ok(refusal, "no root and no opt-in must refuse");
    assert.match(refusal, /GOVERNOR_CONTENT_ROOT/);
    assert.match(refusal, /ASSENT_CONTENT_ROOT/, "the refusal names the legacy spelling too");
  });

  test("the conventions knob left the GOVERNOR_/ASSENT_ alias family (#403): it is VAULT_MCP_CONVENTIONS, with the two old spellings as warned legacy reads — pinned in vault-conventions.test.mjs", () => {
    const g = JSON.stringify({ ungovernedRoots: ["G"] });
    const a = JSON.stringify({ ungovernedRoots: ["A"] });
    assert.deepEqual(conventionsFromEnv({ GOVERNOR_VAULT_CONVENTIONS: g, ASSENT_VAULT_CONVENTIONS: a }, () => {}).ungovernedRoots, ["G"]);
    assert.deepEqual(conventionsFromEnv({ ASSENT_VAULT_CONVENTIONS: a }, () => {}).ungovernedRoots, ["A"]);
    assert.deepEqual(conventionsFromEnv({}, () => {}), EMPTY_VAULT_CONVENTIONS, "unset is EMPTY: there is no default any more");
  });
});
