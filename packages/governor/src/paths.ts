// THE PROVIDER'S MACHINE-LOCAL STATE NAMESPACE.
//
// `~/.claude/governor/` — unchanged by the host/provider split, and that is the
// point of the provider keeping the id. The standing chain's git directory lives
// at `~/.claude/governor/history/<vault-slug>/` and the store-identity marker
// beside it; both are the operator's live authority state, and neither moved.
//
// The HOST's namespace went back to `~/.claude/vault-mcp/` at the split, and it
// also keeps writing a grace-period `bridge.mjs` and a `legacy: true` discovery
// json into THIS directory so that existing `claude mcp` registrations keep
// resolving. So the two plugins share the directory and write disjoint names:
// the host owns `bridge.mjs` and `<slug>.json`, the provider owns `history/`.
// Neither may clean the other's up, which is why nothing in this suite ever
// removes `~/.claude/governor/` wholesale.
//
// `vaultSlug` comes from `@vault-mcp/core` rather than being reimplemented here.
// A one-character disagreement with the host's slug would point the chain
// somewhere the marker does not name, and the vault would read as "cut over
// elsewhere; chain absent here" on the machine that is actually holding it.

import * as os from "node:os";
import * as path from "node:path";

export { vaultSlug } from "@vault-mcp/core";

/** `~/.claude/governor/` — the provider's machine-local state namespace. */
export function stateDir(): string {
  return path.join(os.homedir(), ".claude", "governor");
}
