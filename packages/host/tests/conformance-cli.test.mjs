/**
 * conformance-cli.test.mjs — the CLI's testable core `runConformance`: snapshot
 * → build packs from settings → engine → ratchet vs a baseline → result +
 * report. The thin `main` (argv/env/read/print/exit) is not unit-tested; this
 * pins the wiring.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runConformance, guardedTerritoryRefusal, NON_PATH_KEYED_CHECKS } from "../src/conformance/cli.ts";
import fs from "node:fs";
import { ENGINE_ID } from "../src/conformance/engine.ts";
import { coverageRefusal, baselinePackIds } from "../src/conformance/cli.ts";
import { parseBaseline } from "../src/conformance/ratchet.ts";
import { fileURLToPath } from "node:url";

async function vault() {
  const root = await mkdtemp(path.join(tmpdir(), "conf-cli-"));
  await mkdir(path.join(root, "Notes"), { recursive: true });
  // an unregistered tag → a vocab finding (no vocab registry configured here, so
  // an empty registry means every tag is unregistered — deterministic)
  await writeFile(path.join(root, "Notes", "A.md"), "---\ntitle: A\ntags:\n  - rogue\n---\nbody\n");
  return root;
}

describe("runConformance", () => {
  test("empty baseline → the note's findings are all NEW and the run fails", async () => {
    const root = await vault();
    try {
      const res = await runConformance({
        root,
        baselineText: "",
        vocabularies: [{ id: "reg", provider: "blueprint", root: "Reg" }], // Reg is empty → 'rogue' unregistered
        schemes: [],
      });
      assert.ok(res.ratchet.newKeys.length >= 1, "at least the unregistered tag is NEW");
      assert.equal(res.ratchet.failed, true);
      assert.equal(res.exitCode, 1);
      assert.ok(res.report.includes("NEW"), "report mentions NEW findings");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("baseline containing the finding → carried, run passes", async () => {
    const root = await vault();
    try {
      // first run to learn the exact keys, then baseline them
      const first = await runConformance({ root, baselineText: "", vocabularies: [{ id: "reg", provider: "blueprint", root: "Reg" }], schemes: [] });
      const baselineText = "```ratchet-baseline\n" + first.rebaseline + "\n```\n";
      const second = await runConformance({ root, baselineText, vocabularies: [{ id: "reg", provider: "blueprint", root: "Reg" }], schemes: [] });
      assert.equal(second.ratchet.newKeys.length, 0, "everything now carried");
      assert.equal(second.ratchet.failed, false);
      assert.equal(second.exitCode, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rebaseline output is the sorted key body for the live findings", async () => {
    const root = await vault();
    try {
      const res = await runConformance({ root, baselineText: "", vocabularies: [{ id: "reg", provider: "blueprint", root: "Reg" }], schemes: [] });
      // every rebaseline line is a 4-field key
      for (const line of res.rebaseline.split("\n").filter(Boolean)) {
        assert.equal(line.split("|").length >= 4, true, `key has >=4 fields: ${line}`);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("writeFence", () => {
  test("inserts a body containing $-sequences literally (no String.replace pattern expansion)", async () => {
    const { writeFence } = await import("../src/conformance/cli.ts");
    const note = "prose\n\n```ratchet-baseline\nold|a|b|c\n```\n\nmore\n";
    const body = "vocab_findings|unregistered_tag|Notes/Price $& Deal.md|rogue";
    const out = writeFence(note, body);
    assert.ok(out.includes("Notes/Price $& Deal.md"), "literal $& preserved");
    assert.equal(out.includes("old|a|b|c"), false, "old fence body replaced");
    assert.equal((out.match(/```ratchet-baseline/g) || []).length, 1, "exactly one fence");
  });
  test("appends a fence when the note has none", async () => {
    const { writeFence } = await import("../src/conformance/cli.ts");
    const out = writeFence("# just prose\n", "s|c|t|k");
    assert.ok(out.includes("```ratchet-baseline\ns|c|t|k\n```"));
  });
  test("throws on an opening marker with no complete fence (corrupt baseline) rather than silently no-op", async () => {
    const { writeFence } = await import("../src/conformance/cli.ts");
    assert.throws(() => writeFence("```ratchet-baseline\nunclosed key line\n", "s|c|t|k"), /corrupt|complete fence/);
  });
});

// The gate's DEFAULT was inverted here by #116, and the reason is measured, not
// stylistic: the accepted-debt baseline's keys are exclusively legacy-pack keys,
// so a default run without these packs reported the ENTIRE baseline (124 of 124)
// as CLEARED on every invocation — a guaranteed false "all accepted debt is now
// fixed" result. The opt-IN this suite originally pinned (#103 follow-up) was
// correct while the ports were unproven and became wrong once the baseline was
// restored and measured against them. The gate itself is unchanged and still
// tested; only which way it points by default moved.
describe("legacyPacks gate — default ON since #116, opt-out with legacyPacks:false", () => {
  test("legacy packs ON by default; OFF with legacyPacks:false", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const pth = (await import("node:path")).default;
    const { runConformance } = await import("../src/conformance/cli.ts");
    const root = await mkdtemp(pth.join(tmpdir(), "conf-gate2-"));
    try {
      await mkdir(pth.join(root, "N"), { recursive: true });
      await writeFile(pth.join(root, "N", "A.md"), "prose with a semicolon; here\n");
      const byDefault = await runConformance({ root, baselineText: "", vocabularies: [], schemes: [] });
      assert.equal(byDefault.findings.some((f) => f.script === "ste_lint"), true, "legacy packs ON by default (#116)");
      const off = await runConformance({ root, baselineText: "", vocabularies: [], schemes: [], legacyPacks: false });
      assert.equal(off.findings.some((f) => f.script === "ste_lint" || f.script === "port_lint" || f.script === "conformance_check"), false, "legacy packs off with explicit opt-out");
      const on = await runConformance({ root, baselineText: "", vocabularies: [], schemes: [], legacyPacks: true });
      assert.equal(on.findings.some((f) => f.script === "ste_lint"), true, "legacy packs on when asked explicitly");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("baselineMissingRefusal (#116 — a missing baseline must fail loudly)", () => {
  test("missing baseline refuses, naming the path and both escapes", async () => {
    const { baselineMissingRefusal } = await import("../src/conformance/cli.ts");
    const r = baselineMissingRefusal("/vault/Assent/Build/conformance/Conformance baseline.md", false, false);
    assert.ok(r, "expected a refusal");
    assert.match(r, /baseline not found/);
    assert.match(r, /Conformance baseline\.md/);
    assert.match(r, /--baseline=/);
    assert.match(r, /--no-baseline/);
  });

  test("an existing baseline proceeds", async () => {
    const { baselineMissingRefusal } = await import("../src/conformance/cli.ts");
    assert.equal(baselineMissingRefusal("/x", true, false), null);
  });

  test("--no-baseline is the explicit from-zero opt-in, even when missing", async () => {
    const { baselineMissingRefusal } = await import("../src/conformance/cli.ts");
    assert.equal(baselineMissingRefusal("/x", false, true), null);
  });

  test("the refusal is about SILENCE, not about forbidding zero baselines", async () => {
    const { baselineMissingRefusal } = await import("../src/conformance/cli.ts");
    // missing + explicit opt-in => allowed; missing + no opt-in => refused.
    assert.equal(baselineMissingRefusal("/x", false, true), null);
    assert.ok(baselineMissingRefusal("/x", false, false));
  });
});

describe("#398 — a guarded territory inside the root is skipped, reported, and never a silent CLEARED", () => {
  const vocab = [{ id: "reg", provider: "blueprint", root: "Reg" }];

  test("the run completes, the skipped folder is in the result and named in the report, and nothing under it was read", async () => {
    const root = await vault();
    try {
      await mkdir(path.join(root, "80-89 Legal"), { recursive: true });
      await writeFile(path.join(root, "80-89 Legal", "L.md"), "---\ntitle: L\ntags:\n  - rogue\n---\nprivate\n");
      const res = await runConformance({ root, baselineText: "", vocabularies: vocab, schemes: [], territories: ["80-89"] });
      assert.deepEqual(res.skippedTerritories, [{ path: "80-89 Legal", territory: "80-89" }]);
      assert.match(res.report, /guarded \(not scanned, no claim made\): 80-89 Legal \(guarded territory '80-89'\)/, "the report names the folder and the entry");
      assert.ok(!res.findings.some((f) => f.target.startsWith("80-89 Legal/")), "no finding came out of the territory — it was never read");
      assert.ok(res.findings.some((f) => f.target === "Notes/A.md"), "the rest of the vault was measured");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("an accepted-baseline key under a skipped territory REFUSES the run instead of reporting CLEARED", async () => {
    const root = await vault();
    try {
      await mkdir(path.join(root, "80-89 Legal"), { recursive: true });
      await writeFile(path.join(root, "80-89 Legal", "L.md"), "---\ntitle: L\ntags:\n  - rogue\n---\nprivate\n");
      // Baseline taken while the territory was NOT listed: its key is accepted debt.
      const first = await runConformance({ root, baselineText: "", vocabularies: vocab, schemes: [] });
      assert.ok(first.rebaseline.includes("80-89 Legal/L.md"), "fixture: the baseline holds a key inside the folder");
      const baselineText = "```ratchet-baseline\n" + first.rebaseline + "\n```\n";
      await assert.rejects(
        () => runConformance({ root, baselineText, vocabularies: vocab, schemes: [], territories: ["80-89"] }),
        /refusing to run: a guarded territory was skipped \(80-89 Legal\)[\s\S]*inside a guarded territory this run skipped[\s\S]*CLEARED/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("guardedTerritoryRefusal: segment-bounded, names the way out, silent when nothing is stranded", () => {
    assert.equal(guardedTerritoryRefusal(new Set(["ste_lint|editable|Notes/x.md|"]), ["80-89 Legal"]), null);
    assert.equal(guardedTerritoryRefusal(new Set(["ste_lint|editable|80-89 Legal notes/x.md|"]), ["80-89 Legal"]), null, "a sibling folder is not swept in");
    const r = guardedTerritoryRefusal(new Set(["ste_lint|editable|80-89 Legal/x.md|"]), ["80-89 Legal"]);
    assert.ok(r);
    assert.match(r, /take the folder off the guarded-territories list|remove the keys from the baseline/);
    assert.equal(guardedTerritoryRefusal(new Set(["ste_lint|editable|80-89 Legal/x.md|"]), []), null, "nothing skipped, nothing stranded");
  });
});

describe("#398 / #400 review — a uid-keyed baseline key must not clear silently behind a skip", () => {
  const vocab = [{ id: "reg", provider: "blueprint", root: "Reg" }];

  test("a uid-keyed baseline key the live run does not reproduce: CLEARED when nothing was skipped, REFUSED when something was", async () => {
    // Drift's E/F keys carry a uid or a bare token, not a path, so the strand
    // check cannot place them inside or outside a skipped folder. The bare
    // fixture cannot make the drift pack emit one (it needs vault scaffolding —
    // #298), so the key is planted in the baseline: what is under test is the
    // rule, not drift's appetite.
    const root = await vault();
    try {
      await mkdir(path.join(root, "80-89 Legal"), { recursive: true });
      await writeFile(path.join(root, "80-89 Legal", "L.md"), "---\ntitle: L\n---\nprivate\n");
      const eKey = "drift_audit|E|01234567-89ab-7cde-8f01-23456789abcd|dup-uid";
      const baselineText = "```ratchet-baseline\n" + eKey + "\n```\n";
      const plain = await runConformance({ root, baselineText, vocabularies: vocab, schemes: [] });
      assert.ok(plain.ratchet.clearedKeys.includes(eKey), "nothing skipped: the unreproduced key is an ordinary CLEARED");
      await assert.rejects(
        () => runConformance({ root, baselineText, vocabularies: vocab, schemes: [], territories: ["80-89"] }),
        /keyed by uid, not by path[\s\S]*\|E\|/,
        "a skip plus a cleared uid key refuses: nothing can tell whether the skip is what cleared it",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("NON_PATH_KEYED_CHECKS names exactly the checks drift.ts keys without a path (pinned at the source)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const drift = fs.readFileSync(path.join(here, "..", "src", "conformance", "packs", "drift.ts"), "utf8");
    assert.match(drift, /push\("E",[\s\S]{0,200}target: uid,/, "E is keyed by uid");
    assert.match(drift, /push\(\s*"F",[\s\S]{0,300}target: "uid-coverage"/, "F is keyed by a bare token");
    assert.deepEqual([...NON_PATH_KEYED_CHECKS].sort(), ["drift_audit|E", "drift_audit|F"]);
  });

  test("guardedTerritoryRefusal is silent with nothing skipped, even over a cleared uid key", () => {
    assert.equal(guardedTerritoryRefusal(new Set(), [], ["drift_audit|E|x|dup-uid"]), null);
    assert.ok(guardedTerritoryRefusal(new Set(), ["80-89 Legal"], ["drift_audit|E|x|dup-uid"]));
    assert.equal(guardedTerritoryRefusal(new Set(), ["80-89 Legal"], ["ste_lint|editable|Notes/x.md|"]), null, "a path-keyed clear outside the folder is a real clear");
  });
});

describe("#298 — a dead convention path is a loud finding and an unmeasured pack, never a clean report", () => {
  const vocab = [{ id: "reg", provider: "blueprint", root: "Reg" }];

  test("over a vault where the shipped conventions name nothing: one dead_convention finding per key, both dependent packs unmeasured, the report says so", async () => {
    const root = await vault();
    try {
      const res = await runConformance({ root, baselineText: "", vocabularies: vocab, schemes: [] });
      const dead = res.findings.filter((f) => f.script === ENGINE_ID && f.check === "dead_convention");
      assert.deepEqual(dead.map((f) => f.target).sort(), ["artifactsRoot", "pluginStackPath", "registriesRoot", "systemRoot", "uidExemptPaths", "ungovernedRoots"]);
      assert.deepEqual(res.deadConventions.length, 6);
      assert.ok(res.packIds.includes("drift_audit") && res.packIds.includes("conformance_check"), "the packs still REGISTER");
      assert.ok(!res.coveredPackIds.includes("drift_audit") && !res.coveredPackIds.includes("conformance_check"), "but are NOT covered");
      assert.ok(res.coveredPackIds.includes("port_lint") && res.coveredPackIds.includes("ste_lint"), "packs that read no convention still run");
      assert.ok(!res.findings.some((f) => f.script === "drift_audit"), "a pack with a dead convention emits nothing of its own — not clean, not noise");
      assert.ok(!res.findings.some((f) => f.script === ENGINE_ID && f.check === "pack_error"), "and it does not RUN — it would throw over this fixture (#136), and that throw must not be how it is silenced");
      assert.match(res.report, /DEAD CONVENTION: registriesRoot = .* — 'drift_audit' not measured/);
      assert.ok(res.ratchet.newKeys.some((k) => k.startsWith(`${ENGINE_ID}|dead_convention|`)), "and the finding is NEW, so the run fails loudly");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("with GOVERNOR_VAULT_CONVENTIONS pointing at live paths, nothing is dead and drift_audit is measured", async () => {
    const root = await vault();
    const saved = process.env.GOVERNOR_VAULT_CONVENTIONS;
    try {
      for (const d of ["Sys/Registries", "Sys/Artifacts", "Sys/Framework", "Sys/T"]) await mkdir(path.join(root, d), { recursive: true });
      await writeFile(path.join(root, "Sys", "Plugin stack.md"), "| Plugin | Status |\n");
      await writeFile(path.join(root, "Sys", "T", "Daily.md"), "---\nuid:\n---\n");
      // The drift pack refuses a missing QuickAdd config (#136) — give it one,
      // so what this test measures is the convention paths, not that refusal.
      await mkdir(path.join(root, ".obsidian", "plugins", "quickadd"), { recursive: true });
      await writeFile(path.join(root, ".obsidian", "plugins", "quickadd", "data.json"), '{"choices":[]}');
      await writeFile(path.join(root, ".obsidian", "community-plugins.json"), "[]");
      process.env.GOVERNOR_VAULT_CONVENTIONS = JSON.stringify({
        registriesRoot: "Sys/Registries", systemRoot: "Sys", artifactsRoot: "Sys/Artifacts",
        pluginStackPath: "Sys/Plugin stack.md", uidExemptPaths: ["Sys/T/Daily.md"], ungovernedRoots: ["Sys/Framework"],
      });
      const res = await runConformance({ root, baselineText: "", vocabularies: vocab, schemes: [] });
      assert.deepEqual(res.deadConventions, []);
      assert.ok(!res.findings.some((f) => f.check === "dead_convention"));
      assert.ok(res.coveredPackIds.includes("drift_audit") && res.coveredPackIds.includes("conformance_check"));
      assert.doesNotMatch(res.report, /DEAD CONVENTION/);
    } finally {
      if (saved === undefined) delete process.env.GOVERNOR_VAULT_CONVENTIONS; else process.env.GOVERNOR_VAULT_CONVENTIONS = saved;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a baseline that describes drift_audit, over a vault where its convention is dead, is REFUSED by coverageRefusal — the #294 rule, fed by the #298 mechanism", async () => {
    const root = await vault();
    try {
      const baselineText = "```ratchet-baseline\ndrift_audit|B|02.12|\n```\n";
      const res = await runConformance({ root, baselineText, vocabularies: vocab, schemes: [] });
      const refusal = coverageRefusal(baselinePackIds(parseBaseline(baselineText)), new Set(res.coveredPackIds), "run");
      assert.ok(refusal && /drift_audit/.test(refusal), "an unmeasured pack with accepted debt refuses rather than clearing it");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("the drift pack reads the INJECTED registries root, not the module constant (pinned at the source)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const drift = fs.readFileSync(path.join(here, "..", "src", "conformance", "packs", "drift.ts"), "utf8");
    const family = drift.slice(drift.indexOf("const registryFamily"), drift.indexOf("const actionNotes"));
    assert.match(family, /REGISTRIES_ROOT \+ "\/"/, "registryFamily filters on the per-run root");
    assert.doesNotMatch(family, /DEFAULT_REGISTRIES_ROOT/, "the constant ignored every GOVERNOR_VAULT_CONVENTIONS override (#298)");
  });
});
