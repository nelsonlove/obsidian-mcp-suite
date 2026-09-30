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
 *   - `wholeNoteOverwriteRefusal`, the mechanism behind the marker: a caller
 *     that deletes the "junk" trailer line and writes back still loses the
 *     tail, whatever it adds. No read over this transport returns a note
 *     longer than the limit whole, so a whole-note overwrite of such a note
 *     (`content` with `overwrite: true`) is refused at each transport's
 *     interception, before the queue, from the note's length on disk. A long
 *     note is edited by anchor; a deliberate shrink below the limit goes by
 *     anchor or through a fresh path. A caller that reaches a backend
 *     directly is not bound by this rule (it did not read over the limit).
 *
 * The read tools report a cut read as `truncated: true` (`isCutRead`). They
 * still return its `rev`: the rev is not what lost the tail, the content was,
 * and an anchored edit of a long note (`obsidian_patch_note`,
 * `obsidian_manage_frontmatter`) needs it.
 */

/** The trailer's one spelling. Every other form here — the trailer a read
 *  appends, the whole-line match, the end-of-read match — is built from it. */
function trailerLine(n: string, m: string): string {
  return `[truncated: note is ${n} chars, showing first ${m}]`;
}
const NUM = "\u0000";
const TRAILER_SRC = trailerLine(NUM, NUM)
  .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  .split(NUM)
  .join("\\d+");

/** Matches the trailer as a whole line, anywhere in the text, with any
 *  surrounding whitespace or a CR (an editor that pads or re-terminates the
 *  line must not slip the guard). Text that merely MENTIONS the trailer inside
 *  a sentence or a code span, or with letters for the numbers, never matches;
 *  a line that IS the trailer, wherever it stands, does — that is the price of
 *  catching a cut read that a caller appended below, or closed a fence after
 *  (matching only at the end, or outside fences, would miss it). */
export const TRUNCATION_TRAILER_RE = new RegExp(`^[ \\t]*${TRAILER_SRC}[ \\t\\r]*$`, "m");

/** The trailer at the very end of a read, exactly as `truncateForRead` writes it. */
const TRAILER_AT_END_RE = new RegExp(`\\n\\n${TRAILER_SRC}$`);

/** The trailer `readNote` appends after the cut content. */
export function truncationTrailer(length: number, limit: number): string {
  return `\n\n${trailerLine(String(length), String(limit))}`;
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

/** The interception-point rule for a whole-note overwrite: a call that
 *  carries `content` with `overwrite: true` for a note whose length on disk
 *  (`noteLength`, in characters; undefined when the note does not exist)
 *  exceeds the read limit is refused, because no read over the transport
 *  returned that note whole — whatever the caller did to the cut read. Run
 *  BEFORE the queue, like `cutReadError`. */
export async function wholeNoteOverwriteRefusal(
  args: Record<string, unknown> | undefined,
  noteLength: (path: string) => Promise<number | undefined>,
  limit: number,
): Promise<TruncatedReadError | null> {
  if (!args || typeof args.content !== "string" || args.overwrite !== true || typeof args.path !== "string") return null;
  const onDisk = await noteLength(args.path);
  if (onDisk === undefined || onDisk <= limit) return null;
  return new TruncatedReadError(
    args.path,
    `'${args.path}' is ${onDisk} chars on disk, longer than the read limit of ${limit}: no read here returned that note whole, so a whole-note overwrite of it would write back a cut read, whatever was edited in. Nothing was written. ${WAY_OUT} ` +
      "To shrink the note below the limit on purpose, cut it by anchor, or write the shorter note to a fresh path and move it over this one.",
  );
}

/** The interception-point check, for a transport's mutate step: the call's
 *  `content` or `body` argument (the names under which every tool takes text
 *  from the caller; read at the top level of the call's arguments, which is
 *  where every tool declares them — a batch item is dispatched as its own
 *  call) is a cut read. Returns the refusal, or null when the call carries
 *  none. */
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
