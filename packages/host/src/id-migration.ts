// id-migration.ts — the plugin-id migrations, both of them.
//
// The id has moved twice, in opposite directions, and this module is the whole
// mechanism for both:
//
//   0.12.0 (#266): `vault-mcp` → `governor`. One plugin, renamed. It MOVED the
//   old folder's contents into the new folder, because there was exactly one
//   plugin and exactly one owner of every file in it.
//
//   S3c (the suite split): `governor` → `vault-mcp` for the HOST, while the
//   governance PROVIDER takes the id `governor` and KEEPS the folder. That
//   makes the second migration a fundamentally different act from the first,
//   and getting the difference wrong would be the worst bug in this file's
//   history: the source folder is now a LIVE PLUGIN'S OWN DIRECTORY. Moving out
//   of it would delete the provider's state from under it.
//
// So S3c ADOPTS BY COPY, and never writes into the source at all:
//
//   • The host copies three things out of `.obsidian/plugins/governor/` —
//     `journal/`, `install-id.json`, and the host-owned keys of `data.json` —
//     into its own `.obsidian/plugins/vault-mcp/`.
//   • It leaves every byte of the source in place, including the ones it just
//     copied. That is the satellite-adoption precedent (`vault-crosssession`
//     merged the host's read receipts and never touched the host's copy) and it
//     is ALSO what makes the rollback path work: disable both plugins, reinstall
//     the single-plugin `governor` build, and it finds its journal, its install
//     id and its settings exactly where it left them.
//   • `governance/` is NOT copied and NOT moved. The authority state stays with
//     the plugin that keeps the id, which is the whole reason the provider keeps
//     it.
//
// THE ONE-SHOT LATCH is the host's own `data.json`. Once the host has saved
// settings it is provisioned, and adoption never runs again — the same latch
// the 0.12.0 migration used, and the same reason: a second adoption over a
// running host would copy a stale journal month back over a live one.
//
// COPY, NOT MOVE — and the choice is about rollback, not tidiness. A MOVE would
// leave the reverted single-plugin build looking at an EMPTY journal directory,
// which reads as "this vault has no write history" — the silent-zero class, on
// the one file that is append-only evidence. A COPY leaves the pre-split
// history complete and in place, and costs only a documented DIVERGENCE: writes
// after the split land in the host's copy alone, so a rollback resumes from the
// split moment and the post-split months live in the host's folder until a human
// reconciles them. Divergence is reconcilable (records are timestamped and
// `corrects`-chained); an empty journal is not recoverable from inside the
// product at all.
//
// Safety posture, unchanged in shape from the 0.12.0 machinery:
//   - PLAN before touching anything (`planHostAdoption` is pure + fixture-tested).
//   - The source plugin's CODE artifacts never travel.
//   - Never clobber: an existing FILE on the host side is left alone, at both
//     levels — the plan skips a top-level entry the host already holds as a
//     file, and `copyEntry` skips any individual file that already exists.
//   - Never half-adopt: a DIRECTORY the host already has is DESCENDED INTO
//     rather than skipped, so a retry after a mid-copy failure finishes the
//     copy instead of recording a partial one as complete. The adoption record
//     is written only after every entry landed.
//   - A failure must never fail the plugin load. The caller logs, raises a
//     sticky Notice, and continues.

/** Marker the 0.12.0 MOVE left in the folder it emptied. Still recognized:
 * a `governor` folder carrying it is a 0.12.0 destination, not a source that
 * has already been adopted from. */
export const MIGRATION_MARKER = "MIGRATED.md";

/** The note the HOST writes in ITS OWN directory recording what it adopted and
 * from where. Deliberately not written into the source: the host never writes
 * into the provider's folder, which makes "never touches the source" structural
 * rather than merely intended (the `ReceiptStore.loadFrom`-with-no-`saveTo`
 * pattern). */
export const ADOPTION_RECORD = "ADOPTED-FROM-GOVERNOR.md";

/** The host's own id (S3c+). Single source of truth for code that must name
 * itself — the self-preservation refusals (don't disable/reload/uninstall the
 * plugin hosting the connection) and the plugin-dir defaults. Must match
 * manifest.json's `id`. */
export const PLUGIN_ID = "vault-mcp";

/**
 * The id the HOST used between 0.12.0 and S3c, which is ALSO the governance
 * provider's live id. One string, two meanings, and both matter:
 *
 *   • it is the folder the host adopts its journal, install id and settings
 *     FROM, and
 *   • it is a plugin the host must refuse to disable or uninstall through MCP,
 *     which the self-preservation rules already do — so the provider is
 *     protected by name even before it registers on the seam and earns the
 *     `providerIds()` refusal.
 */
export const LEGACY_PLUGIN_ID = "governor";

/** Plugin code artifacts. Never adopted — they would overwrite the host's own
 * build with the provider's. */
export const CODE_ARTIFACTS = new Set(["main.js", "manifest.json", "styles.css"]);

/**
 * What the host adopts, and NOTHING ELSE. Both entries are host machinery that
 * happened to live in the pre-split plugin's directory:
 *
 *   • `journal/` — the kernel's append-only write journal. The host is its only
 *     writer and always was; the provider merely reads it through
 *     `journal-reader.ts` to build the review queue, and reads it from
 *     wherever it is told to look.
 *   • `install-id.json` — the server identity stamped into `actor.server` on
 *     every journal record. Copied rather than re-minted so the audit stream
 *     does not report a new install at the split.
 *
 * `governance/` is absent by design. `crosssession-receipts.json` is absent
 * because the `vault-crosssession` satellite already adopted it at S6 and its
 * copy is authoritative.
 */
export const HOST_ADOPTED_ENTRIES = ["journal", "install-id.json"] as const;

export interface FolderListing {
  /** Basenames of files directly in the folder. */
  files: string[];
  /** Basenames of subfolders directly in the folder. */
  folders: string[];
}

export type AdoptionPlan =
  | {
      action: "skip";
      reason: string;
      /** True when the skip is NOT routine and a human should look. The caller
       * escalates these to console.error + a sticky Notice. */
      warn?: boolean;
    }
  | {
      action: "adopt";
      /**
       * Basenames to copy, in order. Never includes an entry the host already
       * holds as a FILE — but DOES include a directory entry the host already
       * has, so a half-copied tree is resumed rather than declared done. See
       * `planHostAdoption`'s resumability note.
       */
      entries: string[];
      /** Whether the source carries a `data.json` whose host half should be adopted. */
      settings: boolean;
      /** Entries the host already holds as a FILE, skipped rather than overwritten. */
      skipped: string[];
    };

/**
 * Decide what (if anything) the host copies out of the provider's folder.
 * Pure — operates on listings only.
 *
 * `sourceDir === null` means there is no `governor` folder: either a fresh
 * install of the suite, or a vault that never ran the 0.12.0 rename and whose
 * data is therefore ALREADY in `plugins/vault-mcp/`, which is now the host's own
 * folder. Both are "nothing to do", and the second is the happy accident of
 * moving the id back: a pre-0.12.0 vault needs no host adoption at all.
 */
export function planHostAdoption(sourceDir: FolderListing | null, hostDir: FolderListing): AdoptionPlan {
  if (sourceDir === null) {
    return { action: "skip", reason: `no '${LEGACY_PLUGIN_ID}' plugin folder — nothing to adopt from` };
  }
  if (hostDir.files.includes("data.json")) {
    return {
      action: "skip",
      reason: `the ${PLUGIN_ID} plugin dir already has its own data.json — already provisioned; leaving both folders untouched`,
    };
  }
  if (!sourceDir.files.includes("data.json")) {
    // A `governor` folder with code but no data is the 0.12.0 SOURCE folder
    // (emptied, marker left) rather than a live provider. Nothing to adopt, and
    // nothing alarming — say so quietly.
    if (sourceDir.files.includes(MIGRATION_MARKER)) {
      return { action: "skip", reason: `the '${LEGACY_PLUGIN_ID}' folder carries ${MIGRATION_MARKER} and no data.json — an emptied 0.12.0 source, not a provider` };
    }
    return {
      action: "skip",
      warn: true,
      reason:
        `the '${LEGACY_PLUGIN_ID}' folder has no data.json, so there are no host settings to adopt. The host is ` +
        `running at DEFAULTS — socket enabled, read-only OFF, allowlist EMPTY. Check that folder by hand before ` +
        `letting this vault serve agents.`,
    };
  }
  // ── RESUMABILITY: a DIRECTORY entry is descended into, never skipped ───────
  //
  // The first version of this filter skipped any entry already present on the
  // host side, directory or file alike. For `install-id.json` that is right —
  // a file that exists is a file that must not be clobbered. For `journal/` it
  // was wrong, and wrong in the direction that loses evidence: if a first
  // adoption crashed part-way through the copy, the host is left holding a
  // journal directory with SOME of the months in it. On the retry, the
  // plan-level filter saw the directory, classified it `skipped`, and the run
  // then wrote the adoption record saying the copy was complete — while
  // `copyEntry`'s own per-file resume (which already skips only files that
  // exist) never got the chance to run, because the plan never handed it the
  // directory. The missing months were never copied and nothing ever said so.
  //
  // So the plan now descends: a directory present on both sides is ADOPTED, and
  // `copyEntry` skips per-FILE. That is idempotent by construction — a complete
  // directory copies nothing on a re-run — and a half-complete one finishes.
  // `skipped` therefore means "the host already holds this as a file", which is
  // the only case where refusing to descend protects something.
  const hostFiles = new Set(hostDir.files);
  const hostFolders = new Set(hostDir.folders);
  const available = HOST_ADOPTED_ENTRIES.filter(
    (e) => sourceDir.files.includes(e) || sourceDir.folders.includes(e)
  );
  const adoptable = (e: string) => {
    if (hostFiles.has(e)) return false;                 // a real file: never overwrite
    if (hostFolders.has(e)) return sourceDir.folders.includes(e); // descend to resume
    return true;                                        // absent here: copy it
  };
  const entries = available.filter(adoptable);
  const skipped = available.filter((e) => !adoptable(e));
  return { action: "adopt", entries, settings: true, skipped };
}

/** The adapter surface adoption needs. Obsidian's DataAdapter satisfies it
 * structurally; tests inject a fake. All paths vault-relative.
 *
 * There is deliberately NO `rename` and NO `remove`: the whole point of S3c's
 * adoption is that it cannot move or delete anything, and a surface that cannot
 * express those operations is a stronger guarantee than a rule saying not to. */
export interface AdoptionFs {
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export interface AdoptionResult {
  plan: AdoptionPlan;
  /** Entries actually copied (basenames), in order. */
  copied: string[];
  /** The source's raw `data.json` text, when it was read. The caller splits it. */
  settingsJson?: string;
  /** Set when a copy failed mid-sequence: the entry that failed. Everything
   * already copied is named in `copied` so a human can reconcile, and nothing
   * on the source side was touched. */
  failedEntry?: string;
}

function base(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

async function listing(fs: AdoptionFs, dir: string): Promise<FolderListing | null> {
  if (!(await fs.exists(dir))) return null;
  const l = await fs.list(dir);
  return { files: l.files.map(base), folders: l.folders.map(base) };
}

/**
 * Copy one file or one folder tree, source → destination.
 *
 * Read-then-write rather than an adapter `copy`, for two reasons: the
 * `AdoptionFs` surface above is the one this module can promise (no rename, no
 * remove), and a read/write pair is exercisable headlessly against a fake. The
 * journal is JSONL and the install id is JSON, so text is the right shape;
 * nothing binary is adopted.
 *
 * NEVER overwrites: an existing destination FILE is left alone, at every depth.
 * That per-file skip is also the RESUME mechanism — the plan deliberately hands
 * this function a directory the host already has (see `planHostAdoption`), so
 * the files already copied are passed over and the missing ones land. Copying a
 * complete tree twice is therefore a no-op, which is what makes a retry safe.
 */
async function copyEntry(fs: AdoptionFs, from: string, to: string): Promise<void> {
  const l = await fs.list(from).catch(() => null);
  if (l === null) {
    // Not listable ⇒ a file.
    if (await fs.exists(to)) return;
    await fs.write(to, await fs.read(from));
    return;
  }
  await fs.mkdir(to);
  for (const f of l.files) {
    const name = base(f);
    if (await fs.exists(`${to}/${name}`)) continue;
    await fs.write(`${to}/${name}`, await fs.read(`${from}/${name}`));
  }
  for (const d of l.folders) {
    const name = base(d);
    await copyEntry(fs, `${from}/${name}`, `${to}/${name}`);
  }
}

export function adoptionRecordText(now: Date, sourceDir: string, hostDir: string, copied: string[], skipped: string[]): string {
  return [
    `# Adopted from the \`${LEGACY_PLUGIN_ID}\` plugin folder`,
    "",
    `On ${now.toISOString()} the Vault MCP host (the suite split's host/provider separation)`,
    `COPIED these entries out of \`${sourceDir}\` into \`${hostDir}\`:`,
    "",
    ...copied.map((m) => `- \`${m}\``),
    ...(skipped.length ? ["", "Already present here, so left alone:", "", ...skipped.map((m) => `- \`${m}\``)] : []),
    "",
    "It also copied the host-owned keys of that folder's `data.json` into this folder's own",
    "`data.json`. **Nothing was moved and nothing was deleted.** Every byte named above is still",
    `in \`${sourceDir}\`, which the governance provider now owns — including \`governance/\`,`,
    "which the host neither reads nor copies.",
    "",
    "That is deliberate, and it is the rollback path: to go back to the single-plugin build,",
    "disable both plugins, reinstall it under the `governor` id, and it will find its journal,",
    "its install id and its settings exactly where it left them. The only thing it will not have",
    "is whatever was written AFTER this date, which lives in this folder's `journal/`.",
    "",
  ].join("\n");
}

/**
 * Run the host's one-shot adoption from the provider's folder.
 *
 * Throws only on unexpected fs errors during listing; copy failures are
 * captured in the result (loudly logged by the caller) so a partial adoption is
 * always reported, never hidden. The source is never written to on any path.
 */
export async function runHostAdoption(
  fs: AdoptionFs,
  sourceDir: string,
  hostDir: string,
  opts: { now?: () => Date } = {}
): Promise<AdoptionResult> {
  const now = opts.now ?? (() => new Date());
  const sourceListing = await listing(fs, sourceDir);
  const hostListing = (await listing(fs, hostDir)) ?? { files: [], folders: [] };
  const plan = planHostAdoption(sourceListing, hostListing);
  if (plan.action !== "adopt") return { plan, copied: [] };

  const copied: string[] = [];
  for (const entry of plan.entries) {
    try {
      await copyEntry(fs, `${sourceDir}/${entry}`, `${hostDir}/${entry}`);
      copied.push(entry);
    } catch {
      return { plan, copied, failedEntry: entry };
    }
  }
  let settingsJson: string | undefined;
  if (plan.settings) {
    try {
      settingsJson = await fs.read(`${sourceDir}/data.json`);
    } catch {
      return { plan, copied, failedEntry: "data.json" };
    }
  }
  // The record goes in the HOST's own folder, only after every copy landed.
  await fs.mkdir(hostDir).catch(() => undefined);
  await fs.write(`${hostDir}/${ADOPTION_RECORD}`, adoptionRecordText(now(), sourceDir, hostDir, copied, plan.skipped));
  return { plan, copied, settingsJson };
}
