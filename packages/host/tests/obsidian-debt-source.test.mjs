/**
 * obsidian-debt-source.test.mjs — the in-app debt source honours #398 (#400 review).
 *
 * `obsidianDebtSource` used to run the engine with `baselineText: ""`, so the
 * skipped-territory refusal could never fire there and `obsidian_conformance_debt`
 * reported accepted keys under a skipped folder as CLEARED. The `obsidian`
 * import in that module is type-only, so it loads headlessly over a fake app
 * whose adapter points at a fixture root.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { obsidianDebtSource, obsidianDebtRenderSource } from "../src/mcp/obsidian-debt-source.ts";
import { runConformance } from "../src/conformance/cli.ts";
import { serializeSidecar, sidecarPathFor, emptySidecar } from "../src/conformance/debt-sidecar.ts";
import { DEFAULT_VOCABULARIES } from "@vault-mcp/core";
import { DEFAULT_SCHEMES } from "../src/kernel/scheme/registry.ts";
import { LEGACY_CONVENTIONS_SEED as SEED } from "../src/conformance/vault-conventions.ts";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "debt-source-"));
  await mkdir(path.join(root, "Notes"), { recursive: true });
  await writeFile(path.join(root, "Notes", "A.md"), "---\ntitle: A\ntags:\n  - rogue\n---\nbody\n");
  await mkdir(path.join(root, "80-89 Sensitive"), { recursive: true });
  await writeFile(path.join(root, "80-89 Sensitive", "L.md"), "---\ntitle: L\ntags:\n  - rogue\n---\nprivate\n");
  return root;
}
const app = (root) => ({ vault: { adapter: { basePath: root } } });

// The baseline path is a SETTING since #493 (vault conventions' baselineRel), not
// a shipped constant. It sits under the seed's systemRoot (`00-09 System`) so that
// convention stays live in these fixtures, as it was when the path was a constant.
const REL = "00-09 System/Records/Conformance baseline.md";
const withRel = (conv, rel = REL) => ({ ...conv, baselineRel: rel });

// Every spelling of the env override is cleared, so the setting is what is read.
const ENV_KEYS = ["GOVERNOR_BASELINE_REL", "ASSENT_BASELINE_REL"];
async function withoutEnvOverride(fn) {
  const saved = ENV_KEYS.map((k) => [k, process.env[k]]);
  for (const k of ENV_KEYS) delete process.env[k];
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) if (v !== undefined) process.env[k] = v; else delete process.env[k];
  }
}

describe("obsidianDebtSource — #294: an unmeasured pack with accepted debt refuses, in-app too", () => {
  test("a baseline describing drift_audit over a vault where its conventions are dead → liveFindings() rejects with the coverage refusal", async () => {
    const root = await fixture();
    try {
      await withoutEnvOverride(async () => {
        const baselinePath = path.join(root, REL);
        await mkdir(path.dirname(baselinePath), { recursive: true });
        await writeFile(baselinePath, "```ratchet-baseline\ndrift_audit|J|category number 00 is claimed by 2 folders: 00 A; 00 B|\n```\n");
        // The seed's systemRoot (`00-09 System`) is LIVE in this fixture, since the baseline path lives under it; a dead spine is what this test is about (#412: systemRoot is the one convention drift reads).
        const src = obsidianDebtSource(app(root), () => [], () => withRel({ ...SEED, systemRoot: "Nowhere/Spine" }));
        await assert.rejects(() => src.liveFindings(), /refusing to report: the baseline holds accepted debt for drift_audit, which did not run/);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("obsidianDebtSource — #398 reaches the in-app tool", () => {
  test("skippedTerritories() reports the last run's skips", async () => {
    const root = await fixture();
    try {
      await withoutEnvOverride(async () => {
        const src = obsidianDebtSource(app(root), () => ["80-89"], () => withRel(SEED));
        const findings = await src.liveFindings();
        assert.deepEqual(src.skippedTerritories(), [{ path: "80-89 Sensitive", territory: "80-89" }]);
        assert.ok(!findings.some((f) => f.target.startsWith("80-89 Sensitive/")), "nothing under it was read");
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("an accepted key under a skipped folder makes liveFindings() REFUSE — the tool surfaces the refusal instead of CLEARED", async () => {
    const root = await fixture();
    try {
      await withoutEnvOverride(async () => {
        // Baseline taken with no territory listed: the key under 80-89 Sensitive is accepted debt.
        const first = await runConformance({ root, conventions: SEED, baselineText: "", vocabularies: DEFAULT_VOCABULARIES, schemes: DEFAULT_SCHEMES, legacyPacks: true });
        assert.ok(first.rebaseline.includes("80-89 Sensitive/L.md"), "fixture: a key inside the folder is in the baseline");
        const baselinePath = path.join(root, REL);
        await mkdir(path.dirname(baselinePath), { recursive: true });
        await writeFile(baselinePath, "```ratchet-baseline\n" + first.rebaseline + "\n```\n");
        const src = obsidianDebtSource(app(root), () => ["80-89"], () => withRel(SEED));
        await assert.rejects(() => src.liveFindings(), /refusing to run: a guarded territory was skipped \(80-89 Sensitive\)/);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("obsidianDebtSource — #493: the baseline path is the live setting, read per call", () => {
  test("baselineText() and sidecar() read the path the thunk names NOW: a changed setting applies on the next call, no reload", async () => {
    const root = await fixture();
    try {
      await withoutEnvOverride(async () => {
        const relA = "Base A/Conformance baseline.md";
        const relB = "Base B/Conformance baseline.md";
        for (const [rel, body, key] of [[relA, "A-TEXT", "k|a"], [relB, "B-TEXT", "k|b"]]) {
          const p = path.join(root, rel);
          await mkdir(path.dirname(p), { recursive: true });
          await writeFile(p, body);
          await writeFile(sidecarPathFor(p), serializeSidecar({ version: 1, entries: { [key]: { reason: rel } } }));
        }
        let current = relA;
        const src = obsidianDebtRenderSource(app(root), () => [], () => withRel(SEED, current));
        assert.equal(await src.baselineText(), "A-TEXT");
        assert.deepEqual(Object.keys((await src.sidecar()).entries), ["k|a"]);
        assert.equal(src.baselineNotePath(), relA);
        assert.equal(src.defaultRegisterDir(), "Base A");
        current = relB; // the operator edits the setting; the same source object is reused
        assert.equal(await src.baselineText(), "B-TEXT", "the second call reads the NEW path");
        assert.deepEqual(Object.keys((await src.sidecar()).entries), ["k|b"], "the sidecar follows the baseline");
        assert.equal(src.baselineNotePath(), relB);
        assert.equal(src.defaultRegisterDir(), "Base B");
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("no baseline configured ⇒ empty baseline text and an empty sidecar (no file is read)", async () => {
    const root = await fixture();
    try {
      await withoutEnvOverride(async () => {
        const src = obsidianDebtRenderSource(app(root), () => [], () => withRel(SEED, ""));
        assert.equal(await src.baselineText(), "");
        assert.deepEqual(await src.sidecar(), emptySidecar());
        assert.equal(src.baselineNotePath(), "");
        assert.equal(src.defaultRegisterDir(), "", "no baseline: the register goes to the vault root, not to a shipped folder");
        const bare = obsidianDebtSource(app(root));
        assert.equal(await bare.baselineText(), "", "no conventions thunk at all: none configured either");
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
