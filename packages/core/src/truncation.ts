/**
 * The read trailer, and the guard that keeps a cut read from becoming a cut
 * write (#441).
 *
 * `readNote` on both backends returns only the first CHARACTER_LIMIT
 * characters of a longer note and appends one line naming the cut:
 *
 *     [truncated: note is N chars, showing first LIMIT]
 *
 * On 2026-09-30 three vault notes lost their tails: a caller read one, edited
 * the text it got back, and wrote it with `write_note`. `if_rev` matched (the
 * note had not changed), so nothing stopped it. This module is the one place
 * that knows the trailer's shape, so the reads that write it, the read tools
 * that report it, and the writes that refuse it cannot drift apart.
 *
 * Two guards, both rendered as `Error [truncated_read]`:
 *
 *   - `assertNotTruncatedRead`, over text the CALLER supplies — the content
 *     of a write, the fragment of a patch or an append — never over the note
 *     that would result, so a note that already carries such a line stays
 *     editable and a rewrite the caller did not author (a move healing its
 *     backlinks) is not bound. It runs before the queue at each transport's
 *     interception (`cutReadRefusal`: the host's guarded.ts over `content` /
 *     `body`, the FS server's mutate over the same), so every tool that takes
 *     text is covered without knowing it, and again inside each backend write
 *     that takes text, as the last line for direct callers. No code fence is
 *     exempt: a cut can land inside a fence, and a caller that closes it would
 *     otherwise hide the trailer. A note that must show the trailer on a line
 *     of its own writes it with letters (`N chars`, `showing first M`), which
 *     the digit match never takes for a cut.
 *   - `assertWholeNoteOverwrite`, the mechanism behind the marker: a caller
 *     that deletes the "junk" trailer line and writes back still loses the
 *     tail. So a whole-note overwrite of a note LONGER than the read limit
 *     with content no longer than a cut read could be is refused by
 *     `writeNote` on both backends, at the write (it needs the note's length
 *     on disk, so unlike the first guard it is journaled as an error). A
 *     rewrite from the whole note is longer than that and lands; a deliberate
 *     shrink below the limit goes by anchor, or through a fresh note.
 *
 * The read tools report a cut read as `truncated: true` (`isCutRead`). They
 * still return its `rev`: the rev is not what lost the tail, the content was,
 * and an anchored edit of a long note (`obsidian_patch_note`,
 * `obsidian_manage_frontmatter`) needs it.
 */

/** Matches the trailer as a whole line, anywhere in the text, with any
 *  surrounding whitespace or a CR (an editor that pads or re-terminates the
 *  line must not slip the guard). Text that merely MENTIONS the trailer inside
 *  a sentence or a code span, or with letters for the numbers, never matches;
 *  a line that IS the trailer, wherever it stands, does — that is the price of
 *  catching a cut read that a caller appended below, or closed a fence after
 *  (matching only at the end, or outside fences, would miss it). */
export const TRUNCATION_TRAILER_RE = /^[ \t]*\[truncated: note is \d+ chars, showing first \d+\][ \t\r]*$/m;

/** The trailer at the very end of a read, exactly as `truncateForRead` writes it. */
const TRAILER_AT_END_RE = /\n\n\[truncated: note is \d+ chars, showing first \d+\]$/;

/** The trailer `readNote` appends after the cut content. */
export function truncationTrailer(length: number, limit: number): string {
  return `\n\n[truncated: note is ${length} chars, showing first ${limit}]`;
}

/** Cut `content` to `limit` characters and append the trailer, or return it whole. */
export function truncateForRead(content: string, limit: number): string {
  if (content.length <= limit) return content;
  return content.slice(0, limit) + truncationTrailer(content.length, limit);
}

/** True when `content`, as a backend's `readNote` returned it, is a cut read:
 *  longer than the limit (uncut content never is) AND ending in the trailer
 *  (a backend that does not cut returns a long note whole, with no trailer).
 *  A short note that quotes a trailer-shaped line is never a cut read. */
export function isCutRead(content: string, limit: number): boolean {
  return content.length > limit && TRAILER_AT_END_RE.test(content);
}

/** True when `text` carries the trailer line — a cut read, not authored text.
 *  One linear scan; no code context is exempt (see the module doc). */
export function carriesTruncationTrailer(text: string): boolean {
  return TRUNCATION_TRAILER_RE.test(text);
}

const WAY_OUT =
  "Edit the note by anchor instead (obsidian_patch_note, obsidian_append_note, obsidian_append_at_heading, obsidian_manage_frontmatter; a cut read's rev is good for those), or rewrite it from the whole note read outside this limit.";

/** Typed refusal — rendered as `Error [truncated_read]`. Built by the two
 *  guards below; `new TruncatedReadError(path)` is the trailer refusal. */
export class TruncatedReadError extends Error {
  readonly code = "truncated_read";
  constructor(path: string, message?: string) {
    super(
      message ??
        `the content for '${path}' carries the read trailer '[truncated: note is N chars, showing first M]' on a line of its own, so it is a cut read (or text copied from one), and writing it would delete everything after the cut. Nothing was written. ${WAY_OUT} ` +
          "If that line is quoted on purpose, write its numbers as letters (N, M).",
    );
    this.name = "TruncatedReadError";
  }
}

/** Refuse `text` the caller supplied when it is a cut read. Called by every
 *  write path that takes text from the caller, over that text, BEFORE any
 *  mutation. */
export function assertNotTruncatedRead(path: string, text: string): void {
  if (carriesTruncationTrailer(text)) throw new TruncatedReadError(path);
}

/** Refuse a whole-note overwrite that could only have come from a cut read:
 *  the note on disk is longer than the read limit, and the content is no
 *  longer than a cut read of it could be (the limit plus the trailer), so no
 *  read of this note returned what the caller is replacing. Called by
 *  `writeNote` on both backends when the note exists, BEFORE the write. */
export function assertWholeNoteOverwrite(path: string, onDiskLength: number, content: string, limit: number): void {
  if (onDiskLength <= limit) return;
  const cutReadMax = limit + truncationTrailer(onDiskLength, limit).length;
  if (content.length > cutReadMax) return;
  throw new TruncatedReadError(
    path,
    `'${path}' is ${onDiskLength} chars on disk, longer than the read limit of ${limit}, and this content is ${content.length} chars: no read returned that note whole, so a whole-note write this short would delete its tail. Nothing was written. ${WAY_OUT} ` +
      "To shrink the note below the limit on purpose, cut it by anchor, or write the shorter note to a fresh path and move it over this one.",
  );
}

/** The interception-point check, for a transport's mutate step: the call's
 *  `content` or `body` argument (the names under which every tool takes text
 *  from the caller, always at the top level) is a cut read. Returns the
 *  refusal, or null when the call carries none. */
export function cutReadError(args: Record<string, unknown> | undefined): TruncatedReadError | null {
  if (!args) return null;
  for (const key of ["content", "body"]) {
    const v = args[key];
    if (typeof v === "string" && carriesTruncationTrailer(v)) {
      return new TruncatedReadError(typeof args.path === "string" ? args.path : "the target");
    }
  }
  return null;
}

/** `cutReadError` as a coded refusal, for the host's guard. */
export function cutReadRefusal(args: unknown): { code: "truncated_read"; message: string } | null {
  const e = cutReadError(args && typeof args === "object" ? (args as Record<string, unknown>) : undefined);
  return e ? { code: e.code, message: e.message } : null;
}
