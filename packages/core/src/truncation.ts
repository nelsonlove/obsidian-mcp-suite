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
 * that knows the trailer's shape, so the reads that write it and the writes
 * that refuse it cannot drift apart.
 *
 * Two guards, both here:
 *   - `assertNotTruncatedRead` — every whole-note write path calls it over the
 *     content that would land; a trailer line means the content is a cut read,
 *     and the write is refused with `Error [truncated_read]` before any disk
 *     mutation.
 *   - `readNoteResult` — a cut read reports `truncated: true`, and the read
 *     tools withhold the `rev` on it, so a caller that strips the trailer and
 *     tries anyway is refused for the missing precondition.
 */

/** Matches the trailer as a whole line, anywhere in the content, with any
 *  surrounding whitespace or a CR (an editor that pads or re-terminates the
 *  line must not slip the guard). A note that merely MENTIONS the trailer
 *  inside a sentence or a code span never matches; a line that IS the trailer,
 *  wherever it stands, does — that is the price of catching a cut read that a
 *  caller appended below (matching only at the end would miss it). */
export const TRUNCATION_TRAILER_RE = /^[ \t]*\[truncated: note is \d+ chars, showing first \d+\][ \t\r]*$/m;

/** The trailer `readNote` appends after the cut content. */
export function truncationTrailer(length: number, limit: number): string {
  return `\n\n[truncated: note is ${length} chars, showing first ${limit}]`;
}

/** Cut `content` to `limit` characters and append the trailer, or return it whole. */
export function truncateForRead(content: string, limit: number): { content: string; truncated: boolean } {
  if (content.length <= limit) return { content, truncated: false };
  return { content: content.slice(0, limit) + truncationTrailer(content.length, limit), truncated: true };
}

/** True when `content` carries the trailer line — a cut read, not a whole note. */
export function carriesTruncationTrailer(content: string): boolean {
  return TRUNCATION_TRAILER_RE.test(content);
}

/** Typed refusal for a write of a cut read — rendered as `Error [truncated_read]`. */
export class TruncatedReadError extends Error {
  readonly code = "truncated_read";
  constructor(path: string) {
    super(
      `the content for '${path}' carries the read trailer '[truncated: note is N chars, showing first M]', so it is a cut read of a note longer than the read limit, and writing it would delete everything after the cut. Nothing was written. ` +
        "Edit the note by anchor instead (obsidian_patch_note, obsidian_append_note, obsidian_append_at_heading, obsidian_manage_frontmatter), or rewrite it from the whole file outside this read.",
    );
    this.name = "TruncatedReadError";
  }
}

/** Refuse `content` that is a cut read. Called by every whole-note write path
 *  BEFORE any mutation, over the content that would land on disk. */
export function assertNotTruncatedRead(path: string, content: string): void {
  if (carriesTruncationTrailer(content)) throw new TruncatedReadError(path);
}
