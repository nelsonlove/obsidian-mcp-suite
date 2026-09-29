/**
 * timeout-unknown.test.mjs — #436. On 2026-09-29 three moves returned
 * write_timeout and then landed (late-ok). The journal said `error`, and a
 * thrown timeout freed the idempotency key, so a same-key retry would have run
 * the move a second time while the first was still running.
 *
 * Pins: a timeout is journaled `unknown` and its message says the outcome is
 * unknown; the key stays held, so a same-key retry waits for the late result
 * and the operation runs once; a late throw frees the key.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { WriteQueue, Kernel, WriteJournal, IdempotencyStore, LockStore, WriteTimeoutError } from "../src/kernel/index.ts";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function harness() {
  const files = new Map();
  const adapter = { async exists(p) { return files.has(p); }, async mkdir() {}, async write(p, d) { files.set(p, d); }, async append(p, d) { files.set(p, (files.get(p) ?? "") + d); } };
  const kernel = new Kernel(new WriteQueue(30), new WriteJournal(adapter, "j", () => new Date()), { uid: () => undefined, rev: () => 1 }, new IdempotencyStore(), new LockStore());
  const records = () => [...files.values()].join("").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { kernel, records };
}
const ACTOR = { transport: "mcp", client: "t", connection: "c" };
const mc = (key) => ({ op: "obsidian_move_note", args: { from: "A.md", to: "B.md" }, actor: ACTOR, idempotencyKey: key });

describe("a write that times out has an unknown outcome, and its key stays held", () => {
  test("the caller gets write_timeout saying OUTCOME UNKNOWN; the journal says unknown, then late-ok", async () => {
    const { kernel, records } = harness();
    const err = await kernel.runMutation(mc("T1"), async () => { await sleep(80); return { content: [{ type: "text", text: "moved" }] }; }).catch((e) => e);
    assert.equal(err.code, "write_timeout");
    assert.match(err.message, /OUTCOME UNKNOWN: it is still running and may yet land/);
    assert.match(err.message, /A retry with the SAME idempotency_key is safe/);
    await sleep(120);
    const outs = records().map((r) => r.outcome);
    assert.deepEqual(outs, ["unknown", "late-ok"]);
  });

  test("a same-key retry during the wait does not run the write again: it waits and returns the late result", async () => {
    const { kernel, records } = harness();
    let runs = 0;
    const op = async () => { runs++; await sleep(80); return { content: [{ type: "text", text: "moved once" }] }; };
    const first = await kernel.runMutation(mc("T2"), op).catch((e) => e);
    assert.equal(first.code, "write_timeout");
    const retry = await kernel.runMutation(mc("T2"), op);
    assert.equal(runs, 1, "the move ran once");
    assert.equal(retry.content[0].text, "moved once", "the retry gets the late result");
    const again = await kernel.runMutation(mc("T2"), op);
    assert.equal(again.content[0].text, "moved once", "after settlement the key replays");
    assert.equal(runs, 1);
    await sleep(10);
    assert.ok(records().some((r) => r.outcome === "deduped"));
  });

  test("a late result that arrives before the kernel takes the hold is still handed over (no 10-minute stall)", async () => {
    // A queue that reports the late settlement BEFORE rejecting the caller: the
    // ordering a real abandon can produce when the operation settles at once.
    const files = new Map();
    const adapter = { async exists(p) { return files.has(p); }, async mkdir() {}, async write(p, d) { files.set(p, d); }, async append(p, d) { files.set(p, (files.get(p) ?? "") + d); } };
    const early = { depth: 0, running: false, nudge() {}, close() {},
      run(op, _fn, onLate) { onLate({ ok: true, value: { content: [{ type: "text", text: "landed early" }] } }); return Promise.reject(new WriteTimeoutError(op, 30)); } };
    const kernel = new Kernel(early, new WriteJournal(adapter, "j", () => new Date()), { uid: () => undefined, rev: () => 1 }, new IdempotencyStore(), new LockStore());
    const first = await kernel.runMutation(mc("T4"), async () => ({ content: [] })).catch((e) => e);
    assert.equal(first.code, "write_timeout");
    assert.equal(kernel.idempotency.inFlight, 0, "the key is not left held");
    const retry = await kernel.runMutation(mc("T4"), async () => { throw new Error("must not run"); });
    assert.equal(retry.content[0].text, "landed early");
  });

  test("a late throw frees the key: the next same-key call runs", async () => {
    const { kernel } = harness();
    let runs = 0;
    const failing = async () => { runs++; await sleep(80); throw new Error("disk full"); };
    const first = await kernel.runMutation(mc("T3"), failing).catch((e) => e);
    assert.equal(first.code, "write_timeout");
    const waiter = await kernel.runMutation(mc("T3"), failing).catch((e) => e);
    assert.match(String(waiter.message ?? waiter), /disk full/, "a waiter shares the late failure");
    assert.equal(runs, 1);
    await kernel.runMutation(mc("T3"), async () => { runs++; return { content: [] }; });
    assert.equal(runs, 2, "after a late failure the key is free again");
  });
});
