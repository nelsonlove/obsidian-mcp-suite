/**
 * spawn.test.mjs — the two subprocess primitives and the accept-fence scan,
 * published into core at the suite split's mutating tier.
 *
 * These are thin, and that is exactly why they are pinned HERE rather than left
 * to their callers' suites. All three used to live in the host and now have
 * callers in two different plugins: the host's `claude`/`obsidian` spawn sites
 * and the `vault-fileclass` satellite's CLI spawn, and the host's `obsidian_cli`
 * template guard and the `vault-jd-scaffold` satellite's template apply. A
 * forked copy of `spawnEnv` fails only on machines whose PATH happens to lack
 * the extra dirs — silently, and not on the machine that forked it — and a
 * second copy of an accept predicate is how one vault gets two definitions of
 * "accepted". One copy, pinned once.
 *
 * The DEEP behavioural coverage of `scanForAcceptFence` (BOM, CRLF, embedded
 * fences, unparseable blocks, declared protected properties) stays in the
 * host's tests/cli-tools.test.mjs, which reaches it through the host's
 * re-export. What this file pins is that the published contract is reachable,
 * has the shape callers depend on, and still refuses the case it exists for.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnEnv, findBinary, findObsidianBinary, EXTRA_BIN_DIRS } from "../src/spawn.ts";
import { scanForAcceptFence } from "../src/accept-scan.ts";

describe("spawnEnv", () => {
  test("appends the extra bin dirs to a minimal PATH, preserving order", () => {
    const env = spawnEnv({ HOME: "/h", PATH: "/usr/bin:/bin" });
    assert.equal(env.PATH, ["/usr/bin:/bin", ...EXTRA_BIN_DIRS].join(":"));
    assert.equal(env.HOME, "/h", "the base env is carried through");
  });

  test("tolerates an absent PATH rather than emitting a leading separator", () => {
    const env = spawnEnv({ HOME: "/h" });
    assert.equal(env.PATH, EXTRA_BIN_DIRS.join(":"));
  });

  test("does not mutate the base env", () => {
    const base = { PATH: "/usr/bin" };
    spawnEnv(base);
    assert.equal(base.PATH, "/usr/bin");
  });
});

describe("findBinary", () => {
  test("returns the first candidate the probe accepts", () => {
    assert.equal(findBinary(["/a", "/b", "/c"], (p) => p === "/b"), "/b");
  });
  test("returns null when none is accepted", () => {
    assert.equal(findBinary(["/a", "/b"], () => false), null);
  });
  test("probes in order and stops at the first hit", () => {
    const seen = [];
    findBinary(["/a", "/b", "/c"], (p) => (seen.push(p), p === "/b"));
    assert.deepEqual(seen, ["/a", "/b"]);
  });
});

describe("findObsidianBinary", () => {
  test("probes the macOS install targets plus /usr/bin, in that order", () => {
    const seen = [];
    findObsidianBinary({ fileExists: (p) => (seen.push(p), false) });
    assert.deepEqual(seen, ["/usr/local/bin/obsidian", "/opt/homebrew/bin/obsidian", "/usr/bin/obsidian"]);
  });
  test("candidates are overridable, and a hit is returned", () => {
    assert.equal(findObsidianBinary({ candidates: ["/x/obsidian"], fileExists: () => true }), "/x/obsidian");
  });
});

describe("scanForAcceptFence — the published contract, not its full behaviour", () => {
  const parseYaml = (block) =>
    Object.fromEntries(
      block
        .split("\n")
        .filter((l) => l.includes(":"))
        .map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]),
    );

  test("refuses a leading fence asserting acceptance", () => {
    const reason = scanForAcceptFence("---\nacceptance-status: accepted\n---\nbody", parseYaml);
    assert.ok(reason, "an accepted leading fence must be refused");
  });

  test("refuses an EMBEDDED fence too — the broader sweep, not just the recognizer", () => {
    const reason = scanForAcceptFence("intro\n\n---\naccepted-by: someone\n---\ntail", parseYaml);
    assert.ok(reason, "an accepted fence anywhere in the content must be refused");
  });

  test("allows ordinary content and the agent-writable proposed value", () => {
    assert.equal(scanForAcceptFence("just prose, no fence at all", parseYaml), null);
    assert.equal(scanForAcceptFence("---\nacceptance-status: proposed\n---\nbody", parseYaml), null);
  });

  test("with NO parser it fails closed on the presence of a fence", () => {
    assert.ok(scanForAcceptFence("---\ntitle: harmless\n---\nbody"));
    assert.equal(scanForAcceptFence("no fence here"), null);
  });
});
