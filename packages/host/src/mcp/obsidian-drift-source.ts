// obsidian-drift-source.ts — the Obsidian adapter for the scheme Drift pane
// (Stage C of the jd-dashboard fold, the "live conformance-engine call path"
// the design doc flagged as an open question). NOT a new call path: this
// reuses the exact same in-process `runConformance` call the ALREADY-SHIPPED
// `obsidian_conformance_debt` MCP tool makes (see obsidian-debt-source.ts,
// this file's sibling and closest precedent) — same root resolution, same
// baseline-path/excluded-roots env resolution, same DEFAULT_VOCABULARIES/
// DEFAULT_SCHEMES/legacyPacks:true config. The only difference is what
// happens to the result: obsidian-debt-source.ts discards the ratchet and
// keeps raw findings (debt reporting doesn't care about new-vs-carried);
// this keeps the ratchet and narrows to the scheme pack's NEW findings via
// conformance/drift-view.ts's newSchemeDrift, matching the original
// jd-dashboard drift panel's "show me what's newly wrong" framing.
//
// That difference is exactly why this file MUST run the pre-flight refusals
// `cli.ts`'s `runCli` runs before calling `runConformance` — `runConformance`
// itself has no such guard, it trusts whatever `baselineText`/`excludedRoots`
// it's handed (obsidian-debt-source.ts runs only the post-run coverage
// refusal, #294, because it discards the ratchet — see below):
//
//   - `baselineMissingRefusal`: a MISSING baseline must never silently read
//     as empty. An empty baseline makes EVERY live finding read NEW — a
//     report that looks like catastrophic regression but is really a
//     missing/misconfigured file. obsidian-debt-source.ts gets away with
//     `readOrNull(...) ?? ""` because it discards the ratchet entirely
//     (`liveFindings()` never reads `res.ratchet`); this file keeps the
//     ratchet, so the same pattern here would flood the pane with false
//     "new drift" for the vault's ENTIRE accepted-debt backlog on every
//     first-run/misconfigured/sync-glitch case. Reusing the CLI's own
//     exported refusal rather than duplicating its wording.
//   - `excludedRootRefusal`: the inverse hazard — an `excludedRoots` value
//     that would strand baseline keys under a root this run no longer looks
//     at makes those keys read CLEARED (falsely "resolved!"), for the same
//     reason. Also harmless in debt-source.ts (ratchet discarded), also not
//     harmless here.
//
// Verify this against a running Obsidian; the view core it feeds
// (drift-view.ts) is fully unit-tested.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { App } from "obsidian";
import {
  runConformance,
  baselineRelFrom,
  excludedRootsFrom,
  baselineMissingRefusal,
  excludedRootRefusal,
  coverageRefusal,
  baselinePackIds,
} from "../conformance/cli.js";
import { parseBaseline } from "../conformance/ratchet.js";
import { newSchemeDrift, type DriftGroup } from "../conformance/drift-view.js";
import { DEFAULT_VOCABULARIES } from "@vault-mcp/core";
import { DEFAULT_SCHEMES } from "../kernel/scheme/registry.js";

/** The on-disk root of this vault (FileSystemAdapter). Desktop-only, which
 *  the plugin already is (`isDesktopOnly: true`) — same helper as
 *  obsidian-debt-source.ts's `vaultRoot`, duplicated rather than shared
 *  since that one is private to its own file. */
function vaultRoot(app: App): string {
  const adapter = app.vault.adapter as unknown as { basePath?: string; getBasePath?: () => string };
  return adapter.basePath ?? adapter.getBasePath?.() ?? "";
}

export interface DriftPaneSource {
  /** Run the conformance engine and return the scheme pack's NEW findings
   *  (not already-accepted debt), grouped by check. Throws (surfaced by the
   *  pane as an error state, never silently swallowed into a wrong result)
   *  when the baseline is missing, an excluded root would strand accepted
   *  debt, or a pack the baseline describes did not run (#294) — see this
   *  file's header. */
  scan(): Promise<DriftGroup[]>;
}

export function obsidianDriftSource(app: App, territories?: () => readonly string[]): DriftPaneSource {
  const root = vaultRoot(app);
  const baselinePath = join(root, baselineRelFrom(process.env));
  const excludedRoots = excludedRootsFrom([], process.env);

  return {
    async scan(): Promise<DriftGroup[]> {
      const missing = baselineMissingRefusal(baselinePath, existsSync(baselinePath), false);
      if (missing) throw new Error(missing);
      const baselineText = await readFile(baselinePath, "utf8");

      const strand = excludedRootRefusal(parseBaseline(baselineText), excludedRoots);
      if (strand) throw new Error(strand);

      const res = await runConformance({
        root,
        baselineText,
        vocabularies: DEFAULT_VOCABULARIES,
        schemes: DEFAULT_SCHEMES,
        excludedRoots,
        legacyPacks: true,
        territories: territories?.(),
      });
      // #294: the same refusal `runCli` applies — a pack the baseline describes
      // that did not run (threw, or dead convention path, #298) must not read
      // as CLEARED. Exported function, never reimplemented, in both adapters.
      const coverage = coverageRefusal(baselinePackIds(parseBaseline(baselineText)), new Set(res.coveredPackIds), "run");
      if (coverage) throw new Error(coverage);
      return newSchemeDrift(res.findings, res.ratchet);
    },
  };
}
