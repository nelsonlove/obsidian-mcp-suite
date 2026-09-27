/**
 * conventions-policy.test.mjs — #403: the six vault conventions are a host
 * setting with EMPTY defaults; the former shipped paths are a one-time
 * migration seed with exactly one reader; the in-app sources read the setting
 * per call; the CLI reads VAULT_MCP_CONVENTIONS. Source-scan pins say WHO
 * supplies the value, because "threaded but never read" is this repository's
 * recurring defect and a thunk nobody passes is exactly that.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { conventionsOnLoad, CONVENTION_FIELDS, conventionFieldValue } from "../src/conventions-policy.ts";
import { EMPTY_VAULT_CONVENTIONS, LEGACY_CONVENTIONS_SEED } from "../src/conformance/vault-conventions.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = (rel) => fs.readFileSync(path.join(HERE, "..", "src", rel), "utf8");

describe("conventionsOnLoad — seed once, fresh empty, present kept", () => {
  test("a fresh install (no data.json, nothing adopted) starts EMPTY and persists the key", () => {
    assert.deepEqual(conventionsOnLoad(null), { conventions: EMPTY_VAULT_CONVENTIONS, persist: true });
    assert.deepEqual(conventionsOnLoad(undefined, undefined), { conventions: EMPTY_VAULT_CONVENTIONS, persist: true });
  });
  test("an existing install whose data.json predates the key is seeded ONCE with the former shipped paths", () => {
    const r = conventionsOnLoad({ readOnly: false, guardedTerritories: [] });
    assert.deepEqual(r, { conventions: LEGACY_CONVENTIONS_SEED, persist: true });
  });
  test("an ADOPTED install (no own data.json, provider settings adopted) is an existing install: seeded", () => {
    assert.deepEqual(conventionsOnLoad(null, { readOnly: true }).conventions, LEGACY_CONVENTIONS_SEED);
  });
  test("an install that has the key keeps exactly what it has, coerced, even when empty", () => {
    assert.deepEqual(conventionsOnLoad({ vaultConventions: { registriesRoot: " R " } }), { conventions: { ...EMPTY_VAULT_CONVENTIONS, registriesRoot: "R" }, persist: false });
    assert.deepEqual(conventionsOnLoad({ vaultConventions: {} }), { conventions: EMPTY_VAULT_CONVENTIONS, persist: false });
    assert.deepEqual(conventionsOnLoad({ vaultConventions: "garbage" }), { conventions: EMPTY_VAULT_CONVENTIONS, persist: false });
  });
});

describe("the six settings fields", () => {
  test("CONVENTION_FIELDS covers every key of the record exactly once, and each key's kind matches its value shape", () => {
    assert.deepEqual(CONVENTION_FIELDS.map((f) => f.key).sort(), Object.keys(EMPTY_VAULT_CONVENTIONS).sort());
    for (const f of CONVENTION_FIELDS) {
      assert.equal(f.kind, Array.isArray(EMPTY_VAULT_CONVENTIONS[f.key]) ? "paths" : "path", f.key);
      assert.ok(f.help.length > 20 && f.label.length > 3);
    }
  });
  test("conventionFieldValue: a path trims; paths split lines, trim, drop blanks", () => {
    const pathF = CONVENTION_FIELDS.find((f) => f.key === "registriesRoot");
    const listF = CONVENTION_FIELDS.find((f) => f.key === "ungovernedRoots");
    assert.equal(conventionFieldValue(pathF, "  R/x  "), "R/x");
    assert.equal(conventionFieldValue(pathF, "   "), "");
    assert.deepEqual(conventionFieldValue(listF, " A \n\nB/\n"), ["A", "B/"]);
  });
});

describe("who supplies the conventions — source-scan pins against 'threaded but never read'", () => {
  test("LEGACY_CONVENTIONS_SEED has exactly ONE reader in the host beside its definition: conventions-policy.ts", () => {
    const readers = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && p.endsWith(".ts") && fs.readFileSync(p, "utf8").includes("LEGACY_CONVENTIONS_SEED")) readers.push(path.relative(path.join(HERE, "..", "src"), p));
      }
    };
    walk(path.join(HERE, "..", "src"));
    assert.deepEqual(readers.sort(), ["conformance/vault-conventions.ts", "conventions-policy.ts"]);
  });
  test("runConformance reads NO environment for conventions; runCli supplies them from VAULT_MCP_CONVENTIONS", () => {
    const cli = src("conformance/cli.ts");
    assert.ok(!/vaultConventionsFrom|GOVERNOR_VAULT_CONVENTIONS/.test(cli), "the old reader and the old knob are gone from the runner");
    assert.match(cli, /conventions: conventionsFromEnv\(process\.env\)/, "runCli fills the option from the environment");
    assert.match(cli, /const conv = opts\.conventions;/, "the runner reads the option, nothing else");
  });
  test("the in-app sources are handed a per-call conventions thunk from the live settings", () => {
    assert.match(src("mcp/server.ts"), /\(\) => resolveConventions\(ctx\.getSettings\(\)\.vaultConventions\)/, "server.ts supplies the debt source's thunk, read per call");
    assert.match(src("main.ts"), /getConventions: \(\) => resolveConventions\(this\.settings\.vaultConventions\)/, "main.ts supplies the drift pane's thunk");
    assert.match(src("scheme/wiring.ts"), /obsidianDriftSource\(app, opts\.getTerritories, opts\.getConventions\)/, "wiring passes it through");
    assert.match(src("mcp/obsidian-debt-source.ts"), /conventions: conventions\?\.\(\) \?\? EMPTY_VAULT_CONVENTIONS/, "the debt source reads the thunk per run, EMPTY without one");
    assert.match(src("mcp/obsidian-drift-source.ts"), /conventions: conventions\?\.\(\) \?\? EMPTY_VAULT_CONVENTIONS/, "the drift source reads the thunk per run, EMPTY without one");
  });
  test("main.ts seeds through conventionsOnLoad(own, seed) and persists when the key was absent", () => {
    const main = src("main.ts");
    assert.match(main, /const conventions = conventionsOnLoad\(own, seed\);/);
    assert.match(main, /territories\.persist \|\| conventions\.persist/);
    assert.match(main, /vaultConventions: resolveConventions\(EMPTY_VAULT_CONVENTIONS\)/, "the shipped default is EMPTY");
  });
});
