/**
 * note-write-contract.test.mjs — THE TWO HOST FACTS THE PROVIDER'S PRODUCER
 * DEPENDS ON, pinned where they live (S3c).
 *
 * A coverage audit at the split found both of these asserted nowhere. Each was
 * previously load-bearing from inside the governance suite, which could reach
 * host machinery directly; neither survived the move on its own.
 *
 * ── 1. `NOTE_WRITE_V1`'s SHAPE, and the input pin in particular ──────────────
 *
 * `@vault-mcp/core` publishes only the identity triple — `{id, version,
 * changeClasses}` — because that is what two producers must AGREE about. The
 * rest of the action definition stayed host-side, and one part of it is a
 * premise the provider's proposal producer relies on without being able to
 * check: `createProposalObserver` derives change classes with a hardcoded
 * `pathChanged: false`, and that is only true because this action can name
 * EXACTLY ONE path and cannot move anything. A move is a different action.
 *
 * If a later edit gave `note.write` a second path-shaped input — a `to`, a
 * `from` — the producer would keep asserting `pathChanged: false` about a write
 * that changed a path, the class firewall would pass a structural change as
 * content, and the proposal would be internally consistent and wrong. Nothing
 * in either package catches that today. This does.
 *
 * ── 2. `openSession`'s MINTING CONTRACT ─────────────────────────────────────
 *
 * Condition 7 ruled that the host mints, so this is the host's contract. It was
 * asserted only in the provider's session suite, which now cannot import it;
 * `seam.test.mjs` calls `openSession` but only to build fixtures, and core ships
 * no session test. So the four properties that make a minted session safe —
 * a fresh id, a bounded life, NO mandate at open, and a continuation link that
 * inherits nothing — had no home. They have one now.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { NOTE_WRITE_V1 } from "../src/kernel/operations/actions/note-write.ts";
import { NOTE_WRITE_ACTION, SESSION_TTL_MS } from "@vault-mcp/core";
import { collectPaths } from "../src/guard.ts";
import { openSession } from "../src/kernel/sessions/session.ts";

describe("NOTE_WRITE_V1 — the premise the provider's producer cannot check", () => {
  /** Which of a declared input list the guard's own walker would treat as a
   *  path. Defined over the LIVE `collectPaths` rather than over a copied key
   *  list, so this reads the same set the allowlist, the record guard, the lock
   *  consult and the journal target all read. */
  const pathInputsOf = (inputs) => inputs.filter((i) => collectPaths({ [i]: "x.md" }).length > 0);

  test("EXACTLY ONE of its inputs is a path key — this is what makes `pathChanged: false` true", () => {
    assert.deepEqual(pathInputsOf(NOTE_WRITE_V1.inputs), ["path"]);
  });

  test("MUTATION CHECK: the scan reads the LIVE walker, so a second path input would be seen", () => {
    // Planted: the same filter over a list that names two. If it matched a
    // literal instead of consulting `collectPaths`, this would still return one
    // entry and the test above would be vacuous.
    assert.deepEqual(pathInputsOf(["path", "to", "content"]), ["path", "to"]);
    assert.deepEqual(pathInputsOf(["content", "overwrite"]), [], "and a pathless list reads as pathless");
  });

  test("it declares NO discovered effects — its blast radius IS its arguments", () => {
    // The other half of the same premise. `obsidian_repoint_link` is the
    // documented counter-example: a tool whose blast radius is not in its
    // arguments. If `note.write` ever became one, the write-facts slot would be
    // describing one file out of several.
    assert.equal(NOTE_WRITE_V1.effects.discovered, "none");
    assert.deepEqual(NOTE_WRITE_V1.effects.direct, ["note-content"]);
  });

  test("it is a NATIVE proposal-mutation, which is why the observer speaks for it at all", () => {
    assert.equal(NOTE_WRITE_V1.native, true);
    assert.deepEqual(NOTE_WRITE_V1.modes, ["proposal-mutation"]);
    assert.equal(NOTE_WRITE_V1.retention.operation, "durable-for-mutation");
  });

  test("the observation contract refuses to support a proposal — D16 keeps the two records separate", () => {
    // The action PRODUCES proposals through its mode; a proposal's evidence is
    // its own base/proposed digests, not an observation of the result envelope.
    // The registry refuses `supportsProposal` beside an ephemeral default, and
    // refused exactly this contract's first draft.
    assert.equal(NOTE_WRITE_V1.observations.defaultCapture, "ephemeral");
    assert.equal(NOTE_WRITE_V1.observations.supportsProposal, false);
  });

  test("it is DEFINED OVER the published identity, not a second copy of it", () => {
    // The whole point of publishing `NOTE_WRITE_ACTION` into core: one
    // declaration, two readers. A drifted copy would let the host bump the
    // version while the provider's observer quietly stopped matching and
    // proposed nothing, silently.
    assert.equal(NOTE_WRITE_V1.id, NOTE_WRITE_ACTION.id);
    assert.equal(NOTE_WRITE_V1.version, NOTE_WRITE_ACTION.version);
    assert.deepEqual(NOTE_WRITE_V1.changeClasses, [...NOTE_WRITE_ACTION.changeClasses]);
  });

  test("authority: not Governor-only, and NEVER automatically admitted", () => {
    assert.equal(NOTE_WRITE_V1.authority.governorOnly, false);
    assert.equal(NOTE_WRITE_V1.authority.automaticAdmission, "never");
  });
});

describe("openSession — the host's minting contract (condition 7)", () => {
  const T0 = 1_700_000_000_000;
  const input = () => ({
    vaultId: "vault", replicaId: "install-1",
    actor: { connection: "conn-1", clientClaim: "claude-code/1.0.0" },
    journalHead: "2026-09-08T00:00:00Z#3",
    scopeDigest: "sha256:abc",
  });

  test("a fresh session is OPEN, bounded, and carries the connection's facts", () => {
    const s = openSession(input(), T0);
    assert.equal(s.schema, "governor.session/v1");
    assert.equal(s.status, "open");
    assert.equal(s.openedAt, T0);
    assert.equal(s.expiresAt, T0 + SESSION_TTL_MS);
    assert.equal(s.vaultId, "vault");
    assert.equal(s.replicaId, "install-1");
    assert.deepEqual(s.actor, { connection: "conn-1", clientClaim: "claude-code/1.0.0" });
    assert.deepEqual(s.baseState, { journalHead: "2026-09-08T00:00:00Z#3" });
    assert.equal(s.scopeDigest, "sha256:abc");
  });

  test("NO MANDATE at open — authority is never minted with a session", () => {
    // The single most important property here. A session that arrived carrying
    // a mandate would mean opening a connection granted delegation, which is
    // the exact inversion the whole design refuses: activation is a human
    // gesture in the provider's pane and has no tool.
    assert.equal(openSession(input(), T0).mandateId, null);
  });

  test("a CONTINUATION link inherits nothing — it is recorded and nothing is read from it", () => {
    const first = openSession(input(), T0);
    const second = openSession({ ...input(), continuedFrom: first.id, relatedSessions: [first.id] }, T0 + 1000);
    assert.equal(second.continuedFrom, first.id);
    assert.deepEqual(second.relatedSessions, [first.id]);
    assert.equal(second.mandateId, null, "no mandate travels through a link");
    assert.notEqual(second.id, first.id);
    assert.equal(second.expiresAt, T0 + 1000 + SESSION_TTL_MS, "the life is the new opening's, not the old one's");
  });

  test("ids are fresh per mint, and time-ordered (uuidv7)", () => {
    const a = openSession(input(), T0);
    const b = openSession(input(), T0 + 1);
    assert.notEqual(a.id, b.id);
    assert.ok(a.id < b.id, "uuidv7 sorts by mint time, which is what makes a session log readable");
  });

  test("a non-positive ttl is REFUSED rather than minting an already-dead session", () => {
    assert.throws(() => openSession({ ...input(), ttlMs: 0 }, T0), /ttl must be positive/);
    assert.throws(() => openSession({ ...input(), ttlMs: -1 }, T0), /ttl must be positive/);
  });

  test("`relatedSessions` is COPIED, so a caller's array cannot mutate the record afterwards", () => {
    const related = ["s-other"];
    const s = openSession({ ...input(), relatedSessions: related }, T0);
    related.push("s-injected");
    assert.deepEqual(s.relatedSessions, ["s-other"]);
  });
});
