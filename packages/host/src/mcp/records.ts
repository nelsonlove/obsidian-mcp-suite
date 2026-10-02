// Which notes are records: historical, never edited (01.44 rule 8). A move
// renames its note and rewrites the links to it; it must not rewrite a link
// inside a record, because rule 8a permits only meaning-preserving passes over
// records, and a repointed link changes what the record says it cited (the
// 01.27 ruling: a renumber does not repoint what a record cites).
//
// The test: the `record: true` frontmatter key (the predicate 01.44's
// Decision "Does the never-edit rule bind automation" names), with folders as
// the fallback while that key's coverage is partial. The folders are the agent
// record folders and every JD archive in any area (`NN.09 Archive…`, and the
// dotted form `NN.NN.09 Archive…`), as the rear admiral's brief for this fix
// asked. This is WIDER than `dangling-links` in 00.13 Scripts, whose fallback
// list names only `00.09 Archive` among the archives; the two lists are kept by
// hand in two places until the key covers every record.

import { TFile, type App } from "obsidian";

/** Folders whose notes are records wherever the key is missing. */
export const RECORD_FOLDERS = [
  "00-09 System/03 Agents/03.04 Records",
  "00-09 System/03 Agents/03.20 Imported chats",
  "00-09 System/03 Agents/03.16 Cross-session log",
];

/** A JD archive folder: `00.09 Archive`, `41.09 Archive for 41 Banking & accounts`, `06.37.09 Archive for …`. */
const ARCHIVE_SEGMENT = /^\d\d(?:\.\d\d)*\.09 Archive(?: |$)/;

/** Is `path` a record? `text`, when given, is the note's current text: its frontmatter is read from it, so a note written moments ago (its cache still stale) is judged by what it says now. */
export type IsRecord = (path: string, text?: string) => boolean;

/**
 * True when `path` lies in a record folder (the fallback, by path alone). A
 * folder's own folder note (`03.04 Records/03.04 Records.md`, `41.09 Archive for
 * …/41.09 Archive for ….md`) is the folder's living index, not a record.
 */
export function inRecordFolder(path: string): boolean {
  const segs = path.split("/");
  const folders = segs.slice(0, -1);
  const base = segs[segs.length - 1].replace(/\.md$/i, "");
  if (folders.length > 0 && folders[folders.length - 1] === base) return false;
  if (folders.some((seg) => ARCHIVE_SEGMENT.test(seg))) return true;
  return RECORD_FOLDERS.some((d) => path.startsWith(d + "/"));
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** `record: true` in the frontmatter of `text`. */
export function keyedRecord(text: string): boolean {
  const fm = FRONTMATTER.exec(text);
  // YAML 1.2 core booleans, optionally quoted-free and followed by a comment: as Obsidian's parser reads them.
  return !!fm && /^record:[ \t]*(?:true|True|TRUE)[ \t]*(?:#.*)?$/m.test(fm[1]);
}

export function recordTest(app: App): IsRecord {
  return (path, text) => {
    if (inRecordFolder(path)) return true;
    if (text !== undefined) return keyedRecord(text);
    const f = app.vault.getAbstractFileByPath(path);
    return f instanceof TFile && app.metadataCache.getFileCache(f)?.frontmatter?.record === true;
  };
}
