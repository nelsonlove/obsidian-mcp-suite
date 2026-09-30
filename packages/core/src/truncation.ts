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
 * Two guards:
 *   - `assertNotTruncatedRead` — every write path that takes text from the
 *     caller (the content of a write, the fragment of a patch or an append)
 *     calls it over THAT TEXT, before any mutation. A trailer line in it means
 *     the caller is handing back a cut read, and the write is refused with
 *     `Error [truncated_read]`. It is never run over the note that would
 *     result: a note that already carries such a line stays editable, and a
 *     rewrite the caller did not author (a move healing its backlinks) is not
 *     bound by it.
 *   - `isCutRead` — the read tools (`register-fs-tools.ts`) report a cut read
 *     as `truncated: true` and withhold its `rev`, so a caller that strips
 *     the trailer and tries anyway is refused for the missing precondition.
 */

/** Matches the trailer as a whole line, anywhere in the text, with any
 *  surrounding whitespace or a CR (an editor that pads or re-terminates the
 *  line must not slip the guard). Text that merely MENTIONS the trailer inside
 *  a sentence or a code span never matches; a line that IS the trailer,
 *  wherever it stands, does — that is the price of catching a cut read that a
 *  caller appended below (matching only at the end would miss it). */
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

/** True when `text` carries the trailer line — a cut read, not authored text. */
export function carriesTruncationTrailer(text: string): boolean {
  return TRUNCATION_TRAILER_RE.test(text);
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

/** Refuse `text` the caller supplied when it is a cut read. Called by every
 *  write path that takes text from the caller, over that text, BEFORE any
 *  mutation. */
export function assertNotTruncatedRead(path: string, text: string): void {
  if (carriesTruncationTrailer(text)) throw new TruncatedReadError(path);
}
