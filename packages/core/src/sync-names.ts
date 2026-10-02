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
//
// Brackets: Nelson, 2026-10-02: "Brackets should only be permissible on
// archived notes that no other note links to." So `[` and `]` (and only those)
// pass when the note's path lies under a JD archive folder (`NN.09 Archive…`,
// any area, dotted IDs too) AND no other note links to it. A new note has no
// linkers; for a move the caller says whether the note has any.

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

/** A JD archive folder: `00.09 Archive`, `41.09 Archive for 41 Banking & accounts`, `06.37.09 Archive for …`. */
const ARCHIVE_SEGMENT = /^\d\d(?:\.\d\d)*\.09 Archive(?: |$)/;

/** True when a folder of `relPath` is a JD archive folder. */
export function inJdArchive(relPath: string): boolean {
  return relPath.split("/").slice(0, -1).some((seg) => ARCHIVE_SEGMENT.test(seg));
}

/** True when any note other than `path` links to it, per a source → target → count map (Obsidian's `resolvedLinks`). */
export function hasInboundLinks(resolvedLinks: Record<string, Record<string, number> | undefined> | undefined, path: string): boolean {
  for (const [src, targets] of Object.entries(resolvedLinks ?? {})) if (src !== path && (targets?.[path] ?? 0) > 0) return true;
  return false;
}

const BRACKETS = new Set(["[", "]"]);
const BRACKET_RULE = "[ ] are allowed only for a note under a JD archive folder (NN.09 Archive…) that no other note links to.";

/** The refused characters left once Nelson's bracket rule is applied to a note at `relPath`. */
function refused(chars: string[], relPath: string, linked: boolean): string[] {
  return inJdArchive(relPath) && !linked ? chars.filter((c) => !BRACKETS.has(c)) : chars;
}

function unsafeMessage(subject: string, chars: string[], verb: string, nothing: string): string {
  return (
    `${subject} ${verb} ${chars.map((c) => `'${c}'`).join(", ")}: Obsidian Sync does not sync a name with any of \\ : * ? " < > |, ` +
    `and # ^ [ ] break links${chars.some((c) => BRACKETS.has(c)) ? ` (${BRACKET_RULE})` : ""}. ${nothing} ` +
    "Choose a name without them (for example ' - ' for ': '); keep the full title in `title:`."
  );
}

/**
 * Throw `unsafe_name` when `relPath` holds a character Obsidian Sync refuses or
 * one that breaks links. `linked`: whether any other note links to it (a new
 * note: false). Unknown counts as linked, so brackets are refused.
 */
export function assertSyncSafeName(relPath: string, linked = true): void {
  const chars = refused(syncUnsafeChars(relPath) ?? [], relPath, linked);
  if (chars.length === 0) return;
  throw new UnsafeNameError(unsafeMessage(`'${relPath}'`, chars, "holds", "Nothing was written."));
}

/**
 * Throw `unsafe_name` when a move or rename to `to` would ADD a name holding a
 * refused character: judged per segment, so a folder or file name `from`
 * already has may be kept as it is, but any NEW segment (a new file name, a
 * folder the note was not in) must be clean. `linked`: whether any other note
 * links to the note (unknown counts as linked, so brackets are refused).
 */
export function assertSyncSafeMove(from: string, to: string, linked = true): void {
  const had = new Set(from.split("/"));
  const added = refused([...new Set(to.split("/").filter((seg) => !had.has(seg)).flatMap((seg) => syncUnsafeChars(seg) ?? []))], to, linked);
  if (added.length === 0) return;
  throw new UnsafeNameError(unsafeMessage(`'${to}'`, added, "adds", "Nothing was moved."));
}
