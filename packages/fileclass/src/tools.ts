// tools.ts — the vault-fileclass satellite's tool surface (#188): typed
// frontmatter given an agent surface, by PROXYING the standalone `fileclass`
// CLI (github.com/mdelobelle/fileclass-cli, the terminal for the Fileclass
// Obsidian plugin — a typed-frontmatter / fileClass engine). EIGHT tools,
// published to the Governor host through `vault-mcp-api` (see main.ts):
//
//   READ (declared readOnly — a claim the host distrusts, see below)
//     list      — every fileClass                          (`fileclasses`)
//     schema    — a fileClass's options + resolved fields  (`schema <name>`)
//     explain   — a note's fileClasses + field values      (`explain <path>`)
//     query     — rows for a fileClass, filtered           (`list <class> --where …`)
//     get       — one field's value on a note              (`get <path> <field>`)
//     validate  — schema violations (the CLI exits 1)      (`validate`)
//
//   WRITE
//     set       — validated single-note field write        (`set <path> <field> <value>`)
//     set_where — validated bulk write, DRY-RUN by default (`set-where <class> <field> <value>`)
//
// ── Proxy, not engine-integration (unchanged by the extraction) ─────────────
//
// This surface SHELLS OUT to the `fileclass` CLI via execFile, the obsidian_cli
// precedent. The fileClass engine is the Fileclass PLUGIN's internal, unexported
// machinery; the CLI is the plugin author's own supported terminal for it,
// driving the LIVE plugin through `obsidian eval`, so results have full engine
// fidelity (validation, Bases queries, inheritance) that a re-implementation
// over the metadata cache could not match. The alternative — calling
// `app.plugins.plugins.fileclass.api` directly — would couple this file to
// `app`, breaking its Obsidian-free contract and its headless tests, and
// re-derive the CLI's argument/JSON surface by hand. `execFile`, the presence
// probe and the binary are all INJECTED, so argv construction, `--json`
// parsing, the accept-guard refusal and the dry-run gate are unit-tested; only
// the live subprocess and the plugin-presence probe are un-headless.
//
// ── THE PUBLISHED NAMES CHANGED, AND THE BARE NAMES CHANGED TOO ────────────
//
// The host publishes an external tool as `<sanitized publisher id>_<bare name>`,
// so the plugin id IS the tool namespace: `vault-fileclass` sanitizes to
// `vault_fileclass`. Keeping the module's bare names `fileclass_list` … would
// have published the stuttering `vault_fileclass_fileclass_list`, so the
// `fileclass_` prefix is stripped from the bare names here — the same motion
// the bases satellite made with `base_`:
//
//     shipped (module)     bare name (this file)  published (satellite)
//     fileclass_list       list                   vault_fileclass_list
//     fileclass_schema     schema                 vault_fileclass_schema
//     fileclass_explain    explain                vault_fileclass_explain
//     fileclass_query      query                  vault_fileclass_query
//     fileclass_get        get                    vault_fileclass_get
//     fileclass_validate   validate               vault_fileclass_validate
//     fileclass_set        set                    vault_fileclass_set
//     fileclass_set_where  set_where              vault_fileclass_set_where
//
// One published name COLLIDES with an unrelated host tool and that is worth
// knowing rather than discovering: the host has always shipped
// `obsidian_fileclass_schema` for the DIFFERENT metadata-menu plugin. It is
// untouched, differently spelled, and unrelated to this package.
//
// ── ARGUMENT RENAMES: `path` → `note_path` → (for the reads) `note` ────────
//
// This is the whole allowlist posture, and it took three generations to settle.
// Read the round-2 block below before changing any argument name here.
//
// The module refused its WHOLE SURFACE while a path allowlist was active: the
// CLI runs over the entire vault through its engine and its output cannot be
// attributed to paths, so a scoped answer was not expressible (the obsidian_cli
// / Dataview precedent). That refusal was IN-MODULE, over `ctx.getSettings()`.
// A satellite cannot see the host's allowlist, so that check goes dormant —
// and the question becomes what the HOST would enforce in its place.
//
// The host's F3 gate blocks a mutating external tool whose ACTUAL ARGUMENTS
// carry no recognized path key while an allowlist is active, and every external
// tool is mutating unless its publisher is trusted (and trust answers read-only
// mode, never scoping — closed 2026-09-05 by the skills satellite's review). So
// the surface's posture is decided entirely by whether its arguments are named
// `path`.
//
// KEEPING `path` would have left `explain` / `get` / `set` OPEN under an
// allowlist, scoped per-path by the host, while `list` / `schema` / `query` /
// `validate` / `set_where` stayed blocked. That is strictly WEAKER than the
// module's refuse-all, and weaker in the direction that matters: the host would
// scope the note NAMED, while the CLI still runs its engine over the whole
// vault and returns whatever that engine attributes to the note — inheritance
// from fileClass definitions the session cannot see, and, for `set`, a write
// the CLI performs through the live plugin rather than through any path the
// guard inspected.
//
// So the path-shaped argument was named `note_path`, which was NOT in the host's
// PATH_KEYS at the extraction. All eight tools therefore carried no recognized
// path key and were BLOCKED WHOLESALE under an active allowlist — reproducing
// the module's whole-surface refusal exactly, enforced by the host instead of by
// a check this package can no longer make. Fail-closed.
//
// ── ROUND 2 (2026-09-07): the argument split in TWO, and here is why ────────
//
// The paragraphs above are the extraction's reasoning and they stand as history.
// Two corrections landed on top of them, in order, and the second is the posture
// this file now ships:
//
//   ROUND 1 — the host ADDED `note_path` to its PATH_KEYS. The rename above had
//   quietly cost more than allowlist availability: `collectPaths` is not the
//   allowlist's private walker. The SAME list feeds record immutability, the
//   advisory-lock consult and the journal record's `target.path`, and NONE of
//   those is gated on an allowlist. A pathless `set` could field-write a
//   `record: true` note the kernel used to refuse, on every vault, allowlist or
//   not. Recognizing `note_path` restored all three.
//
//   ROUND 2 — but round 1 also silently re-opened `explain` and `get` to
//   per-path scoping under an allowlist, which is exactly the weaker posture
//   the paragraphs above rejected. The resolution is that kernel visibility is
//   a MUTATING concern: the record guard, the lock consult and the journal
//   target all bind at the mutating dequeue, so a READ tool gains NOTHING from
//   being path-keyed. It only loses the refusal. So:
//
//     * `explain` and `get` — READS whose answer can name paths outside the
//       allowlist (the engine resolves inheritance from fileClass definitions
//       the session cannot see) — spell the argument `note`, which is not a
//       recognized key. Under an allowlist F3 refuses them outright, closing
//       that path oracle at zero kernel cost. With no allowlist, unchanged.
//     * `set` — the one MUTATING tool that names a note — keeps `note_path`.
//       The record guard on the note it rewrites is always-on protection and
//       is worth more than the refusal; the allowlist scopes it per-path like
//       every host write tool.
//     * `list` / `schema` / `query` / `validate` / `set_where` are pathless as
//       they always were, so F3 still refuses them wholesale.
//
// The reversal in either direction is one word per tool: `note` → `path` opens
// a read to host scoping, `note_path` → `note` takes a write back out of the
// kernel's sight. Neither is free, and this file says which cost each buys.
//
// `allowlistRefusal` below is KEPT as a dormant seam over `ctx.getSettings`,
// the skills/triage/crosssession/bases posture: nothing supplies it in the
// shipped configuration, its tests supply it so it cannot rot, and a
// `vault-mcp-api` that can carry the caller's scope to a publisher (apiVersion
// 2) makes it live again with no code change.
//
// ── Accept boundary (load-bearing, and unchanged) ──────────────────────────
//
// `set` / `set_where` write typed frontmatter, so they MUST route through the
// accept-forbidden guard like every other vault write: a fileclass field-write
// can NEVER introduce or change an `accepted` / `accepted-by` / `accepted-on`
// field, nor set `acceptance-status` to an accepted value. Acceptance is a human
// gesture only, in no API. The write goes out through the CLI, not through any
// vault write primitive, so the SAME `acceptForbiddenReason` rule
// (`@vault-mcp/core` — no second definition of "accepted") is applied HERE,
// before the command runs. This is the gating point issue #105 asks for on the
// fileclass field-write surface, and it survives the extraction unchanged
// because the rule was already core's.
//
// This surface contributes NO accept/approve verb.
//
// ── Envelope convention, and the ONE envelope that changed ─────────────────
//
// A handler returns PLAIN DATA and THROWS on refusal. The host wraps a return
// value in `ok()` and a thrown error in `fail()`; `fail()` reads a lowercase-
// snake `code` off the thrown error and renders `Error [code]: message` — the
// same shape the module's `codedError` produced, so `accept_forbidden` and
// `out_of_allowlist` are byte-compatible with the folded era.
//
// WHAT CHANGED: the module used `okError()` for a FAILED CLI run — ok()'s shape
// plus `isError: true`, so the structured per-command report survived a total
// failure (a bare `fail()` would have flattened it to text). The publishing
// boundary has no `okError`: a returned object becomes `ok(data)` and a thrown
// error becomes `fail(err)`, and there is no third option. Throwing would
// destroy the report, which is the thing `okError` existed to preserve — so a
// failed CLI run RETURNS its report, with an explicit `succeeded: false` and
// the exit code, rather than an error envelope. The consequence, stated plainly
// because a client keying on `isError` will see it: a fileclass CLI failure now
// arrives as a SUCCESSFUL MCP call carrying a report that says it failed. Read
// `succeeded`, not `isError`. Every tool description says so.
//
// ── Schema fidelity across the boundary ────────────────────────────────────
//
// The SDK converts a zod shape to JSON Schema and the host converts it back
// through a deliberately small subset (`json-schema-to-zod.ts`): `type`,
// `description` and STRING `enum` survive; `default`, `min`, `max` and
// `pattern` DO NOT. Every `.min(1)` / `.int()` / range below is therefore
// re-applied in the handler (`requireText`, `optionalTimeout`, `optionalLimit`)
// — the `vault_skills_release` semver lesson, applied rather than repeated.

import { z } from "zod";
import type { SdkToolSpec } from "vault-mcp-api";
import { acceptForbiddenReason, findBinary, spawnEnv, type GuardSettings } from "@vault-mcp/core";
import { execFile } from "node:child_process";
import * as os from "node:os";

/** The read tools' SDK flags. `readOnly: true` is a CLAIM the host distrusts
 * unless the raw publisher id `vault-fileclass` is listed in the host's
 * `trustedReadOnlyPlugins` setting — see the allowlist note in the header for
 * what that does and does not buy. */
const RO = { readOnly: true, destructive: false, idempotent: true } as const;
/** The write tools' SDK flags. Not destructive-by-default (a single validated
 * field write), but a `set_where` with `apply: true` can touch many notes — the
 * dry-run default is the safety. */
const RW = { readOnly: false, destructive: false, idempotent: false } as const;

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_BUFFER = 4 * 1024 * 1024;

/** The Fileclass plugin's id. Its manifest declares `"id": "fileclass"`, and
 * the CLI installs as the `fileclass` command. */
export const FILECLASS_PLUGIN_ID = "fileclass";

/**
 * A TYPED refusal, thrown. The host's `fail()` reads a lowercase-snake `code`
 * off the error and renders `Error [code]: message` — the identical envelope
 * the module's `codedError` produced.
 */
export class FileclassRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "FileclassRefusal";
    this.code = code;
  }
}

/** Declared as a FUNCTION, not a const arrow: TypeScript only narrows control
 * flow through a `never`-returning call when the callee is a function
 * declaration (or an explicitly annotated const). */
function refuse(code: string, message: string): never {
  throw new FileclassRefusal(code, message);
}

/**
 * Locate the `fileclass` CLI binary, or null. Probes the standard install
 * targets the CLI's own docs prescribe (npm-global / user bin / Homebrew /
 * system), since Obsidian's GUI PATH is minimal. Pure + testable: `fileExists`
 * and `homedir` are injectable. An explicit config `binaryPath` always wins
 * over this probe.
 *
 * `findBinary` comes from `@vault-mcp/core` — the same executable-file probe
 * the host uses for `claude` and `obsidian`, published at this extraction
 * rather than forked, so the two cannot disagree about what "found" means.
 */
export function findFileclassBinary(opts?: {
  candidates?: string[];
  fileExists?: (p: string) => boolean;
  homedir?: string;
}): string | null {
  const home = opts?.homedir ?? os.homedir();
  const candidates =
    opts?.candidates ?? [
      "/usr/local/bin/fileclass",
      "/opt/homebrew/bin/fileclass",
      `${home}/.local/bin/fileclass`,
      `${home}/.npm-global/bin/fileclass`,
      "/usr/bin/fileclass",
    ];
  return findBinary(candidates, opts?.fileExists);
}

// ── accept-forbidden guard on the fileclass field-write path ────────────────
//
// A fileclass `set` / `set-where` writes ONE field to a value. That reduces to
// the same `{ [field]: value }` frontmatter shape the shared accepted-family
// rule already decides over (`acceptForbiddenReason` — the exact rule the vault
// write primitive and the obsidian_cli `property:set` path reuse; no second
// definition of "accepted"). It refuses:
//   • an accepted-family KEY (`accepted` / `accepted-by` / `accepted-on`), or
//   • the `acceptance-status` field set to an accepted VALUE.
// A property literally named `status`, or `acceptance-status: proposed`, is
// allowed — matching every other accept-guard surface. This is always an
// INTRODUCE on the CLI path (there is no "carry an existing human-granted value
// forward" expression), so `acceptForbiddenReason`'s introduce check is exactly
// right.
/**
 * The reason a fileclass field-write would introduce acceptance, or null when
 * it is clean. `value` is coerced to a string first (the CLI is handed a
 * string), so a numeric/boolean field value cannot dodge the check by type.
 */
export function fileclassSetAcceptRefusal(field: string, value: string | number | boolean): string | null {
  return acceptForbiddenReason({ [field]: String(value) });
}

// ── CLI arg construction (pure + testable) ──────────────────────────────────

/** A fileclass subcommand + its positionals + optional flags. `--vault <name>`
 * and `--json` are appended by `buildFileclassArgs`, so the vault is always
 * pinned to THIS vault (a session can never cross into another vault) and every
 * command is machine-readable. */
export interface FileclassCommand {
  command: string;
  positionals?: string[];
  where?: string;
  columns?: string;
  limit?: number;
  fileclass?: string;
  apply?: boolean;
}

// Subcommand names this package issues — a closed set, lowercase, so nothing
// caller-derived ever reaches argv as a command.
const KNOWN_COMMANDS = new Set(["fileclasses", "schema", "explain", "list", "get", "validate", "set", "set-where"]);

/**
 * Argv for `fileclass <command> [positionals…] [--flags…] --vault <name> --json`.
 * execFile makes shell injection impossible (each element is a distinct argv
 * entry), so these checks surface programming mistakes, not shell safety. The
 * vault is pinned LAST via `--vault <name>` (fileclass precedence:
 * `--vault` > FILECLASS_VAULT > persisted default > active vault), so it always
 * wins; a positional or flag can never redirect the target vault.
 */
export function buildFileclassArgs(vaultName: string, cmd: FileclassCommand): string[] {
  const command = cmd.command.trim();
  if (!KNOWN_COMMANDS.has(command)) throw new Error(`unknown fileclass command: '${cmd.command}'`);
  const args: string[] = [command, ...(cmd.positionals ?? [])];
  if (cmd.where !== undefined && cmd.where !== "") args.push("--where", cmd.where);
  if (cmd.columns !== undefined && cmd.columns !== "") args.push("--columns", cmd.columns);
  if (cmd.limit !== undefined) args.push("--limit", String(cmd.limit));
  if (cmd.fileclass !== undefined && cmd.fileclass !== "") args.push("--fileclass", cmd.fileclass);
  if (cmd.apply === true) args.push("--apply");
  args.push("--vault", vaultName, "--json");
  return args;
}

// ── exec seam (injected for tests) ──────────────────────────────────────────

export interface FileclassExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  errorMessage?: string;
}
export type FileclassExec = (bin: string, args: string[], timeoutMs: number) => Promise<FileclassExecResult>;

/** The production exec: execFile with an augmented env. `FILECLASS_QUIET=1`
 * silences the CLI's `vault:` stderr line; `OBSIDIAN_BIN` points the CLI at the
 * obsidian binary (its `obsidian eval` bridge) when one was found, since
 * Obsidian's GUI PATH is minimal. `spawnEnv` (from `@vault-mcp/core`, published
 * at this extraction) augments PATH the same way every other spawn site in the
 * suite does — one copy, so this satellite's subprocess cannot fail where the
 * host's succeeds. */
export function makeDefaultExec(obsidianBin: string | null): FileclassExec {
  return (bin, args, timeoutMs) =>
    new Promise((resolve) => {
      const env: NodeJS.ProcessEnv = { ...spawnEnv(), FILECLASS_QUIET: "1" };
      if (obsidianBin) env.OBSIDIAN_BIN = obsidianBin;
      execFile(bin, args, { env, timeout: timeoutMs, maxBuffer: MAX_BUFFER, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
        if (!err) {
          resolve({ exitCode: 0, stdout, stderr, timedOut: false });
          return;
        }
        const anyErr = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
        resolve({
          exitCode: typeof anyErr.code === "number" ? anyErr.code : null,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          timedOut: anyErr.killed === true,
          errorMessage: typeof anyErr.code === "number" ? undefined : anyErr.message,
        });
      });
    });
}

// ── the report shaper ───────────────────────────────────────────────────────

/** Parse the CLI's `--json` stdout into structured data, falling back to raw
 * text when it is not JSON (a diagnostic the CLI printed plainly). */
function parseJsonOut(stdout: string): { data?: unknown; raw?: string } {
  const trimmed = stdout.trim();
  if (trimmed === "") return {};
  try {
    return { data: JSON.parse(trimmed) };
  } catch {
    return { raw: stdout };
  }
}

export interface FileclassToolsCtx {
  /** Config overrides, read PER CALL rather than captured — the settings tab
   * writes them and `main.ts` re-publishes, but a thunk means a handler never
   * serves a value the tab has already changed. Carries the optional
   * `binaryPath`. */
  config: () => Record<string, unknown>;
  /** Whether the Fileclass plugin is LOADED (`app.plugins.plugins.fileclass`)
   * — the LOADED instance, never `enabledPlugins`, which can list a
   * configured-but-uninstalled plugin. No plugin ⇒ nothing is published. */
  present: () => boolean;
  /** This vault's name, pinned into every CLI call via `--vault`. */
  vaultName: () => string;
  /** Injected exec (tests). Absent ⇒ the production execFile. */
  exec?: FileclassExec;
  /** Injected binary (tests) or an explicit override. `undefined` ⇒ resolve
   * from `config().binaryPath`, else probe the filesystem; `null` ⇒ no binary,
   * and nothing is published. */
  binary?: string | null;
  /** Injected obsidian-binary resolver result (tests). Absent ⇒ probe. */
  obsidianBinary?: string | null;
  /** DORMANT SEAM. Nothing supplies this in the shipped configuration — a
   * satellite cannot reach the host's guard settings, and the host's F3 gate is
   * the enforced boundary (see the header). Kept because the tests supply it,
   * so `allowlistRefusal` cannot rot, and because an apiVersion-2
   * `vault-mcp-api` that can carry the caller's scope to a publisher makes it
   * live again with no change here. */
  getSettings?: () => GuardSettings;
}

/**
 * The module's whole-surface allowlist refusal, kept as a DORMANT seam.
 *
 * The fileclass CLI runs over the whole vault through its engine and its output
 * cannot be path-scoped, so — like obsidian_cli and the Dataview query tools —
 * the whole surface refuses rather than return an unenforceably-partial answer.
 * With `ctx.getSettings` unsupplied this never fires; the ENFORCED equivalent is
 * the host's F3 block, which reaches all eight tools because none of them
 * carries a recognized path key (see the header's argument-rename note).
 */
export function allowlistRefusal(settings: GuardSettings | undefined): { code: string; message: string } | null {
  if (settings?.allowlist && settings.allowlist.length > 0) {
    return {
      code: "out_of_allowlist",
      message:
        "fileclass tools are disabled while a path allowlist is active: the fileclass CLI runs over the whole vault " +
        "through its engine, so its output cannot be path-scoped to the allowlist.",
    };
  }
  return null;
}

/** Re-apply a `.min(1)` the JSON-Schema round trip drops. */
function requireText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    refuse("invalid_argument", `'${name}' is required and must be a non-empty string`);
  }
  return value;
}

/** A vault-relative note path argument.
 *
 * The BACKSLASH refusal is first, before every other check — the same rule the
 * triage and bases satellites adopted. Every check downstream (here, the CLI's
 * own path handling, and the host guard's `isVisible` for the one argument that
 * IS a path key) splits on `/` alone, so a backslash reads as ONE opaque segment
 * here and as a traversal to whatever normalizes it later. An Obsidian path
 * never legitimately contains a backslash, so refusing is free and closes the
 * class rather than the instance.
 *
 * `name` is REQUIRED at every call site rather than defaulted, because the two
 * spellings are the posture (round 2): `note` on the reads, `note_path` on the
 * write. A refusal message must name the argument the caller actually passed. */
function requireNotePath(value: unknown, name: string): string {
  const text = requireText(value, name);
  if (text.includes("\\")) {
    refuse("invalid_path", `'${name}' contains a backslash ('${text}') — vault paths use '/' only`);
  }
  return text;
}

/** Re-apply the timeout range the JSON-Schema round trip drops. */
function optionalTimeout(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_TIMEOUT_MS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    refuse(
      "invalid_argument",
      `'timeout_ms' must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

/** Re-apply `limit`'s `.int().min(1)`. */
function optionalLimit(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    refuse("invalid_argument", `'limit' must be a positive integer (got ${JSON.stringify(value)})`);
  }
  return value;
}

/** The field VALUE union, re-applied: the schema declares string|number|boolean
 * and the round trip does not reliably carry a union, so the handler decides. */
function requireFieldValue(value: unknown): string | number | boolean {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  refuse("invalid_argument", `'value' must be a string, number or boolean (got ${JSON.stringify(value)})`);
}

const ACCEPT_REFUSAL_TAIL =
  ". Acceptance is a human gesture, in no API — the fileclass proxy will not persist it. Agents write only " +
  "acceptance-status: proposed; never accepted / accepted-by / accepted-on.";

/**
 * Build the eight specs, or NONE.
 *
 * The double gate survives the extraction, at a coarser GRAIN: as a module it
 * ran per connection build, so a session that reconnected after installing the
 * Fileclass plugin or the CLI got the tools. Here it runs at publish time —
 * plugin load, and every settings write. So installing the plugin or the binary
 * without reloading this plugin (or touching a setting) leaves the tools absent
 * until a reload. The settings tab says which state you are in. This is the
 * bases satellite's feature-gate precedent, and the same honest caveat.
 */
export function buildFileclassTools(ctx: FileclassToolsCtx): SdkToolSpec[] {
  // Plugin-presence gate: the LOADED instance, not `enabledPlugins`.
  if (!ctx.present()) return [];
  // Binary gate: config.binaryPath wins, else probe the filesystem.
  const cfg = ctx.config();
  const configBin =
    typeof cfg?.binaryPath === "string" && cfg.binaryPath.trim() ? cfg.binaryPath.trim() : null;
  const binary = ctx.binary !== undefined ? ctx.binary : configBin ?? findFileclassBinary();
  if (!binary) return [];

  const exec = ctx.exec ?? makeDefaultExec(ctx.obsidianBinary ?? null);

  /** The dormant allowlist seam, consulted first on every call. */
  const guard = () => {
    const refusal = allowlistRefusal(ctx.getSettings?.());
    if (refusal) refuse(refusal.code, refusal.message);
  };

  /**
   * Run a fileclass command and shape the report.
   *
   * `okExitCodes` lets `validate` treat exit 1 (violations found) as a
   * successful RUN rather than a tool failure. The report always carries
   * `succeeded` — see the header: the publishing boundary has no `okError`, so
   * a failed run returns its structured report with `succeeded: false` instead
   * of an error envelope, because throwing would flatten the report to text and
   * the report is the thing worth keeping.
   */
  const run = async (cmd: FileclassCommand, timeoutMs: number, opts?: { okExitCodes?: number[] }) => {
    const argv = buildFileclassArgs(ctx.vaultName(), cmd);
    const started = Date.now();
    const res = await exec(binary, argv, timeoutMs);
    const parsed = parseJsonOut(res.stdout);
    const okExit = opts?.okExitCodes ?? [0];
    const succeeded = res.exitCode !== null && okExit.includes(res.exitCode);
    return {
      succeeded,
      command: cmd.command,
      argv,
      exit_code: res.exitCode,
      timed_out: res.timedOut,
      duration_ms: Date.now() - started,
      ...(parsed.data !== undefined ? { result: parsed.data } : {}),
      ...(parsed.raw !== undefined ? { stdout: parsed.raw } : {}),
      ...(res.stderr ? { stderr: res.stderr } : {}),
      ...(res.errorMessage ? { error: res.errorMessage } : {}),
      ...(res.timedOut
        ? {
            note:
              "the fileclass CLI forwards into the running Obsidian; killing it on timeout does not cancel an in-app " +
              "write — verify state before retrying",
          }
        : {}),
    };
  };

  const timeoutSchema = z
    .number()
    .int()
    .min(MIN_TIMEOUT_MS)
    .max(MAX_TIMEOUT_MS)
    .optional()
    .describe(`Time budget for the command in ms (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`);

  /** Appended to every description: the two things an agent gets wrong first. */
  const COMMON =
    " Read `succeeded` in the result, not the call's error flag: a failed CLI run returns its full report with " +
    "`succeeded: false`. Blocked outright while the Governor host has a path allowlist configured (no argument here " +
    "is a host path key, so the call cannot be scoped).";

  return [
    {
      name: "list",
      description:
        "List every fileClass defined in the vault (name, extends, field count, whether it has a Base view). " +
        "Proxies the Fileclass CLI `fileclasses --json`." +
        COMMON,
      inputSchema: { timeout_ms: timeoutSchema },
      ...RO,
      handler: async (args: Record<string, unknown>) => {
        guard();
        return run({ command: "fileclasses" }, optionalTimeout(args.timeout_ms));
      },
    },

    {
      name: "schema",
      description:
        "Return a fileClass's options and resolved fields (with ancestry from `extends`). Proxies the Fileclass CLI " +
        "`schema <name> --json`." +
        COMMON,
      inputSchema: {
        fileclass: z.string().min(1).describe("FileClass name, e.g. 'Book'."),
        timeout_ms: timeoutSchema,
      },
      ...RO,
      handler: async (args: Record<string, unknown>) => {
        guard();
        const fileclass = requireText(args.fileclass, "fileclass");
        return run({ command: "schema", positionals: [fileclass] }, optionalTimeout(args.timeout_ms));
      },
    },

    {
      name: "explain",
      description:
        "Explain a note: its fileClasses, ancestry, and resolved field values. Proxies the Fileclass CLI " +
        "`explain <path> --json`. Under an active Governor path allowlist this call is refused outright: the note " +
        "argument is named `note` rather than `path` or `note_path`, so the host recognizes no path key and blocks " +
        "it. That is deliberate — the CLI resolves inheritance from fileClass definitions the session cannot see, so " +
        "a per-path-scoped answer would still name notes outside the allowlist." +
        COMMON,
      inputSchema: {
        note: z
          .string()
          .min(1)
          .describe("Vault-relative note path, e.g. 'Books/Dune.md'. (Named `note`, not `path`/`note_path`, deliberately — see the plugin's README.)"),
        timeout_ms: timeoutSchema,
      },
      ...RO,
      handler: async (args: Record<string, unknown>) => {
        guard();
        const notePath = requireNotePath(args.note, "note");
        return run({ command: "explain", positionals: [notePath] }, optionalTimeout(args.timeout_ms));
      },
    },

    {
      name: "query",
      description:
        "List rows for a fileClass, optionally filtered / columned / limited. Proxies the Fileclass CLI " +
        "`list <class> [--where …] [--columns …] [--limit …] --json`." +
        COMMON,
      inputSchema: {
        fileclass: z.string().min(1).describe("FileClass name, e.g. 'Book'."),
        where: z.string().optional().describe("Filter expression, e.g. 'status is unread'."),
        columns: z.string().optional().describe("Comma-separated columns, e.g. 'title,author'."),
        limit: z.number().int().min(1).optional().describe("Maximum rows to return."),
        timeout_ms: timeoutSchema,
      },
      ...RO,
      handler: async (args: Record<string, unknown>) => {
        guard();
        const fileclass = requireText(args.fileclass, "fileclass");
        const where = args.where === undefined ? undefined : requireText(args.where, "where");
        const columns = args.columns === undefined ? undefined : requireText(args.columns, "columns");
        return run(
          { command: "list", positionals: [fileclass], where, columns, limit: optionalLimit(args.limit) },
          optionalTimeout(args.timeout_ms),
        );
      },
    },

    {
      name: "get",
      description:
        "Get one field's value on a note. Proxies the Fileclass CLI `get <path> <field> --json`. Under an active " +
        "Governor path allowlist this call is refused outright — the note argument is named `note`, which the host " +
        "does not recognize as a path key, because the engine resolves the value against fileClass definitions the " +
        "session cannot see." +
        COMMON,
      inputSchema: {
        note: z.string().min(1).describe("Vault-relative note path. (Named `note`, not `path`/`note_path`, deliberately.)"),
        field: z.string().min(1).describe("Field name."),
        timeout_ms: timeoutSchema,
      },
      ...RO,
      handler: async (args: Record<string, unknown>) => {
        guard();
        const notePath = requireNotePath(args.note, "note");
        const field = requireText(args.field, "field");
        return run({ command: "get", positionals: [notePath, field] }, optionalTimeout(args.timeout_ms));
      },
    },

    {
      name: "validate",
      description:
        "Report schema violations (missing required fields, wrong types) across the vault or one fileClass. Proxies " +
        "the Fileclass CLI `validate [--fileclass <name>] --json`. The CLI exits 1 when it finds a violation " +
        "(CI-friendly); this tool treats that as a successful run and returns the violations." +
        COMMON,
      inputSchema: {
        fileclass: z.string().optional().describe("Restrict validation to one fileClass, e.g. 'Book'."),
        timeout_ms: timeoutSchema,
      },
      ...RO,
      handler: async (args: Record<string, unknown>) => {
        guard();
        const fileclass = args.fileclass === undefined ? undefined : requireText(args.fileclass, "fileclass");
        // exit 1 = violations found (a successful run, not a tool failure).
        return run({ command: "validate", fileclass }, optionalTimeout(args.timeout_ms), { okExitCodes: [0, 1] });
      },
    },

    {
      name: "set",
      description:
        "Write one validated field value on a note (the fileClass engine validates before writing and refuses an " +
        "invalid value). Proxies the Fileclass CLI `set <path> <field> <value> --json`. Acceptance is human-only: a " +
        "field-write that would introduce acceptance-status: accepted (or accepted-by / accepted-on) is refused " +
        "with Error [accept_forbidden] — agents write only acceptance-status: proposed. An ordinary guarded " +
        "mutating tool: the host's read-only mode, write queue, journal and kernel arguments all apply. The note " +
        "argument is `note_path`, which the host DOES recognize as a path key, so the record-immutability guard, the " +
        "advisory-lock consult and the journal's target all see the note being written, and an active path allowlist " +
        "scopes the call per-path (out_of_allowlist) rather than refusing the tool wholesale." +
        COMMON,
      inputSchema: {
        note_path: z.string().min(1).describe("Vault-relative note path. (A host path key, deliberately — the kernel must see the note this writes.)"),
        field: z.string().min(1).describe("Field name."),
        value: z.union([z.string(), z.number(), z.boolean()]).describe("Value to set (passed to the CLI as a string)."),
        timeout_ms: timeoutSchema,
      },
      ...RW,
      handler: async (args: Record<string, unknown>) => {
        guard();
        const notePath = requireNotePath(args.note_path, "note_path");
        const field = requireText(args.field, "field");
        const value = requireFieldValue(args.value);
        const acceptReason = fileclassSetAcceptRefusal(field, value);
        if (acceptReason) refuse("accept_forbidden", `${acceptReason}${ACCEPT_REFUSAL_TAIL}`);
        return run({ command: "set", positionals: [notePath, field, String(value)] }, optionalTimeout(args.timeout_ms));
      },
    },

    {
      name: "set_where",
      description:
        "Set a validated field on every note of a fileClass matching an optional filter. DRY-RUN BY DEFAULT — " +
        "reports what would change and writes nothing; pass apply: true to commit. Proxies the Fileclass CLI " +
        "`set-where <class> <field> <value> [--where …] [--apply] --json`. Acceptance is human-only: a field-write " +
        "that would introduce acceptance-status: accepted (or accepted-by / accepted-on) is refused with " +
        "Error [accept_forbidden]. An ordinary guarded mutating tool: the host's read-only mode, write queue, " +
        "journal and kernel arguments all apply." +
        COMMON,
      inputSchema: {
        fileclass: z.string().min(1).describe("FileClass name, e.g. 'Book'."),
        field: z.string().min(1).describe("Field name."),
        value: z.union([z.string(), z.number(), z.boolean()]).describe("Value to set (passed to the CLI as a string)."),
        where: z.string().optional().describe("Filter expression, e.g. 'status isEmpty'."),
        apply: z.boolean().optional().describe("Commit the change. Omit/false ⇒ dry-run (report only, write nothing)."),
        timeout_ms: timeoutSchema,
      },
      ...RW,
      handler: async (args: Record<string, unknown>) => {
        guard();
        const fileclass = requireText(args.fileclass, "fileclass");
        const field = requireText(args.field, "field");
        const value = requireFieldValue(args.value);
        const where = args.where === undefined ? undefined : requireText(args.where, "where");
        const acceptReason = fileclassSetAcceptRefusal(field, value);
        if (acceptReason) refuse("accept_forbidden", `${acceptReason}${ACCEPT_REFUSAL_TAIL}`);
        return run(
          {
            command: "set-where",
            positionals: [fileclass, field, String(value)],
            where,
            apply: args.apply === true,
          },
          optionalTimeout(args.timeout_ms),
        );
      },
    },
  ];
}
