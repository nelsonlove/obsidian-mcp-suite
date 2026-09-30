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
 * The guard is `assertNotTruncatedRead`, over text the CALLER supplies — the
 * content of a write, the fragment of a patch or an append — never over the
 * note that would result, so a note that already carries such a line stays
 * editable and a rewrite the caller did not author (a move healing its
 * backlinks) is not bound. It runs twice: once at the host's tool
 * interception (`cutReadRefusal`, over every string argument named `content`
 * or `body` of a mutating call, before the queue, so every tool that takes
 * text is covered without knowing it), and once inside each backend write
 * that takes text, as the last line for callers that reach a backend
 * directly. A closed fenced code block is skipped, so a note that documents
 * the trailer verbatim can be written; a fence left open by the cut is not.
 *
 * The read tools report a cut read as `truncated: true` (`isCutRead`). They
 * still return its `rev`: the rev is not what lost the tail, the content was,
 * and an anchored edit of a long note (`obsidian_patch_note`,
 * `obsidian_manage_frontmatter`) needs it.
 */

/** Matches the trailer as a whole line, anywhere in the text, with any
 *  surrounding whitespace or a CR (an editor that pads or re-terminates the
 *  line must not slip the guard). Text that merely MENTIONS the trailer inside
 *  a sentence or a code span never matches; a line that IS the trailer,
 *  wherever it stands outside a closed code fence, does — that is the price
 *  of catching a cut read that a caller appended below (matching only at the
 *  end would miss it). */
export const TRUNCATION_TRAILER_RE = /^[ \t]*\[truncated: note is \d+ chars, showing first \d+\][ \t\r]*$/m;

/** The trailer at the very end of a read, exactly as `truncateForRead` writes it. */
const TRAILER_AT_END_RE = /\n\n\[truncated: note is \d+ chars, showing first \d+\]$/;

/** A CLOSED fenced code block (``` or ~~~, matching fence, on its own line
 *  each). A fence the cut left open never matches, so the trailer after it
 *  stays visible to the guard. */
const CLOSED_FENCE_RE = /^[ \t]*(`{3,}|~{3,})[^\n]*\r?\n[\s\S]*?^[ \t]*\1[ \t]*\r?$/gm;

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

/** True when `text` carries the trailer line outside a closed code fence —
 *  a cut read, not authored text. */
export function carriesTruncationTrailer(text: string): boolean {
  return TRUNCATION_TRAILER_RE.test(text.replace(CLOSED_FENCE_RE, ""));
}

/** Typed refusal for a write of a cut read — rendered as `Error [truncated_read]`. */
export class TruncatedReadError extends Error {
  readonly code = "truncated_read";
  constructor(path: string) {
    super(
      `the content for '${path}' carries the read trailer '[truncated: note is N chars, showing first M]', so it is a cut read of a note longer than the read limit, and writing it would delete everything after the cut. Nothing was written. ` +
        "Edit the note by anchor instead (obsidian_patch_note, obsidian_append_note, obsidian_append_at_heading, obsidian_manage_frontmatter; a cut read's rev is good for those), or rewrite it from the whole file outside this read.",
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

/** The argument names under which a tool takes text from the caller. */
const TEXT_ARG_KEYS = new Set(["content", "body"]);

function argsCarryCutRead(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => argsCarryCutRead(v, depth + 1));
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (TEXT_ARG_KEYS.has(k) && typeof v === "string" && carriesTruncationTrailer(v)) return true;
    if (argsCarryCutRead(v, depth + 1)) return true;
  }
  return false;
}

/** The interception-point check: a mutating call whose `content` or `body`
 *  argument (at any depth — a batch item counts) is a cut read is refused
 *  before the queue, whatever the tool. Null when the call carries none. */
export function cutReadRefusal(args: unknown): { code: "truncated_read"; message: string } | null {
  if (!argsCarryCutRead(args)) return null;
  const path = args && typeof args === "object" && typeof (args as { path?: unknown }).path === "string"
    ? (args as { path: string }).path
    : "the target";
  return { code: "truncated_read", message: new TruncatedReadError(path).message };
}
