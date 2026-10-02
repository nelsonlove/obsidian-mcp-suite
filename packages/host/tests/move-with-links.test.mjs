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
  // Every write moves the file's mtime and size, as on disk.
  const write = (p, t) => { text.set(p, t); tfiles.get(p).stat = { mtime: clock++, size: t.length }; };
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
        if (changeBeforeProcess[f.path]) { write(f.path, changeBeforeProcess[f.path]); delete changeBeforeProcess[f.path]; }
        const next = fn(text.get(f.path));
        write(f.path, next);
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
  return { app, text, tfiles, calls, write };
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
  test("parseLinks follows Obsidian's index on quoted fences, paragraph-wide inline code, escaped backticks and badge links (each seen in the real vault)", () => {
    assert.deepEqual(parseLinks("> ~~~md\n> [[A]]\n> ~~~\n> [[B]]\n").map((l) => l.linkpath), ["B"], "a fence inside a quote hides its lines");
    assert.deepEqual(parseLinks("x `one\ntwo [[A]]` [[B]]\n").map((l) => l.linkpath), ["B"], "inline code runs over a line break inside one paragraph");
    assert.deepEqual(parseLinks("- a ` lone\n- b [[A]] `c`\n# h ` x\n[[B]] `\n").map((l) => l.linkpath), ["A", "B"], "a list item and a heading each start a new block");
    assert.deepEqual(parseLinks("say `\\` then [[A]] and `[[B]]`\n").map((l) => l.linkpath), ["A"], "a backslash does not escape inside code, so `\\` is a span");
    assert.deepEqual(parseLinks("[![badge](https://x.org/b.svg)](Read%20me.md)\n").map((l) => l.linkpath), ["Read me.md"], "a link whose text is an image");
  });
  test("parseLinks: a fence may open on a list item's first line; an escaped backslash does not escape a backtick", () => {
    assert.deepEqual(parseLinks("- ```\n  [[A]]\n  ```\n\nafter [[B]]\n1. ~~~js\n   [[C]]\n   ~~~\n[[D]]\n").map((l) => l.linkpath), ["B", "D"]);
    assert.deepEqual(parseLinks("x \\\\`[[A]]` [[B]]\n").map((l) => l.linkpath), ["B"], "\\\\ is a backslash, so the backtick after it opens code");
    assert.deepEqual(parseLinks("```\n- ```\n```\n[[Me]]\n").map((l) => l.linkpath), ["Me"], "a list item inside a fence does not close it");
    assert.deepEqual(parseLinks("[a `[b](Me.md)` c](Other.md)\n").map((l) => l.linkpath), ["Other.md"], "a link in inline code inside link text is code");
  });
  test("parseLinks stays fast on a large note and on long lines of stray brackets or backticks", () => {
    const big = "line `code` and [[Link]] and [t](Other.md)\n".repeat(17000);
    for (const [name, t] of [["a 700 KB note", big], ["a paragraph of 17,000 lines", big.replace(/\n/g, " ")], ["stray brackets", "[a\\".repeat(50000)], ["stray backticks", "`a ".repeat(100000)], ["unclosed angle destinations", "[a](<x".repeat(80000)]]) {
      const t0 = Date.now();
      parseLinks(t);
      assert.ok(Date.now() - t0 < 1500, `${name}: ${Date.now() - t0} ms`);
    }
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

  test("a current index entry counting more links than the text scan found is reported, and ok is false", async () => {
    const { app } = fakeApp({ "A/Old.md": "x\n", "S/P.md": "one [[Old]] here\n" }, { wrongCache: { "S/P.md": "[[Old]] and [[Old]]\n" } });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md");
    assert.equal(r.ok, false);
    assert.deepEqual(r.index_only, ["S/P.md"]);
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

  test("a fenced block hides every line up to its close, and a link after the block is found (review #1)", async () => {
    const note = "```js\nconst a = \"[[Old]]\";\n[[Old]]\n```\nafter [[Old]]\n  ~~~~\n  [[Old]]\n  ~~~\n  ~~~~~\nlast [[Old]]\n```\nunclosed [[Old]]\n";
    assert.deepEqual(parseLinks(note).map((l) => note.slice(0, l.start).split("\n").length), [5, 10]);
    const { app, text } = fakeApp({ "A/Old.md": "x\n", "S/F.md": note });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md");
    assert.equal(text.get("S/F.md"), note.replace("after [[Old]]", "after [[New]]").replace("last [[Old]]", "last [[New]]"));
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("a markdown destination with balanced parentheses is one link (review #4)", async () => {
    assert.deepEqual(parseLinks("[x](A/Old%20(1).md#H) y").map((l) => [l.original, l.linkpath, l.subpath]), [["[x](A/Old%20(1).md#H)", "A/Old (1).md", "#H"]]);
    const { app, text } = fakeApp({ "A/Old (1).md": "x\n", "S/P.md": "see [x](A/Old%20(1).md#H) and [[Old (1)]]\n" });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old (1).md"), "B/New (2).md");
    assert.equal(text.get("S/P.md"), "see [x](B/New%20%282%29.md#H) and [[New (2)]]\n");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("a fence opened on a list item hides its link, and the real link after it is rewritten (review A)", async () => {
    const note = "- ```\n  [[Old]]\n  ```\n\nafter [[Old]]\n";
    const { app, text } = fakeApp({ "A/Old.md": "x\n", "S/L.md": note });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md");
    assert.equal(text.get("S/L.md"), "- ```\n  [[Old]]\n  ```\n\nafter [[New]]\n");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("a link inside a link's image text is rewritten with the outer one (review B)", async () => {
    const { app, text } = fakeApp({ "A/Old.md": "x\n", "S/I.md": "[![alt](../A/Old.md)](../A/Old.md) and [![b](Pic.md)](../A/Old.md)\n", "S/Pic.md": "p\n" });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md");
    assert.equal(text.get("S/I.md"), "[![alt](../B/New.md)](../B/New.md) and [![b](Pic.md)](../B/New.md)\n");
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.links_rewritten, 3);
  });

  test("a subpath is written back as it was written, encoded characters included (review C)", async () => {
    const { app, text } = fakeApp({ "A/Old.md": "x\n", "S/H.md": "[x](../A/Old.md#a%29%25b) [y](<../A/Old.md#c d>)\n" });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md");
    assert.equal(text.get("S/H.md"), "[x](../B/New.md#a%29%25b) [y](<../B/New.md#c d>)\n");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("a note whose only link is %20-encoded, or written in the other Unicode form, is found (review #3)", async () => {
    const nfd = "Café note";
    const { app, text } = fakeApp({ "A/Old name.md": "x\n", "S/E.md": "[x](../A/Old%20name.md)\n", "A/Café note.md": "y\n", "S/N.md": `[[${nfd}]]\n` });
    const r1 = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old name.md"), "B/New name.md");
    assert.equal(text.get("S/E.md"), "[x](../B/New%20name.md)\n");
    const r2 = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Café note.md"), "B/Moved.md");
    assert.equal(text.get("S/N.md"), "[[Moved]]\n");
    assert.equal(r1.ok && r2.ok, true, JSON.stringify([r1, r2]));
  });

  test("the moved note's own relative links in angle brackets and relative wikilinks are rewritten (review #2)", async () => {
    const { app, text } = fakeApp({ "A/Old.md": "[o](<../C/Other one.md>) and [[../C/Other one|w]] and ![[./Pic.md]]\n", "C/Other one.md": "x\n", "A/Pic.md": "p\n" });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/D/New.md");
    assert.equal(text.get("B/D/New.md"), "[o](<../../C/Other one.md>) and [[../../C/Other one|w]] and ![[../../A/Pic.md]]\n");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("a relative wikilink to the moved note stays relative", async () => {
    const { app, text } = fakeApp({ "A/Old.md": "x\n", "S/R.md": "[[../A/Old#H]]\n" });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/C/New.md");
    assert.equal(text.get("S/R.md"), "[[../B/C/New#H]]\n");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("a relative link of the moved note that could not be rewritten is reported, and ok is false (review #2)", async () => {
    const { app } = fakeApp({ "A/Old.md": "[o](../C/Other.md)\n", "C/Other.md": "x\n" }, { throwOn: ["B/D/New.md"] });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/D/New.md");
    assert.equal(r.ok, false);
    assert.deepEqual(r.own_links_broken, [{ target: "C/Other.md", before: 1, after: 0 }]);
  });

  test("the moved note's own links are rewritten from its current text when it changed mid-move", async () => {
    const { app, text } = fakeApp({ "A/Old.md": "[o](../C/Other.md)\n", "C/Other.md": "x\n" }, { changeBeforeProcess: { "B/D/New.md": "NEW LINE\n[o](../C/Other.md)\n" } });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/D/New.md");
    assert.equal(text.get("B/D/New.md"), "NEW LINE\n[o](../../C/Other.md)\n");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("update_backlinks: false leaves the moved note's own links alone too (review #5)", async () => {
    const { app, text } = fakeApp({ "A/Old.md": "[o](../C/Other.md)\n", "C/Other.md": "x\n" });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/D/New.md", { updateBacklinks: false });
    assert.equal(text.get("B/D/New.md"), "[o](../C/Other.md)\n");
    assert.equal(r.links_rewritten, 0);
  });

  test("a batch's shared text sees a write made between two moves by someone else (review #6)", async () => {
    // S/X is read (and cached) by the first move's scan, but not rewritten by it.
    const { app, text, write } = fakeApp({ "A/One.md": "1\n", "A/Two.md": "2\n", "S/X.md": "nothing yet\n" });
    const texts = new TextCache(app);
    await moveWithLinks(app, app.vault.getAbstractFileByPath("A/One.md"), "B/Uno.md", { texts });
    write("S/X.md", "now [[Two]]\n"); // the editor, another plugin, a sync
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Two.md"), "B/Dos.md", { texts });
    assert.equal(text.get("S/X.md"), "now [[Dos]]\n");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("counts name only what the caller may see: a hidden note's rewrite is in neither count (review #8)", async () => {
    const { app, text } = fakeApp({ "A/Old.md": "x\n", "Secret/S.md": "a [[Old]] [[Old]]\n", "S/V.md": "[[Old]]\n" });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md", { visible: (p) => !p.startsWith("Secret/") });
    assert.equal(text.get("Secret/S.md"), "a [[New]] [[New]]\n", "the hidden note is still healed");
    assert.deepEqual([r.links_rewritten, r.files_rewritten, r.ok], [1, ["S/V.md"], true]);
  });

  test("a note outside the caller's view is counted, never named, and its damage still makes ok false", async () => {
    const { app } = fakeApp({ "A/Old.md": "x\n", "Secret/S.md": "a [[Old]]\n" }, { throwOn: ["Secret/S.md"] });
    const r = await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Old.md"), "B/New.md", { visible: (p) => !p.startsWith("Secret/") });
    assert.equal(r.ok, false);
    assert.ok(r.hidden >= 1);
    assert.ok(!JSON.stringify(r).includes("Secret/"));
  });
});

describe("moveWithLinks — names Obsidian Sync refuses", () => {
  test("a rename that adds a refused character is refused before anything moves; one that keeps or removes it moves", async () => {
    const { app, text, calls } = fakeApp({ "A/Plain.md": "x\n", "A/Q: old.md": "y\n", "S/L.md": "[[Plain]]\n" });
    await assert.rejects(moveWithLinks(app, app.vault.getAbstractFileByPath("A/Plain.md"), "A/Plain: v2.md"), (e) => e.code === "unsafe_name");
    assert.deepEqual(calls.vaultRename, []);
    assert.equal(text.get("S/L.md"), "[[Plain]]\n");
    await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Q: old.md"), "B/Q: old.md");
    await moveWithLinks(app, app.vault.getAbstractFileByPath("B/Q: old.md"), "B/Q - old.md");
    assert.deepEqual(calls.vaultRename, [["A/Q: old.md", "B/Q: old.md"], ["B/Q: old.md", "B/Q - old.md"]]);
  });

  test("brackets: a move into a JD archive may add them for a note nothing links to, never for a linked one", async () => {
    const ARCH = "00-09 System/00 System management/00.09 Archive";
    const { app, calls } = fakeApp({ "A/Lonely.md": "x\n", "A/Cited.md": "y\n", "S/L.md": "[[Cited]]\n" });
    await moveWithLinks(app, app.vault.getAbstractFileByPath("A/Lonely.md"), `${ARCH}/[superseded] Lonely.md`);
    await assert.rejects(moveWithLinks(app, app.vault.getAbstractFileByPath("A/Cited.md"), `${ARCH}/[superseded] Cited.md`), (e) => e.code === "unsafe_name" && /no other note links to/.test(e.message));
    assert.deepEqual(calls.vaultRename, [["A/Lonely.md", `${ARCH}/[superseded] Lonely.md`]]);
  });
});
