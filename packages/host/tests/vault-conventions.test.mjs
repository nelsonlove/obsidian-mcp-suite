/**
 * vault-conventions.test.mjs — a dead convention path is loud, never "checked
 * and clean" (#298). Six of the seven shipped paths had silently died across
 * two vault renumberings; nothing noticed because a path that names nothing
 * never errors. `deadConventionPaths` is the detector; this pins its rules.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deadConventionPaths, CONVENTION_PACKS, DEFAULT_VAULT_CONVENTIONS } from "../src/conformance/vault-conventions.ts";

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
    const dead = deadConventionPaths(DEFAULT_VAULT_CONVENTIONS, { dirs: [], files: [] });
    assert.deepEqual(dead.map((d) => d.key).sort(), ["artifactsRoot", "pluginStackPath", "registriesRoot", "systemRoot", "uidExemptPaths", "ungovernedRoots"]);
  });

  test("a path under an excluded root is skipped, not reported — the walk pruned it, so its absence says nothing", () => {
    const dead = deadConventionPaths(conv, { dirs: ["Sys"], files: [] }, ["Sys/Registries", "Sys/Artifacts", "Sys/Framework", "Sys/Templates"]);
    assert.deepEqual(dead, [{ key: "pluginStackPath", path: "Sys/Plugin stack.md" }]);
  });

  test("a trailing slash on either side is not a difference; an empty entry is ignored", () => {
    const c = { ...conv, artifactsRoot: "Sys/Artifacts/", ungovernedRoots: ["", "Sys/Framework/"] };
    assert.deepEqual(deadConventionPaths(c, { ...liveWalk, dirs: [...liveWalk.dirs.filter((d) => d !== "Sys/Artifacts"), "Sys/Artifacts/"] }), []);
  });

  test("CONVENTION_PACKS names a pack for every key of VaultConventions, so a new key cannot be silently unmapped", () => {
    assert.deepEqual(Object.keys(CONVENTION_PACKS).sort(), Object.keys(DEFAULT_VAULT_CONVENTIONS).sort());
    for (const v of Object.values(CONVENTION_PACKS)) assert.ok(["drift_audit", "conformance_check", "port_lint", "ste_lint"].includes(v), v);
  });
});
