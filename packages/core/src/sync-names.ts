// Names Obsidian Sync refuses, and names that break links.
//
// Obsidian Sync does not sync a file or folder whose name holds any of
// \ / : * ? " < > |, and in a note name # ^ [ ] break wikilinks. The vault's own
// scripts refuse the same set (`new-link` in 00.13 Scripts; `convert-clipping-
// to-link` repairs it). vault-mcp refuses it too where a note is CREATED (the
// backends' create branches, and the host tools that call vault.create) and
// where one is RENAMED (the fast move, and the filesystem server's move): a
// note that already has such a name stays writable in place, and a move may
// keep a refused character the note already had, but may not add one. A
// backslash is already refused as a path for every tool (`invalid_path`).

/** The refused set: one character of it. Not global, so `.test` is safe to reuse. */
export const SYNC_UNSAFE_CHARS = /[\\:*?"<>|#^[\]]/;
const SYNC_UNSAFE_ALL = new RegExp(SYNC_UNSAFE_CHARS.source, "g");

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
  for (const m of relPath.matchAll(SYNC_UNSAFE_ALL)) found.add(m[0]);
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

/** Throw `unsafe_name` when a move or rename to `to` would ADD a refused character that `from` does not already hold. */
export function assertSyncSafeMove(from: string, to: string): void {
  const had = new Set(syncUnsafeChars(from) ?? []);
  const added = (syncUnsafeChars(to) ?? []).filter((c) => !had.has(c));
  if (added.length === 0) return;
  throw new UnsafeNameError(
    `'${to}' adds ${added.map((c) => `'${c}'`).join(", ")}: Obsidian Sync does not sync a name with any of \\ : * ? " < > |, ` +
      "and # ^ [ ] break links. Nothing was moved. Choose a name without them (for example ' - ' for ': '); keep the full title in `title:`."
  );
}
