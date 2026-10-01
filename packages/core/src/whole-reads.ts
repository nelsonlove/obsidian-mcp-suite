/**
 * The memory of whole reads (#443): the proof a whole-note overwrite of a
 * long note needs.
 *
 * #442 made a policy of it: a note longer than the read limit is never
 * overwritten whole over MCP, because the read tools cut it there. This is
 * the road through that policy, and it is mechanism, not a caller's say-so.
 * `obsidian_read_note` with `full: true` returns the whole note with its
 * `rev`, and the transport remembers (path, rev) here for the same window
 * idempotency keys live. The whole-note rules (`wholeNoteOverwriteRefusal`,
 * `assertPatchRangeRead`) stand aside for a call that carries an `if_rev`
 * equal to a remembered whole read's rev for that path AND equal to the
 * note's current rev: the transport itself served that note whole, and it
 * has not changed since. A rev remembered for one path proves nothing for
 * another; a rev the note has moved past proves nothing any more.
 *
 * Scope: one instance per connection on the host, a connection's own reads,
 * and only with a kernel (whose dequeue check is what matches if_rev to the
 * note's rev). The FS server serves a whole read but keeps no memory: its
 * writes carry no if_rev, so nothing ties a proof to the caller there, and
 * the whole-note policy stays until #446 gives its writes a conditional form.
 *
 * What the proof is, exactly: that this connection was served the whole
 * note at that rev. It cannot know which text the caller then edited: a
 * caller holding an older cut read of the same note could write that back
 * under a later whole read's rev. A cut read served AFTER the whole read
 * forgets the proof (`forget`, told by the read tool), which closes the
 * order a caller falls into by habit; the other order is the caller's own
 * act, and the docs say so.
 */

/** The one write window: how long a transport holds an idempotency key, and
 *  how long it remembers a whole read. The host's kernel imports it as its
 *  idempotency TTL, so the two cannot drift. */
export const WRITE_WINDOW_MS = 10 * 60_000;

/** A whole read's token: `wholeReadToken`'s string, compared by equality. */
export type RevToken = string;

/** The one spelling of the token a whole read is remembered under: the
 *  note's mtime (the rev the caller conditions on) and its size (a volume
 *  with coarse mtimes keeps the mtime across an edit in the same tick).
 *  Every place that composes or compares it uses this. */
export function wholeReadToken(mtime: number, size: number | undefined): string {
  return `${mtime}:${size}`;
}

export class WholeReads {
  private readonly byPath = new Map<string, { rev: RevToken; at: number }>();
  private remembers = 0;
  constructor(
    private readonly ttlMs: number = WRITE_WINDOW_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Remember that `path` was served whole at `rev`; the latest whole read
   *  replaces the one before, whatever its token (a token is not ordered: an
   *  mtime survives a move or a restore, so a "higher" one is not "newer"),
   *  and every entry past the window is swept, so a connection that reads
   *  many notes whole holds only the last window. Two whole reads of one
   *  note racing each other can leave the slower one remembered; the other
   *  caller's overwrite is then refused as unproven and reads again — a false
   *  refusal, never a lost tail. */
  remember(path: string, rev: RevToken): void {
    const now = this.now();
    // Swept every 64 remembers (and on a miss in `has`), not on every one:
    // a burst of whole reads stays linear.
    if (++this.remembers % 64 === 0) {
      for (const [p, e] of this.byPath) if (now - e.at > this.ttlMs) this.byPath.delete(p);
    }
    this.byPath.set(path, { rev, at: now });
  }

  /** Entries held (expired ones included until the next sweep); for tests. */
  get size(): number {
    return this.byPath.size;
  }

  /** Forget `path`: a cut read of it was served after the whole read, so the
   *  text the caller holds may be the cut one. */
  forget(path: string): void {
    this.byPath.delete(path);
  }

  /** True when `path` was served whole at exactly `rev` within the window. */
  has(path: string, rev: RevToken | undefined): boolean {
    if (rev === undefined) return false;
    const e = this.byPath.get(path);
    if (!e) return false;
    if (this.now() - e.at > this.ttlMs) {
      this.byPath.delete(path);
      return false;
    }
    return e.rev === rev;
  }
}
