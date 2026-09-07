// obsidian-source.ts — the live vault adapter, the only Obsidian coupling in
// this package (the triage / cross-session / bases satellites' pattern: a
// separate file so tools.ts stays obsidian-free and headless-testable; only
// main.ts imports this).
//
// It is DUCK-TYPED against `app` rather than importing `obsidian` types, exactly
// as it was in the host — it keeps the file loadable in a plain node test
// process if a future test ever wants to drive it, and it costs nothing.
//
// The glob walker lives here rather than in the kernel because it is the one
// thing that needs a real vault listing. The SEGMENT matcher it uses is the
// KERNEL's (`globSegmentRe`, provenance-config.ts) — ONE definition, so the
// expander and the witness's `globMatchesPath` cannot disagree. They did once,
// and the weaker copy threw `Unterminated character class` on an unbalanced `[`
// in a configured folder name.

import { globSegmentRe, type FileStat, type ProvenanceBackend } from "./kernel/index.js";

/** The slice of `app.vault.adapter` the walker and the reads need. */
interface VaultAdapter {
  stat(path: string): Promise<{ type: "file" | "folder"; mtime: number } | null>;
  read(path: string): Promise<string>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
}

async function safeList(adapter: VaultAdapter, dir: string): Promise<{ files: string[]; folders: string[] }> {
  try {
    return await adapter.list(dir === "" ? "/" : dir);
  } catch {
    return { files: [], folders: [] };
  }
}

/**
 * Expand a vault-root-relative glob to sorted vault-relative FILE paths.
 *
 * Walks the pattern one `/`-segment at a time: a wildcard non-terminal segment
 * descends into matching FOLDERS; the terminal segment matches names in the
 * candidate dirs, and a final stat pass keeps only files (Python's
 * `if p.is_file()`).
 *
 * Translates a single glob segment (`*`, `?`, `[…]`) to an anchored RegExp,
 * matching Python `fnmatch`/`Path.glob` for the patterns provenance uses
 * (`.obsidian/plugins/*\/manifest.json`, `{notesDir}/*.md`, a wildcard
 * `derived-from` entry). `**` is not needed by any provenance pattern and is
 * treated as a literal `*` segment.
 */
async function globVaultRoot(adapter: VaultAdapter, pattern: string): Promise<string[]> {
  const segs = pattern.split("/").filter((s) => s.length > 0);
  let dirs: string[] = [""]; // "" = vault root
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    const next: string[] = [];
    if (!/[*?[]/.test(seg)) {
      for (const d of dirs) next.push(d ? `${d}/${seg}` : seg);
    } else {
      const re = globSegmentRe(seg);
      for (const d of dirs) {
        const listing = await safeList(adapter, d);
        const names = last ? [...listing.files, ...listing.folders] : listing.folders;
        for (const full of names) {
          const name = full.split("/").pop() ?? full;
          if (re.test(name)) next.push(full);
        }
      }
    }
    dirs = next;
  }
  const out: string[] = [];
  for (const p of dirs) {
    const st = await adapter.stat(p);
    if (st && st.type === "file") out.push(p);
  }
  return out.sort();
}

/** The Obsidian adapter — the ONLY vault coupling in this package, and the one
 * part not headlessly unit-tested; verify it against a running Obsidian. */
export function obsidianProvenanceBackend(app: {
  vault: {
    adapter: VaultAdapter;
    getAbstractFileByPath(path: string): unknown;
    modify(file: unknown, data: string): Promise<void>;
    create(path: string, data: string): Promise<unknown>;
    createFolder(path: string): Promise<unknown>;
  };
  metadataCache: {
    getCache(path: string): { frontmatter?: Record<string, unknown> } | null;
  };
}): ProvenanceBackend {
  const adapter = app.vault.adapter;
  return {
    noteFrontmatter(path) {
      return app.metadataCache.getCache(path)?.frontmatter ?? null;
    },
    async read(path) {
      const st = await adapter.stat(path);
      if (!st || st.type !== "file") return null;
      try {
        return await adapter.read(path);
      } catch {
        return null;
      }
    },
    async stat(path): Promise<FileStat | null> {
      const s = await adapter.stat(path);
      return s ? { type: s.type, mtime: s.mtime } : null;
    },
    glob(pattern) {
      return globVaultRoot(adapter, pattern);
    },
    async writeNote(path, text) {
      const existing = app.vault.getAbstractFileByPath(path);
      if (existing) {
        await app.vault.modify(existing, text);
        return;
      }
      // Ensure the parent folder exists before creating a new note.
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (parent && !app.vault.getAbstractFileByPath(parent)) {
        try {
          await app.vault.createFolder(parent);
        } catch {
          /* already exists / race — proceed to create */
        }
      }
      await app.vault.create(path, text);
    },
  };
}
