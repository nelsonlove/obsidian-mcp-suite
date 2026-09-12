/**
 * fileclass-module.test.mjs — the vaultmcp-fileclass satellite, headless.
 *
 * The exec layer, the plugin-presence probe, the vault name and the binary are
 * all INJECTED, so the whole surface is testable without a live Obsidian or a
 * `fileclass` CLI:
 *   • findFileclassBinary        — candidate probing;
 *   • buildFileclassArgs         — argv construction (vault pinned, --json, flags);
 *   • fileclassSetAcceptRefusal  — the accept-forbidden guard on a field-write;
 *   • buildFileclassTools        — the double gate, the read/write split, the
 *                                  accept refusal, the set_where dry-run
 *                                  default, the re-applied schema bounds, the
 *                                  backslash refusal, and --json parsing;
 *   • settings + adoption        — the one-shot latch and its three rules;
 *   • publication                — what an agent actually sees on the wire.
 *
 * The suite runs the handlers THROUGH `tests/host-shim.mjs`, which reproduces
 * the three things the host does to a published tool — the
 * `<sanitized id>_<bare name>` naming, the ok()/fail() envelopes including the
 * coded rendering, and the annotations it derives from an UNTRUSTED `readOnly`
 * claim — so the assertions are about the envelopes an agent sees rather than
 * raw return values.
 *
 * NOT covered here (un-headless): the live subprocess, and the
 * `app.plugins.plugins.fileclass` / `app.vault.getName()` reads in
 * src/obsidian-source.ts. Verify those against a running Obsidian.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  findFileclassBinary,
  buildFileclassArgs,
  fileclassSetAcceptRefusal,
  allowlistRefusal,
  buildFileclassTools,
  FILECLASS_PLUGIN_ID,
} from "../src/tools.ts";
import {
  DEFAULT_PLUGIN_SETTINGS,
  DEFAULT_FILECLASS_CONFIG,
  ADOPTABLE_KEYS,
  FILECLASS_FIELDS,
  adoptHostConfig,
  settingsOf,
  fileclassConfigOf,
  validateFileclassConfig,
} from "../src/settings.ts";
import { isVisible } from "@vault-mcp/core";
import { publishInto, OWNER, HOST_PATH_KEYS, sanitizeOwnerId } from "./host-shim.mjs";

// ── findFileclassBinary ──────────────────────────────────────────────────────

describe("findFileclassBinary", () => {
  test("returns the first existing candidate", () => {
    const bin = findFileclassBinary({
      candidates: ["/a/fileclass", "/b/fileclass"],
      fileExists: (p) => p === "/b/fileclass",
    });
    assert.equal(bin, "/b/fileclass");
  });
  test("returns null when nothing exists", () => {
    assert.equal(findFileclassBinary({ candidates: ["/a"], fileExists: () => false }), null);
  });
  test("default candidates include the user-bin install paths (home-expanded)", () => {
    const seen = [];
    findFileclassBinary({ homedir: "/Users/x", fileExists: (p) => (seen.push(p), false) });
    assert.ok(seen.includes("/Users/x/.local/bin/fileclass"));
    assert.ok(seen.includes("/Users/x/.npm-global/bin/fileclass"));
    assert.ok(seen.includes("/usr/local/bin/fileclass"));
  });
});

// ── buildFileclassArgs ───────────────────────────────────────────────────────

describe("buildFileclassArgs", () => {
  test("appends --vault <name> and --json, vault pinned", () => {
    assert.deepEqual(buildFileclassArgs("My Vault", { command: "fileclasses" }), [
      "fileclasses",
      "--vault",
      "My Vault",
      "--json",
    ]);
  });
  test("positionals precede the flags", () => {
    assert.deepEqual(buildFileclassArgs("v", { command: "get", positionals: ["Books/Dune.md", "status"] }), [
      "get",
      "Books/Dune.md",
      "status",
      "--vault",
      "v",
      "--json",
    ]);
  });
  test("query flags: where / columns / limit in order", () => {
    assert.deepEqual(
      buildFileclassArgs("v", {
        command: "list",
        positionals: ["Book"],
        where: "status is unread",
        columns: "title,author",
        limit: 20,
      }),
      ["list", "Book", "--where", "status is unread", "--columns", "title,author", "--limit", "20", "--vault", "v", "--json"],
    );
  });
  test("validate --fileclass", () => {
    assert.deepEqual(buildFileclassArgs("v", { command: "validate", fileclass: "Book" }), [
      "validate",
      "--fileclass",
      "Book",
      "--vault",
      "v",
      "--json",
    ]);
  });
  test("set-where appends --apply only when apply:true", () => {
    assert.deepEqual(
      buildFileclassArgs("v", {
        command: "set-where",
        positionals: ["Book", "status", "to read"],
        where: "status isEmpty",
        apply: true,
      }),
      ["set-where", "Book", "status", "to read", "--where", "status isEmpty", "--apply", "--vault", "v", "--json"],
    );
    assert.deepEqual(
      buildFileclassArgs("v", { command: "set-where", positionals: ["Book", "status", "to read"], apply: false }),
      ["set-where", "Book", "status", "to read", "--vault", "v", "--json"],
    );
  });
  test("empty where/columns/fileclass are omitted", () => {
    assert.deepEqual(buildFileclassArgs("v", { command: "list", positionals: ["Book"], where: "", columns: "" }), [
      "list",
      "Book",
      "--vault",
      "v",
      "--json",
    ]);
  });
  test("rejects an unknown command", () => {
    assert.throws(() => buildFileclassArgs("v", { command: "rm -rf" }), /unknown fileclass command/);
    assert.throws(() => buildFileclassArgs("v", { command: "eval" }), /unknown fileclass command/);
  });
});

// ── fileclassSetAcceptRefusal (the accept-forbidden guard) ───────────────────

describe("fileclassSetAcceptRefusal", () => {
  test("refuses acceptance-status set to an accepted value", () => {
    assert.ok(fileclassSetAcceptRefusal("acceptance-status", "accepted"));
  });
  test("refuses an accepted-family KEY whatever the value", () => {
    assert.ok(fileclassSetAcceptRefusal("accepted", "true"));
    assert.ok(fileclassSetAcceptRefusal("accepted-by", "Nelson"));
    assert.ok(fileclassSetAcceptRefusal("accepted-on", "2026-01-01"));
  });
  test("allows a field literally named 'status' set to 'accepted' (not the acceptance field)", () => {
    assert.equal(fileclassSetAcceptRefusal("status", "accepted"), null);
  });
  test("allows acceptance-status: proposed (the agent-writable value)", () => {
    assert.equal(fileclassSetAcceptRefusal("acceptance-status", "proposed"), null);
  });
  test("allows an ordinary field write", () => {
    assert.equal(fileclassSetAcceptRefusal("rating", 5), null);
  });
  test("a numeric/boolean value cannot dodge the check by type (coerced to string)", () => {
    assert.equal(fileclassSetAcceptRefusal("count", 3), null);
    assert.equal(fileclassSetAcceptRefusal("done", true), null);
  });
});

// ── the double gate ─────────────────────────────────────────────────────────

const RO_NAMES = ["list", "schema", "explain", "query", "get", "validate"];
const RW_NAMES = ["set", "set_where"];
const ALL_NAMES = [...RO_NAMES, ...RW_NAMES];

function ctxWith(overrides = {}) {
  const { execResult, ...rest } = overrides;
  return {
    config: () => ({ ...DEFAULT_FILECLASS_CONFIG }),
    present: () => true,
    vaultName: () => "V",
    binary: "/usr/local/bin/fileclass",
    obsidianBinary: null,
    exec: async () => execResult ?? { exitCode: 0, stdout: "{}", stderr: "", timedOut: false },
    ...rest,
  };
}

describe("buildFileclassTools: the double gate", () => {
  test("Fileclass plugin ABSENT ⇒ publishes nothing", () => {
    assert.deepEqual(buildFileclassTools(ctxWith({ present: () => false })), []);
  });
  test("binary ABSENT ⇒ publishes nothing (even with the plugin present)", () => {
    assert.deepEqual(buildFileclassTools(ctxWith({ binary: null })), []);
  });
  test("plugin + binary present ⇒ eight specs with the right read/write split", () => {
    const specs = buildFileclassTools(ctxWith());
    assert.deepEqual(specs.map((s) => s.name), ALL_NAMES);
    for (const s of specs) {
      const expected = RO_NAMES.includes(s.name);
      assert.equal(s.readOnly, expected, `${s.name} readOnly`);
    }
  });
  test("config.binaryPath overrides the probe (binary undefined ⇒ resolve from config)", () => {
    const specs = buildFileclassTools(
      ctxWith({ binary: undefined, config: () => ({ binaryPath: "/custom/fileclass" }) }),
    );
    assert.equal(specs.length, 8);
  });
  test("a blank configured binaryPath falls through to the probe, it is not treated as a path", () => {
    // The point here is the TRIM: a whitespace-only `binaryPath` must not read
    // as a configured path. With the probe standing in as `binary: null`, a
    // blank-but-present config value must still leave the surface unpublished.
    const specs = buildFileclassTools(ctxWith({ binary: null, config: () => ({ binaryPath: "   " }) }));
    assert.deepEqual(specs, []);
  });
  test("the Fileclass plugin id is 'fileclass'", () => {
    assert.equal(FILECLASS_PLUGIN_ID, "fileclass");
  });
});

// ── handler behaviour, through the host shim ────────────────────────────────

function mounted(overrides = {}) {
  const calls = [];
  const exec = async (bin, args, timeoutMs) => {
    calls.push({ bin, args, timeoutMs });
    return (
      overrides.execResult ?? { exitCode: 0, stdout: JSON.stringify({ ok: true }), stderr: "", timedOut: false }
    );
  };
  const specs = buildFileclassTools(ctxWith({ ...overrides, exec }));
  const { tools } = publishInto(specs, { trusted: overrides.trusted ?? false });
  return { tools, calls, specs };
}

const call = (tools, bare, args = {}) => tools.get(`${OWNER}_${bare}`).handler(args);

describe("handlers", () => {
  test("list parses --json stdout into result and reports succeeded", async () => {
    const { tools, calls } = mounted({
      execResult: { exitCode: 0, stdout: '[{"name":"Book"}]', stderr: "", timedOut: false },
    });
    const res = await call(tools, "list");
    assert.equal(res.isError, undefined);
    assert.equal(res.structuredContent.succeeded, true);
    assert.deepEqual(res.structuredContent.result, [{ name: "Book" }]);
    assert.deepEqual(calls[0].args, ["fileclasses", "--vault", "V", "--json"]);
    assert.equal(calls[0].timeoutMs, 30_000);
  });

  test("validate treats exit 1 (violations) as a successful run, not a failure", async () => {
    const { tools } = mounted({
      execResult: { exitCode: 1, stdout: '{"violations":[{"path":"a.md"}]}', stderr: "", timedOut: false },
    });
    const res = await call(tools, "validate");
    assert.equal(res.isError, undefined);
    assert.equal(res.structuredContent.succeeded, true);
    assert.equal(res.structuredContent.exit_code, 1);
    assert.deepEqual(res.structuredContent.result.violations, [{ path: "a.md" }]);
  });

  test("THE ENVELOPE THAT CHANGED: a real failure exit returns succeeded:false, NOT isError", async () => {
    // The module used okError() — ok()'s shape plus isError: true — so the
    // structured report survived a total failure. The publishing boundary has no
    // okError (a returned object is ok(data), a throw is fail(err)), and
    // throwing would flatten the report to text. So a failed CLI run is a
    // SUCCESSFUL MCP call carrying a report that says it failed. This test is
    // the pin on that trade; if it ever flips, README/CLAUDE.md must flip too.
    const { tools } = mounted({ execResult: { exitCode: 2, stdout: "", stderr: "boom", timedOut: false } });
    const res = await call(tools, "validate");
    assert.equal(res.isError, undefined, "no error envelope");
    assert.equal(res.structuredContent.succeeded, false);
    assert.equal(res.structuredContent.exit_code, 2);
    assert.equal(res.structuredContent.stderr, "boom");
  });

  test("a timed-out run carries the un-cancellable-write note", async () => {
    const { tools } = mounted({ execResult: { exitCode: null, stdout: "", stderr: "", timedOut: true } });
    const res = await call(tools, "list");
    assert.equal(res.structuredContent.succeeded, false);
    assert.match(res.structuredContent.note, /does not cancel an in-app write/);
  });

  test("non-JSON stdout falls back to a raw `stdout` field", async () => {
    const { tools } = mounted({ execResult: { exitCode: 0, stdout: "not json at all", stderr: "", timedOut: false } });
    const res = await call(tools, "list");
    assert.equal(res.structuredContent.result, undefined);
    assert.equal(res.structuredContent.stdout, "not json at all");
  });

  test("set refuses an acceptance write BEFORE exec (nothing runs)", async () => {
    const { tools, calls } = mounted();
    const res = await call(tools, "set", { note_path: "a.md", field: "acceptance-status", value: "accepted" });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /^Error \[accept_forbidden\]/);
    assert.equal(calls.length, 0, "the CLI must not run for a refused write");
  });

  test("set runs a clean write", async () => {
    const { tools, calls } = mounted();
    const res = await call(tools, "set", { note_path: "Books/Dune.md", field: "status", value: "read" });
    assert.equal(res.isError, undefined);
    assert.deepEqual(calls[0].args, ["set", "Books/Dune.md", "status", "read", "--vault", "V", "--json"]);
  });

  test("set_where is DRY-RUN by default (no --apply)", async () => {
    const { tools, calls } = mounted();
    await call(tools, "set_where", { fileclass: "Book", field: "status", value: "to read", where: "status isEmpty" });
    assert.ok(!calls[0].args.includes("--apply"), "dry-run must not pass --apply");
  });

  test("set_where passes --apply when apply:true", async () => {
    const { tools, calls } = mounted();
    await call(tools, "set_where", { fileclass: "Book", field: "status", value: "to read", apply: true });
    assert.ok(calls[0].args.includes("--apply"));
  });

  test("set_where also honors the accept guard", async () => {
    const { tools, calls } = mounted();
    const res = await call(tools, "set_where", { fileclass: "Book", field: "accepted-by", value: "x", apply: true });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /^Error \[accept_forbidden\]/);
    assert.equal(calls.length, 0);
  });

  test("explain/get/set refuse a backslash in the note argument before anything runs", async () => {
    // The argument's SPELLING differs by tool since round 2 (`note` on the two
    // reads, `note_path` on the write), but the refusal is the same check and
    // the message names whichever argument the caller passed.
    const { tools, calls } = mounted();
    for (const [bare, args] of [
      ["explain", { note: "Books\\..\\..\\secret.md" }],
      ["get", { note: "Books\\Dune.md", field: "status" }],
      ["set", { note_path: "Books\\Dune.md", field: "status", value: "read" }],
    ]) {
      const res = await call(tools, bare, args);
      assert.equal(res.isError, true, bare);
      assert.match(res.content[0].text, /^Error \[invalid_path\]/, bare);
    }
    assert.equal(calls.length, 0);
  });

  test("re-applied schema bounds: a missing/blank required string is refused", async () => {
    const { tools, calls } = mounted();
    for (const [bare, args] of [
      ["schema", {}],
      ["schema", { fileclass: "   " }],
      ["explain", {}],
      ["get", { note: "a.md" }],
      ["set", { note_path: "a.md", field: "status" }],
    ]) {
      const res = await call(tools, bare, args);
      assert.equal(res.isError, true, `${bare} ${JSON.stringify(args)}`);
    }
    assert.equal(calls.length, 0);
  });

  test("re-applied schema bounds: timeout_ms range and limit are enforced in the handler", async () => {
    const { tools, calls } = mounted();
    for (const args of [{ timeout_ms: 10 }, { timeout_ms: 999_999 }, { timeout_ms: 1.5 }, { timeout_ms: "30000" }]) {
      const res = await call(tools, "list", args);
      assert.equal(res.isError, true, JSON.stringify(args));
      assert.match(res.content[0].text, /^Error \[invalid_argument\]/);
    }
    const bad = await call(tools, "query", { fileclass: "Book", limit: 0 });
    assert.equal(bad.isError, true);
    assert.equal(calls.length, 0);
    // A valid timeout DOES reach exec.
    await call(tools, "list", { timeout_ms: 5_000 });
    assert.equal(calls[0].timeoutMs, 5_000);
  });

  test("value must be string|number|boolean (the union the round trip does not carry)", async () => {
    const { tools, calls } = mounted();
    const res = await call(tools, "set", { note_path: "a.md", field: "tags", value: ["a", "b"] });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /^Error \[invalid_argument\]/);
    assert.equal(calls.length, 0);
  });

  test("the vault name is read PER CALL, not captured at build time", async () => {
    let name = "First";
    const calls = [];
    const specs = buildFileclassTools(
      ctxWith({
        vaultName: () => name,
        exec: async (bin, args) => (calls.push(args), { exitCode: 0, stdout: "{}", stderr: "", timedOut: false }),
      }),
    );
    const { tools } = publishInto(specs);
    await call(tools, "list");
    name = "Second";
    await call(tools, "list");
    assert.deepEqual(calls[0], ["fileclasses", "--vault", "First", "--json"]);
    assert.deepEqual(calls[1], ["fileclasses", "--vault", "Second", "--json"]);
  });
});

// ── the dormant allowlist seam ──────────────────────────────────────────────

describe("the allowlist seam is DORMANT, and is kept so it cannot rot", () => {
  test("nothing supplies ctx.getSettings in the shipped configuration ⇒ no refusal", async () => {
    const { tools, calls } = mounted();
    const res = await call(tools, "list");
    assert.equal(res.isError, undefined);
    assert.equal(calls.length, 1);
  });

  test("supplied, it refuses the WHOLE surface — the module's own posture", async () => {
    const { tools, calls } = mounted({ getSettings: () => ({ allowlist: ["Projects"] }) });
    const argsFor = {
      list: {},
      schema: { fileclass: "Book" },
      explain: { note: "Projects/a.md" },
      query: { fileclass: "Book" },
      get: { note: "Projects/a.md", field: "status" },
      validate: {},
      set: { note_path: "Projects/a.md", field: "status", value: "read" },
      set_where: { fileclass: "Book", field: "status", value: "read" },
    };
    for (const bare of ALL_NAMES) {
      const res = await call(tools, bare, argsFor[bare]);
      assert.equal(res.isError, true, `${bare} should refuse under an allowlist`);
      assert.match(res.content[0].text, /^Error \[out_of_allowlist\]/, `${bare} refusal should be coded`);
    }
    assert.equal(calls.length, 0, "no CLI call while an allowlist is active");
  });

  test("the seam is defined over core's isVisible-shaped GuardSettings, not a local re-implementation", () => {
    // The package imports `isVisible` from @vault-mcp/core rather than
    // re-implementing it; this asserts the published contract is reachable and
    // behaves, so a core change surfaces here rather than silently.
    assert.equal(isVisible("Projects/a.md", { allowlist: ["Projects"] }), true);
    assert.equal(isVisible("Archive/a.md", { allowlist: ["Projects"] }), false);
    assert.equal(allowlistRefusal({ allowlist: [] }), null);
    assert.equal(allowlistRefusal(undefined), null);
    assert.equal(allowlistRefusal({ allowlist: ["x"] }).code, "out_of_allowlist");
  });
});

// ── publication: what an agent actually sees ────────────────────────────────

describe("publication", () => {
  test("the wire names are vaultmcp_fileclass_* with the bare `fileclass_` prefix stripped", () => {
    const { tools } = mounted();
    assert.equal(OWNER, "vaultmcp_fileclass");
    assert.deepEqual(
      [...tools.keys()],
      [
        "vaultmcp_fileclass_list",
        "vaultmcp_fileclass_schema",
        "vaultmcp_fileclass_explain",
        "vaultmcp_fileclass_query",
        "vaultmcp_fileclass_get",
        "vaultmcp_fileclass_validate",
        "vaultmcp_fileclass_set",
        "vaultmcp_fileclass_set_where",
      ],
    );
    // The reversal named in CLAUDE.md is the plugin id and nothing else: the
    // specs carry BARE names, and the prefix is the host's.
    assert.equal(sanitizeOwnerId("fileclass"), "fileclass");
  });

  test("the MUTATING single-note tool is path-keyed (kernel-visible); every read stays pathless (F3 refuse-all)", () => {
    // THE POSTURE, in its round-2 form, after three generations of spelling.
    //
    // The extraction went all-pathless (`path` → `note_path`) for F3's
    // refuse-all under an allowlist. ROUND 1 found that silently removed the
    // single-note WRITE from collectPaths, which ALSO feeds record immutability,
    // the lock consult and the journal target — none of them allowlist-gated —
    // so `vaultmcp_fileclass_set` could field-write a `record: true` note the
    // kernel used to refuse, on every vault. The host therefore recognizes
    // `note_path`.
    //
    // ROUND 2 narrowed that to the tools it was ever about. Kernel visibility is
    // a MUTATING concern: the record guard, the lock consult and the journal
    // target all bind at the mutating dequeue, so a READ gains nothing from
    // being path-keyed and loses F3's refusal. `explain` and `get` answer with
    // inheritance resolved from fileClass definitions a scoped session cannot
    // see, so a per-path-scoped answer would be a path oracle. Their argument is
    // `note`, which is NOT a host key, and F3 refuses them outright under an
    // allowlist at zero kernel cost. `set` keeps `note_path`.
    //
    // HOST_PATH_KEYS is a SNAPSHOT (review aid); the live pins are the host's
    // guard.test.mjs collectPaths tests.
    const { specs } = mounted();
    const KEYED = ["set"];
    for (const spec of specs) {
      const keys = Object.keys(spec.inputSchema ?? {}).filter((a) => HOST_PATH_KEYS.includes(a));
      if (KEYED.includes(spec.name)) {
        assert.deepEqual(keys, ["note_path"], `${spec.name} must carry exactly note_path`);
      } else {
        assert.deepEqual(keys, [], `${spec.name} must stay pathless — F3 is its allowlist posture`);
      }
    }
    // The two reads name a note and must do so under the NON-key spelling —
    // without this, deleting the argument entirely would also pass above.
    const argsOf = (name) => Object.keys(specs.find((s) => s.name === name).inputSchema ?? {});
    assert.ok(argsOf("explain").includes("note"), "explain still names a note, as `note`");
    assert.ok(argsOf("get").includes("note"), "get still names a note, as `note`");
    // Vacuity: the snapshot really does contain the spellings this test avoids.
    assert.ok(HOST_PATH_KEYS.includes("path") && HOST_PATH_KEYS.includes("note_path"));
    assert.ok(!HOST_PATH_KEYS.includes("note"), "`note` must NOT be a host path key — the read posture rides on it");
  });

  test("an UNTRUSTED readOnly claim makes every tool mutating to the host", () => {
    const { tools } = mounted();
    for (const [name, t] of tools) {
      assert.equal(t.def.annotations.readOnlyHint, false, `${name} should register as mutating`);
    }
  });

  test("trusting the publisher restores the read tools' read-only hint (and nothing else)", () => {
    const { tools } = mounted({ trusted: true });
    for (const bare of RO_NAMES) {
      assert.equal(tools.get(`${OWNER}_${bare}`).def.annotations.readOnlyHint, true, bare);
    }
    for (const bare of RW_NAMES) {
      assert.equal(tools.get(`${OWNER}_${bare}`).def.annotations.readOnlyHint, false, bare);
    }
  });

  test("no shipped string points at modules.fileclass.config.*, and none promises a host toggle", () => {
    const { specs } = mounted();
    const strings = [
      ...specs.map((s) => s.description),
      ...FILECLASS_FIELDS.map((f) => `${f.label} ${f.help}`),
    ];
    for (const s of strings) {
      assert.ok(!/modules\.fileclass/.test(s), `stale settings path in: ${s.slice(0, 80)}…`);
      assert.ok(!/\bfileclass_(list|schema|explain|query|get|validate|set)\b/.test(s), `stale tool name in: ${s.slice(0, 80)}…`);
    }
  });

  test("every description tells an agent to read `succeeded` and states the allowlist block", () => {
    const { specs } = mounted();
    for (const s of specs) {
      assert.match(s.description, /succeeded/, s.name);
      assert.match(s.description, /path allowlist/, s.name);
    }
  });
});

// ── settings + adoption ─────────────────────────────────────────────────────

describe("settings and one-shot adoption", () => {
  test("ADOPTABLE_KEYS is exactly the host module's declared config field set", () => {
    assert.deepEqual([...ADOPTABLE_KEYS], ["binaryPath"]);
    assert.deepEqual(FILECLASS_FIELDS.map((f) => f.key), ["binaryPath"]);
  });

  test("there is NO second adoption — checked, not assumed", () => {
    // Cross-session needed one because it had live operational state outside
    // data.json (its receipt file). This surface is a subprocess proxy: no state
    // file, no cache, nothing it ever wrote. The absence is a finding, so it is
    // pinned rather than left implicit.
    assert.deepEqual(Object.keys(DEFAULT_PLUGIN_SETTINGS).sort(), ["adoptedFromHost", "config"]);
  });

  test("adopts the host's value and latches", () => {
    const next = adoptHostConfig(DEFAULT_PLUGIN_SETTINGS, {
      modules: { fileclass: { config: { binaryPath: "/opt/fileclass" } } },
    });
    assert.deepEqual(next, { config: { binaryPath: "/opt/fileclass" }, adoptedFromHost: true });
  });

  test("the satellite's own value WINS (adoption fills gaps only)", () => {
    const current = { config: { binaryPath: "/mine" }, adoptedFromHost: false };
    const next = adoptHostConfig(current, { modules: { fileclass: { config: { binaryPath: "/theirs" } } } });
    assert.equal(next.config.binaryPath, "/mine");
    assert.equal(next.adoptedFromHost, true);
  });

  test("an already-latched settings bag adopts nothing, ever again", () => {
    const current = { config: {}, adoptedFromHost: true };
    assert.equal(adoptHostConfig(current, { modules: { fileclass: { config: { binaryPath: "/x" } } } }), null);
  });

  test("host ABSENT or NOT READY holds the latch OPEN (undefined settings is not 'empty settings')", () => {
    assert.equal(adoptHostConfig(DEFAULT_PLUGIN_SETTINGS, undefined), null);
    assert.equal(adoptHostConfig(DEFAULT_PLUGIN_SETTINGS, null), null);
    assert.equal(adoptHostConfig(DEFAULT_PLUGIN_SETTINGS, "not an object"), null);
  });

  test("a host present with NO fileclass config still latches (asked and answered)", () => {
    const next = adoptHostConfig(DEFAULT_PLUGIN_SETTINGS, { modules: {} });
    assert.deepEqual(next, { config: {}, adoptedFromHost: true });
  });

  test("an unknown key in the host's record is NOT copied", () => {
    const next = adoptHostConfig(DEFAULT_PLUGIN_SETTINGS, {
      modules: { fileclass: { config: { binaryPath: "/a", vaultName: "someone else's mistake" } } },
    });
    assert.deepEqual(next.config, { binaryPath: "/a" });
  });

  test("a failed persist must leave the latch open — the shape main.ts relies on", async () => {
    // main.ts only assigns `this.settings = adopted` AFTER saveData resolves, so
    // a throwing save leaves the in-memory latch false and the next load asks
    // again. This drives that exact sequence over a fake plugin.
    let saved = null;
    const fake = {
      settings: { ...DEFAULT_PLUGIN_SETTINGS },
      async saveData(v) {
        saved = v;
        throw new Error("disk full");
      },
    };
    const adopted = adoptHostConfig(fake.settings, { modules: { fileclass: { config: { binaryPath: "/x" } } } });
    try {
      await fake.saveData(adopted);
      fake.settings = adopted;
    } catch {
      /* main.ts returns here */
    }
    assert.equal(fake.settings.adoptedFromHost, false, "latch must stay open after a failed persist");
    assert.equal(saved.adoptedFromHost, true, "the value it TRIED to write was the latched one");
  });

  test("settingsOf degrades a corrupt data.json to the defaults", () => {
    assert.deepEqual(settingsOf(null), DEFAULT_PLUGIN_SETTINGS);
    assert.deepEqual(settingsOf("garbage"), DEFAULT_PLUGIN_SETTINGS);
    assert.deepEqual(settingsOf({ config: [] }), DEFAULT_PLUGIN_SETTINGS);
    assert.deepEqual(settingsOf({ config: { binaryPath: "/x" }, adoptedFromHost: true }), {
      config: { binaryPath: "/x" },
      adoptedFromHost: true,
    });
  });

  test("fileclassConfigOf layers overrides over the shipped defaults", () => {
    assert.deepEqual(fileclassConfigOf({}), { binaryPath: "" });
    assert.deepEqual(fileclassConfigOf({ binaryPath: "/x" }), { binaryPath: "/x" });
  });

  test("validation is LOUD, never coercing", () => {
    assert.deepEqual(validateFileclassConfig({}), []);
    assert.deepEqual(validateFileclassConfig({ binaryPath: "" }), []);
    assert.equal(validateFileclassConfig({ binaryPath: 7 }).length, 1);
  });
});
