import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  selectVault,
  filterLive,
  noLiveMessage,
  staleRequestedMessage,
  connectFailMessage,
  resolveTarget,
  deadlineMessage,
  loadDiscoveryDir,
} from "../bridge/bridge.ts";

const A = { vault_name: "alpha", socket_path: "/a.sock" };
const B = { vault_name: "beta", socket_path: "/b.sock" };

test("selectVault: --vault flag wins", () => {
  assert.equal(selectVault([A, B], { flag: "beta" }).vault_name, "beta");
});
test("selectVault: env when no flag", () => {
  assert.equal(selectVault([A, B], { env: "alpha" }).vault_name, "alpha");
});
test("selectVault: single discovery auto-selected", () => {
  assert.equal(selectVault([A], {}).vault_name, "alpha");
});
test("selectVault: ambiguous throws", () => {
  assert.throws(() => selectVault([A, B], {}), /specify --vault/);
});
test("selectVault: unknown flag throws", () => {
  assert.throws(() => selectVault([A, B], { flag: "gamma" }), /no vault named/);
});
test("selectVault: empty gives actionable 'serving MCP' message", () => {
  assert.throws(() => selectVault([], {}), /serving MCP/);
});

test("filterLive keeps only discoveries whose socket exists", () => {
  const live = filterLive([A, B], (p) => p === "/a.sock");
  assert.deepEqual(live.map((d) => d.vault_name), ["alpha"]);
});
test("filterLive drops all when no sockets exist", () => {
  assert.equal(filterLive([A, B], () => false).length, 0);
});
test("filterLive treats an exists() throw as not-live", () => {
  assert.equal(filterLive([A], () => { throw new Error("boom"); }).length, 0);
});

test("noLiveMessage: stale discovery names the vault + plugin hint", () => {
  const m = noLiveMessage([A]);
  assert.match(m, /stale discovery for: alpha/);
  assert.match(m, /disabled or Obsidian is closed/);
});
test("noLiveMessage: no discovery gives serving-MCP hint", () => {
  assert.match(noLiveMessage([]), /no vault is currently serving MCP/);
});
test("staleRequestedMessage names the requested vault", () => {
  assert.match(staleRequestedMessage("beta"), /vault 'beta' has a discovery but no live socket/);
});
test("connectFailMessage names vault + socket path", () => {
  const m = connectFailMessage(A);
  assert.match(m, /can't connect to vault 'alpha'/);
  assert.match(m, /\/a\.sock/);
});

// --- resolveTarget: the retry-vs-fail-vs-connect decision ---
test("resolveTarget: single live vault is chosen", () => {
  assert.deepEqual(resolveTarget([A], undefined), { kind: "ok", chosen: A });
});
test("resolveTarget: none live yet is retryable (wait)", () => {
  assert.deepEqual(resolveTarget([], undefined), { kind: "wait" });
});
test("resolveTarget: multiple live + no pick is fatal (waiting can't disambiguate)", () => {
  const t = resolveTarget([A, B], undefined);
  assert.equal(t.kind, "fatal");
  assert.match(t.message, /multiple vaults open/);
});
test("resolveTarget: pinned vault present is chosen", () => {
  assert.deepEqual(resolveTarget([A, B], "beta"), { kind: "ok", chosen: B });
});
test("resolveTarget: pinned vault not live yet waits (even with others live)", () => {
  assert.deepEqual(resolveTarget([A], "beta"), { kind: "wait" });
});

// --- deadlineMessage: the diagnostic after the wait budget is spent ---
test("deadlineMessage: pinned + known but unreachable → stale-requested", () => {
  assert.match(deadlineMessage([B], "beta"), /vault 'beta' has a discovery but no live socket/);
});
test("deadlineMessage: pinned + never seen → no-vault-named + available list", () => {
  const m = deadlineMessage([A], "beta");
  assert.match(m, /no vault named "beta"/);
  assert.match(m, /available: alpha/);
});
test("deadlineMessage: single unreachable discovery → connect-fail names socket", () => {
  assert.match(deadlineMessage([A], undefined), /can't connect to vault 'alpha'/);
});
test("deadlineMessage: nothing discovered → serving-MCP hint", () => {
  assert.match(deadlineMessage([], undefined), /no vault is currently serving MCP/);
});

// ── discovery-dir merge: the `legacy: true` FLAG decides, never the directory ──
//
// The bridge reads BOTH `~/.claude/vault-mcp/` and `~/.claude/governor/`,
// because which of the two is canonical has flipped twice (`vault-mcp` before
// 0.12.0, `governor` until the suite split, `vault-mcp` again after it) and one
// shared bridge.mjs serves whichever vault loaded last. It used to skip flagged
// entries in ONE dir, hard-coded to the 0.12.0 era — which the split inverted,
// so post-split a single open vault was read twice (unflagged from the new
// canonical dir, flagged from the old one) and `resolveTarget` failed it as
// "multiple vaults open; specify --vault". Skipping flagged entries in EVERY
// dir is correct in every era: a flagged copy always has an unflagged twin.

function scratchDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `disco-${tag}-`));
}

function writeDisco(dir, name, body) {
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(body));
}

test("loadDiscoveryDir keeps unflagged entries", () => {
  const dir = scratchDir("plain");
  writeDisco(dir, "alpha", { vault_name: "alpha", socket_path: "/a.sock" });
  const got = loadDiscoveryDir(dir);
  assert.equal(got.length, 1);
  assert.equal(got[0].vault_name, "alpha");
});

test("loadDiscoveryDir skips `legacy: true` — whichever dir it is in", () => {
  const dir = scratchDir("legacy");
  writeDisco(dir, "alpha", { vault_name: "alpha", socket_path: "/a.sock", legacy: true });
  assert.deepEqual(loadDiscoveryDir(dir), []);
});

test("one vault publishing to both dirs resolves to ONE target, not 'multiple vaults open'", () => {
  // Exactly the post-split on-disk state: canonical unflagged in one dir, the
  // grace-period copy flagged in the other, both naming the SAME socket.
  const canonical = scratchDir("canon");
  const legacy = scratchDir("grace");
  const d = { vault_name: "alpha", socket_path: "/a.sock" };
  writeDisco(canonical, "alpha", d);
  writeDisco(legacy, "alpha", { ...d, legacy: true });

  const merged = [...loadDiscoveryDir(canonical), ...loadDiscoveryDir(legacy)];
  assert.equal(merged.length, 1, `one vault must read as one discovery: ${JSON.stringify(merged)}`);
  assert.deepEqual(resolveTarget(merged, undefined), { kind: "ok", chosen: merged[0] });
});

test("a vault running an OLDER plugin — unflagged in the other dir — is still seen", () => {
  // The compat case the two-dir read exists for: a 0.12.0-era plugin writes its
  // real discovery unflagged into `~/.claude/governor/`.
  const canonical = scratchDir("canon2");
  const legacy = scratchDir("grace2");
  writeDisco(legacy, "beta", { vault_name: "beta", socket_path: "/b.sock" });
  const merged = [...loadDiscoveryDir(canonical), ...loadDiscoveryDir(legacy)];
  assert.equal(merged.length, 1);
  assert.equal(merged[0].vault_name, "beta");
});

test("loadDiscoveryDir tolerates a missing dir and skips malformed json", () => {
  assert.deepEqual(loadDiscoveryDir(path.join(os.tmpdir(), "no-such-dir-xyzzy")), []);
  const dir = scratchDir("malformed");
  fs.writeFileSync(path.join(dir, "bad.json"), "{not json");
  writeDisco(dir, "good", { vault_name: "good", socket_path: "/g.sock" });
  const got = loadDiscoveryDir(dir);
  assert.equal(got.length, 1);
  assert.equal(got[0].vault_name, "good");
});
