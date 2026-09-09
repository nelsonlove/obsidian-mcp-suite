/**
 * pending-review.test.mjs — slice B3b: the read-side `obsidian_pending_review`
 * tool over the governance module's published review-queue index (#261: the
 * index moved from the retired Stewardship standalone's path to the plugin dir,
 * and absence became an EXPLICIT `published: false` — never a silent empty
 * queue).
 *
 * S3c MOVED THE REGISTRATION, NOT THE TOOL. `registerPendingReviewTools(server,
 * ctx)` is now `buildPendingReviewTools(ctx): SdkToolSpec[]`, published through
 * `vault-mcp-api` like any third-party publisher's tool. So the tests run the
 * specs through `tests/host-shim.mjs` rather than a fake `McpServer`: what they
 * assert is the envelope an AGENT sees (`ok(data)` / `Error [code]: message`),
 * which is the same shape as before precisely because the shim reproduces the
 * host's `ok`/`fail`. The tool itself is obsidian-free (defined over an injected
 * `PendingReviewSource`), so everything here still runs headlessly.
 *
 * TWO THINGS THE MOVE CHANGED, and both are asserted below rather than papered
 * over. (1) The published NAME survives only because of the host's closed
 * grandfather table — an ordinary external tool may not take an `obsidian_*`
 * name at all, so this one is a carve-out and is pinned as one. (2) The
 * `readOnly: true` CLAIM is distrusted: the host registers it as MUTATING unless
 * the operator lists `governor` in `trustedReadOnlyPlugins`, so the old
 * `readOnlyHint: true` assertion is now a claim-versus-conclusion pair. What
 * that buys operationally is stated in `publication.test.mjs`.
 *
 * Covers: the pending list from a fixture index; the publish→read round-trip
 * against the REAL serializer the governance module uses; allowlist-filtering
 * drops paths outside the caller's visible set; explicit not-published /
 * unreadable states; schema-drift tolerance; and the plugin-dir-relative
 * adapter path.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { publishInto } from "./host-shim.mjs";
import {
  buildPendingReviewTools,
  parsePendingIndex,
  parsePendingIndexStrict,
  obsidianPendingReviewSource,
  PENDING_INDEX_REL,
} from "../src/tools/pending-review.ts";
import { serializePendingIndex } from "../src/kernel/pending-index.ts";

// A well-formed index: the shape the governance module publishes.
const INDEX = {
  version: 1,
  generatedAt: "2026-08-10T12:00:00Z",
  pending: [
    { path: "Projects/alpha.md", status: "pending", agent: "claude", op: "write_note", when: "2026-08-10T11:00:00Z", writeCount: 3 },
    { path: "Archive/old.md", status: "pending", agent: "claude", op: "append_note", when: "2026-08-10T10:00:00Z", writeCount: 1 },
    { path: "Projects/beta.md", status: "pending", agent: "gpt", op: "move_note", when: "2026-08-10T09:00:00Z", writeCount: 2 },
  ],
};

/** A source that returns whatever raw text (or null) the test supplies. */
function sourceOf(raw) {
  return { read: async () => raw };
}

function toolServer({ raw = JSON.stringify(INDEX), settings = { readOnly: false, allowlist: [] }, trusted = false } = {}) {
  const specs = buildPendingReviewTools({ source: sourceOf(raw), getSettings: () => settings });
  const { tools } = publishInto(specs, { trusted });
  const call = (name = "obsidian_pending_review", args = {}) => tools.get(name).handler(args);
  return { specs, tools, call };
}

// ── publication shape ─────────────────────────────────────────────────────────

describe("publication", () => {
  test("builds exactly one spec, and it publishes UNPREFIXED as obsidian_pending_review", () => {
    const { specs, tools } = toolServer();
    assert.deepEqual(specs.map((s) => s.name), ["obsidian_pending_review"]);
    assert.deepEqual([...tools.keys()], ["obsidian_pending_review"]);
    assert.equal(tools.get("obsidian_pending_review").grandfathered, true);
  });

  test("the name is a CARVE-OUT, not the ordinary rule — proven against two planted violations", () => {
    // Instrument discipline: the assertion above is worthless unless the shim
    // would have said something different for a name it does NOT grandfather.
    // Two plants, one per half of the host's rule.
    //
    // (a) OWNER-GATED. The table names both the spelling and the single owner
    //     id, so the same spec published by anyone else takes the ordinary
    //     `<sanitized owner>_<bare name>` form. It does not collide with the
    //     reserved namespace — `some_other_plugin_obsidian_pending_review` does
    //     not START with `obsidian_` — it simply is not this tool.
    const { specs } = toolServer();
    const foreign = publishInto(specs, { owner: "some-other-plugin" }).tools;
    assert.deepEqual([...foreign.keys()], ["some_other_plugin_obsidian_pending_review"]);
    assert.equal(foreign.get("some_other_plugin_obsidian_pending_review").grandfathered, false);

    // (b) NAME-GATED, and the table is CLOSED. An ungrandfathered name never
    //     KEEPS its spelling — `obsidian_not_in_the_table` from this plugin
    //     publishes as `governor_obsidian_not_in_the_table`, which is a rename,
    //     not a refusal. So the shim's F1 branch is proven with the plant that
    //     actually reaches it: an owner whose SANITIZED id already begins
    //     `obsidian`, which is the only way a published name can land in the
    //     reserved namespace without the table. (This mirrors the host's own
    //     `external-tools.test.mjs` F1 case, owner `obsidian-read` + name `note`.)
    assert.deepEqual(
      [...publishInto([{ ...specs[0], name: "obsidian_not_in_the_table" }]).tools.keys()],
      ["governor_obsidian_not_in_the_table"],
      "a sixth obsidian_* name from this plugin is RENAMED, never grandfathered",
    );
    assert.throws(
      () => publishInto([{ ...specs[0], name: "note" }], { owner: "obsidian-read" }),
      /collides with the reserved obsidian_\* namespace/,
      "the shim's F1 branch fires — the carve-out above is not the shim simply never refusing",
    );
  });

  test("it CLAIMS read-only; an untrusted claim registers as MUTATING", () => {
    // The host distrusts a publisher's `readOnlyHint` unless the raw plugin id
    // is in `trustedReadOnlyPlugins` (empty by default). So the tool that
    // structurally cannot write is nonetheless blocked in read-only mode — the
    // deliberate cost of the split, not an oversight. `destructiveHint` is false
    // on both presets, so it does not move.
    const { tools } = toolServer();
    const def = tools.get("obsidian_pending_review").def;
    assert.equal(def.claimsReadOnly, true);
    assert.equal(def.annotations.readOnlyHint, false, "untrusted ⇒ mutating");
    assert.equal(def.annotations.destructiveHint, false);

    const trusted = toolServer({ trusted: true }).tools.get("obsidian_pending_review").def;
    assert.equal(trusted.annotations.readOnlyHint, true, "the operator can opt into believing the claim");
    assert.equal(trusted.annotations.idempotentHint, true);
  });

  test("takes no arguments — nothing a caller could use to change state", () => {
    const { tools } = toolServer();
    assert.deepEqual(tools.get("obsidian_pending_review").def.inputSchema, {});
  });

  test("description promises read-only, no accept verb, and advisory-only", () => {
    const { tools } = toolServer();
    const desc = tools.get("obsidian_pending_review").def.description.toLowerCase();
    assert.match(desc, /read-only/);
    assert.match(desc, /accept/); // it says it CANNOT accept
    assert.match(desc, /advisory|blocks nothing|avoid/);
  });
});

// ── happy path ────────────────────────────────────────────────────────────────

describe("returns the pending list from a fixture index", () => {
  test("no allowlist ⇒ every entry, fields passed through verbatim, published: true", async () => {
    const { call } = toolServer();
    const res = await call();
    assert.equal(res.structuredContent.published, true);
    assert.equal(res.structuredContent.count, 3);
    assert.deepEqual(res.structuredContent.pending, INDEX.pending);
    assert.equal(res.structuredContent.reason, undefined);
  });

  test("count matches the list length", async () => {
    const { call } = toolServer();
    const res = await call();
    assert.equal(res.structuredContent.count, res.structuredContent.pending.length);
  });

  test("is not an error result", async () => {
    const { call } = toolServer();
    const res = await call();
    assert.notEqual(res.isError, true);
  });

  test("an empty-but-published index is published: true, count 0 — distinguishable from absence", async () => {
    const { call } = toolServer({ raw: JSON.stringify({ version: 1, generatedAt: "2026-08-19T00:00:00Z", pending: [] }) });
    const res = await call();
    assert.equal(res.structuredContent.published, true);
    assert.equal(res.structuredContent.count, 0);
    assert.deepEqual(res.structuredContent.pending, []);
  });
});

// ── publish → read round-trip against the REAL serializer (#261) ──────────────

describe("round-trips the governance module's own published bytes", () => {
  const items = [
    {
      path: "Projects/alpha.md", title: "alpha", agent: "assent/1", op: "obsidian_append_note",
      when: "2026-08-19T11:34:59.009Z", writeCount: 2, writes: [], hadBaseline: true,
    },
    {
      path: "Archive/old.md", title: "old", agent: "claude", op: "obsidian_write_note",
      when: "2026-08-19T10:00:00.000Z", writeCount: 1, writes: [], hadBaseline: false,
    },
  ];

  test("serializePendingIndex bytes read back as the same entries, published: true", async () => {
    const raw = serializePendingIndex(items, "2026-08-19T12:00:00.000Z");
    const { call } = toolServer({ raw });
    const res = await call();
    assert.equal(res.structuredContent.published, true);
    assert.deepEqual(res.structuredContent.pending, [
      { path: "Projects/alpha.md", status: "pending", agent: "assent/1", op: "obsidian_append_note", when: "2026-08-19T11:34:59.009Z", writeCount: 2 },
      { path: "Archive/old.md", status: "pending", agent: "claude", op: "obsidian_write_note", when: "2026-08-19T10:00:00.000Z", writeCount: 1 },
    ]);
  });

  test("the round-trip still honors the allowlist filter", async () => {
    const raw = serializePendingIndex(items, "2026-08-19T12:00:00.000Z");
    const { call } = toolServer({ raw, settings: { readOnly: false, allowlist: ["Projects"] } });
    const res = await call();
    assert.equal(res.structuredContent.published, true);
    assert.deepEqual(res.structuredContent.pending.map((e) => e.path), ["Projects/alpha.md"]);
  });
});

// ── allowlist filtering (no path oracle) ───────────────────────────────────────

describe("allowlist-filtering drops paths outside the visible set", () => {
  test("a session scoped to Projects/ never learns about Archive/old.md", async () => {
    const { call } = toolServer({ settings: { readOnly: false, allowlist: ["Projects"] } });
    const res = await call();
    const paths = res.structuredContent.pending.map((e) => e.path);
    assert.deepEqual(paths, ["Projects/alpha.md", "Projects/beta.md"]);
    assert.equal(res.structuredContent.count, 2);
    assert.ok(!paths.includes("Archive/old.md"), "hidden path must not appear");
  });

  test("a scope with NO visible pending notes reads as an empty queue", async () => {
    const { call } = toolServer({ settings: { readOnly: false, allowlist: ["Somewhere/Else"] } });
    const res = await call();
    assert.deepEqual(res.structuredContent.pending, []);
    assert.equal(res.structuredContent.count, 0);
  });

  test("filter uses the shared guard rule — same set the read tools honor", async () => {
    // A deeper allowlist prefix that only matches one entry.
    const { call } = toolServer({ settings: { readOnly: false, allowlist: ["Projects/alpha.md"] } });
    const res = await call();
    assert.deepEqual(res.structuredContent.pending.map((e) => e.path), ["Projects/alpha.md"]);
  });

  test("read-only mode does not change the read (it was never a write)", async () => {
    const { call } = toolServer({ settings: { readOnly: true, allowlist: [] } });
    const res = await call();
    assert.equal(res.structuredContent.count, 3);
  });
});

// ── explicit degrade (#261 — absence is NEVER a silent empty queue) ───────────

describe("absent / unreadable index is an EXPLICIT published: false, never a bare empty", () => {
  test("missing file (source ⇒ null) ⇒ published: false with a reason, not an error", async () => {
    const { call } = toolServer({ raw: null });
    const res = await call();
    assert.equal(res.structuredContent.published, false);
    assert.match(res.structuredContent.reason, /not-published/);
    assert.deepEqual(res.structuredContent.pending, []);
    assert.equal(res.structuredContent.count, 0);
    assert.notEqual(res.isError, true);
  });

  test("unparseable JSON ⇒ published: false (unreadable), not an error", async () => {
    const { call } = toolServer({ raw: "{ this is not json" });
    const res = await call();
    assert.equal(res.structuredContent.published, false);
    assert.match(res.structuredContent.reason, /unreadable/);
    assert.deepEqual(res.structuredContent.pending, []);
    assert.notEqual(res.isError, true);
  });

  test("empty string ⇒ published: false (unreadable)", async () => {
    const { call } = toolServer({ raw: "" });
    const res = await call();
    assert.equal(res.structuredContent.published, false);
    assert.match(res.structuredContent.reason, /unreadable/);
    assert.deepEqual(res.structuredContent.pending, []);
  });

  test("a recognizable root with drifted entries is still PUBLISHED (per-entry tolerance)", async () => {
    const { call } = toolServer({ raw: JSON.stringify({ pending: [null, { path: "keep.md" }] }) });
    const res = await call();
    assert.equal(res.structuredContent.published, true);
    assert.deepEqual(res.structuredContent.pending, [{ path: "keep.md" }]);
  });

  test("an unrecognizable root (no pending array) is UNREADABLE, not empty", async () => {
    const { call } = toolServer({ raw: JSON.stringify({ version: 1 }) });
    const res = await call();
    assert.equal(res.structuredContent.published, false);
    assert.match(res.structuredContent.reason, /unreadable/);
  });

  test("a throwing source still degrades to published: false, never an error", async () => {
    // Worth restating post-split: a THROW out of a published handler is the
    // host's refusal channel now (`fail(err)`), so this tool's blanket catch is
    // what keeps a broken index from reaching the agent as an error envelope.
    const { tools } = publishInto(
      buildPendingReviewTools({
        source: { read: async () => { throw new Error("adapter blew up"); } },
        getSettings: () => ({ readOnly: false, allowlist: [] }),
      }),
    );
    const res = await tools.get("obsidian_pending_review").handler({});
    assert.equal(res.structuredContent.published, false);
    assert.deepEqual(res.structuredContent.pending, []);
    assert.notEqual(res.isError, true);
  });

  test("parsePendingIndexStrict: null on non-index text, entries on a real index", () => {
    assert.equal(parsePendingIndexStrict("nope"), null);
    assert.equal(parsePendingIndexStrict(JSON.stringify({ version: 1 })), null);
    assert.equal(parsePendingIndexStrict(JSON.stringify([1, 2])), null);
    assert.deepEqual(parsePendingIndexStrict(JSON.stringify({ pending: [] })), []);
  });
});

// ── schema-drift tolerance ─────────────────────────────────────────────────────

describe("schema-drift tolerance", () => {
  test("missing `pending` ⇒ empty list", () => {
    assert.deepEqual(parsePendingIndex(JSON.stringify({ version: 1 })), []);
  });

  test("`pending` not an array ⇒ empty list", () => {
    assert.deepEqual(parsePendingIndex(JSON.stringify({ pending: "soon" })), []);
    assert.deepEqual(parsePendingIndex(JSON.stringify({ pending: 42 })), []);
    assert.deepEqual(parsePendingIndex(JSON.stringify({ pending: { path: "x.md" } })), []);
  });

  test("non-object root ⇒ empty list", () => {
    assert.deepEqual(parsePendingIndex(JSON.stringify([1, 2, 3])), []);
    assert.deepEqual(parsePendingIndex(JSON.stringify("nope")), []);
    assert.deepEqual(parsePendingIndex(JSON.stringify(null)), []);
  });

  test("unknown top-level fields are ignored; known entries survive", () => {
    const drifted = JSON.stringify({
      version: 99,
      futureField: { nested: true },
      pending: [{ path: "a.md", status: "pending" }],
    });
    assert.deepEqual(parsePendingIndex(drifted), [{ path: "a.md", status: "pending" }]);
  });

  test("unknown per-entry fields are dropped; known fields kept", () => {
    const drifted = JSON.stringify({
      pending: [{ path: "a.md", status: "pending", reviewer: "nelson", priority: 5, writeCount: 2 }],
    });
    assert.deepEqual(parsePendingIndex(drifted), [{ path: "a.md", status: "pending", writeCount: 2 }]);
  });

  test("entries with no path (unfilterable) are dropped, not surfaced", () => {
    const drifted = JSON.stringify({
      pending: [
        { status: "pending", agent: "claude" }, // no path
        { path: "", status: "pending" }, // empty path
        { path: "keep.md", status: "pending" },
      ],
    });
    assert.deepEqual(parsePendingIndex(drifted), [{ path: "keep.md", status: "pending" }]);
  });

  test("non-object array items are skipped", () => {
    const drifted = JSON.stringify({ pending: [null, "x", 3, { path: "keep.md" }] });
    assert.deepEqual(parsePendingIndex(drifted), [{ path: "keep.md" }]);
  });

  test("wrongly-typed known fields are dropped, not coerced", () => {
    const drifted = JSON.stringify({
      pending: [{ path: "a.md", status: 1, writeCount: "three", agent: null }],
    });
    assert.deepEqual(parsePendingIndex(drifted), [{ path: "a.md" }]);
  });

  test("null raw ⇒ empty list", () => {
    assert.deepEqual(parsePendingIndex(null), []);
  });
});

// ── the live adapter's path construction ───────────────────────────────────────

describe("obsidianPendingReviewSource", () => {
  test("reads from <plugin dir>/governance/pending-index.json when the host supplies the dir", async () => {
    const reads = [];
    const fakeApp = {
      vault: {
        configDir: ".obsidian",
        adapter: {
          exists: async (p) => { reads.push(["exists", p]); return true; },
          read: async (p) => { reads.push(["read", p]); return JSON.stringify(INDEX); },
        },
      },
    };
    const src = obsidianPendingReviewSource(fakeApp, ".obsidian/plugins/vault-mcp");
    const raw = await src.read();
    const expected = `.obsidian/plugins/vault-mcp/${PENDING_INDEX_REL}`;
    assert.deepEqual(reads, [["exists", expected], ["read", expected]]);
    assert.deepEqual(JSON.parse(raw), INDEX);
  });

  test("no plugin dir supplied ⇒ falls back to <configDir>/plugins/governor (not hardwired .obsidian)", async () => {
    const seen = [];
    const fakeApp = {
      vault: {
        configDir: ".my-config",
        adapter: {
          exists: async (p) => { seen.push(p); return true; },
          read: async () => "{}",
        },
      },
    };
    await obsidianPendingReviewSource(fakeApp).read();
    assert.deepEqual(seen, [`.my-config/plugins/governor/${PENDING_INDEX_REL}`]);
  });

  test("absent file ⇒ null (never reads)", async () => {
    let readCalled = false;
    const fakeApp = {
      vault: {
        configDir: ".obsidian",
        adapter: {
          exists: async () => false,
          read: async () => { readCalled = true; return "x"; },
        },
      },
    };
    const raw = await obsidianPendingReviewSource(fakeApp).read();
    assert.equal(raw, null);
    assert.equal(readCalled, false);
  });

  test("a throwing adapter degrades to null", async () => {
    const fakeApp = {
      vault: {
        configDir: ".obsidian",
        adapter: {
          exists: async () => { throw new Error("fs error"); },
          read: async () => "x",
        },
      },
    };
    assert.equal(await obsidianPendingReviewSource(fakeApp).read(), null);
  });
});
