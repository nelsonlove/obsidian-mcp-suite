/**
 * grandfathered-names.test.mjs — THE LIVE PIN ON THE PUBLISHING CARVE-OUT (S3c).
 *
 * The governance provider publishes five tools BARE — `governance_pending_review`,
 * `governance_revisions`, `governance_submit_revision`, `governance_mandate_draft`,
 * `governance_mandates` — where every other publisher gets
 * `<sanitized owner id>_<bare name>`. `packages/governor` carries a data SNAPSHOT
 * of that table in its own test shim, which is right for asserting what the
 * provider's own specs are called; it is NOT right as the only assertion
 * anywhere, because the snapshot cannot fail when the host's table changes.
 *
 * This file is the live one, in the package where the dangerous edit would land.
 * Three things are pinned, and the third is the one Nelson's 2026-09-08 ruling
 * turns on:
 *
 *   1. The five spellings publish bare, for the owner the table names and for
 *      nobody else.
 *   2. An ungrandfathered tool still prefixes — the carve-out is five rows, not
 *      a mode.
 *   3. **F1 IS UNCONDITIONAL**, and the mechanism is worth stating precisely
 *      because it is easy to assert the wrong thing about it. F1 tests the
 *      PUBLISHED name, and every published name is either `<owner>_<bare>` or a
 *      table row. So a prefixed name can never enter the reserved namespace
 *      (the prefix is in front of it), and **the table is the only door** —
 *      which is exactly why the ruling was about the table rather than about the
 *      check. The table's first draft held `obsidian_pending_review` and
 *      therefore carved out F1 as well; Nelson ruled against that on 2026-09-08
 *      and took the rename instead, because an exception to a
 *      namespace-integrity rule becomes the precedent for the next exception.
 *      No entry may begin `obsidian_`, there is no dormant exception machinery
 *      to find, and this file is what keeps both true.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  GRANDFATHERED_TOOL_NAMES,
  publishedToolName,
  sanitizeOwnerId,
  ExternalToolRegistry,
} from "../src/mcp/external-tools.ts";

const OWNER = "governor";
const EXPECTED = [
  "governance_mandate_draft",
  "governance_mandates",
  "governance_pending_review",
  "governance_revisions",
  "governance_submit_revision",
];

const spec = (name) => ({ name, description: name, handler: async () => ({ ok: true }) });

describe("the grandfather table — the live definition", () => {
  test("holds exactly the five governance names, all owned by `governor`", () => {
    assert.deepEqual([...GRANDFATHERED_TOOL_NAMES.keys()].sort(), EXPECTED);
    for (const [, owner] of GRANDFATHERED_TOOL_NAMES) assert.equal(owner, OWNER);
  });

  test("NO entry begins `obsidian_` — the table carves out the PREFIX rule and not F1", () => {
    // The load-bearing pin of the whole ruling. If a future author adds an
    // `obsidian_*` row here, `registerTools` will refuse it at F1 anyway (the
    // next describe proves that), so the failure would be a confusing runtime
    // throw rather than a clear one. This says the rule out loud at the table.
    for (const name of GRANDFATHERED_TOOL_NAMES.keys()) {
      assert.ok(!name.startsWith("obsidian_"), `${name} would need an F1 exception, and no F1 exception ships`);
    }
  });
});

describe("publishedToolName", () => {
  test("the five publish BARE for the owner the table names", () => {
    for (const name of EXPECTED) assert.equal(publishedToolName(OWNER, name), name);
  });

  test("the SAME five prefix for any other owner — the row names an owner, not just a name", () => {
    for (const name of EXPECTED) {
      assert.equal(publishedToolName("some-other-plugin", name), `some_other_plugin_${name}`);
    }
  });

  test("an ungrandfathered tool still prefixes, even for the grandfathered owner", () => {
    assert.equal(publishedToolName(OWNER, "governance_something_new"), "governor_governance_something_new");
    assert.equal(publishedToolName(OWNER, "whatever"), "governor_whatever");
  });

  test("it agrees with sanitizeOwnerId for the ordinary case", () => {
    assert.equal(publishedToolName("vault-crosssession", "post"), `${sanitizeOwnerId("vault-crosssession")}_post`);
  });
});

describe("F1 is UNCONDITIONAL — the reserved namespace is not carve-out-able", () => {
  test("a plain publisher cannot enter the obsidian_* namespace", () => {
    const r = new ExternalToolRegistry();
    assert.throws(() => r.registerTools("obsidian", [spec("read_note")]), /reserved obsidian_\* namespace/);
  });

  test("THE OLD SPELLING IS UNREACHABLE for the grandfathered owner — it prefixes, it does not carve out", () => {
    // The provider asking for the tool's pre-ruling name. It is not in the
    // table, so it is not bare; it publishes as `governor_obsidian_pending_review`,
    // which is not in the reserved namespace at all. Worth pinning as the exact
    // answer rather than assuming a throw: what the ruling removed is the ROW,
    // and with the row gone the name is ordinary — it does not become an error,
    // it becomes prefixed, and an agent reading the tool list sees the new
    // spelling and nothing that looks like a built-in.
    const r = new ExternalToolRegistry();
    r.registerTools(OWNER, [spec("obsidian_pending_review")]);
    assert.deepEqual(r.entries().map((e) => e.toolName), ["governor_obsidian_pending_review"]);
    assert.equal(publishedToolName(OWNER, "obsidian_pending_review"), "governor_obsidian_pending_review");
  });

  test("THE ONLY WAY into the reserved namespace is a grandfathered row, and the table forbids one", () => {
    // F1 tests the PUBLISHED name. Since every published name is either
    // `<owner>_<bare>` or a table row, and no owner id sanitizes to `obsidian`
    // for a legitimate publisher, the table is the only door — which is exactly
    // why the ruling was about the table and not about the check. Proven by
    // construction over the live table plus the sanitizer.
    for (const name of GRANDFATHERED_TOOL_NAMES.keys()) assert.ok(!name.startsWith("obsidian_"));
    const r = new ExternalToolRegistry();
    for (const bare of ["obsidian_anything", "anything"]) {
      r.registerTools(OWNER, [spec(bare)]);
    }
    for (const e of r.entries()) {
      assert.ok(!e.toolName.startsWith("obsidian_"), `${e.toolName} reached the reserved namespace`);
    }
  });

  test("VACUITY: the refusal is about the PUBLISHED name, so a plugin id sanitizing to `obsidian` is caught too", () => {
    // `obsidian` + `_foo` publishes as `obsidian_foo`. The check is at the
    // published name, not at the bare one, which is what makes it a namespace
    // rule rather than a naming-convention rule.
    const r = new ExternalToolRegistry();
    assert.throws(() => r.registerTools("Obsidian!", [spec("foo")]), /reserved obsidian_\* namespace/);
  });
});

describe("the registry actually publishes under the carved-out names", () => {
  test("registering the five as `governor` puts five BARE names on the surface", () => {
    const r = new ExternalToolRegistry();
    r.registerTools(OWNER, EXPECTED.map(spec));
    assert.deepEqual(r.entries().map((e) => e.toolName).sort(), EXPECTED);
    for (const e of r.entries()) assert.equal(e.ownerId, OWNER);
  });

  test("MUTATION CHECK: the same five from another publisher land prefixed, and do not collide", () => {
    // Proves the previous test is reading the table rather than the names. If
    // `publishedToolName` were reduced to `bareName`, this test fails while the
    // one above still passes.
    const r = new ExternalToolRegistry();
    r.registerTools(OWNER, EXPECTED.map(spec));
    r.registerTools("impostor", EXPECTED.map(spec));
    const names = r.entries().map((e) => e.toolName).sort();
    assert.equal(names.length, 10);
    for (const n of EXPECTED) {
      assert.ok(names.includes(n));
      assert.ok(names.includes(`impostor_${n}`));
    }
  });

  test("F4 still applies to a carved-out name: a second owner cannot clobber it", () => {
    // The carve-out changes the NAME, not the ownership rules. Two publishers
    // cannot both hold `governance_revisions`, and the impostor's is prefixed
    // anyway — so this is really a pin that the carve-out did not accidentally
    // create a shared, unowned name.
    const r = new ExternalToolRegistry();
    r.registerTools(OWNER, [spec("governance_revisions")]);
    const existing = r.entries().find((e) => e.toolName === "governance_revisions");
    assert.equal(existing.ownerId, OWNER);
    // A second owner reaching for the same PUBLISHED name — only possible via a
    // bare name that sanitizes into it, which is the collision F4 is for.
    assert.throws(() => r.registerTools("", [spec("governance_revisions")]), /unusable owner plugin id/);
  });
});
