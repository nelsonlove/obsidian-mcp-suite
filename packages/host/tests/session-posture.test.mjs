/**
 * session-posture.test.mjs — WHAT A SESSION DOES NOT BUY (moved here at S3c).
 *
 * Both blocks below lived in the governance suite's `governance-origin.test.mjs`
 * until the host/provider split, because that file was in the host's tree and
 * could import host machinery directly. It cannot now, and a fact about the host
 * asserted only in the provider's package is a fact nobody checks when the host
 * changes — so they moved, verbatim.
 *
 * They read as governance tests and they are host tests, and the reason is the
 * same for both: a connection opens a session EVERY time, so the first careless
 * promotion is what would turn "a session exists" into "a session confers
 * something".
 *
 *   • CAPTURE POLICY — a bare session id must not promote an evidence-default
 *     action to replayable. Governed means a proposing or mandated posture
 *     (WP6/WP9), never the mere presence of a connection.
 *   • RESERVED IDENTITY INPUTS — an actor, signer, standing ref or acceptedBy
 *     claimed through call ARGUMENTS is refused at the executor, with a stable
 *     code. Identity is derived, never asserted by the caller.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ── a session is not a governed posture ──────────────────────────────────────

describe("capture policy — having a session is not being governed", async () => {
  test("a bare session id does NOT promote an evidence-default action to replayable", async () => {
    // Every connection opens a session now (WP5). If that alone counted as
    // "governed", the first future evidence-default native action would
    // silently jump to full-payload retention on the strength of nothing but
    // a connection. Governed means a proposing or mandated posture (WP6/WP9).
    const { decideCapture } = await import("../src/kernel/observations/capture-policy.ts");
    const evidenceAction = {
      id: "x.read", version: 1,
      observations: { defaultCapture: "evidence", supportsProposal: false },
    };
    const withSession = decideCapture({ action: evidenceAction, session: { id: "s-1", governed: false }, substantive: true });
    assert.equal(withSession.level, "evidence", "session presence alone must not promote");
    const governed = decideCapture({ action: evidenceAction, session: { id: "s-1", governed: true }, substantive: true });
    assert.equal(governed.level, "replayable", "a genuinely governed session still promotes");
  });

  test("capture.ts passes governed: false until postures exist — pinned at the source", async () => {
    const fs = await import("node:fs");
    const capture = fs.readFileSync(new URL("../src/kernel/observations/capture.ts", import.meta.url), "utf8");
    assert.match(capture, /governed: false/, "a connection's session must not claim a governed posture");
    assert.ok(!/governed: true/.test(capture));
  });
});

// ── executor: identity is never claimed through arguments ────────────────────

describe("reserved identity inputs — refused at the executor (WP5)", () => {
  test("a call whose arguments claim an identity field is refused with the stable code", async () => {
    const { createActionRegistry } = await import("../src/kernel/operations/registry.ts");
    const { createOperationExecutor, ReservedIdentityInputError } = await import("../src/kernel/operations/executor.ts");
    const { compatibilityAction } = await import("../src/kernel/operations/compatibility.ts");

    const r = createActionRegistry();
    r.register(compatibilityAction({ surface: "obsidian_doctor", postcondition: "x", owner: "core", distribution: "public-default", readOnly: true }));
    r.bind({ kind: "mcp", id: "obsidian_doctor", action: "compat.obsidian_doctor", actionVersion: 1 });
    r.validate();
    const executor = createOperationExecutor({ registry: r, actor: () => ({ binding: "c", clientClaim: null }) });

    for (const key of ["actor", "signer", "standing_ref", "acceptedBy"]) {
      await assert.rejects(
        () => executor.run({ surface: { id: "obsidian_doctor" }, inputs: { [key]: "claimed" } }, async () => "never"),
        (e) => e instanceof ReservedIdentityInputError && e.code === "reserved_identity_input",
        `should refuse '${key}'`
      );
    }
  });

  test("ordinary arguments are untouched by the check", async () => {
    const { createActionRegistry } = await import("../src/kernel/operations/registry.ts");
    const { createOperationExecutor } = await import("../src/kernel/operations/executor.ts");
    const { compatibilityAction } = await import("../src/kernel/operations/compatibility.ts");
    const r = createActionRegistry();
    r.register(compatibilityAction({ surface: "obsidian_doctor", postcondition: "x", owner: "core", distribution: "public-default", readOnly: true }));
    r.bind({ kind: "mcp", id: "obsidian_doctor", action: "compat.obsidian_doctor", actionVersion: 1 });
    r.validate();
    const executor = createOperationExecutor({ registry: r, actor: () => ({ binding: "c", clientClaim: null }) });
    const { result } = await executor.run({ surface: { id: "obsidian_doctor" }, inputs: { path: "A.md" } }, async () => "ok");
    assert.equal(result, "ok");
  });
});
