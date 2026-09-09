import { posix } from "node:path";
// import ok separately (okError uses it in its body); re-export exposes ok/fail as this module's public API
import { ok } from "@vault-mcp/core";
export { ok, fail } from "@vault-mcp/core";

/**
 * Extract path keys from a `getBacklinksForFile()` data payload. Obsidian
 * builds differ: some return a `Map<string, …>`, others return a plain object.
 * Handles both shapes defensively so `getBacklinks` never throws.
 */
export function backlinkKeys(data: unknown): string[] {
  if (data instanceof Map) return [...(data as Map<string, unknown>).keys()];
  if (data !== null && data !== undefined && typeof data === "object") return Object.keys(data);
  return [];
}

// ok()'s shape plus the MCP error flag: for batch tools whose structured
// per-item report must survive a total failure (fail() would flatten it to text).
export function okError(data: unknown) {
  return { ...ok(data), isError: true as const };
}

/**
 * A TYPED refusal, in the `Error [code]: message` shape the guard itself emits
 * (mcp/guarded.ts). Core's `fail()` renders `Error: <message>`, which drops the
 * only machine-readable thing about a refusal — so any tool refusing for a
 * reason a caller might branch on (a cap, a scope, an allowlist) reports it
 * through here instead. One copy, shared by tools-locks.ts and tools-links.ts,
 * so two surfaces cannot drift on what a refusal looks like.
 */
export function codedError(code: string, message: string) {
  return { content: [{ type: "text" as const, text: `Error [${code}]: ${message}` }], isError: true as const };
}

// Static validation for a batch of moves, all checked before any item runs.
// Sequential batch moves make swaps/chains destructive with overwrite=true (an
// earlier item can trash or consume a note a later item depends on), and
// mid-batch input errors would leave the vault partially mutated — so any
// statically-detectable problem rejects the whole batch up front. Paths are
// normalized before comparison so './' and '..' aliases can't slip past
// (mirrors guardCall's normalize-before-compare).
export function validateMoves(moves: Array<{ from: string; to: string }>): string | null {
  const froms = new Set<string>();
  const tos = new Set<string>();
  for (const { from: rawFrom, to: rawTo } of moves) {
    if (!rawFrom.endsWith(".md")) return `source must end in .md: ${rawFrom}`;
    if (!rawTo.endsWith(".md")) return `destination must end in .md: ${rawTo}`;
    const from = posix.normalize(rawFrom);
    const to = posix.normalize(rawTo);
    if (from === to) return `from and to are the same path: ${rawFrom}`;
    if (froms.has(from)) return `duplicate source: ${rawFrom}`;
    if (tos.has(to)) return `duplicate destination: ${rawTo}`;
    froms.add(from);
    tos.add(to);
  }
  for (const f of froms) if (tos.has(f)) return `path is both a source and a destination: ${f}`;
  return null;
}

// ── serverInfo (the `initialize` handshake's self-description) ────────────────

/** The name this server declares at the MCP handshake.
 *
 * `vault-mcp` since the suite split's S3c wire rename (Nelson's ruling,
 * 2026-09-09); it was `governor` between 0.12.0 and the split. It matches the
 * Claude Code registration name (`MCP_SERVER_NAME` in `src/claude-cli.ts`) but
 * is deliberately a SEPARATE constant: an operator may register this bridge
 * under any name they like, so coupling the two would assert an agreement the
 * wire does not guarantee. Both are pinned, each on its own side.
 *
 * It lives here rather than in `mcp/server.ts` so it is reachable from a plain
 * node test — `server.ts` constructs live Obsidian classes at module scope. */
export const SERVER_INFO_NAME = "vault-mcp";

/** serverInfo, as returned by `initialize`. `title` carries the vault name so a
 * client with two vault-mcp servers attached can tell them apart at the
 * handshake, without a tool call — the same assertion the journal's
 * `actor.server` makes, made once at connect time. An absent vault name yields
 * no `title` key at all, rather than a title reading `vault-mcp (undefined)`. */
export function serverInfo(
  version: string,
  vaultName?: string,
): { name: string; version: string; title?: string } {
  return {
    name: SERVER_INFO_NAME,
    version,
    ...(vaultName ? { title: `${SERVER_INFO_NAME} (${vaultName})` } : {}),
  };
}
