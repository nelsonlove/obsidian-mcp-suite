/**
 * A runtime stand-in for the `obsidian` module — the minimum this package
 * needs.
 *
 * The real package is TYPES ONLY (`"main": ""`), so any source file importing a
 * live class from it cannot be loaded in node at all. That is why everything
 * here except `src/obsidian-source.ts` (and the settings tab, which is pure
 * rendering) is obsidian-free. The adapter is the one exception worth reaching:
 * the property under test — a promote renames through `fileManager.renameFile`,
 * never `vault.rename` — is a property of the REAL adapter, not of a
 * re-implementation.
 *
 * `installObsidianStub()` registers a synchronous resolve hook mapping the
 * "obsidian" specifier at this file, so a test can `await import()` the real
 * module under test afterwards. It is scoped to the process that calls it — no
 * other test file is affected. (Not a *.test.mjs file — the glob skips it.)
 */

import { registerHooks } from "node:module";

/** Minimal TFile: a path plus the `stat` an adapter might read. */
export class TFile {
  constructor(path, mtime = 1) {
    this.path = path;
    this.stat = { mtime, ctime: mtime, size: 0 };
    const name = path.split("/").pop() ?? path;
    this.name = name;
    this.basename = name.replace(/\.[^.]+$/, "");
    this.extension = name.includes(".") ? name.split(".").pop() : "";
  }
}

export class TFolder {
  constructor(path, children = []) {
    this.path = path;
    const name = path.split("/").pop() ?? path;
    this.name = name;
    this.children = children;
  }
}

export class TAbstractFile {}

/** Only needed so `class JdScaffoldSettingTab extends PluginSettingTab`
 *  evaluates if anything ever pulls the tab in transitively. */
export class App {}
export class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
}
export class Setting {
  constructor() {}
}
export class Plugin {}
export class Notice {
  constructor() {}
}

/**
 * A deliberately small YAML reader — enough for the frontmatter these tests
 * write: `key: scalar`, quoted scalars, inline arrays `[a, b]`, inline maps
 * `{k: v}` and block sequences. Copied from the host's own test stub because
 * the accept-fence scan (`scanForAcceptFence`, @vault-mcp/core) takes an
 * injected parser and FAILS CLOSED without one — production injects Obsidian's
 * real `parseYaml`, and the tests need something with the same value-TYPE
 * behaviour so the accept-forbidden cases are exercised rather than short-
 * circuited.
 */
export function parseYaml(text) {
  const scalar = (raw) => {
    const s = raw.trim();
    if (s === "") return null;
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "null" || s === "~") return null;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
  };
  const inline = (raw) => {
    const s = raw.trim();
    if (s.startsWith("[") && s.endsWith("]")) {
      const inner = s.slice(1, -1).trim();
      return inner === "" ? [] : inner.split(",").map((x) => scalar(x));
    }
    if (s.startsWith("{") && s.endsWith("}")) {
      const inner = s.slice(1, -1).trim();
      const out = {};
      if (inner !== "") {
        for (const pair of inner.split(",")) {
          const i = pair.indexOf(":");
          if (i < 0) continue;
          out[pair.slice(0, i).trim()] = scalar(pair.slice(i + 1));
        }
      }
      return out;
    }
    return scalar(s);
  };
  const obj = {};
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const m = /^([^:\s][^:]*):(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].trim();
    const rest = m[2].trim();
    if (rest === "" && lines[i + 1] && /^\s*-\s+/.test(lines[i + 1])) {
      const arr = [];
      while (lines[i + 1] && /^\s*-\s+/.test(lines[i + 1])) {
        arr.push(scalar(lines[i + 1].replace(/^\s*-\s+/, "")));
        i++;
      }
      obj[key] = arr;
    } else {
      obj[key] = inline(rest);
    }
  }
  return obj;
}

let installed = false;

/** Point the "obsidian" specifier at this module for every subsequent import. */
export function installObsidianStub() {
  if (installed) return;
  installed = true;
  const url = import.meta.url;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "obsidian") return { url, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
}
