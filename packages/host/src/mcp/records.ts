// Which notes are records: historical, never edited (01.44 rule 8). A move
// renames its note and rewrites the links to it; it must not rewrite a link
// inside a record, because rule 8a permits only meaning-preserving passes over
// records, and a repointed link changes what the record says it cited (the
// 01.27 ruling: a renumber does not repoint what a record cites).
//
// The test is the vault's own (`dangling-links` in 00.13 Scripts): the
// `record: true` frontmatter key, with folders as the fallback while that key's
// coverage is partial. Here the folders are every JD archive (`NN.09 Archive…`,
// in any area) and the agent record folders.

import { TFile, type App } from "obsidian";

/** Folders whose notes are records wherever the key is missing. */
export const RECORD_FOLDERS = [
  "00-09 System/03 Agents/03.04 Records",
  "00-09 System/03 Agents/03.20 Imported chats",
  "00-09 System/03 Agents/03.16 Cross-session log",
];

/** A JD archive folder: `00.09 Archive`, `41.09 Archive for 41 Banking & accounts`, and so on. */
const ARCHIVE_SEGMENT = /^\d\d\.09 Archive(?: |$)/;

export type IsRecord = (path: string) => boolean;

export function recordTest(app: App): IsRecord {
  return (path) => {
    if (path.split("/").slice(0, -1).some((seg) => ARCHIVE_SEGMENT.test(seg))) return true;
    if (RECORD_FOLDERS.some((d) => path.startsWith(d + "/"))) return true;
    const f = app.vault.getAbstractFileByPath(path);
    return f instanceof TFile && app.metadataCache.getFileCache(f)?.frontmatter?.record === true;
  };
}
