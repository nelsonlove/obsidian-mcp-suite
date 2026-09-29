// move-with-links.ts — a move that rewrites its own backlinks, without core's
// wait for a clean metadata cache (Nelson's "B", 2026-09-29, relayed:
// "Let's try be and run tests looking for damage").
//
// Why: `app.fileManager.renameFile` runs its link update behind
// `metadataCache.onCleanCache`, which resolves only when no indexing task is in
// progress and the link-resolver queue is empty. With about twenty agent
// sessions writing to the vault all the time that moment rarely comes: a rename
// of a note with no links took 63 s on a quiet vault and 357 s under load, and
// the area moves of 2026-09-29 took 6 to 25 minutes each.
//
// What it does instead:
//   1. FIND every note that may link the note, from its TEXT: every markdown
//      note whose text contains the note's name is read and parsed. The text is
//      always current, so a note written moments before (its index entry still
//      stale — the risk the ruling named) is found like any other, and so are
//      links Obsidian's index does not track (a link inside a frontmatter
//      string). The index (`resolvedLinks`) is used only as a cross-check.
//   2. RENAME at the file level (`vault.rename`), which does not wait.
//   3. REWRITE each note inside `vault.process`, at the planned positions when
//      its text is unchanged, and from its current text otherwise.
//   4. CHECK for damage and report it, never silently: no link may still name
//      the old path unresolved, every note must reach the moved note as often as
//      before, and every note the index says links it must have been found.

import { TFile, type App } from "obsidian";
import { parseLinks, rewriteLink, applyEdits, relativePath, folderOf, type TextLink, type Edit } from "./link-rewrite.js";

/** What the damage check found. `ok` is false whenever any list is non-empty (hidden notes included). */
export interface LinkCheck {
  ok: boolean;
  /** Links rewritten, and in which notes (the moved note's own relative links included). */
  links_rewritten: number;
  files_rewritten: string[];
  /** Notes read because their text names the note, and how many of them the index had not caught up with. */
  candidates: number;
  stale_sources: number;
  /** A link that still names the old path and now resolves to nothing. */
  still_linking_old: Array<{ path: string; link: string }>;
  /** A note that reached the note fewer times after the move than before. */
  not_reaching_new: Array<{ path: string; before: number; after: number }>;
  /** A note the index says links the note, where no link to it was found in its text. */
  index_only: string[];
  /** A note that could not be rewritten, and why. */
  failed: Array<{ path: string; reason: string }>;
  /** Milliseconds spent finding the links, and checking after the move. */
  find_ms: number;
  check_ms: number;
  /** Notes outside the caller's allowlist that the lists above do not name. */
  hidden: number;
}

export interface MoveWithLinksOptions {
  /** false: rename only, rewrite no links (the old `update_backlinks: false`, now honoured). */
  updateBacklinks?: boolean;
  /** Which paths the caller may see named; others are counted in `hidden`. Default: all. */
  visible?: (path: string) => boolean;
  /**
   * The vault's text, read once and shared by the moves of one batch. The scan
   * reads every note (about 1 to 2 s on a 22,000-note vault), so a batch of 50
   * moves would otherwise read the vault 50 times inside one 30 s queue slot.
   * Kept current by each move: rewritten notes and the renamed path.
   */
  texts?: TextCache;
}

/** Note text by path, read lazily and kept current by the moves that share it. */
export class TextCache {
  private readonly map = new Map<string, string>();
  constructor(private readonly app: App) {}
  async get(f: TFile): Promise<string> {
    const hit = this.map.get(f.path);
    if (hit !== undefined) return hit;
    const t = await this.app.vault.cachedRead(f);
    this.map.set(f.path, t);
    return t;
  }
  set(path: string, text: string): void { this.map.set(path, text); }
  rename(from: string, to: string): void { const t = this.map.get(from); this.map.delete(from); if (t !== undefined) this.map.set(to, t); }
}

interface Plan {
  path: string;
  text: string;
  edits: TextLink[];
  /** The link targets (as written) that reached the note before the move: what the fallback rewrites. */
  linkpaths: Set<string>;
  before: number;
}

const lower = (s: string) => s.toLowerCase();
const stripMd = (s: string) => s.replace(/\.md$/i, "");

/** The cache entry is current when Obsidian's recorded mtime and size match the file. */
function cacheIsFresh(app: App, f: TFile): boolean {
  const entry = (app.metadataCache as unknown as { fileCache?: Record<string, { mtime: number; size: number }> }).fileCache?.[f.path];
  return !!entry && entry.mtime === f.stat.mtime && entry.size === f.stat.size;
}

function resolves(app: App, linkpath: string, source: string): TFile | null {
  if (!linkpath) return null;
  return app.metadataCache.getFirstLinkpathDest(linkpath, source);
}

/**
 * Move `file` to `to` and rewrite every link to it. Throws only when the rename
 * itself fails (nothing moved). Every link-level problem is reported in the
 * returned LinkCheck instead.
 */
export async function moveWithLinks(app: App, file: TFile, to: string, opts: MoveWithLinksOptions = {}): Promise<LinkCheck> {
  const visible = opts.visible ?? (() => true);
  const update = opts.updateBacklinks !== false;
  const oldPath = file.path;
  const oldName = lower(file.basename);
  const check: LinkCheck = { ok: true, links_rewritten: 0, files_rewritten: [], candidates: 0, stale_sources: 0, still_linking_old: [], not_reaching_new: [], index_only: [], failed: [], find_ms: 0, check_ms: 0, hidden: 0 };

  // ── 1. find ───────────────────────────────────────────────────────────────
  const t0 = Date.now();
  const texts = opts.texts ?? new TextCache(app);
  const plans = new Map<string, Plan>();
  if (update) {
    for (const src of app.vault.getMarkdownFiles()) {
      const text = await texts.get(src);
      if (!lower(text).includes(oldName)) continue;
      check.candidates++;
      if (!cacheIsFresh(app, src)) check.stale_sources++;
      const edits = parseLinks(text).filter((l) => resolves(app, l.linkpath, src.path) === file);
      if (edits.length === 0) continue;
      plans.set(src.path, { path: src.path, text, edits, linkpaths: new Set(edits.map((l) => l.linkpath)), before: edits.length });
    }
    // Cross-check with the index: a note it says links the note, where the text scan found nothing.
    for (const [src, targets] of Object.entries(app.metadataCache.resolvedLinks ?? {})) {
      if (src === oldPath || plans.has(src) || !((targets?.[oldPath] ?? 0) > 0)) continue;
      check.index_only.push(src);
    }
  }
  // The moved note's own relative markdown links break when its folder changes: plan them against their targets.
  const ownText = await texts.get(file);
  const ownRelative = parseLinks(ownText)
    .filter((l) => l.kind === "markdown" && /\]\(<?\.\.?\//.test(l.original))
    .map((l) => ({ link: l, target: resolves(app, l.linkpath, oldPath) }))
    .filter((x): x is { link: TextLink; target: TFile } => x.target !== null && x.target !== file);
  check.find_ms = Date.now() - t0;

  // ── 2. rename, without waiting for the metadata cache ────────────────────
  await app.vault.rename(file, to);
  texts.rename(oldPath, to);

  // ── 3. rewrite ────────────────────────────────────────────────────────────
  const newPathOf = (p: string) => (p === oldPath ? to : p);
  const wikiTarget = (src: string) => app.metadataCache.fileToLinktext(file, src, true);
  const sources = [...plans.values()];
  if (ownRelative.length > 0 && !plans.has(oldPath)) sources.push({ path: oldPath, text: ownText, edits: [], linkpaths: new Set(), before: 0 });

  for (const plan of sources) {
    const srcPath = newPathOf(plan.path);
    const src = app.vault.getAbstractFileByPath(srcPath);
    if (!(src instanceof TFile)) { check.failed.push({ path: srcPath, reason: "note not found after the move" }); continue; }
    let n = 0;
    try {
      await app.vault.process(src, (data) => {
        // Planned positions when the text is what we read; else the links, re-found, whose target reached the note.
        const links = data === plan.text ? plan.edits : parseLinks(data).filter((l) => plan.linkpaths.has(l.linkpath));
        const edits: Edit[] = [];
        for (const l of links) {
          if (resolves(app, l.linkpath, srcPath) === file) continue; // the old text still reaches it by name
          edits.push({ start: l.start, end: l.end, expected: l.original, replacement: rewriteLink(l, to, srcPath, wikiTarget(srcPath)) });
        }
        if (srcPath === to) {
          const own = data === ownText ? ownRelative : [];
          for (const { link, target } of own) {
            if (resolves(app, link.linkpath, to) === target) continue;
            const hadMd = /\.md$/i.test(link.linkpath);
            const rel = relativePath(folderOf(to), hadMd ? target.path : stripMd(target.path));
            const m = /^(!?\[(?:[^\]\\]|\\.)*\]\()(<?)([^)>\s]*)(>?)(\s+"[^"]*")?\)$/.exec(link.original);
            if (!m) continue;
            const dest = m[2] ? rel + link.subpath : encodeURI(rel).replace(/\(/g, "%28").replace(/\)/g, "%29") + link.subpath.replace(/ /g, "%20");
            edits.push({ start: link.start, end: link.end, expected: link.original, replacement: `${m[1]}${m[2]}${dest}${m[4]}${m[5] ?? ""})` });
          }
        }
        const next = applyEdits(data, edits);
        if (next === null) throw new Error("the note's links overlap or moved while it was being rewritten");
        n = edits.length;
        texts.set(srcPath, next);
        return next;
      });
    } catch (e) {
      check.failed.push({ path: srcPath, reason: e instanceof Error ? e.message : String(e) });
      continue;
    }
    if (n > 0) { check.links_rewritten += n; check.files_rewritten.push(srcPath); }
  }

  // ── 4. check for damage ───────────────────────────────────────────────────
  const t1 = Date.now();
  if (update) {
    for (const plan of plans.values()) {
      const p = newPathOf(plan.path);
      const f = app.vault.getAbstractFileByPath(p);
      if (!(f instanceof TFile)) continue;
      let reaching = 0;
      for (const l of parseLinks(await app.vault.read(f))) {
        const dest = resolves(app, l.linkpath, p);
        if (dest === file) reaching++;
        // Only a link that reached the note before counts: one that was already broken is not this move's damage.
        else if (dest === null && plan.linkpaths.has(l.linkpath)) check.still_linking_old.push({ path: p, link: l.original });
      }
      if (reaching < plan.before) check.not_reaching_new.push({ path: p, before: plan.before, after: reaching });
    }
  }
  check.check_ms = Date.now() - t1;

  // Decide `ok` over everything, hidden notes included, then redact names the caller may not see.
  check.ok = check.still_linking_old.length === 0 && check.not_reaching_new.length === 0 && check.index_only.length === 0 && check.failed.length === 0;
  const keep = (p: string) => { if (visible(p)) return true; check.hidden++; return false; };
  check.still_linking_old = check.still_linking_old.filter((x) => keep(x.path));
  check.not_reaching_new = check.not_reaching_new.filter((x) => keep(x.path));
  check.failed = check.failed.filter((x) => keep(x.path));
  check.index_only = check.index_only.filter(keep);
  check.files_rewritten = check.files_rewritten.filter(keep);
  return check;
}
