/**
 * move-with-links.test.mjs — a move that renames at the file level and rewrites
 * its own backlinks (Nelson's "B", 2026-09-29: "Let's try be and run tests
 * looking for damage"). Obsidian's renameFile waited for a clean metadata cache,
 * minutes per move under the fleet's write load.
 *
 * The fake app behaves like Obsidian where it matters: links resolve by path or
 * by basename (same folder first, then shortest path), the cache records
 * positions and a per-file mtime/size, a stale cache entry is possible, and
 * `vault.rename` does NOT update `resolvedLinks` (the index lags).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installObsidianStub, TFile } from "./obsidian-stub.mjs";
import { parseLinks, rewriteLink, relativePath } from "../src/mcp/link-rewrite.ts";

installObsidianStub();
const { moveWithLinks, TextCache } = await import("../src/mcp/move-with-links.ts");

const stripMd = (s) => s.replace(/\.md$/i, "");
const base = (p) => stripMd(p.split("/").pop());
const folder = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

function fakeApp(files, { stale = [], wrongCache = {}, throwOn = [], changeBeforeProcess = {} } = {}) {
  const text = new Map(Object.entries(files));
  const tfiles = new Map();
  let clock = 1000;
  const mk = (p) => { const f = new TFile(p); f.stat = { mtime: clock++, size: text.get(p).length }; return f; };
  for (const p of text.keys()) tfiles.set(p, mk(p));
  const all = () => [...tfiles.values()];
  const resolve = (linkpath, source) => {
    if (!linkpath) return null;
    let lp = linkpath;
    if (/^\.\.?\//.test(lp)) {
      const parts = folder(source) ? folder(source).split("/") : [];
      for (const seg of lp.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
      lp = parts.join("/");
    }
    const exact = tfiles.get(lp) ?? tfiles.get(`${lp}.md`);
    if (exact) return exact;
    if (lp.includes("/")) return all().find((f) => stripMd(f.path).toLowerCase().endsWith("/" + stripMd(lp).toLowerCase())) ?? null;
    const same = all().filter((f) => base(f.path).toLowerCase() === stripMd(lp).toLowerCase());
    if (same.length === 0) return null;
    return same.find((f) => folder(f.path) === folder(source)) ?? same.sort((a, b) => a.path.length - b.path.length)[0];
  };
  const cacheOf = (p, t) => {
    const links = [], embeds = [], frontmatterLinks = [];
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(t);
    if (fm) for (const m of fm[1].matchAll(/^(\w+):\s*"(\[\[([^\]|]+)(?:\|[^\]]*)?\]\])"/gm)) frontmatterLinks.push({ key: m[1], link: m[3], original: m[2] });
    for (const l of parseLinks(t)) {
      if (fm && l.start < fm[0].length) continue;
      (l.embed ? embeds : links).push({ link: l.linkpath + l.subpath, original: l.original, position: { start: { offset: l.start }, end: { offset: l.end } } });
    }
    return { links, embeds, frontmatterLinks };
  };
  const caches = new Map();
  const fileCache = {};
  const resolvedLinks = {};
  for (const [p, t] of text) {
    const src = wrongCache[p] ?? t; // a cache built from different text: the index is wrong about this note
    caches.set(p, cacheOf(p, src));
    fileCache[p] = { mtime: tfiles.get(p).stat.mtime, size: tfiles.get(p).stat.size };
    resolvedLinks[p] = {};
    for (const l of [...caches.get(p).links, ...caches.get(p).embeds]) {
      const d = resolve(l.link.split("#")[0], p);
      if (d) resolvedLinks[p][d.path] = (resolvedLinks[p][d.path] ?? 0) + 1;
    }
  }
  // A stale note: written after the cache read it (new text, same cache).
  for (const [p, newText] of Object.entries(stale)) { text.set(p, newText); tfiles.get(p).stat = { mtime: clock++, size: newText.length }; }
  const calls = { renameFile: 0, vaultRename: [] };
  const app = {
    vault: {
      getMarkdownFiles: all,
      getAbstractFileByPath: (p) => tfiles.get(p) ?? null,
      read: async (f) => text.get(f.path),
      cachedRead: async (f) => text.get(f.path),
      async rename(f, to) {
        calls.vaultRename.push([f.path, to]);
        const t = text.get(f.path); text.delete(f.path); tfiles.delete(f.path);
        const old = f.path;
        f.path = to; f.basename = base(to); f.name = to.split("/").pop();
        text.set(to, t); tfiles.set(to, f);
        // Obsidian re-keys the per-file cache on rename, but resolvedLinks lags.
        caches.set(to, caches.get(old)); caches.delete(old); fileCache[to] = fileCache[old]; delete fileCache[old];
      },
      async process(f, fn) {
        if (throwOn.includes(f.path)) throw new Error("disk full");
        if (changeBeforeProcess[f.path]) { text.set(f.path, changeBeforeProcess[f.path]); delete changeBeforeProcess[f.path]; }
        const next = fn(text.get(f.path));
        text.set(f.path, next);
        return next;
      },
    },
    metadataCache: {
      resolvedLinks,
      fileCache,
      getFileCache: (f) => caches.get(f.path) ?? null,
      getFirstLinkpathDest: resolve,
      fileToLinktext(f, source, omitMd) {
        const unique = all().filter((g) => base(g.path).toLowerCase() === f.basename.toLowerCase()).length === 1;
        const t = unique ? f.basename : stripMd(f.path);
        return omitMd ? t : `${t}.md`;
      },
    },
    fileManager: { async renameFile() { calls.renameFile++; throw new Error("the move must not wait on renameFile"); } },
  };
  return { app, text, tfiles, calls };
}

describe("link-rewrite rules", () => {
  test("parseLinks finds wikilinks, embeds, aliases, subpaths and markdown links, skips code and math, and keeps links in %% comments (Obsidian indexes those)", () => {
    const t = "a [[X]] b ![[X#H|al]] c [t](X.md) d `[[X]]`\n```\n[[X]]\n```\n$$[[X]]$$ %%[[Y]]%% [u](https://x.org)";
    const ls = parseLinks(t);
    assert.deepEqual(ls.map((l) => [l.kind, l.embed, l.linkpath, l.subpath]), [["wiki", false, "X", ""], ["wiki", true, "X", "#H"], ["markdown", false, "X.md", ""], ["wiki", false, "Y", ""]]);
  });
  test("parseLinks: a name with a bracket pair is a link; in [[a [[b]] c]] only the innermost is; inline code stays on one line", () => {
    assert.deepEqual(parseLinks("see [[[draft] Note|d]] here").map((l) => l.linkpath), ["[draft] Note"]);
    assert.deepEqual(parseLinks("[[a t[[b]]c]]").map((l) => l.original), ["[[b]]"]);
    assert.deepEqual(parseLinks("- one ` lone\n- two [[B]] and `c`\n").map((l) => l.linkpath), ["B"]);
  });
  test("rewriteLink changes only the target: alias, subpath, embed marker, display text, title and angle brackets stay", () => {
    const [w] = parseLinks("![[Old#Sec|shown]]");
    assert.equal(rewriteLink(w, "B/New.md", "S.md", "New"), "![[New#Sec|shown]]");
    const [t] = parseLinks("| [[Old\\|alias]] |");
    assert.equal(rewriteLink(t, "B/New.md", "S.md", "New"), "[[New\\|alias]]", "a table's escaped pipe is kept");
    const [m] = parseLinks('[see it](A/Old%20name.md#Sec "t")');
    assert.equal(rewriteLink(m, "B/New name.md", "S.md", "New name"), '[see it](B/New%20name.md#Sec "t")');
    const [r] = parseLinks("[x](../A/Old.md)");
    assert.equal(rewriteLink(r, "B/C/New.md", "D/S.md", "New"), "[x](../B/C/New.md)");
    const [a] = parseLinks("[x](<A/Old one.md>)");
    assert.equal(rewriteLink(a, "B/New one.md", "S.md", "New one"), "[x](<B/New one.md>)");
    assert.equal(relativePath("A/B", "A/C/N.md"), "../C/N.md");
    assert.equal(relativePath("", "N.md"), "./N.md");
  });
});

describe("moveWithLinks", () => {
  test("renames without renameFile, rewrites every backlink form, leaves every other link alone, and checks clean", async () => {
    const { app, text, calls } = fakeApp({
      "A/Old.md": "# Old\nsee [other](../C/Other.md) and [[#Old]]\n",
      "S/One.md": "x [[Old]] y ![[Old#Sec|al]] z [md](../A/Old.md) w [[Other]]\n",
      "S/Two.md": "---\nup: \"[[Old]]\"\n---\nbody [[A/Old|full]]\n",
      "C/Other.md": "no links here, and `[[Old]]` in code\n",
    });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md");
    assert.equal(calls.renameFile, 0, "no wait for a clean metadata cache");
    assert.deepEqual(calls.vaultRename, [["A/Old.md", "B/New.md"]]);
    assert.equal(text.get("S/One.md"), "x [[New]] y ![[New#Sec|al]] z [md](../B/New.md) w [[Other]]\n");
    assert.equal(text.get("S/Two.md"), "---\nup: \"[[New]]\"\n---\nbody [[New|full]]\n");
    assert.equal(text.get("C/Other.md"), "no links here, and `[[Old]]` in code\n", "a link inside code is not a link");
    assert.equal(text.get("B/New.md"), "# Old\nsee [other](../C/Other.md) and [[#Old]]\n", "the moved note's relative link still reaches its target from the new folder");
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.links_rewritten, 5);
    assert.deepEqual(r.files_rewritten.sort(), ["S/One.md", "S/Two.md"]);
  });

  test("the moved note's own relative links are rewritten when its folder depth changes", async () => {
    const { app, text } = fakeApp({ "A/Old.md": "[o](../C/Other.md)\n", "C/Other.md": "x\n" });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/D/New.md");
    assert.equal(text.get("B/D/New.md"), "[o](../../C/Other.md)\n");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("a note written moments before (its index entry stale) is still rewritten: the risk the ruling named", async () => {
    const { app, text } = fakeApp(
      { "A/Old.md": "x\n", "S/Fresh.md": "nothing yet\n" },
      { stale: { "S/Fresh.md": "just added [[Old]] and [t](../A/Old.md)\n" } }
    );
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md");
    assert.equal(text.get("S/Fresh.md"), "just added [[New]] and [t](../B/New.md)\n");
    assert.ok(r.stale_sources >= 1);
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("a note that changed between the plan and the write is rewritten from its current text", async () => {
    const { app, text } = fakeApp(
      { "A/Old.md": "x\n", "S/One.md": "a [[Old]]\n" },
      { changeBeforeProcess: { "S/One.md": "PREPENDED LINE\na [[Old]] and ![[Old]]\n" } }
    );
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md");
    assert.equal(text.get("S/One.md"), "PREPENDED LINE\na [[New]] and ![[New]]\n");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("a link the index does not know is found from the note's text and rewritten", async () => {
    const { app, text } = fakeApp(
      { "A/Old.md": "x\n", "S/Hidden.md": "a [[Old]]\n" },
      { wrongCache: { "S/Hidden.md": "a note with no links\n" } }
    );
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md");
    assert.equal(text.get("S/Hidden.md"), "a [[New]]\n");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("a link inside a frontmatter string (not a property link, so not indexed) is rewritten too", async () => {
    const { app, text } = fakeApp({ "A/Old.md": "x\n", "S/F.md": "---\ndescription: \"see [[Old]] rule 8\"\nabout:\n  - link: \"[[Old]]\"\n---\nbody\n" });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md");
    assert.equal(text.get("S/F.md"), "---\ndescription: \"see [[New]] rule 8\"\nabout:\n  - link: \"[[New]]\"\n---\nbody\n");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("damage is REPORTED, never silent: a note the index says links the note, where its text has no link, makes ok false", async () => {
    const { app } = fakeApp(
      { "A/Old.md": "x\n", "S/Ghost.md": "no link here\n" },
      { wrongCache: { "S/Ghost.md": "a [[Old]]\n" } }
    );
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md");
    assert.equal(r.ok, false);
    assert.deepEqual(r.index_only, ["S/Ghost.md"]);
  });

  test("a same-note heading link [[#H]] in the moved note is not reported as missing", async () => {
    const { app } = fakeApp({ "A/Old.md": "# H\nsee [[#H]]\n" });
    app.metadataCache.resolvedLinks["A/Old.md"] = { "A/Old.md": 1 };
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("inline code never spans a blank line: a link after an unclosed backtick in another paragraph is still found", async () => {
    const { app, text } = fakeApp({ "A/Old.md": "x\n", "S/C.md": "a lone ` backtick\n\nthen [[Old]] and `code`\n" });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md");
    assert.equal(text.get("S/C.md"), "a lone ` backtick\n\nthen [[New]] and `code`\n");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("a note that cannot be written is reported under failed, and ok is false", async () => {
    const { app } = fakeApp({ "A/Old.md": "x\n", "S/One.md": "a [[Old]]\n" }, { throwOn: ["S/One.md"] });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md");
    assert.equal(r.ok, false);
    assert.deepEqual(r.failed, [{ path: "S/One.md", reason: "disk full" }]);
    assert.ok(r.still_linking_old.some((x) => x.path === "S/One.md"));
  });

  test("a link to ANOTHER note that shares the basename is not touched", async () => {
    const { app, text } = fakeApp({ "A/Note.md": "x\n", "Z/Note.md": "z\n", "Z/S.md": "[[Note]] resolves to Z/Note by folder\n" });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Note.md"), "B/Note2.md");
    assert.equal(text.get("Z/S.md"), "[[Note]] resolves to Z/Note by folder\n");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("a batch shares one read of the vault: the second move sees the first move's rewrite", async () => {
    const { app, text } = fakeApp({ "A/One.md": "1\n", "A/Two.md": "2\n", "S/Both.md": "[[One]] and [[Two]] and [[One#H]]\n" });
    const texts = new TextCache(app);
    const r1 = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/One.md"), "B/Uno.md", { texts });
    const r2 = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Two.md"), "B/Dos.md", { texts });
    assert.equal(text.get("S/Both.md"), "[[Uno]] and [[Dos]] and [[Uno#H]]\n");
    assert.equal(r1.ok && r2.ok, true, JSON.stringify([r1, r2]));
  });

  test("update_backlinks: false renames only, and says so by rewriting nothing", async () => {
    const { app, text } = fakeApp({ "A/Old.md": "x\n", "S/One.md": "a [[Old]]\n" });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md", { updateBacklinks: false });
    assert.equal(text.get("S/One.md"), "a [[Old]]\n");
    assert.equal(r.links_rewritten, 0);
  });

  test("a note outside the caller's view is counted, never named, and its damage still makes ok false", async () => {
    const { app } = fakeApp({ "A/Old.md": "x\n", "Secret/S.md": "a [[Old]]\n" }, { throwOn: ["Secret/S.md"] });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md", { visible: (p) => !p.startsWith("Secret/") });
    assert.equal(r.ok, false);
    assert.ok(r.hidden >= 1);
    assert.ok(!JSON.stringify(r).includes("Secret/"));
  });
});
