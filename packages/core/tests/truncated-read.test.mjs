/**
 * truncated-read.test.mjs — a cut read never becomes a cut write (#441).
 *
 * `readNote` returns only the first CHARACTER_LIMIT characters of a longer
 * note and appends `[truncated: note is N chars, showing first LIMIT]`. On
 * 2026-09-30 three vault notes lost their tails because a caller read one,
 * edited the text it got back, and wrote it with `write_note` — `if_rev`
 * matched, so nothing stopped it. Two guards close that road, both proven
 * here over the REAL FilesystemBackend on a temp vault:
 *
 *   1. every whole-note write path (write, patch, append, and the batch that
 *      drives them) refuses content carrying the trailer line, with
 *      `Error [truncated_read]`, and the note on disk is untouched;
 *   2. a cut read carries `truncated: true` beside its `rev` (an anchored edit
 *      of a long note needs the rev; the content is what is refused);
 *   3. the host's interception check, `cutReadRefusal`, finds a cut read in
 *      any `content`/`body` argument, at any depth, before the queue.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FilesystemBackend } from "../src/fs-backend/filesystem-backend.ts";
import { registerFsTools } from "../src/register-fs-tools.ts";
import { CHARACTER_LIMIT } from "../src/fs-backend/vault.ts";
import { TRUNCATION_TRAILER_RE, cutReadRefusal } from "../src/truncation.ts";

const LONG = 150_000;
const BODY = "# Big\n\n" + "x".repeat(LONG - 7 - 10) + "\n\n## Tail\n"; // > CHARACTER_LIMIT

function fakeServer() {
  const handlers = new Map();
  return {
    registerTool(name, meta, handler) { handlers.set(name, handler); return { name, meta }; },
    call(name, args) { return handlers.get(name)(args); },
  };
}

async function fixture() {
  const vaultRoot = await mkdtemp(join(tmpdir(), "vault-441-"));
  const backend = new FilesystemBackend(vaultRoot);
  await backend.writeNote("Big.md", BODY, false);
  const server = fakeServer();
  registerFsTools(server, backend, { rev: () => 1700 });
  return { vaultRoot, backend, server };
}

const errorText = (res) => (res.isError ? res.content[0].text : "");

describe("a cut read carries truncated: true beside its rev", () => {
  test("obsidian_read_note", async () => {
    const { server } = await fixture();
    const res = await server.call("obsidian_read_note", { path: "Big.md" });
    const sc = res.structuredContent;
    assert.equal(sc.truncated, true);
    assert.equal(sc.rev, 1700, "the rev is good for an anchored edit of the long note");
    assert.match(sc.content, TRUNCATION_TRAILER_RE);
    assert.ok(sc.content.length > CHARACTER_LIMIT && sc.content.length < LONG);
  });

  test("obsidian_read_notes", async () => {
    const { server, backend } = await fixture();
    await backend.writeNote("Small.md", "# Small", false);
    const res = await server.call("obsidian_read_notes", { paths: ["Big.md", "Small.md"] });
    const [big, small] = res.structuredContent.notes;
    assert.equal(big.truncated, true);
    assert.equal(big.rev, 1700);
    assert.equal(small.truncated, false);
    assert.equal(small.rev, 1700, "an uncut note in the same batch keeps its rev");
  });

  test("an uncut note carries its rev and truncated: false", async () => {
    const { server, backend } = await fixture();
    await backend.writeNote("Small.md", "# Small", false);
    const res = await server.call("obsidian_read_note", { path: "Small.md" });
    assert.deepEqual(res.structuredContent, { path: "Small.md", content: "# Small", rev: 1700, truncated: false });
  });
});

describe("a backend that does not cut", () => {
  test("a long note returned whole reads as NOT cut and keeps its rev", async () => {
    const server = fakeServer();
    registerFsTools(server, { async readNote() { return BODY; } }, { rev: () => 1700 });
    const res = await server.call("obsidian_read_note", { path: "Big.md" });
    assert.deepEqual(res.structuredContent, { path: "Big.md", content: BODY, rev: 1700, truncated: false });
  });

  test("a long read cut with a FOREIGN trailer is not reported as cut — only truncateForRead's trailer is", async () => {
    const server = fakeServer();
    const foreign = BODY.slice(0, CHARACTER_LIMIT) + "\n\n[cut at 100000 of 150000]";
    registerFsTools(server, { async readNote() { return foreign; } }, { rev: () => 1700 });
    const res = await server.call("obsidian_read_note", { path: "Big.md" });
    assert.equal(res.structuredContent.truncated, false);
  });
});

describe("a 150k note survives a read → write round trip", () => {
  test("write_note with the cut content is refused and the note is intact", async () => {
    const { server, vaultRoot } = await fixture();
    const read = await server.call("obsidian_read_note", { path: "Big.md" });
    const edited = read.structuredContent.content.replace("# Big", "# Big (edited)");
    const res = await server.call("obsidian_write_note", { path: "Big.md", content: edited, overwrite: true });
    assert.equal(res.isError, true);
    assert.match(errorText(res), /^Error \[truncated_read\]:/);
    assert.equal(await readFile(join(vaultRoot, "Big.md"), "utf8"), BODY);
  });

  test("backend.writeNote, patchNote and appendNote refuse the trailer line", async () => {
    const { backend, vaultRoot } = await fixture();
    const cut = await backend.readNote("Big.md");
    await assert.rejects(backend.writeNote("Big.md", cut, true), { code: "truncated_read" });
    await assert.rejects(
      backend.patchNote("Big.md", { type: "heading", value: "Big" }, "replace", cut),
      { code: "truncated_read" },
    );
    await assert.rejects(backend.appendNote("Big.md", "\n" + cut), { code: "truncated_read" });
    // A NEW note made of a cut read is refused too: the tail is lost either way.
    await assert.rejects(backend.writeNote("Copy.md", cut, false), { code: "truncated_read" });
    assert.equal(await readFile(join(vaultRoot, "Big.md"), "utf8"), BODY);
  });

  test("the refusal says what happened and where to go", async () => {
    const { backend } = await fixture();
    const cut = await backend.readNote("Big.md");
    await assert.rejects(backend.writeNote("Big.md", cut, true), (e) => {
      assert.match(e.message, /cut read/);
      assert.match(e.message, /Nothing was written/);
      assert.match(e.message, /obsidian_patch_note/);
      return true;
    });
  });

  test("a small append and a small patch to the long note still land, tail intact", async () => {
    const { backend, vaultRoot } = await fixture();
    await backend.appendNote("Big.md", "\nmore\n");
    const patched = await backend.patchNote("Big.md", { type: "heading", value: "Tail" }, "append", "under the tail");
    assert.equal(patched.found, true);
    const disk = await readFile(join(vaultRoot, "Big.md"), "utf8");
    assert.ok(disk.startsWith(BODY.slice(0, LONG - 20)), "the head is untouched");
    assert.match(disk, /## Tail\n[\s\S]*more[\s\S]*under the tail/);
    assert.ok(disk.length > LONG, "nothing was cut");
  });

  test("a padded or CR-terminated trailer line is still refused", async () => {
    const { backend } = await fixture();
    const cut = await backend.readNote("Big.md");
    await assert.rejects(backend.writeNote("Pad.md", cut + "  ", false), { code: "truncated_read" });
    await assert.rejects(backend.writeNote("Crlf.md", cut.replace(/\n/g, "\r\n"), false), { code: "truncated_read" });
    await assert.rejects(backend.writeNote("Below.md", cut + "\n\n## History\n\n- appended below the cut\n", false), { code: "truncated_read" });
  });

  test("a note carrying a trailer-shaped line reads as NOT cut, stays editable, and heals as a backlink source", async () => {
    // The guard runs over the text the CALLER supplies, never over the note
    // that would result. Creating this note through the backend is refused
    // (a line that IS the trailer, with digits, wherever it stands — a doc
    // writes N and M instead); on disk it is an ordinary note: it reads uncut
    // with its rev, takes an append and a patch, and a move of the note it
    // links to rewrites the link in it.
    const { server, backend, vaultRoot } = await fixture();
    const quoted = "# Doc\n\n```\n[truncated: note is 123456 chars, showing first 100000]\n```\n\nSee [[Target]].\n";
    await assert.rejects(backend.writeNote("Doc.md", quoted, false), { code: "truncated_read" });
    const lettered = quoted.replace("123456", "N").replace("100000", "M").replace("See [[Target]].", "No link here.");
    await backend.writeNote("Lettered.md", lettered, false);
    await (await import("node:fs/promises")).writeFile(join(vaultRoot, "Doc.md"), quoted);
    const res = await server.call("obsidian_read_note", { path: "Doc.md" });
    assert.deepEqual(res.structuredContent, { path: "Doc.md", content: quoted, rev: 1700, truncated: false });
    await backend.appendNote("Doc.md", "\nmore\n");
    const patched = await backend.patchNote("Doc.md", { type: "heading", value: "Doc" }, "prepend", "first");
    assert.equal(patched.found, true);
    await backend.writeNote("Target.md", "# Target", false);
    await backend.forceReindex();
    const moved = await backend.moveNote("Target.md", "Moved.md", { update_backlinks: true, overwrite: false });
    assert.equal(moved.backlinks_files_touched, 1);
    const disk = await readFile(join(vaultRoot, "Doc.md"), "utf8");
    assert.match(disk, /\[\[Moved\]\]/, "the backlink in the note was healed");
    assert.match(disk, /more/);
    assert.match(disk, /first/);
  });

  test("a cut inside a code fence is refused whether the caller leaves the fence open, closes it, or appends a fenced block", async () => {
    const { backend } = await fixture();
    const cutInFence = "# Note\n\n```\ncode that was cut here\n\n[truncated: note is 150000 chars, showing first 100000]";
    await assert.rejects(backend.writeNote("Open.md", cutInFence, false), { code: "truncated_read" });
    await assert.rejects(backend.writeNote("Closed.md", cutInFence + "\n```\nmy new prose\n", false), { code: "truncated_read" });
    await assert.rejects(backend.writeNote("Block.md", cutInFence + "\n\n```\nexample\n```\n", false), { code: "truncated_read" });
  });

  test("cutReadRefusal finds a cut read under content or body, names the path, and says the way out", async () => {
    const { backend } = await fixture();
    const cut = await backend.readNote("Big.md");
    assert.equal(cutReadRefusal({ path: "A.md", content: "fine" }), null);
    assert.equal(cutReadRefusal({ path: "A.md", body: "fine" }), null);
    const top = cutReadRefusal({ path: "Big.md", content: cut, overwrite: true });
    assert.equal(top?.code, "truncated_read");
    assert.match(top.message, /'Big.md'/);
    assert.match(top.message, /letters \(N, M\)/, "the message tells a deliberate quoter the way out");
    const body = cutReadRefusal({ body: cut });
    assert.equal(body?.code, "truncated_read");
    assert.match(body.message, /'the target'/);
    // Text under another key is not the caller's note text.
    assert.equal(cutReadRefusal({ path: "A.md", intent: cut }), null);
  });

  test("deleting the trailer line before writing back is refused too — the note on disk is longer than any read of it", async () => {
    const { server, backend, vaultRoot } = await fixture();
    const read = (await server.call("obsidian_read_note", { path: "Big.md" })).structuredContent;
    assert.equal(read.truncated, true);
    const stripped = read.content.replace(/\n\n\[truncated:[^\n]*$/, "").replace("# Big", "# Big (edited)");
    assert.equal(stripped.includes("[truncated:"), false);
    const res = await server.call("obsidian_write_note", { path: "Big.md", content: stripped, overwrite: true });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /^Error \[truncated_read\]:/);
    assert.match(res.content[0].text, /no read returned that note whole/);
    assert.equal(await readFile(join(vaultRoot, "Big.md"), "utf8"), BODY);
    // Same guard, direct: a deliberate short overwrite of a long note.
    await assert.rejects(backend.writeNote("Big.md", "# Replaced\n", true), { code: "truncated_read" });
    assert.equal(await readFile(join(vaultRoot, "Big.md"), "utf8"), BODY);
  });

  test("a rewrite from the whole note lands, and a short note is overwritten freely", async () => {
    const { backend, vaultRoot } = await fixture();
    const whole = (await readFile(join(vaultRoot, "Big.md"), "utf8")).replace("# Big", "# Big (edited)");
    await backend.writeNote("Big.md", whole, true);
    assert.equal(await readFile(join(vaultRoot, "Big.md"), "utf8"), whole);
    await backend.writeNote("Small.md", "# Small", false);
    await backend.writeNote("Small.md", "# S", true);
    assert.equal(await readFile(join(vaultRoot, "Small.md"), "utf8"), "# S");
  });

  test("a note that merely mentions the trailer inline is still writable", async () => {
    const { backend } = await fixture();
    const prose = "# Note\n\nThe read tool appends `[truncated: note is N chars, showing first 100000]` to a long note.\n";
    await backend.writeNote("Prose.md", prose, false);
    assert.equal(await backend.readNote("Prose.md"), prose);
  });
});
