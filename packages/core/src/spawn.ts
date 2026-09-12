// spawn.ts — the two primitives every subprocess site in the suite needs:
// an augmented PATH, and an executable-file probe over a candidate list.
//
// PUBLISHED AT S8 (the mutating tier's extraction), on the `isVisible` (S4) /
// `executeQuickAddChoice` (S5) / `resolveScope` + the vocabulary kernel (S7)
// precedent. Before S8 both lived in the host's `src/claude-cli.ts` and
// `findObsidianBinary` in `src/mcp/tools-cli.ts`. The `vaultmcp-fileclass`
// satellite spawns the `fileclass` CLI and needs all three: the SAME PATH
// augmentation (or its spawn fails where the host's succeeds) and the SAME
// obsidian-binary probe (the CLI's `obsidian eval` bridge is pointed at it
// through `OBSIDIAN_BIN`). Copying them into the satellite would have forked a
// pair of one-line functions whose whole value is that both sides agree, which
// is the drift this repo has paid for repeatedly. The host now imports them
// from here and re-exports them unchanged, so no host call site moved.
//
// Nothing here is policy: no allowlist, no accept rule, no vault access. It is
// node-only (`node:fs`), Obsidian-free and SDK-free, like `territories.ts` and
// the fs-backend.

import * as fs from "node:fs";

/**
 * Directories appended to PATH for every spawned process.
 *
 * Obsidian's GUI process inherits a minimal PATH. A node-based CLI is commonly
 * a shell shim running `#!/usr/bin/env node`, which fails with ENOENT when
 * node's own directory is not on PATH. These are the two Homebrew/npm-global
 * prefixes that carry it on macOS.
 */
export const EXTRA_BIN_DIRS: readonly string[] = ["/opt/homebrew/bin", "/usr/local/bin"];

/** `base` (default `process.env`) with EXTRA_BIN_DIRS appended to PATH. */
export function spawnEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const parts = [base.PATH, ...EXTRA_BIN_DIRS].filter(Boolean) as string[];
  return { ...base, PATH: parts.join(":") };
}

/**
 * The first candidate that is an executable file, else null. Pure + testable:
 * `fileExists` is injectable, and the default probe is an `X_OK` access check.
 */
export function findBinary(
  candidates: string[],
  fileExists?: (p: string) => boolean
): string | null {
  const exists =
    fileExists ??
    ((p: string) => {
      try {
        fs.accessSync(p, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  for (const c of candidates) if (exists(c)) return c;
  return null;
}

/**
 * The Obsidian CLI forwarder binary, else null.
 *
 * Probes fixed locations because Obsidian's GUI PATH is minimal: the macOS
 * install targets plus `/usr/bin` for Linux packagings. An `X_OK` probe cannot
 * distinguish the CLI forwarder from a same-named app launcher (worst case:
 * calls time out) — a content probe per lookup would cost a process spawn, so
 * the tradeoff is accepted and the found path is surfaced through
 * `obsidian_doctor` instead.
 */
export function findObsidianBinary(opts?: {
  candidates?: string[];
  fileExists?: (p: string) => boolean;
}): string | null {
  const candidates = opts?.candidates ?? [
    "/usr/local/bin/obsidian",
    "/opt/homebrew/bin/obsidian",
    "/usr/bin/obsidian",
  ];
  return findBinary(candidates, opts?.fileExists);
}
