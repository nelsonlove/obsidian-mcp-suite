import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeDiscovery, removeDiscovery } from "../src/discovery.ts";

// THIS TEST REDIRECTS $HOME, and that is not tidiness — it is a defect fix.
//
// `writeDiscovery` resolves its destination through `paths.ts`'s `stateDir()` /
// `legacyStateDir()`, which are `os.homedir()` + a suffix. Written the obvious
// way, this test therefore wrote into the OPERATOR'S REAL `~/.claude/vault-mcp/`
// and `~/.claude/governor/`, and only cleaned up in its last two lines — so any
// failure before `removeDiscovery` leaked a fake vault discovery json into live
// state and left it there. That is exactly what happened: on 2026-09-14 ten
// stale `t<pid>.json` files were found across those two directories, five runs'
// worth, each describing a vault at `/v` on a socket at `/x.sock`.
//
// They are not inert. The bridge picks a vault by reading every discovery json
// in those directories, and refuses with "multiple vaults open; specify --vault"
// when it finds more than one unflagged entry — so a leaked fixture is a live
// input to the operator's connection path, not a stray file.
//
// The redirect works because `stateDir()` calls `os.homedir()` on EVERY call
// rather than caching it at import, and `os.homedir()` returns `$HOME` on POSIX.
// Both halves are load-bearing: if `paths.ts` ever caches the home directory, or
// memoizes `stateDir()`, this test silently goes back to writing into real state
// while still passing. The assertion below pins the first half — it fails if the
// redirect stops taking effect — so the failure is loud rather than invisible.
test("writeDiscovery writes canonical + legacy compat copy; removeDiscovery removes both", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vault-mcp-discovery-test-"));
  const realHome = process.env.HOME;
  process.env.HOME = home;
  // Restore even if an assertion throws, so one failure cannot strand $HOME for
  // the rest of the file, and remove the sandbox whatever happened.
  t.after(() => {
    if (realHome === undefined) delete process.env.HOME;
    else process.env.HOME = realHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  // The redirect is in force — if this fails, everything below would be writing
  // into the operator's real state directory.
  assert.equal(os.homedir(), home, "the $HOME redirect must be in force before any write");

  const slug = `t${process.pid}`;
  const d = {
    socket_path: "/x.sock", vault_path: "/v", vault_name: slug,
    plugin_version: "0.1.0", obsidian_version: "1.6.6", started_at: "2026-01-01T00:00:00",
  };
  writeDiscovery(slug, d);

  // Canonical discovery in the CURRENT namespace (`~/.claude/vault-mcp/` again
  // since the host/provider split) — no legacy flag.
  const canonical = path.join(home, ".claude", "vault-mcp", `${slug}.json`);
  const c = JSON.parse(fs.readFileSync(canonical, "utf8"));
  assert.equal(c.vault_name, slug);
  assert.equal(c.legacy, undefined, "the canonical copy must not be marked legacy");

  // Grace-period compat copy in the 0.12.0-era namespace (`~/.claude/governor/`,
  // which the governance provider also uses for its history repository):
  // `legacy: true`, pointing at the SAME socket, so every `claude mcp`
  // registration made between 0.12.0 and the split keeps resolving with no
  // re-registration.
  const legacy = path.join(home, ".claude", "governor", `${slug}.json`);
  const l = JSON.parse(fs.readFileSync(legacy, "utf8"));
  assert.equal(l.legacy, true);
  assert.equal(l.socket_path, d.socket_path, "legacy copy points at the new socket");
  assert.equal(l.vault_name, slug);

  removeDiscovery(slug);
  assert.equal(fs.existsSync(canonical), false);
  assert.equal(fs.existsSync(legacy), false);
});
