// MANDATE NEGOTIATION — the agent half of bounded delegation (WP9).
//
// Two verbs, both candidates-only in the #221 sense:
//
//   * `governance_mandate_draft` — author a mandate request (or a
//     counter-proposal narrowing an earlier one). MUTATING: it rides the host's
//     guarded registration path, so read-only mode blocks negotiating authority
//     from a read-only session, and the queue/journal record that the request
//     was made. It writes a DRAFT into the mandate store — never a mandate.
//     Activation is `authority: "human"` and exists only as the review pane's
//     gesture-gated control; there is deliberately no tool for it, and no
//     argument on this tool can produce one.
//
//   * `governance_mandates` — the read-side listing (drafts, active and settled
//     mandates, usage against budgets), so an agent can see what delegation
//     exists before drafting a duplicate, and can watch its own budgets while
//     working.
//
// ── PUBLISHED THROUGH `vault-mcp-api` SINCE S3c, UNDER THE SAME NAMES ────────
//
// The host carries a closed grandfather table naming these two spellings and
// the single owner id allowed to publish them, so they did NOT become
// `governor_governance_mandate_draft` and `governor_governance_mandates` the way
// every satellite's tools were renamed. Renaming a shipped tool name breaks
// agent sessions for zero semantic gain, and these were on the wire when the
// split happened.
//
// THREE THINGS GOT STRICTER IN THE MOVE, all of them the ordinary external-tool
// posture rather than anything specific to governance:
//
//   1. The host DISTRUSTS an external `readOnlyHint: true` unless the operator
//      lists `governor` in `trustedReadOnlyPlugins`, so `governance_mandates` is
//      registered as mutating by default and blocked in read-only mode.
//   2. Neither tool carries a recognized path key, so under an ACTIVE path
//      allowlist the host's F3 gate blocks both WHOLESALE rather than scoping
//      them. Fail-closed, and stricter than the in-tool filtering below.
//   3. That in-tool filtering therefore has nothing to filter with in the
//      shipped configuration: `getSettings` is a DORMANT SEAM, kept
//      deliberately (the skills / triage / cross-session precedent). Do not
//      delete it — an apiVersion-2 SDK carrying the caller's scope to a
//      publisher wakes it with no code change, and its tests supply it so it
//      cannot rot.
//
// ── RE-APPLY EVERY SCHEMA BOUND IN THE HANDLER ──────────────────────────────
//
// The SDK converts zod to JSON Schema and the host converts it back through a
// small subset: `type`, `description` and string `enum` survive; `min`, `max`,
// `default` and — crucially here — NESTED OBJECT SHAPES do not. An object-typed
// property degrades to `z.unknown()`, which validates nothing and strips
// nothing, so `transformation`, `budgets`, `delegate` and the two id/version
// ARRAYS reach the handler exactly as the caller sent them and are checked
// below by hand. This is the `vaultmcp_skills_release` semver bug avoided rather
// than repeated: if you add a constrained argument, constrain it twice.
//
// Obsidian-free by construction: everything arrives through the injected
// source; the adapter lives in main.ts.

import { z } from "zod";
import type { SdkToolSpec } from "vault-mcp-api";
import { isVisible, type GuardSettings } from "@vault-mcp/core";
import { refuse } from "./refusal.js";
import { openDraft, type MandateDraftV1 } from "../kernel/mandates/draft.js";
import { MandateRefusedError, type MandateTerms, type MandateV1 } from "../kernel/mandates/mandate.js";
import type { MandateUsage } from "../kernel/mandates/budgets.js";
import type { ChangeClass } from "../kernel/contracts/change-class.js";

/** What the tools need from the world — narrow store access plus identity facts. */
export interface MandateToolsSource {
  /** Record an authored draft (the store refuses duplicates and unknown counter targets). */
  draft(draft: MandateDraftV1, now: number): Promise<void>;
  allDrafts(): Promise<MandateDraftV1[]>;
  allMandates(): Promise<MandateV1[]>;
  usageOf(mandateId: string): Promise<MandateUsage>;
  /**
   * The calling connection's session id, for the default delegate binding.
   *
   * ALWAYS NULL SINCE S3c, and that is a real loss, named rather than hidden.
   * While these tools were registered inside the host, the composition root
   * handed each per-connection registrar that connection's session id. A
   * published external tool receives arguments and nothing else — the host does
   * not tell a publisher which connection is calling — so a draft that omits
   * `delegate` can no longer default to "this session" and is refused
   * `no_session` with instructions to pass one. The proper close is the
   * apiVersion-2 item that carries caller context to a publisher; the seam is
   * kept here so that lands as a wiring change rather than a redesign.
   */
  sessionId(): string | null;
  /** The calling client's self-asserted name — provenance, never authority. */
  client(): string | null;
  now(): number;
  /** Settings for the allowlist boundary (absent ⇒ everything visible). Dormant — see the header. */
  getSettings?: () => GuardSettings;
}

/** Every scope entry a draft names must be visible to the drafting session. */
function scopeRefusal(entries: string[], settings: GuardSettings | undefined): string | null {
  if (!settings) return null;
  for (const e of entries) {
    if (!isVisible(e, settings)) return e;
  }
  return null;
}

const idVersion = z.object({ id: z.string().min(1), version: z.string().min(1) });

// ── hand-applied bounds (see the header) ────────────────────────────────────

function requireStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) refuse("invalid_argument", `'${field}' must be a non-empty array of strings`);
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string" || v.length === 0) refuse("invalid_argument", `'${field}' must contain only non-empty strings`);
    out.push(v);
  }
  return out;
}

function requireIdVersion(value: unknown, field: string): { id: string; version: string } {
  const v = value as { id?: unknown; version?: unknown } | null;
  if (!v || typeof v !== "object" || typeof v.id !== "string" || !v.id || typeof v.version !== "string" || !v.version) {
    refuse("invalid_argument", `'${field}' must be an object with non-empty string 'id' and 'version'`);
  }
  return { id: v.id as string, version: v.version as string };
}

function requireIdVersionList(value: unknown, field: string): Array<{ id: string; version: string }> {
  if (!Array.isArray(value) || value.length === 0) refuse("invalid_argument", `'${field}' must be a non-empty array of {id, version} objects`);
  return value.map((v, i) => requireIdVersion(v, `${field}[${i}]`));
}

function requirePositiveInt(value: unknown, field: string, min = 1): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    refuse("invalid_argument", `'${field}' must be an integer >= ${min}`);
  }
  return value;
}

export function buildMandateTools(source: MandateToolsSource): SdkToolSpec[] {
  return [
    {
      name: "governance_mandate_draft",
      description:
        "Author a mandate DRAFT — a bounded-delegation request the human can activate in the review pane. This " +
        "confers no authority: a draft is a candidate, activation is a human gesture, and there is no tool that " +
        "activates. State exact terms: purpose, scope (path prefixes), allowed change classes, the named " +
        "transformation and verification predicates (exact ids and versions), eligible actions, and budgets " +
        "(items, bytes, duration, proposals, failures) — unknown targets and open-ended verbs are not valid " +
        "delegation and are refused with the reason. Pass counter_of to NARROW an earlier draft (the counter " +
        "supersedes it; silence is never acceptance). `delegate` is REQUIRED: a published tool does not learn " +
        "which connection is calling, so it can no longer default to your own session. Note: in the current " +
        "release even an activated mandate runs in cohort-decision mode — may_admit records intent for the WP10 " +
        "promotion gate; it does not enable automatic admission.",
      inputSchema: {
        purpose: z.string().min(1).max(2000).describe("The intended outcome, in plain language."),
        scope_include: z.array(z.string().min(1)).min(1).describe("Vault-relative path prefixes the work may touch."),
        scope_exclude: z.array(z.string().min(1)).optional().describe("Prefixes carved OUT of the scope."),
        allowed_classes: z
          .array(z.string().min(1))
          .min(1)
          .describe("Change classes the mandate authorizes (encoding/presentation/representation/structural/content — authority is never delegable)."),
        transformation: idVersion.describe("The exact named transformation this mandate authorizes."),
        predicates: z.array(idVersion).min(1).describe("Required verification predicates, exact ids and versions."),
        eligible_actions: z.array(idVersion).min(1).describe("Exact registered action ids and versions the work may invoke."),
        budgets: z
          .object({
            max_items: z.number().int().positive(),
            max_bytes: z.number().int().positive(),
            max_duration_ms: z.number().int().positive(),
            max_proposals: z.number().int().positive(),
            max_failures: z.number().int().min(0),
          })
          .describe("Hard stops. Reaching a budget is a normal stop, not an error."),
        may_admit: z
          .boolean()
          .optional()
          .describe("Request prospective admission authority (D02 classes only; inert until the WP10 promotion gate)."),
        recovery_unit: z.enum(["item", "cohort"]).optional().describe("Reversal unit; default cohort."),
        delegate: z
          .object({ kind: z.enum(["session", "connection", "role"]), value: z.string().min(1) })
          .optional()
          .describe("Who the mandate binds. Required unless the host supplies caller context."),
        counter_of: z.string().optional().describe("Draft id this proposal narrows — the counter supersedes it."),
      },
      readOnly: false,
      handler: async (raw: Record<string, unknown>) => {
        const purpose = raw.purpose;
        if (typeof purpose !== "string" || purpose.length === 0 || purpose.length > 2000) {
          refuse("invalid_argument", "'purpose' must be a non-empty string of at most 2000 characters");
        }
        const scopeInclude = requireStringList(raw.scope_include, "scope_include");
        const scopeExclude = raw.scope_exclude === undefined ? [] : requireStringList(raw.scope_exclude, "scope_exclude");
        const allowedClasses = requireStringList(raw.allowed_classes, "allowed_classes");
        const transformation = requireIdVersion(raw.transformation, "transformation");
        const predicates = requireIdVersionList(raw.predicates, "predicates");
        const eligibleActions = requireIdVersionList(raw.eligible_actions, "eligible_actions");
        const b = raw.budgets as Record<string, unknown> | undefined;
        if (!b || typeof b !== "object") refuse("invalid_argument", "'budgets' must be an object");
        const budgets = {
          maxItems: requirePositiveInt(b.max_items, "budgets.max_items"),
          maxBytes: requirePositiveInt(b.max_bytes, "budgets.max_bytes"),
          maxDurationMs: requirePositiveInt(b.max_duration_ms, "budgets.max_duration_ms"),
          maxProposals: requirePositiveInt(b.max_proposals, "budgets.max_proposals"),
          maxFailures: requirePositiveInt(b.max_failures, "budgets.max_failures", 0),
        };
        const recoveryUnit = raw.recovery_unit === "item" ? "item" : "cohort";

        const settings = source.getSettings?.();
        const hidden = scopeRefusal(scopeInclude, settings);
        if (hidden !== null) {
          refuse(
            "out_of_allowlist",
            `scope entry '${hidden}' is outside this session's path allowlist — a sandboxed session cannot draft over territory it cannot see`
          );
        }

        let delegate: { kind: "session" | "connection" | "role"; value: string } | null = null;
        const rawDelegate = raw.delegate as { kind?: unknown; value?: unknown } | undefined;
        if (rawDelegate !== undefined) {
          const kind = rawDelegate.kind;
          if (kind !== "session" && kind !== "connection" && kind !== "role") {
            refuse("invalid_argument", "'delegate.kind' must be one of session, connection, role");
          }
          if (typeof rawDelegate.value !== "string" || rawDelegate.value.length === 0) {
            refuse("invalid_argument", "'delegate.value' must be a non-empty string");
          }
          delegate = { kind, value: rawDelegate.value };
        } else {
          const sid = source.sessionId();
          if (sid === null) {
            refuse(
              "no_session",
              "no delegate given, and a published tool does not learn which connection is calling — pass `delegate` explicitly"
            );
          }
          delegate = { kind: "session", value: sid };
        }

        const terms: MandateTerms = {
          purpose,
          delegate,
          scope: { include: scopeInclude, exclude: scopeExclude },
          allowedClasses: allowedClasses as ChangeClass[],
          transformation,
          predicates,
          eligibleActions,
          requiredDurability: "replayable",
          budgets,
          admission: { mayProduce: true, mayAdmit: raw.may_admit === true },
          recovery: { unit: recoveryUnit },
        };
        const now = source.now();
        try {
          const draft = openDraft(
            {
              authoredBy: { sessionId: source.sessionId(), client: source.client() },
              terms,
              counterOf: typeof raw.counter_of === "string" && raw.counter_of ? raw.counter_of : null,
            },
            now
          );
          await source.draft(draft, now);
          return {
            draft_id: draft.id,
            status: draft.status,
            counter_of: draft.counterOf,
            delegate: draft.terms.delegate,
            expires_after_activation_ms: draft.terms.budgets.maxDurationMs,
            note: "This is a request, not authority. A human reviews and activates it (or not) in the review pane's Mandates section.",
          };
        } catch (e) {
          if (e instanceof MandateRefusedError) refuse(e.code, e.message);
          throw e;
        }
      },
    },
    {
      name: "governance_mandates",
      description:
        "The delegation landscape: open/settled drafts and every mandate with its status, terms summary, and usage " +
        "against budgets. Read-only. Under a path allowlist this tool is unavailable — it carries no path argument, " +
        "so the host cannot scope it and blocks it outright.",
      inputSchema: {},
      readOnly: true,
      handler: async () => {
        const settings = source.getSettings?.();
        // Include AND exclude entries: an exclude naming hidden territory would
        // otherwise print a path the session cannot see (review of #356).
        const visible = (scope: { include: string[]; exclude: string[] }) =>
          scopeRefusal([...scope.include, ...scope.exclude], settings) === null;
        const drafts = await source.allDrafts();
        const mandates = await source.allMandates();
        const visibleDrafts = drafts.filter((d) => visible(d.terms.scope));
        const visibleMandates = mandates.filter((m) => visible(m.terms.scope));
        const items = [];
        for (const m of visibleMandates) {
          items.push({
            mandate_id: m.id,
            status: m.status,
            purpose: m.terms.purpose,
            delegate: m.terms.delegate,
            scope: m.terms.scope,
            allowed_classes: m.terms.allowedClasses,
            transformation: m.terms.transformation,
            may_admit: m.terms.admission.mayAdmit,
            activated_at: m.activatedAt,
            expires_at: m.expiresAt,
            supersedes: m.supersedes,
            usage: await source.usageOf(m.id),
            budgets: m.terms.budgets,
          });
        }
        return {
          drafts: visibleDrafts.map((d) => ({
            draft_id: d.id,
            status: d.status,
            purpose: d.terms.purpose,
            delegate: d.terms.delegate,
            scope: d.terms.scope,
            counter_of: d.counterOf,
            requested_at: d.requestedAt,
          })),
          mandates: items,
          hidden_drafts: drafts.length - visibleDrafts.length,
          hidden_mandates: mandates.length - visibleMandates.length,
        };
      },
    },
  ];
}
