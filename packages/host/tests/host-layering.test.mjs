/**
 * host-layering.test.mjs — WHAT REPLACED THE HOST/GOVERNOR BOUNDARY TEST (S3c).
 *
 * `tests/host-governor-boundary.test.mjs` enumerated every relative import
 * crossing between `src/` and `src/governor/`, in both directions, and failed on
 * an unlisted one. It did its whole job: S1 enumerated 45 crossings, S2 left 32,
 * S3a left 30, S3b left 27, and every step was reviewable because the number was
 * checked in and a diff moved it. Then S3c moved the governance provider into
 * `packages/governor`, and that instrument DIED — not because the boundary
 * stopped mattering, but because its scan matched RELATIVE specifiers only. With
 * the provider in another package there are no relative crossings to find, so the
 * old file would have reported zero and passed, vacuously, forever. A green
 * tripwire that cannot fire is worse than a deleted one, so it was deleted.
 *
 * ── WHAT ACTUALLY GUARDS THE BOUNDARY NOW, AND WHERE ────────────────────────
 *
 * Three things, and it is worth being precise about which is real enforcement
 * and which is only a check:
 *
 *   1. THE PACKAGE BOUNDARY ITSELF, which is real: `packages/host` has no
 *      dependency on `packages/governor` in its `package.json` and no path to
 *      it, so a host file importing provider code does not typecheck and does
 *      not bundle. That is enforcement, not convention, and it is what the old
 *      test was a stand-in for.
 *   2. THIS FILE, which pins the two things the package boundary does NOT catch:
 *      a relative specifier that escapes the package (`../../governor/...`
 *      resolves on disk in a monorepo and would bundle happily), and any
 *      surviving reference to the retired in-tree layout.
 *   3. THE PROVIDER'S OWN LAYERING TEST, in `packages/governor/tests`, which
 *      pins the other direction: the provider depends on `@vault-mcp/core`,
 *      `vault-mcp-api`, `obsidian` and its own sources, and on no host file.
 *      That direction cannot be checked from here, and asserting it from here
 *      would be the layering inversion the split exists to remove.
 *
 * ── THE ONE THING THAT GOT WEAKER, NAMED ────────────────────────────────────
 *
 * The old table was DESCRIPTIVE of every crossing, so adding one was a line in a
 * diff a reviewer had to justify. There is no equivalent now, because there is
 * nothing to enumerate: the answer is zero and the compiler says so. What is
 * genuinely lost is the SHRINKING RECORD — the 45 → 32 → 30 → 27 → 0 series that
 * made the split's progress a number rather than a claim. That series is
 * preserved in the deleted file's git history and in `docs/suite-split-design.md`
 * §7, and nothing needs to keep counting it now that it has reached zero.
 *
 * Instrument discipline: every scan below is exercised against a synthetic tree
 * with a planted violation BEFORE it is trusted against the real one. A source
 * scan that silently matches nothing proves nothing.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, posix } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(PKG, "src");

/** Static and dynamic import/export specifiers, including `import("…")` in type position. */
const SPECIFIER = /(?:\bfrom|\bimport|\bexport)\s*\(?\s*["']([^"']+)["']/g;

/**
 * Every relative specifier that resolves OUTSIDE the package's own `src/`.
 *
 * The interesting case is not `../` in general — half the tree uses it — but a
 * `../` chain deep enough to leave `packages/host/src`. In a monorepo that
 * resolves on disk and bundles without complaint, which is exactly why the
 * package boundary alone does not catch it.
 *
 * Pure over a { path -> source } map, so the planted-violation check below
 * drives the same function the real scan does.
 */
export function scanEscapingImports(files) {
  const escapes = new Map();
  for (const [path, source] of files) {
    const dir = posix.dirname(path);
    for (const m of source.matchAll(SPECIFIER)) {
      const spec = m[1];
      if (!spec.startsWith(".")) continue; // a bare specifier is a declared dependency
      const target = posix.normalize(posix.join(dir, spec));
      if (target.startsWith("src/")) continue;
      if (!escapes.has(path)) escapes.set(path, new Set());
      escapes.get(path).add(target);
    }
  }
  return escapes;
}

/** Any surviving mention of the retired in-tree governance layout. */
export function scanRetiredLayout(files) {
  const hits = [];
  for (const [path, source] of files) {
    // Comments are deliberately INCLUDED. A source scan that skipped them would
    // miss a re-added import written as a commented-out line and then
    // uncommented, and — more usefully — a stale doc comment that tells the next
    // author the provider still lives under `src/`.
    for (const pattern of [/src\/governor\//g, /\.\/governor\//g, /src\/governance\//g, /kernel\/governance\//g]) {
      if (pattern.test(source)) hits.push(`${path} names ${pattern.source}`);
      pattern.lastIndex = 0;
    }
  }
  return hits.sort();
}

function readSrc() {
  const files = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (entry.endsWith(".ts")) files.set(relative(PKG, abs).split("\\").join("/"), readFileSync(abs, "utf8"));
    }
  };
  walk(SRC);
  return files;
}

const asLines = (m) => [...m].flatMap(([from, tos]) => [...tos].map((to) => `${from} -> ${to}`)).sort();

// ── the instruments, verified before they are trusted ────────────────────────

describe("the layering scans: the instruments themselves", () => {
  test("it FINDS a planted import that escapes the package", () => {
    const files = new Map([
      ["src/main.ts", 'import { wire } from "../../governor/src/wiring/wiring.js";\n'],
    ]);
    assert.deepEqual(asLines(scanEscapingImports(files)), ["src/main.ts -> ../governor/src/wiring/wiring.js"]);
  });

  test("it ignores ordinary in-package relative imports and bare specifiers", () => {
    const files = new Map([
      ["src/mcp/server.ts", 'import "./tools-core.js";\nimport "../guard.js";\nimport { ok } from "@vault-mcp/core";\nimport * as fs from "node:fs";\n'],
    ]);
    assert.deepEqual(asLines(scanEscapingImports(files)), []);
  });

  test("it FINDS a planted reference to the retired in-tree layout", () => {
    const files = new Map([
      ["src/mcp/x.ts", 'type T = import("../governor/kernel/revision.js").Revision;\n'],
      ["src/y.ts", "// still lives in src/governance/ — stale\n"],
    ]);
    assert.deepEqual(
      scanRetiredLayout(files).map((h) => h.replace(/\\/g, "")),
      ["src/mcp/x.ts names ./governor/", "src/y.ts names src/governance/"]
    );
  });

  test("the real tree is non-trivial — the scan reads actual sources", () => {
    const files = readSrc();
    // A "the walker is broken" sanity floor, not a size budget. It was 150 while
    // the governance provider still compiled into this tree; the split took ~90
    // more source files out at once, so the floor moves down with it. Lower it
    // again when a later extraction makes it fail; do not raise it into a budget.
    assert.ok(files.size > 100, `only ${files.size} source files found; the walker is broken`);
    assert.ok([...files.keys()].some((p) => p.startsWith("src/mcp/")), "no file under src/mcp/ — the walker is broken");
  });
});

// ── the invariants ───────────────────────────────────────────────────────────

describe("THE HOST'S LAYER — no reach into any other package", () => {
  test("no host source imports anything outside its own src/", () => {
    assert.deepEqual(
      asLines(scanEscapingImports(readSrc())),
      [],
      "a relative specifier escaping packages/host/src resolves and bundles in a monorepo even though the " +
        "package boundary would refuse the same import spelled as a dependency — route it through " +
        "@vault-mcp/core, or do not make it"
    );
  });

  test("nothing names the retired in-tree governance layout", () => {
    assert.deepEqual(
      scanRetiredLayout(readSrc()),
      [],
      "src/governor/, src/governance/ and kernel/governance/ are all retired addresses; the governance provider " +
        "is packages/governor and the host reaches it only through the seam"
    );
  });

  test("the host does NOT depend on the publishing SDK — it IS the host", () => {
    // `vault-mcp-api` is the surface a PUBLISHER uses to reach this plugin. A
    // host importing it would mean the host had started consuming its own api
    // object through the client-side shim, which is how the two shapes drift
    // apart: the SDK mirrors `external-tools.ts` and is pinned against it by
    // that package's contract test, and a mirror that starts being the
    // implementation is not a mirror.
    const offenders = [];
    for (const [path, source] of readSrc()) {
      if (/["']vault-mcp-api["']/.test(source)) offenders.push(path);
    }
    assert.deepEqual(offenders, []);
  });

  test("the seam is the ONLY module naming the provider's registration surface", () => {
    // Not a boundary so much as a map: `registerWriteObserver` /
    // `registerSessionRefusal` should appear in exactly two places — the seam
    // that defines them and the composition root that puts them on the api
    // object, plus two files that name the hooks only in PROSE:
    // `kernel/sessions/session.ts` and `mcp/tools-core.ts`, whose headers
    // explain the condition-7 ruling by naming the hook the provider answers.
    // A fifth would mean some other module had started handing out
    // registration, which is the surface `main.ts`'s WeakMaps exist to keep to
    // one place. Prose counts here deliberately: the scan does not strip
    // comments, so a stale explanation is caught by the same pin as a real
    // call, and both want a reviewer's eye.
    const naming = [...readSrc()]
      .filter(([, source]) => /registerWriteObserver|registerSessionRefusal/.test(source))
      .map(([path]) => path)
      .sort();
    assert.deepEqual(naming, [
      "src/kernel/sessions/session.ts",
      "src/main.ts",
      "src/mcp/seam.ts",
      "src/mcp/tools-core.ts",
    ]);
  });
});
