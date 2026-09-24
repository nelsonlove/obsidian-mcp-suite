/**
 * obsidian-drift-source.test.mjs — the drift pane's adapter applies the same
 * refusals `runCli` does (#294): a pack the baseline describes that did not run
 * must not read as CLEARED. Headless over a fake app; the module's `obsidian`
 * import is type-only.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { obsidianDriftSource } from "../src/mcp/obsidian-drift-source.ts";
import { DEFAULT_BASELINE_REL } from "../src/conformance/cli.ts";

const app = (root) => ({ vault: { adapter: { basePath: root } } });

async function withBaseline(text) {
  const root = await mkdtemp(path.join(tmpdir(), "drift-source-"));
  await mkdir(path.join(root, "Notes"), { recursive: true });
  await writeFile(path.join(root, "Notes", "A.md"), "---\ntitle: A\n---\nbody\n");
  const baselinePath = path.join(root, DEFAULT_BASELINE_REL);
  await mkdir(path.dirname(baselinePath), { recursive: true });
  await writeFile(baselinePath, text);
  return root;
}

describe("obsidianDriftSource — #294 coverage refusal", () => {
  test("a baseline describing drift_audit while its convention paths are dead → scan() rejects, never a silent CLEARED", async () => {
    const saved = process.env.GOVERNOR_BASELINE_REL;
    delete process.env.GOVERNOR_BASELINE_REL;
    const root = await withBaseline("```ratchet-baseline\ndrift_audit|B|02.12|\n```\n");
    try {
      await assert.rejects(() => obsidianDriftSource(app(root), () => []).scan(), /refusing to report: the baseline holds accepted debt for drift_audit/);
    } finally {
      if (saved !== undefined) process.env.GOVERNOR_BASELINE_REL = saved;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a baseline that describes only packs that ran → scan() completes", async () => {
    const saved = process.env.GOVERNOR_BASELINE_REL;
    delete process.env.GOVERNOR_BASELINE_REL;
    const root = await withBaseline("```ratchet-baseline\nste_lint|editable|Notes/A.md|x\n```\n");
    try {
      const groups = await obsidianDriftSource(app(root), () => []).scan();
      assert.ok(Array.isArray(groups));
    } finally {
      if (saved !== undefined) process.env.GOVERNOR_BASELINE_REL = saved;
      await rm(root, { recursive: true, force: true });
    }
  });
});
