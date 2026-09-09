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

describe("note.write@1 — the part of the contract @vault-mcp/core publishes", () => {
  // S3c PUBLISHED A TRIPLE, NOT THE WHOLE ACTION. `NOTE_WRITE_ACTION` in
  // `packages/core/src/action-contract.ts` carries exactly `{id, version,
  // changeClasses}` — the part two plugins must agree on byte-for-byte, because
  // the observer skips a write whose `operation.action` is not this id and
  // checks derived classes against these declared ones. The FULL action
  // definition (`native`, `modes`, `retention`, `observations`, `inputs`,
  // `scope.argumentKeys`) stayed with the host's registry
  // (`packages/host/src/kernel/operations/actions/note-write.ts`) and is not
  // importable from here.
  //
  // TWO ASSERTIONS WERE LOST TO THAT, and neither is covered on the host's side
  // — no host test names `NOTE_WRITE` at all as of 2026-09-08:
  //
  //   • the capture/retention contract (`defaultCapture: "ephemeral"`,
  //     `supportsProposal: false`, `retention.operation: "durable-for-mutation"`,
  //     `modes: ["proposal-mutation"]`, `native: true`);
  //   • **the one that matters here** — EXACTLY ONE PATH-SHAPED INPUT. The
  //     producer hardcodes `pathChanged: false`, which is only true because this
  //     action has one path and no destination. The day someone adds a
  //     `to`/`destination` input the literal silently becomes a lie and a move
  //     classifies as content-only. That was a red-test-instead pin
  //     (governor-lead's finding, the third literal-true-by-untested-contract in
  //     three days) and it now guards nothing. It belongs in the host's suite
  //     over its own action definition; it cannot be written here.
  //
  // What CAN be asserted here is the agreement itself, which is the reason the
  // triple was published in the first place.

  test("the published triple is what the producer speaks for: note.write, v1, content-classed", () => {
    assert.equal(NOTE_WRITE_V1.id, "note.write");
    assert.equal(NOTE_WRITE_V1.version, 1);
    assert.deepEqual([...NOTE_WRITE_V1.changeClasses], ["content"]);
  });

  test("the declaration is exactly what the firewall is asked to cover — no wider, no narrower", () => {
    // The failure the shared triple exists to prevent: if the host widened the
    // declared classes and this side's copy did not, coverage would be asserted
    // against a stale declaration. One definition means the question cannot
    // arise; this pins that the producer really is defined over it.
    requireClassesCovered(NOTE_WRITE_V1.changeClasses, ["content"]);
    assert.throws(() => requireClassesCovered(NOTE_WRITE_V1.changeClasses, ["content", "authority"]), ClassMismatchError);
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

// ── proposal production, driven straight at the producer ─────────────────────
//
// The seam hands the observer a `WriteFacts` object and ignores what comes back
// (condition 5: observers are dispatched off the caller's result path). So the
// honest local harness is a `WriteFacts` literal — not a fake executor pretending
// to be the host's. Everything the host decides upstream of this call (WHEN a
// write completed, whether the facts describe THIS operation's path, that the
// slot is taken once) is asserted on the host's side, or named as a gap in this
// file's header.

describe("proposal production — a completed write becomes a durable proposal", () => {
  function harness({ enabled = true, untracked = false, recordFails = false } = {}) {
    const store = createProposalStore(memoryIo());
    const recordings = [];
    const observe = createProposalObserver({
      historyEnabled: () => enabled,
      proposals: {
        open: (proposal, now) => store.open(proposal, now),
        uidOf: () => null,
        vaultId: "vault-1",
        record: async (proposalId, path, baseBytes, proposedBytes) => {
          if (recordFails) throw new Error("gitdir on fire");
          if (untracked) return null;
          recordings.push({ proposalId, path, baseBytes, proposedBytes });
          return `refs/governor/proposals/${proposalId}`;
        },
      },
      now: () => T0,
    });
    return { observe, store, recordings };
  }

  /** The exact shape the seam delivers — `WriteFacts` from `vault-mcp-api`. */
  const facts = (over = {}) => ({
    path: "A.md",
    baseBytes: enc("old"),
    proposedBytes: enc("new"),
    operation: { id: "op-1", action: NOTE_WRITE_V1.id, actionVersion: NOTE_WRITE_V1.version, sessionId: "sess-1" },
    actor: { transport: "mcp", connection: "c", client: null },
    ...over,
  });

  test("a completed write opens a proposal carrying the operation id and real digests", async () => {
    const { observe, store } = harness();
    await observe(facts());
    const pending = await store.pending();
    assert.equal(pending.length, 1);
    const p = pending[0];
    assert.equal(p.subject.producingOperation.id, "op-1", "the proposal names the REAL operation");
    assert.equal(p.subject.proposed.value, digestBytes(enc("new")).value);
    assert.equal(p.subject.base.value, digestBytes(enc("old")).value);
    assert.equal(p.sessionId, "sess-1");
    assert.equal(p.authority, "proposed");
    assert.match(p.recordingRef ?? "", /refs\/governor\/proposals\//, "the proposal carries its recording — admission evidence exists");
  });

  test("this producer speaks for ONE action — another action's write is silence, not an unstamped proposal", async () => {
    // The gate the dropped `buildMcpActionRegistry` test used to approach from
    // the other end. The producer keys on the ACTION id in the facts, so it does
    // not care which surface the host bound to it; a different action's write is
    // somebody else's contract.
    const { observe, store } = harness();
    await observe(facts({ operation: { id: "op-2", action: "note.move", actionVersion: 1, sessionId: "s" } }));
    assert.equal((await store.all()).length, 0);
  });

  test("no recording, no proposal — an untracked path is ungoverned, never a dead proposal", async () => {
    const { observe, store } = harness({ untracked: true });
    await observe(facts());
    assert.equal((await store.all()).length, 0);
  });

  test("a recording failure opens NO proposal — the failure surfaces, it does not half-land", async () => {
    // The provider-side half of "a propose failure never costs the caller their
    // write". The seam's dispatcher is what swallows this rejection off the
    // result path (host-side, covered there); what THIS package owes is that the
    // failure leaves no dead proposal behind, because `record` precedes `open`.
    const { observe, store } = harness({ recordFails: true });
    await assert.rejects(() => observe(facts()), /gitdir on fire/);
    assert.equal((await store.all()).length, 0);
  });

  test("an authority-touching diff refuses production — the write stands, the legacy queue governs it", async () => {
    // Removal of accepted keys passes the accept guard (it refuses introduce/
    // change, not removal) — the firewall catches what the guard permits.
    const { observe, store } = harness();
    await assert.rejects(
      () => observe(facts({ baseBytes: enc("---\naccepted-by: Nelson\n---\nbody"), proposedBytes: enc("---\n---\nbody") })),
      ClassMismatchError,
      "an authority-class diff cannot ride a content declaration",
    );
    assert.equal((await store.all()).length, 0);
  });

  test("the uid from the written bytes wins over the (lagging) cache path fallback", async () => {
    const { observe, store } = harness();
    await observe(facts({ path: "New.md", baseBytes: null, proposedBytes: enc("---\nuid: 0190-fresh\n---\nbody") }));
    const all = await store.all();
    assert.equal(all[0].subject.noteId, "0190-fresh", "a freshly-stamped uid is the identity from the first proposal");
  });

  test("disabled ⇒ no proposal, and nothing is even recorded", async () => {
    const { observe, store, recordings } = harness({ enabled: false });
    await observe(facts({ baseBytes: null, proposedBytes: enc("x") }));
    assert.equal((await store.pending()).length, 0);
    assert.equal(recordings.length, 0, "the human's history switch gates the recording too, not only the proposal");
  });

  test("a byte-identical rewrite proposes nothing — there is no change to govern", async () => {
    const { observe, store, recordings } = harness();
    await observe(facts({ baseBytes: enc("same"), proposedBytes: enc("same") }));
    assert.equal((await store.pending()).length, 0);
    assert.equal(recordings.length, 0);
  });

  test("a sessionless write still proposes, recorded honestly as `no-session`", async () => {
    const { observe, store } = harness();
    await observe(facts({ operation: { id: "op-3", action: NOTE_WRITE_V1.id, actionVersion: 1, sessionId: null } }));
    const [p] = await store.all();
    assert.equal(p.sessionId, "no-session", "never invented, never omitted");
  });
});

// ── the production wiring, pinned at the source ──────────────────────────────

describe("wiring pins — the mechanism-exists-but-unwired lesson, again", async () => {
  const fs = await import("node:fs");
  const read = (rel) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");

  // RETARGETED at S3c. The pins over `mcp/server.ts` and `mcp/obsidian-backend.ts`
  // are GONE: those files belong to the host package now, and a scan reaching
  // across the boundary would pin a claim this plugin does not own. They covered
  // the write-facts slot, its take-once discipline, the `reportCompletedWrite`
  // call, the negative "the transport no longer knows what a proposal is", and
  // the backend's read-base-bytes-before-modify ordering. **None of the five is
  // pinned in the host's suite today** — reported as a gap rather than dropped
  // quietly. The pins below are the halves this plugin genuinely owns.

  test("the observer holds the gate, the firewall, and the store", () => {
    const obs = read("wiring/write-observer.ts");
    assert.match(obs, /deps\.historyEnabled\(\) !== true/, "production is gated on the human's setting");
    assert.match(obs, /requireClassesCovered\(NOTE_WRITE_V1\.changeClasses, derived\)/, "the firewall runs in production");
    assert.match(obs, /deps\.proposals\.open\(/, "the proposal reaches the durable store");
    assert.match(obs, /touchesAuthorityKeys: authorityKeysDiffer\(/, "authority classification is derived from the bytes, never hardcoded");
    assert.match(obs, /frontmatterUid\(proposedText\)/, "identity comes from the written bytes before the lagging cache");
  });

  test("the observer records snapshots BEFORE opening the proposal — no dead proposals", () => {
    const obs = read("wiring/write-observer.ts");
    const recordAt = obs.indexOf("deps.proposals.record(");
    const openAt = obs.indexOf("deps.proposals.open({ ...proposal, recordingRef }");
    assert.ok(recordAt > 0 && openAt > 0 && recordAt < openAt, "record precedes open in the producer");
    assert.match(obs, /if \(recordingRef === null\) return;/, "an out-of-scope or failed recording skips the proposal");
  });

  test("main.ts registers the producer through the SEAM, and it is the real producer", () => {
    const main = read("main.ts");
    // The registration verb changed with the boundary: in-tree this was
    // `seam.registerWriteObserver(id, …)` called by the host's composition root;
    // it is now `registerGovernance(this, { writeObserver })` from the SDK,
    // called by this plugin's own onload.
    assert.match(main, /registerGovernance\(this, \{/, "the producer arrives through the SDK's seam registration");
    assert.match(main, /writeObserver: async \(facts\)/, "and it is wired as the write observer");
    assert.match(main, /this\.buildProposalObserver\(\{/, "over the real producer's builder");
    assert.match(main, /createProposalObserver\(\{/, "which is the real producer, not a stub");
    assert.ok(!main.includes("ctx.proposals"), "nothing reaches the producer through a host context object");
  });

  test("main.ts wires the history repository behind the effective scope", () => {
    const main = read("main.ts");
    assert.match(main, /effectiveScope\(this\.settings\.historyScope, EXCLUDED_PREFIXES\)/, "the composed scope gates recording — the WP4 contract consumed");
    assert.match(main, /openGitRepository\(/, "the real history store is the recording target");
    assert.match(main, /proposalRef\(proposalId\)/, "snapshots land on the proposal's own ref");
  });

  test("main.ts wires the proposal store and the uid lookup", () => {
    const main = read("main.ts");
    assert.match(main, /createProposalStore\(/);
    assert.match(main, /proposals\.jsonl/);
    assert.match(main, /uidOf: \(path: string\)/);
  });

  test("VACUITY: the scan reads real files, and a pin that should NOT match does not", () => {
    // Instrument discipline. A source scan over a file that failed to load reads
    // "" and passes nothing — but a scan over the WRONG file passes whatever it
    // happens to contain, which is how a retargeted pin goes quietly vacuous.
    assert.ok(read("wiring/write-observer.ts").length > 3000);
    assert.ok(read("main.ts").length > 5000);
    assert.ok(!read("main.ts").includes("reportCompletedWrite"), "the host's reporter is not in this plugin — the retarget was real");
    // The producer does not register ITSELF: `write-observer.ts` names the hook
    // in prose (its header explains where it plugs in) but never CALLS it —
    // composition is the composition root's job. Matched on the call form, not
    // the bare identifier, so a doc comment cannot fail the pin.
    assert.ok(!/\.registerWriteObserver\(/.test(read("wiring/write-observer.ts")), "the producer does not register itself");
  });
});
