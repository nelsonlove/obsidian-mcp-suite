/**
 * id-migration.test.mjs — THE HOST'S ONE-SHOT ADOPTION (suite split, S3c).
 *
 * The id has moved twice and this file has been rewritten with it. Until S3c it
 * pinned the 0.12.0 rename, which MOVED `.obsidian/plugins/vault-mcp/`'s
 * contents into `.obsidian/plugins/governor/` — one plugin, one owner of every
 * file, so a move was right. S3c is the opposite act with the same directories:
 * the HOST takes `vault-mcp` back while the governance PROVIDER keeps `governor`
 * and keeps the folder, so the source is now a LIVE PLUGIN'S OWN DIRECTORY.
 *
 * Everything below exists because moving out of it would delete the provider's
 * state from under it.
 *
 * WHAT IS PINNED HERE, and why each one is load-bearing:
 *
 *   • COPY, NEVER MOVE, and never a delete. `AdoptionFs` has no `rename` and no
 *     `remove`, so "the host cannot move or delete the provider's state" is a
 *     property of the SURFACE rather than a rule someone has to remember. The
 *     fake fs below implements exactly that surface, which is why the pin is
 *     honest: a future author who reintroduces a move has to widen the interface
 *     first, and that is a line in a diff.
 *   • THE SOURCE IS NEVER WRITTEN. The adoption record goes in the HOST's own
 *     folder. The fake fs records every write path, and the test asserts none of
 *     them is under the source — which is the structural half of "never delete
 *     the source" that the satellite-adoption precedent asks for.
 *   • `governance/` IS NOT ADOPTED. The authority state stays with the plugin
 *     that kept the id, and that is the entire reason it kept it. A future
 *     `HOST_ADOPTED_ENTRIES` that grew a `governance` entry would be the split
 *     undoing its own central decision.
 *   • THE ONE-SHOT LATCH is the host's own `data.json`. A second adoption over a
 *     running host would copy a stale journal month back over a live one.
 *   • A PRE-0.12.0 VAULT NEEDS NO ADOPTION AT ALL. Its data is already in
 *     `plugins/vault-mcp/`, which is the host's own folder again — the happy
 *     accident of moving the id back, and worth a pin so nobody "fixes" it.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  planHostAdoption,
  runHostAdoption,
  adoptionRecordText,
  MIGRATION_MARKER,
  ADOPTION_RECORD,
  CODE_ARTIFACTS,
  HOST_ADOPTED_ENTRIES,
  PLUGIN_ID,
  LEGACY_PLUGIN_ID,
} from "../src/id-migration.ts";

const SOURCE = ".obsidian/plugins/governor";
const HOST = ".obsidian/plugins/vault-mcp";

/** A realistic live PROVIDER folder: its own code, its own authority state, and
 * the three host-owned things the host copies out. */
const PROVIDER_FILES = ["main.js", "manifest.json", "styles.css", "data.json", "install-id.json", "crosssession-receipts.json"];
const PROVIDER_FOLDERS = ["journal", "governance"];
/** The host's folder on a vault that ran the 0.12.0 migration: code, plus the
 * marker that migration left behind when it emptied this directory. */
const STALE_HOST = { files: ["main.js", "manifest.json", MIGRATION_MARKER], folders: [] };

describe("planHostAdoption", () => {
  test("no provider folder ⇒ skip (a fresh suite install, or a pre-0.12.0 vault whose data is ALREADY here)", () => {
    const plan = planHostAdoption(null, STALE_HOST);
    assert.equal(plan.action, "skip");
    assert.match(plan.reason, /nothing to adopt from/);
    assert.ok(!plan.warn, "a vault with no governance provider is the ordinary standalone case, not a warning");
  });

  test("the host already has a data.json ⇒ skip: the one-shot latch", () => {
    const plan = planHostAdoption(
      { files: PROVIDER_FILES, folders: PROVIDER_FOLDERS },
      { files: ["main.js", "manifest.json", "data.json"], folders: ["journal"] },
    );
    assert.equal(plan.action, "skip");
    assert.match(plan.reason, /already provisioned/);
  });

  test("adopts exactly the host-owned entries — journal and install-id, never governance", () => {
    const plan = planHostAdoption({ files: PROVIDER_FILES, folders: PROVIDER_FOLDERS }, STALE_HOST);
    assert.equal(plan.action, "adopt");
    assert.deepEqual(plan.entries, ["journal", "install-id.json"]);
    assert.equal(plan.settings, true);
    assert.ok(!plan.entries.includes("governance"), "the authority state stays with the plugin that kept the id");
    assert.ok(!plan.entries.includes("crosssession-receipts.json"), "the vault-crosssession satellite adopted that file at S6 and its copy is authoritative");
    for (const artifact of CODE_ARTIFACTS) {
      assert.ok(!plan.entries.includes(artifact), `${artifact} is the provider's own build and must never travel`);
    }
  });

  test("an entry the host ALREADY has is skipped, not overwritten", () => {
    const plan = planHostAdoption(
      { files: PROVIDER_FILES, folders: PROVIDER_FOLDERS },
      { files: ["main.js", "manifest.json", "install-id.json"], folders: [] },
    );
    assert.equal(plan.action, "adopt");
    assert.deepEqual(plan.entries, ["journal"]);
    assert.deepEqual(plan.skipped, ["install-id.json"]);
  });

  test("a provider folder with only code and a MIGRATED.md is a 0.12.0 leftover, not a provider — quiet skip", () => {
    const plan = planHostAdoption({ files: ["main.js", "manifest.json", MIGRATION_MARKER], folders: [] }, STALE_HOST);
    assert.equal(plan.action, "skip");
    assert.ok(!plan.warn);
  });

  test("a provider folder with data but NO data.json warns LOUDLY — the host would run at defaults", () => {
    // The failure this catches is the one that matters: with no settings
    // adopted, `loadSettings` falls back to DEFAULT_SETTINGS — socket enabled,
    // read-only OFF, allowlist EMPTY — and the first save closes the adoption
    // window permanently. A quiet skip here is the guard config silently
    // resetting to open.
    const plan = planHostAdoption({ files: ["main.js", "install-id.json"], folders: ["journal", "governance"] }, STALE_HOST);
    assert.equal(plan.action, "skip");
    assert.equal(plan.warn, true);
    assert.match(plan.reason, /DEFAULTS/);
  });

  test("the adopted set is exactly two entries and neither is authority state", () => {
    // A pin on the CONSTANT rather than on a plan, so widening the set is a
    // deliberate act with a failing test rather than a quiet edit.
    assert.deepEqual([...HOST_ADOPTED_ENTRIES], ["journal", "install-id.json"]);
  });
});

// ── the fake fs: exactly `AdoptionFs`, no rename, no remove ─────────────────

function fakeFs(tree) {
  // `tree` is a flat map of path -> string for files; a folder exists iff some
  // path is prefixed by it. Writes are recorded so the "never writes the source"
  // assertion has something to check.
  const files = new Map(Object.entries(tree));
  const writes = [];
  const folders = new Set();
  for (const p of files.keys()) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
  }
  return {
    writes,
    files,
    fs: {
      async exists(p) {
        return files.has(p) || folders.has(p);
      },
      async list(p) {
        if (!folders.has(p)) throw new Error(`not a folder: ${p}`);
        const out = { files: [], folders: [] };
        const seen = new Set();
        for (const f of files.keys()) {
          if (!f.startsWith(`${p}/`)) continue;
          const rest = f.slice(p.length + 1);
          const head = rest.split("/")[0];
          if (seen.has(head)) continue;
          seen.add(head);
          (rest.includes("/") ? out.folders : out.files).push(`${p}/${head}`);
        }
        return out;
      },
      async read(p) {
        if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
        return files.get(p);
      },
      async write(p, data) {
        writes.push(p);
        files.set(p, data);
        const parts = p.split("/");
        for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
      },
      async mkdir(p) {
        folders.add(p);
      },
    },
  };
}

const LIVE_PROVIDER = {
  [`${SOURCE}/main.js`]: "provider build",
  [`${SOURCE}/manifest.json`]: '{"id":"governor"}',
  [`${SOURCE}/data.json`]: JSON.stringify({
    allowlist: ["Projects"],
    readOnly: true,
    historyEnabled: true,
    modules: { acceptance: { enabled: true }, scheme: { enabled: true } },
  }),
  [`${SOURCE}/install-id.json`]: '{"install":"abc"}',
  [`${SOURCE}/journal/2026-08.jsonl`]: '{"op":"a"}\n',
  [`${SOURCE}/journal/2026-09.jsonl`]: '{"op":"b"}\n',
  [`${SOURCE}/governance/acceptance-log.jsonl`]: '{"kind":"accept"}\n',
  [`${SOURCE}/governance/baselines/x.json`]: "{}",
  [`${HOST}/main.js`]: "host build",
  [`${HOST}/manifest.json`]: '{"id":"vault-mcp"}',
  [`${HOST}/${MIGRATION_MARKER}`]: "# Migrated to the `governor` plugin folder",
};

describe("runHostAdoption", () => {
  test("copies the journal tree and the install id, and reads the settings", async () => {
    const { fs, files } = fakeFs(LIVE_PROVIDER);
    const r = await runHostAdoption(fs, SOURCE, HOST, { now: () => new Date("2026-09-08T00:00:00Z") });
    assert.equal(r.plan.action, "adopt");
    assert.deepEqual(r.copied, ["journal", "install-id.json"]);
    assert.equal(files.get(`${HOST}/journal/2026-08.jsonl`), '{"op":"a"}\n');
    assert.equal(files.get(`${HOST}/journal/2026-09.jsonl`), '{"op":"b"}\n');
    assert.equal(files.get(`${HOST}/install-id.json`), '{"install":"abc"}');
    assert.ok(r.settingsJson, "the settings text is returned for the caller to split");
    assert.deepEqual(JSON.parse(r.settingsJson).allowlist, ["Projects"]);
  });

  test("THE SOURCE IS UNTOUCHED — every byte still there, and not one write into it", async () => {
    const { fs, files, writes } = fakeFs(LIVE_PROVIDER);
    await runHostAdoption(fs, SOURCE, HOST);
    for (const [p, v] of Object.entries(LIVE_PROVIDER)) {
      if (!p.startsWith(SOURCE)) continue;
      assert.equal(files.get(p), v, `${p} must be unchanged`);
    }
    assert.deepEqual(
      writes.filter((w) => w.startsWith(SOURCE)),
      [],
      "the host must never write into the provider's folder — the adoption record goes in the host's own"
    );
  });

  test("governance/ is neither copied nor listed", async () => {
    const { fs, files } = fakeFs(LIVE_PROVIDER);
    const r = await runHostAdoption(fs, SOURCE, HOST);
    assert.ok(!r.copied.includes("governance"));
    assert.equal(files.get(`${HOST}/governance/acceptance-log.jsonl`), undefined);
    assert.equal(files.get(`${HOST}/governance/baselines/x.json`), undefined);
  });

  test("the adoption record lands in the HOST's folder and names the rollback path", async () => {
    const { fs, files } = fakeFs(LIVE_PROVIDER);
    await runHostAdoption(fs, SOURCE, HOST, { now: () => new Date("2026-09-08T00:00:00Z") });
    const record = files.get(`${HOST}/${ADOPTION_RECORD}`);
    assert.ok(record, "the record must exist");
    assert.match(record, /COPIED/);
    assert.match(record, /Nothing was moved and nothing was deleted/);
    assert.match(record, /rollback/i);
    assert.equal(files.get(`${SOURCE}/${ADOPTION_RECORD}`), undefined, "and it is NOT written into the source");
  });

  test("idempotent: a second run after the host has its own data.json copies nothing", async () => {
    const { fs, writes } = fakeFs({ ...LIVE_PROVIDER, [`${HOST}/data.json`]: "{}" });
    const r = await runHostAdoption(fs, SOURCE, HOST);
    assert.equal(r.plan.action, "skip");
    assert.deepEqual(r.copied, []);
    assert.deepEqual(writes, []);
  });

  test("a pre-0.12.0 vault (no provider folder) adopts nothing and writes nothing", async () => {
    const { fs, writes } = fakeFs({
      [`${HOST}/main.js`]: "host build",
      [`${HOST}/data.json`]: "{}",
      [`${HOST}/journal/2026-08.jsonl`]: "{}\n",
    });
    const r = await runHostAdoption(fs, SOURCE, HOST);
    assert.equal(r.plan.action, "skip");
    assert.deepEqual(writes, []);
  });

  test("a copy failure mid-sequence reports what landed, writes no record, and still touches nothing in the source", async () => {
    const { fs, files, writes } = fakeFs(LIVE_PROVIDER);
    const realWrite = fs.write.bind(fs);
    fs.write = async (p, d) => {
      if (p === `${HOST}/install-id.json`) throw new Error("disk full");
      return realWrite(p, d);
    };
    const r = await runHostAdoption(fs, SOURCE, HOST);
    assert.equal(r.failedEntry, "install-id.json");
    assert.deepEqual(r.copied, ["journal"]);
    assert.equal(files.get(`${HOST}/${ADOPTION_RECORD}`), undefined, "a partial adoption must stay re-inspectable, not be stamped done");
    assert.deepEqual(writes.filter((w) => w.startsWith(SOURCE)), []);
  });

  test("the adoption surface CANNOT move or delete — a structural guarantee, not a rule", () => {
    // The fake above implements `AdoptionFs` exactly. If a future author adds a
    // move back, this fake stops satisfying the interface and the type check
    // fails before this test does — which is the point of asserting on the
    // shape rather than on behaviour.
    const { fs } = fakeFs(LIVE_PROVIDER);
    assert.equal(fs.rename, undefined);
    assert.equal(fs.remove, undefined);
    assert.deepEqual(Object.keys(fs).sort(), ["exists", "list", "mkdir", "read", "write"]);
  });
});

describe("adoptionRecordText", () => {
  test("names every copied entry, every skipped one, and the source it left alone", () => {
    const text = adoptionRecordText(new Date("2026-09-08T00:00:00Z"), SOURCE, HOST, ["journal"], ["install-id.json"]);
    assert.match(text, /`journal`/);
    assert.match(text, /`install-id\.json`/);
    assert.match(text, /Already present here/);
    assert.match(text, new RegExp(SOURCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, /governance\//, "it must say the authority state was not touched");
  });
});

describe("the ids the rest of the plugin names itself by", () => {
  test("PLUGIN_ID matches manifest.json — the self-preservation refusals depend on it", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(readFileSync(join(here, "..", "manifest.json"), "utf8"));
    assert.equal(PLUGIN_ID, manifest.id);
    assert.equal(PLUGIN_ID, "vault-mcp");
  });

  test("LEGACY_PLUGIN_ID is the PROVIDER's live id — one string, two jobs", () => {
    // It is the folder the host adopts FROM, and it is also a plugin the host
    // must refuse to disable or uninstall through MCP. The second job means the
    // provider is protected by NAME even before it registers on the seam and
    // earns the `providerIds()` refusal — a real gap that would otherwise open
    // in the window between the host loading and the provider registering.
    assert.equal(LEGACY_PLUGIN_ID, "governor");
    assert.notEqual(LEGACY_PLUGIN_ID, PLUGIN_ID);
  });
});
