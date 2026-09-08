/**
 * operations-authority-inventory.test.mjs — WP0's second half, PROVIDER side.
 *
 * MCP is one door onto Governor. It is not the only one, and it is not the
 * important one: the accept gesture has NO MCP surface by design, so an
 * inventory that stopped at the bridge would omit precisely the operations
 * that create standing.
 *
 * This file inventories the accept perimeter — the review-pane controls, the
 * settings-tab controls that share their handlers, and the automation that
 * advances a baseline with no gesture at all — and pins the two structural
 * properties the acceptance model rests on:
 *
 *   1. the accept path contributes ZERO Obsidian commands.
 *      `obsidian_run_command` makes every command agent-reachable through
 *      `executeCommandById`, so an accept command would be a self-approval
 *      primitive one prompt-injection away. The absence is load-bearing, so it
 *      is asserted rather than assumed.
 *   2. the ten authority-bearing functions are module-scope and NOT exported.
 *      Export is what would make one reachable from a plugin instance, a view
 *      instance, or any other object an agent-facing path can get hold of.
 *
 * The registry adds a third, at build time: an action marked `governorOnly`
 * cannot be bound to an agent-reachable surface. That is the static
 * counterpart to the pane's two runtime gesture layers (`addEventListener`
 * rather than `.onclick =`, plus `isRealGesture(evt)` requiring `isTrusted`).
 *
 * ── WHY THESE ASSERTIONS ARE HERE AND NOT IN THE HOST'S SUITE (S3c) ─────────
 *
 * They were all in `packages/host/tests/operations-non-mcp-inventory.test.mjs`
 * until the split, scanning `src/governor/wiring/wiring.ts`. That path left the
 * host, and the two halves of the file would have failed differently and
 * dishonestly: the file-reading scans would have thrown ENOENT, while the
 * zero-commands scan — which filtered for the prefix `src/governor/wiring/` —
 * would have found nothing to filter and passed VACUOUSLY. A green light on
 * "the accept path registers no command", produced by a scan that could not
 * have seen one, is worse than a red one.
 *
 * ── WHAT THIS FILE IMPORTS ACROSS THE PACKAGE BOUNDARY, AND WHY ─────────────
 *
 * Three things, all from `packages/host`, all deliberate:
 *
 *   • `tests/surface-scan.mjs` — the SAME scanner the host uses, called with
 *     this package's source root. A second copy in this package would be a
 *     forked instrument, and the fork that stops matching is always the one
 *     nobody is looking at. The scanner's four generic functions take a root
 *     for exactly this reason.
 *   • `src/kernel/operations/registry.ts` — the action registry and its
 *     authority fence are host machinery by §6 of the suite-split design. The
 *     fence is what refuses an authority action bound to MCP, and it is tested
 *     here because the only actions it can refuse for are declared here.
 *   • `src/kernel/operations/inventory-mcp.ts` and `inventory-non-mcp.ts` — for
 *     the two claims that SPAN the split and cannot be made from either side
 *     alone: no authority action id is also an MCP tool name, and no surface id
 *     is declared twice across the two inventories. The host cannot make either
 *     claim (it has no authority rows); this package can, so it does.
 *
 * If those imports ever become impossible — separate repos, published packages
 * only — the first two are replaceable by publishing the scanner and the
 * registry as contracts, and the last two are the ones that would genuinely be
 * LOST. Say so out loud now rather than discovering it as a silent deletion.
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  scanCommands,
  scanModuleScopeOnly,
  scanFunctionReaches,
  scanExports,
} from "../../host/tests/surface-scan.mjs";
import {
  ACCEPT_PERIMETER_FUNCTIONS,
  AUTHORITY_AUTOMATION_SURFACES,
  AUTHORITY_INTERNAL_SURFACES,
  AUTHORITY_SURFACES,
  NOT_SURFACES,
  WIRING_EXPORTS,
  WIRING_FILE,
  authorityActions,
  authorityBindings,
} from "../src/kernel/operations/inventory-authority.ts";
import { createActionRegistry } from "../../host/src/kernel/operations/registry.ts";
import { MCP_SURFACE_INVENTORY } from "../../host/src/kernel/operations/inventory-mcp.ts";
import {
  AUTOMATION_SURFACES as HOST_AUTOMATION_SURFACES,
  COMMAND_SURFACES as HOST_COMMAND_SURFACES,
  PLAIN_SURFACES as HOST_PLAIN_SURFACES,
} from "../../host/src/kernel/operations/inventory-non-mcp.ts";

/** This package's source root. Every scan below is rooted here rather than at
 * the host's `src`, which is the whole point of the scanner taking a root. */
const GOVERNOR_SRC = resolvePath(dirname(fileURLToPath(import.meta.url)), "../src");

/** `WIRING_FILE` is package-relative and prefixed `src/`, the same spelling the
 * scanner reports; strip it to resolve against the root. */
const wiringRel = WIRING_FILE.replace(/^src\//, "");

// ── the accept perimeter is unreachable by construction ──────────────────────

describe("authority inventory — the accept perimeter stays module-scope", () => {
  test("every authority function named in the perimeter is present in wiring.ts", async () => {
    const { present } = await scanModuleScopeOnly(wiringRel, ACCEPT_PERIMETER_FUNCTIONS, GOVERNOR_SRC);
    assert.deepEqual(
      [...present].sort(),
      [...ACCEPT_PERIMETER_FUNCTIONS].sort(),
      "a function named in the accept perimeter no longer exists — the inventory is describing code that is gone"
    );
  });

  test("none of them is exported", async () => {
    const { exported } = await scanModuleScopeOnly(wiringRel, ACCEPT_PERIMETER_FUNCTIONS, GOVERNOR_SRC);
    assert.deepEqual(
      [...exported],
      [],
      "exporting an accept-equivalent function is what would let it be reached from a plugin instance, a view " +
        "instance, or any object an agent-facing path can obtain:\n" + [...exported].join(", ")
    );
  });

  test("the export set of wiring.ts is exactly the pinned list", async () => {
    // Checking the ten perimeter names closes ten instances. Pinning the whole
    // export set closes the CLASS: a new export — including one that captures
    // an accept-capable closure without being named after it — becomes a
    // visible decision rather than something a reviewer must happen to notice.
    const actual = await scanExports(wiringRel, GOVERNOR_SRC);
    assert.deepEqual(
      [...actual].sort(),
      [...WIRING_EXPORTS].sort(),
      `${WIRING_FILE}'s exports changed; confirm the new one carries no accept-capable closure, then update WIRING_EXPORTS`
    );
  });

  test("each action's `audited` claim matches whether its implementation reaches appendLog", async () => {
    // The previous draft asserted "the acceptance log records these" in a
    // comment and applied `retention: durable` to every authority action. Two
    // were wrong. A claim about existing behaviour belongs in a scan.
    //
    // `performAccept` and `performRevert` append through their delegates
    // (`acceptNote` / `revertNote`, which call an injected `appendLog`), so
    // those two names count as reaching the log. Each delegate is listed
    // explicitly rather than followed automatically.
    const reaches = await scanFunctionReaches(
      wiringRel,
      ACCEPT_PERIMETER_FUNCTIONS,
      ["appendLog", "acceptNote", "revertNote"],
      GOVERNOR_SRC
    );
    const registry = createActionRegistry();
    for (const action of authorityActions()) registry.register(action);
    for (const b of authorityBindings()) registry.bind(b);

    const wrong = [];
    for (const row of AUTHORITY_SURFACES) {
      const found = reaches.get(row.implementation);
      assert.ok(found !== null && found !== undefined, `could not delimit ${row.implementation} in ${WIRING_FILE}`);
      const logs = found.size > 0;
      const action = registry.get(row.action, 1);
      const claimsDurable = action.retention.operation === "durable";
      if (logs !== claimsDurable) {
        wrong.push(
          `  ${row.action} (via ${row.implementation}): declares retention=${action.retention.operation}, ` +
            `but it ${logs ? "DOES" : "does NOT"} reach the acceptance log`
        );
      }
    }
    assert.deepEqual(wrong, [], "an audit claim that does not match the code is worse than no claim:\n" + wrong.join("\n"));
  });

  test("the two unaudited authority acts are named, so the gap cannot be forgotten", () => {
    // This is a real product gap, not an inventory quirk: `performAdopt` is
    // the mass-silence capability and it writes no operation record at all,
    // and `setClassEnabled` changes what may be admitted without review with
    // no record of who changed it. Pinning the set means fixing either one
    // fails this test and forces the inventory to be updated with it.
    const registry = createActionRegistry();
    for (const action of authorityActions()) registry.register(action);
    for (const b of authorityBindings()) registry.bind(b);
    const unaudited = [...new Set(AUTHORITY_SURFACES.map((r) => r.action))]
      .filter((id) => registry.get(id, 1)?.retention.operation !== "durable")
      .sort();
    assert.deepEqual(unaudited, ["governance.adopt-baseline", "governance.set-auto-accept-class"]);
  });
});

// ── the property the acceptance model rests on ───────────────────────────────

describe("authority inventory — the accept path contributes no command", () => {
  test("src/wiring registers zero Obsidian commands", async () => {
    const commands = await scanCommands(GOVERNOR_SRC);
    const found = [...commands.values()].filter((c) => c.file.startsWith("src/wiring/"));
    assert.deepEqual(
      found,
      [],
      "a command registered from the accept path would be reachable through obsidian_run_command's " +
        "executeCommandById, making it agent-invocable:\n" + found.map((f) => `  ${f.id} in ${f.file}`).join("\n")
    );
  });
});

// ── the registry accepts the authority set, and refuses what it must ─────────

describe("authority inventory — builds a valid action registry", () => {
  const registry = createActionRegistry();
  for (const action of authorityActions()) registry.register(action);
  for (const b of authorityBindings()) registry.bind(b);
  const problems = registry.validate();

  test("validates with no problems", () => {
    assert.deepEqual(problems.map((p) => `${p.code}: ${p.message}`), []);
  });

  test("every authority action is Governor-only and carries the authority class", () => {
    for (const row of AUTHORITY_SURFACES) {
      const action = registry.get(row.action, 1);
      assert.ok(action, `${row.action} is not registered`);
      assert.equal(action.authority.governorOnly, true, `${row.action} must be Governor-only`);
      assert.ok(action.changeClasses.includes("authority"), `${row.action} must carry the authority class`);
    }
  });

  test("every authority binding is ui, automation or internal — never agent-reachable", () => {
    for (const b of authorityBindings()) {
      const action = registry.get(b.action, b.actionVersion);
      if (!action?.authority.governorOnly) continue;
      assert.ok(
        b.kind === "ui" || b.kind === "automation" || b.kind === "internal",
        `authority surface '${b.id}' is bound as '${b.kind}', which an agent can reach`
      );
    }
  });

  test("no authority ACTION id appears in the host's MCP inventory", () => {
    // `row.action`, not `row.id`. Checking the surface id would be vacuous:
    // surface ids are dotted (`governance.pane.accept`) and MCP tool names are
    // snake_case, so they cannot collide by construction and the assertion
    // would pass no matter what. The action id is the thing that could
    // plausibly be exposed as a tool, which is the mistake worth catching.
    //
    // This is one of the two claims that span the split. It is made here
    // because this is the side that has the authority rows; the host's
    // inventory is imported for it. Non-vacuous by construction — the MCP
    // inventory is asserted non-empty first, so a broken import cannot turn
    // this into a pass.
    assert.ok(MCP_SURFACE_INVENTORY.length > 50, "the host's MCP inventory did not load — this check would be vacuous");
    const mcpTools = new Set(MCP_SURFACE_INVENTORY.map((r) => r.tool));
    for (const row of AUTHORITY_SURFACES) {
      assert.ok(!mcpTools.has(row.action), `authority action '${row.action}' also appears as an MCP tool`);
    }
  });
});

// ── the registry REFUSES the thing it exists to refuse ───────────────────────

describe("authority inventory — binding an authority action to MCP fails the build", () => {
  test("the fence is live, not merely documented", () => {
    const registry = createActionRegistry();
    for (const action of authorityActions()) registry.register(action);
    for (const b of authorityBindings()) registry.bind(b);
    // The exact mistake a future contributor might make: exposing accept as a tool.
    registry.bind({ kind: "mcp", id: "obsidian_accept_proposal", action: AUTHORITY_SURFACES[0].action, actionVersion: 1 });
    const codes = registry.validate().map((p) => p.code);
    assert.ok(
      codes.includes("authority_agent_surface"),
      `binding an authority action to an MCP surface must fail validation; got: ${codes.join(", ") || "(no problems)"}`
    );
  });
});

// ── the rows describe code that exists ───────────────────────────────────────

describe("authority inventory — every declared path is real", () => {
  test("every row and every binding names a file that exists", async () => {
    const rows = [
      ...AUTHORITY_AUTOMATION_SURFACES.map((r) => ({ id: r.id, file: r.file })),
      ...AUTHORITY_INTERNAL_SURFACES.map((r) => ({ id: r.id, file: r.file })),
      ...authorityBindings().filter((b) => b.source).map((b) => ({ id: b.id, file: b.source })),
    ];
    assert.ok(rows.length > 0, "nothing scanned — the inventory is empty or the shape changed");
    for (const row of rows) {
      const abs = resolvePath(GOVERNOR_SRC, row.file.replace(/^src\//, ""));
      const text = await readFile(abs, "utf8").catch(() => null);
      assert.ok(text !== null, `surface '${row.id}' names ${row.file}, which does not exist`);
    }
  });

  test("`touchesAuthority` is enforced, not decoration", () => {
    // The field was dead data in the first draft: declared, set, and read by
    // nothing. A flag that records "this automation can change authority
    // state" and then changes nothing is worse than no flag, because it reads
    // as a control. The claim is backed iff an authority action is actually
    // bound to an automation surface in the file the row names.
    const authorityAutomationFiles = new Set(
      authorityBindings()
        .filter((b) => b.kind === "automation" && b.source)
        .filter((b) => AUTHORITY_SURFACES.some((r) => r.action === b.action))
        .map((b) => b.source)
    );
    for (const row of AUTHORITY_AUTOMATION_SURFACES) {
      if (row.touchesAuthority) {
        assert.ok(
          authorityAutomationFiles.has(row.file),
          `automation row '${row.id}' claims touchesAuthority but no authority action is bound to an automation ` +
            `surface in ${row.file} — the claim is not backed by a fenced action`
        );
      } else {
        assert.ok(
          !authorityAutomationFiles.has(row.file),
          `automation row '${row.id}' does NOT claim touchesAuthority, but an authority action is bound to an ` +
            `automation surface in ${row.file}`
        );
      }
    }
  });

  test("the NOT_SURFACES exclusions each name a real function and the action they belong to", async () => {
    // An inventory is only trustworthy if "why isn't this listed?" has a
    // written answer. Each exclusion must be a function that actually exists
    // and must name a declared action as its owner.
    const declaredActions = new Set(AUTHORITY_SURFACES.map((r) => r.action));
    const { present } = await scanModuleScopeOnly(
      wiringRel,
      NOT_SURFACES.map((n) => n.name),
      GOVERNOR_SRC
    );
    for (const n of NOT_SURFACES) {
      assert.ok(n.partOf?.length > 5, `${n.name} needs a stated owner`);
      // `appendLog` is owned by "every audited authority action" rather than
      // one id, so only single-id owners are checked against the registry.
      // An owner is either a declared action id, or an explicit statement that
      // the helper is shared rather than one action's. Both are acceptable
      // answers to "why isn't this listed"; a name that is neither is not.
      const shared = /shared|every/.test(n.partOf);
      assert.ok(
        declaredActions.has(n.partOf) || shared,
        `${n.name} names owner '${n.partOf}', which is neither a declared action nor an explicit shared-infrastructure note`
      );
    }
    // EXACT set, not a size check. `present.size > 0` would still pass with
    // seven of the eight renamed or deleted — which is precisely the
    // "describing gone code" failure this is supposed to catch. Same pattern
    // the accept-perimeter check already uses.
    assert.deepEqual(
      [...present].sort(),
      NOT_SURFACES.map((n) => n.name).sort(),
      `an excluded helper named here no longer exists in ${WIRING_FILE} — the exclusion list is describing gone code`
    );
  });
});

// ── the claims that span the split ───────────────────────────────────────────
//
// Neither package can make these alone, and both were single-package checks
// before S3c. They are asserted from this side because this side is the one
// that can import the other without inverting the dependency: a host that
// imported the provider's inventory to check its own rows would be the layering
// the whole split exists to remove.

describe("authority inventory — the cross-package claims", () => {
  test("a host settings control that reaches an authority action names a REAL one", () => {
    // `settings.module-enabled` declares `reachesAuthority:
    // "governance.rekey-baseline"` — enabling the acceptance module mounts
    // governance, and mounting arms the one-shot metadataCache "resolved"
    // handler that runs `reconcileBaselines`. The host pins that exactly one
    // control makes the claim; only this side can say whether the id is a
    // declared authority action.
    const reaching = HOST_PLAIN_SURFACES.filter((r) => r.reachesAuthority);
    assert.ok(reaching.length > 0, "the host's plain surfaces did not load — this check would be vacuous");
    const authorityActionIds = new Set(AUTHORITY_SURFACES.map((r) => r.action));
    for (const row of reaching) {
      assert.ok(
        authorityActionIds.has(row.reachesAuthority),
        `host surface '${row.id}' names '${row.reachesAuthority}', which is not a declared authority action`
      );
    }
  });

  test("no surface id is declared twice across the two packages", () => {
    // Uniqueness across the whole registry is what makes the inverse inventory
    // a lookup rather than a search. Each package pins its own half; the union
    // is only checkable here.
    const ids = [
      ...HOST_COMMAND_SURFACES.map((r) => `command:${r.id}`),
      ...HOST_AUTOMATION_SURFACES.map((r) => r.id),
      ...HOST_PLAIN_SURFACES.map((r) => r.id),
      ...AUTHORITY_SURFACES.map((r) => r.id),
      ...AUTHORITY_AUTOMATION_SURFACES.map((r) => r.id),
      ...AUTHORITY_INTERNAL_SURFACES.map((r) => r.id),
    ];
    assert.ok(ids.length > 20, "one of the two inventories did not load — this check would be vacuous");
    const seen = new Set();
    const duplicates = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    assert.deepEqual(duplicates, []);
  });
});

// ── the scans are proven, not assumed ────────────────────────────────────────
//
// Both claims this file makes about ABSENCE — no command under `src/wiring/`,
// no exported perimeter function — are the kind that a broken scanner passes
// loudest. The zero-commands claim is exactly the one that started passing for
// the wrong reason when the subtree moved out of the host, so it is proven
// against a planted command in the very directory it is about.
//
// These blocks run LAST: a planted file is a real file to every scan in the
// process until its `after` hook removes it.

describe("authority inventory — the command scan is proven against a planted command", () => {
  const planted = resolvePath(GOVERNOR_SRC, "wiring/__command-scan-scratch.ts");
  after(() => rm(planted, { force: true }));

  test("a command planted inside src/wiring is caught", async () => {
    await writeFile(
      planted,
      [
        "// [test artifact — safe to delete] planted by operations-authority-inventory.test.mjs",
        "export function registerPlanted(plugin: { addCommand: (c: unknown) => void }) {",
        '  plugin.addCommand({ id: "planted-violation", name: "Planted", callback: () => {} });',
        "}",
        "",
      ].join("\n"),
      "utf8"
    );
    const commands = await scanCommands(GOVERNOR_SRC);
    const found = [...commands.values()].filter((c) => c.file.startsWith("src/wiring/"));
    assert.deepEqual(
      found.map((f) => f.id),
      ["planted-violation"],
      "the command scan no longer matches this repo's addCommand shape, or no longer reads this package's tree — " +
        "the zero-commands claim above would pass whatever the accept path registers"
    );
  });
});

describe("authority inventory — the module-scope and reach scans are proven against a planted module", () => {
  const planted = resolvePath(GOVERNOR_SRC, "wiring/__perimeter-scan-scratch.ts");
  after(() => rm(planted, { force: true }));

  test("an exported function is reported as exported, and a reached callee as reached", async () => {
    // Three instruments, one scratch module, both directions each. "None of
    // the perimeter is exported" is an emptiness claim: it stays true if the
    // export regex silently stops matching, so the regex is made to fire here.
    // The reach scan gets the same treatment in both directions — a function
    // that DOES call the callee and one that does not — because a scan that
    // reports nothing and a scan that reports everything both make the
    // `audited` verification meaningless.
    await writeFile(
      planted,
      [
        "// [test artifact — safe to delete] planted by operations-authority-inventory.test.mjs",
        "function plantedHidden() {",
        "  return 1;",
        "}",
        "export function plantedExposed() {",
        "  plantedAppendLog();",
        "}",
        "function plantedAppendLog() {}",
        "",
      ].join("\n"),
      "utf8"
    );
    const rel = "wiring/__perimeter-scan-scratch.ts";

    const { present, exported } = await scanModuleScopeOnly(rel, ["plantedHidden", "plantedExposed"], GOVERNOR_SRC);
    assert.deepEqual([...present].sort(), ["plantedExposed", "plantedHidden"]);
    assert.deepEqual([...exported], ["plantedExposed"], "the export regex no longer fires — 'none of them is exported' would pass on an exported perimeter");

    const exports = await scanExports(rel, GOVERNOR_SRC);
    assert.deepEqual([...exports], ["plantedExposed"]);

    const reaches = await scanFunctionReaches(rel, ["plantedExposed", "plantedHidden"], ["plantedAppendLog"], GOVERNOR_SRC);
    assert.deepEqual([...reaches.get("plantedExposed")], ["plantedAppendLog"]);
    assert.deepEqual([...reaches.get("plantedHidden")], [], "the reach scan reports a call that is not there");
  });
});
