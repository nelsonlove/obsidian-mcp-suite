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
 *     interception (`cutReadError`: the host's guarded.ts over `content`,
 *     the FS server's mutate over the same), so every tool that takes
 *     text is covered without knowing it, and again inside each backend write
 *     that takes text, as the last line for direct callers. No code fence is
 *     exempt: a cut can land inside a fence, and a caller that closes it would
 *     otherwise hide the trailer. A note that must show the trailer on a line
 *     of its own writes it with letters (`N chars`, `showing first M`), which
 *     the digit match never takes for a cut.
 *   - `wholeNoteOverwriteRefusal`, the mechanism behind the marker: a caller
 *     that deletes the "junk" trailer line and writes back still loses the
 *     tail, whatever it adds. So the rule is a policy, stated as one: a note
 *     longer than the read limit is never overwritten whole over MCP. The
 *     read tools cut at the limit, so a whole-note write of such a note is a
 *     write of a cut read wherever its text came from (a few reads —
 *     obsidian_read_note_parsed, obsidian_get_active_note — do return it
 *     whole, and are bound by the same policy until #443 gives a whole read
 *     its own road). A `content` + `overwrite: true` call on such a note is
 *     refused at each transport's interception, before the queue, from the
 *     note's length on disk. A long note is edited by anchor, or read whole
 *     first: `obsidian_read_note` with `full: true` returns it whole with
 *     its rev, the transport remembers that whole read (`whole-reads.ts`),
 *     and this rule stands aside for a call whose if_rev is that rev and the
 *     note's current rev (#443). A caller that reaches a backend directly
 *     is not bound by that rule (it is not over MCP) — but by the next one.
 *   - `assertPatchRangeRead`, the same mechanism through the anchored road:
 *     a `replace` whose section runs past the read limit (the top heading of
 *     a long note runs to its end) replaces text no cut read showed. So
 *     `patchNote` on both backends refuses a replace whose range reaches
 *     past the limit on a note longer than it. This one needs the computed
 *     range, so it runs at the write (journaled); append and prepend delete
 *     nothing and are not bound, and it stands aside the same way for a
 *     proven whole read (#443).
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

/** Matches the trailer with digits, anywhere in the text: on its own line,
 *  padded, CR-terminated, behind any prefix (a cut read re-quoted line by
 *  line as a blockquote, a list, a table row or an indent is still a cut
 *  read), inside a fence a caller closed, or below text a caller appended.
 *  Nothing about its position is trusted, because every position is one an
 *  editor can produce. The one escape is the wording: a mention with letters
 *  for the numbers (`N chars`, `showing first M`) never matches, and that is
 *  how a doc quotes it. */
export const TRUNCATION_TRAILER_RE = new RegExp(TRAILER_SRC);

/** The trailer at the very end of a read, exactly as `truncateForRead` writes it. */
const TRAILER_AT_END_RE = new RegExp(`\\n\\n${TRAILER_SRC}$`);

/** The trailer `readNote` appends after the cut content. */
export function truncationTrailer(length: number, limit: number): string {
  return `\n\n${trailerLine(String(length), String(limit))}`;
}

/** Cut `content` to `limit` characters and append the trailer, or return it
 *  whole. A cut never splits a surrogate pair: when the last kept code unit
 *  is a high surrogate, the cut moves one back, so the read is valid text. */
export function truncateForRead(content: string, limit: number): string {
  if (content.length <= limit) return content;
  const code = content.charCodeAt(limit - 1);
  const at = code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
  // The trailer says how many characters were shown, which is `at`.
  return content.slice(0, at) + truncationTrailer(content.length, at);
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
  "Edit the note by anchor instead (obsidian_patch_note on a section that ends before the limit, obsidian_append_note, obsidian_manage_frontmatter; the read's rev is good for those). For a whole rewrite, read the note whole first — obsidian_read_note with full: true — and write with the rev that read returned.";

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
 *  exceeds the read limit is refused: such a note is never overwritten whole
 *  over MCP (the module doc says why). Run BEFORE the queue, like
 *  `cutReadError`. */
export async function wholeNoteOverwriteRefusal(
  args: Record<string, unknown> | undefined,
  noteLength: (path: string) => Promise<number | undefined>,
  limit: number,
  /** True when the transport served this note whole at the rev the call is
   *  conditioned on, and the note is still at that rev (#443). */
  provenWhole?: (path: string) => Promise<boolean>,
): Promise<TruncatedReadError | null> {
  if (!args || typeof args.content !== "string" || args.overwrite !== true || typeof args.path !== "string") return null;
  // A create-only item of obsidian_write_notes is dispatched with
  // `overwrite: true` and `create_only: true` (the item carried no if_rev):
  // if the note exists, that is the protection refusal's case, not this one.
  if (args.create_only === true) return null;
  const onDisk = await noteLength(args.path);
  if (onDisk === undefined || onDisk <= limit) return null;
  if (provenWhole && (await provenWhole(args.path))) return null;
  return new TruncatedReadError(
    args.path,
    `'${args.path}' is ${onDisk} chars on disk, longer than the read limit of ${limit}. A note longer than the limit is never overwritten whole over MCP: the read tools cut it there, so a whole-note write of it is a write of a cut read, whatever was edited in. Nothing was written. ${WAY_OUT}`,
  );
}

/** The anchored road's rule, for `patchNote` on both backends: a `replace`
 *  whose range ends past the read limit, on a note longer than it, replaces
 *  text no cut read showed (the top heading's section runs to the end of the
 *  note). `rangeEnd` is the character offset where the replaced range ends. */
export function assertPatchRangeRead(path: string, noteLength: number, rangeEnd: number, limit: number): void {
  if (noteLength <= limit || rangeEnd <= limit) return;
  throw new TruncatedReadError(
    path,
    `'${path}' is ${noteLength} chars, longer than the read limit of ${limit}, and this replace reaches to character ${rangeEnd}, past what any read here showed: it would replace text no cut read returned. Nothing was written. Replace a section that ends before the limit, or append or prepend instead.`,
  );
}

/** A transport's `noteLength` from the file's byte size and a reader: a file
 *  of at most `limit` bytes cannot exceed `limit` characters (UTF-8 bytes are
 *  never fewer than code units), so its size stands for the comparison; only
 *  a larger file is read for its character count. */
export async function noteLengthFrom(size: number, read: () => Promise<string>, limit: number): Promise<number> {
  return size <= limit ? size : (await read()).length;
}

/** The pre-queue pair, in order, for a transport's interception: the cut
 *  read handed back as `content`, then the whole-note overwrite of a long
 *  note. One implementation for both transports. */
export async function preQueueTruncationRefusal(
  args: Record<string, unknown> | undefined,
  noteLength: ((path: string) => Promise<number | undefined>) | undefined,
  limit: number,
  provenWhole?: (path: string) => Promise<boolean>,
): Promise<TruncatedReadError | null> {
  return cutReadError(args) ?? (noteLength ? wholeNoteOverwriteRefusal(args, noteLength, limit, provenWhole) : null);
}

/** The interception-point check, for a transport's mutate step: the call's
 *  `content` argument (the one name under which every tool takes note text
 *  from the caller, at the top level of the call's arguments; an
 *  obsidian_write_notes item's `body` is composed into `content` and
 *  dispatched as its own call) is a cut read. Returns the refusal, or null
 *  when the call carries none. */
export function cutReadError(args: Record<string, unknown> | undefined): TruncatedReadError | null {
  const v = args?.content;
  if (typeof v !== "string" || !carriesTruncationTrailer(v)) return null;
  return new TruncatedReadError(typeof args?.path === "string" ? args.path : "the target");
}

