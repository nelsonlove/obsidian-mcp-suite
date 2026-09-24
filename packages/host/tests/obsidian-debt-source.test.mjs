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
import { obsidianDebtSource } from "../src/mcp/obsidian-debt-source.ts";
import { runConformance, DEFAULT_BASELINE_REL } from "../src/conformance/cli.ts";
import { DEFAULT_VOCABULARIES } from "@vault-mcp/core";
import { DEFAULT_SCHEMES } from "../src/kernel/scheme/registry.ts";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "debt-source-"));
  await mkdir(path.join(root, "Notes"), { recursive: true });
  await writeFile(path.join(root, "Notes", "A.md"), "---\ntitle: A\ntags:\n  - rogue\n---\nbody\n");
  await mkdir(path.join(root, "80-89 Legal"), { recursive: true });
  await writeFile(path.join(root, "80-89 Legal", "L.md"), "---\ntitle: L\ntags:\n  - rogue\n---\nprivate\n");
  return root;
}
const app = (root) => ({ vault: { adapter: { basePath: root } } });

describe("obsidianDebtSource — #294: an unmeasured pack with accepted debt refuses, in-app too", () => {
  test("a baseline describing drift_audit over a vault where its conventions are dead → liveFindings() rejects with the coverage refusal", async () => {
    const root = await fixture();
    const saved = process.env.GOVERNOR_BASELINE_REL;
    delete process.env.GOVERNOR_BASELINE_REL;
    try {
      const baselinePath = path.join(root, DEFAULT_BASELINE_REL);
      await mkdir(path.dirname(baselinePath), { recursive: true });
      await writeFile(baselinePath, "```ratchet-baseline\ndrift_audit|B|02.12|\n```\n");
      const src = obsidianDebtSource(app(root), () => []);
      await assert.rejects(() => src.liveFindings(), /refusing to report: the baseline holds accepted debt for drift_audit, which did not run/);
    } finally {
      if (saved !== undefined) process.env.GOVERNOR_BASELINE_REL = saved;
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("obsidianDebtSource — #398 reaches the in-app tool", () => {
  test("skippedTerritories() reports the last run's skips", async () => {
    const root = await fixture();
    const saved = process.env.GOVERNOR_BASELINE_REL;
    delete process.env.GOVERNOR_BASELINE_REL;
    try {
      const src = obsidianDebtSource(app(root), () => ["80-89"]);
      const findings = await src.liveFindings();
      assert.deepEqual(src.skippedTerritories(), [{ path: "80-89 Legal", territory: "80-89" }]);
      assert.ok(!findings.some((f) => f.target.startsWith("80-89 Legal/")), "nothing under it was read");
    } finally {
      if (saved !== undefined) process.env.GOVERNOR_BASELINE_REL = saved;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("an accepted key under a skipped folder makes liveFindings() REFUSE — the tool surfaces the refusal instead of CLEARED", async () => {
    const root = await fixture();
    const saved = process.env.GOVERNOR_BASELINE_REL;
    delete process.env.GOVERNOR_BASELINE_REL;
    try {
      // Baseline taken with no territory listed: the key under 80-89 Legal is accepted debt.
      const first = await runConformance({ root, baselineText: "", vocabularies: DEFAULT_VOCABULARIES, schemes: DEFAULT_SCHEMES, legacyPacks: true });
      assert.ok(first.rebaseline.includes("80-89 Legal/L.md"), "fixture: a key inside the folder is in the baseline");
      const baselinePath = path.join(root, DEFAULT_BASELINE_REL);
      await mkdir(path.dirname(baselinePath), { recursive: true });
      await writeFile(baselinePath, "```ratchet-baseline\n" + first.rebaseline + "\n```\n");
      const src = obsidianDebtSource(app(root), () => ["80-89"]);
      await assert.rejects(() => src.liveFindings(), /refusing to run: a guarded territory was skipped \(80-89 Legal\)/);
    } finally {
      if (saved !== undefined) process.env.GOVERNOR_BASELINE_REL = saved;
      await rm(root, { recursive: true, force: true });
    }
  });
});
