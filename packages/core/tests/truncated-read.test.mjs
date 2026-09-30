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
 *   2. a cut read carries `truncated: true` and NO `rev`, so the write that
 *      would follow it fails loudly even if the caller strips the trailer.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FilesystemBackend } from "../src/fs-backend/filesystem-backend.ts";
import { registerFsTools } from "../src/register-fs-tools.ts";
import { CHARACTER_LIMIT } from "../src/fs-backend/vault.ts";

const LONG = 150_000;
const BODY = "# Big\n\n" + "x".repeat(LONG - 7 - 10) + "\n\n## Tail\n"; // > CHARACTER_LIMIT
const TRAILER_RE = /^\[truncated: note is \d+ chars, showing first \d+\]$/m;

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

describe("a cut read carries truncated: true and no rev", () => {
  test("obsidian_read_note", async () => {
    const { server } = await fixture();
    const res = await server.call("obsidian_read_note", { path: "Big.md" });
    const sc = res.structuredContent;
    assert.equal(sc.truncated, true);
    assert.equal("rev" in sc, false, "a cut read must not hand out a writable rev");
    assert.match(sc.content, TRAILER_RE);
    assert.ok(sc.content.length > CHARACTER_LIMIT && sc.content.length < LONG);
  });

  test("obsidian_read_notes", async () => {
    const { server, backend } = await fixture();
    await backend.writeNote("Small.md", "# Small", false);
    const res = await server.call("obsidian_read_notes", { paths: ["Big.md", "Small.md"] });
    const [big, small] = res.structuredContent.notes;
    assert.equal(big.truncated, true);
    assert.equal("rev" in big, false);
    assert.equal(small.truncated, false);
    assert.equal(small.rev, 1700, "an uncut note in the same batch keeps its rev");
  });

  test("an uncut note still carries its rev, in the exact old shape", async () => {
    const { server, backend } = await fixture();
    await backend.writeNote("Small.md", "# Small", false);
    const res = await server.call("obsidian_read_note", { path: "Small.md" });
    assert.deepEqual(res.structuredContent, { path: "Small.md", content: "# Small", rev: 1700 });
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

  test("a note that merely mentions the trailer inline is still writable", async () => {
    const { backend } = await fixture();
    const prose = "# Note\n\nThe read tool appends `[truncated: note is N chars, showing first 100000]` to a long note.\n";
    await backend.writeNote("Prose.md", prose, false);
    assert.equal(await backend.readNote("Prose.md"), prose);
  });
});
