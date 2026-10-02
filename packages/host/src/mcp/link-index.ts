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
  linkResolverQueue?: { items?: unknown[]; runnable?: { isRunning?: () => boolean } };
  isCacheClean?: () => boolean;
  onCleanCache?: (cb: () => void) => void;
  on?: (name: string, cb: (...args: unknown[]) => unknown) => unknown;
}

const readyOnce = new WeakMap<object, boolean>();

/**
 * False until Obsidian has finished its first full link resolution after a
 * start. Before that, `resolvedLinks` holds only some sources and a backlink
 * answer would be short with no sign of it. `initialized` (file caches loaded)
 * is not enough: the link resolver fills `resolvedLinks` after it, so an
 * explicit `initialized === false` is always not ready.
 *
 * Why not `isCacheClean()`: it also needs `inProgressTaskCount === 0`, and every
 * write bumps that count. Under heavy fleet write load the cache can stay dirty
 * for 1 to 25 minutes (the wait `app.fileManager.renameFile` has, see
 * docs/reference.md), so a backlinks call would refuse that long after each
 * start although `resolvedLinks` was complete long before. The signal that
 * matters is the LINK RESOLVER alone, so ready latches the first time either:
 * (a) `initialized` is true and the resolver queue is empty and idle
 * (`linkResolverQueue.items.length === 0 && !runnable.isRunning()`), whatever
 * `inProgressTaskCount` says; or (b) a metadataCache `'resolved'` event fires
 * while `initialized` is true (Obsidian fires it when link resolution finishes;
 * the listener is registered once, lazily, on the first not-ready call).
 * Once ready, always ready for that app, so later resolver work after a write
 * never turns into a refusal.
 *
 * All these members are internal (absent from the public types). When the
 * resolver queue is missing, `isCacheClean()` / `onCleanCache` stand in (the
 * stricter old signal); when those are missing too, only an explicit
 * `initialized === false` counts as not ready.
 */
export function linkIndexReady(app: App): boolean {
  const mc = app.metadataCache as unknown as CacheInternals;
  if (readyOnce.get(mc) === true) return true;
  if (mc.initialized === false) {
    listenOnce(mc);
    return false;
  }
  const q = mc.linkResolverQueue;
  let idle: boolean;
  if (q && Array.isArray(q.items) && typeof q.runnable?.isRunning === "function") {
    idle = q.items.length === 0 && !q.runnable.isRunning();
  } else if (typeof mc.isCacheClean === "function") {
    idle = mc.isCacheClean();
  } else {
    idle = true;
  }
  if (idle) {
    readyOnce.set(mc, true);
    return true;
  }
  listenOnce(mc);
  return false;
}

function listenOnce(mc: CacheInternals): void {
  if (readyOnce.has(mc)) return;
  readyOnce.set(mc, false);
  const latch = () => {
    if (mc.initialized !== false) readyOnce.set(mc, true);
  };
  mc.on?.("resolved", latch);
  if (!mc.linkResolverQueue) mc.onCleanCache?.(latch);
}

/** The typed refusal `obsidian_get_backlinks` gives while the index is not ready: retryable. */
export class LinkIndexLoadingError extends Error {
  readonly code = "index_loading";
  constructor() {
    super("Obsidian is still loading its link index after a start, so backlinks would be incomplete; retry shortly");
    this.name = "LinkIndexLoadingError";
  }
}
