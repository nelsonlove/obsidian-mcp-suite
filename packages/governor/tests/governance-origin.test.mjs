/**
 * governance-origin.test.mjs — WP5, origin classification (D12).
 *
 * D12's shape: four origins, fixed confidence, no false cryptographic claims.
 * The two properties that matter most here are RETENTION and HONESTY —
 * retention, because the existing human-vs-agent classifier's behavior is
 * adopted by name in the decision (trusted editor input advances silently;
 * ambiguity never does) and must survive this change byte-for-byte; honesty,
 * because sync attribution must be UNREACHABLE until a real reconciliation
 * producer exists — "the file changed while Obsidian was closed" is
 * indistinguishable from any external writer.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { classifyOrigin, classifyChange, shouldAdvanceBaselineSilently } from "../src/kernel/origins/classifier.ts";
import { reconcileDisposition } from "../src/kernel/origins/reconcile.ts";
import { classifyModify } from "../src/kernel/classify.ts";
import { ORIGIN_CONFIDENCE } from "../src/kernel/contracts/origin.ts";

const sig = (over = {}) => ({ recentAgentWrite: false, recentGenuineHumanInput: false, syncEvidence: false, ...over });

// ── the four origins ─────────────────────────────────────────────────────────

describe("origin classifier — evidence strength, falling downward", () => {
  test("a journal-matched governor write is governor-originated (bound)", () => {
    const o = classifyOrigin(sig({ recentAgentWrite: true }));
    assert.equal(o.origin, "governor-originated");
    assert.equal(o.confidence, "bound");
  });

  test("trusted editor input is local-human-observed (observed, not proven)", () => {
    const o = classifyOrigin(sig({ recentGenuineHumanInput: true }));
    assert.equal(o.origin, "local-human-observed");
    assert.equal(o.confidence, "observed");
  });

  test("a governor write outranks a trusted keystroke in the same window", () => {
    // The write is BOUND; the keystroke may be the human reacting to it.
    const o = classifyOrigin(sig({ recentAgentWrite: true, recentGenuineHumanInput: true }));
    assert.equal(o.origin, "governor-originated");
  });

  test("nothing attributable is external-unattributed — the honest floor", () => {
    const o = classifyOrigin(sig());
    assert.equal(o.origin, "external-unattributed");
    assert.equal(o.confidence, "indeterminate");
  });

  test("sync attribution requires actual reconciliation evidence", () => {
    assert.equal(classifyOrigin(sig({ syncEvidence: true })).origin, "sync-attributed");
    // and WITHOUT the flag it can never be reached — pinned by the floor test
    // above. No producer sets the flag until WP12; grep proves it:
  });

  test("no production code emits syncEvidence yet — claiming it would be a false attribution", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const url = await import("node:url");
    const HERE = path.dirname(url.fileURLToPath(import.meta.url));
    const srcDir = path.join(HERE, "..", "src");
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith(".ts") && !p.includes("origins")) {
          const text = fs.readFileSync(p, "utf8");
          if (/syncEvidence:\s*true/.test(text)) offenders.push(p);
        }
      }
    };
    walk(srcDir);
    assert.deepEqual(offenders, [], "a producer of syncEvidence:true appeared before WP12's reconciliation machinery");
  });
});

// ── retention of the adopted behavior ────────────────────────────────────────

describe("origin classifier — the adopted modify classifier survives verbatim", () => {
  test("classifyChange agrees with classifyModify on every input combination — ALL THREE signals swept", () => {
    // The first version of this test swept agent × human and left syncEvidence
    // at its default — so its name claimed more than its loop checked, and a
    // mutation routing sync evidence to "human" (sync forcing a silent
    // baseline advance) survived the suite. Found by governor-lead's slice
    // review via exactly that mutation. All eight combinations now, with the
    // explicit independence assertion: the modify class must not vary with
    // syncEvidence at all — better sync evidence may one day move a case into
    // review, never into silent advancement.
    for (const agent of [true, false]) {
      for (const human of [true, false]) {
        const expected = classifyModify({ recentAgentWrite: agent, recentGenuineHumanInput: human });
        for (const sync of [true, false]) {
          const { modifyClass } = classifyChange(sig({ recentAgentWrite: agent, recentGenuineHumanInput: human, syncEvidence: sync }));
          assert.equal(modifyClass, expected, `agent=${agent} human=${human} sync=${sync}`);
        }
      }
    }
  });

  test("only a confident human classification advances silently — unchanged", () => {
    assert.ok(shouldAdvanceBaselineSilently("human"));
    assert.ok(!shouldAdvanceBaselineSilently("agent"));
    assert.ok(!shouldAdvanceBaselineSilently("ambiguous"));
  });

  test("one evaluation, two consumers: the origin and the modify class cannot disagree", () => {
    const { modifyClass, origin } = classifyChange(sig({ recentGenuineHumanInput: true }));
    assert.equal(modifyClass, "human");
    assert.equal(origin.origin, "local-human-observed");
  });
});

// ── reconciliation dispositions ──────────────────────────────────────────────

describe("reconcile — what an origin means for standing", () => {
  test("the human's own typing advances silently, touches nothing else", () => {
    const d = reconcileDisposition({ origin: "local-human-observed", hadAdmittedStanding: true });
    assert.deepEqual(d, { advanceSilently: true, routeForReview: false, markStandingStale: false });
  });

  test("a governor change is never its own acceptance — routed for review", () => {
    const d = reconcileDisposition({ origin: "governor-originated", hadAdmittedStanding: false });
    assert.deepEqual(d, { advanceSilently: false, routeForReview: true, markStandingStale: false });
  });

  test("sync and external changes over ADMITTED standing mark it stale — never revoked", () => {
    for (const origin of ["sync-attributed", "external-unattributed"]) {
      const d = reconcileDisposition({ origin, hadAdmittedStanding: true });
      assert.equal(d.markStandingStale, true, origin);
      assert.equal(d.advanceSilently, false, origin);
      assert.equal(d.routeForReview, true, origin);
    }
  });

  test("the same changes over ungoverned notes just route for review", () => {
    const d = reconcileDisposition({ origin: "external-unattributed", hadAdmittedStanding: false });
    assert.deepEqual(d, { advanceSilently: false, routeForReview: true, markStandingStale: false });
  });

  test("ambiguity never silently advances — the D12 fail-safe, end to end", () => {
    // An ambiguous modify is external-unattributed; its disposition must
    // never be silent advancement, whatever the standing.
    for (const hadStanding of [true, false]) {
      const { origin } = classifyChange(sig());
      const d = reconcileDisposition({ origin: origin.origin, hadAdmittedStanding: hadStanding });
      assert.equal(d.advanceSilently, false);
    }
  });
});

// ── production wiring: the origin is actually produced and persisted ─────────

describe("origin wiring — produced in the modify listener, persisted on the advance record", async () => {
  const fs = await import("node:fs");

  test("wiring.ts evaluates classifyChange (one evaluation), with syncEvidence hard false", () => {
    const wiring = fs.readFileSync(new URL("../src/wiring/wiring.ts", import.meta.url), "utf8");
    assert.match(wiring, /classifyChange\(/, "the modify listener produces the origin record");
    assert.match(wiring, /syncEvidence: false/, "no local signal may claim sync attribution");
    assert.ok(!/classifyModify\(/.test(wiring), "the listener no longer calls the bare modify classifier — one evaluation, two consumers");
  });

  test("the silent-advance audit record carries the origin", async () => {
    const { silentAdvanceRecord } = await import("../src/kernel/accept.ts");
    const rec = silentAdvanceRecord({
      ts: "2026-08-21T00:00:00Z",
      path: "A.md",
      reason: "human-edit",
      fromHash: null,
      toHash: "abc",
      origin: { origin: "local-human-observed", confidence: "observed" },
    });
    assert.deepEqual(rec.origin, { origin: "local-human-observed", confidence: "observed" });
    // and without one, the field is absent — pre-WP5 log lines stay valid
    assert.ok(!("origin" in silentAdvanceRecord({ ts: "t", path: "p", reason: "human-edit", fromHash: null, toHash: "x" })));
  });
});

// ── TWO BLOCKS LEFT THIS FILE AT THE HOST/PROVIDER SPLIT (S3c) ───────────────
//
// `capture policy — having a session is not being governed` and `reserved
// identity inputs — refused at the executor (WP5)` were asserted here because
// this file lived in the host's tree and could import host machinery directly.
// Both are facts about HOST code — `kernel/observations/capture-policy.ts` and
// `kernel/operations/executor.ts` — and a fact about the host asserted only in
// the provider's package is a fact nobody checks when the host changes. They
// moved to `packages/host/tests/session-posture.test.mjs`, verbatim.
//
// They belonged here for a reason that survives the move, and it is worth
// carrying: both are about what a SESSION does NOT buy. A connection now opens
// one every time, and the first careless promotion — capture level, or an
// identity field claimed through arguments — is what would turn "a session
// exists" into "a session confers something". The provider is what would
// benefit from that confusion, which is why the tests read as governance tests;
// they are host tests all the same.
