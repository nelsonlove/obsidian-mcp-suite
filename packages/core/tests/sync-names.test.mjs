// Names Obsidian Sync refuses, and names that break links: refused when a tool would CREATE one.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registerFsTools } from "../src/register-fs-tools.ts";
import { syncUnsafeChars, assertSyncSafeName, UnsafeNameError } from "../src/index.ts";

function harness(existing) {
  const notes = new Map(Object.entries(existing));
  const writes = [];
  const moves = [];
  const handlers = new Map();
  const server = { registerTool: (name, _meta, h) => handlers.set(name, h) };
  const backend = {
    async readNote(p) {
      if (!notes.has(p)) throw new Error(`not found: ${p}`);
      return notes.get(p);
    },
    async writeNote(p, content, overwrite) {
      writes.push(p);
      notes.set(p, content);
      return { path: p, created: true, overwrite };
    },
    async moveNote(from, to) {
      moves.push([from, to]);
      return { from, to, backlinks_updated: 0, backlinks_files_touched: 0 };
    },
  };
  registerFsTools(server, backend, {});
  return { call: (n, a) => handlers.get(n)(a), writes, moves };
}

describe("sync-unsafe names", () => {
  test("every refused character is found, in any segment; a clean path has none", () => {
    for (const c of [":", "*", "?", '"', "<", ">", "|", "#", "^", "[", "]", "\\"]) {
      assert.deepEqual(syncUnsafeChars(`A/x${c}y.md`), [c], c);
      assert.deepEqual(syncUnsafeChars(`F${c}older/x.md`), [c], `folder ${c}`);
    }
    assert.equal(syncUnsafeChars("00-09 System/03 Agents/Plan - v2 (draft) & notes.md"), null);
    assert.deepEqual(syncUnsafeChars("A/Q: why? #1.md").sort(), ["#", ":", "?"].sort());
    assert.throws(() => assertSyncSafeName("A/Q: why.md"), (e) => e instanceof UnsafeNameError && e.code === "unsafe_name" && /Obsidian Sync/.test(e.message));
    assert.doesNotThrow(() => assertSyncSafeName("A/Q - why.md"));
  });

  test("obsidian_write_note refuses a NEW note with such a name, typed, and writes nothing", async () => {
    const h = harness({});
    const res = await h.call("obsidian_write_note", { path: "Links/Site: page.md", content: "x", overwrite: false });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /^Error \[unsafe_name\]: 'Links\/Site: page.md' holds ':'/);
    assert.deepEqual(h.writes, []);
  });

  test("obsidian_write_note still writes an EXISTING note with such a name in place, and any clean name", async () => {
    const h = harness({ "Links/Old: name.md": "old" });
    const res = await h.call("obsidian_write_note", { path: "Links/Old: name.md", content: "new", overwrite: true });
    assert.equal(res.isError, undefined, res.content?.[0]?.text);
    const clean = await h.call("obsidian_write_note", { path: "Links/Site - page.md", content: "x", overwrite: false });
    assert.equal(clean.isError, undefined);
    assert.deepEqual(h.writes, ["Links/Old: name.md", "Links/Site - page.md"]);
  });

  test("obsidian_move_note refuses a destination with such a name and moves nothing; a clean one moves", async () => {
    const h = harness({ "A/Old: name.md": "x" });
    const res = await h.call("obsidian_move_note", { from: "A/Old: name.md", to: "B/Old: name.md", update_backlinks: true, overwrite: false });
    assert.match(res.content[0].text, /^Error \[unsafe_name\]/);
    assert.deepEqual(h.moves, []);
    const ok = await h.call("obsidian_move_note", { from: "A/Old: name.md", to: "B/Old - name.md", update_backlinks: true, overwrite: false });
    assert.equal(ok.isError, undefined, ok.content?.[0]?.text);
    assert.deepEqual(h.moves, [["A/Old: name.md", "B/Old - name.md"]]);
  });
});
