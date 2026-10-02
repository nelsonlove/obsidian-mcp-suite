// Names Obsidian Sync refuses, and names that break links: refused where a note is CREATED or RENAMED.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemBackend } from "../src/fs-backend/filesystem-backend.ts";
import { registerFsTools } from "../src/register-fs-tools.ts";
import { SYNC_UNSAFE_CHARS, syncUnsafeChars, assertSyncSafeName, assertSyncSafeMove, UnsafeNameError, inJdArchive, hasInboundLinks } from "../src/index.ts";

async function fsHarness(files) {
  const root = await mkdtemp(join(tmpdir(), "sync-names-"));
  for (const [p, c] of Object.entries(files)) {
    await mkdir(join(root, p, ".."), { recursive: true });
    await writeFile(join(root, p), c);
  }
  const handlers = new Map();
  registerFsTools({ registerTool: (n, _m, h) => handlers.set(n, h) }, new FilesystemBackend(root), {});
  return { root, call: (n, a) => handlers.get(n)(a) };
}

describe("sync-unsafe names", () => {
  test("every refused character is found, in any segment; a clean path has none; the exported pattern is safe to reuse", () => {
    for (const c of [":", "*", "?", '"', "<", ">", "|", "#", "^", "[", "]", "\\"]) {
      assert.deepEqual(syncUnsafeChars(`A/x${c}y.md`), [c], c);
      assert.deepEqual(syncUnsafeChars(`F${c}older/x.md`), [c], `folder ${c}`);
    }
    assert.equal(syncUnsafeChars("00-09 System/03 Agents/Plan - v2 (draft) & notes.md"), null);
    assert.deepEqual(syncUnsafeChars("A/Q: why? #1.md").sort(), ["#", ":", "?"].sort());
    assert.equal(SYNC_UNSAFE_CHARS.test("A: b"), true);
    assert.equal(SYNC_UNSAFE_CHARS.test("C: d"), true, "no global lastIndex carried between calls");
    assert.throws(() => assertSyncSafeName("A/Q: why.md"), (e) => e instanceof UnsafeNameError && e.code === "unsafe_name" && /Obsidian Sync/.test(e.message));
    assert.doesNotThrow(() => assertSyncSafeName("A/Q - why.md"));
  });

  test("a move may keep a refused character the note already had, never add one", () => {
    assert.doesNotThrow(() => assertSyncSafeMove("A/Q: x.md", "B/Q: x.md"), "a folder move keeps the old name");
    assert.doesNotThrow(() => assertSyncSafeMove("A/Q: x.md", "B/Q - x.md"), "a fix");
    assert.throws(() => assertSyncSafeMove("A/Q x.md", "B/Q: x.md"), /adds ':'/);
    assert.throws(() => assertSyncSafeMove("A/Q: x.md", "B/[old] Q: x.md"), /adds '\[', '\]'/);
    // Per segment: a refused character elsewhere in the old path does not license a NEW name or folder.
    assert.throws(() => assertSyncSafeMove("Inbox: misc/plain.md", "Inbox: misc/Q: why.md"), /adds ':'/);
    assert.throws(() => assertSyncSafeMove("A/Q: x.md", "New: dir/Q: x.md"), /adds ':'/);
    assert.doesNotThrow(() => assertSyncSafeMove("Inbox: misc/plain.md", "Inbox: misc/Sub/plain.md"), "the folder it is already in may stay");
  });

  test("filesystem server: write_note refuses a NEW such name and writes nothing; an existing one is written in place", async () => {
    const h = await fsHarness({ "Links/Old: name.md": "old" });
    const res = await h.call("obsidian_write_note", { path: "Links/Site: page.md", content: "x", overwrite: false });
    assert.match(res.content[0].text, /^Error \[unsafe_name\]: 'Links\/Site: page.md' holds ':'/);
    assert.deepEqual((await readdir(join(h.root, "Links"))).sort(), ["Old: name.md"]);
    const kept = await h.call("obsidian_write_note", { path: "Links/Old: name.md", content: "new", overwrite: true });
    assert.equal(kept.isError, undefined, kept.content?.[0]?.text);
  });

  test("filesystem server: append_note refuses to CREATE such a note; appending to an existing one works", async () => {
    const h = await fsHarness({ "L/Old: one.md": "a" });
    const res = await h.call("obsidian_append_note", { path: "L/New: one.md", content: "x" });
    assert.match(res.content[0].text, /^Error \[unsafe_name\]/);
    const kept = await h.call("obsidian_append_note", { path: "L/Old: one.md", content: "b" });
    assert.equal(kept.isError, undefined, kept.content?.[0]?.text);
  });

  test("filesystem server: move_note refuses a destination that adds such a character, and moves nothing", async () => {
    const h = await fsHarness({ "A/Plain.md": "x" });
    const res = await h.call("obsidian_move_note", { from: "A/Plain.md", to: "B/Plain: v2.md", update_backlinks: true, overwrite: false });
    assert.match(res.content[0].text, /^Error \[unsafe_name\]/);
    assert.deepEqual(await readdir(join(h.root, "A")), ["Plain.md"]);
  });

  test("brackets (Nelson, 2026-10-02): only under a JD archive folder, and only for a note no other note links to", () => {
    const ARCH = "00-09 System/00 System management/00.09 Archive";
    assert.equal(inJdArchive(`${ARCH}/x.md`), true);
    assert.equal(inJdArchive("40-49 Financial/41 Banking/41.09 Archive for 41 Banking/x.md"), true);
    assert.equal(inJdArchive("06 Repos/06.37.09 Archive for plugins/x.md"), true);
    assert.equal(inJdArchive("Projects/Archive/x.md"), false);
    assert.equal(inJdArchive("00.09 Archive.md"), false, "a note named like an archive is not in one");
    // a new note in an archive has no linkers
    assert.doesNotThrow(() => assertSyncSafeName(`${ARCH}/[superseded] Plan.md`, false));
    assert.throws(() => assertSyncSafeName(`${ARCH}/[superseded] Plan.md`), /allowed only for a note under a JD archive folder/, "unknown linkers count as linked");
    assert.throws(() => assertSyncSafeName("Projects/[draft] Plan.md", false), /'\[', '\]'/, "outside an archive, refused");
    assert.throws(() => assertSyncSafeName(`${ARCH}/Plan #2.md`, false), /'#'/, "only [ ] are freed, never # ^ or the Sync set");
    // a move into an archive, unlinked: allowed; linked: refused
    assert.doesNotThrow(() => assertSyncSafeMove("Projects/Plan.md", `${ARCH}/[superseded] Plan.md`, false));
    assert.throws(() => assertSyncSafeMove("Projects/Plan.md", `${ARCH}/[superseded] Plan.md`, true), /no other note links to/);
    assert.throws(() => assertSyncSafeMove("Projects/Plan.md", "Projects/[old] Plan.md", false), /'\[', '\]'/);
    // the linker test: self-links do not count
    const idx = { "A.md": { "A.md": 1 }, "B.md": { "C.md": 2 } };
    assert.equal(hasInboundLinks(idx, "A.md"), false);
    assert.equal(hasInboundLinks(idx, "C.md"), true);
    assert.equal(hasInboundLinks(undefined, "C.md"), false);
  });
});
