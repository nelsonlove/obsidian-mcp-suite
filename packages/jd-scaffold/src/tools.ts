// tools.ts — the vault-jd-scaffold satellite's tool surface: Johnny Decimal
// scaffolding, ported from obsidian-jd-dashboard and published to the Governor
// host through `vault-mcp-api` (see main.ts). SEVEN tools, every one MUTATING,
// every one a thin PLAN-then-APPLY shell over the pure planners in
// `src/kernel/`:
//
//   standard_zeros          — create the fixed 10-note standard-zeros set in a
//                             category folder
//   ensure_category_indexes — vault-wide: create a minimal XX.00 for any
//                             category folder lacking one
//   promote_to_folder       — turn an id note into a same-named folder with the
//                             note inside as its cover note (link-healing move)
//   reindex_category        — rebuild an XX.00 index file's `## Contents` from
//                             vault truth, at whichever of the three tiers its
//                             own prefix dispatches to
//   new_standard_zero       — one standard-zero note from a classified template
//   new_generic_id          — an `XX.YY Title` note from a classified template
//   new_stem                — an `XX.00+CODE Name` note from a classified
//                             template
//
// ── This is a SATELLITE, not a capability module ────────────────────────────
//
// Until the mutating tier's extraction these seven registered as a
// `mutating: true` capability module through the host's `modules-mount.ts`,
// took their Obsidian binding from a `MountDeps.jdScaffoldSource`, and inherited
// the module host's settings-tab enable/disable toggle. NONE of that is true any
// more: this package is its own Obsidian plugin, `main.ts` builds the specs and
// hands them to `publishTools`, the host registers them through
// `external-tools.ts` like any third-party publisher's, and "enabled" now means
// exactly "this plugin is installed and enabled in Obsidian". The plan-then-apply
// SHAPE is unchanged, and so is every planner behind it.
//
// ── The published names ALL changed, and this one was FORCED ────────────────
//
// The host publishes an external tool as `<sanitized publisher id>_<bare name>`,
// and this plugin's id `vault-jd-scaffold` sanitizes to `vault_jd_scaffold`. On
// top of that the bare names below shed the `obsidian_jd_` prefix the module
// shipped, so `obsidian_jd_standard_zeros` is on the wire as
// `vault_jd_scaffold_standard_zeros`. Unlike the bases satellite's `base_` strip
// — a readability choice — HALF of this rename had no alternative: the host's
// registry REFUSES a published name beginning `obsidian_` outright
// (`external-tools.ts`, F1: `if (toolName.startsWith("obsidian_")) throw new
// TypeError(...)`), so no plugin id whatsoever could have carried the shipped
// spellings through. The full table and the honest cost are in CLAUDE.md.
//
// ── Allowlist posture: FAIL-CLOSED, and deliberately so ─────────────────────
//
// The ENFORCED boundary is now the HOST's. An external tool's arguments are
// scoped only when they carry a name the host recognizes as a path key
// (`path`, `from`, `to`, `target_path`, `template_path`, `subdir`, `file_path`,
// `output_folder`, `paths`, `refs`), and a MUTATING external tool whose call
// carries none is blocked outright while a path allowlist is active. NOT ONE
// argument below is a host path key — `note_path`, `folder_path` and
// `templates_folder` are all deliberately outside that list — so under an
// active allowlist this whole surface is refused wholesale.
//
// `promote_to_folder`'s and `reindex_category`'s note argument was RENAMED
// `path` → `note_path` to make that so, and that is the decision to understand
// before touching anything here:
//
//   * Keeping `path` on `promote_to_folder` would have scoped the SOURCE note
//     and nothing else, while the write goes to a FOLDER and a NEW FILE the plan
//     computes and no argument ever names. The module checked those computed
//     destinations itself (`isVisible(plan.folderPath)` / `isVisible(plan.
//     newFilePath)`); a satellite cannot. Handing the guard the source path
//     while the real write targets stay unscoped is the illusion of a check —
//     the same reasoning the cross-session satellite used to refuse
//     path-keying `channel`.
//   * Keeping `path` on `reindex_category` would have scoped the note WRITTEN,
//     while the area-management and system tiers READ every sibling `XX.00`
//     index file vault-wide and fold their names and descriptions into the new
//     content. The module bounded that iteration with the allowlist; a satellite
//     cannot. A scoped session could pull hidden siblings' names into a visible
//     note — a read-boundary bypass, not a rounding error.
//
// The cost is real and is stated rather than rounded off: under an ACTIVE
// allowlist, JD scaffolding is now UNAVAILABLE rather than partially available.
// With no allowlist configured — the ordinary case — nothing changes at all.
// The reversal, if it is ever wanted, is one word per tool: rename the argument
// back to `path`.
//
// ── The in-handler allowlist checks are DORMANT SEAMS, kept on purpose ──────
//
// `ctx.getSettings` is declared and NOT supplied in the shipped configuration:
// a satellite cannot reach the host's guard settings. So every `isVisible`
// call below — including `applyCreates`' per-item check and `discoverTemplates`'
// hidden-template filter — is inert in production today. They are kept, not
// deleted (the skills/triage/crosssession/bases posture): the tests supply
// `getSettings` so the behaviour cannot rot, and a `vault-mcp-api` that can
// carry the caller's scope to a publisher (apiVersion 2) makes them live again
// with no change to this file.
//
// ── Envelope convention (the satellite contract) ────────────────────────────
//
// A handler returns PLAIN DATA and THROWS on refusal. The host wraps a return
// value in `ok()` and a thrown error in `fail()`; `fail()` reads a lowercase
// snake `code` off the thrown error and renders `Error [code]: message` — the
// same shape the module's `codedError` produced, so every typed refusal an agent
// sees is byte-compatible with the folded era. `ok` / `fail` / `codedError`
// themselves are host-internal and are NOT imported here.
//
// ── Schema fidelity across the boundary ─────────────────────────────────────
//
// The SDK converts a zod shape to JSON Schema and the host converts it back
// through a deliberately small subset (`json-schema-to-zod.ts`): `type`,
// `description` and STRING `enum` survive; `default`, `min`, `max` and `pattern`
// DO NOT. Every bound below is therefore re-applied in the handler
// (`requireText` / `requireBool` / `requirePath` / `requirePrefix`) — the
// `vault_skills_release` semver lesson: a constraint that lives only in the
// declared schema never runs for an MCP caller.
//
// Obsidian-free by construction: the vault arrives through the injected
// JdScaffoldSource and the YAML parser through `ctx.parseYaml`. The live adapter
// is obsidian-source.ts.

import { z } from "zod";
import type { SdkToolSpec } from "vault-mcp-api";
import { isVisible, scanForAcceptFence, type GuardSettings } from "@vault-mcp/core";
import {
  planStandardZeros,
  planEnsureCategoryIndexes,
  standardZeros,
  suffixFor,
} from "./kernel/standard-zeros.js";
import { planPromoteToFolder } from "./kernel/promote-to-folder.js";
import type { CategoryFolderInput, PlannedCreate } from "./kernel/types.js";
import { planReindexCategory, reindexTier, isIndexFilePath } from "./kernel/category-index.js";
import {
  extractJdId,
  classifyTemplates,
  findZeroTemplate,
  findGenericTemplate,
  findStemTemplate,
  buildContext,
  substitute,
  sanitizeTitle,
  destPathForZero,
  destPathForGenericId,
  destPathForStem,
  type TemplateMatch,
} from "./kernel/templates.js";

/** Every tool here is MUTATING — no `readOnly: true` claim to be distrusted. */
const RW = { readOnly: false, destructive: false, idempotent: false } as const;

/**
 * A TYPED refusal, thrown. The host's `fail()` reads a lowercase-snake `code`
 * off the error and renders `Error [code]: message` — the identical envelope
 * the module's `codedError` produced.
 */
export class JdScaffoldRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "JdScaffoldRefusal";
    this.code = code;
  }
}

/** Declared as a FUNCTION, not a const arrow: TypeScript only narrows control
 *  flow through a `never`-returning call when the callee is a function
 *  declaration (or an explicitly annotated const). */
function refuse(code: string, message: string): never {
  throw new JdScaffoldRefusal(code, message);
}

/** Re-apply a non-empty-string bound the publishing boundary drops, and the
 *  string type with it (the SDK also accepts a hand-written JSON Schema, whose
 *  bare `{}` property degrades to `z.unknown()`). */
function requireText(value: unknown, argument: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    refuse("invalid_argument", `'${argument}' must be a non-empty string`);
  }
  return value;
}

/** `dry_run` is mandatory and has no default — deliberately, since the default
 *  a caller would assume is the dangerous one. A non-boolean refuses rather
 *  than being read as falsey: "not the string 'true'" must never silently
 *  become "write for real". */
function requireBool(value: unknown, argument: string): boolean {
  if (typeof value !== "boolean") refuse("invalid_argument", `'${argument}' must be a boolean`);
  return value;
}

/**
 * A path-shaped argument: non-empty, and free of BACKSLASHES.
 *
 * The backslash refusal comes before every other check, the triage/bases rule.
 * Everything downstream of here splits on `/` alone — this file's own parent
 * derivation, the kernel's `basenameOf`/`folderOf`, and `isVisible`'s
 * normalization — so a backslash reads as ONE opaque segment here and as a
 * traversal to whatever normalizes it later. Obsidian paths never legitimately
 * contain one. It matters more here than in a read tool: `destPathForStem` and
 * `destPathForGenericId` build destinations by plain string concatenation.
 */
function requirePath(value: unknown, argument: string): string {
  const path = requireText(value, argument);
  if (path.includes("\\")) {
    refuse("invalid_path", `'${argument}' must not contain a backslash (Obsidian paths use '/' only): ${JSON.stringify(path)}`);
  }
  return path;
}

/**
 * The category prefix — exactly two digits.
 *
 * The module did NOT validate this, which was a real gap of the same class the
 * stem-code check closes: `prefix` reaches `destPathForZero` /
 * `destPathForGenericId` / `destPathForStem`, all of which build a destination
 * by string concatenation, so a prefix carrying `/` or `..` introduced extra
 * path segments into the computed write target. Every consumer already assumes
 * two digits (`suffixFor`'s `=== "00"`, `isAreaManagement`'s length check), so
 * this refuses rather than narrowing anything real.
 */
function requirePrefix(value: unknown): string {
  const prefix = requireText(value, "prefix");
  if (!/^\d{2}$/.test(prefix)) {
    refuse("invalid_prefix", `"${prefix}" must be exactly two digits (e.g. "06").`);
  }
  return prefix;
}

/** `visiblePaths` for this package — the host's helper is host-only and trivial,
 *  so it is DEFINED OVER core's published `isVisible` rather than being a second
 *  copy of the predicate (the drift this repo has paid for twice). Dormant with
 *  the rest of the allowlist seam: no settings ⇒ the caller's own array back. */
function visiblePathsOf(paths: string[], settings?: GuardSettings): string[] {
  if (!settings?.allowlist?.length) return paths;
  return paths.filter((path) => isVisible(path, settings));
}

/** The Obsidian-facing seam this plugin needs — nothing more. The live
 *  implementation is `obsidianJdScaffoldSource` in obsidian-source.ts; tests
 *  supply a fake directly. */
export interface JdScaffoldSource {
  /** True iff a vault path already exists (any type — note or folder). */
  exists(path: string): boolean;
  /** Every depth-2 `XX <name>` category folder, vault-wide. */
  categoryFolders(): CategoryFolderInput[];
  create(path: string, content: string): Promise<void>;
  createFolder(path: string): Promise<void>;
  /** Link-healing rename — must go through app.fileManager.renameFile in the
   *  live adapter, never vault.rename. The host's own link-healing source scan
   *  globs `packages/plugin/src/**` and can no longer see this code, so this
   *  package carries its own pin (tests/link-healing.test.mjs). */
  renameFile(fromPath: string, toPath: string): Promise<void>;
  /** Today's date, `YYYY-MM-DD`. Injected (not `new Date()` inline) so tests
   *  can pin it without a fake clock plumbed through every call. */
  today(): string;
  /** Every markdown note's vault path — feeds planReindexCategory's allPaths. */
  allNotePaths(): string[];
  /** A note's current content, or null if it doesn't exist. */
  read(path: string): Promise<string | null>;
  /** Overwrite a note's content in place — the file already exists (unlike
   *  `create`, which is for NEW notes). */
  modify(path: string, content: string): Promise<void>;
  /** Vault paths of a folder's own direct `.md` children (not recursive) —
   *  for discovering a templates folder's own template files. Empty array
   *  for a non-existent or non-folder path, never throws. */
  listFolderChildren(folderPath: string): string[];
  /** Pre-formatted date/time for template placeholder substitution — the
   *  same fixed-format precedent as `today()`, just all three fields the
   *  templates module's `buildContext` wants at once. */
  clock(): { date: string; time: string; now: string };
}

export interface JdScaffoldToolsCtx {
  /** Guard settings accessor — a DORMANT seam, unsupplied in the shipped
   *  configuration (a satellite cannot reach the host's guard settings). Kept
   *  for the day `vault-mcp-api` can carry the caller's scope to a publisher;
   *  the tests supply it so the checks it feeds cannot rot. */
  getSettings?: () => GuardSettings;
  /** Feeds the accept-forbidden content scan on template-created notes
   *  (`applyTemplate`). Without it, `scanForAcceptFence` fails CLOSED on any
   *  frontmatter-carrying content at all ("carries a frontmatter fence that
   *  cannot be verified without a YAML parser") — so this is not a
   *  nice-to-have: every real template-creation call needs it wired to do
   *  anything useful. main.ts supplies Obsidian's own `parseYaml`, which is why
   *  this file needs no `obsidian` import to get one. */
  parseYaml?: (yaml: string) => unknown;
}

/** An inert source — a stand-in for tests and for a plugin instance with no
 *  vault injected: reads answer empty rather than throwing (so a dry run always
 *  works), writes throw a clear error that `applyCreates`' per-item catch (or
 *  the promote path's own catch) turns into a refusal rather than a silent
 *  no-op. */
export function emptyJdScaffoldSource(): JdScaffoldSource {
  const unwired = () => { throw new Error("jd-scaffold source not wired (no live Obsidian adapter)."); };
  return {
    exists: () => false,
    categoryFolders: () => [],
    create: async () => unwired(),
    createFolder: async () => unwired(),
    renameFile: async () => unwired(),
    today: () => new Date().toISOString().slice(0, 10),
    allNotePaths: () => [],
    read: async () => null,
    modify: async () => unwired(),
    listFolderChildren: () => [],
    clock: () => ({ date: "", time: "", now: "" }),
  };
}

/** Applies a list of planned creates via source.create, one at a time. One
 *  failure is reported per-item and does not abort the rest — matches
 *  jd-dashboard's own original CreateZerosResult/EnsureCategoryIndexesResult
 *  shape. Every path is allowlist-checked immediately before its own write
 *  (DORMANT — see the header: nothing supplies `getSettings` today), not just
 *  once up front, so a long-running batch cannot outlive a mid-batch settings
 *  change once the seam is live again. `paths` (the successfully created ones,
 *  in write order) feeds `filesChanged`/`files` in the caller's result — the
 *  host's `reportedEffects` convention — so the journal's `effects` field names
 *  every note actually written, not just the argument-derived target (which,
 *  for ensure_category_indexes, isn't even an argument at all). */
async function applyCreates(
  source: JdScaffoldSource,
  settings: GuardSettings | undefined,
  creates: PlannedCreate[]
): Promise<{ created: number; paths: string[]; failures: { path: string; error: string }[] }> {
  let created = 0;
  const paths: string[] = [];
  const failures: { path: string; error: string }[] = [];
  for (const c of creates) {
    if (!isVisible(c.path, settings)) {
      failures.push({ path: c.path, error: "out_of_allowlist" });
      continue;
    }
    try {
      await source.create(c.path, c.content);
      created++;
      paths.push(c.path);
    } catch (e) {
      failures.push({ path: c.path, error: (e as Error).message });
    }
  }
  return { created, paths, failures };
}

export function buildJdScaffoldTools(source: JdScaffoldSource, ctx: JdScaffoldToolsCtx): SdkToolSpec[] {
  /** Read PER CALL, never captured: the host holds a spec snapshot per
   *  connection, so a captured settings object would freeze at publish time.
   *  Undefined in the shipped configuration — the dormant seam. */
  const settingsNow = (): GuardSettings | undefined => ctx.getSettings?.();

  const folderNameOf = (folderPath: string): string =>
    folderPath.includes("/") ? folderPath.slice(folderPath.lastIndexOf("/") + 1) : folderPath;

  return [
    {
      name: "standard_zeros",
      description:
        "Creates the fixed 10-note standard-zeros set (JDex, Inbox, Task & project management, Templates, Links, " +
        "Conventions & policies, Knowledge base, Dashboard, Someday, Archive) inside a category folder. An " +
        "already-existing target is SKIPPED, never overwritten. `dry_run: true` reports the plan without writing. " +
        "Mutating: the Governor host's read-only mode, write queue, journal and kernel arguments all apply, and an " +
        "active path allowlist blocks it outright (no argument here is a path key the host can scope by).",
      inputSchema: {
        folder_path: z.string().min(1).describe('Vault path of the category folder (e.g. "10-19 Personal/06 Digital tools").'),
        prefix: z.string().min(1).describe('The category\'s two-digit prefix (e.g. "06").'),
        dry_run: z.boolean().describe("If true, report the plan without writing anything."),
      },
      ...RW,
      handler: async (args: Record<string, unknown>) => {
        const settings = settingsNow();
        const folderPath = requirePath(args.folder_path, "folder_path");
        const prefix = requirePrefix(args.prefix);
        const dryRun = requireBool(args.dry_run, "dry_run");
        if (!isVisible(folderPath, settings)) {
          refuse("out_of_allowlist", `"${folderPath}" is outside the active path allowlist.`);
        }

        const plan = planStandardZeros({
          folderPath,
          folderName: folderNameOf(folderPath),
          prefix,
          now: source.today(),
          exists: (p) => source.exists(p),
        });

        // Computed paths are re-checked unconditionally, even under dry_run.
        // Every candidate is a child of the already-checked folder_path, so
        // prefix-matching means nothing is ever actually dropped here today;
        // the check exists so a preview can never diverge from what
        // applyCreates would really do on the same plan.
        if (dryRun) {
          return { dry_run: true, creates: plan.creates.filter((c) => isVisible(c.path, settings)), skipped: plan.skipped };
        }

        const applied = await applyCreates(source, settings, plan.creates);
        return {
          dry_run: false,
          created: applied.created,
          skipped: plan.skipped,
          failures: applied.failures,
          // filesChanged / files ARE the host's reportedEffects convention.
          // They survive the publishing boundary only because the host wraps a
          // returned object as `ok(data)`, making this the `structuredContent`
          // the kernel's journal reads. Dropping the two keys silently empties
          // the journal record's `effects` field.
          filesChanged: applied.created,
          files: applied.paths,
        };
      },
    },

    {
      name: "ensure_category_indexes",
      description:
        "Walks every depth-2 `XX <name>` category folder and creates a minimal `XX.00` JDex index for any that " +
        "lack one (in any of `XX.00 Title.md`, `XX.00.md`, `XX.00+SUF Title.md` form). Vault-wide, no target " +
        "argument. `dry_run: true` reports the plan without writing. Mutating, and blocked outright while a " +
        "Governor path allowlist is active (it carries no path argument to scope by).",
      inputSchema: {
        dry_run: z.boolean().describe("If true, report the plan without writing anything."),
      },
      ...RW,
      handler: async (args: Record<string, unknown>) => {
        const settings = settingsNow();
        const dryRun = requireBool(args.dry_run, "dry_run");
        // No path argument (vault-wide by design), so this tool bounds its OWN
        // iteration: filter BEFORE the listing ever reaches the planner, not
        // just before a write. DORMANT as a satellite — the host refuses the
        // whole call under an allowlist instead, which is strictly stricter
        // than this filter ever was.
        const visibleFolders = source.categoryFolders().filter((f) => isVisible(f.path, settings));
        const plan = planEnsureCategoryIndexes(visibleFolders, source.today());

        if (dryRun) return { dry_run: true, creates: plan.creates };

        const applied = await applyCreates(source, settings, plan.creates);
        return {
          dry_run: false,
          created: applied.created,
          failures: applied.failures,
          filesChanged: applied.created,
          files: applied.paths,
        };
      },
    },

    {
      name: "promote_to_folder",
      description:
        "Converts an XX.YY (or 5-digit expanded-area id) note into a same-named folder with the note moved inside " +
        "as the folder's cover note, via app.fileManager.renameFile (link-healing). Refuses (not_id_note / " +
        "already_cover_note / folder_exists) rather than guessing. `dry_run: true` reports the plan without " +
        "writing. The note is named by `note_path`, which is deliberately NOT one of the host's recognized path " +
        "keys: the folder and the new file this tool writes are COMPUTED and named by no argument, so scoping the " +
        "source alone would be the illusion of a check. Under an active Governor path allowlist the call is " +
        "refused outright.",
      inputSchema: {
        note_path: z.string().min(1).describe("Vault path of the note to promote."),
        dry_run: z.boolean().describe("If true, report the plan without writing anything."),
      },
      ...RW,
      handler: async (args: Record<string, unknown>) => {
        const settings = settingsNow();
        const notePath = requirePath(args.note_path, "note_path");
        const dryRun = requireBool(args.dry_run, "dry_run");
        if (!isVisible(notePath, settings)) {
          refuse("out_of_allowlist", `"${notePath}" is outside the active path allowlist.`);
        }

        const plan = planPromoteToFolder({ path: notePath, exists: (p) => source.exists(p) });

        if (!plan.ok) refuse(plan.reason, promoteRefusalMessage(plan.reason, notePath));
        if (!isVisible(plan.folderPath, settings) || !isVisible(plan.newFilePath, settings)) {
          refuse("out_of_allowlist", `the computed destination for "${notePath}" is outside the active path allowlist.`);
        }

        if (dryRun) return { dry_run: true, folder_path: plan.folderPath, new_file_path: plan.newFilePath };

        await source.createFolder(plan.folderPath);
        try {
          await source.renameFile(notePath, plan.newFilePath);
        } catch (e) {
          // createFolder already succeeded, so a retry's OWN planPromoteToFolder
          // call will now see plan.folderPath as existing and refuse
          // folder_exists — a confusing dead end with no indication why. Not a
          // rollback (this layer has no delete primitive, and inventing one
          // just for this narrow failure isn't worth the added surface for how
          // rarely renameFile fails after a successful createFolder) — just an
          // honest, actionable error instead of a silent, permanently-stuck retry.
          refuse(
            "promote_partial",
            `"${plan.folderPath}" was created but "${notePath}" could not be moved into it (${(e as Error).message}). ` +
              `Remove the empty folder before retrying.`
          );
        }
        return {
          dry_run: false,
          folder_path: plan.folderPath,
          new_file_path: plan.newFilePath,
          // reportedEffects, as above: the folder and the moved note are both
          // computed, so without these two keys the journal record's `effects`
          // would be empty for a call that changed two things.
          filesChanged: 2,
          files: [plan.folderPath, plan.newFilePath],
        };
      },
    },

    {
      name: "reindex_category",
      description:
        "Rebuilds the `## Contents` section of an `XX.00` index file from the vault's own structure — NOT a " +
        "jd-index.yaml registry. Three tiers, dispatched by the target's own prefix: ordinary per-category " +
        "(`XX.00`, XX not a multiple of 10) lists the category's own folder members; area-management (`X0.00`) " +
        "consolidates every category `## Contents` within the same area; system (`00.00`) consolidates every " +
        "category across every area. Descriptions written as `[[link]] *(note)*` are preserved across every " +
        "regen, at every tier — the target file's own local description always wins over an inherited one. " +
        "The area-management and system tiers READ every sibling `XX.00` file in the vault, which is why this " +
        "tool's note argument (`note_path`) is deliberately not a host path key: scoping the note written would " +
        "leave that vault-wide read unscoped. Under an active Governor path allowlist the call is refused " +
        "outright instead. `dry_run: true` reports the planned new content without writing.",
      inputSchema: {
        note_path: z.string().min(1).describe('Vault path of the XX.00 index file to reindex (e.g. "10-19 Personal/06 Digital tools/06.00 JDex.md").'),
        dry_run: z.boolean().describe("If true, report the plan without writing anything."),
      },
      ...RW,
      handler: async (args: Record<string, unknown>) => {
        const settings = settingsNow();
        const notePath = requirePath(args.note_path, "note_path");
        const dryRun = requireBool(args.dry_run, "dry_run");
        if (!isVisible(notePath, settings)) {
          refuse("out_of_allowlist", `"${notePath}" is outside the active path allowlist.`);
        }

        // Strict XX.00 shape, not just reindexTier's loose two-digit-prefix
        // check — reindexTier is right for the PURE planner's own dispatch
        // (matching the original's real behavior, see category-index.ts's own
        // comment), but wrong as this tool's gate: an ordinary note like
        // "10.13 Something.md" has a leading "10" prefix and would dispatch to
        // "area-management" too, and — since it was never fetched into
        // siblingContent (only strictly XX.00-shaped paths are) — would go on
        // to overwrite that unrelated note with an area consolidation view
        // that has nothing to do with it. isIndexFilePath is the same strict
        // check the planner's own sibling-discovery already uses.
        if (!isIndexFilePath(notePath)) {
          refuse("not_index_file", `"${notePath}" doesn't look like an XX.00 index file (expected "XX.00 Title.md", "XX.00.md", or "XX.00+SUF Title.md").`);
        }
        const tier = reindexTier(notePath)!; // isIndexFilePath true ⇒ reindexTier can't be null

        // This tool enumerates and reads vault content beyond its own note
        // argument — every sibling XX.00 file at the area-management/system
        // tiers — so that listing bounds its OWN iteration through the
        // allowlist, filtered BEFORE any read: a hidden sibling's
        // name/description must never reach `new_content`, not even under
        // dry_run. DORMANT as a satellite (nothing supplies getSettings), and
        // the reason `note_path` is not a path key: the host cannot scope this
        // read from an argument, so it refuses the call outright instead.
        const scoped = Boolean(settings?.allowlist?.length);
        const allPaths = scoped ? visiblePathsOf(source.allNotePaths(), settings) : source.allNotePaths();
        // Only area-management/system tiers cross-read sibling XX.00 files
        // (bulletsForCategory in kernel/category-index.ts) — the ordinary tier
        // needs only its own current content. Checking the tier first (no I/O
        // — reindexTier is a pure regex check) avoids reading every category
        // index file vault-wide for the common, single-category case.
        const toFetch = tier === "ordinary" ? [notePath] : allPaths.filter(isIndexFilePath);
        const siblingContent = new Map<string, string>();
        for (const p of toFetch) {
          const content = await source.read(p);
          if (content !== null) siblingContent.set(p, content);
        }

        const plan = planReindexCategory({ targetIndexPath: notePath, allPaths, siblingContent });
        if (!plan) {
          // isIndexFilePath already confirmed above, so this would mean it and
          // planReindexCategory's own dispatch disagree — defensive, not
          // expected to fire.
          refuse("not_index_file", `"${notePath}" doesn't look like an XX.00 index file.`);
        }

        // `scoped_to_allowlist` reports whether a scope was supplied to THIS
        // PLUGIN, which in the shipped configuration is always false — the
        // dormant seam again. It is kept rather than dropped because the field
        // is part of the result shape agents already read, and it re-lights
        // with the seam.
        if (dryRun) return { dry_run: true, new_content: plan.newContent, preserved: plan.preserved, scoped_to_allowlist: scoped };

        await source.modify(notePath, plan.newContent);
        return { dry_run: false, preserved: plan.preserved, filesChanged: 1, files: [notePath], scoped_to_allowlist: scoped };
      },
    },

    {
      name: "new_standard_zero",
      description:
        "Creates a single standard-zero note (e.g. the `06.01 Inbox` slot) from a template classified " +
        '`jd-id: "{{category}}.NN"` in `templates_folder`. Refuses if the slot already exists or no matching ' +
        "template is found. `dry_run: true` reports the plan without writing. Mutating, and blocked outright " +
        "while a Governor path allowlist is active (neither `folder_path` nor `templates_folder` is a path key " +
        "the host can scope by).",
      inputSchema: {
        folder_path: z.string().min(1).describe('Vault path of the category folder (e.g. "10-19 Personal/06 Digital tools").'),
        prefix: z.string().min(1).describe('The category\'s two-digit prefix (e.g. "06").'),
        zero_id: z.string().min(1).describe('Which standard-zero slot to create (e.g. "01" for Inbox).'),
        templates_folder: z.string().min(1).describe("Vault path of the folder containing template notes."),
        dry_run: z.boolean().describe("If true, report the plan without writing anything."),
      },
      ...RW,
      handler: async (args: Record<string, unknown>) => {
        const settings = settingsNow();
        const folderPath = requirePath(args.folder_path, "folder_path");
        const templatesFolder = requirePath(args.templates_folder, "templates_folder");
        const prefix = requirePrefix(args.prefix);
        const zeroId = requireText(args.zero_id, "zero_id");
        const dryRun = requireBool(args.dry_run, "dry_run");
        if (!isVisible(folderPath, settings)) refuse("out_of_allowlist", `"${folderPath}" is outside the active path allowlist.`);
        if (!isVisible(templatesFolder, settings)) refuse("out_of_allowlist", `"${templatesFolder}" is outside the active path allowlist.`);

        const zero = standardZeros(prefix, suffixFor(prefix)).find((z) => z.id === zeroId);
        if (!zero) refuse("invalid_zero_id", `"${zeroId}" is not one of the 10 standard-zero slots (00-09).`);

        const destPath = destPathForZero(folderPath, prefix, zero);
        if (!isVisible(destPath, settings)) refuse("out_of_allowlist", `the computed destination for "${zeroId}" is outside the active path allowlist.`);
        if (source.exists(destPath)) refuse("already_exists", `"${destPath}" already exists.`);

        const discovery = await discoverTemplates(source, settings, templatesFolder);
        const template = findZeroTemplate(discovery.matches, zero.id);
        if (!template) refuse("template_not_found", `No template classified for zero slot "${zero.id}" in "${templatesFolder}".`);

        const clock = source.clock();
        const context = buildContext({ prefix, id: zero.id, folder: { path: folderPath, name: folderNameOf(folderPath) }, zero, ...clock });
        return applyTemplate(source, template, context, destPath, dryRun, discovery.skipped, ctx.parseYaml);
      },
    },

    {
      name: "new_generic_id",
      description:
        'Creates an `XX.YY Title` note from a template classified `jd-id: "{{category}}.{{id}}"` in ' +
        "`templates_folder`. `dry_run: true` reports the plan without writing. Mutating, and blocked outright " +
        "while a Governor path allowlist is active.",
      inputSchema: {
        folder_path: z.string().min(1).describe("Vault path of the category folder."),
        prefix: z.string().min(1).describe('The category\'s two-digit prefix (e.g. "06").'),
        id: z.string().min(1).describe('Two-digit id for the new note (e.g. "13").'),
        title: z.string().min(1).describe("Title for the new note — sanitized before use (no path separators, leading dot, or Windows-forbidden characters)."),
        templates_folder: z.string().min(1).describe("Vault path of the folder containing template notes."),
        dry_run: z.boolean().describe("If true, report the plan without writing anything."),
      },
      ...RW,
      handler: async (args: Record<string, unknown>) => {
        const settings = settingsNow();
        const folderPath = requirePath(args.folder_path, "folder_path");
        const templatesFolder = requirePath(args.templates_folder, "templates_folder");
        const prefix = requirePrefix(args.prefix);
        const rawTitle = requireText(args.title, "title");
        const id = requireText(args.id, "id");
        const dryRun = requireBool(args.dry_run, "dry_run");
        if (!isVisible(folderPath, settings)) refuse("out_of_allowlist", `"${folderPath}" is outside the active path allowlist.`);
        if (!isVisible(templatesFolder, settings)) refuse("out_of_allowlist", `"${templatesFolder}" is outside the active path allowlist.`);

        if (!/^\d{2}$/.test(id)) refuse("invalid_id", `"${id}" must be exactly two digits.`);
        const sanitized = sanitizeTitle(rawTitle);
        if (!sanitized) refuse("invalid_title", `"${rawTitle}" is empty, leading-dot, or contains invalid characters (/, \\, .., :, etc.).`);

        const destPath = destPathForGenericId(folderPath, prefix, id, sanitized);
        if (!isVisible(destPath, settings)) refuse("out_of_allowlist", `the computed destination is outside the active path allowlist.`);
        if (source.exists(destPath)) refuse("already_exists", `"${destPath}" already exists.`);

        const discovery = await discoverTemplates(source, settings, templatesFolder);
        const template = findGenericTemplate(discovery.matches);
        if (!template) refuse("template_not_found", `No generic-id template found in "${templatesFolder}".`);

        const clock = source.clock();
        const context = buildContext({ prefix, id, folder: { path: folderPath, name: folderNameOf(folderPath) }, customTitle: sanitized, ...clock });
        return applyTemplate(source, template, context, destPath, dryRun, discovery.skipped, ctx.parseYaml);
      },
    },

    {
      name: "new_stem",
      description:
        'Creates an `XX.00+CODE Name` note from a template classified `jd-id: "XX.00+CODE"` in `templates_folder`. ' +
        "`dry_run: true` reports the plan without writing. Mutating, and blocked outright while a Governor path " +
        "allowlist is active.",
      inputSchema: {
        folder_path: z.string().min(1).describe("Vault path of the category folder."),
        prefix: z.string().min(1).describe('The category\'s two-digit prefix (e.g. "06").'),
        stem_code: z.string().min(1).describe('The stem code (e.g. "DRAFT" for a template whose jd-id is "XX.00+DRAFT").'),
        name: z.string().min(1).describe("Name for the new note — sanitized before use, same rules as a generic-id title."),
        templates_folder: z.string().min(1).describe("Vault path of the folder containing template notes."),
        dry_run: z.boolean().describe("If true, report the plan without writing anything."),
      },
      ...RW,
      handler: async (args: Record<string, unknown>) => {
        const settings = settingsNow();
        const folderPath = requirePath(args.folder_path, "folder_path");
        const templatesFolder = requirePath(args.templates_folder, "templates_folder");
        const prefix = requirePrefix(args.prefix);
        const stemCode = requireText(args.stem_code, "stem_code");
        const rawName = requireText(args.name, "name");
        const dryRun = requireBool(args.dry_run, "dry_run");
        if (!isVisible(folderPath, settings)) refuse("out_of_allowlist", `"${folderPath}" is outside the active path allowlist.`);
        if (!isVisible(templatesFolder, settings)) refuse("out_of_allowlist", `"${templatesFolder}" is outside the active path allowlist.`);

        // Unlike title/name (sanitizeTitle), stem_code isn't free text — every
        // REAL stem code was already regex-validated at classification time
        // (STEM_ID_RE: leading letter, then word chars/hyphens only, no path
        // separators or dots). Validating it here too, before it ever reaches
        // destPathForStem's string concatenation, closes a narrow but real gap:
        // an unvalidated stem_code containing "/" would introduce EXTRA path
        // segments into the computed destination (destPathForStem doesn't
        // itself sanitize its `code` parameter) before findStemTemplate's own
        // "no such template" refusal ever gets a chance to run.
        if (!/^[A-Za-z][\w-]*$/.test(stemCode)) refuse("invalid_stem_code", `"${stemCode}" isn't a valid stem code (expected a leading letter, then word characters/hyphens only).`);

        const sanitized = sanitizeTitle(rawName);
        if (!sanitized) refuse("invalid_title", `"${rawName}" is empty, leading-dot, or contains invalid characters (/, \\, .., :, etc.).`);

        const destPath = destPathForStem(folderPath, prefix, stemCode, sanitized);
        if (!isVisible(destPath, settings)) refuse("out_of_allowlist", `the computed destination is outside the active path allowlist.`);
        if (source.exists(destPath)) refuse("already_exists", `"${destPath}" already exists.`);

        const discovery = await discoverTemplates(source, settings, templatesFolder);
        const template = findStemTemplate(discovery.matches, stemCode);
        if (!template) refuse("template_not_found", `No template classified for stem code "${stemCode}" in "${templatesFolder}".`);

        const clock = source.clock();
        const context = buildContext({ prefix, id: `+${stemCode}`, folder: { path: folderPath, name: folderNameOf(folderPath) }, customTitle: sanitized, ...clock });
        return applyTemplate(source, template, context, destPath, dryRun, discovery.skipped, ctx.parseYaml);
      },
    },
  ];
}

/** Reads `templates_folder`'s own direct .md children, classifies each by
 *  its jd-id frontmatter (extractJdId + classifyTemplates, both pure).
 *  A discovered template's OWN path is checked against the allowlist too, not
 *  just the input folder — a hidden template file's content must never reach a
 *  visible note via substitution. DORMANT as a satellite, like every other
 *  allowlist check here. Hidden templates are silently excluded from
 *  discovery, not reported — absence, never an error naming what's hidden. */
async function discoverTemplates(
  source: JdScaffoldSource,
  settings: GuardSettings | undefined,
  templatesFolder: string
): Promise<{ matches: TemplateMatch[]; skipped: string[] }> {
  const childPaths = visiblePathsOf(source.listFolderChildren(templatesFolder), settings);
  if (childPaths.length === 0 && !source.exists(templatesFolder)) {
    refuse("templates_folder_not_found", `Templates folder not found: "${templatesFolder}".`);
  }
  const candidates = [];
  for (const path of childPaths) {
    const content = await source.read(path);
    if (content === null) continue;
    candidates.push({ path, jdId: extractJdId(content) });
  }
  return classifyTemplates(candidates);
}

/** Shared apply: read the template, substitute, and either report the
 *  preview (dry_run) or write it (auto-creating the parent folder first,
 *  matching the original's createFromTemplate — source.createFolder is a
 *  no-op-safe call here since destPath's own parent was already implied
 *  visible/checked by the caller). Any unresolved placeholders are surfaced
 *  in the result rather than only console.warn'd. */
async function applyTemplate(
  source: JdScaffoldSource,
  template: TemplateMatch,
  context: ReturnType<typeof buildContext>,
  destPath: string,
  dryRun: boolean,
  skippedTemplates: string[],
  parseYaml: ((yaml: string) => unknown) | undefined
) {
  const raw = await source.read(template.path);
  if (raw === null) refuse("template_unreadable", `"${template.path}" could not be read.`);
  const { text, warnings } = substitute(raw, context);

  // accept-forbidden guard, PRE-WRITE (the same class closed on the other two
  // "create from template" surfaces in this codebase — the host's `obsidian_cli`
  // `create template=` and `obsidian_create_note_from_template` — for the
  // identical reason: a template file's frontmatter would otherwise be copied
  // into a brand-new note with no content scan ever seeing it, a two-step
  // laundering path for an accepted fence). Scanned over `text` — the
  // SUBSTITUTED result, the actual bytes about to be written — not the raw
  // template: this engine's placeholder values (title/tag) are caller-controlled
  // tool arguments, so the fence could in principle appear only after
  // substitution. Checked even under dry_run — a preview must never claim a plan
  // this call would actually refuse to apply.
  //
  // `scanForAcceptFence` comes from @vault-mcp/core, where it was PUBLISHED at
  // this extraction (packages/core/src/accept-scan.ts) rather than copied: its
  // two callers — the host's CLI proxy and this satellite — now live in
  // different plugins, and two copies of an accept predicate is how one vault
  // gets two definitions of "accepted".
  //
  // Deliberately `scanForAcceptFence` alone, NOT the host's fuller
  // `templateContentAcceptRefusal` (which also refuses any leftover `{{`/`<%`
  // token unconditionally): that half exists because Templater/core-Templates
  // RE-PROCESS `{{ }}`/`<% %>` AFTER the guard's scan, so an unexpanded token is
  // genuinely uninspectable. jd-scaffold's own substitution has ALREADY fully
  // run by this point — `text` IS the final, verbatim bytes about to be written,
  // nothing downstream re-interprets it — so a harmless unresolved `{{typo}}`
  // (this engine's documented behavior: an unknown key is left as literal text,
  // reported in `warnings`) must not trip a check meant for a DIFFERENT,
  // still-to-be-rendered template engine.
  const acceptRefusal = scanForAcceptFence(text, parseYaml);
  if (acceptRefusal) {
    refuse(
      "accept_forbidden",
      `refusing to create "${destPath}" from "${template.path}": it ${acceptRefusal}. Acceptance is a human gesture only.`
    );
  }

  if (dryRun) {
    return { dry_run: true, dest_path: destPath, content: text, placeholder_warnings: warnings, skipped_templates: skippedTemplates };
  }

  const parentPath = destPath.slice(0, destPath.lastIndexOf("/"));
  if (parentPath && !source.exists(parentPath)) await source.createFolder(parentPath);
  await source.create(destPath, text);
  return {
    dry_run: false,
    dest_path: destPath,
    placeholder_warnings: warnings,
    skipped_templates: skippedTemplates,
    // reportedEffects again — see standard_zeros.
    filesChanged: 1,
    files: [destPath],
  };
}

function promoteRefusalMessage(reason: "not_id_note" | "already_cover_note" | "folder_exists", path: string): string {
  switch (reason) {
    case "not_id_note":
      return `"${path}" doesn't look like a JD id note (expected "XX.YY Title" or a 5-digit id).`;
    case "already_cover_note":
      return `"${path}" is already its folder's cover note.`;
    case "folder_exists":
      return `the destination folder for "${path}" already exists.`;
  }
}
