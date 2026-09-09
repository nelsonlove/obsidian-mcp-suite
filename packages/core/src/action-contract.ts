// THE ACTION CONTRACT VOCABULARY — the parts of the host's action registry that
// a governance provider must agree with byte-for-byte (suite split, S3c).
//
// The registry itself is the HOST's (§6). What is published here is the small
// part two plugins have to share, and each item is here because a second copy
// would be a correctness bug rather than a duplication:
//
//   • CHANGE_CLASSES — the canonical ORDER is load-bearing. A canonical proposal
//     subject sorts an item's classes this way before hashing, so two producers
//     computing the same subject must agree on the order. A forked copy whose
//     order drifted would hash the same change to two different subjects, which
//     is the standing chain silently forking.
//   • NOTE_WRITE_ACTION — the identity of the one native mutation the provider's
//     write observer speaks for. The observer skips a write whose
//     `operation.action` is not this id, and it checks the derived classes
//     against these declared ones. If the host bumped the version or widened
//     the classes and the provider's copy did not, the provider would either
//     stop proposing entirely (silently — a review queue that just goes quiet)
//     or assert coverage against a stale declaration.
//
// Published on the `isVisible` / `resolveScope` / `scanForAcceptFence`
// precedent. The host's `kernel/operations/action.ts` and
// `kernel/operations/actions/note-write.ts` are DEFINED OVER these rather than
// restating them, and re-export them, so no host call site moved.

/** The six change classes, in their CANONICAL ORDER.
 *
 * The order is load-bearing rather than cosmetic: canonical proposal subjects
 * sort an item's classes this way before hashing (coding guide §8), so two
 * producers computing the same subject must agree on it. It runs from the
 * narrowest semantic effect to the widest authority effect. */
export const CHANGE_CLASSES = [
  "encoding",
  "presentation",
  "representation",
  "structural",
  "content",
  "authority",
] as const;
export type ChangeClass = (typeof CHANGE_CLASSES)[number];

/**
 * The identity of the host's `note.write` native action — id, version, and the
 * classes it DECLARES.
 *
 * "Declares", not "has": the class firewall proves the content claim against
 * the actual diff at proposal-build time (classification rule 5 — evaluated
 * from the diff, never solely from the declaration). This triple is what the
 * two sides must agree the declaration IS.
 */
export const NOTE_WRITE_ACTION: {
  readonly id: "note.write";
  readonly version: 1;
  readonly changeClasses: readonly ChangeClass[];
} = { id: "note.write", version: 1, changeClasses: ["content"] };
