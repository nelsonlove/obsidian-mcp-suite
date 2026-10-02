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

/** A JD archive folder: `00.09 Archive`, `41.09 Archive for 41 Banking & accounts`, `06.37.09 Archive for …`; never one whose own name holds a bracket. */
const ARCHIVE_SEGMENT = /^\d\d(?:\.\d\d)*\.09 Archive(?: [^[\]]*)?$/;

/** The path of the deepest JD archive folder `relPath` lies under, or null. */
export function jdArchiveFolder(relPath: string): string | null {
  const segs = relPath.split("/");
  let found: string | null = null;
  for (let i = 0; i < segs.length - 1; i++) if (ARCHIVE_SEGMENT.test(segs[i])) found = segs.slice(0, i + 1).join("/");
  return found;
}

/** True when a folder of `relPath` is named as a JD archive folder (whether it exists is the caller's to check). */
export function inJdArchive(relPath: string): boolean {
  return jdArchiveFolder(relPath) !== null;
}

/** True when any note other than `path` links to it, per a source → target → count map (Obsidian's `resolvedLinks`). */
export function hasInboundLinks(resolvedLinks: Record<string, Record<string, number> | undefined> | undefined, path: string): boolean {
  for (const [src, targets] of Object.entries(resolvedLinks ?? {})) if (src !== path && (targets?.[path] ?? 0) > 0) return true;
  return false;
}

/**
 * What the bracket rule needs from the caller. Without it, brackets are refused.
 * `linked`: whether any other note links to the note, or would once it exists
 * (unknown: true). `folderExists`: whether a folder exists now; an archive
 * folder the call would create does not count.
 */
export interface BracketContext {
  linked: boolean;
  folderExists: (folderPath: string) => boolean;
}

const BRACKETS = new Set(["[", "]"]);
const BRACKET_RULE =
  "[ ] are allowed only in the name of a note under an existing JD archive folder (NN.09 Archive…) that no other note links to, never in a folder name";

/** True when `relPath` lies under a JD archive folder that exists now. */
function inExistingArchive(relPath: string, ctx: BracketContext | undefined): boolean {
  const arch = jdArchiveFolder(relPath);
  return arch !== null && !!ctx && ctx.folderExists(arch);
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
 * one that breaks links, in any folder or in the note's name. Brackets in the
 * note's name pass only under the bracket rule (`ctx`).
 */
export function assertSyncSafeName(relPath: string, ctx?: BracketContext): void {
  const segs = relPath.split("/");
  const freeBrackets = !!ctx && !ctx.linked && inExistingArchive(relPath, ctx);
  const chars = new Set<string>();
  segs.forEach((seg, i) => {
    for (const c of syncUnsafeChars(seg) ?? []) if (!(i === segs.length - 1 && freeBrackets && BRACKETS.has(c))) chars.add(c);
  });
  if (chars.size === 0) return;
  throw new UnsafeNameError(unsafeMessage(`'${relPath}'`, [...chars], "holds", "Nothing was written."));
}

/**
 * Throw `unsafe_name` when a move or rename to `to` would ADD a name holding a
 * refused character. What may be KEPT: a folder the note is already in (the
 * same folder, by its whole path), and the note's own name. Anything new (a
 * new name, a folder it was not in) must be clean. Brackets: a new name may
 * hold them only under the bracket rule (`ctx`), and a kept name that holds
 * them may only stay under an existing JD archive folder.
 */
export function assertSyncSafeMove(from: string, to: string, ctx?: BracketContext): void {
  const fromSegs = from.split("/");
  const toSegs = to.split("/");
  const keptFolders = new Set(fromSegs.slice(0, -1).map((_, i) => fromSegs.slice(0, i + 1).join("/")));
  const chars = new Set<string>();
  let verb = "adds";
  for (let i = 0; i < toSegs.length - 1; i++) {
    if (keptFolders.has(toSegs.slice(0, i + 1).join("/"))) continue;
    for (const c of syncUnsafeChars(toSegs[i]) ?? []) chars.add(c);
  }
  const name = toSegs[toSegs.length - 1];
  const nameChars = syncUnsafeChars(name) ?? [];
  if (name === fromSegs[fromSegs.length - 1]) {
    // The note keeps its name: only brackets matter, and only outside an existing archive.
    if (!inExistingArchive(to, ctx)) for (const c of nameChars) if (BRACKETS.has(c)) { chars.add(c); verb = "keeps"; }
  } else {
    const freeBrackets = !!ctx && !ctx.linked && inExistingArchive(to, ctx);
    for (const c of nameChars) if (!(freeBrackets && BRACKETS.has(c))) chars.add(c);
  }
  if (chars.size === 0) return;
  throw new UnsafeNameError(unsafeMessage(`'${to}'`, [...chars], verb, "Nothing was moved."));
}
