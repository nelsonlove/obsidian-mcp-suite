/**
 * link-healing.test.mjs — the satellite's own copy of the host's guarantee:
 * every move goes through `app.fileManager.renameFile`, Obsidian's
 * link-updating rename, and NEVER `app.vault.rename`, which moves the bytes and
 * leaves every backlink pointing at a note that is no longer there.
 *
 * `promote_to_folder` is this package's only move, and while jd-scaffold was a
 * host module the rule was covered by the host's own link-healing suite — whose
 * source scan globs `packages/host/src/**\/*.ts` and CANNOT SEE THIS PACKAGE.
 * So the rule came with the code, in the same two halves the host uses and the
 * triage satellite already copied:
 *
 *   • THE LIVE ADAPTER — `obsidianJdScaffoldSource(app).renameFile` driven
 *     against a fake app whose `vault.rename` THROWS, so a future refactor
 *     reaching for it fails loudly here rather than silently orphaning
 *     backlinks in a real vault.
 *   • THE SOURCE SCAN — globs this package's own `src/**\/*.ts` for
 *     `vault.rename`, and PROVES the scan works by planting a violation in a
 *     scratch module and watching it fail.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { glob, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

import { installObsidianStub, TFile, TFolder } from "./obsidian-stub.mjs";

// The adapter imports live Obsidian classes, so the specifier is pointed at the
// stub BEFORE it is imported.
installObsidianStub();
const { obsidianJdScaffoldSource } = await import("../src/obsidian-source.ts");

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolvePath(HERE, "../src");

/**
 * The surfaces a promote touches, each a spy. `vault.rename` exists and throws
 * — present so "it was never called" is a real assertion about a real method
 * rather than about a typo.
 */
function fakeApp({ files = ["06 Digital tools/06.13 Bar.md"], folders = ["06 Digital tools"] } = {}) {
  const tree = new Map(files.map((p) => [p, new TFile(p)]));
  const dirs = new Set(folders);
  const calls = { renameFile: [], vaultRename: [], createFolder: [], create: [], modify: [] };
  return {
    calls,
    tree,
    app: {
      vault: {
        getAbstractFileByPath: (p) => tree.get(p) ?? (dirs.has(p) ? new TFolder(p) : null),
        getMarkdownFiles: () => [...tree.values()],
        getAllLoadedFiles: () => [...tree.values(), ...[...dirs].map((d) => new TFolder(d))],
        async create(p, content) {
          calls.create.push([p, content]);
          tree.set(p, new TFile(p));
        },
        async createFolder(p) {
          calls.createFolder.push(p);
          dirs.add(p);
        },
        async modify(file, content) {
          calls.modify.push([file.path, content]);
        },
        async read() {
          return "";
        },
        async rename(file, to) {
          calls.vaultRename.push([file.path, to]);
          throw new Error("vault.rename is not link-aware — moves must go through fileManager.renameFile");
        },
      },
      fileManager: {
        async renameFile(file, to) {
          calls.renameFile.push([file.path, to]);
          tree.delete(file.path);
          tree.set(to, new TFile(to));
        },
      },
    },
  };
}

describe("in band: a promote heals its own links", () => {
  test("renameFile goes through fileManager.renameFile, never vault.rename", async () => {
    const { app, calls } = fakeApp();
    await obsidianJdScaffoldSource(app).renameFile(
      "06 Digital tools/06.13 Bar.md",
      "06 Digital tools/06.13 Bar/06.13 Bar.md",
    );
    assert.deepEqual(calls.renameFile, [["06 Digital tools/06.13 Bar.md", "06 Digital tools/06.13 Bar/06.13 Bar.md"]]);
    assert.deepEqual(calls.vaultRename, [], "vault.rename would move the bytes and orphan every backlink");
  });

  test("a vanished source refuses before the vault is touched", async () => {
    const { app, calls } = fakeApp();
    await assert.rejects(
      () => obsidianJdScaffoldSource(app).renameFile("06 Digital tools/ghost.md", "06 Digital tools/ghost/ghost.md"),
      /no longer exists/,
    );
    assert.deepEqual(calls.renameFile, []);
    assert.deepEqual(calls.vaultRename, []);
  });
});

describe("the source scan: no move path in this package reaches for vault.rename", () => {
  /** Every `src/**\/*.ts` line matching `vault.rename(`, as `file: line`. */
  async function vaultRenameOffenders() {
    const offenders = [];
    for await (const rel of glob("**/*.ts", { cwd: SRC })) {
      const text = await readFile(resolvePath(SRC, rel), "utf8");
      for (const line of text.split("\n")) {
        // Skip prose: every mention in this package's comments is an
        // explanation of why NOT to call it.
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) continue;
        if (/vault\s*\.\s*rename\s*\(/.test(line)) offenders.push(`${rel}: ${code}`);
      }
    }
    return offenders;
  }

  test("no move path anywhere in this package's source reaches for vault.rename", async () => {
    assert.deepEqual(await vaultRenameOffenders(), [], "use app.fileManager.renameFile — vault.rename orphans backlinks");
  });

  test("the scan actually catches one: a planted vault.rename in a scratch module fails it", async () => {
    const planted = resolvePath(SRC, "__vault-rename-scratch.ts");
    try {
      await writeFile(
        planted,
        ["export async function bad(app: any, file: any, to: string) {", "  await app.vault.rename(file, to);", "}", ""].join("\n"),
        "utf8",
      );
      const offenders = await vaultRenameOffenders();
      assert.equal(offenders.length, 1, `the glob missed a planted violation: ${JSON.stringify(offenders)}`);
      assert.match(offenders[0], /__vault-rename-scratch\.ts: await app\.vault\.rename\(file, to\);/);
    } finally {
      await rm(planted, { force: true });
    }
  });
});
