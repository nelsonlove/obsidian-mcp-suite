// tools.ts — the vault-provenance satellite's tool surface: derived-content
// provenance, ported from the standalone `obsidian-provenance` Python CLI,
// folded into the Governor host as a capability module, and now published back
// to that host through `vault-mcp-api` as THREE tools (see main.ts):
//
//   check     — general derived-content freshness of a note (declared read-only)
//   reconcile — the Obsidian plugin audit report (declared read-only)
//   regen     — regenerate the plugin-audit note; dry-run by default,
//               `write: true` persists (MUTATING)
//
// The two read tools run the pure provenance core (src/kernel/*, Obsidian-free
// over an injected ProvenanceSource). `regen`'s write half persists a DERIVED
// artifact — a snapshot of the plugin audit.
//
// ── The published names DID change, and so did one ARGUMENT name ─────────────
//
// The host publishes an external tool as `<sanitized publisher id>_<bare name>`.
// This plugin's id is `vault-provenance`, which sanitizes to `vault_provenance`,
// so the three BARE names below go on the wire as `vault_provenance_check` /
// `_reconcile` / `_regen` — NOT the `provenance_*` the folded module shipped.
// The bare names deliberately SHED the `provenance_` prefix; keeping it would
// have published the stuttering `vault_provenance_provenance_check`, the same
// trade the bases satellite made with `base_`. Recorded in CLAUDE.md and
// README.md as the extraction's breaking change, with the one-line reversal
// named there.
//
// `check`'s `path` argument was renamed `note_path` at the extraction and is
// now spelled `note`. That is NOT cosmetic — see the allowlist section below.
// It is the same class of rename the host itself made when it moved its
// scheme-write `to` → `to_address` AWAY from a path key.
//
// ── Derivation is NOT acceptance (the load-bearing distinction) ──────────────
//
// This plugin stamps DERIVATION metadata (`derived-from`, `generated`,
// `generator`, `derivation-mode`) — provenance of a generated artifact. That is
// ORTHOGONAL to ACCEPTANCE: it says "this note was derived from those sources at
// that time", never "a human accepted this". So:
//   - No tool here carries an accept/approve verb.
//   - The one write tool (`regen` with `write: true`) routes through the SAME
//     accept-forbidden transition guard every vault write uses
//     (`acceptTransitionReason`, @vault-mcp/core), in `guardProvenanceWrite`
//     below — so a regen can NEVER introduce or change an `accepted` /
//     `accepted-by` / `accepted-on` field or set `acceptance-status` to an
//     accepted value, even though the rendered audit frontmatter never spells
//     one. The guard runs BEFORE the write; the write itself still goes through
//     the host's guard-patched registrar (read-only mode, queue, journal,
//     if_rev), because publishing exempts a tool from nothing.
//
// ── Allowlist discipline, as a satellite: FAIL-CLOSED, on the WHOLE surface ──
//
// The ENFORCED boundary is now the HOST's, and for this surface it is strictly
// stricter than the (never-applied) in-tool seam it replaces. Precisely:
//
//   * The host DISTRUSTS an external tool's `readOnly: true` unless the raw
//     publisher id appears in the user's `trustedReadOnlyPlugins` setting, so
//     all three register as MUTATING; and a mutating external tool whose
//     arguments carry NO recognized path key is BLOCKED OUTRIGHT while a path
//     allowlist is active — trusted or not.
//   * NONE of the three tools carries a recognized path key. `reconcile` takes
//     no arguments and `regen` takes only `write`, so both were pathless
//     already. `check`'s `path` was RENAMED to `note_path` to make the surface
//     uniform, and that is a decision rather than an omission:
//       (1) a satellite cannot see the host's allowlist — `ctx.getSettings` is
//           a dormant seam and nothing supplies it — so it cannot filter;
//       (2) had `check` kept `path`, the host would have scoped the ONE note
//           named, and the answer would STILL have listed every path the note's
//           `derived-from:` globs resolve to, including files the session
//           cannot see. The host scopes the note you NAME, not the paths the
//           answer CONTAINS. That is the bases satellite's dormant-row-filter
//           lesson, except here it is avoidable rather than merely disclosable;
//       (3) one-tool-open, one-tool-shut is a posture nobody can state in a
//           sentence. Uniform fail-closed is.
//     The cost is real and is stated in the README and the settings tab: under
//     an active allowlist provenance is UNAVAILABLE rather than partially
//     available. With NO allowlist configured — the ordinary case, and the live
//     operator's — nothing changes at all. The reversal is one word: rename the
//     argument back to `path` and `check` becomes host-scoped per-path again.
//   * Pinned by the `publication` test ("NOT ONE argument is a host path key").
//
// ── ROUND 2 (2026-09-07): the argument is `note`, and the posture is intact ──
//
// The block above is the extraction's reasoning and it stands. What follows is
// the correction history on top of it, because for a moment the posture was not
// what that block says:
//
//   ROUND 1 — the host ADDED `note_path` to its PATH_KEYS. The reason was real
//   and was about the MUTATING tier as a whole: `collectPaths` is not the
//   allowlist's private walker, and the same list feeds record immutability, the
//   advisory-lock consult and the journal's `target.path`, none of them gated on
//   an allowlist. A pathless single-note WRITE had escaped all three.
//
//   ROUND 2 — that fix reached further than its reason. It made `check`, a READ,
//   host-scopable again, which is precisely what the numbered argument above
//   rejects: the host scopes the note you NAME, not the paths the answer
//   CONTAINS, and this answer enumerates every path the note's `derived-from`
//   globs resolve to. Kernel visibility is a MUTATING concern — the record
//   guard, the lock consult and the journal target all bind at the mutating
//   dequeue — so a read gains nothing from being path-keyed and loses the
//   refusal. `check`'s argument is therefore spelled `note`, which the host does
//   not recognize, and the fail-closed whole-surface posture the block above
//   describes is the one that actually ships. `reconcile` and `regen` are
//   pathless as they always were.
//
// So this package carries NO host path key at all, and the `publication` pin
// reads exactly that way again. The one-word reversal named above is unchanged
// in kind, only in spelling: `note` → `path`.
//
// `ctx.getSettings` is kept as a DORMANT seam and is NOT supplied in the shipped
// configuration. It was already dormant as a module — its comment there said it
// was "retained for a future cycle that scopes the audit read surface to the
// allowlist" and it was never applied, because a partial audit is a misleading
// audit. That is carried honestly rather than quietly deleted: an apiVersion-2
// `vault-mcp-api` that can hand a publisher the caller's scope makes it live
// with no change to the code below, and a test supplies it to pin that
// supplying it changes NOTHING today.
//
// ── Envelope convention (the satellite contract) ────────────────────────────
//
// A handler returns PLAIN DATA and THROWS on refusal. The host wraps a return
// value in `ok()` and a thrown error in `fail()`; `fail()` reads a lowercase
// snake `code` off the thrown error and renders `Error [code]: message`,
// otherwise a bare `Error: message`. `ok` / `fail` / `codedError` themselves are
// host-internal and are NOT imported here. The module caught every exception and
// handed it to `fail()`, so the rendering it produced is reproduced exactly by
// letting the same errors propagate:
//
//   - `AcceptForbiddenError` carries `code = "accept_forbidden"` ⇒
//     `Error [accept_forbidden]: …`, byte-compatible with the folded era;
//   - `AuditDestinationError` carries NO code ⇒ `Error: refusing to regenerate
//     over …`, also byte-compatible (deliberately left uncoded rather than
//     improved, so no live refusal an agent parses changes shape here);
//   - a kernel throw (`no derived-from`, an unparseable `generated`) ⇒
//     `Error: …`, uncoded, as before.
//
// TWO codes are NEW, and both name refusals that could not fire in the folded
// era: `invalid_argument` and `invalid_path` (see `requireNotePath`). As a
// module the zod `.min(1)` ran inside the host's own SDK registration; across
// the publishing boundary it does not survive, so the check moves into the
// handler and needs a code of its own.
//
// ── Schema fidelity across the boundary ─────────────────────────────────────
//
// The SDK converts a zod shape to JSON Schema and the host converts it back
// through a deliberately small subset (`json-schema-to-zod.ts`): `type`,
// `description` and STRING `enum` survive; `default`, `min`, `max` and `pattern`
// DO NOT. `note`'s `.min(1)` is therefore re-applied in the handler — that
// is the `vault_skills_release` semver lesson: a constraint that lives only in
// the declared schema never runs for an MCP caller.
//
// Obsidian-free by construction: the vault arrives through the injected
// ProvenanceBackend, so every handler and both write guards are headlessly
// testable. The live adapter is in obsidian-source.ts.

import { z } from "zod";
import type { SdkToolSpec } from "vault-mcp-api";
import { AcceptForbiddenError, acceptTransitionReason, parseGuardFrontmatter } from "@vault-mcp/core";
import type { GuardSettings } from "@vault-mcp/core";
import {
  checkFreshness,
  reconcile,
  regenerateAudit,
  provenanceConfigOf,
  type ProvenanceBackend,
  type ProvenanceConfig,
  type ProvenanceSource,
  GENERATOR_FIELD,
  AUDIT_GENERATOR,
} from "./kernel/index.js";

/** The read tools' SDK flags. `readOnly: true` is a CLAIM the host distrusts by
 * default — see the allowlist note in the header for what that costs. */
const RO = { readOnly: true, destructive: false, idempotent: true } as const;
/** The write tool's SDK flags. */
const RW = { readOnly: false, destructive: false, idempotent: false } as const;

/**
 * A TYPED refusal, thrown. `fail()` in the host reads a lowercase-snake `code`
 * off the error and renders `Error [code]: message`.
 */
export class ProvenanceRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProvenanceRefusal";
    this.code = code;
  }
}

/** Declared as a FUNCTION, not a const arrow: TypeScript only narrows control
 * flow through a `never`-returning call when the callee is a function
 * declaration (or an explicitly annotated const). */
function refuse(code: string, message: string): never {
  throw new ProvenanceRefusal(code, message);
}

export interface ProvenanceToolsCtx {
  /** The config overrides (this plugin's own settings). A THUNK, read per call:
   * a captured record would freeze the settings tab's values at plugin load —
   * which is exactly what the module did (`const cfg = provenanceConfigOf(...)`
   * once, at registration time). As a module that was harmless because the
   * specs were rebuilt per connection; as a satellite it would mean a settings
   * change never landing until an Obsidian reload. (The tool DESCRIPTIONS below
   * are necessarily build-time snapshots regardless, which is why main.ts
   * re-publishes on every settings write.) */
  config: () => Record<string, unknown>;
  /** Guard settings accessor — a DORMANT seam, unsupplied in the shipped
   * configuration (a satellite cannot reach the host's guard settings). It was
   * dormant as a module too: the audit runs over the whole configured notes-dir
   * because a partial audit is a misleading one, so it was never applied. Kept
   * for the day `vault-mcp-api` can carry the caller's scope to a publisher.
   * Absent ⇒ unfiltered, which is also what supplying it does today. */
  getSettings?: () => GuardSettings;
}

/** An inert backend — a stand-in for tests and for a plugin instance with no
 * vault injected: nothing installed, nothing noted, nothing writable. */
export function emptyProvenanceBackend(): ProvenanceBackend {
  return {
    noteFrontmatter: () => null,
    read: async () => null,
    stat: async () => null,
    glob: async () => [],
    writeNote: async () => {
      throw new Error("no vault source injected");
    },
  };
}

/**
 * Re-apply the `.min(1)` the publishing boundary drops, the string type with
 * it, and the backslash rule.
 *
 * The host reconstructs `type: "string"` from the JSON Schema, so a non-string
 * would normally be rejected upstream — but the SDK also accepts a hand-written
 * JSON Schema, and a bare `{}` property degrades to `z.unknown()`. Checking here
 * means the bound holds however the spec reached the host.
 *
 * The BACKSLASH refusal comes before every other check, and is the same rule the
 * triage and bases satellites adopted: every check downstream of this splits on
 * `/` alone, so `Meta\..\..\secret.md` reads as ONE opaque segment here and as a
 * traversal to whatever normalizes it later. Obsidian paths never legitimately
 * contain a backslash; refusing closes the class rather than the instance.
 */
function requireNotePath(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    refuse("invalid_argument", "'note' must be a non-empty string");
  }
  if (value.includes("\\")) {
    refuse(
      "invalid_path",
      `'note' contains a backslash, which is never a valid Obsidian path separator: ${value}`,
    );
  }
  return value;
}

/**
 * The accept-forbidden guard for `regen` with `write: true`, pure and headless.
 *
 * Parses the frontmatter the regen WOULD land (`parseGuardFrontmatter`, the same
 * reader every write path uses — it THROWS `AcceptForbiddenError` on an
 * unclassifiable block rather than under-reading it) and runs the shared
 * `acceptTransitionReason` predicate against the audit note's BEFORE-on-disk
 * frontmatter. A rendered audit that introduced or changed an accepted-family
 * assertion is REFUSED and nothing is written. The rendered frontmatter carries
 * only DERIVATION fields, so a clean regen always passes — running the guard is
 * the load-bearing invariant, not a filter the tool expects to trip.
 */
export function guardProvenanceWrite(
  before: Record<string, unknown> | null,
  text: string,
): void {
  const after = parseGuardFrontmatter(text);
  const reason = acceptTransitionReason(before, after);
  if (reason) throw new AcceptForbiddenError(reason);
}

/** Refused when the audit's configured destination is a note the audit did not
 *  write. Thrown BEFORE any write, like the accept-forbidden guard.
 *
 *  It carries NO `code`, so the host renders it as a bare `Error: …` — exactly
 *  what the folded module's `fail(e)` produced. Left that way deliberately: an
 *  agent parsing this refusal sees the same bytes after the extraction as
 *  before. Giving it a code would be a one-line change and a real envelope
 *  change; do not make it casually. */
export class AuditDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditDestinationError";
  }
}

/**
 * Refuse to regenerate OVER a note this generator did not produce.
 *
 * The destination is configuration, and a configuration mistake here is
 * destructive rather than merely wrong: a regen replaces the whole body, and
 * human-section preservation saves nothing from a note that has no
 * `<!-- human:start -->` markers. The reachable case that prompted this —
 * `notesSource: "flat"` with the shipped JD notes root derives onto
 * `00-09 System/07 Repositories/07 Repositories.md`, the area's own folder note
 * — but the guard is deliberately general, because "the destination points at
 * someone's note" is the hazard, not that one spelling of it.
 *
 * An earlier attempt refused paths of the FOLDER-NOTE SHAPE instead. That was
 * wrong: `flatAuditPath` names the note after its folder by construction, so
 * every flat derivation has that shape and the check refused all of them. The
 * question is not what the path looks like — it is whether something else
 * already owns the file. Only the tool layer can ask that.
 *
 * A note carrying this generator's own stamp is ours to rewrite; anything else
 * — including a note with no frontmatter at all — is refused by name.
 */
export function guardAuditDestination(before: Record<string, unknown> | null, path: string): void {
  if (before === null) return; // absent, or not a note: a first-ever regen
  const gen = before[GENERATOR_FIELD];
  if (gen === AUDIT_GENERATOR) return;
  throw new AuditDestinationError(
    `refusing to regenerate over ${path}: it exists and was not generated by ${AUDIT_GENERATOR}` +
      (gen === undefined ? " (it carries no generator stamp)" : ` (generator: ${String(gen)})`) +
      ". Set this plugin's auditNote setting to a path the audit owns.",
  );
}

/** Local ISO timestamp to seconds precision — the port of Python
 * `datetime.now().isoformat(timespec="seconds")`, stamped into `generated:`.
 * Exported so a test can pin the shape without a clock seam. */
export function nowStamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function buildProvenanceTools(source: ProvenanceBackend, ctx: ProvenanceToolsCtx): SdkToolSpec[] {
  /** The effective config, resolved PER CALL so a settings edit lands live. */
  const cfgNow = (): ProvenanceConfig => provenanceConfigOf(ctx.config());

  return [
    {
      name: "check",
      description:
        "Report whether a derived note is FRESH or STALE against its own `derived-from:` sources. Reads the note's " +
        "`derived-from` (vault-relative globs/paths) and `generated:` timestamp and flags any source file modified " +
        "after `generated` (`changed`), any NON-GLOB entry that no longer resolves to a file (`missing` — a deleted " +
        "or moved source), and — when the note stamps the optional `derived-source-count:` witness — a source set " +
        "that has SHRUNK since generation (`sourcesRemoved`). Without that witness, deletions inside a GLOB entry " +
        "cannot be seen, and the result says so (`globDeletionsUndetectable: true`). Read-only in intent; the " +
        "Governor host registers it as mutating unless this plugin is trusted, and blocks it outright while a path " +
        "allowlist is active — the note argument is deliberately named `note` (not `path`, not `note_path`), which " +
        "the host does not recognize as a path key, so the whole surface fails closed rather than answering with " +
        "paths it cannot scope. The answer enumerates every path this note's `derived-from` globs resolve to, and " +
        "the host would have scoped only the note NAMED, so a scopable spelling would leak the rest.",
      inputSchema: {
        note: z
          .string()
          .min(1)
          .describe(
            "Vault-relative path of the derived note to check (the Python CLI's `check <artifact>`). Named " +
              "`note`, not `path` or `note_path`, deliberately — see the tool description.",
          ),
      },
      ...RO,
      handler: async (args: Record<string, unknown>) => {
        const notePath = requireNotePath(args.note);
        const v = await checkFreshness(source as ProvenanceSource, notePath);
        // Additive in SHAPE: `changed` / `sources` / `generated` keep their names
        // and meaning, and the deleted-source fields are new keys beside them.
        // `fresh` keeps its name but is deliberately STRICTER — `missing` empty
        // and no `sourcesRemoved` are new conditions, which is the whole point:
        // a note whose plain-path source was deleted used to read fresh.
        //
        // The RESULT KEY stays `path`, even though the argument is `note`:
        // the rename exists to keep the host's guard from recognizing an
        // ARGUMENT, and a response key is not an argument. Renaming it too would
        // break every reader of the answer for nothing.
        return {
          path: notePath,
          fresh: v.fresh,
          changed: v.changed,
          missing: v.missing,
          sources: v.sources,
          generated: new Date(v.generatedMs).toISOString(),
          ...(v.expectedSourceCount !== undefined ? { expectedSourceCount: v.expectedSourceCount } : {}),
          ...(v.sourcesRemoved ? { sourcesRemoved: v.sourcesRemoved } : {}),
          globDeletionsUndetectable: v.globDeletionsUndetectable,
        };
      },
    },

    {
      name: "reconcile",
      description:
        "Compare installed plugins (.obsidian/plugins/*/manifest.json), enabled plugins " +
        "(.obsidian/community-plugins.json), and the plugin notes in the configured notes directory. Reports counts " +
        "plus which installed plugins have no note (unnoted) and which notes' versions have drifted from the " +
        "installed manifest (stale). Reads the WHOLE configured notes directory — a partial audit is a misleading " +
        "one — and takes no arguments, so while a Governor path allowlist is active the host blocks it outright " +
        "rather than returning a whole-vault answer. Read-only in intent.",
      inputSchema: {},
      ...RO,
      handler: async () => {
        const cfg = cfgNow();
        const r = await reconcile(source as ProvenanceSource, cfg.notesDir, cfg.notesSource);
        return {
          notesDir: cfg.notesDir,
          notesSource: cfg.notesSource,
          unmatchedSlots: r.unmatchedSlots,
          // Named, like `staleVersion` two lines down — a payload that names
          // everything else must not hand an agent bare positional arrays.
          collidingSlots: r.collidingSlots.map(([id, note]) => ({ id, note })),
          counts: {
            installed: Object.keys(r.installed).length,
            enabled: r.enabled.length,
            noted: Object.keys(r.noted).length,
            unnoted: r.unnoted.length,
            staleVersion: r.staleVersion.length,
          },
          unnoted: r.unnoted,
          staleVersion: r.staleVersion.map(([id, noteVersion, manifestVersion]) => ({ id, noteVersion, manifestVersion })),
        };
      },
    },

    {
      name: "regen",
      description:
        "Regenerate the plugin-audit note's text for the current vault state, preserving hand-written " +
        "`<!-- human:start … -->` sections. DRY-RUN by default (returns the text without writing); `write: true` " +
        "persists it to the configured audit note. The write routes through the accept-forbidden guard and the " +
        "host's guard-patched registrar (read-only mode, queue, journal, if_rev) — it stamps DERIVATION metadata " +
        "only and can never write an acceptance field. It also refuses outright to regenerate over a note this " +
        "generator did not produce. Mutating; blocked outright while a Governor path allowlist is active (its only " +
        "argument is a boolean, so the call cannot be scoped).",
      inputSchema: {
        write: z
          .boolean()
          .optional()
          .describe("Persist the regenerated audit note. Omitted / false ⇒ dry-run (return the text, write nothing)."),
      },
      ...RW,
      handler: async (args: Record<string, unknown>) => {
        const cfg = cfgNow();
        const write = args.write === true;
        // The destination is `cfg.auditNote` in BOTH layouts — flat's default
        // still derives, inside provenanceConfigOf, but the tool never derives
        // again here.
        //
        // Branching on the mode was a half-applied fix and strictly worse than
        // the bug it replaced: `regenerateAudit` read the existing note's
        // human sections from `cfg.auditNote` while this wrote to the derived
        // path, so a flat vault with a configured auditNote had one note's
        // hand-written sections copied over a DIFFERENT note, destroying the
        // target's own. One path, read and written, or they drift.
        const path = cfg.auditNote;
        const text = await regenerateAudit(
          source as ProvenanceSource,
          nowStamp(),
          cfg.notesDir,
          cfg.notesSource,
          cfg.auditNote,
        );
        if (!write) return { dryRun: true, path, text };
        // Destination guard first (is this note ours to rewrite?), then the
        // accept-forbidden guard (would the rendered frontmatter assert
        // acceptance?). Both throw BEFORE anything is written.
        guardAuditDestination(source.noteFrontmatter(path), path);
        guardProvenanceWrite(source.noteFrontmatter(path), text);
        await source.writeNote(path, text);
        // `filesChanged` / `files` is the host's `reportedEffects` convention:
        // the audit note is CONFIGURATION, not an argument, so the journal's
        // argument-derived `target` is empty and this is the only way the file
        // actually written reaches the record's `effects` field. It survives the
        // publishing boundary because the host wraps a returned object as
        // `ok(data)`, making this the `structuredContent` `reportedEffects`
        // reads.
        return { written: path, filesChanged: 1, files: [path] };
      },
    },
  ];
}
