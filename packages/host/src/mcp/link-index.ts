// "Who links to this note", from Obsidian's own link index.
//
// `metadataCache.resolvedLinks` maps source → target → count. It is the map
// Obsidian's native `getBacklinksForFile` reads, and no plugin in the vault
// replaces it, whereas `getBacklinksForFile` itself can be replaced: Advanced
// Metadata Cache 1.1.1 does, and for about 6 minutes after each Obsidian start
// (its first index build) it answered 1 where the native answer was 110 (#451).
// So every host road that asks the index who links a note asks here, and no
// host source calls `getBacklinksForFile` (pinned in read-boundary.test.mjs).
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

/**
 * False while Obsidian is still loading its file caches after a start; until
 * then `resolvedLinks` holds only some sources, and a backlink answer would be
 * short with no sign of it. `initialized` is internal (absent from the public
 * types), so only an explicit `false` counts as not ready.
 */
export function linkIndexReady(app: App): boolean {
  return (app.metadataCache as unknown as { initialized?: boolean }).initialized !== false;
}
