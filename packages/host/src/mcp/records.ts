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
//      the note's current TEXT, never the metadata cache (so a note written
//      moments ago, its cache still stale, is judged by what it says now); OR
//   2. it lies in a record folder, per the operator's FOLDER indicator (#482, a
//      plugin setting: a list of folder paths, and a pattern for archive folder
//      names; each indicator has its own on/off switch). The plugin ships both
//      empty; an install that predates the setting is seeded once with what
//      #455 hard-coded (record-folders-policy.ts).
//
// Archiving is the moment a note becomes a record. A LIVING note moved INTO a
// record folder is judged living for that move (a record by folder only when
// both its old and its new path say so, move-with-links.ts), so its own
// relative links are healed on the way in: the record then cites working
// targets as of its archiving, and every later move leaves them as written.
// Chosen on PR #455's review (finding 5); pinned in move-with-links.test.mjs.
//
// The "Enforce record immutability" toggle does NOT switch this off. That toggle
// exists to unblock an operation the guard REFUSES (its setting text: "Turn OFF
// only to unblock a legitimate operation the check over-blocks"); a move refuses
// nothing here, it only leaves a record's links as written and lists them, so
// there is nothing for the toggle to unblock, and rule 8 still holds.

import { parseYaml } from "obsidian";
import { leadingFrontmatterBlock, stripLeadingFrontmatter } from "@vault-mcp/core";
import { unindexedSpans } from "./link-rewrite.js";
import {
  DEFAULT_RECORD_IDENTIFICATION,
  DEFAULT_RECORD_FOLDERS,
  archivePatternRegExp,
  identifiesRecord,
  type RecordFolders,
  type RecordEvidence,
  type RecordIdentification,
} from "../kernel/record-guard.js";

/** Is `path` a record? `text` is the note's current text: the record identification is read from it, so a note written moments ago (its cache still stale) is judged by what it says now. */
export type IsRecord = (path: string, text: string) => boolean;

/** The note indicator and the folder indicator together, as server.ts hands them to the moves (#482). */
export type RecordRules = RecordIdentification & { folders: RecordFolders };

/**
 * True when `path` lies in a record folder, per the folder indicator (#482):
 * a folder on the path that is one of `folders` (by its whole vault path) or
 * whose name matches `archivePattern`. Off, or nothing configured: false. The
 * folder note of the record ROOT (the outermost such folder on the path:
 * `03.04 Records/03.04 Records.md`, `41.09 Archive for …/41.09 Archive for
 * ….md`) is that folder's living index, not a record. A folder note nested
 * deeper inside a record folder is a record like its siblings.
 */
const compiled = new WeakMap<RecordFolders, RegExp | null>();
export function inRecordFolder(path: string, cfg: RecordFolders = DEFAULT_RECORD_FOLDERS): boolean {
  if (cfg.enabled === false) return false;
  if (!compiled.has(cfg)) compiled.set(cfg, archivePatternRegExp(cfg.archivePattern));
  const archive = compiled.get(cfg) ?? null;
  const segs = path.split("/");
  const folders = segs.slice(0, -1);
  const base = segs[segs.length - 1].replace(/\.md$/i, "");
  let root = -1;
  for (let i = 0; i < folders.length && root < 0; i++) {
    if ((archive && archive.test(folders[i])) || cfg.folders.includes(folders.slice(0, i + 1).join("/"))) root = i;
  }
  if (root < 0) return false;
  return !(root === folders.length - 1 && folders[root] === base);
}

/**
 * An inline `#tag` as Obsidian's index reads one (what `getAllTags`, and so the
 * guard's probe, sees). The tag itself is Obsidian's own pattern, copied from
 * the shipped app.js (Obsidian 1.13.7): `#` then one or more characters outside
 * U+2000–U+206F, U+2E00–U+2E7F, whitespace and `'!"#$%&()*+,.:;<=>?@^`{|}~[]\`,
 * and not all digits. Obsidian's locator accepts a `#` after whitespace or at
 * the start of an inline chunk, which is also right inside an emphasis, strike
 * or highlight delimiter (`**#record**`, `_#record_`, `~~#record~~`,
 * `==#record==`); this accepts a `#` at a line start, after whitespace, or
 * after one of `*_~=`.
 *
 * RESIDUAL, both ways, because the chunk boundaries come from Obsidian's inline
 * grammar, which this does not reproduce: a `#` right after a link or a code
 * span (`[x](y)#record`) or at the start of link text (`[#record](y)`) is a tag
 * to Obsidian and not here (a record by tag could then be healed), and a `#`
 * after a `*`, `_`, `~` or `=` that opens no emphasis (`a_#record`) is a tag
 * here and not to Obsidian (a living note's link would be left and listed in
 * records_left, the safe direction). An operator relying on tags should keep
 * them where Obsidian plainly reads them: frontmatter `tags`, or after a space.
 */
const INLINE_TAG = /(?:^|[\s*_~=])#([^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]+)/gmu;

/**
 * Frontmatter tags exactly as Obsidian's `parseFrontMatterTags` reads them
 * (checked against the shipped app.js, Obsidian 1.13.7): the FIRST key matching
 * `/^tags$/i` (so `Tags:` counts and `tag:` does not), a string value as one
 * tag (`tags: a, b` is the one string `a, b`, which holds a space and is
 * dropped), an array's string items only, each trimmed, empty ones and ones
 * holding a space dropped, and `#` prefixed where missing.
 */
function fmTags(fm: Record<string, unknown> | null): string[] {
  if (!fm) return [];
  const key = Object.keys(fm).find((k) => /^tags$/i.test(k));
  if (key === undefined) return [];
  const v = fm[key];
  const raw = typeof v === "string" ? [v.trim()] : Array.isArray(v) ? v.filter((t): t is string => typeof t === "string").map((t) => t.trim()) : [];
  return raw.filter((t) => t !== "" && !t.includes(" ")).map((t) => (t.startsWith("#") ? t : `#${t}`));
}

/**
 * What a note's text says about whether it is a record, in the shape the
 * kernel's `identifiesRecord` takes: its frontmatter, found by core's own
 * recognizer (`leadingFrontmatterBlock`: a BOM, trailing blanks after `---`,
 * CRLF or a lone `\r`, and text after the closing `---` all as Obsidian reads
 * them) and parsed by Obsidian's own YAML parser (so `record: "true"` is the
 * string the guard also counts, and `record: true#x` is the string `true#x`,
 * which nothing counts); and its tags, from frontmatter `tags` and inline
 * `#tags` outside the spans Obsidian does not index (link-rewrite.ts's
 * `unindexedSpans`: fenced and inline code as Obsidian delimits them, and math).
 * An unparseable frontmatter block reads as none: cannot tell, which is not a
 * record, as in the guard (fail open).
 */
export function recordEvidenceFromText(text: string): RecordEvidence {
  const yaml = leadingFrontmatterBlock(text);
  let frontmatter: Record<string, unknown> | null = null;
  if (yaml !== null) {
    try {
      const parsed: unknown = parseYaml(yaml);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) frontmatter = parsed as Record<string, unknown>;
    } catch {
      frontmatter = null;
    }
  }
  const tags = fmTags(frontmatter);
  const body = stripLeadingFrontmatter(text);
  const skip = unindexedSpans(body);
  for (const t of body.matchAll(INLINE_TAG)) {
    const at = t.index! + t[0].length - t[1].length - 1; // the `#`
    if (skip.some(([a, b]) => at >= a && at < b)) continue;
    if (!/^\d+$/.test(t[1])) tags.push(`#${t[1]}`);
  }
  return { frontmatter, tags };
}

/**
 * The move's record test: the operator's record identification (read live per
 * call; absent ⇒ the shipped default `record: true`), judged on the note's
 * current `text`, OR the record-folder fallback.
 */
export function recordTest(identification?: () => RecordRules): IsRecord {
  // Read once, on first use: one move (or one batch, one renumber) is judged under
  // one set of settings, and the pattern is compiled once, not once per note.
  let rules: RecordRules | undefined;
  return (path, text) => {
    rules ??= identification?.() ?? { ...DEFAULT_RECORD_IDENTIFICATION, folders: DEFAULT_RECORD_FOLDERS };
    const id = rules;
    if (inRecordFolder(path, id.folders)) return true;
    return identifiesRecord(id, recordEvidenceFromText(text)) === true;
  };
}
