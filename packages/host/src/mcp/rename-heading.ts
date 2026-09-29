// rename-heading.ts — the pure half of `obsidian_rename_heading` (#424).
//
// Obsidian's own "Rename this heading" command renames a heading and heals
// every link to it, but it needs an editor cursor and a dialog, so no agent can
// run it. This module holds the text rules the tool applies; the handler in
// tools-vault-write.ts gathers the positions from the metadata cache and
// applies these rules at them. Kept obsidian-free so the rules are tested
// without an app.

/** How Obsidian compares a heading named in a link subpath with a heading in
 *  the note: case-insensitive, with whitespace collapsed. Used to decide which
 *  link segments name the renamed heading and whether the new name collides. */
export function headingKey(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Characters a heading name cannot carry and still be linked by name:
 *  they are link syntax (`[ ] |`), the subpath separator (`#`) or the block
 *  marker (`^`). A newline would end the heading line. */
export const FORBIDDEN_HEADING_CHARS = /[\[\]|#^\r\n]/;

/** The refusal for a proposed new heading name, or null when it is usable. */
export function newHeadingRefusal(oldHeading: string, newHeading: string): string | null {
  if (newHeading.trim() === "") return "new_heading is empty";
  if (newHeading !== newHeading.trim()) return "new_heading has leading or trailing whitespace";
  if (FORBIDDEN_HEADING_CHARS.test(newHeading)) return "new_heading contains a character a heading link cannot carry ([ ] | # ^ or a line break)";
  if (newHeading === oldHeading) return "new_heading is the same as heading";
  return null;
}

/** Rewrite the heading segments of a subpath (`A#B`, no leading `#`) that
 *  name `oldHeading`; null when none does. */
function rewriteSegments(subpath: string, oldHeading: string, newHeading: string, decode: (s: string) => string, encode: (s: string) => string): string | null {
  const key = headingKey(oldHeading);
  let hit = false;
  const out = subpath.split("#").map((seg) => {
    let plain: string;
    try { plain = decode(seg); } catch { return seg; }
    if (headingKey(plain) !== key) return seg;
    hit = true;
    return encode(newHeading);
  });
  return hit ? out.join("#") : null;
}

const WIKI = /^(!?\[\[)([^#|\]]*)#([^|\]]*)(\|[^\]]*)?(\]\])$/;
const MARKDOWN = /^(!?\[[^\]]*\]\()(<?)([^)#\s>]*)#([^)\s>]*)(>?)(\s+"[^"]*")?(\))$/;

/**
 * The link as it should read after the rename, given its text exactly as the
 * note carries it (the cache's `original`): a wikilink or embed
 * (`[[Note#Old|alias]]`, `![[#Old]]`) or a markdown link (`[t](Note.md#Old%20x)`).
 * Only the heading segment that names the old heading changes; the target,
 * the alias and any other segment of a heading chain stay as they are.
 * Null when the link has no segment naming the heading, or is a form this
 * does not recognize (the caller reports it rather than guessing).
 */
export function rewriteLinkOriginal(original: string, oldHeading: string, newHeading: string): string | null {
  const w = WIKI.exec(original);
  if (w) {
    const seg = rewriteSegments(w[3], oldHeading, newHeading, (s) => s, (s) => s);
    return seg === null ? null : `${w[1]}${w[2]}#${seg}${w[4] ?? ""}${w[5]}`;
  }
  const m = MARKDOWN.exec(original);
  if (m) {
    const seg = rewriteSegments(m[4], oldHeading, newHeading, (s) => decodeURIComponent(s), (s) => encodeURIComponent(s).replace(/%2F/g, "/"));
    return seg === null ? null : `${m[1]}${m[2]}${m[3]}#${seg}${m[5]}${m[6] ?? ""}${m[7]}`;
  }
  return null;
}

/** The heading line with its text replaced, keeping its level; null when the
 *  line is not an ATX heading whose text (minus closing `#`s) is `oldHeading`. */
export function rewriteHeadingLine(line: string, oldHeading: string, newHeading: string): string | null {
  const m = /^(#{1,6})([ \t]+)(.*?)([ \t]+#+)?[ \t]*$/.exec(line);
  if (!m || m[3] !== oldHeading) return null;
  return `${m[1]}${m[2]}${newHeading}`;
}

/** One edit at a verified position: `expected` must be the exact text found at
 *  [start, end) when the edit is applied, or the whole file's edit set is
 *  refused as stale. */
export interface Edit { start: number; end: number; expected: string; replacement: string }

/** Apply edits from the end of the text backwards; null when any position no
 *  longer holds the text the cache recorded (the note changed since). */
export function applyEdits(text: string, edits: Edit[]): string | null {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  let floor = Infinity;
  for (const e of sorted) {
    if (e.end > floor) return null; // overlapping edits
    if (out.slice(e.start, e.end) !== e.expected) return null;
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
    floor = e.start;
  }
  return out;
}
