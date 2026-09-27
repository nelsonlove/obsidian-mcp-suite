/**
 * vault-conventions.test.mjs — a dead convention path is loud, never "checked
 * and clean" (#298). Six of the seven shipped paths had silently died across
 * two vault renumberings; nothing noticed because a path that names nothing
 * never errors. `deadConventionPaths` is the detector; this pins its rules.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deadConventionPaths, CONVENTION_PACKS, LEGACY_CONVENTIONS_SEED, EMPTY_VAULT_CONVENTIONS, resolveConventions, conventionsFromEnv, SCALAR_CONVENTION_KEYS, LIST_CONVENTION_KEYS } from "../src/conformance/vault-conventions.ts";

const conv = {
  registriesRoot: "Sys/Registries",
  systemRoot: "Sys",
  artifactsRoot: "Sys/Artifacts",
  pluginStackPath: "Sys/Plugin stack.md",
  uidExemptPaths: ["Sys/Templates/Daily.md"],
  ungovernedRoots: ["Sys/Framework"],
};
const liveWalk = {
  dirs: ["Sys", "Sys/Registries", "Sys/Artifacts", "Sys/Framework", "Sys/Templates"],
  files: ["Sys/Plugin stack.md", "Sys/Templates/Daily.md"],
};

describe("deadConventionPaths", () => {
  test("every path present in the walk → nothing dead", () => {
    assert.deepEqual(deadConventionPaths(conv, liveWalk), []);
  });

  test("a directory key is checked against dirs, a file key against files — a file where a dir is expected is dead, and vice versa", () => {
    const dead = deadConventionPaths(conv, { dirs: ["Sys", "Sys/Registries", "Sys/Artifacts", "Sys/Framework", "Sys/Plugin stack.md"], files: ["Sys/Templates/Daily.md", "Sys/Registries"] });
    assert.deepEqual(dead, [{ key: "pluginStackPath", path: "Sys/Plugin stack.md" }]);
  });

  test("the shipped defaults over an empty walk: every key is dead — the #298 finding, as a test that would have caught it", () => {
    const dead = deadConventionPaths(LEGACY_CONVENTIONS_SEED, { dirs: [], files: [] });
    assert.deepEqual(dead.map((d) => d.key).sort(), ["artifactsRoot", "pluginStackPath", "registriesRoot", "systemRoot", "uidExemptPaths", "ungovernedRoots"]);
  });

  test("a path under an excluded root is skipped, not reported — the walk pruned it, so its absence says nothing", () => {
    const dead = deadConventionPaths(conv, { dirs: ["Sys"], files: [] }, { excludedRoots: ["Sys/Registries", "Sys/Artifacts", "Sys/Framework", "Sys/Templates"] });
    assert.deepEqual(dead, [{ key: "pluginStackPath", path: "Sys/Plugin stack.md" }]);
  });

  test("a trailing slash on either side is not a difference; an empty entry is ignored", () => {
    const c = { ...conv, artifactsRoot: "Sys/Artifacts/", ungovernedRoots: ["", "Sys/Framework/"] };
    assert.deepEqual(deadConventionPaths(c, { ...liveWalk, dirs: [...liveWalk.dirs.filter((d) => d !== "Sys/Artifacts"), "Sys/Artifacts/"] }), []);
  });

  test("a path under a SKIPPED TERRITORY or a skip-dir segment is unobserved, not dead (#401 review)", () => {
    const dead = deadConventionPaths({ ...conv, registriesRoot: "80-89 Legal/Registries", artifactsRoot: ".obsidian/plugins/x" }, { dirs: ["Sys", "Sys/Framework", "Sys/Templates"], files: ["Sys/Plugin stack.md", "Sys/Templates/Daily.md"] }, { skippedTerritories: [{ path: "80-89 Legal" }], skipDirs: new Set([".obsidian"]) });
    assert.deepEqual(dead, [], "the walk chose not to look there; absence says nothing");
  });

  test("an ABSENT listing throws — never reads as everything-dead", () => {
    assert.throws(() => deadConventionPaths(conv, { files: [] }), /needs the walk's 'dirs' and 'files'/);
    assert.throws(() => deadConventionPaths(conv, { dirs: [] }), /needs the walk's 'dirs' and 'files'/);
  });

  test("CONVENTION_PACKS names every key of VaultConventions and every PACK that reads it — pinned against the packs' own sources", () => {
    assert.deepEqual(Object.keys(CONVENTION_PACKS).sort(), Object.keys(LEGACY_CONVENTIONS_SEED).sort());
    for (const v of Object.values(CONVENTION_PACKS)) for (const id of v) assert.ok(["drift_audit", "conformance_check", "port_lint", "ste_lint"].includes(id), id);
    // structure.ts reads conv.registriesRoot (blueprint registry) and conv.ungovernedRoots; drift.ts reads the other five plus registriesRoot.
    assert.deepEqual([...CONVENTION_PACKS.registriesRoot].sort(), ["conformance_check", "drift_audit"], "registriesRoot has TWO readers (#401 review)");
    assert.deepEqual([...CONVENTION_PACKS.ungovernedRoots], ["conformance_check"]);
  });
});

describe("#403 — EMPTY is what ships; blank scalar = dead, empty list = none; coercion; the CLI env knob", () => {
  test("EMPTY conventions: the four scalar keys are dead with path '', the two list keys are not", () => {
    const dead = deadConventionPaths(EMPTY_VAULT_CONVENTIONS, { dirs: [], files: [] });
    assert.deepEqual(dead.map((d) => d.key).sort(), [...SCALAR_CONVENTION_KEYS].sort());
    assert.ok(dead.every((d) => d.path === ""));
    assert.deepEqual([...SCALAR_CONVENTION_KEYS, ...LIST_CONVENTION_KEYS].sort(), Object.keys(EMPTY_VAULT_CONVENTIONS).sort(), "the two key lists cover the record exactly");
  });

  test("a blank ENTRY inside a list key is skipped, not dead; a named entry that is absent is dead", () => {
    const conv = { ...EMPTY_VAULT_CONVENTIONS, registriesRoot: "R", systemRoot: "S", artifactsRoot: "A", pluginStackPath: "P.md", uidExemptPaths: ["", "  ", "T/x.md"], ungovernedRoots: [] };
    const dead = deadConventionPaths(conv, { dirs: ["R", "S", "A"], files: ["P.md"] });
    assert.deepEqual(dead, [{ key: "uidExemptPaths", path: "T/x.md" }]);
  });

  test("resolveConventions coerces anything to a full record: trims, drops blanks, never throws, never guesses", () => {
    assert.deepEqual(resolveConventions(undefined), EMPTY_VAULT_CONVENTIONS);
    assert.deepEqual(resolveConventions("nonsense"), EMPTY_VAULT_CONVENTIONS);
    assert.deepEqual(resolveConventions({ registriesRoot: "  R ", uidExemptPaths: "a\n\n b ", ungovernedRoots: [1, " U "], extra: 1 }),
      { ...EMPTY_VAULT_CONVENTIONS, registriesRoot: "R", uidExemptPaths: ["a", "b"], ungovernedRoots: ["U"] });
    assert.deepEqual(resolveConventions(LEGACY_CONVENTIONS_SEED), LEGACY_CONVENTIONS_SEED, "the seed is already canonical");
  });

  test("conventionsFromEnv: VAULT_MCP_CONVENTIONS first; the two old spellings read once more, each with a warning naming the new one; unset is EMPTY, not the seed", () => {
    const warned = [];
    const w = (m) => warned.push(m);
    const v = JSON.stringify({ registriesRoot: "V" }), g = JSON.stringify({ registriesRoot: "G" }), a = JSON.stringify({ registriesRoot: "A" });
    assert.equal(conventionsFromEnv({ VAULT_MCP_CONVENTIONS: v, GOVERNOR_VAULT_CONVENTIONS: g, ASSENT_VAULT_CONVENTIONS: a }, w).registriesRoot, "V");
    assert.equal(warned.length, 0, "the new spelling warns about nothing");
    assert.equal(conventionsFromEnv({ GOVERNOR_VAULT_CONVENTIONS: g, ASSENT_VAULT_CONVENTIONS: a }, w).registriesRoot, "G");
    assert.match(warned.at(-1), /GOVERNOR_VAULT_CONVENTIONS is a legacy spelling — set VAULT_MCP_CONVENTIONS/);
    assert.equal(conventionsFromEnv({ ASSENT_VAULT_CONVENTIONS: a }, w).registriesRoot, "A");
    assert.match(warned.at(-1), /ASSENT_VAULT_CONVENTIONS is a legacy spelling/);
    assert.deepEqual(conventionsFromEnv({}, w), EMPTY_VAULT_CONVENTIONS, "unset: EMPTY, never the seed");
    assert.deepEqual(conventionsFromEnv({ VAULT_MCP_CONVENTIONS: "   " }, w), EMPTY_VAULT_CONVENTIONS, "set-but-blank: EMPTY");
    const n = warned.length;
    assert.deepEqual(conventionsFromEnv({ VAULT_MCP_CONVENTIONS: "{not json" }, w), EMPTY_VAULT_CONVENTIONS, "malformed: EMPTY, loudly");
    assert.match(warned[n], /not valid JSON — every convention reads as EMPTY/);
    assert.deepEqual(conventionsFromEnv({ VAULT_MCP_CONVENTIONS: v }, w).uidExemptPaths, [], "keys the JSON omits are EMPTY, not seeded");
  });
});
