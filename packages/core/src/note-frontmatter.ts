/**
 * One note written from a frontmatter object and a body (#500).
 *
 * `obsidian_write_notes` composes each item as `---\n<yaml>---\n<body>`, and
 * `obsidian_write_note` takes the same `frontmatter` argument and composes it
 * the same way, through `renderNoteWithFrontmatter` below: one definition, so
 * the two tools cannot drift apart. An empty frontmatter object writes the
 * body alone, as the batch tool always has.
 *
 * The live Obsidian host serializes with `obsidian.stringifyYaml`. The
 * filesystem server has no YAML library, so it uses `jsonFlowYaml`: every
 * value that is not a plain word is written as JSON, which is valid YAML, so
 * nothing is quoted wrong or read back as another type.
 */

import { LEADING_FRONTMATTER_RE, stripLeadingBom } from "./accept-guard.js";

/** `---\n<yaml>---\n<body>`, or the body alone when the frontmatter is empty. */
export function renderNoteWithFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
  stringifyYaml: (obj: Record<string, unknown>) => string,
): string {
  if (Object.keys(frontmatter).length === 0) return body;
  let yaml = stringifyYaml(frontmatter);
  if (!yaml.endsWith("\n")) yaml += "\n";
  return `---\n${yaml}---\n${body}`;
}

/** True when `text` opens with a frontmatter fence (BOM tolerated), as the accept guard reads one. */
export function opensWithFrontmatter(text: string): boolean {
  return LEADING_FRONTMATTER_RE.test(stripLeadingBom(text));
}

const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const PLAIN_WORD = /^[A-Za-z][A-Za-z0-9 _./-]*$/;
const YAML_RESERVED = new Set(["true", "false", "null", "yes", "no", "on", "off", "y", "n"]);

function flowValue(v: unknown): string {
  if (typeof v === "string") {
    const plain = PLAIN_WORD.test(v) && !v.endsWith(" ") && !YAML_RESERVED.has(v.toLowerCase());
    return plain ? v : JSON.stringify(v);
  }
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : JSON.stringify(String(v));
  if (typeof v === "boolean") return String(v);
  if (v === null) return "null";
  const json = JSON.stringify(v);
  if (json === undefined) throw new Error(`frontmatter value of type ${typeof v} cannot be written`);
  return json;
}

/**
 * Serialize a frontmatter object as YAML without a YAML library: one
 * `key: value` line per key, a value that is not a plain word written as JSON
 * (JSON is valid YAML). A key whose value is `undefined` is left out, as
 * JSON leaves it out.
 */
export function jsonFlowYaml(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const key = PLAIN_KEY.test(k) ? k : JSON.stringify(k);
    lines.push(`${key}: ${flowValue(v)}`);
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}
