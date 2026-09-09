// host-lookup.test.mjs — "which loaded plugin is the Vault MCP host?"
//
// The bug this pins (found by the S3c release review, fixed 2026-09-08): the
// lookup matched on BARE PRESENCE of `app.plugins.plugins[id]` over
// `["vault-mcp", "governor"]`. Post-split the `governor` entry IS this provider,
// so the provider found ITSELF, `hostPluginDir()` could never return null, the
// no-host refusal Notice in `main.ts` was dead code, and with the host absent the
// review pane mounted on `<provider dir>/journal` — the FROZEN pre-split journal
// the host copied out at adoption — rendering a stale pending queue as current.
//
// The fix is the discriminator `vault-mcp-api`'s `getApi` already uses: a plugin
// counts as the host only if it exposes the plugin-to-plugin `api` object.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findHostPlugin, hostPluginDir, HOST_PLUGIN_IDS } from "../src/host-lookup.ts";

const CONFIG_DIR = ".obsidian";
/** What the host looks like in the plugins map: an api object, and a dir. */
const host = (dir = ".obsidian/plugins/vault-mcp") => ({ api: { apiVersion: 1, registerTools() {} }, manifest: { dir } });
/** What THIS plugin looks like in the plugins map: no api at all. */
const provider = (dir = ".obsidian/plugins/governor") => ({ manifest: { dir } });

test("the id list is current-first, matching vault-mcp-api's order", () => {
  assert.deepEqual([...HOST_PLUGIN_IDS], ["vault-mcp", "governor"]);
});

// ── BRANCH 1: the host is present, via its api ───────────────────────────────

test("finds the post-split host under `vault-mcp` and reports its own dir", () => {
  const plugins = { "vault-mcp": host(), governor: provider() };
  assert.equal(hostPluginDir(plugins, CONFIG_DIR), ".obsidian/plugins/vault-mcp");
  assert.equal(findHostPlugin(plugins).id, "vault-mcp");
});

test("finds a pre-split host still living under the `governor` id", () => {
  // The rollback vault: the single-plugin build is reinstalled under `governor`
  // and IS a host, because it exposes the api. This provider is not loaded.
  const plugins = { governor: host(".obsidian/plugins/governor") };
  assert.equal(hostPluginDir(plugins, CONFIG_DIR), ".obsidian/plugins/governor");
  assert.equal(findHostPlugin(plugins).id, "governor");
});

test("a host reporting no manifest dir falls back to the id-derived path", () => {
  const plugins = { "vault-mcp": { api: { apiVersion: 1 } } };
  assert.equal(hostPluginDir(plugins, CONFIG_DIR), ".obsidian/plugins/vault-mcp");
});

test("the CURRENT host id wins when a stale pre-split host is also loaded", () => {
  const plugins = {
    governor: host(".obsidian/plugins/governor"),
    "vault-mcp": host(".obsidian/plugins/vault-mcp"),
  };
  assert.equal(hostPluginDir(plugins, CONFIG_DIR), ".obsidian/plugins/vault-mcp");
});

test("apiVersion is deliberately NOT checked — a future host still has a journal", () => {
  const plugins = { "vault-mcp": { api: { apiVersion: 2 }, manifest: { dir: "d" } } };
  assert.equal(hostPluginDir(plugins, CONFIG_DIR), "d");
});

// ── BRANCH 2: provider only ⇒ no host ⇒ the refusal is REACHABLE ─────────────

test("THIS PROVIDER ALONE IS NOT A HOST — the lookup returns null", () => {
  // The exact live case the review found: Governor enabled, Vault MCP not
  // installed or not enabled. Before the fix this returned the PROVIDER'S OWN
  // directory and the pane mounted on the frozen pre-split journal.
  const plugins = { governor: provider() };
  assert.equal(findHostPlugin(plugins), null);
  assert.equal(hostPluginDir(plugins, CONFIG_DIR), null);
});

test("an empty / absent plugins map is no host", () => {
  assert.equal(hostPluginDir({}, CONFIG_DIR), null);
  assert.equal(hostPluginDir(undefined, CONFIG_DIR), null);
});

test("a plugin under a host id with a falsy api does not count as the host", () => {
  for (const api of [undefined, null, 0, "", false]) {
    assert.equal(hostPluginDir({ "vault-mcp": { api, manifest: { dir: "d" } } }, CONFIG_DIR), null);
  }
});

test("the provider is skipped and the real host found, whichever order the map lists them", () => {
  const a = { governor: provider(), "vault-mcp": host() };
  const b = { "vault-mcp": host(), governor: provider() };
  assert.equal(hostPluginDir(a, CONFIG_DIR), ".obsidian/plugins/vault-mcp");
  assert.equal(hostPluginDir(b, CONFIG_DIR), ".obsidian/plugins/vault-mcp");
});

// ── The refusal the null branch exists to reach ──────────────────────────────
//
// `applyPaneMount` needs the Obsidian runtime, so the Notice itself is a live
// check (`docs/s3c-migration-plan.md` §8). What IS assertable here is the wiring:
// the mount path consults this lookup and refuses on null rather than mounting
// on whatever directory it got. Without the fix above that branch is unreachable
// code — this pins that it is still WIRED, and the tests above pin that it is now
// REACHED.
test("main.ts's pane mount refuses on a null host dir instead of mounting", () => {
  const src = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const mount = src.slice(src.indexOf("private async applyPaneMount"));
  assert.ok(/const hostDir = this\.hostPluginDir\(\);/.test(mount), "the mount path must consult hostPluginDir()");
  const refusal = mount.indexOf("if (hostDir === null)");
  const wiring = mount.indexOf("wireGovernance(");
  assert.ok(refusal > 0, "the null branch must exist");
  assert.ok(refusal < wiring, "the refusal must come BEFORE wireGovernance");
  assert.ok(/new Notice\(/.test(mount.slice(refusal, wiring)), "and it must say why, with a Notice");
  assert.ok(/return;/.test(mount.slice(refusal, wiring)), "and it must return without mounting");
});
