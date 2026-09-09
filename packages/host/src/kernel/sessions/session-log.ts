// THE HOST'S SESSION LIFECYCLE LOG (suite split, S3c).
//
// Condition 7 ruled that the HOST mints — a session is transport state, and the
// host is the only thing that knows a connection began — and named what the
// host keeps: "the host's session record stays what it is today (identifiers,
// scope digest, lifecycle)". This is that record, now that the plugin holding
// it is the host rather than the provider.
//
// WHAT THIS IS FOR, and what it is deliberately NOT for.
//
// It is EVIDENCE. `actor.session` on a journal record names a session id; this
// file is where that id is resolvable to the connection it described — when it
// opened, which client claimed it, what scope digest bounded it, which journal
// head it started from, and when it ended. Without it the journal's session ids
// are opaque strings.
//
// It is NOT consulted to decide whether a mutation may proceed. That question
// splits two ways and neither reads this file:
//
//   • EXPIRY is the host's own floor, and it is PURE — `expiryRefusal(session,
//     now)` over the in-memory record the connection minted. Expiry needs no
//     writer and no durable record to have HAPPENED, which is exactly why a
//     host with no provider installed still stops honouring a session that has
//     run out.
//   • REVOCATION is the provider's, answered through the seam's refusal hook
//     from the provider's own state. The host never asks a provider for
//     permission and never learns why beyond the refusal's own detail string.
//
// So no `get`. Reading the durable record to decide whether a queued mutation
// may proceed is asking PERMISSION, and the whole point of the seam's shape is
// that the host does not ask.
//
// APPEND-ONLY, like the journal beside it, and for the same reason: a lifecycle
// log that can be rewritten is not evidence. There is no edit and no delete.
// Failures are swallowed with a console line — a session record that cannot be
// written must never cost a connection, exactly as a journal append that fails
// must never cost a vault operation.

import type { SessionV1 } from "@vault-mcp/core";

/**
 * One line of the log. `opened` inlines the whole minted record; the terminals
 * carry the id alone, because the record they refer to is already in the file.
 *
 * Note what is NOT here: `revoked` and `mandated`. Those are the provider's
 * facts about a session and live in the provider's own store — the host neither
 * mints them, reads them, nor has a place to put them.
 */
export type SessionLogEvent =
  | { kind: "opened"; at: number; session: SessionV1 }
  | { kind: "closed"; at: number; sessionId: string }
  | { kind: "expired"; at: number; sessionId: string };

/** The IO port. No filesystem here; the composition root supplies one. */
export interface SessionLogIo {
  appendLine(line: string): Promise<void>;
}

export interface SessionLog {
  /** Record a minted session. */
  open(session: SessionV1, at: number): Promise<void>;
  /** Record that the connection carrying this session closed. */
  close(sessionId: string, at: number): Promise<void>;
  /** Record that this session was observed past its expiry at a dequeue. */
  markExpired(sessionId: string, at: number): Promise<void>;
}

/**
 * Build the log over an injected append.
 *
 * IDEMPOTENT ON `expired`, in memory, per plugin instance: expiry is checked at
 * every dequeue, so a session that outlives its TTL while a client keeps
 * writing would otherwise append one `expired` line per refused call. The
 * de-duplication is a courtesy to the file, not a correctness property — a
 * plugin reload forgets it and one duplicate line may appear, which an
 * append-only reader tolerates by construction.
 */
export function createSessionLog(io: SessionLogIo): SessionLog {
  const expired = new Set<string>();
  const append = async (ev: SessionLogEvent): Promise<void> => {
    try {
      await io.appendLine(JSON.stringify(ev));
    } catch (e) {
      // Swallowed by design — see the header. A session record is evidence
      // about a connection, and losing it must not take the connection down.
      console.error("[vault-mcp] session log append failed", e);
    }
  };
  return {
    open: (session, at) => append({ kind: "opened", at, session }),
    close: (sessionId, at) => append({ kind: "closed", at, sessionId }),
    markExpired: (sessionId, at) => {
      if (expired.has(sessionId)) return Promise.resolve();
      expired.add(sessionId);
      return append({ kind: "expired", at, sessionId });
    },
  };
}
