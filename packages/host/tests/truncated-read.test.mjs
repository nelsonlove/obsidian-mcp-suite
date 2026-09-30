/**
 * truncated-read.test.mjs — the host's half of #441: a cut read never becomes
 * a cut write over the REAL ObsidianBackend (fake app), driven through the
 * same registerFsTools the live server uses, with a rev source present.
 *
 * The filesystem half is packages/core/tests/truncated-read.test.mjs; this
 * file pins that the Obsidian backend's own write, patch and append paths
 * carry the same guard as the last line, that the read tool flags a cut
 * read, and — through the REAL makeGuarded, the way server.ts registers
 * every tool — that the guard's cutReadError refuses a cut read handed to
 * a tool with no check of its own (obsidian_append_at_heading) before its
 * handler runs.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { installObsidianStub, TFile } from "./obsidian-stub.mjs";

installObsidianStub();
const { ObsidianBackend } = await import("../src/mcp/obsidian-backend.ts");
const { registerComplementaryTools } = await import("../src/mcp/tools-complementary.ts");
const { makeGuarded } = await import("../src/mcp/guarded.ts");

const ACTOR = { transport: "mcp", client: "claude-code/1.0.0", connection: "conn-1" };
const OPEN_SETTINGS = { readOnly: false, allowlist: [] };
const { registerFsTools, CHARACTER_LIMIT } = await import("@vault-mcp/core");

const LONG = 150_000;
const BODY = "---\ntitle: Big\n---\n# Big\n\n" + "x".repeat(LONG - 40) + "\n\n## Tail\n";

function fakeApp(files) {
  const store = new Map(Object.entries(files));
  const app = {
    vault: {
      getAbstractFileByPath: (p) => (store.has(p) ? new TFile(p, 1700) : null),
      read: async (f) => store.get(f.path) ?? "",
      cachedRead: async (f) => store.get(f.path) ?? "",
      create: async (p, c) => { store.set(p, c); },
      modify: async (f, c) => { store.set(f.path, c); },
      append: async (f, c) => { store.set(f.path, (store.get(f.path) ?? "") + c); },
      createFolder: async () => {},
      getMarkdownFiles: () => [...store.keys()].map((p) => new TFile(p, 1700)),
    },
    metadataCache: {
      resolvedLinks: {},
      getFileCache: (f) => {
        const text = store.get(f.path) ?? "";
        const headings = [];
        const re = /^(#+) (.+)$/gm;
        let m;
        while ((m = re.exec(text))) {
          headings.push({ heading: m[2], level: m[1].length, position: { start: { offset: m.index }, end: { offset: m.index + m[0].length } } });
        }
        return { headings };
      },
    },
    fileManager: { processFrontMatter: async () => {} },
  };
  return { app, store };
}

/** Registrations pass through the real guard, as server.ts's monkeypatch
 *  does; with no kernel the guard still runs its argument checks. */
function fakeServer(store) {
  const handlers = new Map();
  const guarded = makeGuarded({
    getSettings: () => OPEN_SETTINGS,
    kernel: null,
    actor: () => ACTOR,
    noteLength: async (p) => store.get(p)?.length,
  });
  return {
    registerTool(name, meta, handler) { handlers.set(name, guarded(meta, handler, name)); return { name, meta }; },
    call(name, args) { return handlers.get(name)(args, {}); },
  };
}

function fixture() {
  const { app, store } = fakeApp({ "Big.md": BODY, "Small.md": "# Small" });
  const backend = new ObsidianBackend(app, () => null);
  const server = fakeServer(store);
  registerFsTools(server, backend, { rev: (p) => (store.has(p) ? 1700 : undefined) });
  registerComplementaryTools(server, app, { getSettings: () => ({ allowlist: [] }) });
  return { backend, server, store };
}

describe("obsidian_read_note over the Obsidian backend", () => {
  test("a cut read carries truncated: true beside its rev; every read carries truncated", async () => {
    const { server } = fixture();
    const big = (await server.call("obsidian_read_note", { path: "Big.md" })).structuredContent;
    assert.equal(big.truncated, true);
    assert.equal(big.rev, 1700);
    assert.ok(big.content.length > CHARACTER_LIMIT && big.content.length < LONG);
    const small = (await server.call("obsidian_read_note", { path: "Small.md" })).structuredContent;
    assert.deepEqual(small, { path: "Small.md", content: "# Small", rev: 1700, truncated: false });
  });
});

describe("a 150k note survives a read → write round trip", () => {
  test("obsidian_write_note with the cut content is refused; the note is intact", async () => {
    const { server, store } = fixture();
    const cut = (await server.call("obsidian_read_note", { path: "Big.md" })).structuredContent.content;
    const res = await server.call("obsidian_write_note", { path: "Big.md", content: cut.replace("# Big", "# Big (edited)"), overwrite: true });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /^Error \[truncated_read\]:/);
    assert.equal(store.get("Big.md"), BODY);
  });

  test("deleting the trailer line and adding text before writing back is refused by the guard; a whole-note overwrite of a long note never lands over MCP", async () => {
    const { server, backend, store } = fixture();
    const read = (await server.call("obsidian_read_note", { path: "Big.md" })).structuredContent;
    const stripped = read.content.replace(/\n\n\[truncated:[^\n]*$/, "") + "\n\nA new paragraph of more than fifty-seven characters, added after the cut.\n";
    const res = await server.call("obsidian_write_note", { path: "Big.md", content: stripped, overwrite: true });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /^Error \[truncated_read\]:[\s\S]*never overwritten whole over MCP/);
    assert.equal(store.get("Big.md"), BODY);
    const whole = BODY.replace("# Big", "# Big (edited)");
    const again = await server.call("obsidian_write_note", { path: "Big.md", content: whole, overwrite: true });
    assert.equal(again.isError, true, "over MCP, even the whole note back is refused: never overwritten whole");
    assert.equal(store.get("Big.md"), BODY);
    // A direct backend caller is bound only by the trailer check.
    await backend.writeNote("Big.md", whole, true);
    assert.equal(store.get("Big.md"), whole);
    // A short note is overwritten freely.
    const small = await server.call("obsidian_write_note", { path: "Small.md", content: "# S", overwrite: true });
    assert.equal(small.isError, undefined);
  });

  test("backend.writeNote, patchNote and appendNote refuse the trailer line", async () => {
    const { backend, store } = fixture();
    const cut = await backend.readNote("Big.md");
    await assert.rejects(backend.writeNote("Big.md", cut, true), { code: "truncated_read" });
    await assert.rejects(backend.writeNote("Copy.md", cut, false), { code: "truncated_read" });
    await assert.rejects(
      backend.patchNote("Big.md", { type: "heading", value: "Big" }, "replace", cut),
      { code: "truncated_read" },
    );
    await assert.rejects(backend.appendNote("Big.md", "\n" + cut), { code: "truncated_read" });
    await assert.rejects(backend.appendNote("New.md", cut), { code: "truncated_read" });
    assert.equal(store.get("Big.md"), BODY);
    assert.equal(store.has("Copy.md"), false);
    assert.equal(store.has("New.md"), false);
  });

  test("obsidian_append_at_heading refuses a cut read on all three of its paths — by the guard, before the handler", async () => {
    const { server, store } = fixture();
    const cut = await (await server.call("obsidian_read_note", { path: "Big.md" })).structuredContent.content;
    const refused = (res) => res.isError === true && /^Error \[truncated_read\]/.test(res.content[0].text);
    // existing section
    assert.ok(refused(await server.call("obsidian_append_at_heading", { path: "Big.md", heading: "Tail", content: cut, create_if_missing: false })));
    // new heading on an existing note
    assert.ok(refused(await server.call("obsidian_append_at_heading", { path: "Small.md", heading: "Pasted", content: cut, create_if_missing: true })));
    // new note
    assert.ok(refused(await server.call("obsidian_append_at_heading", { path: "New.md", heading: "Pasted", content: cut, create_if_missing: true })));
    assert.equal(store.get("Big.md"), BODY);
    assert.equal(store.get("Small.md"), "# Small");
    assert.equal(store.has("New.md"), false);
  });

  test("a small append, patch and append_at_heading on the long note still land, tail intact", async () => {
    const { backend, server, store } = fixture();
    await backend.appendNote("Big.md", "\nmore\n");
    const patched = await backend.patchNote("Big.md", { type: "heading", value: "Tail" }, "append", "under the tail");
    assert.equal(patched.found, true);
    const res = await server.call("obsidian_append_at_heading", { path: "Big.md", heading: "Tail", content: "at the heading", create_if_missing: false });
    assert.equal(res.isError, undefined);
    const text = store.get("Big.md");
    assert.ok(text.startsWith(BODY.slice(0, LONG - 40)), "the head is untouched");
    assert.match(text, /## Tail\n[\s\S]*(more|under the tail|at the heading)/);
    assert.ok(text.length > LONG, "nothing was cut");
  });

  test("a replace whose section runs past the limit on the long note is refused; append and prepend land", async () => {
    const { backend, store } = fixture();
    await assert.rejects(
      backend.patchNote("Big.md", { type: "heading", value: "Big" }, "replace", "# Big (stripped cut read)\n"),
      { code: "truncated_read" },
    );
    assert.equal(store.get("Big.md"), BODY);
    assert.equal((await backend.patchNote("Big.md", { type: "heading", value: "Big" }, "prepend", "first")).found, true);
    assert.equal((await backend.patchNote("Big.md", { type: "heading", value: "Tail" }, "append", "last")).found, true);
    assert.match(store.get("Big.md"), /first[\s\S]*## Tail[\s\S]*last/);
  });

  test("a note already carrying a trailer-shaped line stays editable by append and patch", async () => {
    const { backend, store } = fixture();
    const quoted = "# Doc\n\n```\n[truncated: note is 123456 chars, showing first 100000]\n```\n";
    store.set("Doc.md", quoted);
    await backend.appendNote("Doc.md", "\nmore\n");
    const patched = await backend.patchNote("Doc.md", { type: "heading", value: "Doc" }, "prepend", "first");
    assert.equal(patched.found, true);
    assert.match(store.get("Doc.md"), /first[\s\S]*more/);
  });

  test("a note that merely mentions the trailer inline is still writable", async () => {
    const { backend, store } = fixture();
    const prose = "# Note\n\nThe read tool appends `[truncated: note is N chars, showing first M]` to a long note.\n";
    await backend.writeNote("Prose.md", prose, false);
    assert.equal(store.get("Prose.md"), prose);
  });
});
