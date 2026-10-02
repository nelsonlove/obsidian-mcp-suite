// Which notes a move treats as records: historical, never edited (01.44 rule
// 8). A move renames its note and rewrites the links to it; it must not rewrite
// a link inside a record, because rule 8a permits only meaning-preserving passes
// over records, and a repointed link changes what the record says it cited (the
// 01.27 ruling: a renumber does not repoint what a record cites).
//
// A note is a record here when EITHER
//   1. the operator's record identification says so (#397: a frontmatter
//      property with a value, `record: true` by default, or a tag). The
//      DECISION is the kernel's (`identifiesRecord` / `isRecordFlag` in
//      kernel/record-guard.ts), the same one the record-immutability guard and
//      obsidian_rename_heading use; this module only gathers the evidence, from
//      the note's current TEXT when the move has it (so a note written moments
//      ago, its cache still stale, is judged by what it says now), else from
//      the metadata cache through the kernel's own probe; OR
//   2. it lies in a record folder: the fallback, by path alone, while the key's
//      coverage is partial. The folders are the agent record folders and every
//      JD archive in any area (`NN.09 Archive…`, and the dotted form
//      `NN.NN.09 Archive…`), as the rear admiral's brief for this fix asked. This
//      is WIDER than `dangling-links` in 00.13 Scripts, whose fallback list names
//      only `00.09 Archive` among the archives; the two lists are kept by hand in
//      two places until the key covers every record.
//
// The "Enforce record immutability" toggle does NOT switch this off. That toggle
// exists to unblock an operation the guard REFUSES (its setting text: "Turn OFF
// only to unblock a legitimate operation the check over-blocks"); a move refuses
// nothing here, it only leaves a record's links as written and lists them, so
// there is nothing for the toggle to unblock, and rule 8 still holds.

import { parseYaml, type App } from "obsidian";
import { obsidianProbe } from "../kernel/obsidian-probe.js";
import {
  DEFAULT_RECORD_IDENTIFICATION,
  identifiesRecord,
  type RecordEvidence,
  type RecordIdentification,
} from "../kernel/record-guard.js";

/** Folders whose notes are records wherever the key is missing. */
export const RECORD_FOLDERS = [
  "00-09 System/03 Agents/03.04 Records",
  "00-09 System/03 Agents/03.20 Imported chats",
  "00-09 System/03 Agents/03.16 Cross-session log",
];

/** A JD archive folder: `00.09 Archive`, `41.09 Archive for 41 Banking & accounts`, `06.37.09 Archive for …`. */
const ARCHIVE_SEGMENT = /^\d\d(?:\.\d\d)*\.09 Archive(?: |$)/;

/** Is `path` a record? `text`, when given, is the note's current text: the record identification is read from it, so a note written moments ago (its cache still stale) is judged by what it says now. */
export type IsRecord = (path: string, text?: string) => boolean;

/**
 * True when `path` lies in a record folder (the fallback, by path alone). The
 * folder note of the record ROOT (the outermost archive folder or RECORD_FOLDERS
 * entry on the path: `03.04 Records/03.04 Records.md`, `41.09 Archive for
 * …/41.09 Archive for ….md`) is that folder's living index, not a record. A
 * folder note nested deeper inside a record folder is a record like its siblings.
 */
export function inRecordFolder(path: string): boolean {
  const segs = path.split("/");
  const folders = segs.slice(0, -1);
  const base = segs[segs.length - 1].replace(/\.md$/i, "");
  let root = -1;
  for (let i = 0; i < folders.length && root < 0; i++) {
    if (ARCHIVE_SEGMENT.test(folders[i]) || RECORD_FOLDERS.includes(folders.slice(0, i + 1).join("/"))) root = i;
  }
  if (root < 0) return false;
  return !(root === folders.length - 1 && folders[root] === base);
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
/** Fenced code blocks and inline code: no tag inside them counts, as in Obsidian. */
const CODE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$|`[^`\n]*`/gm;
/** An inline `#tag`: letters, digits, `_`, `-` and `/`, after a line start or whitespace (an all-digit one is no tag). */
const INLINE_TAG = /(?:^|\s)#([\p{L}\p{N}_/-]+)/gu;

function fmTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((t) => t !== null && t !== undefined).map((t) => String(t));
  if (typeof v === "string") return v.split(/[,\s]+/).filter(Boolean);
  return [];
}

/**
 * What a note's text says about whether it is a record, in the shape the
 * kernel's `identifiesRecord` takes: its frontmatter parsed by Obsidian's own
 * YAML parser (so `record: "true"` is the string the guard also counts, and
 * `record: true#x` is the string `true#x`, which nothing counts), and its tags,
 * from frontmatter `tags`/`tag` and inline `#tags` outside code. An unparseable
 * frontmatter block reads as none: cannot tell, which is not a record, as in the
 * guard (fail open).
 */
export function recordEvidenceFromText(text: string): RecordEvidence {
  const m = FRONTMATTER.exec(text);
  let frontmatter: Record<string, unknown> | null = null;
  if (m) {
    try {
      const parsed: unknown = parseYaml(m[1]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) frontmatter = parsed as Record<string, unknown>;
    } catch {
      frontmatter = null;
    }
  }
  const tags = [...fmTags(frontmatter?.tags), ...fmTags(frontmatter?.tag)];
  const body = (m ? text.slice(m[0].length) : text).replace(CODE, " ");
  for (const t of body.matchAll(INLINE_TAG)) if (!/^\d+$/.test(t[1])) tags.push(`#${t[1]}`);
  return { frontmatter, tags };
}

/**
 * The move's record test: the operator's record identification (read live per
 * call; absent ⇒ the shipped default `record: true`), judged on `text` when
 * given and on the metadata cache otherwise, OR the record-folder fallback.
 */
export function recordTest(app: App, identification?: () => RecordIdentification): IsRecord {
  // The kernel's probe, with enforcement always on: see the header for why the toggle does not reach a move.
  const probe = obsidianProbe(app, () => true, identification);
  return (path, text) => {
    if (inRecordFolder(path)) return true;
    if (text === undefined) return probe.record?.(path) === true;
    const id = identification?.() ?? DEFAULT_RECORD_IDENTIFICATION;
    return identifiesRecord(id, recordEvidenceFromText(text)) === true;
  };
}
