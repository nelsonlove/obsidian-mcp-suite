/**
 * jd-scaffold-tools.test.mjs — the seven tool handlers, exercised through the
 * HOST SHIM so every assertion reads the envelope an agent actually sees
 * (`ok()` / `fail()`'s `Error [code]: message`) rather than a raw return value.
 *
 * Ported from the host's `tests/jd-scaffold-tools.test.mjs`, which drove the
 * module through a `fakeServer` + `registerJdScaffoldTools`. Three things
 * changed with the extraction and nothing else did:
 *
 *   • the tools are BUILT as SDK specs and published, so the shim's
 *     `<sanitized id>_<bare name>` naming is what the tests call through;
 *   • `path` is `note_path` on promote/reindex — see the `publication` block;
 *   • the allowlist checks are a DORMANT SEAM in the shipped plugin, so these
 *     tests SUPPLY `getSettings` (which nothing does in production) precisely
 *     so the checks cannot rot.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isVisible } from "@vault-mcp/core";
import { buildJdScaffoldTools, emptyJdScaffoldSource } from "../src/tools.ts";
import { DEFAULT_PLUGIN_SETTINGS, settingsOf } from "../src/settings.ts";
import { CONTENTS_CALLOUT } from "../src/kernel/category-index.ts";
import { publishInto, OWNER, HOST_PATH_KEYS } from "./host-shim.mjs";
import { parseYaml } from "./obsidian-stub.mjs";

/** The host's `visiblePaths`, reproduced over core's published `isVisible` —
 *  used only to prove the local helper in tools.ts agrees with the one-path
 *  predicate both sides share. */
const visiblePaths = (paths, settings) =>
  !settings?.allowlist?.length ? paths : paths.filter((p) => isVisible(p, settings));

function fakeSource({
  allPaths = [],
  folders = [],
  now = "2026-08-19",
  noteContent = {},
  folderChildren = {},
  clockValue = { date: "2026-08-19", time: "10:30", now: "2026-08-19T10:30" },
} = {}) {
  const paths = new Set(allPaths);
  const created = [];
  const renamed = [];
  const foldersCreated = [];
  const modified = [];
  const notes = new Map(Object.entries(noteContent));
  const source = {
    exists: (p) => paths.has(p),
    categoryFolders: () => folders,
    create: async (path, content) => {
      created.push({ path, content });
      paths.add(path);
    },
    createFolder: async (path) => {
      foldersCreated.push(path);
      paths.add(path);
    },
    renameFile: async (fromPath, toPath) => {
      renamed.push({ from: fromPath, to: toPath });
      paths.delete(fromPath);
      paths.add(toPath);
    },
    today: () => now,
    allNotePaths: () => allPaths,
    read: async (p) => (notes.has(p) ? notes.get(p) : null),
    modify: async (p, content) => {
      modified.push({ path: p, content });
      notes.set(p, content);
    },
    listFolderChildren: (folderPath) => folderChildren[folderPath] ?? [],
    clock: () => clockValue,
  };
  return { source, created, renamed, foldersCreated, modified, notes };
}

/** Build the seven specs over a fake source and publish them through the shim.
 *  `call` takes the BARE name and prefixes it, so the test bodies stay readable
 *  while the wire name is what is actually exercised. */
function build({ allowlist = [], ...sourceOpts } = {}) {
  const parts = fakeSource(sourceOpts);
  const settings = { readOnly: false, allowlist };
  const { tools } = publishInto(
    buildJdScaffoldTools(parts.source, { getSettings: () => settings, parseYaml }),
  );
  const call = (bare, args = {}) => tools.get(`${OWNER}_${bare}`).handler(args);
  return { ...parts, tools, call };
}

/** Publish a hand-built partial source (the tests that need a throwing or
 *  counting primitive), with no allowlist. */
function buildOver(source, { allowlist = [] } = {}) {
  const settings = { readOnly: false, allowlist };
  const { tools } = publishInto(buildJdScaffoldTools(source, { getSettings: () => settings, parseYaml }));
  return (bare, args = {}) => tools.get(`${OWNER}_${bare}`).handler(args);
}

const errText = (res) => res.content[0].text;

describe("standard_zeros", () => {
  test("dry_run: true reports the plan and writes nothing", async () => {
    const { call, created } = build();
    const res = await call("standard_zeros", {
      folder_path: "10-19 Personal/06 Digital tools",
      prefix: "06",
      dry_run: true,
    });
    assert.notEqual(res.isError, true);
    assert.equal(res.structuredContent.creates.length, 10);
    assert.deepEqual(created, []);
  });

  test("dry_run: false creates every planned zero via source.create", async () => {
    const { call, created } = build();
    const res = await call("standard_zeros", {
      folder_path: "10-19 Personal/06 Digital tools",
      prefix: "06",
      dry_run: false,
    });
    assert.notEqual(res.isError, true);
    assert.equal(created.length, 10);
    assert.equal(res.structuredContent.created, 10);
  });

  test("a real existing target (via source.exists) is skipped, not recreated", async () => {
    const existing = "10-19 Personal/06 Digital tools/06.00 JDex for category 06.md";
    const { call, created } = build({ allPaths: [existing] });
    const res = await call("standard_zeros", {
      folder_path: "10-19 Personal/06 Digital tools",
      prefix: "06",
      dry_run: false,
    });
    assert.notEqual(res.isError, true);
    assert.equal(created.length, 9);
    assert.deepEqual(res.structuredContent.skipped, [existing]);
  });

  test("calling twice in a row: the second call skips every note the first one created", async () => {
    const { call, created } = build();
    await call("standard_zeros", { folder_path: "10-19 Personal/06 Digital tools", prefix: "06", dry_run: false });
    assert.equal(created.length, 10);
    const res2 = await call("standard_zeros", { folder_path: "10-19 Personal/06 Digital tools", prefix: "06", dry_run: false });
    assert.equal(res2.structuredContent.created, 0);
    assert.equal(res2.structuredContent.skipped.length, 10);
    assert.equal(created.length, 10); // unchanged — nothing new written
  });

  test("out_of_allowlist refusal when folder_path is outside an active allowlist (the DORMANT seam, supplied here)", async () => {
    const { call, created } = build({ allowlist: ["Somewhere Else"] });
    const res = await call("standard_zeros", {
      folder_path: "10-19 Personal/06 Digital tools",
      prefix: "06",
      dry_run: true,
    });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[out_of_allowlist\]/);
    assert.deepEqual(created, []);
  });

  test("dry_run: false reports filesChanged/files for the journal's effects field", async () => {
    const { call } = build();
    const res = await call("standard_zeros", { folder_path: "10-19 Personal/06 Digital tools", prefix: "06", dry_run: false });
    assert.equal(res.structuredContent.filesChanged, 10);
    assert.equal(res.structuredContent.files.length, 10);
    assert.ok(res.structuredContent.files.every((p) => p.startsWith("10-19 Personal/06 Digital tools/")));
  });

  test("dry_run: true reports no filesChanged/files — a preview asserts nothing was written", async () => {
    const { call } = build();
    const res = await call("standard_zeros", { folder_path: "10-19 Personal/06 Digital tools", prefix: "06", dry_run: true });
    assert.equal(res.structuredContent.filesChanged, undefined);
    assert.equal(res.structuredContent.files, undefined);
  });

  test("dry_run: true's computed creates are allowlist-filtered too, matching what a real write would do", async () => {
    // Every computed path is a child of the already-checked folder_path, so
    // under normal prefix-matching nothing is ever actually dropped — this
    // just proves the preview can never diverge from applyCreates' own check.
    const { call } = build({ allowlist: ["10-19 Personal/06 Digital tools"] });
    const res = await call("standard_zeros", { folder_path: "10-19 Personal/06 Digital tools", prefix: "06", dry_run: true });
    assert.notEqual(res.isError, true);
    assert.equal(res.structuredContent.creates.length, 10);
  });

  test("one failing create doesn't block the rest — per-item isolation", async () => {
    const created = [];
    const call = buildOver({
      exists: () => false,
      categoryFolders: () => [],
      create: async (path, content) => {
        if (path.includes("06.03")) throw new Error("disk full");
        created.push({ path, content });
      },
      createFolder: async () => {},
      renameFile: async () => {},
      today: () => "2026-08-19",
    });
    const res = await call("standard_zeros", { folder_path: "10-19 Personal/06 Digital tools", prefix: "06", dry_run: false });
    assert.notEqual(res.isError, true);
    assert.equal(res.structuredContent.created, 9);
    assert.equal(res.structuredContent.failures.length, 1);
    assert.match(res.structuredContent.failures[0].error, /disk full/);
  });
});

describe("ensure_category_indexes", () => {
  test("vault-wide: finds depth-2 XX-named folders missing their XX.00 and plans one each", async () => {
    const { call, created } = build({
      folders: [
        { path: "10-19 Personal/06 Digital tools", name: "06 Digital tools", prefix: "06", childBasenames: [] },
        { path: "10-19 Personal/07 Health", name: "07 Health", prefix: "07", childBasenames: ["07.00 Existing.md"] },
      ],
    });
    const res = await call("ensure_category_indexes", { dry_run: false });
    assert.notEqual(res.isError, true);
    assert.equal(created.length, 1);
    assert.match(created[0].path, /^10-19 Personal\/06 Digital tools\/06\.00/);
  });

  test("dry_run: true reports the plan and writes nothing", async () => {
    const { call, created } = build({
      folders: [{ path: "10-19 Personal/06 Digital tools", name: "06 Digital tools", prefix: "06", childBasenames: [] }],
    });
    const res = await call("ensure_category_indexes", { dry_run: true });
    assert.notEqual(res.isError, true);
    assert.equal(res.structuredContent.creates.length, 1);
    assert.deepEqual(created, []);
  });

  test("a folder outside an active allowlist never reaches the planner — not even under dry_run", async () => {
    // The in-tool containment this preserves: the tool takes NO path argument
    // (vault-wide by design), so a scoped session could otherwise see
    // category-folder paths from anywhere in the vault, in both the preview and
    // the real write's per-item failures. As a SATELLITE the host refuses the
    // whole call under an allowlist instead — strictly stricter — and this
    // check is the dormant seam behind that.
    const { call, created } = build({
      folders: [
        { path: "10-19 Personal/06 Digital tools", name: "06 Digital tools", prefix: "06", childBasenames: [] },
        { path: "Archive/09 Hidden", name: "09 Hidden", prefix: "09", childBasenames: [] },
      ],
      allowlist: ["10-19 Personal"],
    });
    const dryRes = await call("ensure_category_indexes", { dry_run: true });
    assert.equal(dryRes.structuredContent.creates.length, 1);
    assert.ok(!dryRes.structuredContent.creates.some((c) => c.path.startsWith("Archive/")));

    const writeRes = await call("ensure_category_indexes", { dry_run: false });
    assert.equal(writeRes.structuredContent.created, 1);
    assert.deepEqual(writeRes.structuredContent.failures, []); // the hidden folder never became a failure entry either
    assert.ok(!created.some((c) => c.path.startsWith("Archive/")));
  });

  test("dry_run: false reports filesChanged/files for the journal's effects field", async () => {
    const { call } = build({
      folders: [{ path: "10-19 Personal/06 Digital tools", name: "06 Digital tools", prefix: "06", childBasenames: [] }],
    });
    const res = await call("ensure_category_indexes", { dry_run: false });
    assert.equal(res.structuredContent.filesChanged, 1);
    assert.equal(res.structuredContent.files.length, 1);
  });
});

describe("promote_to_folder", () => {
  test("dry_run: false creates the folder and renames the file via source.renameFile", async () => {
    const { call, renamed, foldersCreated } = build({ allPaths: ["06 Digital tools/06.13 Bar.md"] });
    const res = await call("promote_to_folder", { note_path: "06 Digital tools/06.13 Bar.md", dry_run: false });
    assert.notEqual(res.isError, true);
    assert.deepEqual(foldersCreated, ["06 Digital tools/06.13 Bar"]);
    assert.deepEqual(renamed, [{ from: "06 Digital tools/06.13 Bar.md", to: "06 Digital tools/06.13 Bar/06.13 Bar.md" }]);
    assert.equal(res.structuredContent.filesChanged, 2);
    assert.deepEqual(res.structuredContent.files, ["06 Digital tools/06.13 Bar", "06 Digital tools/06.13 Bar/06.13 Bar.md"]);
  });

  test("a renameFile failure after createFolder succeeds reports a clear promote_partial error, not a silent orphan", async () => {
    const foldersCreated = [];
    const call = buildOver({
      exists: (p) => p === "06 Digital tools/06.13 Bar.md",
      categoryFolders: () => [],
      create: async () => {},
      createFolder: async (path) => { foldersCreated.push(path); },
      renameFile: async () => { throw new Error("note vanished mid-operation"); },
      today: () => "2026-08-19",
    });
    const res = await call("promote_to_folder", { note_path: "06 Digital tools/06.13 Bar.md", dry_run: false });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[promote_partial\]/);
    assert.match(errText(res), /note vanished mid-operation/);
    assert.match(errText(res), /Remove the empty folder before retrying/);
    assert.deepEqual(foldersCreated, ["06 Digital tools/06.13 Bar"]); // confirms the scenario: folder WAS created
  });

  test("dry_run: true reports the plan and creates/renames nothing", async () => {
    const { call, renamed, foldersCreated } = build({ allPaths: ["06 Digital tools/06.13 Bar.md"] });
    const res = await call("promote_to_folder", { note_path: "06 Digital tools/06.13 Bar.md", dry_run: true });
    assert.notEqual(res.isError, true);
    assert.equal(res.structuredContent.folder_path, "06 Digital tools/06.13 Bar");
    assert.deepEqual(foldersCreated, []);
    assert.deepEqual(renamed, []);
  });

  test("a coded refusal when the note isn't a JD id note", async () => {
    const { call } = build({ allPaths: ["06 Digital tools/Not an id.md"] });
    const res = await call("promote_to_folder", { note_path: "06 Digital tools/Not an id.md", dry_run: true });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[not_id_note\]/);
  });

  test("a coded refusal when the note is already its folder's cover note", async () => {
    const { call } = build({ allPaths: ["06 Digital tools/06.13 Bar/06.13 Bar.md"] });
    const res = await call("promote_to_folder", { note_path: "06 Digital tools/06.13 Bar/06.13 Bar.md", dry_run: true });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[already_cover_note\]/);
  });

  test("a coded refusal when the destination folder already exists", async () => {
    const { call } = build({ allPaths: ["06 Digital tools/06.13 Bar.md", "06 Digital tools/06.13 Bar"] });
    const res = await call("promote_to_folder", { note_path: "06 Digital tools/06.13 Bar.md", dry_run: true });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[folder_exists\]/);
  });

  test("out_of_allowlist refusal when note_path is outside an active allowlist", async () => {
    const { call } = build({ allPaths: ["06 Digital tools/06.13 Bar.md"], allowlist: ["Somewhere Else"] });
    const res = await call("promote_to_folder", { note_path: "06 Digital tools/06.13 Bar.md", dry_run: true });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[out_of_allowlist\]/);
  });
});

describe("reindex_category", () => {
  test("dry_run: false rewrites the target's Contents section via source.modify", async () => {
    const allPaths = [
      "10-19 Personal/06 Digital tools/06.00 JDex.md",
      "10-19 Personal/06 Digital tools/06.13 Bar.md",
    ];
    const { call, modified } = build({
      allPaths,
      noteContent: { "10-19 Personal/06 Digital tools/06.00 JDex.md": "# JDex\n" },
    });
    const res = await call("reindex_category", { note_path: "10-19 Personal/06 Digital tools/06.00 JDex.md", dry_run: false });
    assert.notEqual(res.isError, true);
    assert.equal(modified.length, 1);
    assert.match(modified[0].content, /\[\[06\.13 Bar\]\]/);
    assert.equal(res.structuredContent.filesChanged, 1);
    assert.deepEqual(res.structuredContent.files, ["10-19 Personal/06 Digital tools/06.00 JDex.md"]);
  });

  test("dry_run: true reports the new content without writing", async () => {
    const allPaths = ["10-19 Personal/06 Digital tools/06.00 JDex.md", "10-19 Personal/06 Digital tools/06.13 Bar.md"];
    const { call, modified } = build({
      allPaths,
      noteContent: { "10-19 Personal/06 Digital tools/06.00 JDex.md": "# JDex\n" },
    });
    const res = await call("reindex_category", { note_path: "10-19 Personal/06 Digital tools/06.00 JDex.md", dry_run: true });
    assert.notEqual(res.isError, true);
    assert.match(res.structuredContent.new_content, /\[\[06\.13 Bar\]\]/);
    assert.deepEqual(modified, []);
  });

  test("the regenerated callout names the tool that regenerates it — the PUBLISHED name, not the module's", async () => {
    // The callout is written INTO the note, so a stale `obsidian_jd_*` spelling
    // would tell every reader to call a tool that no longer exists.
    const allPaths = ["10-19 Personal/06 Digital tools/06.00 JDex.md", "10-19 Personal/06 Digital tools/06.13 Bar.md"];
    const { call } = build({ allPaths, noteContent: { "10-19 Personal/06 Digital tools/06.00 JDex.md": "# JDex\n" } });
    const res = await call("reindex_category", { note_path: "10-19 Personal/06 Digital tools/06.00 JDex.md", dry_run: true });
    assert.match(res.structuredContent.new_content, /vaultmcp_jd_scaffold_reindex_category/);
    assert.doesNotMatch(res.structuredContent.new_content, /obsidian_jd_/);
    assert.match(CONTENTS_CALLOUT, /vaultmcp_jd_scaffold_reindex_category/);
  });

  test("a preserved description round-trips through the tool", async () => {
    const allPaths = ["10-19 Personal/06 Digital tools/06.00 JDex.md", "10-19 Personal/06 Digital tools/06.13 Bar.md"];
    const { call } = build({
      allPaths,
      noteContent: { "10-19 Personal/06 Digital tools/06.00 JDex.md": "## Contents\n\n- [[06.13 Bar]] *(the real one)*\n" },
    });
    const res = await call("reindex_category", { note_path: "10-19 Personal/06 Digital tools/06.00 JDex.md", dry_run: false });
    assert.match(res.structuredContent.preserved[0].description, /the real one/);
  });

  test("a coded refusal when the path isn't XX.00-shaped", async () => {
    const { call } = build({ allPaths: ["06 Digital tools/Not an id note.md"] });
    const res = await call("reindex_category", { note_path: "06 Digital tools/Not an id note.md", dry_run: true });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[not_index_file\]/);
  });

  test("out_of_allowlist refusal when note_path is outside an active allowlist", async () => {
    const { call } = build({ allPaths: ["10-19 Personal/06 Digital tools/06.00 JDex.md"], allowlist: ["Somewhere Else"] });
    const res = await call("reindex_category", { note_path: "10-19 Personal/06 Digital tools/06.00 JDex.md", dry_run: true });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[out_of_allowlist\]/);
  });

  test("the ordinary tier does NOT fetch every sibling index file — only its own content", async () => {
    const readCalls = [];
    const call = buildOver({
      exists: () => false,
      categoryFolders: () => [],
      create: async () => {},
      createFolder: async () => {},
      renameFile: async () => {},
      today: () => "2026-08-19",
      allNotePaths: () => [
        "10-19 Personal/06 Digital tools/06.00 JDex.md",
        "10-19 Personal/06 Digital tools/06.13 Bar.md",
        "20-29 Work/20 Work management/20.00 Other index.md", // a SEPARATE category's XX.00 — must not be read
      ],
      read: async (p) => {
        readCalls.push(p);
        return p === "10-19 Personal/06 Digital tools/06.00 JDex.md" ? "# JDex\n" : null;
      },
      modify: async () => {},
    });
    await call("reindex_category", { note_path: "10-19 Personal/06 Digital tools/06.00 JDex.md", dry_run: true });
    assert.deepEqual(readCalls, ["10-19 Personal/06 Digital tools/06.00 JDex.md"]);
  });

  test("the area-management tier DOES fetch sibling index files, to consolidate their Contents", async () => {
    const readCalls = [];
    const allPaths = [
      "10-19 Personal/10 Foo/10.00 Area index.md",
      "10-19 Personal/06 Digital tools/06.00 JDex.md",
      "10-19 Personal/06 Digital tools/06.13 Bar.md",
    ];
    const notes = {
      "10-19 Personal/10 Foo/10.00 Area index.md": "## Contents\n\n",
      "10-19 Personal/06 Digital tools/06.00 JDex.md": "## Contents\n\n- [[06.13 Bar]]\n",
    };
    const call = buildOver({
      exists: () => false,
      categoryFolders: () => [],
      create: async () => {},
      createFolder: async () => {},
      renameFile: async () => {},
      today: () => "2026-08-19",
      allNotePaths: () => allPaths,
      read: async (p) => {
        readCalls.push(p);
        return notes[p] ?? null;
      },
      modify: async () => {},
    });
    const res = await call("reindex_category", { note_path: "10-19 Personal/10 Foo/10.00 Area index.md", dry_run: true });
    assert.ok(readCalls.includes("10-19 Personal/06 Digital tools/06.00 JDex.md"));
    assert.match(res.structuredContent.new_content, /\[\[06\.13 Bar\]\]/);
  });

  test("refuses an ordinary note whose prefix merely LOOKS area-management-shaped (e.g. '10.13'), rather than overwriting it", async () => {
    // reindexTier("10.13 Something.md") returns "area-management" (loose
    // two-digit-prefix check); the path is never fetched into siblingContent
    // (only strictly XX.00-shaped paths are); planReindexCategory would then
    // build a full area consolidation UNRELATED to the note — which a
    // non-dry-run call would write straight over its real content. The gate is
    // isIndexFilePath (strict), not reindexTier (loose).
    const modifyCalls = [];
    const call = buildOver({
      exists: () => false,
      categoryFolders: () => [],
      create: async () => {},
      createFolder: async () => {},
      renameFile: async () => {},
      today: () => "2026-08-19",
      allNotePaths: () => ["10-19 Personal/10 Foo/10.00 Area index.md", "10-19 Personal/10 Foo/10.13 Something.md"],
      read: async () => "## Contents\n\n- [[10.13 Something]]\n",
      modify: async (p, content) => { modifyCalls.push({ path: p, content }); },
    });
    const res = await call("reindex_category", { note_path: "10-19 Personal/10 Foo/10.13 Something.md", dry_run: false });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[not_index_file\]/);
    assert.deepEqual(modifyCalls, []); // the note was NEVER touched
  });

  test("a sibling XX.00 file outside the allowlist is excluded from consolidation, and scoped_to_allowlist reports true", async () => {
    // The read-boundary containment this tool used to enforce for itself. It is
    // also THE RATIFIED RESIDUAL of the round-2 posture (2026-09-07): the host
    // scopes the note WRITTEN — `note_path` is a path key — but never this
    // vault-wide sibling READ, and as a satellite the filter exercised here is
    // dormant because nothing supplies getSettings. So under a live allowlist
    // the area/system tiers really can fold hidden siblings' names into a
    // visible note. Accepted deliberately (README §2) rather than closed, and
    // this test is what keeps the machinery from rotting before an
    // apiVersion-2 SDK can supply the scope and make it live.
    const allPaths = [
      "10-19 Personal/10 Foo/10.00 Area index.md",
      "10-19 Personal/06 Digital tools/06.00 JDex.md",
      "10-19 Personal/06 Digital tools/06.13 Bar.md",
      "Archive/09 Hidden/09.00 Hidden index.md", // outside the allowlist below
      "Archive/09 Hidden/09.05 Secret.md",
    ];
    const { call } = build({
      allPaths,
      allowlist: ["10-19 Personal"],
      noteContent: {
        "10-19 Personal/10 Foo/10.00 Area index.md": "## Contents\n\n",
        "10-19 Personal/06 Digital tools/06.00 JDex.md": "## Contents\n\n- [[06.13 Bar]]\n",
        "Archive/09 Hidden/09.00 Hidden index.md": "## Contents\n\n- [[09.05 Secret]] *(sensitive)*\n",
      },
    });
    const res = await call("reindex_category", { note_path: "10-19 Personal/10 Foo/10.00 Area index.md", dry_run: true });
    assert.notEqual(res.isError, true);
    assert.equal(res.structuredContent.scoped_to_allowlist, true);
    assert.match(res.structuredContent.new_content, /\[\[06\.13 Bar\]\]/);
    assert.doesNotMatch(res.structuredContent.new_content, /09\.05 Secret/);
    assert.doesNotMatch(res.structuredContent.new_content, /09 Hidden/);
    assert.doesNotMatch(res.structuredContent.new_content, /sensitive/);
  });

  test("scoped_to_allowlist is false with no active allowlist — which is the shipped configuration's ONLY answer", async () => {
    const { call } = build({
      allPaths: ["10-19 Personal/06 Digital tools/06.00 JDex.md"],
      noteContent: { "10-19 Personal/06 Digital tools/06.00 JDex.md": "# JDex\n" },
    });
    const res = await call("reindex_category", { note_path: "10-19 Personal/06 Digital tools/06.00 JDex.md", dry_run: true });
    assert.equal(res.structuredContent.scoped_to_allowlist, false);
  });

  test("with NO getSettings supplied — the shipped configuration — the tool still works and reports scoped_to_allowlist: false", async () => {
    const { source } = fakeSource({
      allPaths: ["10-19 Personal/06 Digital tools/06.00 JDex.md", "10-19 Personal/06 Digital tools/06.13 Bar.md"],
      noteContent: { "10-19 Personal/06 Digital tools/06.00 JDex.md": "# JDex\n" },
    });
    const { tools } = publishInto(buildJdScaffoldTools(source, { parseYaml }));
    const res = await tools
      .get(`${OWNER}_reindex_category`)
      .handler({ note_path: "10-19 Personal/06 Digital tools/06.00 JDex.md", dry_run: true });
    assert.notEqual(res.isError, true);
    assert.equal(res.structuredContent.scoped_to_allowlist, false);
    assert.match(res.structuredContent.new_content, /\[\[06\.13 Bar\]\]/);
  });
});

describe("new_standard_zero", () => {
  function zeroFixture(overrides = {}) {
    return build({
      folderChildren: { Templates: ["Templates/inbox-template.md"] },
      noteContent: { "Templates/inbox-template.md": '---\njd-id: "{{category}}.01"\n---\n\n# {{title}} ({{fullId}})\n' },
      ...overrides,
    });
  }

  test("dry_run: true reports the substituted content without writing", async () => {
    const { call, created } = zeroFixture();
    const res = await call("new_standard_zero", {
      folder_path: "10-19 Personal/06 Digital tools", prefix: "06", zero_id: "01", templates_folder: "Templates", dry_run: true,
    });
    assert.notEqual(res.isError, true);
    assert.equal(res.structuredContent.dest_path, "10-19 Personal/06 Digital tools/06.01 Inbox for category 06/06.01 Inbox for category 06.md");
    assert.match(res.structuredContent.content, /# Inbox for category 06 \(06\.01\)/);
    assert.deepEqual(created, []);
  });

  test("dry_run: false creates the note via source.create and reports filesChanged/files", async () => {
    const { call, created } = zeroFixture();
    const res = await call("new_standard_zero", {
      folder_path: "10-19 Personal/06 Digital tools", prefix: "06", zero_id: "01", templates_folder: "Templates", dry_run: false,
    });
    assert.notEqual(res.isError, true);
    assert.equal(created.length, 1);
    assert.equal(res.structuredContent.filesChanged, 1);
    assert.deepEqual(res.structuredContent.files, [created[0].path]);
  });

  test("refuses when the slot already exists", async () => {
    const dest = "10-19 Personal/06 Digital tools/06.01 Inbox for category 06/06.01 Inbox for category 06.md";
    const { call } = zeroFixture({ allPaths: [dest] });
    const res = await call("new_standard_zero", {
      folder_path: "10-19 Personal/06 Digital tools", prefix: "06", zero_id: "01", templates_folder: "Templates", dry_run: true,
    });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[already_exists\]/);
  });

  test("refuses when no template is classified for that zero slot", async () => {
    const { call } = build({ allPaths: ["Templates"], folderChildren: { Templates: [] } });
    const res = await call("new_standard_zero", {
      folder_path: "10-19 Personal/06 Digital tools", prefix: "06", zero_id: "01", templates_folder: "Templates", dry_run: true,
    });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[template_not_found\]/);
  });

  test("refuses when the templates folder does not exist at all", async () => {
    const { call } = build({ folderChildren: {} });
    const res = await call("new_standard_zero", {
      folder_path: "10-19 Personal/06 Digital tools", prefix: "06", zero_id: "01", templates_folder: "Nowhere", dry_run: true,
    });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[templates_folder_not_found\]/);
  });

  test("refuses an invalid zero_id", async () => {
    const { call } = zeroFixture();
    const res = await call("new_standard_zero", {
      folder_path: "10-19 Personal/06 Digital tools", prefix: "06", zero_id: "99", templates_folder: "Templates", dry_run: true,
    });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[invalid_zero_id\]/);
  });

  test("refuses an unreadable template file", async () => {
    // The folder lists a child the source cannot read back at apply time —
    // discovery classified it from content, then the read returns null.
    let reads = 0;
    const call = buildOver({
      exists: (p) => p === "Templates",
      categoryFolders: () => [],
      create: async () => {},
      createFolder: async () => {},
      renameFile: async () => {},
      today: () => "2026-08-19",
      allNotePaths: () => [],
      read: async () => (reads++ === 0 ? '---\njd-id: "{{category}}.01"\n---\n\nBody\n' : null),
      modify: async () => {},
      listFolderChildren: () => ["Templates/inbox-template.md"],
      clock: () => ({ date: "", time: "", now: "" }),
    });
    const res = await call("new_standard_zero", {
      folder_path: "10-19 Personal/06 Digital tools", prefix: "06", zero_id: "01", templates_folder: "Templates", dry_run: true,
    });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[template_unreadable\]/);
  });

  test("out_of_allowlist when templates_folder is hidden, even though folder_path is visible", async () => {
    const { call } = zeroFixture({ allowlist: ["10-19 Personal"] });
    const res = await call("new_standard_zero", {
      folder_path: "10-19 Personal/06 Digital tools", prefix: "06", zero_id: "01", templates_folder: "Templates", dry_run: true,
    });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[out_of_allowlist\]/);
  });

  test("a hidden templates folder is never READ — the refusal lands before discovery opens anything", async () => {
    // Be precise about what the template filter buys. `isVisible` prefix-matches
    // at a segment boundary, so a VISIBLE templates folder always implies
    // visible children — `discoverTemplates`' own `visiblePathsOf` is a belt
    // that cannot fire through a folder check that already passed (and is
    // dormant besides). What IS load-bearing is that a hidden templates folder
    // refuses before a single `source.read`, so no hidden template's content
    // can reach a new note through substitution.
    const reads = [];
    const call = buildOver(
      {
        exists: (p) => p === "Templates",
        categoryFolders: () => [],
        create: async () => {},
        createFolder: async () => {},
        renameFile: async () => {},
        today: () => "2026-08-19",
        allNotePaths: () => [],
        read: async (p) => {
          reads.push(p);
          return '---\njd-id: "{{category}}.01"\n---\n\nSECRET BODY\n';
        },
        modify: async () => {},
        listFolderChildren: () => ["Templates/inbox-template.md"],
        clock: () => ({ date: "", time: "", now: "" }),
      },
      { allowlist: ["06 Digital tools"] },
    );
    const res = await call("new_standard_zero", {
      folder_path: "06 Digital tools", prefix: "06", zero_id: "01", templates_folder: "Templates", dry_run: true,
    });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[out_of_allowlist\]/);
    assert.deepEqual(reads, [], "a hidden templates folder must never be opened");
    assert.doesNotMatch(errText(res), /SECRET BODY/);
  });
});

describe("new_generic_id", () => {
  function genericFixture(overrides = {}) {
    return build({
      folderChildren: { Templates: ["Templates/generic-template.md"] },
      noteContent: { "Templates/generic-template.md": '---\njd-id: "{{category}}.{{id}}"\n---\n\n# {{title}}\n' },
      ...overrides,
    });
  }

  test("dry_run: false creates 'XX.YY Title.md' with the sanitized title substituted", async () => {
    const { call, created } = genericFixture();
    const res = await call("new_generic_id", {
      folder_path: "06 Digital tools", prefix: "06", id: "13", title: "  Bar  ", templates_folder: "Templates", dry_run: false,
    });
    assert.notEqual(res.isError, true);
    assert.equal(created[0].path, "06 Digital tools/06.13 Bar.md");
    assert.match(created[0].content, /# Bar/);
  });

  test("refuses an invalid (non-two-digit) id", async () => {
    const { call } = genericFixture();
    const res = await call("new_generic_id", {
      folder_path: "06 Digital tools", prefix: "06", id: "1", title: "Bar", templates_folder: "Templates", dry_run: true,
    });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[invalid_id\]/);
  });

  test("refuses a title that sanitizeTitle rejects", async () => {
    const { call } = genericFixture();
    const res = await call("new_generic_id", {
      folder_path: "06 Digital tools", prefix: "06", id: "13", title: "a/b", templates_folder: "Templates", dry_run: true,
    });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[invalid_title\]/);
  });

  test("dry_run: true reports unresolved placeholder warnings", async () => {
    const { call } = build({
      folderChildren: { Templates: ["Templates/generic-template.md"] },
      noteContent: { "Templates/generic-template.md": '---\njd-id: "{{category}}.{{id}}"\n---\n\n{{nonsense}}\n' },
    });
    const res = await call("new_generic_id", {
      folder_path: "06 Digital tools", prefix: "06", id: "13", title: "Bar", templates_folder: "Templates", dry_run: true,
    });
    assert.deepEqual(res.structuredContent.placeholder_warnings, ["nonsense"]);
  });

  test("refuses to create from a template carrying an accepted fence — the note-creation accept-guard", async () => {
    // A template's frontmatter is copied through substitution into the new note
    // verbatim — without this guard, an accepted fence sitting in a template
    // file (however it got there) would land unscanned in a brand-new note.
    // `scanForAcceptFence` comes from @vault-mcp/core, published there at this
    // extraction rather than copied.
    const { call, created } = build({
      folderChildren: { Templates: ["Templates/generic-template.md"] },
      noteContent: {
        "Templates/generic-template.md":
          '---\njd-id: "{{category}}.{{id}}"\nacceptance-status: accepted\naccepted-by: someone\naccepted-on: 2026-01-01\n---\n\n# {{title}}\n',
      },
    });
    const res = await call("new_generic_id", {
      folder_path: "06 Digital tools", prefix: "06", id: "13", title: "Bar", templates_folder: "Templates", dry_run: false,
    });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[accept_forbidden\]/);
    assert.deepEqual(created, []); // never written
  });

  test("the accept-guard refusal fires under dry_run too — a preview must never claim a plan this call would refuse", async () => {
    const { call } = build({
      folderChildren: { Templates: ["Templates/generic-template.md"] },
      noteContent: {
        "Templates/generic-template.md": '---\njd-id: "{{category}}.{{id}}"\nacceptance-status: accepted\n---\n\n# {{title}}\n',
      },
    });
    const res = await call("new_generic_id", {
      folder_path: "06 Digital tools", prefix: "06", id: "13", title: "Bar", templates_folder: "Templates", dry_run: true,
    });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[accept_forbidden\]/);
  });

  test("an ordinary, fence-free template is unaffected by the accept-guard", async () => {
    const { call, created } = genericFixture();
    const res = await call("new_generic_id", {
      folder_path: "06 Digital tools", prefix: "06", id: "13", title: "Bar", templates_folder: "Templates", dry_run: false,
    });
    assert.notEqual(res.isError, true);
    assert.equal(created.length, 1);
  });
});

describe("new_stem", () => {
  function stemFixture(overrides = {}) {
    return build({
      folderChildren: { Templates: ["Templates/draft-template.md"] },
      noteContent: { "Templates/draft-template.md": "---\njd-id: XX.00+DRAFT\n---\n\n# {{title}}\n" },
      ...overrides,
    });
  }

  test("dry_run: false creates 'XX.00+CODE Name.md'", async () => {
    const { call, created } = stemFixture();
    const res = await call("new_stem", {
      folder_path: "06 Digital tools", prefix: "06", stem_code: "DRAFT", name: "Session directives", templates_folder: "Templates", dry_run: false,
    });
    assert.notEqual(res.isError, true);
    assert.equal(created[0].path, "06 Digital tools/06.00+DRAFT Session directives.md");
  });

  test("refuses when no template matches the stem code", async () => {
    const { call } = stemFixture();
    const res = await call("new_stem", {
      folder_path: "06 Digital tools", prefix: "06", stem_code: "NOPE", name: "Foo", templates_folder: "Templates", dry_run: true,
    });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[template_not_found\]/);
  });

  test("out_of_allowlist when the computed destination is outside the allowlist", async () => {
    const { call } = stemFixture({ allowlist: ["Somewhere Else"] });
    const res = await call("new_stem", {
      folder_path: "06 Digital tools", prefix: "06", stem_code: "DRAFT", name: "Foo", templates_folder: "Templates", dry_run: true,
    });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[out_of_allowlist\]/);
  });

  test("refuses a stem_code containing a path separator before it ever reaches destPathForStem's string concatenation", async () => {
    const { call, created, foldersCreated } = stemFixture();
    const res = await call("new_stem", {
      folder_path: "06 Digital tools", prefix: "06", stem_code: "../../evil", name: "Foo", templates_folder: "Templates", dry_run: true,
    });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[invalid_stem_code\]/);
    assert.deepEqual(created, []);
    assert.deepEqual(foldersCreated, []);
  });

  test("a real, regex-valid stem code (letters/digits/hyphen/underscore) is unaffected", async () => {
    const { call } = build({
      folderChildren: { Templates: ["Templates/draft-template.md"] },
      noteContent: { "Templates/draft-template.md": "---\njd-id: XX.00+co-de_2\n---\n\n# {{title}}\n" },
    });
    const res = await call("new_stem", {
      folder_path: "06 Digital tools", prefix: "06", stem_code: "co-de_2", name: "Foo", templates_folder: "Templates", dry_run: true,
    });
    assert.notEqual(res.isError, true);
  });
});

// ── argument hardening added at the extraction ──────────────────────────────

describe("argument validation the schema cannot carry across the boundary", () => {
  test("a backslash in ANY path-shaped argument refuses invalid_path, before every other check", async () => {
    const { call, created, foldersCreated, modified } = build({
      allPaths: ["06 Digital tools/06.13 Bar.md"],
      folderChildren: { Templates: ["Templates/generic-template.md"] },
      noteContent: { "Templates/generic-template.md": '---\njd-id: "{{category}}.{{id}}"\n---\n\n# {{title}}\n' },
    });
    const cases = [
      ["standard_zeros", { folder_path: "06 Digital tools\\..\\..\\etc", prefix: "06", dry_run: false }],
      ["promote_to_folder", { note_path: "06 Digital tools\\06.13 Bar.md", dry_run: false }],
      ["reindex_category", { note_path: "06\\..\\06.00 JDex.md", dry_run: false }],
      ["new_generic_id", { folder_path: "06 Digital tools", prefix: "06", id: "13", title: "Bar", templates_folder: "Templates\\..\\secrets", dry_run: false }],
    ];
    for (const [bare, args] of cases) {
      const res = await call(bare, args);
      assert.equal(res.isError, true, bare);
      assert.match(errText(res), /^Error \[invalid_path\]/, bare);
    }
    assert.deepEqual(created, [], "nothing may be written by a backslash-carrying call");
    assert.deepEqual(foldersCreated, []);
    assert.deepEqual(modified, []);
  });

  test("a prefix that is not exactly two digits refuses invalid_prefix — it reaches destPath* string concatenation", async () => {
    // NOT validated while this was a module: `prefix` is concatenated straight
    // into every computed destination, so "../.." introduced extra path
    // segments. Same class as the stem_code check, closed at the extraction.
    const { call, created } = build({
      folderChildren: { Templates: ["Templates/generic-template.md"] },
      noteContent: { "Templates/generic-template.md": '---\njd-id: "{{category}}.{{id}}"\n---\n\n# {{title}}\n' },
    });
    for (const bad of ["../..", "6", "006", "0a"]) {
      const res = await call("new_generic_id", {
        folder_path: "06 Digital tools", prefix: bad, id: "13", title: "Bar", templates_folder: "Templates", dry_run: false,
      });
      assert.equal(res.isError, true, bad);
      assert.match(errText(res), /^Error \[invalid_prefix\]/, bad);
    }
    const zeros = await call("standard_zeros", { folder_path: "06 Digital tools", prefix: "6/../..", dry_run: false });
    assert.equal(zeros.isError, true);
    assert.match(errText(zeros), /^Error \[invalid_prefix\]/);
    assert.deepEqual(created, []);
  });

  test("the `.min(1)` bounds are re-applied in the HANDLER, because the schema's do not survive the boundary", async () => {
    // The SDK converts zod to JSON Schema and the host converts it back through
    // a small subset: type, description and string enums survive; min, max,
    // default and pattern do not. This is the vaultmcp_skills_release semver lesson.
    const { call } = build({ allPaths: ["06 Digital tools/06.13 Bar.md"] });
    for (const [bare, args] of [
      ["standard_zeros", { folder_path: "", prefix: "06", dry_run: true }],
      ["promote_to_folder", { note_path: "  ", dry_run: true }],
      ["reindex_category", { note_path: "", dry_run: true }],
      ["new_stem", { folder_path: "06 Digital tools", prefix: "06", stem_code: "", name: "Foo", templates_folder: "Templates", dry_run: true }],
    ]) {
      const res = await call(bare, args);
      assert.equal(res.isError, true, bare);
      assert.match(errText(res), /^Error \[invalid_argument\]/, bare);
    }
  });

  test("a non-boolean dry_run refuses rather than being read as 'write for real'", async () => {
    const { call, created, renamed } = build({ allPaths: ["06 Digital tools/06.13 Bar.md"] });
    for (const bad of ["true", 1, null, undefined]) {
      const res = await call("promote_to_folder", { note_path: "06 Digital tools/06.13 Bar.md", dry_run: bad });
      assert.equal(res.isError, true, String(bad));
      assert.match(errText(res), /^Error \[invalid_argument\]/, String(bad));
    }
    assert.deepEqual(created, []);
    assert.deepEqual(renamed, []);
  });
});

// ── publication: names, flags, and what the host's guard can scope ──────────

describe("publication: names, flags, and what the host's guard can scope", () => {
  const specs = () => buildJdScaffoldTools(emptyJdScaffoldSource(), {});

  test("the plugin id sanitizes to `vaultmcp_jd_scaffold`, so the wire names are vaultmcp_jd_scaffold_*", () => {
    assert.equal(OWNER, "vaultmcp_jd_scaffold");
    assert.deepEqual(specs().map((t) => t.name), [
      "standard_zeros",
      "ensure_category_indexes",
      "promote_to_folder",
      "reindex_category",
      "new_standard_zero",
      "new_generic_id",
      "new_stem",
    ]);
    const { tools } = publishInto(specs());
    assert.deepEqual([...tools.keys()], [
      "vaultmcp_jd_scaffold_standard_zeros",
      "vaultmcp_jd_scaffold_ensure_category_indexes",
      "vaultmcp_jd_scaffold_promote_to_folder",
      "vaultmcp_jd_scaffold_reindex_category",
      "vaultmcp_jd_scaffold_new_standard_zero",
      "vaultmcp_jd_scaffold_new_generic_id",
      "vaultmcp_jd_scaffold_new_stem",
    ]);
  });

  test("no bare name could have kept its `obsidian_jd_` spelling — the host REFUSES a published `obsidian_*` name", () => {
    // packages/host/src/mcp/external-tools.ts, F1:
    //   if (toolName.startsWith("obsidian_"))
    //     throw new TypeError(`governor: tool name '${toolName}' collides with
    //     the reserved obsidian_* namespace`);
    // The published name is `<sanitized owner>_<bare name>`, so the ONLY way to
    // publish `obsidian_jd_standard_zeros` would be an owner sanitizing to
    // `obsidian` — which is precisely what that check refuses. Half of this
    // rename was forced by the boundary, not chosen.
    for (const spec of specs()) {
      assert.ok(!spec.name.startsWith("obsidian_"), spec.name);
      assert.ok(!`${OWNER}_${spec.name}`.startsWith("obsidian_"), spec.name);
    }
  });

  test("every tool is MUTATING and claims no read-only exemption", () => {
    const { tools } = publishInto(specs(), { trusted: true });
    for (const [name, entry] of tools) {
      assert.equal(entry.def.claimsReadOnly, false, name);
      assert.equal(entry.def.annotations.readOnlyHint, false, name);
    }
  });

  test("exactly the two note-naming tools are path-keyed; the other five stay pathless (F3 refuse-all)", () => {
    // The decision, pinned. `path` WAS an argument of promote_to_folder and
    // reindex_category and was deliberately renamed `note_path`: keeping it
    // would have scoped the SOURCE note while the folder and file promote
    // WRITES are computed and named by nothing, and while reindex's
    // area/system tiers READ every sibling XX.00 in the vault. Handing the
    // guard a path it can scope, next to writes and reads it cannot, is the
    // illusion of a check. `folder_path` and `templates_folder` were never on
    // the host's list either — verified against the snapshot below rather than
    // assumed.
    // ROUND 1 (2026-09-07): `note_path` IS a host path key now, because the
    // kernel's record guard, lock consult and journal target all ride
    // collectPaths and a pathless named-note write had escaped all three —
    // reindex could rewrite a `record: true` index note the kernel used to
    // refuse, on every vault, allowlist or not. The named note is therefore
    // scoped and kernel-visible.
    //
    // ROUND 2 (2026-09-07): the rule that settles the spelling for anything
    // added here — path-key an argument iff the tool MUTATES the note it names.
    // Every tool in this package mutates, so the two that name a note keep
    // `note_path`; the tier's READ tools went the other way (`note`, not a
    // key), because kernel visibility binds at the mutating dequeue and buys a
    // read nothing while costing it F3's refusal.
    //
    // TWO residuals ride with that, both documented rather than glossed:
    //   * the COMPUTED side-writes (standard-zeros' created files, promote's
    //     folder + new file) remain beyond the argument-derived guard, exactly
    //     like obsidian_repoint_link's discovered writes — a documented
    //     boundary with an existing precedent, mitigated by filesChanged/files;
    //   * reindex_category's vault-wide sibling READ is not scoped by the note
    //     argument, so under an allowlist its area/system tiers can fold hidden
    //     siblings' names into a visible note. THAT ONE WAS RATIFIED, not
    //     overlooked (README §2): the kernel protection is live on every vault
    //     while the leak needs an allowlist, and the reversal is one word
    //     (`note_path` -> `note`), which this pin would catch immediately.
    const KEYED = ["promote_to_folder", "reindex_category"];
    for (const spec of specs()) {
      const keys = Object.keys(spec.inputSchema ?? {}).filter((k) => HOST_PATH_KEYS.includes(k));
      if (KEYED.includes(spec.name)) {
        assert.deepEqual(keys, ["note_path"], `${spec.name} carries exactly note_path`);
      } else {
        assert.deepEqual(keys, [], `${spec.name} stays pathless — F3 is its allowlist posture`);
      }
    }
    for (const arg of ["folder_path", "templates_folder"]) {
      assert.ok(!HOST_PATH_KEYS.includes(arg), arg);
    }
    // Vacuity: the snapshot really does hold the spellings this posture turns on.
    assert.ok(HOST_PATH_KEYS.includes("path"), "vacuity: `path` is a host path key");
    assert.ok(HOST_PATH_KEYS.includes("note_path"), "vacuity: `note_path` is a host path key since round 1");
    assert.ok(!HOST_PATH_KEYS.includes("note"), "`note` is the tier's PATHLESS spelling and must not become a key");
  });

  test("refusals throw with a lowercase-snake code, which the host renders as `Error [code]: message`", async () => {
    const { call } = build({ allPaths: ["06 Digital tools/Not an id.md"] });
    const res = await call("promote_to_folder", { note_path: "06 Digital tools/Not an id.md", dry_run: true });
    assert.equal(res.isError, true);
    assert.match(errText(res), /^Error \[not_id_note\]: /);
  });

  test("no shipped string points at `modules.jd-scaffold.config.*`, an `enabled` toggle, or an `obsidian_jd_*` tool", () => {
    // Both spellings name NOTHING in this plugin: the module's config block
    // never existed, its enable/disable toggle was the module host's own row
    // (for a satellite, "enabled" means installed and enabled in Obsidian), and
    // the old tool names cannot be published at all.
    for (const spec of specs()) {
      const strings = [spec.description, ...Object.values(spec.inputSchema ?? {}).map((z) => z.description ?? "")];
      for (const s of strings) {
        assert.ok(!/modules\.[a-z-]+\.config/.test(s), `${spec.name}: ${s}`);
        assert.ok(!/obsidian_jd_/.test(s), `${spec.name}: ${s}`);
        assert.ok(!/module (host|toggle)|enable this module/i.test(s), `${spec.name}: ${s}`);
      }
    }
  });

  test("this plugin has NO settings at all, and that absence is the pin", () => {
    // The module declared no `config` block in JD_SCAFFOLD_MANIFEST, so there
    // was nothing to adopt and no adoption machinery was built. If a setting is
    // ever added, this test fails and whoever adds it has to decide what
    // adoption (if any) it needs.
    assert.deepEqual(Object.keys(DEFAULT_PLUGIN_SETTINGS), []);
    assert.deepEqual(settingsOf({ config: { anything: 1 }, adoptedFromHost: true }), {});
    assert.deepEqual(settingsOf(null), {});
  });

  test("the local visiblePaths helper agrees with core's published isVisible", () => {
    // tools.ts defines its filter OVER core's `isVisible` rather than beside
    // it — a second copy of a guard predicate is the drift this repo has paid
    // for twice. This is the equivalence, spelled out.
    const settings = { readOnly: false, allowlist: ["10-19 Personal"] };
    const paths = ["10-19 Personal/a.md", "Archive/b.md", "10-19 Personal/sub/c.md"];
    assert.deepEqual(visiblePaths(paths, settings), ["10-19 Personal/a.md", "10-19 Personal/sub/c.md"]);
    assert.deepEqual(visiblePaths(paths, { readOnly: false, allowlist: [] }), paths);
  });
});
