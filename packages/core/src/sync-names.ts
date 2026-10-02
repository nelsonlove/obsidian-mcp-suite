// Names Obsidian Sync refuses, and names that break links.
//
// Obsidian Sync does not sync a file or folder whose name holds any of
// \ / : * ? " < > |, and in a note name # ^ [ ] break wikilinks. The vault's own
// scripts refuse the same set (`new-link` in 00.13 Scripts; `convert-clipping-
// to-link` repairs it). vault-mcp refuses it too when a tool would CREATE such a
// name: a new note written, or a note moved or renamed onto it. A note that
// already has such a name stays writable in place; only a new name is refused.
// A backslash is already refused as a path for every tool (`invalid_path`).

/** One character of the refused set, in a single path segment. */
export const SYNC_UNSAFE_CHARS = /[\\:*?"<>|#^[\]]/g;

export class UnsafeNameError extends Error {
  readonly code = "unsafe_name";
  constructor(message: string) {
    super(message);
    this.name = "UnsafeNameError";
  }
}

/** The refused characters found in each segment of a vault-relative path, or null when it has none. */
export function syncUnsafeChars(relPath: string): string[] | null {
  const found = new Set<string>();
  for (const seg of relPath.split("/")) for (const m of seg.matchAll(SYNC_UNSAFE_CHARS)) found.add(m[0]);
  return found.size > 0 ? [...found] : null;
}

/** Throw `unsafe_name` when `relPath` holds a character Obsidian Sync refuses or one that breaks links. */
export function assertSyncSafeName(relPath: string): void {
  const chars = syncUnsafeChars(relPath);
  if (!chars) return;
  throw new UnsafeNameError(
    `'${relPath}' holds ${chars.map((c) => `'${c}'`).join(", ")}: Obsidian Sync does not sync a name with any of \\ : * ? " < > |, ` +
      "and # ^ [ ] break links. Nothing was written. Choose a name without them (for example ' - ' for ': '); keep the full title in `title:`."
  );
}
