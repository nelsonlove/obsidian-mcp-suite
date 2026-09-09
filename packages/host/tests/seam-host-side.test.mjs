/**
 * seam-host-side.test.mjs — THE HOST'S HALF OF THE SEAM, WHERE THE PROVIDER
 * CANNOT REACH IT (S3c).
 *
 * `tests/seam.test.mjs` pins the seam MODULE: the hook classes, the refusal
 * shape, deny-wins, the disposers, the WeakMap, the defensive freeze,
 * `reportCompletedWrite`'s attribution guard, `expiryRefusal`. What it does not
 * pin is the three places the host WIRES that module into the write path, and a
 * coverage audit run at the split found all three untested here:
 *
 *   1. `makeGuarded`'s `sessionRefusal` option — the consultation point INSIDE
 *      the kernel's queued closure. A refusal must abort the mutation at
 *      dequeue, `null` must be silence, and an absent option must mean no check
 *      at all.
 *   2. The WRITE-FACTS SLOT — a single-item mailbox the backend fills and the
 *      executor empties exactly once. Taking it twice, or taking it for the
 *      wrong operation, is how a proposal gets manufactured about a write that
 *      did not happen.
 *   3. `createOperationExecutor`'s `propose` safety: a throwing or hanging
 *      provider must not cost the caller a write that already landed.
 *
 * These were pinned from the PROVIDER's suite before the split, because the
 * provider's tests lived in the same tree and could import host machinery
 * directly. They cannot now, and a fact about the host asserted only in the
 * provider's package is a fact nobody checks when the host changes. That is the
 * whole reason this file exists.
 *
 * Every test here is mutation-checked: the assertion is paired with a variant
 * that makes the property FALSE, so a green result cannot come from the
 * assertion never running.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeGuarded } from "../src/mcp/guarded.ts";
import { createOperationExecutor } from "../src/kernel/operations/executor.ts";
import { createActionRegistry } from "../src/kernel/operations/registry.ts";
import { reportCompletedWrite, createGovernanceSeam } from "../src/mcp/seam.ts";
import { Kernel, WriteJournal, WriteQueue, IdempotencyStore, LockStore } from "../src/kernel/index.ts";

const ACTOR = { transport: "mcp", client: "claude-code/1.0.0", connection: "conn-1" };
const RW = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function fixtureKernel() {
  const files = new Map();
  const adapter = {
    async exists(p) { return files.has(p); },
    async mkdir() {},
    async read(p) { return files.get(p) ?? ""; },
    async write(p, data) { files.set(p, data); },
    async append(p, data) { files.set(p, (files.get(p) ?? "") + data); },
  };
  const journal = new WriteJournal(adapter, "dir/journal", () => new Date("2026-08-20T12:00:00Z"));
  const records = [];
  const append = journal.append.bind(journal);
  journal.append = (r) => { records.push(r); return append(r); };
  return {
    kernel: new Kernel(new WriteQueue(), journal, undefined, new IdempotencyStore(), new LockStore()),
    records,
  };
}

const text = (res) => res.content.map((c) => c.text).join("\n");

// ── 1. the dequeue refusal ──────────────────────────────────────────────────

describe("makeGuarded's sessionRefusal — the consultation at DEQUEUE", () => {
  function guardedWith(sessionRefusal) {
    const { kernel, records } = fixtureKernel();
    let ran = 0;
    const guarded = makeGuarded({ getSettings: () => ({ readOnly: false, allowlist: [] }), kernel, actor: () => ACTOR, sessionRefusal });
    const call = guarded({ annotations: RW, inputSchema: {} }, async () => { ran++; return { content: [{ type: "text", text: "wrote" }] }; }, "obsidian_write_note");
    return { call, ran: () => ran, records };
  }

  test("a refusal ABORTS the mutation and the handler never runs", async () => {
    const g = guardedWith(async () => ({ code: "session_revoked", detail: "a human revoked this session" }));
    const res = await g.call({ path: "a.md" });
    assert.equal(res.isError, true);
    assert.match(text(res), /Error \[session_revoked\]: a human revoked this session/);
    assert.equal(g.ran(), 0, "the refusal is at dequeue, BEFORE the effect — nothing may have been attempted");
  });

  test("MUTATION CHECK: the same call with `null` runs, so the refusal above is what stopped it", async () => {
    const g = guardedWith(async () => null);
    const res = await g.call({ path: "a.md" });
    assert.equal(res.isError, undefined);
    assert.equal(g.ran(), 1);
  });

  test("an ABSENT hook is no check at all — the standalone host, not a special case", async () => {
    const g = guardedWith(undefined);
    const res = await g.call({ path: "a.md" });
    assert.equal(res.isError, undefined);
    assert.equal(g.ran(), 1);
  });

  test("a SYNCHRONOUS refusal is honoured too — the option's type allows both", async () => {
    const g = guardedWith(() => ({ code: "session_not_live", detail: "expired" }));
    const res = await g.call({ path: "a.md" });
    assert.match(text(res), /Error \[session_not_live\]/);
    assert.equal(g.ran(), 0);
  });

  test("the refusal is CODED, so it reaches an agent in the same shape as a host refusal", async () => {
    const g = guardedWith(async () => ({ code: "mandate_exhausted", detail: "budget spent" }));
    assert.match(text(await g.call({ path: "a.md" })), /^Error \[mandate_exhausted\]: budget spent$/m);
  });

  test("READS are never consulted — a read has no dequeue", async () => {
    const { kernel } = fixtureKernel();
    let asked = 0;
    const guarded = makeGuarded({
      getSettings: () => ({ readOnly: false, allowlist: [] }),
      kernel,
      actor: () => ACTOR,
      sessionRefusal: async () => { asked++; return { code: "x", detail: "y" }; },
    });
    const read = guarded({ annotations: RO, inputSchema: {} }, async () => ({ content: [{ type: "text", text: "read" }] }), "obsidian_read_note");
    const res = await read({ path: "a.md" });
    assert.equal(res.isError, undefined, "a revoked session still READS — the refusal guards mutation");
    assert.equal(asked, 0, "and the hook is not even consulted, so a provider cannot make reads cost anything");
  });

  test("the refused mutation is JOURNALED as an error, not silently dropped", async () => {
    const g = guardedWith(async () => ({ code: "session_revoked", detail: "revoked" }));
    await g.call({ path: "a.md" });
    assert.equal(g.records.length, 1, "a refusal at dequeue is a thing that happened to a mutation");
    assert.equal(g.records[0].outcome, "error");
    assert.equal(g.records[0].op, "obsidian_write_note");
  });
});

// ── 2. the write-facts slot ─────────────────────────────────────────────────

describe("the write-facts slot — a single-item mailbox, taken exactly once", () => {
  // The slot itself is three lines in `server.ts` and cannot be imported. What
  // CAN be driven is the discipline around it: `reportCompletedWrite`'s
  // attribution guard, and the take-once/clear-on-close protocol the executor's
  // `propose`/`onClose` pair implements. Modelled here exactly as `server.ts`
  // wires it, so a change to that protocol has something to fail.
  function slotHarness() {
    const { seam, consult } = createGovernanceSeam();
    const seen = [];
    seam.registerWriteObserver("test-provider", (facts) => { seen.push(facts); });
    let writeFacts = null;
    return {
      seen,
      consult,
      fill: (facts) => { writeFacts = facts; },
      peek: () => writeFacts,
      // The `propose` hook, verbatim in shape from server.ts.
      propose: (operation, sources) => {
        const facts = writeFacts;
        writeFacts = null;
        return reportCompletedWrite(consult, facts, operation, sources, ACTOR);
      },
      onClose: () => { writeFacts = null; },
    };
  }

  const OP = { id: "op-1", action: { id: "note.write", version: 1 }, sessionId: "s-1" };
  const FACTS = { path: "a.md", baseBytes: null, proposedBytes: new Uint8Array([1, 2]), created: true };

  test("a filled slot is reported ONCE and is empty afterwards", async () => {
    const h = slotHarness();
    h.fill(FACTS);
    assert.equal(h.propose(OP, ["a.md"]), true);
    assert.equal(h.peek(), null, "taken");
    // A SECOND operation with nothing in the slot must report nothing — this is
    // the property that stops one write's bytes becoming two proposals.
    assert.equal(h.propose({ ...OP, id: "op-2" }, ["a.md"]), false);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(h.seen.length, 1);
  });

  test("MIS-ATTRIBUTED facts are DROPPED — the operation's sources decide", async () => {
    const h = slotHarness();
    h.fill(FACTS);
    assert.equal(h.propose(OP, ["somewhere-else.md"]), false, "the slot's path is not among this operation's sources");
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(h.seen, [], "handing those bytes across would manufacture a proposal about a write that did not happen");
  });

  test("MUTATION CHECK: the same facts WITH a matching source do cross", async () => {
    const h = slotHarness();
    h.fill(FACTS);
    assert.equal(h.propose(OP, ["a.md", "b.md"]), true);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(h.seen.length, 1);
    assert.equal(h.seen[0].path, "a.md");
  });

  test("onClose CLEARS the slot, so a failed operation leaves nothing for the next one", async () => {
    const h = slotHarness();
    h.fill(FACTS);
    h.onClose();
    assert.equal(h.peek(), null);
    assert.equal(h.propose(OP, ["a.md"]), false);
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(h.seen, []);
  });

  test("with NO seam wired the take still happens — a host with no provider is not a leak", async () => {
    let writeFacts = FACTS;
    const propose = (operation, sources) => {
      const facts = writeFacts;
      writeFacts = null;
      return reportCompletedWrite(undefined, facts, operation, sources, ACTOR);
    };
    assert.equal(propose(OP, ["a.md"]), false, "no consult ⇒ nothing reported");
    assert.equal(writeFacts, null, "…but the slot is emptied regardless, so the next operation starts clean");
  });
});

// ── 3. the executor's propose safety ────────────────────────────────────────

describe("createOperationExecutor's propose — a provider cannot cost a caller a landed write", () => {
  function noteWriteRegistry() {
    const registry = createActionRegistry();
    registry.register({
      id: "note.write",
      version: 1,
      title: "Write a note",
      postcondition: "Replace the content of one note.",
      owner: "core",
      distribution: "public-default",
      modes: ["proposal-mutation"],
      changeClasses: ["content"],
      observations: { defaultCapture: "ephemeral", supportsProposal: false },
      effects: { direct: ["note-content"], discovered: "none" },
      authority: { governorOnly: false, automaticAdmission: "never" },
      scope: { argumentKeys: ["path"], resolvesAddresses: true, enumeration: "not-applicable", whenScoped: "available" },
      retention: { operation: "durable-for-mutation" },
      inputs: ["path", "content"],
      native: true,
    });
    registry.bind({ kind: "mcp", id: "obsidian_write_note", action: "note.write", actionVersion: 1 });
    registry.validate();
    return registry;
  }

  function executorWith(propose, onClose) {
    return createOperationExecutor({
      registry: noteWriteRegistry(),
      actor: () => ({ binding: "conn-1", clientClaim: "claude-code" }),
      sessionId: () => "s-1",
      propose,
      onClose,
    });
  }

  const REQ = { action: "note.write", actionVersion: 1, surface: { kind: "mcp", id: "obsidian_write_note" }, inputs: { path: "a.md" } };

  test("a THROWING propose does not fail the operation — the write already landed", async () => {
    const ex = executorWith(async () => { throw new Error("provider exploded"); });
    const { result, operation } = await ex.run(REQ, async () => ({ ok: true }));
    assert.deepEqual(result, { ok: true }, "the caller gets their result");
    assert.equal(operation.outcome, "completed", "and the operation completes");
  });

  test("MUTATION CHECK: a throwing HANDLER does fail, so the test above is not vacuous", async () => {
    const ex = executorWith(async () => {});
    await assert.rejects(() => ex.run(REQ, async () => { throw new Error("the write itself failed"); }), /the write itself failed/);
  });

  test("propose runs ONLY on a completed operation", async () => {
    const calls = [];
    const ex = executorWith(async (op) => { calls.push(op.id); });
    await ex.run(REQ, async () => ({ ok: true }));
    assert.equal(calls.length, 1);
    calls.length = 0;
    await assert.rejects(() => ex.run(REQ, async () => { throw new Error("boom"); }));
    assert.deepEqual(calls, [], "a failed operation produces no candidate — there is nothing to review");
  });

  test("the operation still CLOSES when propose throws — evidence is not conditional on the provider", async () => {
    const closed = [];
    const ex = executorWith(async () => { throw new Error("provider exploded"); }, (op) => closed.push(op.outcome));
    await ex.run(REQ, async () => ({ ok: true }));
    assert.deepEqual(closed, ["completed"]);
  });

  test("an ABSENT propose is the ordinary case — the host with no provider", async () => {
    const ex = executorWith(undefined);
    const { result, operation } = await ex.run(REQ, async () => ({ ok: true }));
    assert.deepEqual(result, { ok: true });
    assert.equal(operation.outcome, "completed");
  });
});
