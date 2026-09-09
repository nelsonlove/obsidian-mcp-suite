/**
 * governance-native-write.test.mjs — WP6b-1: the first native mutation and its
 * proposal production, as the PROVIDER still owns it after S3c.
 *
 * The vertical slice's write half: the class firewall proving the content claim
 * against the actual diff (classification rule 5 — never solely from the
 * declaration), the `content-diff@1` predicate proving the subject describes the
 * actual bytes, and the observer turning a completed write into a durable
 * proposal.
 *
 * ── WHAT THE SPLIT TOOK, AND WHERE IT WENT ──────────────────────────────────
 *
 * The seam has TWO sides and this file used to drive both, because both lived in
 * one tree: the host's operation executor, its write-facts slot with the
 * take-once discipline and the attribution guard, `createGovernanceSeam` and
 * `reportCompletedWrite`; and the provider's `createProposalObserver`. Only the
 * second is in this package now, so only the second is driven here. What is NOT
 * reproduced, deliberately:
 *
 *   • THE ATTRIBUTION GUARD (facts whose path does not match the operation's
 *     sources are dropped) — host `reportCompletedWrite`. COVERED host-side:
 *     `packages/host/tests/seam.test.mjs`, "MIS-ATTRIBUTED facts are dropped — a
 *     proposal about a write that did not happen is worse than none".
 *   • OFF-THE-RESULT-PATH DISPATCH (a hanging, throwing or rejecting observer
 *     costs the caller nothing). COVERED host-side: the same file's four
 *     observer-dispatch cases.
 *   • THE TAKE-ONCE SLOT (a following read cannot inherit a write's facts) —
 *     host `main.ts`'s `writeFacts` closure. **NOT COVERED ANYWHERE as of
 *     2026-09-08**: `seam.test.mjs` drives `reportCompletedWrite` as a pure
 *     function and never the slot that calls it. Named as a gap.
 *   • A PROPOSE HOOK THAT THROWS never costing the caller their result —
 *     `createOperationExecutor`, host code. **ALSO NOT COVERED**: no host test
 *     passes `propose` into the executor at all. Named as a gap. What this
 *     package CAN still say about the same risk is asserted below, one layer in:
 *     a recording failure inside the observer skips the proposal rather than
 *     opening a dead one, and an unfit diff produces nothing.
 *   • THE MCP BINDING (`obsidian_write_note` → `note.write@1` through
 *     `buildMcpActionRegistry`) — the host's per-connection action registry.
 *     Dropped; which SURFACE maps to the action is the host's inventory
 *     question, and the producer below gates on the action id, not the surface.
 *
 * A mirror of the host's half here would be worse than a named gap: the value of
 * the old round trip was that it drove the REAL executor, and a local
 * re-implementation would stay green while the real one drifted.
 *
 * ── WHAT STAYS ───────────────────────────────────────────────────────────────
 *
 * `note.write@1`'s contract (now `NOTE_WRITE_ACTION`, published from
 * `@vault-mcp/core` so both halves read one definition), the class firewall, the
 * authority-key and uid helpers, `content-diff@1` through the real predicate
 * registry, and the producer itself — driven directly, with a `WriteFacts`
 * object, which is exactly what the seam hands it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { NOTE_WRITE_ACTION as NOTE_WRITE_V1, digestBytes } from "@vault-mcp/core";
import { deriveClasses, requireClassesCovered, ClassMismatchError, authorityKeysDiffer, frontmatterUid } from "../src/kernel/proposals/class-firewall.ts";
import { createDefaultPredicateRegistry } from "../src/kernel/verification/predicates.ts";
import { buildProposalSubjectFromOperation } from "../src/kernel/proposals/proposal-builder.ts";
import { createProposalStore } from "../src/kernel/proposals/proposal-store.ts";
import { verifySubject } from "../src/kernel/verification/verify.ts";
import { createProposalObserver } from "../src/wiring/write-observer.ts";

const enc = (s) => new TextEncoder().encode(s);
const T0 = 1_700_000_000_000;

function memoryIo() {
  const lines = [];
  return { lines, appendLine: async (l) => void lines.push(l), readLines: async () => [...lines] };
}

// ── the action contract ──────────────────────────────────────────────────────

describe("note.write@1 — the contract, now read from @vault-mcp/core", () => {
  test("native, content-classed, proposal-mutation mode, durable operation record", () => {
    assert.equal(NOTE_WRITE_V1.native, true);
    assert.deepEqual(NOTE_WRITE_V1.changeClasses, ["content"]);
    assert.deepEqual(NOTE_WRITE_V1.modes, ["proposal-mutation"]);
    assert.equal(NOTE_WRITE_V1.retention.operation, "durable-for-mutation");
  });

  test("its observation contract claims nothing — a result envelope supports no proposal", () => {
    assert.equal(NOTE_WRITE_V1.observations.defaultCapture, "ephemeral");
    assert.equal(NOTE_WRITE_V1.observations.supportsProposal, false);
  });

  test("exactly one path-shaped input — the contract that makes pathChanged:false TRUE", () => {
    // The producer hardcodes pathChanged: false, which is correct because this
    // action has ONE path and no destination. Nothing pinned that contract
    // (governor-lead's finding — third literal-true-by-untested-contract in
    // three days): the day someone adds a `to`/`destination` input, the literal
    // silently becomes a lie and a move classifies as content-only. This makes
    // that day a red test instead.
    //
    // The action moved to core at the split; the pin followed it, because the
    // consumer that would be lied to — `createProposalObserver` — is here.
    const pathShaped = NOTE_WRITE_V1.inputs.filter((k) => /path|^to$|dest|target|from/i.test(k));
    assert.deepEqual(pathShaped, ["path"], "one path-shaped input; a destination means a NEW action, not a wider write");
    assert.deepEqual(NOTE_WRITE_V1.scope.argumentKeys, ["path"]);
  });
});

// ── the class firewall ───────────────────────────────────────────────────────

describe("class firewall — derived from the diff, never solely from the declaration", () => {
  test("a byte change derives content; identical bytes derive nothing", () => {
    assert.deepEqual(deriveClasses({ baseBytes: enc("a"), proposedBytes: enc("b"), pathChanged: false, touchesAuthorityKeys: false }), ["content"]);
    assert.deepEqual(deriveClasses({ baseBytes: enc("same"), proposedBytes: enc("same"), pathChanged: false, touchesAuthorityKeys: false }), []);
    assert.deepEqual(deriveClasses({ baseBytes: null, proposedBytes: enc("new"), pathChanged: false, touchesAuthorityKeys: false }), ["content"], "a creation is a content change");
  });

  test("path and authority facts derive their classes, in canonical order", () => {
    const derived = deriveClasses({ baseBytes: enc("a"), proposedBytes: enc("b"), pathChanged: true, touchesAuthorityKeys: true });
    assert.deepEqual(derived, ["structural", "content", "authority"]);
  });

  test("NARROWING refuses — the attack is a substantive edit riding a mechanical claim", () => {
    // A formatter declaring presentation over a diff that changes content.
    assert.throws(
      () => requireClassesCovered(["presentation"], ["content"]),
      (e) => e instanceof ClassMismatchError && e.code === "class_mismatch"
    );
    // Structural smuggled under a content-only declaration.
    assert.throws(() => requireClassesCovered(["content"], ["content", "structural"]), ClassMismatchError);
  });

  test("WIDENING passes — a declaration above the derivation buys a stricter path", () => {
    requireClassesCovered(["content"], []); // byte-identical rewrite under a content declaration
    requireClassesCovered(["content", "structural"], ["content"]);
  });
});

// ── the authority-diff and uid helpers ───────────────────────────────────────

describe("authorityKeysDiffer — what the accept guard permits, the firewall still classifies", () => {
  test("REMOVING an accepted key differs — the guard permits removal; standing still changed", () => {
    assert.ok(authorityKeysDiffer("---\naccepted-by: Nelson\n---\nbody", "---\n---\nbody"));
  });

  test("an acceptance-status downgrade differs — deliberately guard-allowed, still authority-class", () => {
    assert.ok(authorityKeysDiffer("---\nacceptance-status: accepted\n---\nx", "---\nacceptance-status: proposed\n---\nx"));
  });

  test("byte-identical preservation does not differ", () => {
    const t = "---\naccepted-by: Nelson\naccepted-on: 2026-01-01\n---\nbody";
    assert.ok(!authorityKeysDiffer(t, t.replace("body", "new body")));
  });

  test("ordinary frontmatter changes do not differ; creation with no authority keys does not differ", () => {
    assert.ok(!authorityKeysDiffer("---\ntitle: a\n---\nx", "---\ntitle: b\n---\nx"));
    assert.ok(!authorityKeysDiffer(null, "---\ntitle: new\n---\nx"));
  });

  test("INTRODUCING an accepted key on a creation differs — belt behind the guard's refusal", () => {
    assert.ok(authorityKeysDiffer(null, "---\naccepted-by: someone\n---\nx"));
  });

  test("case and separator variants are the same key — core's one recognizer", () => {
    assert.ok(authorityKeysDiffer("---\nAccepted_By: Nelson\n---\nx", "---\n---\nx"));
  });
});

describe("frontmatterUid — identity from the exact written bytes", () => {
  test("reads the uid, unquotes it, and answers null honestly", () => {
    assert.equal(frontmatterUid("---\nuid: 0190-abc\n---\nbody"), "0190-abc");
    assert.equal(frontmatterUid('---\nuid: "0190-q"\n---\nx'), "0190-q");
    assert.equal(frontmatterUid("---\ntitle: no uid here\n---\nx"), null);
    assert.equal(frontmatterUid("no frontmatter at all"), null);
    assert.equal(frontmatterUid("---\nuid:\n---\nx"), null, "an empty uid is no uid");
  });
});

// ── the first real predicate ─────────────────────────────────────────────────

describe("content-diff@1 — the subject describes the actual bytes", () => {
  const base = enc("base text\n");
  const proposed = enc("proposed text\n");

  function subjectFor(baseBytes, proposedBytes) {
    return buildProposalSubjectFromOperation({
      vaultId: "v",
      noteId: "n",
      path: "A.md",
      pathSemanticallyRelevant: false,
      base: baseBytes === null ? null : digestBytes(baseBytes),
      proposed: digestBytes(proposedBytes),
      changeClasses: ["content"],
      transformation: { id: "note.write", version: "1" },
      predicates: [{ id: "content-diff", version: "1" }],
      producingOperation: { id: "op", action: "note.write", actionVersion: 1 },
      observations: [],
      sessionId: "s",
      mandateId: null,
    });
  }

  test("matching digests pass, through the real registry and verifySubject", async () => {
    const registry = createDefaultPredicateRegistry();
    const outcome = await verifySubject(registry, subjectFor(base, proposed), { baseBytes: base, proposedBytes: proposed }, T0);
    assert.ok(outcome.passed, outcome.records[0]?.detail);
  });

  test("a drifted proposed digest fails with the specific mismatch", async () => {
    const registry = createDefaultPredicateRegistry();
    const outcome = await verifySubject(registry, subjectFor(base, proposed), { baseBytes: base, proposedBytes: enc("EDITED SINCE") }, T0);
    assert.ok(!outcome.passed);
    assert.match(outcome.records[0].detail, /proposed bytes digest to/);
  });

  test("creation semantics: base null must mean NO base bytes, both directions", async () => {
    const registry = createDefaultPredicateRegistry();
    const creation = subjectFor(null, proposed);
    assert.ok((await verifySubject(registry, creation, { baseBytes: null, proposedBytes: proposed }, T0)).passed);
    assert.ok(!(await verifySubject(registry, creation, { baseBytes: base, proposedBytes: proposed }, T0)).passed, "claiming creation over an existing note fails");
    assert.ok(!(await verifySubject(registry, subjectFor(base, proposed), { baseBytes: null, proposedBytes: proposed }, T0)).passed, "claiming a base with no base bytes fails");
  });
});

