/**
 * truncated-read.test.mjs — the host's half of #441: a cut read never becomes
 * a cut write over the REAL ObsidianBackend (fake app), driven through the
 * same registerFsTools the live server uses, with a rev source present.
 *
 * The filesystem half is packages/core/tests/truncated-read.test.mjs; this
 * file pins that the Obsidian backend's own write, patch and append paths
 * carry the same guard, and that the read tool withholds the rev on a cut.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { installObsidianStub, TFile } from "./obsidian-stub.mjs";

installObsidianStub();
const { ObsidianBackend } = await import("../src/mcp/obsidian-backend.ts");
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
      getFileCache: (f) => ({ headings: [{ heading: "Big", level: 1, position: { start: { offset: 20 }, end: { offset: 25 } } }] }),
    },
    fileManager: { processFrontMatter: async () => {} },
  };
  return { app, store };
}

function fakeServer() {
  const handlers = new Map();
  return {
    registerTool(name, meta, handler) { handlers.set(name, handler); return { name, meta }; },
    call(name, args) { return handlers.get(name)(args); },
  };
}

function fixture() {
  const { app, store } = fakeApp({ "Big.md": BODY, "Small.md": "# Small" });
  const backend = new ObsidianBackend(app, () => null);
  const server = fakeServer();
  registerFsTools(server, backend, { rev: (p) => (store.has(p) ? 1700 : undefined) });
  return { backend, server, store };
}

describe("obsidian_read_note over the Obsidian backend", () => {
  test("a cut read carries truncated: true and no rev; an uncut one keeps its rev", async () => {
    const { server } = fixture();
    const big = (await server.call("obsidian_read_note", { path: "Big.md" })).structuredContent;
    assert.equal(big.truncated, true);
    assert.equal("rev" in big, false);
    assert.ok(big.content.length > CHARACTER_LIMIT && big.content.length < LONG);
    const small = (await server.call("obsidian_read_note", { path: "Small.md" })).structuredContent;
    assert.deepEqual(small, { path: "Small.md", content: "# Small", rev: 1700 });
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

  test("a note that merely mentions the trailer inline is still writable", async () => {
    const { backend, store } = fixture();
    const prose = "# Note\n\nThe read tool appends `[truncated: note is N chars, showing first 100000]` to a long note.\n";
    await backend.writeNote("Prose.md", prose, false);
    assert.equal(store.get("Prose.md"), prose);
  });
});
