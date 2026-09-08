/**
 * operations-non-mcp-inventory.test.mjs — WP0's second half, HOST side.
 *
 * MCP is one door onto the host. It is not the only one: `obsidian_run_command`
 * makes every registered command agent-reachable through `executeCommandById`,
 * automation runs with no caller at all, and the bridge writes outside the
 * vault on every load whether or not the socket is enabled. This file
 * inventories those doors in both directions — declared rows must exist in the
 * source, and registered surfaces must have a row.
 *
 * ── WHAT LEFT THIS FILE AT S3c ──────────────────────────────────────────────
 *
 * The accept perimeter's assertions are in
 * `packages/governor/tests/operations-authority-inventory.test.mjs` now, with
 * the rows they check. Every one of them scanned `src/governor/wiring/wiring.ts`,
 * which is not in this package's tree any more, so leaving them here would have
 * produced two failure modes and no honest outcome: the file-reading scans
 * (`scanModuleScopeOnly`, `scanExports`, `scanFunctionReaches`) would throw
 * ENOENT, and the governance-command scan — an EMPTINESS claim — would have
 * filtered a prefix that can no longer match and passed VACUOUSLY, which is the
 * worse of the two because it looks like success.
 *
 * Specifically gone from here: the perimeter presence/export checks, the export
 * pinning of `wiring.ts`, the `audited` verification against `appendLog`, the
 * two-unaudited-acts pin, the authority half of the registry checks, the
 * "binding an authority action to MCP fails the build" fence test, and the
 * `NOT_SURFACES` exclusion checks. The registry FENCE itself is still host code
 * — only the actions it refuses for moved.
 *
 * One claim is now checked in the other package and is worth naming rather than
 * leaving to be discovered: `settings.module-enabled` declares
 * `reachesAuthority: "governance.rekey-baseline"`, and whether that id is a
 * DECLARED authority action can only be answered where the authority actions
 * live. The host still pins that exactly one settings control makes the claim;
 * the provider's test pins that the id it names is real.
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { scanCommands, scanAutomationSites, PLUGIN_SRC } from "./surface-scan.mjs";
import {
  COMMAND_SURFACES,
  AUTOMATION_SURFACES,
  PLAIN_SURFACES,
  outsideVaultSurfaces,
  nonMcpActions,
  nonMcpBindings,
  plainActions,
  plainBindings,
} from "../src/kernel/operations/inventory-non-mcp.ts";
import { createActionRegistry } from "../src/kernel/operations/registry.ts";

const commands = await scanCommands();

// ── Obsidian commands, both directions ───────────────────────────────────────

describe("non-MCP inventory — Obsidian commands", () => {
  const declared = new Map(COMMAND_SURFACES.map((r) => [r.id, r]));

  test("every declared command exists in the source", () => {
    const missing = [...declared.keys()].filter((id) => !commands.has(id));
    assert.deepEqual(missing, [], `declared but never registered: ${missing.join(", ")}`);
  });

  test("every registered command is declared", () => {
    const undeclared = [...commands.keys()].filter((id) => !declared.has(id));
    assert.deepEqual(
      undeclared,
      [],
      "these commands are registered but have no action — a command is as reachable as an MCP tool " +
        "(obsidian_run_command executes any of them by id), so it needs a row:\n" +
        undeclared.map((id) => `  ${id} (${commands.get(id).file})`).join("\n")
    );
  });

  test("the counts match", () => {
    assert.equal(declared.size, commands.size);
  });
});

// ── the property the acceptance model rests on ───────────────────────────────
//
// "The accept path registers ZERO Obsidian commands" is asserted in the
// provider's suite now, over the provider's tree. It cannot be asserted here:
// the subtree it is about left, and a filter over a prefix this package no
// longer contains returns `[]` whatever the provider does.
//
// What remains host-side is the other half of the same property, and it is not
// redundant: a command declared HERE may never bind an authority action,
// because a command is agent-invocable by id.

describe("non-MCP inventory — no host command binds authority", () => {
  test("no declared command's action is Governor-only", () => {
    for (const row of COMMAND_SURFACES) {
      assert.notEqual(row.authority, "governor-only", `command '${row.id}' must not bind an authority action`);
    }
  });
});

// ── automation ───────────────────────────────────────────────────────────────

describe("non-MCP inventory — automation entry points", () => {
  test("every declared automation site exists in its named file", async () => {
    const scanned = await scanAutomationSites();
    const byFile = new Map();
    for (const s of scanned) byFile.set(s.file, (byFile.get(s.file) ?? 0) + 1);
    for (const row of AUTOMATION_SURFACES) {
      assert.ok(
        byFile.has(row.file),
        `automation row '${row.id}' names ${row.file}, which contains no automation entry point at all`
      );
    }
  });

  test("no host automation claims `touchesAuthority`", () => {
    // The field was dead data in the first draft: declared, set, and read by
    // nothing. A flag that records "this automation can change authority
    // state" and then changes nothing is worse than no flag, because it reads
    // as a control. It used to be enforced by cross-referencing the authority
    // bindings emitted from this same file — "the claim is backed by a fenced
    // action, in the file the row names".
    //
    // After S3c there is nothing here to cross-reference: the one row that
    // claimed it, and every authority action that could back it, are in the
    // provider. So the host's half of the claim is now the STRONGER, simpler
    // one — no host automation may claim it at all, because no host action can
    // back it. The positive case (the governance row's claim IS backed) is
    // asserted in the provider's suite, against the provider's bindings.
    for (const row of AUTOMATION_SURFACES) {
      assert.equal(
        row.touchesAuthority,
        false,
        `automation row '${row.id}' claims touchesAuthority, but authority-bearing automation lives in the ` +
          `governance provider — nothing this package declares can back the claim`
      );
    }
    // Belt and braces on the other side: no binding this file emits may point
    // at an authority action, whatever the rows say.
    const registry = createActionRegistry();
    for (const action of nonMcpActions()) registry.register(action);
    const authorityBound = nonMcpBindings().filter((b) => registry.get(b.action, b.actionVersion)?.authority.governorOnly);
    assert.deepEqual(authorityBound.map((b) => b.id), []);
  });

  test("every file containing an automation entry point is represented", async () => {
    const scanned = await scanAutomationSites();
    const declaredFiles = new Set(AUTOMATION_SURFACES.map((r) => r.file));
    const unrepresented = [...new Set(scanned.map((s) => s.file))].filter((f) => !declaredFiles.has(f));
    assert.deepEqual(
      unrepresented,
      [],
      "these files subscribe to events, arm timers, or hook layout-ready but have no automation row — work that " +
        "runs with no caller is the hardest kind to notice, so it must be declared:\n" +
        unrepresented.map((f) => `  ${f}`).join("\n")
    );
  });
});

// ── the registry accepts the whole non-MCP set ───────────────────────────────

describe("non-MCP inventory — builds a valid action registry", () => {
  const registry = createActionRegistry();
  for (const action of nonMcpActions()) registry.register(action);
  for (const b of nonMcpBindings()) registry.bind(b);
  const problems = registry.validate();

  test("validates with no problems", () => {
    assert.deepEqual(problems.map((p) => `${p.code}: ${p.message}`), []);
  });

  test("no host action is Governor-only", () => {
    // The inverse of what this block used to assert. It listed the nine
    // authority actions and checked each was `governorOnly` with the
    // `authority` class; those nine are the provider's now, and what is
    // checkable here is that this package declares NONE — a host action that
    // acquired `governorOnly` would be an authority contract on the wrong side
    // of the split, and it would be bound to a command or a timer that an
    // agent can reach.
    for (const action of nonMcpActions()) {
      assert.equal(action.authority.governorOnly, false, `${action.id} must not be Governor-only`);
      assert.ok(!action.changeClasses.includes("authority"), `${action.id} must not carry the authority class`);
    }
  });
});

// ── the scans are proven, not assumed ────────────────────────────────────────
//
// Two source scans survive in this file after S3c, and both are now proven the
// same way. The command scan always was. The automation scan was not: its
// presence direction ("every declared row's file contains an entry point")
// does fail loudly if the scanner breaks, but its OTHER direction is an
// emptiness claim over files nobody declared, and the split is exactly the
// event that teaches how quietly an emptiness claim rots. So it gets a planted
// violation too.
//
// Order matters and is load-bearing: these blocks run AFTER the ones that
// assert over the real tree, because a planted file is a real file to every
// scan in the process until its `after` hook removes it.

describe("non-MCP inventory — the command scan is proven against a planted command", () => {
  const planted = resolvePath(PLUGIN_SRC, "__command-scan-scratch.ts");
  after(() => rm(planted, { force: true }));

  test("a newly added command is caught and reported as undeclared", async () => {
    await writeFile(
      planted,
      [
        "// [test artifact — safe to delete] planted by operations-non-mcp-inventory.test.mjs",
        "export function registerPlanted(plugin: { addCommand: (c: unknown) => void }) {",
        '  plugin.addCommand({ id: "planted-violation", name: "Planted", callback: () => {} });',
        "}",
        "",
      ].join("\n"),
      "utf8"
    );
    const rescan = await scanCommands();
    assert.ok(
      rescan.has("planted-violation"),
      "the command scan no longer matches this repo's addCommand shape — it would silently under-report a new command"
    );
  });
});

describe("non-MCP inventory — the automation scan is proven against a planted subscription", () => {
  const planted = resolvePath(PLUGIN_SRC, "__automation-scan-scratch.ts");
  after(() => rm(planted, { force: true }));

  test("a newly added event subscription is caught and reported as unrepresented", async () => {
    await writeFile(
      planted,
      [
        "// [test artifact — safe to delete] planted by operations-non-mcp-inventory.test.mjs",
        "export function armPlanted(plugin: { registerEvent: (e: unknown) => void }, ref: unknown) {",
        "  plugin.registerEvent(ref);",
        "}",
        "",
      ].join("\n"),
      "utf8"
    );
    const scanned = await scanAutomationSites();
    const declaredFiles = new Set(AUTOMATION_SURFACES.map((r) => r.file));
    const unrepresented = [...new Set(scanned.map((s) => s.file))].filter((f) => !declaredFiles.has(f));
    assert.deepEqual(
      unrepresented,
      ["src/__automation-scan-scratch.ts"],
      "the automation scan no longer matches a registerEvent call — work that starts with no caller would go " +
        "undeclared and nothing would say so"
    );
  });
});

// ── bridge, settings, and internal surfaces ──────────────────────────────────

describe("non-MCP inventory — bridge, settings and internal surfaces", () => {
  test("every plain surface names a file that exists", async () => {
    for (const row of PLAIN_SURFACES) {
      const abs = resolvePath(PLUGIN_SRC, row.file.replace(/^src\//, ""));
      const text = await readFile(abs, "utf8").catch(() => null);
      assert.ok(text !== null, `surface '${row.id}' names ${row.file}, which does not exist`);
    }
  });

  // The same check for the OTHER two places the inventory records a source path. PLAIN_SURFACES
  // had it; AUTOMATION_SURFACES and the bindings' `source` did not, so a rename could leave
  // either naming a file that no longer exists and nothing would say so — an inventory that
  // points at a dead path describes a codebase nobody has.
  test("every automation surface and every non-MCP binding names a file that exists", async () => {
    const rows = [
      ...AUTOMATION_SURFACES.map((r) => ({ id: r.id, file: r.file })),
      // Command bindings carry no `source` (their file is COMMAND_SURFACES' own scan); the
      // automation bindings do, and those are the ones that name a path. The authority
      // bindings used to be the other half of this check and are pinned the same way in the
      // provider's suite, against the provider's tree.
      ...nonMcpBindings().filter((b) => b.source).map((b) => ({ id: b.id, file: b.source })),
    ];
    assert.ok(rows.length > 0, "nothing scanned — the inventory is empty or the shape changed");
    for (const row of rows) {
      const abs = resolvePath(PLUGIN_SRC, row.file.replace(/^src\//, ""));
      const text = await readFile(abs, "utf8").catch(() => null);
      assert.ok(text !== null, `surface '${row.id}' names ${row.file}, which does not exist`);
    }
  });

  // Uniqueness is what makes the inverse inventory a lookup rather than a
  // search, and after S3c the surface ids live in two packages — so this check
  // covers the host's half only, and the provider's test checks the union
  // (its own ids, plus these, in one set). Neither package can do it alone.
  test("no duplicate surface ids across the whole non-MCP inventory", () => {
    const ids = [
      ...COMMAND_SURFACES.map((r) => `command:${r.id}`),
      ...AUTOMATION_SURFACES.map((r) => r.id),
      ...PLAIN_SURFACES.map((r) => r.id),
    ];
    assert.equal(new Set(ids).size, ids.length);
  });

  test("the outside-vault writers are exactly the known set, across ALL surface families", () => {
    // The plugin's footprint outside the vault is a privacy disclosure, and it
    // belongs in one checkable place rather than spread across a README.
    //
    // Computed over every family, not just PLAIN_SURFACES. The first draft
    // scoped it to the bridge/settings rows while claiming to describe the
    // whole plugin, which at the time silently omitted the skills export and
    // release COMMANDS and their export-on-save TIMER — three writes outside
    // the vault, in two families the computation never looked at. Skills has
    // since become its own plugin, so those three ids are gone from this list
    // and the example is historical; the rule it bought is not. A disclosure
    // scoped to one row family is not a disclosure, and the next command or
    // timer that writes outside the vault must land here without anyone
    // remembering to widen the computation.
    const outside = outsideVaultSurfaces().map((r) => r.id);
    assert.deepEqual(outside, [
      "bridge.claude-register",
      "bridge.ensure-connect-plugin",
      "bridge.remove-discovery",
      "bridge.write-bridge",
      "bridge.write-discovery",
      "settings.connect-claude-code",
      "settings.disconnect",
    ]);
  });

  test("the network-reaching surfaces are named", () => {
    // Exactly one, and it is the one a distribution review will ask about:
    // provisioning the companion Claude Code plugin adds a marketplace source
    // and installs a second plugin at USER scope, which reaches the network to
    // do it, on every plugin load.
    const network = outsideVaultSurfaces().filter((r) => r.network).map((r) => r.id);
    assert.deepEqual(network, ["bridge.ensure-connect-plugin"]);
  });

  test("the unconditional-on-load surfaces are named, because they ignore settings.enabled", () => {
    // `writeBridge()` and `autoRegister()` run on every plugin load whether or
    // not the socket is enabled. A user who turns Governor's socket off still
    // gets a file written outside the vault and a binary spawned; that is
    // surprising enough to pin.
    const unconditional = PLAIN_SURFACES.filter((r) => r.unconditional).map((r) => r.id).sort();
    assert.deepEqual(unconditional, ["bridge.claude-register", "bridge.ensure-connect-plugin", "bridge.write-bridge"]);
  });

  test("a settings control that reaches an authority action says which one", () => {
    const reaching = PLAIN_SURFACES.filter((r) => r.reachesAuthority);
    // Exactly one today: enabling the acceptance module mounts governance,
    // which arms the one-shot reconcileBaselines handler.
    assert.deepEqual(reaching.map((r) => r.id), ["settings.module-enabled"]);
    // Every row making the claim must name SOMETHING action-shaped. Whether
    // the id it names is a DECLARED authority action is asked in the
    // provider's suite, which is where the authority actions now are. Half a
    // check here beats the appearance of a whole one: this catches an empty or
    // accidental value, and the provider catches a wrong one.
    for (const row of reaching) {
      assert.equal(typeof row.reachesAuthority, "string");
      assert.ok(
        row.reachesAuthority.startsWith("governance."),
        `'${row.id}' names '${row.reachesAuthority}', which is not an action id`
      );
    }
  });

  // The `NOT_SURFACES` exclusion check — "why isn't this listed?" answered for
  // each of the eight helpers inside `wiring.ts`, and each name proven still to
  // exist — was here until S3c. All eight are the provider's, so the list and
  // its test went there together. This package has no exclusion list of its
  // own, which is a gap rather than a decision: the same question can be asked
  // of the host's helpers and nothing here answers it.

  test("the whole non-MCP inventory builds a valid registry together", () => {
    const registry = createActionRegistry();
    for (const a of [...nonMcpActions(), ...plainActions()]) registry.register(a);
    for (const b of [...nonMcpBindings(), ...plainBindings()]) registry.bind(b);
    assert.deepEqual(registry.validate().map((p) => `${p.code}: ${p.message}`), []);
  });
});
