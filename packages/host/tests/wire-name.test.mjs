/**
 * wire-name.test.mjs — the S3c WIRE RENAME (Nelson's ruling, 2026-09-09).
 *
 * The Claude Code MCP server registration moved back from `governor` to
 * `vault-mcp`, so the client-visible tool prefix is `mcp__vault-mcp__*` again.
 * The plugin id had already moved back at the split; this is the half the split
 * deliberately deferred.
 *
 * Three names are load-bearing and each is pinned here, in the place a rename
 * would have to change it:
 *
 *   1. the name `claude mcp add` REGISTERS (`MCP_SERVER_NAME`, and the argv
 *      built from it) — this is what becomes the tool prefix;
 *   2. the name the health probe ASKS ABOUT — which must be the new one alone,
 *      so a vault still carrying only the old entry reads as NOT registered;
 *   3. the name the server DECLARES at the `initialize` handshake
 *      (`serverInfo`).
 *
 * Every assertion is written against the literal string rather than against the
 * constant it came from, so changing the constant fails the test instead of
 * silently moving the goalposts with it.
 *
 * NOTE the prefix spelling: Claude Code does not sanitize a hyphen out of the
 * server name (`mcp__vault-mcp__obsidian_read_note` — the exact string this
 * machine's own `~/.claude/settings.local.json` still carries from the
 * pre-0.12.0 era), so the prefix is `mcp__vault-mcp__*`, not `mcp__vault_mcp__*`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MCP_SERVER_NAME,
  LEGACY_MCP_SERVER_NAME,
  registerArgs,
  claudeIsRegistered,
  claudeLegacyIsRegistered,
} from "../src/claude-cli.ts";
import { SERVER_INFO_NAME, serverInfo } from "../src/mcp/helpers.ts";

describe("1. the registered name", () => {
  test("MCP_SERVER_NAME is `vault-mcp`; the retired name is kept only as a label", () => {
    assert.equal(MCP_SERVER_NAME, "vault-mcp");
    assert.equal(LEGACY_MCP_SERVER_NAME, "governor");
  });

  test("registerArgs registers the new name and never the old one", () => {
    const args = registerArgs("/p/bridge.mjs", "My Vault");
    // Position matters: `claude mcp add [flags] <name> -- <cmd>`.
    assert.equal(args[args.indexOf("user") + 1], "vault-mcp");
    assert.ok(!args.includes("governor"), `argv must not name the retired server: ${args.join(" ")}`);
  });
});

describe("2. the health probe, and the grace decision", () => {
  // The decision, stated rather than smuggled: the probe asks about the NEW
  // name ONLY. A `governor` entry keeps WORKING through the grace period — the
  // bridge resolves the socket from the discovery jsons, never from the
  // registration name — but it must not read as "registered", or a vault that
  // has not been re-registered at all would look migrated. The 0.12.0
  // dual-id pattern belongs to the state dirs, where silent continuity is the
  // goal; a registration name is an operator decision surface, so the
  // half-migrated state is DISCLOSED (`claudeLegacyIsRegistered`, surfaced in
  // the settings tab) instead of hidden behind a permissive probe.
  const fakeCli = (present) => async (_bin, args) => {
    assert.deepEqual(args.slice(0, 2), ["mcp", "get"]);
    if (present.includes(args[2])) return { stdout: "" };
    throw new Error(`No MCP server found with name: ${args[2]}`);
  };

  test("only the new entry present → registered yes, no legacy notice", async () => {
    const exec = fakeCli(["vault-mcp"]);
    assert.equal(await claudeIsRegistered("claude", { exec }), true);
    assert.equal(await claudeLegacyIsRegistered("claude", { exec }), false);
  });

  test("ONLY the old entry present → NOT registered (the half-migrated state is visible)", async () => {
    const exec = fakeCli(["governor"]);
    assert.equal(
      await claudeIsRegistered("claude", { exec }),
      false,
      "accepting the old name here would report a clean migration on a vault that never re-registered",
    );
    assert.equal(await claudeLegacyIsRegistered("claude", { exec }), true);
  });

  test("both present → registered, AND the stale entry is still disclosed", async () => {
    const exec = fakeCli(["vault-mcp", "governor"]);
    assert.equal(await claudeIsRegistered("claude", { exec }), true);
    assert.equal(await claudeLegacyIsRegistered("claude", { exec }), true);
  });

  test("neither present → both false", async () => {
    const exec = fakeCli([]);
    assert.equal(await claudeIsRegistered("claude", { exec }), false);
    assert.equal(await claudeLegacyIsRegistered("claude", { exec }), false);
  });

  test("the probes ask about DIFFERENT names (a shared name would make the pair vacuous)", async () => {
    const asked = [];
    const exec = async (_bin, args) => {
      asked.push(args[2]);
      throw new Error("absent");
    };
    await claudeIsRegistered("claude", { exec });
    await claudeLegacyIsRegistered("claude", { exec });
    assert.deepEqual(asked, ["vault-mcp", "governor"]);
  });
});

describe("3. the handshake's serverInfo", () => {
  test("declares `vault-mcp`, with the vault name in the title", () => {
    assert.equal(SERVER_INFO_NAME, "vault-mcp");
    assert.deepEqual(serverInfo("0.19.0", "My Vault"), {
      name: "vault-mcp",
      version: "0.19.0",
      title: "vault-mcp (My Vault)",
    });
  });

  test("no vault name ⇒ no title key at all, never `vault-mcp (undefined)`", () => {
    const info = serverInfo("0.19.0");
    assert.deepEqual(info, { name: "vault-mcp", version: "0.19.0" });
    assert.ok(!("title" in info));
  });

  test("an empty vault name is treated as absent, not rendered as `vault-mcp ()`", () => {
    assert.ok(!("title" in serverInfo("0.19.0", "")));
  });
});
