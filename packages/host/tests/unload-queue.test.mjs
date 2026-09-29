/**
 * unload-queue.test.mjs — #435. On 2026-09-29 a plugin reload left the old
 * instance's write queue running: a create queued before the reload ran two
 * minutes later, after its caller had retried under the same key on the new
 * instance and trashed the note, and re-created it. Two defects together:
 * unload never stopped the queue, and the key store was memory-only.
 *
 * Pins: (1) closing the queue refuses every waiting operation, lets the running
 * one finish, and refuses later ones; (2) through the kernel, a refused
 * operation never runs, is journaled, and frees its key; (3) a store seeded
 * from the journal answers a retry across a reload as already done, never
 * running it again, and still refuses a different request under the key.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { WriteQueue, Kernel, WriteJournal, IdempotencyStore, LockStore } from "../src/kernel/index.ts";
import { QueueClosedError } from "../src/kernel/write-queue.ts";
import { seedFromJournal } from "../src/kernel/idempotency.ts";

const tick = () => new Promise((r) => setTimeout(r, 5));
function gate() { let open; const p = new Promise((r) => { open = r; }); return { p, open }; }

describe("WriteQueue.close — waiting operations are refused, the running one finishes", () => {
  test("close refuses the waiting ones with plugin_unloaded; they never run; the running one settles normally; later runs are refused", async () => {
    const q = new WriteQueue(60_000);
    const g = gate();
    const ran = [];
    const running = q.run("first", async () => { ran.push("first"); await g.p; return "first-done"; });
    const waiting = q.run("second", () => { ran.push("second"); return "second-done"; });
    const waitingErr = waiting.catch((e) => e);
    await tick();
    q.close();
    const e = await waitingErr;
    assert.ok(e instanceof QueueClosedError);
    assert.equal(e.code, "plugin_unloaded");
    assert.match(e.message, /was NOT run: nothing was written\. It is safe to retry\./);
    g.open();
    assert.equal(await running, "first-done", "the running operation is not cancelled");
    await tick();
    assert.deepEqual(ran, ["first"], "the waiting operation never ran");
    await assert.rejects(q.run("third", () => ran.push("third")), (err) => err.code === "plugin_unloaded");
    await tick();
    assert.deepEqual(ran, ["first"]);
  });
});

function harness(store = new IdempotencyStore()) {
  const files = new Map();
  const adapter = { async exists(p) { return files.has(p); }, async mkdir() {}, async write(p, d) { files.set(p, d); }, async append(p, d) { files.set(p, (files.get(p) ?? "") + d); } };
  const journal = new WriteJournal(adapter, "j", () => new Date());
  const kernel = new Kernel(new WriteQueue(60_000), journal, { uid: () => undefined, rev: () => 1 }, store, new LockStore());
  const records = () => [...files.values()].join("").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { kernel, records, store };
}
const ACTOR = { transport: "mcp", client: "t", connection: "c" };
const mc = (key, args = { path: "A.md", content: "x" }) => ({ op: "obsidian_write_note", args, actor: ACTOR, idempotencyKey: key });

describe("through the kernel", () => {
  test("a keyed write waiting when the queue closes never runs, is journaled as an error, and frees its key", async () => {
    const { kernel, records, store } = harness();
    const g = gate();
    const first = kernel.runMutation({ op: "obsidian_move_note", args: { from: "X.md", to: "Y.md" }, actor: ACTOR }, async () => { await g.p; return { content: [] }; });
    let ran = false;
    const second = kernel.runMutation(mc("K1"), async () => { ran = true; return { content: [] }; }).catch((e) => e);
    await tick();
    kernel.queue.close();
    const e = await second;
    assert.equal(e.code, "plugin_unloaded");
    g.open(); await first; await tick();
    assert.equal(ran, false);
    const rec = records().find((r) => r.idempotencyKey === "K1");
    assert.equal(rec.outcome, "error");
    assert.match(rec.error, /was NOT run/);
    assert.equal(store.get("K1"), undefined, "the key is free: a retry on the new instance runs it");
  });

  test("a keyed record carries argsHash, and a new instance seeded from the journal answers the retry as already done without running it", async () => {
    const a = harness();
    await a.kernel.runMutation(mc("K2"), async () => ({ content: [{ type: "text", text: "created" }] }));
    await tick();
    const recs = a.records();
    assert.ok(recs[0].argsHash, "keyed records carry the args hash");

    const b = harness();
    assert.equal(seedFromJournal(b.store, recs, Date.now()), 1);
    let ran = false;
    const res = await b.kernel.runMutation(mc("K2"), async () => { ran = true; return { content: [] }; });
    assert.equal(ran, false, "a retry across a reload never runs the write again");
    assert.match(res.content[0].text, /^Already done: idempotency_key 'K2' ran 'obsidian_write_note' at .* re-read the note before acting on it\.$/);
    assert.equal(res.structuredContent.acrossReload, true);
    await tick();
    assert.equal(b.records().at(-1).outcome, "deduped");

    // a different request under the same key is still refused, not replayed
    await assert.rejects(b.kernel.runMutation(mc("K2", { path: "A.md", content: "DIFFERENT" }), async () => ({ content: [] })), (e) => e.code === "idempotency_mismatch");
  });

  test("seeding takes ok and late-ok records inside the TTL only", () => {
    const now = Date.parse("2026-09-29T08:20:00Z");
    const base = { op: "obsidian_move_note", argsDigest: { from: "X.md" }, argsHash: "h" };
    const store = new IdempotencyStore(undefined, undefined, () => now);
    const n = seedFromJournal(store, [
      { ...base, ts: "2026-09-29T08:18:42Z", outcome: "late-ok", idempotencyKey: "late", corrects: "2026-09-29T08:18:38Z" },
      { ...base, ts: "2026-09-29T08:15:00Z", outcome: "ok", idempotencyKey: "ok" },
      { ...base, ts: "2026-09-29T08:15:00Z", outcome: "error", idempotencyKey: "err" },
      { ...base, ts: "2026-09-29T08:05:00Z", outcome: "ok", idempotencyKey: "old" },
      { ...base, ts: "2026-09-29T08:15:00Z", outcome: "ok", idempotencyKey: "nohash", argsHash: undefined },
      { ...base, ts: "2026-09-29T08:15:00Z", outcome: "ok" },
    ], now);
    assert.equal(n, 2);
    assert.equal(store.get("late").ts, "2026-09-29T08:18:38Z", "a late-ok points at the call that timed out");
    assert.ok(store.get("ok"));
    for (const k of ["err", "old", "nohash"]) assert.equal(store.get(k), undefined, k);
  });
});

describe("#438 review", () => {
  test("an item dequeued but not yet started when the queue closes is refused, not run", async () => {
    const q = new WriteQueue(60_000);
    let ran = false;
    const p = q.run("x", () => { ran = true; }).catch((e) => e);
    q.close(); // same tick: pump has dequeued the item, fn starts a microtask later
    const e = await p;
    assert.equal(e?.code, "plugin_unloaded");
    assert.equal(ran, false);
  });

  test("a RUNNING write's key survives a reload through the shared store: the retry waits and does not run again", async () => {
    const shared = new IdempotencyStore();
    const a = harness(shared);
    const g = gate();
    let runs = 0;
    const first = a.kernel.runMutation(mc("K3"), async () => { runs++; await g.p; return { content: [{ type: "text", text: "made" }] }; });
    await tick();
    a.kernel.queue.close(); // unload while it runs
    const b = harness(shared); // the new instance gets the same store
    assert.equal(seedFromJournal(shared, a.records(), Date.now()), 0, "nothing journaled yet, nothing seeded");
    const retry = b.kernel.runMutation(mc("K3"), async () => { runs++; return { content: [] }; });
    g.open();
    assert.equal((await first).content[0].text, "made");
    assert.equal((await retry).content[0].text, "made", "the retry gets the running write's result");
    assert.equal(runs, 1);
  });

  test("a RETURNED failure envelope under a key is seeded (it replayed before the reload too); a thrown failure is not", async () => {
    const a = harness();
    await a.kernel.runMutation(mc("K4"), async () => ({ content: [{ type: "text", text: "Error: 2 of 5 failed" }], isError: true }));
    await a.kernel.runMutation(mc("K5"), async () => { throw new Error("boom"); }).catch(() => {});
    await tick();
    const recs = a.records();
    assert.equal(recs.find((r) => r.idempotencyKey === "K4").returned, true);
    assert.equal(recs.find((r) => r.idempotencyKey === "K5").returned, undefined);
    const store = new IdempotencyStore();
    assert.equal(seedFromJournal(store, recs, Date.now()), 1);
    assert.ok(store.get("K4"));
    assert.equal(store.get("K5"), undefined);
  });

  test("seeding never overwrites a key the live store already holds", () => {
    const store = new IdempotencyStore();
    store.set("K6", { op: "obsidian_write_note", args: "x", result: "LIVE", ts: "t" });
    seedFromJournal(store, [{ ts: new Date().toISOString(), op: "obsidian_write_note", outcome: "ok", argsDigest: {}, idempotencyKey: "K6", argsHash: "h" }], Date.now());
    assert.equal(store.get("K6").result, "LIVE");
  });
});

describe("main.ts wiring (source pins)", () => {
  const src = fs.readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  test("unload closes the write queue (a registered callback runs at unload)", () => {
    assert.match(src, /this\.register\(\(\) => writeQueue\.close\(\)\);/);
  });
  test("load seeds the idempotency store from the journal", () => {
    assert.match(src, /seedFromJournal\(/);
  });
  test("a reload hands the live key store to the new instance (one store per vault on globalThis)", () => {
    assert.match(src, /__vaultMcpIdempotencyV1 \?\?= new Map\(\)/);
    assert.match(src, /stores\.get\(this\.slug\) \?\? new IdempotencyStore\(\)/);
    assert.ok(src.indexOf("const idempotency = stores.get") > src.indexOf("this.slug = vaultSlug"), "the slug is set before the store is looked up");
  });
});
