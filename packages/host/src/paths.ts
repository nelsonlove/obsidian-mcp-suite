import * as os from "node:os";
import * as path from "node:path";

/** PUBLISHED into `@vault-mcp/core` at the host/provider split (S3c) and
 * re-exported here, so no call site in this package moved. The host names the
 * socket, the discovery json and the observation directory by this slug; the
 * governance provider names the standing chain's git directory by it. A
 * one-character disagreement between two copies would point the chain
 * somewhere the store-binding marker does not name, and the vault would read
 * as "cut over elsewhere; chain absent here" on the machine that is holding
 * the chain. */
export { vaultSlug } from "@vault-mcp/core";
import { vaultSlug } from "@vault-mcp/core";

/** The state namespace: `~/.claude/vault-mcp/` holds `bridge.mjs`,
 * `<vault-slug>.sock`, `<vault-slug>.json`, and `observations/<vault-slug>/`.
 *
 * It has moved twice, and the machinery is the same both ways. 0.12.0 renamed
 * `vault-mcp` → `governor` with the plugin id; the suite split's S3c moves it
 * BACK, because "governor" now names the governance PROVIDER and the transport
 * is the host's. The old dir stays a grace-period compat surface — the bridge
 * and a `legacy: true` discovery copy are written there too, so every existing
 * `claude mcp` registration that points `node` at
 * `~/.claude/governor/bridge.mjs` keeps working with no re-registration. See
 * `legacyStateDir` and discovery.ts.
 *
 * NOTE the one thing that does NOT move with this dir: the governance
 * provider's history repository lives at `~/.claude/governor/history/<slug>/`
 * and STAYS there, because the provider keeps the id `governor`. The two
 * plugins share the `~/.claude/governor/` directory during the grace period,
 * writing disjoint names (the host: `bridge.mjs` + `<slug>.json`; the provider:
 * `history/`). */
export function stateDir(): string {
  return path.join(os.homedir(), ".claude", "vault-mcp");
}

/** The 0.12.0-era state namespace (`~/.claude/governor/`). Existing Claude Code
 * registrations point `node` at the bridge here, and bridges shipped between
 * 0.12.0 and the split read discovery jsons from here — so the plugin ALSO
 * writes the bridge and a `legacy: true` discovery copy (whose `socket_path`
 * points at the NEW socket) into this dir. It is also where the governance
 * provider keeps its history repository, which is why this directory is NOT a
 * thing to clean up wholesale. */
export function legacyStateDir(): string {
  return path.join(os.homedir(), ".claude", "governor");
}

export function socketPath(slug: string): string {
  return path.join(stateDir(), `${slug}.sock`);
}

export function discoveryPath(slug: string): string {
  return path.join(stateDir(), `${slug}.json`);
}

export function legacyDiscoveryPath(slug: string): string {
  return path.join(legacyStateDir(), `${slug}.json`);
}

export function bridgeDestPath(): string {
  return path.join(stateDir(), "bridge.mjs");
}

export function legacyBridgeDestPath(): string {
  return path.join(legacyStateDir(), "bridge.mjs");
}
