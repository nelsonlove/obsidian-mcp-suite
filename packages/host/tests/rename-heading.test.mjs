/**
 * rename-heading.test.mjs — `obsidian_rename_heading` (#424; Nelson, 2026-09-29:
 * "agents need to understand that renaming a heading using that tool is
 * preferable because it rewrites links").
 *
 * Pins the pure rules (rename-heading.ts) and the real handler over a fake app
 * whose metadata cache is built from the notes' own text, so every position the
 * handler uses is the one the text actually has.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installObsidianStub, TFile } from "./obsidian-stub.mjs";
import { headingKey, newHeadingRefusal, rewriteLinkOriginal, rewriteHeadingLine, applyEdits } from "../src/mcp/rename-heading.ts";

installObsidianStub();
const { registerVaultWriteTools } = await import("../src/mcp/tools-vault-write.ts");

// ── the pure rules ────────────────────────────────────────────────────────────
describe("rename-heading rules", () => {
  test("rewriteLinkOriginal: wikilinks, embeds, same-note links, aliases, chains and markdown links; only the matching segment changes", () => {
    const r = (o) => rewriteLinkOriginal(o, "Old heading", "New name");
    assert.equal(r("[[A#Old heading]]"), "[[A#New name]]");
    assert.equal(r("[[A#old  HEADING|alias]]"), "[[A#New name|alias]]", "case and whitespace do not matter to the match; the alias stays");
    assert.equal(r("![[A#Old heading]]"), "![[A#New name]]");
    assert.equal(r("[[#Old heading]]"), "[[#New name]]");
    assert.equal(r("[[A#Title#Old heading]]"), "[[A#Title#New name]]", "only the segment naming the heading changes");
    assert.equal(r("[t](A.md#Old%20heading)"), "[t](A.md#New%20name)");
    assert.equal(r("[t](<A.md#Old%20heading>)"), "[t](<A.md#New%20name>)");
    assert.equal(r("[[A#Other]]"), null, "a link to another heading is left alone");
    assert.equal(r("[[A]]"), null);
  });
  test("newHeadingRefusal: empty, padded, link syntax, unchanged", () => {
    assert.match(newHeadingRefusal("a", " "), /empty/);
    assert.match(newHeadingRefusal("a", " b"), /whitespace/);
    for (const bad of ["a[b", "a]b", "a|b", "a#b", "a^b", "a\nb"]) assert.match(newHeadingRefusal("a", bad), /cannot carry/, JSON.stringify(bad));
    assert.match(newHeadingRefusal("a", "a"), /same/);
    assert.equal(newHeadingRefusal("a", "b: c (d)"), null);
  });
  test("rewriteHeadingLine keeps the level and drops closing hashes; a different line is refused", () => {
    assert.equal(rewriteHeadingLine("## Old heading", "Old heading", "New"), "## New");
    assert.equal(rewriteHeadingLine("### Old heading ###", "Old heading", "New"), "### New");
    assert.equal(rewriteHeadingLine("## Other", "Old heading", "New"), null);
    assert.equal(rewriteHeadingLine("Old heading", "Old heading", "New"), null);
  });
  test("applyEdits verifies each position and refuses a stale or overlapping edit", () => {
    assert.equal(applyEdits("abc def", [{ start: 4, end: 7, expected: "def", replacement: "XY" }, { start: 0, end: 3, expected: "abc", replacement: "Q" }]), "Q XY");
    assert.equal(applyEdits("abc def", [{ start: 4, end: 7, expected: "zzz", replacement: "XY" }]), null);
    assert.equal(applyEdits("abcdef", [{ start: 0, end: 4, expected: "abcd", replacement: "" }, { start: 2, end: 6, expected: "cdef", replacement: "" }]), null);
    assert.equal(headingKey("  Old   Heading "), "old heading");
  });
});

// ── the handler over a fake vault ─────────────────────────────────────────────
function cacheOf(text) {
  const lineOf = (off) => text.slice(0, off).split("\n").length - 1;
  const pos = (s, e) => ({ start: { line: lineOf(s), offset: s }, end: { line: lineOf(e), offset: e } });
  const headings = [], links = [], embeds = [], frontmatterLinks = [];
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const bodyStart = fm ? fm[0].length : 0;
  if (fm) for (const m of fm[1].matchAll(/^(\w+):\s*"(\[\[([^\]|]+)(?:\|[^\]]*)?\]\])"/gm)) frontmatterLinks.push({ key: m[1], link: m[3], original: m[2] });
  const body = text.slice(bodyStart);
  for (const m of body.matchAll(/^(#{1,6})[ \t]+(.*?)[ \t]*$/gm)) headings.push({ heading: m[2], level: m[1].length, position: pos(bodyStart + m.index, bodyStart + m.index + m[0].length) });
  for (const m of body.matchAll(/(!?)\[\[([^\]]+)\]\]/g)) (m[1] ? embeds : links).push({ link: m[2].split("|")[0], original: m[0], position: pos(bodyStart + m.index, bodyStart + m.index + m[0].length) });
  for (const m of body.matchAll(/(!?)\[[^\]]*\]\(<?([^)\s>]+)>?\)/g)) (m[1] ? embeds : links).push({ link: decodeURIComponent(m[2]), original: m[0], position: pos(bodyStart + m.index, bodyStart + m.index + m[0].length) });
  return { headings, links, embeds, frontmatterLinks };
}

function fakeVault(files, { stale = {} } = {}) {
  const store = { ...files };
  const tfiles = Object.keys(store).map((p) => new TFile(p));
  const byPath = (p) => tfiles.find((f) => f.path === p) ?? null;
  const caches = Object.fromEntries(Object.entries(store).map(([p, t]) => [p, cacheOf(t)]));
  const app = {
    vault: {
      getAbstractFileByPath: byPath,
      getMarkdownFiles: () => tfiles,
      cachedRead: async (f) => store[f.path],
      process: async (f, fn) => { const cur = stale[f.path] ?? store[f.path]; store[f.path] = fn(cur); return store[f.path]; },
    },
    metadataCache: {
      getFileCache: (f) => caches[f.path] ?? null,
      getFirstLinkpathDest: (lp) => tfiles.find((f) => f.path === lp || f.path === `${lp}.md` || f.basename === lp) ?? null,
    },
  };
  return { app, store };
}

function tool(app, ctx = {}) {
  let handler;
  registerVaultWriteTools({ registerTool: (name, _def, h) => { if (name === "obsidian_rename_heading") handler = h; } }, app, ctx);
  return async (args) => {
    const r = await handler({ dry_run: false, ...args });
    return { ...r, data: r.structuredContent, error: r.isError ? r.content?.[0]?.text : undefined };
  };
}

const FILES = {
  "A.md": "# Title\n\n## Old heading\ntext\n\nsee [[#Old heading]]\n",
  "B.md": "one [[A#Old heading|alias]] two ![[A#old heading]] three [md](A.md#Old%20heading) four [[A#Title#Old heading]] five [[A#Other]] six [[C#Old heading]]\n",
  "C.md": "## Old heading\nC's own heading of the same name\n",
  "R.md": "---\nrecord: true\n---\nlog: [[A#Old heading]]\n",
  "F.md": "---\nsee: \"[[A#Old heading]]\"\n---\nbody\n",
};

describe("obsidian_rename_heading", () => {
  test("renames the heading and heals every link to it — wikilink, alias, embed, markdown, chain, same-note — and nothing else", async () => {
    const { app, store } = fakeVault(FILES);
    const r = await tool(app, { isRecord: (p) => p === "R.md" })({ path: "A.md", heading: "Old heading", new_heading: "New name" });
    assert.equal(r.error, undefined, r.error);
    assert.equal(store["A.md"], "# Title\n\n## New name\ntext\n\nsee [[#New name]]\n");
    assert.equal(store["B.md"], "one [[A#New name|alias]] two ![[A#New name]] three [md](A.md#New%20name) four [[A#Title#New name]] five [[A#Other]] six [[C#Old heading]]\n");
    assert.equal(store["C.md"], FILES["C.md"], "another note's heading of the same name is not touched");
    assert.equal(store["R.md"], FILES["R.md"], "a record note is not edited");
    assert.equal(r.data.linksChanged, 5);
    assert.deepEqual(r.data.files, ["A.md", "B.md"]);
    assert.equal(r.data.filesChanged, 2);
    assert.equal(r.data.heading_line, 3);
    assert.ok(r.data.skipped.some((s) => s.path === "R.md" && /record note/.test(s.reason)));
    assert.ok(r.data.skipped.some((s) => s.path === "F.md" && /frontmatter link in 'see'/.test(s.reason)));
    assert.equal(r.data.scoped_to_allowlist, false);
  });

  test("dry_run reports the same plan and writes nothing", async () => {
    const { app, store } = fakeVault(FILES);
    const r = await tool(app)({ path: "A.md", heading: "Old heading", new_heading: "New name", dry_run: true });
    assert.deepEqual(store, FILES);
    assert.equal(r.data.linksChanged, 6, "with no record probe, R.md's link counts too");
    assert.deepEqual(r.data.files, ["A.md", "B.md", "R.md"]);
  });

  test("refuses: not found, ambiguous, a clash with another heading, a forbidden character", async () => {
    const { app, store } = fakeVault({ ...FILES, "D.md": "## Twice\n\n## Twice\n\n## Taken\n" });
    const run = tool(app);
    assert.match((await run({ path: "A.md", heading: "Nope", new_heading: "X" })).error, /heading not found in A\.md: 'Nope' \(headings: 'Title', 'Old heading'\)/);
    assert.match((await run({ path: "D.md", heading: "Twice", new_heading: "X" })).error, /appears 2 times in D\.md \(lines 1, 3\)/);
    assert.match((await run({ path: "D.md", heading: "Taken", new_heading: "twice" })).error, /already has a heading 'Twice'/);
    assert.match((await run({ path: "A.md", heading: "Old heading", new_heading: "a#b" })).error, /cannot carry/);
    assert.deepEqual(store, { ...FILES, "D.md": "## Twice\n\n## Twice\n\n## Taken\n" }, "nothing written");
  });

  test("the scan is contained by the allowlist, and says so", async () => {
    const { app, store } = fakeVault(FILES);
    const r = await tool(app, { getSettings: () => ({ allowlist: ["A.md"] }) })({ path: "A.md", heading: "Old heading", new_heading: "New name" });
    assert.equal(store["B.md"], FILES["B.md"], "outside the allowlist: not read, not rewritten");
    assert.deepEqual(r.data.files, ["A.md"]);
    assert.equal(r.data.scoped_to_allowlist, true);
    assert.ok(!JSON.stringify(r.data).includes("B.md"), "and not named");
  });

  test("a note that changed since the cache read it is skipped, not rewritten blind; if it is the heading's own note, nothing at all is written", async () => {
    const other = fakeVault(FILES, { stale: { "B.md": "someone rewrote this\n" } });
    const r = await tool(other.app)({ path: "A.md", heading: "Old heading", new_heading: "New name" });
    assert.equal(other.store["B.md"], "someone rewrote this\n", "the changed text is kept");
    assert.ok(r.data.skipped.some((s) => s.path === "B.md" && /changed since the cache read it/.test(s.reason)));
    assert.match(other.store["A.md"], /## New name/);
    const own = fakeVault(FILES, { stale: { "A.md": "# Title\n\n## Old heading\nEDITED\n\nsee [[#Old heading]]\n" } });
    const r2 = await tool(own.app)({ path: "A.md", heading: "Old heading", new_heading: "New name" });
    assert.match(r2.error, /A\.md changed since the cache read it; nothing was renamed or rewritten/);
    assert.equal(own.store["B.md"], FILES["B.md"], "no other note was touched");
  });

  test("the descriptions tell agents to use this tool, and why (Nelson: 'renaming a heading using that tool is preferable because it rewrites links')", async () => {
    let desc = "";
    registerVaultWriteTools({ registerTool: (name, def) => { if (name === "obsidian_rename_heading") desc = def.description; } }, fakeVault(FILES).app, {});
    assert.match(desc, /^USE THIS TOOL TO RENAME A HEADING — not obsidian_patch_note, obsidian_write_note or any other text edit/);
    const { FS_TOOLS } = await import("@vault-mcp/core");
    const d = (n) => FS_TOOLS.find((t) => t.name === n)?.description ?? "";
    assert.match(d("obsidian_patch_note"), /To RENAME a heading, use `obsidian_rename_heading`/);
    assert.match(d("obsidian_write_note"), /to rename a heading, use `obsidian_rename_heading`/);
  });
});
