// "Who links to this note", from Obsidian's own link index.
//
// `metadataCache.resolvedLinks` maps source → target → count. It is the map
// Obsidian's native `getBacklinksForFile` reads, and no plugin in the vault
// replaces it, whereas `getBacklinksForFile` itself can be replaced: Advanced
// Metadata Cache 1.1.1 does, and for about 6 minutes after each Obsidian start
// (its first index build) it answered 1 where the native answer was 110 (#451).
// So every host road that asks the index who links a note asks here, and no
// host source calls `getBacklinksForFile` (pinned in read-boundary.test.mjs).
// `obsidian_get_backlinks` answers from this alone, so it refuses until the
// index covers every note (linkIndexReady). The fast move finds links from
// note TEXT and uses this only as a cross-check, so it does not wait for that.
//
// What the index does not hold: links from `.canvas` files (native backlinks
// never listed them; Advanced Metadata Cache adds them), and links in a note
// whose cache Obsidian has not yet resolved. The note's own links to itself
// (a `[[#Heading]]` table of contents) are left out.

import type { App } from "obsidian";

export interface IndexedLinker {
  src: string;
  count: number;
}

export function indexedLinkers(app: App, target: string): IndexedLinker[] {
  const out: IndexedLinker[] = [];
  for (const [src, targets] of Object.entries(app.metadataCache.resolvedLinks ?? {})) {
    if (src === target) continue;
    const count = targets?.[target] ?? 0;
    if (count > 0) out.push({ src, count });
  }
  return out;
}

interface CacheInternals {
  initialized?: boolean;
  inProgressTaskCount?: number;
}

const ready = new WeakSet<object>();

/**
 * False until `resolvedLinks` covers every markdown note after a start. Before
 * that a backlink answer would be short with no sign of it.
 *
 * What Obsidian (1.13.7, app.js) does: `resolvedLinks` starts empty on every
 * start and is not persisted. The link resolver calls `resolveLinks(path)` for
 * each note it takes from its queue, and that writes `resolvedLinks[path]`,
 * an empty `{}` when the note links nothing, for every note that has a parsed
 * cache. `initialized` turns true once the file caches are loaded, which is
 * BEFORE the resolver has run, and notes whose cache was stale are re-read
 * (`computeFileMetadataAsync`, counted in `inProgressTaskCount`) and join the
 * queue only later; the queue can drain, and fire `'resolved'`, in between.
 * So neither `initialized`, nor an idle queue, nor a `'resolved'` event means
 * the map is complete. `isCacheClean()` would, but it also waits for every
 * write's re-index, and under heavy fleet write load the cache can stay dirty
 * for minutes.
 *
 * The check is therefore on the map itself: ready when `initialized` is not
 * false and every `vault.getMarkdownFiles()` path has a key in `resolvedLinks`.
 * One exception: a note whose metadata failed to parse ("Metadata failed to
 * parse") has no cache and never gets a key. A note with no key and no cache
 * is either that or a note still being read for the first time, and the two
 * look alike, so such notes are let through only when `inProgressTaskCount`
 * is 0 (nothing is still being read). Notes without a cache then wait for a
 * quiet moment; notes with one never do.
 *
 * Ready LATCHES per metadataCache: once ready, always ready, so a note created
 * or changed later (no key until the resolver reaches it) never turns into a
 * refusal, and the pass over the notes runs only until the latch.
 */
export function linkIndexReady(app: App): boolean {
  const mc = app.metadataCache;
  if (ready.has(mc)) return true;
  const internals = mc as unknown as CacheInternals;
  if (internals.initialized === false) return false;
  const resolved = mc.resolvedLinks ?? {};
  let uncached = false;
  for (const file of app.vault.getMarkdownFiles()) {
    if (Object.prototype.hasOwnProperty.call(resolved, file.path)) continue;
    if (mc.getFileCache(file)) return false;
    uncached = true;
  }
  if (uncached && (internals.inProgressTaskCount ?? 0) > 0) return false;
  ready.add(mc);
  return true;
}

/** The typed refusal `obsidian_get_backlinks` gives while the index is not ready: retryable. */
export class LinkIndexLoadingError extends Error {
  readonly code = "index_loading";
  constructor() {
    super("Obsidian is still loading its link index after a start, so backlinks would be incomplete; retry shortly");
    this.name = "LinkIndexLoadingError";
  }
}
