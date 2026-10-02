// Names Obsidian Sync refuses, and names that break links: refused where a note is CREATED or RENAMED.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemBackend } from "../src/fs-backend/filesystem-backend.ts";
import { registerFsTools } from "../src/register-fs-tools.ts";
import { SYNC_UNSAFE_CHARS, syncUnsafeChars, assertSyncSafeName, assertSyncSafeMove, UnsafeNameError, inJdArchive, jdArchiveFolder, hasInboundLinks } from "../src/index.ts";

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

  test("a move may keep the note's own name and the folders it is already in (by whole path); anything new must be clean", () => {
    assert.doesNotThrow(() => assertSyncSafeMove("A/Q: x.md", "B/Q: x.md"), "a folder move keeps the old name");
    assert.doesNotThrow(() => assertSyncSafeMove("A/Q: x.md", "B/Q - x.md"), "a fix");
    assert.throws(() => assertSyncSafeMove("A/Q x.md", "B/Q: x.md"), /adds ':'/);
    assert.throws(() => assertSyncSafeMove("A/Q: x.md", "A/Q: y.md"), /adds ':'/, "a NEW name must be clean, even if the old one was not");
    assert.throws(() => assertSyncSafeMove("Inbox: misc/plain.md", "Inbox: misc/Q: why.md"), /adds ':'/);
    assert.throws(() => assertSyncSafeMove("A/Q: x.md", "New: dir/Q: x.md"), /adds ':'/);
    assert.doesNotThrow(() => assertSyncSafeMove("Inbox: misc/plain.md", "Inbox: misc/Sub/plain.md"), "the folder it is already in may stay");
    assert.throws(() => assertSyncSafeMove("Inbox: misc/plain.md", "Other/Inbox: misc/plain.md"), /adds ':'/, "a NEW folder that reuses an old folder's name is new");
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

  test("brackets (Nelson, 2026-10-02): only in the name of a note under an EXISTING JD archive folder that no other note links to", () => {
    const ARCH = "00-09 System/00 System management/00.09 Archive";
    const real = new Set([ARCH, "40-49 Financial/41 Banking/41.09 Archive for 41 Banking"]);
    const ctx = (linked) => ({ linked, folderExists: (p) => real.has(p) });
    assert.equal(inJdArchive(`${ARCH}/x.md`), true);
    assert.equal(inJdArchive("06 Repos/06.37.09 Archive for plugins/x.md"), true);
    assert.equal(inJdArchive("Projects/Archive/x.md"), false);
    assert.equal(inJdArchive("00.09 Archive.md"), false, "a note named like an archive is not in one");
    assert.equal(inJdArchive("X/00.09 Archive [tmp]/n.md"), false, "a bracketed folder is never an archive");
    assert.equal(jdArchiveFolder(`${ARCH}/Sub/x.md`), ARCH);
    // creates
    assert.doesNotThrow(() => assertSyncSafeName(`${ARCH}/[superseded] Plan.md`, ctx(false)));
    assert.throws(() => assertSyncSafeName(`${ARCH}/[superseded] Plan.md`), /never in a folder name/, "no context: refused");
    assert.throws(() => assertSyncSafeName(`${ARCH}/[superseded] Plan.md`, ctx(true)), /'\[', '\]'/, "linked: refused");
    assert.throws(() => assertSyncSafeName("Projects/99.09 Archive/[draft] Plan.md", ctx(false)), /'\[', '\]'/, "an archive the call would create does not count");
    assert.throws(() => assertSyncSafeName(`${ARCH}/[old stuff]/Plan.md`, ctx(false)), /'\[', '\]'/, "never in a folder name");
    assert.throws(() => assertSyncSafeName(`${ARCH}/Plan #2.md`, ctx(false)), /'#'/, "only [ ] are freed, never # ^ or the Sync set");
    assert.throws(() => assertSyncSafeName("Projects/[draft] Plan.md", ctx(false)), /'\[', '\]'/, "outside an archive, refused");
    // moves
    assert.doesNotThrow(() => assertSyncSafeMove("Projects/Plan.md", `${ARCH}/[superseded] Plan.md`, ctx(false)));
    assert.throws(() => assertSyncSafeMove("Projects/Plan.md", `${ARCH}/[superseded] Plan.md`, ctx(true)), /'\[', '\]'/);
    assert.throws(() => assertSyncSafeMove("Projects/Plan.md", "Projects/[old] Plan.md", ctx(false)), /'\[', '\]'/);
    // a kept bracket name may stay inside an archive (linked or not), never leave it
    assert.doesNotThrow(() => assertSyncSafeMove(`${ARCH}/[x] Plan.md`, "40-49 Financial/41 Banking/41.09 Archive for 41 Banking/[x] Plan.md", ctx(true)));
    assert.throws(() => assertSyncSafeMove(`${ARCH}/[x] Plan.md`, "Projects/[x] Plan.md", ctx(false)), /keeps '\[', '\]'/);
    // the linker test: self-links do not count
    const idx = { "A.md": { "A.md": 1 }, "B.md": { "C.md": 2 } };
    assert.equal(hasInboundLinks(idx, "A.md"), false);
    assert.equal(hasInboundLinks(idx, "C.md"), true);
    assert.equal(hasInboundLinks(undefined, "C.md"), false);
  });
});
