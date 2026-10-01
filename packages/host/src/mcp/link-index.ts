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
// index is ready (linkIndexReady). The fast move finds links from note TEXT and
// uses this only as a cross-check, so it does not wait for readiness.
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
  isCacheClean?: () => boolean;
  onCleanCache?: (cb: () => void) => void;
}

const cleanOnce = new WeakMap<object, boolean>();

/**
 * False until Obsidian has finished its first full link resolution after a
 * start. Before that, `resolvedLinks` holds only some sources and a backlink
 * answer would be short with no sign of it. `initialized` (file caches loaded)
 * is not enough: the link resolver fills `resolvedLinks` after it. Obsidian's
 * own `isCacheClean()` is true when no cache work is in progress and the
 * resolver queue is empty. Ready LATCHES the first time the cache is seen clean
 * (or `onCleanCache` fires), so the brief dirty moments every later write causes
 * never turn into refusals. Both members are internal (absent from the public
 * types); when they are missing, only an explicit `initialized === false`
 * counts as not ready.
 */
export function linkIndexReady(app: App): boolean {
  const mc = app.metadataCache as unknown as CacheInternals;
  if (cleanOnce.get(mc) === true) return true;
  if (mc.initialized === false) return false;
  if (typeof mc.isCacheClean !== "function") return true;
  if (mc.isCacheClean()) {
    cleanOnce.set(mc, true);
    return true;
  }
  if (!cleanOnce.has(mc)) {
    cleanOnce.set(mc, false);
    mc.onCleanCache?.(() => cleanOnce.set(mc, true));
  }
  return false;
}

/** The typed refusal `obsidian_get_backlinks` gives while the index is not ready: retryable. */
export class LinkIndexLoadingError extends Error {
  readonly code = "index_loading";
  constructor() {
    super("Obsidian is still loading its link index after a start, so backlinks would be incomplete; retry in a minute");
    this.name = "LinkIndexLoadingError";
  }
}
