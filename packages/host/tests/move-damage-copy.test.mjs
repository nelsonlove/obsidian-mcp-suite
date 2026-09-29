/**
 * move-damage-copy.test.mjs — damage test on a COPY of a real vault (Nelson's
 * "B", 2026-09-29: "Let's try be and run tests looking for damage").
 *
 * Skipped unless VAULT_MCP_DAMAGE_DIR names a directory holding:
 *   export.json — Obsidian's own index for a sample of target notes, exported
 *                 read-only from a running Obsidian: every backlink's text,
 *                 offsets and Obsidian's resolution of it, plus the vault's
 *                 path list (the export script is in the PR description);
 *   vault/      — a copy of the notes the export names.
 * Nothing here reads or writes a live vault: the copy is loaded into memory and
 * every write stays there.
 *
 * For each target note, on a fresh in-memory copy:
 *   1. a WRITE STREAM edits a few of its backlinking notes after the index was
 *      taken (a line prepended, a line appended, a new link to the target), so
 *      their index entries are stale: the risk the ruling named;
 *   2. the note is moved with moveWithLinks;
 *   3. every note is compared before and after, with an INDEPENDENT link counter
 *      (not the parser under test): the text outside links is byte-identical;
 *      every link that did not reach the target is byte-identical and in the
 *      same order; every link that reached the target now reaches the new path
 *      (the same count as before); nothing still names the old path unresolved;
 *      and the tool's own damage check reports ok.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { installObsidianStub, TFile } from "./obsidian-stub.mjs";

const DIR = process.env.VAULT_MCP_DAMAGE_DIR;
const ready = DIR && fs.existsSync(path.join(DIR, "export.json"));

installObsidianStub();
const { moveWithLinks } = await import("../src/mcp/move-with-links.ts");

// ── an independent link model (deliberately NOT link-rewrite.ts) ──────────────
const LINK = /!?\[\[(?:[^\[\]\n]|\[[^\[\]\n]*\])*?\]\]|!?\[(?:[^\[\]\n]|\[[^\[\]\n]*\])*\]\((?:<[^>\n]*>|(?:[^()\s]|\([^()\s]*\))*)(?:\s+"[^"\n]*")?\)/g;
/** Fenced blocks, walked line by line: open on 3+ backticks or tildes, close on a bare run of the same character at least as long. */
function fences(text, from) {
  const out = [];
  let at = 0, open = null;
  for (const line of text.split("\n")) {
    const start = at; at += line.length + 1;
    if (start < from) continue;
    const run = /^[\s>]*(`{3,}|~{3,})(.*)$/.exec(line);
    if (!open) { if (run && !(run[1][0] === "`" && run[2].includes("`"))) open = { start, ch: run[1][0], n: run[1].length }; }
    else if (run && run[1][0] === open.ch && run[1].length >= open.n && run[2].trim() === "") { out.push([open.start, start + line.length]); open = null; }
  }
  if (open) out.push([open.start, text.length]);
  return out;
}
/** Inline code per paragraph: a run of n backticks pairs with the next run of exactly n (an escaped run closes, and opens with the rest). */
function inlineCode(text, from, inCode) {
  const out = [];
  const paras = [];
  let at = 0, cur = null;
  for (const line of text.split("\n")) {
    const start = at, end = at + line.length; at = end + 1;
    if (start < from) continue;
    const bare = line.replace(/^[ \t]*(?:>[ \t]?)*/, "");
    const blank = bare.trim() === "" || inCode(start);
    const newBlock = /^(#{1,6}(\s|$)|\||[-*+](\s|$)|\d+[.)](\s|$))/.test(bare);
    if (blank || newBlock) { if (cur) paras.push(cur); cur = null; }
    if (blank) continue;
    cur = cur ? [cur[0], end] : [start, end];
    if (/^(#{1,6}(\s|$)|\|)/.test(bare)) { paras.push(cur); cur = null; }
  }
  if (cur) paras.push(cur);
  for (const [a, b] of paras) {
    const runs = [];
    for (const m of text.slice(a, b).matchAll(/`+/g)) runs.push({ i: a + m.index, n: m[0].length, esc: text[a + m.index - 1] === "\\" });
    let k = 0;
    while (k < runs.length) {
      const o = runs[k], oi = o.esc ? o.i + 1 : o.i, on = o.esc ? o.n - 1 : o.n;
      let j = k + 1;
      while (on > 0 && j < runs.length && runs[j].n !== on) j++;
      if (on > 0 && j < runs.length) { out.push([oi, runs[j].i + runs[j].n]); k = j + 1; } else k++;
    }
  }
  return out;
}
function spansOf(text) {
  // Code fences, inline code, math and comments hold no links (Obsidian's rule).
  const out = [];
  const fm = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(text);
  const body = fm ? fm[0].length : 0;
  const inCode = (i) => i < body || out.some(([a, b]) => i >= a && i < b);
  out.push(...fences(text, body));
  out.push(...inlineCode(text, body, inCode));
  for (const re of [/\$\$/g]) {
    const at = [...text.matchAll(re)].map((m) => m.index).filter((i) => !inCode(i));
    for (let k = 0; k + 1 < at.length; k += 2) out.push([at[k], at[k + 1] + 2]);
  }
  return out;
}
function linksOf(text) {
  const skip = spansOf(text);
  const r = [];
  for (const m of text.matchAll(LINK)) {
    if (skip.some(([a, b]) => m.index >= a && m.index < b)) continue;
    if (!m[0].endsWith("]]") && /^<?[a-z][a-z0-9+.-]*:/i.test(destOf(m[0]))) continue; // URL
    r.push({ at: m.index, text: m[0] });
  }
  return r;
}
/** A markdown link's destination, raw: the last `](…)` of the link (its text may hold an image). */
const destOf = (linkText) => /\]\((<[^>]*>|(?:[^()\s]|\([^()\s]*\))*)(?:\s+"[^"]*")?\)$/.exec(linkText)[1];
function targetOf(linkText) {
  let t;
  const w = /^!?\[\[([\s\S]*)\]\]$/.exec(linkText);
  if (w) t = w[1].split("|")[0].replace(/\\$/, "");
  else {
    t = destOf(linkText).replace(/^<|>$/g, "");
    try { t = decodeURI(t); } catch { /* keep */ }
  }
  return t.split("#")[0].trim().normalize("NFC");
}
/** A link with its target removed: embed marker, subpath, alias, display text and title must survive a rewrite. */
function shape(linkText) {
  const w = /^(!?)\[\[([\s\S]*)\]\]$/.exec(linkText);
  if (w) { const bar = w[2].indexOf("|"); const t = bar < 0 ? w[2] : w[2].slice(0, bar); const h = t.indexOf("#"); return `${w[1]}[[${h < 0 ? "" : t.slice(h)}${bar < 0 ? "" : w[2].slice(bar)}]]`; }
  const m = /^(!?)\[([\s\S]*)\]\((<[^>]*>|(?:[^()\s]|\([^()\s]*\))*)(\s+"[^"]*")?\)$/.exec(linkText);
  let dest = m[3].replace(/^<|>$/g, ""); try { dest = decodeURI(dest); } catch { /* keep */ }
  const h = dest.indexOf("#");
  return `${m[1]}[${m[2]}](${h < 0 ? "" : dest.slice(h)}${m[4] ?? ""})`;
}
/** The text with every link span replaced by one marker: what must stay byte-identical. */
const skeleton = (text) => { let out = "", i = 0; for (const l of linksOf(text)) { out += text.slice(i, l.at) + "\u0000"; i = l.at + l.text.length; } return out + text.slice(i); };

// ── an Obsidian-like app over the in-memory copy ──────────────────────────────
const stripMd = (s) => s.replace(/\.md$/i, "");
const baseOf = (p) => stripMd(p.split("/").pop());
const folderOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
/** `to` written relative to the folder of `from`. */
function rel(from, to) {
  const a = folderOf(from).split("/").filter(Boolean), b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return (a.length === i ? "./" : "../".repeat(a.length - i)) + b.slice(i).join("/");
}
function buildApp(exp, texts) {
  const text = new Map(texts);
  const tfiles = new Map();
  for (const p of exp.allPaths) { const f = new TFile(p); f.stat = { mtime: 1, size: 0 }; tfiles.set(p, f); }
  for (const [p, t] of text) { const e = exp.entries[p]; tfiles.get(p).stat = { mtime: e ? e.stat.mtime : 1, size: Buffer.byteLength(t) }; }
  const fileCache = {};
  for (const [p, e] of Object.entries(exp.entries)) if (e.cache) fileCache[p] = { ...e.cache };
  const truth = new Map(); // `${source}\u0001${linkpath}` -> path, Obsidian's own resolution at export time
  for (const [p, e] of Object.entries(exp.entries)) for (const l of [...e.links, ...e.embeds, ...e.frontmatterLinks]) truth.set(`${p}\u0001${l.link.split("#")[0]}`, l.to);
  const byBase = new Map();
  for (const p of exp.allPaths) { const b = baseOf(p).toLowerCase(); if (!byBase.has(b)) byBase.set(b, []); byBase.get(b).push(p); }
  let moved = null; // { from, to }
  let duringMove = null; // a write that lands between finding the links and rewriting them
  const emulate = (lp, src) => {
    let q = lp;
    if (/^\.\.?\//.test(q)) {
      const parts = folderOf(src) ? folderOf(src).split("/") : [];
      for (const seg of q.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
      q = parts.join("/");
    }
    const exact = tfiles.get(q) ?? tfiles.get(`${q}.md`);
    if (exact) return exact;
    const key = baseOf(q).toLowerCase();
    let cands = (byBase.get(key) ?? []).map((p) => tfiles.get(p)).filter(Boolean);
    if (q.includes("/")) cands = cands.filter((f) => stripMd(f.path).toLowerCase().endsWith("/" + stripMd(q).toLowerCase()));
    if (cands.length === 0) return null;
    return cands.find((f) => folderOf(f.path) === folderOf(src)) ?? cands.sort((a, b) => a.path.length - b.path.length)[0];
  };
  const resolve = (lp, src) => {
    if (!lp) return null;
    const origSrc = moved && src === moved.to ? moved.from : src;
    const t = truth.get(`${origSrc}\u0001${lp}`);
    if (t !== undefined && !(moved && t === moved.from)) return t ? tfiles.get(t) ?? null : null;
    return emulate(lp, src);
  };
  const cacheOf = (p) => {
    const e = exp.entries[p];
    if (!e) return null;
    const m = (l) => ({ link: l.link, original: l.original, position: { start: { offset: l.start }, end: { offset: l.end } } });
    return { links: e.links.map(m), embeds: e.embeds.map(m), frontmatterLinks: e.frontmatterLinks };
  };
  const caches = new Map([...text.keys()].map((p) => [p, cacheOf(p)]));
  const resolvedLinks = {};
  for (const [p, e] of Object.entries(exp.entries)) {
    resolvedLinks[p] = {};
    for (const l of [...e.links, ...e.embeds]) if (l.to) resolvedLinks[p][l.to] = (resolvedLinks[p][l.to] ?? 0) + 1;
  }
  const app = {
    vault: {
      getMarkdownFiles: () => [...tfiles.values()].filter((f) => text.has(f.path)),
      getAbstractFileByPath: (p) => tfiles.get(p) ?? null,
      read: async (f) => text.get(f.path),
      cachedRead: async (f) => text.get(f.path),
      async process(f, fn) { const n = fn(text.get(f.path)); text.set(f.path, n); f.stat = { mtime: f.stat.mtime + 1, size: Buffer.byteLength(n) }; return n; },
      async rename(f, to) {
        const from = f.path; moved = { from, to };
        const t = text.get(from); text.delete(from); tfiles.delete(from);
        byBase.set(baseOf(from).toLowerCase(), (byBase.get(baseOf(from).toLowerCase()) ?? []).filter((p) => p !== from));
        f.path = to; f.basename = baseOf(to); f.name = to.split("/").pop();
        tfiles.set(to, f); text.set(to, t);
        const b = baseOf(to).toLowerCase(); byBase.set(b, [...(byBase.get(b) ?? []), to]);
        caches.set(to, caches.get(from)); caches.delete(from);
        if (fileCache[from]) { fileCache[to] = fileCache[from]; delete fileCache[from]; }
        if (duringMove) { duringMove(text); duringMove = null; }
      },
    },
    metadataCache: {
      resolvedLinks, fileCache,
      getFileCache: (f) => caches.get(f.path) ?? null,
      getFirstLinkpathDest: resolve,
      fileToLinktext: (f) => ((byBase.get(f.basename.toLowerCase()) ?? []).length === 1 ? f.basename : stripMd(f.path)),
    },
  };
  return { app, text, tfiles, resolve, setDuringMove: (fn) => { duringMove = fn; }, stale: (p) => { tfiles.get(p).stat = { mtime: tfiles.get(p).stat.mtime + 1, size: Buffer.byteLength(text.get(p)) }; } };
}

describe("moving real notes on a copy, under a write stream: no damage", { skip: ready ? false : "set VAULT_MCP_DAMAGE_DIR to an export + copy" }, () => {
  const exp = ready ? JSON.parse(fs.readFileSync(path.join(DIR, "export.json"), "utf8")) : null;
  const texts = ready ? new Map(Object.keys(exp.entries).map((p) => [p, fs.readFileSync(path.join(DIR, "vault", p), "utf8")])) : null;
  const targets = ready ? exp.targets : [];
  const summary = { moves: 0, links: 0, streamNotes: 0, ms: [] };

  for (const [ti, target] of targets.entries()) {
    test(`move ${target}`, async () => {
      const { app, text, resolve, stale, setDuringMove } = buildApp(exp, texts);
      const before = new Map(text);
      // Which notes reached the target before the stream: Obsidian's own answer.
      const beforeReach = new Map();
      for (const [p, e] of Object.entries(exp.entries)) {
        if (!text.has(p)) continue;
        // A copied note that differs from what was indexed is stale already; count it independently.
        const n = [...e.links, ...e.embeds, ...e.frontmatterLinks].filter((l) => l.to === target).length;
        if (n > 0) beforeReach.set(p, n);
      }
      // ── the write stream: up to three of its sources change after the index was taken
      const sources = [...beforeReach.keys()].filter((p) => p !== target).slice(0, 3);
      const b = baseOf(target);
      sources.forEach((p, i) => {
        if (i === 0) text.set(p, `stream: a line prepended ${ti}\n` + text.get(p));
        // The forms the #440 review named: a link inside a multi-line fence (must stay) and one after it; a vault-path
        // markdown link with %20 and raw parentheses; one in angle brackets; a relative wikilink; the other Unicode form.
        if (i === 1) text.set(p, text.get(p) + `\nstream: appended, and a new link [[${b}]]\n\`\`\`\n[[${b}]] in a fence\n\`\`\`\nafter the fence [[${b}]]\n[pct](${target.replace(/ /g, "%20")}) [ang](<${target}>) [[${rel(p, stripMd(target))}|rel]] [[${b.normalize("NFD")}]]\n`);
        if (i === 2) text.set(p, `stream: prepended with [[${b}|a new alias]]\n` + text.get(p));
        stale(p);
      });
      // The moved note's own relative links, markdown in angle brackets and wiki, to a note of the stream: they must still reach it.
      const ownTo = sources[0];
      if (ownTo) { text.set(target, text.get(target) + `\nstream: own [r](<${rel(target, ownTo)}>) and [[${rel(target, stripMd(ownTo))}]]\n`); stale(target); }
      // Independent "before" count over the current text, for every note (stream edits included).
      const reach = (p, t, dest) => linksOf(t).filter((l) => { const d = resolve(targetOf(l.text), p); return d && d.path === dest; }).length;
      const pre = new Map();
      const resolveBefore = new Map();
      for (const [p, t] of text) {
        const n = reach(p, t, target); if (n > 0) pre.set(p, n);
        resolveBefore.set(p, new Map(linksOf(t).map((l) => { const d = resolve(targetOf(l.text), p); return [l.text, d ? d.path : null]; })));
      }
      const snapshot = new Map(text);

      // A write that lands DURING the move, after the links were found and before they are
      // rewritten: a fourth source gets a line prepended (every planned offset in it shifts).
      const mid = [...beforeReach.keys()].filter((p) => p !== target && !sources.includes(p))[0];
      const midLine = `stream: written during the move ${ti}\n`;
      if (mid) setDuringMove((t) => t.set(mid, midLine + t.get(mid)));
      const to = `Moved by damage test/${b} (moved).md`;
      const t0 = Date.now();
      const check = await moveWithLinks(app, app.vault.getAbstractFileByPath(target), to);
      summary.ms.push(Date.now() - t0); summary.moves++; summary.links += check.links_rewritten; summary.streamNotes += sources.length;

      if (process.env.VAULT_MCP_DAMAGE_DIAG && !check.ok) {
        const d = path.join(DIR, "diag"); fs.mkdirSync(d, { recursive: true });
        const around = (t, needle) => { const i = t.indexOf(needle); return i < 0 ? null : t.slice(Math.max(0, i - 120), i + needle.length + 60); };
        const detail = {
          target, to, check: { ...check, files_rewritten: check.files_rewritten.length },
          stillOld: check.still_linking_old.map((x) => ({ ...x, before: around(snapshot.get(x.path === to ? target : x.path) ?? "", x.link), after: around(text.get(x.path) ?? "", x.link), cache: (exp.entries[x.path]?.links ?? []).filter((l) => l.original === x.link).map((l) => ({ start: l.start, to: l.to })) })),
          notReaching: check.not_reaching_new.map((x) => ({ ...x, beforeLinks: linksOf(snapshot.get(x.path) ?? "").filter((l) => baseOf(targetOf(l.text)).toLowerCase() === b.toLowerCase()).map((l) => l.text), afterLinks: linksOf(text.get(x.path) ?? "").filter((l) => { const lp = targetOf(l.text); return lp && (baseOf(lp).toLowerCase() === b.toLowerCase() || baseOf(lp).toLowerCase() === baseOf(to).toLowerCase()); }).map((l) => l.text), cacheLinks: (exp.entries[x.path]?.links ?? []).concat(exp.entries[x.path]?.embeds ?? []).filter((l) => l.to === target).map((l) => l.original) })),
          indexOnly: check.index_only.map((p) => ({ path: p, cache: [...(exp.entries[p]?.links ?? []), ...(exp.entries[p]?.embeds ?? []), ...(exp.entries[p]?.frontmatterLinks ?? [])].filter((l) => l.to === target) })),
        };
        fs.writeFileSync(path.join(d, `${ti}.json`), JSON.stringify(detail, null, 1));
      }
      assert.equal(check.ok, true, `damage check: ${JSON.stringify({ ...check, files_rewritten: check.files_rewritten.length })}`);
      for (const [p0, snapText] of snapshot) {
        const p = p0 === target ? to : p0;
        const newText = text.get(p);
        const oldText = p0 === mid ? midLine + snapText : snapText; // the mid-move write is expected
        assert.equal(skeleton(newText), skeleton(oldText), `${p}: text outside links changed`);
        const oldLinks = linksOf(oldText), newLinks = linksOf(newText);
        assert.equal(newLinks.length, oldLinks.length, `${p}: number of links changed`);
        for (let i = 0; i < oldLinks.length; i++) {
          const wasTarget = (() => { const d = resolve(targetOf(oldLinks[i].text), p0 === target ? to : p0); return false || (pre.has(p0) && targetOf(oldLinks[i].text) && baseOf(targetOf(oldLinks[i].text)).toLowerCase() === b.toLowerCase()); })();
          const ownRelative = p0 === target && /^\.\.?\//.test(targetOf(oldLinks[i].text));
          if (ownRelative) {
            const was = resolveBefore.get(p0)?.get(oldLinks[i].text) ?? null, now = resolve(targetOf(newLinks[i].text), p);
            assert.equal(now ? now.path : null, was, `${p}: its own relative link no longer reaches ${was}: ${newLinks[i].text}`);
            assert.equal(shape(newLinks[i].text), shape(oldLinks[i].text), `${p}: its own relative link lost its form: ${newLinks[i].text}`);
          } else if (!wasTarget) assert.equal(newLinks[i].text, oldLinks[i].text, `${p}: a link that did not reach the target changed`);
          else assert.equal(shape(newLinks[i].text), shape(oldLinks[i].text), `${p}: a rewritten link lost its subpath, alias or form: ${oldLinks[i].text} -> ${newLinks[i].text}`);
        }
        const after = reach(p, newText, to);
        assert.equal(after, pre.get(p0) ?? 0, `${p}: reached the note ${pre.get(p0) ?? 0} times before, ${after} after`);
        // A link that reached the note before must not be left naming it unresolved.
        const reachedBefore = new Set(oldLinks.filter((l) => { const d = resolveBefore.get(p0)?.get(l.text); return d === target; }).map((l) => l.text));
        for (const l of newLinks) {
          const lp = targetOf(l.text);
          if (reachedBefore.has(l.text) && !resolve(lp, p)) assert.fail(`${p}: still links the old name unresolved: ${l.text}`);
        }
      }
    });
  }

  // The parser against Obsidian's own index, link by link, on every copied note. A link only
  // the index has is one a move could miss (the move's index cross-check reports such a note);
  // a link only the parser has sits in markdown Obsidian reads another way (a table cell split
  // by an alias bar, an indented code block). Both must stay rare.
  test("the parser agrees with Obsidian's index on the copy", async () => {
    const { parseLinks } = await import("../src/mcp/link-rewrite.ts");
    let agree = 0, onlyIndex = 0, onlyParser = 0;
    for (const [p, e] of Object.entries(exp.entries)) {
      const t = texts.get(p);
      const fm = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(t);
      const indexed = new Set([...e.links, ...e.embeds].map((l) => l.start));
      const parsed = new Set(parseLinks(t).filter((l) => l.start >= (fm ? fm[0].length : 0)).map((l) => l.start));
      for (const s of indexed) if (parsed.has(s)) agree++; else onlyIndex++;
      for (const s of parsed) if (!indexed.has(s)) onlyParser++;
    }
    console.log(`[damage] parser vs Obsidian's index: ${agree} links agree, ${onlyIndex} only in the index, ${onlyParser} only in the parser`);
    assert.ok(onlyIndex <= agree * 0.0005, `${onlyIndex} links only in the index`);
    assert.ok(onlyParser <= agree * 0.002, `${onlyParser} links only in the parser`);
  });

  test("summary", () => {
    const ms = summary.ms.sort((a, b) => a - b);
    console.log(`[damage] ${summary.moves} moves, ${summary.links} links rewritten, ${summary.streamNotes} stale notes in the stream; move time median ${ms[Math.floor(ms.length / 2)] ?? 0} ms, max ${ms.at(-1) ?? 0} ms`);
  });
});
