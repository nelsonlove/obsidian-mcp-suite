// SESSION STORE — durable, append-only, replica-local (WP5).
//
// Sessions group operations, observation and effect references, proposals,
// verification, and receipts DURABLY — a session that exists only in process
// memory evaporates with the process, and everything it grouped becomes
// ungrouped evidence. So the store is an append-only event log (the same
// shape the acceptance log and write journal already use): lifecycle events
// appended, current state folded. Nothing is ever rewritten; a session's
// history of transitions is itself evidence.
//
// IO is injected (the observation store's pattern) so the fold logic is pure
// and the tests need no filesystem. The live wiring appends to
// `governance/sessions.jsonl` in the plugin directory — synced/backed-up
// EVIDENCE, deliberately unlike the observation payloads: a session record
// carries identifiers and digests, never note bodies, so the
// outlives-its-source argument does not apply and auditability wins.

// The session CONTRACT is a published contract since S3 (condition 7 — the
// host mints; see packages/core/src/session.ts). The STORE — the durable
// event log, and the revocation state a human's Revoke gesture writes —
// stays with the provider, and is what the seam's session-refusal hook
// consults.
import { SessionNotLiveError, attachMandate, closeSession, expireSession, revokeSession, type SessionV1 } from "@vault-mcp/core";

export type SessionEvent =
  | { kind: "opened"; at: number; session: SessionV1 }
  | { kind: "closed"; at: number; sessionId: string }
  | { kind: "revoked"; at: number; sessionId: string; reason: string }
  | { kind: "expired"; at: number; sessionId: string }
  /** WP9: mandate activation binds the granted mandate to its delegate session. */
  | { kind: "mandated"; at: number; sessionId: string; mandateId: string };

export interface SessionEventIo {
  /** Atomically append one line. */
  appendLine(line: string): Promise<void>;
  /** All lines, oldest first. Missing store = empty list. */
  readLines(): Promise<string[]>;
}

export interface SessionStore {
  open(session: SessionV1, now: number): Promise<void>;
  close(sessionId: string, now: number): Promise<void>;
  revoke(sessionId: string, reason: string, now: number): Promise<void>;
  /** Record an observed expiry, so the durable state matches what liveness already decided. */
  markExpired(sessionId: string, now: number): Promise<void>;
  /** WP9: bind a granted mandate to its delegate session — set once, never replaced. */
  attachMandate(sessionId: string, mandateId: string, now: number): Promise<void>;
  /** Current folded state of one session, or null when this store never saw it opened. */
  get(sessionId: string): Promise<SessionV1 | null>;
  /** All sessions this store saw opened, in their current folded state. */
  all(): Promise<SessionV1[]>;
  /**
   * THE SEAM'S ANSWER (S3c). Refuse a REVOKED session; say nothing otherwise.
   *
   * `null` is silence, not an allow — the host's own expiry floor has already
   * spoken for expiry, and closure is vacuous because a closed connection makes
   * no further calls. So the only thing left for the provider to say is "a human
   * revoked this", which is exactly what condition 7 assigns it.
   */
  revocationRefusal(sessionId: string): Promise<{ code: string; detail: string } | null>;
  /** The mandate bound to a session id, or null. Used by the write observer's producer stamp. */
  mandateOf(sessionId: string): Promise<string | null>;
}

/**
 * The id-keyed AUTHORITY state, folded from the same log.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT `foldSessionEvents` ──────────────────
 *
 * Before the host/provider split this store saw every session OPEN, because the
 * host's composition root handed it `open`/`close`/`markExpired` directly. It
 * does not any more: condition 7 says the host mints and keeps the lifecycle
 * record, so the host writes `opened`/`closed`/`expired` into ITS OWN
 * `sessions.jsonl` and this plugin never hears about them. Deliberately no
 * connection-lifecycle hook was added to the seam — condition 7 says the
 * provider does not need one, because it never mints.
 *
 * What the provider still owns is REFUSAL and the mandate binding, and both are
 * facts about a session ID rather than about a session RECORD. So they fold
 * here, keyed by id, with no requirement that an `opened` was ever seen.
 *
 * `foldSessionEvents` is untouched and still refuses to invent a session for an
 * event it has no `opened` for — that is the right rule for reconstructing
 * RECORDS, and every historical line in the live `governance/sessions.jsonl`
 * still folds through it exactly as before. This is a second, weaker fold for
 * the two questions that survive without a record.
 *
 * THE COST, stated: `revoke` and `attachMandate` no longer verify that the
 * session is open. Revocation is safe because it can only ADD a refusal — a
 * revoked id that never existed refuses nothing. Mandate attachment is safe on
 * the provider's own prior ruling: mandate fit binds by SESSION ID, not by the
 * session record's `mandateId`, and the record "is provenance, not a gate"
 * (`mandate-wiring.ts`). What is genuinely lost is the refusal of a mandate
 * attach to an already-expired session, which used to surface as a
 * `sessionAttachWarning` and now does not fire.
 */
export interface SessionAuthority {
  revokedAt: number;
  revokedReason: string;
}

export function foldSessionAuthority(lines: readonly string[]): {
  revoked: Map<string, SessionAuthority>;
  mandates: Map<string, string>;
} {
  const revoked = new Map<string, SessionAuthority>();
  const mandates = new Map<string, string>();
  for (const line of lines) {
    let ev: SessionEvent;
    try {
      ev = JSON.parse(line) as SessionEvent;
    } catch {
      continue;
    }
    if (ev.kind === "revoked" && typeof ev.sessionId === "string" && ev.sessionId) {
      // First revocation wins: a revocation is permanent, and a later one would
      // only restate it with a different reason.
      if (!revoked.has(ev.sessionId)) revoked.set(ev.sessionId, { revokedAt: ev.at, revokedReason: ev.reason });
    } else if (ev.kind === "mandated" && typeof ev.sessionId === "string" && ev.sessionId && ev.mandateId) {
      // Set once, like the contract's own `attachMandate`.
      if (!mandates.has(ev.sessionId)) mandates.set(ev.sessionId, ev.mandateId);
    }
  }
  return { revoked, mandates };
}

/**
 * Fold events into current state. Pure, total, and forgiving of garbage in
 * the direction of SAFETY: an unparseable line is skipped (a corrupt tail
 * must not take down every prior session), and an event for an unknown
 * session id is ignored rather than inventing a session to apply it to.
 */
export function foldSessionEvents(lines: readonly string[]): Map<string, SessionV1> {
  const out = new Map<string, SessionV1>();
  for (const line of lines) {
    let ev: SessionEvent;
    try {
      ev = JSON.parse(line) as SessionEvent;
    } catch {
      continue;
    }
    if (ev.kind === "opened" && ev.session?.id) {
      // First open wins; a duplicate open for an id never downgrades state.
      if (!out.has(ev.session.id)) out.set(ev.session.id, ev.session);
      continue;
    }
    const cur = "sessionId" in ev ? out.get(ev.sessionId) : undefined;
    if (!cur) continue;
    try {
      if (ev.kind === "closed") out.set(cur.id, closeSession(cur));
      else if (ev.kind === "revoked") out.set(cur.id, revokeSession(cur, ev.reason));
      else if (ev.kind === "expired" && cur.status === "open") out.set(cur.id, expireSession(cur, Math.max(ev.at, cur.expiresAt)));
      else if (ev.kind === "mandated") out.set(cur.id, attachMandate(cur, ev.mandateId));
    } catch {
      // A transition invalid against folded state (close of a revoked
      // session, say) is recorded history colliding with itself — keep the
      // stronger existing state rather than throwing away the fold.
    }
  }
  return out;
}

export function createSessionStore(io: SessionEventIo): SessionStore {
  // The LINES are cached and the fold recomputed from them on demand — one
  // interpretation of events (the fold), not a fold plus a hand-maintained
  // incremental mirror that can drift from it. Session counts are small
  // (one per connection); folding is cheap at this scale, and on restart the
  // on-disk log is the truth.
  let lines: string[] | null = null;

  async function allLines(): Promise<string[]> {
    if (lines === null) lines = await io.readLines();
    return lines;
  }

  async function state(): Promise<Map<string, SessionV1>> {
    return foldSessionEvents(await allLines());
  }

  async function authority(): Promise<ReturnType<typeof foldSessionAuthority>> {
    return foldSessionAuthority(await allLines());
  }

  async function append(ev: SessionEvent): Promise<void> {
    // Cache seeded BEFORE the append — a cold cache read after appendLine
    // would already contain the new line and pushing would double-count.
    // Every public method folds first today, which seeds it; this makes the
    // ordering structural rather than an accident of the callers.
    const cached = await allLines();
    const line = JSON.stringify(ev);
    await io.appendLine(line);
    cached.push(line);
  }

  return {
    async open(session, now) {
      const m = await state();
      if (m.has(session.id)) throw new Error(`session ${session.id} is already recorded`);
      await append({ kind: "opened", at: now, session });
    },
    async close(sessionId, now) {
      const m = await state();
      const cur = m.get(sessionId);
      if (!cur) throw new SessionNotLiveError(sessionId, "closed");
      if (cur.status !== "open") return; // idempotent: already terminal
      await append({ kind: "closed", at: now, sessionId });
    },
    async revoke(sessionId, reason, now) {
      // NO existence check since S3c. This store no longer witnesses session
      // OPEN — the host keeps the lifecycle record and does not notify the
      // provider — so requiring a folded record here would have made every
      // revocation a no-op the moment the two plugins separated. Revoking an id
      // this store never saw is safe by construction: a revocation can only ADD
      // a refusal, and a refusal for a session nobody is using refuses nothing.
      const already = (await authority()).revoked.get(sessionId);
      if (already) return; // permanent and idempotent; a second reason would only restate it
      await append({ kind: "revoked", at: now, sessionId, reason });
    },
    async markExpired(sessionId, now) {
      const m = await state();
      const cur = m.get(sessionId);
      if (!cur || cur.status !== "open") return;
      await append({ kind: "expired", at: now, sessionId });
    },
    async attachMandate(sessionId, mandateId, now) {
      const m = await state();
      const cur = m.get(sessionId);
      if (cur) {
        // A session this store DOES have a record for (a historical one, from
        // before the split) keeps the full check: run the kernel transition
        // against folded state BEFORE appending, so a refused attach (not open,
        // already mandated) writes nothing.
        attachMandate(cur, mandateId);
      } else {
        // No record — the ordinary case after the split, since the host owns
        // the lifecycle log. Fall back to the id-keyed binding, which keeps the
        // half of the contract that survives without a record: SET ONCE.
        //
        // What is lost, named rather than glossed: the refusal of an attach to
        // a session that is closed or expired. That refusal surfaced as a
        // `sessionAttachWarning` on the grant and never undid the grant itself,
        // and the provider's own mandate wiring already rules that fit binds by
        // SESSION ID rather than by this record — "it is provenance, not a
        // gate". So the grant's meaning is unchanged; only the warning is gone.
        const bound = (await authority()).mandates.get(sessionId);
        if (bound !== undefined) {
          throw new SessionNotLiveError(sessionId, "closed");
        }
      }
      await append({ kind: "mandated", at: now, sessionId, mandateId });
    },
    async get(sessionId) {
      return (await state()).get(sessionId) ?? null;
    },
    async all() {
      return [...(await state()).values()];
    },
    async revocationRefusal(sessionId) {
      const rec = (await authority()).revoked.get(sessionId);
      if (!rec) return null;
      return {
        code: "session_revoked",
        detail: `this connection's session (${sessionId}) was revoked in the review pane: ${rec.revokedReason}. Reconnect to open a new session.`,
      };
    },
    async mandateOf(sessionId) {
      const a = await authority();
      // The id-keyed binding first, because after the split it is the only one
      // that gets written; the folded record second, so a mandate attached
      // before the split still resolves.
      return a.mandates.get(sessionId) ?? (await state()).get(sessionId)?.mandateId ?? null;
    },
  };
}
