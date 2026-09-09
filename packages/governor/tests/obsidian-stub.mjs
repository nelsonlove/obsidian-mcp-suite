/**
 * A runtime stand-in for the `obsidian` module, for this package.
 *
 * The real package is TYPES ONLY (`"main": ""`), so any source file that
 * imports a live class from it — `ItemView`, `Modal`, `TFile` — cannot be loaded
 * in node at all. That is why almost everything here is kept obsidian-free and
 * driven through injected sources; this stub exists for the ONE surface worth
 * reaching anyway, and it is deliberately small.
 *
 * THE SURFACE IT BUYS: `src/wiring/pane.ts` exports two obsidian-free DOM
 * helpers — `renderAllowlist` and `wireAdoptButton` — that the review pane AND
 * the settings tab both build their gesture-gated controls with. They touch only
 * an element and an event, so they ARE exercisable headlessly against a fake
 * element; but the module they live in declares `class GovernanceReviewView
 * extends ItemView`, so the file cannot even EVALUATE without a base class to
 * extend. Every class below exists for that reason and no other: none of their
 * Obsidian behaviour is exercised, and none should be added to make it look like
 * it is. If a test ever needs real Obsidian behaviour, that is a live-verification
 * item, not a bigger stub.
 *
 * `installObsidianStub()` registers a synchronous resolve hook mapping the
 * "obsidian" specifier at this file, so a test can `await import()` the real
 * module under test afterwards. It is scoped to the process that calls it — no
 * other test file is affected, and no npm script changes.
 */

import { registerHooks } from "node:module";

/** Minimal TFile: a path plus the `stat.mtime` shape the wiring reads. */
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
    this.children = children;
  }
}

export class TAbstractFile {}
export class MarkdownView {}

/** Base classes the pane / wiring / settings-tab modules extend at eval time. */
export class ItemView {}
export class Component {}
export class App {}
export class Modal {
  constructor(app) {
    this.app = app;
  }
}
export class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
}
export class Setting {}
export class Notice {}
export class Plugin {}

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
