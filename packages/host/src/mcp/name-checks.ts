// Names Obsidian Sync refuses, checked where the live host creates or renames a
// note (the rule itself is in core: sync-names.ts). This file gathers what the
// bracket rule needs from the live vault, Nelson, 2026-10-02: "Brackets should
// only be permissible on archived notes that no other note links to."
//
// "No other note links to it" is decided exactly, not from Obsidian's index
// alone (which lags behind recent writes): a resolved link in the index, a link
// in any note's current text, or an unresolved link that the name would answer.
// That costs a read of the vault, so it is done only when brackets decide the
// outcome.

import { TFile, TFolder, type App } from "obsidian";
import { assertSyncSafeName, assertSyncSafeMove, hasInboundLinks, type ArchiveMatcher, type BracketContext } from "@vault-mcp/core";
import { hasTextLinkers, TextCache } from "./move-with-links.js";

const stripMd = (p: string) => p.replace(/\.md$/i, "").toLowerCase();

/**
 * Which folder names are archives, for Nelson's bracket rule: the operator's
 * archive pattern (#482), set once by server.ts. Unset (a caller outside the
 * live server, e.g. a test): core's JD default. A pattern that is empty or does
 * not compile matches nothing, so brackets are then never freed.
 */
let archivePattern: (() => RegExp | null) | undefined;
export function configureArchiveFolders(getter: (() => RegExp | null) | undefined): void {
  archivePattern = getter;
}
function isArchive(): ArchiveMatcher | undefined {
  if (!archivePattern) return undefined;
  return (name) => {
    const re = archivePattern?.();
    return !!re && re.test(name);
  };
}

function folderExists(app: App): (p: string) => boolean {
  return (p) => app.vault.getAbstractFileByPath(p) instanceof TFolder;
}

/** True when an unresolved link somewhere names `path` (by its path or its bare name), so it would resolve to a note there. */
export function unresolvedNames(app: App, path: string): boolean {
  const full = stripMd(path);
  const bare = stripMd(path.split("/").pop() ?? path);
  for (const targets of Object.values(app.metadataCache.unresolvedLinks ?? {})) {
    for (const k of Object.keys(targets ?? {})) {
      const t = stripMd(k.split("#")[0]);
      if (t === full || t === bare || full.endsWith("/" + t)) return true;
    }
  }
  return false;
}

/** For a NEW note at `path`: refuses a name Obsidian Sync refuses; brackets only under the rule. */
export function assertCreateName(app: App, path: string): void {
  assertSyncSafeName(path, { linked: unresolvedNames(app, path), folderExists: folderExists(app), isArchive: isArchive() });
}

/**
 * For a move or rename of `from` onto `to` (with `overwrite`, the note now at
 * `to` is replaced, and links to it then reach the moved note). Cheap checks
 * first; the vault is read only when brackets decide the outcome.
 */
export async function assertMoveName(app: App, from: string, to: string, overwrite = false, texts?: TextCache): Promise<void> {
  const fe = folderExists(app);
  const arch = isArchive();
  const at = (linked: boolean): BracketContext => ({ linked, folderExists: fe, isArchive: arch });
  assertSyncSafeMove(from, to, at(false)); // refused even if unlinked: refused
  try {
    assertSyncSafeMove(from, to, at(true)); // allowed even if linked: allowed
    return;
  } catch {
    /* brackets decide it: find out whether anything links the note */
  }
  const rl = app.metadataCache.resolvedLinks;
  const src = app.vault.getAbstractFileByPath(from);
  const dest = overwrite ? app.vault.getAbstractFileByPath(to) : null;
  const cache = texts ?? new TextCache(app);
  const linked =
    !(src instanceof TFile) || // not there to judge (a later step of a chain): count it as linked
    hasInboundLinks(rl, from) ||
    (dest instanceof TFile && hasInboundLinks(rl, to)) ||
    unresolvedNames(app, to) ||
    (await hasTextLinkers(app, src, cache)) ||
    (dest instanceof TFile && (await hasTextLinkers(app, dest, cache)));
  assertSyncSafeMove(from, to, at(linked));
}
