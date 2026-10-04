/**
 * conventions-policy.test.mjs — #403: the vault conventions (three since #412) are a host
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
import { conventionsOnLoad, CONVENTION_FIELDS, conventionFieldValue, commitConvention } from "../src/conventions-policy.ts";
import { deadConventionPaths } from "../src/conformance/vault-conventions.ts";
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
    assert.deepEqual(conventionsOnLoad({ vaultConventions: { registriesRoot: " R ", baselineRel: " B.md " } }), { conventions: { ...EMPTY_VAULT_CONVENTIONS, registriesRoot: "R", baselineRel: "B.md" }, persist: false });
    assert.deepEqual(conventionsOnLoad({ vaultConventions: { baselineRel: "" } }), { conventions: EMPTY_VAULT_CONVENTIONS, persist: false });
    assert.deepEqual(conventionsOnLoad({ vaultConventions: "garbage" }), { conventions: EMPTY_VAULT_CONVENTIONS, persist: false });
  });
  test("#493: stored conventions that LACK baselineRel take the former constant's path ONCE (and persist); only that key is seeded", () => {
    const r = conventionsOnLoad({ vaultConventions: { registriesRoot: " R ", systemRoot: "", ungovernedRoots: ["U"] } });
    assert.deepEqual(r, { conventions: { registriesRoot: "R", systemRoot: "", ungovernedRoots: ["U"], baselineRel: LEGACY_CONVENTIONS_SEED.baselineRel }, persist: true }, "the other keys are kept as stored, not re-seeded");
    assert.deepEqual(conventionsOnLoad({ vaultConventions: {} }), { conventions: { ...EMPTY_VAULT_CONVENTIONS, baselineRel: LEGACY_CONVENTIONS_SEED.baselineRel }, persist: true });
    // Once persisted, the next load has the key and keeps it: seeded once, not every load.
    assert.deepEqual(conventionsOnLoad({ vaultConventions: r.conventions }), { conventions: r.conventions, persist: false });
  });
  test("#493: a STORED blank baselineRel is kept blank — the operator cleared it; it is not re-seeded", () => {
    assert.deepEqual(conventionsOnLoad({ vaultConventions: { registriesRoot: "R", baselineRel: "" } }), { conventions: { ...EMPTY_VAULT_CONVENTIONS, registriesRoot: "R" }, persist: false });
    assert.deepEqual(conventionsOnLoad({ vaultConventions: { baselineRel: "   " } }).conventions.baselineRel, "");
    assert.equal(conventionsOnLoad({ vaultConventions: { baselineRel: "   " } }).persist, false);
  });
  test("#493: the seed's baselineRel is the former DEFAULT_BASELINE_REL value, so an upgrade reads the same note", () => {
    assert.equal(LEGACY_CONVENTIONS_SEED.baselineRel, "00-09 System/00 System management/00.89 obsidian-mcp-suite/Archive/Build/Conformance baseline.md");
    assert.equal(EMPTY_VAULT_CONVENTIONS.baselineRel, "", "the plugin ships no baseline path");
  });
});

describe("the settings fields — one per key of the record", () => {
  test("CONVENTION_FIELDS covers every key of the record exactly once, and each key's kind matches its value shape", () => {
    assert.deepEqual(CONVENTION_FIELDS.map((f) => f.key).sort(), Object.keys(EMPTY_VAULT_CONVENTIONS).sort());
    for (const f of CONVENTION_FIELDS) {
      assert.equal(f.kind, Array.isArray(EMPTY_VAULT_CONVENTIONS[f.key]) ? "paths" : "path", f.key);
      assert.ok(f.help.length > 20 && f.label.length > 3);
    }
  });
  test("commitConvention: what the tab stores is what the next run reads — a blanked path field is a DEAD convention on that run; a list field commits its lines", () => {
    const reg = CONVENTION_FIELDS.find((f) => f.key === "registriesRoot");
    const ung = CONVENTION_FIELDS.find((f) => f.key === "ungovernedRoots");
    const blanked = commitConvention(LEGACY_CONVENTIONS_SEED, reg, "   ");
    assert.equal(blanked.registriesRoot, "");
    assert.deepEqual(blanked.systemRoot, LEGACY_CONVENTIONS_SEED.systemRoot, "the other keys are untouched");
    const walk = { dirs: [LEGACY_CONVENTIONS_SEED.systemRoot, ...LEGACY_CONVENTIONS_SEED.ungovernedRoots], files: [] };
    assert.deepEqual(deadConventionPaths(blanked, walk), [{ key: "registriesRoot", path: "" }], "the blank field is the one dead convention of the next run");
    const pointed = commitConvention(blanked, reg, ` ${LEGACY_CONVENTIONS_SEED.registriesRoot} `);
    assert.deepEqual(deadConventionPaths(pointed, { ...walk, dirs: [...walk.dirs, LEGACY_CONVENTIONS_SEED.registriesRoot] }), [], "pointing it at a live folder revives it");
    assert.deepEqual(commitConvention({}, ung, " A \n\nB/ ").ungovernedRoots, ["A", "B/"]);
    assert.deepEqual(commitConvention("garbage", reg, "R"), { ...EMPTY_VAULT_CONVENTIONS, registriesRoot: "R" }, "a corrupt current value cannot crash the tab");
  });

  test("conventionFieldValue: a path trims; paths split lines, trim, drop blanks", () => {
    const pathF = CONVENTION_FIELDS.find((f) => f.key === "registriesRoot");
    const listF = CONVENTION_FIELDS.find((f) => f.key === "ungovernedRoots");
    assert.equal(conventionFieldValue(pathF, "  R/x  "), "R/x");
    assert.equal(conventionFieldValue(pathF, "   "), "");
    assert.deepEqual(conventionFieldValue(listF, " A \n\nB/\n"), ["A", "B/"]);
  });
});

describe("#493: baselineRel is a setting, not a pack convention", () => {
  test("deadConventionPaths never names baselineRel — blank or set, the file present or absent", () => {
    const dirs = [LEGACY_CONVENTIONS_SEED.registriesRoot, LEGACY_CONVENTIONS_SEED.systemRoot, ...LEGACY_CONVENTIONS_SEED.ungovernedRoots];
    const rel = LEGACY_CONVENTIONS_SEED.baselineRel;
    const cases = [
      ["blank, nothing walked", { ...EMPTY_VAULT_CONVENTIONS, baselineRel: "" }, { dirs: [], files: [] }],
      ["blank, seed folders live", { ...LEGACY_CONVENTIONS_SEED, baselineRel: "" }, { dirs, files: [] }],
      ["set, file present", LEGACY_CONVENTIONS_SEED, { dirs, files: [rel] }],
      ["set, file absent", LEGACY_CONVENTIONS_SEED, { dirs, files: [] }],
      ["set, a FOLDER at the path", LEGACY_CONVENTIONS_SEED, { dirs: [...dirs, rel], files: [] }],
    ];
    for (const [name, conv, walk] of cases) {
      assert.ok(!deadConventionPaths(conv, walk).some((d) => d.key === "baselineRel"), name);
    }
    assert.deepEqual(deadConventionPaths(LEGACY_CONVENTIONS_SEED, { dirs, files: [rel] }), [], "seed folders live: nothing dead at all");
    assert.deepEqual(deadConventionPaths({ ...EMPTY_VAULT_CONVENTIONS, baselineRel: "" }, { dirs: [], files: [] }).map((d) => d.key), ["registriesRoot", "systemRoot"], "the blank SCALAR keys are still dead");
  });

  test("no file under src names 'Conformance baseline.md' in code, except LEGACY_CONVENTIONS_SEED in vault-conventions.ts (comments excluded)", () => {
    const srcRoot = path.join(HERE, "..", "src");
    // Strip comments: block comments, then whole-line `//` comments and `*` continuation lines, then trailing `// …` after code.
    const code = (text) =>
      text
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
        .split("\n")
        .map((l) => (/^\s*(\/\/|\*)/.test(l) ? "" : l.replace(/\s\/\/\s.*$/, "")))
        .join("\n");
    const hits = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && /\.(ts|mjs|js)$/.test(p)) {
          code(fs.readFileSync(p, "utf8")).split("\n").forEach((l, i) => {
            if (l.includes("Conformance baseline.md")) hits.push(`${path.relative(srcRoot, p)}:${i + 1}`);
          });
        }
      }
    };
    walk(srcRoot);
    assert.equal(hits.length, 1, `exactly one code line names the note: ${hits.join(", ")}`);
    assert.match(hits[0], /^conformance\/vault-conventions\.ts:\d+$/);
    const vc = src("conformance/vault-conventions.ts");
    const seedBlock = vc.slice(vc.indexOf("export const LEGACY_CONVENTIONS_SEED"), vc.indexOf("};", vc.indexOf("export const LEGACY_CONVENTIONS_SEED")));
    assert.match(seedBlock, /baselineRel: "[^"]*Conformance baseline\.md"/, "the one hit is the seed's baselineRel");
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
    assert.match(cli, /const conventions = conventionsFromEnv\(process\.env\);/, "runCli reads the conventions from the environment ONCE");
    assert.match(cli, /const baselineRel = baselineRelFrom\(process\.env, conventions\);/, "…and the baseline path from that same read (#493)");
    assert.match(cli, /^\s*conventions,\s*$/m, "…and fills the runner's option with that same read");
    assert.equal((cli.match(/conventionsFromEnv\(process\.env\)/g) ?? []).length, 2, "one read in runCli, one as rebaselineTargetRefusal's default liveRel — no third");
    assert.match(cli, /const conv = opts\.conventions;/, "the runner reads the option, nothing else");
  });
  test("the in-app sources are handed a per-call conventions thunk from the live settings", () => {
    assert.match(src("mcp/server.ts"), /obsidianDebtRenderSource\(\s*app,\s*\(\) => resolveTerritories\(ctx\.getSettings\(\)\.guardedTerritories\),\s*(?:\/\/[^\n]*\n\s*)*\(\) => resolveConventions\(ctx\.getSettings\(\)\.vaultConventions\),?\s*\)/, "server.ts supplies the debt source's conventions thunk as the THIRD argument of the one call, read per call — not as an expression left elsewhere");
    assert.match(src("main.ts"), /getConventions: \(\) => resolveConventions\(this\.settings\.vaultConventions\)/, "main.ts supplies the drift pane's thunk");
    assert.match(src("scheme/wiring.ts"), /obsidianDriftSource\(app, opts\.getTerritories, opts\.getConventions\)/, "wiring passes it through");
    assert.match(src("mcp/obsidian-debt-source.ts"), /conventions: conventions\?\.\(\) \?\? EMPTY_VAULT_CONVENTIONS/, "the debt source reads the thunk per run, EMPTY without one");
    assert.match(src("mcp/obsidian-drift-source.ts"), /conventions: conventions\?\.\(\) \?\? EMPTY_VAULT_CONVENTIONS/, "the drift source reads the thunk per run, EMPTY without one");
  });
  test("the settings tab is wired: display() renders the Conformance tab, every field commits through commitConvention on blur and saves", () => {
    const ui = src("connection-ui.ts");
    assert.match(ui, /this\.renderConformanceTab\(panes\.get\("conformance"\)!\)/, "display() must render the tab or the fields never exist");
    const tab = ui.slice(ui.indexOf("private renderConformanceTab("), ui.indexOf("private renderSecurityTab("));
    assert.match(tab, /for \(const field of CONVENTION_FIELDS\)/, "one field per CONVENTION_FIELDS entry, not a hand-written subset");
    assert.match(tab, /this\.plugin\.settings\.vaultConventions = commitConvention\(this\.plugin\.settings\.vaultConventions, field, raw\);\s*void this\.plugin\.saveSettings\(\);/, "the commit is the pure rule, then a save");
    assert.equal((tab.match(/addEventListener\("blur", \(\) => commit\(t\.inputEl\.value\)\)/g) ?? []).length, 2, "both field kinds commit on blur (textarea and text)");
    assert.match(ui, /import \{ CONVENTION_FIELDS, commitConvention \} from "\.\/conventions-policy\.js"/);
  });

  test("main.ts seeds through conventionsOnLoad(own, seed) and persists when the key was absent", () => {
    const main = src("main.ts");
    assert.match(main, /const conventions = conventionsOnLoad\(own, seed\);/);
    assert.match(main, /territories\.persist \|\| conventions\.persist/);
    assert.match(main, /vaultConventions: resolveConventions\(EMPTY_VAULT_CONVENTIONS\)/, "the shipped default is EMPTY");
  });
});
