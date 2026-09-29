// rename-heading.ts — the pure half of `obsidian_rename_heading` (#424).
//
// Obsidian's own "Rename this heading" command renames a heading and heals
// every link to it, but it needs an editor cursor and a dialog, so no agent can
// run it. This module holds the text rules the tool applies; the handler in
// tools-vault-write.ts gathers the positions from the metadata cache and
// applies these rules at them. Kept obsidian-free so the rules are tested
// without an app.

/** Obsidian's `stripHeading`, copied from app.js (1.13.7): punctuation and
 *  line breaks become spaces, whitespace collapses, the ends are trimmed. */
export function stripHeading(s: string): string {
  return s.replace(/[!"#$%&()*+,.:;<=>?@^`{|}~\/\[\]\\\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

/** How Obsidian's `resolveSubpath` compares a heading named in a link with a
 *  heading in the note: both stripped, then lowercased. `## Step 1: setup` is
 *  reached by `[[A#Step 1 setup]]`, which is what Obsidian's own autocomplete
 *  writes. Used for the link match, the ambiguity check and the clash check,
 *  so the three agree with each other and with Obsidian. */
export function headingKey(s: string): string {
  return stripHeading(s).toLowerCase();
}

/** Characters a heading name cannot carry and still be linked by name:
 *  they are link syntax (`[ ] |`), the subpath separator (`#`) or the block
 *  marker (`^`). A newline would end the heading line. `%%` is refused
 *  separately: in a link it opens an Obsidian comment. */
export const FORBIDDEN_HEADING_CHARS = /[\[\]|#^\r\n]/;

/** The refusal for a proposed new heading name, or null when it is usable. */
export function newHeadingRefusal(oldHeading: string, newHeading: string): string | null {
  if (newHeading.trim() === "") return "new_heading is empty";
  if (newHeading !== newHeading.trim()) return "new_heading has leading or trailing whitespace";
  if (FORBIDDEN_HEADING_CHARS.test(newHeading)) return "new_heading contains a character a heading link cannot carry ([ ] | # ^ or a line break)";
  if (newHeading.includes("%%")) return "new_heading contains %%, which opens a comment inside a link";
  if (headingKey(newHeading) === "") return "new_heading has no character a link can match (Obsidian ignores punctuation when it matches a heading)";
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
    // decodeURI, not decodeURIComponent: it is what the cache applies, so the
    // rewrite matches exactly the links Obsidian resolves. Parentheses are
    // encoded too, because a raw `)` ends the destination.
    const seg = rewriteSegments(m[4], oldHeading, newHeading, (s) => decodeURI(s), (s) => encodeURIComponent(s).replace(/%2F/g, "/").replace(/\(/g, "%28").replace(/\)/g, "%29"));
    return seg === null ? null : `${m[1]}${m[2]}${m[3]}#${seg}${m[5]}${m[6] ?? ""}${m[7]}`;
  }
  return null;
}

/** The heading's source text (the span the cache records) with its text
 *  replaced, keeping its level; null when it is not a one-line heading whose
 *  text is `oldHeading`. An ATX heading (`## Text`, closing `#`s dropped) or a
 *  setext heading (`Text` over a line of `=` or `-`, underline kept). */
export function rewriteHeadingLine(line: string, oldHeading: string, newHeading: string): string | null {
  const atx = /^([ \t]{0,3}#{1,6})([ \t]+)(.*?)([ \t]+#+)?[ \t]*$/.exec(line);
  if (atx) return atx[3] === oldHeading ? `${atx[1]}${atx[2]}${newHeading}` : null;
  const setext = /^([ \t]{0,3})(.*?)[ \t]*(\r?\n[ \t]{0,3}(?:=+|-+)[ \t]*)$/.exec(line);
  if (setext && setext[2] === oldHeading) return `${setext[1]}${newHeading}${setext[3]}`;
  return null;
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
