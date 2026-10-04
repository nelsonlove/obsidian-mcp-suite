// tools.ts — the vaultmcp-bases satellite's tool surface (#243): evaluated Base
// result sets for agents. TWO tools, published to the Governor host through
// `vault-mcp-api` (see main.ts):
//
//   list                   — enumerate `.base` files + each file's declared
//                            views (no arguments)
//   query {path,view,limit,engine,allow_hidden}
//                          — the SELECTED view's evaluated rows: by default
//                            from Obsidian's own `base:query` evaluator (#487),
//                            else harvested from a hidden background leaf
//
// ── Why a capture, and what it buys ─────────────────────────────────────────
//
// (This section describes the `view` evaluator; the full engine fidelity it
// claims holds only for `view`. The `fast` evaluator differs: string values,
// Markdown notes only, no groupBy or search box, `this` null.)
// (#487: this is now the `view` evaluator. The default reaches Obsidian's own
// `base:query` handler instead — see `queryBaseRows` and obsidian-source.ts —
// because this capture's scan blocked Obsidian's main thread for 12–18 minutes
// on a vault-wide base and no timer can stop it once it runs.)
//
// Obsidian's public Bases API (1.10+) evaluates a `.base` query ONLY into a
// rendered view: `BasesQueryResult` rows flow to a `BasesView` the engine
// instantiates inside a Bases container; `QueryController` is opaque and
// offers no headless evaluation. So `query` opens the base in a leaf that is
// real to the engine but invisible to the human (see obsidian-source.ts for
// the mechanism and the live findings that shaped it), waits for the engine's
// first COMPLETED data push, materializes the rows (paths + per-column values
// via `BasesEntry.getValue`), and detaches the leaf in a finally. Full engine
// fidelity — base filters, view filters, formulas, sort, the view's own limit —
// because Obsidian computes; this plugin never parses the Bases expression
// language.
//
// ── THE PUBLISHED NAMES CHANGED, AND THE BARE NAMES CHANGED TOO ─────────────
//
// The host publishes an external tool as `<sanitized publisher id>_<bare name>`,
// so the plugin id IS the tool namespace: `vaultmcp-bases` sanitizes to
// `vaultmcp_bases`. Keeping the module's bare names `base_list` / `base_query`
// would have published `vaultmcp_bases_base_list` / `vaultmcp_bases_base_query` —
// stuttering — so the `base_` prefix is stripped from the bare names here:
//
//     shipped (module)  bare name (this file)  published (satellite)
//     base_list         list                   vaultmcp_bases_list
//     base_query        query                  vaultmcp_bases_query
//
// That is a breaking change for any agent session or saved prompt calling the
// old names. Recorded in CLAUDE.md and README.md with the one-line reversal.
//
// ── THE SERIALIZER MOVED WITH THIS SURFACE, and there is NO second copy ─────
//
// At S5 the triage extraction deliberately LEFT `queryBaseRows` and the hidden-
// leaf capture in the host, because a second copy of the serializer in a second
// plugin would RACE the host's over the one global hidden Bases leaf. That
// reasoning does not block THIS extraction and the difference is not a
// loophole: triage was a would-be second CONSUMER, while bases is the OWNER of
// the leaf and of the serializer. A move leaves one copy; a copy would have
// left two. Verified at the extraction: after the move, no reference to
// `queryBaseRows`, `makeSerializer`, `captureSerializer` or `captureWithCleanup`
// remains anywhere in `packages/host/src`.
//
// The serializer below MUST stay MODULE-SCOPED, not per-`buildBasesTools`. The
// hidden leaf is a global resource (one Obsidian window), and a per-build
// serializer would serialize nothing — the host snapshots specs per connection
// and main.ts rebuilds them on every settings write. Pinned by the
// "serialization is MODULE-WIDE" test.
//
// ── Discipline ──────────────────────────────────────────────────────────────
//
//   - READ-ONLY plugin: both tools declare `readOnly: true`, there is no write
//     path, no accept verb, and nothing here mutates the vault or a base file.
//     The host DISTRUSTS that claim unless `vaultmcp-bases` is in the user's
//     `trustedReadOnlyPlugins` setting — see the allowlist note below.
//   - Feature-gated: `buildBasesTools` returns an EMPTY spec list when the
//     running Obsidian lacks the public Bases API (`source.available()` — the
//     fileclass precedent: an enabled plugin degrades cleanly to ABSENT, not
//     broken). Note the grain changed at the extraction: the gate is evaluated
//     at `republish()` time (plugin load + every settings write) rather than
//     per connection build, so an Obsidian upgrade without a plugin reload
//     leaves the tools absent until a reload.
//   - Bounded: one capture at a time, a hard per-query timeout with a TYPED
//     refusal (`base_timeout`) that releases the serializer chain (it does not
//     free Obsidian's main thread from a running view scan; the `window_hidden`
//     gate and the fast road are that protection), and a row cap (`limit`
//     clamps to the configured rowCap) with
//     `truncated`.
//
// ── Allowlist posture as a satellite — be exact, do not round off ───────────
//
// The ENFORCED boundary is the HOST's, and it is evaluated AT CALL TIME on the
// ACTUAL ARGUMENTS, not on the declared schema:
//
//   * The host distrusts an external `readOnly: true` claim unless the raw
//     publisher id `vaultmcp-bases` is listed in `trustedReadOnlyPlugins`.
//     Untrusted ⇒ BOTH tools register as MUTATING, so read-only mode blocks
//     both and each takes a write-queue slot and a journal record. Trust
//     restores read-only-mode availability but does NOT change the gate below
//     (closed 2026-09-05 by the skills satellite's review: trust answers
//     read-only mode, never scoping).
//   * A mutating external tool whose ARGUMENTS carry no recognized path key is
//     blocked outright while a path allowlist is active. `list` takes NO
//     arguments, so under an allowlist it is BLOCKED WHOLESALE — strictly
//     stricter than the module, which filtered its listing. `query` takes
//     `path`, which IS a recognized path key, so it is NOT blocked: the host's
//     guard SCOPES it and refuses `out_of_allowlist` when the `.base` file is
//     hidden.
//   * `ctx.visible` / `ctx.getSettings` are therefore DORMANT seams, unsupplied
//     in the shipped configuration (the skills/triage/crosssession posture).
//     Their tests supply them so they cannot rot, and a `vault-mcp-api` that
//     can carry the caller's scope to a publisher (apiVersion 2) makes them
//     live again with no code change.
//   * THE ROW FILTER IS DORMANT TOO, AND THAT IS A REAL LOSS. `boundRows`'
//     allowlist drop and the `some_rows_hidden` marker depend on `ctx.visible`,
//     and a returned row is {path, properties} — the hidden note's evaluated
//     frontmatter/formula VALUES, not merely its name; say so wherever this
//     loosening is described,
//     which nothing supplies — and the host's guard checks the `path` ARGUMENT,
//     never the discovered ROW paths. So under an allowlist `vaultmcp_bases_query`
//     on a VISIBLE base can now return rows naming notes OUTSIDE the allowlist,
//     where the module filtered them. One tool tightened (`list`), one
//     loosened (`query`'s rows). Both are stated, in README.md too.
//
// ── Envelope convention (the satellite contract) ────────────────────────────
//
// A handler returns PLAIN DATA and THROWS on refusal. The host wraps a return
// value in `ok()` and a thrown error in `fail()`; `fail()` reads a lowercase-
// snake `code` off the thrown error and renders `Error [code]: message`, the
// same shape the module's `codedError` produced — so every typed refusal an
// agent sees is byte-compatible with the folded era. `ok` / `fail` /
// `codedError` themselves are host-internal and are NOT imported here.
//
// ── Schema fidelity across the boundary ─────────────────────────────────────
//
// The SDK converts a zod shape to JSON Schema and the host converts it back
// through a deliberately small subset (`json-schema-to-zod.ts`): `type`,
// `description` and STRING `enum` survive; `default`, `min`, `max` and
// `pattern` DO NOT. So `path`'s `.min(1)` and `limit`'s `.int().min(1)` are
// RE-APPLIED in the handler below — that is the `vaultmcp_skills_release` semver
// lesson: a constraint that lives only in the declared schema never runs for an
// MCP caller.
//
// Obsidian-free by construction: the vault and the engine arrive through the
// injected BasesSource; every handler is headless-testable. The live adapter is
// obsidian-source.ts (only main.ts imports it).

import { z } from "zod";
import type { SdkToolSpec } from "vault-mcp-api";
import type { GuardSettings } from "@vault-mcp/core";
import {
  basesConfigOf,
  baseViewsOf,
  boundRows,
  makeSerializer,
  normalizePropertyId,
  selectView,
  BaseTimeoutError,
  type CapturedRow,
} from "./kernel/index.js";

/** Both tools' SDK flags. `readOnly: true` is a CLAIM the host distrusts by
 * default — see the allowlist note in the header for what that costs. */
const RO = { readOnly: true, destructive: false, idempotent: true } as const;

/**
 * A TYPED refusal, thrown. `fail()` in the host reads a lowercase-snake `code`
 * off the error and renders `Error [code]: message` — the identical envelope
 * the module's `codedError` produced.
 */
export class BasesRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BasesRefusal";
    this.code = code;
  }
}

/** Declared as a FUNCTION, not a const arrow: TypeScript only narrows control
 * flow through a `never`-returning call when the callee is a function
 * declaration (or an explicitly annotated const). */
function refuse(code: string, message: string): never {
  throw new BasesRefusal(code, message);
}

/** What one capture hands back: fully materialized — no live engine object
 * survives past the leaf's detach. */
export interface CaptureResult {
  /** The columns actually harvested (normalized propertyIds). */
  columns: string[];
  rows: CapturedRow[];
}

/** What the plugin needs from the vault + engine — structurally typed, no
 * `obsidian` import. The live adapter is obsidianBasesSource(app). */
export interface BasesSource {
  /** Whether the running Obsidian exposes the public Bases API (1.10+).
   * False ⇒ buildBasesTools publishes nothing. */
  available(): boolean;
  /** Every `.base` file's vault-relative path. */
  listBasePaths(): string[];
  /** Read + YAML-parse one `.base` file. `exists: false` for a missing file;
   * `parseError` set (and `config` absent) when the YAML does not parse. */
  readBaseConfig(path: string): Promise<{ exists: boolean; config?: unknown; parseError?: string }>;
  /**
   * Evaluate the base's named view via the hidden capture leaf and harvest
   * rows for `columns` (normalized propertyIds; null ⇒ derive from the
   * engine's own visible-properties answer). MUST settle within `timeoutMs`
   * (reject with BaseTimeoutError) and MUST release the leaf however it
   * settles. `viewName` undefined ⇒ the file's first declared view.
   */
  capture(path: string, viewName: string | undefined, columns: string[] | null, timeoutMs: number): Promise<CaptureResult>;
  /**
   * #487: whether Obsidian's own `base:query` evaluator is reachable (the Bases
   * core plugin's CLI handler). Optional: absent ⇒ not reachable.
   */
  engineQueryAvailable?(): boolean;
  /**
   * #487: evaluate the view through Obsidian's own `base:query` handler — a
   * metadata scan with no view, no DOM and no timers, about 0.4 s on a
   * 22,765-note vault where the hidden leaf took 12–18 minutes. Columns are
   * `columns` (the view's property ids) when given and the same count as the
   * engine's, else its display names; every value is a string or null. Throws
   * BaseTimeoutError when the metadata cache does not finish within timeoutMs,
   * and an Error carrying the engine's own message when it refuses.
   */
  engineQuery?(path: string, viewName: string, columns: string[] | null, timeoutMs: number): Promise<CaptureResult>;
  /** #487: whether the Obsidian window is hidden (`document.hidden`). Optional: absent ⇒ not hidden. */
  windowHidden?(): boolean;
}

/** Inert source — a stand-in for tests and for a plugin instance with no vault
 * injected: the surface reports unavailable, so nothing publishes. */
export function emptyBasesSource(): BasesSource {
  return {
    available: () => false,
    listBasePaths: () => [],
    readBaseConfig: async () => ({ exists: false }),
    capture: async () => ({ columns: [], rows: [] }),
  };
}

export interface BasesToolsCtx {
  /** The config overrides (this plugin's own settings). A THUNK, read per call:
   * a captured record would freeze the settings tab's values at plugin load.
   * (The tool DESCRIPTIONS below are necessarily build-time snapshots of it,
   * which is why main.ts re-publishes on every settings write.) */
  config: () => Record<string, unknown>;
  /** Guard settings accessor — a DORMANT seam, unsupplied in the shipped
   * configuration (a satellite cannot reach the host's guard settings). Kept
   * for the day `vault-mcp-api` can carry the caller's scope to a publisher. */
  getSettings?: () => GuardSettings;
  /** Allowlist filter — the same dormant seam. Absent ⇒ nothing filtered. */
  visible?: (paths: string[]) => string[];
}

// ONE capture at a time across the whole plugin process (both evaluators, so
// engineQuery also runs through it): the serializer is MODULE-scoped, not
// per-build, because the view evaluator's hidden leaf (and the main thread) is
// a global resource and main.ts rebuilds the specs on every settings write (and the host holds a
// spec snapshot per connection). A per-build serializer would serialize
// nothing. Pinned by test.
const captureSerializer = makeSerializer();

// Belt over the source's own deadline (it wraps engineQuery too):
// `BasesSource.capture` MUST settle within timeoutMs, but that contract is the adapter's to honor — and a
// future non-conforming source would otherwise wedge the plugin-wide chain
// permanently, for every connection (independent-review finding). The race
// settles the SERIALIZER TASK at deadline + grace even if the capture
// promise never settles, so the chain always moves on; a zombie capture's
// own cleanup remains the adapter's responsibility.
const BELT_GRACE_MS = 5_000;
function withBeltDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new BaseTimeoutError(timeoutMs + BELT_GRACE_MS)), timeoutMs + BELT_GRACE_MS);
    }),
  ]);
}

/** True iff the allowlist filter passes this single path through. */
function pathVisible(visible: BasesToolsCtx["visible"], path: string): boolean {
  return !visible || visible([path]).length === 1;
}

/** Whether a path allowlist is active — gates whether `some_rows_hidden` is
 * disclosed at all (with no allowlist it is a constant false and says
 * nothing). DORMANT in the shipped configuration, since nothing supplies
 * `getSettings`. Exported alongside `queryBaseRows` below: the two travel
 * together for any consumer of the seam, and the seam's test suite drives
 * both. */
export function allowlistActive(ctx: Pick<BasesToolsCtx, "getSettings">): boolean {
  const s = ctx.getSettings?.();
  const allow = (s as { allowlist?: string[] } | undefined)?.allowlist;
  return Array.isArray(allow) && allow.length > 0;
}

// ── the shared evaluated-rows seam (#241) ───────────────────────────────────
//
// The WHOLE `query` evaluation path — validation, view selection, the
// serialized + belt-deadlined capture, and the allowlist row bound — as one
// reusable function. `query`'s own handler is a thin shell over this.
//
// It was factored out for a SECOND consumer: the triage module's base-backed
// queues, which needed the same machinery (same serializer, same hidden-leaf
// capture, same typed refusals) rather than a duplicate of it. That consumer
// left the host at S5 and did NOT take the seam with it; its `baseQuery` ctx
// seam in `packages/triage/src/tools.ts` is a SHAPED TYPE that nothing ever
// supplies, so it is not a consumer of this code at all. When bases itself left
// at S7 there were ZERO callers of `queryBaseRows` remaining in the host, which
// is exactly why the serializer could MOVE rather than having to be copied. The
// factored shape stays, both because `query` reads better as a shell over it
// and because it is what a published bases service would expose if apiVersion 2
// ever offers one.

export type BaseRowsRefusal = {
  code:
    | "bases_unavailable"
    | "invalid_path"
    | "not_a_base"
    | "out_of_allowlist"
    | "not_found"
    | "base_parse_error"
    | "view_not_found"
    | "base_timeout"
    | "window_hidden"
    | "engine_unavailable"
    | "base_query_failed";
  message: string;
};

/** #487: which evaluator answered. `fast` = Obsidian's own `base:query`; `view` = the hidden leaf. */
export type BaseEngine = "fast" | "view";

export interface BaseRowsResult {
  view: string;
  viewType: string;
  columns: string[];
  rows: CapturedRow[];
  total: number;
  truncated: boolean;
  someRowsHidden: boolean;
  engine: BaseEngine;
}

export async function queryBaseRows(
  source: BasesSource,
  ctx: { config: Record<string, unknown>; visible?: (paths: string[]) => string[] },
  args: { path: string; view?: string; limit?: number; engine?: "auto" | BaseEngine; allowHidden?: boolean },
): Promise<{ refusal: BaseRowsRefusal } | { result: BaseRowsResult }> {
  const refuseWith = (code: BaseRowsRefusal["code"], message: string) => ({ refusal: { code, message } });
  // The feature gate, callable-level: buildBasesTools checks this before
  // publishing anything, but a direct caller of this function must get a TYPED
  // refusal, not a hang, on a pre-Bases Obsidian.
  if (!source.available()) {
    return refuseWith(
      "bases_unavailable",
      "the running Obsidian does not expose the public Bases API (1.10+) — base-backed queries are unavailable",
    );
  }
  const cfg = basesConfigOf(ctx.config);
  const { path, view, limit } = args;
  const engine = args.engine ?? "auto";
  // BACKSLASH IS REFUSED OUTRIGHT, BEFORE EVERY OTHER PATH CHECK (2026-09-05,
  // the satellite-review rule the triage extraction adopted at plan.ts's
  // `targetProblem`). Every check downstream — this function's `.base` suffix
  // test, `pathVisible`, and the host guard's own `isVisible` — splits on "/"
  // alone, so `Views\..\..\secret.base` reads as ONE opaque segment here and as
  // a traversal to whatever normalizes it later. Obsidian paths never
  // legitimately contain a backslash; refusing is free and closes the class
  // rather than the instance.
  if (path.includes("\\")) {
    return refuseWith("invalid_path", `path contains a backslash, which is never a valid Obsidian path separator: ${path}`);
  }
  if (!path.endsWith(".base")) return refuseWith("not_a_base", `base queries evaluate .base files; got: ${path}`);
  // Belt to the guard's own path-arg allowlist check. DORMANT in the shipped
  // configuration — nothing supplies `visible` — so the ENFORCED check is the
  // host's, which sees `path` because `path` is one of its recognized path
  // keys. Kept because a direct seam caller may have a filter, and because
  // apiVersion 2 re-lights it.
  if (!pathVisible(ctx.visible, path)) {
    return refuseWith("out_of_allowlist", `path is outside the configured allowlist: ${path}`);
  }
  const read = await source.readBaseConfig(path);
  if (!read.exists) return refuseWith("not_found", `no such base: ${path}`);
  if (read.parseError !== undefined) {
    return refuseWith("base_parse_error", `${path} is not valid YAML: ${read.parseError}`);
  }
  const views = baseViewsOf(read.config);
  if (views === null) return refuseWith("base_parse_error", `${path} does not look like a Bases config (not a YAML mapping)`);
  const selected = selectView(views, view);
  if (!selected) {
    const names = views.map((v) => v.name).filter(Boolean);
    return refuseWith(
      "view_not_found",
      view === undefined
        ? `${path} declares no views`
        : `${path} has no view named "${view}" — declared: ${names.length ? names.join(", ") : "(none)"}`,
    );
  }
  const columns = selected.order ? selected.order.map(normalizePropertyId) : null;
  // #487: the fast road first. Obsidian's own `base:query` evaluator scans the
  // metadata cache with no view and no DOM; the hidden leaf below evaluates
  // through a mounted view whose scan blocked the main thread for 12–18
  // minutes on the live vault. The leaf is used only when the fast road is not
  // there (`auto`) or when the caller asks for it (`view`, full view fidelity).
  const fastReachable = source.engineQueryAvailable?.() === true && typeof source.engineQuery === "function";
  if (engine === "fast" && !fastReachable) {
    return refuseWith(
      "engine_unavailable",
      "Obsidian's own base:query evaluator is not reachable (is the Bases core plugin enabled?) — ask for engine \"view\" or \"auto\" instead",
    );
  }
  const useFast = engine !== "view" && fastReachable;
  // #487: the view road's scan is throttled hard while the window is hidden and
  // cannot be stopped once it runs, so it does not start then unless the caller
  // asks for it. The fast road does not depend on the window.
  if (!useFast && !args.allowHidden && source.windowHidden?.() === true) {
    return refuseWith(
      "window_hidden",
      "the Obsidian window is hidden, and the hidden-view evaluation blocks Obsidian for minutes while it is — " +
        "retry with the window in front, or pass allow_hidden: true to run it anyway",
    );
  }
  let captured: CaptureResult;
  try {
    captured = await captureSerializer(() =>
      withBeltDeadline(
        useFast
          ? source.engineQuery!(path, view === undefined ? "" : selected.name, columns, cfg.queryTimeoutMs)
          : source.capture(path, view === undefined ? undefined : selected.name, columns, cfg.queryTimeoutMs),
        cfg.queryTimeoutMs,
      ),
    );
  } catch (e) {
    if (e instanceof BaseTimeoutError) return refuseWith("base_timeout", e.message);
    if (useFast) return refuseWith("base_query_failed", `Obsidian's base:query refused: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
  const cap = Math.min(limit ?? cfg.rowCap, cfg.rowCap);
  const bounded = boundRows(captured.rows, ctx.visible, cap);
  return {
    result: {
      view: selected.name,
      viewType: selected.type,
      columns: captured.columns,
      rows: bounded.rows,
      total: bounded.total,
      truncated: bounded.truncated,
      someRowsHidden: bounded.someRowsHidden,
      engine: useFast ? "fast" : "view",
    },
  };
}

/**
 * Re-apply a `.min(1)` the boundary drops, and the string type with it.
 *
 * The host reconstructs `type: "string"` from the JSON Schema, so a non-string
 * would normally be rejected upstream — but the SDK also accepts a hand-written
 * JSON Schema, and a bare `{}` property degrades to `z.unknown()`. Checking
 * here means the bound holds however the spec reached the host.
 */
/** #487: the `engine` argument, re-checked here for the same reason as `requireText`. */
function optionalEngine(value: unknown): "auto" | BaseEngine | undefined {
  if (value === undefined) return undefined;
  if (value === "auto" || value === "fast" || value === "view") return value;
  refuse("invalid_argument", "'engine' must be one of auto, fast, view");
}

function requireText(value: unknown, argument: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    refuse("invalid_argument", `'${argument}' must be a non-empty string`);
  }
  return value;
}

/** The same discipline for `limit`: `.int().min(1)` does not survive the
 * boundary either, and a 0 / negative / fractional limit would silently
 * mis-slice rather than being rejected. */
function optionalPositiveInt(value: unknown, argument: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    refuse("invalid_argument", `'${argument}' must be an integer of at least 1`);
  }
  return value;
}

export function buildBasesTools(source: BasesSource, ctx: BasesToolsCtx): SdkToolSpec[] {
  // Feature gate (the fileclass precedent): no public Bases API ⇒ the whole
  // surface is ABSENT, not broken. Evaluated at build time, and main.ts builds
  // on load and on every settings write — so an Obsidian upgrade without a
  // plugin reload leaves the tools absent until a reload. Stated in README.md.
  if (!source.available()) return [];

  /** The effective config, resolved PER CALL so a settings edit lands live. */
  const cfgNow = () => basesConfigOf(ctx.config());
  /** The config as it stands while the SPECS are built — descriptions only.
   * The host snapshots a published spec, so this is necessarily frozen at
   * publish time; main.ts re-publishes on every settings write. */
  const cfgAtBuild = cfgNow();

  return [
    {
      name: "list",
      description:
        "Enumerate every `.base` file in the vault with its declared views (name, type, column count). Reads each " +
        "base's YAML; evaluates nothing — use the query tool for a view's result rows. Broken files are listed with " +
        "a marker (`error: \"parse_error\"` for bad YAML, `\"invalid_shape\"` for YAML that is not a Bases mapping) " +
        "rather than dropped. Read-only in intent; the Governor host registers it as mutating unless this plugin is " +
        "trusted, and BLOCKS IT OUTRIGHT while a path allowlist is active — it takes no arguments at all, so there " +
        "is nothing for the host to scope by.",
      inputSchema: {},
      ...RO,
      handler: async () => {
        const paths = ctx.visible ? ctx.visible(source.listBasePaths()) : source.listBasePaths();
        const bases = [];
        for (const path of paths.slice().sort()) {
          const read = await source.readBaseConfig(path);
          if (!read.exists) continue; // raced a delete — simply absent
          if (read.parseError !== undefined) {
            bases.push({ path, views: null, error: "parse_error" });
            continue;
          }
          const views = baseViewsOf(read.config);
          if (views === null) {
            bases.push({ path, views: null, error: "invalid_shape" });
            continue;
          }
          bases.push({
            path,
            views: views.map((v) => ({ name: v.name, type: v.type, columns: v.order ? v.order.length : null })),
          });
        }
        return { total: bases.length, bases };
      },
    },

    {
      name: "query",
      description:
        "Evaluate a view of the named `.base` file and return its rows: each row's note path plus the view's " +
        "columns' values (stringified). `view` selects among the base's declared views (default: the first); " +
        `\`limit\` caps rows (clamped to this plugin's row cap, currently ${cfgAtBuild.rowCap}). Read-only. ` +
        "Two evaluators (`engine`): `fast` is Obsidian's own `base:query` (a metadata scan, under a second on a " +
        "large vault; values are strings; it reads only Markdown notes, ignores groupBy, " +
        "and evaluates `this` as null); `view` opens the base in a hidden background leaf for full view fidelity " +
        "(columns are property ids), which can block Obsidian for minutes on a vault-wide base and so refuses " +
        "`window_hidden` while the Obsidian window is hidden unless `allow_hidden` is true. The default, `auto`, " +
        "uses `fast` when it is reachable and `view` otherwise; the result's `engine` says which answered. Queries " +
        `are serialized and time-boxed (currently ${cfgAtBuild.queryTimeoutMs}ms, \`base_timeout\`). \`path\` is a ` +
        "recognized path argument, so under a Governor path allowlist this tool is scoped rather than blocked: a " +
        "hidden `.base` refuses `out_of_allowlist`. Note that RESULT ROWS are not allowlist-filtered in this " +
        "configuration — the host scopes the base you name, not the notes the engine returns.",
      inputSchema: {
        path: z.string().min(1).describe('Vault-relative path of the `.base` file, e.g. "Views/Tasks.base".'),
        view: z.string().min(1).optional().describe("Declared view name to evaluate (default: the file's first view)."),
        limit: z.number().int().min(1).optional().describe("Maximum rows to return (clamped to the plugin's row cap)."),
        engine: z
          .enum(["auto", "fast", "view"])
          .optional()
          .describe("Evaluator: auto (default: fast when reachable, else view), fast (Obsidian's base:query), view (hidden leaf, full fidelity)."),
        allow_hidden: z
          .boolean()
          .optional()
          .describe("Let the view evaluator run while the Obsidian window is hidden (it can block Obsidian for minutes)."),
      },
      ...RO,
      handler: async (args: Record<string, unknown>) => {
        // The schema's bounds do not survive the publishing boundary — re-apply
        // them here, where they actually run. See the header.
        const path = requireText(args.path, "path");
        const view = args.view === undefined ? undefined : requireText(args.view, "view");
        const limit = optionalPositiveInt(args.limit, "limit");
        const engine = optionalEngine(args.engine);
        if (args.allow_hidden !== undefined && typeof args.allow_hidden !== "boolean") {
          refuse("invalid_argument", "'allow_hidden' must be a boolean");
        }
        const outcome = await queryBaseRows(
          source,
          { config: ctx.config(), visible: ctx.visible },
          { path, view, limit, engine, allowHidden: args.allow_hidden === true },
        );
        if ("refusal" in outcome) refuse(outcome.refusal.code, outcome.refusal.message);
        const r = outcome.result;
        return {
          path,
          view: r.view,
          view_type: r.viewType,
          engine: r.engine,
          columns: r.columns,
          rows: r.rows.map((row) => ({ path: row.path, properties: row.values })),
          total: r.total,
          truncated: r.truncated,
          // Only meaningful (and only disclosed) when an allowlist is active
          // AND this plugin can see it — which it cannot in the shipped
          // configuration, so the key is absent there. With no allowlist the
          // field would be a constant false and say nothing.
          ...(allowlistActive(ctx) ? { some_rows_hidden: r.someRowsHidden } : {}),
        };
      },
    },
  ];
}
